import assert from "node:assert/strict";
import test from "node:test";
import {
  BLACKROOM_CEO_MIN_SAMPLES,
  buildBlackRoomLearningSlots,
  collectBlackRoomMetricoolAnalytics,
  extractBlackRoomBestTimes,
  extractBlackRoomMetricSamples,
} from "../server/blackroom-growth-ceo";

function minutes(time: string): number {
  const [hour, minute] = time.split(":").map(Number);
  return hour * 60 + minute;
}

test("seven daily exploration slots cover overnight, morning, afternoon and night", () => {
  const slots = buildBlackRoomLearningSlots({ dayIndex: 0 });
  assert.equal(slots.length, 7);
  assert.ok(slots.some((slot) => minutes(slot) < 6 * 60));
  assert.ok(slots.some((slot) => minutes(slot) >= 6 * 60 && minutes(slot) < 12 * 60));
  assert.ok(slots.some((slot) => minutes(slot) >= 12 * 60 && minutes(slot) < 18 * 60));
  assert.ok(slots.some((slot) => minutes(slot) >= 18 * 60));
  for (let index = 1; index < slots.length; index += 1) assert.ok(minutes(slots[index]) - minutes(slots[index - 1]) >= 90);
});

test("collects each network through discovered Metricool MCP tools and uses the least-sampled network", async () => {
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
  assert.equal(analytics.sampleCount, 2);
  assert.deepEqual(analytics.networkSamples, { tiktok: 3, facebook: 2, youtube: 4 });
  assert.deepEqual(analytics.recommendedTimes, ["18:30"]);
  assert.equal(calls.filter((name) => name === "get_best_times_to_post").length, 3);
});

test("CEO does not optimize times before the minimum comparable sample", () => {
  const collecting = buildBlackRoomLearningSlots({ dayIndex: 0, sampleCount: BLACKROOM_CEO_MIN_SAMPLES - 1, recommendedTimes: ["12:34"] });
  const baseline = buildBlackRoomLearningSlots({ dayIndex: 0 });
  assert.deepEqual(collecting, baseline);
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
