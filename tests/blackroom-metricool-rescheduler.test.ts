import assert from "node:assert/strict";
import test from "node:test";
import {
  extractBlackRoomScheduledPosts,
  planBlackRoomRescheduleExperiments,
  rescheduleBlackRoomMetricoolExperiments,
} from "../server/blackroom-metricool-rescheduler";

function post(id: number, network: string, dateTime: string) {
  return {
    id,
    uuid: `uuid-${id}`,
    text: `BlackRoom DJ clip ${id}`,
    publicationDate: { dateTime, timezone: "America/New_York" },
    providers: [{ network }],
    media: [{ id: `media-${id}`, type: "VIDEO" }],
  };
}

const analytics = {
  comparableSampleCount: 30,
  recommendedTimes: ["10:00"],
  recommendedTimesByNetwork: {
    tiktok: ["10:00", "08:00"],
    facebook: ["14:00"],
    youtube: ["18:00"],
  },
} as any;

test("extracts only complete BlackRoom scheduled posts", () => {
  const extracted = extractBlackRoomScheduledPosts({
    data: [
      post(1, "tiktok", "2026-08-02T12:00:00"),
      { ...post(2, "facebook", "2026-08-02T13:00:00"), text: "another brand" },
      { ...post(3, "youtube", "2026-08-02T14:00:00"), uuid: "" },
    ],
  });
  assert.deepEqual(extracted.map((item) => item.id), ["1"]);
  assert.equal(extracted[0].info.media?.[0]?.id, "media-1");
});

test("plans small, spaced, evidence-backed experiments without repeating posts", () => {
  const posts = extractBlackRoomScheduledPosts({ data: [
    post(1, "tiktok", "2026-08-02T12:00:00"),
    post(2, "facebook", "2026-08-02T12:30:00"),
    post(3, "youtube", "2026-08-02T13:00:00"),
    post(4, "tiktok", "2026-08-02T10:30:00"),
    post(5, "facebook", "2026-07-31T10:00:00"),
  ] });
  const plans = planBlackRoomRescheduleExperiments({
    posts,
    analytics,
    attemptedPostIds: ["2"],
    now: new Date("2026-07-30T12:00:00.000Z"),
  });
  assert.equal(plans.length, 2);
  assert.deepEqual(plans.map((item) => item.post.network), ["tiktok", "youtube"]);
  assert.equal(plans[0].post.id, "4");
  assert.equal(plans[0].to, "2026-08-02T10:00:00");
  assert.equal(plans[1].to, "2026-08-02T18:00:00");
});

test("does not move posts until enough comparable history exists", () => {
  const posts = extractBlackRoomScheduledPosts({ data: [post(1, "tiktok", "2026-08-02T12:00:00")] });
  assert.deepEqual(planBlackRoomRescheduleExperiments({
    posts,
    analytics: { ...analytics, comparableSampleCount: 20 },
    now: new Date("2026-07-30T12:00:00.000Z"),
  }), []);
});

test("protects the next 36 hours and ignores posts beyond the 14-day horizon", () => {
  const posts = extractBlackRoomScheduledPosts({ data: [
    post(1, "tiktok", "2026-07-31T23:59:00"),
    post(2, "facebook", "2026-08-13T12:01:00"),
    post(3, "youtube", "2026-08-02T13:00:00"),
  ] });
  const plans = planBlackRoomRescheduleExperiments({
    posts,
    analytics,
    now: new Date("2026-07-30T12:00:00.000Z"),
  });
  assert.deepEqual(plans.map((item) => item.post.id), ["3"]);
});

test("spacing is enforced per destination because each network has its own audience feed", () => {
  const posts = extractBlackRoomScheduledPosts({ data: [
    post(1, "tiktok", "2026-08-02T12:00:00"),
    post(2, "facebook", "2026-08-02T12:30:00"),
  ] });
  const plans = planBlackRoomRescheduleExperiments({
    posts,
    analytics: {
      ...analytics,
      recommendedTimesByNetwork: { tiktok: ["10:00"], facebook: ["10:30"] },
    },
    now: new Date("2026-07-30T12:00:00.000Z"),
  });
  assert.deepEqual(plans.map((item) => item.to), ["2026-08-02T10:00:00", "2026-08-02T10:30:00"]);
});

test("updates a post once, preserves its complete payload and verifies the new time", async () => {
  const original = post(1, "tiktok", "2026-08-02T12:00:00");
  const updated = post(1, "tiktok", "2026-08-02T10:00:00");
  const calls: Array<{ url: string; body?: any }> = [];
  let schedulerReads = 0;
  const fetcher = async (request: string | URL | Request, init?: RequestInit) => {
    const url = String(request);
    calls.push({ url, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    if (url.includes("/api/v2/scheduler/posts")) {
      schedulerReads += 1;
      return Response.json({ data: [schedulerReads === 1 ? original : updated] });
    }
    if (init?.body && JSON.parse(String(init.body)).method === "tools/list") {
      return Response.json({ jsonrpc: "2.0", id: "tools", result: { tools: [{
        name: "updateScheduledPost",
        inputSchema: { properties: {
          id: { type: "number" }, uuid: { type: "string" }, blogId: { type: "number" },
          date: { type: "string" }, info: { type: "object" },
        } },
      }] } });
    }
    return Response.json({ jsonrpc: "2.0", id: "call", result: { content: [{ type: "text", text: "ok" }] } });
  };
  const report = await rescheduleBlackRoomMetricoolExperiments({
    analytics,
    now: new Date("2026-07-30T12:00:00.000Z"),
    env: { METRICOOL_USER_TOKEN: "test-token", METRICOOL_USER_ID: "3558197" },
    fetch: fetcher as typeof fetch,
  });
  assert.equal(report.experiments.length, 1);
  assert.equal(report.experiments[0].status, "verified");
  const mutation = calls.find((call) => call.body?.method === "tools/call");
  assert.equal(mutation?.body.params.name, "updateScheduledPost");
  assert.equal(mutation?.body.params.arguments.info.media[0].id, "media-1");
  assert.equal(mutation?.body.params.arguments.info.publicationDate.dateTime, "2026-08-02T10:00:00");
  assert.equal(calls.filter((call) => call.body?.method === "tools/call").length, 1);
});
