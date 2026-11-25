import test from "node:test";
import assert from "node:assert/strict";
import { createSocialPublisher, publishingCapability, resolveSocialPublishingProvider, SOCIAL_PUBLISHING_PROVIDERS, SocialPublishingRefusedError, type SocialPublishingProvider } from "../server/social-publishing/provider";
import { metricoolPublishingProvider } from "../server/social-publishing/metricool";
import { deliverLocalNewsThroughPublishingSeam } from "../server/social-publishing/local-news";

const silent = () => {};
const req = { accountRef: { network: "tiktok", handle: "streamersus", providerAccountId: "6431685" }, mediaUrl: "https://cdn.example.com/a.mp4", caption: "Clip", hashtags: ["fyp"], scheduledFor: "2026-12-01T15:00:00Z", idempotencyKey: "news-0001-tiktok" };

function fake() {
  const calls: unknown[] = [];
  const provider = {
    name: "fake", label: "Fake",
    schedulePost: async (r: unknown) => { calls.push(r); return { provider: "fake", status: "scheduled" as const, providerPostId: "p1", publicUrl: null }; },
    getPublication: async () => ({ provider: "fake", status: "published" as const, providerPostId: "p1", publicUrl: "https://x/1" }),
    cancel: async () => ({ provider: "fake", status: "cancelled" as const, providerPostId: "p1", publicUrl: null }),
    freeSlots: async () => ({ provider: "fake", slots: [] }),
  } as unknown as SocialPublishingProvider<any>;
  return { calls, provider };
}

test("server seam defaults to metricool with legacy flows", () => {
  const r = resolveSocialPublishingProvider({} as NodeJS.ProcessEnv, undefined, { log: silent });
  assert.equal(r.provider, metricoolPublishingProvider);
  assert.deepEqual(Object.keys(SOCIAL_PUBLISHING_PROVIDERS), ["metricool"]);
  for (const k of ["scheduleBlackRoomPost", "deliverLocalNews", "scheduledCalendar"] as const) assert.equal(typeof publishingCapability(k, { env: {} as NodeJS.ProcessEnv, log: silent }), "function");
});

test("server seam fails closed on unknown provider", async () => {
  const logs: string[] = [];
  const env = { SOCIAL_PUBLISHING_PROVIDER: "metricoool" } as NodeJS.ProcessEnv;
  assert.throws(() => publishingCapability("scheduleBlackRoomPost", { env, log: (m) => logs.push(m) }), SocialPublishingRefusedError);
  assert.ok(logs[0].includes("reason=unknown_social_publishing_provider:metricoool"));
  const { calls, provider } = fake();
  const pub = createSocialPublisher({ env, registry: { fake: provider }, log: silent });
  assert.equal((await pub.schedulePost(req)).status, "refused");
  assert.equal(calls.length, 0);
});

test("local news delivery is blocked (nothing scheduled) when the provider is unknown", async () => {
  const prev = console.warn; console.warn = silent;
  try {
    const r = await deliverLocalNewsThroughPublishingSeam({ env: { SOCIAL_PUBLISHING_PROVIDER: "nope" } as NodeJS.ProcessEnv, workspaceDir: "/tmp/social-publishing-test" });
    assert.equal(r.status, "blocked"); assert.equal(r.scheduled, 0); assert.equal(r.reason, "unknown_social_publishing_provider:nope");
  } finally { console.warn = prev; }
});

test("server idempotency: duplicate key is not re-sent", async () => {
  const { calls, provider } = fake();
  const pub = createSocialPublisher({ env: { SOCIAL_PUBLISHING_PROVIDER: "fake" } as NodeJS.ProcessEnv, registry: { fake: provider }, log: silent });
  await pub.schedulePost(req);
  const again = await pub.schedulePost(req);
  assert.equal(again.duplicate, true); assert.equal(calls.length, 1);
});

test("metricool adapter refuses cancel instead of guessing an endpoint", async () => {
  const r = await metricoolPublishingProvider.cancel({ providerPostId: "1", accountRef: { network: "tiktok" } });
  assert.equal(r.status, "refused");
});
