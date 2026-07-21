-- Minimal PR6-compatible prerequisite for the owned PR16A PostgreSQL harness.
-- Test-only: never apply to staging or production.
BEGIN;
SET LOCAL search_path=public,pg_catalog;
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA public;
CREATE TABLE ai_media_provider_accounts(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),owner_user_id text NOT NULL,workspace_id text NOT NULL DEFAULT 'personal',
  provider_key text NOT NULL,display_name text NOT NULL DEFAULT 'Provider account',status text NOT NULL DEFAULT 'disconnected',
  secret_ref text,external_account_id text,capabilities jsonb NOT NULL DEFAULT '[]'::jsonb,
  configuration jsonb NOT NULL DEFAULT '{}'::jsonb,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE UNIQUE INDEX ai_media_provider_accounts_owner_workspace_id_uq
  ON ai_media_provider_accounts(owner_user_id,workspace_id,id);
CREATE UNIQUE INDEX ai_media_provider_accounts_owner_workspace_id_provider_uq
  ON ai_media_provider_accounts(owner_user_id,workspace_id,id,provider_key);
CREATE TABLE ai_media_publishing_jobs(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),owner_user_id text NOT NULL,workspace_id text NOT NULL DEFAULT 'personal',
  provider_account_id uuid,platform text NOT NULL
);
COMMIT;
