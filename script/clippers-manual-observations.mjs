// Metadata-only observations. Never a renderer, rights grant, publish receipt or learner input.
import { createHash } from 'node:crypto';
import { findObservedAccount as findDestination, observedAccountKey as destinationKey, observedLocalDay as localDay } from './clippers-observed-accounts.mjs';
import { metricoolNativeUrl } from './clippers-native-media-receipts.mjs';
const SHA=/^[a-f0-9]{64}$/, UUID=/^(?:-?\d{1,30}|[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})$/i;
export const manualObservationDigest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const iso=(value,until)=>typeof value==='string'&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString()===value&&Date.parse(value)<=until;
const fields=['schemaVersion','kind','origin','observedAt','destination','assetId','metricoolId','metricoolUuid','scheduledAt','timezone','providerState','draft','autoPublish','caption','mediaUrl','mediaSha256','sizeBytes','sourceUrl','sourceSha256','sourcePublishedAt','publisherObservationDate','exactNativeMediaBytesVerified','rawMcpSnapshotSha256','brandSnapshotSha256','ownerOperatorReceiptSha256','mediaQaSha256','canonicalRendererReceipt','canonicalPublishingGrant','learnerStateChanged','pipelineEligibility','providerWrites','proofSha256'];
export function validatedManualObservations(raw,now=Date.now()){
 if(!Array.isArray(raw)||raw.length>2000)throw Error('manual_observations_invalid');
 const identities=new Map(),nativeIds=new Map(),assets=new Map(),seen=new Set();
 for(const row of raw){
  if(!row||Object.keys(row).length!==fields.length||Object.keys(row).some(key=>!fields.includes(key)))throw Error('manual_observation_shape');
  const {proofSha256,...proof}=row,d=findDestination(row.destination);
  if(row.schemaVersion!==1||row.kind!=='external_manual_schedule_observation'||row.origin!=='external_metricool_api'||!d||destinationKey(d)!==destinationKey(row.destination)||
    !/^[A-Za-z0-9_.:-]{1,100}$/.test(row.assetId??'')||!/^\d{1,30}$/.test(row.metricoolId??'')||!UUID.test(row.metricoolUuid??'')||!iso(row.observedAt,now)||!iso(row.scheduledAt,Infinity)||row.timezone!=='America/New_York'||
    !['PENDING','PUBLISHED','ERROR','DRAFT'].includes(row.providerState)||typeof row.draft!=='boolean'||typeof row.autoPublish!=='boolean'||row.draft!==(row.providerState==='DRAFT')||
    typeof row.caption!=='string'||!row.caption.length||row.caption.length>10000||!metricoolNativeUrl(row.mediaUrl)||!Number.isSafeInteger(row.sizeBytes)||row.sizeBytes<1||
    !['mediaSha256','sourceSha256','rawMcpSnapshotSha256','brandSnapshotSha256','ownerOperatorReceiptSha256','mediaQaSha256'].every(k=>SHA.test(row[k]??''))||
    typeof row.sourceUrl!=='string'||!/^https:\/\/[^\s]+$/.test(row.sourceUrl)||!(row.sourcePublishedAt===null||iso(row.sourcePublishedAt,Date.parse(row.observedAt)))||
    !/^\d{4}-\d{2}-\d{2}$/.test(row.publisherObservationDate??'')||row.publisherObservationDate>localDay(new Date(row.observedAt))||
    row.exactNativeMediaBytesVerified!==true||row.canonicalRendererReceipt!==null||row.canonicalPublishingGrant!==null||row.learnerStateChanged!==false||row.pipelineEligibility!==false||row.providerWrites!==0||!SHA.test(proofSha256??'')||manualObservationDigest(proof)!==proofSha256)throw Error('manual_observation_invalid');
  const key=`${destinationKey(d)}:${row.metricoolUuid}`,sameTime=`${key}:${row.observedAt}`;
  if(seen.has(sameTime))throw Error('manual_observation_duplicate');seen.add(sameTime);
  // Status can change. An existing UUID cannot silently become another post, asset or slot.
  for(const [map,value] of [[nativeIds,row.metricoolId],[assets,row.assetId]]){const binding=`${destinationKey(d)}:${value}`;if(map.has(binding)&&map.get(binding)!==row.metricoolUuid)throw Error('manual_observation_duplicate_identity');map.set(binding,row.metricoolUuid);}
  const identity=JSON.stringify([row.metricoolId,row.assetId,row.scheduledAt,row.caption,row.mediaUrl,row.mediaSha256,row.sizeBytes,row.sourceUrl,row.sourceSha256]);
  if(identities.has(key)&&identities.get(key)!==identity)throw Error('manual_observation_identity_conflict');identities.set(key,identity);
 }
 return structuredClone(raw);
}
export function manualObservationView(raw,{now=Date.now(),error=null}={}){
 const empty=state=>({kind:'external_manual_schedule_observations',pipelineEligibility:false,state,observedAt:null,heldReasons:[state==='missing'?'manual_observations_missing':'manual_observations_invalid'],posts:[]});
 if(error)return empty(error==='report_missing'?'missing':'invalid');
 let rows;try{rows=validatedManualObservations(raw,now);}catch{return empty('invalid');}
 const latest=new Map();for(const row of rows){const key=`${destinationKey(row.destination)}:${row.metricoolUuid}`;if(!latest.has(key)||latest.get(key).observedAt<row.observedAt)latest.set(key,row);}
 const observedAt=rows.map(r=>r.observedAt).sort().at(-1)??null;
 return {kind:'external_manual_schedule_observations',pipelineEligibility:false,state:observedAt?(now-Date.parse(observedAt)>26*3600000?'stale':'observed'):'missing',observedAt,heldReasons:observedAt?[]:['manual_observations_missing'],posts:[...latest.values()].sort((a,b)=>a.scheduledAt.localeCompare(b.scheduledAt)).map(row=>({...row,day:localDay(new Date(row.scheduledAt)),stale:now-Date.parse(row.observedAt)>26*3600000}))};
}
