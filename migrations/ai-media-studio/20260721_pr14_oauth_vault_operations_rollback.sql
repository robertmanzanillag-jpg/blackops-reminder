-- PR14 rollback is application-only and preserves cleanup, fencing, and deletion evidence.
BEGIN;
SET LOCAL lock_timeout='5s';SET LOCAL statement_timeout='15min';SET LOCAL search_path=public,pg_catalog;
DO $preflight$ BEGIN IF to_regclass('public.ai_media_oauth_vault_operations') IS NULL THEN RAISE EXCEPTION 'PR14 retained cleanup table required'; END IF; END;$preflight$;
-- Roll application code forward. Do not drop the table, columns, constraints, indexes, or obligation history.
COMMIT;
