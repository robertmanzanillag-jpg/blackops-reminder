-- AI Media Studio PR36: derive the exact owned-asset target from a live PR32 command.
-- Review artifact only. Do not apply automatically.
-- No provider/network request, download, storage I/O, spend, publication, worker
-- start, deployment, migration application, or public-route mount.
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
  THEN RAISE EXCEPTION 'PR36 requires safe precreated NOLOGIN NOINHERIT ai_media_one_video_run_executor'; END IF;
  IF current_setting('server_version_num')::integer<160000
    OR to_regprocedure('ai_media_worker_api.require_exact_one_video_asset_context_v1(uuid,uuid,bigint,text,text,text,text,uuid,uuid,uuid,integer,text,text)') IS NULL
    OR to_regclass('public.ai_media_asset_ingest_jobs') IS NULL
    OR to_regclass('public.ai_media_render_jobs') IS NULL
    OR to_regclass('public.ai_media_provider_terminal_events') IS NULL
    OR to_regprocedure('ai_media_worker_api.load_exact_one_video_asset_target_v1(uuid,uuid,bigint,text,text,text,text,uuid,uuid,uuid,integer,text,text)') IS NOT NULL
  THEN RAISE EXCEPTION 'PR36 requires PR35 and an unused exact asset target surface'; END IF;
END
$preflight$;

CREATE FUNCTION ai_media_worker_api.load_exact_one_video_asset_target_v1(
  p_execution_id uuid,p_run_lease_token uuid,p_run_fencing_token bigint,p_command_digest text,
  p_actor_user_id text,p_owner_user_id text,p_workspace_id text,p_budget_reservation_id uuid,
  p_render_job_id uuid,p_daily_plan_slot_id uuid,p_slot_attempt integer,p_work_handoff_digest text,
  p_action text
) RETURNS TABLE(
  execution_id uuid,run_lease_token uuid,run_fencing_token bigint,command_digest text,
  actor_user_id text,owner_user_id text,workspace_id text,budget_reservation_id uuid,
  render_job_id uuid,daily_plan_slot_id uuid,slot_attempt integer,work_handoff_digest text,
  action text,ingest_job_id uuid
) LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET row_security=on AS $function$
DECLARE exact_context record; target_job_id uuid;
BEGIN
  IF p_action NOT IN ('ingest_asset','link_asset') THEN
    RAISE EXCEPTION 'invalid exact asset target action';
  END IF;
  SELECT * INTO exact_context FROM ai_media_worker_api.require_exact_one_video_asset_context_v1(
    p_execution_id,p_run_lease_token,p_run_fencing_token,p_command_digest,p_actor_user_id,
    p_owner_user_id,p_workspace_id,p_budget_reservation_id,p_render_job_id,p_daily_plan_slot_id,
    p_slot_attempt,p_work_handoff_digest,p_action);
  SELECT ingest.id INTO target_job_id
  FROM public.ai_media_asset_ingest_jobs ingest
  JOIN public.ai_media_render_jobs render
    ON render.id=ingest.render_job_id AND render.owner_user_id=ingest.owner_user_id
   AND render.workspace_id=ingest.workspace_id
  JOIN public.ai_media_provider_terminal_events terminal
    ON terminal.render_job_id=render.id AND terminal.owner_user_id=render.owner_user_id
   AND terminal.workspace_id=render.workspace_id AND terminal.terminal_state='completed'
   AND terminal.budget_reservation_id=p_budget_reservation_id
   AND terminal.daily_plan_slot_id=p_daily_plan_slot_id
  WHERE ingest.owner_user_id=p_owner_user_id AND ingest.workspace_id=p_workspace_id
    AND ingest.render_job_id=p_render_job_id
    AND render.budget_reservation_id=p_budget_reservation_id
    AND render.daily_plan_slot_id=p_daily_plan_slot_id AND render.slot_attempt=p_slot_attempt
    AND render.work_handoff_digest=p_work_handoff_digest;
  IF target_job_id IS NULL THEN RETURN; END IF;
  RETURN QUERY SELECT p_execution_id,p_run_lease_token,p_run_fencing_token,p_command_digest,
    p_actor_user_id,p_owner_user_id,p_workspace_id,p_budget_reservation_id,p_render_job_id,
    p_daily_plan_slot_id,p_slot_attempt,p_work_handoff_digest,p_action,target_job_id;
END
$function$;
REVOKE ALL ON FUNCTION ai_media_worker_api.load_exact_one_video_asset_target_v1(
  uuid,uuid,bigint,text,text,text,text,uuid,uuid,uuid,integer,text,text) FROM PUBLIC;
ALTER FUNCTION ai_media_worker_api.load_exact_one_video_asset_target_v1(
  uuid,uuid,bigint,text,text,text,text,uuid,uuid,uuid,integer,text,text)
  OWNER TO ai_media_admitted_fn_owner;
GRANT EXECUTE ON FUNCTION ai_media_worker_api.load_exact_one_video_asset_target_v1(
  uuid,uuid,bigint,text,text,text,text,uuid,uuid,uuid,integer,text,text)
  TO ai_media_one_video_run_executor;
COMMIT;
