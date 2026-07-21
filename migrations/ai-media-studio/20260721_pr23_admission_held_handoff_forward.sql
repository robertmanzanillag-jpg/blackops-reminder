BEGIN;

DO $guard$
BEGIN
  IF to_regclass('public.ai_media_budget_reservations') IS NULL
    OR to_regclass('public.ai_media_render_jobs') IS NULL
    OR to_regclass('public.ai_media_outbox') IS NULL
    OR to_regclass('public.ai_media_launch_authority_snapshots') IS NULL
    OR to_regprocedure('public.ai_media_reject_held_handoff_mutation()') IS NOT NULL
    OR EXISTS (SELECT 1 FROM ai_media_budget_reservations
      WHERE render_job_id IS NOT NULL OR dispatch_outbox_id IS NOT NULL)
    OR EXISTS (SELECT 1 FROM ai_media_render_jobs WHERE stage='admission_held')
    OR EXISTS (SELECT 1 FROM ai_media_outbox WHERE status='held')
    OR EXISTS (
      SELECT 1 FROM pg_attribute
      WHERE attrelid IN ('ai_media_budget_reservations'::regclass,
        'ai_media_render_jobs'::regclass,'ai_media_outbox'::regclass)
        AND attname IN ('work_handoff_digest','budget_reservation_id','sealed_request_digest')
        AND NOT attisdropped
    )
  THEN
    RAISE EXCEPTION 'PR23 admission-held handoff prerequisites are missing or migration is already applied';
  END IF;
END
$guard$;

ALTER TABLE ai_media_budget_reservations
  ADD COLUMN work_handoff_digest text;

ALTER TABLE ai_media_budget_reservations
  DROP CONSTRAINT ai_media_budget_reservations_render_job_fk,
  DROP CONSTRAINT ai_media_budget_reservations_dispatch_outbox_fk;

ALTER TABLE ai_media_render_jobs
  ADD COLUMN budget_reservation_id uuid,
  ADD COLUMN daily_plan_slot_id uuid,
  ADD COLUMN slot_attempt integer,
  ADD COLUMN influencer_id uuid,
  ADD COLUMN avatar_resource_id uuid,
  ADD COLUMN voice_resource_id uuid,
  ADD COLUMN script_id uuid,
  ADD COLUMN script_variant_id uuid,
  ADD COLUMN script_variant_checksum text,
  ADD COLUMN source_item_id uuid,
  ADD COLUMN source_content_hash text,
  ADD COLUMN authority_snapshot_id uuid,
  ADD COLUMN authority_digest text,
  ADD COLUMN launch_intent_id uuid,
  ADD COLUMN launch_intent_digest text,
  ADD COLUMN admission_digest text,
  ADD COLUMN work_handoff_digest text,
  ADD COLUMN sealed_request_digest text,
  ADD COLUMN provider_credential_version integer;

ALTER TABLE ai_media_outbox
  ADD COLUMN budget_reservation_id uuid,
  ADD COLUMN render_job_id uuid,
  ADD COLUMN work_handoff_digest text,
  ADD COLUMN sealed_request_digest text;

CREATE UNIQUE INDEX ai_media_budget_reservations_handoff_identity_uq
  ON ai_media_budget_reservations(owner_user_id,workspace_id,id,render_job_id,
    dispatch_outbox_id,work_handoff_digest,daily_plan_slot_id,attempt,provider_account_id,
    provider_key,provider_credential_version,script_variant_checksum,authority_snapshot_id,
    authority_digest,admission_digest,provider_idempotency_key);
CREATE UNIQUE INDEX ai_media_budget_reservations_tenant_id_uq
  ON ai_media_budget_reservations(owner_user_id,workspace_id,id);
CREATE UNIQUE INDEX ai_media_source_items_handoff_tenant_id_uq
  ON ai_media_source_items(owner_user_id,workspace_id,id);
CREATE UNIQUE INDEX ai_media_render_jobs_admission_handoff_uq
  ON ai_media_render_jobs(owner_user_id,workspace_id,id,budget_reservation_id,daily_plan_slot_id,
    slot_attempt,provider_account_id,provider_key,provider_credential_version,
    script_variant_checksum,authority_snapshot_id,authority_digest,admission_digest,
    work_handoff_digest,idempotency_key);
CREATE UNIQUE INDEX ai_media_render_jobs_outbox_handoff_uq
  ON ai_media_render_jobs(owner_user_id,workspace_id,id,budget_reservation_id,
    work_handoff_digest,sealed_request_digest);
CREATE UNIQUE INDEX ai_media_outbox_admission_handoff_uq
  ON ai_media_outbox(owner_user_id,workspace_id,id,budget_reservation_id,render_job_id,work_handoff_digest);

ALTER TABLE ai_media_budget_reservations
  ADD CONSTRAINT ai_media_budget_reservations_work_handoff_ck CHECK (
    (render_job_id IS NULL AND dispatch_outbox_id IS NULL AND work_handoff_digest IS NULL)
    OR (render_job_id IS NOT NULL AND dispatch_outbox_id IS NOT NULL
      AND work_handoff_digest ~ '^sha256:[0-9a-f]{64}$')
  );

ALTER TABLE ai_media_render_jobs
  ADD CONSTRAINT ai_media_render_jobs_admission_held_ck CHECK (
    (stage<>'admission_held' AND budget_reservation_id IS NULL AND daily_plan_slot_id IS NULL
      AND slot_attempt IS NULL AND influencer_id IS NULL AND avatar_resource_id IS NULL
      AND voice_resource_id IS NULL AND script_id IS NULL AND script_variant_id IS NULL
      AND script_variant_checksum IS NULL AND source_item_id IS NULL AND source_content_hash IS NULL
      AND authority_snapshot_id IS NULL AND authority_digest IS NULL AND launch_intent_id IS NULL
      AND launch_intent_digest IS NULL AND admission_digest IS NULL AND work_handoff_digest IS NULL
      AND sealed_request_digest IS NULL AND provider_credential_version IS NULL)
    OR (stage='admission_held' AND (
      budget_reservation_id IS NOT NULL AND daily_plan_slot_id IS NOT NULL AND slot_attempt>=1
      AND influencer_id IS NOT NULL AND avatar_resource_id IS NOT NULL AND voice_resource_id IS NOT NULL
      AND script_id IS NOT NULL AND script_variant_id IS NOT NULL
      AND script_variant_checksum ~ '^[0-9a-f]{64}$'
      AND ((source_item_id IS NULL AND source_content_hash IS NULL)
        OR (source_item_id IS NOT NULL AND source_content_hash ~ '^sha256:[0-9a-f]{64}$'))
      AND authority_snapshot_id IS NOT NULL AND authority_digest ~ '^sha256:[0-9a-f]{64}$'
      AND launch_intent_id IS NOT NULL AND launch_intent_digest ~ '^sha256:[0-9a-f]{64}$'
      AND admission_digest ~ '^sha256:[0-9a-f]{64}$'
      AND work_handoff_digest ~ '^sha256:[0-9a-f]{64}$'
      AND sealed_request_digest ~ '^sha256:[0-9a-f]{64}$'
      AND provider_account_id IS NOT NULL AND length(btrim(provider_key)) BETWEEN 1 AND 80
      AND provider_credential_version>=1 AND status='pending'
      AND provider_job_id IS NULL AND attempts=0 AND retry_count=0
      AND lease_owner IS NULL AND lease_expires_at IS NULL
      AND isfinite(available_at) AND isfinite(queued_at) AND isfinite(created_at) AND isfinite(updated_at)
    ))
  );

ALTER TABLE ai_media_outbox
  ADD CONSTRAINT ai_media_outbox_held_ck CHECK (
    (status<>'held' AND budget_reservation_id IS NULL AND render_job_id IS NULL
      AND work_handoff_digest IS NULL AND sealed_request_digest IS NULL)
    OR (status='held' AND (
      budget_reservation_id IS NOT NULL AND render_job_id IS NOT NULL
      AND work_handoff_digest ~ '^sha256:[0-9a-f]{64}$'
      AND sealed_request_digest ~ '^sha256:[0-9a-f]{64}$'
      AND attempts=0 AND locked_at IS NULL AND lease_owner IS NULL AND lease_expires_at IS NULL
      AND fencing_token=0 AND dead_letter_at IS NULL AND processed_at IS NULL AND last_error IS NULL
      AND isfinite(available_at) AND isfinite(created_at) AND isfinite(updated_at)
    ))
  );

ALTER TABLE ai_media_render_jobs
  ADD CONSTRAINT ai_media_render_jobs_budget_reservation_fk FOREIGN KEY
    (owner_user_id,workspace_id,budget_reservation_id)
    REFERENCES ai_media_budget_reservations(owner_user_id,workspace_id,id)
    ON UPDATE NO ACTION ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
  ADD CONSTRAINT ai_media_render_jobs_handoff_slot_fk FOREIGN KEY
    (owner_user_id,workspace_id,daily_plan_slot_id,provider_account_id,provider_key,provider_credential_version)
    REFERENCES ai_media_daily_plan_slots(owner_user_id,workspace_id,id,provider_account_id,provider_key,
      provider_credential_version) ON UPDATE NO ACTION ON DELETE RESTRICT,
  ADD CONSTRAINT ai_media_render_jobs_handoff_influencer_fk FOREIGN KEY
    (owner_user_id,workspace_id,influencer_id)
    REFERENCES ai_media_influencers(owner_user_id,workspace_id,id) ON UPDATE NO ACTION ON DELETE RESTRICT,
  ADD CONSTRAINT ai_media_render_jobs_handoff_avatar_fk FOREIGN KEY
    (owner_user_id,workspace_id,provider_account_id,provider_key,avatar_resource_id)
    REFERENCES ai_media_provider_resources(owner_user_id,workspace_id,provider_account_id,provider_key,id)
    ON UPDATE NO ACTION ON DELETE RESTRICT,
  ADD CONSTRAINT ai_media_render_jobs_handoff_voice_fk FOREIGN KEY
    (owner_user_id,workspace_id,provider_account_id,provider_key,voice_resource_id)
    REFERENCES ai_media_provider_resources(owner_user_id,workspace_id,provider_account_id,provider_key,id)
    ON UPDATE NO ACTION ON DELETE RESTRICT,
  ADD CONSTRAINT ai_media_render_jobs_handoff_script_variant_fk FOREIGN KEY
    (owner_user_id,workspace_id,script_variant_id,script_id,script_variant_checksum)
    REFERENCES ai_media_script_variants(owner_user_id,workspace_id,id,script_id,checksum)
    ON UPDATE NO ACTION ON DELETE RESTRICT,
  ADD CONSTRAINT ai_media_render_jobs_handoff_source_fk FOREIGN KEY
    (owner_user_id,workspace_id,source_item_id)
    REFERENCES ai_media_source_items(owner_user_id,workspace_id,id)
    ON UPDATE NO ACTION ON DELETE RESTRICT,
  ADD CONSTRAINT ai_media_render_jobs_handoff_snapshot_fk FOREIGN KEY
    (owner_user_id,workspace_id,authority_snapshot_id,daily_plan_slot_id,slot_attempt,
      admission_digest,provider_account_id,provider_key,provider_credential_version,
      script_variant_checksum,launch_intent_id,launch_intent_digest,authority_digest)
    REFERENCES ai_media_launch_authority_snapshots(owner_user_id,workspace_id,id,daily_plan_slot_id,
      slot_attempt,admission_digest,provider_account_id,provider_key,provider_credential_version,
      script_variant_checksum,launch_intent_id,launch_intent_digest,authority_digest)
    ON UPDATE NO ACTION ON DELETE RESTRICT;

ALTER TABLE ai_media_outbox
  ADD CONSTRAINT ai_media_outbox_budget_reservation_fk FOREIGN KEY
    (owner_user_id,workspace_id,budget_reservation_id)
    REFERENCES ai_media_budget_reservations(owner_user_id,workspace_id,id)
    ON UPDATE NO ACTION ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
  ADD CONSTRAINT ai_media_outbox_exact_render_job_fk FOREIGN KEY
    (owner_user_id,workspace_id,render_job_id,budget_reservation_id,work_handoff_digest,sealed_request_digest)
    REFERENCES ai_media_render_jobs(owner_user_id,workspace_id,id,budget_reservation_id,
      work_handoff_digest,sealed_request_digest)
    ON UPDATE NO ACTION ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE ai_media_budget_reservations
  ADD CONSTRAINT ai_media_budget_reservations_exact_render_job_fk FOREIGN KEY
    (owner_user_id,workspace_id,render_job_id,id,daily_plan_slot_id,attempt,provider_account_id,
      provider_key,provider_credential_version,script_variant_checksum,authority_snapshot_id,
      authority_digest,admission_digest,work_handoff_digest,provider_idempotency_key)
    REFERENCES ai_media_render_jobs(owner_user_id,workspace_id,id,budget_reservation_id,
      daily_plan_slot_id,slot_attempt,provider_account_id,provider_key,provider_credential_version,
      script_variant_checksum,authority_snapshot_id,authority_digest,admission_digest,
      work_handoff_digest,idempotency_key)
    ON UPDATE NO ACTION ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
  ADD CONSTRAINT ai_media_budget_reservations_exact_dispatch_outbox_fk FOREIGN KEY
    (owner_user_id,workspace_id,dispatch_outbox_id,id,render_job_id,work_handoff_digest)
    REFERENCES ai_media_outbox(owner_user_id,workspace_id,id,budget_reservation_id,render_job_id,
      work_handoff_digest)
    ON UPDATE NO ACTION ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED;

CREATE FUNCTION ai_media_reject_held_handoff_mutation() RETURNS trigger LANGUAGE plpgsql AS $guard$
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
  IF TG_OP='DELETE' THEN
    RETURN OLD;
  END IF;
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
