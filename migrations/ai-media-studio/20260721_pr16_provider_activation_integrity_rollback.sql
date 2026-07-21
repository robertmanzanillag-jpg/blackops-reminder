-- PR16A rollback is application-only and preserves every activation, artifact, and cleanup obligation.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='15min';
SET LOCAL search_path=public,pg_catalog;
DO $preflight$
BEGIN
  IF to_regclass('public.ai_media_provider_account_credential_bindings') IS NULL
    OR to_regclass('public.ai_media_oauth_credential_artifacts') IS NULL
    OR to_regclass('public.ai_media_oauth_vault_operations_v2') IS NULL
    OR to_regprocedure('public.ai_media_oauth_assert_pr16_binding(uuid)') IS NULL THEN
    RAISE EXCEPTION 'PR16A evidence-preserving rollback requires the complete PR16A schema';
  END IF;
  IF EXISTS (SELECT 1 FROM ai_media_provider_account_credential_bindings binding
    WHERE NOT EXISTS (SELECT 1 FROM ai_media_oauth_credential_artifacts artifact WHERE artifact.credential_binding_id=binding.id)) THEN
    RAISE EXCEPTION 'PR16A rollback refuses incomplete retained activation evidence';
  END IF;
END;
$preflight$;
-- Do not drop or weaken schema. Roll the application forward after correcting the release.
COMMIT;
