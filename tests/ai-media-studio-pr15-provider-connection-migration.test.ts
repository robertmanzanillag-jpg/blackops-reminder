import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const forward = readFileSync(new URL("../migrations/ai-media-studio/20260721_pr15_provider_connection_stages_forward.sql", import.meta.url), "utf8");
const rollback = readFileSync(new URL("../migrations/ai-media-studio/20260721_pr15_provider_connection_stages_rollback.sql", import.meta.url), "utf8");

test("PR15 migration is transactional, additive, unapplied, and relation-exact preflighted on PR12/PR14", () => {
  assert.match(forward, /^--[\s\S]*BEGIN;/u);
  assert.match(forward, /Do not apply automatically/u);
  assert.match(forward, /lock_timeout = '5s'/u);
  for (const control of [
    "ai_media_oauth_sessions_authorization_saga_ck",
    "ai_media_oauth_sessions_provider_account_tenant_platform_fk",
    "ai_media_provider_accounts_oauth_credential_provenance_ck",
    "ai_media_oauth_vault_operations_lifecycle_ck",
    "ai_media_oauth_vault_operations_session_source_fk",
  ]) assert.match(forward, new RegExp(control, "u"));
  assert.match(forward, /convalidated/u);
  assert.match(forward, /COMMIT;\s*$/u);
});

test("PR15 creates exactly three additive provider-connection evidence tables", () => {
  const creates = [...forward.matchAll(/CREATE TABLE (ai_media_oauth_[a-z_]+)/gu)].map((match) => match[1]);
  assert.deepEqual(creates, [
    "ai_media_oauth_connection_attempts",
    "ai_media_oauth_target_candidates",
    "ai_media_oauth_target_selections",
  ]);
  const uncommented = forward.replace(/--.*$/gmu, "");
  assert.doesNotMatch(uncommented, /\bALTER TABLE\s+(?:ai_media_oauth_sessions|ai_media_provider_accounts|ai_media_oauth_vault_operations)\b/iu);
  assert.doesNotMatch(uncommented, /\bDELETE\s+FROM\b|\bTRUNCATE\b|\bDROP\s+(?:TABLE|COLUMN)\b/iu);
});

test("attempts freeze stages, scopes, grant, manifest, token binding, versions, leases and terminal evidence", () => {
  for (const value of [
    "exchange_pending", "exchange_in_progress", "exchange_indeterminate", "discovery_pending",
    "discovery_in_progress", "awaiting_target", "activation_pending", "activation_in_progress",
    "authorized", "failed", "stage_version", "grant_family", "manifest_revision", "required_scopes",
    "allowed_scopes", "actual_scopes", "token_binding_id", "expected_credential_version",
    "target_credential_version", "lease_token", "lease_fencing", "terminal_evidence_digest", "no_targets",
  ]) assert.match(forward, new RegExp(value, "u"));
  assert.match(forward, /allowed_scopes @> required_scopes/u);
  assert.match(forward, /actual_scopes @> required_scopes AND allowed_scopes @> actual_scopes/u);
  assert.match(forward, /lease_expires_at<=updated_at\+interval '5 minutes'/u);
  assert.match(forward, /token_artifacts::text !~\*[^\n]+reference/u);
});

test("candidate and selection rows carry exact source identity and exact immutable candidate linkage", () => {
  for (const value of ["candidate_id", "target_kind", "target_external_id", "safe_label", "parent_target_id",
    "eligibility_digest", "verified_tasks", "capabilities", "manifest_revision", "discovered_at",
    "selected_actor_user_id", "selected_at", "selection_digest", "selection_version", "selected_stage_version"]) {
    assert.match(forward, new RegExp(value, "u"));
  }
  assert.match(forward, /ai_media_oauth_target_selections_attempt_uq/u);
  assert.match(forward, /ai_media_oauth_target_selections_exact_candidate_fk/u);
  assert.match(forward, /CREATE TRIGGER ai_media_oauth_target_candidates_immutable/u);
  assert.match(forward, /CREATE TRIGGER ai_media_oauth_target_selections_immutable/u);
  assert.match(forward, /BEFORE UPDATE OR DELETE/u);
  assert.match(forward, /FOREIGN KEY\(owner_user_id,workspace_id,actor_user_id,provider_account_id,platform,oauth_session_id,attempt_id,[\s\S]*candidate_id,target_kind,target_external_id\)/u);
  assert.match(forward, /NOT VALID;/u);
  assert.match(forward, /VALIDATE CONSTRAINT ai_media_oauth_target_selections_exact_candidate_fk/u);
});

test("PR15 SQL has no credential, secret, token reference, or raw provider payload columns", () => {
  const columnDefinitions = forward.split("\n").filter((line) => /^\s{2}[a-z_]+\s+(?:text|uuid|jsonb|integer|timestamptz)\b/u.test(line)).join("\n");
  assert.doesNotMatch(columnDefinitions, /\b(?:secret|token_ref|reference|access_token|refresh_token|authorization_code|raw_provider|provider_json)\b/iu);
});

test("rollback is application-only and preserves all PR15 data and evidence", () => {
  const sql = (forward + rollback).replace(/--.*$/gmu, "");
  assert.match(rollback, /application-only/u);
  assert.match(rollback, /Do not drop/u);
  assert.doesNotMatch(sql, /\bDELETE\s+FROM\b|\bTRUNCATE\b/iu);
  assert.doesNotMatch(sql, /\bDROP\s+(?:TABLE|COLUMN)\b/iu);
});
