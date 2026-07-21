import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const forward=readFileSync(new URL("../migrations/ai-media-studio/20260721_pr26_db_capability_forward.sql",import.meta.url),"utf8");
const rollback=readFileSync(new URL("../migrations/ai-media-studio/20260721_pr26_db_capability_rollback.sql",import.meta.url),"utf8");
const compact=(value:string)=>value.replace(/\s+/gu," ");

const submitFunctions=["claim_admitted_v1","authorize_admitted_v1","record_submit_confirmed_v1",
  "record_submit_ambiguous_v1","expire_authorized_v1"] as const;
const reconcileFunctions=["claim_reconciliation_v1","release_reconciliation_unknown_v1",
  "record_reconciled_confirmed_v1","finalize_reconciled_no_submit_v1","release_terminal_capacity_v1"] as const;

test("PR26 fails closed unless three distinct safe precreated roles and exact PR25 exist",()=>{
  for(const role of ["ai_media_admitted_fn_owner","ai_media_admitted_submit_executor","ai_media_admitted_reconcile_executor"])
    assert.match(forward,new RegExp(`'${role}'`,"u"));
  assert.match(forward,/role_row\.rolcanlogin OR role_row\.rolsuper OR role_row\.rolinherit[\s\S]*rolbypassrls/u);
  assert.match(forward,/executor roles must have no owner or cross-lane membership/u);
  assert.match(forward,/server_version_num[\s\S]*160000/u);
  assert.match(forward,/to_regclass\('public\.ai_media_provider_submission_attempts'\)/u);
  assert.match(forward,/to_regprocedure\('public\.digest\(bytea,text\)'\)/u);
  assert.match(forward,/pg_extension[\s\S]*dependency\.deptype='e'[\s\S]*extension_row\.extname='pgcrypto'/u);
  assert.doesNotMatch(forward,/CREATE ROLE|ALTER ROLE/iu);
});

test("capability is bound to session principal, exact tenant, lane, operation, timezone and ceilings",()=>{
  for(const column of ["database_principal name","owner_user_id text","workspace_id text","lane text",
    "accounting_time_zone text","worker_id text","allowed_operations text[]","max_lease_ms integer",
    "max_batch_size integer","valid_from timestamptz","expires_at timestamptz","revoked_at timestamptz"])
    assert.match(forward,new RegExp(column.replace(/[\[\]]/gu,"\\$&"),"u"));
  const helper=forward.slice(forward.indexOf("CREATE FUNCTION ai_media_worker_api.require_capability_v1"),
    forward.indexOf("CREATE FUNCTION ai_media_worker_api.sha256_text_v1"));
  assert.match(helper,/database_principal=SESSION_USER::name/u);
  assert.match(helper,/owner_user_id=p_owner_user_id AND c\.workspace_id=p_workspace_id AND c\.lane=p_lane/u);
  assert.match(helper,/p_operation=ANY\(c\.allowed_operations\)/u);
  assert.match(helper,/revoked_at IS NULL[\s\S]*valid_from<=sampled_at[\s\S]*expires_at>sampled_at/u);
  assert.match(helper,/p_lease_ms>cap\.max_lease_ms/u);
  assert.match(helper,/p_batch_size>cap\.max_batch_size/u);
  assert.match(helper,/has_table_privilege\(SESSION_USER,protected_table,'SELECT'\)[\s\S]*'TRIGGER'/u);
  assert.doesNotMatch(helper,/current_setting\([^)]*app\./iu,"caller-controlled GUCs are not authority");
});

test("all worker entrypoints are security definer, fixed-path and use values rather than identifiers",()=>{
  for(const name of [...submitFunctions,...reconcileFunctions]){
    const start=forward.indexOf(`CREATE FUNCTION ai_media_worker_api.${name}`);
    assert.notEqual(start,-1,`missing ${name}`);
    const body=forward.slice(start,forward.indexOf("$function$;",start)+11);
    assert.match(body,/SECURITY DEFINER SET search_path=pg_catalog SET row_security=on/u,`${name} path`);
    assert.match(body,/p_owner_user_id text,p_workspace_id text/u,`${name} exact tenant inputs`);
  }
  assert.doesNotMatch(forward,/\bEXECUTE\s+(?:format|p_)|quote_ident|to_regclass\(p_|regclass\s*\)/iu);
  assert.match(forward,/REVOKE ALL ON ALL FUNCTIONS IN SCHEMA ai_media_worker_api FROM PUBLIC/u);
  assert.match(forward,/REVOKE CREATE ON SCHEMA public FROM PUBLIC/u);
});

test("submit and reconcile have disjoint execute grants and executors have zero table privileges",()=>{
  const normalized=compact(forward);
  const grantStart=normalized.lastIndexOf("GRANT EXECUTE ON FUNCTION");
  const grants=normalized.slice(normalized.lastIndexOf("GRANT EXECUTE ON FUNCTION",grantStart-1));
  const [submitStatement,reconcileStatement=""]=grants.split(" TO ai_media_admitted_submit_executor;");
  const submitGrant=submitStatement.replace(/^GRANT EXECUTE ON FUNCTION /u,"");
  const reconcileGrant=reconcileStatement.replace(/^ GRANT EXECUTE ON FUNCTION /u,"")
    .replace(/ TO ai_media_admitted_reconcile_executor;.*$/u,"");
  for(const name of submitFunctions){assert.match(submitGrant,new RegExp(name,"u"));assert.doesNotMatch(reconcileGrant,new RegExp(name,"u"));}
  for(const name of reconcileFunctions){assert.match(reconcileGrant,new RegExp(name,"u"));assert.doesNotMatch(submitGrant,new RegExp(name,"u"));}
  assert.match(normalized,/REVOKE ALL ON TABLE .* FROM PUBLIC,ai_media_admitted_submit_executor,ai_media_admitted_reconcile_executor;/u);
  assert.doesNotMatch(submitGrant,/require_capability|finish_outcome|sha256|guard/u);
  assert.doesNotMatch(reconcileGrant,/require_capability|finish_outcome|sha256|guard/u);
  assert.match(forward,/ALTER FUNCTION public\.ai_media_assert_pr25_consistency\(\) SECURITY DEFINER/u);
  assert.match(forward,/ALTER FUNCTION public\.ai_media_assert_pr25_consistency\(\) SET search_path=pg_catalog/u);
  assert.match(forward,/ALTER FUNCTION public\.ai_media_assert_pr25_consistency\(\) OWNER TO ai_media_admitted_fn_owner/u);
  assert.match(forward,/REVOKE ALL ON FUNCTION public\.ai_media_assert_pr25_consistency\(\) FROM PUBLIC/u);
});

test("claim, expiration and reconciliation cannot escape exact owner plus workspace",()=>{
  const claim=forward.slice(forward.indexOf("CREATE FUNCTION ai_media_worker_api.claim_admitted_v1"),
    forward.indexOf("CREATE FUNCTION ai_media_worker_api.assert_capacity_consistency_v1"));
  assert.match(claim,/job\.owner_user_id=p_owner_user_id AND job\.workspace_id=p_workspace_id/u);
  const expire=forward.slice(forward.indexOf("CREATE FUNCTION ai_media_worker_api.expire_authorized_v1"),
    forward.indexOf("CREATE FUNCTION ai_media_worker_api.claim_reconciliation_v1"));
  assert.match(expire,/a\.owner_user_id=p_owner_user_id AND a\.workspace_id=p_workspace_id/u);
  const reconcile=forward.slice(forward.indexOf("CREATE FUNCTION ai_media_worker_api.claim_reconciliation_v1"),
    forward.indexOf("CREATE FUNCTION ai_media_worker_api.release_reconciliation_unknown_v1"));
  assert.match(reconcile,/a\.owner_user_id=p_owner_user_id AND a\.workspace_id=p_workspace_id/u);
  assert.match(reconcile,/job\.owner_user_id=p_owner_user_id AND job\.workspace_id=p_workspace_id/u);
});

test("active concurrency is durable capacity, not permanent committed-money state",()=>{
  assert.match(forward,/CREATE TABLE public\.ai_media_submission_capacity_leases/u);
  assert.match(forward,/state IN \('held','released'\)/u);
  assert.match(forward,/capacity can only release exactly once/u);
  const authorize=forward.slice(forward.indexOf("CREATE FUNCTION ai_media_worker_api.authorize_admitted_v1"),
    forward.indexOf("CREATE FUNCTION ai_media_worker_api.claim_admitted_v1"));
  assert.match(authorize,/active\.state='reserved' AND active\.expires_at>sampled_at/u);
  assert.match(authorize,/active\.state='committed' AND EXISTS[\s\S]*capacity\.state='held'/u);
  assert.match(authorize,/active_total>gate\.total_concurrency[\s\S]*active_provider>gate\.provider_concurrency[\s\S]*active_tenant>gate\.tenant_concurrency/u);
  assert.match(authorize,/INSERT INTO public\.ai_media_submission_capacity_leases[\s\S]*'held'/u);
  const terminal=forward.slice(forward.indexOf("CREATE FUNCTION ai_media_worker_api.release_terminal_capacity_v1"),
    forward.indexOf("CREATE FUNCTION ai_media_worker_api.authorize_admitted_v1"));
  assert.match(terminal,/a\.state='confirmed'[\s\S]*a\.provider_job_id=p_provider_job_id/u);
  assert.match(terminal,/release_kind='provider_terminal'/u);
  assert.doesNotMatch(terminal,/committed_micro_usd/u,"provider terminal frees capacity but retains committed money");
});

test("no-submit finality binds every provider identity and refunds exactly once",()=>{
  const noSubmit=forward.slice(forward.indexOf("CREATE FUNCTION ai_media_worker_api.finalize_reconciled_no_submit_v1"),
    forward.indexOf("CREATE FUNCTION ai_media_worker_api.release_terminal_capacity_v1"));
  for(const binding of ["provider_account_id","provider_key","provider_credential_version","provider_idempotency_key",
    "reconciliation_lease_token","reconciliation_fencing_token","send_authorization_digest"])
    assert.match(noSubmit,new RegExp(binding,"u"));
  assert.match(noSubmit,/linearizable_not_accepted_and_cannot_later_accept/u);
  const finish=forward.slice(forward.indexOf("CREATE FUNCTION ai_media_worker_api.finish_outcome_v1"),
    forward.indexOf("CREATE FUNCTION ai_media_worker_api.record_submit_confirmed_v1"));
  assert.match(finish,/no-submit capacity release must affect exactly one row/u);
  assert.match(finish,/no-submit budget refund must affect exactly one row/u);
  assert.match(finish,/committed_micro_usd=committed_micro_usd-current_row\.amount_micro_usd/u);
});

test("rollback is evidence-preserving and never restores direct table access",()=>{
  assert.match(rollback,/EXISTS \(SELECT 1 FROM public\.ai_media_admitted_worker_capabilities LIMIT 1\)/u);
  assert.match(rollback,/EXISTS \(SELECT 1 FROM public\.ai_media_submission_capacity_leases LIMIT 1\)/u);
  assert.match(rollback,/otherwise forward-fix/u);
  assert.match(rollback,/REVOKE EXECUTE ON FUNCTION/u);
  assert.match(rollback,/REVOKE INSERT,UPDATE ON TABLE/u);
  assert.match(rollback,/Deliberately retain REVOKE CREATE ON SCHEMA public FROM PUBLIC/u);
  assert.doesNotMatch(rollback,/\bGRANT\b|DROP OWNED|REASSIGN OWNED|DELETE FROM|TRUNCATE/iu);
});
