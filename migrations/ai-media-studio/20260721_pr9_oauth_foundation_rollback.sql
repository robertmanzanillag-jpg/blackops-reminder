-- PR9 rollback is application-only and preserves OAuth audit evidence and credential metadata.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15min';
SET LOCAL search_path = public, pg_catalog;

DO $preflight$
BEGIN
  IF to_regclass('public.ai_media_provider_accounts') IS NULL
     OR to_regclass('public.ai_media_oauth_sessions') IS NULL THEN
    RAISE EXCEPTION 'PR9 data-preserving rollback requires provider accounts and OAuth sessions';
  END IF;
END;
$preflight$;

-- Roll application code back only to a revision that ignores the retained OAuth
-- control-plane tables and credential metadata. The session rows, opaque vault
-- references, composite tenant/platform isolation, constraints, and all audit
-- evidence remain intact. Destructive secret or evidence removal requires a
-- separately reviewed retention migration; otherwise correct code and roll forward.
COMMIT;
