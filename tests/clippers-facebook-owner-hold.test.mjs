// Facebook owner-action hold (Metricool "Confirm your identity" ERROR): hold Facebook, keep TikTok,
// queue Facebook copies locally, resume on owner flag/endpoint or a later PUBLISHED Facebook post.
// Fixtures only: no Metricool write API is ever called (the adapter under test only GETs).
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import express from 'express';
import { buildCreditCaption } from '../shared/clippers-streamer-policy.mjs';
import { STREAMER_STATE_NAMESPACE } from '../script/clippers-streamer-discovery.mjs';
import { createPortfolioMetricool, facebookOwnerActionReason, providerHealthFromRows } from '../script/clippers-portfolio-metricool.mjs';
import { runCloudPublisher, nextHold, HOLD_OWNER_NOTE } from '../script/clippers-streamer-cloud-worker.mjs';
import { applyStreamerOverlay, cloudPublishSummary, registerClippersStreamerRoutes, streamerSelfHealAudits } from '../server/clippers-streamers-status.ts';

const NOW = Date.parse('2026-11-20T14:00:00.000Z'); // 09:00 New York
const FB = { brandId: 6591612, network: 'facebook', account: '1193011863901514' };
const FB_KEY = '6591612:facebook:1193011863901514';
const IDENTITY = 'Confirm your identity before you can publish as this Page. Open the Facebook app on your phone and follow the instructions.';
const ENV = { CLIPPERS_STREAMER_CLOUD_PUBLISH_ENABLED: 'true', METRICOOL_USER_TOKEN: 'metricool-token-123', METRICOOL_USER_ID: '12345',
  CLIPPERS_STREAMER_CLOUD_DESTINATIONS: `6591612:tiktok:news305miami,${FB_KEY}` };

// Fixture: Metricool /api/v2/scheduler/posts rows for brand 6591612 on 2026-11-19 (5 Facebook ERROR, TikTok PUBLISHED).
const errorRow = (i) => ({ id: 9000 + i, blogId: 6591612, text: `fb ${i}`, publicationDate: { dateTime: `2026-11-19T${11 + i}:00:00`, timezone: 'America/New_York' },
  providers: [{ network: 'facebook', status: 'ERROR', detailedStatus: IDENTITY }] });
const tiktokRow = { id: 8000, blogId: 6591612, text: 'tt', publicationDate: { dateTime: '2026-11-19T11:00:00', timezone: 'America/New_York' },
  providers: [{ network: 'tiktok', status: 'PUBLISHED', detailedStatus: 'Published' }] };
const FIXTURE_ERRORS = [...[0, 1, 2, 3, 4].map(errorRow), tiktokRow];
const fbPublishedRow = { id: 9100, blogId: 6591612, text: 'fb ok', publicationDate: { dateTime: '2026-11-20T12:00:00', timezone: 'America/New_York' },
  providers: [{ network: 'facebook', status: 'PUBLISHED', detailedStatus: 'Published' }] };

test('detects identity / checkpoint Facebook errors, ignores ordinary errors', () => {
  assert.equal(facebookOwnerActionReason(IDENTITY), 'facebook_identity_confirmation_required');
  assert.equal(facebookOwnerActionReason('Your account is restricted. Please complete the security check.'), 'facebook_account_action_required');
  assert.equal(facebookOwnerActionReason('Media could not be processed'), null);
  const h = providerHealthFromRows(FIXTURE_ERRORS, FB);
  assert.equal(h.ownerAction.reason, 'facebook_identity_confirmation_required');
  assert.equal(h.ownerAction.at, '2026-11-19T20:00:00.000Z');
  assert.equal(h.published, null, 'TikTok PUBLISHED does not count for Facebook');
});

test('adapter providerHealth only GETs the scheduler (fixture responses)', async () => {
  const calls = [];
  const fetcher = async (url, init = {}) => {
    calls.push({ url: String(url), method: init.method ?? 'GET' });
    const day = new URL(url).searchParams.get('start').slice(0, 10);
    return { ok: true, json: async () => ({ data: day === '2026-11-19' ? FIXTURE_ERRORS : [] }), headers: new Map() };
  };
  const m = createPortfolioMetricool({ token: 'metricool-token-123', userId: '12345', fetcher });
  const h = await m.providerHealth(FB, ['2026-11-19', '2026-11-20']);
  assert.equal(h.ownerAction.reason, 'facebook_identity_confirmation_required');
  assert.ok(calls.every(c => c.method === 'GET' && c.url.includes('/api/v2/scheduler/posts')));
});

test('hold transitions: held, owner resolved, provider published, old error not re-held', () => {
  const held = nextHold(undefined, providerHealthFromRows(FIXTURE_ERRORS, FB), { now: NOW });
  assert.equal(held.change, 'held'); assert.equal(held.hold.status, 'held_owner_action'); assert.equal(held.hold.since, '2026-11-19T20:00:00.000Z');
  assert.equal(nextHold(held.hold, providerHealthFromRows(FIXTURE_ERRORS, FB), { now: NOW }).change, null);
  const owner = nextHold(held.hold, providerHealthFromRows(FIXTURE_ERRORS, FB), { now: NOW, ownerResolvedAt: '2026-11-20T13:00:00.000Z' });
  assert.equal(owner.change, 'cleared'); assert.equal(owner.hold.clearedBy, 'owner_resolved');
  assert.equal(nextHold(owner.hold, providerHealthFromRows(FIXTURE_ERRORS, FB), { now: NOW + 1000 }).change, null, 'the 5 old errors are history');
  const pub = nextHold(held.hold, providerHealthFromRows([...FIXTURE_ERRORS, fbPublishedRow], FB), { now: NOW });
  assert.equal(pub.change, 'cleared'); assert.equal(pub.hold.clearedBy, 'provider_published');
});

function candidate(id) {
  const sourceUrl = `https://clips.twitch.tv/${id}`;
  return { id: `twitch-clip:${id}`, platform: 'twitch', kind: 'clip', creatorKey: 'twitch:100', handle: 'thegrefg', title: 'Locura', sourceUrl, durationSec: 30, views: 9000,
    publishedAt: new Date(NOW - 2 * 3600_000).toISOString(), observedAt: new Date(NOW).toISOString(), score: 4, clipPolicy: { status: 'allowed_unless_prohibited' },
    download: { mode: 'needs_local_download' }, approval: { status: 'approved', pendingActionId: `pa-${id}` },
    caption: buildCreditCaption({ handle: 'thegrefg', platform: 'twitch', sourceUrl, title: 'Locura' }) };
}
const baseState = (cands) => ({ version: 1, updatedAt: null, lastRun: null, takedowns: [], signals: [], candidates: cands,
  creators: { 'twitch:100': { key: 'twitch:100', platform: 'twitch', handle: 'thegrefg', creatorGroupId: null, policy: { status: 'allowed_unless_prohibited', source: 'channel_description_checked' } } } });
function memoryStore(state) {
  const data = new Map([[STREAMER_STATE_NAMESPACE('o'), JSON.stringify(state)]]);
  return { data, get state() { return JSON.parse(data.get(STREAMER_STATE_NAMESPACE('o'))); }, set state(v) { data.set(STREAMER_STATE_NAMESPACE('o'), JSON.stringify(v)); },
    async read(k) { return data.get(k) ?? null; }, async transact(k, fn) { const v = await fn(data.get(k) ?? null); data.set(k, v); return v; } };
}
function fakeMetricool(rows) {
  const calls = { schedule: [], health: 0 };
  return { calls, rows,
    async providerHealth(d) { calls.health++; return providerHealthFromRows(this.rows, d); },
    async preflight() {}, async schedule(d, item) { calls.schedule.push(item); return { id: `mc-${item.id}`, mediaUrl: 'https://static.metricool.com/x.mp4' }; },
    async confirmSchedule(d, item) { return { id: `mc-${item.id}`, mediaUrl: 'https://static.metricool.com/x.mp4' }; },
    async publication() { return null; }, async metrics() { return null; } };
}
const stager = () => { const s = { removed: [], async upload(f, name) { return { id: 1, url: `https://github.com/o/r/releases/download/t/${name}`, createdAt: new Date(NOW).toISOString() }; }, async remove(id) { s.removed.push(id); return true; }, async sweep() { return 0; } }; return s; };
const media = { download: async () => ({ file: '/tmp/x/s.mp4', cut: { start: 0, duration: 30, source: 'full_clip' } }),
  render: async () => ({ file: '/tmp/x/r.mp4', sha256: 'a'.repeat(64), durationSec: 30, sizeBytes: 1000 }), makeDir: async () => mkdtemp(path.join(tmpdir(), 'fbhold-')) };
const okFetch = async () => ({ status: 206, ok: true });
const approvals = { async statuses(o, ids) { return new Map(ids.map(i => [i, 'approved'])); }, async markExecuted() {} };

test('while held: TikTok publishes, Facebook copy queued (not sent, not counted), failed posts untouched; resumes gradually', async () => {
  const store = memoryStore(baseState([candidate('a'), candidate('b')]));
  const m = fakeMetricool(FIXTURE_ERRORS), st = stager();
  const run = (env = ENV, now = NOW) => runCloudPublisher({ env, now, owner: 'o', store, approvals, metricool: m, stager: st, fetch: okFetch, ...media, clock: () => now });
  const { report } = await run();
  assert.deepEqual(m.calls.schedule.map(i => i.destinationKey), ['6591612:tiktok:news305miami', '6591612:tiktok:news305miami']);
  assert.ok(m.calls.schedule.every(i => i.destination.network === 'tiktok'), 'no Facebook provider while held');
  assert.equal(report.counts.heldQueued, 2); assert.equal(report.counts.scheduled, 2);
  assert.equal(report.ownerHolds[0].destination, FB_KEY); assert.equal(report.ownerHolds[0].note, HOLD_OWNER_NOTE);
  assert.ok(!report.heldReasons.some(r => r.includes('facebook')), 'hold is an owner note, not a failure reason');
  let c = store.state.cloudPublish;
  assert.equal(c.holds[FB_KEY].status, 'held_owner_action');
  assert.equal(c.heldQueue.length, 2);
  assert.ok(!c.posts.some(p => p.destination.network === 'facebook'), 'Facebook never counted as published');
  assert.ok(c.clips['twitch-clip:a'].mediaAsset, 'media kept for the queued Facebook copy');
  assert.equal(st.removed.length, 0);

  // Office: owner note on the Streamers role, no failure, no self-heal order.
  const role = (stage) => ({ id: `clippers-${stage}`, stage, state: 'idle', evidenceAt: null, activeUntil: null, lastRunAt: null, heartbeatAt: null, nextDueAt: null, runId: null, evidenceIds: [], outputs: {}, heldReasons: [], lifePenaltyExempt: false, career: {} });
  const office = { roles: ['supervisor', 'streamers'].map(role) };
  store.state = { ...store.state, lastRun: { at: new Date(NOW).toISOString(), status: 'completed', heldReasons: [], errors: [], counts: {} } };
  applyStreamerOverlay(office, store.data.get(STREAMER_STATE_NAMESPACE('o')), NOW + 60_000);
  const r = office.roles.find(x => x.stage === 'streamers');
  assert.deepEqual(r.ownerNotes, ['Facebook pide verificar identidad en la app']);
  assert.equal(r.state, 'completed');
  assert.deepEqual(streamerSelfHealAudits(store.data.get(STREAMER_STATE_NAMESPACE('o')))[0].findings, []);
  assert.equal(cloudPublishSummary(c).ownerHolds[0].queued, 2);

  // Still held next run: nothing for Facebook is sent, failed posts are never retried.
  await run(ENV, NOW + 3600_000);
  assert.ok(m.calls.schedule.every(i => i.destination.network === 'tiktok'));

  // Owner flag clears the hold; queued copies are released one per run.
  const resolved = { ...ENV, CLIPPERS_FACEBOOK_HOLD_RESOLVED_AT: '2026-11-20T15:30:00Z' };
  const r1 = await run(resolved, NOW + 2 * 3600_000);
  assert.equal(r1.report.counts.heldReleased, 1);
  c = store.state.cloudPublish;
  assert.equal(c.holds[FB_KEY].status, 'active'); assert.equal(c.holds[FB_KEY].clearedBy, 'owner_resolved');
  assert.equal(c.heldQueue.length, 1);
  const fbPosts = m.calls.schedule.filter(i => i.destination.network === 'facebook');
  assert.equal(fbPosts.length, 1);
  assert.ok(!fbPosts.some(i => i.metricoolId), 'a new post, not a retry of the ERROR ones');
  const r2 = await run(resolved, NOW + 3 * 3600_000);
  assert.equal(r2.report.counts.heldReleased, 1);
  assert.equal(store.state.cloudPublish.heldQueue.length, 0);
  const slots = m.calls.schedule.filter(i => i.destination.network === 'facebook').map(i => i.scheduledAt);
  assert.equal(slots.length, 2); assert.notEqual(slots[0], slots[1]);
});

test('hold clears automatically when a later Facebook post shows PUBLISHED', async () => {
  const store = memoryStore(baseState([]));
  const m = fakeMetricool(FIXTURE_ERRORS);
  const run = (now) => runCloudPublisher({ env: ENV, now, owner: 'o', store, approvals, metricool: m, stager: stager(), fetch: okFetch, ...media, clock: () => now });
  await run(NOW);
  assert.equal(store.state.cloudPublish.holds[FB_KEY].status, 'held_owner_action');
  m.rows = [...FIXTURE_ERRORS, fbPublishedRow];
  const { report } = await run(NOW + 3 * 3600_000);
  assert.equal(store.state.cloudPublish.holds[FB_KEY].clearedBy, 'provider_published');
  assert.deepEqual(report.ownerHolds, []);
});

test('owner-only endpoint marks the hold resolved', async () => {
  const state = baseState([]);
  state.cloudPublish = { version: 1, clips: {}, posts: [], learning: null, lastRun: null, heldQueue: [], holds: { [FB_KEY]: { status: 'held_owner_action', reason: 'facebook_identity_confirmation_required', since: '2026-11-19T20:00:00.000Z' } } };
  const store = memoryStore(state);
  let owner = false;
  const app = express(); app.use(express.json());
  registerClippersStreamerRoutes(app, { isOwner: () => owner, store: async () => store, owner: () => 'o', now: () => NOW });
  const server = app.listen(0); const port = server.address().port;
  try {
    const post = (body) => fetch(`http://127.0.0.1:${port}/api/clippers/streamers/holds/resolved`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    assert.equal((await post({ destination: FB_KEY })).status, 403);
    owner = true;
    assert.equal((await post({ destination: 'x' })).status, 400);
    assert.equal((await post({ destination: FB_KEY })).status, 200);
    assert.equal(store.state.cloudPublish.holds[FB_KEY].ownerResolvedAt, new Date(NOW).toISOString());
  } finally { server.close(); }
});
