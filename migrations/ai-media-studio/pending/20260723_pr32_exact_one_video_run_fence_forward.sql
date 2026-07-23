-- AI Media Studio PR32: exact one-video run fence.
-- Review artifact only. Do not apply automatically.
-- No provider, network, spend, publication, worker start, or deployment I/O.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15min';
SET LOCAL search_path = public, pg_catalog;

DO $preflight$
DECLARE role_row record;
BEGIN
  IF current_setting('server_version_num')::integer < 160000
    OR to_regclass('public.ai_media_budget_reservations') IS NULL
    OR to_regclass('public.ai_media_work_activations') IS NULL
    OR to_regclass('public.ai_media_provider_terminal_events') IS NULL
    OR to_regclass('public.ai_media_exact_one_video_run_fences') IS NOT NULL
    OR to_regprocedure('ai_media_worker_api.sha256_text_v1(text)') IS NULL
  THEN
    RAISE EXCEPTION 'PR32 requires the exact PostgreSQL 16 PR27 chain and must not already be applied';
  END IF;
  SELECT * INTO role_row FROM pg_catalog.pg_roles WHERE rolname='ai_media_one_video_run_executor';
  IF NOT FOUND OR role_row.rolcanlogin OR role_row.rolsuper OR role_row.rolinherit
    OR role_row.rolcreaterole OR role_row.rolcreatedb OR role_row.rolreplication OR role_row.rolbypassrls
    OR pg_catalog.pg_has_role('ai_media_one_video_run_executor','ai_media_admitted_fn_owner','MEMBER')
    OR pg_catalog.pg_has_role('ai_media_one_video_run_executor','ai_media_admitted_submit_executor','MEMBER')
    OR pg_catalog.pg_has_role('ai_media_one_video_run_executor','ai_media_admitted_reconcile_executor','MEMBER')
  THEN
    RAISE EXCEPTION 'PR32 requires a safe precreated table-blind NOLOGIN NOINHERIT executor role';
  END IF;
END
$preflight$;

LOCK TABLE public.ai_media_budget_reservations IN SHARE ROW EXCLUSIVE MODE;

CREATE UNIQUE INDEX ai_media_budget_reservations_exact_run_fence_identity_uq
  ON public.ai_media_budget_reservations(owner_user_id,workspace_id,id,render_job_id,
    daily_plan_slot_id,attempt,work_handoff_digest);

CREATE TABLE public.ai_media_exact_one_video_run_capabilities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  database_principal name NOT NULL,
  owner_user_id text NOT NULL,
  workspace_id text NOT NULL,
  actor_user_id text NOT NULL,
  budget_reservation_id uuid NOT NULL,
  render_job_id uuid NOT NULL,
  daily_plan_slot_id uuid NOT NULL,
  slot_attempt integer NOT NULL,
  work_handoff_digest text NOT NULL,
  action text NOT NULL,
  command_id text NOT NULL,
  command_digest text NOT NULL,
  max_lease_ms integer NOT NULL,
  valid_from timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  revocation_evidence_digest text,
  consumed_at timestamptz,
  evidence_digest text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  CONSTRAINT ai_media_exact_one_video_run_capabilities_ck CHECK (
    length(btrim(database_principal::text)) BETWEEN 1 AND 63
    AND length(btrim(owner_user_id)) BETWEEN 1 AND 160
    AND length(btrim(workspace_id)) BETWEEN 1 AND 160
    AND length(btrim(actor_user_id)) BETWEEN 1 AND 160
    AND slot_attempt>=1
    AND work_handoff_digest ~ '^sha256:[0-9a-f]{64}$'
    AND action IN ('activate_and_submit','reconcile_submission','observe_terminal','ingest_asset','link_asset')
    AND length(btrim(command_id)) BETWEEN 1 AND 160
    AND command_digest ~ '^sha256:[0-9a-f]{64}$'
    AND max_lease_ms BETWEEN 1 AND 300000
    AND expires_at>valid_from AND isfinite(valid_from) AND isfinite(expires_at)
    AND (revoked_at IS NULL OR isfinite(revoked_at))
    AND ((revoked_at IS NULL AND revocation_evidence_digest IS NULL)
      OR revocation_evidence_digest ~ '^sha256:[0-9a-f]{64}$')
    AND (consumed_at IS NULL OR isfinite(consumed_at))
    AND evidence_digest ~ '^sha256:[0-9a-f]{64}$'
    AND isfinite(created_at)
  ),
  CONSTRAINT ai_media_exact_one_video_run_capabilities_target_fk FOREIGN KEY
    (owner_user_id,workspace_id,budget_reservation_id,render_job_id,daily_plan_slot_id,
      slot_attempt,work_handoff_digest)
    REFERENCES public.ai_media_budget_reservations(owner_user_id,workspace_id,id,render_job_id,
      daily_plan_slot_id,attempt,work_handoff_digest)
    ON UPDATE NO ACTION ON DELETE RESTRICT
);
CREATE UNIQUE INDEX ai_media_exact_one_video_run_capabilities_command_uq
  ON public.ai_media_exact_one_video_run_capabilities(owner_user_id,workspace_id,command_digest);
CREATE UNIQUE INDEX ai_media_exact_one_video_run_capabilities_exact_uq
  ON public.ai_media_exact_one_video_run_capabilities(id,owner_user_id,workspace_id,actor_user_id,
    budget_reservation_id,render_job_id,daily_plan_slot_id,slot_attempt,work_handoff_digest,
    action,command_id,command_digest);

CREATE TABLE public.ai_media_exact_one_video_run_fences (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id text NOT NULL,
  workspace_id text NOT NULL,
  capability_id uuid NOT NULL,
  actor_user_id text NOT NULL,
  budget_reservation_id uuid NOT NULL,
  render_job_id uuid NOT NULL,
  daily_plan_slot_id uuid NOT NULL,
  slot_attempt integer NOT NULL,
  work_handoff_digest text NOT NULL,
  action text NOT NULL,
  command_id text NOT NULL,
  command_digest text NOT NULL,
  state text NOT NULL,
  fencing_token bigint NOT NULL,
  claim_count integer NOT NULL,
  lease_token uuid,
  lease_owner text,
  lease_expires_at timestamptz,
  outcome text,
  result_digest text,
  completed_at timestamptz,
  uncertain_error_digest text,
  uncertain_at timestamptz,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  CONSTRAINT ai_media_exact_one_video_run_fences_ck CHECK (
    slot_attempt>=1 AND work_handoff_digest ~ '^sha256:[0-9a-f]{64}$'
    AND action IN ('activate_and_submit','reconcile_submission','observe_terminal','ingest_asset','link_asset')
    AND length(btrim(command_id)) BETWEEN 1 AND 160
    AND command_digest ~ '^sha256:[0-9a-f]{64}$'
    AND length(btrim(actor_user_id)) BETWEEN 1 AND 160
    AND state IN ('running','completed','uncertain')
    AND fencing_token>=1 AND claim_count>=1
    AND (outcome IS NULL OR outcome IN ('confirmed','ambiguous','reconciled_no_submit','processing',
      'completed','failed','asset_completed','asset_completed_unlinked','asset_linked',
      'retry_scheduled','dead_letter','lease_lost','idle','authorization_lost'))
    AND (result_digest IS NULL OR result_digest ~ '^sha256:[0-9a-f]{64}$')
    AND (uncertain_error_digest IS NULL OR uncertain_error_digest ~ '^sha256:[0-9a-f]{64}$')
    AND isfinite(created_at) AND isfinite(updated_at)
    AND ((state='running' AND lease_token IS NOT NULL AND lease_owner IS NOT NULL
      AND lease_expires_at IS NOT NULL AND isfinite(lease_expires_at)
      AND outcome IS NULL AND result_digest IS NULL AND completed_at IS NULL
      AND uncertain_error_digest IS NULL AND uncertain_at IS NULL)
      OR (state='completed' AND lease_token IS NULL AND lease_owner IS NULL AND lease_expires_at IS NULL
        AND outcome IS NOT NULL AND result_digest IS NOT NULL AND completed_at IS NOT NULL
        AND isfinite(completed_at) AND uncertain_error_digest IS NULL AND uncertain_at IS NULL)
      OR (state='uncertain' AND lease_token IS NULL AND lease_owner IS NULL AND lease_expires_at IS NULL
        AND outcome IS NULL AND result_digest IS NULL AND completed_at IS NULL
        AND uncertain_error_digest IS NOT NULL AND uncertain_at IS NOT NULL AND isfinite(uncertain_at)))
  ),
  CONSTRAINT ai_media_exact_one_video_run_fences_capability_fk FOREIGN KEY
    (capability_id,owner_user_id,workspace_id,actor_user_id,budget_reservation_id,render_job_id,
      daily_plan_slot_id,slot_attempt,work_handoff_digest,action,command_id,command_digest)
    REFERENCES public.ai_media_exact_one_video_run_capabilities(id,owner_user_id,workspace_id,
      actor_user_id,budget_reservation_id,render_job_id,daily_plan_slot_id,slot_attempt,
      work_handoff_digest,action,command_id,command_digest)
    ON UPDATE NO ACTION ON DELETE RESTRICT
);
CREATE UNIQUE INDEX ai_media_exact_one_video_run_fences_command_uq
  ON public.ai_media_exact_one_video_run_fences(owner_user_id,workspace_id,command_digest);
CREATE UNIQUE INDEX ai_media_exact_one_video_run_fences_command_id_uq
  ON public.ai_media_exact_one_video_run_fences(owner_user_id,workspace_id,command_id);
CREATE UNIQUE INDEX ai_media_exact_one_video_run_fences_exact_identity_uq
  ON public.ai_media_exact_one_video_run_fences(owner_user_id,workspace_id,id,command_id,
    command_digest,fencing_token,lease_token);
CREATE UNIQUE INDEX ai_media_exact_one_video_run_fences_running_target_uq
  ON public.ai_media_exact_one_video_run_fences(owner_user_id,workspace_id,budget_reservation_id,
    render_job_id,daily_plan_slot_id,slot_attempt,work_handoff_digest) WHERE state='running';

CREATE FUNCTION public.ai_media_guard_exact_one_video_run_capability() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET row_security=on AS $guard$
BEGIN
  IF TG_OP IN ('DELETE','TRUNCATE') THEN
    RAISE EXCEPTION 'exact one-video capability evidence cannot be deleted';
  END IF;
  IF ROW(NEW.id,NEW.database_principal,NEW.owner_user_id,NEW.workspace_id,NEW.actor_user_id,
      NEW.budget_reservation_id,NEW.render_job_id,NEW.daily_plan_slot_id,NEW.slot_attempt,
      NEW.work_handoff_digest,NEW.action,NEW.command_id,NEW.command_digest,NEW.max_lease_ms,
      NEW.valid_from,NEW.expires_at,NEW.evidence_digest,NEW.created_at)
    IS DISTINCT FROM
    ROW(OLD.id,OLD.database_principal,OLD.owner_user_id,OLD.workspace_id,OLD.actor_user_id,
      OLD.budget_reservation_id,OLD.render_job_id,OLD.daily_plan_slot_id,OLD.slot_attempt,
      OLD.work_handoff_digest,OLD.action,OLD.command_id,OLD.command_digest,OLD.max_lease_ms,
      OLD.valid_from,OLD.expires_at,OLD.evidence_digest,OLD.created_at)
    OR (OLD.consumed_at IS NOT NULL AND NEW.consumed_at IS DISTINCT FROM OLD.consumed_at)
    OR (OLD.consumed_at IS NULL AND NEW.consumed_at IS NULL
      AND OLD.revoked_at IS NOT NULL)
    OR (OLD.revoked_at IS NOT NULL AND NEW.revoked_at IS DISTINCT FROM OLD.revoked_at)
    OR (OLD.revocation_evidence_digest IS NOT NULL
      AND NEW.revocation_evidence_digest IS DISTINCT FROM OLD.revocation_evidence_digest)
  THEN
    RAISE EXCEPTION 'exact one-video capability identity is immutable';
  END IF;
  RETURN NEW;
END
$guard$;
CREATE TRIGGER ai_media_exact_one_video_run_capabilities_guard BEFORE UPDATE OR DELETE
  ON public.ai_media_exact_one_video_run_capabilities FOR EACH ROW
  EXECUTE FUNCTION public.ai_media_guard_exact_one_video_run_capability();
CREATE TRIGGER ai_media_exact_one_video_run_capabilities_truncate_guard BEFORE TRUNCATE
  ON public.ai_media_exact_one_video_run_capabilities FOR EACH STATEMENT
  EXECUTE FUNCTION public.ai_media_guard_exact_one_video_run_capability();

CREATE FUNCTION public.ai_media_guard_exact_one_video_run_fence() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET row_security=on AS $guard$
BEGIN
  IF TG_OP IN ('DELETE','TRUNCATE') THEN RAISE EXCEPTION 'exact one-video run evidence cannot be deleted'; END IF;
  IF ROW(NEW.id,NEW.owner_user_id,NEW.workspace_id,NEW.capability_id,NEW.actor_user_id,
      NEW.budget_reservation_id,NEW.render_job_id,NEW.daily_plan_slot_id,NEW.slot_attempt,
      NEW.work_handoff_digest,NEW.action,NEW.command_id,NEW.command_digest,NEW.created_at)
    IS DISTINCT FROM
    ROW(OLD.id,OLD.owner_user_id,OLD.workspace_id,OLD.capability_id,OLD.actor_user_id,
      OLD.budget_reservation_id,OLD.render_job_id,OLD.daily_plan_slot_id,OLD.slot_attempt,
      OLD.work_handoff_digest,OLD.action,OLD.command_id,OLD.command_digest,OLD.created_at)
    OR NEW.fencing_token<OLD.fencing_token OR NEW.claim_count<OLD.claim_count
    OR OLD.state IN ('completed','uncertain')
    OR (OLD.state='running' AND NEW.state NOT IN ('running','completed','uncertain'))
  THEN RAISE EXCEPTION 'invalid exact one-video run fence transition'; END IF;
  RETURN NEW;
END
$guard$;
CREATE TRIGGER ai_media_exact_one_video_run_fences_guard BEFORE UPDATE OR DELETE
  ON public.ai_media_exact_one_video_run_fences FOR EACH ROW
  EXECUTE FUNCTION public.ai_media_guard_exact_one_video_run_fence();
CREATE TRIGGER ai_media_exact_one_video_run_fences_truncate_guard BEFORE TRUNCATE
  ON public.ai_media_exact_one_video_run_fences FOR EACH STATEMENT
  EXECUTE FUNCTION public.ai_media_guard_exact_one_video_run_fence();

CREATE FUNCTION ai_media_worker_api.require_exact_one_video_run_capability_v1(
  p_capability_id uuid,p_owner_user_id text,p_workspace_id text,p_actor_user_id text,
  p_budget_reservation_id uuid,p_render_job_id uuid,p_daily_plan_slot_id uuid,p_slot_attempt integer,
  p_work_handoff_digest text,p_action text,p_command_id text,p_command_digest text,p_lease_ms integer
) RETURNS public.ai_media_exact_one_video_run_capabilities
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET row_security=on AS $function$
DECLARE capability public.ai_media_exact_one_video_run_capabilities%ROWTYPE;
  sampled_at timestamptz:=pg_catalog.clock_timestamp();
BEGIN
  SELECT * INTO capability FROM public.ai_media_exact_one_video_run_capabilities
  WHERE id=p_capability_id AND database_principal=SESSION_USER
    AND owner_user_id=p_owner_user_id AND workspace_id=p_workspace_id
    AND actor_user_id=p_actor_user_id AND budget_reservation_id=p_budget_reservation_id
    AND render_job_id=p_render_job_id AND daily_plan_slot_id=p_daily_plan_slot_id
    AND slot_attempt=p_slot_attempt AND work_handoff_digest=p_work_handoff_digest
    AND action=p_action AND command_id=p_command_id AND command_digest=p_command_digest
    AND p_lease_ms BETWEEN 1 AND max_lease_ms
    AND valid_from<=sampled_at AND expires_at>sampled_at AND revoked_at IS NULL
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'exact one-video run capability denied'; END IF;
  IF pg_catalog.has_table_privilege(SESSION_USER,'public.ai_media_exact_one_video_run_capabilities',
      'SELECT,INSERT,UPDATE,DELETE')
    OR pg_catalog.has_table_privilege(SESSION_USER,'public.ai_media_exact_one_video_run_fences',
      'SELECT,INSERT,UPDATE,DELETE')
  THEN RAISE EXCEPTION 'exact one-video executor must remain table-blind'; END IF;
  RETURN capability;
END
$function$;

CREATE FUNCTION ai_media_worker_api.acquire_exact_one_video_run_v1(
  p_capability_id uuid,p_owner_user_id text,p_workspace_id text,p_budget_reservation_id uuid,
  p_render_job_id uuid,p_daily_plan_slot_id uuid,p_slot_attempt integer,p_work_handoff_digest text,
  p_action text,p_command_id text,p_command_digest text,p_actor_user_id text,p_lease_ms integer
) RETURNS TABLE(kind text,execution_id uuid,command_id text,command_digest text,fencing_token bigint,
  lease_token uuid,owner_user_id text,workspace_id text,budget_reservation_id uuid,render_job_id uuid,
  daily_plan_slot_id uuid,slot_attempt integer,work_handoff_digest text,action text,actor_user_id text,
  outcome text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET row_security=on AS $function$
#variable_conflict use_column
DECLARE capability public.ai_media_exact_one_video_run_capabilities%ROWTYPE;
  current_run public.ai_media_exact_one_video_run_fences%ROWTYPE;
  other_run public.ai_media_exact_one_video_run_fences%ROWTYPE;
  matching_commands integer;
  sampled_at timestamptz:=pg_catalog.clock_timestamp(); new_lease uuid:=pg_catalog.gen_random_uuid();
BEGIN
  capability=ai_media_worker_api.require_exact_one_video_run_capability_v1(p_capability_id,
    p_owner_user_id,p_workspace_id,p_actor_user_id,p_budget_reservation_id,p_render_job_id,
    p_daily_plan_slot_id,p_slot_attempt,p_work_handoff_digest,p_action,p_command_id,p_command_digest,p_lease_ms);
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'ai-media:exact-one-video-command-id:'||p_owner_user_id||':'||p_workspace_id||':'||p_command_id,0));
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'ai-media:exact-one-video-command-digest:'||p_owner_user_id||':'||p_workspace_id||':'||p_command_digest,0));
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'ai-media:exact-one-video-run:'||p_owner_user_id||':'||p_workspace_id||':'||
    p_budget_reservation_id::text||':'||p_render_job_id::text||':'||p_daily_plan_slot_id::text||
    ':'||p_slot_attempt::text||':'||p_work_handoff_digest,0));
  SELECT pg_catalog.count(*) INTO matching_commands
  FROM public.ai_media_exact_one_video_run_fences
  WHERE owner_user_id=p_owner_user_id AND workspace_id=p_workspace_id
    AND (command_digest=p_command_digest OR command_id=p_command_id);
  IF matching_commands>1 THEN
    RETURN QUERY SELECT 'conflict',NULL::uuid,p_command_id,p_command_digest,NULL::bigint,NULL::uuid,
      NULL::text,NULL::text,NULL::uuid,NULL::uuid,NULL::uuid,NULL::integer,NULL::text,NULL::text,NULL::text,NULL::text;
    RETURN;
  END IF;
  SELECT * INTO current_run FROM public.ai_media_exact_one_video_run_fences
  WHERE owner_user_id=p_owner_user_id AND workspace_id=p_workspace_id
    AND (command_digest=p_command_digest OR command_id=p_command_id)
  FOR UPDATE;
  IF FOUND THEN
    IF current_run.capability_id<>p_capability_id OR current_run.actor_user_id<>p_actor_user_id
      OR current_run.budget_reservation_id<>p_budget_reservation_id
      OR current_run.render_job_id<>p_render_job_id OR current_run.daily_plan_slot_id<>p_daily_plan_slot_id
      OR current_run.slot_attempt<>p_slot_attempt OR current_run.work_handoff_digest<>p_work_handoff_digest
      OR current_run.action<>p_action OR current_run.command_id<>p_command_id
      OR current_run.command_digest<>p_command_digest
    THEN RETURN QUERY SELECT 'conflict',NULL::uuid,p_command_id,p_command_digest,NULL::bigint,NULL::uuid,
      NULL::text,NULL::text,NULL::uuid,NULL::uuid,NULL::uuid,NULL::integer,NULL::text,NULL::text,NULL::text,NULL::text;
      RETURN;
    END IF;
    IF current_run.state='completed' THEN
      RETURN QUERY SELECT 'replayed',current_run.id,current_run.command_id,current_run.command_digest,
        current_run.fencing_token,NULL::uuid,current_run.owner_user_id,current_run.workspace_id,
        current_run.budget_reservation_id,current_run.render_job_id,current_run.daily_plan_slot_id,
        current_run.slot_attempt,current_run.work_handoff_digest,current_run.action,current_run.actor_user_id,
        current_run.outcome;
      RETURN;
    END IF;
    IF current_run.state='uncertain' THEN
      RETURN QUERY SELECT 'conflict',NULL::uuid,p_command_id,p_command_digest,NULL::bigint,NULL::uuid,
        NULL::text,NULL::text,NULL::uuid,NULL::uuid,NULL::uuid,NULL::integer,NULL::text,NULL::text,NULL::text,NULL::text;
      RETURN;
    END IF;
    IF current_run.lease_expires_at>sampled_at THEN
      RETURN QUERY SELECT 'busy',NULL::uuid,p_command_id,p_command_digest,NULL::bigint,NULL::uuid,
        NULL::text,NULL::text,NULL::uuid,NULL::uuid,NULL::uuid,NULL::integer,NULL::text,NULL::text,NULL::text,NULL::text;
      RETURN;
    END IF;
    UPDATE public.ai_media_exact_one_video_run_fences SET fencing_token=fencing_token+1,
      claim_count=claim_count+1,lease_token=new_lease,lease_owner=p_actor_user_id,
      lease_expires_at=sampled_at+(p_lease_ms::text||' milliseconds')::interval,updated_at=sampled_at
    WHERE id=current_run.id RETURNING * INTO current_run;
  ELSE
    IF capability.consumed_at IS NOT NULL THEN
      RETURN QUERY SELECT 'conflict',NULL::uuid,p_command_id,p_command_digest,NULL::bigint,NULL::uuid,
        NULL::text,NULL::text,NULL::uuid,NULL::uuid,NULL::uuid,NULL::integer,NULL::text,NULL::text,NULL::text,NULL::text;
      RETURN;
    END IF;
    SELECT * INTO other_run FROM public.ai_media_exact_one_video_run_fences
    WHERE owner_user_id=p_owner_user_id AND workspace_id=p_workspace_id
      AND budget_reservation_id=p_budget_reservation_id AND render_job_id=p_render_job_id
      AND daily_plan_slot_id=p_daily_plan_slot_id AND slot_attempt=p_slot_attempt
      AND work_handoff_digest=p_work_handoff_digest AND state='running' FOR UPDATE;
    IF FOUND THEN
      RETURN QUERY SELECT 'busy',NULL::uuid,p_command_id,p_command_digest,NULL::bigint,NULL::uuid,
        NULL::text,NULL::text,NULL::uuid,NULL::uuid,NULL::uuid,NULL::integer,NULL::text,NULL::text,NULL::text,NULL::text;
      RETURN;
    END IF;
    UPDATE public.ai_media_exact_one_video_run_capabilities SET consumed_at=sampled_at WHERE id=capability.id;
    INSERT INTO public.ai_media_exact_one_video_run_fences(owner_user_id,workspace_id,capability_id,
      actor_user_id,budget_reservation_id,render_job_id,daily_plan_slot_id,slot_attempt,
      work_handoff_digest,action,command_id,command_digest,state,fencing_token,claim_count,
      lease_token,lease_owner,lease_expires_at,created_at,updated_at)
    VALUES(p_owner_user_id,p_workspace_id,p_capability_id,p_actor_user_id,p_budget_reservation_id,
      p_render_job_id,p_daily_plan_slot_id,p_slot_attempt,p_work_handoff_digest,p_action,p_command_id,
      p_command_digest,'running',1,1,new_lease,p_actor_user_id,
      sampled_at+(p_lease_ms::text||' milliseconds')::interval,sampled_at,sampled_at)
    RETURNING * INTO current_run;
  END IF;
  RETURN QUERY SELECT 'acquired',current_run.id,current_run.command_id,current_run.command_digest,
    current_run.fencing_token,current_run.lease_token,current_run.owner_user_id,current_run.workspace_id,
    current_run.budget_reservation_id,current_run.render_job_id,current_run.daily_plan_slot_id,
    current_run.slot_attempt,current_run.work_handoff_digest,current_run.action,current_run.actor_user_id,
    current_run.outcome;
END
$function$;

CREATE FUNCTION ai_media_worker_api.require_exact_one_video_run_finalizer_v1(
  p_capability_id uuid,p_owner_user_id text,p_workspace_id text,p_actor_user_id text,
  p_budget_reservation_id uuid,p_render_job_id uuid,p_daily_plan_slot_id uuid,p_slot_attempt integer,
  p_work_handoff_digest text,p_action text,p_command_id text,p_command_digest text
) RETURNS public.ai_media_exact_one_video_run_capabilities
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET row_security=on AS $function$
DECLARE capability public.ai_media_exact_one_video_run_capabilities%ROWTYPE;
BEGIN
  SELECT * INTO capability FROM public.ai_media_exact_one_video_run_capabilities
  WHERE id=p_capability_id AND database_principal=SESSION_USER
    AND owner_user_id=p_owner_user_id AND workspace_id=p_workspace_id
    AND actor_user_id=p_actor_user_id AND budget_reservation_id=p_budget_reservation_id
    AND render_job_id=p_render_job_id AND daily_plan_slot_id=p_daily_plan_slot_id
    AND slot_attempt=p_slot_attempt AND work_handoff_digest=p_work_handoff_digest
    AND action=p_action AND command_id=p_command_id AND command_digest=p_command_digest
    AND consumed_at IS NOT NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'exact one-video finalizer capability denied'; END IF;
  IF pg_catalog.has_table_privilege(SESSION_USER,'public.ai_media_exact_one_video_run_capabilities',
      'SELECT,INSERT,UPDATE,DELETE')
    OR pg_catalog.has_table_privilege(SESSION_USER,'public.ai_media_exact_one_video_run_fences',
      'SELECT,INSERT,UPDATE,DELETE')
  THEN RAISE EXCEPTION 'exact one-video executor must remain table-blind'; END IF;
  RETURN capability;
END
$function$;

CREATE FUNCTION ai_media_worker_api.complete_exact_one_video_run_v1(
  p_capability_id uuid,p_owner_user_id text,p_workspace_id text,p_execution_id uuid,
  p_command_id text,p_command_digest text,p_fencing_token bigint,p_lease_token uuid,
  p_budget_reservation_id uuid,p_render_job_id uuid,p_daily_plan_slot_id uuid,p_slot_attempt integer,
  p_work_handoff_digest text,p_action text,p_outcome text
) RETURNS TABLE(applied boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET row_security=on AS $function$
DECLARE run_row public.ai_media_exact_one_video_run_fences%ROWTYPE;
  capability public.ai_media_exact_one_video_run_capabilities%ROWTYPE;
  sampled_at timestamptz:=pg_catalog.clock_timestamp(); result_evidence text;
BEGIN
  SELECT * INTO run_row FROM public.ai_media_exact_one_video_run_fences
  WHERE id=p_execution_id AND owner_user_id=p_owner_user_id AND workspace_id=p_workspace_id
    AND capability_id=p_capability_id AND command_id=p_command_id AND command_digest=p_command_digest
    AND fencing_token=p_fencing_token AND lease_token=p_lease_token AND state='running'
    AND lease_expires_at>sampled_at FOR UPDATE;
  IF NOT FOUND THEN RETURN QUERY SELECT false; RETURN; END IF;
  capability=ai_media_worker_api.require_exact_one_video_run_finalizer_v1(p_capability_id,
    p_owner_user_id,p_workspace_id,run_row.actor_user_id,p_budget_reservation_id,p_render_job_id,
    p_daily_plan_slot_id,p_slot_attempt,p_work_handoff_digest,p_action,p_command_id,p_command_digest);
  IF ROW(run_row.budget_reservation_id,run_row.render_job_id,run_row.daily_plan_slot_id,
      run_row.slot_attempt,run_row.work_handoff_digest,run_row.action)
    IS DISTINCT FROM ROW(p_budget_reservation_id,p_render_job_id,p_daily_plan_slot_id,
      p_slot_attempt,p_work_handoff_digest,p_action)
  THEN RETURN QUERY SELECT false; RETURN; END IF;
  IF NOT ((p_action='activate_and_submit' AND p_outcome IN ('confirmed','ambiguous','idle','authorization_lost'))
    OR (p_action='reconcile_submission' AND p_outcome IN ('confirmed','ambiguous','reconciled_no_submit','idle','authorization_lost'))
    OR (p_action='observe_terminal' AND p_outcome IN ('processing','completed','failed','idle','authorization_lost'))
    OR (p_action='ingest_asset' AND p_outcome IN ('asset_completed','asset_completed_unlinked',
      'retry_scheduled','dead_letter','lease_lost','idle','authorization_lost'))
    OR (p_action='link_asset' AND p_outcome IN ('asset_linked','asset_completed_unlinked','idle','authorization_lost')))
  THEN RETURN QUERY SELECT false; RETURN; END IF;
  result_evidence=ai_media_worker_api.sha256_text_v1('exact-one-video-result:v1:'||p_execution_id::text||
    ':'||p_command_digest||':'||p_fencing_token::text||':'||p_action||':'||p_outcome);
  UPDATE public.ai_media_exact_one_video_run_fences SET state='completed',lease_token=NULL,
    lease_owner=NULL,lease_expires_at=NULL,outcome=p_outcome,result_digest=result_evidence,
    completed_at=sampled_at,updated_at=sampled_at WHERE id=p_execution_id;
  RETURN QUERY SELECT true;
END
$function$;

CREATE FUNCTION ai_media_worker_api.seal_exact_one_video_run_uncertain_v1(
  p_capability_id uuid,p_owner_user_id text,p_workspace_id text,p_execution_id uuid,
  p_command_id text,p_command_digest text,p_fencing_token bigint,p_lease_token uuid,
  p_error_digest text
) RETURNS TABLE(applied boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET row_security=on AS $function$
DECLARE run_row public.ai_media_exact_one_video_run_fences%ROWTYPE;
  capability public.ai_media_exact_one_video_run_capabilities%ROWTYPE;
  sampled_at timestamptz:=pg_catalog.clock_timestamp();
BEGIN
  IF p_error_digest!~'^sha256:[0-9a-f]{64}$' THEN RETURN QUERY SELECT false; RETURN; END IF;
  SELECT * INTO run_row FROM public.ai_media_exact_one_video_run_fences
  WHERE id=p_execution_id AND owner_user_id=p_owner_user_id AND workspace_id=p_workspace_id
    AND capability_id=p_capability_id AND command_id=p_command_id AND command_digest=p_command_digest
    AND fencing_token=p_fencing_token AND lease_token=p_lease_token AND state='running'
  FOR UPDATE;
  IF NOT FOUND THEN RETURN QUERY SELECT false; RETURN; END IF;
  capability=ai_media_worker_api.require_exact_one_video_run_finalizer_v1(p_capability_id,
    p_owner_user_id,p_workspace_id,run_row.actor_user_id,run_row.budget_reservation_id,
    run_row.render_job_id,run_row.daily_plan_slot_id,run_row.slot_attempt,run_row.work_handoff_digest,
    run_row.action,run_row.command_id,run_row.command_digest);
  UPDATE public.ai_media_exact_one_video_run_fences SET state='uncertain',lease_token=NULL,
    lease_owner=NULL,lease_expires_at=NULL,uncertain_error_digest=p_error_digest,
    uncertain_at=sampled_at,updated_at=sampled_at WHERE id=p_execution_id;
  RETURN QUERY SELECT true;
END
$function$;

GRANT SELECT,INSERT,UPDATE ON TABLE public.ai_media_exact_one_video_run_capabilities,
  public.ai_media_exact_one_video_run_fences TO ai_media_admitted_fn_owner;
REVOKE ALL ON TABLE public.ai_media_exact_one_video_run_capabilities,
  public.ai_media_exact_one_video_run_fences
  FROM PUBLIC,ai_media_one_video_run_executor,ai_media_admitted_submit_executor,
    ai_media_admitted_reconcile_executor;
GRANT USAGE ON SCHEMA ai_media_worker_api TO ai_media_one_video_run_executor;

ALTER FUNCTION public.ai_media_guard_exact_one_video_run_capability() OWNER TO ai_media_admitted_fn_owner;
ALTER FUNCTION public.ai_media_guard_exact_one_video_run_fence() OWNER TO ai_media_admitted_fn_owner;
ALTER FUNCTION ai_media_worker_api.require_exact_one_video_run_capability_v1(
  uuid,text,text,text,uuid,uuid,uuid,integer,text,text,text,text,integer) OWNER TO ai_media_admitted_fn_owner;
ALTER FUNCTION ai_media_worker_api.acquire_exact_one_video_run_v1(
  uuid,text,text,uuid,uuid,uuid,integer,text,text,text,text,text,integer) OWNER TO ai_media_admitted_fn_owner;
ALTER FUNCTION ai_media_worker_api.require_exact_one_video_run_finalizer_v1(
  uuid,text,text,text,uuid,uuid,uuid,integer,text,text,text,text) OWNER TO ai_media_admitted_fn_owner;
ALTER FUNCTION ai_media_worker_api.complete_exact_one_video_run_v1(
  uuid,text,text,uuid,text,text,bigint,uuid,uuid,uuid,uuid,integer,text,text,text) OWNER TO ai_media_admitted_fn_owner;
ALTER FUNCTION ai_media_worker_api.seal_exact_one_video_run_uncertain_v1(
  uuid,text,text,uuid,text,text,bigint,uuid,text) OWNER TO ai_media_admitted_fn_owner;

REVOKE ALL ON FUNCTION ai_media_worker_api.require_exact_one_video_run_capability_v1(
  uuid,text,text,text,uuid,uuid,uuid,integer,text,text,text,text,integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION ai_media_worker_api.acquire_exact_one_video_run_v1(
  uuid,text,text,uuid,uuid,uuid,integer,text,text,text,text,text,integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION ai_media_worker_api.require_exact_one_video_run_finalizer_v1(
  uuid,text,text,text,uuid,uuid,uuid,integer,text,text,text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION ai_media_worker_api.complete_exact_one_video_run_v1(
  uuid,text,text,uuid,text,text,bigint,uuid,uuid,uuid,uuid,integer,text,text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION ai_media_worker_api.seal_exact_one_video_run_uncertain_v1(
  uuid,text,text,uuid,text,text,bigint,uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION ai_media_worker_api.acquire_exact_one_video_run_v1(
  uuid,text,text,uuid,uuid,uuid,integer,text,text,text,text,text,integer)
  TO ai_media_one_video_run_executor;
GRANT EXECUTE ON FUNCTION ai_media_worker_api.complete_exact_one_video_run_v1(
  uuid,text,text,uuid,text,text,bigint,uuid,uuid,uuid,uuid,integer,text,text,text)
  TO ai_media_one_video_run_executor;
GRANT EXECUTE ON FUNCTION ai_media_worker_api.seal_exact_one_video_run_uncertain_v1(
  uuid,text,text,uuid,text,text,bigint,uuid,text)
  TO ai_media_one_video_run_executor;

COMMIT;
