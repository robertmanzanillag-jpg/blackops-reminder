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
      WHERE allowed_operations && ARRAY['claim_terminal_check','release_terminal_check_unknown','record_provider_terminal']::text[])
  THEN RAISE EXCEPTION 'PR27 rollback requires revoking all terminal capabilities first; terminal evidence is never deleted';
  END IF;
END
$guard$;

REVOKE EXECUTE ON FUNCTION
  ai_media_worker_api.claim_terminal_check_v1(uuid,text,text,text,integer),
  ai_media_worker_api.release_terminal_check_unknown_v1(uuid,text,text,uuid,uuid,bigint),
  ai_media_worker_api.record_provider_terminal_v1(uuid,text,text,uuid,uuid,bigint,uuid,bigint,text,uuid,text,integer,text,text,text,text,timestamptz,text)
FROM ai_media_admitted_reconcile_executor;
DROP FUNCTION ai_media_worker_api.record_provider_terminal_v1(uuid,text,text,uuid,uuid,bigint,uuid,bigint,text,uuid,text,integer,text,text,text,text,timestamptz,text);
DROP FUNCTION ai_media_worker_api.release_terminal_check_unknown_v1(uuid,text,text,uuid,uuid,bigint);
DROP FUNCTION ai_media_worker_api.claim_terminal_check_v1(uuid,text,text,text,integer);
DROP FUNCTION ai_media_worker_api.require_terminal_capability_v1(uuid,text,text,text,text,integer);

REVOKE SELECT,INSERT,UPDATE ON TABLE public.ai_media_provider_terminal_checks FROM ai_media_admitted_fn_owner;
REVOKE SELECT,INSERT ON TABLE public.ai_media_provider_terminal_events FROM ai_media_admitted_fn_owner;
REVOKE SELECT,INSERT ON TABLE public.ai_media_asset_ingest_jobs FROM ai_media_admitted_fn_owner;

ALTER TABLE public.ai_media_admitted_worker_capabilities
  DROP CONSTRAINT ai_media_admitted_worker_capabilities_ck,
  DROP CONSTRAINT ai_media_admitted_worker_capabilities_lane_ops_ck;
ALTER TABLE public.ai_media_admitted_worker_capabilities ADD CONSTRAINT ai_media_admitted_worker_capabilities_ck CHECK (
  lane IN ('submit','reconcile') AND length(btrim(owner_user_id)) BETWEEN 1 AND 200
  AND length(btrim(workspace_id)) BETWEEN 1 AND 200 AND length(btrim(accounting_time_zone)) BETWEEN 1 AND 100
  AND length(btrim(worker_id)) BETWEEN 1 AND 120 AND cardinality(allowed_operations)>0
  AND allowed_operations <@ ARRAY['claim','authorize','expire_authorized','record_submit_confirmed',
    'record_submit_ambiguous','claim_reconciliation','release_reconciliation_unknown',
    'record_reconciled_confirmed','finalize_reconciled_no_submit','release_terminal_capacity']::text[]
  AND max_lease_ms BETWEEN 1 AND 300000 AND max_batch_size BETWEEN 1 AND 100
  AND expires_at>valid_from AND isfinite(valid_from) AND isfinite(expires_at)
  AND (revoked_at IS NULL OR isfinite(revoked_at))
  AND evidence_digest ~ '^sha256:[0-9a-f]{64}$' AND isfinite(created_at));
ALTER TABLE public.ai_media_admitted_worker_capabilities ADD CONSTRAINT ai_media_admitted_worker_capabilities_lane_ops_ck CHECK (
  (lane='submit' AND allowed_operations <@ ARRAY['claim','authorize','expire_authorized',
    'record_submit_confirmed','record_submit_ambiguous']::text[])
  OR (lane='reconcile' AND allowed_operations <@ ARRAY['claim_reconciliation',
    'release_reconciliation_unknown','record_reconciled_confirmed',
    'finalize_reconciled_no_submit','release_terminal_capacity']::text[]));

-- Keep terminal checks/events, append-only guards, exact FKs, ingest rows, and terminal columns.
-- A forward fix can safely re-expose entrypoints after review; rollback never erases evidence.
COMMIT;
