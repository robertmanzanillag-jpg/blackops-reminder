import { requireFactoryCacheWritePrice } from "./factory-api-token-cost";
import { apiEvidenceHash, configuredFactoryApiPrice, type FactoryApiPrice } from "./factory-api-invocation";
import { AI_MODEL_PRICING_EVIDENCE, AI_MODEL_PRICING_VALID_UNTIL, AI_MODEL_PRICING_VERIFIED_AT, aiModelPrice, resolveAiModel } from "../shared/ai-model-policy";

/** OpenAI price row for a policy model: the operator catalog row (FACTORY_API_PRICING_CONFIG)
 * when it has exactly one, otherwise the code-owned list price with its evidence hash. Returns
 * null when neither exists (caller keeps its already-priced model). Lower-tier rates are only
 * returned with maxInputTokens bounding the request to that tier. */
export function policyOpenAiPrice(model: string, env: NodeJS.ProcessEnv): FactoryApiPrice | null {
  // The guarded fetch (factory-api-sdk) only dispatches rows with full cache-write pricing and an
  // input bound. A catalog row it would refuse falls back to the code-owned row; if neither is
  // dispatchable the model is unpriced (null) and callers keep their legacy, priced model.
  const usable = (price: FactoryApiPrice | null) => { if (!price) return null; try { requireFactoryCacheWritePrice(price); return price; } catch { return null; } };
  if (env.FACTORY_API_PRICING_CONFIG) { try { const row = usable(configuredFactoryApiPrice("openai", model, env.FACTORY_API_PRICING_CONFIG)); if (row) return row; } catch { /* no catalog row */ } }
  return usable(codeOwnedOpenAiPrice(model));
}
/** Input bound for code-owned rows without a documented higher tier: the gpt-6.x long-context
 * threshold, so every admitted request is billed at the listed (lower-context) rate. */
const DEFAULT_MAX_INPUT_TOKENS = 272000;
function codeOwnedOpenAiPrice(model: string): FactoryApiPrice | null {
  const p = aiModelPrice("openai", model);
  if (!p) return null;
  const base = { model, inputNanoUsdPerToken: p.input, outputNanoUsdPerToken: p.output, cachedInputNanoUsdPerToken: p.cachedInput,
    cacheWrite30mNanoUsdPerToken: p.cacheWrite30m, cacheWrite12hNanoUsdPerToken: p.cacheWrite12h,
    maxInputTokens: p.tierAboveInputTokens ?? DEFAULT_MAX_INPUT_TOKENS, validUntil: AI_MODEL_PRICING_VALID_UNTIL };
  return { ...base, evidenceSha256: apiEvidenceHash({ ...base, source: AI_MODEL_PRICING_EVIDENCE.openai, verifiedAt: AI_MODEL_PRICING_VERIFIED_AT }) };
}

/** Anthropic office/factory pricing shape for a policy model (null when unpriced). `above` is the
 * higher-tier rate the settlement must use when measured input exceeds `tierAboveInputTokens`. */
export function policyAnthropicPricing(model: string) {
  const p = aiModelPrice("anthropic", model);
  if (!p) return null;
  return { model, inputNanoUsdPerToken: p.input, outputNanoUsdPerToken: p.output, validUntil: AI_MODEL_PRICING_VALID_UNTIL,
    ...(p.tierAboveInputTokens && p.above ? { tierAboveInputTokens: p.tierAboveInputTokens, above: { inputNanoUsdPerToken: p.above.input, outputNanoUsdPerToken: p.above.output } } : {}) };
}

/** For call sites priced ONLY by the operator catalog (guarded OpenAI SDK clients): use the
 * policy model when FACTORY_API_PRICING_CONFIG has its row, else keep the legacy model so a
 * missing row never breaks a working path (the guard would fail closed). */
export function catalogPricedPolicyModel(task: import("../shared/ai-model-policy").AiTaskKind, legacy: string, env: NodeJS.ProcessEnv = process.env) {
  const chosen = resolveAiModel({ provider: "openai", task, env }).model;
  if (!env.FACTORY_API_PRICING_CONFIG) return legacy;
  try { configuredFactoryApiPrice("openai", chosen, env.FACTORY_API_PRICING_CONFIG); return chosen; } catch { return legacy; }
}
