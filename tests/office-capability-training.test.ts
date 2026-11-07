import test from "node:test";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {createCapabilityTrainer,parseCapabilityTraining,capabilityTrainingSummary,prepareCapabilityCancellation,applyCapabilityCancellation,type CapabilityTrainingState} from "../server/office-capability-training";
import {auditSavedRole} from "../server/office-role-audits";
import {sourceDigest as digest,PENDING_OFFICE_ROLES,type PendingOfficeRole} from "../server/office-role-snapshots";
import {parseRoleWork,type RoleWorkJob,type RoleWorkState} from "../server/office-role-work";
const NOW=Date.parse("2026-11-07T01:00:00Z"),owner="owner";
function realJob(at:number):RoleWorkJob{
 const sourceBody={version:1 as const,role:"control" as const,ownerKey:digest(owner),observedAt:new Date(at).toISOString(),total:1,rows:[{id:"permission1",scope:"publish",level:"autonomous",risk:"high",enabled:true}]},source={...sourceBody,sourceDigest:digest(sourceBody)};
 const audit=auditSavedRole("control",source,owner,at),job:RoleWorkJob={id:randomUUID(),fence:randomUUID(),role:"control",generation:1,slot:new Date(at).toISOString().slice(0,10),startedAt:new Date(at).toISOString(),expiresAt:new Date(at+60000).toISOString(),completedAt:new Date(at).toISOString(),status:"completed",source,audit};
 job.artifactId=digest({id:job.id,role:job.role,generation:1,fence:job.fence,source,audit});return job;
}
const reorder=(v:any):any=>Array.isArray(v)?v.map(reorder):v&&typeof v==="object"?Object.fromEntries(Object.keys(v).reverse().map(k=>[k,reorder(v[k])])):v;
function fixture(mode:"improve"|"tie"|"costfail"|"late"|"regress"|"expensive"|"changed_during"|"pause"|"unadmitted"="improve"){
 let busy=false,stopped=false; let clock=NOW,state:CapabilityTrainingState=parseCapabilityTraining(undefined,owner),calls=0;const generations:Record<string,number>={control:1};let work:RoleWorkState={version:1,ownerKey:digest(owner),jobs:[realJob(NOW)]};const requests=new Map<string,any>();
 const trainer=createCapabilityTrainer({owner,maxCallsPerDay:2,now:()=>clock,shouldStop:()=>stopped,loadWork:async()=>parseRoleWork(work,owner),transact:async(change)=>{const next=change(structuredClone(state),generations,busy);state=parseCapabilityTraining(reorder(next),owner);return structuredClone(state);},run:async(raw,call)=>{
  calls++;const prompt=JSON.parse(raw),task=prompt.source,trained=prompt.lessons.length>0,holdout=task.id.startsWith("source-triage-holdout");
  if(mode==="unadmitted"&&holdout)throw Error("not admitted");
  if(mode==="pause"&&holdout&&!trained)stopped=true;
  assert.ok(!("expected" in prompt));assert.ok(prompt.lessons.every((l:string)=>!l.includes("heldout:")));
  const sourceIssue=task.issueCodes.some((c:string)=>["SOURCE_MISSING","SOURCE_STALE"].includes(c));let decision=task.sourceBlocked||sourceIssue?"review_source":task.issueCodes.length?"review_findings":"record_audit";
  if(!trained && holdout && mode!=="tie")decision=decision==="record_audit"?"review_source":"record_audit";
  const text=(!trained&&!holdout)||(trained&&!holdout&&mode==="regress")?"{}":JSON.stringify({scope:"source-triage-v1",evidenceIds:task.evidenceIds,issueCodes:task.issueCodes,decision});
  if(mode==="changed_during")generations.control=2;
  clock+=mode==="late"?360000:trained?1:2;
  const result={text,sessionId:`resp_${calls}`,provider:"openai" as const,model:"same-model",completedAt:new Date(clock).toISOString(),usage:{inputTokens:10,outputTokens:5,totalTokens:15}};requests.set(call.executionId,{result,trained});return result;
 },verifyCost:async request=>{if(mode==="costfail")throw Error("unpriced");return {receiptId:`ledger:${request.responseId}`,executionId:request.executionId,responseId:request.responseId,model:request.model,usage:request.usage,currency:"USD",usd:requests.get(request.executionId).trained?(mode==="expensive"?0.003:0.001):0.002};}});
 return {trainer,setBusy:(v:boolean)=>{busy=v;},seed:(s:CapabilityTrainingState)=>{state=parseCapabilityTraining(s,owner);},state:()=>state,calls:()=>calls,setTime:(v:number)=>{clock=v;},generations,addJob:(at:number)=>{work={...work,jobs:[...work.jobs,realJob(at)]};}};
}
test("real incumbent errors generate bounded lessons; separate priced holdouts apply only narrow policy on next real task",async()=>{
 const f=fixture();await Promise.all([f.trainer.tick(),f.trainer.tick()]);assert.equal(f.calls(),1);let state=f.state();assert.equal(state.runs[0].kind,"production");assert.equal(state.policies.length,2);assert.deepEqual(state.policies.find(p=>p.status==="candidate")!.lessons,["invalid_output"]);
 for(let day=1;day<=3;day++){f.setTime(NOW+day*86400000);await f.trainer.tick();}
 state=f.state();assert.equal(state.runs.filter(r=>r.kind==="holdout").length,3);assert.equal(state.policies.find(p=>p.parentVersion!==null)!.status,"probation");
 const next=NOW+4*86400000;f.setTime(next);f.addJob(next);await f.trainer.tick();state=f.state();const active=state.policies.find(p=>p.parentVersion!==null)!;assert.equal(active.status,"active");assert.equal(state.runs.at(-1)!.policyVersion,active.version);assert.equal(state.runs.at(-1)!.kind,"production");assert.equal(state.runs.at(-1)!.generation,1);
 assert.ok(capabilityTrainingSummary(state,owner).every(s=>s.fullRolePromotion===false));assert.doesNotThrow(()=>parseCapabilityTraining(reorder(state),owner));
 const corrupt=structuredClone(state);corrupt.runs[0].trained!.cost.usd=999;assert.throws(()=>parseCapabilityTraining(corrupt,owner));
});
test("equal held-out quality is rejected without policy activation",async()=>{
 const f=fixture("tie");await f.trainer.tick();for(let day=1;day<=3;day++){f.setTime(NOW+day*86400000);await f.trainer.tick();}assert.equal(f.state().policies.find(p=>p.parentVersion!==null)!.status,"rejected");assert.equal(capabilityTrainingSummary(f.state(),owner).some(s=>s.comparisonQualified),false);
});
test("missing independent cost or late completion is unknown and never retried",async()=>{
 for(const mode of ["costfail","late"] as const){const f=fixture(mode);await f.trainer.tick();assert.equal(f.state().runs[0].status,"unknown");f.setTime(NOW+2*86400000);await f.trainer.tick();assert.equal(f.calls(),1);assert.ok(f.state().runs[0].unverifiedResult);}
});
test("changed holder cannot consume old-generation production audit or training budget",async()=>{
 const f=fixture();f.generations.control=2;await f.trainer.tick();assert.equal(f.calls(),0);assert.equal(f.state().runs.length,0);
});
test("higher measured cost prevents qualification and a failed first real application restores the parent policy",async()=>{
 for(const mode of ["expensive","regress"] as const){const f=fixture(mode);await f.trainer.tick();for(let day=1;day<=3;day++){f.setTime(NOW+day*86400000);await f.trainer.tick();}
  if(mode==="expensive"){assert.equal(f.state().policies.find(p=>p.parentVersion!==null)!.status,"rejected");continue;}
  const next=NOW+4*86400000;f.setTime(next);f.addJob(next);await f.trainer.tick();assert.equal(f.state().policies.find(p=>p.parentVersion!==null)!.status,"rejected");assert.equal(f.state().policies.find(p=>p.parentVersion===null)!.status,"active");
 }
});
test("holder changed during provider invocation cannot receive completion, and forged activation fails closed",async()=>{
 const f=fixture("changed_during");await f.trainer.tick();assert.equal(f.state().runs[0].status,"unknown");
 const training=fixture();await training.trainer.tick();const forged=structuredClone(training.state());forged.policies.find(p=>p.status==="candidate")!.status="active";assert.throws(()=>parseCapabilityTraining(forged,owner),/UNQUALIFIED/);
 const lessons=structuredClone(training.state());lessons.policies.find(p=>p.status==="candidate")!.lessons=["decision_mismatch"];assert.throws(()=>parseCapabilityTraining(lessons,owner));
});

test("shared academy admission and policy capacity fail closed without poisoning durable history",async()=>{
 const busy=fixture();busy.setBusy(true);await busy.trainer.tick();assert.equal(busy.calls(),0);busy.setBusy(false);await busy.trainer.tick();assert.equal(busy.calls(),1);
 const f=fixture();const state=parseCapabilityTraining(undefined,owner);for(let generation=2;generation<=100;generation++){const body={role:"control" as const,generation,parentVersion:null,lessons:[],trainingRunId:null};state.policies.push({...body,version:digest({capability:"source-triage-v1",...body}),status:"active"});}f.seed(state);await f.trainer.tick();assert.equal(f.calls(),1);assert.equal(f.state().policies.length,100);assert.equal(f.state().runs[0].status,"completed");assert.equal(f.state().policies.some(p=>p.status==="candidate"),false);parseCapabilityTraining(f.state(),owner);
});

test("all 14 current holders receive their first real audit before any candidate consumes paired calls",async()=>{
 let clock=NOW,calls=0,state=parseCapabilityTraining(undefined,owner);const generations=Object.fromEntries(PENDING_OFFICE_ROLES.map(role=>[role,1]));
 const job=(role:PendingOfficeRole,generation:number):RoleWorkJob=>{const audit=auditSavedRole(role,undefined,owner,clock),value:RoleWorkJob={id:randomUUID(),fence:randomUUID(),role,generation,slot:new Date(clock).toISOString().slice(0,10),startedAt:new Date(clock).toISOString(),expiresAt:new Date(clock+60000).toISOString(),completedAt:new Date(clock).toISOString(),status:"blocked",audit};value.artifactId=digest({id:value.id,role,generation,fence:value.fence,audit});return value;};
 let work:RoleWorkState={version:1,ownerKey:digest(owner),jobs:PENDING_OFFICE_ROLES.map(role=>job(role,1))};
 const make=()=>createCapabilityTrainer({owner,maxCallsPerDay:14,now:()=>clock,loadWork:async()=>parseRoleWork(work,owner),transact:async(change)=>{state=parseCapabilityTraining(reorder(change(structuredClone(state),generations)),owner);return structuredClone(state);},run:async()=>{calls++;clock++;return {text:"{}",provider:"openai",model:"same-model",sessionId:`resp_fair_${calls}`,completedAt:new Date(clock).toISOString(),usage:{inputTokens:1,outputTokens:1,totalTokens:2}};},verifyCost:async request=>({...request,receiptId:`verified:${request.responseId}`,currency:"USD",usd:0.001})});
 for(let i=0;i<14;i++){await Promise.all([make().tick(),make().tick()]);assert.equal(calls,i+1);assert.equal(state.runs.every(r=>r.kind==="production"),true);}
 assert.equal(new Set(state.runs.map(r=>r.role)).size,14);assert.equal(state.policies.filter(p=>p.status==="candidate").length,14);const history=structuredClone(state.runs);
 await make().tick();assert.equal(calls,14);assert.deepEqual(state.runs,history);
 // Once all holders have a baseline, resume the existing paired schedule.
 clock=NOW+86400001;await make().tick();assert.equal(calls,16);assert.equal(state.runs.at(-1)!.kind,"holdout");
 // An unseen replacement generation gets its own baseline before old holdouts.
 const role=PENDING_OFFICE_ROLES[0];generations[role]=2;work={...work,jobs:[...work.jobs,job(role,2)]};await make().tick();assert.equal(calls,17);assert.equal(state.runs.at(-1)!.kind,"production");assert.equal(state.runs.at(-1)!.role,role);assert.equal(state.runs.at(-1)!.generation,2);assert.deepEqual(state.runs.slice(0,14),history);
});

test("cooperative pause after baseline drains the reserved pair and forbids new work",async()=>{
 const f=fixture("pause");await f.trainer.tick();f.setTime(NOW+86400000);await f.trainer.tick();assert.equal(f.calls(),3);assert.equal(f.state().runs.at(-1)!.status,"completed");assert.ok(f.state().runs.at(-1)!.baseline);assert.ok(f.state().runs.at(-1)!.trained);f.setTime(NOW+2*86400000);await f.trainer.tick();assert.equal(f.calls(),3);
});
test("operator cancellation preserves zero-admission unknown history and rejects its candidate without retry",async()=>{
 const f=fixture("unadmitted");await f.trainer.tick();f.setTime(NOW+86400000);await f.trainer.tick();const before=structuredClone(f.state()),run=before.runs.at(-1)!;assert.equal(run.status,"unknown");assert.equal(run.baseline,undefined);assert.equal(run.unverifiedResult,undefined);
 const now=NOW+86400100,verify=async(request:any)=>({...request,verifiedAt:new Date(now).toISOString(),baselineNeverAdmitted:true as const,trainedNeverAdmitted:true as const,runtimeDrained:true as const,ledgerEvidenceId:"operator-locked-ledger-query",ledgerSnapshotSha256:"e".repeat(64)});
 const options={raw:before,owner,runId:run.id,fence:run.fence,operatorAuditId:"cancel-zero-1",now,verify};
 await assert.rejects(()=>prepareCapabilityCancellation({...options,verify:async request=>({...await verify(request),trainedNeverAdmitted:false as any})}));
 const approval=await prepareCapabilityCancellation(options),after=applyCapabilityCancellation(before,owner,approval,now);assert.equal(after.runs.length,before.runs.length);assert.equal(after.runs.at(-1)!.status,"cancelled");assert.equal(after.runs.at(-1)!.reason,run.reason);assert.equal(after.policies.find(p=>p.version===run.policyVersion)!.status,"rejected");assert.equal(after.policies.find(p=>p.version===run.baselineVersion)!.status,"active");assert.doesNotThrow(()=>parseCapabilityTraining(reorder(after),owner));
 assert.throws(()=>applyCapabilityCancellation(after,owner,approval,now));assert.throws(()=>applyCapabilityCancellation(before,owner,{...approval,fence:randomUUID()},now));assert.throws(()=>applyCapabilityCancellation(before,owner,approval,now+60001));
 const forged=structuredClone(after);forged.runs.at(-1)!.cancellation!.trainedExecutionId="different";assert.throws(()=>parseCapabilityTraining(forged,owner));
 f.seed(after);f.setTime(NOW+2*86400000);await f.trainer.tick();assert.equal(f.calls(),2);assert.equal(f.state().runs.length,2);
 const paid=fixture("late");await paid.trainer.tick();const uncertain=paid.state().runs[0];await assert.rejects(()=>prepareCapabilityCancellation({...options,raw:paid.state(),runId:uncertain.id,fence:uncertain.fence}));
});
