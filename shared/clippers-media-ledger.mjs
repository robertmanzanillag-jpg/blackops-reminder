// Cross-account media ledger state shared by the cloud streamer worker and the Mac lanes guard.
// Pure helpers (no network, no secrets). Lives in shared/ so Mac scripts never load the cloud worker.

import { createHash } from 'node:crypto';
import { canonicalDestinationKey } from '../script/clippers-portfolio-metricool.mjs';

export function emptyCloudPublish() { return { version: 1, clips: {}, posts: [], learning: null, lastRun: null, holds: {}, heldQueue: [] }; }
export function cloudPublishOf(state) {
  const c = state?.cloudPublish;
  if (!(c?.version === 1 && Array.isArray(c.posts) && c.clips && typeof c.clips === 'object')) return emptyCloudPublish();
  if (!c.holds || typeof c.holds !== 'object' || Array.isArray(c.holds)) c.holds = {};
  if (!Array.isArray(c.heldQueue)) c.heldQueue = [];
  return c;
}

/** Ledger of every media/source already given to an account (explicit entries + the post ledger). */
export function mediaEntriesOf(c) {
  const explicit = Array.isArray(c?.mediaLedger) ? c.mediaLedger : [];
  const fromPosts = (c?.posts ?? []).filter(p => !['deferred', 'not_found', 'blocked'].includes(p.status))
    .map(p => ({ candidateId: p.candidateId, sourceId: p.sourceId ?? p.candidateId ?? null, streamKey: p.streamKey ?? null, segment: p.segment ?? null, physicalSource:p.physicalSource??null, mediaSha256: p.mediaSha256 ?? null, destinationKey: canonicalDestinationKey(p.destinationKey), lane: p.lane ?? null }));
  return [...explicit, ...(Array.isArray(c?.reviewedDerivativeClaims)?c.reviewedDerivativeClaims:[]), ...fromPosts];
}


export const LEGACY_UNCERTAIN_RESERVATION_ORIGIN='legacy_uncertain_delivery_reservation';
export const MEDIA_LEDGER_LIMIT=5000;
export const isProtectedMediaClaim=entry=>entry?.origin===LEGACY_UNCERTAIN_RESERVATION_ORIGIN;
const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const maybe=value=>value===undefined?null:structuredClone(value);
const uncertainIdentity=post=>({postId:maybe(post.id),originalOrigin:maybe(post.origin),candidateId:maybe(post.candidateId),sourceId:maybe(post.sourceId??post.candidateId),destinationKey:canonicalDestinationKey(post.destinationKey),segment:maybe(post.segment),physicalSource:maybe(post.physicalSource),streamKey:maybe(post.streamKey),mediaSha256:maybe(post.mediaSha256),mediaUrl:maybe(post.mediaUrl),confirmedMediaUrl:maybe(post.confirmedMediaUrl),byteLength:maybe(post.byteLength),captionSha256:typeof post.caption==='string'?createHash('sha256').update(post.caption).digest('hex'):null,scheduledAt:maybe(post.scheduledAt),attemptedAt:maybe(post.attemptedAt),metricoolId:maybe(post.metricoolId),metricoolUuid:maybe(post.metricoolUuid)});
/** Compare exact attempt identity after a provider read; an older read cannot overwrite a newer attempt. */
export const legacyUncertainAttemptKey=post=>digest(uncertainIdentity(post));
/** Protected reservations never participate in ordinary tail eviction or same-source replacement. */
export function boundedMediaLedger(entries,{required=[]}={}){
 if(!Array.isArray(entries))throw Error('media_ledger_invalid');
 const protectedClaims=entries.filter(isProtectedMediaClaim),ordinary=entries.filter(e=>!isProtectedMediaClaim(e));
 if(protectedClaims.length>MEDIA_LEDGER_LIMIT)throw Error('legacy_uncertain_claim_capacity_hold');
 const capacity=MEDIA_LEDGER_LIMIT-protectedClaims.length;
 const result=[...protectedClaims,...(capacity?ordinary.slice(-capacity):[])];
 if(required.some(e=>!result.includes(e)))throw Error('legacy_uncertain_claim_capacity_hold');
 return result;
}
export function upsertMediaLedgerClaim(c,entry){
 const prior=c.mediaLedger??[];if(!Array.isArray(prior))throw Error('media_ledger_invalid');
 c.mediaLedger=boundedMediaLedger([...prior.filter(e=>isProtectedMediaClaim(e)||!(e.candidateId===entry.candidateId&&e.destinationKey===entry.destinationKey)),entry],{required:[entry]});
}
/** Absence from today's calendar is not proof that the historical attempt was never written. */
export function retainLegacyUncertainReservation(c,post,{now=Date.now()}={}){
 if(post?.origin==='owner_authorized_external_review'||!['verification_pending','pending_write'].includes(post?.status))throw Error('legacy_uncertain_status_changed');
 const identity=uncertainIdentity(post),segment=identity.segment;
 if(typeof identity.postId!=='string'||!identity.postId||typeof identity.candidateId!=='string'||!identity.candidateId||typeof identity.destinationKey!=='string'||!identity.destinationKey||!/^[a-f0-9]{64}$/.test(identity.mediaSha256??'')||!segment||typeof segment.key!=='string'||!segment.key||!(segment.start===null||(Number.isFinite(segment.start)&&segment.start>=0))||(segment.end!==undefined&&(!Number.isFinite(segment.end)||!Number.isFinite(segment.start)||segment.end<=segment.start))||!Number.isFinite(Date.parse(identity.scheduledAt))||!Number.isFinite(now))throw Error('legacy_uncertain_identity_incomplete');
 const claims=c.mediaLedger??[];if(!Array.isArray(claims))throw Error('media_ledger_invalid');
 const reservationId='legacy-uncertain-'+digest(identity),existing=claims.find(e=>isProtectedMediaClaim(e)&&e.reservationId===reservationId);
 if(existing){if(existing.noReplay!==true||existing.deliveryState!=='historically_unresolved'||digest(Object.fromEntries(Object.keys(identity).map(k=>[k,existing[k]])))!==digest(identity))throw Error('legacy_uncertain_claim_unverified');return existing;}
 if(claims.length>=MEDIA_LEDGER_LIMIT)throw Error('legacy_uncertain_claim_capacity_hold');
 const clip=c.clips?.[identity.candidateId],claim={...identity,origin:LEGACY_UNCERTAIN_RESERVATION_ORIGIN,reservationId,noReplay:true,deliveryState:'historically_unresolved',previousStatus:post.status,retainedAt:new Date(now).toISOString(),currentCalendarAbsenceOnly:true,attemptReason:maybe(post.reason),mediaAsset:clip?.mediaAsset?{id:maybe(clip.mediaAsset.id),url:maybe(clip.mediaAsset.url),createdAt:maybe(clip.mediaAsset.createdAt)}:null};
 if(Buffer.byteLength(JSON.stringify(claim))>8192)throw Error('legacy_uncertain_claim_capacity_hold');
 c.mediaLedger=[...claims,claim];return claim;
}
