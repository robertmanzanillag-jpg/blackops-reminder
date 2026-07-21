import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const forward = readFileSync(new URL(
  "../migrations/ai-media-studio/20260721_pr22_launch_intents_forward.sql",
  import.meta.url,
), "utf8");
const rollback = readFileSync(new URL(
  "../migrations/ai-media-studio/20260721_pr22_launch_intents_rollback.sql",
  import.meta.url,
), "utf8");

test("PR22 is transactional, additive, unapplied, and refuses fabricated authority", () => {
  assert.match(forward, /^--[\s\S]*BEGIN;/u);
  assert.match(forward, /Do not apply automatically/u);
  assert.match(forward, /SET LOCAL search_path = public, pg_catalog/u);
  assert.match(forward, /LOCK TABLE ai_media_launch_evidence, ai_media_launch_authority_snapshots,[\s\S]*ai_media_budget_reservations IN ACCESS EXCLUSIVE MODE/u);
  assert.match(forward, /evidence, snapshots, and reservations must be empty/u);
  assert.doesNotMatch(forward, /\bUPDATE\s+ai_media_launch_(?:evidence|authority_snapshots)\b/iu);
  assert.match(forward, /COMMIT;\s*$/u);
});

test("one immutable canonical launch intent binds every exact launch input", () => {
  assert.match(forward, /CREATE TABLE ai_media_launch_intents/u);
  for (const column of [
    "daily_plan_id", "daily_plan_slot_id", "slot_attempt", "provider_account_id", "provider_key",
    "provider_credential_version", "plan_digest", "slot_digest", "source_roster_key",
    "source_roster_digest", "source_member_key", "script_id", "script_variant_id",
    "script_variant_checksum", "source_type", "source_item_id", "source_content_hash",
    "governance_profile_id", "governance_evidence_digest", "governance_use",
    "governance_territory", "content_country", "launch_subject_digest", "launch_intent_digest",
    "actor_user_id", "input_digest", "idempotency_key", "created_at",
  ]) assert.match(forward, new RegExp(`\\b${column}\\b`, "u"));
  assert.match(forward, /ai_media_launch_intents_slot_attempt_uq[\s\S]*owner_user_id,workspace_id,daily_plan_slot_id,slot_attempt/u);
  assert.match(forward, /ai_media_launch_intents_idempotency_uq/u);
  assert.match(forward, /BEFORE UPDATE OR DELETE ON ai_media_launch_intents/u);
  assert.match(forward, /issue a new slot attempt/u);
});

test("manual and source-backed intents fail closed with exact source content identity", () => {
  assert.match(forward, /source_type='manual' AND source_item_id IS NULL AND source_content_hash IS NULL/u);
  assert.match(forward, /source_type<>'manual' AND source_item_id IS NOT NULL[\s\S]*source_content_hash ~ '\^sha256:\[0-9a-f\]\{64\}\$'/u);
  assert.match(forward, /ai_media_launch_intents_source_item_fk/u);
  assert.match(forward, /REFERENCES ai_media_source_items\(owner_user_id,workspace_id,id,source_type\)/u);
  assert.doesNotMatch(forward, /REFERENCES ai_media_source_items\([^)]*content_hash/u);
  assert.match(forward, /ai_media_launch_intents_script_variant_fk/u);
  assert.match(forward, /REFERENCES ai_media_script_variants\(owner_user_id,workspace_id,id,script_id,checksum\)/u);
});

test("runtime attestations leave kind-specific immutable audit evidence", () => {
  assert.match(forward, /ADD COLUMN source_attestation_id text/u);
  assert.match(forward, /ADD COLUMN source_evidence_digest text/u);
  assert.match(forward, /ai_media_launch_evidence_source_attestation_ck/u);
  assert.match(forward, /evidence_kind IN \('sandbox_proof','maximum_quote'\)[\s\S]*source_attestation_id ~ '\^\[A-Za-z0-9\]\[A-Za-z0-9\._:\/-\]\{7,199\}\$'[\s\S]*source_evidence_digest ~ '\^sha256:\[0-9a-f\]\{64\}\$'/u);
  assert.match(forward, /evidence_kind IN \('content_approval','human_launch_approval'\)[\s\S]*source_attestation_id IS NULL AND source_evidence_digest IS NULL/u);
});

test("evidence and snapshots require the same exact intent and digest", () => {
  assert.match(forward, /ALTER TABLE ai_media_launch_evidence[\s\S]*ADD COLUMN launch_intent_id uuid NOT NULL,[\s\S]*ADD COLUMN launch_intent_digest text NOT NULL/u);
  assert.match(forward, /ALTER TABLE ai_media_launch_authority_snapshots[\s\S]*ADD COLUMN launch_intent_id uuid NOT NULL,[\s\S]*ADD COLUMN launch_intent_digest text NOT NULL/u);
  assert.match(forward, /ai_media_launch_evidence_launch_intent_fk/u);
  assert.match(forward, /ai_media_launch_authority_snapshots_launch_intent_fk/u);
  for (const kind of ["content", "human", "sandbox", "quote"]) {
    const constraint = `ai_media_launch_authority_snapshots_${kind}_evidence_fk`;
    const start = forward.indexOf(`ADD CONSTRAINT ${constraint}`);
    assert.notEqual(start, -1);
    const fragment = forward.slice(start, forward.indexOf(";", start));
    assert.match(fragment, /launch_intent_id,launch_intent_digest/u);
  }
});

test("rollback remains application-only and preserves intents and authority evidence", () => {
  const executable = rollback.replace(/--.*$/gmu, "");
  assert.match(rollback, /application-only/u);
  assert.match(rollback, /Do not drop/u);
  assert.doesNotMatch(executable, /\b(?:DELETE|TRUNCATE|DROP)\b/iu);
});
