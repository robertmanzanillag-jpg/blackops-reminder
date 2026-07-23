-- AI Media Studio PR34 rollback.
-- Review artifact only. It refuses to erase callable history after exact reconcile/terminal evidence exists.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='15min';
SET LOCAL search_path=pg_catalog;

DO $guard$
BEGIN
  IF to_regprocedure('ai_media_worker_api.claim_exact_one_video_reconciliation_v1(uuid,uuid,bigint,text,text,text,text,uuid,uuid,uuid,integer,text,text,integer)') IS NULL
  THEN RAISE EXCEPTION 'PR34 exact reconcile surface is not installed'; END IF;
  IF EXISTS (
    SELECT 1
    FROM public.ai_media_exact_one_video_run_fences fence
    JOIN public.ai_media_provider_submission_attempts attempt
      ON attempt.owner_user_id=fence.owner_user_id AND attempt.workspace_id=fence.workspace_id
     AND attempt.budget_reservation_id=fence.budget_reservation_id
     AND attempt.render_job_id=fence.render_job_id AND attempt.daily_plan_slot_id=fence.daily_plan_slot_id
     AND attempt.slot_attempt=fence.slot_attempt AND attempt.work_handoff_digest=fence.work_handoff_digest
    WHERE fence.action='reconcile_submission'
      AND (attempt.reconciliation_fencing_token>0
        OR attempt.state IN ('confirmed','reconciled_no_submit'))
  ) OR EXISTS (
    SELECT 1
    FROM public.ai_media_exact_one_video_run_fences fence
    JOIN public.ai_media_provider_submission_attempts attempt
      ON attempt.owner_user_id=fence.owner_user_id AND attempt.workspace_id=fence.workspace_id
     AND attempt.budget_reservation_id=fence.budget_reservation_id
     AND attempt.render_job_id=fence.render_job_id AND attempt.daily_plan_slot_id=fence.daily_plan_slot_id
     AND attempt.slot_attempt=fence.slot_attempt AND attempt.work_handoff_digest=fence.work_handoff_digest
    JOIN public.ai_media_provider_terminal_checks terminal_check
      ON terminal_check.owner_user_id=attempt.owner_user_id
     AND terminal_check.workspace_id=attempt.workspace_id
     AND terminal_check.submission_attempt_id=attempt.id
    WHERE fence.action='observe_terminal'
  ) THEN
    RAISE EXCEPTION 'rollback preserves exact one-video reconciliation and terminal evidence';
  END IF;
END
$guard$;

REVOKE EXECUTE ON FUNCTION ai_media_worker_api.claim_exact_one_video_reconciliation_v1(
  uuid,uuid,bigint,text,text,text,text,uuid,uuid,uuid,integer,text,text,integer) FROM ai_media_one_video_run_executor;
REVOKE EXECUTE ON FUNCTION ai_media_worker_api.release_exact_one_video_reconciliation_unknown_v1(
  uuid,uuid,bigint,text,text,text,text,uuid,uuid,uuid,integer,text,uuid,bigint,text,uuid,bigint) FROM ai_media_one_video_run_executor;
REVOKE EXECUTE ON FUNCTION ai_media_worker_api.record_exact_one_video_reconciled_confirmed_v1(
  uuid,uuid,bigint,text,text,text,text,uuid,uuid,uuid,integer,text,uuid,bigint,text,uuid,bigint,text,text,text) FROM ai_media_one_video_run_executor;
REVOKE EXECUTE ON FUNCTION ai_media_worker_api.finalize_exact_one_video_reconciled_no_submit_v1(
  uuid,uuid,bigint,text,text,text,text,uuid,uuid,uuid,integer,text,uuid,bigint,text,uuid,bigint,text,uuid,text,integer,text,timestamptz,text) FROM ai_media_one_video_run_executor;
REVOKE EXECUTE ON FUNCTION ai_media_worker_api.claim_exact_one_video_terminal_check_v1(
  uuid,uuid,bigint,text,text,text,text,uuid,uuid,uuid,integer,text,text,integer) FROM ai_media_one_video_run_executor;
REVOKE EXECUTE ON FUNCTION ai_media_worker_api.release_exact_one_video_terminal_check_unknown_v1(
  uuid,uuid,bigint,text,text,text,text,uuid,uuid,uuid,integer,text,uuid,uuid,bigint,text,timestamptz,text) FROM ai_media_one_video_run_executor;
REVOKE EXECUTE ON FUNCTION ai_media_worker_api.record_exact_one_video_provider_terminal_v1(
  uuid,uuid,bigint,text,text,text,text,uuid,uuid,uuid,integer,text,uuid,uuid,bigint,uuid,bigint,text,uuid,text,integer,text,text,text,text,timestamptz,text) FROM ai_media_one_video_run_executor;

DROP FUNCTION ai_media_worker_api.record_exact_one_video_provider_terminal_v1(
  uuid,uuid,bigint,text,text,text,text,uuid,uuid,uuid,integer,text,uuid,uuid,bigint,uuid,bigint,text,uuid,text,integer,text,text,text,text,timestamptz,text);
DROP FUNCTION ai_media_worker_api.release_exact_one_video_terminal_check_unknown_v1(
  uuid,uuid,bigint,text,text,text,text,uuid,uuid,uuid,integer,text,uuid,uuid,bigint,text,timestamptz,text);
DROP FUNCTION ai_media_worker_api.claim_exact_one_video_terminal_check_v1(
  uuid,uuid,bigint,text,text,text,text,uuid,uuid,uuid,integer,text,text,integer);
DROP FUNCTION ai_media_worker_api.finalize_exact_one_video_reconciled_no_submit_v1(
  uuid,uuid,bigint,text,text,text,text,uuid,uuid,uuid,integer,text,uuid,bigint,text,uuid,bigint,text,uuid,text,integer,text,timestamptz,text);
DROP FUNCTION ai_media_worker_api.record_exact_one_video_reconciled_confirmed_v1(
  uuid,uuid,bigint,text,text,text,text,uuid,uuid,uuid,integer,text,uuid,bigint,text,uuid,bigint,text,text,text);
DROP FUNCTION ai_media_worker_api.release_exact_one_video_reconciliation_unknown_v1(
  uuid,uuid,bigint,text,text,text,text,uuid,uuid,uuid,integer,text,uuid,bigint,text,uuid,bigint);
DROP FUNCTION ai_media_worker_api.claim_exact_one_video_reconciliation_v1(
  uuid,uuid,bigint,text,text,text,text,uuid,uuid,uuid,integer,text,text,integer);
DROP FUNCTION ai_media_worker_api.require_exact_one_video_reconcile_context_v1(
  uuid,uuid,bigint,text,text,text,text,uuid,uuid,uuid,integer,text,text,text,text,integer);

COMMIT;
