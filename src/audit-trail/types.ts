/**
 * Shared types for the audit trail MCP server.
 */

export interface OpenSearchResponse {
  success: boolean;
  data?: Record<string, unknown>;
  error?: string;
}

export interface AuditEvent {
  "@timestamp": string;
  user: {
    name: string;
    id?: string;
  };
  device?: {
    hostName?: string;
    osName?: string;
    osVersion?: string;
  };
  event?: {
    filespace?: string;
    nodeId?: string;
    filespaceUuid?: string;
  };
  operation: {
    action: string;
    entryPath: string;
    file?: string;
    targetPath?: string;
  };
}

export interface ClusterHealth {
  cluster_name: string;
  status: string;
  number_of_nodes: number;
  active_primary_shards: number;
  active_shards: number;
}

export interface IndexStats {
  docs: { count: number };
  store: { size_in_bytes: number };
}

export interface SearchHit {
  _id: string;
  _source: AuditEvent;
  _score?: number;
}

export interface SearchResult {
  hits: {
    total: { value: number };
    hits: SearchHit[];
  };
  aggregations?: Record<string, unknown>;
}

export interface MonitorDefinition {
  name: string;
  type: string;
  enabled: boolean;
  schedule: { period: { interval: number; unit: string } };
  inputs: Array<{ search: { indices: string[]; query: Record<string, unknown> } }>;
  triggers: Array<Record<string, unknown>>;
}

export interface ContainerStatus {
  name: string;
  state: string;
  health?: string;
}

export type ServiceName = "opensearch" | "opensearch-dashboards" | "fluent-bit";

export const AUDIT_TRAIL_INDEX = "audit-trail";

export const VALID_ACTIONS = [
  "FileRead",
  "FileWritten",
  "FileCreate",
  "FileDelete",
  "DirectoryCreate",
  "DirectoryDelete",
  "Move",
  "ExtendedAttributeSet",
  "ExtendedAttributeDelete",
  "Pin",
  "Unpin",
] as const;

export type AuditAction = (typeof VALID_ACTIONS)[number];
