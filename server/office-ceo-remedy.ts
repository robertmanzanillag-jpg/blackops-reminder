import { createHash } from "node:crypto";
import type { CompanyOrder, CompanyState } from "../shared/agent-company";

/** CEO remediation loop (deterministic, $0 AI).
 *
 * Every office cycle the CEO looks at each agent that is blocked, needs
 * attention or whose council is off, classifies the cause and owns it:
 *   code_bug            -> one bounded, deduped company order for an engineering role
 *   config (auto)       -> applied by the system (recorded as auto-fixed)
 *   missing_integration -> one consolidated line in the daily "Pendientes de Robert"
 *   stale_source        -> the cycle re-warms sources; escalated if still stale after 24 h
 * The daily list is sent at most once per UTC day, deduped by content; a line
 * that clears is announced once as "resuelto". Nothing here posts, spends,
 * merges or deploys. */

export const CEO_REMEDY_MAX_OPEN_ORDERS = 3;
export const CEO_REMEDY_MAX_ORDERS_PER_DAY = 2;
export const CEO_REMEDY_STALE_ESCALATE_MS = 24 * 3600_000;
export const CEO_REMEDY_COUNCIL_STALE_MS = 45 * 60_000;
const MAX_ITEMS = 60;

export type RemedyCause = "code_bug" | "missing_integration" | "config" | "stale_source";
export type RemedyAction = "factory_order" | "auto_fixed" | "robert" | "rewarm";
export type RemedyIssue = { key: string; agent: string; company: "main" | "kong"; cause: RemedyCause; codes: string[]; detail?: string };
export type RemedyItem = RemedyIssue & { action: RemedyAction; line?: string; orderId?: string; since: string; updatedAt: string };
export type CeoRemedyState = {
  version: 1;
  items: RemedyItem[];
  /** Keys already shown in the last sent digest, and lines cleared since then. */
  digest: { lastSentDay: string | null; lastSentHash: string | null; shownKeys: string[]; resolved: Array<{ key: string; line: string; at: string }> };
  ordersToday: { day: string; count: number };
  /** Outbox: one daily message waiting for a process that can deliver it. */
  outbox: { day: string; text: string; hash: string } | null;
  updatedAt: string | null;
};

export function emptyCeoRemedy(): CeoRemedyState {
  return { version: 1, items: [], digest: { lastSentDay: null, lastSentHash: null, shownKeys: [], resolved: [] }, ordersToday: { day: "", count: 0 }, outbox: null, updatedAt: null };
}

/** Advisory journal: a malformed one is replaced by an empty one, never bricking the cycle. */
export function parseCeoRemedy(value: unknown): CeoRemedyState {
  const v = value as CeoRemedyState | undefined;
  if (!v || v.version !== 1 || !Array.isArray(v.items) || !v.digest || !Array.isArray(v.digest.shownKeys) || !Array.isArray(v.digest.resolved) || !v.ordersToday) return emptyCeoRemedy();
  return { ...emptyCeoRemedy(), ...v, items: v.items.slice(0, MAX_ITEMS), digest: { ...v.digest, resolved: v.digest.resolved.slice(-MAX_ITEMS) } };
}

const digest = (parts: unknown) => createHash("sha256").update(JSON.stringify(parts)).digest("hex");
const day = (now: number) => new Date(now).toISOString().slice(0, 10);

// Honesty markers: they describe evidence limits, not a fault to repair.
const INFORMATIONAL = new Set(["PLANS_NOT_EXECUTION", "COLLECTED_METRICS_ONLY", "PARTIAL_COVERAGE", "RECORDED_BLOCKS", "DOCUMENT_REVIEW_REQUIRED", "MARKET_VALUE_UNVERIFIED", "NO_CURRENT_SESSION_PROOF"]);
const MISSING = new Set(["SOURCE_MISSING", "NO_RECORDS", "NO_SOURCE_RECORDS", "EXPORT_MISSING"]);
const STALE = new Set(["SOURCE_STALE", "SOURCE_LIMIT", "SOURCE_TIME_UNKNOWN", "EXPORT_INVALID_OR_STALE"]);
const CONFIG = new Set(["CAPABILITY_UNAVAILABLE", "SOURCE_UNAVAILABLE"]);

/** What Robert must do, per role, when its source has no records. Exact and short. */
const ROBERT_LINES: Record<string, string> = {
  control: "Control: no hay permisos del asistente guardados (assistant_permissions vacío). Defínelos en el panel → Control/Permisos.",
  revenue: "Revenue: no hay ventas ni cobros registrados. Registra la primera venta o conecta la fuente de pagos en Revenue Engine.",
  dropshipping: "Dropshipping: no hay productos/proveedores TikTok Shop cargados. Carga el catálogo y proveedores en el panel de Dropshipping.",
  clippers: "Clippers: las métricas de clips están vencidas. Deja corriendo el worker de clips (Mac: clippers-reconcile-publications) o el lane cloud de clippers.",
  "marketing-cmo": "Marketing CMO: las métricas de Metricool están vencidas. Revisa la conexión de Metricool en BlackOps.",
  "blackroom-videos": "Black Room videos: sin resultados recientes del worker externo. Enciende el worker de videos de Black Room.",
};
const CONFIG_LINES: Record<string, string> = {
  CAPABILITY_UNAVAILABLE: "este rol no tiene lector configurado en el worker (variable OFFICE_WEB_SOURCES_ENABLED / OFFICE_ROLE_WORK_ENABLED del repo).",
  SOURCE_UNAVAILABLE: "la lectura canónica falló; revisa OFFICE_DATABASE_URL y OFFICE_WEB_SOURCE_ORIGIN del worker.",
};

export type RoleSummary = { role: string; status: string; reason?: string | null; codes: string[] };

/** Pure classification of one blocked office role. Returns undefined when nothing needs owning. */
export function classifyRole(role: RoleSummary): RemedyIssue | undefined {
  if (role.status !== "blocked") return undefined;
  const codes = [...new Set(role.codes)].filter(c => !INFORMATIONAL.has(c)).sort();
  const base = { key: `main:${role.role}`, agent: role.role, company: "main" as const, codes };
  if (role.reason === "web_export_unverified") return { ...base, cause: "code_bug", codes: [...codes, "WEB_EXPORT_UNVERIFIED"] };
  if (codes.some(c => CONFIG.has(c))) return { ...base, cause: "config" };
  if (codes.some(c => MISSING.has(c)) || role.reason === "web_export_missing") return { ...base, cause: "missing_integration" };
  if (codes.some(c => STALE.has(c))) return { ...base, cause: "stale_source" };
  if (role.reason === "source_unavailable") return { ...base, cause: "config", codes: [...codes, "SOURCE_UNAVAILABLE"] };
  // Blocked with codes we do not recognize: the audit itself is inconsistent -> engineering.
  return { ...base, cause: "code_bug", codes: codes.length ? codes : ["BLOCKED_WITHOUT_FINDING"] };
}

export type CouncilSummary = { webEnabled: boolean; lastCycleAt: string | null; lastCycleError?: string | null };

/** The council is off only when no process ran a round recently. A web flag set to false is
 * the intended split (rounds run in the office worker), not an outage. */
export function councilRunning(c: CouncilSummary, now: number): boolean {
  return c.webEnabled || (!!c.lastCycleAt && now - Date.parse(c.lastCycleAt) <= CEO_REMEDY_COUNCIL_STALE_MS);
}
export function classifyCouncil(c: CouncilSummary, now: number): RemedyIssue | undefined {
  if (c.lastCycleError) return { key: "main:council", agent: "mechanic", company: "main", cause: "code_bug", codes: ["COUNCIL_CYCLE_FAILED"] };
  if (councilRunning(c, now)) return undefined;
  return { key: "main:council", agent: "mechanic", company: "main", cause: "config", codes: ["COUNCIL_NO_RECENT_ROUND"] };
}

export type KongAgentSummary = { id: string; name: string; state: string; blocker?: string | null };
/** KONG desks in "attention". KONG code is fixed through KONG's own repo, never this factory. */
export function classifyKong(agent: KongAgentSummary): RemedyIssue | undefined {
  if (agent.state !== "attention") return undefined;
  const blocker = String(agent.blocker || "").slice(0, 160);
  const failed = /falló|fallaron|bugs activos/i.test(blocker);
  return { key: `kong:${agent.id}`, agent: agent.name.slice(0, 60), company: "kong", cause: failed ? "code_bug" : "missing_integration", codes: [failed ? "KONG_RUN_FAILED" : "KONG_ATTENTION"], detail: blocker };
}

function robertLine(issue: RemedyIssue): string {
  if (issue.company === "kong") return `KONG · ${issue.agent}: ${issue.detail || "requiere atención"}. Repararlo en kong-nightlife (KONG no usa la fábrica de BlackOps).`;
  if (issue.key === "main:council") return "Consejo: no hay rondas en los últimos 45 min. Confirma la variable del repo OFFICE_WORKER_CLOUD_ENABLED=true (el consejo corre en office-worker-cloud; en Replit AGENT_COUNCIL_ENABLED=false es intencional).";
  if (issue.cause === "config") { const code = issue.codes.find(c => CONFIG_LINES[c]) || "SOURCE_UNAVAILABLE"; return `${issue.agent}: ${CONFIG_LINES[code]}`; }
  return ROBERT_LINES[issue.agent] || `${issue.agent}: la fuente de datos no tiene registros (${issue.codes.join(", ")}). Conecta o carga esa fuente.`;
}

/** Order text is a fixed template (no free text), <500 chars, never mentions KONG. */
export function remedyOrderText(issue: RemedyIssue): string {
  return `Orden del CEO (remediación automática): el agente "${issue.agent}" está bloqueado por un fallo de código (${issue.codes.join(", ")}). Encontrar la causa en este repo, corregirla con una prueba de regresión y abrir un PR borrador. No desplegar ni fusionar.`.slice(0, 480);
}

export function planCeoRemedy(input: { state: unknown; company: CompanyState; roles: RoleSummary[]; council?: CouncilSummary; kong?: KongAgentSummary[]; now: number }):
  { state: CeoRemedyState; company: CompanyState; created: CompanyOrder[] } {
  const state = parseCeoRemedy(input.state);
  const iso = new Date(input.now).toISOString(), today = day(input.now);
  const issues: RemedyIssue[] = [
    ...input.roles.map(classifyRole),
    ...(input.council ? [classifyCouncil(input.council, input.now)] : []),
    ...(input.kong ?? []).map(classifyKong),
  ].filter((i): i is RemedyIssue => Boolean(i)).slice(0, MAX_ITEMS);
  const previous = new Map(state.items.map(i => [i.key, i]));
  let orders = [...input.company.orders];
  const created: CompanyOrder[] = [];
  const ordersToday = state.ordersToday.day === today ? { ...state.ordersToday } : { day: today, count: 0 };
  const openRemedy = () => orders.filter(o => !o.doneAt && o.id.startsWith("ord-ceo-")).length;
  const items: RemedyItem[] = [];
  for (const issue of issues) {
    const prior = previous.get(issue.key);
    const since = prior && prior.cause === issue.cause ? prior.since : iso;
    let item: RemedyItem = { ...issue, action: "robert", since, updatedAt: iso };
    if (issue.cause === "code_bug" && issue.company === "main") {
      const id = `ord-ceo-${digest([issue.key, issue.codes]).slice(0, 20)}`;
      const existing = orders.find(o => o.id === id);
      if (existing && !existing.doneAt) item = { ...item, action: "factory_order", orderId: id };
      else if (!existing && openRemedy() < CEO_REMEDY_MAX_OPEN_ORDERS && ordersToday.count < CEO_REMEDY_MAX_ORDERS_PER_DAY) {
        const order: CompanyOrder = { id, text: remedyOrderText(issue), createdAt: iso,
          assignees: [{ agentId: "code", status: "en_curso", note: "Orden del sistema (CEO). Solo puede terminar en un PR borrador revisado; fusionar es decisión del dueño." }] };
        orders = [...orders, order]; created.push(order); ordersToday.count++;
        item = { ...item, action: "factory_order", orderId: id };
      } else item = { ...item, line: `${issue.agent}: fallo de código (${issue.codes.join(", ")}); la fábrica ya tiene su cupo de órdenes del CEO o la orden anterior se cerró sin arreglo. Revisa la orden ${id}.` };
    } else if (issue.cause === "stale_source" && input.now - Date.parse(since) < CEO_REMEDY_STALE_ESCALATE_MS) {
      item = { ...item, action: "rewarm" };
    } else {
      item = { ...item, line: robertLine(issue) };
    }
    items.push(item);
  }
  // Lines that were shown to Robert and are gone now are announced once as resolved.
  const live = new Set(items.filter(i => i.line).map(i => i.key));
  const resolved = [...state.digest.resolved];
  for (const key of state.digest.shownKeys) if (!live.has(key) && !resolved.some(r => r.key === key)) {
    const was = previous.get(key);
    resolved.push({ key, line: was?.line ? was.line.split(":")[0] : key, at: iso });
  }
  let next: CeoRemedyState = { ...state, items, ordersToday, digest: { ...state.digest, resolved: resolved.slice(-MAX_ITEMS) }, updatedAt: iso };
  next = queueDailyDigest(next, input.now);
  return { state: next, company: { ...input.company, orders }, created };
}

export function digestText(state: CeoRemedyState): string {
  const pending = state.items.filter(i => i.line);
  const auto = state.items.filter(i => !i.line);
  const lines = ["Pendientes de Robert (CEO BlackOps)"];
  if (pending.length) lines.push(...pending.map(i => `• ${i.line}`)); else lines.push("• Nada pendiente de tu parte hoy.");
  if (state.digest.resolved.length) lines.push("", "Resuelto:", ...state.digest.resolved.map(r => `✓ ${r.line} — resuelto`));
  if (auto.length) lines.push("", `El CEO se encarga solo de ${auto.length}: ${auto.map(i => `${i.agent} (${i.action === "factory_order" ? "orden a ingeniería" : i.action === "rewarm" ? "refrescando fuente" : "corregido"})`).join(", ")}.`);
  return lines.join("\n").slice(0, 3500);
}

/** At most one message per UTC day; none when nothing changed since the last one sent. */
export function queueDailyDigest(state: CeoRemedyState, now: number): CeoRemedyState {
  const today = day(now);
  if (state.digest.lastSentDay === today) return state;
  const pending = state.items.filter(i => i.line);
  if (!pending.length && !state.digest.resolved.length) return { ...state, outbox: null };
  const hash = digest([pending.map(i => [i.key, i.line]), state.digest.resolved.map(r => r.key)]);
  if (hash === state.digest.lastSentHash) return { ...state, outbox: null };
  return { ...state, outbox: { day: today, text: digestText(state), hash } };
}

/** Called after a successful delivery: records what Robert has seen. */
export function markDigestSent(state: CeoRemedyState, sent: { day: string; hash: string }): CeoRemedyState {
  if (!state.outbox || state.outbox.hash !== sent.hash) return state;
  return { ...state, outbox: null, digest: { lastSentDay: sent.day, lastSentHash: sent.hash, shownKeys: state.items.filter(i => i.line).map(i => i.key), resolved: [] } };
}

/** Latest audit per role -> compact summary (codes only). */
export function summarizeRoleWork(roleWork: unknown): RoleSummary[] {
  const jobs = (roleWork as { jobs?: Array<{ role: string; slot: string; status: string; reason?: string; audit?: { findings?: Array<{ code: string }> }; webAudit?: { diagnostics?: string[] } }> } | undefined)?.jobs;
  if (!Array.isArray(jobs)) return [];
  const latest = new Map<string, (typeof jobs)[number]>();
  for (const job of jobs) if (job.status !== "running" && (!latest.get(job.role) || latest.get(job.role)!.slot <= job.slot)) latest.set(job.role, job);
  return [...latest.values()].map(job => ({ role: job.role, status: job.status, reason: job.reason ?? null,
    codes: job.webAudit?.diagnostics ? [...job.webAudit.diagnostics] : (job.audit?.findings ?? []).map(f => f.code) }));
}

export type RemedyCouncil = { updateOfficeExecution(change: (execution: any, company: CompanyState) => any): Promise<any> };
export function createCeoRemedyRunner(options: { council: RemedyCouncil; readCouncil?: () => Promise<CouncilSummary | undefined>; readKong?: () => Promise<KongAgentSummary[]>;
  deliver?: (text: string) => Promise<boolean>; now?: () => number }) {
  const now = options.now || Date.now;
  let active: Promise<{ created: number; sent: boolean }> | undefined;
  const tick = async () => {
    const at = now();
    const [council, kong] = await Promise.all([options.readCouncil?.().catch(() => undefined), options.readKong?.().catch(() => undefined)]);
    let created = 0, outbox: CeoRemedyState["outbox"] = null;
    await options.council.updateOfficeExecution((execution, company) => {
      const result = planCeoRemedy({ state: execution.ceoRemedy, company, roles: summarizeRoleWork(execution.roleWork), council, kong, now: at });
      created = result.created.length; outbox = result.state.outbox;
      Object.assign(company, { orders: result.company.orders });
      return { ...execution, ceoRemedy: result.state };
    });
    let sent = false;
    const box = outbox as CeoRemedyState["outbox"];
    if (box && options.deliver && await options.deliver(box.text).catch(() => false)) {
      await options.council.updateOfficeExecution(execution => ({ ...execution, ceoRemedy: markDigestSent(parseCeoRemedy(execution.ceoRemedy), box) }));
      sent = true;
    }
    return { created, sent };
  };
  return { tick: () => active ||= tick().finally(() => { active = undefined; }) };
}

/** Public view for the panel and office-status: codes, agents and actions only. */
export function ceoRemedyView(value: unknown) {
  const s = parseCeoRemedy(value);
  return { updatedAt: s.updatedAt, items: s.items.map(i => ({ agent: i.agent, company: i.company, cause: i.cause, action: i.action, codes: i.codes, ...(i.line ? { line: i.line } : {}), ...(i.orderId ? { orderId: i.orderId } : {}) })),
    digest: { lastSentDay: s.digest.lastSentDay, pendingDelivery: Boolean(s.outbox), resolved: s.digest.resolved.length } };
}
