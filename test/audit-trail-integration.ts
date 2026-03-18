/**
 * Integration test for audit trail MCP server components.
 *
 * Tests: DockerManager, OpenSearchClient, and all tool logic.
 * Requires: Docker running, LucidLink filespace mounted.
 *
 * Usage: npx tsx test/audit-trail-integration.ts
 */

import { join } from "node:path";
import { existsSync } from "node:fs";
import { DockerManager, checkDocker } from "../src/audit-trail/docker-manager.js";
import { writeStackFiles } from "../src/audit-trail/stack-template.js";
import { OpenSearchClient } from "../src/audit-trail/opensearch-client.js";
import { AUDIT_TRAIL_INDEX, VALID_ACTIONS } from "../src/audit-trail/types.js";
import type { AuditEvent, SearchHit } from "../src/audit-trail/types.js";

const HOME = process.env.HOME ?? "";
const WORK_DIR = join(HOME, ".lucidlink", "audit-trail");
const FSMOUNTPOINT = "/Volumes/nab";
const OS_URL = "http://localhost:9200";

let passed = 0;
let failed = 0;
const errors: string[] = [];

function assert(condition: boolean, name: string, detail?: string) {
  if (condition) {
    console.log(`  \x1b[32m✔\x1b[0m ${name}`);
    passed++;
  } else {
    console.log(`  \x1b[31m✘\x1b[0m ${name}${detail ? ": " + detail : ""}`);
    failed++;
    errors.push(name + (detail ? ": " + detail : ""));
  }
}

async function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

// ── Test Groups ──

async function testPrerequisites() {
  console.log("\n▶ Prerequisites");

  assert(existsSync(FSMOUNTPOINT), "Filespace mount exists");
  assert(
    existsSync(FSMOUNTPOINT + "/.lucid_audit"),
    "Audit log directory exists",
  );

  // Generate stack files from template
  writeStackFiles(WORK_DIR);
  assert(
    existsSync(join(WORK_DIR, "docker-compose.yml")),
    "Stack files generated",
  );

  const dockerResult = await checkDocker();
  assert(dockerResult.success, "Docker is running", dockerResult.error);
}

async function testDockerManager() {
  console.log("\n▶ DockerManager");

  const docker = new DockerManager(WORK_DIR);

  assert(docker.hasComposeFile(), "Compose file detected");

  // Configure .env
  docker.configureEnv(FSMOUNTPOINT);
  assert(existsSync(docker.envFile), ".env file created");

  // Read .env to verify
  const { readFileSync } = await import("node:fs");
  const envContent = readFileSync(docker.envFile, "utf-8");
  assert(
    envContent.includes(`FSMOUNTPOINT=${FSMOUNTPOINT}`),
    "FSMOUNTPOINT set in .env",
  );

  // Start stack
  console.log("  … starting docker compose (this may take 1-2 minutes)");
  const upResult = await docker.up();
  assert(upResult.success, "docker compose up", upResult.error);

  // PS
  const psResult = await docker.ps();
  assert(psResult.success, "docker compose ps", psResult.error);
  if (psResult.output) {
    const lines = psResult.output.trim().split("\n");
    assert(lines.length >= 2, `At least 2 containers running (got ${lines.length})`);
  }

  // Logs
  const logsResult = await docker.logs(undefined, 10);
  assert(logsResult.success, "docker compose logs", logsResult.error);
}

async function testOpenSearchHealth() {
  console.log("\n▶ OpenSearch health (waiting for cluster)");

  const client = new OpenSearchClient(OS_URL);

  // Wait for OpenSearch to be healthy (up to 120s)
  let healthy = false;
  for (let i = 0; i < 60; i++) {
    const resp = await client.clusterHealth();
    if (resp.success) {
      healthy = true;
      const data = resp.data as { status: string; number_of_nodes: number };
      assert(true, `Cluster health: ${data.status} (${data.number_of_nodes} node(s))`);
      break;
    }
    if (i % 10 === 0 && i > 0) console.log(`    … still waiting (${i * 2}s)`);
    await sleep(2000);
  }
  assert(healthy, "OpenSearch became healthy within 120s");
}

async function testSampleDataLoad() {
  console.log("\n▶ Load sample data");

  const client = new OpenSearchClient(OS_URL);

  // Generate 200 sample events
  const users = ["alice.smith", "bob.jones", "carol.chen", "dave.wilson", "eve.davis"];
  const actions = ["FileRead", "FileWritten", "FileCreate", "FileDelete", "DirectoryCreate", "Move"];
  const basePaths = ["/Projects/design", "/Projects/video", "/Documents/reports", "/Shared/assets"];
  const extensions = [".psd", ".mov", ".pdf", ".jpg", ".png"];
  const devices = ["alice-macbook", "bob-workstation", "carol-laptop", "dave-desktop", "eve-macbook"];

  const now = Date.now();
  const msPerDay = 86_400_000;
  let ndjson = "";
  const numEvents = 200;

  for (let i = 0; i < numEvents; i++) {
    const userIdx = i % users.length;
    const ts = new Date(now - Math.random() * 7 * msPerDay).toISOString();
    const actionType = actions[Math.floor(Math.random() * actions.length)];
    const basePath = basePaths[Math.floor(Math.random() * basePaths.length)];
    const ext = extensions[Math.floor(Math.random() * extensions.length)];
    const filename = `file-${String(i).padStart(4, "0")}${ext}`;

    const event: AuditEvent = {
      "@timestamp": ts,
      user: { name: users[userIdx], id: `${users[userIdx]}@company.com` },
      device: { hostName: devices[userIdx], osName: "macOS", osVersion: "14.2.0" },
      event: { filespace: "nab.lucid-demo" },
      operation: { action: actionType, entryPath: `${basePath}/${filename}`, file: filename },
    };

    ndjson += JSON.stringify({ index: { _index: AUDIT_TRAIL_INDEX } }) + "\n";
    ndjson += JSON.stringify(event) + "\n";
  }

  const bulkResp = await client.bulk(ndjson);
  assert(bulkResp.success, `Bulk indexed ${numEvents} events`, bulkResp.error);

  // Wait for indexing
  await sleep(1500);

  // Verify count
  const countResp = await client.count(undefined);
  assert(countResp.success, "Count query succeeded", countResp.error);
  if (countResp.data) {
    const count = (countResp.data as { count: number }).count;
    assert(count >= numEvents, `Index has ${count} docs (expected >= ${numEvents})`);
  }
}

async function testSearchQueries() {
  console.log("\n▶ Search queries");

  const client = new OpenSearchClient(OS_URL);

  // 1. Match all
  const allResp = await client.search(
    { query: { match_all: {} }, sort: [{ "@timestamp": { order: "desc" } }] },
    AUDIT_TRAIL_INDEX,
    10,
  );
  assert(allResp.success, "match_all search", allResp.error);
  if (allResp.data) {
    const hits = (allResp.data as any).hits.hits;
    assert(hits.length > 0, `Got ${hits.length} results from match_all`);
    // Verify event structure
    const first = hits[0]._source as AuditEvent;
    assert(!!first["@timestamp"], "Event has @timestamp");
    assert(!!first.user?.name, "Event has user.name");
    assert(!!first.operation?.action, "Event has operation.action");
    assert(!!first.operation?.entryPath, "Event has operation.entryPath");
  }

  // 2. Filter by user
  const userResp = await client.search(
    { query: { term: { "user.name.keyword": "alice.smith" } } },
    AUDIT_TRAIL_INDEX,
    10,
  );
  assert(userResp.success, "User filter search", userResp.error);
  if (userResp.data) {
    const hits = (userResp.data as any).hits.hits;
    assert(hits.length > 0, `Got ${hits.length} results for alice.smith`);
    if (hits.length > 0) {
      assert(
        hits[0]._source.user.name === "alice.smith",
        "Filtered result has correct user",
      );
    }
  }

  // 3. Filter by action
  const actionResp = await client.search(
    { query: { term: { "operation.action.keyword": "FileDelete" } } },
    AUDIT_TRAIL_INDEX,
    10,
  );
  assert(actionResp.success, "Action filter search", actionResp.error);
  if (actionResp.data) {
    const total = (actionResp.data as any).hits.total.value;
    assert(total >= 0, `Got ${total} FileDelete events`);
  }

  // 4. Path prefix search
  const pathResp = await client.search(
    { query: { prefix: { "operation.entryPath.keyword": "/Projects/" } } },
    AUDIT_TRAIL_INDEX,
    10,
  );
  assert(pathResp.success, "Path prefix search", pathResp.error);
  if (pathResp.data) {
    const total = (pathResp.data as any).hits.total.value;
    assert(total > 0, `Got ${total} events under /Projects/`);
  }

  // 5. Time range search
  const timeResp = await client.search(
    { query: { range: { "@timestamp": { gte: "now-7d" } } } },
    AUDIT_TRAIL_INDEX,
    10,
  );
  assert(timeResp.success, "Time range search", timeResp.error);

  // 6. Multi-match (full-text)
  const ftResp = await client.search(
    { query: { multi_match: { query: "design", fields: ["operation.entryPath", "operation.file"] } } },
    AUDIT_TRAIL_INDEX,
    10,
  );
  assert(ftResp.success, "Full-text multi_match search", ftResp.error);

  // 7. Bool combination
  const boolResp = await client.search(
    {
      query: {
        bool: {
          must: [
            { term: { "user.name.keyword": "bob.jones" } },
            { prefix: { "operation.entryPath.keyword": "/Projects/" } },
          ],
        },
      },
    },
    AUDIT_TRAIL_INDEX,
    10,
  );
  assert(boolResp.success, "Bool combined query", boolResp.error);
}

async function testAggregations() {
  console.log("\n▶ Aggregations");

  const client = new OpenSearchClient(OS_URL);

  // By user
  const userAgg = await client.search(
    {
      size: 0,
      aggs: { by_user: { terms: { field: "user.name.keyword", size: 10 } } },
    },
  );
  assert(userAgg.success, "Aggregation by user", userAgg.error);
  if (userAgg.data) {
    const buckets = (userAgg.data as any).aggregations.by_user.buckets;
    assert(buckets.length > 0, `Got ${buckets.length} user buckets`);
    console.log(`    Users: ${buckets.map((b: any) => `${b.key}(${b.doc_count})`).join(", ")}`);
  }

  // By action
  const actionAgg = await client.search(
    {
      size: 0,
      aggs: { by_action: { terms: { field: "operation.action.keyword" } } },
    },
  );
  assert(actionAgg.success, "Aggregation by action", actionAgg.error);
  if (actionAgg.data) {
    const buckets = (actionAgg.data as any).aggregations.by_action.buckets;
    assert(buckets.length > 0, `Got ${buckets.length} action buckets`);
    console.log(`    Actions: ${buckets.map((b: any) => `${b.key}(${b.doc_count})`).join(", ")}`);
  }

  // Date histogram
  const timeAgg = await client.search(
    {
      size: 0,
      query: { range: { "@timestamp": { gte: "now-7d" } } },
      aggs: {
        over_time: { date_histogram: { field: "@timestamp", fixed_interval: "1d" } },
      },
    },
  );
  assert(timeAgg.success, "Date histogram aggregation", timeAgg.error);
  if (timeAgg.data) {
    const buckets = (timeAgg.data as any).aggregations.over_time.buckets;
    assert(buckets.length > 0, `Got ${buckets.length} time buckets`);
  }

  // By path
  const pathAgg = await client.search(
    {
      size: 0,
      aggs: { by_path: { terms: { field: "operation.entryPath.keyword", size: 10 } } },
    },
  );
  assert(pathAgg.success, "Aggregation by path", pathAgg.error);
}

async function testGetMapping() {
  console.log("\n▶ Index mapping");

  const client = new OpenSearchClient(OS_URL);

  const resp = await client.getMapping();
  assert(resp.success, "Get mapping", resp.error);
  if (resp.data) {
    const mapping = resp.data as Record<string, any>;
    const indexMapping = mapping[AUDIT_TRAIL_INDEX];
    assert(!!indexMapping, "audit-trail index found in mapping");
    assert(!!indexMapping?.mappings?.properties, "Mapping has properties");
    const props = indexMapping.mappings.properties;
    assert(!!props["@timestamp"], "Has @timestamp field");
    assert(!!props.user, "Has user field");
    assert(!!props.operation, "Has operation field");
  }
}

async function testIndexStats() {
  console.log("\n▶ Index stats");

  const client = new OpenSearchClient(OS_URL);

  const resp = await client.indexStats();
  assert(resp.success, "Get index stats", resp.error);
  if (resp.data) {
    const indices = (resp.data as any).indices;
    assert(!!indices[AUDIT_TRAIL_INDEX], "audit-trail index in stats");
    const primary = indices[AUDIT_TRAIL_INDEX].primaries;
    assert(primary.docs.count > 0, `Index has ${primary.docs.count} docs`);
    const sizeBytes = primary.store.size_in_bytes;
    const sizeMB = (sizeBytes / 1024 / 1024).toFixed(2);
    console.log(`    Index size: ${sizeMB} MB, docs: ${primary.docs.count}`);
  }
}

async function testAlerting() {
  console.log("\n▶ Alerting");

  const client = new OpenSearchClient(OS_URL);

  // Create a test monitor
  const createResp = await client.createMonitor({
    name: "Test Deletion Alert",
    type: "monitor",
    enabled: true,
    schedule: { period: { interval: 5, unit: "MINUTES" } },
    inputs: [
      {
        search: {
          indices: [AUDIT_TRAIL_INDEX],
          query: {
            size: 0,
            query: {
              bool: {
                must: [
                  { term: { "operation.action.keyword": "FileDelete" } },
                  { range: { "@timestamp": { gte: "now-5m" } } },
                ],
              },
            },
          },
        },
      },
    ],
    triggers: [
      {
        query_level_trigger: {
          name: "Test trigger",
          severity: "2",
          condition: {
            script: { source: "ctx.results[0].hits.total.value > 0", lang: "painless" },
          },
          actions: [],
        },
      },
    ],
  });
  assert(createResp.success, "Create monitor", createResp.error);

  let monitorId: string | undefined;
  if (createResp.data) {
    monitorId = (createResp.data as any)._id;
    assert(!!monitorId, `Monitor created with ID: ${monitorId}`);
  }

  // List monitors
  const listResp = await client.listMonitors();
  assert(listResp.success, "List monitors", listResp.error);
  if (listResp.data) {
    const hits = (listResp.data as any).hits.hits;
    assert(hits.length > 0, `Found ${hits.length} monitor(s)`);
  }

  // Delete the test monitor
  if (monitorId) {
    const deleteResp = await client.deleteMonitor(monitorId);
    assert(deleteResp.success, "Delete monitor", deleteResp.error);
  }

  // Verify it's gone
  const listAfter = await client.listMonitors();
  if (listAfter.success && listAfter.data) {
    const remaining = (listAfter.data as any).hits.hits.filter(
      (h: any) => h._id === monitorId,
    );
    assert(remaining.length === 0, "Monitor deleted successfully");
  }
}

async function testUserActivity() {
  console.log("\n▶ User activity query pattern");

  const client = new OpenSearchClient(OS_URL);

  // Simulates get_user_activity tool
  const resp = await client.search(
    {
      query: {
        bool: {
          must: [
            { term: { "user.name.keyword": "alice.smith" } },
            { range: { "@timestamp": { gte: "now-7d" } } },
          ],
        },
      },
      sort: [{ "@timestamp": { order: "desc" } }],
      aggs: {
        by_action: { terms: { field: "operation.action.keyword" } },
        by_device: { terms: { field: "device.hostName.keyword", size: 10 } },
      },
    },
    AUDIT_TRAIL_INDEX,
    20,
  );
  assert(resp.success, "User activity query", resp.error);
  if (resp.data) {
    const data = resp.data as any;
    const total = data.hits.total.value;
    assert(total > 0, `alice.smith has ${total} events`);
    const actions = data.aggregations.by_action.buckets;
    console.log(`    Actions: ${actions.map((a: any) => `${a.key}(${a.doc_count})`).join(", ")}`);
    const devices = data.aggregations.by_device.buckets;
    console.log(`    Devices: ${devices.map((d: any) => d.key).join(", ")}`);
  }
}

async function testFileHistory() {
  console.log("\n▶ File history query pattern");

  const client = new OpenSearchClient(OS_URL);

  // Simulates get_file_history tool with prefix match
  const resp = await client.search(
    {
      query: {
        bool: {
          must: [
            { prefix: { "operation.entryPath.keyword": "/Projects/design/" } },
            { range: { "@timestamp": { gte: "now-30d" } } },
          ],
        },
      },
      sort: [{ "@timestamp": { order: "desc" } }],
      aggs: {
        by_user: { terms: { field: "user.name.keyword", size: 20 } },
        by_action: { terms: { field: "operation.action.keyword" } },
      },
    },
    AUDIT_TRAIL_INDEX,
    20,
  );
  assert(resp.success, "File history query", resp.error);
  if (resp.data) {
    const data = resp.data as any;
    const total = data.hits.total.value;
    assert(total > 0, `${total} events on /Projects/design/`);
    const users = data.aggregations.by_user.buckets;
    console.log(`    Users: ${users.map((u: any) => `${u.key}(${u.doc_count})`).join(", ")}`);
  }
}

async function testCount() {
  console.log("\n▶ Count queries");

  const client = new OpenSearchClient(OS_URL);

  // Total count
  const totalResp = await client.count(undefined);
  assert(totalResp.success, "Total count", totalResp.error);
  if (totalResp.data) {
    console.log(`    Total events: ${(totalResp.data as any).count}`);
  }

  // Filtered count
  const filteredResp = await client.count({ term: { "operation.action.keyword": "FileDelete" } });
  assert(filteredResp.success, "Filtered count (FileDelete)", filteredResp.error);
  if (filteredResp.data) {
    console.log(`    FileDelete events: ${(filteredResp.data as any).count}`);
  }
}

async function testCleanup() {
  console.log("\n▶ Cleanup (stopping stack)");

  const docker = new DockerManager(WORK_DIR);
  const result = await docker.down(true); // remove volumes to clean up test data
  assert(result.success, "docker compose down -v", result.error);
}

// ── Runner ──

async function main() {
  console.log("═══════════════════════════════════════════════════");
  console.log("  Audit Trail MCP Server — Integration Tests");
  console.log("═══════════════════════════════════════════════════");
  console.log(`  Stack:   ${WORK_DIR}`);
  console.log(`  Mount:   ${FSMOUNTPOINT}`);
  console.log(`  OpenSearch: ${OS_URL}`);

  const startTime = Date.now();

  try {
    await testPrerequisites();
    await testDockerManager();
    await testOpenSearchHealth();
    await testSampleDataLoad();
    await testSearchQueries();
    await testAggregations();
    await testGetMapping();
    await testIndexStats();
    await testCount();
    await testUserActivity();
    await testFileHistory();
    await testAlerting();
    await testCleanup();
  } catch (e) {
    console.error(`\n\x1b[31mFATAL:\x1b[0m ${e}`);
    failed++;
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log("\n═══════════════════════════════════════════════════");
  console.log(`  \x1b[32m✔ ${passed} passed\x1b[0m  \x1b[31m✘ ${failed} failed\x1b[0m  (${elapsed}s)`);
  if (errors.length > 0) {
    console.log("\n  Failures:");
    for (const e of errors) {
      console.log(`    \x1b[31m✘\x1b[0m ${e}`);
    }
  }
  console.log("═══════════════════════════════════════════════════");

  process.exit(failed > 0 ? 1 : 0);
}

main();
