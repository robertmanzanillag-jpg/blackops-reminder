import { test } from "node:test";
import assert from "node:assert/strict";
import { assetProblem, emptyState, fillPlan, deliverJob, type Asset, type Job } from "../server/kong-autopilot-core";
import { approvedUrl, matchesPost, readiness, createDelivery } from "../server/kong-cloud-autopilot";
import { formatMetricoolMcpDate } from "../server/blackroom-metricool-bridge";
const now = new Date("2026-10-28T12:00:00Z");
const asset = (i = 0): Asset => ({ id: `asset-${i}`, sourceUrl: "https://cdn.example.com/source", mediaUrl: `https://cdn.example.com/${i}.mp4`,
  sha256: i.toString(16).padStart(64, "0"), family: i % 2 ? "pov" : "dancefloor", hook: `Hook ${i}`, title: `Party ${i}`,
  caption: `Discover your next night ${i}. https://kongnightlife.com`, durationSeconds: 15, width: 1080, height: 1920,
  footageRights: { confirmedBy: "Robert", evidenceUrl: "https://cdn.example.com/rights", expiresAt: "2027-01-01T00:00:00Z" },
  musicRights: { confirmedBy: "Robert", evidenceUrl: "https://cdn.example.com/music-rights", expiresAt: "2027-01-01T00:00:00Z" },
  qa: { reviewedBy: "editor", reviewedAt: "2026-10-27T00:00:00Z", officialWhiteLogo: true, noLogoBackgroundOrShadow: true,
    safeZones: true, audioChecked: true, spellingChecked: true, renderedSha256: i.toString(16).padStart(64, "0") } });
const convert = (wall: string) => formatMetricoolMcpDate(wall, "America/New_York");
const job = (): Job => ({ id: "one", day: "2026-10-28", network: "tiktok", slot: 0, at: convert("2026-10-28T12:15:00"), asset: asset(), state: "planned", attempts: 0 });
test("rolling plan creates distinct five daily jobs per network and handles DST", () => {
  const assets = Array.from({ length: 90 }, (_, i) => asset(i));
  // Three families let the max-two-family rule fill five daily slots.
  assets.forEach((a, i) => { if (i % 3 === 0) a.family = "humor"; });
  const state = fillPlan(emptyState(), assets, now, convert);
  assert.equal(state.jobs.length, 140);
  assert.equal(new Set(state.jobs.filter(j => j.network === "tiktok").map(j => j.asset.sha256)).size, 70);
  assert.equal(fillPlan(state, assets, now, convert).jobs.length, 140);
  assert.match(state.jobs.find(j => j.day === "2026-11-01")!.at, /-05:00$/);
});
test("short catalog reports gaps by leaving jobs absent, never duplicates content", () => {
  assert.equal(fillPlan(emptyState(), [asset()], now, convert).jobs.length, 2);
});
test("future-day creative cannot silently fill a different day", () => {
  const a = { ...asset(), plannedDay: "2026-11-02" };
  const state = fillPlan(emptyState(), [a], now, convert);
  assert.equal(state.jobs.length, 2);
  assert.ok(state.jobs.every(job => job.day === a.plannedDay));
  assert.equal(assetProblem({ ...a, plannedDay: "2026-02-30" }, now), "invalid_asset");
});
test("pre-submit blocked slots recover when fresh authorized supply appears", () => {
  const state = emptyState(); const blocked = job(); blocked.id = "kong:2026-10-28:tiktok:0"; blocked.state = "blocked"; state.jobs.push(blocked);
  fillPlan(state, [asset(2)], now, convert);
  assert.equal(state.jobs.find(j => j.id === blocked.id)!.state, "planned");
  assert.equal(state.jobs.find(j => j.id === blocked.id)!.asset.id, "asset-2");
});
test("verified TikTok works independently of missing Facebook", () => {
  const r = readiness({ KONG_METRICOOL_ACCOUNTS_VERIFIED: "tiktok" });
  assert.deepEqual(r.verifiedNetworks, ["tiktok"]); assert.deepEqual(r.blockedNetworks, ["facebook"]);
  assert.equal(r.blockers.includes("verify_kong_accounts"), false);
});
test("rights, claims, QA and prohibited copy gates", () => {
  assert.equal(assetProblem({ ...asset(), family: "yacht" }, now), "missing_offer_or_event_evidence");
  const a = asset(); a.musicRights.expiresAt = "2026-10-27T00:00:00Z";
  assert.equal(assetProblem(a, now), "rights_expired");
  assert.equal(assetProblem({ ...asset(), caption: "FREE party" }, now), "prohibited_copy");
  assert.equal(assetProblem({ ...asset(), sha256: "f".repeat(64) }, now), "qa_hash_mismatch");
});
test("lost create response persists uncertain intent and never repeats mutation", async () => {
  const j = job(); let creates = 0; const saved: string[] = [];
  const delivery = { find: async () => undefined, create: async () => { creates++; throw new Error("timeout"); } };
  await deliverJob(j, delivery, async () => { saved.push(j.state); }, now);
  await deliverJob(j, delivery, async () => {}, now);
  assert.equal(creates, 1); assert.deepEqual(saved, ["submitting", "uncertain"]);
  await deliverJob(j, { ...delivery, find: async () => "remote-1" }, async () => {}, now);
  assert.equal(j.state, "scheduled"); assert.equal(j.receipt, "remote-1");
});
test("failed intent persistence cannot make remote call", async () => {
  let called = false;
  await assert.rejects(deliverJob(job(), { find: async () => undefined, create: async () => { called = true; } }, async () => { throw Error("db"); }, now));
  assert.equal(called, false);
});
test("read failure never reaches create", async () => {
  let called = false;
  await assert.rejects(deliverJob(job(), { find: async () => { throw Error("read"); }, create: async () => { called = true; } }, async () => {}, now));
  assert.equal(called, false);
});
test("remote receipt requires network, timezone and non-draft", () => {
  const j = job(), post = { id: 1, text: j.asset.caption, draft: false, publicationDate: { dateTime: j.at.slice(0, 19), timezone: "America/New_York" }, providers: [{ network: "tiktok" }] };
  assert.equal(matchesPost(post, j), true);
  assert.equal(matchesPost({ ...post, providers: [{ network: "youtube" }] }, j), false);
  assert.equal(matchesPost({ ...post, draft: true }, j), false);
});
test("no cross-origin sources or local paths; deployment is disabled by default", () => {
  assert.throws(() => approvedUrl("https://evil.example/x", ["https://cdn.example.com"]));
  assert.throws(() => approvedUrl("file:///Users/robert/video.mp4", []));
  assert.equal(readiness({}).enabled, false);
  assert.ok(readiness({}).blockers.includes("autopublishing_disabled"));
});
test("brand-safe payload has no BlackRoom CTA and labels own-brand promotion", async () => {
  let body: any;
  const fake = (async (_url: unknown, init: any) => { body = JSON.parse(init.body); return new Response(JSON.stringify({ result: {} }), { headers: { "content-type": "application/json" } }); }) as typeof fetch;
  await createDelivery({ METRICOOL_USER_TOKEN: "test", METRICOOL_USER_ID: "1" }, fake).create(job());
  assert.equal(body.params.arguments.blogId, "6475033");
  const info = JSON.parse(body.params.arguments.info);
  assert.equal(info.tiktokData.commercialContentOwnBrand, true);
  assert.equal(info.text.includes("blackroom"), false);
});
test("Facebook adapter creates one KONG Reel with website CTA", async () => {
  let body: any;
  const fake = (async (_url: unknown, init: any) => { body = JSON.parse(init.body); return new Response(JSON.stringify({ result: {} }), { headers: { "content-type": "application/json" } }); }) as typeof fetch;
  const j = job(); j.network = "facebook";
  await createDelivery({ METRICOOL_USER_TOKEN: "test", METRICOOL_USER_ID: "1" }, fake).create(j);
  const info = JSON.parse(body.params.arguments.info);
  assert.deepEqual(info.providers, [{ network: "facebook" }]);
  assert.equal(info.facebookData.type, "REEL");
  assert.ok(info.text.includes("https://kongnightlife.com"));
  assert.equal(info.youtubeData, undefined);
});
test("old YouTube and Instagram jobs can never read or mutate a provider", async () => {
  const r = readiness({ KONG_METRICOOL_ACCOUNTS_VERIFIED: "tiktok,youtube,instagram,facebook" });
  assert.deepEqual(r.verifiedNetworks, ["tiktok", "facebook"]);
  for (const network of ["youtube", "instagram"]) {
    const j = { ...job(), network } as unknown as Job;
    let calls = 0;
    await deliverJob(j, { find: async () => { calls++; return undefined; }, create: async () => { calls++; } }, async () => { calls++; }, now);
    assert.equal(calls, 0);
    const adapter = createDelivery({}, (async () => { calls++; throw Error("unexpected"); }) as typeof fetch);
    await assert.rejects(adapter.create(j), /unsupported_kong_network/);
    await assert.rejects(adapter.find(j), /unsupported_kong_network/);
    assert.equal(calls, 0);
  }
});
