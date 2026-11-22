// A manually reviewed final asset is not permission to download its raw source.
// Only authenticated owner admission may create the approval wrapper below.
import { validateReviewedDispatch,reviewedDeliverySlot } from './clippers-reviewed-dispatch.mjs';
import { validateDerivativeAudioReplacement } from './clippers-derivative-audio.mjs';
import { createHash } from 'node:crypto';
import { findDestination, destinationKey } from '../script/clippers-portfolio-metricool.mjs';

const SHA = /^[a-f0-9]{64}$/;
const ID = /^[A-Za-z0-9_.:-]{1,160}$/;
const stamp = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(value) ? Date.parse(value) : NaN;
const fail = code => { throw Error(code); };
const text = (value, max = 2000) => typeof value === 'string' && value.trim().length > 0 && value.length <= max;
function jsonShape(value, depth = 0) {
  if (depth > 12) fail('derivative_manifest_invalid');
  if (value === null || ['string', 'boolean'].includes(typeof value) || number(value)) return;
  if (!value || typeof value !== 'object' || (!Array.isArray(value) && Object.getPrototypeOf(value) !== Object.prototype) || Object.getOwnPropertySymbols(value).length) fail('derivative_manifest_invalid');
  if (Object.keys(value).length > (Array.isArray(value) ? 500 : 100)) fail('derivative_manifest_invalid');
  for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(value))) {
    if (Array.isArray(value) && key === 'length') { if (Object.keys(value).length !== value.length) fail('derivative_manifest_invalid'); continue; }
    if (!Object.hasOwn(descriptor, 'value') || !descriptor.enumerable) fail('derivative_manifest_invalid');
    jsonShape(descriptor.value, depth + 1);
  }
}
function object(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(k => !keys.includes(k))) fail('derivative_manifest_invalid');
}
const number = value => typeof value === 'number' && Number.isFinite(value);
export const reviewedMediaHash = value => createHash('sha256').update(value).digest('hex');
function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])]));
  return value;
}
export const reviewedDerivativeDigest = manifest => reviewedMediaHash(JSON.stringify(stable(manifest)));
export function validPrivateFinalReference(value){return typeof value==='string'&&/^final-[a-f0-9]{64}$/.test(value);}
export function approvedNativeMediaUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname === 'static.metricool.com' && (!url.port || url.port === '443') &&
      !url.username && !url.password && !url.hash && !url.search && url.pathname.length > 5;
  } catch { return false; }
}

/** Structural validation only. A valid JSON document is still an UNAPPROVED proposal. */
export function validateReviewedDerivativeManifest(manifest, now = Date.now()) {
  jsonShape(manifest);
  object(manifest, ['schemaVersion', 'contentClass', 'id', 'source', 'transform', 'media', 'caption', 'captionSha256', 'qa', 'rights', 'destination', 'scheduledAt', 'windowStart', 'windowEnd', 'expiresAt', 'language', 'thirdPartyCommercial', 'baseline', 'audioReplacement', 'dispatch']);
  if (manifest.schemaVersion !== 1 || manifest.contentClass !== 'reviewed_derivative' || !ID.test(manifest.id ?? '') || !['en', 'es'].includes(manifest.language) || typeof manifest.thirdPartyCommercial !== 'boolean') fail('derivative_manifest_invalid');
  const { source, transform, media, qa, rights } = manifest;
  object(source, ['kind', 'candidateId', 'creatorKey', 'handle', 'url', 'artifactSha256', 'publishedAt', 'startSeconds', 'endSeconds', 'vodId', 'vodOffsetSeconds', 'vodAnchor']);
  if (!((source.kind==='clip'&&/^twitch-clip:[A-Za-z0-9_-]{1,120}$/.test(source.candidateId??''))||(source.kind==='vod_context'&&source.candidateId===`twitch-vod:${source.vodId}:${source.artifactSha256?.slice(0,16)}`)) || !/^twitch:\d+$/.test(source.creatorKey ?? '') || !/^[A-Za-z0-9_]{1,30}$/.test(source.handle ?? '') || !SHA.test(source.artifactSha256 ?? '') || !number(source.startSeconds) || !number(source.endSeconds) || source.startSeconds < 0 || source.endSeconds <= source.startSeconds || source.endSeconds - source.startSeconds > 60) fail('derivative_source_invalid');
  let sourceUrl;
  try { sourceUrl = new URL(source.url); } catch { fail('derivative_source_invalid'); }
  const slug = source.candidateId.slice('twitch-clip:'.length);
  const clipUrl=source.kind==='clip'&&!sourceUrl.search&&((sourceUrl.hostname==='clips.twitch.tv'&&sourceUrl.pathname===`/${slug}`)||(sourceUrl.hostname==='www.twitch.tv'&&sourceUrl.pathname===`/${source.handle}/clip/${slug}`));
  const vodUrl=source.kind==='vod_context'&&sourceUrl.hostname==='www.twitch.tv'&&sourceUrl.pathname===`/videos/${source.vodId}`&&/^\?t=\d{1,4}h[0-5]\dm[0-5]\ds$/.test(sourceUrl.search);
  if (sourceUrl.protocol !== 'https:' || sourceUrl.port || sourceUrl.href !== source.url || sourceUrl.username || sourceUrl.password || sourceUrl.hash || !(clipUrl||vodUrl)) fail('derivative_source_invalid');
  object(source.vodAnchor,['quality','evidenceReference','evidenceSha256','uncertaintySeconds']);
  if(!['independently_verified_start','independently_verified_bounded_start','unverified'].includes(source.vodAnchor.quality)||!text(source.vodAnchor.evidenceReference)||!SHA.test(source.vodAnchor.evidenceSha256??'')||
    !((source.vodId===null&&source.vodOffsetSeconds===null&&source.vodAnchor.quality==='unverified')||(/^\d+$/.test(source.vodId??'')&&(source.vodAnchor.quality!=='unverified'?number(source.vodOffsetSeconds)&&source.vodOffsetSeconds>=0:source.vodOffsetSeconds===null)))) fail('derivative_source_invalid');
  if(source.vodAnchor.quality==='independently_verified_bounded_start' ? !number(source.vodAnchor.uncertaintySeconds)||source.vodAnchor.uncertaintySeconds<=0||source.vodAnchor.uncertaintySeconds>2 : source.vodAnchor.uncertaintySeconds!==undefined&&source.vodAnchor.uncertaintySeconds!==0)fail('derivative_source_invalid');
  object(transform, ['renderedAt', 'crop', 'audio']);
  const crop = transform.crop;
  if(crop?.mode==='linear_clamped_x') {
    object(crop,['mode','sourceWidth','sourceHeight','xStart','xEnd','rampSeconds','y','width','height','originalExpression']);
    if(['sourceWidth','sourceHeight','xStart','xEnd','y','width','height'].some(k=>!Number.isSafeInteger(crop[k]))||!number(crop.rampSeconds)||crop.rampSeconds<=0||crop.rampSeconds>60||crop.originalExpression!==`${crop.xStart}+${crop.xEnd-crop.xStart}*min(t/${crop.rampSeconds},1)`||Math.min(crop.xStart,crop.xEnd)<0||Math.max(crop.xStart,crop.xEnd)+crop.width>crop.sourceWidth||crop.y<0||crop.width<=0||crop.height<=0||crop.y+crop.height>crop.sourceHeight)fail('derivative_crop_invalid');
  } else {
    object(crop, ['sourceWidth', 'sourceHeight', 'x', 'y', 'width', 'height']);
    if (['sourceWidth', 'sourceHeight', 'x', 'y', 'width', 'height'].some(key => !Object.hasOwn(crop, key) || !Number.isSafeInteger(crop[key])) || crop.sourceWidth <= 0 || crop.sourceHeight <= 0 || crop.x < 0 || crop.y < 0 || crop.width <= 0 || crop.height <= 0 || crop.x + crop.width > crop.sourceWidth || crop.y + crop.height > crop.sourceHeight) fail('derivative_crop_invalid');
  }
  object(media, ['url', 'storageKind', 'privateFinalRef', 'sha256', 'byteLength', 'durationSeconds', 'width', 'height', 'audio']);
  const native=media.storageKind===undefined&&media.privateFinalRef===undefined&&approvedNativeMediaUrl(media.url);
  const privateFinal=media.storageKind==='private_council_v1'&&media.url===undefined&&validPrivateFinalReference(media.privateFinalRef)&&media.privateFinalRef===`final-${media.sha256}`;
  if (!(native||privateFinal) || !SHA.test(media.sha256 ?? '') || !Number.isSafeInteger(media.byteLength) || media.byteLength < 1024 || media.byteLength > 32 * 1024 * 1024 || !number(media.durationSeconds) || media.durationSeconds < 10 || media.durationSeconds > 60 || media.width !== 1080 || media.height !== 1920) fail('derivative_media_invalid');
  if (Math.abs(media.durationSeconds - (source.endSeconds - source.startSeconds)) > 0.15) fail('derivative_segment_duration_mismatch');
  if (!((transform.audio === 'all_source_audio_removed' && media.audio === 'absent' && manifest.audioReplacement === undefined) || (transform.audio === 'licensed_instrumental_replacement' && media.audio === 'licensed_instrumental_only'))) fail('derivative_audio_profile_unsupported');
  if (!text(manifest.caption, 2200) || reviewedMediaHash(manifest.caption) !== manifest.captionSha256 || !manifest.caption.includes(source.url) || !new RegExp(`(?:^|[^a-z0-9_])@?${source.handle}(?:$|[^a-z0-9_])`, 'i').test(manifest.caption.replace(source.url, ''))) fail('derivative_caption_invalid');
  object(qa, ['maker', 'checker', 'checkedAt', 'reportReference', 'reportSha256', 'finalSha256', 'captionSha256', 'verdict']);
  if (!ID.test(qa.maker ?? '') || !ID.test(qa.checker ?? '') || qa.maker === qa.checker || !text(qa.reportReference) || !SHA.test(qa.reportSha256 ?? '') || qa.finalSha256 !== media.sha256 || qa.captionSha256 !== manifest.captionSha256 || qa.verdict !== 'pass') fail('derivative_external_qa_invalid');
  object(rights, ['holder', 'basis', 'evidenceReference', 'evidenceSha256', 'retainedVisual', 'retainedAudio', 'gameplayExcluded', 'commercialSocial', 'publicMediaStaging', 'requiredCaptionText', 'validFrom', 'licenseTerm', 'membership']);
  if (!text(rights.holder, 200) || !['owned', 'licensed', 'permission'].includes(rights.basis) || !text(rights.evidenceReference) || !SHA.test(rights.evidenceSha256 ?? '') || rights.retainedVisual !== 'approved' || rights.retainedAudio !== (media.audio === 'absent' ? 'none' : 'separately_licensed_instrumental') || rights.gameplayExcluded !== true || rights.commercialSocial !== true || rights.publicMediaStaging !== true || !Array.isArray(rights.requiredCaptionText) || rights.requiredCaptionText.length > 20 || rights.requiredCaptionText.some(v => !text(v, 300) || !manifest.caption.includes(v))) fail('derivative_retained_rights_invalid');
  object(rights.licenseTerm, ['kind', 'notAfter', 'verifierId', 'campaignId']);
  if (!['indefinite', 'fixed_until', 'conditional_live'].includes(rights.licenseTerm.kind) ||
      (rights.licenseTerm.kind === 'fixed_until' && !Number.isFinite(stamp(rights.licenseTerm.notAfter))) ||
      (rights.licenseTerm.kind === 'conditional_live' && !ID.test(rights.licenseTerm.verifierId ?? '')) ||
      (rights.licenseTerm.kind !== 'fixed_until' && rights.licenseTerm.notAfter != null) ||
      (rights.licenseTerm.kind !== 'conditional_live' && rights.licenseTerm.verifierId != null)) fail('derivative_license_term_invalid');
  object(manifest.destination, ['brandId', 'network', 'account']);
  const destination = findDestination(manifest.destination);
  if (!destination || destination.account !== manifest.destination.account || destinationKey(destination) !== destinationKey(manifest.destination)) fail('derivative_destination_invalid');
  for(const time of [manifest.scheduledAt,manifest.windowStart,manifest.windowEnd,manifest.expiresAt])if(!Number.isFinite(stamp(time))||new Date(stamp(time)).toISOString()!==time)fail('derivative_time_not_canonical_utc');
  if(manifest.thirdPartyCommercial===true&&manifest.destination.network!=='tiktok')fail('derivative_commercial_network_unsupported');
  const sourceAt = stamp(source.publishedAt), renderedAt = stamp(transform.renderedAt), checkedAt = stamp(qa.checkedAt);
  const dispatchWindow=validateReviewedDispatch(manifest,now);
  const from = stamp(rights.validFrom), slot = stamp(manifest.scheduledAt), start = stamp(manifest.windowStart), end = stamp(manifest.windowEnd), expiry = stamp(manifest.expiresAt);
  if (![sourceAt, renderedAt, checkedAt, from, slot, start, end, expiry, now].every(Number.isFinite) || sourceAt > renderedAt || renderedAt > checkedAt || checkedAt > now || renderedAt - sourceAt > 72 * 3600000 || from > now || (!dispatchWindow&&slot <= now) || slot < start || slot >= end || slot >= expiry || expiry <= now || end > expiry || (rights.licenseTerm.kind === 'fixed_until' && expiry > stamp(rights.licenseTerm.notAfter))) fail('derivative_time_scope_invalid');
  if (media.audio === 'licensed_instrumental_only') validateDerivativeAudioReplacement(manifest.audioReplacement, {finalSha256:media.sha256,caption:manifest.caption,captionSha256:manifest.captionSha256,durationSeconds:media.durationSeconds,maker:qa.maker,checker:qa.checker,now});
  if(rights.licenseTerm.kind==='conditional_live') {
    if(manifest.destination.network!=='tiktok'||manifest.thirdPartyCommercial!==true||!/#ad(?:\s|$)/i.test(manifest.caption)) fail('derivative_campaign_disclosure_required');
    const m=rights.membership;object(m,['campaignId','joinedObservedAt','evidenceReference','evidenceSha256','leaseExpiresAt','operationalConditionAttested']);
    const observed=stamp(m.joinedObservedAt),lease=stamp(m.leaseExpiresAt);
    if(!/^[a-f0-9-]{36}$/.test(rights.licenseTerm.campaignId??'')||m.campaignId!==rights.licenseTerm.campaignId||!text(m.evidenceReference)||!SHA.test(m.evidenceSha256??'')||m.operationalConditionAttested!==true||!Number.isFinite(observed)||observed>now||now-observed>24*3600000||!Number.isFinite(lease)||lease<=now||lease>observed+24*3600000||slot>=lease||expiry>lease||(dispatchWindow&&dispatchWindow.end>lease)) fail('derivative_membership_lease_unverified');
  } else if(rights.membership!==undefined||rights.licenseTerm.campaignId!==undefined) fail('derivative_license_term_invalid');
  return manifest;
}

/** The authenticated server supplies principal/method; no JSON import may self-approve. */
export function approveReviewedDerivative(proposal, { principal, operatorLabel, now = Date.now(), expectedDigest, attestRights, attestExternalQa } = {}) {
  validateReviewedDerivativeManifest(proposal.manifest, now);
  const digest = reviewedDerivativeDigest(proposal.manifest);
  if (proposal.status !== 'proposed' || proposal.manifestSha256 !== digest || expectedDigest !== digest || !text(principal, 200) || !text(operatorLabel, 120) || attestRights !== true || attestExternalQa !== true) fail('derivative_owner_approval_required');
  return { ...proposal, status: 'approved', origin: 'owner_authorized_external_review', approval: { principal, operatorLabel, method: 'authenticated_owner_authorized_operator', approvedAt: new Date(now).toISOString(), manifestSha256: digest } };
}

export function reviewedDerivativeGate(record, { owner, now = Date.now(), destination, scheduledAt, liveEligibility } = {}) {
  try {
    if (!text(owner, 200) || !record || record.status !== 'approved' || record.origin !== 'owner_authorized_external_review' || record.approval?.principal !== owner || record.approval?.method !== 'authenticated_owner_authorized_operator' || !text(record.approval?.operatorLabel, 120) || !Number.isFinite(stamp(record.approval?.approvedAt)) || stamp(record.approval.approvedAt) > now) return 'derivative_owner_approval_required';
    validateReviewedDerivativeManifest(record.manifest, now);
    const digest = reviewedDerivativeDigest(record.manifest);
    if (record.manifestSha256 !== digest || record.approval.manifestSha256 !== digest || stamp(record.approval.approvedAt) < stamp(record.manifest.qa.checkedAt)) return 'derivative_approval_changed';
    if (destination && destinationKey(destination) !== destinationKey(record.manifest.destination)) return 'derivative_destination_changed';
    if (scheduledAt && scheduledAt !== reviewedDeliverySlot(record)) return 'derivative_slot_changed';
    if (record.manifest.rights.licenseTerm.kind === 'conditional_live' && (!liveEligibility || liveEligibility.allowed !== true || liveEligibility.verifierId !== record.manifest.rights.licenseTerm.verifierId || liveEligibility.manifestSha256 !== digest || !Number.isFinite(stamp(liveEligibility.checkedAt)) || stamp(liveEligibility.checkedAt) > now || now - stamp(liveEligibility.checkedAt) > 30000)) return 'derivative_live_eligibility_unverified';
    return null;
  } catch (error) { return error.message; }
}
