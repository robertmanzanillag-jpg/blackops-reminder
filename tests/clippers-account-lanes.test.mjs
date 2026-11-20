import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { LANES, routeCandidate, sourceSegment, mediaConflict, laneHook, laneCaption, laneSchedule, parseBestTimes, autoPublishAllowed, isWeekend } from '../shared/clippers-account-lanes.mjs';
import { computeGrowth, growthWeight } from '../script/clippers-streamer-cloud-learning.mjs';
import { runCloudPublisher, laneTarget, cloudPublishConfig } from '../script/clippers-streamer-cloud-worker.mjs';
import { peakStartFromEbur128, wordsFromWhisperJson, ffmpegRenderArgs } from '../script/clippers-streamer-cloud-render.mjs';
import { createPortfolioMetricool } from '../script/clippers-portfolio-metricool.mjs';
import { captionHasCredit, buildCreditCaption } from '../shared/clippers-streamer-policy.mjs';
import { STREAMER_STATE_NAMESPACE } from '../script/clippers-streamer-discovery.mjs';

const NOW = Date.parse('2026-11-19T14:00:00.000Z'); // Thursday 09:00 New York
const MEMES = '6431685:tiktok:streamersus', SPORT = '6431687:tiktok:streamersclipusa', MIAMI = '6591612:tiktok:news305miami';

test('routing: one lane per creator/content; Spanish only to Miami; other languages unrouted', () => {
  assert.equal(routeCandidate({ handle: 'kaicenat', title: 'LOL' }).lane, 'memes');
  assert.equal(routeCandidate({ handle: 'x' }, { creator: { creatorGroupId: 'ishowspeed' } }).lane, 'memes');
  assert.equal(routeCandidate({ handle: 'random', title: 'NBA 2K dunk contest', language: 'en' }).lane, 'sports');
  assert.equal(routeCandidate({ handle: 'westcol', language: 'es' }).lane, 'miami');
  assert.equal(routeCandidate({ handle: 'random', title: 'jajaja', language: 'es' }).lane, 'miami');
  assert.equal(routeCandidate({ handle: 'fanum' }).lane, 'nyc');
  assert.equal(routeCandidate({ handle: 'random', title: 'IRL in the Bronx', language: 'en' }).lane, 'nyc');
  assert.equal(routeCandidate({ handle: 'k4sen', language: 'ja' }).lane, null);
  assert.equal(routeCandidate({ handle: 'kaicenat' }, { streamOwner: 'sports' }).lane, 'sports', 'stream stays on its first account');
  for (const l of LANES) assert.equal(l.language, l.id === 'miami' ? 'es' : 'en');
});

test('media ledger: same VOD segment or file hash cannot go to a second account', () => {
  const seg = sourceSegment({ id: 'twitch-clip:a', vodId: '99', vodOffset: 1000 });
  const entries = [{ candidateId: 'twitch-clip:a', segment: seg, mediaSha256: 'f'.repeat(64), destinationKey: MEMES }];
  assert.equal(mediaConflict(entries, { segment: sourceSegment({ id: 'twitch-clip:b', vodId: '99', vodOffset: 1030 }), destinationKey: SPORT }).reason, 'cross_account_duplicate');
  assert.equal(mediaConflict(entries, { segment: sourceSegment({ id: 'twitch-clip:c', vodId: '99', vodOffset: 1300 }), destinationKey: SPORT }), null, 'other moment of the stream is a different segment');
  assert.equal(mediaConflict(entries, { segment: { key: 'x', start: 0 }, mediaSha256: 'f'.repeat(64), destinationKey: SPORT }).reason, 'cross_account_duplicate');
  assert.equal(mediaConflict(entries, { segment: seg, destinationKey: MEMES }).reason, 'already_posted');
});

test('hooks: 3-6 upper-case words; captions: curiosity + creator + credit + 3-5 hashtags, no disclaimers', () => {
  for (const title of ['Kai loses 50K in ten seconds on stream with chat going crazy', 'ok', 'Speed meets Ronaldo']) {
    const h = laneHook({ variant: 'title', title, name: 'Kai Cenat', language: 'en' });
    const n = h.split(' ').length;
    assert.ok(n >= 3 && n <= 6, h); assert.equal(h, h.toUpperCase());
  }
  assert.match(laneHook({ variant: 'teaser', name: 'Westcol', language: 'es' }), /NO SE LO ESPERABA/);
  const sourceUrl = 'https://clips.twitch.tv/abc';
  const c = laneCaption({ lane: 'memes', title: 'Kai screams at chat', name: 'Kai Cenat', handle: 'kaicenat', platform: 'twitch', sourceUrl });
  const tags = c.split('\n').at(-1).split(' ');
  assert.ok(tags.length >= 3 && tags.length <= 5 && tags.includes('#kaicenat'));
  assert.ok(c.includes('Kai Cenat') && captionHasCredit(c, 'kaicenat', sourceUrl));
  assert.doesNotMatch(c, /not a claim|disclaimer|no es una/i);
  assert.match(laneCaption({ lane: 'miami', title: 'Westcol grita', name: 'Westcol', handle: 'westcol', platform: 'twitch', sourceUrl }), /¿Qué acaba de pasar\?.*\n.*\n.*Fuente/);
});

test('schedule: 10/12/16/18/20 ET, weekends -30 %, 8/day once scaled, Metricool best time reorders', () => {
  assert.deepEqual(laneSchedule({ day: '2026-11-19' }).slots, ['10:00', '12:00', '16:00', '18:00', '20:00']);
  assert.equal(isWeekend('2026-11-21'), true);
  assert.equal(laneSchedule({ day: '2026-11-21' }).cap, 4);
  assert.equal(laneSchedule({ day: '2026-11-19', scaled: true }).cap, 8);
  assert.equal(laneSchedule({ day: '2026-11-22', scaled: true }).cap, 6);
  const best = parseBestTimes([{ dayOfWeek: 'Thursday', hour: 9, value: 5 }, { dayOfWeek: 'Thursday', hour: 11, value: 9 }, { dayOfWeek: 'Thursday', hour: 14, value: 8 },
    { dayOfWeek: 'Thursday', hour: 19, value: 7 }, { dayOfWeek: 'Thursday', hour: 21, value: 6 }, { dayOfWeek: 'Thursday', hour: 3, value: 99 }]);
  const s = laneSchedule({ day: '2026-11-19', bestTimes: best });
  assert.equal(s.source, 'metricool_best_time'); assert.deepEqual(s.slots, ['09:00', '11:00', '14:00', '19:00', '21:00']);
  assert.ok(!laneSchedule({ day: '2026-11-19', killedHours: [10] }).slots.includes('10:00'));
});

test('auto-publish only once the weekly median passes 1k', () => {
  assert.equal(autoPublishAllowed({ weeklyPosts: 30, weeklyMedian: 999 }), false);
  assert.equal(autoPublishAllowed({ weeklyPosts: 30, weeklyMedian: 1000 }), true);
  assert.equal(autoPublishAllowed({ weeklyPosts: 3, weeklyMedian: 5000 }), false);
});

test('growth loop: weekly stats, kill < 300 median after 6 posts, breakout > 10k -> 3 follow-ups, > 100k doubles the creator', () => {
  const posts = [];
  for (let i = 0; i < 6; i++) posts.push({ id: `p${i}`, destinationKey: MEMES, status: 'scheduled', creatorKey: 'twitch:bad', hookVariant: 'title', scheduledAt: new Date(NOW - (i + 2) * 86400_000).toISOString(), observation: { views: 100, ageHours: 30 } });
  posts.push({ id: 'big', destinationKey: MEMES, status: 'scheduled', creatorKey: 'twitch:kai', streamKey: 'twitch-vod:1', hookVariant: 'teaser', scheduledAt: new Date(NOW - 20 * 3600_000).toISOString() });
  const accountPosts = { [MEMES]: [{ id: '1', publishedAt: new Date(NOW - 20 * 3600_000).toISOString(), views: 150_000, actualAgeHours: 20 }, ...Array.from({ length: 6 }, (_, i) => ({ id: `x${i}`, publishedAt: new Date(NOW - (i + 2) * 86400_000).toISOString(), views: 100, actualAgeHours: 40 }))] };
  const g = computeGrowth({ posts, accountPosts, now: NOW });
  assert.equal(g.accounts[MEMES].weeklyPosts, 7); assert.equal(g.accounts[MEMES].weeklyMedian, 100); assert.equal(g.accounts[MEMES].autoPublish, false);
  assert.ok(g.kills.some(k => k.arm === 'creator' && k.value === 'twitch:bad'));
  assert.equal(g.breakouts[0].remaining, 3);
  assert.ok(g.doubled.some(d => d.creatorKey === 'twitch:kai'));
  assert.equal(growthWeight(g, { destinationKey: MEMES, creatorKey: 'twitch:bad' }, NOW).weight, 0);
  assert.equal(growthWeight(g, { destinationKey: MEMES, creatorKey: 'twitch:kai', streamKey: 'twitch-vod:1' }, NOW).weight, 5);
  const later = computeGrowth({ posts: [...posts, { id: 'f1', destinationKey: MEMES, status: 'scheduled', creatorKey: 'twitch:kai', streamKey: 'twitch-vod:1', attemptedAt: new Date(NOW + 60_000).toISOString(), scheduledAt: new Date(NOW + 3600_000).toISOString() }], accountPosts, previous: g, now: NOW + 120_000 });
  assert.equal(later.breakouts[0].remaining, 2);
});

test('render helpers: peak-first start from ebur128, word-by-word captions from whisper JSON', () => {
  const log = 't: 1.0 TARGET:-23 LUFS M: -30.0 S: -30\nt: 12.5 TARGET:-23 LUFS M: -8.0 S: -20\nt: 20 TARGET:-23 LUFS M: -25 S: -25';
  assert.equal(peakStartFromEbur128(log, { available: 60, targetSec: 28 }), 11.5);
  assert.equal(peakStartFromEbur128(log, { available: 20, targetSec: 28 }), 0);
  const words = wordsFromWhisperJson({ transcription: [{ text: ' no', offsets: { from: 500, to: 800 } }, { text: ' way!', offsets: { from: 800, to: 1200 } }] }, { duration: 28 });
  assert.deepEqual(words.map(w => w.text), ['NO', 'WAY!']);
  const args = ffmpegRenderArgs({ input: '/tmp/a/s.mp4', output: '/tmp/a/o.mp4', hookFile: '/tmp/a/h.txt', creditFile: '/tmp/a/c.txt', fontFile: '/tmp/a/f.ttf', duration: 28, start: 11.5, words: [{ ...words[0], file: '/tmp/a/w0.txt' }] });
  assert.deepEqual(args.slice(args.indexOf('-ss'), args.indexOf('-ss') + 2), ['-ss', '11.50']);
  assert.match(args[args.indexOf('-filter_complex') + 1], /w0\.txt.*enable='between\(t,0\.50,0\.80\)'/);
});

// ---------- Worker end-to-end (Metricool mocked; no network) ----------
function candidate(id, creatorKey, handle, extra = {}) {
  const sourceUrl = `https://clips.twitch.tv/${id}`;
  return { id: `twitch-clip:${id}`, platform: 'twitch', kind: 'clip', creatorKey, handle, title: `${handle} loses it on stream`, sourceUrl, durationSec: 50, views: 9000,
    publishedAt: new Date(NOW - 2 * 3600_000).toISOString(), observedAt: new Date(NOW).toISOString(), score: 4, clipPolicy: { status: 'allowed_unless_prohibited' },
    download: { mode: 'needs_local_download' }, approval: { status: 'approved', pendingActionId: `pa-${id}` },
    caption: buildCreditCaption({ handle, platform: 'twitch', sourceUrl, title: handle }), ...extra };
}
const checked = { status: 'allowed_unless_prohibited', source: 'channel_description_checked' };
function state(candidates, cloudPublish) {
  return { version: 1, updatedAt: null, lastRun: null, takedowns: [], signals: [], candidates, ...(cloudPublish ? { cloudPublish } : {}),
    creators: { 'twitch:1': { key: 'twitch:1', handle: 'kaicenat', displayName: 'Kai Cenat', creatorGroupId: 'kai-cenat', policy: checked },
      'twitch:2': { key: 'twitch:2', handle: 'westcol', displayName: 'Westcol', creatorGroupId: 'westcol', policy: checked },
      'twitch:3': { key: 'twitch:3', handle: 'k4sen', displayName: 'k4sen', creatorGroupId: 'k4sen', policy: checked } } };
}
function memoryStore(s) {
  const ns = STREAMER_STATE_NAMESPACE('o'), data = new Map([[ns, JSON.stringify(s)]]);
  return { get state() { return JSON.parse(data.get(ns)); }, async read(k) { return data.get(k) ?? null; }, async transact(k, fn) { const v = await fn(data.get(k) ?? null); data.set(k, v); return v; } };
}
function fakeMetricool({ cross = async () => {} } = {}) {
  const calls = { schedule: [], cross: [], analytics: 0, best: 0 };
  return { calls,
    async preflight() {}, async crossAccountPreflight(d, item) { calls.cross.push(item); return cross(d, item); },
    async schedule(d, item) { calls.schedule.push({ d, item }); return { id: `mc-${item.id}`, mediaUrl: 'https://static.metricool.com/x.mp4' }; },
    async confirmSchedule() { return null; }, async publication() { return null; }, async metrics() { return null; },
    async accountAnalytics() { calls.analytics++; return { posts: [] }; }, async bestTimes() { calls.best++; return []; } };
}
const stager = () => ({ async upload(f, name) { return { id: 1, url: `https://github.com/o/r/releases/download/t/${name}` }; }, async remove() { return true; }, async sweep() { return 0; } });
let sha = 0;
const media = () => ({ download: async () => ({ file: '/tmp/x/s.mp4', cut: { start: 0, duration: 50 } }),
  render: async input => ({ file: '/tmp/x/r.mp4', sha256: String(++sha).padStart(64, '0'), durationSec: input.duration, cutStart: 5, captions: 'whisper_not_configured', input }),
  makeDir: async () => mkdtemp(path.join(tmpdir(), 'lanes-')) });
const ENV = { CLIPPERS_STREAMER_CLOUD_PUBLISH_ENABLED: 'true', METRICOOL_USER_TOKEN: 'metricool-token-123', METRICOOL_USER_ID: '12345' };
const approvals = { async statuses(o, ids) { return new Map(ids.map(i => [i, 'approved'])); }, async markExecuted() {} };

test('worker: each clip goes to exactly one account, as a Metricool draft, in its language, peak-first, 15-35 s', async () => {
  assert.equal(cloudPublishConfig(ENV).clipSeconds, 28);
  const store = memoryStore(state([candidate('a', 'twitch:1', 'kaicenat', { vodId: '9', vodOffset: 100 }), candidate('b', 'twitch:2', 'westcol', { language: 'es' }), candidate('c', 'twitch:3', 'k4sen', { language: 'ja' })]));
  const mc = fakeMetricool(), m = media();
  const { report } = await runCloudPublisher({ env: ENV, now: NOW, owner: 'o', store, approvals, metricool: mc, stager: stager(), fetch: async () => ({ status: 206 }), ...m });
  const byDest = mc.calls.schedule.map(c => `${c.d.brandId}:${c.d.network}:${c.d.account}`);
  assert.deepEqual(byDest.sort(), [MEMES, MIAMI].sort(), 'one destination per clip, no fan-out');
  const kai = mc.calls.schedule.find(c => c.item.candidateId === 'twitch-clip:a').item;
  assert.equal(kai.draft, true, 'below 1k weekly median -> draft for owner approval');
  assert.equal(kai.allowDuetStitch, true); assert.equal(kai.language, 'en'); assert.match(kai.caption, /#kaicenat/);
  assert.equal(mc.calls.schedule.find(c => c.item.candidateId === 'twitch-clip:b').item.language, 'es');
  assert.equal(mc.calls.cross.length, 2, 'cross-account Metricool check before each write');
  assert.ok(report.heldReasons.includes('lane_unrouted:language_not_served:ja'));
  assert.equal(mc.calls.analytics, 4, 'growth loop read every allowlisted account (read-only)');
  assert.equal(store.state.cloudPublish.mediaLedger.length, 2);
  assert.equal(store.state.cloudPublish.mediaLedger.find(e => e.candidateId === 'twitch-clip:a').segment.start, 105);
});

test('worker: a second clip of the same VOD moment is refused for every other account; auto-publish once median >= 1k', async () => {
  const growth = { evaluatedAt: new Date(NOW).toISOString(), accounts: { [MEMES]: { weeklyPosts: 20, weeklyMedian: 1500, scaled: true, autoPublish: true } }, kills: [], breakouts: [], doubled: [], decisions: [] };
  const ledger = { version: 1, clips: {}, posts: [], learning: null, lastRun: null, growth,
    mediaLedger: [{ candidateId: 'twitch-clip:old', streamKey: 'twitch-vod:9', segment: { key: 'twitch-vod:9', start: 110 }, mediaSha256: null, destinationKey: SPORT, lane: 'sports' }] };
  const s = state([candidate('d', 'twitch:1', 'kaicenat', { vodId: '9', vodOffset: 100 }), candidate('e', 'twitch:1', 'kaicenat', { vodId: '7', vodOffset: 0 })], ledger);
  assert.equal(laneTarget({ state: s, ledger, candidate: s.candidates[0], config: cloudPublishConfig(ENV), now: NOW }).reason, 'already_posted', 'stream owned by SPORT: stays there, same moment refused');
  const mc = fakeMetricool();
  await runCloudPublisher({ env: ENV, now: NOW, owner: 'o', store: memoryStore(s), approvals, metricool: mc, stager: stager(), fetch: async () => ({ status: 206 }), ...media() });
  assert.equal(mc.calls.schedule.length, 1);
  const item = mc.calls.schedule[0].item;
  assert.equal(item.destinationKey, MEMES); assert.equal(item.draft, false, 'weekly median >= 1k -> auto-publish'); assert.equal(item.dailyLimit, 8);
});

test('worker: Metricool cross-account duplicate holds the write (nothing scheduled)', async () => {
  const mc = fakeMetricool({ cross: async () => { throw new Error('cross_account_duplicate'); } });
  const { report } = await runCloudPublisher({ env: ENV, now: NOW, owner: 'o', store: memoryStore(state([candidate('f', 'twitch:1', 'kaicenat')])), approvals, metricool: mc, stager: stager(), fetch: async () => ({ status: 206 }), ...media() });
  assert.equal(mc.calls.schedule.length, 0);
  assert.ok(report.heldReasons.some(r => r.includes('cross_account_duplicate')));
});

test('growth-only run updates the ledger without rendering or writing', async () => {
  const mc = fakeMetricool(), m = media();
  const store = memoryStore(state([candidate('g', 'twitch:1', 'kaicenat')]));
  const { report } = await runCloudPublisher({ env: { ...ENV, CLIPPERS_STREAMER_CLOUD_PUBLISH_ENABLED: 'false' }, now: NOW, owner: 'o', store, approvals, metricool: mc, stager: null, fetch: async () => ({ status: 206 }), ...m, growthOnly: true });
  assert.equal(report.status, 'growth_updated'); assert.equal(mc.calls.schedule.length, 0);
  assert.ok(store.state.cloudPublish.growth.evaluatedAt);
});

test('Metricool adapter: draft payload (no auto-publish) with duet/stitch on; best time is a read-only MCP tool', async () => {
  const sent = [];
  const res = (body, type = 'application/json') => ({ ok: true, status: 200, headers: { get: () => type }, json: async () => body, text: async () => JSON.stringify(body) });
  const fetcher = async (url, init = {}) => {
    const u = new URL(url);
    if (u.pathname === '/api/admin/simpleProfiles') return res([{ blogId: 6431685, tiktokUsername: 'streamersus', isShared: false, ownerUserId: '12345', canPublish: true }]);
    if (u.pathname.startsWith('/api/v2/scheduler/posts')) return res([]);
    const body = JSON.parse(init.body); sent.push(body.params);
    return res({ jsonrpc: '2.0', id: body.id, result: { content: [{ type: 'text', text: '[]' }] } });
  };
  const mc = createPortfolioMetricool({ token: 'metricool-token-123', userId: '12345', fetcher });
  const dest = { brandId: 6431685, network: 'tiktok', account: 'streamersus' };
  await mc.schedule(dest, { id: 'stc-1', scheduledAt: '2026-11-20T15:00:00.000Z', caption: 'x', mediaUrl: 'https://e.com/a.mp4', draft: true, allowDuetStitch: true });
  const info = JSON.parse(sent[0].arguments.info);
  assert.equal(sent[0].name, 'createScheduledPost'); assert.equal(info.draft, true); assert.equal(info.autoPublish, false);
  assert.equal(info.tiktokData.disableDuet, false); assert.equal(info.tiktokData.disableStitch, false);
  await mc.bestTimes(dest, new Date(NOW));
  assert.equal(sent[1].name, 'getBestTimeToPostByNetwork');
  await assert.doesNotReject(mc.crossAccountPreflight(dest, { scheduledAt: '2026-11-20T15:00:00.000Z', caption: 'unique', mediaUrl: 'https://e.com/b.mp4' }));
});
