import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const forward = readFileSync(new URL(
  "../migrations/ai-media-studio/pending/20260723_pr33_exact_one_video_submit_forward.sql",
  import.meta.url,
), "utf8");
const rollback = readFileSync(new URL(
  "../migrations/ai-media-studio/pending/20260723_pr33_exact_one_video_submit_rollback.sql",
  import.meta.url,
), "utf8");

const claim = forward.slice(
  forward.indexOf("CREATE FUNCTION ai_media_worker_api.claim_exact_one_video_submit_v1"),
  forward.indexOf("CREATE FUNCTION ai_media_worker_api.authorize_exact_one_video_submit_v1"),
);

test("PR33 exposes only exact submit calls with stable full-run identity", () => {
  assert.match(forward, /Review artifact only\. Do not apply automatically/u);
  for (const functionName of [
    "claim_exact_one_video_submit_v1",
    "authorize_exact_one_video_submit_v1",
    "record_exact_one_video_submit_confirmed_v1",
    "record_exact_one_video_submit_ambiguous_v1",
  ]) {
    assert.match(forward, new RegExp(`CREATE FUNCTION ai_media_worker_api\\.${functionName}`));
    assert.match(
      forward,
      new RegExp(`GRANT EXECUTE ON FUNCTION ai_media_worker_api\\.${functionName}[\\s\\S]*?TO ai_media_one_video_run_executor`),
    );
  }
  assert.match(forward, /execution_id uuid,run_lease_token uuid,run_fencing_token bigint,command_digest text,actor_user_id text/u);
  assert.match(forward, /daily_plan_slot_id uuid,slot_attempt integer,work_handoff_digest text/u);
  assert.match(forward, /record_exact_one_video_submit_confirmed_v1[\s\S]*work_handoff_digest text,applied boolean/u);
  assert.match(forward, /record_exact_one_video_submit_ambiguous_v1[\s\S]*work_handoff_digest text,applied boolean/u);
  assert.doesNotMatch(forward, /GRANT EXECUTE[\s\S]*TO (?:PUBLIC|ai_media_admitted_submit_executor)/u);
});

test("PR33 validates the live PR32 execution and PR26 table-blind capability before mutation", () => {
  assert.match(forward, /exact_capability\.database_principal=SESSION_USER/u);
  assert.match(forward, /fence\.id=p_execution_id/u);
  assert.match(forward, /fence\.action='activate_and_submit'/u);
  assert.match(forward, /fence\.state='running'/u);
  assert.match(forward, /fence\.fencing_token=p_run_fencing_token/u);
  assert.match(forward, /fence\.lease_token=p_run_lease_token/u);
  assert.match(forward, /fence\.lease_expires_at>sampled_at/u);
  assert.match(forward, /fence\.actor_user_id=p_actor_user_id/u);
  assert.match(forward, /fence\.budget_reservation_id=p_budget_reservation_id/u);
  assert.match(forward, /fence\.render_job_id=p_render_job_id/u);
  assert.match(forward, /fence\.daily_plan_slot_id=p_daily_plan_slot_id/u);
  assert.match(forward, /fence\.slot_attempt=p_slot_attempt/u);
  assert.match(forward, /fence\.work_handoff_digest=p_work_handoff_digest/u);
  assert.match(forward, /fence\.command_digest=p_command_digest/u);
  assert.match(forward, /matching_capabilities<>1/u);
  assert.match(forward, /require_capability_v1\(/u);
  assert.match(
    forward,
    /has_table_privilege\(SESSION_USER,'public\.ai_media_exact_one_video_run_capabilities',[\s\S]*?'SELECT,INSERT,UPDATE,DELETE'\)/u,
  );
  assert.match(
    forward,
    /has_table_privilege\(SESSION_USER,'public\.ai_media_exact_one_video_run_fences',[\s\S]*?'SELECT,INSERT,UPDATE,DELETE'\)/u,
  );
  assert.match(forward, /exact one-video submit executor must remain table-blind/u);
});

test("PR33 claim is exact-target only and preserves PR26 fencing transitions", () => {
  assert.match(claim, /reservation\.id=p_budget_reservation_id/u);
  assert.match(claim, /job\.id=p_render_job_id/u);
  assert.match(claim, /slot\.id=p_daily_plan_slot_id/u);
  assert.match(claim, /reservation\.attempt=p_slot_attempt/u);
  assert.match(claim, /reservation\.work_handoff_digest=p_work_handoff_digest/u);
  assert.match(claim, /ON CONFLICT\(owner_user_id,workspace_id,budget_reservation_id\) DO UPDATE SET/u);
  assert.match(claim, /fencing_token=ai_media_provider_submission_attempts\.fencing_token\+1/u);
  assert.match(claim, /claim_count=ai_media_provider_submission_attempts\.claim_count\+1/u);
  assert.match(claim, /lease_expires_at<=sampled_at/u);
  assert.match(claim, /event_kind,fencing_token,evidence_digest/u);
  assert.doesNotMatch(claim, /\bORDER BY\b|\bLIMIT\s+1\b|\bSKIP LOCKED\b/u);
  assert.doesNotMatch(claim, /claim_admitted_v1\s*\(/u);
});

test("PR33 delegates authorization/outcomes to PR26 atomics without unsafe I/O and guards rollback", () => {
  assert.match(forward, /FROM ai_media_worker_api\.authorize_admitted_v1\(/u);
  assert.match(forward, /FROM ai_media_worker_api\.record_submit_confirmed_v1\(/u);
  assert.match(forward, /FROM ai_media_worker_api\.record_submit_ambiguous_v1\(/u);
  assert.match(forward, /attempt\.render_job_id=p_render_job_id/u);
  assert.match(forward, /attempt\.daily_plan_slot_id=p_daily_plan_slot_id/u);
  assert.match(forward, /attempt\.slot_attempt=p_slot_attempt/u);
  assert.match(forward, /attempt\.work_handoff_digest=p_work_handoff_digest/u);
  assert.equal((forward.match(/DECLARE context record; sampled_at timestamptz:=pg_catalog\.clock_timestamp\(\);/gu) ?? []).length, 2);
  assert.equal((forward.match(/attempt\.lease_expires_at>sampled_at/gu) ?? []).length, 2);
  assert.doesNotMatch(forward, /\b(?:dblink|http_get|http_post|curl|wget|COPY\s+PROGRAM|lo_import)\b|\bnet\.http_/iu);
  assert.doesNotMatch(forward, /\b(?:publish|provider\.submit|fetch\s*\()\b/iu);
  assert.match(rollback, /rollback preserves exact one-video submit claim, authorization, and outcome evidence/u);
  assert.match(rollback, /JOIN public\.ai_media_provider_submission_attempts/u);
  assert.match(rollback, /fence\.action='activate_and_submit'/u);
  assert.match(rollback, /attempt\.state IN \('claimed','authorized','confirmed','ambiguous','reconciled_no_submit'\)/u);
  assert.match(rollback, /attempt\.render_job_id=fence\.render_job_id/u);
  assert.match(rollback, /attempt\.daily_plan_slot_id=fence\.daily_plan_slot_id/u);
  assert.match(rollback, /attempt\.slot_attempt=fence\.slot_attempt/u);
  assert.match(rollback, /attempt\.work_handoff_digest=fence\.work_handoff_digest/u);
  assert.doesNotMatch(rollback, /attempt\.actor_user_id=fence\.actor_user_id/u);
});
