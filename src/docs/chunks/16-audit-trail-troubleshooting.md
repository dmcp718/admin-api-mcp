# Audit Trail Analytics — Troubleshooting

## Diagnostic checklist

1. **Docker running?** — `docker info` should return server version
2. **Containers up?** — `audit_trail_status()` or `docker compose ps`
3. **OpenSearch healthy?** — `curl http://localhost:9200/_cluster/health`
4. **Dashboards reachable?** — http://localhost:5601
5. **Filespace mounted?** — check mount point has `.lucid_audit` directory
6. **Events flowing?** — `count_audit_events(group_by: "time", time_range: "1h")`

## Common issues

### Stack won't start

**Port conflicts:**
```bash
# Check if ports are in use
lsof -i :9200   # OpenSearch
lsof -i :5601   # Dashboards
```
Stop conflicting services or change ports in docker-compose.yml.

**Insufficient memory:**
OpenSearch requires at least 2 GB. Increase Docker Desktop memory allocation or reduce heap:
```bash
# In .env
OS_HEAP_SIZE=512m
```

**Docker not running:**
Start Docker Desktop. On Linux: `sudo systemctl start docker`.

### No events in OpenSearch

1. **Filespace not mounted**: Verify `FSMOUNTPOINT` in `.env` points to a valid mounted filespace
2. **No audit logs**: Check `ls <FSMOUNTPOINT>/.lucid_audit` — if empty, no file operations have occurred yet
3. **Fluent Bit error**: Check logs with `docker compose logs fluent-bit`
4. **Permission denied**: Fluent Bit container needs read access to the mount point

### OpenSearch cluster status is yellow/red

**Yellow** (normal for single-node): Replicas can't be assigned. This is expected for development deployments with a single node.

**Red** (data loss risk):
1. Check disk space: `df -h` on the host
2. Check OpenSearch logs: `docker compose logs opensearch-node1`
3. Restart OpenSearch: `docker compose restart opensearch-node1`
4. Last resort: `stop_audit_trail(remove_volumes: true)` and re-index

### Dashboards shows "no data"

1. Verify the index pattern exists: Stack Management > Index Patterns > `audit-trail*`
2. Check time range — adjust the time picker to include when events occurred
3. Verify events exist: `search_audit_events()` with no filters
4. If using multi-filespace, check index name matches pattern

### Queries return no results

- **Wrong field name**: Use `user.name.keyword` (not `user.name`) for term queries
- **Wrong time field**: Use `@timestamp` (not `timestamp`)
- **Time range too narrow**: Widen the range or check when events actually occurred
- **Case sensitivity**: keyword fields are case-sensitive; use exact values from the data

### High disk usage

OpenSearch indices grow with event volume. To manage:

1. Check index size: `get_audit_trail_schema()` includes stats
2. Delete old data with index lifecycle management (ILM) policies
3. For manual cleanup:
```json
{
  "query": {
    "range": {
      "@timestamp": {"lt": "now-90d"}
    }
  }
}
```
Use `run_opensearch_query` with a delete-by-query to remove old events.

### Connection refused errors

- **OpenSearch (9200)**: Container may still be starting — wait 30-60 seconds
- **Dashboards (5601)**: Starts after OpenSearch is healthy — may take 1-2 minutes
- **Behind firewall**: Ensure localhost ports are not blocked by VPN or firewall rules

## Getting help

- Use `audit_trail_status()` for a quick health check
- Use `search_api_docs(query: "audit trail")` for documentation
- Check container logs: `docker compose -f docker/docker-compose.yml logs --tail 100`
- OpenSearch documentation: https://opensearch.org/docs/latest/
