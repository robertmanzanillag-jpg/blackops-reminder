import { DESTINATIONS } from '../../script/clippers-portfolio-metricool.mjs';
import { reviewedMediaHash, reviewedDerivativeDigest, approveReviewedDerivative } from '../../shared/clippers-reviewed-derivative.mjs';
export const DERIVATIVE_NOW = Date.parse('2026-11-22T12:00:00Z');
export const FINAL_BYTES = Buffer.alloc(1536, 0x42);
export function derivativeFixture(now = DERIVATIVE_NOW) {
  const caption = '@fixturecreator — source: https://clips.twitch.tv/FixtureClip';
  const manifest = {
    schemaVersion: 1, contentClass: 'reviewed_derivative', id: 'derivative-fixture',
    source: { kind:'clip', candidateId: 'twitch-clip:FixtureClip', creatorKey: 'twitch:12345', handle: 'fixturecreator', url: 'https://clips.twitch.tv/FixtureClip', artifactSha256: 'a'.repeat(64), publishedAt: new Date(now - 2 * 3600000).toISOString(), startSeconds: 3, endSeconds: 23, vodId: '1234567', vodOffsetSeconds: 300, vodAnchor:{quality:'independently_verified_start',evidenceReference:'fixture-only:verified-vod-start',evidenceSha256:'a'.repeat(64)} },
    transform: { renderedAt: new Date(now - 600000).toISOString(), crop: { sourceWidth: 1920, sourceHeight: 1080, x: 1500, y: 100, width: 300, height: 400 }, audio: 'all_source_audio_removed' },
    media: { url: 'https://static.metricool.com/fixture/final.mp4', sha256: reviewedMediaHash(FINAL_BYTES), byteLength: FINAL_BYTES.length, durationSeconds: 20, width: 1080, height: 1920, audio: 'absent' },
    caption, captionSha256: reviewedMediaHash(caption),
    qa: { maker: 'fixture-maker', checker: 'fixture-independent-checker', checkedAt: new Date(now - 300000).toISOString(), reportReference: 'private-vault:fixture-qa', reportSha256: 'b'.repeat(64), finalSha256: reviewedMediaHash(FINAL_BYTES), captionSha256: reviewedMediaHash(caption), verdict: 'pass' },
    rights: { holder: 'Fixture retained camera rights holder', basis: 'permission', evidenceReference: 'private-vault:fixture-camera-permission', evidenceSha256: 'c'.repeat(64), retainedVisual: 'approved', retainedAudio: 'none', gameplayExcluded: true, commercialSocial: true, publicMediaStaging: true, requiredCaptionText: ['@fixturecreator'], validFrom: new Date(now - 3 * 3600000).toISOString(), licenseTerm: { kind: 'fixed_until', notAfter: new Date(now + 2 * 86400000).toISOString() } },
    destination: { ...DESTINATIONS[0] }, scheduledAt: new Date(now + 3 * 3600000).toISOString(), windowStart: new Date(now + 2 * 3600000).toISOString(), windowEnd: new Date(now + 4 * 3600000).toISOString(), expiresAt: new Date(now + 86400000).toISOString(), language: 'en', thirdPartyCommercial: true,
  };
  const proposal = { status: 'proposed', manifest, manifestSha256: reviewedDerivativeDigest(manifest), proposedAt: new Date(now).toISOString() };
  return { manifest, proposal, approved: () => approveReviewedDerivative(proposal, { principal: 'fixture-owner', operatorLabel: 'Authorized Codex fixture', now, expectedDigest: proposal.manifestSha256, attestRights: true, attestExternalQa: true }) };
}
export const fixtureProbe = { streams: [{ codec_type: 'video', width: 1080, height: 1920 }], format: { duration: '20', format_name: 'mov,mp4,m4a,3gp,3g2,mj2' } };
