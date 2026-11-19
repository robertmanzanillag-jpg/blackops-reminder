import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { DESTINATIONS, HISTORICAL_DESTINATIONS, findDestination, findPublishDestination,
  publicationDestinationKey, verifyIdentityPin } from '../script/clippers-destination-registry.mjs';
import { createPortfolioMetricool, exactPost } from '../script/clippers-portfolio-metricool.mjs';
import { verifiedExternalSchedules, nativeReceiptDigest } from '../script/clippers-native-media-receipts.mjs';
const sha=v=>createHash('sha256').update(String(v)).digest('hex');
const destination=DESTINATIONS[0];
const pin={...destination,ownerSha256:sha('12'),providerIdSha256:sha('synthetic-account-id')};
const detail=()=>({id:destination.brandId,ownerUserId:'12',networksData:{tiktokData:{username:destination.account,providerUserId:'synthetic-account-id'}}});
test('exact four current tuples; historical aliases validate receipts but create no destinations or slots',()=>{
 assert.equal(DESTINATIONS.length,4);assert.equal(new Set(DESTINATIONS.map(d=>d.brandId+':'+d.network)).size,4);
 for(const old of HISTORICAL_DESTINATIONS){assert.deepEqual(findDestination(old),old);assert.equal(findPublishDestination(old),undefined);assert.equal(publicationDestinationKey(old),publicationDestinationKey(DESTINATIONS.find(d=>d.brandId===old.brandId&&d.network===old.network)));}
 assert.equal(findDestination({brandId:6595747,network:'facebook',account:'1198281286708321'}),undefined);
 assert.equal(findPublishDestination({...destination,brandId:String(destination.brandId)}),undefined);
});
test('reviewed provider and owner hashes bind scoped response; handle alone never authorizes',()=>{
 assert.equal(verifyIdentityPin({data:detail()},destination,'12',pin),true);
 for(const mutate of [d=>d.ownerUserId='13',d=>d.id++,d=>d.deleted=true,d=>d.networksData.tiktokData.providerUserId='new-relinked-account',d=>delete d.networksData.tiktokData.providerUserId,d=>d.networksData.tiktokData.username='other',d=>d.networksData.tiktokData.connected=false,d=>d.networksData.tiktokData.expired=true]){
  const d=detail();mutate(d);assert.equal(verifyIdentityPin(d,destination,'12',pin),false);
 }
 assert.equal(verifyIdentityPin(detail(),destination,'13',pin),false);
 assert.equal(verifyIdentityPin({data:[detail(),detail()]},destination,'12',pin),false);
 assert.equal(verifyIdentityPin(detail(),HISTORICAL_DESTINATIONS[0],'12',pin),false);
});
test('production adapter blocks historical publication before all IO and denies unpinned current identity before writes',async()=>{
 let reads=0,writes=0;const adapter=createPortfolioMetricool({token:'synthetic-no-real-token',userId:'12',fetcher:async(url,options={})=>{
  if(options.method==='POST'){writes++;assert.fail('no write');}reads++;assert.match(new URL(url).pathname,/\/settings\/brands\/6431685$/);assert.equal(new URL(url).searchParams.get('blogId'),'6431685');return Response.json(detail());
 }});
 for(const old of HISTORICAL_DESTINATIONS)await assert.rejects(adapter.schedule(old,{scheduledAt:'2026-11-20T18:00:00.000Z'}),/not_allowlisted_publish_current/);
 assert.equal(reads,0);await assert.rejects(adapter.destinationSettings(destination),/identity_unverified/);assert.equal(reads,1);assert.equal(writes,0);
});
test('legacy external receipt and exact original public URL remain valid without rewriting its digest',()=>{
 const destination=HISTORICAL_DESTINATIONS[0],now=new Date('2026-11-19T22:00:00.000Z');
 const r={schemaVersion:1,origin:'external_owner_ui',kind:'external_schedule_observation',assetId:'old-asset',destination,sourceUrl:'https://www.youtube.com/watch?v=aaaaaaaaaaa',caption:'Actual historical caption',metricoolId:'433015962',scheduledAt:'2026-11-18T15:45:00.000Z',mediaUrl:'https://static.metricool.com/video/123/202611/old.mp4',sha256:'a'.repeat(64),sizeBytes:100,renderReceiptSha256:'b'.repeat(64),observedAt:'2026-11-18T16:00:00.000Z',confirmation:'exact_scheduler_get_and_native_bytes',publicationState:'not_evaluated',paidSpendUsd:0};
 const sealed={...r,proofSha256:nativeReceiptDigest(r)},before=JSON.stringify(sealed);
 assert.equal(verifiedExternalSchedules([sealed],now).length,1);assert.equal(JSON.stringify(sealed),before);
 assert.equal(exactPost('https://www.tiktok.com/@streamersclips/video/7709544295480511774',destination)?.id,'7709544295480511774');
 assert.equal(exactPost('https://www.tiktok.com/@streamersclips/video/7709544295480511774',DESTINATIONS[0]),null);
});
