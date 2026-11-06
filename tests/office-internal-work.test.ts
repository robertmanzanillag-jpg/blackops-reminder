import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createInternalWorkRunner,prepareInternalArtifact,parseInternalWork,readInternalWorkSnapshot,type InternalWorkSnapshot } from "../server/office-internal-work";
import { advanceCompany,emptyCompanyState } from "../shared/agent-company";
import { emptyRoleLifecycleState,reconcileRoleLifecycles } from "../shared/office-role-lifecycle";
import type { CouncilState } from "../shared/agent-council";
import { registerAgentCouncilRoutes } from "../server/agent-council-routes";
const NOW=Date.parse("2026-11-06T12:00:00Z"), owner="owner-one";
const key=createHash("sha256").update(JSON.stringify(owner)).digest("hex");
const source=():InternalWorkSnapshot=>({ownerKey:key,observedAt:new Date(NOW).toISOString(),taskTotal:1,approvalTotal:1,tasks:[{id:"task1",title:"Saved task",scheduledAt:"2026-11-06T23:30:00",priority:"high",kind:"meeting"}],approvals:[{id:"approval1",title:"Pending approval",scheduledAt:null,priority:"medium",kind:"email.send"}]});
function fixture(){
  let clock=NOW;
  const company=advanceCompany(emptyCompanyState(),{now:NOW-1000,statuses:{ceo:{state:"working",label:"ready"},assistant:{state:"working",label:"ready"}},roles:{ceo:"CEO",assistant:"Assistant"}}).state;
  let state:NonNullable<CouncilState["officeExecution"]>={roles:reconcileRoleLifecycles(emptyRoleLifecycleState(),company,NOW),tokens:{reservations:[]}};
  const council={async updateOfficeExecution(change:any){const proposed=change(structuredClone(state),company);state=structuredClone(proposed);return structuredClone(state);}};
  return {council,state:()=>state,now:()=>clock,setClock:(value:number)=>clock=value};
}
test("canonical planning includes exact saved records, no sending or live-calendar claims",()=>{
  const ceo=prepareInternalArtifact("ceo",source()),assistant=prepareInternalArtifact("assistant",source());
  assert.deepEqual(ceo.includedIds,["task1","approval1"]);assert.deepEqual(assistant.includedIds,["task1"]);
  assert.match(assistant.text,/2026-11-06T23:30:00/);assert.match(ceo.text,/No se ha enviado/);
  assert.equal(ceo.evaluation.mode,"deterministic-contract");
  const empty=prepareInternalArtifact("assistant",{...source(),tasks:[],taskTotal:0});assert.match(empty.text,/No hay registros/);
  assert.throws(()=>prepareInternalArtifact("assistant",{...source(),tasks:[]}));
  assert.throws(()=>prepareInternalArtifact("ceo",{...source(),tasks:Array(201).fill(source().tasks[0])}));
  const tasks=Array.from({length:200},(_,i)=>({...source().tasks[0],id:`t${i}`,title:"t".repeat(500)}));
  const approvals=tasks.map((row,i)=>({...row,id:`a${i}`}));
  const bounded=prepareInternalArtifact("ceo",{...source(),tasks,approvals,taskTotal:401,approvalTotal:201});assert.match(bounded.text,/200\/401 tareas/);assert.equal(bounded.includedIds.length,400);
});
test("internal artifact route refuses other users before loading private state",async()=>{
  const handlers=new Map<string,any>();let reads=0;
  const app={get:(path:string,handler:any)=>handlers.set(path,handler),post:()=>{}};
  registerAgentCouncilRoutes(app as any,{council:{async load(){reads++;return {officeExecution:{internalWork:{version:1,jobs:[]}}};}} as any,requestUserId:(req:any)=>req.user,ownerUserId:()=>owner});
  const response=()=>({code:200,body:undefined as any,headers:{} as any,set(key:string,value:string){this.headers[key]=value;return this;},status(code:number){this.code=code;return this;},json(value:any){this.body=value;return this;}});
  const denied=response();await handlers.get("/api/agent-council/internal-work")({user:"other-owner"},denied);assert.equal(denied.code,403);assert.equal(reads,0);
  const allowed=response();await handlers.get("/api/agent-council/internal-work")({user:owner},allowed);assert.equal(reads,1);assert.equal(allowed.headers["Cache-Control"],"no-store");assert.deepEqual(allowed.body,{version:1,jobs:[]});
});
test("concurrent runners and restart complete one daily slot per role with immutable evidence",async()=>{
  const f=fixture();let reads=0;
  const make=()=>createInternalWorkRunner({council:f.council,owner,now:f.now,read:async()=>{reads++;return source();}});
  await Promise.all([make().tick(),make().tick()]);await make().tick();
  assert.equal(reads,2);const jobs=parseInternalWork(f.state().internalWork).jobs;assert.equal(jobs.length,2);assert.ok(jobs.every(j=>j.status === "completed"));
  const corrupt=structuredClone(f.state().internalWork)!;corrupt.jobs[0].artifact!.text="invented";assert.throws(()=>parseInternalWork(corrupt));
});
test("failed or foreign source is blocked without life penalty or output",async()=>{
  const f=fixture();await createInternalWorkRunner({council:f.council,owner,now:f.now,read:async()=>({...source(),ownerKey:"a".repeat(64)})}).tick();
  assert.ok(f.state().internalWork!.jobs.every(j=>j.status === "blocked" && !j.artifact));
  assert.ok(Object.values(f.state().roles.roles).every(r=>r.generation === 1));
});
test("lease expiry preserves uncertain fence across days and prevents same-role retry",async()=>{
  const f=fixture();let reads=0;
  await createInternalWorkRunner({council:f.council,owner,now:f.now,read:async()=>{reads++;f.setClock(f.now()+61000);return {...source(),observedAt:new Date(f.now()).toISOString()};}}).tick();
  assert.ok(f.state().internalWork!.jobs.every(j=>j.status === "unknown"));
  f.setClock(NOW+86400000);await createInternalWorkRunner({council:f.council,owner,now:f.now,read:async()=>{reads++;return source();}}).tick();assert.equal(reads,2);
});
test("source SQL binds owner on every private query and rolls back oversized results",async()=>{
  const queries:Array<{sql:string,args?:unknown[]}> = [];let released=false;
  const pool={async connect(){return {async query(sql:string,args?:unknown[]){queries.push({sql,args});if(sql.includes("FROM users")) return {rows:[{id:owner}]};if(sql.includes("FROM tasks"))return {rows:source().tasks.map(row=>({...row,total:1}))};if(sql.includes("FROM pending_actions"))return {rows:source().approvals.map(row=>({...row,total:1}))};if(sql.includes("clock_timestamp"))return {rows:[{observed:new Date(NOW)}]};return {rows:[]};},release(){released=true;}};}};
  assert.deepEqual(await readInternalWorkSnapshot(pool,owner),source());assert.ok(released);
  for(const q of queries.filter(q=>/FROM (users|tasks|pending_actions)/.test(q.sql))) assert.deepEqual(q.args,[owner]);
  assert.match(queries[0].sql,/READ ONLY/);assert.ok(!queries.some(q=>/INSERT|UPDATE|DELETE/.test(q.sql)));
  const oversized={async connect(){const client=await pool.connect();return {...client,async query(sql:string,args?:unknown[]){if(sql.includes("FROM tasks"))return {rows:Array(201).fill(source().tasks[0])};return client.query(sql,args);}};}};
  await assert.rejects(()=>readInternalWorkSnapshot(oversized,owner));assert.equal(queries.at(-1)!.sql,"ROLLBACK");
});
