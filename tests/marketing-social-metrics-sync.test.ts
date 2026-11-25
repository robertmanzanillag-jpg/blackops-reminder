import test from "node:test";
import assert from "node:assert/strict";
import { createMarketingSocialScheduler, getMarketingSocialSyncConfig, snapshotsFromPosts, syncMarketingSocialMetrics, type SocialSnapshot } from "../server/marketing-social-metrics-sync";
import { parseMetricoolTikTokPosts } from "../server/social-analytics/metricool";
import type { SocialAnalyticsProvider } from "../server/social-analytics/provider";
import { executionDiagnostics } from "../server/office-web-role-sources";

const env = { METRICOOL_USER_TOKEN: "tok-real", METRICOOL_USER_ID: "123" } as NodeJS.ProcessEnv;
const now = () => new Date("2026-11-24T15:00:00Z");

test("parses Metricool REST rows into opaque, provider-tagged snapshots without URLs", () => {
  const posts = parseMetricoolTikTokPosts({ data: [{ shareUrl: "https://tiktok.com/@a/video/1", views: 95, likes: 3, reach: 80 }, { views: 10 }] });
  assert.equal(posts.length, 1); assert.equal(posts[0].provider, "metricool"); assert.equal(posts[0].videoId, "1");
  const rows = snapshotsFromPosts(posts, "6431685", "2026-11-24", "metricool");
  assert.equal(rows.length, 1);
  assert.match(rows[0].id, /^metricool-tiktok-[a-f0-9]{32}-2026-11-24$/);
  assert.equal(rows[0].provider, "metricool");
  assert.equal(rows[0].views, 95); assert.equal(rows[0].impressions, 80); assert.equal(rows[0].likes, 3);
  assert.ok(!JSON.stringify(rows).includes("tiktok.com"));
  assert.deepEqual(parseMetricoolTikTokPosts("garbage"), []);
});

test("an alternate provider can be injected via SOCIAL_ANALYTICS_PROVIDER", async () => {
  let recorded: SocialSnapshot[] = [];
  const inHouse: SocialAnalyticsProvider = {
    name: "inhouse", isConfigured: () => true,
    getPostAnalytics: async ({ accountId }) => [{ provider: "inhouse", postId: accountId, videoId: accountId, url: `https://x/video/${accountId}`, publishedAt: "", views: 5, likes: 1, comments: 0, shares: 0 }],
  };
  const result = await syncMarketingSocialMetrics({ env: { SOCIAL_ANALYTICS_PROVIDER: "inhouse" }, providers: { inhouse: inHouse }, now, record: (items) => { recorded = items; return items.length; }, learn: async () => undefined, fetch: (async () => { throw new Error("no network"); }) as typeof fetch });
  assert.equal(result.status, "completed"); assert.equal(recorded.length, 2);
  assert.ok(recorded.every((r) => r.provider === "inhouse" && r.id.startsWith("social-analytics-inhouse-tiktok-")));
});

test("an unknown provider fails closed: records nothing, logs the reason", async () => {
  let wrote = 0, fetched = 0; const logs: string[] = [];
  const result = await syncMarketingSocialMetrics({ env: { ...env, SOCIAL_ANALYTICS_PROVIDER: "nope" }, now, log: (m) => logs.push(m), record: () => { wrote++; return 0; }, fetch: (async () => { fetched++; return new Response("[]"); }) as typeof fetch });
  assert.equal(result.status, "blocked"); assert.equal(result.error, "unknown_social_analytics_provider:nope");
  assert.equal(wrote, 0); assert.equal(fetched, 0); assert.match(logs.join("\n"), /unknown_social_analytics_provider/);
});

test("missing credentials or disabled config records nothing (fail-closed)", async () => {
  let calls = 0;
  const record = () => { calls++; return 0; };
  assert.equal((await syncMarketingSocialMetrics({ env: {}, record, now })).error, "missing_metricool_credentials");
  assert.equal((await syncMarketingSocialMetrics({ env: { ...env, MARKETING_SOCIAL_METRICS_SYNC_ENABLED: "false" }, record, now })).status, "blocked");
  assert.equal(calls, 0);
});

test("Metricool uses the REST analytics endpoint (not an MCP tool), records snapshots, then learning once", async () => {
  const urls: URL[] = []; let recorded: SocialSnapshot[] = []; const learned: string[] = [];
  const fetch = (async (url: unknown, init?: RequestInit) => {
    const u = new URL(String(url)); urls.push(u);
    assert.equal(init?.method ?? "GET", "GET");
    assert.equal((init?.headers as Record<string, string>)["X-Mc-Auth"], "tok-real");
    return new Response(JSON.stringify({ data: [{ shareUrl: "https://x/video/" + urls.length, views: 11 }] }), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  const result = await syncMarketingSocialMetrics({ env, fetch, now, record: (items) => { recorded = items; return items.length; }, learn: async (k) => { learned.push(k); } });
  assert.ok(urls.every((u) => u.origin === "https://app.metricool.com" && u.pathname === "/api/v2/analytics/posts/tiktok"));
  for (const k of ["blogId", "userId", "from", "to", "timezone"]) assert.ok(urls[0].searchParams.get(k), k);
  assert.equal(urls.length, getMarketingSocialSyncConfig(env).blogIds.length);
  assert.equal(result.status, "completed"); assert.equal(result.recorded, 2); assert.equal(recorded.length, 2);
  assert.deepEqual(learned, ["2026-11-24"]); assert.equal(result.learningRecorded, true);
});

test("failed fetch leaves source untouched and skips learning", async () => {
  let learned = 0, wrote = 0;
  const fetch = (async () => new Response("denied", { status: 403 })) as typeof fetch;
  const result = await syncMarketingSocialMetrics({ env, fetch, now, record: () => { wrote++; return 0; }, learn: async () => { learned++; } });
  assert.equal(result.status, "blocked"); assert.equal(wrote, 0); assert.equal(learned, 0);
});

test("scheduler runs at most once per New York day after the configured time", async () => {
  let clock = new Date("2026-11-24T11:00:00Z"); let runs = 0;
  const s = createMarketingSocialScheduler({ env, now: () => clock, setInterval: () => ({}), log: () => undefined, sync: async () => { runs++; return { status: "completed", brands: 2, recorded: 1, learningRecorded: true, error: null, at: clock.toISOString() }; } });
  assert.equal(await s.tick(), false); // 06:00 NY, before 07:10
  clock = new Date("2026-11-24T13:00:00Z"); assert.equal(await s.tick(), true); assert.equal(await s.tick(), false);
  clock = new Date("2026-11-25T13:00:00Z"); assert.equal(await s.tick(), true); assert.equal(runs, 2);
});

test("execution labels stay for plan/metric-only rows and are role-scoped", () => {
  assert.deepEqual(executionDiagnostics("marketing-cmo", [{ kind: "campaign_metric" }, { kind: "marketing_plan" }]), ["PLANS_NOT_EXECUTION", "COLLECTED_METRICS_ONLY"]);
  assert.deepEqual(executionDiagnostics("marketing-cmo", []), ["PLANS_NOT_EXECUTION", "COLLECTED_METRICS_ONLY"]);
  assert.deepEqual(executionDiagnostics("dropshipping", [{ kind: "product" }]), []);
});
