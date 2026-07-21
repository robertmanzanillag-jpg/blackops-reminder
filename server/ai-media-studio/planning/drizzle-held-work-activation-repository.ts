import { createHash, randomUUID } from "node:crypto";
import { sql, type SQL } from "drizzle-orm";
import {
  aiMediaBudgetBuckets,
  aiMediaBudgetReservations,
  aiMediaDailyPlans,
  aiMediaDailyPlanSlots,
  aiMediaGovernanceProfiles,
  aiMediaInfluencers,
  aiMediaOutbox,
  aiMediaProviderAccounts,
  aiMediaProviderResources,
  aiMediaRenderJobs,
  aiMediaScripts,
  aiMediaScriptVariants,
  aiMediaSourceItems,
} from "../../../shared/models/ai-media-studio-db";
import type { Sha256Digest } from "./contracts";
import { lockAuthorityIdempotency, lockAuthorityWorkspace, lockGovernanceProfile } from "./authority-locks";
import {
  HeldWorkActivationError,
  heldWorkActivationEvidenceDigest,
  heldWorkActivationInputDigest,
  type ActivateHeldWorkRequest,
  type ActivateHeldWorkResult,
  type DurableWorkActivation,
  type TrustedActivationPrincipal,
  type UnsignedActivateHeldWorkRequest,
} from "./held-work-activation-domain";

const ACTIVATIONS = sql.raw('"ai_media_work_activations"');
const AUTHORITY_SNAPSHOTS = sql.raw('"ai_media_launch_authority_snapshots"');
const LAUNCH_EVIDENCE = sql.raw('"ai_media_launch_evidence"');
const LAUNCH_INTENTS = sql.raw('"ai_media_launch_intents"');
const POLICY_REVISIONS = sql.raw('"ai_media_admission_policy_revisions"');
const KILL_SWITCH_REVISIONS = sql.raw('"ai_media_kill_switch_revisions"');

type ExecuteResult = { rows?: unknown[] } | unknown[];
export type HeldWorkActivationDatabase = { execute(query: SQL): Promise<ExecuteResult> };
export type HeldWorkActivationTransactionalDatabase = HeldWorkActivationDatabase & {
  transaction<T>(callback: (tx: HeldWorkActivationDatabase) => Promise<T>): Promise<T>;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const SHA256 = /^sha256:[0-9a-f]{64}$/u;
const SAFE = /^[A-Za-z0-9][A-Za-z0-9._:/-]*$/u;
const POST_RENDER = new Set(["queued"]);
const POST_OUTBOX = new Set(["pending", "leased", "retry_wait", "dispatched", "dead_letter"]);
const POST_SLOT = new Set(["queued", "committed", "submitted", "reconciling", "completed", "failed", "cancelled"]);

const CREATED_EFFECTS = Object.freeze({
  renderQueued: true, outboxPending: true, slotQueued: true, budgetCommitted: false, providerCalled: false,
} as const);
const REPLAY_EFFECTS = Object.freeze({
  renderQueued: false, outboxPending: false, slotQueued: false, budgetCommitted: false, providerCalled: false,
} as const);

export class DrizzleHeldWorkActivationRepository {
  private readonly accountingTimeZone: string;

  constructor(
    private readonly db: HeldWorkActivationTransactionalDatabase,
    options: { accountingTimeZone: string },
  ) {
    this.accountingTimeZone = validTimeZone(options.accountingTimeZone);
  }

  inputDigest(input: UnsignedActivateHeldWorkRequest): Sha256Digest {
    return heldWorkActivationInputDigest(validateUnsigned(input));
  }

  async activate(input: ActivateHeldWorkRequest): Promise<ActivateHeldWorkResult> {
    const request = validateRequest(input);
    return this.db.transaction(async (tx) => {
      await lockAuthorityIdempotency(tx, request.scope, "activate-held-work", request.idempotencyKey);
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(
        ${`ai-media:work-activation:reservation:${request.scope.ownerUserId}:${request.scope.workspaceId}:${request.budgetReservationId}`},0))`);

      const replay = rows(await tx.execute(sql`
        SELECT activation.*, job.stage AS render_stage, outbox.status AS outbox_status,
          slot.status AS slot_status, slot.state_version AS current_slot_state_version
        FROM ${ACTIVATIONS} activation
        INNER JOIN ${aiMediaRenderJobs} job
          ON job.owner_user_id=activation.owner_user_id AND job.workspace_id=activation.workspace_id
          AND job.id=activation.render_job_id AND job.budget_reservation_id=activation.budget_reservation_id
          AND job.work_handoff_digest=activation.work_handoff_digest
          AND job.sealed_request_digest=activation.sealed_request_digest
        INNER JOIN ${aiMediaOutbox} outbox
          ON outbox.owner_user_id=activation.owner_user_id AND outbox.workspace_id=activation.workspace_id
          AND outbox.id=activation.dispatch_outbox_id
          AND outbox.budget_reservation_id=activation.budget_reservation_id
          AND outbox.render_job_id=activation.render_job_id
          AND outbox.work_handoff_digest=activation.work_handoff_digest
          AND outbox.sealed_request_digest=activation.sealed_request_digest
        INNER JOIN ${aiMediaDailyPlanSlots} slot
          ON slot.owner_user_id=activation.owner_user_id AND slot.workspace_id=activation.workspace_id
          AND slot.id=activation.daily_plan_slot_id
        WHERE activation.owner_user_id=${request.scope.ownerUserId}
          AND activation.workspace_id=${request.scope.workspaceId}
          AND (activation.idempotency_key=${request.idempotencyKey}
            OR activation.budget_reservation_id=${request.budgetReservationId})
        FOR UPDATE OF activation
      `))[0];
      if (replay) return exactReplay(replay, request);

      await tx.execute(sql`
        SELECT pg_advisory_xact_lock(hashtextextended('ai-media:daily-admission:global-concurrency',0))
      `);
      await lockAuthorityWorkspace(tx, request.scope);

      const subject = rows(await tx.execute(sql`
        SELECT job.influencer_id
        FROM ${aiMediaBudgetReservations} reservation
        INNER JOIN ${aiMediaRenderJobs} job
          ON job.owner_user_id=reservation.owner_user_id AND job.workspace_id=reservation.workspace_id
          AND job.id=reservation.render_job_id AND job.budget_reservation_id=reservation.id
          AND job.work_handoff_digest=reservation.work_handoff_digest
        WHERE reservation.owner_user_id=${request.scope.ownerUserId}
          AND reservation.workspace_id=${request.scope.workspaceId}
          AND reservation.id=${request.budgetReservationId}
          AND reservation.work_handoff_digest=${request.workHandoffDigest}
        LIMIT 2
      `));
      if (subject.length !== 1 || !UUID.test(String(at(subject[0], "influencerId", "influencer_id")))) {
        throw denied("Exact admitted work was not found");
      }
      await lockGovernanceProfile(tx, request.scope, String(at(subject[0], "influencerId", "influencer_id")));

      // A nullable source cannot participate in PostgreSQL's FOR UPDATE clause.
      // Resolve the immutable intent first, then lock the exact non-manual
      // source row separately so rights/status/hash cannot race activation.
      const sourceBinding = rows(await tx.execute(sql`
        SELECT intent.source_type,intent.source_item_id,intent.source_content_hash
        FROM ${aiMediaBudgetReservations} reservation
        INNER JOIN ${aiMediaRenderJobs} job ON job.id=reservation.render_job_id
          AND job.owner_user_id=reservation.owner_user_id AND job.workspace_id=reservation.workspace_id
        INNER JOIN ${LAUNCH_INTENTS} intent ON intent.id=job.launch_intent_id
          AND intent.owner_user_id=job.owner_user_id AND intent.workspace_id=job.workspace_id
          AND intent.launch_intent_digest=job.launch_intent_digest
        WHERE reservation.owner_user_id=${request.scope.ownerUserId}
          AND reservation.workspace_id=${request.scope.workspaceId}
          AND reservation.id=${request.budgetReservationId}
          AND reservation.work_handoff_digest=${request.workHandoffDigest}
        FOR UPDATE OF intent
      `));
      if (sourceBinding.length !== 1) throw denied("Exact launch intent was not found");
      const sourceType = String(at(sourceBinding[0],"sourceType","source_type"));
      const sourceId = at(sourceBinding[0],"sourceItemId","source_item_id");
      const sourceHash = at(sourceBinding[0],"sourceContentHash","source_content_hash");
      if (sourceType === "manual") {
        if (sourceId != null || sourceHash != null) throw denied("Manual intent has a source binding");
      } else {
        if (!UUID.test(String(sourceId)) || !SHA256.test(String(sourceHash))) throw denied("Non-manual intent has no exact source binding");
        const lockedSource = rows(await tx.execute(sql`
          SELECT id FROM ${aiMediaSourceItems}
          WHERE owner_user_id=${request.scope.ownerUserId} AND workspace_id=${request.scope.workspaceId}
            AND id=${String(sourceId)} AND source_type=${sourceType} AND content_hash=${String(sourceHash)}
            AND status IN ('accepted','ready') AND moderation_status='approved'
            AND rights_status IN ('owned','licensed')
          FOR UPDATE
        `));
        if (lockedSource.length !== 1) throw denied("Current source rights do not allow activation");
      }

      const gateRows = rows(await tx.execute(sql`
        WITH sampled_clock AS MATERIALIZED (SELECT clock_timestamp() AS observed_at),
        fresh_clock AS MATERIALIZED (
          SELECT observed_at,(observed_at AT TIME ZONE ${this.accountingTimeZone})::date AS budget_date
          FROM sampled_clock
        )
        SELECT reservation.id AS budget_reservation_id,reservation.render_job_id,
          reservation.dispatch_outbox_id,reservation.daily_plan_slot_id,reservation.attempt AS slot_attempt,
          reservation.provider_account_id,reservation.provider_key,reservation.provider_credential_version,
          reservation.provider_idempotency_key,reservation.script_variant_checksum,
          reservation.authority_snapshot_id,reservation.authority_digest,reservation.admission_digest,
          reservation.work_handoff_digest,job.sealed_request_digest,
          job.launch_intent_id,job.launch_intent_digest,slot.state_version AS slot_state_version_before,
          variant.content AS script_content,variant.checksum AS locked_script_checksum,
          job.request AS request_json,job.script_variant_id,job.source_item_id,job.source_content_hash,
          job.avatar_resource_id,job.voice_resource_id,
          fresh_clock.observed_at
        FROM ${aiMediaBudgetReservations} reservation
        INNER JOIN ${aiMediaRenderJobs} job
          ON job.owner_user_id=reservation.owner_user_id AND job.workspace_id=reservation.workspace_id
          AND job.id=reservation.render_job_id AND job.budget_reservation_id=reservation.id
          AND job.daily_plan_slot_id=reservation.daily_plan_slot_id AND job.slot_attempt=reservation.attempt
          AND job.provider_account_id=reservation.provider_account_id
          AND job.provider_key=reservation.provider_key
          AND job.provider_credential_version=reservation.provider_credential_version
          AND job.script_variant_checksum=reservation.script_variant_checksum
          AND job.authority_snapshot_id=reservation.authority_snapshot_id
          AND job.authority_digest=reservation.authority_digest
          AND job.admission_digest=reservation.admission_digest
          AND job.work_handoff_digest=reservation.work_handoff_digest
          AND job.idempotency_key=reservation.provider_idempotency_key
        INNER JOIN ${aiMediaOutbox} outbox
          ON outbox.owner_user_id=reservation.owner_user_id AND outbox.workspace_id=reservation.workspace_id
          AND outbox.id=reservation.dispatch_outbox_id AND outbox.budget_reservation_id=reservation.id
          AND outbox.render_job_id=job.id AND outbox.work_handoff_digest=reservation.work_handoff_digest
          AND outbox.sealed_request_digest=job.sealed_request_digest
        INNER JOIN ${AUTHORITY_SNAPSHOTS} snapshot
          ON snapshot.owner_user_id=reservation.owner_user_id AND snapshot.workspace_id=reservation.workspace_id
          AND snapshot.id=reservation.authority_snapshot_id AND snapshot.authority_digest=reservation.authority_digest
          AND snapshot.daily_plan_slot_id=reservation.daily_plan_slot_id AND snapshot.slot_attempt=reservation.attempt
          AND snapshot.admission_digest=reservation.admission_digest
          AND snapshot.provider_account_id=reservation.provider_account_id
          AND snapshot.provider_key=reservation.provider_key
          AND snapshot.provider_credential_version=reservation.provider_credential_version
          AND snapshot.script_variant_checksum=reservation.script_variant_checksum
          AND snapshot.launch_intent_id=job.launch_intent_id
          AND snapshot.launch_intent_digest=job.launch_intent_digest
        INNER JOIN ${LAUNCH_INTENTS} intent
          ON intent.owner_user_id=snapshot.owner_user_id AND intent.workspace_id=snapshot.workspace_id
          AND intent.id=snapshot.launch_intent_id AND intent.launch_intent_digest=snapshot.launch_intent_digest
          AND intent.daily_plan_id=snapshot.daily_plan_id AND intent.daily_plan_slot_id=snapshot.daily_plan_slot_id
          AND intent.slot_attempt=snapshot.slot_attempt AND intent.provider_account_id=snapshot.provider_account_id
          AND intent.provider_key=snapshot.provider_key
          AND intent.provider_credential_version=snapshot.provider_credential_version
          AND intent.script_variant_id=snapshot.script_variant_id
          AND intent.script_variant_checksum=snapshot.script_variant_checksum
          AND intent.governance_profile_id=snapshot.governance_profile_id
          AND intent.governance_evidence_digest=snapshot.governance_evidence_digest
          AND intent.launch_subject_digest=snapshot.launch_subject_digest
        INNER JOIN ${LAUNCH_EVIDENCE} content ON content.id=snapshot.content_approval_evidence_id
          AND content.owner_user_id=snapshot.owner_user_id AND content.workspace_id=snapshot.workspace_id
          AND content.evidence_digest=snapshot.content_approval_evidence_digest
          AND content.launch_intent_id=intent.id AND content.launch_intent_digest=intent.launch_intent_digest
        INNER JOIN ${LAUNCH_EVIDENCE} human ON human.id=snapshot.human_launch_approval_evidence_id
          AND human.owner_user_id=snapshot.owner_user_id AND human.workspace_id=snapshot.workspace_id
          AND human.evidence_digest=snapshot.human_launch_approval_evidence_digest
          AND human.launch_intent_id=intent.id AND human.launch_intent_digest=intent.launch_intent_digest
        INNER JOIN ${LAUNCH_EVIDENCE} sandbox ON sandbox.id=snapshot.sandbox_evidence_id
          AND sandbox.owner_user_id=snapshot.owner_user_id AND sandbox.workspace_id=snapshot.workspace_id
          AND sandbox.evidence_digest=snapshot.sandbox_evidence_digest
          AND sandbox.launch_intent_id=intent.id AND sandbox.launch_intent_digest=intent.launch_intent_digest
        INNER JOIN ${LAUNCH_EVIDENCE} quote ON quote.id=snapshot.maximum_quote_evidence_id
          AND quote.owner_user_id=snapshot.owner_user_id AND quote.workspace_id=snapshot.workspace_id
          AND quote.evidence_digest=snapshot.maximum_quote_evidence_digest
          AND quote.launch_intent_id=intent.id AND quote.launch_intent_digest=intent.launch_intent_digest
        INNER JOIN ${POLICY_REVISIONS} policy ON policy.id=snapshot.policy_revision_id
          AND policy.owner_user_id=snapshot.owner_user_id AND policy.workspace_id=snapshot.workspace_id
          AND policy.revision=snapshot.policy_revision AND policy.policy_digest=snapshot.policy_digest
        INNER JOIN ${KILL_SWITCH_REVISIONS} kill ON kill.id=snapshot.kill_switch_revision_id
          AND kill.owner_user_id=snapshot.owner_user_id AND kill.workspace_id=snapshot.workspace_id
          AND kill.revision=snapshot.kill_switch_revision
          AND kill.evidence_digest=snapshot.kill_switch_evidence_digest
        INNER JOIN ${aiMediaDailyPlans} plan ON plan.id=snapshot.daily_plan_id
          AND plan.owner_user_id=snapshot.owner_user_id AND plan.workspace_id=snapshot.workspace_id
          AND plan.plan_digest=snapshot.plan_digest
        INNER JOIN ${aiMediaDailyPlanSlots} slot ON slot.id=reservation.daily_plan_slot_id
          AND slot.owner_user_id=reservation.owner_user_id AND slot.workspace_id=reservation.workspace_id
          AND slot.daily_plan_id=plan.id AND slot.slot_digest=snapshot.slot_digest
          AND slot.provider_account_id=reservation.provider_account_id
          AND slot.provider_key=reservation.provider_key
          AND slot.provider_credential_version=reservation.provider_credential_version
          AND slot.script_variant_id=snapshot.script_variant_id
          AND slot.influencer_id=job.influencer_id
          AND slot.avatar_resource_id=job.avatar_resource_id
          AND slot.voice_resource_id=job.voice_resource_id
        INNER JOIN ${aiMediaBudgetBuckets} bucket ON bucket.id=reservation.budget_bucket_id
          AND bucket.owner_user_id=reservation.owner_user_id AND bucket.workspace_id=reservation.workspace_id
          AND bucket.currency=reservation.currency
        INNER JOIN ${aiMediaProviderAccounts} account ON account.id=reservation.provider_account_id
          AND account.owner_user_id=reservation.owner_user_id AND account.workspace_id=reservation.workspace_id
          AND account.provider_key=reservation.provider_key
        INNER JOIN ${aiMediaGovernanceProfiles} governance ON governance.id=snapshot.governance_profile_id
          AND governance.owner_user_id=snapshot.owner_user_id AND governance.workspace_id=snapshot.workspace_id
          AND governance.influencer_id=slot.influencer_id
          AND governance.avatar_resource_id=job.avatar_resource_id
          AND governance.voice_resource_id=job.voice_resource_id
          AND governance.evidence_digest=snapshot.governance_evidence_digest
        INNER JOIN ${aiMediaInfluencers} influencer ON influencer.id=slot.influencer_id
          AND influencer.owner_user_id=slot.owner_user_id AND influencer.workspace_id=slot.workspace_id
        INNER JOIN ${aiMediaProviderResources} avatar ON avatar.id=slot.avatar_resource_id
          AND avatar.id=job.avatar_resource_id
          AND avatar.owner_user_id=slot.owner_user_id AND avatar.workspace_id=slot.workspace_id
          AND avatar.provider_account_id=reservation.provider_account_id
          AND avatar.provider_key=reservation.provider_key AND avatar.resource_type='avatar'
        INNER JOIN ${aiMediaProviderResources} voice ON voice.id=slot.voice_resource_id
          AND voice.id=job.voice_resource_id
          AND voice.owner_user_id=slot.owner_user_id AND voice.workspace_id=slot.workspace_id
          AND voice.provider_account_id=reservation.provider_account_id
          AND voice.provider_key=reservation.provider_key AND voice.resource_type='voice'
        INNER JOIN ${aiMediaScriptVariants} variant ON variant.id=snapshot.script_variant_id
          AND variant.owner_user_id=snapshot.owner_user_id AND variant.workspace_id=snapshot.workspace_id
          AND variant.checksum=snapshot.script_variant_checksum
        INNER JOIN ${aiMediaScripts} script ON script.id=variant.script_id
          AND script.owner_user_id=variant.owner_user_id AND script.workspace_id=variant.workspace_id
          AND script.id=intent.script_id AND script.current_variant_id=variant.id
          AND script.influencer_id=slot.influencer_id AND script.influencer_id=job.influencer_id
        LEFT JOIN ${aiMediaSourceItems} source ON source.id=intent.source_item_id
          AND source.owner_user_id=intent.owner_user_id AND source.workspace_id=intent.workspace_id
          AND source.source_type=intent.source_type AND source.content_hash=intent.source_content_hash
        CROSS JOIN fresh_clock
        WHERE reservation.owner_user_id=${request.scope.ownerUserId}
          AND reservation.workspace_id=${request.scope.workspaceId}
          AND reservation.id=${request.budgetReservationId}
          AND reservation.work_handoff_digest=${request.workHandoffDigest}
          AND reservation.state='reserved' AND reservation.submission_state='not_started'
          AND reservation.expires_at>fresh_clock.observed_at
          AND reservation.quote_expires_at>fresh_clock.observed_at
          AND job.stage='admission_held' AND job.status='pending' AND job.provider_job_id IS NULL
          AND job.attempts=0 AND job.retry_count=0 AND job.lease_owner IS NULL AND job.lease_expires_at IS NULL
          AND outbox.status='held' AND outbox.attempts=0 AND outbox.fencing_token=0
          AND outbox.lease_owner IS NULL AND outbox.lease_expires_at IS NULL
          AND slot.status='reserved' AND plan.status='planned'
          AND plan.plan_date=fresh_clock.budget_date AND plan.accounting_time_zone=${this.accountingTimeZone}
          AND snapshot.valid_from<=fresh_clock.observed_at AND snapshot.expires_at>fresh_clock.observed_at
          AND content.evidence_kind='content_approval' AND content.decision='approved'
          AND human.evidence_kind='human_launch_approval' AND human.decision='approved'
          AND sandbox.evidence_kind='sandbox_proof' AND sandbox.decision='passed'
          AND quote.evidence_kind='maximum_quote' AND quote.decision='quoted'
          AND content.valid_from<=fresh_clock.observed_at AND content.expires_at>fresh_clock.observed_at
          AND human.valid_from<=fresh_clock.observed_at AND human.expires_at>fresh_clock.observed_at
          AND sandbox.valid_from<=fresh_clock.observed_at AND sandbox.expires_at>fresh_clock.observed_at
          AND quote.valid_from<=fresh_clock.observed_at AND quote.expires_at>fresh_clock.observed_at
          AND reservation.content_approval_digest=content.evidence_digest
          AND reservation.human_launch_approval_digest=human.evidence_digest
          AND reservation.sandbox_evidence_digest=sandbox.evidence_digest
          AND reservation.quote_digest=quote.evidence_digest AND reservation.currency='USD'
          AND quote.currency='USD' AND snapshot.currency='USD'
          AND reservation.amount_micro_usd=quote.amount_micro_usd
          AND snapshot.maximum_quote_micro_usd=quote.amount_micro_usd
          AND policy.state='active' AND policy.valid_from<=fresh_clock.observed_at
          AND (policy.expires_at IS NULL OR policy.expires_at>fresh_clock.observed_at)
          AND reservation.policy_digest=policy.policy_digest
          AND policy.allowed_time_zones @> jsonb_build_array(${this.accountingTimeZone}::text)
          AND policy.allowed_countries @> jsonb_build_array(snapshot.content_country)
          AND policy.allowed_languages @> jsonb_build_array(script.language)
          AND kill.active=false AND kill.valid_from<=fresh_clock.observed_at
          AND (kill.expires_at IS NULL OR kill.expires_at>fresh_clock.observed_at)
          AND reservation.kill_switch_evidence_digest=kill.evidence_digest
          AND account.credential_version=reservation.provider_credential_version
          AND account.status IN ('active','connected') AND account.credential_status='active'
          AND (account.credential_expires_at IS NULL OR account.credential_expires_at>fresh_clock.observed_at)
          AND influencer.status='active' AND influencer.archived_at IS NULL
          AND avatar.status='active' AND voice.status='active'
          AND variant.status='approved' AND script.status='approved' AND script.archived_at IS NULL
          AND governance.state='active' AND governance.revoked_at IS NULL
          AND governance.valid_from<=fresh_clock.observed_at AND governance.expires_at>fresh_clock.observed_at
          AND governance.allowed_uses @> jsonb_build_array(snapshot.governance_use)
          AND (governance.territories @> jsonb_build_array(snapshot.governance_territory)
            OR governance.territories @> '["WORLDWIDE"]'::jsonb)
          AND ((intent.source_type='manual' AND intent.source_item_id IS NULL AND intent.source_content_hash IS NULL)
            OR (intent.source_type<>'manual' AND source.id IS NOT NULL
              AND source.status IN ('accepted','ready') AND source.moderation_status='approved'
              AND source.rights_status IN ('owned','licensed')))
          AND bucket.budget_date=fresh_clock.budget_date AND bucket.accounting_time_zone=${this.accountingTimeZone}
          AND bucket.policy_digest=policy.policy_digest AND bucket.policy_version=policy.revision
          AND bucket.limit_micro_usd=policy.daily_budget_micro_usd
          AND bucket.reserved_micro_usd>=reservation.amount_micro_usd
          AND bucket.reserved_micro_usd+bucket.committed_micro_usd<=bucket.limit_micro_usd
          AND (SELECT count(*) FROM ${aiMediaBudgetReservations} active
            WHERE active.state='committed' OR (active.state='reserved' AND active.expires_at>fresh_clock.observed_at))
            <=policy.total_concurrency
          AND (SELECT count(*) FROM ${aiMediaBudgetReservations} active
            WHERE active.provider_key=reservation.provider_key
              AND (active.state='committed' OR (active.state='reserved' AND active.expires_at>fresh_clock.observed_at)))
            <=policy.provider_concurrency
          AND (SELECT count(*) FROM ${aiMediaBudgetReservations} active
            WHERE active.owner_user_id=reservation.owner_user_id AND active.workspace_id=reservation.workspace_id
              AND (active.state='committed' OR (active.state='reserved' AND active.expires_at>fresh_clock.observed_at)))
            <=policy.tenant_concurrency
          AND NOT EXISTS (SELECT 1 FROM ${LAUNCH_EVIDENCE} newer
            WHERE newer.owner_user_id=content.owner_user_id AND newer.workspace_id=content.workspace_id
              AND newer.daily_plan_slot_id=content.daily_plan_slot_id AND newer.slot_attempt=content.slot_attempt
              AND newer.evidence_kind=content.evidence_kind AND newer.revision>content.revision)
          AND NOT EXISTS (SELECT 1 FROM ${LAUNCH_EVIDENCE} newer
            WHERE newer.owner_user_id=human.owner_user_id AND newer.workspace_id=human.workspace_id
              AND newer.daily_plan_slot_id=human.daily_plan_slot_id AND newer.slot_attempt=human.slot_attempt
              AND newer.evidence_kind=human.evidence_kind AND newer.revision>human.revision)
          AND NOT EXISTS (SELECT 1 FROM ${LAUNCH_EVIDENCE} newer
            WHERE newer.owner_user_id=sandbox.owner_user_id AND newer.workspace_id=sandbox.workspace_id
              AND newer.daily_plan_slot_id=sandbox.daily_plan_slot_id AND newer.slot_attempt=sandbox.slot_attempt
              AND newer.evidence_kind=sandbox.evidence_kind AND newer.revision>sandbox.revision)
          AND NOT EXISTS (SELECT 1 FROM ${LAUNCH_EVIDENCE} newer
            WHERE newer.owner_user_id=quote.owner_user_id AND newer.workspace_id=quote.workspace_id
              AND newer.daily_plan_slot_id=quote.daily_plan_slot_id AND newer.slot_attempt=quote.slot_attempt
              AND newer.evidence_kind=quote.evidence_kind AND newer.revision>quote.revision)
          AND NOT EXISTS (SELECT 1 FROM ${POLICY_REVISIONS} newer
            WHERE newer.owner_user_id=policy.owner_user_id AND newer.workspace_id=policy.workspace_id
              AND newer.revision>policy.revision)
          AND NOT EXISTS (SELECT 1 FROM ${KILL_SWITCH_REVISIONS} newer
            WHERE newer.owner_user_id=kill.owner_user_id AND newer.workspace_id=kill.workspace_id
              AND newer.revision>kill.revision)
          AND NOT EXISTS (SELECT 1 FROM ${aiMediaGovernanceProfiles} newer
            WHERE newer.owner_user_id=governance.owner_user_id AND newer.workspace_id=governance.workspace_id
              AND newer.influencer_id=governance.influencer_id AND newer.version>governance.version)
        FOR UPDATE OF reservation,job,outbox,snapshot,intent,content,human,sandbox,quote,policy,kill,
          plan,slot,bucket,account,governance,influencer,avatar,voice,variant,script
      `));
      if (gateRows.length !== 1) throw denied("Current durable authority does not allow activation");
      const gate = gateRows[0];
      const scriptContent = String(at(gate,"scriptContent","script_content"));
      const lockedChecksum = String(at(gate,"lockedScriptChecksum","locked_script_checksum"));
      if (!/^[0-9a-f]{64}$/u.test(lockedChecksum)
        || createHash("sha256").update(scriptContent).digest("hex")!==lockedChecksum
        || lockedChecksum!==String(at(gate,"scriptVariantChecksum","script_variant_checksum"))) {
        throw invariant("Locked approved script content does not match its checksum");
      }
      const sealedRequestDigest = sha256(JSON.stringify(canonicalJson({
        version:1,request:at(gate,"requestJson","request_json"),reservationId:request.budgetReservationId,
        renderJobId:dbUuid(gate,"renderJobId","render_job_id"),
        outboxId:dbUuid(gate,"dispatchOutboxId","dispatch_outbox_id"),
        slotId:dbUuid(gate,"dailyPlanSlotId","daily_plan_slot_id"),
        slotAttempt:positive(at(gate,"slotAttempt","slot_attempt"),"slotAttempt"),
        authoritySnapshotId:dbUuid(gate,"authoritySnapshotId","authority_snapshot_id"),
        authorityDigest:dbDigest(gate,"authorityDigest","authority_digest"),
        launchIntentId:dbUuid(gate,"launchIntentId","launch_intent_id"),
        launchIntentDigest:dbDigest(gate,"launchIntentDigest","launch_intent_digest"),
        admissionDigest:dbDigest(gate,"admissionDigest","admission_digest"),
        providerAccountId:dbUuid(gate,"providerAccountId","provider_account_id"),
        providerKey:String(at(gate,"providerKey","provider_key")),
        providerCredentialVersion:positive(at(gate,"providerCredentialVersion","provider_credential_version"),"providerCredentialVersion"),
        scriptVariantId:dbUuid(gate,"scriptVariantId","script_variant_id"),scriptVariantChecksum:lockedChecksum,
        sourceItemId:at(gate,"sourceItemId","source_item_id")??null,
        sourceContentHash:at(gate,"sourceContentHash","source_content_hash")??null,
        avatarResourceId:dbUuid(gate,"avatarResourceId","avatar_resource_id"),
        voiceResourceId:dbUuid(gate,"voiceResourceId","voice_resource_id"),
      })));
      if (sealedRequestDigest!==dbDigest(gate,"sealedRequestDigest","sealed_request_digest")) {
        throw invariant("Locked work no longer matches its sealed request digest");
      }
      const recomputedHandoff = sha256(JSON.stringify(canonicalJson({
        version:1,reservationId:request.budgetReservationId,
        renderJobId:dbUuid(gate,"renderJobId","render_job_id"),
        outboxId:dbUuid(gate,"dispatchOutboxId","dispatch_outbox_id"),sealedRequestDigest,
        authorityDigest:dbDigest(gate,"authorityDigest","authority_digest"),
        launchIntentDigest:dbDigest(gate,"launchIntentDigest","launch_intent_digest"),
        admissionDigest:dbDigest(gate,"admissionDigest","admission_digest"),
      })));
      if (recomputedHandoff!==request.workHandoffDigest) throw invariant("Locked work handoff digest is invalid");
      const activationId = randomUUID();
      const activatedAt = iso(at(gate, "observedAt", "observed_at"));
      const before = positive(at(gate, "slotStateVersionBefore", "slot_state_version_before"), "slotStateVersionBefore");
      const after = before + 1;
      const activationDigest = heldWorkActivationEvidenceDigest({
        request, activationId,
        renderJobId: dbUuid(gate, "renderJobId", "render_job_id"),
        dispatchOutboxId: dbUuid(gate, "dispatchOutboxId", "dispatch_outbox_id"),
        dailyPlanSlotId: dbUuid(gate, "dailyPlanSlotId", "daily_plan_slot_id"),
        slotAttempt: positive(at(gate, "slotAttempt", "slot_attempt"), "slotAttempt"),
        authoritySnapshotId: dbUuid(gate, "authoritySnapshotId", "authority_snapshot_id"),
        authorityDigest: dbDigest(gate, "authorityDigest", "authority_digest"),
        launchIntentId: dbUuid(gate, "launchIntentId", "launch_intent_id"),
        launchIntentDigest: dbDigest(gate, "launchIntentDigest", "launch_intent_digest"),
        admissionDigest: dbDigest(gate, "admissionDigest", "admission_digest"),
        sealedRequestDigest: dbDigest(gate, "sealedRequestDigest", "sealed_request_digest"),
        providerIdempotencyKey: String(at(gate, "providerIdempotencyKey", "provider_idempotency_key")),
        slotStateVersionBefore: before, slotStateVersionAfter: after, activatedAt,
      });

      const inserted = rows(await tx.execute(sql`
        INSERT INTO ${ACTIVATIONS} (
          id,owner_user_id,workspace_id,budget_reservation_id,render_job_id,dispatch_outbox_id,
          daily_plan_slot_id,slot_attempt,provider_account_id,provider_key,provider_credential_version,
          provider_idempotency_key,script_variant_checksum,authority_snapshot_id,authority_digest,
          launch_intent_id,launch_intent_digest,admission_digest,work_handoff_digest,sealed_request_digest,
          slot_state_version_before,slot_state_version_after,actor_user_id,idempotency_key,input_digest,
          activation_digest,activated_at,created_at
        ) VALUES (
          ${activationId},${request.scope.ownerUserId},${request.scope.workspaceId},${request.budgetReservationId},
          ${dbUuid(gate,"renderJobId","render_job_id")},${dbUuid(gate,"dispatchOutboxId","dispatch_outbox_id")},
          ${dbUuid(gate,"dailyPlanSlotId","daily_plan_slot_id")},${positive(at(gate,"slotAttempt","slot_attempt"),"slotAttempt")},
          ${dbUuid(gate,"providerAccountId","provider_account_id")},${String(at(gate,"providerKey","provider_key"))},
          ${positive(at(gate,"providerCredentialVersion","provider_credential_version"),"providerCredentialVersion")},
          ${String(at(gate,"providerIdempotencyKey","provider_idempotency_key"))},
          ${String(at(gate,"scriptVariantChecksum","script_variant_checksum"))},
          ${dbUuid(gate,"authoritySnapshotId","authority_snapshot_id")},${dbDigest(gate,"authorityDigest","authority_digest")},
          ${dbUuid(gate,"launchIntentId","launch_intent_id")},${dbDigest(gate,"launchIntentDigest","launch_intent_digest")},
          ${dbDigest(gate,"admissionDigest","admission_digest")},${request.workHandoffDigest},
          ${dbDigest(gate,"sealedRequestDigest","sealed_request_digest")},${before},${after},${request.requestedBy},
          ${request.idempotencyKey},${request.inputDigest},${activationDigest},${new Date(activatedAt)},${new Date(activatedAt)}
        ) RETURNING *
      `));
      if (inserted.length !== 1) throw invariant("Activation evidence was not inserted exactly once");

      const render = rows(await tx.execute(sql`
        UPDATE ${aiMediaRenderJobs} SET stage='queued',available_at=${new Date(activatedAt)},updated_at=${new Date(activatedAt)}
        WHERE owner_user_id=${request.scope.ownerUserId} AND workspace_id=${request.scope.workspaceId}
          AND id=${dbUuid(gate,"renderJobId","render_job_id")} AND budget_reservation_id=${request.budgetReservationId}
          AND work_handoff_digest=${request.workHandoffDigest} AND stage='admission_held'
        RETURNING id
      `));
      const outbox = rows(await tx.execute(sql`
        UPDATE ${aiMediaOutbox} SET status='pending',available_at=${new Date(activatedAt)},updated_at=${new Date(activatedAt)}
        WHERE owner_user_id=${request.scope.ownerUserId} AND workspace_id=${request.scope.workspaceId}
          AND id=${dbUuid(gate,"dispatchOutboxId","dispatch_outbox_id")} AND budget_reservation_id=${request.budgetReservationId}
          AND work_handoff_digest=${request.workHandoffDigest} AND status='held'
        RETURNING id
      `));
      const slot = rows(await tx.execute(sql`
        UPDATE ${aiMediaDailyPlanSlots} SET status='queued',state_version=${after},updated_at=${new Date(activatedAt)}
        WHERE owner_user_id=${request.scope.ownerUserId} AND workspace_id=${request.scope.workspaceId}
          AND id=${dbUuid(gate,"dailyPlanSlotId","daily_plan_slot_id")} AND status='reserved' AND state_version=${before}
        RETURNING id
      `));
      if (render.length !== 1 || outbox.length !== 1 || slot.length !== 1) {
        throw invariant("Atomic activation CAS did not transition the exact triplet");
      }
      return { activation: activationFromRow(inserted[0]), replayed: false, effects: CREATED_EFFECTS };
    });
  }
}

function validateUnsigned(input: UnsignedActivateHeldWorkRequest): UnsignedActivateHeldWorkRequest {
  return {
    scope: { ownerUserId: safe(input.scope.ownerUserId,"ownerUserId",255), workspaceId: safe(input.scope.workspaceId,"workspaceId",255) },
    budgetReservationId: uuid(input.budgetReservationId,"budgetReservationId"),
    workHandoffDigest: digest(input.workHandoffDigest,"workHandoffDigest"),
    requestedBy: safe(input.requestedBy,"requestedBy",200),
    idempotencyKey: safe(input.idempotencyKey,"idempotencyKey",200,8),
  };
}
function validateRequest(input: ActivateHeldWorkRequest): ActivateHeldWorkRequest {
  const unsigned = validateUnsigned(input);
  const principal = validatePrincipal(input.principal, unsigned.requestedBy);
  const inputDigest = digest(input.inputDigest,"inputDigest");
  if (inputDigest !== heldWorkActivationInputDigest(unsigned)) throw invalid("inputDigest does not bind the activation command");
  return { ...unsigned, inputDigest, principal };
}
function validatePrincipal(principal: TrustedActivationPrincipal, requestedBy: string): TrustedActivationPrincipal {
  if (!principal || principal.capability!=="activate-held-work" || principal.actorUserId!==requestedBy) {
    throw denied("A matching trusted activation capability is required");
  }
  return principal;
}
function exactReplay(row: Record<string,unknown>, request: ActivateHeldWorkRequest): ActivateHeldWorkResult {
  const activation = activationFromRow(row);
  if (String(at(row,"inputDigest","input_digest"))!==request.inputDigest
    || String(at(row,"idempotencyKey","idempotency_key"))!==request.idempotencyKey
    || activation.budgetReservationId!==request.budgetReservationId
    || activation.workHandoffDigest!==request.workHandoffDigest
    || String(at(row,"actorUserId","actor_user_id"))!==request.requestedBy) {
    throw new HeldWorkActivationError("IDEMPOTENCY_CONFLICT","Activation idempotency key is bound to another command");
  }
  if (!POST_RENDER.has(String(at(row,"renderStage","render_stage")))
    || !POST_OUTBOX.has(String(at(row,"outboxStatus","outbox_status")))
    || !POST_SLOT.has(String(at(row,"slotStatus","slot_status")))
    || Number(at(row,"currentSlotStateVersion","current_slot_state_version"))<activation.slotStateVersionAfter) {
    throw invariant("Existing activation no longer has an exact monotonic triplet");
  }
  return { activation,replayed:true,effects:REPLAY_EFFECTS };
}
function activationFromRow(row: Record<string,unknown>): DurableWorkActivation { return {
  id:dbUuid(row,"id","id"),budgetReservationId:dbUuid(row,"budgetReservationId","budget_reservation_id"),
  renderJobId:dbUuid(row,"renderJobId","render_job_id"),dispatchOutboxId:dbUuid(row,"dispatchOutboxId","dispatch_outbox_id"),
  dailyPlanSlotId:dbUuid(row,"dailyPlanSlotId","daily_plan_slot_id"),slotAttempt:positive(at(row,"slotAttempt","slot_attempt"),"slotAttempt"),
  workHandoffDigest:dbDigest(row,"workHandoffDigest","work_handoff_digest"),sealedRequestDigest:dbDigest(row,"sealedRequestDigest","sealed_request_digest"),
  activationDigest:dbDigest(row,"activationDigest","activation_digest"),activatedAt:iso(at(row,"activatedAt","activated_at")),
  slotStateVersionBefore:positive(at(row,"slotStateVersionBefore","slot_state_version_before"),"slotStateVersionBefore"),
  slotStateVersionAfter:positive(at(row,"slotStateVersionAfter","slot_state_version_after"),"slotStateVersionAfter"),
}; }
function rows(result:ExecuteResult):Record<string,unknown>[] { const value=Array.isArray(result)?result:result.rows; return Array.isArray(value)?value as Record<string,unknown>[]:[]; }
function at(row:Record<string,unknown>,camel:string,snake:string):unknown{return row[camel]??row[snake];}
function dbUuid(row:Record<string,unknown>,camel:string,snake:string):string{return uuid(String(at(row,camel,snake)),snake);}
function dbDigest(row:Record<string,unknown>,camel:string,snake:string):Sha256Digest{return digest(String(at(row,camel,snake)),snake);}
function uuid(value:string,field:string):string{if(!UUID.test(value))throw invalid(`${field} must be a lowercase RFC 4122 UUID`);return value;}
function digest(value:string,field:string):Sha256Digest{if(!SHA256.test(value))throw invalid(`${field} must be a lowercase SHA-256 digest`);return value as Sha256Digest;}
function safe(value:string,field:string,max:number,min=1):string{if(typeof value!=="string"||value.length<min||value.length>max||!SAFE.test(value))throw invalid(`${field} is invalid`);return value;}
function positive(value:unknown,field:string):number{const result=Number(value);if(!Number.isSafeInteger(result)||result<1)throw invariant(`Database returned invalid ${field}`);return result;}
function iso(value:unknown):string{const date=value instanceof Date?value:new Date(String(value));if(Number.isNaN(date.getTime()))throw invariant("Database returned invalid time");return date.toISOString();}
function validTimeZone(value:string):string{try{if(typeof value!=="string"||value.length>80||new Intl.DateTimeFormat("en-US",{timeZone:value}).resolvedOptions().timeZone!==value)throw new Error();}catch{throw invalid("accountingTimeZone must be canonical");}return value;}
function canonicalJson(value:unknown):unknown{if(Array.isArray(value))return value.map(canonicalJson);if(value&&typeof value==="object")return Object.fromEntries(Object.entries(value as Record<string,unknown>).filter(([,entry])=>entry!==undefined).sort(([left],[right])=>left.localeCompare(right)).map(([key,entry])=>[key,canonicalJson(entry)]));return value;}
function sha256(value:string):Sha256Digest{return `sha256:${createHash("sha256").update(value).digest("hex")}`;}
function invalid(message:string):HeldWorkActivationError{return new HeldWorkActivationError("INVALID_INPUT",message);}
function denied(message:string):HeldWorkActivationError{return new HeldWorkActivationError("ACTIVATION_DENIED",message);}
function invariant(message:string):HeldWorkActivationError{return new HeldWorkActivationError("INVARIANT_VIOLATION",message);}
