import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile, spawnSync } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import { chmod, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DESTINATIONS } from '../script/clippers-portfolio-metricool.mjs';
import { editorialEngineSha256 } from '../script/clippers-reviewed-editorial-engine.mjs';
import { REVIEWED_EDITORIAL, readConfirmedReviewedEditorial, readReviewedEditorialPacket, renderReviewedEditorial } from '../script/clippers-reviewed-editorial.mjs';
import { runClippersPortfolioPrepare } from '../script/clippers-portfolio-prepare.mjs';
import { validateApprovedClippersAsset } from '../script/clippers-daily-learning.mjs';
import { reconcileExternalMetricoolSchedule } from '../script/clippers-native-media-receipts.mjs';
import { runClippersWeeklyScheduling } from '../script/clippers-weekly-scheduler.mjs';
import { weeklyDeliveryCollision, weeklyDigest as digest } from '../script/clippers-weekly-policy.mjs';

const exec = promisify(execFile);
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const now = new Date('2026-11-19T22:20:00.000Z');
const prepNow = new Date(+now + 90_000);
const scheduledAt = '2026-11-21T01:18:00.000Z';
const window = { startDate: '2026-11-19', endDate: '2026-11-22' };
const config = 'config/clippers-daily-learning';
const reports = 'reports/clippers-daily-learning';
const nativeUrl = 'https://static.metricool.com/video/123/202611/editorial-fixture.mp4';
const available = ['ffmpeg', 'ffprobe'].every(program => spawnSync(program, ['-version']).status === 0);
const titleAvailable = available && spawnSync('magick', ['-version']).status === 0;
const prepEnv = { CLIPPERS_PORTFOLIO_PREPARE_ENABLED: 'true', CLIPPERS_PUBLIC_MEDIA_UPLOAD_AUTHORIZED: 'true' };
const requiredAttribution = 'L. Example, Original teaching video (CC BY 4.0). Edited for length and portrait framing.';
const initialState = { schemaVersion: 1, day: '2026-11-18', deliveries: [], observations: [], history: [], versions: { '6431685:tiktok:streamersclips': 'pinned-live' } };

async function workspace(t) {
  const root = await realpath(await mkdtemp(path.join(tmpdir(), 'reviewed-editorial-test-')));
  t.after(() => rm(root, { recursive: true, force: true }));
  const put = async (relative, data) => {
    const file = path.join(root, relative);
    await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
    await writeFile(file, JSON.stringify(data), { mode: 0o600 });
  };
  const get = async relative => JSON.parse(await readFile(path.join(root, relative)));
  return { root, put, get };
}

async function inputs(t, { renderSource = true, id = 'nov19-exact-fixture', target = DESTINATIONS[0], solid = false } = {}) {
  const f = await workspace(t);
  const sourceFile = 'media.mp4';
  const sourcePath = path.join(f.root, sourceFile);
  if (renderSource) {
    await exec('ffmpeg', ['-nostdin', '-loglevel', 'error', '-f', 'lavfi', '-i', solid ? 'color=c=black:s=320x180:r=12' : 'testsrc2=size=320x180:rate=12',
      '-f', 'lavfi', '-i', 'sine=frequency=550', '-t', '13', '-pix_fmt', 'yuv420p', '-c:v', 'libx264', '-c:a', 'aac', sourcePath]);
    await chmod(sourcePath, 0o600);
  } else {
    await writeFile(sourcePath, 'Synthetic input never passed to ffmpeg', { mode: 0o600 });
  }
  const sourceSha256 = sha(await readFile(sourcePath));
  const sourceUrl = 'https://www.youtube.com/watch?v=aaaaaaaaaaa';
  const rights = { destination: target, sourceSha256, sourcePublishedAt: '2026-11-17T08:00:00.000Z',
    observedAt: '2026-11-19T21:30:00.000Z', validUntil: '2026-11-23T04:00:00.000Z', reviewedBy: 'fixture-rights-review',
    termsUrl: 'https://creativecommons.org/licenses/by/4.0/', sourceScope: 'exact_asset', commercialPermission: 'approved',
    basis: 'public_policy', membership: 'not_required', permittedNetworks: [target.network], thirdPartyCommercial: false };
  const license = { ...rights, sourceUrl, schemaVersion: 1, kind: 'reviewed_exact_asset_license', permissionExpiresAt: null,
    reuseScope: 'licensed_crosspost', requiredAttribution };
  const auth = { schemaVersion: 2, kind: 'reviewed_editorial_authorization', id, destination: target,
    reviewedBy: 'fixture-owner', reviewedAt: '2026-11-19T22:00:00.000Z', expiresAt: rights.validUntil,
    engineSha256: editorialEngineSha256, sourceFile, sourceUrl, sourceSha256, sourceStartSeconds: 1.25,
    params: { duration: 6.5, crop: 'right', caption_layout: 'off' }, captionText: '', scheduledAt,
    windowStart: window.startDate, windowEnd: window.endDate, rights };
  const request = { ...target, schemaVersion: 2, id, renderClass: REVIEWED_EDITORIAL };
  const seal = async () => {
    auth.licenseEvidenceSha256 = digest(license);
    request.authorizationSha256 = digest(auth);
    await f.put(`${config}/rights-evidence/${auth.licenseEvidenceSha256}.json`, license);
    await f.put(`${config}/editorial-authorizations/${request.authorizationSha256}.json`, auth);
    await f.put(`${config}/render-requests/${id}.json`, request);
  };
  const render = () => renderReviewedEditorial({ workspaceRoot: f.root, requestId: id, now });
  return { ...f, id, target, request, auth, rights, license, seal, render };
}

async function reviewed(t, options) {
  const f = await inputs(t, options);
  await f.seal();
  const receipt = await f.render();
  const bytes = await readFile(path.join(f.root, receipt.draftFile));
  const packet = { schemaVersion: 2, id: f.id, destination: f.target, renderClass: REVIEWED_EDITORIAL,
    authorizationSha256: f.request.authorizationSha256, renderRequestSha256: receipt.renderRequestSha256,
    renderReceiptSha256: receipt.receiptSha256, outputSha256: receipt.outputSha256, scheduledAt, sourceUrl: f.auth.sourceUrl,
    campaignId: 'cc-fixture', sourceId: 'original-id', creator: 'speaker', language: 'en', caption: 'A useful excerpt. ' + requiredAttribution,
    thirdPartyCommercial: false, reviewedBy: 'fixture-output-review', reviewedAt: prepNow.toISOString(), quality: 'passed',
    originalEdit: 'verified', disclosure: 'verified', publicUploadAuthorized: true, schedulerAssetAuthorized: true,
    authorizedSpendUsd: 0, providerIncrementalCostUsd: 0, mediaProvider: 'metricool' };
  const packetPath = `${config}/prepare-requests/${f.id}.json`;
  const nativePath = `${reports}/native-media-imports/${f.id}.json`;
  const native = { schemaVersion: 1, provider: 'metricool', kind: 'metricool_native_media_receipt', status: 'ready',
    assetId: f.id, destination: f.target, renderReceiptSha256: receipt.receiptSha256, renderRequestSha256: receipt.renderRequestSha256,
    sha256: receipt.outputSha256, sizeBytes: bytes.length, mediaUrl: nativeUrl, resource: { kind: 'metricool_cdn_url', url: nativeUrl },
    verifiedAt: prepNow.toISOString(), verification: 'anonymous_exact_bytes_sha256', paidSpendAllowed: false, paidSpendUsd: 0,
    authorizedManifestSha256: digest(packet) };
  const fetcher = async url => {
    assert.equal(url, nativeUrl);
    return new Response(bytes, { headers: { 'content-type': 'video/mp4' } });
  };
  const prepare = () => runClippersPortfolioPrepare({ workspaceRoot: f.root, now: prepNow, env: prepEnv, dependencies: { nativeFetch: fetcher } });
  return { ...f, receipt, packet, packetPath, nativePath, native, bytes, fetcher, prepare };
}

test('prospective reviewed render stays outside learning and enters exact future weekly scheduling after media review', { skip: !available }, async t => {
  const f = await reviewed(t);
  const { receipt, packet } = f;
  assert.equal(receipt.startSeconds, 1.25);
  assert.equal(receipt.endSeconds, 7.75);
  assert.equal(receipt.actualParams.duration, 6.5);
  assert.equal(receipt.scheduledAt, scheduledAt);
  assert.equal(receipt.renderClass, REVIEWED_EDITORIAL);
  for (const key of ['comparison', 'experiment', 'policyVersion', 'quality']) assert.equal(Object.hasOwn(receipt, key), false);
  assert.equal(receipt.outputSha256, sha(f.bytes));
  assert.deepEqual(await renderReviewedEditorial({ workspaceRoot: f.root, requestId: f.id, now: prepNow }), receipt);
  await assert.rejects(readFile(path.join(f.root, reports, 'state.json')), { code: 'ENOENT' });
  await assert.rejects(readReviewedEditorialPacket(f.root, f.id, { now: prepNow }), { code: 'ENOENT' });
  await f.put(f.packetPath, packet);
  await f.put(f.nativePath, f.native);
  await f.put(`${reports}/state.json`, initialState);
  const prepared = await f.prepare();
  assert.equal(prepared.prepared, 1);
  assert.equal(prepared.uploaded, 0);
  const input = await f.get(`${config}/approved-input.json`);
  const rows = await f.get(`${reports}/portfolio-media-receipts.json`);
  const [asset] = input.assets;
  assert.equal(input.publish, false);
  assert.equal(asset.preparePacketSha256, digest(packet));
  assert.equal(asset.weeklyAuthorizationSha256, digest(f.auth));
  assert.equal(asset.policyVersion, undefined);
  assert.equal(await validateApprovedClippersAsset(asset, f.root, prepNow, rows, initialState), null);
  const approved = await validateApprovedClippersAsset(asset, f.root, prepNow, rows, initialState, window);
  assert.deepEqual(approved.renderProof, { renderClass: REVIEWED_EDITORIAL, authorizationSha256: digest(f.auth) });
  assert.equal(approved.weeklySourceProof.sourceIdentity, 'youtube:aaaaaaaaaaa');
  assert.equal(approved.weeklySourceProof.reuseScope, 'licensed_crosspost');
  assert.deepEqual(await f.get(`${reports}/state.json`), initialState);
  let calls = 0;
  const adapter = { async weeklyPreflight() {
    const evidence = { test: true };
    return { day: '2026-11-20', confirmedCount: 0, scheduledIds: [], publishedIds: [], evidence, evidenceSha256: digest(evidence) };
  }, async schedule() { calls++; return { id: '100', mediaUrl: nativeUrl }; }, async confirmSchedule() { return { id: '100', mediaUrl: nativeUrl }; } };
  const schedule = opts => runClippersWeeklyScheduling({ workspaceRoot: f.root, window, now: prepNow, adapter, ...opts });
  assert.equal((await schedule({ apply: false })).ready, 1);
  assert.equal(calls, 0);
  await f.put(`${config}/approved-input.json`, { ...input, publish: true });
  assert.equal((await schedule({ apply: true })).scheduled, 1);
  assert.equal((await schedule({ apply: true })).scheduled, 0);
  assert.equal(calls, 1);
  const state = await f.get(`${reports}/state.json`);
  assert.deepEqual({ ...state, deliveries: [] }, initialState);
  assert.equal(state.deliveries[0].renderClass, REVIEWED_EDITORIAL);
  assert.equal((await readConfirmedReviewedEditorial(f.root, state.deliveries[0], { now: new Date(scheduledAt), historical: true })).receipt.outputSha256, receipt.outputSha256);
});

test('digest-resealed invalid inputs hold before ffmpeg', async t => {
  const changes = [
    f => { f.auth.engineSha256 = 'a'.repeat(64); },
    f => { f.auth.scheduledAt = '2026-11-19T22:24:00.000Z'; },
    f => { f.auth.expiresAt = '2026-11-19T23:00:00.000Z'; },
    f => { f.auth.windowEnd = '2026-11-24'; },
    f => { f.license.permissionExpiresAt = '2026-11-20T00:00:00.000Z'; },
    f => { f.rights.sourcePublishedAt = f.license.sourcePublishedAt = '2026-11-16T22:20:00.000Z'; },
    f => { f.rights.observedAt = f.license.observedAt = '2026-11-18T22:19:00.000Z'; },
    f => { f.auth.reviewedAt = '2026-11-19T22:25:00.000Z'; },
    f => { f.license.destination = DESTINATIONS[1]; },
    f => { f.rights.basis = f.license.basis = 'campaign'; f.rights.membership = f.license.membership = 'verified'; },
    f => { f.request.experiment = {}; },
    f => { f.auth.params.crop = { x: -2, y: 0, width: 200, height: 100 }; },
    f => { f.auth.subtitles = [{ startSeconds: 2, endSeconds: 7.5, text: 'Outside this cut.' }]; },
    f => { f.rights.sourceDatePrecision = f.license.sourceDatePrecision = 'date_only';
      f.rights.sourcePublishedDate = f.license.sourcePublishedDate = '2026-11-17'; },
  ];
  for (const change of changes) {
    const f = await inputs(t, { renderSource: false });
    change(f);
    await f.seal();
    await assert.rejects(f.render(), /editorial_(request_invalid|authorization_invalid|license_invalid|authorization_expired_or_slot_invalid)/);
  }
});

test('changed rights, slot, attribution or bytes hold before preparation, and owner UI history has a separate path', { skip: !available }, async t => {
  const f = await reviewed(t, { target: DESTINATIONS.find(d => d.network === 'facebook') });
  await f.put(f.packetPath, f.packet);
  await f.put(f.nativePath, f.native);
  const confirm = () => readReviewedEditorialPacket(f.root, f.id, { now: prepNow });
  assert.equal((await confirm()).asset.network, 'facebook');
  for (const [key, value] of [['scheduledAt', '2026-11-21T02:18:00.000Z'], ['quality', 'pending'],
    ['caption', 'Attribution omitted.'], ['reviewedAt', now.toISOString()], ['outputSha256', 'a'.repeat(64)],
    ['authorizationSha256', 'b'.repeat(64)]]) {
    await f.put(f.packetPath, { ...f.packet, [key]: value });
    assert.equal((await f.prepare()).prepared, 0);
  }
  await f.put(f.packetPath, f.packet);
  await f.put(`${config}/rights-evidence/${f.auth.licenseEvidenceSha256}.json`, { ...f.license, commercialPermission: 'withdrawn' });
  await assert.rejects(confirm(), /editorial_license_invalid/);
  await f.put(`${config}/rights-evidence/${f.auth.licenseEvidenceSha256}.json`, f.license);
  const clip = path.join(f.root, f.receipt.draftFile);
  await writeFile(clip, Buffer.alloc(f.bytes.length));
  await assert.rejects(confirm(), /editorial_media_bytes_changed/);
  await writeFile(clip, f.bytes);
  const external = { destination: f.target, metricoolId: '89', scheduledAt, caption: f.packet.caption,
    mediaUrl: nativeUrl, sha256: f.packet.outputSha256, sizeBytes: f.bytes.length };
  const afterSlot = new Date('2026-11-21T02:00:00.000Z');
  const adapter = { confirmSchedule: async () => ({ id: '89', mediaUrl: nativeUrl }) };
  const result = await reconcileExternalMetricoolSchedule({ workspaceRoot: f.root, assetId: f.id, external, now: afterSlot, adapter, fetcher: f.fetcher });
  assert.equal(result.providerWrites, 0);
  assert.equal(result.learnerStateChanged, false);
  const [observation] = await f.get(`${reports}/external-schedules.json`);
  assert.equal(observation.weeklySourceProof.sourceIdentity, 'youtube:aaaaaaaaaaa');
  await assert.rejects(readFile(path.join(f.root, reports, 'state.json')), { code: 'ENOENT' });
  await assert.rejects(readReviewedEditorialPacket(f.root, f.id, { now: afterSlot }), /expired_or_slot_invalid/);
});

test('explicit campaign restrictions are enforced across accounts while licensed reuse keeps per-account replay checks', () => {
  const proof = { sourceIdentity: 'youtube:aaaaaaaaaaa', sourceSha256: 'e'.repeat(64), startSeconds: 2, endSeconds: 8,
    reuseScope: 'licensed_crosspost' };
  const a = { ...DESTINATIONS[0], id: 'a', caption: 'first', scheduledAt, mediaSha256: 'a'.repeat(64), weeklySourceProof: proof };
  const b = { ...DESTINATIONS[1], id: 'b', caption: 'second', scheduledAt, mediaSha256: 'b'.repeat(64), weeklySourceProof: proof };
  assert.equal(weeklyDeliveryCollision(a, b), false);
  assert.equal(weeklyDeliveryCollision(a, { ...b, ...DESTINATIONS[0] }), true);
  assert.equal(weeklyDeliveryCollision(a, { ...b, weeklySourceProof: { ...proof, reuseScope: 'exact_destination_only' } }), true);
  assert.equal(weeklyDeliveryCollision(a, { ...b, weeklySourceProof: { ...proof, reuseScope: 'exact_destination_only', startSeconds: 8, endSeconds: 14 } }), false);
  const legacy = { ...b, weeklySourceProof: undefined, sourceUrl: 'https://youtu.be/aaaaaaaaaaa' };
  assert.equal(weeklyDeliveryCollision({ ...a, weeklySourceProof: { ...proof, reuseScope: 'exact_destination_only' } }, legacy), true);
});

test('signed crop, reserved header and cut-relative subtitle cues appear in the actual portrait output', { skip: !titleAvailable }, async t => {
  const f = await inputs(t, { solid: true });
  f.auth.params.crop = { x: 98, y: 0, width: 90, height: 160 };
  f.auth.params.caption_layout = 'header';
  f.auth.captionText = 'Reviewed title';
  f.auth.subtitles = [{ startSeconds: 1.5, endSeconds: 3.5, text: 'Audited subtitle text.' }];
  f.rights.sourceDatePrecision = f.license.sourceDatePrecision = 'date_only';
  f.rights.sourcePublishedDate = f.license.sourcePublishedDate = '2026-11-17';
  f.rights.sourcePublishedAt = f.license.sourcePublishedAt = '2026-11-17T00:00:00.000Z';
  await f.seal();
  const receipt = await f.render();
  assert.deepEqual(receipt.actualParams.crop, f.auth.params.crop);
  assert.equal(receipt.subtitlesSha256, digest(f.auth.subtitles));
  const output = path.join(f.root, receipt.draftFile);
  const brightness = async (second, y) => {
    const { stdout } = await exec('ffmpeg', ['-nostdin', '-loglevel', 'error', '-ss', String(second), '-i', output,
      '-frames:v', '1', '-vf', 'crop=940:200:70:' + y, '-pix_fmt', 'gray', '-f', 'rawvideo', '-'], { encoding: 'buffer' });
    return stdout.some(byte => byte > 120);
  };
  assert.equal(await brightness(0.5, 10), true);
  assert.equal(await brightness(0.5, 1474), false);
  assert.equal(await brightness(2.5, 1474), true);
  assert.equal(await brightness(4.5, 1474), false);
});

test('signed owned cards replace source pixels while retaining source audio and require explicit caption disclosure', { skip: !titleAvailable }, async t => {
  const f = await inputs(t, { solid: true });
  f.auth.params.crop = null;
  f.auth.visualPlan = { kind: 'owned_cards', cards: [
    { startSeconds: 0, endSeconds: 3, heading: 'The first idea', body: 'An original explanation written for this excerpt.' },
    { startSeconds: 3, endSeconds: 6.5, heading: 'The next idea', body: 'A distinct original note about the argument.' },
  ] };
  f.auth.subtitles = [{ startSeconds: 2, endSeconds: 3, text: 'Reviewed speech caption.' }];
  await f.seal();
  const receipt = await f.render();
  assert.equal(receipt.visualPlanSha256, digest(f.auth.visualPlan));
  const output = path.join(f.root, receipt.draftFile);
  const frame = async second => (await exec('ffmpeg', ['-nostdin', '-loglevel', 'error', '-ss', String(second),
    '-i', output, '-frames:v', '1', '-vf', 'scale=160:284', '-pix_fmt', 'rgb24', '-f', 'rawvideo', '-'],
  { encoding: 'buffer' })).stdout;
  assert.notEqual(sha(await frame(1)), sha(await frame(4)));
  assert.notEqual(sha(await frame(1)), sha(await frame(2.5)));
  assert.ok((await frame(1)).some(byte => byte > 120));
  const audio = await exec('ffmpeg', ['-nostdin', '-loglevel', 'error', '-i', output, '-map', '0:a:0',
    '-ac', '1', '-ar', '11025', '-f', 's16le', '-'], { encoding: 'buffer' });
  assert.ok(audio.stdout.length > 11025 * 2 * 6);
  assert.ok(audio.stdout.some(byte => byte > 120));
  const packet = { schemaVersion: 2, id: f.id, destination: f.target, renderClass: REVIEWED_EDITORIAL,
    authorizationSha256: f.request.authorizationSha256, renderRequestSha256: receipt.renderRequestSha256,
    renderReceiptSha256: receipt.receiptSha256, outputSha256: receipt.outputSha256, scheduledAt, sourceUrl: f.auth.sourceUrl,
    campaignId: 'cc-fixture', sourceId: 'original-id', creator: 'speaker', language: 'en', caption: requiredAttribution,
    thirdPartyCommercial: false, reviewedBy: 'fixture-reviewer', reviewedAt: prepNow.toISOString(), quality: 'passed',
    originalEdit: 'verified', disclosure: 'verified', publicUploadAuthorized: true, schedulerAssetAuthorized: true,
    authorizedSpendUsd: 0, providerIncrementalCostUsd: 0, mediaProvider: 'metricool' };
  const packetPath = `${config}/prepare-requests/${f.id}.json`;
  await f.put(packetPath, packet);
  await assert.rejects(readReviewedEditorialPacket(f.root, f.id, { now: prepNow }), /editorial_reviewed_output_required/);
  await f.put(packetPath, { ...packet, caption: 'Excerpt + editorial graphics. ' + requiredAttribution });
  assert.equal((await readReviewedEditorialPacket(f.root, f.id, { now: prepNow })).receipt.outputSha256, receipt.outputSha256);
});
