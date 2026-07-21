-- AI Media Studio PR19: durable daily plans and atomic micro-USD budget reservations.
-- Reviewed, additive/data-preserving migration. Do not apply automatically.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15min';
SET LOCAL search_path = public, pg_catalog;

DO $preflight$
DECLARE missing_relation text;
BEGIN
  SELECT required.name INTO missing_relation FROM (VALUES
    ('ai_media_provider_accounts'),
    ('ai_media_provider_resources'),
    ('ai_media_influencers'),
    ('ai_media_script_variants'),
    ('ai_media_governance_profiles'),
    ('ai_media_render_jobs'),
    ('ai_media_outbox')
  ) required(name)
  WHERE to_regclass('public.' || required.name) IS NULL
  LIMIT 1;
  IF missing_relation IS NOT NULL THEN
    RAISE EXCEPTION 'PR19 requires relation %', missing_relation;
  END IF;
  IF to_regclass('public.ai_media_provider_accounts_owner_workspace_id_provider_uq') IS NULL
    OR to_regclass('public.ai_media_influencers_owner_workspace_id_uq') IS NULL
    OR to_regclass('public.ai_media_provider_resources_owner_workspace_id_uq') IS NULL
    OR to_regclass('public.ai_media_governance_profiles_owner_workspace_id_uq') IS NULL
    OR to_regclass('public.ai_media_render_jobs_owner_workspace_id_uq') IS NULL THEN
    RAISE EXCEPTION 'PR19 requires validated tenant identity controls from earlier AI Media Studio migrations';
  END IF;
  IF to_regclass('public.ai_media_daily_plans') IS NOT NULL
    OR to_regclass('public.ai_media_daily_plan_slots') IS NOT NULL
    OR to_regclass('public.ai_media_budget_buckets') IS NOT NULL
    OR to_regclass('public.ai_media_budget_reservations') IS NOT NULL
    OR to_regprocedure('public.ai_media_reject_budget_reservation_rewrite()') IS NOT NULL THEN
    RAISE EXCEPTION 'PR19 requires all four tables and its transition trigger to be absent';
  END IF;
END;
$preflight$;

CREATE UNIQUE INDEX ai_media_script_variants_owner_workspace_id_uq
  ON ai_media_script_variants(owner_user_id,workspace_id,id);
CREATE UNIQUE INDEX ai_media_provider_resources_owner_workspace_account_provider_id_uq
  ON ai_media_provider_resources(owner_user_id,workspace_id,provider_account_id,provider_key,id);
CREATE UNIQUE INDEX ai_media_outbox_owner_workspace_id_uq
  ON ai_media_outbox(owner_user_id,workspace_id,id);

CREATE TABLE ai_media_daily_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id text NOT NULL,
  workspace_id text NOT NULL DEFAULT 'personal',
  public_plan_key text NOT NULL,
  provider_account_id uuid NOT NULL,
  provider_key text NOT NULL,
  provider_credential_version integer NOT NULL,
  source_roster_key text NOT NULL,
  source_roster_digest text NOT NULL,
  plan_date date NOT NULL,
  accounting_time_zone text NOT NULL,
  status text NOT NULL DEFAULT 'preview',
  planned_slot_count integer NOT NULL,
  idempotency_key text NOT NULL,
  input_digest text NOT NULL,
  plan_digest text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  terminal_at timestamptz,
  CONSTRAINT ai_media_daily_plans_lifecycle_ck CHECK (
    public_plan_key ~ '^plan_[0-9a-f]{24}$'
    AND length(btrim(source_roster_key)) BETWEEN 1 AND 200
    AND source_roster_digest ~ '^sha256:[0-9a-f]{64}$'
    AND input_digest ~ '^sha256:[0-9a-f]{64}$'
    AND plan_digest ~ '^sha256:[0-9a-f]{64}$'
    AND length(btrim(accounting_time_zone)) BETWEEN 1 AND 80
    AND provider_credential_version >= 1
    AND planned_slot_count BETWEEN 1 AND 100000
    AND status IN ('preview','planned','blocked','active','completed','cancelled')
    AND plan_date = (created_at AT TIME ZONE accounting_time_zone)::date
    AND ((status IN ('completed','cancelled')) = (terminal_at IS NOT NULL))
  ),
  CONSTRAINT ai_media_daily_plans_provider_account_fk FOREIGN KEY
    (owner_user_id,workspace_id,provider_account_id,provider_key)
    REFERENCES ai_media_provider_accounts(owner_user_id,workspace_id,id,provider_key)
    ON UPDATE NO ACTION ON DELETE RESTRICT
);
CREATE UNIQUE INDEX ai_media_daily_plans_owner_workspace_public_key_uq
  ON ai_media_daily_plans(owner_user_id,workspace_id,public_plan_key);
CREATE UNIQUE INDEX ai_media_daily_plans_owner_workspace_idempotency_uq
  ON ai_media_daily_plans(owner_user_id,workspace_id,idempotency_key);
CREATE UNIQUE INDEX ai_media_daily_plans_owner_workspace_roster_day_uq
  ON ai_media_daily_plans(owner_user_id,workspace_id,provider_account_id,source_roster_key,plan_date,accounting_time_zone);
CREATE UNIQUE INDEX ai_media_daily_plans_exact_identity_uq
  ON ai_media_daily_plans(owner_user_id,workspace_id,id,provider_account_id,provider_key,provider_credential_version);
CREATE INDEX ai_media_daily_plans_tenant_day_idx
  ON ai_media_daily_plans(owner_user_id,workspace_id,plan_date,status);

CREATE TABLE ai_media_daily_plan_slots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id text NOT NULL,
  workspace_id text NOT NULL DEFAULT 'personal',
  public_slot_key text NOT NULL,
  daily_plan_id uuid NOT NULL,
  provider_account_id uuid NOT NULL,
  provider_key text NOT NULL,
  provider_credential_version integer NOT NULL,
  source_member_key text NOT NULL,
  influencer_id uuid NOT NULL,
  avatar_resource_id uuid NOT NULL,
  voice_resource_id uuid NOT NULL,
  script_variant_id uuid,
  video_number integer NOT NULL,
  status text NOT NULL DEFAULT 'preview',
  slot_digest text NOT NULL,
  state_version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  CONSTRAINT ai_media_daily_plan_slots_lifecycle_ck CHECK (
    public_slot_key ~ '^slot_[0-9a-f]{24}$'
    AND length(btrim(source_member_key)) BETWEEN 1 AND 200
    AND provider_credential_version >= 1 AND video_number BETWEEN 1 AND 100000
    AND state_version >= 1 AND slot_digest ~ '^sha256:[0-9a-f]{64}$'
    AND status IN ('preview','planned','reserved','committed','released','expired','blocked',
      'queued','submitted','reconciling','completed','failed','cancelled')
  ),
  CONSTRAINT ai_media_daily_plan_slots_exact_plan_fk FOREIGN KEY
    (owner_user_id,workspace_id,daily_plan_id,provider_account_id,provider_key,provider_credential_version)
    REFERENCES ai_media_daily_plans(owner_user_id,workspace_id,id,provider_account_id,provider_key,provider_credential_version)
    ON UPDATE NO ACTION ON DELETE RESTRICT,
  CONSTRAINT ai_media_daily_plan_slots_influencer_fk FOREIGN KEY
    (owner_user_id,workspace_id,influencer_id)
    REFERENCES ai_media_influencers(owner_user_id,workspace_id,id)
    ON UPDATE NO ACTION ON DELETE RESTRICT,
  CONSTRAINT ai_media_daily_plan_slots_avatar_fk FOREIGN KEY
    (owner_user_id,workspace_id,provider_account_id,provider_key,avatar_resource_id)
    REFERENCES ai_media_provider_resources(owner_user_id,workspace_id,provider_account_id,provider_key,id)
    ON UPDATE NO ACTION ON DELETE RESTRICT,
  CONSTRAINT ai_media_daily_plan_slots_voice_fk FOREIGN KEY
    (owner_user_id,workspace_id,provider_account_id,provider_key,voice_resource_id)
    REFERENCES ai_media_provider_resources(owner_user_id,workspace_id,provider_account_id,provider_key,id)
    ON UPDATE NO ACTION ON DELETE RESTRICT,
  CONSTRAINT ai_media_daily_plan_slots_script_variant_fk FOREIGN KEY
    (owner_user_id,workspace_id,script_variant_id)
    REFERENCES ai_media_script_variants(owner_user_id,workspace_id,id)
    ON UPDATE NO ACTION ON DELETE RESTRICT
);
CREATE UNIQUE INDEX ai_media_daily_plan_slots_owner_workspace_public_key_uq
  ON ai_media_daily_plan_slots(owner_user_id,workspace_id,public_slot_key);
CREATE UNIQUE INDEX ai_media_daily_plan_slots_plan_influencer_video_uq
  ON ai_media_daily_plan_slots(owner_user_id,workspace_id,daily_plan_id,influencer_id,video_number);
CREATE UNIQUE INDEX ai_media_daily_plan_slots_exact_identity_uq
  ON ai_media_daily_plan_slots(owner_user_id,workspace_id,id,provider_account_id,provider_key,provider_credential_version);
CREATE INDEX ai_media_daily_plan_slots_tenant_status_idx
  ON ai_media_daily_plan_slots(owner_user_id,workspace_id,daily_plan_id,status,video_number);

CREATE TABLE ai_media_budget_buckets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id text NOT NULL,
  workspace_id text NOT NULL DEFAULT 'personal',
  budget_date date NOT NULL,
  accounting_time_zone text NOT NULL,
  currency text NOT NULL DEFAULT 'USD',
  limit_micro_usd numeric(20,0) NOT NULL,
  reserved_micro_usd numeric(20,0) NOT NULL DEFAULT 0,
  committed_micro_usd numeric(20,0) NOT NULL DEFAULT 0,
  policy_digest text NOT NULL,
  policy_version integer NOT NULL,
  state_version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  CONSTRAINT ai_media_budget_buckets_lifecycle_ck CHECK (
    currency='USD' AND length(btrim(accounting_time_zone)) BETWEEN 1 AND 80
    AND budget_date=(created_at AT TIME ZONE accounting_time_zone)::date
    AND limit_micro_usd BETWEEN 0 AND 9000000000000000
    AND reserved_micro_usd BETWEEN 0 AND 9000000000000000
    AND committed_micro_usd BETWEEN 0 AND 9000000000000000
    AND reserved_micro_usd+committed_micro_usd<=limit_micro_usd
    AND policy_digest ~ '^sha256:[0-9a-f]{64}$'
    AND policy_version>=1 AND state_version>=1
  )
);
CREATE UNIQUE INDEX ai_media_budget_buckets_tenant_day_uq
  ON ai_media_budget_buckets(owner_user_id,workspace_id,budget_date,accounting_time_zone,currency);
CREATE UNIQUE INDEX ai_media_budget_buckets_exact_identity_uq
  ON ai_media_budget_buckets(owner_user_id,workspace_id,id,currency);

CREATE TABLE ai_media_budget_reservations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id text NOT NULL,
  workspace_id text NOT NULL DEFAULT 'personal',
  budget_bucket_id uuid NOT NULL,
  daily_plan_slot_id uuid NOT NULL,
  provider_account_id uuid NOT NULL,
  provider_key text NOT NULL,
  provider_credential_version integer NOT NULL,
  attempt integer NOT NULL,
  state text NOT NULL DEFAULT 'reserved',
  submission_state text NOT NULL DEFAULT 'not_started',
  amount_micro_usd numeric(20,0) NOT NULL,
  settled_amount_micro_usd numeric(20,0),
  currency text NOT NULL DEFAULT 'USD',
  idempotency_key text NOT NULL,
  input_digest text NOT NULL,
  admission_digest text NOT NULL,
  script_variant_checksum text NOT NULL,
  quote_digest text NOT NULL,
  quote_expires_at timestamptz NOT NULL,
  content_approval_digest text NOT NULL,
  human_launch_approval_digest text NOT NULL,
  governance_profile_id uuid NOT NULL,
  governance_evidence_digest text NOT NULL,
  policy_digest text NOT NULL,
  kill_switch_evidence_digest text NOT NULL,
  sandbox_evidence_digest text NOT NULL,
  provider_idempotency_key text NOT NULL,
  render_job_id uuid,
  dispatch_outbox_id uuid,
  reserved_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  expires_at timestamptz NOT NULL,
  committed_at timestamptz,
  settled_at timestamptz,
  released_at timestamptz,
  expired_at timestamptz,
  commit_evidence_digest text,
  reconciliation_evidence_digest text,
  release_reason text,
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  CONSTRAINT ai_media_budget_reservations_lifecycle_ck CHECK (
    provider_credential_version>=1 AND attempt>=1
    AND state IN ('reserved','committed','released','expired','settled')
    AND submission_state IN ('not_started','dispatching','confirmed','ambiguous','reconciled_no_submit')
    AND currency='USD' AND amount_micro_usd BETWEEN 1 AND 9000000000000000
    AND (settled_amount_micro_usd IS NULL OR settled_amount_micro_usd BETWEEN 0 AND amount_micro_usd)
    AND input_digest ~ '^sha256:[0-9a-f]{64}$'
    AND admission_digest ~ '^sha256:[0-9a-f]{64}$'
    AND script_variant_checksum ~ '^[0-9a-f]{64}$'
    AND quote_digest ~ '^sha256:[0-9a-f]{64}$'
    AND content_approval_digest ~ '^sha256:[0-9a-f]{64}$'
    AND human_launch_approval_digest ~ '^sha256:[0-9a-f]{64}$'
    AND governance_evidence_digest ~ '^sha256:[0-9a-f]{64}$'
    AND policy_digest ~ '^sha256:[0-9a-f]{64}$'
    AND kill_switch_evidence_digest ~ '^sha256:[0-9a-f]{64}$'
    AND sandbox_evidence_digest ~ '^sha256:[0-9a-f]{64}$'
    AND (commit_evidence_digest IS NULL OR commit_evidence_digest ~ '^sha256:[0-9a-f]{64}$')
    AND (reconciliation_evidence_digest IS NULL OR reconciliation_evidence_digest ~ '^sha256:[0-9a-f]{64}$')
    AND length(btrim(idempotency_key)) BETWEEN 8 AND 200
    AND length(btrim(provider_idempotency_key)) BETWEEN 8 AND 200
    AND quote_expires_at>reserved_at
    AND expires_at>reserved_at AND expires_at<=quote_expires_at
    AND (state<>'reserved' OR (committed_at IS NULL AND settled_at IS NULL AND released_at IS NULL
      AND expired_at IS NULL AND submission_state='not_started'))
    AND (state<>'committed' OR (committed_at IS NOT NULL AND commit_evidence_digest IS NOT NULL
      AND submission_state<>'not_started' AND settled_at IS NULL AND released_at IS NULL AND expired_at IS NULL))
    AND (state<>'settled' OR (committed_at IS NOT NULL AND settled_at IS NOT NULL
      AND settled_amount_micro_usd IS NOT NULL AND submission_state='confirmed'
      AND reconciliation_evidence_digest IS NOT NULL AND released_at IS NULL AND expired_at IS NULL))
    AND (state<>'released' OR (released_at IS NOT NULL AND expired_at IS NULL))
    AND (state<>'expired' OR (expired_at IS NOT NULL AND committed_at IS NULL AND settled_at IS NULL AND released_at IS NULL))
    AND (submission_state<>'ambiguous' OR state='committed')
    AND (state NOT IN ('released','expired') OR submission_state IN ('not_started','reconciled_no_submit'))
    AND (release_reason IS NULL OR length(btrim(release_reason)) BETWEEN 1 AND 200)
  ),
  CONSTRAINT ai_media_budget_reservations_exact_bucket_fk FOREIGN KEY
    (owner_user_id,workspace_id,budget_bucket_id,currency)
    REFERENCES ai_media_budget_buckets(owner_user_id,workspace_id,id,currency)
    ON UPDATE NO ACTION ON DELETE RESTRICT,
  CONSTRAINT ai_media_budget_reservations_exact_slot_fk FOREIGN KEY
    (owner_user_id,workspace_id,daily_plan_slot_id,provider_account_id,provider_key,provider_credential_version)
    REFERENCES ai_media_daily_plan_slots(owner_user_id,workspace_id,id,provider_account_id,provider_key,provider_credential_version)
    ON UPDATE NO ACTION ON DELETE RESTRICT,
  CONSTRAINT ai_media_budget_reservations_governance_fk FOREIGN KEY
    (owner_user_id,workspace_id,governance_profile_id)
    REFERENCES ai_media_governance_profiles(owner_user_id,workspace_id,id)
    ON UPDATE NO ACTION ON DELETE RESTRICT,
  CONSTRAINT ai_media_budget_reservations_render_job_fk FOREIGN KEY
    (owner_user_id,workspace_id,render_job_id)
    REFERENCES ai_media_render_jobs(owner_user_id,workspace_id,id)
    ON UPDATE NO ACTION ON DELETE RESTRICT,
  CONSTRAINT ai_media_budget_reservations_dispatch_outbox_fk FOREIGN KEY
    (owner_user_id,workspace_id,dispatch_outbox_id)
    REFERENCES ai_media_outbox(owner_user_id,workspace_id,id)
    ON UPDATE NO ACTION ON DELETE RESTRICT
);
CREATE UNIQUE INDEX ai_media_budget_reservations_owner_workspace_idempotency_uq
  ON ai_media_budget_reservations(owner_user_id,workspace_id,idempotency_key);
CREATE UNIQUE INDEX ai_media_budget_reservations_slot_attempt_uq
  ON ai_media_budget_reservations(owner_user_id,workspace_id,daily_plan_slot_id,attempt);
CREATE UNIQUE INDEX ai_media_budget_reservations_active_slot_uq
  ON ai_media_budget_reservations(owner_user_id,workspace_id,daily_plan_slot_id)
  WHERE state IN ('reserved','committed');
CREATE UNIQUE INDEX ai_media_budget_reservations_render_job_uq
  ON ai_media_budget_reservations(render_job_id) WHERE render_job_id IS NOT NULL;
CREATE UNIQUE INDEX ai_media_budget_reservations_dispatch_outbox_uq
  ON ai_media_budget_reservations(dispatch_outbox_id) WHERE dispatch_outbox_id IS NOT NULL;
CREATE INDEX ai_media_budget_reservations_tenant_state_idx
  ON ai_media_budget_reservations(owner_user_id,workspace_id,state,expires_at);

CREATE FUNCTION ai_media_reject_budget_reservation_rewrite() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $body$
BEGIN
  IF TG_OP='DELETE' THEN
    RAISE EXCEPTION 'budget reservation evidence cannot be deleted';
  END IF;
  IF ROW(NEW.owner_user_id,NEW.workspace_id,NEW.budget_bucket_id,NEW.daily_plan_slot_id,
      NEW.provider_account_id,NEW.provider_key,NEW.provider_credential_version,NEW.attempt,
      NEW.amount_micro_usd,NEW.currency,NEW.idempotency_key,NEW.input_digest,NEW.admission_digest,
      NEW.script_variant_checksum,
      NEW.quote_digest,NEW.quote_expires_at,NEW.content_approval_digest,NEW.human_launch_approval_digest,
      NEW.governance_profile_id,NEW.governance_evidence_digest,NEW.policy_digest,
      NEW.kill_switch_evidence_digest,NEW.sandbox_evidence_digest,NEW.provider_idempotency_key,
      NEW.reserved_at,NEW.expires_at)
    IS DISTINCT FROM
    ROW(OLD.owner_user_id,OLD.workspace_id,OLD.budget_bucket_id,OLD.daily_plan_slot_id,
      OLD.provider_account_id,OLD.provider_key,OLD.provider_credential_version,OLD.attempt,
      OLD.amount_micro_usd,OLD.currency,OLD.idempotency_key,OLD.input_digest,OLD.admission_digest,
      OLD.script_variant_checksum,
      OLD.quote_digest,OLD.quote_expires_at,OLD.content_approval_digest,OLD.human_launch_approval_digest,
      OLD.governance_profile_id,OLD.governance_evidence_digest,OLD.policy_digest,
      OLD.kill_switch_evidence_digest,OLD.sandbox_evidence_digest,OLD.provider_idempotency_key,
      OLD.reserved_at,OLD.expires_at) THEN
    RAISE EXCEPTION 'budget reservation immutable admission evidence cannot change';
  END IF;
  IF (OLD.render_job_id IS NOT NULL AND NEW.render_job_id IS DISTINCT FROM OLD.render_job_id)
    OR (OLD.dispatch_outbox_id IS NOT NULL AND NEW.dispatch_outbox_id IS DISTINCT FROM OLD.dispatch_outbox_id) THEN
    RAISE EXCEPTION 'attached job and outbox identities cannot change';
  END IF;
  IF OLD.state IN ('released','expired','settled') THEN
    RAISE EXCEPTION 'terminal budget reservation cannot change';
  END IF;
  IF OLD.state='reserved' AND NEW.state NOT IN ('reserved','committed','released','expired') THEN
    RAISE EXCEPTION 'invalid reserved budget transition';
  END IF;
  IF OLD.state='reserved' AND NEW.state='committed'
    AND (clock_timestamp()>=OLD.expires_at OR NEW.submission_state<>'dispatching'
      OR NEW.commit_evidence_digest IS NULL) THEN
    RAISE EXCEPTION 'budget commit requires live reservation and dispatch evidence';
  END IF;
  IF OLD.state='reserved' AND NEW.state='released'
    AND (NEW.submission_state<>'not_started' OR NEW.committed_at IS NOT NULL
      OR NEW.commit_evidence_digest IS NOT NULL) THEN
    RAISE EXCEPTION 'unsubmitted budget release cannot carry dispatch evidence';
  END IF;
  IF OLD.state='committed' AND NEW.state NOT IN ('committed','released','settled') THEN
    RAISE EXCEPTION 'committed budget cannot expire or return to reserved';
  END IF;
  IF OLD.state='reserved' AND NEW.state='expired'
    AND (clock_timestamp()<OLD.expires_at OR OLD.submission_state<>'not_started') THEN
    RAISE EXCEPTION 'only expired not-started reservations may expire';
  END IF;
  IF OLD.state='committed' AND NEW.state='released'
    AND (NEW.submission_state<>'reconciled_no_submit' OR NEW.reconciliation_evidence_digest IS NULL) THEN
    RAISE EXCEPTION 'committed budget release requires definitive reconciliation evidence';
  END IF;
  IF OLD.submission_state='ambiguous'
    AND NOT (NEW.state='committed' OR (NEW.state='settled' AND NEW.submission_state='confirmed'
      AND NEW.reconciliation_evidence_digest IS NOT NULL)) THEN
    RAISE EXCEPTION 'ambiguous provider submission must retain committed budget';
  END IF;
  IF OLD.commit_evidence_digest IS NOT NULL
    AND (NEW.commit_evidence_digest IS DISTINCT FROM OLD.commit_evidence_digest
      OR NEW.committed_at IS DISTINCT FROM OLD.committed_at) THEN
    RAISE EXCEPTION 'budget commit evidence cannot change';
  END IF;
  IF OLD.reconciliation_evidence_digest IS NOT NULL
    AND NEW.reconciliation_evidence_digest IS DISTINCT FROM OLD.reconciliation_evidence_digest THEN
    RAISE EXCEPTION 'budget reconciliation evidence cannot change';
  END IF;
  RETURN NEW;
END;
$body$;
CREATE TRIGGER ai_media_budget_reservations_transition_guard
  BEFORE UPDATE OR DELETE ON ai_media_budget_reservations
  FOR EACH ROW EXECUTE FUNCTION ai_media_reject_budget_reservation_rewrite();

COMMIT;
