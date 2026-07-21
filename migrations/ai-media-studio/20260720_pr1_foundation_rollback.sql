-- Destructive rollback for the exact, empty, PR1-only AI Media Studio schema.
-- This is not a general downgrade. It fails closed on data, later schema
-- objects, structural drift, or external dependencies. pgcrypto is retained.

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15min';
SET LOCAL search_path = public, pg_catalog;

DO $preflight$
DECLARE
  table_name text;
  has_rows boolean;
  column_fingerprint text;
  index_fingerprint text;
  foreign_key_fingerprint text;
  baseline_tables constant text[] := ARRAY[
    'ai_media_influencers', 'ai_media_scripts', 'ai_media_script_variants',
    'ai_media_video_projects', 'ai_media_videos', 'ai_media_provider_accounts',
    'ai_media_provider_resources', 'ai_media_render_jobs', 'ai_media_webhook_events',
    'ai_media_assets', 'ai_media_publishing_jobs', 'ai_media_publications',
    'ai_media_analytics_snapshots', 'ai_media_analytics_events',
    'ai_media_generation_history', 'ai_media_cost_ledger',
    'ai_media_source_items', 'ai_media_outbox'
  ];
  baseline_indexes constant text[] := ARRAY[
    'ai_media_influencers_owner_workspace_slug_uq', 'ai_media_influencers_owner_workspace_status_idx',
    'ai_media_scripts_owner_workspace_updated_idx', 'ai_media_scripts_influencer_idx',
    'ai_media_script_variants_script_version_uq', 'ai_media_script_variants_owner_workspace_script_idx',
    'ai_media_video_projects_owner_workspace_status_updated_idx', 'ai_media_videos_project_version_uq',
    'ai_media_videos_owner_workspace_status_idx', 'ai_media_provider_accounts_owner_workspace_provider_uq',
    'ai_media_provider_accounts_provider_status_idx', 'ai_media_provider_resources_provider_external_uq',
    'ai_media_provider_resources_owner_workspace_type_idx', 'ai_media_render_jobs_owner_workspace_idempotency_uq',
    'ai_media_render_jobs_provider_job_uq', 'ai_media_render_jobs_owner_workspace_created_idx',
    'ai_media_render_jobs_queue_idx', 'ai_media_webhook_events_provider_event_uq',
    'ai_media_webhook_events_provider_job_status_idx', 'ai_media_webhook_events_owner_workspace_occurred_idx',
    'ai_media_assets_storage_object_uq', 'ai_media_assets_owner_workspace_project_idx',
    'ai_media_publishing_jobs_owner_workspace_idempotency_uq', 'ai_media_publishing_jobs_dispatch_idx',
    'ai_media_publications_platform_external_uq', 'ai_media_publications_owner_workspace_published_idx',
    'ai_media_analytics_snapshots_publication_captured_uq', 'ai_media_analytics_snapshots_owner_workspace_captured_idx',
    'ai_media_analytics_events_source_external_uq', 'ai_media_analytics_events_owner_workspace_occurred_idx',
    'ai_media_generation_history_owner_workspace_created_idx', 'ai_media_cost_ledger_owner_workspace_idempotency_uq',
    'ai_media_cost_ledger_owner_workspace_occurred_idx', 'ai_media_source_items_owner_workspace_source_external_uq',
    'ai_media_source_items_owner_workspace_status_idx', 'ai_media_outbox_owner_workspace_idempotency_uq',
    'ai_media_outbox_dispatch_idx', 'ai_media_outbox_aggregate_idx'
  ];
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname LIKE 'ai_media_%'
      AND c.relkind IN ('r', 'p', 'v', 'm', 'S', 'f')
      AND NOT (c.relname = ANY (baseline_tables))
  ) THEN
    RAISE EXCEPTION 'PR1 rollback blocked: later or foreign ai_media relations exist';
  END IF;

  FOREACH table_name IN ARRAY baseline_tables LOOP
    IF to_regclass(format('public.%I', table_name)) IS NULL THEN
      RAISE EXCEPTION 'PR1 rollback blocked: public.% is missing', table_name;
    END IF;
    EXECUTE format('SELECT EXISTS (SELECT 1 FROM public.%I LIMIT 1)', table_name)
      INTO STRICT has_rows;
    IF has_rows THEN
      RAISE EXCEPTION 'PR1 rollback blocked: public.% contains rows', table_name;
    END IF;
  END LOOP;

  IF (SELECT count(*) FROM pg_attribute a
      JOIN pg_class c ON c.oid = a.attrelid JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = ANY (baseline_tables)
        AND a.attnum > 0 AND NOT a.attisdropped) <> 274 THEN
    RAISE EXCEPTION 'PR1 rollback blocked: baseline column set has drifted';
  END IF;

  IF (SELECT count(*) FROM pg_constraint con
      JOIN pg_class c ON c.oid = con.conrelid JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = ANY (baseline_tables)) <> 38 THEN
    RAISE EXCEPTION 'PR1 rollback blocked: baseline constraints have drifted';
  END IF;

  IF (SELECT count(*) FROM pg_indexes
      WHERE schemaname = 'public' AND tablename = ANY (baseline_tables)) <> 56
     OR EXISTS (
       SELECT expected FROM unnest(baseline_indexes) expected
       WHERE to_regclass(format('public.%I', expected)) IS NULL
     ) THEN
    RAISE EXCEPTION 'PR1 rollback blocked: baseline indexes have drifted';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = ANY (baseline_tables) AND NOT t.tgisinternal
  ) OR EXISTS (
    SELECT 1 FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = ANY (baseline_tables)
  ) THEN
    RAISE EXCEPTION 'PR1 rollback blocked: later triggers or policies exist';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_constraint dependency
    JOIN pg_class referenced_relation ON referenced_relation.oid = dependency.confrelid
    JOIN pg_namespace referenced_namespace ON referenced_namespace.oid = referenced_relation.relnamespace
    JOIN pg_class dependent_relation ON dependent_relation.oid = dependency.conrelid
    WHERE dependency.contype = 'f' AND referenced_namespace.nspname = 'public'
      AND referenced_relation.relname = ANY (baseline_tables)
      AND NOT (dependent_relation.relname = ANY (baseline_tables))
  ) THEN
    RAISE EXCEPTION 'PR1 rollback blocked: external foreign-key dependencies exist';
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
  WHERE namespace.nspname = 'public' AND relation.relname = ANY (baseline_tables)
    AND relation.relkind = 'r' AND attribute.attnum > 0 AND NOT attribute.attisdropped;

  SELECT encode(public.digest(string_agg(
    tablename || ':' || indexname || ':' || indexdef,
    E'\n' ORDER BY tablename, indexname
  ), 'sha256'), 'hex')
  INTO index_fingerprint
  FROM pg_indexes
  WHERE schemaname = 'public' AND tablename = ANY (baseline_tables)
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
  WHERE namespace.nspname = 'public' AND relation.relname = ANY (baseline_tables)
    AND constraint_record.contype = 'f';

  IF column_fingerprint <> '81facb19ea146bdd3faf403650edb3064bfe8a12b2002c7b97de479a83a80f28'
     OR index_fingerprint <> 'c495ee80e41e12b1bcf51d35a2a83bed9eebc3c6b39eb17e4c21c796e6441aba'
     OR foreign_key_fingerprint <> 'dcb67afbd74aff62b17a7c2594452956d1a6250756b9ff839f5830dfef2c85ac' THEN
    RAISE EXCEPTION 'PR1 rollback blocked: catalog is not the exact historical PR1 schema';
  END IF;
END;
$preflight$;

DROP TABLE ai_media_cost_ledger RESTRICT;
DROP TABLE ai_media_analytics_events RESTRICT;
DROP TABLE ai_media_analytics_snapshots RESTRICT;
DROP TABLE ai_media_publications RESTRICT;
DROP TABLE ai_media_publishing_jobs RESTRICT;
DROP TABLE ai_media_assets RESTRICT;
DROP TABLE ai_media_webhook_events RESTRICT;
DROP TABLE ai_media_render_jobs RESTRICT;
DROP TABLE ai_media_provider_resources RESTRICT;
DROP TABLE ai_media_provider_accounts RESTRICT;
DROP TABLE ai_media_videos RESTRICT;
DROP TABLE ai_media_video_projects RESTRICT;
DROP TABLE ai_media_script_variants RESTRICT;
DROP TABLE ai_media_scripts RESTRICT;
DROP TABLE ai_media_influencers RESTRICT;
DROP TABLE ai_media_generation_history RESTRICT;
DROP TABLE ai_media_source_items RESTRICT;
DROP TABLE ai_media_outbox RESTRICT;

COMMIT;
