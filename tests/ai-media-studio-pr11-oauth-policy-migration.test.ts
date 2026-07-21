import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const forward = readFileSync(
  new URL("../migrations/ai-media-studio/20260721_pr11_oauth_policy_forward.sql", import.meta.url),
  "utf8",
);
const rollback = readFileSync(
  new URL("../migrations/ai-media-studio/20260721_pr11_oauth_policy_rollback.sql", import.meta.url),
  "utf8",
);

function normalized(value: string): string {
  return value.replace(/--.*$/gm, "").replace(/\s+/g, " ").trim();
}

test("PR11 migration is transactional, bounded, and preflights validated PR9 controls", () => {
  assert.match(forward, /^--[\s\S]*\bBEGIN;/u);
  assert.match(forward, /SET LOCAL lock_timeout = '5s'/u);
  assert.match(forward, /SET LOCAL statement_timeout = '15min'/u);
  assert.match(forward, /SET LOCAL search_path = public, pg_catalog/u);
  assert.match(forward, /to_regclass\('public\.ai_media_oauth_sessions'\)/u);
  assert.match(forward, /conname = 'ai_media_oauth_sessions_pkce_ck'[\s\S]*convalidated/u);
  assert.match(forward, /conname = 'ai_media_oauth_sessions_redirect_ck'[\s\S]*convalidated/u);
  assert.match(forward, /COMMIT;\s*$/u);
});

test("PR11 backfills the provider-neutral snapshot before relaxing exactly the three PKCE fields", () => {
  assert.match(forward, /column_name = 'pkce_mode'[\s\S]*requires pkce_mode to be absent/u);
  assert.match(forward, /ADD COLUMN pkce_mode text;/u);
  assert.doesNotMatch(forward, /ADD COLUMN IF NOT EXISTS pkce_mode|ADD COLUMN pkce_mode text NOT NULL/u);
  assert.match(forward, /SET pkce_mode = 'required_s256'\s+WHERE pkce_mode IS NULL/u);
  assert.match(forward, /ALTER COLUMN pkce_mode SET NOT NULL/u);
  assert.doesNotMatch(forward, /ALTER COLUMN pkce_mode SET DEFAULT|pkce_mode text[^;]*DEFAULT/u);
  assert.match(forward, /ALTER COLUMN code_challenge DROP NOT NULL/u);
  assert.match(forward, /ALTER COLUMN code_challenge_method DROP DEFAULT/u);
  assert.match(forward, /ALTER COLUMN code_challenge_method DROP NOT NULL/u);
  assert.match(forward, /ALTER COLUMN pkce_verifier_ref DROP NOT NULL/u);
});

test("PR11 replaces only the old PKCE constraint with a generic validated snapshot constraint", () => {
  assert.match(forward, /DROP CONSTRAINT ai_media_oauth_sessions_pkce_ck;/u);
  assert.doesNotMatch(forward, /DROP CONSTRAINT IF EXISTS ai_media_oauth_sessions_pkce_ck/u);
  const snapshot = forward.match(/ADD CONSTRAINT ai_media_oauth_sessions_pkce_ck CHECK \(([\s\S]*?)\) NOT VALID;/u)?.[1] ?? "";
  assert.ok(snapshot);
  assert.match(snapshot, /pkce_mode = 'required_s256'/u);
  assert.match(snapshot, /code_challenge IS NOT NULL/u);
  assert.match(snapshot, /code_challenge_method = 'S256'/u);
  assert.match(snapshot, /pkce_verifier_ref IS NOT NULL/u);
  assert.match(snapshot, /pkce_mode = 'none'/u);
  assert.match(snapshot, /code_challenge IS NULL/u);
  assert.match(snapshot, /code_challenge_method IS NULL/u);
  assert.match(snapshot, /pkce_verifier_ref IS NULL/u);
  assert.doesNotMatch(snapshot, /platform|tiktok|instagram|facebook|youtube/u);
  assert.match(forward, /VALIDATE CONSTRAINT ai_media_oauth_sessions_pkce_ck/u);
});

test("PR11 keeps the broad redirect constraint and adds a validated canonical-authority fence", () => {
  assert.doesNotMatch(forward, /DROP CONSTRAINT (?:IF EXISTS )?ai_media_oauth_sessions_redirect_ck/u);
  const trusted = forward.match(/ADD CONSTRAINT ai_media_oauth_sessions_redirect_trusted_ck CHECK \(([\s\S]*?)\) NOT VALID;/u)?.[1] ?? "";
  assert.ok(trusted);
  assert.match(trusted, /length\(redirect_uri\) BETWEEN 12 AND 512/u);
  assert.match(trusted, /redirect_uri !~ '\[\?#\]'/u);
  assert.match(trusted, /\[\[:cntrl:\]\[:space:\]\]/u);
  assert.match(trusted, /position\(chr\(92\) in redirect_uri\) = 0/u);
  assert.match(trusted, /\[\^\/\]\*\[@:\]/u);
  assert.match(trusted, /\^https:\/\/[a-z0-9]/u);
  assert.match(trusted, /position\('\.\.' in split_part/u);
  assert.match(trusted, /\^https:\/\/localhost\//u);
  assert.match(trusted, /0x\[0-9a-f\]\+/u);
  assert.match(forward, /VALIDATE CONSTRAINT ai_media_oauth_sessions_redirect_trusted_ck/u);
});

test("PR11 forward and rollback preserve all rows, columns, tables, and audit evidence", () => {
  const forwardSql = normalized(forward);
  const rollbackSql = normalized(rollback);
  for (const sql of [forwardSql, rollbackSql]) {
    assert.doesNotMatch(sql, /\b(?:DELETE|TRUNCATE)\b/iu);
    assert.doesNotMatch(sql, /\bDROP\s+(?:TABLE|COLUMN)\b/iu);
  }
  assert.match(rollback, /application-only/u);
  assert.match(rollback, /does\s+not drop columns or constraints/u);
  assert.match(rollback, /COMMIT;\s*$/u);
});
