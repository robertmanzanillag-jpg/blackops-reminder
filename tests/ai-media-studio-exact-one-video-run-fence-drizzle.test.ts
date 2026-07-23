import assert from "node:assert/strict";
import test from "node:test";
import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import {
  DrizzleExactOneVideoRunFence,
  type ExactOneVideoRunFenceDatabase,
  type ExactOneVideoRunFenceTransactionalDatabase,
} from "../server/ai-media-studio/workers/drizzle-exact-one-video-run-fence";
import type {
  ExactOneVideoRunLease,
  ExactOneVideoRunTarget,
} from "../server/ai-media-studio/workers/one-video-run-once-executor";

const ids = {
  capability: "10000000-0000-4000-8000-000000000001",
  reservation: "20000000-0000-4000-8000-000000000002",
  render: "30000000-0000-4000-8000-000000000003",
  slot: "40000000-0000-4000-8000-000000000004",
  execution: "50000000-0000-4000-8000-000000000005",
  lease: "60000000-0000-4000-8000-000000000006",
} as const;
const handoff = `sha256:${"a".repeat(64)}` as const;
const commandDigest = `sha256:${"b".repeat(64)}` as const;
const target: ExactOneVideoRunTarget = {
  scope: { ownerUserId: "owner-1", workspaceId: "workspace-1" },
  budgetReservationId: ids.reservation,
  renderJobId: ids.render,
  dailyPlanSlotId: ids.slot,
  slotAttempt: 1,
  workHandoffDigest: handoff,
};

interface Rendered { sql: string; params: unknown[] }
function harness(respond: (query: Rendered) => unknown) {
  const dialect = new PgDialect();
  const calls: Rendered[] = [];
  let transactions = 0;
  const execute = async (query: SQL) => {
    const compiled = dialect.sqlToQuery(query);
    const rendered = { sql: compiled.sql.replace(/\s+/gu, " ").trim(), params: compiled.params };
    calls.push(rendered);
    return respond(rendered);
  };
  const db: ExactOneVideoRunFenceTransactionalDatabase = {
    execute,
    async transaction<T>(callback: (tx: ExactOneVideoRunFenceDatabase) => Promise<T>) {
      transactions += 1;
      return callback({ execute });
    },
  };
  return { db, calls, transactions: () => transactions };
}
function row(overrides: Record<string, unknown> = {}) {
  return {
    kind: "acquired",
    execution_id: ids.execution,
    command_id: "command-one-video-1",
    command_digest: commandDigest,
    fencing_token: "1",
    lease_token: ids.lease,
    owner_user_id: target.scope.ownerUserId,
    workspace_id: target.scope.workspaceId,
    budget_reservation_id: target.budgetReservationId,
    render_job_id: target.renderJobId,
    daily_plan_slot_id: target.dailyPlanSlotId,
    slot_attempt: target.slotAttempt,
    work_handoff_digest: target.workHandoffDigest,
    action: "activate_and_submit",
    actor_user_id: "robert",
    outcome: null,
    ...overrides,
  };
}
function repository(respond: (query: Rendered) => unknown) {
  const h = harness(respond);
  return {
    ...h,
    repository: new DrizzleExactOneVideoRunFence(h.db, {
      capabilityId: ids.capability,
      scope: target.scope,
      leaseDurationMs: 60_000,
    }),
  };
}

test("acquire calls only the exact capability function and binds every target/actor field", async () => {
  const h = repository(() => ({ rows: [row()] }));
  const result = await h.repository.acquire({
    target,
    action: "activate_and_submit",
    commandId: "command-one-video-1",
    commandDigest,
    actorUserId: "robert",
  });
  assert.equal(result.kind, "acquired");
  if (result.kind !== "acquired") return;
  assert.equal(result.lease.executionId, ids.execution);
  assert.equal(result.lease.leaseToken, ids.lease);
  assert.equal(result.lease.fencingToken, 1n);
  assert.equal(h.transactions(), 1);
  assert.match(h.calls[0].sql, /acquire_exact_one_video_run_v1/u);
  for (const value of [
    ids.capability, target.scope.ownerUserId, target.scope.workspaceId, ids.reservation,
    ids.render, ids.slot, 1, handoff, "activate_and_submit", "command-one-video-1",
    commandDigest, "robert", 60_000,
  ]) assert.ok(h.calls[0].params.includes(value));
  assert.doesNotMatch(h.calls[0].sql, /\b(?:INSERT|UPDATE|DELETE)\b/iu);
});

test("busy/conflict are fail-closed and replay must match the exact durable identity", async () => {
  for (const kind of ["busy", "conflict"] as const) {
    const h = repository(() => ({ rows: [{ kind }] }));
    assert.deepEqual(await h.repository.acquire({
      target, action: "activate_and_submit", commandId: "command-one-video-1", commandDigest, actorUserId: "robert",
    }), { kind });
  }
  const replay = repository(() => ({ rows: [row({ kind: "replayed", outcome: "ambiguous" })] }));
  assert.deepEqual(await replay.repository.acquire({
    target, action: "activate_and_submit", commandId: "command-one-video-1", commandDigest, actorUserId: "robert",
  }), { kind: "replayed", result: { target: {
    ...target, scope: { ...target.scope },
  }, action: "activate_and_submit", outcome: "ambiguous" } });
  const mismatch = repository(() => ({ rows: [row({ kind: "replayed", render_job_id: ids.slot, outcome: "confirmed" })] }));
  await assert.rejects(mismatch.repository.acquire({
    target, action: "activate_and_submit", commandId: "command-one-video-1", commandDigest, actorUserId: "robert",
  }), /another command/u);
});

test("complete and uncertainty use fenced SECURITY DEFINER functions with the lease token", async () => {
  const h = repository(() => ({ rows: [{ applied: true }] }));
  const lease = {
    executionId: ids.execution,
    commandId: "command-one-video-1",
    commandDigest,
    fencingToken: 3n,
    leaseToken: ids.lease,
  } as ExactOneVideoRunLease;
  assert.equal(await h.repository.complete({
    lease,
    result: { target, action: "activate_and_submit", outcome: "confirmed" },
  }), true);
  assert.equal(await h.repository.sealUncertain({
    lease,
    errorDigest: `sha256:${"c".repeat(64)}`,
  }), true);
  assert.match(h.calls[0].sql, /complete_exact_one_video_run_v1/u);
  assert.match(h.calls[1].sql, /seal_exact_one_video_run_uncertain_v1/u);
  assert.ok(h.calls.every((call) => call.params.includes(ids.lease) && call.params.includes(3n)));
  assert.equal(h.transactions(), 2);
});

test("invalid scope, target, actor, lease and multi-row function results fail before success", async () => {
  const h = repository(() => ({ rows: [row(), row()] }));
  await assert.rejects(h.repository.acquire({
    target: { ...target, scope: { ...target.scope, workspaceId: "other" } },
    action: "activate_and_submit",
    commandId: "command-one-video-1",
    commandDigest,
    actorUserId: "robert",
  }), /target/u);
  assert.equal(h.calls.length, 0);
  await assert.rejects(h.repository.acquire({
    target,
    action: "activate_and_submit",
    commandId: "command-one-video-1",
    commandDigest,
    actorUserId: "bad actor",
  }), /acquire input/u);
  assert.equal(h.calls.length, 0);
  await assert.rejects(h.repository.acquire({
    target,
    action: "activate_and_submit",
    commandId: "command-one-video-1",
    commandDigest,
    actorUserId: "robert",
  }), /function result/u);
});
