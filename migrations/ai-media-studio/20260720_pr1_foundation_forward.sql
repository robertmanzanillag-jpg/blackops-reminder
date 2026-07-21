-- AI Media Studio PR1 historical foundation.
--
-- Reconstructed from commit 8b30f184, shared/models/ai-media-studio-db.ts
-- (blob 4678f3b60595fe272ce11999806a4634317edb03,
-- SHA-256 560ac47625eb1a14297a5a5d127be7cc267d5de3c1943d51ea7e19640be1972d).
-- This is deliberately a strict
-- initial-schema migration: it refuses to adopt or overwrite any pre-existing
-- baseline relation.

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15min';
SET LOCAL search_path = public, pg_catalog;

DO $preflight$
DECLARE
  relation_name text;
BEGIN
  IF current_setting('server_version_num')::integer < 160000 THEN
    RAISE EXCEPTION 'PR1 foundation requires PostgreSQL 16 or newer';
  END IF;

  FOREACH relation_name IN ARRAY ARRAY[
    'ai_media_influencers', 'ai_media_scripts', 'ai_media_script_variants',
    'ai_media_video_projects', 'ai_media_videos', 'ai_media_provider_accounts',
    'ai_media_provider_resources', 'ai_media_render_jobs', 'ai_media_webhook_events',
    'ai_media_assets', 'ai_media_publishing_jobs', 'ai_media_publications',
    'ai_media_analytics_snapshots', 'ai_media_analytics_events',
    'ai_media_generation_history', 'ai_media_cost_ledger',
    'ai_media_source_items', 'ai_media_outbox'
  ] LOOP
    IF to_regclass(format('public.%I', relation_name)) IS NOT NULL THEN
      RAISE EXCEPTION 'PR1 foundation requires an empty baseline; public.% already exists', relation_name;
    END IF;
  END LOOP;
END;
$preflight$;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

DO $pgcrypto$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_extension extension
    JOIN pg_namespace namespace ON namespace.oid = extension.extnamespace
    WHERE extension.extname = 'pgcrypto' AND namespace.nspname = 'public'
  ) OR to_regprocedure('public.digest(text,text)') IS NULL
    OR NOT EXISTS (
      SELECT 1 FROM pg_depend dependency
      JOIN pg_extension extension ON extension.oid = dependency.refobjid
      WHERE dependency.classid = 'pg_proc'::regclass
        AND dependency.objid = 'public.digest(text,text)'::regprocedure
        AND dependency.deptype = 'e' AND extension.extname = 'pgcrypto'
    ) THEN
    RAISE EXCEPTION 'PR1 foundation requires extension-owned public.digest from pgcrypto in public';
  END IF;
END;
$pgcrypto$;

CREATE TABLE ai_media_influencers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), owner_user_id text NOT NULL,
  workspace_id text NOT NULL DEFAULT 'personal', name text NOT NULL, slug text NOT NULL,
  status text NOT NULL DEFAULT 'draft', description text, persona jsonb NOT NULL DEFAULT '{}'::jsonb,
  default_voice_resource_id uuid, default_avatar_resource_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), archived_at timestamptz
);

CREATE TABLE ai_media_scripts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), owner_user_id text NOT NULL,
  workspace_id text NOT NULL DEFAULT 'personal', influencer_id uuid,
  title text NOT NULL, source_type text NOT NULL DEFAULT 'manual', source_item_id uuid,
  language text NOT NULL DEFAULT 'en', status text NOT NULL DEFAULT 'draft', current_variant_id uuid,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb, created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(), archived_at timestamptz,
  CONSTRAINT ai_media_scripts_influencer_id_ai_media_influencers_id_fk FOREIGN KEY (influencer_id)
    REFERENCES ai_media_influencers(id) ON DELETE SET NULL
);

CREATE TABLE ai_media_script_variants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), owner_user_id text NOT NULL,
  workspace_id text NOT NULL DEFAULT 'personal', script_id uuid NOT NULL, version integer NOT NULL,
  label text, content text NOT NULL, status text NOT NULL DEFAULT 'draft', generation_history_id uuid,
  checksum text, metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ai_media_script_variants_script_id_ai_media_scripts_id_fk FOREIGN KEY (script_id)
    REFERENCES ai_media_scripts(id) ON DELETE CASCADE
);

CREATE TABLE ai_media_video_projects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), owner_user_id text NOT NULL,
  workspace_id text NOT NULL DEFAULT 'personal', influencer_id uuid, script_id uuid, script_variant_id uuid,
  title text NOT NULL, status text NOT NULL DEFAULT 'draft', aspect_ratio text NOT NULL DEFAULT '9:16',
  settings jsonb NOT NULL DEFAULT '{}'::jsonb, created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(), archived_at timestamptz,
  CONSTRAINT ai_media_video_projects_influencer_id_ai_media_influencers_id_fk FOREIGN KEY (influencer_id)
    REFERENCES ai_media_influencers(id) ON DELETE SET NULL,
  CONSTRAINT ai_media_video_projects_script_id_ai_media_scripts_id_fk FOREIGN KEY (script_id)
    REFERENCES ai_media_scripts(id) ON DELETE SET NULL,
  CONSTRAINT ai_media_video_projects_script_variant_id_ai_media_script_variants_id_fk FOREIGN KEY (script_variant_id)
    REFERENCES ai_media_script_variants(id) ON DELETE SET NULL
);

CREATE TABLE ai_media_videos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), owner_user_id text NOT NULL,
  workspace_id text NOT NULL DEFAULT 'personal', project_id uuid NOT NULL, render_job_id uuid, media_asset_id uuid,
  version integer NOT NULL DEFAULT 1, status text NOT NULL DEFAULT 'pending', duration_ms integer,
  width integer, height integer, metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ai_media_videos_project_id_ai_media_video_projects_id_fk FOREIGN KEY (project_id)
    REFERENCES ai_media_video_projects(id) ON DELETE CASCADE
);

CREATE TABLE ai_media_provider_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), owner_user_id text NOT NULL,
  workspace_id text NOT NULL DEFAULT 'personal', provider_key text NOT NULL, display_name text NOT NULL,
  status text NOT NULL DEFAULT 'disconnected', secret_ref text, external_account_id text,
  capabilities jsonb NOT NULL DEFAULT '[]'::jsonb, configuration jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_verified_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE ai_media_provider_resources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), owner_user_id text NOT NULL,
  workspace_id text NOT NULL DEFAULT 'personal', provider_account_id uuid NOT NULL, provider_key text NOT NULL,
  resource_type text NOT NULL, external_resource_id text NOT NULL, display_name text NOT NULL,
  status text NOT NULL DEFAULT 'active', metadata jsonb NOT NULL DEFAULT '{}'::jsonb, synchronized_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ai_media_provider_resources_provider_account_id_ai_media_provider_accounts_id_fk
    FOREIGN KEY (provider_account_id) REFERENCES ai_media_provider_accounts(id) ON DELETE CASCADE
);

CREATE TABLE ai_media_render_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), owner_user_id text NOT NULL,
  workspace_id text NOT NULL DEFAULT 'personal', generation_id uuid NOT NULL DEFAULT gen_random_uuid(),
  project_id uuid, provider_account_id uuid, provider_key text, provider_job_id text,
  idempotency_key text NOT NULL, title text NOT NULL, status text NOT NULL DEFAULT 'pending',
  stage text NOT NULL DEFAULT 'queued', progress integer NOT NULL DEFAULT 0, attempts integer NOT NULL DEFAULT 0,
  retry_count integer NOT NULL DEFAULT 0, max_attempts integer NOT NULL DEFAULT 3, request jsonb NOT NULL,
  result jsonb, output_url text, error_code text, error_message text,
  queued_at timestamptz NOT NULL DEFAULT now(), started_at timestamptz, completed_at timestamptz,
  next_attempt_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ai_media_render_jobs_project_id_ai_media_video_projects_id_fk FOREIGN KEY (project_id)
    REFERENCES ai_media_video_projects(id) ON DELETE SET NULL,
  CONSTRAINT ai_media_render_jobs_provider_account_id_ai_media_provider_accounts_id_fk FOREIGN KEY (provider_account_id)
    REFERENCES ai_media_provider_accounts(id) ON DELETE SET NULL
);

CREATE TABLE ai_media_webhook_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), owner_user_id text NOT NULL,
  workspace_id text NOT NULL DEFAULT 'personal', provider_key text NOT NULL, event_id text NOT NULL,
  provider_job_id text NOT NULL, render_job_id uuid, event_type text NOT NULL, payload jsonb NOT NULL,
  payload_digest text, signature_verified boolean NOT NULL DEFAULT false, status text NOT NULL DEFAULT 'received',
  occurred_at timestamptz NOT NULL, processed_at timestamptz, parked_at timestamptz, processing_error text,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ai_media_webhook_events_render_job_id_ai_media_render_jobs_id_fk FOREIGN KEY (render_job_id)
    REFERENCES ai_media_render_jobs(id) ON DELETE SET NULL
);

CREATE TABLE ai_media_assets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), owner_user_id text NOT NULL,
  workspace_id text NOT NULL DEFAULT 'personal', project_id uuid, render_job_id uuid, kind text NOT NULL,
  storage_provider text NOT NULL, storage_key text NOT NULL, public_url text, mime_type text NOT NULL,
  byte_size bigint, checksum text, width integer, height integer, duration_ms integer,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb, created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(), deleted_at timestamptz,
  CONSTRAINT ai_media_assets_project_id_ai_media_video_projects_id_fk FOREIGN KEY (project_id)
    REFERENCES ai_media_video_projects(id) ON DELETE SET NULL,
  CONSTRAINT ai_media_assets_render_job_id_ai_media_render_jobs_id_fk FOREIGN KEY (render_job_id)
    REFERENCES ai_media_render_jobs(id) ON DELETE SET NULL
);

CREATE TABLE ai_media_publishing_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), owner_user_id text NOT NULL,
  workspace_id text NOT NULL DEFAULT 'personal', video_id uuid NOT NULL, provider_account_id uuid,
  platform text NOT NULL, idempotency_key text NOT NULL, status text NOT NULL DEFAULT 'pending_approval',
  approval_status text NOT NULL DEFAULT 'required', scheduled_for timestamptz, attempts integer NOT NULL DEFAULT 0,
  max_attempts integer NOT NULL DEFAULT 3, request jsonb NOT NULL DEFAULT '{}'::jsonb, error_message text,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), completed_at timestamptz,
  CONSTRAINT ai_media_publishing_jobs_video_id_ai_media_videos_id_fk FOREIGN KEY (video_id)
    REFERENCES ai_media_videos(id) ON DELETE CASCADE,
  CONSTRAINT ai_media_publishing_jobs_provider_account_id_ai_media_provider_accounts_id_fk FOREIGN KEY (provider_account_id)
    REFERENCES ai_media_provider_accounts(id) ON DELETE SET NULL
);

CREATE TABLE ai_media_publications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), owner_user_id text NOT NULL,
  workspace_id text NOT NULL DEFAULT 'personal', publishing_job_id uuid NOT NULL, video_id uuid NOT NULL,
  platform text NOT NULL, external_publication_id text NOT NULL, status text NOT NULL DEFAULT 'published',
  permalink text, published_at timestamptz, metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ai_media_publications_publishing_job_id_ai_media_publishing_jobs_id_fk FOREIGN KEY (publishing_job_id)
    REFERENCES ai_media_publishing_jobs(id) ON DELETE CASCADE,
  CONSTRAINT ai_media_publications_video_id_ai_media_videos_id_fk FOREIGN KEY (video_id)
    REFERENCES ai_media_videos(id) ON DELETE CASCADE
);

CREATE TABLE ai_media_analytics_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), owner_user_id text NOT NULL,
  workspace_id text NOT NULL DEFAULT 'personal', publication_id uuid NOT NULL, captured_at timestamptz NOT NULL,
  views bigint NOT NULL DEFAULT 0, impressions bigint NOT NULL DEFAULT 0, likes bigint NOT NULL DEFAULT 0,
  comments bigint NOT NULL DEFAULT 0, shares bigint NOT NULL DEFAULT 0, watch_time_ms bigint NOT NULL DEFAULT 0,
  metrics jsonb NOT NULL DEFAULT '{}'::jsonb, created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ai_media_analytics_snapshots_publication_id_ai_media_publications_id_fk FOREIGN KEY (publication_id)
    REFERENCES ai_media_publications(id) ON DELETE CASCADE
);

CREATE TABLE ai_media_analytics_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), owner_user_id text NOT NULL,
  workspace_id text NOT NULL DEFAULT 'personal', publication_id uuid, source text NOT NULL, external_event_id text,
  event_type text NOT NULL, occurred_at timestamptz NOT NULL, dimensions jsonb NOT NULL DEFAULT '{}'::jsonb,
  metrics jsonb NOT NULL DEFAULT '{}'::jsonb, created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ai_media_analytics_events_publication_id_ai_media_publications_id_fk FOREIGN KEY (publication_id)
    REFERENCES ai_media_publications(id) ON DELETE CASCADE
);

CREATE TABLE ai_media_generation_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), owner_user_id text NOT NULL,
  workspace_id text NOT NULL DEFAULT 'personal', generation_type text NOT NULL, model_provider text NOT NULL,
  model_name text NOT NULL, prompt_digest text NOT NULL, prompt_template_id text,
  request jsonb NOT NULL DEFAULT '{}'::jsonb, response jsonb, status text NOT NULL, latency_ms integer,
  input_tokens integer, output_tokens integer, error_code text, created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);

CREATE TABLE ai_media_cost_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), owner_user_id text NOT NULL,
  workspace_id text NOT NULL DEFAULT 'personal', idempotency_key text NOT NULL, provider_key text NOT NULL,
  service text NOT NULL, operation text NOT NULL, render_job_id uuid, generation_history_id uuid,
  quantity numeric(18,6) NOT NULL DEFAULT '1', unit text NOT NULL DEFAULT 'request',
  amount_usd numeric(18,6) NOT NULL DEFAULT '0', estimated boolean NOT NULL DEFAULT true,
  occurred_at timestamptz NOT NULL DEFAULT now(), metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ai_media_cost_ledger_render_job_id_ai_media_render_jobs_id_fk FOREIGN KEY (render_job_id)
    REFERENCES ai_media_render_jobs(id) ON DELETE SET NULL,
  CONSTRAINT ai_media_cost_ledger_generation_history_id_ai_media_generation_history_id_fk FOREIGN KEY (generation_history_id)
    REFERENCES ai_media_generation_history(id) ON DELETE SET NULL
);

CREATE TABLE ai_media_source_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), owner_user_id text NOT NULL,
  workspace_id text NOT NULL DEFAULT 'personal', source_type text NOT NULL, external_id text NOT NULL,
  canonical_url text, title text, content text, rights_status text NOT NULL DEFAULT 'unknown',
  status text NOT NULL DEFAULT 'discovered', source_published_at timestamptz,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb, created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE ai_media_outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), owner_user_id text NOT NULL,
  workspace_id text NOT NULL DEFAULT 'personal', idempotency_key text NOT NULL, aggregate_type text NOT NULL,
  aggregate_id text NOT NULL, event_type text NOT NULL, payload jsonb NOT NULL,
  status text NOT NULL DEFAULT 'pending', attempts integer NOT NULL DEFAULT 0,
  available_at timestamptz NOT NULL DEFAULT now(), locked_at timestamptz, processed_at timestamptz,
  last_error text, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX ai_media_influencers_owner_workspace_slug_uq ON ai_media_influencers (owner_user_id, workspace_id, slug);
CREATE INDEX ai_media_influencers_owner_workspace_status_idx ON ai_media_influencers (owner_user_id, workspace_id, status);
CREATE INDEX ai_media_scripts_owner_workspace_updated_idx ON ai_media_scripts (owner_user_id, workspace_id, updated_at);
CREATE INDEX ai_media_scripts_influencer_idx ON ai_media_scripts (influencer_id);
CREATE UNIQUE INDEX ai_media_script_variants_script_version_uq ON ai_media_script_variants (script_id, version);
CREATE INDEX ai_media_script_variants_owner_workspace_script_idx ON ai_media_script_variants (owner_user_id, workspace_id, script_id);
CREATE INDEX ai_media_video_projects_owner_workspace_status_updated_idx ON ai_media_video_projects (owner_user_id, workspace_id, status, updated_at);
CREATE UNIQUE INDEX ai_media_videos_project_version_uq ON ai_media_videos (project_id, version);
CREATE INDEX ai_media_videos_owner_workspace_status_idx ON ai_media_videos (owner_user_id, workspace_id, status);
CREATE UNIQUE INDEX ai_media_provider_accounts_owner_workspace_provider_uq ON ai_media_provider_accounts (owner_user_id, workspace_id, provider_key);
CREATE INDEX ai_media_provider_accounts_provider_status_idx ON ai_media_provider_accounts (provider_key, status);
CREATE UNIQUE INDEX ai_media_provider_resources_provider_external_uq ON ai_media_provider_resources (provider_account_id, resource_type, external_resource_id);
CREATE INDEX ai_media_provider_resources_owner_workspace_type_idx ON ai_media_provider_resources (owner_user_id, workspace_id, resource_type);
CREATE UNIQUE INDEX ai_media_render_jobs_owner_workspace_idempotency_uq ON ai_media_render_jobs (owner_user_id, workspace_id, idempotency_key);
CREATE UNIQUE INDEX ai_media_render_jobs_provider_job_uq ON ai_media_render_jobs (provider_key, provider_job_id);
CREATE INDEX ai_media_render_jobs_owner_workspace_created_idx ON ai_media_render_jobs (owner_user_id, workspace_id, created_at);
CREATE INDEX ai_media_render_jobs_queue_idx ON ai_media_render_jobs (status, next_attempt_at, created_at);
CREATE UNIQUE INDEX ai_media_webhook_events_provider_event_uq ON ai_media_webhook_events (provider_key, event_id);
CREATE INDEX ai_media_webhook_events_provider_job_status_idx ON ai_media_webhook_events (provider_key, provider_job_id, status);
CREATE INDEX ai_media_webhook_events_owner_workspace_occurred_idx ON ai_media_webhook_events (owner_user_id, workspace_id, occurred_at);
CREATE UNIQUE INDEX ai_media_assets_storage_object_uq ON ai_media_assets (storage_provider, storage_key);
CREATE INDEX ai_media_assets_owner_workspace_project_idx ON ai_media_assets (owner_user_id, workspace_id, project_id);
CREATE UNIQUE INDEX ai_media_publishing_jobs_owner_workspace_idempotency_uq ON ai_media_publishing_jobs (owner_user_id, workspace_id, idempotency_key);
CREATE INDEX ai_media_publishing_jobs_dispatch_idx ON ai_media_publishing_jobs (status, approval_status, scheduled_for);
CREATE UNIQUE INDEX ai_media_publications_platform_external_uq ON ai_media_publications (platform, external_publication_id);
CREATE INDEX ai_media_publications_owner_workspace_published_idx ON ai_media_publications (owner_user_id, workspace_id, published_at);
CREATE UNIQUE INDEX ai_media_analytics_snapshots_publication_captured_uq ON ai_media_analytics_snapshots (publication_id, captured_at);
CREATE INDEX ai_media_analytics_snapshots_owner_workspace_captured_idx ON ai_media_analytics_snapshots (owner_user_id, workspace_id, captured_at);
CREATE UNIQUE INDEX ai_media_analytics_events_source_external_uq ON ai_media_analytics_events (source, external_event_id);
CREATE INDEX ai_media_analytics_events_owner_workspace_occurred_idx ON ai_media_analytics_events (owner_user_id, workspace_id, occurred_at);
CREATE INDEX ai_media_generation_history_owner_workspace_created_idx ON ai_media_generation_history (owner_user_id, workspace_id, created_at);
CREATE UNIQUE INDEX ai_media_cost_ledger_owner_workspace_idempotency_uq ON ai_media_cost_ledger (owner_user_id, workspace_id, idempotency_key);
CREATE INDEX ai_media_cost_ledger_owner_workspace_occurred_idx ON ai_media_cost_ledger (owner_user_id, workspace_id, occurred_at);
CREATE UNIQUE INDEX ai_media_source_items_owner_workspace_source_external_uq ON ai_media_source_items (owner_user_id, workspace_id, source_type, external_id);
CREATE INDEX ai_media_source_items_owner_workspace_status_idx ON ai_media_source_items (owner_user_id, workspace_id, status);
CREATE UNIQUE INDEX ai_media_outbox_owner_workspace_idempotency_uq ON ai_media_outbox (owner_user_id, workspace_id, idempotency_key);
CREATE INDEX ai_media_outbox_dispatch_idx ON ai_media_outbox (status, available_at, created_at);
CREATE INDEX ai_media_outbox_aggregate_idx ON ai_media_outbox (aggregate_type, aggregate_id, created_at);

DO $postflight$
DECLARE
  column_fingerprint text;
  index_fingerprint text;
  foreign_key_fingerprint text;
BEGIN
  IF (SELECT count(*) FROM pg_class relation
      JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
      WHERE namespace.nspname = 'public' AND relation.relname LIKE 'ai_media_%'
        AND relation.relkind = 'r') <> 18 THEN
    RAISE EXCEPTION 'PR1 postflight failed: expected exactly 18 baseline tables';
  END IF;

  IF (SELECT count(*) FROM pg_constraint constraint_record
      JOIN pg_class relation ON relation.oid = constraint_record.conrelid
      JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
      WHERE namespace.nspname = 'public' AND relation.relname LIKE 'ai_media_%'
        AND constraint_record.contype = 'p') <> 18
     OR (SELECT count(*) FROM pg_constraint constraint_record
         JOIN pg_class relation ON relation.oid = constraint_record.conrelid
         JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
         WHERE namespace.nspname = 'public' AND relation.relname LIKE 'ai_media_%'
           AND constraint_record.contype = 'f') <> 20 THEN
    RAISE EXCEPTION 'PR1 postflight failed: expected exactly 18 primary keys and 20 foreign keys';
  END IF;

  IF (SELECT count(*) FROM pg_indexes
      WHERE schemaname = 'public' AND tablename LIKE 'ai_media_%') <> 56
     OR (SELECT count(*) FROM pg_indexes
         WHERE schemaname = 'public' AND tablename LIKE 'ai_media_%'
           AND indexname NOT LIKE '%_pkey') <> 38 THEN
    RAISE EXCEPTION 'PR1 postflight failed: expected 38 historical indexes plus 18 primary-key indexes';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_attribute attribute
    JOIN pg_class relation ON relation.oid = attribute.attrelid
    JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
    JOIN pg_type type_record ON type_record.oid = attribute.atttypid
    WHERE namespace.nspname = 'public' AND relation.relname LIKE 'ai_media_%'
      AND attribute.attnum > 0 AND NOT attribute.attisdropped
      AND type_record.typtype = 'e'
  ) THEN
    RAISE EXCEPTION 'PR1 postflight failed: historical schema contains no enum columns';
  END IF;

  SELECT encode(public.digest(string_agg(
    relation.relname || '.' || attribute.attnum || ':' || attribute.attname || ':' ||
    pg_catalog.format_type(attribute.atttypid, attribute.atttypmod) || ':' ||
    attribute.attnotnull || ':' || coalesce(pg_get_expr(default_record.adbin, default_record.adrelid), ''),
    E'\n' ORDER BY relation.relname, attribute.attnum
  ), 'sha256'), 'hex')
  INTO column_fingerprint
  FROM pg_attribute attribute
  JOIN pg_class relation ON relation.oid = attribute.attrelid
  JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
  LEFT JOIN pg_attrdef default_record
    ON default_record.adrelid = attribute.attrelid AND default_record.adnum = attribute.attnum
  WHERE namespace.nspname = 'public' AND relation.relname LIKE 'ai_media_%'
    AND relation.relkind = 'r' AND attribute.attnum > 0 AND NOT attribute.attisdropped;

  SELECT encode(public.digest(string_agg(
    tablename || ':' || indexname || ':' || indexdef,
    E'\n' ORDER BY tablename, indexname
  ), 'sha256'), 'hex')
  INTO index_fingerprint
  FROM pg_indexes
  WHERE schemaname = 'public' AND tablename LIKE 'ai_media_%'
    AND indexname NOT LIKE '%_pkey';

  SELECT encode(public.digest(string_agg(
    relation.relname || ':' || constraint_record.conname || ':' ||
    pg_get_constraintdef(constraint_record.oid),
    E'\n' ORDER BY relation.relname, constraint_record.conname
  ), 'sha256'), 'hex')
  INTO foreign_key_fingerprint
  FROM pg_constraint constraint_record
  JOIN pg_class relation ON relation.oid = constraint_record.conrelid
  JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
  WHERE namespace.nspname = 'public' AND relation.relname LIKE 'ai_media_%'
    AND constraint_record.contype = 'f';

  -- Newly created defaults deparse with transaction-local qualification until
  -- commit; the rollback checks the stable post-commit fingerprint instead.
  IF column_fingerprint <> '81facb19ea146bdd3faf403650edb3064bfe8a12b2002c7b97de479a83a80f28'
     OR index_fingerprint <> 'c495ee80e41e12b1bcf51d35a2a83bed9eebc3c6b39eb17e4c21c796e6441aba'
     OR foreign_key_fingerprint <> 'dcb67afbd74aff62b17a7c2594452956d1a6250756b9ff839f5830dfef2c85ac' THEN
    RAISE EXCEPTION 'PR1 postflight failed: catalog differs from the historical schema';
  END IF;
END;
$postflight$;

COMMIT;
