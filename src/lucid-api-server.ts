/**
 * LucidLink Admin API MCP Server (v2 — TypeScript)
 *
 * Provides natural language interface to the LucidLink Admin API
 * through Claude Desktop. No Docker required — runs the API as
 * a native Node.js child process.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { registerBrandResource } from "./shared/brand-resource.js";
import { registerCapabilitiesResource } from "./shared/capabilities-resource.js";
import { registerDocsSearch } from "./docs/docs-search.js";

import { ApiClient } from "./shared/api-client.js";
import { getBearerToken, storeBearerToken } from "./shared/keychain.js";
import {
  ensureApiRunning,
  isApiRunning,
  getApiLogs,
} from "./shared/process-manager.js";
import { formatSuccess, formatError, ok, err } from "./shared/formatters.js";
import {
  validateFilespaceName,
  validateEmail,
  validateGroupName,
} from "./shared/validators.js";

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

// ── Server ──

const server = new McpServer(
  { name: "lucidlink-api", version: "2.1.0" },
  { instructions: `LucidLink Admin API server — manages filespaces, members, groups, and permissions.

IMPORTANT: The LucidLink API is normally deployed as a self-hosted Docker container (lucidlink/lucidlink-api)
that users run on their own infrastructure. This macOS app bundles the API as a native Node.js process for
convenience — no Docker required. The bundled API is functionally identical to the container version.
When answering questions about deployment or architecture, always mention the standard Docker container
approach first, then note that this app provides a bundled alternative for local use.

The API auto-starts on first tool call. Bearer token is read from macOS Keychain or LUCIDLINK_BEARER_TOKEN env var.

Key workflows:
- Set up a filespace: list_providers → create_filespace → add_member → create_group → add_member_to_group → grant_permission
- Manage access: list_members/list_groups to find IDs, then grant_permission/update_permission/revoke_permission
- add_member_to_group is the batch endpoint (PUT /groups/members) — use it for adding one or many members
- For questions about the API (authentication, deployment, best practices, scaling, Connect): use search_api_docs

All IDs are UUIDs returned by create/list operations. Always list first to get IDs before operating on specific resources.` },
);

registerBrandResource(server);
registerCapabilitiesResource(server);
registerDocsSearch(server);

// ── Process Management Tools ──

server.tool(
  "check_api_status",
  "Check if the LucidLink API process is running. Returns status and endpoint URL. The API auto-starts on first tool call, so this is mainly for diagnostics.",
  {},
  async () => {
    const running = await isApiRunning();
    if (running) {
      return ok(formatSuccess("API Status", { status: "Running", endpoint: "http://localhost:3003/api/v1" }));
    }
    return ok("API is not running. It will be started automatically when you make an API call.");
  },
);

server.tool(
  "view_api_logs",
  "View recent stdout/stderr logs from the LucidLink API process. Useful for debugging startup failures or API errors.",
  { lines: z.number().optional().describe("Number of log lines to retrieve (default 50)") },
  async ({ lines }) => {
    const logs = getApiLogs(lines ?? 50);
    return ok(logs || "No logs available. The API process may not have been started yet.");
  },
);

// ── Auth ──

server.tool(
  "initialize_api",
  "Set or update the bearer token and verify API connectivity. Stores the token in macOS Keychain for future sessions. If no token is provided, uses the previously stored one.",
  { token: z.string().optional().describe("Bearer token (optional — uses stored token if not provided)") },
  async ({ token }) => {
    const t = token || getBearerToken();
    if (!t) {
      return err(formatError("Initialize API", "No bearer token provided or found in Keychain."));
    }

    if (token) {
      storeBearerToken(token);
    }
    apiClient = new ApiClient(t);

    const startErr = await ensureReady();
    if (startErr) return err(formatError("Initialize API", startErr));

    const health = await apiClient.getHealth();
    if (health.success) {
      return ok(formatSuccess("API Initialized", { status: "Connected", endpoint: "http://localhost:3003/api/v1" }));
    }
    return err(formatError("Initialize API", health.error ?? "Failed to connect"));
  },
);

// ── Filespace Management ──

server.tool(
  "create_filespace",
  "Create a new LucidLink filespace. Returns the filespace ID and details. Use list_providers first to see available storage providers.",
  {
    name: z.string().describe("Name (3-63 chars, alphanumeric with hyphens/underscores)"),
    region: z.string().optional().describe("Storage region (e.g. us-east-1)"),
    storage_provider: z.string().optional().describe("Storage provider (AWS, Azure, GCP, Wasabi)"),
  },
  async ({ name, region, storage_provider }) => {
    const v = validateFilespaceName(name);
    if (!v.ok) return err(formatError("Create Filespace", v.error));

    const startErr = await ensureReady();
    if (startErr) return err(formatError("Create Filespace", startErr));

    const res = await getClient().createFilespace(v.value, region ?? "us-east-1", storage_provider ?? "AWS");
    return res.success
      ? ok(formatSuccess(`Created filespace '${v.value}'`, res.data ?? {}))
      : err(formatError("Create Filespace", res.error ?? "Unknown error"));
  },
);

server.tool(
  "list_filespaces",
  "List all filespaces in the workspace. Returns name, ID, region, and status for each. Use the ID from results to call other filespace operations.",
  {},
  async () => {
    const startErr = await ensureReady();
    if (startErr) return err(formatError("List Filespaces", startErr));

    const res = await getClient().listFilespaces();
    if (!res.success) return err(formatError("List Filespaces", res.error ?? "Unknown error"));

    const filespaces = (res.data as Record<string, unknown>)?.data as Record<string, unknown>[] ?? [];
    if (filespaces.length === 0) return ok("No filespaces found in this workspace.");

    const list = filespaces.map((fs) => {
      const storage = fs.storage as Record<string, unknown> | undefined;
      return `- ${fs.name ?? "Unknown"} (ID: ${fs.id ?? "N/A"}, Region: ${storage?.region ?? "N/A"}, Status: ${fs.status ?? "N/A"})`;
    }).join("\n");
    return ok(`Found ${filespaces.length} filespace(s):\n\n${list}`);
  },
);

server.tool(
  "get_filespace_details",
  "Get full details for a filespace by ID — name, status, storage config, creation date, and usage stats.",
  { filespace_id: z.string().describe("ID of the filespace") },
  async ({ filespace_id }) => {
    const startErr = await ensureReady();
    if (startErr) return err(formatError("Get Filespace Details", startErr));

    const res = await getClient().getFilespace(filespace_id);
    return res.success
      ? ok(formatSuccess("Filespace Details", res.data ?? {}))
      : err(formatError("Get Filespace Details", res.error ?? "Unknown error"));
  },
);

server.tool(
  "update_filespace",
  "Rename a filespace. Requires the filespace ID (from list_filespaces) and the new name.",
  {
    filespace_id: z.string().describe("ID of the filespace"),
    name: z.string().describe("New name"),
  },
  async ({ filespace_id, name }) => {
    const v = validateFilespaceName(name);
    if (!v.ok) return err(formatError("Update Filespace", v.error));

    const startErr = await ensureReady();
    if (startErr) return err(formatError("Update Filespace", startErr));

    const res = await getClient().updateFilespace(filespace_id, v.value);
    return res.success
      ? ok(formatSuccess("Renamed Filespace", res.data ?? {}))
      : err(formatError("Update Filespace", res.error ?? "Unknown error"));
  },
);

server.tool(
  "delete_filespace",
  "Permanently delete a filespace and all its data. This cannot be undone. Requires confirm=true.",
  {
    filespace_id: z.string().describe("ID of the filespace to delete"),
    confirm: z.boolean().describe("Must be true to proceed"),
  },
  async ({ filespace_id, confirm }) => {
    if (!confirm) return err("Deletion not confirmed. Set confirm=true to proceed. This action is permanent!");

    const startErr = await ensureReady();
    if (startErr) return err(formatError("Delete Filespace", startErr));

    const res = await getClient().deleteFilespace(filespace_id);
    return res.success
      ? ok(formatSuccess("Deleted Filespace", { filespace_id }))
      : err(formatError("Delete Filespace", res.error ?? "Unknown error"));
  },
);

// ── Member Management ──

server.tool(
  "add_member",
  "Invite a user to the workspace by email. Returns member ID, status (pending/active), and an invitation link if applicable. Use the member ID for group and permission operations.",
  { email: z.string().describe("Email address of the member") },
  async ({ email }) => {
    const v = validateEmail(email);
    if (!v.ok) return err(formatError("Add Member", v.error));

    const startErr = await ensureReady();
    if (startErr) return err(formatError("Add Member", startErr));

    const res = await getClient().addMember(v.value);
    if (!res.success) return err(formatError("Add Member", res.error ?? "Unknown error"));

    const memberData = (res.data as Record<string, unknown>)?.data as Record<string, unknown> ?? {};
    const user = memberData.user as Record<string, unknown> | undefined;
    const memberEmail = user?.email ?? v.value;
    const status = memberData.status ?? "unknown";
    const inviteLink = memberData.pendingInvitationLinkSecret as string | undefined;

    return ok(formatSuccess("Add Member", { email: memberEmail, status, inviteLink }));
  },
);

server.tool(
  "list_members",
  "List all workspace members. Returns email, status (active/pending), and member ID for each. Optionally filter by email to find a specific member.",
  { email: z.string().optional().describe("Optional email filter") },
  async ({ email }) => {
    const startErr = await ensureReady();
    if (startErr) return err(formatError("List Members", startErr));

    const res = await getClient().listMembers(email);
    if (!res.success) return err(formatError("List Members", res.error ?? "Unknown error"));

    const members = (res.data as Record<string, unknown>)?.data as Record<string, unknown>[] ?? [];
    if (members.length === 0) return ok("No members found in this workspace.");

    const list = members.map((m) => {
      const user = m.user as Record<string, unknown> | undefined;
      return `- ${user?.email ?? "Unknown"} — ${String(m.status ?? "unknown").toUpperCase()} (ID: ${m.id ?? "N/A"})`;
    }).join("\n");
    return ok(`Found ${members.length} member(s):\n\n${list}`);
  },
);

server.tool(
  "get_member_details",
  "Get full details for a member by ID — email, role, status, creation date, and group memberships.",
  { member_id: z.string().describe("ID of the member") },
  async ({ member_id }) => {
    const startErr = await ensureReady();
    if (startErr) return err(formatError("Get Member Details", startErr));

    const res = await getClient().getMember(member_id);
    if (!res.success) return err(formatError("Get Member Details", res.error ?? "Unknown error"));

    const data = (res.data as Record<string, unknown>)?.data ?? res.data;
    return ok(formatSuccess("Member Details", data as Record<string, unknown>));
  },
);

server.tool(
  "remove_member",
  "Remove a member from the workspace entirely. This revokes all their permissions and group memberships.",
  { member_id: z.string().describe("ID of the member to remove") },
  async ({ member_id }) => {
    const startErr = await ensureReady();
    if (startErr) return err(formatError("Remove Member", startErr));

    const res = await getClient().removeMember(member_id);
    return res.success
      ? ok(formatSuccess("Removed Member", { member_id }))
      : err(formatError("Remove Member", res.error ?? "Unknown error"));
  },
);

server.tool(
  "update_member_role",
  "Change a member's workspace role. Roles: 'admin' (full access), 'filespaceAdmin' (manages specific filespaces — requires filespace_ids), 'standard' (default).",
  {
    member_id: z.string().describe("ID of the member"),
    role: z.enum(["admin", "filespaceAdmin", "standard"]).describe("New role"),
    filespace_ids: z.array(z.string()).optional().describe("Required for filespaceAdmin: filespace IDs to manage"),
  },
  async ({ member_id, role, filespace_ids }) => {
    if (role === "filespaceAdmin" && (!filespace_ids || filespace_ids.length === 0)) {
      return err(formatError("Update Member Role", "filespace_ids is required when setting role to filespaceAdmin"));
    }

    const startErr = await ensureReady();
    if (startErr) return err(formatError("Update Member Role", startErr));

    const res = await getClient().updateMemberRole(member_id, role, filespace_ids);
    return res.success
      ? ok(formatSuccess(`Updated member role to '${role}'`, res.data ?? {}))
      : err(formatError("Update Member Role", res.error ?? "Unknown error"));
  },
);

server.tool(
  "get_member_groups",
  "List all groups a member belongs to. Returns group name, ID, and member count for each.",
  { member_id: z.string().describe("ID of the member") },
  async ({ member_id }) => {
    const startErr = await ensureReady();
    if (startErr) return err(formatError("Get Member Groups", startErr));

    const res = await getClient().getMemberGroups(member_id);
    if (!res.success) return err(formatError("Get Member Groups", res.error ?? "Unknown error"));

    const groups = (res.data as Record<string, unknown>)?.data as Record<string, unknown>[] ?? [];
    if (groups.length === 0) return ok("Member does not belong to any groups.");

    const list = groups.map((g) =>
      `- ${g.name ?? "Unknown"} (ID: ${g.id ?? "N/A"}, members: ${g.memberCount ?? "?"})`,
    ).join("\n");
    return ok(`Member belongs to ${groups.length} group(s):\n\n${list}`);
  },
);

// ── Group Management ──

server.tool(
  "create_group",
  "Create a new group for organizing members. Returns the group ID. Groups can then be assigned permissions on filespace folders.",
  {
    name: z.string().describe("Name for the new group"),
    description: z.string().optional().describe("Optional group description"),
  },
  async ({ name, description }) => {
    const v = validateGroupName(name);
    if (!v.ok) return err(formatError("Create Group", v.error));

    const startErr = await ensureReady();
    if (startErr) return err(formatError("Create Group", startErr));

    const res = await getClient().createGroup(v.value, description ?? "");
    return res.success
      ? ok(formatSuccess(`Created group '${v.value}'`, res.data ?? {}))
      : err(formatError("Create Group", res.error ?? "Unknown error"));
  },
);

server.tool(
  "list_groups",
  "List all groups in the workspace. Returns group name and ID for each. Optionally filter by name.",
  { name: z.string().optional().describe("Optional name filter") },
  async ({ name }) => {
    const startErr = await ensureReady();
    if (startErr) return err(formatError("List Groups", startErr));

    const res = await getClient().listGroups(name);
    if (!res.success) return err(formatError("List Groups", res.error ?? "Unknown error"));

    const groups = (res.data as Record<string, unknown>)?.data as Record<string, unknown>[] ?? [];
    if (groups.length === 0) return ok("No groups found in this workspace.");

    const list = groups.map((g) => `- ${g.name ?? "Unknown"} (ID: ${g.id ?? "N/A"})`).join("\n");
    return ok(`Found ${groups.length} group(s):\n\n${list}`);
  },
);

server.tool(
  "get_group",
  "Get full details for a group by ID — name, description, member count, and creation date.",
  { group_id: z.string().describe("ID of the group") },
  async ({ group_id }) => {
    const startErr = await ensureReady();
    if (startErr) return err(formatError("Get Group", startErr));

    const res = await getClient().getGroup(group_id);
    return res.success
      ? ok(formatSuccess("Group Details", res.data ?? {}))
      : err(formatError("Get Group", res.error ?? "Unknown error"));
  },
);

server.tool(
  "update_group",
  "Rename a group. Requires the group ID (from list_groups) and the new name.",
  {
    group_id: z.string().describe("ID of the group"),
    name: z.string().describe("New name for the group"),
  },
  async ({ group_id, name }) => {
    const v = validateGroupName(name);
    if (!v.ok) return err(formatError("Update Group", v.error));

    const startErr = await ensureReady();
    if (startErr) return err(formatError("Update Group", startErr));

    const res = await getClient().updateGroup(group_id, v.value);
    return res.success
      ? ok(formatSuccess(`Renamed group to '${v.value}'`, res.data ?? {}))
      : err(formatError("Update Group", res.error ?? "Unknown error"));
  },
);

server.tool(
  "delete_group",
  "Delete a group from the workspace. Members are NOT removed from the workspace, only from this group. Requires confirm=true.",
  {
    group_id: z.string().describe("ID of the group to delete"),
    confirm: z.boolean().describe("Must be true to proceed"),
  },
  async ({ group_id, confirm }) => {
    if (!confirm) return err("Deletion not confirmed. Set confirm=true to proceed.");

    const startErr = await ensureReady();
    if (startErr) return err(formatError("Delete Group", startErr));

    const res = await getClient().deleteGroup(group_id);
    return res.success
      ? ok(formatSuccess("Deleted Group", { group_id }))
      : err(formatError("Delete Group", res.error ?? "Unknown error"));
  },
);

server.tool(
  "list_group_members",
  "List all members in a group. Returns email, status, and member ID for each.",
  { group_id: z.string().describe("ID of the group") },
  async ({ group_id }) => {
    const startErr = await ensureReady();
    if (startErr) return err(formatError("List Group Members", startErr));

    const res = await getClient().listGroupMembers(group_id);
    if (!res.success) return err(formatError("List Group Members", res.error ?? "Unknown error"));

    const members = (res.data as Record<string, unknown>)?.data as Record<string, unknown>[] ?? [];
    if (members.length === 0) return ok("No members in this group.");

    const list = members.map((m) => {
      const user = m.user as Record<string, unknown> | undefined;
      return `- ${user?.email ?? "Unknown"} — ${String(m.status ?? "unknown").toUpperCase()} (ID: ${m.id ?? "N/A"})`;
    }).join("\n");
    return ok(`${members.length} member(s) in group:\n\n${list}`);
  },
);

server.tool(
  "add_member_to_group",
  "Add a member to a group. Uses the batch membership endpoint (PUT /groups/members). Get member_id from list_members and group_id from list_groups.",
  {
    group_id: z.string().describe("ID of the group"),
    member_id: z.string().describe("ID of the member to add"),
  },
  async ({ group_id, member_id }) => {
    const startErr = await ensureReady();
    if (startErr) return err(formatError("Add Member to Group", startErr));

    const res = await getClient().addMemberToGroup(group_id, member_id);
    return res.success
      ? ok(formatSuccess("Added Member to Group", { group_id, member_id }))
      : err(formatError("Add Member to Group", res.error ?? "Unknown error"));
  },
);

server.tool(
  "remove_member_from_group",
  "Remove a member from a group. The member remains in the workspace but loses group-based permissions.",
  {
    group_id: z.string().describe("ID of the group"),
    member_id: z.string().describe("ID of the member to remove"),
  },
  async ({ group_id, member_id }) => {
    const startErr = await ensureReady();
    if (startErr) return err(formatError("Remove Member from Group", startErr));

    const res = await getClient().removeMemberFromGroup(group_id, member_id);
    return res.success
      ? ok(formatSuccess("Removed Member from Group", { group_id, member_id }))
      : err(formatError("Remove Member from Group", res.error ?? "Unknown error"));
  },
);

// ── Permission Management ──

server.tool(
  "grant_permission",
  "Grant folder-level permissions to a member or group on a filespace. Permissions: 'read', 'write'. Specify a path to scope the permission to a subdirectory.",
  {
    filespace_id: z.string().describe("ID of the filespace"),
    principal_id: z.string().describe("ID of the member or group"),
    permissions: z.array(z.string()).optional().describe("Permissions to grant (read, write) — default: ['read']"),
    path: z.string().optional().describe("Path within filespace (default: /)"),
  },
  async ({ filespace_id, principal_id, permissions, path }) => {
    const startErr = await ensureReady();
    if (startErr) return err(formatError("Grant Permission", startErr));

    const res = await getClient().grantPermission(filespace_id, principal_id, permissions ?? ["read"], path ?? "/");
    return res.success
      ? ok(formatSuccess("Granted Permissions", res.data ?? {}))
      : err(formatError("Grant Permission", res.error ?? "Unknown error"));
  },
);

server.tool(
  "list_permissions",
  "List all permission entries for a filespace. Returns principal ID, permission levels, and path for each. Use principal_id to filter permissions for a specific member or group.",
  {
    filespace_id: z.string().describe("ID of the filespace"),
    principal_id: z.string().optional().describe("Filter by member or group ID"),
    limit: z.number().optional().describe("Maximum results to return"),
    next_cursor: z.string().optional().describe("Pagination cursor from previous response"),
  },
  async ({ filespace_id, principal_id, limit, next_cursor }) => {
    const startErr = await ensureReady();
    if (startErr) return err(formatError("List Permissions", startErr));

    const res = await getClient().listPermissions(filespace_id, {
      principalId: principal_id,
      limit,
      nextCursor: next_cursor,
    });
    if (!res.success) return err(formatError("List Permissions", res.error ?? "Unknown error"));

    const perms = (res.data as Record<string, unknown>)?.data as Record<string, unknown>[] ?? [];
    if (perms.length === 0) return ok("No permissions set for this filespace.");

    const list = perms.map((p) =>
      `- ${p.principalId ?? "Unknown"} — ${JSON.stringify(p.permissions ?? [])} on ${p.path ?? "/"} (ID: ${p.id ?? "N/A"})`,
    ).join("\n");
    return ok(`Permissions for filespace:\n\n${list}`);
  },
);

server.tool(
  "update_permission",
  "Change the permission level(s) on an existing permission entry. Get the permission_id from list_permissions.",
  {
    filespace_id: z.string().describe("ID of the filespace"),
    permission_id: z.string().describe("ID of the permission to update"),
    permissions: z.array(z.enum(["read", "write"])).describe("New permissions"),
  },
  async ({ filespace_id, permission_id, permissions }) => {
    const startErr = await ensureReady();
    if (startErr) return err(formatError("Update Permission", startErr));

    const res = await getClient().updatePermission(filespace_id, permission_id, permissions);
    return res.success
      ? ok(formatSuccess("Updated Permission", res.data ?? {}))
      : err(formatError("Update Permission", res.error ?? "Unknown error"));
  },
);

server.tool(
  "revoke_permission",
  "Remove a permission entry from a filespace. The member/group will lose the access granted by this entry. Get permission_id from list_permissions.",
  {
    filespace_id: z.string().describe("ID of the filespace"),
    permission_id: z.string().describe("ID of the permission to revoke"),
  },
  async ({ filespace_id, permission_id }) => {
    const startErr = await ensureReady();
    if (startErr) return err(formatError("Revoke Permission", startErr));

    const res = await getClient().revokePermission(filespace_id, permission_id);
    return res.success
      ? ok(formatSuccess("Revoked Permission", { filespace_id, permission_id }))
      : err(formatError("Revoke Permission", res.error ?? "Unknown error"));
  },
);

// ── Service Management ──

server.tool(
  "check_api_health",
  "Lightweight health check — returns whether the API is responding to requests. Faster than check_api_status.",
  {},
  async () => {
    const startErr = await ensureReady();
    if (startErr) return err(formatError("API Health Check", startErr));

    const res = await getClient().getHealth();
    return res.success
      ? ok(formatSuccess("API Health Check", { status: "Healthy", endpoint: "http://localhost:3003/api/v1" }))
      : err(formatError("API Health Check", res.error ?? "Unknown error"));
  },
);

server.tool(
  "list_providers",
  "List available cloud storage providers (AWS, Azure, GCP, Wasabi). Call this before create_filespace to see valid provider options.",
  {},
  async () => {
    const startErr = await ensureReady();
    if (startErr) return err(formatError("List Providers", startErr));

    const res = await getClient().listProviders();
    if (!res.success) return err(formatError("List Providers", res.error ?? "Unknown error"));

    const providers = (res.data as Record<string, unknown>)?.data as Record<string, unknown>[] ?? [];
    if (providers.length === 0) return ok("No storage providers found.");

    const list = providers.map((p) => `- ${p.name ?? "Unknown"} — ${p.description ?? "No description"}`).join("\n");
    return ok(`Available Storage Providers:\n\n${list}`);
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
