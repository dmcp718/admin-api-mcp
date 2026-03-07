/**
 * ESM Compliance Tests
 *
 * Catches CJS-only patterns (require(), __dirname, __filename)
 * that will fail at runtime in ESM modules.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { glob } from "./helpers.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(__dirname, "..", "src");

describe("ESM compliance", () => {
  const tsFiles = glob(srcDir, "**/*.ts");

  it("should find source files to test", () => {
    assert.ok(tsFiles.length > 0, "No .ts files found in src/");
  });

  for (const file of tsFiles) {
    const relPath = file.replace(srcDir + "/", "");

    it(`${relPath}: no bare require() calls`, () => {
      const content = readFileSync(file, "utf-8");
      // Match require("...") or require('...') but not inside comments or strings describing require
      const lines = content.split("\n");
      const violations: string[] = [];
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const trimmed = line.trim();
        // Skip comments
        if (trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*")) continue;
        // Match actual require() calls (not `await import()` or string mentions)
        if (/\brequire\s*\(/.test(line) && !/"[^"]*require[^"]*"/.test(line) && !/'[^']*require[^']*'/.test(line)) {
          violations.push(`  line ${i + 1}: ${trimmed}`);
        }
      }
      assert.equal(violations.length, 0,
        `Found require() calls in ${relPath} (CJS not available in ESM):\n${violations.join("\n")}`);
    });

    it(`${relPath}: no bare __dirname usage without import.meta.url`, () => {
      const content = readFileSync(file, "utf-8");
      // If file uses __dirname, it should define it from import.meta.url
      if (content.includes("__dirname") && !content.includes("import.meta.url")) {
        assert.fail(
          `${relPath} uses __dirname but doesn't derive it from import.meta.url. ` +
          `In ESM, use: const __dirname = dirname(fileURLToPath(import.meta.url))`
        );
      }
    });

    it(`${relPath}: no bare __filename usage without import.meta.url`, () => {
      const content = readFileSync(file, "utf-8");
      if (content.includes("__filename") && !content.includes("import.meta.url")) {
        assert.fail(
          `${relPath} uses __filename but doesn't derive it from import.meta.url. ` +
          `In ESM, use: const __filename = fileURLToPath(import.meta.url)`
        );
      }
    });
  }
});
