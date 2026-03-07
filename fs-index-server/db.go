package main

import (
	"database/sql"
	"fmt"
	"strings"
	"time"
)

func InitDB(dbPath string) (*sql.DB, error) {
	db, err := sql.Open("sqlite", dbPath)
	if err != nil {
		return nil, fmt.Errorf("open database: %w", err)
	}

	db.SetMaxOpenConns(1)

	pragmas := []string{
		"PRAGMA journal_mode=WAL",
		"PRAGMA busy_timeout=10000",
		"PRAGMA foreign_keys=ON",
		"PRAGMA synchronous=NORMAL",
	}
	for _, p := range pragmas {
		if _, err := db.Exec(p); err != nil {
			return nil, fmt.Errorf("exec %s: %w", p, err)
		}
	}

	if err := runMigrations(db); err != nil {
		return nil, fmt.Errorf("run migrations: %w", err)
	}

	return db, nil
}

func runMigrations(db *sql.DB) error {
	schema := `
	CREATE TABLE IF NOT EXISTS files (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		path TEXT UNIQUE NOT NULL,
		name TEXT NOT NULL,
		parent_path TEXT,
		is_directory INTEGER NOT NULL DEFAULT 0,
		size INTEGER DEFAULT 0,
		modified_at TEXT,
		inode INTEGER,
		created_at TEXT,
		indexed_at TEXT DEFAULT (datetime('now')),
		updated_at TEXT DEFAULT (datetime('now'))
	);
	CREATE INDEX IF NOT EXISTS idx_files_path ON files(path);
	CREATE INDEX IF NOT EXISTS idx_files_parent_path ON files(parent_path);
	CREATE INDEX IF NOT EXISTS idx_files_inode ON files(inode) WHERE inode IS NOT NULL;
	`
	if _, err := db.Exec(schema); err != nil {
		return err
	}

	// FTS5 search index
	ftsSchema := `
	CREATE VIRTUAL TABLE IF NOT EXISTS files_fts USING fts5(
		name, path, content='files', content_rowid='id', tokenize='unicode61'
	);

	CREATE TRIGGER IF NOT EXISTS files_fts_insert AFTER INSERT ON files BEGIN
		INSERT INTO files_fts(rowid, name, path) VALUES (new.id, new.name, new.path);
	END;

	CREATE TRIGGER IF NOT EXISTS files_fts_delete AFTER DELETE ON files BEGIN
		INSERT INTO files_fts(files_fts, rowid, name, path) VALUES ('delete', old.id, old.name, old.path);
	END;

	CREATE TRIGGER IF NOT EXISTS files_fts_update AFTER UPDATE OF name, path ON files BEGIN
		INSERT INTO files_fts(files_fts, rowid, name, path) VALUES ('delete', old.id, old.name, old.path);
		INSERT INTO files_fts(rowid, name, path) VALUES (new.id, new.name, new.path);
	END;
	`
	if _, err := db.Exec(ftsSchema); err != nil {
		return fmt.Errorf("create FTS5 schema: %w", err)
	}

	// One-time backfill
	var ftsCount, filesCount int
	db.QueryRow("SELECT COUNT(*) FROM files_fts").Scan(&ftsCount)
	db.QueryRow("SELECT COUNT(*) FROM files").Scan(&filesCount)
	if ftsCount == 0 && filesCount > 0 {
		if _, err := db.Exec("INSERT INTO files_fts(rowid, name, path) SELECT id, name, path FROM files"); err != nil {
			return fmt.Errorf("FTS5 backfill: %w", err)
		}
	}

	// Crawl queue table
	crawlSchema := `
	CREATE TABLE IF NOT EXISTS crawl_queue (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		path TEXT UNIQUE NOT NULL,
		depth INTEGER NOT NULL DEFAULT 0,
		status TEXT NOT NULL DEFAULT 'pending'
			CHECK (status IN ('pending','crawling','completed','failed')),
		priority INTEGER NOT NULL DEFAULT 0,
		file_count INTEGER DEFAULT 0,
		error_message TEXT,
		queued_at TEXT DEFAULT (datetime('now')),
		started_at TEXT,
		completed_at TEXT
	);
	CREATE INDEX IF NOT EXISTS idx_crawl_queue_status ON crawl_queue(status);
	`
	if _, err := db.Exec(crawlSchema); err != nil {
		return fmt.Errorf("create crawl_queue: %w", err)
	}

	// Event log table
	eventSchema := `
	CREATE TABLE IF NOT EXISTS event_log (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		timestamp TEXT DEFAULT (datetime('now')),
		category TEXT NOT NULL,
		level TEXT NOT NULL DEFAULT 'info',
		filespace TEXT,
		message TEXT NOT NULL,
		detail TEXT
	);
	CREATE INDEX IF NOT EXISTS idx_event_log_ts ON event_log(timestamp);
	CREATE INDEX IF NOT EXISTS idx_event_log_cat ON event_log(category);
	`
	if _, err := db.Exec(eventSchema); err != nil {
		return fmt.Errorf("create event_log: %w", err)
	}

	// Prune old events
	db.Exec("DELETE FROM event_log WHERE timestamp < datetime('now', '-30 days')")

	return nil
}

// Event log operations

type Event struct {
	ID        int64   `json:"id"`
	Timestamp string  `json:"timestamp"`
	Category  string  `json:"category"`
	Level     string  `json:"level"`
	Filespace *string `json:"filespace"`
	Message   string  `json:"message"`
	Detail    *string `json:"detail,omitempty"`
}

func InsertEvent(db *sql.DB, category, level string, filespace *string, message string, detail *string) {
	db.Exec(`INSERT INTO event_log (category, level, filespace, message, detail) VALUES (?, ?, ?, ?, ?)`,
		category, level, filespace, message, detail)
}

func QueryEvents(db *sql.DB, category, filespace, level string, limit int, beforeID int64) ([]Event, error) {
	if limit <= 0 {
		limit = 50
	}
	if limit > 500 {
		limit = 500
	}

	query := "SELECT id, timestamp, category, level, filespace, message, detail FROM event_log WHERE 1=1"
	var args []interface{}

	if category != "" {
		query += " AND category = ?"
		args = append(args, category)
	}
	if filespace != "" {
		query += " AND filespace = ?"
		args = append(args, filespace)
	}
	if level != "" {
		query += " AND level = ?"
		args = append(args, level)
	}
	if beforeID > 0 {
		query += " AND id < ?"
		args = append(args, beforeID)
	}

	query += " ORDER BY id DESC LIMIT ?"
	args = append(args, limit)

	rows, err := db.Query(query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var events []Event
	for rows.Next() {
		var e Event
		if err := rows.Scan(&e.ID, &e.Timestamp, &e.Category, &e.Level, &e.Filespace, &e.Message, &e.Detail); err != nil {
			return nil, err
		}
		events = append(events, e)
	}
	return events, rows.Err()
}

// File operations

type FileEntry struct {
	ID          int64   `json:"id"`
	Path        string  `json:"path"`
	Name        string  `json:"name"`
	ParentPath  *string `json:"parent_path"`
	IsDirectory bool    `json:"is_directory"`
	Size        int64   `json:"size"`
	ModifiedAt  *string `json:"modified_at"`
	Inode       uint64  `json:"inode,omitempty"`
	CreatedAt   string  `json:"created_at,omitempty"`
}

func UpsertFile(db *sql.DB, f *FileEntry) error {
	isDir := 0
	if f.IsDirectory {
		isDir = 1
	}
	var inodeVal *uint64
	if f.Inode != 0 {
		inodeVal = &f.Inode
	}
	var createdAtVal *string
	if f.CreatedAt != "" {
		createdAtVal = &f.CreatedAt
	}
	_, err := db.Exec(`
		INSERT INTO files (path, name, parent_path, is_directory, size, modified_at, inode, created_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT(path) DO UPDATE SET
			name = excluded.name,
			size = excluded.size,
			modified_at = excluded.modified_at,
			inode = COALESCE(excluded.inode, files.inode),
			created_at = COALESCE(excluded.created_at, files.created_at),
			updated_at = datetime('now')
	`, f.Path, f.Name, f.ParentPath, isDir, f.Size, f.ModifiedAt, inodeVal, createdAtVal)
	return err
}

func BatchUpsertFiles(db *sql.DB, files []*FileEntry) error {
	if len(files) == 0 {
		return nil
	}

	tx, err := db.Begin()
	if err != nil {
		return fmt.Errorf("BatchUpsertFiles begin: %w", err)
	}
	defer tx.Rollback()

	stmt, err := tx.Prepare(`
		INSERT INTO files (path, name, parent_path, is_directory, size, modified_at, inode, created_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT(path) DO UPDATE SET
			name = excluded.name,
			size = excluded.size,
			modified_at = excluded.modified_at,
			inode = COALESCE(excluded.inode, files.inode),
			created_at = COALESCE(excluded.created_at, files.created_at),
			updated_at = datetime('now')
	`)
	if err != nil {
		return fmt.Errorf("BatchUpsertFiles prepare: %w", err)
	}
	defer stmt.Close()

	for _, f := range files {
		isDir := 0
		if f.IsDirectory {
			isDir = 1
		}
		var inodeVal *uint64
		if f.Inode != 0 {
			inodeVal = &f.Inode
		}
		var createdAtVal *string
		if f.CreatedAt != "" {
			createdAtVal = &f.CreatedAt
		}
		if _, err := stmt.Exec(f.Path, f.Name, f.ParentPath, isDir, f.Size, f.ModifiedAt, inodeVal, createdAtVal); err != nil {
			return fmt.Errorf("BatchUpsertFiles exec %s: %w", f.Path, err)
		}
	}

	return tx.Commit()
}

func BatchEnqueueCrawl(db *sql.DB, items []CrawlEnqueueItem) error {
	if len(items) == 0 {
		return nil
	}

	tx, err := db.Begin()
	if err != nil {
		return fmt.Errorf("BatchEnqueueCrawl begin: %w", err)
	}
	defer tx.Rollback()

	stmt, err := tx.Prepare(`
		INSERT INTO crawl_queue (path, depth, priority) VALUES (?, ?, ?)
		ON CONFLICT(path) DO UPDATE SET
			priority = MAX(crawl_queue.priority, excluded.priority),
			status = CASE WHEN crawl_queue.status = 'completed' THEN crawl_queue.status ELSE crawl_queue.status END
	`)
	if err != nil {
		return fmt.Errorf("BatchEnqueueCrawl prepare: %w", err)
	}
	defer stmt.Close()

	for _, item := range items {
		if _, err := stmt.Exec(item.Path, item.Depth, item.Priority); err != nil {
			return fmt.Errorf("BatchEnqueueCrawl exec %s: %w", item.Path, err)
		}
	}

	return tx.Commit()
}

type CrawlEnqueueItem struct {
	Path     string
	Depth    int
	Priority int
}

// Search

type SearchResult struct {
	ID          int64
	Path        string
	Name        string
	ParentPath  string
	IsDirectory bool
	Size        int64
	ModifiedAt  string
	CreatedAt   string
}

func SearchFiles(db *sql.DB, query string, limit, offset int, filespaces []string, mountPrefix string) ([]SearchResult, int, error) {
	if limit <= 0 {
		limit = 100
	}
	if limit > 500 {
		limit = 500
	}

	ftsQuery := buildFTSQuery(query)
	if ftsQuery == "" {
		return nil, 0, nil
	}

	var fsFilter string
	var fsArgs []interface{}
	if len(filespaces) > 0 {
		var clauses []string
		for _, fs := range filespaces {
			clauses = append(clauses, "f.path LIKE ?")
			fsArgs = append(fsArgs, mountPrefix+"/"+fs+"/%")
		}
		fsFilter = " AND (" + strings.Join(clauses, " OR ") + ")"
	}

	countQuery := `
		SELECT COUNT(*) FROM files_fts fts
		JOIN files f ON f.id = fts.rowid
		WHERE files_fts MATCH ?` + fsFilter
	countArgs := append([]interface{}{ftsQuery}, fsArgs...)
	var total int
	err := db.QueryRow(countQuery, countArgs...).Scan(&total)
	if err != nil {
		return nil, 0, fmt.Errorf("search count: %w", err)
	}

	resultQuery := `
		SELECT f.id, f.path, f.name, COALESCE(f.parent_path, ''), f.is_directory, f.size,
			COALESCE(f.modified_at, ''), COALESCE(f.created_at, '')
		FROM files_fts fts
		JOIN files f ON f.id = fts.rowid
		WHERE files_fts MATCH ?` + fsFilter + `
		ORDER BY rank
		LIMIT ? OFFSET ?`
	resultArgs := append([]interface{}{ftsQuery}, fsArgs...)
	resultArgs = append(resultArgs, limit, offset)
	rows, err := db.Query(resultQuery, resultArgs...)
	if err != nil {
		return nil, 0, fmt.Errorf("search query: %w", err)
	}
	defer rows.Close()

	var results []SearchResult
	for rows.Next() {
		var r SearchResult
		var isDir int
		if err := rows.Scan(&r.ID, &r.Path, &r.Name, &r.ParentPath, &isDir, &r.Size, &r.ModifiedAt, &r.CreatedAt); err != nil {
			return nil, 0, err
		}
		r.IsDirectory = isDir == 1
		results = append(results, r)
	}
	return results, total, rows.Err()
}

func buildFTSQuery(query string) string {
	query = strings.TrimSpace(query)
	if query == "" {
		return ""
	}

	upper := strings.ToUpper(query)
	if strings.Contains(upper, " AND ") || strings.Contains(upper, " OR ") ||
		strings.Contains(upper, " NOT ") || strings.Contains(upper, " NEAR") ||
		strings.Contains(query, "\"") {
		return query
	}

	tokens := strings.Fields(query)
	parts := make([]string, 0, len(tokens))
	for _, tok := range tokens {
		tok = strings.ReplaceAll(tok, "\"", "")
		if tok == "" {
			continue
		}
		parts = append(parts, "\""+tok+"\"*")
	}
	return strings.Join(parts, " ")
}

func ClearFilespaceIndex(db *sql.DB, mountPrefix, filespace string) (int64, error) {
	prefix := mountPrefix + "/" + filespace + "/"

	tx, err := db.Begin()
	if err != nil {
		return 0, fmt.Errorf("ClearFilespaceIndex begin: %w", err)
	}
	defer tx.Rollback()

	res, err := tx.Exec("DELETE FROM files WHERE path LIKE ?", prefix+"%")
	if err != nil {
		return 0, fmt.Errorf("ClearFilespaceIndex delete files: %w", err)
	}
	deleted, _ := res.RowsAffected()

	tx.Exec("DELETE FROM files WHERE path = ?", strings.TrimSuffix(prefix, "/"))
	tx.Exec("DELETE FROM crawl_queue WHERE path LIKE ?", prefix+"%")
	tx.Exec("DELETE FROM crawl_queue WHERE path = ?", strings.TrimSuffix(prefix, "/"))

	if err := tx.Commit(); err != nil {
		return 0, fmt.Errorf("ClearFilespaceIndex commit: %w", err)
	}
	return deleted, nil
}

func GetIndexedFileCount(db *sql.DB) (int, error) {
	var count int
	err := db.QueryRow("SELECT COUNT(*) FROM files").Scan(&count)
	return count, err
}

// Crawl queue operations

type CrawlItem struct {
	ID       int64
	Path     string
	Depth    int
	Priority int
}

type CrawlStats struct {
	Pending   int `json:"pending"`
	Crawling  int `json:"crawling"`
	Completed int `json:"completed"`
	Failed    int `json:"failed"`
	Total     int `json:"total"`
}

func EnqueueCrawl(db *sql.DB, dirPath string, depth int, priority int) error {
	_, err := db.Exec(`
		INSERT INTO crawl_queue (path, depth, priority) VALUES (?, ?, ?)
		ON CONFLICT(path) DO UPDATE SET
			priority = MAX(crawl_queue.priority, excluded.priority),
			status = CASE WHEN crawl_queue.status = 'completed' THEN crawl_queue.status ELSE crawl_queue.status END
	`, dirPath, depth, priority)
	return err
}

func ClaimCrawlItems(db *sql.DB, limit int) ([]*CrawlItem, error) {
	tx, err := db.Begin()
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()

	rows, err := tx.Query(`
		SELECT id, path, depth, priority FROM crawl_queue
		WHERE status = 'pending'
		ORDER BY priority DESC, queued_at ASC
		LIMIT ?
	`, limit)
	if err != nil {
		return nil, err
	}

	var items []*CrawlItem
	var ids []interface{}
	for rows.Next() {
		var item CrawlItem
		if err := rows.Scan(&item.ID, &item.Path, &item.Depth, &item.Priority); err != nil {
			rows.Close()
			return nil, err
		}
		items = append(items, &item)
		ids = append(ids, item.ID)
	}
	rows.Close()

	if len(ids) == 0 {
		return nil, nil
	}

	placeholders := make([]string, len(ids))
	for i := range ids {
		placeholders[i] = "?"
	}
	_, err = tx.Exec(
		"UPDATE crawl_queue SET status = 'crawling', started_at = datetime('now') WHERE id IN ("+strings.Join(placeholders, ",")+") AND status = 'pending'",
		ids...,
	)
	if err != nil {
		return nil, err
	}

	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return items, nil
}

func CompleteCrawlItem(db *sql.DB, id int64, fileCount int) error {
	_, err := db.Exec(`
		UPDATE crawl_queue SET status = 'completed', file_count = ?, completed_at = datetime('now')
		WHERE id = ?
	`, fileCount, id)
	return err
}

func FailCrawlItem(db *sql.DB, id int64, errMsg string) error {
	_, err := db.Exec(`
		UPDATE crawl_queue SET status = 'failed', error_message = ?, completed_at = datetime('now')
		WHERE id = ?
	`, errMsg, id)
	return err
}

func ResetStuckCrawlItems(db *sql.DB) error {
	_, err := db.Exec(`UPDATE crawl_queue SET status = 'pending' WHERE status = 'crawling'`)
	return err
}

func GetCrawlStats(db *sql.DB) (*CrawlStats, error) {
	s := &CrawlStats{}
	rows, err := db.Query(`SELECT status, COUNT(*) FROM crawl_queue GROUP BY status`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var status string
		var count int
		if err := rows.Scan(&status, &count); err != nil {
			return nil, err
		}
		switch status {
		case "pending":
			s.Pending = count
		case "crawling":
			s.Crawling = count
		case "completed":
			s.Completed = count
		case "failed":
			s.Failed = count
		}
		s.Total += count
	}
	return s, rows.Err()
}

// Stats

type Stats struct {
	TotalFiles  int `json:"total_files"`
	TotalDirs   int `json:"total_dirs"`
	IndexedDate string `json:"indexed_date"`
}

func GetStats(db *sql.DB) (*Stats, error) {
	s := &Stats{}
	db.QueryRow("SELECT COUNT(*) FROM files WHERE is_directory = 0").Scan(&s.TotalFiles)
	db.QueryRow("SELECT COUNT(*) FROM files WHERE is_directory = 1").Scan(&s.TotalDirs)
	s.IndexedDate = time.Now().UTC().Format(time.RFC3339)
	return s, nil
}
