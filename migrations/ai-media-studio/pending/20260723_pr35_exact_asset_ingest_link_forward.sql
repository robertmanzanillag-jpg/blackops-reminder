-- AI Media Studio PR35: exact one-video owned-asset ingest and canonical link surface.
-- Review artifact only. Do not apply automatically.
-- PostgreSQL 16 only. This migration performs no provider/network request, download,
-- object-store operation, publication, worker start, spend, or deployment.
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
  THEN RAISE EXCEPTION 'PR35 requires safe precreated NOLOGIN NOINHERIT ai_media_one_video_run_executor'; END IF;
  IF current_setting('server_version_num')::integer<160000
    OR to_regclass('public.ai_media_exact_one_video_run_capabilities') IS NULL
    OR to_regclass('public.ai_media_exact_one_video_run_fences') IS NULL
    OR to_regclass('public.ai_media_asset_ingest_jobs') IS NULL
    OR to_regclass('public.ai_media_assets') IS NULL
    OR to_regclass('public.ai_media_render_jobs') IS NULL
    OR to_regclass('public.ai_media_provider_terminal_events') IS NULL
    OR to_regprocedure('ai_media_worker_api.require_exact_one_video_asset_context_v1(uuid,uuid,bigint,text,text,text,text,uuid,uuid,uuid,integer,text,text)') IS NOT NULL
    OR to_regprocedure('ai_media_worker_api.claim_exact_one_video_asset_ingest_v1(uuid,uuid,bigint,text,text,text,text,uuid,uuid,uuid,integer,text,uuid,text,integer)') IS NOT NULL
    OR to_regprocedure('ai_media_worker_api.record_exact_one_video_asset_ingest_completed_v1(uuid,uuid,bigint,text,text,text,text,uuid,uuid,uuid,integer,text,uuid,text,bigint,text,text,bigint)') IS NOT NULL
    OR to_regprocedure('ai_media_worker_api.record_exact_one_video_asset_ingest_failed_v1(uuid,uuid,bigint,text,text,text,text,uuid,uuid,uuid,integer,text,uuid,text,bigint,text,boolean,timestamptz)') IS NOT NULL
    OR to_regprocedure('ai_media_worker_api.load_exact_one_video_asset_link_v1(uuid,uuid,bigint,text,text,text,text,uuid,uuid,uuid,integer,text,uuid)') IS NOT NULL
    OR to_regprocedure('ai_media_worker_api.record_exact_one_video_asset_linked_v1(uuid,uuid,bigint,text,text,text,text,uuid,uuid,uuid,integer,text,uuid,bigint,text,text,uuid)') IS NOT NULL
  THEN RAISE EXCEPTION 'PR35 requires exact PR27 and PR32 surfaces and an unused PR35 surface'; END IF;
END
$preflight$;

CREATE FUNCTION ai_media_worker_api.require_exact_one_video_asset_context_v1(
  p_execution_id uuid,p_run_lease_token uuid,p_run_fencing_token bigint,p_command_digest text,
  p_actor_user_id text,p_owner_user_id text,p_workspace_id text,p_budget_reservation_id uuid,
  p_render_job_id uuid,p_daily_plan_slot_id uuid,p_slot_attempt integer,p_work_handoff_digest text,
  p_action text
) RETURNS TABLE(capability_id uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET row_security=on AS $function$
DECLARE sampled_at timestamptz:=pg_catalog.clock_timestamp();
BEGIN
  IF p_action NOT IN ('ingest_asset','link_asset')
    OR p_command_digest!~'^sha256:[0-9a-f]{64}$'
    OR p_work_handoff_digest!~'^sha256:[0-9a-f]{64}$'
  THEN RAISE EXCEPTION 'invalid exact asset context'; END IF;
  IF EXISTS (
    SELECT 1 FROM pg_catalog.unnest(ARRAY[
      'public.ai_media_exact_one_video_run_capabilities',
      'public.ai_media_exact_one_video_run_fences',
      'public.ai_media_asset_ingest_jobs',
      'public.ai_media_assets',
      'public.ai_media_render_jobs',
      'public.ai_media_provider_terminal_events']::text[]) protected(table_name)
    WHERE pg_catalog.has_table_privilege(SESSION_USER,protected.table_name,'SELECT')
      OR pg_catalog.has_table_privilege(SESSION_USER,protected.table_name,'INSERT')
      OR pg_catalog.has_table_privilege(SESSION_USER,protected.table_name,'UPDATE')
      OR pg_catalog.has_table_privilege(SESSION_USER,protected.table_name,'DELETE')
      OR pg_catalog.has_table_privilege(SESSION_USER,protected.table_name,'TRUNCATE')
      OR pg_catalog.has_table_privilege(SESSION_USER,protected.table_name,'REFERENCES')
      OR pg_catalog.has_table_privilege(SESSION_USER,protected.table_name,'TRIGGER')
  ) THEN RAISE EXCEPTION 'exact one-video asset executor must remain table-blind' USING ERRCODE='42501'; END IF;

  RETURN QUERY
  SELECT exact_capability.id
  FROM public.ai_media_exact_one_video_run_fences fence
  JOIN public.ai_media_exact_one_video_run_capabilities exact_capability
    ON exact_capability.id=fence.capability_id
   AND exact_capability.database_principal=SESSION_USER
   AND exact_capability.owner_user_id=fence.owner_user_id
   AND exact_capability.workspace_id=fence.workspace_id
   AND exact_capability.actor_user_id=fence.actor_user_id
   AND exact_capability.budget_reservation_id=fence.budget_reservation_id
   AND exact_capability.render_job_id=fence.render_job_id
   AND exact_capability.daily_plan_slot_id=fence.daily_plan_slot_id
   AND exact_capability.slot_attempt=fence.slot_attempt
   AND exact_capability.work_handoff_digest=fence.work_handoff_digest
   AND exact_capability.action=fence.action
   AND exact_capability.command_id=fence.command_id
   AND exact_capability.command_digest=fence.command_digest
  WHERE fence.id=p_execution_id
    AND fence.owner_user_id=p_owner_user_id AND fence.workspace_id=p_workspace_id
    AND fence.actor_user_id=p_actor_user_id
    AND fence.budget_reservation_id=p_budget_reservation_id
    AND fence.render_job_id=p_render_job_id
    AND fence.daily_plan_slot_id=p_daily_plan_slot_id
    AND fence.slot_attempt=p_slot_attempt
    AND fence.work_handoff_digest=p_work_handoff_digest
    AND fence.action=p_action AND fence.command_digest=p_command_digest
    AND fence.state='running' AND fence.fencing_token=p_run_fencing_token
    AND fence.lease_token=p_run_lease_token AND fence.lease_owner=p_actor_user_id
    AND fence.lease_expires_at>sampled_at
    AND exact_capability.consumed_at IS NOT NULL
  FOR UPDATE OF fence,exact_capability;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'live exact one-video asset execution denied' USING ERRCODE='42501';
  END IF;
END
$function$;

CREATE FUNCTION ai_media_worker_api.claim_exact_one_video_asset_ingest_v1(
  p_execution_id uuid,p_run_lease_token uuid,p_run_fencing_token bigint,p_command_digest text,
  p_actor_user_id text,p_owner_user_id text,p_workspace_id text,p_budget_reservation_id uuid,
  p_render_job_id uuid,p_daily_plan_slot_id uuid,p_slot_attempt integer,p_work_handoff_digest text,
  p_ingest_job_id uuid,p_worker_id text,p_lease_ms integer
) RETURNS TABLE(
  execution_id uuid,run_lease_token uuid,run_fencing_token bigint,command_digest text,actor_user_id text,
  owner_user_id text,workspace_id text,budget_reservation_id uuid,render_job_id uuid,
  daily_plan_slot_id uuid,slot_attempt integer,work_handoff_digest text,
  claim_outcome text,ingest_job_id uuid,provider_key text,remote_artifact_ref text,source_url text,
  expected_mime_type text,attempt integer,max_attempts integer,lease_owner text,lease_token text,
  fencing_token bigint,lease_expires_at timestamptz
) LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET row_security=on AS $function$
DECLARE context record;job public.ai_media_asset_ingest_jobs%ROWTYPE;
  sampled_at timestamptz:=pg_catalog.clock_timestamp();new_lease text:=pg_catalog.gen_random_uuid()::text;
BEGIN
  SELECT * INTO context FROM ai_media_worker_api.require_exact_one_video_asset_context_v1(
    p_execution_id,p_run_lease_token,p_run_fencing_token,p_command_digest,p_actor_user_id,
    p_owner_user_id,p_workspace_id,p_budget_reservation_id,p_render_job_id,p_daily_plan_slot_id,
    p_slot_attempt,p_work_handoff_digest,'ingest_asset');
  IF p_worker_id<>btrim(p_worker_id) OR length(p_worker_id) NOT BETWEEN 1 AND 120
    OR p_lease_ms NOT BETWEEN 1 AND 300000
  THEN RAISE EXCEPTION 'invalid exact asset ingest lease'; END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'ai-media:exact-ingest:'||p_owner_user_id||':'||p_workspace_id||':'||p_ingest_job_id::text,0));
  SELECT ingest.* INTO job
  FROM public.ai_media_asset_ingest_jobs ingest
  JOIN public.ai_media_render_jobs render
    ON render.id=ingest.render_job_id AND render.owner_user_id=ingest.owner_user_id
   AND render.workspace_id=ingest.workspace_id
  JOIN public.ai_media_provider_terminal_events terminal
    ON terminal.render_job_id=render.id AND terminal.owner_user_id=render.owner_user_id
   AND terminal.workspace_id=render.workspace_id AND terminal.terminal_state='completed'
   AND terminal.budget_reservation_id=p_budget_reservation_id
   AND terminal.daily_plan_slot_id=p_daily_plan_slot_id
  WHERE ingest.id=p_ingest_job_id AND ingest.owner_user_id=p_owner_user_id
    AND ingest.workspace_id=p_workspace_id AND ingest.render_job_id=p_render_job_id
    AND render.budget_reservation_id=p_budget_reservation_id
    AND render.daily_plan_slot_id=p_daily_plan_slot_id AND render.slot_attempt=p_slot_attempt
    AND render.work_handoff_digest=p_work_handoff_digest
  FOR UPDATE OF ingest,render;
  IF NOT FOUND THEN RAISE EXCEPTION 'exact asset ingest target denied' USING ERRCODE='42501'; END IF;

  IF job.state='leased' AND job.lease_expires_at<=sampled_at THEN
    IF job.lease_recoveries+1>=job.max_lease_recoveries THEN
      UPDATE public.ai_media_asset_ingest_jobs SET state='dead_letter',
        lease_recoveries=lease_recoveries+1,error_code='ingest_failed',
        dead_letter_at=sampled_at,lease_owner=NULL,lease_token=NULL,lease_expires_at=NULL,
        updated_at=sampled_at WHERE id=job.id;
      RETURN QUERY SELECT p_execution_id,p_run_lease_token,p_run_fencing_token,p_command_digest,p_actor_user_id,
        p_owner_user_id,p_workspace_id,p_budget_reservation_id,p_render_job_id,p_daily_plan_slot_id,
        p_slot_attempt,p_work_handoff_digest,'dead_letter'::text,job.id,job.provider_key,
        job.remote_artifact_ref,job.remote_url,job.expected_mime_type,job.attempts,job.max_attempts,
        NULL::text,NULL::text,job.fencing_token::bigint,NULL::timestamptz;
      RETURN;
    END IF;
    UPDATE public.ai_media_asset_ingest_jobs SET state='queued',
      lease_recoveries=lease_recoveries+1,available_at=sampled_at,
      lease_owner=NULL,lease_token=NULL,lease_expires_at=NULL,updated_at=sampled_at
    WHERE id=job.id RETURNING * INTO job;
  END IF;

  IF job.state IN ('queued','retry_wait') AND job.available_at<=sampled_at
    AND job.dead_letter_at IS NULL AND job.attempts<job.max_attempts THEN
    UPDATE public.ai_media_asset_ingest_jobs AS target SET state='leased',attempts=target.attempts+1,
      lease_owner=p_worker_id,lease_token=new_lease,
      lease_expires_at=sampled_at+(p_lease_ms::text||' milliseconds')::interval,
      fencing_token=target.fencing_token+1,updated_at=sampled_at
    WHERE target.id=job.id AND target.state IN ('queued','retry_wait')
      AND target.available_at<=sampled_at AND target.dead_letter_at IS NULL
    RETURNING * INTO job;
    RETURN QUERY SELECT p_execution_id,p_run_lease_token,p_run_fencing_token,p_command_digest,p_actor_user_id,
      p_owner_user_id,p_workspace_id,p_budget_reservation_id,p_render_job_id,p_daily_plan_slot_id,
      p_slot_attempt,p_work_handoff_digest,'claimed'::text,job.id,job.provider_key,
      job.remote_artifact_ref,job.remote_url,job.expected_mime_type,job.attempts,job.max_attempts,
      job.lease_owner,job.lease_token,job.fencing_token::bigint,job.lease_expires_at;
    RETURN;
  END IF;
  RETURN QUERY SELECT p_execution_id,p_run_lease_token,p_run_fencing_token,p_command_digest,p_actor_user_id,
    p_owner_user_id,p_workspace_id,p_budget_reservation_id,p_render_job_id,p_daily_plan_slot_id,
    p_slot_attempt,p_work_handoff_digest,
    CASE WHEN job.state='dead_letter' THEN 'dead_letter' ELSE 'idle' END::text,
    job.id,job.provider_key,job.remote_artifact_ref,job.remote_url,job.expected_mime_type,
    job.attempts,job.max_attempts,NULL::text,NULL::text,job.fencing_token::bigint,NULL::timestamptz;
END
$function$;

CREATE FUNCTION ai_media_worker_api.record_exact_one_video_asset_ingest_completed_v1(
  p_execution_id uuid,p_run_lease_token uuid,p_run_fencing_token bigint,p_command_digest text,
  p_actor_user_id text,p_owner_user_id text,p_workspace_id text,p_budget_reservation_id uuid,
  p_render_job_id uuid,p_daily_plan_slot_id uuid,p_slot_attempt integer,p_work_handoff_digest text,
  p_ingest_job_id uuid,p_ingest_lease_token text,p_ingest_fencing_token bigint,
  p_owned_object_key text,p_sha256 text,p_size_bytes bigint
) RETURNS TABLE(
  execution_id uuid,run_lease_token uuid,run_fencing_token bigint,command_digest text,actor_user_id text,
  owner_user_id text,workspace_id text,budget_reservation_id uuid,render_job_id uuid,
  daily_plan_slot_id uuid,slot_attempt integer,work_handoff_digest text,
  applied boolean,ingest_job_id uuid,owned_object_key text,sha256 text,size_bytes bigint
) LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET row_security=on AS $function$
DECLARE context record;job public.ai_media_asset_ingest_jobs%ROWTYPE;
  updated_job public.ai_media_asset_ingest_jobs%ROWTYPE;
  sampled_at timestamptz:=pg_catalog.clock_timestamp();did_apply boolean:=false;
BEGIN
  SELECT * INTO context FROM ai_media_worker_api.require_exact_one_video_asset_context_v1(
    p_execution_id,p_run_lease_token,p_run_fencing_token,p_command_digest,p_actor_user_id,
    p_owner_user_id,p_workspace_id,p_budget_reservation_id,p_render_job_id,p_daily_plan_slot_id,
    p_slot_attempt,p_work_handoff_digest,'ingest_asset');
  IF p_ingest_lease_token<>btrim(p_ingest_lease_token)
    OR length(p_ingest_lease_token) NOT BETWEEN 1 AND 120
    OR p_owned_object_key<>btrim(p_owned_object_key) OR length(p_owned_object_key) NOT BETWEEN 1 AND 2000
    OR p_sha256!~'^[0-9a-f]{64}$' OR p_size_bytes NOT BETWEEN 1 AND 10737418240
  THEN RAISE EXCEPTION 'invalid exact asset completion'; END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'ai-media:exact-ingest:'||p_owner_user_id||':'||p_workspace_id||':'||p_ingest_job_id::text,0));
  SELECT ingest.* INTO job
  FROM public.ai_media_asset_ingest_jobs ingest
  JOIN public.ai_media_render_jobs render
    ON render.id=ingest.render_job_id AND render.owner_user_id=ingest.owner_user_id
   AND render.workspace_id=ingest.workspace_id
  WHERE ingest.id=p_ingest_job_id AND ingest.owner_user_id=p_owner_user_id
    AND ingest.workspace_id=p_workspace_id AND ingest.render_job_id=p_render_job_id
    AND render.budget_reservation_id=p_budget_reservation_id
    AND render.daily_plan_slot_id=p_daily_plan_slot_id AND render.slot_attempt=p_slot_attempt
    AND render.work_handoff_digest=p_work_handoff_digest
  FOR UPDATE OF ingest,render;
  IF NOT FOUND THEN RAISE EXCEPTION 'exact asset ingest target denied' USING ERRCODE='42501'; END IF;
  IF job.state='completed' THEN
    RETURN QUERY SELECT p_execution_id,p_run_lease_token,p_run_fencing_token,p_command_digest,p_actor_user_id,
      p_owner_user_id,p_workspace_id,p_budget_reservation_id,p_render_job_id,p_daily_plan_slot_id,
      p_slot_attempt,p_work_handoff_digest,
      (job.owned_object_key=p_owned_object_key AND job.sha256=p_sha256 AND job.size_bytes=p_size_bytes),
      job.id,job.owned_object_key,job.sha256,job.size_bytes;
    RETURN;
  END IF;
  UPDATE public.ai_media_asset_ingest_jobs AS target
  SET state='completed',owned_object_key=p_owned_object_key,
    sha256=p_sha256,size_bytes=p_size_bytes,completed_at=sampled_at,error_code=NULL,error_message=NULL,
    lease_owner=NULL,lease_token=NULL,lease_expires_at=NULL,updated_at=sampled_at
  WHERE target.id=p_ingest_job_id AND target.owner_user_id=p_owner_user_id
    AND target.workspace_id=p_workspace_id AND target.render_job_id=p_render_job_id
    AND target.state='leased' AND target.lease_token=p_ingest_lease_token
    AND target.fencing_token=p_ingest_fencing_token
    AND target.lease_expires_at>sampled_at RETURNING * INTO updated_job;
  IF FOUND THEN job=updated_job;did_apply=true; END IF;
  RETURN QUERY SELECT p_execution_id,p_run_lease_token,p_run_fencing_token,p_command_digest,p_actor_user_id,
    p_owner_user_id,p_workspace_id,p_budget_reservation_id,p_render_job_id,p_daily_plan_slot_id,
    p_slot_attempt,p_work_handoff_digest,did_apply,job.id,job.owned_object_key,job.sha256,job.size_bytes;
END
$function$;

CREATE FUNCTION ai_media_worker_api.record_exact_one_video_asset_ingest_failed_v1(
  p_execution_id uuid,p_run_lease_token uuid,p_run_fencing_token bigint,p_command_digest text,
  p_actor_user_id text,p_owner_user_id text,p_workspace_id text,p_budget_reservation_id uuid,
  p_render_job_id uuid,p_daily_plan_slot_id uuid,p_slot_attempt integer,p_work_handoff_digest text,
  p_ingest_job_id uuid,p_ingest_lease_token text,p_ingest_fencing_token bigint,
  p_error_code text,p_retryable boolean,p_retry_at timestamptz
) RETURNS TABLE(
  execution_id uuid,run_lease_token uuid,run_fencing_token bigint,command_digest text,actor_user_id text,
  owner_user_id text,workspace_id text,budget_reservation_id uuid,render_job_id uuid,
  daily_plan_slot_id uuid,slot_attempt integer,work_handoff_digest text,
  applied boolean,ingest_job_id uuid,state text,error_code text,retry_at timestamptz
) LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET row_security=on AS $function$
DECLARE context record;job public.ai_media_asset_ingest_jobs%ROWTYPE;
  updated_job public.ai_media_asset_ingest_jobs%ROWTYPE;
  sampled_at timestamptz:=pg_catalog.clock_timestamp();next_state text;did_apply boolean:=false;
BEGIN
  SELECT * INTO context FROM ai_media_worker_api.require_exact_one_video_asset_context_v1(
    p_execution_id,p_run_lease_token,p_run_fencing_token,p_command_digest,p_actor_user_id,
    p_owner_user_id,p_workspace_id,p_budget_reservation_id,p_render_job_id,p_daily_plan_slot_id,
    p_slot_attempt,p_work_handoff_digest,'ingest_asset');
  IF p_ingest_lease_token<>btrim(p_ingest_lease_token)
    OR length(p_ingest_lease_token) NOT BETWEEN 1 AND 120
    OR p_error_code NOT IN ('source_rejected','source_unavailable','mime_rejected','size_exceeded',
      'chunk_exceeded','invalid_mp4','storage_failed','ingest_failed')
    OR NOT isfinite(p_retry_at)
  THEN RAISE EXCEPTION 'invalid exact asset failure'; END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'ai-media:exact-ingest:'||p_owner_user_id||':'||p_workspace_id||':'||p_ingest_job_id::text,0));
  SELECT ingest.* INTO job
  FROM public.ai_media_asset_ingest_jobs ingest
  JOIN public.ai_media_render_jobs render
    ON render.id=ingest.render_job_id AND render.owner_user_id=ingest.owner_user_id
   AND render.workspace_id=ingest.workspace_id
  WHERE ingest.id=p_ingest_job_id AND ingest.owner_user_id=p_owner_user_id
    AND ingest.workspace_id=p_workspace_id AND ingest.render_job_id=p_render_job_id
    AND render.budget_reservation_id=p_budget_reservation_id
    AND render.daily_plan_slot_id=p_daily_plan_slot_id AND render.slot_attempt=p_slot_attempt
    AND render.work_handoff_digest=p_work_handoff_digest
  FOR UPDATE OF ingest,render;
  IF NOT FOUND THEN RAISE EXCEPTION 'exact asset ingest target denied' USING ERRCODE='42501'; END IF;
  next_state=CASE WHEN p_retryable AND job.attempts<job.max_attempts THEN 'retry_wait' ELSE 'dead_letter' END;
  IF job.state IN ('retry_wait','dead_letter') THEN
    RETURN QUERY SELECT p_execution_id,p_run_lease_token,p_run_fencing_token,p_command_digest,p_actor_user_id,
      p_owner_user_id,p_workspace_id,p_budget_reservation_id,p_render_job_id,p_daily_plan_slot_id,
      p_slot_attempt,p_work_handoff_digest,
      (job.state=next_state AND job.error_code=p_error_code AND job.available_at=p_retry_at),
      job.id,job.state,job.error_code,CASE WHEN job.state='retry_wait' THEN job.available_at END;
    RETURN;
  END IF;
  UPDATE public.ai_media_asset_ingest_jobs AS target SET state=next_state,available_at=p_retry_at,
    error_code=p_error_code,error_message=NULL,
    dead_letter_at=CASE WHEN next_state='dead_letter' THEN sampled_at ELSE NULL END,
    lease_owner=NULL,lease_token=NULL,lease_expires_at=NULL,updated_at=sampled_at
  WHERE target.id=p_ingest_job_id AND target.owner_user_id=p_owner_user_id
    AND target.workspace_id=p_workspace_id AND target.render_job_id=p_render_job_id
    AND target.state='leased' AND target.lease_token=p_ingest_lease_token
    AND target.fencing_token=p_ingest_fencing_token
    AND target.lease_expires_at>sampled_at RETURNING * INTO updated_job;
  IF FOUND THEN job=updated_job;did_apply=true; END IF;
  RETURN QUERY SELECT p_execution_id,p_run_lease_token,p_run_fencing_token,p_command_digest,p_actor_user_id,
    p_owner_user_id,p_workspace_id,p_budget_reservation_id,p_render_job_id,p_daily_plan_slot_id,
    p_slot_attempt,p_work_handoff_digest,did_apply,job.id,
    CASE WHEN did_apply THEN job.state ELSE next_state END,
    CASE WHEN did_apply THEN job.error_code ELSE p_error_code END,
    CASE WHEN (CASE WHEN did_apply THEN job.state ELSE next_state END)='retry_wait'
      THEN CASE WHEN did_apply THEN job.available_at ELSE p_retry_at END END;
END
$function$;

CREATE FUNCTION ai_media_worker_api.load_exact_one_video_asset_link_v1(
  p_execution_id uuid,p_run_lease_token uuid,p_run_fencing_token bigint,p_command_digest text,
  p_actor_user_id text,p_owner_user_id text,p_workspace_id text,p_budget_reservation_id uuid,
  p_render_job_id uuid,p_daily_plan_slot_id uuid,p_slot_attempt integer,p_work_handoff_digest text,
  p_ingest_job_id uuid
) RETURNS TABLE(
  execution_id uuid,run_lease_token uuid,run_fencing_token bigint,command_digest text,actor_user_id text,
  owner_user_id text,workspace_id text,budget_reservation_id uuid,render_job_id uuid,
  daily_plan_slot_id uuid,slot_attempt integer,work_handoff_digest text,
  ingest_job_id uuid,link_state text,media_asset_id uuid,owned_object_key text,sha256 text,
  size_bytes bigint,expected_mime_type text,ingest_fencing_token bigint,
  ingest_created_at timestamptz,ingest_updated_at timestamptz
) LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET row_security=on AS $function$
DECLARE context record;
BEGIN
  SELECT * INTO context FROM ai_media_worker_api.require_exact_one_video_asset_context_v1(
    p_execution_id,p_run_lease_token,p_run_fencing_token,p_command_digest,p_actor_user_id,
    p_owner_user_id,p_workspace_id,p_budget_reservation_id,p_render_job_id,p_daily_plan_slot_id,
    p_slot_attempt,p_work_handoff_digest,'link_asset');
  RETURN QUERY SELECT p_execution_id,p_run_lease_token,p_run_fencing_token,p_command_digest,p_actor_user_id,
    p_owner_user_id,p_workspace_id,p_budget_reservation_id,p_render_job_id,p_daily_plan_slot_id,
    p_slot_attempt,p_work_handoff_digest,ingest.id,
    CASE WHEN ingest.media_asset_id IS NULL THEN 'completed_unlinked' ELSE 'linked' END::text,
    ingest.media_asset_id,ingest.owned_object_key,ingest.sha256,ingest.size_bytes,
    ingest.expected_mime_type,ingest.fencing_token::bigint,
    ingest.created_at,ingest.updated_at
  FROM public.ai_media_asset_ingest_jobs ingest
  JOIN public.ai_media_render_jobs render
    ON render.id=ingest.render_job_id AND render.owner_user_id=ingest.owner_user_id
   AND render.workspace_id=ingest.workspace_id
  WHERE ingest.id=p_ingest_job_id AND ingest.owner_user_id=p_owner_user_id
    AND ingest.workspace_id=p_workspace_id AND ingest.render_job_id=p_render_job_id
    AND ingest.state='completed' AND ingest.owned_object_key IS NOT NULL
    AND ingest.sha256~'^[0-9a-f]{64}$' AND ingest.size_bytes>0
    AND render.budget_reservation_id=p_budget_reservation_id
    AND render.daily_plan_slot_id=p_daily_plan_slot_id AND render.slot_attempt=p_slot_attempt
    AND render.work_handoff_digest=p_work_handoff_digest;
END
$function$;

CREATE FUNCTION ai_media_worker_api.record_exact_one_video_asset_linked_v1(
  p_execution_id uuid,p_run_lease_token uuid,p_run_fencing_token bigint,p_command_digest text,
  p_actor_user_id text,p_owner_user_id text,p_workspace_id text,p_budget_reservation_id uuid,
  p_render_job_id uuid,p_daily_plan_slot_id uuid,p_slot_attempt integer,p_work_handoff_digest text,
  p_ingest_job_id uuid,p_ingest_fencing_token bigint,p_owned_object_key text,p_sha256 text,
  p_media_asset_id uuid
) RETURNS TABLE(
  execution_id uuid,run_lease_token uuid,run_fencing_token bigint,command_digest text,actor_user_id text,
  owner_user_id text,workspace_id text,budget_reservation_id uuid,render_job_id uuid,
  daily_plan_slot_id uuid,slot_attempt integer,work_handoff_digest text,
  applied boolean,ingest_job_id uuid,media_asset_id uuid,render_completed boolean
) LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET row_security=on AS $function$
DECLARE context record;job public.ai_media_asset_ingest_jobs%ROWTYPE;changed uuid;
  sampled_at timestamptz:=pg_catalog.clock_timestamp();
BEGIN
  SELECT * INTO context FROM ai_media_worker_api.require_exact_one_video_asset_context_v1(
    p_execution_id,p_run_lease_token,p_run_fencing_token,p_command_digest,p_actor_user_id,
    p_owner_user_id,p_workspace_id,p_budget_reservation_id,p_render_job_id,p_daily_plan_slot_id,
    p_slot_attempt,p_work_handoff_digest,'link_asset');
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'ai-media:exact-link:'||p_owner_user_id||':'||p_workspace_id||':'||p_ingest_job_id::text,0));
  IF p_owned_object_key<>btrim(p_owned_object_key)
    OR length(p_owned_object_key) NOT BETWEEN 1 AND 2000 OR p_sha256!~'^[0-9a-f]{64}$'
  THEN RAISE EXCEPTION 'invalid exact asset link evidence'; END IF;
  SELECT ingest.* INTO job
  FROM public.ai_media_asset_ingest_jobs ingest
  JOIN public.ai_media_assets asset
    ON asset.id=p_media_asset_id AND asset.owner_user_id=ingest.owner_user_id
   AND asset.workspace_id=ingest.workspace_id AND asset.kind='video'
   AND asset.status='ready' AND asset.deleted_at IS NULL
   AND asset.checksum=p_sha256 AND asset.storage_key=p_owned_object_key
   AND asset.mime_type=ingest.expected_mime_type
   AND asset.byte_size=ingest.size_bytes
   AND asset.render_job_id=ingest.render_job_id
  WHERE ingest.id=p_ingest_job_id AND ingest.owner_user_id=p_owner_user_id
    AND ingest.workspace_id=p_workspace_id AND ingest.render_job_id=p_render_job_id
    AND ingest.state='completed' AND ingest.fencing_token=p_ingest_fencing_token
    AND ingest.sha256=p_sha256 AND ingest.owned_object_key=p_owned_object_key
    AND (ingest.media_asset_id IS NULL OR ingest.media_asset_id=p_media_asset_id)
  FOR UPDATE OF ingest,asset;
  IF NOT FOUND THEN
    RETURN QUERY SELECT p_execution_id,p_run_lease_token,p_run_fencing_token,p_command_digest,p_actor_user_id,
      p_owner_user_id,p_workspace_id,p_budget_reservation_id,p_render_job_id,p_daily_plan_slot_id,
      p_slot_attempt,p_work_handoff_digest,false,p_ingest_job_id,NULL::uuid,false;
    RETURN;
  END IF;
  UPDATE public.ai_media_asset_ingest_jobs AS target
  SET media_asset_id=p_media_asset_id,updated_at=sampled_at
  WHERE target.id=job.id
    AND (target.media_asset_id IS NULL OR target.media_asset_id=p_media_asset_id)
  RETURNING target.id INTO changed;
  IF changed IS NULL THEN
    RETURN QUERY SELECT p_execution_id,p_run_lease_token,p_run_fencing_token,p_command_digest,p_actor_user_id,
      p_owner_user_id,p_workspace_id,p_budget_reservation_id,p_render_job_id,p_daily_plan_slot_id,
      p_slot_attempt,p_work_handoff_digest,false,p_ingest_job_id,NULL::uuid,false;
    RETURN;
  END IF;
  UPDATE public.ai_media_render_jobs AS target
  SET status='completed',stage='completed',progress=100,
    output_media_asset_id=p_media_asset_id,output_url=NULL,
    completed_at=COALESCE(target.completed_at,sampled_at),
    error_code=NULL,error_message=NULL,updated_at=sampled_at
  WHERE target.id=p_render_job_id AND target.owner_user_id=p_owner_user_id
    AND target.workspace_id=p_workspace_id
    AND target.budget_reservation_id=p_budget_reservation_id
    AND target.daily_plan_slot_id=p_daily_plan_slot_id
    AND target.slot_attempt=p_slot_attempt
    AND target.work_handoff_digest=p_work_handoff_digest
    AND target.provider_terminal_state='completed'
    AND ((target.stage IN ('artifact_ingest_queued','artifact_ingest_retrying')
        AND target.output_media_asset_id IS NULL)
      OR (target.stage='completed' AND target.status='completed' AND target.progress=100
        AND target.output_media_asset_id=p_media_asset_id))
  RETURNING target.id INTO changed;
  IF changed IS NULL THEN RAISE EXCEPTION 'exact asset render link CAS failed'; END IF;
  RETURN QUERY SELECT p_execution_id,p_run_lease_token,p_run_fencing_token,p_command_digest,p_actor_user_id,
    p_owner_user_id,p_workspace_id,p_budget_reservation_id,p_render_job_id,p_daily_plan_slot_id,
    p_slot_attempt,p_work_handoff_digest,true,p_ingest_job_id,p_media_asset_id,true;
END
$function$;

GRANT SELECT,UPDATE ON TABLE public.ai_media_asset_ingest_jobs TO ai_media_admitted_fn_owner;
GRANT SELECT ON TABLE public.ai_media_assets TO ai_media_admitted_fn_owner;
GRANT UPDATE(id) ON TABLE public.ai_media_assets TO ai_media_admitted_fn_owner;
REVOKE ALL ON TABLE public.ai_media_asset_ingest_jobs,public.ai_media_assets
  FROM PUBLIC,ai_media_one_video_run_executor;

REVOKE ALL ON FUNCTION ai_media_worker_api.require_exact_one_video_asset_context_v1(
  uuid,uuid,bigint,text,text,text,text,uuid,uuid,uuid,integer,text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION ai_media_worker_api.claim_exact_one_video_asset_ingest_v1(
  uuid,uuid,bigint,text,text,text,text,uuid,uuid,uuid,integer,text,uuid,text,integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION ai_media_worker_api.record_exact_one_video_asset_ingest_completed_v1(
  uuid,uuid,bigint,text,text,text,text,uuid,uuid,uuid,integer,text,uuid,text,bigint,text,text,bigint) FROM PUBLIC;
REVOKE ALL ON FUNCTION ai_media_worker_api.record_exact_one_video_asset_ingest_failed_v1(
  uuid,uuid,bigint,text,text,text,text,uuid,uuid,uuid,integer,text,uuid,text,bigint,text,boolean,timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION ai_media_worker_api.load_exact_one_video_asset_link_v1(
  uuid,uuid,bigint,text,text,text,text,uuid,uuid,uuid,integer,text,uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION ai_media_worker_api.record_exact_one_video_asset_linked_v1(
  uuid,uuid,bigint,text,text,text,text,uuid,uuid,uuid,integer,text,uuid,bigint,text,text,uuid) FROM PUBLIC;

ALTER FUNCTION ai_media_worker_api.require_exact_one_video_asset_context_v1(
  uuid,uuid,bigint,text,text,text,text,uuid,uuid,uuid,integer,text,text)
  OWNER TO ai_media_admitted_fn_owner;
ALTER FUNCTION ai_media_worker_api.claim_exact_one_video_asset_ingest_v1(
  uuid,uuid,bigint,text,text,text,text,uuid,uuid,uuid,integer,text,uuid,text,integer)
  OWNER TO ai_media_admitted_fn_owner;
ALTER FUNCTION ai_media_worker_api.record_exact_one_video_asset_ingest_completed_v1(
  uuid,uuid,bigint,text,text,text,text,uuid,uuid,uuid,integer,text,uuid,text,bigint,text,text,bigint)
  OWNER TO ai_media_admitted_fn_owner;
ALTER FUNCTION ai_media_worker_api.record_exact_one_video_asset_ingest_failed_v1(
  uuid,uuid,bigint,text,text,text,text,uuid,uuid,uuid,integer,text,uuid,text,bigint,text,boolean,timestamptz)
  OWNER TO ai_media_admitted_fn_owner;
ALTER FUNCTION ai_media_worker_api.load_exact_one_video_asset_link_v1(
  uuid,uuid,bigint,text,text,text,text,uuid,uuid,uuid,integer,text,uuid)
  OWNER TO ai_media_admitted_fn_owner;
ALTER FUNCTION ai_media_worker_api.record_exact_one_video_asset_linked_v1(
  uuid,uuid,bigint,text,text,text,text,uuid,uuid,uuid,integer,text,uuid,bigint,text,text,uuid)
  OWNER TO ai_media_admitted_fn_owner;

GRANT EXECUTE ON FUNCTION ai_media_worker_api.claim_exact_one_video_asset_ingest_v1(
  uuid,uuid,bigint,text,text,text,text,uuid,uuid,uuid,integer,text,uuid,text,integer)
  TO ai_media_one_video_run_executor;
GRANT EXECUTE ON FUNCTION ai_media_worker_api.record_exact_one_video_asset_ingest_completed_v1(
  uuid,uuid,bigint,text,text,text,text,uuid,uuid,uuid,integer,text,uuid,text,bigint,text,text,bigint)
  TO ai_media_one_video_run_executor;
GRANT EXECUTE ON FUNCTION ai_media_worker_api.record_exact_one_video_asset_ingest_failed_v1(
  uuid,uuid,bigint,text,text,text,text,uuid,uuid,uuid,integer,text,uuid,text,bigint,text,boolean,timestamptz)
  TO ai_media_one_video_run_executor;
GRANT EXECUTE ON FUNCTION ai_media_worker_api.load_exact_one_video_asset_link_v1(
  uuid,uuid,bigint,text,text,text,text,uuid,uuid,uuid,integer,text,uuid)
  TO ai_media_one_video_run_executor;
GRANT EXECUTE ON FUNCTION ai_media_worker_api.record_exact_one_video_asset_linked_v1(
  uuid,uuid,bigint,text,text,text,text,uuid,uuid,uuid,integer,text,uuid,bigint,text,text,uuid)
  TO ai_media_one_video_run_executor;

COMMIT;
