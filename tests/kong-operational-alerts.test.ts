import test from "node:test";
import assert from "node:assert/strict";
import { emptyState } from "../server/kong-autopilot-core";
import { auditKongCalendar } from "../server/kong-calendar-audit";
import { operationalIssues,recordOperationalNotice,type OperationalState } from "../server/kong-operational-alerts";
const now=new Date("2026-11-04T13:00:00Z");
test("coverage notices inspect seven complete future days and preserve unknown coverage",async()=>{
  const state=emptyState();
  state.calendarAudit=await auditKongCalendar({now,jobs:[],userId:"test",token:"test",verifiedNetworks:["tiktok","facebook"]},async()=>new Response(JSON.stringify({data:[]})));
  const issues=operationalIssues({state,startupBlockers:[],blockers:[],now});
  assert.equal(issues.length,14);assert.equal(issues[0].day,"2026-11-05");assert.equal(issues.at(-1)?.day,"2026-11-11");
  assert.equal(issues.reduce((n,x)=>n+(x.count||0),0),70);
  state.calendarAudit.days[1].networks.tiktok.missing=null;
  assert.equal(operationalIssues({state,startupBlockers:[],blockers:[],now})[0].code,"calendar_unverified");
  assert.deepEqual(operationalIssues({state,startupBlockers:[],blockers:[],now:new Date(+now+3600_000)}),[{code:"calendar_unverified"}]);
});
test("incident transitions persist first, notify once, then send a recovery",async()=>{
  let persisted:OperationalState|undefined,calls=0;
  const deps={save:async(s:OperationalState)=>{persisted=s;},notify:async()=>{assert.equal(persisted?.notices.at(-1)?.delivery,"sending");calls++;return true;}};
  let state=await recordOperationalNotice(undefined,[{code:"configuration",count:2}],now,deps);
  assert.equal(calls,1);assert.equal(state.notices[0].delivery,"sent");
  state=await recordOperationalNotice(state,[{code:"configuration",count:2}],new Date(+now+900_000),deps);
  assert.equal(calls,1);assert.equal(state.notices.length,1);
  state=await recordOperationalNotice(state,[],new Date(+now+1800_000),deps);
  assert.equal(calls,2);assert.equal(state.notices.at(-1)?.kind,"recovered");assert.equal(state.activeFingerprint,null);
});
test("failed delivery retries are bounded and persistence failure prevents sending",async()=>{
  let calls=0;const deps={save:async()=>{},notify:async()=>{calls++;return false;}};
  let state=await recordOperationalNotice(undefined,[{code:"production"}],now,deps);
  assert.equal(state.notices[0].delivery,"failed");
  state=await recordOperationalNotice(state,[{code:"production"}],new Date(+now+3600_000),deps);assert.equal(calls,1);
  state=await recordOperationalNotice(state,[{code:"production"}],new Date(+now+6*3600_000),deps);assert.equal(calls,2);
  await assert.rejects(()=>recordOperationalNotice(undefined,[{code:"production"}],now,{save:async()=>{throw Error("db");},notify:async()=>{throw Error("must_not_send");}}),/db/);
});
test("missing notification configuration remains pending and can deliver after restart",async()=>{
  let state=await recordOperationalNotice(undefined,[{code:"learning"}],now,{save:async()=>{}});
  assert.equal(state.notices[0].delivery,"pending");
  state=await recordOperationalNotice(state,[{code:"learning"}],now,{save:async()=>{},notify:async()=>true});
  assert.equal(state.notices[0].delivery,"sent");
});
test("midnight audit cannot skip the seventh future date or claim zero known missing",async()=>{
  const yesterday=new Date("2026-11-05T04:30:00Z"),afterMidnight=new Date("2026-11-05T05:10:00Z"),state=emptyState();
  state.calendarAudit=await auditKongCalendar({now:yesterday,jobs:[],userId:"test",token:"test",verifiedNetworks:["tiktok","facebook"]},async()=>new Response(JSON.stringify({data:[]})));
  const issues=operationalIssues({state,startupBlockers:[],blockers:[],now:afterMidnight});
  assert.equal(issues[0].day,"2026-11-06");assert.equal(issues.at(-1)?.day,"2026-11-12");
  state.calendarAudit.days=state.calendarAudit.days.filter(d=>d.day!=="2026-11-12");
  const incomplete=operationalIssues({state,startupBlockers:[],blockers:[],now:afterMidnight});
  assert.ok(incomplete.some(i=>i.code==="calendar_unverified"&&i.day==="2026-11-12"));
  const notice=await recordOperationalNotice(undefined,incomplete,afterMidnight,{save:async()=>{}});
  assert.match(notice.notices[0].message,/no se pudo verificar/);
});
test("a hanging notification cannot hold the worker cycle forever",async()=>{
  const state=await recordOperationalNotice(undefined,[{code:"cycle_failed"}],now,{save:async()=>{},notify:()=>new Promise(()=>{}),notificationTimeoutMs:5});
  assert.equal(state.notices[0].delivery,"failed");assert.match(state.notices[0].message,/falló la ejecución/);
});
