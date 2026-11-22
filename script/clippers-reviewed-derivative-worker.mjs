// Exact final-file lane: never downloads/renders Twitch or invents canonical producer ACKs.
import { randomUUID } from 'node:crypto';
import { STREAMER_STATE_NAMESPACE, parseStreamerStateStrict } from './clippers-streamer-discovery.mjs';
import { cloudPublishOf, mediaEntriesOf } from '../shared/clippers-media-ledger.mjs';
import { destinationKey, findDestination, localDay, localHour, canonicalDestinationKey } from './clippers-portfolio-metricool.mjs';
import { mediaConflict, sourceSegment } from '../shared/clippers-account-lanes.mjs';
import { reviewedDerivativeGate, reviewedMediaHash } from '../shared/clippers-reviewed-derivative.mjs';
import { validateDerivativeBaseline, matchDerivativeBaseline } from '../shared/clippers-derivative-baseline.mjs';
import { takedownBlocks, resolveClipPolicy } from '../shared/clippers-streamer-policy.mjs';
import { KNOWN_PROHIBITED_CREATORS } from '../shared/clippers-priority-creators.mjs';
import { loadSealedReviewedDerivative, verifySealedDerivativeFile, verifyNativeDerivativeReceipt } from './clippers-reviewed-derivative-media.mjs';
import { loadApprovedDerivativeInstrumental, verifyDerivativeAudioReplacement } from '../shared/clippers-derivative-audio.mjs';
import { checkDerivativeCampaign } from './clippers-derivative-campaign.mjs';
const iso=n=>new Date(n).toISOString();
const reason=e=>/^derivative_[a-z_]+$/.test(e?.message??'')?e.message:'derivative_dependency_unavailable';
function policy(state,m){
  const creator=state.creators?.[m.source.creatorKey],candidate=state.candidates?.find(c=>c.id===m.source.candidateId);
  if(!creator?.policy||creator.policy.source==='not_checked')throw Error('derivative_creator_policy_unverified');
  if(creator.policy.status==='prohibited'||candidate?.clipPolicy?.status==='prohibited'||(takedownBlocks(state.takedowns,{candidateId:m.source.candidateId,creatorKey:m.source.creatorKey,creatorGroupId:creator.creatorGroupId})||(m.source.vodId&&takedownBlocks(state.takedowns,{candidateId:`twitch-vod:${m.source.vodId}`,creatorKey:m.source.creatorKey,creatorGroupId:creator.creatorGroupId})))||resolveClipPolicy({creatorKey:m.source.creatorKey,creatorGroupId:creator.creatorGroupId,candidateId:m.source.candidateId,takedowns:state.takedowns,knownProhibited:KNOWN_PROHIBITED_CREATORS}).status==='prohibited')throw Error('derivative_takedown_or_prohibited');
  if(state.cloudPublish?.holds?.[destinationKey(m.destination)]?.status==='held_owner_action')throw Error('derivative_destination_owner_hold');
}
function quota(c,m,actual,excludeId=null){
 const key=destinationKey(m.destination),day=localDay(new Date(m.scheduledAt)),hour=localHour(m.scheduledAt);
 const rows=actual.filter(r=>r.destinationKey===key&&localDay(new Date(r.scheduledAt))===day);
 const local=c.posts.filter(p=>p.id!==excludeId&&canonicalDestinationKey(p.destinationKey)===key&&!['deferred','blocked','not_found'].includes(p.status));
 if(local.some(p=>!Number.isFinite(Date.parse(p.scheduledAt))))throw Error('derivative_local_quota_unverified');
 const extras=local.filter(p=>localDay(new Date(p.scheduledAt))===day&&!rows.some(r=>String(p.metricoolId)===r.id));
 if([...rows,...extras].some(r=>localHour(r.scheduledAt)===hour))throw Error('derivative_slot_reserved');
 if(rows.filter(r=>r.confirmedNonPublishingDraft!==true).length+extras.filter(p=>!(p.draft===true&&p.status==='scheduled'&&p.metricoolId)).length>=5)throw Error('derivative_daily_quota_reserved');
}
function physicalOf(m){return{quality:'verified_physical_file',sha256:m.source.artifactSha256,start:m.source.startSeconds,end:m.source.endSeconds};}
function derivativeSegment(m){
 if(m.source.vodAnchor.quality==='independently_verified_start')return sourceSegment(candidateOf(m),{start:m.source.startSeconds});
 return {key:m.source.vodId?`twitch-vod:${m.source.vodId}`:`twitch-creator:${m.source.creatorKey}`,start:null};
}
function candidateOf(m){return{id:m.source.candidateId,creatorKey:m.source.creatorKey,platform:'twitch',vodId:m.source.vodId,vodOffset:m.source.vodOffsetSeconds,publishedAt:m.source.publishedAt};}
function mappedBaseline(m,posts,actual){
  const rows=[...m.baseline.rows];
  for(const row of actual){if(rows.some(r=>r.destinationKey===row.destinationKey&&r.uuid===row.uuid))continue;
    const p=posts.find(p=>p.status==='scheduled'&&String(p.metricoolId)===row.id&&p.destinationKey===row.destinationKey&&p.scheduledAt===row.scheduledAt&&p.caption===row.caption&&(p.confirmedMediaUrl??p.mediaUrl)===row.mediaUrl&&p.mediaSha256&&p.segment&&p.candidateId&&p.byteLength);
    if(p)rows.push({...row,caption:undefined,captionSha256:reviewedMediaHash(row.caption),mediaSha256:p.mediaSha256,byteLength:p.byteLength,sourceId:p.candidateId,segment:p.segment,physicalSource:p.physicalSource??null});
  }
  return {...m.baseline,rows};
}
/** Injectable dependencies permit real HTTP/UI tests with dummy providers; production supplies trusted services. */
export async function runReviewedDerivatives({owner,store,metricool,stager,config,clock=Date.now,fetch:fetchImpl=globalThis.fetch,
  loadFinal=loadSealedReviewedDerivative,verifyFile=verifySealedDerivativeFile,verifyReceipt=verifyNativeDerivativeReceipt,
  loadTrack=loadApprovedDerivativeInstrumental,verifyAudio=verifyDerivativeAudioReplacement,liveCheck=checkDerivativeCampaign}={}){
  const report={status:'disabled',scheduled:0,held:[],verificationPending:0,assetsRemoved:0};
  if(!config?.enabled||config.killSwitch||config.dryRun)return report;
  report.status='completed';if(!metricool||!stager){report.held.push('derivative_dependencies_unavailable');return report;}
  const ns=STREAMER_STATE_NAMESPACE(owner);
  async function read(){const s=parseStreamerStateStrict(await store.read(ns));if(!s)throw Error('derivative_state_invalid');return s;}
  async function update(fn){let out;await store.transact(ns,async raw=>{const s=parseStreamerStateStrict(raw);if(!s)throw Error('derivative_state_invalid');const c=cloudPublishOf(s);s.cloudPublish=c;out=await fn(s,c);return JSON.stringify(s);});return out;}
  function gate(s,id,live){const r=s.reviewedDerivatives?.records?.[id];const e=reviewedDerivativeGate(r,{owner,now:clock(),liveEligibility:live});if(e)throw Error(e);if(r.manifest.rights.licenseTerm.kind==='conditional_live'){const lead=Date.parse(r.manifest.scheduledAt)-clock();if(lead<60000||lead>300000)throw Error('derivative_conditional_just_in_time_required');}validateDerivativeBaseline(r.manifest.baseline,r.manifest);policy(s,r.manifest);if(!config.destinations?.some(d=>destinationKey(d)===destinationKey(r.manifest.destination)))throw Error('derivative_destination_disabled');return r;}
  const initial=await read();const ids=Object.keys(initial.reviewedDerivatives?.records??{}).slice(0,500);
  // Fence unused staging transactionally before any deletion; a competing writer must see cleanup_fenced.
  for(const id of ids){const d=initial.reviewedDerivatives.records[id]?.delivery;if(!d||d.writeStartedAt||(!d.asset&&!d.stageIntent&&d.status!=='pending_stage'))continue;
    try{
      const ticket=await update(s=>{const r=s.reviewedDerivatives.records[id],fresh=r?.delivery;if(fresh?.id!==d.id||fresh.writeStartedAt)return null;
        let denied=null;try{gate(s,id,null);}catch(e){denied=e.message;}
        const rightsDenied=denied&&!['derivative_live_eligibility_unverified','derivative_conditional_just_in_time_required'].includes(denied);
        if(!rightsDenied&&Date.parse(fresh.leaseUntil)>clock())return null;
        r.delivery={...fresh,status:'cleanup_fenced',cleanupToken:randomUUID()};return {...r.delivery};});
      if(!ticket)continue;
      let a=ticket.asset;
      if(!a&&ticket.stageIntent){if(typeof stager.findAsset!=='function')throw Error('derivative_staging_recovery_unavailable');a=await stager.findAsset(ticket.stageIntent.name);}
      if(a){if(!await stager.remove(a.id))throw Error('derivative_staging_cleanup_pending');report.assetsRemoved++;}
      // An active upload can still return an asset: keep its intent until its lease expires or its worker cleans it.
      if(!a&&ticket.stageIntent&&Date.parse(ticket.leaseUntil)>clock())continue;
      await update((s,c)=>{const r=s.reviewedDerivatives.records[id];if(r.delivery?.id===ticket.id&&r.delivery.cleanupToken===ticket.cleanupToken&&!r.delivery.writeStartedAt){r.delivery={...r.delivery,status:'held_before_write',asset:null,stageIntent:null,reason:'derivative_unused_stage_reconciled'};c.posts=c.posts.filter(p=>p.id!==ticket.id);c.reviewedDerivativeClaims=(c.reviewedDerivativeClaims??[]).filter(p=>p.claimId!==ticket.id);}});
    }catch{report.held.push('derivative_staging_cleanup_pending');}
  }
  const refreshed=await read();
  const runIds=ids.filter(id=>{const r=refreshed.reviewedDerivatives.records[id],d=r.delivery;if(r.status!=='approved'||d?.writeStartedAt||d?.asset||d?.stageIntent||['pending_stage','pending_write','verification_pending','scheduled','held_staging_reconciliation','cleanup_fenced'].includes(d?.status))return false;
    const slot=Date.parse(r.manifest.scheduledAt);if(slot<=clock())return false;
    if(r.manifest.rights.licenseTerm.kind==='conditional_live'&&(slot-clock()<60000||slot-clock()>300000)){report.held.push('derivative_conditional_just_in_time_required');return false;}return true;
  }).sort((a,b)=>Date.parse(refreshed.reviewedDerivatives.records[a].manifest.scheduledAt)-Date.parse(refreshed.reviewedDerivatives.records[b].manifest.scheduledAt)).slice(0,Math.max(0,Math.min(8,config.clipsPerRun??4)));
  for(const id of runIds){let sealed,track,asset,claimId,stageIntent,uploadStarted=false,writeStarted=false,confirmed=false;
    try{
      let state=await read(),record=state.reviewedDerivatives.records[id];
      if(record.status!=='approved')continue;
      if(record.delivery?.writeStartedAt||['pending_stage','pending_write','verification_pending','scheduled'].includes(record.delivery?.status)){report.held.push('derivative_existing_delivery_requires_reconciliation');continue;}
      let live=await liveCheck(record,{fetch:fetchImpl,clock});record=gate(await read(),id,live);const m=record.manifest,destination=findDestination(m.destination);
      sealed=await loadFinal(m.media,{fetch:fetchImpl});
      if(m.media.audio==='licensed_instrumental_only'){track=await loadTrack({fetch:fetchImpl});await verifyAudio({file:sealed.file,licensedTrackFile:track.file,profile:m.audioReplacement,finalSha256:m.media.sha256,caption:m.caption,captionSha256:m.captionSha256,durationSeconds:m.media.durationSeconds,maker:m.qa.maker,checker:m.qa.checker,now:clock()});}
      // Complete fresh provider view plus exact native bytes. Unknown manual rows hold rather than create capacity.
      const actual=await metricool.reviewedDerivativeCalendar(m.baseline);state=await read();const baseline=mappedBaseline(m,cloudPublishOf(state).posts,actual);const entries=matchDerivativeBaseline(baseline,actual);
      for(const row of baseline.rows)await verifyReceipt(row,{fetch:fetchImpl});
      const segment=derivativeSegment(m),key=destinationKey(destination);
      live=await liveCheck(record,{fetch:fetchImpl,clock});
      claimId=randomUUID();
      await update((s,c)=>{const fresh=gate(s,id,live);if(fresh.manifestSha256!==record.manifestSha256||fresh.delivery?.writeStartedAt||['pending_stage','pending_write','verification_pending','scheduled'].includes(fresh.delivery?.status))throw Error('derivative_delivery_conflict');
        quota(c,m,actual);
        const conflict=mediaConflict([...mediaEntriesOf(c),...entries],{segment,mediaSha256:m.media.sha256,candidateId:m.source.candidateId,destinationKey:key,physicalSource:physicalOf(m)});if(conflict)throw Error('derivative_source_or_media_duplicate');
        if((c.mediaLedger?.length??0)+entries.length>5000||(c.reviewedDerivativeClaims?.length??0)>=5000||c.posts.length>=5000)throw Error('derivative_ledger_capacity_hold');
        c.mediaLedger=[...(c.mediaLedger??[]),...entries.filter(e=>!(c.mediaLedger??[]).some(old=>old.metricoolUuid===e.metricoolUuid&&old.destinationKey===e.destinationKey))];
        c.posts.push({id:claimId,origin:'owner_authorized_external_review',candidateId:m.source.candidateId,sourceId:m.source.candidateId,segment,physicalSource:physicalOf(m),destinationKey:key,mediaSha256:m.media.sha256,byteLength:m.media.byteLength,caption:m.caption,scheduledAt:m.scheduledAt,status:'pending_stage'});
        c.reviewedDerivativeClaims=[...(c.reviewedDerivativeClaims??[]),{claimId,candidateId:m.source.candidateId,sourceId:m.source.candidateId,segment,physicalSource:physicalOf(m),mediaSha256:m.media.sha256,destinationKey:key,origin:'owner_authorized_external_review',at:iso(clock())}];
        fresh.delivery={id:claimId,status:'pending_stage',reservedAt:iso(clock()),leaseUntil:iso(clock()+10*60000)};});
      live=await liveCheck(record,{fetch:fetchImpl,clock});await verifyFile(sealed.file,m.media);gate(await read(),id,live);
      stageIntent={name:`rdv-${claimId}-${m.media.sha256}.mp4`,at:iso(clock())};
      await update(s=>{const r=gate(s,id,live);if(r.delivery?.id!==claimId||Date.parse(r.delivery.leaseUntil)<=clock())throw Error('derivative_delivery_conflict');r.delivery.stageIntent=stageIntent;});
      uploadStarted=true;asset=await stager.upload(sealed.file,stageIntent.name);
      await update(s=>{const r=s.reviewedDerivatives.records[id];if(r.delivery?.id!==claimId||r.delivery.status!=='pending_stage'||Date.parse(r.delivery.leaseUntil)<=clock())throw Error('derivative_delivery_conflict');r.delivery.asset=asset;});
      gate(await read(),id,await liveCheck(record,{fetch:fetchImpl,clock}));
      const item={id:claimId,caption:m.caption,mediaUrl:asset.url,mediaSha256:m.media.sha256,scheduledAt:m.scheduledAt,thirdPartyCommercial:m.thirdPartyCommercial,draft:false,dailyLimit:5,requireUuid:true};
      await metricool.preflight(destination,item);await metricool.crossAccountPreflight(destination,item);
      // The adapter invokes this AFTER its last network preflight and immediately before the actual write.
      item.beforeWrite=async()=>{const freshLive=await liveCheck(record,{fetch:fetchImpl,clock});await verifyFile(sealed.file,m.media);
        await update((s,c)=>{const r=gate(s,id,freshLive);if(r.manifestSha256!==record.manifestSha256||r.delivery?.id!==claimId||r.delivery?.status!=='pending_stage'||Date.parse(r.delivery.leaseUntil)<=clock())throw Error('derivative_delivery_conflict');
          quota(c,m,actual,claimId);
          const conflict=mediaConflict(mediaEntriesOf({...c,posts:c.posts.filter(p=>p.id!==claimId),reviewedDerivativeClaims:(c.reviewedDerivativeClaims??[]).filter(p=>p.claimId!==claimId)}),{segment,mediaSha256:m.media.sha256,candidateId:m.source.candidateId,destinationKey:key,physicalSource:physicalOf(m)});if(conflict)throw Error('derivative_source_or_media_duplicate');
          r.delivery={...r.delivery,status:'pending_write',writeStartedAt:iso(clock())};const p=c.posts.find(p=>p.id===claimId);if(!p)throw Error('derivative_delivery_conflict');Object.assign(p,{status:'pending_write',mediaUrl:asset.url,attemptedAt:iso(clock())});});writeStarted=true;};
      const ack=await metricool.schedule(destination,item);if(!writeStarted)throw Error('derivative_write_fence_not_invoked');
      const known=!!(ack?.id&&ack?.uuid&&ack?.mediaUrl);confirmed=known;
      await update((s,c)=>{const r=s.reviewedDerivatives.records[id],p=c.posts.find(p=>p.id===claimId);Object.assign(r.delivery,{status:known?'scheduled':'verification_pending',metricoolId:ack?.id??null,metricoolUuid:ack?.uuid??null,confirmedMediaUrl:ack?.mediaUrl??null});Object.assign(p,{status:r.delivery.status,metricoolId:ack?.id??null,metricoolUuid:ack?.uuid??null,confirmedMediaUrl:ack?.mediaUrl??null});});
      if(known){report.scheduled++;if(ack.mediaUrl!==asset.url){await verifyReceipt({mediaUrl:ack.mediaUrl,mediaSha256:m.media.sha256,byteLength:m.media.byteLength},{fetch:fetchImpl});if(await stager.remove(asset.id)){report.assetsRemoved++;await update(s=>{s.reviewedDerivatives.records[id].delivery.asset=null;});}}}else report.verificationPending++;
    }catch(e){report.held.push(reason(e));
      if(claimId){if(writeStarted&&!confirmed){report.verificationPending++;await update((s,c)=>{const r=s.reviewedDerivatives.records[id];r.delivery.status='verification_pending';const p=c.posts.find(p=>p.id===claimId);if(p)p.status='verification_pending';});}
        else if(!writeStarted){
          // A transaction may commit and then lose its response. Inspect durable state before deleting anything.
          const durable=(await read()).reviewedDerivatives.records[id]?.delivery;
          if(durable?.writeStartedAt){report.verificationPending++;continue;}
          let removed=!uploadStarted;
          try{if(!asset&&uploadStarted&&typeof stager.findAsset==='function')asset=await stager.findAsset(stageIntent.name);if(asset)removed=await stager.remove(asset.id);}catch{}
          await update((s,c)=>{const r=s.reviewedDerivatives.records[id];if(r.delivery?.id===claimId&&!r.delivery.writeStartedAt){r.delivery={...r.delivery,status:removed?'held_before_write':'held_staging_reconciliation',reason:reason(e),asset:removed?null:asset,stageIntent:removed?null:stageIntent};if(removed){c.posts=c.posts.filter(p=>p.id!==claimId);c.reviewedDerivativeClaims=(c.reviewedDerivativeClaims??[]).filter(p=>p.claimId!==claimId);}}});}}
      await update(s=>{const r=s.reviewedDerivatives.records[id];if(r)r.lastCheck={at:iso(clock()),status:'held',reason:reason(e)};});
    }finally{await sealed?.cleanup();await track?.cleanup();}
  }
  return report;
}
