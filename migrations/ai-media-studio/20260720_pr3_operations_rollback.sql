-- PR3 rollback keeps all additive columns, orchestration rows, and evidence.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15min';
SET LOCAL search_path = public, pg_catalog;

DO $guards$
BEGIN
  IF EXISTS (
    SELECT 1 FROM ai_media_publications
    GROUP BY platform, external_publication_id HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'PR3 publications conflict with the narrower PR2 global uniqueness rule';
  END IF;
  IF EXISTS (SELECT 1 FROM ai_media_publications WHERE video_id IS NULL) THEN
    RAISE EXCEPTION 'asset-only PR3 publications require an explicit data decision before PR2 rollback';
  END IF;
  IF EXISTS (SELECT 1 FROM ai_media_publishing_jobs WHERE video_id IS NULL) THEN
    RAISE EXCEPTION 'asset-only PR3 publishing jobs require an explicit data decision before PR2 rollback';
  END IF;
  IF EXISTS (
    SELECT 1 FROM ai_media_analytics_events
    WHERE external_event_id IS NOT NULL
    GROUP BY source, external_event_id HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'PR3 analytics events conflict with the narrower PR2 uniqueness rule';
  END IF;
  IF EXISTS (
    SELECT 1 FROM ai_media_analytics_snapshots
    GROUP BY publication_id, captured_at HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'PR3 analytics snapshots conflict with the narrower PR2 uniqueness rule';
  END IF;
END;
$guards$;

CREATE UNIQUE INDEX IF NOT EXISTS ai_media_publications_platform_external_uq_pr2
  ON ai_media_publications (platform, external_publication_id);
DROP INDEX IF EXISTS ai_media_publications_platform_external_uq;
ALTER INDEX ai_media_publications_platform_external_uq_pr2
  RENAME TO ai_media_publications_platform_external_uq;
ALTER TABLE ai_media_publications ALTER COLUMN video_id SET NOT NULL;
ALTER TABLE ai_media_publishing_jobs ALTER COLUMN video_id SET NOT NULL;

CREATE INDEX IF NOT EXISTS ai_media_publishing_jobs_dispatch_idx_pr2
  ON ai_media_publishing_jobs (status, approval_status, scheduled_for);
DROP INDEX IF EXISTS ai_media_publishing_jobs_dispatch_idx;
ALTER INDEX ai_media_publishing_jobs_dispatch_idx_pr2 RENAME TO ai_media_publishing_jobs_dispatch_idx;

CREATE UNIQUE INDEX IF NOT EXISTS ai_media_analytics_snapshots_publication_captured_uq_pr2
  ON ai_media_analytics_snapshots (publication_id, captured_at);
DROP INDEX IF EXISTS ai_media_analytics_snapshots_publication_captured_uq;
ALTER INDEX ai_media_analytics_snapshots_publication_captured_uq_pr2
  RENAME TO ai_media_analytics_snapshots_publication_captured_uq;

CREATE UNIQUE INDEX IF NOT EXISTS ai_media_analytics_events_source_external_uq_pr2
  ON ai_media_analytics_events (source, external_event_id);
DROP INDEX IF EXISTS ai_media_analytics_events_source_external_uq;
ALTER INDEX ai_media_analytics_events_source_external_uq_pr2
  RENAME TO ai_media_analytics_events_source_external_uq;

CREATE INDEX IF NOT EXISTS ai_media_outbox_dispatch_idx_pr2
  ON ai_media_outbox (status, available_at, created_at);
DROP INDEX IF EXISTS ai_media_outbox_dispatch_idx;
ALTER INDEX ai_media_outbox_dispatch_idx_pr2 RENAME TO ai_media_outbox_dispatch_idx;

-- Retain the PR3 orchestration table and rows, while restoring the former
-- non-unique lookup shape. Dropping an index never removes application data.
CREATE INDEX IF NOT EXISTS ai_media_orchestration_runs_owner_workspace_source_idx
  ON ai_media_orchestration_runs (owner_user_id, workspace_id, source_item_id, created_at);
DROP INDEX IF EXISTS ai_media_orchestration_runs_owner_workspace_source_uq;

-- The PR3 table, state_version, run_payload, outbox lease/fencing/dead-letter fields,
-- other columns, evidence, and rows remain available for recovery.
COMMIT;
