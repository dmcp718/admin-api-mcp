# Audit Trail Analytics — Dashboard Customization

## Default dashboard

The audit trail stack ships with a pre-configured dashboard accessible at http://localhost:5601 after starting the stack.

### Pre-built visualizations

1. **User activity timeline** — line chart showing events over 24 hours, broken down by user
2. **Top users** — pie/donut chart of most active users by event count
3. **Event type distribution** — horizontal bar chart of action types by frequency
4. **Most active paths** — table showing file paths with highest activity

### Pre-built saved searches

- **Audit trail events** — default search view with columns: `user.name`, `operation.action`, `operation.entryPath`, `@timestamp`

## Accessing the dashboard

1. Start the stack: `start_audit_trail()`
2. Open http://localhost:5601
3. Navigate to **Dashboards** in the left sidebar
4. Select **LucidLink Audit Trail Dashboard**

## Customizing visualizations

### Adding a new visualization

1. Go to **Visualize** in Dashboards
2. Click **Create visualization**
3. Select chart type (line, bar, pie, table, etc.)
4. Set index pattern to `audit-trail*`
5. Configure metrics and buckets using the field reference

### Useful custom visualizations

**File deletions by user (last 7 days)**:
- Type: Vertical bar
- Metric: Count
- Bucket: Terms on `user.name.keyword`
- Filter: `operation.action.keyword: FileDelete`
- Time range: Last 7 days

**Activity heatmap by hour**:
- Type: Heatmap
- Y-axis: Terms on `user.name.keyword`
- X-axis: Date histogram on `@timestamp`, interval: 1h
- Value: Count

**Move operations tracking**:
- Type: Data table
- Columns: `@timestamp`, `user.name`, `operation.entryPath`, `operation.targetPath`
- Filter: `operation.action.keyword: Move`

## Index pattern setup

If the index pattern is not auto-created:

1. Go to **Stack Management** > **Index Patterns**
2. Create pattern: `audit-trail*`
3. Time field: `@timestamp`
4. Save

## Dashboard sharing

- **Export**: Stack Management > Saved Objects > export dashboards as NDJSON
- **Import**: Stack Management > Saved Objects > import NDJSON file
- **Embed**: Dashboards > Share > Embed code (iframe)
- **PDF/PNG**: Dashboards > Share > PDF/PNG reports (requires reporting plugin)

## OpenSearch query bar

The Dashboards query bar uses DQL (Dashboard Query Language):

```
user.name: "alice.smith" AND operation.action: "FileDelete"
operation.entryPath: "/Projects/*"
NOT operation.action: "FileRead"
```

Use the time picker in the top-right to set the time range for all visualizations.
