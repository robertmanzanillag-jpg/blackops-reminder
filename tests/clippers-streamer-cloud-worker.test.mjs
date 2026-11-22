import { fixtureGrants } from './helpers/clippers-source-authorization-fixture.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { copyFile, mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { buildCreditCaption, captionHasCredit, parseTakedown } from '../shared/clippers-streamer-policy.mjs';
import { STREAMER_STATE_NAMESPACE } from '../script/clippers-streamer-discovery.mjs';
import { DESTINATIONS, destinationKey, findDestination, exactPost, canonicalDestinationKey, canonicalAccount, valueForDestination, createPortfolioMetricool } from '../script/clippers-portfolio-metricool.mjs';
import { stagedAssetRemovable, parseSlots, cloudPublishConfig, wallClockToIso, nextSlot, publishGate, runCloudPublisher as runCloudPublisherImpl, clipCaption, postItem, createGithubReleaseStager, liveDescriptionCheck } from '../script/clippers-streamer-cloud-worker.mjs';
import { selectCutWindow, wrapLines, ffmpegRenderArgs, ytDlpDownloadArgs, ytDlpInfoArgs, validateRenderProbe, childEnv, renderVerticalClip, makeWorkDir, hookText, creditText, BUNDLED_FONT } from '../script/clippers-streamer-cloud-render.mjs';
import { computeLearning, chooseHookVariant, creatorBoostFor } from '../script/clippers-streamer-cloud-learning.mjs';

const runCloudPublisher = args => runCloudPublisherImpl({ ...args, clock: args.clock ?? (() => args.now ?? Date.now()) });
const NOW = Date.parse('2026-11-19T14:00:00.000Z'); // 09:00 New York (EST)
// Legacy fan-out mode (lanes off); the account-lane mode is covered by tests/clippers-account-lanes.test.mjs.
const ON = { CLIPPERS_STREAMER_CLOUD_PUBLISH_ENABLED: 'true', CLIPPERS_STREAMER_LANES_ENABLED: 'false', METRICOOL_USER_TOKEN: 'metricool-token-123', METRICOOL_USER_ID: '12345' };

function candidate(id, creatorKey, handle, extra = {}) {
  const sourceUrl = `https://clips.twitch.tv/${id}`;
  return { id: `twitch-clip:${id}`, platform: 'twitch', kind: 'clip', creatorKey, handle, title: `Locura de ${handle}`, sourceUrl, durationSec: 30, views: 9000,
    publishedAt: new Date(NOW - 2 * 3600_000).toISOString(), observedAt: new Date(NOW).toISOString(), score: 4, clipPolicy: { status: 'allowed_unless_prohibited' },
    download: { mode: 'needs_local_download' }, approval: { status: 'approved', pendingActionId: `pa-${id}` },
    caption: buildCreditCaption({ handle, platform: 'twitch', sourceUrl, title: `Locura de ${handle}` }), ...extra };
}
function baseState(candidates, extra = {}) {
  return { version: 1, updatedAt: null, lastRun: null, takedowns: [], signals: [], candidates, sourceAuthorizations: fixtureGrants(candidates, NOW),
    creators: {
      'twitch:100': { key: 'twitch:100', platform: 'twitch', handle: 'thegrefg', creatorGroupId: null, policy: { status: 'allowed_unless_prohibited', source: 'channel_description_checked' } },
      'twitch:200': { key: 'twitch:200', platform: 'twitch', handle: 'rubius', creatorGroupId: null, policy: { status: 'prohibited', source: 'channel_description' } },
      'twitch:300': { key: 'twitch:300', platform: 'twitch', handle: 'nuevo', creatorGroupId: null, policy: { status: 'allowed_unless_prohibited', source: 'not_checked' } },
    }, ...extra };
}
function memoryStore(state) {
  const data = new Map([[STREAMER_STATE_NAMESPACE('o'), JSON.stringify(state)]]);
  return { data, get state() { return JSON.parse(data.get(STREAMER_STATE_NAMESPACE('o'))); },
    async read(k) { return data.get(k) ?? null; }, async transact(k, fn) { const v = await fn(data.get(k) ?? null); data.set(k, v); return v; } };
}
function approvals(statuses) {
  const executed = [];
  return { executed, async statuses(owner, ids) { return new Map(ids.filter(i => statuses[i]).map(i => [i, statuses[i]])); }, async markExecuted(owner, id, result) { executed.push({ id, result }); } };
}
function fakeMetricool({ scheduleResult = item => ({ id: `mc-${item.id}`, mediaUrl: 'https://static.metricool.com/x.mp4' }), preflight = async () => {} } = {}) {
  const calls = { preflight: [], schedule: [], confirm: [], publication: [], metrics: [] };
  return { calls,
    async preflight(d, item) { calls.preflight.push(item); return preflight(d, item); },
    async schedule(d, item) { calls.schedule.push(item); const r = scheduleResult(item); if (r instanceof Error) throw r; return r; },
    async confirmSchedule(d, item) { calls.confirm.push(item); return { id: `mc-${item.id}`, mediaUrl: 'https://static.metricool.com/x.mp4' }; },
    async publication(d, item) { calls.publication.push(item); return { id: '777', url: 'https://www.tiktok.com/@a/video/777', publishedAt: item.scheduledAt }; },
    async metrics(d, pub) { calls.metrics.push(pub); return { views: 1234, completionRate: 0.4, observedAt: new Date(Date.parse(pub.publishedAt) + 30 * 3600_000).toISOString() }; } };
}
function fakeStager() {
  const s = { uploaded: [], removed: [], swept: 0,
    async upload(file, name) { const a = { id: s.uploaded.length + 1, url: `https://github.com/o/r/releases/download/t/${name}`, createdAt: new Date(NOW).toISOString() }; s.uploaded.push(a); return a; },
    async remove(id) { s.removed.push(id); return true; }, async sweep() { s.swept++; return 0; } };
  return s;
}
const okFetch = async () => ({ status: 206, ok: true, json: async () => ({}) });
function fakeMedia() {
  const calls = { download: [], render: [] };
  return { calls,
    download: async ({ candidate }) => { calls.download.push(candidate.id); return { file: '/tmp/x/source.mp4', cut: { start: 0, duration: 30, source: 'full_clip' } }; },
    render: async (input) => { calls.render.push(input); return { file: '/tmp/x/render.mp4', sha256: 'a'.repeat(64), durationSec: 30, sizeBytes: 1000 }; },
    makeDir: async () => await mkdtemp(path.join(tmpdir(), 'cw-test-')) };
}

test('config: off by default, kill switch, allowlisted destinations only, slots inside 11:00-21:00', () => {
  const c = cloudPublishConfig({});
  assert.equal(c.enabled, false); assert.equal(c.dailyCap, 5); assert.deepEqual(c.missing, ['METRICOOL_USER_TOKEN', 'METRICOOL_USER_ID']);
  assert.deepEqual(c.destinations.map(destinationKey), ['6431685:tiktok:streamersus', '6431687:tiktok:streamersclipusa', '6591612:tiktok:news305miami'], 'TikTok only by default');
  assert.equal(cloudPublishConfig({ CLIPPERS_STREAMER_CLOUD_DESTINATIONS: '6591612:facebook:1193011863901514' }).destinations[0].network, 'facebook');
  assert.ok(!c.destinations.some(d => d.brandId === 6595747), 'NY brand stays held until a destination is connected');
  const k = cloudPublishConfig({ CLIPPERS_STREAMER_CLOUD_KILL_SWITCH: 'true', CLIPPERS_STREAMER_CLOUD_DESTINATIONS: '6431685:tiktok:streamersus,6431692:tiktok:kong', CLIPPERS_STREAMER_CLOUD_DAILY_PER_DESTINATION: '50' });
  assert.equal(k.killSwitch, true); assert.equal(k.dailyCap, 5); assert.deepEqual(k.destinations.map(destinationKey), ['6431685:tiktok:streamersus']);
  assert.equal(k.unknownDestinations.length, 1);
  assert.deepEqual(parseSlots('09:00,11:00,11:30,22:00,21:00,16:45'), ['11:00', '16:45', '21:00']);
  assert.deepEqual(parseSlots(''), ['11:00', '13:30', '16:00', '18:30', '21:00']);
});

test('slots: New York wall clock, lead time, stagger, daily cap and occupied hours', () => {
  assert.equal(wallClockToIso('2026-11-19', '11:00'), '2026-11-19T16:00:00.000Z');
  assert.equal(wallClockToIso('2026-07-01', '11:00'), '2026-07-01T15:00:00.000Z');
  const config = cloudPublishConfig({});
  const d = DESTINATIONS[0];
  assert.equal(nextSlot({ now: NOW, config, destination: d, index: 0 }), '2026-11-19T16:00:00.000Z');
  assert.equal(nextSlot({ now: NOW, config, destination: DESTINATIONS[2], index: 2 }), '2026-11-19T16:14:00.000Z');
  const taken = [{ destinationKey: destinationKey(d), scheduledAt: '2026-11-19T16:00:00.000Z', status: 'scheduled' }];
  assert.equal(nextSlot({ now: NOW, config, destination: d, index: 0, posts: taken }), '2026-11-19T18:30:00.000Z');
  const late = Date.parse('2026-11-20T01:45:00.000Z'); // 20:45 NY: next day's 11:00
  assert.equal(nextSlot({ now: late, config, destination: d }), '2026-11-20T16:00:00.000Z');
  const full = ['16:00', '18:30', '21:00', '23:30', '02:00'].map((t, i) => ({ destinationKey: destinationKey(d), scheduledAt: `2026-11-${i < 4 ? 19 : 20}T${t}:00.000Z`, status: 'scheduled' }));
  assert.equal(nextSlot({ now: NOW, config, destination: d, posts: full }), '2026-11-20T16:00:00.000Z');
});

test('cut selection: whole short clip, heatmap peak for long videos, never over 60 s', () => {
  assert.deepEqual(selectCutWindow({ durationSec: 28, targetSec: 45 }), { start: 0, duration: 28, source: 'full_clip' });
  const heatmap = Array.from({ length: 100 }, (_, i) => ({ start_time: i * 12, end_time: i * 12 + 12, value: i === 50 ? 1 : 0.1 }));
  const w = selectCutWindow({ durationSec: 1200, heatmap, targetSec: 45 });
  assert.equal(w.source, 'heatmap_peak'); assert.ok(w.start <= 600 && w.start + w.duration >= 612, JSON.stringify(w));
  const f = selectCutWindow({ durationSec: 3600, targetSec: 500 });
  assert.equal(f.source, 'fallback_offset'); assert.equal(f.duration, 60);
});

test('render/download args: no shell, bundled font, impersonation first for YouTube, section only', () => {
  assert.equal(wrapLines('uno dos tres cuatro cinco seis siete ocho nueve diez once doce trece catorce', 12, 2).split('\n').length, 2);
  const args = ffmpegRenderArgs({ input: '/tmp/a/s.mp4', output: '/tmp/a/o.mp4', hookFile: '/tmp/a/h.txt', creditFile: '/tmp/a/c.txt', fontFile: '/tmp/a/font.ttf', duration: 90 });
  assert.equal(args[args.indexOf('-t') + 1], '60.00');
  assert.match(args[args.indexOf('-filter_complex') + 1], /fontfile=\/tmp\/a\/font\.ttf:textfile=\/tmp\/a\/h\.txt:expansion=none/);
  assert.throws(() => ffmpegRenderArgs({ input: 'x', output: 'y', hookFile: "/tmp/a'b", creditFile: '/tmp/c', fontFile: '/tmp/f', duration: 10 }), /RENDER_UNSAFE_PATH/);
  const yt = ytDlpDownloadArgs({ url: 'https://www.youtube.com/watch?v=abcdefghijk', platform: 'youtube', start: 100, duration: 45, outTemplate: '/tmp/a/source.%(ext)s', impersonate: 'chrome' });
  assert.deepEqual(yt.slice(0, 2), ['--impersonate', 'chrome']);
  assert.equal(yt[yt.indexOf('--download-sections') + 1], '*100.0-146.0');
  assert.equal(yt.at(-2), '--'); // URL can never be parsed as an option
  assert.ok(!ytDlpDownloadArgs({ url: 'https://clips.twitch.tv/a', platform: 'twitch', start: 0, duration: 30, outTemplate: 'o' }).includes('--download-sections'));
  assert.ok(ytDlpInfoArgs({ url: 'https://x', impersonate: 'chrome' }).includes('--skip-download'));
  assert.equal(validateRenderProbe({ streams: [{ codec_type: 'video', width: 1080, height: 1920 }, { codec_type: 'audio' }], format: { duration: '45.02' } }).ok, true);
  assert.deepEqual(validateRenderProbe({ streams: [{ codec_type: 'video', width: 1920, height: 1080 }], format: { duration: '3600' } }).errors, ['render_not_1080x1920', 'render_without_audio', 'render_duration_out_of_range']);
  assert.equal(hookText({ variant: 'teaser', title: 'x', handle: '@The Grefg!' }), 'Mira lo que le pasó a @TheGrefg');
  assert.equal(creditText({ handle: 'rubius', platform: 'youtube' }), 'Créditos: @rubius · YouTube');
});

test('publish gate: prohibited, takedown, unchecked creator, missing credit, live stream', () => {
  const ok = candidate('a', 'twitch:100', 'thegrefg');
  const state = baseState([ok]);
  assert.equal(publishGate(state, ok, { now: NOW }), null);
  assert.equal(publishGate(state, candidate('b', 'twitch:200', 'rubius')), 'creator_prohibited');
  assert.equal(publishGate(state, candidate('c', 'twitch:300', 'nuevo')), 'creator_policy_not_checked');
  assert.equal(publishGate({ ...state, takedowns: [parseTakedown({ creatorKey: 'twitch:100', reason: 'DMCA', receivedAt: '2026-11-19T10:00:00.000Z' }, NOW)] }, ok), 'takedown');
  assert.equal(publishGate(state, { ...ok, caption: 'sin creditos' }), 'caption_missing_credit');
  assert.equal(publishGate(state, { ...ok, durationSec: 3600 }), 'clip_too_long');
  for (const v of ['title', 'teaser']) assert.ok(captionHasCredit(clipCaption(ok, v), ok.handle, ok.sourceUrl), v);
});

test('live description re-check blocks a creator who just added a no-clip notice', async () => {
  const fetch = async (url) => {
    const u = new URL(String(url));
    if (u.host === 'id.twitch.tv') return { ok: true, status: 200, json: async () => ({ access_token: 't' }) };
    return { ok: true, status: 200, json: async () => ({ data: [{ id: '100', description: 'NO CLIPS please' }] }) };
  };
  const r = await liveDescriptionCheck({ candidate: candidate('a', 'twitch:100', 'thegrefg'), env: { TWITCH_CLIENT_ID: 'cid', TWITCH_CLIENT_SECRET: 's' }, fetch });
  assert.equal(r.checked, true); assert.equal(r.prohibited, true);
  assert.equal((await liveDescriptionCheck({ candidate: candidate('a', 'twitch:100', 'x'), env: {}, fetch })).checked, false);
});

test('learning: hook A/B winner per destination, exploit 80 %, creator boost', () => {
  const key = destinationKey(DESTINATIONS[0]);
  const posts = [];
  for (let i = 0; i < 5; i++) {
    posts.push({ destinationKey: key, creatorKey: 'twitch:100', hookVariant: 'teaser', observation: { views: 2000 + i, completionRate: 0.5, ageHours: 30 } });
    posts.push({ destinationKey: key, creatorKey: 'twitch:900', hookVariant: 'title', observation: { views: 1000 + i, completionRate: 0.5, ageHours: 30 } });
  }
  posts.push({ destinationKey: key, creatorKey: 'twitch:100', hookVariant: 'title', observation: { views: 99999, ageHours: 80 } }); // outside window: ignored
  const learning = computeLearning(posts, { now: NOW });
  assert.equal(learning.samples, 10);
  assert.equal(learning.hookPreference[key], 'teaser');
  const picks = Array.from({ length: 200 }, (_, i) => chooseHookVariant(learning, `c${i}`).variant);
  const share = picks.filter(v => v === 'teaser').length / picks.length;
  assert.ok(share > 0.7 && share < 0.9, String(share));
  assert.ok(creatorBoostFor(learning, 'twitch:100') > 0 && creatorBoostFor(learning, 'twitch:900') < 0);
  assert.equal(chooseHookVariant(computeLearning([]), 'x').mode, 'ab_test');
});

test('disabled or kill switch: nothing is read, downloaded or sent', async () => {
  for (const env of [{}, { ...ON, CLIPPERS_STREAMER_CLOUD_KILL_SWITCH: 'true' }]) {
    const store = memoryStore(baseState([candidate('a', 'twitch:100', 'thegrefg')])), m = fakeMetricool(), media = fakeMedia();
    const { report, skipped } = await runCloudPublisher({ env, now: NOW, owner: 'o', store, approvals: approvals({ 'pa-a': 'approved' }), metricool: m, stager: fakeStager(), fetch: okFetch, ...media });
    assert.equal(skipped, true); assert.ok(['disabled', 'kill_switch'].includes(report.status));
    assert.equal(media.calls.download.length, 0); assert.equal(m.calls.schedule.length, 0);
  }
});

test('approved clip (lanes off): policy-gated, rendered once, ONE account only as a draft (never fan-out), asset removed, approval marked', async () => {
  const state = baseState([candidate('a', 'twitch:100', 'thegrefg'), candidate('b', 'twitch:200', 'rubius', { score: 9 }), candidate('p', 'twitch:100', 'thegrefg', { score: 1, approval: { status: 'pending', pendingActionId: 'pa-p' } })]);
  const store = memoryStore(state), m = fakeMetricool(), stager = fakeStager(), media = fakeMedia(), appr = approvals({ 'pa-a': 'executed', 'pa-b': 'approved', 'pa-p': 'pending' });
  const { report } = await runCloudPublisher({ env: ON, now: NOW, owner: 'o', store, approvals: appr, metricool: m, stager, fetch: okFetch, ...media, clock: () => NOW });
  assert.equal(report.status, 'completed', JSON.stringify(report));
  assert.deepEqual(media.calls.download, ['twitch-clip:a'], 'prohibited creator and pending approval are never downloaded');
  assert.equal(m.calls.schedule.length, 1, 'one video file -> one account, even with lanes off');
  assert.deepEqual(m.calls.schedule.map(i => i.destinationKey), ['6431685:tiktok:streamersus']);
  assert.deepEqual(m.calls.schedule.map(i => i.scheduledAt), ['2026-11-19T16:00:00.000Z']);
  assert.equal(m.calls.schedule[0].draft, true, 'lanes off: owner approves every post');
  assert.ok(m.calls.schedule.every(i => captionHasCredit(i.caption, 'thegrefg', 'https://clips.twitch.tv/a') && i.mediaSha256 === 'a'.repeat(64) && i.thirdPartyCommercial === false));
  assert.deepEqual(stager.removed, [1]);
  assert.equal(appr.executed.length, 1); assert.equal(appr.executed[0].result.posts.length, 1);
  const c = store.state.cloudPublish;
  assert.equal(c.clips['twitch-clip:a'].status, 'published'); assert.equal(c.clips['twitch-clip:a'].mediaAsset, null);
  assert.equal(c.clips['twitch-clip:b'].status, 'blocked'); assert.equal(c.clips['twitch-clip:b'].reason, 'creator_prohibited');
  assert.ok(c.posts.every(p => p.status === 'scheduled' && p.metricoolId));
  assert.ok(media.calls.render[0].credit.includes('@thegrefg'));
  // Second run: nothing re-published.
  const again = await runCloudPublisher({ env: ON, now: NOW + 3600_000, owner: 'o', store, approvals: appr, metricool: m, stager, fetch: okFetch, ...media });
  assert.equal(m.calls.schedule.length, 1); assert.equal(again.report.counts.scheduled, 0);
});

test('uncertain Metricool write is never resent: reconciled read-only, then the asset is removed', async () => {
  const store = memoryStore(baseState([candidate('a', 'twitch:100', 'thegrefg')]));
  const m = fakeMetricool({ scheduleResult: () => new Error('metricool_request_outcome_uncertain') }), stager = fakeStager(), media = fakeMedia();
  const env = { ...ON, CLIPPERS_STREAMER_CLOUD_DESTINATIONS: '6431687:tiktok:streamersclipusa' };
  await runCloudPublisher({ env, now: NOW, owner: 'o', store, approvals: approvals({ 'pa-a': 'approved' }), metricool: m, stager, fetch: okFetch, ...media });
  assert.equal(store.state.cloudPublish.posts[0].status, 'verification_pending');
  assert.deepEqual(stager.removed, [], 'asset kept until Metricool confirms the copy');
  await runCloudPublisher({ env, now: NOW + 3600_000, owner: 'o', store, approvals: approvals({ 'pa-a': 'approved' }), metricool: m, stager, fetch: okFetch, ...media });
  assert.equal(m.calls.schedule.length, 1, 'no blind resend');
  assert.equal(store.state.cloudPublish.posts[0].status, 'scheduled');
  assert.deepEqual(stager.removed, [1]);
});

test('takedown recorded while rendering blocks the write (fresh gate inside the owner lock)', async () => {
  const store = memoryStore(baseState([candidate('a', 'twitch:100', 'thegrefg')]));
  const m = fakeMetricool(), stager = fakeStager(), media = fakeMedia();
  const render = async (input) => {
    const s = store.state; s.takedowns = [{ creatorKey: 'twitch:100', reason: 'DMCA', receivedAt: '2026-11-19T13:00:00.000Z' }];
    store.data.set(STREAMER_STATE_NAMESPACE('o'), JSON.stringify(s));
    return media.render(input);
  };
  const { report } = await runCloudPublisher({ env: ON, now: NOW, owner: 'o', store, approvals: approvals({ 'pa-a': 'approved' }), metricool: m, stager, fetch: okFetch, ...media, render });
  assert.equal(m.calls.schedule.length, 0); assert.equal(m.calls.preflight.length, 0);
  assert.ok(report.heldReasons.includes('publish_gate:takedown'));
  assert.deepEqual(stager.removed, [1]);
  assert.equal(store.state.cloudPublish.clips['twitch-clip:a'].status, 'blocked');
  assert.equal(store.state.cloudPublish.clips['twitch-clip:a'].reason, 'takedown');
});

test('preflight slot conflict moves to the next slot; destination hold defers without writing', async () => {
  const store = memoryStore(baseState([candidate('a', 'twitch:100', 'thegrefg')]));
  let first = true;
  const m = fakeMetricool({ preflight: async (d) => {
    if (d.network === 'facebook') throw new Error('destination_publish_permission_missing');
    if (first) { first = false; throw new Error('metricool_slot_duplicate_or_daily_cap'); }
  } });
  const env = { ...ON, CLIPPERS_STREAMER_CLOUD_DESTINATIONS: '6431685:tiktok:streamersus,6591612:facebook:1193011863901514' };
  const { report } = await runCloudPublisher({ env, now: NOW, owner: 'o', store, approvals: approvals({ 'pa-a': 'approved' }), metricool: m, stager: fakeStager(), fetch: okFetch, ...fakeMedia(), clock: () => NOW });
  assert.deepEqual(m.calls.schedule.map(i => i.scheduledAt), ['2026-11-19T18:30:00.000Z']);
  assert.equal(report.counts.deferred, 0, 'single account: the second (Facebook) destination is never planned');
  const fbFirst = await runCloudPublisher({ env: { ...env, CLIPPERS_STREAMER_CLOUD_DESTINATIONS: '6591612:facebook:1193011863901514' }, now: NOW, owner: 'o', store: memoryStore(baseState([candidate('a', 'twitch:100', 'thegrefg')])), approvals: approvals({ 'pa-a': 'approved' }), metricool: m, stager: fakeStager(), fetch: okFetch, ...fakeMedia(), clock: () => NOW });
  assert.equal(fbFirst.report.counts.deferred, 1);
  assert.ok(fbFirst.report.heldReasons.some(r => r.startsWith('destination_held:6591612:destination_publish_permission_missing')));
});

test('Metricool daily cap (drafts from another pipeline) skips the day; no free slot is reported, never a silent drop', async () => {
  const capErr = () => Object.assign(new Error('metricool_slot_duplicate_or_daily_cap'), { detail: 'daily_cap', dayRows: 10, dayLimit: 5 });
  const today = new Date(NOW).toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
  const dayOf = iso => new Date(iso).toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
  // Today full: one rejection, then the next pick is tomorrow (not another hour today).
  const m = fakeMetricool({ preflight: async (d, item) => { if (dayOf(item.scheduledAt) === today) throw capErr(); } });
  const ok = await runCloudPublisher({ env: ON, now: NOW, owner: 'o', store: memoryStore(baseState([candidate('a', 'twitch:100', 'thegrefg')])), approvals: approvals({ 'pa-a': 'approved' }), metricool: m, stager: fakeStager(), fetch: okFetch, ...fakeMedia(), clock: () => NOW });
  assert.equal(ok.report.counts.scheduled, 1);
  assert.equal(m.calls.preflight.length, 2, 'a full day is skipped in one step');
  assert.notEqual(dayOf(m.calls.schedule[0].scheduledAt), today);
  // Every day full: rendered, nothing written, explicit reason + count.
  const store = memoryStore(baseState([candidate('a', 'twitch:100', 'thegrefg')]));
  const full = fakeMetricool({ preflight: async () => { throw capErr(); } });
  const { report } = await runCloudPublisher({ env: ON, now: NOW, owner: 'o', store, approvals: approvals({ 'pa-a': 'approved' }), metricool: full, stager: fakeStager(), fetch: okFetch, ...fakeMedia(), clock: () => NOW });
  assert.equal(report.counts.rendered, 1); assert.equal(report.counts.scheduled, 0);
  assert.equal(full.calls.schedule.length, 0);
  assert.equal(report.counts.slotExhausted, 1); assert.equal(report.counts.deferred, 1);
  const reason = report.heldReasons.find(r => r.startsWith('metricool_no_free_slot:'));
  assert.ok(reason && reason.endsWith(':daily_cap:10/5'), reason);
  assert.equal(store.state.cloudPublish.clips['twitch-clip:a'].status, 'deferred');
  assert.equal(store.state.cloudPublish.clips['twitch-clip:a'].reason, reason);
});

test('Metricool preflight detail: content match beats daily cap; hour clash and full day are distinct', async () => {
  const target = DESTINATIONS.find(d => d.network === 'tiktok');
  const at = '2026-11-19T21:00:00.000Z'; // 16:00 ET
  const row = (hour, text, media) => ({ id: `r${hour}${text}`, text, media: [media], draft: true,
    publicationDate: { dateTime: `2026-11-19T${String(hour).padStart(2, '0')}:00:00`, timezone: 'America/New_York' }, providers: [{ network: 'tiktok', status: 'PENDING' }] });
  const run = async rows => {
    const adapter = createPortfolioMetricool({ token: 'metricool-token-123', userId: 12, fetcher: async resource => {
      const u = new URL(resource);
      if (u.pathname.endsWith('/simpleProfiles')) return Response.json([{ id: target.brandId, tiktok: target.account, ownerUserId: 12, isShared: false }]);
      if (u.pathname.includes('/scheduler/')) return Response.json({ data: rows });
      assert.fail('unexpected request');
    } });
    try { await adapter.preflight(target, { scheduledAt: at, caption: 'mine', mediaUrl: 'https://x/mine.mp4', dailyLimit: 5, countDrafts: true }); return null; }
    catch (e) { assert.equal(e.message, 'metricool_slot_duplicate_or_daily_cap'); return e.detail; }
  };
  const full = [11, 13, 15, 17, 19].map(h => row(h, `other${h}`, `https://x/o${h}.mp4`));
  assert.equal(await run([...full, row(20, 'mine', 'https://x/z.mp4')]), 'slot_duplicate_content', 'caption match wins over daily cap');
  assert.equal(await run([...full.slice(0, 4), row(21, 'x', 'https://x/mine.mp4')]), 'slot_duplicate_content', 'media match wins over daily cap');
  assert.equal(await run(full), 'daily_cap');
  assert.equal(await run([row(16, 'other', 'https://x/o.mp4')]), 'slot_duplicate');
  assert.equal(await run([row(11, 'other', 'https://x/o.mp4')]), null);
});

test('worker: duplicate content stops without retry; destination hold labels the clip; already_attempted is not a silent drop', async () => {
  const dupErr = () => Object.assign(new Error('metricool_slot_duplicate_or_daily_cap'), { detail: 'slot_duplicate_content' });
  const store = memoryStore(baseState([candidate('a', 'twitch:100', 'thegrefg')]));
  const m = fakeMetricool({ preflight: async () => { throw dupErr(); } });
  const dup = await runCloudPublisher({ env: ON, now: NOW, owner: 'o', store, approvals: approvals({ 'pa-a': 'approved' }), metricool: m, stager: fakeStager(), fetch: okFetch, ...fakeMedia(), clock: () => NOW });
  assert.equal(m.calls.preflight.length, 1, 'no other hour, no next day');
  assert.equal(dup.report.counts.blocked, 1); assert.equal(dup.report.counts.deferred, 0);
  assert.ok(dup.report.heldReasons.some(r => r.startsWith('metricool_duplicate_content:')));
  assert.equal(store.state.cloudPublish.clips['twitch-clip:a'].status, 'blocked');
  assert.equal(store.state.cloudPublish.clips['twitch-clip:a'].reason, 'metricool_duplicate_content');

  const store2 = memoryStore(baseState([candidate('a', 'twitch:100', 'thegrefg')]));
  const held = fakeMetricool({ preflight: async () => { throw new Error('destination_publish_permission_missing'); } });
  const h = await runCloudPublisher({ env: ON, now: NOW, owner: 'o', store: store2, approvals: approvals({ 'pa-a': 'approved' }), metricool: held, stager: fakeStager(), fetch: okFetch, ...fakeMedia(), clock: () => NOW });
  assert.equal(h.report.counts.deferred, 1);
  assert.ok(!h.report.heldReasons.some(r => r.startsWith('rendered_not_scheduled')));
  assert.match(store2.state.cloudPublish.clips['twitch-clip:a'].reason, /^destination_held:\d+:destination_publish_permission_missing$/);

  // A post for the same clip/destination appears while rendering (another run): already_attempted, nothing written.
  const store3 = memoryStore(baseState([candidate('a', 'twitch:100', 'thegrefg')]));
  const media = fakeMedia();
  const render = async input => {
    const out = await media.render(input);
    const c = candidate('a', 'twitch:100', 'thegrefg');
    const st = store3.state;
    for (const destination of DESTINATIONS) st.cloudPublish.posts.push({ ...postItem({ candidate: c, destination, scheduledAt: new Date(NOW + 5 * 3600_000).toISOString(), caption: 'c', mediaUrl: 'u', mediaSha256: 'a'.repeat(64), hookVariant: 'title' }), status: 'pending_write' });
    store3.data.set(STREAMER_STATE_NAMESPACE('o'), JSON.stringify(st));
    return out;
  };
  const m3 = fakeMetricool();
  const r3 = await runCloudPublisher({ env: ON, now: NOW, owner: 'o', store: store3, approvals: approvals({ 'pa-a': 'approved' }), metricool: m3, stager: fakeStager(), fetch: okFetch, ...media, render, clock: () => NOW });
  assert.equal(m3.calls.schedule.length, 0);
  assert.ok(r3.report.heldReasons.includes('publish_gate:already_attempted'));
  assert.ok(!r3.report.heldReasons.some(r => r.startsWith('rendered_not_scheduled')));
  assert.equal(r3.report.counts.deferred, 0); assert.equal(r3.report.counts.blocked, 0);
});

test('missing Metricool secrets hold publishing; dry run renders without Metricool', async () => {
  const store = memoryStore(baseState([candidate('a', 'twitch:100', 'thegrefg')])), media = fakeMedia();
  const held = await runCloudPublisher({ env: { CLIPPERS_STREAMER_CLOUD_PUBLISH_ENABLED: 'true', CLIPPERS_STREAMER_LANES_ENABLED: 'false' }, now: NOW, owner: 'o', store, approvals: approvals({ 'pa-a': 'approved' }), metricool: null, stager: null, fetch: okFetch, ...media });
  assert.equal(held.report.status, 'held_missing_secrets'); assert.equal(media.calls.download.length, 0);
  const dir = await mkdtemp(path.join(tmpdir(), 'cw-dry-'));
  await writeFile('/tmp/cw-render.mp4', 'x');
  const dry = await runCloudPublisher({ env: { CLIPPERS_STREAMER_CLOUD_PUBLISH_ENABLED: 'true', CLIPPERS_STREAMER_LANES_ENABLED: 'false', CLIPPERS_STREAMER_CLOUD_DRY_RUN: 'true' }, now: NOW, owner: 'o', store, approvals: approvals({ 'pa-a': 'approved' }), metricool: null, stager: null, fetch: okFetch,
    ...media, render: async () => ({ file: '/tmp/cw-render.mp4', sha256: 'b'.repeat(64), durationSec: 30 }), outputDir: dir });
  assert.equal(dry.report.counts.rendered, 1); assert.equal(dry.report.counts.scheduled, 0);
  assert.deepEqual(store.state.cloudPublish.clips, {}, 'dry run never writes clip state (approval stays queued)');
  assert.equal(store.state.cloudPublish.lastRun.status, 'held_missing_secrets', 'dry run does not overwrite lastRun');
  const dry2 = await runCloudPublisher({ env: { CLIPPERS_STREAMER_CLOUD_PUBLISH_ENABLED: 'true', CLIPPERS_STREAMER_LANES_ENABLED: 'false', CLIPPERS_STREAMER_CLOUD_DRY_RUN: 'true' }, now: NOW, owner: 'o', store, approvals: approvals({ 'pa-a': 'approved' }), metricool: null, stager: null, fetch: okFetch,
    ...media, render: async () => ({ file: '/tmp/cw-render.mp4', sha256: 'b'.repeat(64), durationSec: 30 }), outputDir: dir });
  assert.equal(dry2.report.counts.rendered, 1, 'still queueable after a dry run');
  assert.equal(await readFile(path.join(dir, 'twitch-clip_a.mp4'), 'utf8'), 'x');
  await rm(dir, { recursive: true, force: true });
});

test('learning loop: reads Metricool analytics 24-48 h after the slot and stores the observation', async () => {
  const item = postItem({ candidate: candidate('a', 'twitch:100', 'thegrefg'), destination: DESTINATIONS[0], scheduledAt: new Date(NOW - 30 * 3600_000).toISOString(), caption: 'c', mediaUrl: 'u', mediaSha256: 'a'.repeat(64), hookVariant: 'title' });
  const store = memoryStore(baseState([], { cloudPublish: { version: 1, clips: {}, posts: [{ ...item, status: 'scheduled', metricoolId: 'mc-1' }], learning: null, lastRun: null } }));
  const m = fakeMetricool();
  const { report } = await runCloudPublisher({ env: ON, now: NOW, owner: 'o', store, approvals: approvals({}), metricool: m, stager: fakeStager(), fetch: okFetch, ...fakeMedia() });
  assert.equal(report.counts.observed, 1);
  const obs = store.state.cloudPublish.posts[0].observation;
  assert.equal(obs.views, 1234); assert.equal(obs.ageHours, 30);
  assert.equal(store.state.cloudPublish.learning.samples, 1);
});

test('GitHub release stager: creates the staging release once, uploads, deletes', async () => {
  const calls = [];
  const fetch = async (url, init = {}) => {
    calls.push([init.method ?? 'GET', String(url)]);
    assert.equal(init.headers.Authorization, 'Bearer ghs_token');
    if (String(url).endsWith('/releases/tags/clippers-media-staging')) return { status: 404, json: async () => ({}) };
    if (init.method === 'POST' && String(url).endsWith('/releases')) return { status: 201, json: async () => ({ id: 7 }) };
    if (String(url).startsWith('https://uploads.github.com/')) return { status: 201, json: async () => ({ id: 9, browser_download_url: 'https://github.com/o/r/releases/download/clippers-media-staging/stc-a.mp4', created_at: '2026-11-19T14:00:00Z' }) };
    if (init.method === 'DELETE') return { status: 204 };
    throw new Error('unexpected ' + url);
  };
  const file = path.join(await mkdtemp(path.join(tmpdir(), 'cw-up-')), 'r.mp4');
  await writeFile(file, 'video');
  const stager = createGithubReleaseStager({ token: 'ghs_token', repo: 'o/r', fetch });
  const asset = await stager.upload(file, 'stc-a.mp4');
  assert.equal(asset.id, 9);
  assert.equal(await stager.remove(9), true);
  assert.deepEqual(calls.map(c => c[0]), ['GET', 'POST', 'POST', 'DELETE']);
  assert.throws(() => createGithubReleaseStager({ token: '', repo: 'o/r' }), /GITHUB_STAGING_UNAVAILABLE/);
});

let hasFfmpeg = true;
try { execFileSync('ffmpeg', ['-hide_banner', '-filters'], { stdio: 'pipe' }).toString().includes('drawtext') || (hasFfmpeg = false); } catch { hasFfmpeg = false; }
test('real ffmpeg render: 1080x1920, audio, <= 60 s, bundled font', { skip: !hasFfmpeg && 'ffmpeg with drawtext not installed' }, async () => {
  const dir = await makeWorkDir();
  try {
    execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc=size=640x360:rate=30', '-f', 'lavfi', '-i', 'sine=frequency=440', '-t', '5', '-c:v', 'libx264', '-c:a', 'aac', '-shortest', path.join(dir, 'source.mp4')]);
    const r = await renderVerticalClip({ sourceFile: path.join(dir, 'source.mp4'), workDir: dir, duration: 90, hook: 'Locura total en el directo', credit: 'Créditos: @thegrefg · Twitch' });
    assert.match(r.sha256, /^[a-f0-9]{64}$/); assert.ok(r.durationSec <= 5.2 && r.durationSec >= 4.5, String(r.durationSec));
    assert.equal((await readFile(BUNDLED_FONT)).length > 100_000, true);
  } finally { await rm(dir, { recursive: true, force: true }); }
});


test('B1: staging asset kept while Metricool references it; removed once a Metricool copy or the slot +2 h', async () => {
  const store = memoryStore(baseState([candidate('a', 'twitch:100', 'thegrefg')]));
  const stager = fakeStager();
  const m = fakeMetricool({ scheduleResult: item => ({ id: `mc-${item.id}`, mediaUrl: item.mediaUrl }) }); // scheduler still points at the GitHub URL
  const env = { ...ON, CLIPPERS_STREAMER_CLOUD_DESTINATIONS: '6431687:tiktok:streamersclipusa' };
  await runCloudPublisher({ env, now: NOW, owner: 'o', store, approvals: approvals({ 'pa-a': 'approved' }), metricool: m, stager, fetch: okFetch, ...fakeMedia(), clock: () => NOW });
  assert.deepEqual(stager.removed, []);
  assert.equal(store.state.cloudPublish.clips['twitch-clip:a'].mediaAsset.id, 1);
  const post = store.state.cloudPublish.posts[0];
  assert.equal(post.confirmedMediaUrl, post.mediaUrl);
  // Before the slot + 2 h: still kept.
  await runCloudPublisher({ env, now: Date.parse(post.scheduledAt) + 3600_000, owner: 'o', store, approvals: approvals({ 'pa-a': 'approved' }), metricool: m, stager, fetch: okFetch, ...fakeMedia() });
  assert.deepEqual(stager.removed, []);
  await runCloudPublisher({ env, now: Date.parse(post.scheduledAt) + 3 * 3600_000, owner: 'o', store, approvals: approvals({ 'pa-a': 'approved' }), metricool: m, stager, fetch: okFetch, ...fakeMedia() });
  assert.deepEqual(stager.removed, [1]);
  assert.equal(store.state.cloudPublish.clips['twitch-clip:a'].mediaAsset, null);
  const ledger = { posts: [{ candidateId: 'x', status: 'pending_write', scheduledAt: new Date(NOW).toISOString() }] };
  assert.equal(stagedAssetRemovable(ledger, 'x', 'u', NOW + 99 * 3600_000), false, 'never while a write is uncertain');
});

test('B3: live Metricool identities, legacy ledger rows still resolve to the same destination', () => {
  assert.deepEqual(DESTINATIONS.map(destinationKey), ['6431685:tiktok:streamersus', '6431687:tiktok:streamersclipusa', '6591612:tiktok:news305miami', '6591612:facebook:1193011863901514', '6595747:facebook:1198281286708321']);
  const legacy = { brandId: 6431685, network: 'tiktok', account: 'streamersclips' };
  assert.equal(findDestination(legacy).account, 'streamersus');
  assert.equal(destinationKey(legacy), '6431685:tiktok:streamersus');
  assert.equal(destinationKey({ brandId: 6591612, network: 'tiktok', account: 'ynb4b6r6' }), '6591612:tiktok:news305miami');
  assert.equal(findDestination({ brandId: 6431687, network: 'tiktok', account: 'streamersclips' }), undefined, 'aliases are per brand');
  assert.equal(exactPost('https://www.tiktok.com/@streamersus/video/1', legacy).id, '1');
  assert.equal(exactPost('https://www.tiktok.com/@streamersclips/video/2', DESTINATIONS[0]).id, '2', 'old post URLs still match for analytics');
  assert.equal(exactPost('https://www.tiktok.com/@someoneelse/video/3', DESTINATIONS[2]), null);
});

test('live re-check unavailable with keys configured: clip deferred, never downloaded', async () => {
  const store = memoryStore(baseState([candidate('a', 'twitch:100', 'thegrefg')])), media = fakeMedia(), m = fakeMetricool();
  const fetch = async () => { throw new Error('network down'); };
  const { report } = await runCloudPublisher({ env: { ...ON, TWITCH_CLIENT_ID: 'cid', TWITCH_CLIENT_SECRET: 's' }, now: NOW, owner: 'o', store, approvals: approvals({ 'pa-a': 'approved' }), metricool: m, stager: fakeStager(), fetch, ...media });
  assert.equal(media.calls.download.length, 0); assert.equal(report.counts.deferred, 1);
  assert.match(store.state.cloudPublish.clips['twitch-clip:a'].reason, /^live_check_unavailable/);
});

test('run deadline: no new clip once the run is past the deadline', async () => {
  const store = memoryStore(baseState([candidate('a', 'twitch:100', 'thegrefg'), candidate('b', 'twitch:100', 'thegrefg', { score: 3 })]));
  let t = NOW; const media = fakeMedia();
  const render = async (input) => { t += 21 * 60_000; return media.render(input); };
  const { report } = await runCloudPublisher({ env: ON, now: NOW, owner: 'o', store, approvals: approvals({ 'pa-a': 'approved', 'pa-b': 'approved' }), metricool: fakeMetricool(), stager: fakeStager(), fetch: okFetch, ...media, render, clock: () => t });
  assert.equal(media.calls.download.length, 1); assert.ok(report.heldReasons.includes('run_deadline_reached'));
});

test('child processes get an allowlisted environment only', () => {
  const env = childEnv({ PATH: '/bin', HOME: '/h', DATABASE_URL: 'postgres://secret', METRICOOL_USER_TOKEN: 't', GITHUB_TOKEN: 'g', LANG: 'C.UTF-8' }, { PYTHONPATH: '/p', DATABASE_URL: 'x' });
  assert.deepEqual(env, { PATH: '/bin', HOME: '/h', LANG: 'C.UTF-8', PYTHONPATH: '/p' });
  assert.equal(creditText({ handle: 'el-rubius', platform: 'youtube' }), 'Créditos: @el-rubius · YouTube');
});

test('N1: legacy-key rows (6431685:tiktok:streamersclips) count toward the cap and the already-planned check', async () => {
  const config = cloudPublishConfig({});
  const legacy = ['16:00', '18:30', '21:00', '23:30', '02:00'].map((t, i) => ({ destinationKey: '6431685:tiktok:streamersclips', scheduledAt: `2026-11-${i < 4 ? 19 : 20}T${t}:00.000Z`, status: 'scheduled' }));
  assert.equal(nextSlot({ now: NOW, config, destination: DESTINATIONS[0], posts: legacy }), '2026-11-20T16:00:00.000Z');
  const c = candidate('a', 'twitch:100', 'thegrefg');
  const store = memoryStore(baseState([c], { cloudPublish: { version: 1, clips: {}, learning: null, lastRun: null,
    posts: [{ id: 'old', candidateId: c.id, destinationKey: '6431685:tiktok:streamersclips', scheduledAt: '2026-11-18T16:00:00.000Z', status: 'scheduled' }] } }));
  const m = fakeMetricool();
  await runCloudPublisher({ env: ON, now: NOW, owner: 'o', store, approvals: approvals({ 'pa-a': 'approved' }), metricool: m, stager: fakeStager(), fetch: okFetch, ...fakeMedia(), clock: () => NOW });
  assert.ok(!m.calls.schedule.some(i => i.destinationKey === '6431685:tiktok:streamersus'), 'not planned again for the renamed destination');
  assert.equal(m.calls.schedule.length, 1);
});

test('N2: canonical key/account helpers never loosen identity', () => {
  assert.equal(canonicalDestinationKey('6431685:tiktok:streamersclips'), '6431685:tiktok:streamersus');
  assert.equal(canonicalDestinationKey('6591612:tiktok:ynb4b6r6'), '6591612:tiktok:news305miami');
  assert.equal(canonicalDestinationKey('6431687:tiktok:streamersclips'), '6431687:tiktok:streamersclips', 'aliases are per brand+network');
  assert.equal(canonicalDestinationKey('6431685:facebook:streamersclips'), '6431685:facebook:streamersclips');
  assert.equal(canonicalAccount(6431685, 'tiktok', '@StreamersClips'), 'streamersus');
  assert.equal(canonicalAccount('6431685', 'tiktok', 'someoneelse'), 'someoneelse');
  assert.equal(valueForDestination({ '6431685:tiktok:streamersclips': 'old' }, '6431685:tiktok:streamersus'), 'old');
  assert.equal(valueForDestination({ '6431685:tiktok:streamersclips': 'old', '6431685:tiktok:streamersus': 'new' }, '6431685:tiktok:streamersus'), 'new');
  assert.equal(valueForDestination({ '6431687:tiktok:streamersclipusa': 'x' }, '6431685:tiktok:streamersus'), undefined);
});

test('deadline is re-checked after download, before render', async () => {
  const store = memoryStore(baseState([candidate('a', 'twitch:100', 'thegrefg')]));
  let t = NOW; const media = fakeMedia();
  const download = async (input) => { t += 21 * 60_000; return media.download(input); };
  const { report } = await runCloudPublisher({ env: ON, now: NOW, owner: 'o', store, approvals: approvals({ 'pa-a': 'approved' }), metricool: fakeMetricool(), stager: fakeStager(), fetch: okFetch, ...media, download, clock: () => t });
  assert.equal(media.calls.render.length, 0); assert.ok(report.heldReasons.includes('run_deadline_reached'));
  assert.equal(store.state.cloudPublish.clips['twitch-clip:a'].status, 'deferred');
});

test('yt-dlp failures carry public-log-safe diagnostics (platform, step, exit code, scrubbed stderr)', async () => {
  const { scrubDiagnostic, downloadSource } = await import('../script/clippers-streamer-cloud-render.mjs');
  assert.equal(scrubDiagnostic('[debug] x\nERROR: [youtube] abcdefghijk: Sign in to confirm you’re not a bot. Use --cookies https://example.com/a?token=SECRETSECRETSECRETSECRET1234 /home/runner/x'),
    'ERROR: [youtube] abcdefghijk: Sign in to confirm you’re not a bot. Use --cookies [url] [path]');
  assert.equal(scrubDiagnostic('auth abcdefghijklmnopqrstuvwxyz0123456789 failed'), 'auth [id] failed');
  const dir = await mkdtemp(path.join(tmpdir(), 'cw-diag-'));
  const runner = async () => { throw Object.assign(new Error('YT_DLP_FAILED'), { exitCode: 1, detail: 'ERROR: Requested format is not available' }); };
  await assert.rejects(downloadSource({ candidate: { platform: 'twitch', sourceUrl: 'https://clips.twitch.tv/a', durationSec: 30 }, workDir: dir, env: {}, runner }), e => {
    assert.equal(e.diagnostics.platform, 'twitch');
    assert.deepEqual(e.diagnostics.attempts.map(a => [a.step, a.impersonate, a.exitCode]), [['download', 'none', 1], ['download', 'chrome', 1]]);
    assert.equal(e.diagnostics.attempts[0].detail, 'ERROR: Requested format is not available');
    return true;
  });
  await rm(dir, { recursive: true, force: true });
});

test('cloud lane takes Twitch only by default; a YouTube bot check is classified and stops further YouTube tries', async () => {
  const yt = { ...candidate('y1', 'twitch:100', 'thegrefg', { score: 9 }), id: 'youtube:abcdefghijk', platform: 'youtube', kind: 'video', approval: { status: 'approved', pendingActionId: 'pa-y1' } };
  const store = memoryStore(baseState([yt, candidate('a', 'twitch:100', 'thegrefg')])), media = fakeMedia();
  const { report } = await runCloudPublisher({ env: ON, now: NOW, owner: 'o', store, approvals: approvals({ 'pa-y1': 'approved', 'pa-a': 'approved' }), metricool: fakeMetricool(), stager: fakeStager(), fetch: okFetch, ...media, clock: () => NOW });
  assert.deepEqual(media.calls.download, ['twitch-clip:a']); assert.equal(report.counts.platforms, 'twitch');

  const { downloadSource } = await import('../script/clippers-streamer-cloud-render.mjs');
  const dir = await mkdtemp(path.join(tmpdir(), 'cw-bot-'));
  const bot = async () => { throw Object.assign(new Error('YT_DLP_FAILED'), { exitCode: 1, detail: 'ERROR: [youtube] abcdefghijk: Sign in to confirm you’re not a bot.' }); };
  await assert.rejects(downloadSource({ candidate: { platform: 'youtube', sourceUrl: 'https://www.youtube.com/watch?v=abcdefghijk' }, workDir: dir, env: {}, runner: bot }), /SOURCE_BOT_CHECK/);
  await rm(dir, { recursive: true, force: true });

  const yt2 = { ...yt, id: 'youtube:bbbbbbbbbbb', approval: { status: 'approved', pendingActionId: 'pa-y2' } };
  const store2 = memoryStore(baseState([yt, yt2])), media2 = fakeMedia();
  const download = async ({ candidate: c }) => { media2.calls.download.push(c.id); throw new Error('SOURCE_BOT_CHECK'); };
  const r2 = await runCloudPublisher({ env: { ...ON, CLIPPERS_STREAMER_CLOUD_PLATFORMS: 'twitch,youtube' }, now: NOW, owner: 'o', store: store2, approvals: approvals({ 'pa-y1': 'approved', 'pa-y2': 'approved' }), metricool: fakeMetricool(), stager: fakeStager(), fetch: okFetch, ...media2, download });
  assert.equal(media2.calls.download.length, 1, 'circuit breaker after the first bot check'); assert.deepEqual(r2.report.errors, ['clip:SOURCE_BOT_CHECK']);
});

test('scrubbing removes adversarial credentials before anything reaches the public log', async () => {
  const { scrubText, scrubDiagnostic } = await import('../script/clippers-streamer-cloud-render.mjs');
  const secrets = ['s3cr3tSig', 'tok123', 'abc.def', 'QWxhZGRpbjpvcGVu', 'sess=abc', 'u1:p1', 'u2:p2', 'AKIAEXAMPLE', 'dbuser:dbpass', 'clientSecretX'];
  const cases = [
    'ERROR: unable to download usher.ttvnw.net/api/channel/hls/x.m3u8?sig=s3cr3tSig&token=tok123',
    'HTTP Error 401: Bearer abc.def',
    'request failed token=QWxhZGRpbjpvcGVu==',
    'Cookie: sess=abc; other=1',
    'fetch ftp://u1:p1@files.example.org/a and wss://u2:p2@ws.example.org/s',
    'ERROR: 403 X-Amz-Signature=AKIAEXAMPLE&X-Amz-Credential=AKIAEXAMPLE',
    // Built at runtime so the diff-hygiene secret scanner does not flag a fixture as a real database URL.
    ['connect ', 'postgres', '://', 'dbuser', ':', 'dbpass', '@db.example.org:5432/app failed'].join(''),
    'oauth failed client_secret=clientSecretX',
    'authorization: Basic QWxhZGRpbjpvcGVu',
  ];
  for (const c of cases) {
    const out = scrubText(c);
    for (const sec of secrets) assert.ok(!out.includes(sec), `${sec} leaked from: ${out}`);
  }
  assert.equal(scrubText('Authorization: Bearer x'), 'Authorization: [redacted]');
  assert.equal(scrubDiagnostic('ok\nERROR: [twitch:clips] abc: Requested format is not available'), 'ERROR: [twitch:clips] abc: Requested format is not available');
});

test('optional YT_DLP_PROXY: only YouTube downloads use it, invalid values are ignored', async () => {
  const { youtubeProxy, ytDlpDownloadArgs, ytDlpInfoArgs } = await import('../script/clippers-streamer-cloud-render.mjs');
  assert.equal(youtubeProxy({}), null);
  assert.equal(youtubeProxy({ YT_DLP_PROXY: 'not a url' }), null);
  const proxy = youtubeProxy({ YT_DLP_PROXY: 'http://u:p@proxy.example:8080' });
  assert.equal(proxy, 'http://u:p@proxy.example:8080');
  const yt = ytDlpDownloadArgs({ url: 'https://www.youtube.com/watch?v=abcdefghijk', platform: 'youtube', start: 10, duration: 30, outTemplate: '/tmp/x/source.%(ext)s', impersonate: 'chrome', proxy });
  assert.deepEqual(yt.slice(yt.indexOf('--proxy'), yt.indexOf('--proxy') + 2), ['--proxy', proxy]);
  const tw = ytDlpDownloadArgs({ url: 'https://clips.twitch.tv/x', platform: 'twitch', start: 0, duration: 30, outTemplate: '/tmp/x/source.%(ext)s', impersonate: null, proxy });
  assert.equal(tw.includes('--proxy'), false);
  assert.equal(ytDlpInfoArgs({ url: 'https://clips.twitch.tv/x', impersonate: null }).includes('--proxy'), false);
});


test('rights: legacy auto-approved candidate is held before any download and resumes after a verified grant', async () => {
  const c = candidate('rights', 'twitch:100', 'thegrefg');
  const state = baseState([c]); delete state.sourceAuthorizations;
  const store = memoryStore(state), m = fakeMetricool(), stager = fakeStager(), media = fakeMedia();
  const args = { env: ON, now: NOW, owner: 'o', store, approvals: approvals({ 'pa-rights': 'approved' }), metricool: m, stager, fetch: okFetch, ...media };
  const held = await runCloudPublisher(args);
  assert.equal(media.calls.download.length, 0); assert.equal(m.calls.schedule.length, 0);
  assert.equal(store.state.cloudPublish.clips[c.id].status, 'deferred');
  assert.ok(held.report.heldReasons.includes('rights_authorization_missing'));
  const next = store.state; next.sourceAuthorizations = fixtureGrants([c], NOW); store.data.set(STREAMER_STATE_NAMESPACE('o'), JSON.stringify(next));
  await runCloudPublisher(args);
  assert.equal(m.calls.schedule.length, 1);
});

test('rights: a grant revoked during download stops render; revocation during preflight stops the actual write', async () => {
  for (const phase of ['download', 'preflight', 'replace_source_download']) {
    const c = candidate(phase, 'twitch:100', 'thegrefg'), store = memoryStore(baseState([c]));
    const revoke = () => { const s = store.state; s.sourceAuthorizations[c.id].status = 'revoked'; store.data.set(STREAMER_STATE_NAMESPACE('o'), JSON.stringify(s)); };
    const media = fakeMedia();
    const m = fakeMetricool({ preflight: phase === 'preflight' ? async () => revoke() : async () => {} });
    const download = async input => { const r = await media.download(input); if (phase === 'download') revoke(); if (phase === 'replace_source_download') { const s = store.state; s.candidates[0].sourceUrl += '-replacement'; s.sourceAuthorizations[c.id].sourceUrl = s.candidates[0].sourceUrl; store.data.set(STREAMER_STATE_NAMESPACE('o'), JSON.stringify(s)); } return r; };
    const { report } = await runCloudPublisher({ env: ON, now: NOW, owner: 'o', store, approvals: approvals({ [`pa-${phase}`]: 'approved' }), metricool: m, stager: fakeStager(), fetch: okFetch, ...media, download });
    assert.equal(m.calls.schedule.length, 0, phase);
    assert.equal(media.calls.render.length, phase !== 'preflight' ? 0 : 1);
    assert.ok(report.heldReasons.includes(phase === 'replace_source_download' ? 'rights_source_mismatch' : 'rights_authorization_inactive'));
    assert.equal(store.state.cloudPublish.posts.length, 0, 'no phantom write intent remains');
  }
});


test('rights: held release revalidates the exact source, destination and publication window, retaining a retryable queue', async () => {
  for (const mutation of ['missing', 'destination', 'window', 'revoke_in_preflight', 'expire_in_preflight', 'replace_source_in_preflight', 'legacy_source_missing', 'prohibit_in_preflight']) {
    const c = candidate(`held-${mutation}`, 'twitch:100', 'thegrefg');
    const state = baseState([c]);
    const d = DESTINATIONS.find(d => d.network === 'facebook'); const key = destinationKey(d);
    const grant = state.sourceAuthorizations[c.id];
    if (mutation === 'missing') delete state.sourceAuthorizations;
    if (mutation === 'destination') grant.destinations = ['6431685:tiktok:streamersus'];
    if (mutation === 'window') grant.validUntil = new Date(NOW + 3600000).toISOString();
    state.cloudPublish = { version: 1, posts: [], holds: {}, clips: { [c.id]: { status: 'held_owner_action', sourceUrl: c.sourceUrl, creatorKey: c.creatorKey, renderSha256: 'a'.repeat(64), caption: c.caption, hookVariant: 'title', mediaAsset: { id: 1, url: 'https://github.com/o/r/releases/download/t/held.mp4' } } },
      heldQueue: [{ id: 'held-example', candidateId: c.id, creatorKey: c.creatorKey, sourceUrl: c.sourceUrl, destination: d, destinationKey: key, caption: c.caption, hookVariant: 'title', mediaSha256: 'a'.repeat(64), queuedAt: new Date(NOW).toISOString() }] };
    if (mutation === 'legacy_source_missing') delete state.cloudPublish.heldQueue[0].sourceUrl;
    const store = memoryStore(state); let clockNow = NOW;
    const m = fakeMetricool({ preflight: async () => {
      if (mutation === 'revoke_in_preflight') { const s = store.state; s.sourceAuthorizations[c.id].status = 'revoked'; store.data.set(STREAMER_STATE_NAMESPACE('o'), JSON.stringify(s)); }
      if (mutation === 'replace_source_in_preflight') { const s = store.state; s.candidates[0].sourceUrl += '-replacement'; s.sourceAuthorizations[c.id].sourceUrl = s.candidates[0].sourceUrl; store.data.set(STREAMER_STATE_NAMESPACE('o'), JSON.stringify(s)); }
      if (mutation === 'prohibit_in_preflight') { const s = store.state; s.candidates[0].clipPolicy = { status: 'prohibited' }; store.data.set(STREAMER_STATE_NAMESPACE('o'), JSON.stringify(s)); }
      if (mutation === 'expire_in_preflight') clockNow = Date.parse(grant.validUntil);
    } });
    const result = await runCloudPublisher({ env: { ...ON, CLIPPERS_STREAMER_CLOUD_DESTINATIONS: key }, now: NOW, clock: () => clockNow, owner: 'o', store,
      approvals: approvals({}), metricool: m, stager: fakeStager(), fetch: okFetch, ...fakeMedia() });
    assert.equal(m.calls.schedule.length, 0, mutation);
    assert.equal(store.state.cloudPublish.heldQueue.length, 1, mutation);
    assert.equal(store.state.cloudPublish.posts.length, 0, mutation);
    assert.ok(result.report.heldReasons.some(s => s.startsWith(mutation === 'prohibit_in_preflight' ? 'held_release_gate:clip_prohibited' : 'held_release_gate:rights_')), mutation);
  }
});


test('rights: changing the candidate source and granting its replacement during preflight cannot authorize the old render', async () => {
  const c = candidate('source-replaced', 'twitch:100', 'thegrefg'), store = memoryStore(baseState([c]));
  const m = fakeMetricool({ preflight: async () => { const s = store.state; s.candidates[0].sourceUrl += '-replacement'; s.sourceAuthorizations[c.id].sourceUrl = s.candidates[0].sourceUrl; store.data.set(STREAMER_STATE_NAMESPACE('o'), JSON.stringify(s)); } });
  const { report } = await runCloudPublisher({ env: ON, now: NOW, owner: 'o', store, approvals: approvals({ 'pa-source-replaced': 'approved' }), metricool: m, stager: fakeStager(), fetch: okFetch, ...fakeMedia() });
  assert.equal(m.calls.schedule.length, 0); assert.ok(report.heldReasons.includes('rights_source_mismatch'));
});


test('rights: repeated post-render permission holds do not consume the failure budget; a later grant resumes', async () => {
  const c = candidate('retry-rights', 'twitch:100', 'thegrefg'), store = memoryStore(baseState([c]));
  let revoke = true;
  const m = fakeMetricool({ preflight: async () => { if (revoke) { const s = store.state; s.sourceAuthorizations[c.id].status = 'revoked'; store.data.set(STREAMER_STATE_NAMESPACE('o'), JSON.stringify(s)); } } });
  const args = { env: ON, now: NOW, owner: 'o', store, approvals: approvals({ 'pa-retry-rights': 'approved' }), metricool: m, stager: fakeStager(), fetch: okFetch, ...fakeMedia() };
  for (let i = 0; i < 4; i++) {
    const s = store.state; s.sourceAuthorizations[c.id].status = 'approved'; store.data.set(STREAMER_STATE_NAMESPACE('o'), JSON.stringify(s));
    await runCloudPublisher(args);
    assert.equal(store.state.cloudPublish.clips[c.id].attempts, 0);
  }
  revoke = false; const s = store.state; s.sourceAuthorizations[c.id].status = 'approved'; store.data.set(STREAMER_STATE_NAMESPACE('o'), JSON.stringify(s));
  await runCloudPublisher(args); assert.equal(m.calls.schedule.length, 1);
});


test('publish policy: a fresh candidate prohibition after preflight blocks the original rendered source', async () => {
  const c = candidate('new-prohibition', 'twitch:100', 'thegrefg'), store = memoryStore(baseState([c]));
  const m = fakeMetricool({ preflight: async () => { const s = store.state; s.candidates[0].clipPolicy = { status: 'prohibited' }; store.data.set(STREAMER_STATE_NAMESPACE('o'), JSON.stringify(s)); } });
  const { report } = await runCloudPublisher({ env: ON, now: NOW, owner: 'o', store, approvals: approvals({ 'pa-new-prohibition': 'approved' }), metricool: m, stager: fakeStager(), fetch: okFetch, ...fakeMedia() });
  assert.equal(m.calls.schedule.length, 0); assert.ok(report.heldReasons.includes('clip_prohibited')); assert.equal(store.state.cloudPublish.posts.length, 0);
});


test('rights: destination or public staging denial never uploads a public asset', async () => {
  for (const denial of ['destination', 'staging']) {
    const c = candidate(`deny-${denial}`, 'twitch:100', 'thegrefg'), state = baseState([c]);
    if (denial === 'destination') state.sourceAuthorizations[c.id].destinations = ['6431687:tiktok:streamersclipusa'];
    else state.sourceAuthorizations[c.id].scope.publicMediaStaging = false;
    const stager = fakeStager(), m = fakeMetricool();
    const { report } = await runCloudPublisher({ env: ON, now: NOW, owner: 'o', store: memoryStore(state), approvals: approvals({ [`pa-deny-${denial}`]: 'approved' }), metricool: m, stager, fetch: okFetch, ...fakeMedia() });
    assert.equal(stager.uploaded.length, 0); assert.equal(m.calls.schedule.length, 0);
    assert.ok(report.heldReasons.includes(denial === 'destination' ? 'rights_destination_mismatch' : 'rights_scope_incomplete'));
  }
});

test('rights: revoked/expired legacy held staging is removed while Facebook remains held, but uncertain writes protect it', async () => {
  for (const scenario of ['revoked', 'expired', 'legacy_source', 'uncertain', 'scheduled_reference', 'scheduled_copied']) {
    const c = candidate(`public-${scenario}`, 'twitch:100', 'thegrefg'), state = baseState([c]);
    const d = DESTINATIONS.find(d => d.network === 'facebook'), key = destinationKey(d), url = 'https://github.com/o/r/releases/download/t/public-held.mp4';
    const grant = state.sourceAuthorizations[c.id];
    if (scenario === 'expired') grant.validUntil = new Date(NOW).toISOString(); else grant.status = 'revoked';
    state.cloudPublish = { version: 1, clips: { [c.id]: { status: 'held_owner_action', attempts: 1, mediaAsset: { id: 1, url } } },
      posts: ['uncertain', 'scheduled_reference', 'scheduled_copied'].includes(scenario) ? [{ id: 'prior', candidateId: c.id, destination: d, destinationKey: key, status: scenario === 'uncertain' ? 'verification_pending' : 'scheduled', confirmedMediaUrl: scenario === 'scheduled_copied' ? 'https://static.metricool.com/copied.mp4' : url, scheduledAt: new Date(NOW + 2 * 3600000).toISOString() }] : [],
      holds: { [key]: { status: 'held_owner_action' } }, heldQueue: [{ id: 'held-public', candidateId: c.id, creatorKey: c.creatorKey,
        ...(scenario === 'legacy_source' ? {} : { sourceUrl: c.sourceUrl }), destination: d, destinationKey: key, caption: c.caption, hookVariant: 'title', mediaSha256: 'a'.repeat(64), queuedAt: new Date(NOW).toISOString() }] };
    const store = memoryStore(state), m = fakeMetricool(), stager = fakeStager(), media = fakeMedia(); m.confirmSchedule = async () => null;
    await runCloudPublisher({ env: { ...ON, CLIPPERS_STREAMER_CLOUD_DESTINATIONS: key }, now: NOW, owner: 'o', store, approvals: approvals({}), metricool: m, stager, fetch: okFetch, ...media });
    assert.deepEqual(stager.removed, ['uncertain', 'scheduled_reference'].includes(scenario) ? [] : [1], scenario);
    assert.equal(store.state.cloudPublish.heldQueue[0].status, 'held_rights');
    assert.equal(m.calls.schedule.length, 0); assert.equal(media.calls.render.length, 0);
    if (!['uncertain', 'scheduled_reference'].includes(scenario)) assert.equal(store.state.cloudPublish.clips[c.id].mediaAsset, null);
    if (scenario === 'uncertain') assert.equal(store.state.cloudPublish.posts[0].status, 'verification_pending');
    if (scenario === 'scheduled_reference') assert.equal(store.state.cloudPublish.posts[0].status, 'scheduled');
  }
});

test('rights: restored permission re-renders removed held media with a fresh queue binding', async () => {
  const c = candidate('restore-public', 'twitch:100', 'thegrefg'), state = baseState([c]);
  const d = DESTINATIONS.find(d => d.network === 'facebook'), key = destinationKey(d);
  state.sourceAuthorizations[c.id].status = 'revoked';
  state.cloudPublish = { version: 1, posts: [], holds: { [key]: { status: 'held_owner_action' } },
    clips: { [c.id]: { status: 'held_owner_action', attempts: 1, mediaAsset: { id: 7, url: 'https://github.com/o/r/releases/download/t/old.mp4' } } },
    heldQueue: [{ id: 'held-old', candidateId: c.id, creatorKey: c.creatorKey, sourceUrl: c.sourceUrl, destination: d, destinationKey: key, caption: c.caption, mediaSha256: 'b'.repeat(64), queuedAt: new Date(NOW).toISOString() }] };
  const store = memoryStore(state), m = fakeMetricool(), stager = fakeStager(), media = fakeMedia();
  const args = { env: { ...ON, CLIPPERS_STREAMER_CLOUD_DESTINATIONS: key }, now: NOW, owner: 'o', store, approvals: approvals({ 'pa-restore-public': 'approved' }), metricool: m, stager, fetch: okFetch, ...media };
  await runCloudPublisher(args); assert.deepEqual(stager.removed, [7]);
  const next = store.state; next.sourceAuthorizations[c.id].status = 'approved'; store.data.set(STREAMER_STATE_NAMESPACE('o'), JSON.stringify(next));
  await runCloudPublisher(args);
  assert.equal(media.calls.render.length, 1); assert.equal(m.calls.schedule.length, 0);
  assert.equal(store.state.cloudPublish.heldQueue.length, 1);
  assert.equal(store.state.cloudPublish.heldQueue[0].mediaSha256, 'a'.repeat(64));
  assert.equal(store.state.cloudPublish.heldQueue[0].status, 'held_owner_action');
  for (let cycle = 0; cycle < 4; cycle++) {
    const revoked = store.state; revoked.sourceAuthorizations[c.id].status = 'revoked'; store.data.set(STREAMER_STATE_NAMESPACE('o'), JSON.stringify(revoked));
    await runCloudPublisher(args);
    const restored = store.state; restored.sourceAuthorizations[c.id].status = 'approved'; store.data.set(STREAMER_STATE_NAMESPACE('o'), JSON.stringify(restored));
    await runCloudPublisher(args);
    assert.equal(store.state.cloudPublish.clips[c.id].attempts, 1, 'preserve the prior budget without spending it on legal holds');
  }
  assert.equal(media.calls.render.length, 5);
});


test('rights: fresh rendering to another account retires the stale rights-held queue instead of reviving its old caption/hash', async () => {
  const c = candidate('new-target', 'twitch:100', 'thegrefg'), state = baseState([c]);
  const fb = DESTINATIONS.find(d => d.network === 'facebook'), fbKey = destinationKey(fb);
  const tt = DESTINATIONS.find(d => d.brandId === 6431685), ttKey = destinationKey(tt);
  state.cloudPublish = { version: 1, posts: [], holds: { [fbKey]: { status: 'held_owner_action' } },
    clips: { [c.id]: { status: 'deferred', reason: 'rights_authorization_inactive', attempts: 0, mediaAsset: null } },
    heldQueue: [{ id: 'held-stale-account', candidateId: c.id, creatorKey: c.creatorKey, sourceUrl: c.sourceUrl, destination: fb, destinationKey: fbKey, caption: c.caption, mediaSha256: 'b'.repeat(64), queuedAt: new Date(NOW).toISOString(), status: 'held_rights' }] };
  const store = memoryStore(state), m = fakeMetricool();
  const args = { env: { ...ON, CLIPPERS_STREAMER_CLOUD_DESTINATIONS: `${ttKey},${fbKey}` }, now: NOW, owner: 'o', store, approvals: approvals({ 'pa-new-target': 'approved' }), metricool: m, stager: fakeStager(), fetch: okFetch, ...fakeMedia() };
  await runCloudPublisher(args);
  assert.equal(m.calls.schedule.length, 1); assert.equal(m.calls.schedule[0].destinationKey, ttKey);
  assert.equal(store.state.cloudPublish.heldQueue.length, 0);
  const next = store.state; next.cloudPublish.holds[fbKey].status = 'cleared'; store.data.set(STREAMER_STATE_NAMESPACE('o'), JSON.stringify(next));
  await runCloudPublisher(args); assert.equal(m.calls.schedule.length, 1, 'no stale second-account write');
});

test('held source: an existing delivery to another destination requires reconciliation, while legacy destination aliases remain permissioned', async () => {
  for (const scenario of ['other_delivery', 'legacy_key']) {
    const c = candidate(`queue-${scenario}`, 'twitch:100', 'thegrefg'), state = baseState([c]);
    const fb = DESTINATIONS.find(d => d.network === 'facebook'), tt = DESTINATIONS.find(d => d.brandId === 6431685);
    const d = scenario === 'other_delivery' ? fb : tt, key = destinationKey(d), url = 'https://github.com/o/r/releases/download/t/queue.mp4';
    state.cloudPublish = { version: 1,
      posts: scenario === 'other_delivery' ? [{ id: 'already', candidateId: c.id, destination: tt, destinationKey: destinationKey(tt), status: 'scheduled', confirmedMediaUrl: url, scheduledAt: new Date(NOW + 2 * 3600000).toISOString() }] : [],
      holds: scenario === 'legacy_key' ? { [key]: { status: 'held_owner_action' } } : {},
      clips: { [c.id]: { status: 'held_owner_action', sourceUrl: c.sourceUrl, creatorKey: c.creatorKey, renderSha256: 'a'.repeat(64), caption: c.caption, hookVariant: 'title', mediaAsset: { id: 1, url } } },
      heldQueue: [{ id: 'queued', candidateId: c.id, creatorKey: c.creatorKey, sourceUrl: c.sourceUrl, destination: d, destinationKey: scenario === 'legacy_key' ? '6431685:tiktok:streamersclips' : key, caption: c.caption, hookVariant: 'title', mediaSha256: 'a'.repeat(64), queuedAt: new Date(NOW).toISOString(), status: 'held_owner_action' }] };
    const store = memoryStore(state), m = fakeMetricool(), stager = fakeStager();
    const { report } = await runCloudPublisher({ env: { ...ON, CLIPPERS_STREAMER_CLOUD_DESTINATIONS: key }, now: NOW, owner: 'o', store, approvals: approvals({}), metricool: m, stager, fetch: okFetch, ...fakeMedia() });
    assert.equal(m.calls.schedule.length, 0); assert.deepEqual(stager.removed, []);
    assert.equal(store.state.cloudPublish.heldQueue[0].status, 'held_owner_action');
    if (scenario === 'other_delivery') assert.ok(report.heldReasons.includes('held_release:other_destination_delivery_requires_reconciliation'));
  }
});


test('rights: failed public-asset removal followed by restoration reuses the verified binding without re-rendering', async () => {
  const c = candidate('remove-error', 'twitch:100', 'thegrefg'), state = baseState([c]);
  const d = DESTINATIONS.find(d => d.network === 'facebook'), key = destinationKey(d);
  state.cloudPublish = { version: 1, posts: [], clips: {}, holds: { [key]: { status: 'held_owner_action' } }, heldQueue: [] };
  const store = memoryStore(state), m = fakeMetricool(), stager = fakeStager(), media = fakeMedia();
  let removalFails = false; const remove = stager.remove; stager.remove = async id => { if (removalFails) throw Error('staging_remove_failed'); return remove(id); };
  const args = { env: { ...ON, CLIPPERS_STREAMER_CLOUD_DESTINATIONS: key }, now: NOW, owner: 'o', store, approvals: approvals({ 'pa-remove-error': 'approved' }), metricool: m, stager, fetch: okFetch, ...media };
  await runCloudPublisher(args); assert.equal(media.calls.render.length, 1);
  const revoked = store.state; revoked.sourceAuthorizations[c.id].status = 'revoked'; store.data.set(STREAMER_STATE_NAMESPACE('o'), JSON.stringify(revoked)); removalFails = true;
  const failed = await runCloudPublisher(args); assert.ok(failed.report.heldReasons.some(e => e.startsWith('media_sweep:')));
  assert.ok(store.state.cloudPublish.clips[c.id].mediaAsset);
  const restored = store.state; restored.sourceAuthorizations[c.id].status = 'approved'; store.data.set(STREAMER_STATE_NAMESPACE('o'), JSON.stringify(restored)); removalFails = false;
  await runCloudPublisher(args);
  assert.equal(media.calls.render.length, 1); assert.equal(stager.uploaded.length, 1);
  assert.equal(store.state.cloudPublish.clips[c.id].status, 'held_owner_action');
  assert.equal(store.state.cloudPublish.clips[c.id].reason, null);
  assert.equal(store.state.cloudPublish.heldQueue[0].mediaSha256, store.state.cloudPublish.clips[c.id].renderSha256);
  const clear = store.state; clear.cloudPublish.holds[key].status = 'cleared'; store.data.set(STREAMER_STATE_NAMESPACE('o'), JSON.stringify(clear));
  await runCloudPublisher(args); assert.equal(m.calls.schedule.length, 1); assert.equal(media.calls.render.length, 1);
  assert.equal(m.calls.schedule[0].mediaSha256, 'a'.repeat(64));
});


test('held media review: conflicting binding metadata survives later passes after its public asset was removed', async () => {
  const c = candidate('binding-review', 'twitch:100', 'thegrefg'), state = baseState([c]);
  const d = DESTINATIONS.find(d => d.network === 'facebook'), key = destinationKey(d);
  state.cloudPublish = { version: 1, posts: [], holds: {},
    clips: { [c.id]: { status: 'held_owner_action', sourceUrl: c.sourceUrl, creatorKey: c.creatorKey, caption: c.caption, hookVariant: 'title', renderSha256: 'b'.repeat(64), mediaAsset: { id: 9, url: 'https://github.com/o/r/releases/download/t/conflicting.mp4' } } },
    heldQueue: [{ id: 'review-binding', candidateId: c.id, creatorKey: c.creatorKey, sourceUrl: c.sourceUrl, destination: d, destinationKey: key, caption: c.caption, hookVariant: 'title', mediaSha256: 'a'.repeat(64), queuedAt: new Date(NOW).toISOString(), status: 'held_owner_action' }] };
  const store = memoryStore(state), m = fakeMetricool(), stager = fakeStager(), media = fakeMedia();
  const args = { env: { ...ON, CLIPPERS_STREAMER_CLOUD_DESTINATIONS: key }, now: NOW, owner: 'o', store, approvals: approvals({}), metricool: m, stager, fetch: okFetch, ...media };
  await runCloudPublisher(args); assert.deepEqual(stager.removed, [9]);
  assert.equal(store.state.cloudPublish.clips[c.id].status, 'held_media_review');
  const before = structuredClone(store.state.cloudPublish.heldQueue);
  await runCloudPublisher(args);
  assert.deepEqual(store.state.cloudPublish.heldQueue, before);
  assert.equal(m.calls.schedule.length, 0); assert.equal(media.calls.render.length, 0);
});


test('held media review cannot be cleared or bypassed by another matching queue entry for the same candidate', async () => {
  const c = candidate('shared-review', 'twitch:100', 'thegrefg'), state = baseState([c]);
  const fb = DESTINATIONS.find(d => d.network === 'facebook'), tt = DESTINATIONS.find(d => d.brandId === 6431685);
  const item = d => ({ id: `q-${d.network}`, candidateId: c.id, creatorKey: c.creatorKey, sourceUrl: c.sourceUrl, destination: d, destinationKey: destinationKey(d), caption: c.caption, hookVariant: 'title', mediaSha256: 'a'.repeat(64), queuedAt: new Date(NOW).toISOString(), status: 'held_rights' });
  state.cloudPublish = { version: 1, posts: [], holds: {}, clips: { [c.id]: { status: 'held_media_review', reason: 'rights_media_binding_unverified', sourceUrl: c.sourceUrl, creatorKey: c.creatorKey, caption: c.caption, hookVariant: 'title', renderSha256: 'a'.repeat(64), mediaAsset: { id: 1, url: 'https://github.com/o/r/releases/download/t/review.mp4' } } }, heldQueue: [item(fb), item(tt)] };
  const store = memoryStore(state), m = fakeMetricool();
  const args = { env: { ...ON, CLIPPERS_STREAMER_CLOUD_DESTINATIONS: `${destinationKey(fb)},${destinationKey(tt)}` }, now: NOW, owner: 'o', store, approvals: approvals({}), metricool: m, stager: fakeStager(), fetch: okFetch, ...fakeMedia() };
  await runCloudPublisher(args); await runCloudPublisher(args);
  assert.equal(store.state.cloudPublish.clips[c.id].status, 'held_media_review');
  assert.equal(store.state.cloudPublish.heldQueue.length, 2); assert.equal(m.calls.schedule.length, 0);
});


test('account quota: five TikTok and five Facebook slots are separate even inside one Metricool brand', async () => {
  const tt = DESTINATIONS.find(d => d.brandId === 6591612 && d.network === 'tiktok');
  const fb = DESTINATIONS.find(d => d.brandId === 6591612 && d.network === 'facebook');
  let rows = [];
  const row = (d, hour, i, extra = {}) => ({ id: `${d.network}-${i}`, uuid: `uuid-${d.network}-${i}`, text: `${d.network} outside writer ${i}`, media: [`https://example.com/${d.network}-${i}.mp4`], draft: false, autoPublish: true, providers: [{ network: d.network, status: 'PENDING' }], publicationDate: { dateTime: `2026-11-22T${hour}:00:00`, timezone: 'America/New_York' }, ...extra });
  const adapter = createPortfolioMetricool({ token: 'fixture-token', userId: 12, fetcher: async resource => {
    const u = new URL(resource); if (u.pathname.endsWith('/simpleProfiles')) return Response.json([{ id: 6591612, canPublish: true, tiktok: tt.account, facebook: fb.account }]);
    return Response.json({ data: rows });
  } });
  const item = { scheduledAt: '2026-11-23T01:00:00.000Z', caption: 'new unique clip', mediaUrl: 'https://example.com/new.mp4', dailyLimit: 5 };
  const five = (d, n = 5) => ['10','12','14','16','18'].slice(0,n).map((h,i) => row(d,h,i));
  rows = [...five(tt), ...five(fb,4)]; await adapter.preflight(fb,item);
  rows = [...five(tt,4), ...five(fb)]; await adapter.preflight(tt,item);
  rows = [...five(tt), ...five(fb)];
  for (const d of [tt,fb]) await assert.rejects(adapter.preflight(d,item), e => e.detail === 'daily_cap' && e.dayRows === 5);
  const draft = row(tt,'18','draft', { draft: true, autoPublish: false });
  rows = [...five(tt,4), draft, ...five(fb)]; await adapter.preflight(tt,item);
  await assert.rejects(adapter.preflight(tt,{ ...item, scheduledAt:'2026-11-22T23:00:00.000Z' }), e => e.detail === 'slot_duplicate');
  await assert.rejects(adapter.preflight(tt,{ ...item, caption:draft.text }), e => e.detail === 'slot_duplicate_content');
  await assert.rejects(adapter.preflight(tt,{ ...item, mediaUrl:draft.media[0] }), e => e.detail === 'slot_duplicate_content');
  for (const mutate of [d => delete d.autoPublish, d => d.providers[0].status = 'PUBLISHING', d => d.providers[0].status = 'AWAITING_CONFIRMATION', d => d.providers[0].status = 'ERROR', d => d.providers[0].status = 'UNKNOWN', d => d.providers.push({network:'tiktok',status:'PUBLISHING'}), d => d.providers[0].publicUrl='https://www.tiktok.com/@news305miami/video/123', d => d.providers[0].publishedAt='2026-11-22T12:00:00Z']) {
    const ambiguous = structuredClone(draft); mutate(ambiguous); rows = [...five(tt,4), ambiguous];
    await assert.rejects(adapter.preflight(tt,item), e => e.detail === 'daily_cap' && e.dayRows === 5);
  }
});

test('planner quota excludes only verified draft receipts while preserving their hours and unknown-send reservations', () => {
  const d = DESTINATIONS[0], key = destinationKey(d), config = { ...cloudPublishConfig(ON), slots:['11:00','13:00','15:00','17:00','19:00'] };
  const posts = ['11','13','15','17'].map((h,i) => ({ destinationKey:key, status:'scheduled', scheduledAt:`2026-11-19T${Number(h)+5}:00:00.000Z`, metricoolId:`active-${i}`, draft:false }));
  const draft = { destinationKey:key, status:'scheduled', scheduledAt:'2026-11-19T23:00:00.000Z', metricoolId:'verified-draft', draft:true };
  assert.equal(nextSlot({now:NOW,config,destination:d,posts:[...posts,draft]}), '2026-11-20T00:00:00.000Z');
  for (const status of ['verification_pending','pending_write']) {
    const at = nextSlot({now:NOW,config,destination:d,posts:[...posts,{...draft,status}]});
    assert.ok(at.startsWith('2026-11-20T16:'), status);
  }
});
