import { createHash, randomUUID } from "node:crypto";
import { sql, type SQL } from "drizzle-orm";
import {
  aiMediaInfluencers,
  aiMediaProviderAccounts,
  aiMediaProviderResources,
} from "../../../shared/models/ai-media-studio-db";
import {
  createHeyGenRosterMemberSchema,
  createHeyGenRosterRequestSchema,
} from "../../../shared/ai-media-studio-heygen-roster";
import type { TenantScope } from "../core/resource-domain";
import {
  HeyGenRosterError,
  type ConfigureHeyGenRosterRecord,
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
    || members.length < 5 || members.length > 10 || members.some((member) => !member)) return undefined;
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

function resourceMetadata(member: HeyGenRosterNativeMember, rosterId: string, kind: "avatar" | "voice"): Record<string, unknown> {
  if (kind === "voice") return { source: "heygen_roster" };
  return {
    language: member.language,
    accent: member.accent,
    gender: member.gender,
    source: "heygen_roster",
    rosterId,
    memberId: member.memberId,
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
}): Promise<string> {
  const { tx, scope, providerAccountId, rosterId, member, kind, externalId } = input;
  const displayName = kind === "avatar" ? member.name : "HeyGen voice";
  const metadata = resourceMetadata(member, rosterId, kind);
  const existing = rows(await tx.execute(sql`
    UPDATE ${aiMediaProviderResources}
    SET display_name=${displayName}, status='active', metadata=COALESCE(metadata, '{}'::jsonb) || ${JSON.stringify(metadata)}::jsonb,
        synchronized_at=clock_timestamp(), updated_at=clock_timestamp()
    WHERE owner_user_id=${scope.ownerUserId} AND workspace_id=${scope.workspaceId}
      AND provider_account_id=${providerAccountId} AND provider_key='heygen'
      AND resource_type=${kind} AND external_resource_id=${externalId}
    RETURNING id
  `))[0];
  if (existing) return text(existing, "id", "id");

  const id = randomUUID();
  const canonicalKey = opaqueResourceKey(kind, kind === "voice" ? externalId : member.memberId);
  const inserted = rows(await tx.execute(sql`
    INSERT INTO ${aiMediaProviderResources} (
      id, owner_user_id, workspace_id, provider_account_id, provider_key, resource_type,
      canonical_key, external_resource_id, display_name, status, metadata, synchronized_at, created_at, updated_at
    ) VALUES (
      ${id}, ${scope.ownerUserId}, ${scope.workspaceId}, ${providerAccountId}, 'heygen', ${kind},
      ${canonicalKey}, ${externalId}, ${displayName}, 'active', ${JSON.stringify(metadata)}::jsonb,
      clock_timestamp(), clock_timestamp(), clock_timestamp()
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
}): Promise<void> {
  const { tx, scope, rosterId, member, avatarResourceId, voiceResourceId } = input;
  const influencerId = randomUUID();
  const slug = `heygen-${member.memberId.slice("member_".length)}`;
  const persona = { source: "heygen_roster", rosterId, memberId: member.memberId };
  const inserted = rows(await tx.execute(sql`
    INSERT INTO ${aiMediaInfluencers} (
      id, owner_user_id, workspace_id, name, slug, status, accent, language, gender,
      age_range, personality, tone, speaking_style, categories, intro, outro, energy_level,
      facial_expressions, brand_colors, persona, default_voice_resource_id, default_avatar_resource_id,
      created_at, updated_at
    ) VALUES (
      ${influencerId}, ${scope.ownerUserId}, ${scope.workspaceId}, ${member.name}, ${slug}, 'draft',
      ${member.accent}, ${member.language}, ${member.gender}, '{"minimum":18,"maximum":65}'::jsonb,
      '[]'::jsonb, '[]'::jsonb, 'natural', '[]'::jsonb, '', '', 5, '[]'::jsonb, '[]'::jsonb,
      ${JSON.stringify(persona)}::jsonb, ${voiceResourceId}, ${avatarResourceId}, clock_timestamp(), clock_timestamp()
    ) ON CONFLICT (owner_user_id, workspace_id, slug) DO NOTHING RETURNING id
  `))[0];
  if (inserted) return;

  const existing = rows(await tx.execute(sql`
    SELECT id, persona FROM ${aiMediaInfluencers}
    WHERE owner_user_id=${scope.ownerUserId} AND workspace_id=${scope.workspaceId} AND slug=${slug}
    FOR UPDATE
  `))[0];
  const existingPersona = object(existing?.persona);
  if (!existing || existingPersona?.source !== "heygen_roster"
    || existingPersona.rosterId !== rosterId || existingPersona.memberId !== member.memberId) {
    throw new HeyGenRosterError("ROSTER_UNAVAILABLE");
  }
  const updated = rows(await tx.execute(sql`
    UPDATE ${aiMediaInfluencers}
    SET name=${member.name}, status='draft', accent=${member.accent}, language=${member.language}, gender=${member.gender},
        persona=${JSON.stringify(persona)}::jsonb, default_voice_resource_id=${voiceResourceId},
        default_avatar_resource_id=${avatarResourceId}, archived_at=NULL, updated_at=clock_timestamp()
    WHERE id=${text(existing, "id", "id")} AND owner_user_id=${scope.ownerUserId}
      AND workspace_id=${scope.workspaceId} AND slug=${slug}
    RETURNING id
  `))[0];
  if (!updated) throw new HeyGenRosterError("ROSTER_UNAVAILABLE");
}

/** Resolves exactly one usable HeyGen account without selecting configuration or secret material. */
export function createDrizzleHeyGenRosterAccountResolver(db: HeyGenRosterExecutor): HeyGenRosterAccountResolver {
  return {
    async resolve(scope: TenantScope): Promise<HeyGenResolvedAccountContext | undefined> {
      const result = rows(await db.execute(sql`
        SELECT id, credential_version
        FROM ${aiMediaProviderAccounts}
        WHERE owner_user_id=${scope.ownerUserId} AND workspace_id=${scope.workspaceId}
          AND provider_key='heygen' AND status IN ('active', 'connected')
          AND credential_status='active' AND credential_version >= 1
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

  async configure(input: ConfigureHeyGenRosterRecord): Promise<HeyGenRosterRecord> {
    return this.db.transaction(async (tx) => {
      const account = rows(await tx.execute(sql`
        SELECT id, credential_version, configuration
        FROM ${aiMediaProviderAccounts}
        WHERE id=${input.providerAccountId} AND owner_user_id=${input.scope.ownerUserId}
          AND workspace_id=${input.scope.workspaceId} AND provider_key='heygen'
          AND status IN ('active', 'connected') AND credential_status='active'
          AND credential_version=${input.credentialVersion}
        FOR UPDATE
      `))[0];
      if (!account) throw new HeyGenRosterError("ACCOUNT_UNAVAILABLE");
      const parsed = parseNamespace(account.configuration, input.scope);
      const replay = parsed.records.get(input.rosterId);
      if (replay) {
        if (!sameReplay(replay, input)) throw new HeyGenRosterError("IDEMPOTENCY_CONFLICT");
        return replay;
      }
      if (parsed.records.size >= MAX_DURABLE_ROSTERS_PER_ACCOUNT) {
        throw new HeyGenRosterError("ROSTER_UNAVAILABLE");
      }

      for (const member of input.members) {
        const avatarResourceId = await upsertResource({
          tx, scope: input.scope, providerAccountId: input.providerAccountId,
          rosterId: input.rosterId, member, kind: "avatar", externalId: member.avatarId,
        });
        const voiceResourceId = await upsertResource({
          tx, scope: input.scope, providerAccountId: input.providerAccountId,
          rosterId: input.rosterId, member, kind: "voice", externalId: member.voiceId,
        });
        await createInfluencer({
          tx, scope: input.scope, rosterId: input.rosterId, member,
          avatarResourceId, voiceResourceId,
        });
      }

      const nextNamespace: StoredRosterNamespace = {
        version: 1,
        activeRosterId: input.rosterId,
        rosters: {
          ...Object.fromEntries([...parsed.records].map(([key, value]) => [key, stored(value)])),
          [input.rosterId]: stored(input),
        },
      };
      const updated = rows(await tx.execute(sql`
        UPDATE ${aiMediaProviderAccounts}
        SET configuration=jsonb_set(COALESCE(configuration, '{}'::jsonb), ARRAY[${CONFIGURATION_KEY}]::text[],
          ${JSON.stringify(nextNamespace)}::jsonb, true), updated_at=clock_timestamp()
        WHERE id=${input.providerAccountId} AND owner_user_id=${input.scope.ownerUserId}
          AND workspace_id=${input.scope.workspaceId} AND provider_key='heygen'
          AND status IN ('active', 'connected') AND credential_status='active'
          AND credential_version=${input.credentialVersion}
        RETURNING id
      `))[0];
      if (!updated) throw new HeyGenRosterError("ACCOUNT_UNAVAILABLE");
      return { ...input, scope: { ...input.scope }, members: input.members.map((member) => ({ ...member })) };
    });
  }

  async get(scope: TenantScope, rosterId: string): Promise<HeyGenRosterRecord | undefined> {
    const account = await this.activeAccount(scope);
    if (!account) return undefined;
    const record = parseNamespace(account.configuration, scope).records.get(rosterId);
    return this.requireAccountBinding(account, record);
  }

  async getCurrent(scope: TenantScope): Promise<HeyGenRosterRecord | undefined> {
    const account = await this.activeAccount(scope);
    if (!account) return undefined;
    const parsed = parseNamespace(account.configuration, scope);
    const record = parsed.namespace ? parsed.records.get(parsed.namespace.activeRosterId) : undefined;
    return this.requireAccountBinding(account, record);
  }

  private requireAccountBinding(
    account: Record<string, unknown>,
    record: HeyGenRosterRecord | undefined,
  ): HeyGenRosterRecord | undefined {
    if (!record) return undefined;
    const accountId = text(account, "id", "id");
    const credentialVersion = number(account, "credentialVersion", "credential_version");
    if (record.providerAccountId !== accountId || record.credentialVersion > credentialVersion) {
      throw new HeyGenRosterError("ROSTER_UNAVAILABLE");
    }
    return record;
  }

  private async activeAccount(scope: TenantScope): Promise<Record<string, unknown> | undefined> {
    const candidates = rows(await this.db.execute(sql`
      SELECT id, credential_version, configuration
      FROM ${aiMediaProviderAccounts}
      WHERE owner_user_id=${scope.ownerUserId} AND workspace_id=${scope.workspaceId}
        AND provider_key='heygen' AND status IN ('active', 'connected')
        AND credential_status='active' AND credential_version >= 1
      ORDER BY id ASC LIMIT 2
    `));
    if (candidates.length > 1) throw new HeyGenRosterError("ACCOUNT_UNAVAILABLE");
    return candidates[0];
  }
}
