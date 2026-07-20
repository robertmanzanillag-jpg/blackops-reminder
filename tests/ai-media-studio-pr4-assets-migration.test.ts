import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const directory = "migrations/ai-media-studio";
const read = (name: string) => readFileSync(resolve(process.cwd(), directory, name), "utf8");
const forward = read("20260720_pr4_assets_forward.sql");
const rollback = read("20260720_pr4_assets_rollback.sql");

test("PR4 asset migration is bounded, transactional, and dependency-preflighted", () => {
  assert.match(forward, /^--[\s\S]*\nBEGIN;/);
  assert.match(forward, /SET LOCAL lock_timeout = '5s'/);
  assert.match(forward, /SET LOCAL statement_timeout = '15min'/);
  assert.match(forward, /to_regclass\('public\.' \|\| required_table\)/);
  assert.match(forward, /COMMIT;\s*$/);
  assert.equal((forward.match(/\bBEGIN;/g) ?? []).length, 1);
  assert.equal((forward.match(/\bCOMMIT;/g) ?? []).length, 1);
});

test("render jobs gain a validated owned-output asset reference", () => {
  assert.match(forward, /ADD COLUMN IF NOT EXISTS output_media_asset_id uuid/);
  assert.match(forward, /orphaned ai_media_render_jobs\.output_media_asset_id/);
  assert.match(forward, /ai_media_render_jobs_output_media_asset_fk[\s\S]*REFERENCES ai_media_assets\(id\) ON DELETE SET NULL NOT VALID/);
  assert.match(forward, /VALIDATE CONSTRAINT ai_media_render_jobs_output_media_asset_fk/);
  assert.match(forward, /ai_media_render_jobs_output_media_asset_idx[\s\S]*output_media_asset_id/);
});

test("asset ingest jobs retain private provider input and recoverable queue state", () => {
  assert.match(forward, /CREATE TABLE IF NOT EXISTS ai_media_asset_ingest_jobs/);
  for (const field of [
    "owner_user_id text NOT NULL", "workspace_id text NOT NULL", "render_job_id uuid NOT NULL",
    "provider_key text NOT NULL", "remote_artifact_ref text", "remote_url text", "expected_mime_type text NOT NULL", "state text NOT NULL",
    "attempts integer NOT NULL", "max_attempts integer NOT NULL", "available_at timestamptz NOT NULL",
    "lease_recoveries integer NOT NULL", "max_lease_recoveries integer NOT NULL",
    "lease_owner text", "lease_token text", "lease_expires_at timestamptz", "fencing_token integer NOT NULL",
    "media_asset_id uuid", "owned_object_key text", "sha256 text", "size_bytes bigint",
    "error_code text", "error_message text", "completed_at timestamptz", "dead_letter_at timestamptz",
  ]) assert.match(forward, new RegExp(field));
  assert.match(forward, /remote_artifact_ref IS NOT NULL OR remote_url IS NOT NULL/);
  assert.match(forward, /state IN \('queued', 'leased', 'retry_wait', 'completed', 'dead_letter'\)/);
  assert.match(forward, /attempts >= 0 AND max_attempts > 0[\s\S]*lease_recoveries >= 0 AND max_lease_recoveries > 0/);
  assert.match(forward, /ai_media_asset_ingest_jobs_queue_idx[\s\S]*state, available_at, lease_expires_at, created_at/);
  assert.match(forward, /ai_media_asset_ingest_jobs_owner_workspace_lease_idx[\s\S]*owner_user_id, workspace_id, lease_owner, lease_expires_at/);
  assert.match(forward, /ai_media_asset_ingest_jobs_completed_unlinked_idx[\s\S]*state, media_asset_id, completed_at, created_at/);
});

test("database uniqueness makes render enqueue and active asset dedupe race-safe", () => {
  assert.match(forward, /ingest_duplicate_preflight[\s\S]*owner_user_id, workspace_id, render_job_id[\s\S]*HAVING count\(\*\) > 1/);
  assert.match(forward, /ai_media_asset_ingest_jobs_owner_workspace_render_uq[\s\S]*owner_user_id, workspace_id, render_job_id/);
  assert.match(forward, /owner_user_id, workspace_id, kind, checksum[\s\S]*HAVING count\(\*\) > 1/);
  assert.match(forward, /ai_media_assets_owner_workspace_kind_checksum_active_uq[\s\S]*owner_user_id, workspace_id, kind, checksum\)[\s\S]*WHERE deleted_at IS NULL AND checksum IS NOT NULL/);
});

test("rollback retains every additive table, column, private reference, and row", () => {
  for (const [name, migration] of [["forward", forward], ["rollback", rollback]] as const) {
    assert.doesNotMatch(migration, /\bDROP\s+TABLE\b/i, `${name} must retain tables`);
    assert.doesNotMatch(migration, /\bDROP\s+COLUMN\b/i, `${name} must retain columns`);
    assert.doesNotMatch(migration, /\bTRUNCATE\b/i, `${name} must retain rows`);
    assert.doesNotMatch(migration, /\bDELETE\s+FROM\b/i, `${name} must retain rows`);
  }
  assert.ok(
    rollback.indexOf("CREATE INDEX IF NOT EXISTS ai_media_assets_owner_workspace_kind_checksum_idx") <
      rollback.indexOf("DROP INDEX IF EXISTS ai_media_assets_owner_workspace_kind_checksum_active_uq"),
  );
  assert.match(rollback, /private artifact references[\s\S]*all rows remain for recovery/i);
  assert.match(rollback, /COMMIT;\s*$/);
});
