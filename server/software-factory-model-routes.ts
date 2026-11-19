import { executeWithinSharedCredits } from "./shared-openai-credit-execution";
import type { createSharedOpenAiCreditLedger } from "./shared-openai-credit-ledger";
import { createOpenAiFactoryTextProvider, type FactoryTextResult } from "./software-factory-openai";
import { createAnthropicFactoryTextProvider, type AnthropicFactoryModelConfig } from "./software-factory-anthropic";

type Ledger = ReturnType<typeof createSharedOpenAiCreditLedger>;
type GenerateInput = Parameters<ReturnType<typeof createOpenAiFactoryTextProvider>>[0];
type OpenAiModel = Parameters<typeof createOpenAiFactoryTextProvider>[0];
/** One provider with its own ledger. Routes are tried in order; each paid call
 * is reserved and settled only on that route's ledger. */
export type FactoryModelRoute =
  | { provider: "openai"; ledger: Ledger; model: OpenAiModel }
  | { provider: "anthropic"; ledger: Ledger; model: AnthropicFactoryModelConfig };

/** OpenAI could not admit or start the call (credit/quota/budget/pricing or
 * pre-submission transport failure). Nothing was executed, so trying the next
 * provider cannot repeat a paid call or a content/validation failure. */
const FALLBACK_RESULT_REASONS = new Set([
  "FACTORY_OPENAI_COUNT_UNAVAILABLE", "FACTORY_OPENAI_BUDGET_UNAVAILABLE",
  "FACTORY_OPENAI_PRICING_EXPIRED", "FACTORY_OPENAI_ADMISSION_EXPIRED",
]);
/** Ledger admission refusals: the shared credit is exhausted, expired,
 * uncertain (unknown/overrun hold), missing or full. */
const FALLBACK_LEDGER_ERRORS = new Set([
  "CREDIT_UNAVAILABLE", "CREDIT_EXPIRED", "CREDIT_RECONCILIATION_REQUIRED", "CREDIT_NOT_INITIALIZED",
  "CREDIT_CAPACITY_REQUIRED", "CREDIT_STORAGE_NOT_PROVISIONED", "CREDIT_GRANT_MISMATCH", "CREDIT_CORRUPT",
]);
export const isFactoryModelFallbackResult = (result: FactoryTextResult) => result.status === "blocked" && FALLBACK_RESULT_REASONS.has(result.reason);
const messageOf = (error: unknown) => { try { const m = error instanceof Error ? Object.getOwnPropertyDescriptor(error, "message")?.value : undefined; return typeof m === "string" ? m : ""; } catch { return ""; } };
export const isFactoryModelFallbackError = (error: unknown) => FALLBACK_LEDGER_ERRORS.has(messageOf(error));

/** Every model call is bounded by its own ledger's execution window. */
function routeGenerator(route: FactoryModelRoute, key: string) {
  const request = async (url: string, init: RequestInit) => {
    const remaining = await route.ledger.executionWindow(key);
    const deadline = AbortSignal.timeout(Math.floor(remaining));
    const signal = init.signal ? AbortSignal.any([init.signal, deadline]) : deadline;
    signal.throwIfAborted(); return route.model.request(url, { ...init, signal });
  };
  return route.provider === "anthropic"
    ? createAnthropicFactoryTextProvider({ ...route.model, request })
    : createOpenAiFactoryTextProvider({ ...route.model, request });
}
const ledgerOfError = new WeakMap<object, Ledger>();
/** The ledger that refused/held the call that threw (for receipt lookups). */
export const factoryModelErrorLedger = (error: unknown) => (error && typeof error === "object" ? ledgerOfError.get(error) : undefined);
export const factoryModelProviderArtifact = (used: { provider: string; model: string }) => `factory-model-provider:${used.provider}:${used.model}`;

/** Runs one stage model call. With a single route this is exactly the earlier
 * executeWithinSharedCredits flow (same key, hash, evidence and errors). */
export async function runFactoryModelCall(routes: readonly FactoryModelRoute[], call: {
  key: string; input: GenerateInput;
  requestSha256: (model: FactoryModelRoute["model"]) => string;
  evidenceId: (requestSha256: string) => string;
  unknownError: string;
}): Promise<{ result: FactoryTextResult; provider: FactoryModelRoute["provider"]; model: string; requestSha256: string }> {
  if (!routes.length) throw Error("FACTORY_MODEL_ROUTE_REQUIRED");
  for (const [index, route] of routes.entries()) {
    const last = index === routes.length - 1, requestSha256 = call.requestSha256(route.model);
    const generate = routeGenerator(route, call.key);
    let served = route.model.model;
    try {
      const result = await executeWithinSharedCredits(route.ledger, { key: call.key, consumer: "factory", requestSha256, maximumMicroUsd: call.input.maxCostCents * 10000 }, async () => {
        const generated = await generate(call.input);
        if (generated.status === "unknown") throw Error(call.unknownError);
        if ("servedModel" in generated && typeof generated.servedModel === "string") served = generated.servedModel;
        return { value: generated, actualMicroUsd: generated.costCents * 10000, evidenceId: call.evidenceId(requestSha256) };
      });
      if (!last && route.provider === "openai" && isFactoryModelFallbackResult(result)) continue;
      const { servedModel: _served, ...plain } = result as FactoryTextResult & { servedModel?: string };
      return { result: plain as FactoryTextResult, provider: route.provider, model: served, requestSha256 };
    } catch (error) {
      if (!last && route.provider === "openai" && isFactoryModelFallbackError(error)) continue;
      if (error && typeof error === "object") ledgerOfError.set(error, route.ledger);
      throw error;
    }
  }
  throw Error("FACTORY_MODEL_ROUTE_REQUIRED");
}
