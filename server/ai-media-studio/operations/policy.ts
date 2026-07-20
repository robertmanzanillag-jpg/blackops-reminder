export interface WorkAdmissionRequest {
  tenantId: string;
  providerKey: string;
  language: string;
  country: string;
  timeZone: string;
  estimatedCostUsd: number;
}

export interface WorkAdmissionUsage {
  activeTotal: number;
  activeByProvider: Readonly<Record<string, number>>;
  activeByTenant: Readonly<Record<string, number>>;
  tenantSpendTodayUsd: number;
}

export interface OperationsAdmissionPolicy {
  concurrency: {
    total: number;
    perProvider: number;
    perTenant: number;
    providerOverrides?: Readonly<Record<string, number>>;
    tenantOverrides?: Readonly<Record<string, number>>;
  };
  allowedLanguages?: readonly string[];
  allowedCountries?: readonly string[];
  allowedTimeZones?: readonly string[];
  tenantDailyBudgetUsd: number;
  tenantDailyBudgetOverrides?: Readonly<Record<string, number>>;
}

export type AdmissionDenialCode =
  | "invalid_request"
  | "language_not_allowed"
  | "country_not_allowed"
  | "timezone_not_allowed"
  | "total_quota_exhausted"
  | "provider_quota_exhausted"
  | "tenant_quota_exhausted"
  | "daily_budget_exhausted";

export type AdmissionDecision =
  | { admitted: true; reservedCostUsd: number }
  | { admitted: false; code: AdmissionDenialCode; reason: string };

function finiteNonNegative(value: number): boolean {
  return Number.isFinite(value) && value >= 0;
}

function normalizedSet(values: readonly string[] | undefined, transform: (value: string) => string): Set<string> | undefined {
  if (values === undefined) return undefined;
  return new Set(values.map((value) => transform(value.trim())).filter(Boolean));
}

function limit(override: number | undefined, fallback: number): number {
  return override ?? fallback;
}

/** Pure admission check. Callers must reserve quota and budget atomically in durable implementations. */
export function evaluateWorkAdmission(
  request: WorkAdmissionRequest,
  usage: WorkAdmissionUsage,
  policy: OperationsAdmissionPolicy,
): AdmissionDecision {
  if (!request.tenantId.trim() || !request.providerKey.trim() || !request.language.trim()
    || !request.country.trim() || !request.timeZone.trim() || !finiteNonNegative(request.estimatedCostUsd)) {
    return { admitted: false, code: "invalid_request", reason: "Admission metadata and a non-negative finite cost are required" };
  }
  const numericPolicy = [
    policy.concurrency.total,
    policy.concurrency.perProvider,
    policy.concurrency.perTenant,
    policy.tenantDailyBudgetUsd,
    ...Object.values(policy.concurrency.providerOverrides ?? {}),
    ...Object.values(policy.concurrency.tenantOverrides ?? {}),
    ...Object.values(policy.tenantDailyBudgetOverrides ?? {}),
  ];
  if (numericPolicy.some((value) => !finiteNonNegative(value))) {
    return { admitted: false, code: "invalid_request", reason: "Policy limits must be finite and non-negative" };
  }

  const languages = normalizedSet(policy.allowedLanguages, (value) => value.toLowerCase());
  const countries = normalizedSet(policy.allowedCountries, (value) => value.toUpperCase());
  const timeZones = normalizedSet(policy.allowedTimeZones, (value) => value);
  if (languages && !languages.has(request.language.toLowerCase())) {
    return { admitted: false, code: "language_not_allowed", reason: `Language ${request.language} is outside policy` };
  }
  if (countries && !countries.has(request.country.toUpperCase())) {
    return { admitted: false, code: "country_not_allowed", reason: `Country ${request.country} is outside policy` };
  }
  if (timeZones && !timeZones.has(request.timeZone)) {
    return { admitted: false, code: "timezone_not_allowed", reason: `Time zone ${request.timeZone} is outside policy` };
  }
  if (usage.activeTotal >= policy.concurrency.total) {
    return { admitted: false, code: "total_quota_exhausted", reason: "Total concurrency quota is exhausted" };
  }
  const providerLimit = limit(policy.concurrency.providerOverrides?.[request.providerKey], policy.concurrency.perProvider);
  if ((usage.activeByProvider[request.providerKey] ?? 0) >= providerLimit) {
    return { admitted: false, code: "provider_quota_exhausted", reason: "Provider concurrency quota is exhausted" };
  }
  const tenantLimit = limit(policy.concurrency.tenantOverrides?.[request.tenantId], policy.concurrency.perTenant);
  if ((usage.activeByTenant[request.tenantId] ?? 0) >= tenantLimit) {
    return { admitted: false, code: "tenant_quota_exhausted", reason: "Tenant concurrency quota is exhausted" };
  }
  const budget = limit(policy.tenantDailyBudgetOverrides?.[request.tenantId], policy.tenantDailyBudgetUsd);
  if (!finiteNonNegative(usage.tenantSpendTodayUsd)
    || usage.tenantSpendTodayUsd + request.estimatedCostUsd > budget) {
    return { admitted: false, code: "daily_budget_exhausted", reason: "Tenant daily budget would be exceeded" };
  }
  return { admitted: true, reservedCostUsd: request.estimatedCostUsd };
}
