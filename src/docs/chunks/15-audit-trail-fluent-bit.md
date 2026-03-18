# Audit Trail Analytics — Fluent Bit Pipeline Configuration

## Overview

Fluent Bit is the lightweight log collector that reads LucidLink's `.lucid_audit` NDJSON log files and ships them to OpenSearch. It runs as a Docker container with the filespace mounted read-only.

## Pipeline flow

```
.lucid_audit logs → Tail input → JSON parser → Lua timestamp filter → OpenSearch output
```

## Configuration

The main configuration is in `config/fluent-bit/fs-audit-trail-opensearch.yaml`:

### Input (Tail plugin)

```yaml
inputs:
  - name: tail
    path: /media/lucidlink/.lucid_audit/*/*/*/*.log*
    parser: json
    db: /fluent-bit/db/logs.db
    read_from_head: true
    skip_long_lines: on
    skip_empty_lines: on
    buffer_chunk_size: 2MB
    buffer_max_size: 10MB
```

Key settings:
- **path**: Glob pattern matching LucidLink audit log files
- **db**: SQLite database that tracks file read positions (enables resume after restart)
- **read_from_head**: Start from beginning of files on first run
- **buffer sizes**: Handle large log bursts

### Timestamp filter (Lua)

LucidLink audit logs store timestamps in microseconds. Fluent Bit needs seconds + nanoseconds:

```yaml
filters:
  - name: lua
    call: parse_time
    code: |
      function parse_time(tag, timestamp, record)
        if record["timestamp"] then
          local microseconds = record["timestamp"]
          recordTimestamp = {
            sec = math.floor(microseconds / 1000000),
            nsec = (microseconds % 1000000) * 1000
          }
          record["timestamp"] = nil
          return 1, recordTimestamp, record
        end
        return 0, timestamp, record
      end
```

### Output (OpenSearch)

```yaml
outputs:
  - name: opensearch
    host: opensearch-node1
    port: 9200
    index: audit-trail
    time_key: '@timestamp'
    buffer_size: 2MB
    retry_limit: 5
```

## Environment variables

| Variable | Default | Description |
|----------|---------|-------------|
| `FB_FLUSH_INTERVAL` | `5` | Seconds between output flushes |
| `FB_LOG_LEVEL` | `info` | Log verbosity (debug, info, warn, error) |
| `FB_BUFFER_SIZE` | `2MB` | Output buffer size |
| `CLUSTER_NAME` | `production` | Tag added to events via record_modifier |
| `ENVIRONMENT` | `prod` | Environment tag |

## Monitoring Fluent Bit

### View logs
```bash
docker compose -f docker/docker-compose.yml logs fluent-bit --tail 50
```

### Check processing state
The SQLite database (`/fluent-bit/db/logs.db`) tracks:
- Which files have been read
- Current read position in each file
- This enables seamless resume after container restarts

### Common issues

**No events appearing in OpenSearch:**
1. Check that the filespace is mounted and has `.lucid_audit` directory
2. Verify the mount is accessible inside the container: `docker exec <container> ls /media/lucidlink/.lucid_audit`
3. Check Fluent Bit logs for parse errors
4. Verify OpenSearch is healthy: `curl http://localhost:9200/_cluster/health`

**Duplicate events after restart:**
- The SQLite database prevents duplicates under normal operation
- If the database is deleted, Fluent Bit re-reads from head, causing duplicates
- Solution: don't delete the Fluent Bit volume unless you also clear the OpenSearch index

**High memory usage:**
- Reduce `buffer_chunk_size` and `buffer_max_size`
- Increase `FB_FLUSH_INTERVAL` to batch more events per flush
- Ensure OpenSearch is healthy and accepting writes (backpressure causes buffering)
