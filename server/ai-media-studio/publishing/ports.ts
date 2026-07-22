import type {
  ManualApprovalEvidence,
  ManualRejectionEvidence,
  PublicationJob,
  PublishingPlatform,
  PublishingPreview,
  PublishingSchedule,
  TenantScope,
} from "./domain";

export interface CreatePublicationRecord {
  id: string;
  scope: TenantScope;
  preview: PublishingPreview;
  idempotencyKey: string;
  maxAttempts: number;
  maxLeaseRecoveries: number;
  now: string;
}

export interface PublishingLeaseRecovery {
  publicationId: string;
  previousOwner: string;
  deadLettered: boolean;
}

export interface PublishingRepository {
  create(input: CreatePublicationRecord): Promise<PublicationJob>;
  get(scope: TenantScope, publicationId: string): Promise<PublicationJob | undefined>;
  getByIdempotencyKey(scope: TenantScope, idempotencyKey: string): Promise<PublicationJob | undefined>;
  list(scope: TenantScope): Promise<PublicationJob[]>;
  /** Exact all-time aggregate for terminal, durably published jobs in one tenant. */
  countPublished(scope: TenantScope): Promise<number>;
  approve(scope: TenantScope, publicationId: string, evidence: ManualApprovalEvidence, now: string): Promise<PublicationJob>;
  approveScheduled(scope: TenantScope, publicationId: string, evidence: ManualApprovalEvidence, schedule: PublishingSchedule, now: string): Promise<PublicationJob>;
  reject(scope: TenantScope, publicationId: string, evidence: ManualRejectionEvidence, now: string): Promise<PublicationJob>;
  retry(scope: TenantScope, publicationId: string, now: string): Promise<PublicationJob>;
  schedule(scope: TenantScope, publicationId: string, schedule: PublishingSchedule, now: string): Promise<PublicationJob>;
  cancel(scope: TenantScope, publicationId: string, now: string): Promise<PublicationJob>;
  claimDue(input: { workerId: string; now: string; leaseDurationMs: number; enabledTenantKeys: ReadonlySet<string>; enabledPlatforms?: ReadonlySet<PublishingPlatform> }): Promise<{ job: PublicationJob; leaseToken: string } | undefined>;
  markSubmitted(input: { scope: TenantScope; publicationId: string; leaseToken: string; providerSubmissionId: string; idempotencyKey: string; now: string }): Promise<PublicationJob | undefined>;
  markPublished(input: { scope: TenantScope; publicationId: string; providerSubmissionId: string; now: string }): Promise<PublicationJob | undefined>;
  recordFailure(input: { scope: TenantScope; publicationId: string; leaseToken: string; error: string; retryable: boolean; retryAt: string; now: string }): Promise<PublicationJob | undefined>;
  recordReconciliationFailure(input: { scope: TenantScope; publicationId: string; providerSubmissionId: string; expectedAttempt: number; error: string; retryAt: string; now: string }): Promise<PublicationJob | undefined>;
  reconcileExpiredLeases(now: string): Promise<PublishingLeaseRecovery[]>;
  listDeadLetters(scope: TenantScope): Promise<PublicationJob[]>;
}

export interface PublishProviderContext {
  publicationId: string;
  scope: TenantScope;
  platform: PublishingPlatform;
  idempotencyKey: string;
  attempt: number;
}

export interface PublishingProvider {
  readonly platform: PublishingPlatform;
  submit(preview: PublishingPreview, context: PublishProviderContext): Promise<{ providerSubmissionId: string }>;
  reconcile?(providerSubmissionId: string, context: Omit<PublishProviderContext, "attempt">): Promise<"pending" | "published" | "failed">;
}

export interface PublishingClock { now(): number }
