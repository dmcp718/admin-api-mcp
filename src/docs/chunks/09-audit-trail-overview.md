# Audit Trail Analytics — Overview

LucidLink Audit Trail Analytics provides real-time monitoring and searchable history of all file operations across your filespaces. Built on OpenSearch, it indexes events from LucidLink's native `.lucid_audit` logs.

## Architecture

```
LucidLink Filespace (.lucid_audit logs)
        │
        ▼
    Fluent Bit  ──►  OpenSearch  ──►  OpenSearch Dashboards
   (collector)       (index/search)    (visualization, port 5601)
```

Three Docker containers:
1. **OpenSearch** (port 9200) — stores and indexes audit events with full-text search
2. **OpenSearch Dashboards** (port 5601) — web UI for visualizations, dashboards, and alerting
3. **Fluent Bit** — collects `.lucid_audit` NDJSON logs from mounted filespaces and ships to OpenSearch

## What gets tracked

Every file operation on a LucidLink filespace generates an audit event:
- **FileRead** — file opened for reading
- **FileWritten** — file modified
- **FileCreate** — new file created
- **FileDelete** — file deleted
- **DirectoryCreate** / **DirectoryDelete** — folder operations
- **Move** — file or directory moved/renamed
- **Pin** / **Unpin** — file pinning operations
- **ExtendedAttributeSet** / **ExtendedAttributeDelete** — xattr changes

Each event includes: timestamp, username, device hostname, OS info, filespace name, action type, full file path, and target path (for moves).

## Use cases

- **Security monitoring**: detect unauthorized file deletions or access to sensitive directories
- **Compliance**: audit trail for regulatory requirements (who accessed what, when)
- **Operational insight**: understand usage patterns, identify heavy users, track project activity
- **Incident response**: investigate file changes around a specific time or by a specific user
- **Alerting**: get notified via Slack when specific events occur (e.g., deletions in /Production/)
