import { sql, type SQL } from "drizzle-orm";
import {
  sandboxReadinessSchema,
  type SandboxReadiness,
  type SandboxReadinessGate,
} from "../../../shared/ai-media-studio-sandbox-readiness";
import type { TenantScope } from "../core/resource-domain";
import {
  readProductionBatchEnvelope,
  readProductionVariantMetadata,
  verifyApprovedProductionBatchSlotMetadata,
  type ApprovedProductionBatchSlotFacts,
} from "../production-batches/metadata-integrity";
import { SandboxReadinessError, type SandboxReadinessRepository } from "./sandbox-readiness-contracts";

type ExecuteResult = { rows?: unknown[] } | unknown[];
export type SandboxReadinessDatabase = { execute(query: SQL): Promise<ExecuteResult> };
export type SandboxReadinessTransactionalDatabase = SandboxReadinessDatabase & {
  transaction<T>(callback: (tx: SandboxReadinessDatabase) => Promise<T>, config?: Readonly<{
    isolationLevel?: "repeatable read"; accessMode?: "read only";
  }>): Promise<T>;
};
type Row = Record<string, unknown>;

const rows = (result: ExecuteResult): Row[] => (Array.isArray(result) ? result : result.rows ?? []) as Row[];
const value = (row: Row, camel: string, snake: string): unknown => row[camel] ?? row[snake];
const text = (row: Row, camel: string, snake: string): string => String(value(row, camel, snake) ?? "");
const bool = (row: Row, camel: string, snake: string): boolean => value(row, camel, snake) === true;
const number = (row: Row, camel: string, snake: string): number => Number(value(row, camel, snake));
const date = (raw: unknown): Date => {
  const parsed = raw instanceof Date ? raw : new Date(String(raw));
  if (!Number.isFinite(parsed.getTime())) throw new SandboxReadinessError("UNAVAILABLE");
  return parsed;
};

function gate(
  code: SandboxReadinessGate["code"],
  passed: boolean,
  reasonCode: Exclude<SandboxReadinessGate["reasonCode"], "ready" | "external_setup_required">,
  nextActionCode: Exclude<SandboxReadinessGate["nextActionCode"], "none" | "complete_external_requirements">,
): SandboxReadinessGate {
  return passed ? { code, state: "passed", reasonCode: "ready", nextActionCode: "none" }
    : { code, state: "blocked", reasonCode, nextActionCode };
}

/**
 * Observation-only adapter for a single approved slot. It has no provider,
 * vault, authority, reservation, rendering, or outbox dependency.
 */
export class DrizzleSandboxReadinessRepository implements SandboxReadinessRepository {
  constructor(private readonly db: SandboxReadinessTransactionalDatabase) {}

  async observe(scope: TenantScope, publicPlanKey: string, publicSlotKey: string): Promise<SandboxReadiness | undefined> {
    try {
      return await this.db.transaction((tx) => this.observeTransaction(tx, scope, publicPlanKey, publicSlotKey), {
        isolationLevel: "repeatable read", accessMode: "read only",
      });
    } catch (error) {
      if (error instanceof SandboxReadinessError) throw error;
      throw new SandboxReadinessError("UNAVAILABLE");
    }
  }

  private async observeTransaction(
    tx: SandboxReadinessDatabase,
    scope: TenantScope,
    publicPlanKey: string,
    publicSlotKey: string,
  ): Promise<SandboxReadiness | undefined> {
    const clock = rows(await tx.execute(sql`SELECT transaction_timestamp() AS observed_at`));
    if (clock.length !== 1) throw new SandboxReadinessError("UNAVAILABLE");
    const databaseNow = date(value(clock[0], "observedAt", "observed_at"));

    const plans = rows(await tx.execute(sql`
      SELECT plans.id,plans.public_plan_key,plans.status,plans.planned_slot_count
      FROM ai_media_daily_plans plans
      WHERE plans.owner_user_id=${scope.ownerUserId} AND plans.workspace_id=${scope.workspaceId}
        AND plans.public_plan_key=${publicPlanKey}
    `));
    if (plans.length === 0) return undefined;
    if (plans.length !== 1) throw new SandboxReadinessError("UNAVAILABLE");
    const plan = plans[0];
    const internalPlanId = text(plan, "id", "id");

    const slotRows = rows(await tx.execute(sql`
      SELECT slots.id,slots.public_slot_key,slots.status,slots.script_variant_id,slots.source_member_key,
        slots.video_number,scripts.id AS script_id,scripts.title AS script_title,scripts.status AS script_status,
        scripts.current_variant_id,scripts.metadata AS script_metadata,scripts.source_type,scripts.source_item_id,
        sources.id AS source_id,sources.source_type AS source_item_type,sources.title AS source_title,
        sources.content AS source_content,sources.content_hash AS source_content_hash,sources.status AS source_status,
        sources.rights_status,sources.moderation_status,influencers.name AS creator_name,
        (influencers.status='active' AND influencers.archived_at IS NULL) AS influencer_ready,
        (accounts.status IN ('active','connected') AND accounts.credential_status='active'
          AND accounts.credential_version=slots.provider_credential_version
          AND (accounts.credential_expires_at IS NULL OR accounts.credential_expires_at>transaction_timestamp())) AS account_ready,
        (avatar.resource_type='avatar' AND avatar.status='active'
          AND voice.resource_type='voice' AND voice.status='active') AS resources_ready,
        governance.state AS governance_state,governance.valid_from AS governance_valid_from,
        governance.expires_at AS governance_expires_at,governance.revoked_at,
        (governance.influencer_id=slots.influencer_id
          AND governance.avatar_resource_id=slots.avatar_resource_id
          AND governance.voice_resource_id=slots.voice_resource_id) AS governance_bound,
        (governance.allowed_uses ? 'internal_preview') AS governance_use_allowed
      FROM ai_media_daily_plan_slots slots
      LEFT JOIN ai_media_scripts scripts ON scripts.owner_user_id=slots.owner_user_id
        AND scripts.workspace_id=slots.workspace_id AND scripts.current_variant_id=slots.script_variant_id
      LEFT JOIN ai_media_source_items sources ON sources.owner_user_id=scripts.owner_user_id
        AND sources.workspace_id=scripts.workspace_id AND sources.id=scripts.source_item_id
        AND sources.source_type=scripts.source_type
      LEFT JOIN ai_media_influencers influencers ON influencers.owner_user_id=slots.owner_user_id
        AND influencers.workspace_id=slots.workspace_id AND influencers.id=slots.influencer_id
      LEFT JOIN ai_media_provider_accounts accounts ON accounts.owner_user_id=slots.owner_user_id
        AND accounts.workspace_id=slots.workspace_id AND accounts.id=slots.provider_account_id
        AND accounts.provider_key=slots.provider_key
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
    if (slotRows.length !== 1) throw new SandboxReadinessError("UNAVAILABLE");
    const slot = slotRows[0];

    const planSlotRows = rows(await tx.execute(sql`
      SELECT slots.source_member_key,slots.video_number,slots.status
      FROM ai_media_daily_plan_slots slots
      WHERE slots.owner_user_id=${scope.ownerUserId} AND slots.workspace_id=${scope.workspaceId}
        AND slots.daily_plan_id=${internalPlanId}
      ORDER BY slots.source_member_key,slots.video_number
    `));
    const variants = rows(await tx.execute(sql`
      SELECT variants.id,variants.version,variants.label,variants.content,variants.status,
        variants.checksum,variants.metadata
      FROM ai_media_script_variants variants
      WHERE variants.owner_user_id=${scope.ownerUserId} AND variants.workspace_id=${scope.workspaceId}
        AND variants.script_id=${text(slot, "scriptId", "script_id")}
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
    if (!verifyApprovedProductionBatchSlotMetadata(facts)) throw new SandboxReadinessError("UNAVAILABLE");
    const envelope = readProductionBatchEnvelope(facts.script.metadata);
    const selected = [...facts.variants].sort((left, right) => left.version - right.version)[0];
    const verified = envelope && selected ? readProductionVariantMetadata(selected.metadata, envelope, 0) : undefined;
    if (!envelope || !verified) throw new SandboxReadinessError("UNAVAILABLE");

    const influencerReady = bool(slot, "influencerReady", "influencer_ready");
    const providerReady = bool(slot, "accountReady", "account_ready") && bool(slot, "resourcesReady", "resources_ready");
    const governancePresent = value(slot, "governanceState", "governance_state") != null;
    const governanceReady = governancePresent && value(slot, "governanceState", "governance_state") === "active"
      && value(slot, "revokedAt", "revoked_at") == null && bool(slot, "governanceBound", "governance_bound")
      && bool(slot, "governanceUseAllowed", "governance_use_allowed")
      && date(value(slot, "governanceValidFrom", "governance_valid_from")).getTime() <= databaseNow.getTime()
      && date(value(slot, "governanceExpiresAt", "governance_expires_at")).getTime() > databaseNow.getTime();
    const gates: SandboxReadinessGate[] = [
      gate("batch_approval", true, "slot_binding_invalid", "configure_provider"),
      gate("slot_binding", influencerReady, "slot_binding_invalid", "configure_provider"),
      gate("source_eligibility", true, "slot_binding_invalid", "configure_provider"),
      gate("provider_binding_local", providerReady, "provider_binding_invalid", "configure_provider"),
      gate("governance_coverage", governanceReady, governancePresent ? "governance_invalid" : "governance_missing", "record_governance"),
      { code: "external_requirements", state: "pending_external", reasonCode: "external_setup_required",
        nextActionCode: "complete_external_requirements" },
    ];
    const passed = gates.filter((entry) => entry.state === "passed").length;
    const blocked = gates.filter((entry) => entry.state === "blocked").length;
    return sandboxReadinessSchema.parse({
      version: 1, source: "derived_read_only", subject: { planId: publicPlanKey, batchId: envelope.batchId, slotId: publicSlotKey },
      observedAt: databaseNow.toISOString(), status: blocked === 0 ? "locally_ready_for_external_sandbox" : "blocked",
      format: { aspectRatio: "9:16", orientation: "vertical" },
      preview: { creatorName: text(slot, "creatorName", "creator_name"), videoNumber: number(slot, "videoNumber", "video_number"),
        source: { title: facts.source.title, category: facts.source.type },
        script: { key: envelope.scriptKey, title: verified.creative.title, angle: verified.creative.angle,
          hook: verified.creative.hook, script: verified.creative.script, cta: verified.creative.cta,
          caption: verified.creative.caption, hashtags: verified.creative.hashtags, seoKeywords: verified.creative.seoKeywords } },
      canGenerate: false, sandboxExecutionAllowed: false, spendAuthorized: false, noSpend: true,
      authoritativeForAdmission: false,
      effects: { intentCreated: false, evidenceCreated: false, snapshotCreated: false, reservationCreated: false,
        renderCreated: false, outboxCreated: false, providerCalled: false },
      summary: { totalGates: 6, passedGates: passed, blockedGates: blocked, pendingExternalGates: 1 }, gates,
      externalRequirements: [
        { code: "provider_live_verification", state: "required_external" },
        { code: "maximum_quote", state: "required_external" },
        { code: "human_sandbox_cost_approval", state: "required_external" },
        { code: "owned_storage_readiness", state: "required_external" },
        { code: "callback_readiness", state: "required_external" },
      ],
    });
  }
}
