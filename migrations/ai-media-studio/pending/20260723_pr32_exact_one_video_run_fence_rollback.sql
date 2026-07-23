-- AI Media Studio PR32 guarded rollback.
-- Refuses rollback after any capability or run evidence exists.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15min';
SET LOCAL search_path = public, pg_catalog;

DO $preflight$
BEGIN
  IF to_regclass('public.ai_media_exact_one_video_run_fences') IS NULL
    OR to_regprocedure('ai_media_worker_api.acquire_exact_one_video_run_v1(uuid,text,text,uuid,uuid,uuid,integer,text,text,text,text,text,integer)') IS NULL
  THEN RAISE EXCEPTION 'PR32 exact one-video run fence is not applied exactly'; END IF;
  IF EXISTS (SELECT 1 FROM public.ai_media_exact_one_video_run_capabilities LIMIT 1)
    OR EXISTS (SELECT 1 FROM public.ai_media_exact_one_video_run_fences LIMIT 1)
  THEN RAISE EXCEPTION 'rollback preserves exact one-video authorization and run evidence; stop and forward-fix'; END IF;
END
$preflight$;

REVOKE EXECUTE ON FUNCTION ai_media_worker_api.acquire_exact_one_video_run_v1(
  uuid,text,text,uuid,uuid,uuid,integer,text,text,text,text,text,integer)
  FROM ai_media_one_video_run_executor;
REVOKE EXECUTE ON FUNCTION ai_media_worker_api.complete_exact_one_video_run_v1(
  uuid,text,text,uuid,text,text,bigint,uuid,uuid,uuid,uuid,integer,text,text,text)
  FROM ai_media_one_video_run_executor;
REVOKE EXECUTE ON FUNCTION ai_media_worker_api.seal_exact_one_video_run_uncertain_v1(
  uuid,text,text,uuid,text,text,bigint,uuid,text)
  FROM ai_media_one_video_run_executor;
REVOKE USAGE ON SCHEMA ai_media_worker_api FROM ai_media_one_video_run_executor;

DROP FUNCTION ai_media_worker_api.seal_exact_one_video_run_uncertain_v1(
  uuid,text,text,uuid,text,text,bigint,uuid,text);
DROP FUNCTION ai_media_worker_api.complete_exact_one_video_run_v1(
  uuid,text,text,uuid,text,text,bigint,uuid,uuid,uuid,uuid,integer,text,text,text);
DROP FUNCTION ai_media_worker_api.acquire_exact_one_video_run_v1(
  uuid,text,text,uuid,uuid,uuid,integer,text,text,text,text,text,integer);
DROP FUNCTION ai_media_worker_api.require_exact_one_video_run_finalizer_v1(
  uuid,text,text,text,uuid,uuid,uuid,integer,text,text,text,text);
DROP FUNCTION ai_media_worker_api.require_exact_one_video_run_capability_v1(
  uuid,text,text,text,uuid,uuid,uuid,integer,text,text,text,text,integer);

DROP TRIGGER ai_media_exact_one_video_run_fences_guard ON public.ai_media_exact_one_video_run_fences;
DROP TRIGGER ai_media_exact_one_video_run_fences_truncate_guard ON public.ai_media_exact_one_video_run_fences;
DROP FUNCTION public.ai_media_guard_exact_one_video_run_fence();
DROP TABLE public.ai_media_exact_one_video_run_fences;

DROP TRIGGER ai_media_exact_one_video_run_capabilities_guard ON public.ai_media_exact_one_video_run_capabilities;
DROP TRIGGER ai_media_exact_one_video_run_capabilities_truncate_guard ON public.ai_media_exact_one_video_run_capabilities;
DROP FUNCTION public.ai_media_guard_exact_one_video_run_capability();
DROP TABLE public.ai_media_exact_one_video_run_capabilities;
DROP INDEX public.ai_media_budget_reservations_exact_run_fence_identity_uq;

COMMIT;
