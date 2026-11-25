// Metricool adapter for post analytics (scripts side). ALL Metricool-specific
// URL, auth and response parsing lives here. To swap providers, implement a
// sibling module with the same `getPostAnalytics` contract and register it in
// ./provider.mjs. Read-only: never schedules, posts or spends.
const API = "https://app.metricool.com";
const TIMEZONE = "America/New_York";

const clean = (v) => (v === undefined || v === null ? "" : String(v).trim());
const num = (v) => {
  const raw = v && typeof v === "object" && !Array.isArray(v) && "value" in v ? v.value : v;
  if (raw === undefined || raw === null || raw === "") return undefined;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
};
const first = (row, ...keys) => {
  for (const k of keys) {
    const raw = row?.[k];
    const v = raw && typeof raw === "object" && !Array.isArray(raw) && "value" in raw ? raw.value : raw;
    if (v !== undefined && v !== null && v !== "") return v;
  }
  return undefined;
};

function rowsOf(payload) {
  if (Array.isArray(payload)) return payload.filter((r) => r && typeof r === "object");
  if (!payload || typeof payload !== "object") return [];
  for (const key of ["data", "posts", "rows", "items", "result"]) {
    if (Array.isArray(payload[key])) return rowsOf(payload[key]);
    if (payload[key] && typeof payload[key] === "object") { const nested = rowsOf(payload[key]); if (nested.length) return nested; }
  }
  return [];
}

/** Metricool TikTok post row -> provider-neutral post analytics record. */
export function normalizeMetricoolPost(row) {
  const url = clean(first(row, "shareUrl", "shareurl", "url", "link", "TKPO03"));
  const videoId = clean(first(row, "videoId", "id", "postId")) || ((/\/video\/(\d+)/.exec(url) || [])[1] || "");
  const rate = num(first(row, "completionRate", "videoCompletionRate", "fullVideoWatchedRate"));
  return {
    provider: "metricool",
    postId: videoId,
    videoId,
    url,
    publishedAt: clean(first(row, "publishedAt", "created", "createTime", "date")),
    views: num(first(row, "views", "viewCount", "videoViews", "TKPO07")),
    likes: num(first(row, "likes", "likeCount", "TKPO08")),
    comments: num(first(row, "comments", "commentCount", "TKPO09")),
    shares: num(first(row, "shares", "shareCount", "TKPO10")),
    completionRate: rate,
  };
}

export function parseMetricoolPostAnalytics(payload) {
  return rowsOf(payload).map(normalizeMetricoolPost).filter((p) => p.url || p.videoId);
}

export const metricoolAnalyticsProvider = {
  name: "metricool",
  label: "Metricool",
  async getPostAnalytics({ blogId, fromDate, toDate, fetcher = fetch, env = process.env }) {
    const token = clean(env.METRICOOL_USER_TOKEN);
    const userId = clean(env.METRICOOL_USER_ID);
    if (!token || !userId || !blogId) throw new Error("metricool_analytics_credentials_missing");
    const url = new URL("/api/v2/analytics/posts/tiktok", API);
    url.searchParams.set("blogId", clean(blogId));
    url.searchParams.set("userId", userId);
    url.searchParams.set("from", `${fromDate}T00:00:00`);
    url.searchParams.set("to", `${toDate}T23:59:59`);
    url.searchParams.set("timezone", TIMEZONE);
    const response = await fetcher(url.toString(), {
      headers: { "X-Mc-Auth": token, accept: "application/json" },
      signal: AbortSignal.timeout(60_000),
    });
    if (!response.ok) throw new Error(`metricool_analytics_http_${response.status}`);
    return parseMetricoolPostAnalytics(JSON.parse(await response.text()));
  },
};
