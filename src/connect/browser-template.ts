/**
 * Multi-file project generator for the LucidLink Filespace Browser.
 * Produces a Node.js + Express app with a tree-based directory/file browser.
 */

export interface GeneratedProject {
  files: Record<string, string>;
  instructions: string;
}

export function generateFilespacesBrowser(port = 3099): GeneratedProject {
  return {
    files: {
      "package.json": generatePackageJson(),
      "server.js": generateServerJs(port),
      "public/index.html": generateIndexHtml(),
      "public/style.css": generateStyleCss(),
      "public/app.js": generateAppJs(),
    },
    instructions:
      "LucidLink Filespace Browser — Generated Project\n" +
      "================================================\n\n" +
      "Setup:\n" +
      "  cd <output-directory>\n" +
      "  npm install\n" +
      "  node server.js\n\n" +
      "Then open http://localhost:" + port + " in your browser.\n\n" +
      "Requirements:\n" +
      "  - Node.js 18+\n" +
      "  - LucidLink API running on localhost:3003\n\n" +
      "The UI will let you:\n" +
      "  1. Enter a bearer token to connect\n" +
      "  2. Select a filespace\n" +
      "  3. Browse the directory tree with lazy-loading\n" +
      "  4. View entry metadata in the detail panel\n",
  };
}

// ── package.json ──

function generatePackageJson(): string {
  return JSON.stringify(
    {
      name: "lucidlink-filespace-browser",
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

function generateServerJs(port: number): string {
  return 'import express from "express";\n' +
    'import { fileURLToPath } from "node:url";\n' +
    'import { dirname, join } from "node:path";\n' +
    'import { exec } from "node:child_process";\n' +
    'import { platform } from "node:os";\n' +
    "\n" +
    'const __dirname = dirname(fileURLToPath(import.meta.url));\n' +
    "const PORT = " + port + ";\n" +
    'const API_BASE = "http://localhost:3003";\n' +
    "\n" +
    "const app = express();\n" +
    "app.use(express.json());\n" +
    "\n" +
    "// ── Static files ──\n" +
    'app.use("/public", express.static(join(__dirname, "public")));\n' +
    'app.get("/", (_req, res) => res.sendFile(join(__dirname, "public/index.html")));\n' +
    "\n" +
    "// ── API proxy to LucidLink API ──\n" +
    'app.all("/api/v1/*", async (req, res) => {\n' +
    "  try {\n" +
    "    const url = API_BASE + req.originalUrl;\n" +
    "    const headers = {};\n" +
    '    if (req.headers.authorization) headers["Authorization"] = req.headers.authorization;\n' +
    '    if (req.headers["content-type"]) headers["Content-Type"] = req.headers["content-type"];\n' +
    "\n" +
    "    const opts = { method: req.method, headers };\n" +
    '    if (req.method !== "GET" && req.method !== "HEAD") {\n' +
    "      opts.body = JSON.stringify(req.body);\n" +
    "    }\n" +
    "\n" +
    "    const upstream = await fetch(url, opts);\n" +
    '    const contentType = upstream.headers.get("content-type") || "application/json";\n' +
    "    const body = await upstream.text();\n" +
    '    res.status(upstream.status).set("Content-Type", contentType).send(body);\n' +
    "  } catch (err) {\n" +
    "    res.status(502).json({ error: err.message });\n" +
    "  }\n" +
    "});\n" +
    "\n" +
    "// ── Start ──\n" +
    'app.listen(PORT, "127.0.0.1", () => {\n' +
    '  const url = "http://localhost:" + PORT;\n' +
    '  console.log("LucidLink Filespace Browser  ->  " + url);\n' +
    '  console.log("Proxying API calls           ->  " + API_BASE);\n' +
    '  console.log("Ctrl+C to stop\\n");\n' +
    '  const cmd = platform() === "darwin" ? "open" : platform() === "win32" ? "start" : "xdg-open";\n' +
    '  setTimeout(() => exec(cmd + " " + url), 800);\n' +
    "});\n";
}

// ── public/index.html ──

function generateIndexHtml(): string {
  return '<!DOCTYPE html>\n' +
    '<html lang="en">\n' +
    "<head>\n" +
    '<meta charset="UTF-8" />\n' +
    '<meta name="viewport" content="width=device-width, initial-scale=1.0" />\n' +
    "<title>LucidLink Filespace Browser</title>\n" +
    '<link rel="preconnect" href="https://fonts.googleapis.com" />\n' +
    '<link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&family=IBM+Plex+Mono:ital,wght@0,400;0,500;0,600;1,400&display=swap" rel="stylesheet" />\n' +
    '<link rel="stylesheet" href="/public/style.css" />\n' +
    "</head>\n" +
    "<body>\n" +
    '<div class="layout">\n' +
    "\n" +
    "  <!-- Topbar -->\n" +
    '  <div class="topbar" id="topbar">\n' +
    '    <div class="logo-mark">\n' +
    '      <svg viewBox="0 0 16 16" fill="white"><path d="M1 3a1 1 0 011-1h3.5l1.5 1.5H14a1 1 0 011 1v7.5a1 1 0 01-1 1H2a1 1 0 01-1-1V3z"/></svg>\n' +
    "    </div>\n" +
    '    <span class="topbar-title">Filespace Browser</span>\n' +
    '    <div class="topbar-sep"></div>\n' +
    '    <span class="topbar-fs" id="topbar-fs">&mdash;</span>\n' +
    '    <div class="topbar-right">\n' +
    '      <div class="status-pill">\n' +
    '        <div class="status-dot" id="status-dot"></div>\n' +
    '        <span id="status-text">disconnected</span>\n' +
    "      </div>\n" +
    "    </div>\n" +
    "  </div>\n" +
    "\n" +
    "  <!-- Config bar -->\n" +
    '  <div class="configbar">\n' +
    '    <div class="cfg-field">\n' +
    '      <span class="cfg-label">token</span>\n' +
    '      <input id="inp-token" type="password" placeholder="bearer token" />\n' +
    "    </div>\n" +
    '    <button class="btn btn-primary" id="btn-connect">Connect</button>\n' +
    '    <div class="cfg-field" id="fs-field" style="display:none">\n' +
    '      <span class="cfg-label">filespace</span>\n' +
    '      <select id="inp-fs" class="wide">\n' +
    '        <option value="">&mdash; select filespace &mdash;</option>\n' +
    "      </select>\n" +
    "    </div>\n" +
    '    <button class="btn btn-ghost btn-sm" id="btn-refresh" style="display:none">&#8635; Refresh</button>\n' +
    "  </div>\n" +
    "\n" +
    "  <!-- Breadcrumb -->\n" +
    '  <div class="breadcrumb-bar" id="breadcrumb">\n' +
    '    <span class="crumb current">root</span>\n' +
    "  </div>\n" +
    "\n" +
    "  <!-- Stat bar -->\n" +
    '  <div class="stat-bar" id="statbar" style="display:none">\n' +
    '    <span>entries: <b id="stat-count">0</b></span>\n' +
    '    <span>dirs: <b id="stat-dirs">0</b></span>\n' +
    '    <span>files: <b id="stat-files">0</b></span>\n' +
    '    <span>external: <b id="stat-ext">0</b></span>\n' +
    "  </div>\n" +
    "\n" +
    "  <!-- Main -->\n" +
    '  <div class="main">\n' +
    '    <div class="tree-panel" id="tree-panel">\n' +
    '      <div class="splash">\n' +
    '        <div class="splash-icon">&#128193;</div>\n' +
    "        <h3>No filespace connected</h3>\n" +
    "        <span>Enter your bearer token and click Connect</span>\n" +
    "      </div>\n" +
    "    </div>\n" +
    '    <div class="detail-panel" id="detail-panel" style="display:none">\n' +
    '      <div class="detail-header">\n' +
    "        <h3>Entry Details</h3>\n" +
    '        <button class="detail-close" id="detail-close">&#10005;</button>\n' +
    "      </div>\n" +
    '      <div class="detail-body" id="detail-body"></div>\n' +
    "    </div>\n" +
    "  </div>\n" +
    "\n" +
    "</div>\n" +
    '<script src="/public/app.js"></script>\n' +
    "</body>\n" +
    "</html>\n";
}

// ── public/style.css ──

function generateStyleCss(): string {
  return ":root {\n" +
    "  --bg: #0b0d12;\n" +
    "  --surface: #12151c;\n" +
    "  --surface2: #181b24;\n" +
    "  --surface3: #1f2332;\n" +
    "  --border: #262c3e;\n" +
    "  --border-hi: #38435f;\n" +
    "  --accent: #4d9fff;\n" +
    "  --accent2: #82c4ff;\n" +
    "  --accent-dim: rgba(77,159,255,0.10);\n" +
    "  --accent-glow: rgba(77,159,255,0.22);\n" +
    "  --text: #dde4f0;\n" +
    "  --text-dim: #7080a0;\n" +
    "  --text-muted: #404860;\n" +
    "  --green: #3ddc84;\n" +
    "  --green-dim: rgba(61,220,132,0.10);\n" +
    "  --orange: #ff9f4d;\n" +
    "  --orange-dim: rgba(255,159,77,0.10);\n" +
    "  --red: #ff6b6b;\n" +
    "  --red-dim: rgba(255,107,107,0.10);\n" +
    "  --mono: 'IBM Plex Mono', monospace;\n" +
    "  --sans: 'Inter', sans-serif;\n" +
    "}\n" +
    "* { box-sizing: border-box; margin: 0; padding: 0; }\n" +
    "html, body { height: 100%; }\n" +
    "body {\n" +
    "  font-family: var(--sans);\n" +
    "  background: var(--bg);\n" +
    "  color: var(--text);\n" +
    "  height: 100%;\n" +
    "  display: flex;\n" +
    "  flex-direction: column;\n" +
    "}\n" +
    "\n" +
    "/* Grid overlay */\n" +
    "body::before {\n" +
    "  content: '';\n" +
    "  position: fixed; inset: 0;\n" +
    "  background-image:\n" +
    "    linear-gradient(rgba(77,159,255,0.025) 1px, transparent 1px),\n" +
    "    linear-gradient(90deg, rgba(77,159,255,0.025) 1px, transparent 1px);\n" +
    "  background-size: 40px 40px;\n" +
    "  pointer-events: none; z-index: 0;\n" +
    "}\n" +
    "\n" +
    "/* Layout */\n" +
    ".layout {\n" +
    "  position: relative; z-index: 1;\n" +
    "  display: flex; flex-direction: column;\n" +
    "  height: 100%; min-height: 100vh;\n" +
    "}\n" +
    "\n" +
    "/* Topbar */\n" +
    ".topbar {\n" +
    "  display: flex; align-items: center; gap: 14px;\n" +
    "  padding: 0 24px;\n" +
    "  height: 52px;\n" +
    "  border-bottom: 1px solid var(--border);\n" +
    "  background: var(--surface);\n" +
    "  flex-shrink: 0;\n" +
    "}\n" +
    ".logo-mark {\n" +
    "  width: 28px; height: 28px;\n" +
    "  background: var(--accent);\n" +
    "  border-radius: 6px;\n" +
    "  display: flex; align-items: center; justify-content: center;\n" +
    "  box-shadow: 0 0 14px var(--accent-glow);\n" +
    "  flex-shrink: 0;\n" +
    "}\n" +
    ".logo-mark svg { width: 15px; height: 15px; }\n" +
    ".topbar-title {\n" +
    "  font-family: var(--sans);\n" +
    "  font-size: 14px; font-weight: 600;\n" +
    "  color: var(--text);\n" +
    "  letter-spacing: -0.01em;\n" +
    "}\n" +
    ".topbar-sep { width: 1px; height: 20px; background: var(--border); margin: 0 4px; }\n" +
    ".topbar-fs {\n" +
    "  font-family: var(--mono);\n" +
    "  font-size: 12px; color: var(--accent);\n" +
    "  opacity: 0.8;\n" +
    "}\n" +
    ".topbar-right {\n" +
    "  margin-left: auto;\n" +
    "  display: flex; align-items: center; gap: 10px;\n" +
    "}\n" +
    ".status-pill {\n" +
    "  display: flex; align-items: center; gap: 6px;\n" +
    "  font-family: var(--sans); font-size: 12px;\n" +
    "  color: var(--text-dim);\n" +
    "  background: var(--surface2);\n" +
    "  border: 1px solid var(--border);\n" +
    "  border-radius: 20px;\n" +
    "  padding: 3px 10px;\n" +
    "}\n" +
    ".status-dot {\n" +
    "  width: 6px; height: 6px; border-radius: 50%;\n" +
    "  background: var(--text-muted);\n" +
    "  transition: background 0.3s, box-shadow 0.3s;\n" +
    "}\n" +
    ".status-dot.ok { background: var(--green); box-shadow: 0 0 6px var(--green); }\n" +
    ".status-dot.err { background: var(--red); }\n" +
    ".status-dot.busy {\n" +
    "  background: var(--orange);\n" +
    "  animation: pulse 1s ease-in-out infinite;\n" +
    "}\n" +
    "@keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.4} }\n" +
    "\n" +
    "/* Config bar */\n" +
    ".configbar {\n" +
    "  display: flex; align-items: center; gap: 10px;\n" +
    "  padding: 10px 24px;\n" +
    "  background: var(--surface2);\n" +
    "  border-bottom: 1px solid var(--border);\n" +
    "  flex-shrink: 0;\n" +
    "}\n" +
    ".cfg-label {\n" +
    "  font-family: var(--sans); font-size: 12px; font-weight: 500;\n" +
    "  color: var(--text-muted);\n" +
    "  flex-shrink: 0;\n" +
    "}\n" +
    ".cfg-field {\n" +
    "  display: flex; align-items: center; gap: 6px;\n" +
    "  flex-shrink: 0;\n" +
    "}\n" +
    ".cfg-field input {\n" +
    "  background: var(--surface3);\n" +
    "  border: 1px solid var(--border);\n" +
    "  border-radius: 6px;\n" +
    "  padding: 6px 10px;\n" +
    "  font-family: var(--mono); font-size: 12px;\n" +
    "  color: var(--text);\n" +
    "  outline: none;\n" +
    "  transition: border-color 0.15s, box-shadow 0.15s;\n" +
    "  width: 200px;\n" +
    "}\n" +
    ".cfg-field input.wide { width: 280px; }\n" +
    ".cfg-field input:focus {\n" +
    "  border-color: var(--accent);\n" +
    "  box-shadow: 0 0 0 2px var(--accent-dim);\n" +
    "}\n" +
    ".cfg-field input::placeholder { color: var(--text-muted); }\n" +
    ".cfg-field select {\n" +
    "  background: var(--surface3);\n" +
    "  border: 1px solid var(--border);\n" +
    "  border-radius: 6px;\n" +
    "  padding: 6px 10px;\n" +
    "  font-family: var(--sans); font-size: 13px;\n" +
    "  color: var(--text);\n" +
    "  outline: none;\n" +
    "  transition: border-color 0.15s, box-shadow 0.15s;\n" +
    "  width: 240px;\n" +
    "  cursor: pointer;\n" +
    "  -webkit-appearance: none;\n" +
    "  appearance: none;\n" +
    "  background-image: url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6'%3E%3Cpath d='M0 0l5 6 5-6z' fill='%237080a0'/%3E%3C/svg%3E\");\n" +
    "  background-repeat: no-repeat;\n" +
    "  background-position: right 10px center;\n" +
    "  padding-right: 28px;\n" +
    "}\n" +
    ".cfg-field select:focus {\n" +
    "  border-color: var(--accent);\n" +
    "  box-shadow: 0 0 0 2px var(--accent-dim);\n" +
    "}\n" +
    ".cfg-field select option {\n" +
    "  background: var(--surface2);\n" +
    "  color: var(--text);\n" +
    "}\n" +
    "\n" +
    "/* Buttons */\n" +
    ".btn {\n" +
    "  display: inline-flex; align-items: center; gap: 6px;\n" +
    "  padding: 7px 14px;\n" +
    "  border: none; border-radius: 6px;\n" +
    "  font-family: var(--sans); font-size: 13px; font-weight: 500;\n" +
    "  cursor: pointer; transition: all 0.15s;\n" +
    "  white-space: nowrap; flex-shrink: 0;\n" +
    "}\n" +
    ".btn-primary { background: var(--accent); color: #080c18; }\n" +
    ".btn-primary:hover { background: var(--accent2); box-shadow: 0 0 12px var(--accent-glow); transform: translateY(-1px); }\n" +
    ".btn-primary:active { transform: none; }\n" +
    ".btn-primary:disabled { opacity: 0.35; cursor: not-allowed; transform: none; }\n" +
    ".btn-ghost { background: transparent; color: var(--text-dim); border: 1px solid var(--border); }\n" +
    ".btn-ghost:hover { border-color: var(--border-hi); color: var(--text); }\n" +
    ".btn-sm { padding: 5px 10px; font-size: 12px; }\n" +
    "\n" +
    "/* Breadcrumb */\n" +
    ".breadcrumb-bar {\n" +
    "  display: flex; align-items: center; gap: 4px;\n" +
    "  padding: 8px 24px;\n" +
    "  border-bottom: 1px solid var(--border);\n" +
    "  background: var(--surface);\n" +
    "  font-family: var(--mono); font-size: 12px;\n" +
    "  flex-shrink: 0;\n" +
    "  overflow-x: auto;\n" +
    "  min-height: 36px;\n" +
    "}\n" +
    ".crumb {\n" +
    "  color: var(--text-dim); cursor: pointer;\n" +
    "  padding: 2px 7px; border-radius: 4px;\n" +
    "  transition: all 0.12s;\n" +
    "  white-space: nowrap;\n" +
    "}\n" +
    ".crumb:hover { background: var(--surface2); color: var(--accent); }\n" +
    ".crumb.current { color: var(--text); cursor: default; }\n" +
    ".crumb-sep { color: var(--text-muted); user-select: none; padding: 0 2px; }\n" +
    "\n" +
    "/* Main content */\n" +
    ".main {\n" +
    "  flex: 1;\n" +
    "  display: flex;\n" +
    "  overflow: hidden;\n" +
    "}\n" +
    "\n" +
    "/* Tree panel */\n" +
    ".tree-panel {\n" +
    "  flex: 1;\n" +
    "  overflow-y: auto;\n" +
    "  overflow-x: hidden;\n" +
    "}\n" +
    ".tree-panel::-webkit-scrollbar { width: 5px; }\n" +
    ".tree-panel::-webkit-scrollbar-track { background: transparent; }\n" +
    ".tree-panel::-webkit-scrollbar-thumb { background: var(--border); border-radius: 3px; }\n" +
    "\n" +
    "/* Stat bar */\n" +
    ".stat-bar {\n" +
    "  display: flex; align-items: center; gap: 16px;\n" +
    "  padding: 6px 24px;\n" +
    "  background: var(--surface2);\n" +
    "  border-bottom: 1px solid var(--border);\n" +
    "  font-family: var(--sans); font-size: 12px;\n" +
    "  color: var(--text-muted);\n" +
    "  flex-shrink: 0;\n" +
    "}\n" +
    ".stat-bar span b { color: var(--text-dim); font-weight: 600; }\n" +
    "\n" +
    "/* Entry rows */\n" +
    ".entry-list { list-style: none; }\n" +
    ".entry-item { border-bottom: 1px solid rgba(38,44,62,0.6); }\n" +
    ".entry-item:last-child { border-bottom: none; }\n" +
    ".entry-row {\n" +
    "  display: flex; align-items: center; gap: 10px;\n" +
    "  padding: 8px 24px 8px;\n" +
    "  cursor: pointer; user-select: none;\n" +
    "  transition: background 0.08s;\n" +
    "  min-height: 40px;\n" +
    "}\n" +
    ".entry-row:hover { background: var(--surface2); }\n" +
    ".entry-row.selected { background: var(--accent-dim); }\n" +
    ".entry-row.selected .entry-name { color: var(--accent2); }\n" +
    ".entry-row { padding-left: calc(24px + var(--depth, 0) * 20px); }\n" +
    "\n" +
    ".expand-btn {\n" +
    "  width: 16px; height: 16px;\n" +
    "  display: flex; align-items: center; justify-content: center;\n" +
    "  flex-shrink: 0; color: var(--text-muted);\n" +
    "  transition: transform 0.18s, color 0.15s;\n" +
    "  border-radius: 3px;\n" +
    "}\n" +
    ".expand-btn:hover { color: var(--accent); }\n" +
    ".expand-btn.open { transform: rotate(90deg); }\n" +
    ".expand-btn.leaf { opacity: 0; pointer-events: none; }\n" +
    "\n" +
    ".entry-icon {\n" +
    "  width: 22px; height: 22px;\n" +
    "  display: flex; align-items: center; justify-content: center;\n" +
    "  border-radius: 5px; flex-shrink: 0;\n" +
    "  font-size: 13px;\n" +
    "}\n" +
    ".ei-folder { background: var(--accent-dim); color: var(--accent); }\n" +
    ".ei-file   { background: var(--surface3); color: var(--text-muted); }\n" +
    ".ei-ext    { background: var(--green-dim); color: var(--green); }\n" +
    "\n" +
    ".entry-name {\n" +
    "  flex: 1; font-family: var(--sans); font-size: 13px; font-weight: 400;\n" +
    "  color: var(--text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap;\n" +
    "  transition: color 0.12s;\n" +
    "}\n" +
    ".entry-badges {\n" +
    "  display: flex; align-items: center; gap: 8px; flex-shrink: 0;\n" +
    "}\n" +
    ".badge {\n" +
    "  font-family: var(--mono); font-size: 10px;\n" +
    "  padding: 1px 6px; border-radius: 3px;\n" +
    "  text-transform: uppercase; letter-spacing: 0.04em;\n" +
    "}\n" +
    ".badge-folder { background: var(--accent-dim); color: var(--accent); }\n" +
    ".badge-file   { background: var(--surface3); color: var(--text-muted); }\n" +
    ".badge-ext    { background: var(--green-dim); color: var(--green); }\n" +
    ".entry-size {\n" +
    "  font-family: var(--mono); font-size: 11px;\n" +
    "  color: var(--text-muted); width: 64px; text-align: right;\n" +
    "  flex-shrink: 0;\n" +
    "}\n" +
    "\n" +
    "/* Children container */\n" +
    ".children-block {\n" +
    "  overflow: hidden;\n" +
    "  animation: expandIn 0.16s ease-out;\n" +
    "}\n" +
    "@keyframes expandIn {\n" +
    "  from { opacity: 0; max-height: 0; }\n" +
    "  to   { opacity: 1; max-height: 9999px; }\n" +
    "}\n" +
    "\n" +
    "/* State rows */\n" +
    ".state-row {\n" +
    "  display: flex; align-items: center; justify-content: center; gap: 8px;\n" +
    "  padding: 20px; font-family: var(--sans); font-size: 12px;\n" +
    "  color: var(--text-muted);\n" +
    "}\n" +
    ".state-row.err { color: var(--red); }\n" +
    ".spinner {\n" +
    "  width: 14px; height: 14px;\n" +
    "  border: 2px solid var(--border);\n" +
    "  border-top-color: var(--accent);\n" +
    "  border-radius: 50%;\n" +
    "  animation: spin 0.65s linear infinite;\n" +
    "  flex-shrink: 0;\n" +
    "}\n" +
    "@keyframes spin { to { transform: rotate(360deg); } }\n" +
    ".load-more-row {\n" +
    "  display: flex; align-items: center; justify-content: center; gap: 8px;\n" +
    "  padding: 10px;\n" +
    "  border-top: 1px dashed var(--border);\n" +
    "}\n" +
    ".load-more-count {\n" +
    "  font-family: var(--sans); font-size: 11px; color: var(--text-muted);\n" +
    "}\n" +
    "\n" +
    "/* Detail panel */\n" +
    ".detail-panel {\n" +
    "  width: 280px; flex-shrink: 0;\n" +
    "  background: var(--surface);\n" +
    "  border-left: 1px solid var(--border);\n" +
    "  overflow-y: auto;\n" +
    "  display: flex; flex-direction: column;\n" +
    "}\n" +
    ".detail-panel::-webkit-scrollbar { width: 4px; }\n" +
    ".detail-panel::-webkit-scrollbar-thumb { background: var(--border); border-radius: 2px; }\n" +
    ".detail-header {\n" +
    "  padding: 14px 18px 10px;\n" +
    "  border-bottom: 1px solid var(--border);\n" +
    "  display: flex; align-items: center; justify-content: space-between;\n" +
    "}\n" +
    ".detail-header h3 {\n" +
    "  font-family: var(--sans); font-size: 11px; font-weight: 600;\n" +
    "  color: var(--text-dim); text-transform: uppercase; letter-spacing: 0.08em;\n" +
    "}\n" +
    ".detail-close {\n" +
    "  background: none; border: none; cursor: pointer;\n" +
    "  color: var(--text-muted); font-size: 16px; line-height: 1;\n" +
    "  padding: 0 2px;\n" +
    "}\n" +
    ".detail-close:hover { color: var(--text); }\n" +
    ".detail-body { padding: 14px 18px; }\n" +
    ".detail-name {\n" +
    "  font-family: var(--sans); font-size: 14px; font-weight: 600;\n" +
    "  color: var(--text); margin-bottom: 14px;\n" +
    "  word-break: break-all; line-height: 1.4;\n" +
    "}\n" +
    ".detail-table { width: 100%; }\n" +
    ".detail-table tr td {\n" +
    "  padding: 4px 0;\n" +
    "  font-family: var(--mono); font-size: 11px;\n" +
    "  vertical-align: top;\n" +
    "}\n" +
    ".detail-table .dk { color: var(--text-muted); padding-right: 10px; white-space: nowrap; }\n" +
    ".detail-table .dv { color: var(--text-dim); word-break: break-all; }\n" +
    "\n" +
    "/* Splash */\n" +
    ".splash {\n" +
    "  display: flex; flex-direction: column; align-items: center; justify-content: center;\n" +
    "  height: 100%; gap: 12px;\n" +
    "  color: var(--text-muted); font-family: var(--sans); font-size: 13px;\n" +
    "  text-align: center; padding: 40px;\n" +
    "}\n" +
    ".splash-icon { font-size: 48px; opacity: 0.2; margin-bottom: 4px; }\n" +
    ".splash h3 { font-size: 14px; font-weight: 600; color: var(--text-dim); margin-bottom: 4px; }\n" +
    "\n" +
    "/* Error banner */\n" +
    ".error-banner {\n" +
    "  background: var(--red-dim);\n" +
    "  border: 1px solid rgba(255,107,107,0.2);\n" +
    "  border-radius: 6px;\n" +
    "  padding: 8px 14px;\n" +
    "  font-family: var(--sans); font-size: 12px;\n" +
    "  color: var(--red);\n" +
    "  margin: 12px 24px;\n" +
    "  display: flex; align-items: flex-start; gap: 8px;\n" +
    "}\n";
}

// ── public/app.js ──

function generateAppJs(): string {
  return '"use strict";\n' +
    "\n" +
    "var API = '/api/v1';\n" +
    "\n" +
    "var S = {\n" +
    "  filespaceId: localStorage.getItem('ll_fs') || '',\n" +
    "  token: localStorage.getItem('ll_tok') || '',\n" +
    "  filespaces: [],\n" +
    "  connected: false,\n" +
    "  tree: {},\n" +
    "  selectedId: null,\n" +
    "  rootEntryId: null,\n" +
    "  rootIds: [],\n" +
    "  rootCursor: null,\n" +
    "  rootHasMore: false,\n" +
    "  rootLoading: false,\n" +
    "  rootError: null,\n" +
    "};\n" +
    "\n" +
    "document.getElementById('inp-token').value = S.token;\n" +
    "\n" +
    "// -- Helpers ----------------------------------------------------------------\n" +
    "\n" +
    "function makeNode(entry, parentId) {\n" +
    "  return { entry: entry, parentId: parentId || null, children: [], loaded: false, loading: false, error: null, open: false, cursor: null, hasMore: false };\n" +
    "}\n" +
    "\n" +
    "function resetRoot() {\n" +
    "  S.tree = {};\n" +
    "  S.rootIds = [];\n" +
    "  S.rootCursor = null;\n" +
    "  S.rootHasMore = false;\n" +
    "  S.rootError = null;\n" +
    "  S.rootLoading = true;\n" +
    "  S.connected = false;\n" +
    "  S.selectedId = null;\n" +
    "}\n" +
    "\n" +
    "// -- API --------------------------------------------------------------------\n" +
    "\n" +
    "function apiGet(path) {\n" +
    "  var headers = {};\n" +
    "  if (S.token) headers['Authorization'] = 'Bearer ' + S.token;\n" +
    "  return fetch(API + path, { headers: headers }).then(function(res) {\n" +
    "    if (!res.ok) {\n" +
    "      return res.text().then(function(txt) {\n" +
    "        throw new Error('HTTP ' + res.status + ': ' + txt.slice(0, 200));\n" +
    "      });\n" +
    "    }\n" +
    "    return res.json();\n" +
    "  });\n" +
    "}\n" +
    "\n" +
    "function listFilespaces() {\n" +
    "  return apiGet('/filespaces').then(function(data) {\n" +
    "    var list = data.data || data;\n" +
    "    return Array.isArray(list) ? list : (list.filespaces || []);\n" +
    "  });\n" +
    "}\n" +
    "\n" +
    "function resolveRoot() {\n" +
    "  return apiGet('/filespaces/' + S.filespaceId + '/entries/resolve?path=%2F').then(function(data) {\n" +
    "    return (data.data || data).id;\n" +
    "  });\n" +
    "}\n" +
    "\n" +
    "function listChildren(entryId, cursor) {\n" +
    "  var params = 'limit=100';\n" +
    "  if (cursor) params += '&next_cursor=' + encodeURIComponent(cursor);\n" +
    "  return apiGet('/filespaces/' + S.filespaceId + '/entries/' + entryId + '/children?' + params).then(function(data) {\n" +
    "    var payload = data.data || data;\n" +
    "    var entries = Array.isArray(payload) ? payload : (payload.entries || payload.items || []);\n" +
    "    var nextCursor = payload.nextCursor || payload.next_cursor || null;\n" +
    "    return { entries: entries, nextCursor: nextCursor };\n" +
    "  });\n" +
    "}\n" +
    "\n" +
    "// -- Entry type / formatting ------------------------------------------------\n" +
    "\n" +
    "function eType(entry) {\n" +
    "  var t = (entry.type || entry.entryType || '').toLowerCase();\n" +
    "  if (t === 'directory' || t === 'dir' || t === 'folder') return 'folder';\n" +
    "  if (t === 'external' || entry.isExternal) return 'ext';\n" +
    "  return 'file';\n" +
    "}\n" +
    "\n" +
    "function formatBytes(b) {\n" +
    "  if (!b) return '';\n" +
    "  var k = 1024, units = ['B', 'KB', 'MB', 'GB', 'TB'];\n" +
    "  var i = Math.floor(Math.log(b) / Math.log(k));\n" +
    "  return (b / Math.pow(k, i)).toFixed(1) + ' ' + units[i];\n" +
    "}\n" +
    "\n" +
    "function esc(s) {\n" +
    "  return String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\"/g,'&quot;');\n" +
    "}\n" +
    "\n" +
    "// -- Actions ----------------------------------------------------------------\n" +
    "\n" +
    "function doConnect() {\n" +
    "  S.token = document.getElementById('inp-token').value.trim();\n" +
    "  if (!S.token) { alert('Enter a bearer token'); return; }\n" +
    "\n" +
    "  localStorage.setItem('ll_tok', S.token);\n" +
    "  setStatus('busy', 'connecting...');\n" +
    "\n" +
    "  listFilespaces().then(function(filespaces) {\n" +
    "    S.filespaces = filespaces;\n" +
    "    if (S.filespaces.length === 0) throw new Error('No filespaces found for this token');\n" +
    "\n" +
    "    var sel = document.getElementById('inp-fs');\n" +
    "    sel.innerHTML = '<option value=\"\">\\u2014 select filespace \\u2014</option>';\n" +
    "    S.filespaces.forEach(function(fs) {\n" +
    "      var opt = document.createElement('option');\n" +
    "      opt.value = fs.id;\n" +
    "      opt.textContent = fs.name || fs.id;\n" +
    "      sel.appendChild(opt);\n" +
    "    });\n" +
    "\n" +
    "    document.getElementById('fs-field').style.display = '';\n" +
    "    setStatus('ok', S.filespaces.length + ' filespace' + (S.filespaces.length !== 1 ? 's' : ''));\n" +
    "\n" +
    "    var saved = localStorage.getItem('ll_fs');\n" +
    "    if (saved && S.filespaces.some(function(f) { return f.id === saved; })) {\n" +
    "      sel.value = saved;\n" +
    "      onFilespaceSelect();\n" +
    "    }\n" +
    "  }).catch(function(err) {\n" +
    "    setStatus('err', err.message);\n" +
    "  });\n" +
    "}\n" +
    "\n" +
    "function onFilespaceSelect() {\n" +
    "  var sel = document.getElementById('inp-fs');\n" +
    "  S.filespaceId = sel.value;\n" +
    "  if (!S.filespaceId) return;\n" +
    "\n" +
    "  localStorage.setItem('ll_fs', S.filespaceId);\n" +
    "\n" +
    "  var fsName = '';\n" +
    "  for (var i = 0; i < S.filespaces.length; i++) {\n" +
    "    if (S.filespaces[i].id === S.filespaceId) { fsName = S.filespaces[i].name || S.filespaceId; break; }\n" +
    "  }\n" +
    "\n" +
    "  resetRoot();\n" +
    "  setStatus('busy', 'loading ' + fsName + '...');\n" +
    "  renderTree();\n" +
    "  renderBreadcrumb();\n" +
    "\n" +
    "  resolveRoot().then(function(rootId) {\n" +
    "    S.rootEntryId = rootId;\n" +
    "    return listChildren(S.rootEntryId);\n" +
    "  }).then(function(data) {\n" +
    "    data.entries.forEach(function(e) { S.tree[e.id] = makeNode(e, null); });\n" +
    "    S.rootIds = data.entries.map(function(e) { return e.id; });\n" +
    "    S.rootCursor = data.nextCursor || null;\n" +
    "    S.rootHasMore = !!data.nextCursor;\n" +
    "    S.connected = true;\n" +
    "    setStatus('ok', fsName);\n" +
    "    document.getElementById('btn-refresh').style.display = '';\n" +
    "    document.getElementById('topbar-fs').textContent = fsName;\n" +
    "  }).catch(function(err) {\n" +
    "    S.rootError = err.message;\n" +
    "    setStatus('err', 'error');\n" +
    "  }).then(function() {\n" +
    "    S.rootLoading = false;\n" +
    "    renderTree();\n" +
    "    updateStats();\n" +
    "  });\n" +
    "}\n" +
    "\n" +
    "function doRefresh() {\n" +
    "  onFilespaceSelect();\n" +
    "}\n" +
    "\n" +
    "function toggleEntry(id) {\n" +
    "  var node = S.tree[id];\n" +
    "  if (!node) return;\n" +
    "  var type = eType(node.entry);\n" +
    "\n" +
    "  if (type !== 'folder') {\n" +
    "    S.selectedId = S.selectedId === id ? null : id;\n" +
    "    renderTree();\n" +
    "    renderBreadcrumb();\n" +
    "    renderDetail();\n" +
    "    return;\n" +
    "  }\n" +
    "\n" +
    "  if (node.open) {\n" +
    "    node.open = false;\n" +
    "    if (S.selectedId === id) {\n" +
    "      S.selectedId = null;\n" +
    "      renderBreadcrumb();\n" +
    "    }\n" +
    "    renderTree();\n" +
    "    return;\n" +
    "  }\n" +
    "\n" +
    "  S.selectedId = id;\n" +
    "  node.open = true;\n" +
    "  renderBreadcrumb();\n" +
    "\n" +
    "  if (!node.loaded && !node.loading) {\n" +
    "    node.loading = true;\n" +
    "    renderTree();\n" +
    "    listChildren(id).then(function(data) {\n" +
    "      data.entries.forEach(function(e) {\n" +
    "        if (!S.tree[e.id]) S.tree[e.id] = makeNode(e, id);\n" +
    "      });\n" +
    "      node.children = data.entries.map(function(e) { return e.id; });\n" +
    "      node.cursor = data.nextCursor || null;\n" +
    "      node.hasMore = !!data.nextCursor;\n" +
    "      node.loaded = true;\n" +
    "    }).catch(function(err) {\n" +
    "      node.error = err.message;\n" +
    "    }).then(function() {\n" +
    "      node.loading = false;\n" +
    "      renderTree();\n" +
    "      updateStats();\n" +
    "    });\n" +
    "  } else {\n" +
    "    renderTree();\n" +
    "  }\n" +
    "  renderDetail();\n" +
    "}\n" +
    "\n" +
    "function loadMore(id) {\n" +
    "  var isRoot = !id;\n" +
    "  var cursor = isRoot ? S.rootCursor : (S.tree[id] ? S.tree[id].cursor : null);\n" +
    "  if (!cursor) return;\n" +
    "\n" +
    "  if (isRoot) S.rootLoading = true;\n" +
    "  else S.tree[id].loading = true;\n" +
    "  renderTree();\n" +
    "\n" +
    "  var targetId = isRoot ? S.rootEntryId : id;\n" +
    "  listChildren(targetId, cursor).then(function(data) {\n" +
    "    data.entries.forEach(function(e) {\n" +
    "      if (!S.tree[e.id]) S.tree[e.id] = makeNode(e, isRoot ? null : id);\n" +
    "    });\n" +
    "    var newIds = data.entries.map(function(e) { return e.id; });\n" +
    "    if (isRoot) {\n" +
    "      S.rootIds = S.rootIds.concat(newIds);\n" +
    "      S.rootCursor = data.nextCursor || null;\n" +
    "      S.rootHasMore = !!data.nextCursor;\n" +
    "    } else {\n" +
    "      S.tree[id].children = S.tree[id].children.concat(newIds);\n" +
    "      S.tree[id].cursor = data.nextCursor || null;\n" +
    "      S.tree[id].hasMore = !!data.nextCursor;\n" +
    "    }\n" +
    "  }).catch(function(err) {\n" +
    "    if (isRoot) S.rootError = err.message;\n" +
    "    else S.tree[id].error = err.message;\n" +
    "  }).then(function() {\n" +
    "    if (isRoot) S.rootLoading = false;\n" +
    "    else S.tree[id].loading = false;\n" +
    "    renderTree();\n" +
    "    updateStats();\n" +
    "  });\n" +
    "}\n" +
    "\n" +
    "function selectCrumb(id) {\n" +
    "  S.selectedId = id || null;\n" +
    "  renderTree();\n" +
    "  renderBreadcrumb();\n" +
    "  renderDetail();\n" +
    "}\n" +
    "\n" +
    "function closeDetail() {\n" +
    "  S.selectedId = null;\n" +
    "  document.getElementById('detail-panel').style.display = 'none';\n" +
    "  renderBreadcrumb();\n" +
    "  renderTree();\n" +
    "}\n" +
    "\n" +
    "// -- Breadcrumb -------------------------------------------------------------\n" +
    "\n" +
    "function getAncestors(id) {\n" +
    "  var path = [];\n" +
    "  var cur = id;\n" +
    "  while (cur && S.tree[cur]) {\n" +
    "    path.unshift({ id: cur, name: S.tree[cur].entry.name || S.tree[cur].entry.id || cur });\n" +
    "    cur = S.tree[cur].parentId;\n" +
    "  }\n" +
    "  return path;\n" +
    "}\n" +
    "\n" +
    "function renderBreadcrumb() {\n" +
    "  var bar = document.getElementById('breadcrumb');\n" +
    "  var id = S.selectedId;\n" +
    "\n" +
    "  if (!id || !S.tree[id]) {\n" +
    "    bar.innerHTML = '<span class=\"crumb current\">root</span>';\n" +
    "    return;\n" +
    "  }\n" +
    "\n" +
    "  var ancestors = getAncestors(id);\n" +
    "  var html = '<span class=\"crumb\" onclick=\"selectCrumb(null)\">root</span>';\n" +
    "  for (var i = 0; i < ancestors.length; i++) {\n" +
    "    html += '<span class=\"crumb-sep\">/</span>';\n" +
    "    if (i === ancestors.length - 1) {\n" +
    "      html += '<span class=\"crumb current\">' + esc(ancestors[i].name) + '</span>';\n" +
    "    } else {\n" +
    "      html += '<span class=\"crumb\" onclick=\"selectCrumb(\\'' + ancestors[i].id + '\\')\">' + esc(ancestors[i].name) + '</span>';\n" +
    "    }\n" +
    "  }\n" +
    "  bar.innerHTML = html;\n" +
    "}\n" +
    "\n" +
    "// -- Render -----------------------------------------------------------------\n" +
    "\n" +
    "function setStatus(state, label) {\n" +
    "  var dot = document.getElementById('status-dot');\n" +
    "  var txt = document.getElementById('status-text');\n" +
    "  dot.className = 'status-dot' + (state === 'ok' ? ' ok' : state === 'err' ? ' err' : state === 'busy' ? ' busy' : '');\n" +
    "  txt.textContent = label;\n" +
    "}\n" +
    "\n" +
    "function entryIconHtml(type) {\n" +
    "  if (type === 'folder') return '<div class=\"entry-icon ei-folder\"><svg viewBox=\"0 0 14 14\" fill=\"currentColor\" width=\"12\" height=\"12\"><path d=\"M1 2.5a.5.5 0 01.5-.5h3.25l1 1H12.5a.5.5 0 01.5.5V11a.5.5 0 01-.5.5h-11A.5.5 0 011 11V2.5z\"/></svg></div>';\n" +
    "  if (type === 'ext') return '<div class=\"entry-icon ei-ext\"><svg viewBox=\"0 0 14 14\" fill=\"currentColor\" width=\"12\" height=\"12\"><path d=\"M8 2h4v4M6 8l6-6M2 4a1 1 0 00-1 1v7a1 1 0 001 1h7a1 1 0 001-1V9\" stroke=\"currentColor\" stroke-width=\"1.3\" fill=\"none\" stroke-linecap=\"round\"/></svg></div>';\n" +
    "  return '<div class=\"entry-icon ei-file\"><svg viewBox=\"0 0 14 14\" fill=\"currentColor\" width=\"12\" height=\"12\"><path fill-rule=\"evenodd\" d=\"M2 2a1 1 0 011-1h5.586A1 1 0 019.293 1.293l2.414 2.414A1 1 0 0112 4.414V12a1 1 0 01-1 1H3a1 1 0 01-1-1V2z\"/></svg></div>';\n" +
    "}\n" +
    "\n" +
    "function renderEntryIds(ids, depth) {\n" +
    "  var html = '';\n" +
    "  for (var i = 0; i < ids.length; i++) {\n" +
    "    var id = ids[i];\n" +
    "    var node = S.tree[id];\n" +
    "    if (!node) continue;\n" +
    "    var entry = node.entry;\n" +
    "    var type = eType(entry);\n" +
    "    var isFolder = type === 'folder';\n" +
    "    var isSelected = S.selectedId === id;\n" +
    "    var name = entry.name || entry.id || id;\n" +
    "    var size = entry.size ? formatBytes(entry.size) : '';\n" +
    "\n" +
    "    var chevron = isFolder\n" +
    "      ? '<div class=\"expand-btn ' + (node.open ? 'open' : '') + '\"><svg viewBox=\"0 0 10 10\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.5\" width=\"10\" height=\"10\"><path d=\"M3 2l4 3-4 3\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/></svg></div>'\n" +
    "      : '<div class=\"expand-btn leaf\"></div>';\n" +
    "\n" +
    "    var badgeClass = type === 'folder' ? 'badge-folder' : type === 'ext' ? 'badge-ext' : 'badge-file';\n" +
    "    var badgeLabel = type === 'folder' ? 'dir' : type === 'ext' ? 'ext' : 'file';\n" +
    "\n" +
    "    html += '<li class=\"entry-item\">';\n" +
    "    html += '<div class=\"entry-row ' + (isSelected ? 'selected' : '') + '\" style=\"--depth:' + depth + '\" onclick=\"toggleEntry(\\'' + id + '\\')\">'\n" +
    "      + chevron\n" +
    "      + entryIconHtml(type)\n" +
    "      + '<span class=\"entry-name\" title=\"' + esc(name) + '\">' + esc(name) + '</span>'\n" +
    "      + '<div class=\"entry-badges\">'\n" +
    "      + '<span class=\"badge ' + badgeClass + '\">' + badgeLabel + '</span>'\n" +
    "      + '<span class=\"entry-size\">' + esc(size) + '</span>'\n" +
    "      + '</div></div>';\n" +
    "\n" +
    "    if (isFolder && node.open) {\n" +
    "      html += '<div class=\"children-block\">';\n" +
    "      if (node.loading && node.children.length === 0) {\n" +
    "        html += '<div class=\"state-row\" style=\"padding-left:calc(24px + ' + (depth + 1) + '*20px)\"><div class=\"spinner\"></div><span>loading...</span></div>';\n" +
    "      } else if (node.error) {\n" +
    "        html += '<div class=\"state-row err\" style=\"padding-left:calc(24px + ' + (depth + 1) + '*20px)\">&#9888; ' + esc(node.error) + '</div>';\n" +
    "      } else if (node.children.length === 0) {\n" +
    "        html += '<div class=\"state-row\" style=\"padding-left:calc(24px + ' + (depth + 1) + '*20px)\">empty directory</div>';\n" +
    "      } else {\n" +
    "        html += '<ul class=\"entry-list\">' + renderEntryIds(node.children, depth + 1) + '</ul>';\n" +
    "        if (node.hasMore) {\n" +
    "          html += '<div class=\"load-more-row\" style=\"padding-left:calc(24px + ' + (depth + 1) + '*20px)\">';\n" +
    "          if (node.loading) {\n" +
    "            html += '<div class=\"spinner\"></div>';\n" +
    "          } else {\n" +
    "            html += '<button class=\"btn btn-ghost btn-sm\" onclick=\"event.stopPropagation();loadMore(\\'' + id + '\\')\">&#8595; load more</button>';\n" +
    "          }\n" +
    "          html += '<span class=\"load-more-count\">' + node.children.length + ' shown</span></div>';\n" +
    "        }\n" +
    "      }\n" +
    "      html += '</div>';\n" +
    "    }\n" +
    "\n" +
    "    html += '</li>';\n" +
    "  }\n" +
    "  return html;\n" +
    "}\n" +
    "\n" +
    "function renderTree() {\n" +
    "  var panel = document.getElementById('tree-panel');\n" +
    "  var statbar = document.getElementById('statbar');\n" +
    "\n" +
    "  if (!S.connected && S.rootLoading) {\n" +
    "    panel.innerHTML = '<div class=\"state-row\"><div class=\"spinner\"></div><span>connecting...</span></div>';\n" +
    "    return;\n" +
    "  }\n" +
    "\n" +
    "  if (S.rootError && S.rootIds.length === 0) {\n" +
    "    panel.innerHTML = '<div class=\"error-banner\">&#9888; ' + esc(S.rootError) + '</div>';\n" +
    "    return;\n" +
    "  }\n" +
    "\n" +
    "  if (!S.connected && !S.rootLoading) {\n" +
    "    panel.innerHTML = '<div class=\"splash\"><div class=\"splash-icon\">&#128193;</div><h3>No filespace connected</h3><span>Enter your bearer token and click Connect</span></div>';\n" +
    "    statbar.style.display = 'none';\n" +
    "    return;\n" +
    "  }\n" +
    "\n" +
    "  statbar.style.display = '';\n" +
    "\n" +
    "  var html = '<ul class=\"entry-list\">' + renderEntryIds(S.rootIds, 0) + '</ul>';\n" +
    "\n" +
    "  if (S.rootHasMore) {\n" +
    "    html += '<div class=\"load-more-row\">';\n" +
    "    if (S.rootLoading) {\n" +
    "      html += '<div class=\"spinner\"></div>';\n" +
    "    } else {\n" +
    "      html += '<button class=\"btn btn-ghost btn-sm\" onclick=\"loadMore(null)\">&#8595; load more</button>';\n" +
    "    }\n" +
    "    html += '<span class=\"load-more-count\">' + S.rootIds.length + ' shown</span></div>';\n" +
    "  }\n" +
    "\n" +
    "  panel.innerHTML = html;\n" +
    "}\n" +
    "\n" +
    "function renderDetail() {\n" +
    "  var panel = document.getElementById('detail-panel');\n" +
    "  var body = document.getElementById('detail-body');\n" +
    "\n" +
    "  if (!S.selectedId || !S.tree[S.selectedId]) {\n" +
    "    panel.style.display = 'none';\n" +
    "    return;\n" +
    "  }\n" +
    "\n" +
    "  panel.style.display = 'flex';\n" +
    "  var entry = S.tree[S.selectedId].entry;\n" +
    "  var name = entry.name || entry.id;\n" +
    "\n" +
    "  var keys = Object.keys(entry);\n" +
    "  var rows = '';\n" +
    "  for (var i = 0; i < keys.length; i++) {\n" +
    "    var k = keys[i];\n" +
    "    if (k === 'children') continue;\n" +
    "    var v = entry[k];\n" +
    "    var val = (typeof v === 'object' && v !== null) ? JSON.stringify(v, null, 2) : String(v == null ? '\\u2014' : v);\n" +
    "    rows += '<tr><td class=\"dk\">' + esc(k) + '</td><td class=\"dv\">' + esc(val) + '</td></tr>';\n" +
    "  }\n" +
    "\n" +
    "  body.innerHTML = '<div class=\"detail-name\">' + esc(name) + '</div><table class=\"detail-table\">' + rows + '</table>';\n" +
    "}\n" +
    "\n" +
    "function updateStats() {\n" +
    "  var all = Object.keys(S.tree);\n" +
    "  var dirs = 0, files = 0, ext = 0;\n" +
    "  for (var i = 0; i < all.length; i++) {\n" +
    "    var t = eType(S.tree[all[i]].entry);\n" +
    "    if (t === 'folder') dirs++;\n" +
    "    else if (t === 'ext') ext++;\n" +
    "    else files++;\n" +
    "  }\n" +
    "  document.getElementById('stat-count').textContent = all.length;\n" +
    "  document.getElementById('stat-dirs').textContent = dirs;\n" +
    "  document.getElementById('stat-files').textContent = files;\n" +
    "  document.getElementById('stat-ext').textContent = ext;\n" +
    "}\n" +
    "\n" +
    "// -- Init -------------------------------------------------------------------\n" +
    "\n" +
    "document.getElementById('btn-connect').addEventListener('click', doConnect);\n" +
    "document.getElementById('btn-refresh').addEventListener('click', doRefresh);\n" +
    "document.getElementById('detail-close').addEventListener('click', closeDetail);\n" +
    "document.getElementById('inp-token').addEventListener('keydown', function(e) { if (e.key === 'Enter') doConnect(); });\n" +
    "document.getElementById('inp-token').addEventListener('input', function(e) { S.token = e.target.value; });\n" +
    "document.getElementById('inp-fs').addEventListener('change', onFilespaceSelect);\n" +
    "\n" +
    "if (S.token) doConnect();\n";
}
