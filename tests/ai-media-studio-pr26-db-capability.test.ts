import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import {
  DrizzleAdmittedRenderRepository,
  type AdmittedRenderTransactionalDatabase,
} from "../server/ai-media-studio/workers/drizzle-admitted-render-repository";

const ids={submitCapability:"10000000-0000-4000-8000-000000000001",reconcileCapability:"10000000-0000-4000-8000-000000000002",
  attempt:"10000000-0000-4000-8000-000000000003",reservation:"10000000-0000-4000-8000-000000000004",
  render:"10000000-0000-4000-8000-000000000005",account:"10000000-0000-4000-8000-000000000006",
  lease:"10000000-0000-4000-8000-000000000007"} as const;
const digest=(character:string)=>`sha256:${character.repeat(64)}` as const;
const dialect=new PgDialect();

class FunctionDatabase implements AdmittedRenderTransactionalDatabase {
  readonly calls:{sql:string;params:unknown[]}[]=[];
  transactionCalls=0;
  constructor(private readonly response:(sql:string)=>Record<string,unknown>|undefined=()=>undefined){}
  async execute(query:SQL){const rendered=dialect.sqlToQuery(query);const normalized=rendered.sql.replace(/\s+/gu," ").trim();
    this.calls.push({sql:normalized,params:rendered.params});const row=this.response(normalized);return{rows:row?[row]:[]};}
  async transaction<T>(callback:(tx:FunctionDatabase)=>Promise<T>):Promise<T>{this.transactionCalls+=1;return callback(this);}
}

function claimRow(){return{id:ids.attempt,owner_user_id:"owner-a",workspace_id:"personal",budget_reservation_id:ids.reservation,
  render_job_id:ids.render,provider_account_id:ids.account,provider_key:"heygen",provider_credential_version:1,
  provider_idempotency_key:"admit:exact-provider-key",avatar_external_resource_id:"avatar",voice_external_resource_id:"voice",
  request_json:{script:"hello"},sealed_request_digest:digest("a"),fencing_token:"1",lease_token:ids.lease,
  lease_expires_at:new Date("2026-07-21T20:00:00.000Z")};}
function repository(submit=new FunctionDatabase(),reconcile=new FunctionDatabase()){return{submit,reconcile,repository:new DrizzleAdmittedRenderRepository(
  {submit,reconcile},{scope:{ownerUserId:"owner-a",workspaceId:"personal"},submitCapabilityId:ids.submitCapability,
    reconcileCapabilityId:ids.reconcileCapability})};}

test("PR26 repository is function-only and has no admitted table DML",()=>{
  const source=readFileSync(new URL("../server/ai-media-studio/workers/drizzle-admitted-render-repository.ts",import.meta.url),"utf8");
  assert.doesNotMatch(source,/\b(?:INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+ai_media_/iu);
  assert.doesNotMatch(source,/\bFROM\s+ai_media_(?:render_jobs|budget_reservations|provider_submission_attempts)/iu);
  assert.doesNotMatch(source,/sql\.raw/iu);
  for(const routine of ["claim_admitted_v1","authorize_admitted_v1","record_submit_confirmed_v1",
    "record_submit_ambiguous_v1","expire_authorized_v1","claim_reconciliation_v1",
    "release_reconciliation_unknown_v1","record_reconciled_confirmed_v1","finalize_reconciled_no_submit_v1"])
    assert.match(source,new RegExp(`ai_media_worker_api\\.${routine}\\(`,"u"));
});

test("claim sends exact owner and workspace through the submit capability lane",async()=>{
  const submit=new FunctionDatabase(sql=>sql.includes("claim_admitted_v1")?claimRow():undefined);
  const harness=repository(submit);
  const claim=await harness.repository.claim({workerId:"submit-pool-a",leaseDurationMs:60_000});
  assert.ok(claim);assert.deepEqual(claim.scope,{ownerUserId:"owner-a",workspaceId:"personal"});
  assert.equal(submit.transactionCalls,1);assert.equal(harness.reconcile.calls.length,0);
  assert.match(submit.calls[0].sql,/^SELECT \* FROM ai_media_worker_api\.claim_admitted_v1\(/u);
  for(const value of [ids.submitCapability,"owner-a","personal","submit-pool-a",60_000])assert.ok(submit.calls[0].params.includes(value));
});

test("same workspace under another owner is rejected before authorize SQL",async()=>{
  const harness=repository();
  const result=await harness.repository.authorize({...claimRowToDomain(),scope:{ownerUserId:"owner-b",workspaceId:"personal"}});
  assert.equal(result,undefined);assert.equal(harness.submit.calls.length,0);
});

test("submit and reconciliation operations cannot cross database lanes",async()=>{
  const submit=new FunctionDatabase(sql=>sql.includes("record_submit_ambiguous_v1")?{applied:true}:undefined);
  const reconcile=new FunctionDatabase(sql=>sql.includes("release_reconciliation_unknown_v1")?{applied:true}:undefined);
  const harness=repository(submit,reconcile),authorization={...claimRowToDomain(),authorizationDigest:digest("b"),
    commitEvidenceDigest:digest("c"),authorizedAt:"2026-07-21T19:00:00.000Z"};
  assert.equal(await harness.repository.markAmbiguous({...authorization,evidenceDigest:digest("d")}),true);
  assert.equal(await harness.repository.releaseUnknownReconciliation({...authorization,
    reconciliationLeaseToken:"10000000-0000-4000-8000-000000000008",reconciliationLeaseOwner:"db-role:reconcile",
    reconciliationFencingToken:1n}),true);
  assert.match(submit.calls[0].sql,/record_submit_ambiguous_v1/u);
  assert.match(reconcile.calls[0].sql,/release_reconciliation_unknown_v1/u);
  assert.ok(submit.calls[0].params.includes(ids.submitCapability));
  assert.ok(reconcile.calls[0].params.includes(ids.reconcileCapability));
});

test("commit-time failure is propagated and no authorization escapes",async()=>{
  class CommitFailureDatabase extends FunctionDatabase {override async transaction<T>(callback:(tx:FunctionDatabase)=>Promise<T>):Promise<T>{
    await callback(this);throw new Error("deferred consistency failed at COMMIT");}}
  const submit=new CommitFailureDatabase(sql=>sql.includes("claim_admitted_v1")?claimRow():undefined);
  const harness=repository(submit);
  await assert.rejects(harness.repository.claim({workerId:"submit-pool-a",leaseDurationMs:60_000}),/COMMIT/u);
});

function claimRowToDomain(){return{id:ids.attempt,scope:{ownerUserId:"owner-a",workspaceId:"personal"},budgetReservationId:ids.reservation,
  renderJobId:ids.render,providerAccountId:ids.account,providerKey:"heygen",providerCredentialVersion:1,
  providerIdempotencyKey:"admit:exact-provider-key",avatarExternalResourceId:"avatar",voiceExternalResourceId:"voice",
  sealedRequest:{script:"hello"},sealedRequestDigest:digest("a"),fencingToken:1n,leaseToken:ids.lease,
  leaseExpiresAt:"2026-07-21T20:00:00.000Z"};}
