// Bitácora diaria ("Notas") of every agent, both companies (pure, no IO, no AI calls).
//
// Built ONLY from records the council already persists:
//  - officeExecution.roleWork / deskWork / internalWork jobs and the factory career ledger
//    (via collectOutcomeSamples: completed/blocked jobs with their real timestamps)
//  - officeExecution.creditPacer costs per day and task type (spend; attributed per agent only
//    for task types owned by exactly one agent, COST_OWNERS)
//  - careers: points, daily points stamps (pointsDaily), efficiency trend from outcome learning
// An agent with no record for a day shows 0 done and null rates: nothing is ever estimated.

import { collectOutcomeSamples, COST_OWNERS, type OutcomeSample } from "./agent-self-improvement";
import { isKongCompanyAgent } from "./agent-company";

export type JournalDay = { day: string; done: number; blocked: number; successRate: number | null; spentMicroUsd: number | null; costPerSuccessMicroUsd: number | null; pointsEarned: number | null };
export type JournalTrend = "mejor" | "peor" | "igual" | "sin_datos";
export type JournalAgent = {
  id: string; name: string; company: "BlackOps" | "KONG";
  today: JournalDay; yesterday: JournalDay;
  /** What it did today: one line per recorded job (status + time + reason code), newest first. */
  didToday: string[];
  points: number | null;
  trend: JournalTrend;
  /** Week-over-week successes per $ from shared/agent-self-improvement.ts (null when no spend recorded). */
  efficiencyTrend: "mejor" | "peor" | "igual" | "nuevo" | null;
  skillsApplied: number;
};
export type JournalCompanySummary = { company: "BlackOps" | "KONG"; agents: number; doneToday: number; doneYesterday: number; improved: number; worse: number; spentTodayMicroUsd: number | null };
export type AgentJournalView = { observedAt: string; today: string; yesterday: string; companies: JournalCompanySummary[]; agents: JournalAgent[] };

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => Boolean(v) && typeof v === "object" && !Array.isArray(v);
const dayOf = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const jobsOf = (v: unknown) => (isObj(v) && Array.isArray(v.jobs) ? v.jobs : []);
const safeInt = (v: unknown) => (Number.isSafeInteger(v) && (v as number) >= 0 ? (v as number) : null);

/** Per-day spend per task type summed over every pacer ledger. Unreadable state -> empty (no spend shown, never 0-faked). */
export function pacerCostsByDay(pacer: unknown): { byType: Record<string, Record<string, number>>; totals: Record<string, number>; readable: boolean } {
  const byType: Record<string, Record<string, number>> = {}, totals: Record<string, number> = {};
  if (!isObj(pacer) || !isObj(pacer.ledgers)) return { byType, totals, readable: false };
  for (const ledger of Object.values(pacer.ledgers)) {
    if (!isObj(ledger) || !isObj(ledger.costs)) continue;
    for (const [day, types] of Object.entries(ledger.costs)) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !isObj(types)) continue;
      for (const [type, row] of Object.entries(types)) {
        const micro = isObj(row) ? safeInt(row.microUsd) : null;
        if (micro === null) continue;
        (byType[day] ??= {})[type] = (byType[day][type] || 0) + micro;
        totals[day] = (totals[day] || 0) + micro;
      }
    }
    // Today's pace may be ahead of the per-type costs (office samples not yet bucketed).
    const pace = isObj(ledger.pace) ? ledger.pace : null;
    const paceDay = pace && typeof pace.day === "string" ? pace.day : null, spent = pace ? safeInt(pace.spentTodayMicroUsd) : null;
    if (paceDay && spent !== null && spent > (totals[paceDay] || 0)) totals[paceDay] = spent;
  }
  return { byType, totals, readable: true };
}

/** Points at the first council round of each UTC day (careers[id].pointsDaily, newest last). */
export function stampPointsDaily(prev: unknown, points: number, now: number): Array<{ day: string; points: number }> {
  const list = Array.isArray(prev) ? prev.filter((e): e is { day: string; points: number } => isObj(e) && typeof e.day === "string" && Number.isFinite(e.points)) : [];
  const today = dayOf(now);
  if (list.some(e => e.day === today)) return list;
  return [...list, { day: today, points }].slice(-4);
}

function dayStats(samples: OutcomeSample[], day: string, spent: number | null, pointsEarned: number | null): JournalDay {
  const mine = samples.filter(s => s.at.slice(0, 10) === day);
  const done = mine.filter(s => s.status === "completed").length, blocked = mine.length - done;
  return { day, done, blocked, successRate: mine.length ? Math.round((done / mine.length) * 100) : null, spentMicroUsd: spent,
    costPerSuccessMicroUsd: spent !== null && done > 0 ? Math.round(spent / done) : null, pointsEarned };
}

/** Improved = more successes at an equal-or-better rate, or a better rate at equal successes, or cheaper per success. */
export function journalTrend(today: JournalDay, yesterday: JournalDay): JournalTrend {
  if (today.successRate === null || yesterday.successRate === null) return "sin_datos";
  let score = 0;
  if (today.done > yesterday.done) score++; else if (today.done < yesterday.done) score--;
  if (today.successRate > yesterday.successRate + 5) score++; else if (today.successRate < yesterday.successRate - 5) score--;
  if (today.costPerSuccessMicroUsd !== null && yesterday.costPerSuccessMicroUsd !== null) {
    if (today.costPerSuccessMicroUsd < yesterday.costPerSuccessMicroUsd * 0.9) score++; else if (today.costPerSuccessMicroUsd > yesterday.costPerSuccessMicroUsd * 1.1) score--;
  }
  return score > 0 ? "mejor" : score < 0 ? "peor" : "igual";
}

export type JournalInput = { company?: { careers?: Record<string, unknown> }; kongCompany?: { careers?: Record<string, unknown> }; officeExecution?: unknown; lessons?: Array<{ subject?: string }> };

export function buildAgentJournal(state: JournalInput, now: number, names: Record<string, string> = {}, roster: Array<{ id: string; name: string }> = []): AgentJournalView {
  const today = dayOf(now), yesterday = dayOf(now - 86_400_000);
  const exec = isObj(state.officeExecution) ? state.officeExecution : {};
  const samples = collectOutcomeSamples({ roleWorkJobs: jobsOf(exec.roleWork), internalWorkJobs: jobsOf(exec.internalWork), deskWorkJobs: jobsOf(exec.deskWork), factoryLedger: exec.factoryCareers });
  const costs = pacerCostsByDay(exec.creditPacer);
  const careers: Record<string, unknown> = { ...(state.kongCompany?.careers || {}), ...(state.company?.careers || {}) };
  const ids = new Map<string, string>();
  for (const r of roster) ids.set(r.id, r.name);
  for (const id of Object.keys(careers)) if (!ids.has(id)) ids.set(id, names[id] || id);
  for (const s of samples) if (!ids.has(s.agentId)) ids.set(s.agentId, names[s.agentId] || s.agentId);
  const ownedTypes = (id: string) => Object.entries(COST_OWNERS).filter(([, owner]) => owner === id).map(([type]) => type);
  const spentFor = (id: string, day: string) => {
    const types = ownedTypes(id);
    if (!types.length || !costs.readable) return null;
    return types.reduce((sum, t) => sum + (costs.byType[day]?.[t] || 0), 0);
  };
  const agents: JournalAgent[] = [];
  for (const [id, name] of ids) {
    const mine = samples.filter(s => s.agentId === id);
    const career = isObj(careers[id]) ? careers[id] as Obj : null;
    const points = career && Number.isFinite(career.points) ? career.points as number : null;
    const stamps = career && Array.isArray(career.pointsDaily) ? career.pointsDaily as Array<{ day: string; points: number }> : [];
    const at = (d: string) => stamps.find(e => e.day === d)?.points;
    const tStart = at(today), yStart = at(yesterday);
    const pointsToday = points !== null && tStart !== undefined ? points - tStart : null;
    const pointsYesterday = tStart !== undefined && yStart !== undefined ? tStart - yStart : null;
    const t = dayStats(mine, today, spentFor(id, today), pointsToday), y = dayStats(mine, yesterday, spentFor(id, yesterday), pointsYesterday);
    const didToday = mine.filter(s => s.at.slice(0, 10) === today).sort((a, b) => b.at.localeCompare(a.at)).slice(0, 6)
      .map(s => `${s.at.slice(11, 16)} UTC · ${s.status === "completed" ? "completado" : "bloqueado"}${s.reason ? ` (${s.reason})` : ""}${s.diagnostics.length ? ` · ${s.diagnostics.slice(0, 3).join(", ")}` : ""}`);
    const eff = career && isObj(career.efficiency) ? career.efficiency : null;
    const effTrend = eff && ["mejor", "peor", "igual", "nuevo"].includes(String(eff.trend)) ? eff.trend as JournalAgent["efficiencyTrend"] : null;
    const skills = career && Array.isArray(career.skills) ? career.skills.filter(s => isObj(s) && typeof s.id === "string" && s.id.startsWith("leccion:")).length : 0;
    agents.push({ id, name, company: isKongCompanyAgent(id) ? "KONG" : "BlackOps", today: t, yesterday: y, didToday, points, trend: journalTrend(t, y), efficiencyTrend: effTrend, skillsApplied: skills });
  }
  agents.sort((a, b) => a.company.localeCompare(b.company) || b.today.done - a.today.done || a.name.localeCompare(b.name));
  const companies: JournalCompanySummary[] = (["BlackOps", "KONG"] as const).map(company => {
    const list = agents.filter(a => a.company === company);
    return { company, agents: list.length, doneToday: list.reduce((n, a) => n + a.today.done, 0), doneYesterday: list.reduce((n, a) => n + a.yesterday.done, 0),
      improved: list.filter(a => a.trend === "mejor").length, worse: list.filter(a => a.trend === "peor").length,
      // Credit-pacer spend is the BlackOps office/factory's; KONG's own spend is not read from here.
      spentTodayMicroUsd: company === "BlackOps" && costs.readable ? costs.totals[today] || 0 : null };
  });
  return { observedAt: new Date(now).toISOString(), today, yesterday, companies, agents };
}
