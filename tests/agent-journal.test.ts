import test from "node:test";
import assert from "node:assert/strict";
import { buildAgentJournal, journalTrend, pacerCostsByDay, stampPointsDaily } from "../shared/agent-journal";
import { autoApplySkillImprovements, skillImprovementCounts, AUTO_APPLY_MAX_LABEL } from "../shared/skill-auto-apply";
import { emptyCouncilState, type CouncilProposal } from "../shared/agent-council";

const NOW = Date.parse("2026-11-26T15:00:00Z");
const h = (n: number) => new Date(NOW - n * 3600_000).toISOString();
const job = (role: string, status: string, hoursAgo: number, extra: Record<string, unknown> = {}) => ({ id: `${role}-${hoursAgo}-${status}`, role, status, startedAt: h(hoursAgo + 0.1), completedAt: h(hoursAgo), ...extra });
const career = (id: string, points: number, extra: Record<string, unknown> = {}) => ({ agentId: id, generation: 1, nickname: id, points, battery: 80, lastState: null, cyclesWorking: 0, cyclesTotal: 0, ordersDone: 0, firedCount: 0, hiredAt: h(500), memory: [], ...extra });

test("journal: today vs yesterday from real jobs only; nothing recorded -> sin datos", () => {
  const state = {
    company: { careers: { code: career("code", 30, { pointsDaily: [{ day: "2026-11-25", points: 10 }, { day: "2026-11-26", points: 20 }] }), news: career("news", 5) } },
    officeExecution: { roleWork: { jobs: [job("code", "completed", 1), job("code", "completed", 2), job("code", "blocked", 26, { reason: "source_unavailable" }), job("code", "completed", 27)] } },
  };
  const view = buildAgentJournal(state, NOW);
  const code = view.agents.find(a => a.id === "code")!;
  assert.equal(code.today.done, 2); assert.equal(code.today.successRate, 100);
  assert.equal(code.yesterday.done, 1); assert.equal(code.yesterday.blocked, 1); assert.equal(code.yesterday.successRate, 50);
  assert.equal(code.today.pointsEarned, 10); assert.equal(code.yesterday.pointsEarned, 10);
  assert.equal(code.trend, "mejor"); assert.equal(code.didToday.length, 2);
  const news = view.agents.find(a => a.id === "news")!;
  assert.equal(news.today.done, 0); assert.equal(news.trend, "sin_datos"); assert.equal(news.today.pointsEarned, null); assert.deepEqual(news.didToday, []);
  const bo = view.companies.find(c => c.company === "BlackOps")!;
  assert.equal(bo.doneToday, 2); assert.equal(bo.improved, 1); assert.equal(bo.spentTodayMicroUsd, null); // no pacer -> no fake $0
});

test("journal: cost per success only for task types owned by one agent; company spend from pacer", () => {
  const pacer = { version: 1, ledgers: { a: { pace: { day: "2026-11-26", spentTodayMicroUsd: 1_500_000 }, costs: { "2026-11-26": { factory_build: { count: 2, microUsd: 900_000, outputTokens: 1 }, office_other: { count: 1, microUsd: 100_000, outputTokens: 1 } } } } } };
  const state = { company: { careers: { "factory-builder": career("factory-builder", 1) } }, officeExecution: { creditPacer: pacer,
    factoryCareers: { processed: [{ agentId: "factory-builder", jobId: "j", evidenceId: "e1", completedAt: h(1), outcome: "success" }, { agentId: "factory-builder", jobId: "j", evidenceId: "e2", completedAt: h(2), outcome: "success" }] } } };
  const view = buildAgentJournal(state, NOW);
  const b = view.agents.find(a => a.id === "factory-builder")!;
  assert.equal(b.today.spentMicroUsd, 900_000); assert.equal(b.today.costPerSuccessMicroUsd, 450_000);
  assert.equal(view.companies[0].spentTodayMicroUsd, 1_500_000);
  assert.equal(pacerCostsByDay(undefined).readable, false);
});

test("journal trend and points stamps are bounded and idempotent per day", () => {
  const d = (done: number, rate: number | null, cps: number | null = null) => ({ day: "x", done, blocked: 0, successRate: rate, spentMicroUsd: null, costPerSuccessMicroUsd: cps, pointsEarned: null });
  assert.equal(journalTrend(d(1, 50), d(3, 90)), "peor");
  assert.equal(journalTrend(d(2, 100, 100), d(2, 100, 200)), "mejor");
  const one = stampPointsDaily(undefined, 5, NOW);
  assert.deepEqual(stampPointsDaily(one, 9, NOW), one);
  assert.equal(stampPointsDaily([1, 2, 3, 4, 5].map(i => ({ day: `2026-11-0${i}`, points: i })), 1, NOW).length, 4);
});

const lessonProposal = (key: string, owner: string, label = "Mejora: conectar su fuente de datos", status: CouncilProposal["status"] = "submitted"): CouncilProposal =>
  ({ key, kind: "lesson", owner, title: "t", description: "d", evidence: [], handoffBrief: "b", createdAt: h(10), status, lesson: { ruleId: key, subject: owner, label } });

test("auto-apply: low-risk lesson applies, oversized or ownerless stays proposed", () => {
  const base = emptyCouncilState();
  const state = { ...base, company: { ...base.company, careers: { code: career("code", 1) as any } },
    proposals: [lessonProposal("automejora:code:X", "code"), lessonProposal("automejora:code:Y", "code", "x".repeat(AUTO_APPLY_MAX_LABEL + 1)), lessonProposal("automejora:ghost:Z", "ghost")] };
  const r = autoApplySkillImprovements(state, [], NOW);
  assert.deepEqual(r.applied, ["automejora:code:X"]);
  assert.equal(r.state.lessons.length, 1);
  assert.equal(r.state.proposals.find(p => p.key === "automejora:code:X")!.status, "applied");
  assert.equal(r.state.proposals.find(p => p.key === "automejora:code:Y")!.status, "submitted");
  assert.equal(skillImprovementCounts(r.state.proposals).active, 1);
  // Idempotent: a second round applies nothing new.
  assert.deepEqual(autoApplySkillImprovements(r.state, [], NOW + 60_000).applied, []);
});

test("auto-apply: rollback when the owner's success rate drops after applying", () => {
  const base = emptyCouncilState();
  const before = Array.from({ length: 4 }, (_, i) => ({ agentId: "code", jobId: `b${i}`, status: "completed" as const, at: h(20 + i), diagnostics: [] }));
  const state = { ...base, company: { ...base.company, careers: { code: career("code", 1) as any } }, proposals: [lessonProposal("automejora:code:X", "code")] };
  const applied = autoApplySkillImprovements(state, before, NOW).state;
  const later = NOW + 4 * 24 * 3600_000;
  const after = Array.from({ length: 4 }, (_, i) => ({ agentId: "code", jobId: `a${i}`, status: (i ? "blocked" : "completed") as "blocked" | "completed", at: new Date(later - (i + 1) * 3600_000).toISOString(), diagnostics: [] }));
  const withSkill = { ...applied, company: { ...applied.company, careers: { code: { ...applied.company.careers.code, skills: [{ id: "leccion:automejora:code:X", title: "t", source: "leccion", learnedAt: h(1) } as any] } } } };
  const r = autoApplySkillImprovements(withSkill, [...before, ...after], later);
  assert.deepEqual(r.reverted, ["automejora:code:X"]);
  assert.equal(r.state.lessons.length, 0);
  assert.equal(r.state.company.careers.code.skills!.length, 0);
  assert.equal(r.state.proposals[0].status, "withdrawn");
});

test("auto-apply: risky doc fix becomes ONE factory order a day; older scout tags superseded", () => {
  const base = emptyCouncilState();
  const skill: CouncilProposal = { key: "skill:skills-truncated", kind: "skill_update", owner: "skills-scout", title: "2 skill(s) se cortan", description: "d", evidence: [".claude/skills/qa-gate/SKILL.md: se recorta"], handoffBrief: "b", createdAt: h(5), status: "submitted" };
  const scout = (tag: string, hoursAgo: number): CouncilProposal => ({ key: `scout:vitejs/vite@${tag}`, kind: "skill_update", owner: "skills-scout", title: tag, description: "d", evidence: [], handoffBrief: "b", createdAt: h(hoursAgo), status: "submitted" });
  const state = { ...base, proposals: [skill, scout("v1", 50), scout("v2", 2)] };
  const r = autoApplySkillImprovements(state, [], NOW);
  assert.deepEqual(r.ordered, ["skill:skills-truncated"]);
  assert.equal(r.state.company.orders.length, 1);
  assert.deepEqual(r.state.company.orders[0].assignees.map(a => a.agentId), ["code"]);
  assert.match(r.state.company.orders[0].text, /^Skills Scout:/);
  assert.deepEqual(r.superseded, ["scout:vitejs/vite@v1"]);
  const again = autoApplySkillImprovements(r.state, [], NOW + 3600_000);
  assert.equal(again.state.company.orders.length, 1);
});
