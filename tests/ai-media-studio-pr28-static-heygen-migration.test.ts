import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const forward = readFileSync(new URL(
  "../migrations/ai-media-studio/pending/20260722_pr28_static_heygen_credentials_forward.sql",
  import.meta.url,
), "utf8");
const rollback = readFileSync(new URL(
  "../migrations/ai-media-studio/pending/20260722_pr28_static_heygen_credentials_rollback.sql",
  import.meta.url,
), "utf8");

test("PR28 persists references and immutable binding evidence, never API key material", () => {
  assert.match(forward, /current_setting\('server_version_num'\)::integer<160000/iu);
  assert.match(forward, /to_regclass\('public\.ai_media_provider_terminal_checks'\) IS NULL/iu);
  assert.match(forward, /to_regprocedure\('ai_media_worker_api\.record_provider_terminal_v1/iu);
  assert.match(forward, /CREATE TABLE ai_media_static_credential_bindings/iu);
  assert.match(forward, /expected_credential_version integer NOT NULL/iu);
  assert.match(forward, /target_credential_version=expected_credential_version\+1/iu);
  assert.match(forward, /request_digest ~ '\^sha256:\[0-9a-f\]\{64\}\$'/iu);
  assert.match(forward, /secret_ref ~ '\^env:\/\/AI_MEDIA_STUDIO_SECRET_HEYGEN_API_KEY/iu);
  assert.match(forward, /CREATE CONSTRAINT TRIGGER ai_media_provider_accounts_static_credential_graph/iu);
  assert.match(forward, /CREATE CONSTRAINT TRIGGER ai_media_static_credential_bindings_graph/iu);
  assert.match(forward, /DEFERRABLE INITIALLY DEFERRED/iu);
  assert.match(forward, /binding\.target_credential_version=account_row\.credential_version/iu);
  assert.match(forward, /binding\.secret_ref=account_row\.secret_ref/iu);
  assert.doesNotMatch(forward, /api[_ ]?key\s+(?:text|varchar|bytea)|x-api-key|private-test-value/iu);
});

test("PR28 keeps new bindings pending and accounts disconnected/unverified", () => {
  assert.match(forward, /lifecycle_state text NOT NULL DEFAULT 'pending'/iu);
  assert.match(forward, /verification_state text NOT NULL DEFAULT 'unverified'/iu);
  const staticBranch = forward.match(/OR \(credential_source='static_api_key'[\s\S]*?capabilities='\[\]'::jsonb\)/u)?.[0];
  assert.ok(staticBranch);
  assert.match(staticBranch, /status='disconnected'.*credential_status='unverified'/su);
  assert.doesNotMatch(staticBranch, /credential_status='active'/u);
  assert.doesNotMatch(staticBranch, /last_verified_at IS NOT NULL/u);
});

test("PR28 is provider-I/O free and rollback preserves evidence", () => {
  for (const sql of [forward, rollback]) {
    assert.doesNotMatch(sql, /\b(?:dblink|http_get|http_post|curl|wget|COPY\s+PROGRAM|lo_import)\b|\bnet\.http_/iu);
    assert.match(sql, /BEGIN;/u);
    assert.match(sql, /COMMIT;/u);
  }
  assert.match(rollback, /IF EXISTS \(SELECT 1 FROM ai_media_static_credential_bindings\)/iu);
  assert.match(rollback, /rollback preserves static credential evidence; stop and forward-fix/iu);
  assert.match(rollback, /DROP TRIGGER ai_media_provider_accounts_static_credential_graph/iu);
  assert.match(rollback, /DROP FUNCTION ai_media_static_credential_assert_account_v1\(text,text,uuid\)/iu);
  assert.ok(rollback.indexOf("DROP TABLE ai_media_static_credential_bindings")
    > rollback.indexOf("rollback preserves static credential evidence"));
});
