import {
  automaticPublishingAllowed,
  providerPublishIdempotencyKey,
  PublishingPolicyDeniedError,
  type AutomaticPublishingPolicy,
  type PublicationJob,
  type PublishingPlatform,
} from "./domain";
import type { PublishingClock, PublishingProvider, PublishingRepository } from "./ports";
import { GovernanceGateError } from "../governance/contracts";

export interface PublishingRetryPolicy {
  baseDelayMs: number;
  maxDelayMs: number;
  jitterRatio: number;
  isRetryable?: (error: unknown) => boolean;
}

/** Trusted, server-side last-mile authorization. It must not rely on request-supplied evidence. */
export interface PublishingSubmissionGate {
  assertCanSubmit(job: Readonly<PublicationJob>): void | Promise<void>;
}

export interface PublishingWorkerOptions {
  workerId: string;
  repository: PublishingRepository;
  providers: readonly PublishingProvider[];
  submissionGate: PublishingSubmissionGate;
  policy?: AutomaticPublishingPolicy;
  leaseDurationMs: number;
  retry: PublishingRetryPolicy;
  clock?: PublishingClock;
  random?: () => number;
}

export type PublishingWorkerResult =
  | { outcome: "disabled" | "idle" }
  | { outcome: "submitted" | "retry_scheduled" | "dead_letter" | "lease_lost"; publication: PublicationJob };

const systemClock: PublishingClock = { now: () => Date.now() };

export class PublishingWorker {
  private readonly providers: ReadonlyMap<PublishingPlatform, PublishingProvider>;
  private readonly clock: PublishingClock;
  private readonly random: () => number;

  constructor(private readonly options: PublishingWorkerOptions) {
    if (!options.workerId.trim() || options.leaseDurationMs <= 0) throw new Error("Worker identity and a positive lease are required");
    if (options.retry.baseDelayMs < 0 || options.retry.maxDelayMs < options.retry.baseDelayMs || options.retry.jitterRatio < 0 || options.retry.jitterRatio > 1) {
      throw new Error("Invalid publishing retry policy");
    }
    if (!options.submissionGate) throw new Error("A publishing submission governance gate is required");
    this.providers = new Map(options.providers.map((provider) => [provider.platform, provider]));
    this.clock = options.clock ?? systemClock;
    this.random = options.random ?? Math.random;
  }

  async reconcileExpiredLeases(): Promise<number> {
    return (await this.options.repository.reconcileExpiredLeases(this.now())).length;
  }

  async runNext(): Promise<PublishingWorkerResult> {
    const policy = this.options.policy;
    // The kill switch is checked before any claim or provider access.
    if (!policy?.automaticPublishingEnabled || !policy.enabledTenantKeys?.size) return { outcome: "disabled" };
    await this.reconcileExpiredLeases();
    const claim = await this.options.repository.claimDue({
      workerId: this.options.workerId,
      now: this.now(),
      leaseDurationMs: this.options.leaseDurationMs,
      enabledTenantKeys: policy.enabledTenantKeys,
      enabledPlatforms: policy.enabledPlatforms,
    });
    if (!claim) return { outcome: "idle" };
    if (!automaticPublishingAllowed(policy, claim.job)) {
      return this.failClaim(claim.job, claim.leaseToken, new PermanentPublishingFailure("Publishing policy or approval denied submission"));
    }
    const provider = this.providers.get(claim.job.preview.platform);
    const idempotencyKey = providerPublishIdempotencyKey(claim.job);
    try {
      if (!provider) throw new PermanentPublishingFailure(`No provider is configured for ${claim.job.preview.platform}`);
      // Revalidate immediately before the external side effect so an approval,
      // consent, rights, or quality revocation cannot race a queued publication.
      await this.options.submissionGate.assertCanSubmit(claim.job);
      const submission = await provider.submit(claim.job.preview, {
        publicationId: claim.job.id,
        scope: claim.job.scope,
        platform: claim.job.preview.platform,
        idempotencyKey,
        attempt: claim.job.attempt,
      });
      if (!submission.providerSubmissionId) throw new Error("Provider returned no submission reference");
      const committed = await this.options.repository.markSubmitted({
        scope: claim.job.scope, publicationId: claim.job.id, leaseToken: claim.leaseToken,
        providerSubmissionId: submission.providerSubmissionId, idempotencyKey, now: this.now(),
      });
      if (!committed) return { outcome: "lease_lost", publication: claim.job };
      return { outcome: "submitted", publication: committed };
    } catch (error) {
      return this.failClaim(claim.job, claim.leaseToken, error);
    }
  }

  private async failClaim(job: PublicationJob, leaseToken: string, error: unknown): Promise<PublishingWorkerResult> {
    const retryable = !(error instanceof PermanentPublishingFailure)
      && !(error instanceof PublishingPolicyDeniedError)
      && !(error instanceof GovernanceGateError)
      && (this.options.retry.isRetryable?.(error) ?? true);
    const retryAt = new Date(this.clock.now() + publishingRetryDelayMs(job.attempt, this.options.retry, this.random)).toISOString();
    const failed = await this.options.repository.recordFailure({
      scope: job.scope, publicationId: job.id, leaseToken,
      error: error instanceof Error ? error.message : "Publishing provider failed",
      retryable, retryAt, now: this.now(),
    });
    if (!failed) return { outcome: "lease_lost", publication: job };
    return { outcome: failed.state === "dead_letter" ? "dead_letter" : "retry_scheduled", publication: failed };
  }

  private now(): string { return new Date(this.clock.now()).toISOString(); }
}

export class PermanentPublishingFailure extends Error {}

export function publishingRetryDelayMs(attempt: number, policy: PublishingRetryPolicy, random: () => number): number {
  const base = Math.min(policy.maxDelayMs, policy.baseDelayMs * (2 ** Math.max(0, attempt - 1)));
  const bounded = Math.max(0, Math.min(1, random()));
  return Math.max(0, Math.min(policy.maxDelayMs, Math.round(base + base * policy.jitterRatio * ((bounded * 2) - 1))));
}
