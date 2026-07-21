import { createHash } from "node:crypto";
import { GovernanceGateError } from "../governance/contracts";
import type {
  RenderClock,
  ProviderSubmission,
  RenderQuotaPolicy,
  RenderRandom,
  RenderSubmissionProvider,
  RenderWorkerHooks,
  RenderWorkItem,
  RenderWorkRepository,
} from "./contracts";

export interface RenderRetryPolicy {
  baseDelayMs: number;
  maxDelayMs: number;
  jitterRatio: number;
  isRetryable?: (error: unknown) => boolean;
}

/**
 * Mandatory last-mile policy check. Durable compositions must resolve all
 * evidence from trusted server-side repositories; the claimed payload is only
 * the subject of the check and is never itself evidence.
 */
export interface RenderSubmissionGate<TPayload> {
  assertCanSubmit(item: Readonly<RenderWorkItem<TPayload>>): void | Promise<void>;
}

export interface RenderWorkerOptions<TPayload> {
  workerId: string;
  repository: RenderWorkRepository<TPayload>;
  providers: readonly RenderSubmissionProvider<TPayload>[];
  quotas: RenderQuotaPolicy;
  leaseDurationMs: number;
  retry: RenderRetryPolicy;
  submissionGate: RenderSubmissionGate<TPayload>;
  clock?: RenderClock;
  random?: RenderRandom;
  hooks?: RenderWorkerHooks<TPayload>;
}

export type RenderWorkerResult<TPayload> =
  | { outcome: "idle" }
  | { outcome: "submitted" | "retry_scheduled" | "dead_letter" | "lease_lost"; item: RenderWorkItem<TPayload> };

const systemClock: RenderClock = { now: () => Date.now() };

export function providerIdempotencyKey(workId: string, attempt: number): string {
  return createHash("sha256").update(`render:${workId}:attempt:${attempt}`).digest("hex");
}

export function retryDelayMs(attempt: number, policy: RenderRetryPolicy, random: RenderRandom): number {
  const exponential = Math.min(policy.maxDelayMs, policy.baseDelayMs * (2 ** Math.max(0, attempt - 1)));
  const boundedRandom = Math.max(0, Math.min(1, random()));
  const jitter = exponential * policy.jitterRatio * ((boundedRandom * 2) - 1);
  return Math.max(0, Math.min(policy.maxDelayMs, Math.round(exponential + jitter)));
}

export class RenderWorker<TPayload = unknown> {
  private readonly providers: ReadonlyMap<string, RenderSubmissionProvider<TPayload>>;
  private readonly clock: RenderClock;
  private readonly random: RenderRandom;

  constructor(private readonly options: RenderWorkerOptions<TPayload>) {
    if (!options.workerId || options.leaseDurationMs <= 0) throw new Error("Worker identity and a positive lease duration are required");
    if (options.retry.baseDelayMs < 0 || options.retry.maxDelayMs < options.retry.baseDelayMs) throw new Error("Invalid retry delay bounds");
    if (options.retry.jitterRatio < 0 || options.retry.jitterRatio > 1) throw new Error("jitterRatio must be between zero and one");
    this.providers = new Map(options.providers.map((provider) => [provider.key, provider]));
    this.clock = options.clock ?? systemClock;
    this.random = options.random ?? Math.random;
  }

  async reconcile(): Promise<number> {
    const recoveries = await this.options.repository.reconcileExpiredLeases(this.clock.now());
    for (const recovery of recoveries) {
      await this.options.hooks?.onLeaseRecovered?.(recovery);
      if (recovery.deadLettered) {
        const item = await this.options.repository.get(recovery.workId);
        if (item) await this.options.hooks?.onDeadLetter?.(item);
      }
    }
    return recoveries.length;
  }

  async runNext(): Promise<RenderWorkerResult<TPayload>> {
    await this.reconcile();
    const claim = await this.options.repository.claimDue({
      workerId: this.options.workerId,
      nowMs: this.clock.now(),
      leaseDurationMs: this.options.leaseDurationMs,
      quotas: this.options.quotas,
    });
    if (!claim) return { outcome: "idle" };

    const provider = this.providers.get(claim.item.providerKey);
    let submission: ProviderSubmission;
    try {
      if (!provider) throw new PermanentRenderFailure(`Unknown render provider: ${claim.item.providerKey}`);
      // Keep this immediately adjacent to provider.submit. Creation, enqueue,
      // retry, or an earlier worker check can all become stale while queued.
      await this.options.submissionGate.assertCanSubmit(claim.item);
      submission = await provider.submit(claim.item.payload, {
        workId: claim.item.id,
        tenantId: claim.item.tenantId,
        attempt: claim.item.attempt,
        idempotencyKey: providerIdempotencyKey(claim.item.id, claim.item.attempt),
      });
      if (!submission.providerSubmissionId) throw new Error("Provider returned no submission id");
    } catch (error) {
      const nowMs = this.clock.now();
      const retryable = !(error instanceof PermanentRenderFailure)
        && !(error instanceof GovernanceGateError)
        && (this.options.retry.isRetryable?.(error) ?? true);
      const result = await this.options.repository.recordFailure({
        workId: claim.item.id,
        leaseToken: claim.leaseToken,
        error: renderErrorMessage(error),
        retryable,
        retryAtMs: nowMs + retryDelayMs(claim.item.attempt, this.options.retry, this.random),
        nowMs,
      });
      if (!result) {
        await this.options.hooks?.onLeaseLost?.(claim.item);
        return { outcome: "lease_lost", item: claim.item };
      }
      if (result.deadLettered) {
        await this.options.hooks?.onDeadLetter?.(result.item);
        return { outcome: "dead_letter", item: result.item };
      }
      await this.options.hooks?.onRetryScheduled?.(result.item);
      return { outcome: "retry_scheduled", item: result.item };
    }

    // Persistence and hooks are deliberately outside the provider failure catch.
    // A repository outage must leave the lease recoverable with the same idempotency key,
    // rather than being misclassified as a provider attempt failure.
    const item = await this.options.repository.markSubmitted({
      workId: claim.item.id,
      leaseToken: claim.leaseToken,
      providerSubmissionId: submission.providerSubmissionId,
      nowMs: this.clock.now(),
    });
    if (!item) {
      // The external submission already exists. Preserve its identity in the
      // hook/result even though the lease fencing token can no longer commit.
      const uncommittedSubmission: RenderWorkItem<TPayload> = {
        ...claim.item,
        state: "submitted",
        providerSubmissionId: submission.providerSubmissionId,
        updatedAtMs: this.clock.now(),
      };
      await this.options.hooks?.onLeaseLost?.(uncommittedSubmission);
      return { outcome: "lease_lost", item: uncommittedSubmission };
    }
    await this.options.hooks?.onSubmitted?.(item);
    return { outcome: "submitted", item };
  }
}

export class PermanentRenderFailure extends Error {}

function renderErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message.slice(0, 1_000);
  return "Render provider submission failed";
}
