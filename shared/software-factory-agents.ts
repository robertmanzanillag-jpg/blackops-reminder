// Pure, dependency-free derivation of the "who is working right now" board for the
// software factory. Inputs are persisted rows only (factory jobs, budget, API authority,
// owner orders, self-heal ledger). Nothing here invents activity: an agent without a
// persisted job is "en_espera" with "sin actividad registrada". No AI calls.

export type FactoryAgentState = "trabajando" | "en_espera" | "bloqueado";

export type FactoryAgentJob = {
  id: string; kind: string; status: string; createdAt: string; completedAt?: string;
  payload?: Record<string, unknown>; result?: unknown;
};
export type FactoryAgentOrder = { id: string; text: string; assignees: Array<{ agentId: string; status?: string }>; doneAt?: string; selfHeal?: unknown };

export type FactoryAgentRow = {
  id: string; label: string; group: "etapa" | "ingenieria" | "control";
  state: FactoryAgentState;
  /** Trabajando: current job. */
  current?: { jobId: string; stage: string; orderLabel: string | null; since: string; elapsedMinutes: number };
  queued: number;
  lastCompletedAt: string | null;
  /** Bloqueado: plain-Spanish reason from a safe reason code. */
  blocked?: { reason: string; code: string | null; at: string };
  detail?: string;
};

export const FACTORY_STAGE_AGENTS = [
  ["discover", "Selector de archivos (descubrir)"], ["build", "Constructor"], ["simulate", "QA simulada (usuarios)"],
  ["review", "Revisor independiente"], ["deploy", "Publicador"], ["verify", "Verificador de publicación"],
  ["rollback", "Recuperación de versión"], ["evaluate", "Evaluador de aprendizaje"],
] as const;
/** Mirrors the engineering roster that makes an order factory-eligible (server/software-factory-company.ts). */
export const FACTORY_ENGINEERING_AGENTS = [
  ["code", "Code"], ["github", "GitHub"], ["app-qa", "App QA"], ["mechanic", "Mecánico"],
  ["agent-factory", "Fábrica de agentes"], ["claude-reviewer", "Revisor Claude"],
] as const;
export const STAGE_LABEL: Record<string, string> = Object.fromEntries(FACTORY_STAGE_AGENTS);

const SAFE_TOKEN = /^FACTORY_[A-Z0-9_]{1,100}(:[A-Za-z0-9_]{1,100})?$|^[A-Z][A-Z0-9_]{2,100}$|^[a-z][a-z0-9]*(_[a-z0-9]+)+$/;
/** Same rule as the owner route: only static internal codes, never free text. */
export function safeReasonCode(result: unknown): string | null {
  const reason = result && typeof result === "object" ? (result as { reason?: unknown }).reason : undefined;
  if (typeof reason !== "string" || !reason || reason.length > 300) return null;
  return reason.split(",").every(t => SAFE_TOKEN.test(t)) ? reason : null;
}

const REASONS: Array<[RegExp, string]> = [
  [/PROVIDER_BLOCKED/, "El proveedor de IA bloqueó la petición antes de enviarla; no se gastó crédito."],
  [/EXECUTION_UNCONFIRMED/, "No se pudo confirmar si la ejecución terminó; hay que reconciliar antes de seguir."],
  [/SOURCE_TOO_LARGE/, "El archivo a reparar es demasiado grande para la fábrica."],
  [/SOURCE_UNAVAILABLE/, "No se pudo leer el código fuente necesario."],
  [/DAILY_DRAFT_PR_LIMIT/, "Se alcanzó el límite diario de PR borrador."],
  [/DAILY_AUTO_ADMISSION_LIMIT|daily_auto_admission_limit/, "Se alcanzó el límite diario de admisiones automáticas."],
  [/DAILY_CREDIT_PACE|DAILY_ALLOWANCE/, "Se alcanzó el ritmo diario de crédito; sigue mañana."],
  [/UNKNOWN_HOLD|RECONCILIATION_REQUIRED|UNKNOWN_REQUIRES_RECONCILIATION/, "Hay un gasto de API sin confirmar retenido; requiere reconciliación."],
  [/BUDGET_EXHAUSTED|CREDIT_UNAVAILABLE|GRANT_EXHAUSTED/, "No queda presupuesto o crédito disponible."],
  [/PRICING_UNVERIFIED|OPERATION_UNPRICED/, "El precio del modelo no está verificado; no se ejecutó."],
  [/OUTPUT_LIMIT|INCOMPLETE/, "La respuesta del modelo quedó incompleta (límite de salida)."],
  [/PATCH/, "El parche generado no se pudo aplicar."],
  [/REGRESSION_TEST_REQUIRED/, "Falta una prueba de regresión permanente."],
  [/ADAPTER_UNAVAILABLE/, "Falta conectar el ejecutor de esta etapa."],
  [/CHECKS|RELEASE_GATE/, "Las comprobaciones de CI no pasaron."],
  [/ADMISSION_UNAVAILABLE|AUTHORITY_UNAVAILABLE/, "La autoridad de presupuesto de API no está disponible."],
  [/CANCELLED|TIMEOUT|WINDOW_EXPIRED/, "La ejecución se canceló o expiró su ventana."],
  [/REFUSAL/, "El modelo se negó a completar la tarea."],
];
export function translateFactoryReason(code: string | null, status?: string): string {
  if (code) for (const [pattern, text] of REASONS) if (pattern.test(code)) return text;
  if (status === "unknown") return "Resultado sin confirmar; hay que reconciliar antes de continuar.";
  if (status === "failed") return "La etapa falló sin un código seguro de motivo.";
  return code ? "Detenido por un control de seguridad de la fábrica." : "Detenido sin motivo registrado.";
}

export function apiReadinessLabel(reason: unknown, paidAdmissionReady: unknown): { ready: boolean; text: string; code: string | null } {
  const code = typeof reason === "string" && SAFE_TOKEN.test(reason) ? reason : null;
  if (code === "FACTORY_API_READY" || (paidAdmissionReady === true && !code)) return { ready: true, text: "API lista", code };
  if (code === "FACTORY_MONTH_UNINITIALIZED") return { ready: false, text: "Mes sin inicializar en la autoridad de API.", code };
  return { ready: false, text: code ? translateFactoryReason(code) : "Estado de la API sin confirmar.", code };
}

export const ORDER_REASON_LABEL: Record<string, string> = {
  eligible: "Admisibles", explicitly_mapped: "Asignadas manualmente", auto_admit_disabled: "Admisión automática apagada",
  before_since: "Anteriores al inicio de autoadmisión", no_active_engineering_assignee: "Sin agente de ingeniería activo",
  domain_paused: "Dominio en pausa", kong_assignee: "Asignadas a Kong (fuera)", kong_text: "Mencionan Kong (fuera)",
  text_too_long: "Texto demasiado largo", empty_text: "Sin texto", invalid_created_at: "Fecha inválida",
  self_heal_order: "Autorreparación", passes_code_filters_config_unknown: "Pasan filtros; configuración sin confirmar",
};

export function orderShortLabel(text: unknown): string | null {
  if (typeof text !== "string") return null;
  const clean = text.replace(/\s+/g, " ").trim();
  if (!clean) return null;
  return clean.length > 48 ? `${clean.slice(0, 47)}…` : clean;
}

type Order = { orderId: string } | undefined;
function rootOrder(job: FactoryAgentJob, byId: Map<string, FactoryAgentJob>): Order {
  let cursor: FactoryAgentJob | undefined = job;
  for (let hop = 0; cursor && hop < 50; hop++) {
    const source = cursor.payload?.companyOrder as { orderId?: unknown } | undefined;
    if (typeof source?.orderId === "string") return { orderId: source.orderId };
    const prev: unknown = cursor.payload?.previousJobId;
    cursor = typeof prev === "string" ? byId.get(prev) : undefined;
  }
  return undefined;
}

const ms = (iso: string | undefined) => { const t = Date.parse(iso ?? ""); return Number.isFinite(t) ? t : NaN; };
const terminalAt = (job: FactoryAgentJob) => job.completedAt ?? job.createdAt;

function rowFor(id: string, label: string, group: FactoryAgentRow["group"], jobs: FactoryAgentJob[], now: number, orderOf: (j: FactoryAgentJob) => Order, orderText: Map<string, string>): FactoryAgentRow {
  const running = jobs.filter(j => j.status === "running").sort((a, b) => ms(a.createdAt) - ms(b.createdAt));
  const queued = jobs.filter(j => j.status === "pending").length;
  const completed = jobs.filter(j => j.status === "completed").sort((a, b) => ms(terminalAt(b)) - ms(terminalAt(a)));
  const lastCompletedAt = completed[0] ? terminalAt(completed[0]) : null;
  const row: FactoryAgentRow = { id, label, group, state: "en_espera", queued, lastCompletedAt };
  if (running.length) {
    const job = running[0], order = orderOf(job);
    row.state = "trabajando";
    row.current = { jobId: job.id, stage: STAGE_LABEL[job.kind] ?? job.kind, orderLabel: order ? orderShortLabel(orderText.get(order.orderId)) ?? "Orden de la empresa" : null,
      since: job.createdAt, elapsedMinutes: Math.max(0, Math.floor((now - ms(job.createdAt)) / 60000)) };
    return row;
  }
  const stopped = jobs.filter(j => ["blocked", "failed", "unknown"].includes(j.status)).sort((a, b) => ms(terminalAt(b)) - ms(terminalAt(a)))[0];
  if (stopped && (!lastCompletedAt || ms(terminalAt(stopped)) > ms(lastCompletedAt))) {
    const code = safeReasonCode(stopped.result);
    row.state = "bloqueado";
    row.blocked = { reason: translateFactoryReason(code, stopped.status), code, at: terminalAt(stopped) };
  }
  if (!jobs.length) row.detail = "Sin actividad registrada.";
  return row;
}

export function deriveFactoryAgents(input: {
  jobs: readonly FactoryAgentJob[]; orders: readonly FactoryAgentOrder[] | undefined; now: number;
  /** Optional per-role self-heal counts (selfHealOfficeView). */
  selfHeal?: { enabled: boolean; agents: Array<{ agentId: string; repairing: number; needsOwner: number }> };
}): FactoryAgentRow[] {
  const jobs = Array.isArray(input.jobs) ? input.jobs.filter(j => j && typeof j.id === "string") : [];
  const byId = new Map(jobs.map(j => [j.id, j]));
  const orders: readonly FactoryAgentOrder[] = Array.isArray(input.orders) ? input.orders : [];
  const orderById = new Map<string, FactoryAgentOrder>(orders.map(o => [o.id, o]));
  const orderText = new Map(orders.map(o => [o.id, o.text]));
  const cache = new Map<string, Order>();
  const orderOf = (j: FactoryAgentJob) => { if (!cache.has(j.id)) cache.set(j.id, rootOrder(j, byId)); return cache.get(j.id); };
  const rows: FactoryAgentRow[] = FACTORY_STAGE_AGENTS.map(([kind, label]) => rowFor(kind, label, "etapa", jobs.filter(j => j.kind === kind), input.now, orderOf, orderText));
  for (const [agentId, label] of FACTORY_ENGINEERING_AGENTS) {
    const mine = jobs.filter(j => { const o = orderOf(j); return !!o && !!orderById.get(o.orderId)?.assignees?.some(a => a?.agentId === agentId); });
    const row = rowFor(agentId, label, "ingenieria", mine, input.now, orderOf, orderText);
    const open = orders.filter(o => !o.doneAt && o.assignees?.some(a => a?.agentId === agentId && a.status !== "hecha")).length;
    row.detail = mine.length ? `${open} ${open === 1 ? "orden abierta" : "órdenes abiertas"} asignadas.` : `Sin trabajos de fábrica registrados · ${open} ${open === 1 ? "orden abierta" : "órdenes abiertas"}.`;
    rows.push(row);
  }
  const healJobs = jobs.filter(j => { const o = orderOf(j); return !!o && orderById.get(o.orderId)?.selfHeal !== undefined; });
  const heal = rowFor("self-heal", "Autorreparación", "control", healJobs, input.now, orderOf, orderText);
  const counts = (input.selfHeal?.agents ?? []).reduce((acc, a) => ({ repairing: acc.repairing + (a.repairing || 0), needsOwner: acc.needsOwner + (a.needsOwner || 0) }), { repairing: 0, needsOwner: 0 });
  heal.detail = input.selfHeal?.enabled === false && !healJobs.length ? "Desactivada en la configuración." : `${counts.repairing} en reparación · ${counts.needsOwner} esperan a Robert.`;
  rows.push(heal);
  // Release gate: the CI checks that each candidate must pass before review (reason codes on simulate/review).
  const gateJobs = jobs.filter(j => j.kind === "simulate" || j.kind === "review");
  const gate = rowFor("release-gate", "Puerta de publicación (CI)", "control", gateJobs.filter(j => j.status !== "running" && j.status !== "pending"), input.now, orderOf, orderText);
  if (gate.state === "bloqueado" && !/CHECKS|RELEASE_GATE|REGRESSION/.test(gate.blocked?.code ?? "")) { gate.state = "en_espera"; delete gate.blocked; }
  gate.detail = "Nunca fusiona ni despliega; la publicación requiere aprobación de Robert.";
  rows.push(gate);
  return rows;
}

/** Discover jobs from company orders admitted since 00:00 UTC (persisted rows only). */
export function admissionsToday(jobs: readonly FactoryAgentJob[], now: number): number {
  const d = new Date(now), since = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  return jobs.filter(j => j.kind === "discover" && typeof (j.payload?.companyOrder as { orderId?: unknown } | undefined)?.orderId === "string" && ms(j.createdAt) >= since).length;
}

export type FactoryAgentsView = {
  checkedAt: string; paused: boolean;
  api: { ready: boolean; text: string; code: string | null; remainingMicroUsd: number | null };
  /** Which AI provider new factory work uses and why (persisted out-of-credit flags). */
  provider?: { readable: boolean; active: "openai" | "anthropic" | null; reason: string; cooldowns: Array<{ provider: "openai" | "anthropic"; reason: string; since: string; until: string }> };
  /** Model per provider for factory code stages, from the central policy (shared/ai-model-policy.ts). */
  models?: { openai: string; anthropic: string };
  budget: { month: string; limitCents: number; usedCents: number; remainingCents: number; configured: boolean };
  admissions: { today: number; cap: number | null };
  openOrders: { readable: boolean; total: number; reasons: Array<{ code: string; label: string; count: number }> };
  pullRequests: Array<{ url: string; orderLabel: string | null; completedAt: string }>;
  agents: FactoryAgentRow[];
  jobsListComplete: boolean;
};
