-- AI Media Studio PR28: bind deployment-managed HeyGen API keys without persisting secret material.
-- Preparation only. Do not apply automatically and do not perform provider verification here.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='15min';
SET LOCAL search_path=public,pg_catalog;

DO $preflight$
BEGIN
  IF current_setting('server_version_num')::integer<160000
    OR to_regclass('public.ai_media_provider_accounts') IS NULL
    OR to_regclass('public.ai_media_provider_terminal_checks') IS NULL
    OR to_regprocedure('ai_media_worker_api.record_provider_terminal_v1(uuid,text,text,uuid,uuid,bigint,uuid,bigint,text,uuid,text,integer,text,text,text,text,timestamptz,text)') IS NULL THEN
    RAISE EXCEPTION 'PR28 static HeyGen credentials require the complete PR27 schema';
  END IF;
  IF to_regclass('public.ai_media_static_credential_bindings') IS NOT NULL THEN
    RAISE EXCEPTION 'PR28 static HeyGen credential bindings must be absent';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
    WHERE conname='ai_media_provider_accounts_oauth_credential_provenance_ck'
      AND conrelid='public.ai_media_provider_accounts'::regclass AND convalidated) THEN
    RAISE EXCEPTION 'PR28 requires the validated provider credential provenance constraint';
  END IF;
  IF EXISTS (SELECT 1 FROM ai_media_provider_accounts WHERE credential_source='static_api_key') THEN
    RAISE EXCEPTION 'PR28 refuses untracked static credential state';
  END IF;
END;
$preflight$;

LOCK TABLE ai_media_provider_accounts IN SHARE ROW EXCLUSIVE MODE;

CREATE TABLE ai_media_static_credential_bindings (
  id uuid PRIMARY KEY,
  owner_user_id text NOT NULL,
  workspace_id text NOT NULL DEFAULT 'personal',
  actor_user_id text NOT NULL,
  provider_account_id uuid NOT NULL,
  provider_key text NOT NULL,
  expected_credential_version integer NOT NULL,
  target_credential_version integer NOT NULL,
  secret_ref text NOT NULL,
  idempotency_key text NOT NULL,
  request_digest text NOT NULL,
  lifecycle_state text NOT NULL DEFAULT 'pending',
  verification_state text NOT NULL DEFAULT 'unverified',
  superseded_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT ai_media_static_credential_bindings_account_fk FOREIGN KEY
    (owner_user_id,workspace_id,provider_account_id,provider_key)
    REFERENCES ai_media_provider_accounts(owner_user_id,workspace_id,id,provider_key)
    ON UPDATE NO ACTION ON DELETE RESTRICT,
  CONSTRAINT ai_media_static_credential_bindings_integrity_ck CHECK (
    provider_key='heygen'
    AND length(btrim(actor_user_id)) BETWEEN 1 AND 255
    AND expected_credential_version>=0
    AND target_credential_version=expected_credential_version+1
    AND secret_ref ~ '^env://AI_MEDIA_STUDIO_SECRET_HEYGEN_API_KEY(_[A-Z0-9]{1,32})?$'
    AND length(idempotency_key) BETWEEN 8 AND 128
    AND idempotency_key ~ '^[A-Za-z0-9][A-Za-z0-9._:-]+$'
    AND request_digest ~ '^sha256:[0-9a-f]{64}$'
    AND lifecycle_state IN ('pending','superseded','revoked')
    AND verification_state='unverified'
    AND ((lifecycle_state='superseded')=(superseded_at IS NOT NULL))
    AND (superseded_at IS NULL OR superseded_at>=created_at)
    AND updated_at>=created_at
  )
);
CREATE UNIQUE INDEX ai_media_static_credential_bindings_account_version_uq
  ON ai_media_static_credential_bindings(owner_user_id,workspace_id,provider_account_id,target_credential_version);
CREATE UNIQUE INDEX ai_media_static_credential_bindings_idempotency_uq
  ON ai_media_static_credential_bindings(owner_user_id,workspace_id,provider_account_id,idempotency_key);
CREATE UNIQUE INDEX ai_media_static_credential_bindings_current_uq
  ON ai_media_static_credential_bindings(owner_user_id,workspace_id,provider_account_id)
  WHERE lifecycle_state='pending';

CREATE FUNCTION ai_media_static_credential_assert_account_v1(
  p_owner_user_id text,p_workspace_id text,p_provider_account_id uuid
) RETURNS void LANGUAGE plpgsql SET search_path=pg_catalog AS $assert_static_binding$
DECLARE account_row record;binding_count integer;
BEGIN
  SELECT * INTO account_row FROM public.ai_media_provider_accounts
    WHERE owner_user_id=p_owner_user_id AND workspace_id=p_workspace_id
      AND id=p_provider_account_id AND provider_key='heygen';
  IF NOT FOUND THEN RETURN;END IF;
  SELECT count(*) INTO binding_count FROM public.ai_media_static_credential_bindings binding
    WHERE binding.owner_user_id=p_owner_user_id AND binding.workspace_id=p_workspace_id
      AND binding.provider_account_id=p_provider_account_id AND binding.provider_key='heygen'
      AND binding.lifecycle_state='pending'
      AND binding.target_credential_version=account_row.credential_version
      AND binding.secret_ref=account_row.secret_ref
      AND binding.actor_user_id=account_row.credential_actor_user_id;
  IF (account_row.credential_source='static_api_key' AND binding_count<>1)
    OR (account_row.credential_source<>'static_api_key' AND binding_count<>0) THEN
    RAISE EXCEPTION 'Static HeyGen credential account binding graph is inconsistent';
  END IF;
END;
$assert_static_binding$;
REVOKE ALL ON FUNCTION ai_media_static_credential_assert_account_v1(text,text,uuid) FROM PUBLIC;

CREATE FUNCTION ai_media_static_credential_validate_account_v1() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $validate_static_account$
BEGIN
  PERFORM public.ai_media_static_credential_assert_account_v1(
    COALESCE(NEW.owner_user_id,OLD.owner_user_id),COALESCE(NEW.workspace_id,OLD.workspace_id),
    COALESCE(NEW.id,OLD.id));
  RETURN NULL;
END;
$validate_static_account$;
REVOKE ALL ON FUNCTION ai_media_static_credential_validate_account_v1() FROM PUBLIC;

CREATE FUNCTION ai_media_static_credential_validate_binding_v1() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $validate_static_binding$
BEGIN
  PERFORM public.ai_media_static_credential_assert_account_v1(
    COALESCE(NEW.owner_user_id,OLD.owner_user_id),COALESCE(NEW.workspace_id,OLD.workspace_id),
    COALESCE(NEW.provider_account_id,OLD.provider_account_id));
  IF TG_OP='UPDATE' AND (OLD.owner_user_id,OLD.workspace_id,OLD.provider_account_id)
      IS DISTINCT FROM (NEW.owner_user_id,NEW.workspace_id,NEW.provider_account_id) THEN
    PERFORM public.ai_media_static_credential_assert_account_v1(
      OLD.owner_user_id,OLD.workspace_id,OLD.provider_account_id);
  END IF;
  RETURN NULL;
END;
$validate_static_binding$;
REVOKE ALL ON FUNCTION ai_media_static_credential_validate_binding_v1() FROM PUBLIC;

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

CREATE CONSTRAINT TRIGGER ai_media_provider_accounts_static_credential_graph
  AFTER INSERT OR UPDATE OF credential_source,credential_version,secret_ref,credential_actor_user_id,status,credential_status
  ON ai_media_provider_accounts DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION ai_media_static_credential_validate_account_v1();
CREATE CONSTRAINT TRIGGER ai_media_static_credential_bindings_graph
  AFTER INSERT OR UPDATE OR DELETE ON ai_media_static_credential_bindings
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
  EXECUTE FUNCTION ai_media_static_credential_validate_binding_v1();

COMMIT;
