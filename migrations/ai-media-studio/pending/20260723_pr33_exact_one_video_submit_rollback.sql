-- AI Media Studio PR33 rollback.
-- Review artifact only. It refuses to erase callable history after exact submit evidence exists.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='15min';
SET LOCAL search_path=pg_catalog;

DO $guard$
BEGIN
  IF to_regprocedure('ai_media_worker_api.claim_exact_one_video_submit_v1(uuid,uuid,bigint,text,text,text,text,uuid,uuid,uuid,integer,text,text,integer)') IS NULL
  THEN RAISE EXCEPTION 'PR33 exact submit surface is not installed'; END IF;
  IF EXISTS (
    SELECT 1
    FROM public.ai_media_exact_one_video_run_fences fence
    JOIN public.ai_media_provider_submission_attempts attempt
      ON attempt.owner_user_id=fence.owner_user_id
     AND attempt.workspace_id=fence.workspace_id
     AND attempt.budget_reservation_id=fence.budget_reservation_id
     AND attempt.render_job_id=fence.render_job_id
     AND attempt.daily_plan_slot_id=fence.daily_plan_slot_id
     AND attempt.slot_attempt=fence.slot_attempt
     AND attempt.work_handoff_digest=fence.work_handoff_digest
    WHERE fence.action='activate_and_submit'
      AND attempt.state IN ('claimed','authorized','confirmed','ambiguous','reconciled_no_submit')
  ) THEN
    RAISE EXCEPTION 'rollback preserves exact one-video submit claim, authorization, and outcome evidence';
  END IF;
END
$guard$;

REVOKE EXECUTE ON FUNCTION ai_media_worker_api.claim_exact_one_video_submit_v1(
  uuid,uuid,bigint,text,text,text,text,uuid,uuid,uuid,integer,text,text,integer)
  FROM ai_media_one_video_run_executor;
REVOKE EXECUTE ON FUNCTION ai_media_worker_api.authorize_exact_one_video_submit_v1(
  uuid,uuid,bigint,text,text,text,text,uuid,uuid,uuid,integer,text,uuid,bigint,uuid,text)
  FROM ai_media_one_video_run_executor;
REVOKE EXECUTE ON FUNCTION ai_media_worker_api.record_exact_one_video_submit_confirmed_v1(
  uuid,uuid,bigint,text,text,text,text,uuid,uuid,uuid,integer,text,uuid,bigint,text,uuid,text,text,text)
  FROM ai_media_one_video_run_executor;
REVOKE EXECUTE ON FUNCTION ai_media_worker_api.record_exact_one_video_submit_ambiguous_v1(
  uuid,uuid,bigint,text,text,text,text,uuid,uuid,uuid,integer,text,uuid,bigint,text,uuid,text,text)
  FROM ai_media_one_video_run_executor;

DROP FUNCTION ai_media_worker_api.record_exact_one_video_submit_ambiguous_v1(
  uuid,uuid,bigint,text,text,text,text,uuid,uuid,uuid,integer,text,uuid,bigint,text,uuid,text,text);
DROP FUNCTION ai_media_worker_api.record_exact_one_video_submit_confirmed_v1(
  uuid,uuid,bigint,text,text,text,text,uuid,uuid,uuid,integer,text,uuid,bigint,text,uuid,text,text,text);
DROP FUNCTION ai_media_worker_api.authorize_exact_one_video_submit_v1(
  uuid,uuid,bigint,text,text,text,text,uuid,uuid,uuid,integer,text,uuid,bigint,uuid,text);
DROP FUNCTION ai_media_worker_api.claim_exact_one_video_submit_v1(
  uuid,uuid,bigint,text,text,text,text,uuid,uuid,uuid,integer,text,text,integer);
DROP FUNCTION ai_media_worker_api.require_exact_one_video_submit_context_v1(
  uuid,uuid,bigint,text,text,text,text,uuid,uuid,uuid,integer,text,text,text,integer);

COMMIT;
