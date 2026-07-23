import assert from "node:assert/strict";
import test from "node:test";
import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import type { ExactNegativeSubmissionFinality } from "../server/ai-media-studio/workers/admitted-render-contracts";
import type {
  AdmittedCompletedTerminalFinality,
  AdmittedFailedTerminalFinality,
  AdmittedTerminalClaim,
} from "../server/ai-media-studio/workers/admitted-render-terminal-worker";
import {
  DrizzleExactReconcileTerminalRepository,
  type ExactReconciliationClaim,
  type ExactReconcileTerminalDatabase,
  type ExactReconcileTerminalTransactionalDatabase,
} from "../server/ai-media-studio/workers/drizzle-exact-reconcile-terminal-repository";
import type {
  ExactOneVideoRunLease,
  ExactOneVideoStageContext,
} from "../server/ai-media-studio/workers/one-video-run-once-executor";

const digest = (digit: string) => `sha256:${digit.repeat(64)}` as const;
const ids = {
  execution: "10000000-0000-4000-8000-000000000001",
  runLease: "20000000-0000-4000-8000-000000000002",
  reservation: "30000000-0000-4000-8000-000000000003",
  render: "40000000-0000-4000-8000-000000000004",
  slot: "50000000-0000-4000-8000-000000000005",
  attempt: "60000000-0000-4000-8000-000000000006",
  account: "70000000-0000-4000-8000-000000000007",
  reconciliationLease: "80000000-0000-4000-8000-000000000008",
  terminalCheck: "90000000-0000-4000-8000-000000000009",
  terminalLease: "a0000000-0000-4000-8000-00000000000a",
  otherExecution: "b0000000-0000-4000-8000-00000000000b",
} as const;
const scope = { ownerUserId: "owner-1", workspaceId: "workspace-1" } as const;
const baseContext = {
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
} as const;
const reconciliationContext: ExactOneVideoStageContext = {
  ...baseContext,
  action: "reconcile_submission",
};
const terminalContext: ExactOneVideoStageContext = {
  ...baseContext,
  action: "observe_terminal",
};

interface Rendered {
  sql: string;
  params: unknown[];
}

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
  const db: ExactReconcileTerminalTransactionalDatabase = {
    execute,
    async transaction<T>(
      callback: (tx: ExactReconcileTerminalDatabase) => Promise<T>,
    ) {
      transactions += 1;
      return callback({ execute });
    },
  };
  return {
    calls,
    transactions: () => transactions,
    repository: new DrizzleExactReconcileTerminalRepository(db, scope),
  };
}

function fullContextRow(overrides: Record<string, unknown> = {}) {
  return {
    execution_id: ids.execution,
    run_lease_token: ids.runLease,
    run_fencing_token: "9",
    command_digest: baseContext.commandDigest,
    actor_user_id: baseContext.actorUserId,
    owner_user_id: scope.ownerUserId,
    workspace_id: scope.workspaceId,
    budget_reservation_id: ids.reservation,
    render_job_id: ids.render,
    daily_plan_slot_id: ids.slot,
    slot_attempt: 1,
    work_handoff_digest: baseContext.target.workHandoffDigest,
    ...overrides,
  };
}

function reconciliationRow(overrides: Record<string, unknown> = {}) {
  return fullContextRow({
    id: ids.attempt,
    provider_account_id: ids.account,
    provider_key: "heygen",
    provider_credential_version: 1,
    provider_idempotency_key: "idem-1",
    avatar_external_resource_id: "avatar-1",
    voice_external_resource_id: "voice-1",
    request_json: { script: "hello", nested: { language: "es" } },
    sealed_request_digest: digest("c"),
    fencing_token: "4",
    send_authorization_digest: digest("d"),
    commit_evidence_digest: digest("e"),
    authorized_at: new Date("2026-07-23T18:00:00.000Z"),
    reconciliation_lease_token: ids.reconciliationLease,
    reconciliation_lease_owner: "reconcile-worker-1",
    reconciliation_fencing_token: "5",
    reconciliation_lease_expires_at: new Date("2026-07-23T18:01:00.000Z"),
    ...overrides,
  });
}

function terminalRow(overrides: Record<string, unknown> = {}) {
  return fullContextRow({
    id: ids.terminalCheck,
    submission_attempt_id: ids.attempt,
    provider_account_id: ids.account,
    provider_key: "heygen",
    provider_credential_version: 1,
    send_authorization_digest: digest("d"),
    submission_fencing_token: "4",
    provider_job_id: "provider-job-1",
    lease_token: ids.terminalLease,
    lease_expires_at: new Date("2026-07-23T19:01:00.000Z"),
    fencing_token: "6",
    ...overrides,
  });
}

function negativeFinality(
  overrides: Record<string, unknown> = {},
): ExactNegativeSubmissionFinality {
  return {
    scope,
    providerAccountId: ids.account,
    providerKey: "heygen",
    providerCredentialVersion: 1,
    authorizationDigest: digest("d"),
    providerIdempotencyKey: "idem-1",
    guarantee: "linearizable_not_accepted_and_cannot_later_accept",
    observedAt: "2026-07-23T18:00:30.000Z",
    evidenceDigest: digest("f"),
    ...overrides,
  } as unknown as ExactNegativeSubmissionFinality;
}

const completedFinality: AdmittedCompletedTerminalFinality = {
  kind: "completed",
  remoteArtifactRef: "heygen:account/provider-job-1",
  ephemeralSourceUrl: "https://provider.example/video.mp4?sig=temporary",
  mediaType: "video/mp4",
  observedAt: "2026-07-23T19:00:30.000Z",
  evidenceDigest: digest("1"),
  releaseCapacity: true,
  enqueueIngest: true,
};
const failedFinality: AdmittedFailedTerminalFinality = {
  kind: "failed",
  observedAt: "2026-07-23T19:00:30.000Z",
  evidenceDigest: digest("2"),
  failureCode: "provider_failed",
  failureMessageDigest: digest("3"),
  releaseCapacity: true,
  enqueueIngest: false,
};

function assertFullIdentityBound(call: Rendered): void {
  for (const value of [
    ids.execution,
    ids.runLease,
    9n,
    baseContext.commandDigest,
    "robert",
    scope.ownerUserId,
    scope.workspaceId,
    ids.reservation,
    ids.render,
    ids.slot,
    1,
    baseContext.target.workHandoffDigest,
  ]) {
    assert.ok(call.params.includes(value), `missing ${String(value)} from ${call.sql}`);
  }
}

function assertFunctionOnly(call: Rendered): void {
  assert.match(call.sql, /^SELECT \* FROM ai_media_worker_api\./u);
  assert.doesNotMatch(call.sql, /\b(?:INSERT|UPDATE|DELETE|MERGE|TRUNCATE)\b/iu);
  assert.doesNotMatch(
    call.sql,
    /\b(?:publish|tiktok|instagram|facebook|youtube|provider_api|http|fetch)\b/iu,
  );
  assert.doesNotMatch(
    call.sql,
    /(?:claim_ambiguous_submission_v1|claim_admitted_terminal_check_v1)/u,
  );
}

test("both exact claim methods bind the full run/target identity and only call their exact functions", async () => {
  const h = harness(query => query.sql.includes("reconciliation")
    ? { rows: [reconciliationRow()] }
    : { rows: [terminalRow()] });

  const reconciliation = await h.repository.claimReconciliation(
    reconciliationContext,
    { workerId: "reconcile-worker-1", leaseDurationMs: 60_000 },
  );
  const terminal = await h.repository.claimTerminal(
    terminalContext,
    { workerId: "terminal-worker-1", leaseDurationMs: 45_000 },
  );

  assert.equal(reconciliation?.id, ids.attempt);
  assert.equal(reconciliation?.reconciliationFencingToken, 5n);
  assert.equal(terminal?.terminalCheckId, ids.terminalCheck);
  assert.equal(terminal?.terminalFencingToken, 6n);
  assert.equal(h.transactions(), 2);
  assert.equal(Object.isFrozen(reconciliation), true);
  assert.equal(Object.isFrozen(reconciliation?.sealedRequest), true);
  assert.equal(Object.isFrozen(reconciliation?.sealedRequest.nested), true);
  assert.equal(Object.isFrozen(terminal), true);
  assert.match(h.calls[0].sql, /claim_exact_one_video_reconciliation_v1/u);
  assert.match(h.calls[1].sql, /claim_exact_one_video_terminal_check_v1/u);
  assert.ok(h.calls[0].params.includes("reconcile-worker-1"));
  assert.ok(h.calls[0].params.includes(60_000));
  assert.ok(h.calls[1].params.includes("terminal-worker-1"));
  assert.ok(h.calls[1].params.includes(45_000));
  for (const call of h.calls) {
    assertFullIdentityBound(call);
    assertFunctionOnly(call);
  }
});

test("wrong action, scope, lease identity, and worker input fail before a database call", async () => {
  const h = harness(() => ({ rows: [] }));
  await assert.rejects(
    h.repository.claimReconciliation(terminalContext, {
      workerId: "worker",
      leaseDurationMs: 1_000,
    }),
    /reconcile_submission/u,
  );
  await assert.rejects(
    h.repository.claimTerminal(reconciliationContext, {
      workerId: "worker",
      leaseDurationMs: 1_000,
    }),
    /observe_terminal/u,
  );
  await assert.rejects(
    h.repository.claimTerminal({
      ...terminalContext,
      target: {
        ...terminalContext.target,
        scope: { ...scope, workspaceId: "other-workspace" },
      },
    }, {
      workerId: "worker",
      leaseDurationMs: 1_000,
    }),
    /context/u,
  );
  await assert.rejects(
    h.repository.claimTerminal({
      ...terminalContext,
      lease: {
        ...terminalContext.lease,
        commandDigest: digest("9"),
      },
    }, {
      workerId: "worker",
      leaseDurationMs: 1_000,
    }),
    /context/u,
  );
  await assert.rejects(
    h.repository.claimTerminal(terminalContext, {
      workerId: "bad worker",
      leaseDurationMs: 1_000,
    }),
    /lease/u,
  );
  await assert.rejects(
    h.repository.claimTerminal(terminalContext, {
      workerId: "worker",
      leaseDurationMs: 300_001,
    }),
    /lease/u,
  );
  assert.equal(h.calls.length, 0);
});

test("claim results fail closed on returned identity substitution, malformed rows, and multiple rows", async () => {
  for (const row of [
    reconciliationRow({ execution_id: ids.otherExecution }),
    reconciliationRow({ actor_user_id: "mallory" }),
    reconciliationRow({ workspace_id: "other-workspace" }),
    reconciliationRow({ daily_plan_slot_id: ids.render }),
    reconciliationRow({ run_fencing_token: "10" }),
  ]) {
    const h = harness(() => ({ rows: [row] }));
    await assert.rejects(
      h.repository.claimReconciliation(reconciliationContext, {
        workerId: "worker",
        leaseDurationMs: 1_000,
      }),
      /another run target/u,
    );
  }

  const malformed = harness(() => ({ rows: ["not-a-row"] }));
  await assert.rejects(
    malformed.repository.claimTerminal(terminalContext, {
      workerId: "worker",
      leaseDurationMs: 1_000,
    }),
    /function result/u,
  );
  const multiple = harness(() => ({ rows: [terminalRow(), terminalRow()] }));
  await assert.rejects(
    multiple.repository.claimTerminal(terminalContext, {
      workerId: "worker",
      leaseDurationMs: 1_000,
    }),
    /function result/u,
  );
});

test("all reconciliation mutations require an issued exact claim and bind every claim/finality field", async () => {
  const h = harness(query => {
    if (query.sql.includes("claim_exact_one_video_reconciliation_v1")) {
      return { rows: [reconciliationRow()] };
    }
    return { rows: [fullContextRow({ applied: true })] };
  });
  const claim = await h.repository.claimReconciliation(
    reconciliationContext,
    { workerId: "worker", leaseDurationMs: 2_000 },
  );
  assert.ok(claim);

  await assert.rejects(
    h.repository.releaseReconciliationUnknown(
      reconciliationContext,
      { ...claim },
    ),
    /not issued/u,
  );
  await assert.rejects(
    h.repository.finalizeReconciliationConfirmed(
      { ...reconciliationContext, actorUserId: "mallory" },
      claim,
      { providerJobId: "job-1", evidenceDigest: digest("4") },
    ),
    /not issued/u,
  );
  assert.equal(h.calls.length, 1);

  assert.equal(
    await h.repository.releaseReconciliationUnknown(reconciliationContext, claim),
    true,
  );
  assert.equal(await h.repository.finalizeReconciliationConfirmed(
    reconciliationContext,
    claim,
    {
      providerJobId: "job-1",
      providerRequestId: "request-1",
      evidenceDigest: digest("4"),
    },
  ), true);
  assert.equal(await h.repository.finalizeReconciledNoSubmit(
    reconciliationContext,
    claim,
    negativeFinality(),
  ), true);

  assert.match(h.calls[1].sql, /release_exact_one_video_reconciliation_unknown_v1/u);
  assert.match(h.calls[2].sql, /record_exact_one_video_reconciled_confirmed_v1/u);
  assert.match(h.calls[3].sql, /finalize_exact_one_video_reconciled_no_submit_v1/u);
  for (const call of h.calls) {
    assertFullIdentityBound(call);
    assertFunctionOnly(call);
  }
  for (const call of h.calls.slice(1)) {
    for (const value of [
      ids.attempt,
      4n,
      digest("d"),
      ids.reconciliationLease,
      5n,
    ]) {
      assert.ok(call.params.includes(value), `missing reconciliation claim value ${String(value)}`);
    }
  }
  assert.ok(h.calls[2].params.includes("job-1"));
  assert.ok(h.calls[2].params.includes("request-1"));
  assert.ok(h.calls[2].params.includes(digest("4")));
  for (const value of [
    "linearizable_not_accepted_and_cannot_later_accept",
    ids.account,
    "heygen",
    1,
    "idem-1",
    digest("f"),
  ]) {
    assert.ok(h.calls[3].params.includes(value), `missing negative-finality value ${String(value)}`);
  }
});

test("reconciliation finalizers reject fabricated/stale claims, substituted finality, and returned identity", async () => {
  let mutationRow = fullContextRow({ applied: true });
  const h = harness(query => query.sql.includes("claim_exact_one_video_reconciliation_v1")
    ? { rows: [reconciliationRow()] }
    : { rows: [mutationRow] });
  const claim = await h.repository.claimReconciliation(
    reconciliationContext,
    { workerId: "worker", leaseDurationMs: 1_000 },
  );
  assert.ok(claim);
  const other = harness(() => ({ rows: [] }));
  await assert.rejects(
    other.repository.releaseReconciliationUnknown(reconciliationContext, claim),
    /not issued/u,
  );
  await assert.rejects(
    h.repository.finalizeReconciledNoSubmit(
      reconciliationContext,
      claim,
      negativeFinality({ providerAccountId: ids.attempt }),
    ),
    /does not match/u,
  );
  await assert.rejects(
    h.repository.finalizeReconciliationConfirmed(
      reconciliationContext,
      claim,
      { providerJobId: " ", evidenceDigest: digest("4") },
    ),
    /outcome/u,
  );
  assert.equal(h.calls.length, 1);

  mutationRow = fullContextRow({
    execution_id: ids.otherExecution,
    applied: true,
  });
  await assert.rejects(
    h.repository.releaseReconciliationUnknown(reconciliationContext, claim),
    /another run target/u,
  );
});

test("terminal release and both terminal finalizers bind exact claim/finality and map exact outcomes", async () => {
  let terminalOutcome = "applied";
  const h = harness(query => {
    if (query.sql.includes("claim_exact_one_video_terminal_check_v1")) {
      return { rows: [terminalRow()] };
    }
    if (query.sql.includes("record_exact_one_video_provider_terminal_v1")) {
      return { rows: [fullContextRow({ outcome: terminalOutcome })] };
    }
    return { rows: [fullContextRow({ applied: true })] };
  });
  const claim = await h.repository.claimTerminal(
    terminalContext,
    { workerId: "worker", leaseDurationMs: 2_000 },
  );
  assert.ok(claim);
  assert.equal(await h.repository.releaseTerminalUnknown(
    terminalContext,
    claim,
    {
      reason: "processing",
      observedAt: "2026-07-23T19:00:15.000Z",
      evidenceDigest: digest("4"),
    },
  ), true);
  assert.equal(
    await h.repository.finalizeTerminalCompleted(
      terminalContext,
      claim,
      completedFinality,
    ),
    "applied",
  );
  terminalOutcome = "replayed";
  assert.equal(
    await h.repository.finalizeTerminalFailed(
      terminalContext,
      claim,
      failedFinality,
    ),
    "duplicate",
  );
  terminalOutcome = "conflict";
  assert.equal(
    await h.repository.finalizeTerminalFailed(
      terminalContext,
      claim,
      failedFinality,
    ),
    "conflict",
  );
  terminalOutcome = "rejected";
  assert.equal(
    await h.repository.finalizeTerminalFailed(
      terminalContext,
      claim,
      failedFinality,
    ),
    "conflict",
  );

  assert.match(h.calls[1].sql, /release_exact_one_video_terminal_check_unknown_v1/u);
  assert.match(h.calls[2].sql, /record_exact_one_video_provider_terminal_v1/u);
  for (const call of h.calls) {
    assertFullIdentityBound(call);
    assertFunctionOnly(call);
  }
  for (const call of h.calls.slice(1)) {
    for (const value of [
      ids.terminalCheck,
      ids.terminalLease,
      6n,
    ]) {
      assert.ok(call.params.includes(value), `missing terminal lease value ${String(value)}`);
    }
  }
  for (const call of h.calls.slice(2)) {
    for (const value of [
      ids.attempt,
      4n,
      digest("d"),
      ids.account,
      "heygen",
      1,
      "provider-job-1",
    ]) {
      assert.ok(call.params.includes(value), `missing terminal claim value ${String(value)}`);
    }
  }
  assert.ok(h.calls[1].params.includes("processing"));
  assert.ok(h.calls[1].params.includes(digest("4")));
  assert.ok(h.calls[2].params.includes("completed"));
  assert.ok(h.calls[2].params.includes(completedFinality.remoteArtifactRef));
  assert.ok(h.calls[2].params.includes(completedFinality.ephemeralSourceUrl));
  assert.ok(h.calls[3].params.includes("failed"));
  assert.ok(h.calls[3].params.includes(null));
});

test("terminal mutations reject copied/cross-repository claims, context substitution, and invalid finality", async () => {
  const h = harness(query => query.sql.includes("claim_exact_one_video_terminal_check_v1")
    ? { rows: [terminalRow()] }
    : { rows: [fullContextRow({ applied: true })] });
  const claim = await h.repository.claimTerminal(
    terminalContext,
    { workerId: "worker", leaseDurationMs: 1_000 },
  );
  assert.ok(claim);

  await assert.rejects(
    h.repository.releaseTerminalUnknown(
      terminalContext,
      { ...claim },
      {
        reason: "unknown",
        observedAt: "2026-07-23T19:00:15.000Z",
        evidenceDigest: digest("4"),
      },
    ),
    /not issued/u,
  );
  const other = harness(() => ({ rows: [] }));
  await assert.rejects(
    other.repository.finalizeTerminalCompleted(
      terminalContext,
      claim,
      completedFinality,
    ),
    /not issued/u,
  );
  await assert.rejects(
    h.repository.releaseTerminalUnknown(
      {
        ...terminalContext,
        lease: {
          ...terminalContext.lease,
          executionId: ids.otherExecution,
          leaseToken: ids.reconciliationLease,
          fencingToken: 10n,
        },
      },
      claim,
      {
        reason: "unknown",
        observedAt: "2026-07-23T19:00:15.000Z",
        evidenceDigest: digest("4"),
      },
    ),
    /not issued/u,
  );
  await assert.rejects(
    h.repository.finalizeTerminalFailed(
      { ...terminalContext, commandDigest: digest("9") },
      claim,
      failedFinality,
    ),
    /context/u,
  );
  await assert.rejects(
    h.repository.finalizeTerminalCompleted(
      terminalContext,
      claim,
      {
        ...completedFinality,
        ephemeralSourceUrl: "http://provider.example/video.mp4",
      },
    ),
    /finality/u,
  );
  await assert.rejects(
    h.repository.releaseTerminalUnknown(
      terminalContext,
      claim,
      {
        reason: "processing",
        observedAt: "not-a-date",
        evidenceDigest: digest("4"),
      },
    ),
    /release/u,
  );
  assert.equal(h.calls.length, 1);
});

test("terminal/reconciliation mutation rows fail closed when empty, malformed, multi-row, or substituted", async () => {
  for (const response of [
    { rows: [] },
    { rows: [fullContextRow({ applied: "true" })] },
    { rows: [fullContextRow({ applied: true }), fullContextRow({ applied: true })] },
    { rows: [fullContextRow({ render_job_id: ids.slot, applied: true })] },
  ]) {
    let call = 0;
    const h = harness(() => {
      call += 1;
      return call === 1 ? { rows: [reconciliationRow()] } : response;
    });
    const claim = await h.repository.claimReconciliation(
      reconciliationContext,
      { workerId: "worker", leaseDurationMs: 1_000 },
    );
    assert.ok(claim);
    if ((response.rows as unknown[]).length === 0) {
      assert.equal(
        await h.repository.releaseReconciliationUnknown(reconciliationContext, claim),
        false,
      );
    } else {
      await assert.rejects(
        h.repository.releaseReconciliationUnknown(reconciliationContext, claim),
        /(?:mutation result|function result|another run target)/u,
      );
    }
  }

  for (const response of [
    { rows: [] },
    { rows: [fullContextRow({ outcome: "surprise" })] },
    { rows: [fullContextRow({ outcome: "applied" }), fullContextRow({ outcome: "applied" })] },
    { rows: [fullContextRow({ actor_user_id: "mallory", outcome: "applied" })] },
  ]) {
    let call = 0;
    const h = harness(() => {
      call += 1;
      return call === 1 ? { rows: [terminalRow()] } : response;
    });
    const claim = await h.repository.claimTerminal(
      terminalContext,
      { workerId: "worker", leaseDurationMs: 1_000 },
    );
    assert.ok(claim);
    await assert.rejects(
      h.repository.finalizeTerminalFailed(terminalContext, claim, failedFinality),
      /(?:mutation result|function result|another run target|outcome)/u,
    );
  }
});

test("fabricated structurally valid claim objects cannot reach any exact finalizer", async () => {
  const h = harness(() => ({ rows: [fullContextRow({ applied: true })] }));
  const fakeReconciliation = {
    id: ids.attempt,
    scope,
    budgetReservationId: ids.reservation,
    renderJobId: ids.render,
    providerAccountId: ids.account,
    providerKey: "heygen",
    providerCredentialVersion: 1,
    providerIdempotencyKey: "idem-1",
    avatarExternalResourceId: "avatar-1",
    voiceExternalResourceId: "voice-1",
    sealedRequest: {},
    sealedRequestDigest: digest("c"),
    fencingToken: 4n,
    authorizationDigest: digest("d"),
    commitEvidenceDigest: digest("e"),
    authorizedAt: "2026-07-23T18:00:00.000Z",
    reconciliationLeaseToken: ids.reconciliationLease,
    reconciliationLeaseOwner: "worker",
    reconciliationFencingToken: 5n,
    reconciliationLeaseExpiresAt: "2026-07-23T18:01:00.000Z",
  } satisfies ExactReconciliationClaim;
  const fakeTerminal = {
    terminalCheckId: ids.terminalCheck,
    id: ids.attempt,
    scope,
    budgetReservationId: ids.reservation,
    renderJobId: ids.render,
    providerAccountId: ids.account,
    providerKey: "heygen",
    providerCredentialVersion: 1,
    authorizationDigest: digest("d"),
    fencingToken: 4n,
    providerJobId: "provider-job-1",
    terminalLeaseToken: ids.terminalLease,
    terminalLeaseExpiresAt: "2026-07-23T19:01:00.000Z",
    terminalFencingToken: 6n,
  } satisfies AdmittedTerminalClaim;

  await assert.rejects(
    h.repository.finalizeReconciliationConfirmed(
      reconciliationContext,
      fakeReconciliation,
      { providerJobId: "job-1", evidenceDigest: digest("4") },
    ),
    /not issued/u,
  );
  await assert.rejects(
    h.repository.finalizeTerminalFailed(
      terminalContext,
      fakeTerminal,
      failedFinality,
    ),
    /not issued/u,
  );
  assert.equal(h.calls.length, 0);
  assert.equal(h.transactions(), 0);
});
