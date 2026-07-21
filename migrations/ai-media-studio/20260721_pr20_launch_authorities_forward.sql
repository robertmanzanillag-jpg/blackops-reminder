-- AI Media Studio PR20: immutable launch-authority policies, evidence, and snapshots.
-- Reviewed, additive/data-preserving migration. Do not apply automatically.
-- Every revision/snapshot issuer must hold the same tenant/workspace advisory transaction lock.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15min';
SET LOCAL search_path = public, pg_catalog;

DO $preflight$
DECLARE missing_relation text;
BEGIN
  SELECT required.name INTO missing_relation FROM (VALUES
    ('ai_media_daily_plans'),
    ('ai_media_daily_plan_slots'),
    ('ai_media_budget_buckets'),
    ('ai_media_budget_reservations'),
    ('ai_media_script_variants'),
    ('ai_media_governance_profiles')
  ) required(name)
  WHERE to_regclass('public.' || required.name) IS NULL
  LIMIT 1;
  IF missing_relation IS NOT NULL THEN
    RAISE EXCEPTION 'PR20 requires PR19 relation %', missing_relation;
  END IF;
  IF to_regclass('public.ai_media_daily_plans_exact_identity_uq') IS NULL
    OR to_regclass('public.ai_media_daily_plan_slots_exact_identity_uq') IS NULL
    OR to_regclass('public.ai_media_budget_reservations_owner_workspace_idempotency_uq') IS NULL
    OR to_regclass('public.ai_media_script_variants_owner_workspace_id_uq') IS NULL
    OR to_regclass('public.ai_media_governance_profiles_owner_workspace_id_uq') IS NULL
    OR to_regprocedure('public.ai_media_reject_budget_reservation_rewrite()') IS NULL THEN
    RAISE EXCEPTION 'PR20 requires validated PR19 admission and immutable reservation controls';
  END IF;
  IF to_regclass('public.ai_media_admission_policy_revisions') IS NOT NULL
    OR to_regclass('public.ai_media_kill_switch_revisions') IS NOT NULL
    OR to_regclass('public.ai_media_launch_evidence') IS NOT NULL
    OR to_regclass('public.ai_media_launch_authority_snapshots') IS NOT NULL
    OR to_regprocedure('public.ai_media_reject_launch_authority_rewrite()') IS NOT NULL
    OR to_regprocedure('public.ai_media_reject_budget_reservation_authority_rewrite()') IS NOT NULL
    OR EXISTS (
      SELECT 1 FROM pg_attribute
      WHERE attrelid='public.ai_media_budget_reservations'::regclass
        AND attname IN ('authority_snapshot_id','authority_digest') AND NOT attisdropped
    ) THEN
    RAISE EXCEPTION 'PR20 requires all launch-authority objects and reservation columns to be absent';
  END IF;
END;
$preflight$;

CREATE UNIQUE INDEX ai_media_daily_plans_authority_identity_uq
  ON ai_media_daily_plans(owner_user_id,workspace_id,id,provider_account_id,provider_key,provider_credential_version,plan_digest);
CREATE UNIQUE INDEX ai_media_daily_plan_slots_authority_identity_uq
  ON ai_media_daily_plan_slots(owner_user_id,workspace_id,id,daily_plan_id,provider_account_id,provider_key,
    provider_credential_version,script_variant_id,slot_digest);
CREATE UNIQUE INDEX ai_media_script_variants_authority_identity_uq
  ON ai_media_script_variants(owner_user_id,workspace_id,id,checksum);
CREATE UNIQUE INDEX ai_media_governance_profiles_authority_identity_uq
  ON ai_media_governance_profiles(owner_user_id,workspace_id,id,evidence_digest);

CREATE TABLE ai_media_admission_policy_revisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id text NOT NULL,
  workspace_id text NOT NULL DEFAULT 'personal',
  revision integer NOT NULL,
  previous_revision_id uuid,
  previous_revision integer,
  daily_budget_micro_usd numeric(20,0) NOT NULL,
  total_concurrency integer NOT NULL,
  provider_concurrency integer NOT NULL,
  tenant_concurrency integer NOT NULL,
  allowed_languages jsonb NOT NULL,
  allowed_countries jsonb NOT NULL,
  allowed_time_zones jsonb NOT NULL,
  state text NOT NULL,
  valid_from timestamptz NOT NULL,
  expires_at timestamptz,
  policy_digest text NOT NULL,
  evidence_digest text NOT NULL,
  input_digest text NOT NULL,
  actor_user_id text NOT NULL,
  idempotency_key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  CONSTRAINT ai_media_admission_policy_revisions_ck CHECK (
    revision>=1 AND ((revision=1 AND previous_revision_id IS NULL AND previous_revision IS NULL)
      OR (revision>1 AND previous_revision_id IS NOT NULL AND previous_revision=revision-1))
    AND daily_budget_micro_usd BETWEEN 0 AND 9000000000000000
    AND total_concurrency BETWEEN 0 AND 100000
    AND provider_concurrency BETWEEN 0 AND total_concurrency
    AND tenant_concurrency BETWEEN 0 AND total_concurrency
    AND jsonb_typeof(allowed_languages)='array' AND jsonb_typeof(allowed_countries)='array'
    AND jsonb_typeof(allowed_time_zones)='array'
    AND state IN ('active','disabled')
    AND (state='disabled' OR (daily_budget_micro_usd>0 AND total_concurrency>0
      AND provider_concurrency>0 AND tenant_concurrency>0))
    AND (expires_at IS NULL OR expires_at>valid_from)
    AND policy_digest ~ '^sha256:[0-9a-f]{64}$' AND evidence_digest ~ '^sha256:[0-9a-f]{64}$'
    AND input_digest ~ '^sha256:[0-9a-f]{64}$'
    AND length(btrim(actor_user_id)) BETWEEN 1 AND 200 AND length(btrim(idempotency_key)) BETWEEN 8 AND 200
  )
);
CREATE UNIQUE INDEX ai_media_admission_policy_revisions_chain_uq
  ON ai_media_admission_policy_revisions(owner_user_id,workspace_id,revision);
CREATE UNIQUE INDEX ai_media_admission_policy_revisions_idempotency_uq
  ON ai_media_admission_policy_revisions(owner_user_id,workspace_id,idempotency_key);
CREATE UNIQUE INDEX ai_media_admission_policy_revisions_exact_identity_uq
  ON ai_media_admission_policy_revisions(owner_user_id,workspace_id,id,revision,policy_digest);
CREATE UNIQUE INDEX ai_media_admission_policy_revisions_previous_identity_uq
  ON ai_media_admission_policy_revisions(owner_user_id,workspace_id,id,revision);
ALTER TABLE ai_media_admission_policy_revisions ADD CONSTRAINT ai_media_admission_policy_revisions_previous_fk
  FOREIGN KEY (owner_user_id,workspace_id,previous_revision_id,previous_revision)
  REFERENCES ai_media_admission_policy_revisions(owner_user_id,workspace_id,id,revision)
  ON UPDATE NO ACTION ON DELETE RESTRICT;

CREATE TABLE ai_media_kill_switch_revisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id text NOT NULL,
  workspace_id text NOT NULL DEFAULT 'personal',
  revision integer NOT NULL,
  previous_revision_id uuid,
  previous_revision integer,
  active boolean NOT NULL,
  valid_from timestamptz NOT NULL,
  expires_at timestamptz,
  reason text NOT NULL,
  evidence_digest text NOT NULL,
  input_digest text NOT NULL,
  actor_user_id text NOT NULL,
  idempotency_key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  CONSTRAINT ai_media_kill_switch_revisions_ck CHECK (
    revision>=1 AND ((revision=1 AND previous_revision_id IS NULL AND previous_revision IS NULL)
      OR (revision>1 AND previous_revision_id IS NOT NULL AND previous_revision=revision-1))
    AND (expires_at IS NULL OR expires_at>valid_from) AND length(btrim(reason)) BETWEEN 1 AND 500
    AND evidence_digest ~ '^sha256:[0-9a-f]{64}$' AND input_digest ~ '^sha256:[0-9a-f]{64}$'
    AND length(btrim(actor_user_id)) BETWEEN 1 AND 200 AND length(btrim(idempotency_key)) BETWEEN 8 AND 200
  )
);
CREATE UNIQUE INDEX ai_media_kill_switch_revisions_chain_uq
  ON ai_media_kill_switch_revisions(owner_user_id,workspace_id,revision);
CREATE UNIQUE INDEX ai_media_kill_switch_revisions_idempotency_uq
  ON ai_media_kill_switch_revisions(owner_user_id,workspace_id,idempotency_key);
CREATE UNIQUE INDEX ai_media_kill_switch_revisions_exact_identity_uq
  ON ai_media_kill_switch_revisions(owner_user_id,workspace_id,id,revision,evidence_digest);
CREATE UNIQUE INDEX ai_media_kill_switch_revisions_previous_identity_uq
  ON ai_media_kill_switch_revisions(owner_user_id,workspace_id,id,revision);
ALTER TABLE ai_media_kill_switch_revisions ADD CONSTRAINT ai_media_kill_switch_revisions_previous_fk
  FOREIGN KEY (owner_user_id,workspace_id,previous_revision_id,previous_revision)
  REFERENCES ai_media_kill_switch_revisions(owner_user_id,workspace_id,id,revision)
  ON UPDATE NO ACTION ON DELETE RESTRICT;

CREATE TABLE ai_media_launch_evidence (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id text NOT NULL,
  workspace_id text NOT NULL DEFAULT 'personal',
  daily_plan_slot_id uuid NOT NULL,
  provider_account_id uuid NOT NULL,
  provider_key text NOT NULL,
  provider_credential_version integer NOT NULL,
  slot_attempt integer NOT NULL,
  script_variant_id uuid NOT NULL,
  script_variant_checksum text NOT NULL,
  governance_profile_id uuid NOT NULL,
  governance_evidence_digest text NOT NULL,
  governance_use text NOT NULL,
  governance_territory text NOT NULL,
  content_country text NOT NULL,
  launch_subject_digest text NOT NULL,
  evidence_kind text NOT NULL,
  decision text NOT NULL,
  amount_micro_usd numeric(20,0),
  currency text,
  revision integer NOT NULL,
  previous_evidence_id uuid,
  previous_evidence_revision integer,
  valid_from timestamptz NOT NULL,
  expires_at timestamptz,
  actor_user_id text NOT NULL,
  source_kind text NOT NULL,
  evidence_digest text NOT NULL,
  input_digest text NOT NULL,
  idempotency_key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  CONSTRAINT ai_media_launch_evidence_ck CHECK (
    revision>=1 AND ((revision=1 AND previous_evidence_id IS NULL AND previous_evidence_revision IS NULL)
      OR (revision>1 AND previous_evidence_id IS NOT NULL AND previous_evidence_revision=revision-1))
    AND provider_credential_version>=1 AND slot_attempt>=1 AND script_variant_checksum ~ '^[0-9a-f]{64}$'
    AND governance_evidence_digest ~ '^sha256:[0-9a-f]{64}$'
    AND length(btrim(governance_use)) BETWEEN 1 AND 80 AND length(btrim(governance_territory)) BETWEEN 1 AND 80
    AND content_country ~ '^[A-Z]{2}$'
    AND launch_subject_digest ~ '^sha256:[0-9a-f]{64}$'
    AND evidence_kind IN ('content_approval','human_launch_approval','sandbox_proof','maximum_quote')
    AND ((evidence_kind IN ('content_approval','human_launch_approval') AND decision IN ('approved','rejected','revoked'))
      OR (evidence_kind='sandbox_proof' AND decision IN ('passed','failed','revoked'))
      OR (evidence_kind='maximum_quote' AND decision IN ('quoted','declined','revoked')))
    AND ((evidence_kind='maximum_quote' AND amount_micro_usd BETWEEN 1 AND 9000000000000000
      AND currency='USD') OR (evidence_kind<>'maximum_quote'
      AND amount_micro_usd IS NULL AND currency IS NULL))
    AND (expires_at IS NULL OR expires_at>valid_from)
    AND length(btrim(actor_user_id)) BETWEEN 1 AND 200 AND length(btrim(source_kind)) BETWEEN 1 AND 120
    AND evidence_digest ~ '^sha256:[0-9a-f]{64}$' AND input_digest ~ '^sha256:[0-9a-f]{64}$'
    AND length(btrim(idempotency_key)) BETWEEN 8 AND 200
  ),
  CONSTRAINT ai_media_launch_evidence_exact_slot_fk FOREIGN KEY
    (owner_user_id,workspace_id,daily_plan_slot_id,provider_account_id,provider_key,provider_credential_version)
    REFERENCES ai_media_daily_plan_slots(owner_user_id,workspace_id,id,provider_account_id,provider_key,provider_credential_version)
    ON UPDATE NO ACTION ON DELETE RESTRICT,
  CONSTRAINT ai_media_launch_evidence_script_variant_fk FOREIGN KEY
    (owner_user_id,workspace_id,script_variant_id,script_variant_checksum)
    REFERENCES ai_media_script_variants(owner_user_id,workspace_id,id,checksum)
    ON UPDATE NO ACTION ON DELETE RESTRICT,
  CONSTRAINT ai_media_launch_evidence_governance_fk FOREIGN KEY
    (owner_user_id,workspace_id,governance_profile_id,governance_evidence_digest)
    REFERENCES ai_media_governance_profiles(owner_user_id,workspace_id,id,evidence_digest)
    ON UPDATE NO ACTION ON DELETE RESTRICT
);
CREATE UNIQUE INDEX ai_media_launch_evidence_chain_uq
  ON ai_media_launch_evidence(owner_user_id,workspace_id,daily_plan_slot_id,slot_attempt,evidence_kind,revision);
CREATE UNIQUE INDEX ai_media_launch_evidence_idempotency_uq
  ON ai_media_launch_evidence(owner_user_id,workspace_id,idempotency_key);
CREATE UNIQUE INDEX ai_media_launch_evidence_exact_identity_uq
  ON ai_media_launch_evidence(owner_user_id,workspace_id,id,revision,evidence_digest);
CREATE UNIQUE INDEX ai_media_launch_evidence_snapshot_identity_uq
  ON ai_media_launch_evidence(owner_user_id,workspace_id,id,daily_plan_slot_id,slot_attempt,
    provider_account_id,provider_key,provider_credential_version,script_variant_id,script_variant_checksum,
    governance_profile_id,governance_evidence_digest,governance_use,governance_territory,content_country,
    launch_subject_digest,evidence_digest);
CREATE UNIQUE INDEX ai_media_launch_evidence_previous_identity_uq
  ON ai_media_launch_evidence(owner_user_id,workspace_id,daily_plan_slot_id,slot_attempt,evidence_kind,id,revision);
ALTER TABLE ai_media_launch_evidence ADD CONSTRAINT ai_media_launch_evidence_previous_fk
  FOREIGN KEY (owner_user_id,workspace_id,daily_plan_slot_id,slot_attempt,evidence_kind,
    previous_evidence_id,previous_evidence_revision)
  REFERENCES ai_media_launch_evidence(owner_user_id,workspace_id,daily_plan_slot_id,slot_attempt,evidence_kind,id,revision)
  ON UPDATE NO ACTION ON DELETE RESTRICT;

CREATE TABLE ai_media_launch_authority_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id text NOT NULL,
  workspace_id text NOT NULL DEFAULT 'personal',
  daily_plan_id uuid NOT NULL,
  plan_digest text NOT NULL,
  daily_plan_slot_id uuid NOT NULL,
  slot_digest text NOT NULL,
  provider_account_id uuid NOT NULL,
  provider_key text NOT NULL,
  provider_credential_version integer NOT NULL,
  slot_attempt integer NOT NULL,
  script_variant_id uuid NOT NULL,
  script_variant_checksum text NOT NULL,
  governance_profile_id uuid NOT NULL,
  governance_evidence_digest text NOT NULL,
  governance_use text NOT NULL,
  governance_territory text NOT NULL,
  content_country text NOT NULL,
  launch_subject_digest text NOT NULL,
  content_approval_evidence_id uuid NOT NULL,
  content_approval_evidence_digest text NOT NULL,
  human_launch_approval_evidence_id uuid NOT NULL,
  human_launch_approval_evidence_digest text NOT NULL,
  sandbox_evidence_id uuid NOT NULL,
  sandbox_evidence_digest text NOT NULL,
  maximum_quote_evidence_id uuid NOT NULL,
  maximum_quote_evidence_digest text NOT NULL,
  policy_revision_id uuid NOT NULL,
  policy_revision integer NOT NULL,
  policy_digest text NOT NULL,
  kill_switch_revision_id uuid NOT NULL,
  kill_switch_revision integer NOT NULL,
  kill_switch_evidence_digest text NOT NULL,
  maximum_quote_micro_usd numeric(20,0) NOT NULL,
  currency text NOT NULL,
  valid_from timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  admission_digest text NOT NULL,
  authority_digest text NOT NULL,
  input_digest text NOT NULL,
  idempotency_key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  CONSTRAINT ai_media_launch_authority_snapshots_ck CHECK (
    provider_credential_version>=1 AND slot_attempt>=1
    AND plan_digest ~ '^sha256:[0-9a-f]{64}$' AND slot_digest ~ '^sha256:[0-9a-f]{64}$'
    AND script_variant_checksum ~ '^[0-9a-f]{64}$'
    AND governance_evidence_digest ~ '^sha256:[0-9a-f]{64}$'
    AND length(btrim(governance_use)) BETWEEN 1 AND 80 AND length(btrim(governance_territory)) BETWEEN 1 AND 80
    AND content_country ~ '^[A-Z]{2}$'
    AND launch_subject_digest ~ '^sha256:[0-9a-f]{64}$'
    AND content_approval_evidence_digest ~ '^sha256:[0-9a-f]{64}$'
    AND human_launch_approval_evidence_digest ~ '^sha256:[0-9a-f]{64}$'
    AND sandbox_evidence_digest ~ '^sha256:[0-9a-f]{64}$'
    AND maximum_quote_evidence_digest ~ '^sha256:[0-9a-f]{64}$'
    AND num_nonnulls(content_approval_evidence_id,human_launch_approval_evidence_id,
      sandbox_evidence_id,maximum_quote_evidence_id)=4
    AND content_approval_evidence_id<>human_launch_approval_evidence_id
    AND content_approval_evidence_id<>sandbox_evidence_id
    AND content_approval_evidence_id<>maximum_quote_evidence_id
    AND human_launch_approval_evidence_id<>sandbox_evidence_id
    AND human_launch_approval_evidence_id<>maximum_quote_evidence_id
    AND sandbox_evidence_id<>maximum_quote_evidence_id
    AND policy_revision>=1 AND kill_switch_revision>=1
    AND policy_digest ~ '^sha256:[0-9a-f]{64}$'
    AND kill_switch_evidence_digest ~ '^sha256:[0-9a-f]{64}$'
    AND maximum_quote_micro_usd BETWEEN 1 AND 9000000000000000 AND currency='USD'
    AND expires_at>valid_from AND admission_digest ~ '^sha256:[0-9a-f]{64}$'
    AND authority_digest ~ '^sha256:[0-9a-f]{64}$' AND input_digest ~ '^sha256:[0-9a-f]{64}$'
    AND length(btrim(idempotency_key)) BETWEEN 8 AND 200
  ),
  CONSTRAINT ai_media_launch_authority_snapshots_exact_plan_fk FOREIGN KEY
    (owner_user_id,workspace_id,daily_plan_id,provider_account_id,provider_key,provider_credential_version,plan_digest)
    REFERENCES ai_media_daily_plans(owner_user_id,workspace_id,id,provider_account_id,provider_key,provider_credential_version,plan_digest)
    ON UPDATE NO ACTION ON DELETE RESTRICT,
  CONSTRAINT ai_media_launch_authority_snapshots_exact_slot_fk FOREIGN KEY
    (owner_user_id,workspace_id,daily_plan_slot_id,daily_plan_id,provider_account_id,provider_key,
      provider_credential_version,script_variant_id,slot_digest)
    REFERENCES ai_media_daily_plan_slots(owner_user_id,workspace_id,id,daily_plan_id,provider_account_id,provider_key,
      provider_credential_version,script_variant_id,slot_digest)
    ON UPDATE NO ACTION ON DELETE RESTRICT,
  CONSTRAINT ai_media_launch_authority_snapshots_script_variant_fk FOREIGN KEY
    (owner_user_id,workspace_id,script_variant_id,script_variant_checksum)
    REFERENCES ai_media_script_variants(owner_user_id,workspace_id,id,checksum)
    ON UPDATE NO ACTION ON DELETE RESTRICT,
  CONSTRAINT ai_media_launch_authority_snapshots_governance_fk FOREIGN KEY
    (owner_user_id,workspace_id,governance_profile_id,governance_evidence_digest)
    REFERENCES ai_media_governance_profiles(owner_user_id,workspace_id,id,evidence_digest)
    ON UPDATE NO ACTION ON DELETE RESTRICT,
  CONSTRAINT ai_media_launch_authority_snapshots_content_evidence_fk FOREIGN KEY
    (owner_user_id,workspace_id,content_approval_evidence_id,daily_plan_slot_id,slot_attempt,
      provider_account_id,provider_key,provider_credential_version,script_variant_id,script_variant_checksum,
      governance_profile_id,governance_evidence_digest,governance_use,governance_territory,content_country,
      launch_subject_digest,content_approval_evidence_digest)
    REFERENCES ai_media_launch_evidence(owner_user_id,workspace_id,id,daily_plan_slot_id,slot_attempt,
      provider_account_id,provider_key,provider_credential_version,script_variant_id,script_variant_checksum,
      governance_profile_id,governance_evidence_digest,governance_use,governance_territory,content_country,
      launch_subject_digest,evidence_digest) ON DELETE RESTRICT,
  CONSTRAINT ai_media_launch_authority_snapshots_human_evidence_fk FOREIGN KEY
    (owner_user_id,workspace_id,human_launch_approval_evidence_id,daily_plan_slot_id,slot_attempt,
      provider_account_id,provider_key,provider_credential_version,script_variant_id,script_variant_checksum,
      governance_profile_id,governance_evidence_digest,governance_use,governance_territory,content_country,
      launch_subject_digest,human_launch_approval_evidence_digest)
    REFERENCES ai_media_launch_evidence(owner_user_id,workspace_id,id,daily_plan_slot_id,slot_attempt,
      provider_account_id,provider_key,provider_credential_version,script_variant_id,script_variant_checksum,
      governance_profile_id,governance_evidence_digest,governance_use,governance_territory,content_country,
      launch_subject_digest,evidence_digest) ON DELETE RESTRICT,
  CONSTRAINT ai_media_launch_authority_snapshots_sandbox_evidence_fk FOREIGN KEY
    (owner_user_id,workspace_id,sandbox_evidence_id,daily_plan_slot_id,slot_attempt,
      provider_account_id,provider_key,provider_credential_version,script_variant_id,script_variant_checksum,
      governance_profile_id,governance_evidence_digest,governance_use,governance_territory,content_country,
      launch_subject_digest,sandbox_evidence_digest)
    REFERENCES ai_media_launch_evidence(owner_user_id,workspace_id,id,daily_plan_slot_id,slot_attempt,
      provider_account_id,provider_key,provider_credential_version,script_variant_id,script_variant_checksum,
      governance_profile_id,governance_evidence_digest,governance_use,governance_territory,content_country,
      launch_subject_digest,evidence_digest) ON DELETE RESTRICT,
  CONSTRAINT ai_media_launch_authority_snapshots_quote_evidence_fk FOREIGN KEY
    (owner_user_id,workspace_id,maximum_quote_evidence_id,daily_plan_slot_id,slot_attempt,
      provider_account_id,provider_key,provider_credential_version,script_variant_id,script_variant_checksum,
      governance_profile_id,governance_evidence_digest,governance_use,governance_territory,content_country,
      launch_subject_digest,maximum_quote_evidence_digest)
    REFERENCES ai_media_launch_evidence(owner_user_id,workspace_id,id,daily_plan_slot_id,slot_attempt,
      provider_account_id,provider_key,provider_credential_version,script_variant_id,script_variant_checksum,
      governance_profile_id,governance_evidence_digest,governance_use,governance_territory,content_country,
      launch_subject_digest,evidence_digest) ON DELETE RESTRICT,
  CONSTRAINT ai_media_launch_authority_snapshots_policy_fk FOREIGN KEY
    (owner_user_id,workspace_id,policy_revision_id,policy_revision,policy_digest)
    REFERENCES ai_media_admission_policy_revisions(owner_user_id,workspace_id,id,revision,policy_digest)
    ON UPDATE NO ACTION ON DELETE RESTRICT,
  CONSTRAINT ai_media_launch_authority_snapshots_kill_switch_fk FOREIGN KEY
    (owner_user_id,workspace_id,kill_switch_revision_id,kill_switch_revision,kill_switch_evidence_digest)
    REFERENCES ai_media_kill_switch_revisions(owner_user_id,workspace_id,id,revision,evidence_digest)
    ON UPDATE NO ACTION ON DELETE RESTRICT
);
CREATE UNIQUE INDEX ai_media_launch_authority_snapshots_idempotency_uq
  ON ai_media_launch_authority_snapshots(owner_user_id,workspace_id,idempotency_key);
CREATE INDEX ai_media_launch_authority_snapshots_slot_attempt_idx
  ON ai_media_launch_authority_snapshots(owner_user_id,workspace_id,daily_plan_slot_id,slot_attempt,created_at);
CREATE UNIQUE INDEX ai_media_launch_authority_snapshots_exact_identity_uq
  ON ai_media_launch_authority_snapshots(owner_user_id,workspace_id,id,daily_plan_slot_id,slot_attempt,
    admission_digest,provider_account_id,provider_key,provider_credential_version,script_variant_checksum,authority_digest);

ALTER TABLE ai_media_budget_reservations
  ADD COLUMN authority_snapshot_id uuid,
  ADD COLUMN authority_digest text,
  ADD CONSTRAINT ai_media_budget_reservations_authority_pair_ck CHECK (
    (authority_snapshot_id IS NULL)=(authority_digest IS NULL)
    AND (authority_digest IS NULL OR authority_digest ~ '^sha256:[0-9a-f]{64}$')
  ),
  ADD CONSTRAINT ai_media_budget_reservations_authority_snapshot_fk FOREIGN KEY
    (owner_user_id,workspace_id,authority_snapshot_id,daily_plan_slot_id,attempt,admission_digest,
      provider_account_id,provider_key,provider_credential_version,script_variant_checksum,authority_digest)
    REFERENCES ai_media_launch_authority_snapshots(owner_user_id,workspace_id,id,daily_plan_slot_id,slot_attempt,
      admission_digest,provider_account_id,provider_key,provider_credential_version,script_variant_checksum,authority_digest)
    ON UPDATE NO ACTION ON DELETE RESTRICT;

CREATE FUNCTION ai_media_reject_budget_reservation_authority_rewrite() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $body$
BEGIN
  IF NEW.authority_snapshot_id IS DISTINCT FROM OLD.authority_snapshot_id
    OR NEW.authority_digest IS DISTINCT FROM OLD.authority_digest THEN
    RAISE EXCEPTION 'budget reservation authority snapshot is immutable';
  END IF;
  RETURN NEW;
END;
$body$;
CREATE TRIGGER ai_media_budget_reservations_authority_immutable_guard
  BEFORE UPDATE ON ai_media_budget_reservations
  FOR EACH ROW EXECUTE FUNCTION ai_media_reject_budget_reservation_authority_rewrite();

CREATE FUNCTION ai_media_reject_launch_authority_rewrite() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $body$
BEGIN
  IF TG_OP='DELETE' THEN
    RAISE EXCEPTION 'launch authority evidence cannot be deleted';
  END IF;
  RAISE EXCEPTION 'launch authority evidence is append-only and cannot be updated';
END;
$body$;
CREATE TRIGGER ai_media_admission_policy_revisions_immutable_guard
  BEFORE UPDATE OR DELETE ON ai_media_admission_policy_revisions
  FOR EACH ROW EXECUTE FUNCTION ai_media_reject_launch_authority_rewrite();
CREATE TRIGGER ai_media_kill_switch_revisions_immutable_guard
  BEFORE UPDATE OR DELETE ON ai_media_kill_switch_revisions
  FOR EACH ROW EXECUTE FUNCTION ai_media_reject_launch_authority_rewrite();
CREATE TRIGGER ai_media_launch_evidence_immutable_guard
  BEFORE UPDATE OR DELETE ON ai_media_launch_evidence
  FOR EACH ROW EXECUTE FUNCTION ai_media_reject_launch_authority_rewrite();
CREATE TRIGGER ai_media_launch_authority_snapshots_immutable_guard
  BEFORE UPDATE OR DELETE ON ai_media_launch_authority_snapshots
  FOR EACH ROW EXECUTE FUNCTION ai_media_reject_launch_authority_rewrite();

COMMIT;
