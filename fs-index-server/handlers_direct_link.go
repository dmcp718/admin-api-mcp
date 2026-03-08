package main

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
)

// HandleDirectLink proxies direct link requests to the LucidLink client API.
// GET /api/direct-link?path=/Volumes/team-us/00_Media/file.mp4
// → calls http://127.0.0.1:{port}/fsEntry/direct-link?path=00_Media/file.mp4
// → returns { "url": "https://app.lucidlink.com/l/1/..." }
func HandleDirectLink(mounts []FilespaceMount) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		absPath := r.URL.Query().Get("path")
		if absPath == "" {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "path parameter required"})
			return
		}

		// Find which mount this path belongs to (longest prefix match)
		var bestMount *FilespaceMount
		bestLen := 0
		for i, m := range mounts {
			if strings.HasPrefix(absPath, m.MountPoint) && len(m.MountPoint) > bestLen {
				bestMount = &mounts[i]
				bestLen = len(m.MountPoint)
			}
		}
		if bestMount == nil {
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "path not in any mounted filespace"})
			return
		}
		if bestMount.Port == 0 {
			writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "no port known for filespace"})
			return
		}

		// Get relative path (strip mount point)
		relPath := strings.TrimPrefix(absPath, bestMount.MountPoint)
		relPath = strings.TrimPrefix(relPath, "/")

		// Encode path for the LucidLink API URL — preserve / and common chars
		encoded := encodePathForLucid(relPath)

		apiURL := fmt.Sprintf("http://127.0.0.1:%d/fsEntry/direct-link?path=%s", bestMount.Port, encoded)
		resp, err := http.Get(apiURL)
		if err != nil {
			writeJSON(w, http.StatusBadGateway, map[string]string{"error": fmt.Sprintf("lucid API unreachable: %v", err)})
			return
		}
		defer resp.Body.Close()

		body, err := io.ReadAll(resp.Body)
		if err != nil {
			writeJSON(w, http.StatusBadGateway, map[string]string{"error": "failed to read lucid API response"})
			return
		}

		if resp.StatusCode != http.StatusOK {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(resp.StatusCode)
			w.Write(body)
			return
		}

		// Parse the LucidLink response: { "result": "https://..." }
		var lucidResp struct {
			Result string `json:"result"`
		}
		if err := json.Unmarshal(body, &lucidResp); err != nil || lucidResp.Result == "" {
			writeJSON(w, http.StatusBadGateway, map[string]string{"error": "invalid response from lucid API"})
			return
		}

		writeJSON(w, http.StatusOK, map[string]string{"url": lucidResp.Result})
	}
}

// encodePathForLucid encodes a file path for the LucidLink API, preserving
// path separators and common filename characters.
func encodePathForLucid(path string) string {
	// Encode each path segment individually to preserve /
	segments := strings.Split(path, "/")
	for i, seg := range segments {
		segments[i] = url.PathEscape(seg)
	}
	return strings.Join(segments, "/")
}
