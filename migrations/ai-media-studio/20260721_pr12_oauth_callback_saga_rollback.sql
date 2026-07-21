-- PR12 rollback is application-only and retains saga, token provenance, and audit evidence.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15min';
SET LOCAL search_path = public, pg_catalog;

DO $preflight$
BEGIN
  IF to_regclass('public.ai_media_oauth_sessions') IS NULL
    OR NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public'
      AND table_name='ai_media_oauth_sessions' AND column_name='exchange_status') THEN
    RAISE EXCEPTION 'PR12 data-preserving rollback requires retained saga evidence';
  END IF;
END;
$preflight$;

-- Roll application code forward to a compatible revision. This rollback does not delete rows,
-- drop columns, constraints, or indexes, erase references, or reduce fencing/provenance evidence.
COMMIT;
