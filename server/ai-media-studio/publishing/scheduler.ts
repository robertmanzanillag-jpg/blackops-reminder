import type { PublicationJob, TenantScope } from "./domain";
import type { PublishingClock, PublishingProvider, PublishingRepository } from "./ports";
import { publishingRetryDelayMs, type PublishingRetryPolicy, type PublishingWorker, type PublishingWorkerResult } from "./worker";

/** Explicit tick-based scheduler. It never creates timers or starts a background loop. */
export class PublishingScheduler {
  constructor(private readonly worker: PublishingWorker) {}
  async runOnce(): Promise<PublishingWorkerResult> { return this.worker.runNext(); }
  async reconcileOnce(): Promise<number> { return this.worker.reconcileExpiredLeases(); }
}

/** Reconciles already-submitted work without exposing provider references to callers. */
export class PublishingReconciler {
  private readonly providers: ReadonlyMap<PublicationJob["preview"]["platform"], PublishingProvider>;
  constructor(
    private readonly repository: PublishingRepository,
    providers: readonly PublishingProvider[],
    private readonly clock: PublishingClock = { now: () => Date.now() },
    private readonly retry: PublishingRetryPolicy = { baseDelayMs: 30_000, maxDelayMs: 30 * 60_000, jitterRatio: 0.2 },
    private readonly random: () => number = Math.random,
  ) {
    this.providers = new Map(providers.map((provider) => [provider.platform, provider]));
  }

  async reconcileTenant(scope: TenantScope): Promise<{ checked: number; published: number; failed: number }> {
    let checked = 0, published = 0, failed = 0;
    for (const job of await this.repository.list(scope)) {
      if (job.state !== "submitted" || !job.submission) continue;
      const provider = this.providers.get(job.preview.platform);
      if (!provider?.reconcile) continue;
      checked += 1;
      let status: "pending" | "published" | "failed";
      let failure = "Publishing provider reported a failed submission";
      try {
        status = await provider.reconcile(job.submission.providerSubmissionId, {
          publicationId: job.id, scope: job.scope, platform: job.preview.platform,
          idempotencyKey: job.submission.idempotencyKey,
        });
      } catch (error) {
        status = "failed";
        failure = error instanceof Error ? error.message : "Publishing reconciliation failed";
      }
      if (status === "published") {
        const result = await this.repository.markPublished({ scope, publicationId: job.id, providerSubmissionId: job.submission.providerSubmissionId, now: new Date(this.clock.now()).toISOString() });
        if (result) published += 1;
      } else if (status === "failed") {
        const now = new Date(this.clock.now()).toISOString();
        const retryAt = new Date(this.clock.now() + publishingRetryDelayMs(job.attempt, this.retry, this.random)).toISOString();
        const result = await this.repository.recordReconciliationFailure({
          scope, publicationId: job.id, providerSubmissionId: job.submission.providerSubmissionId,
          expectedAttempt: job.attempt, error: failure, retryAt, now,
        });
        if (result) failed += 1;
      }
    }
    return { checked, published, failed };
  }
}
