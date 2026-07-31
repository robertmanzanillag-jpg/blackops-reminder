import assert from "node:assert/strict";
import test from "node:test";
import {
  BLACKROOM_CEO_MIN_SAMPLES,
  BLACKROOM_CEO_ANALYTICS_LOOKBACK_DAYS,
  BLACKROOM_CEO_ANALYTICS_HISTORY_START_DATE,
  BLACKROOM_CEO_CREATIVE_MIN_SAMPLES,
  buildBlackRoomLearningSlots,
  collectBlackRoomMetricoolAnalytics,
  extractBlackRoomBestTimes,
  extractBlackRoomMetricSamples,
  extractBlackRoomViewSamples,
  planBlackRoomCreativeLearning,
  planBlackRoomCampaignPosts,
  planBlackRoomNetworkLearning,
  recommendBlackRoomTimesFromImportedSamples,
} from "../server/blackroom-growth-ceo";

function minutes(time: string): number {
  const [hour, minute] = time.split(":").map(Number);
  return hour * 60 + minute;
}

test("five-post baseline exploration slots cover overnight, morning, afternoon and night", () => {
  const slots = buildBlackRoomLearningSlots({ dayIndex: 0 });
  assert.equal(slots.length, 5);
  assert.ok(slots.some((slot) => minutes(slot) < 6 * 60));
  assert.ok(slots.some((slot) => minutes(slot) >= 6 * 60 && minutes(slot) < 12 * 60));
  assert.ok(slots.some((slot) => minutes(slot) >= 12 * 60 && minutes(slot) < 18 * 60));
  assert.ok(slots.some((slot) => minutes(slot) >= 18 * 60));
  for (let index = 1; index < slots.length; index += 1) assert.ok(minutes(slots[index]) - minutes(slots[index - 1]) >= 90);
});

test("CSV fallback feeds the CEO without Metricool analytics API availability", async () => {
  const imported = {
    tiktok: [
      { id: "tt-1", views: 9, publishedAt: "2026-07-27T03:31:00", durationSeconds: 30 },
      { id: "tt-2", views: 205, publishedAt: "2026-07-28T09:30:00", durationSeconds: 30 },
    ],
    facebook: [
      { id: "fb-1", views: 12, publishedAt: "2026-07-27T14:01:00" },
      { id: "fb-2", views: 100, publishedAt: "2026-07-28T19:05:00" },
    ],
    youtube: [
      { id: "yt-1", views: 63, publishedAt: "2026-07-27T08:02:00" },
      { id: "yt-2", views: 149, publishedAt: "2026-07-28T14:03:00" },
    ],
  };
  const analytics = await collectBlackRoomMetricoolAnalytics({
    fetch: (async () => { throw new Error("MCP unavailable"); }) as typeof fetch,
    importedSamplesByNetwork: imported,
    now: new Date("2026-07-30T12:00:00.000Z"),
  });
  assert.equal(analytics.sampleCount, 6);
  assert.equal(analytics.comparableSampleCount, 2);
  assert.deepEqual(analytics.networkSamples, { tiktok: 2, facebook: 2, youtube: 2 });
  assert.deepEqual(analytics.importedSamplesByNetwork, { tiktok: 2, facebook: 2, youtube: 2 });
  assert.equal(analytics.tiktokMedianViews, 107);
  assert.ok(analytics.recommendedTimes.includes("09:30"));
  assert.match(analytics.reason, /puente CSV local aportó 6 resultados sin usar IA ni API pagada/);
});

test("CSV time recommendations rank high-view publishing buckets deterministically", () => {
  assert.deepEqual(recommendBlackRoomTimesFromImportedSamples([
    { id: "a", views: 10, publishedAt: "2026-07-27T03:31:00" },
    { id: "b", views: 200, publishedAt: "2026-07-28T09:29:00" },
    { id: "c", views: 100, publishedAt: "2026-07-29T09:31:00" },
  ]), ["09:30", "03:30"]);
});

test("collects each network through discovered Metricool MCP tools and totals usable historical samples", async () => {
  const calls: string[] = [];
  const fetcher = (async (_url: string | URL | Request, init?: RequestInit) => {
    const request = JSON.parse(String(init?.body || "{}"));
    if (request.method === "tools/list") {
      return new Response(JSON.stringify({ result: { tools: [
        { name: "get_tiktoks", inputSchema: { properties: { blogId: {}, userId: {}, startDate: {}, endDate: {} } } },
        { name: "get_posts", inputSchema: { properties: { blogId: {}, network: {}, start: {}, end: {} } } },
        { name: "get_videos", inputSchema: { properties: { brand_id: {}, platform: {}, from: {}, to: {} } } },
        { name: "get_best_times_to_post", inputSchema: { properties: { blogId: {}, network: {}, timezone: {} } } },
      ] } }), { headers: { "content-type": "application/json" } });
    }
    const name = request.params.name as string;
    calls.push(name);
    const count = name === "get_tiktoks" ? 3 : name === "get_posts" ? 2 : name === "get_videos" ? 4 : 1;
    const payload = name === "get_best_times_to_post"
      ? { data: [{ time: "18:30", score: 0.8 }] }
      : { data: Array.from({ length: count }, (_, index) => ({ id: `${name}-${index}`, views: index + 1 })) };
    return new Response(JSON.stringify({ result: { content: [{ type: "text", text: JSON.stringify(payload) }] } }), { headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  const analytics = await collectBlackRoomMetricoolAnalytics({
    fetch: fetcher,
    env: { METRICOOL_USER_TOKEN: "secure-test-token", METRICOOL_USER_ID: "user-1" },
    now: new Date("2026-07-22T12:00:00.000Z"),
  });
  assert.equal(analytics.sampleCount, 9);
  assert.equal(analytics.comparableSampleCount, 2);
  assert.deepEqual(analytics.networkSamples, { tiktok: 3, facebook: 2, youtube: 4 });
  assert.deepEqual(analytics.recommendedTimes, ["18:30"]);
  assert.deepEqual(analytics.recommendedTimesByNetwork, { tiktok: ["18:30"], facebook: ["18:30"], youtube: ["18:30"] });
  assert.deepEqual(analytics.networkDailyTargets, { tiktok: 5, facebook: 5, youtube: 5 });
  assert.deepEqual(analytics.historyCompleteByNetwork, { tiktok: true, facebook: true, youtube: true });
  assert.deepEqual(analytics.historyRequestsByNetwork, { tiktok: 1, facebook: 1, youtube: 1 });
  assert.equal(analytics.historyStartDate, BLACKROOM_CEO_ANALYTICS_HISTORY_START_DATE);
  assert.equal(calls.filter((name) => name === "get_best_times_to_post").length, 3);
  assert.equal(BLACKROOM_CEO_ANALYTICS_LOOKBACK_DAYS, 30);
});

test("reads the current Metricool analytics contract and supplies metric IDs per network connector", async () => {
  const calls: Array<{ name: string; args: Record<string, any> }> = [];
  const fetcher = (async (_url: string | URL | Request, init?: RequestInit) => {
    const request = JSON.parse(String(init?.body || "{}"));
    if (request.method === "tools/list") {
      return new Response(JSON.stringify({ result: { tools: [
        {
          name: "getAnalyticsAvailableMetrics",
          inputSchema: { properties: { connector: { type: "string" }, network: { type: "string" } } },
        },
        {
          name: "getAnalyticsDataByMetrics",
          inputSchema: { properties: {
            brandId: { type: "string" },
            from: { type: "string", description: "ISO 8601 date-time" },
            to: { type: "string", description: "ISO 8601 date-time" },
            metrics: { type: "array" },
          } },
        },
        {
          name: "getBestTimeToPostByNetwork",
          inputSchema: { properties: {
            brandId: { type: "string" },
            fromDate: { type: "string", description: "ISO 8601 date-time" },
            toDate: { type: "string", description: "ISO 8601 date-time" },
            socialNetwork: { type: "string" },
            timezone: { type: "string" },
          } },
        },
      ] } }), { headers: { "content-type": "application/json" } });
    }
    const name = String(request.params.name);
    const args = request.params.arguments as Record<string, any>;
    calls.push({ name, args });
    if (name === "getAnalyticsAvailableMetrics") {
      const prefix = `${args.network}-${args.connector}`;
      return new Response(JSON.stringify({ result: { content: [{ type: "text", text: JSON.stringify({
        data: [
          { fieldId: `${prefix}-views`, displayName: "Video views" },
          { fieldId: `${prefix}-id`, displayName: "Video ID" },
        ],
      }) }] } }), { headers: { "content-type": "application/json" } });
    }
    if (name === "getAnalyticsDataByMetrics") {
      const metricId = String(args.metrics[0]);
      return new Response(JSON.stringify({ result: { content: [{ type: "text", text: JSON.stringify({
        data: {
          [metricId]: [
            { postId: `${metricId}-1`, value: 12 },
            { postId: `${metricId}-2`, value: 24 },
          ],
        },
      }) }] } }), { headers: { "content-type": "application/json" } });
    }
    return new Response(JSON.stringify({ result: { content: [{ type: "text", text: JSON.stringify({
      data: [{ time: "19:30", score: 0.9 }],
    }) }] } }), { headers: { "content-type": "application/json" } });
  }) as typeof fetch;

  const analytics = await collectBlackRoomMetricoolAnalytics({
    fetch: fetcher,
    env: { METRICOOL_USER_TOKEN: "secure-test-token" },
    now: new Date("2026-07-29T12:00:00.000Z"),
  });

  assert.deepEqual(analytics.networkSamples, { tiktok: 2, facebook: 4, youtube: 2 });
  assert.deepEqual(analytics.historyRequestsByNetwork, { tiktok: 1, facebook: 2, youtube: 1 });
  assert.equal(analytics.sampleCount, 8);
  assert.equal(analytics.comparableSampleCount, 2);
  assert.deepEqual(analytics.recommendedTimes, ["19:30"]);
  const availableCalls = calls.filter((call) => call.name === "getAnalyticsAvailableMetrics");
  assert.deepEqual(
    availableCalls.map((call) => `${call.args.network}:${call.args.connector}`),
    ["tiktok:posts", "facebook:posts", "facebook:reels", "youtube:videos"],
  );
  const dataCalls = calls.filter((call) => call.name === "getAnalyticsDataByMetrics");
  assert.equal(dataCalls.length, 4);
  assert.ok(dataCalls.every((call) => call.args.brandId === "6585226"));
  assert.ok(dataCalls.every((call) => Array.isArray(call.args.metrics) && call.args.metrics.length === 2));
  assert.ok(dataCalls.every((call) => String(call.args.metrics[0]).endsWith("-views")));
  assert.ok(dataCalls.every((call) => String(call.args.metrics[1]).endsWith("-id")));
  assert.ok(dataCalls.every((call) => /T00:00:00-0[45]:00$/.test(call.args.from)));
  assert.ok(dataCalls.every((call) => /T23:59:59-0[45]:00$/.test(call.args.to)));
  const bestTimeCalls = calls.filter((call) => call.name === "getBestTimeToPostByNetwork");
  assert.equal(bestTimeCalls.length, 3);
  assert.deepEqual(bestTimeCalls.map((call) => call.args.socialNetwork), ["tiktok", "facebook", "youtube"]);
  assert.ok(bestTimeCalls.every((call) => call.args.timezone === "America/New_York"));
  assert.ok(bestTimeCalls.every((call) => call.args.fromDate.startsWith("2026-07-22T")));
});

test("uses Metricool's coded post identity field instead of counting aggregate date rows as posts", async () => {
  const fetcher = (async (_url: string | URL | Request, init?: RequestInit) => {
    const request = JSON.parse(String(init?.body || "{}"));
    if (request.method === "tools/list") {
      return new Response(JSON.stringify({ result: { tools: [
        {
          name: "getAnalyticsAvailableMetrics",
          inputSchema: { properties: { connector: { type: "string" }, network: { type: "string" } } },
        },
        {
          name: "getAnalyticsDataByMetrics",
          inputSchema: { properties: {
            brandId: { type: "string" },
            from: { type: "string" },
            to: { type: "string" },
            metrics: { type: "array" },
          } },
        },
      ] } }), { headers: { "content-type": "application/json" } });
    }
    if (request.params.name === "getAnalyticsAvailableMetrics") {
      const prefix = `${request.params.arguments.network}-${request.params.arguments.connector}`;
      return new Response(JSON.stringify({ result: { content: [{ type: "text", text: JSON.stringify({
        data: [
          { fieldId: `${prefix}-views`, displayName: "Views" },
          { fieldId: `${prefix}-identity`, displayName: "Post ID" },
        ],
      }) }] } }), { headers: { "content-type": "application/json" } });
    }
    const [viewsField, identityField] = request.params.arguments.metrics;
    return new Response(JSON.stringify({ result: { content: [{ type: "text", text: JSON.stringify({
      data: [
        { [identityField]: `${identityField}-post-1`, [viewsField]: 20 },
        { [identityField]: `${identityField}-post-2`, [viewsField]: 40 },
        { date: "2026-07-29", [viewsField]: 60 },
      ],
    }) }] } }), { headers: { "content-type": "application/json" } });
  }) as typeof fetch;

  const analytics = await collectBlackRoomMetricoolAnalytics({
    fetch: fetcher,
    env: { METRICOOL_USER_TOKEN: "secure-test-token" },
    now: new Date("2026-07-29T12:00:00.000Z"),
  });

  assert.deepEqual(analytics.networkSamples, { tiktok: 2, facebook: 4, youtube: 2 });
  assert.equal(analytics.sampleCount, 8);
});

test("joins Metricool's separate views and post-identity timelines by publication timestamp", async () => {
  const fetcher = (async (_url: string | URL | Request, init?: RequestInit) => {
    const request = JSON.parse(String(init?.body || "{}"));
    if (request.method === "tools/list") {
      return new Response(JSON.stringify({ result: { tools: [
        {
          name: "getAnalyticsAvailableMetrics",
          inputSchema: { properties: { connector: { type: "string" }, network: { type: "string" } } },
        },
        {
          name: "getAnalyticsDataByMetrics",
          inputSchema: { properties: {
            brandId: { type: "string" },
            from: { type: "string" },
            to: { type: "string" },
            metrics: { type: "array" },
          } },
        },
      ] } }), { headers: { "content-type": "application/json" } });
    }
    if (request.params.name === "getAnalyticsAvailableMetrics") {
      const prefix = `${request.params.arguments.network}-${request.params.arguments.connector}`;
      return new Response(JSON.stringify({ result: { content: [{ type: "text", text: JSON.stringify({
        data: [
          { fieldId: `${prefix}-views`, displayName: "Video views" },
          { fieldId: `${prefix}-url`, displayName: "Post permalink" },
        ],
      }) }] } }), { headers: { "content-type": "application/json" } });
    }
    const [viewsField, identityField] = request.params.arguments.metrics;
    return new Response(JSON.stringify({ result: { content: [{ type: "text", text: JSON.stringify({
      data: {
        [viewsField]: [{
          values: [
            { dateTime: "2026-07-27T14:00:00-04:00", value: 20 },
            { dateTime: "2026-07-28T16:30:00-04:00", value: 40 },
          ],
        }],
        [identityField]: [{
          values: [
            { dateTime: "2026-07-27T14:00:00-04:00", value: `https://social.example/${identityField}/1` },
            { dateTime: "2026-07-28T16:30:00-04:00", value: `https://social.example/${identityField}/2` },
          ],
        }],
      },
    }) }] } }), { headers: { "content-type": "application/json" } });
  }) as typeof fetch;

  const analytics = await collectBlackRoomMetricoolAnalytics({
    fetch: fetcher,
    env: { METRICOOL_USER_TOKEN: "secure-test-token" },
    now: new Date("2026-07-29T12:00:00.000Z"),
  });

  assert.deepEqual(analytics.networkSamples, { tiktok: 2, facebook: 4, youtube: 2 });
  assert.equal(analytics.sampleCount, 8);
  assert.equal(analytics.comparableSampleCount, 2);
  assert.equal(analytics.tiktokMedianViews, 30);
});

test("does not join separate Metricool daily aggregate timelines as individual posts", async () => {
  const fetcher = (async (_url: string | URL | Request, init?: RequestInit) => {
    const request = JSON.parse(String(init?.body || "{}"));
    if (request.method === "tools/list") {
      return new Response(JSON.stringify({ result: { tools: [
        {
          name: "getAnalyticsAvailableMetrics",
          inputSchema: { properties: { connector: { type: "string" }, network: { type: "string" } } },
        },
        {
          name: "getAnalyticsDataByMetrics",
          inputSchema: { properties: {
            brandId: { type: "string" },
            from: { type: "string" },
            to: { type: "string" },
            metrics: { type: "array" },
          } },
        },
      ] } }), { headers: { "content-type": "application/json" } });
    }
    if (request.params.name === "getAnalyticsAvailableMetrics") {
      const prefix = `${request.params.arguments.network}-${request.params.arguments.connector}`;
      return new Response(JSON.stringify({ result: { content: [{ type: "text", text: JSON.stringify({
        data: [
          { fieldId: `${prefix}-views`, displayName: "Video views" },
          { fieldId: `${prefix}-url`, displayName: "Post permalink" },
        ],
      }) }] } }), { headers: { "content-type": "application/json" } });
    }
    const [viewsField, identityField] = request.params.arguments.metrics;
    return new Response(JSON.stringify({ result: { content: [{ type: "text", text: JSON.stringify({
      data: {
        [viewsField]: [{ values: [
          { date: "2026-07-27", value: 20 },
          { date: "2026-07-28", value: 40 },
        ] }],
        [identityField]: [{ values: [
          { date: "2026-07-27", value: `https://social.example/${identityField}/1` },
          { date: "2026-07-28", value: `https://social.example/${identityField}/2` },
        ] }],
      },
    }) }] } }), { headers: { "content-type": "application/json" } });
  }) as typeof fetch;

  const analytics = await collectBlackRoomMetricoolAnalytics({
    fetch: fetcher,
    env: { METRICOOL_USER_TOKEN: "secure-test-token" },
    now: new Date("2026-07-29T12:00:00.000Z"),
  });

  assert.deepEqual(analytics.networkSamples, { tiktok: 0, facebook: 0, youtube: 0 });
  assert.equal(analytics.sampleCount, 0);
});

test("paginates and deduplicates every available Metricool history page", async () => {
  const pages: Record<string, number[]> = { get_tiktoks: [], get_posts: [], get_videos: [] };
  const fetcher = (async (_url: string | URL | Request, init?: RequestInit) => {
    const request = JSON.parse(String(init?.body || "{}"));
    if (request.method === "tools/list") {
      return new Response(JSON.stringify({ result: { tools: [
        { name: "get_tiktoks", inputSchema: { properties: { blogId: {}, startDate: {}, endDate: {}, page: {}, pageSize: {} } } },
        { name: "get_posts", inputSchema: { properties: { blogId: {}, network: {}, start: {}, end: {}, page: {}, pageSize: {} } } },
        { name: "get_videos", inputSchema: { properties: { brand_id: {}, platform: {}, from: {}, to: {}, page: {}, pageSize: {} } } },
      ] } }), { headers: { "content-type": "application/json" } });
    }
    const name = request.params.name as keyof typeof pages;
    const page = Number(request.params.arguments.page);
    pages[name].push(page);
    const data = page === 1
      ? Array.from({ length: 100 }, (_, index) => ({ id: `${name}-${index}`, views: index + 1 }))
      : [{ id: `${name}-99`, views: 100 }, { id: `${name}-100`, views: 101 }];
    return new Response(JSON.stringify({ result: { content: [{ type: "text", text: JSON.stringify({ data }) }] } }), { headers: { "content-type": "application/json" } });
  }) as typeof fetch;

  const analytics = await collectBlackRoomMetricoolAnalytics({
    fetch: fetcher,
    env: { METRICOOL_USER_TOKEN: "secure-test-token" },
    now: new Date("2026-07-28T12:00:00.000Z"),
  });

  assert.deepEqual(pages, { get_tiktoks: [1, 2], get_posts: [1, 2], get_videos: [1, 2] });
  assert.deepEqual(analytics.networkSamples, { tiktok: 101, facebook: 101, youtube: 101 });
  assert.equal(analytics.sampleCount, 303);
  assert.deepEqual(analytics.historyCompleteByNetwork, { tiktok: true, facebook: true, youtube: true });
  assert.deepEqual(analytics.historyRequestsByNetwork, { tiktok: 2, facebook: 2, youtube: 2 });
});

test("does not claim complete history when Metricool repeats a page that still has more results", async () => {
  const fetcher = (async (_url: string | URL | Request, init?: RequestInit) => {
    const request = JSON.parse(String(init?.body || "{}"));
    if (request.method === "tools/list") {
      return new Response(JSON.stringify({ result: { tools: [
        { name: "getAnalyticsDataByMetrics", inputSchema: { properties: { network: {}, startDate: {}, endDate: {}, page: {}, pageSize: {} } } },
      ] } }), { headers: { "content-type": "application/json" } });
    }
    const network = String(request.params.arguments.network);
    const data = Array.from({ length: 100 }, (_, index) => ({ id: `${network}-${index}`, views: index + 1 }));
    return new Response(JSON.stringify({ result: { content: [{ type: "text", text: JSON.stringify({
      data,
      hasMore: true,
      total: 500,
    }) }] } }), { headers: { "content-type": "application/json" } });
  }) as typeof fetch;

  const analytics = await collectBlackRoomMetricoolAnalytics({
    fetch: fetcher,
    env: { METRICOOL_USER_TOKEN: "secure-test-token" },
    now: new Date("2026-07-28T12:00:00.000Z"),
  });

  assert.deepEqual(analytics.networkSamples, { tiktok: 100, facebook: 100, youtube: 100 });
  assert.deepEqual(analytics.historyRequestsByNetwork, { tiktok: 2, facebook: 4, youtube: 2 });
  assert.deepEqual(analytics.historyCompleteByNetwork, { tiktok: false, facebook: false, youtube: false });
  assert.match(analytics.reason, /Historial importado parcialmente/);
});

test("does not mistake Metricool's available-metrics catalog for published post data", async () => {
  const fetcher = (async (_url: string | URL | Request, init?: RequestInit) => {
    const request = JSON.parse(String(init?.body || "{}"));
    if (request.method === "tools/list") {
      return new Response(JSON.stringify({ result: { tools: [
        { name: "get_metrics", inputSchema: { properties: { network: { type: "string" } } } },
      ] } }), { headers: { "content-type": "application/json" } });
    }
    throw new Error("catalog tool must not be called as analytics data");
  }) as typeof fetch;

  await assert.rejects(
    collectBlackRoomMetricoolAnalytics({
      fetch: fetcher,
      env: { METRICOOL_USER_TOKEN: "secure-test-token" },
    }),
    /does not expose a compatible metrics tool/,
  );
});

test("splits a capped date range until the full historical cohort is available", async () => {
  const calls: Record<string, Array<{ start?: string; end?: string }>> = { get_tiktoks: [], get_posts: [], get_videos: [] };
  const fetcher = (async (_url: string | URL | Request, init?: RequestInit) => {
    const request = JSON.parse(String(init?.body || "{}"));
    if (request.method === "tools/list") {
      return new Response(JSON.stringify({ result: { tools: [
        { name: "get_tiktoks", inputSchema: { properties: { startDate: {}, endDate: {} } } },
        { name: "get_posts", inputSchema: { properties: { start: {}, end: {} } } },
        { name: "get_videos", inputSchema: { properties: { from: {}, to: {} } } },
      ] } }), { headers: { "content-type": "application/json" } });
    }
    const name = request.params.name as keyof typeof calls;
    const args = request.params.arguments as Record<string, string>;
    const start = args.startDate || args.start || args.from;
    const end = args.endDate || args.end || args.to;
    calls[name].push({ start, end });
    let data: Array<{ id: string; views: number }>;
    if (name === "get_tiktoks" && start === BLACKROOM_CEO_ANALYTICS_HISTORY_START_DATE && end === "2026-07-28") {
      data = Array.from({ length: 100 }, (_, index) => ({ id: `capped-${index}`, views: index }));
    } else if (name === "get_tiktoks") {
      data = Array.from({ length: 60 }, (_, index) => ({ id: `${start}-${index}`, views: index }));
    } else {
      data = [{ id: `${name}-historical`, views: 20 }];
    }
    return new Response(JSON.stringify({ result: { content: [{ type: "text", text: JSON.stringify({ data }) }] } }), { headers: { "content-type": "application/json" } });
  }) as typeof fetch;

  const analytics = await collectBlackRoomMetricoolAnalytics({
    fetch: fetcher,
    env: { METRICOOL_USER_TOKEN: "secure-test-token" },
    now: new Date("2026-07-28T12:00:00.000Z"),
  });

  assert.equal(calls.get_tiktoks.length, 3);
  assert.equal(calls.get_tiktoks[0].start, BLACKROOM_CEO_ANALYTICS_HISTORY_START_DATE);
  assert.equal(analytics.networkSamples.tiktok, 120);
  assert.equal(analytics.historyCompleteByNetwork?.tiktok, true);
  assert.equal(analytics.historyRequestsByNetwork?.tiktok, 3);
});

test("falls back to the recent retention window when Metricool rejects full history", async () => {
  const starts: string[] = [];
  const fetcher = (async (_url: string | URL | Request, init?: RequestInit) => {
    const request = JSON.parse(String(init?.body || "{}"));
    if (request.method === "tools/list") {
      return new Response(JSON.stringify({ result: { tools: [
        { name: "get_tiktok_videos", inputSchema: { properties: { init_date: {}, end_date: {} } } },
        { name: "get_facebook_posts", inputSchema: { properties: { init_date: {}, end_date: {} } } },
        { name: "get_youtube_videos", inputSchema: { properties: { init_date: {}, end_date: {} } } },
      ] } }), { headers: { "content-type": "application/json" } });
    }
    const start = String(request.params.arguments.init_date);
    starts.push(start);
    if (start === BLACKROOM_CEO_ANALYTICS_HISTORY_START_DATE) {
      return new Response(JSON.stringify({ error: { message: "date range exceeds plan retention" } }), {
        headers: { "content-type": "application/json" },
      });
    }
    const name = String(request.params.name);
    return new Response(JSON.stringify({ result: { content: [{ type: "text", text: JSON.stringify({
      data: [{ id: `${name}-recent`, views: 20 }],
    }) }] } }), { headers: { "content-type": "application/json" } });
  }) as typeof fetch;

  const analytics = await collectBlackRoomMetricoolAnalytics({
    fetch: fetcher,
    env: { METRICOOL_USER_TOKEN: "secure-test-token" },
    now: new Date("2026-07-29T12:00:00.000Z"),
  });

  assert.deepEqual(analytics.networkSamples, { tiktok: 1, facebook: 1, youtube: 1 });
  assert.ok(starts.includes(BLACKROOM_CEO_ANALYTICS_HISTORY_START_DATE));
  assert.ok(starts.includes("2026-06-29"));
  assert.deepEqual(analytics.historyCompleteByNetwork, { tiktok: false, facebook: false, youtube: false });
  assert.match(analytics.reason, /Historial importado parcialmente/);
});

test("keeps Facebook and YouTube learning data when one Metricool network temporarily fails", async () => {
  const fetcher = (async (_url: string | URL | Request, init?: RequestInit) => {
    const request = JSON.parse(String(init?.body || "{}"));
    if (request.method === "tools/list") {
      return new Response(JSON.stringify({ result: { tools: [
        { name: "get_tiktoks", inputSchema: { properties: {} } },
        { name: "get_posts", inputSchema: { properties: {} } },
        { name: "get_videos", inputSchema: { properties: {} } },
      ] } }), { headers: { "content-type": "application/json" } });
    }
    const name = request.params.name as string;
    if (name === "get_tiktoks") return new Response(JSON.stringify({ error: { message: "TikTok is reconnecting" } }), { headers: { "content-type": "application/json" } });
    const count = name === "get_posts" ? 4 : 3;
    const payload = { data: Array.from({ length: count }, (_, index) => ({ permalink: `${name}-${index}`, video_views: index + 10 })) };
    return new Response(JSON.stringify({ result: { content: [{ type: "text", text: JSON.stringify(payload) }] } }), { headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  const analytics = await collectBlackRoomMetricoolAnalytics({
    fetch: fetcher,
    env: { METRICOOL_USER_TOKEN: "secure-test-token" },
  });
  assert.equal(analytics.sampleCount, 7);
  assert.equal(analytics.comparableSampleCount, 0);
  assert.equal(analytics.confidence, "collecting");
  assert.deepEqual(analytics.networkSamples, { tiktok: 0, facebook: 4, youtube: 3 });
  assert.match(analytics.networkErrors?.tiktok || "", /reconnecting/);
});

test("CEO keeps the baseline when imported samples are not comparable across all networks", () => {
  const analytics = {
    sampleCount: 21,
    comparableSampleCount: 0,
    networkMedianViews: { tiktok: 0, facebook: 100, youtube: 100 },
    networkLowViewRate: { tiktok: 0, facebook: 0.1, youtube: 0.1 },
  };
  assert.equal(planBlackRoomCampaignPosts({ dayIndex: 2, analytics }), 5);
  assert.deepEqual(
    buildBlackRoomLearningSlots({ dayIndex: 0, sampleCount: analytics.comparableSampleCount, recommendedTimes: ["12:34"] }),
    buildBlackRoomLearningSlots({ dayIndex: 0 }),
  );
});

test("CEO does not optimize times before the minimum comparable sample", () => {
  const collecting = buildBlackRoomLearningSlots({ dayIndex: 0, sampleCount: BLACKROOM_CEO_MIN_SAMPLES - 1, recommendedTimes: ["12:34"] });
  const baseline = buildBlackRoomLearningSlots({ dayIndex: 0 });
  assert.deepEqual(collecting, baseline);
});

test("CEO keeps per-network targets at five until comparable evidence exists", () => {
  const result = planBlackRoomNetworkLearning({
    viewsByNetwork: {
      tiktok: [1, 2, 3, 4, 5, 6],
      facebook: [50, 80, 100, 120, 150],
      youtube: [20, 30, 40, 60, 80],
    },
  });
  assert.deepEqual(result.networkDailyTargets, { tiktok: 5, facebook: 5, youtube: 5 });
  assert.equal(result.networkMedianViews.tiktok, 3.5);
  assert.equal(result.networkLowViewRate.tiktok, 1);
});

test("CEO uses five as the baseline and only schedules two controlled seven-post days", () => {
  const analytics = {
    sampleCount: BLACKROOM_CEO_MIN_SAMPLES,
    networkMedianViews: { tiktok: 5, facebook: 100, youtube: 80 },
    networkLowViewRate: { tiktok: 0.8, facebook: 0.1, youtube: 0.2 },
  };
  assert.equal(planBlackRoomCampaignPosts({ dayIndex: 0, analytics }), 5);
  assert.equal(planBlackRoomCampaignPosts({ dayIndex: 2, analytics }), 7);
  assert.equal(planBlackRoomCampaignPosts({ dayIndex: 9, analytics }), 7);
  assert.equal(planBlackRoomCampaignPosts({ dayIndex: 10, analytics }), 5);
  assert.equal(planBlackRoomCampaignPosts({ dayIndex: 2, analytics: { ...analytics, sampleCount: 20 } }), 5);
});


test("CEO changes at most two slots after 21 samples and preserves circular spacing", () => {
  const baseline = buildBlackRoomLearningSlots({ dayIndex: 0 });
  const learned = buildBlackRoomLearningSlots({
    dayIndex: 0,
    sampleCount: BLACKROOM_CEO_MIN_SAMPLES,
    recommendedTimes: ["01:15", "12:00", "19:00", "23:00"],
  });
  assert.ok(learned.filter((slot) => !baseline.includes(slot)).length <= 2);
  const values = learned.map(minutes);
  const gaps = values.map((value, index) => index === values.length - 1 ? 1440 - value + values[0] : values[index + 1] - value);
  assert.ok(gaps.every((gap) => gap >= 90));
});

test("Metricool payload extraction deduplicates posts and ranks best times", () => {
  assert.equal(extractBlackRoomMetricSamples({ posts: [
    { id: "a", views: 3 }, { id: "a", views: 3 }, { postId: "b", impressions: 20 }, { id: "c" },
  ] }), 2);
  assert.deepEqual(extractBlackRoomBestTimes({ data: [
    { time: "18:30", score: 0.8 }, { hour: 2, score: 0.4 }, { time: "12:15", score: 0.9 },
  ] }), ["12:15", "18:30", "02:00"]);
});

test("CEO waits for enough TikTok evidence before changing creative technique", () => {
  const result = planBlackRoomCreativeLearning({
    views: Array(BLACKROOM_CEO_CREATIVE_MIN_SAMPLES - 1).fill(3),
    now: new Date("2026-07-22T12:00:00.000Z"),
  });
  assert.equal(result.creativeStrategy, "drop_first");
  assert.equal(result.creativeStrategyVersion, 0);
});

test("CEO rotates technique only after a fresh low-performing sample window", () => {
  const now = new Date("2026-07-22T12:00:00.000Z");
  const first = planBlackRoomCreativeLearning({ views: [2, 3, 4, 5, 6], now });
  assert.equal(first.creativeStrategy, "instant_drop");
  assert.equal(first.creativeStrategyVersion, 1);
  assert.equal(first.creativeStrategySampleBaseline, 5);

  const tooSoon = planBlackRoomCreativeLearning({ views: [2, 3, 4, 5, 6, 7], previous: first, now });
  assert.equal(tooSoon.creativeStrategy, "instant_drop");

  const next = planBlackRoomCreativeLearning({ views: [2, 3, 4, 5, 6, 7, 8, 9], previous: first, now });
  assert.equal(next.creativeStrategy, "build_then_drop");
  assert.equal(next.creativeStrategyVersion, 2);
});

test("CEO recognizes new TikTok posts even when the rolling window keeps the same size", () => {
  const now = new Date("2026-07-22T12:00:00.000Z");
  const first = planBlackRoomCreativeLearning({
    views: [2, 3, 4, 5, 6], postIds: ["p1", "p2", "p3", "p4", "p5"], now,
  });
  const next = planBlackRoomCreativeLearning({
    views: [4, 5, 6, 7, 8], postIds: ["p3", "p4", "p5", "p6", "p7"], previous: first, now,
  });
  assert.equal(next.creativeStrategy, "instant_drop");
  const rotated = planBlackRoomCreativeLearning({
    views: [5, 6, 7, 8, 9], postIds: ["p4", "p5", "p6", "p7", "p8"], previous: first, now,
  });
  assert.equal(rotated.creativeStrategy, "build_then_drop");
  assert.equal(rotated.creativeStrategyVersion, 2);
});

test("CEO keeps the current technique when its new cohort performs well", () => {
  const now = new Date("2026-07-22T12:00:00.000Z");
  const first = planBlackRoomCreativeLearning({
    views: [2, 3, 4, 5, 6], postIds: ["old1", "old2", "old3", "old4", "old5"], now,
  });
  const improved = planBlackRoomCreativeLearning({
    views: [2, 3, 4, 5, 6, 100, 100, 100],
    postIds: ["old1", "old2", "old3", "old4", "old5", "new1", "new2", "new3"],
    previous: first,
    now,
  });
  assert.equal(improved.creativeStrategy, "instant_drop");
  assert.equal(improved.creativeStrategyVersion, 1);
  assert.equal(improved.tiktokMedianViews, 100);
  assert.equal(improved.tiktokLowViewRate, 0);
});

test("TikTok view extraction deduplicates posts and ignores missing metrics", () => {
  assert.deepEqual(extractBlackRoomViewSamples({ posts: [
    { id: "a", views: 3 }, { id: "a", views: 7 }, { postId: "b", viewCount: 12 }, { id: "c", impressions: 99 },
  ] }), [7, 12]);
});
