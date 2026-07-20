-- AI Media Studio PR2 additive migration.
--
-- Prerequisite: the PR1 ai_media_* schema already exists. This file is
-- intentionally not an initial-schema migration. Apply only after a backup and
-- a successful staging rehearsal. Do not use drizzle-kit push for this change.

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15min';
SET LOCAL search_path = public, pg_catalog;

DO $migration$
DECLARE
  required_table text;
BEGIN
  FOREACH required_table IN ARRAY ARRAY[
    'ai_media_influencers',
    'ai_media_provider_resources',
    'ai_media_render_jobs',
    'ai_media_assets'
  ]
  LOOP
    IF to_regclass('public.' || required_table) IS NULL THEN
      RAISE EXCEPTION 'PR2 migration prerequisite missing: public.%', required_table;
    END IF;
  END LOOP;
END;
$migration$;

-- Add required influencer fields as nullable first so historical rows can be
-- backfilled before the NOT NULL constraints are installed.
ALTER TABLE ai_media_influencers
  ADD COLUMN IF NOT EXISTS accent text,
  ADD COLUMN IF NOT EXISTS language text,
  ADD COLUMN IF NOT EXISTS gender text,
  ADD COLUMN IF NOT EXISTS age_range jsonb,
  ADD COLUMN IF NOT EXISTS personality jsonb,
  ADD COLUMN IF NOT EXISTS tone jsonb,
  ADD COLUMN IF NOT EXISTS speaking_style text,
  ADD COLUMN IF NOT EXISTS categories jsonb,
  ADD COLUMN IF NOT EXISTS intro text,
  ADD COLUMN IF NOT EXISTS outro text,
  ADD COLUMN IF NOT EXISTS energy_level integer,
  ADD COLUMN IF NOT EXISTS facial_expressions jsonb,
  ADD COLUMN IF NOT EXISTS brand_colors jsonb;

UPDATE ai_media_influencers
SET
  accent = COALESCE(accent, 'neutral'),
  language = COALESCE(language, 'en'),
  gender = COALESCE(gender, 'unspecified'),
  age_range = COALESCE(age_range, '{"minimum":18,"maximum":65}'::jsonb),
  personality = COALESCE(personality, '[]'::jsonb),
  tone = COALESCE(tone, '[]'::jsonb),
  speaking_style = COALESCE(speaking_style, 'natural'),
  categories = COALESCE(categories, '[]'::jsonb),
  intro = COALESCE(intro, ''),
  outro = COALESCE(outro, ''),
  energy_level = COALESCE(energy_level, 5),
  facial_expressions = COALESCE(facial_expressions, '[]'::jsonb),
  brand_colors = COALESCE(brand_colors, '[]'::jsonb)
WHERE accent IS NULL
   OR language IS NULL
   OR gender IS NULL
   OR age_range IS NULL
   OR personality IS NULL
   OR tone IS NULL
   OR speaking_style IS NULL
   OR categories IS NULL
   OR intro IS NULL
   OR outro IS NULL
   OR energy_level IS NULL
   OR facial_expressions IS NULL
   OR brand_colors IS NULL;

ALTER TABLE ai_media_influencers
  ALTER COLUMN accent SET DEFAULT 'neutral',
  ALTER COLUMN language SET DEFAULT 'en',
  ALTER COLUMN gender SET DEFAULT 'unspecified',
  ALTER COLUMN age_range SET DEFAULT '{"minimum":18,"maximum":65}'::jsonb,
  ALTER COLUMN personality SET DEFAULT '[]'::jsonb,
  ALTER COLUMN tone SET DEFAULT '[]'::jsonb,
  ALTER COLUMN speaking_style SET DEFAULT 'natural',
  ALTER COLUMN categories SET DEFAULT '[]'::jsonb,
  ALTER COLUMN intro SET DEFAULT '',
  ALTER COLUMN outro SET DEFAULT '',
  ALTER COLUMN energy_level SET DEFAULT 5,
  ALTER COLUMN facial_expressions SET DEFAULT '[]'::jsonb,
  ALTER COLUMN brand_colors SET DEFAULT '[]'::jsonb;

ALTER TABLE ai_media_influencers
  ALTER COLUMN accent SET NOT NULL,
  ALTER COLUMN language SET NOT NULL,
  ALTER COLUMN gender SET NOT NULL,
  ALTER COLUMN age_range SET NOT NULL,
  ALTER COLUMN personality SET NOT NULL,
  ALTER COLUMN tone SET NOT NULL,
  ALTER COLUMN speaking_style SET NOT NULL,
  ALTER COLUMN categories SET NOT NULL,
  ALTER COLUMN intro SET NOT NULL,
  ALTER COLUMN outro SET NOT NULL,
  ALTER COLUMN energy_level SET NOT NULL,
  ALTER COLUMN facial_expressions SET NOT NULL,
  ALTER COLUMN brand_colors SET NOT NULL;

-- Historical provider resources did not have a canonical key. Including the
-- provider account in the generated value preserves uniqueness even when two
-- connected accounts expose the same external identifier.
ALTER TABLE ai_media_provider_resources
  ADD COLUMN IF NOT EXISTS canonical_key text;

UPDATE ai_media_provider_resources
SET canonical_key = concat(provider_key, ':', provider_account_id::text, ':', external_resource_id)
WHERE canonical_key IS NULL OR btrim(canonical_key) = '';

ALTER TABLE ai_media_provider_resources
  ALTER COLUMN canonical_key SET NOT NULL;

ALTER TABLE ai_media_render_jobs
  ADD COLUMN IF NOT EXISTS available_at timestamp with time zone,
  ADD COLUMN IF NOT EXISTS lease_owner text,
  ADD COLUMN IF NOT EXISTS lease_expires_at timestamp with time zone,
  ADD COLUMN IF NOT EXISTS dead_letter_at timestamp with time zone;

UPDATE ai_media_render_jobs
SET available_at = COALESCE(available_at, next_attempt_at, queued_at, created_at, now())
WHERE available_at IS NULL;

ALTER TABLE ai_media_render_jobs
  ALTER COLUMN available_at SET DEFAULT now(),
  ALTER COLUMN available_at SET NOT NULL;

ALTER TABLE ai_media_assets
  ADD COLUMN IF NOT EXISTS influencer_id uuid,
  ADD COLUMN IF NOT EXISTS provider_resource_id uuid,
  ADD COLUMN IF NOT EXISTS name text,
  ADD COLUMN IF NOT EXISTS status text,
  ADD COLUMN IF NOT EXISTS thumbnail_url text;

UPDATE ai_media_assets
SET
  name = COALESCE(name, 'Untitled asset'),
  status = COALESCE(status, 'processing')
WHERE name IS NULL OR status IS NULL;

ALTER TABLE ai_media_assets
  ALTER COLUMN name SET DEFAULT 'Untitled asset',
  ALTER COLUMN status SET DEFAULT 'processing',
  ALTER COLUMN name SET NOT NULL,
  ALTER COLUMN status SET NOT NULL;

-- Fail before adding/validating FKs if historical unconstrained references are
-- orphaned. Operators must repair those rows explicitly; this migration never
-- silently deletes or nulls user data.
DO $preflight$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM ai_media_influencers influencer
    LEFT JOIN ai_media_provider_resources resource
      ON resource.id = influencer.default_voice_resource_id
    WHERE influencer.default_voice_resource_id IS NOT NULL
      AND resource.id IS NULL
  ) THEN
    RAISE EXCEPTION 'orphaned ai_media_influencers.default_voice_resource_id values must be repaired';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM ai_media_influencers influencer
    LEFT JOIN ai_media_provider_resources resource
      ON resource.id = influencer.default_avatar_resource_id
    WHERE influencer.default_avatar_resource_id IS NOT NULL
      AND resource.id IS NULL
  ) THEN
    RAISE EXCEPTION 'orphaned ai_media_influencers.default_avatar_resource_id values must be repaired';
  END IF;
END;
$preflight$;

DO $constraints$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'ai_media_influencers_default_voice_resource_fk'
      AND conrelid = 'ai_media_influencers'::regclass
  ) THEN
    ALTER TABLE ai_media_influencers
      ADD CONSTRAINT ai_media_influencers_default_voice_resource_fk
      FOREIGN KEY (default_voice_resource_id) REFERENCES ai_media_provider_resources(id)
      ON DELETE SET NULL NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'ai_media_influencers_default_avatar_resource_fk'
      AND conrelid = 'ai_media_influencers'::regclass
  ) THEN
    ALTER TABLE ai_media_influencers
      ADD CONSTRAINT ai_media_influencers_default_avatar_resource_fk
      FOREIGN KEY (default_avatar_resource_id) REFERENCES ai_media_provider_resources(id)
      ON DELETE SET NULL NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'ai_media_assets_influencer_fk'
      AND conrelid = 'ai_media_assets'::regclass
  ) THEN
    ALTER TABLE ai_media_assets
      ADD CONSTRAINT ai_media_assets_influencer_fk
      FOREIGN KEY (influencer_id) REFERENCES ai_media_influencers(id)
      ON DELETE SET NULL NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'ai_media_assets_provider_resource_fk'
      AND conrelid = 'ai_media_assets'::regclass
  ) THEN
    ALTER TABLE ai_media_assets
      ADD CONSTRAINT ai_media_assets_provider_resource_fk
      FOREIGN KEY (provider_resource_id) REFERENCES ai_media_provider_resources(id)
      ON DELETE SET NULL NOT VALID;
  END IF;
END;
$constraints$;

ALTER TABLE ai_media_influencers VALIDATE CONSTRAINT ai_media_influencers_default_voice_resource_fk;
ALTER TABLE ai_media_influencers VALIDATE CONSTRAINT ai_media_influencers_default_avatar_resource_fk;
ALTER TABLE ai_media_assets VALIDATE CONSTRAINT ai_media_assets_influencer_fk;
ALTER TABLE ai_media_assets VALIDATE CONSTRAINT ai_media_assets_provider_resource_fk;

-- Build replacement indexes before removing their prior definitions. The
-- transaction prevents another session from observing an unindexed state.
CREATE UNIQUE INDEX IF NOT EXISTS ai_media_provider_resources_provider_external_uq_pr2
  ON ai_media_provider_resources
  (owner_user_id, workspace_id, provider_account_id, resource_type, external_resource_id);
DROP INDEX IF EXISTS ai_media_provider_resources_provider_external_uq;
ALTER INDEX ai_media_provider_resources_provider_external_uq_pr2
  RENAME TO ai_media_provider_resources_provider_external_uq;

CREATE UNIQUE INDEX IF NOT EXISTS ai_media_provider_resources_owner_workspace_canonical_uq
  ON ai_media_provider_resources (owner_user_id, workspace_id, resource_type, canonical_key);

-- PostgreSQL does not index referencing columns automatically. These indexes
-- bound the work needed when a provider resource is deleted with SET NULL.
CREATE INDEX IF NOT EXISTS ai_media_influencers_default_voice_resource_idx
  ON ai_media_influencers (default_voice_resource_id);
CREATE INDEX IF NOT EXISTS ai_media_influencers_default_avatar_resource_idx
  ON ai_media_influencers (default_avatar_resource_id);

CREATE INDEX IF NOT EXISTS ai_media_render_jobs_queue_idx_pr2
  ON ai_media_render_jobs (status, available_at, lease_expires_at, created_at);
DROP INDEX IF EXISTS ai_media_render_jobs_queue_idx;
ALTER INDEX ai_media_render_jobs_queue_idx_pr2 RENAME TO ai_media_render_jobs_queue_idx;

CREATE INDEX IF NOT EXISTS ai_media_render_jobs_owner_workspace_lease_idx
  ON ai_media_render_jobs (owner_user_id, workspace_id, lease_owner, lease_expires_at);
CREATE INDEX IF NOT EXISTS ai_media_render_jobs_dead_letter_idx
  ON ai_media_render_jobs (dead_letter_at);

CREATE UNIQUE INDEX IF NOT EXISTS ai_media_assets_storage_object_uq_pr2
  ON ai_media_assets (owner_user_id, workspace_id, storage_provider, storage_key);
DROP INDEX IF EXISTS ai_media_assets_storage_object_uq;
ALTER INDEX ai_media_assets_storage_object_uq_pr2
  RENAME TO ai_media_assets_storage_object_uq;

CREATE INDEX IF NOT EXISTS ai_media_assets_owner_workspace_library_idx
  ON ai_media_assets (owner_user_id, workspace_id, kind, status, created_at);
CREATE INDEX IF NOT EXISTS ai_media_assets_influencer_idx
  ON ai_media_assets (influencer_id);
CREATE INDEX IF NOT EXISTS ai_media_assets_provider_resource_idx
  ON ai_media_assets (provider_resource_id);

COMMIT;
