import { apiEvidenceHash, configuredFactoryApiPrice, type FactoryApiPrice } from "./factory-api-invocation";
import { AI_MODEL_PRICING_EVIDENCE, AI_MODEL_PRICING_VALID_UNTIL, AI_MODEL_PRICING_VERIFIED_AT, aiModelPrice, resolveAiModel } from "../shared/ai-model-policy";

/** OpenAI price row for a policy model: the operator catalog row (FACTORY_API_PRICING_CONFIG)
 * when it has exactly one, otherwise the code-owned list price with its evidence hash. Returns
 * null when neither exists (caller keeps its already-priced model). Lower-tier rates are only
 * returned with maxInputTokens bounding the request to that tier. */
export function policyOpenAiPrice(model: string, env: NodeJS.ProcessEnv): FactoryApiPrice | null {
  if (env.FACTORY_API_PRICING_CONFIG) { try { return configuredFactoryApiPrice("openai", model, env.FACTORY_API_PRICING_CONFIG); } catch { /* fall through to code-owned */ } }
  const p = aiModelPrice("openai", model);
  if (!p) return null;
  const base = { model, inputNanoUsdPerToken: p.input, outputNanoUsdPerToken: p.output, cachedInputNanoUsdPerToken: p.cachedInput,
    cacheWrite30mNanoUsdPerToken: p.cacheWrite30m, cacheWrite12hNanoUsdPerToken: p.cacheWrite12h,
    ...(p.tierAboveInputTokens ? { maxInputTokens: p.tierAboveInputTokens } : {}), validUntil: AI_MODEL_PRICING_VALID_UNTIL };
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
