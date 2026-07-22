-- AI Media Studio PR31: terminal expiry for never-activated held admissions.
-- Review artifact only. Do not apply automatically.
-- This transition performs no provider I/O, submission, spend, publication, or deployment.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15min';
SET LOCAL search_path = public, pg_catalog;

DO $preflight$
DECLARE role_row record;
BEGIN
  IF current_setting('server_version_num')::integer<160000
    OR to_regclass('public.ai_media_work_activations') IS NULL
    OR to_regclass('public.ai_media_provider_submission_attempts') IS NULL
    OR to_regclass('public.ai_media_provider_terminal_events') IS NULL
    OR to_regclass('public.ai_media_held_admission_expirations') IS NOT NULL
    OR to_regprocedure('public.ai_media_guard_admitted_submission_rows()') IS NULL
    OR to_regprocedure('public.ai_media_assert_pr25_consistency()') IS NULL
    OR to_regprocedure('ai_media_worker_api.sha256_text_v1(text)') IS NULL
    OR NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='ai_media_render_jobs_admission_held_ck'
      AND conrelid='public.ai_media_render_jobs'::regclass)
    OR NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='ai_media_outbox_held_ck'
      AND conrelid='public.ai_media_outbox'::regclass)
  THEN
    RAISE EXCEPTION 'PR31 requires the exact PostgreSQL 16 PR27 admitted-worker chain and must not already be applied';
  END IF;
  SELECT * INTO role_row FROM pg_catalog.pg_roles WHERE rolname='ai_media_held_expiry_executor';
  IF NOT FOUND OR role_row.rolcanlogin OR role_row.rolsuper OR role_row.rolinherit
    OR role_row.rolcreaterole OR role_row.rolcreatedb OR role_row.rolreplication OR role_row.rolbypassrls
    OR pg_catalog.pg_has_role('ai_media_held_expiry_executor','ai_media_admitted_fn_owner','MEMBER')
    OR pg_catalog.pg_has_role('ai_media_held_expiry_executor','ai_media_admitted_submit_executor','MEMBER')
    OR pg_catalog.pg_has_role('ai_media_held_expiry_executor','ai_media_admitted_reconcile_executor','MEMBER') THEN
    RAISE EXCEPTION 'PR31 requires a safe precreated table-blind NOLOGIN NOINHERIT ai_media_held_expiry_executor role';
  END IF;
END
$preflight$;

LOCK TABLE public.ai_media_budget_buckets,public.ai_media_budget_reservations,
  public.ai_media_render_jobs,public.ai_media_outbox,public.ai_media_daily_plan_slots,
  public.ai_media_work_activations,public.ai_media_provider_submission_attempts
  IN ACCESS EXCLUSIVE MODE;

CREATE UNIQUE INDEX ai_media_budget_reservations_held_expiry_identity_uq
  ON public.ai_media_budget_reservations(owner_user_id,workspace_id,id,budget_bucket_id,
    render_job_id,dispatch_outbox_id,daily_plan_slot_id,attempt,provider_account_id,provider_key,
    provider_credential_version,amount_micro_usd,currency,expires_at,work_handoff_digest);
CREATE UNIQUE INDEX ai_media_outbox_held_expiry_identity_uq
  ON public.ai_media_outbox(owner_user_id,workspace_id,id,budget_reservation_id,
    render_job_id,work_handoff_digest,sealed_request_digest);

CREATE TABLE public.ai_media_held_expiry_capabilities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  database_principal name NOT NULL,
  owner_user_id text NOT NULL,
  workspace_id text NOT NULL,
  max_expirations integer NOT NULL DEFAULT 1,
  valid_from timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  evidence_digest text NOT NULL,
  revocation_evidence_digest text,
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  CONSTRAINT ai_media_held_expiry_capabilities_ck CHECK (
    length(btrim(database_principal::text)) BETWEEN 1 AND 63
    AND length(btrim(owner_user_id)) BETWEEN 1 AND 200
    AND length(btrim(workspace_id)) BETWEEN 1 AND 200
    AND max_expirations=1 AND expires_at>valid_from
    AND isfinite(valid_from) AND isfinite(expires_at) AND isfinite(created_at)
    AND evidence_digest ~ '^sha256:[0-9a-f]{64}$'
    AND ((revoked_at IS NULL AND revocation_evidence_digest IS NULL)
      OR (isfinite(revoked_at) AND revocation_evidence_digest ~ '^sha256:[0-9a-f]{64}$'))
  )
);
CREATE UNIQUE INDEX ai_media_held_expiry_capabilities_scope_uq
  ON public.ai_media_held_expiry_capabilities(database_principal,owner_user_id,workspace_id,id);
CREATE UNIQUE INDEX ai_media_held_expiry_capabilities_exact_identity_uq
  ON public.ai_media_held_expiry_capabilities(id,owner_user_id,workspace_id);

CREATE FUNCTION public.ai_media_guard_held_expiry_capability() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET row_security=on AS $guard$
BEGIN
  IF TG_OP IN ('DELETE','TRUNCATE') THEN RAISE EXCEPTION 'held expiry capability evidence cannot be deleted'; END IF;
  IF ROW(NEW.id,NEW.database_principal,NEW.owner_user_id,NEW.workspace_id,NEW.max_expirations,
      NEW.valid_from,NEW.expires_at,NEW.evidence_digest,NEW.created_at)
    IS DISTINCT FROM ROW(OLD.id,OLD.database_principal,OLD.owner_user_id,OLD.workspace_id,
      OLD.max_expirations,OLD.valid_from,OLD.expires_at,OLD.evidence_digest,OLD.created_at)
    OR OLD.revoked_at IS NOT NULL OR NEW.revoked_at IS NULL
    OR NEW.revocation_evidence_digest!~'^sha256:[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'held expiry capability is immutable except one evidenced revocation';
  END IF;
  RETURN NEW;
END
$guard$;
CREATE TRIGGER ai_media_held_expiry_capabilities_guard BEFORE UPDATE OR DELETE
  ON public.ai_media_held_expiry_capabilities FOR EACH ROW
  EXECUTE FUNCTION public.ai_media_guard_held_expiry_capability();
CREATE TRIGGER ai_media_held_expiry_capabilities_truncate_guard BEFORE TRUNCATE
  ON public.ai_media_held_expiry_capabilities FOR EACH STATEMENT
  EXECUTE FUNCTION public.ai_media_guard_held_expiry_capability();

CREATE TABLE public.ai_media_held_admission_expirations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id text NOT NULL,
  workspace_id text NOT NULL DEFAULT 'personal',
  expiry_capability_id uuid NOT NULL,
  budget_reservation_id uuid NOT NULL,
  budget_bucket_id uuid NOT NULL,
  render_job_id uuid NOT NULL,
  dispatch_outbox_id uuid NOT NULL,
  daily_plan_slot_id uuid NOT NULL,
  slot_attempt integer NOT NULL,
  provider_account_id uuid NOT NULL,
  provider_key text NOT NULL,
  provider_credential_version integer NOT NULL,
  amount_micro_usd numeric(20,0) NOT NULL,
  currency text NOT NULL,
  work_handoff_digest text NOT NULL,
  sealed_request_digest text NOT NULL,
  reservation_expires_at timestamptz NOT NULL,
  slot_state_version_before integer NOT NULL,
  slot_state_version_after integer NOT NULL,
  actor_user_id text NOT NULL,
  idempotency_key text NOT NULL,
  input_digest text NOT NULL,
  expiration_evidence_digest text NOT NULL,
  expired_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL,
  CONSTRAINT ai_media_held_admission_expirations_ck CHECK (
    slot_attempt>=1 AND provider_credential_version>=1
    AND length(btrim(provider_key)) BETWEEN 1 AND 80
    AND amount_micro_usd BETWEEN 1 AND 9000000000000000 AND currency='USD'
    AND work_handoff_digest ~ '^sha256:[0-9a-f]{64}$'
    AND sealed_request_digest ~ '^sha256:[0-9a-f]{64}$'
    AND slot_state_version_before>=1
    AND slot_state_version_after=slot_state_version_before+1
    AND length(btrim(actor_user_id)) BETWEEN 1 AND 200
    AND length(btrim(idempotency_key)) BETWEEN 8 AND 200
    AND input_digest ~ '^sha256:[0-9a-f]{64}$'
    AND expiration_evidence_digest ~ '^sha256:[0-9a-f]{64}$'
    AND isfinite(reservation_expires_at) AND isfinite(expired_at) AND isfinite(created_at)
    AND expired_at>=reservation_expires_at AND created_at=expired_at
  ),
  CONSTRAINT ai_media_held_admission_expirations_exact_capability_fk FOREIGN KEY
    (expiry_capability_id,owner_user_id,workspace_id)
    REFERENCES public.ai_media_held_expiry_capabilities(id,owner_user_id,workspace_id)
    ON UPDATE NO ACTION ON DELETE RESTRICT,
  CONSTRAINT ai_media_held_admission_expirations_exact_reservation_fk FOREIGN KEY
    (owner_user_id,workspace_id,budget_reservation_id,budget_bucket_id,render_job_id,
      dispatch_outbox_id,daily_plan_slot_id,slot_attempt,provider_account_id,provider_key,
      provider_credential_version,amount_micro_usd,currency,reservation_expires_at,work_handoff_digest)
    REFERENCES public.ai_media_budget_reservations(owner_user_id,workspace_id,id,budget_bucket_id,
      render_job_id,dispatch_outbox_id,daily_plan_slot_id,attempt,provider_account_id,provider_key,
      provider_credential_version,amount_micro_usd,currency,expires_at,work_handoff_digest)
    ON UPDATE NO ACTION ON DELETE RESTRICT,
  CONSTRAINT ai_media_held_admission_expirations_exact_render_fk FOREIGN KEY
    (owner_user_id,workspace_id,render_job_id,budget_reservation_id,work_handoff_digest,sealed_request_digest)
    REFERENCES public.ai_media_render_jobs(owner_user_id,workspace_id,id,budget_reservation_id,
      work_handoff_digest,sealed_request_digest) ON UPDATE NO ACTION ON DELETE RESTRICT,
  CONSTRAINT ai_media_held_admission_expirations_exact_outbox_fk FOREIGN KEY
    (owner_user_id,workspace_id,dispatch_outbox_id,budget_reservation_id,render_job_id,
      work_handoff_digest,sealed_request_digest)
    REFERENCES public.ai_media_outbox(owner_user_id,workspace_id,id,budget_reservation_id,
      render_job_id,work_handoff_digest,sealed_request_digest) ON UPDATE NO ACTION ON DELETE RESTRICT,
  CONSTRAINT ai_media_held_admission_expirations_exact_slot_fk FOREIGN KEY
    (owner_user_id,workspace_id,daily_plan_slot_id,provider_account_id,provider_key,provider_credential_version)
    REFERENCES public.ai_media_daily_plan_slots(owner_user_id,workspace_id,id,provider_account_id,
      provider_key,provider_credential_version) ON UPDATE NO ACTION ON DELETE RESTRICT,
  CONSTRAINT ai_media_held_admission_expirations_exact_bucket_fk FOREIGN KEY
    (owner_user_id,workspace_id,budget_bucket_id,currency)
    REFERENCES public.ai_media_budget_buckets(owner_user_id,workspace_id,id,currency)
    ON UPDATE NO ACTION ON DELETE RESTRICT
);
CREATE UNIQUE INDEX ai_media_held_admission_expirations_reservation_uq
  ON public.ai_media_held_admission_expirations(owner_user_id,workspace_id,budget_reservation_id);
CREATE UNIQUE INDEX ai_media_held_admission_expirations_idempotency_uq
  ON public.ai_media_held_admission_expirations(owner_user_id,workspace_id,idempotency_key);
CREATE UNIQUE INDEX ai_media_held_admission_expirations_evidence_digest_uq
  ON public.ai_media_held_admission_expirations(expiration_evidence_digest);
CREATE UNIQUE INDEX ai_media_held_admission_expirations_capability_uq
  ON public.ai_media_held_admission_expirations(expiry_capability_id);

CREATE FUNCTION public.ai_media_reject_held_admission_expiration_rewrite() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET row_security=on AS $guard$
BEGIN
  RAISE EXCEPTION 'held admission expiration evidence is append-only and immutable';
END
$guard$;
CREATE TRIGGER ai_media_held_admission_expirations_immutable_guard
  BEFORE UPDATE OR DELETE ON public.ai_media_held_admission_expirations
  FOR EACH ROW EXECUTE FUNCTION public.ai_media_reject_held_admission_expiration_rewrite();
CREATE TRIGGER ai_media_held_admission_expirations_truncate_guard
  BEFORE TRUNCATE ON public.ai_media_held_admission_expirations
  FOR EACH STATEMENT EXECUTE FUNCTION public.ai_media_reject_held_admission_expiration_rewrite();

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
    AND retry_count=0 AND lease_fencing>=0
    AND isfinite(available_at) AND isfinite(queued_at) AND isfinite(created_at) AND isfinite(updated_at)
    AND ((stage IN ('admission_held','queued') AND status='pending' AND attempts=0
        AND provider_job_id IS NULL AND lease_owner IS NULL AND lease_token IS NULL AND lease_expires_at IS NULL
        AND provider_terminal_state IS NULL)
      OR (stage='admission_expired' AND status='cancelled' AND attempts=0 AND progress=0
        AND provider_job_id IS NULL AND lease_owner IS NULL AND lease_token IS NULL AND lease_expires_at IS NULL
        AND provider_terminal_state IS NULL AND completed_at IS NOT NULL AND error_code='admission_expired'
        AND error_message='Held admission expired before activation')
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
        AND lease_owner IS NULL AND lease_token IS NULL AND lease_expires_at IS NULL))))
);

ALTER TABLE public.ai_media_outbox DROP CONSTRAINT ai_media_outbox_held_ck;
ALTER TABLE public.ai_media_outbox ADD CONSTRAINT ai_media_outbox_held_ck CHECK (
  (budget_reservation_id IS NULL AND render_job_id IS NULL AND work_handoff_digest IS NULL
    AND sealed_request_digest IS NULL)
  OR (budget_reservation_id IS NOT NULL AND render_job_id IS NOT NULL
    AND work_handoff_digest ~ '^sha256:[0-9a-f]{64}$' AND sealed_request_digest ~ '^sha256:[0-9a-f]{64}$'
    AND isfinite(available_at) AND isfinite(created_at) AND isfinite(updated_at)
    AND status IN ('held','pending','leased','reconciling','dispatched','dead_letter','cancelled')
    AND (status<>'held' OR (attempts=0 AND locked_at IS NULL AND lease_owner IS NULL
      AND lease_expires_at IS NULL AND fencing_token=0 AND dead_letter_at IS NULL
      AND processed_at IS NULL AND last_error IS NULL))
    AND (status<>'cancelled' OR (attempts=0 AND locked_at IS NULL AND lease_owner IS NULL
      AND lease_expires_at IS NULL AND fencing_token=0 AND dead_letter_at IS NULL
      AND processed_at IS NOT NULL AND last_error IS NULL)))
);

CREATE FUNCTION public.ai_media_guard_held_admission_expiry_projection() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET row_security=on AS $guard$
BEGIN
  IF TG_TABLE_NAME='ai_media_render_jobs' THEN
    IF OLD.stage='admission_expired' THEN
      RAISE EXCEPTION 'expired held render is terminal and immutable';
    END IF;
    IF OLD.stage<>'admission_held' OR OLD.status<>'pending'
      OR NEW.stage<>'admission_expired' OR NEW.status<>'cancelled'
      OR (pg_catalog.to_jsonb(NEW)-'stage'-'status'-'completed_at'-'error_code'-'error_message'-'updated_at')
        IS DISTINCT FROM
         (pg_catalog.to_jsonb(OLD)-'stage'-'status'-'completed_at'-'error_code'-'error_message'-'updated_at')
      OR NEW.completed_at IS NULL OR NEW.error_code<>'admission_expired'
      OR NEW.error_message<>'Held admission expired before activation'
      OR NOT EXISTS (SELECT 1 FROM public.ai_media_held_admission_expirations evidence
        WHERE evidence.owner_user_id=OLD.owner_user_id AND evidence.workspace_id=OLD.workspace_id
          AND evidence.budget_reservation_id=OLD.budget_reservation_id AND evidence.render_job_id=OLD.id
          AND evidence.daily_plan_slot_id=OLD.daily_plan_slot_id AND evidence.slot_attempt=OLD.slot_attempt
          AND evidence.work_handoff_digest=OLD.work_handoff_digest
          AND evidence.sealed_request_digest=OLD.sealed_request_digest
          AND evidence.expired_at=NEW.completed_at) THEN
      RAISE EXCEPTION 'held render expiry requires exact append-only expiration evidence';
    END IF;
    RETURN NEW;
  END IF;
  IF OLD.status='cancelled' THEN
    RAISE EXCEPTION 'cancelled held outbox is terminal and immutable';
  END IF;
  IF OLD.status<>'held' OR NEW.status<>'cancelled'
    OR (pg_catalog.to_jsonb(NEW)-'status'-'processed_at'-'updated_at')
      IS DISTINCT FROM (pg_catalog.to_jsonb(OLD)-'status'-'processed_at'-'updated_at')
    OR NEW.processed_at IS NULL
    OR NOT EXISTS (SELECT 1 FROM public.ai_media_held_admission_expirations evidence
      WHERE evidence.owner_user_id=OLD.owner_user_id AND evidence.workspace_id=OLD.workspace_id
        AND evidence.budget_reservation_id=OLD.budget_reservation_id
        AND evidence.dispatch_outbox_id=OLD.id AND evidence.render_job_id=OLD.render_job_id
        AND evidence.work_handoff_digest=OLD.work_handoff_digest
        AND evidence.sealed_request_digest=OLD.sealed_request_digest
        AND evidence.expired_at=NEW.processed_at) THEN
    RAISE EXCEPTION 'held outbox cancellation requires exact append-only expiration evidence';
  END IF;
  RETURN NEW;
END
$guard$;

CREATE FUNCTION public.ai_media_reject_inserted_held_expiry_projection() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET row_security=on AS $guard$
BEGIN
  RAISE EXCEPTION 'held admission expiry projections must originate from one exact held transition';
END
$guard$;
CREATE TRIGGER ai_media_render_jobs_held_expiry_insert_guard BEFORE INSERT ON public.ai_media_render_jobs
  FOR EACH ROW WHEN (NEW.stage='admission_expired')
  EXECUTE FUNCTION public.ai_media_reject_inserted_held_expiry_projection();
CREATE TRIGGER ai_media_outbox_held_expiry_insert_guard BEFORE INSERT ON public.ai_media_outbox
  FOR EACH ROW WHEN (NEW.status='cancelled' AND NEW.budget_reservation_id IS NOT NULL)
  EXECUTE FUNCTION public.ai_media_reject_inserted_held_expiry_projection();
CREATE TRIGGER ai_media_budget_reservations_held_expiry_insert_guard BEFORE INSERT ON public.ai_media_budget_reservations
  FOR EACH ROW WHEN (NEW.state='expired' AND NEW.release_reason='held_admission_expired')
  EXECUTE FUNCTION public.ai_media_reject_inserted_held_expiry_projection();
CREATE TRIGGER ai_media_daily_plan_slots_held_expiry_insert_guard BEFORE INSERT ON public.ai_media_daily_plan_slots
  FOR EACH ROW WHEN (NEW.status='expired')
  EXECUTE FUNCTION public.ai_media_reject_inserted_held_expiry_projection();

DROP TRIGGER ai_media_render_jobs_admitted_submission_guard ON public.ai_media_render_jobs;
CREATE TRIGGER ai_media_render_jobs_admitted_submission_guard BEFORE UPDATE ON public.ai_media_render_jobs
  FOR EACH ROW WHEN (NEW.provider_terminal_state IS NULL AND NEW.stage<>'admission_expired')
  EXECUTE FUNCTION public.ai_media_guard_admitted_submission_rows();
CREATE TRIGGER ai_media_render_jobs_held_expiry_guard BEFORE UPDATE ON public.ai_media_render_jobs
  FOR EACH ROW WHEN (OLD.stage='admission_expired' OR NEW.stage='admission_expired')
  EXECUTE FUNCTION public.ai_media_guard_held_admission_expiry_projection();

DROP TRIGGER ai_media_outbox_admitted_submission_guard ON public.ai_media_outbox;
CREATE TRIGGER ai_media_outbox_admitted_submission_guard BEFORE UPDATE ON public.ai_media_outbox
  FOR EACH ROW WHEN (NEW.status<>'cancelled') EXECUTE FUNCTION public.ai_media_guard_admitted_submission_rows();
CREATE TRIGGER ai_media_outbox_admitted_submission_delete_guard BEFORE DELETE ON public.ai_media_outbox
  FOR EACH ROW EXECUTE FUNCTION public.ai_media_guard_admitted_submission_rows();
CREATE TRIGGER ai_media_outbox_held_expiry_guard BEFORE UPDATE ON public.ai_media_outbox
  FOR EACH ROW WHEN (OLD.status='cancelled' OR NEW.status='cancelled')
  EXECUTE FUNCTION public.ai_media_guard_held_admission_expiry_projection();

CREATE FUNCTION public.ai_media_guard_held_admission_expiry_state() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET row_security=on AS $guard$
BEGIN
  IF TG_TABLE_NAME='ai_media_budget_reservations' THEN
    IF NEW.state='expired' AND OLD.state='reserved' AND (
      NEW.submission_state<>'not_started' OR NEW.expired_at IS NULL
      OR NEW.release_reason<>'held_admission_expired'
      OR NOT EXISTS (SELECT 1 FROM public.ai_media_held_admission_expirations evidence
        WHERE evidence.owner_user_id=OLD.owner_user_id AND evidence.workspace_id=OLD.workspace_id
          AND evidence.budget_reservation_id=OLD.id AND evidence.budget_bucket_id=OLD.budget_bucket_id
          AND evidence.render_job_id=OLD.render_job_id AND evidence.dispatch_outbox_id=OLD.dispatch_outbox_id
          AND evidence.daily_plan_slot_id=OLD.daily_plan_slot_id AND evidence.slot_attempt=OLD.attempt
          AND evidence.amount_micro_usd=OLD.amount_micro_usd AND evidence.currency=OLD.currency
          AND evidence.work_handoff_digest=OLD.work_handoff_digest
          AND evidence.reservation_expires_at=OLD.expires_at AND evidence.expired_at=NEW.expired_at)
    ) THEN RAISE EXCEPTION 'held reservation expiry requires exact append-only expiration evidence'; END IF;
    RETURN NEW;
  END IF;
  IF TG_OP='DELETE' THEN
    IF OLD.status='expired' THEN RAISE EXCEPTION 'expired held slot is terminal and cannot be deleted'; END IF;
    RETURN OLD;
  END IF;
  IF OLD.status='expired' THEN RAISE EXCEPTION 'expired held slot is terminal and immutable'; END IF;
  IF NEW.status='expired' AND (OLD.status<>'reserved' OR NEW.state_version<>OLD.state_version+1
    OR (pg_catalog.to_jsonb(NEW)-'status'-'state_version'-'updated_at')
      IS DISTINCT FROM (pg_catalog.to_jsonb(OLD)-'status'-'state_version'-'updated_at')
    OR NOT EXISTS (SELECT 1 FROM public.ai_media_held_admission_expirations evidence
      WHERE evidence.owner_user_id=OLD.owner_user_id AND evidence.workspace_id=OLD.workspace_id
        AND evidence.daily_plan_slot_id=OLD.id
        AND evidence.slot_state_version_before=OLD.state_version
        AND evidence.slot_state_version_after=NEW.state_version
        AND evidence.expired_at=NEW.updated_at)) THEN
    RAISE EXCEPTION 'held slot expiry requires exact append-only expiration evidence';
  END IF;
  RETURN NEW;
END
$guard$;
CREATE TRIGGER ai_media_budget_reservations_held_expiry_guard
  BEFORE UPDATE ON public.ai_media_budget_reservations FOR EACH ROW
  EXECUTE FUNCTION public.ai_media_guard_held_admission_expiry_state();
CREATE TRIGGER ai_media_daily_plan_slots_held_expiry_guard
  BEFORE UPDATE OR DELETE ON public.ai_media_daily_plan_slots FOR EACH ROW
  EXECUTE FUNCTION public.ai_media_guard_held_admission_expiry_state();

CREATE FUNCTION public.ai_media_assert_held_admission_expiry_final_state() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET row_security=on AS $assert$
BEGIN
  IF NOT EXISTS (SELECT 1
    FROM public.ai_media_budget_reservations reservation
    JOIN public.ai_media_render_jobs job ON job.owner_user_id=reservation.owner_user_id
      AND job.workspace_id=reservation.workspace_id AND job.id=reservation.render_job_id
    JOIN public.ai_media_outbox outbox ON outbox.owner_user_id=reservation.owner_user_id
      AND outbox.workspace_id=reservation.workspace_id AND outbox.id=reservation.dispatch_outbox_id
    JOIN public.ai_media_daily_plan_slots slot ON slot.owner_user_id=reservation.owner_user_id
      AND slot.workspace_id=reservation.workspace_id AND slot.id=reservation.daily_plan_slot_id
    JOIN public.ai_media_budget_buckets bucket ON bucket.owner_user_id=reservation.owner_user_id
      AND bucket.workspace_id=reservation.workspace_id AND bucket.id=reservation.budget_bucket_id
    WHERE reservation.owner_user_id=NEW.owner_user_id AND reservation.workspace_id=NEW.workspace_id
      AND reservation.id=NEW.budget_reservation_id AND reservation.state='expired'
      AND reservation.submission_state='not_started' AND reservation.expired_at=NEW.expired_at
      AND reservation.release_reason='held_admission_expired'
      AND job.id=NEW.render_job_id AND job.stage='admission_expired' AND job.status='cancelled'
      AND job.attempts=0 AND job.provider_job_id IS NULL AND job.lease_owner IS NULL
      AND job.lease_token IS NULL AND job.lease_expires_at IS NULL AND job.completed_at=NEW.expired_at
      AND outbox.id=NEW.dispatch_outbox_id AND outbox.status='cancelled' AND outbox.attempts=0
      AND outbox.lease_owner IS NULL AND outbox.lease_expires_at IS NULL AND outbox.processed_at=NEW.expired_at
      AND slot.id=NEW.daily_plan_slot_id AND slot.status='expired'
      AND slot.state_version=NEW.slot_state_version_after AND slot.updated_at=NEW.expired_at
      AND bucket.id=NEW.budget_bucket_id
      AND bucket.reserved_micro_usd=(SELECT COALESCE(sum(r.amount_micro_usd),0)
        FROM public.ai_media_budget_reservations r WHERE r.owner_user_id=bucket.owner_user_id
          AND r.workspace_id=bucket.workspace_id AND r.budget_bucket_id=bucket.id AND r.state='reserved')
      AND NOT EXISTS (SELECT 1 FROM public.ai_media_work_activations activation
        WHERE activation.owner_user_id=NEW.owner_user_id AND activation.workspace_id=NEW.workspace_id
          AND activation.budget_reservation_id=NEW.budget_reservation_id)
      AND NOT EXISTS (SELECT 1 FROM public.ai_media_provider_submission_attempts attempt
        WHERE attempt.owner_user_id=NEW.owner_user_id AND attempt.workspace_id=NEW.workspace_id
          AND attempt.budget_reservation_id=NEW.budget_reservation_id)) THEN
    RAISE EXCEPTION 'held admission expiration must atomically close the exact never-activated tuple';
  END IF;
  RETURN NULL;
END
$assert$;
CREATE CONSTRAINT TRIGGER ai_media_held_admission_expirations_final_state_guard
  AFTER INSERT ON public.ai_media_held_admission_expirations DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION public.ai_media_assert_held_admission_expiry_final_state();

CREATE FUNCTION ai_media_worker_api.expire_held_admission_v1(
  p_expiry_capability_id uuid,p_owner_user_id text,p_workspace_id text,
  p_budget_reservation_id uuid,p_budget_bucket_id uuid,
  p_render_job_id uuid,p_dispatch_outbox_id uuid,p_daily_plan_slot_id uuid,p_slot_attempt integer,
  p_work_handoff_digest text,p_sealed_request_digest text,p_expected_expires_at timestamptz,
  p_expected_slot_state_version integer,p_idempotency_key text,p_input_digest text
) RETURNS TABLE(result text,expiration_id uuid,expiration_evidence_digest text,expired_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET row_security=on AS $function$
DECLARE sampled_at timestamptz:=pg_catalog.clock_timestamp(); capability record; bound record; existing record;
  new_id uuid:=public.gen_random_uuid(); evidence_digest text; affected integer;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_catalog.unnest(ARRAY[
      'public.ai_media_held_expiry_capabilities','public.ai_media_held_admission_expirations',
      'public.ai_media_budget_reservations','public.ai_media_budget_buckets','public.ai_media_render_jobs',
      'public.ai_media_outbox','public.ai_media_daily_plan_slots','public.ai_media_work_activations',
      'public.ai_media_provider_submission_attempts']::text[]) protected(table_name)
    WHERE pg_catalog.has_table_privilege(SESSION_USER,protected.table_name,'SELECT')
      OR pg_catalog.has_table_privilege(SESSION_USER,protected.table_name,'INSERT')
      OR pg_catalog.has_table_privilege(SESSION_USER,protected.table_name,'UPDATE')
      OR pg_catalog.has_table_privilege(SESSION_USER,protected.table_name,'DELETE')
      OR pg_catalog.has_table_privilege(SESSION_USER,protected.table_name,'TRUNCATE')
      OR pg_catalog.has_table_privilege(SESSION_USER,protected.table_name,'REFERENCES')
      OR pg_catalog.has_table_privilege(SESSION_USER,protected.table_name,'TRIGGER')) THEN
    RAISE EXCEPTION 'held expiry executor principal is not table-blind least privilege' USING ERRCODE='42501';
  END IF;
  IF length(pg_catalog.btrim(p_owner_user_id)) NOT BETWEEN 1 AND 200
    OR length(pg_catalog.btrim(p_workspace_id)) NOT BETWEEN 1 AND 200
    OR p_slot_attempt<1 OR p_expected_slot_state_version<1
    OR p_work_handoff_digest!~'^sha256:[0-9a-f]{64}$'
    OR p_sealed_request_digest!~'^sha256:[0-9a-f]{64}$'
    OR p_input_digest!~'^sha256:[0-9a-f]{64}$'
    OR length(pg_catalog.btrim(p_idempotency_key)) NOT BETWEEN 8 AND 200 THEN
    RAISE EXCEPTION 'invalid held admission expiry request';
  END IF;
  SELECT * INTO capability FROM public.ai_media_held_expiry_capabilities scoped
    WHERE scoped.id=p_expiry_capability_id
      AND scoped.database_principal=SESSION_USER::name
      AND scoped.owner_user_id=p_owner_user_id AND scoped.workspace_id=p_workspace_id
      AND scoped.max_expirations=1 AND scoped.revoked_at IS NULL
      AND scoped.valid_from<=sampled_at AND scoped.expires_at>sampled_at
    FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'held expiry capability is absent, expired, revoked, or cross-tenant' USING ERRCODE='42501'; END IF;
  SELECT * INTO existing FROM public.ai_media_held_admission_expirations evidence
    WHERE evidence.owner_user_id=p_owner_user_id AND evidence.workspace_id=p_workspace_id
      AND evidence.idempotency_key=p_idempotency_key;
  IF FOUND THEN
    IF existing.expiry_capability_id<>p_expiry_capability_id
      OR existing.budget_reservation_id<>p_budget_reservation_id OR existing.budget_bucket_id<>p_budget_bucket_id
      OR existing.render_job_id<>p_render_job_id OR existing.dispatch_outbox_id<>p_dispatch_outbox_id
      OR existing.daily_plan_slot_id<>p_daily_plan_slot_id OR existing.slot_attempt<>p_slot_attempt
      OR existing.work_handoff_digest<>p_work_handoff_digest
      OR existing.sealed_request_digest<>p_sealed_request_digest
      OR existing.reservation_expires_at<>p_expected_expires_at
      OR existing.slot_state_version_before<>p_expected_slot_state_version
      OR existing.input_digest<>p_input_digest THEN
      RAISE EXCEPTION 'held admission expiry idempotency conflict';
    END IF;
    RETURN QUERY SELECT 'replayed'::text,existing.id,existing.expiration_evidence_digest,existing.expired_at;
    RETURN;
  END IF;
  SELECT reservation.amount_micro_usd,reservation.currency,reservation.provider_account_id,
    reservation.provider_key,reservation.provider_credential_version,slot.state_version
    INTO bound
  FROM public.ai_media_budget_reservations reservation
  JOIN public.ai_media_budget_buckets bucket ON bucket.owner_user_id=reservation.owner_user_id
    AND bucket.workspace_id=reservation.workspace_id AND bucket.id=reservation.budget_bucket_id
  JOIN public.ai_media_render_jobs job ON job.owner_user_id=reservation.owner_user_id
    AND job.workspace_id=reservation.workspace_id AND job.id=reservation.render_job_id
  JOIN public.ai_media_outbox outbox ON outbox.owner_user_id=reservation.owner_user_id
    AND outbox.workspace_id=reservation.workspace_id AND outbox.id=reservation.dispatch_outbox_id
  JOIN public.ai_media_daily_plan_slots slot ON slot.owner_user_id=reservation.owner_user_id
    AND slot.workspace_id=reservation.workspace_id AND slot.id=reservation.daily_plan_slot_id
  WHERE reservation.owner_user_id=p_owner_user_id AND reservation.workspace_id=p_workspace_id
    AND reservation.id=p_budget_reservation_id AND reservation.budget_bucket_id=p_budget_bucket_id
    AND reservation.render_job_id=p_render_job_id AND reservation.dispatch_outbox_id=p_dispatch_outbox_id
    AND reservation.daily_plan_slot_id=p_daily_plan_slot_id AND reservation.attempt=p_slot_attempt
    AND reservation.work_handoff_digest=p_work_handoff_digest
    AND reservation.expires_at=p_expected_expires_at AND reservation.state='reserved'
    AND reservation.submission_state='not_started' AND reservation.committed_at IS NULL
    AND reservation.commit_evidence_digest IS NULL AND reservation.settled_at IS NULL
    AND reservation.released_at IS NULL AND reservation.expired_at IS NULL
    AND reservation.expires_at<=sampled_at
    AND job.stage='admission_held' AND job.status='pending' AND job.attempts=0
    AND job.provider_job_id IS NULL AND job.lease_owner IS NULL AND job.lease_token IS NULL
    AND job.lease_expires_at IS NULL AND job.work_handoff_digest=p_work_handoff_digest
    AND job.sealed_request_digest=p_sealed_request_digest
    AND outbox.status='held' AND outbox.attempts=0 AND outbox.locked_at IS NULL
    AND outbox.lease_owner IS NULL AND outbox.lease_expires_at IS NULL AND outbox.processed_at IS NULL
    AND outbox.fencing_token=0 AND outbox.work_handoff_digest=p_work_handoff_digest
    AND outbox.sealed_request_digest=p_sealed_request_digest
    AND slot.status='reserved' AND slot.state_version=p_expected_slot_state_version
    AND NOT EXISTS (SELECT 1 FROM public.ai_media_work_activations activation
      WHERE activation.owner_user_id=p_owner_user_id AND activation.workspace_id=p_workspace_id
        AND activation.budget_reservation_id=p_budget_reservation_id)
    AND NOT EXISTS (SELECT 1 FROM public.ai_media_provider_submission_attempts attempt
      WHERE attempt.owner_user_id=p_owner_user_id AND attempt.workspace_id=p_workspace_id
        AND attempt.budget_reservation_id=p_budget_reservation_id)
  FOR UPDATE OF reservation,bucket,job,outbox,slot;
  IF NOT FOUND THEN RAISE EXCEPTION 'exact held admission is not safely eligible for expiry'; END IF;
  evidence_digest:=ai_media_worker_api.sha256_text_v1('held-admission-expiry-v1|'||p_expiry_capability_id::text||'|'||p_owner_user_id||'|'||
    p_workspace_id||'|'||p_budget_reservation_id::text||'|'||p_render_job_id::text||'|'||
    p_dispatch_outbox_id::text||'|'||p_daily_plan_slot_id::text||'|'||p_slot_attempt::text||'|'||
    p_work_handoff_digest||'|'||p_sealed_request_digest||'|'||p_expected_expires_at::text||'|'||
    sampled_at::text||'|'||p_input_digest);
  INSERT INTO public.ai_media_held_admission_expirations(id,owner_user_id,workspace_id,expiry_capability_id,
    budget_reservation_id,budget_bucket_id,render_job_id,dispatch_outbox_id,daily_plan_slot_id,
    slot_attempt,provider_account_id,provider_key,provider_credential_version,amount_micro_usd,currency,
    work_handoff_digest,sealed_request_digest,reservation_expires_at,slot_state_version_before,
    slot_state_version_after,actor_user_id,idempotency_key,input_digest,expiration_evidence_digest,
    expired_at,created_at)
  VALUES(new_id,p_owner_user_id,p_workspace_id,p_expiry_capability_id,p_budget_reservation_id,p_budget_bucket_id,
    p_render_job_id,p_dispatch_outbox_id,p_daily_plan_slot_id,p_slot_attempt,bound.provider_account_id,
    bound.provider_key,bound.provider_credential_version,bound.amount_micro_usd,bound.currency,
    p_work_handoff_digest,p_sealed_request_digest,p_expected_expires_at,p_expected_slot_state_version,
    p_expected_slot_state_version+1,SESSION_USER,p_idempotency_key,p_input_digest,evidence_digest,
    sampled_at,sampled_at);
  UPDATE public.ai_media_budget_reservations SET state='expired',expired_at=sampled_at,
    release_reason='held_admission_expired',updated_at=sampled_at
    WHERE owner_user_id=p_owner_user_id AND workspace_id=p_workspace_id AND id=p_budget_reservation_id
      AND state='reserved' AND submission_state='not_started';
  GET DIAGNOSTICS affected=ROW_COUNT;
  IF affected<>1 THEN RAISE EXCEPTION 'held reservation expiry lost its exact lock'; END IF;
  UPDATE public.ai_media_render_jobs SET stage='admission_expired',status='cancelled',completed_at=sampled_at,
    error_code='admission_expired',error_message='Held admission expired before activation',updated_at=sampled_at
    WHERE owner_user_id=p_owner_user_id AND workspace_id=p_workspace_id AND id=p_render_job_id
      AND stage='admission_held' AND status='pending';
  GET DIAGNOSTICS affected=ROW_COUNT;
  IF affected<>1 THEN RAISE EXCEPTION 'held render expiry lost its exact lock'; END IF;
  UPDATE public.ai_media_outbox SET status='cancelled',processed_at=sampled_at,updated_at=sampled_at
    WHERE owner_user_id=p_owner_user_id AND workspace_id=p_workspace_id AND id=p_dispatch_outbox_id
      AND status='held';
  GET DIAGNOSTICS affected=ROW_COUNT;
  IF affected<>1 THEN RAISE EXCEPTION 'held outbox expiry lost its exact lock'; END IF;
  UPDATE public.ai_media_daily_plan_slots SET status='expired',state_version=state_version+1,updated_at=sampled_at
    WHERE owner_user_id=p_owner_user_id AND workspace_id=p_workspace_id AND id=p_daily_plan_slot_id
      AND status='reserved' AND state_version=p_expected_slot_state_version;
  GET DIAGNOSTICS affected=ROW_COUNT;
  IF affected<>1 THEN RAISE EXCEPTION 'held slot expiry lost its exact lock'; END IF;
  UPDATE public.ai_media_budget_buckets SET reserved_micro_usd=reserved_micro_usd-bound.amount_micro_usd,
    state_version=state_version+1,updated_at=sampled_at
    WHERE owner_user_id=p_owner_user_id AND workspace_id=p_workspace_id AND id=p_budget_bucket_id
      AND currency=bound.currency AND reserved_micro_usd>=bound.amount_micro_usd;
  GET DIAGNOSTICS affected=ROW_COUNT;
  IF affected<>1 THEN RAISE EXCEPTION 'held expiry budget decrement must affect exactly one bucket'; END IF;
  RETURN QUERY SELECT 'applied'::text,new_id,evidence_digest,sampled_at;
END
$function$;

GRANT SELECT ON TABLE public.ai_media_held_expiry_capabilities TO ai_media_admitted_fn_owner;
GRANT UPDATE(id) ON TABLE public.ai_media_held_expiry_capabilities TO ai_media_admitted_fn_owner;
GRANT SELECT,INSERT ON TABLE public.ai_media_held_admission_expirations TO ai_media_admitted_fn_owner;
ALTER FUNCTION public.ai_media_guard_held_expiry_capability() OWNER TO ai_media_admitted_fn_owner;
ALTER FUNCTION public.ai_media_reject_held_admission_expiration_rewrite() OWNER TO ai_media_admitted_fn_owner;
ALTER FUNCTION public.ai_media_guard_held_admission_expiry_projection() OWNER TO ai_media_admitted_fn_owner;
ALTER FUNCTION public.ai_media_reject_inserted_held_expiry_projection() OWNER TO ai_media_admitted_fn_owner;
ALTER FUNCTION public.ai_media_guard_held_admission_expiry_state() OWNER TO ai_media_admitted_fn_owner;
ALTER FUNCTION public.ai_media_assert_held_admission_expiry_final_state() OWNER TO ai_media_admitted_fn_owner;
ALTER FUNCTION ai_media_worker_api.expire_held_admission_v1(uuid,text,text,uuid,uuid,uuid,uuid,uuid,integer,text,text,timestamptz,integer,text,text)
  OWNER TO ai_media_admitted_fn_owner;
REVOKE ALL ON TABLE public.ai_media_held_admission_expirations
  FROM PUBLIC,ai_media_admitted_submit_executor,ai_media_admitted_reconcile_executor,ai_media_held_expiry_executor;
REVOKE ALL ON TABLE public.ai_media_held_expiry_capabilities
  FROM PUBLIC,ai_media_admitted_submit_executor,ai_media_admitted_reconcile_executor,ai_media_held_expiry_executor;
REVOKE ALL ON FUNCTION public.ai_media_guard_held_expiry_capability() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.ai_media_reject_held_admission_expiration_rewrite() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.ai_media_guard_held_admission_expiry_projection() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.ai_media_reject_inserted_held_expiry_projection() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.ai_media_guard_held_admission_expiry_state() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.ai_media_assert_held_admission_expiry_final_state() FROM PUBLIC;
REVOKE ALL ON FUNCTION ai_media_worker_api.expire_held_admission_v1(uuid,text,text,uuid,uuid,uuid,uuid,uuid,integer,text,text,timestamptz,integer,text,text)
  FROM PUBLIC,ai_media_admitted_submit_executor,ai_media_admitted_reconcile_executor;
GRANT USAGE ON SCHEMA ai_media_worker_api TO ai_media_held_expiry_executor;
GRANT EXECUTE ON FUNCTION ai_media_worker_api.expire_held_admission_v1(uuid,text,text,uuid,uuid,uuid,uuid,uuid,integer,text,text,timestamptz,integer,text,text)
  TO ai_media_held_expiry_executor;

COMMIT;
