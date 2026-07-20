import {
  assertScheduledForInFuture,
  createPublishingPreview,
  newPublicationId,
  normalizeInstant,
  publicationIdempotencyKey,
  PublishingInvariantError,
  toPublicPublication,
  validateTimeZone,
  type ManualApprovalEvidence,
  type ManualRejectionEvidence,
  type PublicPublication,
  type PublishingPreview,
  type PublishingPreviewInput,
  type TenantScope,
} from "./domain";
import type { PublishingClock, PublishingRepository } from "./ports";

const systemClock: PublishingClock = { now: () => Date.now() };

export class PublishingService {
  private readonly clock: PublishingClock;
  constructor(private readonly repository: PublishingRepository, clock?: PublishingClock) { this.clock = clock ?? systemClock; }

  createPreview(input: PublishingPreviewInput): PublishingPreview {
    const preview = createPublishingPreview(input);
    if (preview.scheduledFor) {
      assertScheduledForInFuture(preview.scheduledFor, new Date(this.clock.now()).toISOString());
    }
    return preview;
  }

  async createDraft(scope: TenantScope, input: PublishingPreviewInput, requestIdempotencyKey: string): Promise<PublicPublication> {
    const idempotencyKey = publicationIdempotencyKey(scope, requestIdempotencyKey);
    const preview = this.createPreview(input);
    const existing = await this.repository.getByIdempotencyKey(scope, idempotencyKey);
    if (existing) {
      if (existing.preview.digest !== preview.digest) throw new PublishingInvariantError("Idempotency key was already used for a different publishing preview");
      return toPublicPublication(existing);
    }
    const now = new Date(this.clock.now()).toISOString();
    const job = await this.repository.create({
      id: newPublicationId(), scope, preview, idempotencyKey,
      maxAttempts: 4, maxLeaseRecoveries: 3, now,
    });
    if (job.preview.digest !== preview.digest) throw new PublishingInvariantError("Idempotency key was already used for a different publishing preview");
    return toPublicPublication(job);
  }

  async approve(scope: TenantScope, publicationId: string, input: Omit<ManualApprovalEvidence, "decision" | "method" | "approvedAt">): Promise<PublicPublication> {
    const now = new Date(this.clock.now()).toISOString();
    const existing = await this.repository.get(scope, publicationId);
    if (existing?.preview.scheduledFor) assertScheduledForInFuture(existing.preview.scheduledFor, now);
    return toPublicPublication(await this.repository.approve(scope, publicationId, {
      ...input, decision: "approved", method: "manual", approvedAt: now,
    }, now));
  }

  async approveScheduled(scope: TenantScope, publicationId: string, input: Omit<ManualApprovalEvidence, "decision" | "method" | "approvedAt"> & { scheduledFor: string; timezone: string }): Promise<PublicPublication> {
    const scheduledFor = normalizeInstant(input.scheduledFor);
    validateTimeZone(input.timezone);
    const now = new Date(this.clock.now()).toISOString();
    const { timezone, previewDigest, approvedByUserId, note } = input;
    const evidence: ManualApprovalEvidence = {
      decision: "approved", method: "manual", approvedAt: now, approvedByUserId, previewDigest,
      ...(note !== undefined ? { note } : {}),
    };
    const existing = await this.repository.get(scope, publicationId);
    const exactReplay = existing?.state === "scheduled"
      && existing.preview.digest === previewDigest
      && existing.approval?.previewDigest === previewDigest
      && existing.schedule?.scheduledFor === scheduledFor
      && existing.schedule.timezone === timezone;
    if (!exactReplay) assertScheduledForInFuture(scheduledFor, now);
    return toPublicPublication(await this.repository.approveScheduled(scope, publicationId, evidence, { scheduledFor, timezone }, now));
  }

  async reject(scope: TenantScope, publicationId: string, input: Pick<ManualRejectionEvidence, "rejectedByUserId" | "previewDigest" | "reason">): Promise<PublicPublication> {
    const now = new Date(this.clock.now()).toISOString();
    return toPublicPublication(await this.repository.reject(scope, publicationId, {
      ...input, decision: "rejected", method: "manual", rejectedAt: now,
    }, now));
  }

  async retry(scope: TenantScope, publicationId: string): Promise<PublicPublication> {
    return toPublicPublication(await this.repository.retry(scope, publicationId, new Date(this.clock.now()).toISOString()));
  }

  async schedule(scope: TenantScope, publicationId: string, scheduledFor: string, timezone: string): Promise<PublicPublication> {
    const normalized = normalizeInstant(scheduledFor);
    validateTimeZone(timezone);
    const now = new Date(this.clock.now()).toISOString();
    assertScheduledForInFuture(normalized, now);
    return toPublicPublication(await this.repository.schedule(scope, publicationId, { scheduledFor: normalized, timezone }, now));
  }

  async cancel(scope: TenantScope, publicationId: string): Promise<PublicPublication> {
    return toPublicPublication(await this.repository.cancel(scope, publicationId, new Date(this.clock.now()).toISOString()));
  }

  async get(scope: TenantScope, publicationId: string): Promise<PublicPublication | undefined> {
    const job = await this.repository.get(scope, publicationId);
    return job ? toPublicPublication(job) : undefined;
  }

  async list(scope: TenantScope): Promise<PublicPublication[]> {
    return (await this.repository.list(scope)).map(toPublicPublication);
  }
}
