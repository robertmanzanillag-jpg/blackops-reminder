import assert from "node:assert/strict";
import test from "node:test";
import {
  FakePublishingProvider,
  InMemoryPublishingRepository,
  PublishingInvariantError,
  PublishingPolicyDeniedError,
  PublishingReconciler,
  PublishingScheduler,
  PublishingService,
  PublishingWorker,
  automaticPublishingAllowed,
  createPublishingPreview,
  providerPublishIdempotencyKey,
  tenantKey,
  toPublicPublication,
  type PublicationJob,
  type PublishingProvider,
  type TenantScope,
} from "../server/ai-media-studio/publishing";

class Clock {
  constructor(public value: number) {}
  now() { return this.value; }
  advance(ms: number) { this.value += ms; }
}

const scopeA: TenantScope = { ownerUserId: "owner-a", workspaceId: "workspace" };
const scopeB: TenantScope = { ownerUserId: "owner-b", workspaceId: "workspace" };
const dueAt = "2030-01-02T15:00:00-05:00";

async function scheduledFixture(options: { scope?: TenantScope; clock?: Clock; repository?: InMemoryPublishingRepository; requestKey?: string } = {}) {
  const scope = options.scope ?? scopeA;
  const clock = options.clock ?? new Clock(Date.parse("2030-01-02T19:59:00Z"));
  const repository = options.repository ?? new InMemoryPublishingRepository();
  const service = new PublishingService(repository, clock);
  const draft = await service.createDraft(scope, {
    assetId: "00000000-0000-4000-8000-000000000001",
    assetDigest: "asset-sha256",
    caption: "A provider-neutral caption",
    title: "Immutable title",
    hashtags: ["#studio", "safe"],
    platform: "tiktok",
    scheduledFor: dueAt,
    timezone: "America/New_York",
  }, options.requestKey ?? "request-1");
  await service.approve(scope, draft.id, { approvedByUserId: scope.ownerUserId, previewDigest: draft.preview.digest, note: "Reviewed in preview UI" });
  await service.schedule(scope, draft.id, dueAt, "America/New_York");
  return { scope, clock, repository, service, draft, job: await repository.get(scope, draft.id) as PublicationJob };
}

function worker(fixture: Awaited<ReturnType<typeof scheduledFixture>>, provider: PublishingProvider, overrides: Partial<ConstructorParameters<typeof PublishingWorker>[0]> = {}) {
  return new PublishingWorker({
    workerId: "publisher-1", repository: fixture.repository, providers: [provider], leaseDurationMs: 1_000,
    policy: { automaticPublishingEnabled: true, enabledTenantKeys: new Set([tenantKey(fixture.scope)]) },
    retry: { baseDelayMs: 100, maxDelayMs: 1_000, jitterRatio: 0 }, clock: fixture.clock, random: () => 0.5, ...overrides,
  });
}

test("drafts default to pending approval and their immutable digest binds all publishable fields", async () => {
  const fixture = await scheduledFixture();
  assert.equal(fixture.draft.state, "pending_approval");
  assert.match(fixture.draft.preview.digest, /^sha256:[a-f0-9]{64}$/);
  assert.equal(createPublishingPreview({ ...fixture.draft.preview, caption: "changed" }).digest === fixture.draft.preview.digest, false);
  assert.notEqual(createPublishingPreview({ ...fixture.draft.preview, title: "Changed title" }).digest, fixture.draft.preview.digest);
  const stored = await fixture.repository.get(scopeA, fixture.draft.id);
  assert.equal(stored?.approval?.method, "manual");
  assert.equal(stored?.approval?.previewDigest, stored?.preview.digest);
});

test("approval with stale preview evidence and schedule mutation are rejected", async () => {
  const clock = new Clock(Date.parse("2030-01-02T19:59:00Z"));
  const repository = new InMemoryPublishingRepository();
  const service = new PublishingService(repository, clock);
  const draft = await service.createDraft(scopeA, { assetId: "asset", assetDigest: "digest", caption: "caption", hashtags: [], platform: "instagram", scheduledFor: dueAt, timezone: "America/New_York" }, "approval-check");
  await assert.rejects(service.approve(scopeA, draft.id, { approvedByUserId: "owner-a", previewDigest: "sha256:" + "0".repeat(64) }), PublishingInvariantError);
  await service.approve(scopeA, draft.id, { approvedByUserId: "owner-a", previewDigest: draft.preview.digest });
  await assert.rejects(service.schedule(scopeA, draft.id, "2030-01-02T21:00:00Z", "America/New_York"), /match the approved preview/);
});

test("scheduled approval commits evidence and schedule atomically and replays idempotently", async () => {
  const clock = new Clock(Date.parse("2030-01-02T19:59:00Z"));
  const repository = new InMemoryPublishingRepository();
  const service = new PublishingService(repository, clock);
  const draft = await service.createDraft(scopeA, {
    assetId: "asset", assetDigest: "digest", caption: "scheduled", hashtags: [], platform: "instagram",
    scheduledFor: dueAt, timezone: "America/New_York",
  }, "atomic-scheduled-approval");
  const approved = await service.approveScheduled(scopeA, draft.id, {
    approvedByUserId: "owner-a", previewDigest: draft.preview.digest,
    scheduledFor: dueAt, timezone: "America/New_York",
  });
  assert.equal(approved.state, "scheduled");
  assert.equal(approved.schedule?.scheduledFor, "2030-01-02T20:00:00.000Z");
  assert.equal(approved.approval?.previewDigest, draft.preview.digest);
  clock.advance(61_000);
  const replay = await service.approveScheduled(scopeA, draft.id, {
    approvedByUserId: "owner-a", previewDigest: draft.preview.digest,
    scheduledFor: dueAt, timezone: "America/New_York",
  });
  assert.equal(replay.state, "scheduled");
  assert.equal(replay.approval?.approvedAt, approved.approval?.approvedAt, "replay returns the original durable evidence");
  await assert.rejects(service.approveScheduled(scopeA, draft.id, {
    approvedByUserId: "owner-a", previewDigest: draft.preview.digest,
    scheduledFor: "2030-01-02T21:00:00Z", timezone: "America/New_York",
  }), /does not match|must match/);
});

test("scheduled previews, drafts, and new approvals require a strictly future instant", async () => {
  const clock = new Clock(Date.parse("2030-01-02T20:00:00.000Z"));
  const repository = new InMemoryPublishingRepository();
  const service = new PublishingService(repository, clock);
  const input = (scheduledFor: string) => ({
    assetId: "asset", assetDigest: "digest", caption: "strictly future", hashtags: [] as string[],
    platform: "instagram" as const, scheduledFor, timezone: "America/New_York",
  });

  assert.throws(() => service.createPreview(input("2030-01-02T19:59:59.999Z")), /strictly in the future/);
  assert.throws(() => service.createPreview(input("2030-01-02T20:00:00.000Z")), /strictly in the future/);
  assert.equal(service.createPreview(input("2030-01-02T20:00:00.001Z")).scheduledFor, "2030-01-02T20:00:00.001Z");
  await assert.rejects(service.createDraft(scopeA, input("2030-01-02T20:00:00.000Z"), "equal-draft"), /strictly in the future/);

  const draft = await service.createDraft(scopeA, input("2030-01-02T20:01:00.000Z"), "aging-draft");
  clock.advance(60_000);
  await assert.rejects(service.approveScheduled(scopeA, draft.id, {
    approvedByUserId: scopeA.ownerUserId,
    previewDigest: draft.preview.digest,
    scheduledFor: draft.preview.scheduledFor!,
    timezone: draft.preview.timezone!,
  }), /strictly in the future/);
  assert.equal((await repository.get(scopeA, draft.id))?.state, "pending_approval");
});

test("timezone handling requires an offset and a valid IANA zone", () => {
  assert.throws(() => createPublishingPreview({ assetId: "a", assetDigest: "d", caption: "", hashtags: [], platform: "facebook", scheduledFor: "2030-01-01T10:00:00", timezone: "America/New_York" }), /explicit UTC offset/);
  assert.throws(() => createPublishingPreview({ assetId: "a", assetDigest: "d", caption: "", hashtags: [], platform: "facebook", scheduledFor: "2030-01-01T10:00:00Z", timezone: "Mars/Olympus" }), /IANA timezone/);
  assert.equal(createPublishingPreview({ assetId: "a", assetDigest: "d", caption: "", hashtags: [], platform: "youtube_shorts", scheduledFor: dueAt, timezone: "America/New_York" }).scheduledFor, "2030-01-02T20:00:00.000Z");
});

test("automatic publishing is denied by default before claims or provider submission", async () => {
  const fixture = await scheduledFixture(); fixture.clock.advance(60_000);
  const provider = new FakePublishingProvider("tiktok");
  const disabled = new PublishingWorker({ workerId: "disabled", repository: fixture.repository, providers: [provider], leaseDurationMs: 1_000, retry: { baseDelayMs: 1, maxDelayMs: 1, jitterRatio: 0 }, clock: fixture.clock });
  assert.deepEqual(await disabled.runNext(), { outcome: "disabled" });
  assert.equal(provider.submissions.length, 0);
  assert.equal((await fixture.repository.get(scopeA, fixture.draft.id))?.state, "scheduled");
});

test("manual approval queues immediate execution, while an unapproved draft never submits", async () => {
  const clock = new Clock(Date.parse("2030-01-02T20:00:00Z"));
  const repository = new InMemoryPublishingRepository();
  const service = new PublishingService(repository, clock);
  const draft = await service.createDraft(scopeA, {
    assetId: "00000000-0000-4000-8000-000000000001", assetDigest: "digest", caption: "manual",
    hashtags: [], platform: "facebook",
  }, "manual-now");
  const provider = new FakePublishingProvider("facebook");
  const publisher = new PublishingWorker({
    workerId: "manual-worker", repository, providers: [provider], leaseDurationMs: 1_000,
    policy: { automaticPublishingEnabled: true, enabledTenantKeys: new Set([tenantKey(scopeA)]) },
    retry: { baseDelayMs: 10, maxDelayMs: 100, jitterRatio: 0 }, clock,
  });
  assert.equal((await publisher.runNext()).outcome, "idle");
  assert.equal(provider.submissions.length, 0);
  const approved = await service.approve(scopeA, draft.id, { approvedByUserId: "owner-a", previewDigest: draft.preview.digest });
  assert.equal(approved.state, "queued");
  assert.equal((await publisher.runNext()).outcome, "submitted");
  assert.equal(provider.submissions.length, 1);
});

test("manual rejection requires matching evidence and is terminal/non-claimable", async () => {
  const clock = new Clock(Date.parse("2030-01-02T20:00:00Z"));
  const repository = new InMemoryPublishingRepository();
  const service = new PublishingService(repository, clock);
  const draft = await service.createDraft(scopeA, { assetId: "asset", assetDigest: "digest", caption: "review me", hashtags: [], platform: "facebook" }, "reject-me");
  await assert.rejects(service.reject(scopeA, draft.id, { rejectedByUserId: "owner-a", previewDigest: draft.preview.digest, reason: "  " }), /requires an actor, reason/);
  await assert.rejects(service.reject(scopeA, draft.id, { rejectedByUserId: "owner-a", previewDigest: "sha256:" + "0".repeat(64), reason: "Wrong preview" }), /matching preview digest/);
  const rejected = await service.reject(scopeA, draft.id, { rejectedByUserId: "owner-a", previewDigest: draft.preview.digest, reason: "Brand review failed" });
  assert.equal(rejected.state, "rejected");
  assert.equal(rejected.rejection?.decision, "rejected");
  assert.equal(rejected.rejection?.reason, "Brand review failed");
  await assert.rejects(service.approve(scopeA, draft.id, { approvedByUserId: "owner-a", previewDigest: draft.preview.digest }), /pending preview/);
  const provider = new FakePublishingProvider("facebook");
  assert.equal((await new PublishingWorker({
    workerId: "worker", repository, providers: [provider], leaseDurationMs: 1_000,
    policy: { automaticPublishingEnabled: true, enabledTenantKeys: new Set([tenantKey(scopeA)]) },
    retry: { baseDelayMs: 10, maxDelayMs: 100, jitterRatio: 0 }, clock,
  }).runNext()).outcome, "idle");
  assert.equal(provider.submissions.length, 0);
});

test("operator retry only requeues failed approved work and never bypasses approval", async () => {
  const fixture = await scheduledFixture(); fixture.clock.advance(60_000);
  await assert.rejects(fixture.service.retry(scopeA, fixture.draft.id), /Only failed publishing work/);
  const failing: PublishingProvider = { platform: "tiktok", async submit() { throw new Error("temporary"); } };
  assert.equal((await worker(fixture, failing).runNext()).outcome, "retry_scheduled");
  const retried = await fixture.service.retry(scopeA, fixture.draft.id);
  assert.equal(retried.state, "queued");
  assert.equal(retried.lastError, undefined);
  const success = new FakePublishingProvider("tiktok");
  assert.equal((await worker(fixture, success).runNext()).outcome, "submitted");

  const unapproved = await fixture.service.createDraft(scopeA, { assetId: "other", assetDigest: "digest", caption: "draft", hashtags: [], platform: "instagram" }, "no-approval-retry");
  await assert.rejects(fixture.service.retry(scopeA, unapproved.id), /Only failed publishing work/);
});

test("explicit tenant policy plus manual approval allows one provider submission", async () => {
  const fixture = await scheduledFixture(); fixture.clock.advance(60_000);
  const provider = new FakePublishingProvider("tiktok");
  const result = await worker(fixture, provider).runNext();
  assert.equal(result.outcome, "submitted");
  assert.equal(provider.submissions.length, 1);
  assert.equal(provider.submissions[0]?.context.idempotencyKey, providerPublishIdempotencyKey(fixture.job));
});

test("policy helper rejects missing evidence even if flags are enabled", () => {
  const job = { ...({} as PublicationJob), scope: scopeA, preview: createPublishingPreview({ assetId: "a", assetDigest: "d", caption: "c", hashtags: [], platform: "tiktok" }) };
  assert.equal(automaticPublishingAllowed({ automaticPublishingEnabled: true, enabledTenantKeys: new Set([tenantKey(scopeA)]) }, job), false);
  assert.throws(() => { throw new PublishingPolicyDeniedError("denied"); }, PublishingPolicyDeniedError);
});

test("tenant scope isolates reads, idempotency, policy claims, and dead letters", async () => {
  const repository = new InMemoryPublishingRepository();
  const clock = new Clock(Date.parse("2030-01-02T19:59:00Z"));
  const a = await scheduledFixture({ scope: scopeA, repository, clock, requestKey: "same-key" });
  const b = await scheduledFixture({ scope: scopeB, repository, clock, requestKey: "same-key" });
  assert.notEqual(a.draft.id, b.draft.id);
  assert.equal(await repository.get(scopeB, a.draft.id), undefined);
  clock.advance(60_000);
  const provider = new FakePublishingProvider("tiktok");
  await worker(a, provider).runNext();
  assert.equal((await repository.get(scopeB, b.draft.id))?.state, "scheduled");
  assert.equal(provider.submissions[0]?.context.scope.ownerUserId, "owner-a");
});

test("create is idempotent within a tenant", async () => {
  const repository = new InMemoryPublishingRepository(); const clock = new Clock(1_000); const service = new PublishingService(repository, clock);
  const input = { assetId: "a", assetDigest: "d", caption: "c", hashtags: [] as string[], platform: "facebook" as const };
  const first = await service.createDraft(scopeA, input, "duplicate");
  const second = await service.createDraft(scopeA, input, "duplicate");
  assert.equal(second.id, first.id); assert.equal(second.preview.caption, "c"); assert.equal((await service.list(scopeA)).length, 1);
  await assert.rejects(service.createDraft(scopeA, { ...input, caption: "different" }, "duplicate"), /different publishing preview/);
});

test("structured tenant keys cannot collide when IDs contain separators", async () => {
  const left: TenantScope = { workspaceId: "workspace:a", ownerUserId: "owner" };
  const right: TenantScope = { workspaceId: "workspace", ownerUserId: "a:owner" };
  assert.notEqual(tenantKey(left), tenantKey(right));
  const repository = new InMemoryPublishingRepository();
  const clock = new Clock(Date.parse("2030-01-02T19:59:00Z"));
  const leftFixture = await scheduledFixture({ scope: left, repository, clock, requestKey: "left" });
  await scheduledFixture({ scope: right, repository, clock, requestKey: "right" });
  clock.advance(60_000);
  const claim = await repository.claimDue({ workerId: "isolated", now: new Date(clock.now()).toISOString(), leaseDurationMs: 1_000, enabledTenantKeys: new Set([tenantKey(left)]) });
  assert.equal(claim?.job.id, leftFixture.draft.id);
  assert.deepEqual(claim?.job.scope, left);
});

test("lease fencing prevents duplicate claims and stale commits", async () => {
  const fixture = await scheduledFixture(); fixture.clock.advance(60_000);
  const claim = await fixture.repository.claimDue({ workerId: "crashed", now: new Date(fixture.clock.now()).toISOString(), leaseDurationMs: 100, enabledTenantKeys: new Set([tenantKey(scopeA)]) });
  assert.ok(claim);
  assert.equal(await fixture.repository.claimDue({ workerId: "other", now: new Date(fixture.clock.now()).toISOString(), leaseDurationMs: 100, enabledTenantKeys: new Set([tenantKey(scopeA)]) }), undefined);
  fixture.clock.advance(101);
  assert.equal(await fixture.repository.markSubmitted({ scope: scopeA, publicationId: fixture.draft.id, leaseToken: claim.leaseToken, providerSubmissionId: "stale", idempotencyKey: "key", now: new Date(fixture.clock.now()).toISOString() }), undefined);
  assert.equal((await fixture.repository.reconcileExpiredLeases(new Date(fixture.clock.now()).toISOString())).length, 1);
});

test("cancel loses safely once a lease begins, preventing a cancel/submission race", async () => {
  const fixture = await scheduledFixture(); fixture.clock.advance(60_000);
  assert.ok(await fixture.repository.claimDue({ workerId: "worker", now: new Date(fixture.clock.now()).toISOString(), leaseDurationMs: 1_000, enabledTenantKeys: new Set([tenantKey(scopeA)]) }));
  await assert.rejects(fixture.service.cancel(scopeA, fixture.draft.id), /no longer be canceled safely/);
});

test("retry is bounded and ends in a tenant-scoped dead letter", async () => {
  const fixture = await scheduledFixture(); fixture.clock.advance(60_000);
  let calls = 0;
  const provider: PublishingProvider = { platform: "tiktok", async submit() { calls += 1; throw new Error("temporary outage"); } };
  const publisher = worker(fixture, provider);
  assert.equal((await publisher.runNext()).outcome, "retry_scheduled");
  fixture.clock.advance(100); assert.equal((await publisher.runNext()).outcome, "retry_scheduled");
  fixture.clock.advance(200); assert.equal((await publisher.runNext()).outcome, "retry_scheduled");
  fixture.clock.advance(400); assert.equal((await publisher.runNext()).outcome, "dead_letter");
  assert.equal(calls, 4); assert.equal((await fixture.repository.listDeadLetters(scopeA)).length, 1); assert.equal((await fixture.repository.listDeadLetters(scopeB)).length, 0);
});

test("public views redact provider submission IDs and all credential-shaped fields", async () => {
  const fixture = await scheduledFixture(); fixture.clock.advance(60_000); const provider = new FakePublishingProvider("tiktok");
  const result = await worker(fixture, provider).runNext(); assert.equal(result.outcome, "submitted");
  if (result.outcome !== "submitted") return;
  assert.ok(result.publication.submission?.providerSubmissionId.startsWith("fake_"));
  const publicJson = JSON.stringify(toPublicPublication(result.publication));
  assert.doesNotMatch(publicJson, /providerSubmissionId|fake_|oauth|secret|token/i);
  assert.equal(toPublicPublication(result.publication).submittedAt, result.publication.submission?.submittedAt);
});

test("explicit scheduler ticks and reconciliation mark tracked submissions published without loops", async () => {
  const fixture = await scheduledFixture(); fixture.clock.advance(60_000);
  const provider: PublishingProvider = {
    platform: "tiktok",
    async submit() { return { providerSubmissionId: "private-provider-ref" }; },
    async reconcile() { return "published"; },
  };
  const scheduler = new PublishingScheduler(worker(fixture, provider));
  assert.equal((await scheduler.runOnce()).outcome, "submitted");
  const reconciliation = await new PublishingReconciler(fixture.repository, [provider], fixture.clock).reconcileTenant(scopeA);
  assert.deepEqual(reconciliation, { checked: 1, published: 1, failed: 0 });
  assert.equal((await fixture.repository.get(scopeA, fixture.draft.id))?.state, "published");
});

test("provider reconciliation failure becomes retryable and then dead-letters at the attempt bound", async () => {
  const fixture = await scheduledFixture(); fixture.clock.advance(60_000);
  const provider: PublishingProvider = {
    platform: "tiktok",
    async submit() { return { providerSubmissionId: "failed-provider-ref" }; },
    async reconcile() { return "failed"; },
  };
  assert.equal((await worker(fixture, provider).runNext()).outcome, "submitted");
  const submitted = await fixture.repository.get(scopeA, fixture.draft.id);
  assert.equal(await fixture.repository.recordReconciliationFailure({
    scope: scopeA, publicationId: fixture.draft.id, providerSubmissionId: submitted?.submission?.providerSubmissionId ?? "",
    expectedAttempt: 99, error: "stale reconciler", retryAt: new Date(fixture.clock.now() + 100).toISOString(), now: new Date(fixture.clock.now()).toISOString(),
  }), undefined, "an old reconciliation generation cannot mutate a newer submission attempt");
  assert.equal((await fixture.repository.get(scopeA, fixture.draft.id))?.state, "submitted");
  const reconciler = new PublishingReconciler(fixture.repository, [provider], fixture.clock, { baseDelayMs: 100, maxDelayMs: 100, jitterRatio: 0 }, () => 0.5);
  assert.deepEqual(await reconciler.reconcileTenant(scopeA), { checked: 1, published: 0, failed: 1 });
  const retryable = await fixture.repository.get(scopeA, fixture.draft.id);
  assert.equal(retryable?.state, "retry_wait");
  assert.equal(retryable?.submission, undefined);
  assert.equal(retryable?.lastError, "Publishing provider reported a failed submission");

  fixture.clock.advance(100);
  assert.equal((await worker(fixture, provider).runNext()).outcome, "submitted");
  await reconciler.reconcileTenant(scopeA);
  assert.equal((await fixture.repository.get(scopeA, fixture.draft.id))?.state, "retry_wait");
  fixture.clock.advance(100);
  assert.equal((await worker(fixture, provider).runNext()).outcome, "submitted");
  await reconciler.reconcileTenant(scopeA);
  fixture.clock.advance(100);
  assert.equal((await worker(fixture, provider).runNext()).outcome, "submitted");
  assert.deepEqual(await reconciler.reconcileTenant(scopeA), { checked: 1, published: 0, failed: 1 });
  assert.equal((await fixture.repository.get(scopeA, fixture.draft.id))?.state, "dead_letter");
});

test("a crash before reconciliation failure commit leaves submitted work recoverable on retry", async () => {
  class CrashOnceRepository extends InMemoryPublishingRepository {
    crashes = 1;
    override async recordReconciliationFailure(input: Parameters<InMemoryPublishingRepository["recordReconciliationFailure"]>[0]) {
      if (this.crashes-- > 0) throw new Error("simulated database crash");
      return super.recordReconciliationFailure(input);
    }
  }
  const repository = new CrashOnceRepository();
  const fixture = await scheduledFixture({ repository }); fixture.clock.advance(60_000);
  const provider: PublishingProvider = {
    platform: "tiktok", async submit() { return { providerSubmissionId: "recoverable-ref" }; }, async reconcile() { return "failed"; },
  };
  assert.equal((await worker(fixture, provider).runNext()).outcome, "submitted");
  const reconciler = new PublishingReconciler(repository, [provider], fixture.clock, { baseDelayMs: 1, maxDelayMs: 1, jitterRatio: 0 });
  await assert.rejects(reconciler.reconcileTenant(scopeA), /simulated database crash/);
  assert.equal((await repository.get(scopeA, fixture.draft.id))?.state, "submitted");
  assert.deepEqual(await reconciler.reconcileTenant(scopeA), { checked: 1, published: 0, failed: 1 });
  assert.equal((await repository.get(scopeA, fixture.draft.id))?.state, "retry_wait");
});

test("all supported platforms have provider-neutral fake adapters", () => {
  assert.deepEqual(["tiktok", "instagram", "facebook", "youtube_shorts"].map((platform) => new FakePublishingProvider(platform as never).platform), ["tiktok", "instagram", "facebook", "youtube_shorts"]);
});
