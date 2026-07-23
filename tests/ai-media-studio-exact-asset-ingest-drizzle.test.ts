import assert from "node:assert/strict";
import test from "node:test";
import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import {
  DrizzleExactAssetIngestRepository,
  type ExactAssetIngestDatabase,
  type ExactAssetIngestTransactionalDatabase,
} from "../server/ai-media-studio/assets/drizzle-exact-asset-ingest-repository";
import type {
  ExactOneVideoRunLease,
  ExactOneVideoStageContext,
} from "../server/ai-media-studio/workers/one-video-run-once-executor";

const digest = (digit: string) => `sha256:${digit.repeat(64)}` as const;
const sha = (digit: string) => digit.repeat(64);
const ids = {
  execution: "10000000-0000-4000-8000-000000000001",
  runLease: "20000000-0000-4000-8000-000000000002",
  reservation: "30000000-0000-4000-8000-000000000003",
  render: "40000000-0000-4000-8000-000000000004",
  slot: "50000000-0000-4000-8000-000000000005",
  ingest: "60000000-0000-4000-8000-000000000006",
  ingestLease: "70000000-0000-4000-8000-000000000007",
  mediaAsset: "80000000-0000-4000-8000-000000000008",
  otherExecution: "90000000-0000-4000-8000-000000000009",
} as const;
const scope = { ownerUserId: "owner-1", workspaceId: "workspace-1" } as const;
const baseContext = {
  actorUserId: "robert",
  commandId: "command-asset-1",
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
    commandId: "command-asset-1",
    commandDigest: digest("a"),
    fencingToken: 9n,
    leaseToken: ids.runLease,
  } as ExactOneVideoRunLease,
} as const;
const ingestContext: ExactOneVideoStageContext = {
  ...baseContext,
  action: "ingest_asset",
};
const linkContext: ExactOneVideoStageContext = {
  ...baseContext,
  action: "link_asset",
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
  const db: ExactAssetIngestTransactionalDatabase = {
    execute,
    async transaction<T>(
      callback: (tx: ExactAssetIngestDatabase) => Promise<T>,
    ) {
      transactions += 1;
      return callback({ execute });
    },
  };
  return {
    calls,
    transactions: () => transactions,
    repository: new DrizzleExactAssetIngestRepository(db, scope),
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

function ingestRow(overrides: Record<string, unknown> = {}) {
  return fullContextRow({
    claim_outcome: "claimed",
    ingest_job_id: ids.ingest,
    provider_key: "heygen",
    remote_artifact_ref: "heygen:account/provider-job-1",
    source_url: "https://provider.example/video.mp4?sig=temporary",
    expected_mime_type: "video/mp4",
    attempt: 1,
    max_attempts: 3,
    lease_owner: "asset-worker-1",
    lease_token: ids.ingestLease,
    lease_expires_at: new Date("2026-07-23T20:01:00.000Z"),
    fencing_token: "4",
    ...overrides,
  });
}

function linkRow(overrides: Record<string, unknown> = {}) {
  return fullContextRow({
    ingest_job_id: ids.ingest,
    link_state: "completed_unlinked",
    media_asset_id: null,
    owned_object_key: "ai-media/owner-1/workspace-1/video.mp4",
    sha256: sha("c"),
    size_bytes: "4096",
    expected_mime_type: "video/mp4",
    ingest_fencing_token: "4",
    ingest_created_at: new Date("2026-07-23T19:55:00.000Z"),
    ingest_updated_at: new Date("2026-07-23T20:00:00.000Z"),
    ...overrides,
  });
}

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
  assert.doesNotMatch(call.sql, /\b(?:ORDER BY|SKIP LOCKED|LIMIT)\b/iu);
  assert.doesNotMatch(call.sql, /claim_due|list_completed_unlinked/iu);
}

test("exact ingest and link claims bind explicit jobs plus the immutable full context", async () => {
  const h = harness(query => query.sql.includes("claim_exact")
    ? { rows: [ingestRow()] }
    : { rows: [linkRow()] });

  const ingestResult = await h.repository.claimExactIngest(ingestContext, {
    ingestJobId: ids.ingest,
    workerId: "asset-worker-1",
    leaseDurationMs: 60_000,
  });
  const link = await h.repository.loadExactLink(linkContext, {
    ingestJobId: ids.ingest,
  });

  assert.equal(ingestResult.kind, "claimed");
  assert.ok(ingestResult.kind === "claimed");
  const ingest = ingestResult.claim;
  assert.ok(link);
  assert.equal(ingest.ingestJobId, ids.ingest);
  assert.equal(ingest.providerKey, "heygen");
  assert.equal(ingest.fencingToken, 4n);
  assert.equal(link.ingestJobId, ids.ingest);
  assert.equal(link.ingestFencingToken, 4n);
  assert.equal(link.sizeBytes, 4096);
  assert.equal(link.createdAt, "2026-07-23T19:55:00.000Z");
  assert.equal(link.updatedAt, "2026-07-23T20:00:00.000Z");
  assert.equal(Object.isFrozen(ingest), true);
  assert.equal(Object.isFrozen(link), true);
  assert.equal(h.transactions(), 2);
  assert.match(h.calls[0].sql, /claim_exact_one_video_asset_ingest_v1/u);
  assert.match(h.calls[1].sql, /load_exact_one_video_asset_link_v1/u);
  for (const call of h.calls) {
    assertFullIdentityBound(call);
    assertFunctionOnly(call);
    assert.ok(call.params.includes(ids.ingest));
  }
  assert.ok(h.calls[0].params.includes("asset-worker-1"));
  assert.ok(h.calls[0].params.includes(60_000));
});

test("claim/load reject zero, multiple, malformed, and substituted rows", async () => {
  for (const rows of [
    [],
    [ingestRow(), ingestRow()],
    ["not-a-row"],
  ]) {
    const h = harness(() => ({ rows }));
    await assert.rejects(
      h.repository.claimExactIngest(ingestContext, {
        ingestJobId: ids.ingest,
        workerId: "worker",
        leaseDurationMs: 1_000,
      }),
      /function result/u,
    );
  }
  const emptyLink = harness(() => ({ rows: [] }));
  assert.equal(await emptyLink.repository.loadExactLink(linkContext, {
    ingestJobId: ids.ingest,
  }), undefined);
  for (const rows of [[linkRow(), linkRow()], ["not-a-row"]]) {
    const h = harness(() => ({ rows }));
    await assert.rejects(
      h.repository.loadExactLink(linkContext, { ingestJobId: ids.ingest }),
      /function result/u,
    );
  }
  for (const outcome of ["idle", "dead_letter"] as const) {
    const h = harness(() => ({
      rows: [ingestRow({
        claim_outcome: outcome,
        lease_owner: null,
        lease_token: null,
        lease_expires_at: null,
      })],
    }));
    assert.deepEqual(await h.repository.claimExactIngest(ingestContext, {
      ingestJobId: ids.ingest,
      workerId: "worker",
      leaseDurationMs: 1_000,
    }), { kind: outcome, ingestJobId: ids.ingest });
  }
  for (const row of [
    ingestRow({ execution_id: ids.otherExecution }),
    ingestRow({ actor_user_id: "mallory" }),
    ingestRow({ workspace_id: "other-workspace" }),
    ingestRow({ budget_reservation_id: ids.render }),
    ingestRow({ run_fencing_token: "10" }),
  ]) {
    const h = harness(() => ({ rows: [row] }));
    await assert.rejects(
      h.repository.claimExactIngest(ingestContext, {
        ingestJobId: ids.ingest,
        workerId: "worker",
        leaseDurationMs: 1_000,
      }),
      /another run target/u,
    );
  }
});

test("claims reject malformed asset, lease, checksum, size, URL, MIME, and attempt fields", async () => {
  for (const row of [
    ingestRow({ ingest_job_id: "bad" }),
    ingestRow({ source_url: "http://provider.example/video.mp4" }),
    ingestRow({ expected_mime_type: "text/html" }),
    ingestRow({ remote_artifact_ref: "" }),
    ingestRow({ attempt: 4, max_attempts: 3 }),
    ingestRow({ lease_token: "bad" }),
    ingestRow({ fencing_token: "0" }),
  ]) {
    const h = harness(() => ({ rows: [row] }));
    await assert.rejects(
      h.repository.claimExactIngest(ingestContext, {
        ingestJobId: ids.ingest,
        workerId: "worker",
        leaseDurationMs: 1_000,
      }),
    );
  }
  for (const row of [
    linkRow({ owned_object_key: "../escape.mp4" }),
    linkRow({ sha256: digest("c") }),
    linkRow({ size_bytes: "0" }),
    linkRow({ ingest_fencing_token: "0" }),
  ]) {
    const h = harness(() => ({ rows: [row] }));
    await assert.rejects(
      h.repository.loadExactLink(linkContext, { ingestJobId: ids.ingest }),
    );
  }
});

test("complete and fail require the issued ingest claim and bind its exact fence", async () => {
  const h = harness(query => {
    if (query.sql.includes("claim_exact")) return { rows: [ingestRow()] };
    if (query.sql.includes("_failed_v1")) {
      return {
        rows: [fullContextRow({
          applied: true,
          ingest_job_id: ids.ingest,
          state: "retry_wait",
        })],
      };
    }
    return {
      rows: [fullContextRow({ applied: true, ingest_job_id: ids.ingest })],
    };
  });
  const claimResult = await h.repository.claimExactIngest(ingestContext, {
    ingestJobId: ids.ingest,
    workerId: "asset-worker-1",
    leaseDurationMs: 2_000,
  });
  assert.equal(claimResult.kind, "claimed");
  assert.ok(claimResult.kind === "claimed");
  const claim = claimResult.claim;

  await assert.rejects(
    h.repository.completeExactIngest(ingestContext, { ...claim }, {
      ownedObjectKey: "ai-media/owner-1/workspace-1/video.mp4",
      sha256: sha("d"),
      sizeBytes: 8192,
    }),
    /not issued/u,
  );
  assert.equal(h.calls.length, 1);

  assert.equal(await h.repository.completeExactIngest(ingestContext, claim, {
    ownedObjectKey: "ai-media/owner-1/workspace-1/video.mp4",
    sha256: sha("d"),
    sizeBytes: 8192,
  }), true);
  assert.deepEqual(await h.repository.failExactIngest(ingestContext, claim, {
    errorCode: "source_unavailable",
    retryable: true,
    retryAt: "2026-07-23T20:02:00.000Z",
  }), { applied: true, state: "retry_wait" });

  assert.match(h.calls[1].sql, /record_exact_one_video_asset_ingest_completed_v1/u);
  assert.match(h.calls[2].sql, /record_exact_one_video_asset_ingest_failed_v1/u);
  assert.match(h.calls[1].sql, /\$14::text/u);
  assert.match(h.calls[2].sql, /\$14::text/u);
  for (const call of h.calls) {
    assertFullIdentityBound(call);
    assertFunctionOnly(call);
  }
  for (const call of h.calls.slice(1)) {
    assert.ok(call.params.includes(ids.ingest));
    assert.ok(call.params.includes(ids.ingestLease));
    assert.ok(call.params.includes(4n));
  }
  for (const value of [
    "ai-media/owner-1/workspace-1/video.mp4",
    sha("d"),
    8192,
  ]) assert.ok(h.calls[1].params.includes(value));
  for (const value of [
    "source_unavailable",
    true,
  ]) assert.ok(h.calls[2].params.includes(value));
});

test("ingest mutations reject context substitution, invalid outcomes, and malformed results before success", async () => {
  let mutationRow = fullContextRow({
    applied: true,
    ingest_job_id: ids.ingest,
  });
  const h = harness(query => query.sql.includes("claim_exact")
    ? { rows: [ingestRow()] }
    : { rows: [mutationRow] });
  const claimResult = await h.repository.claimExactIngest(ingestContext, {
    ingestJobId: ids.ingest,
    workerId: "worker",
    leaseDurationMs: 1_000,
  });
  assert.equal(claimResult.kind, "claimed");
  assert.ok(claimResult.kind === "claimed");
  const claim = claimResult.claim;

  await assert.rejects(
    h.repository.completeExactIngest(
      { ...ingestContext, actorUserId: "mallory" },
      claim,
      { ownedObjectKey: "ai-media/video.mp4", sha256: sha("d"), sizeBytes: 1 },
    ),
    /not issued/u,
  );
  await assert.rejects(
    h.repository.completeExactIngest(ingestContext, claim, {
      ownedObjectKey: "../video.mp4",
      sha256: sha("d"),
      sizeBytes: 1,
    }),
    /owned_object_key/u,
  );
  await assert.rejects(
    h.repository.completeExactIngest(ingestContext, claim, {
      ownedObjectKey: "ai-media/video.mp4",
      sha256: digest("d"),
      sizeBytes: 1,
    }),
    /sha256/u,
  );
  await assert.rejects(
    h.repository.failExactIngest(ingestContext, claim, {
      errorCode: "unknown" as "ingest_failed",
      retryable: true,
      retryAt: "not-a-date",
    }),
    /failure/u,
  );
  assert.equal(h.calls.length, 1);

  mutationRow = fullContextRow({
    execution_id: ids.otherExecution,
    applied: true,
    ingest_job_id: ids.ingest,
  });
  await assert.rejects(
    h.repository.completeExactIngest(ingestContext, claim, {
      ownedObjectKey: "ai-media/video.mp4",
      sha256: sha("d"),
      sizeBytes: 1,
    }),
    /another run target/u,
  );
});

test("link record requires its uncopyable claim and binds checksum, object key, fence, and asset", async () => {
  let recordResult = fullContextRow({
    applied: true,
    ingest_job_id: ids.ingest,
    media_asset_id: ids.mediaAsset,
  });
  const h = harness(query => query.sql.includes("load_exact")
    ? { rows: [linkRow()] }
    : {
      rows: [recordResult],
    });
  const claim = await h.repository.loadExactLink(linkContext, {
    ingestJobId: ids.ingest,
  });
  assert.ok(claim);

  await assert.rejects(
    h.repository.recordExactLink(linkContext, { ...claim }, {
      mediaAssetId: ids.mediaAsset,
    }),
    /not issued/u,
  );
  const other = harness(() => ({
    rows: [fullContextRow({
      applied: true,
      ingest_job_id: ids.ingest,
      media_asset_id: ids.mediaAsset,
    })],
  }));
  await assert.rejects(
    other.repository.recordExactLink(linkContext, claim, {
      mediaAssetId: ids.mediaAsset,
    }),
    /not issued/u,
  );
  await assert.rejects(
    h.repository.recordExactLink(linkContext, claim, { mediaAssetId: "bad" }),
    /mediaAssetId/u,
  );
  assert.equal(h.calls.length, 1);

  recordResult = fullContextRow({
    applied: false,
    ingest_job_id: ids.ingest,
    media_asset_id: null,
  });
  assert.equal(await h.repository.recordExactLink(linkContext, claim, {
    mediaAssetId: ids.mediaAsset,
  }), false);

  recordResult = fullContextRow({
    applied: true,
    ingest_job_id: ids.ingest,
    media_asset_id: ids.mediaAsset,
  });
  assert.equal(await h.repository.recordExactLink(linkContext, claim, {
    mediaAssetId: ids.mediaAsset,
  }), true);
  assert.match(h.calls[2].sql, /record_exact_one_video_asset_linked_v1/u);
  assertFullIdentityBound(h.calls[2]);
  assertFunctionOnly(h.calls[2]);
  for (const value of [
    ids.ingest,
    4n,
    "ai-media/owner-1/workspace-1/video.mp4",
    sha("c"),
    ids.mediaAsset,
  ]) assert.ok(h.calls[2].params.includes(value));
});

test("all methods validate action/scope/lease and every database result is commit-aware", async () => {
  const h = harness(() => ({ rows: [ingestRow()] }));
  await assert.rejects(
    h.repository.claimExactIngest(linkContext, {
      ingestJobId: ids.ingest,
      workerId: "worker",
      leaseDurationMs: 1_000,
    }),
    /Invalid ingest_asset/u,
  );
  await assert.rejects(
    h.repository.claimExactIngest({
      ...ingestContext,
      target: {
        ...ingestContext.target,
        scope: { ...scope, workspaceId: "other-workspace" },
      },
    }, {
      ingestJobId: ids.ingest,
      workerId: "worker",
      leaseDurationMs: 1_000,
    }),
    /Invalid ingest_asset/u,
  );
  await assert.rejects(
    h.repository.claimExactIngest(ingestContext, {
      ingestJobId: ids.ingest,
      workerId: "bad worker",
      leaseDurationMs: 1_000,
    }),
    /lease/u,
  );
  await assert.rejects(
    h.repository.claimExactIngest(ingestContext, {
      ingestJobId: ids.ingest,
      workerId: "worker",
      leaseDurationMs: 300_001,
    }),
    /lease/u,
  );
  assert.equal(h.calls.length, 0);

  const commitFailure: ExactAssetIngestTransactionalDatabase = {
    async execute() {
      throw new Error("must execute inside transaction");
    },
    async transaction<T>(
      callback: (tx: ExactAssetIngestDatabase) => Promise<T>,
    ): Promise<T> {
      await callback({ execute: async () => ({ rows: [ingestRow()] }) });
      throw new Error("commit failed");
    },
  };
  const repository = new DrizzleExactAssetIngestRepository(commitFailure, scope);
  await assert.rejects(
    repository.claimExactIngest(ingestContext, {
      ingestJobId: ids.ingest,
      workerId: "worker",
      leaseDurationMs: 1_000,
    }),
    /commit failed/u,
  );
});
