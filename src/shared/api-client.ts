/**
 * HTTP client for the LucidLink Admin API (localhost:3003).
 * Uses Node 18+ built-in fetch — zero dependencies.
 */
import { RateLimiter } from "./rate-limiter.js";

const API_BASE = "http://localhost:3003/api/v1";

export interface ApiResponse {
  success: boolean;
  data?: Record<string, unknown>;
  error?: string;
  statusCode?: number;
}

export class ApiClient {
  private headers: Record<string, string>;
  private rateLimiter = new RateLimiter();

  constructor(
    bearerToken: string,
    private baseUrl: string = API_BASE,
  ) {
    this.headers = {
      Authorization: `Bearer ${bearerToken}`,
      "Content-Type": "application/json",
    };
  }

  async request(
    method: string,
    endpoint: string,
    opts: { data?: Record<string, unknown>; params?: Record<string, string> } = {},
  ): Promise<ApiResponse> {
    if (!this.rateLimiter.check()) {
      const wait = this.rateLimiter.timeUntilReset();
      return { success: false, error: `Rate limit exceeded. Please wait ${wait} seconds.` };
    }

    let url = `${this.baseUrl}${endpoint}`;
    if (opts.params) {
      const qs = new URLSearchParams(opts.params).toString();
      if (qs) url += `?${qs}`;
    }

    try {
      const res = await fetch(url, {
        method,
        headers: this.headers,
        body: opts.data ? JSON.stringify(opts.data) : undefined,
      });

      if (res.status >= 200 && res.status < 300) {
        const text = await res.text();
        const data = text ? JSON.parse(text) : {};
        return { success: true, data, statusCode: res.status };
      }

      const error = await this.parseError(res);
      return { success: false, error, statusCode: res.status };
    } catch (e: unknown) {
      if (e instanceof TypeError && String(e.message).includes("fetch failed")) {
        return { success: false, error: "Cannot connect to API. Is the LucidLink API process running?" };
      }
      return { success: false, error: `Unexpected error: ${e}` };
    }
  }

  private async parseError(res: Response): Promise<string> {
    try {
      const body = await res.json() as Record<string, unknown>;
      if (body.message) return String(body.message);
      if (body.error) {
        if (typeof body.error === "object" && body.error !== null && "message" in (body.error as Record<string, unknown>)) {
          return String((body.error as Record<string, unknown>).message);
        }
        return String(body.error);
      }
    } catch {
      // fall through
    }

    const statusMessages: Record<number, string> = {
      400: "Invalid request parameters",
      401: "Authentication failed - check your Bearer token",
      403: "Permission denied",
      404: "Resource not found",
      409: "Resource already exists",
      422: "Request cannot be processed",
      500: "API server error",
    };

    return statusMessages[res.status] ?? `API error (status ${res.status})`;
  }

  // ── Admin API methods ──

  createFilespace(name: string, region = "us-east-1", storageProvider = "AWS", storageOwner = "lucidlink") {
    return this.request("POST", "/filespaces", { data: { name, region, storageProvider, storageOwner } });
  }
  listFilespaces() { return this.request("GET", "/filespaces"); }
  getFilespace(id: string) { return this.request("GET", `/filespaces/${id}`); }
  updateFilespace(id: string, name: string) { return this.request("PATCH", `/filespaces/${id}`, { data: { name } }); }
  deleteFilespace(id: string) { return this.request("DELETE", `/filespaces/${id}`); }

  addMember(email: string) { return this.request("POST", "/members", { data: { email } }); }
  listMembers(email?: string) { return this.request("GET", "/members", { params: email ? { email } : undefined }); }
  getMember(id: string) { return this.request("GET", `/members/${id}`); }
  removeMember(id: string) { return this.request("DELETE", `/members/${id}`); }
  updateMemberRole(id: string, role: string, filespaceIds?: string[]) {
    const data: Record<string, unknown> = { role };
    if (filespaceIds) data.filespaceIds = filespaceIds;
    return this.request("PATCH", `/members/${id}`, { data });
  }
  getMemberGroups(id: string) { return this.request("GET", `/members/${id}/groups`); }

  createGroup(name: string, description = "") { return this.request("POST", "/groups", { data: { name, description } }); }
  listGroups(name?: string) { return this.request("GET", "/groups", { params: name ? { name } : undefined }); }
  getGroup(id: string) { return this.request("GET", `/groups/${id}`); }
  updateGroup(id: string, name: string) { return this.request("PATCH", `/groups/${id}`, { data: { name } }); }
  deleteGroup(id: string) { return this.request("DELETE", `/groups/${id}`); }
  listGroupMembers(id: string) { return this.request("GET", `/groups/${id}/members`); }
  addMemberToGroup(groupId: string, memberId: string) {
    return this.request("PUT", "/groups/members", { data: { memberships: [{ groupId, memberId }] } });
  }
  addSingleMemberToGroup(groupId: string, memberId: string) {
    return this.request("PUT", `/groups/${groupId}/members/${memberId}`);
  }
  removeMemberFromGroup(groupId: string, memberId: string) {
    return this.request("DELETE", `/groups/${groupId}/members/${memberId}`);
  }

  grantPermission(filespaceId: string, principalId: string, permissions = ["read"], path = "/") {
    return this.request("POST", `/filespaces/${filespaceId}/permissions`, { data: { path, permissions, principalId } });
  }
  listPermissions(filespaceId: string, opts: { principalId?: string; limit?: number; nextCursor?: string } = {}) {
    const params: Record<string, string> = {};
    if (opts.principalId) params.principalId = opts.principalId;
    if (opts.limit) params.limit = String(opts.limit);
    if (opts.nextCursor) params.nextCursor = opts.nextCursor;
    return this.request("GET", `/filespaces/${filespaceId}/permissions`, { params: Object.keys(params).length ? params : undefined });
  }
  updatePermission(filespaceId: string, permissionId: string, permissions: string[]) {
    return this.request("PATCH", `/filespaces/${filespaceId}/permissions/${permissionId}`, { data: { permissions } });
  }
  revokePermission(filespaceId: string, permissionId: string) {
    return this.request("DELETE", `/filespaces/${filespaceId}/permissions/${permissionId}`);
  }

  generateDirectLink(filespaceId: string, opts: { entryId?: string; path?: string }) {
    const params: Record<string, string> = {};
    if (opts.entryId) params.entryId = opts.entryId;
    if (opts.path) params.path = opts.path;
    return this.request("GET", `/filespaces/${filespaceId}/direct-links`, { params });
  }

  getHealth() { return this.request("GET", "/health"); }
  listProviders() { return this.request("GET", "/providers"); }

  // ── Connect API methods ──

  createEntry(filespaceId: string, parentId: string, name: string) {
    return this.request("POST", `/filespaces/${filespaceId}/entries`, { data: { parentId, name, type: "dir" } });
  }
  resolveEntry(filespaceId: string, path: string) {
    return this.request("GET", `/filespaces/${filespaceId}/entries/resolve`, { params: { path } });
  }
  getEntry(filespaceId: string, entryId: string) {
    return this.request("GET", `/filespaces/${filespaceId}/entries/${entryId}`);
  }
  deleteEntry(filespaceId: string, entryId: string) {
    return this.request("DELETE", `/filespaces/${filespaceId}/entries/${entryId}`);
  }
  listEntryChildren(filespaceId: string, entryId: string, opts: { limit?: number; nextCursor?: string } = {}) {
    const params: Record<string, string> = {};
    if (opts.limit) params.limit = String(opts.limit);
    if (opts.nextCursor) params.nextCursor = opts.nextCursor;
    return this.request("GET", `/filespaces/${filespaceId}/entries/${entryId}/children`, { params: Object.keys(params).length ? params : undefined });
  }

  createDataStore(filespaceId: string, data: Record<string, unknown>) {
    return this.request("POST", `/filespaces/${filespaceId}/external/data-stores`, { data });
  }
  listDataStores(filespaceId: string, name?: string) {
    return this.request("GET", `/filespaces/${filespaceId}/external/data-stores`, { params: name ? { name } : undefined });
  }
  getDataStore(filespaceId: string, dsId: string) {
    return this.request("GET", `/filespaces/${filespaceId}/external/data-stores/${dsId}`);
  }
  updateDataStore(filespaceId: string, dsId: string, data: Record<string, unknown>) {
    return this.request("PATCH", `/filespaces/${filespaceId}/external/data-stores/${dsId}`, { data });
  }
  deleteDataStore(filespaceId: string, dsId: string) {
    return this.request("DELETE", `/filespaces/${filespaceId}/external/data-stores/${dsId}`);
  }

  createExternalEntry(filespaceId: string, data: Record<string, unknown>) {
    return this.request("POST", `/filespaces/${filespaceId}/external/entries`, { data });
  }
  listExternalEntryIds(filespaceId: string, opts: { dataStoreId?: string; limit?: number; nextCursor?: string } = {}) {
    const params: Record<string, string> = {};
    if (opts.dataStoreId) params.dataStoreId = opts.dataStoreId;
    if (opts.limit) params.limit = String(opts.limit);
    if (opts.nextCursor) params.nextCursor = opts.nextCursor;
    return this.request("GET", `/filespaces/${filespaceId}/external/entries/ids`, { params: Object.keys(params).length ? params : undefined });
  }
  deleteExternalEntry(filespaceId: string, entryId: string) {
    return this.request("DELETE", `/filespaces/${filespaceId}/external/entries/${entryId}`);
  }
}
