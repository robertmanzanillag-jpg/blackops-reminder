import { sql, type SQL } from "drizzle-orm";
import type { TenantScope } from "../core/resource-domain";
import type { OneVideoExecutionControlRepository } from "./one-video-execution-control-contracts";
import {
  OneVideoHeldAdmissionError,
  type OneVideoHeldAdmissionContext,
  type OneVideoHeldAdmissionContextLoader,
} from "./one-video-held-admission-contracts";

type ExecuteResult = { rows?: unknown[] } | unknown[];
export type OneVideoHeldAdmissionContextDatabase = { execute(query: SQL): Promise<ExecuteResult> };
type Row = Record<string, unknown>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const rows = (result: ExecuteResult): Row[] => (Array.isArray(result) ? result : result.rows ?? []) as Row[];
const value = (row: Row, camel: string, snake: string): unknown => row[camel] ?? row[snake];
const text = (row: Row, camel: string, snake: string): string => String(value(row, camel, snake) ?? "");
const number = (row: Row, camel: string, snake: string): number => Number(value(row, camel, snake));

/**
 * Resolves internal identities, state versions, money and expiry from
 * PostgreSQL plus the existing exact-slot read model. The browser contributes
 * only public plan/slot lookup keys. The eventual admission transaction still
 * re-locks and revalidates every returned fact.
 */
export class DrizzleOneVideoHeldAdmissionContextLoader implements OneVideoHeldAdmissionContextLoader {
  private readonly reservationTtlSeconds: number;

  constructor(
    private readonly db: OneVideoHeldAdmissionContextDatabase,
    private readonly executionControl: OneVideoExecutionControlRepository,
    options: Readonly<{ reservationTtlSeconds: number }>,
  ) {
    if (!Number.isSafeInteger(options?.reservationTtlSeconds)
      || options.reservationTtlSeconds < 30 || options.reservationTtlSeconds > 3_600) {
      throw new OneVideoHeldAdmissionError("UNAVAILABLE");
    }
    this.reservationTtlSeconds = options.reservationTtlSeconds;
  }

  async load(scope: TenantScope, publicPlanKey: string, publicSlotKey: string): Promise<OneVideoHeldAdmissionContext | undefined> {
    const control = await this.executionControl.observe(scope, publicPlanKey, publicSlotKey);
    if (!control) return undefined;
    const quote = control.maximumQuote;
    const approval = control.humanApproval;
    if (control.subject.planId !== publicPlanKey || control.subject.slotId !== publicSlotKey
      || control.binding.state !== "current" || control.providerVerification.state !== "verified"
      || quote.state !== "quoted" || !quote.quoteKey || !quote.renderSpecKey
      || !quote.amountMicroUsd || quote.currency !== "USD" || !quote.expiresAt
      || approval.state !== "approved" || approval.approvedQuoteKey !== quote.quoteKey
      || approval.renderSpecKey !== quote.renderSpecKey) {
      throw new OneVideoHeldAdmissionError("STALE_OR_CONFLICT");
    }

    const found = rows(await this.db.execute(sql`
      SELECT plans.id AS daily_plan_id, slots.id AS daily_plan_slot_id,
        slots.state_version AS slot_state_version,
        buckets.id AS budget_bucket_id, buckets.state_version AS bucket_state_version,
        transaction_timestamp() AS database_now
      FROM ai_media_daily_plans plans
      INNER JOIN ai_media_daily_plan_slots slots
        ON slots.owner_user_id=plans.owner_user_id AND slots.workspace_id=plans.workspace_id
        AND slots.daily_plan_id=plans.id
      INNER JOIN ai_media_budget_buckets buckets
        ON buckets.owner_user_id=plans.owner_user_id AND buckets.workspace_id=plans.workspace_id
        AND buckets.budget_date=plans.plan_date
        AND buckets.accounting_time_zone=plans.accounting_time_zone AND buckets.currency='USD'
      WHERE plans.owner_user_id=${scope.ownerUserId} AND plans.workspace_id=${scope.workspaceId}
        AND plans.public_plan_key=${publicPlanKey} AND slots.public_slot_key=${publicSlotKey}
        AND plans.status='planned' AND slots.status='planned'
        AND plans.plan_date=(transaction_timestamp() AT TIME ZONE plans.accounting_time_zone)::date
      LIMIT 2
    `));
    if (found.length === 0) return undefined;
    if (found.length !== 1) throw new OneVideoHeldAdmissionError("UNAVAILABLE");
    const row = found[0]!;
    const planId = text(row, "dailyPlanId", "daily_plan_id");
    const dailyPlanSlotId = text(row, "dailyPlanSlotId", "daily_plan_slot_id");
    const budgetBucketId = text(row, "budgetBucketId", "budget_bucket_id");
    const expectedSlotStateVersion = number(row, "slotStateVersion", "slot_state_version");
    const expectedBucketStateVersion = number(row, "bucketStateVersion", "bucket_state_version");
    const databaseNow = instant(value(row, "databaseNow", "database_now"));
    const quoteExpiresAt = instant(quote.expiresAt);
    const reservationExpiresAt = new Date(Math.min(
      Date.parse(quoteExpiresAt),
      Date.parse(databaseNow) + this.reservationTtlSeconds * 1_000,
    )).toISOString();

    if (![planId, dailyPlanSlotId, budgetBucketId].every((item) => UUID.test(item))
      || !Number.isSafeInteger(expectedSlotStateVersion) || expectedSlotStateVersion < 1
      || !Number.isSafeInteger(expectedBucketStateVersion) || expectedBucketStateVersion < 1
      || Date.parse(quoteExpiresAt) <= Date.parse(databaseNow)
      || Date.parse(reservationExpiresAt) <= Date.parse(databaseNow)) {
      throw new OneVideoHeldAdmissionError("STALE_OR_CONFLICT");
    }

    return Object.freeze({
      scope: Object.freeze({ ownerUserId: scope.ownerUserId, workspaceId: scope.workspaceId }),
      planId,
      dailyPlanSlotId,
      budgetBucketId,
      publicPlanKey,
      publicBatchKey: control.subject.batchId,
      publicSlotKey,
      publicQuoteKey: quote.quoteKey,
      publicRenderSpecKey: quote.renderSpecKey,
      slotAttempt: control.subject.slotAttempt,
      expectedSlotStateVersion,
      expectedBucketStateVersion,
      maximumQuoteMicroUsd: quote.amountMicroUsd,
      currency: "USD",
      quoteExpiresAt,
      reservationExpiresAt,
    });
  }
}

function instant(raw: unknown): string {
  const parsed = raw instanceof Date ? raw : new Date(String(raw));
  if (!Number.isFinite(parsed.getTime())) throw new OneVideoHeldAdmissionError("UNAVAILABLE");
  return parsed.toISOString();
}
