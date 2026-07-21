import { sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { aiMediaOutbox } from "../../../shared/models/ai-media-studio-db";
import type {
  ClaimedOutboxMessage,
  OutboxMessage,
  OutboxRepository,
  OutboxState,
} from "./outbox";

export type AiMediaOutboxDatabase = Pick<NodePgDatabase, "execute" | "transaction">;

export interface DrizzleOutboxRepositoryOptions {
  ownerUserId: string;
  workspaceId: string;
  maxAttempts?: number;
}

interface RawOutboxRow extends Record<string, unknown> {
  id?: unknown;
  event_type?: unknown;
  eventType?: unknown;
  payload?: unknown;
  status?: unknown;
  attempts?: unknown;
  available_at?: unknown;
  availableAt?: unknown;
  created_at?: unknown;
  createdAt?: unknown;
  updated_at?: unknown;
  updatedAt?: unknown;
  lease_owner?: unknown;
  leaseOwner?: unknown;
  lease_expires_at?: unknown;
  leaseExpiresAt?: unknown;
  fencing_token?: unknown;
  fencingToken?: unknown;
  last_error?: unknown;
  lastError?: unknown;
  processed_at?: unknown;
  processedAt?: unknown;
  dead_letter_at?: unknown;
  deadLetterAt?: unknown;
}

function rowsFrom<T>(result: unknown): T[] {
  if (Array.isArray(result)) return result as T[];
  if (result && typeof result === "object" && Array.isArray((result as { rows?: unknown }).rows)) {
    return (result as { rows: T[] }).rows;
  }
  return [];
}

function milliseconds(value: unknown, fallback = 0): number {
  if (value instanceof Date) return value.getTime();
  if (typeof value === "string" || typeof value === "number") {
    const parsed = new Date(value).getTime();
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

function nullableString(value: unknown): string | undefined {
  return typeof value === "string" && value ? value : undefined;
}

function fencingTokenString(value: unknown): string | undefined {
  if (Number.isInteger(value) && Number(value) > 0) return String(value);
  if (typeof value === "string" && /^\d+$/u.test(value) && Number(value) > 0) return String(Number(value));
  return undefined;
}

function fencingTokenNumber(value: string): number | undefined {
  if (!/^\d+$/u.test(value)) return undefined;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function state(raw: RawOutboxRow): OutboxState {
  const value = String(raw.status ?? "pending");
  if (value === "held" || value === "pending" || value === "leased" || value === "retry_wait"
    || value === "dispatched" || value === "dead_letter") return value;
  if (raw.dead_letter_at ?? raw.deadLetterAt) return "dead_letter";
  if (raw.processed_at ?? raw.processedAt) return "dispatched";
  if (raw.lease_owner ?? raw.leaseOwner) return "leased";
  return "pending";
}

function mapRow<TPayload>(raw: RawOutboxRow, maxAttempts: number): OutboxMessage<TPayload> {
  const leaseToken = fencingTokenString(raw.fencing_token ?? raw.fencingToken);
  const leaseOwner = nullableString(raw.lease_owner ?? raw.leaseOwner);
  const leaseExpiresAtMs = milliseconds(raw.lease_expires_at ?? raw.leaseExpiresAt, Number.NaN);
  const lastError = nullableString(raw.last_error ?? raw.lastError);
  const dispatchedAtMs = milliseconds(raw.processed_at ?? raw.processedAt, Number.NaN);
  const deadLetteredAtMs = milliseconds(raw.dead_letter_at ?? raw.deadLetterAt, Number.NaN);
  return {
    id: String(raw.id ?? ""),
    topic: String(raw.event_type ?? raw.eventType ?? ""),
    payload: raw.payload as TPayload,
    state: state(raw),
    attempt: Math.max(1, Number(raw.attempts ?? 1)),
    maxAttempts,
    availableAtMs: milliseconds(raw.available_at ?? raw.availableAt),
    createdAtMs: milliseconds(raw.created_at ?? raw.createdAt),
    updatedAtMs: milliseconds(raw.updated_at ?? raw.updatedAt),
    ...(leaseOwner ? { leaseOwner } : {}),
    ...(leaseToken ? { leaseToken } : {}),
    ...(Number.isFinite(leaseExpiresAtMs) ? { leaseExpiresAtMs } : {}),
    ...(lastError ? { lastError } : {}),
    ...(Number.isFinite(dispatchedAtMs) ? { dispatchedAtMs } : {}),
    ...(Number.isFinite(deadLetteredAtMs) ? { deadLetteredAtMs } : {}),
  };
}

/**
 * PostgreSQL outbox adapter scoped to exactly one tenant and workspace.
 * Claims and lease recovery use row locking; ack/nack mutations require the
 * active fencing token so stale dispatchers cannot commit after reassignment.
 */
export class DrizzleOutboxRepository<TPayload = unknown> implements OutboxRepository<TPayload> {
  private readonly ownerUserId: string;
  private readonly workspaceId: string;
  private readonly maxAttempts: number;

  constructor(private readonly db: AiMediaOutboxDatabase, options: DrizzleOutboxRepositoryOptions) {
    this.ownerUserId = options.ownerUserId.trim();
    this.workspaceId = options.workspaceId.trim();
    this.maxAttempts = options.maxAttempts ?? 5;
    if (!this.ownerUserId || !this.workspaceId) throw new Error("Outbox tenant and workspace scope are required");
    if (!Number.isInteger(this.maxAttempts) || this.maxAttempts < 1) throw new Error("maxAttempts must be a positive integer");
  }

  async add(
    input: { id: string; topic: string; payload: TPayload; maxAttempts: number; availableAtMs?: number },
    nowMs: number,
  ): Promise<OutboxMessage<TPayload>> {
    if (!input.id.trim() || !input.topic.trim() || !Number.isInteger(input.maxAttempts) || input.maxAttempts < 1) {
      throw new Error("Outbox identity, topic, and positive maxAttempts are required");
    }
    if (input.maxAttempts !== this.maxAttempts) {
      throw new Error(`Durable outbox uses repository maxAttempts=${this.maxAttempts}; per-message override is unsupported`);
    }
    const now = new Date(nowMs);
    const availableAt = new Date(input.availableAtMs ?? nowMs);
    const idempotencyKey = `outbox:${input.id}`;
    const result = await this.db.execute(sql`
      WITH inserted AS (
        INSERT INTO ${aiMediaOutbox} (
          id, owner_user_id, workspace_id, idempotency_key,
          aggregate_type, aggregate_id, event_type, payload,
          status, attempts, available_at, created_at, updated_at
        ) VALUES (
          ${input.id}, ${this.ownerUserId}, ${this.workspaceId}, ${idempotencyKey},
          'operations', ${input.id}, ${input.topic}, ${JSON.stringify(input.payload)}::jsonb,
          'pending', 0, ${availableAt}, ${now}, ${now}
        )
        ON CONFLICT (owner_user_id, workspace_id, idempotency_key) DO NOTHING
        RETURNING *
      )
      SELECT * FROM inserted
      UNION ALL
      SELECT existing.* FROM ${aiMediaOutbox} AS existing
      WHERE existing.owner_user_id = ${this.ownerUserId}
        AND existing.workspace_id = ${this.workspaceId}
        AND existing.idempotency_key = ${idempotencyKey}
        AND NOT EXISTS (SELECT 1 FROM inserted)
      LIMIT 1
    `);
    const row = rowsFrom<RawOutboxRow>(result)[0];
    if (!row) throw new Error("Outbox insert did not return a scoped row");
    return mapRow<TPayload>(row, this.maxAttempts);
  }

  async claim(input: { workerId: string; limit: number; leaseDurationMs: number; nowMs: number }): Promise<ClaimedOutboxMessage<TPayload>[]> {
    if (!input.workerId.trim() || !Number.isInteger(input.limit) || input.limit < 1 || input.leaseDurationMs <= 0) {
      throw new Error("A worker, positive integer limit, and positive lease duration are required");
    }
    const now = new Date(input.nowMs);
    const leaseExpiresAt = new Date(input.nowMs + input.leaseDurationMs);
    return this.db.transaction(async (tx) => {
      const result = await tx.execute(sql`
        WITH candidate AS (
          SELECT event.id
          FROM ${aiMediaOutbox} AS event
          WHERE event.owner_user_id = ${this.ownerUserId}
            AND event.workspace_id = ${this.workspaceId}
            AND event.status IN ('pending', 'retry_wait')
            AND event.budget_reservation_id IS NULL
            AND event.available_at <= ${now}
            AND event.dead_letter_at IS NULL
          ORDER BY event.available_at, event.created_at, event.id
          FOR UPDATE SKIP LOCKED
          LIMIT ${input.limit}
        )
        UPDATE ${aiMediaOutbox} AS event
        SET status = 'leased',
            attempts = event.attempts + 1,
            locked_at = ${now},
            lease_owner = ${input.workerId},
            lease_expires_at = ${leaseExpiresAt},
            fencing_token = event.fencing_token + 1,
            updated_at = ${now}
        FROM candidate
        WHERE event.id = candidate.id
          AND event.owner_user_id = ${this.ownerUserId}
          AND event.workspace_id = ${this.workspaceId}
        RETURNING event.*
      `);
      return rowsFrom<RawOutboxRow>(result).map((row) => {
        const message = mapRow<TPayload>(row, this.maxAttempts);
        if (!message.leaseToken) throw new Error(`Claimed outbox row ${message.id} has no fencing token`);
        return { message, leaseToken: message.leaseToken };
      });
    });
  }

  async markDispatched(input: { id: string; leaseToken: string; nowMs: number }): Promise<boolean> {
    const fencingToken = fencingTokenNumber(input.leaseToken);
    if (fencingToken === undefined) return false;
    const now = new Date(input.nowMs);
    const result = await this.db.execute(sql`
      UPDATE ${aiMediaOutbox} AS event
      SET status = 'dispatched', processed_at = ${now}, locked_at = NULL,
          lease_owner = NULL, lease_expires_at = NULL,
          last_error = NULL, updated_at = ${now}
      WHERE event.id = ${input.id}
        AND event.owner_user_id = ${this.ownerUserId}
        AND event.workspace_id = ${this.workspaceId}
        AND event.status = 'leased'
        AND event.lease_expires_at > ${now}
        AND event.fencing_token = ${fencingToken}
      RETURNING event.id
    `);
    return rowsFrom(result).length > 0;
  }

  async recordFailure(input: { id: string; leaseToken: string; error: string; retryAtMs: number; retryable: boolean; nowMs: number }): Promise<OutboxMessage<TPayload> | undefined> {
    const fencingToken = fencingTokenNumber(input.leaseToken);
    if (fencingToken === undefined) return undefined;
    const now = new Date(input.nowMs);
    const retryAt = new Date(Math.max(input.nowMs, input.retryAtMs));
    const result = await this.db.execute(sql`
      UPDATE ${aiMediaOutbox} AS event
      SET status = CASE
            WHEN ${input.retryable} AND event.attempts < ${this.maxAttempts} THEN 'retry_wait'
            ELSE 'dead_letter'
          END,
          available_at = CASE
            WHEN ${input.retryable} AND event.attempts < ${this.maxAttempts} THEN ${retryAt}
            ELSE event.available_at
          END,
          dead_letter_at = CASE
            WHEN ${input.retryable} AND event.attempts < ${this.maxAttempts} THEN NULL
            ELSE ${now}
          END,
          last_error = ${input.error.slice(0, 1_000)}, locked_at = NULL,
          lease_owner = NULL, lease_expires_at = NULL,
          updated_at = ${now}
      WHERE event.id = ${input.id}
        AND event.owner_user_id = ${this.ownerUserId}
        AND event.workspace_id = ${this.workspaceId}
        AND event.status = 'leased'
        AND event.lease_expires_at > ${now}
        AND event.fencing_token = ${fencingToken}
      RETURNING event.*
    `);
    const row = rowsFrom<RawOutboxRow>(result)[0];
    return row ? mapRow<TPayload>(row, this.maxAttempts) : undefined;
  }

  async reconcileExpiredLeases(nowMs: number): Promise<number> {
    const now = new Date(nowMs);
    return this.db.transaction(async (tx) => {
      const result = await tx.execute(sql`
        WITH expired AS (
          SELECT event.id
          FROM ${aiMediaOutbox} AS event
          WHERE event.owner_user_id = ${this.ownerUserId}
            AND event.workspace_id = ${this.workspaceId}
            AND event.status = 'leased'
            AND event.lease_expires_at <= ${now}
          ORDER BY event.lease_expires_at, event.id
          FOR UPDATE SKIP LOCKED
        )
        UPDATE ${aiMediaOutbox} AS event
        SET status = CASE WHEN event.attempts >= ${this.maxAttempts} THEN 'dead_letter' ELSE 'retry_wait' END,
            available_at = CASE WHEN event.attempts >= ${this.maxAttempts} THEN event.available_at ELSE ${now} END,
            dead_letter_at = CASE WHEN event.attempts >= ${this.maxAttempts} THEN ${now} ELSE NULL END,
            last_error = CASE WHEN event.attempts >= ${this.maxAttempts} THEN 'Outbox lease recovery attempt budget exhausted' ELSE event.last_error END,
            locked_at = NULL, lease_owner = NULL, lease_expires_at = NULL,
            updated_at = ${now}
        FROM expired
        WHERE event.id = expired.id
          AND event.owner_user_id = ${this.ownerUserId}
          AND event.workspace_id = ${this.workspaceId}
        RETURNING event.id
      `);
      return rowsFrom(result).length;
    });
  }

  async listDeadLetters(): Promise<OutboxMessage<TPayload>[]> {
    const result = await this.db.execute(sql`
      SELECT * FROM ${aiMediaOutbox} AS event
      WHERE event.owner_user_id = ${this.ownerUserId}
        AND event.workspace_id = ${this.workspaceId}
        AND event.status = 'dead_letter'
      ORDER BY event.dead_letter_at, event.created_at, event.id
    `);
    return rowsFrom<RawOutboxRow>(result).map((row) => mapRow<TPayload>(row, this.maxAttempts));
  }

  async counts(): Promise<Record<OutboxState, number>> {
    const result = await this.db.execute(sql`
      SELECT status, count(*)::integer AS count
      FROM ${aiMediaOutbox}
      WHERE owner_user_id = ${this.ownerUserId}
        AND workspace_id = ${this.workspaceId}
      GROUP BY status
    `);
    const counts: Record<OutboxState, number> = { held: 0, pending: 0, leased: 0, retry_wait: 0, dispatched: 0, dead_letter: 0 };
    for (const row of rowsFrom<Record<string, unknown>>(result)) {
      const key = String(row.status) as OutboxState;
      if (key in counts) counts[key] = Number(row.count ?? 0);
    }
    return counts;
  }
}
