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

import { mkdir, readFile, readdir, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  COUNCIL_CYCLE_MS,
  SCOUT_INTERVAL_MS,
  SCOUT_WATCHLIST,
  applyApprovedProposal,
  applyLessons,
  diffScoutReleases,
  emptyCouncilState,
  finishCycle,
  parseCouncilState,
  pruneProposals,
  runCrossChecks,
  type CouncilProposal,
  type CouncilSignals,
  type CouncilSkillDoc,
  type CouncilState,
} from "@shared/agent-council";
import { agentProbes, summarizeProbe, type AgentLiveStatus } from "@shared/agent-live-status";

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
};

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

export function createAgentCouncil(deps: CouncilDeps) {
  let running: Promise<CouncilState> | null = null;
  let scouting: Promise<void> | null = null;
  let cached: CouncilState | null = null;

  async function load(): Promise<CouncilState> {
    if (cached) return cached;
    cached = parseCouncilState(await deps.readState().catch(() => null));
    return cached;
  }

  async function save(state: CouncilState) {
    cached = state;
    await deps.writeState(JSON.stringify(state, null, 2));
  }

  async function syncProposals(state: CouncilState, userId: string): Promise<CouncilState> {
    const proposals: CouncilProposal[] = [];
    for (const proposal of state.proposals) {
      if (proposal.status === "pending_submit" || proposal.status === "not_submitted") {
        try {
          const id = await deps.submitProposal(userId, proposal);
          proposals.push({ ...proposal, status: "submitted", pendingActionId: id, note: "En el Trust Center esperando tu aprobacion." });
        } catch (error) {
          proposals.push({ ...proposal, status: "not_submitted", note: `No se pudo enviar al Trust Center: ${error instanceof Error ? error.message : String(error)}` });
        }
        continue;
      }
      if (proposal.status === "submitted" && proposal.pendingActionId) {
        const status = await deps.getPendingActionStatus(proposal.pendingActionId).catch(() => null);
        if (status === "rejected" || status === "expired") {
          proposals.push({ ...proposal, status: "rejected", note: "Rechazada en el Trust Center." });
          continue;
        }
        if (status === "approved" || status === "executed") {
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
    const state = await load();
    const userId = deps.userId();
    const now = deps.now();
    try {
      const collected = await deps.collect(userId);
      const signals: CouncilSignals = { ...collected, now };
      const findings = runCrossChecks(signals);
      const statuses = statusesFromSignals(signals);
      let next = finishCycle(state, { findings, statuses, now, agentNames: AGENT_NAMES });
      next = await syncProposals(next, userId);
      await save(next);
      return next;
    } catch (error) {
      const failed = { ...state, lastCycleError: error instanceof Error ? error.message : String(error) };
      await save(failed).catch(() => undefined);
      deps.log(`agent council cycle failed: ${failed.lastCycleError}`);
      return failed;
    }
  }

  // Overlapping triggers (scheduler + manual button) share one run instead of duplicating work.
  function runCycle(): Promise<CouncilState> {
    if (!running) running = runCycleOnce().finally(() => { running = null; });
    return running;
  }

  async function runScoutOnce(force = false) {
    const state = await load();
    const now = deps.now();
    const last = state.scout.lastRunAt ? Date.parse(state.scout.lastRunAt) : 0;
    if (!force && now - last < SCOUT_INTERVAL_MS) return;
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
    const current = await load();
    const diff = diffScoutReleases(current.scout.lastSeen, releases, current.proposals, now);
    await save({
      ...current,
      proposals: pruneProposals([...diff.proposals, ...current.proposals]),
      scout: {
        lastRunAt: new Date(now).toISOString(),
        lastSeen: diff.lastSeen,
        latest: diff.latest.length ? diff.latest : current.scout.latest,
        error: errors.length ? errors.slice(0, 3).join(" | ") : null,
      },
    });
  }

  function runScout(force = false): Promise<void> {
    if (!scouting) scouting = runScoutOnce(force).finally(() => { scouting = null; });
    return scouting;
  }

  async function approveFromTrustCenter(key: string): Promise<CouncilState> {
    const state = await load();
    const next = applyApprovedProposal(state, key, deps.now());
    await save(next);
    return next;
  }

  async function view() {
    const state = await load();
    return {
      ...state,
      overrides: applyLessons(state.debates, state.lessons),
      nextCycleInMs: state.lastCycleAt ? Math.max(0, Date.parse(state.lastCycleAt) + COUNCIL_CYCLE_MS - deps.now()) : 0,
      costUsd: 0,
    };
  }

  return { runCycle, runScout, approveFromTrustCenter, view, load };
}

// ---------- Real dependencies ----------

const DATA_DIR = process.env.AGENT_COUNCIL_DATA_DIR || path.join(process.cwd(), "agent_council_data");
const STATE_FILE = path.join(DATA_DIR, "state.json");

async function writeStateAtomic(raw: string) {
  await mkdir(DATA_DIR, { recursive: true });
  const tmp = `${STATE_FILE}.${process.pid}.tmp`;
  await writeFile(tmp, raw, "utf8");
  await rename(tmp, STATE_FILE);
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
  const docs = await safe("skills", () => readSkillDocs());
  const projects = await safe("app projects", () => storage.getAppProjects(userId));
  return {
    clippers: await safe("clippers", () => clippersRuntime.getClipperWorkerRuntimeStatus()),
    dropshipping: await safe("dropshipping", () => dropshipping.getDropshippingLaunchReadiness()),
    marketing: await safe("marketing", () => marketing.getMarketingCommandCenterSnapshot()),
    automationRuns: await safe("automation runs", () => storage.getAutomationRuns(userId, undefined, 50)),
    appProjects: projects?.map((app) => ({ id: app.id, name: app.name, status: app.status })),
    appIncidents: await safe("incidents", () => storage.getAppIncidents(userId)),
    skills: docs?.skills,
    skillsListedInClaudeMd: docs?.listedInClaudeMd,
    maxSkillBodyChars: docs?.maxBodyChars,
    // The Kong desks in the building have no backend of their own (see agents-office githubAppTeams).
    kongTeam: ["KONG AI", "Promoters + Mesas", "Venues", "Kong Legal"].map((name) => ({ name, hasBackend: false })),
  };
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
  if (String(env.AGENT_COUNCIL_ENABLED || "").trim().toLowerCase() === "false") {
    console.log("[agent-council] disabled by AGENT_COUNCIL_ENABLED=false");
    return;
  }
  const { getSystemUserId } = await import("./user-context");
  setAgentCouncilUser(getSystemUserId());
  const instance = getAgentCouncil();
  const tick = () => {
    void instance.runCycle();
    void instance.runScout();
  };
  setTimeout(tick, 60_000).unref?.();
  setInterval(tick, COUNCIL_CYCLE_MS).unref?.();
}

export { emptyCouncilState };
