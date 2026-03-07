# fs-index-server — Architecture & Design Reference

This document describes the complete architecture of the `fs-index-server` Go binary so that an LLM can intelligently modify, extend, or debug it.

## Purpose

A standalone HTTP server that discovers LucidLink filespace mount points, crawls and indexes all files into a SQLite FTS5 database, and exposes REST + SSE APIs for full-text search, directory browsing, and index management.

## Binary Location

- **Source**: `fs-index-server/` directory in this repo
- **Build**: `cd fs-index-server && go build -o fs-index-server .`
- **Cross-compile for macOS arm64**: `GOOS=darwin GOARCH=arm64 go build -o fs-index-server .`
- **Runtime**: Managed by the MCP server (`src/search-server.ts`) which finds, spawns, and health-checks the binary

## File Map

| File | Lines | Purpose |
|------|-------|---------|
| `main.go` | ~130 | HTTP server setup, route registration, startup orchestration |
| `config.go` | ~60 | Configuration via `FS_INDEX_*` environment variables |
| `db.go` | ~800 | SQLite schema, FTS5 setup, all CRUD operations |
| `crawler.go` | ~350 | Background directory crawler with parallel workers |
| `mount_discovery.go` | ~120 | LucidLink CLI-based mount point discovery |
| `handlers_files.go` | ~130 | Directory listing API (`/api/files`) |
| `handlers_search.go` | ~450 | FTS5 search + live filesystem search (`/sse/search`) |
| `handlers_sse.go` | ~400 | SSE broadcaster, directory view streaming, template helpers |
| `handlers_events.go` | ~140 | Event log API and SSE streaming |
| `templates/` | 5 files | Go HTML templates for SSE patch responses |

## Configuration (`config.go`)

All settings via environment variables with sensible defaults:

| Env Var | Default | Description |
|---------|---------|-------------|
| `FS_INDEX_PORT` | `3201` | HTTP server port |
| `FS_INDEX_DB_PATH` | `~/.fs-index-server/index.db` | SQLite database path |
| `FS_INDEX_MOUNT_PREFIX` | *(auto-detected)* | Override mount prefix |
| `FS_INDEX_CRAWL_ENABLED` | `true` | Enable background crawler |
| `FS_INDEX_CRAWL_WORKERS` | `16` | Parallel crawl workers |
| `FS_INDEX_CRAWL_MAX_DEPTH` | `10` | Maximum directory depth |
| `FS_INDEX_CRAWL_RATE_MS` | `100` | Delay between crawl batches |
| `FS_INDEX_LUCID_BIN` | `lucid` | Path to lucid CLI binary |

## Database Schema (`db.go`)

### Tables

**`files`** — Every indexed file and directory:
```sql
CREATE TABLE files (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    path        TEXT UNIQUE NOT NULL,
    name        TEXT NOT NULL,
    is_directory BOOLEAN DEFAULT 0,
    size        INTEGER DEFAULT 0,
    created_at  DATETIME,
    modified_at DATETIME,
    filespace   TEXT DEFAULT '',
    indexed_at  DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_files_path ON files(path);
CREATE INDEX idx_files_name ON files(name);
CREATE INDEX idx_files_filespace ON files(filespace);
```

**`files_fts`** — FTS5 virtual table (content-synced):
```sql
CREATE VIRTUAL TABLE files_fts USING fts5(
    name, path, filespace,
    content='files',
    content_rowid='id'
);
```

Auto-sync triggers keep FTS5 in sync on INSERT, UPDATE, DELETE.

**`crawl_queue`** — Priority-based crawl work queue:
```sql
CREATE TABLE crawl_queue (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    path      TEXT UNIQUE NOT NULL,
    priority  INTEGER DEFAULT 0,
    status    TEXT DEFAULT 'pending',  -- pending, crawling, completed, failed
    error     TEXT DEFAULT '',
    depth     INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

**`event_log`** — Audit trail:
```sql
CREATE TABLE event_log (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    event_type TEXT NOT NULL,
    message    TEXT NOT NULL,
    details    TEXT DEFAULT '',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

### Key DB Operations

- **`SearchFiles(query, filespace, limit)`** — FTS5 MATCH query with optional filespace filter
- **`BatchUpsertFiles(entries)`** — Bulk INSERT OR REPLACE with transaction batching
- **`BatchEnqueueCrawl(paths, priority, depth)`** — Enqueue directories for crawling
- **`DequeueReady(limit)`** — Atomically claim pending crawl items
- **`MarkCrawlComplete/Failed(id, error)`** — Update crawl status
- **`GetCrawlStats()`** — Counts by status (pending, crawling, completed, failed)
- **`GetStats()`** — Total files and directories counts
- **`LogEvent(type, message, details)`** — Append to event log

### SQLite Configuration

- **Single connection** — no connection pool (SQLite is single-writer)
- **WAL mode** — enables concurrent reads during writes
- **Busy timeout 5s** — retries on lock contention
- **Journal mode WAL** — set via PRAGMA on open

## Mount Discovery (`mount_discovery.go`)

Discovers LucidLink filespace mount points via the CLI:

1. Run `lucid list` → parse instance IDs from output
2. For each instance: run `lucid --instance <id> status` → parse "Mount point:" line
3. Extract filespace name from the `lucid status` output ("Filespace:" line)

### Output Format Handling

`lucid list` output varies:
- Tabular: `<id>   <name>   <status>`
- Simple: one ID per line
- Regex fallback: `(\d{4,})` to find numeric instance IDs

`lucid --instance <id> status` output:
- Look for `Mount point:` line → extract path
- Look for `Filespace:` line → extract name (strip `.domain` suffix)

### Types

```go
type FilespaceMount struct {
    InstanceID string
    MountPoint string
    Name       string
}
```

## Crawler (`crawler.go`)

Background indexer that walks the filesystem and populates the database.

### Design

1. **Startup**: Enqueues all mount point root directories at priority 10
2. **Worker pool**: `CrawlWorkers` goroutines (default 16) dequeue from `crawl_queue`
3. **Per directory**: `os.ReadDir()` → parallel `os.Stat()` on entries → `BatchUpsertFiles()`
4. **Subdirectories**: Enqueued back to `crawl_queue` at `depth + 1` (skipped if `depth >= MaxDepth`)
5. **Throughput tracking**: Rolling stats on dirs/sec, files/sec, elapsed time

### Batch Processing

- Stat operations parallelized with goroutines (up to 50 concurrent)
- DB writes batched per directory (all entries from one dir in one transaction)
- Crawl rate limited by `CrawlRateMs` between dequeue cycles

### macOS-Specific

File creation time uses `stat.Ctimespec` (macOS) instead of `stat.Ctim` (Linux). This is a compile-time difference — the binary must be built on/for macOS.

## HTTP API

### REST Endpoints

| Method | Path | Handler | Description |
|--------|------|---------|-------------|
| GET | `/api/health` | inline | Returns `{"status":"ok"}` |
| GET | `/api/mounts` | inline | Returns discovered mount points as JSON |
| POST | `/api/discover` | inline | Re-runs mount discovery, re-enqueues crawl |
| GET | `/api/files` | `HandleListFiles` | Directory listing (query: `path`) |
| GET | `/api/stats` | `HandleStats` | Index statistics |
| GET | `/api/crawl/stats` | `HandleCrawlStats` | Crawl queue statistics + throughput |
| GET | `/api/events` | `HandleListEvents` | Event log entries |

### SSE Endpoints

| Method | Path | Handler | Description |
|--------|------|---------|-------------|
| GET | `/sse/search` | `HandleSSESearch` | Full-text search with streaming results |
| GET | `/sse/dir` | `HandleSSEDirectoryView` | Directory listing via SSE |
| GET | `/sse/events` | `HandleSSEEvents` | Live event stream |

### Search (`handlers_search.go`)

Two search modes executed in parallel:

1. **FTS5 Search**: Queries the SQLite FTS5 index. Fast, returns pre-indexed results.
2. **Live Search**: Runs `find <mount_prefix> -iname "*query*"` as a subprocess. Catches files not yet indexed.

Results streamed as SSE with Datastar-compatible patch format:
- `data: <html>` — Table rows (from Go templates)
- `data: data-signals-_searchCount:N` — Result count signal
- `data: data-signals-_indexedCount:N` — Total indexed files signal

### SSE Format (Datastar Patch)

All SSE responses use this format:
```
event: datastar-merge-fragments
data: selector #target-id
data: mergeMode morph
data: fragments <html content>

event: datastar-merge-signals
data: signals {key: value}
```

This allows the frontend to declaratively merge HTML fragments and update reactive signals.

## Templates (`templates/`)

Go `html/template` files rendered server-side for SSE responses:

| Template | Used By | Description |
|----------|---------|-------------|
| `file_table_rows.html` | Directory view | Table rows for file listing |
| `breadcrumbs.html` | Directory view | Navigation breadcrumb trail |
| `search_results.html` | Search (initial) | Full tbody with search results |
| `search_results_append.html` | Search (append) | Additional rows for live search results |
| `search_breadcrumbs.html` | Search | Search-mode breadcrumbs |

### Template Data Structures

```go
// Directory view
type FileEntry struct {
    ID, Name, Path, SizeDisplay, CreatedAt, ModifiedAt string
    IsDirectory bool
}

// Search results
type SearchTemplateEntry struct {
    ID, Name, Path, ParentDisplay, SizeDisplay, CreatedAt, ModifiedAt string
    IsDirectory bool
}
```

### Styling

- Folder icon stroke color: `#5E53E0` (indigo)
- File icon stroke color: `#999`
- JavaScript namespace: `fsIndex` (e.g., `fsIndex.navigate()`, `fsIndex.search()`)

## Dependencies

From `go.mod`:
- `modernc.org/sqlite` — Pure-Go SQLite driver (no CGO required, enables easy cross-compilation)

No CGO means the binary can be cross-compiled with just `GOOS`/`GOARCH` flags.

## Extension Points

### Adding a New API Endpoint

1. Add handler function in appropriate `handlers_*.go` file
2. Register route in `main.go` `setupRoutes()` section
3. If it needs DB access, add method to `db.go`

### Adding a New Indexed Field

1. Add column to `files` table in `db.go` schema
2. Update `BatchUpsertFiles()` INSERT statement
3. If searchable, add to FTS5 virtual table column list
4. Update crawler to populate the field

### Changing Mount Discovery

Edit `mount_discovery.go`:
- `discoverMounts()` — main entry point
- `parseInstanceIDs()` — parse `lucid list` output
- `getInstanceMount()` — parse `lucid --instance <id> status` output

### Adding a New Template

1. Create `.html` file in `templates/`
2. Load it in `main.go` template initialization
3. Execute it in the appropriate handler with `tmpl.ExecuteTemplate()`
