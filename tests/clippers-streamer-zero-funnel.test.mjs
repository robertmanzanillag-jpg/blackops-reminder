import test from 'node:test';
import assert from 'node:assert/strict';
import { queueFunnel, funnelSummary, cloudPublishConfig } from '../script/clippers-streamer-cloud-worker.mjs';
import { applyDiscovery, approvalEligibility, retentionTier, streamerConfig } from '../script/clippers-streamer-discovery.mjs';

const NOW = Date.parse('2026-11-25T15:00:00.000Z');
const H = 3600_000;
const cand = (id, extra = {}) => ({ id, platform: 'twitch', kind: 'clip', creatorKey: 'twitch:1', handle: 'h', title: 't', sourceUrl: `https://clips.twitch.tv/${id}`,
  durationSec: 30, views: 10, publishedAt: new Date(NOW - 2 * H).toISOString(), observedAt: new Date(NOW).toISOString(), score: 1,
  clipPolicy: { status: 'allowed_unless_prohibited' }, download: { mode: 'needs_local_download' }, approval: { status: 'approved', pendingActionId: `pa-${id}` }, ...extra });
const creators = { 'twitch:1': { key: 'twitch:1', policy: { status: 'allowed_unless_prohibited', source: 'channel_description_checked' } } };

test('queue funnel puts every candidate in exactly one bucket and explains a zero queue', () => {
  const state = { candidates: [cand('a'), cand('b', { publishedAt: new Date(NOW - 100 * H).toISOString() }), cand('c', { approval: { status: 'pending' } }),
    cand('d', { platform: 'youtube' }), cand('e')], creators, takedowns: [] };
  const ledger = { clips: { e: { status: 'language_not_served' } }, posts: [] };
  const config = { ...cloudPublishConfig({ CLIPPERS_STREAMER_CLOUD_PUBLISH_ENABLED: 'true', CLIPPERS_STREAMER_LANES_ENABLED: 'false' }) };
  const f = queueFunnel(state, ledger, config, NOW);
  assert.equal(f.candidates, 5);
  assert.equal(f.eligible, 1);
  assert.deepEqual(f.dropped, { source_too_old: 1, approval_pending: 1, 'platform_not_served:youtube': 1, already_language_not_served: 1 });
  const line = funnelSummary({ status: 'completed', funnel: f, heldReasons: ['lane_unrouted:language_unknown'], counts: { rendered: 0, scheduled: 0 } });
  assert.match(line, /candidates=5 -> dropped\[.*source_too_old=1.*\] -> eligible=1 -> rendered=0 -> scheduled=0 \(held: lane_unrouted:language_unknown/);
  assert.doesNotMatch(line, /https?:/);
  assert.match(funnelSummary({ status: 'skipped_recent_run', counts: { rendered: 0, scheduled: 0 } }), /status=skipped_recent_run \(no queue evaluated\)/);
});

test('retention keeps fresh Twitch clips ahead of stale high-score rows at the 200 cap', () => {
  const stale = Array.from({ length: 200 }, (_, i) => cand(`old${i}`, { platform: 'youtube', score: 9, approval: { status: 'not_requested' },
    publishedAt: new Date(NOW - 120 * H).toISOString() }));
  const state = { candidates: stale, creators: { ...creators }, takedowns: [], signals: [] };
  const twitch = { creators: [], streams: [], clips: [{ id: 'twitch-clip:new', platform: 'twitch', kind: 'clip', creatorKey: 'twitch:1', handle: 'h', title: 't',
    sourceUrl: 'https://clips.twitch.tv/new', durationSec: 30, views: 5, publishedAt: new Date(NOW - H).toISOString(), observedAt: new Date(NOW).toISOString() }] };
  const config = streamerConfig({ CLIPPERS_STREAMER_CLOUD_PUBLISH_ENABLED: 'true' });
  const next = applyDiscovery(state, { now: NOW, twitch, youtube: null, config });
  assert.equal(next.candidates.length, 200);
  assert.ok(next.candidates.some(c => c.id === 'twitch-clip:new'), 'fresh twitch clip must survive the cap');
  assert.equal(retentionTier({ approval: { status: 'pending' }, publishedAt: new Date(NOW - H).toISOString() }, NOW), 0);
  assert.equal(retentionTier({ approval: { status: 'pending' }, publishedAt: new Date(NOW - 200 * H).toISOString() }, NOW), 2);
  const elig = approvalEligibility(next, config);
  assert.equal(elig['platform_not_served:youtube'], 199);
  assert.equal(elig.creator_policy_unchecked ?? 0, 0);
  assert.equal(elig.eligible, 1);
});

test('approval gates stay intact: unchecked creator and over-length clips are never eligible', () => {
  const config = streamerConfig({ CLIPPERS_STREAMER_CLOUD_PUBLISH_ENABLED: 'true' });
  const state = { creators: { ...creators, 'twitch:9': { key: 'twitch:9', policy: { status: 'allowed_unless_prohibited', source: 'not_checked' } } }, takedowns: [],
    candidates: [cand('x', { creatorKey: 'twitch:9', approval: { status: 'not_requested' } }), cand('y', { durationSec: 600, approval: { status: 'not_requested' } })] };
  assert.deepEqual(approvalEligibility(state, config), { creator_policy_unchecked: 1, clip_too_long: 1 });
});
