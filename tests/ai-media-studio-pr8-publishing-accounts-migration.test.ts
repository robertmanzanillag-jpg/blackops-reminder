import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const directory = "migrations/ai-media-studio";
const read = (name: string) => readFileSync(resolve(process.cwd(), directory, name), "utf8");
const forward = read("20260721_pr8_publishing_accounts_forward.sql");
const rollback = read("20260721_pr8_publishing_accounts_rollback.sql");
const model = readFileSync(resolve(process.cwd(), "shared/models/ai-media-studio-db.ts"), "utf8");
const publishingJobsModel = model.slice(
  model.indexOf("export const aiMediaPublishingJobs"),
  model.indexOf("export const aiMediaPublications"),
);

test("PR8 publishing-account migration is bounded, transactional, and dependency-preflighted", () => {
  assert.match(forward, /^--[\s\S]*\nBEGIN;/);
  assert.match(forward, /SET LOCAL lock_timeout = '5s'/);
  assert.match(forward, /SET LOCAL statement_timeout = '15min'/);
  assert.equal((forward.match(/\bBEGIN;/g) ?? []).length, 1);
  assert.equal((forward.match(/\bCOMMIT;/g) ?? []).length, 1);
  assert.match(forward, /COMMIT;\s*$/);

  for (const dependency of ["ai_media_provider_accounts", "ai_media_publishing_jobs"]) {
    assert.match(forward, new RegExp(`'${dependency}'`));
  }
  for (const column of ["owner_user_id", "workspace_id", "id", "provider_key", "provider_account_id", "platform"]) {
    assert.match(forward, new RegExp(`'${column}'`));
  }
  assert.match(forward, /ai_media_provider_accounts_owner_workspace_id_provider_uq/);
  assert.match(forward, /indexes\.indisunique/);
  assert.match(forward, /indexes\.indisvalid/);
  assert.match(forward, /ARRAY\['owner_user_id', 'workspace_id', 'id', 'provider_key'\]::name\[\]/);
});

test("migration fails closed on every invalid non-null publishing-account binding", () => {
  assert.match(forward, /LEFT JOIN ai_media_provider_accounts AS accounts/);
  assert.match(forward, /accounts\.owner_user_id = jobs\.owner_user_id/);
  assert.match(forward, /accounts\.workspace_id = jobs\.workspace_id/);
  assert.match(forward, /accounts\.id = jobs\.provider_account_id/);
  assert.match(forward, /accounts\.provider_key = jobs\.platform/);
  assert.match(forward, /WHERE jobs\.provider_account_id IS NOT NULL[\s\S]*accounts\.id IS NULL/);
  assert.match(forward, /orphaned, cross-tenant, or platform-mismatched publishing accounts block PR8/);
  assert.doesNotMatch(forward, /\bUPDATE\s+ai_media_publishing_jobs\b/i);
  assert.doesNotMatch(forward, /\bINSERT\s+INTO\b/i);
});

test("migration replaces the known simple foreign key with one validated composite foreign key", () => {
  assert.match(forward, /DROP CONSTRAINT ai_media_publishing_jobs_provider_account_id_ai_media_provider_/);
  assert.match(forward, /ADD CONSTRAINT ai_media_publishing_jobs_provider_account_tenant_platform_fk/);
  assert.match(
    forward,
    /FOREIGN KEY \(owner_user_id, workspace_id, provider_account_id, platform\)[\s\S]*REFERENCES ai_media_provider_accounts \(owner_user_id, workspace_id, id, provider_key\)/,
  );
  assert.match(forward, /ON UPDATE NO ACTION[\s\S]*ON DELETE NO ACTION[\s\S]*NOT VALID/);
  assert.match(forward, /VALIDATE CONSTRAINT ai_media_publishing_jobs_provider_account_tenant_platform_fk/);
});

test("Drizzle models the same tenant/workspace/platform identity without a simple SET NULL reference", () => {
  assert.match(publishingJobsModel, /providerAccountId: uuid\("provider_account_id"\),/);
  assert.match(publishingJobsModel, /platform: text\("platform"\)\.notNull\(\)/);
  assert.match(publishingJobsModel, /foreignKey\(\{[\s\S]*columns: \[table\.ownerUserId, table\.workspaceId, table\.providerAccountId, table\.platform\]/);
  assert.match(publishingJobsModel, /foreignColumns: \[[\s\S]*aiMediaProviderAccounts\.ownerUserId[\s\S]*aiMediaProviderAccounts\.workspaceId[\s\S]*aiMediaProviderAccounts\.id[\s\S]*aiMediaProviderAccounts\.providerKey/);
  assert.match(publishingJobsModel, /name: "ai_media_publishing_jobs_provider_account_tenant_platform_fk"/);
  assert.match(publishingJobsModel, /\.onUpdate\("no action"\)[\s\S]*\.onDelete\("no action"\)/);
  assert.doesNotMatch(publishingJobsModel, /providerAccountId:[^\n]*\.references/);
  assert.doesNotMatch(publishingJobsModel, /providerAccountId:[^\n]*set null/i);
});

test("PR8 introduces no plaintext token or credential columns", () => {
  const addedColumns = [...forward.matchAll(/ADD COLUMN(?: IF NOT EXISTS)?\s+([a-z0-9_]+)/gi)]
    .map((match) => match[1]);
  assert.deepEqual(addedColumns, []);
  assert.doesNotMatch(publishingJobsModel, /text\("(?:access_token|refresh_token|api_key|client_secret|password|credential)"\)/i);
});

test("rollback is application-only and preserves schema, constraints, columns, and data", () => {
  for (const migration of [forward, rollback]) {
    assert.doesNotMatch(migration, /\bDROP\s+TABLE\b/i);
    assert.doesNotMatch(migration, /\bDROP\s+COLUMN\b/i);
    assert.doesNotMatch(migration, /\bTRUNCATE\b/i);
    assert.doesNotMatch(migration, /\bDELETE\s+FROM\b/i);
  }
  assert.doesNotMatch(rollback, /\bDROP\s+CONSTRAINT\b/i);
  assert.match(rollback, /application-only/i);
  assert.match(rollback, /composite constraint[\s\S]*columns[\s\S]*every row/i);
  assert.match(rollback, /COMMIT;\s*$/);
});
