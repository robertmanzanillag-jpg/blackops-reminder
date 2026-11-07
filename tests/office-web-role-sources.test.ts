import test from "node:test";
import assert from "node:assert/strict";
import {mkdtemp,mkdir,writeFile,readdir,readFile,rm} from "node:fs/promises";
import path from "node:path";
import {tmpdir} from "node:os";
import {readWebRoleSources,auditWebRoleSource,validateWebRoleSource} from "../server/office-web-role-sources";
const now=Date.parse("2026-11-07T01:00:00Z"),at=new Date(now).toISOString(),old=new Date(now-172800000).toISOString();
const pool={query:async(sql:string,args?:unknown[])=>({rows:sql.includes("FROM users")?[{id:args![0]}]:[]})};
async function fixture(t:any){const root=await mkdtemp(path.join(tmpdir(),"office-web-source-test-"));t.after(async()=>{assert.ok(path.resolve(root).startsWith(path.resolve(tmpdir())+path.sep));await rm(root,{recursive:true,force:true});});return root;}
async function put(root:string,file:string,value:unknown){const name=path.join(root,file);await mkdir(path.dirname(name),{recursive:true});await writeFile(name,typeof value==="string"?value:JSON.stringify(value));}
const news=(count=1)=>({version:1,updatedAt:old,lastRunAt:old,queue:Array.from({length:count},(_,i)=>({id:`private:https://internal/customer-${i}`,lane:i%2?"ny-news":"miami-news",status:"quarantined",createdAt:old,approvalRequired:true,autoEligible:false,qualityScore:50,copy:"SECRET_CUSTOMER",sourceUrl:"https://private/token=secret"}))});
test("missing files remain missing, no bootstrap or filesystem writes, foreign owner rejected",async t=>{
 const root=await fixture(t);const sources=await readWebRoleSources({pool,owner:"owner",configuredOwner:"owner",root,now});assert.equal(sources.length,7);assert.deepEqual(await readdir(root),[]);assert.ok(sources.every(s=>s.diagnostics.includes("SOURCE_MISSING")));assert.ok(sources.every(s=>auditWebRoleSource(s,"owner",now).status==="blocked"));
 let calls=0;await assert.rejects(()=>readWebRoleSources({pool:{query:async()=>{calls++;return {rows:[]};}},owner:"other",configuredOwner:"owner",root,now}));assert.equal(calls,0);
});
test("real news lanes remain stale, bounded and sanitized; genuine JSONB key order works",async t=>{
 const root=await fixture(t);await put(root,"clippers_workspace/local-news/state.json",news(205));const before=await readFile(path.join(root,"clippers_workspace/local-news/state.json"),"utf8");
 const sources=await readWebRoleSources({pool,owner:"owner",configuredOwner:"owner",root,now}),all=sources.find(s=>s.role==="news")!,ny=sources.find(s=>s.role==="news:ny-news")!;
 assert.equal(all.total,205);assert.equal(all.rows.length,200);assert.equal(all.truncated,true);assert.equal(ny.total,102);assert.ok(ny.rows.every(r=>r.lane==="ny-news"));assert.ok(all.diagnostics.includes("SOURCE_STALE"));assert.equal(all.provenance[0].sourceAt,old);
 assert.ok(!JSON.stringify(sources).includes("SECRET_CUSTOMER"));assert.ok(!JSON.stringify(sources).includes("https://"));assert.equal(await readFile(path.join(root,"clippers_workspace/local-news/state.json"),"utf8"),before);
 const reorder=(v:any):any=>Array.isArray(v)?v.map(reorder):v&&typeof v==="object"?Object.fromEntries(Object.keys(v).reverse().map(k=>[k,reorder(v[k])])):v;assert.equal(validateWebRoleSource(reorder(all),"owner").sourceDigest,all.sourceDigest);
 const changed=structuredClone(all);changed.rows[0].metrics.qualityScore=99;assert.throws(()=>validateWebRoleSource(changed,"owner"));assert.throws(()=>auditWebRoleSource(all,"owner",now+300001));
});
test("valid empty differs from corrupt or oversized sources and foreign report data never exports",async t=>{
 const root=await fixture(t);await put(root,"dropshipping_engine_data/products.json",[]);await put(root,"dropshipping_engine_data/suppliers.json","{bad");await put(root,"marketing_command_center_data/learning-runs.json","x".repeat(1048577));
 await put(root,"clippers_workspace/reports/one.json",{id:"x",userId:"other",createdAt:at,publishMode:"draft_only",plannedClips:[],summary:"private"});
 const sources=await readWebRoleSources({pool,owner:"owner",configuredOwner:"owner",root,now}),drop=sources.find(s=>s.role==="dropshipping")!,marketing=sources.find(s=>s.role==="marketing-cmo")!;
 assert.equal(drop.provenance[0].status,"present");assert.equal(drop.provenance[0].empty,true);assert.equal(drop.provenance[1].status,"invalid");assert.ok(marketing.diagnostics.includes("SOURCE_LIMIT"));assert.equal(sources.find(s=>s.role==="clippers")!.rows.length,0);
});
test("remote queue reads existing SQL only, preserves old heartbeat and retry counts without session claim",async t=>{
 const root=await fixture(t),remote={version:1,updatedAt:old,device:{seenAt:old,queue:{updatedAt:old,totals:{queued:2,processing:0,retry:3,scheduled:1,completed:4,cancelled:0}},lastError:"secret",worker:{token:"secret"}},chatHistory:["private"]};
 const db={query:async(sql:string,args?:unknown[])=>{assert.ok(!/INSERT|UPDATE|CREATE/.test(sql));return {rows:sql.includes("FROM users")?[{id:args![0]}]:[{data:remote}]};}};
 const source=(await readWebRoleSources({pool:db,owner:"owner",configuredOwner:"owner",root,now})).find(s=>s.role==="blackroom-videos")!;assert.ok(source.diagnostics.includes("RETRY_BACKLOG"));assert.ok(source.diagnostics.includes("SOURCE_STALE"));assert.ok(source.diagnostics.includes("NO_CURRENT_SESSION_PROOF"));assert.ok(!JSON.stringify(source).includes("secret"));assert.equal(source.rows[0].metrics.retry,3);
});
test("report enumeration and cumulative input bytes are bounded without creating directories",async t=>{
 const root=await fixture(t);for(let i=0;i<25;i++)await put(root,`clippers_workspace/reports/${i}.json`,{id:`r${i}`,userId:"owner",createdAt:at,publishMode:"draft_only",plannedClips:[]});
 const source=(await readWebRoleSources({pool,owner:"owner",configuredOwner:"owner",root,now})).find(s=>s.role==="clippers")!;assert.ok(source.diagnostics.includes("SOURCE_LIMIT"));assert.ok(source.rows.length<=20);assert.equal(auditWebRoleSource(source,"owner",now).completeCoverage,false);
});
test("existing empty report directory and null remote device are valid empty sources, never missing",async t=>{
 const root=await fixture(t);await mkdir(path.join(root,"clippers_workspace/reports"),{recursive:true});
 const db={query:async(sql:string,args?:unknown[])=>({rows:sql.includes("FROM users")?[{id:args![0]}]:[{data:{version:1,updatedAt:at,device:null}}]})};
 const sources=await readWebRoleSources({pool:db,owner:"owner",configuredOwner:"owner",root,now});
 for(const [role,kind] of [["blackroom-videos","blackroom_remote"],["clippers","clip_reports"]]){const p=sources.find(s=>s.role===role)!.provenance.find(p=>p.kind===kind)!;assert.equal(p.status,"present");assert.equal(p.empty,true);assert.ok(p.digest);assert.equal(p.records,0);}
});
test("actual Clippers daily-plan and automation-cycle writer shapes are distinct, unknown files stay visible",async t=>{
 const root=await fixture(t),cycleId="2026-11-07T00-00-00-000Z",dailyId="2026-11-07T00-01-00-000Z";
 const totals={posts:1,dailyTargetPosts:2,weeklyTargetClips:14,backlogPosts:0,gapToDailyTarget:1,scheduled:0,readyForManual:0,blocked:1,draftReady:0,rightsReview:1,needsSource:0};
 await put(root,`clippers_workspace/reports/automation-cycle-${cycleId}.json`,{id:cycleId,userId:"owner",createdAt:at,automation:{id:cycleId,createdAt:at,status:"blocked",totals,posts:[{secret:"private",url:"https://private"}]}});
 const secondId="2026-11-07T00-02-00-000Z";await put(root,`clippers_workspace/reports/automation-cycle-${secondId}.json`,{id:secondId,userId:"owner",createdAt:at,automation:{id:secondId,createdAt:at,status:"blocked",totals,posts:[{}]}});
 await put(root,`clippers_workspace/reports/${dailyId}.json`,{id:dailyId,userId:"owner",createdAt:at,publishMode:"draft_only",plannedClips:[{customer:"private"}]});
 await put(root,"clippers_workspace/reports/other-contract.json",{unknown:"private"});
 const source=(await readWebRoleSources({pool,owner:"owner",configuredOwner:"owner",root,now})).find(s=>s.role==="clippers")!;
 assert.deepEqual(source.rows.map(r=>r.kind).sort(),["clip_cycle","clip_cycle","clip_plan"]);assert.equal(source.rows.find(r=>r.kind==="clip_cycle")!.metrics.blocked,1);assert.ok(source.diagnostics.includes("SOURCE_INVALID"));assert.ok(!JSON.stringify(source).includes("private"));
 const audit=auditWebRoleSource(source,"owner",now);assert.equal(audit.metrics["clip_cycle:observations"],2);assert.equal(audit.metrics["clip_cycle:scheduled"],undefined);assert.equal(audit.metrics["clip_cycle:weeklyTargetClips"],undefined);
 const foreign=path.join(root,`clippers_workspace/reports/${dailyId}.json`);await writeFile(foreign,JSON.stringify({id:dailyId,userId:"other",createdAt:at,publishMode:"draft_only",plannedClips:[]}));
 const changed=(await readWebRoleSources({pool,owner:"owner",configuredOwner:"owner",root,now})).find(s=>s.role==="clippers")!;assert.equal(changed.rows.filter(r=>r.kind==="clip_plan").length,0);
});
test("a fresh BlackRoom heartbeat never launders an old queue timestamp",async t=>{
 const root=await fixture(t);const db={query:async(sql:string,args?:unknown[])=>({rows:sql.includes("FROM users")?[{id:args![0]}]:[{data:{version:1,updatedAt:at,device:{seenAt:at,queue:{updatedAt:old,totals:{queued:1,processing:0,retry:0,scheduled:0,completed:0,cancelled:0}}}}}]})};
 const source=(await readWebRoleSources({pool:db,owner:"owner",configuredOwner:"owner",root,now})).find(s=>s.role==="blackroom-videos")!;assert.equal(source.rows[0].sourceAt,old);assert.equal(source.provenance[0].sourceAt,old);assert.equal(source.provenance[0].heartbeatAt,at);assert.ok(source.diagnostics.includes("SOURCE_STALE"));
});
