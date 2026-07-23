-- AI Media Studio PR36 schema-only rollback.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='15min';
SET LOCAL search_path=pg_catalog;
DO $guard$
BEGIN
  IF to_regprocedure('ai_media_worker_api.load_exact_one_video_asset_target_v1(uuid,uuid,bigint,text,text,text,text,uuid,uuid,uuid,integer,text,text)') IS NULL
  THEN RAISE EXCEPTION 'PR36 exact asset target lookup is not installed'; END IF;
END
$guard$;
REVOKE EXECUTE ON FUNCTION ai_media_worker_api.load_exact_one_video_asset_target_v1(
  uuid,uuid,bigint,text,text,text,text,uuid,uuid,uuid,integer,text,text)
  FROM ai_media_one_video_run_executor;
DROP FUNCTION ai_media_worker_api.load_exact_one_video_asset_target_v1(
  uuid,uuid,bigint,text,text,text,text,uuid,uuid,uuid,integer,text,text);
COMMIT;
