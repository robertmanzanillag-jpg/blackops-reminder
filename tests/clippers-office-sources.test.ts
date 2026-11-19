import test from "node:test";
import assert from "node:assert/strict";
import {mkdtemp,mkdir,readdir,writeFile,rm} from "node:fs/promises";
import path from "node:path";
import {tmpdir} from "node:os";

// End to end: the real Clippers producers (daily plan + automation cycle) and
// the real office web-source reader/audit, in an isolated workspace. The
// producers resolve clippers_workspace from process.cwd() at import time.
const root=await mkdtemp(path.join(tmpdir(),"clippers-office-sources-"));
const previousCwd=process.cwd();process.chdir(root);
process.env.DEFAULT_USER_ID="owner";delete process.env.OFFICE_SOURCE_DOCUMENTS_ENABLED;
const clippers=await import("../server/clippers-agent");
const {readWebRoleSources,auditWebRoleSource}=await import("../server/office-web-role-sources");
const {prepareOfficeSourceDocument,ForeignOfficeSourceDocumentError,projectOfficeSourceDocument}=await import("../server/office-source-documents");
test.after(async()=>{process.chdir(previousCwd);assert.ok(path.resolve(root).startsWith(path.resolve(tmpdir())+path.sep));await rm(root,{recursive:true,force:true});});
const pool={query:async(sql:string,args?:unknown[])=>({rows:sql.includes("FROM users")?[{id:args![0]}]:[]})};
const reportsDir=path.join(root,"clippers_workspace/reports");
const clippersSource=async()=>(await readWebRoleSources({pool,owner:"owner",configuredOwner:"owner",root})).find(s=>s.role==="clippers")!;

test("a normal Clippers run is auditable: metrics summary is written with the cycle and the role is not blocked",async()=>{
 await clippers.runClipperDailyPlan({},"owner");
 await clippers.runClipperAutomationCycle({},"owner");
 const source=await clippersSource();
 assert.deepEqual(source.provenance.map(p=>`${p.kind}:${p.status}`).sort(),["clip_metrics:present","clip_reports:present","clip_reports:present"]);
 // No analytics exports exist: the summary is an honest empty source, never invented numbers.
 const metrics=source.provenance.find(p=>p.kind==="clip_metrics")!;assert.equal(metrics.records,0);assert.equal(metrics.empty,true);assert.equal(metrics.sourceAt,null);
 assert.equal(source.rows.filter(r=>r.kind==="clip_metric").length,0);assert.ok(source.diagnostics.includes("SOURCE_TIME_UNKNOWN"));
 assert.ok(!source.diagnostics.includes("SOURCE_MISSING"));assert.ok(!source.diagnostics.includes("SOURCE_INVALID"));
 const audit=auditWebRoleSource(source,"owner",Date.parse(source.observedAt));assert.equal(audit.status,"completed");
 assert.ok(audit.diagnostics.includes("PLANS_NOT_EXECUTION"));assert.ok(audit.diagnostics.includes("COLLECTED_METRICS_ONLY"));
});

test("artifacts of the Clippers workers and other users' reports do not invalidate the owner's report folder",async()=>{
 for(const name of ["metricool-autopilot-queue.json","metricool-autopilot-ledger.json","metricool-public-media-receipts.json","metricool-publication-reconciliation.json","streamer-growth-ceo.json","youtube-upload-ledger.json","campaign-draft-renderer.json"])await writeFile(path.join(reportsDir,name),JSON.stringify([{private:"PRIVATE"}]));
 await clippers.runClipperDailyPlan({},"someone-else");
 const source=await clippersSource();
 assert.ok(!source.diagnostics.includes("SOURCE_INVALID"));assert.ok(!JSON.stringify(source).includes("PRIVATE"));
 // The foreign plan is skipped, not exported: the owner's two reports remain.
 assert.equal(source.provenance.filter(p=>p.kind==="clip_reports").length,2);assert.equal(source.rows.filter(r=>r.kind==="clip_plan").length,1);
 assert.equal(auditWebRoleSource(source,"owner",Date.parse(source.observedAt)).status,"completed");
 // An unknown artifact still marks the folder invalid (contract drift stays visible).
 await writeFile(path.join(reportsDir,"unexpected-contract.json"),"{}");
 const drift=await clippersSource();assert.ok(drift.diagnostics.includes("SOURCE_INVALID"));assert.equal(auditWebRoleSource(drift,"owner",Date.parse(drift.observedAt)).status,"blocked");
 await rm(path.join(reportsDir,"unexpected-contract.json"));
});

test("only other users' reports is an empty owner source; malformed foreign-looking reports stay invalid",async()=>{
 const other=await mkdtemp(path.join(tmpdir(),"clippers-office-foreign-"));
 try{
  const dir=path.join(other,"clippers_workspace/reports");await mkdir(dir,{recursive:true});
  const id="2026-11-19T00-00-00-000Z",at=new Date().toISOString();
  await writeFile(path.join(dir,`${id}.json`),JSON.stringify({id,userId:"someone-else",createdAt:at,publishMode:"draft_only",plannedClips:[]}));
  const read=async()=>(await readWebRoleSources({pool,owner:"owner",configuredOwner:"owner",root:other})).find(s=>s.role==="clippers")!;
  const only=(await read()).provenance.filter(p=>p.kind==="clip_reports");assert.deepEqual(only.map(p=>[p.status,p.empty]),[["present",true]]);
  await writeFile(path.join(dir,`${id}.json`),JSON.stringify({id,userId:"someone-else",createdAt:at,publishMode:"draft_only"}));
  assert.ok((await read()).provenance.some(p=>p.kind==="clip_reports"&&p.status==="invalid"));
  assert.throws(()=>projectOfficeSourceDocument("clip_report",{id,userId:"x",createdAt:at,publishMode:"draft_only",plannedClips:[]},{owner:"owner",key:`${id}.json`}),ForeignOfficeSourceDocumentError);
 }finally{await rm(other,{recursive:true,force:true});}
});

test("platform analytics exports with date-only or local publish dates become real metric rows, not invalid evidence",async()=>{
 await writeFile(path.join(root,"clippers_workspace/metrics/tiktok-export.csv"),"account,platform,clip_id,published_at,views,likes,comments,shares,saves\nsports,tiktok,clip-1,2026-11-18,1200,80,4,9,3\nsports,tiktok,clip-2,11/18/2026 10:00,300,10,1,0,0\n");
 const {metrics}=await clippers.ingestClipperMetrics("owner");
 assert.equal(metrics.records.length,2);assert.equal(prepareOfficeSourceDocument("clip_metrics",metrics,{owner:"owner"}).status,"present");
 const source=await clippersSource();const p=source.provenance.find(p=>p.kind==="clip_metrics")!;
 assert.equal(p.status,"present");assert.equal(p.records,2);assert.deepEqual(source.rows.filter(r=>r.kind==="clip_metric").map(r=>r.metrics.views).sort((a,b)=>a-b),[300,1200]);
 assert.ok(!JSON.stringify(source).includes("clip-1"));
 assert.ok((await readdir(reportsDir)).length>0);
});
