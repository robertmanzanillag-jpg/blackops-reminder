import { executeWithinSharedCredits } from "./shared-openai-credit-execution";
import type { createSharedOpenAiCreditLedger } from "./shared-openai-credit-ledger";
import { createOpenAiFactoryTextProvider, type FactoryTextResult } from "./software-factory-openai";
import { createAnthropicFactoryTextProvider, type AnthropicFactoryModelConfig } from "./software-factory-anthropic";
import { isOpenAiRejectionCauseExhausted } from "./ai-provider-credit-cooldown";
import { createHash } from "node:crypto";
import { currentFactoryApiParent } from "./factory-api-context";

type Ledger = ReturnType<typeof createSharedOpenAiCreditLedger>;
type GenerateInput = Parameters<ReturnType<typeof createOpenAiFactoryTextProvider>>[0];
type OpenAiModel = Parameters<typeof createOpenAiFactoryTextProvider>[0];
/** One provider with its own ledger. Routes are tried in order; each paid call
 * is reserved and settled only on that route's ledger. */
export type FactoryModelRoute =
  | { provider: "openai"; ledger: Ledger; model: OpenAiModel; historyLedgers?: readonly Ledger[] }
  | { provider: "anthropic"; ledger: Ledger; model: AnthropicFactoryModelConfig; historyLedgers?: readonly Ledger[]; apiAuthority?: FactoryAnthropicApiAuthority };

/** The factory's single monthly API authority ($ cap in software_factory_api_authority).
 * Claude calls reserve, settle and mark unknown on it exactly like OpenAI calls do,
 * in addition to the Claude ledger, so Claude spend counts against the same cap. */
type ApiAuthorityStore = { reserveApi(owner: string, input: { key: string; consumer: "other"; requestSha256: string; maximumMicroUsd: number; parent?: { jobId: string; fence: string } }): Promise<{ admitted: boolean }>;
  settleApi(owner: string, key: string, input: { actualMicroUsd: number; evidenceSha256: string }): Promise<unknown>; unknownApi(owner: string, key: string): Promise<unknown> };
export type FactoryAnthropicApiAuthority = { store: ApiAuthorityStore; owner: () => string };
const authorityHash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
export const factoryAnthropicAuthorityKey = (callKey: string) => "api:" + authorityHash(["factory-anthropic", callKey]);
/** Every ledger that may already hold this key: each route's own ledger plus
 * read-only history ledgers (e.g. the OpenAI ledger in a Claude-only run). */
const keyLedgers = (routes: readonly FactoryModelRoute[]) => {
  const seen = new Set<Ledger>(), out: { provider: string; ledger: Ledger }[] = [];
  for (const route of routes) for (const [provider, ledger] of [[route.provider, route.ledger] as const, ...(route.historyLedgers ?? []).map(l => ["history", l] as const)])
    if (!seen.has(ledger)) { seen.add(ledger); out.push({ provider, ledger }); }
  return out;
};

/** OpenAI could not admit or start the call (credit/quota/budget/pricing or
 * pre-submission transport failure). Nothing was executed, so trying the next
 * provider cannot repeat a paid call or a content/validation failure. */
const FALLBACK_RESULT_REASONS = new Set([
  "FACTORY_OPENAI_COUNT_UNAVAILABLE", "FACTORY_OPENAI_BUDGET_UNAVAILABLE",
  "FACTORY_OPENAI_PRICING_EXPIRED", "FACTORY_OPENAI_ADMISSION_EXPIRED",
  "FACTORY_OPENAI_ADMISSION_UNAVAILABLE",
]);
/** Ledger admission refusals: the shared credit is exhausted, expired,
 * uncertain (unknown/overrun hold), uninitialized or full. A corrupt,
 * mismatched or unprovisioned ledger is an integrity failure and halts. */
const FALLBACK_LEDGER_ERRORS = new Set([
  "CREDIT_UNAVAILABLE", "CREDIT_EXPIRED", "CREDIT_RECONCILIATION_REQUIRED", "CREDIT_NOT_INITIALIZED", "CREDIT_CAPACITY_REQUIRED",
]);
/** Per-provider HTTP window: Claude streams with adaptive thinking can exceed
 * the 120 s OpenAI bound; 300 s stays inside the 600 s factory job lease. */
export const FACTORY_MODEL_EXECUTION_WINDOW_MS = { openai: 120000, anthropic: 300000 } as const;
export const isFactoryModelFallbackResult = (result: FactoryTextResult) => result.status === "blocked" && FALLBACK_RESULT_REASONS.has(result.reason);
/** The provider itself said its account is out of credit (OpenAI 429
 * insufficient_quota/credit_balance_exhausted; Anthropic 402 billing_error or
 * 429 enforced_spend_limit_reached). Not billed and not executed, so the next
 * route may run the same call once on its own ledger. */
export function factoryModelCreditExhausted(provider: FactoryModelRoute["provider"], result: FactoryTextResult) {
  if (result.status !== "blocked" || result.costCents !== 0) return false;
  if (provider === "openai") return result.reason === "FACTORY_OPENAI_REQUEST_REJECTED" && isOpenAiRejectionCauseExhausted((result as { cause?: unknown }).cause);
  return result.reason === "FACTORY_ANTHROPIC_CREDIT_EXHAUSTED";
}
const messageOf = (error: unknown) => { try { const m = error instanceof Error ? Object.getOwnPropertyDescriptor(error, "message")?.value : undefined; return typeof m === "string" ? m : ""; } catch { return ""; } };
export const isFactoryModelFallbackError = (error: unknown) => FALLBACK_LEDGER_ERRORS.has(messageOf(error));

/** Every model call is bounded by its own ledger's execution window. */
function routeGenerator(route: FactoryModelRoute, key: string, onDispatch: () => void = () => undefined) {
  const request = async (url: string, init: RequestInit) => {
    const remaining = await route.ledger.executionWindow(key, FACTORY_MODEL_EXECUTION_WINDOW_MS[route.provider]);
    // From here on a provider call may happen: any failure stays `unknown`.
    onDispatch();
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
/** Rows for one key across every route's ledger (for receipt decisions). */
export async function factoryModelKeyRows(routes: readonly FactoryModelRoute[], key: string) {
  const rows = [];
  for (const { provider, ledger } of keyLedgers(routes)) { const row = await ledger.reservation(key); if (row) rows.push({ provider, row }); }
  return rows;
}
export const factoryModelProviderArtifact = (used: { provider: string; model: string }) => `factory-model-provider:${used.provider}:${used.model}`;

type CreditHooks = { onCreditExhausted?: (provider: FactoryModelRoute["provider"], reason: string) => Promise<void> | void; onProviderCompleted?: (provider: FactoryModelRoute["provider"]) => Promise<void> | void };
let processCreditHooks: CreditHooks = {};
/** The operator installs the persisted cooldown hooks once per run, so every
 * stage (build, review, auto-selection) records exhaustion the same way. */
export function setFactoryProviderCreditHooks(hooks: CreditHooks) { processCreditHooks = { ...hooks }; }

/** Runs one stage model call. With a single route this is exactly the earlier
 * executeWithinSharedCredits flow (same key, hash, evidence and errors). */
export async function runFactoryModelCall(routes: readonly FactoryModelRoute[], call: {
  key: string; input: GenerateInput;
  requestSha256: (model: FactoryModelRoute["model"]) => string;
  evidenceId: (requestSha256: string) => string;
  unknownError: string;
  /** Receives one safe code when the outcome becomes unconfirmed (never provider text). */
  onUnconfirmed?: (subCause: string) => void;
  /** Persist the provider cooldown (best effort; never changes the outcome). */
  onCreditExhausted?: (provider: FactoryModelRoute["provider"], reason: string) => Promise<void> | void;
  /** A provider completed a call: its credit works (clears a stale cooldown). */
  onProviderCompleted?: (provider: FactoryModelRoute["provider"]) => Promise<void> | void;
}): Promise<{ result: FactoryTextResult; provider: FactoryModelRoute["provider"]; model: string; requestSha256: string }> {
  if (!routes.length) throw Error("FACTORY_MODEL_ROUTE_REQUIRED");
  // A key already present on any route's ledger is never executed again on
  // another provider (no cross-provider replay of a held or settled call).
  const ledgers = keyLedgers(routes);
  if (ledgers.length > 1) for (const { ledger } of ledgers) {
    if (await ledger.reservation(call.key)) {
      const error = Error("CREDIT_EXECUTION_ALREADY_ADMITTED"); ledgerOfError.set(error, ledger); throw error;
    }
  }
  for (const [index, route] of routes.entries()) {
    const last = index === routes.length - 1, requestSha256 = call.requestSha256(route.model);
    let dispatched = false, executed = false, sub: string | undefined;
    const generate = routeGenerator(route, call.key, () => { dispatched = true; });
    let served = route.model.model;
    try {
      // Claude: hold the worst case on the factory's monthly API authority first.
      // Refused (cap reached / unknown hold / replay) = fail closed, no Claude call.
      let authorityKey: string | undefined, authorityOwner = "";
      if (route.provider === "anthropic" && route.apiAuthority) {
        authorityKey = factoryAnthropicAuthorityKey(call.key); authorityOwner = route.apiAuthority.owner();
        const parent = currentFactoryApiParent();
        const held = await route.apiAuthority.store.reserveApi(authorityOwner, { key: authorityKey, consumer: "other", requestSha256: authorityHash(["factory-anthropic", requestSha256]), maximumMicroUsd: call.input.maxCostCents * 10000, ...(parent ? { parent: { jobId: parent.jobId, fence: parent.fence } } : {}) });
        if (!held.admitted) throw Error("FACTORY_API_DISPATCH_ALREADY_RESERVED");
      }
      const authority = route.provider === "anthropic" ? route.apiAuthority : undefined;
      let result: FactoryTextResult;
      try {
      result = await executeWithinSharedCredits(route.ledger, { key: call.key, consumer: "factory", requestSha256, maximumMicroUsd: call.input.maxCostCents * 10000 }, async () => {
        let generated: Awaited<ReturnType<typeof generate>>;
        try { generated = await generate(call.input); } catch (error) { sub = /^(?:FACTORY|CREDIT)_[A-Z0-9_]{2,80}$/.test(messageOf(error)) ? "PROVIDER_" + messageOf(error).replace(/^(?:FACTORY|CREDIT)_/, "").slice(0, 60) : "PROVIDER_THREW"; throw error; }
        if (generated.status === "unknown") { sub = /^FACTORY_[A-Z]+_EXECUTION_UNCONFIRMED:([A-Z_]{2,40})$/.exec(generated.reason)?.[1] ?? "PROVIDER_UNKNOWN"; throw Error(call.unknownError); }
        executed = true;
        if ("servedModel" in generated && typeof generated.servedModel === "string") served = generated.servedModel;
        return { value: generated, actualMicroUsd: generated.costCents * 10000, evidenceId: call.evidenceId(requestSha256) };
      }, () => dispatched);
      } catch (error) {
        // Not dispatched: provably unbilled, release at $0. Dispatched: unknown (fail closed).
        if (authority && authorityKey) {
          if (!dispatched) await authority.store.settleApi(authorityOwner, authorityKey, { actualMicroUsd: 0, evidenceSha256: authorityHash({ requestSha256, notDispatched: true }) }).catch(() => authority.store.unknownApi(authorityOwner, authorityKey!).catch(() => undefined));
          else await authority.store.unknownApi(authorityOwner, authorityKey).catch(() => undefined);
        }
        throw error;
      }
      if (authority && authorityKey) {
        const settled = await authority.store.settleApi(authorityOwner, authorityKey, { actualMicroUsd: result.costCents * 10000, evidenceSha256: authorityHash({ requestSha256, status: result.status, costCents: result.costCents }) }).then(r => (r as { settled?: boolean } | undefined)?.settled !== false, () => false);
        if (!settled) { await authority.store.unknownApi(authorityOwner, authorityKey).catch(() => undefined); throw Error("CREDIT_EXECUTION_UNCONFIRMED"); }
      }
      const exhausted = factoryModelCreditExhausted(route.provider, result);
      if (exhausted) { try { await (call.onCreditExhausted ?? processCreditHooks.onCreditExhausted)?.(route.provider, route.provider === "openai" ? "OPENAI_INSUFFICIENT_QUOTA" : "ANTHROPIC_CREDIT_EXHAUSTED"); } catch { /* diagnostics only */ } }
      else if (result.status === "completed") { try { await (call.onProviderCompleted ?? processCreditHooks.onProviderCompleted)?.(route.provider); } catch { /* diagnostics only */ } }
      if (!last && (exhausted || (route.provider === "openai" && isFactoryModelFallbackResult(result)))) continue;
      const { servedModel: _served, ...plain } = result as FactoryTextResult & { servedModel?: string };
      return { result: plain as FactoryTextResult, provider: route.provider, model: served, requestSha256 };
    } catch (error) {
      if (!last && route.provider === "openai" && isFactoryModelFallbackError(error)) continue;
      if (messageOf(error) === "CREDIT_EXECUTION_UNCONFIRMED") { try { call.onUnconfirmed?.(sub ?? (executed ? "LEDGER_SETTLE_FAILED" : "ROUTE_UNCONFIRMED")); } catch { /* diagnostics only */ } }
      if (error && typeof error === "object") ledgerOfError.set(error, route.ledger);
      throw error;
    }
  }
  throw Error("FACTORY_MODEL_ROUTE_REQUIRED");
}
