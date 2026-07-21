import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const forward=readFileSync(new URL("../migrations/ai-media-studio/20260721_pr27_heygen_terminal_forward.sql",import.meta.url),"utf8");
const rollback=readFileSync(new URL("../migrations/ai-media-studio/20260721_pr27_heygen_terminal_rollback.sql",import.meta.url),"utf8");
const compact=(value:string)=>value.replace(/\s+/gu," ");

test("PR27 terminal polling is leased, fenced, capability-only, and table-blind",()=>{
  assert.match(forward,/CREATE TABLE public\.ai_media_provider_terminal_checks/u);
  for(const token of ["lease_token uuid","lease_owner text","lease_expires_at timestamptz","fencing_token bigint","claim_count integer"])
    assert.match(forward,new RegExp(token,"u"));
  assert.match(forward,/claim_terminal_check_v1[\s\S]*FOR UPDATE OF a,capacity SKIP LOCKED/u);
  assert.match(forward,/terminal_check\.lease_token=p_lease_token[\s\S]*terminal_check\.fencing_token=p_terminal_check_fencing[\s\S]*lease_expires_at>sampled_at/u);
  assert.match(forward,/require_terminal_capability_v1[\s\S]*require_capability_v1[\s\S]*has_table_privilege\(SESSION_USER/u);
  assert.match(compact(forward),/REVOKE ALL ON TABLE public\.ai_media_provider_terminal_checks,public\.ai_media_provider_terminal_events, public\.ai_media_asset_ingest_jobs FROM PUBLIC,ai_media_admitted_submit_executor,ai_media_admitted_reconcile_executor;/u);
});

test("terminal evidence binds exact tenant, account, credential, job, authorization, and attempt",()=>{
  assert.match(forward,/CREATE TABLE public\.ai_media_provider_terminal_events/u);
  assert.match(forward,/provider terminal evidence is append-only/u);
  for(const binding of ["owner_user_id","workspace_id","submission_attempt_id","budget_reservation_id",
    "provider_account_id","provider_key","provider_credential_version","provider_job_id","send_authorization_digest"])
    assert.match(forward,new RegExp(binding,"u"));
  assert.match(forward,/ai_media_provider_submission_attempts_terminal_identity_uq/u);
  assert.match(forward,/REFERENCES public\.ai_media_provider_submission_attempts\(owner_user_id,workspace_id,id,budget_reservation_id,[\s\S]*provider_job_id,send_authorization_digest\)/u);
  assert.match(forward,/attempt\.provider_account_id=p_provider_account_id[\s\S]*attempt\.provider_key=p_provider_key[\s\S]*attempt\.provider_credential_version=p_provider_credential_version[\s\S]*attempt\.provider_job_id=p_provider_job_id/u);
});

test("recording terminal evidence distinguishes replay, conflict, and rejected input",()=>{
  const record=forward.slice(forward.indexOf("CREATE FUNCTION ai_media_worker_api.record_provider_terminal_v1"),
    forward.indexOf("GRANT SELECT,INSERT,UPDATE ON TABLE"));
  assert.match(record,/SELECT 'replayed'::text,existing\.id,new_ingest/u);
  assert.match(record,/CASE WHEN FOUND THEN 'conflict' ELSE 'rejected' END/u);
  assert.match(record,/RETURN QUERY SELECT 'applied'::text,new_event,new_ingest/u);
  assert.match(record,/provider_evidence_digest=p_provider_evidence_digest/u);
  assert.match(record,/remote_artifact_ref IS NOT DISTINCT FROM p_remote_artifact_ref/u);
});

test("event, capacity release, terminal projections, and completed ingest share one transaction",()=>{
  const record=forward.slice(forward.indexOf("CREATE FUNCTION ai_media_worker_api.record_provider_terminal_v1"),
    forward.indexOf("GRANT SELECT,INSERT,UPDATE ON TABLE"));
  const event=record.indexOf("INSERT INTO public.ai_media_provider_terminal_events");
  const capacity=record.indexOf("UPDATE public.ai_media_submission_capacity_leases");
  const ingest=record.indexOf("INSERT INTO public.ai_media_asset_ingest_jobs");
  assert.ok(event>=0&&capacity>event&&ingest>capacity);
  assert.match(record,/terminal capacity release must affect exactly one row/u);
  assert.match(record,/IF p_terminal_state='completed' THEN[\s\S]*remote_artifact_ref,remote_url,expected_mime_type/u);
  assert.match(record,/p_terminal_state='failed'[\s\S]*p_remote_artifact_ref IS NOT NULL OR p_remote_url IS NOT NULL/u);
  assert.match(record,/expected_mime_type[\s\S]*'video\/mp4'/u);
  assert.doesNotMatch(record,/budget_buckets|committed_micro_usd|reserved_micro_usd|settled_amount_micro_usd/u);
});

test("owned ingest has exact composite render identity and private HTTPS source constraints",()=>{
  assert.match(forward,/ai_media_asset_ingest_jobs_exact_render_fk[\s\S]*FOREIGN KEY\(owner_user_id,workspace_id,render_job_id\)[\s\S]*REFERENCES public\.ai_media_render_jobs\(owner_user_id,workspace_id,id\)/u);
  assert.match(forward,/remote_url ~ '\^https:\/\//u);
  assert.doesNotMatch(forward,/public_url/u);
});

test("rollback removes executable mutation surface but preserves all evidence and ingest data",()=>{
  assert.match(rollback,/terminal evidence is never deleted/u);
  assert.match(rollback,/REVOKE EXECUTE ON FUNCTION/u);
  assert.match(rollback,/DROP FUNCTION ai_media_worker_api\.record_provider_terminal_v1/u);
  assert.match(rollback,/Keep terminal checks\/events, append-only guards, exact FKs, ingest rows, and terminal columns/u);
  assert.doesNotMatch(rollback,/DROP TABLE|DROP COLUMN|DELETE FROM|TRUNCATE|DROP CONSTRAINT ai_media_asset_ingest_jobs_exact_render_fk/iu);
});
