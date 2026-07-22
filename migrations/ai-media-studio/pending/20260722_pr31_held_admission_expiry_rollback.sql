-- AI Media Studio PR31 guarded rollback.
-- Refuse rollback once any expiration evidence or terminal projection exists.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15min';
SET LOCAL search_path = public, pg_catalog;

DO $preflight$
BEGIN
  IF to_regclass('public.ai_media_held_admission_expirations') IS NULL
    OR to_regprocedure('ai_media_worker_api.expire_held_admission_v1(uuid,text,text,uuid,uuid,uuid,uuid,uuid,integer,text,text,timestamptz,integer,text,text)') IS NULL
  THEN RAISE EXCEPTION 'PR31 held admission expiry migration is not applied exactly'; END IF;
  IF EXISTS (SELECT 1 FROM public.ai_media_held_expiry_capabilities LIMIT 1)
    OR EXISTS (SELECT 1 FROM public.ai_media_held_admission_expirations LIMIT 1)
    OR EXISTS (SELECT 1 FROM public.ai_media_render_jobs WHERE stage='admission_expired' OR status='cancelled')
    OR EXISTS (SELECT 1 FROM public.ai_media_outbox WHERE budget_reservation_id IS NOT NULL AND status='cancelled')
    OR EXISTS (SELECT 1 FROM public.ai_media_budget_reservations
      WHERE state='expired' AND release_reason='held_admission_expired')
  THEN
    RAISE EXCEPTION 'rollback preserves held admission expiration evidence and terminal state; stop and forward-fix';
  END IF;
END
$preflight$;

LOCK TABLE public.ai_media_budget_buckets,public.ai_media_budget_reservations,
  public.ai_media_render_jobs,public.ai_media_outbox,public.ai_media_daily_plan_slots,
  public.ai_media_held_expiry_capabilities,public.ai_media_held_admission_expirations
  IN ACCESS EXCLUSIVE MODE;

REVOKE EXECUTE ON FUNCTION ai_media_worker_api.expire_held_admission_v1(uuid,text,text,uuid,uuid,uuid,uuid,uuid,integer,text,text,timestamptz,integer,text,text)
  FROM ai_media_held_expiry_executor;
REVOKE USAGE ON SCHEMA ai_media_worker_api FROM ai_media_held_expiry_executor;
REVOKE ALL ON FUNCTION ai_media_worker_api.expire_held_admission_v1(uuid,text,text,uuid,uuid,uuid,uuid,uuid,integer,text,text,timestamptz,integer,text,text)
  FROM PUBLIC,ai_media_admitted_submit_executor,ai_media_admitted_reconcile_executor;
DROP FUNCTION ai_media_worker_api.expire_held_admission_v1(uuid,text,text,uuid,uuid,uuid,uuid,uuid,integer,text,text,timestamptz,integer,text,text);

DROP TRIGGER ai_media_held_admission_expirations_final_state_guard ON public.ai_media_held_admission_expirations;
DROP FUNCTION public.ai_media_assert_held_admission_expiry_final_state();
DROP TRIGGER ai_media_budget_reservations_held_expiry_guard ON public.ai_media_budget_reservations;
DROP TRIGGER ai_media_daily_plan_slots_held_expiry_guard ON public.ai_media_daily_plan_slots;
DROP FUNCTION public.ai_media_guard_held_admission_expiry_state();

DROP TRIGGER ai_media_render_jobs_held_expiry_guard ON public.ai_media_render_jobs;
DROP TRIGGER ai_media_outbox_held_expiry_guard ON public.ai_media_outbox;
DROP FUNCTION public.ai_media_guard_held_admission_expiry_projection();
DROP TRIGGER ai_media_render_jobs_held_expiry_insert_guard ON public.ai_media_render_jobs;
DROP TRIGGER ai_media_outbox_held_expiry_insert_guard ON public.ai_media_outbox;
DROP TRIGGER ai_media_budget_reservations_held_expiry_insert_guard ON public.ai_media_budget_reservations;
DROP TRIGGER ai_media_daily_plan_slots_held_expiry_insert_guard ON public.ai_media_daily_plan_slots;
DROP FUNCTION public.ai_media_reject_inserted_held_expiry_projection();

DROP TRIGGER ai_media_render_jobs_admitted_submission_guard ON public.ai_media_render_jobs;
CREATE TRIGGER ai_media_render_jobs_admitted_submission_guard BEFORE UPDATE ON public.ai_media_render_jobs
  FOR EACH ROW WHEN (NEW.provider_terminal_state IS NULL)
  EXECUTE FUNCTION public.ai_media_guard_admitted_submission_rows();
DROP TRIGGER ai_media_outbox_admitted_submission_guard ON public.ai_media_outbox;
DROP TRIGGER ai_media_outbox_admitted_submission_delete_guard ON public.ai_media_outbox;
CREATE TRIGGER ai_media_outbox_admitted_submission_guard BEFORE UPDATE OR DELETE ON public.ai_media_outbox
  FOR EACH ROW EXECUTE FUNCTION public.ai_media_guard_admitted_submission_rows();

ALTER TABLE public.ai_media_render_jobs DROP CONSTRAINT ai_media_render_jobs_admission_held_ck;
ALTER TABLE public.ai_media_render_jobs ADD CONSTRAINT ai_media_render_jobs_admission_held_ck CHECK (
  (budget_reservation_id IS NULL AND daily_plan_slot_id IS NULL AND slot_attempt IS NULL
    AND influencer_id IS NULL AND avatar_resource_id IS NULL AND voice_resource_id IS NULL
    AND script_id IS NULL AND script_variant_id IS NULL AND script_variant_checksum IS NULL
    AND source_item_id IS NULL AND source_content_hash IS NULL AND authority_snapshot_id IS NULL
    AND authority_digest IS NULL AND launch_intent_id IS NULL AND launch_intent_digest IS NULL
    AND admission_digest IS NULL AND work_handoff_digest IS NULL AND sealed_request_digest IS NULL
    AND provider_credential_version IS NULL AND lease_token IS NULL AND lease_fencing>=0)
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
    AND length(btrim(provider_key)) BETWEEN 1 AND 80 AND provider_credential_version>=1
    AND retry_count=0 AND lease_fencing>=0 AND isfinite(available_at) AND isfinite(queued_at)
    AND isfinite(created_at) AND isfinite(updated_at)
    AND ((stage IN ('admission_held','queued') AND status='pending' AND attempts=0
        AND provider_job_id IS NULL AND lease_owner IS NULL AND lease_token IS NULL AND lease_expires_at IS NULL
        AND provider_terminal_state IS NULL)
      OR (stage='leased' AND status='rendering' AND attempts IN (0,1) AND provider_job_id IS NULL
        AND lease_owner IS NOT NULL AND lease_token IS NOT NULL AND lease_expires_at IS NOT NULL
        AND provider_terminal_state IS NULL)
      OR (stage='submitted' AND status='rendering' AND attempts=1 AND provider_job_id IS NOT NULL
        AND lease_owner IS NULL AND lease_token IS NULL AND lease_expires_at IS NULL
        AND provider_terminal_state IS NULL)
      OR (stage='reconciling' AND attempts=1 AND provider_job_id IS NULL
        AND lease_owner IS NULL AND lease_token IS NULL AND lease_expires_at IS NULL
        AND provider_terminal_state IS NULL)
      OR (stage='failed' AND attempts=1 AND provider_job_id IS NULL
        AND lease_owner IS NULL AND lease_token IS NULL AND lease_expires_at IS NULL
        AND provider_terminal_state IS NULL)
      OR (provider_terminal_state='completed' AND attempts=1 AND provider_job_id IS NOT NULL AND output_url IS NULL
        AND lease_owner IS NULL AND lease_token IS NULL AND lease_expires_at IS NULL
        AND ((stage IN ('artifact_ingest_queued','artifact_ingest_retrying') AND status='rendering'
            AND progress>=95 AND output_media_asset_id IS NULL AND completed_at IS NULL AND error_message IS NULL)
          OR (stage='completed' AND status='completed' AND progress=100
            AND output_media_asset_id IS NOT NULL AND completed_at IS NOT NULL AND error_message IS NULL)
          OR (stage='artifact_ingest_failed' AND status='failed' AND progress=100
            AND output_media_asset_id IS NULL AND completed_at IS NOT NULL AND error_message IS NOT NULL)))
      OR (provider_terminal_state='failed' AND stage='failed' AND status='failed' AND progress=100
        AND attempts=1 AND provider_job_id IS NOT NULL AND completed_at=provider_terminal_observed_at
        AND error_code='provider_render_failed' AND error_message='Video provider reported a render failure'
        AND lease_owner IS NULL AND lease_token IS NULL AND lease_expires_at IS NULL))));

ALTER TABLE public.ai_media_outbox DROP CONSTRAINT ai_media_outbox_held_ck;
ALTER TABLE public.ai_media_outbox ADD CONSTRAINT ai_media_outbox_held_ck CHECK (
  (budget_reservation_id IS NULL AND render_job_id IS NULL AND work_handoff_digest IS NULL
    AND sealed_request_digest IS NULL)
  OR (budget_reservation_id IS NOT NULL AND render_job_id IS NOT NULL
    AND work_handoff_digest ~ '^sha256:[0-9a-f]{64}$' AND sealed_request_digest ~ '^sha256:[0-9a-f]{64}$'
    AND isfinite(available_at) AND isfinite(created_at) AND isfinite(updated_at)
    AND status IN ('held','pending','leased','reconciling','dispatched','dead_letter')
    AND (status<>'held' OR (attempts=0 AND locked_at IS NULL AND lease_owner IS NULL
      AND lease_expires_at IS NULL AND fencing_token=0 AND dead_letter_at IS NULL
      AND processed_at IS NULL AND last_error IS NULL))));

DROP TRIGGER ai_media_held_admission_expirations_immutable_guard ON public.ai_media_held_admission_expirations;
DROP TRIGGER ai_media_held_admission_expirations_truncate_guard ON public.ai_media_held_admission_expirations;
DROP FUNCTION public.ai_media_reject_held_admission_expiration_rewrite();
DROP TABLE public.ai_media_held_admission_expirations;
DROP TRIGGER ai_media_held_expiry_capabilities_guard ON public.ai_media_held_expiry_capabilities;
DROP TRIGGER ai_media_held_expiry_capabilities_truncate_guard ON public.ai_media_held_expiry_capabilities;
DROP FUNCTION public.ai_media_guard_held_expiry_capability();
DROP TABLE public.ai_media_held_expiry_capabilities;
DROP INDEX public.ai_media_outbox_held_expiry_identity_uq;
DROP INDEX public.ai_media_budget_reservations_held_expiry_identity_uq;

COMMIT;
