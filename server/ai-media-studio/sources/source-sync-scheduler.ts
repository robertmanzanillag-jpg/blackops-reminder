import { createHash } from "node:crypto";
import type { TenantScope } from "../core/resource-domain";
import { ProductionBatchError } from "../production-batches/contracts";
import type { SourceAdapter, SourceRepository } from "./contracts";
import { SourceEligibilityReviewError, SourceEligibilityReviewService } from "./eligibility-review-service";
import { ingestSourceSnapshot } from "./ingest";
import { KONG_OWNED_SOURCE_ADAPTER_KEY } from "./kong-owned-source-adapter";
import type { SourceToBatchAutomationService } from "./source-to-batch-automation-service";

export const SOURCE_SYNC_RUN_TYPE = "source_sync_scheduler" as const;
export const SOURCE_SYNC_MODE = "scheduled" as const;
export const SOURCE_SYNC_PAYLOAD_VERSION = 1 as const;

export type SourceSyncTaskStatus = "queued" | "leased" | "retry_wait" | "completed" | "dead_letter";
export type SourceSyncFailureCode =
  | "source_sync_unavailable"
  | "review_unavailable"
  | "batch_unavailable"
  | "invalid_scheduler_state"
  | "lease_expired";

export interface SourceSyncRunPayloadV1 {
  version: 1;
  adapterKey: typeof KONG_OWNED_SOURCE_ADAPTER_KEY;
  cursor: string | null;
  page: number;
  cycle: number;
  autoPrepareBatch: boolean;
}

export interface SourceSyncTask {
  id: string;
  scope: TenantScope;
  status: SourceSyncTaskStatus;
  payload: SourceSyncRunPayloadV1;
  attempts: number;
  maxAttempts: number;
  availableAtMs: number;
  fencingToken: number;
  leaseOwner?: string;
  leaseExpiresAtMs?: number;
  failureCode?: SourceSyncFailureCode;
  deadLetterAtMs?: number;
}

export interface ClaimedSourceSyncTask extends SourceSyncTask {
  status: "leased";
  leaseOwner: string;
  leaseExpiresAtMs: number;
}

export interface SourceSyncSchedulerRepository {
  ensureTask(scope: TenantScope, input: {
    availableAtMs: number;
    maxAttempts: number;
    autoPrepareBatch: boolean;
  }): Promise<SourceSyncTask>;
  claimDue(input: { workerId: string; nowMs: number; leaseDurationMs: number }): Promise<ClaimedSourceSyncTask | undefined>;
  commitPage(input: {
    taskId: string;
    scope: TenantScope;
    workerId: string;
    fencingToken: number;
    nowMs: number;
    nextCursor: string;
  }): Promise<SourceSyncTask | undefined>;
  completeCycle(input: {
    taskId: string;
    scope: TenantScope;
    workerId: string;
    fencingToken: number;
    nowMs: number;
  }): Promise<SourceSyncTask | undefined>;
  fail(input: {
    taskId: string;
    scope: TenantScope;
    workerId: string;
    fencingToken: number;
    failureCode: SourceSyncFailureCode;
    retryAtMs: number;
    nowMs: number;
  }): Promise<{ task: SourceSyncTask; deadLettered: boolean } | undefined>;
  recoverExpiredLeases(nowMs: number): Promise<number>;
}

export interface SourceSyncSchedulerObserver {
  observe(scope: TenantScope): Promise<SourceSyncTask | undefined>;
}

export type SourceSyncRunOutcome =
  | { outcome: "idle" }
  | { outcome: "page_completed"; task: SourceSyncTask; ingested: number; reviewed: number; skipped: number }
  | { outcome: "cycle_completed"; task: SourceSyncTask; ingested: number; reviewed: number; skipped: number; batch: "not_requested" | "prepared" | "already_prepared" | "already_approved" | "skipped" }
  | { outcome: "retry_scheduled" | "dead_lettered"; task: SourceSyncTask; failureCode: SourceSyncFailureCode }
  | { outcome: "lease_lost"; taskId: string };

export interface SourceSyncSchedulerOptions {
  repository: SourceSyncSchedulerRepository;
  adapter: SourceAdapter;
  sourceRepository: SourceRepository;
  eligibilityReview: SourceEligibilityReviewService;
  sourceToBatch?: Pick<SourceToBatchAutomationService, "run">;
  pageSize?: number;
  leaseDurationMs?: number;
  retryBaseMs?: number;
  now?: () => number;
}

class SchedulerStageError extends Error {
  constructor(readonly safeCode: SourceSyncFailureCode) {
    super(safeCode);
  }
}

/**
 * Durable, source-only Kong scheduler. It cannot render, publish, resolve a
 * provider secret, create an outbox message, commit spend, migrate or deploy.
 */
export class SourceSyncScheduler {
  private readonly pageSize: number;
  private readonly leaseDurationMs: number;
  private readonly retryBaseMs: number;
  private readonly now: () => number;

  constructor(private readonly options: SourceSyncSchedulerOptions) {
    if (!options.repository || !options.sourceRepository || !options.eligibilityReview
      || options.adapter?.key !== KONG_OWNED_SOURCE_ADAPTER_KEY) {
      throw new Error("Source sync scheduler requires the exact Kong-owned adapter and durable repositories");
    }
    this.pageSize = positiveInteger(options.pageSize ?? 100, 100, "pageSize");
    this.leaseDurationMs = positiveInteger(options.leaseDurationMs ?? 60_000, 3_600_000, "leaseDurationMs");
    this.retryBaseMs = positiveInteger(options.retryBaseMs ?? 5_000, 3_600_000, "retryBaseMs");
    this.now = options.now ?? Date.now;
  }

  ensure(scope: TenantScope, input: { maxAttempts?: number; availableAtMs?: number; autoPrepareBatch?: boolean } = {}) {
    assertScope(scope);
    return this.options.repository.ensureTask(scope, {
      availableAtMs: input.availableAtMs ?? this.now(),
      maxAttempts: positiveInteger(input.maxAttempts ?? 5, 100, "maxAttempts"),
      autoPrepareBatch: input.autoPrepareBatch ?? false,
    });
  }

  async runOnce(workerId: string): Promise<SourceSyncRunOutcome> {
    if (!workerId.trim() || workerId.length > 128) throw new Error("A stable source sync worker ID is required");
    const nowMs = this.now();
    const claim = await this.options.repository.claimDue({ workerId, nowMs, leaseDurationMs: this.leaseDurationMs });
    if (!claim) return { outcome: "idle" };
    return this.runClaim(claim);
  }

  async runClaim(claim: ClaimedSourceSyncTask): Promise<SourceSyncRunOutcome> {
    const startedAt = this.now();
    try {
      assertClaim(claim, startedAt);
      let result: Awaited<ReturnType<typeof ingestSourceSnapshot>>;
      try {
        const protectedIdentities = await this.protectedSourceIdentities(claim.scope);
        const adapter = protectedIdentities.size === 0 ? this.options.adapter : {
          key: this.options.adapter.key,
          categories: this.options.adapter.categories,
          fetchSnapshot: async (scope: TenantScope, request: Parameters<SourceAdapter["fetchSnapshot"]>[1]) => {
            const snapshot = await this.options.adapter.fetchSnapshot(scope, request);
            return {
              ...snapshot,
              items: snapshot.items.filter((candidate) => !protectedIdentities.has(candidate.providerExternalId)),
            };
          },
        } satisfies SourceAdapter;
        result = await ingestSourceSnapshot(claim.scope, adapter, this.options.sourceRepository, {
          limit: this.pageSize,
          ...(claim.payload.cursor !== null ? { cursor: claim.payload.cursor } : {}),
        });
      } catch {
        throw new SchedulerStageError("source_sync_unavailable");
      }

      let reviewed = 0;
      let skipped = 0;
      for (const item of result.items) {
        if (item.adapterKey !== KONG_OWNED_SOURCE_ADAPTER_KEY
          || item.ownerUserId !== claim.scope.ownerUserId || item.workspaceId !== claim.scope.workspaceId) {
          throw new SchedulerStageError("invalid_scheduler_state");
        }
        if (item.status !== "discovered" || item.rightsStatus !== "unknown" || item.moderationStatus !== "pending") {
          skipped += 1;
          continue;
        }
        try {
          await this.options.eligibilityReview.review(claim.scope, claim.scope.ownerUserId, item.id, {
            decision: "approve",
            expectedContentHash: item.contentHash,
            idempotencyKey: reviewIdempotency(claim.scope, item.id, item.contentHash),
            rightsStatus: "owned",
          });
          reviewed += 1;
        } catch (error) {
          if (error instanceof SourceEligibilityReviewError
            && (error.code === "NOT_FOUND" || error.code === "REVIEW_CONFLICT")) {
            skipped += 1;
            continue;
          }
          throw new SchedulerStageError("review_unavailable");
        }
      }

      if (result.nextCursor !== undefined) {
        if (!result.nextCursor || result.nextCursor === claim.payload.cursor) {
          throw new SchedulerStageError("invalid_scheduler_state");
        }
        const task = await this.options.repository.commitPage({
          taskId: claim.id, scope: claim.scope, workerId: claim.leaseOwner,
          fencingToken: claim.fencingToken, nowMs: this.now(), nextCursor: result.nextCursor,
        });
        return task
          ? { outcome: "page_completed", task, ingested: result.items.length, reviewed, skipped }
          : { outcome: "lease_lost", taskId: claim.id };
      }

      const batch = await this.finishBatchCycle(claim);
      const task = await this.options.repository.completeCycle({
        taskId: claim.id, scope: claim.scope, workerId: claim.leaseOwner,
        fencingToken: claim.fencingToken, nowMs: this.now(),
      });
      return task
        ? { outcome: "cycle_completed", task, ingested: result.items.length, reviewed, skipped, batch }
        : { outcome: "lease_lost", taskId: claim.id };
    } catch (error) {
      const failureCode = error instanceof SchedulerStageError ? error.safeCode : "invalid_scheduler_state";
      const nowMs = this.now();
      const failed = await this.options.repository.fail({
        taskId: claim.id, scope: claim.scope, workerId: claim.leaseOwner,
        fencingToken: claim.fencingToken, failureCode,
        nowMs, retryAtMs: nowMs + retryDelay(this.retryBaseMs, claim.attempts),
      });
      if (!failed) return { outcome: "lease_lost", taskId: claim.id };
      return {
        outcome: failed.deadLettered ? "dead_lettered" : "retry_scheduled",
        task: failed.task,
        failureCode,
      };
    }
  }

  recoverExpiredLeases(nowMs = this.now()): Promise<number> {
    return this.options.repository.recoverExpiredLeases(nowMs);
  }

  private async finishBatchCycle(claim: ClaimedSourceSyncTask): Promise<"not_requested" | "prepared" | "already_prepared" | "already_approved" | "skipped"> {
    if (!claim.payload.autoPrepareBatch || !this.options.sourceToBatch) return "not_requested";
    try {
      const response = await this.options.sourceToBatch.run(claim.scope);
      return response.outcome;
    } catch (error) {
      if (error instanceof ProductionBatchError
        && (error.code === "NOT_FOUND" || error.code === "SOURCE_INELIGIBLE" || error.code === "SOURCE_REFRESHED")) return "skipped";
      throw new SchedulerStageError("batch_unavailable");
    }
  }

  private async protectedSourceIdentities(scope: TenantScope): Promise<Set<string>> {
    const protectedIds = new Set<string>();
    const seenCursors = new Set<string>();
    let cursor: string | undefined;
    do {
      const page = await this.options.sourceRepository.listPage(scope, { limit: 100, ...(cursor ? { cursor } : {}) });
      for (const item of page.items) {
        if (item.adapterKey === KONG_OWNED_SOURCE_ADAPTER_KEY
          && (item.status === "rejected" || item.status === "archived")) protectedIds.add(item.providerExternalId);
      }
      if (!page.hasMore || !page.nextCursor) break;
      if (seenCursors.has(page.nextCursor)) throw new Error("Source repository returned a repeating cursor");
      seenCursors.add(page.nextCursor);
      cursor = page.nextCursor;
    } while (true);
    return protectedIds;
  }
}

export function parseSourceSyncPayload(input: unknown): SourceSyncRunPayloadV1 {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("Invalid source sync payload");
  const raw = input as Record<string, unknown>;
  const keys = Object.keys(raw).sort().join(",");
  if (keys !== "adapterKey,autoPrepareBatch,cursor,cycle,page,version"
    || raw.version !== SOURCE_SYNC_PAYLOAD_VERSION
    || raw.adapterKey !== KONG_OWNED_SOURCE_ADAPTER_KEY
    || (raw.cursor !== null && (typeof raw.cursor !== "string" || !raw.cursor || raw.cursor.length > 2_048))
    || !Number.isSafeInteger(raw.page) || Number(raw.page) < 0
    || !Number.isSafeInteger(raw.cycle) || Number(raw.cycle) < 0
    || typeof raw.autoPrepareBatch !== "boolean") {
    throw new Error("Invalid source sync payload");
  }
  return Object.freeze({
    version: 1,
    adapterKey: KONG_OWNED_SOURCE_ADAPTER_KEY,
    cursor: raw.cursor as string | null,
    page: Number(raw.page),
    cycle: Number(raw.cycle),
    autoPrepareBatch: raw.autoPrepareBatch,
  });
}

function reviewIdempotency(scope: TenantScope, sourceItemId: string, contentHash: string): string {
  const suffix = createHash("sha256").update(JSON.stringify([
    scope.ownerUserId, scope.workspaceId, KONG_OWNED_SOURCE_ADAPTER_KEY, sourceItemId, contentHash,
  ])).digest("hex").slice(0, 64);
  return `kong-auto-attest-${suffix}`;
}

function assertScope(scope: TenantScope): void {
  if (!scope.ownerUserId.trim() || !scope.workspaceId.trim()) throw new Error("A source sync tenant scope is required");
}

function assertClaim(claim: ClaimedSourceSyncTask, nowMs: number): void {
  assertScope(claim.scope);
  parseSourceSyncPayload(claim.payload);
  if (claim.status !== "leased" || !claim.leaseOwner.trim() || claim.fencingToken < 1
    || claim.leaseExpiresAtMs <= nowMs) throw new SchedulerStageError("lease_expired");
}

function positiveInteger(value: number, max: number, name: string): number {
  if (!Number.isInteger(value) || value < 1 || value > max) throw new Error(`${name} must be a positive bounded integer`);
  return value;
}

function retryDelay(base: number, attempt: number): number {
  return Math.min(base * 2 ** Math.min(Math.max(attempt - 1, 0), 8), 3_600_000);
}
