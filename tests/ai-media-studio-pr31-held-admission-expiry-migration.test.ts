import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const forward = readFileSync(new URL(
  "../migrations/ai-media-studio/pending/20260722_pr31_held_admission_expiry_forward.sql",
  import.meta.url,
), "utf8");
const rollback = readFileSync(new URL(
  "../migrations/ai-media-studio/pending/20260722_pr31_held_admission_expiry_rollback.sql",
  import.meta.url,
), "utf8");
const model = readFileSync(new URL("../shared/models/ai-media-studio-db.ts", import.meta.url), "utf8");

test("PR31 remains pending and requires the exact PostgreSQL 16 admitted-worker chain", () => {
  assert.match(forward, /current_setting\('server_version_num'\)::integer<160000/u);
  assert.match(forward, /to_regclass\('public\.ai_media_work_activations'\) IS NULL/u);
  assert.match(forward, /to_regclass\('public\.ai_media_provider_submission_attempts'\) IS NULL/u);
  assert.match(forward, /to_regclass\('public\.ai_media_provider_terminal_events'\) IS NULL/u);
  assert.match(forward, /to_regprocedure\('public\.ai_media_guard_admitted_submission_rows\(\)'\) IS NULL/u);
  assert.doesNotMatch(forward, /\b(?:curl|https?:\/\/|provider_job_id\s*=\s*[^N]|publish_video)\b/iu);
});

test("PR31 records immutable exact held-expiration evidence", () => {
  assert.match(forward, /CREATE TABLE public\.ai_media_held_admission_expirations/u);
  for (const column of [
    "expiry_capability_id", "budget_reservation_id", "budget_bucket_id", "render_job_id", "dispatch_outbox_id",
    "daily_plan_slot_id", "slot_attempt", "provider_account_id", "provider_key",
    "provider_credential_version", "amount_micro_usd", "currency", "work_handoff_digest",
    "sealed_request_digest", "reservation_expires_at", "slot_state_version_before",
    "slot_state_version_after", "actor_user_id", "idempotency_key", "input_digest",
    "expiration_evidence_digest", "expired_at", "created_at",
  ]) assert.match(forward, new RegExp(`${column} [^\\n]+NOT NULL`, "u"));
  for (const exactFk of ["reservation", "render", "outbox", "slot", "bucket"])
    assert.match(forward, new RegExp(`ai_media_held_admission_expirations_exact_${exactFk}_fk`, "u"));
  assert.match(forward, /held admission expiration evidence is append-only and immutable/u);
  assert.match(forward, /BEFORE UPDATE OR DELETE ON public\.ai_media_held_admission_expirations/u);
  assert.match(forward, /BEFORE TRUNCATE ON public\.ai_media_held_admission_expirations/u);
});

test("PR31 creates one tenant-bound, TTL-bound, single-use expiry capability", () => {
  assert.match(forward, /CREATE TABLE public\.ai_media_held_expiry_capabilities/u);
  assert.match(forward, /database_principal name NOT NULL/u);
  assert.match(forward, /max_expirations integer NOT NULL DEFAULT 1/u);
  assert.match(forward, /max_expirations=1 AND expires_at>valid_from/u);
  assert.match(forward, /ai_media_held_admission_expirations_capability_uq/u);
  assert.match(forward, /ai_media_held_admission_expirations_exact_capability_fk/u);
  assert.match(forward, /held expiry capability is immutable except one evidenced revocation/u);
});

test("expiry is DB-clock gated and excludes every activation or submission precursor", () => {
  const fn = forward.slice(forward.indexOf("CREATE FUNCTION ai_media_worker_api.expire_held_admission_v1"));
  assert.match(fn, /sampled_at timestamptz:=pg_catalog\.clock_timestamp\(\)/u);
  assert.match(fn, /reservation\.expires_at<=sampled_at/u);
  assert.match(fn, /reservation\.state='reserved'/u);
  assert.match(fn, /reservation\.submission_state='not_started'/u);
  assert.match(fn, /job\.stage='admission_held'[\s\S]*job\.attempts=0/u);
  assert.match(fn, /job\.provider_job_id IS NULL/u);
  assert.match(fn, /job\.lease_owner IS NULL[\s\S]*job\.lease_token IS NULL[\s\S]*job\.lease_expires_at IS NULL/u);
  assert.match(fn, /outbox\.status='held'[\s\S]*outbox\.attempts=0[\s\S]*outbox\.lease_owner IS NULL/u);
  assert.match(fn, /NOT EXISTS \(SELECT 1 FROM public\.ai_media_work_activations/u);
  assert.match(fn, /NOT EXISTS \(SELECT 1 FROM public\.ai_media_provider_submission_attempts/u);
  assert.match(fn, /FOR UPDATE OF reservation,bucket,job,outbox,slot/u);
});

test("one function atomically expires every held projection and decrements only reserved budget", () => {
  const fn = forward.slice(forward.indexOf("CREATE FUNCTION ai_media_worker_api.expire_held_admission_v1"));
  const evidence = fn.indexOf("INSERT INTO public.ai_media_held_admission_expirations");
  const reservation = fn.indexOf("UPDATE public.ai_media_budget_reservations");
  const render = fn.indexOf("UPDATE public.ai_media_render_jobs");
  const outbox = fn.indexOf("UPDATE public.ai_media_outbox");
  const slot = fn.indexOf("UPDATE public.ai_media_daily_plan_slots");
  const bucket = fn.indexOf("UPDATE public.ai_media_budget_buckets");
  assert.ok(evidence >= 0 && reservation > evidence && render > reservation && outbox > render
    && slot > outbox && bucket > slot);
  assert.match(fn, /state='expired',expired_at=sampled_at[\s\S]*release_reason='held_admission_expired'/u);
  assert.match(fn, /stage='admission_expired',status='cancelled'/u);
  assert.match(fn, /ai_media_outbox SET status='cancelled',processed_at=sampled_at/u);
  assert.match(fn, /ai_media_daily_plan_slots SET status='expired',state_version=state_version\+1/u);
  assert.match(fn, /reserved_micro_usd=reserved_micro_usd-bound\.amount_micro_usd/u);
  assert.match(fn, /GET DIAGNOSTICS affected=ROW_COUNT/g);
});

test("terminal projections cannot be forged without the exact evidence row", () => {
  assert.match(forward, /held admission expiry projections must originate from one exact held transition/u);
  for (const table of ["render_jobs", "outbox", "budget_reservations", "daily_plan_slots"])
    assert.match(forward, new RegExp(`ai_media_${table}_held_expiry_insert_guard BEFORE INSERT`, "u"));
  assert.match(forward, /held render expiry requires exact append-only expiration evidence/u);
  assert.match(forward, /held outbox cancellation requires exact append-only expiration evidence/u);
  assert.match(forward, /held reservation expiry requires exact append-only expiration evidence/u);
  assert.match(forward, /held slot expiry requires exact append-only expiration evidence/u);
  assert.match(forward, /CREATE CONSTRAINT TRIGGER ai_media_held_admission_expirations_final_state_guard[\s\S]*DEFERRABLE INITIALLY DEFERRED/u);
  assert.match(forward, /must atomically close the exact never-activated tuple/u);
});

test("PR31 grants only its dedicated table-blind expiry executor", () => {
  assert.match(forward, /safe precreated table-blind NOLOGIN NOINHERIT ai_media_held_expiry_executor role/u);
  assert.match(forward, /held expiry executor principal is not table-blind least privilege/u);
  assert.match(forward, /scoped\.database_principal=SESSION_USER::name/u);
  assert.match(forward, /scoped\.owner_user_id=p_owner_user_id AND scoped\.workspace_id=p_workspace_id/u);
  assert.match(forward, /scoped\.max_expirations=1 AND scoped\.revoked_at IS NULL/u);
  assert.match(forward, /scoped\.valid_from<=sampled_at AND scoped\.expires_at>sampled_at/u);
  assert.match(forward, /REVOKE ALL ON TABLE public\.ai_media_held_admission_expirations[\s\S]*ai_media_admitted_submit_executor,ai_media_admitted_reconcile_executor/u);
  assert.match(forward, /GRANT EXECUTE ON FUNCTION ai_media_worker_api\.expire_held_admission_v1[\s\S]*TO ai_media_held_expiry_executor/u);
  assert.doesNotMatch(forward, /GRANT (?:SELECT|INSERT|UPDATE|DELETE|TRUNCATE|REFERENCES|TRIGGER)[^;]*TO ai_media_held_expiry_executor/iu);
  assert.doesNotMatch(forward, /GRANT ai_media_held_expiry_executor TO/u);
});

test("rollback refuses to erase any expiration evidence or terminal state", () => {
  assert.match(rollback, /EXISTS \(SELECT 1 FROM public\.ai_media_held_admission_expirations LIMIT 1\)/u);
  assert.match(rollback, /stage='admission_expired' OR status='cancelled'/u);
  assert.match(rollback, /state='expired' AND release_reason='held_admission_expired'/u);
  assert.match(rollback, /rollback preserves held admission expiration evidence and terminal state; stop and forward-fix/u);
  assert.ok(rollback.indexOf("DROP TABLE public.ai_media_held_admission_expirations")
    > rollback.indexOf("rollback preserves held admission expiration evidence"));
  assert.doesNotMatch(rollback, /\b(?:DELETE FROM|TRUNCATE)\b/iu);
});

test("Drizzle mirrors PR31 evidence, exact identities, and new terminal states", () => {
  assert.match(model, /export const aiMediaHeldAdmissionExpirations = pgTable\(/u);
  assert.match(model, /export const aiMediaHeldExpiryCapabilities = pgTable\(/u);
  assert.match(model, /"ai_media_held_admission_expirations"/u);
  assert.match(model, /name: "ai_media_held_admission_expirations_exact_reservation_fk"/u);
  assert.match(model, /name: "ai_media_held_admission_expirations_exact_outbox_fk"/u);
  assert.match(model, /stage\}='admission_expired' AND \$\{table\.status\}='cancelled'/u);
  assert.match(model, /status\} IN \('held','pending','leased','reconciling','dispatched','dead_letter','cancelled'\)/u);
  assert.match(model, /heldAdmissionExpirations: aiMediaHeldAdmissionExpirations/u);
  assert.match(model, /heldExpiryCapabilities: aiMediaHeldExpiryCapabilities/u);
});
