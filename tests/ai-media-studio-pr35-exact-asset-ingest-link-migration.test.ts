import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const forward = readFileSync(new URL(
  "../migrations/ai-media-studio/pending/20260723_pr35_exact_asset_ingest_link_forward.sql",
  import.meta.url,
), "utf8");
const rollback = readFileSync(new URL(
  "../migrations/ai-media-studio/pending/20260723_pr35_exact_asset_ingest_link_rollback.sql",
  import.meta.url,
), "utf8");

const names = [
  "require_exact_one_video_asset_context_v1",
  "claim_exact_one_video_asset_ingest_v1",
  "record_exact_one_video_asset_ingest_completed_v1",
  "record_exact_one_video_asset_ingest_failed_v1",
  "load_exact_one_video_asset_link_v1",
  "record_exact_one_video_asset_linked_v1",
] as const;
const exposed = names.slice(1);
const signatures = [
  "uuid,uuid,bigint,text,text,text,text,uuid,uuid,uuid,integer,text,uuid,text,integer",
  "uuid,uuid,bigint,text,text,text,text,uuid,uuid,uuid,integer,text,uuid,text,bigint,text,text,bigint",
  "uuid,uuid,bigint,text,text,text,text,uuid,uuid,uuid,integer,text,uuid,text,bigint,text,boolean,timestamptz",
  "uuid,uuid,bigint,text,text,text,text,uuid,uuid,uuid,integer,text,uuid",
  "uuid,uuid,bigint,text,text,text,text,uuid,uuid,uuid,integer,text,uuid,bigint,text,text,uuid",
] as const;

const sliceFunction = (name: string, next?: string): string => {
  const start = forward.indexOf(`CREATE FUNCTION ai_media_worker_api.${name}`);
  assert.notEqual(start, -1, `missing ${name}`);
  const end = next
    ? forward.indexOf(`CREATE FUNCTION ai_media_worker_api.${next}`, start)
    : forward.indexOf("GRANT SELECT,UPDATE ON TABLE", start);
  assert.notEqual(end, -1, `missing end marker for ${name}`);
  return forward.slice(start, end);
};

test("PR35 is pending, PostgreSQL-16-only, and exposes five stable table-blind entrypoints", () => {
  assert.match(forward, /Review artifact only\. Do not apply automatically/u);
  assert.match(forward, /PostgreSQL 16 only/u);
  for (const table of [
    "ai_media_exact_one_video_run_capabilities",
    "ai_media_exact_one_video_run_fences",
    "ai_media_asset_ingest_jobs",
    "ai_media_assets",
    "ai_media_render_jobs",
    "ai_media_provider_terminal_events",
  ]) {
    assert.match(forward, new RegExp(`to_regclass\\('public\\.${table}'\\) IS NULL`, "u"));
  }
  assert.equal((forward.match(/^CREATE FUNCTION ai_media_worker_api\./gmu) ?? []).length, names.length);
  for (const name of names) {
    const body = sliceFunction(name, names[names.indexOf(name) + 1]);
    assert.match(body, /LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET row_security=on/u);
    assert.match(
      forward,
      new RegExp(`REVOKE ALL ON FUNCTION ai_media_worker_api\\.${name}\\([\\s\\S]*?\\) FROM PUBLIC;`, "u"),
    );
    assert.match(
      forward,
      new RegExp(`ALTER FUNCTION ai_media_worker_api\\.${name}\\([\\s\\S]*?\\)\\s+OWNER TO ai_media_admitted_fn_owner;`, "u"),
    );
  }
  for (const [index, name] of exposed.entries()) {
    assert.match(
      forward,
      new RegExp(
        `GRANT EXECUTE ON FUNCTION ai_media_worker_api\\.${name}\\(\\s*${signatures[index].replaceAll(",", ",\\s*")}\\)\\s*TO ai_media_one_video_run_executor;`,
        "u",
      ),
    );
  }
});

test("every callable function binds and returns the full immutable exact-run identity", () => {
  const commonPrefix =
    /p_execution_id uuid,p_run_lease_token uuid,p_run_fencing_token bigint,p_command_digest text,\s*p_actor_user_id text,p_owner_user_id text,p_workspace_id text,p_budget_reservation_id uuid,\s*p_render_job_id uuid,p_daily_plan_slot_id uuid,p_slot_attempt integer,p_work_handoff_digest text/u;
  const resultIdentity =
    /execution_id uuid,run_lease_token uuid,run_fencing_token bigint,command_digest text,actor_user_id text,\s*owner_user_id text,workspace_id text,budget_reservation_id uuid,render_job_id uuid,\s*daily_plan_slot_id uuid,slot_attempt integer,work_handoff_digest text/u;
  for (let index = 1; index < names.length; index += 1) {
    const body = sliceFunction(names[index], names[index + 1]);
    assert.match(body, commonPrefix);
    assert.match(body, resultIdentity);
    assert.match(body, /require_exact_one_video_asset_context_v1\(/u);
    assert.match(
      body,
      /RETURN QUERY SELECT p_execution_id,p_run_lease_token,p_run_fencing_token,p_command_digest,p_actor_user_id,\s*p_owner_user_id,p_workspace_id,p_budget_reservation_id,p_render_job_id,p_daily_plan_slot_id,\s*p_slot_attempt,p_work_handoff_digest/u,
    );
  }
});

test("the context requires a live PR32 action fence and denies any executor table access", () => {
  const context = sliceFunction(names[0], names[1]);
  for (const predicate of [
    "exact_capability.database_principal=SESSION_USER",
    "fence.id=p_execution_id",
    "fence.actor_user_id=p_actor_user_id",
    "fence.budget_reservation_id=p_budget_reservation_id",
    "fence.render_job_id=p_render_job_id",
    "fence.daily_plan_slot_id=p_daily_plan_slot_id",
    "fence.slot_attempt=p_slot_attempt",
    "fence.work_handoff_digest=p_work_handoff_digest",
    "fence.action=p_action",
    "fence.command_digest=p_command_digest",
    "fence.state='running'",
    "fence.fencing_token=p_run_fencing_token",
    "fence.lease_token=p_run_lease_token",
    "fence.lease_owner=p_actor_user_id",
    "fence.lease_expires_at>sampled_at",
  ]) assert.ok(context.includes(predicate), `missing ${predicate}`);
  assert.match(context, /p_action NOT IN \('ingest_asset','link_asset'\)/u);
  assert.match(context, /has_table_privilege\(SESSION_USER,protected\.table_name,'SELECT'\)/u);
  assert.match(context, /USING ERRCODE='42501'/u);
});

test("claim is exact-target only and bounded lease recovery cannot drain a global queue", () => {
  const claim = sliceFunction(names[1], names[2]);
  assert.match(claim, /ingest\.id=p_ingest_job_id/u);
  assert.match(claim, /ingest\.render_job_id=p_render_job_id/u);
  assert.match(claim, /terminal\.budget_reservation_id=p_budget_reservation_id/u);
  assert.match(claim, /render\.daily_plan_slot_id=p_daily_plan_slot_id/u);
  assert.match(claim, /render\.slot_attempt=p_slot_attempt/u);
  assert.match(claim, /render\.work_handoff_digest=p_work_handoff_digest/u);
  assert.match(claim, /job\.lease_recoveries\+1>=job\.max_lease_recoveries/u);
  assert.match(claim, /p_lease_ms NOT BETWEEN 1 AND 300000/u);
  assert.match(claim, /fencing_token=target\.fencing_token\+1/u);
  assert.doesNotMatch(claim, /ORDER BY|SKIP LOCKED|LIMIT\s+1/iu);
});

test("completion and failure are lease/fence protected, exact replay aware, and expose safe failures only", () => {
  const complete = sliceFunction(names[2], names[3]);
  const fail = sliceFunction(names[3], names[4]);
  for (const body of [complete, fail]) {
    assert.match(body, /state='leased'/u);
    assert.match(body, /render\.budget_reservation_id=p_budget_reservation_id/u);
    assert.match(body, /render\.daily_plan_slot_id=p_daily_plan_slot_id/u);
    assert.match(body, /render\.slot_attempt=p_slot_attempt/u);
    assert.match(body, /render\.work_handoff_digest=p_work_handoff_digest/u);
    assert.match(body, /lease_token=p_ingest_lease_token/u);
    assert.match(body, /fencing_token=p_ingest_fencing_token/u);
    assert.match(body, /lease_expires_at>sampled_at/u);
    assert.match(body, /job\.state=/u);
  }
  assert.match(complete, /job\.owned_object_key=p_owned_object_key AND job\.sha256=p_sha256/u);
  assert.match(complete, /target\.owner_user_id=p_owner_user_id/u);
  assert.match(complete, /p_sha256!~'\^\[0-9a-f\]\{64\}\$'/u);
  assert.match(fail, /p_error_code NOT IN \('source_rejected','source_unavailable','mime_rejected'/u);
  assert.match(fail, /next_state=CASE WHEN p_retryable AND job\.attempts<job\.max_attempts/u);
  assert.match(fail, /target\.state='leased'/u);
  assert.doesNotMatch(fail, /p_error_message|RAISE NOTICE/u);
});

test("link is stale-load fenced and atomically verifies canonical asset plus completed render projection", () => {
  const load = sliceFunction(names[4], names[5]);
  const link = sliceFunction(names[5]);
  assert.match(load, /ingest\.id=p_ingest_job_id/u);
  assert.match(load, /ingest\.state='completed'/u);
  assert.match(load, /ingest\.fencing_token::bigint/u);
  for (const predicate of [
    "asset.owner_user_id=ingest.owner_user_id",
    "asset.workspace_id=ingest.workspace_id",
    "asset.kind='video'",
    "asset.status='ready'",
    "asset.deleted_at IS NULL",
    "asset.checksum=p_sha256",
    "asset.storage_key=p_owned_object_key",
    "asset.mime_type=ingest.expected_mime_type",
    "asset.byte_size=ingest.size_bytes",
    "asset.render_job_id=ingest.render_job_id",
    "ingest.fencing_token=p_ingest_fencing_token",
    "ingest.sha256=p_sha256",
    "ingest.owned_object_key=p_owned_object_key",
  ]) assert.ok(link.includes(predicate), `missing ${predicate}`);
  assert.match(
    link,
    /UPDATE public\.ai_media_asset_ingest_jobs AS target\s+SET media_asset_id=p_media_asset_id/u,
  );
  assert.match(link, /target\.media_asset_id IS NULL/u);
  assert.match(
    link,
    /UPDATE public\.ai_media_render_jobs AS target\s+SET status='completed',stage='completed',progress=100/u,
  );
  assert.match(link, /target\.owner_user_id=p_owner_user_id/u);
  assert.match(link, /target\.provider_terminal_state='completed'/u);
});

test("PR35 contains no provider/download/publishing I/O and rollback preserves evidence", () => {
  for (const forbidden of [
    /https?:\/\//iu,
    /\bfetch\s*\(/iu,
    /\bcurl\b/iu,
    /\bai_media_publishing_jobs\b/iu,
    /\bai_media_publications\b/iu,
    /\bCREATE ROLE\b/iu,
    /\bALTER ROLE\b/iu,
    /\bINSERT INTO public\.ai_media_assets\b/iu,
    /\bDELETE FROM\b/iu,
    /\bTRUNCATE\b(?!'\))/iu,
  ]) assert.doesNotMatch(forward, forbidden);
  assert.match(rollback, /rollback preserves exact one-video asset ingest and link evidence/u);
  assert.match(rollback, /REVOKE UPDATE ON TABLE public\.ai_media_asset_ingest_jobs/u);
  assert.match(rollback, /REVOKE SELECT ON TABLE public\.ai_media_assets/u);
  assert.doesNotMatch(
    forward,
    /GRANT UPDATE ON TABLE public\.ai_media_assets/u,
  );
  assert.match(
    forward,
    /GRANT UPDATE\(id\) ON TABLE public\.ai_media_assets/u,
  );
  assert.match(
    rollback,
    /REVOKE UPDATE\(id\) ON TABLE public\.ai_media_assets/u,
  );
  assert.doesNotMatch(rollback, /DROP TABLE|DELETE FROM|TRUNCATE TABLE/iu);
});
