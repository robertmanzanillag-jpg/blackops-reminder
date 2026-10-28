import { test } from "node:test";
import assert from "node:assert/strict";
import { createLearningSelector } from "../server/kong-learning-selection";
import { emptyState, fillPlan, type Asset, type Job, type Network } from "../server/kong-autopilot-core";
import type { LearningLedger } from "../server/kong-content-learning";
import { formatMetricoolMcpDate } from "../server/blackroom-metricool-bridge";
const now = new Date("2026-10-28T12:00:00Z");
const asset = (id: number, family: Asset["family"], kind: "exploration" | "variation"): Asset => ({
  id: `asset-${id}`, family, hook: `Hook ${id}`, title: `Night ${id}`, caption: "Discover nightlife https://kongnightlife.com",
  sourceUrl: "https://example.com/source", mediaUrl: `https://example.com/${id}.mp4`, sha256: id.toString(16).padStart(64, "0"),
  plannedDay: "2026-10-28", durationSeconds: 12, width: 1080, height: 1920,
  creativeTest: { testId: `test-${id}`, kind, hookStyle: family, sourceIds: [`source-${id}`] },
  footageRights: { confirmedBy: "owner", evidenceUrl: "https://example.com/rights", expiresAt: "2027-01-01T00:00:00Z" },
  musicRights: { confirmedBy: "owner", evidenceUrl: "https://example.com/music", expiresAt: "2027-01-01T00:00:00Z" },
  qa: { reviewedBy: "editor", reviewedAt: "2026-10-27T00:00:00Z", officialWhiteLogo: true, noLogoBackgroundOrShadow: true,
    safeZones: true, audioChecked: true, spellingChecked: true, renderedSha256: id.toString(16).padStart(64, "0") }
});
const ledger = (): LearningLedger => ({ version: 1, observations: (["tiktok", "facebook"] as const).flatMap(network =>
  Array.from({ length: 10 }, (_, i) => ({ network, postId: `${network}-${i}`, sourceUrl: "https://example.com/post",
    publishedAt: "2026-10-25T10:00:00Z", observedAt: "2026-10-28T10:00:00Z", family: i < 5 ? "pov" as const : "humor" as const,
    hookStyle: i < 5 ? "pov" : "humor", metrics: { views: 200, websiteClicks: (network === "facebook" ? i < 5 : i >= 5) ? 20 : 10 } }))) });
const prior = (a: Asset): Job => ({ id: "prior", day: "2026-10-28", network: "facebook", slot: 0, at: now.toISOString(), asset: a, state: "planned", attempts: 0 });
const convert = (wall: string) => formatMetricoolMcpDate(wall, "America/New_York");
test("actual new assignments differ by network and retain auditable evidence", () => {
  const assets = [asset(1, "dancefloor", "exploration"), asset(2, "pov", "variation"), asset(3, "humor", "variation")];
  const s = fillPlan(emptyState(), assets, now, convert, createLearningSelector(ledger(), now));
  assert.equal(s.jobs.find(j => j.network === "facebook" && j.slot === 1)?.asset.id, "asset-2");
  assert.equal(s.jobs.find(j => j.network === "tiktok" && j.slot === 1)?.asset.id, "asset-3");
  assert.ok(s.selectionDecisions!.filter(d => d.mode === "variation").every(d => d.horizon === "72h" && d.evidence!.some(e => e.metric === "websiteClicks" && e.count === 5 && e.referenceCount === 5)));
});
test("strong views or hook cannot hide weak primary family outcome", () => {
  const data = ledger(); data.observations.filter(r => r.network === "facebook").forEach((r, i) => {
    r.metrics = { views: i < 5 ? 1000 : 200, websiteClicks: i < 5 ? 1 : 10 }; r.hookStyle = i < 5 ? "highviews" : "other";
  });
  const candidate = asset(2, "pov", "variation"); candidate.creativeTest!.hookStyle = "highviews";
  const result = createLearningSelector(data, now)({ jobId: "new", network: "facebook", eligible: [candidate], daily: [prior(asset(1, "dancefloor", "exploration"))], recent: [] });
  assert.equal(result.asset, undefined); assert.equal(result.decision.mode, "gap");
});
test("missing metrics remain absent and no evidence leaves baseline untouched", () => {
  const data = ledger(); data.observations.forEach(r => { r.metrics = {}; });
  const assets = [asset(2, "pov", "variation"), asset(1, "dancefloor", "exploration")];
  const plain = fillPlan(emptyState(), assets, now, convert);
  const measured = fillPlan(emptyState(), assets, now, convert, createLearningSelector(data, now));
  assert.deepEqual(measured.jobs, plain.jobs);
  assert.ok(measured.selectionDecisions!.filter(d => d.assetId).every(d => d.mode === "baseline" && d.reason === "no_reliable_recent_evidence"));
  assert.ok(data.observations.every(r => !Object.hasOwn(r.metrics, "websiteClicks")));
});
test("missing metadata never manufactures novelty or optimizer claims", () => {
  const a = asset(1, "pov", "variation"); delete a.creativeTest;
  const result = createLearningSelector(ledger(), now)({ jobId: "new", network: "facebook", eligible: [a], daily: [], recent: [] });
  assert.equal(result.asset, a); assert.equal(result.decision.reason, "explicit_test_metadata_missing");
});
test("explicit baseline supply remains baseline even with promising historical evidence", () => {
  const a = asset(1, "pov", "variation"); a.creativeTest!.kind = "baseline";
  const result = createLearningSelector(ledger(), now)({ jobId: "new", network: "facebook", eligible: [a], daily: [], recent: [] });
  assert.equal(result.asset, a);
  assert.equal(result.decision.mode, "baseline");
  assert.equal(result.decision.reason, "baseline_supply_not_a_controlled_optimization_pool");
});
test("optimized selection reserves40percent and refuses missing exploration supply", () => {
  const selector = createLearningSelector(ledger(), now), daily: Job[] = [];
  const pool = [asset(1, "dancefloor", "exploration"), asset(2, "pov", "variation"), asset(3, "humor", "exploration"), asset(4, "pov", "variation"), asset(5, "dancefloor", "exploration")];
  for (let i = 0; i < 5; i++) {
    const selected = selector({ jobId: `job-${i}`, network: "facebook", eligible: pool.filter(a => !daily.some(j => j.asset === a)), daily, recent: daily });
    if (selected.asset) daily.push(prior(selected.asset));
  }
  assert.equal(daily.length, 5); assert.ok(daily.filter(j => j.asset.creativeTest!.kind === "exploration").length >= 2);
  assert.equal(selector({ jobId: "gap", network: "facebook", eligible: [asset(2, "pov", "variation")], daily: [], recent: [] }).decision.mode, "gap");
});
test("existing scheduled jobs remain immutable and their decisions are retained", () => {
  const assets = [asset(1, "dancefloor", "exploration"), asset(2, "pov", "variation")];
  const s = fillPlan(emptyState(), assets, now, convert, createLearningSelector(ledger(), now));
  s.jobs.forEach(j => { j.state = "scheduled"; j.receipt = "provider-id"; });
  const before = JSON.stringify(s.jobs), existingIds = new Set(s.jobs.map(j => j.id)), decisions = s.selectionDecisions!.filter(d => d.assetId);
  fillPlan(s, assets.slice().reverse(), now, convert, createLearningSelector(undefined, now));
  assert.equal(JSON.stringify(s.jobs.filter(j => existingIds.has(j.id))), before);
  assert.ok(decisions.every(d => s.selectionDecisions!.some(saved => JSON.stringify(saved) === JSON.stringify(d))));
});
test("seven-day evidence is fallback,24h alone cannot optimize, and reused source stays excluded", () => {
  const data = ledger(), a = asset(2, "pov", "variation");
  data.observations.forEach(r => { r.publishedAt = "2026-10-21T10:00:00Z"; });
  const input = { jobId: "new", network: "facebook" as Network, eligible: [a], daily: [prior(asset(1, "dancefloor", "exploration"))], recent: [] as Job[] };
  assert.equal(createLearningSelector(data, now)(input).decision.horizon, "7d");
  input.recent = [prior({ ...asset(3, "humor", "exploration"), creativeTest: { ...a.creativeTest!, kind: "exploration" } })];
  assert.equal(createLearningSelector(data, now)(input).asset, undefined);
  data.observations.forEach(r => { r.publishedAt = "2026-10-27T10:00:00Z"; });
  assert.equal(createLearningSelector(data, now)(input).decision.mode, "baseline");
});
test("TikTok weak shares veto strong views", () => {
  const data = ledger(); data.observations.filter(r => r.network === "tiktok").forEach((r, i) => {
    r.metrics = { views: i < 5 ? 1000 : 200, shares: i < 5 ? 1 : 10 };
  });
  const result = createLearningSelector(data, now)({ jobId: "new", network: "tiktok", eligible: [asset(2, "pov", "variation")],
    daily: [prior(asset(1, "dancefloor", "exploration"))], recent: [] });
  assert.equal(result.asset, undefined); assert.equal(result.decision.mode, "gap");
});
test("decision history is append-only for transitions and ignores repeated clock-only changes", () => {
  const s = emptyState(), assets = [asset(2, "pov", "variation")];
  fillPlan(s, assets, now, convert, createLearningSelector(ledger(), now));
  const before = [...s.selectionDecisions!]; assert.equal(s.jobs.length, 0);
  const later = new Date(+now + 60_000);
  fillPlan(s, assets, later, convert, createLearningSelector(ledger(), later));
  assert.deepEqual(s.selectionDecisions, before);
  fillPlan(s, assets, later, convert, createLearningSelector(undefined, later));
  assert.deepEqual(s.selectionDecisions!.slice(0, before.length), before);
  assert.ok(s.selectionDecisions!.length > before.length);
  const jobId = "kong:2026-10-28:facebook:0";
  assert.deepEqual(s.selectionDecisions!.filter(d => d.jobId === jobId).map(d => d.mode), ["gap", "baseline"]);
});
