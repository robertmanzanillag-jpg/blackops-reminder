import test from "node:test";
import assert from "node:assert/strict";
import { resolveSocialAnalyticsProvider } from "../script/social-analytics/provider.mjs";
import { metricoolAnalyticsProvider, parseMetricoolPostAnalytics } from "../script/social-analytics/metricool.mjs";

test("defaults to metricool, unknown provider resolves to null with a reason", () => {
  assert.equal(resolveSocialAnalyticsProvider({}).provider.name, "metricool");
  const r = resolveSocialAnalyticsProvider({ SOCIAL_ANALYTICS_PROVIDER: "Bogus" });
  assert.equal(r.provider, null); assert.equal(r.reason, "unknown_social_analytics_provider:bogus");
  assert.equal(resolveSocialAnalyticsProvider({ SOCIAL_ANALYTICS_PROVIDER: "toString" }).provider, null);
});

test("metricool adapter calls the REST analytics endpoint and returns neutral records", async () => {
  let seen;
  const fetcher = async (url, init) => { seen = { url: new URL(url), init }; return new Response(JSON.stringify({ data: [{ shareUrl: "https://www.tiktok.com/@a/video/123", views: 9, likes: 2 }] })); };
  const posts = await metricoolAnalyticsProvider.getPostAnalytics({ blogId: "6431687", fromDate: "2026-11-10", toDate: "2026-11-24", fetcher, env: { METRICOOL_USER_TOKEN: "tok", METRICOOL_USER_ID: "u1" } });
  assert.equal(seen.url.pathname, "/api/v2/analytics/posts/tiktok");
  for (const k of ["blogId", "userId", "from", "to", "timezone"]) assert.ok(seen.url.searchParams.get(k), k);
  assert.equal(seen.init.headers["X-Mc-Auth"], "tok");
  assert.deepEqual(Object.keys(posts[0]).sort(), ["comments", "completionRate", "likes", "provider", "postId", "publishedAt", "shares", "url", "videoId", "views"].sort());
  assert.equal(posts[0].provider, "metricool"); assert.equal(posts[0].videoId, "123"); assert.equal(posts[0].views, 9);
  assert.deepEqual(parseMetricoolPostAnalytics("garbage"), []);
});
