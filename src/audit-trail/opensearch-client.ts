/**
 * HTTP client for OpenSearch REST API.
 * Follows the ApiClient pattern: never throws, returns { success, data, error }.
 */
import type {
  OpenSearchResponse,
  SearchResult,
  ClusterHealth,
  IndexStats,
  MonitorDefinition,
} from "./types.js";
import { AUDIT_TRAIL_INDEX } from "./types.js";

const DEFAULT_URL = "http://localhost:9200";
const DEFAULT_USER = "admin";
const DEFAULT_PASS = "Admin123!";

export class OpenSearchClient {
  private baseUrl: string;
  private headers: Record<string, string>;

  constructor(
    baseUrl?: string,
    user?: string,
    password?: string,
  ) {
    this.baseUrl = baseUrl ?? process.env.OPENSEARCH_URL ?? DEFAULT_URL;
    const u = user ?? process.env.OPENSEARCH_USER ?? DEFAULT_USER;
    const p = password ?? process.env.OPENSEARCH_PASSWORD ?? DEFAULT_PASS;
    const auth = Buffer.from(`${u}:${p}`).toString("base64");
    this.headers = {
      "Content-Type": "application/json",
      Authorization: `Basic ${auth}`,
    };
  }

  private async request(
    method: string,
    path: string,
    body?: Record<string, unknown>,
  ): Promise<OpenSearchResponse> {
    try {
      const res = await fetch(`${this.baseUrl}${path}`, {
        method,
        headers: this.headers,
        body: body ? JSON.stringify(body) : undefined,
      });

      const text = await res.text();
      const data = text ? JSON.parse(text) : {};

      if (res.status >= 200 && res.status < 300) {
        return { success: true, data };
      }
      const msg =
        (data as Record<string, unknown>).error
          ? JSON.stringify((data as Record<string, unknown>).error)
          : `HTTP ${res.status}`;
      return { success: false, error: msg };
    } catch (e: unknown) {
      if (e instanceof TypeError && String(e.message).includes("fetch failed")) {
        return {
          success: false,
          error: "Cannot connect to OpenSearch. Is the audit trail stack running?",
        };
      }
      return { success: false, error: `Unexpected error: ${e}` };
    }
  }

  // ── Cluster ──

  async clusterHealth(): Promise<OpenSearchResponse> {
    return this.request("GET", "/_cluster/health");
  }

  // ── Index ──

  async indexStats(index = AUDIT_TRAIL_INDEX): Promise<OpenSearchResponse> {
    return this.request("GET", `/${index}/_stats`);
  }

  async getMapping(index = AUDIT_TRAIL_INDEX): Promise<OpenSearchResponse> {
    return this.request("GET", `/${index}/_mapping`);
  }

  async indexExists(index = AUDIT_TRAIL_INDEX): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/${index}`, {
        method: "HEAD",
        headers: this.headers,
      });
      return res.status === 200;
    } catch {
      return false;
    }
  }

  // ── Search ──

  async search(
    query: Record<string, unknown>,
    index = AUDIT_TRAIL_INDEX,
    size = 50,
  ): Promise<OpenSearchResponse> {
    return this.request("POST", `/${index}/_search`, { size, ...query });
  }

  async count(
    query?: Record<string, unknown>,
    index = AUDIT_TRAIL_INDEX,
  ): Promise<OpenSearchResponse> {
    const body = query ? { query } : undefined;
    return this.request("POST", `/${index}/_count`, body);
  }

  // ── Bulk index ──

  async bulk(operations: string): Promise<OpenSearchResponse> {
    try {
      const res = await fetch(`${this.baseUrl}/_bulk`, {
        method: "POST",
        headers: { ...this.headers, "Content-Type": "application/x-ndjson" },
        body: operations,
      });
      const data = JSON.parse(await res.text());
      if (res.status >= 200 && res.status < 300) {
        return { success: true, data };
      }
      return { success: false, error: `Bulk index failed: HTTP ${res.status}` };
    } catch (e) {
      return { success: false, error: `Bulk error: ${e}` };
    }
  }

  // ── Alerting ──

  async createMonitor(monitor: MonitorDefinition): Promise<OpenSearchResponse> {
    return this.request("POST", "/_plugins/_alerting/monitors", monitor as unknown as Record<string, unknown>);
  }

  async listMonitors(): Promise<OpenSearchResponse> {
    return this.request("POST", "/_plugins/_alerting/monitors/_search", {
      size: 100,
      query: { match_all: {} },
    });
  }

  async deleteMonitor(id: string): Promise<OpenSearchResponse> {
    return this.request("DELETE", `/_plugins/_alerting/monitors/${id}`);
  }

  // ── Notification channels ──

  async createWebhookChannel(
    name: string,
    webhookUrl: string,
  ): Promise<OpenSearchResponse> {
    return this.request("POST", "/_plugins/_notifications/configs", {
      config_id: name.toLowerCase().replace(/\s+/g, "-"),
      config: {
        name,
        description: `Slack webhook for ${name}`,
        config_type: "slack",
        is_enabled: true,
        slack: { url: webhookUrl },
      },
    });
  }
}
