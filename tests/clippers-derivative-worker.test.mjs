import test from 'node:test';
import assert from 'node:assert/strict';
import { runReviewedDerivatives } from '../script/clippers-reviewed-derivative-worker.mjs';
import { derivativeFixture, DERIVATIVE_NOW as NOW } from './helpers/reviewed-derivative-fixture.mjs';
import { reviewedDerivativeDigest, approveReviewedDerivative } from '../shared/clippers-reviewed-derivative.mjs';
import { emptyStreamerState } from '../script/clippers-streamer-discovery.mjs';
import { destinationKey } from '../script/clippers-portfolio-metricool.mjs';
import { parseDerivativeCampaignResponse } from '../script/clippers-derivative-campaign.mjs';
function setup({actual=[],schedule,preflight,upload,liveCheck,verifyFile,records=1}={}){
 const f=derivativeFixture();f.manifest.baseline={fromDay:'2026-11-20',throughDay:'2026-11-24',sourceOriginAt:'2026-11-21T10:00:00Z',originEvidenceReference:'fixture-only:vod-start',originEvidenceSha256:'a'.repeat(64),rows:[]};
 f.proposal.manifestSha256=reviewedDerivativeDigest(f.manifest);const record=f.approved();let state=emptyStreamerState();state.creators[f.manifest.source.creatorKey]={policy:{status:'allowed_unless_prohibited',source:'fixture_checked'}};state.reviewedDerivatives={version:1,records:{[f.manifest.id]:record}};
 const calls={writes:0,uploads:0,removals:0,loads:0,preflights:0};
 const store={read:async()=>JSON.stringify(state),transact:async(_key,fn)=>{state=JSON.parse(await fn(JSON.stringify(state)));}};
 const metricool={reviewedDerivativeCalendar:async()=>actual,preflight:async()=>{calls.preflights++;if(preflight)await preflight(state);},crossAccountPreflight:async()=>{},schedule:async(d,item)=>{if(schedule)return schedule(d,item,state,calls);await item.beforeWrite();calls.writes++;return{commercialDisclosureVerified:true,id:'123',uuid:'uuid-123',mediaUrl:f.manifest.media.url};}};
 const stager={upload:async()=>{calls.uploads++;if(upload)await upload(state);return{id:12,url:'https://github.com/fixture/staging/asset.mp4'};},remove:async()=>{calls.removals++;return true;}};
 const args={owner:'fixture-owner',store,metricool,stager,config:{enabled:true,killSwitch:false,dryRun:false,destinations:[f.manifest.destination],clipsPerRun:5},clock:()=>NOW,
 loadFinal:async()=>{calls.loads++;return{file:'/private/fixture-final',cleanup:async()=>{}};},verifyFile:verifyFile??(async()=>true),verifyReceipt:async()=>true,liveCheck:liveCheck??(async()=>null)};
 return{args,calls,get state(){return state;},manifest:f.manifest,record};
}
test('approved exact final runs shared claim → stage → final write fence → actual ACK, never raw render or rights grant',async()=>{
 const f=setup();const r=await runReviewedDerivatives(f.args);assert.equal(r.scheduled,1);assert.equal(f.calls.writes,1);assert.equal(f.calls.removals,1);
 const p=f.state.cloudPublish.posts[0];assert.equal(p.origin,'owner_authorized_external_review');assert.equal(p.status,'scheduled');assert.equal(p.metricoolUuid,'uuid-123');assert.equal(p.segment.key,'twitch-vod:1234567');assert.equal(p.segment.start,303);assert.equal(f.state.sourceAuthorizations,undefined);assert.equal(f.state.cloudPublish.clips['twitch-clip:FixtureClip'],undefined);
 const second=await runReviewedDerivatives(f.args);assert.equal(second.scheduled,0);assert.equal(f.calls.writes,1);
});
test('disabled/kill/dry-run perform no provider or file operations',async()=>{
 for(const c of [{enabled:false},{killSwitch:true},{dryRun:true}]){const f=setup();Object.assign(f.args.config,c);const r=await runReviewedDerivatives(f.args);assert.equal(r.status,'disabled');assert.equal(f.calls.loads,0);assert.equal(f.calls.uploads,0);assert.equal(f.calls.writes,0);}
});
test('revocation, current creator prohibition, changed final and destination mismatch after preflight prevent actual write and clean staging',async()=>{
 for(const mutation of [s=>s.reviewedDerivatives.records['derivative-fixture'].status='revoked',s=>s.creators['twitch:12345'].policy.status='prohibited',s=>s.reviewedDerivatives.records['derivative-fixture'].manifest.media.sha256='d'.repeat(64),s=>s.reviewedDerivatives.records['derivative-fixture'].manifest.destination.account='other']){
 const f=setup({preflight:mutation});const r=await runReviewedDerivatives(f.args);assert.equal(f.calls.writes,0);assert.equal(f.calls.uploads,1);assert.equal(f.calls.removals,1);assert.equal(f.state.cloudPublish.posts.length,0);assert.ok(r.held.length);
 }
 const f=setup({verifyFile:async()=>{throw Error('derivative_final_file_changed');}});await runReviewedDerivatives(f.args);assert.equal(f.calls.writes,0);assert.equal(f.calls.uploads,0);
});
test('missing source mapping and changed actual receipt hold before public staging; existing uncertain/source claims hold',async()=>{
 const row={id:'old-1',uuid:'old-uuid',destinationKey:destinationKey(derivativeFixture().manifest.destination),scheduledAt:new Date(NOW).toISOString(),caption:'unknown manual',mediaUrl:'https://static.metricool.com/unknown/video.mp4'};
 const f=setup({actual:[row]});const r=await runReviewedDerivatives(f.args);assert.equal(f.calls.uploads,0);assert.ok(r.held.includes('derivative_baseline_unmapped_or_changed'));
 const g=setup();g.state.cloudPublish={version:1,clips:{},posts:[{id:'old-claim',status:'verification_pending',candidateId:'twitch-clip:FixtureClip',destinationKey:'6431687:tiktok:streamersclipusa'}],holds:{},heldQueue:[]};const q=await runReviewedDerivatives(g.args);assert.equal(g.calls.uploads,0);assert.ok(q.held.includes('derivative_source_or_media_duplicate'));
});
test('provider ambiguity retains staging and durable pending source reservation; never resends',async()=>{
 const f=setup({schedule:async(_d,item,_s,calls)=>{await item.beforeWrite();calls.writes++;throw Error('metricool_request_outcome_uncertain');}});const r=await runReviewedDerivatives(f.args);assert.equal(r.verificationPending,1);assert.equal(f.calls.removals,0);assert.equal(f.state.cloudPublish.posts[0].status,'verification_pending');assert.equal(f.state.reviewedDerivatives.records['derivative-fixture'].delivery.asset.id,12);
 await runReviewedDerivatives(f.args);assert.equal(f.calls.writes,1);
});
test('source lease reserves against an overlapping competing raw claim inserted during preflight',async()=>{
 const f=setup({preflight:s=>s.cloudPublish.posts.push({id:'competing-write',status:'verification_pending',candidateId:'twitch-clip:Other',segment:{key:'twitch-vod:1234567',start:310},destinationKey:'6431687:tiktok:streamersclipusa'})});const r=await runReviewedDerivatives(f.args);assert.equal(f.calls.writes,0);assert.ok(r.held.includes('derivative_source_or_media_duplicate'));assert.equal(f.state.cloudPublish.posts[0].id,'competing-write');
});
test('positive owner-attributed manual source receipt is matched against fresh API identity/media/caption and reserves original intervals',async()=>{
 const f=setup();const m=f.manifest;const proof={id:'777',uuid:'manual-777',destinationKey:destinationKey(m.destination),scheduledAt:'2026-11-21T18:00:00.000Z',mediaUrl:'https://static.metricool.com/manual/known.mp4',mediaSha256:'d'.repeat(64),byteLength:1536,captionSha256:'',sourceId:'twitch-clip:OlderSource',segment:{key:'twitch-vod:9999',start:500}};
 const {reviewedMediaHash}=await import('../shared/clippers-reviewed-derivative.mjs');proof.captionSha256=reviewedMediaHash('exact manual caption');m.baseline.rows=[proof];
 f.record.manifestSha256=reviewedDerivativeDigest(m);f.record.approval.manifestSha256=f.record.manifestSha256;
 f.args.metricool.reviewedDerivativeCalendar=async()=>[{...proof,caption:'exact manual caption'}];const r=await runReviewedDerivatives(f.args);assert.equal(r.scheduled,1);assert.equal(f.state.cloudPublish.mediaLedger[0].origin,'owner_attributed_metricool_readback');
});
test('primary campaign parser accepts only exact fresh active no-store query; paused/stale/cached/wrong UUID fail',()=>{
 const id='a5c63fad-cd53-4b81-9305-4a2d1696872a';const q={queryKey:['campaigns','detail',id],state:{status:'success',data:{id,status:'active'},dataUpdatedAt:NOW}};
 const html=x=>'<span>Accepting clips</span><script>self.__next_f.push('+JSON.stringify([1,'1:'+JSON.stringify(x)+'\n'])+')</script>';
 const input={id,url:'https://contentrewards.com/c/campaigns/'+id,status:200,headers:new Headers({'date':new Date(NOW).toUTCString(),'cache-control':'private, no-store'}),html:html(q),now:NOW};
 assert.equal(parseDerivativeCampaignResponse(input).doesNotProveMembership,true);
 for(const change of [x=>x.state.data.status='paused',x=>x.state.data.id='00000000-0000-0000-0000-000000000000',x=>x.state.dataUpdatedAt=NOW-121000]){const x=structuredClone(q);change(x);assert.throws(()=>parseDerivativeCampaignResponse({...input,html:html(x)}));}
 assert.throws(()=>parseDerivativeCampaignResponse({...input,headers:new Headers({'date':new Date(NOW).toUTCString(),'cache-control':'max-age=600','age':'2'})}));
 assert.throws(()=>parseDerivativeCampaignResponse({...input,html:input.html+input.html}));
});

test('unverified GraphQL VOD anchor reserves the entire VOD, never estimates absolute non-overlap',async()=>{
 const f=setup();f.manifest.source.vodOffsetSeconds=null;f.manifest.source.vodAnchor.quality='unverified';f.record.manifestSha256=reviewedDerivativeDigest(f.manifest);f.record.approval.manifestSha256=f.record.manifestSha256;
 const r=await runReviewedDerivatives(f.args);assert.equal(r.scheduled,1);assert.deepEqual(f.state.cloudPublish.posts[0].segment,{key:'twitch-vod:1234567',start:null});
 const g=setup();g.manifest.source.vodOffsetSeconds=null;g.manifest.source.vodAnchor.quality='unverified';g.record.manifestSha256=reviewedDerivativeDigest(g.manifest);g.record.approval.manifestSha256=g.record.manifestSha256;
 g.state.cloudPublish={version:1,clips:{},posts:[{id:'very-distant-anchor',status:'verification_pending',candidateId:'twitch-clip:Other',destinationKey:'6431687:tiktok:streamersclipusa',scheduledAt:'2026-11-23T17:00:00Z',segment:{key:'twitch-vod:1234567',start:99999}}],holds:{},heldQueue:[]};await runReviewedDerivatives(g.args);assert.equal(g.calls.writes,0);
});
test('conditional campaigns dispatch only 1–5 minutes before the exact approved slot and never retime',async()=>{
 for(const minutes of [180,3]){const f=setup();const m=f.manifest;m.caption+=' #ad';m.captionSha256=(await import('../shared/clippers-reviewed-derivative.mjs')).reviewedMediaHash(m.caption);m.qa.captionSha256=m.captionSha256;
 m.scheduledAt=new Date(NOW+minutes*60000).toISOString();m.windowStart=new Date(NOW).toISOString();m.windowEnd=new Date(NOW+4*3600000).toISOString();m.expiresAt=m.windowEnd;
 m.rights.licenseTerm={kind:'conditional_live',verifierId:'contentrewards_campaign_active_v1',campaignId:'a5c63fad-cd53-4b81-9305-4a2d1696872a'};m.rights.membership={campaignId:m.rights.licenseTerm.campaignId,joinedObservedAt:new Date(NOW).toISOString(),evidenceReference:'fixture-only:joined',evidenceSha256:'a'.repeat(64),leaseExpiresAt:new Date(NOW+4*3600000).toISOString(),operationalConditionAttested:true};f.record.manifestSha256=reviewedDerivativeDigest(m);f.record.approval.manifestSha256=f.record.manifestSha256;
 f.args.liveCheck=async()=>({allowed:true,verifierId:m.rights.licenseTerm.verifierId,manifestSha256:f.record.manifestSha256,checkedAt:new Date(NOW).toISOString()});const r=await runReviewedDerivatives(f.args);assert.equal(f.calls.writes,minutes===3?1:0);if(minutes===180){assert.equal(f.calls.loads,0);assert.ok(r.held.includes('derivative_conditional_just_in_time_required'));}}
});
test('distinct concurrent pipelines reserve per-network hours and active quota; draft reservations do not fake coverage',async()=>{
 const f=setup();f.state.cloudPublish={version:1,clips:{},posts:Array.from({length:5},(_,i)=>({id:'other-'+i,status:'verification_pending',candidateId:'twitch-clip:Other'+i,destinationKey:destinationKey(f.manifest.destination),scheduledAt:new Date(NOW+(i+4)*3600000).toISOString()})),holds:{},heldQueue:[]};let r=await runReviewedDerivatives(f.args);assert.equal(f.calls.writes,0);assert.ok(r.held.includes('derivative_daily_quota_reserved'));
 const g=setup();g.state.cloudPublish={version:1,clips:{},posts:[{id:'held-draft',status:'scheduled',draft:true,metricoolId:'888',candidateId:'twitch-clip:Other',destinationKey:destinationKey(g.manifest.destination),scheduledAt:g.manifest.scheduledAt}],holds:{},heldQueue:[]};r=await runReviewedDerivatives(g.args);assert.equal(g.calls.writes,0);assert.ok(r.held.includes('derivative_slot_reserved'));
});

test('finished or unknown first records never starve a later due record beyond clipsPerRun',async()=>{
 const f=setup();const fifth=f.state.reviewedDerivatives.records['derivative-fixture'];const records={};for(let i=0;i<4;i++){const r=structuredClone(fifth);r.manifest.id='earlier-'+i;r.manifest.thirdPartyCommercial=false;r.delivery={id:'prior-'+i,status:i===0?'verification_pending':'scheduled',writeStartedAt:new Date(NOW-86400000).toISOString()};records[r.manifest.id]=r;}records['derivative-fixture']=fifth;f.state.reviewedDerivatives.records=records;f.args.config.clipsPerRun=4;
 const report=await runReviewedDerivatives(f.args);assert.equal(report.scheduled,1);assert.equal(f.calls.writes,1);
});

test('accepted-but-unacknowledged staging is recovered by claim-bound name; unresolved upload never gets overwritten or loses its reservation',async()=>{
 const f=setup();let name;f.args.stager.upload=async(_file,n)=>{name=n;throw Error('upload_response_lost');};f.args.stager.findAsset=async n=>{assert.equal(n,name);return{id:99,url:'https://github.com/fixture/recovered.mp4'};};let report=await runReviewedDerivatives(f.args);assert.equal(f.calls.writes,0);assert.equal(f.calls.removals,1);assert.equal(f.state.cloudPublish.reviewedDerivativeClaims.length,0);assert.equal(f.state.reviewedDerivatives.records['derivative-fixture'].delivery.stageIntent,null);
 const g=setup();g.args.stager.upload=async()=>{throw Error('upload_response_lost');};report=await runReviewedDerivatives(g.args);assert.equal(g.state.reviewedDerivatives.records['derivative-fixture'].delivery.status,'held_staging_reconciliation');assert.equal(g.state.cloudPublish.reviewedDerivativeClaims.length,1);await runReviewedDerivatives(g.args);assert.equal(g.calls.writes,0);assert.equal(g.calls.loads,1);
 g.args.clock=()=>NOW+11*60000;g.args.config.clipsPerRun=0;g.args.stager.findAsset=async()=>({id:100,url:'https://github.com/fixture/recovered-later.mp4'});report=await runReviewedDerivatives(g.args);assert.equal(report.assetsRemoved,1);assert.equal(g.state.cloudPublish.reviewedDerivativeClaims.length,0);assert.equal(g.state.cloudPublish.posts.length,0);
});
test('a lost transaction response after committing pending_write preserves durable unknown staging and source claims',async()=>{
 const f=setup();const original=f.args.store.transact;let lost=false;f.args.store.transact=async(k,fn)=>{const result=await original(k,fn);if(!lost&&f.state.reviewedDerivatives.records['derivative-fixture'].delivery?.writeStartedAt){lost=true;throw Error('commit_response_lost');}return result;};
 const r=await runReviewedDerivatives(f.args);assert.equal(f.calls.writes,0);assert.equal(f.calls.removals,0);assert.equal(r.verificationPending,1);assert.equal(f.state.cloudPublish.reviewedDerivativeClaims.length,1);assert.equal(f.state.cloudPublish.posts[0].status,'pending_write');await runReviewedDerivatives(f.args);assert.equal(f.calls.writes,0);
});

test('far future conditional proposals before a later due proposal consume no admission budget or network work',async()=>{
 const f=setup(),m=f.manifest;const {reviewedMediaHash}=await import('../shared/clippers-reviewed-derivative.mjs');m.caption+=' #ad';m.captionSha256=reviewedMediaHash(m.caption);m.qa.captionSha256=m.captionSha256;
 m.rights.licenseTerm={kind:'conditional_live',verifierId:'contentrewards_campaign_active_v1',campaignId:'a5c63fad-cd53-4b81-9305-4a2d1696872a'};m.rights.membership={campaignId:m.rights.licenseTerm.campaignId,joinedObservedAt:new Date(NOW).toISOString(),evidenceReference:'fixture-only:joined',evidenceSha256:'a'.repeat(64),leaseExpiresAt:new Date(NOW+6*3600000).toISOString(),operationalConditionAttested:true};m.windowStart=new Date(NOW).toISOString();m.windowEnd=new Date(NOW+5*3600000).toISOString();m.expiresAt=m.windowEnd;
 const records={};for(let i=0;i<5;i++){const manifest=structuredClone(m);manifest.id='conditional-'+i;manifest.scheduledAt=new Date(NOW+(i<4?(i+1)*3600000:180000)).toISOString();const digest=reviewedDerivativeDigest(manifest);records[manifest.id]=approveReviewedDerivative({status:'proposed',manifest,manifestSha256:digest},{principal:'fixture-owner',operatorLabel:'TEST ONLY',now:NOW,expectedDigest:digest,attestRights:true,attestExternalQa:true});}
 f.state.reviewedDerivatives.records=records;f.args.config.clipsPerRun=4;let checks=0;f.args.liveCheck=async r=>{checks++;assert.equal(r.manifest.id,'conditional-4');return{allowed:true,verifierId:m.rights.licenseTerm.verifierId,manifestSha256:r.manifestSha256,checkedAt:new Date(NOW).toISOString()};};const report=await runReviewedDerivatives(f.args);assert.equal(report.scheduled,1);assert.equal(f.calls.writes,1);assert.equal(f.calls.loads,1);assert.ok(checks>0);
});

test('cleanup rechecks/fences durable state before deletion, preserving a concurrent pending provider write',async()=>{
 const f=setup();f.record.status='revoked';f.record.delivery={id:'old-claim',status:'pending_stage',asset:{id:81,url:'https://github.com/fixture/old.mp4'},leaseUntil:new Date(NOW-1).toISOString()};f.state.cloudPublish={version:1,clips:{},posts:[{id:'old-claim',status:'pending_stage',candidateId:f.manifest.source.candidateId,destinationKey:destinationKey(f.manifest.destination)}],holds:{},heldQueue:[],reviewedDerivativeClaims:[{claimId:'old-claim',candidateId:f.manifest.source.candidateId}]};
 const original=f.args.store.transact;let raced=false;f.args.store.transact=async(k,fn)=>{if(!raced){raced=true;const d=f.state.reviewedDerivatives.records['derivative-fixture'].delivery;d.status='pending_write';d.writeStartedAt=new Date(NOW).toISOString();f.state.cloudPublish.posts[0].status='pending_write';}return original(k,fn);};
 await runReviewedDerivatives(f.args);assert.equal(f.calls.removals,0);assert.equal(f.state.cloudPublish.posts[0].status,'pending_write');assert.equal(f.state.cloudPublish.reviewedDerivativeClaims.length,1);
});
test('lease-expired claim-before-intent crash releases only the provably unused reservation, and cleanup status fences before delete',async()=>{
 for(const hasAsset of [false,true])for(const previousStatus of ['pending_stage','cleanup_fenced']){const f=setup();f.record.delivery={id:'crashed-claim',status:previousStatus,leaseUntil:new Date(NOW-1).toISOString(),...(hasAsset?{asset:{id:91,url:'https://github.com/fixture/old.mp4'}}:{})};f.state.cloudPublish={version:1,clips:{},posts:[{id:'crashed-claim',status:'pending_stage',candidateId:f.manifest.source.candidateId,destinationKey:destinationKey(f.manifest.destination)}],holds:{},heldQueue:[],reviewedDerivativeClaims:[{claimId:'crashed-claim',candidateId:f.manifest.source.candidateId}]};f.args.config.clipsPerRun=0;
 f.args.stager.remove=async()=>{assert.equal(f.state.reviewedDerivatives.records['derivative-fixture'].delivery.status,'cleanup_fenced');return true;};await runReviewedDerivatives(f.args);assert.equal(f.state.cloudPublish.posts.length,0);assert.equal(f.state.cloudPublish.reviewedDerivativeClaims.length,0);assert.equal(f.state.reviewedDerivatives.records['derivative-fixture'].delivery.status,'held_before_write');}
});

test('missing paid-disclosure readback retains exact UUID/staging/source reservation, stops the batch and never retries',async()=>{
 const f=setup({schedule:async(_d,item,_state,calls)=>{await item.beforeWrite();calls.writes++;return{id:'paid-777',uuid:'exact-paid-uuid',mediaUrl:'https://static.metricool.com/fixture/final.mp4',commercialDisclosureVerified:false};}});
 const second=structuredClone(f.record);second.manifest.id='second-pending';second.manifest.scheduledAt=new Date(NOW+4*3600000).toISOString();second.manifest.windowEnd=new Date(NOW+5*3600000).toISOString();second.manifestSha256=reviewedDerivativeDigest(second.manifest);second.approval.manifestSha256=second.manifestSha256;f.state.reviewedDerivatives.records[second.manifest.id]=second;
 const r=await runReviewedDerivatives(f.args);assert.equal(r.scheduled,0);assert.equal(r.verificationPending,1);assert.equal(f.calls.writes,1);assert.equal(f.calls.loads,1);assert.equal(f.calls.removals,0);assert.ok(r.held.includes('derivative_commercial_disclosure_unverified'));
 const delivery=f.state.reviewedDerivatives.records['derivative-fixture'].delivery;assert.equal(delivery.status,'verification_pending');assert.equal(delivery.metricoolUuid,'exact-paid-uuid');assert.equal(delivery.asset.id,12);assert.equal(f.state.cloudPublish.reviewedDerivativeClaims.length,1);
 await runReviewedDerivatives(f.args);assert.equal(f.calls.writes,1);assert.equal(f.calls.loads,1);assert.equal(f.state.reviewedDerivatives.records['second-pending'].delivery,undefined);
});

test('persistent commercial pause leaves an independently authorized noncommercial derivative eligible',async()=>{
 const f=setup();f.state.reviewedDerivatives.records['old-commercial']=structuredClone(f.record);f.state.reviewedDerivatives.records['old-commercial'].delivery={id:'prior-paid',status:'verification_pending',writeStartedAt:new Date(NOW).toISOString(),reason:'derivative_commercial_disclosure_unverified'};
 const m=f.manifest;m.thirdPartyCommercial=false;f.record.manifestSha256=reviewedDerivativeDigest(m);f.record.approval.manifestSha256=f.record.manifestSha256;const r=await runReviewedDerivatives(f.args);assert.equal(r.scheduled,1);assert.equal(f.calls.writes,1);assert.ok(r.held.includes('derivative_commercial_lane_reconciliation_required'));
});

test('commercial provider timeout after write durably pauses later paid runs even without an ACK reason or known UUID',async()=>{
 const f=setup({schedule:async(_d,p,_s,calls)=>{await p.beforeWrite();calls.writes++;throw Error('provider_timeout_after_write');}});const next=structuredClone(f.record);next.manifest.id='later-paid';next.manifest.scheduledAt=new Date(NOW+4*3600000).toISOString();next.manifest.windowEnd=new Date(NOW+5*3600000).toISOString();next.manifestSha256=reviewedDerivativeDigest(next.manifest);next.approval.manifestSha256=next.manifestSha256;f.state.reviewedDerivatives.records[next.manifest.id]=next;
 let r=await runReviewedDerivatives(f.args);assert.equal(f.calls.writes,1);assert.equal(f.calls.loads,1);assert.equal(r.verificationPending,1);r=await runReviewedDerivatives(f.args);assert.equal(f.calls.writes,1);assert.equal(f.calls.loads,1);assert.ok(r.held.includes('derivative_commercial_lane_reconciliation_required'));
});
test('cleanup cannot overwrite a newly discovered upload asset reported by the original worker catch',async()=>{
 const f=setup();f.record.delivery={id:'old-claim',status:'pending_stage',asset:{id:81,url:'https://github.com/fixture/old.mp4'},stageIntent:{name:'rdv-old-claim.mp4'},leaseUntil:new Date(NOW-1).toISOString()};f.state.cloudPublish={version:1,clips:{},posts:[{id:'old-claim',status:'pending_stage'}],holds:{},heldQueue:[],reviewedDerivativeClaims:[{claimId:'old-claim'}]};f.args.config.clipsPerRun=0;
 f.args.stager.remove=async id=>{assert.equal(id,81);const d=f.state.reviewedDerivatives.records['derivative-fixture'].delivery;d.status='held_staging_reconciliation';d.asset={id:99,url:'https://github.com/fixture/late-upload.mp4'};return true;};await runReviewedDerivatives(f.args);const d=f.state.reviewedDerivatives.records['derivative-fixture'].delivery;assert.equal(d.asset.id,99);assert.equal(d.status,'held_staging_reconciliation');assert.equal(f.state.cloudPublish.reviewedDerivativeClaims.length,1);
});
