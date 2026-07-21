-- Minimal PR18-compatible prerequisite schema for the isolated PR21 PostgreSQL harness.
-- This fixture is test-only. It must never be applied to staging or production.
BEGIN;
SET LOCAL search_path = public, pg_catalog;

CREATE TABLE ai_media_provider_accounts (
  id uuid PRIMARY KEY,
  owner_user_id text NOT NULL,
  workspace_id text NOT NULL,
  provider_key text NOT NULL,
  credential_version integer NOT NULL DEFAULT 1,
  status text NOT NULL DEFAULT 'active',
  credential_status text NOT NULL DEFAULT 'active',
  credential_expires_at timestamptz
);
CREATE UNIQUE INDEX ai_media_provider_accounts_owner_workspace_id_provider_uq
  ON ai_media_provider_accounts(owner_user_id, workspace_id, id, provider_key);

CREATE TABLE ai_media_provider_resources (
  id uuid PRIMARY KEY,
  owner_user_id text NOT NULL,
  workspace_id text NOT NULL,
  provider_account_id uuid NOT NULL,
  provider_key text NOT NULL,
  resource_type text NOT NULL,
  status text NOT NULL DEFAULT 'active'
);
CREATE UNIQUE INDEX ai_media_provider_resources_owner_workspace_id_uq
  ON ai_media_provider_resources(owner_user_id, workspace_id, id);

CREATE TABLE ai_media_influencers (
  id uuid PRIMARY KEY,
  owner_user_id text NOT NULL,
  workspace_id text NOT NULL,
  status text NOT NULL DEFAULT 'active',
  archived_at timestamptz
);
CREATE UNIQUE INDEX ai_media_influencers_owner_workspace_id_uq
  ON ai_media_influencers(owner_user_id, workspace_id, id);

CREATE TABLE ai_media_scripts (
  id uuid PRIMARY KEY,
  owner_user_id text NOT NULL,
  workspace_id text NOT NULL,
  influencer_id uuid,
  source_type text NOT NULL DEFAULT 'manual',
  source_item_id uuid,
  title text NOT NULL,
  language text NOT NULL,
  status text NOT NULL DEFAULT 'approved',
  current_variant_id uuid,
  archived_at timestamptz
);

CREATE TABLE ai_media_script_variants (
  id uuid PRIMARY KEY,
  owner_user_id text NOT NULL,
  workspace_id text NOT NULL,
  script_id uuid NOT NULL,
  content text NOT NULL,
  checksum text NOT NULL,
  status text NOT NULL DEFAULT 'approved'
);

CREATE TABLE ai_media_governance_profiles (
  id uuid PRIMARY KEY,
  owner_user_id text NOT NULL,
  workspace_id text NOT NULL,
  influencer_id uuid NOT NULL,
  avatar_resource_id uuid NOT NULL,
  voice_resource_id uuid NOT NULL,
  version integer NOT NULL DEFAULT 1,
  evidence_digest text NOT NULL,
  state text NOT NULL DEFAULT 'active',
  revoked_at timestamptz,
  valid_from timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  allowed_uses jsonb NOT NULL,
  territories jsonb NOT NULL
);
CREATE UNIQUE INDEX ai_media_governance_profiles_owner_workspace_id_uq
  ON ai_media_governance_profiles(owner_user_id, workspace_id, id);

CREATE TABLE ai_media_source_items (
  id uuid PRIMARY KEY,
  owner_user_id text NOT NULL,
  workspace_id text NOT NULL,
  source_type text NOT NULL,
  external_id text NOT NULL,
  content_hash text NOT NULL,
  status text NOT NULL,
  rights_status text NOT NULL,
  moderation_status text NOT NULL,
  CONSTRAINT ai_media_source_items_fixture_state_ck CHECK (
    content_hash ~ '^sha256:[0-9a-f]{64}$'
    AND status IN ('discovered','accepted','processing','ready','rejected','archived')
    AND rights_status IN ('unknown','owned','licensed','restricted','rejected')
    AND moderation_status IN ('pending','approved','rejected')
  )
);

CREATE TABLE ai_media_render_jobs (
  id uuid PRIMARY KEY,
  owner_user_id text NOT NULL,
  workspace_id text NOT NULL,
  provider_account_id uuid,
  provider_key text,
  provider_job_id text,
  idempotency_key text NOT NULL,
  title text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  stage text NOT NULL DEFAULT 'queued',
  progress integer NOT NULL DEFAULT 0,
  attempts integer NOT NULL DEFAULT 0,
  retry_count integer NOT NULL DEFAULT 0,
  max_attempts integer NOT NULL DEFAULT 3,
  request jsonb NOT NULL,
  result jsonb,
  governance_profile_id uuid,
  governance_evidence_digest text,
  queued_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  available_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  lease_owner text,
  lease_expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT transaction_timestamp()
);
CREATE UNIQUE INDEX ai_media_render_jobs_owner_workspace_id_uq
  ON ai_media_render_jobs(owner_user_id, workspace_id, id);
CREATE UNIQUE INDEX ai_media_render_jobs_owner_workspace_idempotency_uq
  ON ai_media_render_jobs(owner_user_id, workspace_id, idempotency_key);

CREATE TABLE ai_media_outbox (
  id uuid PRIMARY KEY,
  owner_user_id text NOT NULL,
  workspace_id text NOT NULL,
  idempotency_key text NOT NULL,
  aggregate_type text NOT NULL,
  aggregate_id text NOT NULL,
  event_type text NOT NULL,
  payload jsonb NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  attempts integer NOT NULL DEFAULT 0,
  available_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  locked_at timestamptz,
  lease_owner text,
  lease_expires_at timestamptz,
  fencing_token integer NOT NULL DEFAULT 0,
  dead_letter_at timestamptz,
  processed_at timestamptz,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT transaction_timestamp()
);
CREATE UNIQUE INDEX ai_media_outbox_owner_workspace_idempotency_uq
  ON ai_media_outbox(owner_user_id, workspace_id, idempotency_key);

COMMIT;
