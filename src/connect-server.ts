/**
 * LucidLink Connect API MCP Server (v2 — TypeScript)
 *
 * Provides access to LucidLink Connect API: filesystem entries,
 * external data stores, and external entries (bring-your-own-bucket).
 * No Docker required — runs the API as a native Node.js child process.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import { ApiClient } from "./shared/api-client.js";
import { getBearerToken, storeBearerToken } from "./shared/keychain.js";
import {
  ensureApiRunning,
  isApiRunning,
  getApiLogs,
} from "./shared/process-manager.js";
import { formatSuccess, formatError } from "./shared/formatters.js";
import {
  ensureFolderPath,
  importS3Object,
  bulkImportS3Objects,
} from "./connect/workflow-tools.js";
import { generateConnectUI, GeneratedProject } from "./connect/ui-template.js";

// ── Workflow guide (no token needed) ──

const CONNECT_WORKFLOW_GUIDE = `LucidLink Connect MCP Server — Workflow Guide
=============================================

WHAT IS LUCIDLINK CONNECT?
LucidLink Connect links existing S3 objects into a filespace as read-only "external entries"
without copying data. S3 credentials need only s3:GetObject permission.

TWO-PART SYSTEM:
- Data Stores — S3 bucket connection credentials (stored per-filespace, encrypted)
- External Entries — filespace metadata records pointing to individual S3 objects

QUICKSTART (3 steps):
  Step 1: Create a data store
    tool: create_data_store
    required: filespace_id, name, access_key, secret_key, bucket_name, use_virtual_addressing

  Step 2: Ensure folder structure exists (use high-level tool)
    tool: ensure_folder_path
    required: filespace_id, path (e.g. "/videos/2024")

  Step 3: Link S3 objects
    tool: import_s3_object (one at a time)
      OR
    tool: bulk_import_s3_objects (many at once)

HIGH-LEVEL WORKFLOW TOOLS (recommended):
  - ensure_folder_path   — creates /a/b/c directory hierarchy in one call
  - import_s3_object     — ensures dirs + links one S3 object
  - bulk_import_s3_objects — ensures dirs + links many objects, reports results
  - create_connect_ui  — generates a browser-based import UI (no Claude needed)

PRIMITIVE API TOOLS (for fine-grained control):
  Entries:         create_entry, resolve_entry, get_entry, delete_entry, list_entry_children
  Data Stores:     create_data_store, list_data_stores, get_data_store, update_data_store, delete_data_store
  External Entries: create_external_entry, list_external_entry_ids, delete_external_entry

LIMITATIONS:
  - Read-only (external entries cannot be written to)
  - Individual object linking (no bucket-level mount)
  - S3 only (other clouds planned)
  - Delete removes filespace entry only (not S3 object)
  - Copy creates a native LucidLink file (no longer external)

ROTATING CREDENTIALS:
  Use update_data_store with new access_key + secret_key (PATCH endpoint)

COMMON ERRORS:
  409 on create_entry -> folder already exists, use resolve_entry to get its ID
  404 on resolve_entry -> path doesn't exist, use create_entry on parent
  401 -> bearer token expired, re-run initialize_api`;

// ── Lazy API client ──

let apiClient: ApiClient | null = null;

function getClient(): ApiClient {
  if (apiClient) return apiClient;
  const token = getBearerToken();
  if (!token) {
    throw new Error(
      "No bearer token found. Store one in macOS Keychain (service: lucidlink-mcp) or set LUCIDLINK_BEARER_TOKEN.",
    );
  }
  apiClient = new ApiClient(token);
  return apiClient;
}

async function ensureReady(): Promise<string | null> {
  const result = await ensureApiRunning();
  if (!result.ok) return result.error ?? "Failed to start API process.";
  return null;
}

function text(s: string) {
  return { content: [{ type: "text" as const, text: s }] };
}

// ── Server ──

const server = new McpServer({
  name: "lucidlink-connect-api",
  version: "2.0.0",
});

// ── Process Management ──

server.tool(
  "check_api_status",
  "Check if the LucidLink API process is running and healthy",
  {},
  async () => {
    const running = await isApiRunning();
    if (running) {
      return text(formatSuccess("API Status", { status: "Running", endpoint: "http://localhost:3003/api/v1" }));
    }
    return text("API is not running. It will be started automatically when you make an API call.");
  },
);

server.tool(
  "view_api_logs",
  "View recent logs from the LucidLink API process",
  { lines: z.number().optional().describe("Number of log lines (default 50)") },
  async ({ lines }) => {
    const logs = getApiLogs(lines ?? 50);
    return text(logs || "No logs available.");
  },
);

// ── Auth ──

server.tool(
  "initialize_api",
  "Initialize the API client with a bearer token (stores in macOS Keychain)",
  { token: z.string().optional().describe("Bearer token (optional — uses stored token if not provided)") },
  async ({ token }) => {
    const t = token || getBearerToken();
    if (!t) return text(formatError("Initialize API", "No bearer token provided or found in Keychain."));

    if (token) storeBearerToken(token);
    apiClient = new ApiClient(t);

    const err = await ensureReady();
    if (err) return text(formatError("Initialize API", err));

    const health = await apiClient.getHealth();
    return health.success
      ? text(formatSuccess("API Initialized", { status: "Connected", endpoint: "http://localhost:3003/api/v1" }))
      : text(formatError("Initialize API", health.error ?? "Failed to connect"));
  },
);

// ── Tools that need NO token ──

server.tool(
  "get_connect_workflow_guide",
  "Return step-by-step guide for the LucidLink Connect import workflow (no token needed)",
  {},
  async () => text(CONNECT_WORKFLOW_GUIDE),
);

server.tool(
  "create_connect_ui",
  "REQUIRED when user asks to create, generate, build, or launch a UI, interface, dashboard, or app for LucidLink Connect. This tool generates a complete ready-to-use web application with S3 browser — do NOT build a UI manually, always use this tool instead. It writes files, installs dependencies, starts the server, and opens the browser automatically.",
  {
    filespace_id: z.string().optional().describe("Pre-fill filespace ID"),
    data_store_id: z.string().optional().describe("Pre-fill data store ID"),
    output_dir: z.string().optional().describe("Directory to write files to (default: ~/Desktop/connect-ui)"),
  },
  async ({ filespace_id, data_store_id, output_dir }) => {
    const project = generateConnectUI(filespace_id ?? "", data_store_id ?? "");

    const fs = await import("node:fs");
    const path = await import("node:path");
    const os = await import("node:os");
    const { execSync, spawn } = await import("node:child_process");

    // Expand ~ to home directory, default to ~/Desktop/connect-ui
    const raw = output_dir || "~/Desktop/connect-ui";
    const dir = raw.replace(/^~(?=$|\/)/, os.homedir()).replace(/\/+$/, "");

    // Write project files
    for (const [relPath, content] of Object.entries(project.files)) {
      const fullPath = path.join(dir, relPath);
      const parentDir = path.dirname(fullPath);
      fs.mkdirSync(parentDir, { recursive: true });
      fs.writeFileSync(fullPath, content, "utf-8");
    }

    // Install dependencies
    try {
      execSync("npm install --production", { cwd: dir, stdio: "pipe", timeout: 60000 });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      return text(`Generated files in ${dir}/ but npm install failed:\n${msg}\n\nTry manually: cd ${dir} && npm install && node server.js`);
    }

    // Launch server in background (detached so it survives MCP server restart)
    const serverProcess = spawn("node", ["server.js"], {
      cwd: dir,
      detached: true,
      stdio: "ignore",
    });
    serverProcess.unref();

    // Wait briefly for server to start
    await new Promise((r) => setTimeout(r, 1500));

    return text(
      `Connect UI is running at http://localhost:8080\n\n` +
      `Project files: ${dir}/\n` +
      Object.keys(project.files).map((f) => `  ${f}`).join("\n") +
      `\n\nThe server is running in the background. To stop it: kill ${serverProcess.pid}`,
    );
  },
);

// ── Filesystem Entry Tools ──

server.tool(
  "create_entry",
  "Create a new directory inside a filespace",
  {
    filespace_id: z.string().describe("Filespace ID"),
    parent_id: z.string().describe("Parent directory entry ID"),
    name: z.string().describe("New directory name"),
  },
  async ({ filespace_id, parent_id, name }) => {
    const err = await ensureReady();
    if (err) return text(formatError("Create Entry", err));

    const res = await getClient().createEntry(filespace_id, parent_id, name);
    return res.success
      ? text(formatSuccess(`Created directory '${name}'`, res.data ?? {}))
      : text(formatError("Create Entry", res.error ?? "Unknown error"));
  },
);

server.tool(
  "resolve_entry",
  "Look up a filesystem entry by path",
  {
    filespace_id: z.string().describe("Filespace ID"),
    path: z.string().describe("Full filesystem path (e.g. /reports/q3/)"),
  },
  async ({ filespace_id, path }) => {
    const err = await ensureReady();
    if (err) return text(formatError("Resolve Entry", err));

    const res = await getClient().resolveEntry(filespace_id, path);
    return res.success
      ? text(formatSuccess(`Resolved path '${path}'`, res.data ?? {}))
      : text(formatError("Resolve Entry", res.error ?? "Unknown error"));
  },
);

server.tool(
  "get_entry",
  "Get details about a filesystem entry by ID",
  {
    filespace_id: z.string().describe("Filespace ID"),
    entry_id: z.string().describe("Filesystem entry ID"),
  },
  async ({ filespace_id, entry_id }) => {
    const err = await ensureReady();
    if (err) return text(formatError("Get Entry", err));

    const res = await getClient().getEntry(filespace_id, entry_id);
    return res.success
      ? text(formatSuccess("Entry Details", res.data ?? {}))
      : text(formatError("Get Entry", res.error ?? "Unknown error"));
  },
);

server.tool(
  "delete_entry",
  "Delete a filesystem entry (directory must be empty)",
  {
    filespace_id: z.string().describe("Filespace ID"),
    entry_id: z.string().describe("Entry ID to delete"),
    confirm: z.boolean().describe("Must be true to proceed"),
  },
  async ({ filespace_id, entry_id, confirm }) => {
    if (!confirm) return text("Deletion not confirmed. Set confirm=true to proceed.");

    const err = await ensureReady();
    if (err) return text(formatError("Delete Entry", err));

    const res = await getClient().deleteEntry(filespace_id, entry_id);
    return res.success
      ? text(formatSuccess("Deleted Entry", { entry_id }))
      : text(formatError("Delete Entry", res.error ?? "Unknown error"));
  },
);

server.tool(
  "list_entry_children",
  "List the contents of a directory in a filespace",
  {
    filespace_id: z.string().describe("Filespace ID"),
    entry_id: z.string().describe("Directory entry ID"),
    limit: z.number().optional().describe("Max entries to return"),
    next_cursor: z.string().optional().describe("Pagination cursor"),
  },
  async ({ filespace_id, entry_id, limit, next_cursor }) => {
    const err = await ensureReady();
    if (err) return text(formatError("List Entry Children", err));

    const res = await getClient().listEntryChildren(filespace_id, entry_id, {
      limit,
      nextCursor: next_cursor,
    });
    if (!res.success) return text(formatError("List Entry Children", res.error ?? "Unknown error"));

    const inner = (res.data as Record<string, unknown>)?.data as Record<string, unknown> | undefined;
    const entries = (inner?.entries ?? []) as Record<string, unknown>[];
    const nextCur = inner?.nextCursor as string | undefined;

    if (entries.length === 0) return text("Directory is empty.");

    let list = entries.map((e) =>
      `- [${e.type ?? "?"}] ${e.name ?? "?"} (ID: ${e.id ?? "N/A"})`,
    ).join("\n");
    let msg = `${entries.length} item(s):\n\n${list}`;
    if (nextCur) msg += `\n\nMore results available. Use next_cursor='${nextCur}' to continue.`;
    return text(msg);
  },
);

// ── Data Store Tools ──

server.tool(
  "create_data_store",
  "Create an S3 external data store for a filespace",
  {
    filespace_id: z.string().describe("Filespace ID"),
    name: z.string().describe("Data store name"),
    access_key: z.string().describe("S3 access key ID"),
    secret_key: z.string().describe("S3 secret access key"),
    bucket_name: z.string().describe("S3 bucket name"),
    use_virtual_addressing: z.boolean().describe("Virtual-hosted addressing (true for AWS S3)"),
    region: z.string().optional().describe("AWS region"),
    endpoint: z.string().optional().describe("Custom S3-compatible endpoint URL"),
    url_expiration_minutes: z.number().optional().describe("Pre-signed URL expiration in minutes"),
  },
  async ({ filespace_id, name, access_key, secret_key, bucket_name, use_virtual_addressing, region, endpoint, url_expiration_minutes }) => {
    const err = await ensureReady();
    if (err) return text(formatError("Create Data Store", err));

    const s3Params: Record<string, unknown> = {
      accessKey: access_key,
      secretKey: secret_key,
      bucketName: bucket_name,
      useVirtualAddressing: use_virtual_addressing,
    };
    if (region) s3Params.region = region;
    if (endpoint) s3Params.endpoint = endpoint;
    if (url_expiration_minutes != null) s3Params.urlExpirationMinutes = url_expiration_minutes;

    const res = await getClient().createDataStore(filespace_id, {
      name,
      kind: "S3DataStore",
      s3StorageParams: s3Params,
    });
    return res.success
      ? text(formatSuccess(`Created data store '${name}'`, res.data ?? {}))
      : text(formatError("Create Data Store", res.error ?? "Unknown error"));
  },
);

server.tool(
  "list_data_stores",
  "List external data stores configured for a filespace",
  {
    filespace_id: z.string().describe("Filespace ID"),
    name: z.string().optional().describe("Filter by data store name"),
  },
  async ({ filespace_id, name }) => {
    const err = await ensureReady();
    if (err) return text(formatError("List Data Stores", err));

    const res = await getClient().listDataStores(filespace_id, name);
    if (!res.success) return text(formatError("List Data Stores", res.error ?? "Unknown error"));

    const stores = (res.data as Record<string, unknown>)?.data as Record<string, unknown>[] ?? [];
    if (stores.length === 0) return text("No data stores found for this filespace.");

    const list = stores.map((s) =>
      `- ${s.name ?? "Unknown"} (ID: ${s.id ?? "N/A"}, kind: ${s.kind ?? "N/A"})`,
    ).join("\n");
    return text(`${stores.length} data store(s):\n\n${list}`);
  },
);

server.tool(
  "get_data_store",
  "Get details about a specific external data store",
  {
    filespace_id: z.string().describe("Filespace ID"),
    data_store_id: z.string().describe("Data store ID"),
  },
  async ({ filespace_id, data_store_id }) => {
    const err = await ensureReady();
    if (err) return text(formatError("Get Data Store", err));

    const res = await getClient().getDataStore(filespace_id, data_store_id);
    return res.success
      ? text(formatSuccess("Data Store Details", res.data ?? {}))
      : text(formatError("Get Data Store", res.error ?? "Unknown error"));
  },
);

server.tool(
  "update_data_store",
  "Update credentials for an external data store",
  {
    filespace_id: z.string().describe("Filespace ID"),
    data_store_id: z.string().describe("Data store ID"),
    access_key: z.string().describe("New S3 access key ID"),
    secret_key: z.string().describe("New S3 secret access key"),
  },
  async ({ filespace_id, data_store_id, access_key, secret_key }) => {
    const err = await ensureReady();
    if (err) return text(formatError("Update Data Store", err));

    const res = await getClient().updateDataStore(filespace_id, data_store_id, {
      s3StorageParams: { accessKey: access_key, secretKey: secret_key },
    });
    return res.success
      ? text(formatSuccess("Updated Data Store Credentials", res.data ?? {}))
      : text(formatError("Update Data Store", res.error ?? "Unknown error"));
  },
);

server.tool(
  "delete_data_store",
  "Delete an external data store from a filespace",
  {
    filespace_id: z.string().describe("Filespace ID"),
    data_store_id: z.string().describe("Data store ID to delete"),
    confirm: z.boolean().describe("Must be true to proceed"),
  },
  async ({ filespace_id, data_store_id, confirm }) => {
    if (!confirm) return text("Deletion not confirmed. Set confirm=true to proceed.");

    const err = await ensureReady();
    if (err) return text(formatError("Delete Data Store", err));

    const res = await getClient().deleteDataStore(filespace_id, data_store_id);
    return res.success
      ? text(formatSuccess("Deleted Data Store", { data_store_id }))
      : text(formatError("Delete Data Store", res.error ?? "Unknown error"));
  },
);

// ── External Entry Tools ──

server.tool(
  "create_external_entry",
  "Create an external file entry backed by an S3 object",
  {
    filespace_id: z.string().describe("Filespace ID"),
    path: z.string().describe("Filesystem path (e.g. /videos/clip.mp4)"),
    data_store_id: z.string().describe("Data store ID"),
    object_id: z.string().describe("Object key/ID within the bucket"),
  },
  async ({ filespace_id, path, data_store_id, object_id }) => {
    const err = await ensureReady();
    if (err) return text(formatError("Create External Entry", err));

    const res = await getClient().createExternalEntry(filespace_id, {
      path,
      kind: "SingleObjectFile",
      dataStoreId: data_store_id,
      singleObjectFileParams: { objectId: object_id },
    });
    return res.success
      ? text(formatSuccess(`Created external entry at '${path}'`, res.data ?? {}))
      : text(formatError("Create External Entry", res.error ?? "Unknown error"));
  },
);

server.tool(
  "list_external_entry_ids",
  "List external entry IDs associated with a data store",
  {
    filespace_id: z.string().describe("Filespace ID"),
    data_store_id: z.string().describe("Data store ID"),
    limit: z.number().optional().describe("Max IDs to return"),
    next_cursor: z.string().optional().describe("Pagination cursor"),
  },
  async ({ filespace_id, data_store_id, limit, next_cursor }) => {
    const err = await ensureReady();
    if (err) return text(formatError("List External Entry IDs", err));

    const res = await getClient().listExternalEntryIds(filespace_id, {
      dataStoreId: data_store_id,
      limit,
      nextCursor: next_cursor,
    });
    if (!res.success) return text(formatError("List External Entry IDs", res.error ?? "Unknown error"));

    const inner = (res.data as Record<string, unknown>)?.data as Record<string, unknown> | undefined;
    const ids = (inner?.ids ?? []) as string[];
    const nextCur = inner?.nextCursor as string | undefined;

    if (ids.length === 0) return text("No external entries found.");

    let msg = `${ids.length} external entry ID(s):\n\n` + ids.map((id) => `- ${id}`).join("\n");
    if (nextCur) msg += `\n\nMore available. Use next_cursor='${nextCur}' to continue.`;
    return text(msg);
  },
);

server.tool(
  "delete_external_entry",
  "Delete an external entry from a filespace",
  {
    filespace_id: z.string().describe("Filespace ID"),
    entry_id: z.string().describe("External entry ID"),
    confirm: z.boolean().describe("Must be true to proceed"),
  },
  async ({ filespace_id, entry_id, confirm }) => {
    if (!confirm) return text("Deletion not confirmed. Set confirm=true to proceed.");

    const err = await ensureReady();
    if (err) return text(formatError("Delete External Entry", err));

    const res = await getClient().deleteExternalEntry(filespace_id, entry_id);
    return res.success
      ? text(formatSuccess("Deleted External Entry", { entry_id }))
      : text(formatError("Delete External Entry", res.error ?? "Unknown error"));
  },
);

// ── High-Level Workflow Tools ──

server.tool(
  "ensure_folder_path",
  "Create all directories in a filespace path, returning leaf entry ID",
  {
    filespace_id: z.string().describe("Filespace ID"),
    path: z.string().describe("Directory path to create (e.g. /videos/2024/clips)"),
  },
  async ({ filespace_id, path }) => {
    const err = await ensureReady();
    if (err) return text(formatError("Ensure Folder Path", err));

    const result = await ensureFolderPath(getClient(), filespace_id, path);
    return result.ok
      ? text(formatSuccess(`Ensured folder path '${path}'`, { path, leaf_entry_id: result.leafId }))
      : text(formatError("Ensure Folder Path", result.error));
  },
);

server.tool(
  "import_s3_object",
  "Ensure directory path exists, then link one S3 object as an external entry",
  {
    filespace_id: z.string().describe("Filespace ID"),
    data_store_id: z.string().describe("Data store ID"),
    s3_key: z.string().describe("S3 object key (e.g. media/clip.mp4)"),
    ll_path: z.string().describe("Full filespace path (e.g. /media/clip.mp4)"),
  },
  async ({ filespace_id, data_store_id, s3_key, ll_path }) => {
    const err = await ensureReady();
    if (err) return text(formatError("Import S3 Object", err));

    const res = await importS3Object(getClient(), filespace_id, data_store_id, s3_key, ll_path);
    return res.success
      ? text(formatSuccess(`Imported S3 object '${s3_key}' -> '${ll_path}'`, res.data ?? {}))
      : text(formatError("Import S3 Object", res.error ?? "Unknown error"));
  },
);

server.tool(
  "bulk_import_s3_objects",
  "Ensure all directories exist, then link multiple S3 objects as external entries",
  {
    filespace_id: z.string().describe("Filespace ID"),
    data_store_id: z.string().describe("Data store ID"),
    objects: z.array(z.object({
      s3_key: z.string().describe("S3 object key"),
      ll_path: z.string().describe("Target filespace path"),
    })).describe("List of objects to import"),
    stop_on_error: z.boolean().optional().describe("Stop on first error (default false)"),
  },
  async ({ filespace_id, data_store_id, objects, stop_on_error }) => {
    const err = await ensureReady();
    if (err) return text(formatError("Bulk Import", err));

    const result = await bulkImportS3Objects(
      getClient(), filespace_id, data_store_id, objects, stop_on_error ?? false,
    );

    if (result.failed === 0 && result.dirFailures.length === 0) {
      return text(formatSuccess(
        `Bulk Import: ${result.succeeded}/${result.total} objects imported`,
        result as unknown as Record<string, unknown>,
      ));
    }
    return text(
      `Bulk Import completed with errors: ${result.succeeded} succeeded, ${result.failed} failed\n\n` +
      JSON.stringify(result, null, 2),
    );
  },
);

// ── Start server ──

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
