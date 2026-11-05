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

import { mkdir, readFile, readdir, rename, stat, unlink, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
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
  toMs,
  runCrossChecks,
  type CouncilProposal,
  type CouncilSignals,
  type CouncilSkillDoc,
  type CouncilState,
} from "@shared/agent-council";
import { agentProbes, summarizeProbe, type AgentLiveStatus } from "@shared/agent-live-status";
import {
  advanceAcademy,
  advanceCompany,
  completeOrder,
  createOrder,
  enrollTrainee,
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
  collectStatuses?: (userId: string) => Promise<Record<string, AgentLiveStatus>>;
  // Real documents the academy teaches.
  loadCurriculum?: () => Promise<CurriculumModule[]>;
};

export const KONG_TEAM = ["KONG AI", "Promoters + Mesas", "Venues", "Kong Legal"];
const KONG_IDS = KONG_TEAM.map((name) => `kong:${name}`);
const EXEMPT_IDS = [...KONG_IDS, "mechanic"];
// Order routing only trusts live states from a recent council cycle.
const STATUS_FRESH_MS = 45 * 60_000;

export const AGENT_NAMES: Record<string, string> = {
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

function advanceCompanyCycle(state: CouncilState, statuses: Record<string, AgentLiveStatus>, curriculum: CurriculumModule[], now: number): CouncilState {
  const compact = Object.fromEntries(Object.entries(statuses).map(([id, status]) => [id, { state: status.state, label: status.label }]));
  let company = advanceCompany(state.company, { now, statuses: compact, roles: AGENT_NAMES, exempt: EXEMPT_IDS }).state;
  // Approved hires (agent factory) start in the academy.
  for (const proposal of state.proposals) {
    if (proposal.kind !== "new_agent" || proposal.status !== "applied") continue;
    const forAgentId = proposal.key.replace(/^new_agent:helper-/, "");
    company = enrollTrainee(company, { id: proposal.key, forAgentId, role: proposal.title.replace(/^Contratar /, ""), now });
  }
  // If the docs can't be read this cycle, the academy still advances on the core rules so nobody
  // stays in training forever.
  const modules = curriculum.length ? curriculum : [{ id: "core-rules", title: "Reglas basicas", summary: "PR-first, QA antes de publicar, nada de gasto sin aprobacion de Robert." }];
  company = advanceAcademy(company, () => modules, now);
  return { ...state, company, lastStatuses: compact };
}

export function createAgentCouncil(deps: CouncilDeps) {
  let cached: CouncilState | null = null;
  let queue: Promise<unknown> = Promise.resolve();
  let running: Promise<CouncilState> | null = null;
  let scouting: Promise<void> | null = null;

  async function load(): Promise<CouncilState> {
    if (cached) return cached;
    cached = parseCouncilState(await deps.readState().catch(() => null));
    return cached;
  }

  // Every state change goes through this queue and starts from the latest state,
  // so the 15-minute cycle, the daily scout and Trust Center approvals never overwrite each other.
  function mutate(change: (state: CouncilState) => Promise<CouncilState> | CouncilState): Promise<CouncilState> {
    const job = queue.then(async () => {
      const next = await change(await load());
      cached = next;
      await deps.writeState(JSON.stringify(next, null, 2));
      return next;
    });
    queue = job.catch(() => undefined);
    return job;
  }

  async function syncProposals(state: CouncilState, userId: string): Promise<CouncilState> {
    const iso = new Date(deps.now()).toISOString();
    const proposals: CouncilProposal[] = [];
    for (const proposal of state.proposals) {
      if (proposal.status === "pending_submit" || proposal.status === "not_submitted") {
        try {
          const id = await withTimeout(deps.submitProposal(userId, proposal), DB_TIMEOUT_MS, "Trust Center");
          proposals.push({ ...proposal, status: "submitted", pendingActionId: id, note: "En el Trust Center esperando tu aprobacion." });
        } catch (error) {
          proposals.push({ ...proposal, status: "not_submitted", note: `No se pudo enviar al Trust Center: ${error instanceof Error ? error.message : String(error)}` });
        }
        continue;
      }
      if (proposal.status === "submitted" && proposal.pendingActionId) {
        const status = await withTimeout(deps.getPendingActionStatus(proposal.pendingActionId), DB_TIMEOUT_MS, "Trust Center").catch(() => null);
        if (status === "rejected" || status === "expired" || status === "cancelled") {
          proposals.push({ ...proposal, status: "rejected", closedAt: iso, note: status === "rejected" ? "Rechazada en el Trust Center." : `Cerrada en el Trust Center (${status}).` });
          continue;
        }
        if (status === "failed") {
          proposals.push({ ...proposal, status: "rejected", closedAt: iso, note: "La ejecucion fallo en el Trust Center; se puede volver a proponer en 30 dias." });
          continue;
        }
        if (status === "approved" || status === "executing" || status === "executed" || status === "completed") {
          proposals.push({ ...proposal, status: "approved" });
          continue;
        }
      }
      proposals.push(proposal);
    }
    let next: CouncilState = { ...state, proposals };
    for (const proposal of proposals) {
      if (proposal.status === "approved") next = applyApprovedProposal(next, proposal.key, deps.now());
    }
    return next;
  }

  async function runCycleOnce(): Promise<CouncilState> {
    const userId = deps.userId();
    try {
      // Slow reads happen outside the queue; the state change itself is serialized.
      const collected = await deps.collect(userId);
      const everyone = deps.collectStatuses ? await deps.collectStatuses(userId).catch(() => ({} as Record<string, AgentLiveStatus>)) : {};
      const curriculum = deps.loadCurriculum ? await deps.loadCurriculum().catch(() => [] as CurriculumModule[]) : [];
      return await mutate(async (state) => {
        const now = deps.now();
        const signals: CouncilSignals = { ...collected, now };
        const findings = runCrossChecks(signals);
        const statuses: Record<string, AgentLiveStatus> = { ...everyone, ...statusesFromSignals(signals) };
        // Kong guides and the Mechanic have no endpoint of their own: they never earn or lose
        // points, never get hiring/repair proposals, and are only reported (honestly) to the UI.
        let next = finishCycle(state, { findings, statuses, now, agentNames: AGENT_NAMES });
        next = advanceCompanyCycle(next, statuses, curriculum, now);
        next = { ...next, proposals: pruneProposals([...deriveRepairProposals(next, statuses, now, AGENT_NAMES, EXEMPT_IDS), ...next.proposals]) };
        return syncProposals(next, userId);
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      deps.log(`agent council cycle failed: ${message}`);
      return mutate((state) => ({ ...state, lastCycleError: message })).catch(() => load());
    }
  }

  // Overlapping triggers (scheduler + manual button) share one run instead of duplicating work.
  function runCycle(): Promise<CouncilState> {
    if (!running) running = runCycleOnce().finally(() => { running = null; });
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

  function placeOrder(text: string) {
    return mutate((state) => {
      const available = Object.keys(AGENT_NAMES).filter((id) => !id.startsWith("kong:") && id !== "kong");
      const now = deps.now();
      const fresh = state.lastCycleAt && now - toMs(state.lastCycleAt) < STATUS_FRESH_MS && !state.lastCycleError;
      const statuses: Record<string, { state: AgentLiveStatus["state"]; label: string }> = fresh ? { ...state.lastStatuses } : {};
      if (fresh) statuses.mechanic = { state: "working", label: "Reviso a todos en el ultimo consejo" };
      const result = createOrder(state.company, { text, now, statuses, available, names: AGENT_NAMES });
      return { ...state, company: result.state };
    });
  }

  function finishOrder(orderId: string) {
    return mutate((state) => {
      if (!state.company.orders.some((order) => order.id === orderId)) throw new Error("Orden no encontrada");
      return { ...state, company: completeOrder(state.company, orderId, deps.now()) };
    });
  }

  async function view() {
    const state = await load();
    const personalities = Object.fromEntries(Object.values(state.company.careers).map((career) => [career.agentId, personalityFor(career.agentId, career.generation)]));
    return {
      ...state,
      leaderboard: leaderboard(state.company, ["ceo", ...EXEMPT_IDS]),
      personalities,
      overrides: applyLessons(state.debates, state.lessons),
      nextCycleInMs: state.lastCycleAt ? Math.max(0, Date.parse(state.lastCycleAt) + COUNCIL_CYCLE_MS - deps.now()) : 0,
      costUsd: 0,
      enabled: isAgentCouncilEnabled(),
    };
  }

  return { runCycle, runScout, approveFromTrustCenter, view, load, placeOrder, finishOrder };
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
      return await work();
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
      const body = await work();
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
    read(["news"], async () => (await import("./clippers-local-news-agent")).getClipperLocalNewsStatus()),
    read(["kong-videos"], async () => (await import("./promo-video-agent")).getPromoVideoStatus(userId)),
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

export function getAgentCouncil() {
  if (council) return council;
  council = createAgentCouncil({
    now: () => Date.now(),
    userId: systemUserId,
    readState: () => readFile(STATE_FILE, "utf8").catch(() => null),
    writeState: writeStateAtomic,
    collect: collectReal,
    submitProposal: async (userId, proposal) => {
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
