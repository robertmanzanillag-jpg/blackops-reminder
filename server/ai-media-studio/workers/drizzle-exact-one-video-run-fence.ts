import { sql, type SQL } from "drizzle-orm";
import type { TenantScope } from "../core/resource-domain";
import type { Sha256Digest } from "../planning/contracts";
import type {
  ExactOneVideoFenceAcquireResult,
  ExactOneVideoRunFence,
  ExactOneVideoRunLease,
  ExactOneVideoRunTarget,
  ExactOneVideoStageOutcome,
  ExactOneVideoStageResult,
  OneVideoRunOnceAction,
} from "./one-video-run-once-executor";

type ExecuteResult = { rows?: unknown[] } | unknown[];
export interface ExactOneVideoRunFenceDatabase {
  execute(query: SQL): Promise<ExecuteResult>;
}
export interface ExactOneVideoRunFenceTransactionalDatabase extends ExactOneVideoRunFenceDatabase {
  transaction<T>(callback: (tx: ExactOneVideoRunFenceDatabase) => Promise<T>): Promise<T>;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const DIGEST = /^sha256:[0-9a-f]{64}$/u;
const SAFE = /^[A-Za-z0-9][A-Za-z0-9._:/-]*$/u;
const ACTIONS = new Set<OneVideoRunOnceAction>([
  "activate_and_submit", "reconcile_submission", "observe_terminal", "ingest_asset", "link_asset",
]);
const OUTCOMES = new Set<ExactOneVideoStageOutcome>([
  "confirmed", "ambiguous", "reconciled_no_submit", "processing", "completed", "failed",
  "asset_completed", "asset_completed_unlinked", "asset_linked", "retry_scheduled",
  "dead_letter", "lease_lost", "idle", "authorization_lost",
]);

/**
 * Function-only durable fence adapter. The connected principal must be
 * table-blind; all acquire/finalize transitions go through reviewed
 * SECURITY DEFINER functions from the pending exact-run migration.
 */
export class DrizzleExactOneVideoRunFence implements ExactOneVideoRunFence {
  constructor(
    private readonly db: ExactOneVideoRunFenceTransactionalDatabase,
    private readonly options: { capabilityId: string; scope: TenantScope; leaseDurationMs: number },
  ) {
    if (!UUID.test(options.capabilityId)
      || !safePart(options.scope.ownerUserId, 160) || !safePart(options.scope.workspaceId, 160)
      || !Number.isInteger(options.leaseDurationMs) || options.leaseDurationMs < 1
      || options.leaseDurationMs > 300_000) {
      throw new Error("Invalid exact one-video fence configuration");
    }
  }

  async acquire(input: {
    target: ExactOneVideoRunTarget;
    action: OneVideoRunOnceAction;
    commandId: string;
    commandDigest: Sha256Digest;
    actorUserId: string;
  }): Promise<ExactOneVideoFenceAcquireResult> {
    assertAcquireInput(input, this.options.scope);
    return committedCall(this.db, sql`SELECT * FROM ai_media_worker_api.acquire_exact_one_video_run_v1(
      ${this.options.capabilityId}::uuid,${this.options.scope.ownerUserId}::text,
      ${this.options.scope.workspaceId}::text,${input.target.budgetReservationId}::uuid,
      ${input.target.renderJobId}::uuid,${input.target.dailyPlanSlotId}::uuid,
      ${input.target.slotAttempt}::integer,${input.target.workHandoffDigest}::text,
      ${input.action}::text,${input.commandId}::text,${input.commandDigest}::text,
      ${input.actorUserId}::text,${this.options.leaseDurationMs}::integer
    )`, (row) => decodeAcquire(row, input));
  }

  async complete(input: {
    lease: ExactOneVideoRunLease;
    result: ExactOneVideoStageResult;
  }): Promise<boolean> {
    assertLease(input.lease);
    assertResult(input.result, this.options.scope);
    return committedCall(this.db, sql`SELECT * FROM ai_media_worker_api.complete_exact_one_video_run_v1(
      ${this.options.capabilityId}::uuid,${this.options.scope.ownerUserId}::text,
      ${this.options.scope.workspaceId}::text,${input.lease.executionId}::uuid,
      ${input.lease.commandId}::text,${input.lease.commandDigest}::text,
      ${input.lease.fencingToken}::bigint,${input.lease.leaseToken}::uuid,
      ${input.result.target.budgetReservationId}::uuid,${input.result.target.renderJobId}::uuid,
      ${input.result.target.dailyPlanSlotId}::uuid,${input.result.target.slotAttempt}::integer,
      ${input.result.target.workHandoffDigest}::text,${input.result.action}::text,
      ${input.result.outcome}::text
    )`, applied);
  }

  async sealUncertain(input: {
    lease: ExactOneVideoRunLease;
    errorDigest: Sha256Digest;
  }): Promise<boolean> {
    assertLease(input.lease);
    if (!DIGEST.test(input.errorDigest)) throw new Error("Invalid exact one-video uncertainty digest");
    return committedCall(this.db, sql`SELECT * FROM ai_media_worker_api.seal_exact_one_video_run_uncertain_v1(
      ${this.options.capabilityId}::uuid,${this.options.scope.ownerUserId}::text,
      ${this.options.scope.workspaceId}::text,${input.lease.executionId}::uuid,
      ${input.lease.commandId}::text,${input.lease.commandDigest}::text,
      ${input.lease.fencingToken}::bigint,${input.lease.leaseToken}::uuid,
      ${input.errorDigest}::text
    )`, applied);
  }
}

async function committedCall<T>(
  db: ExactOneVideoRunFenceTransactionalDatabase,
  query: SQL,
  decode: (row: Record<string, unknown> | undefined) => T,
): Promise<T> {
  return db.transaction(async (tx) => decode(exactOptionalRow(await tx.execute(query))));
}

function decodeAcquire(
  row: Record<string, unknown> | undefined,
  input: {
    target: ExactOneVideoRunTarget;
    action: OneVideoRunOnceAction;
    commandId: string;
    commandDigest: Sha256Digest;
    actorUserId: string;
  },
): ExactOneVideoFenceAcquireResult {
  if (!row || typeof row.kind !== "string") throw new Error("Invalid exact one-video fence result");
  if (row.kind === "busy" || row.kind === "conflict") return { kind: row.kind };
  const returned = targetFrom(row);
  if (!sameTarget(returned, input.target)
    || text(row.action) !== input.action || text(row.command_id) !== input.commandId
    || digest(row.command_digest) !== input.commandDigest || text(row.actor_user_id) !== input.actorUserId) {
    throw new Error("Exact one-video fence returned another command");
  }
  if (row.kind === "replayed") {
    const outcome = text(row.outcome);
    if (!OUTCOMES.has(outcome as ExactOneVideoStageOutcome)) {
      throw new Error("Invalid exact one-video replay outcome");
    }
    return {
      kind: "replayed",
      result: { target: returned, action: input.action, outcome: outcome as ExactOneVideoStageOutcome },
    };
  }
  if (row.kind !== "acquired") throw new Error("Unknown exact one-video fence result");
  const lease: ExactOneVideoRunLease = {
    executionId: uuid(row.execution_id, "execution_id"),
    commandId: input.commandId,
    commandDigest: input.commandDigest,
    fencingToken: positiveBigInt(row.fencing_token),
    leaseToken: uuid(row.lease_token, "lease_token"),
  } as ExactOneVideoRunLease;
  return { kind: "acquired", lease };
}

function applied(row: Record<string, unknown> | undefined): boolean {
  if (!row || typeof row.applied !== "boolean") throw new Error("Invalid exact one-video fence mutation result");
  return row.applied;
}

function assertAcquireInput(
  input: {
    target: ExactOneVideoRunTarget;
    action: OneVideoRunOnceAction;
    commandId: string;
    commandDigest: Sha256Digest;
    actorUserId: string;
  },
  scope: TenantScope,
): void {
  assertTarget(input.target, scope);
  if (!ACTIONS.has(input.action) || !safePart(input.commandId, 160)
    || !DIGEST.test(input.commandDigest) || !safePart(input.actorUserId, 160)) {
    throw new Error("Invalid exact one-video fence acquire input");
  }
}

function assertResult(result: ExactOneVideoStageResult, scope: TenantScope): void {
  assertTarget(result.target, scope);
  if (!ACTIONS.has(result.action) || !OUTCOMES.has(result.outcome)) {
    throw new Error("Invalid exact one-video fence result");
  }
}

function assertTarget(target: ExactOneVideoRunTarget, scope: TenantScope): void {
  if (!target || target.scope.ownerUserId !== scope.ownerUserId
    || target.scope.workspaceId !== scope.workspaceId
    || !UUID.test(target.budgetReservationId) || !UUID.test(target.renderJobId)
    || !UUID.test(target.dailyPlanSlotId)
    || !Number.isSafeInteger(target.slotAttempt) || target.slotAttempt < 1
    || !DIGEST.test(target.workHandoffDigest)) {
    throw new Error("Invalid exact one-video fence target");
  }
}

function assertLease(lease: ExactOneVideoRunLease): void {
  if (!lease || !UUID.test(lease.executionId) || !safePart(lease.commandId, 160)
    || !DIGEST.test(lease.commandDigest) || typeof lease.fencingToken !== "bigint"
    || lease.fencingToken < 1n || !UUID.test(lease.leaseToken)) {
    throw new Error("Invalid exact one-video fence lease");
  }
}

function targetFrom(row: Record<string, unknown>): ExactOneVideoRunTarget {
  return Object.freeze({
    scope: Object.freeze({
      ownerUserId: text(row.owner_user_id),
      workspaceId: text(row.workspace_id),
    }),
    budgetReservationId: uuid(row.budget_reservation_id, "budget_reservation_id"),
    renderJobId: uuid(row.render_job_id, "render_job_id"),
    dailyPlanSlotId: uuid(row.daily_plan_slot_id, "daily_plan_slot_id"),
    slotAttempt: positiveInteger(row.slot_attempt),
    workHandoffDigest: digest(row.work_handoff_digest),
  });
}

function sameTarget(left: ExactOneVideoRunTarget, right: ExactOneVideoRunTarget): boolean {
  return left.scope.ownerUserId === right.scope.ownerUserId
    && left.scope.workspaceId === right.scope.workspaceId
    && left.budgetReservationId === right.budgetReservationId
    && left.renderJobId === right.renderJobId
    && left.dailyPlanSlotId === right.dailyPlanSlotId
    && left.slotAttempt === right.slotAttempt
    && left.workHandoffDigest === right.workHandoffDigest;
}

function exactOptionalRow(result: ExecuteResult): Record<string, unknown> | undefined {
  const value = Array.isArray(result) ? result : result && typeof result === "object" ? result.rows : undefined;
  if (!Array.isArray(value) || value.length > 1
    || value.some((row) => !row || typeof row !== "object" || Array.isArray(row))) {
    throw new Error("Invalid exact one-video fence function result");
  }
  return value[0] as Record<string, unknown> | undefined;
}

function text(value: unknown): string {
  if (typeof value !== "string" || !value.length) throw new Error("Invalid exact one-video fence text");
  return value;
}
function uuid(value: unknown, label: string): string {
  const result = text(value);
  if (!UUID.test(result)) throw new Error(`Invalid ${label}`);
  return result;
}
function digest(value: unknown): Sha256Digest {
  const result = text(value);
  if (!DIGEST.test(result)) throw new Error("Invalid exact one-video fence digest");
  return result as Sha256Digest;
}
function positiveInteger(value: unknown): number {
  const result = Number(value);
  if (!Number.isSafeInteger(result) || result < 1) throw new Error("Invalid exact one-video positive integer");
  return result;
}
function positiveBigInt(value: unknown): bigint {
  try {
    const result = BigInt(String(value));
    if (result < 1n) throw new Error();
    return result;
  } catch {
    throw new Error("Invalid exact one-video fencing token");
  }
}
function safePart(value: unknown, max: number): value is string {
  return typeof value === "string" && value.length <= max && SAFE.test(value);
}
