import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const directory = "migrations/ai-media-studio";
const read = (name: string) => readFileSync(resolve(process.cwd(), directory, name), "utf8");
const forward = read("20260720_pr6_provider_identity_forward.sql");
const rollback = read("20260720_pr6_provider_identity_rollback.sql");
const model = readFileSync(resolve(process.cwd(), "shared/models/ai-media-studio-db.ts"), "utf8");
const repository = readFileSync(
  resolve(process.cwd(), "server/ai-media-studio/persistence/drizzle-media-job-repository.ts"),
  "utf8",
);

test("PR6 provider identity migration is bounded, transactional, and dependency-preflighted", () => {
  assert.match(forward, /^--[\s\S]*\nBEGIN;/);
  assert.match(forward, /SET LOCAL lock_timeout = '5s'/);
  assert.match(forward, /SET LOCAL statement_timeout = '15min'/);
  for (const dependency of [
    "ai_media_provider_accounts", "ai_media_render_jobs", "ai_media_webhook_events",
  ]) assert.match(forward, new RegExp(`'${dependency}'`));
  assert.equal((forward.match(/\bBEGIN;/g) ?? []).length, 1);
  assert.equal((forward.match(/\bCOMMIT;/g) ?? []).length, 1);
  assert.match(forward, /COMMIT;\s*$/);
});

test("migration backfills only exact identity and blocks unresolved live rows or callbacks", () => {
  assert.match(forward, /ambiguous legacy provider accounts block deterministic PR6 render backfill/);
  assert.match(forward, /SELECT count\(\*\)[\s\S]*accounts\.provider_key = jobs\.provider_key[\s\S]*\) > 1/);
  assert.match(forward, /UPDATE ai_media_render_jobs AS jobs[\s\S]*accounts\.owner_user_id = jobs\.owner_user_id[\s\S]*accounts\.workspace_id = jobs\.workspace_id[\s\S]*accounts\.provider_key = jobs\.provider_key/);
  assert.match(forward, /UPDATE ai_media_webhook_events AS events[\s\S]*events\.render_job_id = jobs\.id/);
  assert.match(forward, /SELECT count\(\*\)[\s\S]*candidate\.provider_job_id = events\.provider_job_id[\s\S]*\) = 1/);
  assert.match(forward, /unresolved submitted\/live render provider accounts block PR6/);
  assert.match(forward, /unresolved webhook provider accounts block PR6/);
  assert.match(forward, /ALTER COLUMN provider_account_id SET NOT NULL/);
  assert.doesNotMatch(forward, /COALESCE\([^)]*provider_account_id|LIMIT 1[\s\S]*provider_account_id/i);
});

test("provider jobs and webhook events are unique and indexed inside an account", () => {
  assert.match(forward, /ai_media_render_jobs_provider_account_job_uq[\s\S]*provider_account_id, provider_key, provider_job_id[\s\S]*WHERE provider_job_id IS NOT NULL/);
  assert.match(forward, /ai_media_webhook_events_provider_account_event_uq[\s\S]*provider_account_id, provider_key, event_id/);
  assert.match(forward, /ai_media_webhook_events_provider_account_job_status_idx[\s\S]*provider_account_id, provider_key, provider_job_id, status/);
  assert.match(forward, /DROP INDEX IF EXISTS ai_media_render_jobs_provider_job_uq/);
  assert.match(forward, /DROP INDEX IF EXISTS ai_media_webhook_events_provider_event_uq/);
  assert.match(forward, /DROP INDEX IF EXISTS ai_media_provider_accounts_owner_workspace_provider_uq/);
  assert.match(model, /uniqueIndex\("ai_media_render_jobs_provider_account_job_uq"\)[\s\S]*providerAccountId[\s\S]*providerJobId[\s\S]*\.where/);
  assert.match(model, /uniqueIndex\("ai_media_webhook_events_provider_account_event_uq"\)/);
  assert.doesNotMatch(model, /uniqueIndex\("ai_media_provider_accounts_owner_workspace_provider_uq"\)/);
});

test("provider-account and render links are tenant/provider composite foreign keys", () => {
  for (const constraint of [
    "ai_media_render_jobs_provider_account_tenant_fk",
    "ai_media_webhook_events_provider_account_tenant_fk",
    "ai_media_webhook_events_render_job_identity_fk",
  ]) {
    assert.match(forward, new RegExp(constraint));
    assert.match(forward, new RegExp(`VALIDATE CONSTRAINT ${constraint}`));
  }
  assert.match(forward, /FOREIGN KEY \(owner_user_id, workspace_id, provider_account_id, provider_key\)[\s\S]*REFERENCES ai_media_provider_accounts \(owner_user_id, workspace_id, id, provider_key\)/);
  assert.match(forward, /FOREIGN KEY \(owner_user_id, workspace_id, provider_account_id, provider_key, render_job_id\)[\s\S]*REFERENCES ai_media_render_jobs \(owner_user_id, workspace_id, provider_account_id, provider_key, id\)/);
});

test("webhook endpoint and rotation metadata stores bounded opaque references only", () => {
  for (const field of [
    "webhook_endpoint_key text",
    "webhook_secret_ref text",
    "webhook_previous_secret_ref text",
    "webhook_previous_secret_expires_at timestamptz",
  ]) assert.match(forward, new RegExp(field));
  assert.match(forward, /webhook_endpoint_key IS NULL\) = \(webhook_secret_ref IS NULL/);
  assert.match(forward, /length\(btrim\(webhook_endpoint_key\)\) BETWEEN 24 AND 128/);
  assert.match(forward, /webhook_endpoint_key ~ '\^\[A-Za-z0-9_-\]\+\$'/);
  assert.match(forward, /webhook_previous_secret_ref IS NULL\) = \(webhook_previous_secret_expires_at IS NULL/);
  assert.match(forward, /webhook_previous_secret_ref IS NULL OR webhook_secret_ref IS NOT NULL/);
  assert.match(forward, /ai_media_provider_accounts_provider_endpoint_uq[\s\S]*provider_key, webhook_endpoint_key[\s\S]*WHERE webhook_endpoint_key IS NOT NULL/);
  assert.match(model, /webhookSecretRef: text\("webhook_secret_ref"\)/);
  assert.match(model, /webhookPreviousSecretExpiresAt: timestamp\("webhook_previous_secret_expires_at"/);
  assert.doesNotMatch(forward, /(?:api[_ -]?key|bearer|access[_ -]?token|refresh[_ -]?token)\s*=/i);
});

test("durable repository scopes lookup, dedupe, parking, and claiming by provider account", () => {
  assert.match(repository, /getByProviderJob\([\s\S]*providerAccountId: string[\s\S]*eq\(aiMediaRenderJobs\.providerAccountId, providerAccountId\)/);
  assert.match(repository, /recordWebhook[\s\S]*eq\(aiMediaProviderAccounts\.id, event\.providerAccountId\)/);
  assert.match(repository, /target: \[[\s\S]*aiMediaWebhookEvents\.providerAccountId[\s\S]*aiMediaWebhookEvents\.eventId/);
  assert.match(repository, /parkWebhook[\s\S]*eq\(aiMediaWebhookEvents\.providerAccountId, event\.providerAccountId\)/);
  assert.match(repository, /takeParkedWebhooks\([\s\S]*providerAccountId: string[\s\S]*eq\(aiMediaWebhookEvents\.providerAccountId, providerAccountId\)/);
});

test("rollback preserves provider identity and never recreates unsafe global uniqueness", () => {
  for (const migration of [forward, rollback]) {
    assert.doesNotMatch(migration, /\bDROP\s+TABLE\b/i);
    assert.doesNotMatch(migration, /\bDROP\s+COLUMN\b/i);
    assert.doesNotMatch(migration, /\bTRUNCATE\b/i);
    assert.doesNotMatch(migration, /\bDELETE\s+FROM\b/i);
  }
  assert.match(rollback, /does not restore the old[\s\S]*one-account-per-provider rule/i);
  assert.doesNotMatch(rollback, /CREATE UNIQUE INDEX[\s\S]*provider_job_uq/i);
  assert.match(rollback, /opaque ref/);
  assert.match(rollback, /COMMIT;\s*$/);
});
