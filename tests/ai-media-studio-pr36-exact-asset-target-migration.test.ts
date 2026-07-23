import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
const forward = readFileSync(new URL("../migrations/ai-media-studio/pending/20260723_pr36_exact_asset_target_lookup_forward.sql", import.meta.url), "utf8");
const rollback = readFileSync(new URL("../migrations/ai-media-studio/pending/20260723_pr36_exact_asset_target_lookup_rollback.sql", import.meta.url), "utf8");
test("PR36 is pending, least-privilege, exact-target only, and reversible", () => {
  assert.match(forward, /Review artifact only\. Do not apply automatically/u);
  assert.equal((forward.match(/^CREATE FUNCTION ai_media_worker_api\./gmu) ?? []).length, 1);
  assert.match(forward, /LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET row_security=on/u);
  assert.match(forward, /require_exact_one_video_asset_context_v1\(/u);
  assert.match(forward, /p_action NOT IN \('ingest_asset','link_asset'\)/u);
  for (const predicate of [
    "ingest.render_job_id=p_render_job_id", "terminal.terminal_state='completed'",
    "terminal.budget_reservation_id=p_budget_reservation_id",
    "render.daily_plan_slot_id=p_daily_plan_slot_id", "render.slot_attempt=p_slot_attempt",
    "render.work_handoff_digest=p_work_handoff_digest",
  ]) assert.ok(forward.includes(predicate), `missing ${predicate}`);
  assert.doesNotMatch(forward, /p_ingest_job_id|ORDER BY|SKIP LOCKED|LIMIT\s+1/iu);
  assert.match(forward, /REVOKE ALL ON FUNCTION[\s\S]+FROM PUBLIC;/u);
  assert.match(forward, /OWNER TO ai_media_admitted_fn_owner/u);
  assert.match(forward, /GRANT EXECUTE ON FUNCTION[\s\S]+TO ai_media_one_video_run_executor;/u);
  assert.match(rollback, /DROP FUNCTION ai_media_worker_api\.load_exact_one_video_asset_target_v1/u);
});
