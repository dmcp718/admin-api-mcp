/**
 * Server Import Tests
 *
 * Verifies that each compiled server module can be imported
 * without throwing. This catches ESM/CJS issues, missing
 * dependencies, and top-level execution errors.
 *
 * NOTE: The servers call server.connect() at the top level
 * which tries to read stdin. We import individual modules
 * instead to avoid that side effect.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

describe("Shared module imports (compiled JS)", () => {
  it("imports shared/formatters", async () => {
    const mod = await import("../dist/shared/formatters.js");
    assert.ok(typeof mod.ok === "function");
    assert.ok(typeof mod.err === "function");
    assert.ok(typeof mod.formatSuccess === "function");
    assert.ok(typeof mod.formatError === "function");
  });

  it("imports shared/validators", async () => {
    const mod = await import("../dist/shared/validators.js");
    assert.ok(typeof mod.validateFilespaceName === "function");
    assert.ok(typeof mod.validateEmail === "function");
    assert.ok(typeof mod.validateGroupName === "function");
  });

  it("imports shared/rate-limiter", async () => {
    const mod = await import("../dist/shared/rate-limiter.js");
    assert.ok(typeof mod.RateLimiter === "function");
  });

  it("imports shared/keychain", async () => {
    const mod = await import("../dist/shared/keychain.js");
    assert.ok(typeof mod.getBearerToken === "function");
    assert.ok(typeof mod.storeBearerToken === "function");
  });

  it("imports shared/api-client", async () => {
    const mod = await import("../dist/shared/api-client.js");
    assert.ok(typeof mod.ApiClient === "function");
  });

  it("imports shared/process-manager", async () => {
    const mod = await import("../dist/shared/process-manager.js");
    assert.ok(typeof mod.ensureApiRunning === "function");
    assert.ok(typeof mod.isApiRunning === "function");
    assert.ok(typeof mod.getApiLogs === "function");
  });

  it("imports shared/brand-resource", async () => {
    const mod = await import("../dist/shared/brand-resource.js");
    assert.ok(typeof mod.registerBrandResource === "function");
  });

  it("imports shared/capabilities-resource", async () => {
    const mod = await import("../dist/shared/capabilities-resource.js");
    assert.ok(typeof mod.registerCapabilitiesResource === "function");
  });

  it("imports connect/workflow-tools", async () => {
    const mod = await import("../dist/connect/workflow-tools.js");
    assert.ok(typeof mod.ensureFolderPath === "function");
    assert.ok(typeof mod.importS3Object === "function");
    assert.ok(typeof mod.bulkImportS3Objects === "function");
  });

  it("imports connect/ui-template", async () => {
    const mod = await import("../dist/connect/ui-template.js");
    assert.ok(typeof mod.generateConnectUI === "function");
  });

  it("imports connect/browser-template", async () => {
    const mod = await import("../dist/connect/browser-template.js");
    assert.ok(typeof mod.generateFilespacesBrowser === "function");
  });
});
