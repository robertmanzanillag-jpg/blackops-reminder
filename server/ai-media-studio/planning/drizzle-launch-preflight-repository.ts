import { createHash } from "node:crypto";
import { sql, type SQL } from "drizzle-orm";
import {
  launchPreflightGateCodes,
  launchPreflightSchema,
  type LaunchPreflight,
  type LaunchPreflightGate,
} from "../../../shared/ai-media-studio-launch-preflight";
import type { TenantScope } from "../core/resource-domain";
import { readProductionBatchEnvelope, verifyApprovedProductionBatchSlotMetadata } from "../production-batches/metadata-integrity";
import { LaunchPreflightError, type LaunchPreflightRepository } from "./launch-preflight-contracts";

type ExecuteResult = { rows?: unknown[] } | unknown[];
export type LaunchPreflightDatabase = { execute(query: SQL): Promise<ExecuteResult> };
export type LaunchPreflightTransactionalDatabase = LaunchPreflightDatabase & {
  transaction<T>(callback: (tx: LaunchPreflightDatabase) => Promise<T>, config?: Readonly<{
    isolationLevel?: "repeatable read"; accessMode?: "read only";
  }>): Promise<T>;
};
type Row = Record<string, unknown>;

const rows = (result: ExecuteResult): Row[] => (Array.isArray(result) ? result : result.rows ?? []) as Row[];
const value = (row: Row, camel: string, snake: string): unknown => row[camel] ?? row[snake];
const count = (row: Row | undefined, camel: string, snake = camel): number => {
  const parsed = Number(row ? value(row, camel, snake) : 0);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : 0;
};
const bool = (row: Row | undefined, camel: string, snake = camel): boolean => value(row ?? {}, camel, snake) === true;
const instant = (raw: unknown): Date => {
  const parsed = raw instanceof Date ? raw : new Date(String(raw));
  if (!Number.isFinite(parsed.getTime())) throw new LaunchPreflightError("UNAVAILABLE");
  return parsed;
};

type GateInput = Pick<LaunchPreflightGate, "code" | "state" | "reasonCode" | "nextActionCode"> & { readySlots: number };

function gate(requiredSlots: number, input: GateInput): LaunchPreflightGate {
  return { ...input, readySlots: Math.min(requiredSlots, input.readySlots), requiredSlots };
}

function blocked(code: LaunchPreflightGate["code"], readySlots: number,
  reasonCode: Exclude<LaunchPreflightGate["reasonCode"], "ready">,
  nextActionCode: Exclude<LaunchPreflightGate["nextActionCode"], "none">,
  state: LaunchPreflightGate["state"] = "blocked"): GateInput {
  return { code, readySlots, state, reasonCode, nextActionCode };
}

function passed(code: LaunchPreflightGate["code"], requiredSlots: number): GateInput {
  return { code, readySlots: requiredSlots, state: "passed", reasonCode: "ready", nextActionCode: "none" };
}

/**
 * Read-only reporting adapter. It deliberately cannot mint authority, reserve
 * money, enqueue work, or reach a provider. Every database read is tenant
 * scoped and shares one repeatable-read/read-only snapshot and DB clock.
 */
export class DrizzleLaunchPreflightRepository implements LaunchPreflightRepository {
  constructor(private readonly db: LaunchPreflightTransactionalDatabase) {}

  async observe(scope: TenantScope, publicPlanKey: string): Promise<LaunchPreflight | undefined> {
    try {
      return await this.db.transaction(async (tx) => this.observeTransaction(tx, scope, publicPlanKey), {
        isolationLevel: "repeatable read", accessMode: "read only",
      });
    } catch (error) {
      if (error instanceof LaunchPreflightError) throw error;
      throw new LaunchPreflightError("UNAVAILABLE");
    }
  }

  private async observeTransaction(tx: LaunchPreflightDatabase, scope: TenantScope, publicPlanKey: string): Promise<LaunchPreflight | undefined> {
    const clockRows = rows(await tx.execute(sql`SELECT transaction_timestamp() AS observed_at`));
    if (clockRows.length !== 1) throw new LaunchPreflightError("UNAVAILABLE");
    const databaseNow = instant(value(clockRows[0], "observedAt", "observed_at"));

    const planRows = rows(await tx.execute(sql`
      SELECT plans.id,plans.public_plan_key,plans.status,plans.plan_date,plans.accounting_time_zone,
        plans.planned_slot_count,plans.provider_account_id,plans.provider_key,plans.provider_credential_version,
        plans.plan_digest,plans.source_roster_key,plans.source_roster_digest,
        (plans.plan_date=(transaction_timestamp() AT TIME ZONE plans.accounting_time_zone)::date) AS plan_in_window
      FROM ai_media_daily_plans plans
      WHERE plans.owner_user_id=${scope.ownerUserId} AND plans.workspace_id=${scope.workspaceId}
        AND plans.public_plan_key=${publicPlanKey}
    `));
    if (planRows.length === 0) return undefined;
    if (planRows.length !== 1) throw new LaunchPreflightError("UNAVAILABLE");
    const plan = planRows[0];
    const internalPlanId = String(value(plan, "id", "id"));

    const slotRows = rows(await tx.execute(sql`
      SELECT slots.id,slots.public_slot_key,slots.status,slots.script_variant_id,slots.influencer_id,
        slots.avatar_resource_id,slots.voice_resource_id,slots.source_member_key,slots.video_number,
        scripts.id AS script_id,scripts.title AS script_title,scripts.status AS script_status,
        scripts.current_variant_id,scripts.metadata AS script_metadata,scripts.source_type,scripts.source_item_id,
        sources.id AS source_id,sources.source_type AS source_item_type,sources.title AS source_title,
        sources.content AS source_content,sources.content_hash AS source_content_hash,
        sources.status AS source_status,sources.rights_status,sources.moderation_status,
        (influencers.status='active' AND influencers.archived_at IS NULL) AS influencer_ready,
        (accounts.status IN ('active','connected') AND accounts.credential_status='active'
          AND accounts.credential_version=slots.provider_credential_version
          AND (accounts.credential_expires_at IS NULL OR accounts.credential_expires_at>transaction_timestamp())) AS account_ready,
        (avatar.resource_type='avatar' AND avatar.status='active'
          AND voice.resource_type='voice' AND voice.status='active') AS resources_ready
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
      WHERE slots.owner_user_id=${scope.ownerUserId} AND slots.workspace_id=${scope.workspaceId}
        AND slots.daily_plan_id=${internalPlanId}
      ORDER BY slots.public_slot_key
    `));
    const variantRows = rows(await tx.execute(sql`
      SELECT variants.id,variants.script_id,variants.version,variants.label,variants.content,
        variants.status,variants.checksum,variants.metadata
      FROM ai_media_script_variants variants
      JOIN ai_media_scripts scripts ON scripts.owner_user_id=variants.owner_user_id
        AND scripts.workspace_id=variants.workspace_id AND scripts.id=variants.script_id
      JOIN ai_media_daily_plan_slots slots ON slots.owner_user_id=scripts.owner_user_id
        AND slots.workspace_id=scripts.workspace_id AND slots.script_variant_id=scripts.current_variant_id
        AND slots.daily_plan_id=${internalPlanId}
      WHERE variants.owner_user_id=${scope.ownerUserId} AND variants.workspace_id=${scope.workspaceId}
      ORDER BY variants.script_id,variants.version
    `));

    const authorityRows = rows(await tx.execute(sql`
      SELECT slots.id AS slot_id,
        COALESCE((SELECT MAX(previous.attempt)+1 FROM ai_media_budget_reservations previous
          WHERE previous.owner_user_id=slots.owner_user_id AND previous.workspace_id=slots.workspace_id
            AND previous.daily_plan_slot_id=slots.id),1) AS slot_attempt,
        governance.state AS governance_state,governance.valid_from AS governance_valid_from,
        governance.expires_at AS governance_expires_at,governance.revoked_at,
        governance.influencer_id=slots.influencer_id AND governance.avatar_resource_id=slots.avatar_resource_id
          AND governance.voice_resource_id=slots.voice_resource_id AS governance_bound,
        intents.id IS NOT NULL AS intent_present,
        intents.daily_plan_id=slots.daily_plan_id AND intents.provider_account_id=slots.provider_account_id AND intents.provider_key=slots.provider_key
          AND intents.provider_credential_version=slots.provider_credential_version
          AND intents.plan_digest=${String(value(plan, "planDigest", "plan_digest"))}
          AND intents.slot_digest=slots.slot_digest AND intents.source_roster_key=${String(value(plan, "sourceRosterKey", "source_roster_key"))}
          AND intents.source_roster_digest=${String(value(plan, "sourceRosterDigest", "source_roster_digest"))}
          AND intents.source_member_key=slots.source_member_key AND intents.script_variant_id=slots.script_variant_id
          AND intents.script_variant_checksum=variant.checksum AND intents.script_id=scripts.id
          AND intents.source_type=scripts.source_type AND intents.source_item_id IS NOT DISTINCT FROM scripts.source_item_id
          AND intents.source_content_hash IS NOT DISTINCT FROM sources.content_hash
          AND intents.governance_profile_id=governance.id AND intents.governance_evidence_digest=governance.evidence_digest
          AND governance.allowed_uses ? intents.governance_use
          AND (governance.territories ? intents.governance_territory OR governance.territories ? 'WORLDWIDE') AS intent_current,
        content.decision AS content_decision,content.valid_from AS content_valid_from,content.expires_at AS content_expires_at,
        (content.provider_account_id,content.provider_key,content.provider_credential_version,content.script_variant_id,
          content.script_variant_checksum,content.governance_profile_id,content.governance_evidence_digest,
          content.governance_use,content.governance_territory,content.content_country,content.launch_subject_digest,
          content.launch_intent_id,content.launch_intent_digest)=(intents.provider_account_id,intents.provider_key,
          intents.provider_credential_version,intents.script_variant_id,intents.script_variant_checksum,
          intents.governance_profile_id,intents.governance_evidence_digest,intents.governance_use,
          intents.governance_territory,intents.content_country,intents.launch_subject_digest,intents.id,intents.launch_intent_digest)
          AS content_current,
        human.decision AS human_decision,human.valid_from AS human_valid_from,human.expires_at AS human_expires_at,
        (human.provider_account_id,human.provider_key,human.provider_credential_version,human.script_variant_id,
          human.script_variant_checksum,human.governance_profile_id,human.governance_evidence_digest,human.launch_subject_digest,
          human.launch_intent_id,human.launch_intent_digest)=(intents.provider_account_id,intents.provider_key,
          intents.provider_credential_version,intents.script_variant_id,intents.script_variant_checksum,
          intents.governance_profile_id,intents.governance_evidence_digest,intents.launch_subject_digest,intents.id,intents.launch_intent_digest)
          AS human_current,
        sandbox.decision AS sandbox_decision,sandbox.valid_from AS sandbox_valid_from,sandbox.expires_at AS sandbox_expires_at,
        (sandbox.provider_account_id,sandbox.provider_key,sandbox.provider_credential_version,sandbox.script_variant_id,
          sandbox.script_variant_checksum,sandbox.governance_profile_id,sandbox.governance_evidence_digest,sandbox.launch_subject_digest,
          sandbox.launch_intent_id,sandbox.launch_intent_digest)=(intents.provider_account_id,intents.provider_key,
          intents.provider_credential_version,intents.script_variant_id,intents.script_variant_checksum,
          intents.governance_profile_id,intents.governance_evidence_digest,intents.launch_subject_digest,intents.id,intents.launch_intent_digest)
          AS sandbox_current,
        sandbox.source_kind AS sandbox_source_kind,sandbox.source_attestation_id AS sandbox_attestation,
        quote.decision AS quote_decision,quote.valid_from AS quote_valid_from,quote.expires_at AS quote_expires_at,
        (quote.provider_account_id,quote.provider_key,quote.provider_credential_version,quote.script_variant_id,
          quote.script_variant_checksum,quote.governance_profile_id,quote.governance_evidence_digest,quote.launch_subject_digest,
          quote.launch_intent_id,quote.launch_intent_digest)=(intents.provider_account_id,intents.provider_key,
          intents.provider_credential_version,intents.script_variant_id,intents.script_variant_checksum,
          intents.governance_profile_id,intents.governance_evidence_digest,intents.launch_subject_digest,intents.id,intents.launch_intent_digest)
          AS quote_current,
        quote.amount_micro_usd AS quote_amount,quote.source_kind AS quote_source_kind,
        quote.source_attestation_id AS quote_attestation,
        snapshot.id IS NOT NULL AS snapshot_present,snapshot.valid_from AS snapshot_valid_from,snapshot.expires_at AS snapshot_expires_at,
        (snapshot.launch_intent_id=intents.id AND snapshot.launch_intent_digest=intents.launch_intent_digest
          AND snapshot.script_variant_id=slots.script_variant_id AND snapshot.script_variant_checksum=variant.checksum
          AND snapshot.governance_profile_id=governance.id AND snapshot.governance_evidence_digest=governance.evidence_digest
          AND snapshot.content_approval_evidence_id=content.id AND snapshot.content_approval_evidence_digest=content.evidence_digest
          AND snapshot.human_launch_approval_evidence_id=human.id AND snapshot.human_launch_approval_evidence_digest=human.evidence_digest
          AND snapshot.sandbox_evidence_id=sandbox.id AND snapshot.sandbox_evidence_digest=sandbox.evidence_digest
          AND snapshot.maximum_quote_evidence_id=quote.id AND snapshot.maximum_quote_evidence_digest=quote.evidence_digest
          AND snapshot.policy_revision_id=policy.id AND snapshot.policy_revision=policy.revision
          AND snapshot.policy_digest=policy.policy_digest AND snapshot.kill_switch_revision_id=kill.id
          AND snapshot.kill_switch_revision=kill.revision AND snapshot.kill_switch_evidence_digest=kill.evidence_digest
          AND snapshot.maximum_quote_micro_usd=quote.amount_micro_usd AND snapshot.currency=quote.currency) AS snapshot_current
      FROM ai_media_daily_plan_slots slots
      JOIN ai_media_daily_plans exact_plan ON exact_plan.owner_user_id=slots.owner_user_id
        AND exact_plan.workspace_id=slots.workspace_id AND exact_plan.id=slots.daily_plan_id
      LEFT JOIN ai_media_scripts scripts ON scripts.owner_user_id=slots.owner_user_id
        AND scripts.workspace_id=slots.workspace_id AND scripts.current_variant_id=slots.script_variant_id
      LEFT JOIN ai_media_script_variants variant ON variant.owner_user_id=slots.owner_user_id
        AND variant.workspace_id=slots.workspace_id AND variant.id=slots.script_variant_id
      LEFT JOIN ai_media_source_items sources ON sources.owner_user_id=scripts.owner_user_id
        AND sources.workspace_id=scripts.workspace_id AND sources.id=scripts.source_item_id
        AND sources.source_type=scripts.source_type
      LEFT JOIN LATERAL (SELECT profile.* FROM ai_media_governance_profiles profile
        WHERE profile.owner_user_id=slots.owner_user_id AND profile.workspace_id=slots.workspace_id
          AND profile.influencer_id=slots.influencer_id ORDER BY profile.version DESC LIMIT 1) governance ON true
      LEFT JOIN LATERAL (SELECT intent.* FROM ai_media_launch_intents intent
        WHERE intent.owner_user_id=slots.owner_user_id AND intent.workspace_id=slots.workspace_id
          AND intent.daily_plan_slot_id=slots.id
          AND intent.slot_attempt=COALESCE((SELECT MAX(previous.attempt)+1 FROM ai_media_budget_reservations previous
            WHERE previous.owner_user_id=slots.owner_user_id AND previous.workspace_id=slots.workspace_id
              AND previous.daily_plan_slot_id=slots.id),1)
        ORDER BY intent.created_at DESC LIMIT 1) intents ON true
      LEFT JOIN LATERAL (SELECT evidence.* FROM ai_media_launch_evidence evidence
        WHERE evidence.owner_user_id=slots.owner_user_id AND evidence.workspace_id=slots.workspace_id
          AND evidence.daily_plan_slot_id=slots.id AND evidence.slot_attempt=intents.slot_attempt
          AND evidence.evidence_kind='content_approval' ORDER BY evidence.revision DESC LIMIT 1) content ON true
      LEFT JOIN LATERAL (SELECT evidence.* FROM ai_media_launch_evidence evidence
        WHERE evidence.owner_user_id=slots.owner_user_id AND evidence.workspace_id=slots.workspace_id
          AND evidence.daily_plan_slot_id=slots.id AND evidence.slot_attempt=intents.slot_attempt
          AND evidence.evidence_kind='human_launch_approval' ORDER BY evidence.revision DESC LIMIT 1) human ON true
      LEFT JOIN LATERAL (SELECT evidence.* FROM ai_media_launch_evidence evidence
        WHERE evidence.owner_user_id=slots.owner_user_id AND evidence.workspace_id=slots.workspace_id
          AND evidence.daily_plan_slot_id=slots.id AND evidence.slot_attempt=intents.slot_attempt
          AND evidence.evidence_kind='sandbox_proof' ORDER BY evidence.revision DESC LIMIT 1) sandbox ON true
      LEFT JOIN LATERAL (SELECT evidence.* FROM ai_media_launch_evidence evidence
        WHERE evidence.owner_user_id=slots.owner_user_id AND evidence.workspace_id=slots.workspace_id
          AND evidence.daily_plan_slot_id=slots.id AND evidence.slot_attempt=intents.slot_attempt
          AND evidence.evidence_kind='maximum_quote' ORDER BY evidence.revision DESC LIMIT 1) quote ON true
      LEFT JOIN LATERAL (SELECT revisions.* FROM ai_media_admission_policy_revisions revisions
        WHERE revisions.owner_user_id=slots.owner_user_id AND revisions.workspace_id=slots.workspace_id
        ORDER BY revisions.revision DESC LIMIT 1) policy ON true
      LEFT JOIN LATERAL (SELECT revisions.* FROM ai_media_kill_switch_revisions revisions
        WHERE revisions.owner_user_id=slots.owner_user_id AND revisions.workspace_id=slots.workspace_id
        ORDER BY revisions.revision DESC LIMIT 1) kill ON true
      LEFT JOIN LATERAL (SELECT authority.* FROM ai_media_launch_authority_snapshots authority
        WHERE authority.owner_user_id=slots.owner_user_id AND authority.workspace_id=slots.workspace_id
          AND authority.daily_plan_slot_id=slots.id AND authority.slot_attempt=intents.slot_attempt
          AND authority.provider_account_id=intents.provider_account_id AND authority.provider_key=intents.provider_key
          AND authority.provider_credential_version=intents.provider_credential_version
        ORDER BY authority.created_at DESC LIMIT 1) snapshot ON true
      WHERE slots.owner_user_id=${scope.ownerUserId} AND slots.workspace_id=${scope.workspaceId}
        AND slots.daily_plan_id=${internalPlanId}
      ORDER BY slots.id
    `));

    const policyRows = rows(await tx.execute(sql`
      SELECT policy.state AS policy_state,policy.valid_from AS policy_valid_from,policy.expires_at AS policy_expires_at,
        policy.daily_budget_micro_usd,policy.total_concurrency,policy.provider_concurrency,policy.tenant_concurrency,
        kill.active AS kill_active,kill.valid_from AS kill_valid_from,kill.expires_at AS kill_expires_at
      FROM (SELECT revisions.* FROM ai_media_admission_policy_revisions revisions
        WHERE revisions.owner_user_id=${scope.ownerUserId} AND revisions.workspace_id=${scope.workspaceId}
        ORDER BY revisions.revision DESC LIMIT 1) policy
      LEFT JOIN LATERAL (SELECT revisions.* FROM ai_media_kill_switch_revisions revisions
        WHERE revisions.owner_user_id=${scope.ownerUserId} AND revisions.workspace_id=${scope.workspaceId}
        ORDER BY revisions.revision DESC LIMIT 1) kill ON true
    `));
    const capacityRows = rows(await tx.execute(sql`
      SELECT bucket.id IS NOT NULL AS bucket_present,bucket.limit_micro_usd,bucket.reserved_micro_usd,
        bucket.committed_micro_usd,
        (SELECT COUNT(*) FROM ai_media_budget_reservations active
          WHERE active.state='committed'
            OR (active.state='reserved' AND active.expires_at>transaction_timestamp())) AS total_active,
        (SELECT COUNT(*) FROM ai_media_budget_reservations active
          WHERE active.owner_user_id=${scope.ownerUserId} AND active.workspace_id=${scope.workspaceId}
            AND (active.state='committed'
              OR (active.state='reserved' AND active.expires_at>transaction_timestamp()))) AS tenant_active,
        (SELECT COUNT(*) FROM ai_media_budget_reservations active
          WHERE active.provider_key=${String(value(plan, "providerKey", "provider_key"))}
            AND (active.state='committed'
              OR (active.state='reserved' AND active.expires_at>transaction_timestamp()))) AS provider_active
      FROM (SELECT 1) seed
      LEFT JOIN ai_media_budget_buckets bucket ON bucket.owner_user_id=${scope.ownerUserId}
        AND bucket.workspace_id=${scope.workspaceId} AND bucket.budget_date=${String(value(plan, "planDate", "plan_date"))}
        AND bucket.accounting_time_zone=${String(value(plan, "accountingTimeZone", "accounting_time_zone"))}
        AND bucket.currency='USD'
        AND bucket.policy_version=(SELECT revisions.revision FROM ai_media_admission_policy_revisions revisions
          WHERE revisions.owner_user_id=${scope.ownerUserId} AND revisions.workspace_id=${scope.workspaceId}
          ORDER BY revisions.revision DESC LIMIT 1)
        AND bucket.policy_digest=(SELECT revisions.policy_digest FROM ai_media_admission_policy_revisions revisions
          WHERE revisions.owner_user_id=${scope.ownerUserId} AND revisions.workspace_id=${scope.workspaceId}
          ORDER BY revisions.revision DESC LIMIT 1)
        AND bucket.limit_micro_usd=(SELECT revisions.daily_budget_micro_usd FROM ai_media_admission_policy_revisions revisions
          WHERE revisions.owner_user_id=${scope.ownerUserId} AND revisions.workspace_id=${scope.workspaceId}
          ORDER BY revisions.revision DESC LIMIT 1)
    `));

    return this.derive(scope, publicPlanKey, databaseNow, plan, slotRows, variantRows, authorityRows, policyRows, capacityRows);
  }

  private derive(scope: TenantScope, publicPlanKey: string, now: Date, plan: Row, slots: Row[], variants: Row[],
    authority: Row[], policies: Row[], capacity: Row[]): LaunchPreflight {
    const required = count(plan, "plannedSlotCount", "planned_slot_count");
    const influencerCounts = new Map<string, number>();
    for (const slot of slots) {
      const id = String(value(slot, "influencerId", "influencer_id"));
      influencerCounts.set(id, (influencerCounts.get(id) ?? 0) + 1);
    }
    const avatarCount = influencerCounts.size;
    const exactShape = required === slots.length && required === avatarCount * 10
      && avatarCount >= 5 && avatarCount <= 10
      && [...influencerCounts.values()].every((amount) => amount === 10);

    const variantsByScript = new Map<string, Row[]>();
    for (const variant of variants) {
      const id = String(value(variant, "scriptId", "script_id"));
      variantsByScript.set(id, [...(variantsByScript.get(id) ?? []), variant]);
    }
    const metadataReady = slots.filter((slot) => verifyApprovedProductionBatchSlotMetadata({
      scope, databaseNow: now,
      plan: { publicKey: publicPlanKey, status: String(value(plan, "status", "status")), plannedSlotCount: required },
      planSlots: slots.map((candidate) => ({ sourceMemberKey: String(value(candidate, "sourceMemberKey", "source_member_key")),
        videoNumber: Number(value(candidate, "videoNumber", "video_number")), status: String(value(candidate, "status", "status")) })),
      slot: { publicKey: String(value(slot, "publicSlotKey", "public_slot_key")),
        status: String(value(slot, "status", "status")), scriptVariantId: String(value(slot, "scriptVariantId", "script_variant_id")) },
      script: { id: String(value(slot, "scriptId", "script_id")), title: String(value(slot, "scriptTitle", "script_title")),
        status: String(value(slot, "scriptStatus", "script_status")), currentVariantId: String(value(slot, "currentVariantId", "current_variant_id")),
        metadata: value(slot, "scriptMetadata", "script_metadata"), sourceType: String(value(slot, "sourceType", "source_type")),
        sourceItemId: value(slot, "sourceItemId", "source_item_id") == null ? null : String(value(slot, "sourceItemId", "source_item_id")) },
      source: { id: String(value(slot, "sourceId", "source_id")), type: String(value(slot, "sourceItemType", "source_item_type")),
        title: String(value(slot, "sourceTitle", "source_title")), content: String(value(slot, "sourceContent", "source_content")),
        contentHash: String(value(slot, "sourceContentHash", "source_content_hash")), status: String(value(slot, "sourceStatus", "source_status")),
        rightsStatus: String(value(slot, "rightsStatus", "rights_status")), moderationStatus: String(value(slot, "moderationStatus", "moderation_status")) },
      variants: (variantsByScript.get(String(value(slot, "scriptId", "script_id"))) ?? []).map((variant) => ({
        id: String(value(variant, "id", "id")), version: Number(value(variant, "version", "version")),
        label: String(value(variant, "label", "label")), content: String(value(variant, "content", "content")),
        status: String(value(variant, "status", "status")), checksum: String(value(variant, "checksum", "checksum")),
        metadata: value(variant, "metadata", "metadata"),
      })),
    })).length;
    const batchIds = new Set(slots.map((slot) => {
      const metadata = value(slot, "scriptMetadata", "script_metadata") as Record<string, unknown> | undefined;
      const envelope = metadata?.productionBatchV1 as Record<string, unknown> | undefined;
      return typeof envelope?.batchId === "string" ? envelope.batchId : "";
    }));
    const batchId = batchIds.size === 1 ? [...batchIds][0] : "";
    if (!exactShape || !/^batch_[0-9a-f]{24}$/u.test(batchId)) throw new LaunchPreflightError("UNAVAILABLE");

    const sourceReady = slots.filter((slot) => {
      const envelope = readProductionBatchEnvelope(value(slot, "scriptMetadata", "script_metadata"));
      const content = String(value(slot, "sourceContent", "source_content"));
      return envelope && envelope.sourceContentHash === value(slot, "sourceContentHash", "source_content_hash")
        && envelope.sourceContentChecksum === createHash("sha256").update(content).digest("hex")
        && envelope.sourceTitle === value(slot, "sourceTitle", "source_title")
        && envelope.sourceCategory === value(slot, "sourceItemType", "source_item_type")
        && ["accepted", "ready"].includes(String(value(slot, "sourceStatus", "source_status")))
        && ["owned", "licensed"].includes(String(value(slot, "rightsStatus", "rights_status")))
        && value(slot, "moderationStatus", "moderation_status") === "approved";
    }).length;
    const providerReady = slots.filter((slot) => bool(slot, "influencerReady", "influencer_ready")
      && bool(slot, "accountReady", "account_ready") && bool(slot, "resourcesReady", "resources_ready")).length;
    const authorityBySlot = new Map(authority.map((row) => [String(value(row, "slotId", "slot_id")), row]));
    const authorityRows = slots.map((slot) => authorityBySlot.get(String(value(slot, "id", "id"))));
    const governanceReady = authorityRows.filter((row) => row && value(row, "governanceState", "governance_state") === "active"
      && bool(row, "governanceBound", "governance_bound") && value(row, "revokedAt", "revoked_at") == null
      && validAt(row, "governanceValidFrom", "governance_valid_from", "governanceExpiresAt", "governance_expires_at", now)).length;
    const intentReady = authorityRows.filter((row) => bool(row, "intentPresent", "intent_present") && bool(row, "intentCurrent", "intent_current")).length;

    const evidence = (decisionCamel: string, decisionSnake: string, fromCamel: string, fromSnake: string,
      expiryCamel: string, expirySnake: string,
      currentCamel: string, currentSnake: string,
      positive: string): { ready: number; denied: boolean; expired: boolean; unavailable: boolean } => {
      let ready = 0; let denied = false; let expired = false; let unavailable = false;
      for (const row of authorityRows) {
        const decision = row ? value(row, decisionCamel, decisionSnake) : undefined;
        if (decision === positive && bool(row, currentCamel, currentSnake)
          && validAt(row!, fromCamel, fromSnake, expiryCamel, expirySnake, now, false)) ready += 1;
        else if (decision !== undefined && decision !== null && !bool(row, currentCamel, currentSnake)) unavailable = true;
        else if (decision !== undefined && decision !== null && decision !== positive) denied = true;
        else if (decision === positive && bool(row, currentCamel, currentSnake)) expired = true;
      }
      return { ready, denied, expired, unavailable };
    };
    const content = evidence("contentDecision", "content_decision", "contentValidFrom", "content_valid_from",
      "contentExpiresAt", "content_expires_at", "contentCurrent", "content_current", "approved");
    const human = evidence("humanDecision", "human_decision", "humanValidFrom", "human_valid_from",
      "humanExpiresAt", "human_expires_at", "humanCurrent", "human_current", "approved");
    const sandbox = evidence("sandboxDecision", "sandbox_decision", "sandboxValidFrom", "sandbox_valid_from",
      "sandboxExpiresAt", "sandbox_expires_at", "sandboxCurrent", "sandbox_current", "passed");
    const quote = evidence("quoteDecision", "quote_decision", "quoteValidFrom", "quote_valid_from",
      "quoteExpiresAt", "quote_expires_at", "quoteCurrent", "quote_current", "quoted");
    const snapshotReady = authorityRows.filter((row) => bool(row, "snapshotPresent", "snapshot_present")
      && bool(row, "snapshotCurrent", "snapshot_current")
      && validAt(row!, "snapshotValidFrom", "snapshot_valid_from", "snapshotExpiresAt", "snapshot_expires_at", now, false)).length;

    const policy = policies.length === 1 ? policies[0] : undefined;
    const policyExists = Boolean(policy);
    const policyValid = policyExists && validAt(policy!, "policyValidFrom", "policy_valid_from", "policyExpiresAt", "policy_expires_at", now, true);
    const killExists = policyExists && value(policy!, "killActive", "kill_active") !== undefined && value(policy!, "killActive", "kill_active") !== null;
    const killValid = killExists && validAt(policy!, "killValidFrom", "kill_valid_from", "killExpiresAt", "kill_expires_at", now, true);
    const policyGatePassed = policyValid && value(policy!, "policyState", "policy_state") === "active"
      && killValid && value(policy!, "killActive", "kill_active") === false;

    const gates: LaunchPreflightGate[] = [];
    const approvedScripts = slots.filter((slot) => value(slot, "scriptStatus", "script_status") === "approved").length;
    gates.push(gate(required, metadataReady === required ? passed("batch_integrity", required)
      : blocked("batch_integrity", metadataReady, approvedScripts ? "batch_ambiguous" : "batch_not_approved",
        approvedScripts ? "repair_batch" : "approve_scripts", approvedScripts ? "unavailable" : "blocked")));
    const planReady = value(plan, "status", "status") === "planned" && bool(plan, "planInWindow", "plan_in_window");
    gates.push(gate(required, planReady ? passed("plan_window", required)
      : blocked("plan_window", 0, value(plan, "status", "status") === "planned" ? "plan_outside_window" : "plan_not_planned",
        value(plan, "status", "status") === "planned" ? "wait_for_plan_window" : "repair_batch")));
    gates.push(gate(required, sourceReady === required ? passed("source_eligibility", required)
      : blocked("source_eligibility", sourceReady, sourceReady ? "source_changed" : "source_not_eligible", "repair_source")));
    gates.push(gate(required, providerReady === required ? passed("provider_binding_local", required)
      : blocked("provider_binding_local", providerReady, providerReady ? "provider_resources_invalid" : "provider_not_bound",
        providerReady ? "repair_provider_resources" : "configure_provider", "pending_external")));
    gates.push(gate(required, governanceReady === required ? passed("governance_coverage", required)
      : blocked("governance_coverage", governanceReady, governanceReady ? "governance_invalid" : "governance_missing", "record_governance")));
    const presentIntents = authorityRows.filter((row) => bool(row, "intentPresent", "intent_present")).length;
    gates.push(gate(required, intentReady === required ? passed("launch_intent", required)
      : blocked("launch_intent", intentReady, presentIntents ? "launch_intent_not_current" : "launch_intent_missing",
        presentIntents ? "retry_observation" : "declare_launch_intent", presentIntents ? "unavailable" : "pending_human")));
    gates.push(gate(required, evidenceGate("content_approval", content, required, "content_approval_missing", "content_approval_denied",
      "content_approval_expired", "record_content_approval", "pending_human")));
    let policyInput: GateInput;
    if (policyGatePassed) policyInput = passed("policy_kill_switch", required);
    else if (!policyExists) policyInput = blocked("policy_kill_switch", 0, "policy_missing", "revise_policy");
    else if (!policyValid) policyInput = blocked("policy_kill_switch", 0, "policy_expired", "revise_policy");
    else if (value(policy!, "policyState", "policy_state") !== "active") policyInput = blocked("policy_kill_switch", 0, "policy_inactive", "revise_policy");
    else if (!killExists) policyInput = blocked("policy_kill_switch", 0, "kill_switch_missing", "disable_kill_switch");
    else if (!killValid) policyInput = blocked("policy_kill_switch", 0, "kill_switch_expired", "disable_kill_switch");
    else policyInput = blocked("policy_kill_switch", 0, "kill_switch_active", "disable_kill_switch");
    gates.push(gate(required, policyInput));
    // No database column in the authority model is a live-provider verification attestation.
    gates.push(gate(required, blocked("provider_live_verification", 0, "provider_verification_required", "verify_provider_live", "pending_external")));
    gates.push(gate(required, evidenceGate("maximum_quote", quote, required, "maximum_quote_missing", "maximum_quote_denied",
      "maximum_quote_expired", "obtain_maximum_quote", "pending_external")));
    gates.push(gate(required, evidenceGate("sandbox_proof", sandbox, required, "sandbox_proof_missing", "sandbox_proof_denied",
      "sandbox_proof_expired", "run_sandbox", "pending_external")));
    gates.push(gate(required, evidenceGate("human_launch_approval", human, required, "human_approval_missing", "human_approval_denied",
      "human_approval_expired", "request_human_approval", "pending_human")));
    const presentSnapshots = authorityRows.filter((row) => bool(row, "snapshotPresent", "snapshot_present")).length;
    gates.push(gate(required, snapshotReady === required ? passed("authority_snapshot", required)
      : blocked("authority_snapshot", snapshotReady, presentSnapshots > snapshotReady ? "observation_unavailable"
        : snapshotReady ? "authority_snapshot_expired" : "authority_snapshot_missing",
        presentSnapshots > snapshotReady ? "retry_observation" : "create_authority_snapshot",
        presentSnapshots > snapshotReady ? "unavailable" : "pending_external")));

    const cap = capacity.length === 1 ? capacity[0] : undefined;
    const quotesTotal = authorityRows.reduce((sum, row) => sum + (row && bool(row, "quoteCurrent", "quote_current")
      && value(row, "quoteDecision", "quote_decision") === "quoted"
      && validAt(row, "quoteValidFrom", "quote_valid_from", "quoteExpiresAt", "quote_expires_at", now, false)
      ? BigInt(String(value(row, "quoteAmount", "quote_amount") ?? "0")) : 0n), 0n);
    const bucketAvailable = cap && bool(cap, "bucketPresent", "bucket_present")
      ? BigInt(String(value(cap, "limitMicroUsd", "limit_micro_usd")))
        - BigInt(String(value(cap, "reservedMicroUsd", "reserved_micro_usd")))
        - BigInt(String(value(cap, "committedMicroUsd", "committed_micro_usd"))) : -1n;
    const concurrencyReady = policyGatePassed && cap
      && count(cap, "totalActive", "total_active") + required <= count(policy!, "totalConcurrency", "total_concurrency")
      && count(cap, "tenantActive", "tenant_active") + required <= count(policy!, "tenantConcurrency", "tenant_concurrency")
      && count(cap, "providerActive", "provider_active") + required <= count(policy!, "providerConcurrency", "provider_concurrency");
    const capacityPassed = quote.ready === required && bucketAvailable >= quotesTotal && concurrencyReady;
    gates.push(gate(required, capacityPassed ? passed("budget_admission_capacity", required)
      : blocked("budget_admission_capacity", 0, !cap || !bool(cap, "bucketPresent", "bucket_present") ? "budget_bucket_missing"
        : bucketAvailable < quotesTotal ? "budget_capacity_insufficient" : "concurrency_capacity_insufficient",
      !cap || !bool(cap, "bucketPresent", "bucket_present") ? "configure_budget" : bucketAvailable < quotesTotal ? "configure_budget" : "free_capacity",
      "pending_external")));
    if (gates.map((entry) => entry.code).some((code, index) => code !== launchPreflightGateCodes[index])) {
      throw new LaunchPreflightError("UNAVAILABLE");
    }
    const states = (state: LaunchPreflightGate["state"]) => gates.filter((entry) => entry.state === state).length;
    const passedCount = states("passed");
    const foundation = new Set(["batch_integrity", "plan_window", "source_eligibility", "provider_binding_local", "governance_coverage", "policy_kill_switch"]);
    const offlineReady = gates.every((entry) => foundation.has(entry.code) ? entry.state === "passed"
      : ["passed", "pending_external", "pending_human"].includes(entry.state));
    return launchPreflightSchema.parse({
      version: 1, source: "derived_read_only",
      subject: { planId: publicPlanKey, batchId, avatarCount, videosPerAvatar: 10, plannedVideoCount: required },
      observedAt: now.toISOString(),
      status: passedCount === 14 ? "ready_at_observation" : offlineReady ? "offline_ready_for_external_setup" : "blocked",
      canGenerate: false, sandboxExecutionAllowed: false, spendAuthorized: false, noSpend: true,
      authoritativeForAdmission: false,
      effects: { intentCreated: false, evidenceCreated: false, snapshotCreated: false, reservationCreated: false,
        renderCreated: false, outboxCreated: false, providerCalled: false },
      summary: { totalGates: 14, passedGates: passedCount, blockedGates: states("blocked"),
        pendingExternalGates: states("pending_external"), pendingHumanGates: states("pending_human"),
        unavailableGates: states("unavailable"), readySlots: Math.min(...gates.map((entry) => entry.readySlots)), requiredSlots: required },
      gates,
    });
  }
}

function validAt(row: Row, fromCamel: string, fromSnake: string, expiresCamel: string, expiresSnake: string,
  now: Date, nullableExpiry = false): boolean {
  return launchPreflightWindowIsCurrent(
    value(row, fromCamel, fromSnake), value(row, expiresCamel, expiresSnake), now, nullableExpiry,
  );
}

/** Shared by the aggregate derivation and focused temporal-boundary tests. */
export function launchPreflightWindowIsCurrent(
  validFrom: unknown, expiresAt: unknown, observedAt: Date, nullableExpiry = false,
): boolean {
  const from = instant(validFrom);
  if (!(observedAt instanceof Date) || !Number.isFinite(observedAt.getTime())) throw new LaunchPreflightError("UNAVAILABLE");
  return from.getTime() <= observedAt.getTime()
    && (expiresAt == null ? nullableExpiry : instant(expiresAt).getTime() > observedAt.getTime());
}

function evidenceGate(code: LaunchPreflightGate["code"], facts: { ready: number; denied: boolean; expired: boolean; unavailable: boolean }, required: number,
  missing: Exclude<LaunchPreflightGate["reasonCode"], "ready">, deniedReason: Exclude<LaunchPreflightGate["reasonCode"], "ready">,
  expiredReason: Exclude<LaunchPreflightGate["reasonCode"], "ready">,
  action: Exclude<LaunchPreflightGate["nextActionCode"], "none">, state: LaunchPreflightGate["state"]): GateInput {
  return facts.ready === required ? passed(code, required)
    : facts.unavailable ? blocked(code, facts.ready, "observation_unavailable", "retry_observation", "unavailable")
      : blocked(code, facts.ready, facts.denied ? deniedReason : facts.expired ? expiredReason : missing, action, state);
}
