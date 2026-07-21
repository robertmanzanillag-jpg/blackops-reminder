import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";
import { createGenerationRequestSchema, mediaJobSchema } from "../shared/ai-media-studio";
import { InMemoryMediaJobQueue, InMemoryMediaJobRepository } from "../server/ai-media-studio/in-memory";
import { FAKE_VIDEO_PROVIDER_ACCOUNT_ID, FakeVideoProvider } from "../server/ai-media-studio/providers/fake-video-provider";
import { createHeyGenResourceResolver, HeyGenVideoProvider, parseHeyGenResourceMap } from "../server/ai-media-studio/providers/heygen-video-provider";
import { AiMediaStudioService } from "../server/ai-media-studio/service";
import { DeterministicScriptService } from "../server/ai-media-studio/script-service";
import { verifyHeyGenWebhook } from "../server/ai-media-studio/webhook-security";
import { InMemoryAssetIngestRepository } from "../server/ai-media-studio/assets";
import type { VideoProvider } from "../server/ai-media-studio/ports";

class LiveTestVideoProvider implements VideoProvider {
  readonly key = "live-test";
  readonly providerAccountId = "00000000-0000-4000-8000-0000000000a1";
  async status() { return { key: this.key, configured: true, healthy: true, mode: "live" as const }; }
  async submit() { return { providerJobId: "live-provider-job", status: "rendering" as const }; }
  async cancel() {}
  parseWebhook(): never { throw new Error("not used in readiness tests"); }
}

function createHarness() {
  const repository = new InMemoryMediaJobRepository();
  const queue = new InMemoryMediaJobQueue();
  const assetIngestRepository = new InMemoryAssetIngestRepository();
  const service = new AiMediaStudioService(repository, queue, [new FakeVideoProvider({ autoComplete: false })], "fake", {
    influencerNames: new Map([["emily-food", "Emily"]]),
    allowedAssetHosts: new Set(["cdn.example.com"]),
    assetIngestRepository,
  });
  const request = {
    influencerId: "emily-food",
    script: "The best rooftop brunch in Miami this weekend.",
    voiceId: "voice-emily-en",
    language: "en",
    aspectRatio: "9:16" as const,
    idempotencyKey: "generation-test-0001",
  };
  return { repository, queue, assetIngestRepository, service, request };
}

test("creates a provider-neutral vertical job and isolates it by authenticated owner", async () => {
  const { service, request } = createHarness();
  const job = await service.createGeneration("user-a", request);

  assert.equal(job.status, "rendering");
  assert.equal(job.progress, 10);
  assert.equal(job.providerName, "fake");
  assert.equal(job.influencerName, "Emily");
  assert.ok(job.providerJobId?.startsWith("fake_"));
  assert.deepEqual(await service.listJobs("user-b"), []);
  await assert.rejects(() => service.getJob("user-b", job.id), /not found/i);
});

test("generation resolves governance before persistence and again immediately before inline submit", async () => {
  const repository = new InMemoryMediaJobRepository();
  const provider = new LiveTestVideoProvider();
  let checks = 0;
  const service = new AiMediaStudioService(repository, new InMemoryMediaJobQueue(), [provider], provider.key, {
    assetIngestRepository: new InMemoryAssetIngestRepository(),
    assetIngestWorkerReadiness: { isReady: () => true },
    governanceGate: {
      assertRenderAllowed() {
        checks += 1;
        if (checks === 2) throw new Error("profile revoked before provider submit");
      },
    },
  });

  const failed = await service.createGeneration("user-a", createHarness().request);
  assert.equal(checks, 2);
  assert.equal(failed.status, "failed");
  assert.match(failed.error ?? "", /profile revoked/i);

  const blockedRepository = new InMemoryMediaJobRepository();
  const blocked = new AiMediaStudioService(blockedRepository, new InMemoryMediaJobQueue(), [provider], provider.key, {
    governanceGate: { assertRenderAllowed: () => { throw new Error("profile missing"); } },
  });
  await assert.rejects(blocked.createGeneration("user-a", createHarness().request), /profile missing/i);
  assert.deepEqual(await blockedRepository.list("user-a"), []);
});

test("durable create binds the current governance snapshot and explicit retry refreshes it", async () => {
  const repository = new InMemoryMediaJobRepository();
  let current = { profileId: "00000000-0000-4000-8000-000000000001", evidenceDigest: `sha256:${"1".repeat(64)}` as const };
  const service = new AiMediaStudioService(
    repository,
    new InMemoryMediaJobQueue(),
    [new FakeVideoProvider({ autoComplete: false })],
    "fake",
    { executionMode: "durable", governanceGate: { assertRenderAllowed: () => ({ ...current }) } },
  );
  const created = await service.createGeneration("user-a", createHarness().request);
  assert.deepEqual(created.request.governance, current);
  await repository.update({ ...created, status: "failed", stage: "failed", progress: 100, attempts: 1 });

  current = { profileId: "00000000-0000-4000-8000-000000000002", evidenceDigest: `sha256:${"2".repeat(64)}` };
  const retried = await service.retryJob("user-a", created.id);
  assert.deepEqual(retried.request.governance, current);
  assert.equal(retried.status, "pending");
});

test("live generation fails closed unless explicit ingest-worker readiness and its repository are supplied", async () => {
  const request = createHarness().request;
  const provider = new LiveTestVideoProvider();
  const repository = new InMemoryMediaJobRepository();
  const ingestRepository = new InMemoryAssetIngestRepository();
  const blocked = new AiMediaStudioService(repository, new InMemoryMediaJobQueue(), [provider], provider.key, {
    assetIngestRepository: ingestRepository,
  });
  await assert.rejects(
    blocked.createGeneration("user-a", request),
    (error: unknown) => error instanceof Error && error.message === "Owned artifact ingest worker is not ready"
      && "statusCode" in error && error.statusCode === 503,
  );
  assert.deepEqual(await repository.list("user-a"), []);

  const readinessWithoutQueue = new AiMediaStudioService(
    new InMemoryMediaJobRepository(), new InMemoryMediaJobQueue(), [provider], provider.key,
    { assetIngestWorkerReadiness: { isReady: () => true } },
  );
  await assert.rejects(readinessWithoutQueue.createGeneration("user-a", request), /ingest worker is not ready/i);

  const allowed = new AiMediaStudioService(
    new InMemoryMediaJobRepository(), new InMemoryMediaJobQueue(), [provider], provider.key,
    { assetIngestRepository: ingestRepository, assetIngestWorkerReadiness: { isReady: async () => true } },
  );
  assert.equal((await allowed.createGeneration("user-a", request)).status, "rendering");
});

test("deduplicates generation creation per owner without accepting tenant input", async () => {
  const { service, request } = createHarness();
  const parsed = createGenerationRequestSchema.parse({ ...request, ownerUserId: "attacker" });
  assert.equal("ownerUserId" in parsed, false);

  const first = await service.createGeneration("real-user", parsed);
  const second = await service.createGeneration("real-user", parsed);
  const otherOwner = await service.createGeneration("other-user", parsed);
  assert.equal(second.id, first.id);
  assert.notEqual(otherOwner.id, first.id);
});

test("provider completion without an artifact source fails closed", async () => {
  const repository = new InMemoryMediaJobRepository();
  const service = new AiMediaStudioService(repository, new InMemoryMediaJobQueue(), [new FakeVideoProvider()], "fake");
  const job = await service.createGeneration("user-a", createHarness().request);
  assert.equal(job.status, "failed");
  assert.equal(job.stage, "artifact_source_missing");
  assert.match(job.error ?? "", /without an artifact source/i);
  assert.equal(job.progress, 100);
  assert.equal(job.outputUrl, undefined);
});

test("deduplicates signed provider events, ensures one owned ingest and ignores state regressions", async () => {
  const { service, request, assetIngestRepository } = createHarness();
  const job = await service.createGeneration("user-a", request);
  const completedAt = "2026-07-20T15:05:00.000Z";
  const completed = {
    event_id: "evt-complete",
    occurred_at: completedAt,
    data: { provider_job_id: job.providerJobId, status: "completed", video_url: "https://cdn.example.com/video.mp4" },
  };

  assert.deepEqual(await service.ingestWebhook("fake", FAKE_VIDEO_PROVIDER_ACCOUNT_ID, completed), { accepted: true });
  assert.deepEqual(await service.ingestWebhook("fake", FAKE_VIDEO_PROVIDER_ACCOUNT_ID, completed), { accepted: true, duplicate: true });
  await service.ingestWebhook("fake", FAKE_VIDEO_PROVIDER_ACCOUNT_ID, {
    event_id: "evt-old-rendering",
    occurred_at: "2026-07-20T15:04:00.000Z",
    data: { provider_job_id: job.providerJobId, status: "rendering" },
  });
  await service.ingestWebhook("fake", FAKE_VIDEO_PROVIDER_ACCOUNT_ID, {
    event_id: "evt-new-rendering",
    occurred_at: "2026-07-20T15:06:00.000Z",
    data: { provider_job_id: job.providerJobId, status: "rendering" },
  });

  const finalJob = await service.getJob("user-a", job.id);
  assert.equal(finalJob.status, "rendering");
  assert.equal(finalJob.stage, "artifact_ingest_queued");
  assert.equal(finalJob.outputUrl, "https://cdn.example.com/video.mp4");
  const ingest = await assetIngestRepository.findByRenderJob(JSON.stringify(["personal", "user-a"]), job.id);
  assert.equal(ingest?.state, "queued");
  assert.match(ingest?.id ?? "", /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u);
  assert.equal(ingest?.sourceUrl, "https://cdn.example.com/video.mp4");
  assert.equal(finalJob.lastProviderEventAt, completedAt);
  assert.equal(finalJob.completedAt, undefined);
});

test("completed webhook without a provider artifact fails with a safe explicit state", async () => {
  const { service, request } = createHarness();
  const job = await service.createGeneration("user-a", request);
  await service.ingestWebhook("fake", FAKE_VIDEO_PROVIDER_ACCOUNT_ID, {
    event_id: "completed-without-source", occurred_at: "2026-07-20T15:05:00.000Z",
    data: { provider_job_id: job.providerJobId, status: "completed" },
  });
  const failed = await service.getJob("user-a", job.id);
  assert.equal(failed.status, "failed");
  assert.equal(failed.stage, "artifact_source_missing");
  assert.equal(failed.outputAssetId, undefined);
  assert.match(failed.error ?? "", /without an artifact source/i);
});

test("failed is terminal until an explicit retry and cannot return to rendering by webhook", async () => {
  const { service, request } = createHarness();
  const job = await service.createGeneration("user-a", request);
  await service.ingestWebhook("fake", FAKE_VIDEO_PROVIDER_ACCOUNT_ID, { event_id: "terminal-fail", occurred_at: "2026-07-20T15:05:00.000Z", data: { provider_job_id: job.providerJobId, status: "failed" } });
  await service.ingestWebhook("fake", FAKE_VIDEO_PROVIDER_ACCOUNT_ID, { event_id: "late-rendering", occurred_at: "2026-07-20T15:06:00.000Z", data: { provider_job_id: job.providerJobId, status: "rendering" } });
  assert.equal((await service.getJob("user-a", job.id)).status, "failed");
});

test("parks an early webhook until its provider job becomes available", async () => {
  const repository = new InMemoryMediaJobRepository();
  class FixedProvider extends FakeVideoProvider {
    override async submit() { return { providerJobId: "fixed-provider-job", status: "rendering" as const }; }
  }
  const service = new AiMediaStudioService(repository, new InMemoryMediaJobQueue(), [new FixedProvider({ autoComplete: false })], "fake", {
    allowedAssetHosts: new Set(["cdn.example.com"]),
    assetIngestRepository: new InMemoryAssetIngestRepository(),
  });
  const request = createHarness().request;
  const result = await service.ingestWebhook("fake", FAKE_VIDEO_PROVIDER_ACCOUNT_ID, {
    event_id: "evt-early",
    occurred_at: "2026-07-20T15:05:00.000Z",
    data: { provider_job_id: "fixed-provider-job", status: "success", video_url: "https://cdn.example.com/early.mp4" },
  });
  assert.deepEqual(result, { accepted: true, orphaned: true });

  const job = await service.createGeneration("user-a", request);
  assert.equal(job.status, "rendering");
  assert.equal(job.stage, "artifact_ingest_queued");
  assert.equal(job.outputUrl, "https://cdn.example.com/early.mp4");
});

test("provider job, event dedupe, and parked delivery identities are account-scoped", async () => {
  const repository = new InMemoryMediaJobRepository();
  const accountA = "00000000-0000-4000-8000-0000000000d1";
  const accountB = "00000000-0000-4000-8000-0000000000d2";
  const first = await repository.create("owner-a", { ...createHarness().request, idempotencyKey: "account-a-job" });
  const second = await repository.create("owner-b", { ...createHarness().request, idempotencyKey: "account-b-job" });
  await repository.update({ ...first, providerName: "heygen", providerAccountId: accountA, providerJobId: "shared-provider-job" });
  await repository.update({ ...second, providerName: "heygen", providerAccountId: accountB, providerJobId: "shared-provider-job" });

  assert.equal((await repository.getByProviderJob("heygen", accountA, "shared-provider-job"))?.ownerUserId, "owner-a");
  assert.equal((await repository.getByProviderJob("heygen", accountB, "shared-provider-job"))?.ownerUserId, "owner-b");

  const eventA = { eventId: "shared-event", providerKey: "heygen", providerAccountId: accountA, providerJobId: "early", status: "rendering" as const, occurredAt: "2026-07-20T15:00:00.000Z" };
  const eventB = { ...eventA, providerAccountId: accountB };
  assert.equal(await repository.recordWebhook(eventA), true);
  assert.equal(await repository.recordWebhook(eventA), false);
  assert.equal(await repository.recordWebhook(eventB), true);
  await repository.parkWebhook(eventA);
  await repository.parkWebhook(eventB);
  assert.deepEqual((await repository.takeParkedWebhooks("heygen", accountA, "early")).map((event) => event.providerAccountId), [accountA]);
  assert.deepEqual((await repository.takeParkedWebhooks("heygen", accountB, "early")).map((event) => event.providerAccountId), [accountB]);
});

test("cancel is internal and failed jobs can be retried", async () => {
  const first = createHarness();
  const cancelled = await first.service.cancelJob("user-a", (await first.service.createGeneration("user-a", first.request)).id);
  assert.equal(cancelled.status, "cancelled");

  const second = createHarness();
  const job = await second.service.createGeneration("user-a", second.request);
  await second.service.ingestWebhook("fake", FAKE_VIDEO_PROVIDER_ACCOUNT_ID, {
    event_id: "evt-failed",
    occurred_at: "2026-07-20T15:05:00.000Z",
    data: { provider_job_id: job.providerJobId, status: "failed", error: "render rejected" },
  });
  const retried = await second.service.retryJob("user-a", job.id);
  assert.equal(retried.status, "rendering");
  assert.equal(retried.retryCount, 1);
  assert.equal(retried.attempts, 2);
});

test("provider-controlled errors are sanitized before job storage", async () => {
  const { service, request } = createHarness();
  const job = await service.createGeneration("user-a", { ...request, idempotencyKey: "sanitized-webhook-error" });
  await service.ingestWebhook("fake", FAKE_VIDEO_PROVIDER_ACCOUNT_ID, {
    event_id: "secret-error",
    occurred_at: "2026-07-20T15:05:00.000Z",
    data: { provider_job_id: job.providerJobId, status: "failed", error: "Bearer must-not-be-stored customer@example.com" },
  });
  const failed = await service.getJob("user-a", job.id);
  assert.equal(failed.error, "Video provider reported a render failure");
  assert.doesNotMatch(JSON.stringify(failed), /must-not-be-stored|customer@example\.com|Bearer/);

  class LeakyProvider extends FakeVideoProvider {
    override async submit(): Promise<never> { throw new Error("api_key=must-not-be-stored"); }
  }
  const leakyService = new AiMediaStudioService(new InMemoryMediaJobRepository(), new InMemoryMediaJobQueue(), [new LeakyProvider()], "fake");
  const rejected = await leakyService.createGeneration("user-a", { ...request, idempotencyKey: "sanitized-submit-error" });
  assert.equal(rejected.error, "Video provider submission failed");
  assert.doesNotMatch(JSON.stringify(rejected), /must-not-be-stored|api_key/);
});

test("derives a new provider idempotency key for every retry attempt", async () => {
  const keys: string[] = [];
  class RecordingProvider extends FakeVideoProvider {
    override async submit(_request: Parameters<FakeVideoProvider["submit"]>[0], context: Parameters<FakeVideoProvider["submit"]>[1]) {
      keys.push(context.idempotencyKey);
      return { providerJobId: `provider-${keys.length}`, status: "rendering" as const };
    }
  }
  const repository = new InMemoryMediaJobRepository();
  const service = new AiMediaStudioService(repository, new InMemoryMediaJobQueue(), [new RecordingProvider({ autoComplete: false })], "fake");
  const job = await service.createGeneration("user-a", createHarness().request);
  await service.ingestWebhook("fake", FAKE_VIDEO_PROVIDER_ACCOUNT_ID, { event_id: "failed-1", occurred_at: "2026-07-20T15:05:00.000Z", data: { provider_job_id: job.providerJobId, status: "failed" } });
  await service.retryJob("user-a", job.id);
  assert.equal(keys.length, 2);
  assert.notEqual(keys[0], keys[1]);
  assert.notEqual(keys[0], createHarness().request.idempotencyKey);
});

test("rejects untrusted provider output URLs before storing them", async () => {
  const { service, request } = createHarness();
  const job = await service.createGeneration("user-a", request);
  await assert.rejects(() => service.ingestWebhook("fake", FAKE_VIDEO_PROVIDER_ACCOUNT_ID, {
    event_id: "untrusted-url", occurred_at: "2026-07-20T15:05:00.000Z",
    data: { provider_job_id: job.providerJobId, status: "success", video_url: "http://127.0.0.1/private" },
  }), /not trusted/i);
  assert.equal((await service.getJob("user-a", job.id)).status, "rendering");
});

test("verifies webhook HMAC and rejects stale timestamps", () => {
  const rawBody = Buffer.from('{"event_id":"evt-1"}');
  const secret = "test-webhook-secret";
  const nowMs = Date.parse("2026-07-20T15:00:00.000Z");
  const timestamp = String(Math.floor(nowMs / 1_000));
  const signature = createHmac("sha256", secret).update(rawBody).digest("hex");

  assert.equal(verifyHeyGenWebhook({ rawBody, secret, signature, timestamp, nowMs }), true);
  assert.equal(verifyHeyGenWebhook({ rawBody, secret, signature: "bad", timestamp, nowMs }), false);
  assert.equal(verifyHeyGenWebhook({ rawBody, secret, signature, timestamp: String(Number(timestamp) - 301), nowMs }), false);
});

test("HeyGen adapter uses Studio V2 with an exact portrait payload and canonical resources", async () => {
  let capturedUrl = "";
  let capturedInit: RequestInit | undefined;
  let fetchCalls = 0;
  const provider = new HeyGenVideoProvider({
    apiKey: "not-logged-test-key",
    providerAccountId: "00000000-0000-4000-8000-0000000000b1",
    resolveResources: async () => ({ avatarId: "provider-avatar", voiceId: "provider-voice" }),
    fetchImpl: async (input, init) => {
      fetchCalls += 1;
      capturedUrl = String(input);
      capturedInit = init;
      return new Response(JSON.stringify({ data: { video_id: "heygen-job-1" } }), { status: 200 });
    },
  });
  const request = createHarness().request;
  assert.deepEqual(await provider.status(), { key: "heygen", configured: true, healthy: true, mode: "live" });
  assert.equal(fetchCalls, 0);
  const result = await provider.submit(request, { idempotencyKey: request.idempotencyKey, providerAccountId: provider.providerAccountId! });

  assert.equal(result.providerJobId, "heygen-job-1");
  assert.equal(fetchCalls, 1);
  assert.equal(capturedUrl, "https://api.heygen.com/v2/video/generate");
  assert.equal((capturedInit?.headers as Record<string, string>)["content-type"], "application/json");
  assert.equal((capturedInit?.headers as Record<string, string>)["x-api-key"], "not-logged-test-key");
  assert.equal((capturedInit?.headers as Record<string, string>)["idempotency-key"], request.idempotencyKey);
  const body = JSON.parse(String(capturedInit?.body));
  assert.deepEqual(body, {
    video_inputs: [{
      character: { type: "avatar", avatar_id: "provider-avatar", avatar_style: "normal" },
      voice: { type: "text", input_text: request.script, voice_id: "provider-voice" },
    }],
    dimension: { width: 720, height: 1280 },
  });
});

test("HeyGen Studio V2 fails closed on unsafe input and noncanonical responses", async () => {
  const accountId = "00000000-0000-4000-8000-0000000000b1";
  let responseBody: unknown = { data: { video_id: "video-ok" } };
  let fetchCalls = 0;
  let resources = { avatarId: "provider-avatar", voiceId: "provider-voice" };
  const provider = new HeyGenVideoProvider({
    apiKey: "not-logged-test-key",
    providerAccountId: accountId,
    resolveResources: async () => resources,
    fetchImpl: async () => {
      fetchCalls += 1;
      return new Response(JSON.stringify(responseBody), { status: 200 });
    },
  });
  const request = createHarness().request;

  await assert.rejects(
    provider.submit({ ...request, script: "x".repeat(5_000) }, { idempotencyKey: request.idempotencyKey, providerAccountId: accountId }),
    /fewer than 5000/i,
  );
  assert.equal(fetchCalls, 0);

  resources = { avatarId: "provider-avatar\n", voiceId: "provider-voice" };
  await assert.rejects(
    provider.submit(request, { idempotencyKey: request.idempotencyKey, providerAccountId: accountId }),
    /avatar id is invalid/i,
  );
  assert.equal(fetchCalls, 0);

  resources = { avatarId: "provider-avatar", voiceId: "provider-voice" };
  responseBody = { data: { id: "legacy-fallback-must-not-pass" }, id: "root-fallback-must-not-pass" };
  await assert.rejects(
    provider.submit(request, { idempotencyKey: request.idempotencyKey, providerAccountId: accountId }),
    /did not include a video id/i,
  );
  assert.equal(fetchCalls, 1);

  assert.throws(
    () => new HeyGenVideoProvider({ baseUrl: "https://attacker.example" }),
    /official HTTPS API origin/i,
  );
});

test("HeyGen Studio V2 derives bounded 720-class dimensions and rejects unknown ratios", async () => {
  const bodies: Array<Record<string, unknown>> = [];
  const accountId = "00000000-0000-4000-8000-0000000000b1";
  const provider = new HeyGenVideoProvider({
    apiKey: "not-logged-test-key",
    providerAccountId: accountId,
    resolveResources: async () => ({ avatarId: "provider-avatar", voiceId: "provider-voice" }),
    fetchImpl: async (_input, init) => {
      bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      return new Response(JSON.stringify({ data: { video_id: `video-${bodies.length}` } }), { status: 200 });
    },
  });
  const request = createHarness().request;
  const submitWithRatio = (aspectRatio: string) => provider.submit(
    { ...request, aspectRatio } as unknown as Parameters<VideoProvider["submit"]>[0],
    { idempotencyKey: request.idempotencyKey, providerAccountId: accountId },
  );

  await submitWithRatio("16:9");
  await submitWithRatio("1:1");
  assert.deepEqual(bodies.map((body) => body.dimension), [
    { width: 1280, height: 720 },
    { width: 720, height: 720 },
  ]);
  await assert.rejects(submitWithRatio("4:5"), /aspect ratio is not supported/i);
  assert.equal(bodies.length, 2);
});

test("live HeyGen submit fails closed without an explicit provider account identity", async () => {
  const provider = new HeyGenVideoProvider({
    apiKey: "not-logged-test-key",
    resolveResources: async () => ({ avatarId: "provider-avatar", voiceId: "provider-voice" }),
  });
  assert.equal((await provider.status()).configured, false);
  await assert.rejects(
    () => provider.submit(createHarness().request, { idempotencyKey: "missing-account", providerAccountId: "attacker-account" }),
    /not configured/i,
  );
});

test("HeyGen parser accepts documented event_data and resource maps stay canonical", () => {
  const map = parseHeyGenResourceMap(JSON.stringify({ influencers: { "emily-food": "provider-avatar" }, voices: { "voice-emily-en": "provider-voice" } }));
  assert.ok(map);
  assert.ok(createHeyGenResourceResolver(map));
  const provider = new HeyGenVideoProvider({ providerAccountId: "00000000-0000-4000-8000-0000000000b1" });
  const event = provider.parseWebhook({
    event_id: "evt-documented", event_type: "avatar_video.success", occurred_at: "2026-07-20T15:00:00.000Z",
    event_data: { video_id: "video-123", video_url: "https://cdn.example.com/video.mp4" },
  }, { providerAccountId: provider.providerAccountId! });
  assert.equal(event.providerJobId, "video-123");
  assert.equal(event.status, "completed");
  assert.equal(event.providerAccountId, provider.providerAccountId);
  const fallback = provider.parseWebhook({
    event_type: "avatar_video.processing", occurred_at: "2026-07-20T15:00:00.000Z",
    event_data: { video_id: "video-456" },
  }, { providerAccountId: provider.providerAccountId!, fallbackEventId: "sha256:verified-raw-body" });
  assert.equal(fallback.eventId, "sha256:verified-raw-body");
  assert.equal(parseHeyGenResourceMap('{"influencers":{"__proto__":{}},"voices":{}}'), undefined);
  assert.equal(parseHeyGenResourceMap('{"influencers":{"emily":" provider-avatar"},"voices":{"voice":"provider-voice"}}'), undefined);
});

test("maps an internal job to the shared contract shape", async () => {
  const { service, request } = createHarness();
  const job = await service.createGeneration("user-a", request);
  assert.doesNotThrow(() => mediaJobSchema.parse({
    id: job.id,
    generationId: job.generationId,
    title: job.title,
    influencerName: job.influencerName ?? "",
    status: job.status,
    stage: job.stage,
    progress: job.progress,
    aspectRatio: job.request.aspectRatio,
    language: job.request.language,
    estimatedCostUsd: job.estimatedCostUsd ?? 0,
    attempt: job.attempts,
    maxAttempts: job.maxAttempts,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
}));
});

test("generates stable deterministic script variants for every supported source type", () => {
  const service = new DeterministicScriptService();
  const sourceTypes = ["events", "restaurants", "hotels", "nightclubs", "deals", "travel_packages", "beach_clubs", "experiences"] as const;
  for (const [index, type] of sourceTypes.entries()) {
    const request = {
      source: { type, id: `source-${index}`, title: `Miami Pick ${index}`, summary: "A factual public summary supplied by Kong.", location: "Miami" },
      influencerId: "emily-food",
      language: "en",
      variantCount: (index % 5) + 1,
    };
    const first = service.generate(request);
    const second = service.generate(request);
    assert.deepEqual(second.scriptSet, first.scriptSet);
    assert.equal(first.scriptSet.variants.length, request.variantCount);
    assert.equal(first.generation.mode, "deterministic");
    assert.equal(first.generation.estimatedCostUsd, 0);
  }
});
