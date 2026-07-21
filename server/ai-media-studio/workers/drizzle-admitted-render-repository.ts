import { createHash, randomUUID } from "node:crypto";
import { sql, type SQL } from "drizzle-orm";
import type { Sha256Digest } from "../planning/contracts";
import { lockAuthorityWorkspace, lockGovernanceProfile } from "../planning/authority-locks";
import type {
  AdmittedAuthorizedIdentity,
  AdmittedReconciliationClaim,
  AdmittedRenderRepository,
  AdmittedSendAuthorization,
  AdmittedSubmissionClaim,
  ExactNegativeSubmissionFinality,
} from "./admitted-render-contracts";

type ExecuteResult = { rows?: unknown[] } | unknown[];
export interface AdmittedRenderDatabase { execute(query: SQL): Promise<ExecuteResult> }
export interface AdmittedRenderTransactionalDatabase extends AdmittedRenderDatabase {
  transaction<T>(callback: (tx: AdmittedRenderDatabase) => Promise<T>): Promise<T>;
}

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const DIGEST=/^sha256:[0-9a-f]{64}$/u;

/**
 * Dedicated PostgreSQL repository for admitted work. This module is purposely
 * unexported from runtime barrels. All mutations are fenced and exact; direct
 * production DML must be revoked from ordinary application roles.
 */
export class DrizzleAdmittedRenderRepository implements AdmittedRenderRepository {
  constructor(private readonly db:AdmittedRenderTransactionalDatabase,private readonly options:{workspaceId:string;accountingTimeZone:string}) {
    if(!options.workspaceId.trim())throw new Error("workspaceId is required");
    new Intl.DateTimeFormat("en-US",{timeZone:options.accountingTimeZone});
  }

  async claim(input:{workerId:string;leaseDurationMs:number}):Promise<AdmittedSubmissionClaim|undefined>{
    if(!input.workerId.trim()||!Number.isInteger(input.leaseDurationMs)||input.leaseDurationMs<1||input.leaseDurationMs>300_000)throw new Error("Invalid admitted claim lease");
    return this.db.transaction(async tx=>{
      await deferConsistency(tx);
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`ai-media:admitted-claim:${this.options.workspaceId}`},0))`);
      const candidate=first(await tx.execute(sql`
        WITH sampled_clock AS MATERIALIZED (SELECT clock_timestamp() observed_at)
        SELECT reservation.owner_user_id,reservation.workspace_id,activation.id work_activation_id,reservation.id budget_reservation_id,
          job.id render_job_id,outbox.id dispatch_outbox_id,slot.id daily_plan_slot_id,
          reservation.attempt slot_attempt,reservation.provider_account_id,reservation.provider_key,
          reservation.provider_credential_version,reservation.provider_idempotency_key,
          reservation.script_variant_checksum,reservation.authority_snapshot_id,reservation.authority_digest,
          job.launch_intent_id,job.launch_intent_digest,reservation.admission_digest,
          reservation.work_handoff_digest,job.sealed_request_digest,job.request request_json,
          avatar.external_resource_id avatar_external_resource_id,
          voice.external_resource_id voice_external_resource_id,
          existing.id existing_attempt_id,existing.state existing_state,
          existing.lease_expires_at existing_lease_expires_at,sampled_clock.observed_at
        FROM ai_media_render_jobs job
        JOIN ai_media_budget_reservations reservation ON reservation.id=job.budget_reservation_id
          AND reservation.owner_user_id=job.owner_user_id AND reservation.workspace_id=job.workspace_id
          AND reservation.render_job_id=job.id AND reservation.work_handoff_digest=job.work_handoff_digest
        JOIN ai_media_outbox outbox ON outbox.id=reservation.dispatch_outbox_id
          AND outbox.owner_user_id=reservation.owner_user_id AND outbox.workspace_id=reservation.workspace_id
          AND outbox.render_job_id=job.id AND outbox.budget_reservation_id=reservation.id
          AND outbox.work_handoff_digest=reservation.work_handoff_digest
          AND outbox.sealed_request_digest=job.sealed_request_digest
        JOIN ai_media_daily_plan_slots slot ON slot.id=reservation.daily_plan_slot_id
          AND slot.owner_user_id=reservation.owner_user_id AND slot.workspace_id=reservation.workspace_id
          AND slot.provider_account_id=reservation.provider_account_id
          AND slot.provider_key=reservation.provider_key
          AND slot.provider_credential_version=reservation.provider_credential_version
        JOIN ai_media_work_activations activation ON activation.budget_reservation_id=reservation.id
          AND activation.owner_user_id=reservation.owner_user_id AND activation.workspace_id=reservation.workspace_id
          AND activation.render_job_id=job.id AND activation.dispatch_outbox_id=outbox.id
          AND activation.work_handoff_digest=reservation.work_handoff_digest
          AND activation.sealed_request_digest=job.sealed_request_digest
        JOIN ai_media_provider_resources avatar ON avatar.id=job.avatar_resource_id
          AND avatar.owner_user_id=job.owner_user_id AND avatar.workspace_id=job.workspace_id
          AND avatar.provider_account_id=reservation.provider_account_id AND avatar.provider_key=reservation.provider_key
          AND avatar.resource_type='avatar'
        JOIN ai_media_provider_resources voice ON voice.id=job.voice_resource_id
          AND voice.owner_user_id=job.owner_user_id AND voice.workspace_id=job.workspace_id
          AND voice.provider_account_id=reservation.provider_account_id AND voice.provider_key=reservation.provider_key
          AND voice.resource_type='voice'
        LEFT JOIN ai_media_provider_submission_attempts existing ON existing.budget_reservation_id=reservation.id
          AND existing.owner_user_id=reservation.owner_user_id AND existing.workspace_id=reservation.workspace_id
        CROSS JOIN sampled_clock
        WHERE job.workspace_id=${this.options.workspaceId}
          AND reservation.state='reserved' AND reservation.submission_state='not_started'
          AND reservation.expires_at>sampled_clock.observed_at AND reservation.quote_expires_at>sampled_clock.observed_at
          AND ((existing.id IS NULL AND job.stage='queued' AND outbox.status='pending')
            OR (existing.state='claimed' AND existing.lease_expires_at<=sampled_clock.observed_at
              AND job.stage='leased' AND outbox.status='leased'))
          AND slot.status='queued' AND avatar.status='active' AND voice.status='active'
        ORDER BY job.available_at,job.created_at,job.id
        FOR UPDATE OF job,reservation,outbox,slot,activation,avatar,voice SKIP LOCKED LIMIT 1
      `));
      if(!candidate)return undefined;
      const leaseToken=randomUUID(),attemptId=candidate.existing_attempt_id?dbUuid(candidate,"existing_attempt_id"):randomUUID();
      const observedAt=iso(candidate.observed_at),leaseExpiresAt=new Date(Date.parse(observedAt)+input.leaseDurationMs).toISOString();
      const inputDigest=hash({version:1,attemptId,reservationId:dbUuid(candidate,"budget_reservation_id"),workerId:input.workerId,
        providerIdempotencyKey:text(candidate.provider_idempotency_key),sealedRequestDigest:dbDigest(candidate,"sealed_request_digest")});
      const attempt=first(await tx.execute(sql`
        INSERT INTO ai_media_provider_submission_attempts(
          id,owner_user_id,workspace_id,budget_reservation_id,work_activation_id,render_job_id,
          dispatch_outbox_id,daily_plan_slot_id,slot_attempt,provider_account_id,provider_key,
          provider_credential_version,provider_idempotency_key,avatar_external_resource_id,
          voice_external_resource_id,script_variant_checksum,authority_snapshot_id,work_handoff_digest,
          sealed_request_digest,authority_digest,launch_intent_id,launch_intent_digest,admission_digest,
          state,fencing_token,claim_count,lease_token,lease_owner,lease_expires_at,claimed_at,
          actor_user_id,input_digest,created_at,updated_at)
        VALUES(${attemptId},${text(candidate.owner_user_id)},${text(candidate.workspace_id)},${dbUuid(candidate,"budget_reservation_id")},
          ${dbUuid(candidate,"work_activation_id")},${dbUuid(candidate,"render_job_id")},${dbUuid(candidate,"dispatch_outbox_id")},
          ${dbUuid(candidate,"daily_plan_slot_id")},${positive(candidate.slot_attempt)},${dbUuid(candidate,"provider_account_id")},
          ${text(candidate.provider_key)},${positive(candidate.provider_credential_version)},${text(candidate.provider_idempotency_key)},
          ${text(candidate.avatar_external_resource_id)},${text(candidate.voice_external_resource_id)},${text(candidate.script_variant_checksum)},
          ${dbUuid(candidate,"authority_snapshot_id")},${dbDigest(candidate,"work_handoff_digest")},${dbDigest(candidate,"sealed_request_digest")},
          ${dbDigest(candidate,"authority_digest")},${dbUuid(candidate,"launch_intent_id")},${dbDigest(candidate,"launch_intent_digest")},
          ${dbDigest(candidate,"admission_digest")},'claimed',1,1,${leaseToken},${input.workerId},${new Date(leaseExpiresAt)},
          ${new Date(observedAt)},${input.workerId},${inputDigest},${new Date(observedAt)},${new Date(observedAt)})
        ON CONFLICT(owner_user_id,workspace_id,budget_reservation_id) DO UPDATE SET
          fencing_token=ai_media_provider_submission_attempts.fencing_token+1,
          claim_count=ai_media_provider_submission_attempts.claim_count+1,lease_token=EXCLUDED.lease_token,
          lease_owner=EXCLUDED.lease_owner,lease_expires_at=EXCLUDED.lease_expires_at,
          updated_at=EXCLUDED.updated_at
        WHERE ai_media_provider_submission_attempts.state='claimed'
          AND ai_media_provider_submission_attempts.lease_expires_at<=EXCLUDED.claimed_at
        RETURNING *
      `));
      if(!attempt)return undefined;
      const fence=big(attempt.fencing_token),claimCount=positive(attempt.claim_count);
      const eventDigest=hash({version:1,attemptId,fence:fence.toString(),claimCount,leaseToken,leaseExpiresAt});
      await this.insertEvent(tx,attempt,claimCount,claimCount===1?"claimed":"reclaimed",eventDigest,observedAt,undefined,undefined,undefined,input.workerId);
      const render=first(await tx.execute(sql`UPDATE ai_media_render_jobs SET stage='leased',status='rendering',
        lease_owner=${input.workerId},lease_token=${leaseToken},lease_expires_at=${new Date(leaseExpiresAt)},
        lease_fencing=${fence},updated_at=${new Date(observedAt)}
        WHERE id=${dbUuid(candidate,"render_job_id")} AND budget_reservation_id=${dbUuid(candidate,"budget_reservation_id")}
          AND stage IN ('queued','leased') RETURNING id`));
      const outbox=first(await tx.execute(sql`UPDATE ai_media_outbox SET status='leased',attempts=GREATEST(attempts,1),
        locked_at=${new Date(observedAt)},lease_owner=${input.workerId},lease_expires_at=${new Date(leaseExpiresAt)},
        fencing_token=${fence},updated_at=${new Date(observedAt)}
        WHERE id=${dbUuid(candidate,"dispatch_outbox_id")} AND budget_reservation_id=${dbUuid(candidate,"budget_reservation_id")}
          AND status IN ('pending','leased') RETURNING id`));
      if(!render||!outbox)throw new Error("Fenced admitted claim CAS failed");
      return claimFrom(attempt,candidate.request_json);
    });
  }

  async authorize(claim:AdmittedSubmissionClaim):Promise<AdmittedSendAuthorization|undefined>{
    return this.db.transaction(async tx=>{
      await deferConsistency(tx);
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`ai-media:admitted-reservation:${claim.scope.ownerUserId}:${claim.scope.workspaceId}:${claim.budgetReservationId}`},0))`);
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended('ai-media:daily-admission:global-concurrency',0))`);
      await lockAuthorityWorkspace(tx,claim.scope);
      const subject=first(await tx.execute(sql`SELECT job.influencer_id FROM ai_media_render_jobs job
        WHERE job.id=${claim.renderJobId} AND job.owner_user_id=${claim.scope.ownerUserId}
          AND job.workspace_id=${claim.scope.workspaceId} AND job.budget_reservation_id=${claim.budgetReservationId}`));
      if(!subject)return undefined;
      await lockGovernanceProfile(tx,claim.scope,dbUuid(subject,"influencer_id"));
      // PostgreSQL cannot lock the nullable side of an outer join. Lock the
      // exact launch intent and, for non-manual work, its current source row
      // separately so rights/status/hash cannot race the final send gate.
      const sourceBinding=first(await tx.execute(sql`SELECT intent.source_type,intent.source_item_id,intent.source_content_hash
        FROM ai_media_provider_submission_attempts attempt
        JOIN ai_media_launch_intents intent ON intent.id=attempt.launch_intent_id
          AND intent.owner_user_id=attempt.owner_user_id AND intent.workspace_id=attempt.workspace_id
          AND intent.launch_intent_digest=attempt.launch_intent_digest
        WHERE attempt.id=${claim.id} AND attempt.owner_user_id=${claim.scope.ownerUserId}
          AND attempt.workspace_id=${claim.scope.workspaceId} AND attempt.budget_reservation_id=${claim.budgetReservationId}
        FOR UPDATE OF intent`));
      if(!sourceBinding)return undefined;
      const sourceType=text(sourceBinding.source_type),sourceId=sourceBinding.source_item_id,sourceHash=sourceBinding.source_content_hash;
      if(sourceType==='manual'){
        if(sourceId!=null||sourceHash!=null)return undefined;
      }else{
        if(typeof sourceId!=="string"||!UUID.test(sourceId)||typeof sourceHash!=="string"||!DIGEST.test(sourceHash))return undefined;
        const source=first(await tx.execute(sql`SELECT id FROM ai_media_source_items
          WHERE id=${sourceId} AND owner_user_id=${claim.scope.ownerUserId} AND workspace_id=${claim.scope.workspaceId}
            AND source_type=${sourceType} AND content_hash=${sourceHash} AND status IN ('accepted','ready')
            AND moderation_status='approved' AND rights_status IN ('owned','licensed') FOR UPDATE`));
        if(!source)return undefined;
      }
      const gate=first(await tx.execute(sql`
        WITH sampled_clock AS MATERIALIZED (SELECT clock_timestamp() observed_at),
        fresh_clock AS MATERIALIZED (SELECT observed_at,(observed_at AT TIME ZONE ${this.options.accountingTimeZone})::date budget_date FROM sampled_clock)
        SELECT attempt.*,reservation.budget_bucket_id,reservation.amount_micro_usd,
          job.request request_json,job.script_variant_id,job.source_item_id,job.source_content_hash,
          job.avatar_resource_id,job.voice_resource_id,
          variant.content script_content,variant.checksum script_checksum,
          avatar.external_resource_id current_avatar_external_resource_id,
          voice.external_resource_id current_voice_external_resource_id,fresh_clock.observed_at
        FROM ai_media_provider_submission_attempts attempt
        JOIN ai_media_budget_reservations reservation ON reservation.id=attempt.budget_reservation_id
          AND reservation.owner_user_id=attempt.owner_user_id AND reservation.workspace_id=attempt.workspace_id
          AND reservation.render_job_id=attempt.render_job_id AND reservation.dispatch_outbox_id=attempt.dispatch_outbox_id
          AND reservation.daily_plan_slot_id=attempt.daily_plan_slot_id AND reservation.attempt=attempt.slot_attempt
          AND reservation.provider_account_id=attempt.provider_account_id AND reservation.provider_key=attempt.provider_key
          AND reservation.provider_credential_version=attempt.provider_credential_version
          AND reservation.provider_idempotency_key=attempt.provider_idempotency_key
          AND reservation.script_variant_checksum=attempt.script_variant_checksum
          AND reservation.authority_snapshot_id=attempt.authority_snapshot_id
          AND reservation.authority_digest=attempt.authority_digest AND reservation.admission_digest=attempt.admission_digest
          AND reservation.work_handoff_digest=attempt.work_handoff_digest
        JOIN ai_media_budget_buckets bucket ON bucket.id=reservation.budget_bucket_id
          AND bucket.owner_user_id=reservation.owner_user_id AND bucket.workspace_id=reservation.workspace_id
        JOIN ai_media_render_jobs job ON job.id=attempt.render_job_id
          AND job.owner_user_id=attempt.owner_user_id AND job.workspace_id=attempt.workspace_id
          AND job.budget_reservation_id=reservation.id AND job.daily_plan_slot_id=attempt.daily_plan_slot_id
          AND job.slot_attempt=attempt.slot_attempt AND job.provider_account_id=attempt.provider_account_id
          AND job.provider_key=attempt.provider_key AND job.provider_credential_version=attempt.provider_credential_version
          AND job.idempotency_key=attempt.provider_idempotency_key
          AND job.script_variant_checksum=attempt.script_variant_checksum
          AND job.authority_snapshot_id=attempt.authority_snapshot_id AND job.authority_digest=attempt.authority_digest
          AND job.launch_intent_id=attempt.launch_intent_id AND job.launch_intent_digest=attempt.launch_intent_digest
          AND job.admission_digest=attempt.admission_digest AND job.work_handoff_digest=attempt.work_handoff_digest
          AND job.sealed_request_digest=attempt.sealed_request_digest
        JOIN ai_media_outbox outbox ON outbox.id=attempt.dispatch_outbox_id
          AND outbox.owner_user_id=attempt.owner_user_id AND outbox.workspace_id=attempt.workspace_id
          AND outbox.budget_reservation_id=reservation.id AND outbox.render_job_id=job.id
          AND outbox.work_handoff_digest=attempt.work_handoff_digest AND outbox.sealed_request_digest=attempt.sealed_request_digest
        JOIN ai_media_daily_plan_slots slot ON slot.id=attempt.daily_plan_slot_id
          AND slot.owner_user_id=attempt.owner_user_id AND slot.workspace_id=attempt.workspace_id
          AND slot.provider_account_id=attempt.provider_account_id AND slot.provider_key=attempt.provider_key
          AND slot.provider_credential_version=attempt.provider_credential_version
          AND slot.script_variant_id=job.script_variant_id AND slot.influencer_id=job.influencer_id
          AND slot.avatar_resource_id=job.avatar_resource_id AND slot.voice_resource_id=job.voice_resource_id
        JOIN ai_media_work_activations activation ON activation.id=attempt.work_activation_id
          AND activation.owner_user_id=attempt.owner_user_id AND activation.workspace_id=attempt.workspace_id
          AND activation.budget_reservation_id=reservation.id AND activation.render_job_id=job.id
          AND activation.dispatch_outbox_id=outbox.id AND activation.daily_plan_slot_id=slot.id
          AND activation.slot_attempt=attempt.slot_attempt AND activation.provider_account_id=attempt.provider_account_id
          AND activation.provider_key=attempt.provider_key AND activation.provider_credential_version=attempt.provider_credential_version
          AND activation.provider_idempotency_key=attempt.provider_idempotency_key
          AND activation.script_variant_checksum=attempt.script_variant_checksum
          AND activation.authority_snapshot_id=attempt.authority_snapshot_id
          AND activation.authority_digest=attempt.authority_digest AND activation.launch_intent_id=attempt.launch_intent_id
          AND activation.launch_intent_digest=attempt.launch_intent_digest AND activation.admission_digest=attempt.admission_digest
          AND activation.work_handoff_digest=attempt.work_handoff_digest AND activation.sealed_request_digest=attempt.sealed_request_digest
        JOIN ai_media_launch_authority_snapshots snapshot ON snapshot.id=reservation.authority_snapshot_id
          AND snapshot.owner_user_id=reservation.owner_user_id AND snapshot.workspace_id=reservation.workspace_id
          AND snapshot.authority_digest=reservation.authority_digest
          AND snapshot.daily_plan_slot_id=attempt.daily_plan_slot_id AND snapshot.slot_attempt=attempt.slot_attempt
          AND snapshot.admission_digest=attempt.admission_digest AND snapshot.provider_account_id=attempt.provider_account_id
          AND snapshot.provider_key=attempt.provider_key AND snapshot.provider_credential_version=attempt.provider_credential_version
          AND snapshot.script_variant_checksum=attempt.script_variant_checksum
          AND snapshot.launch_intent_id=attempt.launch_intent_id AND snapshot.launch_intent_digest=attempt.launch_intent_digest
        JOIN ai_media_launch_intents intent ON intent.id=snapshot.launch_intent_id
          AND intent.owner_user_id=snapshot.owner_user_id AND intent.workspace_id=snapshot.workspace_id
          AND intent.launch_intent_digest=snapshot.launch_intent_digest
          AND intent.daily_plan_id=snapshot.daily_plan_id AND intent.daily_plan_slot_id=snapshot.daily_plan_slot_id
          AND intent.slot_attempt=snapshot.slot_attempt AND intent.provider_account_id=snapshot.provider_account_id
          AND intent.provider_key=snapshot.provider_key AND intent.provider_credential_version=snapshot.provider_credential_version
          AND intent.script_variant_id=snapshot.script_variant_id AND intent.script_variant_checksum=snapshot.script_variant_checksum
          AND intent.governance_profile_id=snapshot.governance_profile_id
          AND intent.governance_evidence_digest=snapshot.governance_evidence_digest
          AND intent.launch_subject_digest=snapshot.launch_subject_digest
        JOIN ai_media_launch_evidence content ON content.id=snapshot.content_approval_evidence_id
          AND content.owner_user_id=snapshot.owner_user_id AND content.workspace_id=snapshot.workspace_id
          AND content.evidence_digest=snapshot.content_approval_evidence_digest
          AND content.launch_intent_id=intent.id AND content.launch_intent_digest=intent.launch_intent_digest
        JOIN ai_media_launch_evidence human ON human.id=snapshot.human_launch_approval_evidence_id
          AND human.owner_user_id=snapshot.owner_user_id AND human.workspace_id=snapshot.workspace_id
          AND human.evidence_digest=snapshot.human_launch_approval_evidence_digest
          AND human.launch_intent_id=intent.id AND human.launch_intent_digest=intent.launch_intent_digest
        JOIN ai_media_launch_evidence sandbox ON sandbox.id=snapshot.sandbox_evidence_id
          AND sandbox.owner_user_id=snapshot.owner_user_id AND sandbox.workspace_id=snapshot.workspace_id
          AND sandbox.evidence_digest=snapshot.sandbox_evidence_digest
          AND sandbox.launch_intent_id=intent.id AND sandbox.launch_intent_digest=intent.launch_intent_digest
        JOIN ai_media_launch_evidence quote ON quote.id=snapshot.maximum_quote_evidence_id
          AND quote.owner_user_id=snapshot.owner_user_id AND quote.workspace_id=snapshot.workspace_id
          AND quote.evidence_digest=snapshot.maximum_quote_evidence_digest
          AND quote.launch_intent_id=intent.id AND quote.launch_intent_digest=intent.launch_intent_digest
        JOIN ai_media_admission_policy_revisions policy ON policy.id=snapshot.policy_revision_id
          AND policy.owner_user_id=snapshot.owner_user_id AND policy.workspace_id=snapshot.workspace_id
          AND policy.revision=snapshot.policy_revision AND policy.policy_digest=snapshot.policy_digest
        JOIN ai_media_kill_switch_revisions kill ON kill.id=snapshot.kill_switch_revision_id
          AND kill.owner_user_id=snapshot.owner_user_id AND kill.workspace_id=snapshot.workspace_id
          AND kill.revision=snapshot.kill_switch_revision AND kill.evidence_digest=snapshot.kill_switch_evidence_digest
        JOIN ai_media_daily_plans plan ON plan.id=snapshot.daily_plan_id
          AND plan.owner_user_id=snapshot.owner_user_id AND plan.workspace_id=snapshot.workspace_id
          AND plan.plan_digest=snapshot.plan_digest
        JOIN ai_media_provider_accounts account ON account.id=attempt.provider_account_id
          AND account.owner_user_id=attempt.owner_user_id AND account.workspace_id=attempt.workspace_id
        JOIN ai_media_governance_profiles governance ON governance.id=snapshot.governance_profile_id
          AND governance.owner_user_id=snapshot.owner_user_id AND governance.workspace_id=snapshot.workspace_id
          AND governance.influencer_id=slot.influencer_id AND governance.avatar_resource_id=job.avatar_resource_id
          AND governance.voice_resource_id=job.voice_resource_id AND governance.evidence_digest=snapshot.governance_evidence_digest
        JOIN ai_media_influencers influencer ON influencer.id=job.influencer_id
          AND influencer.owner_user_id=job.owner_user_id AND influencer.workspace_id=job.workspace_id
        JOIN ai_media_provider_resources avatar ON avatar.id=job.avatar_resource_id
          AND avatar.owner_user_id=job.owner_user_id AND avatar.workspace_id=job.workspace_id
        JOIN ai_media_provider_resources voice ON voice.id=job.voice_resource_id
          AND voice.owner_user_id=job.owner_user_id AND voice.workspace_id=job.workspace_id
        JOIN ai_media_script_variants variant ON variant.id=job.script_variant_id
          AND variant.owner_user_id=job.owner_user_id AND variant.workspace_id=job.workspace_id
          AND variant.id=snapshot.script_variant_id AND variant.checksum=snapshot.script_variant_checksum
        JOIN ai_media_scripts script ON script.id=variant.script_id
          AND script.owner_user_id=variant.owner_user_id AND script.workspace_id=variant.workspace_id
          AND script.id=intent.script_id AND script.influencer_id=slot.influencer_id AND script.influencer_id=job.influencer_id
        LEFT JOIN ai_media_source_items source ON source.id=intent.source_item_id
          AND source.owner_user_id=intent.owner_user_id AND source.workspace_id=intent.workspace_id
          AND source.content_hash=intent.source_content_hash
        CROSS JOIN fresh_clock
        WHERE attempt.id=${claim.id} AND attempt.owner_user_id=${claim.scope.ownerUserId}
          AND attempt.workspace_id=${claim.scope.workspaceId} AND attempt.budget_reservation_id=${claim.budgetReservationId}
          AND attempt.state='claimed' AND attempt.fencing_token=${claim.fencingToken}
          AND attempt.lease_token=${claim.leaseToken} AND attempt.lease_expires_at>fresh_clock.observed_at
          AND reservation.state='reserved' AND reservation.submission_state='not_started'
          AND reservation.expires_at>fresh_clock.observed_at AND reservation.quote_expires_at>fresh_clock.observed_at
          AND job.stage='leased' AND job.attempts=0 AND job.lease_token=attempt.lease_token
          AND job.lease_fencing=attempt.fencing_token AND outbox.status='leased'
          AND outbox.fencing_token=attempt.fencing_token AND outbox.attempts>=1 AND slot.status='queued'
          AND activation.activation_digest IS NOT NULL AND activation.activated_at IS NOT NULL
          AND job.source_item_id IS NOT DISTINCT FROM intent.source_item_id
          AND job.source_content_hash IS NOT DISTINCT FROM intent.source_content_hash
          AND slot.daily_plan_id=snapshot.daily_plan_id AND slot.slot_digest=snapshot.slot_digest
          AND snapshot.valid_from<=fresh_clock.observed_at AND snapshot.expires_at>fresh_clock.observed_at
          AND plan.status IN ('planned','active') AND plan.plan_date=fresh_clock.budget_date
          AND plan.accounting_time_zone=${this.options.accountingTimeZone}
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
          AND snapshot.maximum_quote_micro_usd=quote.amount_micro_usd
          AND account.provider_key=attempt.provider_key AND account.credential_version=attempt.provider_credential_version
          AND account.status IN ('active','connected') AND account.credential_status='active'
          AND (account.credential_expires_at IS NULL OR account.credential_expires_at>fresh_clock.observed_at)
          AND avatar.provider_account_id=attempt.provider_account_id AND avatar.provider_key=attempt.provider_key
          AND avatar.resource_type='avatar' AND avatar.status='active'
          AND voice.provider_account_id=attempt.provider_account_id AND voice.provider_key=attempt.provider_key
          AND voice.resource_type='voice' AND voice.status='active'
          AND avatar.external_resource_id=attempt.avatar_external_resource_id
          AND voice.external_resource_id=attempt.voice_external_resource_id
          AND influencer.status='active' AND influencer.archived_at IS NULL
          AND governance.state='active' AND governance.revoked_at IS NULL
          AND governance.valid_from<=fresh_clock.observed_at AND governance.expires_at>fresh_clock.observed_at
          AND variant.status='approved' AND variant.checksum=attempt.script_variant_checksum
          AND script.status='approved' AND script.archived_at IS NULL AND script.current_variant_id=variant.id
          AND quote.amount_micro_usd=reservation.amount_micro_usd
          AND policy.state='active' AND policy.valid_from<=fresh_clock.observed_at
          AND (policy.expires_at IS NULL OR policy.expires_at>fresh_clock.observed_at)
          AND reservation.policy_digest=policy.policy_digest
          AND policy.allowed_time_zones @> jsonb_build_array(${this.options.accountingTimeZone}::text)
          AND policy.allowed_countries @> jsonb_build_array(snapshot.content_country)
          AND policy.allowed_languages @> jsonb_build_array(script.language)
          AND kill.active=false AND kill.valid_from<=fresh_clock.observed_at
          AND (kill.expires_at IS NULL OR kill.expires_at>fresh_clock.observed_at)
          AND reservation.kill_switch_evidence_digest=kill.evidence_digest
          AND governance.allowed_uses @> jsonb_build_array(snapshot.governance_use)
          AND (governance.territories @> jsonb_build_array(snapshot.governance_territory)
            OR governance.territories @> '["WORLDWIDE"]'::jsonb)
          AND bucket.budget_date=fresh_clock.budget_date AND bucket.accounting_time_zone=${this.options.accountingTimeZone}
          AND bucket.currency=reservation.currency AND bucket.policy_digest=policy.policy_digest
          AND bucket.policy_version=policy.revision AND bucket.limit_micro_usd=policy.daily_budget_micro_usd
          AND bucket.reserved_micro_usd>=reservation.amount_micro_usd
          AND bucket.reserved_micro_usd+bucket.committed_micro_usd<=bucket.limit_micro_usd
          AND (SELECT count(*) FROM ai_media_budget_reservations active
            WHERE active.state='committed' OR (active.state='reserved' AND active.expires_at>fresh_clock.observed_at))<=policy.total_concurrency
          AND (SELECT count(*) FROM ai_media_budget_reservations active WHERE active.provider_key=reservation.provider_key
            AND (active.state='committed' OR (active.state='reserved' AND active.expires_at>fresh_clock.observed_at)))<=policy.provider_concurrency
          AND (SELECT count(*) FROM ai_media_budget_reservations active
            WHERE active.owner_user_id=reservation.owner_user_id AND active.workspace_id=reservation.workspace_id
              AND (active.state='committed' OR (active.state='reserved' AND active.expires_at>fresh_clock.observed_at)))<=policy.tenant_concurrency
          AND NOT EXISTS(SELECT 1 FROM ai_media_launch_evidence newer WHERE newer.owner_user_id=content.owner_user_id
            AND newer.workspace_id=content.workspace_id AND newer.daily_plan_slot_id=content.daily_plan_slot_id
            AND newer.slot_attempt=content.slot_attempt AND newer.evidence_kind=content.evidence_kind AND newer.revision>content.revision)
          AND NOT EXISTS(SELECT 1 FROM ai_media_launch_evidence newer WHERE newer.owner_user_id=human.owner_user_id
            AND newer.workspace_id=human.workspace_id AND newer.daily_plan_slot_id=human.daily_plan_slot_id
            AND newer.slot_attempt=human.slot_attempt AND newer.evidence_kind=human.evidence_kind AND newer.revision>human.revision)
          AND NOT EXISTS(SELECT 1 FROM ai_media_launch_evidence newer WHERE newer.owner_user_id=sandbox.owner_user_id
            AND newer.workspace_id=sandbox.workspace_id AND newer.daily_plan_slot_id=sandbox.daily_plan_slot_id
            AND newer.slot_attempt=sandbox.slot_attempt AND newer.evidence_kind=sandbox.evidence_kind AND newer.revision>sandbox.revision)
          AND NOT EXISTS(SELECT 1 FROM ai_media_launch_evidence newer WHERE newer.owner_user_id=quote.owner_user_id
            AND newer.workspace_id=quote.workspace_id AND newer.daily_plan_slot_id=quote.daily_plan_slot_id
            AND newer.slot_attempt=quote.slot_attempt AND newer.evidence_kind=quote.evidence_kind AND newer.revision>quote.revision)
          AND NOT EXISTS(SELECT 1 FROM ai_media_admission_policy_revisions newer WHERE newer.owner_user_id=policy.owner_user_id
            AND newer.workspace_id=policy.workspace_id AND newer.revision>policy.revision)
          AND NOT EXISTS(SELECT 1 FROM ai_media_kill_switch_revisions newer WHERE newer.owner_user_id=kill.owner_user_id
            AND newer.workspace_id=kill.workspace_id AND newer.revision>kill.revision)
          AND NOT EXISTS(SELECT 1 FROM ai_media_governance_profiles newer WHERE newer.owner_user_id=governance.owner_user_id
            AND newer.workspace_id=governance.workspace_id AND newer.influencer_id=governance.influencer_id AND newer.version>governance.version)
          AND ((intent.source_type='manual' AND intent.source_item_id IS NULL AND intent.source_content_hash IS NULL)
            OR (intent.source_type<>'manual' AND source.id IS NOT NULL AND source.status IN ('accepted','ready')
              AND source.moderation_status='approved' AND source.rights_status IN ('owned','licensed')))
        FOR UPDATE OF attempt,reservation,bucket,job,outbox,slot,activation,snapshot,intent,content,human,
          sandbox,quote,policy,kill,plan,account,governance,influencer,avatar,voice,variant,script
      `));
      if(!gate)return undefined;
      const lockedClaim=claimFrom(gate,gate.request_json);
      if(!sameClaim(claim,lockedClaim))return undefined;
      const scriptContent=text(gate.script_content),checksum=createHash("sha256").update(scriptContent).digest("hex");
      if(checksum!==text(gate.script_checksum)||checksum!==text(gate.script_variant_checksum))throw new Error("Locked script checksum changed");
      const sealedRequestDigest=hash({version:1,request:gate.request_json,reservationId:dbUuid(gate,"budget_reservation_id"),
        renderJobId:dbUuid(gate,"render_job_id"),outboxId:dbUuid(gate,"dispatch_outbox_id"),
        slotId:dbUuid(gate,"daily_plan_slot_id"),slotAttempt:positive(gate.slot_attempt),
        authoritySnapshotId:dbUuid(gate,"authority_snapshot_id"),authorityDigest:dbDigest(gate,"authority_digest"),
        launchIntentId:dbUuid(gate,"launch_intent_id"),launchIntentDigest:dbDigest(gate,"launch_intent_digest"),
        admissionDigest:dbDigest(gate,"admission_digest"),providerAccountId:dbUuid(gate,"provider_account_id"),
        providerKey:text(gate.provider_key),providerCredentialVersion:positive(gate.provider_credential_version),
        scriptVariantId:dbUuid(gate,"script_variant_id"),scriptVariantChecksum:checksum,
        sourceItemId:gate.source_item_id??null,sourceContentHash:gate.source_content_hash??null,
        avatarResourceId:dbUuid(gate,"avatar_resource_id"),voiceResourceId:dbUuid(gate,"voice_resource_id")});
      if(sealedRequestDigest!==dbDigest(gate,"sealed_request_digest"))throw new Error("Locked work no longer matches its sealed request digest");
      if(text(gate.current_avatar_external_resource_id)!==claim.avatarExternalResourceId
        ||text(gate.current_voice_external_resource_id)!==claim.voiceExternalResourceId)throw new Error("Locked provider resource binding changed");
      const authorizedAt=iso(gate.observed_at);
      const commitEvidenceDigest=hash({version:1,attemptId:claim.id,reservationId:claim.budgetReservationId,
        amountMicroUsd:text(gate.amount_micro_usd),fence:claim.fencingToken.toString(),authorizedAt});
      const authorizationDigest=hash({version:1,attemptId:claim.id,reservationId:claim.budgetReservationId,
        providerAccountId:claim.providerAccountId,providerKey:claim.providerKey,
        providerCredentialVersion:claim.providerCredentialVersion,providerIdempotencyKey:claim.providerIdempotencyKey,
        avatarExternalResourceId:claim.avatarExternalResourceId,voiceExternalResourceId:claim.voiceExternalResourceId,
        sealedRequestDigest:claim.sealedRequestDigest,commitEvidenceDigest,authorizedAt});
      const attempt=first(await tx.execute(sql`UPDATE ai_media_provider_submission_attempts SET state='authorized',
        commit_evidence_digest=${commitEvidenceDigest},send_authorization_digest=${authorizationDigest},
        authorized_at=${new Date(authorizedAt)},updated_at=${new Date(authorizedAt)}
        WHERE id=${claim.id} AND state='claimed' AND fencing_token=${claim.fencingToken}
          AND lease_token=${claim.leaseToken} AND lease_expires_at>${new Date(authorizedAt)} RETURNING *`));
      if(!attempt)return undefined;
      await this.insertEvent(tx,attempt,await nextSequence(tx,claim.id),"authorized",authorizationDigest,authorizedAt,undefined,undefined,undefined,text(attempt.lease_owner));
      const bucket=first(await tx.execute(sql`UPDATE ai_media_budget_buckets SET
        reserved_micro_usd=reserved_micro_usd-${text(gate.amount_micro_usd)}::numeric,
        committed_micro_usd=committed_micro_usd+${text(gate.amount_micro_usd)}::numeric,
        state_version=state_version+1,updated_at=${new Date(authorizedAt)}
        WHERE id=${dbUuid(gate,"budget_bucket_id")} AND reserved_micro_usd>=${text(gate.amount_micro_usd)}::numeric
          AND reserved_micro_usd+committed_micro_usd<=limit_micro_usd RETURNING id`));
      const reservation=first(await tx.execute(sql`UPDATE ai_media_budget_reservations SET state='committed',
        submission_state='dispatching',committed_at=${new Date(authorizedAt)},commit_evidence_digest=${commitEvidenceDigest},
        updated_at=${new Date(authorizedAt)} WHERE id=${claim.budgetReservationId} AND state='reserved'
          AND submission_state='not_started' RETURNING id`));
      const job=first(await tx.execute(sql`UPDATE ai_media_render_jobs SET attempts=1,updated_at=${new Date(authorizedAt)}
        WHERE id=${claim.renderJobId} AND stage='leased' AND attempts=0 AND lease_token=${claim.leaseToken}
          AND lease_fencing=${claim.fencingToken} RETURNING id`));
      const slot=first(await tx.execute(sql`UPDATE ai_media_daily_plan_slots SET status='committed',
        state_version=state_version+1,updated_at=${new Date(authorizedAt)}
        WHERE id=${dbUuid(gate,"daily_plan_slot_id")} AND status='queued' RETURNING id`));
      if(!bucket||!reservation||!job||!slot)throw new Error("Atomic send authorization CAS failed");
      return {...lockedClaim,authorizationDigest,commitEvidenceDigest,authorizedAt};
    });
  }

  async confirm(input:AdmittedAuthorizedIdentity&{providerJobId:string;providerRequestId?:string;evidenceDigest:Sha256Digest}):Promise<boolean>{
    if(!boundedProviderId(input.providerJobId)||!optionalProviderId(input.providerRequestId)||!DIGEST.test(input.evidenceDigest))return false;
    return this.finish(input,"confirmed",input.evidenceDigest,input.providerJobId,input.providerRequestId);
  }
  async markAmbiguous(input:AdmittedSendAuthorization&{providerRequestId?:string;evidenceDigest:Sha256Digest}):Promise<boolean>{
    if(!optionalProviderId(input.providerRequestId)||!DIGEST.test(input.evidenceDigest))return false;
    return this.finish(input,"ambiguous",input.evidenceDigest,undefined,input.providerRequestId);
  }
  async markReconciledNoSubmit(input:AdmittedReconciliationClaim&{finality:ExactNegativeSubmissionFinality}):Promise<boolean>{
    if(!sameNegativeFinality(input,input.finality))return false;
    const boundEvidence=hash({version:1,kind:"linearizable_definitive_no_submit",attemptId:input.id,
      authorizationDigest:input.authorizationDigest,providerAccountId:input.providerAccountId,
      providerKey:input.providerKey,providerCredentialVersion:input.providerCredentialVersion,
      providerIdempotencyKey:input.providerIdempotencyKey,reconciliationFencingToken:input.reconciliationFencingToken.toString(),
      finalityObservedAt:new Date(input.finality.observedAt).toISOString(),providerEvidenceDigest:input.finality.evidenceDigest});
    return this.finish(input,"reconciled_no_submit",boundEvidence);
  }

  async expireAuthorizedLeases():Promise<number>{
    const candidates=rows(await this.db.execute(sql`SELECT *,request_json FROM (
      SELECT attempt.*,job.request request_json FROM ai_media_provider_submission_attempts attempt
      JOIN ai_media_render_jobs job ON job.id=attempt.render_job_id
      WHERE attempt.workspace_id=${this.options.workspaceId} AND attempt.state='authorized'
        AND attempt.lease_expires_at<=clock_timestamp()
      ORDER BY attempt.lease_expires_at LIMIT 100) due`));
    let count=0;
    for(const row of candidates){const auth=authorizationFrom(row,row.request_json);
      const evidence=hash({version:1,kind:"authorized_lease_expired",attemptId:auth.id,fence:auth.fencingToken.toString(),authorizationDigest:auth.authorizationDigest});
      if(await this.markAmbiguous({...auth,evidenceDigest:evidence}))count+=1;
    }return count;
  }

  async claimAmbiguous(input:{workerId:string;leaseDurationMs:number}):Promise<AdmittedReconciliationClaim|undefined>{
    if(!input.workerId.trim()||input.leaseDurationMs<1||input.leaseDurationMs>300_000)return undefined;
    return this.db.transaction(async tx=>{
      await deferConsistency(tx);
      const lease=randomUUID();
      const row=first(await tx.execute(sql`WITH candidate AS (
        SELECT id FROM ai_media_provider_submission_attempts WHERE workspace_id=${this.options.workspaceId} AND state='ambiguous'
          AND (reconciliation_lease_token IS NULL OR reconciliation_lease_expires_at<=clock_timestamp())
        ORDER BY ambiguous_at,id FOR UPDATE SKIP LOCKED LIMIT 1)
        UPDATE ai_media_provider_submission_attempts attempt SET reconciliation_lease_token=${lease},
          reconciliation_lease_owner=${input.workerId},reconciliation_lease_expires_at=clock_timestamp()+(${input.leaseDurationMs}::text||' milliseconds')::interval,
          reconciliation_fencing_token=reconciliation_fencing_token+1,updated_at=clock_timestamp()
        FROM candidate WHERE attempt.id=candidate.id RETURNING attempt.*`));
      if(!row)return undefined;
      const withRequest={...row,...first(await tx.execute(sql`SELECT request request_json FROM ai_media_render_jobs WHERE id=${dbUuid(row,"render_job_id")}`))};
      const sequence=await nextSequence(tx,dbUuid(row,"id"));
      const evidence=hash({version:1,kind:"reconciliation_claimed",attemptId:dbUuid(row,"id"),
        reconciliationFence:big(row.reconciliation_fencing_token).toString(),lease});
      await this.insertEvent(tx,row,sequence,"reconciliation_claimed",evidence,iso(row.updated_at),undefined,undefined,
        big(row.reconciliation_fencing_token),input.workerId);
      return {...authorizedIdentityFrom(withRequest,withRequest.request_json),reconciliationLeaseToken:lease,
        reconciliationLeaseOwner:input.workerId,reconciliationFencingToken:big(row.reconciliation_fencing_token)};
    });
  }

  async releaseUnknownReconciliation(claim:AdmittedReconciliationClaim):Promise<boolean>{
    return this.db.transaction(async tx=>{
      await deferConsistency(tx);
      const row=first(await tx.execute(sql`UPDATE ai_media_provider_submission_attempts SET
        reconciliation_lease_token=NULL,reconciliation_lease_owner=NULL,reconciliation_lease_expires_at=NULL,
        updated_at=clock_timestamp() WHERE id=${claim.id} AND owner_user_id=${claim.scope.ownerUserId}
          AND workspace_id=${claim.scope.workspaceId} AND state='ambiguous'
          AND reconciliation_lease_token=${claim.reconciliationLeaseToken}
          AND reconciliation_lease_owner=${claim.reconciliationLeaseOwner}
          AND reconciliation_fencing_token=${claim.reconciliationFencingToken} RETURNING *`));
      if(!row)return false;
      const observedAt=iso(row.updated_at),evidence=hash({version:1,kind:"reconciliation_released_unknown",
        attemptId:claim.id,authorizationDigest:claim.authorizationDigest,
        reconciliationFencingToken:claim.reconciliationFencingToken.toString(),actorUserId:claim.reconciliationLeaseOwner});
      await this.insertEvent(tx,row,await nextSequence(tx,claim.id),"reconciliation_released",evidence,observedAt,
        undefined,undefined,claim.reconciliationFencingToken,claim.reconciliationLeaseOwner);
      return true;
    });
  }

  private async finish(input:AdmittedAuthorizedIdentity,state:"confirmed"|"ambiguous"|"reconciled_no_submit",
    evidence:Sha256Digest,providerJobId?:string,providerRequestId?:string):Promise<boolean>{
    return this.db.transaction(async tx=>{
      await deferConsistency(tx);
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`ai-media:admitted-reservation:${input.scope.ownerUserId}:${input.scope.workspaceId}:${input.budgetReservationId}`},0))`);
      const current=first(await tx.execute(sql`SELECT attempt.*,reservation.amount_micro_usd,reservation.budget_bucket_id,
        job.request request_json,clock_timestamp() observed_at FROM ai_media_provider_submission_attempts attempt
        JOIN ai_media_budget_reservations reservation ON reservation.id=attempt.budget_reservation_id
        JOIN ai_media_render_jobs job ON job.id=attempt.render_job_id
        WHERE attempt.id=${input.id} AND attempt.owner_user_id=${input.scope.ownerUserId}
          AND attempt.workspace_id=${input.scope.workspaceId} AND attempt.budget_reservation_id=${input.budgetReservationId}
          AND attempt.send_authorization_digest=${input.authorizationDigest} AND attempt.fencing_token=${input.fencingToken}
          AND attempt.state IN (${state==='ambiguous'?sql.raw("'authorized'")
            :state==='reconciled_no_submit'?sql.raw("'ambiguous'"):sql.raw("'authorized','ambiguous'")})
        FOR UPDATE OF attempt,reservation,job`));
      if(!current)return false;
      if(text(current.state)==='ambiguous'){
        const rec=input as Partial<AdmittedReconciliationClaim>;
        if(!rec.reconciliationLeaseToken||!rec.reconciliationLeaseOwner||rec.reconciliationFencingToken===undefined
          ||text(current.reconciliation_lease_token)!==rec.reconciliationLeaseToken
          ||text(current.reconciliation_lease_owner)!==rec.reconciliationLeaseOwner
          ||big(current.reconciliation_fencing_token)!==rec.reconciliationFencingToken)return false;
      }
      if(state==='reconciled_no_submit'){
        const rec=input as AdmittedReconciliationClaim;
        if(!rec.reconciliationLeaseToken||big(current.reconciliation_fencing_token)!==rec.reconciliationFencingToken
          ||text(current.reconciliation_lease_token)!==rec.reconciliationLeaseToken)return false;
      }
      const observedAt=iso(current.observed_at),digestColumn=state==='confirmed'?sql.raw("confirmed_evidence_digest"):state==='ambiguous'?sql.raw("ambiguity_evidence_digest"):sql.raw("reconciliation_evidence_digest");
      const timestampColumn=state==='confirmed'?sql.raw("confirmed_at"):state==='ambiguous'?sql.raw("ambiguous_at"):sql.raw("reconciled_at");
      const attempt=first(await tx.execute(sql`UPDATE ai_media_provider_submission_attempts SET state=${state},
        ${digestColumn}=${evidence},${timestampColumn}=${new Date(observedAt)},provider_job_id=${providerJobId??null},
        provider_request_id=${providerRequestId??null},lease_token=NULL,lease_owner=NULL,lease_expires_at=NULL,
        reconciliation_lease_token=NULL,reconciliation_lease_owner=NULL,reconciliation_lease_expires_at=NULL,
        updated_at=${new Date(observedAt)} WHERE id=${input.id} AND fencing_token=${input.fencingToken} RETURNING *`));
      if(!attempt)return false;
      const eventActor=text(current.state)==='ambiguous'?text(current.reconciliation_lease_owner):text(current.lease_owner);
      await this.insertEvent(tx,attempt,await nextSequence(tx,input.id),state,evidence,observedAt,providerJobId,providerRequestId,
        state==='reconciled_no_submit'?(input as AdmittedReconciliationClaim).reconciliationFencingToken:undefined,eventActor);
      if(state==='reconciled_no_submit')await tx.execute(sql`UPDATE ai_media_budget_buckets SET
        committed_micro_usd=committed_micro_usd-${text(current.amount_micro_usd)}::numeric,
        state_version=state_version+1,updated_at=${new Date(observedAt)}
        WHERE id=${dbUuid(current,"budget_bucket_id")} AND committed_micro_usd>=${text(current.amount_micro_usd)}::numeric`);
      const reservationState=state==='reconciled_no_submit'?'released':'committed';
      const reservation=first(await tx.execute(sql`UPDATE ai_media_budget_reservations SET state=${reservationState},
        submission_state=${state},reconciliation_evidence_digest=${state==='reconciled_no_submit'?evidence:null},
        released_at=${state==='reconciled_no_submit'?new Date(observedAt):null},updated_at=${new Date(observedAt)}
        WHERE id=${input.budgetReservationId} AND state='committed' AND submission_state IN ('dispatching','ambiguous') RETURNING id`));
      const jobStage=state==='confirmed'?'submitted':state==='ambiguous'?'reconciling':'failed';
      const job=first(await tx.execute(sql`UPDATE ai_media_render_jobs SET stage=${jobStage},
        provider_job_id=${providerJobId??null},lease_owner=NULL,lease_token=NULL,lease_expires_at=NULL,
        updated_at=${new Date(observedAt)} WHERE id=${input.renderJobId} AND lease_fencing=${input.fencingToken}
          AND stage IN ('leased','reconciling') RETURNING id`));
      const outboxState=state==='confirmed'?'dispatched':state==='ambiguous'?'reconciling':'dead_letter';
      const outbox=first(await tx.execute(sql`UPDATE ai_media_outbox SET status=${outboxState},
        processed_at=${state==='confirmed'?new Date(observedAt):null},dead_letter_at=${state==='reconciled_no_submit'?new Date(observedAt):null},
        locked_at=NULL,lease_owner=NULL,lease_expires_at=NULL,updated_at=${new Date(observedAt)}
        WHERE id=${dbUuid(current,"dispatch_outbox_id")} AND fencing_token=${input.fencingToken}
          AND status IN ('leased','reconciling') RETURNING id`));
      const slotState=state==='confirmed'?'submitted':state==='ambiguous'?'reconciling':'released';
      const slot=first(await tx.execute(sql`UPDATE ai_media_daily_plan_slots SET status=${slotState},
        state_version=state_version+1,updated_at=${new Date(observedAt)}
        WHERE id=${dbUuid(current,"daily_plan_slot_id")} AND status IN ('committed','reconciling') RETURNING id`));
      if(!reservation||!job||!outbox||!slot)throw new Error("Provider outcome CAS failed");
      return true;
    });
  }

  private async insertEvent(tx:AdmittedRenderDatabase,attempt:Record<string,unknown>,sequence:number,eventKind:string,
    evidenceDigest:Sha256Digest,observedAt:string,providerJobId?:string,providerRequestId?:string,reconciliationFence?:bigint,actorUserId?:string):Promise<void>{
    await tx.execute(sql`INSERT INTO ai_media_provider_submission_events(id,owner_user_id,workspace_id,
      submission_attempt_id,budget_reservation_id,sequence,event_kind,fencing_token,reconciliation_fencing_token,
      evidence_digest,provider_job_id,provider_request_id,actor_user_id,observed_at,created_at)
      VALUES(${randomUUID()},${text(attempt.owner_user_id)},${text(attempt.workspace_id)},${dbUuid(attempt,"id")},
        ${dbUuid(attempt,"budget_reservation_id")},${sequence},${eventKind},${big(attempt.fencing_token)},
        ${reconciliationFence??null},${evidenceDigest},${providerJobId??null},${providerRequestId??null},
        ${actorUserId??text(attempt.actor_user_id)},${new Date(observedAt)},${new Date(observedAt)})`);
  }
}

async function nextSequence(tx:AdmittedRenderDatabase,id:string):Promise<number>{const row=first(await tx.execute(sql`
  SELECT COALESCE(max(sequence),0)+1 next_sequence FROM ai_media_provider_submission_events
  WHERE submission_attempt_id=${id}`));return positive(row?.next_sequence??1);}
async function deferConsistency(tx:AdmittedRenderDatabase):Promise<void>{await tx.execute(sql.raw(`SET CONSTRAINTS
  ai_media_pr25_attempt_consistency_guard,ai_media_pr25_reservation_consistency_guard,
  ai_media_pr25_render_consistency_guard,ai_media_pr25_outbox_consistency_guard,
  ai_media_pr25_slot_consistency_guard,ai_media_pr25_bucket_consistency_guard DEFERRED`));}
function rows(result:ExecuteResult):Record<string,unknown>[]{const value=Array.isArray(result)?result:result.rows;return Array.isArray(value)?value as Record<string,unknown>[]:[];}
function first(result:ExecuteResult):Record<string,unknown>|undefined{return rows(result)[0];}
function text(value:unknown):string{if(typeof value!=="string"||!value.length)throw new Error("Invalid database text");return value;}
function dbUuid(row:Record<string,unknown>,key:string):string{const value=text(row[key]);if(!UUID.test(value))throw new Error(`Invalid ${key}`);return value;}
function dbDigest(row:Record<string,unknown>,key:string):Sha256Digest{const value=text(row[key]);if(!DIGEST.test(value))throw new Error(`Invalid ${key}`);return value as Sha256Digest;}
function positive(value:unknown):number{const number=Number(value);if(!Number.isSafeInteger(number)||number<1)throw new Error("Invalid positive integer");return number;}
function big(value:unknown):bigint{try{const result=BigInt(String(value));if(result<1n)throw new Error();return result;}catch{throw new Error("Invalid fencing token");}}
function iso(value:unknown):string{const date=value instanceof Date?value:new Date(String(value));if(Number.isNaN(date.getTime()))throw new Error("Invalid database time");return date.toISOString();}
function canonical(value:unknown):unknown{if(Array.isArray(value))return value.map(canonical);if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value as Record<string,unknown>).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>[k,canonical(v)]));return value;}
function hash(value:unknown):Sha256Digest{return `sha256:${createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex")}`;}
function boundedProviderId(value:unknown):value is string{return typeof value==='string'&&value===value.trim()&&value.length>=1&&value.length<=500;}
function optionalProviderId(value:unknown):boolean{return value===undefined||boundedProviderId(value);}
function sameNegativeFinality(input:AdmittedReconciliationClaim,finality:ExactNegativeSubmissionFinality):boolean{return Boolean(finality)
  &&finality.guarantee==='linearizable_not_accepted_and_cannot_later_accept'
  &&finality.scope.ownerUserId===input.scope.ownerUserId&&finality.scope.workspaceId===input.scope.workspaceId
  &&finality.providerAccountId===input.providerAccountId&&finality.providerKey===input.providerKey
  &&finality.providerCredentialVersion===input.providerCredentialVersion
  &&finality.authorizationDigest===input.authorizationDigest&&finality.providerIdempotencyKey===input.providerIdempotencyKey
  &&DIGEST.test(finality.evidenceDigest)&&!Number.isNaN(Date.parse(finality.observedAt));}
function identityFrom(row:Record<string,unknown>,request:unknown){return{id:dbUuid(row,"id"),scope:{ownerUserId:text(row.owner_user_id),workspaceId:text(row.workspace_id)},
  budgetReservationId:dbUuid(row,"budget_reservation_id"),renderJobId:dbUuid(row,"render_job_id"),providerAccountId:dbUuid(row,"provider_account_id"),
  providerKey:text(row.provider_key),providerCredentialVersion:positive(row.provider_credential_version),providerIdempotencyKey:text(row.provider_idempotency_key),
  avatarExternalResourceId:text(row.avatar_external_resource_id),voiceExternalResourceId:text(row.voice_external_resource_id),
  sealedRequest:(request&&typeof request==='object'&&!Array.isArray(request)?request:{}) as Readonly<Record<string,unknown>>,
  sealedRequestDigest:dbDigest(row,"sealed_request_digest"),fencingToken:big(row.fencing_token)};}
function claimFrom(row:Record<string,unknown>,request:unknown):AdmittedSubmissionClaim{return{...identityFrom(row,request),leaseToken:dbUuid(row,"lease_token"),leaseExpiresAt:iso(row.lease_expires_at)};}
function authorizedIdentityFrom(row:Record<string,unknown>,request:unknown):AdmittedAuthorizedIdentity{return{...identityFrom(row,request),authorizationDigest:dbDigest(row,"send_authorization_digest"),commitEvidenceDigest:dbDigest(row,"commit_evidence_digest"),authorizedAt:iso(row.authorized_at)};}
function authorizationFrom(row:Record<string,unknown>,request:unknown):AdmittedSendAuthorization{return{...authorizedIdentityFrom(row,request),leaseToken:dbUuid(row,"lease_token"),leaseExpiresAt:iso(row.lease_expires_at)};}
function sameClaim(left:AdmittedSubmissionClaim,right:AdmittedSubmissionClaim):boolean{return left.id===right.id
  &&left.scope.ownerUserId===right.scope.ownerUserId&&left.scope.workspaceId===right.scope.workspaceId
  &&left.budgetReservationId===right.budgetReservationId&&left.renderJobId===right.renderJobId
  &&left.providerAccountId===right.providerAccountId&&left.providerKey===right.providerKey
  &&left.providerCredentialVersion===right.providerCredentialVersion
  &&left.providerIdempotencyKey===right.providerIdempotencyKey
  &&left.avatarExternalResourceId===right.avatarExternalResourceId&&left.voiceExternalResourceId===right.voiceExternalResourceId
  &&left.sealedRequestDigest===right.sealedRequestDigest&&left.leaseToken===right.leaseToken
  &&left.fencingToken===right.fencingToken&&left.leaseExpiresAt===right.leaseExpiresAt
  &&JSON.stringify(canonical(left.sealedRequest))===JSON.stringify(canonical(right.sealedRequest));}
