import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {emptyStreamerState,STREAMER_STATE_NAMESPACE} from '../script/clippers-streamer-discovery.mjs';
import {retainLegacyUncertainReservation,mediaEntriesOf,upsertMediaLedgerClaim,boundedMediaLedger,isProtectedMediaClaim,MEDIA_LEDGER_LIMIT} from '../shared/clippers-media-ledger.mjs';
import {runCloudPublisher,dropClaim,publishGate,stagedAssetRemovable,createGithubReleaseStager} from '../script/clippers-streamer-cloud-worker.mjs';
import {mediaConflict} from '../shared/clippers-account-lanes.mjs';
import {createMacLedgerGuard} from '../script/clippers-mac-ledger-guard.mjs';
import {buildCreditCaption} from '../shared/clippers-streamer-policy.mjs';
import {fixtureGrants} from './helpers/clippers-source-authorization-fixture.mjs';
const NOW=Date.parse('2026-11-23T01:00:00.000Z'),KEY='6431685:tiktok:streamersus',OTHER='6431687:tiktok:streamersclipusa';
const DEST={account:'streamersus',brandId:6431685,network:'tiktok'};
// Exact public source/segment/hash/planned-time tuples from the read-only production observation.
// Missing attempt time remains null; synthetic asset IDs exercise retention, not historical execution or provider receipt proof.
const rows=[
 ['stc-08191cb9744c895aea1648ce','twitch-clip:RamshackleLaconicLapwingSpicyBoy-vXH5sbEmR5KAzDO7','twitch-vod:2933861646',4219,'4b560f2a9cc0abc15b8bbe9609d78d7e739f79586736c5b5f0ab78c3c0a377e0','2026-11-22T15:00:00.000Z',900000001],
 ['stc-43d2f78c45fba3269f09c6dd','twitch-clip:ArborealVictoriousSnailDatSheffy-LUDJxQAqZjCXFVjP','twitch-vod:2934155295',31327,'5a986a48d76c59ea9e948870c26d90e689c14c94ffa6afbeb34ec35f15af4c5b','2026-11-22T21:00:00.000Z',900000002],
 ['stc-72cb065b6ce508505a5e7521','twitch-clip:AssiduousTacitCurlewBigBrother-iONSnZn21uUITjLw','twitch-moment:twitch:220476955',1795062584,'3155793c9307af500d5180410fb38e8d4d1837f7c7e7f27139e925b5708e517a','2026-11-22T17:00:00.000Z',900000003]
].map(([id,candidateId,key,start,mediaSha256,scheduledAt,assetId],i)=>({id,candidateId,sourceId:candidateId,segment:{key,start},physicalSource:null,mediaSha256,scheduledAt,status:i===1?'pending_write':'verification_pending',destination:DEST,destinationKey:KEY,mediaUrl:`https://github.com/fixture/only/media-${assetId}.mp4`,attemptedAt:null,metricoolId:null,metricoolUuid:null,assetId}));
const env={CLIPPERS_STREAMER_CLOUD_PUBLISH_ENABLED:'true',CLIPPERS_STREAMER_LANES_ENABLED:'false',CLIPPERS_STREAMER_CLOUD_CLIPS_PER_RUN:'0',METRICOOL_USER_TOKEN:'fixture-token',METRICOOL_USER_ID:'fixture-user'};
function stateOf(posts=rows){const state=emptyStreamerState();state.cloudPublish={version:1,clips:Object.fromEntries(posts.filter(p=>p.candidateId).map(p=>[p.candidateId,{status:'verification_pending',mediaAsset:{id:p.assetId,url:p.mediaUrl}}])),posts:structuredClone(posts),mediaLedger:[],holds:{},heldQueue:[]};return state;}
function memory(initial){let raw=JSON.stringify(initial);return{get state(){return JSON.parse(raw);},set state(value){raw=JSON.stringify(value);},read:async()=>raw,transact:async(_ns,fn)=>{const next=await fn(raw);raw=next;return next;}};}
async function reconcile(store,{confirm=async()=>null}={}){const calls={writes:0,removals:[],keep:null};const result=await runCloudPublisher({env,now:NOW,clock:()=>NOW,owner:'fixture-owner',store,approvals:{statuses:async()=>new Map()},metricool:{confirmSchedule:confirm,schedule:async()=>{calls.writes++;throw Error('no writes allowed');}},stager:{remove:async id=>{calls.removals.push(id);return true;},sweep:async({keep})=>{calls.keep=keep;return 0;}}});return{...result,calls};}
test('all three real source tuples retain unresolved/no-replay claims before absence transition and survive >600 post trim',async()=>{
 const store=memory(stateOf()),first=await reconcile(store);assert.equal(first.report.counts.reconciled,3);assert.equal(first.calls.writes,0);assert.equal(first.calls.removals.length,0);
 let c=store.state.cloudPublish;assert.ok(c.posts.every(p=>p.status==='not_found'));assert.equal(c.mediaLedger.length,3);for(const row of rows){const claim=c.mediaLedger.find(e=>e.postId===row.id);assert.ok(isProtectedMediaClaim(claim));assert.equal(claim.noReplay,true);assert.equal(claim.deliveryState,'historically_unresolved');assert.equal(claim.currentCalendarAbsenceOnly,true);assert.equal(claim.previousStatus,row.status);assert.equal(claim.attemptedAt,null);assert.equal(claim.metricoolId,null);assert.equal(claim.metricoolUuid,null);assert.deepEqual(claim.segment,row.segment);assert.deepEqual(claim.physicalSource,row.physicalSource);assert.equal(claim.mediaSha256,row.mediaSha256);assert.equal(first.calls.keep.has(row.assetId),true);assert.equal(stagedAssetRemovable(c,row.candidateId,row.mediaUrl,NOW),false);}
 const state=store.state;state.cloudPublish.posts.push(...Array.from({length:650},(_,i)=>({id:'unrelated-'+i,status:'not_found'})));store.state=state;await reconcile(store);c=store.state.cloudPublish;assert.equal(c.posts.length,600);assert.equal(c.posts.some(p=>rows.some(r=>r.id===p.id)),false);assert.equal(c.mediaLedger.length,3);
 for(const row of rows){const conflict=mediaConflict(mediaEntriesOf(c),{candidateId:'another-clip',segment:{...row.segment,start:row.segment.start+1},mediaSha256:'f'.repeat(64),destinationKey:OTHER});assert.equal(conflict.reason,'cross_account_duplicate');assert.equal(conflict.entry.noReplay,true);}
});
test('protected claims survive dropClaim, same-candidate upsert and tail eviction; required claims fail closed at protected capacity',()=>{
 const c=stateOf().cloudPublish,claim=retainLegacyUncertainReservation(c,c.posts[0],{now:NOW});assert.equal(retainLegacyUncertainReservation(c,c.posts[0],{now:NOW+1}),claim,'same attempt is immutable/idempotent');
 c.mediaLedger.push({candidateId:claim.candidateId,destinationKey:KEY});dropClaim(c,{candidateId:claim.candidateId,destinationKey:KEY});assert.deepEqual(c.mediaLedger,[claim]);
 upsertMediaLedgerClaim(c,{candidateId:claim.candidateId,destinationKey:KEY,segment:{key:'another',start:0}});assert.equal(c.mediaLedger.includes(claim),true);
 c.mediaLedger=[claim,...Array.from({length:5000},(_,i)=>({candidateId:'ordinary-'+i,destinationKey:OTHER}))];const required={candidateId:'new',destinationKey:OTHER};c.mediaLedger=boundedMediaLedger([...c.mediaLedger,required],{required:[required]});assert.equal(c.mediaLedger.length,5000);assert.equal(c.mediaLedger.includes(claim),true);assert.equal(c.mediaLedger.includes(required),true);
 const full={mediaLedger:Array.from({length:MEDIA_LEDGER_LIMIT},(_,i)=>({...claim,reservationId:'retained-'+i}))};const before=JSON.stringify(full);assert.throws(()=>upsertMediaLedgerClaim(full,required),/capacity_hold/);assert.equal(JSON.stringify(full),before);
});
test('capacity or incomplete identity failure leaves original status uncertain and stages retained, never silently drops evidence',async()=>{
 for(const kind of ['capacity','identity','oversized']){const state=stateOf([rows[0]]);if(kind==='capacity')state.cloudPublish.mediaLedger=Array.from({length:MEDIA_LEDGER_LIMIT},(_,i)=>({candidateId:'existing-'+i}));else if(kind==='identity')delete state.cloudPublish.posts[0].segment;else state.cloudPublish.posts[0].reason='x'.repeat(9000);
  const store=memory(state),out=await reconcile(store);assert.equal(store.state.cloudPublish.posts[0].status,rows[0].status);assert.equal(out.report.counts.reconciled,0);assert.equal(out.calls.writes,0);assert.equal(out.calls.removals.length,0);assert.ok(out.report.heldReasons.some(r=>r.includes(kind==='identity'?'legacy_uncertain_identity_incomplete':'legacy_uncertain_claim_capacity_hold')));
 }
});
test('provider read on an older snapshot cannot replace a newer attempt or an independently reconciled status',async()=>{
 for(const mutate of [p=>p.status='scheduled',p=>p.attemptedAt='2026-11-22T20:00:00.000Z']){const store=memory(stateOf([rows[0]]));await reconcile(store,{confirm:async()=>{const current=store.state;mutate(current.cloudPublish.posts[0]);store.state=current;return null;}});const c=store.state.cloudPublish;assert.equal(c.mediaLedger.length,0);assert.notEqual(c.posts[0].status,'not_found');}
});
test('protected replay check applies to lanes-off and alternative overlapping candidates/destinations without a publication ACK',()=>{
 const state=stateOf([rows[0]]);retainLegacyUncertainReservation(state.cloudPublish,state.cloudPublish.posts[0],{now:NOW});state.cloudPublish.posts=[];
 const candidate={id:'twitch-clip:DifferentClip',kind:'clip',platform:'twitch',creatorKey:'twitch:100',handle:'fixture',sourceUrl:'https://clips.twitch.tv/DifferentClip',durationSec:30,vodId:'2933861646',vodOffset:4220,publishedAt:new Date(NOW-3600000).toISOString()};candidate.caption=buildCreditCaption({handle:candidate.handle,platform:'twitch',sourceUrl:candidate.sourceUrl,title:'TEST ONLY'});state.candidates=[candidate];state.creators[candidate.creatorKey]={policy:{source:'TEST ONLY',status:'allowed_unless_prohibited'}};state.sourceAuthorizations=fixtureGrants([candidate],NOW);
 assert.equal(publishGate(state,candidate,{now:NOW,destinationKey:OTHER,scheduledAt:new Date(NOW+3600000).toISOString()}),'legacy_uncertain_delivery_requires_reconciliation');assert.equal(state.cloudPublish.mediaLedger[0].metricoolId,null);
 candidate.vodOffset=5000;assert.equal(publishGate(state,candidate,{now:NOW,destinationKey:OTHER}),null);assert.equal(publishGate(state,candidate,{now:NOW,destinationKey:OTHER,segment:rows[0].segment}),'legacy_uncertain_delivery_requires_reconciliation');assert.equal(publishGate(state,candidate,{now:NOW,destinationKey:OTHER,mediaSha256:rows[0].mediaSha256}),'legacy_uncertain_delivery_requires_reconciliation');
});
test('Mac mirror preserves protected shared reservations when tailing ordinary entries and fails closed instead of dropping protected capacity',async t=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'uncertain-mirror-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 for(const full of [false,true]){const initial=stateOf([rows[0]]),c=initial.cloudPublish,claim=retainLegacyUncertainReservation(c,c.posts[0],{now:NOW});c.posts=[];c.mediaLedger=full?Array.from({length:5000},(_,i)=>({...claim,reservationId:'protected-'+i})):[claim,...Array.from({length:4999},(_,i)=>({candidateId:'ordinary-'+i,destinationKey:KEY}))];const store=memory(initial);
  const guard=createMacLedgerGuard({env:{CLIPPERS_RUNTIME:'cloud',OFFICE_OWNER_ID:'fixture-owner'},workspaceRoot:path.join(dir,String(full)),store,metricool:{crossAccountPreflight:async()=>({checkedDays:['2026-11-23']})}});
  const outcome=await guard.reserve(DEST,{id:'new-mirror',caption:'Wait for it, a test only.',mediaSha256:'f'.repeat(64),sourceUrl:'https://youtu.be/abcDEF12345',scheduledAt:'2026-11-23T16:00:00.000Z'});assert.equal(outcome.ok,!full,JSON.stringify(outcome));assert.equal(store.state.cloudPublish.mediaLedger.filter(isProtectedMediaClaim).length,full?5000:1);assert.equal(store.state.cloudPublish.mediaLedger.length,5000);
 }
});


test('optional physical provenance is copied exactly; malformed prior reservation cannot stand in for a retained attempt',()=>{
 const c=stateOf([rows[0]]).cloudPublish;c.posts[0].physicalSource={quality:'verified_physical_file',sha256:'9'.repeat(64),start:10,end:30};const claim=retainLegacyUncertainReservation(c,c.posts[0],{now:NOW});assert.deepEqual(claim.physicalSource,c.posts[0].physicalSource);claim.noReplay=false;assert.throws(()=>retainLegacyUncertainReservation(c,c.posts[0],{now:NOW}),/claim_unverified/);
});


test('reserved public media URL protects an uncertain asset from sweep even when its numeric asset metadata is missing',async()=>{
 const c=stateOf([rows[0]]).cloudPublish;c.clips={};const claim=retainLegacyUncertainReservation(c,c.posts[0],{now:NOW}),deleted=[];
 assert.equal(claim.mediaAsset,null);const stager=createGithubReleaseStager({token:'fixture-only-token',repo:'fixture/only',fetch:async(url,options={})=>{if(options.method==='DELETE'){deleted.push(url);return{status:204};}return{status:200,json:async()=>url.includes('/assets?')?[{id:111,name:'stc-uncertain.mp4',created_at:'2026-11-19T00:00:00Z',browser_download_url:claim.mediaUrl},{id:222,name:'stc-unrelated.mp4',created_at:'2026-11-19T00:00:00Z',browser_download_url:'https://github.com/fixture/only/unrelated.mp4'}]:{id:1}};}});
 assert.equal(await stager.sweep({now:NOW,keepUrls:new Set([claim.mediaUrl])}),1);assert.equal(deleted.length,1);assert.ok(deleted[0].endsWith('/222'));
});
