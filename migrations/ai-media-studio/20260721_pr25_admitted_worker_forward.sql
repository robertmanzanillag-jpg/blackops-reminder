-- AI Media Studio PR25: fenced, budget-aware admitted render submission.
-- Reviewed additive migration. Do not apply automatically.
-- No provider call is performed by this SQL.
-- Trusted-writer boundary: production roles must REVOKE direct DML on the
-- tables below and grant only the dedicated admitted-worker mutation surface.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='15min';
SET LOCAL search_path=public,pg_catalog;

DO $preflight$
BEGIN
  IF to_regclass('public.ai_media_work_activations') IS NULL
    OR to_regclass('public.ai_media_provider_submission_attempts') IS NOT NULL
    OR to_regprocedure('public.ai_media_guard_admitted_handoff()') IS NULL
    OR to_regprocedure('public.ai_media_reject_budget_reservation_rewrite()') IS NULL THEN
    RAISE EXCEPTION 'PR25 requires the exact unused-or-active PR24 schema and must not already be applied';
  END IF;
END
$preflight$;

LOCK TABLE ai_media_budget_buckets,ai_media_budget_reservations,ai_media_render_jobs,
  ai_media_outbox,ai_media_daily_plan_slots,ai_media_work_activations IN ACCESS EXCLUSIVE MODE;

ALTER TABLE ai_media_render_jobs
  ADD COLUMN lease_token uuid,
  ADD COLUMN lease_fencing bigint NOT NULL DEFAULT 0;

CREATE UNIQUE INDEX ai_media_work_activations_submission_attempt_identity_uq
  ON ai_media_work_activations(owner_user_id,workspace_id,id,budget_reservation_id,
    render_job_id,dispatch_outbox_id,daily_plan_slot_id,slot_attempt,provider_account_id,provider_key,
    provider_credential_version,provider_idempotency_key,script_variant_checksum,authority_snapshot_id,
    authority_digest,launch_intent_id,launch_intent_digest,admission_digest,work_handoff_digest,sealed_request_digest);

CREATE TABLE ai_media_provider_submission_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id text NOT NULL,
  workspace_id text NOT NULL DEFAULT 'personal',
  budget_reservation_id uuid NOT NULL,
  work_activation_id uuid NOT NULL,
  render_job_id uuid NOT NULL,
  dispatch_outbox_id uuid NOT NULL,
  daily_plan_slot_id uuid NOT NULL,
  slot_attempt integer NOT NULL,
  provider_account_id uuid NOT NULL,
  provider_key text NOT NULL,
  provider_credential_version integer NOT NULL,
  provider_idempotency_key text NOT NULL,
  avatar_external_resource_id text NOT NULL,
  voice_external_resource_id text NOT NULL,
  script_variant_checksum text NOT NULL,
  authority_snapshot_id uuid NOT NULL,
  work_handoff_digest text NOT NULL,
  sealed_request_digest text NOT NULL,
  authority_digest text NOT NULL,
  launch_intent_id uuid NOT NULL,
  launch_intent_digest text NOT NULL,
  admission_digest text NOT NULL,
  state text NOT NULL,
  fencing_token bigint NOT NULL,
  claim_count integer NOT NULL DEFAULT 1,
  lease_token uuid,
  lease_owner text,
  lease_expires_at timestamptz,
  reconciliation_lease_token uuid,
  reconciliation_lease_owner text,
  reconciliation_lease_expires_at timestamptz,
  reconciliation_fencing_token bigint NOT NULL DEFAULT 0,
  commit_evidence_digest text,
  send_authorization_digest text,
  confirmed_evidence_digest text,
  ambiguity_evidence_digest text,
  reconciliation_evidence_digest text,
  provider_job_id text,
  provider_request_id text,
  claimed_at timestamptz NOT NULL,
  authorized_at timestamptz,
  confirmed_at timestamptz,
  ambiguous_at timestamptz,
  reconciled_at timestamptz,
  actor_user_id text NOT NULL,
  input_digest text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  CONSTRAINT ai_media_provider_submission_attempts_ck CHECK (
    state IN ('claimed','authorized','confirmed','ambiguous','reconciled_no_submit')
    AND slot_attempt>=1 AND provider_credential_version>=1 AND fencing_token>=1 AND claim_count>=1
    AND length(btrim(provider_key)) BETWEEN 1 AND 80
    AND length(btrim(provider_idempotency_key)) BETWEEN 8 AND 200
    AND length(btrim(avatar_external_resource_id)) BETWEEN 1 AND 500
    AND length(btrim(voice_external_resource_id)) BETWEEN 1 AND 500
    AND (provider_job_id IS NULL OR length(btrim(provider_job_id)) BETWEEN 1 AND 500)
    AND (provider_request_id IS NULL OR length(btrim(provider_request_id)) BETWEEN 1 AND 500)
    AND script_variant_checksum ~ '^[0-9a-f]{64}$'
    AND work_handoff_digest ~ '^sha256:[0-9a-f]{64}$'
    AND sealed_request_digest ~ '^sha256:[0-9a-f]{64}$'
    AND authority_digest ~ '^sha256:[0-9a-f]{64}$'
    AND launch_intent_digest ~ '^sha256:[0-9a-f]{64}$'
    AND admission_digest ~ '^sha256:[0-9a-f]{64}$'
    AND input_digest ~ '^sha256:[0-9a-f]{64}$'
    AND ((state IN ('claimed','authorized'))=(lease_token IS NOT NULL))
    AND ((lease_token IS NULL)=(lease_owner IS NULL))
    AND ((lease_token IS NULL)=(lease_expires_at IS NULL))
    AND reconciliation_fencing_token>=0
    AND ((reconciliation_lease_token IS NULL)=(reconciliation_lease_owner IS NULL))
    AND ((reconciliation_lease_token IS NULL)=(reconciliation_lease_expires_at IS NULL))
    AND (reconciliation_lease_token IS NULL OR state='ambiguous')
    AND (state<>'authorized' OR (authorized_at IS NOT NULL AND commit_evidence_digest IS NOT NULL
      AND send_authorization_digest IS NOT NULL))
    AND (state<>'confirmed' OR (authorized_at IS NOT NULL AND confirmed_at IS NOT NULL
      AND provider_job_id IS NOT NULL AND confirmed_evidence_digest IS NOT NULL))
    AND (state<>'ambiguous' OR (authorized_at IS NOT NULL AND ambiguous_at IS NOT NULL
      AND ambiguity_evidence_digest IS NOT NULL))
    AND (state<>'reconciled_no_submit' OR (authorized_at IS NOT NULL AND reconciled_at IS NOT NULL
      AND reconciliation_evidence_digest IS NOT NULL AND provider_job_id IS NULL AND provider_request_id IS NULL))
    AND isfinite(claimed_at) AND isfinite(created_at) AND isfinite(updated_at)
    AND (lease_expires_at IS NULL OR isfinite(lease_expires_at))
    AND (reconciliation_lease_expires_at IS NULL OR isfinite(reconciliation_lease_expires_at))
    AND (authorized_at IS NULL OR isfinite(authorized_at)) AND (confirmed_at IS NULL OR isfinite(confirmed_at))
    AND (ambiguous_at IS NULL OR isfinite(ambiguous_at)) AND (reconciled_at IS NULL OR isfinite(reconciled_at))
  ),
  CONSTRAINT ai_media_provider_submission_attempts_exact_activation_fk FOREIGN KEY
    (owner_user_id,workspace_id,work_activation_id,budget_reservation_id,render_job_id,
      dispatch_outbox_id,daily_plan_slot_id,slot_attempt,provider_account_id,provider_key,
      provider_credential_version,provider_idempotency_key,script_variant_checksum,authority_snapshot_id,
      authority_digest,launch_intent_id,launch_intent_digest,admission_digest,work_handoff_digest,sealed_request_digest)
    REFERENCES ai_media_work_activations(owner_user_id,workspace_id,id,budget_reservation_id,
      render_job_id,dispatch_outbox_id,daily_plan_slot_id,slot_attempt,provider_account_id,provider_key,
      provider_credential_version,provider_idempotency_key,script_variant_checksum,authority_snapshot_id,
      authority_digest,launch_intent_id,launch_intent_digest,admission_digest,work_handoff_digest,sealed_request_digest)
    ON UPDATE NO ACTION ON DELETE RESTRICT,
  CONSTRAINT ai_media_provider_submission_attempts_exact_reservation_fk FOREIGN KEY
    (owner_user_id,workspace_id,budget_reservation_id,render_job_id,dispatch_outbox_id,
      work_handoff_digest,daily_plan_slot_id,slot_attempt,provider_account_id,provider_key,
      provider_credential_version,script_variant_checksum,authority_snapshot_id,authority_digest,
      admission_digest,provider_idempotency_key)
    REFERENCES ai_media_budget_reservations(owner_user_id,workspace_id,id,render_job_id,
      dispatch_outbox_id,work_handoff_digest,daily_plan_slot_id,attempt,provider_account_id,
      provider_key,provider_credential_version,script_variant_checksum,authority_snapshot_id,
      authority_digest,admission_digest,provider_idempotency_key)
    ON UPDATE NO ACTION ON DELETE RESTRICT
);
CREATE UNIQUE INDEX ai_media_provider_submission_attempts_reservation_uq
  ON ai_media_provider_submission_attempts(owner_user_id,workspace_id,budget_reservation_id);
CREATE UNIQUE INDEX ai_media_provider_submission_attempts_provider_idempotency_uq
  ON ai_media_provider_submission_attempts(provider_account_id,provider_key,provider_idempotency_key);
CREATE UNIQUE INDEX ai_media_provider_submission_attempts_provider_job_uq
  ON ai_media_provider_submission_attempts(provider_account_id,provider_key,provider_job_id)
  WHERE provider_job_id IS NOT NULL;
CREATE UNIQUE INDEX ai_media_provider_submission_attempts_exact_identity_uq
  ON ai_media_provider_submission_attempts(owner_user_id,workspace_id,id,budget_reservation_id);
CREATE INDEX ai_media_provider_submission_attempts_due_idx
  ON ai_media_provider_submission_attempts(state,lease_expires_at,created_at);

CREATE TABLE ai_media_provider_submission_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id text NOT NULL,
  workspace_id text NOT NULL DEFAULT 'personal',
  submission_attempt_id uuid NOT NULL,
  budget_reservation_id uuid NOT NULL,
  sequence integer NOT NULL,
  event_kind text NOT NULL,
  fencing_token bigint NOT NULL,
  reconciliation_fencing_token bigint,
  evidence_digest text NOT NULL,
  provider_job_id text,
  provider_request_id text,
  actor_user_id text NOT NULL,
  observed_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  CONSTRAINT ai_media_provider_submission_events_ck CHECK (
    sequence>=1 AND fencing_token>=1
    AND event_kind IN ('claimed','reclaimed','authorized','confirmed','ambiguous','reconciliation_claimed','reconciliation_released','reconciled_no_submit')
    AND evidence_digest ~ '^sha256:[0-9a-f]{64}$'
    AND ((event_kind IN ('reconciliation_claimed','reconciliation_released','reconciled_no_submit'))=(reconciliation_fencing_token IS NOT NULL))
    AND (provider_job_id IS NULL OR length(btrim(provider_job_id)) BETWEEN 1 AND 500)
    AND (provider_request_id IS NULL OR length(btrim(provider_request_id)) BETWEEN 1 AND 500)
    AND length(btrim(actor_user_id)) BETWEEN 1 AND 200
    AND isfinite(observed_at) AND isfinite(created_at)
  ),
  CONSTRAINT ai_media_provider_submission_events_exact_attempt_fk FOREIGN KEY
    (owner_user_id,workspace_id,submission_attempt_id,budget_reservation_id)
    REFERENCES ai_media_provider_submission_attempts(owner_user_id,workspace_id,id,budget_reservation_id)
    ON UPDATE NO ACTION ON DELETE RESTRICT
);
CREATE UNIQUE INDEX ai_media_provider_submission_events_sequence_uq
  ON ai_media_provider_submission_events(owner_user_id,workspace_id,submission_attempt_id,sequence);

CREATE FUNCTION ai_media_guard_provider_submission_attempt() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public AS $guard$
BEGIN
  IF TG_OP='INSERT' THEN
    IF NEW.state<>'claimed' THEN RAISE EXCEPTION 'provider submission attempt must begin claimed'; END IF;
    RETURN NEW;
  END IF;
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'provider submission evidence cannot be deleted'; END IF;
  IF ROW(NEW.owner_user_id,NEW.workspace_id,NEW.budget_reservation_id,NEW.work_activation_id,
      NEW.render_job_id,NEW.dispatch_outbox_id,NEW.daily_plan_slot_id,NEW.slot_attempt,
      NEW.provider_account_id,NEW.provider_key,NEW.provider_credential_version,
      NEW.provider_idempotency_key,NEW.avatar_external_resource_id,NEW.voice_external_resource_id,
      NEW.work_handoff_digest,NEW.sealed_request_digest,
      NEW.authority_digest,NEW.launch_intent_digest,NEW.admission_digest,NEW.input_digest,
      NEW.claimed_at,NEW.created_at,NEW.actor_user_id)
    IS DISTINCT FROM
    ROW(OLD.owner_user_id,OLD.workspace_id,OLD.budget_reservation_id,OLD.work_activation_id,
      OLD.render_job_id,OLD.dispatch_outbox_id,OLD.daily_plan_slot_id,OLD.slot_attempt,
      OLD.provider_account_id,OLD.provider_key,OLD.provider_credential_version,
      OLD.provider_idempotency_key,OLD.avatar_external_resource_id,OLD.voice_external_resource_id,
      OLD.work_handoff_digest,OLD.sealed_request_digest,
      OLD.authority_digest,OLD.launch_intent_digest,OLD.admission_digest,OLD.input_digest,
      OLD.claimed_at,OLD.created_at,OLD.actor_user_id) THEN
    RAISE EXCEPTION 'provider submission sealed identity cannot change';
  END IF;
  IF OLD.state IN ('confirmed','reconciled_no_submit') THEN
    RAISE EXCEPTION 'terminal provider submission evidence cannot change';
  END IF;
  IF OLD.state='claimed' AND NEW.state NOT IN ('claimed','authorized')
    OR OLD.state='authorized' AND NEW.state NOT IN ('confirmed','ambiguous')
    OR OLD.state='ambiguous' AND NEW.state NOT IN ('ambiguous','confirmed','reconciled_no_submit') THEN
    RAISE EXCEPTION 'invalid provider submission transition';
  END IF;
  IF OLD.state='claimed' AND NEW.state='claimed' AND
    (NEW.fencing_token<>OLD.fencing_token+1 OR NEW.claim_count<>OLD.claim_count+1
      OR OLD.lease_expires_at>clock_timestamp()) THEN
    RAISE EXCEPTION 'claim recovery requires an expired lease and a new fence';
  END IF;
  IF OLD.state='ambiguous' AND NEW.state='ambiguous' AND NOT (
    (NEW.reconciliation_lease_token IS NOT NULL
      AND NEW.reconciliation_lease_token IS DISTINCT FROM OLD.reconciliation_lease_token
      AND (OLD.reconciliation_lease_token IS NULL OR OLD.reconciliation_lease_expires_at<=clock_timestamp())
      AND NEW.reconciliation_fencing_token=OLD.reconciliation_fencing_token+1)
    OR (OLD.reconciliation_lease_token IS NOT NULL AND NEW.reconciliation_lease_token IS NULL
      AND NEW.reconciliation_fencing_token=OLD.reconciliation_fencing_token)
  ) THEN RAISE EXCEPTION 'ambiguous updates may only acquire or release the exact reconciliation lease'; END IF;
  IF OLD.state<>NEW.state AND
    (NEW.fencing_token<>OLD.fencing_token OR NEW.claim_count<>OLD.claim_count) THEN
    RAISE EXCEPTION 'submission transitions preserve the exact claim fence';
  END IF;
  IF OLD.state<>'claimed' AND
    (NEW.fencing_token<>OLD.fencing_token OR NEW.claim_count<>OLD.claim_count) THEN
    RAISE EXCEPTION 'post-claim state preserves the submission fence';
  END IF;
  IF NEW.fencing_token<OLD.fencing_token OR NEW.claim_count<OLD.claim_count THEN
    RAISE EXCEPTION 'provider submission fence and claim count are monotonic';
  END IF;
  IF OLD.commit_evidence_digest IS NOT NULL AND NEW.commit_evidence_digest IS DISTINCT FROM OLD.commit_evidence_digest
    OR OLD.send_authorization_digest IS NOT NULL AND NEW.send_authorization_digest IS DISTINCT FROM OLD.send_authorization_digest
    OR OLD.confirmed_evidence_digest IS NOT NULL AND NEW.confirmed_evidence_digest IS DISTINCT FROM OLD.confirmed_evidence_digest
    OR OLD.ambiguity_evidence_digest IS NOT NULL AND NEW.ambiguity_evidence_digest IS DISTINCT FROM OLD.ambiguity_evidence_digest
    OR OLD.reconciliation_evidence_digest IS NOT NULL AND NEW.reconciliation_evidence_digest IS DISTINCT FROM OLD.reconciliation_evidence_digest THEN
    RAISE EXCEPTION 'provider submission evidence digests are set-once';
  END IF;
  RETURN NEW;
END
$guard$;
CREATE TRIGGER ai_media_provider_submission_attempts_guard
  BEFORE INSERT OR UPDATE OR DELETE ON ai_media_provider_submission_attempts
  FOR EACH ROW EXECUTE FUNCTION ai_media_guard_provider_submission_attempt();

CREATE FUNCTION ai_media_reject_provider_submission_event_rewrite() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public AS $guard$
BEGIN
  IF TG_OP='INSERT' THEN
    IF NOT EXISTS (SELECT 1 FROM public.ai_media_provider_submission_attempts attempt
      WHERE attempt.id=NEW.submission_attempt_id AND attempt.owner_user_id=NEW.owner_user_id
        AND attempt.workspace_id=NEW.workspace_id AND attempt.budget_reservation_id=NEW.budget_reservation_id
        AND attempt.fencing_token=NEW.fencing_token
        AND ((attempt.state='claimed' AND NEW.event_kind IN ('claimed','reclaimed'))
          OR (attempt.state='ambiguous' AND NEW.event_kind='ambiguous')
          OR (attempt.state='ambiguous' AND NEW.event_kind='reconciliation_claimed'
            AND NEW.reconciliation_fencing_token=attempt.reconciliation_fencing_token)
          OR (attempt.state='ambiguous' AND NEW.event_kind='reconciliation_released'
            AND NEW.reconciliation_fencing_token=attempt.reconciliation_fencing_token)
          OR (attempt.state='reconciled_no_submit' AND NEW.event_kind='reconciled_no_submit'
            AND NEW.reconciliation_fencing_token=attempt.reconciliation_fencing_token)
          OR (attempt.state=NEW.event_kind AND NEW.event_kind<>'reconciled_no_submit'))) THEN
      RAISE EXCEPTION 'submission event does not match current fenced attempt';
    END IF;
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'provider submission events are append-only';
END
$guard$;
CREATE TRIGGER ai_media_provider_submission_events_immutable_guard
  BEFORE INSERT OR UPDATE OR DELETE ON ai_media_provider_submission_events
  FOR EACH ROW EXECUTE FUNCTION ai_media_reject_provider_submission_event_rewrite();

-- Replace PR19's permissive submission-state transition guard. In particular,
-- ambiguous can never return to dispatching and no-submit release requires the
-- exact terminal attempt evidence to exist first.
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
      NEW.provider_idempotency_key,NEW.reserved_at,NEW.expires_at,NEW.render_job_id,
      NEW.dispatch_outbox_id,NEW.work_handoff_digest,NEW.authority_snapshot_id,NEW.authority_digest)
    IS DISTINCT FROM
    ROW(OLD.owner_user_id,OLD.workspace_id,OLD.budget_bucket_id,OLD.daily_plan_slot_id,
      OLD.provider_account_id,OLD.provider_key,OLD.provider_credential_version,OLD.attempt,
      OLD.amount_micro_usd,OLD.currency,OLD.idempotency_key,OLD.input_digest,OLD.admission_digest,
      OLD.script_variant_checksum,OLD.quote_digest,OLD.quote_expires_at,OLD.content_approval_digest,
      OLD.human_launch_approval_digest,OLD.governance_profile_id,OLD.governance_evidence_digest,
      OLD.policy_digest,OLD.kill_switch_evidence_digest,OLD.sandbox_evidence_digest,
      OLD.provider_idempotency_key,OLD.reserved_at,OLD.expires_at,OLD.render_job_id,
      OLD.dispatch_outbox_id,OLD.work_handoff_digest,OLD.authority_snapshot_id,OLD.authority_digest) THEN
    RAISE EXCEPTION 'budget reservation immutable evidence cannot change';
  END IF;
  IF OLD.state IN ('released','expired','settled') THEN RAISE EXCEPTION 'terminal budget reservation cannot change'; END IF;
  IF OLD.state='reserved' AND NEW.state='committed' AND
    (OLD.submission_state<>'not_started' OR NEW.submission_state<>'dispatching'
      OR clock_timestamp()>=OLD.expires_at OR NEW.commit_evidence_digest IS NULL
      OR NOT EXISTS (SELECT 1 FROM public.ai_media_provider_submission_attempts attempt
        WHERE attempt.owner_user_id=OLD.owner_user_id AND attempt.workspace_id=OLD.workspace_id
          AND attempt.budget_reservation_id=OLD.id AND attempt.state='authorized'
          AND attempt.commit_evidence_digest=NEW.commit_evidence_digest)) THEN
    RAISE EXCEPTION 'budget commit requires the exact live send authorization';
  END IF;
  IF OLD.state='reserved' AND NEW.state NOT IN ('reserved','committed','released','expired') THEN
    RAISE EXCEPTION 'invalid reserved budget transition';
  END IF;
  IF OLD.state='committed' AND NEW.state NOT IN ('committed','released','settled') THEN
    RAISE EXCEPTION 'committed budget cannot return to reserved or expire';
  END IF;
  IF OLD.submission_state='dispatching' AND NEW.submission_state NOT IN ('dispatching','confirmed','ambiguous','reconciled_no_submit')
    OR OLD.submission_state='ambiguous' AND NEW.submission_state NOT IN ('ambiguous','confirmed','reconciled_no_submit')
    OR OLD.submission_state='confirmed' AND NEW.submission_state<>'confirmed'
    OR OLD.submission_state='reconciled_no_submit' AND NEW.submission_state<>'reconciled_no_submit' THEN
    RAISE EXCEPTION 'provider submission state cannot move backwards or reopen dispatch';
  END IF;
  IF NEW.submission_state='reconciled_no_submit' AND
    (NEW.state<>'released' OR NEW.reconciliation_evidence_digest IS NULL
      OR NOT EXISTS (SELECT 1 FROM public.ai_media_provider_submission_attempts attempt
        WHERE attempt.owner_user_id=OLD.owner_user_id AND attempt.workspace_id=OLD.workspace_id
          AND attempt.budget_reservation_id=OLD.id AND attempt.state='reconciled_no_submit'
          AND attempt.reconciliation_evidence_digest=NEW.reconciliation_evidence_digest)) THEN
    RAISE EXCEPTION 'no-submit release requires exact terminal reconciliation evidence';
  END IF;
  IF NEW.submission_state='confirmed' AND NEW.state NOT IN ('committed','settled') THEN
    RAISE EXCEPTION 'confirmed submission must retain committed or settled budget';
  END IF;
  IF OLD.commit_evidence_digest IS NOT NULL AND
    (NEW.commit_evidence_digest IS DISTINCT FROM OLD.commit_evidence_digest
      OR NEW.committed_at IS DISTINCT FROM OLD.committed_at) THEN
    RAISE EXCEPTION 'budget commit evidence cannot change';
  END IF;
  IF OLD.reconciliation_evidence_digest IS NOT NULL AND
    NEW.reconciliation_evidence_digest IS DISTINCT FROM OLD.reconciliation_evidence_digest THEN
    RAISE EXCEPTION 'budget reconciliation evidence cannot change';
  END IF;
  RETURN NEW;
END
$guard$;
CREATE TRIGGER ai_media_budget_reservations_transition_guard
  BEFORE UPDATE OR DELETE ON ai_media_budget_reservations
  FOR EACH ROW EXECUTE FUNCTION ai_media_reject_budget_reservation_rewrite();

DROP TRIGGER ai_media_render_jobs_admitted_handoff_guard ON ai_media_render_jobs;
DROP TRIGGER ai_media_outbox_admitted_handoff_guard ON ai_media_outbox;
DROP FUNCTION ai_media_guard_admitted_handoff();
ALTER TABLE ai_media_render_jobs DROP CONSTRAINT ai_media_render_jobs_admission_held_ck;
ALTER TABLE ai_media_render_jobs ADD CONSTRAINT ai_media_render_jobs_admission_held_ck CHECK (
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
    AND length(btrim(provider_key)) BETWEEN 1 AND 80
    AND provider_credential_version>=1 AND retry_count=0 AND lease_fencing>=0
    AND isfinite(available_at) AND isfinite(queued_at) AND isfinite(created_at) AND isfinite(updated_at)
    AND ((stage IN ('admission_held','queued') AND status='pending' AND attempts=0
        AND provider_job_id IS NULL AND lease_owner IS NULL AND lease_token IS NULL AND lease_expires_at IS NULL)
      OR (stage='leased' AND status='rendering' AND attempts IN (0,1) AND provider_job_id IS NULL
        AND lease_owner IS NOT NULL AND lease_token IS NOT NULL AND lease_expires_at IS NOT NULL)
      OR (stage='submitted' AND status='rendering' AND attempts=1 AND provider_job_id IS NOT NULL
        AND lease_owner IS NULL AND lease_token IS NULL AND lease_expires_at IS NULL)
      OR (stage IN ('reconciling','failed') AND attempts=1 AND provider_job_id IS NULL
        AND lease_owner IS NULL AND lease_token IS NULL AND lease_expires_at IS NULL)))
);
ALTER TABLE ai_media_outbox DROP CONSTRAINT ai_media_outbox_held_ck;
ALTER TABLE ai_media_outbox ADD CONSTRAINT ai_media_outbox_held_ck CHECK (
  (budget_reservation_id IS NULL AND render_job_id IS NULL AND work_handoff_digest IS NULL
    AND sealed_request_digest IS NULL)
  OR (budget_reservation_id IS NOT NULL AND render_job_id IS NOT NULL
    AND work_handoff_digest ~ '^sha256:[0-9a-f]{64}$' AND sealed_request_digest ~ '^sha256:[0-9a-f]{64}$'
    AND isfinite(available_at) AND isfinite(created_at) AND isfinite(updated_at)
    AND status IN ('held','pending','leased','reconciling','dispatched','dead_letter')
    AND (status<>'held' OR (attempts=0 AND locked_at IS NULL AND lease_owner IS NULL
      AND lease_expires_at IS NULL AND fencing_token=0 AND dead_letter_at IS NULL
      AND processed_at IS NULL AND last_error IS NULL)))
);

CREATE FUNCTION ai_media_guard_admitted_submission_rows() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public AS $guard$
DECLARE attempt_state text; attempt_fence bigint;
BEGIN
  IF TG_OP='DELETE' AND OLD.budget_reservation_id IS NOT NULL THEN
    RAISE EXCEPTION 'admitted submission evidence cannot be deleted';
  ELSIF TG_OP='DELETE' THEN RETURN OLD; END IF;
  IF OLD.budget_reservation_id IS NULL AND NEW.budget_reservation_id IS NOT NULL THEN
    RAISE EXCEPTION 'admission bindings cannot be attached by update';
  END IF;
  IF OLD.budget_reservation_id IS NULL THEN RETURN NEW; END IF;
  IF TG_TABLE_NAME='ai_media_render_jobs' THEN
    IF ROW(NEW.owner_user_id,NEW.workspace_id,NEW.budget_reservation_id,NEW.daily_plan_slot_id,
        NEW.slot_attempt,NEW.influencer_id,NEW.avatar_resource_id,NEW.voice_resource_id,NEW.script_id,
        NEW.script_variant_id,NEW.script_variant_checksum,NEW.source_item_id,NEW.source_content_hash,
        NEW.authority_snapshot_id,NEW.authority_digest,NEW.launch_intent_id,NEW.launch_intent_digest,
        NEW.admission_digest,NEW.work_handoff_digest,NEW.sealed_request_digest,NEW.provider_account_id,
        NEW.provider_key,NEW.provider_credential_version,NEW.idempotency_key,NEW.request,
        NEW.governance_profile_id,NEW.governance_evidence_digest)
      IS DISTINCT FROM
      ROW(OLD.owner_user_id,OLD.workspace_id,OLD.budget_reservation_id,OLD.daily_plan_slot_id,
        OLD.slot_attempt,OLD.influencer_id,OLD.avatar_resource_id,OLD.voice_resource_id,OLD.script_id,
        OLD.script_variant_id,OLD.script_variant_checksum,OLD.source_item_id,OLD.source_content_hash,
        OLD.authority_snapshot_id,OLD.authority_digest,OLD.launch_intent_id,OLD.launch_intent_digest,
        OLD.admission_digest,OLD.work_handoff_digest,OLD.sealed_request_digest,OLD.provider_account_id,
        OLD.provider_key,OLD.provider_credential_version,OLD.idempotency_key,OLD.request,
        OLD.governance_profile_id,OLD.governance_evidence_digest) THEN
      RAISE EXCEPTION 'admitted render sealed identity cannot change';
    END IF;
  ELSE
    IF ROW(NEW.owner_user_id,NEW.workspace_id,NEW.budget_reservation_id,NEW.render_job_id,
        NEW.work_handoff_digest,NEW.sealed_request_digest,NEW.idempotency_key,NEW.aggregate_type,
        NEW.aggregate_id,NEW.event_type,NEW.payload)
      IS DISTINCT FROM ROW(OLD.owner_user_id,OLD.workspace_id,OLD.budget_reservation_id,OLD.render_job_id,
        OLD.work_handoff_digest,OLD.sealed_request_digest,OLD.idempotency_key,OLD.aggregate_type,
        OLD.aggregate_id,OLD.event_type,OLD.payload) THEN
      RAISE EXCEPTION 'admitted outbox sealed identity cannot change';
    END IF;
  END IF;
  SELECT state,fencing_token INTO attempt_state,attempt_fence
  FROM public.ai_media_provider_submission_attempts
  WHERE owner_user_id=OLD.owner_user_id AND workspace_id=OLD.workspace_id
    AND budget_reservation_id=OLD.budget_reservation_id;
  IF attempt_state IS NULL THEN
    IF TG_TABLE_NAME='ai_media_render_jobs' THEN
      IF OLD.stage='admission_held' AND NEW.stage='queued'
        AND (to_jsonb(NEW)-'stage'-'available_at'-'updated_at')
          IS NOT DISTINCT FROM (to_jsonb(OLD)-'stage'-'available_at'-'updated_at')
        AND EXISTS (SELECT 1 FROM public.ai_media_work_activations activation
          WHERE activation.owner_user_id=OLD.owner_user_id AND activation.workspace_id=OLD.workspace_id
            AND activation.budget_reservation_id=OLD.budget_reservation_id AND activation.render_job_id=OLD.id
            AND activation.work_handoff_digest=OLD.work_handoff_digest
            AND activation.sealed_request_digest=OLD.sealed_request_digest) THEN RETURN NEW; END IF;
    ELSE
      IF OLD.status='held' AND NEW.status='pending'
        AND (to_jsonb(NEW)-'status'-'available_at'-'updated_at')
          IS NOT DISTINCT FROM (to_jsonb(OLD)-'status'-'available_at'-'updated_at')
        AND EXISTS (SELECT 1 FROM public.ai_media_work_activations activation
          WHERE activation.owner_user_id=OLD.owner_user_id AND activation.workspace_id=OLD.workspace_id
            AND activation.budget_reservation_id=OLD.budget_reservation_id
            AND activation.dispatch_outbox_id=OLD.id AND activation.render_job_id=OLD.render_job_id
            AND activation.work_handoff_digest=OLD.work_handoff_digest
            AND activation.sealed_request_digest=OLD.sealed_request_digest) THEN RETURN NEW; END IF;
    END IF;
    RAISE EXCEPTION 'admitted row mutation requires exact provider submission evidence';
  END IF;
  IF TG_TABLE_NAME='ai_media_render_jobs' THEN
    IF NEW.lease_fencing<>attempt_fence OR
      (attempt_state='claimed' AND NEW.stage<>'leased') OR
      (attempt_state='authorized' AND (NEW.stage<>'leased' OR NEW.attempts<>1)) OR
      (attempt_state='confirmed' AND (NEW.stage<>'submitted' OR NEW.provider_job_id IS NULL)) OR
      (attempt_state='ambiguous' AND NEW.stage<>'reconciling') OR
      (attempt_state='reconciled_no_submit' AND NEW.stage<>'failed') THEN
      RAISE EXCEPTION 'admitted render transition does not match provider submission evidence';
    END IF;
  ELSE
    IF NEW.fencing_token<>attempt_fence OR
      (attempt_state IN ('claimed','authorized') AND NEW.status<>'leased') OR
      (attempt_state='confirmed' AND NEW.status<>'dispatched') OR
      (attempt_state='ambiguous' AND NEW.status<>'reconciling') OR
      (attempt_state='reconciled_no_submit' AND NEW.status<>'dead_letter') THEN
      RAISE EXCEPTION 'admitted outbox transition does not match provider submission evidence';
    END IF;
  END IF;
  RETURN NEW;
END
$guard$;
CREATE TRIGGER ai_media_render_jobs_admitted_submission_guard
  BEFORE UPDATE OR DELETE ON ai_media_render_jobs FOR EACH ROW
  EXECUTE FUNCTION ai_media_guard_admitted_submission_rows();
CREATE TRIGGER ai_media_outbox_admitted_submission_guard
  BEFORE UPDATE OR DELETE ON ai_media_outbox FOR EACH ROW
  EXECUTE FUNCTION ai_media_guard_admitted_submission_rows();

CREATE FUNCTION ai_media_assert_pr25_consistency() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public AS $assert$
DECLARE scoped_owner text; scoped_workspace text; scoped_reservation uuid; scoped_bucket uuid;
  scoped_slot uuid;
BEGIN
  IF TG_TABLE_NAME='ai_media_provider_submission_attempts' THEN
    scoped_owner=NEW.owner_user_id; scoped_workspace=NEW.workspace_id; scoped_reservation=NEW.budget_reservation_id;
  ELSIF TG_TABLE_NAME='ai_media_budget_reservations' THEN
    scoped_owner=NEW.owner_user_id; scoped_workspace=NEW.workspace_id; scoped_reservation=NEW.id; scoped_bucket=NEW.budget_bucket_id;
  ELSIF TG_TABLE_NAME IN ('ai_media_render_jobs','ai_media_outbox') THEN
    scoped_owner=NEW.owner_user_id; scoped_workspace=NEW.workspace_id; scoped_reservation=NEW.budget_reservation_id;
  ELSIF TG_TABLE_NAME='ai_media_daily_plan_slots' THEN
    scoped_owner=NEW.owner_user_id; scoped_workspace=NEW.workspace_id; scoped_slot=NEW.id;
  ELSIF TG_TABLE_NAME='ai_media_budget_buckets' THEN
    scoped_owner=NEW.owner_user_id; scoped_workspace=NEW.workspace_id; scoped_bucket=NEW.id;
  ELSE
    scoped_owner=NEW.owner_user_id; scoped_workspace=NEW.workspace_id;
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.ai_media_provider_submission_attempts attempt
    JOIN public.ai_media_budget_reservations reservation ON reservation.id=attempt.budget_reservation_id
      AND reservation.owner_user_id=attempt.owner_user_id AND reservation.workspace_id=attempt.workspace_id
    JOIN public.ai_media_render_jobs job ON job.id=attempt.render_job_id
      AND job.owner_user_id=attempt.owner_user_id AND job.workspace_id=attempt.workspace_id
    JOIN public.ai_media_outbox outbox ON outbox.id=attempt.dispatch_outbox_id
      AND outbox.owner_user_id=attempt.owner_user_id AND outbox.workspace_id=attempt.workspace_id
    JOIN public.ai_media_daily_plan_slots slot ON slot.id=attempt.daily_plan_slot_id
      AND slot.owner_user_id=attempt.owner_user_id AND slot.workspace_id=attempt.workspace_id
    WHERE attempt.owner_user_id=scoped_owner AND attempt.workspace_id=scoped_workspace
      AND ((scoped_reservation IS NOT NULL AND attempt.budget_reservation_id=scoped_reservation)
        OR (scoped_slot IS NOT NULL AND attempt.daily_plan_slot_id=scoped_slot)
        OR (scoped_bucket IS NOT NULL AND reservation.budget_bucket_id=scoped_bucket))
      AND NOT (
        (attempt.state='claimed' AND reservation.state='reserved' AND reservation.submission_state='not_started'
          AND job.stage='leased' AND job.attempts=0 AND outbox.status='leased' AND slot.status='queued'
          AND job.lease_owner=attempt.lease_owner AND job.lease_token=attempt.lease_token
          AND job.lease_expires_at=attempt.lease_expires_at AND job.lease_fencing=attempt.fencing_token
          AND outbox.lease_owner=attempt.lease_owner AND outbox.lease_expires_at=attempt.lease_expires_at
          AND outbox.fencing_token=attempt.fencing_token)
        OR (attempt.state='authorized' AND reservation.state='committed' AND reservation.submission_state='dispatching'
          AND reservation.commit_evidence_digest=attempt.commit_evidence_digest
          AND job.stage='leased' AND job.attempts=1 AND outbox.status='leased' AND slot.status='committed'
          AND job.lease_owner=attempt.lease_owner AND job.lease_token=attempt.lease_token
          AND job.lease_expires_at=attempt.lease_expires_at AND job.lease_fencing=attempt.fencing_token
          AND outbox.lease_owner=attempt.lease_owner AND outbox.lease_expires_at=attempt.lease_expires_at
          AND outbox.fencing_token=attempt.fencing_token)
        OR (attempt.state='confirmed' AND reservation.state='committed' AND reservation.submission_state='confirmed'
          AND job.stage='submitted' AND job.provider_job_id=attempt.provider_job_id
          AND outbox.status='dispatched' AND slot.status='submitted'
          AND job.lease_owner IS NULL AND job.lease_token IS NULL AND job.lease_expires_at IS NULL
          AND outbox.lease_owner IS NULL AND outbox.lease_expires_at IS NULL)
        OR (attempt.state='ambiguous' AND reservation.state='committed' AND reservation.submission_state='ambiguous'
          AND job.stage='reconciling' AND outbox.status='reconciling' AND slot.status='reconciling'
          AND job.lease_owner IS NULL AND job.lease_token IS NULL AND job.lease_expires_at IS NULL
          AND outbox.lease_owner IS NULL AND outbox.lease_expires_at IS NULL)
        OR (attempt.state='reconciled_no_submit' AND reservation.state='released'
          AND reservation.submission_state='reconciled_no_submit' AND job.stage='failed'
          AND reservation.reconciliation_evidence_digest=attempt.reconciliation_evidence_digest
          AND outbox.status='dead_letter' AND slot.status='released'
          AND job.lease_owner IS NULL AND job.lease_token IS NULL AND job.lease_expires_at IS NULL
          AND outbox.lease_owner IS NULL AND outbox.lease_expires_at IS NULL))
  ) THEN RAISE EXCEPTION 'provider submission tuple is not atomically consistent'; END IF;
  IF EXISTS (
    SELECT 1 FROM public.ai_media_provider_submission_attempts attempt
    WHERE attempt.owner_user_id=scoped_owner AND attempt.workspace_id=scoped_workspace
      AND ((scoped_reservation IS NOT NULL AND attempt.budget_reservation_id=scoped_reservation)
        OR (scoped_slot IS NOT NULL AND attempt.daily_plan_slot_id=scoped_slot)
        OR (scoped_bucket IS NOT NULL AND EXISTS (SELECT 1 FROM public.ai_media_budget_reservations reservation
          WHERE reservation.id=attempt.budget_reservation_id AND reservation.budget_bucket_id=scoped_bucket)))
      AND NOT EXISTS (SELECT 1 FROM public.ai_media_provider_submission_events event
        WHERE event.owner_user_id=attempt.owner_user_id AND event.workspace_id=attempt.workspace_id
          AND event.submission_attempt_id=attempt.id AND event.budget_reservation_id=attempt.budget_reservation_id
          AND event.fencing_token=attempt.fencing_token
          AND ((attempt.state='claimed' AND event.event_kind IN ('claimed','reclaimed'))
            OR event.event_kind=attempt.state)
          AND event.evidence_digest=CASE attempt.state
            WHEN 'authorized' THEN attempt.send_authorization_digest
            WHEN 'confirmed' THEN attempt.confirmed_evidence_digest
            WHEN 'ambiguous' THEN attempt.ambiguity_evidence_digest
            WHEN 'reconciled_no_submit' THEN attempt.reconciliation_evidence_digest
            ELSE event.evidence_digest END)
  ) THEN RAISE EXCEPTION 'provider submission state lacks append-only transition evidence'; END IF;
  IF scoped_bucket IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.ai_media_budget_buckets bucket WHERE bucket.id=scoped_bucket
      AND bucket.owner_user_id=scoped_owner AND bucket.workspace_id=scoped_workspace
      AND (bucket.reserved_micro_usd<>(SELECT COALESCE(sum(amount_micro_usd),0)
          FROM public.ai_media_budget_reservations r WHERE r.owner_user_id=bucket.owner_user_id
            AND r.workspace_id=bucket.workspace_id AND r.budget_bucket_id=bucket.id AND r.state='reserved')
        OR bucket.committed_micro_usd<>(SELECT COALESCE(sum(CASE WHEN state='settled'
            THEN settled_amount_micro_usd ELSE amount_micro_usd END),0)
          FROM public.ai_media_budget_reservations r WHERE r.owner_user_id=bucket.owner_user_id
            AND r.workspace_id=bucket.workspace_id AND r.budget_bucket_id=bucket.id
            AND r.state IN ('committed','settled')))
  ) THEN RAISE EXCEPTION 'budget bucket counters do not equal durable reservation evidence'; END IF;
  RETURN NULL;
END
$assert$;
CREATE CONSTRAINT TRIGGER ai_media_pr25_attempt_consistency_guard AFTER INSERT OR UPDATE
  ON ai_media_provider_submission_attempts DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
  EXECUTE FUNCTION ai_media_assert_pr25_consistency();
CREATE CONSTRAINT TRIGGER ai_media_pr25_reservation_consistency_guard AFTER INSERT OR UPDATE
  ON ai_media_budget_reservations DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
  EXECUTE FUNCTION ai_media_assert_pr25_consistency();
CREATE CONSTRAINT TRIGGER ai_media_pr25_render_consistency_guard AFTER UPDATE
  ON ai_media_render_jobs DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
  EXECUTE FUNCTION ai_media_assert_pr25_consistency();
CREATE CONSTRAINT TRIGGER ai_media_pr25_outbox_consistency_guard AFTER UPDATE
  ON ai_media_outbox DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
  EXECUTE FUNCTION ai_media_assert_pr25_consistency();
CREATE CONSTRAINT TRIGGER ai_media_pr25_slot_consistency_guard AFTER UPDATE
  ON ai_media_daily_plan_slots DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
  EXECUTE FUNCTION ai_media_assert_pr25_consistency();
CREATE CONSTRAINT TRIGGER ai_media_pr25_bucket_consistency_guard AFTER UPDATE
  ON ai_media_budget_buckets DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
  EXECUTE FUNCTION ai_media_assert_pr25_consistency();

COMMIT;
