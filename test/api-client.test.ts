/**
 * API Client Tests
 *
 * Tests request construction, error parsing, and rate limiting
 * without making real HTTP calls.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ApiClient } from "../dist/shared/api-client.js";

describe("ApiClient", () => {
  // Use a fake token — no real requests are made in unit tests
  const client = new ApiClient("test-token-abc123");

  it("constructs with bearer token", () => {
    assert.ok(client, "Client should be created");
  });

  it("handles connection errors gracefully", async () => {
    // Point to a port nothing is listening on
    const badClient = new ApiClient("token", "http://localhost:19999/api/v1");
    const res = await badClient.getHealth();
    assert.equal(res.success, false);
    assert.ok(res.error, "Should return an error message");
  });

  it("rate limits after max calls", async () => {
    // Create client with a very low rate limit (we can't set it directly,
    // but we can verify the rate limiter integrates by making many calls
    // to a dead endpoint)
    const fastClient = new ApiClient("token", "http://localhost:19999/api/v1");
    const results = [];
    // Make 55 rapid calls (limit is 50/min)
    for (let i = 0; i < 55; i++) {
      results.push(await fastClient.getHealth());
    }
    const rateLimited = results.filter((r) => r.error?.includes("Rate limit"));
    assert.ok(rateLimited.length > 0, "Should hit rate limit after 50 calls");
  });
});

describe("ApiClient method coverage", () => {
  // Verify all API methods exist and are callable (type safety)
  const client = new ApiClient("token", "http://localhost:19999/api/v1");

  const methods = [
    "createFilespace", "listFilespaces", "getFilespace", "updateFilespace", "deleteFilespace",
    "addMember", "listMembers", "getMember", "removeMember", "updateMemberRole", "getMemberGroups",
    "createGroup", "listGroups", "getGroup", "updateGroup", "deleteGroup",
    "listGroupMembers", "addMemberToGroup", "addSingleMemberToGroup", "removeMemberFromGroup",
    "grantPermission", "listPermissions", "updatePermission", "revokePermission",
    "getHealth", "listProviders",
    "createEntry", "resolveEntry", "getEntry", "deleteEntry", "listEntryChildren",
    "createDataStore", "listDataStores", "getDataStore", "updateDataStore", "deleteDataStore",
    "createExternalEntry", "listExternalEntryIds", "deleteExternalEntry",
  ];

  for (const method of methods) {
    it(`has method: ${method}`, () => {
      assert.equal(typeof (client as unknown as Record<string, unknown>)[method], "function",
        `ApiClient.${method} should be a function`);
    });
  }
});
