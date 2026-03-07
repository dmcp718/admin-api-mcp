/**
 * LucidLink Filespace Search MCP Server
 *
 * Standalone MCP server that manages the fs-index-server Go binary.
 * Provides filespace search, browsing, and indexing via a compiled Go
 * backend with SQLite FTS5 full-text search.
 *
 * The Go binary discovers LucidLink filespace mounts via `lucid list`
 * and `lucid --instance <id> status`, then crawls and indexes all files
 * for fast search.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { registerBrandResource } from "./shared/brand-resource.js";
import { registerCapabilitiesResource } from "./shared/capabilities-resource.js";
import { ok, err } from "./shared/formatters.js";

import { existsSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __scriptDir = dirname(fileURLToPath(import.meta.url));

/** Resolve the fs-index-server binary from known locations */
function findBinary(): { binaryPath: string; binaryDir: string } | null {
  const candidates = [
    // macOS app bundle: Resources/fs-index-server (alongside Resources/mcp/)
    join(__scriptDir, "..", "fs-index-server"),
    // Development: repo_root/fs-index-server/fs-index-server
    join(__scriptDir, "..", "fs-index-server", "fs-index-server"),
    // CWD-based (fallback)
    join(process.cwd(), "fs-index-server", "fs-index-server"),
  ];

  for (const c of candidates) {
    const resolved = resolve(c);
    if (existsSync(resolved)) {
      return { binaryPath: resolved, binaryDir: dirname(resolved) };
    }
  }
  return null;
}

const server = new McpServer(
  { name: "lucidlink-filespace-search", version: "1.0.0" },
  { instructions: `Filespace search and browsing server. Uses a compiled Go binary (fs-index-server) — never rewrite it.
Call start_filespace_indexer first (auto-discovers LucidLink mounts), then search_filespace or browse_filespace.
The indexer runs continuously in the background; results improve as crawling progresses.` },
);

registerBrandResource(server);
registerCapabilitiesResource(server);

// ---------- Tool: start_filespace_indexer ----------

server.tool(
  "start_filespace_indexer",
  "Start the filespace indexer server (fs-index-server). This discovers LucidLink filespace mount points via the lucid CLI, then crawls and indexes all files into a SQLite FTS5 database for fast full-text search. The server runs on a configurable port (default 3201) and provides REST + SSE APIs for search, browsing, and index management. Do NOT attempt to rewrite this — always use this tool.",
  {
    port: z.number().optional().describe("Port to run on (default: 3201)"),
    lucid_bin: z.string().optional().describe("Path to lucid CLI binary (default: 'lucid')"),
    mount_prefix: z.string().optional().describe("Override mount prefix instead of auto-discovery"),
    db_path: z.string().optional().describe("Path for SQLite database (default: ~/.fs-index-server/index.db)"),
    crawl_workers: z.number().optional().describe("Number of parallel crawl workers (default: 16)"),
    max_depth: z.number().optional().describe("Maximum directory depth to crawl (default: 10)"),
  },
  async ({ port, lucid_bin, mount_prefix, db_path, crawl_workers, max_depth }) => {
    const { spawn } = await import("node:child_process");

    const found = findBinary();
    if (!found) {
      return err(
        "fs-index-server binary not found.\n\n" +
        "Build it with:\n" +
        "  cd fs-index-server && go build -o fs-index-server .\n\n" +
        "This is a compiled Go binary — do NOT attempt to rewrite it in another language."
      );
    }

    const { binaryPath, binaryDir } = found;
    const actualPort = port ?? 3201;

    // Check if already running
    try {
      const resp = await fetch(`http://localhost:${actualPort}/api/health`);
      if (resp.ok) {
        const mountResp = await fetch(`http://localhost:${actualPort}/api/mounts`);
        const mounts = await mountResp.json() as Array<{ Name: string; MountPoint: string; InstanceID: string }>;
        return ok(
          `fs-index-server is already running on port ${actualPort}.\n\n` +
          `Mounts: ${mounts.length > 0 ? mounts.map(m => `${m.Name} (${m.MountPoint})`).join(", ") : "none"}\n\n` +
          `Use search_filespace to search, browse_filespace to list directories, indexer_status for details.`
        );
      }
    } catch {
      // Not running — proceed to start
    }

    // Build environment
    const env: Record<string, string> = { ...process.env as Record<string, string> };
    if (port) env.FS_INDEX_PORT = String(port);
    if (lucid_bin) env.FS_INDEX_LUCID_BIN = lucid_bin;
    if (mount_prefix) env.FS_INDEX_MOUNT_PREFIX = mount_prefix;
    if (db_path) env.FS_INDEX_DB_PATH = db_path;
    if (crawl_workers) env.FS_INDEX_CRAWL_WORKERS = String(crawl_workers);
    if (max_depth) env.FS_INDEX_CRAWL_MAX_DEPTH = String(max_depth);

    // Spawn with stderr capture and CWD set to binary's directory (for template loading)
    const child = spawn(binaryPath, [], {
      env,
      cwd: binaryDir,
      detached: true,
      stdio: ["ignore", "ignore", "pipe"],
    });

    // Capture stderr for diagnostics
    let stderrOutput = "";
    child.stderr!.on("data", (chunk: Buffer) => {
      stderrOutput += chunk.toString();
      // Keep only last 2KB
      if (stderrOutput.length > 2048) {
        stderrOutput = stderrOutput.slice(-2048);
      }
    });

    // Detect early exit
    let exited = false;
    let exitCode: number | null = null;
    child.on("exit", (code) => {
      exited = true;
      exitCode = code;
    });

    child.unref();

    // Wait for server to be ready
    const maxWait = 15000;
    const start = Date.now();
    let ready = false;
    while (Date.now() - start < maxWait) {
      await new Promise(r => setTimeout(r, 500));

      // Check if process crashed
      if (exited) {
        return err(
          `fs-index-server crashed on startup (exit code ${exitCode}).\n\n` +
          `Binary: ${binaryPath}\n` +
          `Working dir: ${binaryDir}\n\n` +
          `Stderr output:\n${stderrOutput || "(no output)"}\n\n` +
          `Common causes:\n` +
          `  - Port ${actualPort} already in use\n` +
          `  - lucid CLI not found (install LucidLink or set lucid_bin parameter)\n` +
          `  - Template files missing from ${binaryDir}/templates/\n\n` +
          `This is a compiled Go binary — do NOT attempt to rewrite it. Fix the issue above and retry.`
        );
      }

      try {
        const resp = await fetch(`http://localhost:${actualPort}/api/health`);
        if (resp.ok) {
          ready = true;
          break;
        }
      } catch {
        // Not ready yet
      }
    }

    if (!ready) {
      // Detach stderr before returning
      child.stderr!.destroy();
      return err(
        `fs-index-server started (pid ${child.pid}) but health check failed after ${maxWait / 1000}s.\n\n` +
        `Binary: ${binaryPath}\n` +
        `Stderr output:\n${stderrOutput || "(no output)"}\n\n` +
        `The process may still be starting. Try indexer_status in a few seconds.`
      );
    }

    // Detach stderr now that server is healthy
    child.stderr!.destroy();

    // Fetch mount info
    let mountInfo = "";
    try {
      const resp = await fetch(`http://localhost:${actualPort}/api/mounts`);
      const mounts = await resp.json() as Array<{ Name: string; MountPoint: string; InstanceID: string }>;
      if (mounts.length > 0) {
        mountInfo = "\n\nDiscovered mounts:\n" +
          mounts.map(m => `  ${m.Name} -> ${m.MountPoint} (instance ${m.InstanceID})`).join("\n");
      } else {
        mountInfo = "\n\nNo filespace mounts discovered. Ensure LucidLink filespaces are connected.";
      }
    } catch {
      mountInfo = "\n\nCould not fetch mount info.";
    }

    return ok(
      `fs-index-server running on port ${actualPort} (pid ${child.pid})` +
      mountInfo +
      `\n\nUse search_filespace to search, browse_filespace to list directories, indexer_status for details.`
    );
  },
);

// ---------- Tool: search_filespace ----------

server.tool(
  "search_filespace",
  "Search indexed filespace contents using full-text search (FTS5). Returns matching files and directories with path, size, and modification time. Requires fs-index-server to be running (use start_filespace_indexer first). Do NOT attempt to build your own search — always use this tool.",
  {
    query: z.string().describe("Search query (supports prefix matching, e.g. 'project report')"),
    filespace: z.string().optional().describe("Filter by filespace name"),
    limit: z.number().optional().describe("Max results (default: 100, max: 500)"),
    port: z.number().optional().describe("Server port (default: 3201)"),
  },
  async ({ query, filespace, limit, port }) => {
    const actualPort = port ?? 3201;
    const params = new URLSearchParams({ q: query });
    if (limit) params.set("limit", String(limit));
    if (filespace) params.set("fs", filespace);

    try {
      const resp = await fetch(
        `http://localhost:${actualPort}/sse/search?${params}`,
        { headers: { Accept: "text/event-stream" } }
      );

      if (!resp.ok) {
        return err(`Search failed: ${resp.status} ${resp.statusText}`);
      }

      const body = await resp.text();

      // Parse SSE signals for result count
      const signalMatch = body.match(/_searchCount:\s*(\d+)/);
      const indexedMatch = body.match(/_indexedCount:\s*(\d+)/);
      const resultCount = signalMatch ? signalMatch[1] : "?";
      const indexedCount = indexedMatch ? indexedMatch[1] : "?";

      // Extract file paths from the HTML table rows
      const pathMatches = [...body.matchAll(/data-path="([^"]+)"/g)];
      const nameMatches = [...body.matchAll(/class="file-name">([^<]+)</g)];

      if (pathMatches.length === 0) {
        return ok(`No results found for "${query}" (${indexedCount} files indexed)`);
      }

      let output = `Found ${resultCount} results for "${query}" (${indexedCount} files indexed):\n\n`;
      for (let i = 0; i < pathMatches.length; i++) {
        const filePath = pathMatches[i][1];
        const name = nameMatches[i] ? nameMatches[i][1] : "";
        output += `  ${name || filePath}\n    ${filePath}\n`;
      }

      return ok(output);
    } catch (e) {
      return err(
        `Cannot connect to fs-index-server on port ${actualPort}.\n` +
        `Start it first with start_filespace_indexer.\n\n` +
        `Error: ${e instanceof Error ? e.message : String(e)}`
      );
    }
  },
);

// ---------- Tool: browse_filespace ----------

server.tool(
  "browse_filespace",
  "List contents of a directory in an indexed filespace. Returns files and subdirectories with size, created, and modified times.",
  {
    path: z.string().optional().describe("Directory path to list (default: mount prefix root)"),
    port: z.number().optional().describe("Server port (default: 3201)"),
  },
  async ({ path: dirPath, port }) => {
    const actualPort = port ?? 3201;
    const params = new URLSearchParams();
    if (dirPath) params.set("path", dirPath);

    try {
      const resp = await fetch(`http://localhost:${actualPort}/api/files?${params}`);
      if (!resp.ok) {
        return err(`Browse failed: ${resp.status} ${resp.statusText}`);
      }

      const data = await resp.json() as {
        path: string;
        entries: Array<{
          name: string;
          path: string;
          is_directory: boolean;
          size: number;
          modified_at?: string;
        }>;
      };

      if (!data.entries || data.entries.length === 0) {
        return ok(`Empty directory: ${data.path}`);
      }

      let output = `Contents of ${data.path} (${data.entries.length} items):\n\n`;
      const dirs = data.entries.filter(e => e.is_directory);
      const files = data.entries.filter(e => !e.is_directory);

      for (const d of dirs) {
        output += `  [DIR]  ${d.name}/\n`;
      }
      for (const f of files) {
        const size = f.size > 0 ? formatBytes(f.size) : "";
        output += `  ${f.name}  ${size}\n`;
      }

      return ok(output);
    } catch (e) {
      return err(
        `Cannot connect to fs-index-server on port ${actualPort}.\n` +
        `Error: ${e instanceof Error ? e.message : String(e)}`
      );
    }
  },
);

// ---------- Tool: indexer_status ----------

server.tool(
  "indexer_status",
  "Check the status of the filespace indexer — mount points, crawl progress, and indexed file counts.",
  {
    port: z.number().optional().describe("Server port (default: 3201)"),
  },
  async ({ port }) => {
    const actualPort = port ?? 3201;

    try {
      const [healthResp, mountsResp, statsResp, crawlResp] = await Promise.all([
        fetch(`http://localhost:${actualPort}/api/health`),
        fetch(`http://localhost:${actualPort}/api/mounts`),
        fetch(`http://localhost:${actualPort}/api/stats`),
        fetch(`http://localhost:${actualPort}/api/crawl/stats`),
      ]);

      if (!healthResp.ok) {
        return err("fs-index-server is not responding.");
      }

      const mounts = await mountsResp.json() as Array<{ Name: string; MountPoint: string; InstanceID: string }>;
      const stats = await statsResp.json() as { total_files: number; total_dirs: number };
      const crawl = await crawlResp.json() as {
        crawl: { pending: number; crawling: number; completed: number; failed: number; total: number };
        indexed_files: number;
        throughput?: { dirs_per_sec: number; files_per_sec: number; elapsed_sec: number; total_dirs: number; total_files: number };
      };

      let output = `fs-index-server status:\n\n`;
      output += `Indexed: ${crawl.indexed_files} files, ${stats.total_dirs} directories\n`;
      output += `Crawl queue: ${crawl.crawl.pending} pending, ${crawl.crawl.crawling} active, ${crawl.crawl.completed} done, ${crawl.crawl.failed} failed\n`;

      if (crawl.throughput) {
        output += `Throughput: ${crawl.throughput.files_per_sec.toFixed(0)} files/s, ${crawl.throughput.dirs_per_sec.toFixed(0)} dirs/s\n`;
        output += `Elapsed: ${Math.round(crawl.throughput.elapsed_sec)}s\n`;
      }

      output += `\nMounts (${mounts.length}):\n`;
      for (const m of mounts) {
        output += `  ${m.Name} -> ${m.MountPoint} (instance ${m.InstanceID})\n`;
      }

      return ok(output);
    } catch (e) {
      return err(
        `Cannot connect to fs-index-server on port ${actualPort}.\n` +
        `Start it first with start_filespace_indexer.\n\n` +
        `Error: ${e instanceof Error ? e.message : String(e)}`
      );
    }
  },
);

function formatBytes(bytes: number): string {
  if (bytes === 0) return "";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return (bytes / Math.pow(1024, i)).toFixed(1) + " " + units[i];
}

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
