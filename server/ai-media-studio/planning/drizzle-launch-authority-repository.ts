import { createHash } from "node:crypto";
import { sql, type SQL } from "drizzle-orm";
import {
  aiMediaAdmissionPolicyRevisions,
  aiMediaBudgetReservations,
  aiMediaDailyPlans,
  aiMediaDailyPlanSlots,
  aiMediaGovernanceProfiles,
  aiMediaInfluencers,
  aiMediaKillSwitchRevisions,
  aiMediaLaunchIntents,
  aiMediaLaunchAuthoritySnapshots,
  aiMediaLaunchEvidence,
  aiMediaProviderAccounts,
  aiMediaProviderResources,
  aiMediaScripts,
  aiMediaScriptVariants,
  aiMediaSourceItems,
} from "../../../shared/models/ai-media-studio-db";
import type { TenantScope } from "../core/resource-domain";
import {
  type AuthorizedLaunchAuthorityWrite,
  type CreateLaunchAuthoritySnapshotCommand,
  type DeclareLaunchIntentCommand,
  type LaunchAuthorityCapability,
  type LaunchAuthorityReceipt,
  type LaunchAuthorityRepository,
  type LaunchAuthoritySnapshotReceipt,
  type LaunchAuthorityValidityPolicy,
  type LaunchRuntimeAttestationVerifier,
  type RecordContentApprovalCommand,
  type RecordHumanLaunchApprovalCommand,
  type RecordMaximumQuoteAttestationCommand,
  type RecordSandboxAttestationCommand,
  type ReviseLaunchAdmissionPolicyCommand,
  type ReviseLaunchKillSwitchCommand,
  type TrustedLaunchAuthorityPrincipal,
  type TrustedLaunchSubject,
} from "./launch-authority-contracts";
import {
  lockAuthorityIdempotency,
  lockAuthorityWorkspace,
  lockGovernanceProfile,
} from "./authority-locks";
import { launchAuthorityInputDigest } from "./launch-authority-service";
import {
  verifiedProductionBatchApprovalBinding,
  type ApprovedProductionBatchSlotFacts,
} from "../production-batches/metadata-integrity";

type ExecuteResult = { rows?: unknown[] } | unknown[];
export type LaunchAuthorityDatabase = { execute(query: SQL): Promise<ExecuteResult> };
export type LaunchAuthorityTransactionalDatabase = LaunchAuthorityDatabase & {
  transaction<T>(callback: (tx: LaunchAuthorityDatabase) => Promise<T>): Promise<T>;
};

type Row = Record<string, unknown>;
type Digest = `sha256:${string}`;
type EvidenceKind = "content_approval" | "human_launch_approval" | "sandbox_proof" | "maximum_quote";
type AnyAuthorityCommand = ReviseLaunchAdmissionPolicyCommand | ReviseLaunchKillSwitchCommand
  | RecordContentApprovalCommand | RecordHumanLaunchApprovalCommand | DeclareLaunchIntentCommand | RecordSandboxAttestationCommand
  | RecordMaximumQuoteAttestationCommand | CreateLaunchAuthoritySnapshotCommand;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const SHA256 = /^sha256:[0-9a-f]{64}$/u;
const RAW_SHA256 = /^[0-9a-f]{64}$/u;
const SAFE = /^[A-Za-z0-9][A-Za-z0-9._:/-]*$/u;
const COUNTRY = /^[A-Z]{2}$/u;
const LANGUAGE = /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8}){0,3}$/u;
const MAX_MICRO_USD = 9_000_000_000_000_000n;

const OPERATION_CAPABILITY = {
  revise_policy: "policy:revise",
  revise_kill_switch: "kill_switch:revise",
  record_content_approval: "content:decide",
  record_human_launch_approval: "human_launch:decide",
  declare_launch_intent: "launch_intent:declare",
  record_sandbox_attestation: "sandbox:attest",
  record_maximum_quote_attestation: "quote:attest",
  create_authority_snapshot: "snapshot:create",
} as const satisfies Record<string, LaunchAuthorityCapability>;

const OPERATION_PRINCIPAL_KINDS = {
  revise_policy: ["user"],
  revise_kill_switch: ["user"],
  record_content_approval: ["user", "workload"],
  record_human_launch_approval: ["user"],
  declare_launch_intent: ["user"],
  record_sandbox_attestation: ["workload"],
  record_maximum_quote_attestation: ["workload"],
  create_authority_snapshot: ["workload"],
} as const;

type AuthorityOperation = keyof typeof OPERATION_CAPABILITY;

export type LaunchAuthorityPersistenceErrorCode =
  | "AUTHORITY_DENIED"
  | "IDEMPOTENCY_CONFLICT"
  | "INVARIANT_VIOLATION"
  | "INVALID_INPUT";

export class LaunchAuthorityPersistenceError extends Error {
  constructor(readonly code: LaunchAuthorityPersistenceErrorCode, message: string) {
    super(message);
    this.name = "LaunchAuthorityPersistenceError";
  }
}

function rows(result: ExecuteResult): Row[] {
  const resultRows = Array.isArray(result) ? result : result.rows;
  return Array.isArray(resultRows) ? resultRows as Row[] : [];
}

function value(row: Row, camel: string, snake: string): unknown {
  return row[camel] ?? row[snake];
}

function canonicalJson(input: unknown): unknown {
  if (Array.isArray(input)) return input.map(canonicalJson);
  if (input && typeof input === "object") {
    return Object.fromEntries(Object.entries(input as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, canonicalJson(entry)]));
  }
  return input;
}

function digest(input: unknown): Digest {
  return `sha256:${createHash("sha256").update(JSON.stringify(canonicalJson(input))).digest("hex")}`;
}

function assertAuthorized(
  operation: AuthorityOperation,
  input: AuthorizedLaunchAuthorityWrite<AnyAuthorityCommand>,
): void {
  validScope(input.command.scope);
  safe(input.command.idempotencyKey, "idempotencyKey", 200, 8);
  safe(input.principal.subjectId, "principal.subjectId", 200);
  if (!input.principal.capabilities.includes(OPERATION_CAPABILITY[operation])) throw denied();
  if (!(OPERATION_PRINCIPAL_KINDS[operation] as readonly string[]).includes(input.principal.kind)) throw denied();
  const expected = launchAuthorityInputDigest(operation, input.command, input.principal);
  if (!SHA256.test(input.inputDigest) || input.inputDigest !== expected) {
    throw invalid("inputDigest does not bind the exact authenticated authority command");
  }
  if (input.principal.authenticationEvidenceDigest !== undefined) {
    validDigest(input.principal.authenticationEvidenceDigest, "authenticationEvidenceDigest");
  }
}

function receipt(row: Row, kind: LaunchAuthorityReceipt["kind"], replayed: boolean): LaunchAuthorityReceipt {
  return {
    id: uuid(String(row.id), "authority.id"), kind,
    inputDigest: validDigest(String(value(row, "inputDigest", "input_digest")), "authority.inputDigest"),
    replayed,
  };
}

function snapshotReceipt(row: Row, replayed: boolean): LaunchAuthoritySnapshotReceipt {
  return {
    ...receipt(row, "authority_snapshot", replayed), kind: "authority_snapshot",
    authorityDigest: validDigest(String(value(row, "authorityDigest", "authority_digest")), "authority.authorityDigest"),
    admissionDigest: validDigest(String(value(row, "admissionDigest", "admission_digest")), "authority.admissionDigest"),
  };
}

function assertReplay(row: Row, inputDigest: Digest): void {
  if (String(value(row, "inputDigest", "input_digest")) !== inputDigest) {
    throw conflict("Idempotency key is already bound to another authority command");
  }
}

function databaseNow(row: Row): Date {
  const raw = value(row, "databaseNow", "database_now");
  const result = raw instanceof Date ? raw : new Date(String(raw));
  if (Number.isNaN(result.getTime())) throw invariant("Database clock returned an invalid instant");
  return result;
}

function normalizedStrings(values: readonly string[], field: string, itemPattern: RegExp, maxItemLength: number): string[] {
  if (!Array.isArray(values) || values.length > 250) throw invalid(`${field} is invalid`);
  const normalized = [...new Set(values.map((entry) => {
    if (typeof entry !== "string" || entry.length < 1 || entry.length > maxItemLength || !itemPattern.test(entry)) {
      throw invalid(`${field} is invalid`);
    }
    return entry;
  }))].sort();
  if (normalized.length !== values.length) throw invalid(`${field} must be unique and canonically sorted`);
  return normalized;
}

function microUsd(input: string, allowZero: boolean): string {
  if (typeof input !== "string" || !/^(?:0|[1-9]\d*)$/u.test(input)) throw invalid("micro-USD amount is invalid");
  const parsed = BigInt(input);
  if ((!allowZero && parsed === 0n) || parsed > MAX_MICRO_USD) throw invalid("micro-USD amount is invalid");
  return input;
}

function ttlSeconds(policy: LaunchAuthorityValidityPolicy, kind: Parameters<LaunchAuthorityValidityPolicy["ttlSeconds"]>[0]["kind"], scope: TenantScope): number {
  const value = policy.ttlSeconds({ kind, scope });
  if (!Number.isSafeInteger(value) || value < 1 || value > 86_400) throw invalid("Authority validity policy returned an unsafe TTL");
  return value;
}

function expiryFrom(now: Date, seconds: number): Date {
  const expiry = new Date(now.getTime() + seconds * 1000);
  if (Number.isNaN(expiry.getTime()) || expiry <= now) throw invariant("Authority expiry could not be derived");
  return expiry;
}

export interface DrizzleLaunchAuthorityRepositoryOptions {
  runtimeAttestationVerifier: LaunchRuntimeAttestationVerifier;
  validityPolicy: LaunchAuthorityValidityPolicy;
}

/**
 * PR21 authority issuer. It appends only immutable authority rows and never
 * creates render work, provider commands, outbox messages, or external I/O.
 */
export class DrizzleLaunchAuthorityRepository implements LaunchAuthorityRepository {
  constructor(
    private readonly db: LaunchAuthorityTransactionalDatabase,
    private readonly options: DrizzleLaunchAuthorityRepositoryOptions,
  ) {}

  async revisePolicy(
    input: AuthorizedLaunchAuthorityWrite<ReviseLaunchAdmissionPolicyCommand>,
  ): Promise<LaunchAuthorityReceipt> {
    assertAuthorized("revise_policy", input);
    const { command, principal } = input;
    const dailyBudgetMicroUsd = microUsd(command.dailyBudgetMicroUsd, command.state === "disabled");
    const total = positiveInteger(command.totalConcurrency, "totalConcurrency", command.state === "disabled");
    const provider = positiveInteger(command.providerConcurrency, "providerConcurrency", command.state === "disabled");
    const tenant = positiveInteger(command.tenantConcurrency, "tenantConcurrency", command.state === "disabled");
    if (provider > total || tenant > total || (command.state === "active" && (dailyBudgetMicroUsd === "0"
      || total === 0 || provider === 0 || tenant === 0))) throw invalid("Active policy limits are invalid");
    const languages = normalizedStrings(command.allowedLanguages, "allowedLanguages", LANGUAGE, 80);
    const countries = normalizedStrings(command.allowedCountries, "allowedCountries", COUNTRY, 2);
    const timeZones = normalizedStrings(command.allowedTimeZones, "allowedTimeZones", /^[A-Za-z0-9_+\-/]+$/u, 80);
    for (const zone of timeZones) validTimeZone(zone);

    return this.db.transaction(async (tx) => {
      await lockAuthorityIdempotency(tx, command.scope, "policy", command.idempotencyKey);
      const replay = await this.byIdempotency(tx, aiMediaAdmissionPolicyRevisions, command.scope, command.idempotencyKey);
      if (replay) { assertReplay(replay, input.inputDigest); return receipt(replay, "policy", true); }
      await lockAuthorityWorkspace(tx, command.scope);
      const identity = await this.identity(tx);
      const { id, now } = identity;
      const previous = rows(await tx.execute(sql`
        SELECT * FROM ${aiMediaAdmissionPolicyRevisions}
        WHERE owner_user_id=${command.scope.ownerUserId} AND workspace_id=${command.scope.workspaceId}
        ORDER BY revision DESC LIMIT 1 FOR UPDATE
      `))[0];
      const revision = previous ? positiveInteger(Number(previous.revision), "previous.revision") + 1 : 1;
      const previousRevisionId = previous ? uuid(String(previous.id), "previous.id") : null;
      const previousRevision = previous ? revision - 1 : null;
      const policyDigest = digest({ domain: "ai-media-admission-policy-v1", id, scope: command.scope, revision,
        previousRevisionId, previousRevision, state: command.state, dailyBudgetMicroUsd,
        totalConcurrency: total, providerConcurrency: provider, tenantConcurrency: tenant,
        allowedLanguages: languages, allowedCountries: countries, allowedTimeZones: timeZones,
        validFrom: now.toISOString(), expiresAt: null });
      const evidenceDigest = digest({ domain: "ai-media-authenticated-policy-evidence-v1", policyDigest,
        actor: { kind: principal.kind, subjectId: principal.subjectId },
        authenticationEvidenceDigest: principal.authenticationEvidenceDigest ?? null });
      const inserted = rows(await tx.execute(sql`
        INSERT INTO ${aiMediaAdmissionPolicyRevisions}
          (id,owner_user_id,workspace_id,revision,previous_revision_id,previous_revision,
           daily_budget_micro_usd,total_concurrency,provider_concurrency,tenant_concurrency,
           allowed_languages,allowed_countries,allowed_time_zones,state,valid_from,expires_at,
           policy_digest,evidence_digest,actor_user_id,idempotency_key,input_digest,created_at)
        VALUES (${id},${command.scope.ownerUserId},${command.scope.workspaceId},${revision},${previousRevisionId},
          ${previousRevision},${dailyBudgetMicroUsd}::numeric,${total},${provider},${tenant},
          ${JSON.stringify(languages)}::jsonb,${JSON.stringify(countries)}::jsonb,${JSON.stringify(timeZones)}::jsonb,
          ${command.state},${now},NULL,${policyDigest},${evidenceDigest},${principal.subjectId},
          ${command.idempotencyKey},${input.inputDigest},${now})
        ON CONFLICT (owner_user_id,workspace_id,idempotency_key) DO NOTHING RETURNING *
      `))[0];
      if (inserted) return receipt(inserted, "policy", false);
      return this.racedReceipt(tx, aiMediaAdmissionPolicyRevisions, command.scope, command.idempotencyKey,
        input.inputDigest, "policy");
    });
  }

  async reviseKillSwitch(
    input: AuthorizedLaunchAuthorityWrite<ReviseLaunchKillSwitchCommand>,
  ): Promise<LaunchAuthorityReceipt> {
    assertAuthorized("revise_kill_switch", input);
    const { command, principal } = input;
    const reason = display(command.reason, "reason", 500);
    return this.db.transaction(async (tx) => {
      await lockAuthorityIdempotency(tx, command.scope, "kill-switch", command.idempotencyKey);
      const replay = await this.byIdempotency(tx, aiMediaKillSwitchRevisions, command.scope, command.idempotencyKey);
      if (replay) { assertReplay(replay, input.inputDigest); return receipt(replay, "kill_switch", true); }
      await lockAuthorityWorkspace(tx, command.scope);
      const identity = await this.identity(tx);
      const { id, now } = identity;
      const previous = rows(await tx.execute(sql`
        SELECT * FROM ${aiMediaKillSwitchRevisions}
        WHERE owner_user_id=${command.scope.ownerUserId} AND workspace_id=${command.scope.workspaceId}
        ORDER BY revision DESC LIMIT 1 FOR UPDATE
      `))[0];
      const revision = previous ? positiveInteger(Number(previous.revision), "previous.revision") + 1 : 1;
      const previousRevisionId = previous ? uuid(String(previous.id), "previous.id") : null;
      const previousRevision = previous ? revision - 1 : null;
      const evidenceDigest = digest({ domain: "ai-media-kill-switch-evidence-v1", id, scope: command.scope,
        revision, previousRevisionId, previousRevision, active: command.active, reason,
        validFrom: now.toISOString(), expiresAt: null,
        actor: { kind: principal.kind, subjectId: principal.subjectId },
        authenticationEvidenceDigest: principal.authenticationEvidenceDigest ?? null });
      const inserted = rows(await tx.execute(sql`
        INSERT INTO ${aiMediaKillSwitchRevisions}
          (id,owner_user_id,workspace_id,revision,previous_revision_id,previous_revision,active,
           valid_from,expires_at,reason,evidence_digest,input_digest,actor_user_id,idempotency_key,created_at)
        VALUES (${id},${command.scope.ownerUserId},${command.scope.workspaceId},${revision},${previousRevisionId},
          ${previousRevision},${command.active},${now},NULL,${reason},${evidenceDigest},${input.inputDigest},
          ${principal.subjectId},${command.idempotencyKey},${now})
        ON CONFLICT (owner_user_id,workspace_id,idempotency_key) DO NOTHING RETURNING *
      `))[0];
      if (inserted) return receipt(inserted, "kill_switch", false);
      return this.racedReceipt(tx, aiMediaKillSwitchRevisions, command.scope, command.idempotencyKey,
        input.inputDigest, "kill_switch");
    });
  }

  async recordContentApproval(input: AuthorizedLaunchAuthorityWrite<RecordContentApprovalCommand>) {
    assertAuthorized("record_content_approval", input);
    const sourceKind = input.principal.kind === "user" ? "authenticated_human" : "authenticated_workload";
    return this.appendEvidence(input, "content_approval", input.command.decision, sourceKind,
      null, null, null, null);
  }

  async recordHumanLaunchApproval(input: AuthorizedLaunchAuthorityWrite<RecordHumanLaunchApprovalCommand>) {
    assertAuthorized("record_human_launch_approval", input);
    return this.appendEvidence(input, "human_launch_approval", input.command.decision, "authenticated_human",
      null, null, null, null);
  }

  async declareLaunchIntent(input: AuthorizedLaunchAuthorityWrite<DeclareLaunchIntentCommand>) {
    assertAuthorized("declare_launch_intent", input);
    const { command, principal } = input;
    validSlotCommand(command);
    const governanceUse = safe(command.governanceUse, "governanceUse", 80);
    const governanceTerritory = safe(command.governanceTerritory, "governanceTerritory", 80);
    if (!COUNTRY.test(command.contentCountry)) throw invalid("contentCountry is invalid");
    return this.db.transaction(async (tx) => {
      await lockAuthorityIdempotency(tx, command.scope, "launch-intent", command.idempotencyKey);
      const replay = await this.byIdempotency(tx, aiMediaLaunchIntents, command.scope, command.idempotencyKey);
      if (replay) { assertReplay(replay, input.inputDigest); return receipt(replay, "launch_intent", true); }
      await lockAuthorityWorkspace(tx, command.scope);
      const existingIntent = rows(await tx.execute(sql`SELECT id FROM ${aiMediaLaunchIntents}
        WHERE owner_user_id=${command.scope.ownerUserId} AND workspace_id=${command.scope.workspaceId}
          AND daily_plan_slot_id=${command.dailyPlanSlotId} AND slot_attempt=${command.slotAttempt}
        LIMIT 2 FOR UPDATE`));
      if (existingIntent.length !== 0) throw denied();
      const slotRows = rows(await tx.execute(sql`
        SELECT influencer_id FROM ${aiMediaDailyPlanSlots}
        WHERE owner_user_id=${command.scope.ownerUserId} AND workspace_id=${command.scope.workspaceId}
          AND id=${command.dailyPlanSlotId} LIMIT 2
      `));
      if (slotRows.length !== 1) throw denied();
      const influencerId = uuid(String(value(slotRows[0], "influencerId", "influencer_id")), "influencerId");
      await lockGovernanceProfile(tx, command.scope, influencerId);
      const { id, now } = await this.identity(tx);
      const facts = rows(await tx.execute(sql`
        SELECT plans.id AS daily_plan_id,plans.public_plan_key,plans.status AS plan_status,
          plans.planned_slot_count,
          plans.plan_digest,plans.source_roster_key,plans.source_roster_digest,
          slots.id AS daily_plan_slot_id,slots.public_slot_key,slots.status AS slot_status,
          slots.slot_digest,slots.source_member_key,slots.provider_account_id,
          slots.provider_key,slots.provider_credential_version,selected.id AS script_variant_id,
          selected.checksum AS script_variant_checksum,scripts.id AS script_id,scripts.source_type,
          scripts.title AS script_title,scripts.status AS script_status,scripts.current_variant_id,
          scripts.metadata AS script_metadata,scripts.source_item_id,
          selected.id AS selected_variant_id,selected.version AS selected_variant_version,
          selected.label AS selected_variant_label,selected.content AS selected_variant_content,
          selected.status AS selected_variant_status,selected.checksum AS selected_variant_checksum,
          selected.metadata AS selected_variant_metadata,
          variants.id AS variant_id,variants.version AS variant_version,variants.label AS variant_label,
          variants.content AS variant_content,variants.status AS variant_status,
          variants.checksum AS variant_checksum,variants.metadata AS variant_metadata,
          sources.content_hash AS source_content_hash,
          governance.id AS governance_profile_id,governance.evidence_digest AS governance_evidence_digest
        FROM ${aiMediaDailyPlans} plans
        INNER JOIN ${aiMediaDailyPlanSlots} slots ON slots.owner_user_id=plans.owner_user_id
          AND slots.workspace_id=plans.workspace_id AND slots.daily_plan_id=plans.id
          AND slots.provider_account_id=plans.provider_account_id AND slots.provider_key=plans.provider_key
          AND slots.provider_credential_version=plans.provider_credential_version
        INNER JOIN ${aiMediaProviderAccounts} accounts ON accounts.owner_user_id=slots.owner_user_id
          AND accounts.workspace_id=slots.workspace_id AND accounts.id=slots.provider_account_id
          AND accounts.provider_key=slots.provider_key
        INNER JOIN ${aiMediaInfluencers} influencers ON influencers.owner_user_id=slots.owner_user_id
          AND influencers.workspace_id=slots.workspace_id AND influencers.id=slots.influencer_id
        INNER JOIN ${aiMediaProviderResources} avatars ON avatars.owner_user_id=slots.owner_user_id
          AND avatars.workspace_id=slots.workspace_id AND avatars.id=slots.avatar_resource_id
          AND avatars.provider_account_id=slots.provider_account_id AND avatars.provider_key=slots.provider_key
          AND avatars.resource_type='avatar'
        INNER JOIN ${aiMediaProviderResources} voices ON voices.owner_user_id=slots.owner_user_id
          AND voices.workspace_id=slots.workspace_id AND voices.id=slots.voice_resource_id
          AND voices.provider_account_id=slots.provider_account_id AND voices.provider_key=slots.provider_key
          AND voices.resource_type='voice'
        INNER JOIN ${aiMediaScriptVariants} selected ON selected.owner_user_id=slots.owner_user_id
          AND selected.workspace_id=slots.workspace_id AND selected.id=slots.script_variant_id
        INNER JOIN ${aiMediaScripts} scripts ON scripts.owner_user_id=selected.owner_user_id
          AND scripts.workspace_id=selected.workspace_id AND scripts.id=selected.script_id
          AND scripts.influencer_id=slots.influencer_id AND scripts.current_variant_id=selected.id
        INNER JOIN ${aiMediaScriptVariants} variants ON variants.owner_user_id=scripts.owner_user_id
          AND variants.workspace_id=scripts.workspace_id AND variants.script_id=scripts.id
        LEFT JOIN ${aiMediaSourceItems} sources ON sources.owner_user_id=scripts.owner_user_id
          AND sources.workspace_id=scripts.workspace_id AND sources.id=scripts.source_item_id
          AND sources.source_type=scripts.source_type
        INNER JOIN ${aiMediaGovernanceProfiles} governance ON governance.owner_user_id=slots.owner_user_id
          AND governance.workspace_id=slots.workspace_id AND governance.influencer_id=slots.influencer_id
        WHERE plans.owner_user_id=${command.scope.ownerUserId} AND plans.workspace_id=${command.scope.workspaceId}
          AND slots.id=${command.dailyPlanSlotId} AND plans.status='planned' AND slots.status='planned'
          AND plans.plan_date=(${now} AT TIME ZONE plans.accounting_time_zone)::date
          AND selected.status='approved' AND selected.checksum IS NOT NULL AND scripts.status='approved'
          AND ((scripts.source_type='manual' AND scripts.source_item_id IS NULL)
            OR (scripts.source_type<>'manual' AND sources.id IS NOT NULL AND sources.content_hash IS NOT NULL
              AND sources.status IN ('accepted','ready') AND sources.moderation_status='approved'
              AND sources.rights_status IN ('owned','licensed')))
          AND accounts.credential_version=slots.provider_credential_version
          AND accounts.status IN ('active','connected') AND accounts.credential_status='active'
          AND (accounts.credential_expires_at IS NULL OR accounts.credential_expires_at>${now})
          AND influencers.status='active' AND influencers.archived_at IS NULL
          AND avatars.status='active' AND voices.status='active'
          AND governance.state='active' AND governance.revoked_at IS NULL
          AND governance.valid_from<=${now} AND governance.expires_at>${now}
          AND governance.allowed_uses @> jsonb_build_array(${governanceUse}::text)
          AND (governance.territories @> jsonb_build_array(${governanceTerritory}::text)
            OR governance.territories @> '["WORLDWIDE"]'::jsonb)
          AND NOT EXISTS (SELECT 1 FROM ${aiMediaGovernanceProfiles} newer
            WHERE newer.owner_user_id=governance.owner_user_id AND newer.workspace_id=governance.workspace_id
              AND newer.influencer_id=governance.influencer_id AND newer.version>governance.version)
          AND ${command.slotAttempt}=COALESCE((SELECT MAX(previous.attempt)+1 FROM ${aiMediaBudgetReservations} previous
            WHERE previous.owner_user_id=slots.owner_user_id AND previous.workspace_id=slots.workspace_id
              AND previous.daily_plan_slot_id=slots.id),1)
        ORDER BY variants.version
        FOR UPDATE OF plans,slots,accounts,influencers,avatars,voices,selected,variants,scripts,governance
      `));
      if (facts.length < 1 || facts.length > 5) throw denied();
      const row = facts[0]!;
      const planSlots = await this.lockProductionPlanShape(tx, command.scope, row);
      const lockedSource = await this.lockProductionBatchSource(tx, command.scope, row);
      if (!this.productionBatchIntegrityIsCurrent(command.scope, now, facts, planSlots, lockedSource)) throw denied();
      const base = subjectFromLaunchRow(row, command.scope, command.slotAttempt, governanceUse,
        governanceTerritory, command.contentCountry, id, digest("pending"));
      const launchIntentDigest = digest({ domain: "ai-media-launch-intent-v1", id,
        subject: launchFacts(base), actorUserId: principal.subjectId,
        inputDigest: input.inputDigest, createdAt: now.toISOString() });
      const subjectWithIntent = { ...base, launchIntentDigest };
      const launchSubjectDigest = deriveLaunchSubjectDigest(subjectWithIntent);
      const subject = { ...subjectWithIntent, launchSubjectDigest };
      const inserted = rows(await tx.execute(sql`
        INSERT INTO ${aiMediaLaunchIntents} (id,owner_user_id,workspace_id,daily_plan_id,daily_plan_slot_id,
          slot_attempt,provider_account_id,provider_key,provider_credential_version,plan_digest,slot_digest,
          source_roster_key,source_roster_digest,source_member_key,script_id,script_variant_id,
          script_variant_checksum,source_type,source_item_id,source_content_hash,governance_profile_id,
          governance_evidence_digest,governance_use,governance_territory,content_country,
          launch_subject_digest,launch_intent_digest,actor_user_id,input_digest,idempotency_key,created_at)
        VALUES (${id},${command.scope.ownerUserId},${command.scope.workspaceId},${subject.dailyPlanId},
          ${subject.dailyPlanSlotId},${subject.slotAttempt},${subject.providerAccountId},${subject.providerKey},
          ${subject.providerCredentialVersion},${subject.planDigest},${subject.slotDigest},${subject.sourceRosterKey},
          ${subject.sourceRosterDigest},${subject.sourceMemberKey},${subject.scriptId},${subject.scriptVariantId},
          ${subject.scriptVariantChecksum},${subject.sourceType},${subject.sourceItemId},${subject.sourceContentHash},
          ${subject.governanceProfileId},${subject.governanceEvidenceDigest},${subject.governanceUse},
          ${subject.governanceTerritory},${subject.contentCountry},${subject.launchSubjectDigest},
          ${subject.launchIntentDigest},${principal.subjectId},${input.inputDigest},${command.idempotencyKey},${now})
        ON CONFLICT (owner_user_id,workspace_id,idempotency_key) DO NOTHING RETURNING *
      `))[0];
      if (inserted) return receipt(inserted, "launch_intent", false);
      return this.racedReceipt(tx, aiMediaLaunchIntents, command.scope, command.idempotencyKey,
        input.inputDigest, "launch_intent");
    });
  }

  async recordSandboxAttestation(input: AuthorizedLaunchAuthorityWrite<RecordSandboxAttestationCommand>) {
    assertAuthorized("record_sandbox_attestation", input);
    safe(input.command.attestationHandle, "attestationHandle", 200);
    return this.appendEvidence(input, "sandbox_proof", null, "sandbox_adapter", null, null, null, null);
  }

  async recordMaximumQuoteAttestation(input: AuthorizedLaunchAuthorityWrite<RecordMaximumQuoteAttestationCommand>) {
    assertAuthorized("record_maximum_quote_attestation", input);
    safe(input.command.attestationHandle, "attestationHandle", 200);
    return this.appendEvidence(input, "maximum_quote", null, "provider_quote_adapter", null, null, null, null);
  }

  async createAuthoritySnapshot(
    input: AuthorizedLaunchAuthorityWrite<CreateLaunchAuthoritySnapshotCommand>,
  ): Promise<LaunchAuthoritySnapshotReceipt> {
    assertAuthorized("create_authority_snapshot", input);
    const { command } = input;
    validSlotCommand(command);
    return this.db.transaction(async (tx) => {
      await lockAuthorityIdempotency(tx, command.scope, "authority-snapshot", command.idempotencyKey);
      const replay = await this.byIdempotency(tx, aiMediaLaunchAuthoritySnapshots, command.scope, command.idempotencyKey);
      if (replay) { assertReplay(replay, input.inputDigest); return snapshotReceipt(replay, true); }
      await lockAuthorityWorkspace(tx, command.scope);
      const influencerId = await this.influencerForSlot(tx, command.scope, command.dailyPlanSlotId);
      await lockGovernanceProfile(tx, command.scope, influencerId);
      const identity = await this.identity(tx);
      const { id, now } = identity;
      const subject = await this.lockExactSubject(tx, command, now);

      const policy = rows(await tx.execute(sql`
        SELECT * FROM ${aiMediaAdmissionPolicyRevisions}
        WHERE owner_user_id=${command.scope.ownerUserId} AND workspace_id=${command.scope.workspaceId}
        ORDER BY revision DESC LIMIT 1 FOR UPDATE
      `))[0];
      const kill = rows(await tx.execute(sql`
        SELECT * FROM ${aiMediaKillSwitchRevisions}
        WHERE owner_user_id=${command.scope.ownerUserId} AND workspace_id=${command.scope.workspaceId}
        ORDER BY revision DESC LIMIT 1 FOR UPDATE
      `))[0];
      if (!policy || !kill) throw denied();

      const evidence = new Map<EvidenceKind, Row>();
      for (const kind of ["content_approval", "human_launch_approval", "sandbox_proof", "maximum_quote"] as const) {
        // Deliberately select the newest whole chain before testing the subject.
        // Filtering by subject first could resurrect an older positive revision.
        const current = rows(await tx.execute(sql`
          SELECT * FROM ${aiMediaLaunchEvidence}
          WHERE owner_user_id=${command.scope.ownerUserId} AND workspace_id=${command.scope.workspaceId}
            AND daily_plan_slot_id=${command.dailyPlanSlotId} AND slot_attempt=${command.slotAttempt}
            AND evidence_kind=${kind}
          ORDER BY revision DESC LIMIT 1 FOR UPDATE
        `))[0];
        if (!current) throw denied();
        evidence.set(kind, current);
      }

      assertPolicyAdmits(policy, subject, now);
      assertKillSwitchOpen(kill, now);
      assertEvidenceAdmits(evidence, subject, now);
      const quote = evidence.get("maximum_quote")!;
      const amount = databasePositiveMicroUsd(value(quote, "amountMicroUsd", "amount_micro_usd"));
      const baseExpiry = expiryFrom(now, ttlSeconds(this.options.validityPolicy, "authority_snapshot", command.scope));
      const expiryCandidates = [
        baseExpiry,
        subject.planExpiresAt,
        subject.governanceExpiresAt,
        ...([...evidence.values()].map((row) => requiredExpiry(row))),
      ];
      if (subject.credentialExpiresAt) expiryCandidates.push(subject.credentialExpiresAt);
      const policyExpiry = nullableDate(value(policy, "expiresAt", "expires_at"));
      const killExpiry = nullableDate(value(kill, "expiresAt", "expires_at"));
      if (policyExpiry) expiryCandidates.push(policyExpiry);
      if (killExpiry) expiryCandidates.push(killExpiry);
      const expiresAt = new Date(Math.min(...expiryCandidates.map((date) => date.getTime())));
      if (expiresAt <= now) throw denied();

      const content = evidence.get("content_approval")!;
      const human = evidence.get("human_launch_approval")!;
      const sandbox = evidence.get("sandbox_proof")!;
      const evidenceBinding = {
        contentApproval: evidenceIdentity(content), humanLaunchApproval: evidenceIdentity(human),
        sandbox: evidenceIdentity(sandbox), maximumQuote: evidenceIdentity(quote),
      };
      const policyBinding = {
        id: uuid(String(policy.id), "policy.id"), revision: positiveInteger(Number(policy.revision), "policy.revision"),
        digest: validDigest(String(value(policy, "policyDigest", "policy_digest")), "policy.digest"),
      };
      const killBinding = {
        id: uuid(String(kill.id), "kill.id"), revision: positiveInteger(Number(kill.revision), "kill.revision"),
        digest: validDigest(String(value(kill, "evidenceDigest", "evidence_digest")), "kill.digest"),
      };
      const admissionDigest = digest({ domain: "ai-media-launch-admission-v1", subject: publicSubject(subject),
        evidence: evidenceBinding, policy: policyBinding, killSwitch: killBinding,
        maximumQuoteMicroUsd: amount, currency: "USD" });
      const authorityDigest = digest({ domain: "ai-media-launch-authority-snapshot-v1", id,
        subject: publicSubject(subject), evidence: evidenceBinding, policy: policyBinding, killSwitch: killBinding,
        maximumQuoteMicroUsd: amount, currency: "USD", validFrom: now.toISOString(),
        expiresAt: expiresAt.toISOString(), admissionDigest });
      const inserted = rows(await tx.execute(sql`
        INSERT INTO ${aiMediaLaunchAuthoritySnapshots} (
          id,owner_user_id,workspace_id,daily_plan_id,plan_digest,daily_plan_slot_id,slot_digest,
          provider_account_id,provider_key,provider_credential_version,slot_attempt,script_variant_id,
          script_variant_checksum,governance_profile_id,governance_evidence_digest,governance_use,
          governance_territory,content_country,launch_subject_digest,launch_intent_id,launch_intent_digest,
          content_approval_evidence_id,
          content_approval_evidence_digest,human_launch_approval_evidence_id,
          human_launch_approval_evidence_digest,sandbox_evidence_id,sandbox_evidence_digest,
          maximum_quote_evidence_id,maximum_quote_evidence_digest,policy_revision_id,policy_revision,
          policy_digest,kill_switch_revision_id,kill_switch_revision,kill_switch_evidence_digest,
          maximum_quote_micro_usd,currency,valid_from,expires_at,admission_digest,authority_digest,
          input_digest,idempotency_key,created_at)
        VALUES (${id},${subject.scope.ownerUserId},${subject.scope.workspaceId},${subject.dailyPlanId},
          ${subject.planDigest},${subject.dailyPlanSlotId},${subject.slotDigest},${subject.providerAccountId},
          ${subject.providerKey},${subject.providerCredentialVersion},${subject.slotAttempt},
          ${subject.scriptVariantId},${subject.scriptVariantChecksum},${subject.governanceProfileId},
          ${subject.governanceEvidenceDigest},${subject.governanceUse},${subject.governanceTerritory},
          ${subject.contentCountry},${subject.launchSubjectDigest},${subject.launchIntentId},
          ${subject.launchIntentDigest},${evidenceBinding.contentApproval.id},
          ${evidenceBinding.contentApproval.digest},${evidenceBinding.humanLaunchApproval.id},
          ${evidenceBinding.humanLaunchApproval.digest},${evidenceBinding.sandbox.id},
          ${evidenceBinding.sandbox.digest},${evidenceBinding.maximumQuote.id},
          ${evidenceBinding.maximumQuote.digest},${policyBinding.id},${policyBinding.revision},
          ${policyBinding.digest},${killBinding.id},${killBinding.revision},${killBinding.digest},
          ${amount}::numeric,'USD',${now},${expiresAt},${admissionDigest},${authorityDigest},
          ${input.inputDigest},${command.idempotencyKey},${now})
        ON CONFLICT (owner_user_id,workspace_id,idempotency_key) DO NOTHING RETURNING *
      `))[0];
      if (inserted) return snapshotReceipt(inserted, false);
      const raced = await this.byIdempotency(tx, aiMediaLaunchAuthoritySnapshots, command.scope, command.idempotencyKey);
      if (!raced) throw invariant("Authority snapshot insert lost its idempotency conflict");
      assertReplay(raced, input.inputDigest);
      return snapshotReceipt(raced, true);
    });
  }

  private async appendEvidence<T extends RecordContentApprovalCommand | RecordHumanLaunchApprovalCommand
    | RecordSandboxAttestationCommand | RecordMaximumQuoteAttestationCommand>(
    input: AuthorizedLaunchAuthorityWrite<T>,
    kind: EvidenceKind,
    decision: string | null,
    sourceKind: "authenticated_human" | "authenticated_workload" | "sandbox_adapter" | "provider_quote_adapter",
    sourceEvidenceDigest: Digest | null,
    sourceAttestationId: string | null,
    amountMicroUsd: string | null,
    currency: "USD" | null,
  ): Promise<LaunchAuthorityReceipt> {
    const { command, principal } = input;
    validSlotCommand(command);
    if (decision !== null) assertEvidenceDecision(kind, decision, amountMicroUsd, currency);
    return this.db.transaction(async (tx) => {
      await lockAuthorityIdempotency(tx, command.scope, kind, command.idempotencyKey);
      const replay = await this.byIdempotency(tx, aiMediaLaunchEvidence, command.scope, command.idempotencyKey);
      if (replay) { assertReplay(replay, input.inputDigest); return receipt(replay, kind, true); }
      await lockAuthorityWorkspace(tx, command.scope);
      const influencerId = await this.influencerForSlot(tx, command.scope, command.dailyPlanSlotId);
      await lockGovernanceProfile(tx, command.scope, influencerId);
      const identity = await this.identity(tx);
      const { id, now } = identity;
      const subject = await this.lockExactSubject(tx, command, now);
      if (kind === "sandbox_proof" || kind === "maximum_quote") {
        const runtimeCommand = command as unknown as RecordSandboxAttestationCommand | RecordMaximumQuoteAttestationCommand;
        const verified = await this.options.runtimeAttestationVerifier.verify({
          kind, attestationHandle: runtimeCommand.attestationHandle, scope: command.scope,
          principal, subject, databaseNow: now, idempotencyKey: command.idempotencyKey,
        });
        if (!verified || verified.kind !== kind) throw denied();
        decision = verified.decision;
        sourceEvidenceDigest = validDigest(verified.sourceEvidenceDigest, "sourceEvidenceDigest");
        sourceAttestationId = safe(verified.attestationId, "attestationId", 200, 8);
        if (verified.kind === "maximum_quote") {
          amountMicroUsd = microUsd(verified.maximumQuoteMicroUsd, false);
          currency = verified.currency;
        }
        assertEvidenceDecision(kind, decision, amountMicroUsd, currency);
      }
      const previous = rows(await tx.execute(sql`
        SELECT * FROM ${aiMediaLaunchEvidence}
        WHERE owner_user_id=${command.scope.ownerUserId} AND workspace_id=${command.scope.workspaceId}
          AND daily_plan_slot_id=${command.dailyPlanSlotId} AND slot_attempt=${command.slotAttempt}
          AND evidence_kind=${kind}
        ORDER BY revision DESC LIMIT 1 FOR UPDATE
      `))[0];
      const revision = previous ? positiveInteger(Number(previous.revision), "previous.revision") + 1 : 1;
      const previousEvidenceId = previous ? uuid(String(previous.id), "previous.id") : null;
      const previousEvidenceRevision = previous ? revision - 1 : null;
      const expiresAt = expiryFrom(now, ttlSeconds(this.options.validityPolicy, kind, command.scope));
      const evidenceDigest = digest({ domain: "ai-media-launch-evidence-v1", id, subject: publicSubject(subject),
        kind, decision, amountMicroUsd, currency, revision, previousEvidenceId, previousEvidenceRevision,
        validFrom: now.toISOString(), expiresAt: expiresAt.toISOString(), actor: {
          kind: principal.kind, subjectId: principal.subjectId,
          authenticationEvidenceDigest: principal.authenticationEvidenceDigest ?? null,
        }, sourceKind, sourceEvidenceDigest, sourceAttestationId });
      const inserted = rows(await tx.execute(sql`
        INSERT INTO ${aiMediaLaunchEvidence} (
          id,owner_user_id,workspace_id,daily_plan_slot_id,slot_attempt,provider_account_id,provider_key,
          provider_credential_version,script_variant_id,script_variant_checksum,governance_profile_id,
          governance_evidence_digest,governance_use,governance_territory,content_country,
          launch_subject_digest,launch_intent_id,launch_intent_digest,evidence_kind,decision,amount_micro_usd,currency,revision,
          previous_evidence_id,previous_evidence_revision,valid_from,expires_at,actor_user_id,source_kind,
          source_attestation_id,source_evidence_digest,evidence_digest,input_digest,idempotency_key,created_at)
        VALUES (${id},${subject.scope.ownerUserId},${subject.scope.workspaceId},${subject.dailyPlanSlotId},
          ${subject.slotAttempt},${subject.providerAccountId},${subject.providerKey},
          ${subject.providerCredentialVersion},${subject.scriptVariantId},${subject.scriptVariantChecksum},
          ${subject.governanceProfileId},${subject.governanceEvidenceDigest},${subject.governanceUse},
          ${subject.governanceTerritory},${subject.contentCountry},${subject.launchSubjectDigest},
          ${subject.launchIntentId},${subject.launchIntentDigest},${kind},
          ${decision},${amountMicroUsd}::numeric,${currency},${revision},${previousEvidenceId},
          ${previousEvidenceRevision},${now},${expiresAt},${principal.subjectId},${sourceKind},
          ${sourceAttestationId},${sourceEvidenceDigest},${evidenceDigest},${input.inputDigest},
          ${command.idempotencyKey},${now})
        ON CONFLICT (owner_user_id,workspace_id,idempotency_key) DO NOTHING RETURNING *
      `))[0];
      if (inserted) return receipt(inserted, kind, false);
      return this.racedReceipt(tx, aiMediaLaunchEvidence, command.scope, command.idempotencyKey,
        input.inputDigest, kind);
    });
  }

  private async influencerForSlot(
    tx: LaunchAuthorityDatabase,
    scope: TenantScope,
    slotId: string,
  ): Promise<string> {
    const found = rows(await tx.execute(sql`
      SELECT influencer_id FROM ${aiMediaDailyPlanSlots}
      WHERE owner_user_id=${scope.ownerUserId} AND workspace_id=${scope.workspaceId}
        AND id=${slotId} LIMIT 2
    `));
    if (found.length !== 1) throw denied();
    return uuid(String(value(found[0], "influencerId", "influencer_id")), "influencerId");
  }

  private async lockProductionBatchSource(
    tx: LaunchAuthorityDatabase,
    scope: TenantScope,
    row: Row,
  ): Promise<Row> {
    const locked = rows(await tx.execute(sql`
      SELECT id,source_type,title,content,content_hash,status,rights_status,moderation_status
      FROM ${aiMediaSourceItems}
      WHERE owner_user_id=${scope.ownerUserId} AND workspace_id=${scope.workspaceId}
        AND id=${value(row, "sourceItemId", "source_item_id")}
        AND source_type=${value(row, "sourceType", "source_type")}
        AND content_hash=${value(row, "sourceContentHash", "source_content_hash")}
        AND status IN ('accepted','ready') AND moderation_status='approved'
        AND rights_status IN ('owned','licensed')
      FOR UPDATE
    `));
    if (locked.length !== 1) throw denied();
    return locked[0]!;
  }

  private async lockProductionPlanShape(
    tx: LaunchAuthorityDatabase,
    scope: TenantScope,
    row: Row,
  ): Promise<Row[]> {
    const locked = rows(await tx.execute(sql`
      SELECT source_member_key,video_number,status AS slot_status
      FROM ${aiMediaDailyPlanSlots}
      WHERE owner_user_id=${scope.ownerUserId} AND workspace_id=${scope.workspaceId}
        AND daily_plan_id=${value(row, "dailyPlanId", "daily_plan_id")}
      ORDER BY source_member_key,video_number
      FOR UPDATE
    `));
    if (locked.length < 50 || locked.length > 100) throw denied();
    return locked;
  }

  private productionBatchIntegrityIsCurrent(
    scope: TenantScope,
    now: Date,
    rowsForSlot: readonly Row[],
    planSlots: readonly Row[],
    source: Row,
  ): boolean {
    const row = rowsForSlot[0];
    if (!row) return false;
    const facts: ApprovedProductionBatchSlotFacts = {
      scope,
      databaseNow: now,
      plan: {
        publicKey: String(value(row, "publicPlanKey", "public_plan_key") ?? ""),
        status: String(value(row, "planStatus", "plan_status") ?? ""),
        plannedSlotCount: Number(value(row, "plannedSlotCount", "planned_slot_count")),
      },
      planSlots: planSlots.map((slot) => ({
        sourceMemberKey: String(value(slot, "sourceMemberKey", "source_member_key") ?? ""),
        videoNumber: Number(value(slot, "videoNumber", "video_number")),
        status: String(value(slot, "slotStatus", "slot_status") ?? ""),
      })),
      slot: {
        publicKey: String(value(row, "publicSlotKey", "public_slot_key") ?? ""),
        status: String(value(row, "slotStatus", "slot_status") ?? ""),
        scriptVariantId: String(value(row, "selectedVariantId", "selected_variant_id")
          ?? value(row, "scriptVariantId", "script_variant_id") ?? ""),
      },
      script: {
        id: String(value(row, "scriptId", "script_id") ?? ""),
        title: String(value(row, "scriptTitle", "script_title") ?? ""),
        status: String(value(row, "scriptStatus", "script_status") ?? ""),
        currentVariantId: String(value(row, "currentVariantId", "current_variant_id") ?? ""),
        metadata: value(row, "scriptMetadata", "script_metadata"),
        sourceType: String(value(row, "sourceType", "source_type") ?? ""),
        sourceItemId: value(row, "sourceItemId", "source_item_id") == null
          ? null : String(value(row, "sourceItemId", "source_item_id")),
      },
      source: {
        id: String(value(source, "id", "id") ?? ""),
        type: String(value(source, "sourceType", "source_type") ?? ""),
        title: String(value(source, "title", "title") ?? ""),
        content: String(value(source, "content", "content") ?? ""),
        contentHash: String(value(source, "contentHash", "content_hash") ?? ""),
        status: String(value(source, "status", "status") ?? ""),
        rightsStatus: String(value(source, "rightsStatus", "rights_status") ?? ""),
        moderationStatus: String(value(source, "moderationStatus", "moderation_status") ?? ""),
      },
      variants: rowsForSlot.map((variantRow) => ({
        id: String(value(variantRow, "variantId", "variant_id") ?? ""),
        version: Number(value(variantRow, "variantVersion", "variant_version")),
        label: String(value(variantRow, "variantLabel", "variant_label") ?? ""),
        content: String(value(variantRow, "variantContent", "variant_content") ?? ""),
        status: String(value(variantRow, "variantStatus", "variant_status") ?? ""),
        checksum: String(value(variantRow, "variantChecksum", "variant_checksum") ?? ""),
        metadata: value(variantRow, "variantMetadata", "variant_metadata"),
      })),
    };
    return Boolean(verifiedProductionBatchApprovalBinding(facts));
  }

  private async lockExactSubject(
    tx: LaunchAuthorityDatabase,
    command: { scope: TenantScope; dailyPlanSlotId: string; slotAttempt: number },
    now: Date,
  ): Promise<LockedLaunchSubject> {
    const result = rows(await tx.execute(sql`
      SELECT intents.*,plans.public_plan_key,plans.status AS plan_status,plans.planned_slot_count,
        slots.public_slot_key,slots.status AS slot_status,
        plans.plan_date::text,plans.accounting_time_zone,
        ((plans.plan_date+1)::timestamp AT TIME ZONE plans.accounting_time_zone) AS plan_expires_at,
        slots.influencer_id,scripts.language,scripts.title AS script_title,
        scripts.status AS script_status,scripts.current_variant_id,scripts.metadata AS script_metadata,
        selected.id AS selected_variant_id,selected.version AS selected_variant_version,
        selected.label AS selected_variant_label,selected.content AS selected_variant_content,
        selected.status AS selected_variant_status,selected.checksum AS selected_variant_checksum,
        selected.metadata AS selected_variant_metadata,
        variants.id AS variant_id,variants.version AS variant_version,variants.label AS variant_label,
        variants.content AS variant_content,variants.status AS variant_status,
        variants.checksum AS variant_checksum,variants.metadata AS variant_metadata,
        governance.expires_at AS governance_expires_at,accounts.credential_expires_at
      FROM ${aiMediaLaunchIntents} intents
      INNER JOIN ${aiMediaDailyPlans} plans
        ON plans.owner_user_id=intents.owner_user_id AND plans.workspace_id=intents.workspace_id
        AND plans.id=intents.daily_plan_id AND plans.plan_digest=intents.plan_digest
        AND plans.provider_account_id=intents.provider_account_id AND plans.provider_key=intents.provider_key
        AND plans.provider_credential_version=intents.provider_credential_version
        AND plans.source_roster_key=intents.source_roster_key AND plans.source_roster_digest=intents.source_roster_digest
      INNER JOIN ${aiMediaDailyPlanSlots} slots
        ON slots.owner_user_id=intents.owner_user_id AND slots.workspace_id=intents.workspace_id
        AND slots.id=intents.daily_plan_slot_id AND slots.daily_plan_id=intents.daily_plan_id
        AND slots.provider_account_id=intents.provider_account_id AND slots.provider_key=intents.provider_key
        AND slots.provider_credential_version=intents.provider_credential_version
        AND slots.source_member_key=intents.source_member_key AND slots.script_variant_id=intents.script_variant_id
        AND slots.slot_digest=intents.slot_digest
      INNER JOIN ${aiMediaProviderAccounts} accounts
        ON accounts.owner_user_id=slots.owner_user_id AND accounts.workspace_id=slots.workspace_id
        AND accounts.id=intents.provider_account_id AND accounts.provider_key=intents.provider_key
      INNER JOIN ${aiMediaInfluencers} influencers
        ON influencers.owner_user_id=slots.owner_user_id AND influencers.workspace_id=slots.workspace_id
        AND influencers.id=slots.influencer_id
      INNER JOIN ${aiMediaProviderResources} avatars
        ON avatars.owner_user_id=slots.owner_user_id AND avatars.workspace_id=slots.workspace_id
        AND avatars.id=slots.avatar_resource_id AND avatars.provider_account_id=slots.provider_account_id
        AND avatars.provider_key=slots.provider_key AND avatars.resource_type='avatar'
      INNER JOIN ${aiMediaProviderResources} voices
        ON voices.owner_user_id=slots.owner_user_id AND voices.workspace_id=slots.workspace_id
        AND voices.id=slots.voice_resource_id AND voices.provider_account_id=slots.provider_account_id
        AND voices.provider_key=slots.provider_key AND voices.resource_type='voice'
      INNER JOIN ${aiMediaScriptVariants} selected
        ON selected.owner_user_id=slots.owner_user_id AND selected.workspace_id=slots.workspace_id
        AND selected.id=intents.script_variant_id AND selected.script_id=intents.script_id
        AND selected.checksum=intents.script_variant_checksum
      INNER JOIN ${aiMediaScripts} scripts
        ON scripts.owner_user_id=selected.owner_user_id AND scripts.workspace_id=selected.workspace_id
        AND scripts.id=intents.script_id AND scripts.influencer_id=slots.influencer_id
        AND scripts.source_type=intents.source_type AND scripts.current_variant_id=intents.script_variant_id
      INNER JOIN ${aiMediaScriptVariants} variants
        ON variants.owner_user_id=scripts.owner_user_id AND variants.workspace_id=scripts.workspace_id
        AND variants.script_id=scripts.id
      LEFT JOIN ${aiMediaSourceItems} sources
        ON sources.owner_user_id=intents.owner_user_id AND sources.workspace_id=intents.workspace_id
        AND sources.id=intents.source_item_id AND sources.source_type=intents.source_type
        AND sources.content_hash=intents.source_content_hash
      INNER JOIN ${aiMediaGovernanceProfiles} governance
        ON governance.owner_user_id=slots.owner_user_id AND governance.workspace_id=slots.workspace_id
        AND governance.id=intents.governance_profile_id AND governance.influencer_id=slots.influencer_id
        AND governance.evidence_digest=intents.governance_evidence_digest
      WHERE intents.owner_user_id=${command.scope.ownerUserId} AND intents.workspace_id=${command.scope.workspaceId}
        AND intents.daily_plan_slot_id=${command.dailyPlanSlotId} AND intents.slot_attempt=${command.slotAttempt}
        AND plans.status='planned' AND plans.plan_date=(${now} AT TIME ZONE plans.accounting_time_zone)::date
        AND slots.status='planned' AND selected.status='approved' AND scripts.status='approved'
        AND ((intents.source_type='manual' AND intents.source_item_id IS NULL AND intents.source_content_hash IS NULL)
          OR (intents.source_type<>'manual' AND sources.id IS NOT NULL
            AND sources.status IN ('accepted','ready') AND sources.moderation_status='approved'
            AND sources.rights_status IN ('owned','licensed')))
        AND accounts.credential_version=intents.provider_credential_version
        AND accounts.status IN ('active','connected') AND accounts.credential_status='active'
        AND (accounts.credential_expires_at IS NULL OR accounts.credential_expires_at>${now})
        AND influencers.status='active' AND influencers.archived_at IS NULL
        AND avatars.status='active' AND voices.status='active'
        AND governance.state='active' AND governance.revoked_at IS NULL
        AND governance.valid_from<=${now} AND governance.expires_at>${now}
        AND governance.allowed_uses @> jsonb_build_array(intents.governance_use::text)
        AND (governance.territories @> jsonb_build_array(intents.governance_territory::text)
          OR governance.territories @> '["WORLDWIDE"]'::jsonb)
        AND NOT EXISTS (SELECT 1 FROM ${aiMediaGovernanceProfiles} newer
          WHERE newer.owner_user_id=governance.owner_user_id AND newer.workspace_id=governance.workspace_id
            AND newer.influencer_id=governance.influencer_id AND newer.version>governance.version)
        AND intents.slot_attempt=COALESCE((SELECT MAX(previous.attempt)+1
          FROM ${aiMediaBudgetReservations} previous
          WHERE previous.owner_user_id=slots.owner_user_id AND previous.workspace_id=slots.workspace_id
            AND previous.daily_plan_slot_id=slots.id),1)
      ORDER BY variants.version
      FOR UPDATE OF intents,plans,slots,accounts,influencers,avatars,voices,selected,variants,scripts,governance
    `));
    if (result.length < 1 || result.length > 5) throw denied();
    const row = result[0]!;
    const planSlots = await this.lockProductionPlanShape(tx, command.scope, row);
    const lockedSource = await this.lockProductionBatchSource(tx, command.scope, row);
    if (!this.productionBatchIntegrityIsCurrent(command.scope, now, result, planSlots, lockedSource)) throw denied();
    const subject = subjectFromLaunchRow(row, command.scope, command.slotAttempt,
      String(value(row, "governanceUse", "governance_use")),
      String(value(row, "governanceTerritory", "governance_territory")),
      String(value(row, "contentCountry", "content_country")),
      String(value(row, "id", "id")), String(value(row, "launchIntentDigest", "launch_intent_digest")));
    validateTrustedSubject(subject as TrustedLaunchSubject);
    const derivedDigest = deriveLaunchSubjectDigest(subject);
    if (derivedDigest !== String(value(row, "launchSubjectDigest", "launch_subject_digest"))) throw denied();
    return {
      ...subject,
      launchSubjectDigest: derivedDigest,
      influencerId: uuid(String(value(row, "influencerId", "influencer_id")), "influencerId"),
      language: safe(String(row.language), "language", 35),
      accountingTimeZone: validTimeZone(String(value(row, "accountingTimeZone", "accounting_time_zone"))),
      planDate: String(value(row, "planDate", "plan_date")),
      planExpiresAt: requiredDate(value(row, "planExpiresAt", "plan_expires_at")),
      governanceExpiresAt: requiredDate(value(row, "governanceExpiresAt", "governance_expires_at")),
      credentialExpiresAt: nullableDate(value(row, "credentialExpiresAt", "credential_expires_at")),
    };
  }

  private async byIdempotency(
    tx: LaunchAuthorityDatabase,
    table: typeof aiMediaAdmissionPolicyRevisions | typeof aiMediaKillSwitchRevisions
      | typeof aiMediaLaunchIntents | typeof aiMediaLaunchEvidence | typeof aiMediaLaunchAuthoritySnapshots,
    scope: TenantScope,
    idempotencyKey: string,
  ): Promise<Row | undefined> {
    return rows(await tx.execute(sql`SELECT * FROM ${table}
      WHERE owner_user_id=${scope.ownerUserId} AND workspace_id=${scope.workspaceId}
        AND idempotency_key=${idempotencyKey} LIMIT 1`))[0];
  }

  private async racedReceipt(
    tx: LaunchAuthorityDatabase,
    table: typeof aiMediaAdmissionPolicyRevisions | typeof aiMediaKillSwitchRevisions
      | typeof aiMediaLaunchIntents | typeof aiMediaLaunchEvidence,
    scope: TenantScope,
    idempotencyKey: string,
    inputDigest: Digest,
    kind: LaunchAuthorityReceipt["kind"],
  ): Promise<LaunchAuthorityReceipt> {
    const raced = await this.byIdempotency(tx, table, scope, idempotencyKey);
    if (!raced) throw invariant("Authority append lost its idempotency conflict");
    assertReplay(raced, inputDigest);
    return receipt(raced, kind, true);
  }

  private async identity(tx: LaunchAuthorityDatabase): Promise<{ id: string; now: Date }> {
    const row = rows(await tx.execute(sql`
      SELECT gen_random_uuid() AS generated_id, clock_timestamp() AS database_now
    `))[0];
    if (!row) throw invariant("Database clock unavailable");
    return {
      id: uuid(String(value(row, "generatedId", "generated_id")), "database generated id"),
      now: databaseNow(row),
    };
  }
}

function subjectFromLaunchRow(
  row: Row,
  scope: TenantScope,
  slotAttempt: number,
  governanceUse: string,
  governanceTerritory: string,
  contentCountry: string,
  launchIntentId: string,
  launchIntentDigest: string,
): TrustedLaunchSubject {
  return {
    scope,
    dailyPlanId: uuid(String(value(row, "dailyPlanId", "daily_plan_id")), "dailyPlanId"),
    dailyPlanSlotId: uuid(String(value(row, "dailyPlanSlotId", "daily_plan_slot_id")), "dailyPlanSlotId"),
    slotAttempt: positiveInteger(slotAttempt, "slotAttempt"),
    planDigest: validDigest(String(value(row, "planDigest", "plan_digest")), "planDigest"),
    slotDigest: validDigest(String(value(row, "slotDigest", "slot_digest")), "slotDigest"),
    sourceRosterKey: safe(String(value(row, "sourceRosterKey", "source_roster_key")), "sourceRosterKey", 200),
    sourceRosterDigest: validDigest(String(value(row, "sourceRosterDigest", "source_roster_digest")), "sourceRosterDigest"),
    sourceMemberKey: safe(String(value(row, "sourceMemberKey", "source_member_key")), "sourceMemberKey", 200),
    providerAccountId: uuid(String(value(row, "providerAccountId", "provider_account_id")), "providerAccountId"),
    providerKey: safe(String(value(row, "providerKey", "provider_key")), "providerKey", 80),
    providerCredentialVersion: positiveInteger(Number(value(row, "providerCredentialVersion", "provider_credential_version")), "providerCredentialVersion"),
    scriptId: uuid(String(value(row, "scriptId", "script_id")), "scriptId"),
    scriptVariantId: uuid(String(value(row, "scriptVariantId", "script_variant_id")), "scriptVariantId"),
    scriptVariantChecksum: String(value(row, "scriptVariantChecksum", "script_variant_checksum")),
    sourceType: safe(String(value(row, "sourceType", "source_type")), "sourceType", 80),
    sourceItemId: value(row, "sourceItemId", "source_item_id") == null ? null
      : uuid(String(value(row, "sourceItemId", "source_item_id")), "sourceItemId"),
    sourceContentHash: value(row, "sourceContentHash", "source_content_hash") == null ? null
      : String(value(row, "sourceContentHash", "source_content_hash")),
    governanceProfileId: uuid(String(value(row, "governanceProfileId", "governance_profile_id")), "governanceProfileId"),
    governanceEvidenceDigest: validDigest(String(value(row, "governanceEvidenceDigest", "governance_evidence_digest")), "governanceEvidenceDigest"),
    governanceUse: safe(governanceUse, "governanceUse", 80),
    governanceTerritory: safe(governanceTerritory, "governanceTerritory", 80),
    contentCountry,
    launchIntentId: uuid(launchIntentId, "launchIntentId"),
    launchIntentDigest: validDigest(launchIntentDigest, "launchIntentDigest"),
    launchSubjectDigest: digest("temporary-launch-subject"),
  } as TrustedLaunchSubject;
}

interface LockedLaunchSubject extends TrustedLaunchSubject {
  influencerId: string;
  language: string;
  accountingTimeZone: string;
  planDate: string;
  planExpiresAt: Date;
  governanceExpiresAt: Date;
  credentialExpiresAt: Date | null;
}

export function deriveLaunchSubjectDigest(subject: Omit<TrustedLaunchSubject, "launchSubjectDigest">): Digest {
  return digest({ domain: "ai-media-launch-subject-v1", subject: publicSubject(subject) });
}

function publicSubject(subject: Omit<TrustedLaunchSubject, "launchSubjectDigest"> | TrustedLaunchSubject) {
  return {
    ...launchFacts(subject),
    launchIntentId: subject.launchIntentId, launchIntentDigest: subject.launchIntentDigest,
  };
}

function launchFacts(subject: Omit<TrustedLaunchSubject, "launchSubjectDigest"> | TrustedLaunchSubject) {
  return {
    scope: subject.scope, dailyPlanId: subject.dailyPlanId, dailyPlanSlotId: subject.dailyPlanSlotId,
    slotAttempt: subject.slotAttempt, planDigest: subject.planDigest, slotDigest: subject.slotDigest,
    sourceRosterKey: subject.sourceRosterKey, sourceRosterDigest: subject.sourceRosterDigest,
    sourceMemberKey: subject.sourceMemberKey,
    providerAccountId: subject.providerAccountId, providerKey: subject.providerKey,
    providerCredentialVersion: subject.providerCredentialVersion, scriptId: subject.scriptId,
    scriptVariantId: subject.scriptVariantId, scriptVariantChecksum: subject.scriptVariantChecksum,
    sourceType: subject.sourceType, sourceItemId: subject.sourceItemId, sourceContentHash: subject.sourceContentHash,
    governanceProfileId: subject.governanceProfileId,
    governanceEvidenceDigest: subject.governanceEvidenceDigest, governanceUse: subject.governanceUse,
    governanceTerritory: subject.governanceTerritory, contentCountry: subject.contentCountry,
  };
}

function validateTrustedSubject(subject: TrustedLaunchSubject): void {
  validScope(subject.scope);
  for (const [field, id] of [["dailyPlanId", subject.dailyPlanId], ["dailyPlanSlotId", subject.dailyPlanSlotId],
    ["providerAccountId", subject.providerAccountId], ["scriptId", subject.scriptId],
    ["scriptVariantId", subject.scriptVariantId], ["governanceProfileId", subject.governanceProfileId],
    ["launchIntentId", subject.launchIntentId]] as const) uuid(id, field);
  positiveInteger(subject.slotAttempt, "slotAttempt");
  positiveInteger(subject.providerCredentialVersion, "providerCredentialVersion");
  safe(subject.providerKey, "providerKey", 80);
  validDigest(subject.planDigest, "planDigest"); validDigest(subject.slotDigest, "slotDigest");
  safe(subject.sourceRosterKey, "sourceRosterKey", 200); safe(subject.sourceMemberKey, "sourceMemberKey", 200);
  validDigest(subject.sourceRosterDigest, "sourceRosterDigest");
  validDigest(subject.governanceEvidenceDigest, "governanceEvidenceDigest");
  validDigest(subject.launchSubjectDigest, "launchSubjectDigest");
  validDigest(subject.launchIntentDigest, "launchIntentDigest");
  if (!RAW_SHA256.test(subject.scriptVariantChecksum)) throw invalid("scriptVariantChecksum is invalid");
  safe(subject.sourceType, "sourceType", 80);
  if (subject.sourceType === "manual") {
    if (subject.sourceItemId !== null || subject.sourceContentHash !== null) throw invalid("manual source binding is invalid");
  } else {
    uuid(String(subject.sourceItemId), "sourceItemId");
    validDigest(String(subject.sourceContentHash), "sourceContentHash");
  }
  safe(subject.governanceUse, "governanceUse", 80);
  safe(subject.governanceTerritory, "governanceTerritory", 80);
  if (!COUNTRY.test(subject.contentCountry)) throw invalid("contentCountry is invalid");
}

function validSlotCommand(command: { scope: TenantScope; dailyPlanSlotId: string; slotAttempt: number }): void {
  validScope(command.scope);
  uuid(command.dailyPlanSlotId, "dailyPlanSlotId");
  positiveInteger(command.slotAttempt, "slotAttempt");
}

function assertEvidenceDecision(kind: EvidenceKind, decision: string, amount: string | null, currency: "USD" | null): void {
  const valid = kind === "sandbox_proof" ? ["passed", "failed", "revoked"]
    : kind === "maximum_quote" ? ["quoted", "declined", "revoked"] : ["approved", "rejected", "revoked"];
  if (!valid.includes(decision)) throw invalid("Evidence decision is invalid");
  if (kind === "maximum_quote") {
    if (amount === null || currency !== "USD") throw invalid("Maximum quote is incomplete");
    microUsd(amount, false);
  } else if (amount !== null || currency !== null) throw invalid("Non-quote evidence cannot carry money");
}

function assertPolicyAdmits(row: Row, subject: LockedLaunchSubject, now: Date): void {
  if (String(row.state) !== "active" || requiredDate(value(row, "validFrom", "valid_from")) > now) throw denied();
  const expiry = nullableDate(value(row, "expiresAt", "expires_at"));
  if (expiry && expiry <= now) throw denied();
  const languages = stringArray(value(row, "allowedLanguages", "allowed_languages"));
  const countries = stringArray(value(row, "allowedCountries", "allowed_countries"));
  const zones = stringArray(value(row, "allowedTimeZones", "allowed_time_zones"));
  if (!languages.includes(subject.language) || !countries.includes(subject.contentCountry)
    || !zones.includes(subject.accountingTimeZone)) throw denied();
}

function assertKillSwitchOpen(row: Row, now: Date): void {
  if (row.active !== false || requiredDate(value(row, "validFrom", "valid_from")) > now) throw denied();
  const expiry = nullableDate(value(row, "expiresAt", "expires_at"));
  if (expiry && expiry <= now) throw denied();
}

function assertEvidenceAdmits(evidence: Map<EvidenceKind, Row>, subject: LockedLaunchSubject, now: Date): void {
  const expected = new Map<EvidenceKind, string>([
    ["content_approval", "approved"], ["human_launch_approval", "approved"],
    ["sandbox_proof", "passed"], ["maximum_quote", "quoted"],
  ]);
  for (const [kind, row] of evidence) {
    if (String(value(row, "evidenceKind", "evidence_kind")) !== kind || String(row.decision) !== expected.get(kind)
      || String(value(row, "launchSubjectDigest", "launch_subject_digest")) !== subject.launchSubjectDigest
      || String(value(row, "launchIntentId", "launch_intent_id")) !== subject.launchIntentId
      || String(value(row, "launchIntentDigest", "launch_intent_digest")) !== subject.launchIntentDigest
      || String(value(row, "dailyPlanSlotId", "daily_plan_slot_id")) !== subject.dailyPlanSlotId
      || Number(value(row, "slotAttempt", "slot_attempt")) !== subject.slotAttempt
      || String(value(row, "providerAccountId", "provider_account_id")) !== subject.providerAccountId
      || String(value(row, "providerKey", "provider_key")) !== subject.providerKey
      || Number(value(row, "providerCredentialVersion", "provider_credential_version")) !== subject.providerCredentialVersion
      || String(value(row, "scriptVariantId", "script_variant_id")) !== subject.scriptVariantId
      || String(value(row, "scriptVariantChecksum", "script_variant_checksum")) !== subject.scriptVariantChecksum
      || String(value(row, "governanceProfileId", "governance_profile_id")) !== subject.governanceProfileId
      || String(value(row, "governanceEvidenceDigest", "governance_evidence_digest")) !== subject.governanceEvidenceDigest
      || String(value(row, "governanceUse", "governance_use")) !== subject.governanceUse
      || String(value(row, "governanceTerritory", "governance_territory")) !== subject.governanceTerritory
      || String(value(row, "contentCountry", "content_country")) !== subject.contentCountry
      || requiredDate(value(row, "validFrom", "valid_from")) > now || requiredExpiry(row) <= now) throw denied();
  }
}

function evidenceIdentity(row: Row) {
  return { id: uuid(String(row.id), "evidence.id"),
    digest: validDigest(String(value(row, "evidenceDigest", "evidence_digest")), "evidence.digest") };
}

function requiredExpiry(row: Row): Date {
  const expiry = nullableDate(value(row, "expiresAt", "expires_at"));
  if (!expiry) throw denied();
  return expiry;
}

function stringArray(input: unknown): string[] {
  const parsed = typeof input === "string" ? JSON.parse(input) : input;
  if (!Array.isArray(parsed) || parsed.some((entry) => typeof entry !== "string")) throw invariant("Database returned an invalid allowlist");
  return parsed;
}

function requiredDate(input: unknown): Date {
  const date = input instanceof Date ? input : new Date(String(input));
  if (Number.isNaN(date.getTime())) throw invariant("Database returned an invalid timestamp");
  return date;
}

function nullableDate(input: unknown): Date | null {
  return input === null || input === undefined ? null : requiredDate(input);
}

function databasePositiveMicroUsd(input: unknown): string {
  return microUsd(typeof input === "bigint" ? input.toString() : String(input), false);
}

function validScope(scope: TenantScope): TenantScope {
  return { ownerUserId: safe(scope.ownerUserId, "ownerUserId", 255), workspaceId: safe(scope.workspaceId, "workspaceId", 255) };
}

function sameScope(left: TenantScope, right: TenantScope): boolean {
  return left.ownerUserId === right.ownerUserId && left.workspaceId === right.workspaceId;
}

function uuid(input: string, field: string): string {
  if (typeof input !== "string" || !UUID.test(input)) throw invalid(`${field} is invalid`);
  return input;
}

function validDigest(input: string, field: string): Digest {
  if (typeof input !== "string" || !SHA256.test(input)) throw invalid(`${field} is invalid`);
  return input as Digest;
}

function safe(input: string, field: string, max: number, min = 1): string {
  if (typeof input !== "string" || input.length < min || input.length > max || !SAFE.test(input)) throw invalid(`${field} is invalid`);
  return input;
}

function display(input: string, field: string, max: number): string {
  if (typeof input !== "string" || input.trim() !== input || input.length < 1 || input.length > max
    || /[\u0000-\u001f\u007f]/u.test(input)) throw invalid(`${field} is invalid`);
  return input;
}

function positiveInteger(input: number, field: string, allowZero = false): number {
  if (!Number.isSafeInteger(input) || input < (allowZero ? 0 : 1)) throw invalid(`${field} is invalid`);
  return input;
}

function validTimeZone(input: string): string {
  try {
    if (typeof input !== "string" || input.length > 80
      || new Intl.DateTimeFormat("en-US", { timeZone: input }).resolvedOptions().timeZone !== input) throw new Error("invalid");
  } catch { throw invalid("timeZone is invalid"); }
  return input;
}

function invalid(message: string): LaunchAuthorityPersistenceError {
  return new LaunchAuthorityPersistenceError("INVALID_INPUT", message);
}
function denied(): LaunchAuthorityPersistenceError {
  return new LaunchAuthorityPersistenceError("AUTHORITY_DENIED", "Launch authority request denied");
}
function conflict(message: string): LaunchAuthorityPersistenceError {
  return new LaunchAuthorityPersistenceError("IDEMPOTENCY_CONFLICT", message);
}
function invariant(message: string): LaunchAuthorityPersistenceError {
  return new LaunchAuthorityPersistenceError("INVARIANT_VIOLATION", message);
}
