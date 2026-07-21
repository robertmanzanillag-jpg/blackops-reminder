-- AI Media Studio PR16B: executable durable activation semantics over PR16A evidence tables.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='15min';
SET LOCAL search_path=public,pg_catalog;

DO $preflight$
BEGIN
  IF to_regprocedure('public.ai_media_oauth_assert_pr16_binding(uuid)') IS NULL
    OR to_regprocedure('public.ai_media_oauth_pr16_authorized_digest(uuid)') IS NULL
    OR to_regclass('public.ai_media_provider_account_credential_bindings') IS NULL THEN
    RAISE EXCEPTION 'PR16B requires the complete PR16A schema';
  END IF;
  IF EXISTS (SELECT 1 FROM ai_media_provider_account_credential_bindings WHERE state='staged') THEN
    RAISE EXCEPTION 'PR16B refuses deployment while a PR16A activation is staged';
  END IF;
END;
$preflight$;

CREATE FUNCTION ai_media_oauth_pr16b_selection_digest(attempt_key uuid,candidate_key uuid,owner_key text,
  workspace_key text,actor_key text,account_key uuid,platform_key text,session_key uuid,target_kind_key text,
  target_external_key text,selected_stage_version_key integer,selected_time timestamptz)
RETURNS text LANGUAGE plpgsql STABLE SET search_path=pg_catalog AS $selection_digest$
DECLARE attempt_row record;candidate_row record;scope_payload text;capability_payload text;payload text;
BEGIN
  SELECT * INTO STRICT attempt_row FROM public.ai_media_oauth_connection_attempts WHERE id=attempt_key
    AND owner_user_id=owner_key AND workspace_id=workspace_key AND actor_user_id=actor_key
    AND provider_account_id=account_key AND platform=platform_key AND oauth_session_id=session_key;
  IF attempt_row.stage<>'awaiting_target' THEN RETURN NULL;END IF;
  SELECT * INTO STRICT candidate_row FROM public.ai_media_oauth_target_candidates
    WHERE attempt_id=attempt_key AND candidate_id=candidate_key AND owner_user_id=owner_key
      AND workspace_id=workspace_key AND actor_user_id=actor_key AND provider_account_id=account_key
      AND platform=platform_key AND oauth_session_id=session_key AND target_kind=target_kind_key
      AND target_external_id=target_external_key;
  SELECT '['||string_agg(to_jsonb(value)::text,',' ORDER BY value)||']' INTO scope_payload
    FROM jsonb_array_elements_text(attempt_row.actual_scopes) value;
  SELECT '['||string_agg(to_jsonb(value)::text,',' ORDER BY value)||']' INTO capability_payload
    FROM jsonb_array_elements_text(candidate_row.capabilities) value;
  IF scope_payload IS NULL OR capability_payload IS NULL THEN RETURN NULL;END IF;
  payload:='['||to_jsonb('ai-media-oauth-provider-selection-v1'::text)::text||','
    ||to_jsonb(attempt_row.id::text)::text||','||to_jsonb(attempt_row.owner_user_id)::text||','
    ||to_jsonb(attempt_row.workspace_id)::text||','||to_jsonb(attempt_row.actor_user_id)::text||','
    ||to_jsonb(attempt_row.provider_account_id::text)::text||','||to_jsonb(attempt_row.oauth_session_id::text)::text||','
    ||to_jsonb(attempt_row.platform)::text||','||to_jsonb(attempt_row.grant_family)::text||','
    ||to_jsonb(candidate_row.candidate_id::text)::text||','||to_jsonb(candidate_row.target_external_id)::text||','
    ||to_jsonb(candidate_row.target_kind)::text||','||to_jsonb(candidate_row.eligibility_digest)::text||','
    ||attempt_row.stage_version::text||','
    ||to_jsonb(to_char(selected_time AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))::text||','
    ||to_jsonb(attempt_row.manifest_revision)::text||','||to_jsonb(attempt_row.token_binding_id::text)::text||','
    ||attempt_row.expected_credential_version::text||','||attempt_row.target_credential_version::text||','
    ||scope_payload||','||capability_payload||']';
  RETURN encode(public.digest(convert_to(payload,'UTF8'),'sha256'),'hex');
EXCEPTION WHEN no_data_found OR too_many_rows THEN RETURN NULL;
END;
$selection_digest$;
REVOKE ALL ON FUNCTION ai_media_oauth_pr16b_selection_digest(uuid,uuid,text,text,text,uuid,text,uuid,text,text,integer,timestamptz) FROM PUBLIC;

CREATE FUNCTION ai_media_oauth_pr16b_own_selection_evidence() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $own_selection$
BEGIN
  IF NEW.selected_actor_user_id IS DISTINCT FROM NEW.actor_user_id THEN
    RAISE EXCEPTION 'PR16B selection actor mismatch';
  END IF;
  SELECT stage_version INTO NEW.selected_stage_version FROM public.ai_media_oauth_connection_attempts
    WHERE id=NEW.attempt_id AND owner_user_id=NEW.owner_user_id AND workspace_id=NEW.workspace_id
      AND actor_user_id=NEW.actor_user_id AND provider_account_id=NEW.provider_account_id
      AND platform=NEW.platform AND oauth_session_id=NEW.oauth_session_id AND stage='awaiting_target';
  IF NEW.selected_stage_version IS NULL THEN RAISE EXCEPTION 'PR16B selection requires awaiting target';END IF;
  NEW.selected_at:=date_trunc('milliseconds',clock_timestamp());
  NEW.created_at:=NEW.selected_at;
  NEW.selection_digest:=public.ai_media_oauth_pr16b_selection_digest(NEW.attempt_id,NEW.candidate_id,
    NEW.owner_user_id,NEW.workspace_id,NEW.actor_user_id,NEW.provider_account_id,NEW.platform,NEW.oauth_session_id,
    NEW.target_kind,NEW.target_external_id,NEW.selected_stage_version,NEW.selected_at);
  IF NEW.selection_digest IS NULL THEN RAISE EXCEPTION 'PR16B cannot derive selection evidence';END IF;
  RETURN NEW;
END;
$own_selection$;
REVOKE ALL ON FUNCTION ai_media_oauth_pr16b_own_selection_evidence() FROM PUBLIC;
CREATE TRIGGER ai_media_oauth_target_selections_pr16b_owned
  BEFORE INSERT ON ai_media_oauth_target_selections FOR EACH ROW
  EXECUTE FUNCTION ai_media_oauth_pr16b_own_selection_evidence();

CREATE FUNCTION ai_media_oauth_pr16b_cleanup_gate() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $cleanup_gate$
DECLARE binding_state text;
BEGIN
  IF OLD.state='cleanup_pending' AND NEW.state IN ('leased','retry_wait','verify_wait','completed','dead_letter') THEN
    SELECT state INTO binding_state FROM public.ai_media_provider_account_credential_bindings WHERE id=OLD.credential_binding_id;
    IF binding_state IS DISTINCT FROM 'abandoned' THEN
      RAISE EXCEPTION 'PR16B cleanup is not claimable before activation is abandoned';
    END IF;
  END IF;
  RETURN NEW;
END;
$cleanup_gate$;
REVOKE ALL ON FUNCTION ai_media_oauth_pr16b_cleanup_gate() FROM PUBLIC;
CREATE TRIGGER ai_media_oauth_vault_operations_v2_pr16b_cleanup_gate
  BEFORE UPDATE ON ai_media_oauth_vault_operations_v2 FOR EACH ROW
  EXECUTE FUNCTION ai_media_oauth_pr16b_cleanup_gate();

COMMIT;
