import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, realpath, rm, stat, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  DISCOVERY_CREATORS, feedUrl, assertFeedUrl, parseYouTubeFeed, fetchYouTubeFeed,
  selectCreators, classifyDiscovery, runPortfolioDiscovery,
} from '../script/clippers-portfolio-discovery.mjs';

const creator = DISCOVERY_CREATORS[0];
const NOW = new Date('2026-11-18T10:00:00Z');
const entry = ({ id = 'abcdefghijk', at = '2026-11-18T09:00:00Z', title = 'Gaming &amp; GTA VI', views = '40', channelId = creator.channelId } = {}) =>
  `<entry><yt:videoId>${id}</yt:videoId><yt:channelId>${channelId}</yt:channelId><title>${title}</title><published>${at}</published>${views === null ? '' : `<media:group><media:community><media:statistics views="${views}"/></media:community></media:group>`}</entry>`;
const feed = (entries = entry(), channelId = creator.channelId) =>
  `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom" xmlns:yt="http://www.youtube.com/xml/schemas/2015" xmlns:media="http://search.yahoo.com/mrss/"><yt:channelId>${channelId.slice(2)}</yt:channelId><title>Example official feed</title><author><uri>https://www.youtube.com/channel/${channelId}</uri></author>${entries}</feed>`;
const response = (xml = feed(), init = {}) => new Response(xml, { status: 200, headers: { 'Content-Type': 'application/atom+xml; charset=UTF-8' }, ...init });

test('fixed catalogue covers requested creators and languages without caller URL overrides', () => {
  assert.equal(DISCOVERY_CREATORS.length, 8);
  for (const id of ['thegrefg', 'vegetta777', 'rubius', 'lacy']) assert.ok(DISCOVERY_CREATORS.some(row => row.id === id));
  assert.deepEqual([...new Set(DISCOVERY_CREATORS.map(row => row.language))].sort(), ['de', 'en', 'es', 'fr', 'ja', 'pt-BR']);
  const day1 = selectCreators(NOW), day2 = selectCreators(new Date(+NOW + 86_400_000));
  assert.equal(day1.length, 4); assert.equal(day2.length, 4);
  assert.equal(new Set([...day1, ...day2].map(row => row.id)).size, 8);
  assert.throws(() => selectCreators(NOW, ['lacy', 'lacy']), /unique/);
  assert.throws(() => selectCreators(NOW, ['unknown']), /catalogue/);
  assert.throws(() => selectCreators(NOW, DISCOVERY_CREATORS.slice(0, 5).map(row => row.id)), /four/);
});

test('feed transport rejects SSRF, credentials, ports, encoded paths, query pollution and aliases', () => {
  assert.equal(assertFeedUrl(feedUrl(creator.channelId)), feedUrl(creator.channelId));
  for (const url of [
    'http://www.youtube.com/feeds/videos.xml?channel_id=' + creator.channelId,
    'https://127.0.0.1/feeds/videos.xml?channel_id=' + creator.channelId,
    'https://www.youtube.com.evil.test/feeds/videos.xml?channel_id=' + creator.channelId,
    'https://user:secret@www.youtube.com/feeds/videos.xml?channel_id=' + creator.channelId,
    'https://www.youtube.com:444/feeds/videos.xml?channel_id=' + creator.channelId,
    'https://www.youtube.com/%66eeds/videos.xml?channel_id=' + creator.channelId,
    feedUrl(creator.channelId) + '&url=http://localhost', feedUrl(creator.channelId) + '&channel_id=' + creator.channelId,
    feedUrl(creator.channelId) + '#x',
    feedUrl(creator.channelId) + '#',
  ]) assert.throws(() => assertFeedUrl(url));
});

test('direct feed retains exact identity, source timestamp and actual views but grants no rights', () => {
  const { observations, rejected } = parseYouTubeFeed(feed(), creator, NOW.toISOString());
  assert.equal(rejected.length, 0);
  assert.equal(observations[0].channelId, creator.channelId);
  assert.equal(observations[0].videoId, 'abcdefghijk');
  assert.equal(observations[0].publishedAt, '2026-11-18T09:00:00.000Z');
  assert.equal(observations[0].observedAt, NOW.toISOString());
  assert.equal(observations[0].views, 40);
  assert.equal(observations[0].title, 'Gaming & GTA VI');
  assert.equal(observations[0].topicHint, 'gta');
  assert.equal(observations[0].permission, 'unknown');
  assert.equal(observations[0].mayPublish, false);
  assert.equal(observations[0].language, null); // A creator's usual language cannot prove this video's language.
  assert.equal(observations[0].format, 'unknown');
});

test('missing/non-numeric views remain unknown instead of zero or a fabricated estimate', () => {
  for (const views of [null, 'unknown', '9999999999999999999999999999999']) {
    const row = parseYouTubeFeed(feed(entry({ views })), creator, NOW.toISOString()).observations[0];
    assert.equal(row.views, null);
    assert.equal(classifyDiscovery(row, []).status, 'views_unknown');
  }
});

test('stale dates remain historical and future timestamps are held, not rewritten to now', () => {
  const old = entry({ at: '2026-11-14T09:00:00Z' });
  const future = entry({ id: 'bcdefghijkl', at: '2026-11-19T09:00:00Z' });
  const result = parseYouTubeFeed(feed(old + future), creator, NOW.toISOString());
  assert.equal(result.observations[0].freshness, 'stale');
  assert.equal(result.observations[0].publishedAt, '2026-11-14T09:00:00.000Z');
  assert.deepEqual(result.rejected, [{ videoId: 'bcdefghijkl', reason: 'future_published_at' }]);
});

test('rejects DTD/entities, CDATA, oversized/partial XML, duplicate entries and mismatched source identity', () => {
  const bad = [
    '<!DOCTYPE feed [<!ENTITY x SYSTEM "file:///etc/passwd">]>' + feed(),
    feed(entry({ title: '&secret;' })), feed(entry({ title: '<![CDATA[text]]>' })),
    feed(entry() + entry()), feed(entry(), DISCOVERY_CREATORS[1].channelId),
    feed(entry({ channelId: DISCOVERY_CREATORS[1].channelId })), feed().replace('</entry>', ''),
    feed().replace(`<uri>https://www.youtube.com/channel/${creator.channelId}</uri>`, '<uri>https://www.youtube.com/channel/other</uri>'),
    feed(' '.repeat(262_145)),
  ];
  for (const xml of bad) assert.throws(() => parseYouTubeFeed(xml, creator, NOW.toISOString()));
});

test('transport uses public GET without redirects/auth and bounds response size/content type', async () => {
  let actual;
  await fetchYouTubeFeed(creator, { now: NOW, fetchImpl: async (url, options) => { actual = { url, options }; return response(); } });
  assert.equal(actual.options.method, 'GET'); assert.equal(actual.options.redirect, 'error');
  assert.equal(actual.options.credentials, 'omit'); assert.equal(actual.options.headers.Authorization, undefined);
  for (const result of [response('html', { headers: { 'Content-Type': 'text/html' } }), response('x'.repeat(262_145)),
    { ...response(), status: 200, redirected: true }, response('', { status: 429 })]) {
    await assert.rejects(fetchYouTubeFeed(creator, { now: NOW, fetchImpl: async () => result }));
  }
});

test('velocity requires two actual same-video snapshots at least one hour apart and excludes future/decreased values', () => {
  const row = parseYouTubeFeed(feed(), creator, NOW.toISOString()).observations[0];
  const earlier = { ...row, observedAt: '2026-11-18T09:00:00Z', views: 10 };
  assert.equal(classifyDiscovery(row, [earlier]).viewsPerHour, 30);
  assert.equal(classifyDiscovery(row, [{ ...earlier, observedAt: '2026-11-18T09:30:00Z' }]).viewsPerHour, null);
  assert.equal(classifyDiscovery(row, [{ ...earlier, observedAt: '2026-11-19T09:00:00Z' }]).viewsPerHour, null);
  assert.equal(classifyDiscovery(row, [{ ...earlier, views: 41 }]).viewsPerHour, null);
  const resetRow = { ...row, publishedAt: '2026-11-18T07:00:00Z' };
  assert.equal(classifyDiscovery(resetRow, [
    { ...earlier, publishedAt: resetRow.publishedAt, observedAt: '2026-11-18T08:00:00Z', views: 5 },
    { ...earlier, publishedAt: resetRow.publishedAt, views: 41 },
  ]).viewsPerHour, null);
  assert.equal(classifyDiscovery(row, [{ ...earlier, metricEvidence: 'reported_only' }]).viewsPerHour, null);
  assert.equal(classifyDiscovery(row, [{ ...earlier, publishedAt: '2026-11-17T09:00:00Z' }]).viewsPerHour, null);
});

test('comparison requires five unique videos from same channel, language, format and observation age', () => {
  const row = { ...parseYouTubeFeed(feed(), creator, NOW.toISOString()).observations[0], language: 'es', format: 'long_form' };
  const baseline = Array.from({ length: 5 }, (_, i) => ({ ...row, videoId: `baseline00${i}`, views: 10 }));
  assert.equal(classifyDiscovery(row, baseline).outlierRatio, 4);
  assert.equal(classifyDiscovery(row, [...baseline.slice(0, 4), baseline[0]]).outlierRatio, null);
  for (const delta of [{ channelId: 'other' }, { language: 'en' }, { format: 'short' }, { publishedAt: '2026-11-18T06:00:00Z' }]) {
    assert.equal(classifyDiscovery(row, baseline.map(item => ({ ...item, ...delta }))).outlierRatio, null);
  }
  assert.equal(classifyDiscovery({ ...row, format: 'unknown' }, baseline).status, 'comparison_context_unknown');
  assert.equal(classifyDiscovery(row, baseline.map(item => ({ ...item, publishedAt: '2026-11-19T09:00:00Z' }))).outlierRatio, null);
});

test('daily receipt is private, durable and idempotent; incomplete feeds persist truthful status with zero eligible assets', async () => {
  const dir = await realpath(await mkdtemp(path.join(os.tmpdir(), 'portfolio-discovery-')));
  let calls = 0;
  const fetchImpl = async () => { calls++; return response(); };
  try {
    const first = await runPortfolioDiscovery({ stateDir: dir, now: NOW, creatorIds: [creator.id], fetchImpl });
    assert.equal(first.observations.length, 1); assert.equal(calls, 1);
    assert.equal(first.eligibleAssets, 0); assert.equal(first.mayPublish, false);
    assert.equal((await stat(first.receiptFile)).mode & 0o777, 0o600);
    assert.equal(JSON.parse(await readFile(first.receiptFile, 'utf8')).observations[0].views, 40);
    const replay = await runPortfolioDiscovery({ stateDir: dir, now: NOW, creatorIds: [creator.id], fetchImpl });
    assert.equal(replay.reused, true); assert.equal(replay.networkRequestsThisInvocation, 0); assert.equal(calls, 1);
    const original = await readFile(first.receiptFile, 'utf8');
    await writeFile(first.receiptFile, JSON.stringify({ ...JSON.parse(original), permission: 'approved', mayPublish: true }));
    await assert.rejects(runPortfolioDiscovery({ stateDir: dir, now: NOW, creatorIds: [creator.id], fetchImpl }), /invalid_discovery_receipt/);
    assert.equal(calls, 1);
    await writeFile(first.receiptFile, original);
    const next = await runPortfolioDiscovery({ stateDir: dir, now: new Date(+NOW + 86_400_000), creatorIds: [creator.id],
      fetchImpl: async () => response('', { status: 429 }) });
    assert.equal(next.feeds[0].status, 'unavailable'); assert.equal(next.feeds[0].reason, 'feed_throttled');
    assert.equal(next.observations.length, 0); assert.equal(next.eligibleAssets, 0);
    assert.equal((await readdir(dir)).filter(name => name.endsWith('.json')).length, 2);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('symlink storage roots cannot redirect receipts into another workspace', async () => {
  const dir = await realpath(await mkdtemp(path.join(os.tmpdir(), 'portfolio-discovery-')));
  try {
    await mkdirSafe(path.join(dir, 'actual'));
    await symlink(path.join(dir, 'actual'), path.join(dir, 'link'));
    await assert.rejects(runPortfolioDiscovery({ stateDir: path.join(dir, 'link'), now: NOW, creatorIds: [creator.id] }), /symlink/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

async function mkdirSafe(dir) { const { mkdir } = await import('node:fs/promises'); await mkdir(dir, { mode: 0o700 }); }
