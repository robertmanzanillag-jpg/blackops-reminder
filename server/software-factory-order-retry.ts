import type { FactoryJob } from "./software-factory-store";

/** Bounded re-admission of a company order whose factory chain stopped purely
 * for an infrastructure / pre-dispatch reason that cost nothing (provider
 * admission held, API month not reconciled, pricing unverified, file selection
 * not completed before the deterministic selector of #542). Pure: never
 * admits, never calls a provider. The operator applies it only when the
 * current API readiness check passes, and the normal admission path still
 * enforces credits, daily caps and the credit pacer. */
export const FACTORY_ORDER_MAX_RETRIES = 2;
/** #542 (deterministic self-heal selection) merged at this instant; an
 * auto-selection NOT_COMPLETED block before it is an infrastructure gap. */
export const FACTORY_SELECTION_FIX_MERGED_AT = "2026-11-25T04:45:22Z";

const INFRA = /^(?:PROVIDER_BLOCKED|PROVIDER_ADMISSION_UNAVAILABLE(?::[A-Z0-9_]{1,80})?|PROVIDER_PRICING_UNVERIFIED|FACTORY_API_RECONCILIATION_REQUIRED|FACTORY_API_PRICING_UNVERIFIED|FACTORY_API_CACHE_WRITE_PRICING_UNVERIFIED|FACTORY_MONTH_UNINITIALIZED)$/;
/** $0 provider credit/quota rejections (the provider refused before any token
 * was billed): OpenAI 429 insufficient_quota / credit_balance_exhausted /
 * billing codes, Anthropic 402 billing_error or 429 enforced_spend_limit_reached,
 * or every provider exhausted. Retry-eligible only while a provider with
 * credit is available (ai-provider-credit-cooldown.ts). */
const CREDIT = /^(?:PROVIDER_REQUEST_REJECTED:)?(?:FACTORY_OPENAI_REQUEST_REJECTED:429:(?:insufficient_quota|credit_balance_exhausted|billing_hard_limit_reached|billing_not_active)|FACTORY_ANTHROPIC_REQUEST_REJECTED:(?:402:[a-z0-9_]{1,64}|4\d\d:billing_error|429:enforced_spend_limit_reached)|FACTORY_ANTHROPIC_CREDIT_EXHAUSTED|FACTORY_ALL_PROVIDERS_CREDIT_EXHAUSTED|FACTORY_OPENAI_PROVIDER_COOLDOWN|OPENAI_INSUFFICIENT_QUOTA|ANTHROPIC_CREDIT_EXHAUSTED)$/;
export type RetryOptions = { creditAvailable?: boolean };
const reasonOf = (job: FactoryJob) => {
  if (job.status !== "blocked" && job.status !== "failed") return undefined;
  const result = job.result as { reason?: unknown; costCents?: unknown } | undefined;
  return typeof result?.reason === "string" && result.costCents === 0 ? result.reason.replace(/^FACTORY_REMOTE_BUILD_FAILED:/, "") : undefined;
};
/** True for a zero-cost stop because a provider had no credit/quota. */
export function isProviderCreditStop(job: FactoryJob): boolean { const r = reasonOf(job); return r !== undefined && CREDIT.test(r); }
const SELECTION = /^FACTORY_AUTO_SELECTION_NOT_COMPLETED(?:_[A-Z0-9_]{1,80})?$/;
/** $0 pre-dispatch stops because the stage reservation could not cover the
 * provider's worst case (software-factory-anthropic.ts / -openai.ts). The
 * provider was never called; the owner fixes it by raising the reservation in
 * SOFTWARE_FACTORY_OPERATOR_CONFIG_JSON, so the order must stay re-admittable
 * (bounded by FACTORY_ORDER_MAX_RETRIES) at any time, not only before #542. */
const RESERVATION = /^(?:FACTORY_AUTO_SELECTION_NOT_COMPLETED_(?:ANTHROPIC|OPENAI)_BUDGET_UNAVAILABLE|FACTORY_(?:ANTHROPIC|OPENAI)_BUDGET_UNAVAILABLE|PROVIDER_BUDGET_UNAVAILABLE)$/;

/** $0 pre-dispatch stops because the counted build input exceeded
 * maxInputTokens, or the count was unusable (before #583 an over-cap Claude
 * count was reported as COUNT_INVALID). The provider generated nothing; the
 * builder now shrinks the context deterministically, so one more bounded try
 * (FACTORY_ORDER_MAX_RETRIES, costCents===0 only) can succeed. */
const INPUT_SIZE = /^(?:FACTORY_AUTO_SELECTION_NOT_COMPLETED_)?(?:PROVIDER_(?:INPUT_TOO_LARGE|COUNT_INVALID)|FACTORY_(?:ANTHROPIC|OPENAI)_(?:INPUT_TOO_LARGE|COUNT_INVALID)|(?:ANTHROPIC|OPENAI)_(?:INPUT_TOO_LARGE|COUNT_INVALID))$/;
/** $0 discovery stop on a retry whose selection key was already settled; the
 * selector now reuses the persisted selection, so it is retryable (bounded). */
const SELECTION_REUSE = /^FACTORY_AUTO_SELECTION_ALREADY_EXECUTED$/;

/** True only for a zero-cost stop caused by infrastructure, never by the order or the code. */
export function isInfrastructureStop(job: FactoryJob, options: RetryOptions = {}): boolean {
  const reason = reasonOf(job);
  if (reason === undefined) return false;
  if (INFRA.test(reason) || RESERVATION.test(reason) || INPUT_SIZE.test(reason) || SELECTION_REUSE.test(reason)) return true;
  if (CREDIT.test(reason)) return options.creditAvailable === true;
  return SELECTION.test(reason) && job.kind === "discover" && !!job.completedAt && Date.parse(job.completedAt) < Date.parse(FACTORY_SELECTION_FIX_MERGED_AT);
}

const rootOf = (job: FactoryJob) => (job.result as { evidence?: { pipelineState?: { rootJobId?: unknown } } } | undefined)?.evidence?.pipelineState?.rootJobId;
export const companyOrderRetryOf = (job: FactoryJob): number => {
  const r = (job.payload?.companyOrder as { retry?: unknown } | undefined)?.retry;
  return Number.isSafeInteger(r) && (r as number) >= 1 && (r as number) <= FACTORY_ORDER_MAX_RETRIES ? r as number : 0;
};

/** Which retry index the order's next admission must use: the latest admitted
 * attempt (idempotent, keeps a running chain visible) or the next one when the
 * latest chain stopped for a zero-cost infrastructure reason. */
export function companyOrderRetryAttempt(jobs: readonly FactoryJob[], ownerKey: string, orderId: string, revision: string, options: RetryOptions = {}): number {
  const own = jobs.filter(j => j?.ownerKey === ownerKey);
  const roots = own.filter(j => {
    const s = j.kind === "discover" ? j.payload?.companyOrder as { orderId?: unknown; revision?: unknown } | undefined : undefined;
    return s?.orderId === orderId && s.revision === revision;
  });
  if (!roots.length) return 0;
  const latest = roots.reduce((a, b) => companyOrderRetryOf(b) > companyOrderRetryOf(a) ? b : a), attempt = companyOrderRetryOf(latest);
  if (attempt >= FACTORY_ORDER_MAX_RETRIES) return attempt;
  return isZeroCostInfrastructureChain(own, latest, options) ? attempt + 1 : attempt;
}

/** True when the chain rooted at this discover job finished, spent nothing,
 * opened nothing and every stop was a zero-cost infrastructure stop. Such an
 * attempt never reached a provider, so it must not consume daily admissions.
 * A $0 credit/quota rejection counts only with options.creditAvailable. */
export function isZeroCostInfrastructureChain(jobs: readonly FactoryJob[], root: FactoryJob, options: RetryOptions = {}): boolean {
  if (!root || root.kind !== "discover") return false;
  const chain = jobs.filter(j => j?.ownerKey === root.ownerKey && (j.id === root.id || rootOf(j) === root.id || j.key === `${root.id}.next` || j.payload?.previousJobId === root.id));
  if (chain.some(j => j.status === "pending" || j.status === "running" || j.status === "unknown")) return false;
  // Any recorded spend, or any stage past the root that completed (it may have
  // dispatched to a provider or opened a draft PR), keeps the order settled.
  // Exception: a completed root discovery whose paid file selection was persisted
  // (finding.sourcePaths). Its retry reuses that selection at $0 (stable
  // selection key, never replayed), so only the $0 later stops decide.
  const reusable = root.status === "completed" && Array.isArray((root.result as { evidence?: { pipelineState?: { finding?: { sourcePaths?: unknown } } } } | undefined)?.evidence?.pipelineState?.finding?.sourcePaths);
  if (chain.some(j => { const c = (j.result as { costCents?: unknown } | undefined)?.costCents; return (c !== undefined && c !== 0 && !(reusable && j.id === root.id)) || (j.id !== root.id && j.status === "completed"); })) return false;
  const stopped = chain.filter(j => j.status === "blocked" || j.status === "failed");
  // Any spend or non-infrastructure stop in the chain keeps the order settled.
  return stopped.length > 0 && stopped.every(j => isInfrastructureStop(j, options));
}
