-- AI Media Studio PR9 OAuth/vault foundation: reviewed additive migration only.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15min';
SET LOCAL search_path = public, pg_catalog;

DO $preflight$
DECLARE missing_column text;
BEGIN
  IF to_regclass('public.ai_media_provider_accounts') IS NULL THEN
    RAISE EXCEPTION 'PR9 OAuth foundation requires existing table ai_media_provider_accounts';
  END IF;

  SELECT requirement.column_name INTO missing_column
  FROM (VALUES ('owner_user_id'), ('workspace_id'), ('id'), ('provider_key')) AS requirement(column_name)
  WHERE NOT EXISTS (
    SELECT 1 FROM information_schema.columns AS columns
    WHERE columns.table_schema = 'public'
      AND columns.table_name = 'ai_media_provider_accounts'
      AND columns.column_name = requirement.column_name
  )
  LIMIT 1;
  IF missing_column IS NOT NULL THEN
    RAISE EXCEPTION 'PR9 OAuth foundation requires provider account column %', missing_column;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_index AS indexes
    JOIN pg_class AS index_relation ON index_relation.oid = indexes.indexrelid
    JOIN pg_class AS table_relation ON table_relation.oid = indexes.indrelid
    JOIN pg_namespace AS namespace ON namespace.oid = table_relation.relnamespace
    WHERE namespace.nspname = 'public'
      AND table_relation.relname = 'ai_media_provider_accounts'
      AND index_relation.relname = 'ai_media_provider_accounts_owner_workspace_id_provider_uq'
      AND indexes.indisunique AND indexes.indisvalid AND indexes.indpred IS NULL
      AND (
        SELECT array_agg(attribute.attname ORDER BY key.ordinality)
        FROM unnest(indexes.indkey) WITH ORDINALITY AS key(attnum, ordinality)
        JOIN pg_attribute AS attribute
          ON attribute.attrelid = indexes.indrelid AND attribute.attnum = key.attnum
      ) = ARRAY['owner_user_id', 'workspace_id', 'id', 'provider_key']::name[]
  ) THEN
    RAISE EXCEPTION 'PR9 OAuth foundation requires valid PR6 provider account candidate key';
  END IF;
END;
$preflight$;

ALTER TABLE ai_media_provider_accounts
  ADD COLUMN IF NOT EXISTS granted_scopes jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS credential_status text NOT NULL DEFAULT 'unverified',
  ADD COLUMN IF NOT EXISTS credential_version integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS credential_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS credential_refresh_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS credential_refreshed_at timestamptz;

DO $provider_checks$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'ai_media_provider_accounts_credential_metadata_ck'
      AND conrelid = 'public.ai_media_provider_accounts'::regclass
  ) THEN
    ALTER TABLE ai_media_provider_accounts
      ADD CONSTRAINT ai_media_provider_accounts_credential_metadata_ck CHECK (
        jsonb_typeof(granted_scopes) = 'array'
        AND credential_status IN ('unverified', 'active', 'expired', 'revoked', 'attention')
        AND credential_version >= 0
        AND (credential_expires_at IS NULL OR credential_expires_at > created_at)
        AND (credential_refresh_expires_at IS NULL OR credential_refresh_expires_at > created_at)
        AND (credential_refreshed_at IS NULL OR credential_refreshed_at >= created_at)
      ) NOT VALID;
  END IF;
END;
$provider_checks$;

ALTER TABLE ai_media_provider_accounts
  VALIDATE CONSTRAINT ai_media_provider_accounts_credential_metadata_ck;

CREATE TABLE IF NOT EXISTS ai_media_oauth_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id text NOT NULL,
  workspace_id text NOT NULL DEFAULT 'personal',
  actor_user_id text NOT NULL,
  provider_account_id uuid NOT NULL,
  platform text NOT NULL,
  state_digest text NOT NULL,
  redirect_uri text NOT NULL,
  requested_scopes jsonb NOT NULL DEFAULT '[]'::jsonb,
  code_challenge text NOT NULL,
  code_challenge_method text NOT NULL DEFAULT 'S256',
  pkce_verifier_ref text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  outcome text,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ai_media_oauth_sessions_platform_ck
    CHECK (platform IN ('tiktok', 'instagram', 'facebook', 'youtube_shorts')),
  CONSTRAINT ai_media_oauth_sessions_status_ck CHECK (status IN ('pending', 'consumed')),
  CONSTRAINT ai_media_oauth_sessions_requested_scopes_ck
    CHECK (jsonb_typeof(requested_scopes) = 'array' AND jsonb_array_length(requested_scopes) BETWEEN 1 AND 50),
  CONSTRAINT ai_media_oauth_sessions_pkce_ck CHECK (
    code_challenge_method = 'S256'
    AND length(code_challenge) = 43
    AND code_challenge ~ '^[A-Za-z0-9_-]+$'
    AND pkce_verifier_ref ~ '^vault://ai-media-studio/oauth-pkce/v1/[0-9A-Fa-f-]{36}$'
  ),
  CONSTRAINT ai_media_oauth_sessions_lifecycle_ck CHECK (
    expires_at > created_at
    AND expires_at <= created_at + interval '15 minutes'
    AND ((status = 'consumed') = (consumed_at IS NOT NULL))
    AND ((status = 'consumed') = (outcome IS NOT NULL))
    AND (outcome IS NULL OR outcome IN ('authorized', 'denied', 'error'))
    AND (consumed_at IS NULL OR consumed_at >= created_at)
  ),
  CONSTRAINT ai_media_oauth_sessions_redirect_ck
    CHECK (redirect_uri ~ '^https://' AND length(redirect_uri) BETWEEN 12 AND 2048),
  CONSTRAINT ai_media_oauth_sessions_actor_ck CHECK (length(btrim(actor_user_id)) BETWEEN 1 AND 255),
  CONSTRAINT ai_media_oauth_sessions_state_digest_ck CHECK (length(state_digest) = 64 AND state_digest ~ '^[0-9a-f]+$')
);

CREATE UNIQUE INDEX IF NOT EXISTS ai_media_oauth_sessions_state_digest_uq
  ON ai_media_oauth_sessions (state_digest);
CREATE INDEX IF NOT EXISTS ai_media_oauth_sessions_owner_workspace_platform_status_idx
  ON ai_media_oauth_sessions (owner_user_id, workspace_id, platform, status, expires_at);

DO $constraints$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'ai_media_oauth_sessions_provider_account_tenant_platform_fk'
      AND conrelid = 'public.ai_media_oauth_sessions'::regclass
  ) THEN
    ALTER TABLE ai_media_oauth_sessions
      ADD CONSTRAINT ai_media_oauth_sessions_provider_account_tenant_platform_fk
      FOREIGN KEY (owner_user_id, workspace_id, provider_account_id, platform)
      REFERENCES ai_media_provider_accounts (owner_user_id, workspace_id, id, provider_key)
      ON UPDATE NO ACTION ON DELETE NO ACTION NOT VALID;
  END IF;
END;
$constraints$;

ALTER TABLE ai_media_oauth_sessions
  VALIDATE CONSTRAINT ai_media_oauth_sessions_provider_account_tenant_platform_fk;

COMMIT;
