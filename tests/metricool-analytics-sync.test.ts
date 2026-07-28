import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
  createMetricoolAnalyticsScheduler,
  getMetricoolAnalyticsSyncConfig,
  getMetricoolAnalyticsSyncStatus,
  parseMetricoolPostMetrics,
  syncMetricoolAnalytics,
} from "../server/metricool-analytics-sync";

function response(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });
}

test("parses Metricool post metrics without trusting a single provider field", () => {
  const parsed = parseMetricoolPostMetrics({ data: [{ id: "post-1", publicationDate: "2026-07-26T12:00:00Z", views: 42, reactions: 3, comments: 1, shares: 2, linkClicks: 4 }] });
  assert.deepEqual(parsed, [{ postId: "post-1", queueItemId: null, contentHash: null, observedAt: "2026-07-26T12:00:00Z", impressions: 42, engagements: 10, clicks: 4, shares: 2 }]);
  assert.deepEqual(parseMetricoolPostMetrics({ data: [{ postId: "nested-1", publicationDate: { dateTime: "2026-07-26T12:00:00Z" }, metrics: { views: 9, reactions: 1 } }] }), [{ postId: "nested-1", queueItemId: null, contentHash: null, observedAt: "2026-07-26T12:00:00Z", impressions: 9, engagements: 1, clicks: 0, shares: 0 }]);
});

test("syncs Facebook analytics for both local-news brands and deduplicates observations", async () => {
  const workspaceDir = await mkdtemp(path.join(tmpdir(), "metricool-analytics-"));
  await writeFile(path.join(workspaceDir, "metricool-delivery-ledger.json"), JSON.stringify({ entries: [
    { queueItemId: "queue-1", eventId: "event-1", lane: "miami-news", platform: "facebook", blogId: "miami-1", metricoolPostId: "post-1" },
    { queueItemId: "queue-2", eventId: "event-2", lane: "ny-news", platform: "facebook", blogId: "ny-1", metricoolPostId: "post-2" },
  ] }));
  const calls: string[] = [];
  const fetcher: typeof fetch = async (input) => {
    const url = String(input);
    calls.push(url);
    if (url.includes("simpleProfiles")) return response({ data: [{ blogId: "miami-1", label: "Miami News", networks: ["facebook"] }, { blogId: "ny-1", label: "New York News", networks: ["facebook"] }] });
    if (url.includes("blogId=miami-1")) return response({ data: [
      { id: "post-1", publicationDate: "2026-07-26T12:00:00Z", views: 42, reactions: 3, comments: 1, shares: 2, linkClicks: 4 },
      { id: "external-1", publicationDate: "2026-07-26T12:30:00Z", views: 100, reactions: 10 },
    ] });
    if (url.includes("blogId=ny-1")) return response({ data: [{ id: "post-2", jobId: "queue-2", publicationDate: "2026-07-26T13:00:00Z", reach: 8, reactions: 1 }] });
    return response({ error: "not found" }, 404);
  };
  const env = { METRICOOL_USER_TOKEN: "configured-token", METRICOOL_USER_ID: "3558197", CLIPPERS_LOCAL_NEWS_WORKSPACE: workspaceDir };
  const first = await syncMetricoolAnalytics({ env, workspaceDir, fetch: fetcher, now: () => new Date("2026-07-27T15:00:00Z") });
  assert.equal(first.status, "completed");
  assert.equal(first.postsSeen, 3);
  assert.equal(first.metricsRecorded, 2);
  assert.equal(first.unmatchedSkipped, 1);
  assert.equal(first.brands.filter((brand) => brand.connected).length, 2);
  assert.equal(calls.filter((url) => url.includes("analytics/posts/facebook")).length, 2);
  const state = JSON.parse(await readFile(path.join(workspaceDir, "state.json"), "utf8"));
  assert.equal(state.metrics.length, 2);
  assert.equal(state.metrics.find((metric: any) => metric.queueItemId === "queue-1")?.impressions, 42);

  const second = await syncMetricoolAnalytics({ env, workspaceDir, fetch: fetcher, now: () => new Date("2026-07-27T15:01:00Z") });
  assert.equal(second.status, "completed");
  assert.equal(second.metricsRecorded, 0);
  assert.equal(second.duplicatesSkipped, 2);
  const publicStatus = await getMetricoolAnalyticsSyncStatus({ workspaceDir, env: { METRICOOL_ANALYTICS_SYNC_ENABLED: "false" } });
  assert.equal(publicStatus.enabled, false);
  assert.equal(publicStatus.configured, false);
  assert.equal("seen" in publicStatus, false);
});

test("daily scheduler runs at the configured New York time and records a single run per date", async () => {
  let now = new Date("2026-07-27T10:45:00Z");
  let tick: (() => void) | undefined;
  let syncCount = 0;
  const scheduler = createMetricoolAnalyticsScheduler({
    env: { METRICOOL_ANALYTICS_SYNC_HOUR: "6", METRICOOL_ANALYTICS_SYNC_MINUTE: "45" },
    now: () => now,
    setInterval: (callback) => { tick = callback; return { unref() {} }; },
    clearInterval: () => {},
    sync: async () => { syncCount += 1; return { enabled: true, configured: true, lastRunAt: now.toISOString(), lastSuccessAt: now.toISOString(), lastError: null, brands: [], postsSeen: 1, metricsRecorded: 1, duplicatesSkipped: 0, lookbackDays: 30, source: "metricool", status: "completed" }; },
    getUserIds: async () => [],
    recordRun: async () => null,
    log: () => {},
  });
  scheduler.start();
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(syncCount, 1);
  tick?.();
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(syncCount, 1);
  now = new Date("2026-07-28T10:45:00Z");
  tick?.();
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(syncCount, 2);
  scheduler.stop();
});

test("uses a daily 06:45 default and can be disabled without touching credentials", () => {
  assert.deepEqual(getMetricoolAnalyticsSyncConfig({}), { enabled: true, hour: 6, minute: 45, lookbackDays: 30, timeoutMs: 30_000 });
  assert.equal(getMetricoolAnalyticsSyncConfig({ METRICOOL_ANALYTICS_SYNC_ENABLED: "false" }).enabled, false);
});

test("fails closed when credentials exist but neither local-news brand is connected", async () => {
  const workspaceDir = await mkdtemp(path.join(tmpdir(), "metricool-analytics-blocked-"));
  const result = await syncMetricoolAnalytics({
    workspaceDir,
    env: { METRICOOL_USER_TOKEN: "configured-token", METRICOOL_USER_ID: "3558197" },
    fetch: async () => response({ data: [{ blogId: "other", label: "Other Brand" }] }),
    now: () => new Date("2026-07-27T15:00:00Z"),
  });
  assert.equal(result.status, "blocked");
  assert.equal(result.lastError, "metricool_news_brands_not_connected");
  assert.equal(result.metricsRecorded, 0);
});

test("matches an owned post by copy hash when Metricool omits the delivery and queue IDs", async () => {
  const workspaceDir = await mkdtemp(path.join(tmpdir(), "metricool-analytics-copy-match-"));
  const copy = "ESPAÑOL / ENGLISH | Cierre verificado en Miami. Fuente oficial: https://example.gov/road";
  const normalized = copy.normalize("NFKC").replace(/\s+/g, " ").trim().toLocaleLowerCase("es-US");
  const { createHash } = await import("node:crypto");
  const copyHash = createHash("sha256").update(normalized, "utf8").digest("hex");
  await writeFile(path.join(workspaceDir, "metricool-delivery-ledger.json"), JSON.stringify({ entries: [
    { queueItemId: "queue-copy", eventId: "event-copy", lane: "miami-news", platform: "facebook", blogId: "miami-1", metricoolPostId: null, copyHash },
  ] }));
  const result = await syncMetricoolAnalytics({
    workspaceDir,
    env: { METRICOOL_USER_TOKEN: "configured-token", METRICOOL_USER_ID: "3558197" },
    fetch: async (input) => {
      const url = String(input);
      if (url.includes("simpleProfiles")) return response({ data: [{ blogId: "miami-1", label: "Miami News" }] });
      if (url.includes("blogId=miami-1")) return response({ data: [{ id: "provider-id", text: copy, publicationDate: "2026-07-27T14:00:00Z", impressions: 12, reactions: 2 }] });
      return response({ data: [] });
    },
    now: () => new Date("2026-07-27T15:00:00Z"),
  });
  assert.equal(result.status, "partial");
  assert.equal(result.metricsRecorded, 1);
  assert.equal(result.unmatchedSkipped, 0);
});

test("does not advance lastSuccessAt when every connected analytics request fails", async () => {
  const workspaceDir = await mkdtemp(path.join(tmpdir(), "metricool-analytics-errors-"));
  const env = { METRICOOL_USER_TOKEN: "configured-token", METRICOOL_USER_ID: "3558197" };
  const now = new Date("2026-07-27T15:00:00Z");
  const result = await syncMetricoolAnalytics({
    workspaceDir,
    env,
    fetch: async (input) => String(input).includes("simpleProfiles")
      ? response({ data: [{ blogId: "miami-1", label: "Miami News" }, { blogId: "ny-1", label: "New York News" }] })
      : response({ error: "denied" }, 403),
    now: () => now,
  });
  assert.equal(result.status, "partial");
  assert.equal(result.lastSuccessAt, null);
  assert.match(result.lastError || "", /plan_required/);
});

test("serializes overlapping manual and scheduled sync calls", async () => {
  const workspaceDir = await mkdtemp(path.join(tmpdir(), "metricool-analytics-lock-"));
  let profileCalls = 0;
  const fetcher: typeof fetch = async (input) => {
    const url = String(input);
    if (url.includes("simpleProfiles")) {
      profileCalls += 1;
      await new Promise((resolve) => setTimeout(resolve, 20));
      return response({ data: [] });
    }
    return response({ data: [] });
  };
  const env = { METRICOOL_USER_TOKEN: "configured-token", METRICOOL_USER_ID: "3558197" };
  const [first, second] = await Promise.all([
    syncMetricoolAnalytics({ env, workspaceDir, fetch: fetcher, now: () => new Date("2026-07-27T15:00:00Z") }),
    syncMetricoolAnalytics({ env, workspaceDir, fetch: fetcher, now: () => new Date("2026-07-27T15:00:01Z") }),
  ]);
  assert.equal(profileCalls, 1);
  assert.equal(first.status, "blocked");
  assert.deepEqual(second, first);
});

test("server startup wires the Metricool analytics scheduler", async () => {
  const source = await readFile(new URL("../server/index.ts", import.meta.url), "utf8");
  assert.match(source, /import \{ startMetricoolAnalyticsScheduler \} from "\.\/metricool-analytics-sync";/);
  assert.match(source, /startClipperLocalNewsScheduler\(\);\s+startMetricoolAnalyticsScheduler\(\);/);
});
