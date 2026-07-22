-- PR29 rollback is destructive only before any static HeyGen verification evidence exists.
-- Once evidence exists, rollback stops and requires an application forward-fix.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='15min';
SET LOCAL search_path=public,pg_catalog;

DO $preflight$
BEGIN
  IF to_regclass('public.ai_media_static_heygen_verification_headers') IS NULL
    OR to_regclass('public.ai_media_static_heygen_resource_verifications') IS NULL THEN
    RAISE EXCEPTION 'PR29 rollback requires the static HeyGen verification evidence schema';
  END IF;
  IF EXISTS (SELECT 1 FROM ai_media_static_heygen_verification_headers)
    OR EXISTS (SELECT 1 FROM ai_media_static_heygen_resource_verifications)
    OR EXISTS (SELECT 1 FROM ai_media_provider_accounts WHERE static_credential_verification_id IS NOT NULL)
    OR EXISTS (SELECT 1 FROM ai_media_provider_resources WHERE verification_header_id IS NOT NULL) THEN
    RAISE EXCEPTION 'PR29 rollback preserves static HeyGen verification evidence; stop and forward-fix';
  END IF;
END;
$preflight$;

LOCK TABLE ai_media_provider_accounts, ai_media_provider_resources, ai_media_static_credential_bindings
  IN SHARE ROW EXCLUSIVE MODE;

DROP TRIGGER ai_media_provider_accounts_static_heygen_verification_graph ON ai_media_provider_accounts;
DROP TRIGGER ai_media_provider_resources_static_heygen_verification_graph ON ai_media_provider_resources;
DROP TRIGGER ai_media_static_heygen_verification_headers_account_graph ON ai_media_static_heygen_verification_headers;
DROP TRIGGER ai_media_static_heygen_resource_verifications_resource_graph ON ai_media_static_heygen_resource_verifications;
DROP TRIGGER ai_media_static_heygen_verification_headers_truncate_guard ON ai_media_static_heygen_verification_headers;
DROP TRIGGER ai_media_static_heygen_resource_verifications_truncate_guard ON ai_media_static_heygen_resource_verifications;
DROP TRIGGER ai_media_static_heygen_verification_headers_append_only ON ai_media_static_heygen_verification_headers;
DROP TRIGGER ai_media_static_heygen_resource_verifications_append_only ON ai_media_static_heygen_resource_verifications;

DROP FUNCTION ai_media_static_heygen_validate_resource_evidence_graph_v1();
DROP FUNCTION ai_media_static_heygen_validate_header_account_graph_v1();
DROP FUNCTION ai_media_static_heygen_validate_resource_graph_v1();
DROP FUNCTION ai_media_static_heygen_assert_resource_graph_v1(text,text,uuid,uuid);
DROP FUNCTION ai_media_static_heygen_validate_account_graph_v1();
DROP FUNCTION ai_media_static_heygen_assert_account_graph_v1(text,text,uuid);
DROP FUNCTION ai_media_static_heygen_evidence_append_only_v1();

ALTER TABLE ai_media_provider_resources DROP CONSTRAINT ai_media_provider_resources_static_verification_fk;
ALTER TABLE ai_media_provider_accounts DROP CONSTRAINT ai_media_provider_accounts_static_verification_fk;
DROP TABLE ai_media_static_heygen_resource_verifications;
DROP TABLE ai_media_static_heygen_verification_headers;

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
    OR (credential_source='static_api_key' AND provider_key='heygen' AND status='disconnected'
      AND credential_status='unverified' AND credential_version>0 AND credential_actor_user_id IS NOT NULL
      AND secret_ref ~ '^env://AI_MEDIA_STUDIO_SECRET_HEYGEN_API_KEY(_[A-Z0-9]{1,32})?$'
      AND credential_source_session_id IS NULL AND token_binding_id IS NULL AND credential_binding_id IS NULL
      AND token_kind IS NULL AND token_manifest_revision IS NULL AND external_account_id IS NULL
      AND credential_expires_at IS NULL AND credential_refresh_expires_at IS NULL
      AND credential_refreshed_at IS NULL AND last_verified_at IS NULL
      AND granted_scopes='[]'::jsonb AND capabilities='[]'::jsonb)
  ) NOT VALID;
ALTER TABLE ai_media_provider_accounts
  VALIDATE CONSTRAINT ai_media_provider_accounts_oauth_credential_provenance_ck;

ALTER TABLE ai_media_provider_resources DROP CONSTRAINT ai_media_provider_resources_verification_pointer_ck;
ALTER TABLE ai_media_provider_resources DROP CONSTRAINT ai_media_provider_resources_account_tenant_provider_fk;
DROP INDEX ai_media_static_credential_bindings_exact_version_uq;

ALTER TABLE ai_media_provider_resources
  DROP COLUMN verification_expires_at,
  DROP COLUMN verified_at,
  DROP COLUMN verified_credential_version,
  DROP COLUMN verification_evidence_digest,
  DROP COLUMN verification_resource_evidence_id,
  DROP COLUMN verification_header_id;

ALTER TABLE ai_media_provider_accounts
  DROP COLUMN static_credential_verification_expires_at,
  DROP COLUMN static_credential_verified_at,
  DROP COLUMN static_credential_verification_digest,
  DROP COLUMN static_credential_verification_id;

COMMIT;
