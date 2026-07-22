import { sql, type SQL } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { aiMediaOrchestrationRuns } from "../../../shared/models/ai-media-studio-db";
import { KONG_OWNED_SOURCE_ADAPTER_KEY } from "./kong-owned-source-adapter";
import {
  SOURCE_SYNC_MODE,
  SOURCE_SYNC_RUN_TYPE,
  parseSourceSyncPayload,
  type ClaimedSourceSyncTask,
  type SourceSyncFailureCode,
  type SourceSyncSchedulerRepository,
  type SourceSyncSchedulerObserver,
  type SourceSyncTask,
} from "./source-sync-scheduler";

export type SourceSyncSchedulerDatabase = Pick<NodePgDatabase, "execute" | "transaction">;
type RawRow = Record<string, unknown>;

const IDEMPOTENCY_KEY = `ams-source-sync-v1:${KONG_OWNED_SOURCE_ADAPTER_KEY}`;
const FAILURE_CODES = new Set<SourceSyncFailureCode>([
  "source_sync_unavailable", "review_unavailable", "batch_unavailable", "invalid_scheduler_state", "lease_expired",
]);

function rows(result: unknown): RawRow[] {
  if (Array.isArray(result)) return result as RawRow[];
  if (result && typeof result === "object" && Array.isArray((result as { rows?: unknown }).rows)) {
    return (result as { rows: RawRow[] }).rows;
  }
  return [];
}

function at(row: RawRow, camel: string, snake: string): unknown {
  return row[camel] ?? row[snake];
}

function milliseconds(value: unknown): number {
  const parsed = value instanceof Date ? value.getTime() : new Date(String(value)).getTime();
  if (!Number.isFinite(parsed)) throw new Error("Source sync row contains an invalid timestamp");
  return parsed;
}

function mapTask(row: RawRow): SourceSyncTask {
  const ownerUserId = String(at(row, "ownerUserId", "owner_user_id") ?? "");
  const workspaceId = String(at(row, "workspaceId", "workspace_id") ?? "");
  const status = String(row.status) as SourceSyncTask["status"];
  if (!ownerUserId || !workspaceId
    || at(row, "runType", "run_type") !== SOURCE_SYNC_RUN_TYPE
    || at(row, "mode", "mode") !== SOURCE_SYNC_MODE
    || !["queued", "leased", "retry_wait", "completed", "dead_letter"].includes(status)) {
    throw new Error("Stored source sync task identity is invalid");
  }
  const failure = at(row, "failureCode", "failure_code");
  if (failure !== null && failure !== undefined && (typeof failure !== "string" || !FAILURE_CODES.has(failure as SourceSyncFailureCode))) {
    throw new Error("Stored source sync failure code is invalid");
  }
  const task: SourceSyncTask = {
    id: String(row.id),
    scope: { ownerUserId, workspaceId },
    status,
    payload: parseSourceSyncPayload(at(row, "runPayload", "run_payload")),
    attempts: Number(row.attempts),
    maxAttempts: Number(at(row, "maxAttempts", "max_attempts")),
    availableAtMs: milliseconds(at(row, "availableAt", "available_at")),
    fencingToken: Number(at(row, "fencingToken", "fencing_token")),
    ...(typeof at(row, "leaseOwner", "lease_owner") === "string"
      ? { leaseOwner: String(at(row, "leaseOwner", "lease_owner")) } : {}),
    ...(at(row, "leaseExpiresAt", "lease_expires_at")
      ? { leaseExpiresAtMs: milliseconds(at(row, "leaseExpiresAt", "lease_expires_at")) } : {}),
    ...(typeof failure === "string" ? { failureCode: failure as SourceSyncFailureCode } : {}),
    ...(at(row, "deadLetterAt", "dead_letter_at")
      ? { deadLetterAtMs: milliseconds(at(row, "deadLetterAt", "dead_letter_at")) } : {}),
  };
  if (!Number.isInteger(task.attempts) || task.attempts < 0 || !Number.isInteger(task.maxAttempts)
    || task.maxAttempts < 1 || !Number.isInteger(task.fencingToken) || task.fencingToken < 0) {
    throw new Error("Stored source sync counters are invalid");
  }
  return task;
}

/** One existing orchestration row per tenant and the exact Kong-owned catalog. */
export class DrizzleSourceSyncSchedulerRepository implements SourceSyncSchedulerRepository, SourceSyncSchedulerObserver {
  constructor(private readonly db: SourceSyncSchedulerDatabase) {}

  async observe(scope: SourceSyncTask["scope"]): Promise<SourceSyncTask | undefined> {
    validateScope(scope);
    const raw = rows(await this.db.execute(sql`
      SELECT * FROM ${aiMediaOrchestrationRuns}
      WHERE owner_user_id = ${scope.ownerUserId} AND workspace_id = ${scope.workspaceId}
        AND source_item_id IS NULL AND run_type = ${SOURCE_SYNC_RUN_TYPE} AND mode = ${SOURCE_SYNC_MODE}
        AND idempotency_key = ${IDEMPOTENCY_KEY}
      LIMIT 2
    `));
    if (raw.length > 1) throw new Error("Source sync scheduler state is ambiguous");
    return raw[0] ? mapTask(raw[0]) : undefined;
  }

  async ensureTask(scope: SourceSyncTask["scope"], input: {
    availableAtMs: number;
    maxAttempts: number;
    autoPrepareBatch: boolean;
  }): Promise<SourceSyncTask> {
    validateScope(scope);
    if (!Number.isInteger(input.maxAttempts) || input.maxAttempts < 1 || input.maxAttempts > 100
      || !Number.isFinite(input.availableAtMs)) throw new Error("Invalid source sync task settings");
    const payload = {
      version: 1, adapterKey: KONG_OWNED_SOURCE_ADAPTER_KEY, cursor: null,
      page: 0, cycle: 0, autoPrepareBatch: input.autoPrepareBatch,
    };
    const raw = rows(await this.db.execute(sql`
      INSERT INTO ${aiMediaOrchestrationRuns} (
        owner_user_id, workspace_id, source_item_id, run_type, mode, status,
        state_version, run_payload, idempotency_key, policy_evidence, automation_evidence,
        available_at, fencing_token, attempts, max_attempts, created_at, updated_at
      ) VALUES (
        ${scope.ownerUserId}, ${scope.workspaceId}, NULL, ${SOURCE_SYNC_RUN_TYPE}, ${SOURCE_SYNC_MODE}, 'queued',
        0, ${JSON.stringify(payload)}::jsonb, ${IDEMPOTENCY_KEY}, '{}'::jsonb, '{}'::jsonb,
        ${new Date(input.availableAtMs)}, 0, 0, ${input.maxAttempts}, ${new Date(input.availableAtMs)}, ${new Date(input.availableAtMs)}
      )
      ON CONFLICT (owner_user_id, workspace_id, idempotency_key) DO UPDATE SET
        status = CASE WHEN ${aiMediaOrchestrationRuns.status} = 'completed' THEN 'queued' ELSE ${aiMediaOrchestrationRuns.status} END,
        available_at = CASE WHEN ${aiMediaOrchestrationRuns.status} = 'completed' THEN EXCLUDED.available_at ELSE ${aiMediaOrchestrationRuns.availableAt} END,
        attempts = CASE WHEN ${aiMediaOrchestrationRuns.status} = 'completed' THEN 0 ELSE ${aiMediaOrchestrationRuns.attempts} END,
        completed_at = CASE WHEN ${aiMediaOrchestrationRuns.status} = 'completed' THEN NULL ELSE ${aiMediaOrchestrationRuns.completedAt} END,
        failure_code = CASE WHEN ${aiMediaOrchestrationRuns.status} = 'completed' THEN NULL ELSE ${aiMediaOrchestrationRuns.failureCode} END,
        updated_at = CASE WHEN ${aiMediaOrchestrationRuns.status} = 'completed' THEN EXCLUDED.updated_at ELSE ${aiMediaOrchestrationRuns.updatedAt} END
      WHERE ${aiMediaOrchestrationRuns.runType} = ${SOURCE_SYNC_RUN_TYPE}
        AND ${aiMediaOrchestrationRuns.mode} = ${SOURCE_SYNC_MODE}
        AND ${aiMediaOrchestrationRuns.sourceItemId} IS NULL
      RETURNING *
    `))[0];
    if (!raw) throw new Error("Source sync idempotency key collides with incompatible orchestration state");
    return mapTask(raw);
  }

  async claimDue(input: { workerId: string; nowMs: number; leaseDurationMs: number }): Promise<ClaimedSourceSyncTask | undefined> {
    if (!input.workerId.trim() || input.workerId.length > 128 || !Number.isFinite(input.nowMs)
      || !Number.isInteger(input.leaseDurationMs) || input.leaseDurationMs < 1) throw new Error("Invalid source sync lease settings");
    return this.db.transaction(async (tx) => {
      const raw = rows(await tx.execute(sql`
        WITH candidate AS (
          SELECT id, owner_user_id, workspace_id
          FROM ${aiMediaOrchestrationRuns}
          WHERE run_type = ${SOURCE_SYNC_RUN_TYPE} AND mode = ${SOURCE_SYNC_MODE}
            AND source_item_id IS NULL AND status IN ('queued', 'retry_wait')
            AND available_at <= ${new Date(input.nowMs)} AND dead_letter_at IS NULL
            AND run_payload->>'adapterKey' = ${KONG_OWNED_SOURCE_ADAPTER_KEY}
            AND run_payload->>'version' = '1'
          ORDER BY available_at, created_at, id
          FOR UPDATE SKIP LOCKED
          LIMIT 1
        )
        UPDATE ${aiMediaOrchestrationRuns} AS task
        SET status = 'leased', attempts = task.attempts + 1,
            lease_owner = ${input.workerId}, lease_expires_at = ${new Date(input.nowMs + input.leaseDurationMs)},
            fencing_token = task.fencing_token + 1, failure_code = NULL, updated_at = ${new Date(input.nowMs)}
        FROM candidate
        WHERE task.id = candidate.id AND task.owner_user_id = candidate.owner_user_id
          AND task.workspace_id = candidate.workspace_id
        RETURNING task.*
      `))[0];
      if (!raw) return undefined;
      const task = mapTask(raw);
      if (task.status !== "leased" || !task.leaseOwner || task.leaseExpiresAtMs === undefined) {
        throw new Error("Claimed source sync task is missing its lease");
      }
      return task as ClaimedSourceSyncTask;
    });
  }

  async commitPage(input: {
    taskId: string; scope: SourceSyncTask["scope"]; workerId: string; fencingToken: number; nowMs: number; nextCursor: string;
  }): Promise<SourceSyncTask | undefined> {
    if (!input.nextCursor || input.nextCursor.length > 2_048) throw new Error("Invalid source sync cursor");
    return this.fencedUpdate(sql`
      UPDATE ${aiMediaOrchestrationRuns} AS task
      SET status = 'queued', available_at = ${new Date(input.nowMs)},
          run_payload = jsonb_build_object(
            'version', 1, 'adapterKey', ${KONG_OWNED_SOURCE_ADAPTER_KEY}, 'cursor', ${input.nextCursor},
            'page', ((task.run_payload->>'page')::integer + 1),
            'cycle', (task.run_payload->>'cycle')::integer,
            'autoPrepareBatch', (task.run_payload->>'autoPrepareBatch')::boolean
          ),
          state_version = task.state_version + 1, lease_owner = NULL, lease_expires_at = NULL,
          failure_code = NULL, updated_at = ${new Date(input.nowMs)}
      WHERE ${fence(input)}
      RETURNING task.*
    `);
  }

  async completeCycle(input: {
    taskId: string; scope: SourceSyncTask["scope"]; workerId: string; fencingToken: number; nowMs: number;
  }): Promise<SourceSyncTask | undefined> {
    return this.fencedUpdate(sql`
      UPDATE ${aiMediaOrchestrationRuns} AS task
      SET status = 'completed', completed_at = ${new Date(input.nowMs)},
          run_payload = jsonb_build_object(
            'version', 1, 'adapterKey', ${KONG_OWNED_SOURCE_ADAPTER_KEY}, 'cursor', NULL,
            'page', 0, 'cycle', ((task.run_payload->>'cycle')::integer + 1),
            'autoPrepareBatch', (task.run_payload->>'autoPrepareBatch')::boolean
          ),
          state_version = task.state_version + 1, lease_owner = NULL, lease_expires_at = NULL,
          failure_code = NULL, updated_at = ${new Date(input.nowMs)}
      WHERE ${fence(input)}
      RETURNING task.*
    `);
  }

  async fail(input: {
    taskId: string; scope: SourceSyncTask["scope"]; workerId: string; fencingToken: number;
    failureCode: SourceSyncFailureCode; retryAtMs: number; nowMs: number;
  }): Promise<{ task: SourceSyncTask; deadLettered: boolean } | undefined> {
    if (!FAILURE_CODES.has(input.failureCode)) throw new Error("Invalid source sync failure code");
    const task = await this.fencedUpdate(sql`
      UPDATE ${aiMediaOrchestrationRuns} AS task
      SET status = CASE WHEN task.attempts < task.max_attempts THEN 'retry_wait' ELSE 'dead_letter' END,
          available_at = ${new Date(input.retryAtMs)}, failure_code = ${input.failureCode},
          dead_letter_at = CASE WHEN task.attempts < task.max_attempts THEN NULL ELSE ${new Date(input.nowMs)} END,
          lease_owner = NULL, lease_expires_at = NULL, updated_at = ${new Date(input.nowMs)}
      WHERE ${fence(input)}
      RETURNING task.*
    `);
    return task ? { task, deadLettered: task.status === "dead_letter" } : undefined;
  }

  async recoverExpiredLeases(nowMs: number): Promise<number> {
    const result = await this.db.transaction(async (tx) => tx.execute(sql`
      WITH expired AS (
        SELECT id, owner_user_id, workspace_id
        FROM ${aiMediaOrchestrationRuns}
        WHERE run_type = ${SOURCE_SYNC_RUN_TYPE} AND mode = ${SOURCE_SYNC_MODE}
          AND source_item_id IS NULL AND status = 'leased' AND lease_expires_at <= ${new Date(nowMs)}
          AND run_payload->>'adapterKey' = ${KONG_OWNED_SOURCE_ADAPTER_KEY}
        FOR UPDATE SKIP LOCKED
      )
      UPDATE ${aiMediaOrchestrationRuns} AS task
      SET status = CASE WHEN task.attempts < task.max_attempts THEN 'retry_wait' ELSE 'dead_letter' END,
          available_at = ${new Date(nowMs)}, failure_code = 'lease_expired',
          dead_letter_at = CASE WHEN task.attempts < task.max_attempts THEN NULL ELSE ${new Date(nowMs)} END,
          lease_owner = NULL, lease_expires_at = NULL, updated_at = ${new Date(nowMs)}
      FROM expired
      WHERE task.id = expired.id AND task.owner_user_id = expired.owner_user_id
        AND task.workspace_id = expired.workspace_id
      RETURNING task.id
    `));
    return rows(result).length;
  }

  private async fencedUpdate(query: SQL): Promise<SourceSyncTask | undefined> {
    const raw = rows(await this.db.execute(query))[0];
    return raw ? mapTask(raw) : undefined;
  }
}

function validateScope(scope: SourceSyncTask["scope"]): void {
  if (!scope.ownerUserId.trim() || !scope.workspaceId.trim()) throw new Error("Invalid source sync tenant scope");
}

function fence(input: {
  taskId: string; scope: SourceSyncTask["scope"]; workerId: string; fencingToken: number; nowMs: number;
}): SQL {
  validateScope(input.scope);
  if (!input.taskId || !input.workerId.trim() || !Number.isInteger(input.fencingToken) || input.fencingToken < 1) {
    throw new Error("Invalid source sync fence");
  }
  return sql`task.id = ${input.taskId}
    AND task.owner_user_id = ${input.scope.ownerUserId} AND task.workspace_id = ${input.scope.workspaceId}
    AND task.run_type = ${SOURCE_SYNC_RUN_TYPE} AND task.mode = ${SOURCE_SYNC_MODE}
    AND task.source_item_id IS NULL AND task.status = 'leased'
    AND task.run_payload->>'adapterKey' = ${KONG_OWNED_SOURCE_ADAPTER_KEY}
    AND task.lease_owner = ${input.workerId} AND task.fencing_token = ${input.fencingToken}
    AND task.lease_expires_at > ${new Date(input.nowMs)}`;
}
