import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const directory = resolve(process.cwd(), "migrations/ai-media-studio");
const forward = readFileSync(resolve(directory, "20260721_pr9_oauth_foundation_forward.sql"), "utf8");
const rollback = readFileSync(resolve(directory, "20260721_pr9_oauth_foundation_rollback.sql"), "utf8");
const model = readFileSync(resolve(process.cwd(), "shared/models/ai-media-studio-db.ts"), "utf8");

test("PR9 migration is transacted, dependency-preflighted, additive, and unapplied", () => {
  assert.match(forward, /^--[\s\S]*\nBEGIN;/);
  assert.equal((forward.match(/\bBEGIN;/g) ?? []).length, 1);
  assert.equal((forward.match(/\bCOMMIT;/g) ?? []).length, 1);
  assert.match(forward, /lock_timeout = '5s'/);
  assert.match(forward, /statement_timeout = '15min'/);
  assert.match(forward, /ai_media_provider_accounts_owner_workspace_id_provider_uq/);
  assert.match(forward, /indexes\.indisunique AND indexes\.indisvalid/);
  assert.doesNotMatch(forward, /\bDROP\s+(?:TABLE|COLUMN)\b|\bTRUNCATE\b|\bDELETE\s+FROM\b/i);
  assert.match(forward, /COMMIT;\s*$/);
});

test("sessions persist only digest, exact binding, mandatory S256 and opaque verifier reference", () => {
  assert.match(forward, /state_digest text NOT NULL/);
  assert.match(forward, /UNIQUE INDEX[\s\S]*state_digest/i);
  assert.match(forward, /actor_user_id text NOT NULL/);
  assert.match(forward, /provider_account_id uuid NOT NULL/);
  assert.match(forward, /code_challenge_method text NOT NULL DEFAULT 'S256'/);
  assert.match(forward, /pkce_verifier_ref text NOT NULL/);
  assert.match(forward, /vault:\/\/ai-media-studio\/oauth-pkce\/v1/);
  assert.match(forward, /expires_at <= created_at \+ interval '15 minutes'/);
  assert.match(forward, /FOREIGN KEY \(owner_user_id, workspace_id, provider_account_id, platform\)/);
  assert.match(forward, /REFERENCES ai_media_provider_accounts \(owner_user_id, workspace_id, id, provider_key\)/);
  assert.match(forward, /NOT VALID/);
  assert.match(forward, /VALIDATE CONSTRAINT ai_media_oauth_sessions_provider_account_tenant_platform_fk/);
  assert.doesNotMatch(forward, /\b(?:access_token|refresh_token|authorization_code|client_secret|code_verifier)\b/i);
  assert.doesNotMatch(model, /text\("(?:access_token|refresh_token|authorization_code|client_secret|code_verifier)"\)/i);
});

test("credential metadata leaves legacy accounts unverified and version zero", () => {
  assert.match(forward, /credential_status text NOT NULL DEFAULT 'unverified'/);
  assert.match(forward, /credential_version integer NOT NULL DEFAULT 0/);
  assert.doesNotMatch(forward, /UPDATE[\s\S]*credential_status/i);
  assert.match(model, /credentialStatus: text\("credential_status"\)\.notNull\(\)\.default\("unverified"\)/);
});

test("rollback preserves control-plane evidence and isolation", () => {
  for (const sql of [forward, rollback]) {
    assert.doesNotMatch(sql, /\bDROP\s+(?:TABLE|COLUMN|CONSTRAINT)\b|\bTRUNCATE\b|\bDELETE\s+FROM\b/i);
  }
  assert.match(rollback, /application-only/i);
  assert.match(rollback, /all audit[\s\S]*remain intact/i);
  assert.match(rollback, /COMMIT;\s*$/);
});
