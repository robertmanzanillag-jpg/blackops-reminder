import assert from "node:assert/strict";
import test from "node:test";
import type { Sha256Digest } from "../server/ai-media-studio/planning/contracts";
import { AdmittedRenderWorker } from "../server/ai-media-studio/workers/admitted-render-worker";
import type {
  AdmittedProviderResolver, AdmittedRenderRepository, AdmittedSendAuthorization,
  AdmittedSubmissionClaim, ExactAdmittedProviderCapability,
} from "../server/ai-media-studio/workers/admitted-render-contracts";

const digest=(c:string)=>`sha256:${c.repeat(64)}` as Sha256Digest;
const claim:AdmittedSubmissionClaim={id:"10000000-0000-4000-8000-000000000001",scope:{ownerUserId:"owner",workspaceId:"workspace"},
  budgetReservationId:"10000000-0000-4000-8000-000000000002",renderJobId:"10000000-0000-4000-8000-000000000003",
  providerAccountId:"10000000-0000-4000-8000-000000000004",providerKey:"heygen",providerCredentialVersion:3,
  providerIdempotencyKey:"admit:persisted-exact-key",avatarExternalResourceId:"avatar-external",
  voiceExternalResourceId:"voice-external",sealedRequest:{script:"hello"},sealedRequestDigest:digest("1"),
  fencingToken:1n,leaseToken:"10000000-0000-4000-8000-000000000005",leaseExpiresAt:"2026-07-21T20:00:00.000Z"};
const authorization:AdmittedSendAuthorization={...claim,authorizationDigest:digest("2"),commitEvidenceDigest:digest("3"),authorizedAt:"2026-07-21T19:00:00.000Z"};

function repository(overrides:Partial<AdmittedRenderRepository>={}):AdmittedRenderRepository{return{
  claim:async()=>claim,authorize:async()=>authorization,confirm:async()=>true,markAmbiguous:async()=>true,
  markReconciledNoSubmit:async()=>true,expireAuthorizedLeases:async()=>0,claimAmbiguous:async()=>undefined,
  releaseUnknownReconciliation:async()=>true,...overrides};}
function resolver(submit:()=>Promise<never>):AdmittedProviderResolver{return{async resolve(input){return{
  capability:{scope:input.scope,providerAccountId:input.providerAccountId,providerKey:input.providerKey,
    providerCredentialVersion:input.providerCredentialVersion,authorizationDigest:input.authorizationDigest} as unknown as ExactAdmittedProviderCapability,
  provider:{submit,reconcile:async()=>({kind:"unknown"})},
};}};}

test("transport uncertainty is persisted ambiguous and is never auto-retried",async()=>{
  let submissions=0,ambiguous=0,durableState:"queued"|"ambiguous"="queued";
  const durableRepository=repository({claim:async()=>durableState==='queued'?claim:undefined,
    markAmbiguous:async()=>{ambiguous+=1;durableState="ambiguous";return true;}});
  const durableResolver=resolver(async()=>{submissions+=1;throw new Error("timeout");});
  const worker=new AdmittedRenderWorker({workerId:"worker-1",leaseDurationMs:60_000,
    repository:durableRepository,providerResolver:durableResolver});
  assert.deepEqual(await worker.runNext(),{outcome:"ambiguous",attemptId:claim.id});
  const restartedWorker=new AdmittedRenderWorker({workerId:"worker-2",leaseDurationMs:60_000,
    repository:durableRepository,providerResolver:durableResolver});
  assert.deepEqual(await restartedWorker.runNext(),{outcome:"idle"});
  assert.equal(submissions,1);assert.equal(ambiguous,1);
});

test("a lost terminal CAS never reports confirmed",async()=>{
  const worker=new AdmittedRenderWorker({workerId:"worker-1",leaseDurationMs:60_000,
    repository:repository({confirm:async()=>false}),providerResolver:{async resolve(input){return{
      capability:{scope:input.scope,providerAccountId:input.providerAccountId,providerKey:input.providerKey,
        providerCredentialVersion:input.providerCredentialVersion,authorizationDigest:input.authorizationDigest} as unknown as ExactAdmittedProviderCapability,
      provider:{submit:async()=>({kind:"confirmed",providerJobId:"provider-job",evidenceDigest:digest("4")}),reconcile:async()=>({kind:"unknown"})}};}}});
  assert.deepEqual(await worker.runNext(),{outcome:"authorization_lost",attemptId:claim.id});
});

test("a mismatched provider capability fails before I/O and becomes ambiguous",async()=>{
  let networkCalls=0;
  const worker=new AdmittedRenderWorker({workerId:"worker-1",leaseDurationMs:60_000,
    repository:repository(),providerResolver:{async resolve(input){return{
      capability:{scope:input.scope,providerAccountId:input.providerAccountId,providerKey:input.providerKey,
        providerCredentialVersion:999,authorizationDigest:input.authorizationDigest} as unknown as ExactAdmittedProviderCapability,
      provider:{submit:async()=>{networkCalls+=1;throw new Error();},reconcile:async()=>({kind:"unknown"})}};}}});
  assert.equal((await worker.runNext()).outcome,"ambiguous");assert.equal(networkCalls,0);
});

test("a delayed submit cannot be refunded from eventual absence without negative finality",async()=>{
  let refunds=0,leaseReleases=0;
  const reconciliation={...authorization,reconciliationLeaseToken:"10000000-0000-4000-8000-000000000006",
    reconciliationLeaseOwner:"worker-1",reconciliationFencingToken:1n};
  const worker=new AdmittedRenderWorker({workerId:"worker-1",leaseDurationMs:60_000,
    repository:repository({claim:async()=>undefined,claimAmbiguous:async()=>reconciliation,
      markReconciledNoSubmit:async()=>{refunds+=1;return true;},
      releaseUnknownReconciliation:async()=>{leaseReleases+=1;return true;}}),
    providerResolver:{async resolve(input){return{
      capability:{scope:input.scope,providerAccountId:input.providerAccountId,providerKey:input.providerKey,
        providerCredentialVersion:input.providerCredentialVersion,authorizationDigest:input.authorizationDigest} as unknown as ExactAdmittedProviderCapability,
      provider:{submit:async()=>{throw new Error("still in flight");},reconcile:async()=>({kind:"unknown"})}};}}});
  assert.deepEqual(await worker.reconcileNext(),{outcome:"ambiguous",attemptId:claim.id});
  assert.equal(refunds,0,"eventual absence must not release committed budget");
  assert.equal(leaseReleases,1,"only the reconciliation lease is released");
});
