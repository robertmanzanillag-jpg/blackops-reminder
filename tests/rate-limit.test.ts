import assert from "node:assert/strict";
import test from "node:test";
import { checkRateLimit, type RateLimitStore } from "../server/rate-limit";

test("allows requests until the rate limit is reached", () => {
  const store: RateLimitStore = new Map();

  assert.deepEqual(checkRateLimit(store, "auth:1", 2, 1000, 100), {
    allowed: true,
    remaining: 1,
    resetAt: 1100,
  });
  assert.deepEqual(checkRateLimit(store, "auth:1", 2, 1000, 200), {
    allowed: true,
    remaining: 0,
    resetAt: 1100,
  });
  assert.deepEqual(checkRateLimit(store, "auth:1", 2, 1000, 300), {
    allowed: false,
    remaining: 0,
    resetAt: 1100,
  });
});

test("resets rate limit buckets after their window expires", () => {
  const store: RateLimitStore = new Map();

  checkRateLimit(store, "telegram:1", 1, 1000, 100);
  assert.equal(checkRateLimit(store, "telegram:1", 1, 1000, 200).allowed, false);
  assert.deepEqual(checkRateLimit(store, "telegram:1", 1, 1000, 1100), {
    allowed: true,
    remaining: 0,
    resetAt: 2100,
  });
});

test("keeps independent buckets per key", () => {
  const store: RateLimitStore = new Map();

  assert.equal(checkRateLimit(store, "auth:1", 1, 1000, 100).allowed, true);
  assert.equal(checkRateLimit(store, "auth:1", 1, 1000, 100).allowed, false);
  assert.equal(checkRateLimit(store, "auth:2", 1, 1000, 100).allowed, true);
});
