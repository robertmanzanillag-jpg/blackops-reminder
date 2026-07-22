import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { aiMediaPublishingJobs } from "../../../shared/models/ai-media-studio-db";
import { PublishingInvariantError, PublishingNotFoundError, PublishingPersistenceError, assertPreviewUnchanged, assertScheduledForInFuture, assertValidApproval, tenantScopeFromKey, type ManualApprovalEvidence, type ManualRejectionEvidence, type PublicationJob, type PublishingPlatform, type PublishingSchedule, type TenantScope } from "./domain";
import type { CreatePublicationRecord, PublishingLeaseRecovery, PublishingRepository } from "./ports";

export type PublishingDatabase = Pick<NodePgDatabase, "execute" | "transaction">;
type DbExecutor = Pick<NodePgDatabase, "execute">;
type RawRow = Record<string, unknown>;
const rows = (result: unknown): RawRow[] => Array.isArray(result) ? result as RawRow[] : result && typeof result === "object" && Array.isArray((result as { rows?: unknown }).rows) ? (result as { rows: RawRow[] }).rows : [];
const object = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const date = (value: unknown): string => value instanceof Date ? value.toISOString() : new Date(String(value)).toISOString();

function mapRow(raw: RawRow): PublicationJob {
  const request = object(raw.request), preview = object(request.preview) as unknown as PublicationJob["preview"], metadata = object(request.__publishing);
  const decisionEvidence = raw.approvalEvidence ?? raw.approval_evidence, providerSubmissionId = metadata.providerSubmissionId;
  const rejection = object(decisionEvidence).decision === "rejected" ? decisionEvidence as ManualRejectionEvidence : undefined;
  const approval = object(decisionEvidence).decision === "approved" ? decisionEvidence as ManualApprovalEvidence : undefined;
  const persistedState = String(raw.status ?? raw.state);
  const state: PublicationJob["state"] = persistedState === "cancelled" && rejection ? "rejected"
    : persistedState === "pending_approval" && String(raw.approvalStatus ?? raw.approval_status) === "approved" ? "approved"
    : persistedState === "publishing" && providerSubmissionId ? "submitted"
      : persistedState === "publishing" ? "leased"
        : persistedState === "queued" && Number(raw.attempts ?? 0) > 0 && Boolean(raw.errorMessage ?? raw.error_message) ? "retry_wait"
          : persistedState === "queued" ? "queued"
          : persistedState as PublicationJob["state"];
  return {
    id: String(raw.id), scope: { ownerUserId: String(raw.ownerUserId ?? raw.owner_user_id), workspaceId: String(raw.workspaceId ?? raw.workspace_id) }, preview,
    state, ...(approval ? { approval } : {}), ...(rejection ? { rejection } : {}),
    ...(request.schedule ? { schedule: request.schedule as PublishingSchedule } : {}), idempotencyKey: String(raw.idempotencyKey ?? raw.idempotency_key),
    attempt: Number(raw.attempts ?? 0), maxAttempts: Number(raw.maxAttempts ?? raw.max_attempts ?? 1), availableAt: date(raw.availableAt ?? raw.available_at),
    createdAt: date(raw.createdAt ?? raw.created_at), updatedAt: date(raw.updatedAt ?? raw.updated_at),
    ...(raw.leaseOwner ?? raw.lease_owner ? { leaseOwner: String(raw.leaseOwner ?? raw.lease_owner) } : {}), ...(metadata.leaseToken ? { leaseToken: String(metadata.leaseToken) } : {}),
    ...(raw.leaseExpiresAt ?? raw.lease_expires_at ? { leaseExpiresAt: date(raw.leaseExpiresAt ?? raw.lease_expires_at) } : {}), leaseRecoveries: Number(metadata.leaseRecoveries ?? 0),
    maxLeaseRecoveries: Number(metadata.maxLeaseRecoveries ?? raw.maxAttempts ?? raw.max_attempts ?? 1),
    ...(providerSubmissionId ? { submission: { providerSubmissionId: String(providerSubmissionId), submittedAt: String(metadata.submittedAt), idempotencyKey: String(metadata.providerIdempotencyKey) } } : {}),
    ...(raw.errorMessage ?? raw.error_message ? { lastError: String(raw.errorMessage ?? raw.error_message) } : {}),
    ...(raw.deadLetterAt ?? raw.dead_letter_at ? { deadLetteredAt: date(raw.deadLetterAt ?? raw.dead_letter_at) } : {}),
    ...(raw.completedAt ?? raw.completed_at ? { publishedAt: date(raw.completedAt ?? raw.completed_at) } : {}), ...(metadata.canceledAt ? { canceledAt: String(metadata.canceledAt) } : {}),
  };
}

/** Durable PostgreSQL repository. Mutations always include tenant scope and fenced lease writes. */
export class DrizzlePublishingRepository implements PublishingRepository {
  constructor(
    private readonly db: PublishingDatabase,
    private readonly assertOwnedMediaAsset: (scope: TenantScope, mediaAssetId: string) => Promise<void>,
  ) {}
  async create(input: CreatePublicationRecord): Promise<PublicationJob> {
    assertPreviewUnchanged(input.preview);
    if (input.preview.scheduledFor) assertScheduledForInFuture(input.preview.scheduledFor, input.now);
    await this.assertOwnedMediaAsset(input.scope, input.preview.assetId);
    const request = { preview: input.preview, __publishing: { leaseRecoveries: 0, maxLeaseRecoveries: input.maxLeaseRecoveries } };
    const result = await this.db.execute(sql`INSERT INTO ${aiMediaPublishingJobs} (id, owner_user_id, workspace_id, video_id, media_asset_id, platform, mode, idempotency_key, status, approval_status, preview_digest, available_at, attempts, max_attempts, request, created_at, updated_at) VALUES (${input.id}, ${input.scope.ownerUserId}, ${input.scope.workspaceId}, NULL, ${input.preview.assetId}, ${input.preview.platform}, ${input.preview.scheduledFor ? "scheduled" : "manual"}, ${input.idempotencyKey}, 'pending_approval', 'required', ${input.preview.digest}, ${new Date(input.now)}, 0, ${input.maxAttempts}, ${JSON.stringify(request)}::jsonb, ${new Date(input.now)}, ${new Date(input.now)}) ON CONFLICT (owner_user_id, workspace_id, idempotency_key) DO NOTHING RETURNING *`);
    const inserted = rows(result)[0]; if (inserted) return mapRow(inserted);
    const existing = await this.getByIdempotencyKey(input.scope, input.idempotencyKey); if (!existing) throw new PublishingInvariantError("Publishing idempotency collision is outside tenant scope"); return existing;
  }
  async get(scope: TenantScope, publicationId: string): Promise<PublicationJob | undefined> { const row = rows(await this.db.execute(sql`SELECT * FROM ${aiMediaPublishingJobs} WHERE id = ${publicationId} AND owner_user_id = ${scope.ownerUserId} AND workspace_id = ${scope.workspaceId} LIMIT 1`))[0]; return row ? mapRow(row) : undefined; }
  async getByIdempotencyKey(scope: TenantScope, idempotencyKey: string): Promise<PublicationJob | undefined> { const row = rows(await this.db.execute(sql`SELECT * FROM ${aiMediaPublishingJobs} WHERE owner_user_id = ${scope.ownerUserId} AND workspace_id = ${scope.workspaceId} AND idempotency_key = ${idempotencyKey} LIMIT 1`))[0]; return row ? mapRow(row) : undefined; }
  async list(scope: TenantScope): Promise<PublicationJob[]> { return rows(await this.db.execute(sql`SELECT * FROM ${aiMediaPublishingJobs} WHERE owner_user_id = ${scope.ownerUserId} AND workspace_id = ${scope.workspaceId} ORDER BY created_at, id`)).map(mapRow); }
  async countPublished(scope: TenantScope): Promise<number> {
    const raw = rows(await this.db.execute(sql`SELECT COUNT(*) AS count FROM ${aiMediaPublishingJobs} WHERE owner_user_id = ${scope.ownerUserId} AND workspace_id = ${scope.workspaceId} AND status = 'published'`))[0]?.count;
    if (typeof raw === "number" && Number.isSafeInteger(raw) && raw >= 0) return raw;
    if (typeof raw === "bigint" && raw >= 0n && raw <= BigInt(Number.MAX_SAFE_INTEGER)) return Number(raw);
    if (typeof raw === "string" && /^(?:0|[1-9][0-9]*)$/u.test(raw)) {
      const value = BigInt(raw);
      if (value <= BigInt(Number.MAX_SAFE_INTEGER)) return Number(value);
    }
    throw new PublishingPersistenceError("Published job count from persistence is invalid");
  }
  async approve(scope: TenantScope, publicationId: string, evidence: ManualApprovalEvidence, now: string): Promise<PublicationJob> {
    const row = rows(await this.db.execute(sql`UPDATE ${aiMediaPublishingJobs} SET approval_status = 'approved', status = CASE WHEN request->'preview'->>'scheduledFor' IS NULL THEN 'queued' ELSE status END, available_at = CASE WHEN request->'preview'->>'scheduledFor' IS NULL THEN ${new Date(now)} ELSE available_at END, approval_evidence = ${JSON.stringify(evidence)}::jsonb, updated_at = ${new Date(now)} WHERE id = ${publicationId} AND owner_user_id = ${scope.ownerUserId} AND workspace_id = ${scope.workspaceId} AND status = 'pending_approval' AND approval_status = 'required' AND preview_digest = ${evidence.previewDigest} AND (request->'preview'->>'scheduledFor' IS NULL OR (request->'preview'->>'scheduledFor')::timestamptz > ${new Date(now)}) RETURNING *`))[0];
    if (!row) throw new PublishingInvariantError("Approval was stale, invalid, or outside tenant scope"); const job = mapRow(row); assertValidApproval(job); return job;
  }
  async approveScheduled(scope: TenantScope, publicationId: string, evidence: ManualApprovalEvidence, schedule: PublishingSchedule, now: string): Promise<PublicationJob> {
    if (evidence.method !== "manual" || evidence.decision !== "approved" || !evidence.approvedByUserId.trim()) throw new PublishingInvariantError("Manual approval evidence is required");
    const row = rows(await this.db.execute(sql`UPDATE ${aiMediaPublishingJobs} SET approval_status = 'approved', approval_evidence = ${JSON.stringify(evidence)}::jsonb, status = 'scheduled', mode = 'scheduled', scheduled_for = ${new Date(schedule.scheduledFor)}, available_at = ${new Date(schedule.scheduledFor)}, request = jsonb_set(request, '{schedule}', ${JSON.stringify(schedule)}::jsonb, true), updated_at = ${new Date(now)} WHERE id = ${publicationId} AND owner_user_id = ${scope.ownerUserId} AND workspace_id = ${scope.workspaceId} AND status = 'pending_approval' AND approval_status = 'required' AND preview_digest = ${evidence.previewDigest} AND request->'preview'->>'scheduledFor' = ${schedule.scheduledFor} AND request->'preview'->>'timezone' = ${schedule.timezone} AND ${new Date(schedule.scheduledFor)}::timestamptz > ${new Date(now)}::timestamptz RETURNING *`))[0];
    if (row) { const job = mapRow(row); assertValidApproval(job); return job; }
    const existing = await this.get(scope, publicationId);
    if (existing?.state === "scheduled" && existing.preview.digest === evidence.previewDigest && existing.approval?.previewDigest === evidence.previewDigest
      && existing.schedule?.scheduledFor === schedule.scheduledFor && existing.schedule.timezone === schedule.timezone) return existing;
    throw new PublishingInvariantError("Scheduled approval was stale, invalid, or outside tenant scope");
  }
  async reject(scope: TenantScope, publicationId: string, evidence: ManualRejectionEvidence, now: string): Promise<PublicationJob> {
    if (!evidence.rejectedByUserId.trim() || !evidence.reason.trim()) throw new PublishingInvariantError("Manual rejection requires an actor and reason");
    const row = rows(await this.db.execute(sql`UPDATE ${aiMediaPublishingJobs} SET status = 'cancelled', approval_status = 'rejected', approval_evidence = ${JSON.stringify({ ...evidence, reason: evidence.reason.trim() })}::jsonb, updated_at = ${new Date(now)} WHERE id = ${publicationId} AND owner_user_id = ${scope.ownerUserId} AND workspace_id = ${scope.workspaceId} AND status = 'pending_approval' AND approval_status IN ('required', 'approved') AND preview_digest = ${evidence.previewDigest} RETURNING *`))[0];
    if (!row) throw new PublishingInvariantError("Rejection was stale, invalid, or outside tenant scope");
    return mapRow(row);
  }
  async retry(scope: TenantScope, publicationId: string, now: string): Promise<PublicationJob> {
    return this.transactionalMutation(scope, publicationId, async (tx, job) => {
      if (!["failed", "dead_letter", "retry_wait"].includes(job.state)) throw new PublishingInvariantError("Only failed publishing work can be retried");
      assertValidApproval(job);
      const row = rows(await tx.execute(sql`UPDATE ${aiMediaPublishingJobs} SET status = 'queued', available_at = ${new Date(now)}, lease_owner = NULL, lease_expires_at = NULL, failure_code = NULL, error_message = NULL, dead_letter_at = NULL, request = request #- '{__publishing,leaseToken}', updated_at = ${new Date(now)} WHERE id = ${publicationId} AND owner_user_id = ${scope.ownerUserId} AND workspace_id = ${scope.workspaceId} AND approval_status = 'approved' AND (status IN ('failed', 'dead_letter') OR (status = 'queued' AND attempts > 0 AND error_message IS NOT NULL)) RETURNING *`))[0];
      if (!row) throw new PublishingInvariantError("Concurrent retry transition rejected");
      return mapRow(row);
    });
  }
  async schedule(scope: TenantScope, publicationId: string, schedule: PublishingSchedule, now: string): Promise<PublicationJob> {
    assertScheduledForInFuture(schedule.scheduledFor, now);
    return this.transactionalMutation(scope, publicationId, async (tx, job, raw) => { if (job.state !== "approved" || job.preview.scheduledFor !== schedule.scheduledFor || job.preview.timezone !== schedule.timezone) throw new PublishingInvariantError("Schedule must match the approved preview"); assertValidApproval(job);
      const request = { ...object(raw.request), schedule }; const row = rows(await tx.execute(sql`UPDATE ${aiMediaPublishingJobs} SET status = 'scheduled', mode = 'scheduled', scheduled_for = ${new Date(schedule.scheduledFor)}, available_at = ${new Date(schedule.scheduledFor)}, request = ${JSON.stringify(request)}::jsonb, updated_at = ${new Date(now)} WHERE id = ${publicationId} AND owner_user_id = ${scope.ownerUserId} AND workspace_id = ${scope.workspaceId} AND status = 'pending_approval' AND approval_status = 'approved' RETURNING *`))[0]; if (!row) throw new PublishingInvariantError("Concurrent schedule update rejected"); return mapRow(row); });
  }
  async cancel(scope: TenantScope, publicationId: string, now: string): Promise<PublicationJob> { const row = rows(await this.db.execute(sql`UPDATE ${aiMediaPublishingJobs} SET status = 'cancelled', request = jsonb_set(request, '{__publishing,canceledAt}', to_jsonb(${now}::text), true), updated_at = ${new Date(now)} WHERE id = ${publicationId} AND owner_user_id = ${scope.ownerUserId} AND workspace_id = ${scope.workspaceId} AND status IN ('pending_approval', 'scheduled', 'queued') RETURNING *`))[0]; if (!row) throw new PublishingInvariantError("Publication can no longer be canceled safely"); return mapRow(row); }
  async claimDue(input: { workerId: string; now: string; leaseDurationMs: number; enabledTenantKeys: ReadonlySet<string>; enabledPlatforms?: ReadonlySet<PublishingPlatform> }): Promise<{ job: PublicationJob; leaseToken: string } | undefined> {
    const tenants = [...input.enabledTenantKeys].map(tenantScopeFromKey), platforms = [...(input.enabledPlatforms ?? new Set<PublishingPlatform>(["tiktok", "instagram", "facebook", "youtube_shorts"]))]; if (!tenants.length || !platforms.length) return undefined;
    const tenantPredicates = sql.join(tenants.map((tenant) => sql`(workspace_id = ${tenant.workspaceId} AND owner_user_id = ${tenant.ownerUserId})`), sql` OR `), platformList = sql.join(platforms.map((value) => sql`${value}`), sql`, `);
    return this.db.transaction(async (tx) => { const raw = rows(await tx.execute(sql`SELECT * FROM ${aiMediaPublishingJobs} WHERE status IN ('scheduled', 'queued') AND approval_status = 'approved' AND available_at <= ${new Date(input.now)} AND (${tenantPredicates}) AND platform IN (${platformList}) ORDER BY available_at, id FOR UPDATE SKIP LOCKED LIMIT 1`))[0]; if (!raw) return undefined;
      const job = mapRow(raw); assertValidApproval(job); const leaseToken = randomUUID(), request = { ...object(raw.request), __publishing: { ...object(object(raw.request).__publishing), leaseToken } };
      const row = rows(await tx.execute(sql`UPDATE ${aiMediaPublishingJobs} SET status = 'publishing', lease_owner = ${input.workerId}, lease_expires_at = ${new Date(Date.parse(input.now) + input.leaseDurationMs)}, fencing_token = fencing_token + 1, attempts = attempts + 1, request = ${JSON.stringify(request)}::jsonb, updated_at = ${new Date(input.now)} WHERE id = ${job.id} RETURNING *`))[0]; return row ? { job: mapRow(row), leaseToken } : undefined; });
  }
  async markSubmitted(input: { scope: TenantScope; publicationId: string; leaseToken: string; providerSubmissionId: string; idempotencyKey: string; now: string }): Promise<PublicationJob | undefined> { return this.fencedMutation(input.scope, input.publicationId, input.leaseToken, input.now, "publishing", { providerSubmissionId: input.providerSubmissionId, providerIdempotencyKey: input.idempotencyKey, submittedAt: input.now }); }
  async markPublished(input: { scope: TenantScope; publicationId: string; providerSubmissionId: string; now: string }): Promise<PublicationJob | undefined> { const row = rows(await this.db.execute(sql`UPDATE ${aiMediaPublishingJobs} SET status = 'published', completed_at = ${new Date(input.now)}, updated_at = ${new Date(input.now)} WHERE id = ${input.publicationId} AND owner_user_id = ${input.scope.ownerUserId} AND workspace_id = ${input.scope.workspaceId} AND status = 'publishing' AND request->'__publishing'->>'providerSubmissionId' = ${input.providerSubmissionId} RETURNING *`))[0]; return row ? mapRow(row) : undefined; }
  async recordFailure(input: { scope: TenantScope; publicationId: string; leaseToken: string; error: string; retryable: boolean; retryAt: string; now: string }): Promise<PublicationJob | undefined> {
    return this.transactionalMutation(input.scope, input.publicationId, async (tx, job) => { if (job.state !== "leased" || job.leaseToken !== input.leaseToken || !job.leaseExpiresAt || Date.parse(job.leaseExpiresAt) <= Date.parse(input.now)) return undefined; const dead = !input.retryable || job.attempt >= job.maxAttempts;
      const row = rows(await tx.execute(sql`UPDATE ${aiMediaPublishingJobs} SET status = ${dead ? "dead_letter" : "queued"}, available_at = ${new Date(input.retryAt)}, lease_owner = NULL, lease_expires_at = NULL, error_message = ${input.error.slice(0, 1_000)}, dead_letter_at = ${dead ? new Date(input.now) : null}, request = request #- '{__publishing,leaseToken}', updated_at = ${new Date(input.now)} WHERE id = ${input.publicationId} AND owner_user_id = ${input.scope.ownerUserId} AND workspace_id = ${input.scope.workspaceId} AND status = 'publishing' AND request->'__publishing'->>'leaseToken' = ${input.leaseToken} RETURNING *`))[0]; return row ? mapRow(row) : undefined; });
  }
  async recordReconciliationFailure(input: { scope: TenantScope; publicationId: string; providerSubmissionId: string; expectedAttempt: number; error: string; retryAt: string; now: string }): Promise<PublicationJob | undefined> {
    return this.transactionalMutation(input.scope, input.publicationId, async (tx, job) => {
      if (job.state !== "submitted" || job.attempt !== input.expectedAttempt || job.submission?.providerSubmissionId !== input.providerSubmissionId) return undefined;
      const dead = job.attempt >= job.maxAttempts;
      const requestWithoutSubmission = sql`request #- '{__publishing,providerSubmissionId}' #- '{__publishing,submittedAt}'`;
      const row = rows(await tx.execute(sql`UPDATE ${aiMediaPublishingJobs} SET status = ${dead ? "dead_letter" : "queued"}, available_at = ${new Date(input.retryAt)}, failure_code = 'provider_reconciliation_failed', error_message = ${input.error.slice(0, 1_000)}, dead_letter_at = ${dead ? new Date(input.now) : null}, request = ${requestWithoutSubmission}, updated_at = ${new Date(input.now)} WHERE id = ${input.publicationId} AND owner_user_id = ${input.scope.ownerUserId} AND workspace_id = ${input.scope.workspaceId} AND status = 'publishing' AND attempts = ${input.expectedAttempt} AND lease_owner IS NULL AND request->'__publishing'->>'providerSubmissionId' = ${input.providerSubmissionId} RETURNING *`))[0];
      return row ? mapRow(row) : undefined;
    });
  }
  async reconcileExpiredLeases(now: string): Promise<PublishingLeaseRecovery[]> {
    return this.db.transaction(async (tx) => { const recoveries: PublishingLeaseRecovery[] = []; for (const raw of rows(await tx.execute(sql`SELECT * FROM ${aiMediaPublishingJobs} WHERE status = 'publishing' AND lease_owner IS NOT NULL AND lease_expires_at <= ${new Date(now)} FOR UPDATE SKIP LOCKED`))) { const job = mapRow(raw), count = job.leaseRecoveries + 1, dead = count >= job.maxLeaseRecoveries, metadata: Record<string, unknown> = { ...object(object(raw.request).__publishing), leaseRecoveries: count }; delete metadata.leaseToken;
        await tx.execute(sql`UPDATE ${aiMediaPublishingJobs} SET status = ${dead ? "dead_letter" : "scheduled"}, lease_owner = NULL, lease_expires_at = NULL, request = ${JSON.stringify({ ...object(raw.request), __publishing: metadata })}::jsonb, dead_letter_at = ${dead ? new Date(now) : null}, updated_at = ${new Date(now)} WHERE id = ${job.id}`); recoveries.push({ publicationId: job.id, previousOwner: job.leaseOwner ?? "unknown", deadLettered: dead }); } return recoveries; });
  }
  async listDeadLetters(scope: TenantScope): Promise<PublicationJob[]> { return (await this.list(scope)).filter((job) => job.state === "dead_letter"); }
  private async fencedMutation(scope: TenantScope, id: string, token: string, now: string, status: string, metadata: Record<string, unknown>): Promise<PublicationJob | undefined> { const row = rows(await this.db.execute(sql`UPDATE ${aiMediaPublishingJobs} SET status = ${status}, request = jsonb_set(request #- '{__publishing,leaseToken}', '{__publishing}', COALESCE((request #- '{__publishing,leaseToken}')->'__publishing', '{}'::jsonb) || ${JSON.stringify(metadata)}::jsonb, true), lease_owner = NULL, lease_expires_at = NULL, updated_at = ${new Date(now)} WHERE id = ${id} AND owner_user_id = ${scope.ownerUserId} AND workspace_id = ${scope.workspaceId} AND status = 'publishing' AND lease_expires_at > ${new Date(now)} AND request->'__publishing'->>'leaseToken' = ${token} RETURNING *`))[0]; return row ? mapRow(row) : undefined; }
  private async rawGet(db: DbExecutor, scope: TenantScope, id: string): Promise<RawRow | undefined> { return rows(await db.execute(sql`SELECT * FROM ${aiMediaPublishingJobs} WHERE id = ${id} AND owner_user_id = ${scope.ownerUserId} AND workspace_id = ${scope.workspaceId} LIMIT 1 FOR UPDATE`))[0]; }
  private async transactionalMutation<T>(scope: TenantScope, id: string, mutation: (tx: DbExecutor, job: PublicationJob, raw: RawRow) => Promise<T>): Promise<T> { return this.db.transaction(async (tx) => { const raw = await this.rawGet(tx, scope, id); if (!raw) throw new PublishingNotFoundError("Publication not found"); return mutation(tx, mapRow(raw), raw); }); }
}
