import test from "node:test";
import assert from "node:assert/strict";
import {createAgentCouncil,CouncilStateConflict} from "../server/agent-council";
import {emptyCouncilState} from "../shared/agent-council";
import {advanceCompany,advanceAcademy,enrollTrainee} from "../shared/agent-company";
import {createRoleAcademyRunner} from "../server/office-role-academy";
test("reviewer reservation respects a concurrently persisted role academy lease",{timeout:10000},async()=>{
 const now=Date.parse("2026-11-06T12:00:00Z"),initial=emptyCouncilState(),modules=[{id:"rules",title:"Rules",summary:"Evidence"}];
 initial.company=advanceCompany(initial.company,{now:now-86400000,roles:{code:"Code","claude-reviewer":"Reviewer"},statuses:{code:{state:"available",label:"idle"},"claude-reviewer":{state:"available",label:"idle"}}}).state;
 initial.company=enrollTrainee(initial.company,{id:"review-candidate",forAgentId:"claude-reviewer",role:"Reviewer",now:now-86400000});initial.company=advanceAcademy(initial.company,()=>modules,now);
 let raw=JSON.stringify(initial),serial=Promise.resolve(),reviewCalls=0;let began!:()=>void,release!:()=>void;
 const started=new Promise<void>(resolve=>began=resolve),pending=new Promise<void>(resolve=>release=resolve);
 const council=createAgentCouncil({now:()=>now,userId:()=>"owner",readState:async()=>raw,writeState:async()=>{},transactState:async(change)=>{let out="";const done=serial.then(async()=>{out=await change(raw);raw=out;});serial=done.catch(()=>{});await done;return out;},collect:async()=>({}),submitProposal:async()=>"",getPendingActionStatus:async()=>null,fetchLatestRelease:async()=>null,log:()=>{},loadCurriculum:async()=>modules,academyReview:async()=>{reviewCalls++;throw Error("must not start");}});
 const roles=createRoleAcademyRunner({council,now:()=>now,dailyPairs:14,run:async()=>{began();await pending;throw Error("interrupted fixture");}});
 const running=roles.tick();await started;await council.runAcademyCycle();assert.equal(reviewCalls,0);assert.equal((await council.load()).company.academyJobs?.length || 0,0);release();await running;assert.equal((await council.load()).officeExecution!.roleAcademy!.jobs[0].status,"unknown");
});


test("reviewer CAS retry clears the losing reservation when a role evaluation wins", {timeout:10000}, async()=>{
 const now=Date.parse("2026-11-06T12:00:00Z"), initial=emptyCouncilState(), modules=[{id:"rules",title:"Rules",summary:"Evidence"}];
 initial.company=advanceCompany(initial.company,{now:now-86400000,roles:{code:"Code","claude-reviewer":"Reviewer"},statuses:{code:{state:"available",label:"idle"},"claude-reviewer":{state:"available",label:"idle"}}}).state;
 initial.company=enrollTrainee(initial.company,{id:"review-candidate",forAgentId:"claude-reviewer",role:"Reviewer",now:now-86400000});
 initial.company=advanceAcademy(initial.company,()=>modules,now);
 let raw=JSON.stringify(initial), roleRaw=raw, revision=0, writes=0, reviewCalls=0;
 let began!:()=>void, release!:()=>void;
 const started=new Promise<void>(resolve=>began=resolve), pending=new Promise<void>(resolve=>release=resolve);
 const common={now:()=>now,userId:()=>"owner",readState:async()=>raw,writeState:async()=>{},collect:async()=>({}),submitProposal:async()=>"",getPendingActionStatus:async()=>null,fetchLatestRelease:async()=>null,log:()=>{},loadCurriculum:async()=>modules};
 const competing=createAgentCouncil({...common,transactState:async change=>{roleRaw=await change(roleRaw);return roleRaw;}});
 const roles=createRoleAcademyRunner({council:competing,now:()=>now,dailyPairs:14,run:async()=>{began();await pending;throw Error("fixture interrupted");}});
 const roleRun=roles.tick();await started;
 const council=createAgentCouncil({...common,versioned:{read:async()=>({raw,revision}),write:async(next,expected)=>{
   writes++;
   if(writes===1){assert.ok(JSON.parse(next).company.academyJobs.some((j:any)=>j.status==="running"),"first attempt genuinely reserved a reviewer task");raw=roleRaw;revision++;throw new CouncilStateConflict("concurrent role reservation won");}
   if(expected!==revision)throw new CouncilStateConflict("revision mismatch");raw=next;return ++revision;
 }},academyReview:async()=>{reviewCalls++;throw Error("unreserved provider call forbidden");}});
 try{await council.runAcademyCycle();assert.ok(writes>=2);assert.equal(reviewCalls,0);assert.equal((await council.load()).company.academyJobs?.length || 0,0);assert.equal((await council.load()).officeExecution!.roleAcademy!.jobs[0].status,"running");}
 finally{release();await roleRun;}
});
