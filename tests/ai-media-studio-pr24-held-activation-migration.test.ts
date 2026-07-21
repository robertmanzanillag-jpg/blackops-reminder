import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { getTableConfig } from "drizzle-orm/pg-core";
import { aiMediaRenderJobs, aiMediaWorkActivations } from "../shared/models/ai-media-studio-db";

const forward = readFileSync(new URL(
  "../migrations/ai-media-studio/20260721_pr24_held_activation_forward.sql", import.meta.url,
), "utf8");
const rollback = readFileSync(new URL(
  "../migrations/ai-media-studio/20260721_pr24_held_activation_rollback.sql", import.meta.url,
), "utf8");

test("PR24 models immutable exact activation evidence without provider or budget authority", () => {
  const columns = Object.keys(aiMediaWorkActivations);
  for (const column of [
    "budgetReservationId", "renderJobId", "dispatchOutboxId", "dailyPlanSlotId", "slotAttempt",
    "providerAccountId", "providerCredentialVersion", "providerIdempotencyKey", "authoritySnapshotId",
    "authorityDigest", "launchIntentId", "launchIntentDigest", "admissionDigest", "workHandoffDigest",
    "sealedRequestDigest", "slotStateVersionBefore", "slotStateVersionAfter", "activationDigest",
  ]) assert.ok(columns.includes(column), `activation missing ${column}`);
  const config = getTableConfig(aiMediaWorkActivations);
  for (const name of [
    "ai_media_work_activations_exact_reservation_fk", "ai_media_work_activations_exact_render_fk",
    "ai_media_work_activations_exact_outbox_fk", "ai_media_work_activations_exact_slot_fk",
  ]) assert.ok(config.foreignKeys.some((entry) => entry.getName() === name), `missing ${name}`);
  assert.ok(getTableConfig(aiMediaRenderJobs).indexes.some(
    (entry) => entry.config.name === "ai_media_render_jobs_activation_identity_uq",
  ));
});

test("PR24 forward migration permits only one inert render transition and a processable wake outbox", () => {
  assert.match(forward, /CREATE TABLE ai_media_work_activations/u);
  assert.match(forward, /launch_intent_id,launch_intent_digest,admission_digest,[\s\S]*sealed_request_digest/u);
  assert.match(forward, /stage IN \('admission_held','queued'\)[\s\S]*attempts=0[\s\S]*lease_owner IS NULL/u);
  assert.doesNotMatch(forward, /stage IN \([^)]*leased/u);
  assert.match(forward, /status IN \('held','pending','leased','retry_wait','dispatched','dead_letter'\)/u);
  assert.match(forward, /queued admitted render remains inert until the budget-aware submission migration/u);
  assert.match(forward, /CREATE CONSTRAINT TRIGGER ai_media_work_activations_final_state_guard[\s\S]*DEFERRABLE INITIALLY DEFERRED/u);
  assert.match(forward, /job\.stage='queued'[\s\S]*job\.attempts=0[\s\S]*outbox\.status IN \('pending'/u);
  assert.match(forward, /work activation evidence is append-only and immutable/u);
  assert.match(forward, /Trusted-writer boundary:[\s\S]*capability-gated application repository/u);
  assert.match(forward, /IF ROW\(NEW\.render_job_id,NEW\.dispatch_outbox_id,NEW\.work_handoff_digest\)[\s\S]*IS DISTINCT FROM ROW\(OLD\.render_job_id/u);
  assert.doesNotMatch(forward, /UPDATE ai_media_budget_buckets[\s\S]*committed_micro_usd/iu);
  assert.doesNotMatch(forward, /provider\.submit|fetch\s*\(|api\.heygen/iu);
});

test("PR24 rollback is allowed only before any activation and restores PR23 held guards", () => {
  assert.match(rollback, /EXISTS \(SELECT 1 FROM ai_media_work_activations LIMIT 1\)/u);
  assert.match(rollback, /stage<>'admission_held'/u);
  assert.match(rollback, /status<>'held'/u);
  assert.match(rollback, /reservation\.state<>'reserved' OR reservation\.submission_state<>'not_started'/u);
  assert.match(rollback, /slot\.id IS NULL OR slot\.status<>'reserved'/u);
  assert.match(rollback, /DROP TABLE ai_media_work_activations/u);
  assert.match(rollback, /CREATE FUNCTION ai_media_reject_held_handoff_mutation/u);
});
