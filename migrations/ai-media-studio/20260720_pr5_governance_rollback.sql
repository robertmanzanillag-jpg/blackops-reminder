-- PR5 rollback retains governance profiles, reviews, render snapshots, and all evidence.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15min';
SET LOCAL search_path = public, pg_catalog;

DO $preflight$
DECLARE required_table text;
BEGIN
  FOREACH required_table IN ARRAY ARRAY[
    'ai_media_governance_profiles', 'ai_media_quality_reviews', 'ai_media_render_jobs'
  ] LOOP
    IF to_regclass('public.' || required_table) IS NULL THEN
      RAISE EXCEPTION 'PR5 data-preserving rollback requires existing table %', required_table;
    END IF;
  END LOOP;
END;
$preflight$;

-- The prior application revision ignores these additive structures. Retaining
-- the tables, composite foreign keys, immutable revision chains, idempotency
-- evidence, quality decisions, and render snapshots avoids destroying the
-- audit trail and permits a forward application retry without reconstruction.
COMMIT;
