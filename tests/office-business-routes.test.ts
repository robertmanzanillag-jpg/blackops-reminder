import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import {registerOfficeBusinessRoutes} from "../server/office-business-routes";
import type {BusinessWorkJob} from "../server/office-business-work";
test("business history requires authenticated canonical owner, is read-only and redacts failures",async t=>{
 const app=express();let reads=0,fail=false;let jobs:BusinessWorkJob[]=[];
 app.use((req,_res,next)=>{const id=req.header("fixture-owner");if(id)(req as any).user={id};next();});
 registerOfficeBusinessRoutes(app,{systemOwner:()=>"owner",read:async owner=>{assert.equal(owner,"owner");reads++;if(fail)throw Error("private database details");return{jobs};},now:()=>0});
 const server=app.listen(0,"127.0.0.1");await new Promise<void>(r=>server.once("listening",r));t.after(()=>new Promise<void>(r=>server.close(()=>r())));
 const url=`http://127.0.0.1:${(server.address() as any).port}/api/agents-office/business-work`;
 for(const [id,expected] of [[null,401],["other",403]] as const){const response=await fetch(url,{headers:id?{"fixture-owner":id}:{}});assert.equal(response.status,expected);assert.equal(response.headers.get("cache-control"),"no-store");}
 assert.equal(reads,0);
 const response=await fetch(url,{headers:{"fixture-owner":"owner"}});assert.equal(response.status,200);assert.deepEqual(await response.json(),{ownerId:"owner",checkedAt:"1970-01-01T00:00:00.000Z",jobs:[]});assert.equal(reads,1);
 const post=await fetch(url,{method:"POST",headers:{"fixture-owner":"owner"}});assert.equal(post.status,404);assert.equal(reads,1);
 jobs=[{id:"expired",role:"automations",generation:1,status:"running",slot:"1969-12-31",fence:"private-fence",startedAt:"1969-12-31T23:59:00.000Z",expiresAt:"1970-01-01T00:00:00.000Z"}];
 const expired=await(await fetch(url,{headers:{"fixture-owner":"owner"}})).json();assert.equal(expired.jobs[0].status,"unknown");assert.equal(expired.jobs[0].reason,"LEASE_EXPIRED");assert.equal(jobs[0].status,"running");assert.ok(!JSON.stringify(expired).includes("private-fence"));
 fail=true;const failed=await fetch(url,{headers:{"fixture-owner":"owner"}});assert.equal(failed.status,503);assert.equal(failed.headers.get("cache-control"),"no-store");assert.ok(!(await failed.text()).includes("private"));
});
