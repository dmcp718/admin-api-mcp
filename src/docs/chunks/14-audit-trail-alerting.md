# Audit Trail Analytics — Alerting & Slack Integration

## Overview

OpenSearch alerting monitors run on a schedule, execute a query, and trigger actions when conditions are met. Use alerts to detect suspicious activity, track specific operations, or notify teams about important file events.

## Creating alerts with MCP tools

### Basic deletion alert
```
create_audit_alert(
  name: "File Deletions Alert",
  action: "FileDelete",
  interval_minutes: 5,
  threshold: 1
)
```

### Path-specific alert
```
create_audit_alert(
  name: "Production Changes",
  path: "/Production/",
  interval_minutes: 10
)
```

### User-specific alert
```
create_audit_alert(
  name: "Admin Activity Monitor",
  user: "admin.user",
  interval_minutes: 15
)
```

### Combined filters
```
create_audit_alert(
  name: "Sensitive Deletions",
  action: "FileDelete",
  path: "/Confidential/",
  interval_minutes: 5,
  threshold: 1
)
```

## Slack integration

### Setup

1. Create a Slack incoming webhook at https://api.slack.com/messaging/webhooks
2. Register it with the MCP tool:
```
setup_slack_webhook(
  name: "engineering-alerts",
  webhook_url: "https://hooks.slack.com/services/T00.../B00.../XX..."
)
```

3. Configure alerts to use the webhook in OpenSearch Dashboards:
   - Go to **Alerting** > select a monitor
   - Edit trigger > Add action > select the Slack channel

### Webhook types

- **Incoming webhooks** (`/services/` path): Support Block Kit formatting with rich messages
- **Workflow webhooks** (`/triggers/` path): Simple key-value variables

## Managing alerts

### List all alerts
```
list_audit_alerts()
```

### Delete an alert
```
delete_audit_alert(monitor_id: "abc123")
```

### View in Dashboards
Navigate to http://localhost:5601/_plugins/_alerting to:
- View all monitors and their status
- See alert history and triggered events
- Edit trigger conditions and actions
- Acknowledge or mute alerts

## Alert severity levels

| Level | Color | Use case |
|-------|-------|----------|
| 1 (Critical) | Red | Mass deletions, unauthorized access |
| 2 (High) | Orange | Deletions in sensitive paths |
| 3 (Medium) | Yellow | Unusual activity patterns |
| 4 (Low) | Green | Informational monitoring |
| 5 (Info) | Blue | General tracking |

## Advanced: custom monitor query

For complex alert conditions, create monitors directly in OpenSearch Dashboards with custom query DSL:

```json
{
  "size": 0,
  "query": {
    "bool": {
      "must": [
        {"term": {"operation.action.keyword": "FileDelete"}},
        {"range": {"@timestamp": {"gte": "now-5m"}}},
        {"prefix": {"operation.entryPath.keyword": "/Production/"}}
      ],
      "must_not": [
        {"term": {"user.name.keyword": "automated-cleanup"}}
      ]
    }
  }
}
```

Trigger condition (Painless script):
```
ctx.results[0].hits.total.value > 10
```

This fires when more than 10 deletions in /Production/ occur within 5 minutes, excluding automated cleanup operations.
