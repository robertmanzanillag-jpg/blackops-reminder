import test from 'node:test';
import assert from 'node:assert/strict';
import { seriesKeyOf, seriesDailyQuota, fairSlotDecision, planFairDay, STREAMER_SERIES } from '../shared/clippers-fair-queue.mjs';

const sdo = n => ({ text: `Serie educativa ${n}: el Sol visto por SDO\nTextos explicativos de Clippers` });

test('series keys group the SDO batch and streamer clips', () => {
  assert.equal(seriesKeyOf(sdo(1).text), 'serie_educativa');
  assert.equal(seriesKeyOf('Clip de @x\nhttps://www.twitch.tv/x/clip/abc'), STREAMER_SERIES);
  assert.equal(seriesDailyQuota(5), 3);
});

test('a day filled by one series reports the monopoly; streamer gets no slot but nothing is removed', () => {
  const rows = [1, 2, 3, 4, 5].map(sdo);
  const d = fairSlotDecision({ rows, cap: 5, series: STREAMER_SERIES });
  assert.equal(d.ok, false);
  assert.equal(d.reason, 'series_monopoly:serie_educativa');
  assert.equal(rows.length, 5);
});

test('a series is capped at its daily quota so the mix keeps room', () => {
  const rows = [1, 2, 3].map(sdo);
  assert.equal(fairSlotDecision({ rows, cap: 5, series: 'serie_educativa' }).ok, true); // alone: never leave slots empty
  assert.equal(fairSlotDecision({ rows: [...rows, { text: 'c https://www.twitch.tv/a/clip/9' }], cap: 5, series: 'serie_educativa' }).reason, 'series_quota');
  assert.equal(fairSlotDecision({ rows, cap: 5, series: STREAMER_SERIES }).ok, true);
  const mixed = [...rows.slice(0, 1), { text: 'x https://www.twitch.tv/a/clip/1' }, { text: 'y https://www.twitch.tv/a/clip/2' }, { text: 'z https://kick.com/a?clip=3' }];
  assert.equal(fairSlotDecision({ rows: mixed, cap: 5, series: STREAMER_SERIES }).reason, 'series_quota');
  assert.equal(fairSlotDecision({ rows: mixed.slice(1), cap: 5, series: STREAMER_SERIES }).ok, true);
});

test('planFairDay prefers best series first and mixes', () => {
  const candidates = [
    ...[1, 2, 3, 4, 5].map(i => ({ id: `s${i}`, series: 'serie_educativa', score: 100 - i })),
    ...[1, 2, 3].map(i => ({ id: `c${i}`, series: STREAMER_SERIES, score: 50 - i })),
  ];
  const { picked } = planFairDay({ candidates, cap: 5 });
  assert.deepEqual(picked, ['s1', 'c1', 's2', 'c2', 's3']);
});

test('brand observation measures every published post on the account, including the SDO series', async () => {
  const { observeBrandPosts } = await import('../script/clippers-streamer-cloud-worker.mjs');
  const d = { brandId: 6591612, network: 'tiktok', account: 'news305miami' };
  const metricool = { accountAnalytics: async () => ({ posts: [
    { id: '7711769662740122911', publishedAt: '2026-11-24T16:00:00.000Z', observedAt: '2026-11-26T16:00:00.000Z', views: 120, text: 'Serie educativa: manchas solares (SDO)' },
    { id: '7712635025379970335', publishedAt: '2026-11-25T16:00:00.000Z', observedAt: '2026-11-26T16:00:00.000Z', views: 80, text: 'Serie educativa: erupciones' },
  ] }) };
  const report = { counts: {}, heldReasons: [] };
  const r = await observeBrandPosts({ metricool, destinations: [d], now: Date.parse('2026-11-26T16:00:00Z'), report });
  assert.equal(report.counts.observedBrand, 2);
  assert.equal(r.byId.get('6591612:tiktok:news305miami:7711769662740122911').views, 120);
  assert.deepEqual(r.series['6591612:tiktok:news305miami'].serie_educativa, { posts: 2, medianViews: 100 });
});
