import { createHash } from "node:crypto";
import { z } from "zod";
import { CLAUDE_CODE_FOOTER, redactForGithub, type MirrorStore } from "./kong-mirror-lab";
import { DEFAULT_MIRROR_RUN_MINUTES, KONG_IMPROVEMENT_REPOSITORY, type MirrorWorkflowRun } from "./kong-improvement-scouts";

/**
 * Codex + Claude on KONG improvements. ONE shared work record per improvement (issue → branch → PR in
 * kong-nightlife): both agents work in the open, so each sees the other's commits, comments and Mirror Lab
 * reports. A lease per item says who holds it; the other agent only takes over after a timeout, a
 * usage/credit-limit reply, or Robert's "Cambiar a …" button. Never both at once.
 * Codex = Robert's ChatGPT/Codex subscription ($0 here). Claude = the claude-code-action in kong-nightlife,
 * billed to Anthropic directly, so BlackOps keeps its own estimate and a monthly cap.
 */
export type KongAgent = "codex" | "claude";
export const AGENT_LABEL: Record<KongAgent, string> = { codex: "Codex", claude: "Claude" };
export const otherAgent = (agent: KongAgent): KongAgent => agent === "codex" ? "claude" : "codex";
export const KONG_CLAUDE_WORKFLOW = "claude.yml";
export const HANDOFF_TICK_MS = 15 * 60 * 1000;
export const MAX_AUTO_ATTEMPTS = 4;
const DISPATCH_LEASE_MS = 2 * 60 * 1000;
const LIMIT_COOLDOWN_MS = 12 * 60 * 60 * 1000;
export const CLAUDE_NO_BUDGET = "Claude sin presupuesto este mes";

const num = (raw: string | undefined, fallback: number, min: number, max: number, invalid = fallback) => {
  if (raw === undefined || raw.trim() === "") return fallback;
  const value = Number(raw);
  return Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : invalid;
};
export const resolvePrimaryAgent = (env: NodeJS.ProcessEnv = process.env): KongAgent =>
  (env.KONG_IMPROVEMENT_PRIMARY_AGENT || "").trim().toLowerCase() === "claude" ? "claude" : "codex";
export const resolveAgentTimeoutHours = (env: NodeJS.ProcessEnv = process.env) => num(env.KONG_IMPROVEMENT_AGENT_TIMEOUT_HOURS, 3, 0.25, 72);
/** Default $30, clamped 0..100; an unreadable value fails closed ($0 = no Claude dispatch). */
export const resolveClaudeMonthlyUsd = (env: NodeJS.ProcessEnv = process.env) => num(env.KONG_IMPROVEMENT_CLAUDE_MONTHLY_USD, 30, 0, 100, 0);
export const resolveClaudeUsdPerDispatch = (env: NodeJS.ProcessEnv = process.env) => num(env.KONG_IMPROVEMENT_CLAUDE_USD_PER_DISPATCH, 2, 0, 50);
export const resolveClaudeUsdPerMinute = (env: NodeJS.ProcessEnv = process.env) => num(env.KONG_IMPROVEMENT_CLAUDE_USD_PER_MINUTE, 0.1, 0, 5);

const fold = (value: string) => value.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
/** Usage-limit / credit wording (English + Spanish), matched only on comments from the agent's own bot. */
const LIMIT_WORDING = /(usage limit|rate limit|out of credit|credit balance|insufficient (credit|quota|funds)|quota exceeded|exceeded your (current )?quota|limite)/;
export const isLimitReply = (body: string) => LIMIT_WORDING.test(fold(body));
/**
 * Which agent wrote a comment. The exact Codex Cloud bot login is not recorded anywhere in this repo, so it
 * is configurable (KONG_CODEX_BOT_LOGINS / KONG_CLAUDE_BOT_LOGINS, comma separated); otherwise any login
 * containing "codex" / "claude" (e.g. a `…codex…[bot]` app) counts. Robert/BlackOps comments never match.
 */
export function agentForLogin(login: string, env: NodeJS.ProcessEnv = process.env): KongAgent | null {
  const name = login.trim().toLowerCase();
  const list = (raw?: string) => (raw || "").split(",").map(item => item.trim().toLowerCase()).filter(Boolean);
  if (list(env.KONG_CODEX_BOT_LOGINS).includes(name)) return "codex";
  if (list(env.KONG_CLAUDE_BOT_LOGINS).includes(name)) return "claude";
  if (/codex/.test(name)) return "codex";
  if (/claude/.test(name)) return "claude";
  return null;
}

// ---- Claude spend estimate (always from $0 each month) ----
export function estimateClaudeSpend(dispatchAts: string[], runs: MirrorWorkflowRun[], now: number, env: NodeJS.ProcessEnv = process.env) {
  const capUsd = resolveClaudeMonthlyUsd(env), perDispatchUsd = resolveClaudeUsdPerDispatch(env), usdPerMinute = resolveClaudeUsdPerMinute(env);
  const date = new Date(now), start = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1), end = Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1);
  const inMonth = (at: number) => at >= start && at < end;
  const dispatches = dispatchAts.filter(at => inMonth(Date.parse(at))).length;
  const minutes = runs.filter(run => inMonth(Date.parse(run.runStartedAt || run.createdAt))).reduce((sum, run) => {
    const s = Date.parse(run.runStartedAt || ""), e = Date.parse(run.updatedAt || "");
    return sum + (run.status === "completed" && Number.isFinite(s) && Number.isFinite(e) && e >= s ? Math.max(1, Math.ceil((e - s) / 60000)) : DEFAULT_MIRROR_RUN_MINUTES);
  }, 0);
  // Conservative: the larger of "dispatches × estimate" and "Action run minutes × rate".
  const spentUsd = Math.round(Math.max(dispatches * perDispatchUsd, minutes * usdPerMinute) * 100) / 100;
  const paused = capUsd <= 0 || spentUsd + perDispatchUsd > capUsd;
  return { estimate: true as const, capUsd, spentUsd, perDispatchUsd, usdPerMinute, dispatches, runMinutes: minutes, paused,
    label: `Claude este mes: $${spentUsd.toFixed(2)} de $${capUsd} (estimado)`, pausedLabel: paused ? CLAUDE_NO_BUDGET : null };
}
export type ClaudeSpendEstimate = ReturnType<typeof estimateClaudeSpend>;

// ---- Comments ----
/** Neutralize @mentions in copied text so a summary never re-triggers an agent. */
const unmention = (value: string) => value.replace(/@(?=[A-Za-z0-9])/g, "(at)");
const clip = (value: string, max: number) => value.length > max ? `${value.slice(0, max - 1)}…` : value;
export const NEVER_AUTO_LINE = "Never touch payments/Stripe, auth/permissions, pricing, user messaging, database schema/deletes or legal pages; if the task needs any of them, stop and explain in a comment.";
export type AgentActivity = {
  commits: Array<{ sha: string; message: string; author: string; at: string }>;
  comments: Array<{ author: string; body: string; at: string; url?: string | null }>;
  prNumber: number | null; headSha: string | null;
};
export function buildHandoffSummary(previous: KongAgent, why: string, activity: AgentActivity, branch: string | null) {
  const commits = activity.commits.slice(-15).map(commit => `- ${commit.sha.slice(0, 7)} ${clip(unmention(redactForGithub(commit.message.split("\n")[0])), 120)} (${unmention(commit.author)})`);
  const comments = activity.comments.filter(comment => !comment.body.includes("blackops-dispatch:")).slice(-5)
    .map(comment => `- ${unmention(comment.author)}: ${clip(unmention(redactForGithub(comment.body.replace(/\s+/g, " "))), 300)}`);
  return [
    `Hand-off: ${AGENT_LABEL[previous]} was assigned before and ${why}. Continue its work${branch ? ` on \`${branch}\`` : ""}; do not restart from scratch and do not discard its commits.`,
    `What ${AGENT_LABEL[previous]} already did:`,
    "Commits:", ...(commits.length ? commits : ["- (none yet)"]),
    "Last comments:", ...(comments.length ? comments : ["- (none yet)"]),
  ].join("\n");
}
export function buildDispatchComment(input: { agent: KongAgent; dispatchId: string; task: string; handoff?: string | null }) {
  const scrub = (value: string) => value.replace(/@(codex|claude)\b/gi, (_m, name: string) => AGENT_LABEL[name.toLowerCase() as KongAgent]);
  return [
    `@${input.agent} ${scrub(input.task)}`,
    "",
    `<!-- blackops-dispatch:${input.dispatchId} agent:${input.agent} -->`,
    ...(input.handoff ? [scrub(input.handoff), ""] : []),
    "Follow this repository's AGENTS.md. " + NEVER_AUTO_LINE,
    "Work only on this issue/PR and its branch; push your commits there so the other agent and the Mirror Lab can see them. Do not merge or deploy.",
  ].join("\n") + CLAUDE_CODE_FOOTER;
}

// ---- Ledger ----
const agentEnum = z.enum(["codex", "claude"]);
const attemptSchema = z.object({ dispatchId: z.string(), agent: agentEnum, at: z.string(), reason: z.enum(["primario", "timeout", "limite", "manual", "cambio", "presupuesto"]),
  commentUrl: z.string().nullable(), endedAt: z.string().nullable(), outcome: z.enum(["entregado", "sin respuesta", "sin crédito", "cambiado por Robert", "error al publicar"]).nullable() }).strict();
const itemSchema = z.object({
  key: z.string(), source: z.enum(["mejora", "pr"]), title: z.string(), repo: z.literal(KONG_IMPROVEMENT_REPOSITORY),
  issueNumber: z.number().int().positive().nullable(), prNumber: z.number().int().positive().nullable(), branch: z.string().nullable(),
  task: z.string(), neverAutoArea: z.string().nullable(), createdAt: z.string(), updatedAt: z.string(),
  holder: agentEnum.nullable(), phase: z.enum(["dispatching", "working", "delivered", "waiting"]), waitingReason: z.string().nullable(),
  lastLimitAt: z.object({ codex: z.string().optional(), claude: z.string().optional() }).strict().default({}),
  attempts: z.array(attemptSchema).default([]),
}).strict();
const ledgerSchema = z.object({ version: z.literal(1), items: z.array(itemSchema), claudeDispatches: z.array(z.object({ at: z.string(), dispatchId: z.string(), itemKey: z.string() }).strict()),
  lastTickAt: z.string().nullable() }).strict();
export type HandoffItem = z.infer<typeof itemSchema>;
type Ledger = z.infer<typeof ledgerSchema>;
type Attempt = z.infer<typeof attemptSchema>;

export interface HandoffGithub {
  comment(repo: string, issueOrPr: number, body: string): Promise<{ url?: string | null } | void>;
  /** Commits on the item's branch/PR and comments on its issue and PR since `sinceIso`; also finds the PR by branch/key. */
  readActivity(repo: string, target: { issueNumber: number | null; prNumber: number | null; branch: string | null; key: string }, sinceIso: string): Promise<AgentActivity>;
  listClaudeRuns(repo: string, workflow: string, sinceIso: string): Promise<MirrorWorkflowRun[]>;
}

const REASON_LABEL: Record<Attempt["reason"], string> = { primario: "asignado como principal", timeout: "relevo por falta de respuesta", limite: "relevo por límite de uso o crédito",
  manual: "cambiado por Robert", cambio: "cambio pedido por Robert", presupuesto: "relevo porque Claude no tenía presupuesto" };

export function createKongAgentHandoff(options: { owner: string; store: MirrorStore; now: () => number; env?: NodeJS.ProcessEnv; github: HandoffGithub;
  /** The $20 Mirror Lab budget: when paused, scout items get no automatic fallback (Robert's requests still go). */
  mirrorPaused?: () => Promise<boolean> }) {
  const env = options.env || process.env;
  const repo = KONG_IMPROVEMENT_REPOSITORY;
  const namespace = JSON.stringify(["kong-agent-handoff-v1", options.owner]);
  const iso = () => new Date(options.now()).toISOString();
  const parse = (raw: string | null): Ledger => raw ? ledgerSchema.parse(JSON.parse(raw)) : { version: 1, items: [], claudeDispatches: [], lastTickAt: null };
  async function mutate<T>(change: (ledger: Ledger) => T): Promise<T> {
    let out!: T;
    await options.store.transact(namespace, async raw => { const ledger = parse(raw); out = change(ledger); ledger.claudeDispatches = ledger.claudeDispatches.slice(-500); return JSON.stringify(ledgerSchema.parse(ledger)); });
    return out;
  }

  async function claudeBudget() {
    const ledger = parse(await options.store.read(namespace));
    const date = new Date(options.now()), since = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1)).toISOString();
    let runs: MirrorWorkflowRun[] = [];
    try { runs = await options.github.listClaudeRuns(repo, KONG_CLAUDE_WORKFLOW, since); } catch { runs = []; /* the dispatch count still applies */ }
    return estimateClaudeSpend(ledger.claudeDispatches.map(row => row.at), runs, options.now(), env);
  }
  const limitedRecently = (item: HandoffItem, agent: KongAgent) => { const at = Date.parse(item.lastLimitAt[agent] || ""); return Number.isFinite(at) && options.now() - at < LIMIT_COOLDOWN_MS; };
  const targetNumber = (item: HandoffItem) => item.prNumber || item.issueNumber;

  /**
   * Claim → post → confirm. The claim (inside the store transaction) refuses when another dispatch is in flight,
   * so two ticks or a double click never post twice; the Claude estimate is reserved in the same claim.
   */
  async function dispatch(key: string, agent: KongAgent, reason: Attempt["reason"], handoff: string | null, endPrevious: Attempt["outcome"] | null) {
    const budget = agent === "claude" ? await claudeBudget() : null;
    const claim = await mutate(ledger => {
      const item = ledger.items.find(row => row.key === key);
      if (!item) return { error: "MISSING" as const };
      if (item.neverAutoArea) return { error: "NEVER_AUTO" as const };
      if (item.phase === "dispatching" && options.now() - Date.parse(item.updatedAt) < DISPATCH_LEASE_MS) return { error: "IN_FLIGHT" as const };
      if (budget?.paused) return { error: "CLAUDE_BUDGET" as const };
      const previous = item.attempts[item.attempts.length - 1];
      if (previous && !previous.endedAt) { previous.endedAt = iso(); previous.outcome = endPrevious || previous.outcome || "cambiado por Robert"; }
      const dispatchId = createHash("sha256").update(JSON.stringify([key, item.attempts.length, agent, reason])).digest("hex").slice(0, 16);
      item.attempts.push({ dispatchId, agent, at: iso(), reason, commentUrl: null, endedAt: null, outcome: null });
      item.holder = agent; item.phase = "dispatching"; item.waitingReason = null; item.updatedAt = iso();
      if (agent === "claude") ledger.claudeDispatches.push({ at: iso(), dispatchId, itemKey: key });
      return { dispatchId, target: targetNumber(item), task: item.task };
    });
    if ("error" in claim) return { ok: false as const, code: claim.error };
    let url: string | null = null, failed = !claim.target;
    if (claim.target) {
      try { const posted = await options.github.comment(repo, claim.target, buildDispatchComment({ agent, dispatchId: claim.dispatchId, task: claim.task, handoff })); url = posted && posted.url ? posted.url : null; }
      catch { failed = true; }
    }
    await mutate(ledger => {
      const item = ledger.items.find(row => row.key === key)!;
      const attempt = item.attempts.find(row => row.dispatchId === claim.dispatchId)!;
      if (failed) {
        attempt.endedAt = iso(); attempt.outcome = "error al publicar";
        item.holder = null; item.phase = "waiting"; item.waitingReason = "No pude publicar el encargo en GitHub; lo reintento en la próxima revisión.";
        ledger.claudeDispatches = ledger.claudeDispatches.filter(row => row.dispatchId !== claim.dispatchId);
      } else { attempt.commentUrl = url; item.phase = "working"; }
      item.updatedAt = iso();
    });
    return failed ? { ok: false as const, code: "NOT_POSTED" as const } : { ok: true as const, agent, dispatchId: claim.dispatchId, url };
  }

  /** Primary unless it hit a limit recently; Claude only with budget. `null` = nobody can take it now. */
  async function choose(item: HandoffItem): Promise<{ agent: KongAgent | null; reason: string | null }> {
    const primary = resolvePrimaryAgent(env);
    const order: KongAgent[] = limitedRecently(item, primary) ? [otherAgent(primary), primary] : [primary, otherAgent(primary)];
    let reason: string | null = null;
    for (const agent of order) {
      if (limitedRecently(item, agent)) { reason ||= `${AGENT_LABEL[agent]} sin crédito por ahora`; continue; }
      if (agent === "claude" && (await claudeBudget()).paused) { reason = CLAUDE_NO_BUDGET; continue; }
      return { agent, reason: null };
    }
    return { agent: null, reason };
  }

  async function upsert(input: { key: string; source: HandoffItem["source"]; title: string; issueNumber?: number | null; prNumber?: number | null; branch?: string | null; task: string; neverAutoArea?: string | null }) {
    return mutate(ledger => {
      let item = ledger.items.find(row => row.key === input.key);
      if (!item) {
        item = { key: input.key, source: input.source, title: clip(input.title, 200), repo, issueNumber: input.issueNumber ?? null, prNumber: input.prNumber ?? null, branch: input.branch ?? null,
          task: input.task, neverAutoArea: input.neverAutoArea ?? null, createdAt: iso(), updatedAt: iso(), holder: null, phase: "waiting", waitingReason: null, lastLimitAt: {}, attempts: [] };
        ledger.items.push(item);
        ledger.items = ledger.items.slice(-300);
      } else {
        item.task = input.task;
        if (input.prNumber) item.prNumber = input.prNumber;
        if (input.issueNumber) item.issueNumber = input.issueNumber;
      }
      return { ...item };
    });
  }

  /** A new scout improvement (issue already created): dispatch to the primary, fallback only when needed. */
  async function start(input: { key: string; title: string; issueNumber: number; branch: string; task: string; neverAutoArea?: string | null }) {
    const item = await upsert({ ...input, source: "mejora" });
    if (item.neverAutoArea) return { ok: false as const, code: "NEVER_AUTO" as const };
    if (item.holder && item.phase !== "waiting") return { ok: true as const, duplicate: true, agent: item.holder };
    const pick = await choose(item);
    if (!pick.agent) { await mutate(ledger => { const row = ledger.items.find(r => r.key === item.key)!; row.waitingReason = pick.reason; row.updatedAt = iso(); }); return { ok: false as const, code: "WAITING" as const, reason: pick.reason }; }
    return dispatch(item.key, pick.agent, "primario", null, null);
  }

  /** Robert's change request on a KONG PR. Goes to whoever holds a live lease; else primary, fallback only when needed. Never blocked. */
  async function requestChange(input: { prNumber: number; title: string; task: string }) {
    const ledger = parse(await options.store.read(namespace));
    const existing = ledger.items.find(row => row.prNumber === input.prNumber);
    const item = await upsert({ key: existing?.key || `kong-pr:${input.prNumber}`, source: existing?.source || "pr", title: existing?.title || input.title, prNumber: input.prNumber, task: input.task });
    let agent: KongAgent;
    if (item.holder && (item.phase === "working" || item.phase === "dispatching")) agent = item.holder;
    else agent = (await choose(item)).agent || "codex"; // nobody free: Codex ($0, Robert's subscription) still gets his request
    if (agent === "claude" && (await claudeBudget()).paused) agent = "codex";
    const result = await dispatch(item.key, agent, "cambio", null, "cambiado por Robert");
    if (!result.ok) throw new Error(`HANDOFF_${result.code}`);
    return { url: result.url, agent };
  }

  async function handOff(item: HandoffItem, why: "timeout" | "limite", activity: AgentActivity | null) {
    const from = item.holder!, to = otherAgent(from);
    const auto = item.attempts.filter(row => row.reason !== "manual" && row.reason !== "cambio").length;
    const mark = (reason: string, release: boolean) => mutate(ledger => {
      const row = ledger.items.find(r => r.key === item.key)!;
      if (why === "limite") row.lastLimitAt[from] = iso();
      if (release) { const last = row.attempts[row.attempts.length - 1]; if (last && !last.endedAt) { last.endedAt = iso(); last.outcome = why === "limite" ? "sin crédito" : "sin respuesta"; } row.holder = null; row.phase = "waiting"; }
      row.waitingReason = reason; row.updatedAt = iso();
    });
    if (auto >= MAX_AUTO_ATTEMPTS) return mark("Ningún agente terminó tras varios relevos; usa «Cambiar a …» para reintentar.", why === "limite");
    if (item.source === "mejora" && options.mirrorPaused && await options.mirrorPaused().catch(() => true)) return mark("Relevo en pausa por el presupuesto del Mirror Lab", why === "limite");
    if (to === "claude" && (await claudeBudget()).paused) return mark(CLAUDE_NO_BUDGET, why === "limite"); // a slow Codex keeps the item; a limited one is released
    if (why === "limite") await mutate(ledger => { ledger.items.find(r => r.key === item.key)!.lastLimitAt[from] = iso(); });
    // dispatch() ends the previous attempt and moves the lease to `to` in one claim: never both at once.
    const hours = resolveAgentTimeoutHours(env);
    const summary = buildHandoffSummary(from, why === "limite" ? "reported a usage/credit limit" : `did not push a commit or reply within ${hours} h`, activity || { commits: [], comments: [], prNumber: null, headSha: null }, item.branch);
    return dispatch(item.key, to, why, summary, why === "limite" ? "sin crédito" : "sin respuesta");
  }

  /** Every 15 min ($0, GitHub reads only): delivered? limit reply? timeout? waiting item that can now start? */
  async function tick() {
    const ledger = parse(await options.store.read(namespace));
    const timeoutMs = resolveAgentTimeoutHours(env) * 3600_000;
    const results: Array<{ key: string; action: string }> = [];
    for (const item of ledger.items) {
      if (item.neverAutoArea || item.phase === "delivered") continue;
      if (item.phase === "waiting") {
        if (item.attempts.length && item.attempts.filter(row => row.reason !== "manual" && row.reason !== "cambio").length >= MAX_AUTO_ATTEMPTS) continue;
        if (item.source === "mejora" && options.mirrorPaused && await options.mirrorPaused().catch(() => true)) continue;
        const pick = await choose(item);
        if (pick.agent) { await dispatch(item.key, pick.agent, item.attempts.length ? (pick.agent === "claude" ? "presupuesto" : "primario") : "primario", null, null); results.push({ key: item.key, action: `dispatch:${pick.agent}` }); }
        continue;
      }
      // In flight: wait. Stale (a crash between claim and confirm): treat as working, so the timeout still applies.
      if (item.phase === "dispatching" && options.now() - Date.parse(item.updatedAt) < DISPATCH_LEASE_MS) continue;
      const attempt = item.attempts[item.attempts.length - 1];
      if (!attempt || !item.holder) continue;
      let activity: AgentActivity;
      try { activity = await options.github.readActivity(repo, { issueNumber: item.issueNumber, prNumber: item.prNumber, branch: item.branch, key: item.key }, item.createdAt); }
      catch { continue; }
      const since = Date.parse(attempt.at);
      if (activity.prNumber && activity.prNumber !== item.prNumber) await mutate(next => { next.items.find(r => r.key === item.key)!.prNumber = activity.prNumber; });
      const fresh = activity.comments.filter(comment => Date.parse(comment.at) >= since && agentForLogin(comment.author, env) === item.holder);
      if (fresh.some(comment => isLimitReply(comment.body))) { await handOff({ ...item, prNumber: activity.prNumber || item.prNumber }, "limite", activity); results.push({ key: item.key, action: "limit" }); continue; }
      if (activity.commits.some(commit => Date.parse(commit.at) >= since)) {
        await mutate(next => { const row = next.items.find(r => r.key === item.key)!; row.phase = "delivered"; row.waitingReason = null; const last = row.attempts[row.attempts.length - 1]; if (last && !last.endedAt) { last.endedAt = iso(); last.outcome = "entregado"; } row.updatedAt = iso(); });
        results.push({ key: item.key, action: "delivered" }); continue;
      }
      if (fresh.length) continue; // the agent replied: it is working
      if (options.now() - since >= timeoutMs) { await handOff({ ...item, prNumber: activity.prNumber || item.prNumber }, "timeout", activity); results.push({ key: item.key, action: "timeout" }); }
    }
    await mutate(next => { next.lastTickAt = iso(); });
    return results;
  }

  /** Robert's "Cambiar a Claude/Codex" button: forced switch with the context summary. Claude still needs budget. */
  async function switchTo(key: string, agent: unknown) {
    if (agent !== "codex" && agent !== "claude") return { ok: false as const, status: 400, code: "HANDOFF_AGENT", message: "Elige Codex o Claude." };
    const item = parse(await options.store.read(namespace)).items.find(row => row.key === key);
    if (!item) return { ok: false as const, status: 404, code: "HANDOFF_NOT_FOUND", message: "No encontré este trabajo." };
    if (item.neverAutoArea) return { ok: false as const, status: 409, code: "HANDOFF_NEVER_AUTO", message: `Esta mejora toca ${item.neverAutoArea}: ningún agente la hace sola; requiere tu decisión.` };
    if (item.holder === agent && (item.phase === "working" || item.phase === "dispatching")) return { ok: true as const, duplicate: true, agent };
    let activity: AgentActivity | null = null;
    try { activity = await options.github.readActivity(repo, { issueNumber: item.issueNumber, prNumber: item.prNumber, branch: item.branch, key: item.key }, item.createdAt); } catch { activity = null; }
    if (activity?.prNumber && activity.prNumber !== item.prNumber) await mutate(next => { next.items.find(r => r.key === key)!.prNumber = activity!.prNumber; });
    const previous = item.holder || item.attempts[item.attempts.length - 1]?.agent || null;
    const summary = previous && previous !== agent ? buildHandoffSummary(previous, "was switched by the owner", activity || { commits: [], comments: [], prNumber: null, headSha: null }, item.branch) : null;
    const result = await dispatch(key, agent, "manual", summary, "cambiado por Robert");
    if (result.ok) return { ok: true as const, duplicate: false, agent, url: result.url };
    const messages: Record<string, [number, string]> = { CLAUDE_BUDGET: [409, `${CLAUDE_NO_BUDGET}. Sigue con Codex o sube KONG_IMPROVEMENT_CLAUDE_MONTHLY_USD.`],
      IN_FLIGHT: [409, "Ya se está enviando un encargo para este trabajo; espera un momento."], NOT_POSTED: [502, "No pude publicar el encargo en GitHub. No se cambió nada; inténtalo de nuevo."] };
    const [status, message] = messages[result.code ?? ""] || [409, "No se pudo cambiar de agente."];
    return { ok: false as const, status, code: `HANDOFF_${result.code ?? "ERROR"}`, message };
  }

  function describe(item: HandoffItem) {
    const who = item.holder && item.phase !== "waiting" ? AGENT_LABEL[item.holder] : "esperando";
    const state = item.phase === "delivered" ? `${who} entregó cambios` : item.phase === "dispatching" ? `Enviando a ${who}…` : item.phase === "working" ? `${who} trabajando` : "esperando";
    return { ...item, who, statusLabel: item.waitingReason ? `${state} · ${item.waitingReason}` : state,
      attempts: item.attempts.map(row => ({ ...row, label: `${AGENT_LABEL[row.agent]} · ${REASON_LABEL[row.reason]}${row.outcome ? ` · ${row.outcome}` : ""}` })),
      switchTo: item.neverAutoArea ? null : otherAgent(item.holder || resolvePrimaryAgent(env)) };
  }
  async function view() {
    const ledger = parse(await options.store.read(namespace));
    const budget = await claudeBudget();
    return { primary: resolvePrimaryAgent(env), timeoutHours: resolveAgentTimeoutHours(env), claudeBudget: budget, lastTickAt: ledger.lastTickAt,
      items: [...ledger.items].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 60).map(describe) };
  }
  return { start, requestChange, tick, switchTo, view, claudeBudget };
}
export type KongAgentHandoff = ReturnType<typeof createKongAgentHandoff>;

let stopHandoffLoop: (() => void) | undefined;
export function startHandoffLoop(tick: () => Promise<unknown>, env: NodeJS.ProcessEnv = process.env) {
  if (stopHandoffLoop || env.KONG_AGENT_HANDOFF_ENABLED === "false") return;
  const run = () => { tick().catch(() => undefined); };
  const first = setTimeout(run, 90_000); first.unref();
  const timer = setInterval(run, HANDOFF_TICK_MS); timer.unref();
  stopHandoffLoop = () => { clearTimeout(first); clearInterval(timer); stopHandoffLoop = undefined; };
}
