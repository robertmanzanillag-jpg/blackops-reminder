import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = (suffix: "forward" | "rollback") => readFileSync(new URL(
  `../migrations/ai-media-studio/20260721_pr16_provider_activation_integrity_${suffix}.sql`,
  import.meta.url,
), "utf8");
const forward = migration("forward");
const rollback = migration("rollback");
const schema = readFileSync(new URL("../shared/models/ai-media-studio-db.ts", import.meta.url), "utf8");

test("PR16A is transactional, PG16-gated, preflighted and unapplied", () => {
  assert.match(forward, /^--[\s\S]*BEGIN;/u);
  assert.match(forward, /server_version_num[\s\S]*160000/u);
  assert.match(forward, /requires trusted public\.pgcrypto/u);
  assert.match(forward, /requires the exact PR12, PR14, and PR15 schema/u);
  assert.match(forward, /requires every PR16A object to be absent/u);
  assert.match(forward, /refuses preexisting PUBLIC mutation privileges/u);
  assert.match(forward, /COMMIT;\s*$/u);
});

test("PR16A binds account, attempt, selection, artifacts and cleanup evidence exactly", () => {
  for (const relation of [
    "ai_media_provider_account_credential_bindings",
    "ai_media_oauth_credential_artifacts",
    "ai_media_oauth_vault_operations_v2",
  ]) assert.match(forward, new RegExp(`CREATE TABLE ${relation}`, "u"));
  for (const control of [
    "exact_activation_source_uq",
    "exact_evidence_uq",
    "exact_selection_uq",
    "exact_account_source_uq",
    "exact_artifact_source_uq",
    "exact_binding_fk",
    "exact_artifact_fk",
    "oauth_role_v2_binding_fk",
  ]) assert.match(forward, new RegExp(control, "u"));
  assert.match(forward, /DEFERRABLE INITIALLY DEFERRED/u);
  assert.match(forward, /binding requires the exact platform artifact and cleanup set/u);
  assert.match(forward, /ai_media_oauth_pr16_authorized_digest/u);
  assert.match(forward, /authorized_digest IS DISTINCT FROM public\.ai_media_oauth_pr16_authorized_digest/u);
  assert.match(forward, /credential_source='oauth_role_v2'[\s\S]*credential_binding_id IS NOT NULL/u);
});

test("PR16A structurally validates metadata, terminal ambiguity and immutable lifecycle", () => {
  assert.match(forward, /ai_media_oauth_token_artifacts_are_safe/u);
  assert.match(forward, /jsonb_object_keys/u);
  assert.match(forward, /jsonb_typeof\(lifetime->'revalidateAt'\)<>'string'/u);
  assert.match(forward, /isfinite\(available_at\)[\s\S]*isfinite\(quiescent_until\)/u);
  assert.match(forward, /activation_indeterminate/u);
  assert.match(forward, /activation_ambiguous/u);
  assert.match(forward, /terminal_outcome='indeterminate'/u);
  assert.match(forward, /ai_media_oauth_guard_pr16_evidence/u);
  assert.match(forward, /activation evidence is immutable/u);
  assert.match(forward, /vault_reference='vault:\/\/ai-media-studio\/oauth-role-token\/v2\/'\|\|encode\(digest/u);
  assert.match(forward, /REVOKE ALL[\s\S]*FROM PUBLIC/u);
});

test("PR16A SQL and Drizzle align on additive columns, states, and row checks", () => {
  for (const column of [
    "credential_binding_id", "selection_digest", "selected_stage_version", "selected_eligibility_digest",
    "authorized_digest", "authorized_at", "abandoned_at",
  ]) {
    assert.match(forward, new RegExp(column, "u"));
    assert.match(schema, new RegExp(column, "u"));
  }
  for (const state of ["staged", "authorized", "abandoned", "candidate", "active", "cleanup_pending", "retained"]) {
    assert.match(forward, new RegExp(`'${state}'`, "u"));
    assert.match(schema, new RegExp(`'${state}'`, "u"));
  }
  for (const rowControl of ["exact_activation_source_uq", "exact_evidence_uq", "attempt_source_fk", "candidate_evidence_fk"])
    assert.match(schema, new RegExp(rowControl, "u"));
  assert.match(forward, /actual_scopes::text\|\|capabilities::text\) !~\*/u);
  assert.ok(schema.includes("${table.actualScopes}::text || ${table.capabilities}::text) !~*"));
});

test("PR16A rollback preserves evidence and contains no destructive SQL", () => {
  const executable = `${forward}\n${rollback}`.replace(/--.*$/gmu, "");
  assert.doesNotMatch(executable, /^\s*(?:DELETE\s+FROM|TRUNCATE\b)/gimu);
  assert.doesNotMatch(rollback.replace(/--.*$/gmu, ""), /^\s*DROP\s+(?:TABLE|COLUMN|CONSTRAINT|FUNCTION|TRIGGER)\b/gimu);
  assert.match(rollback, /application-only and preserves every activation, artifact, and cleanup obligation/u);
  assert.match(rollback, /Do not drop or weaken schema/u);
});
