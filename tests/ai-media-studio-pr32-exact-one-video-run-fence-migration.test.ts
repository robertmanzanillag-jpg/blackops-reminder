import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const forward = readFileSync(new URL(
  "../migrations/ai-media-studio/pending/20260723_pr32_exact_one_video_run_fence_forward.sql",
  import.meta.url,
), "utf8");
const rollback = readFileSync(new URL(
  "../migrations/ai-media-studio/pending/20260723_pr32_exact_one_video_run_fence_rollback.sql",
  import.meta.url,
), "utf8");

test("PR32 remains pending, table-blind and exact-target/capability fenced", () => {
  assert.match(forward, /Review artifact only\. Do not apply automatically/u);
  assert.match(forward, /ai_media_one_video_run_executor/u);
  assert.match(forward, /rolcanlogin OR role_row\.rolsuper OR role_row\.rolinherit/u);
  assert.match(forward, /database_principal=SESSION_USER/u);
  assert.match(forward, /has_table_privilege\(SESSION_USER/u);
  assert.match(forward, /budget_reservation_id=p_budget_reservation_id/u);
  assert.match(forward, /render_job_id=p_render_job_id/u);
  assert.match(forward, /daily_plan_slot_id=p_daily_plan_slot_id/u);
  assert.match(forward, /slot_attempt=p_slot_attempt/u);
  assert.match(forward, /work_handoff_digest=p_work_handoff_digest/u);
  assert.match(forward, /command_digest=p_command_digest/u);
  assert.match(forward, /actor_user_id=p_actor_user_id/u);
  assert.match(forward, /pg_advisory_xact_lock/u);
  assert.match(forward, /exact-one-video-command-id/u);
  assert.match(forward, /exact-one-video-command-digest/u);
  assert.match(forward, /ai_media_exact_one_video_run_fences_running_target_uq/u);
  assert.match(forward, /WHERE state='running'/u);
  assert.match(forward, /lease_token=p_lease_token AND state='running'/u);
  assert.match(forward, /fencing_token=p_fencing_token/u);
  assert.match(forward, /require_exact_one_video_run_finalizer_v1/u);
  assert.match(forward, /consumed_at IS NOT NULL/u);
  assert.match(forward, /state='uncertain'/u);
  assert.match(forward, /uncertain_error_digest=p_error_digest/u);
  assert.match(forward, /GRANT EXECUTE ON FUNCTION ai_media_worker_api\.acquire_exact_one_video_run_v1/u);
  assert.match(forward, /REVOKE ALL ON TABLE[\s\S]*FROM PUBLIC,ai_media_one_video_run_executor/u);
});

test("PR32 cannot perform external effects and rollback preserves evidence", () => {
  assert.doesNotMatch(forward, /\b(?:dblink|http_get|http_post|curl|wget|COPY\s+PROGRAM|lo_import)\b|\bnet\.http_/iu);
  assert.doesNotMatch(forward, /\b(?:publish|provider\.submit|fetch\s*\()\b/iu);
  assert.match(rollback, /rollback preserves exact one-video authorization and run evidence/u);
  assert.match(rollback, /EXISTS \(SELECT 1 FROM public\.ai_media_exact_one_video_run_capabilities/u);
  assert.match(rollback, /EXISTS \(SELECT 1 FROM public\.ai_media_exact_one_video_run_fences/u);
  assert.match(rollback, /DROP FUNCTION ai_media_worker_api\.acquire_exact_one_video_run_v1/u);
});
