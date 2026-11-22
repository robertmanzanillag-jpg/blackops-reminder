import { DESTINATIONS, destinationKey } from '../../script/clippers-portfolio-metricool.mjs';
export const fixtureGrants = (candidates, now) => Object.fromEntries(candidates.map(c => [c.id, {
  schemaVersion: 1, status: 'approved', basis: 'permission', rightsHolder: 'Test fixture rights holder',
  candidateId: c.id, sourceUrl: c.sourceUrl, creatorKey: c.creatorKey,
  review: { actor: 'owner', id: 'fixture-owner-review', at: new Date(now - 3600000).toISOString() },
  evidence: { reference: 'fixture-only:not-production-evidence', sha256: 'e'.repeat(64) },
  scope: { audio: true, video: true, editing: true, commercialSocial: true, wholeSource: true, publicMediaStaging: true },
  validFrom: new Date(now - 86400000).toISOString(), validUntil: new Date(now + 7 * 86400000).toISOString(),
  destinations: DESTINATIONS.map(destinationKey),
}]));
