// Private final bytes in the EXISTING council KV. Never accepts a path, URL, namespace or public upload.
import {createHash} from 'node:crypto';
import {mkdtemp,open,chmod,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {reviewedDerivativeDigest,validPrivateFinalReference,validateReviewedDerivativeManifest,approvedNativeMediaUrl} from '../shared/clippers-reviewed-derivative.mjs';
import {parseStreamerStateStrict,STREAMER_STATE_NAMESPACE} from './clippers-streamer-discovery.mjs';
import {loadApprovedDerivativeInstrumental,verifyDerivativeAudioReplacement} from '../shared/clippers-derivative-audio.mjs';
import {probeReviewedDerivative,validateSealedDerivativeProbe,verifySealedDerivativeFile} from './clippers-reviewed-derivative-media.mjs';

export const CHUNK_BYTES=2*1024*1024,MAX_FINAL_BYTES=32*1024*1024,OWNER_ACTIVE_BYTES=64*1024*1024;
const METADATA_BYTES=262144,MAX_ACTIVE_FILES=256,SHA=/^[a-f0-9]{64}$/;
const hash=x=>createHash('sha256').update(x).digest('hex');
const fail=code=>{throw Error(code);};
const iso=now=>new Date(now).toISOString();
function ownerHash(owner){if(typeof owner!=='string'||!owner.trim()||owner.length>200)fail('private_final_owner_invalid');return hash(owner);}
function keys(owner,ref){const h=ownerHash(owner);if(ref!==undefined&&!validPrivateFinalReference(ref))fail('private_final_reference_invalid');return{index:`clippers-private-finals:v1:${h}`,meta:`clippers-private-final:v1:${h}:${ref}:meta`,chunk:(i,epoch)=>`clippers-private-final:v1:${h}:${ref}:epoch:${epoch}:chunk:${i}`,h};}
function parse(raw){if(raw===null)return null;let x;try{x=JSON.parse(raw);}catch{fail('private_final_state_invalid');}if(!x||typeof x!=='object'||Array.isArray(x)||x.version!==1)fail('private_final_state_invalid');return x;}
function encode(x){const raw=JSON.stringify(x);if(Buffer.byteLength(raw)>=METADATA_BYTES)fail('private_final_metadata_full');return raw;}
async function mutate(store,key,fn){let out;await store.transact(key,async raw=>{const result=fn(parse(raw));out=result.out;return encode(result.state);});return out;}
function binding(owner,record,{allowRevoked=false,now=Date.now()}={}){
 const m=record?.manifest,media=m?.media;
 if(!record||record.proposedBy!==owner||!['proposed','approved',...(allowRevoked?['revoked']:[])].includes(record.status)||!SHA.test(record.manifestSha256??'')||reviewedDerivativeDigest(m)!==record.manifestSha256||typeof m.id!=='string'||m.id.length>160||!media||media.storageKind!=='private_council_v1'||!validPrivateFinalReference(media.privateFinalRef)||media.url!==undefined||media.privateFinalRef!==`final-${media.sha256}`||!SHA.test(media.sha256??'')||!Number.isSafeInteger(media.byteLength)||media.byteLength<1024||media.byteLength>MAX_FINAL_BYTES)fail('private_final_binding_invalid');
 if(!allowRevoked){if(record.delivery?.writeStartedAt)fail('private_final_delivery_locked');validateReviewedDerivativeManifest(m,now);}
 return{ref:media.privateFinalRef,sha256:media.sha256,byteLength:media.byteLength,proposalId:m.id,manifestSha256:record.manifestSha256};
}
function assertMeta(meta,k,b,{active=true}={}){if(!meta||!Number.isSafeInteger(meta.epoch)||meta.epoch<1||meta.ownerHash!==k.h||meta.ref!==b.ref||meta.sha256!==b.sha256||meta.byteLength!==b.byteLength||!meta.references||meta.references[b.manifestSha256]?.proposalId!==b.proposalId)fail('private_final_binding_invalid');if(active&&meta.references[b.manifestSha256].epoch!==meta.epoch)fail('private_final_reference_retired');}
function assertIndex(index,k,b){const e=index?.files?.[b.ref];if(!index||!Number.isSafeInteger(e?.epoch)||e.epoch<1||index.ownerHash!==k.h||!e||e.sha256!==b.sha256||e.byteLength!==b.byteLength||e.references?.[b.manifestSha256]?.proposalId!==b.proposalId||e.references[b.manifestSha256].epoch!==e.epoch)fail('private_final_binding_invalid');return e;}
function usage(index){return Object.values(index?.files??{}).reduce((n,e)=>{if(!Number.isSafeInteger(e.byteLength)||e.byteLength<1024||e.byteLength>MAX_FINAL_BYTES)fail('private_final_state_invalid');return n+e.byteLength;},0);}
function summary(meta,index,b){return{status:meta?.status??'missing',ready:meta?.status==='ready',privateFinalRef:b.ref,manifestSha256:b.manifestSha256,byteLength:b.byteLength,sha256:b.sha256,chunkBytes:CHUNK_BYTES,receivedChunks:meta?.nextIndex??0,totalChunks:Math.ceil(b.byteLength/CHUNK_BYTES),ownerUsageBytes:usage(index)};}
export async function reservePrivateFinal({store,owner,record,now=Date.now()}){
 const b=binding(owner,record,{now}),k=keys(owner,b.ref),existing=parse(await store.read(k.meta));
 if(existing&&(existing.ownerHash!==k.h||existing.sha256!==b.sha256||existing.byteLength!==b.byteLength||['invalid','purging'].includes(existing.status)))fail('private_final_reference_conflict');
 const targetEpoch=existing?.status==='purged'?(existing.epoch??0)+1:existing?.epoch??1;
 const reserved=await mutate(store,k.index,index=>{
  index??={version:1,ownerHash:k.h,files:{}};if(index.ownerHash!==k.h||!index.files)fail('private_final_state_invalid');
  let e=index.files[b.ref];
  if(e){
   if(e.sha256!==b.sha256||e.byteLength!==b.byteLength||e.status==='purging')fail('private_final_reference_conflict');
   // A fully purged epoch cannot still own live bytes. Replace a stale cross-key reservation in place.
   if(existing?.status==='purged'&&e.epoch<=existing.epoch)e=index.files[b.ref]={sha256:b.sha256,byteLength:b.byteLength,status:'reserved',references:{},generation:(e.generation??0)+1,epoch:targetEpoch,reservedAt:iso(now)};
  }else{
   if(Object.keys(index.files).length>=MAX_ACTIVE_FILES||usage(index)+b.byteLength>OWNER_ACTIVE_BYTES)fail('private_final_owner_capacity');
   e=index.files[b.ref]={sha256:b.sha256,byteLength:b.byteLength,status:'reserved',references:{},generation:1,epoch:targetEpoch,reservedAt:iso(now)};
  }
  e.references[b.manifestSha256]??={proposalId:b.proposalId,addedAt:iso(now),epoch:e.epoch};e.generation++;
  return{state:index,out:structuredClone(e)};
 });
 try{
  await mutate(store,k.meta,meta=>{
   if(meta&&(meta.ownerHash!==k.h||meta.ref!==b.ref||meta.sha256!==b.sha256||meta.byteLength!==b.byteLength||['invalid','purging'].includes(meta.status)))fail('private_final_reference_conflict');
   if(meta?.status==='purged'){
    if(reserved.epoch<=meta.epoch)fail('private_final_epoch_stale');
    meta.history=[...(meta.history??[]),{epoch:meta.epoch,purgedAt:meta.purgedAt,references:meta.references,sha256:meta.sha256,byteLength:meta.byteLength}];
    meta={...meta,status:'reserved',epoch:reserved.epoch,everReadyInEpoch:false,finalizedAt:null,purgedAt:null,references:{},nextIndex:0,chunks:{},pending:null,createdAt:iso(now)};
   }
   meta??={version:1,ownerHash:k.h,ref:b.ref,sha256:b.sha256,byteLength:b.byteLength,status:'reserved',references:{},nextIndex:0,chunks:{},epoch:reserved.epoch,createdAt:iso(now),everReadyInEpoch:false,history:[]};
   if(meta.epoch!==reserved.epoch)fail('private_final_epoch_stale');
   meta.references[b.manifestSha256]??={proposalId:b.proposalId,addedAt:iso(now),epoch:meta.epoch};meta.touchedAt=iso(now);return{state:meta,out:null};
  });
 }catch(e){
  // Only an immutable purged epoch can prove this cross-key reservation unused; other outcomes retain capacity.
  if(e.message==='private_final_epoch_stale')await mutate(store,k.index,index=>{if(index.files[b.ref]?.epoch===reserved.epoch)delete index.files[b.ref];return{state:index,out:null};});
  throw e;
 }
 return privateFinalStatus({store,owner,record});
}
export async function privateFinalStatus({store,owner,record}){
 const b=binding(owner,record,{allowRevoked:true}),k=keys(owner,b.ref),index=parse(await store.read(k.index)),meta=parse(await store.read(k.meta));
 if(!meta&&!index?.files?.[b.ref])return summary(null,index,b);
 if(meta?.status==='purged'){assertMeta(meta,k,b,{active:false});return summary(meta,index,b);}
 const entry=assertIndex(index,k,b);assertMeta(meta,k,b);return summary(entry.status==='purging'?{...meta,status:'purging'}:meta,index,b);
}
export async function putPrivateFinalChunk({store,owner,record,index,bytes,sha256,now=Date.now()}){
 const b=binding(owner,record,{now}),k=keys(owner,b.ref),count=Math.ceil(b.byteLength/CHUNK_BYTES);
 const expected=Math.min(CHUNK_BYTES,b.byteLength-index*CHUNK_BYTES);
 if(!Number.isSafeInteger(index)||index<0||index>=count||!Buffer.isBuffer(bytes)||bytes.length!==expected||bytes.length>CHUNK_BYTES||!SHA.test(sha256??'')||hash(bytes)!==sha256)fail('private_final_chunk_invalid');
 const ownerIndex=parse(await store.read(k.index));assertIndex(ownerIndex,k,b);if(ownerIndex.files[b.ref].status==='purging')fail('private_final_purging');
 const transfer=await mutate(store,k.meta,meta=>{
  assertMeta(meta,k,b);if(['invalid','purging','purged'].includes(meta.status))fail('private_final_not_uploading');
  if(index<meta.nextIndex){if(meta.chunks[index]?.sha256!==sha256||meta.chunks[index]?.byteLength!==bytes.length)fail('private_final_chunk_conflict');return{state:meta,out:{duplicate:true,epoch:meta.epoch}};}
  if(!['reserved','uploading'].includes(meta.status)||index!==meta.nextIndex)fail('private_final_chunk_order');
  if(meta.pending&&(meta.pending.index!==index||meta.pending.sha256!==sha256||meta.pending.byteLength!==bytes.length))fail('private_final_chunk_conflict');
  meta.status='uploading';meta.pending={index,sha256,byteLength:bytes.length};meta.touchedAt=iso(now);return{state:meta,out:{duplicate:false,epoch:meta.epoch}};
 });
 if(!transfer.duplicate){
  const packet={version:1,ownerHash:k.h,ref:b.ref,index,epoch:transfer.epoch,sha256,byteLength:bytes.length,data:bytes.toString('base64')};
  await store.transact(k.chunk(index,transfer.epoch),async raw=>{const old=parse(raw);if(old&&(old.ownerHash!==k.h||old.ref!==b.ref||old.index!==index||old.epoch!==transfer.epoch||old.sha256!==sha256||old.byteLength!==bytes.length||old.data!==packet.data))fail('private_final_chunk_conflict');return JSON.stringify(packet);});
  await mutate(store,k.meta,meta=>{assertMeta(meta,k,b);if(index<meta.nextIndex)return{state:meta,out:null};if(meta.epoch!==transfer.epoch||meta.status!=='uploading'||meta.pending?.index!==index||meta.pending.sha256!==sha256||meta.pending.byteLength!==bytes.length)fail('private_final_chunk_conflict');meta.chunks[index]={sha256,byteLength:bytes.length};meta.nextIndex=index+1;meta.pending=null;meta.touchedAt=iso(now);return{state:meta,out:null};});
 }
 return privateFinalStatus({store,owner,record});
}
function decodeChunk(raw,k,b,index,expected,epoch){const c=parse(raw);if(!c||c.ownerHash!==k.h||c.ref!==b.ref||c.index!==index||c.epoch!==epoch||c.sha256!==expected.sha256||c.byteLength!==expected.byteLength||typeof c.data!=='string'||c.data.length>Math.ceil(CHUNK_BYTES/3)*4)fail('private_final_chunk_missing');const bytes=Buffer.from(c.data,'base64');if(bytes.length!==c.byteLength||bytes.toString('base64')!==c.data||hash(bytes)!==c.sha256)fail('private_final_chunk_corrupt');return bytes;}
export async function finalizePrivateFinal({store,owner,record,now=Date.now()}){
 const b=binding(owner,record,{now}),k=keys(owner,b.ref);assertIndex(parse(await store.read(k.index)),k,b);
 const ticket=await mutate(store,k.meta,meta=>{assertMeta(meta,k,b);if(meta.status==='ready')return{state:meta,out:meta};if(!['reserved','uploading','finalizing'].includes(meta.status)||meta.pending||meta.nextIndex!==Math.ceil(b.byteLength/CHUNK_BYTES))fail('private_final_incomplete');meta.status='finalizing';return{state:meta,out:meta};});
 if(ticket.status!=='ready'){
  const digest=createHash('sha256');let size=0;
  for(let i=0;i<ticket.nextIndex;i++){const bytes=decodeChunk(await store.read(k.chunk(i,ticket.epoch)),k,b,i,ticket.chunks[i],ticket.epoch);size+=bytes.length;digest.update(bytes);}
  if(size!==b.byteLength||digest.digest('hex')!==b.sha256){await mutate(store,k.meta,meta=>{assertMeta(meta,k,b);if(meta.status==='finalizing')meta.status='invalid';return{state:meta,out:null};});fail('private_final_whole_hash_mismatch');}
  await mutate(store,k.meta,meta=>{assertMeta(meta,k,b);if(!['finalizing','ready'].includes(meta.status))fail('private_final_finalize_conflict');meta.status='ready';meta.everReadyInEpoch=true;meta.finalizedAt=iso(now);return{state:meta,out:null};});
  await mutate(store,k.index,index=>{const e=assertIndex(index,k,b);if(e.status==='purging')fail('private_final_purging');e.status='ready';return{state:index,out:null};});
 }
 return assertPrivateFinalReady({store,owner,record});
}
export async function assertPrivateFinalReady({store,owner,record}){const s=await privateFinalStatus({store,owner,record});if(!s.ready)fail('private_final_not_ready');return s;}
export async function* streamPrivateFinalRange({store,owner,record,start=0,end}){
 const b=binding(owner,record,{allowRevoked:true}),k=keys(owner,b.ref);await assertPrivateFinalReady({store,owner,record});end??=b.byteLength-1;
 if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start<0||end<start||end>=b.byteLength)fail('private_final_range_invalid');
 const meta=parse(await store.read(k.meta));assertMeta(meta,k,b);if(meta.status!=='ready')fail('private_final_not_ready');
 for(let i=Math.floor(start/CHUNK_BYTES);i<=Math.floor(end/CHUNK_BYTES);i++){const bytes=decodeChunk(await store.read(k.chunk(i,meta.epoch)),k,b,i,meta.chunks[i],meta.epoch);const low=Math.max(0,start-i*CHUNK_BYTES),high=Math.min(bytes.length,end-i*CHUNK_BYTES+1);yield bytes.subarray(low,high);}
}
async function sealPrivateBytes({store,owner,record,now=Date.now(),probe=probeReviewedDerivative}){
 const b=binding(owner,record,{now}),directory=await mkdtemp(path.join(tmpdir(),'clippers-private-final-'));await chmod(directory,0o700);const file=path.join(directory,'sealed.mp4'),cleanup=()=>rm(directory,{recursive:true,force:true});let handle;
 try{handle=await open(file,'wx',0o600);const digest=createHash('sha256');let size=0;for await(const bytes of streamPrivateFinalRange({store,owner,record})){digest.update(bytes);size+=bytes.length;await handle.writeFile(bytes);}await handle.close();handle=null;if(size!==b.byteLength||digest.digest('hex')!==b.sha256)fail('private_final_whole_hash_mismatch');validateSealedDerivativeProbe(await probe(file),record.manifest.media);await verifySealedDerivativeFile(file,record.manifest.media);return{file,cleanup,verification:{origin:'sealed_private_council_final_byte_check',sha256:b.sha256,byteLength:size,checkedAt:iso(now)}};}
 catch(e){await handle?.close().catch(()=>undefined);await cleanup();throw e;}
}

export async function sealPrivateFinal(options){
 const {record,owner}=options;
 if(record?.status!=='approved'||record?.origin!=='owner_authorized_external_review'||record.approval?.principal!==owner||record.approval?.method!=='authenticated_owner_authorized_operator'||record.approval?.manifestSha256!==record.manifestSha256)fail('private_final_owner_approval_required');
 return sealPrivateBytes(options);
}
/** Private technical inspection before owner consent; no grant, canonical render ACK or public staging is created. */
export async function inspectPrivateFinalForApproval({store,owner,record,now=Date.now(),probe=probeReviewedDerivative,fetch:fetchImpl=globalThis.fetch,loadTrack=loadApprovedDerivativeInstrumental,verifyAudio=verifyDerivativeAudioReplacement}){
 if(record?.status!=='proposed')fail('private_final_proposal_required');
 let sealed,track;try{
  sealed=await sealPrivateBytes({store,owner,record,now,probe});const m=record.manifest;let audioVerification={origin:'sealed_zero_audio_probe',audioStreams:0};
  if(m.media.audio==='licensed_instrumental_only'){
   track=await loadTrack({fetch:fetchImpl});audioVerification=await verifyAudio({file:sealed.file,licensedTrackFile:track.file,profile:m.audioReplacement,finalSha256:m.media.sha256,caption:m.caption,captionSha256:m.captionSha256,durationSeconds:m.media.durationSeconds,maker:m.qa.maker,checker:m.qa.checker,now});
  }
  await verifySealedDerivativeFile(sealed.file,m.media);
  return{origin:'private_final_owner_technical_inspection',manifestSha256:record.manifestSha256,sha256:m.media.sha256,byteLength:m.media.byteLength,checkedAt:iso(now),audioProfile:m.media.audio,audioVerification};
 }finally{await sealed?.cleanup();await track?.cleanup();}
}

function reclaimable(record,reference,meta,owner,now){
 if(!record||record.proposedBy!==owner||record.manifestSha256!==reference.digest||reviewedDerivativeDigest(record.manifest)!==reference.digest||record.manifest?.media?.privateFinalRef!==meta.ref||record.manifest.media.sha256!==meta.sha256||record.manifest.media.byteLength!==meta.byteLength)return false;
 const d=record.delivery;
 if(d?.writeStartedAt)return ['scheduled','held_nonpublishing_draft'].includes(d.status)&&Number.isFinite(Date.parse(d.copyVerifiedAt))&&Date.parse(d.copyVerifiedAt)<=now&&approvedNativeMediaUrl(d.confirmedMediaUrl)&&d.confirmedMediaSha256===meta.sha256&&d.confirmedByteLength===meta.byteLength;
 if(d&&(d.metricoolId||d.metricoolUuid||d.attemptedAt||d.asset||d.stageIntent||!['pending_stage','held_before_write'].includes(d.status)))return false;
 if(record.status==='revoked')return true;
 if(meta.status==='invalid'&&meta.everReadyInEpoch!==true&&record.status==='proposed')return true;
 return Number.isFinite(Date.parse(record.manifest.expiresAt))&&Date.parse(record.manifest.expiresAt)<=now;
}
/** Retire only bytes with proof for EVERY current reference; history and publication/source ledgers are untouched. */
export async function cleanupPrivateFinals({store,owner,now=Date.now(),refs,maxFiles=8}){
 const root=keys(owner),index=parse(await store.read(root.index));const report={retired:0,bytesReclaimed:0,held:[]};if(!index)return report;
 if(index.ownerHash!==root.h||!index.files)fail('private_final_state_invalid');
 const state=parseStreamerStateStrict(await store.read(STREAMER_STATE_NAMESPACE(owner)));if(!state){report.held.push('private_final_registry_unverified');return report;}
 const records=state.reviewedDerivatives?.records??{};
 const wanted=Object.keys(index.files).filter(ref=>!refs||refs.includes(ref)).slice(0,Math.max(0,Math.min(32,maxFiles)));
 for(const ref of wanted){
  const k=keys(owner,ref),snapshot=index.files[ref];if(!Number.isSafeInteger(snapshot.epoch)||snapshot.epoch<1){report.held.push('private_final_state_unverified');continue;}
  // An index reservation precedes metadata by design. Recover its missing row only through the same all-reference proof/fences.
  const observed=parse(await store.read(k.meta));
  const stalePurged=observed?.status==='purged'&&observed.ownerHash===k.h&&observed.sha256===snapshot.sha256&&observed.byteLength===snapshot.byteLength&&Number.isSafeInteger(observed.epoch)&&observed.epoch<snapshot.epoch;
  const priorHistory=stalePurged?[...(observed.history??[]),{epoch:observed.epoch,purgedAt:observed.purgedAt,references:observed.references,sha256:observed.sha256,byteLength:observed.byteLength}]:[];
  const meta=(!stalePurged&&observed)||{version:1,ownerHash:k.h,ref,sha256:snapshot.sha256,byteLength:snapshot.byteLength,epoch:snapshot.epoch,references:snapshot.references,status:'reserved',everReadyInEpoch:false,chunks:{},nextIndex:0,history:priorHistory};
  if(meta.ownerHash!==k.h||meta.ref!==ref||meta.sha256!==snapshot.sha256||meta.byteLength!==snapshot.byteLength||meta.epoch!==snapshot.epoch){report.held.push('private_final_state_unverified');continue;}
  const references={...meta.references,...snapshot.references};
  if(!Object.keys(references).length||!Object.entries(references).every(([digest,r])=>r.epoch===meta.epoch&&reclaimable(records[r.proposalId],{...r,digest},meta,owner,now)))continue;
  let token;
  try{
   token=await mutate(store,k.index,current=>{const e=current?.files?.[ref];if(!e||JSON.stringify(e)!==JSON.stringify(snapshot))fail('private_final_cleanup_changed');e.status='purging';e.cleanupToken=`${meta.epoch}:${now}:${e.generation}`;return{state:current,out:e.cleanupToken};});
   await mutate(store,k.meta,current=>{if(current?.status==='purged'&&current.ownerHash===k.h&&current.sha256===meta.sha256&&current.byteLength===meta.byteLength&&current.epoch<meta.epoch)current=structuredClone(meta);current??=structuredClone(meta);if(current.epoch!==meta.epoch||current.ownerHash!==k.h||current.sha256!==meta.sha256||JSON.stringify(current.references)!==JSON.stringify(meta.references))fail('private_final_cleanup_changed');current.status='purging';current.cleanupToken=token;return{state:current,out:null};});
   // Tombstone every possible chunk, including unacknowledged/pending writes. A late immutable writer cannot recreate it.
   for(let i=0;i<Math.ceil(meta.byteLength/CHUNK_BYTES);i++)await store.transact(k.chunk(i,meta.epoch),async()=>JSON.stringify({version:1,ownerHash:k.h,ref,index:i,epoch:meta.epoch,status:'purged',purgedAt:iso(now)}));
   await mutate(store,k.meta,current=>{if(current?.epoch!==meta.epoch||current.status!=='purging'||current.cleanupToken!==token)fail('private_final_cleanup_changed');current.status='purged';current.purgedAt=iso(now);current.pending=null;current.chunks={};current.nextIndex=0;return{state:current,out:null};});
   await mutate(store,k.index,current=>{const e=current?.files?.[ref];if(!e||e.epoch!==meta.epoch||e.status!=='purging'||e.cleanupToken!==token)fail('private_final_cleanup_changed');delete current.files[ref];return{state:current,out:null};});
   report.retired++;report.bytesReclaimed+=meta.byteLength;
  }catch{report.held.push('private_final_cleanup_pending');}
 }
 return report;
}
