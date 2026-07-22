import { sql, type SQL } from "drizzle-orm";
import type { HeyGenOnboardingReadiness } from "../../../shared/ai-media-studio-heygen-onboarding";
import { heyGenOnboardingReadinessSchema } from "../../../shared/ai-media-studio-heygen-onboarding";
import { INITIAL_CREATOR_CANARY_PROFILE } from "../../../shared/ai-media-studio-launch-plan-profile";
import { aiMediaDailyPlans, aiMediaDailyPlanSlots, aiMediaProviderAccounts } from "../../../shared/models/ai-media-studio-db";
import type { TenantScope } from "../core/resource-domain";

type ExecuteResult = { rows?: unknown[] } | unknown[];
export type HeyGenOnboardingExecutor = { execute(query: SQL): Promise<ExecuteResult> };
export type HeyGenOnboardingDatabase = HeyGenOnboardingExecutor & {
  transaction<T>(
    callback: (tx: HeyGenOnboardingExecutor) => Promise<T>,
    config?: { isolationLevel: "repeatable read"; accessMode: "read only" },
  ): Promise<T>;
};

type AccountObservation = Readonly<{
  id: string;
  status: string;
  credentialStatus: string;
  credentialVersion: number;
  credentialSource: string;
}>;

type PlanObservation = Readonly<{
  providerAccountId: string;
  credentialVersion: number;
  status: string;
  plannedSlotCount: number;
  slotCount: number;
  memberCount: number;
}>;

export type HeyGenOnboardingObservation = Readonly<{
  observedAt: string;
  accounts: readonly AccountObservation[];
  plans: readonly PlanObservation[];
}>;

export interface HeyGenOnboardingReadinessRepository {
  observe(scope: TenantScope): Promise<HeyGenOnboardingObservation>;
}

export class HeyGenOnboardingReadinessError extends Error {
  readonly code: "INVALID_REQUEST" | "UNAVAILABLE";
  readonly statusCode: 400 | 503;

  constructor(code: "INVALID_REQUEST" | "UNAVAILABLE") {
    super("HeyGen onboarding readiness is unavailable");
    this.name = "HeyGenOnboardingReadinessError";
    this.code = code;
    this.statusCode = code === "INVALID_REQUEST" ? 400 : 503;
  }
}

function rows(result: ExecuteResult): Record<string, unknown>[] {
  const values = Array.isArray(result) ? result : result.rows;
  return Array.isArray(values) ? values as Record<string, unknown>[] : [];
}

function value(row: Record<string, unknown>, camel: string, snake: string): unknown {
  return row[camel] ?? row[snake];
}

function requiredText(row: Record<string, unknown>, camel: string, snake: string): string {
  const item = value(row, camel, snake);
  if (typeof item !== "string" || !item.trim()) throw new HeyGenOnboardingReadinessError("UNAVAILABLE");
  return item;
}

function integer(row: Record<string, unknown>, camel: string, snake: string): number {
  const item = Number(value(row, camel, snake));
  if (!Number.isSafeInteger(item) || item < 0) throw new HeyGenOnboardingReadinessError("UNAVAILABLE");
  return item;
}

function iso(value: unknown): string {
  const date = value instanceof Date ? value : new Date(String(value));
  if (!Number.isFinite(date.getTime())) throw new HeyGenOnboardingReadinessError("UNAVAILABLE");
  return date.toISOString();
}

function validScope(scope: TenantScope): boolean {
  return typeof scope?.ownerUserId === "string" && scope.ownerUserId.trim().length > 0 && scope.ownerUserId.length <= 256
    && typeof scope?.workspaceId === "string" && scope.workspaceId.trim().length > 0 && scope.workspaceId.length <= 256;
}

/** Reads metadata and aggregate roster shape only; secret refs and native provider IDs are never selected. */
export class DrizzleHeyGenOnboardingReadinessRepository implements HeyGenOnboardingReadinessRepository {
  constructor(private readonly db: HeyGenOnboardingDatabase) {}

  async observe(scope: TenantScope): Promise<HeyGenOnboardingObservation> {
    if (!validScope(scope)) throw new HeyGenOnboardingReadinessError("INVALID_REQUEST");
    try {
      return await this.db.transaction(async (tx) => {
        const clockRows = rows(await tx.execute(sql`SELECT clock_timestamp() AS observed_at`));
        if (clockRows.length !== 1) throw new HeyGenOnboardingReadinessError("UNAVAILABLE");
        const accountRows = rows(await tx.execute(sql`
          SELECT id, status, credential_status, credential_version, credential_source
          FROM ${aiMediaProviderAccounts}
          WHERE owner_user_id=${scope.ownerUserId} AND workspace_id=${scope.workspaceId}
            AND provider_key='heygen'
          ORDER BY updated_at DESC, id ASC
          LIMIT 2
        `));
        const planRows = rows(await tx.execute(sql`
          SELECT plans.provider_account_id, plans.provider_credential_version,
            plans.status, plans.planned_slot_count,
            count(slots.id)::integer AS slot_count,
            count(DISTINCT slots.source_member_key)::integer AS member_count
          FROM ${aiMediaDailyPlans} plans
          LEFT JOIN ${aiMediaDailyPlanSlots} slots
            ON slots.owner_user_id=plans.owner_user_id AND slots.workspace_id=plans.workspace_id
            AND slots.daily_plan_id=plans.id AND slots.provider_account_id=plans.provider_account_id
            AND slots.provider_key=plans.provider_key
            AND slots.provider_credential_version=plans.provider_credential_version
          WHERE plans.owner_user_id=${scope.ownerUserId} AND plans.workspace_id=${scope.workspaceId}
            AND plans.provider_key='heygen'
          GROUP BY plans.id, plans.provider_account_id, plans.provider_credential_version,
            plans.status, plans.planned_slot_count, plans.created_at
          ORDER BY plans.created_at DESC, plans.id ASC
          LIMIT 2
        `));
        return {
          observedAt: iso(value(clockRows[0], "observedAt", "observed_at")),
          accounts: accountRows.map((row) => ({
            id: requiredText(row, "id", "id"),
            status: requiredText(row, "status", "status"),
            credentialStatus: requiredText(row, "credentialStatus", "credential_status"),
            credentialVersion: integer(row, "credentialVersion", "credential_version"),
            credentialSource: requiredText(row, "credentialSource", "credential_source"),
          })),
          plans: planRows.map((row) => ({
            providerAccountId: requiredText(row, "providerAccountId", "provider_account_id"),
            credentialVersion: integer(row, "providerCredentialVersion", "provider_credential_version"),
            status: requiredText(row, "status", "status"),
            plannedSlotCount: integer(row, "plannedSlotCount", "planned_slot_count"),
            slotCount: integer(row, "slotCount", "slot_count"),
            memberCount: integer(row, "memberCount", "member_count"),
          })),
        };
      }, { isolationLevel: "repeatable read", accessMode: "read only" });
    } catch (error) {
      if (error instanceof HeyGenOnboardingReadinessError) throw error;
      throw new HeyGenOnboardingReadinessError("UNAVAILABLE");
    }
  }
}

const TARGET = Object.freeze({
  minAvatars: INITIAL_CREATOR_CANARY_PROFILE.creators.minimum,
  maxAvatars: INITIAL_CREATOR_CANARY_PROFILE.creators.maximum,
  videosPerAvatar: INITIAL_CREATOR_CANARY_PROFILE.creators.videosPerCreator,
  minVideos: INITIAL_CREATOR_CANARY_PROFILE.slots.minimum,
  maxVideos: INITIAL_CREATOR_CANARY_PROFILE.slots.maximum,
} as const);
const EFFECTS = Object.freeze({
  providerNetworkCall: false, liveVerification: false,
  generation: INITIAL_CREATOR_CANARY_PROFILE.safety.canGenerate, admission: false,
  spend: !INITIAL_CREATOR_CANARY_PROFILE.safety.noSpend,
  deployment: false, migrationApply: false, publishing: false,
} as const);

type ReadinessStatus = HeyGenOnboardingReadiness["status"];

function summarize(observation: HeyGenOnboardingObservation): {
  status: ReadinessStatus;
  channelState: "configured" | "unselected";
  roster: HeyGenOnboardingReadiness["roster"];
} {
  if (observation.accounts.length === 0) {
    return { status: "awaiting_secure_credential", channelState: "unselected", roster: { state: "not_configured" } };
  }
  if (observation.accounts.length !== 1) {
    return { status: "account_ambiguous", channelState: "configured", roster: { state: "unavailable" } };
  }
  const account = observation.accounts[0];
  const staticMetadata = account.credentialSource === "static_api_key" && account.credentialVersion >= 1;
  const pendingVerification = staticMetadata && account.status === "disconnected" && account.credentialStatus === "unverified";
  const verified = staticMetadata && ["active", "connected"].includes(account.status) && account.credentialStatus === "active";
  const latest = observation.plans[0];
  if (!staticMetadata || (!pendingVerification && !verified)) {
    return { status: "credential_metadata_attention", channelState: staticMetadata ? "configured" : "unselected", roster: { state: "not_configured" } };
  }
  if (!latest) {
    return { status: "ready_for_roster_ids", channelState: "configured", roster: { state: "not_configured" } };
  }
  const countsInRange = latest.memberCount >= TARGET.minAvatars && latest.memberCount <= TARGET.maxAvatars
    && latest.plannedSlotCount === latest.memberCount * TARGET.videosPerAvatar
    && latest.slotCount === latest.plannedSlotCount;
  const bindingMatches = latest.providerAccountId === account.id && latest.credentialVersion === account.credentialVersion;
  if (countsInRange && !bindingMatches) {
    return {
      status: "stale_roster_binding", channelState: "configured",
      roster: { state: "stale", avatarCount: latest.memberCount, plannedVideoCount: latest.plannedSlotCount },
    };
  }
  if (!countsInRange || latest.status !== "blocked") {
    return { status: "unavailable", channelState: "configured", roster: { state: "unavailable" } };
  }
  return {
    status: "roster_configured_blocked", channelState: "configured",
    roster: { state: "configured", avatarCount: latest.memberCount, plannedVideoCount: latest.plannedSlotCount },
  };
}

function steps(status: ReadinessStatus): HeyGenOnboardingReadiness["steps"] {
  const credentialComplete = !["awaiting_secure_credential", "credential_metadata_attention", "account_ambiguous", "unavailable"].includes(status);
  const rosterComplete = status === "roster_configured_blocked";
  const stale = status === "stale_roster_binding";
  const unavailable = status === "unavailable";
  return [
    status === "awaiting_secure_credential"
      ? { id: "secure_credential_handoff", state: "action_required", owner: "robert", reasonCode: "credential_metadata_missing", actionCode: "store_api_key_in_deployment_secret_manager" }
      : { id: "secure_credential_handoff", state: credentialComplete || stale || rosterComplete ? "complete" : unavailable ? "unavailable" : "blocked", owner: "robert", reasonCode: unavailable ? "system_unavailable" : "credential_metadata_requires_review", actionCode: unavailable ? "retry_safe_status" : "review_provider_account_metadata" },
    status === "account_ambiguous"
      ? { id: "unique_account_metadata", state: "action_required", owner: "operator", reasonCode: "multiple_accounts_detected", actionCode: "resolve_duplicate_provider_accounts" }
      : { id: "unique_account_metadata", state: credentialComplete || stale || rosterComplete ? "complete" : unavailable ? "unavailable" : "blocked", owner: "operator", reasonCode: unavailable ? "system_unavailable" : "credential_metadata_requires_review", actionCode: unavailable ? "retry_safe_status" : "review_provider_account_metadata" },
    status === "ready_for_roster_ids"
      ? { id: "roster_mapping", state: "action_required", owner: "robert", reasonCode: "roster_not_configured", actionCode: "enter_5_to_10_avatar_voice_pairs" }
      : stale
        ? { id: "roster_mapping", state: "action_required", owner: "robert", reasonCode: "roster_binding_stale", actionCode: "rematerialize_roster_after_rotation" }
        : { id: "roster_mapping", state: rosterComplete ? "complete" : unavailable ? "unavailable" : "blocked", owner: "robert", reasonCode: unavailable ? "roster_shape_invalid" : rosterComplete ? "blocked_plan_materialized" : "credential_metadata_requires_review", actionCode: unavailable ? "repair_roster_state" : rosterComplete ? "no_roster_action_required" : "review_provider_account_metadata" },
    { id: "blocked_plan_materialization", state: rosterComplete ? "complete" : unavailable ? "unavailable" : "blocked", owner: "system", reasonCode: unavailable ? "roster_shape_invalid" : rosterComplete ? "blocked_plan_materialized" : stale ? "roster_binding_stale" : "roster_not_configured", actionCode: unavailable ? "repair_roster_state" : stale ? "rematerialize_roster_after_rotation" : rosterComplete ? "no_roster_action_required" : "enter_5_to_10_avatar_voice_pairs" },
    { id: "external_sandbox_requirements", state: "blocked", owner: "operator", reasonCode: "external_checks_not_started", actionCode: "complete_live_sandbox_prerequisites" },
  ];
}

export class HeyGenOnboardingReadinessService {
  constructor(private readonly repository: HeyGenOnboardingReadinessRepository) {}

  async get(scope: TenantScope): Promise<HeyGenOnboardingReadiness> {
    if (!validScope(scope)) throw new HeyGenOnboardingReadinessError("INVALID_REQUEST");
    let observation: HeyGenOnboardingObservation;
    try {
      observation = await this.repository.observe(scope);
    } catch (error) {
      if (error instanceof HeyGenOnboardingReadinessError) throw error;
      throw new HeyGenOnboardingReadinessError("UNAVAILABLE");
    }
    const summary = summarize(observation);
    return heyGenOnboardingReadinessSchema.parse({
      version: 1,
      source: "postgresql_read_only",
      observedAt: observation.observedAt,
      status: summary.status,
      target: TARGET,
      secretHandling: {
        channel: "deployment_secret_manager",
        channelState: summary.channelState,
        browserInputAllowed: false,
        requestBodyAllowed: false,
        valueObserved: false,
      },
      roster: summary.roster,
      steps: steps(summary.status),
      effects: EFFECTS,
    });
  }
}
