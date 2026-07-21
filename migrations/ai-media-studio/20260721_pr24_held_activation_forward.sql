-- AI Media Studio PR24: exact admitted-held activation into internal queues.
-- Reviewed, additive/data-preserving migration. Do not apply automatically.
-- This migration does not commit budget or authorize provider submission.
-- Trusted-writer boundary: database controls below prove structural identity,
-- atomicity, and immutability only. Eligibility and caller authorization are
-- established by the capability-gated application repository before writes;
-- direct SQL access must remain restricted to trusted application roles.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15min';
SET LOCAL search_path = public, pg_catalog;

DO $preflight$
BEGIN
  IF to_regclass('public.ai_media_budget_reservations') IS NULL
    OR to_regclass('public.ai_media_render_jobs') IS NULL
    OR to_regclass('public.ai_media_outbox') IS NULL
    OR to_regclass('public.ai_media_daily_plan_slots') IS NULL
    OR to_regclass('public.ai_media_launch_authority_snapshots') IS NULL
    OR to_regclass('public.ai_media_work_activations') IS NOT NULL
    OR to_regprocedure('public.ai_media_reject_held_handoff_mutation()') IS NULL
    OR NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='ai_media_render_jobs_admission_held_ck'
      AND conrelid='public.ai_media_render_jobs'::regclass)
    OR NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='ai_media_outbox_held_ck'
      AND conrelid='public.ai_media_outbox'::regclass)
  THEN
    RAISE EXCEPTION 'PR24 requires the exact PR23 admitted-held controls and must not already be applied';
  END IF;
END
$preflight$;

LOCK TABLE ai_media_budget_reservations, ai_media_render_jobs, ai_media_outbox,
  ai_media_daily_plan_slots IN ACCESS EXCLUSIVE MODE;

CREATE TABLE ai_media_work_activations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id text NOT NULL,
  workspace_id text NOT NULL DEFAULT 'personal',
  budget_reservation_id uuid NOT NULL,
  render_job_id uuid NOT NULL,
  dispatch_outbox_id uuid NOT NULL,
  daily_plan_slot_id uuid NOT NULL,
  slot_attempt integer NOT NULL,
  provider_account_id uuid NOT NULL,
  provider_key text NOT NULL,
  provider_credential_version integer NOT NULL,
  provider_idempotency_key text NOT NULL,
  script_variant_checksum text NOT NULL,
  authority_snapshot_id uuid NOT NULL,
  authority_digest text NOT NULL,
  launch_intent_id uuid NOT NULL,
  launch_intent_digest text NOT NULL,
  admission_digest text NOT NULL,
  work_handoff_digest text NOT NULL,
  sealed_request_digest text NOT NULL,
  slot_state_version_before integer NOT NULL,
  slot_state_version_after integer NOT NULL,
  actor_user_id text NOT NULL,
  idempotency_key text NOT NULL,
  input_digest text NOT NULL,
  activation_digest text NOT NULL,
  activated_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  CONSTRAINT ai_media_work_activations_ck CHECK (
    slot_attempt>=1 AND provider_credential_version>=1
    AND length(btrim(provider_key)) BETWEEN 1 AND 80
    AND length(btrim(provider_idempotency_key)) BETWEEN 8 AND 200
    AND script_variant_checksum ~ '^[0-9a-f]{64}$'
    AND authority_digest ~ '^sha256:[0-9a-f]{64}$'
    AND launch_intent_digest ~ '^sha256:[0-9a-f]{64}$'
    AND admission_digest ~ '^sha256:[0-9a-f]{64}$'
    AND work_handoff_digest ~ '^sha256:[0-9a-f]{64}$'
    AND sealed_request_digest ~ '^sha256:[0-9a-f]{64}$'
    AND slot_state_version_before>=1
    AND slot_state_version_after=slot_state_version_before+1
    AND length(btrim(actor_user_id)) BETWEEN 1 AND 200
    AND length(btrim(idempotency_key)) BETWEEN 8 AND 200
    AND input_digest ~ '^sha256:[0-9a-f]{64}$'
    AND activation_digest ~ '^sha256:[0-9a-f]{64}$'
    AND isfinite(activated_at) AND isfinite(created_at)
  )
);
CREATE UNIQUE INDEX ai_media_work_activations_idempotency_uq
  ON ai_media_work_activations(owner_user_id,workspace_id,idempotency_key);
CREATE UNIQUE INDEX ai_media_work_activations_reservation_uq
  ON ai_media_work_activations(owner_user_id,workspace_id,budget_reservation_id);
CREATE UNIQUE INDEX ai_media_render_jobs_activation_identity_uq
  ON ai_media_render_jobs(owner_user_id,workspace_id,id,budget_reservation_id,daily_plan_slot_id,
    slot_attempt,provider_account_id,provider_key,provider_credential_version,script_variant_checksum,
    authority_snapshot_id,authority_digest,launch_intent_id,launch_intent_digest,admission_digest,
    work_handoff_digest,sealed_request_digest,idempotency_key);

ALTER TABLE ai_media_work_activations
  ADD CONSTRAINT ai_media_work_activations_exact_reservation_fk FOREIGN KEY
    (owner_user_id,workspace_id,budget_reservation_id,render_job_id,dispatch_outbox_id,
      work_handoff_digest,daily_plan_slot_id,slot_attempt,provider_account_id,provider_key,
      provider_credential_version,script_variant_checksum,authority_snapshot_id,authority_digest,
      admission_digest,provider_idempotency_key)
    REFERENCES ai_media_budget_reservations(owner_user_id,workspace_id,id,render_job_id,
      dispatch_outbox_id,work_handoff_digest,daily_plan_slot_id,attempt,provider_account_id,provider_key,
      provider_credential_version,script_variant_checksum,authority_snapshot_id,authority_digest,
      admission_digest,provider_idempotency_key) ON UPDATE NO ACTION ON DELETE RESTRICT,
  ADD CONSTRAINT ai_media_work_activations_exact_render_fk FOREIGN KEY
    (owner_user_id,workspace_id,render_job_id,budget_reservation_id,daily_plan_slot_id,slot_attempt,
      provider_account_id,provider_key,provider_credential_version,script_variant_checksum,
      authority_snapshot_id,authority_digest,launch_intent_id,launch_intent_digest,admission_digest,
      work_handoff_digest,sealed_request_digest,provider_idempotency_key)
    REFERENCES ai_media_render_jobs(owner_user_id,workspace_id,id,budget_reservation_id,daily_plan_slot_id,
      slot_attempt,provider_account_id,provider_key,provider_credential_version,script_variant_checksum,
      authority_snapshot_id,authority_digest,launch_intent_id,launch_intent_digest,admission_digest,
      work_handoff_digest,sealed_request_digest,idempotency_key)
    ON UPDATE NO ACTION ON DELETE RESTRICT,
  ADD CONSTRAINT ai_media_work_activations_exact_outbox_fk FOREIGN KEY
    (owner_user_id,workspace_id,dispatch_outbox_id,budget_reservation_id,render_job_id,work_handoff_digest)
    REFERENCES ai_media_outbox(owner_user_id,workspace_id,id,budget_reservation_id,render_job_id,
      work_handoff_digest) ON UPDATE NO ACTION ON DELETE RESTRICT,
  ADD CONSTRAINT ai_media_work_activations_exact_slot_fk FOREIGN KEY
    (owner_user_id,workspace_id,daily_plan_slot_id,provider_account_id,provider_key,provider_credential_version)
    REFERENCES ai_media_daily_plan_slots(owner_user_id,workspace_id,id,provider_account_id,provider_key,
      provider_credential_version) ON UPDATE NO ACTION ON DELETE RESTRICT;

ALTER TABLE ai_media_render_jobs DROP CONSTRAINT ai_media_render_jobs_admission_held_ck;
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
    AND admission_digest ~ '^sha256:[0-9a-f]{64}$'
    AND work_handoff_digest ~ '^sha256:[0-9a-f]{64}$'
    AND sealed_request_digest ~ '^sha256:[0-9a-f]{64}$'
    AND provider_account_id IS NOT NULL AND length(btrim(provider_key)) BETWEEN 1 AND 80
    AND provider_credential_version>=1
    AND stage IN ('admission_held','queued') AND status='pending' AND provider_job_id IS NULL
    AND attempts=0 AND retry_count=0 AND lease_owner IS NULL AND lease_expires_at IS NULL
    AND isfinite(available_at) AND isfinite(queued_at) AND isfinite(created_at) AND isfinite(updated_at))
);

ALTER TABLE ai_media_outbox DROP CONSTRAINT ai_media_outbox_held_ck;
ALTER TABLE ai_media_outbox ADD CONSTRAINT ai_media_outbox_held_ck CHECK (
  (budget_reservation_id IS NULL AND render_job_id IS NULL AND work_handoff_digest IS NULL
    AND sealed_request_digest IS NULL)
  OR (budget_reservation_id IS NOT NULL AND render_job_id IS NOT NULL
    AND work_handoff_digest ~ '^sha256:[0-9a-f]{64}$'
    AND sealed_request_digest ~ '^sha256:[0-9a-f]{64}$'
    AND status IN ('held','pending','leased','retry_wait','dispatched','dead_letter')
    AND (status<>'held' OR (attempts=0 AND locked_at IS NULL AND lease_owner IS NULL
      AND lease_expires_at IS NULL AND fencing_token=0 AND dead_letter_at IS NULL
      AND processed_at IS NULL AND last_error IS NULL))
    AND isfinite(available_at) AND isfinite(created_at) AND isfinite(updated_at))
);

DROP TRIGGER ai_media_render_jobs_admission_held_immutable_guard ON ai_media_render_jobs;
DROP TRIGGER ai_media_outbox_held_immutable_guard ON ai_media_outbox;
DROP FUNCTION ai_media_reject_held_handoff_mutation();

CREATE FUNCTION ai_media_guard_admitted_handoff() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public AS $guard$
BEGIN
  IF TG_TABLE_NAME='ai_media_render_jobs' THEN
    IF TG_OP='DELETE' THEN
      IF OLD.budget_reservation_id IS NOT NULL THEN
        RAISE EXCEPTION 'admitted render evidence cannot be deleted';
      END IF;
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
            WHERE activation.owner_user_id=OLD.owner_user_id
              AND activation.workspace_id=OLD.workspace_id
              AND activation.budget_reservation_id=OLD.budget_reservation_id
              AND activation.render_job_id=OLD.id
              AND activation.work_handoff_digest=OLD.work_handoff_digest
              AND activation.sealed_request_digest=OLD.sealed_request_digest) THEN
          RAISE EXCEPTION 'held render requires one exact activation transition';
        END IF;
      ELSE
        RAISE EXCEPTION 'queued admitted render remains inert until the budget-aware submission migration';
      END IF;
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP='DELETE' THEN
    IF OLD.budget_reservation_id IS NOT NULL THEN
      RAISE EXCEPTION 'admitted outbox evidence cannot be deleted';
    END IF;
    RETURN OLD;
  END IF;
  IF OLD.budget_reservation_id IS NULL AND NEW.budget_reservation_id IS NOT NULL THEN
    RAISE EXCEPTION 'admission bindings cannot be attached by update';
  END IF;
  IF OLD.budget_reservation_id IS NOT NULL THEN
    IF ROW(NEW.owner_user_id,NEW.workspace_id,NEW.budget_reservation_id,NEW.render_job_id,
        NEW.work_handoff_digest,NEW.sealed_request_digest,NEW.idempotency_key,NEW.aggregate_type,
        NEW.aggregate_id,NEW.event_type,NEW.payload)
      IS DISTINCT FROM
      ROW(OLD.owner_user_id,OLD.workspace_id,OLD.budget_reservation_id,OLD.render_job_id,
        OLD.work_handoff_digest,OLD.sealed_request_digest,OLD.idempotency_key,OLD.aggregate_type,
        OLD.aggregate_id,OLD.event_type,OLD.payload) THEN
      RAISE EXCEPTION 'admitted outbox identity and payload are immutable';
    END IF;
    IF OLD.status='held' THEN
      IF NEW.status<>'pending'
        OR (to_jsonb(NEW)-'status'-'available_at'-'updated_at')
          IS DISTINCT FROM (to_jsonb(OLD)-'status'-'available_at'-'updated_at')
        OR NOT EXISTS (SELECT 1 FROM public.ai_media_work_activations activation
          WHERE activation.owner_user_id=OLD.owner_user_id
            AND activation.workspace_id=OLD.workspace_id
            AND activation.budget_reservation_id=OLD.budget_reservation_id
            AND activation.dispatch_outbox_id=OLD.id
            AND activation.render_job_id=OLD.render_job_id
            AND activation.work_handoff_digest=OLD.work_handoff_digest
            AND activation.sealed_request_digest=OLD.sealed_request_digest) THEN
        RAISE EXCEPTION 'held outbox requires one exact activation transition';
      END IF;
    ELSIF NEW.status='held' THEN
      RAISE EXCEPTION 'admitted outbox cannot return to held';
    END IF;
  END IF;
  RETURN NEW;
END
$guard$;

CREATE TRIGGER ai_media_render_jobs_admitted_handoff_guard
  BEFORE UPDATE OR DELETE ON ai_media_render_jobs
  FOR EACH ROW EXECUTE FUNCTION ai_media_guard_admitted_handoff();
CREATE TRIGGER ai_media_outbox_admitted_handoff_guard
  BEFORE UPDATE OR DELETE ON ai_media_outbox
  FOR EACH ROW EXECUTE FUNCTION ai_media_guard_admitted_handoff();

CREATE FUNCTION ai_media_reject_work_activation_rewrite() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public AS $guard$
BEGIN
  RAISE EXCEPTION 'work activation evidence is append-only and immutable';
END
$guard$;
CREATE TRIGGER ai_media_work_activations_immutable_guard
  BEFORE UPDATE OR DELETE ON ai_media_work_activations
  FOR EACH ROW EXECUTE FUNCTION ai_media_reject_work_activation_rewrite();

CREATE FUNCTION ai_media_assert_work_activation_final_state() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public AS $guard$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.ai_media_render_jobs job
    INNER JOIN public.ai_media_outbox outbox
      ON outbox.owner_user_id=job.owner_user_id AND outbox.workspace_id=job.workspace_id
      AND outbox.id=NEW.dispatch_outbox_id AND outbox.budget_reservation_id=NEW.budget_reservation_id
      AND outbox.render_job_id=job.id AND outbox.work_handoff_digest=NEW.work_handoff_digest
      AND outbox.sealed_request_digest=NEW.sealed_request_digest
    INNER JOIN public.ai_media_daily_plan_slots slot
      ON slot.owner_user_id=job.owner_user_id AND slot.workspace_id=job.workspace_id
      AND slot.id=NEW.daily_plan_slot_id
    WHERE job.owner_user_id=NEW.owner_user_id AND job.workspace_id=NEW.workspace_id
      AND job.id=NEW.render_job_id AND job.budget_reservation_id=NEW.budget_reservation_id
      AND job.work_handoff_digest=NEW.work_handoff_digest
      AND job.sealed_request_digest=NEW.sealed_request_digest
      AND job.stage='queued' AND job.status='pending' AND job.provider_job_id IS NULL
      AND job.attempts=0 AND job.retry_count=0 AND job.lease_owner IS NULL AND job.lease_expires_at IS NULL
      AND outbox.status IN ('pending','leased','retry_wait','dispatched','dead_letter')
      AND slot.state_version>=NEW.slot_state_version_after
      AND slot.status IN ('queued','committed','submitted','reconciling','completed','failed','cancelled')
  ) THEN
    RAISE EXCEPTION 'work activation must atomically leave the exact triplet in post-activation states';
  END IF;
  RETURN NULL;
END
$guard$;
CREATE CONSTRAINT TRIGGER ai_media_work_activations_final_state_guard
  AFTER INSERT ON ai_media_work_activations DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION ai_media_assert_work_activation_final_state();

CREATE FUNCTION ai_media_reject_reservation_handoff_mutation() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public AS $guard$
BEGIN
  IF ROW(NEW.render_job_id,NEW.dispatch_outbox_id,NEW.work_handoff_digest)
    IS DISTINCT FROM ROW(OLD.render_job_id,OLD.dispatch_outbox_id,OLD.work_handoff_digest) THEN
    RAISE EXCEPTION 'attached admitted handoff identity cannot change';
  END IF;
  RETURN NEW;
END
$guard$;
CREATE TRIGGER ai_media_budget_reservations_handoff_immutable_guard
  BEFORE UPDATE ON ai_media_budget_reservations
  FOR EACH ROW EXECUTE FUNCTION ai_media_reject_reservation_handoff_mutation();

COMMIT;
