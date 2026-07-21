-- Guarded rollback to the inert PR23 held-only state.
-- Once activation evidence exists, use an application rollback/forward fix.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15min';
SET LOCAL search_path = public, pg_catalog;

DO $guard$
BEGIN
  IF to_regclass('public.ai_media_work_activations') IS NULL
    OR EXISTS (SELECT 1 FROM ai_media_work_activations LIMIT 1)
    OR EXISTS (SELECT 1 FROM ai_media_render_jobs
      WHERE budget_reservation_id IS NOT NULL AND stage<>'admission_held')
    OR EXISTS (SELECT 1 FROM ai_media_outbox
      WHERE budget_reservation_id IS NOT NULL AND status<>'held')
    OR EXISTS (
      SELECT 1
      FROM ai_media_budget_reservations reservation
      INNER JOIN ai_media_render_jobs job
        ON job.owner_user_id=reservation.owner_user_id AND job.workspace_id=reservation.workspace_id
        AND job.id=reservation.render_job_id AND job.budget_reservation_id=reservation.id
        AND job.daily_plan_slot_id=reservation.daily_plan_slot_id
        AND job.slot_attempt=reservation.attempt
        AND job.work_handoff_digest=reservation.work_handoff_digest
      INNER JOIN ai_media_outbox outbox
        ON outbox.owner_user_id=reservation.owner_user_id AND outbox.workspace_id=reservation.workspace_id
        AND outbox.id=reservation.dispatch_outbox_id AND outbox.budget_reservation_id=reservation.id
        AND outbox.render_job_id=reservation.render_job_id
        AND outbox.work_handoff_digest=reservation.work_handoff_digest
      LEFT JOIN ai_media_daily_plan_slots slot
        ON slot.owner_user_id=reservation.owner_user_id AND slot.workspace_id=reservation.workspace_id
        AND slot.id=reservation.daily_plan_slot_id
        AND slot.provider_account_id=reservation.provider_account_id
        AND slot.provider_key=reservation.provider_key
        AND slot.provider_credential_version=reservation.provider_credential_version
      WHERE reservation.work_handoff_digest IS NOT NULL
        AND (reservation.state<>'reserved' OR reservation.submission_state<>'not_started'
          OR job.stage<>'admission_held' OR outbox.status<>'held'
          OR slot.id IS NULL OR slot.status<>'reserved')
    )
  THEN
    RAISE EXCEPTION 'PR24 rollback requires an applied but never-used activation schema';
  END IF;
END
$guard$;

LOCK TABLE ai_media_budget_reservations, ai_media_render_jobs, ai_media_outbox,
  ai_media_daily_plan_slots, ai_media_work_activations IN ACCESS EXCLUSIVE MODE;

DROP TRIGGER ai_media_budget_reservations_handoff_immutable_guard ON ai_media_budget_reservations;
DROP FUNCTION ai_media_reject_reservation_handoff_mutation();
DROP TRIGGER ai_media_work_activations_final_state_guard ON ai_media_work_activations;
DROP FUNCTION ai_media_assert_work_activation_final_state();
DROP TRIGGER ai_media_work_activations_immutable_guard ON ai_media_work_activations;
DROP FUNCTION ai_media_reject_work_activation_rewrite();
DROP TRIGGER ai_media_render_jobs_admitted_handoff_guard ON ai_media_render_jobs;
DROP TRIGGER ai_media_outbox_admitted_handoff_guard ON ai_media_outbox;
DROP FUNCTION ai_media_guard_admitted_handoff();

ALTER TABLE ai_media_render_jobs DROP CONSTRAINT ai_media_render_jobs_admission_held_ck;
ALTER TABLE ai_media_render_jobs ADD CONSTRAINT ai_media_render_jobs_admission_held_ck CHECK (
  (stage<>'admission_held' AND budget_reservation_id IS NULL AND daily_plan_slot_id IS NULL
    AND slot_attempt IS NULL AND influencer_id IS NULL AND avatar_resource_id IS NULL
    AND voice_resource_id IS NULL AND script_id IS NULL AND script_variant_id IS NULL
    AND script_variant_checksum IS NULL AND source_item_id IS NULL AND source_content_hash IS NULL
    AND authority_snapshot_id IS NULL AND authority_digest IS NULL AND launch_intent_id IS NULL
    AND launch_intent_digest IS NULL AND admission_digest IS NULL AND work_handoff_digest IS NULL
    AND sealed_request_digest IS NULL AND provider_credential_version IS NULL)
  OR (stage='admission_held' AND budget_reservation_id IS NOT NULL AND daily_plan_slot_id IS NOT NULL
    AND slot_attempt>=1 AND influencer_id IS NOT NULL AND avatar_resource_id IS NOT NULL
    AND voice_resource_id IS NOT NULL AND script_id IS NOT NULL AND script_variant_id IS NOT NULL
    AND script_variant_checksum ~ '^[0-9a-f]{64}$'
    AND ((source_item_id IS NULL AND source_content_hash IS NULL)
      OR (source_item_id IS NOT NULL AND source_content_hash ~ '^sha256:[0-9a-f]{64}$'))
    AND authority_snapshot_id IS NOT NULL AND authority_digest ~ '^sha256:[0-9a-f]{64}$'
    AND launch_intent_id IS NOT NULL AND launch_intent_digest ~ '^sha256:[0-9a-f]{64}$'
    AND admission_digest ~ '^sha256:[0-9a-f]{64}$'
    AND work_handoff_digest ~ '^sha256:[0-9a-f]{64}$'
    AND sealed_request_digest ~ '^sha256:[0-9a-f]{64}$'
    AND provider_account_id IS NOT NULL AND length(btrim(provider_key)) BETWEEN 1 AND 80
    AND provider_credential_version>=1 AND status='pending' AND provider_job_id IS NULL
    AND attempts=0 AND retry_count=0 AND lease_owner IS NULL AND lease_expires_at IS NULL
    AND isfinite(available_at) AND isfinite(queued_at) AND isfinite(created_at) AND isfinite(updated_at))
);

ALTER TABLE ai_media_outbox DROP CONSTRAINT ai_media_outbox_held_ck;
ALTER TABLE ai_media_outbox ADD CONSTRAINT ai_media_outbox_held_ck CHECK (
  (status<>'held' AND budget_reservation_id IS NULL AND render_job_id IS NULL
    AND work_handoff_digest IS NULL AND sealed_request_digest IS NULL)
  OR (status='held' AND budget_reservation_id IS NOT NULL AND render_job_id IS NOT NULL
    AND work_handoff_digest ~ '^sha256:[0-9a-f]{64}$'
    AND sealed_request_digest ~ '^sha256:[0-9a-f]{64}$'
    AND attempts=0 AND locked_at IS NULL AND lease_owner IS NULL AND lease_expires_at IS NULL
    AND fencing_token=0 AND dead_letter_at IS NULL AND processed_at IS NULL AND last_error IS NULL
    AND isfinite(available_at) AND isfinite(created_at) AND isfinite(updated_at))
);

DROP TABLE ai_media_work_activations;
DROP INDEX ai_media_render_jobs_activation_identity_uq;

CREATE FUNCTION ai_media_reject_held_handoff_mutation() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public AS $guard$
BEGIN
  IF TG_TABLE_NAME='ai_media_render_jobs' THEN
    IF OLD.stage='admission_held' THEN
      RAISE EXCEPTION 'admission-held work cannot be updated or deleted';
    END IF;
  ELSIF TG_TABLE_NAME='ai_media_outbox' THEN
    IF OLD.status='held' THEN
      RAISE EXCEPTION 'admission-held work cannot be updated or deleted';
    END IF;
  END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END
$guard$;
CREATE TRIGGER ai_media_render_jobs_admission_held_immutable_guard
  BEFORE UPDATE OR DELETE ON ai_media_render_jobs
  FOR EACH ROW EXECUTE FUNCTION ai_media_reject_held_handoff_mutation();
CREATE TRIGGER ai_media_outbox_held_immutable_guard
  BEFORE UPDATE OR DELETE ON ai_media_outbox
  FOR EACH ROW EXECUTE FUNCTION ai_media_reject_held_handoff_mutation();

COMMIT;
