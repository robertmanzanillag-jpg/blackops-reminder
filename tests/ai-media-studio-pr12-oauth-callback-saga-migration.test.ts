import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const forward = readFileSync(new URL("../migrations/ai-media-studio/20260721_pr12_oauth_callback_saga_forward.sql", import.meta.url), "utf8");
const rollback = readFileSync(new URL("../migrations/ai-media-studio/20260721_pr12_oauth_callback_saga_rollback.sql", import.meta.url), "utf8");
const normalized = (value: string) => value.replace(/--.*$/gm, "").replace(/\s+/g, " ").trim();

test("PR12 is transactional, bounded, unapplied, and strictly preflights validated PR11 controls", () => {
  assert.match(forward, /^--[\s\S]*\bBEGIN;/u); assert.match(forward, /lock_timeout = '5s'/u);
  assert.match(forward, /statement_timeout = '15min'/u); assert.match(forward, /search_path = public, pg_catalog/u);
  for (const name of ["pkce_ck", "redirect_ck", "redirect_trusted_ck", "status_ck", "lifecycle_ck"]) assert.match(forward, new RegExp(name, "u"));
  assert.match(forward, /convalidated/u); assert.match(forward, /new saga constraints to be absent/u);
  assert.match(forward, /COMMIT;\s*$/u);
});

test("PR12 explicitly backfills legacy rows and installs validated durable saga controls", () => {
  assert.match(forward, /legacy_authorized_unbound/u); assert.match(forward, /outcome='authorized'/u);
  assert.match(forward, /outcome IN \('denied','error'\).*'not_required'/su);
  for (const column of ["exchange_status", "lease_token", "lease_fencing", "authorization_code_digest",
    "authorization_code_ref", "expected_credential_version", "target_credential_version", "token_binding_id"]) assert.match(forward, new RegExp(`ADD COLUMN ${column}`, "u"));
  assert.match(forward, /status IN \('pending','processing','consumed'\)/u);
  assert.match(forward, /VALIDATE CONSTRAINT ai_media_oauth_sessions_authorization_saga_ck/u);
  assert.match(forward, /lease_fencing >= 0/u); assert.match(forward, /target_credential_version = expected_credential_version \+ 1/u);
  assert.match(forward, /lease_expires_at <= updated_at \+ interval '5 minutes'/u);
  assert.match(forward, /outcome <> 'authorized' OR exchange_status IN \('succeeded','legacy_authorized_unbound'\)/u);
  assert.match(forward, /oauth-code\/v1\/[\s\S]*\[0-9a-f\]/u);
});

test("PR12 constrains canonical OAuth credential provenance and preserves data on rollback", () => {
  assert.match(forward, /credential_source='oauth_authorization'/u); assert.match(forward, /status='active'/u);
  assert.match(forward, /credential_status='active'/u); assert.match(forward, /oauth-token\/v1\//u);
  assert.match(forward, /token_kind='Bearer'/u); assert.match(forward, /VALIDATE CONSTRAINT ai_media_provider_accounts_oauth_credential_provenance_ck/u);
  assert.match(forward, /credential_actor_user_id/u); assert.match(forward, /credential_source_session_id/u);
  assert.match(forward, /ai_media_provider_accounts_oauth_source_session_fk/u);
  assert.match(forward, /ai_media_oauth_sessions_authorization_code_ref_uq/u);
  assert.match(forward, /ai_media_provider_accounts_oauth_secret_ref_uq/u);
  for (const sql of [normalized(forward), normalized(rollback)]) {
    assert.doesNotMatch(sql, /(?:^|;)\s*(?:DELETE|TRUNCATE)\b/iu); assert.doesNotMatch(sql, /\bDROP\s+(?:TABLE|COLUMN)\b/iu);
  }
  assert.match(rollback, /application-only/u); assert.match(rollback, /does not delete rows/u);
});
