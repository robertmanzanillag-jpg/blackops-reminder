import test from "node:test";
import assert from "node:assert/strict";
import {createWebSourceExportCycle,officeWebSourceStatus,warmOfficeWebSources} from "../server/office-web-source-scheduler";
test("export cycle is bounded to one local read and persists before reporting ready",async()=>{
 let reads=0,writes=0,release!:()=>void;const wait=new Promise<void>(resolve=>release=resolve);
 const cycle=createWebSourceExportCycle({read:async()=>{reads++;await wait;return [];},persist:async()=>{writes++;}});
 const first=cycle.tick();assert.equal(await cycle.tick(),false);assert.equal(writes,0);release();assert.equal(await first,true);assert.equal(reads,1);assert.equal(writes,1);assert.equal(officeWebSourceStatus().status,"ready");cycle.stop();assert.equal(await cycle.tick(),false);
});
test("failed persistence does not claim a new export or expose raw errors",async()=>{
 const before=officeWebSourceStatus().lastExportAt;const cycle=createWebSourceExportCycle({read:async()=>[],persist:async()=>{throw Error("PRIVATE_DATABASE_DETAILS");}});assert.equal(await cycle.tick(),false);assert.equal(officeWebSourceStatus().lastExportAt,before);assert.equal(officeWebSourceStatus().status,"unavailable");assert.doesNotMatch(JSON.stringify(officeWebSourceStatus()),/PRIVATE/);
});
test("warming source host sends only bounded GET health and rejects alternate origins/redirects",async()=>{
 let calls=0;const fetcher=(async(url:any,init:any)=>{calls++;assert.equal(String(url),"https://office.example/api/health");assert.equal(init.redirect,"error");assert.equal(init.body,undefined);assert.equal(init.headers,undefined);return new Response(JSON.stringify({officeSources:{enabled:true,status:"ready",lastExportAt:new Date().toISOString()}}));}) as typeof fetch;
 await warmOfficeWebSources("https://office.example",fetcher);assert.equal(calls,1);
 for(const origin of ["http://office.example","https://user:pass@office.example","https://office.example/path"])await assert.rejects(()=>warmOfficeWebSources(origin,fetcher));assert.equal(calls,1);
 await assert.rejects(()=>warmOfficeWebSources("https://office.example",(async()=>new Response(JSON.stringify({officeSources:{enabled:false,status:"disabled"}}))) as typeof fetch),/EXPORT_UNAVAILABLE/);
});
