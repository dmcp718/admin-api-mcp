/**
 * Input Validator Tests
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  validateFilespaceName,
  validateEmail,
  validateGroupName,
} from "../dist/shared/validators.js";

describe("validateFilespaceName", () => {
  it("accepts valid names", () => {
    assert.deepEqual(validateFilespaceName("my-filespace"), { ok: true, value: "my-filespace" });
    assert.deepEqual(validateFilespaceName("abc"), { ok: true, value: "abc" });
    assert.deepEqual(validateFilespaceName("test_123"), { ok: true, value: "test_123" });
  });

  it("rejects empty name", () => {
    const r = validateFilespaceName("");
    assert.equal(r.ok, false);
  });

  it("rejects names shorter than 3 chars", () => {
    const r = validateFilespaceName("ab");
    assert.equal(r.ok, false);
  });

  it("rejects names longer than 63 chars", () => {
    const r = validateFilespaceName("a".repeat(64));
    assert.equal(r.ok, false);
  });

  it("rejects names starting with special chars", () => {
    const r = validateFilespaceName("-bad");
    assert.equal(r.ok, false);
  });

  it("rejects names ending with special chars", () => {
    const r = validateFilespaceName("bad-");
    assert.equal(r.ok, false);
  });

  it("rejects names with invalid characters", () => {
    const r = validateFilespaceName("bad name");
    assert.equal(r.ok, false);
  });
});

describe("validateEmail", () => {
  it("accepts valid emails", () => {
    assert.deepEqual(validateEmail("user@example.com"), { ok: true, value: "user@example.com" });
    assert.deepEqual(validateEmail("a.b+c@sub.domain.org"), { ok: true, value: "a.b+c@sub.domain.org" });
  });

  it("rejects empty email", () => {
    assert.equal(validateEmail("").ok, false);
  });

  it("rejects missing @", () => {
    assert.equal(validateEmail("userexample.com").ok, false);
  });

  it("rejects missing domain", () => {
    assert.equal(validateEmail("user@").ok, false);
  });

  it("rejects missing TLD", () => {
    assert.equal(validateEmail("user@example").ok, false);
  });
});

describe("validateGroupName", () => {
  it("accepts valid names", () => {
    const r = validateGroupName("Marketing Team");
    assert.equal(r.ok, true);
  });

  it("rejects empty name", () => {
    assert.equal(validateGroupName("").ok, false);
  });

  it("rejects names over 255 chars", () => {
    assert.equal(validateGroupName("x".repeat(256)).ok, false);
  });

  it("strips dangerous characters", () => {
    const r = validateGroupName('Team <script>"alert"</script>');
    assert.equal(r.ok, true);
    if (r.ok) {
      assert.ok(!r.value.includes("<"), "Should strip < character");
      assert.ok(!r.value.includes(">"), "Should strip > character");
      assert.ok(!r.value.includes('"'), "Should strip quote character");
    }
  });
});
