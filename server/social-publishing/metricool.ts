// Metricool adapter for social PUBLISHING (server side). The Metricool-specific scheduling flows
// (Black Room multi-network MCP scheduling, local-news scheduler writes, social-hub calendar read)
// are reachable from call sites ONLY through this adapter via ./provider.ts.
import { scheduleBlackRoomMetricoolPost } from "../blackroom-metricool-bridge";
import { deliverClipperLocalNewsToMetricool } from "../clippers-local-news-metricool";
import { metricoolScheduled } from "../social-hub/metricool-calendar";
import type { FreeSlotsQuery, PublicationRef, PublishRequest, PublishResult, PublishingContext, SocialPublishingProvider } from "./types";

const API = "https://app.metricool.com";
const TIME_ZONE = "America/New_York";
const DAILY_SLOTS = ["10:00:00", "12:30:00", "15:00:00", "17:30:00", "20:00:00"];

export const metricoolLegacy = {
  scheduleBlackRoomPost: scheduleBlackRoomMetricoolPost,
  deliverLocalNews: deliverClipperLocalNewsToMetricool,
  scheduledCalendar: metricoolScheduled,
};
export type MetricoolLegacy = typeof metricoolLegacy;

const clean = (v: unknown) => (v === undefined || v === null ? "" : String(v).trim());
function creds(ctx: PublishingContext) {
  const env = ctx.env || process.env;
  const token = clean(env.METRICOOL_USER_TOKEN), userId = clean(env.METRICOOL_USER_ID);
  if (token.length < 12 || !/^\d+$/.test(userId)) throw new Error("metricool_credentials_unavailable");
  return { token, userId, fetcher: ctx.fetcher || fetch };
}
const refused = (reason: string, providerPostId: string | null = null): PublishResult => ({ provider: "metricool", status: "refused", reason, providerPostId, publicUrl: null });

async function listDay(ctx: PublishingContext, blogId: string, day: string): Promise<any[]> {
  const { token, userId, fetcher } = creds(ctx);
  const url = new URL("/api/v2/scheduler/posts", API);
  Object.entries({ blogId, userId, integrationSource: "MCP", start: `${day}T00:00:00`, end: `${day}T23:59:59`, timezone: TIME_ZONE, extendedRange: "false" })
    .forEach(([k, v]) => url.searchParams.set(k, v));
  const res = await fetcher(url, { headers: { "X-Mc-Auth": token, accept: "application/json" }, signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`metricool_http_${res.status}`);
  const body: any = await res.json();
  return Array.isArray(body) ? body : Array.isArray(body?.data) ? body.data : [];
}
const rowDateTime = (row: any) => clean(typeof row?.publicationDate === "string" ? row.publicationDate : row?.publicationDate?.dateTime).slice(0, 19);

export const metricoolPublishingProvider: SocialPublishingProvider<MetricoolLegacy> = {
  name: "metricool",
  label: "Metricool",
  legacy: metricoolLegacy,
  // Generic single-post path (unused by today's Metricool call sites, which keep their legacy flows).
  async schedulePost(request: PublishRequest, ctx: PublishingContext = {}): Promise<PublishResult> {
    const blogId = clean(request.accountRef.providerAccountId);
    if (!/^\d+$/.test(blogId)) return refused("metricool_blog_id_required");
    const { token, userId, fetcher } = creds(ctx);
    const url = new URL("/api/v2/scheduler/posts", API);
    url.searchParams.set("userId", userId); url.searchParams.set("blogId", blogId); url.searchParams.set("jobId", request.idempotencyKey);
    const tags = (request.hashtags || []).map((t) => (t.startsWith("#") ? t : `#${t}`)).filter((t) => !request.caption.toLowerCase().includes(t.toLowerCase()));
    const res = await fetcher(url, {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json", "X-Mc-Auth": token },
      body: JSON.stringify({
        text: tags.length ? `${request.caption} ${tags.join(" ")}` : request.caption,
        providers: [{ network: request.accountRef.network }],
        publicationDate: { dateTime: request.scheduledFor.slice(0, 19), timezone: "UTC" },
        media: [request.mediaUrl], autoPublish: true, draft: false,
      }),
      signal: AbortSignal.timeout(60_000),
    });
    // Never retried: a 5xx/timeout may still have been accepted.
    if (!res.ok) return { provider: "metricool", status: res.status >= 500 ? "pending_reconciliation" : "failed", reason: `metricool_http_${res.status}`, providerPostId: null, publicUrl: null };
    const body: any = await res.json().catch(() => null);
    const id = clean(body?.data?.id ?? body?.id ?? body?.data?.uuid);
    return id ? { provider: "metricool", status: "scheduled", providerPostId: id, publicUrl: null } : { provider: "metricool", status: "pending_reconciliation", reason: "metricool_post_id_missing", providerPostId: null, publicUrl: null };
  },
  async getPublication(ref: PublicationRef, ctx: PublishingContext = {}): Promise<PublishResult> {
    const day = clean(ref.scheduledFor).slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return refused("scheduled_date_missing", ref.providerPostId);
    const row = (await listDay(ctx, clean(ref.accountRef.providerAccountId), day)).find((r) => clean(r?.id ?? r?.uuid) === ref.providerPostId);
    if (!row) return { provider: "metricool", status: "unknown", providerPostId: ref.providerPostId, publicUrl: null };
    const target = (Array.isArray(row.providers) ? row.providers : []).find((p: any) => p?.network === ref.accountRef.network) || {};
    const st = clean(target.status).toUpperCase();
    const publicUrl = clean(target.publicUrl ?? row.publicUrl) || null;
    return { provider: "metricool", status: st === "PUBLISHED" ? "published" : st === "ERROR" ? "failed" : "scheduled", providerPostId: ref.providerPostId, publicUrl };
  },
  async cancel(ref: PublicationRef): Promise<PublishResult> {
    // No Metricool cancel/delete flow exists in this repo; refuse rather than guess an endpoint.
    return refused("cancel_not_supported_by_metricool_adapter", ref.providerPostId);
  },
  async freeSlots(query: FreeSlotsQuery, ctx: PublishingContext = {}) {
    const rows = await listDay(ctx, clean(query.accountRef.providerAccountId), query.day);
    const taken = new Set(rows.filter((r) => (Array.isArray(r.providers) ? r.providers : []).some((p: any) => p?.network === query.accountRef.network)).map(rowDateTime));
    return { provider: "metricool", slots: DAILY_SLOTS.map((t) => `${query.day}T${t}`).filter((s) => !taken.has(s)), timezone: TIME_ZONE };
  },
};
