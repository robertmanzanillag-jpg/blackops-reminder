// Explicit owner-approved hour windows. No timer, network call, permission or retry is created here.
const HOUR=3600000,MINUTE=60000;
const canonical=s=>typeof s==='string'&&Number.isFinite(Date.parse(s))&&new Date(s).toISOString()===s;
const formatter=new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',hourCycle:'h23'});
const localKey=t=>formatter.format(new Date(t));
export const reviewedDispatchMode=m=>m?.dispatch?.mode==='owner_hour_window'?'owner_hour_window':'exact';
export function validateReviewedDispatch(m,now=Date.now()){
 if(m.dispatch===undefined)return null;
 const d=m.dispatch;
 if(!d||typeof d!=='object'||Array.isArray(d)||Object.keys(d).some(k=>!['mode','timezone','startAt','endAt'].includes(k))||d.mode!=='owner_hour_window'||d.timezone!=='America/New_York'||!canonical(d.startAt)||!canonical(d.endAt))throw Error('derivative_dispatch_window_invalid');
 const start=Date.parse(d.startAt),end=Date.parse(d.endAt),key=localKey(start);
 // An owner approves one unambiguous NY wall-clock hour, including its exact UTC offset.
 if(end-start!==HOUR||start%HOUR!==0||m.scheduledAt!==d.startAt||localKey(end-1)!==key||localKey(start-HOUR)===key||localKey(end)===key||start<Date.parse(m.windowStart)||end>Date.parse(m.windowEnd)||end>Date.parse(m.expiresAt)||end<=now)throw Error('derivative_dispatch_window_invalid');
 return{start,end};
}
export function selectReviewedHourSlot(m,now=Date.now()){
 const window=validateReviewedDispatch(m,now);
 if(!window||now<window.start)throw Error('derivative_hour_window_not_due');
 const slot=Math.ceil((now+3*MINUTE)/MINUTE)*MINUTE;
 if(slot<window.start||slot>=window.end)throw Error('derivative_hour_window_missed');
 return new Date(slot).toISOString();
}
export function reviewedDeliverySlot(record){
 const m=record.manifest;
 if(reviewedDispatchMode(m)==='exact')return m.scheduledAt;
 const d=record.delivery,slot=d?.resolvedScheduledAt;
 if(!canonical(slot)||d.dispatchManifestSha256!==record.manifestSha256||!canonical(m.dispatch.startAt)||!canonical(m.dispatch.endAt)||Date.parse(slot)<Date.parse(m.dispatch.startAt)||Date.parse(slot)>=Date.parse(m.dispatch.endAt))throw Error('derivative_resolved_slot_unverified');
 return slot;
}
export function reviewedHourWindowDueRecords(state,{now=Date.now()}={}){
 return Object.entries(state?.reviewedDerivatives?.records??{}).filter(([,r])=>{
  if(r.status!=='approved'||reviewedDispatchMode(r.manifest)!=='owner_hour_window'||r.delivery?.writeStartedAt||r.delivery?.asset||r.delivery?.stageIntent||!['', 'held_before_write'].includes(r.delivery?.status??''))return false;
  try{selectReviewedHourSlot(r.manifest,now);return true;}catch{return false;}
 }).sort((a,b)=>Date.parse(a[1].manifest.dispatch.endAt)-Date.parse(b[1].manifest.dispatch.endAt)||a[0].localeCompare(b[0])).map(([id])=>id);
}
