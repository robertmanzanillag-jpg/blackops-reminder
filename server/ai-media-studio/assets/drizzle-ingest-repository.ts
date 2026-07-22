import { randomUUID } from "node:crypto";
import { sql, type SQL } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { aiMediaAssetIngestJobs, aiMediaMediaAssets, aiMediaRenderJobs } from "../../../shared/models/ai-media-studio-db";
import type {
  AssetIngestErrorCode,
  AssetIngestFailureResult,
  AssetIngestJob,
  AssetIngestRepository,
  AssetLeaseRecovery,
  ClaimedAssetIngest,
  EnqueueAssetIngest,
} from "./contracts";

export type AssetIngestDatabase = Pick<NodePgDatabase, "execute" | "transaction">;

type RawRow = Record<string, unknown>;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function rows(result: unknown): RawRow[] {
  if (Array.isArray(result)) return result as RawRow[];
  if (result && typeof result === "object" && Array.isArray((result as { rows?: unknown }).rows)) {
    return (result as { rows: RawRow[] }).rows;
  }
  return [];
}

function milliseconds(value: unknown): number {
  if (value instanceof Date) return value.getTime();
  const parsed = new Date(String(value)).getTime();
  if (!Number.isFinite(parsed)) throw new Error("Asset ingest row contains an invalid timestamp");
  return parsed;
}

function structuredTenantKey(ownerUserId: string, workspaceId: string): string {
  return JSON.stringify([workspaceId, ownerUserId]);
}

function parseStructuredTenantKey(tenantId: string): { ownerUserId: string; workspaceId: string } {
  try {
    const parsed: unknown = JSON.parse(tenantId);
    if (!Array.isArray(parsed) || parsed.length !== 2 || parsed.some((part) => typeof part !== "string" || !part.trim())) {
      throw new Error("invalid");
    }
    const [workspaceId, ownerUserId] = parsed as [string, string];
    return { ownerUserId, workspaceId };
  } catch {
    throw new Error("Asset ingest tenantId must be a structured [workspaceId, ownerUserId] key");
  }
}

function value(raw: RawRow, camel: string, snake: string): unknown {
  return raw[camel] ?? raw[snake];
}

function optionalString(input: unknown): string | undefined {
  return typeof input === "string" && input.length > 0 ? input : undefined;
}

function mapRow(raw: RawRow): AssetIngestJob {
  const ownerUserId = String(value(raw, "ownerUserId", "owner_user_id") ?? "");
  const workspaceId = String(value(raw, "workspaceId", "workspace_id") ?? "");
  const sourceUrl = optionalString(value(raw, "remoteUrl", "remote_url"));
  if (!ownerUserId || !workspaceId || !sourceUrl) throw new Error("Asset ingest row is missing tenant or source data");
  const expectedMimeType = String(value(raw, "expectedMimeType", "expected_mime_type") ?? "video/mp4");
  if (expectedMimeType !== "video/mp4") throw new Error("Asset ingest row has an unsupported MIME type");
  return {
    id: String(raw.id),
    tenantId: structuredTenantKey(ownerUserId, workspaceId),
    renderJobId: String(value(raw, "renderJobId", "render_job_id")),
    ...(optionalString(value(raw, "remoteArtifactRef", "remote_artifact_ref"))
      ? { remoteArtifactRef: String(value(raw, "remoteArtifactRef", "remote_artifact_ref")) }
      : {}),
    sourceUrl,
    expectedMimeType,
    state: String(raw.state) as AssetIngestJob["state"],
    attempt: Number(raw.attempts ?? 0),
    maxAttempts: Number(value(raw, "maxAttempts", "max_attempts") ?? 1),
    leaseRecoveries: Number(value(raw, "leaseRecoveries", "lease_recoveries") ?? 0),
    maxLeaseRecoveries: Number(value(raw, "maxLeaseRecoveries", "max_lease_recoveries") ?? 1),
    availableAtMs: milliseconds(value(raw, "availableAt", "available_at")),
    createdAtMs: milliseconds(value(raw, "createdAt", "created_at")),
    updatedAtMs: milliseconds(value(raw, "updatedAt", "updated_at")),
    ...(optionalString(value(raw, "leaseOwner", "lease_owner")) ? { leaseOwner: String(value(raw, "leaseOwner", "lease_owner")) } : {}),
    ...(optionalString(value(raw, "leaseToken", "lease_token")) ? { leaseToken: String(value(raw, "leaseToken", "lease_token")) } : {}),
    ...(value(raw, "leaseExpiresAt", "lease_expires_at") ? { leaseExpiresAtMs: milliseconds(value(raw, "leaseExpiresAt", "lease_expires_at")) } : {}),
    ...(optionalString(value(raw, "ownedObjectKey", "owned_object_key")) ? { ownedObjectKey: String(value(raw, "ownedObjectKey", "owned_object_key")) } : {}),
    ...(optionalString(value(raw, "mediaAssetId", "media_asset_id")) ? { mediaAssetId: String(value(raw, "mediaAssetId", "media_asset_id")) } : {}),
    ...(optionalString(raw.sha256) ? { sha256: String(raw.sha256) } : {}),
    ...(value(raw, "sizeBytes", "size_bytes") !== null && value(raw, "sizeBytes", "size_bytes") !== undefined
      ? { sizeBytes: Number(value(raw, "sizeBytes", "size_bytes")) }
      : {}),
    ...(optionalString(value(raw, "errorCode", "error_code"))
      ? { lastErrorCode: String(value(raw, "errorCode", "error_code")) as AssetIngestErrorCode }
      : {}),
    ...(value(raw, "deadLetterAt", "dead_letter_at") ? { deadLetteredAtMs: milliseconds(value(raw, "deadLetterAt", "dead_letter_at")) } : {}),
  };
}

/** PostgreSQL ingest queue with atomic SKIP LOCKED claims and fenced terminal writes. */
export class DrizzleAssetIngestRepository implements AssetIngestRepository {
  constructor(private readonly db: AssetIngestDatabase) {}

  async enqueue(input: EnqueueAssetIngest, nowMs: number): Promise<AssetIngestJob> {
    if (!input.id || !input.renderJobId || !input.sourceUrl) throw new Error("Asset ingest identity and source are required");
    if (input.remoteArtifactRef !== undefined && !validRemoteArtifactRef(input.remoteArtifactRef)) {
      throw new Error("Asset ingest remote artifact identity is invalid");
    }
    if (!Number.isInteger(input.maxAttempts) || input.maxAttempts < 1) throw new Error("maxAttempts must be positive");
    const scope = parseStructuredTenantKey(input.tenantId);
    const expectedMimeType = input.expectedMimeType ?? "video/mp4";
    const maxLeaseRecoveries = input.maxLeaseRecoveries ?? input.maxAttempts;
    if (!Number.isInteger(maxLeaseRecoveries) || maxLeaseRecoveries < 1) throw new Error("maxLeaseRecoveries must be positive");
    let providerKey: string;
    try {
      providerKey = new URL(input.sourceUrl).hostname.toLowerCase();
    } catch {
      throw new Error("Asset ingest sourceUrl must be an absolute URL");
    }
    const result = await this.db.execute(sql`
      WITH inserted AS (
        INSERT INTO ${aiMediaAssetIngestJobs} (
          id, owner_user_id, workspace_id, render_job_id, provider_key, remote_artifact_ref, remote_url,
          expected_mime_type, state, attempts, max_attempts, lease_recoveries,
          max_lease_recoveries, available_at, fencing_token, created_at, updated_at
        )
        SELECT
          ${input.id}, ${scope.ownerUserId}, ${scope.workspaceId}, render.id,
          ${providerKey}, ${input.remoteArtifactRef ?? null}, ${input.sourceUrl}, ${expectedMimeType}, 'queued', 0,
          ${input.maxAttempts}, 0, ${maxLeaseRecoveries},
          ${new Date(input.availableAtMs ?? nowMs)}, 0, ${new Date(nowMs)}, ${new Date(nowMs)}
        FROM ${aiMediaRenderJobs} AS render
        WHERE render.id = ${input.renderJobId}
          AND render.owner_user_id = ${scope.ownerUserId}
          AND render.workspace_id = ${scope.workspaceId}
        ON CONFLICT (owner_user_id, workspace_id, render_job_id) DO NOTHING
        RETURNING *
      )
      SELECT * FROM inserted
      UNION ALL
      SELECT existing.* FROM ${aiMediaAssetIngestJobs} AS existing
      WHERE existing.owner_user_id = ${scope.ownerUserId}
        AND existing.workspace_id = ${scope.workspaceId}
        AND existing.render_job_id = ${input.renderJobId}
        AND NOT EXISTS (SELECT 1 FROM inserted)
      LIMIT 1
    `);
    const raw = rows(result)[0];
    if (!raw) throw new Error("Asset ingest id collides outside the tenant/render idempotency scope");
    const job = mapRow(raw);
    if (job.sourceUrl !== input.sourceUrl || job.remoteArtifactRef !== input.remoteArtifactRef
      || job.expectedMimeType !== expectedMimeType) {
      throw new Error("renderJobId is already associated with different ingest input");
    }
    return job;
  }

  async getForTenant(tenantId: string, jobId: string): Promise<AssetIngestJob | undefined> {
    const scope = parseStructuredTenantKey(tenantId);
    return this.one(sql`SELECT * FROM ${aiMediaAssetIngestJobs}
      WHERE id = ${jobId} AND owner_user_id = ${scope.ownerUserId} AND workspace_id = ${scope.workspaceId} LIMIT 1`);
  }

  async findByRenderJob(tenantId: string, renderJobId: string): Promise<AssetIngestJob | undefined> {
    const scope = parseStructuredTenantKey(tenantId);
    return this.one(sql`SELECT * FROM ${aiMediaAssetIngestJobs}
      WHERE render_job_id = ${renderJobId} AND owner_user_id = ${scope.ownerUserId} AND workspace_id = ${scope.workspaceId} LIMIT 1`);
  }

  async claimDue(input: { workerId: string; nowMs: number; leaseDurationMs: number }): Promise<ClaimedAssetIngest | undefined> {
    if (!input.workerId.trim() || !Number.isFinite(input.leaseDurationMs) || input.leaseDurationMs <= 0) {
      throw new Error("Valid asset ingest worker lease settings are required");
    }
    const leaseToken = randomUUID();
    return this.db.transaction(async (tx) => {
      const raw = rows(await tx.execute(sql`
        WITH candidate AS (
          SELECT id, owner_user_id, workspace_id FROM ${aiMediaAssetIngestJobs}
          WHERE state IN ('queued', 'retry_wait')
            AND available_at <= ${new Date(input.nowMs)}
            AND dead_letter_at IS NULL
          ORDER BY available_at, created_at, id
          FOR UPDATE SKIP LOCKED
          LIMIT 1
        )
        UPDATE ${aiMediaAssetIngestJobs} AS job
        SET state = 'leased', attempts = job.attempts + 1,
            lease_owner = ${input.workerId}, lease_token = ${leaseToken},
            lease_expires_at = ${new Date(input.nowMs + input.leaseDurationMs)},
            fencing_token = job.fencing_token + 1, updated_at = ${new Date(input.nowMs)}
        FROM candidate
        WHERE job.id = candidate.id
          AND job.owner_user_id = candidate.owner_user_id
          AND job.workspace_id = candidate.workspace_id
        RETURNING job.*
      `))[0];
      if (!raw) return undefined;
      return { job: mapRow(raw), leaseToken };
    });
  }

  async complete(input: { jobId: string; leaseToken: string; ownedObjectKey: string; sha256: string; sizeBytes: number; nowMs: number }): Promise<AssetIngestJob | undefined> {
    const raw = rows(await this.db.execute(sql`
      WITH candidate AS (
        SELECT id, owner_user_id, workspace_id FROM ${aiMediaAssetIngestJobs}
        WHERE id = ${input.jobId} AND state = 'leased'
          AND lease_token = ${input.leaseToken} AND lease_expires_at > ${new Date(input.nowMs)}
        FOR UPDATE
      )
      UPDATE ${aiMediaAssetIngestJobs} AS job
      SET state = 'completed', owned_object_key = ${input.ownedObjectKey}, sha256 = ${input.sha256},
          size_bytes = ${input.sizeBytes}, completed_at = ${new Date(input.nowMs)},
          error_code = NULL, error_message = NULL, lease_owner = NULL, lease_token = NULL,
          lease_expires_at = NULL, updated_at = ${new Date(input.nowMs)}
      FROM candidate
      WHERE job.id = candidate.id AND job.owner_user_id = candidate.owner_user_id
        AND job.workspace_id = candidate.workspace_id AND job.state = 'leased'
        AND job.lease_token = ${input.leaseToken} AND job.lease_expires_at > ${new Date(input.nowMs)}
      RETURNING job.*
    `))[0];
    return raw ? mapRow(raw) : undefined;
  }

  async fail(input: { jobId: string; leaseToken: string; errorCode: AssetIngestErrorCode; retryable: boolean; retryAtMs: number; nowMs: number }): Promise<AssetIngestFailureResult | undefined> {
    const raw = rows(await this.db.execute(sql`
      WITH candidate AS (
        SELECT id, owner_user_id, workspace_id FROM ${aiMediaAssetIngestJobs}
        WHERE id = ${input.jobId} AND state = 'leased'
          AND lease_token = ${input.leaseToken} AND lease_expires_at > ${new Date(input.nowMs)}
        FOR UPDATE
      )
      UPDATE ${aiMediaAssetIngestJobs} AS job
      SET state = CASE WHEN ${input.retryable} AND job.attempts < job.max_attempts THEN 'retry_wait' ELSE 'dead_letter' END,
          available_at = ${new Date(input.retryAtMs)}, error_code = ${input.errorCode},
          dead_letter_at = CASE
            WHEN ${input.retryable} AND job.attempts < job.max_attempts
              THEN CAST(NULL AS timestamp with time zone)
            ELSE CAST(${new Date(input.nowMs)} AS timestamp with time zone)
          END,
          lease_owner = NULL, lease_token = NULL, lease_expires_at = NULL, updated_at = ${new Date(input.nowMs)}
      FROM candidate
      WHERE job.id = candidate.id AND job.owner_user_id = candidate.owner_user_id
        AND job.workspace_id = candidate.workspace_id AND job.state = 'leased'
        AND job.lease_token = ${input.leaseToken} AND job.lease_expires_at > ${new Date(input.nowMs)}
      RETURNING job.*
    `))[0];
    if (!raw) return undefined;
    const job = mapRow(raw);
    return { job, deadLettered: job.state === "dead_letter" };
  }

  async reconcileExpiredLeases(nowMs: number): Promise<AssetLeaseRecovery[]> {
    return this.db.transaction(async (tx) => rows(await tx.execute(sql`
      WITH expired AS (
        SELECT id, owner_user_id, workspace_id, lease_owner,
               lease_recoveries + 1 AS next_recovery,
               lease_recoveries + 1 >= max_lease_recoveries AS must_dead_letter
        FROM ${aiMediaAssetIngestJobs}
        WHERE state = 'leased' AND lease_expires_at <= ${new Date(nowMs)}
        FOR UPDATE SKIP LOCKED
      )
      UPDATE ${aiMediaAssetIngestJobs} AS job
      SET state = CASE WHEN expired.must_dead_letter THEN 'dead_letter' ELSE 'queued' END,
          lease_recoveries = expired.next_recovery, available_at = ${new Date(nowMs)},
          error_code = CASE WHEN expired.must_dead_letter THEN 'ingest_failed' ELSE job.error_code END,
          dead_letter_at = CASE
            WHEN expired.must_dead_letter THEN CAST(${new Date(nowMs)} AS timestamp with time zone)
            ELSE CAST(NULL AS timestamp with time zone)
          END,
          lease_owner = NULL, lease_token = NULL, lease_expires_at = NULL, updated_at = ${new Date(nowMs)}
      FROM expired
      WHERE job.id = expired.id AND job.owner_user_id = expired.owner_user_id AND job.workspace_id = expired.workspace_id
      RETURNING job.id, expired.lease_owner AS __previous_owner, expired.must_dead_letter AS __dead_lettered
    `)).map((raw) => ({
      jobId: String(raw.id),
      previousOwner: String(raw.__previous_owner ?? "unknown"),
      deadLettered: Boolean(raw.__dead_lettered),
    })));
  }

  async attachMediaAsset(input: { tenantId: string; jobId: string; mediaAssetId: string; nowMs: number }): Promise<AssetIngestJob | undefined> {
    if (!UUID_PATTERN.test(input.jobId) || !UUID_PATTERN.test(input.mediaAssetId)) {
      throw new Error("Asset ingest and canonical media asset IDs must be UUIDs");
    }
    const scope = parseStructuredTenantKey(input.tenantId);
    return this.db.transaction(async (tx) => {
      const raw = rows(await tx.execute(sql`
        WITH candidate AS (
          SELECT job.id, job.owner_user_id, job.workspace_id, job.render_job_id
          FROM ${aiMediaAssetIngestJobs} AS job
          INNER JOIN ${aiMediaMediaAssets} AS asset
            ON asset.id = ${input.mediaAssetId}
           AND asset.owner_user_id = job.owner_user_id
           AND asset.workspace_id = job.workspace_id
           AND asset.kind = 'video' AND asset.status = 'ready' AND asset.deleted_at IS NULL
           AND asset.checksum = job.sha256
           AND asset.storage_key = job.owned_object_key
          WHERE job.id = ${input.jobId}
            AND job.owner_user_id = ${scope.ownerUserId} AND job.workspace_id = ${scope.workspaceId}
            AND job.state = 'completed'
            AND (job.media_asset_id IS NULL OR job.media_asset_id = ${input.mediaAssetId})
          FOR UPDATE OF job
        )
        UPDATE ${aiMediaAssetIngestJobs} AS job
        SET media_asset_id = ${input.mediaAssetId}, updated_at = ${new Date(input.nowMs)}
        FROM candidate
        WHERE job.id = candidate.id AND job.owner_user_id = candidate.owner_user_id
          AND job.workspace_id = candidate.workspace_id
        RETURNING job.*
      `))[0];
      if (!raw) {
        const existing = rows(await tx.execute(sql`SELECT * FROM ${aiMediaAssetIngestJobs}
          WHERE id = ${input.jobId} AND owner_user_id = ${scope.ownerUserId}
            AND workspace_id = ${scope.workspaceId} LIMIT 1 FOR UPDATE`))[0];
        const existingAssetId = existing ? optionalString(value(existing, "mediaAssetId", "media_asset_id")) : undefined;
        if (existingAssetId && existingAssetId !== input.mediaAssetId) {
          throw new Error("Completed asset ingest is already attached to a different canonical media asset");
        }
        return undefined;
      }
      const job = mapRow(raw);
      await this.attachRenderOutput(tx, job, input.mediaAssetId, input.nowMs);
      return job;
    });
  }

  async listCompletedUnlinked(limit: number): Promise<AssetIngestJob[]> {
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
      throw new Error("Completed unlinked asset ingest limit must be an integer between 1 and 100");
    }
    return rows(await this.db.execute(sql`SELECT * FROM ${aiMediaAssetIngestJobs}
      WHERE state = 'completed' AND media_asset_id IS NULL
      ORDER BY completed_at, created_at, id
      LIMIT ${limit}`)).map(mapRow);
  }

  async listDeadLetters(tenantId: string): Promise<AssetIngestJob[]> {
    const scope = parseStructuredTenantKey(tenantId);
    return rows(await this.db.execute(sql`SELECT * FROM ${aiMediaAssetIngestJobs}
      WHERE owner_user_id = ${scope.ownerUserId} AND workspace_id = ${scope.workspaceId}
        AND state = 'dead_letter' AND dead_letter_at IS NOT NULL
      ORDER BY dead_letter_at, id`)).map(mapRow);
  }

  private async one(query: SQL): Promise<AssetIngestJob | undefined> {
    const raw = rows(await this.db.execute(query))[0];
    return raw ? mapRow(raw) : undefined;
  }

  private async attachRenderOutput(
    db: Pick<NodePgDatabase, "execute">,
    job: AssetIngestJob,
    mediaAssetId: string,
    nowMs: number,
  ): Promise<void> {
    const scope = parseStructuredTenantKey(job.tenantId);
    const render = rows(await db.execute(sql`
      UPDATE ${aiMediaRenderJobs} AS render
      SET status = 'completed', stage = 'completed', progress = 100,
          output_media_asset_id = ${mediaAssetId}, output_url = NULL,
          completed_at = COALESCE(render.completed_at, ${new Date(nowMs)}),
          error_code = NULL, error_message = NULL, updated_at = ${new Date(nowMs)}
      WHERE render.id = ${job.renderJobId}
        AND render.owner_user_id = ${scope.ownerUserId} AND render.workspace_id = ${scope.workspaceId}
        AND (
          (render.stage IN ('artifact_ingest_queued', 'artifact_ingest_retrying')
            AND render.output_media_asset_id IS NULL)
          OR (render.stage = 'completed' AND render.status = 'completed' AND render.progress = 100
            AND render.output_media_asset_id = ${mediaAssetId})
        )
      RETURNING render.id
    `))[0];
    if (!render) throw new Error("Render output is already attached to a different canonical media asset");
  }
}

function validRemoteArtifactRef(value: string): boolean {
  return value.length >= 1 && value.length <= 1_000 && value === value.trim()
    && !/[\u0000-\u001f\u007f-\u009f]/u.test(value);
}
