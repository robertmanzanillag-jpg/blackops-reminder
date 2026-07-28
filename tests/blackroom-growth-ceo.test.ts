import assert from "node:assert/strict";
import test from "node:test";
import {
  BLACKROOM_CEO_MIN_SAMPLES,
  BLACKROOM_CEO_ANALYTICS_LOOKBACK_DAYS,
  BLACKROOM_CEO_CREATIVE_MIN_SAMPLES,
  buildBlackRoomLearningSlots,
  collectBlackRoomMetricoolAnalytics,
  extractBlackRoomBestTimes,
  extractBlackRoomMetricSamples,
  extractBlackRoomViewSamples,
  planBlackRoomCreativeLearning,
  planBlackRoomCampaignPosts,
  planBlackRoomNetworkLearning,
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
  assert.equal(calls.filter((name) => name === "get_best_times_to_post").length, 3);
  assert.equal(BLACKROOM_CEO_ANALYTICS_LOOKBACK_DAYS, 30);
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
