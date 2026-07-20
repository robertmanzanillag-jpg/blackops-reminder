-- AI Media Studio PR3 operations schema: reviewed additive migration only.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15min';
SET LOCAL search_path = public, pg_catalog;

DO $preflight$
DECLARE required_table text;
BEGIN
  FOREACH required_table IN ARRAY ARRAY[
    'ai_media_publishing_jobs', 'ai_media_publications', 'ai_media_analytics_snapshots',
    'ai_media_analytics_events', 'ai_media_source_items', 'ai_media_assets', 'ai_media_outbox'
  ] LOOP
    IF to_regclass('public.' || required_table) IS NULL THEN
      RAISE EXCEPTION 'PR3 requires existing table %', required_table;
    END IF;
  END LOOP;
END;
$preflight$;

ALTER TABLE ai_media_publishing_jobs
  ADD COLUMN IF NOT EXISTS media_asset_id uuid,
  ADD COLUMN IF NOT EXISTS mode text,
  ADD COLUMN IF NOT EXISTS preview_digest text,
  ADD COLUMN IF NOT EXISTS approval_evidence jsonb,
  ADD COLUMN IF NOT EXISTS due_at timestamptz,
  ADD COLUMN IF NOT EXISTS available_at timestamptz,
  ADD COLUMN IF NOT EXISTS lease_owner text,
  ADD COLUMN IF NOT EXISTS lease_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS fencing_token integer,
  ADD COLUMN IF NOT EXISTS failure_code text,
  ADD COLUMN IF NOT EXISTS dead_letter_at timestamptz,
  ADD COLUMN IF NOT EXISTS reconcile_after timestamptz,
  ADD COLUMN IF NOT EXISTS reconciliation_status text;

UPDATE ai_media_publishing_jobs
SET mode = COALESCE(mode, CASE WHEN scheduled_for IS NULL THEN 'manual' ELSE 'scheduled' END),
    available_at = COALESCE(available_at, scheduled_for, created_at, now()),
    fencing_token = COALESCE(fencing_token, 0),
    reconciliation_status = COALESCE(reconciliation_status, 'not_required')
WHERE mode IS NULL OR available_at IS NULL OR fencing_token IS NULL OR reconciliation_status IS NULL;

ALTER TABLE ai_media_publishing_jobs
  ALTER COLUMN mode SET DEFAULT 'manual',
  ALTER COLUMN mode SET NOT NULL,
  ALTER COLUMN available_at SET DEFAULT now(),
  ALTER COLUMN available_at SET NOT NULL,
  ALTER COLUMN fencing_token SET DEFAULT 0,
  ALTER COLUMN fencing_token SET NOT NULL,
  ALTER COLUMN reconciliation_status SET DEFAULT 'not_required',
  ALTER COLUMN reconciliation_status SET NOT NULL;

DO $publishing_fk$
BEGIN
  IF EXISTS (
    SELECT 1 FROM ai_media_publishing_jobs jobs
    LEFT JOIN ai_media_assets assets ON assets.id = jobs.media_asset_id
    WHERE jobs.media_asset_id IS NOT NULL AND assets.id IS NULL
  ) THEN
    RAISE EXCEPTION 'orphaned ai_media_publishing_jobs.media_asset_id values block PR3';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ai_media_publishing_jobs_media_asset_fk') THEN
    ALTER TABLE ai_media_publishing_jobs
      ADD CONSTRAINT ai_media_publishing_jobs_media_asset_fk
      FOREIGN KEY (media_asset_id) REFERENCES ai_media_assets(id) ON DELETE SET NULL NOT VALID;
  END IF;
END;
$publishing_fk$;
ALTER TABLE ai_media_publishing_jobs VALIDATE CONSTRAINT ai_media_publishing_jobs_media_asset_fk;
ALTER TABLE ai_media_publishing_jobs ALTER COLUMN video_id DROP NOT NULL;
DO $publishing_media_check$
BEGIN
  IF EXISTS (SELECT 1 FROM ai_media_publishing_jobs WHERE video_id IS NULL AND media_asset_id IS NULL) THEN
    RAISE EXCEPTION 'publishing jobs without a video or media asset block PR3';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ai_media_publishing_jobs_media_reference_ck') THEN
    ALTER TABLE ai_media_publishing_jobs ADD CONSTRAINT ai_media_publishing_jobs_media_reference_ck
      CHECK (video_id IS NOT NULL OR media_asset_id IS NOT NULL) NOT VALID;
  END IF;
END;
$publishing_media_check$;
ALTER TABLE ai_media_publishing_jobs VALIDATE CONSTRAINT ai_media_publishing_jobs_media_reference_ck;

ALTER TABLE ai_media_publications ADD COLUMN IF NOT EXISTS media_asset_id uuid;
UPDATE ai_media_publications publications
SET media_asset_id = jobs.media_asset_id
FROM ai_media_publishing_jobs jobs
WHERE jobs.id = publications.publishing_job_id AND publications.media_asset_id IS NULL;
DO $publication_asset_fk$
BEGIN
  IF EXISTS (
    SELECT 1 FROM ai_media_publications publications
    LEFT JOIN ai_media_assets assets ON assets.id = publications.media_asset_id
    WHERE publications.media_asset_id IS NOT NULL AND assets.id IS NULL
  ) THEN
    RAISE EXCEPTION 'orphaned ai_media_publications.media_asset_id values block PR3';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ai_media_publications_media_asset_fk') THEN
    ALTER TABLE ai_media_publications
      ADD CONSTRAINT ai_media_publications_media_asset_fk
      FOREIGN KEY (media_asset_id) REFERENCES ai_media_assets(id) ON DELETE SET NULL NOT VALID;
  END IF;
END;
$publication_asset_fk$;
ALTER TABLE ai_media_publications VALIDATE CONSTRAINT ai_media_publications_media_asset_fk;
ALTER TABLE ai_media_publications ALTER COLUMN video_id DROP NOT NULL;
DO $publication_media_check$
BEGIN
  IF EXISTS (SELECT 1 FROM ai_media_publications WHERE video_id IS NULL AND media_asset_id IS NULL) THEN
    RAISE EXCEPTION 'publications without a video or media asset block PR3';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ai_media_publications_media_reference_ck') THEN
    ALTER TABLE ai_media_publications ADD CONSTRAINT ai_media_publications_media_reference_ck
      CHECK (video_id IS NOT NULL OR media_asset_id IS NOT NULL) NOT VALID;
  END IF;
END;
$publication_media_check$;
ALTER TABLE ai_media_publications VALIDATE CONSTRAINT ai_media_publications_media_reference_ck;
CREATE INDEX IF NOT EXISTS ai_media_publications_owner_workspace_media_asset_idx
  ON ai_media_publications (owner_user_id, workspace_id, media_asset_id);
CREATE UNIQUE INDEX IF NOT EXISTS ai_media_publications_platform_external_uq_pr3
  ON ai_media_publications (owner_user_id, workspace_id, platform, external_publication_id);
DROP INDEX IF EXISTS ai_media_publications_platform_external_uq;
ALTER INDEX ai_media_publications_platform_external_uq_pr3
  RENAME TO ai_media_publications_platform_external_uq;

CREATE INDEX IF NOT EXISTS ai_media_publishing_jobs_dispatch_idx_pr3
  ON ai_media_publishing_jobs (status, approval_status, available_at, due_at, lease_expires_at);
CREATE INDEX IF NOT EXISTS ai_media_publishing_jobs_owner_workspace_asset_idx
  ON ai_media_publishing_jobs (owner_user_id, workspace_id, media_asset_id);
CREATE INDEX IF NOT EXISTS ai_media_publishing_jobs_dead_letter_idx
  ON ai_media_publishing_jobs (dead_letter_at);
CREATE INDEX IF NOT EXISTS ai_media_publishing_jobs_reconcile_idx
  ON ai_media_publishing_jobs (reconciliation_status, reconcile_after);
DROP INDEX IF EXISTS ai_media_publishing_jobs_dispatch_idx;
ALTER INDEX ai_media_publishing_jobs_dispatch_idx_pr3 RENAME TO ai_media_publishing_jobs_dispatch_idx;

ALTER TABLE ai_media_analytics_snapshots
  ADD COLUMN IF NOT EXISTS platform text,
  ADD COLUMN IF NOT EXISTS period_start timestamptz,
  ADD COLUMN IF NOT EXISTS period_end timestamptz;

UPDATE ai_media_analytics_snapshots snapshots
SET platform = publications.platform
FROM ai_media_publications publications
WHERE publications.id = snapshots.publication_id AND snapshots.platform IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS ai_media_analytics_snapshots_publication_captured_uq_pr3
  ON ai_media_analytics_snapshots (owner_user_id, workspace_id, publication_id, captured_at);
CREATE INDEX IF NOT EXISTS ai_media_analytics_snapshots_owner_workspace_platform_captured_idx
  ON ai_media_analytics_snapshots (owner_user_id, workspace_id, platform, captured_at);
CREATE INDEX IF NOT EXISTS ai_media_analytics_snapshots_publication_period_idx
  ON ai_media_analytics_snapshots (publication_id, period_start, period_end);
DROP INDEX IF EXISTS ai_media_analytics_snapshots_publication_captured_uq;
ALTER INDEX ai_media_analytics_snapshots_publication_captured_uq_pr3
  RENAME TO ai_media_analytics_snapshots_publication_captured_uq;

CREATE UNIQUE INDEX IF NOT EXISTS ai_media_analytics_events_source_external_uq_pr3
  ON ai_media_analytics_events (owner_user_id, workspace_id, source, external_event_id);
DROP INDEX IF EXISTS ai_media_analytics_events_source_external_uq;
ALTER INDEX ai_media_analytics_events_source_external_uq_pr3
  RENAME TO ai_media_analytics_events_source_external_uq;

ALTER TABLE ai_media_source_items
  ADD COLUMN IF NOT EXISTS content_hash text,
  ADD COLUMN IF NOT EXISTS moderation_status text,
  ADD COLUMN IF NOT EXISTS moderation_evidence jsonb,
  ADD COLUMN IF NOT EXISTS automation_evidence jsonb;

UPDATE ai_media_source_items
SET moderation_status = COALESCE(moderation_status, 'pending'),
    moderation_evidence = COALESCE(moderation_evidence, '{}'::jsonb),
    automation_evidence = COALESCE(automation_evidence, '{}'::jsonb)
WHERE moderation_status IS NULL OR moderation_evidence IS NULL OR automation_evidence IS NULL;

ALTER TABLE ai_media_source_items
  ALTER COLUMN moderation_status SET DEFAULT 'pending',
  ALTER COLUMN moderation_status SET NOT NULL,
  ALTER COLUMN moderation_evidence SET DEFAULT '{}'::jsonb,
  ALTER COLUMN moderation_evidence SET NOT NULL,
  ALTER COLUMN automation_evidence SET DEFAULT '{}'::jsonb,
  ALTER COLUMN automation_evidence SET NOT NULL;

CREATE INDEX IF NOT EXISTS ai_media_source_items_owner_workspace_content_hash_idx
  ON ai_media_source_items (owner_user_id, workspace_id, content_hash);
CREATE INDEX IF NOT EXISTS ai_media_source_items_owner_workspace_moderation_idx
  ON ai_media_source_items (owner_user_id, workspace_id, moderation_status, updated_at);

CREATE TABLE IF NOT EXISTS ai_media_orchestration_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id text NOT NULL,
  workspace_id text NOT NULL DEFAULT 'personal',
  source_item_id uuid REFERENCES ai_media_source_items(id) ON DELETE SET NULL,
  run_type text NOT NULL,
  mode text NOT NULL DEFAULT 'manual',
  status text NOT NULL DEFAULT 'queued',
  state_version integer NOT NULL DEFAULT 0,
  run_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  idempotency_key text NOT NULL,
  policy_evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  automation_evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  due_at timestamptz,
  available_at timestamptz NOT NULL DEFAULT now(),
  lease_owner text,
  lease_expires_at timestamptz,
  fencing_token integer NOT NULL DEFAULT 0,
  attempts integer NOT NULL DEFAULT 0,
  max_attempts integer NOT NULL DEFAULT 3,
  dead_letter_at timestamptz,
  failure_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);
ALTER TABLE ai_media_orchestration_runs
  ADD COLUMN IF NOT EXISTS state_version integer,
  ADD COLUMN IF NOT EXISTS run_payload jsonb;
UPDATE ai_media_orchestration_runs
SET state_version = COALESCE(state_version, 0),
    run_payload = COALESCE(run_payload, '{}'::jsonb)
WHERE state_version IS NULL OR run_payload IS NULL;
ALTER TABLE ai_media_orchestration_runs
  ALTER COLUMN state_version SET DEFAULT 0,
  ALTER COLUMN state_version SET NOT NULL,
  ALTER COLUMN run_payload SET DEFAULT '{}'::jsonb,
  ALTER COLUMN run_payload SET NOT NULL;
DO $orchestration_source_preflight$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM ai_media_orchestration_runs
    WHERE source_item_id IS NOT NULL
    GROUP BY owner_user_id, workspace_id, source_item_id
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'duplicate tenant/source orchestration runs block canonical-run uniqueness';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM ai_media_orchestration_runs
    GROUP BY owner_user_id, workspace_id, idempotency_key
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'duplicate tenant orchestration idempotency keys block canonical-run uniqueness';
  END IF;
END;
$orchestration_source_preflight$;
CREATE UNIQUE INDEX IF NOT EXISTS ai_media_orchestration_runs_owner_workspace_idempotency_uq
  ON ai_media_orchestration_runs (owner_user_id, workspace_id, idempotency_key);
CREATE UNIQUE INDEX IF NOT EXISTS ai_media_orchestration_runs_owner_workspace_source_uq
  ON ai_media_orchestration_runs (owner_user_id, workspace_id, source_item_id)
  WHERE source_item_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS ai_media_orchestration_runs_queue_idx
  ON ai_media_orchestration_runs (status, available_at, due_at, lease_expires_at);
CREATE INDEX IF NOT EXISTS ai_media_orchestration_runs_dead_letter_idx
  ON ai_media_orchestration_runs (dead_letter_at);

ALTER TABLE ai_media_outbox
  ADD COLUMN IF NOT EXISTS lease_owner text,
  ADD COLUMN IF NOT EXISTS lease_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS fencing_token integer,
  ADD COLUMN IF NOT EXISTS dead_letter_at timestamptz;
UPDATE ai_media_outbox
SET fencing_token = COALESCE(fencing_token, 0)
WHERE fencing_token IS NULL;
ALTER TABLE ai_media_outbox
  ALTER COLUMN fencing_token SET DEFAULT 0,
  ALTER COLUMN fencing_token SET NOT NULL;
CREATE INDEX IF NOT EXISTS ai_media_outbox_dispatch_idx_pr3
  ON ai_media_outbox (status, available_at, lease_expires_at, created_at);
CREATE INDEX IF NOT EXISTS ai_media_outbox_owner_workspace_lease_idx
  ON ai_media_outbox (owner_user_id, workspace_id, lease_owner, lease_expires_at);
CREATE INDEX IF NOT EXISTS ai_media_outbox_dead_letter_idx
  ON ai_media_outbox (dead_letter_at);
DROP INDEX IF EXISTS ai_media_outbox_dispatch_idx;
ALTER INDEX ai_media_outbox_dispatch_idx_pr3 RENAME TO ai_media_outbox_dispatch_idx;

COMMIT;
