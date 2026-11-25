import test from "node:test";
import assert from "node:assert/strict";
import { prepareOfficeSourceDocument } from "../server/office-source-documents";
import { buildClipMetrics, buildCycleReport } from "../script/clippers-office-sources.mjs";

const now = Date.parse("2026-11-24T15:00:00.000Z");
const ledger = { posts: [
  { id: "stc-a", destinationKey: "6431685:tiktok", status: "scheduled", scheduledAt: "2026-11-24T14:00:00.000Z", observation: { views: 95, likes: 3, comments: 0, shares: 1, saves: 0, observedAt: "2026-11-24T14:30:00Z", publishedAt: "2026-11-23T14:00:00Z" } },
  { id: "stc-c", status: "failed", scheduledAt: "2026-11-24T10:00:00.000Z" },
] };

test("cloud projections pass the real office source schemas", () => {
  const m = prepareOfficeSourceDocument("clip_metrics", buildClipMetrics(ledger).document, { owner: "owner-1" });
  assert.equal(m.status, "present");
  const r = buildCycleReport(ledger, { owner: "owner-1", now, dailyTargetPosts: 10 });
  const p = prepareOfficeSourceDocument("clip_report", r.document, { owner: "owner-1", key: r.key });
  assert.equal(p.status, "present");
  assert.equal((p.document as { type: string }).type, "cycle");
  assert.equal(prepareOfficeSourceDocument("clip_metrics", buildClipMetrics({ posts: [] }).document, { owner: "o" }).status, "present");
});
