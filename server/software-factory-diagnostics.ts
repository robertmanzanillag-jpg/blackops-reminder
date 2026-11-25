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
  "FACTORY_ANTHROPIC_FALLBACK_UNAVAILABLE", "FACTORY_ANTHROPIC_CREDIT_UNCERTAIN",
  "FACTORY_ANTHROPIC_CREDIT_EXPIRED", "FACTORY_ANTHROPIC_CREDIT_OVERRUN",
  "FACTORY_ANTHROPIC_CREDIT_INSUFFICIENT", "FACTORY_ANTHROPIC_PRICING_EXPIRED",
  "FACTORY_ANTHROPIC_STORAGE_REQUIRED", "FACTORY_ANTHROPIC_BUDGET_INVALID",
  "FACTORY_ANTHROPIC_CREDENTIAL_REQUIRED", "FACTORY_ANTHROPIC_LEDGER_MISMATCH",
  "FACTORY_ANTHROPIC_CLOCK_UNVERIFIED",
]);
export type FactoryOncePhase = "configuration" | "imports" | "database" | "operator" | "state" | "execution" | "shutdown";
/** Code-owned constants only: exact uppercase identifiers, optionally one `:SUFFIX`. */
const codeOwnedPattern = /^(?:FACTORY|SOFTWARE_FACTORY|CREDIT|SELF_HEAL|OWNER_ORDER|COMPANY_ORDER)_[A-Z0-9_]{2,64}(?::[A-Z0-9_]{2,64})?$/;
export function factoryOnceFailure(error: unknown, phase: FactoryOncePhase, stage?: string) {
  // Even shaped provider/DB errors are untrusted: never copy a stack, cause,
  // arbitrary message, SQL detail, URL or identifier into Actions logs.
  let code = "FACTORY_ONCE_UNAVAILABLE";
  try {
    if (error && typeof error === "object") {
      const message = Object.getOwnPropertyDescriptor(error, "message")?.value;
      const databaseCode = Object.getOwnPropertyDescriptor(error, "code")?.value;
      if (error instanceof Error && typeof message === "string" && failureCodes.has(message)) code = message;
      else if (error instanceof Error && typeof message === "string" && codeOwnedPattern.test(message)) code = message;
      else if (databaseCode === "55P03") code = "FACTORY_DATABASE_LOCK_UNAVAILABLE";
    }
  } catch { /* A hostile getter is still an unclassified failure. */ }
  const safeStage = typeof stage === "string" && /^[a-z-]{1,24}$/.test(stage) ? stage : undefined;
  const unclassified = code === "FACTORY_ONCE_UNAVAILABLE" ? unclassifiedShape(error) : {};
  return { event: "factory_once_failure", phase, ...(safeStage ? { stage: safeStage } : {}), code, ...unclassified, automaticReplay: false };
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

/** For unclassified errors only: the constructor name and the first stack
 * frame as `file:line` (basename only). Never the message, path, cause or data. */
export function unclassifiedShape(error: unknown): { errorClass?: string; frame?: string } {
  const out: { errorClass?: string; frame?: string } = {};
  try {
    if (!(error instanceof Error)) return error === undefined ? {} : { errorClass: `CLASS_${error === null ? "null" : typeof error}` };
    const name = error.constructor?.name;
    out.errorClass = typeof name === "string" && /^[A-Za-z][A-Za-z0-9_]{0,40}$/.test(name) ? `CLASS_${name}` : "CLASS_UNKNOWN";
    // V8 may expose `stack` as an accessor; read it (inside try) but use only frames.
    const stack: unknown = (error as { stack?: unknown }).stack;
    if (typeof stack === "string") {
      for (const line of stack.split("\n").slice(0, 64)) {
        if (!/^\s+at\s/.test(line)) continue;
        const match = /([A-Za-z0-9_.-]{1,80}\.(?:ts|tsx|mts|cts|mjs|cjs|js)):(\d{1,6})(?::\d{1,6})?\)?\s*$/.exec(line);
        if (match) { out.frame = `${match[1]}:${match[2]}`; break; }
      }
    }
  } catch { /* hostile getters: keep what is known */ }
  return out;
}
