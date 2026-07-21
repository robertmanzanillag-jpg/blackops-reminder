-- Guarded rollback to PR24. Once any submission-attempt evidence exists,
-- preserve it and use a code rollback/forward fix instead.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='15min';
SET LOCAL search_path=public,pg_catalog;

DO $guard$
BEGIN
  IF to_regclass('public.ai_media_provider_submission_attempts') IS NULL
    OR EXISTS (SELECT 1 FROM ai_media_provider_submission_attempts LIMIT 1)
    OR EXISTS (SELECT 1 FROM ai_media_provider_submission_events LIMIT 1)
    OR EXISTS (SELECT 1 FROM ai_media_budget_reservations reservation
      JOIN ai_media_render_jobs job ON job.id=reservation.render_job_id
        AND job.owner_user_id=reservation.owner_user_id AND job.workspace_id=reservation.workspace_id
      JOIN ai_media_outbox outbox ON outbox.id=reservation.dispatch_outbox_id
        AND outbox.owner_user_id=reservation.owner_user_id AND outbox.workspace_id=reservation.workspace_id
      JOIN ai_media_daily_plan_slots slot ON slot.id=reservation.daily_plan_slot_id
        AND slot.owner_user_id=reservation.owner_user_id AND slot.workspace_id=reservation.workspace_id
      LEFT JOIN ai_media_work_activations activation ON activation.budget_reservation_id=reservation.id
        AND activation.owner_user_id=reservation.owner_user_id AND activation.workspace_id=reservation.workspace_id
      WHERE reservation.work_handoff_digest IS NOT NULL AND
        (reservation.state<>'reserved' OR reservation.submission_state<>'not_started'
          OR job.attempts<>0 OR job.provider_job_id IS NOT NULL OR job.lease_owner IS NOT NULL
          OR job.lease_token IS NOT NULL OR job.lease_expires_at IS NOT NULL OR job.lease_fencing<>0
          OR outbox.attempts<>0 OR outbox.lease_owner IS NOT NULL OR outbox.lease_expires_at IS NOT NULL
          OR outbox.fencing_token<>0 OR outbox.processed_at IS NOT NULL OR outbox.dead_letter_at IS NOT NULL
          OR (activation.id IS NULL AND (job.stage<>'admission_held' OR outbox.status<>'held' OR slot.status<>'reserved'))
          OR (activation.id IS NOT NULL AND (job.stage<>'queued' OR outbox.status<>'pending'
            OR slot.status<>'queued' OR slot.state_version<activation.slot_state_version_after))))
  THEN RAISE EXCEPTION 'PR25 rollback requires zero submission evidence and zero submission progress'; END IF;
END
$guard$;

LOCK TABLE ai_media_budget_buckets,ai_media_budget_reservations,ai_media_render_jobs,
  ai_media_outbox,ai_media_daily_plan_slots,ai_media_provider_submission_events,
  ai_media_provider_submission_attempts IN ACCESS EXCLUSIVE MODE;

DROP TRIGGER ai_media_pr25_bucket_consistency_guard ON ai_media_budget_buckets;
DROP TRIGGER ai_media_pr25_slot_consistency_guard ON ai_media_daily_plan_slots;
DROP TRIGGER ai_media_pr25_outbox_consistency_guard ON ai_media_outbox;
DROP TRIGGER ai_media_pr25_render_consistency_guard ON ai_media_render_jobs;
DROP TRIGGER ai_media_pr25_reservation_consistency_guard ON ai_media_budget_reservations;
DROP TRIGGER ai_media_pr25_attempt_consistency_guard ON ai_media_provider_submission_attempts;
DROP FUNCTION ai_media_assert_pr25_consistency();
DROP TRIGGER ai_media_render_jobs_admitted_submission_guard ON ai_media_render_jobs;
DROP TRIGGER ai_media_outbox_admitted_submission_guard ON ai_media_outbox;
DROP FUNCTION ai_media_guard_admitted_submission_rows();
DROP TRIGGER ai_media_provider_submission_events_immutable_guard ON ai_media_provider_submission_events;
DROP FUNCTION ai_media_reject_provider_submission_event_rewrite();
DROP TRIGGER ai_media_provider_submission_attempts_guard ON ai_media_provider_submission_attempts;
DROP FUNCTION ai_media_guard_provider_submission_attempt();

DROP TABLE ai_media_provider_submission_events;
DROP TABLE ai_media_provider_submission_attempts;
DROP INDEX ai_media_work_activations_submission_attempt_identity_uq;

ALTER TABLE ai_media_render_jobs DROP CONSTRAINT ai_media_render_jobs_admission_held_ck;
ALTER TABLE ai_media_render_jobs DROP COLUMN lease_fencing,DROP COLUMN lease_token;
ALTER TABLE ai_media_render_jobs ADD CONSTRAINT ai_media_render_jobs_admission_held_ck CHECK (
  (budget_reservation_id IS NULL AND daily_plan_slot_id IS NULL AND slot_attempt IS NULL
    AND influencer_id IS NULL AND avatar_resource_id IS NULL AND voice_resource_id IS NULL
    AND script_id IS NULL AND script_variant_id IS NULL AND script_variant_checksum IS NULL
    AND source_item_id IS NULL AND source_content_hash IS NULL AND authority_snapshot_id IS NULL
    AND authority_digest IS NULL AND launch_intent_id IS NULL AND launch_intent_digest IS NULL
    AND admission_digest IS NULL AND work_handoff_digest IS NULL AND sealed_request_digest IS NULL
    AND provider_credential_version IS NULL)
  OR (budget_reservation_id IS NOT NULL AND daily_plan_slot_id IS NOT NULL AND slot_attempt>=1
    AND influencer_id IS NOT NULL AND avatar_resource_id IS NOT NULL AND voice_resource_id IS NOT NULL
    AND script_id IS NOT NULL AND script_variant_id IS NOT NULL
    AND script_variant_checksum ~ '^[0-9a-f]{64}$'
    AND ((source_item_id IS NULL AND source_content_hash IS NULL)
      OR (source_item_id IS NOT NULL AND source_content_hash ~ '^sha256:[0-9a-f]{64}$'))
    AND authority_snapshot_id IS NOT NULL AND authority_digest ~ '^sha256:[0-9a-f]{64}$'
    AND launch_intent_id IS NOT NULL AND launch_intent_digest ~ '^sha256:[0-9a-f]{64}$'
    AND admission_digest ~ '^sha256:[0-9a-f]{64}$' AND work_handoff_digest ~ '^sha256:[0-9a-f]{64}$'
    AND sealed_request_digest ~ '^sha256:[0-9a-f]{64}$' AND provider_account_id IS NOT NULL
    AND length(btrim(provider_key)) BETWEEN 1 AND 80
    AND provider_credential_version>=1 AND stage IN ('admission_held','queued') AND status='pending'
    AND attempts=0 AND retry_count=0 AND provider_job_id IS NULL
    AND lease_owner IS NULL AND lease_expires_at IS NULL
    AND isfinite(available_at) AND isfinite(queued_at) AND isfinite(created_at) AND isfinite(updated_at))
);
ALTER TABLE ai_media_outbox DROP CONSTRAINT ai_media_outbox_held_ck;
ALTER TABLE ai_media_outbox ADD CONSTRAINT ai_media_outbox_held_ck CHECK (
  (budget_reservation_id IS NULL AND render_job_id IS NULL AND work_handoff_digest IS NULL
    AND sealed_request_digest IS NULL)
  OR (budget_reservation_id IS NOT NULL AND render_job_id IS NOT NULL
    AND work_handoff_digest ~ '^sha256:[0-9a-f]{64}$' AND sealed_request_digest ~ '^sha256:[0-9a-f]{64}$'
    AND isfinite(available_at) AND isfinite(created_at) AND isfinite(updated_at)
    AND status IN ('held','pending','leased','retry_wait','dispatched','dead_letter')
    AND (status<>'held' OR (attempts=0 AND locked_at IS NULL AND lease_owner IS NULL
      AND lease_expires_at IS NULL AND fencing_token=0 AND dead_letter_at IS NULL
      AND processed_at IS NULL AND last_error IS NULL)))
);

CREATE FUNCTION ai_media_guard_admitted_handoff() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public AS $guard$
BEGIN
  IF TG_TABLE_NAME='ai_media_render_jobs' THEN
    IF TG_OP='DELETE' THEN
      IF OLD.budget_reservation_id IS NOT NULL THEN RAISE EXCEPTION 'admitted render evidence cannot be deleted'; END IF;
      RETURN OLD;
    END IF;
    IF OLD.budget_reservation_id IS NULL AND NEW.budget_reservation_id IS NOT NULL THEN
      RAISE EXCEPTION 'admission bindings cannot be attached by update';
    END IF;
    IF OLD.budget_reservation_id IS NOT NULL THEN
      IF ROW(NEW.owner_user_id,NEW.workspace_id,NEW.budget_reservation_id,NEW.daily_plan_slot_id,
          NEW.slot_attempt,NEW.influencer_id,NEW.avatar_resource_id,NEW.voice_resource_id,
          NEW.script_id,NEW.script_variant_id,NEW.script_variant_checksum,NEW.source_item_id,
          NEW.source_content_hash,NEW.authority_snapshot_id,NEW.authority_digest,NEW.launch_intent_id,
          NEW.launch_intent_digest,NEW.admission_digest,NEW.work_handoff_digest,NEW.sealed_request_digest,
          NEW.provider_account_id,NEW.provider_key,NEW.provider_credential_version,NEW.idempotency_key,
          NEW.request,NEW.governance_profile_id,NEW.governance_evidence_digest)
        IS DISTINCT FROM
        ROW(OLD.owner_user_id,OLD.workspace_id,OLD.budget_reservation_id,OLD.daily_plan_slot_id,
          OLD.slot_attempt,OLD.influencer_id,OLD.avatar_resource_id,OLD.voice_resource_id,
          OLD.script_id,OLD.script_variant_id,OLD.script_variant_checksum,OLD.source_item_id,
          OLD.source_content_hash,OLD.authority_snapshot_id,OLD.authority_digest,OLD.launch_intent_id,
          OLD.launch_intent_digest,OLD.admission_digest,OLD.work_handoff_digest,OLD.sealed_request_digest,
          OLD.provider_account_id,OLD.provider_key,OLD.provider_credential_version,OLD.idempotency_key,
          OLD.request,OLD.governance_profile_id,OLD.governance_evidence_digest) THEN
        RAISE EXCEPTION 'admitted render identity and sealed request are immutable';
      END IF;
      IF OLD.stage='admission_held' THEN
        IF NEW.stage<>'queued'
          OR (to_jsonb(NEW)-'stage'-'available_at'-'updated_at')
            IS DISTINCT FROM (to_jsonb(OLD)-'stage'-'available_at'-'updated_at')
          OR NOT EXISTS (SELECT 1 FROM public.ai_media_work_activations activation
            WHERE activation.owner_user_id=OLD.owner_user_id AND activation.workspace_id=OLD.workspace_id
              AND activation.budget_reservation_id=OLD.budget_reservation_id
              AND activation.render_job_id=OLD.id AND activation.work_handoff_digest=OLD.work_handoff_digest
              AND activation.sealed_request_digest=OLD.sealed_request_digest) THEN
          RAISE EXCEPTION 'held render requires one exact activation transition';
        END IF;
      ELSE RAISE EXCEPTION 'queued admitted render remains inert until the budget-aware submission migration'; END IF;
    END IF;
    RETURN NEW;
  END IF;
  IF TG_OP='DELETE' THEN
    IF OLD.budget_reservation_id IS NOT NULL THEN RAISE EXCEPTION 'admitted outbox evidence cannot be deleted'; END IF;
    RETURN OLD;
  END IF;
  IF OLD.budget_reservation_id IS NULL AND NEW.budget_reservation_id IS NOT NULL THEN
    RAISE EXCEPTION 'admission bindings cannot be attached by update';
  END IF;
  IF OLD.budget_reservation_id IS NOT NULL THEN
    IF ROW(NEW.owner_user_id,NEW.workspace_id,NEW.budget_reservation_id,NEW.render_job_id,
        NEW.work_handoff_digest,NEW.sealed_request_digest,NEW.idempotency_key,NEW.aggregate_type,
        NEW.aggregate_id,NEW.event_type,NEW.payload)
      IS DISTINCT FROM ROW(OLD.owner_user_id,OLD.workspace_id,OLD.budget_reservation_id,OLD.render_job_id,
        OLD.work_handoff_digest,OLD.sealed_request_digest,OLD.idempotency_key,OLD.aggregate_type,
        OLD.aggregate_id,OLD.event_type,OLD.payload) THEN
      RAISE EXCEPTION 'admitted outbox identity and payload are immutable';
    END IF;
    IF OLD.status='held' THEN
      IF NEW.status<>'pending'
        OR (to_jsonb(NEW)-'status'-'available_at'-'updated_at')
          IS DISTINCT FROM (to_jsonb(OLD)-'status'-'available_at'-'updated_at')
        OR NOT EXISTS (SELECT 1 FROM public.ai_media_work_activations activation
          WHERE activation.owner_user_id=OLD.owner_user_id AND activation.workspace_id=OLD.workspace_id
            AND activation.budget_reservation_id=OLD.budget_reservation_id
            AND activation.dispatch_outbox_id=OLD.id AND activation.render_job_id=OLD.render_job_id
            AND activation.work_handoff_digest=OLD.work_handoff_digest
            AND activation.sealed_request_digest=OLD.sealed_request_digest) THEN
        RAISE EXCEPTION 'held outbox requires one exact activation transition';
      END IF;
    ELSIF NEW.status='held' THEN RAISE EXCEPTION 'admitted outbox cannot return to held'; END IF;
  END IF;
  RETURN NEW;
END
$guard$;
CREATE TRIGGER ai_media_render_jobs_admitted_handoff_guard BEFORE UPDATE OR DELETE ON ai_media_render_jobs
  FOR EACH ROW EXECUTE FUNCTION ai_media_guard_admitted_handoff();
CREATE TRIGGER ai_media_outbox_admitted_handoff_guard BEFORE UPDATE OR DELETE ON ai_media_outbox
  FOR EACH ROW EXECUTE FUNCTION ai_media_guard_admitted_handoff();

-- Restore the PR19/PR24 reservation guard. This rollback is unreachable after
-- any commit, so no ambiguous state can be reopened by this restored function.
DROP TRIGGER ai_media_budget_reservations_transition_guard ON ai_media_budget_reservations;
DROP FUNCTION ai_media_reject_budget_reservation_rewrite();
CREATE FUNCTION ai_media_reject_budget_reservation_rewrite() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public AS $guard$
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'budget reservation evidence cannot be deleted'; END IF;
  IF ROW(NEW.owner_user_id,NEW.workspace_id,NEW.budget_bucket_id,NEW.daily_plan_slot_id,
      NEW.provider_account_id,NEW.provider_key,NEW.provider_credential_version,NEW.attempt,
      NEW.amount_micro_usd,NEW.currency,NEW.idempotency_key,NEW.input_digest,NEW.admission_digest,
      NEW.script_variant_checksum,NEW.quote_digest,NEW.quote_expires_at,NEW.content_approval_digest,
      NEW.human_launch_approval_digest,NEW.governance_profile_id,NEW.governance_evidence_digest,
      NEW.policy_digest,NEW.kill_switch_evidence_digest,NEW.sandbox_evidence_digest,
      NEW.provider_idempotency_key,NEW.reserved_at,NEW.expires_at)
    IS DISTINCT FROM
    ROW(OLD.owner_user_id,OLD.workspace_id,OLD.budget_bucket_id,OLD.daily_plan_slot_id,
      OLD.provider_account_id,OLD.provider_key,OLD.provider_credential_version,OLD.attempt,
      OLD.amount_micro_usd,OLD.currency,OLD.idempotency_key,OLD.input_digest,OLD.admission_digest,
      OLD.script_variant_checksum,OLD.quote_digest,OLD.quote_expires_at,OLD.content_approval_digest,
      OLD.human_launch_approval_digest,OLD.governance_profile_id,OLD.governance_evidence_digest,
      OLD.policy_digest,OLD.kill_switch_evidence_digest,OLD.sandbox_evidence_digest,
      OLD.provider_idempotency_key,OLD.reserved_at,OLD.expires_at) THEN
    RAISE EXCEPTION 'budget reservation immutable admission evidence cannot change';
  END IF;
  IF (OLD.render_job_id IS NOT NULL AND NEW.render_job_id IS DISTINCT FROM OLD.render_job_id)
    OR (OLD.dispatch_outbox_id IS NOT NULL AND NEW.dispatch_outbox_id IS DISTINCT FROM OLD.dispatch_outbox_id) THEN
    RAISE EXCEPTION 'attached job and outbox identities cannot change';
  END IF;
  IF OLD.state IN ('released','expired','settled') THEN RAISE EXCEPTION 'terminal budget reservation cannot change'; END IF;
  IF OLD.state='reserved' AND NEW.state NOT IN ('reserved','committed','released','expired') THEN
    RAISE EXCEPTION 'invalid reserved budget transition'; END IF;
  IF OLD.state='reserved' AND NEW.state='committed' AND
    (clock_timestamp()>=OLD.expires_at OR NEW.submission_state<>'dispatching'
      OR NEW.commit_evidence_digest IS NULL) THEN
    RAISE EXCEPTION 'budget commit requires live reservation and dispatch evidence'; END IF;
  IF OLD.state='reserved' AND NEW.state='released'
    AND (NEW.submission_state<>'not_started' OR NEW.committed_at IS NOT NULL
      OR NEW.commit_evidence_digest IS NOT NULL) THEN
    RAISE EXCEPTION 'unsubmitted budget release cannot carry dispatch evidence'; END IF;
  IF OLD.state='committed' AND NEW.state NOT IN ('committed','released','settled') THEN
    RAISE EXCEPTION 'committed budget cannot expire or return reserved'; END IF;
  IF OLD.state='reserved' AND NEW.state='expired'
    AND (clock_timestamp()<OLD.expires_at OR OLD.submission_state<>'not_started') THEN
    RAISE EXCEPTION 'only expired not-started reservations may expire'; END IF;
  IF OLD.state='committed' AND NEW.state='released'
    AND (NEW.submission_state<>'reconciled_no_submit' OR NEW.reconciliation_evidence_digest IS NULL) THEN
    RAISE EXCEPTION 'committed budget release requires definitive reconciliation evidence'; END IF;
  IF OLD.submission_state='ambiguous' AND NOT (NEW.state='committed'
      OR (NEW.state='settled' AND NEW.submission_state='confirmed'
        AND NEW.reconciliation_evidence_digest IS NOT NULL)) THEN
    RAISE EXCEPTION 'ambiguous provider submission must retain committed budget'; END IF;
  IF OLD.commit_evidence_digest IS NOT NULL AND
    (NEW.commit_evidence_digest IS DISTINCT FROM OLD.commit_evidence_digest
      OR NEW.committed_at IS DISTINCT FROM OLD.committed_at) THEN
    RAISE EXCEPTION 'budget commit evidence cannot change'; END IF;
  IF OLD.reconciliation_evidence_digest IS NOT NULL
    AND NEW.reconciliation_evidence_digest IS DISTINCT FROM OLD.reconciliation_evidence_digest THEN
    RAISE EXCEPTION 'budget reconciliation evidence cannot change'; END IF;
  RETURN NEW;
END
$guard$;
CREATE TRIGGER ai_media_budget_reservations_transition_guard BEFORE UPDATE OR DELETE
  ON ai_media_budget_reservations FOR EACH ROW EXECUTE FUNCTION ai_media_reject_budget_reservation_rewrite();

COMMIT;
