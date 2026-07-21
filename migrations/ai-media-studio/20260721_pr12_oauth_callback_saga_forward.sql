-- AI Media Studio PR12: durable, callback-safe OAuth authorization saga.
-- Reviewed, additive/data-preserving migration. Do not apply automatically.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15min';
SET LOCAL search_path = public, pg_catalog;

DO $preflight$
DECLARE missing_column text;
BEGIN
  IF to_regclass('public.ai_media_oauth_sessions') IS NULL OR to_regclass('public.ai_media_provider_accounts') IS NULL THEN
    RAISE EXCEPTION 'PR12 OAuth saga requires PR11 sessions and provider accounts';
  END IF;
  SELECT requirement.column_name INTO missing_column
  FROM (VALUES ('id'),('owner_user_id'),('workspace_id'),('actor_user_id'),('provider_account_id'),
    ('platform'),('state_digest'),('pkce_mode'),('pkce_verifier_ref'),('status'),('outcome'),('expires_at'),('consumed_at')) requirement(column_name)
  WHERE NOT EXISTS (SELECT 1 FROM information_schema.columns columns
    WHERE columns.table_schema='public' AND columns.table_name='ai_media_oauth_sessions'
      AND columns.column_name=requirement.column_name) LIMIT 1;
  IF missing_column IS NOT NULL THEN RAISE EXCEPTION 'PR12 requires PR11 session column %', missing_column; END IF;

  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='ai_media_oauth_sessions'
    AND column_name IN ('exchange_status','lease_token','lease_owner','lease_expires_at','lease_fencing','authorization_code_digest',
      'authorization_code_ref','expected_credential_version','target_credential_version','token_binding_id','failure_code')) THEN
    RAISE EXCEPTION 'PR12 requires all saga columns to be absent';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='ai_media_provider_accounts'
    AND column_name IN ('credential_source','credential_actor_user_id','credential_source_session_id','token_binding_id','token_kind','token_manifest_revision')) THEN
    RAISE EXCEPTION 'PR12 requires all OAuth credential provenance columns to be absent';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid IN ('public.ai_media_oauth_sessions'::regclass,'public.ai_media_provider_accounts'::regclass)
    AND conname IN ('ai_media_oauth_sessions_exchange_status_ck','ai_media_oauth_sessions_authorization_saga_ck',
      'ai_media_provider_accounts_oauth_credential_provenance_ck','ai_media_provider_accounts_oauth_source_session_fk')) THEN
    RAISE EXCEPTION 'PR12 requires new saga constraints to be absent';
  END IF;
  IF EXISTS (SELECT 1 FROM (VALUES ('ai_media_oauth_sessions_pkce_ck'),('ai_media_oauth_sessions_redirect_ck'),
      ('ai_media_oauth_sessions_redirect_trusted_ck'),('ai_media_oauth_sessions_status_ck'),('ai_media_oauth_sessions_lifecycle_ck')) required(conname)
    WHERE NOT EXISTS (SELECT 1 FROM pg_constraint c WHERE c.conrelid='public.ai_media_oauth_sessions'::regclass
      AND c.conname=required.conname AND c.convalidated)) THEN
    RAISE EXCEPTION 'PR12 requires every validated PR11 OAuth control';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.ai_media_provider_accounts'::regclass
      AND conname='ai_media_provider_accounts_credential_metadata_ck' AND convalidated)
    OR NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.ai_media_oauth_sessions'::regclass
      AND conname='ai_media_oauth_sessions_provider_account_tenant_platform_fk' AND convalidated) THEN
    RAISE EXCEPTION 'PR12 requires validated provider credential and exact account binding controls';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_index indexes
      JOIN pg_class index_relation ON index_relation.oid=indexes.indexrelid
      JOIN pg_class table_relation ON table_relation.oid=indexes.indrelid
      JOIN pg_namespace namespace ON namespace.oid=table_relation.relnamespace
      WHERE namespace.nspname='public' AND table_relation.relname='ai_media_oauth_sessions'
        AND index_relation.relname='ai_media_oauth_sessions_state_digest_uq' AND indexes.indisunique AND indexes.indisvalid)
    OR NOT EXISTS (SELECT 1 FROM pg_index indexes
      JOIN pg_class index_relation ON index_relation.oid=indexes.indexrelid
      JOIN pg_class table_relation ON table_relation.oid=indexes.indrelid
      JOIN pg_namespace namespace ON namespace.oid=table_relation.relnamespace
      WHERE namespace.nspname='public' AND table_relation.relname='ai_media_provider_accounts'
        AND index_relation.relname='ai_media_provider_accounts_owner_workspace_id_provider_uq' AND indexes.indisunique AND indexes.indisvalid) THEN
    RAISE EXCEPTION 'PR12 requires valid unique state and provider-account identity indexes';
  END IF;
  IF to_regclass('public.ai_media_oauth_sessions_recovery_idx') IS NOT NULL
    OR to_regclass('public.ai_media_oauth_sessions_authorization_code_ref_uq') IS NOT NULL
    OR to_regclass('public.ai_media_oauth_sessions_token_binding_uq') IS NOT NULL
    OR to_regclass('public.ai_media_oauth_sessions_provider_account_authorization_source_uq') IS NOT NULL
    OR to_regclass('public.ai_media_provider_accounts_oauth_token_binding_uq') IS NOT NULL
    OR to_regclass('public.ai_media_provider_accounts_oauth_secret_ref_uq') IS NOT NULL THEN
    RAISE EXCEPTION 'PR12 requires new saga indexes to be absent';
  END IF;
END;
$preflight$;

ALTER TABLE ai_media_provider_accounts
  ADD COLUMN credential_source text,
  ADD COLUMN credential_actor_user_id text,
  ADD COLUMN credential_source_session_id uuid,
  ADD COLUMN token_binding_id uuid,
  ADD COLUMN token_kind text,
  ADD COLUMN token_manifest_revision text;

UPDATE ai_media_provider_accounts
SET credential_source = CASE
  WHEN secret_ref IS NOT NULL OR credential_version > 0 THEN 'legacy_authorized_unbound'
  ELSE 'not_bound'
END
WHERE credential_source IS NULL;

ALTER TABLE ai_media_provider_accounts ALTER COLUMN credential_source SET NOT NULL;
ALTER TABLE ai_media_provider_accounts ALTER COLUMN credential_source SET DEFAULT 'not_bound';

ALTER TABLE ai_media_oauth_sessions
  ADD COLUMN exchange_status text,
  ADD COLUMN lease_token uuid,
  ADD COLUMN lease_owner text,
  ADD COLUMN lease_expires_at timestamptz,
  ADD COLUMN lease_fencing integer,
  ADD COLUMN authorization_code_digest text,
  ADD COLUMN authorization_code_ref text,
  ADD COLUMN expected_credential_version integer,
  ADD COLUMN target_credential_version integer,
  ADD COLUMN token_binding_id uuid,
  ADD COLUMN failure_code text;

-- Preserve explicit legacy authorization evidence without inventing a token binding.
UPDATE ai_media_oauth_sessions
SET exchange_status = CASE
    WHEN status='consumed' AND outcome='authorized' THEN 'legacy_authorized_unbound'
    WHEN status='consumed' AND outcome IN ('denied','error') THEN 'not_required'
    ELSE 'not_started'
  END,
  lease_fencing = 0
WHERE exchange_status IS NULL OR lease_fencing IS NULL;

ALTER TABLE ai_media_oauth_sessions
  ALTER COLUMN exchange_status SET NOT NULL,
  ALTER COLUMN exchange_status SET DEFAULT 'not_started',
  ALTER COLUMN lease_fencing SET NOT NULL,
  ALTER COLUMN lease_fencing SET DEFAULT 0;

ALTER TABLE ai_media_oauth_sessions DROP CONSTRAINT ai_media_oauth_sessions_status_ck;
ALTER TABLE ai_media_oauth_sessions ADD CONSTRAINT ai_media_oauth_sessions_status_ck
  CHECK (status IN ('pending','processing','consumed')) NOT VALID;
ALTER TABLE ai_media_oauth_sessions VALIDATE CONSTRAINT ai_media_oauth_sessions_status_ck;

ALTER TABLE ai_media_oauth_sessions ADD CONSTRAINT ai_media_oauth_sessions_exchange_status_ck CHECK (
  exchange_status IN ('not_started','ready','in_progress','succeeded','not_required','failed','indeterminate','legacy_authorized_unbound')
) NOT VALID;

ALTER TABLE ai_media_oauth_sessions ADD CONSTRAINT ai_media_oauth_sessions_authorization_saga_ck CHECK (
  lease_fencing >= 0
  AND ((lease_token IS NULL) = (lease_owner IS NULL))
  AND ((lease_token IS NULL) = (lease_expires_at IS NULL))
  AND (lease_token IS NULL OR (length(btrim(lease_owner)) BETWEEN 1 AND 255 AND lease_expires_at > updated_at
    AND lease_expires_at <= updated_at + interval '5 minutes'))
  AND (authorization_code_digest IS NULL OR authorization_code_digest ~ '^[0-9a-f]{64}$')
  AND (authorization_code_ref IS NULL OR authorization_code_ref ~ '^vault://ai-media-studio/oauth-code/v1/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$')
  AND ((expected_credential_version IS NULL) = (target_credential_version IS NULL))
  AND (expected_credential_version IS NULL OR expected_credential_version >= 0)
  AND (target_credential_version IS NULL OR target_credential_version = expected_credential_version + 1)
  AND ((authorization_code_digest IS NULL) = (token_binding_id IS NULL))
  AND (failure_code IS NULL OR failure_code IN ('provider_rejected','vault_unavailable','candidate_missing','credential_conflict','identity_conflict','invalid_provider_result'))
  AND (status <> 'pending' OR (exchange_status='not_started' AND lease_token IS NULL AND authorization_code_digest IS NULL))
  AND (status <> 'processing' OR (exchange_status IN ('not_started','ready','in_progress','indeterminate')
    AND authorization_code_digest IS NOT NULL AND token_binding_id IS NOT NULL AND expected_credential_version IS NOT NULL))
  AND (status <> 'processing' OR exchange_status='indeterminate' OR lease_token IS NOT NULL)
  AND (status <> 'consumed' OR lease_token IS NULL)
  AND (exchange_status <> 'ready' OR authorization_code_ref IS NOT NULL)
  AND (exchange_status <> 'in_progress' OR authorization_code_ref IS NOT NULL)
  AND (exchange_status <> 'succeeded' OR (status='consumed' AND outcome='authorized'))
  AND (exchange_status <> 'not_required' OR (status='consumed' AND outcome IN ('denied','error') AND authorization_code_digest IS NULL))
  AND (exchange_status NOT IN ('indeterminate','failed') OR (status='processing' AND lease_token IS NULL AND failure_code IS NOT NULL))
  AND (outcome <> 'authorized' OR exchange_status IN ('succeeded','legacy_authorized_unbound'))
  AND (outcome NOT IN ('denied','error') OR exchange_status='not_required')
  AND (exchange_status <> 'legacy_authorized_unbound' OR (status='consumed' AND outcome='authorized' AND token_binding_id IS NULL))
) NOT VALID;

ALTER TABLE ai_media_oauth_sessions VALIDATE CONSTRAINT ai_media_oauth_sessions_exchange_status_ck;
ALTER TABLE ai_media_oauth_sessions VALIDATE CONSTRAINT ai_media_oauth_sessions_authorization_saga_ck;

ALTER TABLE ai_media_provider_accounts ADD CONSTRAINT ai_media_provider_accounts_oauth_credential_provenance_ck CHECK (
  (credential_source='not_bound' AND secret_ref IS NULL AND credential_version=0 AND credential_actor_user_id IS NULL
    AND credential_source_session_id IS NULL AND token_binding_id IS NULL AND token_kind IS NULL AND token_manifest_revision IS NULL)
  OR (credential_source='legacy_authorized_unbound' AND credential_actor_user_id IS NULL
    AND credential_source_session_id IS NULL AND token_binding_id IS NULL AND token_kind IS NULL AND token_manifest_revision IS NULL)
  OR (credential_source='oauth_authorization' AND status='active' AND credential_status='active'
    AND credential_version > 0 AND credential_actor_user_id IS NOT NULL AND credential_source_session_id IS NOT NULL
    AND external_account_id IS NOT NULL AND length(btrim(external_account_id)) BETWEEN 1 AND 255
    AND secret_ref ~ '^vault://ai-media-studio/oauth-token/v1/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    AND token_binding_id IS NOT NULL AND token_kind='Bearer' AND credential_expires_at IS NOT NULL
    AND capabilities @> '["publish_video"]'::jsonb AND jsonb_array_length(granted_scopes) > 0
    AND length(btrim(token_manifest_revision)) BETWEEN 1 AND 100)
) NOT VALID;
ALTER TABLE ai_media_provider_accounts VALIDATE CONSTRAINT ai_media_provider_accounts_oauth_credential_provenance_ck;

CREATE INDEX ai_media_oauth_sessions_recovery_idx
  ON ai_media_oauth_sessions (exchange_status, lease_expires_at)
  WHERE status='processing';

CREATE UNIQUE INDEX ai_media_oauth_sessions_authorization_code_ref_uq
  ON ai_media_oauth_sessions (authorization_code_ref) WHERE authorization_code_ref IS NOT NULL;
CREATE UNIQUE INDEX ai_media_oauth_sessions_token_binding_uq
  ON ai_media_oauth_sessions (token_binding_id) WHERE token_binding_id IS NOT NULL;
CREATE UNIQUE INDEX ai_media_oauth_sessions_provider_account_authorization_source_uq
  ON ai_media_oauth_sessions (owner_user_id,workspace_id,actor_user_id,provider_account_id,platform,id);
CREATE UNIQUE INDEX ai_media_provider_accounts_oauth_token_binding_uq
  ON ai_media_provider_accounts (token_binding_id) WHERE credential_source='oauth_authorization';
CREATE UNIQUE INDEX ai_media_provider_accounts_oauth_secret_ref_uq
  ON ai_media_provider_accounts (secret_ref) WHERE credential_source='oauth_authorization';

ALTER TABLE ai_media_provider_accounts
  ADD CONSTRAINT ai_media_provider_accounts_oauth_source_session_fk
  FOREIGN KEY (owner_user_id,workspace_id,credential_actor_user_id,id,provider_key,credential_source_session_id)
  REFERENCES ai_media_oauth_sessions (owner_user_id,workspace_id,actor_user_id,provider_account_id,platform,id)
  ON UPDATE NO ACTION ON DELETE NO ACTION NOT VALID;
ALTER TABLE ai_media_provider_accounts
  VALIDATE CONSTRAINT ai_media_provider_accounts_oauth_source_session_fk;

COMMIT;
