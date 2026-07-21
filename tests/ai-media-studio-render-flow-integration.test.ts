import assert from "node:assert/strict";
import test from "node:test";
import type { GenerationRequest, MediaGenerationJob } from "../server/ai-media-studio/domain";
import { InMemoryMediaJobQueue, InMemoryMediaJobRepository } from "../server/ai-media-studio/in-memory";
import { FakeVideoProvider } from "../server/ai-media-studio/providers/fake-video-provider";
import { durableQueueResetFields } from "../server/ai-media-studio/persistence/drizzle-media-job-repository";
import { AiMediaStudioService } from "../server/ai-media-studio/service";
import { InMemoryRenderWorkRepository } from "../server/ai-media-studio/workers/in-memory-render-work-repository";
import { providerIdempotencyKey, RenderWorker } from "../server/ai-media-studio/workers/render-worker";
import { createGovernedVideoRenderSubmissionGate, createVideoRenderWorkerHooks } from "../server/ai-media-studio/workers/video-render-runtime";
import { VideoProviderRenderAdapter } from "../server/ai-media-studio/workers/video-provider-adapter";

const request: GenerationRequest = {
  influencerId: "emily-food",
  script: "A durable vertical-video render.",
  voiceId: "voice-emily-en",
  language: "en",
  aspectRatio: "9:16",
  idempotencyKey: "durable-render-flow-0001",
};

class CountingQueue extends InMemoryMediaJobQueue {
  enqueues = 0;
  dequeues = 0;

  override async enqueue(message: Parameters<InMemoryMediaJobQueue["enqueue"]>[0]) {
    this.enqueues += 1;
    return super.enqueue(message);
  }

  override async dequeue() {
    this.dequeues += 1;
    return super.dequeue();
  }
}

class CountingProvider extends FakeVideoProvider {
  submissions = 0;
  readonly idempotencyKeys: string[] = [];

  override async submit(
    input: GenerationRequest,
    context: { idempotencyKey: string },
  ) {
    this.submissions += 1;
    this.idempotencyKeys.push(context.idempotencyKey);
    return super.submit(input, context);
  }
}

/**
 * Test projection of the production single-table design: a pending provider-
 * assigned media row is immediately visible through the render-work port.
 */
class DurableMediaRepository extends InMemoryMediaJobRepository {
  constructor(private readonly work: InMemoryRenderWorkRepository<GenerationRequest>) {
    super();
  }

  override async update(job: MediaGenerationJob): Promise<MediaGenerationJob> {
    const due = job.status === "pending" && job.stage === "queued";
    const saved = await super.update({
      ...job,
      ...(due ? { availableAt: new Date().toISOString(), leaseOwner: undefined, leaseExpiresAt: undefined, deadLetterAt: undefined } : {}),
    });
    if (due && saved.providerName && !(await this.work.get(saved.id))) {
      await this.work.enqueue({
        id: saved.id,
        tenantId: saved.ownerUserId,
        providerKey: saved.providerName,
        payload: saved.request,
        maxAttempts: saved.maxAttempts,
      }, Date.parse(saved.availableAt ?? saved.updatedAt));
    }
    return saved;
  }
}

test("durable create is due without the legacy queue or an inline provider submit", async () => {
  const work = new InMemoryRenderWorkRepository<GenerationRequest>();
  const repository = new DurableMediaRepository(work);
  const queue = new CountingQueue();
  const provider = new CountingProvider({ autoComplete: false });
  const service = new AiMediaStudioService(repository, queue, [provider], "fake", { executionMode: "durable" });

  const first = await service.createGeneration("owner-a", request);
  const duplicate = await service.createGeneration("owner-a", request);

  assert.equal(first.id, duplicate.id);
  assert.equal(first.status, "pending");
  assert.equal(first.stage, "queued");
  assert.ok(first.availableAt);
  assert.equal(queue.enqueues, 0);
  assert.equal(queue.dequeues, 0);
  assert.equal(provider.submissions, 0);
  assert.equal((await work.get(first.id))?.state, "queued");
});

test("one durable worker claim submits once with a stable key and projects provider state", async () => {
  const work = new InMemoryRenderWorkRepository<GenerationRequest>();
  const repository = new DurableMediaRepository(work);
  const queue = new CountingQueue();
  const provider = new CountingProvider({ autoComplete: false });
  const service = new AiMediaStudioService(repository, queue, [provider], "fake", { executionMode: "durable" });
  const job = await service.createGeneration("owner-a", { ...request, idempotencyKey: "worker-once-0001" });
  // Anchor the worker clock to the persisted due time, not to an instant
  // captured before createGeneration assigned availableAt. This also exercises
  // the inclusive `availableAt <= now` boundary deterministically.
  const dueAt = Date.parse(job.availableAt ?? "");
  assert.equal(Number.isFinite(dueAt), true);
  const worker = new RenderWorker<GenerationRequest>({
    workerId: "render-worker-1",
    repository: work,
    providers: [new VideoProviderRenderAdapter(provider)],
    quotas: { maxConcurrentTotal: 1, maxConcurrentPerProvider: 1, maxConcurrentPerTenant: 1 },
    leaseDurationMs: 30_000,
    retry: { baseDelayMs: 1_000, maxDelayMs: 10_000, jitterRatio: 0 },
    submissionGate: { assertCanSubmit: () => undefined },
    clock: { now: () => dueAt },
    hooks: createVideoRenderWorkerHooks(service),
  });

  assert.equal((await worker.runNext()).outcome, "submitted");
  assert.equal((await worker.runNext()).outcome, "idle");
  assert.equal(provider.submissions, 1);
  assert.deepEqual(provider.idempotencyKeys, [providerIdempotencyKey(job.id, 1)]);
  const projected = await service.getJob("owner-a", job.id);
  assert.equal(projected.status, "rendering");
  assert.equal(projected.stage, "provider_rendering");
  assert.equal(projected.attempts, 1);
  assert.ok(projected.providerJobId?.startsWith("fake_"));
  assert.equal(queue.enqueues, 0);
  assert.equal(queue.dequeues, 0);
});

test("a rotated governance snapshot dead-letters before durable provider submit", async () => {
  const work = new InMemoryRenderWorkRepository<GenerationRequest>();
  const provider = new CountingProvider({ autoComplete: false });
  const payload: GenerationRequest = {
    ...request,
    governance: { profileId: "00000000-0000-4000-8000-000000000001", evidenceDigest: `sha256:${"1".repeat(64)}` },
  };
  await work.enqueue({ id: "stale-governance-work", tenantId: "owner-a", providerKey: "fake", payload, maxAttempts: 3 }, 1_000);
  const renderWorker = new RenderWorker<GenerationRequest>({
    workerId: "governance-worker",
    repository: work,
    providers: [new VideoProviderRenderAdapter(provider)],
    quotas: { maxConcurrentTotal: 1, maxConcurrentPerProvider: 1, maxConcurrentPerTenant: 1 },
    leaseDurationMs: 30_000,
    retry: { baseDelayMs: 1_000, maxDelayMs: 10_000, jitterRatio: 0 },
    clock: { now: () => 1_000 },
    submissionGate: createGovernedVideoRenderSubmissionGate(async () => ({
      profileId: "00000000-0000-4000-8000-000000000002",
      evidenceDigest: `sha256:${"2".repeat(64)}`,
    })),
  });

  assert.equal((await renderWorker.runNext()).outcome, "dead_letter");
  assert.equal(provider.submissions, 0);
});

test("durable explicit retry is reset due and advances the provider attempt without submitting", async () => {
  const work = new InMemoryRenderWorkRepository<GenerationRequest>();
  const repository = new DurableMediaRepository(work);
  const queue = new CountingQueue();
  const provider = new CountingProvider({ autoComplete: false });
  const service = new AiMediaStudioService(repository, queue, [provider], "fake", {
    executionMode: "durable",
    allowedAssetHosts: new Set(["cdn.example.com"]),
  });
  const created = await service.createGeneration("owner-a", { ...request, idempotencyKey: "durable-retry-0001" });
  const submitted = await service.recordDurableSubmission({
    ownerUserId: "owner-a",
    jobId: created.id,
    providerKey: "fake",
    providerJobId: "provider-failed-1",
    attempt: 1,
  });
  await service.ingestWebhook("fake", {
    event_id: "failed-event-1",
    occurred_at: "2026-07-20T20:00:00.000Z",
    data: { provider_job_id: submitted.providerJobId, status: "failed" },
  });

  const retried = await service.retryJob("owner-a", created.id);
  assert.equal(retried.status, "pending");
  assert.equal(retried.stage, "queued");
  assert.equal(retried.attempts, 2);
  assert.equal(retried.retryCount, 1);
  assert.ok(retried.availableAt);
  assert.equal(retried.providerJobId, undefined);
  assert.equal(provider.submissions, 0);
  assert.equal(queue.enqueues, 0);
  assert.equal(queue.dequeues, 0);

  const dueAt = new Date("2026-07-20T20:01:00.000Z");
  assert.deepEqual(durableQueueResetFields(retried, dueAt), {
    availableAt: dueAt,
    nextAttemptAt: dueAt,
    leaseOwner: null,
    leaseExpiresAt: null,
    deadLetterAt: null,
    queuedAt: dueAt,
  });
});

test("inline remains the default but fails closed when a provider omits the owned artifact source", async () => {
  const repository = new InMemoryMediaJobRepository();
  const queue = new CountingQueue();
  const provider = new CountingProvider();
  const service = new AiMediaStudioService(repository, queue, [provider], "fake");

  const job = await service.createGeneration("owner-inline", { ...request, idempotencyKey: "inline-regression-0001" });
  assert.equal(job.status, "failed");
  assert.equal(job.stage, "artifact_source_missing");
  assert.equal(job.outputAssetId, undefined);
  assert.equal(provider.submissions, 1);
  assert.equal(queue.enqueues, 1);
  assert.equal(queue.dequeues, 1);
});

test("durable cancellation is atomic while queued and conflicts after a concurrent claim", async () => {
  const work = new InMemoryRenderWorkRepository<GenerationRequest>();
  const repository = new DurableMediaRepository(work);
  const service = new AiMediaStudioService(repository, new CountingQueue(), [new CountingProvider({ autoComplete: false })], "fake", {
    executionMode: "durable",
  });

  const queued = await service.createGeneration("owner-a", { ...request, idempotencyKey: "cancel-queued-0001" });
  assert.equal((await service.cancelJob("owner-a", queued.id)).status, "cancelled");

  const claimed = await service.createGeneration("owner-a", { ...request, idempotencyKey: "cancel-claimed-0001" });
  await repository.update({ ...claimed, status: "rendering", stage: "leased" });
  await assert.rejects(
    () => service.cancelJob("owner-a", claimed.id),
    (error: unknown) => error instanceof Error
      && "statusCode" in error
      && (error as { statusCode: number }).statusCode === 409,
  );
  const afterConflict = await service.getJob("owner-a", claimed.id);
  assert.equal(afterConflict.status, "rendering");
  assert.equal(afterConflict.stage, "leased");
});

test("a provider submission that loses its lease is still tracked without reviving cancellation", async () => {
  const work = new InMemoryRenderWorkRepository<GenerationRequest>();
  const repository = new DurableMediaRepository(work);
  const provider = new CountingProvider({ autoComplete: false });
  const service = new AiMediaStudioService(repository, new CountingQueue(), [provider], "fake", {
    executionMode: "durable",
  });
  const job = await service.createGeneration("owner-race", { ...request, idempotencyKey: "cancel-submit-race-0001" });
  const cancelled = await service.cancelJob("owner-race", job.id);
  assert.equal(cancelled.status, "cancelled");

  // Model the critical interleaving: a worker already held a stale claim and
  // the provider accepted its request, but the cancellation changed the row
  // before the fenced markSubmitted mutation could commit.
  work.markSubmitted = async () => undefined;
  const dueAt = Date.parse(job.availableAt ?? "");
  const worker = new RenderWorker<GenerationRequest>({
    workerId: "race-worker",
    repository: work,
    providers: [new VideoProviderRenderAdapter(provider)],
    quotas: { maxConcurrentTotal: 1, maxConcurrentPerProvider: 1, maxConcurrentPerTenant: 1 },
    leaseDurationMs: 30_000,
    retry: { baseDelayMs: 1_000, maxDelayMs: 10_000, jitterRatio: 0 },
    submissionGate: { assertCanSubmit: () => undefined },
    clock: { now: () => dueAt },
    hooks: createVideoRenderWorkerHooks(service),
  });

  const result = await worker.runNext();
  assert.equal(result.outcome, "lease_lost");
  assert.ok(result.item.providerSubmissionId?.startsWith("fake_"));
  assert.equal(provider.submissions, 1);
  const tracked = await service.getJob("owner-race", job.id);
  assert.equal(tracked.status, "cancelled");
  assert.equal(tracked.stage, "cancelled");
  assert.equal(tracked.providerJobId, result.item.providerSubmissionId);
  assert.equal(tracked.attempts, 1);
});
