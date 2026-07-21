-- PR8 rollback is application-only and preserves publishing-account isolation.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15min';
SET LOCAL search_path = public, pg_catalog;

DO $preflight$
DECLARE required_table text;
BEGIN
  FOREACH required_table IN ARRAY ARRAY[
    'ai_media_provider_accounts', 'ai_media_publishing_jobs'
  ] LOOP
    IF to_regclass('public.' || required_table) IS NULL THEN
      RAISE EXCEPTION 'PR8 data-preserving rollback requires existing table %', required_table;
    END IF;
  END LOOP;
END;
$preflight$;

-- Roll application code back only to a revision that accepts the nullable
-- provider_account_id while respecting exact tenant/workspace/platform account
-- identity. The composite constraint, candidate key, columns, and every row are
-- retained. Restoring the old id-only SET NULL foreign key would weaken tenant
-- isolation and could silently detach publishing intent, so it is not a safe
-- database rollback. Correct the application release and roll forward instead.
COMMIT;
