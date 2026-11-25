/** Persisted per-provider "out of credit" flag shared by the factory (GitHub
 * Actions) and the office (cloud worker / web) through the council store.
 * When a provider answers with its documented credit/billing exhaustion error
 * the flag is set; while it is active new jobs go straight to the other
 * provider. After the cooldown expires the next job probes the provider again
 * (one call, admitted by that provider's own ledger) and a successful call
 * clears the flag. Only code-owned codes are stored, never provider text. */
export type AiCreditProvider = "openai" | "anthropic";
export type ProviderCooldown = { provider: AiCreditProvider; reason: string; since: string; until: string };
export type ProviderCooldownState = { version: 1; providers: Partial<Record<AiCreditProvider, ProviderCooldown>> };
type Store = { read(owner: string): Promise<string | null>; transact(owner: string, update: (raw: string | null) => Promise<string>): Promise<string> };

export const AI_PROVIDER_COOLDOWN_OWNER = JSON.stringify(["ai-provider-credit-cooldown-v1", "shared"]);
export const AI_PROVIDER_COOLDOWN_DEFAULT_HOURS = 6;
const PROVIDERS: readonly AiCreditProvider[] = ["openai", "anthropic"];
const REASON = /^[A-Z][A-Z0-9_:]{2,99}$/;

/** OpenAI: HTTP 429 with error.code insufficient_quota (no credit) or the
 * prepaid-balance/billing-limit codes. A plain rate limit is NOT exhaustion. */
const OPENAI_EXHAUSTED_CODES = new Set(["insufficient_quota", "credit_balance_exhausted", "billing_hard_limit_reached", "billing_not_active"]);
/** Anthropic (docs: API errors): 402 billing_error, or 429 whose
 * error.details.error_code is enforced_spend_limit_reached (monthly spend cap).
 * Message text is never matched. */
export function isProviderCreditExhausted(provider: AiCreditProvider, status: number, code?: string | null, detailsCode?: string | null) {
  if (provider === "openai") return status === 429 && !!code && OPENAI_EXHAUSTED_CODES.has(code);
  return status === 402 || code === "billing_error" || (status === 429 && detailsCode === "enforced_spend_limit_reached");
}
/** Parses the factory's safe rejection cause FACTORY_OPENAI_REQUEST_REJECTED:<status>:<code>. */
export function isOpenAiRejectionCauseExhausted(cause: unknown) {
  const m = typeof cause === "string" ? /^FACTORY_OPENAI_REQUEST_REJECTED:(\d{3}):([a-z0-9_]{1,64})$/.exec(cause) : null;
  return !!m && isProviderCreditExhausted("openai", Number(m[1]), m[2]);
}

export function providerCooldownMs(env: NodeJS.ProcessEnv) {
  const raw = env.AI_PROVIDER_COOLDOWN_HOURS?.trim();
  const hours = raw ? Number(raw) : AI_PROVIDER_COOLDOWN_DEFAULT_HOURS;
  // Invalid values fall back to the default (a cooldown is never disabled by a typo).
  return Math.round((Number.isFinite(hours) && hours >= 0.25 && hours <= 168 ? hours : AI_PROVIDER_COOLDOWN_DEFAULT_HOURS) * 3600000);
}

function parse(raw: string | null): ProviderCooldownState {
  const empty: ProviderCooldownState = { version: 1, providers: {} };
  if (!raw) return empty;
  let value: any;
  try { value = JSON.parse(raw); } catch { return empty; }
  if (!value || value.version !== 1 || typeof value.providers !== "object" || !value.providers) return empty;
  const out: ProviderCooldownState = { version: 1, providers: {} };
  for (const p of PROVIDERS) {
    const row = value.providers[p];
    if (row && row.provider === p && typeof row.reason === "string" && REASON.test(row.reason) && Number.isFinite(Date.parse(row.since)) && Number.isFinite(Date.parse(row.until)))
      out.providers[p] = { provider: p, reason: row.reason, since: row.since, until: row.until };
  }
  return out;
}
/** Active cooldowns only (expired rows mean "probe allowed"). A read failure
 * returns no cooldowns: the ledgers still fail closed on their own. */
export async function readProviderCooldowns(store: Pick<Store, "read">, now: Date) {
  let state: ProviderCooldownState;
  try { state = parse(await store.read(AI_PROVIDER_COOLDOWN_OWNER)); } catch { return { readable: false, active: {} as Partial<Record<AiCreditProvider, ProviderCooldown>> }; }
  const active: Partial<Record<AiCreditProvider, ProviderCooldown>> = {};
  for (const p of PROVIDERS) { const row = state.providers[p]; if (row && Date.parse(row.until) > now.getTime()) active[p] = row; }
  return { readable: true, active };
}
export async function markProviderCreditExhausted(store: Store, provider: AiCreditProvider, reason: string, now: Date, cooldownMs: number) {
  const safe = REASON.test(reason) ? reason : "PROVIDER_CREDIT_EXHAUSTED";
  await store.transact(AI_PROVIDER_COOLDOWN_OWNER, async raw => {
    const state = parse(raw), prior = state.providers[provider], at = now.getTime();
    const since = prior && Date.parse(prior.until) > at ? prior.since : now.toISOString();
    state.providers[provider] = { provider, reason: safe, since, until: new Date(at + cooldownMs).toISOString() };
    return JSON.stringify(state);
  });
}
/** Called after a provider completed a paid call: credit is back. */
export async function clearProviderCooldown(store: Store, provider: AiCreditProvider) {
  const raw = await store.read(AI_PROVIDER_COOLDOWN_OWNER);
  if (!parse(raw).providers[provider]) return;
  await store.transact(AI_PROVIDER_COOLDOWN_OWNER, async current => {
    const state = parse(current); delete state.providers[provider]; return JSON.stringify(state);
  });
}

export type ProviderView = { active: AiCreditProvider | null; reason: string; cooldowns: Array<{ provider: AiCreditProvider; reason: string; since: string; until: string }> };
/** Which provider new work uses and why (Spanish text for the panel). */
export function describeActiveProvider(input: { active: Partial<Record<AiCreditProvider, ProviderCooldown>>; openAiConfigured: boolean; anthropicConfigured: boolean }): ProviderView {
  const cooldowns = PROVIDERS.flatMap(p => input.active[p] ? [input.active[p]!] : []);
  const openOk = input.openAiConfigured && !input.active.openai, claudeOk = input.anthropicConfigured && !input.active.anthropic;
  if (openOk) return { active: "openai", reason: claudeOk ? "OpenAI principal; Claude listo como respaldo." : input.active.anthropic ? "OpenAI principal; Claude sin crédito (en espera)." : "OpenAI principal; respaldo Claude no configurado.", cooldowns };
  if (claudeOk) return { active: "anthropic", reason: input.active.openai ? `Claude activo: OpenAI sin crédito (${input.active.openai.reason}) hasta ${input.active.openai.until}.` : "Claude activo: OpenAI no configurado.", cooldowns };
  return { active: null, reason: cooldowns.length ? "Ningún proveedor con crédito: el trabajo queda bloqueado (falla cerrado)." : "Ningún proveedor configurado.", cooldowns };
}
