// TEMPLATE adapter for Robert's in-house publishing hub ("blackops-hub", Metricool replacement).
// NOT registered in ./provider.mjs. To enable: add `'blackops-hub': blackopsHubPublishingProvider`
// to SOCIAL_PUBLISHING_PROVIDERS and set SOCIAL_PUBLISHING_PROVIDER=blackops-hub plus
// BLACKOPS_HUB_URL / SOCIAL_HUB_AGENT_TOKEN. Contract: docs/social-publishing-provider.md.
// It has no `legacy`/`createClient`, so the Metricool-only flows fail closed until ported.
const clean = (v) => (v === undefined || v === null ? '' : String(v).trim());

async function hub(ctx, method, path, body) {
  const env = ctx.env || process.env;
  const base = clean(env.BLACKOPS_HUB_URL), token = clean(env.SOCIAL_HUB_AGENT_TOKEN);
  if (!/^https:\/\//.test(base) || token.length < 32) throw new Error('blackops_hub_not_configured');
  const headers = { authorization: `Bearer ${token}`, accept: 'application/json', ...(body ? { 'content-type': 'application/json' } : {}) };
  if (body?.idempotencyKey) headers['idempotency-key'] = body.idempotencyKey;
  const response = await (ctx.fetcher || fetch)(new URL(path, base), { method, headers, redirect: 'error', body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(30_000) });
  const json = await response.json().catch(() => null);
  if (!response.ok) throw new Error(`blackops_hub_http_${response.status}${json?.reason ? `:${String(json.reason).slice(0, 80)}` : ''}`);
  return json;
}
const normal = (r) => ({ provider: 'blackops-hub', status: clean(r?.status) || 'unknown', providerPostId: r?.providerPostId ? String(r.providerPostId) : null, publicUrl: r?.publicUrl || null, ...(r?.publishedAt ? { publishedAt: r.publishedAt } : {}), ...(r?.reason ? { reason: r.reason } : {}) });

export const blackopsHubPublishingProvider = Object.freeze({
  name: 'blackops-hub',
  label: 'BlackOps Social Hub',
  async schedulePost(request, ctx = {}) {
    const { accountRef, mediaUrl, caption, hashtags = [], scheduledFor, idempotencyKey } = request;
    return normal(await hub(ctx, 'POST', '/social-hub-agent/v1/publishing/posts', { accountRef, mediaUrl, caption, hashtags, scheduledFor, idempotencyKey }));
  },
  async getPublication(ref, ctx = {}) { return normal(await hub(ctx, 'GET', `/social-hub-agent/v1/publishing/posts/${encodeURIComponent(ref.providerPostId)}`)); },
  async cancel(ref, ctx = {}) { return normal(await hub(ctx, 'POST', `/social-hub-agent/v1/publishing/posts/${encodeURIComponent(ref.providerPostId)}/cancel`, {})); },
  async freeSlots({ accountRef, day }, ctx = {}) {
    const q = new URLSearchParams({ network: clean(accountRef?.network), handle: clean(accountRef?.handle), providerAccountId: clean(accountRef?.providerAccountId), day: clean(day) });
    const r = await hub(ctx, 'GET', `/social-hub-agent/v1/publishing/slots?${q}`);
    return { provider: 'blackops-hub', slots: Array.isArray(r?.slots) ? r.slots.map(String) : [], timezone: r?.timezone || null };
  },
});
