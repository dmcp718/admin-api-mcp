/**
 * Test helpers — shared utilities for test files.
 */
import { readdirSync, statSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

/** Recursively glob for files matching a pattern (simple *.ext matching) */
export function glob(dir: string, pattern: string): string[] {
  const ext = pattern.replace("**/*", "");
  const results: string[] = [];

  function walk(d: string) {
    for (const entry of readdirSync(d)) {
      const full = join(d, entry);
      const stat = statSync(full);
      if (stat.isDirectory()) {
        if (entry !== "node_modules" && entry !== "dist" && entry !== "build") {
          walk(full);
        }
      } else if (full.endsWith(ext)) {
        results.push(full);
      }
    }
  }

  walk(dir);
  return results.sort();
}

/** Read a file and return its lines (trimmed, no empties) */
export function readLines(filePath: string): string[] {
  return readFileSync(filePath, "utf-8").split("\n").filter((l) => l.trim());
}

/** Parse all tool registrations from a compiled JS server file */
export function parseToolNames(jsContent: string): string[] {
  const names: string[] = [];
  // Match server.tool("name", ...) pattern
  const re = /\.tool\(\s*"([^"]+)"/g;
  let m;
  while ((m = re.exec(jsContent)) !== null) {
    names.push(m[1]);
  }
  return names;
}

/** Parse McpServer constructor name from compiled JS */
export function parseServerName(jsContent: string): string | null {
  const m = jsContent.match(/new McpServer\(\s*\{\s*name:\s*"([^"]+)"/);
  return m ? m[1] : null;
}
