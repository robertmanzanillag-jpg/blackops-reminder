import { sql, type SQL } from "drizzle-orm";
import type { TenantScope } from "../core/resource-domain";
import type { OneVideoExecutionControlRepository } from "./one-video-execution-control-contracts";
import {
  OneVideoCostApprovalError,
  type OneVideoCostApprovalContext,
  type OneVideoCostApprovalContextLoader,
} from "./one-video-cost-approval-contracts";

type ExecuteResult = { rows?: unknown[] } | unknown[];
export type OneVideoCostApprovalDatabase = { execute(query: SQL): Promise<ExecuteResult> };
type Row = Record<string, unknown>;

const rows = (result: ExecuteResult): Row[] => (Array.isArray(result) ? result : result.rows ?? []) as Row[];
const text = (row: Row, camel: string, snake: string): string => String(row[camel] ?? row[snake] ?? "");

/**
 * Resolves internal slot identity only after the coordinator's injected
 * authorization gate. The existing strict read model proves batch metadata,
 * current quote identity, and the exact server-owned render specification.
 */
export class DrizzleOneVideoCostApprovalContextLoader implements OneVideoCostApprovalContextLoader {
  constructor(
    private readonly db: OneVideoCostApprovalDatabase,
    private readonly executionControl: OneVideoExecutionControlRepository,
  ) {}

  async load(scope: TenantScope, publicPlanKey: string, publicSlotKey: string): Promise<OneVideoCostApprovalContext | undefined> {
    const control = await this.executionControl.observe(scope, publicPlanKey, publicSlotKey);
    if (!control) return undefined;
    if (control.subject.planId !== publicPlanKey || control.subject.slotId !== publicSlotKey
      || control.maximumQuote.state !== "quoted"
      || !control.maximumQuote.quoteKey
      || !control.maximumQuote.renderSpecKey) {
      throw new OneVideoCostApprovalError("STALE_OR_CONFLICT");
    }

    const found = rows(await this.db.execute(sql`
      SELECT slots.id AS daily_plan_slot_id
      FROM ai_media_daily_plan_slots slots
      JOIN ai_media_daily_plans plans
        ON plans.owner_user_id=slots.owner_user_id AND plans.workspace_id=slots.workspace_id
        AND plans.id=slots.daily_plan_id
      WHERE slots.owner_user_id=${scope.ownerUserId} AND slots.workspace_id=${scope.workspaceId}
        AND plans.public_plan_key=${publicPlanKey} AND slots.public_slot_key=${publicSlotKey}
      LIMIT 2
    `));
    if (found.length === 0) return undefined;
    if (found.length !== 1) throw new OneVideoCostApprovalError("UNAVAILABLE");
    const dailyPlanSlotId = text(found[0]!, "dailyPlanSlotId", "daily_plan_slot_id");
    if (!dailyPlanSlotId) throw new OneVideoCostApprovalError("UNAVAILABLE");

    return Object.freeze({
      dailyPlanSlotId,
      slotAttempt: control.subject.slotAttempt,
      planId: control.subject.planId,
      batchId: control.subject.batchId,
      slotId: control.subject.slotId,
      quoteKey: control.maximumQuote.quoteKey,
      renderSpecKey: control.maximumQuote.renderSpecKey,
    });
  }
}
