import test from "node:test";
import assert from "node:assert/strict";
import { auditKongCalendar } from "../server/kong-calendar-audit";
import type { Job } from "../server/kong-autopilot-core";
const now = new Date("2026-10-28T14:00:00Z");
const row = (id = 1) => ({ id, blogId: 6475033, text: "KONG caption", draft: false,
  publicationDate: { dateTime: "2026-10-28T15:15:00", timezone: "America/New_York" },
  providers: [{ network: "tiktok", status: "PENDING" }, { network: "facebook", status: "PENDING" }] });
const job = (): Job => ({ id: "job1", day: "2026-10-28", at: "2026-10-28T15:15:00-04:00", network: "tiktok", slot: 0,
  state: "scheduled", attempts: 1, receipt: "1", asset: { caption: "KONG caption", mediaUrl: "https://example.com/video.mp4" } as Job["asset"] });
const input = () => ({ now, jobs: [job()], userId: "user", token: "test-token", verifiedNetworks: ["tiktok", "facebook"] as const });
const run = (body: unknown, jobs = [job()]) => auditKongCalendar({ ...input(), verifiedNetworks: ["tiktok", "facebook"], jobs }, (async () => Response.json(body)) as typeof fetch);
test("read-only scoped endpoint counts cross-network post once pernetwork and ties receipts", async () => {
  let called = 0;
  const result = await auditKongCalendar({ ...input(), verifiedNetworks: ["tiktok", "facebook"] }, (async (url, options) => {
    called++; assert.match(String(url), /blogId=6475033/); assert.match(String(url), /2026-11-10/);
    assert.equal(options?.method, undefined); assert.equal(options?.redirect, "error"); assert.ok(options?.signal);
    return Response.json({ data: [row(), row()] });
  }) as typeof fetch);
  assert.equal(called, 1); assert.equal(result.complete, true);
  assert.equal(result.days[0].networks.tiktok.scheduled, 1); assert.equal(result.days[0].networks.facebook.scheduled, 1);
  assert.equal(result.days[0].networks.facebook.unmatched, 1); assert.equal(result.jobResults[0].status, "matched");
});
test("draft errors wrongbrand unsupported networks and past times never count coverage", async () => {
  const error = row(3); error.providers[0].status = "ERROR"; error.providers = error.providers.slice(0, 1);
  const other = row(4); other.providers = [{ network: "youtube", status: "PENDING" }];
  const past = row(5); past.publicationDate.dateTime = "2026-10-28T09:00:00";
  const result = await run([{ ...row(1), draft: true }, { ...row(2), blogId: 42 }, error, other, past]);
  assert.equal(result.days[0].networks.tiktok.scheduled, 0); assert.equal(result.days[0].networks.tiktok.errors, 1);
  assert.equal(result.days[0].networks.tiktok.missing, 5);
});
test("duplicates don't fill distinct slots; receipt mismatches are exposed", async () => {
  const result = await run([row(1), row(2)]);
  assert.equal(result.days[0].networks.tiktok.scheduled, 1); assert.equal(result.days[0].networks.tiktok.duplicates, 1);
  assert.equal((await run([{ ...row(1), text: "Changed caption" }])).jobResults[0].status, "mismatch");
  assert.equal((await run([{ ...row(1), mediaFiles: [{ url: "https://example.com/wrong.mp4" }] }])).jobResults[0].status, "mismatch");
});
test("empty verified response reports gaps; unknown pagination/error never claims zero", async () => {
  const empty = await run({ data: [] }); assert.equal(empty.complete, true); assert.equal(empty.days[0].networks.tiktok.missing, 5);
  for (const body of [{ data: [], nextCursor: "more" }, { data: [], pagination: {} }, { error: "failed" }, [null]]) {
    const result = await run(body); assert.equal(result.complete, false); assert.equal(result.days[0].networks.tiktok.missing, null);
    assert.equal(result.jobResults[0].status, "unknown");
  }
});
test("bounded responses and read failures remain incomplete without leaking credentials", async () => {
  for (const response of [new Response("bad", { status: 500 }), new Response("x".repeat(2_000_001))]) {
    const result = await auditKongCalendar({ ...input(), verifiedNetworks: ["tiktok", "facebook"] }, (async () => response) as typeof fetch);
    assert.equal(result.complete, false); assert.equal(result.days[0].networks.tiktok.missing, null);
    assert.ok(!JSON.stringify(result).includes("test-token"));
  }
});
test("DST offset matches actual instant; unverified network remains unknown", async () => {
  const dst = row(); dst.publicationDate.dateTime = "2026-11-02T15:15:00";
  const j = job(); j.day = "2026-11-02"; j.at = "2026-11-02T20:15:00Z";
  const result = await auditKongCalendar({ ...input(), jobs: [j], verifiedNetworks: ["tiktok"] }, (async () => Response.json([dst])) as typeof fetch);
  assert.equal(result.jobResults[0].status, "matched"); assert.equal(result.days[5].networks.facebook.missing, null);
});
test("unknown statuses and rollover dates cannot falsely establish coverage", async () => {
  const unknown = row(); unknown.providers[0].status = "SOMETHING_NEW";
  const result = await run([unknown]); assert.equal(result.complete, false);
  assert.equal(result.days[0].networks.tiktok.scheduled, 0); assert.equal(result.days[0].networks.tiktok.missing, null);
  const invalid = row(); invalid.publicationDate.dateTime = "2026-10-32T15:15:00";
  assert.equal((await run([invalid])).complete, false);
});
test("text and image posts never fill video cadence and unknown media leaves shortfall unknown", async () => {
  const rows = ["TEXT", "IMAGE", "PHOTO", "CAROUSEL", "TEXT"].map((type, i) => ({ ...row(i + 10), text: `post-${i}`, type }));
  const result = await run(rows, []), stats = result.days[0].networks.tiktok;
  assert.equal(stats.scheduledPosts, 5); assert.equal(stats.verifiedVideoPosts, 0); assert.equal(stats.missing, 5);
  const unknown = await run([row()], []);
  assert.equal(unknown.days[0].networks.tiktok.unverifiedMediaPosts, 1); assert.equal(unknown.days[0].networks.tiktok.missing, null);
  const mixed = await run([{ ...row(1), type: "VIDEO" }, { ...row(2), type: "TEXT", text: "text" }, { ...row(3), text: "unknown" }], []);
  assert.equal(mixed.days[0].networks.tiktok.verifiedVideoPosts, 1); assert.equal(mixed.days[0].networks.tiktok.scheduledPosts, 3);
  assert.equal(mixed.days[0].networks.tiktok.missing, null); assert.deepEqual(mixed.verifiedNetworks, ["tiktok", "facebook"]);
});
test("known validated exact video job or explicit media metadata proves video type", async () => {
  const j = job(), sha = "a".repeat(64), rights = { confirmedBy: "owner", evidenceUrl: "https://example.com/rights", expiresAt: "2027-01-01T00:00:00Z" };
  j.asset = { ...j.asset, id: "video", sha256: sha, sourceUrl: "https://example.com/source", family: "pov", hook: "Night plans", title: "Night plans",
    durationSeconds: 12, width: 1080, height: 1920, footageRights: rights, musicRights: rights,
    qa: { reviewedBy: "reviewer", reviewedAt: "2026-10-27T00:00:00Z", officialWhiteLogo: true, noLogoBackgroundOrShadow: true,
      safeZones: true, audioChecked: true, spellingChecked: true, renderedSha256: sha } };
  const result = await run([row()], [j]);
  assert.equal(result.days[0].networks.tiktok.verifiedVideoPosts, 1); assert.equal(result.days[0].networks.tiktok.missing, 4);
  assert.equal(result.days[0].networks.facebook.verifiedVideoPosts, 0); assert.equal(result.days[0].networks.facebook.missing, null);
  const external = await run([{ ...row(), mediaFiles: [{ type: "video", mimeType: "video/mp4" }] }], []);
  assert.equal(external.days[0].networks.facebook.verifiedVideoPosts, 1);
  const changed = await run([{ ...row(), type: "TEXT" }], [j]);
  assert.equal(changed.days[0].networks.tiktok.verifiedVideoPosts, 0);
  assert.equal(changed.days[0].networks.tiktok.missing, 5);
  const conflict = await run([{ ...row(), type: "IMAGE", mediaFiles: [{ type: "video", mimeType: "video/mp4" }] }], [j]);
  assert.equal(conflict.days[0].networks.tiktok.verifiedVideoPosts, 0);
  assert.equal(conflict.days[0].networks.tiktok.unverifiedMediaPosts, 1);
  assert.equal(conflict.days[0].networks.tiktok.missing, null);
});
