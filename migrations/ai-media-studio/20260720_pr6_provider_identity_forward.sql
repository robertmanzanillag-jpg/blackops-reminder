-- AI Media Studio PR6 provider-account identity: reviewed additive migration only.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15min';
SET LOCAL search_path = public, pg_catalog;

DO $preflight$
DECLARE required_table text;
BEGIN
  FOREACH required_table IN ARRAY ARRAY[
    'ai_media_provider_accounts', 'ai_media_render_jobs', 'ai_media_webhook_events'
  ] LOOP
    IF to_regclass('public.' || required_table) IS NULL THEN
      RAISE EXCEPTION 'PR6 provider identity requires existing table %', required_table;
    END IF;
  END LOOP;
END;
$preflight$;

ALTER TABLE ai_media_provider_accounts
  ADD COLUMN IF NOT EXISTS webhook_endpoint_key text,
  ADD COLUMN IF NOT EXISTS webhook_secret_ref text,
  ADD COLUMN IF NOT EXISTS webhook_previous_secret_ref text,
  ADD COLUMN IF NOT EXISTS webhook_previous_secret_expires_at timestamptz;

ALTER TABLE ai_media_webhook_events
  ADD COLUMN IF NOT EXISTS provider_account_id uuid;

-- Candidate keys support tenant/provider composite foreign keys. None of these
-- indexes contain secret material.
CREATE UNIQUE INDEX IF NOT EXISTS ai_media_provider_accounts_owner_workspace_id_uq
  ON ai_media_provider_accounts (owner_user_id, workspace_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS ai_media_provider_accounts_owner_workspace_id_provider_uq
  ON ai_media_provider_accounts (owner_user_id, workspace_id, id, provider_key);
CREATE UNIQUE INDEX IF NOT EXISTS ai_media_render_jobs_owner_workspace_id_uq
  ON ai_media_render_jobs (owner_user_id, workspace_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS ai_media_render_jobs_owner_workspace_provider_account_job_uq
  ON ai_media_render_jobs (owner_user_id, workspace_id, provider_account_id, provider_key, id);

DO $legacy_identity_preflight$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM ai_media_render_jobs AS jobs
    WHERE jobs.provider_account_id IS NULL
      AND jobs.provider_key IS NOT NULL
      AND (
        SELECT count(*)
        FROM ai_media_provider_accounts AS accounts
        WHERE accounts.owner_user_id = jobs.owner_user_id
          AND accounts.workspace_id = jobs.workspace_id
          AND accounts.provider_key = jobs.provider_key
      ) > 1
  ) THEN
    RAISE EXCEPTION 'ambiguous legacy provider accounts block deterministic PR6 render backfill; restore one account per tenant/provider or set exact provider_account_id before retrying';
  END IF;
END;
$legacy_identity_preflight$;

-- A render can be backfilled only through the exact tenant/provider account.
-- Before PR6 that tuple was unique, so this is deterministic rather than a
-- "first account" guess. Rows without a provider submission may remain null.
UPDATE ai_media_render_jobs AS jobs
SET provider_account_id = accounts.id,
    updated_at = now()
FROM ai_media_provider_accounts AS accounts
WHERE jobs.provider_account_id IS NULL
  AND jobs.provider_key IS NOT NULL
  AND accounts.owner_user_id = jobs.owner_user_id
  AND accounts.workspace_id = jobs.workspace_id
  AND accounts.provider_key = jobs.provider_key;

-- Webhook identity is recoverable only from its exact render relation or from
-- an unambiguous provider job. Unmatched parked callbacks abort the migration;
-- PR6 never assigns them to a merely plausible account.
UPDATE ai_media_webhook_events AS events
SET provider_account_id = jobs.provider_account_id,
    owner_user_id = jobs.owner_user_id,
    workspace_id = jobs.workspace_id,
    provider_key = jobs.provider_key,
    updated_at = now()
FROM ai_media_render_jobs AS jobs
WHERE events.provider_account_id IS NULL
  AND events.render_job_id = jobs.id
  AND jobs.provider_account_id IS NOT NULL
  AND events.provider_key = jobs.provider_key;

UPDATE ai_media_webhook_events AS events
SET provider_account_id = jobs.provider_account_id,
    owner_user_id = jobs.owner_user_id,
    workspace_id = jobs.workspace_id,
    render_job_id = jobs.id,
    updated_at = now()
FROM ai_media_render_jobs AS jobs
WHERE events.provider_account_id IS NULL
  AND jobs.provider_account_id IS NOT NULL
  AND events.provider_key = jobs.provider_key
  AND events.provider_job_id = jobs.provider_job_id
  AND (
    SELECT count(*)
    FROM ai_media_render_jobs AS candidate
    WHERE candidate.provider_account_id IS NOT NULL
      AND candidate.provider_key = events.provider_key
      AND candidate.provider_job_id = events.provider_job_id
  ) = 1;

DO $identity_preflight$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM ai_media_render_jobs
    WHERE provider_job_id IS NOT NULL AND provider_account_id IS NULL
  ) THEN
    RAISE EXCEPTION 'unresolved submitted/live render provider accounts block PR6; configure the exact account before retrying';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM ai_media_webhook_events
    WHERE provider_account_id IS NULL
  ) THEN
    RAISE EXCEPTION 'unresolved webhook provider accounts block PR6; export and reconcile exact account ownership before retrying';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM ai_media_render_jobs AS jobs
    LEFT JOIN ai_media_provider_accounts AS accounts
      ON accounts.owner_user_id = jobs.owner_user_id
      AND accounts.workspace_id = jobs.workspace_id
      AND accounts.id = jobs.provider_account_id
      AND accounts.provider_key = jobs.provider_key
    WHERE jobs.provider_account_id IS NOT NULL AND accounts.id IS NULL
  ) THEN
    RAISE EXCEPTION 'orphaned, cross-tenant, or provider-mismatched render accounts block PR6';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM ai_media_webhook_events AS events
    LEFT JOIN ai_media_provider_accounts AS accounts
      ON accounts.owner_user_id = events.owner_user_id
      AND accounts.workspace_id = events.workspace_id
      AND accounts.id = events.provider_account_id
      AND accounts.provider_key = events.provider_key
    WHERE accounts.id IS NULL
  ) THEN
    RAISE EXCEPTION 'orphaned, cross-tenant, or provider-mismatched webhook accounts block PR6';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM ai_media_render_jobs
    WHERE provider_job_id IS NOT NULL
    GROUP BY provider_account_id, provider_key, provider_job_id
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'duplicate provider jobs inside one provider account block PR6';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM ai_media_webhook_events
    GROUP BY provider_account_id, provider_key, event_id
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'duplicate webhook events inside one provider account block PR6';
  END IF;
END;
$identity_preflight$;

ALTER TABLE ai_media_webhook_events
  ALTER COLUMN provider_account_id SET NOT NULL;

DO $constraints$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'ai_media_provider_accounts_webhook_metadata_ck'
      AND conrelid = 'public.ai_media_provider_accounts'::regclass
  ) THEN
    ALTER TABLE ai_media_provider_accounts
      ADD CONSTRAINT ai_media_provider_accounts_webhook_metadata_ck
      CHECK (
        ((webhook_endpoint_key IS NULL) = (webhook_secret_ref IS NULL))
        AND (webhook_endpoint_key IS NULL OR (
          length(btrim(webhook_endpoint_key)) BETWEEN 24 AND 128
          AND webhook_endpoint_key ~ '^[A-Za-z0-9_-]+$'
          AND length(btrim(webhook_secret_ref)) BETWEEN 1 AND 500
        ))
        AND ((webhook_previous_secret_ref IS NULL) = (webhook_previous_secret_expires_at IS NULL))
        AND (webhook_previous_secret_ref IS NULL OR webhook_secret_ref IS NOT NULL)
        AND (webhook_previous_secret_ref IS NULL
          OR length(btrim(webhook_previous_secret_ref)) BETWEEN 1 AND 500)
      ) NOT VALID;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'ai_media_render_jobs_provider_account_tenant_fk'
      AND conrelid = 'public.ai_media_render_jobs'::regclass
  ) THEN
    ALTER TABLE ai_media_render_jobs
      ADD CONSTRAINT ai_media_render_jobs_provider_account_tenant_fk
      FOREIGN KEY (owner_user_id, workspace_id, provider_account_id, provider_key)
      REFERENCES ai_media_provider_accounts (owner_user_id, workspace_id, id, provider_key)
      ON DELETE RESTRICT NOT VALID;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'ai_media_render_jobs_provider_identity_ck'
      AND conrelid = 'public.ai_media_render_jobs'::regclass
  ) THEN
    ALTER TABLE ai_media_render_jobs
      ADD CONSTRAINT ai_media_render_jobs_provider_identity_ck
      CHECK (provider_job_id IS NULL OR (provider_account_id IS NOT NULL AND provider_key IS NOT NULL))
      NOT VALID;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'ai_media_webhook_events_provider_account_tenant_fk'
      AND conrelid = 'public.ai_media_webhook_events'::regclass
  ) THEN
    ALTER TABLE ai_media_webhook_events
      ADD CONSTRAINT ai_media_webhook_events_provider_account_tenant_fk
      FOREIGN KEY (owner_user_id, workspace_id, provider_account_id, provider_key)
      REFERENCES ai_media_provider_accounts (owner_user_id, workspace_id, id, provider_key)
      ON DELETE RESTRICT NOT VALID;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'ai_media_webhook_events_render_job_identity_fk'
      AND conrelid = 'public.ai_media_webhook_events'::regclass
  ) THEN
    ALTER TABLE ai_media_webhook_events
      ADD CONSTRAINT ai_media_webhook_events_render_job_identity_fk
      FOREIGN KEY (owner_user_id, workspace_id, provider_account_id, provider_key, render_job_id)
      REFERENCES ai_media_render_jobs (owner_user_id, workspace_id, provider_account_id, provider_key, id)
      ON DELETE RESTRICT NOT VALID;
  END IF;
END;
$constraints$;

ALTER TABLE ai_media_provider_accounts
  VALIDATE CONSTRAINT ai_media_provider_accounts_webhook_metadata_ck;
ALTER TABLE ai_media_render_jobs
  VALIDATE CONSTRAINT ai_media_render_jobs_provider_account_tenant_fk;
ALTER TABLE ai_media_render_jobs
  VALIDATE CONSTRAINT ai_media_render_jobs_provider_identity_ck;
ALTER TABLE ai_media_webhook_events
  VALIDATE CONSTRAINT ai_media_webhook_events_provider_account_tenant_fk;
ALTER TABLE ai_media_webhook_events
  VALIDATE CONSTRAINT ai_media_webhook_events_render_job_identity_fk;

CREATE UNIQUE INDEX IF NOT EXISTS ai_media_provider_accounts_owner_workspace_provider_external_uq
  ON ai_media_provider_accounts (owner_user_id, workspace_id, provider_key, external_account_id)
  WHERE external_account_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS ai_media_provider_accounts_provider_endpoint_uq
  ON ai_media_provider_accounts (provider_key, webhook_endpoint_key)
  WHERE webhook_endpoint_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS ai_media_provider_accounts_owner_workspace_provider_status_idx
  ON ai_media_provider_accounts (owner_user_id, workspace_id, provider_key, status);
CREATE UNIQUE INDEX IF NOT EXISTS ai_media_render_jobs_provider_account_job_uq
  ON ai_media_render_jobs (provider_account_id, provider_key, provider_job_id)
  WHERE provider_job_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS ai_media_webhook_events_provider_account_event_uq
  ON ai_media_webhook_events (provider_account_id, provider_key, event_id);
CREATE INDEX IF NOT EXISTS ai_media_webhook_events_provider_account_job_status_idx
  ON ai_media_webhook_events (provider_account_id, provider_key, provider_job_id, status);

-- Only after account-scoped replacements exist may the global definitions be
-- removed. This unlocks multiple accounts for one provider in the same tenant.
DROP INDEX IF EXISTS ai_media_render_jobs_provider_job_uq;
DROP INDEX IF EXISTS ai_media_webhook_events_provider_event_uq;
DROP INDEX IF EXISTS ai_media_webhook_events_provider_job_status_idx;
DROP INDEX IF EXISTS ai_media_provider_accounts_owner_workspace_provider_uq;

COMMIT;
