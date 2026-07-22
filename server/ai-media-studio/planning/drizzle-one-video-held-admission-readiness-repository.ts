import { sql, type SQL } from "drizzle-orm";
import {
  readProductionBatchEnvelope,
  verifyApprovedProductionBatchSlotMetadata,
  type ApprovedProductionBatchSlotFacts,
} from "../production-batches/metadata-integrity";
import {
  OneVideoHeldAdmissionError,
  type OneVideoHeldAdmissionContext,
} from "./one-video-held-admission-contracts";
import { deriveMaximumQuoteKey, deriveRenderSpecKey } from "./one-video-execution-control-contracts";
import type {
  OneVideoHeldAdmissionGateObservation,
  OneVideoHeldAdmissionObservedReservation,
  OneVideoHeldAdmissionReadinessGates,
  OneVideoHeldAdmissionReadinessObservation,
  OneVideoHeldAdmissionReadinessObservationRepository,
} from "./one-video-held-admission-readiness-service";

type ExecuteResult = { rows?: unknown[] } | unknown[];
export type OneVideoHeldAdmissionReadinessDatabase = { execute(query: SQL): Promise<ExecuteResult> };
type Row = Record<string, unknown>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const PUBLIC_KEY = (prefix: string) => new RegExp(`^${prefix}_[a-f0-9]{24}$`, "u");
const STATES = new Set(["reserved", "committed", "released", "expired", "settled"]);
const SUBMISSION_STATES = new Set(["not_started", "dispatching", "confirmed", "ambiguous", "reconciled_no_submit"]);

const rows = (result: ExecuteResult): Row[] => (Array.isArray(result) ? result : result?.rows ?? []) as Row[];
const value = (row: Row, camel: string, snake: string): unknown => row[camel] ?? row[snake];
const text = (row: Row, camel: string, snake: string): string => String(value(row, camel, snake) ?? "");
const number = (row: Row, camel: string, snake: string): number => Number(value(row, camel, snake));
const bool = (row: Row, camel: string, snake: string): boolean => value(row, camel, snake) === true;
const count = (row: Row, camel: string, snake: string): number => {
  const parsed = number(row, camel, snake);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : -1;
};
const instant = (raw: unknown): string => {
  const parsed = raw instanceof Date ? raw : new Date(String(raw));
  if (!Number.isFinite(parsed.getTime())) throw new OneVideoHeldAdmissionError("UNAVAILABLE");
  return parsed.toISOString();
};

/**
 * One PostgreSQL statement observes every pre-admission gate and at most two
 * durable reservation projections under one MVCC snapshot and one DB clock.
 * It never locks, mutates, resolves a secret, or reaches a provider. Budget
 * and concurrency remain advisory; the POST transaction must re-lock and
 * revalidate their exact counters.
 */
export class DrizzleOneVideoHeldAdmissionReadinessRepository
implements OneVideoHeldAdmissionReadinessObservationRepository {
  constructor(private readonly db: OneVideoHeldAdmissionReadinessDatabase) {
    if (!db || typeof db.execute !== "function") throw new OneVideoHeldAdmissionError("UNAVAILABLE");
  }

  async observe(input: Readonly<{
    scope: OneVideoHeldAdmissionContext["scope"];
    context: OneVideoHeldAdmissionContext;
  }>): Promise<OneVideoHeldAdmissionReadinessObservation> {
    assertInput(input);
    let observedRows: Row[];
    try {
      observedRows = rows(await this.db.execute(sql`
        WITH db_clock AS MATERIALIZED (
          SELECT transaction_timestamp() AS observed_at
        ), plan_candidates AS MATERIALIZED (
          SELECT plan.* FROM ai_media_daily_plans plan
          WHERE plan.owner_user_id=${input.scope.ownerUserId}
            AND plan.workspace_id=${input.scope.workspaceId}
            AND plan.id=${input.context.planId}
            AND plan.public_plan_key=${input.context.publicPlanKey}
          LIMIT 2
        ), exact_plan AS MATERIALIZED (
          SELECT * FROM plan_candidates LIMIT 1
        ), slot_candidates AS MATERIALIZED (
          SELECT slot.* FROM ai_media_daily_plan_slots slot
          JOIN exact_plan plan ON plan.owner_user_id=slot.owner_user_id
            AND plan.workspace_id=slot.workspace_id AND plan.id=slot.daily_plan_id
          WHERE slot.owner_user_id=${input.scope.ownerUserId}
            AND slot.workspace_id=${input.scope.workspaceId}
            AND slot.id=${input.context.dailyPlanSlotId}
            AND slot.public_slot_key=${input.context.publicSlotKey}
          LIMIT 2
        ), exact_slot AS MATERIALIZED (
          SELECT * FROM slot_candidates LIMIT 1
        ), plan_slot_shape AS MATERIALIZED (
          SELECT jsonb_agg(jsonb_build_object(
              'sourceMemberKey',shape.source_member_key,'videoNumber',shape.video_number,'status',shape.status)
              ORDER BY shape.source_member_key,shape.video_number) AS rows,
            count(*) AS row_count,count(DISTINCT shape.source_member_key) AS member_count,
            bool_and(shape.status='planned' AND shape.video_number BETWEEN 1 AND 10) AS rows_current,
            bool_and((SELECT count(DISTINCT sibling.video_number)=10
              FROM ai_media_daily_plan_slots sibling
              WHERE sibling.owner_user_id=shape.owner_user_id AND sibling.workspace_id=shape.workspace_id
                AND sibling.daily_plan_id=shape.daily_plan_id
                AND sibling.source_member_key=shape.source_member_key)) AS ten_each
          FROM ai_media_daily_plan_slots shape JOIN exact_plan plan ON plan.id=shape.daily_plan_id
          WHERE shape.owner_user_id=${input.scope.ownerUserId} AND shape.workspace_id=${input.scope.workspaceId}
        ), exact_script AS MATERIALIZED (
          SELECT script.* FROM ai_media_scripts script JOIN exact_slot slot
            ON slot.owner_user_id=script.owner_user_id AND slot.workspace_id=script.workspace_id
            AND slot.script_variant_id=script.current_variant_id
          WHERE script.owner_user_id=${input.scope.ownerUserId} AND script.workspace_id=${input.scope.workspaceId}
          LIMIT 2
        ), exact_source AS MATERIALIZED (
          SELECT source.* FROM ai_media_source_items source JOIN exact_script script
            ON script.owner_user_id=source.owner_user_id AND script.workspace_id=source.workspace_id
            AND script.source_item_id=source.id AND script.source_type=source.source_type
          WHERE source.owner_user_id=${input.scope.ownerUserId} AND source.workspace_id=${input.scope.workspaceId}
          LIMIT 2
        ), variant_shape AS MATERIALIZED (
          SELECT jsonb_agg(jsonb_build_object('id',variant.id,'version',variant.version,
              'label',variant.label,'content',variant.content,'status',variant.status,
              'checksum',variant.checksum,'metadata',variant.metadata) ORDER BY variant.version) AS rows,
            count(*) AS row_count
          FROM ai_media_script_variants variant JOIN exact_script script ON script.id=variant.script_id
          WHERE variant.owner_user_id=${input.scope.ownerUserId} AND variant.workspace_id=${input.scope.workspaceId}
        ), intent_candidates AS MATERIALIZED (
          SELECT intent.* FROM ai_media_launch_intents intent JOIN exact_slot slot
            ON slot.owner_user_id=intent.owner_user_id AND slot.workspace_id=intent.workspace_id
            AND slot.id=intent.daily_plan_slot_id
          WHERE intent.owner_user_id=${input.scope.ownerUserId} AND intent.workspace_id=${input.scope.workspaceId}
            AND intent.slot_attempt=${input.context.slotAttempt}
          ORDER BY intent.created_at DESC LIMIT 2
        ), exact_intent AS MATERIALIZED (SELECT * FROM intent_candidates LIMIT 1),
        content_candidates AS MATERIALIZED (
          SELECT evidence.* FROM ai_media_launch_evidence evidence JOIN exact_slot slot
            ON slot.owner_user_id=evidence.owner_user_id AND slot.workspace_id=evidence.workspace_id
            AND slot.id=evidence.daily_plan_slot_id
          WHERE evidence.owner_user_id=${input.scope.ownerUserId} AND evidence.workspace_id=${input.scope.workspaceId}
            AND evidence.slot_attempt=${input.context.slotAttempt} AND evidence.evidence_kind='content_approval'
            AND NOT EXISTS (SELECT 1 FROM ai_media_launch_evidence newer
              WHERE newer.owner_user_id=evidence.owner_user_id AND newer.workspace_id=evidence.workspace_id
                AND newer.daily_plan_slot_id=evidence.daily_plan_slot_id
                AND newer.slot_attempt=evidence.slot_attempt AND newer.evidence_kind=evidence.evidence_kind
                AND newer.revision>evidence.revision)
          ORDER BY evidence.revision DESC LIMIT 2
        ), exact_content AS MATERIALIZED (SELECT * FROM content_candidates LIMIT 1),
        sandbox_candidates AS MATERIALIZED (
          SELECT evidence.* FROM ai_media_launch_evidence evidence JOIN exact_slot slot
            ON slot.owner_user_id=evidence.owner_user_id AND slot.workspace_id=evidence.workspace_id
            AND slot.id=evidence.daily_plan_slot_id
          WHERE evidence.owner_user_id=${input.scope.ownerUserId} AND evidence.workspace_id=${input.scope.workspaceId}
            AND evidence.slot_attempt=${input.context.slotAttempt} AND evidence.evidence_kind='sandbox_proof'
            AND NOT EXISTS (SELECT 1 FROM ai_media_launch_evidence newer
              WHERE newer.owner_user_id=evidence.owner_user_id AND newer.workspace_id=evidence.workspace_id
                AND newer.daily_plan_slot_id=evidence.daily_plan_slot_id
                AND newer.slot_attempt=evidence.slot_attempt AND newer.evidence_kind=evidence.evidence_kind
                AND newer.revision>evidence.revision)
          ORDER BY evidence.revision DESC LIMIT 2
        ), exact_sandbox AS MATERIALIZED (SELECT * FROM sandbox_candidates LIMIT 1),
        quote_candidates AS MATERIALIZED (
          SELECT evidence.* FROM ai_media_launch_evidence evidence JOIN exact_slot slot
            ON slot.owner_user_id=evidence.owner_user_id AND slot.workspace_id=evidence.workspace_id
            AND slot.id=evidence.daily_plan_slot_id
          WHERE evidence.owner_user_id=${input.scope.ownerUserId} AND evidence.workspace_id=${input.scope.workspaceId}
            AND evidence.slot_attempt=${input.context.slotAttempt} AND evidence.evidence_kind='maximum_quote'
            AND NOT EXISTS (SELECT 1 FROM ai_media_launch_evidence newer
              WHERE newer.owner_user_id=evidence.owner_user_id AND newer.workspace_id=evidence.workspace_id
                AND newer.daily_plan_slot_id=evidence.daily_plan_slot_id
                AND newer.slot_attempt=evidence.slot_attempt AND newer.evidence_kind=evidence.evidence_kind
                AND newer.revision>evidence.revision)
          ORDER BY evidence.revision DESC LIMIT 2
        ), exact_quote AS MATERIALIZED (SELECT * FROM quote_candidates LIMIT 1),
        human_candidates AS MATERIALIZED (
          SELECT evidence.* FROM ai_media_launch_evidence evidence JOIN exact_slot slot
            ON slot.owner_user_id=evidence.owner_user_id AND slot.workspace_id=evidence.workspace_id
            AND slot.id=evidence.daily_plan_slot_id
          WHERE evidence.owner_user_id=${input.scope.ownerUserId} AND evidence.workspace_id=${input.scope.workspaceId}
            AND evidence.slot_attempt=${input.context.slotAttempt} AND evidence.evidence_kind='human_launch_approval'
            AND NOT EXISTS (SELECT 1 FROM ai_media_launch_evidence newer
              WHERE newer.owner_user_id=evidence.owner_user_id AND newer.workspace_id=evidence.workspace_id
                AND newer.daily_plan_slot_id=evidence.daily_plan_slot_id
                AND newer.slot_attempt=evidence.slot_attempt AND newer.evidence_kind=evidence.evidence_kind
                AND newer.revision>evidence.revision)
          ORDER BY evidence.revision DESC LIMIT 2
        ), exact_human AS MATERIALIZED (SELECT * FROM human_candidates LIMIT 1),
        bridge_candidates AS MATERIALIZED (
          SELECT bridge.* FROM ai_media_quote_bound_human_approvals bridge JOIN exact_slot slot
            ON slot.owner_user_id=bridge.owner_user_id AND slot.workspace_id=bridge.workspace_id
            AND slot.id=bridge.daily_plan_slot_id
          JOIN exact_human human ON human.id=bridge.human_launch_approval_evidence_id
            AND human.revision=bridge.human_launch_approval_evidence_revision
            AND human.evidence_digest=bridge.human_launch_approval_evidence_digest
          JOIN exact_quote quote ON quote.id=bridge.maximum_quote_evidence_id
            AND quote.revision=bridge.maximum_quote_evidence_revision
            AND quote.evidence_digest=bridge.maximum_quote_evidence_digest
          WHERE bridge.owner_user_id=${input.scope.ownerUserId} AND bridge.workspace_id=${input.scope.workspaceId}
            AND bridge.slot_attempt=${input.context.slotAttempt}
          ORDER BY bridge.bound_at DESC LIMIT 2
        ), exact_bridge AS MATERIALIZED (SELECT * FROM bridge_candidates LIMIT 1),
        policy_candidates AS MATERIALIZED (
          SELECT policy.* FROM ai_media_admission_policy_revisions policy
          WHERE policy.owner_user_id=${input.scope.ownerUserId} AND policy.workspace_id=${input.scope.workspaceId}
            AND NOT EXISTS (SELECT 1 FROM ai_media_admission_policy_revisions newer
              WHERE newer.owner_user_id=policy.owner_user_id AND newer.workspace_id=policy.workspace_id
                AND newer.revision>policy.revision)
          ORDER BY policy.revision DESC LIMIT 2
        ), exact_policy AS MATERIALIZED (SELECT * FROM policy_candidates LIMIT 1),
        kill_candidates AS MATERIALIZED (
          SELECT kill.* FROM ai_media_kill_switch_revisions kill
          WHERE kill.owner_user_id=${input.scope.ownerUserId} AND kill.workspace_id=${input.scope.workspaceId}
            AND NOT EXISTS (SELECT 1 FROM ai_media_kill_switch_revisions newer
              WHERE newer.owner_user_id=kill.owner_user_id AND newer.workspace_id=kill.workspace_id
                AND newer.revision>kill.revision)
          ORDER BY kill.revision DESC LIMIT 2
        ), exact_kill AS MATERIALIZED (SELECT * FROM kill_candidates LIMIT 1),
        governance_candidates AS MATERIALIZED (
          SELECT governance.* FROM ai_media_governance_profiles governance JOIN exact_slot slot
            ON slot.owner_user_id=governance.owner_user_id AND slot.workspace_id=governance.workspace_id
            AND slot.influencer_id=governance.influencer_id
          WHERE governance.owner_user_id=${input.scope.ownerUserId} AND governance.workspace_id=${input.scope.workspaceId}
            AND NOT EXISTS (SELECT 1 FROM ai_media_governance_profiles newer
              WHERE newer.owner_user_id=governance.owner_user_id
                AND newer.workspace_id=governance.workspace_id
                AND newer.influencer_id=governance.influencer_id AND newer.version>governance.version)
          ORDER BY governance.version DESC LIMIT 2
        ), exact_governance AS MATERIALIZED (SELECT * FROM governance_candidates LIMIT 1),
        reservation_candidates AS MATERIALIZED (
          SELECT reservation.* FROM ai_media_budget_reservations reservation
          WHERE reservation.owner_user_id=${input.scope.ownerUserId}
            AND reservation.workspace_id=${input.scope.workspaceId}
            AND reservation.daily_plan_slot_id=${input.context.dailyPlanSlotId}
            AND reservation.attempt=${input.context.slotAttempt}
          ORDER BY reservation.reserved_at DESC LIMIT 2
        ), exact_account AS MATERIALIZED (
          SELECT account.* FROM ai_media_provider_accounts account JOIN exact_slot slot
            ON slot.owner_user_id=account.owner_user_id AND slot.workspace_id=account.workspace_id
            AND slot.provider_account_id=account.id AND slot.provider_key=account.provider_key
          WHERE account.owner_user_id=${input.scope.ownerUserId} AND account.workspace_id=${input.scope.workspaceId}
          LIMIT 2
        ), exact_avatar AS MATERIALIZED (
          SELECT resource.* FROM ai_media_provider_resources resource JOIN exact_slot slot
            ON slot.owner_user_id=resource.owner_user_id AND slot.workspace_id=resource.workspace_id
            AND slot.provider_account_id=resource.provider_account_id AND slot.provider_key=resource.provider_key
            AND slot.avatar_resource_id=resource.id
          WHERE resource.owner_user_id=${input.scope.ownerUserId} AND resource.workspace_id=${input.scope.workspaceId}
            AND resource.resource_type='avatar'
          LIMIT 2
        ), exact_voice AS MATERIALIZED (
          SELECT resource.* FROM ai_media_provider_resources resource JOIN exact_slot slot
            ON slot.owner_user_id=resource.owner_user_id AND slot.workspace_id=resource.workspace_id
            AND slot.provider_account_id=resource.provider_account_id AND slot.provider_key=resource.provider_key
            AND slot.voice_resource_id=resource.id
          WHERE resource.owner_user_id=${input.scope.ownerUserId} AND resource.workspace_id=${input.scope.workspaceId}
            AND resource.resource_type='voice'
          LIMIT 2
        ), exact_header AS MATERIALIZED (
          SELECT header.* FROM ai_media_static_heygen_verification_headers header JOIN exact_account account
            ON account.owner_user_id=header.owner_user_id AND account.workspace_id=header.workspace_id
            AND account.id=header.provider_account_id AND account.provider_key=header.provider_key
            AND account.credential_version=header.provider_credential_version
            AND account.static_credential_verification_id=header.id
          WHERE header.owner_user_id=${input.scope.ownerUserId} AND header.workspace_id=${input.scope.workspaceId}
          LIMIT 2
        ), exact_avatar_verification AS MATERIALIZED (
          SELECT evidence.* FROM ai_media_static_heygen_resource_verifications evidence JOIN exact_avatar resource
            ON resource.owner_user_id=evidence.owner_user_id AND resource.workspace_id=evidence.workspace_id
            AND resource.id=evidence.provider_resource_id AND resource.verification_resource_evidence_id=evidence.id
          WHERE evidence.owner_user_id=${input.scope.ownerUserId} AND evidence.workspace_id=${input.scope.workspaceId}
          LIMIT 2
        ), exact_voice_verification AS MATERIALIZED (
          SELECT evidence.* FROM ai_media_static_heygen_resource_verifications evidence JOIN exact_voice resource
            ON resource.owner_user_id=evidence.owner_user_id AND resource.workspace_id=evidence.workspace_id
            AND resource.id=evidence.provider_resource_id AND resource.verification_resource_evidence_id=evidence.id
          WHERE evidence.owner_user_id=${input.scope.ownerUserId} AND evidence.workspace_id=${input.scope.workspaceId}
          LIMIT 2
        ), target AS MATERIALIZED (
          SELECT clock.observed_at,plan.*,slot.id AS slot_id,slot.public_slot_key,slot.status AS slot_status,
            slot.state_version AS slot_state_version,slot.script_variant_id,slot.influencer_id,
            slot.avatar_resource_id,slot.voice_resource_id,slot.slot_digest,
            (plan.status='planned' AND slot.status='planned'
              AND plan.plan_date=(clock.observed_at AT TIME ZONE plan.accounting_time_zone)::date
              AND slot.state_version=${input.context.expectedSlotStateVersion}
              AND COALESCE((SELECT max(previous.attempt)+1 FROM ai_media_budget_reservations previous
                WHERE previous.owner_user_id=slot.owner_user_id AND previous.workspace_id=slot.workspace_id
                  AND previous.daily_plan_slot_id=slot.id),1)=${input.context.slotAttempt}) AS slot_current,
            script.id AS script_id,script.title AS script_title,script.status AS script_status,
            script.current_variant_id,script.metadata AS script_metadata,script.source_type,script.source_item_id,
            source.id AS source_id,source.source_type AS source_item_type,source.title AS source_title,
            source.content AS source_content,source.content_hash AS source_content_hash,
            source.status AS source_status,source.rights_status,source.moderation_status,
            shape.rows AS plan_slots,shape.row_count AS plan_slot_count,shape.member_count,
            shape.rows_current,shape.ten_each,variants.rows AS variants,variants.row_count AS variant_count,
            (SELECT count(*) FROM plan_candidates) AS plan_candidates,
            (SELECT count(*) FROM slot_candidates) AS slot_candidates,
            (SELECT count(*) FROM exact_script) AS script_candidates,
            (SELECT count(*) FROM exact_source) AS source_candidates,
            (SELECT count(*) FROM intent_candidates) AS intent_candidates,
            (SELECT count(*) FROM content_candidates) AS content_candidates,
            (SELECT count(*) FROM sandbox_candidates) AS sandbox_candidates,
            (SELECT count(*) FROM quote_candidates) AS quote_candidates,
            (SELECT count(*) FROM human_candidates) AS human_candidates,
            (SELECT count(*) FROM bridge_candidates) AS bridge_candidates,
            (SELECT count(*) FROM policy_candidates) AS policy_candidates,
            (SELECT count(*) FROM kill_candidates) AS kill_candidates,
            (SELECT count(*) FROM governance_candidates) AS governance_candidates,
            (SELECT count(*) FROM exact_account) AS account_candidates,
            (SELECT count(*) FROM exact_avatar) AS avatar_candidates,
            (SELECT count(*) FROM exact_voice) AS voice_candidates,
            (SELECT count(*) FROM exact_header) AS header_candidates,
            (SELECT count(*) FROM exact_avatar_verification) AS avatar_verification_candidates,
            (SELECT count(*) FROM exact_voice_verification) AS voice_verification_candidates,
            intent.id AS intent_id,
            (intent.daily_plan_id=plan.id AND intent.daily_plan_slot_id=slot.id
              AND intent.slot_attempt=${input.context.slotAttempt}
              AND intent.provider_account_id=slot.provider_account_id AND intent.provider_key=slot.provider_key
              AND intent.provider_credential_version=slot.provider_credential_version
              AND intent.plan_digest=plan.plan_digest AND intent.slot_digest=slot.slot_digest
              AND intent.script_variant_id=slot.script_variant_id
              AND intent.script_variant_checksum=(SELECT checksum FROM ai_media_script_variants selected
                WHERE selected.owner_user_id=slot.owner_user_id AND selected.workspace_id=slot.workspace_id
                  AND selected.id=slot.script_variant_id)) AS intent_current,
            content.id AS content_id,content.decision AS content_decision,
            (content.launch_intent_id=intent.id AND content.launch_intent_digest=intent.launch_intent_digest
              AND content.decision='approved' AND content.valid_from<=clock.observed_at
              AND content.expires_at>clock.observed_at AND ${input.context.reservationExpiresAt}::timestamptz<=content.expires_at) AS content_current,
            sandbox.id AS sandbox_id,sandbox.decision AS sandbox_decision,
            (sandbox.launch_intent_id=intent.id AND sandbox.launch_intent_digest=intent.launch_intent_digest
              AND sandbox.decision='passed' AND sandbox.valid_from<=clock.observed_at
              AND sandbox.expires_at>clock.observed_at AND ${input.context.reservationExpiresAt}::timestamptz<=sandbox.expires_at) AS sandbox_current,
            policy.id AS policy_id,policy.state AS policy_state,
            (policy.state='active' AND policy.valid_from<=clock.observed_at
              AND (policy.expires_at IS NULL OR policy.expires_at>clock.observed_at)
              AND policy.allowed_time_zones @> jsonb_build_array(plan.accounting_time_zone)
              AND policy.allowed_countries @> jsonb_build_array(intent.content_country)
              AND policy.allowed_languages @> jsonb_build_array(script.language)) AS policy_current,
            kill.id AS kill_id,kill.active AS kill_active,
            (kill.active=false AND kill.valid_from<=clock.observed_at
              AND (kill.expires_at IS NULL OR kill.expires_at>clock.observed_at)) AS kill_current,
            governance.id AS governance_id,
            (governance.state='active' AND governance.revoked_at IS NULL
              AND governance.valid_from<=clock.observed_at AND governance.expires_at>clock.observed_at
              AND governance.influencer_id=slot.influencer_id
              AND governance.avatar_resource_id=slot.avatar_resource_id
              AND governance.voice_resource_id=slot.voice_resource_id
              AND governance.allowed_uses @> jsonb_build_array(intent.governance_use)
              AND (governance.territories @> jsonb_build_array(intent.governance_territory)
                OR governance.territories @> '["WORLDWIDE"]'::jsonb)) AS governance_current,
            account.id AS account_id,
            (account.status IN ('active','connected') AND account.credential_status='active'
              AND account.credential_version=slot.provider_credential_version
              AND plan.provider_credential_version=slot.provider_credential_version
              AND (account.credential_expires_at IS NULL OR account.credential_expires_at>clock.observed_at)) AS credential_current,
            (intent.source_type=script.source_type AND intent.source_item_id IS NOT DISTINCT FROM script.source_item_id
              AND intent.source_content_hash IS NOT DISTINCT FROM source.content_hash
              AND ((intent.source_type='manual' AND intent.source_item_id IS NULL AND intent.source_content_hash IS NULL)
                OR (source.id IS NOT NULL AND source.status IN ('accepted','ready')
                  AND source.moderation_status='approved' AND source.rights_status IN ('owned','licensed')))) AS source_current,
            header.id AS verification_id,
            (account.credential_source='static_api_key' AND account.provider_key='heygen'
              AND account.static_credential_verification_digest=header.evidence_digest
              AND account.static_credential_verified_at=header.observed_at
              AND account.static_credential_verification_expires_at=header.expires_at
              AND header.verification_state='verified' AND header.observed_at<=clock.observed_at
              AND header.expires_at>clock.observed_at
              AND avatar.status='active' AND avatar.verification_header_id=header.id
              AND avatar.verified_credential_version=header.provider_credential_version
              AND avatar.verification_evidence_digest=avatar_evidence.evidence_digest
              AND avatar_evidence.resource_type='avatar' AND avatar_evidence.avatar_look_status='completed'
              AND avatar_evidence.avatar_group_status='completed'
              AND avatar_evidence.avatar_group_consent_status='approved'
              AND avatar_evidence.expires_at>clock.observed_at
              AND voice.status='active' AND voice.verification_header_id=header.id
              AND voice.verified_credential_version=header.provider_credential_version
              AND voice.verification_evidence_digest=voice_evidence.evidence_digest
              AND voice_evidence.resource_type='voice' AND voice_evidence.voice_support_digest IS NOT NULL
              AND voice_evidence.expires_at>clock.observed_at) AS provider_verification_current,
            quote.id AS quote_id,quote.revision AS quote_revision,quote.evidence_digest AS quote_evidence_digest,
            quote.decision AS quote_decision,
            (quote.launch_intent_id=intent.id AND quote.launch_intent_digest=intent.launch_intent_digest
              AND quote.decision='quoted' AND quote.amount_micro_usd=${input.context.maximumQuoteMicroUsd}
              AND quote.currency='USD' AND quote.expires_at=${input.context.quoteExpiresAt}::timestamptz
              AND quote.valid_from<=clock.observed_at AND quote.expires_at>clock.observed_at
              AND ${input.context.reservationExpiresAt}::timestamptz<=quote.expires_at) AS quote_current,
            human.id AS human_id,human.decision AS human_decision,bridge.id AS bridge_id,
            bridge.render_spec_digest AS bridge_render_spec_digest,
            (human.launch_intent_id=intent.id AND human.launch_intent_digest=intent.launch_intent_digest
              AND human.decision='approved' AND human.valid_from<=clock.observed_at
              AND human.expires_at>clock.observed_at AND ${input.context.reservationExpiresAt}::timestamptz<=human.expires_at
              AND bridge.human_launch_approval_evidence_id=human.id
              AND bridge.maximum_quote_evidence_id=quote.id AND bridge.decision='approved'
              AND bridge.maximum_quote_decision='quoted' AND bridge.amount_micro_usd=quote.amount_micro_usd
              AND bridge.currency=quote.currency AND bridge.quote_expires_at=quote.expires_at) AS human_current,
            bucket.id AS bucket_id,
            (bucket.id=${input.context.budgetBucketId} AND bucket.state_version=${input.context.expectedBucketStateVersion}
              AND bucket.currency='USD' AND bucket.policy_digest=policy.policy_digest
              AND bucket.policy_version=policy.revision AND bucket.limit_micro_usd=policy.daily_budget_micro_usd
              AND bucket.reserved_micro_usd+bucket.committed_micro_usd+quote.amount_micro_usd<=bucket.limit_micro_usd) AS budget_current,
            ((SELECT count(*) FROM ai_media_budget_reservations active
                WHERE active.state='committed' OR (active.state='reserved' AND active.expires_at>clock.observed_at))<policy.total_concurrency
              AND (SELECT count(*) FROM ai_media_budget_reservations active
                WHERE active.provider_key=slot.provider_key
                  AND (active.state='committed' OR (active.state='reserved' AND active.expires_at>clock.observed_at))<policy.provider_concurrency
              AND (SELECT count(*) FROM ai_media_budget_reservations active
                WHERE active.owner_user_id=${input.scope.ownerUserId} AND active.workspace_id=${input.scope.workspaceId}
                  AND (active.state='committed' OR (active.state='reserved' AND active.expires_at>clock.observed_at))<policy.tenant_concurrency) AS concurrency_current
          FROM db_clock clock
          LEFT JOIN exact_plan plan ON true LEFT JOIN exact_slot slot ON true
          LEFT JOIN plan_slot_shape shape ON true LEFT JOIN exact_script script ON true
          LEFT JOIN exact_source source ON true LEFT JOIN variant_shape variants ON true
          LEFT JOIN exact_intent intent ON true LEFT JOIN exact_content content ON true
          LEFT JOIN exact_sandbox sandbox ON true LEFT JOIN exact_quote quote ON true
          LEFT JOIN exact_human human ON true LEFT JOIN exact_bridge bridge ON true
          LEFT JOIN exact_policy policy ON true LEFT JOIN exact_kill kill ON true
          LEFT JOIN exact_governance governance ON true LEFT JOIN exact_account account ON true
          LEFT JOIN exact_avatar avatar ON true LEFT JOIN exact_voice voice ON true
          LEFT JOIN exact_header header ON true LEFT JOIN exact_avatar_verification avatar_evidence ON true
          LEFT JOIN exact_voice_verification voice_evidence ON true
          LEFT JOIN ai_media_budget_buckets bucket ON bucket.owner_user_id=${input.scope.ownerUserId}
            AND bucket.workspace_id=${input.scope.workspaceId} AND bucket.id=${input.context.budgetBucketId}
          LIMIT 1
        )
        SELECT target.*,reservation.id AS reservation_id,reservation.daily_plan_slot_id AS reservation_slot_id,
          reservation.budget_bucket_id AS reservation_bucket_id,reservation.attempt AS reservation_attempt,
          reservation.amount_micro_usd AS reservation_amount,reservation.currency AS reservation_currency,
          reservation.state AS reservation_state,reservation.submission_state,
          reservation.expires_at AS reservation_expires_at,
          (SELECT count(*) FROM reservation_candidates) AS reservation_candidates
        FROM target LEFT JOIN reservation_candidates reservation ON true
        LIMIT 2
      `));
    } catch (error) {
      if (error instanceof OneVideoHeldAdmissionError) throw error;
      throw new OneVideoHeldAdmissionError("UNAVAILABLE");
    }
    if (observedRows.length < 1 || observedRows.length > 2) throw new OneVideoHeldAdmissionError("UNAVAILABLE");
    const first = observedRows[0]!;
    const observedAt = instant(value(first, "observedAt", "observed_at"));
    if (observedRows.some((row) => instant(value(row, "observedAt", "observed_at")) !== observedAt)) {
      throw new OneVideoHeldAdmissionError("UNAVAILABLE");
    }
    const reservations = projectReservations(observedRows);
    const ambiguous = candidateAmbiguity(first);
    const gates: OneVideoHeldAdmissionReadinessGates = Object.freeze({
      batch: ambiguous.batch ? "unknown" : batchGate(first, input, observedAt),
      slot: ambiguous.slot ? "unknown" : presenceGate(first, "slotCandidates", "slot_candidates",
        bool(first, "slotCurrent", "slot_current")),
      launchIntent: ambiguous.launchIntent ? "unknown" : presenceGate(first, "intentCandidates", "intent_candidates",
        bool(first, "intentCurrent", "intent_current")),
      contentApproval: ambiguous.contentApproval ? "unknown" : evidenceGate(first, "contentCandidates", "content_candidates",
        "contentDecision", "content_decision", bool(first, "contentCurrent", "content_current"), "approved"),
      sandboxProof: ambiguous.sandboxProof ? "unknown" : evidenceGate(first, "sandboxCandidates", "sandbox_candidates",
        "sandboxDecision", "sandbox_decision", bool(first, "sandboxCurrent", "sandbox_current"), "passed"),
      policy: ambiguous.policy ? "unknown" : blockedGate(first, "policyCandidates", "policy_candidates",
        bool(first, "policyCurrent", "policy_current"), text(first, "policyState", "policy_state") !== "active"),
      killSwitch: ambiguous.killSwitch ? "unknown" : blockedGate(first, "killCandidates", "kill_candidates",
        bool(first, "killCurrent", "kill_current"), value(first, "killActive", "kill_active") === true),
      governance: ambiguous.governance ? "unknown" : presenceGate(first, "governanceCandidates", "governance_candidates",
        bool(first, "governanceCurrent", "governance_current")),
      credential: ambiguous.credential ? "unknown" : presenceGate(first, "accountCandidates", "account_candidates",
        bool(first, "credentialCurrent", "credential_current")),
      source: count(first, "sourceCandidates", "source_candidates") > 1 ? "unknown"
        : presenceGate(first, "sourceCandidates", "source_candidates", bool(first, "sourceCurrent", "source_current")),
      providerVerification: providerVerificationGate(first, ambiguous.providerVerification),
      maximumQuote: ambiguous.maximumQuote ? "unknown" : evidenceGate(first, "quoteCandidates", "quote_candidates",
        "quoteDecision", "quote_decision", bool(first, "quoteCurrent", "quote_current")
          && exactQuoteCas(first, input.context), "quoted"),
      humanApproval: ambiguous.humanApproval ? "unknown" : humanGate(first, input.context),
      budget: bool(first, "budgetCurrent", "budget_current") ? "ready" : "blocked",
      concurrency: bool(first, "concurrencyCurrent", "concurrency_current") ? "ready" : "blocked",
    });
    return Object.freeze({ observedAt, gates, reservations: Object.freeze(reservations) });
  }
}

function candidateAmbiguity(row: Row) {
  const overOne = (camel: string, snake: string) => count(row, camel, snake) > 1;
  return {
    batch: overOne("planCandidates", "plan_candidates") || overOne("scriptCandidates", "script_candidates"),
    slot: overOne("slotCandidates", "slot_candidates"),
    launchIntent: overOne("intentCandidates", "intent_candidates"),
    contentApproval: overOne("contentCandidates", "content_candidates"),
    sandboxProof: overOne("sandboxCandidates", "sandbox_candidates"),
    policy: overOne("policyCandidates", "policy_candidates"),
    killSwitch: overOne("killCandidates", "kill_candidates"),
    governance: overOne("governanceCandidates", "governance_candidates"),
    credential: overOne("accountCandidates", "account_candidates"),
    providerVerification: overOne("avatarCandidates", "avatar_candidates")
      || overOne("voiceCandidates", "voice_candidates")
      || overOne("headerCandidates", "header_candidates")
      || overOne("avatarVerificationCandidates", "avatar_verification_candidates")
      || overOne("voiceVerificationCandidates", "voice_verification_candidates"),
    maximumQuote: overOne("quoteCandidates", "quote_candidates"),
    humanApproval: overOne("humanCandidates", "human_candidates") || overOne("bridgeCandidates", "bridge_candidates"),
  };
}

function batchGate(row: Row, input: Readonly<{
  scope: OneVideoHeldAdmissionContext["scope"];
  context: OneVideoHeldAdmissionContext;
}>, observedAt: string): OneVideoHeldAdmissionGateObservation {
  if (count(row, "planCandidates", "plan_candidates") === 0
    || count(row, "scriptCandidates", "script_candidates") === 0) return "missing";
  try {
    const facts: ApprovedProductionBatchSlotFacts = {
      scope: input.scope,
      databaseNow: new Date(observedAt),
      plan: { publicKey: input.context.publicPlanKey, status: text(row, "status", "status"),
        plannedSlotCount: number(row, "plannedSlotCount", "planned_slot_count") },
      planSlots: array(value(row, "planSlots", "plan_slots")),
      slot: { publicKey: input.context.publicSlotKey, status: text(row, "slotStatus", "slot_status"),
        scriptVariantId: text(row, "scriptVariantId", "script_variant_id") },
      script: { id: text(row, "scriptId", "script_id"), title: text(row, "scriptTitle", "script_title"),
        status: text(row, "scriptStatus", "script_status"), currentVariantId: text(row, "currentVariantId", "current_variant_id"),
        metadata: value(row, "scriptMetadata", "script_metadata"), sourceType: text(row, "sourceType", "source_type"),
        sourceItemId: value(row, "sourceItemId", "source_item_id") == null ? null : text(row, "sourceItemId", "source_item_id") },
      source: { id: text(row, "sourceId", "source_id"), type: text(row, "sourceItemType", "source_item_type"),
        title: text(row, "sourceTitle", "source_title"), content: text(row, "sourceContent", "source_content"),
        contentHash: text(row, "sourceContentHash", "source_content_hash"), status: text(row, "sourceStatus", "source_status"),
        rightsStatus: text(row, "rightsStatus", "rights_status"), moderationStatus: text(row, "moderationStatus", "moderation_status") },
      variants: array(value(row, "variants", "variants")),
    } as ApprovedProductionBatchSlotFacts;
    const envelope = readProductionBatchEnvelope(facts.script.metadata);
    return envelope?.batchId === input.context.publicBatchKey
      && verifyApprovedProductionBatchSlotMetadata(facts)
      && facts.plan.plannedSlotCount === count(row, "planSlotCount", "plan_slot_count")
      && count(row, "memberCount", "member_count") >= 5 && count(row, "memberCount", "member_count") <= 10
      && bool(row, "rowsCurrent", "rows_current") && bool(row, "tenEach", "ten_each")
      ? "ready" : "stale";
  } catch { return "unknown"; }
}

function presenceGate(row: Row, countCamel: string, countSnake: string,
  current: boolean): OneVideoHeldAdmissionGateObservation {
  const candidates = count(row, countCamel, countSnake);
  return candidates < 0 ? "unknown" : candidates === 0 ? "missing" : current ? "ready" : "stale";
}

function evidenceGate(row: Row, countCamel: string, countSnake: string, decisionCamel: string,
  decisionSnake: string, current: boolean, accepted: string): OneVideoHeldAdmissionGateObservation {
  const candidates = count(row, countCamel, countSnake);
  if (candidates < 0) return "unknown";
  if (candidates === 0) return "missing";
  return current && text(row, decisionCamel, decisionSnake) === accepted ? "ready" : "stale";
}

function blockedGate(row: Row, countCamel: string, countSnake: string,
  current: boolean, explicitlyBlocked: boolean): OneVideoHeldAdmissionGateObservation {
  const candidates = count(row, countCamel, countSnake);
  return candidates < 0 ? "unknown" : candidates === 0 ? "missing"
    : current ? "ready" : explicitlyBlocked ? "blocked" : "stale";
}

function providerVerificationGate(row: Row, ambiguous: boolean): OneVideoHeldAdmissionGateObservation {
  if (ambiguous) return "unknown";
  if (!text(row, "verificationId", "verification_id")) return "missing";
  return bool(row, "providerVerificationCurrent", "provider_verification_current") ? "ready" : "stale";
}

function humanGate(row: Row, context: OneVideoHeldAdmissionContext): OneVideoHeldAdmissionGateObservation {
  const human = count(row, "humanCandidates", "human_candidates");
  const bridge = count(row, "bridgeCandidates", "bridge_candidates");
  if (human < 0 || bridge < 0) return "unknown";
  if (human === 0 || bridge === 0) return "missing";
  return bool(row, "humanCurrent", "human_current") && exactQuoteCas(row, context)
    && text(row, "humanDecision", "human_decision") === "approved"
    ? "ready" : "stale";
}

function exactQuoteCas(row: Row, context: OneVideoHeldAdmissionContext): boolean {
  try {
    const renderSpecDigest = text(row, "bridgeRenderSpecDigest", "bridge_render_spec_digest") as `sha256:${string}`;
    return deriveRenderSpecKey(renderSpecDigest) === context.publicRenderSpecKey
      && deriveMaximumQuoteKey({
        evidenceId: text(row, "quoteId", "quote_id"),
        evidenceRevision: number(row, "quoteRevision", "quote_revision"),
        evidenceDigest: text(row, "quoteEvidenceDigest", "quote_evidence_digest") as `sha256:${string}`,
        amountMicroUsd: context.maximumQuoteMicroUsd,
        currency: "USD",
        expiresAt: new Date(context.quoteExpiresAt),
        renderSpecDigest,
      }) === context.publicQuoteKey;
  } catch { return false; }
}

function projectReservations(observed: readonly Row[]): OneVideoHeldAdmissionObservedReservation[] {
  const declared = count(observed[0]!, "reservationCandidates", "reservation_candidates");
  if (declared < 0 || declared > 2) throw new OneVideoHeldAdmissionError("UNAVAILABLE");
  const projected = observed.flatMap((row) => {
    const id = text(row, "reservationId", "reservation_id");
    if (!id) return [];
    const state = text(row, "reservationState", "reservation_state");
    const submissionState = text(row, "submissionState", "submission_state");
    const currency = text(row, "reservationCurrency", "reservation_currency");
    const attempt = number(row, "reservationAttempt", "reservation_attempt");
    const amount = text(row, "reservationAmount", "reservation_amount");
    if (!UUID.test(id) || !STATES.has(state) || !SUBMISSION_STATES.has(submissionState)
      || currency !== "USD" || !Number.isSafeInteger(attempt) || attempt < 1
      || !/^[1-9]\d{0,15}$/u.test(amount)) throw new OneVideoHeldAdmissionError("UNAVAILABLE");
    return [Object.freeze({
      reservationId: id,
      dailyPlanSlotId: text(row, "reservationSlotId", "reservation_slot_id"),
      budgetBucketId: text(row, "reservationBucketId", "reservation_bucket_id"),
      slotAttempt: attempt,
      amountMicroUsd: amount,
      currency: "USD" as const,
      state: state as OneVideoHeldAdmissionObservedReservation["state"],
      submissionState: submissionState as OneVideoHeldAdmissionObservedReservation["submissionState"],
      expiresAt: instant(value(row, "reservationExpiresAt", "reservation_expires_at")),
    })];
  });
  if (projected.length !== declared) throw new OneVideoHeldAdmissionError("UNAVAILABLE");
  return projected;
}

function array<T>(raw: unknown): T[] {
  if (Array.isArray(raw)) return raw as T[];
  if (typeof raw === "string") {
    try { const parsed = JSON.parse(raw); if (Array.isArray(parsed)) return parsed as T[]; } catch { /* fail below */ }
  }
  throw new OneVideoHeldAdmissionError("UNAVAILABLE");
}

function assertInput(input: Readonly<{
  scope: OneVideoHeldAdmissionContext["scope"];
  context: OneVideoHeldAdmissionContext;
}>): void {
  const { scope, context } = input ?? {} as never;
  if (!scope || !context || context.scope.ownerUserId !== scope.ownerUserId
    || context.scope.workspaceId !== scope.workspaceId || scope.workspaceId !== "personal"
    || scope.ownerUserId !== scope.ownerUserId.trim() || scope.ownerUserId.length < 1 || scope.ownerUserId.length > 255
    || !UUID.test(context.planId) || !UUID.test(context.dailyPlanSlotId) || !UUID.test(context.budgetBucketId)
    || !PUBLIC_KEY("plan").test(context.publicPlanKey) || !PUBLIC_KEY("batch").test(context.publicBatchKey)
    || !PUBLIC_KEY("slot").test(context.publicSlotKey) || !PUBLIC_KEY("quote").test(context.publicQuoteKey)
    || !PUBLIC_KEY("render_spec").test(context.publicRenderSpecKey)
    || !Number.isSafeInteger(context.slotAttempt) || context.slotAttempt < 1
    || !Number.isSafeInteger(context.expectedSlotStateVersion) || context.expectedSlotStateVersion < 1
    || !Number.isSafeInteger(context.expectedBucketStateVersion) || context.expectedBucketStateVersion < 1
    || !/^[1-9]\d{0,15}$/u.test(context.maximumQuoteMicroUsd)
    || BigInt(context.maximumQuoteMicroUsd) > 9_000_000_000_000_000n
    || context.currency !== "USD" || !Number.isFinite(Date.parse(context.quoteExpiresAt))
    || !Number.isFinite(Date.parse(context.reservationExpiresAt))
    || Date.parse(context.reservationExpiresAt) > Date.parse(context.quoteExpiresAt)) {
    throw new OneVideoHeldAdmissionError("UNAVAILABLE");
  }
}
