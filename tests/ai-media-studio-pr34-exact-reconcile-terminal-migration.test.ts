import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const forward = readFileSync(new URL(
  "../migrations/ai-media-studio/pending/20260723_pr34_exact_one_video_reconcile_terminal_forward.sql",
  import.meta.url,
), "utf8");
const rollback = readFileSync(new URL(
  "../migrations/ai-media-studio/pending/20260723_pr34_exact_one_video_reconcile_terminal_rollback.sql",
  import.meta.url,
), "utf8");
const prerequisiteTerminal = readFileSync(new URL(
  "../migrations/ai-media-studio/20260721_pr27_heygen_terminal_forward.sql",
  import.meta.url,
), "utf8");

const functionNames = [
  "require_exact_one_video_reconcile_context_v1",
  "claim_exact_one_video_reconciliation_v1",
  "release_exact_one_video_reconciliation_unknown_v1",
  "record_exact_one_video_reconciled_confirmed_v1",
  "finalize_exact_one_video_reconciled_no_submit_v1",
  "claim_exact_one_video_terminal_check_v1",
  "release_exact_one_video_terminal_check_unknown_v1",
  "record_exact_one_video_provider_terminal_v1",
] as const;

const exposedFunctionNames = functionNames.slice(1);
const fullIdentity =
  /execution_id uuid,run_lease_token uuid,run_fencing_token bigint,command_digest text,actor_user_id text,[\s\S]*?owner_user_id text,workspace_id text,budget_reservation_id uuid,render_job_id uuid,[\s\S]*?daily_plan_slot_id uuid,slot_attempt integer,work_handoff_digest text/u;

const sliceFunction = (name: string, nextName?: string) => {
  const start = forward.indexOf(`CREATE FUNCTION ai_media_worker_api.${name}`);
  assert.notEqual(start, -1, `missing ${name}`);
  const end = nextName
    ? forward.indexOf(`CREATE FUNCTION ai_media_worker_api.${nextName}`, start)
    : forward.indexOf("GRANT USAGE ON SCHEMA", start);
  assert.notEqual(end, -1, `missing end marker for ${name}`);
  return forward.slice(start, end);
};

const reconcileClaim = sliceFunction(
  "claim_exact_one_video_reconciliation_v1",
  "release_exact_one_video_reconciliation_unknown_v1",
);
const terminalClaim = sliceFunction(
  "claim_exact_one_video_terminal_check_v1",
  "release_exact_one_video_terminal_check_unknown_v1",
);
const reconciledConfirmed = sliceFunction(
  "record_exact_one_video_reconciled_confirmed_v1",
  "finalize_exact_one_video_reconciled_no_submit_v1",
);
const reconciledNoSubmit = sliceFunction(
  "finalize_exact_one_video_reconciled_no_submit_v1",
  "claim_exact_one_video_terminal_check_v1",
);
const terminalRecord = sliceFunction("record_exact_one_video_provider_terminal_v1");

test("PR34 requires the exact PR26, PR27, and PR32 prerequisites and defines eight stable functions", () => {
  assert.match(forward, /PostgreSQL 16 only/u);
  for (const table of [
    "ai_media_exact_one_video_run_capabilities",
    "ai_media_exact_one_video_run_fences",
    "ai_media_provider_submission_attempts",
    "ai_media_provider_terminal_checks",
    "ai_media_provider_terminal_events",
    "ai_media_admitted_worker_capabilities",
  ]) {
    assert.match(forward, new RegExp(`to_regclass\\('public\\.${table}'\\) IS NULL`, "u"));
  }
  for (const prerequisite of [
    "claim_reconciliation_v1",
    "release_reconciliation_unknown_v1",
    "record_reconciled_confirmed_v1",
    "finalize_reconciled_no_submit_v1",
    "claim_terminal_check_v1",
    "release_terminal_check_unknown_v1",
    "record_provider_terminal_v1",
  ]) {
    assert.match(forward, new RegExp(`to_regprocedure\\('ai_media_worker_api\\.${prerequisite}\\(`, "u"));
  }
  assert.match(
    forward,
    /to_regprocedure\('ai_media_worker_api\.require_exact_one_video_reconcile_context_v1\(uuid,uuid,bigint,text,text,text,text,uuid,uuid,uuid,integer,text,text,text,text,integer\)'\) IS NOT NULL/u,
  );

  assert.equal(
    (forward.match(/^CREATE FUNCTION ai_media_worker_api\./gmu) ?? []).length,
    functionNames.length,
  );
  for (const name of functionNames) {
    assert.match(forward, new RegExp(`CREATE FUNCTION ai_media_worker_api\\.${name}\\(`, "u"));
    assert.match(
      forward,
      new RegExp(
        `CREATE FUNCTION ai_media_worker_api\\.${name}\\([\\s\\S]*?LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET row_security=on`,
        "u",
      ),
    );
    assert.match(
      forward,
      new RegExp(`REVOKE ALL ON FUNCTION ai_media_worker_api\\.${name}\\([\\s\\S]*?\\) FROM PUBLIC;`, "u"),
    );
    assert.match(
      forward,
      new RegExp(`ALTER FUNCTION ai_media_worker_api\\.${name}\\([\\s\\S]*?\\) OWNER TO ai_media_admitted_fn_owner;`, "u"),
    );
  }
});

test("every callable PR34 surface has the exact full-run prefix and returns full immutable identity", () => {
  const commonPrefix =
    /p_execution_id uuid,p_run_lease_token uuid,p_run_fencing_token bigint,p_command_digest text,\s*p_actor_user_id text,p_owner_user_id text,p_workspace_id text,p_budget_reservation_id uuid,\s*p_render_job_id uuid,p_daily_plan_slot_id uuid,p_slot_attempt integer,p_work_handoff_digest text/u;
  for (let index = 1; index < functionNames.length; index += 1) {
    const body = sliceFunction(functionNames[index], functionNames[index + 1]);
    assert.match(body, commonPrefix);
    assert.match(body, fullIdentity);
    assert.match(
      body,
      /RETURN QUERY SELECT p_execution_id,p_run_lease_token,p_run_fencing_token,p_command_digest,p_actor_user_id,\s*p_owner_user_id,p_workspace_id,p_budget_reservation_id,p_render_job_id,p_daily_plan_slot_id,\s*p_slot_attempt,p_work_handoff_digest/u,
    );
  }

  const expectedSignatures = [
    "uuid,uuid,bigint,text,text,text,text,uuid,uuid,uuid,integer,text,text,integer",
    "uuid,uuid,bigint,text,text,text,text,uuid,uuid,uuid,integer,text,uuid,bigint,text,uuid,bigint",
    "uuid,uuid,bigint,text,text,text,text,uuid,uuid,uuid,integer,text,uuid,bigint,text,uuid,bigint,text,text,text",
    "uuid,uuid,bigint,text,text,text,text,uuid,uuid,uuid,integer,text,uuid,bigint,text,uuid,bigint,text,uuid,text,integer,text,timestamptz,text",
    "uuid,uuid,bigint,text,text,text,text,uuid,uuid,uuid,integer,text,text,integer",
    "uuid,uuid,bigint,text,text,text,text,uuid,uuid,uuid,integer,text,uuid,uuid,bigint,text,timestamptz,text",
    "uuid,uuid,bigint,text,text,text,text,uuid,uuid,uuid,integer,text,uuid,uuid,bigint,uuid,bigint,text,uuid,text,integer,text,text,text,text,timestamptz,text",
  ];
  for (const [index, name] of exposedFunctionNames.entries()) {
    const signature = expectedSignatures[index];
    assert.match(
      forward,
      new RegExp(`GRANT EXECUTE ON FUNCTION ai_media_worker_api\\.${name}\\(\\s*${signature.replaceAll(",", ",\\s*")}\\)\\s*TO ai_media_one_video_run_executor;`, "u"),
    );
  }
});

test("the shared guard binds a live PR32 fence, exact action, actor, target, command, and lease", () => {
  const guard = sliceFunction(
    "require_exact_one_video_reconcile_context_v1",
    "claim_exact_one_video_reconciliation_v1",
  );
  assert.match(guard, /p_action NOT IN \('reconcile_submission','observe_terminal'\)/u);
  assert.match(guard, /p_action='reconcile_submission' AND p_operation NOT IN \('claim_reconciliation',[\s\S]*?'finalize_reconciled_no_submit'\)/u);
  assert.match(guard, /p_action='observe_terminal' AND p_operation NOT IN \('claim_terminal_check',[\s\S]*?'record_provider_terminal'\)/u);
  for (const predicate of [
    "fence.id=p_execution_id",
    "exact_capability.database_principal=SESSION_USER",
    "fence.owner_user_id=p_owner_user_id",
    "fence.workspace_id=p_workspace_id",
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
  ]) {
    assert.match(guard, new RegExp(predicate.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"), "u"));
  }
  assert.match(guard, /FOR UPDATE OF fence,exact_capability/u);
});

test("the executor remains table-blind and needs exactly one live PR26 reconcile capability", () => {
  const guard = sliceFunction(
    "require_exact_one_video_reconcile_context_v1",
    "claim_exact_one_video_reconciliation_v1",
  );
  for (const table of [
    "ai_media_exact_one_video_run_capabilities",
    "ai_media_exact_one_video_run_fences",
    "ai_media_admitted_worker_capabilities",
    "ai_media_provider_submission_attempts",
    "ai_media_provider_submission_events",
    "ai_media_provider_terminal_checks",
    "ai_media_provider_terminal_events",
    "ai_media_submission_capacity_leases",
    "ai_media_asset_ingest_jobs",
  ]) {
    assert.match(guard, new RegExp(`'public\\.${table}'`, "u"));
  }
  for (const privilege of [
    "SELECT",
    "INSERT",
    "UPDATE",
    "DELETE",
    "TRUNCATE",
    "REFERENCES",
    "TRIGGER",
  ]) {
    assert.match(
      guard,
      new RegExp(`has_table_privilege\\(SESSION_USER,protected\\.table_name,'${privilege}'\\)`, "u"),
    );
  }
  assert.match(guard, /capability\.database_principal=SESSION_USER/u);
  assert.match(guard, /capability\.owner_user_id=p_owner_user_id AND capability\.workspace_id=p_workspace_id/u);
  assert.match(guard, /capability\.lane='reconcile' AND p_operation=ANY\(capability\.allowed_operations\)/u);
  assert.match(guard, /capability\.valid_from<=sampled_at AND capability\.expires_at>sampled_at/u);
  assert.match(guard, /capability\.revoked_at IS NULL/u);
  assert.match(guard, /matching_capabilities<>1/u);
  assert.match(guard, /FROM ai_media_worker_api\.require_capability_v1\(/u);
  assert.match(
    guard,
    /RETURN QUERY SELECT reconcile_capability\.id,authority\.accounting_time_zone,authority\.actor_user_id/u,
  );
});

test("both claims select only the requested render target and never invoke global claimers", () => {
  for (const claim of [reconcileClaim, terminalClaim]) {
    for (const predicate of [
      "owner_user_id=p_owner_user_id",
      "workspace_id=p_workspace_id",
      "budget_reservation_id=p_budget_reservation_id",
      "render_job_id=p_render_job_id",
      "daily_plan_slot_id=p_daily_plan_slot_id",
      "slot_attempt=p_slot_attempt",
      "work_handoff_digest=p_work_handoff_digest",
    ]) {
      assert.match(claim, new RegExp(predicate, "u"));
    }
    assert.doesNotMatch(claim, /\bORDER BY\b|\bLIMIT\s+1\b|\bSKIP LOCKED\b/u);
  }
  assert.doesNotMatch(reconcileClaim, /FROM ai_media_worker_api\.claim_reconciliation_v1\s*\(/u);
  assert.doesNotMatch(terminalClaim, /FROM ai_media_worker_api\.claim_terminal_check_v1\s*\(/u);
  assert.match(reconcileClaim, /candidate\.state='ambiguous'/u);
  assert.match(reconcileClaim, /reconciliation_lease_owner=context\.admitted_actor_user_id/u);
  assert.match(terminalClaim, /attempt\.state='confirmed'/u);
  assert.match(terminalClaim, /terminal_event\.id IS NULL/u);
  assert.match(terminalClaim, /new_lease,context\.admitted_actor_user_id/u);
});

test("every reconciliation and terminal finalizer rejects expired or mismatched inner leases", () => {
  const reconciliationFinalizers = [
    "release_exact_one_video_reconciliation_unknown_v1",
    "record_exact_one_video_reconciled_confirmed_v1",
    "finalize_exact_one_video_reconciled_no_submit_v1",
  ] as const;
  for (const name of reconciliationFinalizers) {
    const body = sliceFunction(name, functionNames[functionNames.indexOf(name) + 1]);
    assert.match(body, /attempt\.reconciliation_lease_token=p_reconciliation_lease_token/u);
    assert.match(body, /attempt\.reconciliation_lease_owner=context\.admitted_actor_user_id/u);
    assert.match(body, /attempt\.reconciliation_fencing_token=p_reconciliation_fencing_token/u);
    assert.match(body, /attempt\.reconciliation_lease_expires_at>sampled_at/u);
  }

  for (const name of [
    "release_exact_one_video_terminal_check_unknown_v1",
    "record_exact_one_video_provider_terminal_v1",
  ] as const) {
    const body = sliceFunction(name, functionNames[functionNames.indexOf(name) + 1]);
    assert.match(body, /terminal_check\.lease_token=p_lease_token/u);
    assert.match(body, /terminal_check\.lease_owner=context\.admitted_actor_user_id/u);
    assert.match(body, /terminal_check\.fencing_token=p_terminal_check_fencing/u);
    assert.match(body, /terminal_check\.lease_expires_at>sampled_at/u);
  }
});

test("confirmed reconciliation replay is explicit, exact-equivalent, and remains inside the live retry guard", () => {
  const context = reconciledConfirmed.indexOf(
    "require_exact_one_video_reconcile_context_v1(",
  );
  const replay = reconciledConfirmed.indexOf("IF FOUND AND attempt.state='confirmed' THEN");
  const liveLease = reconciledConfirmed.indexOf(
    "attempt.reconciliation_lease_expires_at>sampled_at",
  );
  assert.ok(context >= 0 && replay > context && liveLease > replay);
  assert.match(
    reconciledConfirmed,
    /DECLARE context record;attempt public\.ai_media_provider_submission_attempts%ROWTYPE;[\s\S]*?equivalent_replay boolean:=false;/u,
  );
  for (const exactBinding of [
    "candidate.id=p_attempt_id",
    "candidate.owner_user_id=p_owner_user_id",
    "candidate.workspace_id=p_workspace_id",
    "candidate.budget_reservation_id=p_budget_reservation_id",
    "candidate.render_job_id=p_render_job_id",
    "candidate.daily_plan_slot_id=p_daily_plan_slot_id",
    "candidate.slot_attempt=p_slot_attempt",
    "candidate.work_handoff_digest=p_work_handoff_digest",
    "candidate.fencing_token=p_submission_fencing_token",
    "candidate.send_authorization_digest=p_authorization_digest",
  ]) {
    assert.match(reconciledConfirmed, new RegExp(exactBinding, "u"));
  }
  assert.match(reconciledConfirmed, /event\.event_kind='confirmed'/u);
  assert.match(reconciledConfirmed, /event\.fencing_token=p_submission_fencing_token/u);
  assert.match(reconciledConfirmed, /event\.evidence_digest=p_evidence_digest/u);
  assert.match(reconciledConfirmed, /event\.provider_job_id=p_provider_job_id/u);
  assert.match(
    reconciledConfirmed,
    /event\.provider_request_id IS NOT DISTINCT FROM p_provider_request_id/u,
  );
  assert.match(reconciledConfirmed, /event\.actor_user_id=context\.admitted_actor_user_id/u);
  assert.match(reconciledConfirmed, /attempt\.provider_job_id=p_provider_job_id/u);
  assert.match(
    reconciledConfirmed,
    /attempt\.provider_request_id IS NOT DISTINCT FROM p_provider_request_id/u,
  );
  assert.match(reconciledConfirmed, /attempt\.confirmed_evidence_digest=p_evidence_digest/u);
  assert.match(
    reconciledConfirmed,
    /p_slot_attempt,p_work_handoff_digest,equivalent_replay;RETURN;/u,
  );
  assert.match(
    reconciledConfirmed,
    /ELSIF FOUND AND attempt\.state<>'ambiguous' THEN[\s\S]*?p_slot_attempt,p_work_handoff_digest,false;RETURN;/u,
  );
});

test("no-submit reconciliation replay recomputes the exact durable evidence and rejects any mismatch", () => {
  const context = reconciledNoSubmit.indexOf(
    "require_exact_one_video_reconcile_context_v1(",
  );
  const evidence = reconciledNoSubmit.indexOf(
    "bound_evidence=ai_media_worker_api.sha256_text_v1(",
  );
  const replay = reconciledNoSubmit.indexOf(
    "IF FOUND AND attempt.state='reconciled_no_submit' THEN",
  );
  const liveLease = reconciledNoSubmit.indexOf(
    "attempt.reconciliation_lease_expires_at>sampled_at",
  );
  assert.ok(context >= 0 && evidence > context && replay > evidence && liveLease > replay);
  assert.match(
    reconciledNoSubmit,
    /bound_evidence=ai_media_worker_api\.sha256_text_v1\('linearizable-definitive-no-submit:v1:'\|\|[\s\S]*?p_provider_evidence_digest\);/u,
  );
  for (const exactBinding of [
    "candidate.id=p_attempt_id",
    "candidate.owner_user_id=p_owner_user_id",
    "candidate.workspace_id=p_workspace_id",
    "candidate.budget_reservation_id=p_budget_reservation_id",
    "candidate.render_job_id=p_render_job_id",
    "candidate.daily_plan_slot_id=p_daily_plan_slot_id",
    "candidate.slot_attempt=p_slot_attempt",
    "candidate.work_handoff_digest=p_work_handoff_digest",
    "candidate.fencing_token=p_submission_fencing_token",
    "candidate.send_authorization_digest=p_authorization_digest",
  ]) {
    assert.match(reconciledNoSubmit, new RegExp(exactBinding, "u"));
  }
  assert.match(reconciledNoSubmit, /event\.event_kind='reconciled_no_submit'/u);
  assert.match(reconciledNoSubmit, /event\.reconciliation_fencing_token=p_reconciliation_fencing_token/u);
  assert.match(reconciledNoSubmit, /event\.evidence_digest=bound_evidence/u);
  assert.match(reconciledNoSubmit, /event\.actor_user_id=context\.admitted_actor_user_id/u);
  assert.match(reconciledNoSubmit, /attempt\.reconciliation_evidence_digest=bound_evidence/u);
  assert.match(reconciledNoSubmit, /attempt\.provider_account_id=p_provider_account_id/u);
  assert.match(reconciledNoSubmit, /attempt\.provider_key=p_provider_key/u);
  assert.match(
    reconciledNoSubmit,
    /attempt\.provider_credential_version=p_provider_credential_version/u,
  );
  assert.match(
    reconciledNoSubmit,
    /attempt\.provider_idempotency_key=p_provider_idempotency_key/u,
  );
  assert.match(
    reconciledNoSubmit,
    /p_guarantee='linearizable_not_accepted_and_cannot_later_accept'/u,
  );
  assert.match(
    reconciledNoSubmit,
    /p_slot_attempt,p_work_handoff_digest,equivalent_replay;RETURN;/u,
  );
  assert.match(
    reconciledNoSubmit,
    /ELSIF FOUND AND attempt\.state<>'ambiguous' THEN[\s\S]*?p_slot_attempt,p_work_handoff_digest,false;RETURN;/u,
  );
});

test("terminal replay is exact, returns durable IDs, and maps mismatched evidence to conflict", () => {
  const context = terminalRecord.indexOf("require_exact_one_video_reconcile_context_v1(");
  const advisoryLock = terminalRecord.indexOf("pg_advisory_xact_lock(");
  const replayLookup = terminalRecord.indexOf("SELECT event.* INTO existing");
  const liveLease = terminalRecord.indexOf("terminal_check.lease_expires_at>sampled_at");
  assert.ok(
    context >= 0
      && advisoryLock > context
      && replayLookup > advisoryLock
      && liveLease > replayLookup,
  );
  assert.match(terminalRecord, /JOIN public\.ai_media_provider_submission_attempts attempt/u);
  for (const exactBinding of [
    "event.owner_user_id=p_owner_user_id",
    "event.workspace_id=p_workspace_id",
    "event.submission_attempt_id=p_submission_attempt_id",
    "event.terminal_check_id=p_terminal_check_id",
    "event.budget_reservation_id=p_budget_reservation_id",
    "event.render_job_id=p_render_job_id",
    "event.daily_plan_slot_id=p_daily_plan_slot_id",
    "attempt.render_job_id=p_render_job_id",
    "attempt.daily_plan_slot_id=p_daily_plan_slot_id",
    "attempt.slot_attempt=p_slot_attempt",
    "attempt.work_handoff_digest=p_work_handoff_digest",
    "attempt.fencing_token=p_submission_fencing_token",
    "attempt.send_authorization_digest=p_authorization_digest",
  ]) {
    assert.match(terminalRecord, new RegExp(exactBinding, "u"));
  }
  for (const equivalentEvidence of [
    "existing.terminal_state=p_terminal_state",
    "existing.provider_account_id=p_provider_account_id",
    "existing.provider_key=p_provider_key",
    "existing.provider_credential_version=p_provider_credential_version",
    "existing.provider_job_id=p_provider_job_id",
    "existing.send_authorization_digest=p_authorization_digest",
    "existing.provider_evidence_digest=p_provider_evidence_digest",
    "existing.observed_at=p_observed_at",
    "existing.actor_user_id=context.admitted_actor_user_id",
  ]) {
    assert.match(terminalRecord, new RegExp(equivalentEvidence, "u"));
  }
  assert.match(
    terminalRecord,
    /existing\.remote_artifact_ref IS NOT DISTINCT FROM p_remote_artifact_ref/u,
  );
  assert.match(terminalRecord, /existing\.remote_url IS NOT DISTINCT FROM p_remote_url/u);
  assert.match(
    terminalRecord,
    /SELECT ingest\.id INTO existing_ingest FROM public\.ai_media_asset_ingest_jobs ingest[\s\S]*?ingest\.render_job_id=p_render_job_id/u,
  );
  assert.match(
    terminalRecord,
    /p_slot_attempt,p_work_handoff_digest,'replayed'::text,existing\.id,existing_ingest;RETURN;/u,
  );
  assert.match(
    terminalRecord,
    /p_slot_attempt,p_work_handoff_digest,'conflict'::text,NULL::uuid,NULL::uuid;RETURN;/u,
  );
});

test("all replay paths still enter the same live PR32, PR26, and table-blind guard", () => {
  for (const body of [reconciledConfirmed, reconciledNoSubmit, terminalRecord]) {
    assert.equal(
      (body.match(/require_exact_one_video_reconcile_context_v1\(/gu) ?? []).length,
      1,
    );
    assert.match(
      body,
      /p_execution_id,p_run_lease_token,p_run_fencing_token,p_command_digest,p_actor_user_id,\s*p_owner_user_id,p_workspace_id,p_budget_reservation_id,p_render_job_id,p_daily_plan_slot_id,\s*p_slot_attempt,p_work_handoff_digest/u,
    );
  }
  const guard = sliceFunction(
    "require_exact_one_video_reconcile_context_v1",
    "claim_exact_one_video_reconciliation_v1",
  );
  assert.match(guard, /fence\.state='running'/u);
  assert.match(guard, /fence\.lease_expires_at>sampled_at/u);
  assert.match(guard, /matching_capabilities<>1/u);
  assert.match(guard, /exact one-video reconcile executor must remain table-blind/u);
});

test("completed terminal observation delegates to PR27's transactional ingest enqueue without external I/O", () => {
  assert.match(
    forward,
    /to_regprocedure\('ai_media_worker_api\.record_provider_terminal_v1\(uuid,text,text,uuid,uuid,bigint,uuid,bigint,text,uuid,text,integer,text,text,text,text,timestamptz,text\)'\) IS NULL/u,
  );
  assert.match(terminalRecord, /outcome text,terminal_event_id uuid,ingest_job_id uuid/u);
  assert.match(
    terminalRecord,
    /FROM ai_media_worker_api\.record_provider_terminal_v1\(context\.capability_id,[\s\S]*?\) result;/u,
  );
  const prerequisiteRecord = prerequisiteTerminal.slice(
    prerequisiteTerminal.indexOf("CREATE FUNCTION ai_media_worker_api.record_provider_terminal_v1"),
    prerequisiteTerminal.indexOf("GRANT SELECT,INSERT,UPDATE ON TABLE"),
  );
  assert.match(prerequisiteRecord, /IF p_terminal_state='completed' THEN/u);
  assert.match(prerequisiteRecord, /INSERT INTO public\.ai_media_asset_ingest_jobs/u);
  assert.match(prerequisiteRecord, /RETURN QUERY SELECT 'applied'::text,new_event,new_ingest/u);
  assert.match(prerequisiteRecord, /stage=CASE WHEN p_terminal_state='completed' THEN 'artifact_ingest_queued' ELSE 'failed' END/u);

  for (const sql of [forward, terminalRecord]) {
    assert.doesNotMatch(
      sql,
      /\b(?:dblink|http_get|http_post|curl|wget|lo_import)\s*\(|\bCOPY\s+PROGRAM\b|\bnet\.http_/iu,
    );
    assert.doesNotMatch(sql, /\b(?:fetch|download|publish|deploy|provider_submit)\s*\(/iu);
  }
});

test("grants are minimal and rollback refuses to erase exact reconciliation or terminal evidence", () => {
  assert.match(forward, /GRANT USAGE ON SCHEMA ai_media_worker_api TO ai_media_one_video_run_executor;/u);
  assert.equal(
    (forward.match(/GRANT EXECUTE ON FUNCTION ai_media_worker_api\./gu) ?? []).length,
    exposedFunctionNames.length,
  );
  assert.doesNotMatch(forward, /GRANT (?:SELECT|INSERT|UPDATE|DELETE|TRUNCATE|REFERENCES|TRIGGER) ON (?:TABLE|ALL TABLES)/u);
  assert.doesNotMatch(forward, /GRANT EXECUTE[\s\S]*? TO (?:PUBLIC|ai_media_admitted_(?:submit|reconcile)_executor)/u);
  assert.doesNotMatch(
    forward,
    /GRANT EXECUTE ON FUNCTION ai_media_worker_api\.require_exact_one_video_reconcile_context_v1/u,
  );

  assert.match(rollback, /rollback preserves exact one-video reconciliation and terminal evidence/u);
  assert.match(rollback, /fence\.action='reconcile_submission'/u);
  assert.match(rollback, /attempt\.reconciliation_fencing_token>0/u);
  assert.match(rollback, /attempt\.state IN \('confirmed','reconciled_no_submit'\)/u);
  assert.match(rollback, /fence\.action='observe_terminal'/u);
  assert.match(rollback, /JOIN public\.ai_media_provider_terminal_checks terminal_check/u);
  for (const binding of [
    "attempt.owner_user_id=fence.owner_user_id",
    "attempt.workspace_id=fence.workspace_id",
    "attempt.budget_reservation_id=fence.budget_reservation_id",
    "attempt.render_job_id=fence.render_job_id",
    "attempt.daily_plan_slot_id=fence.daily_plan_slot_id",
    "attempt.slot_attempt=fence.slot_attempt",
    "attempt.work_handoff_digest=fence.work_handoff_digest",
  ]) {
    assert.match(rollback, new RegExp(binding.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"), "u"));
  }
  for (const name of functionNames) {
    assert.match(rollback, new RegExp(`DROP FUNCTION ai_media_worker_api\\.${name}\\(`, "u"));
  }
  assert.doesNotMatch(rollback, /\b(?:DELETE FROM|TRUNCATE|DROP TABLE)\b/iu);
});
