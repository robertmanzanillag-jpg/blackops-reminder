import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
import pg, { type PoolConfig } from "pg";
import { createSessionMiddleware } from "../server/session-config";

test("Postgres sessions pass the bounded timeout to their owned pool without connecting", () => {
  const originalPool = pg.Pool;
  const previousUrl = process.env.DATABASE_URL;
  const previousTimeout = process.env.DB_CONNECTION_TIMEOUT_MS;
  let captured: PoolConfig | undefined;
  class FakePool extends EventEmitter {
    constructor(config: PoolConfig) { super(); captured = config; }
    query() { throw new Error("This test must not access a database"); }
  }
  try {
    pg.Pool = FakePool as unknown as typeof pg.Pool;
    process.env.DATABASE_URL = "postgres://test_owner:test_only@db.invalid/test";
    process.env.DB_CONNECTION_TIMEOUT_MS = "30000";
    const middleware = createSessionMiddleware({ enabled: true, secret: "test-only-session-secret", storeKind: "postgres", production: false, secureCookie: false });
    assert.equal(typeof middleware, "function");
    assert.equal(captured?.connectionTimeoutMillis, 30_000);
    assert.equal(captured?.connectionString, process.env.DATABASE_URL);
  } finally {
    pg.Pool = originalPool;
    if (previousUrl === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = previousUrl;
    if (previousTimeout === undefined) delete process.env.DB_CONNECTION_TIMEOUT_MS; else process.env.DB_CONNECTION_TIMEOUT_MS = previousTimeout;
  }
});
