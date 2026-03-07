/**
 * Rate Limiter Tests
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { RateLimiter } from "../dist/shared/rate-limiter.js";

describe("RateLimiter", () => {
  it("allows calls within limit", () => {
    const limiter = new RateLimiter(5, 60_000);
    for (let i = 0; i < 5; i++) {
      assert.ok(limiter.check(), `Call ${i + 1} should be allowed`);
    }
  });

  it("blocks calls over limit", () => {
    const limiter = new RateLimiter(3, 60_000);
    assert.ok(limiter.check());
    assert.ok(limiter.check());
    assert.ok(limiter.check());
    assert.equal(limiter.check(), false, "4th call should be blocked");
  });

  it("reports time until reset", () => {
    const limiter = new RateLimiter(1, 60_000);
    limiter.check();
    const wait = limiter.timeUntilReset();
    assert.ok(wait > 0 && wait <= 60, `Wait should be 1-60s, got ${wait}`);
  });

  it("returns 0 wait time when no calls made", () => {
    const limiter = new RateLimiter(10, 60_000);
    assert.equal(limiter.timeUntilReset(), 0);
  });

  it("uses default of 50 calls per 60s", () => {
    const limiter = new RateLimiter();
    // Should allow 50 calls
    for (let i = 0; i < 50; i++) {
      assert.ok(limiter.check(), `Call ${i + 1} should be allowed`);
    }
    assert.equal(limiter.check(), false, "51st call should be blocked");
  });
});
