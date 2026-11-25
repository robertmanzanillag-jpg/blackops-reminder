// Positive rights evidence is independent of discovery policy and posting approval.
// Only the trusted owner/operator may populate this ledger; discovery never does.
const nonempty = v => typeof v === 'string' && v.trim().length > 0;
const instant = v => typeof v === 'string' && /(?:Z|[+-]\d{2}:\d{2})$/.test(v) ? Date.parse(v) : NaN;
export function sourceRightsGate(state, candidate, { now = Date.now(), destinationKey = null, scheduledAt = null } = {}) {
  if (!candidate?.id || !candidate.sourceUrl || !candidate.creatorKey) return 'rights_source_missing';
  const current = state?.candidates?.find(c => c.id === candidate.id);
  if (!current || current.sourceUrl !== candidate.sourceUrl || current.creatorKey !== candidate.creatorKey) return 'rights_source_mismatch';
  const records = state?.sourceAuthorizations;
  const grant = records && Object.hasOwn(records, candidate?.id) ? records[candidate.id] : null;
  if (!grant) return 'rights_authorization_missing';
  if (grant.status !== 'approved') return 'rights_authorization_inactive';
  if (grant.schemaVersion !== 1 || grant.review?.actor !== 'owner' || !nonempty(grant.review?.id) ||
      !Number.isFinite(instant(grant.review?.at)) || instant(grant.review.at) > now ||
      !['owned', 'licensed', 'permission', 'owner_default_policy'].includes(grant.basis) || (grant.basis === 'owner_default_policy' && (grant.policy?.version !== 1 || grant.review?.method !== 'standing_policy')) || !nonempty(grant.rightsHolder) ||
      !nonempty(grant.evidence?.reference) || !/^[a-f0-9]{64}$/.test(grant.evidence?.sha256 ?? '')) return 'rights_evidence_unverified';
  if (grant.candidateId !== candidate.id || grant.sourceUrl !== candidate.sourceUrl || grant.creatorKey !== candidate.creatorKey) return 'rights_source_mismatch';
  // Narrow/segment-only grants are not promoted to whole-source permissions.
  if (['video', 'audio', 'editing', 'commercialSocial', 'wholeSource', 'publicMediaStaging'].some(k => grant.scope?.[k] !== true)) return 'rights_scope_incomplete';
  const start = instant(grant.validFrom), end = instant(grant.validUntil);
  if (!Number.isFinite(now) || !Number.isFinite(start) || !Number.isFinite(end) || end <= start || now < start || now >= end) return 'rights_outside_validity';
  if (!Array.isArray(grant.destinations) || !grant.destinations.length || grant.destinations.some(k => !nonempty(k) || !/^\d+:(tiktok|facebook):[^:]+$/.test(k))) return 'rights_destination_missing';
  if (destinationKey !== null && !grant.destinations.includes(destinationKey)) return 'rights_destination_mismatch';
  if (scheduledAt !== null) { const slot = instant(scheduledAt); if (!Number.isFinite(slot) || slot < Math.max(now, start) || slot >= end) return 'rights_publication_outside_validity'; }
  return null;
}
