-- PR4 rollback keeps additive columns, ingest jobs, private artifact references, and owned assets.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15min';
SET LOCAL search_path = public, pg_catalog;

-- Restore a non-unique lookup path before removing the PR4 active-checksum
-- uniqueness rule. No table, column, job, asset, or artifact reference is lost.
CREATE INDEX IF NOT EXISTS ai_media_assets_owner_workspace_kind_checksum_idx
  ON ai_media_assets (owner_user_id, workspace_id, kind, checksum)
  WHERE deleted_at IS NULL AND checksum IS NOT NULL;
DROP INDEX IF EXISTS ai_media_assets_owner_workspace_kind_checksum_active_uq;

-- The PR4 table, render-job output link, constraints, queue indexes, fencing
-- tokens, errors, terminal timestamps, and all rows remain for recovery.
COMMIT;
