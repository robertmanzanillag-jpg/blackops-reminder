import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { getTableConfig } from "drizzle-orm/pg-core";
import {
  aiMediaBudgetReservations,
  aiMediaOutbox,
  aiMediaRenderJobs,
  aiMediaWebhookEvents,
} from "../shared/models/ai-media-studio-db";

const forward = readFileSync(new URL(
  "../migrations/ai-media-studio/20260721_pr23_admission_held_handoff_forward.sql",
  import.meta.url,
), "utf8");
const rollback = readFileSync(new URL(
  "../migrations/ai-media-studio/20260721_pr23_admission_held_handoff_rollback.sql",
  import.meta.url,
), "utf8");
const architecture = readFileSync(new URL("../docs/ai-media-studio/architecture.md", import.meta.url), "utf8");

test("PR23 schema exposes the durable held handoff only on reservation, job, and outbox", () => {
  const reservationColumns = Object.keys(aiMediaBudgetReservations);
  assert.ok(reservationColumns.includes("workHandoffDigest"));
  for (const column of [
    "budgetReservationId", "dailyPlanSlotId", "slotAttempt", "influencerId", "avatarResourceId",
    "voiceResourceId", "scriptId", "scriptVariantId", "scriptVariantChecksum", "sourceItemId",
    "sourceContentHash", "authoritySnapshotId", "authorityDigest", "launchIntentId",
    "launchIntentDigest", "admissionDigest", "workHandoffDigest", "sealedRequestDigest",
    "providerCredentialVersion",
  ]) assert.ok(Object.keys(aiMediaRenderJobs).includes(column), `render job missing ${column}`);
  for (const column of ["budgetReservationId", "renderJobId", "workHandoffDigest", "sealedRequestDigest"]) {
    assert.ok(Object.keys(aiMediaOutbox).includes(column), `outbox missing ${column}`);
  }
  for (const column of ["budgetReservationId", "workHandoffDigest", "sealedRequestDigest"]) {
    assert.ok(!Object.keys(aiMediaWebhookEvents).includes(column), `webhook must not expose ${column}`);
  }

  const reservation = getTableConfig(aiMediaBudgetReservations);
  const jobs = getTableConfig(aiMediaRenderJobs);
  const outbox = getTableConfig(aiMediaOutbox);
  assert.ok(reservation.checks.some((entry) => entry.name === "ai_media_budget_reservations_work_handoff_ck"));
  assert.ok(jobs.checks.some((entry) => entry.name === "ai_media_render_jobs_admission_held_ck"));
  assert.ok(outbox.checks.some((entry) => entry.name === "ai_media_outbox_held_ck"));
  assert.ok(reservation.foreignKeys.some((entry) => entry.getName() === "ai_media_budget_reservations_exact_render_job_fk"));
  assert.ok(reservation.foreignKeys.some((entry) => entry.getName() === "ai_media_budget_reservations_exact_dispatch_outbox_fk"));
  assert.ok(outbox.foreignKeys.some((entry) => entry.getName() === "ai_media_outbox_exact_render_job_fk"));
});

test("PR23 forward migration freezes exact admission bindings without infinity timestamps", () => {
  for (const column of [
    "budget_reservation_id", "daily_plan_slot_id", "slot_attempt", "influencer_id",
    "avatar_resource_id", "voice_resource_id", "script_id", "script_variant_id",
    "script_variant_checksum", "source_item_id", "source_content_hash", "authority_snapshot_id",
    "authority_digest", "launch_intent_id", "launch_intent_digest", "admission_digest",
    "work_handoff_digest", "sealed_request_digest", "provider_credential_version",
  ]) assert.match(forward, new RegExp(`ADD COLUMN ${column}\\b`, "u"), `missing ${column}`);

  assert.match(forward, /render_job_id IS NULL AND dispatch_outbox_id IS NULL AND work_handoff_digest IS NULL[\s\S]*OR \(render_job_id IS NOT NULL AND dispatch_outbox_id IS NOT NULL/u);
  assert.match(forward, /stage<>'admission_held'[\s\S]*budget_reservation_id IS NULL[\s\S]*OR \(stage='admission_held'[\s\S]*status='pending'/u);
  assert.match(forward, /status<>'held'[\s\S]*sealed_request_digest IS NULL[\s\S]*OR \(status='held'[\s\S]*attempts=0[\s\S]*fencing_token=0/u);
  assert.match(forward, /status='pending'[\s\S]*provider_job_id IS NULL[\s\S]*attempts=0/u);
  assert.match(forward, /isfinite\(available_at\)[\s\S]*isfinite\(created_at\)/u);
  assert.doesNotMatch(forward, /'infinity'|'-infinity'/u);
  assert.match(forward, /ai_media_budget_reservations_exact_render_job_fk[\s\S]*DEFERRABLE INITIALLY DEFERRED/u);
  assert.match(forward, /ai_media_budget_reservations_exact_dispatch_outbox_fk[\s\S]*DEFERRABLE INITIALLY DEFERRED/u);
  assert.match(forward, /ai_media_outbox_exact_render_job_fk[\s\S]*DEFERRABLE INITIALLY DEFERRED/u);
  assert.match(forward, /DROP CONSTRAINT ai_media_budget_reservations_render_job_fk,[\s\S]*DROP CONSTRAINT ai_media_budget_reservations_dispatch_outbox_fk/u);
  assert.match(forward, /BEFORE UPDATE OR DELETE ON ai_media_render_jobs/u);
  assert.match(forward, /BEFORE UPDATE OR DELETE ON ai_media_outbox/u);
  assert.match(forward, /OLD\.stage='admission_held'[\s\S]*OLD\.status='held'/u);
  assert.match(architecture, /forward SQL is the authoritative database definition[\s\S]*db:push` must not be used/u);
});

test("PR23 rollback is guarded, paired, and removes every introduced column", () => {
  assert.match(rollback, /stage='admission_held'/u);
  assert.match(rollback, /status='held'/u);
  assert.match(rollback, /work_handoff_digest IS NOT NULL/u);
  assert.match(rollback, /DROP FUNCTION ai_media_reject_held_handoff_mutation/u);
  assert.match(rollback, /ADD CONSTRAINT ai_media_budget_reservations_render_job_fk[\s\S]*DEFERRABLE INITIALLY DEFERRED/u);
  for (const column of [
    "budget_reservation_id", "daily_plan_slot_id", "slot_attempt", "influencer_id",
    "avatar_resource_id", "voice_resource_id", "script_id", "script_variant_id",
    "script_variant_checksum", "source_item_id", "source_content_hash", "authority_snapshot_id",
    "authority_digest", "launch_intent_id", "launch_intent_digest", "admission_digest",
    "work_handoff_digest", "sealed_request_digest", "provider_credential_version",
  ]) assert.match(rollback, new RegExp(`DROP COLUMN ${column}\\b`, "u"), `rollback missing ${column}`);
});
