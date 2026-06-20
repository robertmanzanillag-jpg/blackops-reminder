type CostPolicyOrigin = "web" | "telegram";

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
  };
}

export function buildAiCostPolicyContext(origin: CostPolicyOrigin): string {
  const policy = getAiCostPolicySnapshot();
  return [
    "## BlackOps AI Cost Policy",
    `Budget goal: keep AI/API spend under $${policy.monthlyBudgetUsd}/month, with a normal operating target near $${policy.operatingTargetUsd}/month until revenue justifies more.`,
    `Channel: ${origin}. Default mode: ${policy.defaultMode}.`,
    "",
    "Operating rules:",
    "- Cheap-first: use deterministic app routes, cached data, local files, Metricool queues, and direct commands before using a strong model.",
    "- Use Gemini/Gemma-style scout work for summaries, clustering, first drafts, captions, duplicate checks, and bulk clip planning.",
    "- Use OpenAI/strong reasoning only for final strategy, risky decisions, money/spend, production changes, security, code review, or when the cheap scout is uncertain.",
    "- Claude skills are local instruction text. They improve marketing/design behavior but do not spend Claude API tokens unless a Claude API model is explicitly called.",
    "- Keep responses compact. Do not dump long context, large skill bodies, or repeated history unless it directly changes the answer.",
    "- For clippers, prefer batch planning and reusable templates. Do not analyze every clip with a strong model when one campaign-level plan is enough.",
    "- Do not start paid generative video at scale, paid ads, external posting, customer/supplier outreach, or anything that can increase spend without Robert approval and a cost estimate.",
    "- If a request could push monthly spend above the budget, explain the tradeoff and propose a cheaper phased plan first.",
  ].join("\n");
}
