-- Guarded PR26 privilege-surface rollback. It never broad-regrants direct DML.
-- Once a capability or capacity lease exists, preserve evidence and forward-fix.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='15min';
SET LOCAL search_path=pg_catalog;

DO $guard$
BEGIN
  IF to_regclass('public.ai_media_admitted_worker_capabilities') IS NULL
    OR to_regclass('public.ai_media_submission_capacity_leases') IS NULL
    OR to_regnamespace('ai_media_worker_api') IS NULL
    OR EXISTS (SELECT 1 FROM public.ai_media_admitted_worker_capabilities LIMIT 1)
    OR EXISTS (SELECT 1 FROM public.ai_media_submission_capacity_leases LIMIT 1) THEN
    RAISE EXCEPTION 'PR26 rollback requires zero capability and zero capacity evidence; otherwise forward-fix';
  END IF;
END
$guard$;

LOCK TABLE public.ai_media_admitted_worker_capabilities,
  public.ai_media_submission_capacity_leases,public.ai_media_provider_submission_attempts,
  public.ai_media_budget_reservations IN ACCESS EXCLUSIVE MODE;

REVOKE EXECUTE ON FUNCTION
  ai_media_worker_api.claim_admitted_v1(uuid,text,text,text,integer),
  ai_media_worker_api.authorize_admitted_v1(uuid,text,text,uuid,uuid,bigint,uuid,text),
  ai_media_worker_api.record_submit_confirmed_v1(uuid,text,text,uuid,uuid,bigint,text,uuid,text,text,text),
  ai_media_worker_api.record_submit_ambiguous_v1(uuid,text,text,uuid,uuid,bigint,text,uuid,text,text),
  ai_media_worker_api.expire_authorized_v1(uuid,text,text,integer)
FROM ai_media_admitted_submit_executor;
REVOKE EXECUTE ON FUNCTION
  ai_media_worker_api.claim_reconciliation_v1(uuid,text,text,text,integer),
  ai_media_worker_api.release_reconciliation_unknown_v1(uuid,text,text,uuid,uuid,bigint,text,uuid,bigint),
  ai_media_worker_api.record_reconciled_confirmed_v1(uuid,text,text,uuid,uuid,bigint,text,uuid,bigint,text,text,text),
  ai_media_worker_api.finalize_reconciled_no_submit_v1(uuid,text,text,uuid,uuid,bigint,text,uuid,bigint,text,uuid,text,integer,text,timestamptz,text),
  ai_media_worker_api.release_terminal_capacity_v1(uuid,text,text,uuid,uuid,text,text,text)
FROM ai_media_admitted_reconcile_executor;
REVOKE USAGE ON SCHEMA ai_media_worker_api
  FROM ai_media_admitted_submit_executor,ai_media_admitted_reconcile_executor;

DROP TRIGGER ai_media_pr26_capacity_guard ON public.ai_media_submission_capacity_leases;
DROP TRIGGER ai_media_pr26_reservation_capacity_guard ON public.ai_media_budget_reservations;
DROP TRIGGER ai_media_pr26_attempt_capacity_guard ON public.ai_media_provider_submission_attempts;
DROP FUNCTION ai_media_worker_api.assert_capacity_consistency_v1();
DROP FUNCTION ai_media_worker_api.release_terminal_capacity_v1(uuid,text,text,uuid,uuid,text,text,text);
DROP FUNCTION ai_media_worker_api.finalize_reconciled_no_submit_v1(uuid,text,text,uuid,uuid,bigint,text,uuid,bigint,text,uuid,text,integer,text,timestamptz,text);
DROP FUNCTION ai_media_worker_api.record_reconciled_confirmed_v1(uuid,text,text,uuid,uuid,bigint,text,uuid,bigint,text,text,text);
DROP FUNCTION ai_media_worker_api.release_reconciliation_unknown_v1(uuid,text,text,uuid,uuid,bigint,text,uuid,bigint);
DROP FUNCTION ai_media_worker_api.claim_reconciliation_v1(uuid,text,text,text,integer);
DROP FUNCTION ai_media_worker_api.expire_authorized_v1(uuid,text,text,integer);
DROP FUNCTION ai_media_worker_api.record_submit_ambiguous_v1(uuid,text,text,uuid,uuid,bigint,text,uuid,text,text);
DROP FUNCTION ai_media_worker_api.record_submit_confirmed_v1(uuid,text,text,uuid,uuid,bigint,text,uuid,text,text,text);
DROP FUNCTION ai_media_worker_api.finish_outcome_v1(text,text,uuid,uuid,bigint,text,uuid,uuid,bigint,text,text,text,text,text);
DROP FUNCTION ai_media_worker_api.authorize_admitted_v1(uuid,text,text,uuid,uuid,bigint,uuid,text);
DROP FUNCTION ai_media_worker_api.claim_admitted_v1(uuid,text,text,text,integer);
DROP FUNCTION ai_media_worker_api.sha256_text_v1(text);
DROP FUNCTION ai_media_worker_api.require_capability_v1(uuid,text,text,text,text,text,integer,integer);
DROP TRIGGER ai_media_submission_capacity_leases_guard ON public.ai_media_submission_capacity_leases;
DROP FUNCTION ai_media_worker_api.guard_capacity_lease_v1();
DROP TRIGGER ai_media_admitted_worker_capabilities_guard ON public.ai_media_admitted_worker_capabilities;
DROP FUNCTION ai_media_worker_api.guard_capability_v1();

REVOKE INSERT,UPDATE ON TABLE
  public.ai_media_provider_submission_attempts,public.ai_media_provider_submission_events,
  public.ai_media_submission_capacity_leases,public.ai_media_budget_reservations,
  public.ai_media_budget_buckets,public.ai_media_render_jobs,public.ai_media_outbox,
  public.ai_media_daily_plan_slots
FROM ai_media_admitted_fn_owner;
REVOKE UPDATE(id) ON TABLE
  public.ai_media_admitted_worker_capabilities,public.ai_media_daily_plans,
  public.ai_media_work_activations,public.ai_media_launch_authority_snapshots,
  public.ai_media_launch_evidence,public.ai_media_launch_intents,
  public.ai_media_admission_policy_revisions,public.ai_media_kill_switch_revisions,
  public.ai_media_provider_accounts,public.ai_media_provider_resources,
  public.ai_media_governance_profiles,public.ai_media_influencers,
  public.ai_media_script_variants,public.ai_media_scripts,public.ai_media_source_items
FROM ai_media_admitted_fn_owner;
DROP TABLE public.ai_media_submission_capacity_leases;
DROP TABLE public.ai_media_admitted_worker_capabilities;
DROP SCHEMA ai_media_worker_api;

-- Deliberately retain REVOKE CREATE ON SCHEMA public FROM PUBLIC and never
-- restore any application/table privilege. The safe NOLOGIN owner and its
-- SELECT-only rights also remain because PR25's deferred consistency trigger
-- was permanently tightened to SECURITY DEFINER. ACL weakening is an explicit,
-- separately reviewed deployment action, not a rollback side effect.
COMMIT;
