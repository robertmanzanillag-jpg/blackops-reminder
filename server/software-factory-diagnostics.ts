/** Public logs contain only code-owned categories, never exception text or data. */
const failureCodes = new Set([
  "FACTORY_ONCE_CONFIGURATION_REQUIRED", "FACTORY_OWNER_REQUIRED",
  "FACTORY_ONCE_SCOPE_INVALID", "FACTORY_ONCE_NOT_CONFIGURED",
  "FACTORY_OPERATOR_OWNER_MISMATCH", "FACTORY_OPERATOR_PROJECT_INVALID",
  "FACTORY_OPERATOR_PRIVATE_PATH_REQUIRED", "FACTORY_OPERATOR_PRIVATE_PATH_INVALID",
  "FACTORY_OPERATOR_PRIVATE_FILE_INVALID", "FACTORY_OPERATOR_CONFIGURATION_INVALID",
  "FACTORY_OPERATOR_CREDIT_UNAVAILABLE", "FACTORY_OPERATOR_CREDIT_UNCERTAIN",
  "FACTORY_OPERATOR_CREDIT_EXPIRED", "FACTORY_OPERATOR_CREDIT_OVERRUN",
  "FACTORY_OPERATOR_CREDIT_INSUFFICIENT", "FACTORY_OPERATOR_PRICING_EXPIRED",
  "CREDIT_RUNTIME_CONFIGURATION_REQUIRED", "CREDIT_RUNTIME_CONFIGURATION_INVALID",
  "FACTORY_FIXED_COST_RESERVATION_REQUIRED", "FACTORY_BUDGET_UNVERIFIED",
  "FACTORY_PIPELINE_UNAVAILABLE",
]);
export type FactoryOncePhase = "configuration" | "imports" | "database" | "operator" | "state" | "execution" | "shutdown";
export function factoryOnceFailure(error: unknown, phase: FactoryOncePhase) {
  // Even shaped provider/DB errors are untrusted: never copy a stack, cause,
  // arbitrary message, SQL detail, URL or identifier into Actions logs.
  let code = "FACTORY_ONCE_UNAVAILABLE";
  try {
    if (error instanceof Error && failureCodes.has(error.message)) code = error.message;
    else if (error && typeof error === "object" && "code" in error && error.code === "55P03") code = "FACTORY_DATABASE_LOCK_UNAVAILABLE";
  } catch { /* A hostile getter is still an unclassified failure. */ }
  return { event: "factory_once_failure", phase, code, automaticReplay: false };
}

/** Preserve all admission guards, with a distinct safe reason for each refusal. */
export function assertFactoryCreditReady(budget: {
  uncertain: boolean; expired: boolean; overrun: boolean; availableMicroUsd: number;
}, requiredMicroUsd: number, pricingValidUntil: string, now: number) {
  if (budget.uncertain) throw Error("FACTORY_OPERATOR_CREDIT_UNCERTAIN");
  if (budget.expired) throw Error("FACTORY_OPERATOR_CREDIT_EXPIRED");
  if (budget.overrun) throw Error("FACTORY_OPERATOR_CREDIT_OVERRUN");
  if (!Number.isFinite(budget.availableMicroUsd) || !Number.isFinite(requiredMicroUsd) || requiredMicroUsd < 0 || budget.availableMicroUsd < requiredMicroUsd) throw Error("FACTORY_OPERATOR_CREDIT_INSUFFICIENT");
  const expires = Date.parse(pricingValidUntil);
  if (!Number.isFinite(now) || !Number.isFinite(expires) || expires <= now) throw Error("FACTORY_OPERATOR_PRICING_EXPIRED");
}
