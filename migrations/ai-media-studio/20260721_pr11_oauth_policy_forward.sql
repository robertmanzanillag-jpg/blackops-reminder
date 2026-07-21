-- AI Media Studio PR11: persist provider-neutral PKCE policy snapshots and harden redirects.
-- Reviewed, additive/data-preserving migration. Do not apply automatically.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15min';
SET LOCAL search_path = public, pg_catalog;

DO $preflight$
DECLARE missing_column text;
BEGIN
  IF to_regclass('public.ai_media_oauth_sessions') IS NULL THEN
    RAISE EXCEPTION 'PR11 OAuth policy requires the PR9 OAuth sessions table';
  END IF;

  SELECT requirement.column_name INTO missing_column
  FROM (VALUES
    ('id'), ('platform'), ('redirect_uri'), ('code_challenge'),
    ('code_challenge_method'), ('pkce_verifier_ref')
  ) AS requirement(column_name)
  WHERE NOT EXISTS (
    SELECT 1
    FROM information_schema.columns AS columns
    WHERE columns.table_schema = 'public'
      AND columns.table_name = 'ai_media_oauth_sessions'
      AND columns.column_name = requirement.column_name
  )
  LIMIT 1;
  IF missing_column IS NOT NULL THEN
    RAISE EXCEPTION 'PR11 OAuth policy requires PR9 session column %', missing_column;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'ai_media_oauth_sessions_redirect_ck'
      AND conrelid = 'public.ai_media_oauth_sessions'::regclass
      AND convalidated
  ) THEN
    RAISE EXCEPTION 'PR11 OAuth policy requires the PR9 redirect constraint';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'ai_media_oauth_sessions_pkce_ck'
      AND conrelid = 'public.ai_media_oauth_sessions'::regclass
      AND convalidated
  ) THEN
    RAISE EXCEPTION 'PR11 OAuth policy requires the validated PR9 PKCE constraint';
  END IF;
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'ai_media_oauth_sessions'
      AND column_name = 'pkce_mode'
  ) THEN
    RAISE EXCEPTION 'PR11 OAuth policy requires pkce_mode to be absent before this migration';
  END IF;
END;
$preflight$;

ALTER TABLE ai_media_oauth_sessions
  ADD COLUMN pkce_mode text;

-- Every PR9 row was created with S256 fields present. Preserve that historical
-- fact as a snapshot; future rows choose the mode from application policy.
UPDATE ai_media_oauth_sessions
SET pkce_mode = 'required_s256'
WHERE pkce_mode IS NULL;

ALTER TABLE ai_media_oauth_sessions
  ALTER COLUMN pkce_mode SET NOT NULL,
  ALTER COLUMN code_challenge DROP NOT NULL,
  ALTER COLUMN code_challenge_method DROP DEFAULT,
  ALTER COLUMN code_challenge_method DROP NOT NULL,
  ALTER COLUMN pkce_verifier_ref DROP NOT NULL;

-- Replace only the PR9 PKCE constraint. Platform names deliberately do not
-- participate: the persisted pkce_mode is the provider-neutral policy snapshot.
ALTER TABLE ai_media_oauth_sessions
  DROP CONSTRAINT ai_media_oauth_sessions_pkce_ck;

ALTER TABLE ai_media_oauth_sessions
  ADD CONSTRAINT ai_media_oauth_sessions_pkce_ck CHECK (
    (
      pkce_mode = 'required_s256'
      AND code_challenge IS NOT NULL
      AND code_challenge_method = 'S256'
      AND length(code_challenge) = 43
      AND code_challenge ~ '^[A-Za-z0-9_-]+$'
      AND pkce_verifier_ref IS NOT NULL
      AND pkce_verifier_ref ~ '^vault://ai-media-studio/oauth-pkce/v1/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    )
    OR (
      pkce_mode = 'none'
      AND code_challenge IS NULL
      AND code_challenge_method IS NULL
      AND pkce_verifier_ref IS NULL
    )
  ) NOT VALID;

ALTER TABLE ai_media_oauth_sessions
  VALIDATE CONSTRAINT ai_media_oauth_sessions_pkce_ck;

DO $trusted_redirect$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'ai_media_oauth_sessions_redirect_trusted_ck'
      AND conrelid = 'public.ai_media_oauth_sessions'::regclass
  ) THEN
    ALTER TABLE ai_media_oauth_sessions
      ADD CONSTRAINT ai_media_oauth_sessions_redirect_trusted_ck CHECK (
        length(redirect_uri) BETWEEN 12 AND 512
        AND redirect_uri !~ '[?#]'
        AND redirect_uri !~ '[[:cntrl:][:space:]]'
        AND position(chr(92) in redirect_uri) = 0
        AND redirect_uri !~ '^https://[^/]*[@:]'
        AND redirect_uri ~ '^https://[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?/'
        AND position('..' in split_part(substring(redirect_uri from 9), '/', 1)) = 0
        AND redirect_uri !~ '^https://localhost/'
        AND redirect_uri !~ '^https://(?:[0-9]+|0x[0-9a-f]+)(?:[.](?:[0-9]+|0x[0-9a-f]+))*/'
      ) NOT VALID;
  END IF;
END;
$trusted_redirect$;

ALTER TABLE ai_media_oauth_sessions
  VALIDATE CONSTRAINT ai_media_oauth_sessions_redirect_trusted_ck;

COMMIT;
