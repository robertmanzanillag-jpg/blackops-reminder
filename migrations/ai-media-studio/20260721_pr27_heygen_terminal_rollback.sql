-- PR27 evidence-preserving rollback: disable the terminal worker surface without deleting terminal or ingest data.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='15min';
SET LOCAL search_path=pg_catalog;

DO $guard$
BEGIN
  IF to_regclass('public.ai_media_provider_terminal_checks') IS NULL
    OR to_regclass('public.ai_media_provider_terminal_events') IS NULL
    OR to_regprocedure('ai_media_worker_api.record_provider_terminal_v1(uuid,text,text,uuid,uuid,bigint,uuid,bigint,text,uuid,text,integer,text,text,text,text,timestamptz,text)') IS NULL
    OR EXISTS (SELECT 1 FROM public.ai_media_admitted_worker_capabilities
      WHERE revoked_at IS NULL
        AND allowed_operations && ARRAY['claim_terminal_check','release_terminal_check_unknown','record_provider_terminal']::text[])
  THEN RAISE EXCEPTION 'PR27 rollback requires revoking all terminal capabilities first; terminal evidence is never deleted';
  END IF;
END
$guard$;

REVOKE EXECUTE ON FUNCTION
  ai_media_worker_api.claim_terminal_check_v1(uuid,text,text,text,integer),
  ai_media_worker_api.release_terminal_check_unknown_v1(uuid,text,text,uuid,uuid,bigint,text,timestamptz,text),
  ai_media_worker_api.record_provider_terminal_v1(uuid,text,text,uuid,uuid,bigint,uuid,bigint,text,uuid,text,integer,text,text,text,text,timestamptz,text)
FROM PUBLIC,ai_media_admitted_reconcile_executor;
REVOKE EXECUTE ON FUNCTION ai_media_worker_api.release_terminal_capacity_v1(uuid,text,text,uuid,uuid,text,text,text)
  FROM ai_media_admitted_reconcile_executor;
DROP FUNCTION ai_media_worker_api.record_provider_terminal_v1(uuid,text,text,uuid,uuid,bigint,uuid,bigint,text,uuid,text,integer,text,text,text,text,timestamptz,text);
DROP FUNCTION ai_media_worker_api.release_terminal_check_unknown_v1(uuid,text,text,uuid,uuid,bigint,text,timestamptz,text);
DROP FUNCTION ai_media_worker_api.claim_terminal_check_v1(uuid,text,text,text,integer);
DROP FUNCTION ai_media_worker_api.require_terminal_capability_v1(uuid,text,text,text,text,integer);

-- Retained SECURITY DEFINER projection guards still need read-only terminal evidence.
-- Disable mutation authority, but never revoke the SELECT required by those guards.
REVOKE INSERT,UPDATE ON TABLE public.ai_media_provider_terminal_checks FROM ai_media_admitted_fn_owner;
REVOKE INSERT ON TABLE public.ai_media_provider_terminal_events FROM ai_media_admitted_fn_owner;
REVOKE SELECT,INSERT ON TABLE public.ai_media_asset_ingest_jobs FROM ai_media_admitted_fn_owner;

-- Keep terminal checks/events, append-only guards, exact FKs, ingest rows, and terminal columns.
-- A forward fix can safely re-expose entrypoints after review; rollback never erases evidence.
COMMIT;
