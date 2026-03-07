/**
 * Multi-file project generator for the LucidLink Connect UI.
 * Produces a Node.js + Express app with S3 browser and visual import workflow.
 */

export interface GeneratedProject {
  files: Record<string, string>;
  instructions: string;
}

export function generateConnectUI(
  filespaceId = "",
  dataStoreId = "",
): GeneratedProject {
  return {
    files: {
      "package.json": generatePackageJson(),
      "server.js": generateServerJs(),
      "public/index.html": generateIndexHtml(),
      "public/style.css": generateStyleCss(),
      "public/app.js": generateAppJs(filespaceId, dataStoreId),
    },
    instructions: `LucidLink Connect UI — Generated Project
=========================================

Setup:
  cd <output-directory>
  npm install
  node server.js

Then open http://localhost:8080 in your browser.

Requirements:
  - Node.js 18+
  - LucidLink API running on localhost:3003

The UI will guide you through:
  1. Enter bearer token to connect
  2. Select a filespace
  3. Select or create a data store
  4. Browse S3 and import objects with one click`,
  };
}

// ── package.json ──

function generatePackageJson(): string {
  return JSON.stringify(
    {
      name: "lucidlink-connect-ui",
      version: "1.0.0",
      private: true,
      type: "module",
      scripts: {
        start: "node server.js",
      },
      dependencies: {
        "@aws-sdk/client-s3": "^3.700.0",
        express: "^4.21.0",
      },
    },
    null,
    2,
  );
}

// ── server.js ──

function generateServerJs(): string {
  return `import express from "express";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { S3Client, ListObjectsV2Command } from "@aws-sdk/client-s3";
import { exec } from "node:child_process";
import { platform } from "node:os";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = 8080;
const API_BASE = "http://localhost:3003";

const app = express();
app.use(express.json());

// ── Static files ──
app.use("/public", express.static(join(__dirname, "public")));
app.get("/", (_req, res) => res.sendFile(join(__dirname, "public/index.html")));

// ── API proxy to LucidLink API ──
app.all("/api/v1/*", async (req, res) => {
  try {
    const url = API_BASE + req.originalUrl;
    const headers = {};
    if (req.headers.authorization) headers["Authorization"] = req.headers.authorization;
    if (req.headers["content-type"]) headers["Content-Type"] = req.headers["content-type"];

    const opts = { method: req.method, headers };
    if (req.method !== "GET" && req.method !== "HEAD") {
      opts.body = JSON.stringify(req.body);
    }

    const upstream = await fetch(url, opts);
    const contentType = upstream.headers.get("content-type") || "application/json";
    const body = await upstream.text();
    res.status(upstream.status).set("Content-Type", contentType).send(body);
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

// ── S3 Browse (folder-level with delimiter) ──
app.post("/s3/browse", async (req, res) => {
  try {
    const { accessKeyId, secretAccessKey, region, bucket, prefix, continuationToken, endpoint, forcePathStyle } = req.body;
    if (!accessKeyId || !secretAccessKey || !bucket) {
      return res.status(400).json({ error: "accessKeyId, secretAccessKey, and bucket are required" });
    }

    const clientOpts = {
      region: region || "us-east-1",
      credentials: { accessKeyId, secretAccessKey },
    };
    if (endpoint) {
      clientOpts.endpoint = endpoint;
      clientOpts.forcePathStyle = forcePathStyle !== false;
    }

    const s3 = new S3Client(clientOpts);
    const cmd = new ListObjectsV2Command({
      Bucket: bucket,
      Prefix: prefix || "",
      Delimiter: "/",
      MaxKeys: 200,
      ContinuationToken: continuationToken || undefined,
    });

    const result = await s3.send(cmd);
    res.json({
      folders: (result.CommonPrefixes || []).map(p => p.Prefix),
      files: (result.Contents || []).map(o => ({
        key: o.Key,
        size: o.Size,
        lastModified: o.LastModified,
      })),
      isTruncated: result.IsTruncated || false,
      nextContinuationToken: result.NextContinuationToken || null,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── S3 List All (recursive, no delimiter — for folder import) ──
app.post("/s3/list-all", async (req, res) => {
  try {
    const { accessKeyId, secretAccessKey, region, bucket, prefix, endpoint, forcePathStyle } = req.body;
    if (!accessKeyId || !secretAccessKey || !bucket) {
      return res.status(400).json({ error: "accessKeyId, secretAccessKey, and bucket are required" });
    }

    const clientOpts = {
      region: region || "us-east-1",
      credentials: { accessKeyId, secretAccessKey },
    };
    if (endpoint) {
      clientOpts.endpoint = endpoint;
      clientOpts.forcePathStyle = forcePathStyle !== false;
    }

    const s3 = new S3Client(clientOpts);
    const allKeys = [];
    let token = undefined;

    do {
      const cmd = new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: prefix || "",
        MaxKeys: 1000,
        ContinuationToken: token,
      });
      const result = await s3.send(cmd);
      for (const obj of result.Contents || []) {
        // Skip "directory marker" objects (keys ending in /)
        if (!obj.Key.endsWith("/")) {
          allKeys.push({ key: obj.Key, size: obj.Size });
        }
      }
      token = result.IsTruncated ? result.NextContinuationToken : undefined;
    } while (token);

    res.json({ keys: allKeys, count: allKeys.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Start ──
app.listen(PORT, "127.0.0.1", () => {
  const url = "http://localhost:" + PORT;
  console.log("LucidLink Connect UI  ->  " + url);
  console.log("Proxying API calls    ->  " + API_BASE);
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
<title>LucidLink Connect</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
<link rel="stylesheet" href="/public/style.css">
</head>
<body>
<div class="app">

  <div class="header">
    <div class="logo">
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
        <circle cx="10" cy="10" r="8" stroke="white" stroke-width="2"/>
        <circle cx="10" cy="10" r="3" fill="white"/>
      </svg>
    </div>
    <div>
      <h1>LucidLink Connect</h1>
      <p>Browse S3 and import objects into a filespace</p>
    </div>
  </div>

  <!-- Step 1: Connect -->
  <div class="step" id="s1">
    <div class="step-head">
      <div class="num">1</div>
      <div class="step-title">Connect to API</div>
      <div class="step-tag" id="t1">Connected</div>
    </div>
    <div class="step-body">
      <div class="field">
        <label>Bearer Token</label>
        <input type="password" id="token" placeholder="Your bearer token">
      </div>
      <button class="btn btn-p" id="connectBtn">Connect</button>
      <div id="s1msg"></div>
    </div>
  </div>

  <!-- Step 2: Select Filespace -->
  <div class="step locked" id="s2">
    <div class="step-head">
      <div class="num">2</div>
      <div class="step-title">Select Filespace</div>
      <div class="step-tag" id="t2">&mdash;</div>
    </div>
    <div class="step-body">
      <div class="field">
        <label>Filespace</label>
        <select id="fsSelect">
          <option value="">&mdash; choose a filespace &mdash;</option>
        </select>
      </div>
    </div>
  </div>

  <!-- Step 3: Data Store -->
  <div class="step locked" id="s3">
    <div class="step-head">
      <div class="num">3</div>
      <div class="step-title">Data Store</div>
      <div class="step-tag" id="t3">&mdash;</div>
    </div>
    <div class="step-body">
      <div id="dsLoading" style="font-size:13px;color:var(--muted)">Loading...</div>
      <div id="dsContent" style="display:none">
        <div class="ds-grid" id="dsGrid"></div>
        <button class="disc-btn" id="createToggleBtn">
          <span class="arrow">&#9658;</span> Create new data store
        </button>
        <div class="disc-body" id="createBody">
          <div class="g2" style="margin-bottom:10px">
            <div class="field">
              <label>Store name</label>
              <input type="text" id="dsName" placeholder="e.g. production-media">
            </div>
            <div class="field">
              <label>S3 bucket name</label>
              <input type="text" id="dsBucket" placeholder="my-bucket">
            </div>
          </div>
          <div class="g3" style="margin-bottom:10px">
            <div class="field">
              <label>Region</label>
              <input type="text" id="dsRegion" value="us-east-1">
            </div>
            <div class="field">
              <label>Access Key ID</label>
              <input type="text" id="dsAK" placeholder="AKIA...">
            </div>
            <div class="field">
              <label>Secret Access Key</label>
              <input type="password" id="dsSK" placeholder="secret">
            </div>
          </div>
          <div class="check" style="margin-bottom:12px">
            <input type="checkbox" id="dsVA" checked>
            <label for="dsVA">Virtual-hosted addressing (recommended for AWS S3)</label>
          </div>
          <div id="createErr" style="display:none" class="alert alert-err"></div>
          <button class="btn btn-p btn-sm" id="createDsBtn">Create Data Store</button>
        </div>
      </div>
    </div>
  </div>

  <!-- Step 4: S3 Browser & Import -->
  <div class="step locked" id="s4">
    <div class="step-head">
      <div class="num">4</div>
      <div class="step-title">Browse S3 &amp; Import</div>
    </div>
    <div class="step-body">

      <!-- Credentials panel -->
      <div class="s3-creds">
        <div class="g3" style="margin-bottom:10px">
          <div class="field">
            <label>Access Key ID</label>
            <input type="text" id="s3AK" placeholder="AKIA...">
          </div>
          <div class="field">
            <label>Secret Access Key</label>
            <div style="position:relative">
              <input type="password" id="s3SK" placeholder="secret">
              <button class="toggle-vis" id="s3SKToggle" title="Show/Hide">&#128065;</button>
            </div>
          </div>
          <div class="field">
            <label>Region</label>
            <input type="text" id="s3Region" value="us-east-1">
          </div>
        </div>
        <div class="field" id="s3EndpointField" style="display:none;margin-bottom:10px">
          <label>Custom S3 Endpoint (non-AWS)</label>
          <input type="text" id="s3Endpoint" placeholder="https://s3.example.com">
        </div>
        <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
          <button class="btn btn-p" id="browseBtn">Browse Bucket</button>
          <label class="check" style="margin:0">
            <input type="checkbox" id="s3CustomEndpoint">
            <span style="font-size:12px;color:var(--muted)">Custom endpoint (MinIO, Backblaze, etc.)</span>
          </label>
        </div>
        <div id="s3msg"></div>
      </div>

      <!-- S3 Browser -->
      <div id="s3Browser" style="display:none">
        <div class="s3-toolbar">
          <button class="btn btn-sm" id="s3BackBtn" title="Go up one level">&larr; Back</button>
          <button class="btn btn-sm" id="s3RefreshBtn">Refresh</button>
          <div class="s3-breadcrumb" id="s3Breadcrumb">s3://</div>
        </div>
        <div class="s3-list" id="s3List"></div>
        <div id="s3LoadMore" style="display:none;padding:10px 0">
          <button class="btn btn-sm btn-p" id="s3LoadMoreBtn">Load More...</button>
        </div>
      </div>

      <!-- Import progress -->
      <div id="importProgress" style="display:none">
        <div class="import-header">
          <span id="importStatus">Importing...</span>
          <span id="importCount" class="muted"></span>
        </div>
        <div class="progress-bar"><div class="progress-fill" id="progressFill"></div></div>
        <div id="importResults" style="max-height:300px;overflow-y:auto">
          <table>
            <thead><tr><th>S3 Key</th><th>Path</th><th>Status</th></tr></thead>
            <tbody id="importBody"></tbody>
          </table>
        </div>
        <div class="summary" id="importSummary"></div>
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
  return `:root {
  --blue: #4C8BFF; --blue-dark: #3a6fcc; --blue-dim: #1a2744;
  --bg: #0f1419; --surface: #1a2030; --border: #2a3548;
  --text: #e2e8f0; --muted: #8899aa;
  --ok: #34d399; --ok-bg: #0d3328;
  --err: #f87171; --err-bg: #3b1515;
  --r: 12px;
}
* { box-sizing: border-box; margin: 0; padding: 0; }
body { font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif; background: var(--bg); color: var(--text); min-height: 100vh; padding: 32px 20px; font-size: 14px; line-height: 1.5; }
.app { max-width: 760px; margin: 0 auto; }
.header { display: flex; align-items: flex-start; gap: 12px; margin-bottom: 28px; }
.logo { width: 36px; height: 36px; background: var(--blue); border-radius: 8px; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
.header h1 { font-size: 20px; font-weight: 700; color: var(--blue); line-height: 1.2; }
.header p { font-size: 13px; color: var(--muted); margin-top: 2px; }

/* Steps */
.step { background: var(--surface); border: 1px solid var(--border); border-radius: var(--r); margin-bottom: 10px; overflow: hidden; transition: opacity 0.2s; }
.step.locked { opacity: 0.45; pointer-events: none; }
.step-head { display: flex; align-items: center; gap: 10px; padding: 15px 18px; }
.num { width: 24px; height: 24px; border-radius: 50%; background: var(--blue-dim); color: var(--blue); font-size: 12px; font-weight: 700; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
.step.done .num { background: var(--blue); color: #fff; }
.step-title { font-weight: 600; font-size: 14px; }
.step-tag { margin-left: auto; font-size: 11px; font-weight: 600; color: var(--ok); background: var(--ok-bg); padding: 2px 9px; border-radius: 20px; display: none; }
.step.done .step-tag { display: inline-block; }
.step-body { padding: 0 18px 18px; }

/* Form */
.field { margin-bottom: 12px; }
label { display: block; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; color: var(--muted); margin-bottom: 4px; }
input, select { width: 100%; padding: 8px 11px; border: 1px solid var(--border); border-radius: 8px; font: inherit; font-size: 13px; background: #141c28; color: var(--text); outline: none; transition: border-color 0.15s; }
input:focus, select:focus { border-color: var(--blue); background: #1e2a3a; }
.g2 { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
.g3 { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 10px; }
.check { display: flex; align-items: center; gap: 7px; }
.check input[type=checkbox] { width: 14px; height: 14px; accent-color: var(--blue); flex-shrink: 0; cursor: pointer; }
.check label { text-transform: none; letter-spacing: 0; font-size: 13px; font-weight: 500; color: var(--text); margin: 0; }

/* Buttons */
.btn { display: inline-flex; align-items: center; gap: 5px; padding: 8px 18px; border-radius: 8px; font: inherit; font-size: 13px; font-weight: 600; cursor: pointer; border: 1px solid var(--border); background: var(--surface); color: var(--text); transition: background 0.15s, transform 0.1s; }
.btn:active:not(:disabled) { transform: scale(0.98); }
.btn:hover:not(:disabled) { background: var(--blue-dim); }
.btn-p { background: var(--blue); color: #fff; border-color: var(--blue); }
.btn-p:hover:not(:disabled) { background: var(--blue-dark); }
.btn-p:disabled { background: #2a4a7a; cursor: not-allowed; border-color: #2a4a7a; }
.btn-sm { padding: 6px 13px; font-size: 12px; }
.btn-import { background: var(--ok); color: #fff; border-color: var(--ok); padding: 4px 12px; font-size: 11px; }
.btn-import:hover:not(:disabled) { background: #047857; }

/* Alerts */
.alert { display: flex; align-items: center; gap: 7px; padding: 9px 12px; border-radius: 8px; font-size: 13px; font-weight: 500; margin-top: 10px; }
.alert-ok { background: var(--ok-bg); color: var(--ok); }
.alert-err { background: var(--err-bg); color: var(--err); }
.dot { width: 6px; height: 6px; border-radius: 50%; background: currentColor; flex-shrink: 0; }

/* Data store cards */
.ds-grid { display: flex; flex-direction: column; gap: 7px; margin-bottom: 14px; }
.ds-card { border: 2px solid var(--border); border-radius: 8px; padding: 11px 13px; cursor: pointer; display: flex; align-items: center; gap: 11px; transition: border-color 0.15s, background 0.15s; }
.ds-card:hover { border-color: #3a5a8a; background: #1e2a3a; }
.ds-card.sel { border-color: var(--blue); background: var(--blue-dim); }
.ds-radio { width: 16px; height: 16px; border: 2px solid var(--border); border-radius: 50%; flex-shrink: 0; display: flex; align-items: center; justify-content: center; transition: border-color 0.15s; }
.ds-card.sel .ds-radio { border-color: var(--blue); }
.ds-dot { width: 7px; height: 7px; border-radius: 50%; background: var(--blue); display: none; }
.ds-card.sel .ds-dot { display: block; }
.ds-name { font-weight: 600; font-size: 13px; }
.ds-meta { color: var(--muted); font-size: 12px; margin-top: 1px; }
.ds-empty { color: var(--muted); font-size: 13px; padding: 16px 0; }

/* Disclosure */
.disc-btn { display: flex; align-items: center; gap: 6px; background: none; border: none; color: var(--blue); font: inherit; font-size: 13px; font-weight: 600; cursor: pointer; padding: 8px 0; }
.disc-btn .arrow { display: inline-block; transition: transform 0.2s; }
.disc-btn.open .arrow { transform: rotate(90deg); }
.disc-body { background: #141c28; border: 1px solid var(--border); border-radius: 8px; padding: 15px; margin-top: 8px; display: none; }
.disc-body.open { display: block; }

/* Toggle password visibility */
.toggle-vis { position: absolute; right: 8px; top: 50%; transform: translateY(-50%); background: none; border: none; cursor: pointer; font-size: 14px; color: var(--muted); padding: 2px; line-height: 1; }

/* S3 Browser */
.s3-creds { margin-bottom: 16px; }
.s3-toolbar { display: flex; align-items: center; gap: 8px; padding: 10px 0; border-bottom: 1px solid var(--border); margin-bottom: 8px; flex-wrap: wrap; }
.s3-breadcrumb { font-family: 'SF Mono', 'Fira Code', monospace; font-size: 12px; color: var(--blue); font-weight: 600; margin-left: 4px; word-break: break-all; }
.s3-list { min-height: 60px; }
.s3-row { display: flex; align-items: center; gap: 10px; padding: 8px 10px; border-bottom: 1px solid var(--border); transition: background 0.1s; }
.s3-row:hover { background: #1e2a3a; }
.s3-icon { width: 20px; text-align: center; font-size: 14px; flex-shrink: 0; }
.s3-name { flex: 1; min-width: 0; font-size: 13px; word-break: break-all; }
.s3-name.folder { color: var(--blue); font-weight: 600; cursor: pointer; }
.s3-name.folder:hover { text-decoration: underline; }
.s3-size { font-size: 11px; color: var(--muted); flex-shrink: 0; min-width: 60px; text-align: right; }
.s3-actions { flex-shrink: 0; }
.s3-empty { color: var(--muted); font-size: 13px; padding: 20px 10px; text-align: center; }

/* Import progress */
.import-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px; font-size: 13px; font-weight: 600; }
.progress-bar { width: 100%; height: 8px; background: var(--border); border-radius: 4px; overflow: hidden; margin-bottom: 12px; }
.progress-fill { height: 100%; background: var(--blue); border-radius: 4px; transition: width 0.2s; width: 0%; }

/* Results table */
table { width: 100%; border-collapse: collapse; font-size: 12px; }
th { background: #141c28; color: var(--blue); text-align: left; padding: 7px 9px; font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em; border-bottom: 2px solid var(--border); }
td { padding: 7px 9px; border-bottom: 1px solid var(--border); word-break: break-all; }
tr:last-child td { border-bottom: none; }
.badge { display: inline-block; padding: 1px 7px; border-radius: 9px; font-size: 10px; font-weight: 700; }
.b-ok { background: var(--ok-bg); color: var(--ok); }
.b-err { background: var(--err-bg); color: var(--err); }
.summary { font-size: 13px; font-weight: 600; margin-top: 12px; }
.muted { color: var(--muted); font-weight: 400; }

@media (max-width: 600px) {
  .g2, .g3 { grid-template-columns: 1fr; }
}`;
}

// ── public/app.js ──

function generateAppJs(filespaceId: string, dataStoreId: string): string {
  return `// LucidLink Connect UI — Client-side logic
"use strict";

const BASE = "";  // same origin
const API = "/api/v1";

const ST = {
  fsId: ${JSON.stringify(filespaceId)},
  dsId: ${JSON.stringify(dataStoreId)},
  filespaces: [],
  datastores: [],
  selectedDs: null,
  // S3 state
  s3Bucket: "",
  s3Prefix: "",
  s3ContinuationToken: null,
  s3Folders: [],
  s3Files: [],
};

// ── Helpers ──

const $ = (id) => document.getElementById(id);
const h = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function hdrs() {
  return {
    "Content-Type": "application/json",
    Authorization: "Bearer " + $("token").value.trim(),
  };
}

function unlock(id) { $(id).classList.remove("locked"); }
function lock(id) { $(id).classList.add("locked"); }

function done(sid, tid, label) {
  $(sid).classList.add("done");
  const t = $(tid);
  t.textContent = label;
  t.style.display = "inline-block";
}

function showAlert(id, type, msg) {
  const el = $(id);
  el.className = "alert alert-" + type;
  el.innerHTML = '<span class="dot"></span>' + h(msg);
  el.style.display = "flex";
}

function hideAlert(id) {
  const el = $(id);
  if (el) el.style.display = "none";
}

function formatSize(bytes) {
  if (bytes == null) return "";
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1048576) return (bytes / 1024).toFixed(1) + " KB";
  if (bytes < 1073741824) return (bytes / 1048576).toFixed(1) + " MB";
  return (bytes / 1073741824).toFixed(2) + " GB";
}

// ── Step 1: Connect ──

$("connectBtn").addEventListener("click", doConnect);

async function doConnect() {
  const btn = $("connectBtn");
  btn.disabled = true;
  btn.textContent = "Connecting...";
  hideAlert("s1msg");
  try {
    const r = await fetch(API + "/filespaces", { headers: hdrs() });
    if (!r.ok) throw new Error("API returned " + r.status + ". Check your token.");
    const d = await r.json();
    ST.filespaces = Array.isArray(d) ? d : Array.isArray(d.data) ? d.data : [];
    const sel = $("fsSelect");
    sel.innerHTML = '<option value="">\\u2014 choose a filespace \\u2014</option>';
    ST.filespaces.forEach((fs) => {
      const o = document.createElement("option");
      o.value = fs.id;
      o.textContent = fs.name || fs.id;
      if (fs.id === ST.fsId) o.selected = true;
      sel.appendChild(o);
    });
    const n = ST.filespaces.length;
    showAlert("s1msg", "ok", "Connected \\u00b7 " + n + " filespace" + (n !== 1 ? "s" : "") + " found");
    done("s1", "t1", "Connected");
    unlock("s2");
    if (ST.fsId && ST.filespaces.find((f) => f.id === ST.fsId)) onFsChange();
  } catch (e) {
    showAlert("s1msg", "err", e.message || "Connection failed");
  }
  btn.disabled = false;
  btn.textContent = "Connect";
}

// ── Step 2: Select Filespace ──

$("fsSelect").addEventListener("change", onFsChange);

async function onFsChange() {
  const sel = $("fsSelect");
  const id = sel.value;
  if (!id) return;
  ST.fsId = id;
  ST.dsId = "";
  ST.selectedDs = null;
  done("s2", "t2", sel.options[sel.selectedIndex].text);
  lock("s4");
  $("s3Browser").style.display = "none";
  $("importProgress").style.display = "none";
  unlock("s3");
  await loadDs();
}

// ── Step 3: Data Store ──

async function loadDs() {
  $("dsLoading").style.display = "";
  $("dsContent").style.display = "none";
  try {
    const r = await fetch(API + "/filespaces/" + ST.fsId + "/external/data-stores", { headers: hdrs() });
    if (!r.ok) throw new Error("HTTP " + r.status);
    const d = await r.json();
    ST.datastores = Array.isArray(d) ? d : Array.isArray(d.data) ? d.data : [];
    renderDs();
    $("dsLoading").style.display = "none";
    $("dsContent").style.display = "";
    if (ST.dsId && ST.datastores.find((ds) => ds.id === ST.dsId)) selectDs(ST.dsId);
  } catch (e) {
    $("dsLoading").textContent = "Error loading data stores: " + e.message;
  }
}

function renderDs() {
  const g = $("dsGrid");
  if (!ST.datastores.length) {
    g.innerHTML = '<div class="ds-empty">No data stores yet \\u2014 create one below.</div>';
    return;
  }
  g.innerHTML = ST.datastores
    .map((ds) => {
      const p = ds.s3StorageParams || {};
      const meta = [p.bucketName, p.region].filter(Boolean).join(" \\u00b7 ");
      return (
        '<div class="ds-card" data-id="' + h(ds.id) + '">' +
        '<div class="ds-radio"><div class="ds-dot"></div></div>' +
        '<div style="flex:1;min-width:0">' +
        '<div class="ds-name">' + h(ds.name) + "</div>" +
        '<div class="ds-meta">' + h(meta || "S3DataStore") + "</div>" +
        "</div></div>"
      );
    })
    .join("");

  // Attach click listeners
  g.querySelectorAll(".ds-card").forEach((card) => {
    card.addEventListener("click", () => selectDs(card.dataset.id));
  });
}

function selectDs(id) {
  ST.dsId = id;
  ST.selectedDs = ST.datastores.find((d) => d.id === id) || null;
  document.querySelectorAll(".ds-card").forEach((c) => c.classList.remove("sel"));
  const card = document.querySelector('.ds-card[data-id="' + id + '"]');
  if (card) card.classList.add("sel");
  done("s3", "t3", ST.selectedDs ? ST.selectedDs.name : "Selected");

  // Pre-fill S3 credentials from data store
  const params = ST.selectedDs?.s3StorageParams || {};
  if (params.region) $("s3Region").value = params.region;
  ST.s3Bucket = params.bucketName || "";
  ST.s3Prefix = "";

  // Show/hide custom endpoint
  if (params.endpoint) {
    $("s3Endpoint").value = params.endpoint;
    $("s3CustomEndpoint").checked = true;
    $("s3EndpointField").style.display = "";
  }

  // Reset browser state
  $("s3Browser").style.display = "none";
  $("importProgress").style.display = "none";
  unlock("s4");
}

// Create toggle
$("createToggleBtn").addEventListener("click", () => {
  $("createToggleBtn").classList.toggle("open");
  $("createBody").classList.toggle("open");
});

$("createDsBtn").addEventListener("click", doCreateDs);

async function doCreateDs() {
  const name = $("dsName").value.trim();
  const bucket = $("dsBucket").value.trim();
  const region = $("dsRegion").value.trim() || "us-east-1";
  const ak = $("dsAK").value.trim();
  const sk = $("dsSK").value.trim();
  const va = $("dsVA").checked;
  hideAlert("createErr");
  if (!name || !bucket || !ak || !sk) {
    showAlert("createErr", "err", "Name, bucket, access key and secret key are required.");
    return;
  }
  const body = {
    name,
    kind: "S3DataStore",
    s3StorageParams: {
      bucketName: bucket,
      accessKey: ak,
      secretKey: sk,
      region,
      useVirtualAddressing: va,
      urlExpirationMinutes: 10080,
    },
  };
  try {
    const r = await fetch(API + "/filespaces/" + ST.fsId + "/external/data-stores", {
      method: "POST",
      headers: hdrs(),
      body: JSON.stringify(body),
    });
    const d = await r.json().catch(() => null);
    if (!r.ok) {
      showAlert("createErr", "err", (d && (d.message || d.error)) || "HTTP " + r.status);
      return;
    }
    const newDs = d && d.data ? d.data : d;
    if (newDs && newDs.id) {
      ST.datastores.push(newDs);
      renderDs();
      $("createToggleBtn").classList.remove("open");
      $("createBody").classList.remove("open");
      ["dsName", "dsBucket", "dsAK", "dsSK"].forEach((i) => ($(i).value = ""));
      $("dsRegion").value = "us-east-1";
      $("dsVA").checked = true;
      selectDs(newDs.id);
    }
  } catch (e) {
    showAlert("createErr", "err", e.message || "Failed to create data store");
  }
}

// ── Step 4: S3 Browser ──

// Toggle password visibility
$("s3SKToggle").addEventListener("click", () => {
  const inp = $("s3SK");
  inp.type = inp.type === "password" ? "text" : "password";
});

// Custom endpoint toggle
$("s3CustomEndpoint").addEventListener("change", () => {
  $("s3EndpointField").style.display = $("s3CustomEndpoint").checked ? "" : "none";
});

$("browseBtn").addEventListener("click", doBrowse);
$("s3BackBtn").addEventListener("click", goBack);
$("s3RefreshBtn").addEventListener("click", refreshBrowse);
$("s3LoadMoreBtn").addEventListener("click", loadMore);

function s3Creds() {
  const creds = {
    accessKeyId: $("s3AK").value.trim(),
    secretAccessKey: $("s3SK").value.trim(),
    region: $("s3Region").value.trim() || "us-east-1",
    bucket: ST.s3Bucket,
  };
  if ($("s3CustomEndpoint").checked && $("s3Endpoint").value.trim()) {
    creds.endpoint = $("s3Endpoint").value.trim();
    creds.forcePathStyle = true;
  }
  return creds;
}

async function doBrowse() {
  const creds = s3Creds();
  if (!creds.accessKeyId || !creds.secretAccessKey) {
    showAlert("s3msg", "err", "Access Key ID and Secret Access Key are required.");
    return;
  }
  if (!creds.bucket) {
    showAlert("s3msg", "err", "No bucket found. Select a data store first.");
    return;
  }
  hideAlert("s3msg");
  ST.s3Prefix = "";
  ST.s3ContinuationToken = null;
  ST.s3Folders = [];
  ST.s3Files = [];
  await fetchS3(false);
  $("s3Browser").style.display = "";
}

async function refreshBrowse() {
  ST.s3ContinuationToken = null;
  ST.s3Folders = [];
  ST.s3Files = [];
  await fetchS3(false);
}

async function loadMore() {
  await fetchS3(true);
}

async function fetchS3(append) {
  const btn = $("browseBtn");
  btn.disabled = true;
  btn.textContent = "Loading...";
  try {
    const body = { ...s3Creds(), prefix: ST.s3Prefix };
    if (append && ST.s3ContinuationToken) {
      body.continuationToken = ST.s3ContinuationToken;
    }
    const r = await fetch("/s3/browse", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!r.ok) {
      const err = await r.json().catch(() => ({}));
      throw new Error(err.error || "HTTP " + r.status);
    }
    const data = await r.json();
    if (append) {
      ST.s3Folders = ST.s3Folders.concat(data.folders || []);
      ST.s3Files = ST.s3Files.concat(data.files || []);
    } else {
      ST.s3Folders = data.folders || [];
      ST.s3Files = data.files || [];
    }
    ST.s3ContinuationToken = data.isTruncated ? data.nextContinuationToken : null;
    renderS3Browser();
    hideAlert("s3msg");
  } catch (e) {
    showAlert("s3msg", "err", e.message || "Failed to browse S3");
  }
  btn.disabled = false;
  btn.textContent = "Browse Bucket";
}

function renderS3Browser() {
  // Breadcrumb
  $("s3Breadcrumb").textContent = "s3://" + ST.s3Bucket + "/" + ST.s3Prefix;

  // Back button state
  $("s3BackBtn").disabled = !ST.s3Prefix;

  const list = $("s3List");
  let html = "";

  if (!ST.s3Folders.length && !ST.s3Files.length) {
    html = '<div class="s3-empty">This location is empty.</div>';
  }

  // Folders
  for (const folder of ST.s3Folders) {
    const displayName = folder.replace(ST.s3Prefix, "").replace(/\\/$/, "") || folder;
    html +=
      '<div class="s3-row">' +
      '<div class="s3-icon">\\uD83D\\uDCC1</div>' +
      '<div class="s3-name folder" data-prefix="' + h(folder) + '">' + h(displayName) + "</div>" +
      '<div class="s3-size"></div>' +
      '<div class="s3-actions"><button class="btn btn-import btn-sm" data-import-folder="' + h(folder) + '">Import Folder</button></div>' +
      "</div>";
  }

  // Files (skip directory markers)
  for (const file of ST.s3Files) {
    if (file.key && file.key.endsWith("/")) continue;
    const displayName = file.key ? file.key.replace(ST.s3Prefix, "") : file.key;
    html +=
      '<div class="s3-row">' +
      '<div class="s3-icon">\\uD83D\\uDCC4</div>' +
      '<div class="s3-name">' + h(displayName) + "</div>" +
      '<div class="s3-size">' + formatSize(file.size) + "</div>" +
      '<div class="s3-actions"><button class="btn btn-import btn-sm" data-import-file="' + h(file.key) + '">Import</button></div>' +
      "</div>";
  }

  list.innerHTML = html;

  // Attach click handlers for folder navigation
  list.querySelectorAll(".s3-name.folder").forEach((el) => {
    el.addEventListener("click", () => navigateToPrefix(el.dataset.prefix));
  });

  // Attach file import handlers
  list.querySelectorAll("[data-import-file]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      importSingleFile(btn.dataset.importFile);
    });
  });

  // Attach folder import handlers
  list.querySelectorAll("[data-import-folder]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      importFolder(btn.dataset.importFolder);
    });
  });

  // Load more
  $("s3LoadMore").style.display = ST.s3ContinuationToken ? "" : "none";
}

function navigateToPrefix(prefix) {
  ST.s3Prefix = prefix;
  ST.s3ContinuationToken = null;
  ST.s3Folders = [];
  ST.s3Files = [];
  fetchS3(false);
}

function goBack() {
  if (!ST.s3Prefix) return;
  // Remove trailing slash, then go up one level
  const trimmed = ST.s3Prefix.replace(/\\/$/, "");
  const lastSlash = trimmed.lastIndexOf("/");
  ST.s3Prefix = lastSlash >= 0 ? trimmed.substring(0, lastSlash + 1) : "";
  ST.s3ContinuationToken = null;
  ST.s3Folders = [];
  ST.s3Files = [];
  fetchS3(false);
}

// ── Import Logic ──

async function resolveEntry(path) {
  const r = await fetch(API + "/filespaces/" + ST.fsId + "/entries/resolve?path=" + encodeURIComponent(path), { headers: hdrs() });
  return { ok: r.status === 200, status: r.status, data: r.ok ? await r.json() : null };
}

async function createEntry(parentId, name) {
  const r = await fetch(API + "/filespaces/" + ST.fsId + "/entries", {
    method: "POST",
    headers: hdrs(),
    body: JSON.stringify({ parentId, name, type: "dir" }),
  });
  const data = r.status < 300 ? await r.json() : null;
  return { ok: r.status === 201, status: r.status, data };
}

async function ensurePath(path) {
  const parts = path.replace(/^\\/+|\\/+$/g, "").split("/").filter(Boolean);
  if (!parts.length) return { ok: true };
  // Resolve root entry ID first — createEntry needs a valid parentId
  const root = await resolveEntry("/");
  let curId = root.ok ? (root.data?.data?.id ?? root.data?.id ?? null) : null;
  if (!curId) return { ok: false, error: "Could not resolve root directory" };
  let cur = "";
  for (const name of parts) {
    cur += "/" + name;
    let ok = false;
    for (let i = 0; i < 3; i++) {
      const res = await resolveEntry(cur);
      if (res.ok) {
        curId = res.data?.data?.id ?? res.data?.id ?? null;
        ok = true;
        break;
      }
      const cr = await createEntry(curId, name);
      if (cr.ok) {
        curId = cr.data?.data?.id ?? cr.data?.id ?? null;
        ok = true;
        break;
      }
      if (cr.status === 409) { await sleep(200); continue; }
      await sleep(500);
    }
    if (!ok) return { ok: false, error: "Could not create '" + cur + "'" };
  }
  return { ok: true };
}

async function importSingleFile(s3Key) {
  const llPath = "/" + ST.s3Bucket + "/" + s3Key.replace(/^\\/+/, "");
  if (!confirm("Import this object?\\n\\nS3: " + s3Key + "\\nPath: " + llPath)) return;
  await runImport([{ s3Key, llPath }]);
}

async function importFolder(prefix) {
  const btn = document.querySelector('[data-import-folder="' + prefix + '"]');
  if (btn) { btn.disabled = true; btn.textContent = "Scanning..."; }

  try {
    const r = await fetch("/s3/list-all", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...s3Creds(), prefix }),
    });
    if (!r.ok) {
      const err = await r.json().catch(() => ({}));
      alert("Error scanning folder: " + (err.error || "HTTP " + r.status));
      return;
    }
    const data = await r.json();
    if (!data.keys || data.keys.length === 0) {
      alert("No objects found under " + prefix);
      return;
    }
    if (!confirm("Import " + data.keys.length + " object(s) from:\\n" + prefix + "\\n\\nContinue?")) return;

    const objects = data.keys.map((k) => ({
      s3Key: k.key,
      llPath: "/" + ST.s3Bucket + "/" + k.key.replace(/^\\/+/, ""),
    }));
    await runImport(objects);
  } catch (e) {
    alert("Error: " + e.message);
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = "Import Folder"; }
  }
}

async function runImport(objects) {
  const progress = $("importProgress");
  const fill = $("progressFill");
  const tbody = $("importBody");
  const status = $("importStatus");
  const count = $("importCount");
  const summary = $("importSummary");

  progress.style.display = "";
  tbody.innerHTML = "";
  fill.style.width = "0%";
  summary.textContent = "";
  status.textContent = "Preparing directories...";
  count.textContent = objects.length + " object(s)";

  // Collect unique directories
  const dirs = new Set();
  objects.forEach(({ llPath }) => {
    const parts = llPath.replace(/^\\/+/, "").split("/");
    parts.pop(); // remove filename
    if (parts.length && parts[0]) dirs.add("/" + parts.join("/"));
  });

  // Create directories (sorted so parents come first)
  const sortedDirs = Array.from(dirs).sort();
  for (let i = 0; i < sortedDirs.length; i++) {
    status.textContent = "Creating directories... (" + (i + 1) + "/" + sortedDirs.length + ")";
    const res = await ensurePath(sortedDirs[i]);
    if (!res.ok) {
      status.textContent = "Error: " + res.error;
      return;
    }
  }

  // Import objects
  let ok = 0, fail = 0;
  for (let i = 0; i < objects.length; i++) {
    const { s3Key, llPath } = objects[i];
    status.textContent = "Importing...";
    count.textContent = (i + 1) + " / " + objects.length;
    fill.style.width = (((i + 1) / objects.length) * 100).toFixed(1) + "%";

    const r = await fetch(API + "/filespaces/" + ST.fsId + "/external/entries", {
      method: "POST",
      headers: hdrs(),
      body: JSON.stringify({
        path: llPath,
        kind: "SingleObjectFile",
        dataStoreId: ST.dsId,
        singleObjectFileParams: { objectId: s3Key },
      }),
    });
    let rd = null;
    try { rd = await r.json(); } catch (_e) {}

    const tr = document.createElement("tr");
    if (r.ok) {
      ok++;
      tr.innerHTML =
        "<td>" + h(s3Key) + "</td><td>" + h(llPath) + '</td><td><span class="badge b-ok">OK</span></td>';
    } else {
      fail++;
      const em = (rd && (rd.message || rd.error)) || "HTTP " + r.status;
      tr.innerHTML =
        "<td>" + h(s3Key) + "</td><td>" + h(llPath) + '</td><td><span class="badge b-err" title="' + h(em) + '">Error</span></td>';
    }
    tbody.appendChild(tr);
  }

  fill.style.width = "100%";
  const total = objects.length;
  if (ok === total) {
    status.textContent = "Complete";
    summary.textContent = "All " + ok + " object" + (ok !== 1 ? "s" : "") + " imported successfully.";
  } else {
    status.textContent = "Completed with errors";
    summary.innerHTML = ok + " of " + total + ' imported. <span class="muted">' + fail + " failed.</span>";
  }
}

// ── Init ──
window.addEventListener("DOMContentLoaded", () => {
  const p = new URLSearchParams(location.search);
  if (p.get("token")) $("token").value = p.get("token");
});
`;
}
