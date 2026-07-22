import { randomUUID } from "node:crypto";
import {
  assertScheduledForInFuture,
  PublishingInvariantError,
  PublishingNotFoundError,
  assertPreviewUnchanged,
  assertValidApproval,
  tenantKey,
  type ManualApprovalEvidence,
  type ManualRejectionEvidence,
  type PublicationJob,
  type PublishingSchedule,
  type TenantScope,
} from "./domain";
import type { CreatePublicationRecord, PublishingLeaseRecovery, PublishingRepository } from "./ports";

const clone = <T>(value: T): T => structuredClone(value);
const key = (scope: TenantScope, id: string) => `${tenantKey(scope)}:${id}`;

export class InMemoryPublishingRepository implements PublishingRepository {
  private readonly values = new Map<string, PublicationJob>();
  private readonly idempotency = new Map<string, string>();

  async create(input: CreatePublicationRecord): Promise<PublicationJob> {
    assertPreviewUnchanged(input.preview);
    if (input.preview.scheduledFor) assertScheduledForInFuture(input.preview.scheduledFor, input.now);
    if (input.maxAttempts < 1 || input.maxLeaseRecoveries < 1) throw new PublishingInvariantError("Retry limits must be positive");
    const idemKey = key(input.scope, input.idempotencyKey);
    const existingId = this.idempotency.get(idemKey);
    if (existingId) return this.required(input.scope, existingId);
    const direct = this.values.get(key(input.scope, input.id));
    if (direct) throw new PublishingInvariantError("Publication id already exists");
    const job: PublicationJob = {
      id: input.id,
      scope: clone(input.scope),
      preview: clone(input.preview),
      state: "pending_approval",
      idempotencyKey: input.idempotencyKey,
      attempt: 0,
      maxAttempts: input.maxAttempts,
      availableAt: input.now,
      createdAt: input.now,
      updatedAt: input.now,
      leaseRecoveries: 0,
      maxLeaseRecoveries: input.maxLeaseRecoveries,
    };
    this.values.set(key(input.scope, input.id), job);
    this.idempotency.set(idemKey, input.id);
    return clone(job);
  }

  async get(scope: TenantScope, publicationId: string): Promise<PublicationJob | undefined> {
    const value = this.values.get(key(scope, publicationId));
    return value ? clone(value) : undefined;
  }

  async getByIdempotencyKey(scope: TenantScope, idempotencyKey: string): Promise<PublicationJob | undefined> {
    const id = this.idempotency.get(key(scope, idempotencyKey));
    return id ? this.get(scope, id) : undefined;
  }

  async list(scope: TenantScope): Promise<PublicationJob[]> {
    return [...this.values.values()].filter((job) => tenantKey(job.scope) === tenantKey(scope))
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id)).map(clone);
  }

  async countPublished(scope: TenantScope): Promise<number> {
    let count = 0;
    for (const job of this.values.values()) {
      if (tenantKey(job.scope) === tenantKey(scope) && job.state === "published") count += 1;
    }
    return count;
  }

  async approve(scope: TenantScope, publicationId: string, evidence: ManualApprovalEvidence, now: string): Promise<PublicationJob> {
    const job = this.mutable(scope, publicationId);
    if (job.state !== "pending_approval") throw new PublishingInvariantError("Only a pending preview can be approved");
    if (evidence.method !== "manual" || evidence.decision !== "approved" || evidence.previewDigest !== job.preview.digest) {
      throw new PublishingInvariantError("Manual approval must bind the immutable preview digest");
    }
    if (job.preview.scheduledFor) assertScheduledForInFuture(job.preview.scheduledFor, now);
    job.approval = clone(evidence);
    job.state = job.preview.scheduledFor ? "approved" : "queued";
    job.updatedAt = now;
    assertValidApproval(job);
    return clone(job);
  }

  async approveScheduled(scope: TenantScope, publicationId: string, evidence: ManualApprovalEvidence, schedule: PublishingSchedule, now: string): Promise<PublicationJob> {
    const job = this.mutable(scope, publicationId);
    if (job.state === "scheduled") {
      if (job.preview.digest === evidence.previewDigest && job.approval?.previewDigest === evidence.previewDigest
        && job.schedule?.scheduledFor === schedule.scheduledFor && job.schedule.timezone === schedule.timezone) return clone(job);
      throw new PublishingInvariantError("Scheduled approval replay does not match the durable decision");
    }
    if (job.state !== "pending_approval") throw new PublishingInvariantError("Only a pending preview can be approved and scheduled");
    if (evidence.method !== "manual" || evidence.decision !== "approved" || evidence.previewDigest !== job.preview.digest) {
      throw new PublishingInvariantError("Manual approval must bind the immutable preview digest");
    }
    if (job.preview.scheduledFor !== schedule.scheduledFor || job.preview.timezone !== schedule.timezone) {
      throw new PublishingInvariantError("Schedule must match the approved preview digest");
    }
    assertScheduledForInFuture(schedule.scheduledFor, now);
    job.approval = clone(evidence);
    job.schedule = clone(schedule);
    job.availableAt = schedule.scheduledFor;
    job.state = "scheduled";
    job.updatedAt = now;
    assertValidApproval(job);
    return clone(job);
  }

  async reject(scope: TenantScope, publicationId: string, evidence: ManualRejectionEvidence, now: string): Promise<PublicationJob> {
    const job = this.mutable(scope, publicationId);
    if (job.state !== "pending_approval" && job.state !== "approved") throw new PublishingInvariantError("Only a pending or approved preview can be rejected");
    if (evidence.method !== "manual" || evidence.decision !== "rejected" || !evidence.rejectedByUserId.trim() || !evidence.reason.trim() || evidence.previewDigest !== job.preview.digest) {
      throw new PublishingInvariantError("Manual rejection requires an actor, reason, and matching preview digest");
    }
    job.rejection = clone({ ...evidence, reason: evidence.reason.trim() });
    delete job.approval;
    job.state = "rejected";
    job.updatedAt = now;
    return clone(job);
  }

  async retry(scope: TenantScope, publicationId: string, now: string): Promise<PublicationJob> {
    const job = this.mutable(scope, publicationId);
    if (!["failed", "dead_letter", "retry_wait"].includes(job.state)) throw new PublishingInvariantError("Only failed publishing work can be retried");
    assertValidApproval(job);
    job.state = "queued";
    job.availableAt = now;
    job.updatedAt = now;
    delete job.lastError;
    delete job.deadLetteredAt;
    delete job.leaseOwner;
    delete job.leaseToken;
    delete job.leaseExpiresAt;
    return clone(job);
  }

  async schedule(scope: TenantScope, publicationId: string, schedule: PublishingSchedule, now: string): Promise<PublicationJob> {
    const job = this.mutable(scope, publicationId);
    if (job.state !== "approved") throw new PublishingInvariantError("Only an approved publication can be scheduled");
    assertValidApproval(job);
    if (job.preview.scheduledFor !== schedule.scheduledFor || job.preview.timezone !== schedule.timezone) {
      throw new PublishingInvariantError("Schedule must match the approved preview digest");
    }
    assertScheduledForInFuture(schedule.scheduledFor, now);
    job.schedule = clone(schedule);
    job.availableAt = schedule.scheduledFor;
    job.state = "scheduled";
    job.updatedAt = now;
    return clone(job);
  }

  async cancel(scope: TenantScope, publicationId: string, now: string): Promise<PublicationJob> {
    const job = this.mutable(scope, publicationId);
    if (["leased", "submitted", "published", "dead_letter", "cancelled"].includes(job.state)) {
      throw new PublishingInvariantError("Publication can no longer be canceled safely");
    }
    job.state = "cancelled";
    job.canceledAt = now;
    job.updatedAt = now;
    return clone(job);
  }

  async claimDue(input: { workerId: string; now: string; leaseDurationMs: number; enabledTenantKeys: ReadonlySet<string>; enabledPlatforms?: ReadonlySet<PublicationJob["preview"]["platform"]> }): Promise<{ job: PublicationJob; leaseToken: string } | undefined> {
    if (!input.workerId.trim() || input.leaseDurationMs <= 0) throw new PublishingInvariantError("A worker and positive lease are required");
    const due = [...this.values.values()]
      .filter((job) => (job.state === "scheduled" || job.state === "queued" || job.state === "retry_wait") && Date.parse(job.availableAt) <= Date.parse(input.now))
      .filter((job) => input.enabledTenantKeys.has(tenantKey(job.scope)))
      .filter((job) => !input.enabledPlatforms || input.enabledPlatforms.has(job.preview.platform))
      .sort((a, b) => a.availableAt.localeCompare(b.availableAt) || a.id.localeCompare(b.id))[0];
    if (!due) return undefined;
    assertValidApproval(due);
    const leaseToken = randomUUID();
    due.state = "leased";
    due.attempt += 1;
    due.leaseOwner = input.workerId;
    due.leaseToken = leaseToken;
    due.leaseExpiresAt = new Date(Date.parse(input.now) + input.leaseDurationMs).toISOString();
    due.updatedAt = input.now;
    return { job: clone(due), leaseToken };
  }

  async markSubmitted(input: { scope: TenantScope; publicationId: string; leaseToken: string; providerSubmissionId: string; idempotencyKey: string; now: string }): Promise<PublicationJob | undefined> {
    const job = this.values.get(key(input.scope, input.publicationId));
    if (!this.hasActiveLease(job, input.leaseToken, input.now)) return undefined;
    job.state = "submitted";
    job.submission = { providerSubmissionId: input.providerSubmissionId, idempotencyKey: input.idempotencyKey, submittedAt: input.now };
    job.updatedAt = input.now;
    this.clearLease(job);
    return clone(job);
  }

  async markPublished(input: { scope: TenantScope; publicationId: string; providerSubmissionId: string; now: string }): Promise<PublicationJob | undefined> {
    const job = this.values.get(key(input.scope, input.publicationId));
    if (!job || job.state !== "submitted" || job.submission?.providerSubmissionId !== input.providerSubmissionId) return undefined;
    job.state = "published";
    job.publishedAt = input.now;
    job.updatedAt = input.now;
    return clone(job);
  }

  async recordFailure(input: { scope: TenantScope; publicationId: string; leaseToken: string; error: string; retryable: boolean; retryAt: string; now: string }): Promise<PublicationJob | undefined> {
    const job = this.values.get(key(input.scope, input.publicationId));
    if (!this.hasActiveLease(job, input.leaseToken, input.now)) return undefined;
    job.lastError = input.error.slice(0, 1_000);
    job.updatedAt = input.now;
    this.clearLease(job);
    if (!input.retryable || job.attempt >= job.maxAttempts) {
      job.state = "dead_letter";
      job.deadLetteredAt = input.now;
    } else {
      job.state = "retry_wait";
      job.availableAt = input.retryAt;
    }
    return clone(job);
  }

  async recordReconciliationFailure(input: { scope: TenantScope; publicationId: string; providerSubmissionId: string; expectedAttempt: number; error: string; retryAt: string; now: string }): Promise<PublicationJob | undefined> {
    const job = this.values.get(key(input.scope, input.publicationId));
    if (!job || job.state !== "submitted" || job.attempt !== input.expectedAttempt || job.submission?.providerSubmissionId !== input.providerSubmissionId) return undefined;
    job.lastError = input.error.slice(0, 1_000);
    job.updatedAt = input.now;
    delete job.submission;
    if (job.attempt >= job.maxAttempts) {
      job.state = "dead_letter";
      job.deadLetteredAt = input.now;
    } else {
      job.state = "retry_wait";
      job.availableAt = input.retryAt;
    }
    return clone(job);
  }

  async reconcileExpiredLeases(now: string): Promise<PublishingLeaseRecovery[]> {
    const recoveries: PublishingLeaseRecovery[] = [];
    for (const job of this.values.values()) {
      if (job.state !== "leased" || !job.leaseExpiresAt || Date.parse(job.leaseExpiresAt) > Date.parse(now)) continue;
      const previousOwner = job.leaseOwner ?? "unknown";
      job.leaseRecoveries += 1;
      const deadLettered = job.leaseRecoveries >= job.maxLeaseRecoveries;
      job.state = deadLettered ? "dead_letter" : "scheduled";
      if (deadLettered) job.deadLetteredAt = now;
      job.updatedAt = now;
      this.clearLease(job);
      recoveries.push({ publicationId: job.id, previousOwner, deadLettered });
    }
    return recoveries;
  }

  async listDeadLetters(scope: TenantScope): Promise<PublicationJob[]> {
    return (await this.list(scope)).filter((job) => job.state === "dead_letter");
  }

  private mutable(scope: TenantScope, id: string): PublicationJob {
    const value = this.values.get(key(scope, id));
    if (!value) throw new PublishingNotFoundError("Publication not found");
    return value;
  }

  private async required(scope: TenantScope, id: string): Promise<PublicationJob> {
    const value = await this.get(scope, id);
    if (!value) throw new PublishingNotFoundError("Publication not found");
    return value;
  }

  private hasActiveLease(job: PublicationJob | undefined, token: string, now: string): job is PublicationJob {
    return Boolean(job && job.state === "leased" && job.leaseToken === token && job.leaseExpiresAt && Date.parse(job.leaseExpiresAt) > Date.parse(now));
  }

  private clearLease(job: PublicationJob): void {
    delete job.leaseOwner;
    delete job.leaseToken;
    delete job.leaseExpiresAt;
  }
}
