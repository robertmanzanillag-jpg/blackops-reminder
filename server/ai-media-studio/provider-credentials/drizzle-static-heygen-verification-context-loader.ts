import { sql, type SQL } from "drizzle-orm";
import {
  aiMediaDailyPlans,
  aiMediaDailyPlanSlots,
  aiMediaInfluencers,
  aiMediaProviderAccounts,
  aiMediaProviderResources,
  aiMediaStaticCredentialBindings,
} from "../../../shared/models/ai-media-studio-db";
import type { TenantScope } from "../core/resource-domain";
import type { HeyGenV3StaticVerificationSelection } from "../providers/heygen-v3-static-verification-contracts";
import { STATIC_HEYGEN_SECRET_REF } from "./static-heygen-contracts";
import type {
  StaticHeyGenLiveVerificationContext,
  StaticHeyGenLiveVerificationContextLoader,
} from "./static-heygen-verification-coordinator";

type ExecuteResult = { rows?: unknown[] } | unknown[];
type Row = Record<string, unknown>;
export interface StaticHeyGenVerificationContextDatabase {
  execute(query: SQL): Promise<ExecuteResult>;
  transaction<T>(callback: (tx: { execute(query: SQL): Promise<ExecuteResult> }) => Promise<T>, config?: Readonly<{
    isolationLevel?: "repeatable read";
    accessMode?: "read only";
  }>): Promise<T>;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const SHA256 = /^sha256:[0-9a-f]{64}$/u;
const SAFE_PROVIDER_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/u;

const rows = (result: ExecuteResult): Row[] => {
  const value = Array.isArray(result) ? result : result.rows;
  return Array.isArray(value) && value.every((row) => row && typeof row === "object" && !Array.isArray(row))
    ? value as Row[]
    : [];
};
const value = (row: Row, camel: string, snake: string): unknown => row[camel] ?? row[snake];
const text = (row: Row, camel: string, snake: string): string => String(value(row, camel, snake) ?? "");
const number = (row: Row, camel: string, snake: string): number => Number(value(row, camel, snake));

/**
 * Read-only exact-current loader. It resolves the account's active roster plan,
 * pending static binding and all 5-10 avatar/voice pairs in one repeatable-read
 * snapshot. Provider-native ids remain server-only.
 */
export class DrizzleStaticHeyGenVerificationContextLoader implements StaticHeyGenLiveVerificationContextLoader {
  constructor(private readonly db: StaticHeyGenVerificationContextDatabase) {}

  async loadCurrent(scope: TenantScope): Promise<StaticHeyGenLiveVerificationContext | undefined> {
    if (!validScope(scope)) return undefined;
    return this.db.transaction((tx) => this.loadTransaction(tx, scope), {
      isolationLevel: "repeatable read",
      accessMode: "read only",
    });
  }

  private async loadTransaction(
    tx: { execute(query: SQL): Promise<ExecuteResult> },
    scope: TenantScope,
  ): Promise<StaticHeyGenLiveVerificationContext | undefined> {
    const contexts = rows(await tx.execute(sql`
      SELECT accounts.id AS provider_account_id,accounts.status AS account_status,
        accounts.credential_status,accounts.credential_source,accounts.credential_version,
        accounts.secret_ref,bindings.id AS binding_id,bindings.request_digest AS binding_request_digest,
        bindings.lifecycle_state AS binding_lifecycle_state,
        bindings.verification_state AS binding_verification_state,
        plans.id AS daily_plan_id,plans.source_roster_key,plans.source_roster_digest,
        plans.plan_digest,plans.status AS plan_status,plans.planned_slot_count
      FROM ${aiMediaProviderAccounts} accounts
      INNER JOIN ${aiMediaStaticCredentialBindings} bindings
        ON bindings.owner_user_id=accounts.owner_user_id AND bindings.workspace_id=accounts.workspace_id
        AND bindings.provider_account_id=accounts.id AND bindings.provider_key=accounts.provider_key
        AND bindings.target_credential_version=accounts.credential_version
        AND bindings.secret_ref=accounts.secret_ref
      INNER JOIN ${aiMediaDailyPlans} plans
        ON plans.owner_user_id=accounts.owner_user_id AND plans.workspace_id=accounts.workspace_id
        AND plans.provider_account_id=accounts.id AND plans.provider_key=accounts.provider_key
        AND plans.provider_credential_version=accounts.credential_version
        AND plans.source_roster_key=accounts.configuration#>>'{aiMediaStudioHeyGenRosterV1,activeRosterId}'
      WHERE accounts.owner_user_id=${scope.ownerUserId} AND accounts.workspace_id=${scope.workspaceId}
        AND accounts.provider_key='heygen' AND accounts.status='disconnected'
        AND accounts.credential_source='static_api_key' AND accounts.credential_status='unverified'
        AND accounts.static_credential_verification_id IS NULL
        AND bindings.lifecycle_state='pending' AND bindings.verification_state='unverified'
        AND plans.status='blocked' AND plans.planned_slot_count BETWEEN 50 AND 100
      ORDER BY plans.created_at DESC
      LIMIT 2
    `));
    if (contexts.length !== 1) return undefined;
    const context = contexts[0]!;
    if (!validHeader(context)) return undefined;

    const slotRows = rows(await tx.execute(sql`
      WITH exact_slots AS (
        SELECT slots.daily_plan_id,slots.provider_account_id,slots.provider_key,
          slots.provider_credential_version,slots.source_member_key,slots.influencer_id,
          slots.avatar_resource_id,slots.voice_resource_id,slots.video_number,slots.status,
          avatars.external_resource_id AS avatar_external_id,
          voices.external_resource_id AS voice_external_id
        FROM ${aiMediaDailyPlanSlots} slots
        INNER JOIN ${aiMediaInfluencers} influencers
          ON influencers.owner_user_id=slots.owner_user_id AND influencers.workspace_id=slots.workspace_id
          AND influencers.id=slots.influencer_id
          AND influencers.default_avatar_resource_id=slots.avatar_resource_id
          AND influencers.default_voice_resource_id=slots.voice_resource_id
        INNER JOIN ${aiMediaProviderResources} avatars
          ON avatars.owner_user_id=slots.owner_user_id AND avatars.workspace_id=slots.workspace_id
          AND avatars.provider_account_id=slots.provider_account_id AND avatars.provider_key=slots.provider_key
          AND avatars.id=slots.avatar_resource_id AND avatars.resource_type='avatar'
          AND avatars.status='pending_verification' AND avatars.verification_header_id IS NULL
        INNER JOIN ${aiMediaProviderResources} voices
          ON voices.owner_user_id=slots.owner_user_id AND voices.workspace_id=slots.workspace_id
          AND voices.provider_account_id=slots.provider_account_id AND voices.provider_key=slots.provider_key
          AND voices.id=slots.voice_resource_id AND voices.resource_type='voice'
          AND voices.status='pending_verification' AND voices.verification_header_id IS NULL
        WHERE slots.owner_user_id=${scope.ownerUserId} AND slots.workspace_id=${scope.workspaceId}
          AND slots.daily_plan_id=${text(context, "dailyPlanId", "daily_plan_id")}
          AND slots.provider_account_id=${text(context, "providerAccountId", "provider_account_id")}
          AND slots.provider_key='heygen'
          AND slots.provider_credential_version=${number(context, "credentialVersion", "credential_version")}
          AND slots.status='blocked'
        ORDER BY slots.source_member_key,slots.video_number
        LIMIT 101
      ) SELECT * FROM exact_slots
    `));
    const plannedSlotCount = number(context, "plannedSlotCount", "planned_slot_count");
    if (slotRows.length !== plannedSlotCount) return undefined;
    const selections = selectionsFromRows(slotRows, context);
    if (!selections) return undefined;

    return Object.freeze({
      scope: Object.freeze({ ...scope }),
      providerAccountId: text(context, "providerAccountId", "provider_account_id"),
      providerKey: "heygen" as const,
      providerCredentialVersion: number(context, "credentialVersion", "credential_version"),
      accountStatus: "disconnected" as const,
      credentialStatus: "unverified" as const,
      credentialSource: "static_api_key" as const,
      staticCredentialBindingId: text(context, "bindingId", "binding_id"),
      credentialBindingRequestDigest: text(context, "bindingRequestDigest", "binding_request_digest") as `sha256:${string}`,
      bindingLifecycleState: "pending" as const,
      bindingVerificationState: "unverified" as const,
      secretRef: text(context, "secretRef", "secret_ref"),
      dailyPlanId: text(context, "dailyPlanId", "daily_plan_id"),
      sourceRosterKey: text(context, "sourceRosterKey", "source_roster_key"),
      sourceRosterDigest: text(context, "sourceRosterDigest", "source_roster_digest") as `sha256:${string}`,
      planDigest: text(context, "planDigest", "plan_digest") as `sha256:${string}`,
      planStatus: "blocked" as const,
      plannedSlotCount,
      selections: Object.freeze(selections),
    });
  }
}

function validHeader(row: Row): boolean {
  const version = number(row, "credentialVersion", "credential_version");
  const slots = number(row, "plannedSlotCount", "planned_slot_count");
  return UUID.test(text(row, "providerAccountId", "provider_account_id"))
    && text(row, "accountStatus", "account_status") === "disconnected"
    && text(row, "credentialStatus", "credential_status") === "unverified"
    && text(row, "credentialSource", "credential_source") === "static_api_key"
    && Number.isSafeInteger(version) && version >= 1
    && STATIC_HEYGEN_SECRET_REF.test(text(row, "secretRef", "secret_ref"))
    && UUID.test(text(row, "bindingId", "binding_id"))
    && SHA256.test(text(row, "bindingRequestDigest", "binding_request_digest"))
    && text(row, "bindingLifecycleState", "binding_lifecycle_state") === "pending"
    && text(row, "bindingVerificationState", "binding_verification_state") === "unverified"
    && UUID.test(text(row, "dailyPlanId", "daily_plan_id"))
    && /^roster_[a-f0-9]{24}$/u.test(text(row, "sourceRosterKey", "source_roster_key"))
    && SHA256.test(text(row, "sourceRosterDigest", "source_roster_digest"))
    && SHA256.test(text(row, "planDigest", "plan_digest"))
    && text(row, "planStatus", "plan_status") === "blocked"
    && Number.isSafeInteger(slots) && slots >= 50 && slots <= 100 && slots % 10 === 0;
}

function selectionsFromRows(rows: readonly Row[], header: Row): HeyGenV3StaticVerificationSelection[] | undefined {
  const planId = text(header, "dailyPlanId", "daily_plan_id");
  const accountId = text(header, "providerAccountId", "provider_account_id");
  const credentialVersion = number(header, "credentialVersion", "credential_version");
  const groups = new Map<string, Row[]>();
  for (const row of rows) {
    if (text(row, "dailyPlanId", "daily_plan_id") !== planId
      || text(row, "providerAccountId", "provider_account_id") !== accountId
      || text(row, "providerKey", "provider_key") !== "heygen"
      || number(row, "providerCredentialVersion", "provider_credential_version") !== credentialVersion
      || text(row, "status", "status") !== "blocked"
      || !UUID.test(text(row, "avatarResourceId", "avatar_resource_id"))
      || !UUID.test(text(row, "voiceResourceId", "voice_resource_id"))
      || !UUID.test(text(row, "influencerId", "influencer_id"))
      || !SAFE_PROVIDER_ID.test(text(row, "avatarExternalId", "avatar_external_id"))
      || !SAFE_PROVIDER_ID.test(text(row, "voiceExternalId", "voice_external_id"))) return undefined;
    const avatarResourceId = text(row, "avatarResourceId", "avatar_resource_id");
    groups.set(avatarResourceId, [...(groups.get(avatarResourceId) ?? []), row]);
  }
  if (groups.size < 5 || groups.size > 10) return undefined;
  const selections: HeyGenV3StaticVerificationSelection[] = [];
  const externalLooks = new Set<string>();
  const sourceMembers = new Set<string>();
  const influencers = new Set<string>();
  for (const group of groups.values()) {
    const first = group[0]!;
    const signature = (row: Row) => JSON.stringify([
      text(row, "sourceMemberKey", "source_member_key"),
      text(row, "influencerId", "influencer_id"),
      text(row, "avatarExternalId", "avatar_external_id"),
      text(row, "voiceResourceId", "voice_resource_id"),
      text(row, "voiceExternalId", "voice_external_id"),
    ]);
    const videos = new Set(group.map((row) => number(row, "videoNumber", "video_number")));
    if (group.length !== 10 || videos.size !== 10
      || [...videos].some((video) => !Number.isInteger(video) || video < 1 || video > 10)
      || group.some((row) => signature(row) !== signature(first))) return undefined;
    const avatarLookId = text(first, "avatarExternalId", "avatar_external_id");
    const sourceMember = text(first, "sourceMemberKey", "source_member_key");
    const influencer = text(first, "influencerId", "influencer_id");
    if (!/^member_[a-f0-9]{24}$/u.test(sourceMember)
      || externalLooks.has(avatarLookId)
      || sourceMembers.has(sourceMember)
      || influencers.has(influencer)) return undefined;
    externalLooks.add(avatarLookId);
    sourceMembers.add(sourceMember);
    influencers.add(influencer);
    selections.push(Object.freeze({
      avatarLookId,
      voiceId: text(first, "voiceExternalId", "voice_external_id"),
      requiredEngine: "avatar_iv" as const,
    }));
  }
  return selections.sort((left, right) => left.avatarLookId.localeCompare(right.avatarLookId));
}

function validScope(scope: TenantScope): boolean {
  return Boolean(scope.ownerUserId && scope.ownerUserId === scope.ownerUserId.trim() && scope.ownerUserId.length <= 255
    && scope.workspaceId && scope.workspaceId === scope.workspaceId.trim() && scope.workspaceId.length <= 255);
}
