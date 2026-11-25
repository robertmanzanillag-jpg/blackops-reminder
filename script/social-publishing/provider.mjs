// Provider seam for social PUBLISHING (scripts side). Mirror of ../social-analytics/provider.mjs.
// Selected with env SOCIAL_PUBLISHING_PROVIDER (default "metricool"). Contract (docs/social-publishing-provider.md):
//   schedulePost(request, ctx) -> { provider, status, providerPostId, publicUrl, reason? }
//   getPublication(ref, ctx)   -> { provider, status, providerPostId, publicUrl, publishedAt? }
//   cancel(ref, ctx)           -> { provider, status, reason? }
//   freeSlots({ accountRef, day }, ctx) -> { provider, slots: ["YYYY-MM-DDTHH:mm:ss"], timezone? }
// Unknown provider => nothing is posted, reason is logged (fail closed).
// The blackops-hub adapter (./blackops-hub.mjs) is a template and is NOT registered by default.
import { metricoolPublishingProvider } from './metricool.mjs';

export const SOCIAL_PUBLISHING_PROVIDERS = Object.freeze({ metricool: metricoolPublishingProvider });
const REQUIRED = ['schedulePost', 'getPublication', 'cancel', 'freeSlots'];
const defaultLog = (message) => console.warn(message);

export function resolveSocialPublishingProvider(env = process.env, registry = SOCIAL_PUBLISHING_PROVIDERS, { site = 'unknown', log = defaultLog } = {}) {
  const name = String(env?.SOCIAL_PUBLISHING_PROVIDER || 'metricool').trim().toLowerCase();
  const provider = Object.prototype.hasOwnProperty.call(registry, name) ? registry[name] : null;
  if (!provider || REQUIRED.some((m) => typeof provider[m] !== 'function')) {
    const reason = `unknown_social_publishing_provider:${name.slice(0, 40)}`;
    log(`[social-publishing] refused site=${site} reason=${reason}`);
    return { provider: null, name, reason };
  }
  return { provider, name, reason: '' };
}

/** Existing provider-specific flow (e.g. Metricool MCP/scheduler helpers). Throws (fail closed) if unavailable. */
export function publishingCapability(capability, { env = process.env, registry = SOCIAL_PUBLISHING_PROVIDERS, site = capability, log = defaultLog } = {}) {
  const resolved = resolveSocialPublishingProvider(env, registry, { site, log });
  if (!resolved.provider) throw new Error(resolved.reason);
  const fn = resolved.provider.legacy?.[capability];
  if (typeof fn !== 'function') {
    const reason = `social_publishing_provider_lacks:${capability}:${resolved.name}`;
    log(`[social-publishing] refused site=${site} reason=${reason}`);
    throw new Error(reason);
  }
  return fn;
}

/** Drop-in for createPortfolioMetricool(options): routes through the selected provider's rich client. */
export function createPublishingClient(options = {}, { registry = SOCIAL_PUBLISHING_PROVIDERS, site = 'publishing_client', log = defaultLog } = {}) {
  const resolved = resolveSocialPublishingProvider(options.env || process.env, registry, { site, log });
  if (!resolved.provider) throw new Error(resolved.reason);
  if (typeof resolved.provider.createClient !== 'function') {
    const reason = `social_publishing_provider_lacks:createClient:${resolved.name}`;
    log(`[social-publishing] refused site=${site} reason=${reason}`);
    throw new Error(reason);
  }
  return resolved.provider.createClient(options);
}

export function validatePublishRequest(request) {
  const errors = [];
  const ref = request?.accountRef;
  if (!ref || !/^[a-z]+$/.test(String(ref.network || ''))) errors.push('accountRef.network');
  if (!ref || !String(ref.handle || ref.providerAccountId || '').trim()) errors.push('accountRef.handle_or_providerAccountId');
  try { if (new URL(String(request?.mediaUrl || '')).protocol !== 'https:') errors.push('mediaUrl'); } catch { errors.push('mediaUrl'); }
  if (!String(request?.caption || '').trim()) errors.push('caption');
  if (request?.hashtags !== undefined && !Array.isArray(request.hashtags)) errors.push('hashtags');
  if (!Number.isFinite(Date.parse(String(request?.scheduledFor || '')))) errors.push('scheduledFor');
  if (!/^[A-Za-z0-9:._-]{8,200}$/.test(String(request?.idempotencyKey || ''))) errors.push('idempotencyKey');
  return errors;
}

/** In-memory idempotency store; pass a durable { get, set } for cross-process use. */
export function memoryIdempotencyStore() {
  const map = new Map();
  return { get: async (k) => map.get(k), set: async (k, v) => { map.set(k, v); } };
}

/**
 * Provider-neutral publisher with idempotency + fail-closed behaviour.
 * A key seen before (any outcome, including in-flight/uncertain) is never re-sent to the provider.
 */
export function createSocialPublisher({ env = process.env, registry = SOCIAL_PUBLISHING_PROVIDERS, idempotency = memoryIdempotencyStore(), log = defaultLog, ctx = {} } = {}) {
  const resolved = resolveSocialPublishingProvider(env, registry, { site: 'social_publisher', log });
  const refused = (reason) => ({ provider: resolved.name, status: 'refused', reason, providerPostId: null, publicUrl: null });
  return {
    name: resolved.name,
    reason: resolved.reason,
    async schedulePost(request) {
      if (!resolved.provider) return refused(resolved.reason);
      const errors = validatePublishRequest(request);
      if (errors.length) { log(`[social-publishing] refused site=schedulePost reason=invalid_request:${errors.join(',')}`); return refused(`invalid_request:${errors.join(',')}`); }
      const key = `${resolved.name}:${request.idempotencyKey}`;
      const prior = await idempotency.get(key);
      if (prior) return { ...prior, duplicate: true };
      await idempotency.set(key, { provider: resolved.name, status: 'pending_reconciliation', providerPostId: null, publicUrl: null });
      let result;
      try { result = await resolved.provider.schedulePost({ ...request, provider: resolved.name, hashtags: request.hashtags ?? [] }, { env, ...ctx }); }
      catch (error) { result = { provider: resolved.name, status: 'pending_reconciliation', reason: String(error?.message || error).slice(0, 200), providerPostId: null, publicUrl: null }; }
      await idempotency.set(key, result);
      return result;
    },
    async getPublication(ref) { return resolved.provider ? resolved.provider.getPublication(ref, { env, ...ctx }) : refused(resolved.reason); },
    async cancel(ref) { return resolved.provider ? resolved.provider.cancel(ref, { env, ...ctx }) : refused(resolved.reason); },
    async freeSlots(query) { return resolved.provider ? resolved.provider.freeSlots(query, { env, ...ctx }) : { provider: resolved.name, slots: [], reason: resolved.reason }; },
  };
}
