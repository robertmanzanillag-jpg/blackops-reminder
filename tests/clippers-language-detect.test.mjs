// Unknown clip language: Twitch broadcaster_language prior, then whisper.cpp language detection on the cut.
// Fixture whisper output only (no binary), Metricool mocked (no writes), no network.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { resolveCandidateLanguage, LANGUAGE_DETECT_MIN_CONFIDENCE } from '../shared/clippers-account-lanes.mjs';
import { parseWhisperLanguage, whisperDetectArgs, detectSpeechLanguage } from '../script/clippers-streamer-cloud-render.mjs';
import { runCloudPublisher, cloudPublishConfig, broadcasterLanguage } from '../script/clippers-streamer-cloud-worker.mjs';
import { buildCreditCaption } from '../shared/clippers-streamer-policy.mjs';
import { STREAMER_STATE_NAMESPACE } from '../script/clippers-streamer-discovery.mjs';

const NOW = Date.parse('2026-11-19T14:00:00.000Z');
const MEMES = '6431685:tiktok:streamersus', MIAMI = '6591612:tiktok:news305miami';
// whisper.cpp v1.8.7 stderr with -l auto -dl (fixture).
const WHISPER_ES = 'whisper_init_from_file_with_params_no_state: loading model from \'ggml-base.bin\'\nwhisper_full_with_state: auto-detected language: es (p = 0.873412)\n';
const WHISPER_LOW = 'whisper_full_with_state: auto-detected language: pt (p = 0.412000)\n';
const WHISPER_JA = 'whisper_full_with_state: auto-detected language: ja (p = 0.950000)\n';

test('whisper fixture output parses to language + confidence; detect args use -l auto -dl without -np', () => {
  assert.deepEqual(parseWhisperLanguage(WHISPER_ES), { language: 'es', confidence: 0.873412 });
  assert.equal(parseWhisperLanguage('no language line'), null);
  const args = whisperDetectArgs({ model: '/m/ggml-base.bin', wav: '/w/lang.wav', threads: 99 });
  assert.deepEqual(args.slice(4, 7), ['-l', 'auto', '-dl']);
  assert.equal(args.includes('-np'), false, '-np disables the log line that carries the detected language');
  assert.equal(args[args.indexOf('-t') + 1], '16');
});

test('detectSpeechLanguage: fixture runner, not configured, failure never throws', async () => {
  const calls = [];
  const runner = async (bin, args) => { calls.push(bin); return bin === 'whisper-cli' ? { stdout: '', stderr: WHISPER_ES } : { stdout: '', stderr: '' }; };
  const env = { CLIPPERS_WHISPER_BIN: 'whisper-cli', CLIPPERS_WHISPER_MODEL: 'ggml-base.bin' };
  assert.deepEqual(await detectSpeechLanguage({ sourceFile: '/s.mp4', workDir: '/w', env, runner }), { status: 'detected', language: 'es', confidence: 0.873412 });
  assert.deepEqual(calls, ['ffmpeg', 'whisper-cli'], 'only the cut audio is extracted, then one whisper run');
  assert.equal((await detectSpeechLanguage({ sourceFile: '/s.mp4', workDir: '/w', env: {}, runner })).status, 'whisper_not_configured');
  const bad = await detectSpeechLanguage({ sourceFile: '/s.mp4', workDir: '/w', env, runner: async () => { throw new Error('WHISPER_CLI_FAILED'); } });
  assert.equal(bad.status, 'detection_failed'); assert.equal(bad.error, 'WHISPER_CLI_FAILED');
});

test('resolveCandidateLanguage: broadcaster prior first, whisper threshold, otherwise held', () => {
  assert.equal(LANGUAGE_DETECT_MIN_CONFIDENCE, 0.6);
  assert.deepEqual(resolveCandidateLanguage({ broadcasterLanguage: 'es-419' }), { language: 'es', source: 'broadcaster_language', confidence: null });
  assert.equal(resolveCandidateLanguage({ broadcasterLanguage: 'other' }).reason, 'language_unknown');
  assert.deepEqual(resolveCandidateLanguage({ detection: { status: 'detected', language: 'en', confidence: 0.91 } }), { language: 'en', source: 'whisper', confidence: 0.91 });
  assert.equal(resolveCandidateLanguage({ detection: { status: 'detected', language: 'pt', confidence: 0.41 } }).reason, 'language_low_confidence');
  assert.equal(resolveCandidateLanguage({ detection: { status: 'detected', language: 'es', confidence: 0.7 }, minConfidence: 0.8 }).reason, 'language_low_confidence');
  assert.equal(resolveCandidateLanguage({ detection: { status: 'whisper_not_configured' } }).reason, 'language_detect_whisper_not_configured');
  assert.equal(cloudPublishConfig({}).languageMinConfidence, 0.6);
  assert.equal(cloudPublishConfig({ CLIPPERS_STREAMER_LANGUAGE_MIN_CONFIDENCE: '0.1' }).languageMinConfidence, 0.5, 'never below 0.5');
});

// ---------- Worker end-to-end ----------
function candidate(id, creatorKey, handle, extra = {}) {
  const sourceUrl = `https://clips.twitch.tv/${id}`;
  return { id: `twitch-clip:${id}`, platform: 'twitch', kind: 'clip', creatorKey, handle, title: `${handle} loses it on stream`, sourceUrl, durationSec: 50, views: 9000,
    publishedAt: new Date(NOW - 2 * 3600_000).toISOString(), observedAt: new Date(NOW).toISOString(), score: 4, clipPolicy: { status: 'allowed_unless_prohibited' },
    download: { mode: 'needs_local_download' }, approval: { status: 'approved', pendingActionId: `pa-${id}` },
    caption: buildCreditCaption({ handle, platform: 'twitch', sourceUrl, title: handle }), language: null, ...extra };
}
const checked = { status: 'allowed_unless_prohibited', source: 'channel_description_checked' };
const state = candidates => ({ version: 1, updatedAt: null, lastRun: null, takedowns: [], signals: [], candidates,
  creators: { 'twitch:1': { key: 'twitch:1', handle: 'kaicenat', displayName: 'Kai Cenat', creatorGroupId: 'kai-cenat', policy: checked },
    'twitch:2': { key: 'twitch:2', handle: 'westcol', displayName: 'Westcol', creatorGroupId: 'westcol', policy: checked },
    'twitch:3': { key: 'twitch:3', handle: 'k4sen', displayName: 'k4sen', creatorGroupId: 'k4sen', policy: checked } } });
function memoryStore(s) {
  const ns = STREAMER_STATE_NAMESPACE('o'), data = new Map([[ns, JSON.stringify(s)]]);
  return { get state() { return JSON.parse(data.get(ns)); }, async read(k) { return data.get(k) ?? null; }, async transact(k, fn) { const v = await fn(data.get(k) ?? null); data.set(k, v); return v; } };
}
function fakeMetricool() {
  const calls = { schedule: [] };
  return { calls, async preflight() {}, async crossAccountPreflight() {},
    async schedule(d, item) { calls.schedule.push({ d, item }); return { id: `mc-${item.id}`, mediaUrl: 'https://static.metricool.com/x.mp4' }; },
    async confirmSchedule() { return null; }, async publication() { return null; }, async metrics() { return null; },
    async accountAnalytics() { return { posts: [] }; }, async bestTimes() { return []; } };
}
const stager = () => ({ async upload(f, name) { return { id: 1, url: `https://github.com/o/r/releases/download/t/${name}` }; }, async remove() { return true; }, async sweep() { return 0; } });
let n = 0;
function media(detections) {
  const calls = { download: [], detect: [], render: [] };
  return { calls,
    download: async ({ candidate: c }) => { calls.download.push(c.id); return { file: '/tmp/x/s.mp4', cut: { start: 0, duration: 50 } }; },
    detectLanguage: async ({ sourceFile }) => { const id = calls.download.at(-1); calls.detect.push(id); return detections[id] ?? { status: 'whisper_not_configured' }; },
    render: async input => { calls.render.push(input.language); return { file: '/tmp/x/r.mp4', sha256: String(++n).padStart(64, '0'), durationSec: input.duration, cutStart: 0, captions: 'word_by_word', captionLanguage: input.language }; },
    makeDir: async () => mkdtemp(path.join(tmpdir(), 'lang-')) };
}
const ENV = { CLIPPERS_LANES_AUTOPUBLISH_OVERRIDE: '', CLIPPERS_STREAMER_CLOUD_PUBLISH_ENABLED: 'true', METRICOOL_USER_TOKEN: 'metricool-token-123', METRICOOL_USER_ID: '12345' };
const approvals = { async statuses(o, ids) { return new Map(ids.map(i => [i, 'approved'])); }, async markExecuted() {} };
const asJson = (body, status = 200) => ({ ok: status < 400, status, async json() { return body; }, async text() { return JSON.stringify(body); } });

test('worker: unknown language -> whisper on the cut routes es to Miami, en to memes; low confidence / unserved stay held with evidence', async () => {
  const det = (language, confidence) => ({ status: 'detected', language, confidence });
  const store = memoryStore(state([candidate('a', 'twitch:2', 'westcol'), candidate('b', 'twitch:1', 'kaicenat'), candidate('c', 'twitch:3', 'k4sen')]));
  const m = media({ 'twitch-clip:a': det('es', 0.87), 'twitch-clip:b': det('en', 0.95), 'twitch-clip:c': det('pt', 0.41), 'twitch-clip:d': det('ja', 0.95) });
  const mc = fakeMetricool();
  const { report } = await runCloudPublisher({ env: ENV, now: NOW, owner: 'o', store, approvals, metricool: mc, stager: stager(), fetch: async () => ({ status: 206 }), ...m });
  const dests = Object.fromEntries(mc.calls.schedule.map(c => [c.item.candidateId, c.item.destinationKey]));
  assert.equal(dests['twitch-clip:a'], MIAMI); assert.equal(dests['twitch-clip:b'], MEMES);
  assert.equal(mc.calls.schedule.length, 2);
  assert.equal(m.calls.download.filter(id => id === 'twitch-clip:a').length, 1, 'the detection download is reused for the render');
  assert.deepEqual(m.calls.render.sort(), ['en', 'es'], 'captions transcribed in the detected language');
  const clips = store.state.cloudPublish.clips;
  assert.deepEqual({ ...clips['twitch-clip:a'].languageEvidence }, { source: 'whisper', status: 'detected', detected: 'es', confidence: 0.87, error: null, threshold: 0.6, language: 'es' });
  assert.equal(clips['twitch-clip:c'].status, 'held_language'); assert.equal(clips['twitch-clip:c'].reason, 'language_low_confidence');
  assert.equal(clips['twitch-clip:c'].languageEvidence.confidence, 0.41);
  assert.ok(report.heldReasons.includes('lane_unrouted:language_low_confidence'));
  // Confident but not served (ja): never routed, evidence kept.
  const store2 = memoryStore(state([candidate('d', 'twitch:3', 'k4sen')]));
  const mc2 = fakeMetricool();
  const r2 = await runCloudPublisher({ env: ENV, now: NOW, owner: 'o', store: store2, approvals, metricool: mc2, stager: stager(), fetch: async () => ({ status: 206 }), ...m });
  assert.equal(mc2.calls.schedule.length, 0);
  assert.ok(r2.report.heldReasons.includes('lane_unrouted:language_not_served:ja'));
  assert.equal(store2.state.cloudPublish.clips['twitch-clip:d'].languageEvidence.detected, 'ja');
});

test('worker: Twitch broadcaster_language prior routes without downloading for detection; whisper off keeps it held', async () => {
  const fetchImpl = async url => {
    const u = String(url);
    if (u.startsWith('https://id.twitch.tv/')) return asJson({ access_token: 'tok' });
    if (u.includes('/helix/channels')) return asJson({ data: [{ broadcaster_id: '2', broadcaster_language: 'es' }] });
    if (u.includes('/helix/users')) return asJson({ data: [{ id: '2', description: '' }] });
    return { status: 206, ok: true };
  };
  const env = { ...ENV, TWITCH_CLIENT_ID: 'cid-real', TWITCH_CLIENT_SECRET: 'secret-real' };
  assert.equal(await broadcasterLanguage({ candidate: { creatorKey: 'twitch:2' }, env, fetch: fetchImpl }), 'es');
  assert.equal(await broadcasterLanguage({ candidate: { creatorKey: 'youtube:2' }, env, fetch: fetchImpl }), null);
  const store = memoryStore(state([candidate('p', 'twitch:2', 'westcol')]));
  const m = media({}), mc = fakeMetricool();
  await runCloudPublisher({ env, now: NOW, owner: 'o', store, approvals, metricool: mc, stager: stager(), fetch: fetchImpl, ...m });
  assert.equal(m.calls.detect.length, 0, 'prior known: no whisper detection');
  assert.equal(mc.calls.schedule[0].item.destinationKey, MIAMI);
  assert.equal(store.state.cloudPublish.clips['twitch-clip:p'].languageEvidence.source, 'broadcaster_language');

  const store2 = memoryStore(state([candidate('q', 'twitch:1', 'kaicenat')]));
  const mc2 = fakeMetricool();
  const { report } = await runCloudPublisher({ env: ENV, now: NOW, owner: 'o', store: store2, approvals, metricool: mc2, stager: stager(), fetch: async () => ({ status: 206 }), ...media({}) });
  assert.equal(mc2.calls.schedule.length, 0);
  assert.equal(store2.state.cloudPublish.clips['twitch-clip:q'].status, 'held_language');
  assert.ok(report.heldReasons.includes('lane_unrouted:language_detect_whisper_not_configured'));
});
