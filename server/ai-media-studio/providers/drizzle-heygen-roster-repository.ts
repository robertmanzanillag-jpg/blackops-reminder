import { createHash, randomUUID } from "node:crypto";
import { sql, type SQL } from "drizzle-orm";
import {
  aiMediaInfluencers,
  aiMediaDailyPlans,
  aiMediaDailyPlanSlots,
  aiMediaProviderAccounts,
  aiMediaProviderResources,
} from "../../../shared/models/ai-media-studio-db";
import {
  HEYGEN_ROSTER_DAILY_PLAN_BLOCKERS,
  HEYGEN_ROSTER_MAX_AVATARS,
  HEYGEN_ROSTER_MAX_PLANNED_VIDEOS,
  HEYGEN_ROSTER_MIN_AVATARS,
  HEYGEN_ROSTER_MIN_PLANNED_VIDEOS,
  HEYGEN_ROSTER_VIDEOS_PER_AVATAR,
  createHeyGenRosterMemberSchema,
  createHeyGenRosterRequestSchema,
  heyGenRosterDailyPlanSchema,
  type HeyGenRosterDailyPlan,
} from "../../../shared/ai-media-studio-heygen-roster";
import { INITIAL_CREATOR_CANARY_PROFILE } from "../../../shared/ai-media-studio-launch-plan-profile";
import { createInfluencerRequestSchema } from "../../../shared/ai-media-studio-core";
import { buildCanonicalRosterPersona, repairCanonicalRosterPersona } from "../core/canonical-roster-persona";
import type { TenantScope } from "../core/resource-domain";
import {
  HeyGenRosterError,
  type ConfigureHeyGenRosterRecord,
  type HeyGenRosterConfigurationInput,
  type HeyGenResolvedAccountContext,
  type HeyGenRosterAccountResolver,
  type HeyGenRosterNativeMember,
  type HeyGenRosterRecord,
  type HeyGenRosterRepository,
} from "./heygen-roster-contracts";

type ExecuteResult = { rows?: unknown[] } | unknown[];
export type HeyGenRosterExecutor = { execute(query: SQL): Promise<ExecuteResult> };
export type HeyGenRosterDatabase = HeyGenRosterExecutor & {
  transaction<T>(callback: (tx: HeyGenRosterExecutor) => Promise<T>): Promise<T>;
};

const CONFIGURATION_KEY = "aiMediaStudioHeyGenRosterV1";
const MAX_DURABLE_ROSTERS_PER_ACCOUNT = 100;

type StoredRoster = Readonly<{
  providerAccountId: string;
  credentialVersion: number;
  rosterId: string;
  requestDigest: string;
  idempotencyKey: string;
  members: readonly HeyGenRosterNativeMember[];
  configuredAt: string;
}>;

type StoredRosterNamespace = Readonly<{
  version: 1;
  activeRosterId: string;
  rosters: Readonly<Record<string, StoredRoster>>;
}>;

function rows(result: ExecuteResult): Record<string, unknown>[] {
  const values = Array.isArray(result) ? result : result.rows;
  return Array.isArray(values) ? values as Record<string, unknown>[] : [];
}

function object(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function text(row: Record<string, unknown>, camel: string, snake: string): string {
  return String(row[camel] ?? row[snake] ?? "");
}

function number(row: Record<string, unknown>, camel: string, snake: string): number {
  return Number(row[camel] ?? row[snake]);
}

function validDate(value: string): boolean {
  return Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
}

function iso(value: unknown): string {
  const parsed = value instanceof Date ? value : new Date(String(value));
  if (!Number.isFinite(parsed.getTime())) throw new HeyGenRosterError("ROSTER_UNAVAILABLE");
  return parsed.toISOString();
}

function canonicalTimeZone(value: string): string {
  try {
    if (typeof value !== "string" || value.length > 80
      || new Intl.DateTimeFormat("en-US", { timeZone: value }).resolvedOptions().timeZone !== value) {
      throw new Error("invalid zone");
    }
    return value;
  } catch {
    throw new HeyGenRosterError("ROSTER_UNAVAILABLE");
  }
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  return actual.length === keys.length && actual.every((key, index) => key === [...keys].sort()[index]);
}

function digestMembers(members: readonly HeyGenRosterNativeMember[]): string {
  return `sha256:${createHash("sha256").update(JSON.stringify({
    members: members.map(({ name, avatarId, voiceId, language, accent, gender }) => ({
      name, avatarId, voiceId, language, accent, gender,
    })),
  })).digest("hex")}`;
}

function opaqueId(prefix: "roster" | "member", seed: string): string {
  return `${prefix}_${createHash("sha256").update(seed).digest("hex").slice(0, 24)}`;
}

function publicPlanKey(rosterId: string, planDate: string, timeZone: string): string {
  return `plan_${createHash("sha256").update(`${rosterId}\0${planDate}\0${timeZone}`).digest("hex").slice(0, 24)}`;
}

function publicSlotKey(planKey: string, memberId: string, videoNumber: number): string {
  return `slot_${createHash("sha256").update(`${planKey}\0${memberId}\0${videoNumber}`).digest("hex").slice(0, 24)}`;
}

function sha256(value: unknown): string {
  return `sha256:${createHash("sha256").update(JSON.stringify(value)).digest("hex")}`;
}

function opaqueResourceKey(kind: "avatar" | "voice", seed: string): string {
  return kind === "voice"
    ? `heygen-roster-v1:voice:${createHash("sha256").update(seed).digest("hex").slice(0, 24)}`
    : `heygen-roster-v1:${seed}:avatar`;
}

function parseMember(value: unknown): HeyGenRosterNativeMember | undefined {
  const candidate = object(value);
  if (!candidate || !hasExactKeys(candidate, ["memberId", "name", "avatarId", "voiceId", "language", "accent", "gender"])) return undefined;
  const parsed = createHeyGenRosterMemberSchema.safeParse({
    name: candidate.name,
    avatarId: candidate.avatarId,
    voiceId: candidate.voiceId,
    language: candidate.language,
    accent: candidate.accent,
    gender: candidate.gender,
  });
  if (!parsed.success || typeof candidate.memberId !== "string" || !/^member_[a-f0-9]{24}$/u.test(candidate.memberId)) return undefined;
  return {
    memberId: String(candidate.memberId),
    ...parsed.data,
  };
}

function parseStoredRoster(value: unknown, scope: TenantScope): HeyGenRosterRecord | undefined {
  const candidate = object(value);
  const members = Array.isArray(candidate?.members) ? candidate.members.map(parseMember) : [];
  if (!candidate || !hasExactKeys(candidate, [
    "providerAccountId", "credentialVersion", "rosterId", "requestDigest",
    "idempotencyKey", "members", "configuredAt",
  ])
    || typeof candidate.providerAccountId !== "string"
    || !Number.isSafeInteger(candidate.credentialVersion) || Number(candidate.credentialVersion) < 1
    || typeof candidate.rosterId !== "string" || !/^roster_[a-f0-9]{24}$/u.test(candidate.rosterId)
    || typeof candidate.requestDigest !== "string" || !/^sha256:[a-f0-9]{64}$/u.test(candidate.requestDigest)
    || typeof candidate.idempotencyKey !== "string"
    || typeof candidate.configuredAt !== "string" || !validDate(candidate.configuredAt)
    || members.length < HEYGEN_ROSTER_MIN_AVATARS || members.length > HEYGEN_ROSTER_MAX_AVATARS
    || members.some((member) => !member)) return undefined;
  const validMembers = members as HeyGenRosterNativeMember[];
  const request = createHeyGenRosterRequestSchema.safeParse({
    members: validMembers.map(({ memberId: _memberId, ...member }) => member),
    idempotencyKey: candidate.idempotencyKey,
  });
  const expectedRosterId = opaqueId("roster", `${scope.ownerUserId}\0${scope.workspaceId}\0${candidate.idempotencyKey}`);
  if (!request.success || candidate.rosterId !== expectedRosterId
    || candidate.requestDigest !== digestMembers(validMembers)
    || new Set(validMembers.map((member) => member.memberId)).size !== validMembers.length
    || validMembers.some((member, index) => member.memberId !== opaqueId("member", `${candidate.rosterId}\0${index}\0${member.avatarId}`))) {
    return undefined;
  }
  return {
    scope: { ...scope },
    providerAccountId: candidate.providerAccountId,
    credentialVersion: Number(candidate.credentialVersion),
    rosterId: candidate.rosterId,
    requestDigest: candidate.requestDigest,
    idempotencyKey: candidate.idempotencyKey,
    members: validMembers,
    configuredAt: candidate.configuredAt,
  };
}

function parseNamespace(configuration: unknown, scope: TenantScope): {
  namespace: StoredRosterNamespace | undefined;
  records: Map<string, HeyGenRosterRecord>;
} {
  const root = object(configuration);
  if (!root || root[CONFIGURATION_KEY] === undefined) return { namespace: undefined, records: new Map() };
  const candidate = object(root[CONFIGURATION_KEY]);
  const rosterValues = object(candidate?.rosters);
  if (!candidate || !hasExactKeys(candidate, ["version", "activeRosterId", "rosters"])
    || candidate.version !== 1 || typeof candidate.activeRosterId !== "string" || !rosterValues) {
    throw new HeyGenRosterError("ROSTER_UNAVAILABLE");
  }
  const entries = Object.entries(rosterValues);
  if (entries.length > MAX_DURABLE_ROSTERS_PER_ACCOUNT) throw new HeyGenRosterError("ROSTER_UNAVAILABLE");
  const records = new Map<string, HeyGenRosterRecord>();
  for (const [key, value] of entries) {
    const record = parseStoredRoster(value, scope);
    if (!record || key !== record.rosterId) throw new HeyGenRosterError("ROSTER_UNAVAILABLE");
    records.set(key, record);
  }
  if (!records.has(candidate.activeRosterId)) throw new HeyGenRosterError("ROSTER_UNAVAILABLE");
  return { namespace: candidate as unknown as StoredRosterNamespace, records };
}

function sameReplay(existing: HeyGenRosterRecord, input: ConfigureHeyGenRosterRecord): boolean {
  return existing.rosterId === input.rosterId
    && existing.idempotencyKey === input.idempotencyKey
    && existing.requestDigest === input.requestDigest
    && existing.providerAccountId === input.providerAccountId
    && existing.credentialVersion === input.credentialVersion;
}

function stored(record: ConfigureHeyGenRosterRecord): StoredRoster {
  return {
    providerAccountId: record.providerAccountId,
    credentialVersion: record.credentialVersion,
    rosterId: record.rosterId,
    requestDigest: record.requestDigest,
    idempotencyKey: record.idempotencyKey,
    members: record.members.map((member) => ({ ...member })),
    configuredAt: record.configuredAt,
  };
}

function resourceMetadata(
  member: HeyGenRosterNativeMember,
  rosterId: string,
  kind: "avatar" | "voice",
  credentialVersion: number,
  liveVerified: boolean,
): Record<string, unknown> {
  if (kind === "voice") return { source: "heygen_roster", credentialVersion, liveVerified };
  return {
    language: member.language,
    accent: member.accent,
    gender: member.gender,
    source: "heygen_roster",
    rosterId,
    memberId: member.memberId,
    credentialVersion,
    liveVerified,
  };
}

async function upsertResource(input: {
  tx: HeyGenRosterExecutor;
  scope: TenantScope;
  providerAccountId: string;
  rosterId: string;
  member: HeyGenRosterNativeMember;
  kind: "avatar" | "voice";
  externalId: string;
  credentialVersion: number;
  pendingVerification: boolean;
  preserveExisting?: boolean;
}): Promise<string> {
  const {
    tx, scope, providerAccountId, rosterId, member, kind, externalId,
    credentialVersion, pendingVerification, preserveExisting = false,
  } = input;
  const displayName = kind === "avatar" ? member.name : "HeyGen voice";
  const metadata = resourceMetadata(member, rosterId, kind, credentialVersion, !pendingVerification);
  const status = pendingVerification ? "pending_verification" : "active";
  const synchronizedAt = pendingVerification ? sql`NULL` : sql`clock_timestamp()`;
  if (preserveExisting) {
    const existing = rows(await tx.execute(sql`
      SELECT id FROM ${aiMediaProviderResources}
      WHERE owner_user_id=${scope.ownerUserId} AND workspace_id=${scope.workspaceId}
        AND provider_account_id=${providerAccountId} AND provider_key='heygen'
        AND resource_type=${kind} AND external_resource_id=${externalId}
      LIMIT 1
    `))[0];
    if (existing) return text(existing, "id", "id");
  } else {
    const existing = rows(await tx.execute(sql`
      UPDATE ${aiMediaProviderResources}
      SET display_name=${displayName}, status=${status}, metadata=COALESCE(metadata, '{}'::jsonb) || ${JSON.stringify(metadata)}::jsonb,
          synchronized_at=${synchronizedAt}, updated_at=clock_timestamp()
      WHERE owner_user_id=${scope.ownerUserId} AND workspace_id=${scope.workspaceId}
        AND provider_account_id=${providerAccountId} AND provider_key='heygen'
        AND resource_type=${kind} AND external_resource_id=${externalId}
      RETURNING id
    `))[0];
    if (existing) return text(existing, "id", "id");
  }

  const id = randomUUID();
  const canonicalKey = opaqueResourceKey(kind, kind === "voice" ? externalId : member.memberId);
  const inserted = rows(await tx.execute(sql`
    INSERT INTO ${aiMediaProviderResources} (
      id, owner_user_id, workspace_id, provider_account_id, provider_key, resource_type,
      canonical_key, external_resource_id, display_name, status, metadata, synchronized_at, created_at, updated_at
    ) VALUES (
      ${id}, ${scope.ownerUserId}, ${scope.workspaceId}, ${providerAccountId}, 'heygen', ${kind},
      ${canonicalKey}, ${externalId}, ${displayName}, ${status}, ${JSON.stringify(metadata)}::jsonb,
      ${synchronizedAt}, clock_timestamp(), clock_timestamp()
    ) ON CONFLICT DO NOTHING RETURNING id
  `))[0];
  if (inserted) return text(inserted, "id", "id");
  const raced = rows(await tx.execute(sql`
    SELECT id FROM ${aiMediaProviderResources}
    WHERE owner_user_id=${scope.ownerUserId} AND workspace_id=${scope.workspaceId}
      AND provider_account_id=${providerAccountId} AND provider_key='heygen'
      AND resource_type=${kind} AND external_resource_id=${externalId}
    LIMIT 1
  `))[0];
  if (!raced) throw new HeyGenRosterError("ROSTER_UNAVAILABLE");
  return text(raced, "id", "id");
}

async function createInfluencer(input: {
  tx: HeyGenRosterExecutor;
  scope: TenantScope;
  rosterId: string;
  member: HeyGenRosterNativeMember;
  avatarResourceId: string;
  voiceResourceId: string;
}): Promise<string> {
  const { tx, scope, rosterId, member, avatarResourceId, voiceResourceId } = input;
  const influencerId = randomUUID();
  const slug = `heygen-${member.memberId.slice("member_".length)}`;
  const persona = { source: "heygen_roster", rosterId, memberId: member.memberId };
  const profile = buildCanonicalRosterPersona({
    name: member.name,
    language: member.language,
    accent: member.accent,
    gender: member.gender,
    avatarResourceId,
    voiceResourceId,
  });
  const inserted = rows(await tx.execute(sql`
    INSERT INTO ${aiMediaInfluencers} (
      id, owner_user_id, workspace_id, name, slug, status, accent, language, gender,
      age_range, personality, tone, speaking_style, categories, intro, outro, energy_level,
      facial_expressions, brand_colors, persona, default_voice_resource_id, default_avatar_resource_id,
      created_at, updated_at
    ) VALUES (
      ${influencerId}, ${scope.ownerUserId}, ${scope.workspaceId}, ${profile.name}, ${slug}, ${profile.status},
      ${profile.accent}, ${profile.language}, ${profile.gender}, ${JSON.stringify(profile.ageRange)}::jsonb,
      ${JSON.stringify(profile.personality)}::jsonb, ${JSON.stringify(profile.tone)}::jsonb,
      ${profile.speakingStyle}, ${JSON.stringify(profile.categories)}::jsonb, ${profile.intro}, ${profile.outro},
      ${profile.energyLevel}, ${JSON.stringify(profile.facialExpressions)}::jsonb, ${JSON.stringify(profile.brandColors)}::jsonb,
      ${JSON.stringify(persona)}::jsonb, ${voiceResourceId}, ${avatarResourceId}, clock_timestamp(), clock_timestamp()
    ) ON CONFLICT (owner_user_id, workspace_id, slug) DO NOTHING RETURNING id
  `))[0];
  if (inserted) return text(inserted, "id", "id");

  const existing = rows(await tx.execute(sql`
    SELECT id, persona, name, status, accent, language, gender, age_range, personality, tone,
      speaking_style, categories, intro, outro, energy_level, facial_expressions, brand_colors,
      default_voice_resource_id, default_avatar_resource_id
    FROM ${aiMediaInfluencers}
    WHERE owner_user_id=${scope.ownerUserId} AND workspace_id=${scope.workspaceId} AND slug=${slug}
    FOR UPDATE
  `))[0];
  const existingPersona = object(existing?.persona);
  if (!existing || existingPersona?.source !== "heygen_roster"
    || existingPersona.rosterId !== rosterId || existingPersona.memberId !== member.memberId) {
    throw new HeyGenRosterError("ROSTER_UNAVAILABLE");
  }
  const existingId = text(existing, "id", "id");
  const existingFields = {
    name: existing.name,
    avatarResourceId: existing.defaultAvatarResourceId ?? existing.default_avatar_resource_id ?? null,
    voiceResourceId: existing.defaultVoiceResourceId ?? existing.default_voice_resource_id ?? null,
    accent: existing.accent,
    language: existing.language,
    gender: existing.gender,
    ageRange: existing.ageRange ?? existing.age_range,
    personality: existing.personality,
    tone: existing.tone,
    speakingStyle: existing.speakingStyle ?? existing.speaking_style,
    categories: existing.categories,
    intro: existing.intro,
    outro: existing.outro,
    energyLevel: existing.energyLevel ?? existing.energy_level,
    facialExpressions: existing.facialExpressions ?? existing.facial_expressions,
    brandColors: existing.brandColors ?? existing.brand_colors,
    status: existing.status,
  };
  const existingProfile = createInfluencerRequestSchema.safeParse(existingFields);
  if (existingProfile.success
    && existingProfile.data.avatarResourceId === avatarResourceId
    && existingProfile.data.voiceResourceId === voiceResourceId) {
    return existingId;
  }
  const repaired = repairCanonicalRosterPersona(existingFields, {
    name: member.name,
    language: member.language,
    accent: member.accent,
    gender: member.gender,
    avatarResourceId,
    voiceResourceId,
  });
  const updated = rows(await tx.execute(sql`
    UPDATE ${aiMediaInfluencers}
    SET name=${repaired.name}, status=${repaired.status}, accent=${repaired.accent}, language=${repaired.language}, gender=${repaired.gender},
        age_range=${JSON.stringify(repaired.ageRange)}::jsonb, personality=${JSON.stringify(repaired.personality)}::jsonb,
        tone=${JSON.stringify(repaired.tone)}::jsonb, speaking_style=${repaired.speakingStyle},
        categories=${JSON.stringify(repaired.categories)}::jsonb, intro=${repaired.intro}, outro=${repaired.outro},
        energy_level=${repaired.energyLevel}, facial_expressions=${JSON.stringify(repaired.facialExpressions)}::jsonb,
        brand_colors=${JSON.stringify(repaired.brandColors)}::jsonb, persona=${JSON.stringify(persona)}::jsonb,
        default_voice_resource_id=${voiceResourceId}, default_avatar_resource_id=${avatarResourceId},
        archived_at=CASE WHEN ${repaired.status}='archived' THEN archived_at ELSE NULL END,
        updated_at=clock_timestamp()
    WHERE id=${existingId} AND owner_user_id=${scope.ownerUserId}
      AND workspace_id=${scope.workspaceId} AND slug=${slug}
    RETURNING id
  `))[0];
  if (!updated) throw new HeyGenRosterError("ROSTER_UNAVAILABLE");
  return text(updated, "id", "id");
}

type RosterBinding = Readonly<{
  member: HeyGenRosterNativeMember;
  avatarResourceId: string;
  voiceResourceId: string;
  influencerId: string;
}>;

async function reconcileRosterBindings(input: {
  tx: HeyGenRosterExecutor;
  record: ConfigureHeyGenRosterRecord;
  pendingVerification: boolean;
  preserveExistingResources?: boolean;
}): Promise<RosterBinding[]> {
  const { tx, record, pendingVerification, preserveExistingResources = false } = input;
  const bindings: RosterBinding[] = [];
  for (const member of record.members) {
    const avatarResourceId = await upsertResource({
      tx, scope: record.scope, providerAccountId: record.providerAccountId,
      rosterId: record.rosterId, member, kind: "avatar", externalId: member.avatarId,
      credentialVersion: record.credentialVersion, pendingVerification,
      preserveExisting: preserveExistingResources,
    });
    const voiceResourceId = await upsertResource({
      tx, scope: record.scope, providerAccountId: record.providerAccountId,
      rosterId: record.rosterId, member, kind: "voice", externalId: member.voiceId,
      credentialVersion: record.credentialVersion, pendingVerification,
      preserveExisting: preserveExistingResources,
    });
    const influencerId = await createInfluencer({
      tx, scope: record.scope, rosterId: record.rosterId, member,
      avatarResourceId, voiceResourceId,
    });
    if (!avatarResourceId || !voiceResourceId || !influencerId) {
      throw new HeyGenRosterError("ROSTER_UNAVAILABLE");
    }
    bindings.push({ member, avatarResourceId, voiceResourceId, influencerId });
  }
  return bindings;
}

/** Resolves exactly one static-key HeyGen account without selecting configuration or secret material. */
export function createDrizzleHeyGenRosterAccountResolver(db: HeyGenRosterExecutor): HeyGenRosterAccountResolver {
  return {
    async resolve(scope: TenantScope): Promise<HeyGenResolvedAccountContext | undefined> {
      const result = rows(await db.execute(sql`
        SELECT id, credential_version
        FROM ${aiMediaProviderAccounts}
        WHERE owner_user_id=${scope.ownerUserId} AND workspace_id=${scope.workspaceId}
          AND provider_key='heygen' AND credential_source='static_api_key' AND credential_version >= 1
          AND ((status='disconnected' AND credential_status='unverified')
            OR (status IN ('active', 'connected') AND credential_status='active'))
        ORDER BY id ASC LIMIT 2
      `));
      if (result.length !== 1) return undefined;
      const credentialVersion = number(result[0], "credentialVersion", "credential_version");
      const providerAccountId = text(result[0], "id", "id");
      return providerAccountId && Number.isSafeInteger(credentialVersion) && credentialVersion >= 1
        ? { providerAccountId, credentialVersion }
        : undefined;
    },
  };
}

/**
 * Reuses the account configuration namespace because PR17 intentionally adds
 * no migration. The account row lock makes roster metadata, canonical provider
 * resources, and influencer bindings one atomic PostgreSQL transaction.
 */
export class DrizzleHeyGenRosterRepository implements HeyGenRosterRepository {
  constructor(private readonly db: HeyGenRosterDatabase) {}

  async configure(input: HeyGenRosterConfigurationInput): Promise<HeyGenRosterRecord> {
    return this.db.transaction(async (tx) => {
      const accountingTimeZone = canonicalTimeZone(input.accountingTimeZone);
      const account = rows(await tx.execute(sql`
        SELECT id, credential_version, credential_status, configuration
        FROM ${aiMediaProviderAccounts}
        WHERE id=${input.providerAccountId} AND owner_user_id=${input.scope.ownerUserId}
          AND workspace_id=${input.scope.workspaceId} AND provider_key='heygen'
          AND credential_source='static_api_key'
          AND ((status='disconnected' AND credential_status='unverified')
            OR (status IN ('active', 'connected') AND credential_status='active'))
          AND credential_version=${input.credentialVersion}
        FOR UPDATE
      `))[0];
      if (!account) throw new HeyGenRosterError("ACCOUNT_UNAVAILABLE");
      const pendingVerification = text(account, "credentialStatus", "credential_status") !== "active";
      const parsed = parseNamespace(account.configuration, input.scope);
      const replay = parsed.records.get(input.rosterId);
      if (replay) {
        if (!sameReplay(replay, input)) throw new HeyGenRosterError("IDEMPOTENCY_CONFLICT");
        await reconcileRosterBindings({
          tx, record: replay, pendingVerification, preserveExistingResources: true,
        });
        const durableReplay = await this.loadDailyPlan(tx, replay, accountingTimeZone);
        if (!durableReplay) throw new HeyGenRosterError("ROSTER_UNAVAILABLE");
        return replay;
      }
      if (parsed.records.size >= MAX_DURABLE_ROSTERS_PER_ACCOUNT) {
        throw new HeyGenRosterError("ROSTER_UNAVAILABLE");
      }

      const clock = rows(await tx.execute(sql`
        SELECT observed_at, (observed_at AT TIME ZONE ${accountingTimeZone})::date::text AS plan_date
        FROM (SELECT clock_timestamp() AS observed_at) fresh_clock
      `))[0];
      if (!clock) throw new HeyGenRosterError("ROSTER_UNAVAILABLE");
      const configuredAt = iso(clock.observed_at ?? clock.observedAt);
      const planDate = text(clock, "planDate", "plan_date");
      if (!/^\d{4}-\d{2}-\d{2}$/u.test(planDate)) throw new HeyGenRosterError("ROSTER_UNAVAILABLE");
      const record: ConfigureHeyGenRosterRecord = {
        scope: { ...input.scope }, providerAccountId: input.providerAccountId,
        credentialVersion: input.credentialVersion, rosterId: input.rosterId,
        requestDigest: input.requestDigest, idempotencyKey: input.idempotencyKey,
        members: input.members.map((member) => ({ ...member })), configuredAt,
      };
      const bindings = await reconcileRosterBindings({ tx, record, pendingVerification });

      const plannedSlotCount = bindings.length * HEYGEN_ROSTER_VIDEOS_PER_AVATAR;
      if (bindings.length < HEYGEN_ROSTER_MIN_AVATARS || bindings.length > HEYGEN_ROSTER_MAX_AVATARS
        || plannedSlotCount < HEYGEN_ROSTER_MIN_PLANNED_VIDEOS
        || plannedSlotCount > HEYGEN_ROSTER_MAX_PLANNED_VIDEOS) {
        throw new HeyGenRosterError("ROSTER_UNAVAILABLE");
      }
      const planKey = publicPlanKey(record.rosterId, planDate, accountingTimeZone);
      const planDigest = sha256({
        rosterId: record.rosterId, rosterDigest: record.requestDigest, planDate,
        accountingTimeZone, members: record.members.map((member) => member.memberId),
        videosPerAvatar: HEYGEN_ROSTER_VIDEOS_PER_AVATAR,
      });
      const planUuid = randomUUID();
      const insertedPlan = rows(await tx.execute(sql`
        INSERT INTO ${aiMediaDailyPlans} (
          id, owner_user_id, workspace_id, public_plan_key, provider_account_id, provider_key,
          provider_credential_version, source_roster_key, source_roster_digest, plan_date,
          accounting_time_zone, status, planned_slot_count, idempotency_key, input_digest,
          plan_digest, created_at, updated_at, terminal_at
        ) VALUES (
          ${planUuid}, ${record.scope.ownerUserId}, ${record.scope.workspaceId}, ${planKey},
          ${record.providerAccountId}, 'heygen', ${record.credentialVersion}, ${record.rosterId},
          ${record.requestDigest}, ${planDate}::date, ${accountingTimeZone}, 'blocked', ${plannedSlotCount},
          ${`heygen-roster-plan:${record.rosterId}`}, ${record.requestDigest}, ${planDigest},
          ${configuredAt}::timestamptz, ${configuredAt}::timestamptz, NULL
        ) RETURNING id
      `))[0];
      if (!insertedPlan || text(insertedPlan, "id", "id") !== planUuid) {
        throw new HeyGenRosterError("ROSTER_UNAVAILABLE");
      }

      let insertedSlotCount = 0;
      const memberSlotCounts = new Map<string, number>();
      for (const binding of bindings) {
        for (let videoNumber = 1; videoNumber <= HEYGEN_ROSTER_VIDEOS_PER_AVATAR; videoNumber += 1) {
          const slotKey = publicSlotKey(planKey, binding.member.memberId, videoNumber);
          const slotDigest = sha256({
            planKey, rosterId: record.rosterId, memberId: binding.member.memberId, videoNumber,
            influencerId: binding.influencerId, avatarResourceId: binding.avatarResourceId,
            voiceResourceId: binding.voiceResourceId,
          });
          const slotUuid = randomUUID();
          const insertedSlot = rows(await tx.execute(sql`
            INSERT INTO ${aiMediaDailyPlanSlots} (
              id, owner_user_id, workspace_id, public_slot_key, daily_plan_id, provider_account_id,
              provider_key, provider_credential_version, source_member_key, influencer_id,
              avatar_resource_id, voice_resource_id, script_variant_id, video_number, status,
              slot_digest, state_version, created_at, updated_at
            ) VALUES (
              ${slotUuid}, ${record.scope.ownerUserId}, ${record.scope.workspaceId}, ${slotKey}, ${planUuid},
              ${record.providerAccountId}, 'heygen', ${record.credentialVersion}, ${binding.member.memberId},
              ${binding.influencerId}, ${binding.avatarResourceId}, ${binding.voiceResourceId}, NULL,
              ${videoNumber}, 'blocked', ${slotDigest}, 1, ${configuredAt}::timestamptz, ${configuredAt}::timestamptz
            ) RETURNING id
          `))[0];
          if (!insertedSlot || text(insertedSlot, "id", "id") !== slotUuid) {
            throw new HeyGenRosterError("ROSTER_UNAVAILABLE");
          }
          insertedSlotCount += 1;
          memberSlotCounts.set(binding.member.memberId, (memberSlotCounts.get(binding.member.memberId) ?? 0) + 1);
        }
      }
      if (insertedSlotCount !== plannedSlotCount || memberSlotCounts.size !== bindings.length
        || [...memberSlotCounts.values()].some((count) => count !== HEYGEN_ROSTER_VIDEOS_PER_AVATAR)) {
        throw new HeyGenRosterError("ROSTER_UNAVAILABLE");
      }

      const nextNamespace: StoredRosterNamespace = {
        version: 1,
        activeRosterId: record.rosterId,
        rosters: {
          ...Object.fromEntries([...parsed.records].map(([key, value]) => [key, stored(value)])),
          [record.rosterId]: stored(record),
        },
      };
      const updated = rows(await tx.execute(sql`
        UPDATE ${aiMediaProviderAccounts}
        SET configuration=jsonb_set(COALESCE(configuration, '{}'::jsonb), ARRAY[${CONFIGURATION_KEY}]::text[],
          ${JSON.stringify(nextNamespace)}::jsonb, true), updated_at=clock_timestamp()
        WHERE id=${input.providerAccountId} AND owner_user_id=${input.scope.ownerUserId}
          AND workspace_id=${input.scope.workspaceId} AND provider_key='heygen'
          AND credential_source='static_api_key'
          AND ((status='disconnected' AND credential_status='unverified')
            OR (status IN ('active', 'connected') AND credential_status='active'))
          AND credential_version=${input.credentialVersion}
        RETURNING id
      `))[0];
      if (!updated) throw new HeyGenRosterError("ACCOUNT_UNAVAILABLE");
      const durable = await this.loadDailyPlan(tx, record, accountingTimeZone);
      if (!durable || durable.slots.length !== plannedSlotCount) throw new HeyGenRosterError("ROSTER_UNAVAILABLE");
      return record;
    });
  }

  async get(scope: TenantScope, rosterId: string): Promise<HeyGenRosterRecord | undefined> {
    const account = await this.usableAccount(scope);
    if (!account) return undefined;
    const record = parseNamespace(account.configuration, scope).records.get(rosterId);
    return this.requireAccountBinding(account, record);
  }

  async getCurrent(scope: TenantScope): Promise<HeyGenRosterRecord | undefined> {
    const account = await this.usableAccount(scope);
    if (!account) return undefined;
    const parsed = parseNamespace(account.configuration, scope);
    const record = parsed.namespace ? parsed.records.get(parsed.namespace.activeRosterId) : undefined;
    return this.requireAccountBinding(account, record);
  }

  async getCurrentDailyPlan(scope: TenantScope): Promise<HeyGenRosterDailyPlan | undefined> {
    const account = await this.usableAccount(scope);
    if (!account) return undefined;
    const parsed = parseNamespace(account.configuration, scope);
    const record = parsed.namespace ? parsed.records.get(parsed.namespace.activeRosterId) : undefined;
    const bound = this.requireAccountBinding(account, record);
    if (!bound) return undefined;
    const planRows = rows(await this.db.execute(sql`
      SELECT accounting_time_zone FROM ${aiMediaDailyPlans}
      WHERE owner_user_id=${scope.ownerUserId} AND workspace_id=${scope.workspaceId}
        AND provider_account_id=${bound.providerAccountId} AND provider_key='heygen'
        AND provider_credential_version=${bound.credentialVersion} AND source_roster_key=${bound.rosterId}
      LIMIT 2
    `));
    if (planRows.length !== 1) throw new HeyGenRosterError("ROSTER_UNAVAILABLE");
    return this.loadDailyPlan(this.db, bound, text(planRows[0], "accountingTimeZone", "accounting_time_zone"));
  }

  private async loadDailyPlan(
    executor: HeyGenRosterExecutor,
    roster: HeyGenRosterRecord,
    unsafeTimeZone: string,
  ): Promise<HeyGenRosterDailyPlan | undefined> {
    const timeZone = canonicalTimeZone(unsafeTimeZone);
    const result = rows(await executor.execute(sql`
      SELECT plans.id AS daily_plan_id, plans.public_plan_key, plans.source_roster_key,
        plans.source_roster_digest, plans.plan_date::text AS plan_date,
        plans.accounting_time_zone, plans.status AS plan_status, plans.planned_slot_count,
        plans.plan_digest, plans.created_at,
        slots.public_slot_key, slots.source_member_key, slots.video_number,
        slots.status AS slot_status, slots.slot_digest, slots.influencer_id,
        slots.avatar_resource_id, slots.voice_resource_id, influencers.name AS creator_name,
        avatars.external_resource_id AS avatar_external_id,
        voices.external_resource_id AS voice_external_id
      FROM ${aiMediaDailyPlans} plans
      INNER JOIN ${aiMediaDailyPlanSlots} slots
        ON slots.owner_user_id=plans.owner_user_id AND slots.workspace_id=plans.workspace_id
        AND slots.daily_plan_id=plans.id AND slots.provider_account_id=plans.provider_account_id
        AND slots.provider_key=plans.provider_key
        AND slots.provider_credential_version=plans.provider_credential_version
      INNER JOIN ${aiMediaInfluencers} influencers
        ON influencers.owner_user_id=slots.owner_user_id AND influencers.workspace_id=slots.workspace_id
        AND influencers.id=slots.influencer_id
        AND influencers.persona->>'source'='heygen_roster'
        AND influencers.persona->>'rosterId'=plans.source_roster_key
        AND influencers.persona->>'memberId'=slots.source_member_key
        AND influencers.default_avatar_resource_id=slots.avatar_resource_id
        AND influencers.default_voice_resource_id=slots.voice_resource_id
      INNER JOIN ${aiMediaProviderResources} avatars
        ON avatars.owner_user_id=slots.owner_user_id AND avatars.workspace_id=slots.workspace_id
        AND avatars.provider_account_id=slots.provider_account_id AND avatars.provider_key=slots.provider_key
        AND avatars.id=slots.avatar_resource_id AND avatars.resource_type='avatar'
      INNER JOIN ${aiMediaProviderResources} voices
        ON voices.owner_user_id=slots.owner_user_id AND voices.workspace_id=slots.workspace_id
        AND voices.provider_account_id=slots.provider_account_id AND voices.provider_key=slots.provider_key
        AND voices.id=slots.voice_resource_id AND voices.resource_type='voice'
      WHERE plans.owner_user_id=${roster.scope.ownerUserId} AND plans.workspace_id=${roster.scope.workspaceId}
        AND plans.provider_account_id=${roster.providerAccountId} AND plans.provider_key='heygen'
        AND plans.provider_credential_version=${roster.credentialVersion}
        AND plans.source_roster_key=${roster.rosterId} AND plans.source_roster_digest=${roster.requestDigest}
        AND plans.accounting_time_zone=${timeZone} AND plans.status='blocked' AND slots.status='blocked'
      ORDER BY slots.source_member_key ASC, slots.video_number ASC
    `));
    if (result.length === 0) return undefined;
    const first = result[0];
    const planKey = text(first, "publicPlanKey", "public_plan_key");
    const planDate = text(first, "planDate", "plan_date");
    const createdAt = iso(first.createdAt ?? first.created_at);
    const plannedSlotCount = number(first, "plannedSlotCount", "planned_slot_count");
    const expectedPlanDigest = sha256({
      rosterId: roster.rosterId, rosterDigest: roster.requestDigest, planDate,
      accountingTimeZone: timeZone, members: roster.members.map((member) => member.memberId),
      videosPerAvatar: HEYGEN_ROSTER_VIDEOS_PER_AVATAR,
    });
    if (planKey !== publicPlanKey(roster.rosterId, planDate, timeZone)
      || text(first, "sourceRosterKey", "source_roster_key") !== roster.rosterId
      || text(first, "sourceRosterDigest", "source_roster_digest") !== roster.requestDigest
      || text(first, "planStatus", "plan_status") !== "blocked"
      || text(first, "planDigest", "plan_digest") !== expectedPlanDigest
      || plannedSlotCount !== roster.members.length * HEYGEN_ROSTER_VIDEOS_PER_AVATAR
      || result.length !== plannedSlotCount) {
      throw new HeyGenRosterError("ROSTER_UNAVAILABLE");
    }
    const memberOrder = new Map(roster.members.map((member, index) => [member.memberId, index]));
    const seen = new Set<string>();
    const memberCounts = new Map<string, Set<number>>();
    const slots = result.map((row) => {
      if (text(row, "publicPlanKey", "public_plan_key") !== planKey
        || text(row, "sourceRosterKey", "source_roster_key") !== roster.rosterId
        || text(row, "planStatus", "plan_status") !== "blocked"
        || text(row, "slotStatus", "slot_status") !== "blocked") {
        throw new HeyGenRosterError("ROSTER_UNAVAILABLE");
      }
      const memberId = text(row, "sourceMemberKey", "source_member_key");
      const member = roster.members.find((candidate) => candidate.memberId === memberId);
      const videoNumber = number(row, "videoNumber", "video_number");
      const currentSlotKey = text(row, "publicSlotKey", "public_slot_key");
      const expectedSlotDigest = sha256({
        planKey, rosterId: roster.rosterId, memberId, videoNumber,
        influencerId: text(row, "influencerId", "influencer_id"),
        avatarResourceId: text(row, "avatarResourceId", "avatar_resource_id"),
        voiceResourceId: text(row, "voiceResourceId", "voice_resource_id"),
      });
      if (!member || text(row, "creatorName", "creator_name") !== member.name
        || text(row, "avatarExternalId", "avatar_external_id") !== member.avatarId
        || text(row, "voiceExternalId", "voice_external_id") !== member.voiceId
        || !Number.isInteger(videoNumber) || videoNumber < 1 || videoNumber > HEYGEN_ROSTER_VIDEOS_PER_AVATAR
        || currentSlotKey !== publicSlotKey(planKey, memberId, videoNumber)
        || text(row, "slotDigest", "slot_digest") !== expectedSlotDigest
        || seen.has(currentSlotKey)) {
        throw new HeyGenRosterError("ROSTER_UNAVAILABLE");
      }
      seen.add(currentSlotKey);
      const memberVideos = memberCounts.get(memberId) ?? new Set<number>();
      memberVideos.add(videoNumber);
      memberCounts.set(memberId, memberVideos);
      return {
        slotId: currentSlotKey, planId: planKey, rosterId: roster.rosterId, memberId,
        creatorName: member.name, videoNumber, status: "not_queued" as const,
        blockers: [...HEYGEN_ROSTER_DAILY_PLAN_BLOCKERS],
      };
    }).sort((left, right) => (memberOrder.get(left.memberId)! - memberOrder.get(right.memberId)!)
      || left.videoNumber - right.videoNumber);
    if (memberCounts.size !== roster.members.length
      || [...memberCounts.values()].some((videos) => videos.size !== HEYGEN_ROSTER_VIDEOS_PER_AVATAR)) {
      throw new HeyGenRosterError("ROSTER_UNAVAILABLE");
    }
    return heyGenRosterDailyPlanSchema.parse({
      planId: planKey, rosterId: roster.rosterId, planDate, timeZone,
      status: "blocked_before_generation", avatarCount: roster.members.length,
      videosPerAvatar: HEYGEN_ROSTER_VIDEOS_PER_AVATAR, plannedVideoCount: plannedSlotCount,
      canGenerate: INITIAL_CREATOR_CANARY_PROFILE.safety.canGenerate,
      noSpendGuarantee: INITIAL_CREATOR_CANARY_PROFILE.safety.noSpend, generatedAt: createdAt,
      blockers: [...HEYGEN_ROSTER_DAILY_PLAN_BLOCKERS], slots,
    });
  }

  private requireAccountBinding(
    account: Record<string, unknown>,
    record: HeyGenRosterRecord | undefined,
  ): HeyGenRosterRecord | undefined {
    if (!record) return undefined;
    const accountId = text(account, "id", "id");
    const credentialVersion = number(account, "credentialVersion", "credential_version");
    if (record.providerAccountId !== accountId || record.credentialVersion !== credentialVersion) {
      throw new HeyGenRosterError("ROSTER_UNAVAILABLE");
    }
    return record;
  }

  private async usableAccount(scope: TenantScope): Promise<Record<string, unknown> | undefined> {
    const candidates = rows(await this.db.execute(sql`
      SELECT id, credential_version, configuration
      FROM ${aiMediaProviderAccounts}
      WHERE owner_user_id=${scope.ownerUserId} AND workspace_id=${scope.workspaceId}
        AND provider_key='heygen' AND credential_source='static_api_key' AND credential_version >= 1
        AND ((status='disconnected' AND credential_status='unverified')
          OR (status IN ('active', 'connected') AND credential_status='active'))
      ORDER BY id ASC LIMIT 2
    `));
    if (candidates.length > 1) throw new HeyGenRosterError("ACCOUNT_UNAVAILABLE");
    return candidates[0];
  }
}
