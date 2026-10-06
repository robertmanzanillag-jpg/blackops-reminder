import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
import type { PoolConfig } from "pg";
import { ObservedDatabasePool, resolveDatabasePoolSettings, summarizeDatabaseError, type DatabasePoolEvent } from "../server/db-pool";

class FakeClient extends EventEmitter {
  _queryable = true;
  _ending = false;
  queryCalls = 0;
  connect(callback: (error?: Error) => void) { queueMicrotask(() => callback()); }
  query(_query: unknown, _values: unknown, callback: (error: undefined, result: unknown) => void) {
    this.queryCalls++;
    queueMicrotask(() => callback(undefined, { rows: [{ ok: true }], rowCount: 1 }));
  }
  end(callback?: () => void) { callback?.(); }
  ref() {}
  unref() {}
}

function fakePool(Client = FakeClient, extra: PoolConfig = {}, report: (event: DatabasePoolEvent) => void = () => {}) {
  const config = { Client, allowExitOnIdle: true, connectionTimeoutMillis: 40, ...extra };
  return new ObservedDatabasePool(config, report);
}

test("connection waits have a finite default and an explicit bounded cold-start override", () => {
  assert.deepEqual(resolveDatabasePoolSettings({}), { connectionTimeoutMillis: 10_000 });
  assert.equal(resolveDatabasePoolSettings({ DB_CONNECTION_TIMEOUT_MS: "30000" }).connectionTimeoutMillis, 30_000);
  for (const value of ["0", "-1", "1.5", "Infinity", "abc", "120001", "1e4"]) {
    assert.throws(() => resolveDatabasePoolSettings({ DB_CONNECTION_TIMEOUT_MS: value }), /DB_CONNECTION_TIMEOUT_MS/);
  }
});

test("native queue timeout removes its waiter and does not acquire a client after rejection", async () => {
  const events: DatabasePoolEvent[] = [];
  const pool = fakePool(FakeClient, { max: 1 }, event => events.push(event));
  const client = await pool.connect();
  try {
    assert.equal(pool.totalCount, 1);
    // pg unrefs its checkout timer; keep this in-memory test alive until it fires.
    const keepAlive = setTimeout(() => {}, 500);
    try { await assert.rejects(pool.connect(), /timeout exceeded when trying to connect/); }
    finally { clearTimeout(keepAlive); }
    assert.equal(pool.waitingCount, 0);
    assert.equal(events.length, 1);
    assert.equal(events[0].event, "acquisition_failed");
    assert.equal(events[0].reason, "connection_timeout");
    assert.ok(events[0].durationMs! >= 20 && events[0].durationMs! < 500);
    assert.deepEqual(events[0].counts, { total: 1, idle: 0, waiting: 0 });
    client.release();
    const reused = await pool.connect();
    assert.equal(reused, client);
    reused.release();
  } finally { await pool.end(); }
});

test("native timeout also terminates a stalled new connection", async () => {
  let connectAttempts = 0;
  class StalledClient extends FakeClient {
    callback?: (error?: Error) => void;
    connect(callback: (error?: Error) => void) { connectAttempts++; this.callback = callback; }
    end(callback?: () => void) {
      const pending = this.callback;
      this.callback = undefined;
      pending?.(new Error("Connection closed with private authentication detail"));
      callback?.();
    }
  }
  const events: DatabasePoolEvent[] = [];
  const pool = fakePool(StalledClient, {}, event => events.push(event));
  try {
    await assert.rejects(pool.connect(), /connection timeout/);
    assert.equal(connectAttempts, 1);
    assert.equal(pool.totalCount, 0);
    assert.equal(events[0].reason, "connection_timeout");
    assert.doesNotMatch(JSON.stringify(events), /private authentication/);
  } finally { await pool.end(); }
});

test("pool query callback failure is forwarded once without retrying a write or exposing errors", async () => {
  let connectAttempts = 0;
  let queryAttempts = 0;
  const error = Object.assign(new Error("postgres://owner:secret@db.internal/private SQL INSERT secret"), {
    code: "08P01", detail: "private detail", cause: new Error("secret cause"),
  });
  class FailedAuthClient extends FakeClient {
    connect(callback: (error?: Error) => void) { connectAttempts++; queueMicrotask(() => callback(error)); }
    query(...args: Parameters<FakeClient["query"]>) { queryAttempts++; super.query(...args); }
  }
  const events: DatabasePoolEvent[] = [];
  const pool = fakePool(FailedAuthClient, {}, event => events.push(event));
  try {
    await new Promise<void>((resolve, reject) => {
      pool.query("INSERT private_table VALUES ($1)", ["secret value"], actual => {
        try { assert.equal(actual, error); resolve(); } catch (failure) { reject(failure); }
      });
    });
    assert.equal(connectAttempts, 1);
    assert.equal(queryAttempts, 0);
    assert.equal(events.length, 1);
    assert.equal(events[0].code, "08P01");
    assert.equal(events[0].reason, "connection_error");
    assert.doesNotMatch(JSON.stringify(events), /secret|private|postgres:\/\//);
  } finally { await pool.end(); }
});

test("normal callback queries release clients and preserve results even if telemetry throws", async () => {
  const pool = fakePool(FakeClient, {}, () => { throw new Error("logger unavailable"); });
  try {
    const result = await pool.query("SELECT fake_value");
    assert.deepEqual(result.rows, [{ ok: true }]);
    assert.equal(pool.idleCount, 1);
    const client = await pool.connect();
    client.release();
    assert.doesNotThrow(() => client.emit("error", Object.assign(new Error("secret credentials"), { code: "ECONNRESET" })));
    assert.equal(pool.totalCount, 0);
  } finally { await pool.end(); }
});

test("idle client errors are contained and reported without client/config/message details", async () => {
  const events: DatabasePoolEvent[] = [];
  const pool = fakePool(FakeClient, {}, event => events.push(event));
  try {
    const client = await pool.connect();
    client.release();
    client.emit("error", Object.assign(new Error("secret password"), { code: "ECONNRESET", config: { password: "secret" } }));
    assert.deepEqual(events, [{ pool: "application", event: "idle_error", counts: { total: 0, idle: 0, waiting: 0 }, reason: "connection_error", code: "ECONNRESET" }]);
    assert.deepEqual(summarizeDatabaseError({ code: "postgres://secret" }), { reason: "unknown_error" });
  } finally { await pool.end(); }
});
