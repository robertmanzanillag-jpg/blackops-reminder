-- AI Media Studio PR8 publishing-account isolation: reviewed additive migration only.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15min';
SET LOCAL search_path = public, pg_catalog;

DO $preflight$
DECLARE
  required_table text;
  missing_column text;
BEGIN
  FOREACH required_table IN ARRAY ARRAY[
    'ai_media_provider_accounts', 'ai_media_publishing_jobs'
  ] LOOP
    IF to_regclass('public.' || required_table) IS NULL THEN
      RAISE EXCEPTION 'PR8 publishing-account isolation requires existing table %', required_table;
    END IF;
  END LOOP;

  SELECT requirement.column_name
  INTO missing_column
  FROM (VALUES
    ('ai_media_provider_accounts', 'owner_user_id'),
    ('ai_media_provider_accounts', 'workspace_id'),
    ('ai_media_provider_accounts', 'id'),
    ('ai_media_provider_accounts', 'provider_key'),
    ('ai_media_publishing_jobs', 'owner_user_id'),
    ('ai_media_publishing_jobs', 'workspace_id'),
    ('ai_media_publishing_jobs', 'provider_account_id'),
    ('ai_media_publishing_jobs', 'platform')
  ) AS requirement(table_name, column_name)
  WHERE NOT EXISTS (
    SELECT 1
    FROM information_schema.columns AS columns
    WHERE columns.table_schema = 'public'
      AND columns.table_name = requirement.table_name
      AND columns.column_name = requirement.column_name
  )
  LIMIT 1;

  IF missing_column IS NOT NULL THEN
    RAISE EXCEPTION 'PR8 publishing-account isolation requires missing column %', missing_column;
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
      AND indexes.indisunique
      AND indexes.indisvalid
      AND indexes.indpred IS NULL
      AND (
        SELECT array_agg(attribute.attname ORDER BY key.ordinality)
        FROM unnest(indexes.indkey) WITH ORDINALITY AS key(attnum, ordinality)
        JOIN pg_attribute AS attribute
          ON attribute.attrelid = indexes.indrelid
          AND attribute.attnum = key.attnum
      ) = ARRAY['owner_user_id', 'workspace_id', 'id', 'provider_key']::name[]
  ) THEN
    RAISE EXCEPTION 'PR8 publishing-account isolation requires valid PR6 unique index ai_media_provider_accounts_owner_workspace_id_provider_uq';
  END IF;
END;
$preflight$;

-- Nullable jobs remain intentionally unbound. A non-null binding must identify
-- the exact account inside the same tenant/workspace and platform/provider.
-- PR8 never guesses or backfills an account from platform alone.
DO $identity_preflight$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM ai_media_publishing_jobs AS jobs
    LEFT JOIN ai_media_provider_accounts AS accounts
      ON accounts.owner_user_id = jobs.owner_user_id
      AND accounts.workspace_id = jobs.workspace_id
      AND accounts.id = jobs.provider_account_id
      AND accounts.provider_key = jobs.platform
    WHERE jobs.provider_account_id IS NOT NULL
      AND accounts.id IS NULL
  ) THEN
    RAISE EXCEPTION 'orphaned, cross-tenant, or platform-mismatched publishing accounts block PR8';
  END IF;
END;
$identity_preflight$;

DO $constraints$
BEGIN
  -- PostgreSQL truncates the deterministic pre-PR8 Drizzle name to 63 bytes.
  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'ai_media_publishing_jobs_provider_account_id_ai_media_provider_'
      AND conrelid = 'public.ai_media_publishing_jobs'::regclass
      AND contype = 'f'
  ) THEN
    ALTER TABLE ai_media_publishing_jobs
      DROP CONSTRAINT ai_media_publishing_jobs_provider_account_id_ai_media_provider_;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'ai_media_publishing_jobs_provider_account_tenant_platform_fk'
      AND conrelid = 'public.ai_media_publishing_jobs'::regclass
  ) THEN
    ALTER TABLE ai_media_publishing_jobs
      ADD CONSTRAINT ai_media_publishing_jobs_provider_account_tenant_platform_fk
      FOREIGN KEY (owner_user_id, workspace_id, provider_account_id, platform)
      REFERENCES ai_media_provider_accounts (owner_user_id, workspace_id, id, provider_key)
      ON UPDATE NO ACTION
      ON DELETE NO ACTION
      NOT VALID;
  END IF;
END;
$constraints$;

ALTER TABLE ai_media_publishing_jobs
  VALIDATE CONSTRAINT ai_media_publishing_jobs_provider_account_tenant_platform_fk;

COMMIT;
