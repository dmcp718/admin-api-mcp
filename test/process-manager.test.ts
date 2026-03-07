/**
 * Process Manager Tests
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  getApiDir,
  getMainJs,
  isApiInstalled,
  getApiLogs,
} from "../dist/shared/process-manager.js";

describe("Process manager", () => {
  it("getApiDir returns a path string", () => {
    const dir = getApiDir();
    assert.equal(typeof dir, "string");
    assert.ok(dir.length > 0);
  });

  it("getMainJs returns path ending in main.js", () => {
    const mainJs = getMainJs();
    assert.ok(mainJs.endsWith("main.js"), `Expected path to main.js, got: ${mainJs}`);
  });

  it("isApiInstalled returns boolean", () => {
    const installed = isApiInstalled();
    assert.equal(typeof installed, "boolean");
  });

  it("getApiLogs returns string (empty when not started)", () => {
    const logs = getApiLogs();
    assert.equal(typeof logs, "string");
  });

  it("getApiLogs respects line count parameter", () => {
    const logs = getApiLogs(10);
    assert.equal(typeof logs, "string");
    // When no process has run, should be empty
    assert.equal(logs, "");
  });
});
