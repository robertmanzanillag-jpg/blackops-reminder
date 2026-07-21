import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const forward = readFileSync(new URL(
  "../migrations/ai-media-studio/20260721_pr20_launch_authorities_forward.sql",
  import.meta.url,
), "utf8");
const rollback = readFileSync(new URL(
  "../migrations/ai-media-studio/20260721_pr20_launch_authorities_rollback.sql",
  import.meta.url,
), "utf8");
const schema = readFileSync(new URL("../shared/models/ai-media-studio-db.ts", import.meta.url), "utf8");

test("PR20 is additive, unapplied, transactional, and strictly requires PR19", () => {
  assert.match(forward, /^--[\s\S]*BEGIN;/u);
  assert.match(forward, /Do not apply automatically/u);
  assert.match(forward, /lock_timeout = '5s'/u);
  assert.match(forward, /statement_timeout = '15min'/u);
  assert.match(forward, /SET LOCAL search_path = public, pg_catalog/u);
  for (const prerequisite of [
    "ai_media_daily_plans_exact_identity_uq",
    "ai_media_daily_plan_slots_exact_identity_uq",
    "ai_media_budget_reservations_owner_workspace_idempotency_uq",
    "ai_media_reject_budget_reservation_rewrite",
  ]) assert.match(forward, new RegExp(prerequisite, "u"));
  assert.match(forward, /COMMIT;\s*$/u);
});

test("PR20 creates exactly four provider-neutral authority tables without secrets or payloads", () => {
  const tables = [...forward.matchAll(/CREATE TABLE (ai_media_[a-z_]+)/gu)].map((match) => match[1]);
  assert.deepEqual(tables, [
    "ai_media_admission_policy_revisions",
    "ai_media_kill_switch_revisions",
    "ai_media_launch_evidence",
    "ai_media_launch_authority_snapshots",
  ]);
  const definitions = forward.split("\n")
    .filter((line) => /^\s{2}[a-z_]+\s+(?:text|uuid|jsonb|integer|boolean|numeric|timestamptz)\b/u.test(line))
    .join("\n");
  assert.doesNotMatch(definitions, /api_key|secret|access_token|refresh_token|raw_payload|provider_payload/iu);
});

test("policy, kill switch, and evidence are append-only revision chains", () => {
  for (const table of [
    "ai_media_admission_policy_revisions",
    "ai_media_kill_switch_revisions",
    "ai_media_launch_evidence",
    "ai_media_launch_authority_snapshots",
  ]) {
    assert.match(forward, new RegExp(`BEFORE UPDATE OR DELETE ON ${table}`, "u"));
  }
  assert.match(forward, /previous_revision_id uuid/u);
  assert.match(forward, /previous_evidence_id uuid/u);
  assert.match(forward, /previous_revision=revision-1/u);
  assert.match(forward, /previous_evidence_revision=revision-1/u);
  assert.match(schema, /ai_media_admission_policy_revisions_previous_identity_uq"\)\.on\([\s\S]*table\.id, table\.revision/u);
  assert.match(schema, /ai_media_kill_switch_revisions_previous_identity_uq"\)\.on\([\s\S]*table\.id, table\.revision/u);
  assert.match(forward, /tenant\/workspace advisory transaction lock/u);
  assert.match(forward, /evidence_kind IN \('content_approval','human_launch_approval','sandbox_proof','maximum_quote'\)/u);
  assert.match(forward, /decision IN \('approved','rejected','revoked'\)/u);
  assert.match(forward, /decision IN \('passed','failed','revoked'\)/u);
  assert.match(forward, /decision IN \('quoted','declined','revoked'\)/u);
});

test("all money is exact and maximum-quote fields are kind constrained", () => {
  assert.match(forward, /daily_budget_micro_usd numeric\(20,0\) NOT NULL/u);
  assert.match(forward, /amount_micro_usd numeric\(20,0\)/u);
  assert.match(forward, /maximum_quote_micro_usd numeric\(20,0\) NOT NULL/u);
  assert.doesNotMatch(forward, /(?:amount|budget|quote)_usd\s+(?:real|double precision|float)/iu);
  assert.match(forward, /evidence_kind='maximum_quote'[\s\S]*amount_micro_usd BETWEEN 1/u);
  assert.match(forward, /evidence_kind<>'maximum_quote'[\s\S]*amount_micro_usd IS NULL AND currency IS NULL/u);
  assert.match(forward, /maximum_quote_micro_usd BETWEEN 1 AND 9000000000000000/u);
});

test("active admission policies cannot authorize zero budget or concurrency", () => {
  assert.match(forward, /state='disabled' OR \(daily_budget_micro_usd>0 AND total_concurrency>0[\s\S]*provider_concurrency>0 AND tenant_concurrency>0/u);
  assert.match(schema, /table\.state\}='disabled' OR \(\$\{table\.dailyBudgetMicroUsd\}>0/u);
  assert.match(schema, /table\.providerConcurrency\}>0 AND \$\{table\.tenantConcurrency\}>0/u);
});

test("snapshot and reservation use exact authority identities", () => {
  for (const control of [
    "ai_media_daily_plans_authority_identity_uq",
    "ai_media_daily_plan_slots_authority_identity_uq",
    "ai_media_script_variants_authority_identity_uq",
    "ai_media_governance_profiles_authority_identity_uq",
    "ai_media_launch_evidence_snapshot_identity_uq",
    "ai_media_launch_evidence_previous_identity_uq",
    "ai_media_launch_evidence_previous_fk",
    "ai_media_launch_authority_snapshots_exact_plan_fk",
    "ai_media_launch_authority_snapshots_exact_slot_fk",
    "ai_media_launch_authority_snapshots_policy_fk",
    "ai_media_launch_authority_snapshots_kill_switch_fk",
    "ai_media_budget_reservations_authority_snapshot_fk",
  ]) assert.match(forward, new RegExp(control, "u"));
  assert.match(forward, /governance_use text NOT NULL/u);
  assert.match(forward, /governance_territory text NOT NULL/u);
  assert.match(forward, /content_country text NOT NULL/u);
  assert.match(forward, /content_country ~ '\^\[A-Z\]\{2\}\$'/u);
  assert.match(forward, /ADD COLUMN authority_snapshot_id uuid/u);
  assert.match(forward, /ADD COLUMN authority_digest text/u);
  assert.match(forward, /authority_snapshot_id IS NULL\)=\(authority_digest IS NULL/u);
  assert.match(forward, /authority_snapshot_id,daily_plan_slot_id,attempt,admission_digest,[\s\S]*provider_account_id,provider_key,provider_credential_version,script_variant_checksum,authority_digest/u);
  assert.match(forward, /CREATE INDEX ai_media_launch_authority_snapshots_slot_attempt_idx/u);
  assert.doesNotMatch(forward, /CREATE UNIQUE INDEX ai_media_launch_authority_snapshots_slot_attempt/u);
  assert.match(forward, /FOREIGN KEY\s+\(owner_user_id,workspace_id,daily_plan_slot_id,provider_account_id,provider_key,provider_credential_version\)[\s\S]*REFERENCES ai_media_daily_plan_slots\(owner_user_id,workspace_id,id,provider_account_id,provider_key,provider_credential_version\)/u);
});

test("reservation authority cannot be attached or rewritten after insert", () => {
  assert.match(forward, /CREATE FUNCTION ai_media_reject_budget_reservation_authority_rewrite\(\)/u);
  assert.match(forward, /NEW\.authority_snapshot_id IS DISTINCT FROM OLD\.authority_snapshot_id/u);
  assert.match(forward, /NEW\.authority_digest IS DISTINCT FROM OLD\.authority_digest/u);
  assert.match(forward, /BEFORE UPDATE ON ai_media_budget_reservations[\s\S]*ai_media_reject_budget_reservation_authority_rewrite/u);
  assert.match(schema, /authoritySnapshotId: uuid\("authority_snapshot_id"\)/u);
  assert.match(schema, /authorityDigest: text\("authority_digest"\)/u);
  assert.match(rollback, /Retain the authority UPDATE guard/u);
});

test("Drizzle and SQL expose the same PR20 tables, exact fields, and composite authority FK", () => {
  for (const [exportName, tableName] of [
    ["aiMediaAdmissionPolicyRevisions", "ai_media_admission_policy_revisions"],
    ["aiMediaKillSwitchRevisions", "ai_media_kill_switch_revisions"],
    ["aiMediaLaunchEvidence", "ai_media_launch_evidence"],
    ["aiMediaLaunchAuthoritySnapshots", "ai_media_launch_authority_snapshots"],
  ]) assert.match(schema, new RegExp(`export const ${exportName} = pgTable\\(\\s*"${tableName}"`, "u"));
  for (const field of [
    "governance_use", "governance_territory", "content_country", "authority_snapshot_id", "authority_digest",
    "daily_budget_micro_usd", "maximum_quote_micro_usd",
  ]) assert.match(schema, new RegExp(`"${field}"`, "u"));
  assert.match(schema, /name: "ai_media_budget_reservations_authority_snapshot_fk"/u);
  assert.match(schema, /table\.authoritySnapshotId,[\s\S]*table\.dailyPlanSlotId, table\.attempt, table\.admissionDigest,[\s\S]*table\.scriptVariantChecksum, table\.authorityDigest/u);
});

test("rollback is application-only and non-destructive", () => {
  const executable = `${forward}\n${rollback}`.replace(/--.*$/gmu, "");
  assert.match(rollback, /application-only/u);
  assert.match(rollback, /Do not drop/u);
  assert.doesNotMatch(executable, /\bDELETE\s+FROM\b|\bTRUNCATE\b|\bDROP\s+(?:TABLE|COLUMN)\b/iu);
});
