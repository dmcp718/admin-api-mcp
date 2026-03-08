/**
 * Multi-file project generator for the LucidLink Filespace Search UI.
 * Produces a Node.js + Express app that proxies to fs-index-server
 * and provides full-text search + directory browsing across filespaces.
 *
 * Design closely follows TC Files (cockpit-tc-files-new) layout and UX,
 * adapted for standalone use with blue (#4C8BFF) accent instead of neon.
 * Excludes: pre-hydrate, jobs panel, cached column, checkboxes.
 */

export interface GeneratedProject {
  files: Record<string, string>;
  instructions: string;
}

export function generateSearchUI(port = 3099, indexerPort = 3201): GeneratedProject {
  return {
    files: {
      "package.json": generatePackageJson(),
      "server.js": generateServerJs(port, indexerPort),
      "public/index.html": generateIndexHtml(),
      "public/style.css": generateStyleCss(),
      "public/app.js": generateAppJs(indexerPort),
    },
    instructions:
      `LucidLink Filespace Search — Generated Project\n` +
      `===============================================\n\n` +
      `Setup:\n` +
      `  cd <output-directory>\n` +
      `  npm install\n` +
      `  node server.js\n\n` +
      `Then open http://localhost:${port} in your browser.\n\n` +
      `Requirements:\n` +
      `  - Node.js 18+\n` +
      `  - fs-index-server running on localhost:${indexerPort}\n` +
      `    (use the start_filespace_indexer MCP tool)\n\n` +
      `The UI provides:\n` +
      `  1. Full-text search across all indexed filespaces (FTS5)\n` +
      `  2. Filespace filter chips to narrow results\n` +
      `  3. Directory browsing with breadcrumb navigation\n` +
      `  4. Live crawl progress and index statistics\n`,
  };
}

// ── package.json ──

function generatePackageJson(): string {
  return JSON.stringify(
    {
      name: "lucidlink-filespace-search",
      version: "1.0.0",
      private: true,
      type: "module",
      scripts: {
        start: "node server.js",
      },
      dependencies: {
        express: "^4.21.0",
      },
    },
    null,
    2,
  );
}

// ── server.js ──

function generateServerJs(port: number, indexerPort: number): string {
  return `import express from "express";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { exec } from "node:child_process";
import { platform } from "node:os";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = ${port};
const INDEXER = "http://localhost:${indexerPort}";

const app = express();
app.use(express.json());

// ── Static files ──
app.use("/public", express.static(join(__dirname, "public")));
app.get("/", (_req, res) => res.sendFile(join(__dirname, "public/index.html")));

// ── Proxy JSON API to fs-index-server ──
app.all("/api/*", async (req, res) => {
  try {
    const url = INDEXER + req.originalUrl;
    const resp = await fetch(url, { method: req.method });
    const ct = resp.headers.get("content-type") || "application/json";
    const body = await resp.text();
    res.status(resp.status).set("Content-Type", ct).send(body);
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

// ── Proxy SSE search (streaming) ──
app.get("/sse/search", async (req, res) => {
  try {
    const qs = new URLSearchParams(req.query).toString();
    const url = INDEXER + "/sse/search?" + qs;
    const resp = await fetch(url);
    res.status(resp.status);
    res.set("Content-Type", "text/event-stream");
    res.set("Cache-Control", "no-cache");
    res.set("Connection", "keep-alive");
    const reader = resp.body.getReader();
    const pump = async () => {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        res.write(value);
      }
      res.end();
    };
    pump().catch(() => res.end());
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

// ── Start ──
app.listen(PORT, "127.0.0.1", () => {
  const url = "http://localhost:" + PORT;
  console.log("LucidLink Search      ->  " + url);
  console.log("Proxying to indexer   ->  " + INDEXER);
  console.log("Ctrl+C to stop\\n");
  const cmd = platform() === "darwin" ? "open" : platform() === "win32" ? "start" : "xdg-open";
  setTimeout(() => exec(cmd + " " + url), 800);
});
`;
}

// ── public/index.html ──

function generateIndexHtml(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>LucidLink Search</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500&display=swap" rel="stylesheet">
<link rel="stylesheet" href="/public/style.css">
</head>
<body>
<div class="page" id="page-root">

  <!-- Header -->
  <div class="page-header">
    <h1 class="page-title">LucidLink Search</h1>
    <div class="header-status">
      <div class="status-pill" id="status-pill">
        <span class="status-dot" id="status-dot"></span>
        <span id="status-text">connecting</span>
      </div>
      <span class="stats-text" id="stats-text"></span>
    </div>
  </div>

  <!-- Breadcrumbs -->
  <nav id="breadcrumbs" class="breadcrumbs">
    <a class="breadcrumb-link breadcrumb-home" href="#" onclick="app.navigate('/'); return false;">
      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12l9-9 9 9"/><path d="M5 10v10a1 1 0 0 0 1 1h3v-6h6v6h3a1 1 0 0 0 1-1V10"/></svg>
    </a>
  </nav>

  <!-- Toolbar -->
  <div class="toolbar">
    <input type="text"
           id="filter-input"
           class="search-input"
           placeholder="Filter files... (Enter to search all)"
           autocomplete="off" spellcheck="false">

    <div class="toolbar-actions">
      <button class="btn btn-ghost btn-sm" id="btn-refresh" title="Refresh file listing">
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="23 4 23 10 17 10"/>
          <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>
        </svg>
        Refresh
      </button>

      <label class="toggle-label">
        <input type="checkbox" id="show-hidden-toggle">
        Show hidden
      </label>

      <button class="btn btn-ghost btn-sm btn-help" id="btn-help" title="Help">
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
        Help
      </button>
    </div>
  </div>

  <!-- Filespace filter chips (shown during search) -->
  <div class="filter-chips" id="filter-chips"></div>

  <!-- File Table -->
  <div class="file-table-container">
    <table class="file-table">
      <thead>
        <tr>
          <th id="sort-name" class="sortable sorted" data-sort="name">
            Name <span id="sort-arrow-name" class="sort-arrow">&#9650;</span>
          </th>
          <th class="th-link">Direct Link</th>
          <th id="sort-size" class="sortable th-right" data-sort="size">
            Size <span id="sort-arrow-size" class="sort-arrow"></span>
          </th>
          <th id="sort-created" class="sortable th-right" data-sort="created">
            Created <span id="sort-arrow-created" class="sort-arrow"></span>
          </th>
          <th id="sort-modified" class="sortable th-right" data-sort="modified">
            Modified <span id="sort-arrow-modified" class="sort-arrow"></span>
          </th>
        </tr>
      </thead>
      <tbody id="file-rows">
        <tr>
          <td colspan="5" class="empty-state">
            <div class="loading-overlay">
              <div class="spinner"></div>
              Loading files...
            </div>
          </td>
        </tr>
      </tbody>
    </table>
  </div>

  <!-- Footer status bar -->
  <div class="status-bar" id="status-bar">
    <span id="dir-summary"></span>
    <span id="crawl-status"></span>
  </div>

  <!-- Help Modal -->
  <div id="help-modal" class="help-modal-overlay" style="display:none">
    <div class="help-modal">
      <div class="help-modal-header">
        <h2 class="help-modal-title">Search Help</h2>
        <button class="btn btn-ghost btn-sm" id="help-close">&times;</button>
      </div>
      <div class="help-modal-body">

        <section class="help-section">
          <h3>Browsing files</h3>
          <p>Navigate your LucidLink filespaces by clicking folders. Use the breadcrumb trail to go back. Click column headers to sort.</p>
          <table class="help-shortcuts">
            <tr><td><kbd>Click</kbd> folder</td><td>Open folder</td></tr>
            <tr><td><kbd>Click</kbd> row</td><td>Select row</td></tr>
            <tr><td><kbd>&#8593;</kbd> <kbd>&#8595;</kbd></td><td>Navigate rows</td></tr>
            <tr><td><kbd>Enter</kbd> on folder</td><td>Open selected folder</td></tr>
            <tr><td><kbd>Backspace</kbd></td><td>Go to parent directory</td></tr>
            <tr><td><kbd>/</kbd></td><td>Focus search input</td></tr>
            <tr><td>Show hidden</td><td>Toggle dotfile visibility</td></tr>
          </table>
        </section>

        <section class="help-section">
          <h3>Search</h3>
          <p>The filter input has two modes:</p>
          <table class="help-shortcuts">
            <tr><td><strong>Filter</strong> (type normally)</td><td>Filters the current directory as you type</td></tr>
            <tr><td><strong>Search</strong> (press <kbd>Enter</kbd>)</td><td>Searches across all indexed files</td></tr>
            <tr><td>Press <kbd>Esc</kbd></td><td>Exit search and return to browsing</td></tr>
          </table>

          <h4>How search works</h4>
          <p>Search uses SQLite FTS5 full-text indexing. Each term automatically matches prefixes, so typing <code>report</code> finds <code>report.pdf</code>, <code>reports/</code>, etc.</p>

          <h4>Search examples</h4>
          <table class="help-examples">
            <tr><td><code>report</code></td><td>Files containing "report" in name or path</td></tr>
            <tr><td><code>proj doc</code></td><td>Files matching both "proj" and "doc"</td></tr>
            <tr><td><code>jpg</code></td><td>All files with "jpg" in the name</td></tr>
            <tr><td><code>report AND final</code></td><td>Must contain both terms</td></tr>
            <tr><td><code>jpg OR png</code></td><td>Files matching either term</td></tr>
            <tr><td><code>report NOT draft</code></td><td>Exclude files with "draft"</td></tr>
            <tr><td><code>"exact phrase"</code></td><td>Match an exact phrase</td></tr>
          </table>
          <p class="help-note">Boolean operators (AND, OR, NOT) must be UPPERCASE.</p>
        </section>

      </div>
    </div>
  </div>

</div>
<script src="/public/app.js"></script>
</body>
</html>`;
}

// ── public/style.css ──

function generateStyleCss(): string {
  return `/* LucidLink Search — TC Files inspired design, blue accent */

:root {
  /* Primary */
  --color-charcoal: #151519;
  --color-accent: #4C8BFF;
  --color-white: #FFFFFF;

  /* Grays */
  --color-gray-90: #1F1F1F;
  --color-gray-80: #333333;
  --color-gray-70: #4D4D4D;
  --color-gray-60: #666666;
  --color-gray-50: #808080;
  --color-gray-40: #999999;
  --color-gray-30: #B3B3B3;
  --color-gray-20: #CCCCCC;
  --color-gray-10: #E6E6E6;

  /* Status */
  --color-success: #34d399;
  --color-error: #F8685A;
  --color-warning: #FF7E3D;

  /* Semantic */
  --color-surface: #1F1F1F;
  --color-text: #FFFFFF;
  --color-text-secondary: #999999;
  --color-text-muted: #666666;
  --color-border: #333333;

  /* Typography */
  --font-body: 'Inter', sans-serif;
  --font-mono: 'IBM Plex Mono', monospace;

  /* Spacing */
  --space-xs: 4px;
  --space-sm: 8px;
  --space-md: 16px;
  --space-lg: 24px;
  --space-xl: 32px;
  --space-2xl: 48px;

  /* Border Radius */
  --radius-sm: 4px;
  --radius-md: 8px;
  --radius-lg: 12px;
  --radius-full: 9999px;

  /* Transitions */
  --transition-fast: 150ms ease;
}

/* Reset */
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

body {
  font-family: var(--font-body);
  font-weight: 400;
  line-height: 1.4;
  background-color: var(--color-charcoal);
  color: var(--color-white);
  min-height: 100vh;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
  font-size: 14px;
}

/* Page Layout */
.page {
  display: flex;
  flex-direction: column;
  height: 100vh;
  padding: var(--space-lg);
  gap: var(--space-md);
}

/* Header */
.page-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding-bottom: var(--space-md);
  border-bottom: 1px solid var(--color-gray-80);
}

.page-title {
  font-family: var(--font-body);
  font-size: 1.5rem;
  font-weight: 700;
  color: var(--color-accent);
}

.header-status {
  display: flex;
  align-items: center;
  gap: var(--space-md);
}

.status-pill {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 0.75rem;
  font-weight: 500;
  color: var(--color-text-secondary);
  background: var(--color-gray-90);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-full);
  padding: 4px 10px;
}

.status-dot {
  width: 6px; height: 6px;
  border-radius: 50%;
  background: var(--color-text-muted);
  transition: background 0.3s, box-shadow 0.3s;
}
.status-dot.ok { background: var(--color-success); box-shadow: 0 0 6px var(--color-success); }
.status-dot.err { background: var(--color-error); }

.stats-text {
  font-size: 0.75rem;
  color: var(--color-text-secondary);
}

/* Breadcrumbs */
.breadcrumbs {
  display: flex;
  align-items: center;
  gap: var(--space-xs);
  padding: var(--space-sm) 0;
  font-size: 0.875rem;
  flex-wrap: wrap;
}

.breadcrumb-link {
  color: var(--color-gray-40);
  text-decoration: none;
  padding: 2px var(--space-xs);
  border-radius: var(--radius-sm);
  transition: all var(--transition-fast);
  cursor: pointer;
}

.breadcrumb-home {
  display: inline-flex;
  align-items: center;
}

.breadcrumb-link:hover {
  color: var(--color-accent);
  background-color: rgba(76, 139, 255, 0.08);
}

.breadcrumb-link.current {
  color: var(--color-white);
  font-weight: 500;
  cursor: default;
}
.breadcrumb-link.current:hover {
  background: none;
}

.breadcrumb-sep {
  color: var(--color-gray-60);
}

/* Toolbar */
.toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-md);
  padding: var(--space-sm) 0;
}

.search-input {
  flex: 1;
  max-width: 360px;
  padding: var(--space-sm) var(--space-md);
  font-family: var(--font-body);
  font-size: 0.875rem;
  color: var(--color-white);
  background-color: var(--color-gray-80);
  border: 1px solid var(--color-gray-70);
  border-radius: var(--radius-md);
  transition: border-color var(--transition-fast), box-shadow var(--transition-fast);
}

.search-input:focus {
  outline: none;
  border-color: var(--color-accent);
  box-shadow: 0 0 0 2px rgba(76, 139, 255, 0.2);
}

.search-input::placeholder {
  color: var(--color-gray-50);
}

.search-input.search-active {
  border-color: var(--color-accent);
  box-shadow: 0 0 0 2px rgba(76, 139, 255, 0.3);
}

.toolbar-actions {
  display: flex;
  gap: var(--space-sm);
  align-items: center;
}

/* Buttons */
.btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: var(--space-sm);
  font-family: var(--font-body);
  font-weight: 500;
  font-size: 0.875rem;
  padding: var(--space-sm) var(--space-md);
  border: none;
  border-radius: var(--radius-md);
  cursor: pointer;
  transition: all var(--transition-fast);
  white-space: nowrap;
}

.btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.btn-ghost {
  background-color: transparent;
  color: var(--color-gray-40);
}

.btn-ghost:hover:not(:disabled) {
  background-color: var(--color-gray-80);
  color: var(--color-white);
}

.btn-sm {
  padding: var(--space-xs) var(--space-sm);
  font-size: 0.75rem;
}

.btn-help svg { opacity: 0.6; }
.btn-help:hover svg { opacity: 1; }

/* Filter chips */
.filter-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.filter-chips:empty { display: none; }

.chip {
  font-family: var(--font-body);
  font-size: 0.75rem;
  font-weight: 500;
  padding: 4px 12px;
  border-radius: var(--radius-full);
  border: 1px solid var(--color-border);
  background: var(--color-surface);
  color: var(--color-text-secondary);
  cursor: pointer;
  transition: all var(--transition-fast);
  user-select: none;
}

.chip:hover {
  border-color: var(--color-gray-60);
  color: var(--color-white);
}

.chip.active {
  background: rgba(76, 139, 255, 0.10);
  border-color: var(--color-accent);
  color: var(--color-accent);
}

/* Toggle */
.toggle-label {
  display: flex;
  align-items: center;
  gap: var(--space-xs);
  font-size: 0.75rem;
  color: var(--color-gray-40);
  cursor: pointer;
}

.toggle-label input[type="checkbox"] {
  accent-color: var(--color-accent);
}

/* File Table */
.file-table-container {
  flex: 1;
  overflow: auto;
  border-radius: var(--radius-lg);
  background-color: var(--color-gray-90);
  border: 1px solid var(--color-gray-80);
}

.file-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.875rem;
}

.file-table thead {
  position: sticky;
  top: 0;
  z-index: 10;
  background-color: var(--color-gray-90);
}

.file-table th {
  padding: var(--space-sm) var(--space-md);
  text-align: left;
  font-family: var(--font-body);
  font-weight: 500;
  font-size: 0.75rem;
  color: var(--color-gray-40);
  text-transform: uppercase;
  letter-spacing: 0.05em;
  border-bottom: 1px solid var(--color-gray-80);
  cursor: pointer;
  user-select: none;
  white-space: nowrap;
}

.file-table th:hover { color: var(--color-white); }
.file-table th.sorted { color: var(--color-accent); }

.sort-arrow {
  margin-left: var(--space-xs);
  opacity: 0.5;
  font-size: 0.65rem;
}

.file-table th.sorted .sort-arrow { opacity: 1; }

.file-table td {
  padding: var(--space-sm) var(--space-md);
  border-bottom: 1px solid var(--color-gray-80);
  white-space: nowrap;
}

/* Column widths */
.col-name {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
  min-width: 200px;
}

.col-size { width: 100px; color: var(--color-text-secondary); font-family: var(--font-mono); font-size: 0.8rem; font-variant-numeric: tabular-nums; }
.col-created { width: 160px; color: var(--color-text-secondary); }
.col-modified { width: 160px; color: var(--color-text-secondary); }

.th-right, .col-size, .col-created, .col-modified { text-align: right !important; }

.file-name {
  overflow: hidden;
  text-overflow: ellipsis;
}

.file-name-text {
  display: flex;
  flex-direction: column;
  gap: 1px;
  min-width: 0;
}

.file-path {
  font-family: var(--font-mono);
  font-size: 0.7rem;
  color: var(--color-gray-50);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 400px;
}

.icon-folder, .icon-file {
  flex-shrink: 0;
}

.icon-folder { color: var(--color-accent); }
.icon-file { color: var(--color-gray-50); }

/* Row styles */
.file-row {
  transition: background-color var(--transition-fast);
  cursor: default;
}

.file-row:hover {
  background-color: rgba(255, 255, 255, 0.03);
}

.file-row.dir-row {
  cursor: pointer;
}

.file-row.dir-row:hover {
  background-color: rgba(76, 139, 255, 0.06);
}

.file-row.selected {
  background-color: rgba(76, 139, 255, 0.08);
}

.file-row.selected .file-name { color: var(--color-accent); }

/* Folder size loading */
.size-loading {
  color: var(--color-gray-50);
  font-style: italic;
}

/* Empty / loading states */
.empty-state {
  text-align: center;
  color: var(--color-text-muted);
  padding: var(--space-2xl) !important;
}

.loading-overlay {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: var(--space-2xl);
  color: var(--color-text-muted);
  gap: var(--space-sm);
}

.empty-state-container {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
}

.empty-state-card {
  text-align: center;
  padding: var(--space-2xl);
  max-width: 400px;
}

.empty-state-icon {
  color: var(--color-gray-50);
  margin-bottom: var(--space-lg);
}

.empty-state-title {
  font-size: 1.25rem;
  font-weight: 700;
  color: var(--color-white);
  margin-bottom: var(--space-sm);
}

.empty-state-desc {
  font-size: 0.875rem;
  color: var(--color-text-secondary);
}

/* Spinner */
.spinner {
  width: 16px;
  height: 16px;
  border: 2px solid var(--color-gray-60);
  border-top-color: var(--color-accent);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

@keyframes spin { to { transform: rotate(360deg); } }

/* Status bar (footer) */
.status-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--space-sm) 0;
  border-top: 1px solid var(--color-gray-80);
  font-size: 0.75rem;
  color: var(--color-text-secondary);
}

/* Crawl progress */
.crawl-progress {
  display: inline-flex;
  align-items: center;
  gap: 8px;
}

.crawl-bar {
  width: 80px;
  height: 3px;
  background: var(--color-gray-80);
  border-radius: 2px;
  overflow: hidden;
}

.crawl-fill {
  height: 100%;
  background: var(--color-accent);
  border-radius: 2px;
  transition: width 0.5s ease;
}

/* Help modal */
.help-modal-overlay {
  position: fixed;
  top: 0; left: 0; right: 0; bottom: 0;
  background-color: rgba(0, 0, 0, 0.6);
  z-index: 1000;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: var(--space-lg);
}

.help-modal {
  background-color: var(--color-gray-90);
  border: 1px solid var(--color-gray-70);
  border-radius: var(--radius-lg);
  max-width: 640px;
  width: 100%;
  max-height: 80vh;
  display: flex;
  flex-direction: column;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5);
}

.help-modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--space-md) var(--space-lg);
  border-bottom: 1px solid var(--color-gray-80);
  flex-shrink: 0;
}

.help-modal-title {
  font-size: 1.1rem;
  font-weight: 700;
  color: var(--color-accent);
}

.help-modal-body {
  padding: var(--space-lg);
  overflow-y: auto;
  font-size: 0.85rem;
  line-height: 1.6;
  color: var(--color-gray-30);
}

.help-section { margin-bottom: var(--space-lg); }
.help-section:last-child { margin-bottom: 0; }

.help-section h3 {
  font-size: 0.95rem;
  font-weight: 700;
  color: var(--color-white);
  margin-bottom: var(--space-sm);
  padding-bottom: var(--space-xs);
  border-bottom: 1px solid var(--color-gray-80);
}

.help-section h4 {
  font-size: 0.85rem;
  font-weight: 600;
  color: var(--color-gray-20);
  margin-top: var(--space-md);
  margin-bottom: var(--space-xs);
}

.help-section p { margin-bottom: var(--space-sm); }

.help-shortcuts, .help-examples {
  width: 100%;
  border-collapse: collapse;
  margin-bottom: var(--space-sm);
}

.help-shortcuts td, .help-examples td {
  padding: var(--space-xs) var(--space-sm);
  border-bottom: 1px solid var(--color-gray-80);
  vertical-align: top;
}

.help-shortcuts td:first-child { white-space: nowrap; color: var(--color-gray-20); width: 40%; }
.help-shortcuts td:last-child { color: var(--color-gray-40); }
.help-examples td:first-child { white-space: nowrap; width: 40%; }
.help-examples td:last-child { color: var(--color-gray-40); }

.help-section code {
  background-color: var(--color-gray-80);
  color: var(--color-accent);
  padding: 1px 6px;
  border-radius: var(--radius-sm);
  font-family: var(--font-mono);
  font-size: 0.8rem;
}

.help-section kbd {
  background-color: var(--color-gray-80);
  border: 1px solid var(--color-gray-60);
  color: var(--color-white);
  padding: 1px 6px;
  border-radius: var(--radius-sm);
  font-family: var(--font-body);
  font-size: 0.75rem;
}

.help-note {
  font-size: 0.8rem;
  color: var(--color-gray-50);
  font-style: italic;
}

/* Responsive */
@media (max-width: 700px) {
  .col-created, .th-created,
  .col-modified, .th-modified { display: none; }
  .page-title { font-size: 1.1rem; }
  .page { padding: var(--space-md); }
}
@media (max-width: 500px) {
  .col-size, .th-size { display: none; }
}

/* Direct Link column */
.th-link { width: 120px; text-align: center !important; cursor: default !important; }
.th-link:hover { color: var(--color-gray-40) !important; }
.col-link { width: 120px; text-align: center; white-space: nowrap; }

.link-btn {
  font-family: var(--font-body);
  font-size: 0.7rem;
  font-weight: 500;
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
.link-btn.success { border-color: var(--color-success); color: var(--color-success); }
.link-btn.fail { border-color: var(--color-error); color: var(--color-error); }

.copy-btn {
  font-size: 0.7rem;
  padding: 2px 4px;
  margin-left: 4px;
  border-radius: var(--radius-sm);
  border: 1px solid var(--color-gray-60);
  background: transparent;
  color: var(--color-gray-40);
  cursor: pointer;
  transition: all var(--transition-fast);
}
.copy-btn:hover { border-color: var(--color-accent); color: var(--color-accent); }
.copy-btn.loading { opacity: 0.5; pointer-events: none; }
.copy-btn.copied { border-color: var(--color-success); color: var(--color-success); }`;
}

// ── public/app.js ──

function generateAppJs(indexerPort: number): string {
  return `"use strict";

// ── SVG Icons ──
var ICON_DIR = '<svg class="icon-folder" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>';
var ICON_FILE = '<svg class="icon-file" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"/><polyline points="14 2 14 8 20 8"/></svg>';

// ── State ──
var currentPath = "";
var browseHistory = [];
var sortBy = "name";
var sortDir = "asc";
var filter = "";
var showHidden = false;
var searchMode = false;
var searchQuery = "";
var selectedIdx = -1;
var filespaces = [];
var activeFs = null; // null = all
var mountPrefix = "";
var folderSizeQueue = [];
var folderSizeActive = 0;
var FOLDER_SIZE_MAX = 3;
var filterTimer = null;
var currentEntries = [];

var $ = function (id) { return document.getElementById(id); };
var h = function (s) { return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); };

// ── Init ──
document.addEventListener("DOMContentLoaded", function () {
  var input = $("filter-input");
  input.addEventListener("input", onFilterInput);
  input.addEventListener("keydown", onFilterKeydown);
  $("btn-refresh").addEventListener("click", refresh);
  $("show-hidden-toggle").addEventListener("change", onShowHiddenChange);
  $("btn-help").addEventListener("click", toggleHelp);
  $("help-close").addEventListener("click", toggleHelp);
  $("help-modal").addEventListener("click", function (e) {
    if (e.target === $("help-modal")) toggleHelp();
  });

  // Sort headers
  document.querySelectorAll(".file-table th[data-sort]").forEach(function (th) {
    th.addEventListener("click", function () { sort(th.dataset.sort); });
  });

  // Keyboard navigation
  document.addEventListener("keydown", onGlobalKeydown);

  // Start
  checkHealth().then(function (ok) {
    loadFilespaces();
    loadStats();
    setInterval(loadStats, 5000);
    if (ok) autoBrowse();
  });
});

// ── Health check ──
function checkHealth() {
  return fetch("/api/health")
    .then(function (r) {
      if (r.ok) {
        $("status-dot").className = "status-dot ok";
        $("status-text").textContent = "connected";
        return true;
      }
      throw new Error();
    })
    .catch(function () {
      $("status-dot").className = "status-dot err";
      $("status-text").textContent = "disconnected";
      return false;
    });
}

// ── Auto-browse root on startup ──
// Mounts may be at different paths (e.g. /Volumes/lucid-demo/connect-us and /Volumes/team-us).
// We build a virtual "home" view from /api/mounts so all filespaces appear.
var allMounts = []; // [{ name, mountPoint }]

function autoBrowse() {
  // Get active mounts from /api/mounts and show all filespaces
  fetch("/api/mounts")
    .then(function (r) { return r.json(); })
    .then(function (data) {
      var mounts = Array.isArray(data) ? data : [];
      allMounts = mounts
        .map(function (m) {
          var parts = (m.MountPoint || "").split("/");
          return { name: parts[parts.length - 1], mountPoint: m.MountPoint };
        })
        .filter(function (m) { return m.name; });

      if (allMounts.length === 0) {
        renderEmpty("No filespaces mounted");
        return;
      }
      if (allMounts.length === 1) {
        navigate(allMounts[0].mountPoint);
      } else {
        showHome();
      }
    })
    .catch(function () {
      renderEmpty("Cannot reach indexer");
    });
}

function showHome() {
  currentPath = "";
  selectedIdx = -1;
  updateBreadcrumbs("");
  $("dir-summary").textContent = allMounts.length + " filespace" + (allMounts.length !== 1 ? "s" : "");

  var html = "";
  for (var i = 0; i < allMounts.length; i++) {
    var m = allMounts[i];
    html += '<tr class="file-row dir-row" data-path="' + h(m.mountPoint) + '" data-idx="' + i + '">' +
      '<td><div class="col-name">' + ICON_DIR +
      '<span class="file-name">' + h(m.name) + '/</span>' +
      '</div></td>' +
      '<td class="col-link">' +
      '<button class="link-btn" data-path="' + h(m.mountPoint) + '" onclick="event.stopPropagation(); app.directLink(this)">direct link</button>' +
      '<button class="copy-btn" data-path="' + h(m.mountPoint) + '" onclick="event.stopPropagation(); app.copyLink(this)" title="Copy link"><svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg></button>' +
      '</td>' +
      '<td class="col-size" id="dir-size-' + i + '"><span class="size-loading">calculating\\u2026</span></td>' +
      '<td class="col-created"></td>' +
      '<td class="col-modified"></td>' +
      '</tr>';
  }
  $("file-rows").innerHTML = html;
  attachRowHandlers();
  updateSortHeaders();

  // Skip folder size calculation on home — filespace roots are too large
  for (var j = 0; j < allMounts.length; j++) {
    var cell = $("dir-size-" + j);
    if (cell) { cell.textContent = "\\u2014"; cell.classList.remove("size-loading"); }
  }
}

// ── Navigation ──
function navigate(dirPath) {
  if (!dirPath || dirPath === "/") {
    if (allMounts.length > 1) { showHome(); return; }
  }
  if (searchMode) exitSearchMode(true);
  currentPath = dirPath;
  selectedIdx = -1;
  showLoading();
  updateBreadcrumbs(dirPath);
  fetchDirectory(dirPath);
}

function goBack() {
  if (browseHistory.length > 0) {
    navigate(browseHistory.pop());
  } else if (currentPath) {
    // Check if we're at a filespace root — go to home
    var isRoot = allMounts.some(function (m) { return m.mountPoint === currentPath; });
    if (isRoot && allMounts.length > 1) {
      showHome();
      return;
    }
    var parent = currentPath.replace(/\\/[^\\/]+\\/?$/, "");
    if (parent && parent !== currentPath) navigate(parent);
  }
}

function fetchDirectory(dirPath) {
  var params = "path=" + encodeURIComponent(dirPath);
  fetch("/api/files?" + params)
    .then(function (r) {
      if (!r.ok) throw new Error("HTTP " + r.status);
      return r.json();
    })
    .then(function (data) {
      if (!data.entries || data.entries.length === 0) {
        renderEmpty("Empty directory");
        return;
      }
      var entries = data.entries;

      // Filter hidden
      if (!showHidden) {
        entries = entries.filter(function (e) { return !e.name.startsWith("."); });
      }

      // Filter by text
      if (filter) {
        var lower = filter.toLowerCase();
        entries = entries.filter(function (e) { return e.name.toLowerCase().indexOf(lower) !== -1; });
      }

      currentEntries = entries;
      sortEntries();
      renderDirectoryTable();
    })
    .catch(function (err) {
      renderEmpty(err.message);
    });
}

// ── Sort ──
function sort(field) {
  if (sortBy === field) {
    sortDir = sortDir === "asc" ? "desc" : "asc";
  } else {
    sortBy = field;
    sortDir = "asc";
  }
  updateSortHeaders();

  if (searchMode) {
    sortEntries();
    renderSearchTable();
  } else if (currentEntries.length > 0) {
    sortEntries();
    renderDirectoryTable();
  }
}

function sortEntries() {
  currentEntries.sort(function (a, b) {
    // Dirs first (unless in search mode)
    if (!searchMode) {
      var da = a.is_directory ? 0 : 1;
      var db = b.is_directory ? 0 : 1;
      if (da !== db) return da - db;
    }

    var va, vb;
    if (sortBy === "size") {
      va = a.size || 0;
      vb = b.size || 0;
      return sortDir === "asc" ? va - vb : vb - va;
    }
    if (sortBy === "created") {
      va = a.created_at || "";
      vb = b.created_at || "";
      return sortDir === "asc" ? va.localeCompare(vb) : vb.localeCompare(va);
    }
    if (sortBy === "modified") {
      va = a.modified_at || "";
      vb = b.modified_at || "";
      return sortDir === "asc" ? va.localeCompare(vb) : vb.localeCompare(va);
    }
    // name
    va = a.name || "";
    vb = b.name || "";
    return sortDir === "asc"
      ? va.localeCompare(vb, undefined, { sensitivity: "base" })
      : vb.localeCompare(va, undefined, { sensitivity: "base" });
  });
}

function updateSortHeaders() {
  var fields = ["name", "size", "created", "modified"];
  for (var i = 0; i < fields.length; i++) {
    var f = fields[i];
    var th = $("sort-" + f);
    var arrow = $("sort-arrow-" + f);
    if (th) th.classList.toggle("sorted", sortBy === f);
    if (arrow) arrow.innerHTML = sortBy === f ? (sortDir === "asc" ? "&#9650;" : "&#9660;") : "";
  }
}

// ── Render directory ──
function renderDirectoryTable() {
  var dirs = currentEntries.filter(function (e) { return e.is_directory; });
  var files = currentEntries.filter(function (e) { return !e.is_directory; });
  var totalSize = files.reduce(function (s, f) { return s + (f.size || 0); }, 0);

  $("dir-summary").textContent =
    dirs.length + " folder" + (dirs.length !== 1 ? "s" : "") + ", " +
    files.length + " file" + (files.length !== 1 ? "s" : "") +
    (totalSize > 0 ? " \\u00B7 " + formatSize(totalSize) : "");

  var tbody = $("file-rows");
  var html = "";

  for (var di = 0; di < currentEntries.length; di++) {
    var e = currentEntries[di];
    var isDir = e.is_directory;
    var created = e.created_at ? formatDate(e.created_at) : "";
    var modified = e.modified_at ? formatDate(e.modified_at) : "";

    html += '<tr class="file-row' + (isDir ? " dir-row" : "") + '" data-path="' + h(e.path) + '" data-idx="' + di + '">' +
      '<td><div class="col-name">' +
      (isDir ? ICON_DIR : ICON_FILE) +
      '<span class="file-name">' + h(e.name) + (isDir ? "/" : "") + '</span>' +
      '</div></td>' +
      '<td class="col-link">' +
      '<button class="link-btn" data-path="' + h(e.path) + '" onclick="event.stopPropagation(); app.directLink(this)">direct link</button>' +
      '<button class="copy-btn" data-path="' + h(e.path) + '" onclick="event.stopPropagation(); app.copyLink(this)" title="Copy link"><svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg></button>' +
      '</td>' +
      '<td class="col-size"' + (isDir ? ' id="dir-size-' + di + '"' : '') + '>' +
      (isDir ? '<span class="size-loading">calculating\\u2026</span>' : formatSize(e.size)) + '</td>' +
      '<td class="col-created">' + h(created) + '</td>' +
      '<td class="col-modified">' + h(modified) + '</td>' +
      '</tr>';
  }

  tbody.innerHTML = html;
  attachRowHandlers();
  updateSortHeaders();

  // Calculate folder sizes in background
  folderSizeQueue = [];
  folderSizeActive = 0;
  for (var i = 0; i < currentEntries.length; i++) {
    if (currentEntries[i].is_directory) {
      folderSizeQueue.push({ path: currentEntries[i].path, cellId: "dir-size-" + i });
    }
  }
  drainSizeQueue();
}

// ── Folder size calculation (recursive via API) ──
function drainSizeQueue() {
  while (folderSizeActive < FOLDER_SIZE_MAX && folderSizeQueue.length > 0) {
    var item = folderSizeQueue.shift();
    folderSizeActive++;
    calcDirSize(item.path, item.cellId);
  }
}

function calcDirSize(dirPath, cellId) {
  sumDirRecursive(dirPath)
    .then(function (total) {
      var cell = $(cellId);
      if (cell) {
        cell.textContent = total > 0 ? formatSize(total) : "\\u2014";
        cell.classList.remove("size-loading");
      }
    })
    .catch(function () {
      var cell = $(cellId);
      if (cell) {
        cell.textContent = "\\u2014";
        cell.classList.remove("size-loading");
      }
    })
    .finally(function () {
      folderSizeActive--;
      drainSizeQueue();
    });
}

// Recursively sum file sizes, with a depth limit to avoid overwhelming the API
var SIZE_MAX_DEPTH = 3;

function sumDirRecursive(dirPath, depth) {
  if (depth === undefined) depth = 0;
  if (depth >= SIZE_MAX_DEPTH) return Promise.resolve(0);

  return fetch("/api/files?path=" + encodeURIComponent(dirPath))
    .then(function (r) { return r.ok ? r.json() : { entries: [] }; })
    .then(function (data) {
      if (!data.entries) return 0;
      var total = 0;
      var subdirs = [];
      for (var i = 0; i < data.entries.length; i++) {
        var e = data.entries[i];
        if (e.is_directory) subdirs.push(e.path);
        else if (e.size > 0) total += e.size;
      }
      if (subdirs.length === 0) return total;
      return Promise.all(subdirs.map(function (p) { return sumDirRecursive(p, depth + 1); })).then(function (sizes) {
        for (var j = 0; j < sizes.length; j++) total += sizes[j];
        return total;
      });
    });
}

// ── Search ──
// debounce filter input — type to filter directory, Enter to search all
function onFilterInput() {
  if (filterTimer) clearTimeout(filterTimer);
  filterTimer = setTimeout(function () {
    var val = $("filter-input").value;
    if (searchMode) {
      if (val.length >= 2) executeSearch(val);
    } else {
      filter = val;
      if (currentPath) fetchDirectory(currentPath);
    }
  }, 300);
}

function onFilterKeydown(e) {
  if (e.key === "Enter") {
    var val = $("filter-input").value.trim();
    if (val.length >= 1) enterSearchMode(val);
    e.preventDefault();
  } else if (e.key === "Escape") {
    if (searchMode) {
      exitSearchMode(false);
      e.preventDefault();
    }
  }
}

function enterSearchMode(query) {
  searchMode = true;
  searchQuery = query;
  selectedIdx = -1;
  showLoading();
  updateSearchUI();
  executeSearch(query);
}

function exitSearchMode(silent) {
  searchMode = false;
  searchQuery = "";
  var el = $("filter-input");
  if (el) el.value = "";
  filter = "";
  updateSearchUI();
  if (!silent && currentPath) {
    fetchDirectory(currentPath);
  }
}

function updateSearchUI() {
  var input = $("filter-input");
  if (input) {
    input.classList.toggle("search-active", searchMode);
    input.placeholder = searchMode
      ? "Search all files... (Esc to exit)"
      : "Filter files... (Enter to search all)";
  }
  // Show chips only in search mode when multiple filespaces
  renderChips();
}

function executeSearch(query) {
  searchQuery = query;
  var params = new URLSearchParams({ q: query, limit: "200" });
  if (activeFs) params.set("fs", activeFs);

  fetch("/sse/search?" + params)
    .then(function (resp) { return resp.text(); })
    .then(function (text) {
      var entries = parseSSEResults(text);
      var countMatch = text.match(/_searchCount:\\s*(\\d+)/);
      var indexedMatch = text.match(/_indexedCount:\\s*(\\d+)/);
      var total = countMatch ? parseInt(countMatch[1]) : entries.length;
      var indexed = indexedMatch ? parseInt(indexedMatch[1]) : 0;

      // Filter hidden files unless showHidden is enabled
      if (!showHidden) {
        entries = entries.filter(function (e) { return !e.name.startsWith("."); });
      }

      currentEntries = entries;
      $("dir-summary").textContent = formatNum(total) + " result" + (total !== 1 ? "s" : "") +
        ' for "' + query + '"';

      if (entries.length === 0) {
        renderEmpty('No results for "' + query + '"');
        return;
      }
      sortEntries();
      renderSearchTable();
    })
    .catch(function (err) {
      renderEmpty("Search failed: " + err.message);
    });
}

function parseSSEResults(text) {
  // Parse each <tr> row individually to correctly detect directories
  var rowRegex = /<tr[^>]*data-path="([^"]+)"[^>]*>([\\s\\S]*?)<\\/tr>/g;
  var entries = [];
  var match;
  while ((match = rowRegex.exec(text)) !== null) {
    var path = match[1];
    var rowHtml = match[2];
    var name = path.split("/").pop() || path;
    var isDir = rowHtml.indexOf("icon-folder") !== -1;

    // Extract size from col-size cell
    var sizeMatch = rowHtml.match(/col-size[^>]*>([^<]*)</);
    var sizeText = sizeMatch ? sizeMatch[1].trim() : "";
    var size = parseDisplaySize(sizeText);

    // Extract dates from col-created and col-modified cells
    var cells = rowHtml.match(/col-created[^>]*>([^<]*)<|col-modified[^>]*>([^<]*)</g) || [];
    var created = "";
    var modified = "";
    for (var c = 0; c < cells.length; c++) {
      var cm = cells[c].match(/>([^<]*)/);
      var val = cm ? cm[1].trim() : "";
      if (cells[c].indexOf("col-created") !== -1) created = val;
      if (cells[c].indexOf("col-modified") !== -1) modified = val;
    }

    entries.push({
      path: path,
      name: name,
      is_directory: isDir,
      parent_path: path.substring(0, path.length - name.length),
      size: size,
      created_at: created,
      modified_at: modified
    });
  }
  return entries;
}

function parseDisplaySize(s) {
  if (!s) return 0;
  var m = s.match(/^([\\d.]+)\\s*(B|KB|MB|GB|TB)$/i);
  if (!m) return 0;
  var val = parseFloat(m[1]);
  var unit = m[2].toUpperCase();
  var mult = { B: 1, KB: 1024, MB: 1048576, GB: 1073741824, TB: 1099511627776 };
  return Math.round(val * (mult[unit] || 1));
}

function renderSearchTable() {
  var tbody = $("file-rows");
  var html = "";

  for (var i = 0; i < currentEntries.length; i++) {
    var e = currentEntries[i];
    var isDir = e.is_directory;
    var parentPath = e.parent_path || e.path.substring(0, e.path.length - (e.name || "").length);

    html += '<tr class="file-row' + (isDir ? " dir-row" : "") + '" data-path="' + h(e.path) + '" data-idx="' + i + '">' +
      '<td><div class="col-name">' +
      (isDir ? ICON_DIR : ICON_FILE) +
      '<div class="file-name-text">' +
      '<span class="file-name">' + h(e.name) + '</span>' +
      '<span class="file-path">' + h(parentPath) + '</span>' +
      '</div></div></td>' +
      '<td class="col-link">' +
      '<button class="link-btn" data-path="' + h(e.path) + '" onclick="event.stopPropagation(); app.directLink(this)">direct link</button>' +
      '<button class="copy-btn" data-path="' + h(e.path) + '" onclick="event.stopPropagation(); app.copyLink(this)" title="Copy link"><svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg></button>' +
      '</td>' +
      '<td class="col-size">' + (e.size ? formatSize(e.size) : "") + '</td>' +
      '<td class="col-created">' + (e.created_at ? h(formatDate(e.created_at)) : "") + '</td>' +
      '<td class="col-modified">' + (e.modified_at ? h(formatDate(e.modified_at)) : "") + '</td>' +
      '</tr>';
  }

  tbody.innerHTML = html;
  attachRowHandlers();
  updateSortHeaders();
}

// ── Filespace chips ──
function loadFilespaces() {
  // Derive from allMounts (already filtered to indexer's mount prefix)
  filespaces = allMounts.map(function (m) { return m.name; });
  renderChips();
}

function renderChips() {
  var el = $("filter-chips");
  if (!searchMode || filespaces.length <= 1) {
    el.innerHTML = "";
    return;
  }

  var allChip = '<span class="chip' + (activeFs === null ? " active" : "") + '" data-fs="">All filespaces</span>';
  var chips = filespaces.map(function (fs) {
    return '<span class="chip' + (activeFs === fs ? " active" : "") + '" data-fs="' + h(fs) + '">' + h(fs) + '</span>';
  });
  el.innerHTML = allChip + chips.join("");
  el.querySelectorAll(".chip").forEach(function (c) {
    c.addEventListener("click", function () {
      activeFs = c.dataset.fs || null;
      renderChips();
      if (searchQuery) executeSearch(searchQuery);
    });
  });
}

// ── Stats ──
function loadStats() {
  Promise.all([
    fetch("/api/stats").then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; }),
    fetch("/api/crawl/stats").then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; })
  ]).then(function (results) {
    var stats = results[0];
    var crawl = results[1];

    if (stats) {
      $("stats-text").textContent = formatNum(stats.total_files) + " files indexed";
    }

    if (crawl) {
      var cr = crawl.crawl || {};
      var total = cr.total || 0;
      var done = cr.completed || 0;
      var active = cr.crawling || 0;
      var pending = cr.pending || 0;

      if (active > 0 || pending > 0) {
        var pct = total > 0 ? Math.round((done / total) * 100) : 0;
        var txt = "crawling " + pct + "%";
        if (crawl.throughput && crawl.throughput.files_per_sec > 0) {
          txt += " (" + Math.round(crawl.throughput.files_per_sec) + " files/s)";
        }
        $("crawl-status").innerHTML = '<span class="crawl-progress">' + txt +
          ' <span class="crawl-bar"><span class="crawl-fill" style="width:' + pct + '%"></span></span></span>';
      } else {
        $("crawl-status").textContent = done + " dirs scanned";
      }
    }
  });
}

// ── Breadcrumbs ──
// Builds: Home / filespace-name / subfolder / ...
// The home icon always goes back to the virtual filespace list.
// Path segments above the filespace mount point are hidden.
function updateBreadcrumbs(dirPath) {
  var nav = $("breadcrumbs");
  var homeIcon = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12l9-9 9 9"/><path d="M5 10v10a1 1 0 0 0 1 1h3v-6h6v6h3a1 1 0 0 0 1-1V10"/></svg>';

  // Home link
  var html = '<a class="breadcrumb-link breadcrumb-home" href="#" onclick="app.navigate(\\'/\\'); return false;">' + homeIcon + '</a>';

  if (!dirPath) {
    nav.innerHTML = html;
    return;
  }

  // Find which mount this path belongs to
  var mount = null;
  for (var i = 0; i < allMounts.length; i++) {
    if (dirPath === allMounts[i].mountPoint || dirPath.indexOf(allMounts[i].mountPoint + "/") === 0) {
      mount = allMounts[i];
      break;
    }
  }

  if (mount) {
    // Show filespace name as first crumb
    var subPath = dirPath.substring(mount.mountPoint.length).replace(/^\\//, "");
    var subParts = subPath ? subPath.split("/").filter(Boolean) : [];

    if (subParts.length === 0) {
      // At filespace root
      html += '<span class="breadcrumb-sep">/</span>';
      html += '<span class="breadcrumb-link current">' + h(mount.name) + '</span>';
    } else {
      // Inside filespace
      html += '<span class="breadcrumb-sep">/</span>';
      html += '<a class="breadcrumb-link" href="#" data-path="' + h(mount.mountPoint) + '">' + h(mount.name) + '</a>';

      var accumulated = mount.mountPoint;
      for (var j = 0; j < subParts.length; j++) {
        accumulated += "/" + subParts[j];
        var isLast = j === subParts.length - 1;
        html += '<span class="breadcrumb-sep">/</span>';
        if (isLast) {
          html += '<span class="breadcrumb-link current">' + h(subParts[j]) + '</span>';
        } else {
          html += '<a class="breadcrumb-link" href="#" data-path="' + h(accumulated) + '">' + h(subParts[j]) + '</a>';
        }
      }
    }
  } else {
    // Unknown mount — show full path segments
    var parts = dirPath.replace(/^\\/+/, "").split("/").filter(Boolean);
    var accumulated = "";
    for (var k = 0; k < parts.length; k++) {
      accumulated += "/" + parts[k];
      var isLast = k === parts.length - 1;
      html += '<span class="breadcrumb-sep">/</span>';
      if (isLast) {
        html += '<span class="breadcrumb-link current">' + h(parts[k]) + '</span>';
      } else {
        html += '<a class="breadcrumb-link" href="#" data-path="' + h(accumulated) + '">' + h(parts[k]) + '</a>';
      }
    }
  }

  nav.innerHTML = html;
  nav.querySelectorAll("a.breadcrumb-link[data-path]").forEach(function (a) {
    a.addEventListener("click", function (e) {
      e.preventDefault();
      browseHistory.push(currentPath);
      navigate(a.dataset.path);
    });
  });
}

// ── Row handlers ──
function attachRowHandlers() {
  $("file-rows").querySelectorAll("tr.dir-row").forEach(function (row) {
    row.addEventListener("dblclick", function () {
      browseHistory.push(currentPath);
      navigate(row.dataset.path);
    });
    row.addEventListener("click", function () {
      selectRow(parseInt(row.dataset.idx));
    });
  });
  $("file-rows").querySelectorAll("tr.file-row:not(.dir-row)").forEach(function (row) {
    row.addEventListener("click", function () {
      selectRow(parseInt(row.dataset.idx));
    });
  });
}

function selectRow(idx) {
  selectedIdx = idx;
  var rows = document.querySelectorAll("#file-rows .file-row");
  rows.forEach(function (r, i) {
    r.classList.toggle("selected", i === idx);
  });
}

// ── Keyboard navigation ──
function onGlobalKeydown(e) {
  if (e.key === "/" && document.activeElement !== $("filter-input")) {
    e.preventDefault();
    $("filter-input").focus();
    return;
  }

  var rows = document.querySelectorAll("#file-rows .file-row");
  if (!rows.length) return;

  if (e.key === "ArrowDown") {
    e.preventDefault();
    selectedIdx = Math.min(selectedIdx + 1, rows.length - 1);
    selectRow(selectedIdx);
    if (rows[selectedIdx]) rows[selectedIdx].scrollIntoView({ block: "nearest" });
  } else if (e.key === "ArrowUp") {
    e.preventDefault();
    selectedIdx = Math.max(selectedIdx - 1, 0);
    selectRow(selectedIdx);
    if (rows[selectedIdx]) rows[selectedIdx].scrollIntoView({ block: "nearest" });
  } else if (e.key === "Enter" && selectedIdx >= 0 && selectedIdx < rows.length) {
    var row = rows[selectedIdx];
    if (row.classList.contains("dir-row")) {
      browseHistory.push(currentPath);
      navigate(row.dataset.path);
    }
  } else if (e.key === "Backspace" && document.activeElement !== $("filter-input")) {
    e.preventDefault();
    goBack();
  }
}

// ── Show/hide hidden files ──
function onShowHiddenChange() {
  showHidden = $("show-hidden-toggle").checked;
  if (currentPath && !searchMode) fetchDirectory(currentPath);
}

function refresh() {
  if (searchMode && searchQuery) {
    executeSearch(searchQuery);
  } else if (currentPath) {
    fetchDirectory(currentPath);
  }
}

// ── Help ──
function toggleHelp() {
  var modal = $("help-modal");
  modal.style.display = modal.style.display === "none" ? "" : "none";
}

// ── UI helpers ──
function showLoading() {
  $("file-rows").innerHTML = '<tr><td colspan="5" class="empty-state">' +
    '<div class="loading-overlay"><div class="spinner"></div>Loading...</div></td></tr>';
}

function renderEmpty(msg) {
  $("file-rows").innerHTML = '<tr><td colspan="5" class="empty-state">' + h(msg) + '</td></tr>';
}

// ── Formatters ──
function formatSize(bytes) {
  if (!bytes || bytes <= 0) return "";
  var units = ["B", "KB", "MB", "GB", "TB"];
  var idx = 0;
  var val = bytes;
  while (val >= 1024 && idx < units.length - 1) { val /= 1024; idx++; }
  return (idx === 0 ? val : val.toFixed(1)) + " " + units[idx];
}

function formatNum(n) { return (n || 0).toLocaleString(); }

function formatDate(iso) {
  try {
    var d = new Date(iso);
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  } catch (_) { return iso; }
}

// ── Direct Link ──
function directLink(btn) {
  var path = btn.dataset.path;
  btn.classList.add("loading");
  btn.textContent = "...";
  fetch("/api/direct-link?path=" + encodeURIComponent(path))
    .then(function (r) { return r.json(); })
    .then(function (data) {
      if (data.url) {
        window.open(data.url, "_blank");
        btn.classList.remove("loading");
        btn.classList.add("success");
        btn.textContent = "opened";
        setTimeout(function () { btn.classList.remove("success"); btn.textContent = "direct link"; }, 2000);
      } else {
        throw new Error(data.error || "no url");
      }
    })
    .catch(function () {
      btn.classList.remove("loading");
      btn.classList.add("fail");
      btn.textContent = "failed";
      setTimeout(function () { btn.classList.remove("fail"); btn.textContent = "direct link"; }, 2000);
    });
}

function copyLink(btn) {
  var path = btn.dataset.path;
  btn.classList.add("loading");
  var origText = btn.innerHTML;
  btn.textContent = "...";
  fetch("/api/direct-link?path=" + encodeURIComponent(path))
    .then(function (r) { return r.json(); })
    .then(function (data) {
      if (data.url) {
        return navigator.clipboard.writeText(data.url).then(function () {
          btn.classList.remove("loading");
          btn.classList.add("copied");
          btn.textContent = "copied!";
          setTimeout(function () { btn.classList.remove("copied"); btn.innerHTML = origText; }, 2000);
        });
      } else {
        throw new Error(data.error || "no url");
      }
    })
    .catch(function () {
      btn.classList.remove("loading");
      btn.textContent = "failed";
      setTimeout(function () { btn.innerHTML = origText; }, 2000);
    });
}

// ── Expose API ──
window.app = {
  navigate: navigate,
  sort: sort,
  goBack: goBack,
  toggleHelp: toggleHelp,
  directLink: directLink,
  copyLink: copyLink
};
`;
}
