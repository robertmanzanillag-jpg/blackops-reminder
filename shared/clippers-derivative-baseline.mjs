// Owner-attributed provenance is separate from provider read-back and from a rights grant.
import { DESTINATIONS, destinationKey, localDay } from '../script/clippers-portfolio-metricool.mjs';
import { reviewedMediaHash, approvedNativeMediaUrl } from './clippers-reviewed-derivative.mjs';
const SHA = /^[a-f0-9]{64}$/;
const day = value => /^\d{4}-\d{2}-\d{2}$/.test(value ?? '') && Number.isFinite(Date.parse(value));
export function validateDerivativeBaseline(baseline, manifest) {
  if (!baseline || Object.keys(baseline).some(k => !['fromDay','throughDay','sourceOriginAt','originEvidenceReference','originEvidenceSha256','rows'].includes(k)) || !day(baseline.fromDay) || !day(baseline.throughDay) || !Array.isArray(baseline.rows) || baseline.rows.length > 500 ||
      !Number.isFinite(Date.parse(baseline.sourceOriginAt)) || !baseline.originEvidenceReference || !SHA.test(baseline.originEvidenceSha256 ?? '') ||
      baseline.fromDay > localDay(new Date(Date.parse(baseline.sourceOriginAt) - 86400000)) || baseline.throughDay < localDay(new Date(Date.parse(manifest.scheduledAt) + 86400000)) ||
      Date.parse(baseline.throughDay) - Date.parse(baseline.fromDay) > 31 * 86400000 || Date.parse(baseline.sourceOriginAt) > Date.parse(manifest.source.publishedAt)) throw Error('derivative_baseline_scope_invalid');
  const seen = new Set();
  for (const row of baseline.rows) {
    if (!row || Object.keys(row).some(k=>!['id','uuid','destinationKey','scheduledAt','mediaUrl','mediaSha256','byteLength','captionSha256','sourceId','segment','physicalSource'].includes(k)) || !/^\d+$/.test(row.id ?? '') || !/^[A-Za-z0-9_-]{1,100}$/.test(row.uuid ?? '') || !DESTINATIONS.some(d=>destinationKey(d)===row.destinationKey) || (!Number.isFinite(Date.parse(row.scheduledAt))||new Date(row.scheduledAt).toISOString()!==row.scheduledAt) || !approvedNativeMediaUrl(row.mediaUrl) || !SHA.test(row.mediaSha256 ?? '') || !SHA.test(row.captionSha256 ?? '') || !Number.isSafeInteger(row.byteLength) || row.byteLength<1024 || row.byteLength>32*1024*1024 || typeof row.sourceId!=='string' || !/^[A-Za-z0-9_.:-]{1,160}$/.test(row.sourceId) || !row.segment || Object.keys(row.segment).some(k=>!['key','start','end'].includes(k)) || typeof row.segment.key!=='string' || !/^[A-Za-z0-9_.:-]{1,160}$/.test(row.segment.key) || !(row.segment.start===null || (Number.isFinite(row.segment.start)&&row.segment.start>=0))) throw Error('derivative_baseline_mapping_invalid');
    if(row.physicalSource!=null&&(!row.physicalSource||Object.keys(row.physicalSource).some(k=>!['quality','sha256','start','end'].includes(k))||row.physicalSource.quality!=='verified_physical_file'||!SHA.test(row.physicalSource.sha256??'')||!Number.isFinite(row.physicalSource.start)||!Number.isFinite(row.physicalSource.end)||row.physicalSource.start<0||row.physicalSource.end<=row.physicalSource.start))throw Error('derivative_baseline_mapping_invalid');
    if(row.segment.end!==undefined&&(!Number.isFinite(row.segment.end)||!Number.isFinite(row.segment.start)||row.segment.end<=row.segment.start))throw Error('derivative_baseline_mapping_invalid');
    const key = row.destinationKey+':'+row.uuid;
    if(seen.has(key)) throw Error('derivative_baseline_identity_conflict'); seen.add(key);
  }
  return baseline;
}
/** Actual complete provider rows must all map, including drafts/errors/uncertain rows. No inference from caption. */
export function matchDerivativeBaseline(baseline, actual) {
  if (!Array.isArray(actual) || actual.length>500) throw Error('derivative_baseline_unverified');
  const mapped = new Map(baseline.rows.map(r=>[r.destinationKey+':'+r.uuid,r]));
  const seen = new Set(), entries=[];
  for(const row of actual){
    const key=row?.destinationKey+':'+row?.uuid, proof=mapped.get(key);
    if(!proof || seen.has(key) || String(row.id)!==proof.id || row.scheduledAt!==proof.scheduledAt || row.mediaUrl!==proof.mediaUrl || reviewedMediaHash(row.caption)!==proof.captionSha256) throw Error('derivative_baseline_unmapped_or_changed');
    seen.add(key); entries.push({candidateId:proof.sourceId,sourceId:proof.sourceId,segment:proof.segment,physicalSource:proof.physicalSource??null,mediaSha256:proof.mediaSha256,destinationKey:proof.destinationKey,origin:'owner_attributed_metricool_readback',metricoolId:proof.id,metricoolUuid:proof.uuid});
  }
  // Removed/hidden rows cannot silently free their original-source reservation.
  for(const proof of baseline.rows)if(!seen.has(proof.destinationKey+':'+proof.uuid))throw Error('derivative_baseline_missing_receipt');
  return entries;
}
