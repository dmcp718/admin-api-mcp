/**
 * Multi-file project generator for the LucidLink Filespace Search UI.
 * Produces a Node.js + Express app that proxies to fs-index-server
 * and provides full-text search + directory browsing across filespaces.
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
<div class="layout">

  <!-- Header -->
  <div class="header">
    <div class="logo-mark">
      <svg viewBox="0 0 16 16" fill="white"><circle cx="8" cy="8" r="6" stroke="white" stroke-width="1.5" fill="none"/><circle cx="8" cy="8" r="2.5" fill="white"/></svg>
    </div>
    <div class="header-text">
      <h1>LucidLink Search</h1>
      <span class="subtitle" id="subtitle">Search across filespace contents</span>
    </div>
    <div class="header-right">
      <div class="status-pill" id="status-pill">
        <div class="status-dot" id="status-dot"></div>
        <span id="status-text">connecting</span>
      </div>
    </div>
  </div>

  <!-- Search bar -->
  <div class="search-bar">
    <div class="search-input-wrap">
      <svg class="search-icon" viewBox="0 0 20 20" fill="none"><circle cx="8.5" cy="8.5" r="5.5" stroke="currentColor" stroke-width="2"/><line x1="12.5" y1="12.5" x2="17" y2="17" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
      <input id="search-input" type="text" placeholder="Search files across filespaces..." autocomplete="off" spellcheck="false">
      <kbd class="search-hint" id="search-hint">/</kbd>
    </div>
    <div class="filter-chips" id="filter-chips"></div>
  </div>

  <!-- Stats bar -->
  <div class="stats-bar" id="stats-bar">
    <span id="stat-indexed">-</span>
    <span class="stats-sep">&middot;</span>
    <span id="stat-crawl">-</span>
  </div>

  <!-- Breadcrumb (browse mode) -->
  <div class="breadcrumb-bar" id="breadcrumb-bar" style="display:none">
    <button class="btn btn-ghost btn-sm" id="btn-back">&larr; Back</button>
    <div class="breadcrumbs" id="breadcrumbs"></div>
  </div>

  <!-- Results -->
  <div class="results" id="results">
    <div class="empty-state" id="empty-state">
      <div class="empty-icon">
        <svg viewBox="0 0 48 48" fill="none"><circle cx="20" cy="20" r="14" stroke="currentColor" stroke-width="3"/><line x1="30" y1="30" x2="42" y2="42" stroke="currentColor" stroke-width="3" stroke-linecap="round"/></svg>
      </div>
      <p>Start typing to search across your filespaces</p>
    </div>
  </div>

</div>
<script src="/public/app.js"></script>
</body>
</html>`;
}

// ── public/style.css ──

function generateStyleCss(): string {
  return `:root {
  --bg: #151519;
  --surface: #1c1c22;
  --surface2: #222228;
  --border: #2a2a32;
  --border-hi: #3a3a46;
  --accent: #B0FB15;
  --accent-dim: rgba(176, 251, 21, 0.10);
  --accent-glow: rgba(176, 251, 21, 0.18);
  --indigo: #5E53E0;
  --indigo-dim: rgba(94, 83, 224, 0.12);
  --text: #ffffff;
  --text-dim: #8a8a96;
  --text-muted: #555560;
  --error: #F8685A;
  --error-dim: rgba(248, 104, 90, 0.12);
  --green: #34d399;
  --green-dim: rgba(52, 211, 153, 0.12);
  --orange: #FF7E3D;
  --orange-dim: rgba(255, 126, 61, 0.12);
  --sans: 'Inter', sans-serif;
  --mono: 'IBM Plex Mono', monospace;
  --r: 10px;
}
* { box-sizing: border-box; margin: 0; padding: 0; }
html, body { height: 100%; }
body {
  font-family: var(--sans);
  background: var(--bg);
  color: var(--text);
  font-size: 14px;
  line-height: 1.5;
}

/* Layout */
.layout {
  max-width: 900px;
  margin: 0 auto;
  padding: 0 20px;
  display: flex;
  flex-direction: column;
  min-height: 100vh;
}

/* Header */
.header {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 20px 0 16px;
  border-bottom: 1px solid var(--border);
}
.logo-mark {
  width: 34px; height: 34px;
  background: var(--accent);
  border-radius: 8px;
  display: flex; align-items: center; justify-content: center;
  box-shadow: 0 0 16px var(--accent-glow);
  flex-shrink: 0;
}
.logo-mark svg { width: 18px; height: 18px; }
.header-text h1 {
  font-size: 18px; font-weight: 700;
  letter-spacing: -0.02em;
  line-height: 1.2;
}
.subtitle {
  font-size: 12px; color: var(--text-dim);
}
.header-right {
  margin-left: auto;
  display: flex; align-items: center; gap: 10px;
}
.status-pill {
  display: flex; align-items: center; gap: 6px;
  font-size: 11px; font-weight: 500;
  color: var(--text-dim);
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 20px;
  padding: 4px 10px;
}
.status-dot {
  width: 6px; height: 6px; border-radius: 50%;
  background: var(--text-muted);
  transition: background 0.3s, box-shadow 0.3s;
}
.status-dot.ok { background: var(--green); box-shadow: 0 0 6px var(--green); }
.status-dot.err { background: var(--error); }

/* Search bar */
.search-bar {
  padding: 16px 0 8px;
}
.search-input-wrap {
  position: relative;
  display: flex;
  align-items: center;
}
.search-icon {
  position: absolute;
  left: 14px;
  width: 18px; height: 18px;
  color: var(--text-muted);
  pointer-events: none;
}
#search-input {
  width: 100%;
  padding: 12px 44px 12px 42px;
  font: inherit;
  font-size: 15px;
  background: var(--surface);
  color: var(--text);
  border: 1px solid var(--border);
  border-radius: var(--r);
  outline: none;
  transition: border-color 0.15s, box-shadow 0.15s;
}
#search-input:focus {
  border-color: var(--accent);
  box-shadow: 0 0 0 3px var(--accent-dim);
}
#search-input::placeholder { color: var(--text-muted); }
.search-hint {
  position: absolute;
  right: 12px;
  font-family: var(--mono);
  font-size: 11px;
  color: var(--text-muted);
  background: var(--surface2);
  border: 1px solid var(--border);
  border-radius: 4px;
  padding: 1px 6px;
  pointer-events: none;
}

/* Filter chips */
.filter-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  padding-top: 10px;
}
.chip {
  font-family: var(--sans);
  font-size: 12px;
  font-weight: 500;
  padding: 4px 12px;
  border-radius: 20px;
  border: 1px solid var(--border);
  background: var(--surface);
  color: var(--text-dim);
  cursor: pointer;
  transition: all 0.15s;
  user-select: none;
}
.chip:hover { border-color: var(--border-hi); color: var(--text); }
.chip.active {
  background: var(--accent-dim);
  border-color: var(--accent);
  color: var(--accent);
}

/* Stats bar */
.stats-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 0;
  font-size: 12px;
  color: var(--text-dim);
}
.stats-sep { color: var(--text-muted); }

/* Breadcrumb bar */
.breadcrumb-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 0;
  border-bottom: 1px solid var(--border);
}
.breadcrumbs {
  display: flex;
  align-items: center;
  gap: 4px;
  font-family: var(--mono);
  font-size: 12px;
  color: var(--text-dim);
  overflow-x: auto;
}
.crumb {
  cursor: pointer;
  padding: 2px 6px;
  border-radius: 4px;
  transition: background 0.1s;
  white-space: nowrap;
}
.crumb:hover { background: var(--surface2); color: var(--text); }
.crumb.current { color: var(--accent); cursor: default; }
.crumb.current:hover { background: none; }
.crumb-sep { color: var(--text-muted); }

/* Results */
.results {
  flex: 1;
  padding: 8px 0 32px;
}

/* Empty state */
.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 60px 20px;
  color: var(--text-muted);
}
.empty-icon { margin-bottom: 16px; }
.empty-icon svg { width: 48px; height: 48px; }
.empty-state p { font-size: 14px; }

/* Result rows */
.result-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 12px;
  border-bottom: 1px solid var(--border);
  transition: background 0.1s;
  cursor: default;
}
.result-row:hover { background: var(--surface); }
.result-row.dir { cursor: pointer; }
.result-row.dir:hover { background: var(--accent-dim); }

.result-icon {
  width: 20px; height: 20px;
  flex-shrink: 0;
  display: flex; align-items: center; justify-content: center;
  font-size: 15px;
}
.result-info { flex: 1; min-width: 0; }
.result-name {
  font-size: 13px; font-weight: 500;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.result-row.dir .result-name { color: var(--accent); }
.result-path {
  font-family: var(--mono);
  font-size: 11px;
  color: var(--text-dim);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  margin-top: 1px;
}
.result-meta {
  display: flex;
  gap: 16px;
  flex-shrink: 0;
}
.result-size, .result-date {
  font-size: 11px;
  color: var(--text-muted);
  white-space: nowrap;
  min-width: 60px;
  text-align: right;
}

/* Result count */
.result-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px;
  font-size: 12px;
  color: var(--text-dim);
  border-bottom: 1px solid var(--border);
}

/* Buttons */
.btn {
  display: inline-flex; align-items: center; gap: 5px;
  padding: 7px 14px;
  border-radius: 8px;
  font: inherit; font-size: 13px; font-weight: 500;
  cursor: pointer;
  border: 1px solid var(--border);
  background: var(--surface);
  color: var(--text);
  transition: background 0.15s, transform 0.1s;
}
.btn:active:not(:disabled) { transform: scale(0.98); }
.btn:hover:not(:disabled) { background: var(--surface2); }
.btn-ghost { background: transparent; border-color: transparent; }
.btn-ghost:hover:not(:disabled) { background: var(--surface); }
.btn-sm { padding: 4px 10px; font-size: 12px; }

/* Progress bar */
.crawl-progress {
  height: 3px;
  background: var(--surface2);
  border-radius: 2px;
  overflow: hidden;
  margin-top: 4px;
}
.crawl-fill {
  height: 100%;
  background: var(--accent);
  border-radius: 2px;
  transition: width 0.5s ease;
  width: 0%;
}

/* Responsive */
@media (max-width: 600px) {
  .result-meta { display: none; }
  .header-text h1 { font-size: 15px; }
}`;
}

// ── public/app.js ──

function generateAppJs(indexerPort: number): string {
  return `"use strict";

// ── State ──
const ST = {
  filespaces: [],
  activeFs: null,   // null = all
  query: "",
  browsePath: null,  // null = search mode, string = browse mode
  browseHistory: [],
};

const $ = (id) => document.getElementById(id);
const h = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// ── Init ──
window.addEventListener("DOMContentLoaded", async () => {
  $("search-input").addEventListener("input", debounce(onSearch, 300));
  $("search-input").addEventListener("keydown", (e) => {
    if (e.key === "Escape") { e.target.value = ""; onSearch(); }
  });
  $("btn-back").addEventListener("click", goBack);

  // "/" shortcut to focus search
  document.addEventListener("keydown", (e) => {
    if (e.key === "/" && document.activeElement !== $("search-input")) {
      e.preventDefault();
      $("search-input").focus();
    }
  });

  await checkHealth();
  await loadFilespaces();
  await loadStats();
  // Poll crawl stats every 5s
  setInterval(loadStats, 5000);
});

// ── Health check ──
async function checkHealth() {
  try {
    const r = await fetch("/api/health");
    if (r.ok) {
      $("status-dot").className = "status-dot ok";
      $("status-text").textContent = "connected";
      return true;
    }
  } catch (_) {}
  $("status-dot").className = "status-dot err";
  $("status-text").textContent = "disconnected";
  $("subtitle").textContent = "Cannot reach indexer on port ${indexerPort}";
  return false;
}

// ── Load filespaces ──
async function loadFilespaces() {
  try {
    const r = await fetch("/api/filespaces");
    if (!r.ok) return;
    ST.filespaces = await r.json();
    renderChips();
  } catch (_) {}
}

function renderChips() {
  const el = $("filter-chips");
  if (!ST.filespaces.length) { el.innerHTML = ""; return; }

  const allChip = '<span class="chip' + (ST.activeFs === null ? " active" : "") + '" data-fs="">All filespaces</span>';
  const chips = ST.filespaces.map((fs) =>
    '<span class="chip' + (ST.activeFs === fs ? " active" : "") + '" data-fs="' + h(fs) + '">' + h(fs) + "</span>"
  );
  el.innerHTML = allChip + chips.join("");
  el.querySelectorAll(".chip").forEach((c) => {
    c.addEventListener("click", () => {
      ST.activeFs = c.dataset.fs || null;
      renderChips();
      if (ST.browsePath !== null) {
        ST.browsePath = null;
        ST.browseHistory = [];
      }
      onSearch();
    });
  });
}

// ── Stats ──
async function loadStats() {
  try {
    const [statsR, crawlR] = await Promise.all([
      fetch("/api/stats"),
      fetch("/api/crawl/stats"),
    ]);
    if (statsR.ok) {
      const s = await statsR.json();
      $("stat-indexed").textContent = formatNum(s.total_files) + " files indexed";
    }
    if (crawlR.ok) {
      const c = await crawlR.json();
      const cr = c.crawl || {};
      const total = cr.total || 0;
      const done = cr.completed || 0;
      const active = cr.crawling || 0;
      const pending = cr.pending || 0;

      if (active > 0 || pending > 0) {
        const pct = total > 0 ? Math.round((done / total) * 100) : 0;
        let txt = "crawling " + pct + "%";
        if (c.throughput && c.throughput.files_per_sec > 0) {
          txt += " (" + Math.round(c.throughput.files_per_sec) + " files/s)";
        }
        $("stat-crawl").innerHTML = txt +
          '<div class="crawl-progress"><div class="crawl-fill" style="width:' + pct + '%"></div></div>';
      } else {
        $("stat-crawl").textContent = done + " dirs scanned";
      }
    }
  } catch (_) {
    $("stat-indexed").textContent = "indexer unavailable";
    $("stat-crawl").textContent = "";
  }
}

// ── Search ──
async function onSearch() {
  const query = $("search-input").value.trim();
  ST.query = query;

  // Switch to search mode
  ST.browsePath = null;
  $("breadcrumb-bar").style.display = "none";
  $("search-hint").style.display = query ? "none" : "";

  if (!query) {
    $("results").innerHTML =
      '<div class="empty-state" id="empty-state">' +
      '<div class="empty-icon"><svg viewBox="0 0 48 48" fill="none"><circle cx="20" cy="20" r="14" stroke="currentColor" stroke-width="3"/><line x1="30" y1="30" x2="42" y2="42" stroke="currentColor" stroke-width="3" stroke-linecap="round"/></svg></div>' +
      "<p>Start typing to search across your filespaces</p></div>";
    return;
  }

  $("results").innerHTML = '<div class="result-header"><span>Searching...</span></div>';

  try {
    const params = new URLSearchParams({ q: query, limit: "200" });
    if (ST.activeFs) params.set("fs", ST.activeFs);

    const resp = await fetch("/sse/search?" + params);
    const text = await resp.text();

    // Parse SSE response
    const pathMatches = [...text.matchAll(/data-path="([^"]+)"/g)];
    const nameMatches = [...text.matchAll(/class="file-name">([^<]+)</g)];
    const countMatch = text.match(/_searchCount:\\s*(\\d+)/);
    const indexedMatch = text.match(/_indexedCount:\\s*(\\d+)/);
    const total = countMatch ? parseInt(countMatch[1]) : pathMatches.length;
    const indexed = indexedMatch ? parseInt(indexedMatch[1]) : 0;

    if (pathMatches.length === 0) {
      $("results").innerHTML =
        '<div class="result-header"><span>No results for "' + h(query) + '"</span><span>' + formatNum(indexed) + ' files searched</span></div>';
      return;
    }

    // Build result entries with metadata
    const entries = pathMatches.map((m, i) => ({
      path: m[1],
      name: nameMatches[i] ? nameMatches[i][1] : m[1].split("/").pop(),
      isDir: text.includes('data-path="' + m[1] + '"') && text.includes("folder-icon"),
    }));

    renderSearchResults(entries, total, indexed, query);
  } catch (err) {
    $("results").innerHTML =
      '<div class="result-header"><span style="color:var(--error)">Search failed: ' + h(err.message) + "</span></div>";
  }
}

function renderSearchResults(entries, total, indexed, query) {
  let html = '<div class="result-header"><span>' + formatNum(total) + " result" + (total !== 1 ? "s" : "") +
    ' for "' + h(query) + '"</span><span>' + formatNum(indexed) + " files searched</span></div>";

  for (const entry of entries) {
    const name = entry.name;
    const path = entry.path;
    const parentPath = path.substring(0, path.length - name.length);

    html += '<div class="result-row' + (entry.isDir ? " dir" : "") + '" data-path="' + h(path) + '">' +
      '<div class="result-icon">' + (entry.isDir ? "\\uD83D\\uDCC1" : "\\uD83D\\uDCC4") + "</div>" +
      '<div class="result-info">' +
      '<div class="result-name">' + h(name) + "</div>" +
      '<div class="result-path">' + h(parentPath) + "</div>" +
      "</div></div>";
  }

  $("results").innerHTML = html;
  attachRowHandlers();
}

// ── Browse ──
async function browse(dirPath) {
  ST.browsePath = dirPath;
  $("search-input").value = "";
  $("search-hint").style.display = "";
  $("breadcrumb-bar").style.display = "flex";
  renderBreadcrumbs(dirPath);

  $("results").innerHTML = '<div class="result-header"><span>Loading...</span></div>';

  try {
    const params = new URLSearchParams({ path: dirPath });
    const resp = await fetch("/api/files?" + params);
    if (!resp.ok) throw new Error("HTTP " + resp.status);
    const data = await resp.json();

    if (!data.entries || data.entries.length === 0) {
      $("results").innerHTML = '<div class="result-header"><span>Empty directory</span></div>';
      return;
    }

    const dirs = data.entries.filter((e) => e.is_directory).sort((a, b) => a.name.localeCompare(b.name));
    const files = data.entries.filter((e) => !e.is_directory).sort((a, b) => a.name.localeCompare(b.name));

    let html = '<div class="result-header"><span>' + data.entries.length + " item" +
      (data.entries.length !== 1 ? "s" : "") + "</span></div>";

    for (const d of dirs) {
      html += '<div class="result-row dir" data-path="' + h(d.path) + '">' +
        '<div class="result-icon">\\uD83D\\uDCC1</div>' +
        '<div class="result-info"><div class="result-name">' + h(d.name) + "/</div></div></div>";
    }

    for (const f of files) {
      const mod = f.modified_at ? formatDate(f.modified_at) : "";
      html += '<div class="result-row" data-path="' + h(f.path) + '">' +
        '<div class="result-icon">\\uD83D\\uDCC4</div>' +
        '<div class="result-info"><div class="result-name">' + h(f.name) + "</div></div>" +
        '<div class="result-meta">' +
        '<span class="result-size">' + formatSize(f.size) + "</span>" +
        '<span class="result-date">' + h(mod) + "</span></div></div>";
    }

    $("results").innerHTML = html;
    attachRowHandlers();
  } catch (err) {
    $("results").innerHTML =
      '<div class="result-header"><span style="color:var(--error)">' + h(err.message) + "</span></div>";
  }
}

function renderBreadcrumbs(dirPath) {
  const parts = dirPath.replace(/^\\/+/, "").split("/").filter(Boolean);
  let html = "";
  let accumulated = "";
  for (let i = 0; i < parts.length; i++) {
    accumulated += "/" + parts[i];
    const isLast = i === parts.length - 1;
    if (i > 0) html += '<span class="crumb-sep">/</span>';
    html += '<span class="crumb' + (isLast ? " current" : "") + '" data-path="' + h(accumulated) + '">' + h(parts[i]) + "</span>";
  }
  $("breadcrumbs").innerHTML = html;
  $("breadcrumbs").querySelectorAll(".crumb:not(.current)").forEach((el) => {
    el.addEventListener("click", () => {
      ST.browseHistory.push(ST.browsePath);
      browse(el.dataset.path);
    });
  });
}

function goBack() {
  if (ST.browseHistory.length > 0) {
    browse(ST.browseHistory.pop());
  } else if (ST.browsePath) {
    const parent = ST.browsePath.replace(/\\/[^\\/]+\\/?$/, "");
    if (parent && parent !== ST.browsePath) {
      browse(parent);
    }
  }
}

function attachRowHandlers() {
  $("results").querySelectorAll(".result-row.dir").forEach((row) => {
    row.addEventListener("click", () => {
      if (ST.browsePath !== null) ST.browseHistory.push(ST.browsePath);
      browse(row.dataset.path);
    });
  });
}

// ── Helpers ──
function debounce(fn, ms) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

function formatSize(bytes) {
  if (!bytes || bytes <= 0) return "";
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1048576) return (bytes / 1024).toFixed(1) + " KB";
  if (bytes < 1073741824) return (bytes / 1048576).toFixed(1) + " MB";
  return (bytes / 1073741824).toFixed(2) + " GB";
}

function formatNum(n) {
  return (n || 0).toLocaleString();
}

function formatDate(iso) {
  try {
    const d = new Date(iso);
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  } catch (_) {
    return iso;
  }
}
`;
}
