import { MAX_MICRO_USD, type Sha256Digest } from "./contracts";

export const MAXIMUM_QUOTE_UNAVAILABLE_REASON_CODES = [
  "invalid_locked_request",
  "unsupported_provider",
  "authoritative_account_quote_unavailable",
  "provider_unavailable",
  "provider_response_untrusted",
] as const;
export type MaximumQuoteUnavailableReasonCode = (typeof MAXIMUM_QUOTE_UNAVAILABLE_REASON_CODES)[number];

/** Server-owned locked records only; no secret or provider payload belongs here. */
export interface LockedMaximumQuoteRequest {
  readonly subject: Readonly<{ dailyPlanId: string; dailyPlanSlotId: string; slotAttempt: number; subjectDigest: Sha256Digest }>;
  readonly renderSpec: Readonly<{ renderSpecDigest: Sha256Digest }>;
  readonly account: Readonly<{ providerKey: string; providerAccountId: string; accountBindingDigest: Sha256Digest }>;
  readonly credential: Readonly<{ providerCredentialVersion: number; credentialBindingDigest: Sha256Digest }>;
  readonly requestContext: Readonly<{ databaseNow: string; idempotencyKey: string }>;
}

export type MaximumQuoteOutcome = Readonly<{
  kind: "quoted"; providerKey: string; amountMicroUsd: string; currency: "USD";
  observedAt: string; expiresAt: string; sourceDigest: Sha256Digest;
}> | Readonly<{
  kind: "unavailable"; providerKey: string; reasonCode: MaximumQuoteUnavailableReasonCode;
}>;

export interface MaximumQuoteProvider {
  requestMaximumQuote(request: Readonly<LockedMaximumQuoteRequest>): Promise<MaximumQuoteOutcome>;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const SHA256 = /^sha256:[0-9a-f]{64}$/u;
const PROVIDER_KEY = /^[a-z][a-z0-9_-]{0,79}$/u;
const MICRO_USD = /^[1-9][0-9]{0,15}$/u;
const ISO_MILLISECONDS = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;
const IDEMPOTENCY_KEY = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/u;
const isExactObject = (value: unknown, expectedKeys: readonly string[]): value is Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const keys = Object.keys(value as Record<string, unknown>).sort(); const expected = [...expectedKeys].sort();
  return keys.length === expected.length && keys.every((key, index) => key === expected[index]);
};
const isDigest = (value: unknown): value is Sha256Digest => typeof value === "string" && SHA256.test(value);
const isExactIsoInstant = (value: unknown): value is string => {
  if (typeof value !== "string" || !ISO_MILLISECONDS.test(value)) return false;
  const instant = new Date(value); return Number.isFinite(instant.getTime()) && instant.toISOString() === value;
};

/** Rejects extra keys so browser/provider values cannot be smuggled into the locked request. */
export function isLockedMaximumQuoteRequest(value: unknown): value is LockedMaximumQuoteRequest {
  if (!isExactObject(value, ["subject", "renderSpec", "account", "credential", "requestContext"])) return false;
  const request = value as unknown as LockedMaximumQuoteRequest;
  return isExactObject(request.subject, ["dailyPlanId", "dailyPlanSlotId", "slotAttempt", "subjectDigest"])
    && UUID.test(request.subject.dailyPlanId) && UUID.test(request.subject.dailyPlanSlotId)
    && Number.isSafeInteger(request.subject.slotAttempt) && request.subject.slotAttempt >= 1
    && isDigest(request.subject.subjectDigest)
    && isExactObject(request.renderSpec, ["renderSpecDigest"]) && isDigest(request.renderSpec.renderSpecDigest)
    && isExactObject(request.account, ["providerKey", "providerAccountId", "accountBindingDigest"])
    && typeof request.account.providerKey === "string" && PROVIDER_KEY.test(request.account.providerKey)
    && UUID.test(request.account.providerAccountId) && isDigest(request.account.accountBindingDigest)
    && isExactObject(request.credential, ["providerCredentialVersion", "credentialBindingDigest"])
    && Number.isSafeInteger(request.credential.providerCredentialVersion)
    && request.credential.providerCredentialVersion >= 1 && isDigest(request.credential.credentialBindingDigest)
    && isExactObject(request.requestContext, ["databaseNow", "idempotencyKey"])
    && isExactIsoInstant(request.requestContext.databaseNow)
    && IDEMPOTENCY_KEY.test(request.requestContext.idempotencyKey);
}

/** Enforces exact integer micro-USD, USD, expiry ordering, and source digest. */
export function isMaximumQuoteOutcome(value: unknown): value is MaximumQuoteOutcome {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const outcome = value as Partial<MaximumQuoteOutcome>;
  if (outcome.kind === "unavailable") return isExactObject(value, ["kind", "providerKey", "reasonCode"])
    && typeof outcome.providerKey === "string" && PROVIDER_KEY.test(outcome.providerKey)
    && typeof outcome.reasonCode === "string"
    && (MAXIMUM_QUOTE_UNAVAILABLE_REASON_CODES as readonly string[]).includes(outcome.reasonCode);
  if (outcome.kind !== "quoted" || !isExactObject(value,
    ["kind", "providerKey", "amountMicroUsd", "currency", "observedAt", "expiresAt", "sourceDigest"])) return false;
  const quote = outcome as Extract<MaximumQuoteOutcome, { kind: "quoted" }>;
  if (!PROVIDER_KEY.test(quote.providerKey) || !MICRO_USD.test(quote.amountMicroUsd)
    || BigInt(quote.amountMicroUsd) > MAX_MICRO_USD || quote.currency !== "USD"
    || !isExactIsoInstant(quote.observedAt) || !isExactIsoInstant(quote.expiresAt) || !isDigest(quote.sourceDigest)) return false;
  return new Date(quote.expiresAt).getTime() > new Date(quote.observedAt).getTime();
}
