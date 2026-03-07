package main

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"io/fs"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"syscall"
	"time"
)

type DirectoryListing struct {
	Path    string      `json:"path"`
	Entries []FileEntry `json:"entries"`
}

func HandleListFiles(db *sql.DB, cfg *Config) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		dirPath := r.URL.Query().Get("path")
		if dirPath == "" {
			dirPath = cfg.MountPrefix
		}

		absPath, err := filepath.Abs(dirPath)
		if err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid path"})
			return
		}
		if !strings.HasPrefix(absPath, cfg.MountPrefix) {
			writeJSON(w, http.StatusForbidden, map[string]string{"error": "path outside mount prefix"})
			return
		}

		entries, err := os.ReadDir(absPath)
		if err != nil {
			writeJSON(w, http.StatusNotFound, map[string]string{"error": fmt.Sprintf("read directory: %v", err)})
			return
		}

		var fileEntries []FileEntry

		for _, entry := range entries {
			fullPath := filepath.Join(absPath, entry.Name())
			info, err := entry.Info()
			if err != nil {
				continue
			}

			fe := FileEntry{
				Path:        fullPath,
				Name:        entry.Name(),
				ParentPath:  &absPath,
				IsDirectory: entry.IsDir(),
				Size:        info.Size(),
				CreatedAt:   getFileCreatedAt(info),
			}

			modTime := info.ModTime().UTC().Format("2006-01-02T15:04:05Z")
			fe.ModifiedAt = &modTime

			if stat, ok := info.Sys().(*syscall.Stat_t); ok {
				fe.Inode = stat.Ino
			}

			if entry.IsDir() {
				fe.Size = 0
			}

			fileEntries = append(fileEntries, fe)

			UpsertFile(db, &fe)
		}

		writeJSON(w, http.StatusOK, DirectoryListing{
			Path:    absPath,
			Entries: fileEntries,
		})
	}
}

func HandleListFilespaces(cfg *Config, mounts []FilespaceMount) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var names []string
		seen := make(map[string]bool)

		// Include discovered mounts
		for _, m := range mounts {
			name := filepath.Base(m.MountPoint)
			if !seen[name] {
				names = append(names, name)
				seen[name] = true
			}
		}

		// Also enumerate filesystem for any not discovered via lucid
		entries, err := os.ReadDir(cfg.MountPrefix)
		if err == nil {
			for _, e := range entries {
				if e.IsDir() && !seen[e.Name()] {
					names = append(names, e.Name())
				}
			}
		}

		if names == nil {
			names = []string{}
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(names)
	}
}

func HandleStats(db *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		stats, err := GetStats(db)
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
			return
		}
		writeJSON(w, http.StatusOK, stats)
	}
}

func getFileCreatedAt(info fs.FileInfo) string {
	if stat, ok := info.Sys().(*syscall.Stat_t); ok {
		// macOS uses Ctimespec; Linux uses Ctim
		t := time.Unix(stat.Ctimespec.Sec, stat.Ctimespec.Nsec)
		return t.UTC().Format("2006-01-02T15:04:05Z")
	}
	return ""
}

func writeJSON(w http.ResponseWriter, status int, v interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(v)
}
