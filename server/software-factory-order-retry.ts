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
const SELECTION = /^FACTORY_AUTO_SELECTION_NOT_COMPLETED(?:_[A-Z0-9_]{1,80})?$/;

/** True only for a zero-cost stop caused by infrastructure, never by the order or the code. */
export function isInfrastructureStop(job: FactoryJob): boolean {
  if (job.status !== "blocked" && job.status !== "failed") return false;
  const result = job.result as { reason?: unknown; costCents?: unknown } | undefined;
  if (typeof result?.reason !== "string" || result.costCents !== 0) return false;
  const reason = result.reason.replace(/^FACTORY_REMOTE_BUILD_FAILED:/, "");
  if (INFRA.test(reason)) return true;
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
export function companyOrderRetryAttempt(jobs: readonly FactoryJob[], ownerKey: string, orderId: string, revision: string): number {
  const own = jobs.filter(j => j?.ownerKey === ownerKey);
  const roots = own.filter(j => {
    const s = j.kind === "discover" ? j.payload?.companyOrder as { orderId?: unknown; revision?: unknown } | undefined : undefined;
    return s?.orderId === orderId && s.revision === revision;
  });
  if (!roots.length) return 0;
  const latest = roots.reduce((a, b) => companyOrderRetryOf(b) > companyOrderRetryOf(a) ? b : a), attempt = companyOrderRetryOf(latest);
  if (attempt >= FACTORY_ORDER_MAX_RETRIES) return attempt;
  const chain = own.filter(j => j.id === latest.id || rootOf(j) === latest.id || j.key === `${latest.id}.next` || j.payload?.previousJobId === latest.id);
  if (chain.some(j => j.status === "pending" || j.status === "running" || j.status === "unknown")) return attempt;
  const stopped = chain.filter(j => j.status === "blocked" || j.status === "failed");
  // Any spend or non-infrastructure stop in the chain keeps the order settled.
  if (!stopped.length || !stopped.every(isInfrastructureStop)) return attempt;
  return attempt + 1;
}
