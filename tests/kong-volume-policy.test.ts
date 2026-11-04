import test from "node:test";
import assert from "node:assert/strict";
import { evaluateKongVolumePolicy,volumeTargets, type VolumePolicyState } from "../server/kong-volume-policy";
import { emptyState,fillPlan,coverage,type Asset,type Network } from "../server/kong-autopilot-core";
import type { LearningLedger,Observation } from "../server/kong-content-learning";
import type { PublishedCreative } from "../server/kong-metricool-learning";
const now=new Date("2026-11-02T12:00:00Z");
function measured(network:Network="tiktok",perDay=5,trend:"up"|"down"="up") {
  const registry:PublishedCreative[]=[],ledger:LearningLedger={version:1,observations:[]};
  for(let d=0;d<14;d++)for(let p=0;p<perDay;p++){
    const publishedAt=new Date(Date.UTC(2026,9,16+d,12+p)).toISOString(),postId=`${d*10+p+1000}`;
    const publicUrl=network==="tiktok"?`https://www.tiktok.com/@kongnightlife/video/${postId}`:`https://www.facebook.com/reel/${postId}`;
    const r:PublishedCreative={network,postId,publicUrl,publishedAt,family:"pov",hookStyle:"question"};registry.push(r);
    const late=d>=7;const metrics=late?(trend==="up"?{views:1500,shares:30}:{views:500,shares:1}):{views:1000,shares:10};
    ledger.observations.push({network,postId,sourceUrl:publicUrl,publishedAt,observedAt:new Date(Date.parse(publishedAt)+72*3600_000).toISOString(),family:"pov",hookStyle:"question",metrics});
  }
  return {registry,ledger};
}
function prior(target:5|6|7):VolumePolicyState {
  const p=evaluateKongVolumePolicy(undefined,undefined,[],now);
  p.networks.tiktok.target=target;return p;
}
test("floor five without measured evidence; isolated network cannot inherit signal",()=>{
  assert.deepEqual(volumeTargets(evaluateKongVolumePolicy(undefined,undefined,[],now)),{tiktok:5,facebook:5});
  const f=measured();const r=evaluateKongVolumePolicy(undefined,f.ledger,f.registry,now);
  assert.deepEqual(volumeTargets(r),{tiktok:6,facebook:5});assert.equal(r.networks.tiktok.evidence.baselinePosts,35);assert.equal(r.networks.tiktok.evidence.recentPosts,35);
});
test("seven-day baseline alone and incomplete days cannot scale",()=>{
  const f=measured();f.registry.splice(0,35);f.ledger.observations.splice(0,35);
  assert.equal(evaluateKongVolumePolicy(undefined,f.ledger,f.registry,now).networks.tiktok.target,5);
  const g=measured();g.ledger.observations.pop();assert.equal(evaluateKongVolumePolicy(undefined,g.ledger,g.registry,now).networks.tiktok.target,5);
});
test("views alone, missing shares and zero non-view baseline do not scale",()=>{
  for(const mode of ["missing","zero","flat"]){const f=measured();for(const o of f.ledger.observations){
    if(mode==="missing")delete o.metrics.shares;
    if(mode==="zero")o.metrics.shares=0;
    if(mode==="flat")o.metrics.shares=o.metrics.views===1500?15:10;
  }assert.equal(evaluateKongVolumePolicy(undefined,f.ledger,f.registry,now).networks.tiktok.target,5,mode);}
});
test("lower one step on comparable joint decline; never below five",()=>{
  const f=measured("tiktok",6,"down");let r=evaluateKongVolumePolicy(prior(6),f.ledger,f.registry,now);
  assert.equal(r.networks.tiktok.target,5);assert.match(r.networks.tiktok.reason,/revert_one/);
  assert.equal(evaluateKongVolumePolicy(prior(5),f.ledger,f.registry,now).networks.tiktok.target,5);
});
test("no more than one step and seven is a ceiling",()=>{
  const f=measured("tiktok",7);assert.equal(evaluateKongVolumePolicy(prior(6),f.ledger,f.registry,now).networks.tiktok.target,7);
  assert.equal(evaluateKongVolumePolicy(prior(7),f.ledger,f.registry,now).networks.tiktok.target,7);
  const p=prior(6);p.networks.tiktok.lastChangedAt="2026-11-01T12:00:00Z";
  assert.equal(evaluateKongVolumePolicy(p,f.ledger,f.registry,now).networks.tiktok.target,6);
});
test("late lifetime totals and mismatched public metadata never support change",()=>{
  for(const mode of ["late","metadata"]){const f=measured();for(const o of f.ledger.observations){if(mode==="late")o.observedAt=new Date(Date.parse(o.publishedAt)+100*3600_000).toISOString();else o.sourceUrl+="?wrong=1";}
  assert.equal(evaluateKongVolumePolicy(undefined,f.ledger,f.registry,now).networks.tiktok.target,5);}
});
test("duplicate registry blocks decisions",()=>{const f=measured();f.registry.push(f.registry[0]);const r=evaluateKongVolumePolicy(undefined,f.ledger,f.registry,now);assert.equal(r.networks.tiktok.target,5);assert.match(r.networks.tiktok.reason,/reconciliation/);});
const asset=(i:number):Asset=>({id:`a${i}`,sourceUrl:"https://owned.example/source",mediaUrl:`https://owned.example/${i}.mp4`,sha256:i.toString(16).padStart(64,"0"),family:(["pov","humor","dancefloor","app"] as const)[i%3],hook:`Hook ${i}`,title:`Title ${i}`,caption:"Explore https://kongnightlife.com",durationSeconds:9,width:1080,height:1920,
footageRights:{evidenceUrl:"https://owned.example/rights",confirmedBy:"owner",expiresAt:"2027-01-01T00:00:00Z"},musicRights:{evidenceUrl:"https://owned.example/music",confirmedBy:"owner",expiresAt:"2027-01-01T00:00:00Z"},qa:{reviewedBy:"reviewer",reviewedAt:"2026-10-01T00:00:00Z",officialWhiteLogo:true,noLogoBackgroundOrShadow:true,safeZones:true,audioChecked:true,spellingChecked:true,renderedSha256:i.toString(16).padStart(64,"0")}});
const convert=(wall:string)=>wall+"-05:00";
test("volume slots preserve base identities, times and two-hour spacing",()=>{
 const state=emptyState(),assets=Array.from({length:120},(_,i)=>asset(i));const clock=new Date("2026-11-02T06:00:00Z");
 fillPlan(state,assets,clock,convert);const originals=state.jobs.map(j=>({id:j.id,at:j.at}));
 fillPlan(state,assets,clock,convert,undefined,{tiktok:7,facebook:5});
 for(const orig of originals)assert.equal(state.jobs.find(j=>j.id===orig.id)!.at,orig.at);
 const tt=state.jobs.filter(j=>j.day==="2026-11-02"&&j.network==="tiktok").sort((a,b)=>a.at.localeCompare(b.at));
 // Max two per family means a three-family catalog can produce only six/day, never fabricated seventh.
 assert.equal(tt.length,6);for(let i=1;i<tt.length;i++)assert.ok(Date.parse(tt[i].at)-Date.parse(tt[i-1].at)>=2*3600_000);
 const c=coverage(state,clock,{tiktok:7,facebook:5})[0].networks as any;assert.equal(c.tiktok.target,7);assert.equal(c.tiktok.missingScheduled,7);
});
test("reductions leave remote/uncertain posts untouched and suppress extra planned work",()=>{
 const state=emptyState(),assets=Array.from({length:120},(_,i)=>asset(i)),clock=new Date("2026-11-02T06:00:00Z");
 fillPlan(state,assets,clock,convert,undefined,{tiktok:6});const extras=state.jobs.filter(j=>j.network==="tiktok"&&j.slot===5);extras[0].state="scheduled";extras[0].receipt="real";extras[1].state="uncertain";extras[1].attempts=1;extras[2].state="submitting";extras[2].attempts=1;
 fillPlan(state,assets,clock,convert,undefined,{tiktok:5});assert.equal(extras[0].state,"scheduled");assert.equal(extras[1].state,"uncertain");assert.equal(extras[2].state,"submitting");assert.equal(extras[3].state,"blocked");assert.equal(extras[3].reason,"volume_target_reduced");
 const rows=state.jobs.filter(j=>j.day==="2026-11-02"&&j.network==="tiktok");rows.forEach(j=>j.state="scheduled");const c=coverage(state,clock,{tiktok:5})[0].networks as any;assert.equal(c.tiktok.missingScheduled,0);
});
test("seven distinct time slots are available with sufficiently diverse authorized supply",()=>{
 const clock=new Date("2026-11-02T06:00:00Z"),assets=Array.from({length:140},(_,i)=>{
   const a=asset(i);if(i%4===3){a.family="app";a.facts={sourceUrl:"https://owned.example/app",verifiedAt:clock.toISOString(),validUntil:"2027-01-01T00:00:00Z"};}return a;
 });
 const state=fillPlan(emptyState(),assets,clock,convert,undefined,{tiktok:7,facebook:7});
 for(const network of ["tiktok","facebook"]){const today=state.jobs.filter(j=>j.day==="2026-11-02"&&j.network===network).sort((a,b)=>a.at.localeCompare(b.at));assert.equal(today.length,7);assert.equal(new Set(today.map(j=>j.slot)).size,7);
 for(let i=1;i<today.length;i++)assert.ok(Date.parse(today[i].at)-Date.parse(today[i-1].at)>=2*3600_000);}
});

test("low and zero-view trial collapse can roll back using real non-view outcomes",()=>{
 for(const views of [50,0]){const f=measured("tiktok",6);for(const o of f.ledger.observations.slice(42)){o.metrics.views=views;o.metrics.shares=0;}
  const r=evaluateKongVolumePolicy(prior(6),f.ledger,f.registry,now);assert.equal(r.networks.tiktok.target,5);
  assert.equal(r.networks.tiktok.evidence.medianPrimaryCount,0);assert.equal(r.networks.tiktok.evidence.baselineMedianPrimaryCount,10);
  if(views===0)assert.equal(r.networks.tiktok.evidence.medianPrimaryPerThousand,null);
 }
});
test("zero-view data cannot scale or manufacture rate; inconsistent non-view counts hold",()=>{
 const f=measured("tiktok",6);for(const o of f.ledger.observations.slice(42)){o.metrics.views=0;o.metrics.shares=1;}
 const r=evaluateKongVolumePolicy(prior(6),f.ledger,f.registry,now);assert.equal(r.networks.tiktok.target,6);assert.match(r.networks.tiktok.reason,/reconciliation/);
 const g=measured();for(const o of g.ledger.observations){o.metrics.views=50;o.metrics.shares=o.metrics.shares===30?3:1;}
 assert.equal(evaluateKongVolumePolicy(undefined,g.ledger,g.registry,now).networks.tiktok.target,5);
});
