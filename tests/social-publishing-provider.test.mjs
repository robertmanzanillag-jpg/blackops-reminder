import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveSocialPublishingProvider, createSocialPublisher, createPublishingClient, publishingCapability, validatePublishRequest, SOCIAL_PUBLISHING_PROVIDERS } from '../script/social-publishing/provider.mjs';
import { metricoolPublishingProvider } from '../script/social-publishing/metricool.mjs';
import { blackopsHubPublishingProvider } from '../script/social-publishing/blackops-hub.mjs';

const request = (over = {}) => ({ accountRef: { network: 'tiktok', handle: 'streamersus', providerAccountId: '6431685' }, mediaUrl: 'https://cdn.example.com/a.mp4',
  caption: 'Clip', hashtags: ['#fyp'], scheduledFor: '2026-12-01T15:00:00Z', idempotencyKey: 'clip-0001-tiktok', ...over });
const silent = () => {};

function fakeProvider() {
  const calls = [];
  return { calls, provider: { name: 'fake', label: 'Fake',
    async schedulePost(r) { calls.push(r); return { provider: 'fake', status: 'scheduled', providerPostId: `p${calls.length}`, publicUrl: null }; },
    async getPublication(ref) { return { provider: 'fake', status: 'published', providerPostId: ref.providerPostId, publicUrl: 'https://x/1' }; },
    async cancel(ref) { return { provider: 'fake', status: 'cancelled', providerPostId: ref.providerPostId, publicUrl: null }; },
    async freeSlots() { return { provider: 'fake', slots: ['2026-12-01T10:00:00'] }; } } };
}

test('default provider is metricool and blackops-hub is not registered by default', () => {
  assert.equal(resolveSocialPublishingProvider({}, undefined, { log: silent }).provider, metricoolPublishingProvider);
  assert.deepEqual(Object.keys(SOCIAL_PUBLISHING_PROVIDERS), ['metricool']);
  assert.equal(resolveSocialPublishingProvider({ SOCIAL_PUBLISHING_PROVIDER: 'blackops-hub' }, undefined, { log: silent }).provider, null);
});

test('unknown provider fails closed: nothing posted, reason logged', async () => {
  const logs = []; const { provider, calls } = fakeProvider();
  const pub = createSocialPublisher({ env: { SOCIAL_PUBLISHING_PROVIDER: 'nope' }, registry: { fake: provider }, log: (m) => logs.push(m) });
  const r = await pub.schedulePost(request());
  assert.equal(r.status, 'refused'); assert.equal(r.reason, 'unknown_social_publishing_provider:nope');
  assert.equal(calls.length, 0); assert.ok(logs.some((l) => l.includes('reason=unknown_social_publishing_provider:nope')));
  assert.equal((await pub.freeSlots({})).slots.length, 0);
  assert.throws(() => publishingCapability('callMetricoolMcp', { env: { SOCIAL_PUBLISHING_PROVIDER: 'nope' }, log: silent }), /unknown_social_publishing_provider/);
  assert.throws(() => createPublishingClient({ token: 'x'.repeat(20), userId: '1', env: { SOCIAL_PUBLISHING_PROVIDER: 'nope' } }, { log: silent }), /unknown_social_publishing_provider/);
});

test('provider lacking a legacy capability fails closed', () => {
  const { provider } = fakeProvider();
  assert.throws(() => publishingCapability('callMetricoolMcp', { env: { SOCIAL_PUBLISHING_PROVIDER: 'fake' }, registry: { fake: provider }, log: silent }), /lacks:callMetricoolMcp:fake/);
  assert.throws(() => createPublishingClient({ env: { SOCIAL_PUBLISHING_PROVIDER: 'fake' } }, { registry: { fake: provider }, log: silent }), /lacks:createClient:fake/);
});

test('idempotency: same key never reaches the provider twice', async () => {
  const { provider, calls } = fakeProvider();
  const pub = createSocialPublisher({ env: { SOCIAL_PUBLISHING_PROVIDER: 'fake' }, registry: { fake: provider }, log: silent });
  const first = await pub.schedulePost(request());
  const second = await pub.schedulePost(request({ caption: 'changed' }));
  assert.equal(first.providerPostId, 'p1'); assert.equal(second.duplicate, true); assert.equal(second.providerPostId, 'p1');
  assert.equal(calls.length, 1); assert.equal(calls[0].provider, 'fake');
  await pub.schedulePost(request({ idempotencyKey: 'clip-0002-tiktok' }));
  assert.equal(calls.length, 2);
});

test('idempotency: an uncertain (thrown) write is not retried', async () => {
  let n = 0;
  const { provider } = fakeProvider();
  const flaky = { ...provider, async schedulePost() { n += 1; throw new Error('timeout'); } };
  const pub = createSocialPublisher({ env: { SOCIAL_PUBLISHING_PROVIDER: 'fake' }, registry: { fake: flaky }, log: silent });
  assert.equal((await pub.schedulePost(request())).status, 'pending_reconciliation');
  const again = await pub.schedulePost(request());
  assert.equal(again.duplicate, true); assert.equal(n, 1);
});

test('invalid requests are refused before the provider', async () => {
  const { provider, calls } = fakeProvider();
  const pub = createSocialPublisher({ env: { SOCIAL_PUBLISHING_PROVIDER: 'fake' }, registry: { fake: provider }, log: silent });
  const r = await pub.schedulePost(request({ mediaUrl: 'http://insecure', idempotencyKey: 'x' }));
  assert.equal(r.status, 'refused'); assert.match(r.reason, /mediaUrl/); assert.match(r.reason, /idempotencyKey/);
  assert.equal(calls.length, 0);
  assert.deepEqual(validatePublishRequest(request()), []);
});

test('metricool adapter keeps the existing client and refuses cancel', async () => {
  assert.equal(typeof metricoolPublishingProvider.createClient, 'function');
  assert.throws(() => metricoolPublishingProvider.createClient({ token: 'short', userId: 'x' }), /metricool_credentials_unavailable/);
  assert.equal((await metricoolPublishingProvider.cancel({ providerPostId: '1' })).status, 'refused');
  const r = await metricoolPublishingProvider.schedulePost(request({ accountRef: { network: 'tiktok', handle: 'someoneelse', providerAccountId: '1' } }), {});
  assert.equal(r.reason, 'destination_not_allowlisted');
});

test('blackops-hub template speaks the documented contract', async () => {
  const seen = [];
  const fetcher = async (url, init) => { seen.push({ url: String(url), init }); return { ok: true, status: 200, json: async () => ({ status: 'scheduled', providerPostId: 'h1', publicUrl: null }) }; };
  const env = { BLACKOPS_HUB_URL: 'https://hub.example.com', SOCIAL_HUB_AGENT_TOKEN: 't'.repeat(40) };
  const r = await blackopsHubPublishingProvider.schedulePost(request(), { env, fetcher });
  assert.equal(r.providerPostId, 'h1');
  assert.equal(seen[0].url, 'https://hub.example.com/social-hub-agent/v1/publishing/posts');
  assert.equal(seen[0].init.headers['idempotency-key'], 'clip-0001-tiktok');
  await assert.rejects(() => blackopsHubPublishingProvider.schedulePost(request(), { env: {}, fetcher }), /blackops_hub_not_configured/);
});
