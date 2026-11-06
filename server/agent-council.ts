import { advanceKongCompany, isKongCompanyAgent } from "./kong-company";
import type { OfficeKongAuditResult } from "./office-kong";
// Server side of the agent council (see shared/agent-council.ts).
//
// Cost: $0. It only reads data the agents already produce (local files and the
// database), reads the repo's skill documents, and once a day asks GitHub's public
// API for the latest release of a short watchlist. It never calls an AI model,
// never runs the scanning endpoints (App QA / Cybersecurity) and never calls
// ensureDefaultAutomations (which re-activates paused automations).
//
// Writes: its own state file (agent_council_data/state.json, git-ignored) and
// Trust Center pending actions for proposals. Approving a proposal records a
// lesson or marks a PR-first brief as ready; it does not change code or skills.

import { reviewKongReadiness } from "@shared/kong-supervisor";
import { mkdir, readFile, readdir, rename, stat, unlink, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { resolveDatabaseConnectionString } from "./database-url";
import {
  COUNCIL_CYCLE_MS,
  SCOUT_INTERVAL_MS,
  SCOUT_WATCHLIST,
  applyApprovedProposal,
  applyLessons,
  deriveRepairProposals,
  diffScoutReleases,
  emptyCouncilState,
  finishCycle,
  hasProposal,
  parseCouncilState,
  pruneProposals,
  safeText,
  toMs,
  runCrossChecks,
  type CouncilProposal,
  type CouncilSignals,
  type CouncilSkillDoc,
  type CouncilState,
} from "@shared/agent-council";
import { CITY_NEWS_AGENTS, agentProbes, summarizeProbe, type AgentLiveStatus } from "@shared/agent-live-status";
import {
  INTEGRATION_LABEL,
  effectiveIntegrations,
  integrationFor,
  parseIntegrationOverrides,
  unscoredAgentIds,
  type AgentIntegration,
} from "@shared/agent-integrations";
import {
  advanceAcademy,
  advanceCompany,
  completeOrder,
  createOrder,
  enrollTrainee,
  evidenceAlreadyUsed,
  learnLessons,
  specialistNeeds,
  tailoredModules,
  SPECIALIST_PREFIX,
  isSpecialistId,
  specialistIdFor,
  specialistTopicLabel,
  topicSlug,
  type OrderEvidence,
  leaderboard,
  personalityFor,
  type CurriculumModule,
} from "@shared/agent-company";

export type CouncilDeps = {
  now: () => number;
  userId: () => string;
  readState: () => Promise<string | null>;
  writeState: (raw: string) => Promise<void>;
  collect: (userId: string) => Promise<Omit<CouncilSignals, "now">>;
  submitProposal: (userId: string, proposal: CouncilProposal) => Promise<string>;
  getPendingActionStatus: (id: string) => Promise<string | null>;
  fetchLatestRelease: (repo: string) => Promise<{ tag: string; url: string; publishedAt: string | null } | null>;
  log: (message: string) => void;
  // Real status of every agent (same data its endpoint serves). Optional so tests can stay small.
  collectKongEvidence?: () => Promise<OfficeKongAuditResult["evidence"]>;
  collectStatuses?: (userId: string) => Promise<Record<string, AgentLiveStatus>>;
  // Real documents the academy teaches.
  loadCurriculum?: () => Promise<CurriculumModule[]>;
  // Which agents are paused / external / not built (never scored). Defaults to the shared table + env overrides.
  integrations?: () => Record<string, AgentIntegration>;
  // Deadline for the round's reads (tests use a short one). Defaults to 90 s.
  collectTimeoutMs?: number;
  // Reads one automation run of the user (read-only), to verify order evidence.
  verifyRun?: (userId: string, runId: string) => Promise<{ id: string; status: string; summary: string | null; at: string | null } | null>;
  // Shared, versioned storage (production database). When present it replaces readState/writeState:
  // every change re-reads the latest revision and a concurrent writer causes a retry, never an overwrite.
  versioned?: {
    read: () => Promise<{ raw: string | null; revision: number | null }>;
    write: (raw: string, expectedRevision: number | null) => Promise<number>;
  };
};

export class CouncilStateConflict extends Error {}
export class OrderEvidenceError extends Error {}

// Another instance (Autoscale) that ran a round this recently already did the work.
export const MIN_CYCLE_GAP_MS = 10 * 60_000;
const SKIP = Symbol("skip");

export const KONG_TEAM = ["KONG AI", "Promoters + Mesas", "Venues", "Kong Legal"];
const KONG_IDS = KONG_TEAM.map((name) => `kong:${name}`);
// Always unscored, whatever the overrides say: they have no work of their own to measure.
const EXEMPT_IDS = [...KONG_IDS, "mechanic"];
// Order routing only trusts live states from a recent council cycle.
const STATUS_FRESH_MS = 45 * 60_000;

export const AGENT_NAMES: Record<string, string> = {
  "kong-metrics": "Metricas KONG",
  ...Object.fromEntries(CITY_NEWS_AGENTS.map((agent) => [agent.id, agent.name])),
  assistant: "Asistente",
  ceo: "CEO",
  revenue: "Revenue",
  dropshipping: "Dropshipping CEO",
  "marketing-cmo": "Marketing CMO",
  code: "Code",
  github: "GitHub",
  "claude-reviewer": "Claude Reviewer",
  portfolio: "Portfolio",
  radio: "Radio",
  clippers: "Clippers",
  automations: "Autos",
  cybersecurity: "Cybersecurity",
  "app-qa": "App QA",
  legal: "Legal / Compliance",
  control: "Control / Permisos",
  "skills-scout": "Skills Scout",
  "agent-factory": "Fabrica de agentes",
  kong: "Equipo Kong",
  "blackroom-videos": "Videos Black Room",
  news: "Noticias",
  "kong-videos": "Videos Kong",
  mechanic: "Mecanico",
  ...Object.fromEntries(KONG_TEAM.map((name) => [`kong:${name}`, name])),
};

function statusesFromSignals(signals: CouncilSignals): Record<string, AgentLiveStatus> {
  const statuses: Record<string, AgentLiveStatus> = {};
  const add = (agentId: string, body: unknown) => {
    if (body === undefined) return;
    statuses[agentId] = summarizeProbe(agentProbes[agentId], { ok: true, status: 200, body }, signals.now);
  };
  add("clippers", signals.clippers);
  add("dropshipping", signals.dropshipping);
  add("marketing-cmo", signals.marketing);
  add("automations", signals.automationRuns);
  if (signals.appProjects) {
    const open = (signals.appIncidents || []).filter((incident) => ["open", "investigating", "pending_action"].includes(incident.status || ""));
    const count = (status: string) => signals.appProjects!.filter((app) => (app.status || "unknown") === status).length;
    const health = {
      apps: signals.appProjects,
      summary: {
        totalApps: signals.appProjects.length,
        healthy: count("healthy"),
        degraded: count("degraded"),
        down: count("down"),
        unknown: count("unknown"),
        openIncidents: open.length,
        criticalIncidents: open.filter((incident) => incident.severity === "critical").length,
      },
    };
    add("control", health);
  }
  return statuses;
}

// The queue must never hang on a stuck database call.
function withTimeout<T>(work: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label}: sin respuesta en ${ms / 1000}s`)), ms);
  });
  return Promise.race([work, timeout]).finally(() => clearTimeout(timer));
}
const DB_TIMEOUT_MS = 10_000;
// Every read of another agent's data has a deadline: one slow or hung source (a remote device,
// GitHub, a market API) must never freeze the council. Production stopped at round 44 because a
// read without a deadline kept the round "running" forever, so no later round could start.
export const READ_TIMEOUT_MS = 20_000;
const COLLECT_TIMEOUT_MS = 90_000;
const CURRICULUM_TIMEOUT_MS = 30_000;
// Last resort: a round that has not finished after this long no longer blocks the next one.
export const CYCLE_WATCHDOG_MS = 5 * 60_000;

function advanceCompanyCycle(
  state: CouncilState,
  statuses: Record<string, AgentLiveStatus>,
  curriculum: CurriculumModule[],
  now: number,
  integrations: Record<string, AgentIntegration> = {}
): CouncilState {
  const unscored = new Set([...EXEMPT_IDS, ...unscoredAgentIds(integrations)]);
  const compact = Object.fromEntries(Object.entries(statuses).map(([id, status]) => [id, { state: status.state, label: status.label }]));
  let company = advanceCompany(state.company, { now, statuses: Object.fromEntries(Object.entries(compact).filter(([id]) => !isKongCompanyAgent(id))), roles: AGENT_NAMES, exempt: [...unscored] }).state;
  // Orders routed to a paused/external agent are blocked with the honest reason, never "assigned".
  for (const id of unscored) {
    const integration = integrationFor(id, integrations);
    if (integration.mode !== "activa" && compact[id]) compact[id] = { state: "offline", label: `${INTEGRATION_LABEL[integration.mode]}: ${integration.reason}` };
  }
  // Approved hires (agent factory) start in the academy. A specialist becomes a new agent.
  for (const proposal of state.proposals) {
    if (proposal.kind !== "new_agent" || proposal.status !== "applied") continue;
    const specialist = proposal.key.match(/^new_agent:specialist-(.+)$/);
    const forAgentId = specialist ? specialistIdFor(specialist[1]) : proposal.key.replace(/^new_agent:helper-/, "");
    company = enrollTrainee(company, { id: proposal.key, forAgentId, role: proposal.title.replace(/^Contratar /, ""), now });
  }
  // Skills from the lessons Robert approved about each agent.
  company = learnLessons(company, state.lessons, now);
  // If the docs can't be read this cycle, the academy still advances on the core rules so nobody
  // stays in training forever. Each trainee first studies its own job (why it failed, its orders,
  // its lessons), then the general docs.
  const modules = curriculum.length ? curriculum : [{ id: "core-rules", title: "Reglas basicas", summary: "PR-first, QA antes de publicar, nada de gasto sin aprobacion de Robert." }];
  const academyBase = company;
  company = advanceAcademy(
    company,
    (trainee) => [
      ...tailoredModules(academyBase, trainee.forAgentId, {
        status: compact[trainee.forAgentId],
        lessons: state.lessons,
        topic: isSpecialistId(trainee.forAgentId) ? trainee.forAgentId.slice(SPECIALIST_PREFIX.length) : undefined,
      }),
      ...modules,
    ],
    now
  );
  return { ...state, company, lastStatuses: compact };
}

// Agent factory: recurring work nobody could take becomes a "hire a specialist" proposal for Robert.
const MAX_OPEN_SPECIALIST_PROPOSALS = 2;
function deriveSpecialistProposals(state: CouncilState, now: number): CouncilProposal[] {
  const iso = new Date(now).toISOString();
  const open = state.proposals.filter((proposal) => proposal.key.startsWith("new_agent:specialist-") && !["applied", "rejected"].includes(proposal.status)).length;
  const created: CouncilProposal[] = [];
  for (const need of specialistNeeds(state.company, now)) {
    if (open + created.length >= MAX_OPEN_SPECIALIST_PROPOSALS) break;
    const key = `new_agent:specialist-${topicSlug(need.topic)}`;
    // Never twice: not while a proposal exists, not once the specialist exists, not while one is training.
    if (
      state.proposals.some((proposal) => proposal.key === key) ||
      state.company.careers[specialistIdFor(need.topic)] ||
      state.company.trainees.some((trainee) => trainee.forAgentId === specialistIdFor(need.topic))
    ) continue;
    created.push({
      key,
      kind: "new_agent",
      owner: "agent-factory",
      title: `Contratar Especialista en ${need.topic}`,
      description: `${need.orders.length} ordenes sobre "${need.topic}" en 14 dias quedaron sin nadie que pudiera tomarlas. Propongo un especialista que estudie esas ordenes en la academia y las reciba despues.`,
      evidence: need.orders.slice(0, 5).map((order) => `${order.createdAt.slice(0, 10)}: ${safeText(order.text).slice(0, 120)}`),
      handoffBrief: `Si apruebas, entra a la academia: estudia estas ordenes y las reglas de la empresa, se gradua como agente nuevo con esas skills y recibe las ordenes de "${need.topic}". Sus puntos solo cuentan con evidencia. Costo: $0.`,
      createdAt: iso,
      status: "pending_submit",
    });
  }
  return created;
}

export function createAgentCouncil(deps: CouncilDeps) {
  let cached: CouncilState | null = null;
  let queue: Promise<unknown> = Promise.resolve();
  let running: Promise<CouncilState> | null = null;
  let runningSince = 0;
  let scouting: Promise<void> | null = null;
  const integrationsNow = () => (deps.integrations ? deps.integrations() : effectiveIntegrations(parseIntegrationOverrides(process.env.AGENT_INTEGRATION_OVERRIDES)));

  async function load(): Promise<CouncilState> {
    if (deps.versioned) {
      // Shared storage: always the latest state, whichever instance wrote it.
      try {
        cached = parseCouncilState((await deps.versioned.read()).raw);
      } catch (error) {
        deps.log(`agent council state read failed: ${error instanceof Error ? error.message : String(error)}`);
        if (!cached) throw error;
      }
      return cached;
    }
    if (cached) return cached;
    cached = parseCouncilState(await deps.readState().catch(() => null));
    return cached;
  }

  // Every state change goes through this queue and starts from the latest state,
  // so the 15-minute cycle, the daily scout and Trust Center approvals never overwrite each other.
  // With shared storage the write is conditional on the revision that was read; if another instance
  // wrote in between, the change is re-applied on top of its state (up to 3 times).
  function mutate(change: (state: CouncilState) => Promise<CouncilState | typeof SKIP> | CouncilState | typeof SKIP): Promise<CouncilState> {
    const job = queue.then(async () => {
      if (!deps.versioned) {
        const current = await load();
        const next = await change(current);
        if (next === SKIP) return current;
        cached = next;
        await deps.writeState(JSON.stringify(next, null, 2));
        return next;
      }
      for (let attempt = 0; ; attempt++) {
        const { raw, revision } = await deps.versioned.read();
        const current = parseCouncilState(raw);
        const next = await change(current);
        if (next === SKIP) { cached = current; return current; }
        try {
          await deps.versioned.write(JSON.stringify(next), revision);
          cached = next;
          return next;
        } catch (error) {
          if (!(error instanceof CouncilStateConflict) || attempt >= 2) throw error;
        }
      }
    });
    queue = job.catch(() => undefined);
    return job;
  }

  // Talks to the Trust Center for a snapshot of the proposals, WITHOUT holding the state lock:
  // creates approval requests for new proposals and reads the status of submitted ones.
  // Returns per-key patches that are merged into the latest state afterwards (mergeProposalSync).
  type ProposalPatch = { expect: "unsubmitted" | { pendingActionId: string }; patch: Partial<CouncilProposal> };
  async function syncProposalsNetwork(snapshot: CouncilState, userId: string): Promise<Map<string, ProposalPatch>> {
    const iso = new Date(deps.now()).toISOString();
    const patches = new Map<string, ProposalPatch>();
    for (const proposal of snapshot.proposals) {
      if (proposal.status === "pending_submit" || proposal.status === "not_submitted") {
        try {
          const id = await withTimeout(deps.submitProposal(userId, proposal), DB_TIMEOUT_MS, "Trust Center");
          patches.set(proposal.key, { expect: "unsubmitted", patch: { status: "submitted", pendingActionId: id, note: "En el Trust Center esperando tu aprobacion." } });
        } catch (error) {
          patches.set(proposal.key, { expect: "unsubmitted", patch: { status: "not_submitted", note: `No se pudo enviar al Trust Center: ${error instanceof Error ? error.message : String(error)}` } });
        }
        continue;
      }
      if (proposal.status === "submitted" && proposal.pendingActionId) {
        const status = await withTimeout(deps.getPendingActionStatus(proposal.pendingActionId), DB_TIMEOUT_MS, "Trust Center").catch(() => null);
        const expect = { pendingActionId: proposal.pendingActionId };
        if (status === "rejected" || status === "expired" || status === "cancelled") {
          patches.set(proposal.key, { expect, patch: { status: "rejected", closedAt: iso, note: status === "rejected" ? "Rechazada en el Trust Center." : `Cerrada en el Trust Center (${status}).` } });
        } else if (status === "failed") {
          patches.set(proposal.key, { expect, patch: { status: "rejected", closedAt: iso, note: "La ejecucion fallo en el Trust Center; se puede volver a proponer en 30 dias." } });
        } else if (status === "approved" || status === "executing" || status === "executed" || status === "completed") {
          patches.set(proposal.key, { expect, patch: { status: "approved" } });
        }
      }
    }
    return patches;
  }

  // Applies the Trust Center results to the LATEST state. A patch only lands if the proposal is still
  // in the state it was read in, so a result never overwrites what another instance already recorded.
  function mergeProposalSync(fresh: CouncilState, patches: Map<string, ProposalPatch>): CouncilState {
    let changed = false;
    const proposals = fresh.proposals.map((proposal) => {
      const entry = patches.get(proposal.key);
      if (!entry) return proposal;
      const matches = entry.expect === "unsubmitted"
        ? (proposal.status === "pending_submit" || proposal.status === "not_submitted") && !proposal.pendingActionId
        : proposal.status === "submitted" && proposal.pendingActionId === entry.expect.pendingActionId;
      if (!matches) return proposal;
      changed = true;
      return { ...proposal, ...entry.patch };
    });
    if (!changed) return fresh;
    let next: CouncilState = { ...fresh, proposals };
    for (const proposal of proposals) {
      if (proposal.status === "approved") next = applyApprovedProposal(next, proposal.key, deps.now());
    }
    return next;
  }

  async function syncProposals(state: CouncilState, userId: string): Promise<CouncilState> {
    const patches = await syncProposalsNetwork(state, userId);
    if (!patches.size) return state;
    return mutate((fresh) => mergeProposalSync(fresh, patches));
  }

  async function runCycleOnce(force: boolean): Promise<CouncilState> {
    const userId = deps.userId();
    const recent = (state: CouncilState) => !force && Boolean(state.lastCycleAt) && deps.now() - toMs(state.lastCycleAt) < MIN_CYCLE_GAP_MS;
    try {
      // Another instance already ran this round: skip the reads too.
      const before = await load();
      if (recent(before)) return before;
      // Slow reads happen outside the queue; the state change itself is serialized.
      const collectTimeout = deps.collectTimeoutMs ?? COLLECT_TIMEOUT_MS;
      const collected = await withTimeout(deps.collect(userId), collectTimeout, "lectura de senales");
      const everyone = deps.collectStatuses
        ? await withTimeout(deps.collectStatuses(userId), collectTimeout, "estado de los agentes").catch(() => ({} as Record<string, AgentLiveStatus>))
        : {};
      const kongEvidence = deps.collectKongEvidence ? await withTimeout(deps.collectKongEvidence(), collectTimeout, "evidencia KONG").catch(() => undefined) : undefined;
      const curriculum = deps.loadCurriculum
        ? await withTimeout(deps.loadCurriculum(), CURRICULUM_TIMEOUT_MS, "academia").catch(() => [] as CurriculumModule[])
        : [];
      let wroteRound = false;
      const written = await mutate(async (state) => {
        wroteRound = false;
        if (recent(state)) return SKIP;
        const now = deps.now();
        const signals: CouncilSignals = { ...collected, now };
        const findings = runCrossChecks(signals);
        const statuses: Record<string, AgentLiveStatus> = { ...everyone, ...statusesFromSignals(signals) };
        // Paused, external or not-built agents (KONG guides, the external KONG publisher, a paused
        // BlackRoom lane, the Mechanic) never earn or lose points and never get hiring/repair proposals.
        const integrations = integrationsNow();
        const unscored = [...EXEMPT_IDS, ...unscoredAgentIds(integrations)];
        const scored = Object.fromEntries(Object.entries(statuses).filter(([id]) => !unscored.includes(id) && !isKongCompanyAgent(id)));
        let next = finishCycle(state, { findings, statuses: scored, now, agentNames: AGENT_NAMES });
        next = advanceCompanyCycle(next, statuses, curriculum, now, integrations);
        const kong = advanceKongCompany({ company: state.kongCompany, evidenceAt: state.kongEvidenceAt, evidence: kongEvidence, now, curriculum });
        next = { ...next, kongCompany: kong.company, kongEvidenceAt: kong.evidenceAt, kongLastStatuses: kong.statuses, kongObservedAt: kong.observedAt, kongCollaboration: kong.collaboration };
        // This completes only a read-only readiness review, never the worker's commercial task.
        next = { ...next, kongSupervision: reviewKongReadiness(state.kongSupervision, everyone, now) };
        next = { ...next, proposals: pruneProposals([...deriveRepairProposals(next, Object.fromEntries(Object.entries(statuses).filter(([id]) => !isKongCompanyAgent(id))), now, AGENT_NAMES, unscored), ...deriveSpecialistProposals(next, now), ...next.proposals]) };
        wroteRound = true;
        return next;
      });
      // Only the instance whose round was actually written talks to the Trust Center, and only after
      // the write: a retried or skipped round never creates approval requests (no duplicates).
      if (!wroteRound) return written;
      return await syncProposals(written, userId);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      deps.log(`agent council cycle failed: ${message}`);
      return mutate((state) => ({ ...state, lastCycleError: message })).catch(() => load());
    }
  }

  // Overlapping triggers (scheduler + manual button) share one run instead of duplicating work.
  // force: the manual button (already rate limited) runs even if a round just happened.
  function runCycle(options: { force?: boolean } = {}): Promise<CouncilState> {
    let force = Boolean(options.force);
    if (running && deps.now() - runningSince > CYCLE_WATCHDOG_MS) {
      deps.log(`agent council round stuck for more than ${CYCLE_WATCHDOG_MS / 60_000} min; starting a new one`);
      running = null;
      // The stuck round may still finish: the new one is never forced, so it respects the
      // "a round just happened" check and the two never both submit to the Trust Center.
      force = false;
    }
    if (!running) {
      runningSince = deps.now();
      const current: Promise<CouncilState> = runCycleOnce(force).finally(() => {
        if (running === current) running = null;
      });
      running = current;
    }
    return running;
  }

  async function runScoutOnce(force = false) {
    const before = await load();
    const last = before.scout.lastRunAt ? Date.parse(before.scout.lastRunAt) : 0;
    if (!force && deps.now() - last < SCOUT_INTERVAL_MS) return;
    const releases: Array<{ repo: string; tag: string; url: string; publishedAt: string | null }> = [];
    const errors: string[] = [];
    for (const item of SCOUT_WATCHLIST) {
      try {
        const release = await deps.fetchLatestRelease(item.repo);
        if (release) releases.push({ repo: item.repo, ...release });
      } catch (error) {
        errors.push(`${item.repo}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    await mutate((current) => {
      const now = deps.now();
      const diff = diffScoutReleases(current.scout.lastSeen, releases, current.proposals, now);
      return {
        ...current,
        proposals: pruneProposals([...diff.proposals, ...current.proposals]),
        scout: {
          lastRunAt: new Date(now).toISOString(),
          lastSeen: diff.lastSeen,
          latest: diff.latest.length ? diff.latest : current.scout.latest,
          error: errors.length ? errors.slice(0, 3).join(" | ") : null,
        },
      };
    });
  }

  function runScout(force = false): Promise<void> {
    if (!scouting) scouting = runScoutOnce(force).finally(() => { scouting = null; });
    return scouting;
  }

  // Called by the Trust Center executor. Fails loudly if the proposal is unknown,
  // so the Trust Center never shows "executed" for something that was not recorded.
  function approveFromTrustCenter(key: string): Promise<CouncilState> {
    return mutate((state) => {
      if (!hasProposal(state, key)) throw new Error(`Propuesta del consejo no encontrada: ${key}`);
      return applyApprovedProposal(state, key, deps.now());
    });
  }

  function placeOrder(text: string, scope: "main" | "kong" = "main") {
    return mutate((state) => {
      if (scope === "kong") {
        const now = deps.now();
        const ids = Object.keys(state.kongLastStatuses);
        const normalized = text.toLocaleLowerCase();
        const matching = ids.filter(id => id.split(":").slice(1).some(part => normalized.includes(part.toLocaleLowerCase())));
        const available = matching.length ? matching : ids;
        // Recorded for review only: an office order does not dispatch a remote worker.
        const statuses = Object.fromEntries(available.map(id => [id, { state: "offline" as const, label: "Orden registrada para revisión; sin despacho remoto" }]));
        const result = createOrder(state.kongCompany, { text, now, statuses, available, names: {} });
        return { ...state, kongCompany: result.state };
      }
      const available = Object.keys(AGENT_NAMES).filter((id) => !id.startsWith("kong:") && id !== "kong");
      const now = deps.now();
      const fresh = state.lastCycleAt && now - toMs(state.lastCycleAt) < STATUS_FRESH_MS && !state.lastCycleError;
      const statuses: Record<string, { state: AgentLiveStatus["state"]; label: string }> = fresh ? { ...state.lastStatuses } : {};
      if (fresh) statuses.mechanic = { state: "working", label: "Reviso a todos en el ultimo consejo" };
      const specialistNames = Object.fromEntries(
        Object.keys(state.company.careers).filter(isSpecialistId).map((id) => [id, `Especialista en ${specialistTopicLabel(id)}`])
      );
      const result = createOrder(state.company, { text, now, statuses, available, names: { ...AGENT_NAMES, ...specialistNames } });
      return { ...state, company: result.state };
    });
  }

  // evidenceRunId: an automation run of this user that finished with "success". Verified here,
  // never trusted from the client; one run can close only one order.
  async function finishOrder(orderId: string, evidenceRunId?: string, requesterId?: string, scope: "main" | "kong" = "main") {
    if (scope === "kong") {
      if (evidenceRunId) throw new OrderEvidenceError("Una ejecución genérica no demuestra que esta orden KONG se realizó. Confírmala manualmente sin puntos.");
      return mutate(state => {
        if (!state.kongCompany.orders.some(order => order.id === orderId)) throw new Error("Orden no encontrada");
        return { ...state, kongCompany: completeOrder(state.kongCompany, orderId, deps.now()) };
      });
    }
    let evidence: OrderEvidence | undefined;
    if (evidenceRunId) {
      if (!deps.verifyRun) throw new OrderEvidenceError("No se puede verificar la evidencia en este servidor.");
      const run = await withTimeout(deps.verifyRun(requesterId || deps.userId(), evidenceRunId), DB_TIMEOUT_MS, "evidencia");
      if (!run) throw new OrderEvidenceError("Esa ejecucion no existe o no es tuya.");
      if (run.status !== "success") throw new OrderEvidenceError(`Esa ejecucion termino en "${run.status}", no en exito.`);
      evidence = { ref: `automation_run:${run.id}`, source: "automation_run", summary: run.summary || "Ejecucion exitosa", at: run.at || new Date(deps.now()).toISOString() };
    }
    return mutate((state) => {
      if (!state.company.orders.some((order) => order.id === orderId)) throw new Error("Orden no encontrada");
      if (evidence && evidenceAlreadyUsed(state.company, evidence.ref)) throw new OrderEvidenceError("Esa ejecucion ya cerro otra orden.");
      return { ...state, company: completeOrder(state.company, orderId, deps.now(), evidence) };
    });
  }

  async function view() {
    const loaded = await load();
    // The KONG conversation is owner-only (served by /api/kong-supervisor/state with an owner check).
    // This view is readable by any signed-in user, so it only carries the readiness records.
    const { messages: _privateMessages, ...kongSupervisionPublic } = loaded.kongSupervision;
    const state = { ...loaded, kongSupervision: kongSupervisionPublic };
    const personalities = Object.fromEntries(Object.values(state.company.careers).map((career) => [career.agentId, personalityFor(career.agentId, career.generation)]));
    return {
      ...state,
      kongLastStatuses: state.kongObservedAt && deps.now() - Date.parse(state.kongObservedAt) <= 5 * 60_000 ? state.kongLastStatuses : {},
      kongLeaderboard: leaderboard(state.kongCompany),
      kongPersonalities: Object.fromEntries(Object.values(state.kongCompany.careers).map(career => [career.agentId, personalityFor(career.agentId, career.generation)])),
      kongCollaboration: state.kongCollaboration.observedAt && deps.now() - Date.parse(state.kongCollaboration.observedAt) <= 5 * 60_000 ? state.kongCollaboration : { verified: false, observedAt: null, totalFindings: 0, exchanges: [] },
      leaderboard: leaderboard(state.company, ["ceo", ...Object.keys(state.company.careers).filter(isKongCompanyAgent), ...EXEMPT_IDS, ...unscoredAgentIds(integrationsNow())]),
      integrations: integrationsNow(),
      personalities,
      overrides: applyLessons(state.debates, state.lessons),
      nextCycleInMs: state.lastCycleAt ? Math.max(0, Date.parse(state.lastCycleAt) + COUNCIL_CYCLE_MS - deps.now()) : 0,
      costUsd: 0,
      enabled: isAgentCouncilEnabled(),
    };
  }

  // KONG supervisor (PR #315): its conversation and read-only reviews are committed through the same
  // serialized, revision-checked mutate as everything else. The change may be replayed on a conflict.
  async function updateKongSupervision(change: (current: CouncilState["kongSupervision"]) => Promise<CouncilState["kongSupervision"]>) {
    const state = await mutate(async (current) => ({ ...current, kongSupervision: await change(current.kongSupervision) }));
    return state.kongSupervision;
  }

  async function readKongSupervision() {
    return (await load()).kongSupervision;
  }

  return { runCycle, runScout, approveFromTrustCenter, view, load, placeOrder, finishOrder, updateKongSupervision, readKongSupervision };
}

export function isAgentCouncilEnabled(env: NodeJS.ProcessEnv = process.env) {
  return String(env.AGENT_COUNCIL_ENABLED || "").trim().toLowerCase() !== "false";
}

// ---------- Real dependencies ----------

const DATA_DIR = process.env.AGENT_COUNCIL_DATA_DIR || path.join(process.cwd(), "agent_council_data");
const STATE_FILE = path.join(DATA_DIR, "state.json");

const fileWriteQueues = new Map<string, Promise<void>>();
async function replaceFileAtomic(source: string, destination: string): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    try { await rename(source, destination); return; }
    catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      // Windows readers and security scanners can hold a replacement lock
      // briefly. Never delete the destination or fall back to a partial write.
      if (process.platform !== "win32" || !["EPERM", "EACCES", "EBUSY"].includes(code || "") || attempt >= 7) throw error;
      await new Promise(resolve => setTimeout(resolve, Math.min(250, 10 * 2 ** attempt)));
    }
  }
}

// Unique temporary files protect readers. A per-destination queue also avoids
// simultaneous Windows replacements and preserves submission order. This is
// process-local coordination; it does not provide a distributed writer lock.
export function writeFileAtomic(file: string, raw: string): Promise<void> {
  const destination = path.resolve(file);
  const key = process.platform === "win32" ? destination.toLowerCase() : destination;
  const previous = fileWriteQueues.get(key) || Promise.resolve();
  const operation = previous.then(async () => {
    await mkdir(path.dirname(destination), { recursive: true });
    const tmp = `${destination}.${process.pid}.${randomUUID()}.tmp`;
    try {
      await writeFile(tmp, raw, { encoding: "utf8", flag: "wx", mode: 0o600 });
      await replaceFileAtomic(tmp, destination);
    } finally {
      await unlink(tmp).catch(() => undefined);
    }
  });
  // A failed write must reject its own caller without poisoning later writes.
  const settled = operation.then(() => undefined, () => undefined);
  fileWriteQueues.set(key, settled);
  void settled.then(() => { if (fileWriteQueues.get(key) === settled) fileWriteQueues.delete(key); });
  return operation;
}

function writeStateAtomic(raw: string) {
  return writeFileAtomic(STATE_FILE, raw);
}

async function exists(file: string) {
  return stat(file).then(() => true, () => false);
}

export async function readSkillDocs(root = process.cwd()): Promise<{ skills: CouncilSkillDoc[]; listedInClaudeMd: string[]; maxBodyChars: number }> {
  const { compactSkillBody, extractFrontmatter, skillLimits } = await import("./claude-skill-bridge");
  const { maxBodyChars } = skillLimits();
  const dir = path.join(root, ".claude", "skills");
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  const skills: CouncilSkillDoc[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const file = path.join(dir, entry.name, "SKILL.md");
    const raw = await readFile(file, "utf8").catch(() => null);
    if (!raw) continue;
    const { metadata, body } = extractFrontmatter(raw);
    const referenced = Array.from(new Set(Array.from(body.matchAll(/`((?:docs|server|client|shared|script|tests)\/[\w./-]+\.\w+)`/g)).map((match) => match[1])));
    const missingPaths: string[] = [];
    for (const ref of referenced) if (!(await exists(path.join(root, ref)))) missingPaths.push(ref);
    skills.push({
      name: metadata.name || entry.name,
      path: path.relative(root, file).replace(/\\/g, "/"),
      description: metadata.description || "",
      truncatedInChat: compactSkillBody(body, maxBodyChars).includes("[Skill truncated for token budget]"),
      bodyChars: body.length,
      missingPaths,
    });
  }
  const claudeMd = await readFile(path.join(root, "CLAUDE.md"), "utf8").catch(() => "");
  const listedInClaudeMd = Array.from(new Set(Array.from(claudeMd.matchAll(/^- `\/([a-z0-9-]+)`/gm)).map((match) => match[1])));
  return { skills, listedInClaudeMd, maxBodyChars };
}

async function collectReal(userId: string): Promise<Omit<CouncilSignals, "now">> {
  const safe = async <T,>(label: string, work: () => Promise<T> | T): Promise<T | undefined> => {
    try {
      return await withTimeout(Promise.resolve().then(work), READ_TIMEOUT_MS, label);
    } catch (error) {
      console.warn(`[agent-council] ${label} unavailable:`, error instanceof Error ? error.message : error);
      return undefined;
    }
  };
  const [{ storage }, clippersRuntime, dropshipping, marketing] = await Promise.all([
    import("./storage"),
    import("./clippers-runtime-status"),
    import("./dropshipping-ceo"),
    import("./marketing-command-center"),
  ]);
  // Database rows carry Date objects; the rules read JSON, like the HTTP endpoints do.
  const plain = <T,>(value: T): T => (value === undefined ? value : JSON.parse(JSON.stringify(value)));
  const docs = await safe("skills", () => readSkillDocs());
  const projects = await safe("app projects", () => storage.getAppProjects(userId));
  return {
    clippers: await safe("clippers", () => clippersRuntime.getClipperWorkerRuntimeStatus()),
    dropshipping: await safe("dropshipping", () => dropshipping.getDropshippingLaunchReadiness()),
    marketing: await safe("marketing", () => marketing.getMarketingCommandCenterSnapshot()),
    automationRuns: plain(await safe("automation runs", () => storage.getAutomationRuns(userId, undefined, 50))),
    appProjects: projects?.map((app) => ({ id: app.id, name: app.name, status: app.status })),
    appIncidents: plain(await safe("incidents", () => storage.getAppIncidents(userId))),
    skills: docs?.skills,
    skillsListedInClaudeMd: docs?.listedInClaudeMd,
    maxSkillBodyChars: docs?.maxBodyChars,
  };
}

// Every agent's real status, from the same functions its own endpoint uses (read-only; no scans,
// no ensureDefaultAutomations). An agent whose source throws is reported as an error, never as working.
// Reports that call external APIs (GitHub overview of every repo, market prices) are reused for
// an hour instead of re-running every 15-minute cycle.
const SLOW_READ_TTL_MS = 60 * 60_000;
const slowReads = new Map<string, { at: number; body: unknown }>();
async function cachedSlowRead(key: string, work: () => Promise<unknown>): Promise<unknown> {
  const hit = slowReads.get(key);
  if (hit && Date.now() - hit.at < SLOW_READ_TTL_MS) return hit.body;
  const body = await work();
  slowReads.set(key, { at: Date.now(), body });
  return body;
}

async function collectStatusesReal(userId: string): Promise<Record<string, AgentLiveStatus>> {
  const now = Date.now();
  const statuses: Record<string, AgentLiveStatus> = {};
  const summarize = (agentId: string, body: unknown) => {
    statuses[agentId] = summarizeProbe(agentProbes[agentId], { ok: true, status: 200, body: JSON.parse(JSON.stringify(body ?? null)) }, now);
  };
  const read = async (agentIds: string[], work: () => Promise<unknown>) => {
    try {
      const body = await withTimeout(Promise.resolve().then(work), READ_TIMEOUT_MS, agentIds.join(", "));
      agentIds.forEach((agentId) => summarize(agentId, body));
    } catch (error) {
      const detail = error instanceof Error ? error.message.slice(0, 120) : "sin detalle";
      agentIds.forEach((agentId) => { statuses[agentId] = { state: "error", label: "Con error", detail }; });
    }
  };
  const hasValue = (value: string | undefined) => Boolean(value && value.trim() && !/^(changeme|placeholder|xxx)/i.test(value.trim()));
  await Promise.all([
    read(["assistant"], async () => ({ google: await (await import("./google-calendar")).isGoogleCalendarConnected(), zoho: false })),
    read(["code", "github"], async () => {
      const gh = await import("./github-client");
      const connected = await gh.isGitHubConnected();
      return connected ? { connected: true, user: await gh.getAuthenticatedUser() } : { connected: false };
    }),
    read(["claude-reviewer"], async () => ({ workerEnabled: process.env.OFFICE_WORKER_ENABLED !== "false" })),
    read(["ceo"], async () => {
      const { storage } = await import("./storage");
      const config = await storage.getTelegramConfig(userId);
      const checks = { telegram: hasValue(process.env.TELEGRAM_BOT_TOKEN) && Boolean(config?.enabled && config.chatId), ai: hasValue(process.env.AI_INTEGRATIONS_GEMINI_API_KEY) || hasValue(process.env.OPENAI_API_KEY) };
      return { ready: Object.values(checks).every(Boolean), checks };
    }),
    read(["revenue"], async () => {
      const { storage } = await import("./storage");
      const config = await storage.getTelegramConfig(userId).catch(() => undefined);
      const accountId = process.env.REVENUE_STRIPE_ACCOUNT_ID?.trim() || "";
      const webhookSecret = process.env.REVENUE_STRIPE_WEBHOOK_SECRET?.trim() || "";
      const checks = {
        accountSeparated: /^acct_[A-Za-z0-9]+$/.test(accountId),
        signedWebhook: webhookSecret.startsWith("whsec_") && webhookSecret.length >= 24,
        telegram: Boolean(process.env.TELEGRAM_BOT_TOKEN?.trim() && config?.enabled && config.chatId),
      };
      return { ready: Object.values(checks).every(Boolean), checks };
    }),
    read(["portfolio"], () => cachedSlowRead(`portfolio:${userId}`, async () => (await import("./portfolio-agent")).getPortfolioSummary(userId))),
    read(["radio"], async () => (await import("./radio-agent")).getRadioSlotsForMonth(userId)),
    read(["legal"], () => cachedSlowRead(`legal:${userId}`, async () => (await import("./legal-compliance-agent")).runLegalComplianceReports(userId))),
    read(["news", ...CITY_NEWS_AGENTS.map((agent) => agent.id)], async () => (await import("./clippers-local-news-agent")).getClipperLocalNewsStatus()),
    read(["kong-videos"], async () => (await import("./promo-video-agent")).getPromoVideoStatus(userId)),
    read(["kong-metrics"], async () => (await import("./kong-operations")).getKongOperations().view()),
    read(["blackroom-videos"], async () => {
      const remoteModule = await import("./blackroom-remote-control");
      const routesModule = await import("./blackroom-control-routes");
      const remote = await remoteModule.readBlackRoomRemoteControl();
      const remoteQueue = (remote as unknown as { device?: { queue?: Record<string, unknown> } }).device?.queue;
      const online = remoteModule.isBlackRoomRemoteDeviceOnline(remote);
      const local = await routesModule.readBlackRoomPanelQueue(remoteQueue as never);
      return { agent: routesModule.resolveBlackRoomPanelAgent(local, remoteQueue as never, online), remote: { online } };
    }),
  ]);
  return statuses;
}

// The academy teaches the company's real documents and database map.
async function loadCurriculumReal(root = process.cwd()): Promise<CurriculumModule[]> {
  const modules: CurriculumModule[] = [];
  const doc = async (id: string, title: string, file: string) => {
    const raw = await readFile(path.join(root, file), "utf8").catch(() => null);
    if (!raw) return;
    const headings = Array.from(raw.matchAll(/^#{1,3}\s+(.+)$/gm)).map((match) => match[1].trim()).slice(0, 4);
    modules.push({ id, title, summary: `${file} (${raw.length} caracteres)${headings.length ? `: ${headings.join(" · ")}` : ""}` });
  };
  await doc("rules", "Reglas de la empresa", "AGENTS.md");
  await doc("claude", "Como trabajamos con IA y costos", "CLAUDE.md");
  await doc("map", "Mapa del codigo", "docs/codebase-map.md");
  await doc("ceo-plan", "Plan del CEO Assistant", "CEO_ASSISTANT_PLAN.md");
  try {
    const schema = await import("@shared/schema");
    const tables = Object.entries(schema).filter(([, value]) => value && typeof value === "object" && Symbol.for("drizzle:Name") in (value as object)).map(([name]) => name);
    modules.push({ id: "database", title: "Base de datos", summary: `${tables.length} tablas: ${tables.slice(0, 8).join(", ")}${tables.length > 8 ? "..." : ""}` });
  } catch {
    // Schema unavailable: the academy simply skips this module.
  }
  const docs = await readSkillDocs(root).catch(() => null);
  if (docs) modules.push({ id: "skills", title: "Skills de la empresa", summary: docs.skills.map((skill) => skill.name).join(", ") });
  return modules;
}

async function fetchLatestReleaseReal(repo: string) {
  const { getConfiguredGitHubToken } = await import("./github-client");
  const token = getConfiguredGitHubToken();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    const response = await fetch(`https://api.github.com/repos/${repo}/releases/latest`, {
      headers: { Accept: "application/vnd.github+json", "User-Agent": "blackops-agent-council", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      signal: controller.signal,
    });
    if (response.status === 404) return null;
    if (!response.ok) throw new Error(`GitHub ${response.status}`);
    const body = (await response.json()) as { tag_name?: string; html_url?: string; published_at?: string | null };
    return body.tag_name ? { tag: body.tag_name, url: body.html_url || `https://github.com/${repo}/releases`, publishedAt: body.published_at || null } : null;
  } finally {
    clearTimeout(timer);
  }
}

let council: ReturnType<typeof createAgentCouncil> | null = null;

// In production the state lives in Postgres (existing revenue_engine_state table, its own owner key,
// so no migration): every Autoscale instance sees the same careers, orders and proposals.
// Locally without DATABASE_URL it stays in the git-ignored file.
const STATE_OWNER = "agent-council";
const STATE_KIND = "council_state";

function databaseStateStore(): CouncilDeps["versioned"] {
  let hasDatabase = false;
  try {
    hasDatabase = Boolean(resolveDatabaseConnectionString());
  } catch {
    hasDatabase = false;
  }
  if (!hasDatabase) return undefined;
  const adapter = async () => {
    const [{ db }, { createDrizzleRevenueEngineStateAdapter }] = await Promise.all([import("./db"), import("./revenue-engine-state-store")]);
    return createDrizzleRevenueEngineStateAdapter(db);
  };
  return {
    async read() {
      const rows = await withTimeout((await adapter()).loadCollections(STATE_OWNER), DB_TIMEOUT_MS, "estado del consejo");
      const row = rows.find((item) => item.kind === STATE_KIND);
      if (row) return { raw: JSON.stringify(row.data), revision: row.revision };
      // First run on the database: carry over the file state of this instance, if any.
      return { raw: await readFile(STATE_FILE, "utf8").catch(() => null), revision: null };
    },
    async write(raw, expectedRevision) {
      try {
        const row = await withTimeout(
          (await adapter()).upsertCollection({
            ownerUserId: STATE_OWNER,
            kind: STATE_KIND,
            data: JSON.parse(raw),
            ...(expectedRevision === null ? {} : { expectedRevision }),
            updatedAt: new Date(),
          }),
          DB_TIMEOUT_MS,
          "estado del consejo"
        );
        return row.revision;
      } catch (error) {
        if (error instanceof Error && /state conflict/i.test(error.message)) throw new CouncilStateConflict(error.message);
        throw error;
      }
    },
  };
}

export function getAgentCouncil() {
  if (council) return council;
  council = createAgentCouncil({
    now: () => Date.now(),
    userId: systemUserId,
    readState: () => readFile(STATE_FILE, "utf8").catch(() => null),
    writeState: writeStateAtomic,
    versioned: databaseStateStore(),
    verifyRun: async (userId, runId) => {
      const [{ db }, { automationRuns }, { and, eq }] = await Promise.all([import("./db"), import("@shared/schema"), import("drizzle-orm")]);
      const [run] = await db.select().from(automationRuns).where(and(eq(automationRuns.id, runId), eq(automationRuns.ownerUserId, userId))).limit(1);
      if (!run) return null;
      const at = run.finishedAt || run.startedAt;
      return { id: run.id, status: run.status, summary: run.resultSummary, at: at ? new Date(at).toISOString() : null };
    },
    collect: collectReal,
    submitProposal: async (userId, proposal) => {
      // Never two open approval requests for the same proposal: reuse the pending one if it exists.
      const [{ db }, { pendingActions }, { and, eq, inArray }] = await Promise.all([import("./db"), import("@shared/schema"), import("drizzle-orm")]);
      const [existing] = await db
        .select({ id: pendingActions.id })
        .from(pendingActions)
        .where(and(eq(pendingActions.userId, userId), eq(pendingActions.resourceType, "agent_council_proposal"), eq(pendingActions.resourceId, proposal.key), inArray(pendingActions.status, ["draft", "pending", "edited", "snoozed"])))
        .limit(1);
      if (existing) return existing.id;
      const { createPendingActionForApproval } = await import("./trust-policy");
      const action = await createPendingActionForApproval({
        userId,
        actorType: "system",
        actorId: `agent-council:${proposal.owner}`,
        origin: "system",
        executionMode: "automated",
        actionType: `agent_council.${proposal.kind}`,
        resourceType: "agent_council_proposal",
        resourceId: proposal.key,
        title: proposal.title,
        description: proposal.description,
        input: { proposalKey: proposal.key },
        proposedChanges: { evidence: proposal.evidence, handoffBrief: proposal.handoffBrief, lesson: proposal.lesson || null },
        metadata: { costUsd: 0, kind: proposal.kind },
        scope: "system",
      });
      return action.id;
    },
    getPendingActionStatus: async (id) => {
      const { storage } = await import("./storage");
      const action = await storage.getPendingAction(id);
      return action?.status || null;
    },
    fetchLatestRelease: fetchLatestReleaseReal,
    log: (message) => console.warn(`[agent-council] ${message}`),
    collectStatuses: collectStatusesReal,
    collectKongEvidence: async () => (await (await import("./office-kong")).runOfficeKongReadOnly()).evidence,
    loadCurriculum: () => loadCurriculumReal(),
  });
  return council;
}

// The council works for the single BlackOps owner (same user the other schedulers use).
let resolvedSystemUserId: string | null = null;
export function setAgentCouncilUser(userId: string) {
  resolvedSystemUserId = userId;
}
function systemUserId(): string {
  if (!resolvedSystemUserId) throw new Error("Agent council user not initialised");
  return resolvedSystemUserId;
}

export async function startAgentCouncilScheduler(env: NodeJS.ProcessEnv = process.env) {
  if (!isAgentCouncilEnabled(env)) {
    console.log("[agent-council] disabled by AGENT_COUNCIL_ENABLED=false");
    return;
  }
  const { getSystemUserId } = await import("./user-context");
  setAgentCouncilUser(getSystemUserId());
  const instance = getAgentCouncil();
  // Errors are logged, never thrown: an unhandled rejection here would stop the whole server.
  const tick = () => {
    instance.runCycle().catch((error) => console.warn("[agent-council] cycle error:", error instanceof Error ? error.message : error));
    instance.runScout().catch((error) => console.warn("[agent-council] scout error:", error instanceof Error ? error.message : error));
  };
  setTimeout(tick, 60_000).unref?.();
  setInterval(tick, COUNCIL_CYCLE_MS).unref?.();
}

export { emptyCouncilState };
