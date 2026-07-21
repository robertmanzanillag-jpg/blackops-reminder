-- AI Media Studio PR15: durable provider-connection stages and explicit target selection.
-- Reviewed, additive/data-preserving migration. Do not apply automatically.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15min';
SET LOCAL search_path = public, pg_catalog;

DO $preflight$
DECLARE missing_control text;
BEGIN
  IF to_regclass('public.ai_media_oauth_sessions') IS NULL
    OR to_regclass('public.ai_media_provider_accounts') IS NULL
    OR to_regclass('public.ai_media_oauth_vault_operations') IS NULL THEN
    RAISE EXCEPTION 'PR15 requires unapplied relation-exact PR12 and PR14 storage controls';
  END IF;
  SELECT required.name INTO missing_control FROM (VALUES
    ('ai_media_oauth_sessions_authorization_saga_ck','ai_media_oauth_sessions'),
    ('ai_media_oauth_sessions_provider_account_tenant_platform_fk','ai_media_oauth_sessions'),
    ('ai_media_provider_accounts_oauth_credential_provenance_ck','ai_media_provider_accounts'),
    ('ai_media_oauth_vault_operations_lifecycle_ck','ai_media_oauth_vault_operations'),
    ('ai_media_oauth_vault_operations_session_source_fk','ai_media_oauth_vault_operations')
  ) required(name,relation_name)
  WHERE NOT EXISTS (
    SELECT 1 FROM pg_constraint controls
    WHERE controls.conname=required.name
      AND controls.conrelid=('public.'||required.relation_name)::regclass
      AND controls.convalidated
  );
  IF missing_control IS NOT NULL THEN
    RAISE EXCEPTION 'PR15 requires validated PR12/PR14 control %', missing_control;
  END IF;
  IF to_regclass('public.ai_media_oauth_sessions_provider_account_authorization_source_uq') IS NULL
    OR to_regprocedure('public.ai_media_oauth_reject_target_evidence_mutation()') IS NOT NULL
    OR to_regclass('public.ai_media_oauth_connection_attempts') IS NOT NULL
    OR to_regclass('public.ai_media_oauth_target_candidates') IS NOT NULL
    OR to_regclass('public.ai_media_oauth_target_selections') IS NOT NULL THEN
    RAISE EXCEPTION 'PR15 requires exact session source index and all PR15 tables absent';
  END IF;
END;
$preflight$;

CREATE TABLE ai_media_oauth_connection_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id text NOT NULL,
  workspace_id text NOT NULL DEFAULT 'personal',
  actor_user_id text NOT NULL,
  provider_account_id uuid NOT NULL,
  platform text NOT NULL,
  oauth_session_id uuid NOT NULL,
  stage text NOT NULL DEFAULT 'exchange_pending',
  stage_version integer NOT NULL DEFAULT 1,
  grant_family text NOT NULL,
  manifest_revision text NOT NULL,
  required_scopes jsonb NOT NULL,
  allowed_scopes jsonb NOT NULL,
  actual_scopes jsonb,
  token_artifacts jsonb,
  token_binding_id uuid NOT NULL,
  expected_credential_version integer NOT NULL,
  target_credential_version integer NOT NULL,
  lease_token uuid,
  lease_owner text,
  lease_expires_at timestamptz,
  lease_fencing integer NOT NULL DEFAULT 0,
  failure_code text,
  terminal_outcome text,
  terminal_evidence_digest text,
  terminal_at timestamptz,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT ai_media_oauth_connection_attempts_stage_ck CHECK (
    stage IN ('exchange_pending','exchange_in_progress','exchange_indeterminate','discovery_pending',
      'discovery_in_progress','awaiting_target','activation_pending','activation_in_progress','authorized','failed')
    AND stage_version >= 1
  ),
  CONSTRAINT ai_media_oauth_connection_attempts_source_ck CHECK (
    length(btrim(actor_user_id)) BETWEEN 1 AND 255
    AND length(btrim(manifest_revision)) BETWEEN 1 AND 100
    AND expected_credential_version >= 0 AND target_credential_version=expected_credential_version+1
    AND ((platform='tiktok' AND grant_family='tiktok_user')
      OR (platform='youtube_shorts' AND grant_family='google_user')
      OR (platform IN ('facebook','instagram') AND grant_family='meta_facebook_login'))
  ),
  CONSTRAINT ai_media_oauth_connection_attempts_scopes_ck CHECK (
    jsonb_typeof(required_scopes)='array' AND jsonb_array_length(required_scopes) BETWEEN 1 AND 50
    AND jsonb_typeof(allowed_scopes)='array' AND jsonb_array_length(allowed_scopes) BETWEEN 1 AND 50
    AND allowed_scopes @> required_scopes
    AND (actual_scopes IS NULL OR (jsonb_typeof(actual_scopes)='array'
      AND jsonb_array_length(actual_scopes) BETWEEN 1 AND 50
      AND actual_scopes @> required_scopes AND allowed_scopes @> actual_scopes))
    AND (stage NOT IN ('exchange_pending','exchange_in_progress','exchange_indeterminate','failed') OR actual_scopes IS NULL OR stage='failed')
    AND (stage NOT IN ('discovery_pending','discovery_in_progress','awaiting_target','activation_pending','activation_in_progress','authorized') OR actual_scopes IS NOT NULL)
    AND ((actual_scopes IS NULL)=(token_artifacts IS NULL))
    AND (token_artifacts IS NULL OR (jsonb_typeof(token_artifacts)='array'
      AND jsonb_array_length(token_artifacts) BETWEEN 1 AND 3
      AND token_artifacts::text !~* '"(reference|secret|access_token|refresh_token|provider_json)"'))
  ),
  CONSTRAINT ai_media_oauth_connection_attempts_lease_ck CHECK (
    lease_fencing>=0 AND ((lease_token IS NULL)=(lease_owner IS NULL))
    AND ((lease_token IS NULL)=(lease_expires_at IS NULL))
    AND (lease_token IS NULL OR (length(btrim(lease_owner)) BETWEEN 1 AND 255
      AND lease_expires_at>updated_at AND lease_expires_at<=updated_at+interval '5 minutes'))
    AND ((stage IN ('exchange_in_progress','discovery_in_progress','activation_in_progress'))=(lease_token IS NOT NULL))
  ),
  CONSTRAINT ai_media_oauth_connection_attempts_terminal_ck CHECK (
    ((stage IN ('authorized','failed'))=(terminal_at IS NOT NULL))
    AND ((stage IN ('authorized','failed'))=(terminal_outcome IS NOT NULL))
    AND ((stage IN ('authorized','failed'))=(terminal_evidence_digest IS NOT NULL))
    AND (terminal_outcome IS NULL OR terminal_outcome IN ('authorized','not_connectable','failed'))
    AND (terminal_evidence_digest IS NULL OR terminal_evidence_digest ~ '^[0-9a-f]{64}$')
    AND (failure_code IS NULL OR failure_code IN ('invalid_exchange','exchange_ambiguous','scope_mismatch',
      'invalid_artifact','invalid_discovery','target_not_found','target_mismatch','activation_rejected',
      'provider_rejected','internal_failure','no_targets'))
    AND (stage<>'exchange_indeterminate' OR failure_code='exchange_ambiguous')
    AND (stage<>'failed' OR failure_code IS NOT NULL)
    AND expires_at>created_at
  )
);

CREATE UNIQUE INDEX ai_media_oauth_connection_attempts_exact_source_uq
  ON ai_media_oauth_connection_attempts(owner_user_id,workspace_id,actor_user_id,provider_account_id,platform,oauth_session_id,id,manifest_revision);
CREATE UNIQUE INDEX ai_media_oauth_connection_attempts_session_uq
  ON ai_media_oauth_connection_attempts(owner_user_id,workspace_id,actor_user_id,provider_account_id,platform,oauth_session_id);
CREATE UNIQUE INDEX ai_media_oauth_connection_attempts_token_binding_uq
  ON ai_media_oauth_connection_attempts(token_binding_id);
CREATE INDEX ai_media_oauth_connection_attempts_due_idx
  ON ai_media_oauth_connection_attempts(stage,lease_expires_at,updated_at);
CREATE INDEX ai_media_oauth_connection_attempts_tenant_stage_idx
  ON ai_media_oauth_connection_attempts(owner_user_id,workspace_id,stage,updated_at);

ALTER TABLE ai_media_oauth_connection_attempts ADD CONSTRAINT ai_media_oauth_connection_attempts_session_source_fk
  FOREIGN KEY(owner_user_id,workspace_id,actor_user_id,provider_account_id,platform,oauth_session_id)
  REFERENCES ai_media_oauth_sessions(owner_user_id,workspace_id,actor_user_id,provider_account_id,platform,id)
  ON UPDATE NO ACTION ON DELETE NO ACTION NOT VALID;
ALTER TABLE ai_media_oauth_connection_attempts
  VALIDATE CONSTRAINT ai_media_oauth_connection_attempts_session_source_fk;

CREATE TABLE ai_media_oauth_target_candidates (
  candidate_id uuid NOT NULL,
  owner_user_id text NOT NULL,
  workspace_id text NOT NULL DEFAULT 'personal',
  actor_user_id text NOT NULL,
  provider_account_id uuid NOT NULL,
  platform text NOT NULL,
  oauth_session_id uuid NOT NULL,
  attempt_id uuid NOT NULL,
  target_kind text NOT NULL,
  target_external_id text NOT NULL,
  safe_label text,
  parent_target_id text,
  eligibility_digest text NOT NULL,
  verified_tasks jsonb NOT NULL,
  capabilities jsonb NOT NULL,
  manifest_revision text NOT NULL,
  discovered_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT ai_media_oauth_target_candidates_identity_ck CHECK (
    target_kind IN ('tiktok_user','youtube_channel','facebook_page','instagram_professional_account')
    AND ((platform='tiktok' AND target_kind='tiktok_user')
      OR (platform='youtube_shorts' AND target_kind='youtube_channel')
      OR (platform='facebook' AND target_kind='facebook_page')
      OR (platform='instagram' AND target_kind='instagram_professional_account'))
    AND length(btrim(target_external_id)) BETWEEN 1 AND 255
    AND (safe_label IS NULL OR (length(safe_label) BETWEEN 1 AND 200 AND safe_label=btrim(safe_label)
      AND safe_label !~ '[[:cntrl:]]'))
    AND (parent_target_id IS NULL OR (length(btrim(parent_target_id)) BETWEEN 1 AND 255
      AND parent_target_id !~ '[[:cntrl:]]'))
    AND eligibility_digest ~ '^[0-9a-f]{64}$'
    AND length(btrim(manifest_revision)) BETWEEN 1 AND 100
    AND jsonb_typeof(verified_tasks)='array' AND jsonb_array_length(verified_tasks) BETWEEN 1 AND 50
    AND jsonb_typeof(capabilities)='array' AND jsonb_array_length(capabilities) BETWEEN 1 AND 20
  )
);
CREATE UNIQUE INDEX ai_media_oauth_target_candidates_exact_candidate_uq
  ON ai_media_oauth_target_candidates(owner_user_id,workspace_id,actor_user_id,provider_account_id,platform,
    oauth_session_id,attempt_id,candidate_id,target_kind,target_external_id);
CREATE UNIQUE INDEX ai_media_oauth_target_candidates_attempt_candidate_id_uq
  ON ai_media_oauth_target_candidates(owner_user_id,workspace_id,attempt_id,candidate_id);
CREATE UNIQUE INDEX ai_media_oauth_target_candidates_attempt_target_uq
  ON ai_media_oauth_target_candidates(owner_user_id,workspace_id,attempt_id,target_kind,target_external_id);
CREATE INDEX ai_media_oauth_target_candidates_attempt_idx
  ON ai_media_oauth_target_candidates(owner_user_id,workspace_id,attempt_id,discovered_at);
ALTER TABLE ai_media_oauth_target_candidates ADD CONSTRAINT ai_media_oauth_target_candidates_attempt_source_fk
  FOREIGN KEY(owner_user_id,workspace_id,actor_user_id,provider_account_id,platform,oauth_session_id,attempt_id,manifest_revision)
  REFERENCES ai_media_oauth_connection_attempts(owner_user_id,workspace_id,actor_user_id,provider_account_id,platform,oauth_session_id,id,manifest_revision)
  ON UPDATE NO ACTION ON DELETE NO ACTION NOT VALID;
ALTER TABLE ai_media_oauth_target_candidates VALIDATE CONSTRAINT ai_media_oauth_target_candidates_attempt_source_fk;

CREATE TABLE ai_media_oauth_target_selections (
  owner_user_id text NOT NULL,
  workspace_id text NOT NULL DEFAULT 'personal',
  actor_user_id text NOT NULL,
  provider_account_id uuid NOT NULL,
  platform text NOT NULL,
  oauth_session_id uuid NOT NULL,
  attempt_id uuid NOT NULL,
  candidate_id uuid NOT NULL,
  target_kind text NOT NULL,
  target_external_id text NOT NULL,
  selected_actor_user_id text NOT NULL,
  selected_at timestamptz NOT NULL,
  selection_digest text NOT NULL,
  selection_version integer NOT NULL DEFAULT 1,
  selected_stage_version integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT ai_media_oauth_target_selections_identity_ck CHECK (
    target_kind IN ('tiktok_user','youtube_channel','facebook_page','instagram_professional_account')
    AND length(btrim(target_external_id)) BETWEEN 1 AND 255
    AND length(btrim(selected_actor_user_id)) BETWEEN 1 AND 255
    AND selected_actor_user_id=actor_user_id
    AND selection_digest ~ '^[0-9a-f]{64}$'
    AND selection_version=1 AND selected_stage_version>=1
  )
);
CREATE UNIQUE INDEX ai_media_oauth_target_selections_attempt_uq
  ON ai_media_oauth_target_selections(owner_user_id,workspace_id,actor_user_id,provider_account_id,platform,oauth_session_id,attempt_id);
ALTER TABLE ai_media_oauth_target_selections ADD CONSTRAINT ai_media_oauth_target_selections_exact_candidate_fk
  FOREIGN KEY(owner_user_id,workspace_id,actor_user_id,provider_account_id,platform,oauth_session_id,attempt_id,
    candidate_id,target_kind,target_external_id)
  REFERENCES ai_media_oauth_target_candidates(owner_user_id,workspace_id,actor_user_id,provider_account_id,platform,
    oauth_session_id,attempt_id,candidate_id,target_kind,target_external_id)
  ON UPDATE NO ACTION ON DELETE NO ACTION NOT VALID;
ALTER TABLE ai_media_oauth_target_selections VALIDATE CONSTRAINT ai_media_oauth_target_selections_exact_candidate_fk;

CREATE FUNCTION ai_media_oauth_reject_target_evidence_mutation() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $immutable_target_evidence$
BEGIN
  RAISE EXCEPTION 'OAuth target evidence is immutable';
END;
$immutable_target_evidence$;
CREATE TRIGGER ai_media_oauth_target_candidates_immutable
  BEFORE UPDATE OR DELETE ON ai_media_oauth_target_candidates
  FOR EACH ROW EXECUTE FUNCTION ai_media_oauth_reject_target_evidence_mutation();
CREATE TRIGGER ai_media_oauth_target_selections_immutable
  BEFORE UPDATE OR DELETE ON ai_media_oauth_target_selections
  FOR EACH ROW EXECUTE FUNCTION ai_media_oauth_reject_target_evidence_mutation();

COMMIT;
