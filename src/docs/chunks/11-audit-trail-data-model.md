# Audit Trail Analytics — Data Model & Event Schema

## Index

- **Index name**: `audit-trail` (or `audit-trail-{filespace}` for multi-filespace setups)
- **Index pattern**: `audit-trail*`
- **Time field**: `@timestamp` (ISO 8601)
- **Engine**: OpenSearch with full-text search capabilities

## Event document structure

```json
{
  "@timestamp": "2026-03-18T10:30:45.123Z",
  "user": {
    "name": "alice.smith",
    "id": "alice.smith@company.com"
  },
  "device": {
    "hostName": "alice-macbook",
    "osName": "macOS",
    "osVersion": "14.2.0"
  },
  "event": {
    "filespace": "production",
    "nodeId": "uuid-string",
    "filespaceUuid": "uuid-string"
  },
  "operation": {
    "action": "FileDelete",
    "entryPath": "/Projects/video/final-cut.mov",
    "file": "final-cut.mov",
    "targetPath": "/Archive/final-cut.mov"
  }
}
```

## Field reference

### Core fields

| Field | Type | Description |
|-------|------|-------------|
| `@timestamp` | date | Event timestamp (ISO 8601) |
| `user.name` | keyword | Username who performed the action |
| `user.id` | keyword | User email/identifier |
| `operation.action` | keyword | Action type (see below) |
| `operation.entryPath` | keyword + text | Full path to the file/directory |
| `operation.file` | keyword | Filename only |
| `operation.targetPath` | keyword | Destination path (for Move operations) |

### Device fields

| Field | Type | Description |
|-------|------|-------------|
| `device.hostName` | keyword | Machine hostname |
| `device.osName` | keyword | Operating system |
| `device.osVersion` | keyword | OS version |

### Event metadata

| Field | Type | Description |
|-------|------|-------------|
| `event.filespace` | keyword | Filespace name |
| `event.nodeId` | keyword | Unique node identifier |
| `event.filespaceUuid` | keyword | Filespace UUID |

## Action types

| Action | Description |
|--------|-------------|
| `FileRead` | File opened for reading |
| `FileWritten` | File contents modified |
| `FileCreate` | New file created |
| `FileDelete` | File deleted |
| `DirectoryCreate` | New directory created |
| `DirectoryDelete` | Directory deleted |
| `Move` | File or directory moved/renamed (check `targetPath`) |
| `ExtendedAttributeSet` | Extended attribute set on file |
| `ExtendedAttributeDelete` | Extended attribute removed |
| `Pin` | File pinned for local caching |
| `Unpin` | File unpinned |

## Field usage tips

- Use `.keyword` suffix for exact matches and aggregations: `user.name.keyword`, `operation.action.keyword`
- Use `@timestamp` (not `timestamp`) for all time-based queries
- `operation.entryPath` has both keyword (exact) and text (full-text) mappings
- `targetPath` is only present on `Move` operations
