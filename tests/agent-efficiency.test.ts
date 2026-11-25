import test from "node:test";
import assert from "node:assert/strict";
import { advanceCompany, emptyCompanyState } from "../shared/agent-company";
import { applyOutcomeLessons, deriveAgentEfficiency, deriveEfficiencyTuning, efficiencySummary, efficiencyTuningOf, type CostTrend, type OutcomeSample } from "../shared/agent-self-improvement";

const NOW = Date.parse("2026-11-25T12:00:00Z"), H = 3600_000, D = 24 * H;
const done = (i: number, ago: number): OutcomeSample => ({ agentId: "factory-builder", jobId: `j${i}`, status: "completed", at: new Date(NOW - ago).toISOString(), diagnostics: [] });
const week = (n: number, offset = 0) => Array.from({ length: n }, (_, i) => done(i + offset * 100, offset * 7 * D + (i + 1) * H));
const pricier: CostTrend = { taskType: "factory_build", avgMicroUsd: 500_000, count: 4, previousAvgMicroUsd: 250_000, previousCount: 4 };
const samples = () => [...week(4), ...week(4, 1)];

test("rendimiento por dólar: successes per $ week over week, never invented", () => {
  assert.equal(deriveAgentEfficiency(week(3), NOW), null, "no spend record -> no metric");
  const e = deriveAgentEfficiency(samples(), NOW, pricier)!;
  assert.equal(e.weekSuccesses, 4); assert.equal(e.prevWeekSuccesses, 4);
  assert.equal(e.successesPerUsd, 2); assert.equal(e.prevSuccessesPerUsd, 4); assert.equal(e.trend, "peor");
  assert.equal(e.microUsdPerSuccess, 500_000); assert.equal(e.tokensPerSuccess, null);
});

test("tuning shrinks within bounds, one step per week, and relaxes if successes drop", () => {
  const e = deriveAgentEfficiency(samples(), NOW, pricier)!;
  const t = deriveEfficiencyTuning(e, undefined, NOW)!;
  assert.deepEqual([t.contextSlices, t.historyMessages, t.preferCachedPrefix], [3, 5, true]);
  assert.equal(deriveEfficiencyTuning(e, t, NOW + D), null, "cooldown");
  let cur: unknown = t;
  for (let w = 1; w < 10; w++) cur = deriveEfficiencyTuning(e, cur, NOW + w * 8 * D) || cur;
  assert.deepEqual(efficiencyTuningOf(cur), { contextSlices: 1, historyMessages: 2 });
  assert.equal(deriveEfficiencyTuning({ ...e, weekSuccesses: 1, prevWeekSuccesses: 4 }, cur, NOW + 200 * D)!.contextSlices, 2);
  assert.deepEqual(efficiencyTuningOf({ contextSlices: 99, historyMessages: -3 }), { contextSlices: 4, historyMessages: 2 });
});

test("applyOutcomeLessons stores efficiency, tuning and an eficiencia lesson; roster summary", () => {
  const company = advanceCompany(emptyCompanyState(), { now: NOW - 100 * D, roles: { "factory-builder": "b" }, statuses: { "factory-builder": { state: "available" as const, label: "x" } } }).state;
  const next = applyOutcomeLessons(company, samples(), NOW, [pricier]);
  const c = next.careers["factory-builder"];
  assert.equal(c.efficiency?.trend, "peor"); assert.equal(c.tuning?.contextSlices, 3);
  assert.ok(c.learning?.lessons.some(l => l.kind === "eficiencia"));
  assert.deepEqual(efficiencySummary(c.efficiency), { exitosPorDolar: 2, costoPorExito: 500_000, tendenciaEficiencia: "peor" });
  assert.equal(applyOutcomeLessons(next, samples(), NOW + H, [pricier]), next, "no churn when unchanged");
});
