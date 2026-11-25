// Central AI model policy (pure, no IO): agent tier x task kind x provider -> model id.
//
// Robert's rule (2026-11-25): only the CEO agent and the CEO chat use the strongest models
// (Claude Opus 5.5 / OpenAI GPT-6.2 Sol). Every other agent uses the cheapest small model of
// whichever provider has credit (Claude Haiku 5.5 / OpenAI GPT-6 Luna). Software Factory code
// stages stay on a strong model (see CODE tier note). Provider choice (OpenAI first, Claude when
// OpenAI is out of credit, #569/#579) is decided elsewhere; this module only maps the tier on
// the chosen provider, so the CEO stays strong on whichever provider has credit.
//
// Every model this policy can return has a code-owned price below (docs evidence + date), so the
// ledgers never under-count. An env override naming a model without a price is ignored and the
// policy default is used instead (reason AI_MODEL_OVERRIDE_UNPRICED), never sent unpriced.

export type AiPolicyProvider = "openai" | "anthropic";
export type AiAgentTier = "ceo" | "default" | "code";
export type AiTaskKind = "chat" | "role_job" | "review" | "learning" | "translation" | "assistant" | "code_build" | "code_review" | "file_select";

/** Integer nanodollars per token ($1 per million tokens = 1000). */
export type AiModelPrice = Readonly<{ input: number; output: number; cachedInput: number; cacheWrite30m: number; cacheWrite12h: number;
  /** Above this many input tokens the provider bills a higher tier; the ledger must use `above`. */
  tierAboveInputTokens?: number; above?: Readonly<{ input: number; output: number; cachedInput: number; cacheWrite30m: number; cacheWrite12h: number }> }>;

export const AI_MODEL_PRICING_VERIFIED_AT = "2026-11-25";
/** Re-verify list prices by this date or the code-owned prices stop admitting calls. */
export const AI_MODEL_PRICING_VALID_UNTIL = "2027-05-25T00:00:00.000Z";
export const AI_MODEL_PRICING_EVIDENCE = Object.freeze({
  openai: "https://developers.openai.com/api/docs/models/gpt-6-luna ; https://developers.openai.com/api/docs/pricing (standard tier)",
  anthropic: "https://platform.claude.com/docs/en/about-claude/pricing ; https://platform.claude.com/docs/en/models/overview",
});

/** Standard-tier list prices verified 2026-11-25. Where two official pages disagreed, the
 * HIGHER rate is used (gpt-6-luna: model page $0.10/$0.50 vs an untiered table $0.05/$0.25).
 * Cache-write 12h for gpt-6-luna is not on the model page: 2x the 30m rate, the ratio OpenAI
 * documents for gpt-6.x-sol ($2.50 -> $5.00). Anthropic "cacheWrite12h" holds the 1-hour write
 * rate (2x input), the highest Anthropic multiplier. */
export const AI_MODEL_PRICES: Readonly<Record<AiPolicyProvider, Readonly<Record<string, AiModelPrice>>>> = Object.freeze({
  openai: Object.freeze({
    "gpt-6.2-sol": Object.freeze({ input: 2000, output: 10000, cachedInput: 100, cacheWrite30m: 2500, cacheWrite12h: 5000 }),
    "gpt-6.1-sol": Object.freeze({ input: 2000, output: 10000, cachedInput: 100, cacheWrite30m: 2500, cacheWrite12h: 5000 }),
    // Prompts over 272K input tokens: 2x input/cache and 1.5x output for the whole request.
    "gpt-6-luna": Object.freeze({ input: 100, output: 500, cachedInput: 10, cacheWrite30m: 125, cacheWrite12h: 250,
      tierAboveInputTokens: 272000, above: Object.freeze({ input: 200, output: 750, cachedInput: 20, cacheWrite30m: 250, cacheWrite12h: 500 }) }),
  }),
  anthropic: Object.freeze({
    "claude-opus-5-5": Object.freeze({ input: 4000, output: 20000, cachedInput: 200, cacheWrite30m: 5000, cacheWrite12h: 8000 }),
    "claude-sonnet-5-5": Object.freeze({ input: 2000, output: 10000, cachedInput: 100, cacheWrite30m: 2500, cacheWrite12h: 4000 }),
    // Haiku 5.5 bills the whole request at the higher tier when total input > 100K tokens.
    "claude-haiku-5-5": Object.freeze({ input: 100, output: 500, cachedInput: 10, cacheWrite30m: 125, cacheWrite12h: 200,
      tierAboveInputTokens: 100000, above: Object.freeze({ input: 500, output: 2500, cachedInput: 50, cacheWrite30m: 625, cacheWrite12h: 1000 }) }),
  }),
});

/** Defaults. CODE: Software Factory build/review/file selection write or judge code patches;
 * the factory's recorded failures (PROVIDER_OUTPUT_LIMIT, PATCH) were on the strong model and
 * there is no evaluation showing a small model produces passing patches, so code stays on the
 * factory's existing strong models (gpt-6.1-sol, the model its pricing catalog row covers). */
export const AI_MODEL_DEFAULTS: Readonly<Record<AiAgentTier, Readonly<Record<AiPolicyProvider, string>>>> = Object.freeze({
  ceo: Object.freeze({ openai: "gpt-6.2-sol", anthropic: "claude-opus-5-5" }),
  default: Object.freeze({ openai: "gpt-6-luna", anthropic: "claude-haiku-5-5" }),
  code: Object.freeze({ openai: "gpt-6.1-sol", anthropic: "claude-opus-5-5" }),
});
const ENV_KEYS: Readonly<Record<AiAgentTier, Readonly<Record<AiPolicyProvider, string>>>> = Object.freeze({
  ceo: { openai: "AI_MODEL_CEO_OPENAI", anthropic: "AI_MODEL_CEO_ANTHROPIC" },
  default: { openai: "AI_MODEL_DEFAULT_OPENAI", anthropic: "AI_MODEL_DEFAULT_ANTHROPIC" },
  code: { openai: "AI_MODEL_CODE_OPENAI", anthropic: "AI_MODEL_CODE_ANTHROPIC" },
});
const CODE_TASKS = new Set<AiTaskKind>(["code_build", "code_review", "file_select"]);
const MODEL_ID = /^[A-Za-z0-9._-]{1,100}$/;

/** Agent ids that get the CEO tier. Default only the main "ceo" agent; AI_MODEL_CEO_AGENT_IDS
 * (comma list) can widen it. */
export function ceoAgentIds(env: Record<string, string | undefined> = {}) {
  const raw = env.AI_MODEL_CEO_AGENT_IDS?.split(",").map(s => s.trim()).filter(s => s && s.length <= 120) ?? [];
  return new Set(raw.length ? raw : ["ceo"]);
}
export function agentTier(agentId: string | undefined | null, task: AiTaskKind, env: Record<string, string | undefined> = {}): AiAgentTier {
  if (CODE_TASKS.has(task)) return "code";
  return agentId && ceoAgentIds(env).has(agentId) ? "ceo" : "default";
}

export function aiModelPrice(provider: AiPolicyProvider, model: string): AiModelPrice | null {
  const table = AI_MODEL_PRICES[provider];
  return typeof model === "string" && Object.hasOwn(table, model) ? table[model] : null;
}
/** The rate that applies to a request with this many total input tokens (never the lower tier
 * when the request may exceed the threshold). */
export function aiModelRateFor(price: AiModelPrice, totalInputTokens: number) {
  const high = price.tierAboveInputTokens !== undefined && price.above && !(Number.isFinite(totalInputTokens) && totalInputTokens <= price.tierAboveInputTokens);
  const r = high ? price.above! : price;
  return { input: r.input, output: r.output, cachedInput: r.cachedInput, cacheWrite30m: r.cacheWrite30m, cacheWrite12h: r.cacheWrite12h };
}

export type AiModelChoice = { provider: AiPolicyProvider; tier: AiAgentTier; task: AiTaskKind; model: string; source: "default" | "env"; note?: "AI_MODEL_OVERRIDE_UNPRICED" | "AI_MODEL_OVERRIDE_INVALID" };
/** The single place every AI call site asks "which model?". */
export function resolveAiModel(input: { provider: AiPolicyProvider; task: AiTaskKind; agentId?: string | null; env?: Record<string, string | undefined> }): AiModelChoice {
  const env = input.env ?? {};
  const tier = agentTier(input.agentId, input.task, env);
  const fallback = AI_MODEL_DEFAULTS[tier][input.provider];
  const raw = env[ENV_KEYS[tier][input.provider]]?.trim();
  const base = { provider: input.provider, tier, task: input.task };
  if (!raw) return { ...base, model: fallback, source: "default" };
  if (!MODEL_ID.test(raw)) return { ...base, model: fallback, source: "default", note: "AI_MODEL_OVERRIDE_INVALID" };
  if (!aiModelPrice(input.provider, raw)) return { ...base, model: fallback, source: "default", note: "AI_MODEL_OVERRIDE_UNPRICED" };
  return { ...base, model: raw, source: "env" };
}

/** Rollback lever: AI_MODEL_TIERING=off keeps every office call on the previously configured
 * model (OFFICE_OPENAI_MODEL / the factory's Opus price), exactly as before this policy. */
export function aiModelTieringEnabled(env: Record<string, string | undefined> = {}) {
  return env.AI_MODEL_TIERING?.trim().toLowerCase() !== "off";
}

/** Panel view: model per provider for one agent (chat/role work), Spanish label. */
export function agentModelView(agentId: string, env: Record<string, string | undefined> = {}, task: AiTaskKind = "chat") {
  const openai = resolveAiModel({ provider: "openai", task, agentId, env }), anthropic = resolveAiModel({ provider: "anthropic", task, agentId, env });
  const tierLabel = openai.tier === "ceo" ? "CEO (modelo fuerte)" : openai.tier === "code" ? "Código (modelo fuerte)" : "Estándar (modelo económico)";
  return { agentId, tier: openai.tier, tierLabel, openai: openai.model, anthropic: anthropic.model };
}
