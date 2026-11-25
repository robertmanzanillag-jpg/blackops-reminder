import test from "node:test";
import assert from "node:assert/strict";
import { advanceCompany, emptyCompanyState } from "../shared/agent-company";
import { applyOutcomeLessons, collectOutcomeSamples, deriveAgentLessons, learningSummary, lessonPromptLines, MAX_AGENT_LESSONS, type OutcomeSample } from "../shared/agent-self-improvement";
import { buildOfficeRoster } from "../server/office-roster-status";
import { emptyCouncilState } from "../shared/agent-council";

const NOW = Date.parse("2026-11-25T12:00:00Z");
const H = 3600_000;
const at = (h: number) => new Date(NOW - h * H).toISOString();
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const company = (ids: string[]) => advanceCompany(emptyCompanyState(), { now: NOW - 100 * H, roles: Object.fromEntries(ids.map(id => [id, id])), statuses: Object.fromEntries(ids.map(id => [id, { state: "available" as const, label: "x" }])) }).state;
const blocked = (role: string, n: number, h: number, reason = "source_unavailable") => ({ id: uuid(n), role, status: "blocked", reason, startedAt: at(h), completedAt: at(h - 0.01) });

test("collect: only completed/blocked jobs with real times; invalid rows dropped", () => {
  const s = collectOutcomeSamples({ roleWorkJobs: [blocked("code", 1, 2), { id: uuid(2), role: "code", status: "running", startedAt: at(1) }, { role: "code", status: "completed" }, null],
    factoryLedger: { processed: [{ agentId: "factory-builder", jobId: "j", evidenceId: "e", outcome: "attributable_failure", reason: "PATCH", completedAt: at(3) }, { agentId: "factory-qa", jobId: "k", evidenceId: "f", outcome: "exempt", completedAt: at(3) }] } });
  assert.equal(s.length, 2);
  assert.equal(s[0].reason, "source_unavailable");
  assert.equal(s[1].verdict, "attributable_failure");
});

test("repeated blocker becomes a playbook lesson; a single block does not", () => {
  const one = collectOutcomeSamples({ roleWorkJobs: [blocked("news", 1, 30)] });
  assert.deepEqual(deriveAgentLessons(one, NOW), []);
  const two = collectOutcomeSamples({ roleWorkJobs: [blocked("news", 1, 30), blocked("news", 2, 5)] });
  const [lesson] = deriveAgentLessons(two, NOW);
  assert.equal(lesson.kind, "bloqueo"); assert.match(lesson.text, /fuente de datos/); assert.equal(lesson.evidence, 2);
});

test("recurring diagnostic on 2 distinct days becomes a priority", () => {
  const job = (n: number, h: number) => ({ id: uuid(n), role: "github", status: "completed", startedAt: at(h), completedAt: at(h - 0.1), audit: { diagnostics: ["PR_STALE"] } });
  const lessons = deriveAgentLessons(collectOutcomeSamples({ roleWorkJobs: [job(1, 30), job(2, 2)] }), NOW);
  assert.ok(lessons.some(l => l.kind === "diagnostico" && /PR estancados/.test(l.text)));
});

test("duration spike and reviewer verdicts produce lessons; old samples are ignored", () => {
  const s: OutcomeSample[] = [1, 1, 1, 5].map((m, i) => ({ agentId: "radio", jobId: `r${i}`, status: "completed", at: at(10 - i), diagnostics: [], durationMs: m * 60_000 }));
  assert.ok(deriveAgentLessons(s, NOW).some(l => l.kind === "duracion"));
  const old = s.map(x => ({ ...x, at: at(24 * 9) }));
  assert.deepEqual(deriveAgentLessons(old, NOW), []);
  const v: OutcomeSample[] = [1, 2].map(i => ({ agentId: "factory-builder", jobId: `v${i}`, status: "blocked", at: at(i), verdict: "attributable_failure", reason: "PATCH", diagnostics: [] }));
  assert.ok(deriveAgentLessons(v, NOW).some(l => l.kind === "revision"));
});

test("cost spike only with a measured previous average; never invented", () => {
  const s: OutcomeSample[] = [{ agentId: "factory-builder", jobId: "a", status: "completed", at: at(1), diagnostics: [] }];
  assert.ok(deriveAgentLessons(s, NOW, { taskType: "factory_build", avgMicroUsd: 800_000, previousAvgMicroUsd: 500_000 }).some(l => l.kind === "costo"));
  assert.deepEqual(deriveAgentLessons(s, NOW, { taskType: "factory_build", avgMicroUsd: 800_000, previousAvgMicroUsd: null }), []);
});

test("apply: persisted per agent, bounded, idempotent, agents without outcomes untouched", () => {
  const c0 = company(["news", "code"]);
  const samples = collectOutcomeSamples({ roleWorkJobs: [blocked("news", 1, 30), blocked("news", 2, 5)] });
  const c1 = applyOutcomeLessons(c0, samples, NOW);
  assert.equal(c1.careers.news.learning!.lessons.length, 1);
  assert.equal(c1.careers.code.learning, undefined);
  assert.equal(applyOutcomeLessons(c1, samples, NOW + 60_000), c1, "same evidence = no change");
  const many: OutcomeSample[] = Array.from({ length: 10 }, (_, i) => [0, 1].map(k => ({ agentId: "news", jobId: `${i}-${k}`, status: "blocked" as const, at: at(i + k * 30), reason: `R_${i}`, diagnostics: [] }))).flat();
  const c2 = applyOutcomeLessons(c1, many, NOW);
  assert.equal(c2.careers.news.learning!.lessons.length, MAX_AGENT_LESSONS);
  assert.equal(c2.careers.news.learning!.total, 11);
  assert.equal(lessonPromptLines(c2.careers.news.learning).length, 3);
});

test("roster exposes aprendizajes and last lesson (0/null when none)", () => {
  const c = applyOutcomeLessons(company(["news"]), collectOutcomeSamples({ roleWorkJobs: [blocked("news", 1, 30), blocked("news", 2, 5)] }), NOW);
  const roster = buildOfficeRoster({ ...emptyCouncilState(), company: c } as any, NOW);
  const news = roster.agents.find(a => a.id === "news")!;
  assert.equal(news.aprendizajes, 1); assert.match(news.ultimoAprendizaje!, /Bloqueo repetido/);
  const code = roster.agents.find(a => a.id === "code")!;
  assert.equal(code.aprendizajes, 0); assert.equal(code.ultimoAprendizaje, null);
  assert.deepEqual(learningSummary(undefined), { aprendizajes: 0, ultimoAprendizaje: null });
});
