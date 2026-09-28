import test from "node:test";
import assert from "node:assert/strict";
import { acquireMetricoolExports, buildVerifiedMetricoolExport, deliverMetricoolExports, metricoolPublicationInstant } from "../script/blackroom-metricool-exporter.mjs";

test("export times are explicit source observations and local publication time uses New York DST", () => {
  const result = buildVerifiedMetricoolExport({ network: "youtube", filename: "youtube-published-videos-posts_range.csv",
    text: "videoId,publishedAt,views,Average view duration\nabc,2026-09-27 14:03,37,00:04\n",
    observedAt: "2026-09-28T07:00:00Z", timezone: "America/New_York" });
  assert.equal(result.samples[0].publishedAt, "2026-09-27T18:03:00.000Z");
  assert.equal(result.samples[0].observedAt, "2026-09-28T07:00:00Z");
  assert.equal(result.samples[0].averageWatchSeconds, 4);
  assert.equal(metricoolPublicationInstant("2026-11-01T01:30:00"), undefined);
  assert.equal(metricoolPublicationInstant("2026-03-08T02:30:00"), undefined);
});
test("rejects wrong-platform files rather than attributing another account's export", () => {
  assert.throws(() => buildVerifiedMetricoolExport({ network: "youtube", filename: "tiktok-posts_range.csv", text: "URL,Views\na,1", observedAt: new Date().toISOString() }));
});
test("expired session returns independent errors and no fabricated zero metrics", async () => {
  let closed = false;
  const result = await acquireMetricoolExports({ context: { newPage: async () => ({
    setDefaultTimeout() {}, goto: async () => { throw new Error("expired session secret must not be logged"); }, close: async () => { closed = true; },
  }) }, now: () => new Date("2026-09-28T07:00:00Z") });
  assert.equal(closed, true);
  assert.deepEqual(result.imports, []);
  assert.deepEqual(Object.keys(result.errors), ["tiktok", "facebook", "youtube"]);
  assert.ok(!JSON.stringify(result).includes("secret"));
});

test("delivery continues across networks after an error and keeps batches bounded", async () => {
  const batches = [];
  const result = await deliverMetricoolExports({ imports: [
    { network: "tiktok", samples: [{}] },
    { network: "youtube", samples: Array.from({ length: 2001 }, (_, id) => ({ id })) },
  ] }, async (body) => {
    if (body.imports[0].network === "tiktok") throw new Error("private transport detail");
    batches.push(body.imports[0].samples.length);
  });
  assert.deepEqual(batches, [2000, 1]);
  assert.equal(result.imported, 2001);
  assert.ok(result.errors.tiktok);
  assert.ok(!JSON.stringify(result).includes("private"));
});

test("login redirect reports setup required rather than a healthy waiting collector", async () => {
  const result = await acquireMetricoolExports({ context: { newPage: async () => ({
    setDefaultTimeout() {}, goto: async () => {}, url: () => "https://app.metricool.com/login",
    close: async () => {},
  }) } });
  assert.equal(result.setupRequired, true);
  assert.equal(result.imports.length, 0);
});

test("bounded network timeouts and cleanup failures preserve earlier successful exports", async () => {
  let pageIndex = 0, closed = 0;
  const locator = { first() { return this; }, nth() { return this; }, locator() { return this; },
    getByRole() { return this; }, waitFor: async () => {}, click: async () => {} };
  const result = await acquireMetricoolExports({ networkTimeoutMs: 10, context: { newPage: async () => {
    const index = pageIndex++;
    return { setDefaultTimeout() {}, goto: () => index === 0 ? Promise.resolve() : new Promise(() => {}),
      locator: () => locator, getByRole: () => locator, getByText: () => locator,
      waitForEvent: async () => ({ failure: async () => null,
        suggestedFilename: () => "tiktok-posts_range.csv",
        createReadStream: async () => (async function* () { yield Buffer.from("URL,Date,Views\nhttps://tiktok.com/@test/video/123,2026-09-20 12:00,50\n"); })(),
      }), close: async () => { closed++; if (index > 0) throw new Error("close failed after timeout"); } };
  } } });
  assert.equal(closed, 3);
  assert.equal(result.imports.length, 1);
  assert.equal(result.imports[0].network, "tiktok");
  assert.deepEqual(Object.keys(result.errors), ["facebook", "youtube"]);
});

test("authenticated-tab acquisition never opens a replacement tab or closes the login tab", async () => {
  let route = "", closes = 0;
  const locator = { first() { return this; }, nth() { return this; }, locator() { return this; },
    getByRole() { return this; }, waitFor: async () => {}, click: async () => {} };
  const page = { setDefaultTimeout() {}, goto: async (url) => { route = new URL(url).pathname; },
    locator: () => locator, getByRole: () => locator, getByText: () => locator,
    close: async () => { closes++; }, waitForEvent: async () => ({ failure: async () => null,
      suggestedFilename: () => route.includes("youtube") ? "youtube-published-videos-posts_range.csv" : route.includes("facebook") ? "facebook-reels_range.csv" : "tiktok-posts_range.csv",
      createReadStream: async () => (async function* () { yield Buffer.from("URL,Reel Link,videoId,Date,publishedAt,Views,Video Views\nhttps://tiktok.com/@test/video/123,https://facebook.com/reel/123,abc,2026-09-20 12:00,2026-09-20 12:00,50,50\n"); })(),
    }) };
  const result = await acquireMetricoolExports({ context: { newPage: () => { throw new Error("Must reuse login tab"); } }, authenticatedPage: page });
  assert.equal(result.imports.length, 3);
  assert.deepEqual(result.errors, {});
  assert.equal(closes, 0);
});
