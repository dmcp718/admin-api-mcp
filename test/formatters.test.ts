/**
 * Formatter & Tool Result Tests
 *
 * Validates that ok() and err() return MCP-compliant CallToolResult shapes.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { formatSuccess, formatError, ok, err } from "../dist/shared/formatters.js";

describe("formatSuccess", () => {
  it("includes operation name", () => {
    const msg = formatSuccess("Create Filespace", { id: "123" });
    assert.ok(msg.includes("Create Filespace"));
  });

  it("includes JSON details", () => {
    const msg = formatSuccess("Test", { key: "value" });
    assert.ok(msg.includes('"key"'));
    assert.ok(msg.includes('"value"'));
  });

  it("handles empty details", () => {
    const msg = formatSuccess("Test", {});
    assert.ok(msg.includes("Test"));
  });
});

describe("formatError", () => {
  it("includes operation name", () => {
    const msg = formatError("Delete Filespace", "not found");
    assert.ok(msg.includes("Delete Filespace"));
  });

  it("translates 401 errors", () => {
    const msg = formatError("Test", "HTTP 401 error");
    assert.ok(msg.includes("token"), "Should mention token for 401");
  });

  it("translates 409 errors", () => {
    const msg = formatError("Test", "409 conflict");
    assert.ok(msg.includes("already exists"));
  });

  it("passes through unknown errors", () => {
    const msg = formatError("Test", "something weird happened");
    assert.ok(msg.includes("something weird happened"));
  });
});

describe("ok() helper", () => {
  it("returns correct MCP CallToolResult shape", () => {
    const result = ok("hello");
    assert.ok(Array.isArray(result.content));
    assert.equal(result.content.length, 1);
    assert.equal(result.content[0].type, "text");
    assert.equal(result.content[0].text, "hello");
  });

  it("does not set isError", () => {
    const result = ok("test");
    assert.equal(result.isError, undefined);
  });

  it("has string index signature (required by MCP SDK)", () => {
    const result = ok("test");
    // Verify it's a plain object that can be indexed by string
    assert.equal(typeof result, "object");
    assert.ok("content" in result);
  });
});

describe("err() helper", () => {
  it("returns correct MCP CallToolResult shape", () => {
    const result = err("failure");
    assert.ok(Array.isArray(result.content));
    assert.equal(result.content.length, 1);
    assert.equal(result.content[0].type, "text");
    assert.equal(result.content[0].text, "failure");
  });

  it("sets isError to true", () => {
    const result = err("failure");
    assert.equal(result.isError, true);
  });
});
