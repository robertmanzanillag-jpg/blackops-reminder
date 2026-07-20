-- Data-preserving compatibility rollback for AI Media Studio PR2.
--
-- This restores PR1 constraints and index shapes but deliberately retains the
-- additive PR2 columns and their data. Old application code ignores those
-- columns. Dropping them would make rollback destructive and unrecoverable.

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15min';
SET LOCAL search_path = public, pg_catalog;

-- PR1 used narrower, global unique keys. Refuse rollback if PR2 accepted rows
-- that cannot satisfy those old constraints; reconcile them before retrying.
DO $preflight$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM ai_media_provider_resources
    GROUP BY provider_account_id, resource_type, external_resource_id
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'rollback blocked: provider resource rows violate the PR1 unique key';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM ai_media_assets
    GROUP BY storage_provider, storage_key
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'rollback blocked: asset rows violate the PR1 global storage key';
  END IF;
END;
$preflight$;

ALTER TABLE ai_media_influencers
  DROP CONSTRAINT IF EXISTS ai_media_influencers_default_voice_resource_fk,
  DROP CONSTRAINT IF EXISTS ai_media_influencers_default_avatar_resource_fk;
ALTER TABLE ai_media_assets
  DROP CONSTRAINT IF EXISTS ai_media_assets_influencer_fk,
  DROP CONSTRAINT IF EXISTS ai_media_assets_provider_resource_fk;

-- PR1 does not write canonical_key. Keep the backfilled values, but restore
-- write compatibility so PR1 can create provider resources after code rollback.
ALTER TABLE ai_media_provider_resources
  ALTER COLUMN canonical_key DROP NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS ai_media_provider_resources_provider_external_uq_pr1
  ON ai_media_provider_resources (provider_account_id, resource_type, external_resource_id);
DROP INDEX IF EXISTS ai_media_provider_resources_provider_external_uq;
ALTER INDEX ai_media_provider_resources_provider_external_uq_pr1
  RENAME TO ai_media_provider_resources_provider_external_uq;
DROP INDEX IF EXISTS ai_media_provider_resources_owner_workspace_canonical_uq;
DROP INDEX IF EXISTS ai_media_influencers_default_voice_resource_idx;
DROP INDEX IF EXISTS ai_media_influencers_default_avatar_resource_idx;

CREATE INDEX IF NOT EXISTS ai_media_render_jobs_queue_idx_pr1
  ON ai_media_render_jobs (status, next_attempt_at, created_at);
DROP INDEX IF EXISTS ai_media_render_jobs_queue_idx;
ALTER INDEX ai_media_render_jobs_queue_idx_pr1 RENAME TO ai_media_render_jobs_queue_idx;
DROP INDEX IF EXISTS ai_media_render_jobs_owner_workspace_lease_idx;
DROP INDEX IF EXISTS ai_media_render_jobs_dead_letter_idx;

CREATE UNIQUE INDEX IF NOT EXISTS ai_media_assets_storage_object_uq_pr1
  ON ai_media_assets (storage_provider, storage_key);
DROP INDEX IF EXISTS ai_media_assets_storage_object_uq;
ALTER INDEX ai_media_assets_storage_object_uq_pr1
  RENAME TO ai_media_assets_storage_object_uq;
DROP INDEX IF EXISTS ai_media_assets_owner_workspace_library_idx;
DROP INDEX IF EXISTS ai_media_assets_influencer_idx;
DROP INDEX IF EXISTS ai_media_assets_provider_resource_idx;

COMMIT;
