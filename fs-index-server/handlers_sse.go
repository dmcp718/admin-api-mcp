package main

import (
	"bytes"
	"database/sql"
	"fmt"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"text/template"
	"time"
)

// SSEBroadcaster manages SSE connections (simplified — no job/cache channels)
type SSEBroadcaster struct {
	mu      sync.RWMutex
	clients map[chan SSEEvent]bool
	db      *sql.DB
	tmpl    *template.Template
}

type SSEEvent struct {
	Event string
	Data  string
}

func NewSSEBroadcaster(db *sql.DB, tmpl *template.Template) *SSEBroadcaster {
	return &SSEBroadcaster{
		clients: make(map[chan SSEEvent]bool),
		db:      db,
		tmpl:    tmpl,
	}
}

// TemplateEntry is used for rendering file table rows in templates
type TemplateEntry struct {
	ID          string
	Path        string
	Name        string
	IsDirectory bool
	Size        int64
	SizeDisplay string
	ModifiedAt  string
	CreatedAt   string
}

// HandleSSEDirectoryView streams directory table rows via SSE
func HandleSSEDirectoryView(db *sql.DB, cfg *Config, tmpl *template.Template, crawler *Crawler) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		flusher, ok := w.(http.Flusher)
		if !ok {
			http.Error(w, "streaming unsupported", http.StatusInternalServerError)
			return
		}

		dirPath := r.URL.Query().Get("path")
		if dirPath == "" {
			dirPath = cfg.MountPrefix
		}
		sortBy := r.URL.Query().Get("sortBy")
		if sortBy == "" {
			sortBy = "name"
		}
		sortDir := r.URL.Query().Get("sortDir")
		if sortDir == "" {
			sortDir = "asc"
		}
		filter := r.URL.Query().Get("filter")

		absPath, err := filepath.Abs(dirPath)
		if err != nil || !strings.HasPrefix(absPath, cfg.MountPrefix) {
			sendSSEError(w, flusher, "invalid path")
			return
		}

		entries, err := os.ReadDir(absPath)
		if err != nil {
			sendSSEError(w, flusher, fmt.Sprintf("cannot read directory: %v", err))
			return
		}

		var templateEntries []TemplateEntry

		for _, entry := range entries {
			name := entry.Name()
			if filter != "" && !strings.Contains(strings.ToLower(name), strings.ToLower(filter)) {
				continue
			}
			if strings.HasPrefix(name, ".") && r.URL.Query().Get("showHidden") != "true" {
				continue
			}

			fullPath := filepath.Join(absPath, name)
			info, err := entry.Info()
			if err != nil {
				continue
			}

			te := TemplateEntry{
				ID:          pathToID(fullPath),
				Path:        fullPath,
				Name:        name,
				IsDirectory: entry.IsDir(),
				Size:        info.Size(),
				SizeDisplay: formatSize(info.Size()),
				ModifiedAt:  info.ModTime().Format("Jan 02, 2006 15:04"),
				CreatedAt:   formatCreatedAt(getFileCreatedAt(info)),
			}

			if entry.IsDir() {
				te.SizeDisplay = ""
			}

			templateEntries = append(templateEntries, te)

			// Upsert into DB for tracking
			parentPath := absPath
			modTime := info.ModTime().UTC().Format("2006-01-02T15:04:05Z")
			createdAt := getFileCreatedAt(info)
			UpsertFile(db, &FileEntry{
				Path:        fullPath,
				Name:        name,
				ParentPath:  &parentPath,
				IsDirectory: entry.IsDir(),
				Size:        info.Size(),
				ModifiedAt:  &modTime,
				CreatedAt:   createdAt,
			})
		}

		// Sort
		sortTemplateEntries(templateEntries, sortBy, sortDir)

		// Render breadcrumbs
		breadcrumbs := buildBreadcrumbs(absPath, cfg.MountPrefix)

		w.Header().Set("Content-Type", "text/event-stream")
		w.Header().Set("Cache-Control", "no-cache")
		w.Header().Set("Connection", "keep-alive")

		var bcBuf bytes.Buffer
		if err := tmpl.ExecuteTemplate(&bcBuf, "breadcrumbs.html", breadcrumbs); err != nil {
			log.Printf("Error rendering breadcrumbs: %v", err)
		} else {
			fmt.Fprintf(w, "event: datastar-patch-elements\ndata: elements %s\n\n", oneLine(bcBuf.String()))
			flusher.Flush()
		}

		var rowsBuf bytes.Buffer
		if err := tmpl.ExecuteTemplate(&rowsBuf, "file_table_rows.html", map[string]interface{}{
			"Entries":     templateEntries,
			"CurrentPath": absPath,
			"Filter":      filter,
		}); err != nil {
			log.Printf("Error rendering table rows: %v", err)
		} else {
			fmt.Fprintf(w, "event: datastar-patch-elements\ndata: elements %s\n\n", oneLine(rowsBuf.String()))
			flusher.Flush()
		}

		fmt.Fprintf(w, "event: datastar-patch-signals\ndata: signals {_path: '%s'}\n\n", escapeJSString(absPath))
		flusher.Flush()

		if crawler != nil {
			crawler.EnqueueFromBrowse(absPath)
		}
	}
}

// Template helpers

type Breadcrumb struct {
	Name   string
	Path   string
	IsLast bool
}

func buildBreadcrumbs(absPath, mountPrefix string) []Breadcrumb {
	var crumbs []Breadcrumb
	parts := strings.Split(absPath, "/")
	for i, part := range parts {
		if part == "" {
			continue
		}
		path := strings.Join(parts[:i+1], "/")
		crumbs = append(crumbs, Breadcrumb{Name: part, Path: path})
	}
	if len(crumbs) > 0 {
		crumbs[len(crumbs)-1].IsLast = true
	}
	return crumbs
}

func sortTemplateEntries(entries []TemplateEntry, sortBy, sortDir string) {
	sort.Slice(entries, func(i, j int) bool {
		if entries[i].IsDirectory != entries[j].IsDirectory {
			return entries[i].IsDirectory
		}

		var less bool
		switch sortBy {
		case "size":
			less = entries[i].Size < entries[j].Size
		case "modified":
			less = entries[i].ModifiedAt < entries[j].ModifiedAt
		case "created":
			less = entries[i].CreatedAt < entries[j].CreatedAt
		default:
			less = strings.ToLower(entries[i].Name) < strings.ToLower(entries[j].Name)
		}

		if sortDir == "desc" {
			return !less
		}
		return less
	})
}

func formatSize(size int64) string {
	if size == 0 {
		return ""
	}
	const (
		KB = 1024
		MB = KB * 1024
		GB = MB * 1024
		TB = GB * 1024
	)
	switch {
	case size >= TB:
		return fmt.Sprintf("%.1f TB", float64(size)/float64(TB))
	case size >= GB:
		return fmt.Sprintf("%.1f GB", float64(size)/float64(GB))
	case size >= MB:
		return fmt.Sprintf("%.1f MB", float64(size)/float64(MB))
	case size >= KB:
		return fmt.Sprintf("%.1f KB", float64(size)/float64(KB))
	default:
		return fmt.Sprintf("%d B", size)
	}
}

func formatCreatedAt(iso string) string {
	if iso == "" {
		return ""
	}
	t, err := time.Parse("2006-01-02T15:04:05Z", iso)
	if err != nil {
		return iso
	}
	return t.Format("Jan 02, 2006 15:04")
}

func pathToID(path string) string {
	id := strings.ReplaceAll(path, "/", "-")
	id = strings.ReplaceAll(id, ".", "_")
	id = strings.ReplaceAll(id, " ", "_")
	return "file-" + id
}

func oneLine(s string) string {
	s = strings.ReplaceAll(s, "\n", " ")
	s = strings.ReplaceAll(s, "\r", "")
	for strings.Contains(s, "  ") {
		s = strings.ReplaceAll(s, "  ", " ")
	}
	return strings.TrimSpace(s)
}

func escapeJSString(s string) string {
	s = strings.ReplaceAll(s, `\`, `\\`)
	s = strings.ReplaceAll(s, `'`, `\'`)
	return s
}

func sendSSEError(w http.ResponseWriter, flusher http.Flusher, msg string) {
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	fmt.Fprintf(w, "event: datastar-patch-elements\ndata: elements <tbody id=\"file-rows\"><tr><td colspan=\"5\" class=\"empty-state\">%s</td></tr></tbody>\n\n", msg)
	flusher.Flush()
}
