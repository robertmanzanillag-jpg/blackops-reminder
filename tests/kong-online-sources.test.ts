import test from "node:test";
import assert from "node:assert/strict";
import { approvedFootageUrl, discoverPexelsFootage, downloadFootage, intakeOwnerFootage, NIGHTLIFE_QUERIES, PEXELS_LICENSE } from "../server/kong-online-sources";
const now = new Date("2026-10-28T14:00:00Z");
const row = { id: "dance1", authorizedByOwner: true, commercialPromotionAllowed: true,
  author: "Venue owner", sourceUrl: "https://example.com/rights/1", mediaUrl: "https://cdn.example.com/clip.mp4",
  rightsEvidence: "Written permission for KONG social promotion reference 123", rightsExpiresAt: "2026-12-01T00:00:00Z" };
const owner = () => intakeOwnerFootage([row], ["https://cdn.example.com"], now)[0];
const video = (id = 1) => ({ id, url: `https://www.pexels.com/video/${id}/`, user: { name: "Author" }, duration: 15,
  video_files: [{ file_type: "video/mp4", width: 1080, height: 1920, link: `https://videos.pexels.com/${id}.mp4` }] });
const mock = (callback: (url: string, init?: RequestInit) => Response | Promise<Response>) => callback as unknown as typeof fetch;
test("no configured key means no request or falsely ready candidates", async () => {
  const result = await discoverPexelsFootage({ fetcher: mock(() => { throw new Error("must not fetch"); }) });
  assert.equal(result.status, "not_configured"); assert.equal(result.candidates.length, 0);
});
test("current endpoint, query rotation, pagination and dedupe with explicit provenance", async () => {
  let requested = "";
  const result = await discoverPexelsFootage({ apiKey: "injected-test-value", cursor: 7, seenIds: ["pexels-2"], now,
    fetcher: mock((url, init) => { requested = url; assert.equal((init?.headers as any).Authorization, "injected-test-value");
      assert.equal(init?.redirect, "error"); return Response.json({ videos: [video(), video(), video(2)] }); }) });
  const url = new URL(requested);
  assert.equal(url.pathname, "/v1/videos/search"); assert.equal(url.searchParams.get("page"), "2");
  assert.equal(url.searchParams.get("query"), NIGHTLIFE_QUERIES[1]); assert.equal(result.nextCursor, 8);
  assert.equal(result.candidates.length, 1); assert.equal(result.candidates[0].licenseUrl, PEXELS_LICENSE);
  assert.equal(result.candidates[0].audioPolicy, "remove_source_audio"); assert.equal(result.candidates[0].qaStatus, "pending");
  assert.match(result.candidates[0].attribution, /Author.*Pexels/);
});
test("reject untrusted provider URLs, invalid metadata and nonportrait media", async () => {
  const bad = video(); bad.video_files[0].link = "https://attacker.example.com/video.mp4";
  const horizontal = video(3); horizontal.video_files[0].height = 500;
  const result = await discoverPexelsFootage({ apiKey: "test", now,
    fetcher: mock(() => Response.json({ videos: [bad, horizontal, { ...video(4), user: {} }] })) });
  assert.deepEqual(result.candidates, []);
});
test("owner intake fails closed on rights, expiry, duplicate or unapproved host", () => {
  assert.equal(owner().provider, "owner");
  for (const bad of [{ ...row, authorizedByOwner: false }, { ...row, commercialPromotionAllowed: false },
    { ...row, rightsEvidence: "" }, { ...row, rightsExpiresAt: "2026-01-01" }, { ...row, mediaUrl: "https://other.example.com/1" }]) {
    assert.throws(() => intakeOwnerFootage([bad], ["https://cdn.example.com"], now));
  }
  assert.throws(() => intakeOwnerFootage([row, row], ["https://cdn.example.com"], now), /duplicate/);
  for (const bad of ["http://cdn.example.com/a", "https://u:p@cdn.example.com/a", "https://127.0.0.1/a", "https://localhost/a", "https://[::1]/a"]) {
    assert.throws(() => approvedFootageUrl(bad, [new URL(bad).origin]));
  }
});
test("download verifies MIME, declared/streamed limits and MP4 signature; never clears QA/audio", async () => {
  const bytes = Buffer.from([0, 0, 0, 12, 102, 116, 121, 112, 105, 115, 111, 109]);
  const result = await downloadFootage(owner(), { now, fetcher: mock((_url, init) => {
    assert.equal(init?.headers, undefined); assert.equal(init?.redirect, "error");
    return new Response(bytes, { headers: { "content-type": "video/mp4" } });
  }) });
  assert.equal(result.sizeBytes, 12); assert.equal(result.sha256.length, 64); assert.equal(result.qaStatus, "pending");
  for (const response of [new Response("html", { headers: { "content-type": "text/html" } }),
    new Response(bytes, { headers: { "content-type": "video/mp4", "content-length": "100" } }),
    new Response(Buffer.alloc(21), { headers: { "content-type": "video/mp4" } }),
    new Response(Buffer.alloc(12), { headers: { "content-type": "video/mp4" } })]) {
    await assert.rejects(downloadFootage(owner(), { now, maxBytes: 20, fetcher: mock(() => response) }));
  }
});
test("expired source never downloaded and API failure is not silently successful", async () => {
  await assert.rejects(downloadFootage(owner(), { now: new Date("2027-01-01"), fetcher: mock(() => { throw new Error("unexpected"); }) }), /rights_expired/);
  await assert.rejects(discoverPexelsFootage({ apiKey: "test", fetcher: mock(() => Response.json({}, { status: 429 })) }), /source_http_429/);
  await assert.rejects(discoverPexelsFootage({ apiKey: "test", fetcher: mock(() => Response.json({ unexpected: [] })) }), /invalid_pexels/);
});
