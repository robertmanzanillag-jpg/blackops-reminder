-- AI Media Studio PR35 evidence-preserving rollback.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='15min';
SET LOCAL search_path=pg_catalog;

DO $guard$
BEGIN
  IF to_regprocedure('ai_media_worker_api.claim_exact_one_video_asset_ingest_v1(uuid,uuid,bigint,text,text,text,text,uuid,uuid,uuid,integer,text,uuid,text,integer)') IS NULL
  THEN RAISE EXCEPTION 'PR35 exact asset surface is not installed'; END IF;
  IF EXISTS (
    SELECT 1 FROM public.ai_media_exact_one_video_run_fences fence
    JOIN public.ai_media_asset_ingest_jobs ingest
      ON ingest.owner_user_id=fence.owner_user_id AND ingest.workspace_id=fence.workspace_id
     AND ingest.render_job_id=fence.render_job_id
    WHERE fence.action IN ('ingest_asset','link_asset')
      AND (ingest.fencing_token>0 OR ingest.state IN ('completed','dead_letter')
        OR ingest.media_asset_id IS NOT NULL)
  ) THEN RAISE EXCEPTION 'rollback preserves exact one-video asset ingest and link evidence'; END IF;
END
$guard$;

REVOKE EXECUTE ON FUNCTION ai_media_worker_api.claim_exact_one_video_asset_ingest_v1(
  uuid,uuid,bigint,text,text,text,text,uuid,uuid,uuid,integer,text,uuid,text,integer)
  FROM ai_media_one_video_run_executor;
REVOKE EXECUTE ON FUNCTION ai_media_worker_api.record_exact_one_video_asset_ingest_completed_v1(
  uuid,uuid,bigint,text,text,text,text,uuid,uuid,uuid,integer,text,uuid,text,bigint,text,text,bigint)
  FROM ai_media_one_video_run_executor;
REVOKE EXECUTE ON FUNCTION ai_media_worker_api.record_exact_one_video_asset_ingest_failed_v1(
  uuid,uuid,bigint,text,text,text,text,uuid,uuid,uuid,integer,text,uuid,text,bigint,text,boolean,timestamptz)
  FROM ai_media_one_video_run_executor;
REVOKE EXECUTE ON FUNCTION ai_media_worker_api.load_exact_one_video_asset_link_v1(
  uuid,uuid,bigint,text,text,text,text,uuid,uuid,uuid,integer,text,uuid)
  FROM ai_media_one_video_run_executor;
REVOKE EXECUTE ON FUNCTION ai_media_worker_api.record_exact_one_video_asset_linked_v1(
  uuid,uuid,bigint,text,text,text,text,uuid,uuid,uuid,integer,text,uuid,bigint,text,text,uuid)
  FROM ai_media_one_video_run_executor;

DROP FUNCTION ai_media_worker_api.record_exact_one_video_asset_linked_v1(
  uuid,uuid,bigint,text,text,text,text,uuid,uuid,uuid,integer,text,uuid,bigint,text,text,uuid);
DROP FUNCTION ai_media_worker_api.load_exact_one_video_asset_link_v1(
  uuid,uuid,bigint,text,text,text,text,uuid,uuid,uuid,integer,text,uuid);
DROP FUNCTION ai_media_worker_api.record_exact_one_video_asset_ingest_failed_v1(
  uuid,uuid,bigint,text,text,text,text,uuid,uuid,uuid,integer,text,uuid,text,bigint,text,boolean,timestamptz);
DROP FUNCTION ai_media_worker_api.record_exact_one_video_asset_ingest_completed_v1(
  uuid,uuid,bigint,text,text,text,text,uuid,uuid,uuid,integer,text,uuid,text,bigint,text,text,bigint);
DROP FUNCTION ai_media_worker_api.claim_exact_one_video_asset_ingest_v1(
  uuid,uuid,bigint,text,text,text,text,uuid,uuid,uuid,integer,text,uuid,text,integer);
DROP FUNCTION ai_media_worker_api.require_exact_one_video_asset_context_v1(
  uuid,uuid,bigint,text,text,text,text,uuid,uuid,uuid,integer,text,text);

REVOKE UPDATE ON TABLE public.ai_media_asset_ingest_jobs FROM ai_media_admitted_fn_owner;
REVOKE UPDATE(id) ON TABLE public.ai_media_assets FROM ai_media_admitted_fn_owner;
REVOKE SELECT ON TABLE public.ai_media_assets FROM ai_media_admitted_fn_owner;
COMMIT;
