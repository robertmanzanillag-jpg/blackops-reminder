-- AI Media Studio PR26: least-privilege admitted-worker database capability API.
-- Reviewed, unapplied migration. It performs no provider call and no deployment.
-- Cluster roles are deployment prerequisites and are intentionally never created here.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='15min';
SET LOCAL search_path=pg_catalog;

DO $preflight$
DECLARE role_name text; role_row record;
BEGIN
  IF current_setting('server_version_num')::integer<160000
    OR to_regclass('public.ai_media_provider_submission_attempts') IS NULL
    OR to_regclass('public.ai_media_admitted_worker_capabilities') IS NOT NULL
    OR to_regclass('public.ai_media_submission_capacity_leases') IS NOT NULL
    OR to_regnamespace('ai_media_worker_api') IS NOT NULL
    OR to_regprocedure('public.digest(bytea,text)') IS NULL
    OR NOT EXISTS (
      SELECT 1 FROM pg_catalog.pg_depend dependency
      JOIN pg_catalog.pg_extension extension_row ON extension_row.oid=dependency.refobjid
      WHERE dependency.classid='pg_catalog.pg_proc'::regclass
        AND dependency.objid=to_regprocedure('public.digest(bytea,text)')
        AND dependency.refclassid='pg_catalog.pg_extension'::regclass
        AND dependency.deptype='e' AND extension_row.extname='pgcrypto'
    ) THEN
    RAISE EXCEPTION 'PR26 requires PostgreSQL 16, public pgcrypto.digest, exact PR25, and an unused PR26 surface';
  END IF;
  FOREACH role_name IN ARRAY ARRAY[
    'ai_media_admitted_fn_owner','ai_media_admitted_submit_executor','ai_media_admitted_reconcile_executor'
  ] LOOP
    SELECT * INTO role_row FROM pg_catalog.pg_roles WHERE rolname=role_name;
    IF NOT FOUND OR role_row.rolcanlogin OR role_row.rolsuper OR role_row.rolinherit
      OR role_row.rolcreaterole OR role_row.rolcreatedb OR role_row.rolreplication OR role_row.rolbypassrls THEN
      RAISE EXCEPTION 'PR26 requires safe precreated NOLOGIN NOINHERIT role %',role_name;
    END IF;
  END LOOP;
  IF pg_catalog.pg_has_role('ai_media_admitted_submit_executor','ai_media_admitted_fn_owner','MEMBER')
    OR pg_catalog.pg_has_role('ai_media_admitted_reconcile_executor','ai_media_admitted_fn_owner','MEMBER')
    OR pg_catalog.pg_has_role('ai_media_admitted_submit_executor','ai_media_admitted_reconcile_executor','MEMBER')
    OR pg_catalog.pg_has_role('ai_media_admitted_reconcile_executor','ai_media_admitted_submit_executor','MEMBER') THEN
    RAISE EXCEPTION 'PR26 executor roles must have no owner or cross-lane membership';
  END IF;
END
$preflight$;

REVOKE CREATE ON SCHEMA public FROM PUBLIC;
CREATE SCHEMA ai_media_worker_api AUTHORIZATION ai_media_admitted_fn_owner;
REVOKE ALL ON SCHEMA ai_media_worker_api FROM PUBLIC;

CREATE TABLE public.ai_media_admitted_worker_capabilities (
  id uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  database_principal name NOT NULL,
  owner_user_id text NOT NULL,
  workspace_id text NOT NULL,
  lane text NOT NULL,
  accounting_time_zone text NOT NULL,
  worker_id text NOT NULL,
  allowed_operations text[] NOT NULL,
  max_lease_ms integer NOT NULL,
  max_batch_size integer NOT NULL,
  valid_from timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  evidence_digest text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT pg_catalog.transaction_timestamp(),
  CONSTRAINT ai_media_admitted_worker_capabilities_ck CHECK (
    lane IN ('submit','reconcile')
    AND length(btrim(owner_user_id)) BETWEEN 1 AND 200
    AND length(btrim(workspace_id)) BETWEEN 1 AND 200
    AND length(btrim(accounting_time_zone)) BETWEEN 1 AND 100
    AND length(btrim(worker_id)) BETWEEN 1 AND 120
    AND cardinality(allowed_operations)>0
    AND allowed_operations <@ ARRAY['claim','authorize','expire_authorized','record_submit_confirmed',
      'record_submit_ambiguous','claim_reconciliation','release_reconciliation_unknown',
      'record_reconciled_confirmed','finalize_reconciled_no_submit','release_terminal_capacity']::text[]
    AND max_lease_ms BETWEEN 1 AND 300000 AND max_batch_size BETWEEN 1 AND 100
    AND expires_at>valid_from AND isfinite(valid_from) AND isfinite(expires_at)
    AND (revoked_at IS NULL OR isfinite(revoked_at))
    AND evidence_digest ~ '^sha256:[0-9a-f]{64}$' AND isfinite(created_at)
  ),
  CONSTRAINT ai_media_admitted_worker_capabilities_lane_ops_ck CHECK (
    (lane='submit' AND allowed_operations <@ ARRAY['claim','authorize','expire_authorized',
      'record_submit_confirmed','record_submit_ambiguous']::text[])
    OR (lane='reconcile' AND allowed_operations <@ ARRAY['claim_reconciliation',
      'release_reconciliation_unknown','record_reconciled_confirmed',
      'finalize_reconciled_no_submit','release_terminal_capacity']::text[])
  )
);
CREATE UNIQUE INDEX ai_media_admitted_worker_capabilities_principal_scope_lane_uq
  ON public.ai_media_admitted_worker_capabilities(database_principal,owner_user_id,workspace_id,lane,id);

CREATE TABLE public.ai_media_submission_capacity_leases (
  id uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  owner_user_id text NOT NULL,
  workspace_id text NOT NULL,
  budget_reservation_id uuid NOT NULL,
  provider_account_id uuid NOT NULL,
  provider_key text NOT NULL,
  submission_attempt_id uuid NOT NULL,
  state text NOT NULL,
  state_version bigint NOT NULL DEFAULT 1,
  held_at timestamptz NOT NULL,
  released_at timestamptz,
  release_kind text,
  release_evidence_digest text,
  actor_user_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT pg_catalog.transaction_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT pg_catalog.transaction_timestamp(),
  CONSTRAINT ai_media_submission_capacity_leases_ck CHECK (
    state IN ('held','released') AND state_version>=1
    AND length(btrim(provider_key)) BETWEEN 1 AND 80
    AND length(btrim(actor_user_id)) BETWEEN 1 AND 200
    AND isfinite(held_at) AND isfinite(created_at) AND isfinite(updated_at)
    AND ((state='held' AND released_at IS NULL AND release_kind IS NULL AND release_evidence_digest IS NULL)
      OR (state='released' AND isfinite(released_at) AND release_kind IN ('reconciled_no_submit','provider_terminal')
        AND release_evidence_digest ~ '^sha256:[0-9a-f]{64}$'))),
  CONSTRAINT ai_media_submission_capacity_leases_attempt_fk FOREIGN KEY
    (owner_user_id,workspace_id,submission_attempt_id,budget_reservation_id)
    REFERENCES public.ai_media_provider_submission_attempts(owner_user_id,workspace_id,id,budget_reservation_id)
    ON UPDATE NO ACTION ON DELETE RESTRICT
);
CREATE UNIQUE INDEX ai_media_submission_capacity_leases_reservation_uq
  ON public.ai_media_submission_capacity_leases(owner_user_id,workspace_id,budget_reservation_id);
CREATE INDEX ai_media_submission_capacity_leases_active_scope_idx
  ON public.ai_media_submission_capacity_leases(state,provider_key,owner_user_id,workspace_id);

CREATE FUNCTION ai_media_worker_api.guard_capability_v1() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $guard$
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'worker capability evidence cannot be deleted'; END IF;
  IF ROW(NEW.id,NEW.database_principal,NEW.owner_user_id,NEW.workspace_id,NEW.lane,
      NEW.accounting_time_zone,NEW.worker_id,NEW.allowed_operations,NEW.max_lease_ms,
      NEW.max_batch_size,NEW.valid_from,NEW.expires_at,NEW.evidence_digest,NEW.created_at)
    IS DISTINCT FROM ROW(OLD.id,OLD.database_principal,OLD.owner_user_id,OLD.workspace_id,OLD.lane,
      OLD.accounting_time_zone,OLD.worker_id,OLD.allowed_operations,OLD.max_lease_ms,
      OLD.max_batch_size,OLD.valid_from,OLD.expires_at,OLD.evidence_digest,OLD.created_at)
    OR OLD.revoked_at IS NOT NULL OR NEW.revoked_at IS NULL THEN
    RAISE EXCEPTION 'worker capability is immutable except one-way revocation';
  END IF;
  RETURN NEW;
END
$guard$;
CREATE TRIGGER ai_media_admitted_worker_capabilities_guard
  BEFORE UPDATE OR DELETE ON public.ai_media_admitted_worker_capabilities
  FOR EACH ROW EXECUTE FUNCTION ai_media_worker_api.guard_capability_v1();

CREATE FUNCTION ai_media_worker_api.guard_capacity_lease_v1() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $guard$
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'capacity evidence cannot be deleted'; END IF;
  IF ROW(NEW.id,NEW.owner_user_id,NEW.workspace_id,NEW.budget_reservation_id,
      NEW.provider_account_id,NEW.provider_key,NEW.submission_attempt_id,NEW.held_at,
      NEW.actor_user_id,NEW.created_at)
    IS DISTINCT FROM ROW(OLD.id,OLD.owner_user_id,OLD.workspace_id,OLD.budget_reservation_id,
      OLD.provider_account_id,OLD.provider_key,OLD.submission_attempt_id,OLD.held_at,
      OLD.actor_user_id,OLD.created_at) THEN RAISE EXCEPTION 'capacity identity is immutable'; END IF;
  IF OLD.state='released' OR NEW.state<>'released' OR NEW.state_version<>OLD.state_version+1
    OR NEW.released_at IS NULL OR NEW.release_kind IS NULL OR NEW.release_evidence_digest IS NULL THEN
    RAISE EXCEPTION 'capacity can only release exactly once';
  END IF;
  RETURN NEW;
END
$guard$;
CREATE TRIGGER ai_media_submission_capacity_leases_guard
  BEFORE UPDATE OR DELETE ON public.ai_media_submission_capacity_leases
  FOR EACH ROW EXECUTE FUNCTION ai_media_worker_api.guard_capacity_lease_v1();

CREATE FUNCTION ai_media_worker_api.require_capability_v1(
  p_capability_id uuid,p_owner_user_id text,p_workspace_id text,p_lane text,
  p_operation text,p_worker_id text DEFAULT NULL,p_lease_ms integer DEFAULT NULL,p_batch_size integer DEFAULT NULL
) RETURNS TABLE(accounting_time_zone text,actor_user_id text,max_lease_ms integer,max_batch_size integer)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET row_security=on AS $function$
DECLARE cap public.ai_media_admitted_worker_capabilities%ROWTYPE; sampled_at timestamptz:=pg_catalog.clock_timestamp();
BEGIN
  IF pg_catalog.pg_has_role(SESSION_USER,'ai_media_admitted_fn_owner','MEMBER')
    OR EXISTS (SELECT 1 FROM pg_catalog.pg_roles role_row WHERE role_row.rolname=SESSION_USER
      AND (role_row.rolsuper OR role_row.rolcreaterole OR role_row.rolcreatedb
        OR role_row.rolreplication OR role_row.rolbypassrls))
    OR EXISTS (
      SELECT 1 FROM pg_catalog.unnest(ARRAY[
        'public.ai_media_admitted_worker_capabilities','public.ai_media_provider_submission_attempts',
        'public.ai_media_provider_submission_events','public.ai_media_submission_capacity_leases',
        'public.ai_media_budget_reservations','public.ai_media_budget_buckets','public.ai_media_render_jobs',
        'public.ai_media_outbox','public.ai_media_daily_plan_slots','public.ai_media_daily_plans',
        'public.ai_media_work_activations','public.ai_media_launch_authority_snapshots',
        'public.ai_media_launch_evidence','public.ai_media_launch_intents','public.ai_media_admission_policy_revisions',
        'public.ai_media_kill_switch_revisions','public.ai_media_provider_accounts',
        'public.ai_media_provider_resources','public.ai_media_governance_profiles','public.ai_media_influencers',
        'public.ai_media_script_variants','public.ai_media_scripts','public.ai_media_source_items'
      ]::text[]) AS protected(protected_table)
      WHERE pg_catalog.has_table_privilege(SESSION_USER,protected_table,'SELECT')
        OR pg_catalog.has_table_privilege(SESSION_USER,protected_table,'INSERT')
        OR pg_catalog.has_table_privilege(SESSION_USER,protected_table,'UPDATE')
        OR pg_catalog.has_table_privilege(SESSION_USER,protected_table,'DELETE')
        OR pg_catalog.has_table_privilege(SESSION_USER,protected_table,'TRUNCATE')
        OR pg_catalog.has_table_privilege(SESSION_USER,protected_table,'REFERENCES')
        OR pg_catalog.has_table_privilege(SESSION_USER,protected_table,'TRIGGER')
    ) THEN RAISE EXCEPTION 'admitted worker principal is not least privilege' USING ERRCODE='42501'; END IF;
  SELECT * INTO cap FROM public.ai_media_admitted_worker_capabilities c
  WHERE c.id=p_capability_id AND c.database_principal=SESSION_USER::name
    AND c.owner_user_id=p_owner_user_id AND c.workspace_id=p_workspace_id AND c.lane=p_lane
    AND p_operation=ANY(c.allowed_operations) AND c.revoked_at IS NULL
    AND c.valid_from<=sampled_at AND c.expires_at>sampled_at
  FOR UPDATE;
  IF NOT FOUND OR (p_worker_id IS NOT NULL AND cap.worker_id<>p_worker_id)
    OR (p_lease_ms IS NOT NULL AND (p_lease_ms<1 OR p_lease_ms>cap.max_lease_ms))
    OR (p_batch_size IS NOT NULL AND (p_batch_size<1 OR p_batch_size>cap.max_batch_size)) THEN
    RAISE EXCEPTION 'admitted database capability denied' USING ERRCODE='42501';
  END IF;
  RETURN QUERY SELECT cap.accounting_time_zone,
    (cap.database_principal::text||':'||cap.worker_id)::text,cap.max_lease_ms,cap.max_batch_size;
END
$function$;

CREATE FUNCTION ai_media_worker_api.sha256_text_v1(p_value text) RETURNS text
LANGUAGE sql IMMUTABLE STRICT SECURITY DEFINER SET search_path=pg_catalog AS $function$
  SELECT 'sha256:'||pg_catalog.encode(public.digest(pg_catalog.convert_to(p_value,'UTF8'),'sha256'),'hex')
$function$;

CREATE FUNCTION ai_media_worker_api.finish_outcome_v1(
  p_owner_user_id text,p_workspace_id text,p_attempt_id uuid,p_budget_reservation_id uuid,
  p_fencing_token bigint,p_authorization_digest text,p_submission_lease_token uuid,
  p_reconciliation_lease_token uuid,p_reconciliation_fencing_token bigint,
  p_new_state text,p_provider_job_id text,p_provider_request_id text,p_evidence_digest text,
  p_actor_user_id text
) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET row_security=on AS $function$
DECLARE current_row record; attempt record; sampled_at timestamptz:=pg_catalog.clock_timestamp();
  changed_id uuid; capacity_id uuid; next_sequence integer;
BEGIN
  IF p_new_state NOT IN ('confirmed','ambiguous','reconciled_no_submit')
    OR p_evidence_digest !~ '^sha256:[0-9a-f]{64}$'
    OR (p_provider_job_id IS NOT NULL AND (p_provider_job_id<>btrim(p_provider_job_id)
      OR length(p_provider_job_id) NOT BETWEEN 1 AND 500))
    OR (p_provider_request_id IS NOT NULL AND (p_provider_request_id<>btrim(p_provider_request_id)
      OR length(p_provider_request_id) NOT BETWEEN 1 AND 500)) THEN RETURN false; END IF;
  SET CONSTRAINTS ALL DEFERRED;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'ai-media:admitted-reservation:'||p_owner_user_id||':'||p_workspace_id||':'||p_budget_reservation_id::text,0));
  SELECT a.*,r.amount_micro_usd,r.budget_bucket_id INTO current_row
  FROM public.ai_media_provider_submission_attempts a
  JOIN public.ai_media_budget_reservations r ON r.id=a.budget_reservation_id
    AND r.owner_user_id=a.owner_user_id AND r.workspace_id=a.workspace_id
  WHERE a.id=p_attempt_id AND a.owner_user_id=p_owner_user_id AND a.workspace_id=p_workspace_id
    AND a.budget_reservation_id=p_budget_reservation_id
    AND a.send_authorization_digest=p_authorization_digest AND a.fencing_token=p_fencing_token
    AND ((p_new_state='ambiguous' AND a.state='authorized'
        AND a.lease_token=p_submission_lease_token AND a.lease_owner=p_actor_user_id)
      OR (p_new_state='confirmed' AND a.state='authorized'
        AND a.lease_token=p_submission_lease_token AND a.lease_owner=p_actor_user_id)
      OR (p_new_state IN ('confirmed','reconciled_no_submit') AND a.state='ambiguous'
        AND a.reconciliation_lease_token=p_reconciliation_lease_token
        AND a.reconciliation_lease_owner=p_actor_user_id
        AND a.reconciliation_fencing_token=p_reconciliation_fencing_token))
  FOR UPDATE OF a,r;
  IF NOT FOUND THEN RETURN false; END IF;
  IF p_new_state='confirmed' AND p_provider_job_id IS NULL THEN RETURN false; END IF;
  IF p_new_state<>'confirmed' AND p_provider_job_id IS NOT NULL THEN RETURN false; END IF;
  IF p_new_state='confirmed' THEN
    UPDATE public.ai_media_provider_submission_attempts SET state='confirmed',
      confirmed_evidence_digest=p_evidence_digest,confirmed_at=sampled_at,
      provider_job_id=p_provider_job_id,provider_request_id=p_provider_request_id,
      lease_token=NULL,lease_owner=NULL,lease_expires_at=NULL,
      reconciliation_lease_token=NULL,reconciliation_lease_owner=NULL,reconciliation_lease_expires_at=NULL,
      updated_at=sampled_at WHERE id=p_attempt_id AND fencing_token=p_fencing_token RETURNING * INTO attempt;
  ELSIF p_new_state='ambiguous' THEN
    UPDATE public.ai_media_provider_submission_attempts SET state='ambiguous',
      ambiguity_evidence_digest=p_evidence_digest,ambiguous_at=sampled_at,
      provider_request_id=p_provider_request_id,lease_token=NULL,lease_owner=NULL,lease_expires_at=NULL,
      updated_at=sampled_at WHERE id=p_attempt_id AND fencing_token=p_fencing_token RETURNING * INTO attempt;
  ELSE
    UPDATE public.ai_media_provider_submission_attempts SET state='reconciled_no_submit',
      reconciliation_evidence_digest=p_evidence_digest,reconciled_at=sampled_at,
      lease_token=NULL,lease_owner=NULL,lease_expires_at=NULL,
      reconciliation_lease_token=NULL,reconciliation_lease_owner=NULL,reconciliation_lease_expires_at=NULL,
      updated_at=sampled_at WHERE id=p_attempt_id AND fencing_token=p_fencing_token RETURNING * INTO attempt;
  END IF;
  IF NOT FOUND THEN RETURN false; END IF;
  SELECT COALESCE(pg_catalog.max(e.sequence),0)+1 INTO next_sequence
  FROM public.ai_media_provider_submission_events e WHERE e.submission_attempt_id=p_attempt_id;
  INSERT INTO public.ai_media_provider_submission_events(owner_user_id,workspace_id,submission_attempt_id,
    budget_reservation_id,sequence,event_kind,fencing_token,reconciliation_fencing_token,evidence_digest,
    provider_job_id,provider_request_id,actor_user_id,observed_at,created_at)
  VALUES(p_owner_user_id,p_workspace_id,p_attempt_id,p_budget_reservation_id,next_sequence,p_new_state,
    p_fencing_token,CASE WHEN p_new_state='reconciled_no_submit' THEN p_reconciliation_fencing_token ELSE NULL END,
    p_evidence_digest,p_provider_job_id,p_provider_request_id,p_actor_user_id,sampled_at,sampled_at);
  IF p_new_state='reconciled_no_submit' THEN
    UPDATE public.ai_media_submission_capacity_leases SET state='released',state_version=state_version+1,
      released_at=sampled_at,release_kind='reconciled_no_submit',release_evidence_digest=p_evidence_digest,
      updated_at=sampled_at WHERE owner_user_id=p_owner_user_id AND workspace_id=p_workspace_id
      AND budget_reservation_id=p_budget_reservation_id AND submission_attempt_id=p_attempt_id AND state='held'
      RETURNING id INTO capacity_id;
    IF capacity_id IS NULL THEN RAISE EXCEPTION 'no-submit capacity release must affect exactly one row'; END IF;
    UPDATE public.ai_media_budget_buckets SET committed_micro_usd=committed_micro_usd-current_row.amount_micro_usd,
      state_version=state_version+1,updated_at=sampled_at
    WHERE id=current_row.budget_bucket_id AND owner_user_id=p_owner_user_id AND workspace_id=p_workspace_id
      AND committed_micro_usd>=current_row.amount_micro_usd RETURNING id INTO changed_id;
    IF changed_id IS NULL THEN RAISE EXCEPTION 'no-submit budget refund must affect exactly one row'; END IF;
  END IF;
  changed_id=NULL;
  UPDATE public.ai_media_budget_reservations SET
    state=CASE WHEN p_new_state='reconciled_no_submit' THEN 'released' ELSE 'committed' END,
    submission_state=p_new_state,
    reconciliation_evidence_digest=CASE WHEN p_new_state='reconciled_no_submit' THEN p_evidence_digest ELSE NULL END,
    released_at=CASE WHEN p_new_state='reconciled_no_submit' THEN sampled_at ELSE NULL END,updated_at=sampled_at
  WHERE id=p_budget_reservation_id AND owner_user_id=p_owner_user_id AND workspace_id=p_workspace_id
    AND state='committed' AND submission_state IN ('dispatching','ambiguous') RETURNING id INTO changed_id;
  IF changed_id IS NULL THEN RAISE EXCEPTION 'provider outcome reservation CAS failed'; END IF;
  changed_id=NULL;
  UPDATE public.ai_media_render_jobs SET
    stage=CASE p_new_state WHEN 'confirmed' THEN 'submitted' WHEN 'ambiguous' THEN 'reconciling' ELSE 'failed' END,
    provider_job_id=p_provider_job_id,lease_owner=NULL,lease_token=NULL,lease_expires_at=NULL,updated_at=sampled_at
  WHERE id=current_row.render_job_id AND owner_user_id=p_owner_user_id AND workspace_id=p_workspace_id
    AND lease_fencing=p_fencing_token AND stage IN ('leased','reconciling') RETURNING id INTO changed_id;
  IF changed_id IS NULL THEN RAISE EXCEPTION 'provider outcome render CAS failed'; END IF;
  changed_id=NULL;
  UPDATE public.ai_media_outbox SET
    status=CASE p_new_state WHEN 'confirmed' THEN 'dispatched' WHEN 'ambiguous' THEN 'reconciling' ELSE 'dead_letter' END,
    processed_at=CASE WHEN p_new_state='confirmed' THEN sampled_at ELSE NULL END,
    dead_letter_at=CASE WHEN p_new_state='reconciled_no_submit' THEN sampled_at ELSE NULL END,
    locked_at=NULL,lease_owner=NULL,lease_expires_at=NULL,updated_at=sampled_at
  WHERE id=current_row.dispatch_outbox_id AND owner_user_id=p_owner_user_id AND workspace_id=p_workspace_id
    AND fencing_token=p_fencing_token AND status IN ('leased','reconciling') RETURNING id INTO changed_id;
  IF changed_id IS NULL THEN RAISE EXCEPTION 'provider outcome outbox CAS failed'; END IF;
  changed_id=NULL;
  UPDATE public.ai_media_daily_plan_slots SET
    status=CASE p_new_state WHEN 'confirmed' THEN 'submitted' WHEN 'ambiguous' THEN 'reconciling' ELSE 'released' END,
    state_version=state_version+1,updated_at=sampled_at
  WHERE id=current_row.daily_plan_slot_id AND owner_user_id=p_owner_user_id AND workspace_id=p_workspace_id
    AND status IN ('committed','reconciling') RETURNING id INTO changed_id;
  IF changed_id IS NULL THEN RAISE EXCEPTION 'provider outcome slot CAS failed'; END IF;
  RETURN true;
END
$function$;

CREATE FUNCTION ai_media_worker_api.record_submit_confirmed_v1(
  p_capability_id uuid,p_owner_user_id text,p_workspace_id text,p_attempt_id uuid,
  p_budget_reservation_id uuid,p_fencing_token bigint,p_authorization_digest text,
  p_submission_lease_token uuid,p_provider_job_id text,p_provider_request_id text,p_evidence_digest text
) RETURNS TABLE(applied boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET row_security=on AS $function$
DECLARE authority record;
BEGIN
  SELECT * INTO authority FROM ai_media_worker_api.require_capability_v1(p_capability_id,p_owner_user_id,
    p_workspace_id,'submit','record_submit_confirmed',NULL,NULL,NULL);
  RETURN QUERY SELECT ai_media_worker_api.finish_outcome_v1(p_owner_user_id,p_workspace_id,p_attempt_id,
    p_budget_reservation_id,p_fencing_token,p_authorization_digest,p_submission_lease_token,NULL,NULL,
    'confirmed',p_provider_job_id,p_provider_request_id,p_evidence_digest,authority.actor_user_id);
END
$function$;

CREATE FUNCTION ai_media_worker_api.record_submit_ambiguous_v1(
  p_capability_id uuid,p_owner_user_id text,p_workspace_id text,p_attempt_id uuid,
  p_budget_reservation_id uuid,p_fencing_token bigint,p_authorization_digest text,
  p_submission_lease_token uuid,p_provider_request_id text,p_evidence_digest text
) RETURNS TABLE(applied boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET row_security=on AS $function$
DECLARE authority record;
BEGIN
  SELECT * INTO authority FROM ai_media_worker_api.require_capability_v1(p_capability_id,p_owner_user_id,
    p_workspace_id,'submit','record_submit_ambiguous',NULL,NULL,NULL);
  RETURN QUERY SELECT ai_media_worker_api.finish_outcome_v1(p_owner_user_id,p_workspace_id,p_attempt_id,
    p_budget_reservation_id,p_fencing_token,p_authorization_digest,p_submission_lease_token,NULL,NULL,
    'ambiguous',NULL,p_provider_request_id,p_evidence_digest,authority.actor_user_id);
END
$function$;

CREATE FUNCTION ai_media_worker_api.expire_authorized_v1(
  p_capability_id uuid,p_owner_user_id text,p_workspace_id text,p_limit integer
) RETURNS TABLE(transitioned_count integer)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET row_security=on AS $function$
DECLARE authority record; due record; transitioned integer:=0; applied boolean; evidence text;
BEGIN
  SELECT * INTO authority FROM ai_media_worker_api.require_capability_v1(p_capability_id,p_owner_user_id,
    p_workspace_id,'submit','expire_authorized',NULL,NULL,p_limit);
  FOR due IN SELECT a.* FROM public.ai_media_provider_submission_attempts a
    WHERE a.owner_user_id=p_owner_user_id AND a.workspace_id=p_workspace_id AND a.state='authorized'
      AND a.lease_expires_at<=pg_catalog.clock_timestamp()
    ORDER BY a.lease_expires_at,a.id FOR UPDATE SKIP LOCKED LIMIT p_limit
  LOOP
    evidence=ai_media_worker_api.sha256_text_v1('authorized-lease-expired:v1:'||due.id::text||':'||
      due.fencing_token::text||':'||due.send_authorization_digest);
    SELECT ai_media_worker_api.finish_outcome_v1(p_owner_user_id,p_workspace_id,due.id,
      due.budget_reservation_id,due.fencing_token,due.send_authorization_digest,due.lease_token,NULL,NULL,
      'ambiguous',NULL,NULL,evidence,due.lease_owner) INTO applied;
    IF applied THEN transitioned=transitioned+1; END IF;
  END LOOP;
  RETURN QUERY SELECT transitioned;
END
$function$;

CREATE FUNCTION ai_media_worker_api.claim_reconciliation_v1(
  p_capability_id uuid,p_owner_user_id text,p_workspace_id text,p_worker_id text,p_lease_ms integer
) RETURNS TABLE(
  id uuid,owner_user_id text,workspace_id text,budget_reservation_id uuid,render_job_id uuid,
  provider_account_id uuid,provider_key text,provider_credential_version integer,
  provider_idempotency_key text,avatar_external_resource_id text,voice_external_resource_id text,
  sealed_request_digest text,fencing_token bigint,send_authorization_digest text,commit_evidence_digest text,
  authorized_at timestamptz,reconciliation_lease_token uuid,reconciliation_lease_owner text,
  reconciliation_fencing_token bigint,request_json jsonb
) LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET row_security=on AS $function$
DECLARE authority record; attempt record; new_lease uuid:=pg_catalog.gen_random_uuid();
  sampled_at timestamptz:=pg_catalog.clock_timestamp(); evidence text; next_sequence integer;
BEGIN
  SELECT * INTO authority FROM ai_media_worker_api.require_capability_v1(p_capability_id,p_owner_user_id,
    p_workspace_id,'reconcile','claim_reconciliation',p_worker_id,p_lease_ms,NULL);
  SET CONSTRAINTS ALL DEFERRED;
  WITH candidate AS (
    SELECT a.id FROM public.ai_media_provider_submission_attempts a
    WHERE a.owner_user_id=p_owner_user_id AND a.workspace_id=p_workspace_id AND a.state='ambiguous'
      AND (a.reconciliation_lease_token IS NULL OR a.reconciliation_lease_expires_at<=sampled_at)
    ORDER BY a.ambiguous_at,a.id FOR UPDATE SKIP LOCKED LIMIT 1
  ) UPDATE public.ai_media_provider_submission_attempts a SET reconciliation_lease_token=new_lease,
    reconciliation_lease_owner=authority.actor_user_id,
    reconciliation_lease_expires_at=sampled_at+(p_lease_ms::text||' milliseconds')::interval,
    reconciliation_fencing_token=a.reconciliation_fencing_token+1,updated_at=sampled_at
  FROM candidate WHERE a.id=candidate.id RETURNING a.* INTO attempt;
  IF NOT FOUND THEN RETURN; END IF;
  evidence=ai_media_worker_api.sha256_text_v1('reconciliation-claimed:v1:'||attempt.id::text||':'||
    attempt.reconciliation_fencing_token::text||':'||new_lease::text);
  SELECT COALESCE(pg_catalog.max(e.sequence),0)+1 INTO next_sequence
  FROM public.ai_media_provider_submission_events e WHERE e.submission_attempt_id=attempt.id;
  INSERT INTO public.ai_media_provider_submission_events(owner_user_id,workspace_id,submission_attempt_id,
    budget_reservation_id,sequence,event_kind,fencing_token,reconciliation_fencing_token,evidence_digest,
    actor_user_id,observed_at,created_at)
  VALUES(attempt.owner_user_id,attempt.workspace_id,attempt.id,attempt.budget_reservation_id,next_sequence,
    'reconciliation_claimed',attempt.fencing_token,attempt.reconciliation_fencing_token,evidence,
    authority.actor_user_id,sampled_at,sampled_at);
  RETURN QUERY SELECT attempt.id,attempt.owner_user_id,attempt.workspace_id,attempt.budget_reservation_id,
    attempt.render_job_id,attempt.provider_account_id,attempt.provider_key,attempt.provider_credential_version,
    attempt.provider_idempotency_key,attempt.avatar_external_resource_id,attempt.voice_external_resource_id,
    attempt.sealed_request_digest,attempt.fencing_token,attempt.send_authorization_digest,
    attempt.commit_evidence_digest,attempt.authorized_at,attempt.reconciliation_lease_token,
    attempt.reconciliation_lease_owner,attempt.reconciliation_fencing_token,job.request
  FROM public.ai_media_render_jobs job WHERE job.id=attempt.render_job_id
    AND job.owner_user_id=p_owner_user_id AND job.workspace_id=p_workspace_id;
END
$function$;

CREATE FUNCTION ai_media_worker_api.release_reconciliation_unknown_v1(
  p_capability_id uuid,p_owner_user_id text,p_workspace_id text,p_attempt_id uuid,
  p_budget_reservation_id uuid,p_fencing_token bigint,p_authorization_digest text,
  p_reconciliation_lease_token uuid,p_reconciliation_fencing_token bigint
) RETURNS TABLE(applied boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET row_security=on AS $function$
DECLARE authority record; attempt record; sampled_at timestamptz:=pg_catalog.clock_timestamp();
  evidence text; next_sequence integer;
BEGIN
  SELECT * INTO authority FROM ai_media_worker_api.require_capability_v1(p_capability_id,p_owner_user_id,
    p_workspace_id,'reconcile','release_reconciliation_unknown',NULL,NULL,NULL);
  UPDATE public.ai_media_provider_submission_attempts SET reconciliation_lease_token=NULL,
    reconciliation_lease_owner=NULL,reconciliation_lease_expires_at=NULL,updated_at=sampled_at
  WHERE id=p_attempt_id AND owner_user_id=p_owner_user_id AND workspace_id=p_workspace_id
    AND budget_reservation_id=p_budget_reservation_id AND state='ambiguous'
    AND fencing_token=p_fencing_token AND send_authorization_digest=p_authorization_digest
    AND reconciliation_lease_token=p_reconciliation_lease_token
    AND reconciliation_lease_owner=authority.actor_user_id
    AND reconciliation_fencing_token=p_reconciliation_fencing_token RETURNING * INTO attempt;
  IF NOT FOUND THEN RETURN QUERY SELECT false; RETURN; END IF;
  evidence=ai_media_worker_api.sha256_text_v1('reconciliation-released:v1:'||p_attempt_id::text||':'||
    p_authorization_digest||':'||p_reconciliation_fencing_token::text||':'||authority.actor_user_id);
  SELECT COALESCE(pg_catalog.max(e.sequence),0)+1 INTO next_sequence
  FROM public.ai_media_provider_submission_events e WHERE e.submission_attempt_id=p_attempt_id;
  INSERT INTO public.ai_media_provider_submission_events(owner_user_id,workspace_id,submission_attempt_id,
    budget_reservation_id,sequence,event_kind,fencing_token,reconciliation_fencing_token,evidence_digest,
    actor_user_id,observed_at,created_at)
  VALUES(p_owner_user_id,p_workspace_id,p_attempt_id,p_budget_reservation_id,next_sequence,
    'reconciliation_released',p_fencing_token,p_reconciliation_fencing_token,evidence,
    authority.actor_user_id,sampled_at,sampled_at);
  RETURN QUERY SELECT true;
END
$function$;

CREATE FUNCTION ai_media_worker_api.record_reconciled_confirmed_v1(
  p_capability_id uuid,p_owner_user_id text,p_workspace_id text,p_attempt_id uuid,
  p_budget_reservation_id uuid,p_fencing_token bigint,p_authorization_digest text,
  p_reconciliation_lease_token uuid,p_reconciliation_fencing_token bigint,
  p_provider_job_id text,p_provider_request_id text,p_evidence_digest text
) RETURNS TABLE(applied boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET row_security=on AS $function$
DECLARE authority record;
BEGIN
  SELECT * INTO authority FROM ai_media_worker_api.require_capability_v1(p_capability_id,p_owner_user_id,
    p_workspace_id,'reconcile','record_reconciled_confirmed',NULL,NULL,NULL);
  RETURN QUERY SELECT ai_media_worker_api.finish_outcome_v1(p_owner_user_id,p_workspace_id,p_attempt_id,
    p_budget_reservation_id,p_fencing_token,p_authorization_digest,NULL,p_reconciliation_lease_token,
    p_reconciliation_fencing_token,'confirmed',p_provider_job_id,p_provider_request_id,p_evidence_digest,
    authority.actor_user_id);
END
$function$;

CREATE FUNCTION ai_media_worker_api.finalize_reconciled_no_submit_v1(
  p_capability_id uuid,p_owner_user_id text,p_workspace_id text,p_attempt_id uuid,
  p_budget_reservation_id uuid,p_fencing_token bigint,p_authorization_digest text,
  p_reconciliation_lease_token uuid,p_reconciliation_fencing_token bigint,p_guarantee text,
  p_provider_account_id uuid,p_provider_key text,p_provider_credential_version integer,
  p_provider_idempotency_key text,p_finality_observed_at timestamptz,p_provider_evidence_digest text
) RETURNS TABLE(applied boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET row_security=on AS $function$
DECLARE authority record; attempt record; bound_evidence text;
BEGIN
  SELECT * INTO authority FROM ai_media_worker_api.require_capability_v1(p_capability_id,p_owner_user_id,
    p_workspace_id,'reconcile','finalize_reconciled_no_submit',NULL,NULL,NULL);
  SELECT * INTO attempt FROM public.ai_media_provider_submission_attempts a
  WHERE a.id=p_attempt_id AND a.owner_user_id=p_owner_user_id AND a.workspace_id=p_workspace_id
    AND a.budget_reservation_id=p_budget_reservation_id AND a.fencing_token=p_fencing_token
    AND a.send_authorization_digest=p_authorization_digest AND a.state='ambiguous'
    AND a.reconciliation_lease_token=p_reconciliation_lease_token
    AND a.reconciliation_lease_owner=authority.actor_user_id
    AND a.reconciliation_fencing_token=p_reconciliation_fencing_token FOR UPDATE;
  IF NOT FOUND OR p_guarantee<>'linearizable_not_accepted_and_cannot_later_accept'
    OR attempt.provider_account_id<>p_provider_account_id OR attempt.provider_key<>p_provider_key
    OR attempt.provider_credential_version<>p_provider_credential_version
    OR attempt.provider_idempotency_key<>p_provider_idempotency_key
    OR p_provider_evidence_digest !~ '^sha256:[0-9a-f]{64}$' OR NOT isfinite(p_finality_observed_at) THEN
    RETURN QUERY SELECT false; RETURN;
  END IF;
  bound_evidence=ai_media_worker_api.sha256_text_v1('linearizable-definitive-no-submit:v1:'||p_attempt_id::text||':'||
    p_authorization_digest||':'||p_provider_account_id::text||':'||p_provider_key||':'||
    p_provider_credential_version::text||':'||p_provider_idempotency_key||':'||
    p_reconciliation_fencing_token::text||':'||p_finality_observed_at::text||':'||p_provider_evidence_digest);
  RETURN QUERY SELECT ai_media_worker_api.finish_outcome_v1(p_owner_user_id,p_workspace_id,p_attempt_id,
    p_budget_reservation_id,p_fencing_token,p_authorization_digest,NULL,p_reconciliation_lease_token,
    p_reconciliation_fencing_token,'reconciled_no_submit',NULL,NULL,bound_evidence,authority.actor_user_id);
END
$function$;

CREATE FUNCTION ai_media_worker_api.release_terminal_capacity_v1(
  p_capability_id uuid,p_owner_user_id text,p_workspace_id text,p_attempt_id uuid,
  p_budget_reservation_id uuid,p_provider_job_id text,p_terminal_state text,p_terminal_evidence_digest text
) RETURNS TABLE(applied boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET row_security=on AS $function$
DECLARE authority record; capacity_id uuid; sampled_at timestamptz:=pg_catalog.clock_timestamp();
BEGIN
  SELECT * INTO authority FROM ai_media_worker_api.require_capability_v1(p_capability_id,p_owner_user_id,
    p_workspace_id,'reconcile','release_terminal_capacity',NULL,NULL,NULL);
  IF p_terminal_state NOT IN ('completed','failed') OR p_terminal_evidence_digest !~ '^sha256:[0-9a-f]{64}$'
    OR p_provider_job_id<>btrim(p_provider_job_id) OR length(p_provider_job_id) NOT BETWEEN 1 AND 500 THEN
    RETURN QUERY SELECT false; RETURN;
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'ai-media:admitted-reservation:'||p_owner_user_id||':'||p_workspace_id||':'||p_budget_reservation_id::text,0));
  PERFORM 1 FROM public.ai_media_provider_submission_attempts a
  WHERE a.id=p_attempt_id AND a.owner_user_id=p_owner_user_id AND a.workspace_id=p_workspace_id
    AND a.budget_reservation_id=p_budget_reservation_id AND a.state='confirmed'
    AND a.provider_job_id=p_provider_job_id FOR UPDATE;
  IF NOT FOUND THEN RETURN QUERY SELECT false; RETURN; END IF;
  UPDATE public.ai_media_submission_capacity_leases SET state='released',state_version=state_version+1,
    released_at=sampled_at,release_kind='provider_terminal',
    release_evidence_digest=ai_media_worker_api.sha256_text_v1('provider-terminal:v1:'||p_attempt_id::text||':'||
      p_provider_job_id||':'||p_terminal_state||':'||p_terminal_evidence_digest),updated_at=sampled_at
  WHERE owner_user_id=p_owner_user_id AND workspace_id=p_workspace_id
    AND budget_reservation_id=p_budget_reservation_id AND submission_attempt_id=p_attempt_id AND state='held'
  RETURNING id INTO capacity_id;
  RETURN QUERY SELECT capacity_id IS NOT NULL;
END
$function$;

CREATE FUNCTION ai_media_worker_api.authorize_admitted_v1(
  p_capability_id uuid,p_owner_user_id text,p_workspace_id text,p_attempt_id uuid,
  p_budget_reservation_id uuid,p_fencing_token bigint,p_lease_token uuid,p_sealed_request_digest text
) RETURNS TABLE(
  id uuid,owner_user_id text,workspace_id text,budget_reservation_id uuid,render_job_id uuid,
  provider_account_id uuid,provider_key text,provider_credential_version integer,
  provider_idempotency_key text,avatar_external_resource_id text,voice_external_resource_id text,
  sealed_request_digest text,fencing_token bigint,lease_token uuid,lease_expires_at timestamptz,
  send_authorization_digest text,commit_evidence_digest text,authorized_at timestamptz,request_json jsonb
) LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET row_security=on AS $function$
DECLARE authority record; subject uuid; source_binding record; gate record; authorized_attempt record;
  sampled_at timestamptz:=pg_catalog.clock_timestamp(); commit_digest text; authorization_digest text;
  active_total bigint; active_provider bigint; active_tenant bigint; changed_id uuid;
BEGIN
  SELECT * INTO authority FROM ai_media_worker_api.require_capability_v1(p_capability_id,p_owner_user_id,
    p_workspace_id,'submit','authorize',NULL,NULL,NULL);
  SET CONSTRAINTS ALL DEFERRED;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'ai-media:admitted-reservation:'||p_owner_user_id||':'||p_workspace_id||':'||p_budget_reservation_id::text,0));
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('ai-media:daily-admission:global-concurrency',0));
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'ai-media:daily-admission:workspace:'||p_owner_user_id||':'||p_workspace_id,0));
  SELECT job.influencer_id INTO subject FROM public.ai_media_render_jobs job
  WHERE job.id=(SELECT a.render_job_id FROM public.ai_media_provider_submission_attempts a
    WHERE a.id=p_attempt_id AND a.owner_user_id=p_owner_user_id AND a.workspace_id=p_workspace_id
      AND a.budget_reservation_id=p_budget_reservation_id)
    AND job.owner_user_id=p_owner_user_id AND job.workspace_id=p_workspace_id FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'ai-media-governance:profile:'||p_owner_user_id||':'||p_workspace_id||':'||subject::text,0));
  SELECT intent.source_type,intent.source_item_id,intent.source_content_hash INTO source_binding
  FROM public.ai_media_provider_submission_attempts attempt
  JOIN public.ai_media_launch_intents intent ON intent.id=attempt.launch_intent_id
    AND intent.owner_user_id=attempt.owner_user_id AND intent.workspace_id=attempt.workspace_id
    AND intent.launch_intent_digest=attempt.launch_intent_digest
  WHERE attempt.id=p_attempt_id AND attempt.owner_user_id=p_owner_user_id
    AND attempt.workspace_id=p_workspace_id AND attempt.budget_reservation_id=p_budget_reservation_id
  FOR UPDATE OF intent;
  IF NOT FOUND THEN RETURN; END IF;
  IF source_binding.source_type='manual' THEN
    IF source_binding.source_item_id IS NOT NULL OR source_binding.source_content_hash IS NOT NULL THEN RETURN; END IF;
  ELSE
    PERFORM 1 FROM public.ai_media_source_items source WHERE source.id=source_binding.source_item_id
      AND source.owner_user_id=p_owner_user_id AND source.workspace_id=p_workspace_id
      AND source.source_type=source_binding.source_type AND source.content_hash=source_binding.source_content_hash
      AND source.status IN ('accepted','ready') AND source.moderation_status='approved'
      AND source.rights_status IN ('owned','licensed') FOR UPDATE;
    IF NOT FOUND THEN RETURN; END IF;
  END IF;

  SELECT attempt.*,reservation.budget_bucket_id,reservation.amount_micro_usd,
    job.request request_json,job.script_variant_id,job.source_item_id,job.source_content_hash,
    job.avatar_resource_id,job.voice_resource_id,variant.content script_content,variant.checksum script_checksum,
    avatar.external_resource_id current_avatar_external_resource_id,
    voice.external_resource_id current_voice_external_resource_id,policy.total_concurrency,
    policy.provider_concurrency,policy.tenant_concurrency
  INTO gate
  FROM public.ai_media_provider_submission_attempts attempt
  JOIN public.ai_media_budget_reservations reservation ON reservation.id=attempt.budget_reservation_id
    AND reservation.owner_user_id=attempt.owner_user_id AND reservation.workspace_id=attempt.workspace_id
    AND reservation.render_job_id=attempt.render_job_id AND reservation.dispatch_outbox_id=attempt.dispatch_outbox_id
    AND reservation.daily_plan_slot_id=attempt.daily_plan_slot_id AND reservation.attempt=attempt.slot_attempt
    AND reservation.provider_account_id=attempt.provider_account_id AND reservation.provider_key=attempt.provider_key
    AND reservation.provider_credential_version=attempt.provider_credential_version
    AND reservation.provider_idempotency_key=attempt.provider_idempotency_key
    AND reservation.script_variant_checksum=attempt.script_variant_checksum
    AND reservation.authority_snapshot_id=attempt.authority_snapshot_id
    AND reservation.authority_digest=attempt.authority_digest AND reservation.admission_digest=attempt.admission_digest
    AND reservation.work_handoff_digest=attempt.work_handoff_digest
  JOIN public.ai_media_budget_buckets bucket ON bucket.id=reservation.budget_bucket_id
    AND bucket.owner_user_id=reservation.owner_user_id AND bucket.workspace_id=reservation.workspace_id
  JOIN public.ai_media_render_jobs job ON job.id=attempt.render_job_id
    AND job.owner_user_id=attempt.owner_user_id AND job.workspace_id=attempt.workspace_id
    AND job.budget_reservation_id=reservation.id AND job.daily_plan_slot_id=attempt.daily_plan_slot_id
    AND job.slot_attempt=attempt.slot_attempt AND job.provider_account_id=attempt.provider_account_id
    AND job.provider_key=attempt.provider_key AND job.provider_credential_version=attempt.provider_credential_version
    AND job.idempotency_key=attempt.provider_idempotency_key
    AND job.script_variant_checksum=attempt.script_variant_checksum
    AND job.authority_snapshot_id=attempt.authority_snapshot_id AND job.authority_digest=attempt.authority_digest
    AND job.launch_intent_id=attempt.launch_intent_id AND job.launch_intent_digest=attempt.launch_intent_digest
    AND job.admission_digest=attempt.admission_digest AND job.work_handoff_digest=attempt.work_handoff_digest
    AND job.sealed_request_digest=attempt.sealed_request_digest
  JOIN public.ai_media_outbox outbox ON outbox.id=attempt.dispatch_outbox_id
    AND outbox.owner_user_id=attempt.owner_user_id AND outbox.workspace_id=attempt.workspace_id
    AND outbox.budget_reservation_id=reservation.id AND outbox.render_job_id=job.id
    AND outbox.work_handoff_digest=attempt.work_handoff_digest AND outbox.sealed_request_digest=attempt.sealed_request_digest
  JOIN public.ai_media_daily_plan_slots slot ON slot.id=attempt.daily_plan_slot_id
    AND slot.owner_user_id=attempt.owner_user_id AND slot.workspace_id=attempt.workspace_id
    AND slot.provider_account_id=attempt.provider_account_id AND slot.provider_key=attempt.provider_key
    AND slot.provider_credential_version=attempt.provider_credential_version
    AND slot.script_variant_id=job.script_variant_id AND slot.influencer_id=job.influencer_id
    AND slot.avatar_resource_id=job.avatar_resource_id AND slot.voice_resource_id=job.voice_resource_id
  JOIN public.ai_media_work_activations activation ON activation.id=attempt.work_activation_id
    AND activation.owner_user_id=attempt.owner_user_id AND activation.workspace_id=attempt.workspace_id
    AND activation.budget_reservation_id=reservation.id AND activation.render_job_id=job.id
    AND activation.dispatch_outbox_id=outbox.id AND activation.daily_plan_slot_id=slot.id
    AND activation.slot_attempt=attempt.slot_attempt AND activation.provider_account_id=attempt.provider_account_id
    AND activation.provider_key=attempt.provider_key AND activation.provider_credential_version=attempt.provider_credential_version
    AND activation.provider_idempotency_key=attempt.provider_idempotency_key
    AND activation.script_variant_checksum=attempt.script_variant_checksum
    AND activation.authority_snapshot_id=attempt.authority_snapshot_id
    AND activation.authority_digest=attempt.authority_digest AND activation.launch_intent_id=attempt.launch_intent_id
    AND activation.launch_intent_digest=attempt.launch_intent_digest AND activation.admission_digest=attempt.admission_digest
    AND activation.work_handoff_digest=attempt.work_handoff_digest AND activation.sealed_request_digest=attempt.sealed_request_digest
  JOIN public.ai_media_launch_authority_snapshots snapshot ON snapshot.id=reservation.authority_snapshot_id
    AND snapshot.owner_user_id=reservation.owner_user_id AND snapshot.workspace_id=reservation.workspace_id
    AND snapshot.authority_digest=reservation.authority_digest AND snapshot.daily_plan_slot_id=attempt.daily_plan_slot_id
    AND snapshot.slot_attempt=attempt.slot_attempt AND snapshot.admission_digest=attempt.admission_digest
    AND snapshot.provider_account_id=attempt.provider_account_id AND snapshot.provider_key=attempt.provider_key
    AND snapshot.provider_credential_version=attempt.provider_credential_version
    AND snapshot.script_variant_checksum=attempt.script_variant_checksum
    AND snapshot.launch_intent_id=attempt.launch_intent_id AND snapshot.launch_intent_digest=attempt.launch_intent_digest
  JOIN public.ai_media_launch_intents intent ON intent.id=snapshot.launch_intent_id
    AND intent.owner_user_id=snapshot.owner_user_id AND intent.workspace_id=snapshot.workspace_id
    AND intent.launch_intent_digest=snapshot.launch_intent_digest AND intent.daily_plan_id=snapshot.daily_plan_id
    AND intent.daily_plan_slot_id=snapshot.daily_plan_slot_id AND intent.slot_attempt=snapshot.slot_attempt
    AND intent.provider_account_id=snapshot.provider_account_id AND intent.provider_key=snapshot.provider_key
    AND intent.provider_credential_version=snapshot.provider_credential_version
    AND intent.script_variant_id=snapshot.script_variant_id AND intent.script_variant_checksum=snapshot.script_variant_checksum
    AND intent.governance_profile_id=snapshot.governance_profile_id
    AND intent.governance_evidence_digest=snapshot.governance_evidence_digest
    AND intent.launch_subject_digest=snapshot.launch_subject_digest
  JOIN public.ai_media_launch_evidence content ON content.id=snapshot.content_approval_evidence_id
    AND content.owner_user_id=snapshot.owner_user_id AND content.workspace_id=snapshot.workspace_id
    AND content.evidence_digest=snapshot.content_approval_evidence_digest
    AND content.launch_intent_id=intent.id AND content.launch_intent_digest=intent.launch_intent_digest
  JOIN public.ai_media_launch_evidence human ON human.id=snapshot.human_launch_approval_evidence_id
    AND human.owner_user_id=snapshot.owner_user_id AND human.workspace_id=snapshot.workspace_id
    AND human.evidence_digest=snapshot.human_launch_approval_evidence_digest
    AND human.launch_intent_id=intent.id AND human.launch_intent_digest=intent.launch_intent_digest
  JOIN public.ai_media_launch_evidence sandbox ON sandbox.id=snapshot.sandbox_evidence_id
    AND sandbox.owner_user_id=snapshot.owner_user_id AND sandbox.workspace_id=snapshot.workspace_id
    AND sandbox.evidence_digest=snapshot.sandbox_evidence_digest
    AND sandbox.launch_intent_id=intent.id AND sandbox.launch_intent_digest=intent.launch_intent_digest
  JOIN public.ai_media_launch_evidence quote ON quote.id=snapshot.maximum_quote_evidence_id
    AND quote.owner_user_id=snapshot.owner_user_id AND quote.workspace_id=snapshot.workspace_id
    AND quote.evidence_digest=snapshot.maximum_quote_evidence_digest
    AND quote.launch_intent_id=intent.id AND quote.launch_intent_digest=intent.launch_intent_digest
  JOIN public.ai_media_admission_policy_revisions policy ON policy.id=snapshot.policy_revision_id
    AND policy.owner_user_id=snapshot.owner_user_id AND policy.workspace_id=snapshot.workspace_id
    AND policy.revision=snapshot.policy_revision AND policy.policy_digest=snapshot.policy_digest
  JOIN public.ai_media_kill_switch_revisions kill ON kill.id=snapshot.kill_switch_revision_id
    AND kill.owner_user_id=snapshot.owner_user_id AND kill.workspace_id=snapshot.workspace_id
    AND kill.revision=snapshot.kill_switch_revision AND kill.evidence_digest=snapshot.kill_switch_evidence_digest
  JOIN public.ai_media_daily_plans plan ON plan.id=snapshot.daily_plan_id
    AND plan.owner_user_id=snapshot.owner_user_id AND plan.workspace_id=snapshot.workspace_id
    AND plan.plan_digest=snapshot.plan_digest
  JOIN public.ai_media_provider_accounts account ON account.id=attempt.provider_account_id
    AND account.owner_user_id=attempt.owner_user_id AND account.workspace_id=attempt.workspace_id
  JOIN public.ai_media_governance_profiles governance ON governance.id=snapshot.governance_profile_id
    AND governance.owner_user_id=snapshot.owner_user_id AND governance.workspace_id=snapshot.workspace_id
    AND governance.influencer_id=slot.influencer_id AND governance.avatar_resource_id=job.avatar_resource_id
    AND governance.voice_resource_id=job.voice_resource_id AND governance.evidence_digest=snapshot.governance_evidence_digest
  JOIN public.ai_media_influencers influencer ON influencer.id=job.influencer_id
    AND influencer.owner_user_id=job.owner_user_id AND influencer.workspace_id=job.workspace_id
  JOIN public.ai_media_provider_resources avatar ON avatar.id=job.avatar_resource_id
    AND avatar.owner_user_id=job.owner_user_id AND avatar.workspace_id=job.workspace_id
  JOIN public.ai_media_provider_resources voice ON voice.id=job.voice_resource_id
    AND voice.owner_user_id=job.owner_user_id AND voice.workspace_id=job.workspace_id
  JOIN public.ai_media_script_variants variant ON variant.id=job.script_variant_id
    AND variant.owner_user_id=job.owner_user_id AND variant.workspace_id=job.workspace_id
    AND variant.id=snapshot.script_variant_id AND variant.checksum=snapshot.script_variant_checksum
  JOIN public.ai_media_scripts script ON script.id=variant.script_id
    AND script.owner_user_id=variant.owner_user_id AND script.workspace_id=variant.workspace_id
    AND script.id=intent.script_id AND script.influencer_id=slot.influencer_id AND script.influencer_id=job.influencer_id
  LEFT JOIN public.ai_media_source_items source ON source.id=intent.source_item_id
    AND source.owner_user_id=intent.owner_user_id AND source.workspace_id=intent.workspace_id
    AND source.content_hash=intent.source_content_hash
  WHERE attempt.id=p_attempt_id AND attempt.owner_user_id=p_owner_user_id
    AND attempt.workspace_id=p_workspace_id AND attempt.budget_reservation_id=p_budget_reservation_id
    AND attempt.state='claimed' AND attempt.fencing_token=p_fencing_token AND attempt.lease_token=p_lease_token
    AND attempt.lease_owner=authority.actor_user_id AND attempt.lease_expires_at>sampled_at
    AND attempt.sealed_request_digest=p_sealed_request_digest
    AND reservation.state='reserved' AND reservation.submission_state='not_started'
    AND reservation.expires_at>sampled_at AND reservation.quote_expires_at>sampled_at
    AND job.stage='leased' AND job.attempts=0 AND job.lease_token=attempt.lease_token
    AND job.lease_fencing=attempt.fencing_token AND outbox.status='leased'
    AND outbox.fencing_token=attempt.fencing_token AND outbox.attempts>=1 AND slot.status='queued'
    AND activation.activation_digest IS NOT NULL AND activation.activated_at IS NOT NULL
    AND job.source_item_id IS NOT DISTINCT FROM intent.source_item_id
    AND job.source_content_hash IS NOT DISTINCT FROM intent.source_content_hash
    AND slot.daily_plan_id=snapshot.daily_plan_id AND slot.slot_digest=snapshot.slot_digest
    AND snapshot.valid_from<=sampled_at AND snapshot.expires_at>sampled_at
    AND plan.status IN ('planned','active')
    AND plan.plan_date=(sampled_at AT TIME ZONE authority.accounting_time_zone)::date
    AND plan.accounting_time_zone=authority.accounting_time_zone
    AND content.evidence_kind='content_approval' AND content.decision='approved'
    AND human.evidence_kind='human_launch_approval' AND human.decision='approved'
    AND sandbox.evidence_kind='sandbox_proof' AND sandbox.decision='passed'
    AND quote.evidence_kind='maximum_quote' AND quote.decision='quoted'
    AND content.valid_from<=sampled_at AND content.expires_at>sampled_at
    AND human.valid_from<=sampled_at AND human.expires_at>sampled_at
    AND sandbox.valid_from<=sampled_at AND sandbox.expires_at>sampled_at
    AND quote.valid_from<=sampled_at AND quote.expires_at>sampled_at
    AND reservation.content_approval_digest=content.evidence_digest
    AND reservation.human_launch_approval_digest=human.evidence_digest
    AND reservation.sandbox_evidence_digest=sandbox.evidence_digest
    AND reservation.quote_digest=quote.evidence_digest AND reservation.currency='USD'
    AND quote.currency='USD' AND snapshot.currency='USD'
    AND snapshot.maximum_quote_micro_usd=quote.amount_micro_usd
    AND account.provider_key=attempt.provider_key AND account.credential_version=attempt.provider_credential_version
    AND account.status IN ('active','connected') AND account.credential_status='active'
    AND (account.credential_expires_at IS NULL OR account.credential_expires_at>sampled_at)
    AND avatar.provider_account_id=attempt.provider_account_id AND avatar.provider_key=attempt.provider_key
    AND avatar.resource_type='avatar' AND avatar.status='active'
    AND voice.provider_account_id=attempt.provider_account_id AND voice.provider_key=attempt.provider_key
    AND voice.resource_type='voice' AND voice.status='active'
    AND avatar.external_resource_id=attempt.avatar_external_resource_id
    AND voice.external_resource_id=attempt.voice_external_resource_id
    AND influencer.status='active' AND influencer.archived_at IS NULL
    AND governance.state='active' AND governance.revoked_at IS NULL
    AND governance.valid_from<=sampled_at AND governance.expires_at>sampled_at
    AND variant.status='approved' AND variant.checksum=attempt.script_variant_checksum
    AND script.status='approved' AND script.archived_at IS NULL AND script.current_variant_id=variant.id
    AND quote.amount_micro_usd=reservation.amount_micro_usd
    AND policy.state='active' AND policy.valid_from<=sampled_at
    AND (policy.expires_at IS NULL OR policy.expires_at>sampled_at)
    AND reservation.policy_digest=policy.policy_digest
    AND policy.allowed_time_zones @> pg_catalog.jsonb_build_array(authority.accounting_time_zone)
    AND policy.allowed_countries @> pg_catalog.jsonb_build_array(snapshot.content_country)
    AND policy.allowed_languages @> pg_catalog.jsonb_build_array(script.language)
    AND kill.active=false AND kill.valid_from<=sampled_at
    AND (kill.expires_at IS NULL OR kill.expires_at>sampled_at)
    AND reservation.kill_switch_evidence_digest=kill.evidence_digest
    AND governance.allowed_uses @> pg_catalog.jsonb_build_array(snapshot.governance_use)
    AND (governance.territories @> pg_catalog.jsonb_build_array(snapshot.governance_territory)
      OR governance.territories @> '["WORLDWIDE"]'::jsonb)
    AND bucket.budget_date=(sampled_at AT TIME ZONE authority.accounting_time_zone)::date
    AND bucket.accounting_time_zone=authority.accounting_time_zone
    AND bucket.currency=reservation.currency AND bucket.policy_digest=policy.policy_digest
    AND bucket.policy_version=policy.revision AND bucket.limit_micro_usd=policy.daily_budget_micro_usd
    AND bucket.reserved_micro_usd>=reservation.amount_micro_usd
    AND bucket.reserved_micro_usd+bucket.committed_micro_usd<=bucket.limit_micro_usd
    AND NOT EXISTS(SELECT 1 FROM public.ai_media_launch_evidence newer
      WHERE newer.owner_user_id=content.owner_user_id AND newer.workspace_id=content.workspace_id
        AND newer.daily_plan_slot_id=content.daily_plan_slot_id AND newer.slot_attempt=content.slot_attempt
        AND newer.evidence_kind=content.evidence_kind AND newer.revision>content.revision)
    AND NOT EXISTS(SELECT 1 FROM public.ai_media_launch_evidence newer
      WHERE newer.owner_user_id=human.owner_user_id AND newer.workspace_id=human.workspace_id
        AND newer.daily_plan_slot_id=human.daily_plan_slot_id AND newer.slot_attempt=human.slot_attempt
        AND newer.evidence_kind=human.evidence_kind AND newer.revision>human.revision)
    AND NOT EXISTS(SELECT 1 FROM public.ai_media_launch_evidence newer
      WHERE newer.owner_user_id=sandbox.owner_user_id AND newer.workspace_id=sandbox.workspace_id
        AND newer.daily_plan_slot_id=sandbox.daily_plan_slot_id AND newer.slot_attempt=sandbox.slot_attempt
        AND newer.evidence_kind=sandbox.evidence_kind AND newer.revision>sandbox.revision)
    AND NOT EXISTS(SELECT 1 FROM public.ai_media_launch_evidence newer
      WHERE newer.owner_user_id=quote.owner_user_id AND newer.workspace_id=quote.workspace_id
        AND newer.daily_plan_slot_id=quote.daily_plan_slot_id AND newer.slot_attempt=quote.slot_attempt
        AND newer.evidence_kind=quote.evidence_kind AND newer.revision>quote.revision)
    AND NOT EXISTS(SELECT 1 FROM public.ai_media_admission_policy_revisions newer
      WHERE newer.owner_user_id=policy.owner_user_id AND newer.workspace_id=policy.workspace_id AND newer.revision>policy.revision)
    AND NOT EXISTS(SELECT 1 FROM public.ai_media_kill_switch_revisions newer
      WHERE newer.owner_user_id=kill.owner_user_id AND newer.workspace_id=kill.workspace_id AND newer.revision>kill.revision)
    AND NOT EXISTS(SELECT 1 FROM public.ai_media_governance_profiles newer
      WHERE newer.owner_user_id=governance.owner_user_id AND newer.workspace_id=governance.workspace_id
        AND newer.influencer_id=governance.influencer_id AND newer.version>governance.version)
    AND ((intent.source_type='manual' AND intent.source_item_id IS NULL AND intent.source_content_hash IS NULL)
      OR (intent.source_type<>'manual' AND source.id IS NOT NULL AND source.status IN ('accepted','ready')
        AND source.moderation_status='approved' AND source.rights_status IN ('owned','licensed')))
  FOR UPDATE OF attempt,reservation,bucket,job,outbox,slot,activation,snapshot,intent,content,human,
    sandbox,quote,policy,kill,plan,account,governance,influencer,avatar,voice,variant,script;
  IF NOT FOUND THEN RETURN; END IF;
  IF pg_catalog.encode(public.digest(pg_catalog.convert_to(gate.script_content,'UTF8'),'sha256'),'hex')
      IS DISTINCT FROM gate.script_checksum
    OR gate.script_checksum IS DISTINCT FROM gate.script_variant_checksum
    OR gate.current_avatar_external_resource_id IS DISTINCT FROM gate.avatar_external_resource_id
    OR gate.current_voice_external_resource_id IS DISTINCT FROM gate.voice_external_resource_id THEN
    RAISE EXCEPTION 'locked work no longer matches sealed provider resources or script';
  END IF;

  SELECT pg_catalog.count(*) INTO active_total FROM public.ai_media_budget_reservations active
  WHERE (active.state='reserved' AND active.expires_at>sampled_at)
    OR (active.state='committed' AND EXISTS (SELECT 1 FROM public.ai_media_submission_capacity_leases capacity
      WHERE capacity.owner_user_id=active.owner_user_id AND capacity.workspace_id=active.workspace_id
        AND capacity.budget_reservation_id=active.id AND capacity.state='held'));
  SELECT pg_catalog.count(*) INTO active_provider FROM public.ai_media_budget_reservations active
  WHERE active.provider_key=gate.provider_key AND ((active.state='reserved' AND active.expires_at>sampled_at)
    OR (active.state='committed' AND EXISTS (SELECT 1 FROM public.ai_media_submission_capacity_leases capacity
      WHERE capacity.owner_user_id=active.owner_user_id AND capacity.workspace_id=active.workspace_id
        AND capacity.budget_reservation_id=active.id AND capacity.state='held')));
  SELECT pg_catalog.count(*) INTO active_tenant FROM public.ai_media_budget_reservations active
  WHERE active.owner_user_id=p_owner_user_id AND active.workspace_id=p_workspace_id
    AND ((active.state='reserved' AND active.expires_at>sampled_at)
      OR (active.state='committed' AND EXISTS (SELECT 1 FROM public.ai_media_submission_capacity_leases capacity
        WHERE capacity.owner_user_id=active.owner_user_id AND capacity.workspace_id=active.workspace_id
          AND capacity.budget_reservation_id=active.id AND capacity.state='held')));
  IF active_total>gate.total_concurrency OR active_provider>gate.provider_concurrency
    OR active_tenant>gate.tenant_concurrency THEN RETURN; END IF;

  commit_digest=ai_media_worker_api.sha256_text_v1('commit:v1:'||p_attempt_id::text||':'||
    p_budget_reservation_id::text||':'||gate.amount_micro_usd::text||':'||p_fencing_token::text||':'||sampled_at::text);
  authorization_digest=ai_media_worker_api.sha256_text_v1('authorize:v1:'||p_attempt_id::text||':'||
    p_budget_reservation_id::text||':'||gate.provider_account_id::text||':'||gate.provider_key||':'||
    gate.provider_credential_version::text||':'||gate.provider_idempotency_key||':'||
    gate.avatar_external_resource_id||':'||gate.voice_external_resource_id||':'||gate.sealed_request_digest||':'||
    commit_digest||':'||sampled_at::text);
  UPDATE public.ai_media_provider_submission_attempts AS target SET state='authorized',commit_evidence_digest=commit_digest,
    send_authorization_digest=authorization_digest,authorized_at=sampled_at,updated_at=sampled_at
  WHERE target.id=p_attempt_id AND target.owner_user_id=p_owner_user_id
    AND target.workspace_id=p_workspace_id AND target.budget_reservation_id=p_budget_reservation_id
    AND target.state='claimed' AND target.fencing_token=p_fencing_token AND target.lease_token=p_lease_token
    AND target.lease_owner=authority.actor_user_id AND target.lease_expires_at>sampled_at
  RETURNING target.* INTO authorized_attempt;
  IF NOT FOUND THEN RETURN; END IF;
  INSERT INTO public.ai_media_provider_submission_events(owner_user_id,workspace_id,submission_attempt_id,
    budget_reservation_id,sequence,event_kind,fencing_token,evidence_digest,actor_user_id,observed_at,created_at)
  SELECT authorized_attempt.owner_user_id,authorized_attempt.workspace_id,authorized_attempt.id,
    authorized_attempt.budget_reservation_id,COALESCE(pg_catalog.max(e.sequence),0)+1,
    'authorized',authorized_attempt.fencing_token,authorization_digest,
    authority.actor_user_id,sampled_at,sampled_at FROM public.ai_media_provider_submission_events e
  WHERE e.submission_attempt_id=authorized_attempt.id;
  INSERT INTO public.ai_media_submission_capacity_leases(owner_user_id,workspace_id,budget_reservation_id,
    provider_account_id,provider_key,submission_attempt_id,state,held_at,actor_user_id,created_at,updated_at)
  VALUES(p_owner_user_id,p_workspace_id,p_budget_reservation_id,authorized_attempt.provider_account_id,
    authorized_attempt.provider_key,p_attempt_id,'held',sampled_at,authority.actor_user_id,sampled_at,sampled_at);
  UPDATE public.ai_media_budget_buckets AS target SET reserved_micro_usd=target.reserved_micro_usd-gate.amount_micro_usd,
    committed_micro_usd=target.committed_micro_usd+gate.amount_micro_usd,state_version=target.state_version+1,updated_at=sampled_at
  WHERE target.id=gate.budget_bucket_id AND target.owner_user_id=p_owner_user_id
    AND target.workspace_id=p_workspace_id AND target.reserved_micro_usd>=gate.amount_micro_usd
    AND target.reserved_micro_usd+target.committed_micro_usd<=target.limit_micro_usd RETURNING target.id INTO changed_id;
  IF changed_id IS NULL THEN RAISE EXCEPTION 'atomic budget commit failed'; END IF;
  changed_id=NULL;
  UPDATE public.ai_media_budget_reservations AS target SET state='committed',submission_state='dispatching',
    committed_at=sampled_at,commit_evidence_digest=commit_digest,updated_at=sampled_at
  WHERE target.id=p_budget_reservation_id AND target.owner_user_id=p_owner_user_id
    AND target.workspace_id=p_workspace_id AND target.state='reserved' AND target.submission_state='not_started'
  RETURNING target.id INTO changed_id;
  IF changed_id IS NULL THEN RAISE EXCEPTION 'atomic reservation commit failed'; END IF;
  changed_id=NULL;
  UPDATE public.ai_media_render_jobs AS target SET attempts=1,updated_at=sampled_at
  WHERE target.id=gate.render_job_id AND target.owner_user_id=p_owner_user_id
    AND target.workspace_id=p_workspace_id AND target.stage='leased' AND target.attempts=0
    AND target.lease_token=p_lease_token AND target.lease_fencing=p_fencing_token RETURNING target.id INTO changed_id;
  IF changed_id IS NULL THEN RAISE EXCEPTION 'atomic render authorization failed'; END IF;
  changed_id=NULL;
  UPDATE public.ai_media_daily_plan_slots AS target SET status='committed',state_version=target.state_version+1,updated_at=sampled_at
  WHERE target.id=gate.daily_plan_slot_id AND target.owner_user_id=p_owner_user_id
    AND target.workspace_id=p_workspace_id AND target.status='queued' RETURNING target.id INTO changed_id;
  IF changed_id IS NULL THEN RAISE EXCEPTION 'atomic slot commit failed'; END IF;
  RETURN QUERY SELECT authorized_attempt.id,authorized_attempt.owner_user_id,authorized_attempt.workspace_id,
    authorized_attempt.budget_reservation_id,authorized_attempt.render_job_id,
    authorized_attempt.provider_account_id,authorized_attempt.provider_key,
    authorized_attempt.provider_credential_version,authorized_attempt.provider_idempotency_key,
    authorized_attempt.avatar_external_resource_id,authorized_attempt.voice_external_resource_id,
    authorized_attempt.sealed_request_digest,authorized_attempt.fencing_token,authorized_attempt.lease_token,
    authorized_attempt.lease_expires_at,authorized_attempt.send_authorization_digest,
    authorized_attempt.commit_evidence_digest,authorized_attempt.authorized_at,gate.request_json;
END
$function$;

CREATE FUNCTION ai_media_worker_api.claim_admitted_v1(
  p_capability_id uuid,p_owner_user_id text,p_workspace_id text,p_worker_id text,p_lease_ms integer
) RETURNS TABLE(
  id uuid,owner_user_id text,workspace_id text,budget_reservation_id uuid,render_job_id uuid,
  provider_account_id uuid,provider_key text,provider_credential_version integer,
  provider_idempotency_key text,avatar_external_resource_id text,voice_external_resource_id text,
  sealed_request_digest text,fencing_token bigint,lease_token uuid,lease_expires_at timestamptz,request_json jsonb
) LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET row_security=on AS $function$
#variable_conflict use_column
DECLARE authority record; candidate record; attempt record; sampled_at timestamptz:=pg_catalog.clock_timestamp();
  new_lease uuid:=pg_catalog.gen_random_uuid(); new_attempt uuid; v_event_kind text; event_digest text;
BEGIN
  SELECT * INTO authority FROM ai_media_worker_api.require_capability_v1(p_capability_id,p_owner_user_id,
    p_workspace_id,'submit','claim',p_worker_id,p_lease_ms,NULL);
  SET CONSTRAINTS ALL DEFERRED;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'ai-media:admitted-claim:'||p_owner_user_id||':'||p_workspace_id,0));
  SELECT reservation.owner_user_id,reservation.workspace_id,activation.id work_activation_id,
    reservation.id budget_reservation_id,job.id render_job_id,outbox.id dispatch_outbox_id,
    slot.id daily_plan_slot_id,reservation.attempt slot_attempt,reservation.provider_account_id,
    reservation.provider_key,reservation.provider_credential_version,reservation.provider_idempotency_key,
    reservation.script_variant_checksum,reservation.authority_snapshot_id,reservation.authority_digest,
    job.launch_intent_id,job.launch_intent_digest,reservation.admission_digest,reservation.work_handoff_digest,
    job.sealed_request_digest,job.request request_json,avatar.external_resource_id avatar_external_resource_id,
    voice.external_resource_id voice_external_resource_id,existing.id existing_attempt_id,
    existing.state existing_state,existing.lease_expires_at existing_lease_expires_at
  INTO candidate
  FROM public.ai_media_render_jobs job
  JOIN public.ai_media_budget_reservations reservation ON reservation.id=job.budget_reservation_id
    AND reservation.owner_user_id=job.owner_user_id AND reservation.workspace_id=job.workspace_id
    AND reservation.render_job_id=job.id AND reservation.work_handoff_digest=job.work_handoff_digest
  JOIN public.ai_media_outbox outbox ON outbox.id=reservation.dispatch_outbox_id
    AND outbox.owner_user_id=reservation.owner_user_id AND outbox.workspace_id=reservation.workspace_id
    AND outbox.render_job_id=job.id AND outbox.budget_reservation_id=reservation.id
    AND outbox.work_handoff_digest=reservation.work_handoff_digest AND outbox.sealed_request_digest=job.sealed_request_digest
  JOIN public.ai_media_daily_plan_slots slot ON slot.id=reservation.daily_plan_slot_id
    AND slot.owner_user_id=reservation.owner_user_id AND slot.workspace_id=reservation.workspace_id
    AND slot.provider_account_id=reservation.provider_account_id AND slot.provider_key=reservation.provider_key
    AND slot.provider_credential_version=reservation.provider_credential_version
  JOIN public.ai_media_work_activations activation ON activation.budget_reservation_id=reservation.id
    AND activation.owner_user_id=reservation.owner_user_id AND activation.workspace_id=reservation.workspace_id
    AND activation.render_job_id=job.id AND activation.dispatch_outbox_id=outbox.id
    AND activation.work_handoff_digest=reservation.work_handoff_digest
    AND activation.sealed_request_digest=job.sealed_request_digest
  JOIN public.ai_media_provider_resources avatar ON avatar.id=job.avatar_resource_id
    AND avatar.owner_user_id=job.owner_user_id AND avatar.workspace_id=job.workspace_id
    AND avatar.provider_account_id=reservation.provider_account_id AND avatar.provider_key=reservation.provider_key
    AND avatar.resource_type='avatar'
  JOIN public.ai_media_provider_resources voice ON voice.id=job.voice_resource_id
    AND voice.owner_user_id=job.owner_user_id AND voice.workspace_id=job.workspace_id
    AND voice.provider_account_id=reservation.provider_account_id AND voice.provider_key=reservation.provider_key
    AND voice.resource_type='voice'
  LEFT JOIN public.ai_media_provider_submission_attempts existing ON existing.budget_reservation_id=reservation.id
    AND existing.owner_user_id=reservation.owner_user_id AND existing.workspace_id=reservation.workspace_id
  WHERE job.owner_user_id=p_owner_user_id AND job.workspace_id=p_workspace_id
    AND reservation.state='reserved' AND reservation.submission_state='not_started'
    AND reservation.expires_at>sampled_at AND reservation.quote_expires_at>sampled_at
    AND ((existing.id IS NULL AND job.stage='queued' AND outbox.status='pending')
      OR (existing.state='claimed' AND existing.lease_expires_at<=sampled_at
        AND job.stage='leased' AND outbox.status='leased'))
    AND slot.status='queued' AND avatar.status='active' AND voice.status='active'
  ORDER BY job.available_at,job.created_at,job.id
  FOR UPDATE OF job,reservation,outbox,slot,activation,avatar,voice SKIP LOCKED LIMIT 1;
  IF NOT FOUND THEN RETURN; END IF;
  new_attempt=COALESCE(candidate.existing_attempt_id,pg_catalog.gen_random_uuid());
  INSERT INTO public.ai_media_provider_submission_attempts(
    id,owner_user_id,workspace_id,budget_reservation_id,work_activation_id,render_job_id,dispatch_outbox_id,
    daily_plan_slot_id,slot_attempt,provider_account_id,provider_key,provider_credential_version,
    provider_idempotency_key,avatar_external_resource_id,voice_external_resource_id,script_variant_checksum,
    authority_snapshot_id,work_handoff_digest,sealed_request_digest,authority_digest,launch_intent_id,
    launch_intent_digest,admission_digest,state,fencing_token,claim_count,lease_token,lease_owner,
    lease_expires_at,claimed_at,actor_user_id,input_digest,created_at,updated_at)
  VALUES(new_attempt,candidate.owner_user_id,candidate.workspace_id,candidate.budget_reservation_id,
    candidate.work_activation_id,candidate.render_job_id,candidate.dispatch_outbox_id,candidate.daily_plan_slot_id,
    candidate.slot_attempt,candidate.provider_account_id,candidate.provider_key,candidate.provider_credential_version,
    candidate.provider_idempotency_key,candidate.avatar_external_resource_id,candidate.voice_external_resource_id,
    candidate.script_variant_checksum,candidate.authority_snapshot_id,candidate.work_handoff_digest,
    candidate.sealed_request_digest,candidate.authority_digest,candidate.launch_intent_id,
    candidate.launch_intent_digest,candidate.admission_digest,'claimed',1,1,new_lease,authority.actor_user_id,
    sampled_at+(p_lease_ms::text||' milliseconds')::interval,sampled_at,authority.actor_user_id,
    ai_media_worker_api.sha256_text_v1('claim:v1:'||new_attempt::text||':'||candidate.budget_reservation_id::text||
      ':'||authority.actor_user_id||':'||candidate.provider_idempotency_key||':'||candidate.sealed_request_digest),sampled_at,sampled_at)
  ON CONFLICT(owner_user_id,workspace_id,budget_reservation_id) DO UPDATE SET
    fencing_token=ai_media_provider_submission_attempts.fencing_token+1,
    claim_count=ai_media_provider_submission_attempts.claim_count+1,lease_token=EXCLUDED.lease_token,
    lease_owner=EXCLUDED.lease_owner,lease_expires_at=EXCLUDED.lease_expires_at,updated_at=EXCLUDED.updated_at
  WHERE ai_media_provider_submission_attempts.state='claimed'
    AND ai_media_provider_submission_attempts.lease_expires_at<=sampled_at RETURNING * INTO attempt;
  IF NOT FOUND THEN RETURN; END IF;
  v_event_kind=CASE WHEN attempt.claim_count=1 THEN 'claimed' ELSE 'reclaimed' END;
  event_digest=ai_media_worker_api.sha256_text_v1(v_event_kind||':v1:'||attempt.id::text||':'||
    attempt.fencing_token::text||':'||attempt.claim_count::text||':'||new_lease::text);
  INSERT INTO public.ai_media_provider_submission_events(owner_user_id,workspace_id,submission_attempt_id,
    budget_reservation_id,sequence,event_kind,fencing_token,evidence_digest,actor_user_id,observed_at,created_at)
  SELECT attempt.owner_user_id,attempt.workspace_id,attempt.id,attempt.budget_reservation_id,
    COALESCE(pg_catalog.max(e.sequence),0)+1,v_event_kind,attempt.fencing_token,event_digest,
    authority.actor_user_id,sampled_at,sampled_at FROM public.ai_media_provider_submission_events e
  WHERE e.submission_attempt_id=attempt.id;
  UPDATE public.ai_media_render_jobs SET stage='leased',status='rendering',lease_owner=authority.actor_user_id,
    lease_token=new_lease,lease_expires_at=attempt.lease_expires_at,lease_fencing=attempt.fencing_token,updated_at=sampled_at
  WHERE ai_media_render_jobs.id=candidate.render_job_id
    AND ai_media_render_jobs.budget_reservation_id=candidate.budget_reservation_id
    AND ai_media_render_jobs.stage IN ('queued','leased');
  IF NOT FOUND THEN RAISE EXCEPTION 'fenced admitted render claim CAS failed'; END IF;
  UPDATE public.ai_media_outbox SET status='leased',attempts=GREATEST(attempts,1),locked_at=sampled_at,
    lease_owner=authority.actor_user_id,lease_expires_at=attempt.lease_expires_at,
    fencing_token=attempt.fencing_token,updated_at=sampled_at
  WHERE ai_media_outbox.id=candidate.dispatch_outbox_id
    AND ai_media_outbox.budget_reservation_id=candidate.budget_reservation_id
    AND ai_media_outbox.status IN ('pending','leased');
  IF NOT FOUND THEN RAISE EXCEPTION 'fenced admitted outbox claim CAS failed'; END IF;
  RETURN QUERY SELECT attempt.id,attempt.owner_user_id,attempt.workspace_id,attempt.budget_reservation_id,
    attempt.render_job_id,attempt.provider_account_id,attempt.provider_key,attempt.provider_credential_version,
    attempt.provider_idempotency_key,attempt.avatar_external_resource_id,attempt.voice_external_resource_id,
    attempt.sealed_request_digest,attempt.fencing_token,attempt.lease_token,attempt.lease_expires_at,candidate.request_json;
END
$function$;

CREATE FUNCTION ai_media_worker_api.assert_capacity_consistency_v1() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET row_security=on AS $function$
DECLARE scoped_owner text; scoped_workspace text; scoped_reservation uuid;
BEGIN
  scoped_owner=NEW.owner_user_id; scoped_workspace=NEW.workspace_id;
  IF TG_TABLE_NAME='ai_media_budget_reservations' THEN scoped_reservation=NEW.id;
  ELSE scoped_reservation=NEW.budget_reservation_id; END IF;
  IF EXISTS (
    SELECT 1 FROM public.ai_media_provider_submission_attempts a
    JOIN public.ai_media_budget_reservations r ON r.id=a.budget_reservation_id
      AND r.owner_user_id=a.owner_user_id AND r.workspace_id=a.workspace_id
    LEFT JOIN public.ai_media_submission_capacity_leases c ON c.submission_attempt_id=a.id
      AND c.budget_reservation_id=a.budget_reservation_id
      AND c.owner_user_id=a.owner_user_id AND c.workspace_id=a.workspace_id
    WHERE a.owner_user_id=scoped_owner AND a.workspace_id=scoped_workspace
      AND a.budget_reservation_id=scoped_reservation
      AND ((a.state IN ('authorized','ambiguous','confirmed','reconciled_no_submit') AND c.id IS NULL)
        OR (c.id IS NOT NULL AND (c.provider_account_id<>a.provider_account_id OR c.provider_key<>a.provider_key))
        OR (a.state IN ('authorized','ambiguous') AND c.state<>'held')
        OR (a.state='reconciled_no_submit' AND NOT (c.state='released'
          AND c.release_kind='reconciled_no_submit' AND r.state='released'
          AND r.submission_state='reconciled_no_submit'))
        OR (a.state='confirmed' AND NOT (c.state='held' OR (c.state='released'
          AND c.release_kind='provider_terminal'))))
  ) THEN RAISE EXCEPTION 'submission capacity does not match exact attempt lifecycle'; END IF;
  RETURN NULL;
END
$function$;
CREATE CONSTRAINT TRIGGER ai_media_pr26_attempt_capacity_guard AFTER INSERT OR UPDATE
  ON public.ai_media_provider_submission_attempts DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
  EXECUTE FUNCTION ai_media_worker_api.assert_capacity_consistency_v1();
CREATE CONSTRAINT TRIGGER ai_media_pr26_reservation_capacity_guard AFTER INSERT OR UPDATE
  ON public.ai_media_budget_reservations DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
  EXECUTE FUNCTION ai_media_worker_api.assert_capacity_consistency_v1();
CREATE CONSTRAINT TRIGGER ai_media_pr26_capacity_guard AFTER INSERT OR UPDATE
  ON public.ai_media_submission_capacity_leases DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
  EXECUTE FUNCTION ai_media_worker_api.assert_capacity_consistency_v1();

-- The definer can lock immutable authority rows with UPDATE(id), the minimum
-- PostgreSQL privilege required by SELECT ... FOR UPDATE. It has full mutation
-- rights only on the admitted tuple and capacity ledger.
GRANT USAGE ON SCHEMA public TO ai_media_admitted_fn_owner;
GRANT SELECT ON TABLE
  public.ai_media_admitted_worker_capabilities,public.ai_media_provider_submission_attempts,
  public.ai_media_provider_submission_events,public.ai_media_submission_capacity_leases,
  public.ai_media_budget_reservations,public.ai_media_budget_buckets,public.ai_media_render_jobs,
  public.ai_media_outbox,public.ai_media_daily_plan_slots,public.ai_media_daily_plans,
  public.ai_media_work_activations,public.ai_media_launch_authority_snapshots,
  public.ai_media_launch_evidence,public.ai_media_launch_intents,
  public.ai_media_admission_policy_revisions,public.ai_media_kill_switch_revisions,
  public.ai_media_provider_accounts,public.ai_media_provider_resources,
  public.ai_media_governance_profiles,public.ai_media_influencers,
  public.ai_media_script_variants,public.ai_media_scripts,public.ai_media_source_items
TO ai_media_admitted_fn_owner;
GRANT INSERT,UPDATE ON TABLE
  public.ai_media_provider_submission_attempts,public.ai_media_provider_submission_events,
  public.ai_media_submission_capacity_leases,public.ai_media_budget_reservations,
  public.ai_media_budget_buckets,public.ai_media_render_jobs,public.ai_media_outbox,
  public.ai_media_daily_plan_slots
TO ai_media_admitted_fn_owner;
GRANT UPDATE(id) ON TABLE
  public.ai_media_admitted_worker_capabilities,public.ai_media_daily_plans,
  public.ai_media_work_activations,public.ai_media_launch_authority_snapshots,
  public.ai_media_launch_evidence,public.ai_media_launch_intents,
  public.ai_media_admission_policy_revisions,public.ai_media_kill_switch_revisions,
  public.ai_media_provider_accounts,public.ai_media_provider_resources,
  public.ai_media_governance_profiles,public.ai_media_influencers,
  public.ai_media_script_variants,public.ai_media_scripts,public.ai_media_source_items
TO ai_media_admitted_fn_owner;

-- PR25's deferred trigger fires at COMMIT after the entrypoint's definer frame
-- has ended. Keep the executor table-blind by moving that trigger function to
-- the same safe NOLOGIN owner. This privilege tightening is intentionally not
-- weakened by the PR26 rollback.
ALTER FUNCTION public.ai_media_assert_pr25_consistency() SECURITY DEFINER;
ALTER FUNCTION public.ai_media_assert_pr25_consistency() SET search_path=pg_catalog;
ALTER FUNCTION public.ai_media_assert_pr25_consistency() OWNER TO ai_media_admitted_fn_owner;
REVOKE ALL ON FUNCTION public.ai_media_assert_pr25_consistency() FROM PUBLIC;

REVOKE ALL ON TABLE
  public.ai_media_admitted_worker_capabilities,public.ai_media_provider_submission_attempts,
  public.ai_media_provider_submission_events,public.ai_media_submission_capacity_leases,
  public.ai_media_budget_reservations,public.ai_media_budget_buckets,public.ai_media_render_jobs,
  public.ai_media_outbox,public.ai_media_daily_plan_slots,public.ai_media_daily_plans,
  public.ai_media_work_activations,public.ai_media_launch_authority_snapshots,
  public.ai_media_launch_evidence,public.ai_media_launch_intents,
  public.ai_media_admission_policy_revisions,public.ai_media_kill_switch_revisions,
  public.ai_media_provider_accounts,public.ai_media_provider_resources,
  public.ai_media_governance_profiles,public.ai_media_influencers,
  public.ai_media_script_variants,public.ai_media_scripts,public.ai_media_source_items
FROM PUBLIC,ai_media_admitted_submit_executor,ai_media_admitted_reconcile_executor;

ALTER FUNCTION ai_media_worker_api.guard_capability_v1() OWNER TO ai_media_admitted_fn_owner;
ALTER FUNCTION ai_media_worker_api.guard_capacity_lease_v1() OWNER TO ai_media_admitted_fn_owner;
ALTER FUNCTION ai_media_worker_api.require_capability_v1(uuid,text,text,text,text,text,integer,integer) OWNER TO ai_media_admitted_fn_owner;
ALTER FUNCTION ai_media_worker_api.sha256_text_v1(text) OWNER TO ai_media_admitted_fn_owner;
ALTER FUNCTION ai_media_worker_api.claim_admitted_v1(uuid,text,text,text,integer) OWNER TO ai_media_admitted_fn_owner;
ALTER FUNCTION ai_media_worker_api.authorize_admitted_v1(uuid,text,text,uuid,uuid,bigint,uuid,text) OWNER TO ai_media_admitted_fn_owner;
ALTER FUNCTION ai_media_worker_api.finish_outcome_v1(text,text,uuid,uuid,bigint,text,uuid,uuid,bigint,text,text,text,text,text) OWNER TO ai_media_admitted_fn_owner;
ALTER FUNCTION ai_media_worker_api.record_submit_confirmed_v1(uuid,text,text,uuid,uuid,bigint,text,uuid,text,text,text) OWNER TO ai_media_admitted_fn_owner;
ALTER FUNCTION ai_media_worker_api.record_submit_ambiguous_v1(uuid,text,text,uuid,uuid,bigint,text,uuid,text,text) OWNER TO ai_media_admitted_fn_owner;
ALTER FUNCTION ai_media_worker_api.expire_authorized_v1(uuid,text,text,integer) OWNER TO ai_media_admitted_fn_owner;
ALTER FUNCTION ai_media_worker_api.claim_reconciliation_v1(uuid,text,text,text,integer) OWNER TO ai_media_admitted_fn_owner;
ALTER FUNCTION ai_media_worker_api.release_reconciliation_unknown_v1(uuid,text,text,uuid,uuid,bigint,text,uuid,bigint) OWNER TO ai_media_admitted_fn_owner;
ALTER FUNCTION ai_media_worker_api.record_reconciled_confirmed_v1(uuid,text,text,uuid,uuid,bigint,text,uuid,bigint,text,text,text) OWNER TO ai_media_admitted_fn_owner;
ALTER FUNCTION ai_media_worker_api.finalize_reconciled_no_submit_v1(uuid,text,text,uuid,uuid,bigint,text,uuid,bigint,text,uuid,text,integer,text,timestamptz,text) OWNER TO ai_media_admitted_fn_owner;
ALTER FUNCTION ai_media_worker_api.release_terminal_capacity_v1(uuid,text,text,uuid,uuid,text,text,text) OWNER TO ai_media_admitted_fn_owner;
ALTER FUNCTION ai_media_worker_api.assert_capacity_consistency_v1() OWNER TO ai_media_admitted_fn_owner;

REVOKE ALL ON ALL FUNCTIONS IN SCHEMA ai_media_worker_api FROM PUBLIC;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA ai_media_worker_api
  FROM ai_media_admitted_submit_executor,ai_media_admitted_reconcile_executor;
GRANT USAGE ON SCHEMA ai_media_worker_api
  TO ai_media_admitted_submit_executor,ai_media_admitted_reconcile_executor;
GRANT EXECUTE ON FUNCTION
  ai_media_worker_api.claim_admitted_v1(uuid,text,text,text,integer),
  ai_media_worker_api.authorize_admitted_v1(uuid,text,text,uuid,uuid,bigint,uuid,text),
  ai_media_worker_api.record_submit_confirmed_v1(uuid,text,text,uuid,uuid,bigint,text,uuid,text,text,text),
  ai_media_worker_api.record_submit_ambiguous_v1(uuid,text,text,uuid,uuid,bigint,text,uuid,text,text),
  ai_media_worker_api.expire_authorized_v1(uuid,text,text,integer)
TO ai_media_admitted_submit_executor;
GRANT EXECUTE ON FUNCTION
  ai_media_worker_api.claim_reconciliation_v1(uuid,text,text,text,integer),
  ai_media_worker_api.release_reconciliation_unknown_v1(uuid,text,text,uuid,uuid,bigint,text,uuid,bigint),
  ai_media_worker_api.record_reconciled_confirmed_v1(uuid,text,text,uuid,uuid,bigint,text,uuid,bigint,text,text,text),
  ai_media_worker_api.finalize_reconciled_no_submit_v1(uuid,text,text,uuid,uuid,bigint,text,uuid,bigint,text,uuid,text,integer,text,timestamptz,text),
  ai_media_worker_api.release_terminal_capacity_v1(uuid,text,text,uuid,uuid,text,text,text)
TO ai_media_admitted_reconcile_executor;

ALTER DEFAULT PRIVILEGES FOR ROLE ai_media_admitted_fn_owner IN SCHEMA ai_media_worker_api
  REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
COMMIT;
