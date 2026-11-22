import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, writeFile, readFile, rm, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { APPROVED_DERIVATIVE_INSTRUMENTAL as TRACK, DERIVATIVE_AUDIO_PIPELINE as PIPELINE, validateDerivativeAudioReplacement, loadApprovedDerivativeInstrumental, verifyDerivativeAudioReplacement } from '../shared/clippers-derivative-audio.mjs';
const sha = value => createHash('sha256').update(value).digest('hex');
const NOW = Date.parse('2026-11-22T12:00:00Z');
const fakeFinal = Buffer.alloc(1536, 0x42), pcm = Buffer.alloc(320, 0x13);
function fixture() {
  const context = { finalSha256: sha(fakeFinal), caption: `Editorial example. Music: ${TRACK.requiredAttribution}`, durationSeconds: 20, maker: 'fixture-maker', checker: 'fixture-independent-checker', now: NOW };
  context.captionSha256 = sha(context.caption);
  const profile = { schemaVersion: 1, kind: 'licensed_instrumental_replacement', track: { ...TRACK },
    pipeline: { id: PIPELINE, musicStartSeconds: 28, durationSeconds: 20, codec: 'aac', bitRate: 160000, sampleRate: 48000, channels: 2, pcmCodec: 'pcm_f32le', pcmFormat: 'f32le' },
    report: { maker: context.maker, checker: context.checker, checkedAt: '2026-11-22T11:12:35Z', reportReference: 'fixture-only:independent-audio', reportSha256: 'a'.repeat(64), finalSha256: context.finalSha256, captionSha256: context.captionSha256, licensedMusicSha256: TRACK.sha256, decodedAudioPcmSha256: sha(pcm), expectedIndependentMusicPcmSha256: sha(pcm), originalMixedAudioIncluded: false, fullAudioDecoded: true, audioAuditioned: false } };
  return { context, profile };
}
test('licensed audio profile binds exact official track, license, attribution, final and independent full-PCM evidence', () => {
  const { profile, context } = fixture(); assert.equal(validateDerivativeAudioReplacement(profile, context), profile);
  for (const mutate of [p => p.track.sha256 = 'b'.repeat(64), p => p.track.sourceUrl = 'https://evil.example/music.mp3', p => p.track.primaryTrackLicensePage = p.track.sourceUrl, p => p.track.licenseUrl = 'https://example.com/license', p => p.track.requiredAttribution = 'free music', p => p.pipeline.codec = 'copy', p => p.pipeline.musicStartSeconds = -1, p => p.pipeline.durationSeconds++, p => p.report.finalSha256 = 'b'.repeat(64), p => p.report.captionSha256 = 'b'.repeat(64), p => p.report.licensedMusicSha256 = 'b'.repeat(64), p => p.report.expectedIndependentMusicPcmSha256 = 'b'.repeat(64), p => p.report.originalMixedAudioIncluded = true, p => p.report.fullAudioDecoded = false, p => p.report.checker = p.report.maker]) {
    const changed = structuredClone(profile); mutate(changed); assert.throws(() => validateDerivativeAudioReplacement(changed, context));
  }
  assert.throws(() => validateDerivativeAudioReplacement(profile, { ...context, caption: 'credit omitted', captionSha256: sha('credit omitted') }));
  assert.throws(() => validateDerivativeAudioReplacement(profile, { ...context, checker: context.maker }));
  const inherited = structuredClone(profile); inherited.pipeline = Object.create(inherited.pipeline); assert.throws(() => validateDerivativeAudioReplacement(inherited, context));
  const missing = structuredClone(profile); delete missing.pipeline.channels; assert.throws(() => validateDerivativeAudioReplacement(missing, context));
});
test('official music loader requests exactly the reviewed public URL, rejects redirects and bounds bytes/hash without other network access', async () => {
  const calls = [];
  await assert.rejects(loadApprovedDerivativeInstrumental({ fetch: async (url, options) => { calls.push({ url, options }); return new Response(null, { status: 302, headers: { location: 'https://evil.example/track' } }); } }), /unavailable/);
  assert.equal(calls.length, 1); assert.equal(calls[0].url, TRACK.sourceUrl); assert.equal(calls[0].options.redirect, 'error');
  await assert.rejects(loadApprovedDerivativeInstrumental({ fetch: async () => new Response(Buffer.alloc(1024), { headers: { 'content-type': 'audio/mpeg' } }) }), /hash_mismatch/);
  await assert.rejects(loadApprovedDerivativeInstrumental({ fetch: async () => new Response(Buffer.alloc(TRACK.byteLength + 1)) }), /size_mismatch/);
  await assert.rejects(loadApprovedDerivativeInstrumental({ fetch: async () => new Response(null, { headers: { 'content-length': '999999999', 'content-type': 'audio/mpeg' } }) }), /unavailable/);
});
test('actual verifier refuses a changed final before opening any codec process', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'derivative-audio-negative-'));
  try {
    const file = path.join(directory, 'changed.mp4'); await writeFile(file, Buffer.alloc(1536));
    const { profile, context } = fixture(); let calls = 0;
    await assert.rejects(verifyDerivativeAudioReplacement({ file, licensedTrackFile: '/not-used', profile, ...context }, { runner: async () => { calls++; throw Error('must_not_run'); } }), /file_changed/);
    assert.equal(calls, 0);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
// Local operational artifacts remain outside the repo. CI can exercise structural/negative cases without them.
const evidenceRoot = '/Users/robertmanzanilla/.codex/visualizations/2026/11/17/01a1ebbb-0f63-71e1-80fd-30b92e40d8b7/office-verification';
const bundlePath = path.join(evidenceRoot, 'nov22-authorized-supply/lacy-campaign-production/lacy-five-final-review-bundle.json');
let actualBundle, actualApproved;
try { actualBundle = JSON.parse(await readFile(bundlePath, 'utf8')); actualApproved = JSON.parse(await readFile(path.join(evidenceRoot, 'nov22-media-batch-checker/lacy-five-final-approved.json'), 'utf8')); } catch {}
test('real five Lacy finals exactly reproduce approved full PCM from the official licensed instrumental, with negative PCM/track tests', { skip: !actualBundle && 'local independently reviewed media not present' }, async () => {
  const reportBytes = await readFile(path.join(evidenceRoot, 'nov22-media-batch-checker/lacy-five-final-approved.json'));
  const byId = new Map(actualApproved.approvedItems.map(item => [item.id, item]));
  for (const item of actualBundle.items) {
    const approved = byId.get(item.id); assert.ok(approved);
    const context = { finalSha256: item.mediaSha256, caption: item.caption, captionSha256: approved.captionSha256, durationSeconds: item.durationSeconds, maker: 'authorized_supply_nov22', checker: actualApproved.reviewer, now: NOW };
    const { profile } = fixture(); profile.pipeline.musicStartSeconds = item.sourcePlan.musicStart; profile.pipeline.durationSeconds = item.durationSeconds;
    profile.report = { maker: context.maker, checker: context.checker, checkedAt: actualApproved.checkedAt, reportReference: 'private-reviewed:lacy-five-final-approved', reportSha256: sha(reportBytes), finalSha256: context.finalSha256, captionSha256: context.captionSha256, licensedMusicSha256: approved.licensedMusicSha256, decodedAudioPcmSha256: approved.decodedAudioPcmSha256, expectedIndependentMusicPcmSha256: approved.expectedIndependentMusicPcmSha256, originalMixedAudioIncluded: false, fullAudioDecoded: true, audioAuditioned: false };
    const inputs = { ...context, profile, file: item.mediaFile, licensedTrackFile: item.musicEvidence.file };
    const result = await verifyDerivativeAudioReplacement(inputs, { ffmpeg: '/opt/homebrew/bin/ffmpeg', ffprobe: '/opt/homebrew/bin/ffprobe' });
    assert.equal(result.decodedAudioPcmSha256, approved.decodedAudioPcmSha256); assert.equal(result.audioAuditioned, false); assert.equal(result.originalMixedAudioIncluded, false);
    if (item === actualBundle.items[0]) {
      const bad = structuredClone(profile); bad.report.decodedAudioPcmSha256 = bad.report.expectedIndependentMusicPcmSha256 = 'f'.repeat(64);
      await assert.rejects(verifyDerivativeAudioReplacement({ ...inputs, profile: bad }, { ffmpeg: '/opt/homebrew/bin/ffmpeg', ffprobe: '/opt/homebrew/bin/ffprobe' }), /pcm_mismatch/);
      const directory = await mkdtemp(path.join(tmpdir(), 'wrong-licensed-track-'));
      try { const wrong = path.join(directory, 'wrong.mp3'); await writeFile(wrong, Buffer.alloc(5005207)); await assert.rejects(verifyDerivativeAudioReplacement({ ...inputs, licensedTrackFile: wrong }), /file_changed/); } finally { await rm(directory, { recursive: true, force: true }); }
      const music = await readFile(item.musicEvidence.file); let request;
      const loaded = await loadApprovedDerivativeInstrumental({ fetch: async (url, options) => { request = { url, options }; return new Response(music, { headers: { 'content-type': 'audio/mpeg', 'content-length': String(music.length) } }); } });
      try { assert.equal(request.url, TRACK.sourceUrl); assert.equal(sha(await readFile(loaded.file)), TRACK.sha256); } finally { await loaded.cleanup(); }
      await assert.rejects(access(loaded.file));
    }
  }
});
