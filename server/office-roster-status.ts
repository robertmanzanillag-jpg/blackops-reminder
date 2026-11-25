// Full office roster with a live status per agent (pure, no IO, no AI calls).
//
// Status is derived ONLY from persisted records in the council state:
//  - officeExecution.roleWork.jobs   (role job startedAt / expiresAt / completedAt / reason)
//  - lastStatuses + lastCycleAt      (the council round's last observation of each agent probe)
//  - agentStates[id].since           (last time the council saw the agent change state)
// Nothing here ever reports "trabajando" without a running job or a recent recorded observation.

import { buildAgentChatDirectory, AGENT_CHAT_GROUP_LABELS } from "../shared/agent-chat-directory";
import { CLIPPERS_AGENTS } from "../shared/clippers-office-agents";
import type { CouncilState } from "../shared/agent-council";
import { learningSummary } from "../shared/agent-self-improvement";

export type RosterState = "trabajando" | "en_espera" | "bloqueado" | "sin_datos";
export type RosterEntry = {
  id: string;
  name: string;
  group: string;
  job: string;
  state: RosterState;
  label: string;
  /** ISO time of the last recorded activity, or null when nothing is recorded. */
  lastActivityAt: string | null;
  /** What it is doing right now (only when state is "trabajando"). */
  doing?: string;
  /** Spanish reason (only when state is "bloqueado"). */
  reason?: string;
  /** Lessons learned from its own measured outcomes (0 when none are recorded). */
  aprendizajes: number;
  ultimoAprendizaje: string | null;
};
export type RosterView = { observedAt: string; workingWindowMs: number; counts: Record<RosterState, number>; agents: RosterEntry[] };

export const ROSTER_WORKING_WINDOW_MS = 20 * 60_000; // council round runs every 15 min
export const ROSTER_STATE_LABELS: Record<RosterState, string> = { trabajando: "Trabajando", en_espera: "En espera", bloqueado: "Bloqueado", sin_datos: "Sin datos" };

const ROLE_WORK_REASONS: Record<string, string> = {
  source_unavailable: "La fuente de datos del rol no estaba disponible.",
  lease_or_generation_changed: "El puesto cambió de titular durante el trabajo.",
  expired_no_automatic_retry: "El trabajo expiró sin terminar; no se reintenta solo.",
  web_export_missing: "Falta la exportación web de la fuente.",
  web_export_unverified: "La exportación web no se pudo verificar.",
};

type Job = { role?: unknown; status?: unknown; startedAt?: unknown; expiresAt?: unknown; completedAt?: unknown; reason?: unknown; slot?: unknown };
type RosterInput = Pick<CouncilState, "company" | "kongCompany" | "kongLastStatuses"> & Partial<Pick<CouncilState, "lastStatuses" | "agentStates" | "lastCycleAt" | "officeExecution">>;

const time = (value: unknown) => (typeof value === "string" ? Date.parse(value) : NaN);
const iso = (ms: number) => (Number.isFinite(ms) ? new Date(ms).toISOString() : null);
const latestOf = (...values: number[]) => { const ok = values.filter(Number.isFinite); return ok.length ? Math.max(...ok) : NaN; };

export function deriveAgentStatus(id: string, state: RosterInput, now: number, windowMs = ROSTER_WORKING_WINDOW_MS): Pick<RosterEntry, "state" | "label" | "lastActivityAt" | "doing" | "reason"> {
  const rawJobs = (state.officeExecution?.roleWork as { jobs?: unknown } | undefined)?.jobs;
  const jobs = (Array.isArray(rawJobs) ? rawJobs as Job[] : []).filter(job => job && job.role === id && Number.isFinite(time(job.startedAt)));
  const job = jobs.sort((a, b) => time(b.startedAt) - time(a.startedAt))[0];
  const jobAt = job ? latestOf(time(job.completedAt), time(job.startedAt)) : NaN;
  const observed = state.lastStatuses?.[id] ?? state.kongLastStatuses?.[id];
  const cycleAt = time(state.lastCycleAt);
  const sinceAt = time(state.agentStates?.[id]?.since);
  const lastActivity = latestOf(jobAt, observed ? cycleAt : NaN, sinceAt);
  const base = { lastActivityAt: iso(lastActivity) };

  // 1. A running role job whose lease has not expired is real, current work.
  if (job && job.status === "running" && time(job.expiresAt) > now) {
    return { ...base, state: "trabajando", label: ROSTER_STATE_LABELS.trabajando, lastActivityAt: iso(time(job.startedAt)), doing: `Trabajo diario del rol${typeof job.slot === "string" ? ` (${job.slot})` : ""}` };
  }
  // 2. The council's last observation said "working" and that observation is recent.
  if (observed?.state === "working" && Number.isFinite(cycleAt) && now - cycleAt >= -30_000 && now - cycleAt <= windowMs) {
    return { ...base, state: "trabajando", label: ROSTER_STATE_LABELS.trabajando, lastActivityAt: iso(cycleAt), doing: observed.label || "Trabajando" };
  }
  // 3. Blocked: latest role job ended blocked/unknown (or a running lease expired), or the probe reports an error.
  const jobBlocked = job && (job.status === "blocked" || job.status === "unknown" || (job.status === "running" && time(job.expiresAt) <= now));
  if (jobBlocked) {
    const code = typeof job.reason === "string" ? job.reason : job.status === "running" ? "expired_no_automatic_retry" : "";
    return { ...base, state: "bloqueado", label: ROSTER_STATE_LABELS.bloqueado, reason: ROLE_WORK_REASONS[code] || "El último trabajo terminó sin resultado verificado." };
  }
  if (observed && (observed.state === "error" || observed.state === "needs-setup")) {
    return { ...base, state: "bloqueado", label: ROSTER_STATE_LABELS.bloqueado, reason: observed.label || (observed.state === "needs-setup" ? "Necesita configuración." : "Error en la última revisión.") };
  }
  // 4. Idle with evidence.
  if (Number.isFinite(lastActivity)) return { ...base, state: "en_espera", label: ROSTER_STATE_LABELS.en_espera };
  return { lastActivityAt: null, state: "sin_datos", label: ROSTER_STATE_LABELS.sin_datos };
}

export function buildOfficeRoster(state: RosterInput, now: number, windowMs = ROSTER_WORKING_WINDOW_MS): RosterView {
  const seen = new Set<string>();
  const roster: Array<{ id: string; name: string; group: string; job: string }> = [];
  const add = (entry: { id: string; name: string; group: string; job: string }) => { if (!seen.has(entry.id)) { seen.add(entry.id); roster.push(entry); } };
  let directory: ReturnType<typeof buildAgentChatDirectory> = [];
  try { directory = buildAgentChatDirectory(state as CouncilState); } catch { directory = []; }
  for (const entry of directory) add({ id: entry.id, name: entry.name, group: AGENT_CHAT_GROUP_LABELS[entry.group] || entry.group, job: entry.job });
  for (const agent of CLIPPERS_AGENTS) add({ id: agent.id, name: `Clippers · ${agent.name}`, group: "Clippers", job: agent.role });
  // Any role with persisted work that no registry lists still shows (never hidden).
  const rawJobs = (state.officeExecution?.roleWork as { jobs?: unknown } | undefined)?.jobs;
  for (const job of Array.isArray(rawJobs) ? rawJobs as Job[] : []) {
    if (job && typeof job.role === "string") add({ id: job.role, name: job.role, group: "BlackOps", job: "Rol de oficina con trabajo registrado." });
  }
  const counts: Record<RosterState, number> = { trabajando: 0, en_espera: 0, bloqueado: 0, sin_datos: 0 };
  const agents = roster.map(entry => {
    const status = deriveAgentStatus(entry.id, state, now, windowMs);
    counts[status.state] += 1;
    const career = state.company?.careers?.[entry.id] ?? state.kongCompany?.careers?.[entry.id];
    return { ...entry, ...status, ...learningSummary(career?.learning) };
  });
  return { observedAt: new Date(now).toISOString(), workingWindowMs: windowMs, counts, agents };
}
