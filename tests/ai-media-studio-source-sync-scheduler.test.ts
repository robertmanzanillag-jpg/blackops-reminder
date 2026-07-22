import assert from "node:assert/strict";
import test from "node:test";
import type { TenantScope } from "../server/ai-media-studio/core/resource-domain";
import type { SourceAdapter, SourceAdapterItem } from "../server/ai-media-studio/sources/contracts";
import { SourceEligibilityReviewService } from "../server/ai-media-studio/sources/eligibility-review-service";
import { InMemorySourceRepository } from "../server/ai-media-studio/sources/in-memory-source-repository";
import {
  SourceSyncScheduler,
  type ClaimedSourceSyncTask,
  type SourceSyncSchedulerRepository,
  type SourceSyncTask,
} from "../server/ai-media-studio/sources/source-sync-scheduler";

const scope = { ownerUserId: "owner-a", workspaceId: "workspace-a" } as const;
const capturedAt = "2026-07-22T18:00:00.000Z";

class MemorySchedule implements SourceSyncSchedulerRepository {
  task?: SourceSyncTask;
  now = 1_000;
  loseNextCommit = false;

  async ensureTask(received: TenantScope, input: { availableAtMs: number; maxAttempts: number; autoPrepareBatch: boolean }) {
    this.task ??= {
      id: "sync-1", scope: { ...received }, status: "queued", attempts: 0, maxAttempts: input.maxAttempts,
      availableAtMs: input.availableAtMs, fencingToken: 0,
      payload: { version: 1, adapterKey: "kong-owned-catalog", cursor: null, page: 0, cycle: 0, autoPrepareBatch: input.autoPrepareBatch },
    };
    return structuredClone(this.task);
  }
  async claimDue(input: { workerId: string; nowMs: number; leaseDurationMs: number }) {
    if (!this.task || !["queued", "retry_wait"].includes(this.task.status) || this.task.availableAtMs > input.nowMs) return undefined;
    this.task = { ...this.task, status: "leased", attempts: this.task.attempts + 1, fencingToken: this.task.fencingToken + 1,
      leaseOwner: input.workerId, leaseExpiresAtMs: input.nowMs + input.leaseDurationMs };
    return structuredClone(this.task) as ClaimedSourceSyncTask;
  }
  async commitPage(input: { taskId: string; scope: TenantScope; workerId: string; fencingToken: number; nowMs: number; nextCursor: string }) {
    if (this.loseNextCommit) { this.loseNextCommit = false; return undefined; }
    if (!this.matches(input)) return undefined;
    this.task = { ...this.task!, status: "queued", availableAtMs: input.nowMs, leaseOwner: undefined, leaseExpiresAtMs: undefined,
      payload: { ...this.task!.payload, cursor: input.nextCursor, page: this.task!.payload.page + 1 } };
    return structuredClone(this.task);
  }
  async completeCycle(input: { taskId: string; scope: TenantScope; workerId: string; fencingToken: number; nowMs: number }) {
    if (!this.matches(input)) return undefined;
    this.task = { ...this.task!, status: "completed", leaseOwner: undefined, leaseExpiresAtMs: undefined,
      payload: { ...this.task!.payload, cursor: null, page: 0, cycle: this.task!.payload.cycle + 1 } };
    return structuredClone(this.task);
  }
  async fail(input: { taskId: string; scope: TenantScope; workerId: string; fencingToken: number; failureCode: SourceSyncTask["failureCode"] & string; retryAtMs: number; nowMs: number }) {
    if (!this.matches(input)) return undefined;
    const dead = this.task!.attempts >= this.task!.maxAttempts;
    this.task = { ...this.task!, status: dead ? "dead_letter" : "retry_wait", availableAtMs: input.retryAtMs,
      failureCode: input.failureCode, leaseOwner: undefined, leaseExpiresAtMs: undefined };
    return { task: structuredClone(this.task), deadLettered: dead };
  }
  async recoverExpiredLeases(nowMs: number) {
    if (!this.task || this.task.status !== "leased" || (this.task.leaseExpiresAtMs ?? Infinity) > nowMs) return 0;
    this.task = { ...this.task, status: "retry_wait", availableAtMs: nowMs, failureCode: "lease_expired", leaseOwner: undefined, leaseExpiresAtMs: undefined };
    return 1;
  }
  private matches(input: { taskId: string; scope: TenantScope; workerId: string; fencingToken: number; nowMs: number }) {
    return this.task?.id === input.taskId && this.task.scope.ownerUserId === input.scope.ownerUserId
      && this.task.scope.workspaceId === input.scope.workspaceId && this.task.status === "leased"
      && this.task.leaseOwner === input.workerId && this.task.fencingToken === input.fencingToken
      && (this.task.leaseExpiresAtMs ?? 0) > input.nowMs;
  }
}

function item(id: string, content = `Summary ${id}`): SourceAdapterItem {
  return { providerExternalId: id, category: "events", title: `Title ${id}`, content };
}

function scheduler(schedule: MemorySchedule, sources: InMemorySourceRepository, pages: Record<string, { items: SourceAdapterItem[]; nextCursor?: string }>, batch?: { run(scope: TenantScope): Promise<any> }) {
  const adapter: SourceAdapter = {
    key: "kong-owned-catalog", categories: ["events"],
    async fetchSnapshot(received, request) {
      assert.deepEqual(received, scope);
      const page = pages[request.cursor ?? "start"] ?? { items: [] };
      return { ...page, capturedAt };
    },
  };
  return new SourceSyncScheduler({
    repository: schedule, adapter, sourceRepository: sources,
    eligibilityReview: new SourceEligibilityReviewService(sources), sourceToBatch: batch as never,
    pageSize: 25, leaseDurationMs: 1_000, retryBaseMs: 100, now: () => schedule.now,
  });
}

test("commits a server-owned cursor across pages and auto-attests only exact Kong rows", async () => {
  const schedule = new MemorySchedule();
  const sources = new InMemorySourceRepository();
  const service = scheduler(schedule, sources, {
    start: { items: [item("a")], nextCursor: "page-2" },
    "page-2": { items: [item("b")] },
  });
  await service.ensure(scope, { autoPrepareBatch: false });
  const first = await service.runOnce("worker-a");
  assert.equal(first.outcome, "page_completed");
  assert.equal(schedule.task?.payload.cursor, "page-2");
  const second = await service.runOnce("worker-a");
  assert.equal(second.outcome, "cycle_completed");
  assert.deepEqual((await sources.list(scope)).map((source) => [source.providerExternalId, source.rightsStatus, source.moderationStatus]), [
    ["a", "owned", "approved"], ["b", "owned", "approved"],
  ]);
});

test("a lost cursor commit safely replays ingestion and review without duplicate source effects", async () => {
  const schedule = new MemorySchedule();
  const sources = new InMemorySourceRepository();
  const service = scheduler(schedule, sources, { start: { items: [item("a")], nextCursor: "page-2" }, "page-2": { items: [] } });
  await service.ensure(scope);
  schedule.loseNextCommit = true;
  assert.equal((await service.runOnce("worker-a")).outcome, "lease_lost");
  schedule.task = { ...schedule.task!, status: "queued", leaseOwner: undefined, leaseExpiresAtMs: undefined };
  const replay = await service.runOnce("worker-b");
  assert.equal(replay.outcome, "page_completed");
  assert.equal((await sources.list(scope)).length, 1);
  assert.equal(replay.outcome === "page_completed" && replay.reviewed, 0);
});

test("content refresh receives a new hash-bound attestation while rejected content is never overridden", async () => {
  const schedule = new MemorySchedule();
  const sources = new InMemorySourceRepository();
  let current = item("a", "Version one");
  const service = scheduler(schedule, sources, { start: { get items() { return [current]; } } as never });
  await service.ensure(scope);
  await service.runOnce("worker-a");
  const accepted = (await sources.list(scope))[0]!;
  current = item("a", "Version two");
  schedule.task = { ...schedule.task!, status: "queued", attempts: 0, payload: { ...schedule.task!.payload, cursor: null } };
  await service.runOnce("worker-a");
  const refreshed = (await sources.list(scope))[0]!;
  assert.notEqual(refreshed.contentHash, accepted.contentHash);
  assert.equal(refreshed.rightsStatus, "owned");

  const rejectedSeed = (await sources.upsertByContentHash(scope, {
    adapterKey: "kong-owned-catalog", providerExternalId: "blocked", category: "events", title: "Blocked", content: "Do not attest",
    contentHash: `sha256:${"b".repeat(64)}`, rightsStatus: "unknown", moderationStatus: "pending", status: "discovered", payload: {},
  })).item;
  await new SourceEligibilityReviewService(sources).review(scope, scope.ownerUserId, rejectedSeed.id, {
    decision: "reject", expectedContentHash: rejectedSeed.contentHash, idempotencyKey: "reject-blocked", reasonCode: "moderation_rejected",
  });
  current = item("blocked", "Changed after explicit rejection");
  schedule.task = { ...schedule.task!, status: "queued", attempts: 0 };
  const result = await service.runOnce("worker-a");
  assert.equal(result.outcome, "cycle_completed");
  const blocked = (await sources.list(scope)).find((source) => source.providerExternalId === "blocked");
  assert.deepEqual([blocked?.status, blocked?.rightsStatus, blocked?.moderationStatus], ["rejected", "rejected", "rejected"]);
  assert.equal(blocked?.contentHash, rejectedSeed.contentHash);
});

test("stale leases are recovered and old fencing tokens cannot commit", async () => {
  const schedule = new MemorySchedule();
  const sources = new InMemorySourceRepository();
  const service = scheduler(schedule, sources, { start: { items: [] } });
  await service.ensure(scope);
  const old = await schedule.claimDue({ workerId: "old", nowMs: 1_000, leaseDurationMs: 50 });
  assert.ok(old);
  assert.equal(await service.recoverExpiredLeases(1_051), 1);
  schedule.now = 1_051;
  const current = await schedule.claimDue({ workerId: "new", nowMs: 1_051, leaseDurationMs: 1_000 });
  assert.ok(current);
  assert.equal(await schedule.completeCycle({ taskId: old!.id, scope, workerId: "old", fencingToken: old!.fencingToken, nowMs: 1_052 }), undefined);
  assert.ok(current!.fencingToken > old!.fencingToken);
});

test("optional batch automation treats absent eligible work as a safe completed-cycle skip", async () => {
  const schedule = new MemorySchedule();
  const sources = new InMemorySourceRepository();
  const { ProductionBatchError } = await import("../server/ai-media-studio/production-batches/contracts");
  const service = scheduler(schedule, sources, { start: { items: [] } }, {
    async run() { throw new ProductionBatchError("SOURCE_INELIGIBLE"); },
  });
  await service.ensure(scope, { autoPrepareBatch: true });
  const result = await service.runOnce("worker-a");
  assert.equal(result.outcome, "cycle_completed");
  assert.equal(result.outcome === "cycle_completed" && result.batch, "skipped");
});
