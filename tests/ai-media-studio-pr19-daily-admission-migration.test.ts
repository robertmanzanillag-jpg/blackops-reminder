import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const forward = readFileSync(new URL(
  "../migrations/ai-media-studio/20260721_pr19_daily_admission_forward.sql",
  import.meta.url,
), "utf8");
const rollback = readFileSync(new URL(
  "../migrations/ai-media-studio/20260721_pr19_daily_admission_rollback.sql",
  import.meta.url,
), "utf8");

test("PR19 migration is transactional, additive, unapplied, and exact-preflighted", () => {
  assert.match(forward, /^--[\s\S]*BEGIN;/u);
  assert.match(forward, /Do not apply automatically/u);
  assert.match(forward, /lock_timeout = '5s'/u);
  assert.match(forward, /statement_timeout = '15min'/u);
  assert.match(forward, /SET LOCAL search_path = public, pg_catalog/u);
  for (const prerequisite of [
    "ai_media_provider_accounts_owner_workspace_id_provider_uq",
    "ai_media_influencers_owner_workspace_id_uq",
    "ai_media_provider_resources_owner_workspace_id_uq",
    "ai_media_governance_profiles_owner_workspace_id_uq",
    "ai_media_render_jobs_owner_workspace_id_uq",
  ]) assert.match(forward, new RegExp(prerequisite, "u"));
  assert.match(forward, /COMMIT;\s*$/u);
});

test("PR19 creates exactly four provider-neutral daily admission tables", () => {
  const tables = [...forward.matchAll(/CREATE TABLE (ai_media_[a-z_]+)/gu)].map((match) => match[1]);
  assert.deepEqual(tables, [
    "ai_media_daily_plans",
    "ai_media_daily_plan_slots",
    "ai_media_budget_buckets",
    "ai_media_budget_reservations",
  ]);
  const columnDefinitions = forward.split("\n")
    .filter((line) => /^\s{2}[a-z_]+\s+(?:text|uuid|jsonb|integer|numeric|date|timestamptz)\b/u.test(line))
    .join("\n");
  assert.doesNotMatch(columnDefinitions, /avatar_id|voice_id|api_key|secret|access_token|refresh_token|provider_payload/iu);
});

test("money and budget dates stay exact and server authoritative", () => {
  assert.match(forward, /limit_micro_usd numeric\(20,0\)/u);
  assert.match(forward, /reserved_micro_usd numeric\(20,0\)/u);
  assert.match(forward, /committed_micro_usd numeric\(20,0\)/u);
  assert.match(forward, /amount_micro_usd numeric\(20,0\)/u);
  assert.match(forward, /script_variant_checksum text NOT NULL/u);
  assert.doesNotMatch(forward, /amount_usd\s+(?:real|double precision|float)/iu);
  assert.match(forward, /budget_date=\(created_at AT TIME ZONE accounting_time_zone\)::date/u);
  assert.match(forward, /plan_date = \(created_at AT TIME ZONE accounting_time_zone\)::date/u);
  assert.match(forward, /reserved_micro_usd\+committed_micro_usd<=limit_micro_usd/u);
});

test("tenant-exact FKs and idempotency prevent cross-tenant or duplicate admission", () => {
  for (const control of [
    "ai_media_daily_plans_provider_account_fk",
    "ai_media_daily_plan_slots_exact_plan_fk",
    "ai_media_daily_plan_slots_influencer_fk",
    "ai_media_daily_plan_slots_avatar_fk",
    "ai_media_daily_plan_slots_voice_fk",
    "ai_media_budget_reservations_exact_bucket_fk",
    "ai_media_budget_reservations_exact_slot_fk",
    "ai_media_budget_reservations_governance_fk",
    "ai_media_budget_reservations_render_job_fk",
    "ai_media_budget_reservations_dispatch_outbox_fk",
  ]) assert.match(forward, new RegExp(control, "u"));
  assert.match(forward, /ai_media_daily_plans_owner_workspace_idempotency_uq/u);
  assert.match(forward, /ai_media_budget_reservations_owner_workspace_idempotency_uq/u);
  assert.match(forward, /ai_media_budget_reservations_slot_attempt_uq/u);
  assert.match(forward, /ai_media_budget_reservations_active_slot_uq[\s\S]*state IN \('reserved','committed'\)/u);
});

test("reservation transition guard retains committed and ambiguous money", () => {
  const preflightStart = forward.indexOf("DO $preflight$");
  const preflightEnd = forward.indexOf("$preflight$;", preflightStart);
  const preflight = forward.slice(preflightStart, preflightEnd);
  assert.doesNotMatch(preflight, /TG_OP/u);
  assert.match(forward, /CREATE FUNCTION ai_media_reject_budget_reservation_rewrite/u);
  assert.match(forward, /TG_OP='DELETE'[\s\S]*cannot be deleted/u);
  assert.match(forward, /OLD\.state IN \('released','expired','settled'\)/u);
  assert.match(forward, /OLD\.state='committed' AND NEW\.state NOT IN \('committed','released','settled'\)/u);
  assert.match(forward, /clock_timestamp\(\)<OLD\.expires_at/u);
  assert.match(forward, /NEW\.reserved_at,NEW\.expires_at/u);
  assert.match(forward, /clock_timestamp\(\)>=OLD\.expires_at[\s\S]*NEW\.submission_state<>'dispatching'[\s\S]*NEW\.commit_evidence_digest IS NULL/u);
  assert.match(forward, /OLD\.state='reserved' AND NEW\.state='released'[\s\S]*NEW\.submission_state<>'not_started'[\s\S]*NEW\.committed_at IS NOT NULL/u);
  assert.match(forward, /state<>'reserved'[\s\S]*submission_state='not_started'/u);
  assert.match(forward, /settled_amount_micro_usd BETWEEN 0 AND amount_micro_usd/u);
  assert.match(forward, /NEW\.committed_at IS DISTINCT FROM OLD\.committed_at/u);
  assert.match(forward, /reconciled_no_submit/u);
  assert.match(forward, /reconciliation_evidence_digest IS NULL/u);
  assert.match(forward, /OLD\.submission_state='ambiguous'[\s\S]*NEW\.state='settled'[\s\S]*reconciliation_evidence_digest IS NOT NULL/u);
  assert.match(forward, /BEFORE UPDATE OR DELETE ON ai_media_budget_reservations/u);
});

test("rollback is application-only and preserves all monetary evidence", () => {
  const executable = `${forward}\n${rollback}`.replace(/--.*$/gmu, "");
  assert.match(rollback, /application-only/u);
  assert.match(rollback, /Do not drop/u);
  assert.match(rollback, /committed or ambiguous/u);
  assert.doesNotMatch(executable, /\bDELETE\s+FROM\b|\bTRUNCATE\b|\bDROP\s+(?:TABLE|COLUMN)\b/iu);
});
