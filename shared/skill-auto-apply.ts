// Skills Scout auto-apply (deterministic, $0, no AI).
//
// Low risk -> applied on the next council round without waiting for the Trust Center:
//   a "lesson" proposal (prompt/skill text: a playbook label <= AUTO_APPLY_MAX_LABEL chars that
//   becomes a skill of exactly one existing career). The owner's success rate at apply time is
//   recorded; after ROLLBACK_AFTER_MS with >= ROLLBACK_MIN_SAMPLES new outcomes, a drop of more
//   than ROLLBACK_DROP_POINTS reverts it (lesson + skill removed, proposal withdrawn).
// Risky -> a factory order (repo files change, so it goes PR-first through the software factory):
//   a debate-derived skill_update ("skill:*", e.g. a SKILL.md cut by the chat bridge). One per day.
// Scout release notices: an older tag of the same repo is withdrawn as superseded by the newer one.
// new_agent / repair proposals are never touched here (they keep the owner approval path).

import { applyApprovedProposal, type CouncilProposal, type CouncilState } from "./agent-council";
import type { OutcomeSample } from "./agent-self-improvement";
import { createOrder } from "./agent-company";

export const AUTO_APPLY_MAX_LABEL = 140;
export const AUTO_APPLY_MAX_PER_ROUND = 5;
export const ROLLBACK_AFTER_MS = 3 * 24 * 3600_000;
export const ROLLBACK_MIN_SAMPLES = 4;
export const ROLLBACK_DROP_POINTS = 20;
export const SKILL_ORDER_PREFIX = "Skills Scout:";
const BASELINE_MS = 7 * 24 * 3600_000;
const UNAPPLIED = ["pending_submit", "not_submitted", "submitted"];

export type AutoApplyRecord = { at: string; baselineRate: number | null; baselineSamples: number; revertedAt?: string };
type Proposal = CouncilProposal & { autoApplied?: AutoApplyRecord; factoryOrderId?: string };

const ms = (v: unknown) => (typeof v === "string" ? Date.parse(v) || 0 : 0);
function rate(samples: OutcomeSample[], agentId: string, from: number, to: number) {
  const list = samples.filter(s => s.agentId === agentId && ms(s.at) > from && ms(s.at) <= to);
  return { n: list.length, rate: list.length ? Math.round((list.filter(s => s.status === "completed").length / list.length) * 100) : null };
}

export function isLowRiskProposal(p: CouncilProposal, careers: Record<string, unknown>): boolean {
  return p.kind === "lesson" && Boolean(p.lesson) && UNAPPLIED.includes(p.status) && !(p as Proposal).autoApplied
    && typeof p.lesson!.label === "string" && p.lesson!.label.length > 0 && p.lesson!.label.length <= AUTO_APPLY_MAX_LABEL
    && p.lesson!.subject === p.owner && Boolean(careers[p.owner]);
}

export type AutoApplyResult = { state: CouncilState; applied: string[]; reverted: string[]; ordered: string[]; superseded: string[] };

export function autoApplySkillImprovements(state: CouncilState, samples: OutcomeSample[], now: number, statuses: Record<string, { state: never | string; label: string }> = {}): AutoApplyResult {
  const iso = new Date(now).toISOString();
  const careers = state.company?.careers || {};
  const applied: string[] = [], reverted: string[] = [], ordered: string[] = [], superseded: string[] = [];
  let next = state;

  // 1. Low risk: apply.
  for (const p of state.proposals as Proposal[]) {
    if (applied.length >= AUTO_APPLY_MAX_PER_ROUND) break;
    if (!isLowRiskProposal(p, careers)) continue;
    const base = rate(samples, p.owner, now - BASELINE_MS, now);
    next = applyApprovedProposal(next, p.key, now);
    next = { ...next, proposals: next.proposals.map(x => x.key === p.key ? { ...x, note: "Aplicada sola (bajo riesgo: texto de skill acotado). Se revierte si baja el éxito.", autoApplied: { at: iso, baselineRate: base.rate, baselineSamples: base.n } } as Proposal : x) };
    applied.push(p.key);
  }

  // 2. Rollback on regression.
  for (const p of next.proposals as Proposal[]) {
    const rec = p.autoApplied;
    if (!rec || rec.revertedAt || p.status !== "applied" || rec.baselineRate === null || !p.lesson) continue;
    const at = ms(rec.at);
    if (now - at < ROLLBACK_AFTER_MS) continue;
    const after = rate(samples, p.owner, at, now);
    if (after.n < ROLLBACK_MIN_SAMPLES || after.rate === null || after.rate >= rec.baselineRate - ROLLBACK_DROP_POINTS) continue;
    const skillId = `leccion:${p.key}`;
    const career = next.company.careers[p.owner];
    next = {
      ...next,
      lessons: next.lessons.filter(l => l.key !== p.key),
      company: career ? { ...next.company, careers: { ...next.company.careers, [p.owner]: { ...career, skills: (career.skills || []).filter(s => s.id !== skillId) } } } : next.company,
      proposals: next.proposals.map(x => x.key === p.key ? { ...x, status: "withdrawn", closedAt: iso, note: `Revertida sola: el éxito bajó de ${rec.baselineRate}% a ${after.rate}% (${after.n} trabajos).`, autoApplied: { ...rec, revertedAt: iso } } as Proposal : x),
    };
    reverted.push(p.key);
  }

  // 3. Scout notices: keep only the newest tag per repo open.
  const newest = new Map<string, Proposal>();
  for (const p of next.proposals as Proposal[]) {
    const m = /^scout:(.+)@/.exec(p.key);
    if (!m || !UNAPPLIED.includes(p.status)) continue;
    const cur = newest.get(m[1]);
    if (!cur || ms(p.createdAt) > ms(cur.createdAt) || (ms(p.createdAt) === ms(cur.createdAt) && p.key > cur.key)) newest.set(m[1], p);
  }
  next = { ...next, proposals: next.proposals.map(p => {
    const m = /^scout:(.+)@(.+)$/.exec(p.key);
    if (!m || !UNAPPLIED.includes(p.status)) return p;
    const keep = newest.get(m[1]);
    if (!keep || keep.key === p.key) return p;
    superseded.push(p.key);
    return { ...p, status: "withdrawn", closedAt: iso, note: `Reemplazada por la versión más nueva (${keep.key.split("@")[1]}).` };
  }) };

  // 4. Risky document fixes -> one factory order per day (PR-first through the factory).
  const recentOrder = (next.company.orders || []).some(o => o.text.startsWith(SKILL_ORDER_PREFIX) && now - ms(o.createdAt) < 24 * 3600_000);
  const risky = (next.proposals as Proposal[]).find(p => p.kind === "skill_update" && p.key.startsWith("skill:") && UNAPPLIED.includes(p.status) && !p.factoryOrderId);
  if (risky && !recentOrder) {
    const files = risky.evidence.map(line => line.split(":")[0]).filter(f => f.endsWith(".md")).slice(0, 3);
    const text = `${SKILL_ORDER_PREFIX} ${risky.title}. ${risky.description}${files.length ? ` Archivos: ${files.join(", ")}.` : ""} PR-first, sin cambiar nombres ni reglas de seguridad.`.slice(0, 500);
    const result = createOrder(next.company, { text, now, statuses: statuses as never, available: ["code"], names: {}, assignees: ["code"] });
    next = { ...next, company: result.state, proposals: next.proposals.map(x => x.key === risky.key ? { ...x, factoryOrderId: result.order.id, note: `Riesgosa (cambia archivos): convertida en orden de fábrica ${result.order.id}.` } as Proposal : x) };
    ordered.push(risky.key);
  }
  return { state: next, applied, reverted, ordered, superseded };
}

/** Panel counts: how many skill improvements are active (applied, not reverted) vs still proposed. */
export function skillImprovementCounts(proposals: CouncilProposal[]): { active: number; proposed: number; reverted: number; ordered: number } {
  const ps = proposals as Proposal[];
  return {
    active: ps.filter(p => p.status === "applied" && (p.kind === "lesson" || p.kind === "skill_update")).length,
    proposed: ps.filter(p => UNAPPLIED.includes(p.status) && (p.kind === "lesson" || p.kind === "skill_update") && !p.factoryOrderId).length,
    reverted: ps.filter(p => p.autoApplied?.revertedAt).length,
    ordered: ps.filter(p => p.factoryOrderId).length,
  };
}
