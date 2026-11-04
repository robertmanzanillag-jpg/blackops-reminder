import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { loadKongStartup } from "../server/kong-startup";
import type { createProductionAdapters, ProductionJob } from "../server/kong-production-pipeline";
const now=new Date("2026-11-04T12:00:00Z"), hash="a".repeat(64);
const qa={reviewedBy:"reviewer",reviewedAt:now.toISOString(),officialWhiteLogo:true,noLogoBackgroundOrShadow:true,safeZones:true,audioChecked:true,spellingChecked:true,renderedSha256:hash};
async function fixture(run:(f:any)=>Promise<void>) {
  const dir=await mkdtemp(path.join(tmpdir(),"kong-startup-test-"));
  try {
    const file=(n:string)=>path.join(dir,n);
    for(const name of ["music.wav","logo.png","font.ttf"]) await writeFile(file(name),"fixture");
    await writeFile(file("sources.json"),JSON.stringify([{id:"one",sourceUrl:"https://owned.example/source",mediaUrl:"https://owned.example/one.mp4",author:"Owner",authorizedByOwner:true,commercialPromotionAllowed:true,rightsEvidence:"Explicit commercial permission from owner",rightsExpiresAt:"2027-01-01T00:00:00Z"}]));
    await writeFile(file("tasks.json"),"[]"); await writeFile(file("reviews.json"),JSON.stringify([qa]));
    const config={version:1,soundtrack:{path:file("music.wav"),rightsEvidence:"https://owned.example/audio-rights"},logo:{path:file("logo.png"),approvedSha256:hash},fontPath:file("font.ttf"),folderId:"drive_folder_123",userId:"owner",sourceOrigins:["https://owned.example"],sourcesPath:file("sources.json"),tasksPath:file("tasks.json"),reviewsPath:file("reviews.json")};
    const saveConfig=()=>writeFile(file("config.json"),JSON.stringify(config)); await saveConfig();
    let factoryCalls=0;
    const factory:typeof createProductionAdapters=(input)=>{factoryCalls++;return {save:input.save,review:input.review,render:async()=>{throw Error("must_not_render_at_startup");},upload:async()=>{throw Error("must_not_upload_at_startup");}};};
    const env={KONG_PRODUCTION_CONFIG_PATH:file("config.json"),KONG_OWNER_USER_ID:"owner",KONG_MEDIA_ORIGINS:"https://owned.example"};
    await run({dir,file,config,saveConfig,env,deps:{adapterFactory:factory,now:()=>now},calls:()=>factoryCalls});
  } finally {await rm(dir,{recursive:true,force:true});}
}
test("absent and relative config fail closed",async()=>{
  assert.deepEqual((await loadKongStartup({})).blockers,["production_config_not_configured"]);
  assert.deepEqual((await loadKongStartup({KONG_PRODUCTION_CONFIG_PATH:"relative.json"})).blockers,["production_config_invalid"]);
});
test("valid explicit resources wire adapters without rendering or uploading",()=>fixture(async f=>{
  const result=await loadKongStartup(f.env,f.deps);assert.deepEqual(result.blockers,[]);assert.equal(f.calls(),1);
  assert.equal(result.options.production?.editorial,undefined);assert.deepEqual(await result.options.production?.tasks?.({} as any,now),[]);
  const discovered=await result.options.production!.dependencies.discover!(0,[]);
  assert.equal(discovered.candidates[0].id,"owner-one");assert.equal(discovered.candidates[0].rightsEvidence,"Explicit commercial permission from owner");
  assert.equal((await result.options.production!.dependencies.discover!(0,["owner-one"])).candidates.length,0);
}));
test("owner mismatch never creates adapters and errors are sanitized",()=>fixture(async f=>{
  f.env.KONG_OWNER_USER_ID="different";const r=await loadKongStartup(f.env,f.deps);assert.equal(f.calls(),0);assert.deepEqual(r.options,{});assert.deepEqual(r.blockers,["production_config_invalid_or_unavailable"]);assert.ok(!JSON.stringify(r).includes(f.dir));
}));
test("invalid source rights fail closed at startup",()=>fixture(async f=>{
  await writeFile(f.config.sourcesPath,JSON.stringify([{id:"bad"}]));const r=await loadKongStartup(f.env,f.deps);assert.equal(r.options.production,undefined);assert.equal(f.calls(),0);
}));
test("review must bind actual artifact and receipt; missing/future review stays pending",()=>fixture(async f=>{
  const r=await loadKongStartup(f.env,f.deps),review=r.options.production!.dependencies.review!;
  const job={artifact:{sha256:hash},receipt:{sha256:hash}} as ProductionJob;
  assert.deepEqual(await review(job),qa);
  assert.equal(await review({...job,receipt:{sha256:"b".repeat(64)}} as ProductionJob),null);
  await writeFile(f.config.reviewsPath,JSON.stringify([{...qa,reviewedAt:"2026-11-05T12:00:00Z"}]));assert.equal(await review(job),null);
  await writeFile(f.config.reviewsPath,"[]");assert.equal(await review(job),null);
}));
test("tasks and source evidence are re-read; malformed task update cannot become work",()=>fixture(async f=>{
  const r=await loadKongStartup(f.env,f.deps);await writeFile(f.config.tasksPath,JSON.stringify([{id:"unsafe",authorizedForPublicDistribution:true}]));
  await assert.rejects(()=>r.options.production!.tasks!({} as any,now));
  await writeFile(f.config.sourcesPath,JSON.stringify([{id:"bad"}]));await assert.rejects(()=>r.options.production!.dependencies.discover!(0,[]));
}));
test("optional publication file provides records only through runtime validation",()=>fixture(async f=>{
  f.config.publicationsPath=f.file("publications.json");await writeFile(f.config.publicationsPath,"[]");await f.saveConfig();
  const r=await loadKongStartup(f.env,f.deps);assert.deepEqual(await r.options.publishedRegistry!(),[]);
}));

test("invalid Drive folder is rejected before adapters or upload",()=>fixture(async f=>{
  for(const folderId of ["folder","a".repeat(161),"invalid folder/123"]){
    f.config.folderId=folderId;await f.saveConfig();const r=await loadKongStartup(f.env,f.deps);
    assert.equal(r.options.production,undefined);assert.equal(f.calls(),0);
  }
}));
test("static task constraints match render and pipeline eligibility",()=>fixture(async f=>{
  const task={id:"task",sourceIds:["owner-one"],layout:"pov",hook:"A night worth planning",title:"Night out",caption:"Explore https://kongnightlife.com",family:"pov",durationSeconds:9,
    footageRights:{evidenceUrl:"https://owned.example/rights",confirmedBy:"Owner",expiresAt:"2027-01-01T00:00:00Z"},
    musicRights:{evidenceUrl:"https://owned.example/audio-rights",confirmedBy:"Owner",expiresAt:"2027-01-01T00:00:00Z"},authorizedForPublicDistribution:true};
  await writeFile(f.config.tasksPath,JSON.stringify([task]));assert.deepEqual((await loadKongStartup(f.env,f.deps)).blockers,[]);
  for(const invalid of [{durationSeconds:31},{durationSeconds:2},{layout:"montage",sourceIds:["owner-one","owner-two"]},
    {layout:"pov",sourceIds:["owner-one","owner-two"]},{layout:"montage",sourceIds:["owner-one","owner-one","owner-three"]},
    {layout:"reveal"},{family:"guestlist"},{hook:"x".repeat(91)},{caption:"Explore somewhere else"}]){
    await writeFile(f.config.tasksPath,JSON.stringify([{...task,...invalid}]));
    const r=await loadKongStartup(f.env,f.deps);assert.equal(r.options.production,undefined,JSON.stringify(invalid));
  }
}));
