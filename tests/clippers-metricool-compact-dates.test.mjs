import test from 'node:test';
import assert from 'node:assert/strict';
import { analyticsTimestamp, createPortfolioMetricool } from '../script/clippers-portfolio-metricool.mjs';

test('analyticsTimestamp parses compact, ISO, epoch and object forms', () => {
  assert.equal(analyticsTimestamp('20261126000206'), '2026-11-26T00:02:06.000Z');
  assert.equal(analyticsTimestamp(20261126000206), '2026-11-26T00:02:06.000Z');
  assert.equal(analyticsTimestamp('202611260002'), '2026-11-26T00:02:00.000Z');
  assert.equal(analyticsTimestamp('2026-11-26T00:02:06Z'), '2026-11-26T00:02:06.000Z');
  assert.equal(analyticsTimestamp('2026-11-26T00:02:06'), '2026-11-26T00:02:06.000Z');
  assert.equal(analyticsTimestamp(1795651326), new Date(1795651326000).toISOString());
  assert.equal(analyticsTimestamp('1795651326000'), new Date(1795651326000).toISOString());
  assert.equal(analyticsTimestamp({ dateTime: '2026-11-26T00:02:06', timezone: 'UTC' }), '2026-11-26T00:02:06.000Z');
  assert.equal(analyticsTimestamp('20261332000000'), null);
  assert.equal(analyticsTimestamp('garbage'), null);
});

test('accountAnalytics keeps @news305miami TikTok rows with compact dates', async () => {
  const rows = [
    { videoId: '7711769662740122911', publicUrl: 'https://www.tiktok.com/@news305miami/video/7711769662740122911', created: '20261126000206', createTime: '20261126000206', updatedAt: '20261126120000', views: 812, likes: 40, text: 'Clip uno' },
    { videoId: '7712635025379970335', createTime: 20261124183011, views: 95, text: 'Clip dos' },
  ];
  const fetcher = async url => {
    const u = String(url);
    const body = u.includes('simpleProfiles') ? [{ id: 6591612, isShared: false, ownerUserId: '1', tiktokUsername: 'news305miami' }] : u.includes('/analytics/posts/tiktok') ? { data: rows } : [];
    return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  const m = createPortfolioMetricool({ token: 'token-123456789', userId: '1', env: {}, fetcher });
  const r = await m.accountAnalytics({ brandId: 6591612, network: 'tiktok', account: 'news305miami' }, new Date('2026-11-26T15:00:00Z'));
  assert.equal(r.receivedRows, 2);
  assert.deepEqual(r.posts.map(p => p.id), ['7711769662740122911', '7712635025379970335']);
  assert.equal(r.posts[0].publishedAt, '2026-11-26T00:02:06.000Z');
  assert.equal(r.posts[0].observedAt, '2026-11-26T12:00:00.000Z');
});
