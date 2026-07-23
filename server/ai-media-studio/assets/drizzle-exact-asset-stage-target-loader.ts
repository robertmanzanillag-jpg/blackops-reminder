import { sql, type SQL } from "drizzle-orm";
import type { TenantScope } from "../core/resource-domain";
import type { Sha256Digest } from "../planning/contracts";
import type { ExactOneVideoStageContext } from "../workers/one-video-run-once-executor";
import type { ExactAssetStageTarget, ExactAssetStageTargetLoader } from "./exact-stage-runner";

type ExecuteResult = { rows?: unknown[] } | unknown[];
export interface ExactAssetTargetDatabase { execute(query: SQL): Promise<ExecuteResult> }
export interface ExactAssetTargetTransactionalDatabase extends ExactAssetTargetDatabase {
  transaction<T>(callback: (tx: ExactAssetTargetDatabase) => Promise<T>): Promise<T>;
}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const DIGEST = /^sha256:[0-9a-f]{64}$/u;
const SAFE = /^[A-Za-z0-9][A-Za-z0-9._:/-]*$/u;
type AssetAction = "ingest_asset" | "link_asset";

/** Function-only PR36 loader; no caller-provided ingest-job id is accepted. */
export class DrizzleExactAssetStageTargetLoader implements ExactAssetStageTargetLoader {
  constructor(private readonly db: ExactAssetTargetTransactionalDatabase, private readonly scope: TenantScope) {
    assertScope(scope);
  }
  loadIngestTarget(context: ExactOneVideoStageContext): Promise<ExactAssetStageTarget | undefined> {
    return this.load(context, "ingest_asset");
  }
  loadLinkTarget(context: ExactOneVideoStageContext): Promise<ExactAssetStageTarget | undefined> {
    return this.load(context, "link_asset");
  }
  private async load(context: ExactOneVideoStageContext, action: AssetAction) {
    const identity = exactIdentity(context, this.scope, action);
    return this.db.transaction(async (tx) => {
      const row = exactOptionalRow(await tx.execute(sql`
        SELECT * FROM ai_media_worker_api.load_exact_one_video_asset_target_v1(
          ${identity.executionId}::uuid,${identity.runLeaseToken}::uuid,
          ${identity.runFencingToken}::bigint,${identity.commandDigest}::text,
          ${identity.actorUserId}::text,${identity.scope.ownerUserId}::text,
          ${identity.scope.workspaceId}::text,${identity.budgetReservationId}::uuid,
          ${identity.renderJobId}::uuid,${identity.dailyPlanSlotId}::uuid,
          ${identity.slotAttempt}::integer,${identity.workHandoffDigest}::text,
          ${identity.action}::text
        )
      `));
      if (!row) return undefined;
      assertReturnedIdentity(row, identity);
      return Object.freeze({ ingestJobId: dbUuid(row.ingest_job_id, "ingest_job_id") });
    });
  }
}
interface Identity {
  executionId: string; runLeaseToken: string; runFencingToken: bigint;
  commandDigest: Sha256Digest; actorUserId: string; scope: TenantScope;
  budgetReservationId: string; renderJobId: string; dailyPlanSlotId: string;
  slotAttempt: number; workHandoffDigest: Sha256Digest; action: AssetAction;
}
function exactIdentity(context: ExactOneVideoStageContext, scope: TenantScope, action: AssetAction): Identity {
  if (!context || context.action !== action || !context.target || !context.lease
    || context.target.scope.ownerUserId !== scope.ownerUserId
    || context.target.scope.workspaceId !== scope.workspaceId
    || !UUID.test(context.lease.executionId) || !UUID.test(context.lease.leaseToken)
    || typeof context.lease.fencingToken !== "bigint" || context.lease.fencingToken < 1n
    || !DIGEST.test(context.commandDigest) || context.lease.commandDigest !== context.commandDigest
    || context.lease.commandId !== context.commandId || !safe(context.actorUserId)
    || !UUID.test(context.target.budgetReservationId) || !UUID.test(context.target.renderJobId)
    || !UUID.test(context.target.dailyPlanSlotId)
    || !Number.isSafeInteger(context.target.slotAttempt) || context.target.slotAttempt < 1
    || !DIGEST.test(context.target.workHandoffDigest)) throw new Error("Invalid exact asset target context");
  return {
    executionId: context.lease.executionId, runLeaseToken: context.lease.leaseToken,
    runFencingToken: context.lease.fencingToken, commandDigest: context.commandDigest,
    actorUserId: context.actorUserId, scope, budgetReservationId: context.target.budgetReservationId,
    renderJobId: context.target.renderJobId, dailyPlanSlotId: context.target.dailyPlanSlotId,
    slotAttempt: context.target.slotAttempt, workHandoffDigest: context.target.workHandoffDigest, action,
  };
}
function assertReturnedIdentity(row: Record<string, unknown>, identity: Identity): void {
  if (dbUuid(row.execution_id, "execution_id") !== identity.executionId
    || dbUuid(row.run_lease_token, "run_lease_token") !== identity.runLeaseToken
    || dbBigInt(row.run_fencing_token) !== identity.runFencingToken
    || dbText(row.command_digest) !== identity.commandDigest
    || dbText(row.actor_user_id) !== identity.actorUserId
    || dbText(row.owner_user_id) !== identity.scope.ownerUserId
    || dbText(row.workspace_id) !== identity.scope.workspaceId
    || dbUuid(row.budget_reservation_id, "budget_reservation_id") !== identity.budgetReservationId
    || dbUuid(row.render_job_id, "render_job_id") !== identity.renderJobId
    || dbUuid(row.daily_plan_slot_id, "daily_plan_slot_id") !== identity.dailyPlanSlotId
    || Number(row.slot_attempt) !== identity.slotAttempt
    || dbText(row.work_handoff_digest) !== identity.workHandoffDigest
    || dbText(row.action) !== identity.action) throw new Error("Exact asset target function returned another execution");
}
function exactOptionalRow(result: ExecuteResult): Record<string, unknown> | undefined {
  const rows = Array.isArray(result) ? result : result && typeof result === "object" ? result.rows : undefined;
  if (!Array.isArray(rows) || rows.length > 1
    || rows.some((row) => !row || typeof row !== "object" || Array.isArray(row))) {
    throw new Error("Invalid exact asset target result");
  }
  return rows[0] as Record<string, unknown> | undefined;
}
function assertScope(scope: TenantScope): void {
  if (!scope || !safe(scope.ownerUserId) || !safe(scope.workspaceId)) throw new Error("Invalid exact asset target scope");
}
function safe(value: unknown): value is string {
  return typeof value === "string" && value.length <= 160 && SAFE.test(value);
}
function dbText(value: unknown): string {
  if (typeof value !== "string" || !value.length) throw new Error("Invalid exact asset target text");
  return value;
}
function dbUuid(value: unknown, label: string): string {
  const result = dbText(value);
  if (!UUID.test(result)) throw new Error(`Invalid ${label}`);
  return result;
}
function dbBigInt(value: unknown): bigint {
  try {
    const result = BigInt(String(value));
    if (result < 1n) throw new Error();
    return result;
  } catch { throw new Error("Invalid exact asset target fencing token"); }
}
