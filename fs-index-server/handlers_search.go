package main

import (
	"bytes"
	"context"
	"database/sql"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"text/template"
	"time"
)

type SearchTemplateEntry struct {
	TemplateEntry
	ParentDisplay string
}

func HandleSSESearch(db *sql.DB, cfg *Config, tmpl *template.Template) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		flusher, ok := w.(http.Flusher)
		if !ok {
			http.Error(w, "streaming unsupported", http.StatusInternalServerError)
			return
		}

		query := r.URL.Query().Get("q")
		if strings.TrimSpace(query) == "" {
			sendSSEError(w, flusher, "Search query is empty")
			return
		}

		limitStr := r.URL.Query().Get("limit")
		limit := 100
		if limitStr != "" {
			if n, err := strconv.Atoi(limitStr); err == nil && n > 0 {
				limit = n
			}
		}

		var filespaces []string
		if fsParam := r.URL.Query().Get("fs"); fsParam != "" {
			filespaces = strings.Split(fsParam, ",")
		}

		allFilespaces := listFilespaceNames(cfg.MountPrefix)

		results, total, err := SearchFiles(db, query, limit, 0, filespaces, cfg.MountPrefix)
		if err != nil {
			log.Printf("Search error: %v", err)
			sendSSEError(w, flusher, fmt.Sprintf("Search error: %v", err))
			return
		}

		indexedCount, _ := GetIndexedFileCount(db)

		var entries []SearchTemplateEntry
		for _, r := range results {
			parentDisplay := r.ParentPath
			if strings.HasPrefix(parentDisplay, cfg.MountPrefix) {
				parentDisplay = parentDisplay[len(cfg.MountPrefix):]
			}
			if parentDisplay == "" {
				parentDisplay = "/"
			}

			sizeDisplay := ""
			if !r.IsDirectory && r.Size > 0 {
				sizeDisplay = formatSize(r.Size)
			}

			modDisplay := ""
			if r.ModifiedAt != "" {
				modDisplay = formatSearchTime(r.ModifiedAt)
			}

			createdDisplay := ""
			if r.CreatedAt != "" {
				createdDisplay = formatSearchTime(r.CreatedAt)
			}

			entries = append(entries, SearchTemplateEntry{
				TemplateEntry: TemplateEntry{
					ID:          pathToID(r.Path),
					Path:        r.Path,
					Name:        r.Name,
					IsDirectory: r.IsDirectory,
					Size:        r.Size,
					SizeDisplay: sizeDisplay,
					ModifiedAt:  modDisplay,
					CreatedAt:   createdDisplay,
				},
				ParentDisplay: parentDisplay,
			})
		}

		w.Header().Set("Content-Type", "text/event-stream")
		w.Header().Set("Cache-Control", "no-cache")
		w.Header().Set("Connection", "keep-alive")

		activeSet := make(map[string]bool)
		if len(filespaces) > 0 {
			for _, fs := range filespaces {
				activeSet[fs] = true
			}
		} else {
			for _, fs := range allFilespaces {
				activeSet[fs] = true
			}
		}

		var bcBuf bytes.Buffer
		if err := tmpl.ExecuteTemplate(&bcBuf, "search_breadcrumbs.html", map[string]interface{}{
			"Query":        query,
			"Total":        total,
			"IndexedCount": indexedCount,
			"Filespaces":   allFilespaces,
			"ActiveSet":    activeSet,
		}); err != nil {
			log.Printf("Error rendering search breadcrumbs: %v", err)
		} else {
			fmt.Fprintf(w, "event: datastar-patch-elements\ndata: elements %s\n\n", oneLine(bcBuf.String()))
			flusher.Flush()
		}

		var rowsBuf bytes.Buffer
		if err := tmpl.ExecuteTemplate(&rowsBuf, "search_results.html", map[string]interface{}{
			"Entries": entries,
			"Query":   query,
		}); err != nil {
			log.Printf("Error rendering search results: %v", err)
		} else {
			fmt.Fprintf(w, "event: datastar-patch-elements\ndata: elements %s\n\n", oneLine(rowsBuf.String()))
			flusher.Flush()
		}

		fmt.Fprintf(w, "event: datastar-patch-signals\ndata: signals {_path: '', _searchQuery: '%s', _searchCount: %d, _indexedCount: %d}\n\n",
			escapeJSString(query), total, indexedCount)
		flusher.Flush()
	}
}

func HandleSSELiveSearch(db *sql.DB, cfg *Config, tmpl *template.Template) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		flusher, ok := w.(http.Flusher)
		if !ok {
			http.Error(w, "streaming unsupported", http.StatusInternalServerError)
			return
		}

		query := r.URL.Query().Get("q")
		if strings.TrimSpace(query) == "" {
			sendSSEError(w, flusher, "Search query is empty")
			return
		}

		timeoutStr := r.URL.Query().Get("timeout")
		timeout := 30
		if timeoutStr != "" {
			if n, err := strconv.Atoi(timeoutStr); err == nil && n > 0 && n <= 60 {
				timeout = n
			}
		}

		var filespaces []string
		if fsParam := r.URL.Query().Get("fs"); fsParam != "" {
			filespaces = strings.Split(fsParam, ",")
		}

		w.Header().Set("Content-Type", "text/event-stream")
		w.Header().Set("Cache-Control", "no-cache")
		w.Header().Set("Connection", "keep-alive")

		ctx, cancel := context.WithTimeout(r.Context(), time.Duration(timeout)*time.Second)
		defer cancel()

		searchDirs := []string{cfg.MountPrefix}
		if len(filespaces) > 0 {
			searchDirs = nil
			for _, fs := range filespaces {
				searchDirs = append(searchDirs, filepath.Join(cfg.MountPrefix, fs))
			}
		}

		pattern := "*" + query + "*"
		findArgs := []string{}
		for _, d := range searchDirs {
			findArgs = append(findArgs, d)
		}
		findArgs = append(findArgs, "-iname", pattern, "-maxdepth", "20", "-not", "-path", "*/.*")
		cmd := exec.CommandContext(ctx, "find", findArgs...)
		stdout, err := cmd.StdoutPipe()
		if err != nil {
			sendSSEError(w, flusher, fmt.Sprintf("Failed to start search: %v", err))
			return
		}
		if err := cmd.Start(); err != nil {
			sendSSEError(w, flusher, fmt.Sprintf("Failed to start search: %v", err))
			return
		}

		var batch []SearchTemplateEntry
		count := 0
		maxResults := 500
		batchSize := 20

		scanner := newLineScanner(stdout)
		for scanner.Scan() {
			if count >= maxResults {
				break
			}

			line := scanner.Text()
			if line == "" || line == cfg.MountPrefix {
				continue
			}

			info, err := os.Stat(line)
			if err != nil {
				continue
			}

			name := filepath.Base(line)
			parentPath := filepath.Dir(line)
			isDir := info.IsDir()
			size := info.Size()
			modTime := info.ModTime().UTC().Format("2006-01-02T15:04:05Z")
			createdAt := getFileCreatedAt(info)

			UpsertFile(db, &FileEntry{
				Path:        line,
				Name:        name,
				ParentPath:  &parentPath,
				IsDirectory: isDir,
				Size:        size,
				ModifiedAt:  &modTime,
				CreatedAt:   createdAt,
			})

			parentDisplay := parentPath
			if strings.HasPrefix(parentDisplay, cfg.MountPrefix) {
				parentDisplay = parentDisplay[len(cfg.MountPrefix):]
			}
			if parentDisplay == "" {
				parentDisplay = "/"
			}

			sizeDisplay := ""
			if !isDir && size > 0 {
				sizeDisplay = formatSize(size)
			}

			createdDisplay := ""
			if createdAt != "" {
				createdDisplay = formatSearchTime(createdAt)
			}

			entry := SearchTemplateEntry{
				TemplateEntry: TemplateEntry{
					ID:          pathToID(line),
					Path:        line,
					Name:        name,
					IsDirectory: isDir,
					Size:        size,
					SizeDisplay: sizeDisplay,
					ModifiedAt:  info.ModTime().Format("Jan 02, 2006 15:04"),
					CreatedAt:   createdDisplay,
				},
				ParentDisplay: parentDisplay,
			}

			batch = append(batch, entry)
			count++

			if len(batch) >= batchSize {
				sendLiveSearchBatch(w, flusher, tmpl, batch, count)
				batch = nil
			}
		}

		if len(batch) > 0 {
			sendLiveSearchBatch(w, flusher, tmpl, batch, count)
		}

		cmd.Wait()

		fmt.Fprintf(w, "event: datastar-patch-signals\ndata: signals {_liveSearchDone: true, _liveSearchCount: %d}\n\n", count)
		flusher.Flush()
	}
}

func sendLiveSearchBatch(w http.ResponseWriter, flusher http.Flusher, tmpl *template.Template, entries []SearchTemplateEntry, totalSoFar int) {
	var buf bytes.Buffer
	if err := tmpl.ExecuteTemplate(&buf, "search_results_append.html", map[string]interface{}{
		"Entries": entries,
	}); err != nil {
		log.Printf("Error rendering live search batch: %v", err)
		return
	}
	fmt.Fprintf(w, "event: datastar-patch-elements\ndata: elements %s\n\n", oneLine(buf.String()))
	flusher.Flush()
}

func HandleCrawlStats(db *sql.DB, crawler *Crawler) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		stats, err := GetCrawlStats(db)
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
			return
		}
		indexedCount, _ := GetIndexedFileCount(db)
		resp := map[string]interface{}{
			"crawl":         stats,
			"indexed_files": indexedCount,
		}
		if crawler != nil {
			resp["throughput"] = crawler.GetThroughput()
		}
		writeJSON(w, http.StatusOK, resp)
	}
}

func HandleClearFilespaceIndex(db *sql.DB, cfg *Config) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != "DELETE" && r.Method != "POST" {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}

		path := strings.TrimPrefix(r.URL.Path, "/api/filespaces/")
		name := strings.TrimSuffix(path, "/index")
		if name == "" || strings.Contains(name, "/") {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid filespace name"})
			return
		}

		fsPath := cfg.MountPrefix + "/" + name
		if info, err := os.Stat(fsPath); err != nil || !info.IsDir() {
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "filespace not found"})
			return
		}

		deleted, err := ClearFilespaceIndex(db, cfg.MountPrefix, name)
		if err != nil {
			log.Printf("ClearFilespaceIndex error for %s: %v", name, err)
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
			return
		}

		EnqueueCrawl(db, fsPath, 0, 0)

		log.Printf("Cleared index for filespace %s: %d entries deleted", name, deleted)
		InsertEvent(db, "indexer", "info", &name, fmt.Sprintf("Index cleared for %s: %d entries removed", name, deleted), nil)

		writeJSON(w, http.StatusOK, map[string]interface{}{
			"filespace": name,
			"deleted":   deleted,
		})
	}
}

func formatSearchTime(iso string) string {
	s := strings.ReplaceAll(iso, " ", "T")
	if !strings.HasSuffix(s, "Z") && !strings.Contains(s, "+") {
		s += "Z"
	}
	t, err := time.Parse(time.RFC3339, s)
	if err != nil {
		return iso
	}
	return t.Format("Jan 02, 2006 15:04")
}

func newLineScanner(r interface{ Read([]byte) (int, error) }) *stdScanner {
	return &stdScanner{r: r, buf: make([]byte, 0, 4096), tmp: make([]byte, 4096)}
}

type stdScanner struct {
	r    interface{ Read([]byte) (int, error) }
	buf  []byte
	tmp  []byte
	text string
	done bool
}

func (s *stdScanner) Scan() bool {
	for {
		if idx := indexOf(s.buf, '\n'); idx >= 0 {
			s.text = string(s.buf[:idx])
			s.buf = s.buf[idx+1:]
			return true
		}
		if s.done {
			if len(s.buf) > 0 {
				s.text = string(s.buf)
				s.buf = nil
				return true
			}
			return false
		}
		n, err := s.r.Read(s.tmp)
		if n > 0 {
			s.buf = append(s.buf, s.tmp[:n]...)
		}
		if err != nil {
			s.done = true
		}
	}
}

func (s *stdScanner) Text() string {
	return s.text
}

func indexOf(b []byte, c byte) int {
	for i, v := range b {
		if v == c {
			return i
		}
	}
	return -1
}

func listFilespaceNames(mountPrefix string) []string {
	entries, err := os.ReadDir(mountPrefix)
	if err != nil {
		return nil
	}
	var names []string
	for _, e := range entries {
		if e.IsDir() {
			names = append(names, e.Name())
		}
	}
	return names
}
