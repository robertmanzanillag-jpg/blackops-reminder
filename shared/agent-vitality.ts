// "Vida" (agent health 0-100) driven by verified output cadence.
//
// Pure and deterministic ($0, no AI, no IO). It reuses the existing career battery
// (shared/agent-company.ts) as the single "vida" number, and adds the one rule that was
// missing: an agent that produces no verified output within its expected cadence loses
// vida, once per missed window; a verified output recovers it. It never fires, replaces
// or deletes an agent: at 0 the agent is only flagged for the CEO/Robert (the Mechanic's
// existing repair proposal and the Trust Center approval stay the only way forward).
//
// What counts as verified output:
// - any career evaluation that ended in "working" with distinct evidence (factory stage
//   rows, Clippers receipts, internal work, Black Room approvals) -- already scored by
//   advanceCompany; here it only moves the cadence clock;
// - extra evidence supplied by the caller that no other path scores (office role-work jobs
//   completed with an artifact, the cloud streamer lane's run/post/observation receipts).
// What never counts: heartbeats, readiness, a configured seat, a plan, a manual close.
// What pauses the clock (no loss): an explicit setup hold (missing credentials or source,
// needs-setup, a life-penalty exemption) and the academy.

import { BATTERY_MAX, type AgentCareer, type CompanyState, type MemoryEntry } from "./agent-company";
import { CLIPPERS_AGENTS } from "./clippers-office-agents";
import { FACTORY_AGENTS } from "./factory-office-agents";
import type { AgentLiveStatus } from "./agent-live-status";
import { onDutyStatus } from "./office-on-duty";

export const HOUR_MS = 60 * 60_000;
/** Vida recovered by one cycle with new verified output that no other rule scored. */
export const VITALITY_RECOVERY = 6;
/** Cost of one missed cadence window (same as a KONG missed turn: smaller than a recorded failure). */
export const VITALITY_MISS = { points: 2, battery: 3 } as const;
const MAX_CREDITED_IDS = 60;
const EVIDENCE_WINDOW_MS = 7 * 24 * HOUR_MS;
const MAX_MEMORY = 12;
const MAX_EVENTS = 40;

/** Roles with a daily office role-work job (server/office-role-snapshots.ts PENDING_OFFICE_ROLES). */
const DAILY_ROLE_WORK = new Set(["code", "news", "legal", "github", "control", "revenue", "clippers", "portfolio", "automations", "dropshipping", "news:ny-news", "marketing-cmo", "news:miami-news", "blackroom-videos"]);
const FACTORY_IDS = new Set<string>(FACTORY_AGENTS.map(agent => agent.id));
/** Clippers lanes without a deliverable of their own (no receipt kind is defined for them). */
const CLIPPERS_NO_DELIVERABLE = new Set(["clippers-supervisor", "clippers-health"]);
/** Coordinators: the CEO and the agent factory decide/hire; they have no output of their own to measure. */
const COORDINATORS = new Set(["ceo", "agent-factory"]);
const CLIPPERS_IDS = new Set<string>(CLIPPERS_AGENTS.map(agent => agent.id));

/** Expected cadence of verified output, or null when the agent has no deliverable to measure. */
export function vitalityCadenceMs(agentId: string): number | null {
  if (CLIPPERS_NO_DELIVERABLE.has(agentId) || COORDINATORS.has(agentId)) return null;
  if (agentId === "clippers-learning") return 7 * 24 * HOUR_MS;
  if (CLIPPERS_IDS.has(agentId)) return 48 * HOUR_MS;
  if (FACTORY_IDS.has(agentId)) return 7 * 24 * HOUR_MS;
  if (DAILY_ROLE_WORK.has(agentId)) return 26 * HOUR_MS;
  return 72 * HOUR_MS;
}

export type CareerVitality = {
  /** Start of the current cadence clock (last verified output, hire, first sight or end of a hold). */
  anchorAt: string;
  /** Missed windows already charged for the current anchor (so each window costs once). */
  missesApplied: number;
  lastVerifiedWorkAt?: string;
  lastVerifiedLabel?: string;
  /** Latest caller evidence already credited (ids and time), so a receipt never recovers twice. */
  lastCreditedAt?: string;
  creditedIds: string[];
  holdReason?: string;
  flaggedAt?: string;
};

/** `clockOnly`: output already scored by another rule (e.g. Black Room quality signals): moves the clock, no extra vida. */
export type VitalityEvidence = { id: string; agentId: string; at: string; label: string; clockOnly?: boolean };

const ms = (value: string | undefined) => { const n = value ? Date.parse(value) : NaN; return Number.isFinite(n) ? n : 0; };
const remember = (memory: MemoryEntry[], at: string, text: string) => [{ at, text }, ...memory].slice(0, MAX_MEMORY);

function parseVitality(value: unknown): CareerVitality | undefined {
  const v = value as Partial<CareerVitality> | null | undefined;
  if (!v || typeof v !== "object" || !Number.isFinite(Date.parse(String(v.anchorAt))) || !Number.isSafeInteger(v.missesApplied) || (v.missesApplied as number) < 0) return undefined;
  return { ...v, anchorAt: v.anchorAt!, missesApplied: v.missesApplied!, creditedIds: Array.isArray(v.creditedIds) ? v.creditedIds.filter(id => typeof id === "string").slice(-MAX_CREDITED_IDS) : [] } as CareerVitality;
}

/**
 * One vitality tick over the main company. `holds` maps agentId -> reason for agents blocked
 * only by setup (their clock pauses). `exempt` agents (paused, external, no work of their own)
 * and agents without a cadence are never touched.
 */
export function applyVitality(company: CompanyState, input: {
  now: number; evidence?: VitalityEvidence[]; holds?: Record<string, string>; exempt?: string[]; names?: Record<string, string>;
}): { state: CompanyState; flagged: string[]; recovered: string[]; decayed: string[] } {
  const iso = new Date(input.now).toISOString();
  const careers: Record<string, AgentCareer> = { ...company.careers };
  let events = [...company.events];
  const flagged: string[] = [], recovered: string[] = [], decayed: string[] = [];
  const evidenceBy = new Map<string, VitalityEvidence[]>();
  for (const item of input.evidence || []) {
    if (!item || typeof item.id !== "string" || !item.id || typeof item.agentId !== "string") continue;
    const at = ms(item.at);
    if (!at || at > input.now + 5_000 || input.now - at > EVIDENCE_WINDOW_MS) continue;
    evidenceBy.set(item.agentId, [...(evidenceBy.get(item.agentId) || []), item]);
  }
  for (const [agentId, original] of Object.entries(company.careers)) {
    const cadence = vitalityCadenceMs(agentId);
    if (cadence === null || input.exempt?.includes(agentId) || original.scoreReconciliation !== undefined) continue;
    const name = input.names?.[agentId] || agentId;
    let career: AgentCareer = { ...original };
    const previous = parseVitality(career.vitality);
    let v: CareerVitality = previous ? { ...previous, creditedIds: [...previous.creditedIds] } : { anchorAt: iso, missesApplied: 0, creditedIds: [] };
    // The academy is study, not a missed turn.
    if (career.inTrainingUntilGeneration) { careers[agentId] = { ...career, vitality: { ...v, anchorAt: iso, missesApplied: 0, holdReason: "academia" } }; continue; }

    // 1) Verified output already scored elsewhere ("working" with distinct evidence) moves the clock.
    const hired = ms(career.hiredAt);
    if (career.lastState === "working" && career.lastEvaluatedAt && ms(career.lastEvaluatedAt) > ms(v.lastVerifiedWorkAt) && ms(career.lastEvaluatedAt) >= hired) {
      v.lastVerifiedWorkAt = career.lastEvaluatedAt;
      v.lastVerifiedLabel = "Trabajo verificado registrado en su carrera";
    }
    // 2) Caller evidence that no other rule scored: one recovery per cycle, each receipt once.
    const fresh = (evidenceBy.get(agentId) || [])
      .filter(item => ms(item.at) >= hired && !v.creditedIds.includes(item.id) && (!v.lastCreditedAt || ms(item.at) >= ms(v.lastCreditedAt)))
      .sort((a, b) => ms(a.at) - ms(b.at) || a.id.localeCompare(b.id));
    if (fresh.length) {
      const latest = fresh[fresh.length - 1];
      const before = career.battery;
      if (fresh.some(item => !item.clockOnly)) career.battery = Math.min(BATTERY_MAX, career.battery + VITALITY_RECOVERY);
      v.creditedIds = [...v.creditedIds, ...fresh.map(item => item.id)].slice(-MAX_CREDITED_IDS);
      v.lastCreditedAt = latest.at;
      if (ms(latest.at) > ms(v.lastVerifiedWorkAt)) { v.lastVerifiedWorkAt = latest.at; v.lastVerifiedLabel = latest.label.slice(0, 140); }
      if (career.battery !== before) career.memory = remember(career.memory, iso, `Recupera vida: ${latest.label.slice(0, 100)} (+${career.battery - before}).`);
      if (career.battery !== before) recovered.push(agentId);
    }
    // 3) Cadence clock: the latest of verified work, hire, first sight, or the end of a hold.
    const anchor = Math.max(ms(v.anchorAt), ms(v.lastVerifiedWorkAt), hired);
    if (anchor > ms(v.anchorAt)) v = { ...v, anchorAt: new Date(anchor).toISOString(), missesApplied: 0 };
    const hold = input.holds?.[agentId];
    if (hold) {
      v = { ...v, anchorAt: iso, missesApplied: 0, holdReason: hold.slice(0, 120) };
    } else {
      if (v.holdReason) v = { ...v, holdReason: undefined };
      const missed = Math.max(0, Math.floor((input.now - ms(v.anchorAt)) / cadence));
      const pending = missed - v.missesApplied;
      if (pending > 0) {
        const before = career.battery;
        career.battery = Math.max(0, career.battery - VITALITY_MISS.battery * pending);
        career.points = Math.max(0, career.points - VITALITY_MISS.points * pending);
        v.missesApplied = missed;
        if (before !== career.battery) {
          career.memory = remember(career.memory, iso, `Sin entregable verificado en ${Math.round(cadence / HOUR_MS)} h (${pending} ${pending === 1 ? "turno" : "turnos"}): -${before - career.battery} de vida.`);
          decayed.push(agentId);
        }
      }
    }
    // 4) Vida 0: flag once for the CEO/Robert. Never fired, replaced or deleted from here.
    if (career.battery === 0 && !v.flaggedAt) {
      v.flaggedAt = iso;
      flagged.push(agentId);
      events = [{ at: iso, text: `Vida en cero: ${name} (${career.nickname}) necesita revision del CEO/Robert. No se borra ni se reemplaza automaticamente.` }, ...events];
    } else if (career.battery > 0 && v.flaggedAt) {
      v.flaggedAt = undefined;
    }
    const clean = Object.fromEntries(Object.entries(v).filter(([, value]) => value !== undefined)) as CareerVitality;
    careers[agentId] = { ...career, vitality: clean };
  }
  return { state: { ...company, careers, events: events.slice(0, MAX_EVENTS) }, flagged, recovered, decayed };
}

export type VitalityState = "trabajando" | "al_dia" | "atrasado" | "en_espera" | "en_academia" | "vida_cero" | "sin_entregable" | "sin_puntuar" | "sin_carrera";
export type VitalityRow = {
  agentId: string; name: string; group: string; state: VitalityState; label: string;
  vida: number | null; points: number | null; generation: number | null;
  cadenceHours: number | null; lastVerifiedWorkAt: string | null; lastVerifiedLabel: string | null;
  nextLossAt: string | null; flagged: boolean; learned: string[];
};

export function vitalityGroup(agentId: string): string {
  if (CLIPPERS_IDS.has(agentId)) return "Clippers / Orquesta";
  if (FACTORY_IDS.has(agentId)) return "Fábrica de software";
  if (agentId.startsWith("news")) return "Noticias";
  if (agentId.startsWith("blackroom") || agentId.startsWith("br-")) return "Black Room";
  if (["skills-scout", "agent-factory", "mechanic"].includes(agentId)) return "Consejo";
  if (agentId.startsWith("specialist:")) return "Academia";
  return "Oficina";
}

/** Read-only roster of every registered main-company agent with its vida and real state. */
export function vitalityView(company: CompanyState | undefined, input: { now: number; names: Record<string, string>; exempt?: string[]; workingWindowMs?: number }): VitalityRow[] {
  const ids = [...new Set([...Object.keys(input.names), ...Object.keys(company?.careers || {})])];
  return ids.map((agentId): VitalityRow => {
    const name = input.names[agentId] || agentId;
    const career = company?.careers[agentId];
    const cadence = vitalityCadenceMs(agentId);
    const group = vitalityGroup(agentId);
    const base = { agentId, name, group, cadenceHours: cadence === null ? null : Math.round(cadence / HOUR_MS) };
    if (!career) return { ...base, state: "sin_carrera", label: "Registrado; aún sin carrera ni entregables verificados", vida: null, points: null, generation: null, lastVerifiedWorkAt: null, lastVerifiedLabel: null, nextLossAt: null, flagged: false, learned: [] };
    const v = parseVitality(career.vitality);
    const last = v?.lastVerifiedWorkAt || (career.lastState === "working" ? career.lastEvaluatedAt : undefined) || null;
    const learned = (career.skills || []).slice(0, 4).map(skill => skill.title);
    const common = { ...base, vida: career.battery, points: career.points, generation: career.generation, lastVerifiedWorkAt: last, lastVerifiedLabel: v?.lastVerifiedLabel || null, learned };
    if (input.exempt?.includes(agentId)) return { ...common, state: "sin_puntuar", label: "Pausado, externo o sin trabajo propio: no gana ni pierde vida", nextLossAt: null, flagged: false };
    if (cadence === null) return { ...common, state: "sin_entregable", label: "Coordina u observa; no tiene entregable propio que medir", nextLossAt: null, flagged: false };
    if (career.inTrainingUntilGeneration) return { ...common, state: "en_academia", label: "En la academia: estudia, no pierde vida", nextLossAt: null, flagged: false };
    if (career.battery === 0) return { ...common, state: "vida_cero", label: "Vida en cero: revisión del CEO/Robert pendiente (no se borra)", nextLossAt: null, flagged: true };
    if (v?.holdReason) return { ...common, state: "en_espera", label: `En espera (${v.holdReason}): no pierde vida`, nextLossAt: null, flagged: false };
    const anchor = Math.max(ms(v?.anchorAt), ms(last || undefined), ms(career.hiredAt));
    const nextLoss = anchor + ((v?.missesApplied || 0) + 1) * cadence;
    const workingWindow = input.workingWindowMs ?? Math.min(cadence, 26 * HOUR_MS);
    if (last && input.now - ms(last) <= workingWindow) return { ...common, state: "trabajando", label: "Entregó trabajo verificado recientemente", nextLossAt: new Date(nextLoss).toISOString(), flagged: false };
    if ((v?.missesApplied || 0) > 0 || input.now - anchor > cadence) return { ...common, state: "atrasado", label: "Sin entregable verificado en su turno: pierde vida", nextLossAt: new Date(nextLoss).toISOString(), flagged: false };
    return { ...common, state: "al_dia", label: last ? "Dentro de su turno; sin entrega nueva todavía" : "Dentro de su primer turno; sin entrega verificada todavía", nextLossAt: new Date(nextLoss).toISOString(), flagged: false };
  }).sort((a, b) => a.group.localeCompare(b.group) || (a.vida ?? 101) - (b.vida ?? 101) || a.agentId.localeCompare(b.agentId));
}

const REPAIR_OPEN = ["pending_submit", "submitted", "not_submitted", "approved"];
const FLAG_COOLDOWN_MS = 7 * 24 * HOUR_MS;
export const MAX_OPEN_VIDA_FLAGS = 3;

/**
 * Vida 0 -> one owner review in the Trust Center (pending_actions), reusing the Mechanic's
 * "repair" proposal shape and its per-agent key prefix so the two never duplicate each other.
 * Approval only marks the PR-first brief as ready; nothing is fired, replaced or deleted.
 */
export function deriveVitalityFlagProposals(company: CompanyState, proposals: import("./agent-council").CouncilProposal[], now: number, names: Record<string, string> = {}, exempt: string[] = []): import("./agent-council").CouncilProposal[] {
  const iso = new Date(now).toISOString();
  const created: import("./agent-council").CouncilProposal[] = [];
  const all = () => [...proposals, ...created];
  const open = () => all().filter(p => p.key.includes("#vida-cero-") && REPAIR_OPEN.includes(p.status)).length;
  for (const career of Object.values(company.careers).sort((a, b) => a.agentId.localeCompare(b.agentId))) {
    const v = parseVitality(career.vitality);
    if (!v?.flaggedAt || career.battery !== 0 || exempt.includes(career.agentId) || career.inTrainingUntilGeneration) continue;
    if (open() >= MAX_OPEN_VIDA_FLAGS) break;
    const prefix = `repair:${career.agentId}#`;
    if (all().some(p => p.key.startsWith(prefix) && (REPAIR_OPEN.includes(p.status) || now - ms(p.closedAt || p.createdAt) < FLAG_COOLDOWN_MS))) continue;
    const name = names[career.agentId] || career.agentId;
    const evidence = [`Vida 0/100 desde ${v.flaggedAt}`, v.lastVerifiedWorkAt ? `Último entregable verificado: ${v.lastVerifiedWorkAt}` : "Sin entregable verificado registrado", `Turno esperado: ${Math.round((vitalityCadenceMs(career.agentId) || 0) / HOUR_MS)} h`];
    created.push({
      key: `${prefix}vida-cero-${iso.slice(0, 10)}`, kind: "repair", owner: "ceo",
      title: `Vida en cero: revisar a ${name}`,
      description: `${name} (${career.nickname}) se quedó sin vida porque no entregó trabajo verificado en sus turnos. El CEO pide tu revisión: reparar, reasignar o pausar. No se borra ni se reemplaza automáticamente.`,
      evidence,
      handoffBrief: [
        `Tarea BlackOps (PR-first, costo $0 de API): Revisar el agente ${name} (vida 0)`, "",
        `Objetivo: averigua por qué ${name} no produce entregables verificados y corrige la causa (configuración, conexión o código) sin inventar datos.`, "",
        "Evidencia:", ...evidence.map(line => `- ${line}`), "",
        "Reglas:", "- Trabaja en una rama nueva y abre PR; no hagas merge ni deploy.", "- Si falta una credencial o cuenta, dilo en vez de simularla.", "- Sin gasto de API.",
      ].join("\n"),
      createdAt: iso, status: "pending_submit",
    });
  }
  return created;
}

/** Office desk status from a vitality row. Recent verified work is "on duty", never "executing now". */
export function vitalityLiveStatus(row: VitalityRow | undefined, now: number): AgentLiveStatus {
  if (!row) return { state: "checking", label: "Verificando..." };
  const vida = row.vida === null ? "" : ` · vida ${row.vida}/100`;
  if (row.state === "trabajando" && row.lastVerifiedWorkAt) return onDutyStatus({ lastWorkAt: row.lastVerifiedWorkAt, now, extra: `${row.lastVerifiedLabel || "entregable verificado"}${vida}` });
  if (row.state === "en_espera") return { state: "needs-setup", label: row.label, detail: `Sin pérdida de vida mientras espera${vida}` };
  if (row.state === "vida_cero") return { state: "available", label: "Vida 0: revisión del CEO/Robert", detail: row.label, problems: ["Vida en cero: no entrega trabajo verificado"] };
  if (row.state === "atrasado") return { state: "available", label: `Perdiendo vida${vida}`, detail: row.label, problems: ["Sin entregable verificado en su turno"] };
  return { state: "available", label: `${row.label}${vida}` };
}
