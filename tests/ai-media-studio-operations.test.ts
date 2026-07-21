import assert from "node:assert/strict";
import test from "node:test";
import {
  InMemoryOutboxRepository,
  OutboxDispatcher,
  evaluateWorkAdmission,
  queueHealthSnapshot,
  rehearseCapacity,
  type OperationsAdmissionPolicy,
} from "../server/ai-media-studio/operations";

const policy: OperationsAdmissionPolicy = {
  concurrency: { total: 10, perProvider: 3, perTenant: 2, providerOverrides: { slow: 1 } },
  allowedLanguages: ["en", "es"],
  allowedCountries: ["US", "MX"],
  allowedTimeZones: ["America/New_York", "America/Mexico_City"],
  tenantDailyBudgetUsd: 5,
  tenantDailyBudgetOverrides: { premium: 20 },
};

const request = {
  tenantId: "tenant-a", providerKey: "video", language: "en", country: "us",
  timeZone: "America/New_York", estimatedCostUsd: 1.25,
};

test("admission policy enforces metadata, layered concurrency, and prospective daily budget", () => {
  const usage = { activeTotal: 0, activeByProvider: {}, activeByTenant: {}, tenantSpendTodayUsd: 3.75 };
  assert.deepEqual(evaluateWorkAdmission(request, usage, policy), { admitted: true, reservedCostUsd: 1.25 });
  assert.equal(evaluateWorkAdmission({ ...request, language: "fr" }, usage, policy).admitted, false);
  assert.deepEqual(evaluateWorkAdmission(request, { ...usage, activeByProvider: { video: 3 } }, policy), {
    admitted: false, code: "provider_quota_exhausted", reason: "Provider concurrency quota is exhausted",
  });
  assert.deepEqual(evaluateWorkAdmission({ ...request, estimatedCostUsd: 1.251 }, usage, policy), {
    admitted: false, code: "daily_budget_exhausted", reason: "Tenant daily budget would be exceeded",
  });
  assert.equal(evaluateWorkAdmission({ ...request, tenantId: "premium", estimatedCostUsd: 10 }, usage, policy).admitted, true);
});

test("outbox atomically claims in order and fences stale lease commits", async () => {
  const repository = new InMemoryOutboxRepository<{ sequence: number }>();
  await repository.add({ id: "second", topic: "audit", payload: { sequence: 2 }, maxAttempts: 2 }, 2);
  await repository.add({ id: "first", topic: "audit", payload: { sequence: 1 }, maxAttempts: 2 }, 1);
  const [claim] = await repository.claim({ workerId: "worker-a", limit: 1, leaseDurationMs: 10, nowMs: 2 });
  assert.equal(claim.message.id, "first");
  assert.equal(await repository.reconcileExpiredLeases(12), 1);
  const replacements = await repository.claim({ workerId: "worker-b", limit: 2, leaseDurationMs: 10, nowMs: 12 });
  const replacement = replacements.find(({ message }) => message.id === "first");
  assert.ok(replacement);
  assert.equal(await repository.markDispatched({ id: "first", leaseToken: claim.leaseToken, nowMs: 13 }), false);
  assert.equal(await repository.markDispatched({ id: "first", leaseToken: replacement.leaseToken, nowMs: 13 }), true);
});

test("outbox lease recovery consumes attempts and eventually dead-letters repeated crashes", async () => {
  const repository = new InMemoryOutboxRepository<{ tenantId: string }>();
  await repository.add({
    id: "crash-loop",
    topic: "publish",
    payload: { tenantId: "tenant-a" },
    maxAttempts: 2,
  }, 0);

  const [first] = await repository.claim({ workerId: "worker-a", limit: 1, leaseDurationMs: 10, nowMs: 0 });
  assert.equal(first.message.attempt, 1);
  assert.equal(await repository.reconcileExpiredLeases(10), 1);
  assert.deepEqual(await repository.counts(), {
    held: 0, pending: 0, leased: 0, retry_wait: 1, dispatched: 0, dead_letter: 0,
  });

  const [second] = await repository.claim({ workerId: "worker-b", limit: 1, leaseDurationMs: 10, nowMs: 10 });
  assert.equal(second.message.attempt, 2);
  assert.notEqual(second.leaseToken, first.leaseToken);
  assert.equal(await repository.markDispatched({ id: "crash-loop", leaseToken: first.leaseToken, nowMs: 11 }), false);

  assert.equal(await repository.reconcileExpiredLeases(20), 1);
  assert.equal((await repository.claim({ workerId: "worker-c", limit: 1, leaseDurationMs: 10, nowMs: 20 })).length, 0);
  assert.equal(await repository.markDispatched({ id: "crash-loop", leaseToken: second.leaseToken, nowMs: 20 }), false);

  const [deadLetter] = await repository.listDeadLetters();
  assert.equal(deadLetter?.state, "dead_letter");
  assert.equal(deadLetter?.attempt, 2);
  assert.equal(deadLetter?.lastError, "Outbox lease recovery attempt budget exhausted");
  assert.equal(deadLetter?.deadLetteredAtMs, 20);
  assert.equal(deadLetter?.payload.tenantId, "tenant-a");
});

test("outbox dispatcher retries bounded attempts then dead-letters", async () => {
  let now = 100;
  const repository = new InMemoryOutboxRepository<string>();
  await repository.add({ id: "message", topic: "notify", payload: "hello", maxAttempts: 2 }, now);
  const dispatcher = new OutboxDispatcher({
    workerId: "dispatcher", repository, batchSize: 1, leaseDurationMs: 100, now: () => now,
    retryDelayMs: () => 10,
    transport: { dispatch: async () => { throw new Error("offline"); } },
  });
  assert.deepEqual(await dispatcher.runOnce(), { claimed: 1, dispatched: 0, retried: 1, deadLettered: 0, leaseLost: 0 });
  assert.equal((await dispatcher.runOnce()).claimed, 0);
  now += 10;
  assert.deepEqual(await dispatcher.runOnce(), { claimed: 1, dispatched: 0, retried: 0, deadLettered: 1, leaseLost: 0 });
  assert.equal((await repository.listDeadLetters())[0]?.lastError, "offline");
});

test("queue health produces an actionable SLO snapshot", () => {
  assert.deepEqual(queueHealthSnapshot({
    nowMs: 10_000, oldestReadyAtMs: 1_000, ready: 20, leased: 2, retrying: 1, deadLetters: 2,
    completedLastWindow: 80, failedLastWindow: 20, windowMs: 60_000,
    target: { maxReadyAgeMs: 5_000, maxDeadLetters: 0, minSuccessRate: 0.95 },
  }), {
    status: "breached", readyAgeMs: 9_000, throughputPerMinute: 80, successRate: 0.8,
    counts: { ready: 20, leased: 2, retrying: 1, deadLetters: 2 },
    breaches: ["ready_age_slo", "dead_letter_slo", "success_rate_slo"],
  });
});

test("10k capacity rehearsal is deterministic and explicitly not production proof", () => {
  const result = rehearseCapacity({ failureEvery: 100 });
  assert.deepEqual(result, {
    disclaimer: "DETERMINISTIC_REHEARSAL_ONLY_NOT_PRODUCTION_PROOF",
    jobs: 10_000, succeeded: 9_900, failed: 100, concurrency: 25,
    simulatedDurationMs: 800_000, simulatedThroughputPerSecond: 12.5, maxObservedInFlight: 25,
  });
  assert.deepEqual(rehearseCapacity({ failureEvery: 100 }), result);
});
