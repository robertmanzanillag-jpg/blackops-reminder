-- AI Media Studio PR27: fenced provider-terminal evidence and owned ingest handoff.
-- Reviewed additive migration. It performs no provider call and is never applied automatically.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='15min';
SET LOCAL search_path=pg_catalog;

DO $preflight$
BEGIN
  IF current_setting('server_version_num')::integer<160000
    OR to_regclass('public.ai_media_admitted_worker_capabilities') IS NULL
    OR to_regclass('public.ai_media_submission_capacity_leases') IS NULL
    OR to_regclass('public.ai_media_asset_ingest_jobs') IS NULL
    OR to_regnamespace('ai_media_worker_api') IS NULL
    OR to_regclass('public.ai_media_provider_terminal_checks') IS NOT NULL
    OR to_regclass('public.ai_media_provider_terminal_events') IS NOT NULL
    OR to_regprocedure('ai_media_worker_api.record_provider_terminal_v1(uuid,text,text,uuid,uuid,bigint,uuid,bigint,text,uuid,text,integer,text,text,text,text,timestamptz,text)') IS NOT NULL THEN
    RAISE EXCEPTION 'PR27 requires PostgreSQL 16, exact PR26 plus asset ingest, and an unused PR27 surface';
  END IF;
END
$preflight$;

ALTER TABLE public.ai_media_admitted_worker_capabilities
  DROP CONSTRAINT ai_media_admitted_worker_capabilities_ck,
  DROP CONSTRAINT ai_media_admitted_worker_capabilities_lane_ops_ck;
ALTER TABLE public.ai_media_admitted_worker_capabilities ADD CONSTRAINT ai_media_admitted_worker_capabilities_ck CHECK (
  lane IN ('submit','reconcile') AND length(btrim(owner_user_id)) BETWEEN 1 AND 200
  AND length(btrim(workspace_id)) BETWEEN 1 AND 200 AND length(btrim(accounting_time_zone)) BETWEEN 1 AND 100
  AND length(btrim(worker_id)) BETWEEN 1 AND 120 AND cardinality(allowed_operations)>0
  AND allowed_operations <@ ARRAY['claim','authorize','expire_authorized','record_submit_confirmed',
    'record_submit_ambiguous','claim_reconciliation','release_reconciliation_unknown',
    'record_reconciled_confirmed','finalize_reconciled_no_submit','release_terminal_capacity',
    'claim_terminal_check','release_terminal_check_unknown','record_provider_terminal']::text[]
  AND max_lease_ms BETWEEN 1 AND 300000 AND max_batch_size BETWEEN 1 AND 100
  AND expires_at>valid_from AND isfinite(valid_from) AND isfinite(expires_at)
  AND (revoked_at IS NULL OR isfinite(revoked_at))
  AND evidence_digest ~ '^sha256:[0-9a-f]{64}$' AND isfinite(created_at));
ALTER TABLE public.ai_media_admitted_worker_capabilities ADD CONSTRAINT ai_media_admitted_worker_capabilities_lane_ops_ck CHECK (
  (lane='submit' AND allowed_operations <@ ARRAY['claim','authorize','expire_authorized',
    'record_submit_confirmed','record_submit_ambiguous']::text[])
  OR (lane='reconcile' AND allowed_operations <@ ARRAY['claim_reconciliation',
    'release_reconciliation_unknown','record_reconciled_confirmed','finalize_reconciled_no_submit',
    'release_terminal_capacity','claim_terminal_check','release_terminal_check_unknown',
    'record_provider_terminal']::text[]));

CREATE UNIQUE INDEX ai_media_provider_submission_attempts_terminal_identity_uq
  ON public.ai_media_provider_submission_attempts(owner_user_id,workspace_id,id,budget_reservation_id,
    render_job_id,dispatch_outbox_id,daily_plan_slot_id,provider_account_id,provider_key,
    provider_credential_version,provider_job_id,send_authorization_digest);

ALTER TABLE public.ai_media_render_jobs ADD COLUMN provider_terminal_state text,
  ADD COLUMN provider_terminal_evidence_digest text,ADD COLUMN provider_terminal_observed_at timestamptz;
ALTER TABLE public.ai_media_outbox ADD COLUMN provider_terminal_state text,
  ADD COLUMN provider_terminal_evidence_digest text,ADD COLUMN provider_terminal_observed_at timestamptz;
ALTER TABLE public.ai_media_daily_plan_slots ADD COLUMN provider_terminal_state text,
  ADD COLUMN provider_terminal_evidence_digest text,ADD COLUMN provider_terminal_observed_at timestamptz;
ALTER TABLE public.ai_media_render_jobs ADD CONSTRAINT ai_media_render_jobs_provider_terminal_ck CHECK (
  (provider_terminal_state IS NULL AND provider_terminal_evidence_digest IS NULL AND provider_terminal_observed_at IS NULL)
  OR (provider_terminal_state IN ('completed','failed')
    AND provider_terminal_evidence_digest ~ '^sha256:[0-9a-f]{64}$' AND isfinite(provider_terminal_observed_at)));
ALTER TABLE public.ai_media_outbox ADD CONSTRAINT ai_media_outbox_provider_terminal_ck CHECK (
  (provider_terminal_state IS NULL AND provider_terminal_evidence_digest IS NULL AND provider_terminal_observed_at IS NULL)
  OR (provider_terminal_state IN ('completed','failed')
    AND provider_terminal_evidence_digest ~ '^sha256:[0-9a-f]{64}$' AND isfinite(provider_terminal_observed_at)));
ALTER TABLE public.ai_media_daily_plan_slots ADD CONSTRAINT ai_media_daily_plan_slots_provider_terminal_ck CHECK (
  (provider_terminal_state IS NULL AND provider_terminal_evidence_digest IS NULL AND provider_terminal_observed_at IS NULL)
  OR (provider_terminal_state IN ('completed','failed')
    AND provider_terminal_evidence_digest ~ '^sha256:[0-9a-f]{64}$' AND isfinite(provider_terminal_observed_at)));

CREATE TABLE public.ai_media_provider_terminal_checks (
  id uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),owner_user_id text NOT NULL,workspace_id text NOT NULL,
  submission_attempt_id uuid NOT NULL,budget_reservation_id uuid NOT NULL,render_job_id uuid NOT NULL,
  dispatch_outbox_id uuid NOT NULL,daily_plan_slot_id uuid NOT NULL,provider_account_id uuid NOT NULL,
  provider_key text NOT NULL,provider_credential_version integer NOT NULL,provider_job_id text NOT NULL,
  send_authorization_digest text NOT NULL,state text NOT NULL,fencing_token bigint NOT NULL DEFAULT 0,
  claim_count integer NOT NULL DEFAULT 0,lease_token uuid,lease_owner text,lease_expires_at timestamptz,
  actor_user_id text NOT NULL,created_at timestamptz NOT NULL DEFAULT pg_catalog.transaction_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT pg_catalog.transaction_timestamp(),
  CONSTRAINT ai_media_provider_terminal_checks_ck CHECK (
    state IN ('pending','leased','terminal') AND fencing_token>=0 AND claim_count>=0
    AND length(btrim(provider_key)) BETWEEN 1 AND 80 AND provider_credential_version>=1
    AND length(btrim(provider_job_id)) BETWEEN 1 AND 500
    AND send_authorization_digest ~ '^sha256:[0-9a-f]{64}$'
    AND length(btrim(actor_user_id)) BETWEEN 1 AND 200
    AND ((state='leased')=(lease_token IS NOT NULL))
    AND ((lease_token IS NULL)=(lease_owner IS NULL)) AND ((lease_token IS NULL)=(lease_expires_at IS NULL))
    AND (lease_expires_at IS NULL OR isfinite(lease_expires_at))
    AND isfinite(created_at) AND isfinite(updated_at)),
  CONSTRAINT ai_media_provider_terminal_checks_attempt_fk FOREIGN KEY
    (owner_user_id,workspace_id,submission_attempt_id,budget_reservation_id,render_job_id,
      dispatch_outbox_id,daily_plan_slot_id,provider_account_id,provider_key,provider_credential_version,
      provider_job_id,send_authorization_digest)
    REFERENCES public.ai_media_provider_submission_attempts(owner_user_id,workspace_id,id,budget_reservation_id,
      render_job_id,dispatch_outbox_id,daily_plan_slot_id,provider_account_id,provider_key,
      provider_credential_version,provider_job_id,send_authorization_digest)
    ON UPDATE NO ACTION ON DELETE RESTRICT);
CREATE UNIQUE INDEX ai_media_provider_terminal_checks_attempt_uq
  ON public.ai_media_provider_terminal_checks(owner_user_id,workspace_id,submission_attempt_id);
CREATE INDEX ai_media_provider_terminal_checks_claim_idx
  ON public.ai_media_provider_terminal_checks(owner_user_id,workspace_id,state,lease_expires_at,created_at);
CREATE UNIQUE INDEX ai_media_provider_terminal_checks_identity_uq
  ON public.ai_media_provider_terminal_checks(owner_user_id,workspace_id,id);

CREATE TABLE public.ai_media_provider_terminal_events (
  id uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),owner_user_id text NOT NULL,workspace_id text NOT NULL,
  terminal_check_id uuid NOT NULL,submission_attempt_id uuid NOT NULL,budget_reservation_id uuid NOT NULL,
  render_job_id uuid NOT NULL,dispatch_outbox_id uuid NOT NULL,daily_plan_slot_id uuid NOT NULL,
  provider_account_id uuid NOT NULL,provider_key text NOT NULL,provider_credential_version integer NOT NULL,
  provider_job_id text NOT NULL,send_authorization_digest text NOT NULL,terminal_state text NOT NULL,
  remote_artifact_ref text,remote_url text,expected_mime_type text,provider_evidence_digest text NOT NULL,
  bound_evidence_digest text NOT NULL,observed_at timestamptz NOT NULL,actor_user_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT pg_catalog.transaction_timestamp(),
  CONSTRAINT ai_media_provider_terminal_events_ck CHECK (
    terminal_state IN ('completed','failed') AND length(btrim(provider_key)) BETWEEN 1 AND 80
    AND provider_credential_version>=1 AND length(btrim(provider_job_id)) BETWEEN 1 AND 500
    AND send_authorization_digest ~ '^sha256:[0-9a-f]{64}$'
    AND provider_evidence_digest ~ '^sha256:[0-9a-f]{64}$'
    AND bound_evidence_digest ~ '^sha256:[0-9a-f]{64}$'
    AND length(btrim(actor_user_id)) BETWEEN 1 AND 200 AND isfinite(observed_at) AND isfinite(created_at)
    AND ((terminal_state='completed' AND length(btrim(remote_artifact_ref)) BETWEEN 1 AND 1000
      AND length(remote_url) BETWEEN 9 AND 8000 AND remote_url ~ '^https://[^[:space:]@/]+(:[0-9]+)?/[^[:space:]#]+([?][^[:space:]#]*)?$'
      AND expected_mime_type='video/mp4')
      OR (terminal_state='failed' AND remote_artifact_ref IS NULL AND remote_url IS NULL AND expected_mime_type IS NULL))),
  CONSTRAINT ai_media_provider_terminal_events_check_fk FOREIGN KEY
    (owner_user_id,workspace_id,terminal_check_id)
    REFERENCES public.ai_media_provider_terminal_checks(owner_user_id,workspace_id,id)
    ON UPDATE NO ACTION ON DELETE RESTRICT,
  CONSTRAINT ai_media_provider_terminal_events_attempt_fk FOREIGN KEY
    (owner_user_id,workspace_id,submission_attempt_id,budget_reservation_id,render_job_id,
      dispatch_outbox_id,daily_plan_slot_id,provider_account_id,provider_key,provider_credential_version,
      provider_job_id,send_authorization_digest)
    REFERENCES public.ai_media_provider_submission_attempts(owner_user_id,workspace_id,id,budget_reservation_id,
      render_job_id,dispatch_outbox_id,daily_plan_slot_id,provider_account_id,provider_key,
      provider_credential_version,provider_job_id,send_authorization_digest)
    ON UPDATE NO ACTION ON DELETE RESTRICT);
CREATE UNIQUE INDEX ai_media_provider_terminal_events_attempt_uq
  ON public.ai_media_provider_terminal_events(owner_user_id,workspace_id,submission_attempt_id);
ALTER TABLE public.ai_media_asset_ingest_jobs ADD CONSTRAINT ai_media_asset_ingest_jobs_exact_render_fk
  FOREIGN KEY(owner_user_id,workspace_id,render_job_id)
  REFERENCES public.ai_media_render_jobs(owner_user_id,workspace_id,id)
  ON UPDATE NO ACTION ON DELETE RESTRICT NOT VALID;
ALTER TABLE public.ai_media_asset_ingest_jobs VALIDATE CONSTRAINT ai_media_asset_ingest_jobs_exact_render_fk;

CREATE FUNCTION ai_media_worker_api.guard_terminal_check_v1() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $guard$
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'terminal check evidence cannot be deleted'; END IF;
  IF ROW(NEW.id,NEW.owner_user_id,NEW.workspace_id,NEW.submission_attempt_id,NEW.budget_reservation_id,
      NEW.render_job_id,NEW.dispatch_outbox_id,NEW.daily_plan_slot_id,NEW.provider_account_id,NEW.provider_key,
      NEW.provider_credential_version,NEW.provider_job_id,NEW.send_authorization_digest,NEW.actor_user_id,NEW.created_at)
    IS DISTINCT FROM ROW(OLD.id,OLD.owner_user_id,OLD.workspace_id,OLD.submission_attempt_id,OLD.budget_reservation_id,
      OLD.render_job_id,OLD.dispatch_outbox_id,OLD.daily_plan_slot_id,OLD.provider_account_id,OLD.provider_key,
      OLD.provider_credential_version,OLD.provider_job_id,OLD.send_authorization_digest,OLD.actor_user_id,OLD.created_at)
    OR OLD.state='terminal' OR (OLD.state='pending' AND NEW.state<>'leased')
    OR (OLD.state='leased' AND NEW.state NOT IN ('pending','leased','terminal'))
    OR NEW.fencing_token<OLD.fencing_token OR NEW.claim_count<OLD.claim_count THEN
    RAISE EXCEPTION 'invalid terminal check mutation';
  END IF;
  RETURN NEW;
END
$guard$;
CREATE TRIGGER ai_media_provider_terminal_checks_guard BEFORE UPDATE OR DELETE
  ON public.ai_media_provider_terminal_checks FOR EACH ROW EXECUTE FUNCTION ai_media_worker_api.guard_terminal_check_v1();

CREATE FUNCTION ai_media_worker_api.guard_terminal_event_v1() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $guard$
BEGIN RAISE EXCEPTION 'provider terminal evidence is append-only'; END
$guard$;
CREATE TRIGGER ai_media_provider_terminal_events_guard BEFORE UPDATE OR DELETE
  ON public.ai_media_provider_terminal_events FOR EACH ROW EXECUTE FUNCTION ai_media_worker_api.guard_terminal_event_v1();

CREATE FUNCTION ai_media_worker_api.require_terminal_capability_v1(
  p_capability_id uuid,p_owner_user_id text,p_workspace_id text,p_operation text,
  p_worker_id text DEFAULT NULL,p_lease_ms integer DEFAULT NULL
) RETURNS TABLE(actor_user_id text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET row_security=on AS $function$
DECLARE authority record;
BEGIN
  SELECT * INTO authority FROM ai_media_worker_api.require_capability_v1(p_capability_id,p_owner_user_id,
    p_workspace_id,'reconcile',p_operation,p_worker_id,p_lease_ms,NULL);
  IF EXISTS (SELECT 1 FROM pg_catalog.unnest(ARRAY['public.ai_media_provider_terminal_checks',
      'public.ai_media_provider_terminal_events','public.ai_media_asset_ingest_jobs']::text[]) protected(table_name)
    WHERE pg_catalog.has_table_privilege(SESSION_USER,protected.table_name,'SELECT')
      OR pg_catalog.has_table_privilege(SESSION_USER,protected.table_name,'INSERT')
      OR pg_catalog.has_table_privilege(SESSION_USER,protected.table_name,'UPDATE')
      OR pg_catalog.has_table_privilege(SESSION_USER,protected.table_name,'DELETE')
      OR pg_catalog.has_table_privilege(SESSION_USER,protected.table_name,'TRUNCATE')
      OR pg_catalog.has_table_privilege(SESSION_USER,protected.table_name,'REFERENCES')
      OR pg_catalog.has_table_privilege(SESSION_USER,protected.table_name,'TRIGGER')) THEN
    RAISE EXCEPTION 'terminal worker principal is not least privilege' USING ERRCODE='42501';
  END IF;
  RETURN QUERY SELECT authority.actor_user_id;
END
$function$;

CREATE FUNCTION ai_media_worker_api.claim_terminal_check_v1(
  p_capability_id uuid,p_owner_user_id text,p_workspace_id text,p_worker_id text,p_lease_ms integer
) RETURNS TABLE(id uuid,submission_attempt_id uuid,budget_reservation_id uuid,render_job_id uuid,
  provider_account_id uuid,provider_key text,provider_credential_version integer,provider_job_id text,
  send_authorization_digest text,lease_token uuid,submission_fencing_token bigint,
  fencing_token bigint,lease_expires_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET row_security=on AS $function$
#variable_conflict use_column
DECLARE authority record; candidate record; claimed public.ai_media_provider_terminal_checks%ROWTYPE;
  sampled_at timestamptz:=pg_catalog.clock_timestamp();new_lease uuid:=pg_catalog.gen_random_uuid();
BEGIN
  SELECT * INTO authority FROM ai_media_worker_api.require_terminal_capability_v1(p_capability_id,
    p_owner_user_id,p_workspace_id,'claim_terminal_check',p_worker_id,p_lease_ms);
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'ai-media:terminal-claim:'||p_owner_user_id||':'||p_workspace_id,0));
  SELECT a.* INTO candidate FROM public.ai_media_provider_submission_attempts a
  JOIN public.ai_media_submission_capacity_leases capacity ON capacity.submission_attempt_id=a.id
    AND capacity.owner_user_id=a.owner_user_id AND capacity.workspace_id=a.workspace_id
    AND capacity.budget_reservation_id=a.budget_reservation_id AND capacity.state='held'
  LEFT JOIN public.ai_media_provider_terminal_checks terminal_check ON terminal_check.submission_attempt_id=a.id
    AND terminal_check.owner_user_id=a.owner_user_id AND terminal_check.workspace_id=a.workspace_id
  LEFT JOIN public.ai_media_provider_terminal_events terminal_event ON terminal_event.submission_attempt_id=a.id
    AND terminal_event.owner_user_id=a.owner_user_id AND terminal_event.workspace_id=a.workspace_id
  WHERE a.owner_user_id=p_owner_user_id AND a.workspace_id=p_workspace_id AND a.state='confirmed'
    AND terminal_event.id IS NULL AND (terminal_check.id IS NULL OR (terminal_check.state='leased'
      AND terminal_check.lease_expires_at<=sampled_at) OR terminal_check.state='pending')
  ORDER BY a.confirmed_at,a.id FOR UPDATE OF a,capacity SKIP LOCKED LIMIT 1;
  IF NOT FOUND THEN RETURN; END IF;
  INSERT INTO public.ai_media_provider_terminal_checks(owner_user_id,workspace_id,submission_attempt_id,
    budget_reservation_id,render_job_id,dispatch_outbox_id,daily_plan_slot_id,provider_account_id,provider_key,
    provider_credential_version,provider_job_id,send_authorization_digest,state,fencing_token,claim_count,
    lease_token,lease_owner,lease_expires_at,actor_user_id,created_at,updated_at)
  VALUES(candidate.owner_user_id,candidate.workspace_id,candidate.id,candidate.budget_reservation_id,
    candidate.render_job_id,candidate.dispatch_outbox_id,candidate.daily_plan_slot_id,candidate.provider_account_id,
    candidate.provider_key,candidate.provider_credential_version,candidate.provider_job_id,
    candidate.send_authorization_digest,'leased',1,1,new_lease,authority.actor_user_id,
    sampled_at+(p_lease_ms::text||' milliseconds')::interval,authority.actor_user_id,sampled_at,sampled_at)
  ON CONFLICT(owner_user_id,workspace_id,submission_attempt_id) DO UPDATE SET state='leased',
    fencing_token=ai_media_provider_terminal_checks.fencing_token+1,
    claim_count=ai_media_provider_terminal_checks.claim_count+1,lease_token=EXCLUDED.lease_token,
    lease_owner=EXCLUDED.lease_owner,lease_expires_at=EXCLUDED.lease_expires_at,updated_at=EXCLUDED.updated_at
  WHERE ai_media_provider_terminal_checks.state='pending' OR
    (ai_media_provider_terminal_checks.state='leased' AND ai_media_provider_terminal_checks.lease_expires_at<=sampled_at)
  RETURNING * INTO claimed;
  IF NOT FOUND THEN RETURN; END IF;
  RETURN QUERY SELECT claimed.id,claimed.submission_attempt_id,claimed.budget_reservation_id,claimed.render_job_id,
    claimed.provider_account_id,claimed.provider_key,claimed.provider_credential_version,claimed.provider_job_id,
    claimed.send_authorization_digest,claimed.lease_token,candidate.fencing_token,
    claimed.fencing_token,claimed.lease_expires_at;
END
$function$;

CREATE FUNCTION ai_media_worker_api.release_terminal_check_unknown_v1(
  p_capability_id uuid,p_owner_user_id text,p_workspace_id text,p_terminal_check_id uuid,
  p_lease_token uuid,p_fencing_token bigint
) RETURNS TABLE(applied boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET row_security=on AS $function$
DECLARE authority record;changed uuid;
BEGIN
  SELECT * INTO authority FROM ai_media_worker_api.require_terminal_capability_v1(p_capability_id,
    p_owner_user_id,p_workspace_id,'release_terminal_check_unknown',NULL,NULL);
  UPDATE public.ai_media_provider_terminal_checks SET state='pending',lease_token=NULL,lease_owner=NULL,
    lease_expires_at=NULL,updated_at=pg_catalog.clock_timestamp()
  WHERE id=p_terminal_check_id AND owner_user_id=p_owner_user_id AND workspace_id=p_workspace_id
    AND state='leased' AND lease_token=p_lease_token AND lease_owner=authority.actor_user_id
    AND fencing_token=p_fencing_token RETURNING id INTO changed;
  RETURN QUERY SELECT changed IS NOT NULL;
END
$function$;

CREATE FUNCTION ai_media_worker_api.record_provider_terminal_v1(
  p_capability_id uuid,p_owner_user_id text,p_workspace_id text,p_terminal_check_id uuid,
  p_submission_attempt_id uuid,p_fencing_token bigint,p_lease_token uuid,p_terminal_check_fencing bigint,
  p_authorization_digest text,p_provider_account_id uuid,p_provider_key text,p_provider_credential_version integer,
  p_provider_job_id text,p_terminal_state text,p_remote_artifact_ref text,p_remote_url text,
  p_observed_at timestamptz,p_provider_evidence_digest text
) RETURNS TABLE(outcome text,terminal_event_id uuid,ingest_job_id uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET row_security=on AS $function$
DECLARE authority record;bound record;existing public.ai_media_provider_terminal_events%ROWTYPE;
  sampled_at timestamptz:=pg_catalog.clock_timestamp();bound_digest text;new_event uuid:=pg_catalog.gen_random_uuid();
  new_ingest uuid;changed uuid;
BEGIN
  SELECT * INTO authority FROM ai_media_worker_api.require_terminal_capability_v1(p_capability_id,
    p_owner_user_id,p_workspace_id,'record_provider_terminal',NULL,NULL);
  IF p_terminal_state NOT IN ('completed','failed') OR p_provider_evidence_digest !~ '^sha256:[0-9a-f]{64}$'
    OR p_authorization_digest !~ '^sha256:[0-9a-f]{64}$' OR NOT isfinite(p_observed_at)
    OR p_provider_key<>btrim(p_provider_key) OR length(p_provider_key) NOT BETWEEN 1 AND 80
    OR p_provider_job_id<>btrim(p_provider_job_id) OR length(p_provider_job_id) NOT BETWEEN 1 AND 500
    OR (p_terminal_state='completed' AND (p_remote_artifact_ref IS NULL
      OR length(btrim(p_remote_artifact_ref)) NOT BETWEEN 1 AND 1000 OR p_remote_url IS NULL
      OR length(p_remote_url) NOT BETWEEN 9 AND 8000
      OR p_remote_url !~ '^https://[^[:space:]@/]+(:[0-9]+)?/[^[:space:]#]+([?][^[:space:]#]*)?$'))
    OR (p_terminal_state='failed' AND (p_remote_artifact_ref IS NOT NULL OR p_remote_url IS NOT NULL)) THEN
    RETURN QUERY SELECT 'rejected'::text,NULL::uuid,NULL::uuid;RETURN;
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'ai-media:terminal-attempt:'||p_owner_user_id||':'||p_workspace_id||':'||p_submission_attempt_id::text,0));
  SELECT terminal_check.*,attempt.dispatch_outbox_id,attempt.daily_plan_slot_id INTO bound
  FROM public.ai_media_provider_terminal_checks terminal_check
  JOIN public.ai_media_provider_submission_attempts attempt ON attempt.id=terminal_check.submission_attempt_id
    AND attempt.owner_user_id=terminal_check.owner_user_id AND attempt.workspace_id=terminal_check.workspace_id
    AND attempt.budget_reservation_id=terminal_check.budget_reservation_id
  JOIN public.ai_media_submission_capacity_leases capacity ON capacity.submission_attempt_id=attempt.id
    AND capacity.owner_user_id=attempt.owner_user_id AND capacity.workspace_id=attempt.workspace_id
    AND capacity.budget_reservation_id=attempt.budget_reservation_id
  WHERE terminal_check.id=p_terminal_check_id AND terminal_check.owner_user_id=p_owner_user_id
    AND terminal_check.workspace_id=p_workspace_id AND terminal_check.submission_attempt_id=p_submission_attempt_id
    AND terminal_check.state='leased' AND terminal_check.lease_token=p_lease_token
    AND terminal_check.lease_owner=authority.actor_user_id
    AND terminal_check.fencing_token=p_terminal_check_fencing AND terminal_check.lease_expires_at>sampled_at
    AND attempt.state='confirmed' AND attempt.fencing_token=p_fencing_token
    AND attempt.send_authorization_digest=p_authorization_digest
    AND attempt.provider_account_id=p_provider_account_id AND attempt.provider_key=p_provider_key
    AND attempt.provider_credential_version=p_provider_credential_version AND attempt.provider_job_id=p_provider_job_id
    AND capacity.state='held' FOR UPDATE OF terminal_check,attempt,capacity;
  IF NOT FOUND THEN
    SELECT * INTO existing FROM public.ai_media_provider_terminal_events event
    WHERE event.owner_user_id=p_owner_user_id AND event.workspace_id=p_workspace_id
      AND event.submission_attempt_id=p_submission_attempt_id;
    IF FOUND AND existing.terminal_state=p_terminal_state
      AND existing.provider_account_id=p_provider_account_id AND existing.provider_key=p_provider_key
      AND existing.provider_credential_version=p_provider_credential_version
      AND existing.provider_job_id=p_provider_job_id AND existing.send_authorization_digest=p_authorization_digest
      AND existing.provider_evidence_digest=p_provider_evidence_digest
      AND existing.remote_artifact_ref IS NOT DISTINCT FROM p_remote_artifact_ref
      AND existing.remote_url IS NOT DISTINCT FROM p_remote_url THEN
      SELECT id INTO new_ingest FROM public.ai_media_asset_ingest_jobs WHERE owner_user_id=p_owner_user_id
        AND workspace_id=p_workspace_id AND render_job_id=existing.render_job_id;
      RETURN QUERY SELECT 'replayed'::text,existing.id,new_ingest;RETURN;
    END IF;
    RETURN QUERY SELECT CASE WHEN FOUND THEN 'conflict' ELSE 'rejected' END::text,NULL::uuid,NULL::uuid;RETURN;
  END IF;
  bound_digest=ai_media_worker_api.sha256_text_v1('provider-terminal:v1:'||p_owner_user_id||':'||p_workspace_id||':'||
    p_submission_attempt_id::text||':'||p_authorization_digest||':'||p_provider_account_id::text||':'||p_provider_key||':'||
    p_provider_credential_version::text||':'||p_provider_job_id||':'||p_terminal_state||':'||
    COALESCE(p_remote_artifact_ref,'')||':'||p_provider_evidence_digest);
  INSERT INTO public.ai_media_provider_terminal_events(id,owner_user_id,workspace_id,terminal_check_id,
    submission_attempt_id,budget_reservation_id,render_job_id,dispatch_outbox_id,daily_plan_slot_id,
    provider_account_id,provider_key,provider_credential_version,provider_job_id,send_authorization_digest,
    terminal_state,remote_artifact_ref,remote_url,expected_mime_type,provider_evidence_digest,
    bound_evidence_digest,observed_at,actor_user_id,created_at)
  VALUES(new_event,p_owner_user_id,p_workspace_id,p_terminal_check_id,p_submission_attempt_id,
    bound.budget_reservation_id,bound.render_job_id,bound.dispatch_outbox_id,bound.daily_plan_slot_id,
    p_provider_account_id,p_provider_key,p_provider_credential_version,p_provider_job_id,p_authorization_digest,
    p_terminal_state,p_remote_artifact_ref,p_remote_url,CASE WHEN p_terminal_state='completed' THEN 'video/mp4' END,
    p_provider_evidence_digest,bound_digest,p_observed_at,authority.actor_user_id,sampled_at);
  UPDATE public.ai_media_submission_capacity_leases SET state='released',state_version=state_version+1,
    released_at=sampled_at,release_kind='provider_terminal',release_evidence_digest=bound_digest,updated_at=sampled_at
  WHERE owner_user_id=p_owner_user_id AND workspace_id=p_workspace_id
    AND budget_reservation_id=bound.budget_reservation_id AND submission_attempt_id=p_submission_attempt_id
    AND provider_account_id=p_provider_account_id AND provider_key=p_provider_key AND state='held'
  RETURNING id INTO changed;
  IF changed IS NULL THEN RAISE EXCEPTION 'terminal capacity release must affect exactly one row'; END IF;
  IF p_terminal_state='completed' THEN
    new_ingest=pg_catalog.gen_random_uuid();
    INSERT INTO public.ai_media_asset_ingest_jobs(id,owner_user_id,workspace_id,render_job_id,provider_key,
      remote_artifact_ref,remote_url,expected_mime_type,state,attempts,max_attempts,lease_recoveries,
      max_lease_recoveries,available_at,fencing_token,created_at,updated_at)
    VALUES(new_ingest,p_owner_user_id,p_workspace_id,bound.render_job_id,p_provider_key,p_remote_artifact_ref,
      p_remote_url,'video/mp4','queued',0,3,0,3,sampled_at,0,sampled_at,sampled_at);
  END IF;
  UPDATE public.ai_media_provider_terminal_checks SET state='terminal',lease_token=NULL,lease_owner=NULL,
    lease_expires_at=NULL,updated_at=sampled_at WHERE id=p_terminal_check_id RETURNING id INTO changed;
  IF changed IS NULL THEN RAISE EXCEPTION 'terminal check CAS failed'; END IF;
  UPDATE public.ai_media_render_jobs SET provider_terminal_state=p_terminal_state,
    provider_terminal_evidence_digest=bound_digest,provider_terminal_observed_at=p_observed_at,updated_at=sampled_at
  WHERE id=bound.render_job_id AND owner_user_id=p_owner_user_id AND workspace_id=p_workspace_id
    AND provider_account_id=p_provider_account_id AND provider_key=p_provider_key
    AND provider_credential_version=p_provider_credential_version AND provider_job_id=p_provider_job_id
    AND stage='submitted' AND provider_terminal_state IS NULL RETURNING id INTO changed;
  IF changed IS NULL THEN RAISE EXCEPTION 'terminal render CAS failed'; END IF;
  UPDATE public.ai_media_outbox SET provider_terminal_state=p_terminal_state,
    provider_terminal_evidence_digest=bound_digest,provider_terminal_observed_at=p_observed_at,updated_at=sampled_at
  WHERE id=bound.dispatch_outbox_id AND owner_user_id=p_owner_user_id AND workspace_id=p_workspace_id
    AND status='dispatched' AND provider_terminal_state IS NULL RETURNING id INTO changed;
  IF changed IS NULL THEN RAISE EXCEPTION 'terminal outbox CAS failed'; END IF;
  UPDATE public.ai_media_daily_plan_slots SET provider_terminal_state=p_terminal_state,
    provider_terminal_evidence_digest=bound_digest,provider_terminal_observed_at=p_observed_at,
    state_version=state_version+1,updated_at=sampled_at
  WHERE id=bound.daily_plan_slot_id AND owner_user_id=p_owner_user_id AND workspace_id=p_workspace_id
    AND provider_account_id=p_provider_account_id AND provider_key=p_provider_key
    AND provider_credential_version=p_provider_credential_version AND status='submitted'
    AND provider_terminal_state IS NULL RETURNING id INTO changed;
  IF changed IS NULL THEN RAISE EXCEPTION 'terminal slot CAS failed'; END IF;
  RETURN QUERY SELECT 'applied'::text,new_event,new_ingest;
END
$function$;

GRANT SELECT,INSERT,UPDATE ON TABLE public.ai_media_provider_terminal_checks TO ai_media_admitted_fn_owner;
GRANT SELECT,INSERT ON TABLE public.ai_media_provider_terminal_events TO ai_media_admitted_fn_owner;
GRANT SELECT,INSERT ON TABLE public.ai_media_asset_ingest_jobs TO ai_media_admitted_fn_owner;
REVOKE ALL ON TABLE public.ai_media_provider_terminal_checks,public.ai_media_provider_terminal_events,
  public.ai_media_asset_ingest_jobs FROM PUBLIC,ai_media_admitted_submit_executor,ai_media_admitted_reconcile_executor;
ALTER FUNCTION ai_media_worker_api.guard_terminal_check_v1() OWNER TO ai_media_admitted_fn_owner;
ALTER FUNCTION ai_media_worker_api.guard_terminal_event_v1() OWNER TO ai_media_admitted_fn_owner;
ALTER FUNCTION ai_media_worker_api.require_terminal_capability_v1(uuid,text,text,text,text,integer) OWNER TO ai_media_admitted_fn_owner;
ALTER FUNCTION ai_media_worker_api.claim_terminal_check_v1(uuid,text,text,text,integer) OWNER TO ai_media_admitted_fn_owner;
ALTER FUNCTION ai_media_worker_api.release_terminal_check_unknown_v1(uuid,text,text,uuid,uuid,bigint) OWNER TO ai_media_admitted_fn_owner;
ALTER FUNCTION ai_media_worker_api.record_provider_terminal_v1(uuid,text,text,uuid,uuid,bigint,uuid,bigint,text,uuid,text,integer,text,text,text,text,timestamptz,text) OWNER TO ai_media_admitted_fn_owner;
REVOKE ALL ON FUNCTION ai_media_worker_api.require_terminal_capability_v1(uuid,text,text,text,text,integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION ai_media_worker_api.guard_terminal_check_v1(),ai_media_worker_api.guard_terminal_event_v1() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION
  ai_media_worker_api.claim_terminal_check_v1(uuid,text,text,text,integer),
  ai_media_worker_api.release_terminal_check_unknown_v1(uuid,text,text,uuid,uuid,bigint),
  ai_media_worker_api.record_provider_terminal_v1(uuid,text,text,uuid,uuid,bigint,uuid,bigint,text,uuid,text,integer,text,text,text,text,timestamptz,text)
TO ai_media_admitted_reconcile_executor;
COMMIT;
