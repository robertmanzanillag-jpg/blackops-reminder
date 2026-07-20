import assert from "node:assert/strict";
import test from "node:test";
import { PgDialect } from "drizzle-orm/pg-core";
import { DrizzlePublishingRepository, createPublishingPreview, tenantKey, type TenantScope } from "../server/ai-media-studio/publishing";

const scope: TenantScope = { ownerUserId: "owner-a", workspaceId: "workspace-a" };

class FakeDb {
  readonly queries: Array<{ sql: string; params: unknown[] }> = [];
  constructor(private readonly results: unknown[] = []) {}
  async execute(query: unknown) {
    const compiled = new PgDialect().sqlToQuery(query as never);
    this.queries.push(compiled);
    return this.results.shift() ?? [];
  }
  async transaction<T>(callback: (tx: FakeDb) => Promise<T>): Promise<T> { return callback(this); }
}

function row(overrides: Record<string, unknown> = {}) {
  const preview = createPublishingPreview({ assetId: "00000000-0000-4000-8000-000000000001", assetDigest: "asset-digest", caption: "caption", hashtags: [], platform: "instagram" });
  return {
    id: "00000000-0000-4000-8000-000000000010", owner_user_id: scope.ownerUserId, workspace_id: scope.workspaceId,
    status: "pending_approval", approval_status: "required", idempotency_key: "idem", attempts: 0, max_attempts: 3,
    available_at: new Date("2030-01-01T00:00:00Z"), created_at: new Date("2030-01-01T00:00:00Z"), updated_at: new Date("2030-01-01T00:00:00Z"),
    request: { preview, __publishing: { leaseRecoveries: 2, maxLeaseRecoveries: 5 } }, ...overrides,
  };
}

test("Drizzle create validates tenant ownership and persists media_asset_id with null video_id", async () => {
  const deniedDb = new FakeDb();
  const denied = new DrizzlePublishingRepository(deniedDb as never, async () => { throw new Error("asset is not owned by tenant"); });
  const input = {
    id: "00000000-0000-4000-8000-000000000010", scope,
    preview: createPublishingPreview({ assetId: "00000000-0000-4000-8000-000000000001", assetDigest: "digest", caption: "", hashtags: [], platform: "instagram" }),
    idempotencyKey: "idem", maxAttempts: 3, maxLeaseRecoveries: 2, now: "2030-01-01T00:00:00.000Z",
  };
  await assert.rejects(denied.create(input), /not owned/);
  assert.equal(deniedDb.queries.length, 0, "ownership denial happens before persistence");

  let resolved: { scope: TenantScope; id: string } | undefined;
  const db = new FakeDb([[row()]]);
  await new DrizzlePublishingRepository(db as never, async (tenant, id) => { resolved = { scope: tenant, id }; }).create(input);
  assert.deepEqual(resolved, { scope, id: input.preview.assetId });
  const query = db.queries[0]; assert.ok(query);
  assert.match(query.sql, /video_id, media_asset_id/);
  const normalizedSql = query.sql.toLowerCase();
  const videoPosition = normalizedSql.indexOf("video_id");
  const valuesPosition = normalizedSql.indexOf("values");
  assert.ok(videoPosition >= 0 && valuesPosition > videoPosition);
  assert.match(normalizedSql.slice(valuesPosition), /\$1, \$2, \$3, null, \$4/i, "video_id is NULL and media_asset_id is the asset parameter");
  assert.ok(query.params.includes(input.preview.assetId));
  assert.ok(query.params.includes(scope.ownerUserId));
  assert.ok(query.params.includes(scope.workspaceId));
});

test("Drizzle create rejects past/equal scheduled drafts before ownership or SQL and persists a future draft", async () => {
  const now = "2030-01-02T20:00:00.000Z";
  const record = (scheduledFor: string) => ({
    id: "00000000-0000-4000-8000-000000000010", scope,
    preview: createPublishingPreview({
      assetId: "00000000-0000-4000-8000-000000000001", assetDigest: "digest", caption: "scheduled",
      hashtags: [], platform: "instagram" as const, scheduledFor, timezone: "America/New_York",
    }),
    idempotencyKey: `idem-${scheduledFor}`, maxAttempts: 3, maxLeaseRecoveries: 2, now,
  });
  for (const scheduledFor of ["2030-01-02T19:59:59.999Z", now]) {
    let ownershipChecks = 0;
    const db = new FakeDb();
    const repository = new DrizzlePublishingRepository(db as never, async () => { ownershipChecks += 1; });
    await assert.rejects(repository.create(record(scheduledFor)), /strictly in the future/);
    assert.equal(ownershipChecks, 0);
    assert.equal(db.queries.length, 0);
  }

  const future = record("2030-01-02T20:00:00.001Z");
  const futureRow = row({ request: { preview: future.preview, __publishing: { leaseRecoveries: 0, maxLeaseRecoveries: 2 } } });
  const futureDb = new FakeDb([[futureRow]]);
  await new DrizzlePublishingRepository(futureDb as never, async () => {}).create(future);
  assert.equal(futureDb.queries.length, 1);
  assert.match(futureDb.queries[0]!.sql, /insert into .*ai_media_publishing_jobs/i);
});

test("Drizzle approval SQL atomically queues unscheduled previews", async () => {
  const approved = row({ status: "queued", approval_status: "approved", approval_evidence: { decision: "approved", method: "manual", approvedByUserId: "owner-a", approvedAt: "2030-01-01T00:00:00.000Z", previewDigest: (row().request as any).preview.digest } });
  const db = new FakeDb([[approved]]);
  const repository = new DrizzlePublishingRepository(db as never, async () => {});
  await repository.approve(scope, String(approved.id), approved.approval_evidence as never, "2030-01-01T00:00:00.000Z");
  const query = db.queries[0]; assert.ok(query);
  assert.match(query.sql, /case when request->'preview'->>'scheduledFor' is null then 'queued'/i);
  assert.match(query.sql, /approval_status = 'required'/i);
  assert.match(query.sql, /owner_user_id =/i);
  assert.match(query.sql, /workspace_id =/i);
});

test("Drizzle scheduled approval persists evidence and schedule in one atomic transition and safely replays", async () => {
  const preview = createPublishingPreview({
    assetId: "00000000-0000-4000-8000-000000000001", assetDigest: "asset-digest", caption: "caption",
    hashtags: [], platform: "instagram", scheduledFor: "2030-01-02T20:00:00.000Z", timezone: "America/New_York",
  });
  const evidence = { decision: "approved", method: "manual", approvedByUserId: "owner-a", approvedAt: "2030-01-01T00:00:00.000Z", previewDigest: preview.digest } as const;
  const schedule = { scheduledFor: "2030-01-02T20:00:00.000Z", timezone: "America/New_York" };
  const scheduled = row({ status: "scheduled", approval_status: "approved", approval_evidence: evidence, request: { preview, schedule, __publishing: { leaseRecoveries: 0, maxLeaseRecoveries: 5 } } });
  const db = new FakeDb([[scheduled]]);
  const repository = new DrizzlePublishingRepository(db as never, async () => {});
  assert.equal((await repository.approveScheduled(scope, String(scheduled.id), evidence, schedule, evidence.approvedAt)).state, "scheduled");
  const query = db.queries[0]; assert.ok(query);
  assert.match(query.sql, /set approval_status = 'approved'.*status = 'scheduled'/i);
  assert.match(query.sql, /jsonb_set\(request, '\{schedule\}'/i);
  assert.match(query.sql, /preview_digest =/i);
  assert.match(query.sql, /request->'preview'->>'scheduledFor' =/i);
  assert.match(query.sql, /::timestamptz > .*::timestamptz/i, "the atomic transition uses a strict typed future comparison");
  assert.match(query.sql, /owner_user_id =/i);
  assert.match(query.sql, /workspace_id =/i);

  const replayDb = new FakeDb([[], [scheduled]]);
  const replay = await new DrizzlePublishingRepository(replayDb as never, async () => {}).approveScheduled(scope, String(scheduled.id), { ...evidence, approvedAt: "2030-01-01T00:01:00.000Z" }, schedule, "2030-01-01T00:01:00.000Z");
  assert.equal(replay.approval?.approvedAt, evidence.approvedAt);
  assert.equal(replayDb.queries.length, 2, "a lost response is recovered by reading the committed transition");
});

test("Drizzle scheduled approval rejects past/equal transitions, accepts future, and replays after due time", async () => {
  const scheduledFor = "2030-01-02T20:00:00.000Z";
  const preview = createPublishingPreview({
    assetId: "00000000-0000-4000-8000-000000000001", assetDigest: "asset-digest", caption: "caption",
    hashtags: [], platform: "instagram", scheduledFor, timezone: "America/New_York",
  });
  const schedule = { scheduledFor, timezone: "America/New_York" };
  const evidence = { decision: "approved", method: "manual", approvedByUserId: "owner-a", approvedAt: "2030-01-02T19:59:59.999Z", previewDigest: preview.digest } as const;
  const pending = row({ request: { preview, __publishing: { leaseRecoveries: 0, maxLeaseRecoveries: 5 } } });

  for (const now of ["2030-01-02T20:00:00.000Z", "2030-01-02T20:00:00.001Z"]) {
    const db = new FakeDb([[], [pending]]);
    await assert.rejects(
      new DrizzlePublishingRepository(db as never, async () => {}).approveScheduled(scope, String(pending.id), evidence, schedule, now),
      /stale, invalid/,
    );
    const mutation = db.queries[0]; assert.ok(mutation);
    assert.match(mutation.sql, /::timestamptz > .*::timestamptz/i);
    assert.ok(mutation.params.some((value) => value instanceof Date && value.toISOString() === scheduledFor));
    assert.ok(mutation.params.some((value) => value instanceof Date && value.toISOString() === now));
  }

  const committed = row({
    status: "scheduled", approval_status: "approved", approval_evidence: evidence,
    request: { preview, schedule, __publishing: { leaseRecoveries: 0, maxLeaseRecoveries: 5 } },
  });
  const futureDb = new FakeDb([[committed]]);
  assert.equal((await new DrizzlePublishingRepository(futureDb as never, async () => {}).approveScheduled(
    scope, String(committed.id), evidence, schedule, "2030-01-02T19:59:59.999Z",
  )).state, "scheduled");

  const replayDb = new FakeDb([[], [committed]]);
  const replay = await new DrizzlePublishingRepository(replayDb as never, async () => {}).approveScheduled(
    scope, String(committed.id), { ...evidence, approvedAt: "2030-01-02T20:00:01.000Z" }, schedule, "2030-01-02T20:00:01.000Z",
  );
  assert.equal(replay.approval?.approvedAt, evidence.approvedAt);
});

test("Drizzle claims structured tenant scopes with separate column predicates", async () => {
  const db = new FakeDb([[]]);
  const repository = new DrizzlePublishingRepository(db as never, async () => {});
  const ambiguousA = { workspaceId: "workspace:a", ownerUserId: "owner" };
  const ambiguousB = { workspaceId: "workspace", ownerUserId: "a:owner" };
  await repository.claimDue({ workerId: "worker", now: "2030-01-01T00:00:00.000Z", leaseDurationMs: 1_000, enabledTenantKeys: new Set([tenantKey(ambiguousA), tenantKey(ambiguousB)]) });
  const query = db.queries[0]; assert.ok(query);
  assert.doesNotMatch(query.sql, /workspace_id \|\|/i);
  assert.match(query.sql, /\(workspace_id = .* and owner_user_id = .*\) or \(workspace_id = .* and owner_user_id = .*\)/i);
  assert.ok(query.params.includes("workspace:a"));
  assert.ok(query.params.includes("a:owner"));
});

test("fenced submission SQL preserves existing publishing metadata while removing the lease token", async () => {
  const submitted = row({
    status: "publishing", approval_status: "approved", attempts: 1,
    request: { ...(row().request as object), __publishing: { leaseRecoveries: 2, maxLeaseRecoveries: 5, providerSubmissionId: "private", providerIdempotencyKey: "provider-key", submittedAt: "2030-01-01T00:00:00.000Z" } },
  });
  const db = new FakeDb([[submitted]]);
  const repository = new DrizzlePublishingRepository(db as never, async () => {});
  const result = await repository.markSubmitted({ scope, publicationId: String(submitted.id), leaseToken: "fence", providerSubmissionId: "private", idempotencyKey: "provider-key", now: "2030-01-01T00:00:00.000Z" });
  assert.equal(result?.leaseRecoveries, 2);
  assert.equal(result?.maxLeaseRecoveries, 5);
  const query = db.queries[0]; assert.ok(query);
  assert.match(query.sql, /jsonb_set\(request #- '\{__publishing,leaseToken\}'/i);
  assert.match(query.sql, /coalesce\(\(request #- '\{__publishing,leaseToken\}'\)->'__publishing'/i);
  assert.match(query.sql, /status = 'publishing'/i);
  assert.match(query.sql, /owner_user_id =/i);
  assert.match(query.sql, /workspace_id =/i);
  assert.match(query.sql, /lease_expires_at >/i);
});

test("Drizzle reject is tenant-scoped, digest-bound, and terminal", async () => {
  const preview = (row().request as any).preview;
  const rejectedEvidence = { decision: "rejected", method: "manual", rejectedByUserId: "owner-a", rejectedAt: "2030-01-01T00:00:00.000Z", previewDigest: preview.digest, reason: "Not approved" } as const;
  const db = new FakeDb([[row({ status: "cancelled", approval_status: "rejected", approval_evidence: rejectedEvidence })]]);
  const repository = new DrizzlePublishingRepository(db as never, async () => {});
  const result = await repository.reject(scope, String(row().id), rejectedEvidence, rejectedEvidence.rejectedAt);
  assert.equal(result.state, "rejected");
  const query = db.queries[0]; assert.ok(query);
  assert.match(query.sql, /status = 'cancelled'/i);
  assert.match(query.sql, /approval_status in \('required', 'approved'\)/i);
  assert.match(query.sql, /preview_digest =/i);
  assert.match(query.sql, /owner_user_id =/i);
  assert.match(query.sql, /workspace_id =/i);
});

test("Drizzle retry clears failure and lease state but requires prior approval and failure", async () => {
  const preview = (row().request as any).preview;
  const approval = { decision: "approved", method: "manual", approvedByUserId: "owner-a", approvedAt: "2030-01-01T00:00:00.000Z", previewDigest: preview.digest };
  const failed = row({ status: "dead_letter", approval_status: "approved", approval_evidence: approval, attempts: 4, error_message: "failed", dead_letter_at: new Date("2030-01-01T00:00:00Z") });
  const queued = row({ status: "queued", approval_status: "approved", approval_evidence: approval, attempts: 4, error_message: null, dead_letter_at: null });
  const db = new FakeDb([[failed], [queued]]);
  const repository = new DrizzlePublishingRepository(db as never, async () => {});
  const result = await repository.retry(scope, String(failed.id), "2030-01-02T00:00:00.000Z");
  assert.equal(result.state, "queued");
  const update = db.queries[1]; assert.ok(update);
  assert.match(update.sql, /approval_status = 'approved'/i);
  assert.match(update.sql, /status in \('failed', 'dead_letter'\)/i);
  assert.match(update.sql, /lease_owner = null/i);
  assert.match(update.sql, /error_message = null/i);
  assert.match(update.sql, /dead_letter_at = null/i);
  assert.match(update.sql, /owner_user_id =/i);
  assert.match(update.sql, /workspace_id =/i);
});

test("Drizzle reconciliation failure is tenant/provider fenced and schedules a bounded retry", async () => {
  const preview = (row().request as any).preview;
  const approval = { decision: "approved", method: "manual", approvedByUserId: "owner-a", approvedAt: "2030-01-01T00:00:00.000Z", previewDigest: preview.digest };
  const metadata = { leaseRecoveries: 1, maxLeaseRecoveries: 5, providerSubmissionId: "provider-ref", providerIdempotencyKey: "stable-provider-key", submittedAt: "2030-01-01T00:00:00.000Z" };
  const submitted = row({ status: "publishing", approval_status: "approved", approval_evidence: approval, attempts: 1, request: { preview, __publishing: metadata } });
  const retrying = row({ status: "queued", approval_status: "approved", approval_evidence: approval, attempts: 1, error_message: "provider failed", request: { preview, __publishing: { leaseRecoveries: 1, maxLeaseRecoveries: 5, providerIdempotencyKey: "stable-provider-key" } } });
  const db = new FakeDb([[submitted], [retrying]]);
  const repository = new DrizzlePublishingRepository(db as never, async () => {});
  const result = await repository.recordReconciliationFailure({ scope, publicationId: String(submitted.id), providerSubmissionId: "provider-ref", expectedAttempt: 1, error: "provider failed", retryAt: "2030-01-01T00:01:00.000Z", now: "2030-01-01T00:00:01.000Z" });
  assert.equal(result?.state, "retry_wait");
  const update = db.queries[1]; assert.ok(update);
  assert.match(update.sql, /providerSubmissionId/i);
  assert.match(update.sql, /lease_owner is null/i);
  assert.match(update.sql, /owner_user_id =/i);
  assert.match(update.sql, /workspace_id =/i);
  assert.match(update.sql, /attempts =/i);
  assert.match(update.sql, /dead_letter/i);
  assert.ok(update.params.includes("provider-ref"));
  assert.ok(update.params.includes("provider failed"));
});
