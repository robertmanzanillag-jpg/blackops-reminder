import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const migrationDirectory = "migrations/ai-media-studio";
const readArtifact = (name: string) =>
  readFileSync(resolve(process.cwd(), migrationDirectory, name), "utf8");

const forward = readArtifact("20260720_pr2_core_forward.sql");
const rollback = readArtifact("20260720_pr2_core_rollback.sql");
const runbook = readArtifact("README.md");

const position = (source: string, pattern: RegExp) => {
  const match = pattern.exec(source);
  assert.ok(match, `missing migration fragment: ${pattern}`);
  return match.index;
};

test("forward migration is bounded, transactional, and rejects a missing PR1 schema", () => {
  assert.match(forward, /^--[\s\S]*\nBEGIN;/);
  assert.match(forward, /SET LOCAL lock_timeout = '5s'/);
  assert.match(forward, /SET LOCAL statement_timeout = '15min'/);
  assert.match(forward, /SET LOCAL search_path = public, pg_catalog/);
  assert.match(forward, /to_regclass\('public\.' \|\| required_table\)/);
  assert.match(forward, /COMMIT;\s*$/);
  assert.equal((forward.match(/\bBEGIN;/g) ?? []).length, 1);
  assert.equal((forward.match(/\bCOMMIT;/g) ?? []).length, 1);
  assert.equal((forward.match(/DO \$[a-z]+\$/g) ?? []).length, 3);
  assert.equal((forward.match(/END;\s*\n\$[a-z]+\$;/g) ?? []).length, 3);
  assert.equal((rollback.match(/END;\s*\n\$[a-z]+\$;/g) ?? []).length, 1);
});

test("all PR2 required columns are backfilled before NOT NULL", () => {
  const influencerBackfill = position(forward, /UPDATE ai_media_influencers\s+SET/);
  const influencerNotNull = position(forward, /ALTER COLUMN accent SET NOT NULL/);
  assert.ok(influencerBackfill < influencerNotNull);

  for (const column of [
    "accent",
    "language",
    "gender",
    "age_range",
    "personality",
    "tone",
    "speaking_style",
    "categories",
    "intro",
    "outro",
    "energy_level",
    "facial_expressions",
    "brand_colors",
  ]) {
    assert.match(forward, new RegExp(`ALTER COLUMN ${column} SET NOT NULL`));
  }

  assert.ok(
    position(forward, /UPDATE ai_media_provider_resources\s+SET canonical_key/) <
      position(forward, /ALTER COLUMN canonical_key SET NOT NULL/),
  );
  assert.ok(
    position(forward, /UPDATE ai_media_render_jobs\s+SET available_at/) <
      position(forward, /ALTER COLUMN available_at SET NOT NULL/),
  );
  assert.ok(
    position(forward, /UPDATE ai_media_assets\s+SET/) <
      position(forward, /ALTER COLUMN name SET NOT NULL/),
  );
});

test("foreign keys are preflighted and validated after backfills", () => {
  const preflight = position(forward, /orphaned ai_media_influencers\.default_voice_resource_id/);
  const addConstraint = position(forward, /ADD CONSTRAINT ai_media_influencers_default_voice_resource_fk/);
  const validateConstraint = position(forward, /VALIDATE CONSTRAINT ai_media_influencers_default_voice_resource_fk/);
  assert.ok(position(forward, /UPDATE ai_media_provider_resources/) < preflight);
  assert.ok(preflight < addConstraint);
  assert.ok(addConstraint < validateConstraint);

  for (const constraint of [
    "ai_media_influencers_default_voice_resource_fk",
    "ai_media_influencers_default_avatar_resource_fk",
    "ai_media_assets_influencer_fk",
    "ai_media_assets_provider_resource_fk",
  ]) {
    assert.match(forward, new RegExp(`VALIDATE CONSTRAINT ${constraint}`));
  }
});

test("forward indexes match the PR2 tenant and queue access paths", () => {
  assert.match(
    forward,
    /ai_media_provider_resources_provider_external_uq_pr2[\s\S]*owner_user_id, workspace_id, provider_account_id, resource_type, external_resource_id/,
  );
  assert.match(
    forward,
    /ai_media_provider_resources_owner_workspace_canonical_uq[\s\S]*owner_user_id, workspace_id, resource_type, canonical_key/,
  );
  assert.match(
    forward,
    /ai_media_render_jobs_queue_idx_pr2[\s\S]*status, available_at, lease_expires_at, created_at/,
  );
  assert.match(
    forward,
    /ai_media_assets_storage_object_uq_pr2[\s\S]*owner_user_id, workspace_id, storage_provider, storage_key/,
  );
  assert.match(forward, /ai_media_influencers_default_voice_resource_idx[\s\S]*default_voice_resource_id/);
  assert.match(forward, /ai_media_influencers_default_avatar_resource_idx[\s\S]*default_avatar_resource_id/);
});

test("forward migration covers every incremental asset column", () => {
  for (const definition of [
    "influencer_id uuid",
    "provider_resource_id uuid",
    "name text",
    "status text",
    "thumbnail_url text",
  ]) {
    assert.match(forward, new RegExp(`ADD COLUMN IF NOT EXISTS ${definition}`));
  }
});

test("migration artifacts never remove tables, columns, or rows", () => {
  for (const [name, sql] of [["forward", forward], ["rollback", rollback]] as const) {
    assert.doesNotMatch(sql, /\bDROP\s+TABLE\b/i, `${name} must not drop tables`);
    assert.doesNotMatch(sql, /\bDROP\s+COLUMN\b/i, `${name} must not drop columns`);
    assert.doesNotMatch(sql, /\bTRUNCATE\b/i, `${name} must not truncate data`);
    assert.doesNotMatch(sql, /\bDELETE\s+FROM\b/i, `${name} must not delete rows`);
  }
});

test("rollback guards old uniqueness and restores PR1 index shapes", () => {
  const duplicateGuard = position(rollback, /HAVING count\(\*\) > 1/);
  const firstIndexChange = position(rollback, /CREATE UNIQUE INDEX/);
  assert.ok(duplicateGuard < firstIndexChange);
  assert.match(
    rollback,
    /ai_media_provider_resources_provider_external_uq_pr1[\s\S]*provider_account_id, resource_type, external_resource_id/,
  );
  assert.match(rollback, /ai_media_render_jobs_queue_idx_pr1[\s\S]*status, next_attempt_at, created_at/);
  assert.match(rollback, /ai_media_assets_storage_object_uq_pr1[\s\S]*storage_provider, storage_key/);
  assert.match(rollback, /ALTER COLUMN canonical_key DROP NOT NULL/);
  assert.match(rollback, /COMMIT;\s*$/);
});

test("runbook keeps backup, staging, restart, QA, and approval as hard gates", () => {
  for (const gate of ["backup", "staging", "restart recovery", "App QA", "explicit approval"]) {
    assert.match(runbook, new RegExp(gate, "i"));
  }
  assert.match(runbook, /have\s+not been applied to any database/i);
  assert.match(runbook, /drizzle-kit push/i);
});
