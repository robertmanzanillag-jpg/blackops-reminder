import test from 'node:test';
import assert from 'node:assert/strict';
import {derivativeFixture,DERIVATIVE_NOW} from './helpers/reviewed-derivative-fixture.mjs';
import {approveReviewedDerivative,reviewedDerivativeDigest} from '../shared/clippers-reviewed-derivative.mjs';
import {emptyStreamerState} from '../script/clippers-streamer-discovery.mjs';
import {runReviewedDerivatives} from '../script/clippers-reviewed-derivative-worker.mjs';
import {reconcileReviewedDerivativeCopies} from '../script/clippers-reviewed-copy-reconcile.mjs';
const START='2026-11-22T15:00:00.000Z',END='2026-11-22T16:00:00.000Z',NOW=Date.parse('2026-11-22T15:16:00.000Z');
function setup({at=NOW,load,upload,preflight,schedule,delivery}={}){
 let time=at;const f=derivativeFixture(DERIVATIVE_NOW),m=f.manifest;m.dispatch={mode:'owner_hour_window',timezone:'America/New_York',startAt:START,endAt:END};m.scheduledAt=m.windowStart=START;m.windowEnd=m.expiresAt=END;
 m.caption+=' #ad';m.captionSha256=m.qa.captionSha256=(awaitHash(m.caption));m.rights.licenseTerm={kind:'conditional_live',campaignId:'a5c63fad-cd53-4b81-9305-4a2d1696872a',verifierId:'contentrewards_campaign_active_v1'};m.rights.membership={campaignId:m.rights.licenseTerm.campaignId,joinedObservedAt:new Date(DERIVATIVE_NOW).toISOString(),evidenceReference:'TEST ONLY:actual-observation-placeholder',evidenceSha256:'a'.repeat(64),leaseExpiresAt:'2026-11-23T12:00:00.000Z',operationalConditionAttested:true};
 m.baseline={fromDay:'2026-11-20',throughDay:'2026-11-24',sourceOriginAt:'2026-11-21T10:00:00Z',originEvidenceReference:'TEST ONLY',originEvidenceSha256:'a'.repeat(64),rows:[]};
 const digest=reviewedDerivativeDigest(m),record=approveReviewedDerivative({...f.proposal,proposedBy:'fixture-owner',manifestSha256:digest},{principal:'fixture-owner',operatorLabel:'TEST ONLY',now:DERIVATIVE_NOW,expectedDigest:digest,attestRights:true,attestExternalQa:true});if(delivery)record.delivery=delivery;
 let state=emptyStreamerState();state.creators[m.source.creatorKey]={policy:{status:'allowed_unless_prohibited',source:'TEST ONLY'}};state.reviewedDerivatives={version:1,records:{[m.id]:record}};
 const calls={loads:0,uploads:0,writes:0,removed:0,slots:[]};const store={read:async()=>JSON.stringify(state),transact:async(_k,fn)=>{state=JSON.parse(await fn(JSON.stringify(state)));}};
 const current=()=>state.reviewedDerivatives.records[m.id];
 const metricool={reviewedDerivativeCalendar:async()=>[],preflight:async()=>{if(preflight)await preflight(current(),n=>time+=n);},crossAccountPreflight:async()=>{},schedule:async(_d,item)=>{if(schedule)return schedule(item,current(),calls);await item.beforeWrite();calls.writes++;calls.slots.push(item.scheduledAt);return{id:'777',uuid:'exact-window-777',mediaUrl:m.media.url,commercialDisclosureVerified:true};}};
 return{m,record,calls,store,metricool,current,get time(){return time;},advance:n=>time+=n,args:{owner:'fixture-owner',store,metricool,dispatchMode:'owner_hour_window',config:{enabled:true,killSwitch:false,dryRun:false,destinations:[m.destination]},clock:()=>time,loadFinal:async()=>{calls.loads++;if(load)await load(n=>time+=n);return{file:'/TEST_ONLY_FINAL',cleanup:async()=>{}};},verifyFile:async()=>true,verifyReceipt:async()=>true,liveCheck:async r=>({allowed:true,verifierId:m.rights.licenseTerm.verifierId,manifestSha256:r.manifestSha256,checkedAt:new Date(time).toISOString()}),stager:{upload:async()=>{calls.uploads++;assert.equal(current().delivery.dispatchManifestSha256,digest);assert.ok(current().delivery.resolvedScheduledAt);if(upload)await upload(n=>time+=n);return{id:11,url:'https://github.com/TEST_ONLY/staged-final'};},remove:async()=>{calls.removed++;return true;}}}};
}
import {reviewedMediaHash as awaitHash} from '../shared/clippers-reviewed-derivative.mjs';
test('hour dispatcher chooses after readiness, persists exact digest-bound slot before staging, and provider receives selected slot with no manifest rewrite',async()=>{
 const f=setup({load:async advance=>advance(90000)}),digest=f.record.manifestSha256;const out=await runReviewedDerivatives(f.args);assert.equal(out.scheduled,1,JSON.stringify(out));assert.deepEqual(f.calls.slots,['2026-11-22T15:21:00.000Z']);assert.equal(f.current().manifest.scheduledAt,START);assert.equal(f.current().manifestSha256,digest);assert.equal(f.current().delivery.resolvedScheduledAt,f.calls.slots[0]);await runReviewedDerivatives(f.args);assert.equal(f.calls.writes,1);
 const raw={...f.args,dispatchMode:'exact'};await runReviewedDerivatives(raw);assert.equal(f.calls.writes,1,'old exact runner never consumes hour opt-in');
});
test('missed/future hours do not load; delayed readiness crossing hour and late stage never publish outside approved JIT window',async()=>{
 for(const at of [Date.parse(START)-60000,Date.parse(END)-120000,Date.parse(END)+60000]){const f=setup({at});await runReviewedDerivatives(f.args);assert.equal(f.calls.loads,0);assert.equal(f.calls.uploads,0);}
 const last=setup({at:Date.parse(END)-5*60000,load:async advance=>advance(4*60000)});await runReviewedDerivatives(last.args);assert.equal(last.calls.uploads,0);assert.equal(last.calls.writes,0);
 const late=setup({upload:async advance=>advance(3*60000)});const out=await runReviewedDerivatives(late.args);assert.equal(late.calls.writes,0);assert.equal(late.calls.removed,1);assert.ok(out.held.includes('derivative_conditional_just_in_time_required'));
});
test('revoked permission/altered resolved slot/fresh lease expiry after preflight block actual dispatch and clean only proven unused staging',async()=>{
 for(const preflight of [r=>r.status='revoked',r=>r.delivery.resolvedScheduledAt='2026-11-22T16:01:00.000Z',r=>r.delivery.dispatchManifestSha256='b'.repeat(64),(_r,advance)=>advance(24*3600000)]){const f=setup({preflight});await runReviewedDerivatives(f.args);assert.equal(f.calls.writes,0);assert.equal(f.calls.removed,1);}
});
test('unknown provider attempt retains exact selected slot/source/stage and commercial pause across future runs; no reselection/replay',async()=>{
 const f=setup({schedule:async(item,_r,calls)=>{await item.beforeWrite();calls.writes++;throw Error('unknown_provider_outcome');}});await runReviewedDerivatives(f.args);const selected=f.current().delivery.resolvedScheduledAt;assert.equal(f.calls.writes,1);assert.equal(f.calls.removed,0);f.advance(15*60000);await runReviewedDerivatives(f.args);assert.equal(f.calls.writes,1);assert.equal(f.current().delivery.resolvedScheduledAt,selected);assert.equal(f.current().delivery.status,'verification_pending');
});
test('read-only native reconciliation binds resolved provider slot, rejects changed binding and preserves native copy claims',async()=>{
 const f=setup();await runReviewedDerivatives(f.args);const d=f.current().delivery;delete d.copyVerifiedAt;delete d.confirmedMediaSha256;delete d.confirmedByteLength;let seenSlot;
 f.metricool.reconcileReviewedDerivative=async(_destination,p)=>{seenSlot=p.scheduledAt;return{id:'777',uuid:'exact-window-777',mediaUrl:f.m.media.url,status:'scheduled',commercialDisclosureVerified:true};};
 let out=await reconcileReviewedDerivativeCopies({store:f.store,owner:'fixture-owner',metricool:f.metricool,clock:()=>f.time});assert.equal(out.verified,1);assert.equal(seenSlot,d.resolvedScheduledAt);
 delete f.current().delivery.copyVerifiedAt;f.current().delivery.resolvedScheduledAt='2026-11-22T15:59:00.000Z';out=await reconcileReviewedDerivativeCopies({store:f.store,owner:'fixture-owner',metricool:f.metricool,clock:()=>f.time});assert.equal(out.verified,0);assert.ok(out.held.includes('derivative_copy_binding_unverified'));assert.equal(f.calls.writes,1);
});
