/**
 * Brand Resource Tests
 *
 * Ensures brand guidelines are consistent and don't reference
 * fonts/tools that aren't available in web contexts.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { glob } from "./helpers.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(__dirname, "..", "src");

describe("Brand resource content", () => {
  const brandFile = resolve(srcDir, "shared", "brand-resource.ts");
  const content = readFileSync(brandFile, "utf-8");

  it("specifies Inter as heading font", () => {
    assert.ok(content.includes("Inter"), "Brand resource should reference Inter font");
  });

  it("specifies IBM Plex Mono as monospace font", () => {
    assert.ok(content.includes("IBM Plex Mono"), "Brand resource should reference IBM Plex Mono");
  });

  it("does NOT reference Aeonik", () => {
    assert.ok(!content.includes("Aeonik"),
      "Brand resource must not reference Aeonik (not available via CDN)");
  });

  it("does NOT reference DM Sans", () => {
    assert.ok(!content.includes("DM Sans"),
      "Brand resource must not reference DM Sans");
  });

  it("specifies dark theme colors", () => {
    assert.ok(content.includes("#151519"), "Should include charcoal background");
    assert.ok(content.includes("#B0FB15"), "Should include neon accent");
  });

  it("includes Google Fonts URL for Inter", () => {
    assert.ok(content.includes("fonts.googleapis.com"),
      "Should include Google Fonts URL for web loading");
  });
});

describe("Capabilities resource content", () => {
  const capFile = resolve(srcDir, "shared", "capabilities-resource.ts");
  const content = readFileSync(capFile, "utf-8");

  it("lists all 4 servers", () => {
    assert.ok(content.includes("lucidlink-api"));
    assert.ok(content.includes("lucidlink-connect-api"));
    assert.ok(content.includes("lucidlink-filespace-search"));
    assert.ok(content.includes("lucidlink-filespace-browser"));
  });

  it("only references Aeonik in a 'never use' context", () => {
    if (content.includes("Aeonik")) {
      // Must appear only in a "Never use" / "Do not use" line
      const lines = content.split("\n").filter((l) => l.includes("Aeonik"));
      for (const line of lines) {
        assert.ok(
          /never|Never|NEVER|do not|Do not|DO NOT/i.test(line),
          `Capabilities guide references Aeonik outside a 'never use' context: ${line.trim()}`,
        );
      }
    }
  });

  it("only references FastAPI in a 'never use' context", () => {
    if (content.includes("FastAPI")) {
      const lines = content.split("\n").filter((l) => l.includes("FastAPI"));
      for (const line of lines) {
        assert.ok(
          /never|Never|NEVER|do not|Do not|DO NOT/i.test(line),
          `Capabilities guide references FastAPI outside a 'never use' context: ${line.trim()}`,
        );
      }
    }
  });

  it("warns against building UIs manually", () => {
    assert.ok(content.includes("Do NOT build"),
      "Should warn against manual UI building");
  });

  it("warns against rewriting Go binary", () => {
    assert.ok(content.includes("NEVER rewrite"),
      "Should warn against rewriting fs-index-server");
  });
});

describe("No forbidden fonts in any source file", () => {
  const allFiles = glob(srcDir, "**/*.ts");

  for (const file of allFiles) {
    const relPath = file.replace(srcDir + "/", "");
    const content = readFileSync(file, "utf-8");

    it(`${relPath}: no Aeonik references`, () => {
      // Allow the word in comments that say "never use Aeonik"
      const lines = content.split("\n");
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (line.includes("Aeonik") && !line.includes("Never") && !line.includes("never") && !line.includes("NEVER") && !line.includes("Do not") && !line.includes("do not")) {
          assert.fail(`${relPath}:${i + 1} references Aeonik font: ${line.trim()}`);
        }
      }
    });
  }
});
