import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { getTableConfig, PgDialect } from "drizzle-orm/pg-core";
import {
  aiMediaProviderSubmissionAttempts,
  aiMediaProviderSubmissionEvents,
  aiMediaRenderJobs,
} from "../shared/models/ai-media-studio-db";

const forward=readFileSync(new URL("../migrations/ai-media-studio/20260721_pr25_admitted_worker_forward.sql",import.meta.url),"utf8");
const rollback=readFileSync(new URL("../migrations/ai-media-studio/20260721_pr25_admitted_worker_rollback.sql",import.meta.url),"utf8");

test("PR25 models exact fenced submission and append-only transition evidence",()=>{
  for(const column of ["budgetReservationId","workActivationId","renderJobId","dispatchOutboxId",
    "providerIdempotencyKey","avatarExternalResourceId","voiceExternalResourceId","authoritySnapshotId",
    "launchIntentId","state","fencingToken","leaseToken","reconciliationLeaseToken",
    "commitEvidenceDigest","sendAuthorizationDigest","ambiguityEvidenceDigest","reconciliationEvidenceDigest"])
    assert.ok(Object.keys(aiMediaProviderSubmissionAttempts).includes(column),`missing ${column}`);
  const config=getTableConfig(aiMediaProviderSubmissionAttempts);
  assert.ok(config.foreignKeys.some(entry=>entry.getName()==="ai_media_provider_submission_attempts_exact_activation_fk"));
  assert.ok(config.foreignKeys.some(entry=>entry.getName()==="ai_media_provider_submission_attempts_exact_reservation_fk"));
  const lifecycle=config.checks.find(entry=>entry.name==="ai_media_provider_submission_attempts_ck");
  assert.ok(lifecycle,"missing attempt lifecycle check");
  const lifecycleSql=new PgDialect().sqlToQuery(lifecycle.value).sql;
  assert.match(lifecycleSql,/length\(btrim\([^)]*provider_key[^)]*\)\) BETWEEN 1 AND 80/u);
  assert.ok(getTableConfig(aiMediaProviderSubmissionEvents).foreignKeys.some(
    entry=>entry.getName()==="ai_media_provider_submission_events_exact_attempt_fk"));
  assert.ok(Object.keys(aiMediaRenderJobs).includes("leaseToken"));
  assert.ok(Object.keys(aiMediaRenderJobs).includes("leaseFencing"));
});

test("PR25 forward closes ambiguous replay and couples all mutable rows with deferred checks",()=>{
  assert.match(forward,/state IN \('claimed','authorized','confirmed','ambiguous','reconciled_no_submit'\)/u);
  assert.match(forward,/OLD\.submission_state='ambiguous'[\s\S]*NEW\.submission_state NOT IN \('ambiguous','confirmed','reconciled_no_submit'\)/u);
  assert.match(forward,/budget commit requires the exact live send authorization/u);
  assert.match(forward,/no-submit release requires exact terminal reconciliation evidence/u);
  assert.match(forward,/provider submission events are append-only/u);
  assert.match(forward,/reconciliation_released/u);
  assert.match(forward,/provider_job_id IS NULL OR length\(btrim\(provider_job_id\)\) BETWEEN 1 AND 500/u);
  assert.match(forward,/provider_request_id IS NULL OR length\(btrim\(provider_request_id\)\) BETWEEN 1 AND 500/u);
  assert.match(forward,/isfinite\(claimed_at\)[\s\S]*isfinite\(created_at\)[\s\S]*isfinite\(updated_at\)/u);
  assert.match(forward,/isfinite\(observed_at\) AND isfinite\(created_at\)/u);
  assert.match(forward,/CREATE CONSTRAINT TRIGGER ai_media_pr25_(attempt|reservation)_consistency_guard/u);
  for(const table of ["ai_media_budget_reservations","ai_media_render_jobs","ai_media_outbox","ai_media_daily_plan_slots","ai_media_budget_buckets"])
    assert.match(forward,new RegExp(`ON ${table} DEFERRABLE INITIALLY DEFERRED`,"u"));
  assert.match(forward,/avatar_external_resource_id/u);
  assert.match(forward,/voice_external_resource_id/u);
  assert.match(forward,/\(source_item_id IS NULL AND source_content_hash IS NULL\)[\s\S]*source_content_hash ~ '\^sha256:/u);
  assert.match(forward,/length\(btrim\(provider_key\)\) BETWEEN 1 AND 80/u);
  assert.match(forward,/isfinite\(available_at\)[\s\S]*isfinite\(queued_at\)[\s\S]*isfinite\(created_at\)[\s\S]*isfinite\(updated_at\)/u);
  assert.match(forward,/stage='leased'[\s\S]*attempts IN \(0,1\)/u);
  assert.match(forward,/ai_media_outbox_held_ck CHECK \([\s\S]*isfinite\(available_at\)[\s\S]*isfinite\(created_at\)[\s\S]*isfinite\(updated_at\)/u);
  assert.match(forward,/Trusted-writer boundary:[\s\S]*REVOKE direct DML/u);
  assert.doesNotMatch(forward,/api\.heygen|provider\.submit|fetch\s*\(/iu);
});

test("PR25 rollback preserves evidence and restores the literal PR24 inert boundary",()=>{
  assert.match(rollback,/EXISTS \(SELECT 1 FROM ai_media_provider_submission_attempts LIMIT 1\)/u);
  assert.match(rollback,/EXISTS \(SELECT 1 FROM ai_media_provider_submission_events LIMIT 1\)/u);
  assert.match(rollback,/activation\.id IS NULL[\s\S]*job\.stage<>'admission_held'/u);
  assert.match(rollback,/activation\.id IS NOT NULL[\s\S]*job\.stage<>'queued'/u);
  assert.match(rollback,/queued admitted render remains inert until the budget-aware submission migration/u);
  assert.match(rollback,/admitted render identity and sealed request are immutable/u);
  assert.match(rollback,/budget reservation immutable admission evidence cannot change/u);
  assert.match(rollback,/length\(btrim\(provider_key\)\) BETWEEN 1 AND 80/u);
  assert.match(rollback,/isfinite\(available_at\)[\s\S]*isfinite\(queued_at\)[\s\S]*isfinite\(created_at\)[\s\S]*isfinite\(updated_at\)/u);
  assert.match(rollback,/ai_media_outbox_held_ck CHECK \([\s\S]*isfinite\(available_at\)[\s\S]*isfinite\(created_at\)[\s\S]*isfinite\(updated_at\)/u);
  assert.match(rollback,/DROP TABLE ai_media_provider_submission_events/u);
});
