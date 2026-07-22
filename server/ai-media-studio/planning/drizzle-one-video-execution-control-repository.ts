import { createHash } from "node:crypto";
import { sql, type SQL } from "drizzle-orm";
import {
  oneVideoExecutionControlSchema,
  type OneVideoExecutionControl,
} from "../../../shared/ai-media-studio-one-video-execution-control";
import type { QuoteReadiness } from "../../../shared/ai-media-studio-quote-readiness";
import type { TenantScope } from "../core/resource-domain";
import {
  readProductionBatchEnvelope,
  verifyApprovedProductionBatchSlotMetadata,
  type ApprovedProductionBatchSlotFacts,
} from "../production-batches/metadata-integrity";
import {
  deriveLaunchRenderSpecDigest,
  deriveMaximumQuoteKey,
  deriveRenderSpecKey,
  OneVideoExecutionControlError,
  type OneVideoExecutionControlRepository,
} from "./one-video-execution-control-contracts";
import type { MaximumQuoteReadinessResolver } from "./maximum-quote-provider-contracts";
import { projectMaximumQuoteReadiness, unavailableMaximumQuoteReadinessResolver } from "./maximum-quote-readiness-registry";

type ExecuteResult = { rows?: unknown[] } | unknown[];
export type OneVideoExecutionControlDatabase = { execute(query: SQL): Promise<ExecuteResult> };
export type OneVideoExecutionControlTransactionalDatabase = OneVideoExecutionControlDatabase & {
  transaction<T>(callback: (tx: OneVideoExecutionControlDatabase) => Promise<T>, config?: Readonly<{
    isolationLevel?: "repeatable read"; accessMode?: "read only";
  }>): Promise<T>;
};
type Row = Record<string, unknown>;
const INTERNAL_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const SHA256 = /^sha256:[0-9a-f]{64}$/u;

const rows = (result: ExecuteResult): Row[] => (Array.isArray(result) ? result : result.rows ?? []) as Row[];
const value = (row: Row, camel: string, snake: string): unknown => row[camel] ?? row[snake];
const text = (row: Row, camel: string, snake: string): string => String(value(row, camel, snake) ?? "");
const number = (row: Row, camel: string, snake: string): number => Number(value(row, camel, snake));
const bool = (row: Row, camel: string, snake: string): boolean => value(row, camel, snake) === true;
const date = (raw: unknown): Date => {
  const parsed = raw instanceof Date ? raw : new Date(String(raw));
  if (!Number.isFinite(parsed.getTime())) throw new OneVideoExecutionControlError("UNAVAILABLE");
  return parsed;
};
const optionalIso = (raw: unknown): string | undefined => raw == null ? undefined : date(raw).toISOString();
const opaque = (prefix: "selection" | "resource" | "evidence", input: string): string =>
  `${prefix}_${createHash("sha256").update(`ai-media-one-video-${prefix}-v1\0${input}`).digest("hex").slice(0, 24)}`;
const sha256 = (input: string): string => `sha256:${createHash("sha256").update(input).digest("hex")}`;

type EvidenceState = {
  state: string; evidenceKey?: string; observedAt?: string; expiresAt?: string;
  amountMicroUsd?: string; currency?: "USD";
  quoteKey?: string; renderSpecKey?: string; approvedQuoteKey?: string;
};
type ProviderVerificationState = "not_requested" | "verified" | "failed" | "stale" | "unavailable";
type StaticVerificationProjection = "verified" | "stale" | "missing";

export function derivePersistedProviderVerificationState(input: Readonly<{
  bindingState: "current" | "stale" | "invalid";
  credentialSource: string; accountStatus: string; credentialStatus: string;
  staticVerification?: StaticVerificationProjection;
}>): ProviderVerificationState {
  if (input.bindingState === "invalid") return "unavailable";
  if (input.credentialSource === "static_api_key" && input.accountStatus === "disconnected"
    && input.credentialStatus === "unverified") return "not_requested";
  if (input.bindingState === "stale") return "stale";
  if (["revoked", "expired", "attention"].includes(input.credentialStatus)) return "failed";
  if (input.credentialSource === "static_api_key" && input.accountStatus === "active"
    && input.credentialStatus === "active") {
    return input.staticVerification === "verified" ? "verified" : "stale";
  }
  return "unavailable";
}

export function deriveQuoteReadiness(input: Readonly<{
  quoteState: EvidenceState["state"];
  bindingState: "current" | "stale" | "invalid";
  verificationState: ProviderVerificationState;
  providerKey: string;
  resolver: MaximumQuoteReadinessResolver;
}>): QuoteReadiness {
  return projectMaximumQuoteReadiness({
    exactEvidencePresent: input.quoteState === "quoted",
    providerConfigured: input.bindingState === "current" && input.verificationState === "verified",
    providerKey: input.providerKey,
    resolver: input.resolver,
  });
}

/** Read-only exact-slot projection. It deliberately has no provider, vault, budget, render, outbox, or publishing dependency. */
export class DrizzleOneVideoExecutionControlRepository implements OneVideoExecutionControlRepository {
  constructor(
    private readonly db: OneVideoExecutionControlTransactionalDatabase,
    private readonly quoteReadinessResolver: MaximumQuoteReadinessResolver = unavailableMaximumQuoteReadinessResolver,
  ) {}

  async observe(scope: TenantScope, publicPlanKey: string, publicSlotKey: string): Promise<OneVideoExecutionControl | undefined> {
    try {
      return await this.db.transaction((tx) => this.observeTransaction(tx, scope, publicPlanKey, publicSlotKey), {
        isolationLevel: "repeatable read", accessMode: "read only",
      });
    } catch (error) {
      if (error instanceof OneVideoExecutionControlError) throw error;
      throw new OneVideoExecutionControlError("UNAVAILABLE");
    }
  }

  private async observeTransaction(tx: OneVideoExecutionControlDatabase, scope: TenantScope,
    publicPlanKey: string, publicSlotKey: string): Promise<OneVideoExecutionControl | undefined> {
    const clock = rows(await tx.execute(sql`SELECT transaction_timestamp() AS observed_at`));
    if (clock.length !== 1) throw new OneVideoExecutionControlError("UNAVAILABLE");
    const databaseNow = date(value(clock[0]!, "observedAt", "observed_at"));

    const plans = rows(await tx.execute(sql`
      SELECT plans.id,plans.public_plan_key,plans.status,plans.planned_slot_count,plans.provider_account_id,
        plans.provider_key,plans.provider_credential_version,plans.source_roster_key,plans.source_roster_digest,plans.plan_digest
      FROM ai_media_daily_plans plans
      WHERE plans.owner_user_id=${scope.ownerUserId} AND plans.workspace_id=${scope.workspaceId}
        AND plans.public_plan_key=${publicPlanKey}
    `));
    if (plans.length === 0) return undefined;
    if (plans.length !== 1) throw new OneVideoExecutionControlError("UNAVAILABLE");
    const plan = plans[0]!; const internalPlanId = text(plan, "id", "id");

    const slotRows = rows(await tx.execute(sql`
      SELECT slots.id,slots.public_slot_key,slots.status,slots.script_variant_id,slots.source_member_key,
        slots.video_number,slots.provider_account_id,slots.provider_key,slots.provider_credential_version,slots.slot_digest,
        scripts.id AS script_id,scripts.title AS script_title,scripts.status AS script_status,
        scripts.current_variant_id,scripts.metadata AS script_metadata,scripts.source_type,scripts.source_item_id,
        sources.id AS source_id,sources.source_type AS source_item_type,sources.title AS source_title,
        sources.content AS source_content,sources.content_hash AS source_content_hash,sources.status AS source_status,
        sources.rights_status,sources.moderation_status,
        influencers.id AS influencer_id,influencers.name AS creator_label,
        accounts.id AS account_id,accounts.provider_key AS account_provider_key,accounts.status AS account_status,
        accounts.credential_status,accounts.credential_version,accounts.credential_expires_at,
        accounts.credential_source,accounts.last_verified_at,accounts.static_credential_verification_id,
        accounts.static_credential_verification_digest,accounts.static_credential_verified_at,
        accounts.static_credential_verification_expires_at,
        avatar.id AS avatar_id,avatar.resource_type AS avatar_type,avatar.display_name AS avatar_label,
        avatar.status AS avatar_status,avatar.synchronized_at AS avatar_synchronized_at,
        avatar.verification_header_id AS avatar_verification_header_id,
        avatar.verification_resource_evidence_id AS avatar_verification_resource_evidence_id,
        avatar.verification_evidence_digest AS avatar_verification_evidence_digest,
        avatar.verified_credential_version AS avatar_verified_credential_version,
        avatar.verified_at AS avatar_verified_at,avatar.verification_expires_at AS avatar_verification_expires_at,
        voice.id AS voice_id,voice.resource_type AS voice_type,voice.display_name AS voice_label,
        voice.status AS voice_status,voice.synchronized_at AS voice_synchronized_at,
        voice.verification_header_id AS voice_verification_header_id,
        voice.verification_resource_evidence_id AS voice_verification_resource_evidence_id,
        voice.verification_evidence_digest AS voice_verification_evidence_digest,
        voice.verified_credential_version AS voice_verified_credential_version,
        voice.verified_at AS voice_verified_at,voice.verification_expires_at AS voice_verification_expires_at,
        governance.id AS governance_id,governance.evidence_digest AS governance_evidence_digest,
        governance.state AS governance_state,governance.valid_from AS governance_valid_from,
        governance.expires_at AS governance_expires_at,governance.revoked_at,
        (governance.influencer_id=slots.influencer_id AND governance.avatar_resource_id=slots.avatar_resource_id
          AND governance.voice_resource_id=slots.voice_resource_id) AS governance_bound
      FROM ai_media_daily_plan_slots slots
      LEFT JOIN ai_media_scripts scripts ON scripts.owner_user_id=slots.owner_user_id
        AND scripts.workspace_id=slots.workspace_id AND scripts.current_variant_id=slots.script_variant_id
      LEFT JOIN ai_media_source_items sources ON sources.owner_user_id=scripts.owner_user_id
        AND sources.workspace_id=scripts.workspace_id AND sources.id=scripts.source_item_id AND sources.source_type=scripts.source_type
      LEFT JOIN ai_media_influencers influencers ON influencers.owner_user_id=slots.owner_user_id
        AND influencers.workspace_id=slots.workspace_id AND influencers.id=slots.influencer_id
      LEFT JOIN ai_media_provider_accounts accounts ON accounts.owner_user_id=slots.owner_user_id
        AND accounts.workspace_id=slots.workspace_id AND accounts.id=slots.provider_account_id AND accounts.provider_key=slots.provider_key
      LEFT JOIN ai_media_provider_resources avatar ON avatar.owner_user_id=slots.owner_user_id
        AND avatar.workspace_id=slots.workspace_id AND avatar.provider_account_id=slots.provider_account_id
        AND avatar.provider_key=slots.provider_key AND avatar.id=slots.avatar_resource_id
      LEFT JOIN ai_media_provider_resources voice ON voice.owner_user_id=slots.owner_user_id
        AND voice.workspace_id=slots.workspace_id AND voice.provider_account_id=slots.provider_account_id
        AND voice.provider_key=slots.provider_key AND voice.id=slots.voice_resource_id
      LEFT JOIN LATERAL (SELECT profile.* FROM ai_media_governance_profiles profile
        WHERE profile.owner_user_id=slots.owner_user_id AND profile.workspace_id=slots.workspace_id
          AND profile.influencer_id=slots.influencer_id ORDER BY profile.version DESC LIMIT 1) governance ON true
      WHERE slots.owner_user_id=${scope.ownerUserId} AND slots.workspace_id=${scope.workspaceId}
        AND slots.daily_plan_id=${internalPlanId} AND slots.public_slot_key=${publicSlotKey}
    `));
    if (slotRows.length === 0) return undefined;
    if (slotRows.length !== 1) throw new OneVideoExecutionControlError("UNAVAILABLE");
    const slot = slotRows[0]!;

    const planSlotRows = rows(await tx.execute(sql`
      SELECT slots.source_member_key,slots.video_number,slots.status FROM ai_media_daily_plan_slots slots
      WHERE slots.owner_user_id=${scope.ownerUserId} AND slots.workspace_id=${scope.workspaceId}
        AND slots.daily_plan_id=${internalPlanId} ORDER BY slots.source_member_key,slots.video_number
      LIMIT 101
    `));
    const variants = rows(await tx.execute(sql`
      SELECT variants.id,variants.version,variants.label,variants.content,variants.status,variants.checksum,variants.metadata
      FROM ai_media_script_variants variants WHERE variants.owner_user_id=${scope.ownerUserId}
        AND variants.workspace_id=${scope.workspaceId} AND variants.script_id=${text(slot, "scriptId", "script_id")}
      ORDER BY variants.version
    `));
    const facts: ApprovedProductionBatchSlotFacts = {
      scope, databaseNow,
      plan: { publicKey: publicPlanKey, status: text(plan, "status", "status"),
        plannedSlotCount: number(plan, "plannedSlotCount", "planned_slot_count") },
      planSlots: planSlotRows.map((row) => ({ sourceMemberKey: text(row, "sourceMemberKey", "source_member_key"),
        videoNumber: number(row, "videoNumber", "video_number"), status: text(row, "status", "status") })),
      slot: { publicKey: publicSlotKey, status: text(slot, "status", "status"),
        scriptVariantId: text(slot, "scriptVariantId", "script_variant_id") },
      script: { id: text(slot, "scriptId", "script_id"), title: text(slot, "scriptTitle", "script_title"),
        status: text(slot, "scriptStatus", "script_status"), currentVariantId: text(slot, "currentVariantId", "current_variant_id"),
        metadata: value(slot, "scriptMetadata", "script_metadata"), sourceType: text(slot, "sourceType", "source_type"),
        sourceItemId: value(slot, "sourceItemId", "source_item_id") == null ? null : text(slot, "sourceItemId", "source_item_id") },
      source: { id: text(slot, "sourceId", "source_id"), type: text(slot, "sourceItemType", "source_item_type"),
        title: text(slot, "sourceTitle", "source_title"), content: text(slot, "sourceContent", "source_content"),
        contentHash: text(slot, "sourceContentHash", "source_content_hash"), status: text(slot, "sourceStatus", "source_status"),
        rightsStatus: text(slot, "rightsStatus", "rights_status"), moderationStatus: text(slot, "moderationStatus", "moderation_status") },
      variants: variants.map((row) => ({ id: text(row, "id", "id"), version: number(row, "version", "version"),
        label: text(row, "label", "label"), content: text(row, "content", "content"), status: text(row, "status", "status"),
        checksum: text(row, "checksum", "checksum"), metadata: value(row, "metadata", "metadata") })),
    };
    const envelope = readProductionBatchEnvelope(facts.script.metadata);
    if (!envelope || envelope.planId !== publicPlanKey || envelope.slotId !== publicSlotKey) {
      throw new OneVideoExecutionControlError("UNAVAILABLE");
    }
    const productionMetadataCurrent = verifyApprovedProductionBatchSlotMetadata(facts);

    const evidenceRows = rows(await tx.execute(sql`
      SELECT attempt.slot_attempt,intent.id AS intent_id,intent.launch_intent_digest,
        slots.provider_account_id,slots.provider_key,slots.provider_credential_version,
        slots.avatar_resource_id,slots.voice_resource_id,slots.script_variant_id,
        variant.checksum AS current_script_variant_checksum,
        (intent.provider_account_id=slots.provider_account_id AND intent.provider_key=slots.provider_key
          AND intent.provider_credential_version=slots.provider_credential_version
          AND intent.script_variant_id=slots.script_variant_id AND intent.script_variant_checksum=variant.checksum
          AND intent.governance_profile_id=governance.id AND intent.governance_evidence_digest=governance.evidence_digest
          AND intent.plan_digest=plans.plan_digest AND intent.slot_digest=slots.slot_digest
          AND intent.source_roster_key=plans.source_roster_key AND intent.source_roster_digest=plans.source_roster_digest
          AND intent.source_member_key=slots.source_member_key) AS intent_current,
        quote.id AS quote_id,quote.decision AS quote_decision,quote.amount_micro_usd AS quote_amount,
        quote.currency AS quote_currency,quote.valid_from AS quote_valid_from,quote.expires_at AS quote_expires_at,
        quote.revision AS quote_revision,quote.evidence_digest AS quote_evidence_digest,
        (quote.launch_intent_id=intent.id AND quote.launch_intent_digest=intent.launch_intent_digest
          AND quote.provider_account_id=slots.provider_account_id AND quote.provider_key=slots.provider_key
          AND quote.provider_credential_version=slots.provider_credential_version
          AND quote.script_variant_id=slots.script_variant_id AND quote.script_variant_checksum=variant.checksum
          AND quote.governance_profile_id=governance.id AND quote.governance_evidence_digest=governance.evidence_digest) AS quote_current,
        human.id AS human_id,human.decision AS human_decision,human.valid_from AS human_valid_from,
        human.expires_at AS human_expires_at,human.revision AS human_revision,
        human.evidence_digest AS human_evidence_digest,
        (human.launch_intent_id=intent.id AND human.launch_intent_digest=intent.launch_intent_digest
          AND human.provider_account_id=slots.provider_account_id AND human.provider_key=slots.provider_key
          AND human.provider_credential_version=slots.provider_credential_version
          AND human.script_variant_id=slots.script_variant_id AND human.script_variant_checksum=variant.checksum
          AND human.governance_profile_id=governance.id AND human.governance_evidence_digest=governance.evidence_digest) AS human_current,
        bridge.id AS approval_bridge_id,bridge.render_spec_digest AS bridge_render_spec_digest,
        bridge.quote_expires_at AS bridge_quote_expires_at,bridge.amount_micro_usd AS bridge_quote_amount,
        bridge.currency AS bridge_quote_currency,bridge.decision AS bridge_decision,
        bridge.approval_binding_digest AS approval_binding_digest,
        (bridge.human_launch_approval_evidence_id=human.id
          AND bridge.human_launch_approval_evidence_revision=human.revision
          AND bridge.human_launch_approval_evidence_digest=human.evidence_digest
          AND bridge.maximum_quote_evidence_id=quote.id
          AND bridge.maximum_quote_evidence_revision=quote.revision
          AND bridge.maximum_quote_evidence_digest=quote.evidence_digest
          AND bridge.launch_subject_digest=human.launch_subject_digest
          AND bridge.launch_subject_digest=quote.launch_subject_digest
          AND bridge.launch_intent_id=intent.id AND bridge.launch_intent_digest=intent.launch_intent_digest
          AND bridge.decision=human.decision AND bridge.maximum_quote_decision='quoted'
          AND bridge.amount_micro_usd=quote.amount_micro_usd AND bridge.currency=quote.currency
          AND bridge.quote_expires_at=quote.expires_at) AS approval_bridge_current
      FROM ai_media_daily_plan_slots slots
      JOIN ai_media_daily_plans plans ON plans.owner_user_id=slots.owner_user_id AND plans.workspace_id=slots.workspace_id
        AND plans.id=slots.daily_plan_id
      LEFT JOIN ai_media_script_variants variant ON variant.owner_user_id=slots.owner_user_id
        AND variant.workspace_id=slots.workspace_id AND variant.id=slots.script_variant_id
      LEFT JOIN LATERAL (SELECT profile.* FROM ai_media_governance_profiles profile
        WHERE profile.owner_user_id=slots.owner_user_id AND profile.workspace_id=slots.workspace_id
          AND profile.influencer_id=slots.influencer_id ORDER BY profile.version DESC LIMIT 1) governance ON true
      CROSS JOIN LATERAL (SELECT COALESCE(MAX(previous.slot_attempt),1) AS slot_attempt
        FROM ai_media_launch_intents previous WHERE previous.owner_user_id=slots.owner_user_id
          AND previous.workspace_id=slots.workspace_id AND previous.daily_plan_slot_id=slots.id) attempt
      LEFT JOIN LATERAL (SELECT candidate.* FROM ai_media_launch_intents candidate
        WHERE candidate.owner_user_id=slots.owner_user_id AND candidate.workspace_id=slots.workspace_id
          AND candidate.daily_plan_slot_id=slots.id AND candidate.slot_attempt=attempt.slot_attempt
        ORDER BY candidate.created_at DESC LIMIT 1) intent ON true
      LEFT JOIN LATERAL (SELECT evidence.* FROM ai_media_launch_evidence evidence
        WHERE evidence.owner_user_id=slots.owner_user_id AND evidence.workspace_id=slots.workspace_id
          AND evidence.daily_plan_slot_id=slots.id AND evidence.slot_attempt=attempt.slot_attempt
          AND evidence.evidence_kind='maximum_quote' ORDER BY evidence.revision DESC LIMIT 1) quote ON true
      LEFT JOIN LATERAL (SELECT evidence.* FROM ai_media_launch_evidence evidence
        WHERE evidence.owner_user_id=slots.owner_user_id AND evidence.workspace_id=slots.workspace_id
          AND evidence.daily_plan_slot_id=slots.id AND evidence.slot_attempt=attempt.slot_attempt
          AND evidence.evidence_kind='human_launch_approval' ORDER BY evidence.revision DESC LIMIT 1) human ON true
      LEFT JOIN LATERAL (SELECT approval.* FROM ai_media_quote_bound_human_approvals approval
        WHERE approval.owner_user_id=slots.owner_user_id AND approval.workspace_id=slots.workspace_id
          AND approval.daily_plan_slot_id=slots.id AND approval.slot_attempt=attempt.slot_attempt
          AND approval.human_launch_approval_evidence_id=human.id
        LIMIT 1) bridge ON true
      WHERE slots.owner_user_id=${scope.ownerUserId} AND slots.workspace_id=${scope.workspaceId}
        AND plans.public_plan_key=${publicPlanKey} AND slots.public_slot_key=${publicSlotKey}
    `));
    if (evidenceRows.length !== 1) throw new OneVideoExecutionControlError("UNAVAILABLE");
    const evidence = evidenceRows[0]!; const slotAttempt = number(evidence, "slotAttempt", "slot_attempt");
    if (!Number.isInteger(slotAttempt) || slotAttempt < 1) throw new OneVideoExecutionControlError("UNAVAILABLE");

    const staticVerificationRows = rows(await tx.execute(sql`
      SELECT header.id AS static_verification_header_id,header.observed_at AS static_verification_observed_at,
        header.expires_at AS static_verification_expires_at,
        avatar.external_resource_id AS avatar_external_resource_id,
        avatar_evidence.provider_resource_external_id_digest AS avatar_external_resource_id_digest,
        voice.external_resource_id AS voice_external_resource_id,
        voice_evidence.provider_resource_external_id_digest AS voice_external_resource_id_digest,
        (accounts.credential_source='static_api_key' AND accounts.status='active' AND accounts.credential_status='active'
          AND accounts.provider_key='heygen' AND accounts.credential_version=slots.provider_credential_version
          AND accounts.credential_version=plans.provider_credential_version
          AND accounts.granted_scopes='[]'::jsonb AND accounts.capabilities='["render_video"]'::jsonb
          AND accounts.static_credential_verification_id=header.id
          AND accounts.static_credential_verification_digest=header.evidence_digest
          AND accounts.static_credential_verified_at=header.observed_at
          AND accounts.static_credential_verification_expires_at=header.expires_at
          AND accounts.last_verified_at=header.observed_at
          AND accounts.credential_expires_at=header.expires_at
          AND header.provider_account_id=accounts.id AND header.provider_key='heygen'
          AND header.provider_credential_version=accounts.credential_version
          AND header.daily_plan_id=plans.id
          AND header.source_roster_key=plans.source_roster_key
          AND header.source_roster_digest=plans.source_roster_digest
          AND header.plan_digest=plans.plan_digest
          AND header.verification_state='verified'
          AND header.observed_at<=${databaseNow}::timestamptz
          AND header.expires_at>${databaseNow}::timestamptz
          AND avatar.status='active' AND avatar.verification_header_id=header.id
          AND avatar.verified_credential_version=header.provider_credential_version
          AND avatar.verification_resource_evidence_id=avatar_evidence.id
          AND avatar.verification_evidence_digest=avatar_evidence.evidence_digest
          AND avatar.verified_at=avatar_evidence.observed_at
          AND avatar.verification_expires_at=avatar_evidence.expires_at
          AND avatar_evidence.observed_at=header.observed_at
          AND avatar_evidence.expires_at=header.expires_at
          AND avatar_evidence.provider_resource_id=avatar.id
          AND avatar_evidence.resource_type='avatar'
          AND avatar_evidence.provider_account_id=accounts.id
          AND avatar_evidence.provider_key='heygen'
          AND avatar_evidence.provider_credential_version=header.provider_credential_version
          AND avatar_evidence.verification_header_id=header.id
          AND avatar_evidence.avatar_look_status='completed'
          AND avatar_evidence.avatar_group_status='completed'
          AND avatar_evidence.avatar_group_consent_status='approved'
          AND avatar_evidence.avatar_group_id_digest<>avatar_evidence.avatar_look_id_digest
          AND avatar_evidence.observed_at<=${databaseNow}::timestamptz
          AND avatar_evidence.expires_at>${databaseNow}::timestamptz
          AND voice.status='active' AND voice.verification_header_id=header.id
          AND voice.verified_credential_version=header.provider_credential_version
          AND voice.verification_resource_evidence_id=voice_evidence.id
          AND voice.verification_evidence_digest=voice_evidence.evidence_digest
          AND voice.verified_at=voice_evidence.observed_at
          AND voice.verification_expires_at=voice_evidence.expires_at
          AND voice_evidence.observed_at=header.observed_at
          AND voice_evidence.expires_at=header.expires_at
          AND voice_evidence.provider_resource_id=voice.id
          AND voice_evidence.resource_type='voice'
          AND voice_evidence.provider_account_id=accounts.id
          AND voice_evidence.provider_key='heygen'
          AND voice_evidence.provider_credential_version=header.provider_credential_version
          AND voice_evidence.verification_header_id=header.id
          AND voice_evidence.voice_id_digest=voice_evidence.provider_resource_external_id_digest
          AND voice_evidence.voice_support_digest IS NOT NULL
          AND length(btrim(voice_evidence.language))>0
          AND voice_evidence.observed_at<=${databaseNow}::timestamptz
          AND voice_evidence.expires_at>${databaseNow}::timestamptz) AS static_verification_current
      FROM ai_media_daily_plan_slots slots
      JOIN ai_media_daily_plans plans ON plans.owner_user_id=slots.owner_user_id AND plans.workspace_id=slots.workspace_id
        AND plans.id=slots.daily_plan_id
      LEFT JOIN ai_media_provider_accounts accounts ON accounts.owner_user_id=slots.owner_user_id
        AND accounts.workspace_id=slots.workspace_id AND accounts.id=slots.provider_account_id
        AND accounts.provider_key=slots.provider_key
      LEFT JOIN ai_media_provider_resources avatar ON avatar.owner_user_id=slots.owner_user_id
        AND avatar.workspace_id=slots.workspace_id AND avatar.provider_account_id=slots.provider_account_id
        AND avatar.provider_key=slots.provider_key AND avatar.id=slots.avatar_resource_id
      LEFT JOIN ai_media_provider_resources voice ON voice.owner_user_id=slots.owner_user_id
        AND voice.workspace_id=slots.workspace_id AND voice.provider_account_id=slots.provider_account_id
        AND voice.provider_key=slots.provider_key AND voice.id=slots.voice_resource_id
      LEFT JOIN ai_media_static_heygen_verification_headers header ON header.owner_user_id=accounts.owner_user_id
        AND header.workspace_id=accounts.workspace_id AND header.id=accounts.static_credential_verification_id
        AND header.provider_account_id=accounts.id AND header.provider_key=accounts.provider_key
        AND header.provider_credential_version=accounts.credential_version
      LEFT JOIN ai_media_static_heygen_resource_verifications avatar_evidence
        ON avatar_evidence.owner_user_id=avatar.owner_user_id AND avatar_evidence.workspace_id=avatar.workspace_id
        AND avatar_evidence.id=avatar.verification_resource_evidence_id
        AND avatar_evidence.verification_header_id=avatar.verification_header_id
        AND avatar_evidence.provider_account_id=avatar.provider_account_id
        AND avatar_evidence.provider_key=avatar.provider_key
        AND avatar_evidence.provider_resource_id=avatar.id
      LEFT JOIN ai_media_static_heygen_resource_verifications voice_evidence
        ON voice_evidence.owner_user_id=voice.owner_user_id AND voice_evidence.workspace_id=voice.workspace_id
        AND voice_evidence.id=voice.verification_resource_evidence_id
        AND voice_evidence.verification_header_id=voice.verification_header_id
        AND voice_evidence.provider_account_id=voice.provider_account_id
        AND voice_evidence.provider_key=voice.provider_key
        AND voice_evidence.provider_resource_id=voice.id
      WHERE slots.owner_user_id=${scope.ownerUserId} AND slots.workspace_id=${scope.workspaceId}
        AND plans.public_plan_key=${publicPlanKey} AND slots.public_slot_key=${publicSlotKey}
    `));
    if (staticVerificationRows.length !== 1) throw new OneVideoExecutionControlError("UNAVAILABLE");
    const staticVerification = staticVerificationRows[0]!;

    const accountPresent = text(slot, "accountId", "account_id").length > 0;
    const resourceShape = text(slot, "avatarId", "avatar_id").length > 0 && text(slot, "voiceId", "voice_id").length > 0
      && text(slot, "avatarType", "avatar_type") === "avatar" && text(slot, "voiceType", "voice_type") === "voice";
    const credentialVersion = number(slot, "providerCredentialVersion", "provider_credential_version");
    const credentialMatches = credentialVersion === number(plan, "providerCredentialVersion", "provider_credential_version")
      && credentialVersion === number(slot, "credentialVersion", "credential_version");
    const credentialExpired = value(slot, "credentialExpiresAt", "credential_expires_at") != null
      && date(value(slot, "credentialExpiresAt", "credential_expires_at")).getTime() <= databaseNow.getTime();
    const resourcesActive = text(slot, "avatarStatus", "avatar_status") === "active"
      && text(slot, "voiceStatus", "voice_status") === "active";
    const bindingState: "current" | "stale" | "invalid" = !accountPresent || !resourceShape || !productionMetadataCurrent
      ? "invalid" : !credentialMatches || credentialExpired || !resourcesActive ? "stale" : "current";

    const accountStatus = text(slot, "accountStatus", "account_status");
    const credentialStatus = text(slot, "credentialStatus", "credential_status");
    const credentialSource = text(slot, "credentialSource", "credential_source");
    const exactNativeResourceIds = sha256(text(staticVerification, "avatarNativeId", "avatar_external_resource_id"))
        === text(staticVerification, "avatarNativeIdDigest", "avatar_external_resource_id_digest")
      && sha256(text(staticVerification, "voiceNativeId", "voice_external_resource_id"))
        === text(staticVerification, "voiceNativeIdDigest", "voice_external_resource_id_digest");
    const staticVerificationProjection: StaticVerificationProjection = bool(staticVerification,
      "staticVerificationCurrent", "static_verification_current") && exactNativeResourceIds ? "verified"
      : text(staticVerification, "staticVerificationHeaderId", "static_verification_header_id") ? "stale" : "missing";
    const verificationState = derivePersistedProviderVerificationState({
      bindingState, credentialSource, accountStatus, credentialStatus, staticVerification: staticVerificationProjection,
    });
    const staticObservedAt = value(staticVerification, "staticVerificationObservedAt", "static_verification_observed_at");
    const staticExpiresAt = value(staticVerification, "staticVerificationExpiresAt", "static_verification_expires_at");
    const fallbackObservedAt = value(slot, "lastVerifiedAt", "last_verified_at");
    const fallbackExpiresAt = value(slot, "credentialExpiresAt", "credential_expires_at");
    const providerObservedAt = staticObservedAt ?? fallbackObservedAt;
    const providerExpiresAt = staticExpiresAt ?? fallbackExpiresAt;
    const providerVerification = {
      state: verificationState,
      ...(providerObservedAt == null ? {} : { observedAt: optionalIso(providerObservedAt) }),
      ...(providerExpiresAt == null ? {} : { expiresAt: optionalIso(providerExpiresAt) }),
    };

    const exactEvidenceBase = bindingState === "current" && verificationState === "verified"
      && productionMetadataCurrent && bool(evidence, "intentCurrent", "intent_current");
    const renderSpecDigest = deriveLaunchRenderSpecDigest({
      providerAccountId: text(evidence, "providerAccountId", "provider_account_id"),
      providerKey: text(evidence, "providerKey", "provider_key"),
      providerCredentialVersion: number(evidence, "providerCredentialVersion", "provider_credential_version"),
      avatarResourceId: text(evidence, "avatarResourceId", "avatar_resource_id"),
      voiceResourceId: text(evidence, "voiceResourceId", "voice_resource_id"),
      scriptVariantId: text(evidence, "scriptVariantId", "script_variant_id"),
      scriptVariantChecksum: text(evidence, "currentScriptVariantChecksum", "current_script_variant_checksum"),
    });
    const quote = this.quoteState(evidence, databaseNow,
      exactEvidenceBase && bool(evidence, "quoteCurrent", "quote_current"), renderSpecDigest);
    const quoteReadiness = deriveQuoteReadiness({
      quoteState: quote.state,
      bindingState,
      verificationState,
      providerKey: text(slot, "providerKey", "provider_key"),
      resolver: this.quoteReadinessResolver,
    });
    const exactApprovalBridge = bool(evidence, "approvalBridgeCurrent", "approval_bridge_current")
      && INTERNAL_UUID.test(text(evidence, "approvalBridgeId", "approval_bridge_id"))
      && SHA256.test(text(evidence, "approvalBindingDigest", "approval_binding_digest"))
      && text(evidence, "bridgeRenderSpecDigest", "bridge_render_spec_digest") === renderSpecDigest
      && text(evidence, "bridgeQuoteAmount", "bridge_quote_amount") === quote.amountMicroUsd
      && text(evidence, "bridgeQuoteCurrency", "bridge_quote_currency") === quote.currency
      && optionalIso(value(evidence, "bridgeQuoteExpiresAt", "bridge_quote_expires_at")) === quote.expiresAt;
    const human = this.humanState(evidence, databaseNow,
      exactEvidenceBase && bool(evidence, "humanCurrent", "human_current") && quote.state === "quoted"
        && exactApprovalBridge, quote);
    const reasonCodes = new Set<OneVideoExecutionControl["execute"]["reasonCodes"][number]>();
    if (bindingState !== "current") reasonCodes.add(bindingState === "stale" ? "binding_stale" : "binding_invalid");
    if (verificationState !== "verified") reasonCodes.add(`provider_verification_${verificationState}` as
      OneVideoExecutionControl["execute"]["reasonCodes"][number]);
    if (quote.state !== "quoted") reasonCodes.add(`maximum_quote_${quote.state}` as
      OneVideoExecutionControl["execute"]["reasonCodes"][number]);
    if (human.state !== "approved") reasonCodes.add(`human_approval_${human.state}` as
      OneVideoExecutionControl["execute"]["reasonCodes"][number]);
    reasonCodes.add("one_shot_executor_not_installed");

    return oneVideoExecutionControlSchema.parse({
      version: 1, source: "postgresql_read_only",
      subject: { planId: publicPlanKey, batchId: envelope.batchId, slotId: publicSlotKey, slotAttempt },
      observedAt: databaseNow.toISOString(),
      selection: {
        selectionKey: opaque("selection", [text(slot, "influencerId", "influencer_id"), text(slot, "avatarId", "avatar_id"),
          text(slot, "voiceId", "voice_id"), text(slot, "scriptVariantId", "script_variant_id")].join("\0")),
        creator: { label: text(slot, "creatorLabel", "creator_label") },
        avatar: { key: opaque("resource", `avatar\0${text(slot, "avatarId", "avatar_id")}`),
          label: text(slot, "avatarLabel", "avatar_label") },
        voice: { key: opaque("resource", `voice\0${text(slot, "voiceId", "voice_id")}`),
          label: text(slot, "voiceLabel", "voice_label") },
      },
      format: { aspectRatio: "9:16", container: "mp4" }, binding: { state: bindingState, credentialVersion },
      providerVerification, maximumQuote: quote, quoteReadiness, humanApproval: human,
      execute: { state: "disabled", postAvailable: false, reasonCodes: [...reasonCodes] },
      effects: { providerCalled: false, secretResolved: false, verificationPerformed: false, quoteRequested: false,
        approvalRecorded: false, reservationCreated: false, renderCreated: false, outboxCreated: false,
        spendCommitted: false, publishingCreated: false },
      authoritativeForAdmission: false, canGenerate: false, spendAuthorized: false,
    });
  }

  private quoteState(row: Row, now: Date, current: boolean, renderSpecDigest: `sha256:${string}`): EvidenceState {
    const id = text(row, "quoteId", "quote_id");
    if (!id) return { state: "missing" };
    const base = { evidenceKey: opaque("evidence", id), observedAt: optionalIso(value(row, "quoteValidFrom", "quote_valid_from")),
      expiresAt: optionalIso(value(row, "quoteExpiresAt", "quote_expires_at")) };
    if (!current) return { state: "stale", ...base };
    const validFrom = date(value(row, "quoteValidFrom", "quote_valid_from"));
    const expires = value(row, "quoteExpiresAt", "quote_expires_at");
    if (validFrom.getTime() > now.getTime()) return { state: "unavailable", ...base };
    if (expires != null && date(expires).getTime() <= now.getTime()) return { state: "expired", ...base };
    if (text(row, "quoteDecision", "quote_decision") !== "quoted") return { state: "declined", ...base };
    const amount = text(row, "quoteAmount", "quote_amount");
    const evidenceDigest = text(row, "quoteEvidenceDigest", "quote_evidence_digest");
    const revision = number(row, "quoteRevision", "quote_revision");
    if (!/^[1-9][0-9]{0,15}$/u.test(amount) || BigInt(amount) > 9_000_000_000_000_000n
      || text(row, "quoteCurrency", "quote_currency") !== "USD" || !INTERNAL_UUID.test(id)
      || !SHA256.test(evidenceDigest) || !Number.isSafeInteger(revision) || revision < 1 || expires == null) {
      return { state: "unavailable" };
    }
    const quoteKey = deriveMaximumQuoteKey({ evidenceId: id,
      evidenceRevision: revision, evidenceDigest: evidenceDigest as `sha256:${string}`,
      amountMicroUsd: amount, currency: "USD", expiresAt: date(expires), renderSpecDigest });
    return { state: "quoted", amountMicroUsd: amount, currency: "USD", quoteKey,
      renderSpecKey: deriveRenderSpecKey(renderSpecDigest), ...base };
  }

  private humanState(row: Row, now: Date, current: boolean, quote: EvidenceState): EvidenceState {
    const id = text(row, "humanId", "human_id");
    if (!id) return { state: "not_requested" };
    const base = { evidenceKey: opaque("evidence", id), observedAt: optionalIso(value(row, "humanValidFrom", "human_valid_from")),
      expiresAt: optionalIso(value(row, "humanExpiresAt", "human_expires_at")) };
    if (!current) return { state: "stale", ...base };
    const validFrom = date(value(row, "humanValidFrom", "human_valid_from"));
    const expires = value(row, "humanExpiresAt", "human_expires_at");
    if (validFrom.getTime() > now.getTime()) return { state: "unavailable", ...base };
    if (expires != null && date(expires).getTime() <= now.getTime()) return { state: "expired", ...base };
    const decision = text(row, "humanDecision", "human_decision");
    if (!['approved', 'rejected', 'revoked'].includes(decision)) return { state: "unavailable" };
    return { state: decision as "approved" | "rejected" | "revoked",
      ...(decision === "approved" ? { approvedQuoteKey: quote.quoteKey, renderSpecKey: quote.renderSpecKey } : {}), ...base };
  }
}
