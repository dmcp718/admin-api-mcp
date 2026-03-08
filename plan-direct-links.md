# Plan: Direct Link Column in Search UI

## Goal
Add a "DIRECT LINK" column to the file table (left of SIZE) with clickable buttons that generate LucidLink direct link HTTPS URLs and open them in the browser.

## How Direct Links Work

The LucidLink client exposes a local REST API per filespace instance:
```
GET http://127.0.0.1:{port}/fsEntry/direct-link?path={relative_path}
→ { "result": "https://app.lucidlink.com/l/1/..." }
```

- **Port** comes from `lucid list` (e.g. 9823 for connect-us, 9837 for team-us)
- **Path** is relative to the filespace mount point (e.g. `00_Media/file.mp4`, not `/Volumes/team-us/00_Media/file.mp4`)
- Works for both files AND directories
- The returned HTTPS URL opens the file/folder in the LucidLink web app

### Key data from the existing mounts API:
```json
[
  { "InstanceID": "2045", "MountPoint": "/Volumes/lucid-demo/connect-us", "Name": "connect-us.lucid-demo" },
  { "InstanceID": "2059", "MountPoint": "/Volumes/team-us", "Name": "team-us.lucid-demo" }
]
```
The mounts API gives us InstanceID and MountPoint but NOT the port. We need to map instance → port.

## Architecture

### Option A: Proxy through fs-index-server (recommended)
Add a `/api/direct-link` endpoint to the Go fs-index-server that:
1. Accepts `?path=/Volumes/team-us/00_Media/file.mp4`
2. Determines which filespace mount the path belongs to
3. Looks up the port for that filespace instance
4. Calls the local LucidLink API: `http://127.0.0.1:{port}/fsEntry/direct-link?path={relative_path}`
5. Returns the result to the frontend

**Advantages:**
- Frontend stays simple — just calls one endpoint
- Port discovery handled server-side
- No CORS issues (browser can't call `127.0.0.1:{port}` cross-origin)
- Works for all filespaces without frontend knowing about ports

### Option B: Proxy through Express server.js only
Add the route in the search app's Express server instead of the Go binary.

**Disadvantage:** Only available to the search app, not reusable by other tools.

### Option C: Direct from browser
Frontend calls `http://127.0.0.1:{port}/fsEntry/direct-link?path=...` directly.

**Disadvantage:** CORS will block this — the page is served from `localhost:3099`, and the LucidLink API is on a different port. Would require the LucidLink client to set CORS headers, which it likely doesn't.

**Recommendation: Option A** — add to fs-index-server so all consumers get it.

## Implementation Steps

### Step 1: Discover filespace ports in fs-index-server

The `discoverMounts()` function in `mount_discovery.go` already runs `lucid list` and parses InstanceID + MountPoint. Extend it to also parse the PORT column.

Update `FilespaceMount` struct:
```go
type FilespaceMount struct {
    InstanceID string
    MountPoint string
    Name       string
    Port       int    // NEW: from lucid list PORT column
}
```

### Step 2: Add `/api/direct-link` endpoint to fs-index-server

New handler in `handlers_files.go` (or a new `handlers_direct_link.go`):

```go
// GET /api/direct-link?path=/Volumes/team-us/00_Media/file.mp4
func HandleDirectLink(cfg *Config, mounts []FilespaceMount) http.HandlerFunc {
    return func(w http.ResponseWriter, r *http.Request) {
        absPath := r.URL.Query().Get("path")
        if absPath == "" {
            writeJSON(w, 400, map[string]string{"error": "path required"})
            return
        }

        // Find which mount this path belongs to
        var mount *FilespaceMount
        for i, m := range mounts {
            if strings.HasPrefix(absPath, m.MountPoint) {
                mount = &mounts[i]
                break
            }
        }
        if mount == nil {
            writeJSON(w, 404, map[string]string{"error": "path not in any mounted filespace"})
            return
        }

        // Get relative path
        relPath := strings.TrimPrefix(absPath, mount.MountPoint)
        relPath = strings.TrimPrefix(relPath, "/")

        // URL-encode the relative path (preserve / and common chars)
        encodedPath := url.PathEscape(relPath)  // or custom encoding

        // Call LucidLink local API
        apiURL := fmt.Sprintf("http://127.0.0.1:%d/fsEntry/direct-link?path=%s", mount.Port, encodedPath)
        resp, err := http.Get(apiURL)
        // ... handle response, return { "url": "https://app.lucidlink.com/..." }
    }
}
```

Register in `main.go`:
```go
mux.HandleFunc("/api/direct-link", func(w http.ResponseWriter, r *http.Request) {
    HandleDirectLink(cfg, mounts)(w, r)
})
```

### Step 3: Proxy the endpoint in the Express server.js

The Express app already proxies all `/api/*` routes to fs-index-server, so `/api/direct-link` will automatically be proxied. No changes needed.

### Step 4: Add "DIRECT LINK" column to the search UI

In `search-template.ts`, update the generated HTML/CSS/JS:

**HTML** — Add column header between Name and Size:
```html
<th class="th-right">Direct Link</th>
```

**CSS** — Style the column and button:
```css
.col-link { width: 100px; text-align: center; }
.link-btn {
    font-size: 0.7rem;
    padding: 2px 8px;
    border-radius: var(--radius-sm);
    border: 1px solid var(--color-accent);
    background: transparent;
    color: var(--color-accent);
    cursor: pointer;
    transition: all var(--transition-fast);
}
.link-btn:hover { background: rgba(76, 139, 255, 0.15); }
.link-btn.loading { opacity: 0.5; pointer-events: none; }
```

**JS** — Each row gets a button in the Direct Link column:
```html
<td class="col-link">
    <button class="link-btn" data-path="/Volumes/team-us/00_Media/file.mp4"
            onclick="app.directLink(this)">direct link</button>
</td>
```

The `directLink` function:
```js
function directLink(btn) {
    var path = btn.dataset.path;
    btn.classList.add("loading");
    btn.textContent = "...";
    fetch("/api/direct-link?path=" + encodeURIComponent(path))
        .then(function (r) { return r.json(); })
        .then(function (data) {
            if (data.url) {
                window.open(data.url, "_blank");
            }
            btn.classList.remove("loading");
            btn.textContent = "direct link";
        })
        .catch(function () {
            btn.classList.remove("loading");
            btn.textContent = "failed";
            setTimeout(function () { btn.textContent = "direct link"; }, 2000);
        });
}
```

### Step 5: Update tests

Update `test/ui-templates.test.ts` to verify the new column exists:
```ts
it("has direct link column", () => {
    const appJs = project.files["public/app.js"];
    assert.ok(appJs.includes("/api/direct-link"), "Should call direct link API");
    assert.ok(appJs.includes("direct link"), "Should have direct link buttons");
});
```

### Step 6: Update the mounts API response (optional)

Consider including port in the `/api/mounts` response for transparency:
```json
[
  { "InstanceID": "2045", "MountPoint": "/Volumes/lucid-demo/connect-us", "Name": "connect-us.lucid-demo", "Port": 9823 }
]
```

## URL Encoding Notes

The Python library uses a custom encoder preserving `/ [ ] ( ) , - _ . ` and spaces.
Go's `url.PathEscape` encodes spaces as `%20` but preserves `/`.
The LucidLink API seems tolerant of different encodings. Use Go's `url.QueryEscape` on the relative path but replace `%2F` back to `/` to preserve path separators.

## Path Resolution

Given a file row with `data-path="/Volumes/team-us/00_Media/stills/photo.jpg"`:
1. Frontend sends: `GET /api/direct-link?path=/Volumes/team-us/00_Media/stills/photo.jpg`
2. Express proxies to: `GET http://localhost:3201/api/direct-link?path=...`
3. Go handler matches mount: `/Volumes/team-us` → port 9837
4. Relative path: `00_Media/stills/photo.jpg`
5. Calls: `GET http://127.0.0.1:9837/fsEntry/direct-link?path=00_Media/stills/photo.jpg`
6. Returns: `{ "url": "https://app.lucidlink.com/l/1/..." }`
7. Frontend opens URL in new tab

## Files to Modify

| File | Change |
|------|--------|
| `fs-index-server/mount_discovery.go` | Parse PORT column from `lucid list` |
| `fs-index-server/main.go` | Register `/api/direct-link` handler |
| `fs-index-server/handlers_files.go` | (or new file) Add `HandleDirectLink` |
| `src/connect/search-template.ts` | Add column to HTML, CSS, JS |
| `test/ui-templates.test.ts` | Add test for direct link column |

## Design Decisions

1. **Directories**: YES — direct link buttons appear for both files and folders.
2. **Copy to clipboard**: YES — two actions per row:
   - **Click "direct link"** → opens the HTTPS URL in a new tab
   - **Click copy icon** (next to the button) → copies the URL to clipboard, shows brief "copied!" feedback
3. **Caching**: NONE — always fetch fresh on each click. Links may expire.
