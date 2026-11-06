import test from "node:test";
import assert from "node:assert/strict";
import {runRadioTrainingTrial,validateRadioTrainingEvidence,qualifyRadioIncumbent,radioImplementationVersion,resolveSavedRadioPolicy} from "../server/office-radio-training";
import {advanceCompany,emptyCompanyState} from "../shared/agent-company";
import {emptyRoleLifecycleState,reconcileRoleLifecycles} from "../shared/office-role-lifecycle";
const NOW=Date.parse("2026-11-06T20:00:00Z");
function fixture(){
 const company=advanceCompany(emptyCompanyState(),{now:NOW-1000,roles:{radio:"Radio"},statuses:{radio:{state:"working",label:"fixture",evidenceId:"setup"}}}).state;
 const roles=reconcileRoleLifecycles(emptyRoleLifecycleState(),company,NOW);const role=roles.roles.radio;
 role.status="active";role.activePolicy={version:"baseline:radio:1",candidateId:"baseline",generation:1,guidance:[],curriculumVersion:"baseline",createdAt:new Date(NOW-1000).toISOString()};
 return {roles,company};
}
test("real parser trial retains independently reproducible grades and measured duration",()=>{
 const evidence=runRadioTrainingTrial();assert.equal(validateRadioTrainingEvidence(evidence),true);assert.equal(evidence.apiCalls,0);
 assert.ok(evidence.timings.every(t=>t.baselineDurationMs>=0 && t.candidateDurationMs>=0));
 const forged=structuredClone(evidence);forged.evaluation.artifacts[0].candidateQuality=99;assert.equal(validateRadioTrainingEvidence(forged),false);
});
test("qualified parser updates only incumbent skill with three real assessments, keeping identity and generation",()=>{
 const {roles,company}=fixture(),before=company.careers.radio;
 const result=qualifyRadioIncumbent(roles,company,runRadioTrainingTrial(),NOW,"trial1");assert.ok(result.receipt);
 assert.equal(result.company.careers.radio.generation,before.generation);assert.equal(result.company.careers.radio.nickname,before.nickname);
 assert.equal(result.roles.roles.radio.status,"active");assert.equal(result.roles.roles.radio.policyHistory.length,1);
 const trainee=result.company.trainees.find(t=>t.id===result.receipt!.traineeId)!;assert.equal(trainee.purpose,"incumbent");assert.equal(trainee.assessments?.length,3);
 assert.equal(radioImplementationVersion(result.roles.roles.radio.activePolicy!.version,1),"radio-slots-range-v1");
 assert.equal(qualifyRadioIncumbent(result.roles,result.company,runRadioTrainingTrial(),NOW+1,"trial2").receipt,undefined);
});
test("vacant, probationary, generation-changed or uncertain holders never enter incumbent training gate",()=>{
 for(const status of ["vacant","probation","unsupported"] as const){const f=fixture();f.roles.roles.radio.status=status;assert.equal(qualifyRadioIncumbent(f.roles,f.company,runRadioTrainingTrial(),NOW,"trial").receipt,undefined);}
 const changed=fixture();changed.company.careers.radio.generation=2;assert.equal(qualifyRadioIncumbent(changed.roles,changed.company,runRadioTrainingTrial(),NOW,"trial").receipt,undefined);
 const uncertain=fixture();uncertain.roles.roles.radio.leases.push({executionId:"old",fence:"old",policyVersion:"baseline:radio:1",generation:1,status:"unknown",startedAt:new Date(NOW-1000).toISOString(),expiresAt:new Date(NOW).toISOString()});
 assert.equal(qualifyRadioIncumbent(uncertain.roles,uncertain.company,runRadioTrainingTrial(),NOW,"trial").receipt,undefined);
 assert.throws(()=>radioImplementationVersion("invented",1));
});
test("slow, missing or nonfinite timing evidence cannot qualify an installed policy",()=>{
 let time=0;const slow=runRadioTrainingTrial(()=>time+=1001);assert.equal(validateRadioTrainingEvidence(slow),false);
 const missing=runRadioTrainingTrial();missing.timings.pop();assert.equal(validateRadioTrainingEvidence(missing),false);
 const invalid=runRadioTrainingTrial();invalid.timings[0].candidateDurationMs=NaN;assert.equal(validateRadioTrainingEvidence(invalid),false);
 let backwards=100;assert.equal(validateRadioTrainingEvidence(runRadioTrainingTrial(()=>--backwards)),false);
 for(const malformed of [null,{},undefined,{...invalid,timings:[null]}])assert.equal(validateRadioTrainingEvidence(malformed),false);
});
test("normal Radio reader consumes saved qualified policy only for owner and refuses unknown/vacant state",async()=>{
 const f=fixture(),qualified=qualifyRadioIncumbent(f.roles,f.company,runRadioTrainingTrial(),NOW,"trial");let reads=0;
 const deps={owner:()=>"owner",read:async()=>{reads++;return {officeExecution:{roles:qualified.roles,tokens:{reservations:[]},internalWork:{version:1 as const,jobs:[],radioTrainingHistory:[qualified.receipt!]}}};}};
 assert.equal(await resolveSavedRadioPolicy("other",deps),"radio-slots-baseline-v1");assert.equal(reads,0);
 assert.equal(await resolveSavedRadioPolicy("owner",deps),"radio-slots-range-v1");assert.equal(reads,1);
 await assert.rejects(()=>resolveSavedRadioPolicy("owner",{owner:()=>"owner",read:async()=>({officeExecution:{roles:qualified.roles,tokens:{reservations:[]}}})}),/receipt/);
 qualified.roles.roles.radio.status="vacant";await assert.rejects(()=>resolveSavedRadioPolicy("owner",deps));
 await assert.rejects(()=>resolveSavedRadioPolicy("owner",{owner:()=>"owner",read:async()=>{throw new Error("DB unavailable");}}));
});
