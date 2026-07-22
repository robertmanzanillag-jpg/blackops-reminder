import assert from "node:assert/strict";
import test from "node:test";
import {
  isLockedMaximumQuoteRequest,
  isMaximumQuoteOutcome,
  type LockedMaximumQuoteRequest,
} from "../server/ai-media-studio/planning/maximum-quote-provider-contracts";
import { HeyGenAccountMaximumQuoteUnavailableProvider } from "../server/ai-media-studio/providers/heygen-account-maximum-quote-provider";

const digest = (hex: string) => `sha256:${hex.repeat(64)}` as const;
const request = (): LockedMaximumQuoteRequest => ({
  subject: { dailyPlanId: "11111111-1111-4111-8111-111111111111",
    dailyPlanSlotId: "22222222-2222-4222-8222-222222222222", slotAttempt: 1, subjectDigest: digest("1") },
  renderSpec: { renderSpecDigest: digest("2") },
  account: { providerKey: "heygen", providerAccountId: "33333333-3333-4333-8333-333333333333",
    accountBindingDigest: digest("3") },
  credential: { providerCredentialVersion: 7, credentialBindingDigest: digest("4") },
  requestContext: { databaseNow: "2026-07-22T12:00:00.000Z", idempotencyKey: "quote-request-0001" },
});

test("inert HeyGen adapter returns explicit unavailable without network or quote evidence", async () => {
  let fetchCalls = 0; const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { fetchCalls += 1; throw new Error("network must not be used"); };
  try {
    const adapter = new HeyGenAccountMaximumQuoteUnavailableProvider();
    assert.equal(fetchCalls, 0);
    const outcome = await adapter.requestMaximumQuote(request());
    assert.deepEqual(outcome, { kind: "unavailable", providerKey: "heygen",
      reasonCode: "authoritative_account_quote_unavailable" });
    assert.equal(Object.isFrozen(outcome), true); assert.equal(fetchCalls, 0);
    for (const key of ["amountMicroUsd", "sourceDigest", "expiresAt", "evidenceDigest", "quoteKey"])
      assert.equal(key in outcome, false);
  } finally { globalThis.fetch = originalFetch; }
});

test("locked request validation rejects added and malformed subject/render/account/credential input", async (t) => {
  const valid = request();
  const invalid: ReadonlyArray<readonly [string, unknown]> = [
    ["top extra", { ...valid, browserAmount: "1" }],
    ["subject extra", { ...valid, subject: { ...valid.subject, publicSlotKey: "browser" } }],
    ["plan id", { ...valid, subject: { ...valid.subject, dailyPlanId: "public" } }],
    ["slot id", { ...valid, subject: { ...valid.subject, dailyPlanSlotId: "public" } }],
    ["attempt", { ...valid, subject: { ...valid.subject, slotAttempt: 0 } }],
    ["subject digest", { ...valid, subject: { ...valid.subject, subjectDigest: "sha256:no" } }],
    ["render extra", { ...valid, renderSpec: { ...valid.renderSpec, payload: {} } }],
    ["render digest", { ...valid, renderSpec: { renderSpecDigest: "sha256:no" } }],
    ["account extra", { ...valid, account: { ...valid.account, publicPricing: 1 } }],
    ["provider", { ...valid, account: { ...valid.account, providerKey: "HeyGen" } }],
    ["account id", { ...valid, account: { ...valid.account, providerAccountId: "account-1" } }],
    ["account digest", { ...valid, account: { ...valid.account, accountBindingDigest: "sha256:no" } }],
    ["credential extra", { ...valid, credential: { ...valid.credential, apiKey: "forbidden" } }],
    ["credential version", { ...valid, credential: { ...valid.credential, providerCredentialVersion: 0 } }],
    ["credential digest", { ...valid, credential: { ...valid.credential, credentialBindingDigest: "sha256:no" } }],
    ["request context extra", { ...valid, requestContext: { ...valid.requestContext, amountMicroUsd: "1" } }],
    ["database time", { ...valid, requestContext: { ...valid.requestContext, databaseNow: "2026-07-22" } }],
    ["idempotency key", { ...valid, requestContext: { ...valid.requestContext, idempotencyKey: "short" } }],
  ];
  assert.equal(isLockedMaximumQuoteRequest(valid), true);
  for (const [name, input] of invalid) await t.test(name, async () => {
    assert.equal(isLockedMaximumQuoteRequest(input), false);
    assert.deepEqual(await new HeyGenAccountMaximumQuoteUnavailableProvider()
      .requestMaximumQuote(input as LockedMaximumQuoteRequest),
    { kind: "unavailable", providerKey: "heygen", reasonCode: "invalid_locked_request" });
  });
});

test("provider mismatch is explicit and does not fall through", async () => {
  const valid = request();
  assert.deepEqual(await new HeyGenAccountMaximumQuoteUnavailableProvider().requestMaximumQuote({
    ...valid, account: { ...valid.account, providerKey: "other_provider" },
  }), { kind: "unavailable", providerKey: "heygen", reasonCode: "unsupported_provider" });
});

test("outcome validation accepts only exact integer micro-USD/USD/expiry/source quotes", () => {
  const valid = { kind: "quoted", providerKey: "future_provider", amountMicroUsd: "1250000", currency: "USD",
    observedAt: "2026-07-22T12:00:00.000Z", expiresAt: "2026-07-22T12:15:00.000Z", sourceDigest: digest("a") } as const;
  assert.equal(isMaximumQuoteOutcome(valid), true);
  for (const invalid of [
    { ...valid, amountMicroUsd: "1.25" }, { ...valid, amountMicroUsd: "0" },
    { ...valid, amountMicroUsd: "9000000000000001" }, { ...valid, currency: "EUR" },
    { ...valid, observedAt: "2026-07-22" }, { ...valid, expiresAt: valid.observedAt },
    { ...valid, sourceDigest: "sha256:bad" }, { ...valid, publicPriceUrl: "https://example.test" },
  ]) assert.equal(isMaximumQuoteOutcome(invalid), false);
  assert.equal(isMaximumQuoteOutcome({ kind: "unavailable", providerKey: "heygen",
    reasonCode: "authoritative_account_quote_unavailable" }), true);
  assert.equal(isMaximumQuoteOutcome({ kind: "unavailable", providerKey: "heygen", reasonCode: "unknown" }), false);
});
