import { metricoolPublishingProvider, type MetricoolLegacy } from "./metricool";
import type { FreeSlotsQuery, FreeSlotsResult, PublicationRef, PublishRequest, PublishResult, PublishingContext, SocialPublishingProvider } from "./types";

export type { FreeSlotsQuery, FreeSlotsResult, PublicationRef, PublishRequest, PublishResult, PublishStatus, PublishingAccountRef, PublishingContext, SocialPublishingProvider } from "./types";
export type PublishingLegacy = MetricoolLegacy;
type Registry = Readonly<Record<string, SocialPublishingProvider<PublishingLegacy>>>;
type Log = (message: string) => void;

/** Provider seam for publishing. Selected by env SOCIAL_PUBLISHING_PROVIDER (default "metricool").
 * blackops-hub (./blackops-hub.ts) is a template and NOT registered by default.
 * Unknown provider => null + reason, logged; callers post nothing (fail closed). */
export const SOCIAL_PUBLISHING_PROVIDERS: Registry = Object.freeze({ metricool: metricoolPublishingProvider });
const REQUIRED = ["schedulePost", "getPublication", "cancel", "freeSlots"] as const;
const defaultLog: Log = (m) => console.warn(m);

export function resolveSocialPublishingProvider(env: NodeJS.ProcessEnv = process.env, registry: Registry = SOCIAL_PUBLISHING_PROVIDERS, opts: { site?: string; log?: Log } = {}):
  { provider: SocialPublishingProvider<PublishingLegacy>; name: string; reason: null } | { provider: null; name: string; reason: string } {
  const name = String(env.SOCIAL_PUBLISHING_PROVIDER || "metricool").trim().toLowerCase();
  const provider = Object.prototype.hasOwnProperty.call(registry, name) ? registry[name] : undefined;
  if (!provider || REQUIRED.some((m) => typeof provider[m] !== "function")) {
    const reason = `unknown_social_publishing_provider:${name.slice(0, 40)}`;
    (opts.log || defaultLog)(`[social-publishing] refused site=${opts.site || "unknown"} reason=${reason}`);
    return { provider: null, name, reason };
  }
  return { provider, name, reason: null };
}

/** Existing provider-specific flow for a call site. Throws (fail closed, nothing posted) when the selected
 * provider is unknown or does not implement it. */
export function publishingCapability<K extends keyof PublishingLegacy>(capability: K, opts: { env?: NodeJS.ProcessEnv; registry?: Registry; site?: string; log?: Log } = {}): PublishingLegacy[K] {
  const log = opts.log || defaultLog;
  const resolved = resolveSocialPublishingProvider(opts.env || process.env, opts.registry || SOCIAL_PUBLISHING_PROVIDERS, { site: opts.site || String(capability), log });
  if (!resolved.provider) throw new SocialPublishingRefusedError(resolved.reason);
  const fn = resolved.provider.legacy?.[capability];
  if (typeof fn !== "function") {
    const reason = `social_publishing_provider_lacks:${String(capability)}:${resolved.name}`;
    log(`[social-publishing] refused site=${opts.site || String(capability)} reason=${reason}`);
    throw new SocialPublishingRefusedError(reason);
  }
  return fn as PublishingLegacy[K];
}

export class SocialPublishingRefusedError extends Error {
  readonly reason: string;
  constructor(reason: string) { super(reason); this.reason = reason; this.name = "SocialPublishingRefusedError"; }
}

export function validatePublishRequest(r: Partial<PublishRequest> | null | undefined): string[] {
  const errors: string[] = [];
  const ref = r?.accountRef;
  if (!ref || !/^[a-z]+$/.test(String(ref.network || ""))) errors.push("accountRef.network");
  if (!ref || !String(ref.handle || ref.providerAccountId || "").trim()) errors.push("accountRef.handle_or_providerAccountId");
  try { if (new URL(String(r?.mediaUrl || "")).protocol !== "https:") errors.push("mediaUrl"); } catch { errors.push("mediaUrl"); }
  if (!String(r?.caption || "").trim()) errors.push("caption");
  if (r?.hashtags !== undefined && !Array.isArray(r.hashtags)) errors.push("hashtags");
  if (!Number.isFinite(Date.parse(String(r?.scheduledFor || "")))) errors.push("scheduledFor");
  if (!/^[A-Za-z0-9:._-]{8,200}$/.test(String(r?.idempotencyKey || ""))) errors.push("idempotencyKey");
  return errors;
}

export interface IdempotencyStore { get(key: string): Promise<PublishResult | undefined>; set(key: string, value: PublishResult): Promise<void> }
export function memoryIdempotencyStore(): IdempotencyStore {
  const map = new Map<string, PublishResult>();
  return { get: async (k) => map.get(k), set: async (k, v) => { map.set(k, v); } };
}

/** Provider-neutral publisher: validation, idempotency (a key is never re-sent, even after an uncertain
 * outcome) and fail-closed on unknown provider. */
export function createSocialPublisher(opts: { env?: NodeJS.ProcessEnv; registry?: Registry; idempotency?: IdempotencyStore; log?: Log; ctx?: PublishingContext } = {}) {
  const env = opts.env || process.env;
  const log = opts.log || defaultLog;
  const idempotency = opts.idempotency || memoryIdempotencyStore();
  const resolved = resolveSocialPublishingProvider(env, opts.registry || SOCIAL_PUBLISHING_PROVIDERS, { site: "social_publisher", log });
  const ctx: PublishingContext = { env, ...opts.ctx };
  const refused = (reason: string): PublishResult => ({ provider: resolved.name, status: "refused", reason, providerPostId: null, publicUrl: null });
  return {
    name: resolved.name,
    reason: resolved.reason,
    async schedulePost(request: PublishRequest): Promise<PublishResult> {
      if (!resolved.provider) return refused(resolved.reason);
      const errors = validatePublishRequest(request);
      if (errors.length) { log(`[social-publishing] refused site=schedulePost reason=invalid_request:${errors.join(",")}`); return refused(`invalid_request:${errors.join(",")}`); }
      const key = `${resolved.name}:${request.idempotencyKey}`;
      const prior = await idempotency.get(key);
      if (prior) return { ...prior, duplicate: true };
      await idempotency.set(key, { provider: resolved.name, status: "pending_reconciliation", providerPostId: null, publicUrl: null });
      let result: PublishResult;
      try { result = await resolved.provider.schedulePost({ ...request, provider: resolved.name, hashtags: request.hashtags ?? [] }, ctx); }
      catch (e) { result = { provider: resolved.name, status: "pending_reconciliation", reason: (e instanceof Error ? e.message : String(e)).slice(0, 200), providerPostId: null, publicUrl: null }; }
      await idempotency.set(key, result);
      return result;
    },
    async getPublication(ref: PublicationRef): Promise<PublishResult> { return resolved.provider ? resolved.provider.getPublication(ref, ctx) : refused(resolved.reason); },
    async cancel(ref: PublicationRef): Promise<PublishResult> { return resolved.provider ? resolved.provider.cancel(ref, ctx) : refused(resolved.reason); },
    async freeSlots(query: FreeSlotsQuery): Promise<FreeSlotsResult> { return resolved.provider ? resolved.provider.freeSlots(query, ctx) : { provider: resolved.name, slots: [], reason: resolved.reason }; },
  };
}
