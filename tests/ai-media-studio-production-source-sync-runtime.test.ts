import assert from "node:assert/strict";
import test from "node:test";
import { runSourceSyncLoop } from "../server/ai-media-studio/sources/production-source-sync-runtime";

test("production loop requeues durable KONG cycles, reconciles leases and stays source-only", async () => {
  const controller = new AbortController();
  const calls = { ensure: 0, run: 0, recover: 0 };
  const scheduler = {
    async ensure(scope: { ownerUserId: string; workspaceId: string }, input: { autoPrepareBatch?: boolean }) {
      assert.deepEqual(scope, { ownerUserId: "owner-a", workspaceId: "personal" });
      assert.equal(input.autoPrepareBatch, true);
      calls.ensure += 1;
      if (calls.ensure === 2) controller.abort();
      return {} as never;
    },
    async runOnce(workerId: string) {
      assert.equal(workerId, "kong-source-worker-a");
      calls.run += 1;
      return { outcome: "idle" } as const;
    },
    async recoverExpiredLeases() {
      calls.recover += 1;
      return 0;
    },
  };

  await runSourceSyncLoop({
    scheduler,
    scope: { ownerUserId: "owner-a", workspaceId: "personal" },
    workerId: "kong-source-worker-a",
    signal: controller.signal,
    syncIntervalMs: 10,
    idleBackoffMs: 10,
    reconciliationIntervalMs: 10,
    sleep: async (_milliseconds, signal) => { if (!signal.aborted) await Promise.resolve(); },
  });

  assert.equal(calls.ensure, 2);
  assert.ok(calls.run >= 1);
  assert.ok(calls.recover >= 1);
});

test("production loop rejects missing tenant and worker identity before any scheduler effect", async () => {
  let effects = 0;
  const scheduler = {
    async ensure() { effects += 1; return {} as never; },
    async runOnce() { effects += 1; return { outcome: "idle" } as const; },
    async recoverExpiredLeases() { effects += 1; return 0; },
  };
  await assert.rejects(runSourceSyncLoop({
    scheduler,
    scope: { ownerUserId: "", workspaceId: "personal" },
    workerId: "worker-a",
    signal: new AbortController().signal,
  }), /Invalid production source sync loop settings/);
  assert.equal(effects, 0);
});

test("a worker failure aborts the periodic requeue peer instead of leaving an orphan loop", async () => {
  let ensures = 0;
  const scheduler = {
    async ensure() { ensures += 1; return {} as never; },
    async runOnce() { throw new Error("safe test failure"); },
    async recoverExpiredLeases() { return 0; },
  };
  await assert.rejects(runSourceSyncLoop({
    scheduler,
    scope: { ownerUserId: "owner-a", workspaceId: "personal" },
    workerId: "worker-a",
    signal: new AbortController().signal,
    syncIntervalMs: 60_000,
  }), /safe test failure/);
  assert.equal(ensures, 1);
});
