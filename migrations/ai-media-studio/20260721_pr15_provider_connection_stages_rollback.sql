-- PR15 rollback is application-only and preserves attempts, candidates, selections, and terminal evidence.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15min';
SET LOCAL search_path = public, pg_catalog;
DO $preflight$
BEGIN
  IF to_regclass('public.ai_media_oauth_connection_attempts') IS NULL
    OR to_regclass('public.ai_media_oauth_target_candidates') IS NULL
    OR to_regclass('public.ai_media_oauth_target_selections') IS NULL THEN
    RAISE EXCEPTION 'PR15 data-preserving rollback requires all retained PR15 evidence tables';
  END IF;
END;
$preflight$;
-- Roll application code forward after correcting the release. Do not drop tables, constraints, indexes, or evidence.
COMMIT;
