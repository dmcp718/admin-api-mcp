/**
 * Server Registration Tests
 *
 * Validates that all MCP servers:
 * - Have unique tool names (no collisions across servers)
 * - Set instructions in server options
 * - Register brand and capabilities resources
 * - Have proper tool descriptions (not empty)
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(__dirname, "..", "src");

const SERVER_FILES = [
  "lucid-api-server.ts",
  "connect-server.ts",
  "search-server.ts",
  "browser-server.ts",
];

function readServer(name: string): string {
  return readFileSync(resolve(srcDir, name), "utf-8");
}

function extractToolNames(content: string): string[] {
  const names: string[] = [];
  const re = /server\.tool\(\s*\n?\s*"([^"]+)"/g;
  let m;
  while ((m = re.exec(content)) !== null) {
    names.push(m[1]);
  }
  return names;
}

describe("Server tool registration", () => {
  const allTools = new Map<string, string[]>(); // toolName -> [serverFiles]

  for (const file of SERVER_FILES) {
    const content = readServer(file);
    const tools = extractToolNames(content);

    it(`${file}: registers at least one tool`, () => {
      assert.ok(tools.length > 0, `${file} has no tools registered`);
    });

    it(`${file}: has no duplicate tool names within the server`, () => {
      const seen = new Set<string>();
      const dupes: string[] = [];
      for (const t of tools) {
        if (seen.has(t)) dupes.push(t);
        seen.add(t);
      }
      assert.equal(dupes.length, 0, `Duplicate tools in ${file}: ${dupes.join(", ")}`);
    });

    // Track for cross-server check
    for (const t of tools) {
      if (!allTools.has(t)) allTools.set(t, []);
      allTools.get(t)!.push(file);
    }
  }

  it("no duplicate tool names across servers", () => {
    const dupes: string[] = [];
    for (const [name, files] of allTools) {
      if (files.length > 1) {
        dupes.push(`"${name}" in: ${files.join(", ")}`);
      }
    }
    assert.equal(dupes.length, 0,
      `Duplicate tool names across servers:\n${dupes.join("\n")}`);
  });
});

describe("Server instructions", () => {
  for (const file of SERVER_FILES) {
    it(`${file}: passes instructions in McpServer options`, () => {
      const content = readServer(file);
      // Match the two-arg constructor: new McpServer({...}, { instructions: ... })
      assert.ok(
        content.includes("instructions:") || content.includes("instructions :"),
        `${file} does not set instructions in McpServer options`,
      );
    });
  }
});

describe("Server resources", () => {
  for (const file of SERVER_FILES) {
    const content = readServer(file);

    it(`${file}: registers brand resource`, () => {
      assert.ok(
        content.includes("registerBrandResource"),
        `${file} does not register brand resource`,
      );
    });

    it(`${file}: registers capabilities resource`, () => {
      assert.ok(
        content.includes("registerCapabilitiesResource"),
        `${file} does not register capabilities resource`,
      );
    });
  }
});

describe("Tool descriptions", () => {
  for (const file of SERVER_FILES) {
    const content = readServer(file);
    // Extract tool name + description pairs
    const re = /server\.tool\(\s*\n?\s*"([^"]+)",\s*\n?\s*"([^"]+)"/g;
    let m;
    while ((m = re.exec(content)) !== null) {
      const [, name, desc] = m;

      it(`${file} > ${name}: description is not empty`, () => {
        assert.ok(desc.trim().length > 10,
          `Tool "${name}" has a too-short description: "${desc}"`);
      });
    }
  }
});
