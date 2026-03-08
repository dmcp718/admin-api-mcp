package main

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"text/template"

	_ "modernc.org/sqlite"
)

// commonAncestor returns the deepest common directory prefix across all mount points.
// e.g. ["/Volumes/lucid-demo/connect-us", "/Volumes/team-us"] -> "/Volumes"
func commonAncestor(mounts []FilespaceMount) string {
	if len(mounts) == 0 {
		return "/Volumes"
	}
	if len(mounts) == 1 {
		return filepath.Dir(mounts[0].MountPoint)
	}
	// Split first path into segments
	parts := strings.Split(filepath.Clean(mounts[0].MountPoint), string(filepath.Separator))
	// Narrow down by comparing with each subsequent mount
	for _, m := range mounts[1:] {
		mp := strings.Split(filepath.Clean(m.MountPoint), string(filepath.Separator))
		n := len(parts)
		if len(mp) < n {
			n = len(mp)
		}
		match := 0
		for i := 0; i < n; i++ {
			if parts[i] != mp[i] {
				break
			}
			match = i + 1
		}
		parts = parts[:match]
	}
	result := strings.Join(parts, string(filepath.Separator))
	if result == "" {
		return "/"
	}
	// On Unix, ensure it starts with /
	if !strings.HasPrefix(result, "/") {
		result = "/" + result
	}
	return result
}

func main() {
	cfg := LoadConfig()

	// Discover filespace mount points via lucid CLI
	mounts := discoverMounts(cfg.LucidBin)
	if len(mounts) == 0 {
		log.Println("Warning: no filespace mounts discovered. Index will be empty until mounts are available.")
	} else {
		log.Printf("Discovered %d filespace mount(s):", len(mounts))
		for _, m := range mounts {
			log.Printf("  %s -> %s (instance %s)", m.Name, m.MountPoint, m.InstanceID)
		}
	}

	// Set mount prefix to common ancestor of all discovered mount points
	if cfg.MountPrefix == "" && len(mounts) > 0 {
		cfg.MountPrefix = commonAncestor(mounts)
	}
	if cfg.MountPrefix == "" {
		cfg.MountPrefix = "/Volumes"
	}

	// Set DB path default based on user home
	if cfg.DBPath == "" {
		home, _ := os.UserHomeDir()
		dbDir := filepath.Join(home, ".fs-index-server")
		os.MkdirAll(dbDir, 0755)
		cfg.DBPath = filepath.Join(dbDir, "index.db")
	}

	// Ensure DB directory exists
	dbDir := filepath.Dir(cfg.DBPath)
	if err := os.MkdirAll(dbDir, 0755); err != nil {
		log.Fatalf("Create DB directory: %v", err)
	}

	db, err := InitDB(cfg.DBPath)
	if err != nil {
		log.Fatalf("Initialize database: %v", err)
	}
	defer db.Close()

	// Template functions
	funcMap := template.FuncMap{
		"formatSize": func(size int64) string {
			return formatSize(size)
		},
	}

	// Load templates
	tmpl, err := template.New("").Funcs(funcMap).ParseGlob("templates/*.html")
	if err != nil {
		// Try relative to executable
		execPath, _ := os.Executable()
		tmplDir := filepath.Join(filepath.Dir(execPath), "templates")
		tmpl, err = template.New("").Funcs(funcMap).ParseGlob(filepath.Join(tmplDir, "*.html"))
		if err != nil {
			log.Fatalf("Load templates: %v", err)
		}
	}

	// SSE broadcaster (no job/cache functionality — just directory view)
	broadcaster := NewSSEBroadcaster(db, tmpl)

	// Background crawler
	var crawler *Crawler
	if cfg.CrawlEnabled {
		crawler = NewCrawler(db, cfg, broadcaster)
		// Seed crawl queue with discovered mount points
		for _, m := range mounts {
			EnqueueCrawl(db, m.MountPoint, 0, 0)
		}
		crawler.Start()
		defer crawler.Stop()
	}

	// CORS middleware
	cors := func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Access-Control-Allow-Origin", "*")
			w.Header().Set("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS")
			w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization")
			if r.Method == "OPTIONS" {
				w.WriteHeader(http.StatusOK)
				return
			}
			next.ServeHTTP(w, r)
		})
	}

	mux := http.NewServeMux()

	// Health check
	mux.HandleFunc("/api/health", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
	})

	// File listing
	mux.HandleFunc("/api/files", func(w http.ResponseWriter, r *http.Request) {
		HandleListFiles(db, cfg)(w, r)
	})

	// Filespace list — combines discovered mounts with filesystem enumeration
	mux.HandleFunc("/api/filespaces", func(w http.ResponseWriter, r *http.Request) {
		HandleListFilespaces(cfg, mounts)(w, r)
	})

	// Direct link generation — proxies to LucidLink client API
	mux.HandleFunc("/api/direct-link", func(w http.ResponseWriter, r *http.Request) {
		HandleDirectLink(mounts)(w, r)
	})

	// Mount info — returns discovered mounts with instance details
	mux.HandleFunc("/api/mounts", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(mounts)
	})

	// Stats
	mux.HandleFunc("/api/stats", func(w http.ResponseWriter, r *http.Request) {
		HandleStats(db)(w, r)
	})

	// SSE endpoints
	mux.HandleFunc("/sse/directory-view", func(w http.ResponseWriter, r *http.Request) {
		HandleSSEDirectoryView(db, cfg, tmpl, crawler)(w, r)
	})

	// Search endpoints
	mux.HandleFunc("/sse/search", func(w http.ResponseWriter, r *http.Request) {
		HandleSSESearch(db, cfg, tmpl)(w, r)
	})
	mux.HandleFunc("/sse/search/live", func(w http.ResponseWriter, r *http.Request) {
		HandleSSELiveSearch(db, cfg, tmpl)(w, r)
	})

	// Filespace index management
	mux.HandleFunc("/api/filespaces/", func(w http.ResponseWriter, r *http.Request) {
		if strings.HasSuffix(r.URL.Path, "/index") {
			HandleClearFilespaceIndex(db, cfg)(w, r)
		} else {
			http.NotFound(w, r)
		}
	})

	// Crawl stats
	mux.HandleFunc("/api/crawl/stats", func(w http.ResponseWriter, r *http.Request) {
		HandleCrawlStats(db, crawler)(w, r)
	})

	// Event log
	mux.HandleFunc("/api/events", func(w http.ResponseWriter, r *http.Request) {
		HandleListEvents(db)(w, r)
	})
	mux.HandleFunc("/sse/events", func(w http.ResponseWriter, r *http.Request) {
		HandleSSEEvents(db)(w, r)
	})

	// Re-discover mounts
	mux.HandleFunc("/api/discover", func(w http.ResponseWriter, r *http.Request) {
		newMounts := discoverMounts(cfg.LucidBin)
		mounts = newMounts
		// Seed any new mounts into crawl queue
		for _, m := range newMounts {
			EnqueueCrawl(db, m.MountPoint, 0, 0)
		}
		writeJSON(w, http.StatusOK, map[string]interface{}{
			"mounts": newMounts,
			"count":  len(newMounts),
		})
	})

	InsertEvent(db, "system", "info", nil, fmt.Sprintf("fs-index-server started (crawl workers: %d, mounts: %d)", cfg.CrawlWorkers, len(mounts)), nil)

	addr := fmt.Sprintf(":%d", cfg.Port)
	log.Printf("fs-index-server starting on %s (mount prefix: %s, mounts: %d)", addr, cfg.MountPrefix, len(mounts))

	server := &http.Server{
		Addr:    addr,
		Handler: cors(mux),
	}

	if err := server.ListenAndServe(); err != nil {
		log.Fatalf("Server error: %v", err)
	}
}
