import assert from "node:assert/strict";
import test from "node:test";
import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import {
  DrizzleExactSubmitRepository,
  type ExactSubmitDatabase,
  type ExactSubmitTransactionalDatabase,
} from "../server/ai-media-studio/workers/drizzle-exact-submit-repository";
import type { AdmittedSendAuthorization } from "../server/ai-media-studio/workers/admitted-render-contracts";
import type {
  ExactOneVideoRunLease,
  ExactOneVideoStageContext,
} from "../server/ai-media-studio/workers/one-video-run-once-executor";

const id = (digit: string) => `${digit}0000000-0000-4000-8000-00000000000${digit}`;
const digest = (digit: string) => `sha256:${digit.repeat(64)}` as const;
const ids = {
  execution: id("1"),
  runLease: id("2"),
  reservation: id("3"),
  render: id("4"),
  slot: id("5"),
  attempt: id("6"),
  account: id("7"),
  submitLease: id("8"),
} as const;
const scope = { ownerUserId: "owner-1", workspaceId: "workspace-1" } as const;
const context: ExactOneVideoStageContext = {
  action: "activate_and_submit",
  actorUserId: "robert",
  commandId: "command-1",
  commandDigest: digest("a"),
  target: {
    scope,
    budgetReservationId: ids.reservation,
    renderJobId: ids.render,
    dailyPlanSlotId: ids.slot,
    slotAttempt: 1,
    workHandoffDigest: digest("b"),
  },
  lease: {
    executionId: ids.execution,
    commandId: "command-1",
    commandDigest: digest("a"),
    fencingToken: 9n,
    leaseToken: ids.runLease,
  } as ExactOneVideoRunLease,
};

interface Rendered { sql: string; params: unknown[] }
function harness(respond: (query: Rendered) => unknown) {
  const dialect = new PgDialect();
  const calls: Rendered[] = [];
  let transactions = 0;
  const execute = async (query: SQL) => {
    const compiled = dialect.sqlToQuery(query);
    const rendered = {
      sql: compiled.sql.replace(/\s+/gu, " ").trim(),
      params: compiled.params,
    };
    calls.push(rendered);
    return respond(rendered);
  };
  const db: ExactSubmitTransactionalDatabase = {
    execute,
    async transaction<T>(callback: (tx: ExactSubmitDatabase) => Promise<T>) {
      transactions += 1;
      return callback({ execute });
    },
  };
  return {
    calls,
    transactions: () => transactions,
    repository: new DrizzleExactSubmitRepository(db, scope),
  };
}

function fullContextRow(overrides: Record<string, unknown> = {}) {
  return {
    execution_id: ids.execution,
    run_lease_token: ids.runLease,
    run_fencing_token: "9",
    command_digest: context.commandDigest,
    actor_user_id: context.actorUserId,
    owner_user_id: scope.ownerUserId,
    workspace_id: scope.workspaceId,
    budget_reservation_id: ids.reservation,
    render_job_id: ids.render,
    daily_plan_slot_id: ids.slot,
    slot_attempt: 1,
    work_handoff_digest: context.target.workHandoffDigest,
    ...overrides,
  };
}
function claimRow(overrides: Record<string, unknown> = {}) {
  return fullContextRow({
    id: ids.attempt,
    provider_account_id: ids.account,
    provider_key: "heygen",
    provider_credential_version: 1,
    provider_idempotency_key: "idem-1",
    avatar_external_resource_id: "avatar-1",
    voice_external_resource_id: "voice-1",
    sealed_request_digest: digest("c"),
    fencing_token: "4",
    lease_token: ids.submitLease,
    lease_expires_at: new Date("2026-07-23T20:00:00.000Z"),
    request_json: { script: "hello", nested: { language: "es" } },
    ...overrides,
  });
}
function authorizationRow(overrides: Record<string, unknown> = {}) {
  return claimRow({
    send_authorization_digest: digest("d"),
    commit_evidence_digest: digest("e"),
    authorized_at: new Date("2026-07-23T19:00:00.000Z"),
    ...overrides,
  });
}

test("exact claim binds the complete run/target/worker identity and calls only one exact function", async () => {
  const h = harness(() => ({ rows: [claimRow()] }));
  const claim = await h.repository.claim(context, { workerId: "submit-worker-1", leaseDurationMs: 60_000 });
  assert.equal(claim?.id, ids.attempt);
  assert.equal(claim?.fencingToken, 4n);
  assert.equal(h.transactions(), 1);
  assert.match(h.calls[0].sql, /claim_exact_one_video_submit_v1/u);
  for (const value of [
    ids.execution, ids.runLease, 9n, context.commandDigest, "robert",
    "owner-1", "workspace-1", ids.reservation, ids.render, ids.slot, 1,
    context.target.workHandoffDigest, "submit-worker-1", 60_000,
  ]) assert.ok(h.calls[0].params.includes(value), `missing bound value ${String(value)}`);
  assert.doesNotMatch(h.calls[0].sql, /\b(?:INSERT|UPDATE|DELETE)\b/iu);
  assert.equal(Object.isFrozen(claim), true);
  assert.equal(Object.isFrozen(claim?.sealedRequest), true);
});

test("wrong action/target, malformed context, and multi-row results fail closed", async () => {
  const h = harness(() => ({ rows: [claimRow(), claimRow()] }));
  await assert.rejects(h.repository.claim(
    { ...context, action: "reconcile_submission" },
    { workerId: "worker", leaseDurationMs: 1_000 },
  ), /activate-and-submit/u);
  await assert.rejects(h.repository.claim(
    {
      ...context,
      target: {
        ...context.target,
        scope: { ...context.target.scope, workspaceId: "another-workspace" },
      },
    },
    { workerId: "worker", leaseDurationMs: 1_000 },
  ), /context/u);
  await assert.rejects(h.repository.claim(
    { ...context, lease: { ...context.lease, leaseToken: "bad" } as ExactOneVideoRunLease },
    { workerId: "worker", leaseDurationMs: 1_000 },
  ), /context/u);
  assert.equal(h.calls.length, 0);
  await assert.rejects(
    h.repository.claim(context, { workerId: "worker", leaseDurationMs: 1_000 }),
    /function result/u,
  );
});

test("returned run-target and authorization substitutions are rejected in the transaction", async () => {
  const wrongTarget = harness(() => ({ rows: [claimRow({ daily_plan_slot_id: ids.render })] }));
  await assert.rejects(
    wrongTarget.repository.claim(context, { workerId: "worker", leaseDurationMs: 1_000 }),
    /another run target/u,
  );

  let call = 0;
  const wrongAuthorization = harness(() => ({
    rows: [call++ === 0 ? claimRow() : authorizationRow({ provider_key: "other" })],
  }));
  const claim = await wrongAuthorization.repository.claim(
    context,
    { workerId: "worker", leaseDurationMs: 1_000 },
  );
  assert.ok(claim);
  await assert.rejects(
    wrongAuthorization.repository.authorize(context, claim),
    /does not match/u,
  );
  assert.equal(wrongAuthorization.transactions(), 2);
});

test("authorize and both finalizers bind every exact field and require repository-issued guards", async () => {
  const h = harness(query => {
    if (query.sql.includes("claim_exact_one_video_submit_v1")) return { rows: [claimRow()] };
    if (query.sql.includes("authorize_exact_one_video_submit_v1")) return { rows: [authorizationRow()] };
    return { rows: [fullContextRow({ applied: true })] };
  });
  const claim = await h.repository.claim(context, { workerId: "worker", leaseDurationMs: 2_000 });
  assert.ok(claim);
  await assert.rejects(
    h.repository.authorize(context, { ...claim }),
    /not issued/u,
  );
  const authorization = await h.repository.authorize(context, claim);
  assert.ok(authorization);

  const fakeAuthorization = { ...authorization } as AdmittedSendAuthorization;
  await assert.rejects(h.repository.confirm(context, fakeAuthorization, {
    providerJobId: "job-1",
    evidenceDigest: digest("f"),
  }), /not issued/u);
  assert.equal(h.calls.length, 2);

  assert.equal(await h.repository.confirm(context, authorization, {
    providerJobId: "job-1",
    providerRequestId: "request-1",
    evidenceDigest: digest("f"),
  }), true);
  assert.equal(await h.repository.markAmbiguous(context, authorization, {
    providerRequestId: "request-2",
    evidenceDigest: digest("1"),
  }), true);

  assert.match(h.calls[1].sql, /authorize_exact_one_video_submit_v1/u);
  assert.match(h.calls[2].sql, /record_exact_one_video_submit_confirmed_v1/u);
  assert.match(h.calls[3].sql, /record_exact_one_video_submit_ambiguous_v1/u);
  for (const call of h.calls) {
    for (const value of [
      ids.execution, ids.runLease, 9n, context.commandDigest, "robert",
      "owner-1", "workspace-1", ids.reservation, ids.render, ids.slot, 1,
      context.target.workHandoffDigest,
    ]) assert.ok(call.params.includes(value), `missing ${String(value)} from ${call.sql}`);
    assert.doesNotMatch(call.sql, /\b(?:INSERT|UPDATE|DELETE)\b/iu);
  }
  for (const call of h.calls.slice(1)) {
    assert.ok(call.params.includes(ids.attempt));
    assert.ok(call.params.includes(4n));
    assert.ok(call.params.includes(ids.submitLease));
  }
  assert.ok(h.calls[1].params.includes(digest("c")));
  assert.ok(h.calls[2].params.includes(digest("d")));
  assert.ok(h.calls[2].params.includes(digest("f")));
  assert.ok(h.calls[2].params.includes("job-1"));
  assert.ok(h.calls[2].params.includes("request-1"));
  assert.ok(h.calls[3].params.includes(digest("d")));
  assert.ok(h.calls[3].params.includes(digest("1")));
  assert.ok(h.calls[3].params.includes("request-2"));
});

test("malformed and multi-row authorize/finalizer results never report success", async () => {
  let call = 0;
  const h = harness(() => {
    call += 1;
    if (call === 1) return { rows: [claimRow()] };
    if (call === 2) return { rows: [authorizationRow()] };
    return { rows: [fullContextRow({ applied: true }), fullContextRow({ applied: true })] };
  });
  const claim = await h.repository.claim(context, { workerId: "worker", leaseDurationMs: 1_000 });
  assert.ok(claim);
  const authorization = await h.repository.authorize(context, claim);
  assert.ok(authorization);
  await assert.rejects(h.repository.markAmbiguous(context, authorization, {
    evidenceDigest: digest("1"),
  }), /function result/u);
});
