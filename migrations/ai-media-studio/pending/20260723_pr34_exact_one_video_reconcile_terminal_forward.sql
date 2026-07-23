-- AI Media Studio PR34: exact one-video reconciliation and terminal-observation surface.
-- Review artifact only. Do not apply automatically.
-- PostgreSQL 16 only. This migration performs no provider request, download, publication, or deploy I/O.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='15min';
SET LOCAL search_path=pg_catalog;

DO $preflight$
DECLARE role_row record;
BEGIN
  SELECT * INTO role_row FROM pg_catalog.pg_roles WHERE rolname='ai_media_one_video_run_executor';
  IF NOT FOUND OR role_row.rolcanlogin OR role_row.rolsuper OR role_row.rolinherit
    OR role_row.rolcreaterole OR role_row.rolcreatedb OR role_row.rolreplication OR role_row.rolbypassrls
  THEN RAISE EXCEPTION 'PR34 requires safe precreated NOLOGIN NOINHERIT ai_media_one_video_run_executor'; END IF;
  IF current_setting('server_version_num')::integer<160000
    OR to_regclass('public.ai_media_exact_one_video_run_capabilities') IS NULL
    OR to_regclass('public.ai_media_exact_one_video_run_fences') IS NULL
    OR to_regclass('public.ai_media_provider_submission_attempts') IS NULL
    OR to_regclass('public.ai_media_provider_terminal_checks') IS NULL
    OR to_regclass('public.ai_media_provider_terminal_events') IS NULL
    OR to_regclass('public.ai_media_admitted_worker_capabilities') IS NULL
    OR to_regprocedure('ai_media_worker_api.claim_reconciliation_v1(uuid,text,text,text,integer)') IS NULL
    OR to_regprocedure('ai_media_worker_api.release_reconciliation_unknown_v1(uuid,text,text,uuid,uuid,bigint,text,uuid,bigint)') IS NULL
    OR to_regprocedure('ai_media_worker_api.record_reconciled_confirmed_v1(uuid,text,text,uuid,uuid,bigint,text,uuid,bigint,text,text,text)') IS NULL
    OR to_regprocedure('ai_media_worker_api.finalize_reconciled_no_submit_v1(uuid,text,text,uuid,uuid,bigint,text,uuid,bigint,text,uuid,text,integer,text,timestamptz,text)') IS NULL
    OR to_regprocedure('ai_media_worker_api.claim_terminal_check_v1(uuid,text,text,text,integer)') IS NULL
    OR to_regprocedure('ai_media_worker_api.release_terminal_check_unknown_v1(uuid,text,text,uuid,uuid,bigint,text,timestamptz,text)') IS NULL
    OR to_regprocedure('ai_media_worker_api.record_provider_terminal_v1(uuid,text,text,uuid,uuid,bigint,uuid,bigint,text,uuid,text,integer,text,text,text,text,timestamptz,text)') IS NULL
    OR to_regprocedure('ai_media_worker_api.require_exact_one_video_reconcile_context_v1(uuid,uuid,bigint,text,text,text,text,uuid,uuid,uuid,integer,text,text,text,text,integer)') IS NOT NULL
    OR to_regprocedure('ai_media_worker_api.claim_exact_one_video_reconciliation_v1(uuid,uuid,bigint,text,text,text,text,uuid,uuid,uuid,integer,text,text,integer)') IS NOT NULL
    OR to_regprocedure('ai_media_worker_api.release_exact_one_video_reconciliation_unknown_v1(uuid,uuid,bigint,text,text,text,text,uuid,uuid,uuid,integer,text,uuid,bigint,text,uuid,bigint)') IS NOT NULL
    OR to_regprocedure('ai_media_worker_api.record_exact_one_video_reconciled_confirmed_v1(uuid,uuid,bigint,text,text,text,text,uuid,uuid,uuid,integer,text,uuid,bigint,text,uuid,bigint,text,text,text)') IS NOT NULL
    OR to_regprocedure('ai_media_worker_api.finalize_exact_one_video_reconciled_no_submit_v1(uuid,uuid,bigint,text,text,text,text,uuid,uuid,uuid,integer,text,uuid,bigint,text,uuid,bigint,text,uuid,text,integer,text,timestamptz,text)') IS NOT NULL
    OR to_regprocedure('ai_media_worker_api.claim_exact_one_video_terminal_check_v1(uuid,uuid,bigint,text,text,text,text,uuid,uuid,uuid,integer,text,text,integer)') IS NOT NULL
    OR to_regprocedure('ai_media_worker_api.release_exact_one_video_terminal_check_unknown_v1(uuid,uuid,bigint,text,text,text,text,uuid,uuid,uuid,integer,text,uuid,uuid,bigint,text,timestamptz,text)') IS NOT NULL
    OR to_regprocedure('ai_media_worker_api.record_exact_one_video_provider_terminal_v1(uuid,uuid,bigint,text,text,text,text,uuid,uuid,uuid,integer,text,uuid,uuid,bigint,uuid,bigint,text,uuid,text,integer,text,text,text,text,timestamptz,text)') IS NOT NULL
  THEN RAISE EXCEPTION 'PR34 requires exact PR26, PR27, and PR32 surfaces and an unused PR34 surface'; END IF;
END
$preflight$;

CREATE FUNCTION ai_media_worker_api.require_exact_one_video_reconcile_context_v1(
  p_execution_id uuid,p_run_lease_token uuid,p_run_fencing_token bigint,p_command_digest text,
  p_actor_user_id text,p_owner_user_id text,p_workspace_id text,p_budget_reservation_id uuid,
  p_render_job_id uuid,p_daily_plan_slot_id uuid,p_slot_attempt integer,p_work_handoff_digest text,
  p_action text,p_operation text,p_worker_id text DEFAULT NULL,p_lease_ms integer DEFAULT NULL
) RETURNS TABLE(capability_id uuid,accounting_time_zone text,admitted_actor_user_id text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET row_security=on AS $function$
DECLARE reconcile_capability public.ai_media_admitted_worker_capabilities%ROWTYPE;
  authority record;sampled_at timestamptz:=pg_catalog.clock_timestamp();matching_capabilities integer;
BEGIN
  IF p_action NOT IN ('reconcile_submission','observe_terminal')
    OR (p_action='reconcile_submission' AND p_operation NOT IN ('claim_reconciliation',
      'release_reconciliation_unknown','record_reconciled_confirmed','finalize_reconciled_no_submit'))
    OR (p_action='observe_terminal' AND p_operation NOT IN ('claim_terminal_check',
      'release_terminal_check_unknown','record_provider_terminal'))
    OR p_command_digest!~'^sha256:[0-9a-f]{64}$'
    OR p_work_handoff_digest!~'^sha256:[0-9a-f]{64}$'
  THEN RAISE EXCEPTION 'invalid exact reconciliation context'; END IF;
  IF EXISTS (
    SELECT 1 FROM pg_catalog.unnest(ARRAY[
      'public.ai_media_exact_one_video_run_capabilities',
      'public.ai_media_exact_one_video_run_fences',
      'public.ai_media_admitted_worker_capabilities',
      'public.ai_media_provider_submission_attempts',
      'public.ai_media_provider_submission_events',
      'public.ai_media_provider_terminal_checks',
      'public.ai_media_provider_terminal_events',
      'public.ai_media_submission_capacity_leases',
      'public.ai_media_asset_ingest_jobs']::text[]) protected(table_name)
    WHERE pg_catalog.has_table_privilege(SESSION_USER,protected.table_name,'SELECT')
      OR pg_catalog.has_table_privilege(SESSION_USER,protected.table_name,'INSERT')
      OR pg_catalog.has_table_privilege(SESSION_USER,protected.table_name,'UPDATE')
      OR pg_catalog.has_table_privilege(SESSION_USER,protected.table_name,'DELETE')
      OR pg_catalog.has_table_privilege(SESSION_USER,protected.table_name,'TRUNCATE')
      OR pg_catalog.has_table_privilege(SESSION_USER,protected.table_name,'REFERENCES')
      OR pg_catalog.has_table_privilege(SESSION_USER,protected.table_name,'TRIGGER')
  ) THEN RAISE EXCEPTION 'exact one-video reconcile executor must remain table-blind' USING ERRCODE='42501'; END IF;

  PERFORM 1
  FROM public.ai_media_exact_one_video_run_fences fence
  JOIN public.ai_media_exact_one_video_run_capabilities exact_capability
    ON exact_capability.id=fence.capability_id AND exact_capability.database_principal=SESSION_USER
  WHERE fence.id=p_execution_id
    AND fence.owner_user_id=p_owner_user_id AND fence.workspace_id=p_workspace_id
    AND fence.actor_user_id=p_actor_user_id AND fence.budget_reservation_id=p_budget_reservation_id
    AND fence.render_job_id=p_render_job_id AND fence.daily_plan_slot_id=p_daily_plan_slot_id
    AND fence.slot_attempt=p_slot_attempt AND fence.work_handoff_digest=p_work_handoff_digest
    AND fence.action=p_action AND fence.command_digest=p_command_digest AND fence.state='running'
    AND fence.fencing_token=p_run_fencing_token AND fence.lease_token=p_run_lease_token
    AND fence.lease_owner=p_actor_user_id AND fence.lease_expires_at>sampled_at
  FOR UPDATE OF fence,exact_capability;
  IF NOT FOUND THEN RAISE EXCEPTION 'live exact one-video reconcile execution denied' USING ERRCODE='42501'; END IF;

  SELECT pg_catalog.count(*) INTO matching_capabilities
  FROM public.ai_media_admitted_worker_capabilities capability
  WHERE capability.database_principal=SESSION_USER
    AND capability.owner_user_id=p_owner_user_id AND capability.workspace_id=p_workspace_id
    AND capability.lane='reconcile' AND p_operation=ANY(capability.allowed_operations)
    AND (p_worker_id IS NULL OR capability.worker_id=p_worker_id)
    AND (p_lease_ms IS NULL OR p_lease_ms BETWEEN 1 AND capability.max_lease_ms)
    AND capability.valid_from<=sampled_at AND capability.expires_at>sampled_at
    AND capability.revoked_at IS NULL;
  IF matching_capabilities<>1 THEN
    RAISE EXCEPTION 'exact reconcile requires exactly one live admitted capability' USING ERRCODE='42501';
  END IF;
  SELECT * INTO reconcile_capability
  FROM public.ai_media_admitted_worker_capabilities capability
  WHERE capability.database_principal=SESSION_USER
    AND capability.owner_user_id=p_owner_user_id AND capability.workspace_id=p_workspace_id
    AND capability.lane='reconcile' AND p_operation=ANY(capability.allowed_operations)
    AND (p_worker_id IS NULL OR capability.worker_id=p_worker_id)
    AND (p_lease_ms IS NULL OR p_lease_ms BETWEEN 1 AND capability.max_lease_ms)
    AND capability.valid_from<=sampled_at AND capability.expires_at>sampled_at
    AND capability.revoked_at IS NULL
  FOR UPDATE;
  SELECT * INTO authority FROM ai_media_worker_api.require_capability_v1(
    reconcile_capability.id,p_owner_user_id,p_workspace_id,'reconcile',p_operation,p_worker_id,p_lease_ms,NULL);
  RETURN QUERY SELECT reconcile_capability.id,authority.accounting_time_zone,authority.actor_user_id;
END
$function$;

CREATE FUNCTION ai_media_worker_api.claim_exact_one_video_reconciliation_v1(
  p_execution_id uuid,p_run_lease_token uuid,p_run_fencing_token bigint,p_command_digest text,
  p_actor_user_id text,p_owner_user_id text,p_workspace_id text,p_budget_reservation_id uuid,
  p_render_job_id uuid,p_daily_plan_slot_id uuid,p_slot_attempt integer,p_work_handoff_digest text,
  p_worker_id text,p_lease_ms integer
) RETURNS TABLE(
  execution_id uuid,run_lease_token uuid,run_fencing_token bigint,command_digest text,actor_user_id text,
  owner_user_id text,workspace_id text,budget_reservation_id uuid,render_job_id uuid,
  daily_plan_slot_id uuid,slot_attempt integer,work_handoff_digest text,id uuid,
  provider_account_id uuid,provider_key text,provider_credential_version integer,
  provider_idempotency_key text,avatar_external_resource_id text,voice_external_resource_id text,
  sealed_request_digest text,fencing_token bigint,send_authorization_digest text,commit_evidence_digest text,
  authorized_at timestamptz,reconciliation_lease_token uuid,reconciliation_lease_owner text,
  reconciliation_fencing_token bigint,reconciliation_lease_expires_at timestamptz,request_json jsonb
) LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET row_security=on AS $function$
#variable_conflict use_column
DECLARE context record;attempt public.ai_media_provider_submission_attempts%ROWTYPE;
  sampled_at timestamptz:=pg_catalog.clock_timestamp();new_lease uuid:=pg_catalog.gen_random_uuid();
  evidence text;next_sequence integer;
BEGIN
  SELECT * INTO context FROM ai_media_worker_api.require_exact_one_video_reconcile_context_v1(
    p_execution_id,p_run_lease_token,p_run_fencing_token,p_command_digest,p_actor_user_id,
    p_owner_user_id,p_workspace_id,p_budget_reservation_id,p_render_job_id,p_daily_plan_slot_id,
    p_slot_attempt,p_work_handoff_digest,'reconcile_submission','claim_reconciliation',p_worker_id,p_lease_ms);
  SET CONSTRAINTS ALL DEFERRED;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'ai-media:admitted-reservation:'||p_owner_user_id||':'||p_workspace_id||':'||p_budget_reservation_id::text,0));
  SELECT candidate.* INTO attempt
  FROM public.ai_media_provider_submission_attempts candidate
  JOIN public.ai_media_render_jobs job ON job.id=p_render_job_id
    AND job.id=candidate.render_job_id AND job.owner_user_id=candidate.owner_user_id
    AND job.workspace_id=candidate.workspace_id AND job.budget_reservation_id=candidate.budget_reservation_id
    AND job.daily_plan_slot_id=p_daily_plan_slot_id AND job.slot_attempt=p_slot_attempt
    AND job.work_handoff_digest=p_work_handoff_digest
  WHERE candidate.owner_user_id=p_owner_user_id AND candidate.workspace_id=p_workspace_id
    AND candidate.budget_reservation_id=p_budget_reservation_id
    AND candidate.render_job_id=p_render_job_id AND candidate.daily_plan_slot_id=p_daily_plan_slot_id
    AND candidate.slot_attempt=p_slot_attempt AND candidate.work_handoff_digest=p_work_handoff_digest
    AND candidate.state='ambiguous'
    AND (candidate.reconciliation_lease_token IS NULL OR candidate.reconciliation_lease_expires_at<=sampled_at)
  FOR UPDATE OF candidate,job;
  IF NOT FOUND THEN RETURN; END IF;
  UPDATE public.ai_media_provider_submission_attempts candidate
  SET reconciliation_lease_token=new_lease,reconciliation_lease_owner=context.admitted_actor_user_id,
    reconciliation_lease_expires_at=sampled_at+(p_lease_ms::text||' milliseconds')::interval,
    reconciliation_fencing_token=candidate.reconciliation_fencing_token+1,updated_at=sampled_at
  WHERE candidate.id=attempt.id AND candidate.owner_user_id=p_owner_user_id
    AND candidate.workspace_id=p_workspace_id AND candidate.budget_reservation_id=p_budget_reservation_id
    AND candidate.render_job_id=p_render_job_id AND candidate.daily_plan_slot_id=p_daily_plan_slot_id
    AND candidate.slot_attempt=p_slot_attempt AND candidate.work_handoff_digest=p_work_handoff_digest
    AND candidate.state='ambiguous'
    AND (candidate.reconciliation_lease_token IS NULL OR candidate.reconciliation_lease_expires_at<=sampled_at)
  RETURNING * INTO attempt;
  IF NOT FOUND THEN RETURN; END IF;
  evidence=ai_media_worker_api.sha256_text_v1('reconciliation-claimed:v1:'||attempt.id::text||':'||
    attempt.reconciliation_fencing_token::text||':'||new_lease::text);
  SELECT COALESCE(pg_catalog.max(event.sequence),0)+1 INTO next_sequence
  FROM public.ai_media_provider_submission_events event WHERE event.submission_attempt_id=attempt.id;
  INSERT INTO public.ai_media_provider_submission_events(owner_user_id,workspace_id,submission_attempt_id,
    budget_reservation_id,sequence,event_kind,fencing_token,reconciliation_fencing_token,evidence_digest,
    actor_user_id,observed_at,created_at)
  VALUES(p_owner_user_id,p_workspace_id,attempt.id,p_budget_reservation_id,next_sequence,
    'reconciliation_claimed',attempt.fencing_token,attempt.reconciliation_fencing_token,evidence,
    context.admitted_actor_user_id,sampled_at,sampled_at);
  RETURN QUERY SELECT p_execution_id,p_run_lease_token,p_run_fencing_token,p_command_digest,p_actor_user_id,
    p_owner_user_id,p_workspace_id,p_budget_reservation_id,p_render_job_id,p_daily_plan_slot_id,
    p_slot_attempt,p_work_handoff_digest,attempt.id,attempt.provider_account_id,attempt.provider_key,
    attempt.provider_credential_version,attempt.provider_idempotency_key,attempt.avatar_external_resource_id,
    attempt.voice_external_resource_id,attempt.sealed_request_digest,attempt.fencing_token,
    attempt.send_authorization_digest,attempt.commit_evidence_digest,attempt.authorized_at,
    attempt.reconciliation_lease_token,attempt.reconciliation_lease_owner,
    attempt.reconciliation_fencing_token,attempt.reconciliation_lease_expires_at,job.request
  FROM public.ai_media_render_jobs job
  WHERE job.id=p_render_job_id AND job.owner_user_id=p_owner_user_id AND job.workspace_id=p_workspace_id
    AND job.budget_reservation_id=p_budget_reservation_id AND job.daily_plan_slot_id=p_daily_plan_slot_id
    AND job.slot_attempt=p_slot_attempt AND job.work_handoff_digest=p_work_handoff_digest;
END
$function$;

CREATE FUNCTION ai_media_worker_api.release_exact_one_video_reconciliation_unknown_v1(
  p_execution_id uuid,p_run_lease_token uuid,p_run_fencing_token bigint,p_command_digest text,
  p_actor_user_id text,p_owner_user_id text,p_workspace_id text,p_budget_reservation_id uuid,
  p_render_job_id uuid,p_daily_plan_slot_id uuid,p_slot_attempt integer,p_work_handoff_digest text,
  p_attempt_id uuid,p_submission_fencing_token bigint,p_authorization_digest text,
  p_reconciliation_lease_token uuid,p_reconciliation_fencing_token bigint
) RETURNS TABLE(
  execution_id uuid,run_lease_token uuid,run_fencing_token bigint,command_digest text,actor_user_id text,
  owner_user_id text,workspace_id text,budget_reservation_id uuid,render_job_id uuid,
  daily_plan_slot_id uuid,slot_attempt integer,work_handoff_digest text,applied boolean
) LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET row_security=on AS $function$
DECLARE context record;sampled_at timestamptz:=pg_catalog.clock_timestamp();
  release_evidence text;
BEGIN
  SELECT * INTO context FROM ai_media_worker_api.require_exact_one_video_reconcile_context_v1(
    p_execution_id,p_run_lease_token,p_run_fencing_token,p_command_digest,p_actor_user_id,
    p_owner_user_id,p_workspace_id,p_budget_reservation_id,p_render_job_id,p_daily_plan_slot_id,
    p_slot_attempt,p_work_handoff_digest,'reconcile_submission','release_reconciliation_unknown',NULL,NULL);
  PERFORM 1 FROM public.ai_media_provider_submission_attempts attempt
  WHERE attempt.id=p_attempt_id AND attempt.owner_user_id=p_owner_user_id
    AND attempt.workspace_id=p_workspace_id AND attempt.budget_reservation_id=p_budget_reservation_id
    AND attempt.render_job_id=p_render_job_id AND attempt.daily_plan_slot_id=p_daily_plan_slot_id
    AND attempt.slot_attempt=p_slot_attempt AND attempt.work_handoff_digest=p_work_handoff_digest
    AND attempt.state='ambiguous'
    AND attempt.fencing_token=p_submission_fencing_token
    AND attempt.send_authorization_digest=p_authorization_digest
    AND attempt.reconciliation_lease_token=p_reconciliation_lease_token
    AND attempt.reconciliation_lease_owner=context.admitted_actor_user_id
    AND attempt.reconciliation_fencing_token=p_reconciliation_fencing_token
    AND attempt.reconciliation_lease_expires_at>sampled_at FOR UPDATE;
  IF NOT FOUND THEN
    release_evidence=ai_media_worker_api.sha256_text_v1('reconciliation-released:v1:'||p_attempt_id::text||':'||
      p_authorization_digest||':'||p_reconciliation_fencing_token::text||':'||context.admitted_actor_user_id);
    PERFORM 1 FROM public.ai_media_provider_submission_attempts attempt
    JOIN public.ai_media_provider_submission_events event
      ON event.submission_attempt_id=attempt.id AND event.owner_user_id=attempt.owner_user_id
     AND event.workspace_id=attempt.workspace_id AND event.budget_reservation_id=attempt.budget_reservation_id
    WHERE attempt.id=p_attempt_id AND attempt.owner_user_id=p_owner_user_id
      AND attempt.workspace_id=p_workspace_id AND attempt.budget_reservation_id=p_budget_reservation_id
      AND attempt.render_job_id=p_render_job_id AND attempt.daily_plan_slot_id=p_daily_plan_slot_id
      AND attempt.slot_attempt=p_slot_attempt AND attempt.work_handoff_digest=p_work_handoff_digest
      AND attempt.state='ambiguous'
      AND attempt.fencing_token=p_submission_fencing_token
      AND attempt.send_authorization_digest=p_authorization_digest
      AND attempt.reconciliation_lease_token IS NULL
      AND attempt.reconciliation_lease_owner IS NULL
      AND attempt.reconciliation_fencing_token=p_reconciliation_fencing_token
      AND event.event_kind='reconciliation_released'
      AND event.fencing_token=p_submission_fencing_token
      AND event.reconciliation_fencing_token=p_reconciliation_fencing_token
      AND event.evidence_digest=release_evidence
      AND event.actor_user_id=context.admitted_actor_user_id;
    IF FOUND THEN
      RETURN QUERY SELECT p_execution_id,p_run_lease_token,p_run_fencing_token,p_command_digest,p_actor_user_id,
        p_owner_user_id,p_workspace_id,p_budget_reservation_id,p_render_job_id,p_daily_plan_slot_id,
        p_slot_attempt,p_work_handoff_digest,true;RETURN;
    END IF;
    RETURN QUERY SELECT p_execution_id,p_run_lease_token,p_run_fencing_token,p_command_digest,p_actor_user_id,
      p_owner_user_id,p_workspace_id,p_budget_reservation_id,p_render_job_id,p_daily_plan_slot_id,
      p_slot_attempt,p_work_handoff_digest,false;RETURN;
  END IF;
  RETURN QUERY SELECT p_execution_id,p_run_lease_token,p_run_fencing_token,p_command_digest,p_actor_user_id,
    p_owner_user_id,p_workspace_id,p_budget_reservation_id,p_render_job_id,p_daily_plan_slot_id,
    p_slot_attempt,p_work_handoff_digest,result.applied
  FROM ai_media_worker_api.release_reconciliation_unknown_v1(context.capability_id,p_owner_user_id,
    p_workspace_id,p_attempt_id,p_budget_reservation_id,p_submission_fencing_token,p_authorization_digest,
    p_reconciliation_lease_token,p_reconciliation_fencing_token) result;
END
$function$;

CREATE FUNCTION ai_media_worker_api.record_exact_one_video_reconciled_confirmed_v1(
  p_execution_id uuid,p_run_lease_token uuid,p_run_fencing_token bigint,p_command_digest text,
  p_actor_user_id text,p_owner_user_id text,p_workspace_id text,p_budget_reservation_id uuid,
  p_render_job_id uuid,p_daily_plan_slot_id uuid,p_slot_attempt integer,p_work_handoff_digest text,
  p_attempt_id uuid,p_submission_fencing_token bigint,p_authorization_digest text,
  p_reconciliation_lease_token uuid,p_reconciliation_fencing_token bigint,
  p_provider_job_id text,p_provider_request_id text,p_evidence_digest text
) RETURNS TABLE(
  execution_id uuid,run_lease_token uuid,run_fencing_token bigint,command_digest text,actor_user_id text,
  owner_user_id text,workspace_id text,budget_reservation_id uuid,render_job_id uuid,
  daily_plan_slot_id uuid,slot_attempt integer,work_handoff_digest text,applied boolean
) LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET row_security=on AS $function$
DECLARE context record;attempt public.ai_media_provider_submission_attempts%ROWTYPE;
  sampled_at timestamptz:=pg_catalog.clock_timestamp();equivalent_replay boolean:=false;
BEGIN
  SELECT * INTO context FROM ai_media_worker_api.require_exact_one_video_reconcile_context_v1(
    p_execution_id,p_run_lease_token,p_run_fencing_token,p_command_digest,p_actor_user_id,
    p_owner_user_id,p_workspace_id,p_budget_reservation_id,p_render_job_id,p_daily_plan_slot_id,
    p_slot_attempt,p_work_handoff_digest,'reconcile_submission','record_reconciled_confirmed',NULL,NULL);
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'ai-media:admitted-reservation:'||p_owner_user_id||':'||p_workspace_id||':'||p_budget_reservation_id::text,0));
  SELECT candidate.* INTO attempt FROM public.ai_media_provider_submission_attempts candidate
  WHERE candidate.id=p_attempt_id AND candidate.owner_user_id=p_owner_user_id
    AND candidate.workspace_id=p_workspace_id AND candidate.budget_reservation_id=p_budget_reservation_id
    AND candidate.render_job_id=p_render_job_id AND candidate.daily_plan_slot_id=p_daily_plan_slot_id
    AND candidate.slot_attempt=p_slot_attempt AND candidate.work_handoff_digest=p_work_handoff_digest
    AND candidate.fencing_token=p_submission_fencing_token
    AND candidate.send_authorization_digest=p_authorization_digest FOR UPDATE;
  IF FOUND AND attempt.state='confirmed' THEN
    SELECT EXISTS (
      SELECT 1 FROM public.ai_media_provider_submission_events event
      WHERE event.owner_user_id=p_owner_user_id AND event.workspace_id=p_workspace_id
        AND event.submission_attempt_id=p_attempt_id AND event.budget_reservation_id=p_budget_reservation_id
        AND event.event_kind='confirmed' AND event.fencing_token=p_submission_fencing_token
        AND event.evidence_digest=p_evidence_digest AND event.provider_job_id=p_provider_job_id
        AND event.provider_request_id IS NOT DISTINCT FROM p_provider_request_id
        AND event.actor_user_id=context.admitted_actor_user_id
    ) AND attempt.provider_job_id=p_provider_job_id
      AND attempt.provider_request_id IS NOT DISTINCT FROM p_provider_request_id
      AND attempt.confirmed_evidence_digest=p_evidence_digest
      AND attempt.reconciliation_fencing_token=p_reconciliation_fencing_token
    INTO equivalent_replay;
    RETURN QUERY SELECT p_execution_id,p_run_lease_token,p_run_fencing_token,p_command_digest,p_actor_user_id,
      p_owner_user_id,p_workspace_id,p_budget_reservation_id,p_render_job_id,p_daily_plan_slot_id,
      p_slot_attempt,p_work_handoff_digest,equivalent_replay;RETURN;
  ELSIF FOUND AND attempt.state<>'ambiguous' THEN
    RETURN QUERY SELECT p_execution_id,p_run_lease_token,p_run_fencing_token,p_command_digest,p_actor_user_id,
      p_owner_user_id,p_workspace_id,p_budget_reservation_id,p_render_job_id,p_daily_plan_slot_id,
      p_slot_attempt,p_work_handoff_digest,false;RETURN;
  END IF;
  PERFORM 1 FROM public.ai_media_provider_submission_attempts live_attempt
  WHERE live_attempt.id=p_attempt_id AND live_attempt.owner_user_id=p_owner_user_id
    AND live_attempt.workspace_id=p_workspace_id
    AND live_attempt.budget_reservation_id=p_budget_reservation_id
    AND live_attempt.render_job_id=p_render_job_id AND live_attempt.daily_plan_slot_id=p_daily_plan_slot_id
    AND live_attempt.slot_attempt=p_slot_attempt AND live_attempt.work_handoff_digest=p_work_handoff_digest
    AND live_attempt.state='ambiguous'
    AND live_attempt.fencing_token=p_submission_fencing_token
    AND live_attempt.send_authorization_digest=p_authorization_digest
    AND live_attempt.reconciliation_lease_token=p_reconciliation_lease_token
    AND live_attempt.reconciliation_lease_owner=context.admitted_actor_user_id
    AND live_attempt.reconciliation_fencing_token=p_reconciliation_fencing_token
    AND live_attempt.reconciliation_lease_expires_at>sampled_at FOR UPDATE;
  IF NOT FOUND THEN
    RETURN QUERY SELECT p_execution_id,p_run_lease_token,p_run_fencing_token,p_command_digest,p_actor_user_id,
      p_owner_user_id,p_workspace_id,p_budget_reservation_id,p_render_job_id,p_daily_plan_slot_id,
      p_slot_attempt,p_work_handoff_digest,false;RETURN;
  END IF;
  RETURN QUERY SELECT p_execution_id,p_run_lease_token,p_run_fencing_token,p_command_digest,p_actor_user_id,
    p_owner_user_id,p_workspace_id,p_budget_reservation_id,p_render_job_id,p_daily_plan_slot_id,
    p_slot_attempt,p_work_handoff_digest,result.applied
  FROM ai_media_worker_api.record_reconciled_confirmed_v1(context.capability_id,p_owner_user_id,
    p_workspace_id,p_attempt_id,p_budget_reservation_id,p_submission_fencing_token,p_authorization_digest,
    p_reconciliation_lease_token,p_reconciliation_fencing_token,p_provider_job_id,p_provider_request_id,
    p_evidence_digest) result;
END
$function$;

CREATE FUNCTION ai_media_worker_api.finalize_exact_one_video_reconciled_no_submit_v1(
  p_execution_id uuid,p_run_lease_token uuid,p_run_fencing_token bigint,p_command_digest text,
  p_actor_user_id text,p_owner_user_id text,p_workspace_id text,p_budget_reservation_id uuid,
  p_render_job_id uuid,p_daily_plan_slot_id uuid,p_slot_attempt integer,p_work_handoff_digest text,
  p_attempt_id uuid,p_submission_fencing_token bigint,p_authorization_digest text,
  p_reconciliation_lease_token uuid,p_reconciliation_fencing_token bigint,p_guarantee text,
  p_provider_account_id uuid,p_provider_key text,p_provider_credential_version integer,
  p_provider_idempotency_key text,p_finality_observed_at timestamptz,p_provider_evidence_digest text
) RETURNS TABLE(
  execution_id uuid,run_lease_token uuid,run_fencing_token bigint,command_digest text,actor_user_id text,
  owner_user_id text,workspace_id text,budget_reservation_id uuid,render_job_id uuid,
  daily_plan_slot_id uuid,slot_attempt integer,work_handoff_digest text,applied boolean
) LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET row_security=on AS $function$
DECLARE context record;attempt public.ai_media_provider_submission_attempts%ROWTYPE;
  sampled_at timestamptz:=pg_catalog.clock_timestamp();bound_evidence text;equivalent_replay boolean:=false;
BEGIN
  SELECT * INTO context FROM ai_media_worker_api.require_exact_one_video_reconcile_context_v1(
    p_execution_id,p_run_lease_token,p_run_fencing_token,p_command_digest,p_actor_user_id,
    p_owner_user_id,p_workspace_id,p_budget_reservation_id,p_render_job_id,p_daily_plan_slot_id,
    p_slot_attempt,p_work_handoff_digest,'reconcile_submission','finalize_reconciled_no_submit',NULL,NULL);
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'ai-media:admitted-reservation:'||p_owner_user_id||':'||p_workspace_id||':'||p_budget_reservation_id::text,0));
  bound_evidence=ai_media_worker_api.sha256_text_v1('linearizable-definitive-no-submit:v1:'||
    p_attempt_id::text||':'||p_authorization_digest||':'||p_provider_account_id::text||':'||
    p_provider_key||':'||p_provider_credential_version::text||':'||p_provider_idempotency_key||':'||
    p_reconciliation_fencing_token::text||':'||p_finality_observed_at::text||':'||p_provider_evidence_digest);
  SELECT candidate.* INTO attempt FROM public.ai_media_provider_submission_attempts candidate
  WHERE candidate.id=p_attempt_id AND candidate.owner_user_id=p_owner_user_id
    AND candidate.workspace_id=p_workspace_id AND candidate.budget_reservation_id=p_budget_reservation_id
    AND candidate.render_job_id=p_render_job_id AND candidate.daily_plan_slot_id=p_daily_plan_slot_id
    AND candidate.slot_attempt=p_slot_attempt AND candidate.work_handoff_digest=p_work_handoff_digest
    AND candidate.fencing_token=p_submission_fencing_token
    AND candidate.send_authorization_digest=p_authorization_digest FOR UPDATE;
  IF FOUND AND attempt.state='reconciled_no_submit' THEN
    SELECT EXISTS (
      SELECT 1 FROM public.ai_media_provider_submission_events event
      WHERE event.owner_user_id=p_owner_user_id AND event.workspace_id=p_workspace_id
        AND event.submission_attempt_id=p_attempt_id AND event.budget_reservation_id=p_budget_reservation_id
        AND event.event_kind='reconciled_no_submit' AND event.fencing_token=p_submission_fencing_token
        AND event.reconciliation_fencing_token=p_reconciliation_fencing_token
        AND event.evidence_digest=bound_evidence
        AND event.actor_user_id=context.admitted_actor_user_id
    ) AND attempt.reconciliation_evidence_digest=bound_evidence
      AND attempt.reconciliation_fencing_token=p_reconciliation_fencing_token
      AND attempt.provider_account_id=p_provider_account_id
      AND attempt.provider_key=p_provider_key
      AND attempt.provider_credential_version=p_provider_credential_version
      AND attempt.provider_idempotency_key=p_provider_idempotency_key
      AND p_guarantee='linearizable_not_accepted_and_cannot_later_accept'
      AND p_provider_evidence_digest~'^sha256:[0-9a-f]{64}$'
      AND pg_catalog.isfinite(p_finality_observed_at)
    INTO equivalent_replay;
    RETURN QUERY SELECT p_execution_id,p_run_lease_token,p_run_fencing_token,p_command_digest,p_actor_user_id,
      p_owner_user_id,p_workspace_id,p_budget_reservation_id,p_render_job_id,p_daily_plan_slot_id,
      p_slot_attempt,p_work_handoff_digest,equivalent_replay;RETURN;
  ELSIF FOUND AND attempt.state<>'ambiguous' THEN
    RETURN QUERY SELECT p_execution_id,p_run_lease_token,p_run_fencing_token,p_command_digest,p_actor_user_id,
      p_owner_user_id,p_workspace_id,p_budget_reservation_id,p_render_job_id,p_daily_plan_slot_id,
      p_slot_attempt,p_work_handoff_digest,false;RETURN;
  END IF;
  PERFORM 1 FROM public.ai_media_provider_submission_attempts live_attempt
  WHERE live_attempt.id=p_attempt_id AND live_attempt.owner_user_id=p_owner_user_id
    AND live_attempt.workspace_id=p_workspace_id
    AND live_attempt.budget_reservation_id=p_budget_reservation_id
    AND live_attempt.render_job_id=p_render_job_id AND live_attempt.daily_plan_slot_id=p_daily_plan_slot_id
    AND live_attempt.slot_attempt=p_slot_attempt AND live_attempt.work_handoff_digest=p_work_handoff_digest
    AND live_attempt.state='ambiguous'
    AND live_attempt.fencing_token=p_submission_fencing_token
    AND live_attempt.send_authorization_digest=p_authorization_digest
    AND live_attempt.reconciliation_lease_token=p_reconciliation_lease_token
    AND live_attempt.reconciliation_lease_owner=context.admitted_actor_user_id
    AND live_attempt.reconciliation_fencing_token=p_reconciliation_fencing_token
    AND live_attempt.reconciliation_lease_expires_at>sampled_at
    AND live_attempt.provider_account_id=p_provider_account_id
    AND live_attempt.provider_key=p_provider_key
    AND live_attempt.provider_credential_version=p_provider_credential_version
    AND live_attempt.provider_idempotency_key=p_provider_idempotency_key FOR UPDATE;
  IF NOT FOUND THEN
    RETURN QUERY SELECT p_execution_id,p_run_lease_token,p_run_fencing_token,p_command_digest,p_actor_user_id,
      p_owner_user_id,p_workspace_id,p_budget_reservation_id,p_render_job_id,p_daily_plan_slot_id,
      p_slot_attempt,p_work_handoff_digest,false;RETURN;
  END IF;
  RETURN QUERY SELECT p_execution_id,p_run_lease_token,p_run_fencing_token,p_command_digest,p_actor_user_id,
    p_owner_user_id,p_workspace_id,p_budget_reservation_id,p_render_job_id,p_daily_plan_slot_id,
    p_slot_attempt,p_work_handoff_digest,result.applied
  FROM ai_media_worker_api.finalize_reconciled_no_submit_v1(context.capability_id,p_owner_user_id,
    p_workspace_id,p_attempt_id,p_budget_reservation_id,p_submission_fencing_token,p_authorization_digest,
    p_reconciliation_lease_token,p_reconciliation_fencing_token,p_guarantee,p_provider_account_id,
    p_provider_key,p_provider_credential_version,p_provider_idempotency_key,p_finality_observed_at,
    p_provider_evidence_digest) result;
END
$function$;

CREATE FUNCTION ai_media_worker_api.claim_exact_one_video_terminal_check_v1(
  p_execution_id uuid,p_run_lease_token uuid,p_run_fencing_token bigint,p_command_digest text,
  p_actor_user_id text,p_owner_user_id text,p_workspace_id text,p_budget_reservation_id uuid,
  p_render_job_id uuid,p_daily_plan_slot_id uuid,p_slot_attempt integer,p_work_handoff_digest text,
  p_worker_id text,p_lease_ms integer
) RETURNS TABLE(
  execution_id uuid,run_lease_token uuid,run_fencing_token bigint,command_digest text,actor_user_id text,
  owner_user_id text,workspace_id text,budget_reservation_id uuid,render_job_id uuid,
  daily_plan_slot_id uuid,slot_attempt integer,work_handoff_digest text,id uuid,submission_attempt_id uuid,
  provider_account_id uuid,provider_key text,provider_credential_version integer,provider_job_id text,
  send_authorization_digest text,lease_token uuid,submission_fencing_token bigint,
  fencing_token bigint,lease_expires_at timestamptz
) LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET row_security=on AS $function$
#variable_conflict use_column
DECLARE context record;candidate record;claimed public.ai_media_provider_terminal_checks%ROWTYPE;
  sampled_at timestamptz:=pg_catalog.clock_timestamp();new_lease uuid:=pg_catalog.gen_random_uuid();
BEGIN
  SELECT * INTO context FROM ai_media_worker_api.require_exact_one_video_reconcile_context_v1(
    p_execution_id,p_run_lease_token,p_run_fencing_token,p_command_digest,p_actor_user_id,
    p_owner_user_id,p_workspace_id,p_budget_reservation_id,p_render_job_id,p_daily_plan_slot_id,
    p_slot_attempt,p_work_handoff_digest,'observe_terminal','claim_terminal_check',p_worker_id,p_lease_ms);
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'ai-media:terminal-attempt:'||p_owner_user_id||':'||p_workspace_id||':'||p_budget_reservation_id::text,0));
  SELECT attempt.* INTO candidate
  FROM public.ai_media_provider_submission_attempts attempt
  JOIN public.ai_media_submission_capacity_leases capacity ON capacity.submission_attempt_id=attempt.id
    AND capacity.owner_user_id=attempt.owner_user_id AND capacity.workspace_id=attempt.workspace_id
    AND capacity.budget_reservation_id=attempt.budget_reservation_id AND capacity.state='held'
  LEFT JOIN public.ai_media_provider_terminal_checks terminal_check
    ON terminal_check.submission_attempt_id=attempt.id
    AND terminal_check.owner_user_id=attempt.owner_user_id AND terminal_check.workspace_id=attempt.workspace_id
  LEFT JOIN public.ai_media_provider_terminal_events terminal_event
    ON terminal_event.submission_attempt_id=attempt.id
    AND terminal_event.owner_user_id=attempt.owner_user_id AND terminal_event.workspace_id=attempt.workspace_id
  WHERE attempt.owner_user_id=p_owner_user_id AND attempt.workspace_id=p_workspace_id
    AND attempt.budget_reservation_id=p_budget_reservation_id
    AND attempt.render_job_id=p_render_job_id AND attempt.daily_plan_slot_id=p_daily_plan_slot_id
    AND attempt.slot_attempt=p_slot_attempt AND attempt.work_handoff_digest=p_work_handoff_digest
    AND attempt.state='confirmed'
    AND terminal_event.id IS NULL
    AND (terminal_check.id IS NULL OR (terminal_check.state='leased'
      AND terminal_check.lease_expires_at<=sampled_at) OR (terminal_check.state='pending'
      AND terminal_check.next_check_at<=sampled_at))
  FOR UPDATE OF attempt,capacity;
  IF NOT FOUND THEN RETURN; END IF;
  INSERT INTO public.ai_media_provider_terminal_checks(owner_user_id,workspace_id,submission_attempt_id,
    budget_reservation_id,render_job_id,dispatch_outbox_id,daily_plan_slot_id,provider_account_id,provider_key,
    provider_credential_version,provider_job_id,send_authorization_digest,state,fencing_token,claim_count,
    backoff_attempt,next_check_at,lease_token,lease_owner,lease_expires_at,actor_user_id,created_at,updated_at)
  VALUES(p_owner_user_id,p_workspace_id,candidate.id,p_budget_reservation_id,p_render_job_id,
    candidate.dispatch_outbox_id,p_daily_plan_slot_id,candidate.provider_account_id,candidate.provider_key,
    candidate.provider_credential_version,candidate.provider_job_id,candidate.send_authorization_digest,
    'leased',1,1,0,NULL,new_lease,context.admitted_actor_user_id,
    sampled_at+(p_lease_ms::text||' milliseconds')::interval,
    context.admitted_actor_user_id,sampled_at,sampled_at)
  ON CONFLICT(owner_user_id,workspace_id,submission_attempt_id) DO UPDATE SET state='leased',
    fencing_token=ai_media_provider_terminal_checks.fencing_token+1,
    claim_count=ai_media_provider_terminal_checks.claim_count+1,lease_token=EXCLUDED.lease_token,
    lease_owner=EXCLUDED.lease_owner,lease_expires_at=EXCLUDED.lease_expires_at,next_check_at=NULL,
    updated_at=EXCLUDED.updated_at
  WHERE (ai_media_provider_terminal_checks.state='pending'
      AND ai_media_provider_terminal_checks.next_check_at<=sampled_at)
    OR (ai_media_provider_terminal_checks.state='leased'
      AND ai_media_provider_terminal_checks.lease_expires_at<=sampled_at)
  RETURNING * INTO claimed;
  IF NOT FOUND THEN RETURN; END IF;
  RETURN QUERY SELECT p_execution_id,p_run_lease_token,p_run_fencing_token,p_command_digest,p_actor_user_id,
    p_owner_user_id,p_workspace_id,p_budget_reservation_id,p_render_job_id,p_daily_plan_slot_id,
    p_slot_attempt,p_work_handoff_digest,claimed.id,claimed.submission_attempt_id,
    claimed.provider_account_id,claimed.provider_key,claimed.provider_credential_version,
    claimed.provider_job_id,claimed.send_authorization_digest,claimed.lease_token,
    candidate.fencing_token,claimed.fencing_token,claimed.lease_expires_at;
END
$function$;

CREATE FUNCTION ai_media_worker_api.release_exact_one_video_terminal_check_unknown_v1(
  p_execution_id uuid,p_run_lease_token uuid,p_run_fencing_token bigint,p_command_digest text,
  p_actor_user_id text,p_owner_user_id text,p_workspace_id text,p_budget_reservation_id uuid,
  p_render_job_id uuid,p_daily_plan_slot_id uuid,p_slot_attempt integer,p_work_handoff_digest text,
  p_terminal_check_id uuid,p_lease_token uuid,p_terminal_check_fencing bigint,
  p_reason text,p_observed_at timestamptz,p_evidence_digest text
) RETURNS TABLE(
  execution_id uuid,run_lease_token uuid,run_fencing_token bigint,command_digest text,actor_user_id text,
  owner_user_id text,workspace_id text,budget_reservation_id uuid,render_job_id uuid,
  daily_plan_slot_id uuid,slot_attempt integer,work_handoff_digest text,applied boolean
) LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET row_security=on AS $function$
DECLARE context record;sampled_at timestamptz:=pg_catalog.clock_timestamp();
BEGIN
  SELECT * INTO context FROM ai_media_worker_api.require_exact_one_video_reconcile_context_v1(
    p_execution_id,p_run_lease_token,p_run_fencing_token,p_command_digest,p_actor_user_id,
    p_owner_user_id,p_workspace_id,p_budget_reservation_id,p_render_job_id,p_daily_plan_slot_id,
    p_slot_attempt,p_work_handoff_digest,'observe_terminal','release_terminal_check_unknown',NULL,NULL);
  PERFORM 1 FROM public.ai_media_provider_terminal_checks terminal_check
  JOIN public.ai_media_provider_submission_attempts attempt ON attempt.id=terminal_check.submission_attempt_id
    AND attempt.owner_user_id=terminal_check.owner_user_id AND attempt.workspace_id=terminal_check.workspace_id
    AND attempt.budget_reservation_id=terminal_check.budget_reservation_id
  WHERE terminal_check.id=p_terminal_check_id AND terminal_check.owner_user_id=p_owner_user_id
    AND terminal_check.workspace_id=p_workspace_id AND terminal_check.budget_reservation_id=p_budget_reservation_id
    AND terminal_check.render_job_id=p_render_job_id AND terminal_check.daily_plan_slot_id=p_daily_plan_slot_id
    AND terminal_check.state='leased' AND terminal_check.lease_token=p_lease_token
    AND terminal_check.lease_owner=context.admitted_actor_user_id
    AND terminal_check.fencing_token=p_terminal_check_fencing
    AND terminal_check.lease_expires_at>sampled_at
    AND attempt.render_job_id=p_render_job_id AND attempt.daily_plan_slot_id=p_daily_plan_slot_id
    AND attempt.slot_attempt=p_slot_attempt AND attempt.work_handoff_digest=p_work_handoff_digest
    AND attempt.state='confirmed' FOR UPDATE OF terminal_check,attempt;
  IF NOT FOUND THEN
    PERFORM 1 FROM public.ai_media_provider_terminal_checks terminal_check
    JOIN public.ai_media_provider_submission_attempts attempt ON attempt.id=terminal_check.submission_attempt_id
      AND attempt.owner_user_id=terminal_check.owner_user_id AND attempt.workspace_id=terminal_check.workspace_id
      AND attempt.budget_reservation_id=terminal_check.budget_reservation_id
    WHERE terminal_check.id=p_terminal_check_id AND terminal_check.owner_user_id=p_owner_user_id
      AND terminal_check.workspace_id=p_workspace_id AND terminal_check.budget_reservation_id=p_budget_reservation_id
      AND terminal_check.render_job_id=p_render_job_id AND terminal_check.daily_plan_slot_id=p_daily_plan_slot_id
      AND terminal_check.state='pending'
      AND terminal_check.lease_token IS NULL AND terminal_check.lease_owner IS NULL
      AND terminal_check.fencing_token=p_terminal_check_fencing
      AND terminal_check.last_retry_reason=p_reason
      AND terminal_check.last_observed_at=p_observed_at
      AND terminal_check.last_evidence_digest=p_evidence_digest
      AND attempt.render_job_id=p_render_job_id AND attempt.daily_plan_slot_id=p_daily_plan_slot_id
      AND attempt.slot_attempt=p_slot_attempt AND attempt.work_handoff_digest=p_work_handoff_digest
      AND attempt.state='confirmed' FOR UPDATE OF terminal_check,attempt;
    IF FOUND THEN
      RETURN QUERY SELECT p_execution_id,p_run_lease_token,p_run_fencing_token,p_command_digest,p_actor_user_id,
        p_owner_user_id,p_workspace_id,p_budget_reservation_id,p_render_job_id,p_daily_plan_slot_id,
        p_slot_attempt,p_work_handoff_digest,true;RETURN;
    END IF;
    RETURN QUERY SELECT p_execution_id,p_run_lease_token,p_run_fencing_token,p_command_digest,p_actor_user_id,
      p_owner_user_id,p_workspace_id,p_budget_reservation_id,p_render_job_id,p_daily_plan_slot_id,
      p_slot_attempt,p_work_handoff_digest,false;RETURN;
  END IF;
  RETURN QUERY SELECT p_execution_id,p_run_lease_token,p_run_fencing_token,p_command_digest,p_actor_user_id,
    p_owner_user_id,p_workspace_id,p_budget_reservation_id,p_render_job_id,p_daily_plan_slot_id,
    p_slot_attempt,p_work_handoff_digest,result.applied
  FROM ai_media_worker_api.release_terminal_check_unknown_v1(context.capability_id,p_owner_user_id,
    p_workspace_id,p_terminal_check_id,p_lease_token,p_terminal_check_fencing,p_reason,p_observed_at,
    p_evidence_digest) result;
END
$function$;

CREATE FUNCTION ai_media_worker_api.record_exact_one_video_provider_terminal_v1(
  p_execution_id uuid,p_run_lease_token uuid,p_run_fencing_token bigint,p_command_digest text,
  p_actor_user_id text,p_owner_user_id text,p_workspace_id text,p_budget_reservation_id uuid,
  p_render_job_id uuid,p_daily_plan_slot_id uuid,p_slot_attempt integer,p_work_handoff_digest text,
  p_terminal_check_id uuid,p_submission_attempt_id uuid,p_submission_fencing_token bigint,
  p_lease_token uuid,p_terminal_check_fencing bigint,p_authorization_digest text,
  p_provider_account_id uuid,p_provider_key text,p_provider_credential_version integer,
  p_provider_job_id text,p_terminal_state text,p_remote_artifact_ref text,p_remote_url text,
  p_observed_at timestamptz,p_provider_evidence_digest text
) RETURNS TABLE(
  execution_id uuid,run_lease_token uuid,run_fencing_token bigint,command_digest text,actor_user_id text,
  owner_user_id text,workspace_id text,budget_reservation_id uuid,render_job_id uuid,
  daily_plan_slot_id uuid,slot_attempt integer,work_handoff_digest text,
  outcome text,terminal_event_id uuid,ingest_job_id uuid
) LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET row_security=on AS $function$
DECLARE context record;existing public.ai_media_provider_terminal_events%ROWTYPE;
  sampled_at timestamptz:=pg_catalog.clock_timestamp();existing_ingest uuid;
BEGIN
  SELECT * INTO context FROM ai_media_worker_api.require_exact_one_video_reconcile_context_v1(
    p_execution_id,p_run_lease_token,p_run_fencing_token,p_command_digest,p_actor_user_id,
    p_owner_user_id,p_workspace_id,p_budget_reservation_id,p_render_job_id,p_daily_plan_slot_id,
    p_slot_attempt,p_work_handoff_digest,'observe_terminal','record_provider_terminal',NULL,NULL);
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'ai-media:terminal-attempt:'||p_owner_user_id||':'||p_workspace_id||':'||p_submission_attempt_id::text,0));
  SELECT event.* INTO existing
  FROM public.ai_media_provider_terminal_events event
  JOIN public.ai_media_provider_submission_attempts attempt
    ON attempt.id=event.submission_attempt_id AND attempt.owner_user_id=event.owner_user_id
   AND attempt.workspace_id=event.workspace_id AND attempt.budget_reservation_id=event.budget_reservation_id
  JOIN public.ai_media_provider_terminal_checks terminal_check
    ON terminal_check.id=event.terminal_check_id AND terminal_check.owner_user_id=event.owner_user_id
   AND terminal_check.workspace_id=event.workspace_id
   AND terminal_check.submission_attempt_id=event.submission_attempt_id
  WHERE event.owner_user_id=p_owner_user_id AND event.workspace_id=p_workspace_id
    AND event.submission_attempt_id=p_submission_attempt_id
    AND event.terminal_check_id=p_terminal_check_id
    AND event.budget_reservation_id=p_budget_reservation_id
    AND event.render_job_id=p_render_job_id AND event.daily_plan_slot_id=p_daily_plan_slot_id
    AND attempt.render_job_id=p_render_job_id AND attempt.daily_plan_slot_id=p_daily_plan_slot_id
    AND attempt.slot_attempt=p_slot_attempt AND attempt.work_handoff_digest=p_work_handoff_digest
    AND attempt.fencing_token=p_submission_fencing_token
    AND attempt.send_authorization_digest=p_authorization_digest
    AND terminal_check.fencing_token=p_terminal_check_fencing
  FOR UPDATE OF attempt,terminal_check;
  IF FOUND THEN
    IF existing.terminal_state=p_terminal_state
      AND existing.provider_account_id=p_provider_account_id
      AND existing.provider_key=p_provider_key
      AND existing.provider_credential_version=p_provider_credential_version
      AND existing.provider_job_id=p_provider_job_id
      AND existing.send_authorization_digest=p_authorization_digest
      AND existing.provider_evidence_digest=p_provider_evidence_digest
      AND existing.remote_artifact_ref IS NOT DISTINCT FROM p_remote_artifact_ref
      AND existing.remote_url IS NOT DISTINCT FROM p_remote_url
      AND existing.observed_at=p_observed_at
      AND existing.actor_user_id=context.admitted_actor_user_id THEN
      SELECT ingest.id INTO existing_ingest FROM public.ai_media_asset_ingest_jobs ingest
      WHERE ingest.owner_user_id=p_owner_user_id AND ingest.workspace_id=p_workspace_id
        AND ingest.render_job_id=p_render_job_id;
      RETURN QUERY SELECT p_execution_id,p_run_lease_token,p_run_fencing_token,p_command_digest,p_actor_user_id,
        p_owner_user_id,p_workspace_id,p_budget_reservation_id,p_render_job_id,p_daily_plan_slot_id,
        p_slot_attempt,p_work_handoff_digest,'replayed'::text,existing.id,existing_ingest;RETURN;
    END IF;
    RETURN QUERY SELECT p_execution_id,p_run_lease_token,p_run_fencing_token,p_command_digest,p_actor_user_id,
      p_owner_user_id,p_workspace_id,p_budget_reservation_id,p_render_job_id,p_daily_plan_slot_id,
      p_slot_attempt,p_work_handoff_digest,'conflict'::text,NULL::uuid,NULL::uuid;RETURN;
  END IF;
  PERFORM 1 FROM public.ai_media_provider_terminal_checks terminal_check
  JOIN public.ai_media_provider_submission_attempts attempt ON attempt.id=terminal_check.submission_attempt_id
    AND attempt.owner_user_id=terminal_check.owner_user_id AND attempt.workspace_id=terminal_check.workspace_id
    AND attempt.budget_reservation_id=terminal_check.budget_reservation_id
  WHERE terminal_check.id=p_terminal_check_id AND terminal_check.owner_user_id=p_owner_user_id
    AND terminal_check.workspace_id=p_workspace_id AND terminal_check.budget_reservation_id=p_budget_reservation_id
    AND terminal_check.render_job_id=p_render_job_id AND terminal_check.daily_plan_slot_id=p_daily_plan_slot_id
    AND terminal_check.submission_attempt_id=p_submission_attempt_id AND terminal_check.state='leased'
    AND terminal_check.lease_token=p_lease_token
    AND terminal_check.lease_owner=context.admitted_actor_user_id
    AND terminal_check.fencing_token=p_terminal_check_fencing AND terminal_check.lease_expires_at>sampled_at
    AND attempt.render_job_id=p_render_job_id AND attempt.daily_plan_slot_id=p_daily_plan_slot_id
    AND attempt.slot_attempt=p_slot_attempt AND attempt.work_handoff_digest=p_work_handoff_digest
    AND attempt.state='confirmed'
    AND attempt.fencing_token=p_submission_fencing_token
    AND attempt.send_authorization_digest=p_authorization_digest
    AND attempt.provider_account_id=p_provider_account_id AND attempt.provider_key=p_provider_key
    AND attempt.provider_credential_version=p_provider_credential_version
    AND attempt.provider_job_id=p_provider_job_id FOR UPDATE OF terminal_check,attempt;
  IF NOT FOUND THEN
    RETURN QUERY SELECT p_execution_id,p_run_lease_token,p_run_fencing_token,p_command_digest,p_actor_user_id,
      p_owner_user_id,p_workspace_id,p_budget_reservation_id,p_render_job_id,p_daily_plan_slot_id,
      p_slot_attempt,p_work_handoff_digest,'rejected'::text,NULL::uuid,NULL::uuid;RETURN;
  END IF;
  RETURN QUERY SELECT p_execution_id,p_run_lease_token,p_run_fencing_token,p_command_digest,p_actor_user_id,
    p_owner_user_id,p_workspace_id,p_budget_reservation_id,p_render_job_id,p_daily_plan_slot_id,
    p_slot_attempt,p_work_handoff_digest,result.outcome,result.terminal_event_id,result.ingest_job_id
  FROM ai_media_worker_api.record_provider_terminal_v1(context.capability_id,p_owner_user_id,p_workspace_id,
    p_terminal_check_id,p_submission_attempt_id,p_submission_fencing_token,p_lease_token,
    p_terminal_check_fencing,p_authorization_digest,p_provider_account_id,p_provider_key,
    p_provider_credential_version,p_provider_job_id,p_terminal_state,p_remote_artifact_ref,p_remote_url,
    p_observed_at,p_provider_evidence_digest) result;
END
$function$;

GRANT USAGE ON SCHEMA ai_media_worker_api TO ai_media_one_video_run_executor;
REVOKE ALL ON FUNCTION ai_media_worker_api.require_exact_one_video_reconcile_context_v1(
  uuid,uuid,bigint,text,text,text,text,uuid,uuid,uuid,integer,text,text,text,text,integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION ai_media_worker_api.claim_exact_one_video_reconciliation_v1(
  uuid,uuid,bigint,text,text,text,text,uuid,uuid,uuid,integer,text,text,integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION ai_media_worker_api.release_exact_one_video_reconciliation_unknown_v1(
  uuid,uuid,bigint,text,text,text,text,uuid,uuid,uuid,integer,text,uuid,bigint,text,uuid,bigint) FROM PUBLIC;
REVOKE ALL ON FUNCTION ai_media_worker_api.record_exact_one_video_reconciled_confirmed_v1(
  uuid,uuid,bigint,text,text,text,text,uuid,uuid,uuid,integer,text,uuid,bigint,text,uuid,bigint,text,text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION ai_media_worker_api.finalize_exact_one_video_reconciled_no_submit_v1(
  uuid,uuid,bigint,text,text,text,text,uuid,uuid,uuid,integer,text,uuid,bigint,text,uuid,bigint,text,uuid,text,integer,text,timestamptz,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION ai_media_worker_api.claim_exact_one_video_terminal_check_v1(
  uuid,uuid,bigint,text,text,text,text,uuid,uuid,uuid,integer,text,text,integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION ai_media_worker_api.release_exact_one_video_terminal_check_unknown_v1(
  uuid,uuid,bigint,text,text,text,text,uuid,uuid,uuid,integer,text,uuid,uuid,bigint,text,timestamptz,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION ai_media_worker_api.record_exact_one_video_provider_terminal_v1(
  uuid,uuid,bigint,text,text,text,text,uuid,uuid,uuid,integer,text,uuid,uuid,bigint,uuid,bigint,text,uuid,text,integer,text,text,text,text,timestamptz,text) FROM PUBLIC;

ALTER FUNCTION ai_media_worker_api.require_exact_one_video_reconcile_context_v1(
  uuid,uuid,bigint,text,text,text,text,uuid,uuid,uuid,integer,text,text,text,text,integer) OWNER TO ai_media_admitted_fn_owner;
ALTER FUNCTION ai_media_worker_api.claim_exact_one_video_reconciliation_v1(
  uuid,uuid,bigint,text,text,text,text,uuid,uuid,uuid,integer,text,text,integer) OWNER TO ai_media_admitted_fn_owner;
ALTER FUNCTION ai_media_worker_api.release_exact_one_video_reconciliation_unknown_v1(
  uuid,uuid,bigint,text,text,text,text,uuid,uuid,uuid,integer,text,uuid,bigint,text,uuid,bigint) OWNER TO ai_media_admitted_fn_owner;
ALTER FUNCTION ai_media_worker_api.record_exact_one_video_reconciled_confirmed_v1(
  uuid,uuid,bigint,text,text,text,text,uuid,uuid,uuid,integer,text,uuid,bigint,text,uuid,bigint,text,text,text) OWNER TO ai_media_admitted_fn_owner;
ALTER FUNCTION ai_media_worker_api.finalize_exact_one_video_reconciled_no_submit_v1(
  uuid,uuid,bigint,text,text,text,text,uuid,uuid,uuid,integer,text,uuid,bigint,text,uuid,bigint,text,uuid,text,integer,text,timestamptz,text) OWNER TO ai_media_admitted_fn_owner;
ALTER FUNCTION ai_media_worker_api.claim_exact_one_video_terminal_check_v1(
  uuid,uuid,bigint,text,text,text,text,uuid,uuid,uuid,integer,text,text,integer) OWNER TO ai_media_admitted_fn_owner;
ALTER FUNCTION ai_media_worker_api.release_exact_one_video_terminal_check_unknown_v1(
  uuid,uuid,bigint,text,text,text,text,uuid,uuid,uuid,integer,text,uuid,uuid,bigint,text,timestamptz,text) OWNER TO ai_media_admitted_fn_owner;
ALTER FUNCTION ai_media_worker_api.record_exact_one_video_provider_terminal_v1(
  uuid,uuid,bigint,text,text,text,text,uuid,uuid,uuid,integer,text,uuid,uuid,bigint,uuid,bigint,text,uuid,text,integer,text,text,text,text,timestamptz,text) OWNER TO ai_media_admitted_fn_owner;

GRANT EXECUTE ON FUNCTION ai_media_worker_api.claim_exact_one_video_reconciliation_v1(
  uuid,uuid,bigint,text,text,text,text,uuid,uuid,uuid,integer,text,text,integer)
  TO ai_media_one_video_run_executor;
GRANT EXECUTE ON FUNCTION ai_media_worker_api.release_exact_one_video_reconciliation_unknown_v1(
  uuid,uuid,bigint,text,text,text,text,uuid,uuid,uuid,integer,text,uuid,bigint,text,uuid,bigint)
  TO ai_media_one_video_run_executor;
GRANT EXECUTE ON FUNCTION ai_media_worker_api.record_exact_one_video_reconciled_confirmed_v1(
  uuid,uuid,bigint,text,text,text,text,uuid,uuid,uuid,integer,text,uuid,bigint,text,uuid,bigint,text,text,text)
  TO ai_media_one_video_run_executor;
GRANT EXECUTE ON FUNCTION ai_media_worker_api.finalize_exact_one_video_reconciled_no_submit_v1(
  uuid,uuid,bigint,text,text,text,text,uuid,uuid,uuid,integer,text,uuid,bigint,text,uuid,bigint,text,uuid,text,integer,text,timestamptz,text)
  TO ai_media_one_video_run_executor;
GRANT EXECUTE ON FUNCTION ai_media_worker_api.claim_exact_one_video_terminal_check_v1(
  uuid,uuid,bigint,text,text,text,text,uuid,uuid,uuid,integer,text,text,integer)
  TO ai_media_one_video_run_executor;
GRANT EXECUTE ON FUNCTION ai_media_worker_api.release_exact_one_video_terminal_check_unknown_v1(
  uuid,uuid,bigint,text,text,text,text,uuid,uuid,uuid,integer,text,uuid,uuid,bigint,text,timestamptz,text)
  TO ai_media_one_video_run_executor;
GRANT EXECUTE ON FUNCTION ai_media_worker_api.record_exact_one_video_provider_terminal_v1(
  uuid,uuid,bigint,text,text,text,text,uuid,uuid,uuid,integer,text,uuid,uuid,bigint,uuid,bigint,text,uuid,text,integer,text,text,text,text,timestamptz,text)
  TO ai_media_one_video_run_executor;

COMMIT;
