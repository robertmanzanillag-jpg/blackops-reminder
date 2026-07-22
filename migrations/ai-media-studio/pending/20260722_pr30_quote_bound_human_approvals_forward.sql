-- AI Media Studio PR30: immutable, quote-bound human launch approvals.
-- Pending review artifact. Additive only; do not apply automatically.
-- Legacy human_launch_approval evidence intentionally remains unbound. There is no backfill.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='15min';
SET LOCAL search_path=public,pg_catalog;

DO $preflight$
BEGIN
  IF current_setting('server_version_num')::integer<160000 THEN
    RAISE EXCEPTION 'PR30 requires PostgreSQL 16 or newer';
  END IF;
  IF to_regclass('public.ai_media_static_credential_bindings') IS NULL
    OR to_regclass('public.ai_media_static_heygen_verification_headers') IS NULL
    OR to_regclass('public.ai_media_static_heygen_resource_verifications') IS NULL
    OR to_regclass('public.ai_media_launch_intents') IS NULL
    OR to_regclass('public.ai_media_launch_evidence') IS NULL
    OR to_regclass('public.ai_media_launch_evidence_exact_identity_uq') IS NULL
    OR to_regclass('public.ai_media_launch_evidence_previous_identity_uq') IS NULL
    OR to_regclass('public.ai_media_launch_evidence_snapshot_identity_uq') IS NULL
    OR to_regprocedure('public.ai_media_reject_launch_authority_rewrite()') IS NULL
    OR to_regclass('public.ai_media_quote_bound_human_approvals') IS NOT NULL
    OR to_regclass('public.ai_media_launch_evidence_human_quote_binding_identity_uq') IS NOT NULL
    OR to_regclass('public.ai_media_launch_evidence_maximum_quote_binding_identity_uq') IS NOT NULL THEN
    RAISE EXCEPTION 'PR30 requires the exact PR22/PR28/PR29 authority and verification schema and must not already be applied';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_attribute
    WHERE attrelid='public.ai_media_launch_evidence'::regclass
      AND attname IN ('daily_plan_slot_id','slot_attempt','launch_subject_digest','launch_intent_id',
        'launch_intent_digest','evidence_kind','decision','revision','evidence_digest')
      AND (attisdropped OR NOT attnotnull)
  ) OR (
    SELECT count(*) FROM pg_attribute
    WHERE attrelid='public.ai_media_launch_evidence'::regclass
      AND attname IN ('daily_plan_slot_id','slot_attempt','launch_subject_digest','launch_intent_id',
        'launch_intent_digest','evidence_kind','decision','amount_micro_usd','currency','revision',
        'expires_at','evidence_digest') AND NOT attisdropped
  )<>12 THEN
    RAISE EXCEPTION 'PR30 launch evidence identity columns do not match the reviewed schema';
  END IF;
END;
$preflight$;

LOCK TABLE ai_media_launch_evidence IN SHARE ROW EXCLUSIVE MODE;

-- These identities make the evidence kind, decision, amount, currency and expiry
-- part of the database-enforced reference. The existing immutable evidence row
-- remains the single source of truth.
CREATE UNIQUE INDEX ai_media_launch_evidence_human_quote_binding_identity_uq
  ON ai_media_launch_evidence(
    owner_user_id,workspace_id,id,daily_plan_slot_id,slot_attempt,launch_subject_digest,
    launch_intent_id,launch_intent_digest,evidence_kind,decision,revision,evidence_digest);

CREATE UNIQUE INDEX ai_media_launch_evidence_maximum_quote_binding_identity_uq
  ON ai_media_launch_evidence(
    owner_user_id,workspace_id,id,daily_plan_slot_id,slot_attempt,launch_subject_digest,
    launch_intent_id,launch_intent_digest,evidence_kind,decision,amount_micro_usd,currency,
    revision,expires_at,evidence_digest);

CREATE TABLE ai_media_quote_bound_human_approvals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id text NOT NULL,
  workspace_id text NOT NULL DEFAULT 'personal',
  daily_plan_slot_id uuid NOT NULL,
  slot_attempt integer NOT NULL,
  launch_subject_digest text NOT NULL,
  launch_intent_id uuid NOT NULL,
  launch_intent_digest text NOT NULL,
  human_launch_approval_evidence_id uuid NOT NULL,
  human_launch_approval_evidence_revision integer NOT NULL,
  human_launch_approval_evidence_digest text NOT NULL,
  human_evidence_kind text NOT NULL DEFAULT 'human_launch_approval',
  maximum_quote_evidence_id uuid NOT NULL,
  maximum_quote_evidence_revision integer NOT NULL,
  maximum_quote_evidence_digest text NOT NULL,
  maximum_quote_evidence_kind text NOT NULL DEFAULT 'maximum_quote',
  maximum_quote_decision text NOT NULL DEFAULT 'quoted',
  decision text NOT NULL,
  amount_micro_usd numeric(20,0) NOT NULL,
  currency text NOT NULL,
  quote_expires_at timestamptz NOT NULL,
  render_spec_digest text NOT NULL,
  approval_binding_digest text NOT NULL,
  input_digest text NOT NULL,
  idempotency_key text NOT NULL,
  bound_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  CONSTRAINT ai_media_quote_bound_human_approvals_ck CHECK (
    slot_attempt>=1
    AND launch_subject_digest ~ '^sha256:[0-9a-f]{64}$'
    AND launch_intent_digest ~ '^sha256:[0-9a-f]{64}$'
    AND human_launch_approval_evidence_revision>=1
    AND maximum_quote_evidence_revision>=1
    AND human_launch_approval_evidence_id<>maximum_quote_evidence_id
    AND human_launch_approval_evidence_digest ~ '^sha256:[0-9a-f]{64}$'
    AND maximum_quote_evidence_digest ~ '^sha256:[0-9a-f]{64}$'
    AND human_evidence_kind='human_launch_approval'
    AND maximum_quote_evidence_kind='maximum_quote'
    AND maximum_quote_decision='quoted'
    AND decision IN ('approved','rejected','revoked')
    AND amount_micro_usd BETWEEN 1 AND 9000000000000000
    AND currency='USD'
    AND quote_expires_at>bound_at
    AND render_spec_digest ~ '^sha256:[0-9a-f]{64}$'
    AND approval_binding_digest ~ '^sha256:[0-9a-f]{64}$'
    AND input_digest ~ '^sha256:[0-9a-f]{64}$'
    AND length(btrim(idempotency_key)) BETWEEN 8 AND 200
    AND created_at=bound_at
  ),
  CONSTRAINT ai_media_quote_bound_human_approvals_human_evidence_fk FOREIGN KEY (
    owner_user_id,workspace_id,human_launch_approval_evidence_id,daily_plan_slot_id,slot_attempt,
    launch_subject_digest,launch_intent_id,launch_intent_digest,human_evidence_kind,decision,
    human_launch_approval_evidence_revision,human_launch_approval_evidence_digest)
    REFERENCES ai_media_launch_evidence(
      owner_user_id,workspace_id,id,daily_plan_slot_id,slot_attempt,launch_subject_digest,
      launch_intent_id,launch_intent_digest,evidence_kind,decision,revision,evidence_digest)
    ON UPDATE NO ACTION ON DELETE RESTRICT,
  CONSTRAINT ai_media_quote_bound_human_approvals_quote_evidence_fk FOREIGN KEY (
    owner_user_id,workspace_id,maximum_quote_evidence_id,daily_plan_slot_id,slot_attempt,
    launch_subject_digest,launch_intent_id,launch_intent_digest,maximum_quote_evidence_kind,
    maximum_quote_decision,amount_micro_usd,currency,maximum_quote_evidence_revision,
    quote_expires_at,maximum_quote_evidence_digest)
    REFERENCES ai_media_launch_evidence(
      owner_user_id,workspace_id,id,daily_plan_slot_id,slot_attempt,launch_subject_digest,
      launch_intent_id,launch_intent_digest,evidence_kind,decision,amount_micro_usd,currency,
      revision,expires_at,evidence_digest)
    ON UPDATE NO ACTION ON DELETE RESTRICT
);

CREATE UNIQUE INDEX ai_media_quote_bound_human_approvals_idempotency_uq
  ON ai_media_quote_bound_human_approvals(owner_user_id,workspace_id,idempotency_key);
CREATE UNIQUE INDEX ai_media_quote_bound_human_approvals_binding_digest_uq
  ON ai_media_quote_bound_human_approvals(owner_user_id,workspace_id,approval_binding_digest);
CREATE UNIQUE INDEX ai_media_quote_bound_human_approvals_human_evidence_uq
  ON ai_media_quote_bound_human_approvals(
    owner_user_id,workspace_id,human_launch_approval_evidence_id,
    human_launch_approval_evidence_revision,human_launch_approval_evidence_digest);
CREATE INDEX ai_media_quote_bound_human_approvals_slot_attempt_idx
  ON ai_media_quote_bound_human_approvals(
    owner_user_id,workspace_id,daily_plan_slot_id,slot_attempt,bound_at DESC);
CREATE INDEX ai_media_quote_bound_human_approvals_quote_idx
  ON ai_media_quote_bound_human_approvals(
    owner_user_id,workspace_id,maximum_quote_evidence_id,maximum_quote_evidence_revision);

CREATE FUNCTION ai_media_quote_bound_human_approvals_append_only_v1() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $append_only$
BEGIN
  RAISE EXCEPTION 'quote-bound human approval evidence is append-only';
END;
$append_only$;
REVOKE ALL ON FUNCTION ai_media_quote_bound_human_approvals_append_only_v1() FROM PUBLIC;

CREATE TRIGGER ai_media_quote_bound_human_approvals_immutable_guard
  BEFORE UPDATE OR DELETE ON ai_media_quote_bound_human_approvals
  FOR EACH ROW EXECUTE FUNCTION ai_media_quote_bound_human_approvals_append_only_v1();
CREATE TRIGGER ai_media_quote_bound_human_approvals_truncate_guard
  BEFORE TRUNCATE ON ai_media_quote_bound_human_approvals
  FOR EACH STATEMENT EXECUTE FUNCTION ai_media_quote_bound_human_approvals_append_only_v1();

COMMIT;
