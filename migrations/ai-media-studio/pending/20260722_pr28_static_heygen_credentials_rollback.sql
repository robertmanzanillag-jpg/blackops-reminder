-- PR28 rollback is destructive only before any static credential binding exists.
-- Once evidence exists, rollback stops and requires an application forward-fix.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='15min';
SET LOCAL search_path=public,pg_catalog;

DO $preflight$
BEGIN
  IF to_regclass('public.ai_media_static_credential_bindings') IS NULL THEN
    RAISE EXCEPTION 'PR28 rollback requires the static credential binding schema';
  END IF;
  IF EXISTS (SELECT 1 FROM ai_media_static_credential_bindings)
    OR EXISTS (SELECT 1 FROM ai_media_provider_accounts WHERE credential_source='static_api_key') THEN
    RAISE EXCEPTION 'PR28 rollback preserves static credential evidence; stop and forward-fix';
  END IF;
END;
$preflight$;

LOCK TABLE ai_media_provider_accounts IN SHARE ROW EXCLUSIVE MODE;
DROP TRIGGER ai_media_provider_accounts_static_credential_graph ON ai_media_provider_accounts;
DROP TRIGGER ai_media_static_credential_bindings_graph ON ai_media_static_credential_bindings;
DROP FUNCTION ai_media_static_credential_validate_account_v1();
DROP FUNCTION ai_media_static_credential_validate_binding_v1();
DROP FUNCTION ai_media_static_credential_assert_account_v1(text,text,uuid);
ALTER TABLE ai_media_provider_accounts
  DROP CONSTRAINT ai_media_provider_accounts_oauth_credential_provenance_ck;
ALTER TABLE ai_media_provider_accounts
  ADD CONSTRAINT ai_media_provider_accounts_oauth_credential_provenance_ck CHECK (
    (credential_source='not_bound' AND secret_ref IS NULL AND credential_version=0 AND credential_actor_user_id IS NULL
      AND credential_source_session_id IS NULL AND token_binding_id IS NULL AND credential_binding_id IS NULL
      AND token_kind IS NULL AND token_manifest_revision IS NULL)
    OR (credential_source='legacy_authorized_unbound' AND credential_actor_user_id IS NULL
      AND credential_source_session_id IS NULL AND token_binding_id IS NULL AND credential_binding_id IS NULL
      AND token_kind IS NULL AND token_manifest_revision IS NULL)
    OR (credential_source='oauth_authorization' AND status='active' AND credential_status='active'
      AND credential_version>0 AND credential_actor_user_id IS NOT NULL AND credential_source_session_id IS NOT NULL
      AND external_account_id IS NOT NULL AND length(btrim(external_account_id)) BETWEEN 1 AND 255
      AND secret_ref ~ '^vault://ai-media-studio/oauth-token/v1/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      AND token_binding_id IS NOT NULL AND credential_binding_id IS NULL AND token_kind='Bearer'
      AND credential_expires_at IS NOT NULL AND capabilities @> '["publish_video"]'::jsonb
      AND jsonb_array_length(granted_scopes)>0 AND length(btrim(token_manifest_revision)) BETWEEN 1 AND 100)
    OR (credential_source='oauth_role_v2' AND status='active' AND credential_status='active'
      AND credential_version>0 AND credential_actor_user_id IS NOT NULL AND credential_source_session_id IS NOT NULL
      AND external_account_id IS NOT NULL AND length(btrim(external_account_id)) BETWEEN 1 AND 255
      AND secret_ref IS NULL AND token_binding_id IS NOT NULL AND credential_binding_id IS NOT NULL
      AND token_kind='role_v2' AND capabilities @> '["publish_video"]'::jsonb
      AND jsonb_array_length(granted_scopes)>0 AND length(btrim(token_manifest_revision)) BETWEEN 1 AND 100)
  ) NOT VALID;
ALTER TABLE ai_media_provider_accounts
  VALIDATE CONSTRAINT ai_media_provider_accounts_oauth_credential_provenance_ck;
DROP TABLE ai_media_static_credential_bindings;
COMMIT;
