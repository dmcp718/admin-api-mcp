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

import { ApiClient } from "./shared/api-client.js";
import { getBearerToken, storeBearerToken } from "./shared/keychain.js";
import {
  ensureApiRunning,
  isApiRunning,
  getApiLogs,
} from "./shared/process-manager.js";
import { formatSuccess, formatError } from "./shared/formatters.js";
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

function text(s: string) {
  return { content: [{ type: "text" as const, text: s }] };
}

// ── Server ──

const server = new McpServer({
  name: "lucidlink-admin-api",
  version: "2.0.0",
});

// ── Process Management Tools ──

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
  { lines: z.number().optional().describe("Number of log lines to retrieve (default 50)") },
  async ({ lines }) => {
    const logs = getApiLogs(lines ?? 50);
    return text(logs || "No logs available. The API process may not have been started yet.");
  },
);

// ── Auth ──

server.tool(
  "initialize_api",
  "Initialize the API client with a bearer token (stores in macOS Keychain)",
  { token: z.string().optional().describe("Bearer token (optional — uses stored token if not provided)") },
  async ({ token }) => {
    const t = token || getBearerToken();
    if (!t) {
      return text(formatError("Initialize API", "No bearer token provided or found in Keychain."));
    }

    if (token) {
      storeBearerToken(token);
    }
    apiClient = new ApiClient(t);

    const err = await ensureReady();
    if (err) return text(formatError("Initialize API", err));

    const health = await apiClient.getHealth();
    if (health.success) {
      return text(formatSuccess("API Initialized", { status: "Connected", endpoint: "http://localhost:3003/api/v1" }));
    }
    return text(formatError("Initialize API", health.error ?? "Failed to connect"));
  },
);

// ── Filespace Management ──

server.tool(
  "create_filespace",
  "Create a new LucidLink filespace",
  {
    name: z.string().describe("Name (3-63 chars, alphanumeric with hyphens/underscores)"),
    region: z.string().optional().describe("Storage region (e.g. us-east-1)"),
    storage_provider: z.string().optional().describe("Storage provider (AWS, Azure, GCP, Wasabi)"),
  },
  async ({ name, region, storage_provider }) => {
    const v = validateFilespaceName(name);
    if (!v.ok) return text(formatError("Create Filespace", v.error));

    const err = await ensureReady();
    if (err) return text(formatError("Create Filespace", err));

    const res = await getClient().createFilespace(v.value, region ?? "us-east-1", storage_provider ?? "AWS");
    return res.success
      ? text(formatSuccess(`Created filespace '${v.value}'`, res.data ?? {}))
      : text(formatError("Create Filespace", res.error ?? "Unknown error"));
  },
);

server.tool(
  "list_filespaces",
  "List all filespaces in the workspace",
  {},
  async () => {
    const err = await ensureReady();
    if (err) return text(formatError("List Filespaces", err));

    const res = await getClient().listFilespaces();
    if (!res.success) return text(formatError("List Filespaces", res.error ?? "Unknown error"));

    const filespaces = (res.data as Record<string, unknown>)?.data as Record<string, unknown>[] ?? [];
    if (filespaces.length === 0) return text("No filespaces found in this workspace.");

    const list = filespaces.map((fs) => {
      const storage = fs.storage as Record<string, unknown> | undefined;
      return `- ${fs.name ?? "Unknown"} (ID: ${fs.id ?? "N/A"}, Region: ${storage?.region ?? "N/A"}, Status: ${fs.status ?? "N/A"})`;
    }).join("\n");
    return text(`Found ${filespaces.length} filespace(s):\n\n${list}`);
  },
);

server.tool(
  "get_filespace_details",
  "Get detailed information about a specific filespace",
  { filespace_id: z.string().describe("ID of the filespace") },
  async ({ filespace_id }) => {
    const err = await ensureReady();
    if (err) return text(formatError("Get Filespace Details", err));

    const res = await getClient().getFilespace(filespace_id);
    return res.success
      ? text(formatSuccess("Filespace Details", res.data ?? {}))
      : text(formatError("Get Filespace Details", res.error ?? "Unknown error"));
  },
);

server.tool(
  "update_filespace",
  "Rename a filespace",
  {
    filespace_id: z.string().describe("ID of the filespace"),
    name: z.string().describe("New name"),
  },
  async ({ filespace_id, name }) => {
    const v = validateFilespaceName(name);
    if (!v.ok) return text(formatError("Update Filespace", v.error));

    const err = await ensureReady();
    if (err) return text(formatError("Update Filespace", err));

    const res = await getClient().updateFilespace(filespace_id, v.value);
    return res.success
      ? text(formatSuccess("Renamed Filespace", res.data ?? {}))
      : text(formatError("Update Filespace", res.error ?? "Unknown error"));
  },
);

server.tool(
  "delete_filespace",
  "Delete a filespace (permanent — use with caution)",
  {
    filespace_id: z.string().describe("ID of the filespace to delete"),
    confirm: z.boolean().describe("Must be true to proceed"),
  },
  async ({ filespace_id, confirm }) => {
    if (!confirm) return text("Deletion not confirmed. Set confirm=true to proceed. This action is permanent!");

    const err = await ensureReady();
    if (err) return text(formatError("Delete Filespace", err));

    const res = await getClient().deleteFilespace(filespace_id);
    return res.success
      ? text(formatSuccess("Deleted Filespace", { filespace_id }))
      : text(formatError("Delete Filespace", res.error ?? "Unknown error"));
  },
);

// ── Member Management ──

server.tool(
  "add_member",
  "Add a new member to the workspace by email",
  { email: z.string().describe("Email address of the member") },
  async ({ email }) => {
    const v = validateEmail(email);
    if (!v.ok) return text(formatError("Add Member", v.error));

    const err = await ensureReady();
    if (err) return text(formatError("Add Member", err));

    const res = await getClient().addMember(v.value);
    if (!res.success) return text(formatError("Add Member", res.error ?? "Unknown error"));

    const memberData = (res.data as Record<string, unknown>)?.data as Record<string, unknown> ?? {};
    const user = memberData.user as Record<string, unknown> | undefined;
    const memberEmail = user?.email ?? v.value;
    const status = memberData.status ?? "unknown";
    const inviteLink = memberData.pendingInvitationLinkSecret as string | undefined;

    let msg = `Member Added Successfully!\n\nEmail: ${memberEmail}\nStatus: ${status}`;
    if (inviteLink) {
      msg += `\n\nInvitation Link:\n${inviteLink}\n\nSend this link to the new member to complete registration.`;
    }
    return text(formatSuccess("Add Member", { email: memberEmail, status, inviteLink }));
  },
);

server.tool(
  "list_members",
  "List all workspace members, optionally filtered by email",
  { email: z.string().optional().describe("Optional email filter") },
  async ({ email }) => {
    const err = await ensureReady();
    if (err) return text(formatError("List Members", err));

    const res = await getClient().listMembers(email);
    if (!res.success) return text(formatError("List Members", res.error ?? "Unknown error"));

    const members = (res.data as Record<string, unknown>)?.data as Record<string, unknown>[] ?? [];
    if (members.length === 0) return text("No members found in this workspace.");

    const list = members.map((m) => {
      const user = m.user as Record<string, unknown> | undefined;
      return `- ${user?.email ?? "Unknown"} — ${String(m.status ?? "unknown").toUpperCase()} (ID: ${m.id ?? "N/A"})`;
    }).join("\n");
    return text(`Found ${members.length} member(s):\n\n${list}`);
  },
);

server.tool(
  "get_member_details",
  "Get detailed information about a specific member",
  { member_id: z.string().describe("ID of the member") },
  async ({ member_id }) => {
    const err = await ensureReady();
    if (err) return text(formatError("Get Member Details", err));

    const res = await getClient().getMember(member_id);
    if (!res.success) return text(formatError("Get Member Details", res.error ?? "Unknown error"));

    const data = (res.data as Record<string, unknown>)?.data ?? res.data;
    return text(formatSuccess("Member Details", data as Record<string, unknown>));
  },
);

server.tool(
  "remove_member",
  "Remove a member from the workspace",
  { member_id: z.string().describe("ID of the member to remove") },
  async ({ member_id }) => {
    const err = await ensureReady();
    if (err) return text(formatError("Remove Member", err));

    const res = await getClient().removeMember(member_id);
    return res.success
      ? text(formatSuccess("Removed Member", { member_id }))
      : text(formatError("Remove Member", res.error ?? "Unknown error"));
  },
);

server.tool(
  "update_member_role",
  "Change a member's role (admin, filespaceAdmin, or standard)",
  {
    member_id: z.string().describe("ID of the member"),
    role: z.enum(["admin", "filespaceAdmin", "standard"]).describe("New role"),
    filespace_ids: z.array(z.string()).optional().describe("Required for filespaceAdmin: filespace IDs to manage"),
  },
  async ({ member_id, role, filespace_ids }) => {
    if (role === "filespaceAdmin" && (!filespace_ids || filespace_ids.length === 0)) {
      return text(formatError("Update Member Role", "filespace_ids is required when setting role to filespaceAdmin"));
    }

    const err = await ensureReady();
    if (err) return text(formatError("Update Member Role", err));

    const res = await getClient().updateMemberRole(member_id, role, filespace_ids);
    return res.success
      ? text(formatSuccess(`Updated member role to '${role}'`, res.data ?? {}))
      : text(formatError("Update Member Role", res.error ?? "Unknown error"));
  },
);

server.tool(
  "get_member_groups",
  "Get all groups that a member belongs to",
  { member_id: z.string().describe("ID of the member") },
  async ({ member_id }) => {
    const err = await ensureReady();
    if (err) return text(formatError("Get Member Groups", err));

    const res = await getClient().getMemberGroups(member_id);
    if (!res.success) return text(formatError("Get Member Groups", res.error ?? "Unknown error"));

    const groups = (res.data as Record<string, unknown>)?.data as Record<string, unknown>[] ?? [];
    if (groups.length === 0) return text("Member does not belong to any groups.");

    const list = groups.map((g) =>
      `- ${g.name ?? "Unknown"} (ID: ${g.id ?? "N/A"}, members: ${g.memberCount ?? "?"})`,
    ).join("\n");
    return text(`Member belongs to ${groups.length} group(s):\n\n${list}`);
  },
);

// ── Group Management ──

server.tool(
  "create_group",
  "Create a new group for organizing members",
  {
    name: z.string().describe("Name for the new group"),
    description: z.string().optional().describe("Optional group description"),
  },
  async ({ name, description }) => {
    const v = validateGroupName(name);
    if (!v.ok) return text(formatError("Create Group", v.error));

    const err = await ensureReady();
    if (err) return text(formatError("Create Group", err));

    const res = await getClient().createGroup(v.value, description ?? "");
    return res.success
      ? text(formatSuccess(`Created group '${v.value}'`, res.data ?? {}))
      : text(formatError("Create Group", res.error ?? "Unknown error"));
  },
);

server.tool(
  "list_groups",
  "List all groups in the workspace, optionally filtered by name",
  { name: z.string().optional().describe("Optional name filter") },
  async ({ name }) => {
    const err = await ensureReady();
    if (err) return text(formatError("List Groups", err));

    const res = await getClient().listGroups(name);
    if (!res.success) return text(formatError("List Groups", res.error ?? "Unknown error"));

    const groups = (res.data as Record<string, unknown>)?.data as Record<string, unknown>[] ?? [];
    if (groups.length === 0) return text("No groups found in this workspace.");

    const list = groups.map((g) => `- ${g.name ?? "Unknown"} (ID: ${g.id ?? "N/A"})`).join("\n");
    return text(`Found ${groups.length} group(s):\n\n${list}`);
  },
);

server.tool(
  "get_group",
  "Get details about a specific group",
  { group_id: z.string().describe("ID of the group") },
  async ({ group_id }) => {
    const err = await ensureReady();
    if (err) return text(formatError("Get Group", err));

    const res = await getClient().getGroup(group_id);
    return res.success
      ? text(formatSuccess("Group Details", res.data ?? {}))
      : text(formatError("Get Group", res.error ?? "Unknown error"));
  },
);

server.tool(
  "update_group",
  "Rename a group",
  {
    group_id: z.string().describe("ID of the group"),
    name: z.string().describe("New name for the group"),
  },
  async ({ group_id, name }) => {
    const v = validateGroupName(name);
    if (!v.ok) return text(formatError("Update Group", v.error));

    const err = await ensureReady();
    if (err) return text(formatError("Update Group", err));

    const res = await getClient().updateGroup(group_id, v.value);
    return res.success
      ? text(formatSuccess(`Renamed group to '${v.value}'`, res.data ?? {}))
      : text(formatError("Update Group", res.error ?? "Unknown error"));
  },
);

server.tool(
  "delete_group",
  "Delete a group from the workspace",
  {
    group_id: z.string().describe("ID of the group to delete"),
    confirm: z.boolean().describe("Must be true to proceed"),
  },
  async ({ group_id, confirm }) => {
    if (!confirm) return text("Deletion not confirmed. Set confirm=true to proceed.");

    const err = await ensureReady();
    if (err) return text(formatError("Delete Group", err));

    const res = await getClient().deleteGroup(group_id);
    return res.success
      ? text(formatSuccess("Deleted Group", { group_id }))
      : text(formatError("Delete Group", res.error ?? "Unknown error"));
  },
);

server.tool(
  "list_group_members",
  "List all members belonging to a group",
  { group_id: z.string().describe("ID of the group") },
  async ({ group_id }) => {
    const err = await ensureReady();
    if (err) return text(formatError("List Group Members", err));

    const res = await getClient().listGroupMembers(group_id);
    if (!res.success) return text(formatError("List Group Members", res.error ?? "Unknown error"));

    const members = (res.data as Record<string, unknown>)?.data as Record<string, unknown>[] ?? [];
    if (members.length === 0) return text("No members in this group.");

    const list = members.map((m) => {
      const user = m.user as Record<string, unknown> | undefined;
      return `- ${user?.email ?? "Unknown"} — ${String(m.status ?? "unknown").toUpperCase()} (ID: ${m.id ?? "N/A"})`;
    }).join("\n");
    return text(`${members.length} member(s) in group:\n\n${list}`);
  },
);

server.tool(
  "add_member_to_group",
  "Add a member to a group (batch endpoint)",
  {
    group_id: z.string().describe("ID of the group"),
    member_id: z.string().describe("ID of the member to add"),
  },
  async ({ group_id, member_id }) => {
    const err = await ensureReady();
    if (err) return text(formatError("Add Member to Group", err));

    const res = await getClient().addMemberToGroup(group_id, member_id);
    return res.success
      ? text(formatSuccess("Added Member to Group", { group_id, member_id }))
      : text(formatError("Add Member to Group", res.error ?? "Unknown error"));
  },
);

server.tool(
  "add_single_member_to_group",
  "Add a single member to a group using their IDs",
  {
    group_id: z.string().describe("ID of the group"),
    member_id: z.string().describe("ID of the member"),
  },
  async ({ group_id, member_id }) => {
    const err = await ensureReady();
    if (err) return text(formatError("Add Member to Group", err));

    const res = await getClient().addSingleMemberToGroup(group_id, member_id);
    return res.success
      ? text(formatSuccess("Added Member to Group", { group_id, member_id }))
      : text(formatError("Add Member to Group", res.error ?? "Unknown error"));
  },
);

server.tool(
  "remove_member_from_group",
  "Remove a member from a group",
  {
    group_id: z.string().describe("ID of the group"),
    member_id: z.string().describe("ID of the member to remove"),
  },
  async ({ group_id, member_id }) => {
    const err = await ensureReady();
    if (err) return text(formatError("Remove Member from Group", err));

    const res = await getClient().removeMemberFromGroup(group_id, member_id);
    return res.success
      ? text(formatSuccess("Removed Member from Group", { group_id, member_id }))
      : text(formatError("Remove Member from Group", res.error ?? "Unknown error"));
  },
);

// ── Permission Management ──

server.tool(
  "grant_permission",
  "Grant permissions to a member or group on a filespace",
  {
    filespace_id: z.string().describe("ID of the filespace"),
    principal_id: z.string().describe("ID of the member or group"),
    permissions: z.array(z.string()).optional().describe("Permissions to grant (read, write, admin)"),
    path: z.string().optional().describe("Path within filespace (default: /)"),
  },
  async ({ filespace_id, principal_id, permissions, path }) => {
    const err = await ensureReady();
    if (err) return text(formatError("Grant Permission", err));

    const res = await getClient().grantPermission(filespace_id, principal_id, permissions ?? ["read"], path ?? "/");
    return res.success
      ? text(formatSuccess("Granted Permissions", res.data ?? {}))
      : text(formatError("Grant Permission", res.error ?? "Unknown error"));
  },
);

server.tool(
  "list_permissions",
  "List all permissions for a filespace",
  {
    filespace_id: z.string().describe("ID of the filespace"),
    principal_id: z.string().optional().describe("Filter by member or group ID"),
    limit: z.number().optional().describe("Maximum results to return"),
    next_cursor: z.string().optional().describe("Pagination cursor from previous response"),
  },
  async ({ filespace_id, principal_id, limit, next_cursor }) => {
    const err = await ensureReady();
    if (err) return text(formatError("List Permissions", err));

    const res = await getClient().listPermissions(filespace_id, {
      principalId: principal_id,
      limit,
      nextCursor: next_cursor,
    });
    if (!res.success) return text(formatError("List Permissions", res.error ?? "Unknown error"));

    const perms = (res.data as Record<string, unknown>)?.data as Record<string, unknown>[] ?? [];
    if (perms.length === 0) return text("No permissions set for this filespace.");

    const list = perms.map((p) =>
      `- ${p.principalId ?? "Unknown"} — ${JSON.stringify(p.permissions ?? [])} on ${p.path ?? "/"}`,
    ).join("\n");
    return text(`Permissions for filespace:\n\n${list}`);
  },
);

server.tool(
  "update_permission",
  "Change the permission level(s) for an existing permission entry",
  {
    filespace_id: z.string().describe("ID of the filespace"),
    permission_id: z.string().describe("ID of the permission to update"),
    permissions: z.array(z.enum(["read", "write"])).describe("New permissions"),
  },
  async ({ filespace_id, permission_id, permissions }) => {
    const err = await ensureReady();
    if (err) return text(formatError("Update Permission", err));

    const res = await getClient().updatePermission(filespace_id, permission_id, permissions);
    return res.success
      ? text(formatSuccess("Updated Permission", res.data ?? {}))
      : text(formatError("Update Permission", res.error ?? "Unknown error"));
  },
);

server.tool(
  "revoke_permission",
  "Revoke/remove a permission from a filespace",
  {
    filespace_id: z.string().describe("ID of the filespace"),
    permission_id: z.string().describe("ID of the permission to revoke"),
  },
  async ({ filespace_id, permission_id }) => {
    const err = await ensureReady();
    if (err) return text(formatError("Revoke Permission", err));

    const res = await getClient().revokePermission(filespace_id, permission_id);
    return res.success
      ? text(formatSuccess("Revoked Permission", { filespace_id, permission_id }))
      : text(formatError("Revoke Permission", res.error ?? "Unknown error"));
  },
);

// ── Service Management ──

server.tool(
  "check_api_health",
  "Check if the API service is healthy and responding",
  {},
  async () => {
    const err = await ensureReady();
    if (err) return text(formatError("API Health Check", err));

    const res = await getClient().getHealth();
    return res.success
      ? text(formatSuccess("API Health Check", { status: "Healthy", endpoint: "http://localhost:3003/api/v1" }))
      : text(formatError("API Health Check", res.error ?? "Unknown error"));
  },
);

server.tool(
  "list_providers",
  "List all available storage providers (AWS, Azure, GCP, Wasabi, etc.)",
  {},
  async () => {
    const err = await ensureReady();
    if (err) return text(formatError("List Providers", err));

    const res = await getClient().listProviders();
    if (!res.success) return text(formatError("List Providers", res.error ?? "Unknown error"));

    const providers = (res.data as Record<string, unknown>)?.data as Record<string, unknown>[] ?? [];
    if (providers.length === 0) return text("No storage providers found.");

    const list = providers.map((p) => `- ${p.name ?? "Unknown"} — ${p.description ?? "No description"}`).join("\n");
    return text(`Available Storage Providers:\n\n${list}`);
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
