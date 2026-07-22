-- PR30 rollback is destructive only before any quote-bound approval evidence exists.
-- Once evidence exists, rollback stops and requires an application forward-fix.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='15min';
SET LOCAL search_path=public,pg_catalog;

DO $preflight$
BEGIN
  IF to_regclass('public.ai_media_quote_bound_human_approvals') IS NULL
    OR to_regclass('public.ai_media_launch_evidence_human_quote_binding_identity_uq') IS NULL
    OR to_regclass('public.ai_media_launch_evidence_maximum_quote_binding_identity_uq') IS NULL THEN
    RAISE EXCEPTION 'PR30 rollback requires the quote-bound human approval schema';
  END IF;
  IF EXISTS (SELECT 1 FROM ai_media_quote_bound_human_approvals) THEN
    RAISE EXCEPTION 'PR30 rollback preserves quote-bound human approval evidence; stop and forward-fix';
  END IF;
END;
$preflight$;

LOCK TABLE ai_media_launch_evidence, ai_media_quote_bound_human_approvals
  IN SHARE ROW EXCLUSIVE MODE;

DROP TRIGGER ai_media_quote_bound_human_approvals_truncate_guard
  ON ai_media_quote_bound_human_approvals;
DROP TRIGGER ai_media_quote_bound_human_approvals_immutable_guard
  ON ai_media_quote_bound_human_approvals;
DROP FUNCTION ai_media_quote_bound_human_approvals_append_only_v1();
DROP TABLE ai_media_quote_bound_human_approvals;
DROP INDEX ai_media_launch_evidence_maximum_quote_binding_identity_uq;
DROP INDEX ai_media_launch_evidence_human_quote_binding_identity_uq;

COMMIT;
