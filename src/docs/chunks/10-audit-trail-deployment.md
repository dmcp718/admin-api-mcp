# Audit Trail Analytics — Deployment Guide

## Prerequisites

- Docker Desktop (or Docker Engine + Docker Compose v2)
- A mounted LucidLink filespace with `.lucid_audit` directory
- At least 4 GB RAM available for containers
- Ports 9200 (OpenSearch) and 5601 (Dashboards) available

## Quick start

### 1. Configure

Use the `setup_audit_trail` MCP tool:
```
setup_audit_trail(fsmountpoint: "/Volumes/production")
```

This clones the audit trail repo (if needed), sets the `FSMOUNTPOINT` environment variable, and validates Docker is running.

### 2. Start the stack

```
start_audit_trail()
```

Runs `docker compose up -d` and waits for OpenSearch to be healthy. Dashboard is available at http://localhost:5601 once ready.

### 3. Verify

```
audit_trail_status()
```

Shows container health, OpenSearch cluster status, document count, and Dashboards reachability.

## Manual deployment

If not using MCP tools:

```bash
git clone git@bitbucket.org:lucidlink/ll-audit-trail-es.git
cd ll-audit-trail-es

# Configure mount point
echo "FSMOUNTPOINT=/Volumes/production" > .env

# Start
docker compose -f docker/docker-compose.yml up -d

# Verify
curl http://localhost:9200/_cluster/health?pretty
curl http://localhost:5601/api/status
```

## Environment variables

| Variable | Default | Description |
|----------|---------|-------------|
| `FSMOUNTPOINT` | (required) | Path to mounted LucidLink filespace |
| `OPENSEARCH_URL` | `http://localhost:9200` | OpenSearch endpoint |
| `OPENSEARCH_USER` | `admin` | OpenSearch username |
| `OPENSEARCH_PASSWORD` | `Admin123!` | OpenSearch password |
| `OS_HEAP_SIZE` | `1g` | OpenSearch JVM heap size |
| `FB_FLUSH_INTERVAL` | `5` | Fluent Bit flush interval (seconds) |
| `FB_LOG_LEVEL` | `info` | Fluent Bit log level |

## Resource requirements

| Service | CPU | Memory | Disk |
|---------|-----|--------|------|
| OpenSearch | 1-2 cores | 2-4 GB | 10+ GB (depends on event volume) |
| Dashboards | 0.5 core | 512 MB | minimal |
| Fluent Bit | 0.1 core | 64 MB | minimal |

## Stopping and cleanup

```
stop_audit_trail()                        # Stop, keep data
stop_audit_trail(remove_volumes: true)    # Stop and delete all data
```

## Multi-filespace setup

For monitoring multiple filespaces, use the multi-filespace Docker Compose variant which creates separate Fluent Bit instances or tag-based routing per filespace. Contact LucidLink support for configuration guidance.
