-- AI Media Studio PR4 owned-render asset ingest: reviewed additive migration only.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15min';
SET LOCAL search_path = public, pg_catalog;

DO $preflight$
DECLARE required_table text;
BEGIN
  FOREACH required_table IN ARRAY ARRAY['ai_media_render_jobs', 'ai_media_assets'] LOOP
    IF to_regclass('public.' || required_table) IS NULL THEN
      RAISE EXCEPTION 'PR4 asset ingest requires existing table %', required_table;
    END IF;
  END LOOP;
END;
$preflight$;

ALTER TABLE ai_media_render_jobs
  ADD COLUMN IF NOT EXISTS output_media_asset_id uuid;

DO $render_output_fk$
BEGIN
  IF EXISTS (
    SELECT 1 FROM ai_media_render_jobs jobs
    LEFT JOIN ai_media_assets assets ON assets.id = jobs.output_media_asset_id
    WHERE jobs.output_media_asset_id IS NOT NULL AND assets.id IS NULL
  ) THEN
    RAISE EXCEPTION 'orphaned ai_media_render_jobs.output_media_asset_id values block PR4';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ai_media_render_jobs_output_media_asset_fk') THEN
    ALTER TABLE ai_media_render_jobs
      ADD CONSTRAINT ai_media_render_jobs_output_media_asset_fk
      FOREIGN KEY (output_media_asset_id) REFERENCES ai_media_assets(id) ON DELETE SET NULL NOT VALID;
  END IF;
END;
$render_output_fk$;
ALTER TABLE ai_media_render_jobs VALIDATE CONSTRAINT ai_media_render_jobs_output_media_asset_fk;
CREATE INDEX IF NOT EXISTS ai_media_render_jobs_output_media_asset_idx
  ON ai_media_render_jobs (output_media_asset_id);

CREATE TABLE IF NOT EXISTS ai_media_asset_ingest_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id text NOT NULL,
  workspace_id text NOT NULL DEFAULT 'personal',
  render_job_id uuid NOT NULL REFERENCES ai_media_render_jobs(id) ON DELETE CASCADE,
  provider_key text NOT NULL,
  remote_artifact_ref text,
  remote_url text,
  expected_mime_type text NOT NULL DEFAULT 'video/mp4',
  state text NOT NULL DEFAULT 'queued',
  attempts integer NOT NULL DEFAULT 0,
  max_attempts integer NOT NULL DEFAULT 3,
  lease_recoveries integer NOT NULL DEFAULT 0,
  max_lease_recoveries integer NOT NULL DEFAULT 3,
  available_at timestamptz NOT NULL DEFAULT now(),
  lease_owner text,
  lease_token text,
  lease_expires_at timestamptz,
  fencing_token integer NOT NULL DEFAULT 0,
  media_asset_id uuid REFERENCES ai_media_assets(id) ON DELETE SET NULL,
  owned_object_key text,
  sha256 text,
  size_bytes bigint,
  error_code text,
  error_message text,
  completed_at timestamptz,
  dead_letter_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ai_media_asset_ingest_jobs_source_reference_ck
    CHECK (remote_artifact_ref IS NOT NULL OR remote_url IS NOT NULL),
  CONSTRAINT ai_media_asset_ingest_jobs_state_ck
    CHECK (state IN ('queued', 'leased', 'retry_wait', 'completed', 'dead_letter')),
  CONSTRAINT ai_media_asset_ingest_jobs_attempts_ck
    CHECK (
      attempts >= 0 AND max_attempts > 0
      AND lease_recoveries >= 0 AND max_lease_recoveries > 0
    )
);

DO $ingest_duplicate_preflight$
BEGIN
  IF EXISTS (
    SELECT 1 FROM ai_media_asset_ingest_jobs
    GROUP BY owner_user_id, workspace_id, render_job_id
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'duplicate tenant/workspace/render asset ingest jobs block PR4';
  END IF;
  IF EXISTS (
    SELECT 1 FROM ai_media_assets
    WHERE deleted_at IS NULL AND checksum IS NOT NULL
    GROUP BY owner_user_id, workspace_id, kind, checksum
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'duplicate active tenant/workspace/kind/checksum media assets block PR4';
  END IF;
END;
$ingest_duplicate_preflight$;

CREATE UNIQUE INDEX IF NOT EXISTS ai_media_asset_ingest_jobs_owner_workspace_render_uq
  ON ai_media_asset_ingest_jobs (owner_user_id, workspace_id, render_job_id);
CREATE INDEX IF NOT EXISTS ai_media_asset_ingest_jobs_queue_idx
  ON ai_media_asset_ingest_jobs (state, available_at, lease_expires_at, created_at);
CREATE INDEX IF NOT EXISTS ai_media_asset_ingest_jobs_owner_workspace_lease_idx
  ON ai_media_asset_ingest_jobs (owner_user_id, workspace_id, lease_owner, lease_expires_at);
CREATE INDEX IF NOT EXISTS ai_media_asset_ingest_jobs_dead_letter_idx
  ON ai_media_asset_ingest_jobs (dead_letter_at);
CREATE INDEX IF NOT EXISTS ai_media_asset_ingest_jobs_completed_unlinked_idx
  ON ai_media_asset_ingest_jobs (state, media_asset_id, completed_at, created_at);
CREATE UNIQUE INDEX IF NOT EXISTS ai_media_assets_owner_workspace_kind_checksum_active_uq
  ON ai_media_assets (owner_user_id, workspace_id, kind, checksum)
  WHERE deleted_at IS NULL AND checksum IS NOT NULL;

COMMIT;
