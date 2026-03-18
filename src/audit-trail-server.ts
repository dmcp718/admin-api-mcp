/**
 * LucidLink Audit Trail MCP Server
 *
 * 5th MCP server — manages audit trail Docker Compose stack and queries
 * OpenSearch for file operation events (reads, writes, deletes, moves).
 *
 * Stack: OpenSearch + OpenSearch Dashboards + Fluent Bit
 * Data source: LucidLink .lucid_audit logs on mounted filespaces
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { registerBrandResource } from "./shared/brand-resource.js";
import { registerCapabilitiesResource } from "./shared/capabilities-resource.js";
import { registerDocsSearch } from "./docs/docs-search.js";
import { ok, err } from "./shared/formatters.js";
import { OpenSearchClient } from "./audit-trail/opensearch-client.js";
import { DockerManager, checkDocker } from "./audit-trail/docker-manager.js";
import { writeStackFiles } from "./audit-trail/stack-template.js";
import { AUDIT_TRAIL_INDEX, VALID_ACTIONS } from "./audit-trail/types.js";
import type { AuditEvent, SearchHit } from "./audit-trail/types.js";
import { discoverMounts } from "./audit-trail/mount-discovery.js";

import { existsSync } from "node:fs";
import { join } from "node:path";

const server = new McpServer(
  { name: "lucidlink-audit-trail", version: "1.0.0" },
  {
    instructions: `Audit trail analytics for LucidLink filespace file operation events.
Manages a Docker Compose stack: OpenSearch + OpenSearch Dashboards + Fluent Bit.

SETUP WORKFLOW (follow in order):
  1. discover_filespace_mounts — find mounted filespaces
  2. setup_audit_trail — generate stack files, configure mount point
  3. start_audit_trail — docker compose up, wait for health

IMPORTANT: The stack includes a pre-built OpenSearch Dashboards instance with saved visualizations
(user activity timeline, top users, event type distribution, most active paths).
Do NOT build or generate a custom dashboard — just direct the user to http://localhost:5601
once the stack is running. The dashboard is ready to use immediately.

AFTER START: Fluent Bit automatically ingests real audit logs from the .lucid_audit directory
on the mounted filespace. Events appear within 30 seconds. Do NOT call load_sample_data when a
real filespace is mounted — that tool is ONLY for demos with no filespace.

QUERY TOOLS (use after stack is running):
  search_audit_events — filter by user, action, path, time range
  get_user_activity — timeline for a specific user
  get_file_history — all operations on a file/directory
  count_audit_events — aggregate by user, action, path, or time`,
  },
);

registerBrandResource(server);
registerCapabilitiesResource(server);
registerDocsSearch(server);

// ── Helpers ──

const HOME = process.env.HOME ?? "";
const WORK_DIR = join(HOME, ".lucidlink", "audit-trail");

function getClient(): OpenSearchClient {
  return new OpenSearchClient();
}

function getDocker(): DockerManager {
  return new DockerManager(WORK_DIR);
}

function hasStack(): boolean {
  return existsSync(join(WORK_DIR, "docker-compose.yml"));
}

function formatEvent(hit: SearchHit): string {
  const e = hit._source;
  const ts = e["@timestamp"] ?? "";
  const user = e.user?.name ?? "unknown";
  const action = e.operation?.action ?? "";
  const path = e.operation?.entryPath ?? "";
  const target = e.operation?.targetPath ? ` -> ${e.operation.targetPath}` : "";
  const device = e.device?.hostName ? ` (${e.device.hostName})` : "";
  return `  ${ts}  ${user}${device}  ${action}  ${path}${target}`;
}

function formatSize(bytes: number): string {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return (bytes / Math.pow(1024, i)).toFixed(1) + " " + units[i];
}

// ── Mount Discovery ──

server.tool(
  "discover_filespace_mounts",
  "Discover mounted LucidLink filespaces using the lucid CLI. Returns instance IDs, filespace names, mount points, and ports. Call this FIRST before setup_audit_trail to find the correct mount point.",
  {
    lucid_bin: z
      .string()
      .optional()
      .describe("Path to lucid CLI binary (default: 'lucid')"),
  },
  async ({ lucid_bin }) => {
    try {
      const mounts = await discoverMounts(lucid_bin ?? "lucid");

      if (mounts.length === 0) {
        return err(
          "No LucidLink filespaces found.\n\n" +
            "Ensure a filespace is connected: lucid connect <filespace>\n" +
            "Then verify with: lucid list",
        );
      }

      let output = `Found ${mounts.length} mounted filespace(s):\n\n`;
      for (const m of mounts) {
        const hasAudit = existsSync(join(m.mountPoint, ".lucid_audit"));
        output += `  ${m.name}\n`;
        output += `    Mount point:  ${m.mountPoint}\n`;
        output += `    Instance ID:  ${m.instanceId}\n`;
        output += `    Port:         ${m.port}\n`;
        output += `    Audit logs:   ${hasAudit ? "yes (.lucid_audit found)" : "not found"}\n\n`;
      }

      const withAudit = mounts.filter((m) =>
        existsSync(join(m.mountPoint, ".lucid_audit")),
      );
      if (withAudit.length > 0) {
        output += `Ready for audit trail setup:\n`;
        for (const m of withAudit) {
          output += `  setup_audit_trail(fsmountpoint: "${m.mountPoint}")\n`;
        }
      } else {
        output +=
          "None of the mounted filespaces have .lucid_audit logs yet.\n" +
          "Audit logs appear after file operations are performed on the filespace.";
      }

      return ok(output);
    } catch (e) {
      return err(
        `Failed to discover mounts: ${e instanceof Error ? e.message : String(e)}\n\n` +
          "Ensure the lucid CLI is installed and in your PATH.\n" +
          "You can also provide the mount point manually to setup_audit_trail.",
      );
    }
  },
);

// ── Stack Management Tools ──

server.tool(
  "setup_audit_trail",
  "Generate the audit trail Docker Compose stack files and configure the filespace mount point. Validates Docker is running. Call this before start_audit_trail. If fsmountpoint is omitted, auto-discovers mounted filespaces via the lucid CLI.",
  {
    fsmountpoint: z
      .string()
      .optional()
      .describe(
        "Absolute path to the mounted LucidLink filespace (e.g., /Volumes/production). If omitted, auto-discovers via lucid CLI.",
      ),
  },
  async ({ fsmountpoint: fsMountArg }) => {
    // Auto-discover mount point if not provided
    let fsmountpoint = fsMountArg;
    if (!fsmountpoint) {
      try {
        const mounts = await discoverMounts();
        const withAudit = mounts.filter((m) =>
          existsSync(join(m.mountPoint, ".lucid_audit")),
        );
        const chosen = withAudit[0] ?? mounts[0];
        if (chosen) {
          fsmountpoint = chosen.mountPoint;
        } else {
          return err(
            "No mounted LucidLink filespaces found.\n\n" +
              "Connect a filespace first: lucid connect <filespace>\n" +
              "Or provide the mount point manually: setup_audit_trail(fsmountpoint: \"/Volumes/myfs\")",
          );
        }
      } catch {
        return err(
          "Could not auto-discover filespace mounts (lucid CLI not found?).\n\n" +
            "Provide the mount point manually: setup_audit_trail(fsmountpoint: \"/Volumes/myfs\")",
        );
      }
    }

    // Validate mount point exists
    if (!existsSync(fsmountpoint)) {
      return err(
        `Mount point not found: ${fsmountpoint}\n\n` +
          `Ensure the LucidLink filespace is connected and mounted.`,
      );
    }

    // Check Docker
    const dockerCheck = await checkDocker();
    if (!dockerCheck.success) {
      return err(
        `Docker is not running or not installed.\n\n` +
          `Install Docker Desktop and ensure it's running, then try again.\n` +
          `Error: ${dockerCheck.error}`,
      );
    }

    // Write stack files and configure .env
    writeStackFiles(WORK_DIR);
    const docker = getDocker();
    docker.configureEnv(fsmountpoint);

    return ok(
      `Audit trail configured.\n\n` +
        `Stack: ${WORK_DIR}\n` +
        `Mount point: ${fsmountpoint}\n` +
        `Docker: v${dockerCheck.output}\n\n` +
        `Next: call start_audit_trail to launch the stack.`,
    );
  },
);

server.tool(
  "start_audit_trail",
  "Start the audit trail Docker Compose stack (OpenSearch, Dashboards, Fluent Bit). Waits for services to be healthy. Dashboard available at http://localhost:5601 once ready.",
  {},
  async () => {
    if (!hasStack()) {
      return err(
        "Audit trail stack not found. Call setup_audit_trail first to generate it.",
      );
    }

    const docker = getDocker();
    const result = await docker.up();
    if (!result.success) {
      return err(`Failed to start audit trail stack:\n${result.error}`);
    }

    // Wait for OpenSearch health
    const client = getClient();
    let healthy = false;
    for (let i = 0; i < 30; i++) {
      await new Promise((r) => setTimeout(r, 2000));
      const health = await client.clusterHealth();
      if (health.success) {
        healthy = true;
        break;
      }
    }

    if (!healthy) {
      return ok(
        `Docker containers started but OpenSearch is still initializing.\n` +
          `Check status in a moment with audit_trail_status.\n\n` +
          `Dashboard: http://localhost:5601 (may take 1-2 minutes)`,
      );
    }

    // Wait for Fluent Bit to ingest real audit logs (up to 30s)
    let docCount = 0;
    for (let i = 0; i < 6; i++) {
      await new Promise((r) => setTimeout(r, 5000));
      const countResp = await client.count(undefined);
      if (countResp.success && countResp.data) {
        docCount = (countResp.data as { count?: number }).count ?? 0;
        if (docCount > 0) break;
      }
    }

    return ok(
      `Audit trail stack is running.\n\n` +
        `OpenSearch: http://localhost:9200 (healthy)\n` +
        `Dashboard:  http://localhost:5601 (pre-built, ready to use — do NOT build a custom one)\n` +
        `Documents:  ${docCount.toLocaleString()} audit events indexed\n` +
        (docCount === 0
          ? `\nFluent Bit is still ingesting logs from the .lucid_audit directory — events will appear shortly.\n` +
            `Do NOT call load_sample_data. Real audit data is being ingested automatically.\n`
          : `\nReal audit data ingested from .lucid_audit logs.\n`) +
        `\nDirect the user to open http://localhost:5601 in their browser.\n` +
        `The dashboard includes: User Activity Timeline, Top Users, Event Type Distribution, Most Active Paths.\n\n` +
        `Use search_audit_events, get_user_activity, or get_file_history to query data via MCP.`,
    );
  },
);

server.tool(
  "stop_audit_trail",
  "Stop the audit trail Docker Compose stack. Optionally remove data volumes.",
  {
    remove_volumes: z
      .boolean()
      .optional()
      .describe(
        "Remove data volumes (deletes all indexed data). Default: false",
      ),
  },
  async ({ remove_volumes }) => {
    if (!hasStack()) {
      return err("Audit trail stack not found. Call setup_audit_trail first.");
    }

    const docker = getDocker();
    const result = await docker.down(remove_volumes ?? false);
    if (!result.success) {
      return err(`Failed to stop stack:\n${result.error}`);
    }

    return ok(
      `Audit trail stack stopped.${remove_volumes ? " Data volumes removed." : " Data volumes preserved."}`,
    );
  },
);

server.tool(
  "audit_trail_status",
  "Check audit trail stack health — container states, OpenSearch cluster status, document count, and Dashboards reachability.",
  {},
  async () => {
    const client = getClient();

    let output = "Audit trail status:\n\n";

    // Check Docker containers
    if (hasStack()) {
      const docker = getDocker();
      const ps = await docker.ps();
      if (ps.success && ps.output) {
        output += `Containers:\n`;
        try {
          const lines = ps.output.trim().split("\n");
          for (const line of lines) {
            const c = JSON.parse(line) as {
              Name: string;
              State: string;
              Health?: string;
              Status?: string;
            };
            output += `  ${c.Name}: ${c.State}${c.Health ? ` (${c.Health})` : ""}\n`;
          }
        } catch {
          output += `  ${ps.output}\n`;
        }
      } else {
        output += "Containers: not running\n";
      }
    } else {
      output += "Stack: not found (run setup_audit_trail)\n";
    }

    // OpenSearch health
    const health = await client.clusterHealth();
    if (health.success && health.data) {
      const h = health.data as {
        status: string;
        number_of_nodes: number;
        active_shards: number;
      };
      output += `\nOpenSearch: ${h.status} (${h.number_of_nodes} node(s), ${h.active_shards} shards)\n`;
    } else {
      output += `\nOpenSearch: unreachable (${health.error})\n`;
    }

    // Doc count
    const exists = await client.indexExists();
    if (exists) {
      const countResp = await client.count(undefined);
      if (countResp.success && countResp.data) {
        const count = (countResp.data as { count: number }).count;
        output += `Documents: ${count.toLocaleString()} audit events\n`;
      }

      const statsResp = await client.indexStats();
      if (statsResp.success && statsResp.data) {
        const indices = (statsResp.data as { indices?: Record<string, { primaries?: { store?: { size_in_bytes?: number } } }> }).indices;
        const idx = indices?.[AUDIT_TRAIL_INDEX];
        if (idx?.primaries?.store?.size_in_bytes) {
          output += `Index size: ${formatSize(idx.primaries.store.size_in_bytes)}\n`;
        }
      }
    } else {
      output += `Index: audit-trail not found (no data yet)\n`;
    }

    // Dashboards reachability
    try {
      const resp = await fetch("http://localhost:5601/api/status");
      output += `\nDashboards: ${resp.ok ? "reachable" : `HTTP ${resp.status}`} (http://localhost:5601)\n`;
    } catch {
      output += `\nDashboards: unreachable\n`;
    }

    return ok(output);
  },
);

// ── OpenSearch Query Tools ──

server.tool(
  "search_audit_events",
  "Search audit trail events with filters. Supports filtering by user, action type, file path, and time range. Returns formatted event list.",
  {
    query: z
      .string()
      .optional()
      .describe("Full-text search query (searches paths and filenames)"),
    user: z.string().optional().describe("Filter by username (exact match)"),
    action: z
      .string()
      .optional()
      .describe(
        `Filter by action: ${VALID_ACTIONS.join(", ")}`,
      ),
    path: z
      .string()
      .optional()
      .describe("Filter by file/directory path (prefix match)"),
    time_range: z
      .string()
      .optional()
      .describe(
        'Time range: "1h", "24h", "7d", "30d", or ISO date range "2026-01-01/2026-01-31"',
      ),
    limit: z.number().optional().describe("Max results (default: 50, max: 200)"),
  },
  async ({ query, user, action, path, time_range, limit }) => {
    const client = getClient();
    const must: Record<string, unknown>[] = [];

    if (query) {
      must.push({
        multi_match: {
          query,
          fields: ["operation.entryPath", "operation.file", "user.name"],
        },
      });
    }
    if (user) {
      must.push({ term: { "user.name.keyword": user } });
    }
    if (action) {
      must.push({ term: { "operation.action.keyword": action } });
    }
    if (path) {
      must.push({ prefix: { "operation.entryPath.keyword": path } });
    }
    if (time_range) {
      const range: Record<string, string> = {};
      if (time_range.includes("/")) {
        const [from, to] = time_range.split("/");
        range.gte = from;
        range.lte = to;
      } else {
        range.gte = `now-${time_range}`;
      }
      must.push({ range: { "@timestamp": range } });
    }

    const searchQuery: Record<string, unknown> = {
      query:
        must.length > 0
          ? { bool: { must } }
          : { match_all: {} },
      sort: [{ "@timestamp": { order: "desc" } }],
    };

    const maxResults = Math.min(limit ?? 50, 200);
    const resp = await client.search(searchQuery, AUDIT_TRAIL_INDEX, maxResults);

    if (!resp.success) {
      return err(`Search failed: ${resp.error}`);
    }

    const data = resp.data as unknown as {
      hits: { total: { value: number }; hits: SearchHit[] };
    };
    const total = data.hits.total.value;
    const hits = data.hits.hits;

    if (hits.length === 0) {
      return ok("No audit events found matching the criteria.");
    }

    let output = `Found ${total.toLocaleString()} events (showing ${hits.length}):\n\n`;
    output += hits.map(formatEvent).join("\n");

    return ok(output);
  },
);

server.tool(
  "count_audit_events",
  "Count and aggregate audit events by user, action, path, or time bucket. Returns summary counts for analysis.",
  {
    group_by: z
      .enum(["user", "action", "path", "time"])
      .describe("Field to aggregate by"),
    time_range: z
      .string()
      .optional()
      .describe('Time range filter (e.g., "24h", "7d", "30d")'),
    interval: z
      .string()
      .optional()
      .describe('Time bucket interval when group_by=time (default: "1h")'),
    user: z.string().optional().describe("Filter by username"),
    action: z.string().optional().describe("Filter by action type"),
  },
  async ({ group_by, time_range, interval, user, action }) => {
    const client = getClient();
    const must: Record<string, unknown>[] = [];

    if (time_range) {
      must.push({ range: { "@timestamp": { gte: `now-${time_range}` } } });
    }
    if (user) {
      must.push({ term: { "user.name.keyword": user } });
    }
    if (action) {
      must.push({ term: { "operation.action.keyword": action } });
    }

    const fieldMap: Record<string, unknown> = {
      user: { terms: { field: "user.name.keyword", size: 50 } },
      action: { terms: { field: "operation.action.keyword", size: 20 } },
      path: { terms: { field: "operation.entryPath.keyword", size: 50 } },
      time: {
        date_histogram: {
          field: "@timestamp",
          fixed_interval: interval ?? "1h",
        },
      },
    };

    const searchQuery: Record<string, unknown> = {
      size: 0,
      query: must.length > 0 ? { bool: { must } } : { match_all: {} },
      aggs: { breakdown: fieldMap[group_by] },
    };

    const resp = await client.search(searchQuery);
    if (!resp.success) {
      return err(`Aggregation failed: ${resp.error}`);
    }

    const data = resp.data as unknown as {
      hits: { total: { value: number } };
      aggregations: {
        breakdown: { buckets: Array<{ key: string; key_as_string?: string; doc_count: number }> };
      };
    };

    const total = data.hits.total.value;
    const buckets = data.aggregations?.breakdown?.buckets ?? [];

    let output = `Total events: ${total.toLocaleString()}\n\nBreakdown by ${group_by}:\n\n`;
    for (const b of buckets) {
      const label = b.key_as_string ?? b.key;
      output += `  ${label}: ${b.doc_count.toLocaleString()}\n`;
    }

    return ok(output);
  },
);

server.tool(
  "get_user_activity",
  "Get a timeline of a specific user's file operations. Shows recent activity with timestamps, actions, and paths.",
  {
    username: z.string().describe("Username to look up"),
    time_range: z
      .string()
      .optional()
      .describe('Time range (default: "24h")'),
    limit: z.number().optional().describe("Max events (default: 50)"),
  },
  async ({ username, time_range, limit }) => {
    const client = getClient();
    const must: Record<string, unknown>[] = [
      { term: { "user.name.keyword": username } },
    ];

    if (time_range) {
      must.push({
        range: { "@timestamp": { gte: `now-${time_range ?? "24h"}` } },
      });
    } else {
      must.push({ range: { "@timestamp": { gte: "now-24h" } } });
    }

    const searchQuery: Record<string, unknown> = {
      query: { bool: { must } },
      sort: [{ "@timestamp": { order: "desc" } }],
      aggs: {
        by_action: { terms: { field: "operation.action.keyword" } },
        by_device: { terms: { field: "device.hostName.keyword", size: 10 } },
      },
    };

    const maxResults = Math.min(limit ?? 50, 200);
    const resp = await client.search(searchQuery, AUDIT_TRAIL_INDEX, maxResults);

    if (!resp.success) {
      return err(`Query failed: ${resp.error}`);
    }

    const data = resp.data as unknown as {
      hits: { total: { value: number }; hits: SearchHit[] };
      aggregations: {
        by_action: { buckets: Array<{ key: string; doc_count: number }> };
        by_device: { buckets: Array<{ key: string; doc_count: number }> };
      };
    };

    const total = data.hits.total.value;
    const hits = data.hits.hits;

    if (hits.length === 0) {
      return ok(
        `No activity found for user "${username}" in the specified time range.`,
      );
    }

    let output = `Activity for ${username} (${total.toLocaleString()} events):\n\n`;

    // Summary
    const actions = data.aggregations?.by_action?.buckets ?? [];
    if (actions.length > 0) {
      output += "Actions: " + actions.map((a) => `${a.key} (${a.doc_count})`).join(", ") + "\n";
    }
    const devices = data.aggregations?.by_device?.buckets ?? [];
    if (devices.length > 0) {
      output += "Devices: " + devices.map((d) => d.key).join(", ") + "\n";
    }

    output += `\nRecent events:\n`;
    output += hits.map(formatEvent).join("\n");

    return ok(output);
  },
);

server.tool(
  "get_file_history",
  "Get all operations performed on a specific file or directory path. Shows who did what and when.",
  {
    path: z
      .string()
      .describe(
        "File or directory path to look up (exact or prefix match)",
      ),
    exact: z
      .boolean()
      .optional()
      .describe("Exact path match (default: false, uses prefix match)"),
    time_range: z
      .string()
      .optional()
      .describe('Time range (default: "30d")'),
    limit: z.number().optional().describe("Max events (default: 50)"),
  },
  async ({ path: filePath, exact, time_range, limit }) => {
    const client = getClient();
    const must: Record<string, unknown>[] = [];

    if (exact) {
      must.push({ term: { "operation.entryPath.keyword": filePath } });
    } else {
      must.push({ prefix: { "operation.entryPath.keyword": filePath } });
    }

    must.push({
      range: { "@timestamp": { gte: `now-${time_range ?? "30d"}` } },
    });

    const searchQuery: Record<string, unknown> = {
      query: { bool: { must } },
      sort: [{ "@timestamp": { order: "desc" } }],
      aggs: {
        by_user: { terms: { field: "user.name.keyword", size: 20 } },
        by_action: { terms: { field: "operation.action.keyword" } },
      },
    };

    const maxResults = Math.min(limit ?? 50, 200);
    const resp = await client.search(searchQuery, AUDIT_TRAIL_INDEX, maxResults);

    if (!resp.success) {
      return err(`Query failed: ${resp.error}`);
    }

    const data = resp.data as unknown as {
      hits: { total: { value: number }; hits: SearchHit[] };
      aggregations: {
        by_user: { buckets: Array<{ key: string; doc_count: number }> };
        by_action: { buckets: Array<{ key: string; doc_count: number }> };
      };
    };

    const total = data.hits.total.value;
    const hits = data.hits.hits;

    if (hits.length === 0) {
      return ok(`No operations found for path "${filePath}".`);
    }

    let output = `History for ${filePath} (${total.toLocaleString()} events):\n\n`;

    const users = data.aggregations?.by_user?.buckets ?? [];
    if (users.length > 0) {
      output += "Users: " + users.map((u) => `${u.key} (${u.doc_count})`).join(", ") + "\n";
    }
    const actions = data.aggregations?.by_action?.buckets ?? [];
    if (actions.length > 0) {
      output += "Actions: " + actions.map((a) => `${a.key} (${a.doc_count})`).join(", ") + "\n";
    }

    output += `\nEvents:\n`;
    output += hits.map(formatEvent).join("\n");

    return ok(output);
  },
);

server.tool(
  "run_opensearch_query",
  "Execute a raw OpenSearch query DSL against the audit-trail index. For advanced users who need custom aggregations or complex queries.",
  {
    query: z
      .string()
      .describe(
        "OpenSearch query DSL as a JSON string. Example: {\"query\":{\"match_all\":{}},\"size\":10}",
      ),
    index: z
      .string()
      .optional()
      .describe("Index name (default: audit-trail)"),
  },
  async ({ query: queryStr, index }) => {
    const client = getClient();

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(queryStr);
    } catch (e) {
      return err(`Invalid JSON: ${e instanceof Error ? e.message : String(e)}`);
    }

    const resp = await client.search(
      parsed,
      index ?? AUDIT_TRAIL_INDEX,
      (parsed as { size?: number }).size ?? 50,
    );

    if (!resp.success) {
      return err(`Query failed: ${resp.error}`);
    }

    return ok(JSON.stringify(resp.data, null, 2));
  },
);

// ── Alerting & Slack Tools ──

server.tool(
  "create_audit_alert",
  "Create an OpenSearch monitor that alerts on matching audit events. Optionally sends Slack notifications.",
  {
    name: z.string().describe("Alert name"),
    action: z
      .string()
      .optional()
      .describe("Action to monitor (e.g., FileDelete)"),
    path: z
      .string()
      .optional()
      .describe("Path prefix to monitor (e.g., /Projects/)"),
    user: z.string().optional().describe("User to monitor"),
    interval_minutes: z
      .number()
      .optional()
      .describe("Check interval in minutes (default: 5)"),
    threshold: z
      .number()
      .optional()
      .describe("Minimum event count to trigger (default: 1)"),
  },
  async ({ name, action, path, user, interval_minutes, threshold }) => {
    const client = getClient();
    const must: Record<string, unknown>[] = [
      { range: { "@timestamp": { gte: `now-${interval_minutes ?? 5}m` } } },
    ];

    if (action) must.push({ term: { "operation.action.keyword": action } });
    if (path) must.push({ prefix: { "operation.entryPath.keyword": path } });
    if (user) must.push({ term: { "user.name.keyword": user } });

    const monitor = {
      name,
      type: "monitor",
      enabled: true,
      schedule: {
        period: { interval: interval_minutes ?? 5, unit: "MINUTES" },
      },
      inputs: [
        {
          search: {
            indices: [AUDIT_TRAIL_INDEX],
            query: {
              size: 0,
              query: { bool: { must } },
            },
          },
        },
      ],
      triggers: [
        {
          query_level_trigger: {
            name: `${name} trigger`,
            severity: "2",
            condition: {
              script: {
                source: `ctx.results[0].hits.total.value > ${threshold ?? 0}`,
                lang: "painless",
              },
            },
            actions: [],
          },
        },
      ],
    };

    const resp = await client.createMonitor(monitor);
    if (!resp.success) {
      return err(`Failed to create alert: ${resp.error}`);
    }

    const monitorId = (resp.data as { _id?: string })?._id ?? "unknown";
    return ok(
      `Alert "${name}" created (ID: ${monitorId}).\n\n` +
        `Checks every ${interval_minutes ?? 5} minutes for events matching:\n` +
        (action ? `  Action: ${action}\n` : "") +
        (path ? `  Path: ${path}\n` : "") +
        (user ? `  User: ${user}\n` : "") +
        `  Threshold: > ${threshold ?? 0} events\n\n` +
        `View in Dashboards: http://localhost:5601/_plugins/_alerting`,
    );
  },
);

server.tool(
  "list_audit_alerts",
  "List all active audit trail alert monitors.",
  {},
  async () => {
    const client = getClient();
    const resp = await client.listMonitors();

    if (!resp.success) {
      return err(`Failed to list alerts: ${resp.error}`);
    }

    const data = resp.data as unknown as {
      hits: {
        total: { value: number };
        hits: Array<{
          _id: string;
          _source: { name: string; enabled: boolean; schedule: { period: { interval: number; unit: string } } };
        }>;
      };
    };

    const monitors = data.hits?.hits ?? [];
    if (monitors.length === 0) {
      return ok("No alert monitors configured.");
    }

    let output = `Alert monitors (${monitors.length}):\n\n`;
    for (const m of monitors) {
      const s = m._source;
      output += `  ${s.name} (${m._id})\n`;
      output += `    Enabled: ${s.enabled}, Interval: ${s.schedule.period.interval} ${s.schedule.period.unit}\n`;
    }

    return ok(output);
  },
);

server.tool(
  "delete_audit_alert",
  "Delete an audit trail alert monitor by ID.",
  {
    monitor_id: z.string().describe("Monitor ID to delete"),
  },
  async ({ monitor_id }) => {
    const client = getClient();
    const resp = await client.deleteMonitor(monitor_id);

    if (!resp.success) {
      return err(`Failed to delete alert: ${resp.error}`);
    }

    return ok(`Alert monitor ${monitor_id} deleted.`);
  },
);

server.tool(
  "setup_slack_webhook",
  "Register a Slack webhook URL for audit trail alert notifications.",
  {
    name: z.string().describe("Channel name (e.g., 'engineering-alerts')"),
    webhook_url: z
      .string()
      .describe("Slack webhook URL (https://hooks.slack.com/services/...)"),
  },
  async ({ name, webhook_url }) => {
    const client = getClient();
    const resp = await client.createWebhookChannel(name, webhook_url);

    if (!resp.success) {
      return err(`Failed to register webhook: ${resp.error}`);
    }

    return ok(
      `Slack webhook "${name}" registered.\n\n` +
        `You can now reference this channel when creating alerts in OpenSearch Dashboards.\n` +
        `Alerting UI: http://localhost:5601/_plugins/_alerting`,
    );
  },
);

// ── Data Tools ──

server.tool(
  "load_sample_data",
  "ONLY for testing when NO real filespace is mounted. Do NOT call this if a filespace is mounted — Fluent Bit automatically ingests real audit logs from .lucid_audit. Generates fake sample events for demo purposes.",
  {
    count: z
      .number()
      .optional()
      .describe("Number of sample events to generate (default: 500)"),
    days: z
      .number()
      .optional()
      .describe("Spread events over this many days (default: 7)"),
  },
  async ({ count, days }) => {
    const client = getClient();
    const numEvents = count ?? 500;
    const numDays = days ?? 7;

    const users = [
      "alice.smith",
      "bob.jones",
      "carol.chen",
      "dave.wilson",
      "eve.davis",
    ];
    const actions = [
      "FileRead",
      "FileWritten",
      "FileCreate",
      "FileDelete",
      "DirectoryCreate",
      "Move",
    ];
    const basePaths = [
      "/Projects/design",
      "/Projects/video",
      "/Documents/reports",
      "/Shared/assets",
      "/Archive/2025",
    ];
    const extensions = [
      ".psd",
      ".mov",
      ".pdf",
      ".jpg",
      ".png",
      ".docx",
      ".mp4",
      ".aep",
    ];
    const devices = [
      "alice-macbook",
      "bob-workstation",
      "carol-laptop",
      "dave-desktop",
      "eve-macbook",
    ];

    const now = Date.now();
    const msPerDay = 86_400_000;
    let ndjson = "";

    for (let i = 0; i < numEvents; i++) {
      const userIdx = i % users.length;
      const ts = new Date(
        now - Math.random() * numDays * msPerDay,
      ).toISOString();
      const actionType = actions[Math.floor(Math.random() * actions.length)];
      const basePath =
        basePaths[Math.floor(Math.random() * basePaths.length)];
      const ext = extensions[Math.floor(Math.random() * extensions.length)];
      const filename = `file-${String(i).padStart(4, "0")}${ext}`;
      const entryPath = `${basePath}/${filename}`;

      const event: AuditEvent = {
        "@timestamp": ts,
        user: { name: users[userIdx], id: `${users[userIdx]}@company.com` },
        device: {
          hostName: devices[userIdx],
          osName: "macOS",
          osVersion: "14.2.0",
        },
        event: { filespace: "demo-filespace" },
        operation: {
          action: actionType,
          entryPath,
          file: filename,
        },
      };

      ndjson += JSON.stringify({ index: { _index: AUDIT_TRAIL_INDEX } }) + "\n";
      ndjson += JSON.stringify(event) + "\n";

      // Bulk in batches of 500
      if ((i + 1) % 500 === 0 || i === numEvents - 1) {
        const bulkResp = await client.bulk(ndjson);
        if (!bulkResp.success) {
          return err(
            `Failed to index events at batch ${Math.ceil((i + 1) / 500)}:\n${bulkResp.error}`,
          );
        }
        ndjson = "";
      }
    }

    return ok(
      `Loaded ${numEvents.toLocaleString()} sample audit events spanning ${numDays} days.\n\n` +
        `Users: ${users.join(", ")}\n` +
        `Actions: ${actions.join(", ")}\n\n` +
        `Use search_audit_events or count_audit_events to query the data.`,
    );
  },
);

server.tool(
  "get_audit_trail_schema",
  "Return the full field mapping of the audit-trail index. Shows all available fields and their types for building queries.",
  {},
  async () => {
    const client = getClient();
    const resp = await client.getMapping();

    if (!resp.success) {
      return err(`Failed to get mapping: ${resp.error}`);
    }

    return ok(
      `Audit trail index mapping:\n\n${JSON.stringify(resp.data, null, 2)}`,
    );
  },
);

// ── Main ──

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
