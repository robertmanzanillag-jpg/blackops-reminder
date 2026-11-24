import type { PostAnalytics, PostAnalyticsRequest, SocialAnalyticsProvider } from "./types";

/** Metricool adapter (server side). ALL Metricool URL/auth/response parsing for
 * post analytics lives here. Read-only REST call, same endpoint family the
 * existing analytics sync uses (/api/v2/analytics/posts/<network>). */
const METRICOOL_API = "https://app.metricool.com";
const TIME_ZONE = "America/New_York";

const real = (v: unknown): v is string => typeof v === "string" && v.trim().length > 0 && !/^(replace|paste|your-|<)/i.test(v.trim());
const unwrap = (v: unknown) => (v && typeof v === "object" && !Array.isArray(v) && "value" in v ? (v as { value: unknown }).value : v);
function first(row: Record<string, unknown>, ...keys: string[]): unknown {
  for (const key of keys) { const v = unwrap(row[key]); if (v !== undefined && v !== null && v !== "") return v; }
  return undefined;
}
const num = (v: unknown) => { if (v === undefined) return undefined; const n = Number(v); return Number.isFinite(n) && n >= 0 ? Math.min(100_000_000, n) : undefined; };
const str = (v: unknown) => (v === undefined || v === null ? "" : String(v).trim());

function rowsOf(payload: unknown, depth = 0): Record<string, unknown>[] {
  if (depth > 3) return [];
  if (Array.isArray(payload)) return payload.filter((r): r is Record<string, unknown> => Boolean(r && typeof r === "object" && !Array.isArray(r)));
  if (!payload || typeof payload !== "object") return [];
  for (const key of ["data", "posts", "rows", "items"]) {
    const nested = rowsOf((payload as Record<string, unknown>)[key], depth + 1);
    if (nested.length) return nested;
  }
  return [];
}

export function normalizeMetricoolTikTokPost(row: Record<string, unknown>): PostAnalytics {
  const url = str(first(row, "shareUrl", "shareurl", "url", "link", "TKPO03"));
  const videoId = str(first(row, "videoId", "postId", "id")) || (/\/video\/(\d+)/.exec(url)?.[1] ?? "");
  return {
    provider: "metricool",
    postId: videoId,
    videoId,
    url,
    publishedAt: str(first(row, "publishedAt", "created", "createTime", "date")),
    views: num(first(row, "views", "viewCount", "videoViews", "TKPO07")),
    likes: num(first(row, "likes", "likeCount", "TKPO08")),
    comments: num(first(row, "comments", "commentCount", "TKPO09")),
    shares: num(first(row, "shares", "shareCount", "TKPO10")),
    completionRate: num(first(row, "completionRate", "videoCompletionRate", "fullVideoWatchedRate")),
    impressions: num(first(row, "reach", "impressions", "TKPO11")),
  };
}

export function parseMetricoolTikTokPosts(payload: unknown): PostAnalytics[] {
  return rowsOf(payload).map(normalizeMetricoolTikTokPost).filter((p) => p.url || p.videoId);
}

export const metricoolAnalyticsProvider: SocialAnalyticsProvider = {
  name: "metricool",
  isConfigured: (env) => real(env.METRICOOL_USER_TOKEN) && real(env.METRICOOL_USER_ID),
  async getPostAnalytics(request: PostAnalyticsRequest) {
    const { env, accountId } = request;
    if (!real(env.METRICOOL_USER_TOKEN) || !real(env.METRICOOL_USER_ID)) throw new Error("missing_metricool_credentials");
    const url = new URL(`/api/v2/analytics/posts/${request.platform}`, METRICOOL_API);
    url.searchParams.set("blogId", accountId);
    url.searchParams.set("userId", env.METRICOOL_USER_ID!);
    url.searchParams.set("from", request.from);
    url.searchParams.set("to", request.to);
    url.searchParams.set("timezone", TIME_ZONE);
    url.searchParams.set("integrationSource", "MCP");
    const response = await request.fetch(url, { headers: { Accept: "application/json", "X-Mc-Auth": env.METRICOOL_USER_TOKEN! } });
    if (!response.ok) throw new Error(response.status === 401 || response.status === 403 ? "metricool_api_access_denied_or_plan_required" : `metricool_analytics_http_${response.status}`);
    return parseMetricoolTikTokPosts(await response.json().catch(() => null));
  },
};
