-- AI Media Studio PR14: dedicated durable OAuth vault cleanup obligations. Do not apply automatically.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='15min';
SET LOCAL search_path=public,pg_catalog;

DO $preflight$
BEGIN
  IF to_regclass('public.ai_media_oauth_sessions') IS NULL OR to_regclass('public.ai_media_provider_accounts') IS NULL THEN
    RAISE EXCEPTION 'PR14 requires PR13 OAuth schema';
  END IF;
  IF to_regclass('public.ai_media_oauth_vault_operations') IS NOT NULL THEN RAISE EXCEPTION 'PR14 cleanup table must be absent'; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint c
      WHERE c.conname='ai_media_oauth_sessions_authorization_saga_ck'
        AND c.conrelid='public.ai_media_oauth_sessions'::regclass AND c.contype='c' AND c.convalidated)
    OR NOT EXISTS (SELECT 1 FROM pg_constraint c
      WHERE c.conname='ai_media_provider_accounts_oauth_credential_provenance_ck'
        AND c.conrelid='public.ai_media_provider_accounts'::regclass AND c.contype='c' AND c.convalidated) THEN
    RAISE EXCEPTION 'PR14 requires validated PR13 controls';
  END IF;
  IF EXISTS (
    SELECT 1 FROM ai_media_provider_accounts accounts
    WHERE accounts.credential_source='oauth_authorization' AND NOT EXISTS (
      SELECT 1 FROM ai_media_oauth_sessions sessions
      WHERE sessions.owner_user_id=accounts.owner_user_id AND sessions.workspace_id=accounts.workspace_id
        AND sessions.actor_user_id=accounts.credential_actor_user_id AND sessions.provider_account_id=accounts.id
        AND sessions.platform=accounts.provider_key AND sessions.id=accounts.credential_source_session_id
        AND sessions.exchange_status='succeeded' AND sessions.outcome='authorized'
        AND sessions.token_binding_id=accounts.token_binding_id AND sessions.target_credential_version=accounts.credential_version
        AND accounts.secret_ref='vault://ai-media-studio/oauth-token/v1/'||sessions.token_binding_id
    )
  ) THEN RAISE EXCEPTION 'PR14 rejects inconsistent OAuth credential provenance'; END IF;
END;
$preflight$;

CREATE TABLE ai_media_oauth_vault_operations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),owner_user_id text NOT NULL,workspace_id text NOT NULL,
  actor_user_id text NOT NULL,provider_account_id uuid NOT NULL,platform text NOT NULL,session_id uuid NOT NULL,
  kind text NOT NULL,reference text NOT NULL,token_binding_id uuid,authorization_code_digest text,source_expires_at timestamptz,
  target_credential_version integer,state text NOT NULL DEFAULT 'scheduled',attempt integer NOT NULL DEFAULT 0,
  max_attempts integer NOT NULL DEFAULT 8,delete_pass integer NOT NULL DEFAULT 0,available_at timestamptz NOT NULL,
  quiescent_until timestamptz NOT NULL,lease_token uuid,lease_owner text,lease_expires_at timestamptz,
  lease_fencing integer NOT NULL DEFAULT 0,last_error_code text,completed_at timestamptz,dead_lettered_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ai_media_oauth_vault_operations_kind_reference_uq UNIQUE(kind,reference),
  CONSTRAINT ai_media_oauth_vault_operations_session_source_fk FOREIGN KEY
    (owner_user_id,workspace_id,actor_user_id,provider_account_id,platform,session_id)
    REFERENCES ai_media_oauth_sessions(owner_user_id,workspace_id,actor_user_id,provider_account_id,platform,id)
    ON UPDATE NO ACTION ON DELETE NO ACTION,
  CONSTRAINT ai_media_oauth_vault_operations_kind_context_ck CHECK (
    (kind='pkce_verifier' AND reference ~ '^vault://ai-media-studio/oauth-pkce/v1/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      AND token_binding_id IS NULL AND authorization_code_digest IS NULL AND source_expires_at IS NOT NULL AND target_credential_version IS NULL)
    OR (kind='authorization_code' AND reference ~ '^vault://ai-media-studio/oauth-code/v1/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      AND token_binding_id IS NOT NULL AND authorization_code_digest ~ '^[0-9a-f]{64}$' AND source_expires_at IS NOT NULL AND target_credential_version IS NULL)
    OR (kind='token_credential' AND reference ~ '^vault://ai-media-studio/oauth-token/v1/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      AND token_binding_id IS NOT NULL AND authorization_code_digest IS NULL AND source_expires_at IS NULL AND target_credential_version>0)
  ) NOT VALID,
  CONSTRAINT ai_media_oauth_vault_operations_lifecycle_ck CHECK (
    state IN ('scheduled','leased','retry_wait','verify_wait','retained','completed','dead_letter')
    AND attempt BETWEEN 0 AND max_attempts AND max_attempts BETWEEN 1 AND 32 AND delete_pass BETWEEN 0 AND 2 AND lease_fencing>=0
    AND quiescent_until>=created_at AND ((state='leased')=(lease_token IS NOT NULL))
    AND ((lease_token IS NULL)=(lease_owner IS NULL)) AND ((lease_token IS NULL)=(lease_expires_at IS NULL))
    AND (state<>'retained' OR kind='token_credential') AND (state<>'verify_wait' OR delete_pass=1)
    AND (state<>'completed' OR (delete_pass=2 AND completed_at IS NOT NULL))
    AND (state<>'dead_letter' OR dead_lettered_at IS NOT NULL)
    AND (last_error_code IS NULL OR last_error_code IN ('vault_rejected','vault_timeout','lease_lost','invalid_obligation'))
  ) NOT VALID
);

CREATE INDEX ai_media_oauth_vault_operations_due_idx ON ai_media_oauth_vault_operations(state,available_at,quiescent_until);
CREATE INDEX ai_media_oauth_vault_operations_tenant_due_idx ON ai_media_oauth_vault_operations(owner_user_id,workspace_id,state,available_at);
CREATE INDEX ai_media_oauth_vault_operations_dead_idx ON ai_media_oauth_vault_operations(dead_lettered_at) WHERE state='dead_letter';

INSERT INTO ai_media_oauth_vault_operations(owner_user_id,workspace_id,actor_user_id,provider_account_id,platform,session_id,kind,reference,
  source_expires_at,state,available_at,quiescent_until,created_at,updated_at)
SELECT owner_user_id,workspace_id,actor_user_id,provider_account_id,platform,id,'pkce_verifier',pkce_verifier_ref,expires_at,'scheduled',
  CASE WHEN status='consumed' OR expires_at<=clock_timestamp() THEN clock_timestamp() ELSE expires_at END,
  CASE WHEN status='consumed' OR expires_at<=clock_timestamp() THEN clock_timestamp()+interval '60 seconds' ELSE expires_at+interval '60 seconds' END,
  clock_timestamp(),clock_timestamp() FROM ai_media_oauth_sessions WHERE pkce_verifier_ref IS NOT NULL;

INSERT INTO ai_media_oauth_vault_operations(owner_user_id,workspace_id,actor_user_id,provider_account_id,platform,session_id,kind,reference,
  token_binding_id,authorization_code_digest,source_expires_at,state,available_at,quiescent_until,created_at,updated_at)
SELECT owner_user_id,workspace_id,actor_user_id,provider_account_id,platform,id,'authorization_code',
  'vault://ai-media-studio/oauth-code/v1/'||id,token_binding_id,authorization_code_digest,expires_at,'scheduled',
  CASE WHEN status='consumed' OR expires_at<=clock_timestamp() OR exchange_status IN ('failed','indeterminate') THEN clock_timestamp() ELSE expires_at END,
  CASE WHEN status='consumed' OR expires_at<=clock_timestamp() OR exchange_status IN ('failed','indeterminate') THEN clock_timestamp()+interval '60 seconds' ELSE expires_at+interval '60 seconds' END,
  clock_timestamp(),clock_timestamp() FROM ai_media_oauth_sessions WHERE authorization_code_digest IS NOT NULL;

INSERT INTO ai_media_oauth_vault_operations(owner_user_id,workspace_id,actor_user_id,provider_account_id,platform,session_id,kind,reference,
  token_binding_id,target_credential_version,state,available_at,quiescent_until,created_at,updated_at)
SELECT owner_user_id,workspace_id,actor_user_id,provider_account_id,platform,id,'token_credential',
  'vault://ai-media-studio/oauth-token/v1/'||token_binding_id,token_binding_id,target_credential_version,
  CASE WHEN exchange_status IN ('failed','indeterminate') THEN 'scheduled' ELSE 'retained' END,
  CASE WHEN exchange_status IN ('failed','indeterminate') THEN clock_timestamp() ELSE 'infinity'::timestamptz END,
  CASE WHEN exchange_status IN ('failed','indeterminate') THEN clock_timestamp()+interval '60 seconds' ELSE 'infinity'::timestamptz END,
  clock_timestamp(),clock_timestamp() FROM ai_media_oauth_sessions WHERE token_binding_id IS NOT NULL;

ALTER TABLE ai_media_oauth_vault_operations VALIDATE CONSTRAINT ai_media_oauth_vault_operations_kind_context_ck;
ALTER TABLE ai_media_oauth_vault_operations VALIDATE CONSTRAINT ai_media_oauth_vault_operations_lifecycle_ck;
COMMIT;
