import test from "node:test";
import assert from "node:assert/strict";
import { emptyCouncilState, parseCouncilState } from "../shared/agent-council";
import { KONG_INVITATION_AGENT_ID as ID, KONG_INVITATION_OWNER, kongInvitationReceiptSchema, kongInvitationStatus, type KongInvitationReceipt } from "../shared/kong-invitation-agent";
import { applyKongInvitationReceipt } from "../server/kong-invitation-receipts";
import { buildKongOfficeWing } from "../client/src/lib/kong-office-wing";
import { vitalityGroup, vitalityView } from "../shared/agent-vitality";
import { buildAgentChatDirectory } from "../shared/agent-chat-directory";
import { advanceKongCareers } from "../server/kong-company";
import type { OfficeKongAuditResult } from "../server/office-kong";
const now=Date.parse("2026-11-26T08:00:00Z");
const iso=(offset=0)=>new Date(now+offset).toISOString();
const receipt=(patch:Partial<KongInvitationReceipt>={}):KongInvitationReceipt=>({version:1,ownerId:KONG_INVITATION_OWNER,scopeId:"kong-dj-invitations",scriptId:"1sPDzL7uZvToeNr9phm8xD5YrZ5x1EBZMp5Bn-jG4igwY8F01cVKd0_kh",senderAccount:"kongnightlifeapp@gmail.com",sequence:1,previousReceiptSha256:null,runId:"manual-fixture-1",observedAt:iso(),startedAt:iso(-1000),completedAt:iso(),provenance:"manual",sourceSha256:"23c2b33e18227f49bb70aeadc93d1d250241e101af112b2eb2169abdb1fa340c",installedCodeSha256:"a".repeat(64),evidenceSha256:"b".repeat(64),reviewed:10,pending:10,excluded:0,admitted:0,sent:0,gmailReceiptSha256s:[],senderExecution:"none",senderPaused:true,cursor:50,fence:7,revision:4,scheduler:"active",blocker:"validation-pending",...patch});

test("registers one KONG company career and scores a distinct deliverable once",()=>{
 const input=receipt(); const first=applyKongInvitationReceipt(emptyCouncilState(),input,now);
 assert.equal(first.company.careers[ID].points,10);
 assert.equal(first.company.careers[ID].battery,86);
 assert.equal(first.company.careers[ID].vitality?.lastVerifiedWorkAt,iso());
 assert.strictEqual(applyKongInvitationReceipt(first,input,now),first);
 const next=receipt({sequence:2,previousReceiptSha256:first.kongInvitations!.sha256,runId:"manual-fixture-2",startedAt:iso(),evidenceSha256:input.evidenceSha256});
 const repeated=applyKongInvitationReceipt(first,next,now);
 assert.equal(repeated.company.careers[ID].points,10,"same manifest cannot earn twice even with a new report");
 assert.equal(repeated.kongInvitationHistory?.length,2);
 assert.deepEqual(parseCouncilState(JSON.stringify(repeated)).kongInvitations,repeated.kongInvitations);
});

test("a heartbeat or hash-only check is not completed work",()=>{
 const state=applyKongInvitationReceipt(emptyCouncilState(),receipt({reviewed:0,pending:0}),now);
 assert.equal(state.company.careers[ID].points,0);
 assert.equal(state.company.careers[ID].cyclesWorking,0);
 assert.equal(state.company.careers[ID].vitality?.lastVerifiedWorkAt,undefined);
});

test("rejects incorrect binding, extra personal content, excessive selection and invalid timing",()=>{
 for(const patch of [{ownerId:"other"},{sourceSha256:"a".repeat(64)},{reviewed:11},{recipient:"private@example.test"},{completedAt:iso(1000)}]){
  assert.equal(kongInvitationReceiptSchema.safeParse({...receipt(),...patch}).success,false);
 }
 assert.throws(()=>applyKongInvitationReceipt(emptyCouncilState(),receipt({observedAt:iso(1000),completedAt:iso(1000)}),now),/STALE/);
});

test("admission/manual execution never proves sent; exact distinct original-clock receipts required",()=>{
 assert.equal(kongInvitationReceiptSchema.safeParse(receipt({admitted:1})).success,true);
 assert.equal(kongInvitationReceiptSchema.safeParse(receipt({sent:1})).success,false);
 assert.equal(kongInvitationReceiptSchema.safeParse(receipt({sent:1,senderExecution:"original-time-driven",gmailReceiptSha256s:["c".repeat(64)]})).success,false,"paused clock cannot send");
 assert.equal(kongInvitationReceiptSchema.safeParse(receipt({sent:1,senderExecution:"original-time-driven",senderPaused:false,gmailReceiptSha256s:["c".repeat(64)]})).success,true);
 assert.equal(kongInvitationReceiptSchema.safeParse(receipt({sent:2,senderExecution:"original-time-driven",senderPaused:false,gmailReceiptSha256s:["c".repeat(64),"c".repeat(64)]})).success,false);
});

test("append chain fences overwrite, regression and changed retry",()=>{
 const first=applyKongInvitationReceipt(emptyCouncilState(),receipt(),now);
 assert.throws(()=>applyKongInvitationReceipt(first,receipt({evidenceSha256:"c".repeat(64)}),now),/CONFLICT/);
 const next=receipt({sequence:2,previousReceiptSha256:first.kongInvitations!.sha256,runId:"manual-fixture-2",startedAt:iso()});
 for(const patch of [{previousReceiptSha256:null},{cursor:49},{fence:6},{revision:3},{runId:"manual-fixture-1"},{startedAt:iso(-500)}])assert.throws(()=>applyKongInvitationReceipt(first,{...next,...patch},now),/CONFLICT|REGRESSION/);
});

test("desk, directory and factory life share one identity without claiming execution",()=>{
 const state=applyKongInvitationReceipt(emptyCouncilState(),receipt(),now);
 const wing=buildKongOfficeWing(undefined,[],{},now,undefined,false,state.kongInvitations);
 const desk=wing.agents.find(x=>x.id===ID)!;
 assert.equal(desk.status.state,"needs-setup"); assert.notEqual(desk.status.state,"working");
 assert.ok(wing.departments.find(x=>x.id==="kong-growth")?.agentIds.includes(ID));
 assert.equal(buildAgentChatDirectory(state).filter(x=>x.id===ID).length,1);
 assert.equal(vitalityGroup(ID),"KONG");
 assert.equal(vitalityView(state.company,{now,names:{[ID]:"Invitaciones a DJs"}}).filter(x=>x.agentId===ID).length,1);
 assert.equal(kongInvitationStatus(state.kongInvitations,now+3*3600000).state,"offline");
 assert.equal(kongInvitationStatus(undefined,now).state,"needs-setup");
});

test("an old completed result cannot be relabeled as a fresh observation",()=>{
 assert.throws(()=>applyKongInvitationReceipt(emptyCouncilState(),receipt({startedAt:iso(-4*3600000),completedAt:iso(-3*3600000)}),now),/STALE/);
});

test("a Gmail send receipt can never be counted in a later run",()=>{
 const original=receipt({reviewed:0,pending:0,sent:1,senderPaused:false,senderExecution:"original-time-driven",gmailReceiptSha256s:["c".repeat(64)]});
 const first=applyKongInvitationReceipt(emptyCouncilState(),original,now);
 assert.throws(()=>applyKongInvitationReceipt(first,{...original,sequence:2,previousReceiptSha256:first.kongInvitations!.sha256,runId:"later-run",startedAt:iso(),evidenceSha256:"d".repeat(64)},now),/DUPLICATE_SEND/);
});

test("importing an external receipt leaves every other agent career and life byte-identical",()=>{
 const state=emptyCouncilState();
 const sample=applyKongInvitationReceipt(emptyCouncilState(),receipt(),now).company.careers[ID];
 for(const id of ["radio","kong:customer_operations","kong-city:miami:events"]){
  state.company.careers[id]={...structuredClone(sample),agentId:id,hiredAt:iso(-30*86400000),lastEvaluatedAt:iso(-20*86400000),vitality:{anchorAt:iso(-20*86400000),lastTickAt:iso(-30*60000),missesApplied:0,creditedIds:[],holdReason:"original hold"}};
 }
 const before=JSON.stringify(state.company.careers);
 const after=applyKongInvitationReceipt(state,receipt(),now);
 assert.equal(JSON.stringify(Object.fromEntries(Object.entries(after.company.careers).filter(([id])=>id!==ID))),before);
});

test("a generic KONG desk claim neither duplicates nor scores the external coordinator",()=>{
 const source:OfficeKongAuditResult["evidence"]={generatedAt:iso(),citySnapshotCheckedAt:iso(),cityAgentsEnabled:true,cityCoverageComplete:false,
  agents:[{id:"dj_invitations",name:"Unqualified generic claim",kind:"system",owner:"KONG",responsibility:"Generic",state:"healthy",lastRunAt:iso(),nextRunAt:iso(3600000),blocker:null,nextAction:"none",issues:[]}],
  cities:[{id:"miami",name:"Miami",countryCode:"US",timeZone:"America/New_York",currency:"USD",status:"healthy",categories:[]}]};
 const advanced=advanceKongCareers({company:emptyCouncilState().company,evidenceAt:{},evidence:source,now});
 assert.ok(advanced.observedAt,"the snapshot itself was fresh and verified");
 assert.equal(advanced.company.careers[ID],undefined);
 assert.equal(buildKongOfficeWing(source,[],{},now).agents.filter(x=>x.id===ID).length,1);
});
