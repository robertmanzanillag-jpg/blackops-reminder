import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import test from "node:test";

const runbookUrl = new URL("../docs/ai-media-studio/staging-rehearsal-runbook.md", import.meta.url);
const migrationDirectoryUrl = new URL("../migrations/ai-media-studio/", import.meta.url);
const migrationsReadme = readFileSync(new URL("README.md", migrationDirectoryUrl), "utf8");
const pr14Forward = readFileSync(new URL("20260721_pr14_oauth_vault_operations_forward.sql", migrationDirectoryUrl), "utf8");
const pr26Forward = readFileSync(new URL("20260721_pr26_db_capability_forward.sql", migrationDirectoryUrl), "utf8");
const runbook = readFileSync(runbookUrl, "utf8");

const migrationPrefixes = [
  "20260720_pr2_core",
  "20260720_pr3_operations",
  "20260720_pr4_assets",
  "20260720_pr5_governance",
  "20260720_pr6_provider_identity",
  "20260721_pr8_publishing_accounts",
  "20260721_pr9_oauth_foundation",
  "20260721_pr11_oauth_policy",
  "20260721_pr12_oauth_callback_saga",
  "20260721_pr14_oauth_vault_operations",
  "20260721_pr15_provider_connection_stages",
  "20260721_pr19_daily_admission",
  "20260721_pr20_launch_authorities",
  "20260721_pr22_launch_intents",
  "20260721_pr23_admission_held_handoff",
  "20260721_pr24_held_activation",
  "20260721_pr25_admitted_worker",
  "20260721_pr26_db_capability",
  "20260721_pr27_heygen_terminal",
] as const;

test("staging runbook is no-go and names every available migration in exact forward/reverse order", () => {
  assert.match(runbook, /Status: \*\*NO-GO \/ preparation only\*\*/u);
  assert.match(runbook, /Nothing in this runbook authorizes a[\s\S]*database connection/u);
  assert.match(runbook, /PR13's reviewed commit is schema-neutral/u);
  assert.match(runbook, /PR16[\s\S]*mandatory stop/u);
  assert.doesNotMatch(runbook, /(?:drizzle-kit push|npm run db:push)[\s\S]{0,80}(?:use|run|execute) it/u);

  let previousForward = -1;
  for (const prefix of migrationPrefixes) {
    const filename = `${prefix}_forward.sql`;
    assert.equal(existsSync(new URL(filename, migrationDirectoryUrl)), true, `${filename} must exist`);
    const position = runbook.indexOf(`migrations/ai-media-studio/${filename}`);
    assert.ok(position > previousForward, `${filename} must appear once in forward order`);
    previousForward = position;
  }

  const reverseSection = runbook.slice(runbook.indexOf("## Reverse rehearsal"));
  let previousRollback = -1;
  for (const prefix of [...migrationPrefixes].reverse()) {
    const filename = `${prefix}_rollback.sql`;
    assert.equal(existsSync(new URL(filename, migrationDirectoryUrl)), true, `${filename} must exist`);
    const position = reverseSection.indexOf(filename);
    assert.ok(position > previousRollback, `${filename} must appear in reverse rollback order`);
    previousRollback = position;
  }
});

test("runbook inventory matches the SQL directory, proves PR13 schema-neutral and keeps PR16 as a stop", () => {
  const sqlFiles = readdirSync(migrationDirectoryUrl)
    .filter((name) => name.endsWith(".sql"))
    .sort();
  const expected = migrationPrefixes
    .flatMap((prefix) => [`${prefix}_forward.sql`, `${prefix}_rollback.sql`])
    .sort();
  assert.deepEqual(sqlFiles, expected);

  const pr12 = runbook.indexOf("20260721_pr12_oauth_callback_saga_forward.sql");
  const pr14 = runbook.indexOf("20260721_pr14_oauth_vault_operations_forward.sql");
  const pr16Stop = runbook.indexOf("PR16 reviewed-SQL decision gate");
  const pr19 = runbook.indexOf("20260721_pr19_daily_admission_forward.sql");
  assert.ok(pr12 < pr14);
  assert.ok(pr14 < pr16Stop && pr16Stop < pr19);
  assert.match(runbook, /PR14's database prerequisites are the validated PR12 OAuth saga/u);
  assert.match(pr14Forward, /PR14 requires PR12 OAuth callback saga schema/u);
  assert.match(pr14Forward, /PR14 requires validated PR12 OAuth saga and credential provenance controls/u);
  assert.match(migrationsReadme, /PR16 currently contains additive Drizzle schema declarations/u);
  assert.match(migrationsReadme, /does not yet contain reviewed forward\/rollback SQL/u);
  assert.match(runbook, /PR2 is a[\s\S]*delta, not an initial-schema migration/u);
});

test("runbook requires exact roles, private evidence, approvals and provider-free restart", () => {
  for (const role of [
    "ai_media_admitted_fn_owner",
    "ai_media_admitted_submit_executor",
    "ai_media_admitted_reconcile_executor",
  ]) assert.match(runbook, new RegExp(role, "u"));
  for (const role of [
    "ai_media_admitted_fn_owner",
    "ai_media_admitted_submit_executor",
    "ai_media_admitted_reconcile_executor",
  ]) assert.match(pr26Forward, new RegExp(role, "u"));
  assert.match(runbook, /NOLOGIN NOINHERIT/u);
  assert.match(runbook, /Separate\s+LOGIN principals/u);
  assert.match(runbook, /Never paste a connection string/u);
  assert.match(runbook, /workers disabled/u);
  assert.match(runbook, /one HeyGen[\s\S]*explicit approval/u);
  assert.match(runbook, /Replit\/production deploy[\s\S]*separately approve/u);
  assert.match(runbook, /PR23–PR27[\s\S]*forward fix/u);
  assert.match(runbook, /After the reverse SQL completes, restart the exact application revision/u);
  assert.match(runbook, /post-rollback restart evidence/u);
  assert.match(migrationsReadme, /staging-rehearsal-runbook\.md/u);
  assert.match(migrationsReadme, /sole[\s\S]*sequence authority[\s\S]*NO-GO/u);
});
