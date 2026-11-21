import { test } from "node:test";
import assert from "node:assert/strict";
import { analyzeLearning, cohort, emptyLearningLedger, ingestLearning, median, recommendCreativeMix, type Observation, type CreativeCandidate } from "../server/kong-content-learning";
const now = new Date("2026-10-28T12:00:00Z");
const row = (id: string, overrides: Partial<Observation> = {}): Observation => ({ network: "tiktok", postId: id,
  sourceUrl: "https://app.metricool.com/", publishedAt: "2026-10-25T12:00:00Z", observedAt: "2026-10-26T12:00:00Z",
  family: "pov", hookStyle: "question", metrics: { views: 100, shares: 2, completionRate: .4 }, ...overrides });
const ledger = (rows: Observation[]) => ingestLearning(emptyLearningLedger(), rows, now).ledger;
test("ingestion preserves zero vs missing, validates negative/future and does not mutate ledger", () => {
  const old = emptyLearningLedger();
  const result = ingestLearning(old, [row("zero", { metrics: { views: 0 } }), row("missing", { metrics: {} }),
    row("bad", { metrics: { views: -1 } }), row("future", { observedAt: "2026-11-01T12:00:00Z" })], now);
  assert.equal(old.observations.length, 0); assert.equal(result.added, 2); assert.equal(result.rejected.length, 2);
  const report = analyzeLearning(result.ledger, "tiktok", "24h", now);
  assert.deepEqual(report.distributionChecks, ["zero"]); assert.deepEqual(report.missingViews, ["missing"]);
});
test("idempotent ingestion rejects conflicting snapshots and post metadata", () => {
  const original = row("a");
  const result = ingestLearning(ledger([original]), [original, row("a", { metrics: { views: 200 } }), row("a", { family: "humor", observedAt: "2026-10-27T12:00:00Z" })], now);
  assert.equal(result.duplicates, 1); assert.deepEqual(result.rejected.map(r => r.reason), ["snapshot_conflict", "post_metadata_conflict"]);
});
test("equal-age cohorts choose one closest snapshot and never pool network or lifetime ages", () => {
  const l = ledger([row("a"), row("a", { observedAt: "2026-10-26T13:00:00Z", metrics: { views: 150 } }),
    row("a", { observedAt: "2026-10-28T12:00:00Z", metrics: { views: 300 } }), row("fb", { network: "facebook" }),
    row("early", { observedAt: "2026-10-26T11:00:00Z" })]);
  assert.deepEqual(cohort(l, "tiktok", "24h", now).map(r => [r.postId, r.metrics.views]), [["a", 100]]);
  assert.equal(cohort(l, "tiktok", "72h", now)[0].metrics.views, 300);
  assert.equal(cohort(l, "tiktok", "7d", now).length, 0);
});
test("median robust to outlier; insufficient groups never become winners", () => {
  assert.equal(median([1, 2, 3, 10000]), 2.5);
  const report = analyzeLearning(ledger([row("one", { metrics: { views: 100000 } }), row("two", { family: "humor" })]), "tiktok", "24h", now);
  assert.ok(report.groups.every(g => g.metrics.every(m => m.signal === "insufficient_evidence")));
});
test("supported descriptive signals use separate holdout median and missing metrics stay unknown", () => {
  const rows = Array.from({ length: 8 }, (_, i) => row(String(i), { family: i < 3 ? "pov" : "humor", metrics: { views: i < 3 ? 200 : 100 } }));
  const report = analyzeLearning(ledger(rows), "tiktok", "24h", now);
  const group = report.groups.find(g => g.dimension === "family" && g.value === "pov")!;
  assert.equal(group.metrics.find(m => m.metric === "views")!.signal, "promising");
  assert.equal(group.metrics.find(m => m.metric === "views")!.ratio, 2);
  assert.equal(group.metrics.find(m => m.metric === "websiteClicks")!.signal, "insufficient_evidence");
});
test("zero reference and low-exposure retention do not manufacture a ratio", () => {
  const rows = Array.from({ length: 8 }, (_, i) => row(String(i), { family: i < 3 ? "pov" : "humor", metrics: { views: i < 3 ? 10 : 0, completionRate: .9 } }));
  const report = analyzeLearning(ledger(rows), "tiktok", "24h", now);
  assert.ok(report.groups.every(g => g.metrics.filter(m => ["views", "completionRate"].includes(m.metric)).every(m => m.signal === "insufficient_evidence")));
});
test("mix reserves at least40% exploration, avoids duplicate footage/hooks and caps families", () => {
  const rows = Array.from({ length: 8 }, (_, i) => row(String(i), { family: i < 3 ? "pov" : "humor", metrics: { views: i < 3 ? 200 : 100 } }));
  const report = analyzeLearning(ledger(rows), "tiktok", "24h", now);
  const candidates: CreativeCandidate[] = Array.from({ length: 12 }, (_, i) => ({ id: `c${i}`, network: "tiktok", family: i % 3 === 0 ? "pov" : i % 3 === 1 ? "dancefloor" : "humor", hookStyle: "question", hook: `new hook ${i}`, sourceId: `clip${i}`, isNewConcept: i % 3 !== 0 }));
  const result = recommendCreativeMix(candidates, report);
  assert.equal(result.selected.length, 5); assert.ok(result.explorationSelected >= 2);
  assert.equal(new Set(result.selected.map(s => s.candidate.sourceId)).size, 5);
  for (let i = 1; i < result.selected.length; i++) assert.notEqual(result.selected[i].candidate.family, result.selected[i - 1].candidate.family);
});
test("without evidence mix explores, rejects foreign network, and reports supply gaps", () => {
  const report = analyzeLearning(emptyLearningLedger(), "facebook", "24h", now);
  const c: CreativeCandidate = { id: "x", network: "facebook", family: "pov", hookStyle: "question", hook: "new", sourceId: "x", isNewConcept: false };
  assert.equal(recommendCreativeMix([c, { ...c, id: "y", network: "tiktok", isNewConcept: true }], report).selected.length, 0);
  const result = recommendCreativeMix([{ ...c, isNewConcept: true }], report);
  assert.equal(result.missing, 4); assert.equal(result.explorationSelected, 1);
});
test("supported variations cannot fill the calendar when exploration supply is absent", () => {
  const rows = Array.from({ length: 8 }, (_, i) => row(String(i), { family: i < 3 ? "pov" : "humor", metrics: { views: i < 3 ? 200 : 100 } }));
  const report = analyzeLearning(ledger(rows), "tiktok", "24h", now);
  const candidate: CreativeCandidate = { id: "v", network: "tiktok", family: "pov", hookStyle: "question", hook: "new text", sourceId: "new footage", isNewConcept: false };
  assert.equal(recommendCreativeMix([candidate], report).selected.length, 0);
});
test("promising views or a strong hook cannot mask weak family website traffic", () => {
  const rows = Array.from({ length: 8 }, (_, i) => row(String(i), { network: "facebook", family: i < 3 ? "pov" : "humor",
    metrics: { views: i < 3 ? 200 : 100, websiteClicks: i < 3 ? 10 : 100 } }));
  const report = analyzeLearning(ledger(rows), "facebook", "24h", now);
  report.groups.push({ dimension: "hookStyle", value: "strong-hook", postIds: ["a", "b", "c"], metrics: [
    { metric: "views", count: 3, referenceCount: 5, median: 300, referenceMedian: 100, ratio: 3, signal: "promising" },
  ] });
  const candidates: CreativeCandidate[] = [
    { id: "new-one", network: "facebook", family: "humor", hookStyle: "new", hook: "first", sourceId: "one", isNewConcept: true },
    { id: "conflict", network: "facebook", family: "pov", hookStyle: "strong-hook", hook: "second", sourceId: "two", isNewConcept: false },
    { id: "new-two", network: "facebook", family: "app", hookStyle: "new", hook: "third", sourceId: "three", isNewConcept: true },
  ];
  const mix = recommendCreativeMix(candidates, report, 3);
  assert.equal(mix.selected.some(s => s.candidate.id === "conflict"), false);
  assert.equal(mix.blockedVariations[0].candidateId, "conflict");
  assert.equal(mix.blockedVariations[0].evidence[0].metric, "websiteClicks");
  assert.equal(mix.blockedVariations[0].evidence[0].ratio, .1);
  assert.equal(mix.missing, 1);
});
