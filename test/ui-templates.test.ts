/**
 * UI Template Tests
 *
 * Validates that generated UI projects:
 * - Produce all required files
 * - Use correct fonts (Inter, not Aeonik)
 * - Use dark theme colors
 * - Include functional server code
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { generateConnectUI } from "../dist/connect/ui-template.js";
import { generateFilespacesBrowser } from "../dist/connect/browser-template.js";

describe("Connect UI template", () => {
  const project = generateConnectUI("test-fs-id", "test-ds-id");

  it("returns files object", () => {
    assert.ok(project.files, "Should return files");
    assert.ok(Object.keys(project.files).length > 0, "Should have at least one file");
  });

  it("includes server.js", () => {
    assert.ok("server.js" in project.files, "Should include server.js");
  });

  it("includes package.json", () => {
    assert.ok("package.json" in project.files, "Should include package.json");
    const pkg = JSON.parse(project.files["package.json"]);
    assert.ok(pkg.dependencies, "package.json should have dependencies");
  });

  it("uses Inter font family (not Aeonik)", () => {
    const allContent = Object.values(project.files).join("\n");
    assert.ok(!allContent.includes("Aeonik"), "Should not reference Aeonik");
    assert.ok(allContent.includes("Inter"), "Should use Inter font");
  });

  it("uses a dark theme background color", () => {
    const allContent = Object.values(project.files).join("\n");
    // Accept brand charcoal (#151519) or the template's dark (#0f1419)
    const hasDarkBg = allContent.includes("#151519") || allContent.includes("#0f1419");
    assert.ok(hasDarkBg, "Should use a dark background color (#151519 or #0f1419)");
  });

  it("pre-fills filespace and data store IDs", () => {
    const allContent = Object.values(project.files).join("\n");
    assert.ok(allContent.includes("test-fs-id"), "Should pre-fill filespace ID");
    assert.ok(allContent.includes("test-ds-id"), "Should pre-fill data store ID");
  });
});

describe("Filespace browser template", () => {
  const project = generateFilespacesBrowser(3099);

  it("returns files object", () => {
    assert.ok(project.files, "Should return files");
    assert.ok(Object.keys(project.files).length > 0, "Should have at least one file");
  });

  it("includes server.js", () => {
    assert.ok("server.js" in project.files, "Should include server.js");
  });

  it("includes package.json", () => {
    assert.ok("package.json" in project.files, "Should include package.json");
  });

  it("uses Inter font family (not Aeonik)", () => {
    const allContent = Object.values(project.files).join("\n");
    assert.ok(!allContent.includes("Aeonik"), "Should not reference Aeonik");
  });

  it("uses configured port", () => {
    const serverJs = project.files["server.js"];
    assert.ok(serverJs.includes("3099"), "Should use configured port");
  });
});
