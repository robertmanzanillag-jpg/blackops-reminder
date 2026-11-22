// Bounded read-only provider reconciliation. No schedule/update/delete tool is called here.
import {STREAMER_STATE_NAMESPACE,parseStreamerStateStrict} from './clippers-streamer-discovery.mjs';
import {cloudPublishOf} from '../shared/clippers-media-ledger.mjs';
import {destinationKey,canonicalDestinationKey} from './clippers-portfolio-metricool.mjs';
import {approvedNativeMediaUrl,reviewedDerivativeDigest} from '../shared/clippers-reviewed-derivative.mjs';

export async function reconcileReviewedDerivativeCopies({store,owner,metricool,clock=Date.now,limit=8}){
 const report={checked:0,verified:0,nonpublishingDrafts:0,held:[]};
 if(typeof metricool?.reconcileReviewedDerivative!=='function'){report.held.push('derivative_copy_reconcile_unavailable');return report;}
 const ns=STREAMER_STATE_NAMESPACE(owner),initial=parseStreamerStateStrict(await store.read(ns));if(!initial)throw Error('derivative_state_invalid');
 const c=cloudPublishOf(initial),records=initial.reviewedDerivatives?.records??{};
 const pending=Object.entries(records).filter(([,r])=>r.proposedBy===owner&&r.delivery?.writeStartedAt&&r.delivery.metricoolId&&r.delivery.metricoolUuid&&!r.delivery.copyVerifiedAt).sort((a,b)=>Date.parse(a[1].delivery.writeStartedAt)-Date.parse(b[1].delivery.writeStartedAt)).slice(0,Math.max(0,Math.min(16,limit)));
 for(const[id,record]of pending){const m=record.manifest,d=record.delivery,p=c.posts.find(p=>p.id===d.id);if(!p||p.origin!=='owner_authorized_external_review'||canonicalDestinationKey(p.destinationKey)!==destinationKey(m.destination)||record.manifestSha256!==reviewedDerivativeDigest(m)||p.candidateId!==m.source.candidateId||p.mediaSha256!==m.media.sha256||p.scheduledAt!==m.scheduledAt||p.caption!==m.caption){report.held.push('derivative_copy_binding_unverified');continue;}
  try{
   report.checked++;
   const proof=await metricool.reconcileReviewedDerivative(m.destination,{...p,requireUuid:true,metricoolId:d.metricoolId,metricoolUuid:d.metricoolUuid,caption:m.caption,scheduledAt:m.scheduledAt,mediaSha256:m.media.sha256,byteLength:m.media.byteLength,thirdPartyCommercial:m.thirdPartyCommercial});
   if(!proof||proof.id!==d.metricoolId||proof.uuid!==d.metricoolUuid||!approvedNativeMediaUrl(proof.mediaUrl)){report.held.push('derivative_native_copy_pending');continue;}
   const goodDraft=proof.status==='nonpublishing_draft'&&proof.confirmedNonPublishingDraft===true;
   const goodActive=proof.status==='scheduled'&&(m.thirdPartyCommercial!==true||proof.commercialDisclosureVerified===true);
   const now=new Date(clock()).toISOString();
   await store.transact(ns,async raw=>{
    const state=parseStreamerStateStrict(raw),current=state?.reviewedDerivatives?.records?.[id],ledger=cloudPublishOf(state),post=ledger.posts.find(p=>p.id===d.id);
    if(!state||!current||!post||current.manifestSha256!==record.manifestSha256||current.delivery?.id!==d.id||current.delivery.metricoolId!==proof.id||current.delivery.metricoolUuid!==proof.uuid||current.delivery.status!==d.status||current.delivery.copyVerifiedAt!==d.copyVerifiedAt||current.delivery.disclosureReconciledAt!==d.disclosureReconciledAt)throw Error('derivative_copy_reconcile_changed');
    if(goodDraft||goodActive){
     current.delivery={...current.delivery,status:goodDraft?'held_nonpublishing_draft':'scheduled',reason:null,copyVerifiedAt:now,confirmedMediaUrl:proof.mediaUrl,confirmedMediaSha256:m.media.sha256,confirmedByteLength:m.media.byteLength,disclosureReconciledAt:now,reconciliationMethod:'exact_provider_readback',reconciliationActor:'cloud_service'};
     Object.assign(post,{status:'scheduled',draft:goodDraft,confirmedMediaUrl:proof.mediaUrl,commercialDisclosureVerified:proof.commercialDisclosureVerified});current.reconciliationRequired=current.status==='revoked'&&goodActive;
    }else if(m.thirdPartyCommercial===true&&proof.commercialDisclosureVerified!==true){current.delivery={...current.delivery,status:'verification_pending',reason:'derivative_commercial_disclosure_unverified',disclosureReconciledAt:null};post.status='verification_pending';}
    state.cloudPublish=ledger;return JSON.stringify(state);
   });
   if(goodDraft||goodActive){report.verified++;if(goodDraft)report.nonpublishingDrafts++;}else report.held.push(m.thirdPartyCommercial===true&&proof.commercialDisclosureVerified!==true?'derivative_commercial_disclosure_unverified':'derivative_provider_state_unverified');
  }catch{report.held.push('derivative_native_copy_read_unverified');}
 }
 return report;
}
