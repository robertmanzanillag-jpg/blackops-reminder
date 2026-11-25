// TEMPLATE adapter for Robert's in-house publishing hub ("blackops-hub", the Metricool replacement).
// NOT registered in ./provider.ts. Enable by adding it to SOCIAL_PUBLISHING_PROVIDERS and setting
// SOCIAL_PUBLISHING_PROVIDER=blackops-hub, BLACKOPS_HUB_URL (https) and SOCIAL_HUB_AGENT_TOKEN (>= 32 chars).
// It has no `legacy` flows, so Metricool-only call sites fail closed until ported to the neutral contract.
// Contract: docs/social-publishing-provider.md.
import type { FreeSlotsQuery, PublicationRef, PublishRequest, PublishResult, PublishStatus, PublishingContext, SocialPublishingProvider } from "./types";

const clean = (v: unknown) => (v === undefined || v === null ? "" : String(v).trim());
const STATUSES = new Set<PublishStatus>(["scheduled", "published", "pending_reconciliation", "unverified", "refused", "failed", "cancelled", "unknown"]);

async function hub(ctx: PublishingContext, method: "GET" | "POST", path: string, body?: Record<string, unknown>): Promise<any> {
  const env = ctx.env || process.env;
  const base = clean(env.BLACKOPS_HUB_URL), token = clean(env.SOCIAL_HUB_AGENT_TOKEN);
  if (!/^https:\/\//.test(base) || token.length < 32) throw new Error("blackops_hub_not_configured");
  const headers: Record<string, string> = { authorization: `Bearer ${token}`, accept: "application/json" };
  if (body) headers["content-type"] = "application/json";
  if (typeof body?.idempotencyKey === "string") headers["idempotency-key"] = body.idempotencyKey;
  const res = await (ctx.fetcher || fetch)(new URL(path, base), { method, headers, redirect: "error", body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(30_000) });
  const json: any = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`blackops_hub_http_${res.status}${json?.reason ? `:${String(json.reason).slice(0, 80)}` : ""}`);
  return json;
}
function normal(r: any): PublishResult {
  const status = STATUSES.has(r?.status) ? r.status as PublishStatus : "unknown";
  return { provider: "blackops-hub", status, providerPostId: r?.providerPostId ? String(r.providerPostId) : null, publicUrl: r?.publicUrl ? String(r.publicUrl) : null,
    ...(r?.publishedAt ? { publishedAt: String(r.publishedAt) } : {}), ...(r?.reason ? { reason: String(r.reason) } : {}) };
}

export const blackopsHubPublishingProvider: SocialPublishingProvider = {
  name: "blackops-hub",
  label: "BlackOps Social Hub",
  async schedulePost(r: PublishRequest, ctx: PublishingContext = {}) {
    return normal(await hub(ctx, "POST", "/social-hub-agent/v1/publishing/posts", { accountRef: r.accountRef, mediaUrl: r.mediaUrl, caption: r.caption, hashtags: r.hashtags ?? [], scheduledFor: r.scheduledFor, idempotencyKey: r.idempotencyKey }));
  },
  async getPublication(ref: PublicationRef, ctx: PublishingContext = {}) { return normal(await hub(ctx, "GET", `/social-hub-agent/v1/publishing/posts/${encodeURIComponent(ref.providerPostId)}`)); },
  async cancel(ref: PublicationRef, ctx: PublishingContext = {}) { return normal(await hub(ctx, "POST", `/social-hub-agent/v1/publishing/posts/${encodeURIComponent(ref.providerPostId)}/cancel`, {})); },
  async freeSlots(q: FreeSlotsQuery, ctx: PublishingContext = {}) {
    const params = new URLSearchParams({ network: clean(q.accountRef.network), handle: clean(q.accountRef.handle), providerAccountId: clean(q.accountRef.providerAccountId), day: clean(q.day) });
    const r = await hub(ctx, "GET", `/social-hub-agent/v1/publishing/slots?${params}`);
    return { provider: "blackops-hub", slots: Array.isArray(r?.slots) ? r.slots.map(String) : [], timezone: r?.timezone ? String(r.timezone) : null };
  },
};
