-- PR6 rollback is data preserving and retains provider-account isolation.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15min';
SET LOCAL search_path = public, pg_catalog;

DO $preflight$
DECLARE required_table text;
BEGIN
  FOREACH required_table IN ARRAY ARRAY[
    'ai_media_provider_accounts', 'ai_media_render_jobs', 'ai_media_webhook_events'
  ] LOOP
    IF to_regclass('public.' || required_table) IS NULL THEN
      RAISE EXCEPTION 'PR6 data-preserving rollback requires existing table %', required_table;
    END IF;
  END LOOP;
END;
$preflight$;

-- The legacy application assumes globally unique provider job/event ids and a
-- single account per tenant/provider. PR6 intentionally permits all three to
-- repeat across isolated accounts, so recreating those legacy unique indexes
-- would either fail or make a rollback unsafe. Keep the additive columns,
-- because this rollback does not restore the old one-account-per-provider rule,
-- account-scoped indexes, composite constraints, endpoint references, and all
-- rows. Roll application code forward again after correcting the release issue.
-- No secret values are stored here: every secret field remains an opaque ref.
COMMIT;
