import { createSharedOpenAiCreditLedger, type CreditTransaction, type SharedCreditState, type VerifiedCreditGrant } from "./shared-openai-credit-ledger";
import type { createCouncilStore } from "./agent-council-store";
import { ANTHROPIC_FACTORY_MODEL, ANTHROPIC_FACTORY_PRICES, ANTHROPIC_FACTORY_PRICING_VALID_UNTIL } from "./software-factory-anthropic";

type DurableStore = Pick<ReturnType<typeof createCouncilStore>, "transact">;
export const ANTHROPIC_FACTORY_ACCOUNT_SCOPE = "factory-anthropic";
export const ANTHROPIC_FACTORY_DEFAULT_MONTHLY_BUDGET_USD = 50;

/** On only when an Anthropic key is configured; FACTORY_ANTHROPIC_FALLBACK_ENABLED
 * "false" turns it off. Without a key the factory behaves exactly as before. */
export function factoryAnthropicFallbackEnabled(env: NodeJS.ProcessEnv) {
  return !!env.ANTHROPIC_API_KEY?.trim() && env.FACTORY_ANTHROPIC_FALLBACK_ENABLED?.trim().toLowerCase() !== "false";
}
/** Monthly cap in USD. Empty means the default; anything invalid fails closed. */
export function factoryAnthropicMonthlyBudgetMicroUsd(env: NodeJS.ProcessEnv) {
  const raw = env.FACTORY_ANTHROPIC_MONTHLY_BUDGET_USD?.trim();
  const usd = raw ? Number(raw) : ANTHROPIC_FACTORY_DEFAULT_MONTHLY_BUDGET_USD;
  if (!Number.isFinite(usd) || usd < 0 || usd > 10000) throw Error("FACTORY_ANTHROPIC_BUDGET_INVALID");
  return Math.floor(usd * 1000000);
}
const monthWindow = (now: Date) => {
  const at = now.getTime();
  if (!Number.isFinite(at)) throw Error("FACTORY_ANTHROPIC_CLOCK_UNVERIFIED");
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)), end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  return { month: start.toISOString().slice(0, 7), start: start.toISOString(), end: end.toISOString() };
};
/** The cap is the grant: one grant per UTC month. */
export function anthropicMonthlyGrant(now: Date, capMicroUsd: number): VerifiedCreditGrant {
  const w = monthWindow(now);
  return { id: `anthropic-factory-${w.month}`, accountScope: ANTHROPIC_FACTORY_ACCOUNT_SCOPE, availableMicroUsd: capMicroUsd,
    observedAt: w.start, expiresAt: w.end, verificationEvidenceId: "operator-env-FACTORY_ANTHROPIC_MONTHLY_BUDGET_USD" };
}

/** Separate PostgreSQL row per month (never the OpenAI ledger row). The first
 * use in a month creates that month's empty row. The cap is re-read from the
 * environment on every start, so raising/lowering it takes effect in place;
 * all settled spend and holds are kept, and the reservation/settle/unknown
 * rules are exactly the shared OpenAI ledger's. */
export function createAnthropicMonthlyTransaction(store: DurableStore, grant: VerifiedCreditGrant): CreditTransaction {
  const owner = JSON.stringify(["factory-anthropic-budget-ledger-v1", grant.accountScope, grant.id]);
  return async <T>(mutate: (state: SharedCreditState) => T): Promise<T> => {
    let result: T;
    await store.transact(owner, async raw => {
      const state: SharedCreditState = raw === null
        ? { version: 1, grant: structuredClone(grant), reservations: [], lastObservedAt: grant.observedAt }
        : JSON.parse(raw);
      if (!state.grant || state.grant.id !== grant.id || state.grant.accountScope !== grant.accountScope || state.grant.observedAt !== grant.observedAt || state.grant.expiresAt !== grant.expiresAt) throw Error("FACTORY_ANTHROPIC_LEDGER_MISMATCH");
      state.grant.availableMicroUsd = grant.availableMicroUsd;
      result = structuredClone(mutate(state));
      return JSON.stringify(state);
    });
    return result!;
  };
}
export function createAnthropicFactoryLedger(options: { store: DurableStore; now: () => Date; capMicroUsd: number }) {
  const grant = anthropicMonthlyGrant(options.now(), options.capMicroUsd);
  return createSharedOpenAiCreditLedger({ grant, now: options.now, maximumGrantObservationAgeMs: 3600000, transact: createAnthropicMonthlyTransaction(options.store, grant) });
}

export const anthropicFactoryPricing = () => ({ model: ANTHROPIC_FACTORY_MODEL, inputNanoUsdPerToken: ANTHROPIC_FACTORY_PRICES[ANTHROPIC_FACTORY_MODEL].input,
  outputNanoUsdPerToken: ANTHROPIC_FACTORY_PRICES[ANTHROPIC_FACTORY_MODEL].output, validUntil: ANTHROPIC_FACTORY_PRICING_VALID_UNTIL });

/** Same shape as loadSharedCreditRuntime: { ledger, pricing }. Requires the
 * same PostgreSQL council store; no in-memory fallback. */
export async function loadAnthropicFactoryRuntime(env: NodeJS.ProcessEnv, now: () => Date, store?: DurableStore) {
  if (!factoryAnthropicFallbackEnabled(env)) throw Error("FACTORY_ANTHROPIC_FALLBACK_DISABLED");
  if (!store && env.AGENT_COUNCIL_STORAGE !== "postgres") throw Error("FACTORY_ANTHROPIC_STORAGE_REQUIRED");
  const durable = store ?? await (await import("./agent-council-store")).getCouncilStore();
  const ledger = createAnthropicFactoryLedger({ store: durable, now, capMicroUsd: factoryAnthropicMonthlyBudgetMicroUsd(env) });
  await ledger.status();
  return { ledger, pricing: anthropicFactoryPricing() };
}
