BEGIN;

DO $guard$
BEGIN
  IF to_regprocedure('public.ai_media_reject_held_handoff_mutation()') IS NULL
    OR EXISTS (SELECT 1 FROM ai_media_render_jobs WHERE stage='admission_held')
    OR EXISTS (SELECT 1 FROM ai_media_outbox WHERE status='held')
    OR EXISTS (SELECT 1 FROM ai_media_budget_reservations
      WHERE render_job_id IS NOT NULL OR dispatch_outbox_id IS NOT NULL OR work_handoff_digest IS NOT NULL)
  THEN
    RAISE EXCEPTION 'PR23 rollback requires an applied, empty admission-held handoff';
  END IF;
END
$guard$;

DROP TRIGGER ai_media_outbox_held_immutable_guard ON ai_media_outbox;
DROP TRIGGER ai_media_render_jobs_admission_held_immutable_guard ON ai_media_render_jobs;
DROP FUNCTION ai_media_reject_held_handoff_mutation();

ALTER TABLE ai_media_budget_reservations
  DROP CONSTRAINT ai_media_budget_reservations_exact_dispatch_outbox_fk,
  DROP CONSTRAINT ai_media_budget_reservations_exact_render_job_fk,
  DROP CONSTRAINT ai_media_budget_reservations_work_handoff_ck;
ALTER TABLE ai_media_budget_reservations
  ADD CONSTRAINT ai_media_budget_reservations_render_job_fk FOREIGN KEY
    (owner_user_id,workspace_id,render_job_id)
    REFERENCES ai_media_render_jobs(owner_user_id,workspace_id,id)
    ON UPDATE NO ACTION ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
  ADD CONSTRAINT ai_media_budget_reservations_dispatch_outbox_fk FOREIGN KEY
    (owner_user_id,workspace_id,dispatch_outbox_id)
    REFERENCES ai_media_outbox(owner_user_id,workspace_id,id)
    ON UPDATE NO ACTION ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE ai_media_outbox
  DROP CONSTRAINT ai_media_outbox_exact_render_job_fk,
  DROP CONSTRAINT ai_media_outbox_budget_reservation_fk,
  DROP CONSTRAINT ai_media_outbox_held_ck;
ALTER TABLE ai_media_render_jobs
  DROP CONSTRAINT ai_media_render_jobs_handoff_snapshot_fk,
  DROP CONSTRAINT ai_media_render_jobs_handoff_source_fk,
  DROP CONSTRAINT ai_media_render_jobs_handoff_script_variant_fk,
  DROP CONSTRAINT ai_media_render_jobs_handoff_voice_fk,
  DROP CONSTRAINT ai_media_render_jobs_handoff_avatar_fk,
  DROP CONSTRAINT ai_media_render_jobs_handoff_influencer_fk,
  DROP CONSTRAINT ai_media_render_jobs_handoff_slot_fk,
  DROP CONSTRAINT ai_media_render_jobs_budget_reservation_fk,
  DROP CONSTRAINT ai_media_render_jobs_admission_held_ck;

DROP INDEX ai_media_outbox_admission_handoff_uq;
DROP INDEX ai_media_render_jobs_outbox_handoff_uq;
DROP INDEX ai_media_render_jobs_admission_handoff_uq;
DROP INDEX ai_media_budget_reservations_tenant_id_uq;
DROP INDEX ai_media_source_items_handoff_tenant_id_uq;
DROP INDEX ai_media_budget_reservations_handoff_identity_uq;

ALTER TABLE ai_media_outbox
  DROP COLUMN sealed_request_digest,
  DROP COLUMN work_handoff_digest,
  DROP COLUMN render_job_id,
  DROP COLUMN budget_reservation_id;
ALTER TABLE ai_media_render_jobs
  DROP COLUMN provider_credential_version,
  DROP COLUMN sealed_request_digest,
  DROP COLUMN work_handoff_digest,
  DROP COLUMN admission_digest,
  DROP COLUMN launch_intent_digest,
  DROP COLUMN launch_intent_id,
  DROP COLUMN authority_digest,
  DROP COLUMN authority_snapshot_id,
  DROP COLUMN source_content_hash,
  DROP COLUMN source_item_id,
  DROP COLUMN script_variant_checksum,
  DROP COLUMN script_variant_id,
  DROP COLUMN script_id,
  DROP COLUMN voice_resource_id,
  DROP COLUMN avatar_resource_id,
  DROP COLUMN influencer_id,
  DROP COLUMN slot_attempt,
  DROP COLUMN daily_plan_slot_id,
  DROP COLUMN budget_reservation_id;
ALTER TABLE ai_media_budget_reservations DROP COLUMN work_handoff_digest;

COMMIT;
