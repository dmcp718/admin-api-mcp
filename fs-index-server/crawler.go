package main

import (
	"context"
	"database/sql"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"syscall"
	"time"
)

type Crawler struct {
	db          *sql.DB
	cfg         *Config
	broadcaster *SSEBroadcaster
	cancel      context.CancelFunc
	wg          sync.WaitGroup

	totalDirs  atomic.Int64
	totalFiles atomic.Int64
	startedAt  time.Time
	sampleMu   sync.Mutex
	samples    [12]throughputSample
	sampleIdx  int
	sampleFull bool
}

type throughputSample struct {
	time  time.Time
	dirs  int64
	files int64
}

type CrawlThroughput struct {
	DirsPerSec  float64 `json:"dirs_per_sec"`
	FilesPerSec float64 `json:"files_per_sec"`
	ElapsedSec  float64 `json:"elapsed_sec"`
	TotalDirs   int64   `json:"total_dirs"`
	TotalFiles  int64   `json:"total_files"`
}

func NewCrawler(db *sql.DB, cfg *Config, broadcaster *SSEBroadcaster) *Crawler {
	return &Crawler{
		db:          db,
		cfg:         cfg,
		broadcaster: broadcaster,
	}
}

func (c *Crawler) Start() {
	if err := ResetStuckCrawlItems(c.db); err != nil {
		log.Printf("Crawler: error resetting stuck items: %v", err)
	}

	ctx, cancel := context.WithCancel(context.Background())
	c.cancel = cancel
	c.startedAt = time.Now()

	workers := c.cfg.CrawlWorkers
	if workers < 1 {
		workers = 1
	}
	for i := 0; i < workers; i++ {
		c.wg.Add(1)
		go c.worker(ctx, fmt.Sprintf("crawler-%d", i))
	}

	c.wg.Add(1)
	go c.sampler(ctx)

	log.Printf("Started %d crawler workers (max depth: %d, rate: %dms)", workers, c.cfg.CrawlMaxDepth, c.cfg.CrawlRateMs)
	InsertEvent(c.db, "indexer", "info", nil, fmt.Sprintf("Indexer started (%d workers, max depth: %d)", workers, c.cfg.CrawlMaxDepth), nil)
}

func (c *Crawler) sampler(ctx context.Context) {
	defer c.wg.Done()
	ticker := time.NewTicker(5 * time.Second)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			c.sampleMu.Lock()
			c.samples[c.sampleIdx] = throughputSample{
				time:  time.Now(),
				dirs:  c.totalDirs.Load(),
				files: c.totalFiles.Load(),
			}
			c.sampleIdx = (c.sampleIdx + 1) % len(c.samples)
			if !c.sampleFull && c.sampleIdx == 0 {
				c.sampleFull = true
			}
			c.sampleMu.Unlock()
		}
	}
}

func (c *Crawler) GetThroughput() *CrawlThroughput {
	elapsed := time.Since(c.startedAt).Seconds()
	totalDirs := c.totalDirs.Load()
	totalFiles := c.totalFiles.Load()

	t := &CrawlThroughput{
		ElapsedSec: elapsed,
		TotalDirs:  totalDirs,
		TotalFiles: totalFiles,
	}

	c.sampleMu.Lock()
	defer c.sampleMu.Unlock()

	count := c.sampleIdx
	if c.sampleFull {
		count = len(c.samples)
	}
	if count < 2 {
		return t
	}

	var oldest, newest throughputSample
	if c.sampleFull {
		oldest = c.samples[c.sampleIdx]
	} else {
		oldest = c.samples[0]
	}
	newestIdx := (c.sampleIdx - 1 + len(c.samples)) % len(c.samples)
	newest = c.samples[newestIdx]

	dt := newest.time.Sub(oldest.time).Seconds()
	if dt > 0 {
		t.DirsPerSec = float64(newest.dirs-oldest.dirs) / dt
		t.FilesPerSec = float64(newest.files-oldest.files) / dt
	}

	return t
}

func (c *Crawler) Stop() {
	if c.cancel != nil {
		c.cancel()
	}
	c.wg.Wait()
	log.Println("Crawler stopped")
}

func (c *Crawler) EnqueueFromBrowse(dirPath string) {
	entries, err := os.ReadDir(dirPath)
	if err != nil {
		return
	}
	var items []CrawlEnqueueItem
	for _, entry := range entries {
		if !entry.IsDir() {
			continue
		}
		if strings.HasPrefix(entry.Name(), ".") {
			continue
		}
		subPath := filepath.Join(dirPath, entry.Name())
		depth := countDepth(subPath, c.cfg.MountPrefix)
		items = append(items, CrawlEnqueueItem{Path: subPath, Depth: depth, Priority: 1})
	}
	if len(items) > 0 {
		BatchEnqueueCrawl(c.db, items)
	}
}

const crawlBatchSize = 16

func (c *Crawler) worker(ctx context.Context, workerID string) {
	defer c.wg.Done()

	rateLimit := time.Duration(c.cfg.CrawlRateMs) * time.Millisecond

	for {
		select {
		case <-ctx.Done():
			return
		default:
		}

		items, err := ClaimCrawlItems(c.db, crawlBatchSize)
		if err != nil {
			log.Printf("[%s] Error claiming crawl items: %v", workerID, err)
			select {
			case <-ctx.Done():
				return
			case <-time.After(5 * time.Second):
			}
			continue
		}

		if len(items) == 0 {
			select {
			case <-ctx.Done():
				return
			case <-time.After(5 * time.Second):
			}
			continue
		}

		for _, item := range items {
			select {
			case <-ctx.Done():
				return
			default:
			}

			count := c.crawlDirectory(ctx, item)
			if ctx.Err() != nil {
				return
			}

			if count >= 0 {
				CompleteCrawlItem(c.db, item.ID, count)
				c.totalDirs.Add(1)
				c.totalFiles.Add(int64(count))
			}

			if rateLimit > 0 {
				select {
				case <-ctx.Done():
					return
				case <-time.After(rateLimit):
				}
			}
		}
	}
}

type fileInfo struct {
	entry     os.DirEntry
	name      string
	fullPath  string
	info      os.FileInfo
	inode     uint64
	createdAt string
	ok        bool
}

func (c *Crawler) crawlDirectory(ctx context.Context, item *CrawlItem) int {
	entries, err := os.ReadDir(item.Path)
	if err != nil {
		FailCrawlItem(c.db, item.ID, err.Error())
		return -1
	}

	filtered := entries[:0]
	for _, entry := range entries {
		if !strings.HasPrefix(entry.Name(), ".") {
			filtered = append(filtered, entry)
		}
	}
	if len(filtered) == 0 {
		return 0
	}

	infos := make([]fileInfo, len(filtered))
	statWorkers := 16
	if len(filtered) < statWorkers {
		statWorkers = len(filtered)
	}

	var wg sync.WaitGroup
	ch := make(chan int, len(filtered))
	for i := range filtered {
		ch <- i
	}
	close(ch)

	for w := 0; w < statWorkers; w++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for idx := range ch {
				entry := filtered[idx]
				name := entry.Name()
				fullPath := filepath.Join(item.Path, name)
				info, err := entry.Info()
				if err != nil {
					continue
				}
				fi := fileInfo{
					entry:    entry,
					name:     name,
					fullPath: fullPath,
					info:     info,
					ok:       true,
				}
				if stat, ok := info.Sys().(*syscall.Stat_t); ok {
					fi.inode = stat.Ino
					// Use Ctimespec on macOS (Ctim on Linux)
					t := time.Unix(stat.Ctimespec.Sec, stat.Ctimespec.Nsec)
					fi.createdAt = t.UTC().Format("2006-01-02T15:04:05Z")
				}
				infos[idx] = fi
			}
		}()
	}
	wg.Wait()

	if ctx.Err() != nil {
		return -1
	}

	var fileEntries []*FileEntry
	var crawlItems []CrawlEnqueueItem

	for _, fi := range infos {
		if !fi.ok {
			continue
		}

		parentPath := item.Path
		modTime := fi.info.ModTime().UTC().Format("2006-01-02T15:04:05Z")

		fileEntries = append(fileEntries, &FileEntry{
			Path:        fi.fullPath,
			Name:        fi.name,
			ParentPath:  &parentPath,
			IsDirectory: fi.entry.IsDir(),
			Size:        fi.info.Size(),
			ModifiedAt:  &modTime,
			Inode:       fi.inode,
			CreatedAt:   fi.createdAt,
		})

		if fi.entry.IsDir() {
			nextDepth := item.Depth + 1
			if nextDepth <= c.cfg.CrawlMaxDepth {
				crawlItems = append(crawlItems, CrawlEnqueueItem{
					Path:     fi.fullPath,
					Depth:    nextDepth,
					Priority: 0,
				})
			}
		}
	}

	if err := BatchUpsertFiles(c.db, fileEntries); err != nil {
		log.Printf("Crawler: batch upsert error for %s: %v", item.Path, err)
		FailCrawlItem(c.db, item.ID, err.Error())
		InsertEvent(c.db, "indexer", "error", nil, fmt.Sprintf("Crawl error: %s: %v", item.Path, err), nil)
		return -1
	}

	if err := BatchEnqueueCrawl(c.db, crawlItems); err != nil {
		log.Printf("Crawler: batch enqueue error for %s: %v", item.Path, err)
	}

	return len(fileEntries)
}

func countDepth(path, prefix string) int {
	rel := strings.TrimPrefix(path, prefix)
	rel = strings.Trim(rel, "/")
	if rel == "" {
		return 0
	}
	return strings.Count(rel, "/") + 1
}
