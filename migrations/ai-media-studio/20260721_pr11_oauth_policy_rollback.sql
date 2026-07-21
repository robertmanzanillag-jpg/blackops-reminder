-- PR11 rollback is application-only and preserves every OAuth session and policy snapshot.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15min';
SET LOCAL search_path = public, pg_catalog;

DO $preflight$
BEGIN
  IF to_regclass('public.ai_media_oauth_sessions') IS NULL THEN
    RAISE EXCEPTION 'PR11 data-preserving rollback requires OAuth sessions';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'ai_media_oauth_sessions'
      AND column_name = 'pkce_mode'
  ) THEN
    RAISE EXCEPTION 'PR11 data-preserving rollback requires retained PKCE policy snapshots';
  END IF;
END;
$preflight$;

-- Roll application code forward to a compatible revision. This rollback does not drop columns or constraints,
-- restore unsafe defaults, rewrite snapshots,
-- or remove audit evidence. Any destructive retention change needs a separate review.
COMMIT;
