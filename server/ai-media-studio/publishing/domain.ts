import { createHash, randomUUID } from "node:crypto";

export const PUBLISHING_PLATFORMS = ["tiktok", "instagram", "facebook", "youtube_shorts"] as const;
export type PublishingPlatform = typeof PUBLISHING_PLATFORMS[number];

export interface TenantScope {
  ownerUserId: string;
  workspaceId: string;
}

export interface PublishingPreviewInput {
  assetId: string;
  assetDigest: string;
  caption: string;
  title?: string;
  hashtags: readonly string[];
  platform: PublishingPlatform;
  scheduledFor?: string;
  timezone?: string;
}

export interface PublishingPreview extends PublishingPreviewInput {
  digest: string;
}

export interface ManualApprovalEvidence {
  decision: "approved";
  method: "manual";
  approvedByUserId: string;
  approvedAt: string;
  previewDigest: string;
  note?: string;
}

export interface ManualRejectionEvidence {
  decision: "rejected";
  method: "manual";
  rejectedByUserId: string;
  rejectedAt: string;
  previewDigest: string;
  reason: string;
}

export interface PublishingSchedule {
  scheduledFor: string;
  timezone: string;
}

export type PublicationState =
  | "pending_approval"
  | "approved"
  | "queued"
  | "failed"
  | "rejected"
  | "scheduled"
  | "leased"
  | "retry_wait"
  | "submitted"
  | "published"
  | "cancelled"
  | "dead_letter";

export interface ProviderSubmissionTracking {
  /** Internal provider reference. Never expose this object from public APIs. */
  providerSubmissionId: string;
  submittedAt: string;
  idempotencyKey: string;
}

export interface PublicationJob {
  id: string;
  scope: TenantScope;
  preview: PublishingPreview;
  state: PublicationState;
  approval?: ManualApprovalEvidence;
  rejection?: ManualRejectionEvidence;
  schedule?: PublishingSchedule;
  idempotencyKey: string;
  attempt: number;
  maxAttempts: number;
  availableAt: string;
  createdAt: string;
  updatedAt: string;
  leaseOwner?: string;
  leaseToken?: string;
  leaseExpiresAt?: string;
  leaseRecoveries: number;
  maxLeaseRecoveries: number;
  submission?: ProviderSubmissionTracking;
  lastError?: string;
  deadLetteredAt?: string;
  publishedAt?: string;
  canceledAt?: string;
}

export interface PublicPublication {
  id: string;
  preview: PublishingPreview;
  state: PublicationState;
  approval?: ManualApprovalEvidence;
  rejection?: ManualRejectionEvidence;
  schedule?: PublishingSchedule;
  attempt: number;
  createdAt: string;
  updatedAt: string;
  submittedAt?: string;
  publishedAt?: string;
  canceledAt?: string;
  lastError?: string;
}

export interface AutomaticPublishingPolicy {
  /** Global emergency stop. Defaults to false at every composition boundary. */
  automaticPublishingEnabled: boolean;
  /** Explicit tenant-level grant. An absent tenant is denied. */
  enabledTenantKeys?: ReadonlySet<string>;
  enabledPlatforms?: ReadonlySet<PublishingPlatform>;
}

export class PublishingInvariantError extends Error {
  readonly statusCode = 409;
}

export class PublishingNotFoundError extends Error {
  readonly statusCode = 404;
}

export class PublishingPolicyDeniedError extends Error {
  readonly statusCode = 403;
}

function canonicalPreview(input: PublishingPreviewInput): PublishingPreviewInput {
  const scheduledFor = input.scheduledFor ? normalizeInstant(input.scheduledFor) : undefined;
  const timezone = input.timezone?.trim() || undefined;
  if ((scheduledFor && !timezone) || (!scheduledFor && timezone)) {
    throw new PublishingInvariantError("scheduledFor and timezone must be supplied together");
  }
  if (timezone) validateTimeZone(timezone);
  if (!PUBLISHING_PLATFORMS.includes(input.platform)) throw new PublishingInvariantError("Unsupported publishing platform");
  if (!input.assetId.trim() || !input.assetDigest.trim()) throw new PublishingInvariantError("Asset identity and digest are required");
  return {
    assetId: input.assetId.trim(),
    assetDigest: input.assetDigest.trim(),
    caption: input.caption.trim(),
    ...(input.title?.trim() ? { title: input.title.trim() } : {}),
    hashtags: input.hashtags.map((tag) => tag.trim().replace(/^#/, "")).filter(Boolean),
    platform: input.platform,
    ...(scheduledFor ? { scheduledFor } : {}),
    ...(timezone ? { timezone } : {}),
  };
}

export function createPublishingPreview(input: PublishingPreviewInput): PublishingPreview {
  const canonical = canonicalPreview(input);
  const digest = `sha256:${createHash("sha256").update(JSON.stringify({
    assetId: canonical.assetId,
    assetDigest: canonical.assetDigest,
    caption: canonical.caption,
    title: canonical.title ?? null,
    hashtags: canonical.hashtags,
    platform: canonical.platform,
    scheduledFor: canonical.scheduledFor ?? null,
    timezone: canonical.timezone ?? null,
  })).digest("hex")}`;
  return { ...canonical, digest };
}

export function assertPreviewUnchanged(preview: PublishingPreview): void {
  if (createPublishingPreview(preview).digest !== preview.digest) {
    throw new PublishingInvariantError("Publishing preview digest no longer matches its immutable content");
  }
}

export function assertValidApproval(job: PublicationJob): ManualApprovalEvidence {
  assertPreviewUnchanged(job.preview);
  const evidence = job.approval;
  if (!evidence || evidence.decision !== "approved" || evidence.method !== "manual" || !evidence.approvedByUserId.trim()) {
    throw new PublishingPolicyDeniedError("Manual approval evidence is required");
  }
  if (evidence.previewDigest !== job.preview.digest) {
    throw new PublishingPolicyDeniedError("Approval evidence does not bind the current preview");
  }
  normalizeInstant(evidence.approvedAt);
  return evidence;
}

export function tenantKey(scope: TenantScope): string {
  return JSON.stringify([scope.workspaceId, scope.ownerUserId]);
}

export function tenantScopeFromKey(value: string): TenantScope {
  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed) || parsed.length !== 2 || parsed.some((part) => typeof part !== "string")) throw new Error("invalid");
    const [workspaceId, ownerUserId] = parsed as [string, string];
    return { workspaceId, ownerUserId };
  } catch {
    throw new PublishingInvariantError("Tenant policy contains an invalid structured tenant key");
  }
}

export function automaticPublishingAllowed(policy: AutomaticPublishingPolicy | undefined, job: PublicationJob): boolean {
  if (!policy?.automaticPublishingEnabled) return false;
  if (!policy.enabledTenantKeys?.has(tenantKey(job.scope))) return false;
  if (policy.enabledPlatforms && !policy.enabledPlatforms.has(job.preview.platform)) return false;
  try {
    assertValidApproval(job);
    return true;
  } catch {
    return false;
  }
}

export function normalizeInstant(value: string): string {
  const epoch = Date.parse(value);
  if (!Number.isFinite(epoch)) throw new PublishingInvariantError("A valid ISO-8601 instant is required");
  if (!/(?:Z|[+-]\d{2}:\d{2})$/i.test(value)) throw new PublishingInvariantError("Scheduled timestamps must include an explicit UTC offset");
  return new Date(epoch).toISOString();
}

/**
 * Scheduling is a promise about future work, so equality is deliberately
 * rejected. Callers must pass the same injected-clock instant used for the
 * surrounding transition; this keeps HTTP, memory, and durable behavior
 * deterministic and prevents an already-due draft from being approved.
 */
export function assertScheduledForInFuture(scheduledFor: string, now: string): string {
  const normalizedScheduledFor = normalizeInstant(scheduledFor);
  const normalizedNow = normalizeInstant(now);
  if (Date.parse(normalizedScheduledFor) <= Date.parse(normalizedNow)) {
    throw new PublishingInvariantError("scheduledFor must be strictly in the future");
  }
  return normalizedScheduledFor;
}

export function validateTimeZone(value: string): void {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value }).format(0);
  } catch {
    throw new PublishingInvariantError("A valid IANA timezone is required");
  }
}

export function publicationIdempotencyKey(scope: TenantScope, requestKey: string): string {
  if (!requestKey.trim()) throw new PublishingInvariantError("An idempotency key is required");
  return createHash("sha256").update(`publish:${tenantKey(scope)}:${requestKey.trim()}`).digest("hex");
}

export function providerPublishIdempotencyKey(job: PublicationJob): string {
  return createHash("sha256").update(`publish:${tenantKey(job.scope)}:${job.id}:${job.preview.digest}`).digest("hex");
}

export function newPublicationId(): string {
  return randomUUID();
}

export function toPublicPublication(job: PublicationJob): PublicPublication {
  return {
    id: job.id,
    preview: structuredClone(job.preview),
    state: job.state,
    ...(job.approval ? { approval: structuredClone(job.approval) } : {}),
    ...(job.rejection ? { rejection: structuredClone(job.rejection) } : {}),
    ...(job.schedule ? { schedule: structuredClone(job.schedule) } : {}),
    attempt: job.attempt,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    ...(job.submission ? { submittedAt: job.submission.submittedAt } : {}),
    ...(job.publishedAt ? { publishedAt: job.publishedAt } : {}),
    ...(job.canceledAt ? { canceledAt: job.canceledAt } : {}),
    ...(job.lastError ? { lastError: job.lastError } : {}),
  };
}
