-- AI Media Studio PR16A: provider activation schema and relational integrity.
-- Reviewed, additive/evidence-preserving migration. Do not apply automatically.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15min';
SET LOCAL search_path = public, pg_catalog;

DO $preflight$
DECLARE missing_control text;
BEGIN
  IF current_setting('server_version_num')::integer < 160000 THEN
    RAISE EXCEPTION 'PR16A requires PostgreSQL 16 or newer';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_extension extension
    JOIN pg_namespace namespace ON namespace.oid=extension.extnamespace
    WHERE extension.extname='pgcrypto' AND namespace.nspname='public'
  ) THEN RAISE EXCEPTION 'PR16A requires trusted public.pgcrypto'; END IF;
  IF to_regclass('public.ai_media_provider_accounts') IS NULL
    OR to_regclass('public.ai_media_oauth_sessions') IS NULL
    OR to_regclass('public.ai_media_oauth_vault_operations') IS NULL
    OR to_regclass('public.ai_media_oauth_connection_attempts') IS NULL
    OR to_regclass('public.ai_media_oauth_target_candidates') IS NULL
    OR to_regclass('public.ai_media_oauth_target_selections') IS NULL THEN
    RAISE EXCEPTION 'PR16A requires the exact PR12, PR14, and PR15 schema';
  END IF;
  SELECT required.name INTO missing_control FROM (VALUES
    ('ai_media_provider_accounts_oauth_credential_provenance_ck','ai_media_provider_accounts'),
    ('ai_media_oauth_sessions_authorization_saga_ck','ai_media_oauth_sessions'),
    ('ai_media_oauth_vault_operations_lifecycle_ck','ai_media_oauth_vault_operations'),
    ('ai_media_oauth_connection_attempts_stage_ck','ai_media_oauth_connection_attempts'),
    ('ai_media_oauth_connection_attempts_scopes_ck','ai_media_oauth_connection_attempts'),
    ('ai_media_oauth_connection_attempts_terminal_ck','ai_media_oauth_connection_attempts'),
    ('ai_media_oauth_target_candidates_attempt_source_fk','ai_media_oauth_target_candidates'),
    ('ai_media_oauth_target_selections_exact_candidate_fk','ai_media_oauth_target_selections')
  ) required(name,relation_name)
  WHERE NOT EXISTS (
    SELECT 1 FROM pg_constraint control
    WHERE control.conname=required.name
      AND control.conrelid=('public.'||required.relation_name)::regclass
      AND control.convalidated
  ) LIMIT 1;
  IF missing_control IS NOT NULL THEN
    RAISE EXCEPTION 'PR16A requires validated control %',missing_control;
  END IF;
  IF to_regclass('public.ai_media_oauth_credential_artifacts') IS NOT NULL
    OR to_regclass('public.ai_media_provider_account_credential_bindings') IS NOT NULL
    OR to_regclass('public.ai_media_oauth_vault_operations_v2') IS NOT NULL
    OR to_regprocedure('public.ai_media_oauth_token_artifacts_are_safe(jsonb,text)') IS NOT NULL
    OR to_regprocedure('public.ai_media_oauth_assert_pr16_binding(uuid)') IS NOT NULL
    OR EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public'
      AND table_name='ai_media_provider_accounts' AND column_name='credential_binding_id') THEN
    RAISE EXCEPTION 'PR16A requires every PR16A object to be absent';
  END IF;
  IF EXISTS (SELECT 1 FROM ai_media_provider_accounts WHERE credential_source='oauth_role_v2') THEN
    RAISE EXCEPTION 'PR16A refuses unproven preexisting oauth_role_v2 accounts';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_class relation JOIN pg_namespace namespace ON namespace.oid=relation.relnamespace
    CROSS JOIN LATERAL aclexplode(COALESCE(relation.relacl,acldefault('r',relation.relowner))) privilege
    WHERE namespace.nspname='public' AND relation.relname IN ('ai_media_provider_accounts','ai_media_oauth_connection_attempts')
      AND privilege.grantee=0 AND privilege.privilege_type IN ('INSERT','UPDATE','DELETE','TRUNCATE','TRIGGER')) THEN
    RAISE EXCEPTION 'PR16A refuses preexisting PUBLIC mutation privileges';
  END IF;
END;
$preflight$;

LOCK TABLE ai_media_provider_accounts,ai_media_oauth_connection_attempts,
  ai_media_oauth_target_candidates,ai_media_oauth_target_selections IN SHARE ROW EXCLUSIVE MODE;

CREATE FUNCTION ai_media_oauth_token_artifacts_are_safe(artifacts jsonb,grant_family text) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog AS $safe_artifacts$
DECLARE item jsonb;lifetime jsonb;roles text[]:=ARRAY[]::text[];role text;kind text;
BEGIN
  IF jsonb_typeof(artifacts)<>'array' OR jsonb_array_length(artifacts) NOT BETWEEN 1 AND 2 THEN RETURN false;END IF;
  FOR item IN SELECT value FROM jsonb_array_elements(artifacts) value LOOP
    IF jsonb_typeof(item)<>'object' OR (SELECT count(*) FROM jsonb_object_keys(item))<>2
      OR NOT (item ? 'role' AND item ? 'lifetime') OR jsonb_typeof(item->'role')<>'string'
      OR jsonb_typeof(item->'lifetime')<>'object' THEN RETURN false;END IF;
    role:=item->>'role';lifetime:=item->'lifetime';kind:=lifetime->>'kind';
    IF role NOT IN ('operational_access','refresh','grant_user_access') OR role=ANY(roles) THEN RETURN false;END IF;
    roles:=array_append(roles,role);
    IF kind='expires_at' THEN
      IF (SELECT count(*) FROM jsonb_object_keys(lifetime))<>3 OR jsonb_typeof(lifetime->'kind')<>'string'
        OR NOT (lifetime ? 'expiresAt' AND lifetime ? 'revalidateAt')
        OR jsonb_typeof(lifetime->'expiresAt')<>'string' OR jsonb_typeof(lifetime->'revalidateAt')<>'string'
        OR NOT isfinite((lifetime->>'expiresAt')::timestamptz)
        OR NOT isfinite((lifetime->>'revalidateAt')::timestamptz)
        OR (lifetime->>'expiresAt')::timestamptz < (lifetime->>'revalidateAt')::timestamptz THEN RETURN false;END IF;
    ELSIF kind='revocation_bound' THEN
      IF (SELECT count(*) FROM jsonb_object_keys(lifetime))<>2 OR jsonb_typeof(lifetime->'kind')<>'string'
        OR NOT (lifetime ? 'revalidateAt') OR jsonb_typeof(lifetime->'revalidateAt')<>'string'
        OR NOT isfinite((lifetime->>'revalidateAt')::timestamptz)
        OR grant_family<>'google_user' OR role<>'refresh' THEN RETURN false;END IF;
    ELSIF kind='provider_non_expiring' THEN RETURN false;
    ELSE RETURN false;END IF;
  END LOOP;
  IF grant_family='meta_facebook_login' THEN
    RETURN cardinality(roles)=1 AND roles @> ARRAY['grant_user_access'];
  END IF;
  RETURN grant_family IN ('tiktok_user','google_user') AND cardinality(roles)=2
    AND roles @> ARRAY['operational_access','refresh'];
EXCEPTION WHEN others THEN RETURN false;
END;
$safe_artifacts$;
REVOKE ALL ON FUNCTION ai_media_oauth_token_artifacts_are_safe(jsonb,text) FROM PUBLIC;

ALTER TABLE ai_media_provider_accounts ADD COLUMN credential_binding_id uuid;

ALTER TABLE ai_media_provider_accounts DROP CONSTRAINT ai_media_provider_accounts_oauth_credential_provenance_ck;
ALTER TABLE ai_media_provider_accounts ADD CONSTRAINT ai_media_provider_accounts_oauth_credential_provenance_ck CHECK (
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
ALTER TABLE ai_media_provider_accounts VALIDATE CONSTRAINT ai_media_provider_accounts_oauth_credential_provenance_ck;
CREATE UNIQUE INDEX ai_media_provider_accounts_oauth_role_v2_token_binding_uq
  ON ai_media_provider_accounts(token_binding_id) WHERE credential_source='oauth_role_v2';

ALTER TABLE ai_media_oauth_connection_attempts DROP CONSTRAINT ai_media_oauth_connection_attempts_stage_ck;
ALTER TABLE ai_media_oauth_connection_attempts ADD CONSTRAINT ai_media_oauth_connection_attempts_stage_ck CHECK (
  stage IN ('exchange_pending','exchange_in_progress','exchange_indeterminate','discovery_pending',
    'discovery_in_progress','awaiting_target','activation_pending','activation_in_progress',
    'activation_indeterminate','authorized','failed') AND stage_version>=1
) NOT VALID;
ALTER TABLE ai_media_oauth_connection_attempts VALIDATE CONSTRAINT ai_media_oauth_connection_attempts_stage_ck;

ALTER TABLE ai_media_oauth_connection_attempts DROP CONSTRAINT ai_media_oauth_connection_attempts_scopes_ck;
ALTER TABLE ai_media_oauth_connection_attempts ADD CONSTRAINT ai_media_oauth_connection_attempts_scopes_ck CHECK (
  jsonb_typeof(required_scopes)='array' AND jsonb_array_length(required_scopes) BETWEEN 1 AND 50
  AND jsonb_typeof(allowed_scopes)='array' AND jsonb_array_length(allowed_scopes) BETWEEN 1 AND 50
  AND allowed_scopes @> required_scopes
  AND (actual_scopes IS NULL OR (jsonb_typeof(actual_scopes)='array'
    AND jsonb_array_length(actual_scopes) BETWEEN 1 AND 50
    AND actual_scopes @> required_scopes AND allowed_scopes @> actual_scopes))
  AND (stage NOT IN ('exchange_pending','exchange_in_progress','exchange_indeterminate','failed') OR actual_scopes IS NULL OR stage='failed')
  AND (stage NOT IN ('discovery_pending','discovery_in_progress','awaiting_target','activation_pending',
    'activation_in_progress','activation_indeterminate','authorized') OR actual_scopes IS NOT NULL)
  AND ((actual_scopes IS NULL)=(token_artifacts IS NULL))
  AND (token_artifacts IS NULL OR ai_media_oauth_token_artifacts_are_safe(token_artifacts,grant_family))
) NOT VALID;
ALTER TABLE ai_media_oauth_connection_attempts VALIDATE CONSTRAINT ai_media_oauth_connection_attempts_scopes_ck;

ALTER TABLE ai_media_oauth_connection_attempts DROP CONSTRAINT ai_media_oauth_connection_attempts_terminal_ck;
ALTER TABLE ai_media_oauth_connection_attempts ADD CONSTRAINT ai_media_oauth_connection_attempts_terminal_ck CHECK (
  ((stage IN ('activation_indeterminate','authorized','failed'))=(terminal_at IS NOT NULL))
  AND ((stage IN ('activation_indeterminate','authorized','failed'))=(terminal_outcome IS NOT NULL))
  AND ((stage IN ('activation_indeterminate','authorized','failed'))=(terminal_evidence_digest IS NOT NULL))
  AND (terminal_outcome IS NULL OR terminal_outcome IN ('indeterminate','authorized','not_connectable','failed'))
  AND (terminal_evidence_digest IS NULL OR terminal_evidence_digest ~ '^[0-9a-f]{64}$')
  AND (failure_code IS NULL OR failure_code IN ('invalid_exchange','exchange_ambiguous','scope_mismatch',
    'invalid_artifact','invalid_discovery','target_not_found','target_mismatch','activation_rejected',
    'activation_ambiguous','provider_rejected','internal_failure','no_targets'))
  AND (stage<>'exchange_indeterminate' OR failure_code='exchange_ambiguous')
  AND (stage<>'activation_indeterminate' OR (failure_code='activation_ambiguous' AND terminal_outcome='indeterminate'))
  AND (stage<>'authorized' OR (failure_code IS NULL AND terminal_outcome='authorized'))
  AND (stage<>'failed' OR (failure_code IS NOT NULL AND terminal_outcome IN ('failed','not_connectable')))
  AND expires_at>created_at
) NOT VALID;
ALTER TABLE ai_media_oauth_connection_attempts VALIDATE CONSTRAINT ai_media_oauth_connection_attempts_terminal_ck;

CREATE UNIQUE INDEX ai_media_oauth_connection_attempts_exact_activation_source_uq
  ON ai_media_oauth_connection_attempts(owner_user_id,workspace_id,actor_user_id,provider_account_id,platform,
    oauth_session_id,id,token_binding_id,manifest_revision,expected_credential_version,target_credential_version);
CREATE UNIQUE INDEX ai_media_oauth_target_candidates_exact_evidence_uq
  ON ai_media_oauth_target_candidates(owner_user_id,workspace_id,actor_user_id,provider_account_id,platform,
    oauth_session_id,attempt_id,candidate_id,target_kind,target_external_id,eligibility_digest,manifest_revision);
CREATE UNIQUE INDEX ai_media_oauth_target_selections_exact_selection_uq
  ON ai_media_oauth_target_selections(owner_user_id,workspace_id,actor_user_id,provider_account_id,platform,
    oauth_session_id,attempt_id,candidate_id,target_kind,target_external_id,selection_digest,selected_stage_version);

CREATE TABLE ai_media_provider_account_credential_bindings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),owner_user_id text NOT NULL,workspace_id text NOT NULL DEFAULT 'personal',
  actor_user_id text NOT NULL,provider_account_id uuid NOT NULL,platform text NOT NULL,oauth_session_id uuid NOT NULL,
  attempt_id uuid NOT NULL,candidate_id uuid NOT NULL,target_kind text NOT NULL,target_external_id text NOT NULL,
  selection_digest text NOT NULL,selected_stage_version integer NOT NULL,activation_stage_version integer NOT NULL,
  selected_eligibility_digest text NOT NULL,token_binding_id uuid NOT NULL,artifact_binding_id uuid NOT NULL,
  expected_credential_version integer NOT NULL,target_credential_version integer NOT NULL,actual_scopes jsonb NOT NULL,
  capabilities jsonb NOT NULL,manifest_revision text NOT NULL,state text NOT NULL DEFAULT 'staged',
  authorized_digest text,authorized_at timestamptz,abandoned_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT ai_media_provider_account_credential_bindings_identity_ck CHECK (
    length(btrim(actor_user_id)) BETWEEN 1 AND 255 AND length(btrim(target_external_id)) BETWEEN 1 AND 255
    AND length(btrim(manifest_revision)) BETWEEN 1 AND 100 AND selection_digest ~ '^[0-9a-f]{64}$'
    AND selected_eligibility_digest ~ '^[0-9a-f]{64}$'
    AND (authorized_digest IS NULL OR authorized_digest ~ '^[0-9a-f]{64}$')
    AND selected_stage_version>=1 AND activation_stage_version>=1 AND expected_credential_version>=0
    AND target_credential_version=expected_credential_version+1
    AND jsonb_typeof(actual_scopes)='array' AND jsonb_array_length(actual_scopes) BETWEEN 1 AND 50
    AND jsonb_typeof(capabilities)='array' AND jsonb_array_length(capabilities) BETWEEN 1 AND 20
    AND (actual_scopes::text||capabilities::text) !~* '"(reference|vaultreference|secret|clientsecret|client_secret|accesstoken|access_token|refreshtoken|refresh_token|tokenvalue|token_value|providerjson|provider_json|providerpayload|provider_payload|rawprovider|raw_provider)"'
    AND state IN ('staged','authorized','abandoned')
    AND (state<>'staged' OR (authorized_digest IS NULL AND authorized_at IS NULL AND abandoned_at IS NULL))
    AND (state<>'authorized' OR (authorized_digest IS NOT NULL AND authorized_at IS NOT NULL AND abandoned_at IS NULL))
    AND (state<>'abandoned' OR (authorized_digest IS NULL AND authorized_at IS NULL AND abandoned_at IS NOT NULL))
    AND updated_at>=created_at
  )
);
CREATE UNIQUE INDEX ai_media_provider_account_credential_bindings_account_version_uq
  ON ai_media_provider_account_credential_bindings(owner_user_id,workspace_id,provider_account_id,platform,target_credential_version);
CREATE UNIQUE INDEX ai_media_provider_account_credential_bindings_token_binding_uq ON ai_media_provider_account_credential_bindings(token_binding_id);
CREATE UNIQUE INDEX ai_media_provider_account_credential_bindings_artifact_binding_uq ON ai_media_provider_account_credential_bindings(artifact_binding_id);
CREATE UNIQUE INDEX ai_media_provider_account_credential_bindings_authorized_digest_uq ON ai_media_provider_account_credential_bindings(authorized_digest) WHERE authorized_digest IS NOT NULL;
CREATE UNIQUE INDEX ai_media_provider_account_credential_bindings_exact_account_source_uq
  ON ai_media_provider_account_credential_bindings(owner_user_id,workspace_id,actor_user_id,provider_account_id,platform,
    oauth_session_id,id,target_external_id,token_binding_id,target_credential_version,manifest_revision,
    actual_scopes,capabilities);
CREATE UNIQUE INDEX ai_media_provider_account_credential_bindings_exact_artifact_source_uq
  ON ai_media_provider_account_credential_bindings(owner_user_id,workspace_id,actor_user_id,provider_account_id,platform,
    oauth_session_id,attempt_id,id,candidate_id,target_kind,target_external_id,selection_digest,selected_stage_version,
    selected_eligibility_digest,token_binding_id,artifact_binding_id,expected_credential_version,
    target_credential_version,manifest_revision);

ALTER TABLE ai_media_provider_account_credential_bindings ADD CONSTRAINT ai_media_provider_account_credential_bindings_provider_account_fk
  FOREIGN KEY(owner_user_id,workspace_id,provider_account_id,platform)
  REFERENCES ai_media_provider_accounts(owner_user_id,workspace_id,id,provider_key) ON UPDATE NO ACTION ON DELETE NO ACTION;
ALTER TABLE ai_media_provider_account_credential_bindings ADD CONSTRAINT ai_media_provider_account_credential_bindings_attempt_source_fk
  FOREIGN KEY(owner_user_id,workspace_id,actor_user_id,provider_account_id,platform,oauth_session_id,attempt_id,
    token_binding_id,manifest_revision,expected_credential_version,target_credential_version)
  REFERENCES ai_media_oauth_connection_attempts(owner_user_id,workspace_id,actor_user_id,provider_account_id,platform,
    oauth_session_id,id,token_binding_id,manifest_revision,expected_credential_version,target_credential_version);
ALTER TABLE ai_media_provider_account_credential_bindings ADD CONSTRAINT ai_media_provider_account_credential_bindings_candidate_evidence_fk
  FOREIGN KEY(owner_user_id,workspace_id,actor_user_id,provider_account_id,platform,oauth_session_id,attempt_id,
    candidate_id,target_kind,target_external_id,selected_eligibility_digest,manifest_revision)
  REFERENCES ai_media_oauth_target_candidates(owner_user_id,workspace_id,actor_user_id,provider_account_id,platform,
    oauth_session_id,attempt_id,candidate_id,target_kind,target_external_id,eligibility_digest,manifest_revision);
ALTER TABLE ai_media_provider_account_credential_bindings ADD CONSTRAINT ai_media_provider_account_credential_bindings_exact_selection_fk
  FOREIGN KEY(owner_user_id,workspace_id,actor_user_id,provider_account_id,platform,oauth_session_id,attempt_id,
    candidate_id,target_kind,target_external_id,selection_digest,selected_stage_version)
  REFERENCES ai_media_oauth_target_selections(owner_user_id,workspace_id,actor_user_id,provider_account_id,platform,
    oauth_session_id,attempt_id,candidate_id,target_kind,target_external_id,selection_digest,selected_stage_version);

CREATE TABLE ai_media_oauth_credential_artifacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),owner_user_id text NOT NULL,workspace_id text NOT NULL DEFAULT 'personal',
  actor_user_id text NOT NULL,provider_account_id uuid NOT NULL,platform text NOT NULL,oauth_session_id uuid NOT NULL,
  attempt_id uuid NOT NULL,credential_binding_id uuid NOT NULL,candidate_id uuid NOT NULL,target_kind text NOT NULL,
  target_external_id text NOT NULL,token_binding_id uuid NOT NULL,artifact_binding_id uuid NOT NULL,role text NOT NULL,
  vault_reference text NOT NULL,lifetime_kind text NOT NULL,expires_at timestamptz,revalidate_at timestamptz NOT NULL,
  manifest_revision text NOT NULL,expected_credential_version integer NOT NULL,target_credential_version integer NOT NULL,
  selection_digest text NOT NULL,selected_stage_version integer NOT NULL,selected_eligibility_digest text NOT NULL,
  state text NOT NULL DEFAULT 'candidate',activated_at timestamptz,cleanup_completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT ai_media_oauth_credential_artifacts_identity_ck CHECK (
    role IN ('operational_access','refresh') AND length(btrim(actor_user_id)) BETWEEN 1 AND 255
    AND length(btrim(target_external_id)) BETWEEN 1 AND 255 AND length(btrim(manifest_revision)) BETWEEN 1 AND 100
    AND expected_credential_version>=0 AND target_credential_version=expected_credential_version+1
    AND selection_digest ~ '^[0-9a-f]{64}$' AND selected_stage_version>=1
    AND selected_eligibility_digest ~ '^[0-9a-f]{64}$'
    AND vault_reference='vault://ai-media-studio/oauth-role-token/v2/'||encode(digest(
      convert_to('["'||artifact_binding_id::text||'","'||role||'"]','UTF8'),'sha256'),'hex')
  ),
  CONSTRAINT ai_media_oauth_credential_artifacts_lifetime_ck CHECK (
    lifetime_kind IN ('expires_at','provider_non_expiring','revocation_bound')
    AND ((lifetime_kind='expires_at')=(expires_at IS NOT NULL))
    AND revalidate_at>created_at AND revalidate_at<=created_at+interval '366 days'
    AND (expires_at IS NULL OR expires_at>=revalidate_at)
    AND (lifetime_kind<>'provider_non_expiring' OR (platform IN ('facebook','instagram') AND role='operational_access'))
    AND (lifetime_kind<>'revocation_bound' OR (platform='youtube_shorts' AND role='refresh'))
  ),
  CONSTRAINT ai_media_oauth_credential_artifacts_lifecycle_ck CHECK (
    state IN ('candidate','active','cleanup_leased','cleanup_retry','cleanup_verify','deleted','cleanup_dead_letter')
    AND (state<>'candidate' OR (activated_at IS NULL AND cleanup_completed_at IS NULL))
    AND (state<>'active' OR (activated_at IS NOT NULL AND cleanup_completed_at IS NULL))
    AND (state<>'deleted' OR cleanup_completed_at IS NOT NULL)
    AND (state<>'cleanup_dead_letter' OR cleanup_completed_at IS NULL)
  )
);
CREATE UNIQUE INDEX ai_media_oauth_credential_artifacts_binding_role_uq ON ai_media_oauth_credential_artifacts(artifact_binding_id,role);
CREATE UNIQUE INDEX ai_media_oauth_credential_artifacts_vault_reference_uq ON ai_media_oauth_credential_artifacts(vault_reference);
CREATE UNIQUE INDEX ai_media_oauth_credential_artifacts_exact_artifact_uq
  ON ai_media_oauth_credential_artifacts(owner_user_id,workspace_id,actor_user_id,provider_account_id,platform,
    oauth_session_id,attempt_id,credential_binding_id,artifact_binding_id,role,id,vault_reference);
CREATE INDEX ai_media_oauth_credential_artifacts_attempt_state_idx
  ON ai_media_oauth_credential_artifacts(owner_user_id,workspace_id,attempt_id,state);
ALTER TABLE ai_media_oauth_credential_artifacts ADD CONSTRAINT ai_media_oauth_credential_artifacts_exact_binding_fk
  FOREIGN KEY(owner_user_id,workspace_id,actor_user_id,provider_account_id,platform,oauth_session_id,attempt_id,
    credential_binding_id,candidate_id,target_kind,target_external_id,selection_digest,selected_stage_version,
    selected_eligibility_digest,token_binding_id,artifact_binding_id,expected_credential_version,
    target_credential_version,manifest_revision)
  REFERENCES ai_media_provider_account_credential_bindings(owner_user_id,workspace_id,actor_user_id,provider_account_id,
    platform,oauth_session_id,attempt_id,id,candidate_id,target_kind,target_external_id,selection_digest,
    selected_stage_version,selected_eligibility_digest,token_binding_id,artifact_binding_id,
    expected_credential_version,target_credential_version,manifest_revision)
  DEFERRABLE INITIALLY DEFERRED;

CREATE TABLE ai_media_oauth_vault_operations_v2 (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),owner_user_id text NOT NULL,workspace_id text NOT NULL DEFAULT 'personal',
  actor_user_id text NOT NULL,provider_account_id uuid NOT NULL,platform text NOT NULL,oauth_session_id uuid NOT NULL,
  attempt_id uuid NOT NULL,credential_binding_id uuid NOT NULL,artifact_id uuid NOT NULL,artifact_binding_id uuid NOT NULL,
  role text NOT NULL,vault_reference text NOT NULL,target_credential_version integer NOT NULL,
  state text NOT NULL DEFAULT 'cleanup_pending',attempt integer NOT NULL DEFAULT 0,max_attempts integer NOT NULL DEFAULT 8,
  delete_pass integer NOT NULL DEFAULT 0,available_at timestamptz NOT NULL,quiescent_until timestamptz NOT NULL,
  lease_token uuid,lease_owner text,lease_expires_at timestamptz,lease_fencing integer NOT NULL DEFAULT 0,
  last_error_code text,completed_at timestamptz,dead_lettered_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT ai_media_oauth_vault_operations_v2_context_ck CHECK (
    role IN ('operational_access','refresh') AND target_credential_version>0 AND available_at>=created_at
    AND vault_reference='vault://ai-media-studio/oauth-role-token/v2/'||encode(digest(
      convert_to('["'||artifact_binding_id::text||'","'||role||'"]','UTF8'),'sha256'),'hex')
  ),
  CONSTRAINT ai_media_oauth_vault_operations_v2_lifecycle_ck CHECK (
    state IN ('cleanup_pending','retained','leased','retry_wait','verify_wait','completed','dead_letter')
    AND attempt BETWEEN 0 AND max_attempts AND max_attempts BETWEEN 1 AND 32
    AND delete_pass BETWEEN 0 AND 2 AND lease_fencing>=0 AND quiescent_until>=created_at
    AND ((state='leased')=(lease_token IS NOT NULL)) AND ((lease_token IS NULL)=(lease_owner IS NULL))
    AND ((lease_token IS NULL)=(lease_expires_at IS NULL))
    AND (lease_token IS NULL OR (length(btrim(lease_owner)) BETWEEN 1 AND 255
      AND lease_expires_at>updated_at AND lease_expires_at<=updated_at+interval '5 minutes'))
    AND ((state='retained')=(available_at='infinity'::timestamptz AND quiescent_until='infinity'::timestamptz))
    AND (state='retained' OR (isfinite(available_at) AND isfinite(quiescent_until)))
    AND (state<>'verify_wait' OR delete_pass=1)
    AND (state<>'completed' OR (delete_pass=2 AND completed_at IS NOT NULL))
    AND (state<>'dead_letter' OR dead_lettered_at IS NOT NULL)
    AND (state NOT IN ('completed','dead_letter') OR lease_token IS NULL)
    AND (completed_at IS NULL OR state='completed') AND (dead_lettered_at IS NULL OR state='dead_letter')
    AND (last_error_code IS NULL OR last_error_code IN ('vault_rejected','vault_timeout','lease_lost','invalid_obligation'))
  )
);
CREATE UNIQUE INDEX ai_media_oauth_vault_operations_v2_artifact_uq ON ai_media_oauth_vault_operations_v2(artifact_id);
CREATE UNIQUE INDEX ai_media_oauth_vault_operations_v2_vault_reference_uq ON ai_media_oauth_vault_operations_v2(vault_reference);
CREATE INDEX ai_media_oauth_vault_operations_v2_due_idx ON ai_media_oauth_vault_operations_v2(state,available_at,quiescent_until);
CREATE INDEX ai_media_oauth_vault_operations_v2_tenant_due_idx ON ai_media_oauth_vault_operations_v2(owner_user_id,workspace_id,state,available_at);
ALTER TABLE ai_media_oauth_vault_operations_v2 ADD CONSTRAINT ai_media_oauth_vault_operations_v2_exact_artifact_fk
  FOREIGN KEY(owner_user_id,workspace_id,actor_user_id,provider_account_id,platform,oauth_session_id,attempt_id,
    credential_binding_id,artifact_binding_id,role,artifact_id,vault_reference)
  REFERENCES ai_media_oauth_credential_artifacts(owner_user_id,workspace_id,actor_user_id,provider_account_id,
    platform,oauth_session_id,attempt_id,credential_binding_id,artifact_binding_id,role,id,vault_reference)
  ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED;

CREATE FUNCTION ai_media_oauth_pr16_authorized_digest(binding_id uuid) RETURNS text
LANGUAGE plpgsql STABLE SET search_path=pg_catalog AS $authorized_digest$
DECLARE binding record;artifact_payload text;scope_payload text;capability_payload text;payload text;
BEGIN
  SELECT * INTO binding FROM public.ai_media_provider_account_credential_bindings WHERE id=binding_id;
  IF NOT FOUND THEN RETURN NULL;END IF;
  SELECT '['||string_agg(
    '['||to_jsonb(artifact.role)::text||','||to_jsonb(artifact.artifact_binding_id::text)::text||','
      ||to_jsonb(artifact.vault_reference)::text||','||to_jsonb(artifact.manifest_revision)::text||','
      ||to_jsonb(artifact.lifetime_kind)::text||','
      ||to_jsonb(to_char(artifact.revalidate_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))::text||','
      ||CASE WHEN artifact.lifetime_kind='expires_at'
        THEN to_jsonb(to_char(artifact.expires_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))::text
        ELSE 'null' END||']',',' ORDER BY CASE artifact.role WHEN 'operational_access' THEN 1 WHEN 'refresh' THEN 2 ELSE 3 END
  )||']' INTO artifact_payload
  FROM public.ai_media_oauth_credential_artifacts artifact WHERE artifact.credential_binding_id=binding.id;
  SELECT '['||string_agg(to_jsonb(value)::text,',' ORDER BY value)||']' INTO scope_payload
    FROM jsonb_array_elements_text(binding.actual_scopes) value;
  SELECT '['||string_agg(to_jsonb(value)::text,',' ORDER BY value)||']' INTO capability_payload
    FROM jsonb_array_elements_text(binding.capabilities) value;
  IF artifact_payload IS NULL OR scope_payload IS NULL OR capability_payload IS NULL THEN RETURN NULL;END IF;
  payload:='['||to_jsonb('ai-media-oauth-provider-authorization-v1'::text)::text||','
    ||to_jsonb(binding.attempt_id::text)::text||','||to_jsonb(binding.owner_user_id)::text||','
    ||to_jsonb(binding.workspace_id)::text||','||to_jsonb(binding.actor_user_id)::text||','
    ||binding.activation_stage_version::text||','||to_jsonb(binding.candidate_id::text)::text||','
    ||to_jsonb(binding.target_external_id)::text||','||to_jsonb(binding.target_kind)::text||','
    ||to_jsonb(binding.selected_eligibility_digest)::text||','||binding.selected_stage_version::text||','
    ||to_jsonb(binding.selection_digest)::text||','||to_jsonb(binding.token_binding_id::text)::text||','
    ||to_jsonb(binding.artifact_binding_id::text)::text||','||artifact_payload||','||scope_payload||','
    ||capability_payload||','||to_jsonb(binding.manifest_revision)::text||','
    ||binding.expected_credential_version::text||','||binding.target_credential_version::text||']';
  RETURN encode(public.digest(convert_to(payload,'UTF8'),'sha256'),'hex');
END;
$authorized_digest$;
REVOKE ALL ON FUNCTION ai_media_oauth_pr16_authorized_digest(uuid) FROM PUBLIC;

ALTER TABLE ai_media_provider_accounts ADD CONSTRAINT ai_media_provider_accounts_oauth_role_v2_binding_fk
  FOREIGN KEY(owner_user_id,workspace_id,credential_actor_user_id,id,provider_key,credential_source_session_id,
    credential_binding_id,external_account_id,token_binding_id,credential_version,token_manifest_revision,
    granted_scopes,capabilities)
  REFERENCES ai_media_provider_account_credential_bindings(owner_user_id,workspace_id,actor_user_id,
    provider_account_id,platform,oauth_session_id,id,target_external_id,token_binding_id,
    target_credential_version,manifest_revision,actual_scopes,capabilities)
  ON UPDATE NO ACTION ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED;

CREATE FUNCTION ai_media_oauth_assert_pr16_binding(binding_id uuid) RETURNS void
LANGUAGE plpgsql SET search_path=pg_catalog AS $assert_binding$
DECLARE binding record;attempt_row record;candidate_row record;artifact_count integer;operation_count integer;account_count integer;artifact_metadata jsonb;
BEGIN
  SELECT * INTO binding FROM public.ai_media_provider_account_credential_bindings WHERE id=binding_id;
  IF NOT FOUND THEN RETURN;END IF;
  SELECT * INTO attempt_row FROM public.ai_media_oauth_connection_attempts
    WHERE owner_user_id=binding.owner_user_id AND workspace_id=binding.workspace_id
      AND actor_user_id=binding.actor_user_id AND provider_account_id=binding.provider_account_id
      AND platform=binding.platform AND oauth_session_id=binding.oauth_session_id AND id=binding.attempt_id;
  IF NOT FOUND OR attempt_row.token_binding_id<>binding.token_binding_id
    OR attempt_row.manifest_revision<>binding.manifest_revision
    OR attempt_row.expected_credential_version<>binding.expected_credential_version
    OR attempt_row.target_credential_version<>binding.target_credential_version
    OR attempt_row.actual_scopes IS DISTINCT FROM binding.actual_scopes THEN
    RAISE EXCEPTION 'PR16A binding attempt evidence mismatch';END IF;
  SELECT * INTO candidate_row FROM public.ai_media_oauth_target_candidates
    WHERE owner_user_id=binding.owner_user_id AND workspace_id=binding.workspace_id
      AND actor_user_id=binding.actor_user_id AND provider_account_id=binding.provider_account_id
      AND platform=binding.platform AND oauth_session_id=binding.oauth_session_id AND attempt_id=binding.attempt_id
      AND candidate_id=binding.candidate_id AND target_kind=binding.target_kind
      AND target_external_id=binding.target_external_id;
  IF NOT FOUND OR candidate_row.eligibility_digest<>binding.selected_eligibility_digest
    OR candidate_row.capabilities IS DISTINCT FROM binding.capabilities
    OR candidate_row.manifest_revision<>binding.manifest_revision THEN
    RAISE EXCEPTION 'PR16A binding candidate evidence mismatch';END IF;
  SELECT jsonb_agg(jsonb_build_object('role',artifact.role,'lifetime',
    CASE WHEN artifact.lifetime_kind='expires_at' THEN jsonb_build_object(
      'kind',artifact.lifetime_kind,
      'expiresAt',to_char(artifact.expires_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'revalidateAt',to_char(artifact.revalidate_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
    ELSE jsonb_build_object('kind',artifact.lifetime_kind,
      'revalidateAt',to_char(artifact.revalidate_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) END)
    ORDER BY CASE artifact.role WHEN 'operational_access' THEN 1 WHEN 'refresh' THEN 2 ELSE 3 END)
    INTO artifact_metadata FROM public.ai_media_oauth_credential_artifacts artifact
    WHERE artifact.credential_binding_id=binding.id;
  IF attempt_row.grant_family<>'meta_facebook_login'
    AND artifact_metadata IS DISTINCT FROM attempt_row.token_artifacts THEN
    RAISE EXCEPTION 'PR16A artifact lifetime evidence mismatch';END IF;
  SELECT count(*),count(operation.id) INTO artifact_count,operation_count
  FROM public.ai_media_oauth_credential_artifacts artifact
  LEFT JOIN public.ai_media_oauth_vault_operations_v2 operation
    ON operation.owner_user_id=artifact.owner_user_id AND operation.workspace_id=artifact.workspace_id
    AND operation.credential_binding_id=artifact.credential_binding_id AND operation.artifact_id=artifact.id
    AND operation.vault_reference=artifact.vault_reference
  WHERE artifact.credential_binding_id=binding.id;
  IF (binding.platform IN ('tiktok','youtube_shorts') AND artifact_count<>2)
    OR (binding.platform IN ('facebook','instagram') AND artifact_count<>1)
    OR operation_count<>artifact_count
    OR NOT EXISTS (SELECT 1 FROM public.ai_media_oauth_credential_artifacts
      WHERE credential_binding_id=binding.id AND role='operational_access')
    OR (binding.platform IN ('tiktok','youtube_shorts') AND NOT EXISTS (
      SELECT 1 FROM public.ai_media_oauth_credential_artifacts WHERE credential_binding_id=binding.id AND role='refresh'))
    OR (binding.platform IN ('facebook','instagram') AND EXISTS (
      SELECT 1 FROM public.ai_media_oauth_credential_artifacts WHERE credential_binding_id=binding.id AND role='refresh')) THEN
    RAISE EXCEPTION 'PR16A binding requires the exact platform artifact and cleanup set';END IF;
  SELECT count(*) INTO account_count FROM public.ai_media_provider_accounts account
    WHERE account.credential_source='oauth_role_v2' AND account.credential_binding_id=binding.id;
  IF binding.state='staged' THEN
    IF account_count<>0 OR attempt_row.stage<>'activation_in_progress'
      OR attempt_row.stage_version<>binding.activation_stage_version
      OR EXISTS (SELECT 1 FROM public.ai_media_oauth_credential_artifacts WHERE credential_binding_id=binding.id AND state<>'candidate')
      OR EXISTS (SELECT 1 FROM public.ai_media_oauth_vault_operations_v2 WHERE credential_binding_id=binding.id AND state<>'cleanup_pending') THEN
      RAISE EXCEPTION 'PR16A staged binding graph is inconsistent';END IF;
  ELSIF binding.state='authorized' THEN
    IF account_count<>1 OR attempt_row.stage<>'authorized'
      OR attempt_row.stage_version<>binding.activation_stage_version+1
      OR attempt_row.terminal_evidence_digest<>binding.authorized_digest
      OR binding.authorized_digest IS DISTINCT FROM public.ai_media_oauth_pr16_authorized_digest(binding.id)
      OR EXISTS (SELECT 1 FROM public.ai_media_oauth_credential_artifacts WHERE credential_binding_id=binding.id AND state<>'active')
      OR EXISTS (SELECT 1 FROM public.ai_media_oauth_vault_operations_v2 WHERE credential_binding_id=binding.id AND state<>'retained') THEN
      RAISE EXCEPTION 'PR16A authorized binding graph is inconsistent';END IF;
  ELSE
    IF account_count<>0 OR attempt_row.stage NOT IN ('activation_indeterminate','failed')
      OR EXISTS (SELECT 1 FROM public.ai_media_oauth_credential_artifacts WHERE credential_binding_id=binding.id AND state='active')
      OR EXISTS (SELECT 1 FROM public.ai_media_oauth_vault_operations_v2 WHERE credential_binding_id=binding.id AND state='retained')
      OR EXISTS (
        SELECT 1 FROM public.ai_media_oauth_credential_artifacts artifact
        JOIN public.ai_media_oauth_vault_operations_v2 operation
          ON operation.credential_binding_id=artifact.credential_binding_id AND operation.artifact_id=artifact.id
        WHERE artifact.credential_binding_id=binding.id AND NOT (
          (artifact.state='candidate' AND operation.state='cleanup_pending')
          OR (artifact.state='cleanup_leased' AND operation.state='leased')
          OR (artifact.state='cleanup_retry' AND operation.state='retry_wait')
          OR (artifact.state='cleanup_verify' AND operation.state='verify_wait')
          OR (artifact.state='deleted' AND operation.state='completed')
          OR (artifact.state='cleanup_dead_letter' AND operation.state='dead_letter')
        )
      ) THEN
      RAISE EXCEPTION 'PR16A abandoned binding graph is inconsistent';END IF;
  END IF;
END;
$assert_binding$;
REVOKE ALL ON FUNCTION ai_media_oauth_assert_pr16_binding(uuid) FROM PUBLIC;

CREATE FUNCTION ai_media_oauth_guard_pr16_evidence() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $guard_evidence$
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'PR16A activation evidence is immutable';END IF;
  IF TG_TABLE_NAME='ai_media_oauth_connection_attempts' AND TG_OP='UPDATE' THEN
    IF (to_jsonb(NEW)-ARRAY['stage','stage_version','actual_scopes','token_artifacts','lease_token','lease_owner',
        'lease_expires_at','lease_fencing','failure_code','terminal_outcome','terminal_evidence_digest','terminal_at','updated_at'])
      IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['stage','stage_version','actual_scopes','token_artifacts','lease_token','lease_owner',
        'lease_expires_at','lease_fencing','failure_code','terminal_outcome','terminal_evidence_digest','terminal_at','updated_at'])
      OR OLD.stage IN ('exchange_indeterminate','activation_indeterminate','authorized','failed')
      OR NEW.stage_version<>OLD.stage_version+1 OR NEW.updated_at<=OLD.updated_at
      OR NOT ((OLD.stage='exchange_pending' AND NEW.stage='exchange_in_progress')
        OR (OLD.stage='exchange_in_progress' AND NEW.stage IN ('exchange_in_progress','discovery_pending','exchange_indeterminate','failed'))
        OR (OLD.stage='discovery_pending' AND NEW.stage='discovery_in_progress')
        OR (OLD.stage='discovery_in_progress' AND NEW.stage IN ('discovery_in_progress','awaiting_target','failed'))
        OR (OLD.stage='awaiting_target' AND NEW.stage='activation_pending')
        OR (OLD.stage='activation_pending' AND NEW.stage='activation_in_progress')
        OR (OLD.stage='activation_in_progress' AND NEW.stage IN ('activation_in_progress','activation_indeterminate','authorized','failed'))) THEN
      RAISE EXCEPTION 'PR16A attempt transition rejected';END IF;
  ELSIF TG_TABLE_NAME='ai_media_provider_account_credential_bindings' AND TG_OP='UPDATE' THEN
    IF (to_jsonb(NEW)-ARRAY['state','authorized_digest','authorized_at','abandoned_at','updated_at'])
      IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['state','authorized_digest','authorized_at','abandoned_at','updated_at'])
      OR OLD.state<>'staged' OR NEW.state NOT IN ('authorized','abandoned') OR NEW.updated_at<=OLD.updated_at THEN
      RAISE EXCEPTION 'PR16A binding transition rejected';END IF;
  ELSIF TG_TABLE_NAME='ai_media_oauth_credential_artifacts' AND TG_OP='UPDATE' THEN
    IF (to_jsonb(NEW)-ARRAY['state','activated_at','cleanup_completed_at','updated_at'])
      IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['state','activated_at','cleanup_completed_at','updated_at'])
      OR NOT ((OLD.state='candidate' AND NEW.state IN ('active','cleanup_leased','cleanup_retry','cleanup_dead_letter'))
        OR (OLD.state='active' AND NEW.state='cleanup_leased')
        OR (OLD.state='cleanup_leased' AND NEW.state IN ('cleanup_retry','cleanup_verify','cleanup_dead_letter'))
        OR (OLD.state='cleanup_retry' AND NEW.state IN ('cleanup_leased','cleanup_dead_letter'))
        OR (OLD.state='cleanup_verify' AND NEW.state IN ('cleanup_leased','deleted','cleanup_retry','cleanup_dead_letter')))
      OR NEW.updated_at<=OLD.updated_at THEN RAISE EXCEPTION 'PR16A artifact transition rejected';END IF;
  ELSIF TG_TABLE_NAME='ai_media_oauth_vault_operations_v2' AND TG_OP='UPDATE' THEN
    IF (to_jsonb(NEW)-ARRAY['state','attempt','delete_pass','available_at','quiescent_until','lease_token','lease_owner',
        'lease_expires_at','lease_fencing','last_error_code','completed_at','dead_lettered_at','updated_at'])
      IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['state','attempt','delete_pass','available_at','quiescent_until','lease_token','lease_owner',
        'lease_expires_at','lease_fencing','last_error_code','completed_at','dead_lettered_at','updated_at'])
      OR OLD.state IN ('completed','dead_letter') OR NEW.attempt<OLD.attempt OR NEW.lease_fencing<OLD.lease_fencing
      OR NOT ((OLD.state='cleanup_pending' AND NEW.state IN ('retained','leased','dead_letter'))
        OR (OLD.state='retained' AND NEW.state='leased') OR (OLD.state='leased' AND NEW.state IN ('retry_wait','verify_wait','completed','dead_letter'))
        OR (OLD.state='retry_wait' AND NEW.state IN ('leased','dead_letter'))
        OR (OLD.state='verify_wait' AND NEW.state IN ('leased','retry_wait','dead_letter')))
      OR NEW.updated_at<=OLD.updated_at THEN RAISE EXCEPTION 'PR16A cleanup transition rejected';END IF;
  END IF;
  RETURN NEW;
END;
$guard_evidence$;
REVOKE ALL ON FUNCTION ai_media_oauth_guard_pr16_evidence() FROM PUBLIC;
CREATE TRIGGER ai_media_provider_account_credential_bindings_guard BEFORE UPDATE OR DELETE ON ai_media_provider_account_credential_bindings FOR EACH ROW EXECUTE FUNCTION ai_media_oauth_guard_pr16_evidence();
CREATE TRIGGER ai_media_oauth_credential_artifacts_guard BEFORE UPDATE OR DELETE ON ai_media_oauth_credential_artifacts FOR EACH ROW EXECUTE FUNCTION ai_media_oauth_guard_pr16_evidence();
CREATE TRIGGER ai_media_oauth_vault_operations_v2_guard BEFORE UPDATE OR DELETE ON ai_media_oauth_vault_operations_v2 FOR EACH ROW EXECUTE FUNCTION ai_media_oauth_guard_pr16_evidence();
CREATE TRIGGER ai_media_oauth_connection_attempts_pr16_guard BEFORE UPDATE OR DELETE ON ai_media_oauth_connection_attempts FOR EACH ROW EXECUTE FUNCTION ai_media_oauth_guard_pr16_evidence();

CREATE FUNCTION ai_media_oauth_validate_pr16_graph() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $validate_graph$
DECLARE candidate uuid;
BEGIN
  IF TG_TABLE_NAME='ai_media_oauth_connection_attempts' THEN
    FOR candidate IN SELECT id FROM public.ai_media_provider_account_credential_bindings
      WHERE attempt_id=COALESCE(NEW.id,OLD.id) LOOP
      PERFORM public.ai_media_oauth_assert_pr16_binding(candidate);
    END LOOP;
    RETURN NULL;
  ELSIF TG_TABLE_NAME='ai_media_provider_account_credential_bindings' THEN candidate:=COALESCE(NEW.id,OLD.id);
  ELSIF TG_TABLE_NAME IN ('ai_media_oauth_credential_artifacts','ai_media_oauth_vault_operations_v2') THEN candidate:=COALESCE(NEW.credential_binding_id,OLD.credential_binding_id);
  ELSE candidate:=COALESCE(NEW.credential_binding_id,OLD.credential_binding_id);END IF;
  IF candidate IS NOT NULL THEN PERFORM public.ai_media_oauth_assert_pr16_binding(candidate);END IF;
  RETURN NULL;
END;
$validate_graph$;
REVOKE ALL ON FUNCTION ai_media_oauth_validate_pr16_graph() FROM PUBLIC;
CREATE CONSTRAINT TRIGGER ai_media_provider_account_credential_bindings_graph AFTER INSERT OR UPDATE OR DELETE ON ai_media_provider_account_credential_bindings DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION ai_media_oauth_validate_pr16_graph();
CREATE CONSTRAINT TRIGGER ai_media_oauth_credential_artifacts_graph AFTER INSERT OR UPDATE OR DELETE ON ai_media_oauth_credential_artifacts DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION ai_media_oauth_validate_pr16_graph();
CREATE CONSTRAINT TRIGGER ai_media_oauth_vault_operations_v2_graph AFTER INSERT OR UPDATE OR DELETE ON ai_media_oauth_vault_operations_v2 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION ai_media_oauth_validate_pr16_graph();
CREATE CONSTRAINT TRIGGER ai_media_provider_accounts_pr16_graph AFTER INSERT OR UPDATE OF credential_source,credential_binding_id,credential_version,token_binding_id,token_manifest_revision,status,credential_status ON ai_media_provider_accounts DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION ai_media_oauth_validate_pr16_graph();
CREATE CONSTRAINT TRIGGER ai_media_oauth_connection_attempts_pr16_graph AFTER UPDATE OR DELETE ON ai_media_oauth_connection_attempts DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION ai_media_oauth_validate_pr16_graph();

REVOKE ALL ON ai_media_provider_account_credential_bindings,ai_media_oauth_credential_artifacts,ai_media_oauth_vault_operations_v2 FROM PUBLIC;
COMMIT;
