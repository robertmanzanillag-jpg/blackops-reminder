type CostPolicyOrigin = "web" | "telegram";

type SpendRun = {
  id?: string | null;
  automationId?: string | null;
  startedAt?: Date | string | null;
  createdAt?: Date | string | null;
  status?: string | null;
  costEstimate?: string | null;
  resultSummary?: string | null;
  errorMessage?: string | null;
  triggeredBy?: string | null;
  metadata?: unknown;
};

type SpendAutomation = {
  id: string;
  name?: string | null;
  description?: string | null;
  type?: string | null;
  assignedAgentId?: string | null;
};

type SpendHistoryEntry = {
  id: string;
  date: string;
  label: string;
  detail: string;
  amountUsd: number;
  sourceId: string;
  sourceLabel: string;
  kind: string;
  status: string;
};

function readUsdEnv(name: string, fallback: number, min: number, max: number): number {
  const value = Number(process.env[name]);
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.round(value)));
}

function readIntEnv(name: string, fallback: number, min: number, max: number): number {
  const value = Number(process.env[name]);
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.round(value)));
}

export function getAiMonthlyBudgetUsd(): number {
  return readUsdEnv("BLACKOPS_AI_MONTHLY_BUDGET_USD", 500, 25, 10_000);
}

export function getAiOperatingTargetUsd(): number {
  const budget = getAiMonthlyBudgetUsd();
  return Math.min(budget, readUsdEnv("BLACKOPS_AI_OPERATING_TARGET_USD", 350, 25, budget));
}

export function getAiConversationHistoryLimit(): number {
  return readIntEnv("BLACKOPS_AI_HISTORY_MESSAGES", 8, 2, 20);
}

export function getOpenAiMaxCompletionTokens(): number {
  return readIntEnv("BLACKOPS_OPENAI_MAX_COMPLETION_TOKENS", 900, 300, 2000);
}

export function getAiCostPolicySnapshot() {
  return {
    monthlyBudgetUsd: getAiMonthlyBudgetUsd(),
    operatingTargetUsd: getAiOperatingTargetUsd(),
    historyMessages: getAiConversationHistoryLimit(),
    openAiMaxCompletionTokens: getOpenAiMaxCompletionTokens(),
    defaultMode: process.env.BLACKOPS_AI_DEFAULT_MODE || "cheap_first",
    strictCostMode: (process.env.BLACKOPS_STRICT_COST_MODE || "true").toLowerCase() !== "false",
  };
}

function estimateRunUsd(costEstimate?: string | null): number {
  const value = String(costEstimate || "").trim().toLowerCase();
  if (!value || value === "0" || value === "free" || value === "none") return 0;
  const numeric = Number(value.replace(/^\$/, ""));
  if (Number.isFinite(numeric)) return Math.max(0, numeric);
  if (value === "low") return 0.05;
  if (value === "medium") return 0.25;
  if (value === "high") return 1;
  if (value === "critical") return 2.5;
  return 0.1;
}

function getRunDate(run: SpendRun): Date | null {
  const raw = run.startedAt || run.createdAt;
  if (!raw) return null;
  const date = raw instanceof Date ? raw : new Date(raw);
  return Number.isNaN(date.getTime()) ? null : date;
}

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

function readMetadataString(metadata: unknown, keys: string[]): string {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return "";
  const record = metadata as Record<string, unknown>;
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function buildAutomationMap(automations: SpendAutomation[]): Map<string, SpendAutomation> {
  return new Map(automations.map((automation) => [automation.id, automation]));
}

function getRunLabel(run: SpendRun, automationById: Map<string, SpendAutomation>): string {
  const automation = run.automationId ? automationById.get(run.automationId) : undefined;
  return automation?.name
    || readMetadataString(run.metadata, ["title", "name", "label", "automationName"])
    || automation?.assignedAgentId
    || automation?.type
    || "Automatizacion";
}

function getRunDetail(run: SpendRun, automationById: Map<string, SpendAutomation>): string {
  const automation = run.automationId ? automationById.get(run.automationId) : undefined;
  return run.resultSummary
    || run.errorMessage
    || readMetadataString(run.metadata, ["summary", "description", "source", "function"])
    || automation?.description
    || `Estado: ${run.status || "registrado"}`;
}

export function buildMonthlyAiSpendReport(runs: SpendRun[], now = new Date(), automations: SpendAutomation[] = []) {
  const policy = getAiCostPolicySnapshot();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const nextMonthStart = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const dayOfMonth = Math.max(1, now.getDate());
  const manualAiSpendUsd = readUsdEnv("BLACKOPS_AI_MANUAL_MONTH_TO_DATE_USD", 0, 0, 1_000_000);
  const metricoolUsd = readUsdEnv("BLACKOPS_METRICOOL_MONTHLY_USD", 0, 0, 1_000_000);
  const fixedToolsUsd = readUsdEnv("BLACKOPS_FIXED_MONTHLY_TOOLS_USD", 0, 0, 1_000_000);

  const monthRuns = runs.filter((run) => {
    const date = getRunDate(run);
    return date ? date >= monthStart && date < nextMonthStart : false;
  });

  const automationEstimateUsd = roundMoney(monthRuns.reduce((sum, run) => sum + estimateRunUsd(run.costEstimate), 0));
  const trackedSpendUsd = roundMoney(automationEstimateUsd + manualAiSpendUsd + metricoolUsd + fixedToolsUsd);
  const projectedVariableUsd = dayOfMonth > 0 ? (automationEstimateUsd + manualAiSpendUsd) / dayOfMonth * daysInMonth : 0;
  const projectedMonthUsd = roundMoney(projectedVariableUsd + metricoolUsd + fixedToolsUsd);
  const budgetUsedPct = policy.monthlyBudgetUsd > 0 ? Math.min(999, Math.round((trackedSpendUsd / policy.monthlyBudgetUsd) * 100)) : 0;
  const projectedBudgetPct = policy.monthlyBudgetUsd > 0 ? Math.min(999, Math.round((projectedMonthUsd / policy.monthlyBudgetUsd) * 100)) : 0;
  const status = projectedMonthUsd > policy.monthlyBudgetUsd
    ? "over_budget"
    : projectedMonthUsd > policy.operatingTargetUsd
      ? "watch"
      : "healthy";
  const automationById = buildAutomationMap(automations);
  const historyEntries: Array<SpendHistoryEntry | null> = [
    ...monthRuns.map((run) => {
      const date = getRunDate(run) || monthStart;
      const amountUsd = roundMoney(estimateRunUsd(run.costEstimate));
      return {
        id: run.id || `${run.automationId || "automation"}-${date.toISOString()}`,
        date: date.toISOString(),
        label: getRunLabel(run, automationById),
        detail: getRunDetail(run, automationById),
        amountUsd,
        sourceId: "automation_runs",
        sourceLabel: "Automatizaciones",
        kind: "estimated",
        status: run.status || "registrado",
      };
    }),
    manualAiSpendUsd > 0 ? {
      id: "manual_ai_month_to_date",
      date: now.toISOString(),
      label: "Uso manual OpenAI/Gemini",
      detail: "Importe cargado desde BLACKOPS_AI_MANUAL_MONTH_TO_DATE_USD.",
      amountUsd: roundMoney(manualAiSpendUsd),
      sourceId: "manual_ai",
      sourceLabel: "AI/API manual",
      kind: "manual_env",
      status: "registrado",
    } : null,
    metricoolUsd > 0 ? {
      id: "metricool_monthly",
      date: monthStart.toISOString(),
      label: "Metricool",
      detail: "Suscripcion mensual cargada desde BLACKOPS_METRICOOL_MONTHLY_USD.",
      amountUsd: roundMoney(metricoolUsd),
      sourceId: "metricool",
      sourceLabel: "Metricool",
      kind: "fixed_env",
      status: "registrado",
    } : null,
    fixedToolsUsd > 0 ? {
      id: "fixed_tools_monthly",
      date: monthStart.toISOString(),
      label: "Otras herramientas",
      detail: "Herramientas fijas cargadas desde BLACKOPS_FIXED_MONTHLY_TOOLS_USD.",
      amountUsd: roundMoney(fixedToolsUsd),
      sourceId: "fixed_tools",
      sourceLabel: "Herramientas",
      kind: "fixed_env",
      status: "registrado",
    } : null,
  ];
  const history = historyEntries
    .filter((entry): entry is SpendHistoryEntry => Boolean(entry && entry.amountUsd > 0))
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

  return {
    month: monthStart.toISOString().slice(0, 7),
    monthStart: monthStart.toISOString(),
    nextMonthStart: nextMonthStart.toISOString(),
    currency: "USD",
    budgetUsd: policy.monthlyBudgetUsd,
    operatingTargetUsd: policy.operatingTargetUsd,
    trackedSpendUsd,
    projectedMonthUsd,
    remainingBudgetUsd: roundMoney(policy.monthlyBudgetUsd - trackedSpendUsd),
    budgetUsedPct,
    projectedBudgetPct,
    status,
    sources: [
      { id: "automation_runs", label: "Automatizaciones", amountUsd: automationEstimateUsd, count: monthRuns.length, kind: "estimated" },
      { id: "manual_ai", label: "Manual AI/API MTD", amountUsd: roundMoney(manualAiSpendUsd), count: manualAiSpendUsd > 0 ? 1 : 0, kind: "manual_env" },
      { id: "metricool", label: "Metricool", amountUsd: roundMoney(metricoolUsd), count: metricoolUsd > 0 ? 1 : 0, kind: "fixed_env" },
      { id: "fixed_tools", label: "Otras herramientas", amountUsd: roundMoney(fixedToolsUsd), count: fixedToolsUsd > 0 ? 1 : 0, kind: "fixed_env" },
    ],
    history,
    notes: [
      "This is a local monthly spend tracker, not a provider invoice.",
      "Set BLACKOPS_AI_MANUAL_MONTH_TO_DATE_USD when you want to add real OpenAI/Gemini usage from provider dashboards.",
      "Set BLACKOPS_METRICOOL_MONTHLY_USD and BLACKOPS_FIXED_MONTHLY_TOOLS_USD to include fixed subscription costs.",
    ],
  };
}

export function buildAiCostPolicyContext(origin: CostPolicyOrigin): string {
  const policy = getAiCostPolicySnapshot();
  return [
    "## BlackOps AI Cost Policy",
    `Budget goal: keep AI/API spend under $${policy.monthlyBudgetUsd}/month, with a normal operating target near $${policy.operatingTargetUsd}/month until revenue justifies more.`,
    `Channel: ${origin}. Default mode: ${policy.defaultMode}. Strict cost mode: ${policy.strictCostMode ? "on" : "off"}.`,
    "",
    "Operating rules:",
    "- cheap-first: use deterministic app routes, cached data, local files, Metricool queues, and direct commands before using a strong model.",
    "- Use Gemini/Gemma-style scout work for summaries, clustering, first drafts, captions, duplicate checks, and bulk clip planning.",
    "- Use OpenAI/strong reasoning only when the work must happen autonomously inside the app and cannot be handled by rules, Gemma/Gemini scout work, or a subscription handoff.",
    "- In strict cost mode, heavy manual work routes to a ChatGPT/Codex Pro subscription handoff by default instead of spending API tokens.",
    "- If Robert explicitly says to do it here despite cost (for example: 'hazlo aqui', 'no pasa nada', 'aunque sea caro', 'lo apruebo', or 'autorizo'), give an approximate API cost before the paid call and continue instead of repeating the subscription handoff.",
    "- For code, bugs, PR fixes, and reviews, prefer Codex/Claude signed-in membership workflows over app API calls.",
    "- Cheap scout prompts should use compact, intent-selected context and short-lived cache for repeated low-risk creative drafts.",
    "- Claude skills are local instruction text. They improve marketing/design behavior but do not spend Claude API tokens unless a Claude API model is explicitly called.",
    "- Keep responses compact. Do not dump long context, large skill bodies, or repeated history unless it directly changes the answer.",
    "- For clippers, prefer batch planning and reusable templates. Do not analyze every clip with a strong model when one campaign-level plan is enough.",
    "- Do not start paid generative video at scale, paid ads, external posting, customer/supplier outreach, or anything that can increase spend without Robert approval and a cost estimate. If Robert approves after the estimate, proceed and log the estimated cost.",
    "- If a request could push monthly spend above the budget, explain the tradeoff and propose a cheaper phased plan first.",
  ].join("\n");
}
