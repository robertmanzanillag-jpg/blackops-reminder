import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const directory = "migrations/ai-media-studio";
const read = (name: string) => readFileSync(resolve(process.cwd(), directory, name), "utf8");
const forward = read("20260720_pr3_operations_forward.sql");
const rollback = read("20260720_pr3_operations_rollback.sql");
const runbook = read("README.md");

test("PR3 migration is bounded, transactional, and preflights its dependencies", () => {
  assert.match(forward, /^--[\s\S]*\nBEGIN;/);
  assert.match(forward, /SET LOCAL lock_timeout = '5s'/);
  assert.match(forward, /SET LOCAL statement_timeout = '15min'/);
  assert.match(forward, /to_regclass\('public\.' \|\| required_table\)/);
  assert.match(forward, /COMMIT;\s*$/);
  assert.equal((forward.match(/\bBEGIN;/g) ?? []).length, 1);
  assert.equal((forward.match(/\bCOMMIT;/g) ?? []).length, 1);
});

test("publishing jobs gain asset, immutable approval, and recoverable queue state", () => {
  for (const column of [
    "media_asset_id uuid", "mode text", "preview_digest text", "approval_evidence jsonb", "due_at timestamptz",
    "available_at timestamptz", "lease_owner text", "lease_expires_at timestamptz", "fencing_token integer",
    "failure_code text", "dead_letter_at timestamptz", "reconcile_after timestamptz", "reconciliation_status text",
  ]) assert.match(forward, new RegExp(`ADD COLUMN IF NOT EXISTS ${column}`));
  assert.match(forward, /orphaned ai_media_publishing_jobs\.media_asset_id/);
  assert.match(forward, /VALIDATE CONSTRAINT ai_media_publishing_jobs_media_asset_fk/);
  assert.match(forward, /ADD COLUMN IF NOT EXISTS media_asset_id uuid/);
  assert.match(forward, /VALIDATE CONSTRAINT ai_media_publications_media_asset_fk/);
  assert.match(forward, /ai_media_publications_platform_external_uq_pr3[\s\S]*owner_user_id, workspace_id, platform, external_publication_id/);
  assert.match(forward, /ai_media_publishing_jobs_media_reference_ck[\s\S]*video_id IS NOT NULL OR media_asset_id IS NOT NULL/);
  assert.match(forward, /ai_media_publications_media_reference_ck[\s\S]*video_id IS NOT NULL OR media_asset_id IS NOT NULL/);
  assert.match(forward, /ai_media_publications ALTER COLUMN video_id DROP NOT NULL/);
  assert.match(forward, /ai_media_publishing_jobs_dispatch_idx_pr3[\s\S]*available_at, due_at, lease_expires_at/);
});

test("analytics uniqueness is tenant-safe and has reporting access paths", () => {
  assert.match(forward, /ai_media_analytics_snapshots_publication_captured_uq_pr3[\s\S]*owner_user_id, workspace_id, publication_id, captured_at/);
  assert.match(forward, /ai_media_analytics_events_source_external_uq_pr3[\s\S]*owner_user_id, workspace_id, source, external_event_id/);
  assert.match(forward, /ai_media_analytics_snapshots_owner_workspace_platform_captured_idx/);
  assert.match(forward, /ai_media_analytics_snapshots_publication_period_idx/);
});

test("source and orchestration evidence is durable and tenant-indexed", () => {
  for (const fragment of ["content_hash text", "moderation_status text", "moderation_evidence jsonb", "automation_evidence jsonb"]) {
    assert.match(forward, new RegExp(`ADD COLUMN IF NOT EXISTS ${fragment}`));
  }
  assert.match(forward, /CREATE TABLE IF NOT EXISTS ai_media_orchestration_runs/);
  assert.match(forward, /state_version integer NOT NULL DEFAULT 0/);
  assert.match(forward, /run_payload jsonb NOT NULL DEFAULT '\{\}'::jsonb/);
  assert.match(forward, /ADD COLUMN IF NOT EXISTS state_version integer/);
  assert.match(forward, /ADD COLUMN IF NOT EXISTS run_payload jsonb/);
  assert.ok(
    forward.indexOf("SET state_version = COALESCE(state_version, 0)") <
      forward.indexOf("ALTER COLUMN state_version SET NOT NULL"),
  );
  assert.match(forward, /ai_media_orchestration_runs_owner_workspace_idempotency_uq[\s\S]*owner_user_id, workspace_id, idempotency_key/);
  assert.match(forward, /orchestration_source_preflight[\s\S]*GROUP BY owner_user_id, workspace_id, source_item_id[\s\S]*HAVING count\(\*\) > 1/);
  assert.ok(
    forward.indexOf("$orchestration_source_preflight$;") <
      forward.indexOf("CREATE UNIQUE INDEX IF NOT EXISTS ai_media_orchestration_runs_owner_workspace_source_uq"),
  );
  assert.match(forward, /ai_media_orchestration_runs_owner_workspace_source_uq[\s\S]*owner_user_id, workspace_id, source_item_id\)[\s\S]*WHERE source_item_id IS NOT NULL/);
  assert.match(forward, /ai_media_orchestration_runs_queue_idx[\s\S]*status, available_at, due_at, lease_expires_at/);
  assert.match(rollback, /ai_media_orchestration_runs_owner_workspace_source_idx[\s\S]*owner_user_id, workspace_id, source_item_id, created_at/);
  assert.ok(
    rollback.indexOf("CREATE INDEX IF NOT EXISTS ai_media_orchestration_runs_owner_workspace_source_idx") <
      rollback.indexOf("DROP INDEX IF EXISTS ai_media_orchestration_runs_owner_workspace_source_uq"),
  );
});

test("outbox workers have durable tenant-scoped leases, fencing, and dead letters", () => {
  for (const column of [
    "lease_owner text",
    "lease_expires_at timestamptz",
    "fencing_token integer",
    "dead_letter_at timestamptz",
  ]) assert.match(forward, new RegExp(`ADD COLUMN IF NOT EXISTS ${column}`));
  assert.ok(
    forward.indexOf("SET fencing_token = COALESCE(fencing_token, 0)") <
      forward.lastIndexOf("ALTER COLUMN fencing_token SET NOT NULL"),
  );
  assert.match(forward, /ai_media_outbox_dispatch_idx_pr3[\s\S]*status, available_at, lease_expires_at, created_at/);
  assert.match(forward, /ai_media_outbox_owner_workspace_lease_idx[\s\S]*owner_user_id, workspace_id, lease_owner, lease_expires_at/);
  assert.match(forward, /ai_media_outbox_dead_letter_idx[\s\S]*dead_letter_at/);
  assert.match(rollback, /ai_media_outbox_dispatch_idx_pr2[\s\S]*status, available_at, created_at/);
  assert.match(rollback, /outbox lease\/fencing\/dead-letter fields/i);
});

test("forward and rollback preserve all tables, columns, and rows", () => {
  for (const [name, sql] of [["forward", forward], ["rollback", rollback]] as const) {
    assert.doesNotMatch(sql, /\bDROP\s+TABLE\b/i, `${name} must retain tables`);
    assert.doesNotMatch(sql, /\bDROP\s+COLUMN\b/i, `${name} must retain columns`);
    assert.doesNotMatch(sql, /\bTRUNCATE\b/i, `${name} must retain rows`);
    assert.doesNotMatch(sql, /\bDELETE\s+FROM\b/i, `${name} must retain rows`);
  }
  assert.match(rollback, /HAVING count\(\*\) > 1/);
  assert.match(rollback, /state_version, run_payload,[\s\S]*other columns, evidence, and rows remain available/i);
  assert.match(rollback, /COMMIT;\s*$/);
});

test("runbook keeps deployment approval and policy gates explicit", () => {
  for (const gate of ["backup", "staging", "restart recovery", "App QA", "explicit approval", "automatic publishing remains disabled"]) {
    assert.match(runbook, new RegExp(gate, "i"));
  }
  assert.match(runbook, /have\s+not been applied to any database/i);
  assert.match(runbook, /drizzle-kit push/i);
});
