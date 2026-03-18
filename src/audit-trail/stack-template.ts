/**
 * Embedded Docker Compose stack for the audit trail.
 *
 * Generates all 7 files needed to run the OpenSearch + Dashboards + Fluent Bit
 * stack. Written to ~/.lucidlink/audit-trail/ so Docker named volumes persist
 * across restarts.
 *
 * Key difference from the original ll-audit-trail-es repo layout:
 *   docker-compose.yml lives at root, so volume paths use ./config/... (not
 *   ../config/...) and the Fluent Bit build context is "." (not "..").
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// ── File contents ──

const DOCKER_COMPOSE = `services:
  opensearch-node1:
    image: opensearchproject/opensearch:3.5.0
    container_name: opensearch-node1
    environment:
      - cluster.name=\${OPENSEARCH_CLUSTER_NAME:-lucidlink-audit-cluster}
      - node.name=opensearch-node1
      - discovery.type=single-node
      - bootstrap.memory_lock=true
      - plugins.security.disabled=\${DISABLE_SECURITY:-true}
      - "OPENSEARCH_JAVA_OPTS=-Xms\${OS_HEAP_SIZE:-1g} -Xmx\${OS_HEAP_SIZE:-1g}"
      - OPENSEARCH_INITIAL_ADMIN_PASSWORD=\${OPENSEARCH_ADMIN_PASSWORD:-LucidL1nk@2026!}
    ulimits:
      memlock:
        soft: -1
        hard: -1
      nofile:
        soft: 65536
        hard: 65536
    volumes:
      - opensearch-data1:/usr/share/opensearch/data
    ports:
      - "\${OS_HTTP_PORT:-9200}:9200"
      - "\${OS_PERF_PORT:-9600}:9600"
    networks:
      - opensearch-net
    deploy:
      resources:
        limits:
          cpus: "\${OS_MAX_CPU:-2.0}"
          memory: \${OS_MAX_MEMORY:-2g}
        reservations:
          cpus: "0.5"
          memory: 512m
    healthcheck:
      test: ["CMD-SHELL", "curl -f http://localhost:9200/_cluster/health || exit 1"]
      interval: 30s
      timeout: 10s
      retries: 5
      start_period: 60s
    restart: unless-stopped

  opensearch-dashboards:
    image: opensearchproject/opensearch-dashboards:3.5.0
    container_name: opensearch-dashboards
    volumes:
      - ./config/opensearch-dashboards/opensearch_dashboards.yml:/usr/share/opensearch-dashboards/config/opensearch_dashboards.yml:ro
      - ./dashboards/imports.ndjson:/usr/share/opensearch-dashboards/saved_objects/imports.ndjson:ro
    environment:
      - OPENSEARCH_HOSTS=["http://opensearch-node1:9200"]
      - DISABLE_SECURITY_DASHBOARDS_PLUGIN=\${DISABLE_SECURITY:-true}
      - OPENSEARCH_USERNAME=\${OPENSEARCH_USERNAME:-admin}
      - OPENSEARCH_PASSWORD=\${OPENSEARCH_PASSWORD:-LucidL1nk@2026!}
    ports:
      - "\${DASHBOARDS_PORT:-5601}:5601"
    networks:
      - opensearch-net
    deploy:
      resources:
        limits:
          cpus: "\${DASHBOARDS_MAX_CPU:-1.0}"
          memory: \${DASHBOARDS_MAX_MEMORY:-1g}
        reservations:
          cpus: "0.25"
          memory: 256m
    depends_on:
      opensearch-node1:
        condition: service_healthy
    healthcheck:
      test: ["CMD-SHELL", "curl -f http://localhost:5601/api/status || exit 1"]
      interval: 30s
      timeout: 10s
      retries: 5
      start_period: 120s
    restart: unless-stopped

  dashboards-setup:
    image: curlimages/curl:latest
    volumes:
      - ./scripts/import-saved-objects-opensearch.sh:/import-saved-objects.sh:ro
      - ./dashboards/imports.ndjson:/usr/share/opensearch-dashboards/saved_objects/imports.ndjson:ro
    entrypoint: ["/bin/sh", "/import-saved-objects.sh"]
    networks:
      - opensearch-net
    depends_on:
      opensearch-dashboards:
        condition: service_healthy
    restart: "no"

  fluent-bit:
    build:
      context: .
      dockerfile: docker/Dockerfile-fluent-bit
    container_name: fluent-bit
    volumes:
      - ./config/fluent-bit/fs-audit-trail-opensearch.yaml:/fluent-bit/etc/fs-audit-trail.yaml:ro
      - ./config/fluent-bit/json-parser.conf:/fluent-bit/etc/parsers.conf:ro
      - \${FSMOUNTPOINT}:/media/lucidlink:ro
      - fluent-bit-db:/fluent-bit/db
    environment:
      - FB_FLUSH_INTERVAL=\${FB_FLUSH_INTERVAL:-15}
      - FB_LOG_LEVEL=\${FB_LOG_LEVEL:-info}
      - FB_BUFFER_SIZE=\${FB_BUFFER_SIZE:-2MB}
    ulimits:
      memlock:
        soft: -1
        hard: -1
      nofile:
        soft: 65536
        hard: 65536
    deploy:
      resources:
        limits:
          cpus: "\${FB_MAX_CPU:-0.5}"
          memory: \${FB_MAX_MEMORY:-512m}
        reservations:
          cpus: "0.1"
          memory: 128m
    depends_on:
      opensearch-node1:
        condition: service_healthy
    networks:
      - opensearch-net
    healthcheck:
      test: ["CMD", "/opt/fluent-bit/bin/fluent-bit", "--version"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 30s
    restart: unless-stopped
    logging:
      driver: "json-file"
      options:
        max-size: "10m"
        max-file: "3"

volumes:
  opensearch-data1:
  fluent-bit-db:

networks:
  opensearch-net:
    driver: bridge
`;

const OPENSEARCH_DASHBOARDS_YML = `---
# OpenSearch Dashboards Configuration

# Server settings
server.host: "0.0.0.0"
server.port: 5601

# OpenSearch connection
opensearch.hosts: ["http://opensearch-node1:9200"]

# Security
opensearch.ssl.verificationMode: none

# Data source must be disabled for single-cluster setup
data_source.enabled: false

# UI Settings - Dark theme as default
uiSettings:
  overrides:
    "theme:darkMode": true
`;

const FLUENT_BIT_YAML = `service:
  flush: 5
  daemon: 'off'
  log_level: info
  parsers_file: /fluent-bit/etc/parsers.conf

pipeline:
  inputs:
    - name: tail
      path: /media/lucidlink/.lucid_audit/*/*/*/*.log*
      parser: json
      db: /fluent-bit/db/logs.db
      read_from_head: true
      path_key: source.filename
      offset_key: source.offset
      skip_long_lines: on
      skip_empty_lines: on
      buffer_chunk_size: 2MB
      buffer_max_size: 10MB

  filters:
    - name: lua
      match: '*'
      call: parse_time
      time_as_table: true
      code: |
        function parse_time(tag, timestamp, record)
          local recordTimestamp;
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

  outputs:
    - name: stdout
      match: '*'
      format: json_lines

    - name: opensearch
      match: '*'
      host: opensearch-node1
      port: 9200
      index: audit-trail
      type: _doc
      suppress_type_name: on
      buffer_size: 2MB
      replace_dots: on
      logstash_format: off
      logstash_prefix: audit-trail
      logstash_dateformat: "%Y.%m.%d"
      time_key: '@timestamp'
      time_key_format: "%Y-%m-%dT%H:%M:%S"
      include_tag_key: off
      tag_key: '@log_tag'
      retry_limit: 5
      net.keepalive: on
      net.keepalive_idle_timeout: 30
      net.keepalive_max_recycle: 1000
      tls: off
      tls.verify: off
      http_user: \${OPENSEARCH_USER}
      http_passwd: \${OPENSEARCH_PASSWORD}
      trace_output: on
      trace_error: on
      write_operation: index
`;

const JSON_PARSER_CONF = `[PARSER]
    Name        json
    Format      json
    Time_Key    timestamp
    Time_Format %s
`;

const DOCKERFILE_FLUENT_BIT = `FROM debian:bookworm-slim

# Install dependencies
RUN apt-get update && apt-get install -y \\
    curl \\
    gnupg \\
    ca-certificates \\
    lsb-release \\
    && rm -rf /var/lib/apt/lists/*

# Install Fluent Bit for Debian Bookworm
# Add Fluent Bit repository and GPG key
RUN curl -fsSL https://packages.fluentbit.io/fluentbit.key | gpg --dearmor -o /usr/share/keyrings/fluentbit-keyring.gpg && \\
    echo "deb [signed-by=/usr/share/keyrings/fluentbit-keyring.gpg] https://packages.fluentbit.io/debian/bookworm bookworm main" > /etc/apt/sources.list.d/fluent-bit.list && \\
    apt-get update && \\
    apt-get install -y fluent-bit && \\
    rm -rf /var/lib/apt/lists/*

# Create directories
RUN mkdir -p /fluent-bit/etc /media/lucidlink

# Copy configuration files
COPY config/fluent-bit/fs-audit-trail-opensearch.yaml /fluent-bit/etc/fs-audit-trail.yaml
COPY config/fluent-bit/json-parser.conf /fluent-bit/etc/json-parser.conf

# Set working directory
WORKDIR /fluent-bit

# Command to run Fluent Bit with the correct path
CMD ["/opt/fluent-bit/bin/fluent-bit", "-c", "/fluent-bit/etc/fs-audit-trail.yaml", "-R", "/fluent-bit/etc/json-parser.conf"]
`;

const IMPORTS_NDJSON = `{"attributes":{"fieldFormatMap":"{}","fields":"[]","runtimeFieldMap":"{}","timeFieldName":"@timestamp","title":"audit-trail*","typeMeta":"{}"},"coreMigrationVersion":"2.11.0","id":"audit-trail-index-pattern","migrationVersion":{"index-pattern":"7.6.0"},"references":[],"type":"index-pattern","updated_at":"2024-01-01T00:00:00.000Z","version":"1"}
{"attributes":{"columns":["user.name","operation.action","operation.entryPath","@timestamp"],"description":"Main search for audit trail events","hits":0,"kibanaSavedObjectMeta":{"searchSourceJSON":"{\\"query\\":{\\"query\\":\\"\\",\\"language\\":\\"kuery\\"},\\"filter\\":[],\\"indexRefName\\":\\"kibanaSavedObjectMeta.searchSourceJSON.index\\"}"},"sort":[["@timestamp","desc"]],"title":"Audit Trail Events","version":1},"coreMigrationVersion":"2.11.0","id":"audit-trail-main-search","migrationVersion":{"search":"7.9.3"},"references":[{"id":"audit-trail-index-pattern","name":"kibanaSavedObjectMeta.searchSourceJSON.index","type":"index-pattern"}],"type":"search","updated_at":"2024-01-01T00:00:00.000Z","version":"1"}
{"attributes":{"description":"User activity over time","kibanaSavedObjectMeta":{"searchSourceJSON":"{\\"query\\":{\\"query\\":\\"\\",\\"language\\":\\"kuery\\"},\\"filter\\":[],\\"indexRefName\\":\\"kibanaSavedObjectMeta.searchSourceJSON.index\\"}"},"title":"User Activity Timeline","uiStateJSON":"{}","version":1,"visState":"{\\"title\\":\\"User Activity Timeline\\",\\"type\\":\\"line\\",\\"aggs\\":[{\\"id\\":\\"1\\",\\"enabled\\":true,\\"type\\":\\"count\\",\\"params\\":{},\\"schema\\":\\"metric\\"},{\\"id\\":\\"2\\",\\"enabled\\":true,\\"type\\":\\"date_histogram\\",\\"params\\":{\\"field\\":\\"@timestamp\\",\\"fixed_interval\\":\\"1h\\",\\"scaleMetricValues\\":false,\\"timeRange\\":{\\"from\\":\\"now-24h\\",\\"to\\":\\"now\\"},\\"useNormalizedOpenSearchInterval\\":true,\\"drop_partials\\":false,\\"min_doc_count\\":0,\\"extended_bounds\\":{}},\\"schema\\":\\"segment\\"},{\\"id\\":\\"3\\",\\"enabled\\":true,\\"type\\":\\"terms\\",\\"params\\":{\\"field\\":\\"user.name.keyword\\",\\"orderBy\\":\\"1\\",\\"order\\":\\"desc\\",\\"size\\":10,\\"otherBucket\\":false,\\"otherBucketLabel\\":\\"Other\\",\\"missingBucket\\":false,\\"missingBucketLabel\\":\\"Missing\\"},\\"schema\\":\\"group\\"}],\\"params\\":{\\"type\\":\\"line\\",\\"grid\\":{\\"categoryLines\\":false,\\"valueAxis\\":\\"ValueAxis-1\\"},\\"categoryAxes\\":[{\\"id\\":\\"CategoryAxis-1\\",\\"type\\":\\"category\\",\\"position\\":\\"bottom\\",\\"show\\":true,\\"style\\":{},\\"scale\\":{\\"type\\":\\"linear\\"},\\"labels\\":{\\"show\\":true,\\"filter\\":true,\\"truncate\\":100},\\"title\\":{}}],\\"valueAxes\\":[{\\"id\\":\\"ValueAxis-1\\",\\"name\\":\\"LeftAxis-1\\",\\"type\\":\\"value\\",\\"position\\":\\"left\\",\\"show\\":true,\\"style\\":{},\\"scale\\":{\\"type\\":\\"linear\\",\\"mode\\":\\"normal\\"},\\"labels\\":{\\"show\\":true,\\"rotate\\":0,\\"filter\\":false,\\"truncate\\":100},\\"title\\":{\\"text\\":\\"Event Count\\"}}],\\"seriesParams\\":[{\\"show\\":true,\\"type\\":\\"line\\",\\"mode\\":\\"normal\\",\\"data\\":{\\"label\\":\\"Event Count\\",\\"id\\":\\"1\\"},\\"valueAxis\\":\\"ValueAxis-1\\",\\"drawLinesBetweenPoints\\":true,\\"lineWidth\\":2,\\"showCircles\\":true,\\"interpolate\\":\\"linear\\"}],\\"addTooltip\\":true,\\"addLegend\\":true,\\"legendPosition\\":\\"right\\",\\"times\\":[],\\"addTimeMarker\\":false,\\"thresholdLine\\":{\\"show\\":false,\\"value\\":10,\\"width\\":1,\\"style\\":\\"full\\",\\"color\\":\\"#E7664C\\"},\\"labels\\":{}}}"},"coreMigrationVersion":"2.11.0","id":"user-activity-timeline","migrationVersion":{"visualization":"7.10.0"},"references":[{"id":"audit-trail-index-pattern","name":"kibanaSavedObjectMeta.searchSourceJSON.index","type":"index-pattern"}],"type":"visualization","updated_at":"2024-01-01T00:00:00.000Z","version":"1"}
{"attributes":{"description":"Top users by event count","kibanaSavedObjectMeta":{"searchSourceJSON":"{\\"query\\":{\\"query\\":\\"\\",\\"language\\":\\"kuery\\"},\\"filter\\":[],\\"indexRefName\\":\\"kibanaSavedObjectMeta.searchSourceJSON.index\\"}"},"title":"Top Users","uiStateJSON":"{}","version":1,"visState":"{\\"title\\":\\"Top Users\\",\\"type\\":\\"pie\\",\\"aggs\\":[{\\"id\\":\\"1\\",\\"enabled\\":true,\\"type\\":\\"count\\",\\"params\\":{},\\"schema\\":\\"metric\\"},{\\"id\\":\\"2\\",\\"enabled\\":true,\\"type\\":\\"terms\\",\\"params\\":{\\"field\\":\\"user.name.keyword\\",\\"orderBy\\":\\"1\\",\\"order\\":\\"desc\\",\\"size\\":10,\\"otherBucket\\":true,\\"otherBucketLabel\\":\\"Other\\",\\"missingBucket\\":false,\\"missingBucketLabel\\":\\"Missing\\"},\\"schema\\":\\"segment\\"}],\\"params\\":{\\"type\\":\\"pie\\",\\"addTooltip\\":true,\\"addLegend\\":true,\\"legendPosition\\":\\"right\\",\\"isDonut\\":true,\\"labels\\":{\\"show\\":true,\\"values\\":true,\\"last_level\\":true,\\"truncate\\":100}}}"},"coreMigrationVersion":"2.11.0","id":"top-users-pie","migrationVersion":{"visualization":"7.10.0"},"references":[{"id":"audit-trail-index-pattern","name":"kibanaSavedObjectMeta.searchSourceJSON.index","type":"index-pattern"}],"type":"visualization","updated_at":"2024-01-01T00:00:00.000Z","version":"1"}
{"attributes":{"description":"Distribution of events by type","kibanaSavedObjectMeta":{"searchSourceJSON":"{\\"query\\":{\\"query\\":\\"\\",\\"language\\":\\"kuery\\"},\\"filter\\":[],\\"indexRefName\\":\\"kibanaSavedObjectMeta.searchSourceJSON.index\\"}"},"title":"Event Type Distribution","uiStateJSON":"{}","version":1,"visState":"{\\"title\\":\\"Event Type Distribution\\",\\"type\\":\\"horizontal_bar\\",\\"aggs\\":[{\\"id\\":\\"1\\",\\"enabled\\":true,\\"type\\":\\"count\\",\\"params\\":{},\\"schema\\":\\"metric\\"},{\\"id\\":\\"2\\",\\"enabled\\":true,\\"type\\":\\"terms\\",\\"params\\":{\\"field\\":\\"operation.action.keyword\\",\\"orderBy\\":\\"1\\",\\"order\\":\\"desc\\",\\"size\\":20,\\"otherBucket\\":false,\\"otherBucketLabel\\":\\"Other\\",\\"missingBucket\\":false,\\"missingBucketLabel\\":\\"Missing\\"},\\"schema\\":\\"segment\\"}],\\"params\\":{\\"type\\":\\"histogram\\",\\"grid\\":{\\"categoryLines\\":false,\\"valueAxis\\":\\"ValueAxis-1\\"},\\"categoryAxes\\":[{\\"id\\":\\"CategoryAxis-1\\",\\"type\\":\\"category\\",\\"position\\":\\"left\\",\\"show\\":true,\\"style\\":{},\\"scale\\":{\\"type\\":\\"linear\\"},\\"labels\\":{\\"show\\":true,\\"filter\\":false,\\"truncate\\":200},\\"title\\":{}}],\\"valueAxes\\":[{\\"id\\":\\"ValueAxis-1\\",\\"name\\":\\"BottomAxis-1\\",\\"type\\":\\"value\\",\\"position\\":\\"bottom\\",\\"show\\":true,\\"style\\":{},\\"scale\\":{\\"type\\":\\"linear\\",\\"mode\\":\\"normal\\"},\\"labels\\":{\\"show\\":true,\\"rotate\\":0,\\"filter\\":true,\\"truncate\\":100},\\"title\\":{\\"text\\":\\"Count\\"}}],\\"seriesParams\\":[{\\"show\\":true,\\"type\\":\\"histogram\\",\\"mode\\":\\"normal\\",\\"data\\":{\\"label\\":\\"Count\\",\\"id\\":\\"1\\"},\\"valueAxis\\":\\"ValueAxis-1\\",\\"drawLinesBetweenPoints\\":true,\\"lineWidth\\":2,\\"showCircles\\":true}],\\"addTooltip\\":true,\\"addLegend\\":false,\\"legendPosition\\":\\"right\\",\\"times\\":[],\\"addTimeMarker\\":false,\\"labels\\":{\\"show\\":false},\\"thresholdLine\\":{\\"show\\":false,\\"value\\":10,\\"width\\":1,\\"style\\":\\"full\\",\\"color\\":\\"#E7664C\\"}}}"},"coreMigrationVersion":"2.11.0","id":"event-type-distribution","migrationVersion":{"visualization":"7.10.0"},"references":[{"id":"audit-trail-index-pattern","name":"kibanaSavedObjectMeta.searchSourceJSON.index","type":"index-pattern"}],"type":"visualization","updated_at":"2024-01-01T00:00:00.000Z","version":"1"}
{"attributes":{"description":"File system paths with most activity","kibanaSavedObjectMeta":{"searchSourceJSON":"{\\"query\\":{\\"query\\":\\"\\",\\"language\\":\\"kuery\\"},\\"filter\\":[],\\"indexRefName\\":\\"kibanaSavedObjectMeta.searchSourceJSON.index\\"}"},"title":"Most Active Paths","uiStateJSON":"{}","version":1,"visState":"{\\"title\\":\\"Most Active Paths\\",\\"type\\":\\"table\\",\\"aggs\\":[{\\"id\\":\\"1\\",\\"enabled\\":true,\\"type\\":\\"count\\",\\"params\\":{},\\"schema\\":\\"metric\\"},{\\"id\\":\\"2\\",\\"enabled\\":true,\\"type\\":\\"terms\\",\\"params\\":{\\"field\\":\\"operation.entryPath.keyword\\",\\"orderBy\\":\\"1\\",\\"order\\":\\"desc\\",\\"size\\":25,\\"otherBucket\\":false,\\"otherBucketLabel\\":\\"Other\\",\\"missingBucket\\":false,\\"missingBucketLabel\\":\\"Missing\\"},\\"schema\\":\\"bucket\\"}],\\"params\\":{\\"perPage\\":10,\\"showPartialRows\\":false,\\"showMetricsAtAllLevels\\":false,\\"showTotal\\":false,\\"totalFunc\\":\\"sum\\",\\"percentageCol\\":\\"\\"}}"},"coreMigrationVersion":"2.11.0","id":"most-active-paths","migrationVersion":{"visualization":"7.10.0"},"references":[{"id":"audit-trail-index-pattern","name":"kibanaSavedObjectMeta.searchSourceJSON.index","type":"index-pattern"}],"type":"visualization","updated_at":"2024-01-01T00:00:00.000Z","version":"1"}
{"attributes":{"description":"Main dashboard for LucidLink audit trail monitoring","hits":0,"kibanaSavedObjectMeta":{"searchSourceJSON":"{\\"query\\":{\\"query\\":\\"\\",\\"language\\":\\"kuery\\"},\\"filter\\":[]}"},"optionsJSON":"{\\"useMargins\\":true,\\"syncColors\\":false,\\"syncCursor\\":true,\\"syncTooltips\\":false,\\"hidePanelTitles\\":false}","panelsJSON":"[{\\"version\\":\\"2.11.0\\",\\"gridData\\":{\\"x\\":0,\\"y\\":0,\\"w\\":48,\\"h\\":15,\\"i\\":\\"1\\"},\\"panelIndex\\":\\"1\\",\\"embeddableConfig\\":{\\"enhancements\\":{}},\\"panelRefName\\":\\"panel_1\\"},{\\"version\\":\\"2.11.0\\",\\"gridData\\":{\\"x\\":0,\\"y\\":15,\\"w\\":24,\\"h\\":15,\\"i\\":\\"2\\"},\\"panelIndex\\":\\"2\\",\\"embeddableConfig\\":{\\"enhancements\\":{}},\\"panelRefName\\":\\"panel_2\\"},{\\"version\\":\\"2.11.0\\",\\"gridData\\":{\\"x\\":24,\\"y\\":15,\\"w\\":24,\\"h\\":15,\\"i\\":\\"3\\"},\\"panelIndex\\":\\"3\\",\\"embeddableConfig\\":{\\"enhancements\\":{}},\\"panelRefName\\":\\"panel_3\\"},{\\"version\\":\\"2.11.0\\",\\"gridData\\":{\\"x\\":0,\\"y\\":30,\\"w\\":48,\\"h\\":15,\\"i\\":\\"4\\"},\\"panelIndex\\":\\"4\\",\\"embeddableConfig\\":{\\"enhancements\\":{}},\\"panelRefName\\":\\"panel_4\\"},{\\"version\\":\\"2.11.0\\",\\"gridData\\":{\\"x\\":0,\\"y\\":45,\\"w\\":48,\\"h\\":15,\\"i\\":\\"5\\"},\\"panelIndex\\":\\"5\\",\\"embeddableConfig\\":{\\"enhancements\\":{}},\\"panelRefName\\":\\"panel_5\\"}]","timeFrom":"now-24h","timeRestore":true,"timeTo":"now","title":"LucidLink Audit Trail Dashboard","version":1},"coreMigrationVersion":"2.11.0","id":"lucidlink-audit-trail-dashboard","migrationVersion":{"dashboard":"7.9.3"},"references":[{"id":"user-activity-timeline","name":"panel_1","type":"visualization"},{"id":"top-users-pie","name":"panel_2","type":"visualization"},{"id":"event-type-distribution","name":"panel_3","type":"visualization"},{"id":"most-active-paths","name":"panel_4","type":"visualization"},{"id":"audit-trail-main-search","name":"panel_5","type":"search"}],"type":"dashboard","updated_at":"2024-01-01T00:00:00.000Z","version":"1"}
`;

const IMPORT_SCRIPT = `#!/bin/sh
# Import saved objects to OpenSearch Dashboards

set -e

echo "Waiting for OpenSearch Dashboards to be ready..."

# Wait for OpenSearch Dashboards to be ready
MAX_RETRIES=30
RETRY_COUNT=0

while [ $RETRY_COUNT -lt $MAX_RETRIES ]; do
    if curl -f -s http://opensearch-dashboards:5601/api/status > /dev/null 2>&1; then
        echo "OpenSearch Dashboards is ready!"
        break
    fi
    echo "Waiting for OpenSearch Dashboards... (attempt $((RETRY_COUNT + 1))/$MAX_RETRIES)"
    RETRY_COUNT=$((RETRY_COUNT + 1))
    sleep 10
done

if [ $RETRY_COUNT -eq $MAX_RETRIES ]; then
    echo "OpenSearch Dashboards failed to start within expected time"
    exit 1
fi

# Check if saved objects file exists
if [ ! -f "/usr/share/opensearch-dashboards/saved_objects/imports.ndjson" ]; then
    echo "No saved objects file found, skipping import"
    exit 0
fi

echo "Importing saved objects..."

# Import saved objects
RESPONSE=$(curl -s -X POST \\
    "http://opensearch-dashboards:5601/api/saved_objects/_import?overwrite=true" \\
    -H "osd-xsrf: true" \\
    -H "Content-Type: multipart/form-data" \\
    -F "file=@/usr/share/opensearch-dashboards/saved_objects/imports.ndjson" \\
    2>&1)

# Check if import was successful
if echo "$RESPONSE" | grep -q '"success":true'; then
    echo "Successfully imported saved objects!"
    echo "Response: $RESPONSE"
else
    echo "Failed to import saved objects"
    echo "Response: $RESPONSE"
    exit 1
fi

echo "Import process completed"
`;

// ── Public API ──

export interface StackFiles {
  dir: string;
  files: Array<{ path: string; content: string }>;
}

/**
 * Generate the full set of stack files for the audit trail Docker Compose stack.
 * Returns the directory and file list without writing anything.
 */
export function generateAuditTrailStack(workDir: string): StackFiles {
  return {
    dir: workDir,
    files: [
      { path: "docker-compose.yml", content: DOCKER_COMPOSE },
      { path: "config/opensearch-dashboards/opensearch_dashboards.yml", content: OPENSEARCH_DASHBOARDS_YML },
      { path: "config/fluent-bit/fs-audit-trail-opensearch.yaml", content: FLUENT_BIT_YAML },
      { path: "config/fluent-bit/json-parser.conf", content: JSON_PARSER_CONF },
      { path: "docker/Dockerfile-fluent-bit", content: DOCKERFILE_FLUENT_BIT },
      { path: "dashboards/imports.ndjson", content: IMPORTS_NDJSON },
      { path: "scripts/import-saved-objects-opensearch.sh", content: IMPORT_SCRIPT },
    ],
  };
}

/**
 * Write all stack files to the given directory, creating subdirectories as needed.
 */
export function writeStackFiles(workDir: string): void {
  const stack = generateAuditTrailStack(workDir);
  for (const f of stack.files) {
    const fullPath = join(workDir, f.path);
    const dir = fullPath.substring(0, fullPath.lastIndexOf("/"));
    mkdirSync(dir, { recursive: true });
    writeFileSync(fullPath, f.content, "utf-8");
  }
}
