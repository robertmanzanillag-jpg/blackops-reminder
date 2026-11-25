// Daily recorded desk review for the Black Room team and the KONG central desks ($0, no AI).
//
// Same pattern as office role work (server/office-role-work.ts): a fenced 60 s lease in the
// council journal (officeExecution.deskWork), a bounded source read, then a completion that
// binds a deterministic deliverable (findings + evidence) with a sha256 artifact id.
//
// Sources are ones the repo already persists, never invented:
//  - Black Room team: the team scheduler journal (clippers_workspace/blackroom/team/scheduler.json)
//    plus the council's last observation of the agent.
//  - KONG desks: the council's last KONG snapshot (kongLastStatuses + kongObservedAt).
// A missing source blocks the job (SOURCE_MISSING) instead of faking work; an old one blocks it
// as SOURCE_STALE. Review only: nothing is posted, sent, bought or dispatched. KONG findings are
// records for Robert; they never become KONG orders or factory work.
//
// Completed and blocked jobs feed the outcome-learning loop (shared/agent-self-improvement.ts)
// and the office roster (server/office-roster-status.ts).

import { createHash, randomUUID } from "node:crypto";
import { BLACKROOM_TEAM } from "../shared/blackroom-team";

export const BLACKROOM_DESK_IDS = BLACKROOM_TEAM.map(agent => agent.id) as readonly string[];
export const KONG_DESK_IDS = ["kong:KONG AI", "kong:Promoters + Mesas", "kong:Venues", "kong:Kong Legal", "kong-metrics", "kong-videos"] as const;
export const DESK_WORK_ROLES: readonly string[] = [...BLACKROOM_DESK_IDS, ...KONG_DESK_IDS];
export const DESK_WORK_TTL_MS = 60_000;
export const DESK_WORK_VERSION = "desk-review-v1";
/** KONG snapshot older than this is stale for a daily review. */
export const KONG_SOURCE_MAX_AGE_MS = 6 * 3600_000;
const MAX_JOBS = 256;
const MAX_FINISHED = 180;

export type DeskReason = "source_unavailable" | "source_stale" | "schedule_disabled" | "expired_no_automatic_retry";
export type DeskDeliverable = { version: typeof DESK_WORK_VERSION; role: string; scope: "blackroom" | "kong"; observedAt: string; findings: string[]; evidence: string[]; reviewOnly: true };
export type DeskWorkJob = {
  id: string; role: string; slot: string; fence: string; startedAt: string; expiresAt: string;
  status: "running" | "completed" | "blocked" | "unknown"; completedAt?: string; reason?: DeskReason;
  /** Diagnostics in the same compartment the outcome-learning loop reads (audit.diagnostics). */
  audit?: { diagnostics: string[] }; deliverable?: DeskDeliverable; artifactId?: string;
};
export type DeskWorkState = { version: 1; jobs: DeskWorkJob[] };

export type BlackRoomScheduleRecord = { jobId: string; label: string; everyMs: number; enabled: boolean; lastRunAt: string | null; lastOk: boolean | null; lastSummary: string };
export type DeskSources = {
  /** Black Room scheduler records per agent; null = the journal could not be read (missing/corrupt). */
  blackroomSchedule: Record<string, BlackRoomScheduleRecord[]> | null;
  kongStatuses: Record<string, { state?: unknown; label?: unknown }>;
  kongObservedAt: string | null;
  lastStatuses: Record<string, { state?: unknown; label?: unknown }>;
  lastCycleAt: string | null;
};

const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const ms = (v: unknown) => (typeof v === "string" ? Date.parse(v) : NaN);
const clean = (v: unknown, n = 200) => String(v ?? "").replace(/[\r\n\u0000-\u001f<>]/g, " ").slice(0, n);
const isObj = (v: unknown): v is Record<string, any> => Boolean(v) && typeof v === "object" && !Array.isArray(v);
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;
const HEX = /^[a-f0-9]{64}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const REASONS: readonly string[] = ["source_unavailable", "source_stale", "schedule_disabled", "expired_no_automatic_retry"];

/** Strict journal parse (fails closed): unknown roles, duplicate slots or forged artifacts are rejected. */
export function parseDeskWork(value: unknown): DeskWorkState {
  if (value === undefined) return { version: 1, jobs: [] };
  if (!isObj(value) || value.version !== 1 || !Array.isArray(value.jobs) || value.jobs.length > MAX_JOBS) throw new Error("Invalid desk work journal");
  const jobs = value.jobs as DeskWorkJob[];
  for (const job of jobs) {
    if (!isObj(job) || !DESK_WORK_ROLES.includes(job.role) || !UUID.test(String(job.id)) || !UUID.test(String(job.fence)) || !/^\d{4}-\d{2}-\d{2}$/.test(String(job.slot)) ||
        !ISO.test(String(job.startedAt)) || !ISO.test(String(job.expiresAt)) || ms(job.expiresAt) - ms(job.startedAt) !== DESK_WORK_TTL_MS || job.slot !== job.startedAt.slice(0, 10) ||
        !["running", "completed", "blocked", "unknown"].includes(job.status) || (job.reason !== undefined && !REASONS.includes(job.reason))) throw new Error("Invalid desk work job");
    if (job.status === "running" || job.status === "unknown") {
      if (job.deliverable || job.artifactId || job.completedAt || job.audit) throw new Error("Unfinished desk job cannot contain proof");
      continue;
    }
    const end = ms(job.completedAt);
    if (!Number.isFinite(end) || end < ms(job.startedAt) || end >= ms(job.expiresAt) || !job.deliverable || job.deliverable.role !== job.role || !isObj(job.audit) || !Array.isArray(job.audit.diagnostics) ||
        !HEX.test(String(job.artifactId)) || job.artifactId !== deskArtifactId(job)) throw new Error("Desk job proof mismatch");
    if (job.status === "blocked" && !job.reason) throw new Error("Blocked desk job needs a reason");
  }
  if (new Set(jobs.map(j => j.id)).size !== jobs.length || new Set(jobs.map(j => `${j.role}:${j.slot}`)).size !== jobs.length) throw new Error("Duplicate desk work assignment");
  return { version: 1, jobs };
}

/** Tolerant read for the runner: an invalid journal resets to empty instead of failing every tick. */
export function readDeskWork(value: unknown): DeskWorkState {
  try { return parseDeskWork(value); } catch { return { version: 1, jobs: [] }; }
}

export function deskArtifactId(job: Pick<DeskWorkJob, "id" | "role" | "fence" | "status" | "reason" | "audit" | "deliverable">): string {
  return digest({ id: job.id, role: job.role, fence: job.fence, status: job.status, reason: job.reason ?? null, audit: job.audit, deliverable: job.deliverable });
}

type Review = { status: "completed" | "blocked"; reason?: DeskReason; diagnostics: string[]; deliverable: DeskDeliverable };

/** Pure, deterministic desk review. Never claims work the sources do not show. */
export function reviewDesk(role: string, sources: DeskSources, now: number): Review {
  const observedAt = new Date(now).toISOString();
  const findings: string[] = [], evidence: string[] = [], diagnostics = new Set<string>();
  let reason: DeskReason | undefined;
  const scope: "blackroom" | "kong" = BLACKROOM_DESK_IDS.includes(role) ? "blackroom" : "kong";
  if (scope === "blackroom") {
    const records = sources.blackroomSchedule?.[role] ?? [];
    if (!sources.blackroomSchedule) { diagnostics.add("SOURCE_MISSING"); reason = "source_unavailable"; findings.push("No se pudo leer el horario del equipo Black Room (scheduler.json): no se acredita trabajo."); }
    else if (!records.length) { diagnostics.add("SOURCE_MISSING"); reason = "source_unavailable"; findings.push("El agente no tiene un trabajo programado en el horario del equipo."); }
    for (const record of records) {
      evidence.push(`scheduler.json:${record.jobId}@${record.lastRunAt ?? "nunca"}`);
      if (!record.enabled) { diagnostics.add("SCHEDULE_DISABLED"); reason ??= "schedule_disabled"; findings.push(`${clean(record.label, 80)}: apagado por configuración (no corre solo).`); continue; }
      const last = ms(record.lastRunAt);
      if (!Number.isFinite(last)) { diagnostics.add("SOURCE_MISSING"); reason ??= "source_unavailable"; findings.push(`${clean(record.label, 80)}: todavía no hay ninguna ejecución registrada.`); continue; }
      const age = now - last;
      if (age > 2 * record.everyMs + 3600_000) { diagnostics.add("SOURCE_STALE"); reason ??= "source_stale"; findings.push(`${clean(record.label, 80)}: última ejecución hace ${Math.round(age / 3600_000)} h (cada ${Math.round(record.everyMs / 3600_000) || "<1"} h).`); continue; }
      if (record.lastOk === false) diagnostics.add("RECORDED_FAILURE");
      findings.push(`${clean(record.label, 80)}: ${record.lastOk ? "ok" : "sin éxito"} ${record.lastRunAt} — ${clean(record.lastSummary, 200) || "sin resumen"}`);
    }
  } else {
    const at = ms(sources.kongObservedAt), entry = sources.kongStatuses?.[role];
    if (!Number.isFinite(at) || !isObj(entry)) { diagnostics.add("SOURCE_MISSING"); reason = "source_unavailable"; findings.push("No hay una lectura de KONG registrada para este puesto: no se acredita trabajo."); }
    else {
      evidence.push(`kongObservedAt:${sources.kongObservedAt}`);
      if (now - at > KONG_SOURCE_MAX_AGE_MS) { diagnostics.add("SOURCE_STALE"); reason = "source_stale"; findings.push(`La última lectura de KONG tiene ${Math.round((now - at) / 3600_000)} h.`); }
      else {
        const state = clean(entry.state, 40);
        if (state === "error") diagnostics.add("RECORDED_FAILURE");
        if (state === "needs-setup") diagnostics.add("NEEDS_SETUP");
        findings.push(`Estado observado en KONG: ${state || "desconocido"} — ${clean(entry.label) || "sin detalle"}.`);
      }
    }
    findings.push("Solo revisión: no se envían órdenes a KONG ni a la fábrica de software.");
  }
  const observed = sources.lastStatuses?.[role];
  if (isObj(observed) && sources.lastCycleAt) {
    evidence.push(`council:${sources.lastCycleAt}`);
    if (observed.state === "needs-setup") diagnostics.add("NEEDS_SETUP");
    findings.push(`Última observación del consejo: ${clean(observed.state, 40)} — ${clean(observed.label)}.`);
  }
  findings.push("No se publicó, contactó ni gastó nada.");
  const blocked = reason === "source_unavailable" || reason === "source_stale" || reason === "schedule_disabled";
  return { status: blocked ? "blocked" : "completed", ...(blocked ? { reason } : {}), diagnostics: [...diagnostics].sort(),
    deliverable: { version: DESK_WORK_VERSION, role, scope, observedAt, findings: findings.slice(0, 12), evidence: evidence.slice(0, 12), reviewOnly: true } };
}

type Council = {
  updateOfficeExecution: (change: (execution: any, company: any) => any) => Promise<unknown>;
};

/** Fenced daily runner: one job per desk per UTC day; sources are read once per tick. */
export function createDeskWorkRunner(options: { council: Council; readSources: () => Promise<DeskSources>; now?: () => number; roles?: readonly string[] }) {
  const now = options.now || Date.now;
  const roles = options.roles || DESK_WORK_ROLES;
  return {
    async tick(): Promise<{ ran: string[] }> {
      const start = now(), slot = new Date(start).toISOString().slice(0, 10);
      const assigned: DeskWorkJob[] = [];
      await options.council.updateOfficeExecution(execution => {
        assigned.length = 0;
        const journal = readDeskWork(execution.deskWork);
        const jobs = journal.jobs.map(j => j.status === "running" && ms(j.expiresAt) <= start ? { ...j, status: "unknown" as const, reason: "expired_no_automatic_retry" as const } : j);
        for (const role of roles) {
          if (jobs.some(j => j.role === role && (j.slot === slot || j.status === "running"))) continue;
          assigned.push({ id: randomUUID(), role, slot, fence: randomUUID(), startedAt: new Date(start).toISOString(), expiresAt: new Date(start + DESK_WORK_TTL_MS).toISOString(), status: "running" });
        }
        const finished = jobs.filter(j => j.status !== "running").slice(-MAX_FINISHED);
        const retained = jobs.filter(j => j.status === "running" || finished.includes(j));
        return { ...execution, deskWork: { version: 1, jobs: [...retained, ...assigned].slice(-MAX_JOBS) } };
      });
      if (!assigned.length) return { ran: [] };
      const mine = assigned.map(j => ({ ...j }));
      let sources: DeskSources | null = null;
      try {
        const remaining = ms(mine[0].expiresAt) - now();
        let timer: ReturnType<typeof setTimeout> | undefined;
        sources = await Promise.race([
          options.readSources(),
          new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("lease")), Math.max(0, remaining - 5_000)); }),
        ]).finally(() => clearTimeout(timer));
      } catch { sources = null; }
      const empty: DeskSources = { blackroomSchedule: null, kongStatuses: {}, kongObservedAt: null, lastStatuses: {}, lastCycleAt: null };
      await options.council.updateOfficeExecution(execution => {
        const journal = parseDeskWork(execution.deskWork), end = now();
        const updated = journal.jobs.map(stored => {
          const job = mine.find(j => j.id === stored.id);
          if (!job || stored.fence !== job.fence || stored.status !== "running") return stored;
          if (end >= ms(stored.expiresAt) || end < ms(stored.startedAt)) return { ...stored, status: "unknown" as const, reason: "expired_no_automatic_retry" as const };
          const review = reviewDesk(stored.role, sources || empty, end);
          const done: DeskWorkJob = { ...stored, status: review.status, completedAt: new Date(end).toISOString(), ...(review.reason ? { reason: review.reason } : {}), audit: { diagnostics: review.diagnostics }, deliverable: review.deliverable };
          done.artifactId = deskArtifactId(done);
          return done;
        });
        return { ...execution, deskWork: { version: 1, jobs: updated } };
      });
      return { ran: mine.map(j => j.role) };
    },
  };
}

/** Production source reader: the Black Room scheduler journal on disk + the council's saved state. */
export async function readDeskSources(load: () => Promise<{ kongLastStatuses?: any; kongObservedAt?: string | null; lastStatuses?: any; lastCycleAt?: string | null }>): Promise<DeskSources> {
  const state = await load();
  let blackroomSchedule: DeskSources["blackroomSchedule"] = null;
  try {
    const [scheduler, files, path] = await Promise.all([import("./blackroom-team/scheduler"), import("./blackroom-team/state"), import("node:path")]);
    const raw = await files.readBlackRoomTeamStateFile<any>(path.resolve(process.cwd(), files.BLACKROOM_TEAM_DATA_DIR), scheduler.BLACKROOM_SCHEDULER_STATE_FILE, null);
    if (isObj(raw) && isObj(raw.jobs)) {
      blackroomSchedule = {};
      for (const job of scheduler.BLACKROOM_SCHEDULED_JOBS) {
        const rec = isObj(raw.jobs[job.id]) ? raw.jobs[job.id] : {};
        (blackroomSchedule[job.agentId] ||= []).push({ jobId: job.id, label: job.label, everyMs: job.everyMs, enabled: job.enabled(process.env) && scheduler.blackRoomSchedulerEnabled(process.env),
          lastRunAt: typeof rec.lastRunAt === "string" ? rec.lastRunAt : null, lastOk: typeof rec.lastOk === "boolean" ? rec.lastOk : null, lastSummary: typeof rec.lastSummary === "string" ? rec.lastSummary.slice(0, 300) : "" });
      }
    }
  } catch { blackroomSchedule = null; }
  return { blackroomSchedule, kongStatuses: isObj(state.kongLastStatuses) ? state.kongLastStatuses : {}, kongObservedAt: state.kongObservedAt ?? null,
    lastStatuses: isObj(state.lastStatuses) ? state.lastStatuses : {}, lastCycleAt: state.lastCycleAt ?? null };
}
