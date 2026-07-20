import assert from "node:assert/strict";
import test from "node:test";
import {
  InMemoryRenderWorkRepository,
  RenderWorker,
  providerIdempotencyKey,
  retryDelayMs,
  type RenderSubmissionProvider,
} from "../server/ai-media-studio/workers";

interface Payload { sequence: number }

class MutableClock {
  constructor(private value: number) {}
  now() { return this.value; }
  advance(ms: number) { this.value += ms; }
}

const quotas = {
  maxConcurrentPerProvider: 100,
  maxConcurrentPerTenant: 100,
};

function worker(
  id: string,
  repository: InMemoryRenderWorkRepository<Payload>,
  provider: RenderSubmissionProvider<Payload>,
  clock = new MutableClock(1_000),
  overrides: Partial<ConstructorParameters<typeof RenderWorker<Payload>>[0]> = {},
) {
  return new RenderWorker<Payload>({
    workerId: id,
    repository,
    providers: [provider],
    quotas,
    leaseDurationMs: 1_000,
    retry: { baseDelayMs: 100, maxDelayMs: 10_000, jitterRatio: 0 },
    clock,
    random: () => 0.5,
    ...overrides,
  });
}

test("two workers cannot claim or submit the same active lease", async () => {
  const repository = new InMemoryRenderWorkRepository<Payload>();
  await repository.enqueue({ id: "work-1", tenantId: "tenant-a", providerKey: "video", payload: { sequence: 1 }, maxAttempts: 3 }, 1_000);
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const calls: string[] = [];
  const provider: RenderSubmissionProvider<Payload> = {
    key: "video",
    async submit(_payload, context) {
      calls.push(context.workId);
      await gate;
      return { providerSubmissionId: "provider-1" };
    },
  };
  const first = worker("worker-a", repository, provider).runNext();
  await new Promise<void>((resolve) => setImmediate(resolve));
  const second = await worker("worker-b", repository, provider).runNext();
  assert.deepEqual(second, { outcome: "idle" });
  release();
  assert.equal((await first).outcome, "submitted");
  assert.deepEqual(calls, ["work-1"]);
});

test("an expired lease is recovered after restart with the same provider idempotency key", async () => {
  const clock = new MutableClock(5_000);
  const repository = new InMemoryRenderWorkRepository<Payload>();
  await repository.enqueue({ id: "recover-me", tenantId: "tenant-a", providerKey: "video", payload: { sequence: 1 }, maxAttempts: 3 }, clock.now());
  const crashedClaim = await repository.claimDue({ workerId: "crashed-worker", nowMs: clock.now(), leaseDurationMs: 500, quotas });
  assert.ok(crashedClaim);
  const expectedKey = providerIdempotencyKey("recover-me", crashedClaim.item.attempt);
  clock.advance(501);
  assert.equal(await repository.markSubmitted({
    workId: "recover-me",
    leaseToken: crashedClaim.leaseToken,
    providerSubmissionId: "stale-result",
    nowMs: clock.now(),
  }), undefined, "an expired fencing token cannot commit a provider result");
  const recovered: string[] = [];
  const keys: string[] = [];
  const provider: RenderSubmissionProvider<Payload> = {
    key: "video",
    async submit(_payload, context) {
      keys.push(context.idempotencyKey);
      return { providerSubmissionId: "provider-stable-result" };
    },
  };
  const restarted = worker("restarted-worker", repository, provider, clock, {
    hooks: { onLeaseRecovered: (event) => { recovered.push(`${event.workId}:${event.previousOwner}`); } },
  });
  assert.equal((await restarted.runNext()).outcome, "submitted");
  assert.deepEqual(recovered, ["recover-me:crashed-worker"]);
  assert.deepEqual(keys, [expectedKey]);
  assert.equal((await repository.get("recover-me"))?.attempt, 1);
});

test("atomic claims apply provider and tenant concurrency quotas with backpressure", async () => {
  const repository = new InMemoryRenderWorkRepository<Payload>();
  const inputs = [
    { id: "a-video-1", tenantId: "tenant-a", providerKey: "video", sequence: 1 },
    { id: "a-video-2", tenantId: "tenant-a", providerKey: "video", sequence: 2 },
    { id: "a-audio-1", tenantId: "tenant-a", providerKey: "audio", sequence: 3 },
    { id: "b-audio-1", tenantId: "tenant-b", providerKey: "audio", sequence: 4 },
  ];
  for (const [index, input] of inputs.entries()) {
    await repository.enqueue({ ...input, payload: { sequence: input.sequence }, maxAttempts: 2 }, 100 + index);
  }
  const strictQuotas = { maxConcurrentPerProvider: 1, maxConcurrentPerTenant: 1 };
  const first = await repository.claimDue({ workerId: "w1", nowMs: 200, leaseDurationMs: 1_000, quotas: strictQuotas });
  const second = await repository.claimDue({ workerId: "w2", nowMs: 200, leaseDurationMs: 1_000, quotas: strictQuotas });
  const third = await repository.claimDue({ workerId: "w3", nowMs: 200, leaseDurationMs: 1_000, quotas: strictQuotas });
  assert.equal(first?.item.id, "a-video-1");
  assert.equal(second?.item.id, "b-audio-1");
  assert.equal(third, undefined);
});

test("explicit zero quotas pause all, one provider, or one tenant", async () => {
  const cases = [
    { id: "total", quotas: { maxConcurrentTotal: 0, maxConcurrentPerProvider: 10, maxConcurrentPerTenant: 10 } },
    { id: "provider", quotas: { maxConcurrentPerProvider: 10, maxConcurrentPerTenant: 10, providerLimits: { video: 0 } } },
    { id: "tenant", quotas: { maxConcurrentPerProvider: 10, maxConcurrentPerTenant: 10, tenantLimits: { tenant: 0 } } },
  ];
  for (const entry of cases) {
    const repository = new InMemoryRenderWorkRepository<Payload>();
    await repository.enqueue({ id: entry.id, tenantId: "tenant", providerKey: "video", payload: { sequence: 1 }, maxAttempts: 2 }, 100);
    assert.equal(await repository.claimDue({ workerId: "worker", nowMs: 100, leaseDurationMs: 100, quotas: entry.quotas }), undefined);
  }
});

test("repeated expired leases exhaust a separate recovery budget", async () => {
  const repository = new InMemoryRenderWorkRepository<Payload>();
  await repository.enqueue({
    id: "crash-loop",
    tenantId: "tenant",
    providerKey: "video",
    payload: { sequence: 1 },
    maxAttempts: 5,
    maxLeaseRecoveries: 2,
  }, 100);
  const first = await repository.claimDue({ workerId: "crash-1", nowMs: 100, leaseDurationMs: 10, quotas });
  assert.ok(first);
  assert.deepEqual(await repository.reconcileExpiredLeases(110), [{ workId: "crash-loop", previousOwner: "crash-1", attempt: 1, deadLettered: false }]);
  const second = await repository.claimDue({ workerId: "crash-2", nowMs: 110, leaseDurationMs: 10, quotas });
  assert.ok(second);
  assert.deepEqual(await repository.reconcileExpiredLeases(120), [{ workId: "crash-loop", previousOwner: "crash-2", attempt: 1, deadLettered: true }]);
  const item = await repository.get("crash-loop");
  assert.equal(item?.state, "dead_letter");
  assert.equal(item?.attempt, 1, "crash recovery preserves the provider idempotency attempt");
});

test("retry uses exponential delay then sends bounded attempts to dead letter", async () => {
  const clock = new MutableClock(10_000);
  const repository = new InMemoryRenderWorkRepository<Payload>();
  await repository.enqueue({ id: "eventual-dead", tenantId: "tenant", providerKey: "video", payload: { sequence: 1 }, maxAttempts: 2 }, clock.now());
  const deadLetters: string[] = [];
  let calls = 0;
  const provider: RenderSubmissionProvider<Payload> = {
    key: "video",
    async submit() {
      calls += 1;
      throw new Error("temporary outage");
    },
  };
  const renderWorker = worker("retry-worker", repository, provider, clock, {
    retry: { baseDelayMs: 100, maxDelayMs: 1_000, jitterRatio: 0.2 },
    random: () => 0.5,
    hooks: { onDeadLetter: (item) => { deadLetters.push(item.id); } },
  });
  const first = await renderWorker.runNext();
  assert.equal(first.outcome, "retry_scheduled");
  assert.equal(first.item.attempt, 2);
  assert.equal(first.item.availableAtMs, 10_100);
  assert.equal((await renderWorker.runNext()).outcome, "idle");
  clock.advance(100);
  assert.equal((await renderWorker.runNext()).outcome, "dead_letter");
  assert.equal(calls, 2);
  assert.deepEqual(deadLetters, ["eventual-dead"]);
  assert.equal((await repository.listDeadLetters()).length, 1);
  assert.deepEqual(await repository.counts(), { queued: 0, leased: 0, retry_wait: 0, submitted: 0, dead_letter: 1 });
  assert.equal(retryDelayMs(3, { baseDelayMs: 100, maxDelayMs: 250, jitterRatio: 0.2 }, () => 1), 250);
});

test("a permanent provider/configuration failure dead-letters immediately", async () => {
  const repository = new InMemoryRenderWorkRepository<Payload>();
  await repository.enqueue({ id: "unknown-provider", tenantId: "tenant", providerKey: "missing", payload: { sequence: 1 }, maxAttempts: 9 }, 1_000);
  const renderWorker = new RenderWorker<Payload>({
    workerId: "worker",
    repository,
    providers: [],
    quotas,
    leaseDurationMs: 1_000,
    retry: { baseDelayMs: 100, maxDelayMs: 1_000, jitterRatio: 0 },
    clock: { now: () => 1_000 },
  });
  assert.equal((await renderWorker.runNext()).outcome, "dead_letter");
});

test("1,000 jobs are claimed and submitted exactly once across concurrent workers", async () => {
  const clock = new MutableClock(50_000);
  const repository = new InMemoryRenderWorkRepository<Payload>();
  for (let index = 0; index < 1_000; index += 1) {
    await repository.enqueue({
      id: `load-${String(index).padStart(4, "0")}`,
      tenantId: `tenant-${index % 25}`,
      providerKey: `provider-${index % 4}`,
      payload: { sequence: index },
      maxAttempts: 3,
    }, clock.now());
  }
  const seen = new Set<number>();
  const makeProvider = (key: string): RenderSubmissionProvider<Payload> => ({
    key,
    async submit(payload, context) {
      assert.equal(seen.has(payload.sequence), false, `duplicate payload ${payload.sequence}`);
      seen.add(payload.sequence);
      assert.equal(context.idempotencyKey, providerIdempotencyKey(context.workId, 1));
      return { providerSubmissionId: `${key}-${payload.sequence}` };
    },
  });
  const providers = [0, 1, 2, 3].map((index) => makeProvider(`provider-${index}`));
  const workers = Array.from({ length: 32 }, (_, index) => new RenderWorker<Payload>({
    workerId: `load-worker-${index}`,
    repository,
    providers,
    quotas: { maxConcurrentPerProvider: 25, maxConcurrentPerTenant: 8, maxConcurrentTotal: 100 },
    leaseDurationMs: 5_000,
    retry: { baseDelayMs: 10, maxDelayMs: 100, jitterRatio: 0 },
    clock,
  }));

  let submitted = 0;
  while (submitted < 1_000) {
    const results = await Promise.all(workers.map((candidate) => candidate.runNext()));
    const progressed = results.filter((result) => result.outcome === "submitted").length;
    assert.ok(progressed > 0, `queue stalled after ${submitted} submissions`);
    submitted += progressed;
  }
  assert.equal(submitted, 1_000);
  assert.equal(seen.size, 1_000);
  assert.deepEqual(await repository.counts(), { queued: 0, leased: 0, retry_wait: 0, submitted: 1_000, dead_letter: 0 });
});
