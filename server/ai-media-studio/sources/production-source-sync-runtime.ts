import { randomUUID } from "node:crypto";
import type { TenantScope } from "../core/resource-domain";
import { ProductionBatchService } from "../production-batches/service";
import { WorkerLoop, type WorkIterationResult } from "../workers/worker-loop";
import { SourceEligibilityReviewService } from "./eligibility-review-service";
import { HttpKongSourceReader } from "./http-kong-source-reader";
import { KongOwnedSourceAdapter } from "./kong-owned-source-adapter";
import { SourceToBatchAutomationService } from "./source-to-batch-automation-service";
import type { SourceSyncScheduler } from "./source-sync-scheduler";

export const KONG_SOURCE_SYNC_INTERVAL_MS = 15 * 60 * 1_000;
const WORKER_IDLE_BACKOFF_MS = 5_000;
const LEASE_RECONCILIATION_INTERVAL_MS = 60_000;

type SourceSyncSchedulerPort = Pick<SourceSyncScheduler, "ensure" | "runOnce" | "recoverExpiredLeases">;

export interface SourceSyncLoopOptions {
  scheduler: SourceSyncSchedulerPort;
  scope: TenantScope;
  workerId: string;
  signal: AbortSignal;
  syncIntervalMs?: number;
  idleBackoffMs?: number;
  reconciliationIntervalMs?: number;
  sleep?: (milliseconds: number, signal: AbortSignal) => Promise<void>;
}

/**
 * Requeues one durable source-only cycle per interval while a single worker
 * drains all server-owned cursor pages. The loop never calls render, provider,
 * spend, publishing, migration or deployment capabilities.
 */
export async function runSourceSyncLoop(options: SourceSyncLoopOptions): Promise<void> {
  assertLoopOptions(options);
  const sleep = options.sleep ?? abortableSleep;
  const controller = new AbortController();
  const stop = () => controller.abort();
  if (options.signal.aborted) controller.abort();
  else options.signal.addEventListener("abort", stop, { once: true });
  const loop = new WorkerLoop({
    concurrency: 1,
    idleBackoffMs: options.idleBackoffMs ?? WORKER_IDLE_BACKOFF_MS,
    reconciliationIntervalMs: options.reconciliationIntervalMs ?? LEASE_RECONCILIATION_INTERVAL_MS,
    runOne: async (): Promise<WorkIterationResult> => {
      const outcome = await options.scheduler.runOnce(options.workerId);
      return outcome.outcome === "idle" ? "idle" : "worked";
    },
    reconcile: async () => { await options.scheduler.recoverExpiredLeases(); },
    sleep,
  });
  const requeue = async () => {
    while (!controller.signal.aborted) {
      await options.scheduler.ensure(options.scope, { autoPrepareBatch: true });
      await sleep(options.syncIntervalMs ?? KONG_SOURCE_SYNC_INTERVAL_MS, controller.signal);
    }
  };
  try {
    await Promise.all([loop.run(controller.signal), requeue()]);
  } finally {
    controller.abort();
    options.signal.removeEventListener("abort", stop);
  }
}

/** Production-only composition. Imports the database lazily after server start. */
export async function runProductionKongSourceSyncScheduler(
  ownerUserId: string,
  signal: AbortSignal,
): Promise<void> {
  if (process.env.NODE_ENV?.trim().toLowerCase() !== "production" || !process.env.DATABASE_URL?.trim()) {
    throw new Error("Production Kong source sync requires the production database runtime");
  }
  if (!ownerUserId.trim()) throw new Error("Production Kong source sync requires a system owner");
  const [database, sourceAdapter, scheduleAdapter, batchAdapter, schedulerModule] = await Promise.all([
    import("../../db"),
    import("./drizzle-source-repository"),
    import("./drizzle-source-sync-scheduler-repository"),
    import("../production-batches/drizzle-repository"),
    import("./source-sync-scheduler"),
  ]);
  const sources = new sourceAdapter.DrizzleSourceRepository(database.db);
  const productionBatches = new ProductionBatchService(new batchAdapter.DrizzleProductionBatchRepository(database.db));
  const scheduler = new schedulerModule.SourceSyncScheduler({
    repository: new scheduleAdapter.DrizzleSourceSyncSchedulerRepository(database.db),
    adapter: new KongOwnedSourceAdapter(new HttpKongSourceReader()),
    sourceRepository: sources,
    eligibilityReview: new SourceEligibilityReviewService(sources),
    sourceToBatch: new SourceToBatchAutomationService(productionBatches),
  });
  await runSourceSyncLoop({
    scheduler,
    scope: { ownerUserId, workspaceId: "personal" },
    workerId: `kong-source-sync-${process.pid}-${randomUUID()}`,
    signal,
  });
}

function assertLoopOptions(options: SourceSyncLoopOptions): void {
  if (!options.scope.ownerUserId.trim() || !options.scope.workspaceId.trim()
    || !options.workerId.trim() || options.workerId.length > 128
    || !positive(options.syncIntervalMs ?? KONG_SOURCE_SYNC_INTERVAL_MS)
    || !positive(options.idleBackoffMs ?? WORKER_IDLE_BACKOFF_MS)
    || !positive(options.reconciliationIntervalMs ?? LEASE_RECONCILIATION_INTERVAL_MS)) {
    throw new Error("Invalid production source sync loop settings");
  }
}

function positive(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0;
}

function abortableSleep(milliseconds: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) { resolve(); return; }
    const timeout = setTimeout(done, milliseconds);
    function done() {
      clearTimeout(timeout);
      signal.removeEventListener("abort", done);
      resolve();
    }
    signal.addEventListener("abort", done, { once: true });
  });
}
