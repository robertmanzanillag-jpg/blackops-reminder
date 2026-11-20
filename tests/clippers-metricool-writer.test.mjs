import assert from 'node:assert/strict';
import test from 'node:test';
import { metricoolWriteRefusal, cloudOwnedBrands, isCloudRuntime, MAC_WRITE_REFUSED, DEFAULT_CLOUD_OWNED_BRANDS } from '../shared/clippers-metricool-writer.mjs';
import { createPortfolioMetricool } from '../script/clippers-portfolio-metricool.mjs';
import { createMacLedgerGuard } from '../script/clippers-mac-ledger-guard.mjs';
import { buildPublicationSchedule, marketplaceLaneQuota } from '../script/clippers-metricool-autopilot.mjs';

const MEMES = { brandId: 6431685, network: 'tiktok', account: 'streamersus' };

test('Mac (no Actions env) is refused on every cloud-owned brand by default, cloud is allowed', () => {
  assert.deepEqual([...cloudOwnedBrands({})].sort(), [...DEFAULT_CLOUD_OWNED_BRANDS].sort());
  for (const id of [6431685, 6431687, 6591612, 6595747]) {
    assert.equal(metricoolWriteRefusal(id, {}), MAC_WRITE_REFUSED);
    assert.equal(metricoolWriteRefusal(id, { GITHUB_ACTIONS: 'true' }), null);
    assert.equal(metricoolWriteRefusal(id, { CLIPPERS_RUNTIME: 'cloud' }), null);
  }
  assert.equal(isCloudRuntime({ GITHUB_ACTIONS: 'false' }), false);
  assert.equal(metricoolWriteRefusal(undefined, {}), MAC_WRITE_REFUSED, 'unknown brand fails closed');
  assert.equal(metricoolWriteRefusal(1234, {}), null, 'non-Clippers brand untouched');
  assert.equal(metricoolWriteRefusal(6431685, { CLIPPERS_MAC_METRICOOL_WRITES: 'owner_override' }), null);
  assert.equal(metricoolWriteRefusal(6431685, { CLIPPERS_CLOUD_OWNED_BRANDS: 'none' }), null);
  assert.equal(metricoolWriteRefusal(6431687, { CLIPPERS_CLOUD_OWNED_BRANDS: '6431685' }), null);
  assert.equal(metricoolWriteRefusal(6431685, { CLIPPERS_CLOUD_OWNED_BRANDS: 'garbage' }), MAC_WRITE_REFUSED, 'bad list keeps default');
});

test('portfolio adapter schedule() on the Mac never reaches Metricool (drafts included)', async () => {
  let calls = 0;
  const adapter = createPortfolioMetricool({ token: 'token-123456789', userId: '3558197', env: {}, fetcher: async () => { calls++; throw new Error('network'); } });
  await assert.rejects(adapter.schedule(MEMES, { id: 'x', draft: true, caption: 'c', mediaUrl: 'https://x/y.mp4', scheduledAt: '2026-11-19T16:00:00.000Z' }), new RegExp(MAC_WRITE_REFUSED));
  assert.equal(calls, 0);
});

test('Mac ledger guard refuses cloud-owned brands before any ledger or calendar I/O', async () => {
  let calendar = 0;
  const guard = createMacLedgerGuard({ env: {}, workspaceRoot: '/nonexistent-clippers', metricool: { crossAccountPreflight: async () => { calendar++; return { ok: true }; } } });
  const r = await guard.reserve(MEMES, { id: 'a', sourceUrl: 'https://youtu.be/aaaaaaaaaaa', mediaSha256: 'a'.repeat(64), caption: 'the clip of the day and the best' });
  assert.equal(r.ok, false);
  assert.equal(r.reason, MAC_WRITE_REFUSED);
  assert.equal(calendar, 0);
});

test('marketplace lane quota: never fills the brand day, shares the cap of 5 with other writers', () => {
  assert.equal(marketplaceLaneQuota({}), 2);
  assert.equal(marketplaceLaneQuota({ CLIPPERS_MARKETPLACE_LANE_DAILY_QUOTA: '3' }), 3);
  assert.equal(marketplaceLaneQuota({ CLIPPERS_MARKETPLACE_LANE_DAILY_QUOTA: '9' }), 2);
  const now = new Date('2026-11-20T05:00:00.000Z');
  const rows = buildPublicationSchedule(now, 5, { dailyLimit: 5, laneDailyQuota: 2 });
  const perDay = rows.reduce((m, r) => m.set(r.slice(0, 10), (m.get(r.slice(0, 10)) || 0) + 1), new Map());
  assert.ok([...perDay.values()].every(n => n <= 2));
  // Streamer publisher already holds 4 posts today -> this lane gets 1 today, rest spills to later days.
  const shared = buildPublicationSchedule(now, 2, { dailyLimit: 5, laneDailyQuota: 2, existingDailyCounts: { '2026-11-20': 4 } });
  assert.equal(shared.filter(r => r.startsWith('2026-11-20')).length, 1);
  assert.deepEqual(buildPublicationSchedule(now, 3, { dailyLimit: 5, laneDailyQuota: 0 }), [], 'quota 0 terminates');
});
