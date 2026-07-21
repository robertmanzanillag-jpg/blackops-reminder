-- AI Media Studio PR22: immutable launch intents bound to exact launch authority inputs.
-- Reviewed, additive/data-preserving migration. Do not apply automatically.
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
    ('ai_media_budget_reservations'),
    ('ai_media_scripts'),
    ('ai_media_script_variants'),
    ('ai_media_source_items'),
    ('ai_media_governance_profiles'),
    ('ai_media_launch_evidence'),
    ('ai_media_launch_authority_snapshots')
  ) required(name)
  WHERE to_regclass('public.' || required.name) IS NULL
  LIMIT 1;
  IF missing_relation IS NOT NULL THEN
    RAISE EXCEPTION 'PR22 requires PR19/PR20 relation %', missing_relation;
  END IF;
  IF to_regclass('public.ai_media_daily_plans_authority_identity_uq') IS NULL
    OR to_regclass('public.ai_media_daily_plan_slots_authority_identity_uq') IS NULL
    OR to_regclass('public.ai_media_script_variants_authority_identity_uq') IS NULL
    OR to_regclass('public.ai_media_governance_profiles_authority_identity_uq') IS NULL
    OR to_regclass('public.ai_media_launch_evidence_snapshot_identity_uq') IS NULL
    OR to_regclass('public.ai_media_launch_authority_snapshots_exact_identity_uq') IS NULL
    OR to_regprocedure('public.ai_media_reject_launch_authority_rewrite()') IS NULL
    OR to_regprocedure('public.ai_media_reject_budget_reservation_authority_rewrite()') IS NULL THEN
    RAISE EXCEPTION 'PR22 requires validated PR19/PR20 admission and immutable authority controls';
  END IF;
  IF to_regclass('public.ai_media_launch_intents') IS NOT NULL
    OR to_regprocedure('public.ai_media_reject_launch_intent_rewrite()') IS NOT NULL
    OR EXISTS (
      SELECT 1 FROM pg_attribute
      WHERE attrelid IN ('public.ai_media_launch_evidence'::regclass,
        'public.ai_media_launch_authority_snapshots'::regclass)
        AND attname IN ('launch_intent_id','launch_intent_digest','source_attestation_id','source_evidence_digest')
        AND NOT attisdropped
    ) THEN
    RAISE EXCEPTION 'PR22 requires launch-intent objects and authority columns to be absent';
  END IF;
END;
$preflight$;

LOCK TABLE ai_media_launch_evidence, ai_media_launch_authority_snapshots,
  ai_media_budget_reservations IN ACCESS EXCLUSIVE MODE;

DO $empty_authority_preflight$
BEGIN
  IF EXISTS (SELECT 1 FROM ai_media_launch_evidence LIMIT 1)
    OR EXISTS (SELECT 1 FROM ai_media_launch_authority_snapshots LIMIT 1)
    OR EXISTS (SELECT 1 FROM ai_media_budget_reservations LIMIT 1) THEN
    RAISE EXCEPTION 'PR22 refuses to fabricate launch intent authority: evidence, snapshots, and reservations must be empty';
  END IF;
END;
$empty_authority_preflight$;

CREATE UNIQUE INDEX ai_media_daily_plans_launch_intent_identity_uq
  ON ai_media_daily_plans(owner_user_id,workspace_id,id,provider_account_id,provider_key,
    provider_credential_version,source_roster_key,source_roster_digest,plan_digest);
CREATE UNIQUE INDEX ai_media_daily_plan_slots_launch_intent_identity_uq
  ON ai_media_daily_plan_slots(owner_user_id,workspace_id,id,daily_plan_id,provider_account_id,provider_key,
    provider_credential_version,source_member_key,script_variant_id,slot_digest);
CREATE UNIQUE INDEX ai_media_scripts_launch_intent_identity_uq
  ON ai_media_scripts(owner_user_id,workspace_id,id,source_type);
CREATE UNIQUE INDEX ai_media_scripts_launch_source_identity_uq
  ON ai_media_scripts(owner_user_id,workspace_id,id,source_type,source_item_id);
CREATE UNIQUE INDEX ai_media_script_variants_launch_intent_identity_uq
  ON ai_media_script_variants(owner_user_id,workspace_id,id,script_id,checksum);
CREATE UNIQUE INDEX ai_media_source_items_launch_intent_identity_uq
  ON ai_media_source_items(owner_user_id,workspace_id,id,source_type);

CREATE TABLE ai_media_launch_intents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id text NOT NULL,
  workspace_id text NOT NULL DEFAULT 'personal',
  daily_plan_id uuid NOT NULL,
  daily_plan_slot_id uuid NOT NULL,
  slot_attempt integer NOT NULL,
  provider_account_id uuid NOT NULL,
  provider_key text NOT NULL,
  provider_credential_version integer NOT NULL,
  plan_digest text NOT NULL,
  slot_digest text NOT NULL,
  source_roster_key text NOT NULL,
  source_roster_digest text NOT NULL,
  source_member_key text NOT NULL,
  script_id uuid NOT NULL,
  script_variant_id uuid NOT NULL,
  script_variant_checksum text NOT NULL,
  source_type text NOT NULL,
  source_item_id uuid,
  source_content_hash text,
  governance_profile_id uuid NOT NULL,
  governance_evidence_digest text NOT NULL,
  governance_use text NOT NULL,
  governance_territory text NOT NULL,
  content_country text NOT NULL,
  launch_subject_digest text NOT NULL,
  launch_intent_digest text NOT NULL,
  actor_user_id text NOT NULL,
  input_digest text NOT NULL,
  idempotency_key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  CONSTRAINT ai_media_launch_intents_ck CHECK (
    slot_attempt>=1 AND provider_credential_version>=1
    AND plan_digest ~ '^sha256:[0-9a-f]{64}$' AND slot_digest ~ '^sha256:[0-9a-f]{64}$'
    AND source_roster_digest ~ '^sha256:[0-9a-f]{64}$'
    AND length(btrim(source_roster_key)) BETWEEN 1 AND 200
    AND length(btrim(source_member_key)) BETWEEN 1 AND 200
    AND script_variant_checksum ~ '^[0-9a-f]{64}$'
    AND length(btrim(source_type)) BETWEEN 1 AND 80
    AND ((source_type='manual' AND source_item_id IS NULL AND source_content_hash IS NULL)
      OR (source_type<>'manual' AND source_item_id IS NOT NULL
        AND source_content_hash ~ '^sha256:[0-9a-f]{64}$'))
    AND governance_evidence_digest ~ '^sha256:[0-9a-f]{64}$'
    AND length(btrim(governance_use)) BETWEEN 1 AND 80
    AND length(btrim(governance_territory)) BETWEEN 1 AND 80
    AND content_country ~ '^[A-Z]{2}$'
    AND launch_subject_digest ~ '^sha256:[0-9a-f]{64}$'
    AND launch_intent_digest ~ '^sha256:[0-9a-f]{64}$'
    AND input_digest ~ '^sha256:[0-9a-f]{64}$'
    AND length(btrim(actor_user_id)) BETWEEN 1 AND 200
    AND length(btrim(idempotency_key)) BETWEEN 8 AND 200
  ),
  CONSTRAINT ai_media_launch_intents_exact_plan_fk FOREIGN KEY
    (owner_user_id,workspace_id,daily_plan_id,provider_account_id,provider_key,
      provider_credential_version,source_roster_key,source_roster_digest,plan_digest)
    REFERENCES ai_media_daily_plans(owner_user_id,workspace_id,id,provider_account_id,provider_key,
      provider_credential_version,source_roster_key,source_roster_digest,plan_digest)
    ON UPDATE NO ACTION ON DELETE RESTRICT,
  CONSTRAINT ai_media_launch_intents_exact_slot_fk FOREIGN KEY
    (owner_user_id,workspace_id,daily_plan_slot_id,daily_plan_id,provider_account_id,provider_key,
      provider_credential_version,source_member_key,script_variant_id,slot_digest)
    REFERENCES ai_media_daily_plan_slots(owner_user_id,workspace_id,id,daily_plan_id,provider_account_id,provider_key,
      provider_credential_version,source_member_key,script_variant_id,slot_digest)
    ON UPDATE NO ACTION ON DELETE RESTRICT,
  CONSTRAINT ai_media_launch_intents_script_fk FOREIGN KEY
    (owner_user_id,workspace_id,script_id,source_type)
    REFERENCES ai_media_scripts(owner_user_id,workspace_id,id,source_type)
    ON UPDATE NO ACTION ON DELETE RESTRICT,
  CONSTRAINT ai_media_launch_intents_script_source_fk FOREIGN KEY
    (owner_user_id,workspace_id,script_id,source_type,source_item_id)
    REFERENCES ai_media_scripts(owner_user_id,workspace_id,id,source_type,source_item_id)
    ON UPDATE NO ACTION ON DELETE RESTRICT,
  CONSTRAINT ai_media_launch_intents_script_variant_fk FOREIGN KEY
    (owner_user_id,workspace_id,script_variant_id,script_id,script_variant_checksum)
    REFERENCES ai_media_script_variants(owner_user_id,workspace_id,id,script_id,checksum)
    ON UPDATE NO ACTION ON DELETE RESTRICT,
  CONSTRAINT ai_media_launch_intents_source_item_fk FOREIGN KEY
    (owner_user_id,workspace_id,source_item_id,source_type)
    REFERENCES ai_media_source_items(owner_user_id,workspace_id,id,source_type)
    ON UPDATE NO ACTION ON DELETE RESTRICT,
  CONSTRAINT ai_media_launch_intents_governance_fk FOREIGN KEY
    (owner_user_id,workspace_id,governance_profile_id,governance_evidence_digest)
    REFERENCES ai_media_governance_profiles(owner_user_id,workspace_id,id,evidence_digest)
    ON UPDATE NO ACTION ON DELETE RESTRICT
);
CREATE UNIQUE INDEX ai_media_launch_intents_slot_attempt_uq
  ON ai_media_launch_intents(owner_user_id,workspace_id,daily_plan_slot_id,slot_attempt);
CREATE UNIQUE INDEX ai_media_launch_intents_idempotency_uq
  ON ai_media_launch_intents(owner_user_id,workspace_id,idempotency_key);
CREATE UNIQUE INDEX ai_media_launch_intents_exact_identity_uq
  ON ai_media_launch_intents(owner_user_id,workspace_id,id,daily_plan_id,daily_plan_slot_id,slot_attempt,
    provider_account_id,provider_key,provider_credential_version,plan_digest,slot_digest,
    script_id,script_variant_id,script_variant_checksum,governance_profile_id,governance_evidence_digest,
    governance_use,governance_territory,content_country,launch_subject_digest,launch_intent_digest);
CREATE UNIQUE INDEX ai_media_launch_intents_evidence_identity_uq
  ON ai_media_launch_intents(owner_user_id,workspace_id,id,daily_plan_slot_id,slot_attempt,
    provider_account_id,provider_key,provider_credential_version,script_variant_id,script_variant_checksum,
    governance_profile_id,governance_evidence_digest,governance_use,governance_territory,content_country,
    launch_subject_digest,launch_intent_digest);
CREATE UNIQUE INDEX ai_media_launch_intents_snapshot_identity_uq
  ON ai_media_launch_intents(owner_user_id,workspace_id,id,daily_plan_id,daily_plan_slot_id,slot_attempt,
    provider_account_id,provider_key,provider_credential_version,plan_digest,slot_digest,script_variant_id,
    script_variant_checksum,governance_profile_id,governance_evidence_digest,governance_use,
    governance_territory,content_country,launch_subject_digest,launch_intent_digest);

ALTER TABLE ai_media_launch_evidence
  ADD COLUMN launch_intent_id uuid NOT NULL,
  ADD COLUMN launch_intent_digest text NOT NULL,
  ADD COLUMN source_attestation_id text,
  ADD COLUMN source_evidence_digest text,
  ADD CONSTRAINT ai_media_launch_evidence_source_attestation_ck CHECK (
    ((evidence_kind IN ('sandbox_proof','maximum_quote')
      AND source_attestation_id IS NOT NULL AND source_evidence_digest IS NOT NULL
      AND source_attestation_id ~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{7,199}$'
      AND source_evidence_digest ~ '^sha256:[0-9a-f]{64}$')
    OR (evidence_kind IN ('content_approval','human_launch_approval')
      AND source_attestation_id IS NULL AND source_evidence_digest IS NULL))
  );
ALTER TABLE ai_media_launch_authority_snapshots
  ADD COLUMN launch_intent_id uuid NOT NULL,
  ADD COLUMN launch_intent_digest text NOT NULL;

ALTER TABLE ai_media_launch_authority_snapshots
  DROP CONSTRAINT ai_media_launch_authority_snapshots_content_evidence_fk,
  DROP CONSTRAINT ai_media_launch_authority_snapshots_human_evidence_fk,
  DROP CONSTRAINT ai_media_launch_authority_snapshots_sandbox_evidence_fk,
  DROP CONSTRAINT ai_media_launch_authority_snapshots_quote_evidence_fk;
ALTER TABLE ai_media_budget_reservations
  DROP CONSTRAINT ai_media_budget_reservations_authority_snapshot_fk;
DROP INDEX ai_media_launch_evidence_exact_identity_uq;
DROP INDEX ai_media_launch_evidence_snapshot_identity_uq;
DROP INDEX ai_media_launch_authority_snapshots_exact_identity_uq;

CREATE UNIQUE INDEX ai_media_launch_evidence_exact_identity_uq
  ON ai_media_launch_evidence(owner_user_id,workspace_id,id,revision,launch_intent_id,
    launch_intent_digest,evidence_digest);
CREATE UNIQUE INDEX ai_media_launch_evidence_snapshot_identity_uq
  ON ai_media_launch_evidence(owner_user_id,workspace_id,id,daily_plan_slot_id,slot_attempt,
    provider_account_id,provider_key,provider_credential_version,script_variant_id,script_variant_checksum,
    governance_profile_id,governance_evidence_digest,governance_use,governance_territory,content_country,
    launch_subject_digest,launch_intent_id,launch_intent_digest,evidence_digest);
CREATE UNIQUE INDEX ai_media_launch_authority_snapshots_exact_identity_uq
  ON ai_media_launch_authority_snapshots(owner_user_id,workspace_id,id,daily_plan_slot_id,slot_attempt,
    admission_digest,provider_account_id,provider_key,provider_credential_version,script_variant_checksum,
    launch_intent_id,launch_intent_digest,authority_digest);
CREATE UNIQUE INDEX ai_media_launch_authority_snapshots_reservation_identity_uq
  ON ai_media_launch_authority_snapshots(owner_user_id,workspace_id,id,daily_plan_slot_id,slot_attempt,
    admission_digest,provider_account_id,provider_key,provider_credential_version,script_variant_checksum,
    authority_digest);

ALTER TABLE ai_media_launch_evidence ADD CONSTRAINT ai_media_launch_evidence_launch_intent_fk FOREIGN KEY
  (owner_user_id,workspace_id,launch_intent_id,daily_plan_slot_id,slot_attempt,provider_account_id,
    provider_key,provider_credential_version,script_variant_id,script_variant_checksum,governance_profile_id,
    governance_evidence_digest,governance_use,governance_territory,content_country,launch_subject_digest,
    launch_intent_digest)
  REFERENCES ai_media_launch_intents(owner_user_id,workspace_id,id,daily_plan_slot_id,slot_attempt,
    provider_account_id,provider_key,provider_credential_version,script_variant_id,script_variant_checksum,
    governance_profile_id,governance_evidence_digest,governance_use,governance_territory,content_country,
    launch_subject_digest,launch_intent_digest) ON UPDATE NO ACTION ON DELETE RESTRICT;
ALTER TABLE ai_media_launch_authority_snapshots ADD CONSTRAINT ai_media_launch_authority_snapshots_launch_intent_fk
  FOREIGN KEY (owner_user_id,workspace_id,launch_intent_id,daily_plan_id,daily_plan_slot_id,slot_attempt,
    provider_account_id,provider_key,provider_credential_version,plan_digest,slot_digest,script_variant_id,
    script_variant_checksum,governance_profile_id,governance_evidence_digest,governance_use,
    governance_territory,content_country,launch_subject_digest,launch_intent_digest)
  REFERENCES ai_media_launch_intents(owner_user_id,workspace_id,id,daily_plan_id,daily_plan_slot_id,slot_attempt,
    provider_account_id,provider_key,provider_credential_version,plan_digest,slot_digest,script_variant_id,
    script_variant_checksum,governance_profile_id,governance_evidence_digest,governance_use,
    governance_territory,content_country,launch_subject_digest,launch_intent_digest)
  ON UPDATE NO ACTION ON DELETE RESTRICT;

ALTER TABLE ai_media_launch_authority_snapshots ADD CONSTRAINT ai_media_launch_authority_snapshots_content_evidence_fk
  FOREIGN KEY (owner_user_id,workspace_id,content_approval_evidence_id,daily_plan_slot_id,slot_attempt,
    provider_account_id,provider_key,provider_credential_version,script_variant_id,script_variant_checksum,
    governance_profile_id,governance_evidence_digest,governance_use,governance_territory,content_country,
    launch_subject_digest,launch_intent_id,launch_intent_digest,content_approval_evidence_digest)
  REFERENCES ai_media_launch_evidence(owner_user_id,workspace_id,id,daily_plan_slot_id,slot_attempt,
    provider_account_id,provider_key,provider_credential_version,script_variant_id,script_variant_checksum,
    governance_profile_id,governance_evidence_digest,governance_use,governance_territory,content_country,
    launch_subject_digest,launch_intent_id,launch_intent_digest,evidence_digest) ON DELETE RESTRICT;
ALTER TABLE ai_media_launch_authority_snapshots ADD CONSTRAINT ai_media_launch_authority_snapshots_human_evidence_fk
  FOREIGN KEY (owner_user_id,workspace_id,human_launch_approval_evidence_id,daily_plan_slot_id,slot_attempt,
    provider_account_id,provider_key,provider_credential_version,script_variant_id,script_variant_checksum,
    governance_profile_id,governance_evidence_digest,governance_use,governance_territory,content_country,
    launch_subject_digest,launch_intent_id,launch_intent_digest,human_launch_approval_evidence_digest)
  REFERENCES ai_media_launch_evidence(owner_user_id,workspace_id,id,daily_plan_slot_id,slot_attempt,
    provider_account_id,provider_key,provider_credential_version,script_variant_id,script_variant_checksum,
    governance_profile_id,governance_evidence_digest,governance_use,governance_territory,content_country,
    launch_subject_digest,launch_intent_id,launch_intent_digest,evidence_digest) ON DELETE RESTRICT;
ALTER TABLE ai_media_launch_authority_snapshots ADD CONSTRAINT ai_media_launch_authority_snapshots_sandbox_evidence_fk
  FOREIGN KEY (owner_user_id,workspace_id,sandbox_evidence_id,daily_plan_slot_id,slot_attempt,
    provider_account_id,provider_key,provider_credential_version,script_variant_id,script_variant_checksum,
    governance_profile_id,governance_evidence_digest,governance_use,governance_territory,content_country,
    launch_subject_digest,launch_intent_id,launch_intent_digest,sandbox_evidence_digest)
  REFERENCES ai_media_launch_evidence(owner_user_id,workspace_id,id,daily_plan_slot_id,slot_attempt,
    provider_account_id,provider_key,provider_credential_version,script_variant_id,script_variant_checksum,
    governance_profile_id,governance_evidence_digest,governance_use,governance_territory,content_country,
    launch_subject_digest,launch_intent_id,launch_intent_digest,evidence_digest) ON DELETE RESTRICT;
ALTER TABLE ai_media_launch_authority_snapshots ADD CONSTRAINT ai_media_launch_authority_snapshots_quote_evidence_fk
  FOREIGN KEY (owner_user_id,workspace_id,maximum_quote_evidence_id,daily_plan_slot_id,slot_attempt,
    provider_account_id,provider_key,provider_credential_version,script_variant_id,script_variant_checksum,
    governance_profile_id,governance_evidence_digest,governance_use,governance_territory,content_country,
    launch_subject_digest,launch_intent_id,launch_intent_digest,maximum_quote_evidence_digest)
  REFERENCES ai_media_launch_evidence(owner_user_id,workspace_id,id,daily_plan_slot_id,slot_attempt,
    provider_account_id,provider_key,provider_credential_version,script_variant_id,script_variant_checksum,
    governance_profile_id,governance_evidence_digest,governance_use,governance_territory,content_country,
    launch_subject_digest,launch_intent_id,launch_intent_digest,evidence_digest) ON DELETE RESTRICT;

ALTER TABLE ai_media_budget_reservations ADD CONSTRAINT ai_media_budget_reservations_authority_snapshot_fk
  FOREIGN KEY (owner_user_id,workspace_id,authority_snapshot_id,daily_plan_slot_id,attempt,admission_digest,
    provider_account_id,provider_key,provider_credential_version,script_variant_checksum,authority_digest)
  REFERENCES ai_media_launch_authority_snapshots(owner_user_id,workspace_id,id,daily_plan_slot_id,slot_attempt,
    admission_digest,provider_account_id,provider_key,provider_credential_version,script_variant_checksum,
    authority_digest) ON UPDATE NO ACTION ON DELETE RESTRICT;

CREATE FUNCTION ai_media_reject_launch_intent_rewrite() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'launch intents are append-only and cannot be deleted'; END IF;
  RAISE EXCEPTION 'launch intents are immutable; issue a new slot attempt';
END;
$guard$;
CREATE TRIGGER ai_media_launch_intents_immutable_guard
  BEFORE UPDATE OR DELETE ON ai_media_launch_intents
  FOR EACH ROW EXECUTE FUNCTION ai_media_reject_launch_intent_rewrite();

COMMIT;
