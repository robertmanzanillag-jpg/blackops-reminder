import { randomUUID } from "node:crypto";
import { sql, type SQL } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { aiMediaRenderJobs } from "../../../shared/models/ai-media-studio-db";
import type {
  ClaimedRenderWork,
  ClaimDueWorkOptions,
  EnqueueRenderWork,
  LeaseRecovery,
  RenderFailureResult,
  RenderWorkItem,
  RenderWorkRepository,
  RenderWorkState,
} from "../workers/contracts";

const DEFAULT_WORKSPACE_ID = "personal";
const PRACTICAL_UNLIMITED_QUOTA = 2_147_483_647;
const QUEUE_STATES = new Set<RenderWorkState>([
  "queued",
  "leased",
  "retry_wait",
  "submitted",
  "dead_letter",
]);

export type AiMediaRenderWorkDatabase = Pick<NodePgDatabase, "execute" | "transaction">;

export interface DrizzleRenderWorkRepositoryOptions {
  workspaceId?: string;
  /** Restrict an operator to one tenant. Omit for a trusted workspace-wide worker. */
  tenantId?: string;
  /** Restrict an operator to an allowlist of provider keys. Omit for all providers. */
  providerKeys?: readonly string[];
}

interface RenderQueueMetadata {
  leaseToken?: string;
  leaseRecoveries: number;
  maxLeaseRecoveries: number;
}

interface RenderQueueRow {
  id: string;
  ownerUserId: string;
  workspaceId: string;
  providerKey: string | null;
  providerJobId: string | null;
  request: unknown;
  result: unknown;
  stage: string;
  attempts: number;
  maxAttempts: number;
  availableAt: Date | string;
  createdAt: Date | string;
  updatedAt: Date | string;
  leaseOwner: string | null;
  leaseExpiresAt: Date | string | null;
  deadLetterAt: Date | string | null;
  errorMessage: string | null;
  __previousOwner?: string | null;
  __leaseRecovery?: number;
  __deadLettered?: boolean;
}

type RawRenderQueueRow = Partial<RenderQueueRow> & Record<string, unknown>;

function rowsFrom<T>(result: unknown): T[] {
  if (Array.isArray(result)) return result as T[];
  if (result && typeof result === "object" && Array.isArray((result as { rows?: unknown }).rows)) {
    return (result as { rows: T[] }).rows;
  }
  return [];
}

function jsonObject(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function positiveInteger(value: unknown, fallback: number): number {
  return Number.isInteger(value) && Number(value) > 0 ? Number(value) : fallback;
}

function nonNegativeInteger(value: unknown, fallback: number): number {
  return Number.isInteger(value) && Number(value) >= 0 ? Number(value) : fallback;
}

function milliseconds(value: Date | string | null | undefined, fallback = 0): number {
  if (!value) return fallback;
  const parsed = value instanceof Date ? value.getTime() : new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : fallback;
}

function queueMetadata(result: unknown, maxAttempts: number): RenderQueueMetadata {
  const metadata = jsonObject(jsonObject(result).__renderQueue);
  return {
    ...(typeof metadata.leaseToken === "string" ? { leaseToken: metadata.leaseToken } : {}),
    leaseRecoveries: nonNegativeInteger(metadata.leaseRecoveries, 0),
    maxLeaseRecoveries: positiveInteger(metadata.maxLeaseRecoveries, maxAttempts),
  };
}

function normalizeRow(raw: RawRenderQueueRow): RenderQueueRow {
  return {
    id: String(raw.id ?? ""),
    ownerUserId: String(raw.ownerUserId ?? raw.owner_user_id ?? ""),
    workspaceId: String(raw.workspaceId ?? raw.workspace_id ?? ""),
    providerKey: (raw.providerKey ?? raw.provider_key ?? null) as string | null,
    providerJobId: (raw.providerJobId ?? raw.provider_job_id ?? null) as string | null,
    request: raw.request,
    result: raw.result,
    stage: String(raw.stage ?? "queued"),
    attempts: Number(raw.attempts ?? 0),
    maxAttempts: Number(raw.maxAttempts ?? raw.max_attempts ?? 1),
    availableAt: (raw.availableAt ?? raw.available_at ?? new Date(0)) as Date | string,
    createdAt: (raw.createdAt ?? raw.created_at ?? new Date(0)) as Date | string,
    updatedAt: (raw.updatedAt ?? raw.updated_at ?? new Date(0)) as Date | string,
    leaseOwner: (raw.leaseOwner ?? raw.lease_owner ?? null) as string | null,
    leaseExpiresAt: (raw.leaseExpiresAt ?? raw.lease_expires_at ?? null) as Date | string | null,
    deadLetterAt: (raw.deadLetterAt ?? raw.dead_letter_at ?? null) as Date | string | null,
    errorMessage: (raw.errorMessage ?? raw.error_message ?? null) as string | null,
    __previousOwner: (raw.__previousOwner ?? null) as string | null,
    __leaseRecovery: raw.__leaseRecovery === undefined ? undefined : Number(raw.__leaseRecovery),
    __deadLettered: raw.__deadLettered === undefined ? undefined : Boolean(raw.__deadLettered),
  };
}

function mapRow<TPayload>(raw: RawRenderQueueRow): RenderWorkItem<TPayload> {
  const row = normalizeRow(raw);
  if (!row.providerKey) throw new Error(`Render queue row ${row.id} has no provider key`);
  const maxAttempts = positiveInteger(row.maxAttempts, 1);
  const metadata = queueMetadata(row.result, maxAttempts);
  const state = QUEUE_STATES.has(row.stage as RenderWorkState)
    ? row.stage as RenderWorkState
    : row.deadLetterAt
      ? "dead_letter"
      : row.leaseOwner
        ? "leased"
        : "queued";
  return {
    id: row.id,
    tenantId: row.ownerUserId,
    providerKey: row.providerKey,
    payload: row.request as TPayload,
    state,
    attempt: positiveInteger(row.attempts, 1),
    maxAttempts,
    leaseRecoveries: metadata.leaseRecoveries,
    maxLeaseRecoveries: metadata.maxLeaseRecoveries,
    availableAtMs: milliseconds(row.availableAt),
    createdAtMs: milliseconds(row.createdAt),
    updatedAtMs: milliseconds(row.updatedAt),
    ...(row.leaseOwner ? { leaseOwner: row.leaseOwner } : {}),
    ...(metadata.leaseToken ? { leaseToken: metadata.leaseToken } : {}),
    ...(row.leaseExpiresAt ? { leaseExpiresAtMs: milliseconds(row.leaseExpiresAt) } : {}),
    ...(row.providerJobId ? { providerSubmissionId: row.providerJobId } : {}),
    ...(row.errorMessage ? { lastError: row.errorMessage } : {}),
    ...(row.deadLetterAt ? { deadLetteredAtMs: milliseconds(row.deadLetterAt) } : {}),
  };
}

function queueTitle<TPayload>(input: EnqueueRenderWork<TPayload>): string {
  const title = jsonObject(input.payload).title;
  return (typeof title === "string" && title.trim() ? title.trim() : `Render ${input.id}`).slice(0, 160);
}

function quota(value: number | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  if (!Number.isInteger(value) || value < 0) return 0;
  return value;
}

function quotaOverrides(values: Readonly<Record<string, number>> | undefined): Record<string, number> {
  return Object.fromEntries(Object.entries(values ?? {}).map(([key, value]) => [key, quota(value, 0)]));
}

/**
 * PostgreSQL implementation of the render worker port.
 *
 * Claiming takes a short workspace advisory transaction lock before executing
 * `FOR UPDATE SKIP LOCKED`. The advisory lock makes quota counts exact even
 * when several workers claim concurrently; row locks fence the selected job.
 * Lease tokens and the independent recovery budget live in
 * `result.__renderQueue` until dedicated additive columns are introduced.
 */
export class DrizzleRenderWorkRepository<TPayload = unknown> implements RenderWorkRepository<TPayload> {
  private readonly workspaceId: string;
  private readonly tenantId?: string;
  private readonly providerKeys?: readonly string[];

  constructor(
    private readonly db: AiMediaRenderWorkDatabase,
    options: DrizzleRenderWorkRepositoryOptions = {},
  ) {
    this.workspaceId = options.workspaceId?.trim() || DEFAULT_WORKSPACE_ID;
    this.tenantId = options.tenantId?.trim() || undefined;
    if (options.providerKeys) {
      const keys = [...new Set(options.providerKeys.map((key) => key.trim()).filter(Boolean))];
      this.providerKeys = keys;
    }
  }

  async enqueue(input: EnqueueRenderWork<TPayload>, nowMs: number): Promise<RenderWorkItem<TPayload>> {
    if (!input.id.trim() || !input.tenantId.trim() || !input.providerKey.trim()) {
      throw new Error("Render work identity is required");
    }
    if (!Number.isInteger(input.maxAttempts) || input.maxAttempts < 1) {
      throw new Error("maxAttempts must be a positive integer");
    }
    const maxLeaseRecoveries = input.maxLeaseRecoveries ?? input.maxAttempts;
    if (!Number.isInteger(maxLeaseRecoveries) || maxLeaseRecoveries < 1) {
      throw new Error("maxLeaseRecoveries must be a positive integer");
    }
    if (this.tenantId && input.tenantId !== this.tenantId) throw new Error("Render work tenant is outside repository scope");
    if (this.providerKeys && !this.providerKeys.includes(input.providerKey)) throw new Error("Render provider is outside repository scope");

    const now = new Date(nowMs);
    const availableAt = new Date(input.availableAtMs ?? nowMs);
    const result = await this.db.execute(sql`
      INSERT INTO ${aiMediaRenderJobs} (
        id, owner_user_id, workspace_id, provider_key, idempotency_key,
        title, status, stage, progress, attempts, retry_count, max_attempts,
        request, result, queued_at, available_at, created_at, updated_at
      ) VALUES (
        ${input.id}, ${input.tenantId}, ${this.workspaceId}, ${input.providerKey}, ${`render-work:${input.id}`},
        ${queueTitle(input)}, 'pending', 'queued', 0, 1, 0, ${input.maxAttempts},
        ${JSON.stringify(input.payload)}::jsonb,
        ${JSON.stringify({ __renderQueue: { leaseRecoveries: 0, maxLeaseRecoveries } })}::jsonb,
        ${now}, ${availableAt}, ${now}, ${now}
      )
      ON CONFLICT (id) DO NOTHING
      RETURNING *
    `);
    const inserted = rowsFrom<RawRenderQueueRow>(result)[0];
    if (inserted) return mapRow<TPayload>(inserted);
    const existing = await this.getScoped(input.id, input.tenantId, input.providerKey);
    if (!existing) throw new Error("Render work id collision is outside repository scope");
    return existing;
  }

  async get(id: string): Promise<RenderWorkItem<TPayload> | undefined> {
    return this.getScoped(id);
  }

  async claimDue(options: ClaimDueWorkOptions): Promise<ClaimedRenderWork<TPayload> | undefined> {
    if (!options.workerId.trim() || options.leaseDurationMs <= 0) {
      throw new Error("A worker and positive lease duration are required");
    }
    const leaseToken = randomUUID();
    const now = new Date(options.nowMs);
    const leaseExpiresAt = new Date(options.nowMs + options.leaseDurationMs);
    const totalLimit = quota(options.quotas.maxConcurrentTotal, PRACTICAL_UNLIMITED_QUOTA);
    const providerDefault = quota(options.quotas.maxConcurrentPerProvider, 0);
    const tenantDefault = quota(options.quotas.maxConcurrentPerTenant, 0);
    const providerLimits = JSON.stringify(quotaOverrides(options.quotas.providerLimits));
    const tenantLimits = JSON.stringify(quotaOverrides(options.quotas.tenantLimits));

    return this.db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`ai-media-render-claim:${this.workspaceId}`}))`);
      const result = await tx.execute(sql`
        WITH active_leases AS MATERIALIZED (
          SELECT owner_user_id, provider_key
          FROM ${aiMediaRenderJobs}
          WHERE workspace_id = ${this.workspaceId}
            AND stage = 'leased'
            AND lease_expires_at > ${now}
            ${this.tenantScopeSql()}
            ${this.providerScopeSql()}
        ), candidate AS (
          SELECT job.id
          FROM ${aiMediaRenderJobs} AS job
          WHERE job.workspace_id = ${this.workspaceId}
            AND job.provider_key IS NOT NULL
            AND job.stage IN ('queued', 'retry_wait')
            AND job.available_at <= ${now}
            AND job.dead_letter_at IS NULL
            ${this.tenantScopeSql("job")}
            ${this.providerScopeSql("job")}
            AND (SELECT count(*) FROM active_leases) < ${totalLimit}
            AND (
              SELECT count(*) FROM active_leases active
              WHERE active.provider_key = job.provider_key
            ) < COALESCE(
              (${providerLimits}::jsonb ->> job.provider_key)::integer,
              ${providerDefault}
            )
            AND (
              SELECT count(*) FROM active_leases active
              WHERE active.owner_user_id = job.owner_user_id
            ) < COALESCE(
              (${tenantLimits}::jsonb ->> job.owner_user_id)::integer,
              ${tenantDefault}
            )
          ORDER BY job.available_at, job.created_at, job.id
          FOR UPDATE SKIP LOCKED
          LIMIT 1
        )
        UPDATE ${aiMediaRenderJobs} AS job
        SET stage = 'leased',
            status = 'rendering',
            attempts = GREATEST(job.attempts, 1),
            lease_owner = ${options.workerId},
            lease_expires_at = ${leaseExpiresAt},
            result = (
              (COALESCE(job.result, '{}'::jsonb) - '__renderQueue') ||
              jsonb_build_object(
                '__renderQueue',
                COALESCE(job.result -> '__renderQueue', '{}'::jsonb) ||
                jsonb_build_object(
                  'leaseToken', ${leaseToken},
                  'leaseRecoveries', COALESCE((job.result -> '__renderQueue' ->> 'leaseRecoveries')::integer, 0),
                  'maxLeaseRecoveries', COALESCE(
                    (job.result -> '__renderQueue' ->> 'maxLeaseRecoveries')::integer,
                    job.max_attempts
                  )
                )
              )
            ),
            updated_at = ${now}
        FROM candidate
        WHERE job.id = candidate.id
        RETURNING job.*
      `);
      const row = rowsFrom<RawRenderQueueRow>(result)[0];
      if (!row) return undefined;
      const item = mapRow<TPayload>(row);
      return { item, leaseToken: item.leaseToken ?? leaseToken };
    });
  }

  async markSubmitted(input: {
    workId: string;
    leaseToken: string;
    providerSubmissionId: string;
    nowMs: number;
  }): Promise<RenderWorkItem<TPayload> | undefined> {
    const now = new Date(input.nowMs);
    const result = await this.db.execute(sql`
      UPDATE ${aiMediaRenderJobs} AS job
      SET stage = 'submitted',
          status = 'rendering',
          provider_job_id = ${input.providerSubmissionId},
          lease_owner = NULL,
          lease_expires_at = NULL,
          result = (
            (COALESCE(job.result, '{}'::jsonb) - '__renderQueue') ||
            jsonb_build_object(
              '__renderQueue',
              COALESCE(job.result -> '__renderQueue', '{}'::jsonb) - 'leaseToken'
            )
          ),
          updated_at = ${now}
      WHERE job.id = ${input.workId}
        AND job.workspace_id = ${this.workspaceId}
        AND job.stage = 'leased'
        AND job.lease_expires_at > ${now}
        AND job.result -> '__renderQueue' ->> 'leaseToken' = ${input.leaseToken}
        ${this.tenantScopeSql("job")}
        ${this.providerScopeSql("job")}
      RETURNING job.*
    `);
    const row = rowsFrom<RawRenderQueueRow>(result)[0];
    return row ? mapRow<TPayload>(row) : undefined;
  }

  async recordFailure(input: {
    workId: string;
    leaseToken: string;
    error: string;
    retryable: boolean;
    retryAtMs: number;
    nowMs: number;
  }): Promise<RenderFailureResult<TPayload> | undefined> {
    const now = new Date(input.nowMs);
    const retryAt = new Date(Math.max(input.nowMs, input.retryAtMs));
    const result = await this.db.execute(sql`
      UPDATE ${aiMediaRenderJobs} AS job
      SET stage = CASE
            WHEN NOT ${input.retryable} OR GREATEST(job.attempts, 1) >= job.max_attempts THEN 'dead_letter'
            ELSE 'retry_wait'
          END,
          status = CASE
            WHEN NOT ${input.retryable} OR GREATEST(job.attempts, 1) >= job.max_attempts THEN 'failed'
            ELSE 'pending'
          END,
          attempts = CASE
            WHEN ${input.retryable} AND GREATEST(job.attempts, 1) < job.max_attempts
              THEN GREATEST(job.attempts, 1) + 1
            ELSE GREATEST(job.attempts, 1)
          END,
          retry_count = CASE
            WHEN ${input.retryable} AND GREATEST(job.attempts, 1) < job.max_attempts
              THEN job.retry_count + 1
            ELSE job.retry_count
          END,
          available_at = CASE
            WHEN ${input.retryable} AND GREATEST(job.attempts, 1) < job.max_attempts THEN ${retryAt}
            ELSE job.available_at
          END,
          next_attempt_at = CASE
            WHEN ${input.retryable} AND GREATEST(job.attempts, 1) < job.max_attempts THEN ${retryAt}
            ELSE NULL
          END,
          dead_letter_at = CASE
            WHEN NOT ${input.retryable} OR GREATEST(job.attempts, 1) >= job.max_attempts THEN ${now}
            ELSE NULL
          END,
          error_message = ${input.error.slice(0, 1_000)},
          lease_owner = NULL,
          lease_expires_at = NULL,
          result = (
            (COALESCE(job.result, '{}'::jsonb) - '__renderQueue') ||
            jsonb_build_object(
              '__renderQueue',
              COALESCE(job.result -> '__renderQueue', '{}'::jsonb) - 'leaseToken'
            )
          ),
          updated_at = ${now}
      WHERE job.id = ${input.workId}
        AND job.workspace_id = ${this.workspaceId}
        AND job.stage = 'leased'
        AND job.lease_expires_at > ${now}
        AND job.result -> '__renderQueue' ->> 'leaseToken' = ${input.leaseToken}
        ${this.tenantScopeSql("job")}
        ${this.providerScopeSql("job")}
      RETURNING job.*
    `);
    const row = rowsFrom<RawRenderQueueRow>(result)[0];
    if (!row) return undefined;
    const item = mapRow<TPayload>(row);
    return { item, deadLettered: item.state === "dead_letter" };
  }

  async reconcileExpiredLeases(nowMs: number): Promise<LeaseRecovery[]> {
    const now = new Date(nowMs);
    return this.db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`ai-media-render-reconcile:${this.workspaceId}`}))`);
      const result = await tx.execute(sql`
        WITH expired AS (
          SELECT
            job.id,
            COALESCE(job.lease_owner, 'unknown') AS previous_owner,
            GREATEST(job.attempts, 1) AS attempt,
            COALESCE((job.result -> '__renderQueue' ->> 'leaseRecoveries')::integer, 0) + 1 AS next_recovery,
            COALESCE(
              (job.result -> '__renderQueue' ->> 'maxLeaseRecoveries')::integer,
              job.max_attempts
            ) AS max_recovery
          FROM ${aiMediaRenderJobs} AS job
          WHERE job.workspace_id = ${this.workspaceId}
            AND job.stage = 'leased'
            AND job.lease_expires_at <= ${now}
            ${this.tenantScopeSql("job")}
            ${this.providerScopeSql("job")}
          ORDER BY job.lease_expires_at, job.id
          FOR UPDATE SKIP LOCKED
        ), recovered AS (
          UPDATE ${aiMediaRenderJobs} AS job
          SET stage = CASE
                WHEN expired.next_recovery >= expired.max_recovery THEN 'dead_letter'
                WHEN GREATEST(job.attempts, 1) > 1 THEN 'retry_wait'
                ELSE 'queued'
              END,
              status = CASE
                WHEN expired.next_recovery >= expired.max_recovery THEN 'failed'
                ELSE 'pending'
              END,
              available_at = CASE
                WHEN expired.next_recovery >= expired.max_recovery THEN job.available_at
                ELSE ${now}
              END,
              next_attempt_at = CASE
                WHEN expired.next_recovery >= expired.max_recovery THEN NULL
                ELSE ${now}
              END,
              dead_letter_at = CASE
                WHEN expired.next_recovery >= expired.max_recovery THEN ${now}
                ELSE NULL
              END,
              error_message = CASE
                WHEN expired.next_recovery >= expired.max_recovery
                  THEN 'Render lease recovery budget exhausted'
                ELSE job.error_message
              END,
              lease_owner = NULL,
              lease_expires_at = NULL,
              result = (
                (COALESCE(job.result, '{}'::jsonb) - '__renderQueue') ||
                jsonb_build_object(
                  '__renderQueue',
                  (COALESCE(job.result -> '__renderQueue', '{}'::jsonb) - 'leaseToken') ||
                  jsonb_build_object(
                    'leaseRecoveries', expired.next_recovery,
                    'maxLeaseRecoveries', expired.max_recovery
                  )
                )
              ),
              updated_at = ${now}
          FROM expired
          WHERE job.id = expired.id
          RETURNING
            job.*,
            expired.previous_owner AS "__previousOwner",
            expired.next_recovery AS "__leaseRecovery",
            (expired.next_recovery >= expired.max_recovery) AS "__deadLettered"
        )
        SELECT * FROM recovered ORDER BY lease_expires_at NULLS LAST, id
      `);
      return rowsFrom<RawRenderQueueRow>(result).map((raw) => {
        const row = normalizeRow(raw);
        return {
          workId: row.id,
          previousOwner: row.__previousOwner ?? "unknown",
          attempt: positiveInteger(row.attempts, 1),
          deadLettered: row.__deadLettered === true || row.stage === "dead_letter",
        };
      });
    });
  }

  async listDeadLetters(): Promise<RenderWorkItem<TPayload>[]> {
    const result = await this.db.execute(sql`
      SELECT *
      FROM ${aiMediaRenderJobs} AS job
      WHERE job.workspace_id = ${this.workspaceId}
        AND job.stage = 'dead_letter'
        AND job.dead_letter_at IS NOT NULL
        AND job.provider_key IS NOT NULL
        ${this.tenantScopeSql("job")}
        ${this.providerScopeSql("job")}
      ORDER BY job.dead_letter_at DESC, job.id
    `);
    return rowsFrom<RawRenderQueueRow>(result).map((row) => mapRow<TPayload>(row));
  }

  async counts(): Promise<Record<RenderWorkState, number>> {
    const result: Record<RenderWorkState, number> = {
      queued: 0,
      leased: 0,
      retry_wait: 0,
      submitted: 0,
      dead_letter: 0,
    };
    const queryResult = await this.db.execute(sql`
      SELECT job.stage, count(*)::integer AS count
      FROM ${aiMediaRenderJobs} AS job
      WHERE job.workspace_id = ${this.workspaceId}
        AND job.stage IN ('queued', 'leased', 'retry_wait', 'submitted', 'dead_letter')
        AND job.provider_key IS NOT NULL
        ${this.tenantScopeSql("job")}
        ${this.providerScopeSql("job")}
      GROUP BY job.stage
    `);
    for (const row of rowsFrom<{ stage: string; count: number | string }>(queryResult)) {
      if (QUEUE_STATES.has(row.stage as RenderWorkState)) result[row.stage as RenderWorkState] = Number(row.count) || 0;
    }
    return result;
  }

  private async getScoped(
    id: string,
    expectedTenantId?: string,
    expectedProviderKey?: string,
  ): Promise<RenderWorkItem<TPayload> | undefined> {
    const result = await this.db.execute(sql`
      SELECT *
      FROM ${aiMediaRenderJobs} AS job
      WHERE job.id = ${id}
        AND job.workspace_id = ${this.workspaceId}
        AND job.provider_key IS NOT NULL
        ${expectedTenantId ? sql`AND job.owner_user_id = ${expectedTenantId}` : this.tenantScopeSql("job")}
        ${expectedProviderKey ? sql`AND job.provider_key = ${expectedProviderKey}` : this.providerScopeSql("job")}
      LIMIT 1
    `);
    const row = rowsFrom<RawRenderQueueRow>(result)[0];
    return row ? mapRow<TPayload>(row) : undefined;
  }

  private tenantScopeSql(alias?: "job"): SQL {
    if (!this.tenantId) return sql.empty();
    return alias
      ? sql`AND job.owner_user_id = ${this.tenantId}`
      : sql`AND owner_user_id = ${this.tenantId}`;
  }

  private providerScopeSql(alias?: "job"): SQL {
    if (!this.providerKeys) return sql.empty();
    if (this.providerKeys.length === 0) return sql`AND FALSE`;
    const keys = sql.join(this.providerKeys.map((key) => sql`${key}`), sql`, `);
    return alias
      ? sql`AND job.provider_key IN (${keys})`
      : sql`AND provider_key IN (${keys})`;
  }
}
