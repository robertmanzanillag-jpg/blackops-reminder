import test from 'node:test';
import { execFile, spawnSync } from 'node:child_process';
import { promisify } from 'node:util';
import { tmpdir } from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { writeFile, access, mkdtemp, readFile, rm } from 'node:fs/promises';
import { validateReviewedDerivativeManifest, approveReviewedDerivative, reviewedDerivativeGate, reviewedDerivativeDigest, reviewedMediaHash } from '../shared/clippers-reviewed-derivative.mjs';
import { loadSealedReviewedDerivative, verifySealedDerivativeFile } from '../script/clippers-reviewed-derivative-media.mjs';
import { derivativeFixture, DERIVATIVE_NOW as NOW, FINAL_BYTES, fixtureProbe } from './helpers/reviewed-derivative-fixture.mjs';

test('proposal JSON cannot self-approve or claim raw whole-source/canonical render rights', () => {
  const inherited = derivativeFixture().manifest; inherited.source = Object.create(inherited.source); assert.throws(() => validateReviewedDerivativeManifest(inherited, NOW));
  for (const field of ['sourceWidth', 'sourceHeight', 'x', 'y', 'width', 'height']) { const m = derivativeFixture().manifest; delete m.transform.crop[field]; assert.throws(() => validateReviewedDerivativeManifest(m, NOW)); }
  const f = derivativeFixture(); assert.equal(validateReviewedDerivativeManifest(f.manifest, NOW), f.manifest);
  assert.equal(reviewedDerivativeGate(f.proposal, { owner: 'fixture-owner', now: NOW }), 'derivative_owner_approval_required');
  for (const mutate of [m => m.approval = { principal: 'fixture-owner' }, m => m.rights.wholeSource = true, m => m.renderReceiptSha256 = 'd'.repeat(64), m => m.contentClass = 'owned_original']) {
    const m = structuredClone(f.manifest); mutate(m); assert.throws(() => validateReviewedDerivativeManifest(m, NOW));
  }
  assert.throws(() => approveReviewedDerivative(f.proposal, { principal: 'fixture-owner', operatorLabel: 'Codex', now: NOW, expectedDigest: f.proposal.manifestSha256, attestRights: true }), /owner_approval_required/);
  assert.throws(() => approveReviewedDerivative(f.proposal, { principal: 'fixture-owner', operatorLabel: 'Codex', now: NOW, expectedDigest: '0'.repeat(64), attestRights: true, attestExternalQa: true }), /owner_approval_required/);
});
test('approval binds exact final/caption/QA/source/destination/slot/expiry and authenticated principal', () => {
  const f = derivativeFixture(), r = f.approved(); assert.equal(reviewedDerivativeGate(r, { owner: 'fixture-owner', now: NOW }), null);
  assert.ok(reviewedDerivativeGate({ ...r, approval: { ...r.approval, principal: undefined } }, { now: NOW }));
  assert.ok(reviewedDerivativeGate({ ...r, approval: { ...r.approval, approvedAt: new Date(NOW - 3600000).toISOString() } }, { owner: 'fixture-owner', now: NOW }));
  assert.equal(r.origin, 'owner_authorized_external_review'); assert.equal(r.approval.method, 'authenticated_owner_authorized_operator');
  assert.equal(reviewedDerivativeGate(r, { owner: 'other', now: NOW }), 'derivative_owner_approval_required');
  for (const mutate of [m => m.id += '-changed', m => m.source.artifactSha256 = 'd'.repeat(64), m => m.qa.reportSha256 = 'e'.repeat(64), m => m.scheduledAt = new Date(NOW + 3.5 * 3600000).toISOString(), m => m.expiresAt = new Date(NOW + 25 * 3600000).toISOString()]) {
    const changed = structuredClone(r); mutate(changed.manifest); assert.ok(reviewedDerivativeGate(changed, { owner: 'fixture-owner', now: NOW }));
  }
  assert.equal(reviewedDerivativeGate(r, { owner: 'fixture-owner', now: NOW, scheduledAt: new Date(NOW + 4 * 3600000).toISOString() }), 'derivative_slot_changed');
  assert.equal(reviewedDerivativeGate({ ...r, status: 'revoked' }, { owner: 'fixture-owner', now: NOW }), 'derivative_owner_approval_required');
});
test('source provenance, independent QA, retained rights, muted-only profile and time scope fail closed', () => {
  for (const mutate of [m => m.source.url += '-another', m => m.source.startSeconds = -1, m=>m.destination={brandId:6591612,network:'facebook',account:'1193011863901514'}, m=>m.scheduledAt=m.scheduledAt.replace('.000Z','+00:00'), m=>m.scheduledAt='2026-11-22T17:00:00+02:00', m => m.source.url = 'https://clips.twitch.tv:444/FixtureClip', m => m.media.durationSeconds = 10, m => m.transform.crop.x = 1900, m => m.qa.checker = m.qa.maker, m => m.qa.finalSha256 = '0'.repeat(64), m => m.rights.gameplayExcluded = false, m => m.media.audio = 'licensed_music', m => m.transform.audio = 'muted_track', m => m.qa.checkedAt = new Date(NOW + 1).toISOString(), m => m.source.publishedAt = new Date(NOW - 5 * 86400000).toISOString(), m => m.caption += 'changed', m => m.rights.licenseTerm.notAfter = new Date(NOW + 1).toISOString()]) {
    const m = derivativeFixture().manifest; mutate(m); assert.throws(() => validateReviewedDerivativeManifest(m, NOW));
  }
});
test('open-ended campaign conditions need an actual trusted live check, not an invented expiry', () => {
  const f = derivativeFixture(); f.manifest.thirdPartyCommercial=true; f.manifest.caption+=' #ad'; f.manifest.captionSha256=reviewedMediaHash(f.manifest.caption); f.manifest.qa.captionSha256=f.manifest.captionSha256; f.manifest.rights.licenseTerm = { kind: 'conditional_live', verifierId: 'campaign-fixture', campaignId:'a5c63fad-cd53-4b81-9305-4a2d1696872a' }; f.manifest.rights.membership={campaignId:f.manifest.rights.licenseTerm.campaignId,joinedObservedAt:new Date(NOW).toISOString(),evidenceReference:'private-vault:joined',evidenceSha256:'a'.repeat(64),leaseExpiresAt:new Date(NOW+86400000).toISOString(),operationalConditionAttested:true}; f.proposal.manifestSha256 = reviewedDerivativeDigest(f.manifest);
  const r = f.approved(); assert.equal(reviewedDerivativeGate(r, { owner: 'fixture-owner', now: NOW }), 'derivative_live_eligibility_unverified');
  const live = { allowed: true, verifierId: 'campaign-fixture', manifestSha256: r.manifestSha256, checkedAt: new Date(NOW).toISOString() };
  assert.equal(reviewedDerivativeGate(r, { owner: 'fixture-owner', now: NOW, liveEligibility: live }), null);
  assert.ok(reviewedDerivativeGate(r, { owner: 'fixture-owner', now: NOW + 31000, liveEligibility: live }));
});
test('sealed final fetch is bounded, refuses redirects/foreign hosts, verifies exact bytes and absent audio without rendering', async () => {
  const media = derivativeFixture().manifest.media; const calls = [];
  const final = await loadSealedReviewedDerivative(media, { fetch: async (url, options) => { calls.push({ url, options }); return new Response(FINAL_BYTES, { headers: { 'content-type': 'video/mp4', 'content-length': String(FINAL_BYTES.length) } }); }, probe: async () => fixtureProbe });
  try {
    assert.equal(calls.length, 1); assert.equal(calls[0].url, media.url); assert.equal(calls[0].options.redirect, 'error');
    await verifySealedDerivativeFile(final.file, media);
    await writeFile(final.file, Buffer.alloc(FINAL_BYTES.length, 0x43)); await assert.rejects(verifySealedDerivativeFile(final.file, media), /file_changed/);
  } finally { await final.cleanup(); }
  await assert.rejects(access(final.file));
  for (const url of ['http://127.0.0.1/x.mp4', 'https://evil.example/final.mp4', 'https://static.metricool.com@evil.example/final.mp4', media.url + '?token=secret']) await assert.rejects(loadSealedReviewedDerivative({ ...media, url }), /url_invalid/);
  await assert.rejects(loadSealedReviewedDerivative(media, { fetch: async () => new Response(Buffer.alloc(media.byteLength + 1)), probe: async () => fixtureProbe }), /size_mismatch/);
  await assert.rejects(loadSealedReviewedDerivative(media, { fetch: async () => new Response(Buffer.alloc(media.byteLength)), probe: async () => fixtureProbe }), /hash_mismatch/);
  await assert.rejects(loadSealedReviewedDerivative(media, { fetch: async () => new Response(FINAL_BYTES), probe: async () => ({ ...fixtureProbe, streams: [...fixtureProbe.streams, { codec_type: 'audio' }] }) }), /probe_mismatch/);
});

test('real ffprobe verifies a sealed muted MP4 without source download or rendering in the loader', { skip: spawnSync('ffmpeg', ['-version']).status !== 0 || spawnSync('ffprobe', ['-version']).status !== 0 }, async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'derivative-probe-test-'));
  try {
    const video = path.join(directory, 'original-test-fixture.mp4');
    await promisify(execFile)('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'color=black:s=1080x1920:r=10:d=10', '-an', '-c:v', 'libx264', '-threads', '1', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', video], { timeout: 30000 });
    const bytes = await readFile(video), media = { ...derivativeFixture().manifest.media, durationSeconds: 10, sha256: reviewedMediaHash(bytes), byteLength: bytes.length };
    const sealed = await loadSealedReviewedDerivative(media, { fetch: async () => new Response(bytes, { headers: { 'content-type': 'video/mp4' } }) });
    try { assert.equal(sealed.verification.audioStreams, 0); await verifySealedDerivativeFile(sealed.file, media); }
    finally { await sealed.cleanup(); }
  } finally { await rm(directory, { recursive: true, force: true }); }
});
