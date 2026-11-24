import assert from "node:assert/strict";
import test from "node:test";
import { cycleReportKey, hasValidClippersOfficeIngestToken, ingestClippersOfficeBridge } from "../server/clippers-office-ingest";
import { isPublicApiPath } from "../server/user-context";

const TOKEN = "k".repeat(40);
const totals = { posts: 1, dailyTargetPosts: 5, weeklyTargetClips: 35, backlogPosts: 2, gapToDailyTarget: 4, scheduled: 1, readyForManual: 0, blocked: 1, draftReady: 0, rightsReview: 0, needsSource: 0 };
const payload = () => ({ version: 1, metrics: { generatedAt: "2026-11-24T12:00:00.000Z", records: [{ provider: "metricool", postId: "m1", accountId: "@a", clipId: "i1", publishedAt: null, views: 95, likes: 3 }] }, cycle: { createdAt: "2026-11-24T12:00:00.000Z", status: "ready", totals } });

test("token check fails closed and is constant-length compared", () => {
  assert.equal(hasValidClippersOfficeIngestToken(`Bearer ${TOKEN}`, undefined), false);
  assert.equal(hasValidClippersOfficeIngestToken(`Bearer ${TOKEN}`, "short"), false);
  assert.equal(hasValidClippersOfficeIngestToken("Bearer wrong", TOKEN), false);
  assert.equal(hasValidClippersOfficeIngestToken(`Bearer ${TOKEN}`, TOKEN), true);
  assert.equal(isPublicApiPath("/api/clippers/office-ingest"), true);
});

test("valid payload is queued as clip_metrics and a cycle clip_report owned by the server user", () => {
  const queued: any[] = [];
  const result = ingestClippersOfficeBridge(payload(), { owner: "owner-1", queue: (i) => { queued.push(i); return true; } });
  assert.equal(result.status, 202);
  assert.deepEqual(queued.map((q) => q.kind), ["clip_metrics", "clip_report"]);
  assert.equal(queued[1].key, cycleReportKey("2026-11-24T12:00:00.000Z"));
  assert.match(queued[1].key, /^automation-cycle-2026-11-24T12-00-00-000Z\.json$/);
  assert.equal(queued[1].raw.userId, "owner-1");
  assert.equal(queued[0].raw.records[0].id, "metricool:m1");
  assert.equal("comments" in queued[0].raw.records[0], false);
});

test("rejects extra fields, bad numbers, oversize posts and unavailable storage", () => {
  const noop = () => true;
  assert.equal(ingestClippersOfficeBridge({ ...payload(), userId: "x" }, { owner: "o", queue: noop }).status, 422);
  const neg = payload(); neg.metrics.records[0].views = -1;
  assert.equal(ingestClippersOfficeBridge(neg, { owner: "o", queue: noop }).status, 422);
  const big = payload(); big.cycle.totals = { ...totals, posts: 10_001 };
  assert.equal(ingestClippersOfficeBridge(big, { owner: "o", queue: noop }).status, 422);
  const badProvider: any = payload(); badProvider.metrics.records[0].provider = "Bad Provider!";
  assert.equal(ingestClippersOfficeBridge(badProvider, { owner: "o", queue: noop }).status, 422);
  assert.equal(ingestClippersOfficeBridge(payload(), { owner: "o", queue: () => false }).status, 503);
});
