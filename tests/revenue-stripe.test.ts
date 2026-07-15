import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { existsSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import {
  acquireRevenueEngineScope,
  buildRevenueUserDataPaths,
  getRevenueEngineSnapshot,
  recordRevenueStripePayment,
  resetRevenueLedgerForTests,
  ROBERT_WEBSITES_STRIPE_ACCOUNT_ID,
  setRevenueLedgerPathForTests,
} from "../server/revenue-engine";
import {
  createRevenueStripeCheckout,
  getRevenueStripeStatus,
  processRevenueStripeWebhook,
  setRevenueStripeFetchForTests,
  verifyRevenueStripeWebhookSignature,
} from "../server/revenue-stripe";
import { isPublicApiPath } from "../server/user-context";

const testLedgerPath = path.join("/tmp", `revenue-stripe-ledger-${process.pid}.json`);
const webhookOwnerId = `revenue-stripe-webhook-test-${process.pid}`;
const originalEnvironment = {
  databaseUrl: process.env.DATABASE_URL,
  stripeAccountId: process.env.REVENUE_STRIPE_ACCOUNT_ID,
  stripeSecretKey: process.env.REVENUE_STRIPE_SECRET_KEY,
  stripeWebhookSecret: process.env.REVENUE_STRIPE_WEBHOOK_SECRET,
  publicBaseUrl: process.env.REVENUE_ENGINE_PUBLIC_BASE_URL,
};

function restoreEnvironmentValue(key: string, value: string | undefined) {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}

function jsonResponse(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function stripeSignature(rawBody: Buffer, secret: string, timestamp: number) {
  const digest = createHmac("sha256", secret)
    .update(`${timestamp}.${rawBody.toString("utf8")}`)
    .digest("hex");
  return `t=${timestamp},v1=${digest}`;
}

test.beforeEach(() => {
  delete process.env.DATABASE_URL;
  process.env.REVENUE_STRIPE_ACCOUNT_ID = ROBERT_WEBSITES_STRIPE_ACCOUNT_ID;
  process.env.REVENUE_STRIPE_SECRET_KEY = "sk_test_robert_websites_test_key";
  process.env.REVENUE_STRIPE_WEBHOOK_SECRET = "whsec_robert_websites_test_secret";
  process.env.REVENUE_ENGINE_PUBLIC_BASE_URL = "https://robertwebsites.com";
  setRevenueStripeFetchForTests(null);
  setRevenueLedgerPathForTests(testLedgerPath);
  resetRevenueLedgerForTests();
  rmSync(buildRevenueUserDataPaths(webhookOwnerId).baseDir, { recursive: true, force: true });
});

test.afterEach(() => {
  setRevenueStripeFetchForTests(null);
  resetRevenueLedgerForTests();
  rmSync(buildRevenueUserDataPaths(webhookOwnerId).baseDir, { recursive: true, force: true });
});

test.after(() => {
  restoreEnvironmentValue("DATABASE_URL", originalEnvironment.databaseUrl);
  restoreEnvironmentValue("REVENUE_STRIPE_ACCOUNT_ID", originalEnvironment.stripeAccountId);
  restoreEnvironmentValue("REVENUE_STRIPE_SECRET_KEY", originalEnvironment.stripeSecretKey);
  restoreEnvironmentValue("REVENUE_STRIPE_WEBHOOK_SECRET", originalEnvironment.stripeWebhookSecret);
  restoreEnvironmentValue("REVENUE_ENGINE_PUBLIC_BASE_URL", originalEnvironment.publicBaseUrl);
});

test("verifies signed Stripe webhook bodies and rejects tampering or replay", () => {
  const secret = "whsec_signature_test";
  const timestamp = 1_800_000_000;
  const rawBody = Buffer.from(JSON.stringify({ id: "evt_signature_123" }));
  const signature = stripeSignature(rawBody, secret, timestamp);

  assert.equal(verifyRevenueStripeWebhookSignature(rawBody, signature, secret, timestamp), true);
  assert.throws(
    () => verifyRevenueStripeWebhookSignature(Buffer.from("{}"), signature, secret, timestamp),
    /Invalid Stripe webhook signature/,
  );
  assert.throws(
    () => verifyRevenueStripeWebhookSignature(rawBody, signature, secret, timestamp + 301),
    /Expired Stripe webhook signature/,
  );
});

test("rejects placeholder webhook secrets and keeps the webhook on the public allowlist", async () => {
  process.env.REVENUE_STRIPE_WEBHOOK_SECRET = "whsec_replace-after-creating-webhook";
  const status = await getRevenueStripeStatus();

  assert.equal(status.status, "blocked");
  assert.match(status.reason, /invalid webhook secret format/);
  assert.equal(isPublicApiPath("/api/revenue-engine/stripe/webhook"), true);
});

test("blocks KongApp credentials before creating any Checkout Session", async () => {
  const calls: string[] = [];
  setRevenueStripeFetchForTests(async (input) => {
    calls.push(input);
    return jsonResponse({ id: "acct_1SvSueDnfrjBwydz" });
  });

  await assert.rejects(
    createRevenueStripeCheckout({
      dealId: "deal-isolation-1",
      clientName: "Isolation Client",
      clientEmail: "client@example.com",
      packageName: "Website Starter",
      kind: "website_sale",
      paymentStage: "deposit",
      amountUsd: 299,
      contractTotalUsd: 599,
      estimatedInternalCostUsd: 0,
      clientApprovedScope: true,
    }, { revenueUserId: "robert" }),
    /KongApp will not be used/,
  );
  assert.deepEqual(calls, ["https://api.stripe.com/v1/account"]);
});

test("creates hosted Checkout with Robert Websites metadata and no paid invoicing add-on", async () => {
  const requests: Array<{ input: string; init?: RequestInit }> = [];
  setRevenueStripeFetchForTests(async (input, init) => {
    requests.push({ input, init });
    if (input.endsWith("/v1/account")) {
      return jsonResponse({
        id: ROBERT_WEBSITES_STRIPE_ACCOUNT_ID,
        charges_enabled: true,
        payouts_enabled: true,
        details_submitted: true,
      });
    }
    return jsonResponse({
      id: "cs_test_robert_123",
      url: "https://checkout.stripe.com/c/pay/cs_test_robert_123",
      expires_at: 1_900_000_000,
    });
  });

  const result = await createRevenueStripeCheckout({
    dealId: "deal-checkout-1",
    leadId: "lead-checkout-1",
    clientName: "Checkout Client",
    clientEmail: "client@example.com",
    packageName: "3D Website",
    kind: "website_sale",
    paymentStage: "deposit",
    amountUsd: 299,
    contractTotalUsd: 599,
    estimatedInternalCostUsd: 0,
    clientApprovedScope: true,
  }, { revenueUserId: "robert" });

  assert.equal(result.accountId, ROBERT_WEBSITES_STRIPE_ACCOUNT_ID);
  assert.equal(result.checkoutUrl, "https://checkout.stripe.com/c/pay/cs_test_robert_123");
  assert.equal(requests.length, 2);
  const checkoutRequest = requests[1];
  assert.equal(checkoutRequest.input, "https://api.stripe.com/v1/checkout/sessions");
  const form = new URLSearchParams(String(checkoutRequest.init?.body));
  assert.equal(form.get("mode"), "payment");
  assert.equal(form.get("metadata[stripe_account_id]"), ROBERT_WEBSITES_STRIPE_ACCOUNT_ID);
  assert.equal(form.get("metadata[account_segment]"), "robert_websites");
  assert.equal(form.get("payment_intent_data[metadata][deal_id]"), "deal-checkout-1");
  assert.equal(form.get("line_items[0][price_data][unit_amount]"), "29900");
  assert.equal(form.has("payment_method_types[0]"), false);
  assert.equal(form.has("invoice_creation[enabled]"), false);
  assert.match(String((checkoutRequest.init?.headers as Record<string, string>)["Idempotency-Key"]), /^rw-checkout-/);
});

test("records deposit and balance once without duplicating contracted revenue", () => {
  const basePayment = {
    stripeAccountId: ROBERT_WEBSITES_STRIPE_ACCOUNT_ID,
    dealId: "deal-ledger-1",
    kind: "website_sale" as const,
    clientName: "Ledger Client",
    contractTotalUsd: 1000,
    estimatedInternalCostUsd: 0,
    occurredAt: "2026-07-15T12:00:00.000Z",
    notes: "Package:3D Website",
  };
  const deposit = recordRevenueStripePayment({
    ...basePayment,
    paymentAmountUsd: 300,
    externalPaymentId: "pi_deposit_123456",
    eventId: "evt_deposit_123456",
    paymentStage: "deposit",
  });
  const duplicate = recordRevenueStripePayment({
    ...basePayment,
    paymentAmountUsd: 300,
    externalPaymentId: "pi_deposit_123456",
    eventId: "evt_deposit_retry_123456",
    paymentStage: "deposit",
  });
  const balance = recordRevenueStripePayment({
    ...basePayment,
    paymentAmountUsd: 700,
    externalPaymentId: "pi_balance_123456",
    eventId: "evt_balance_123456",
    paymentStage: "balance",
    occurredAt: "2026-07-16T12:00:00.000Z",
  });
  const snapshot = getRevenueEngineSnapshot();

  assert.equal(deposit.status, "recorded");
  assert.equal(duplicate.status, "duplicate");
  assert.equal(balance.status, "updated");
  assert.equal(balance.entry.stripePaymentStatus, "paid");
  assert.equal(snapshot.metrics.appsSold, 1);
  assert.equal(snapshot.metrics.revenueUsd, 1000);
  assert.equal(snapshot.metrics.cashCollectedUsd, 1000);
  assert.equal(existsSync(testLedgerPath), true);
  const persisted = JSON.parse(readFileSync(testLedgerPath, "utf8")) as Array<Record<string, unknown>>;
  assert.equal(persisted.length, 1);
  assert.deepEqual(persisted[0].stripePaymentIds, ["pi_deposit_123456", "pi_balance_123456"]);
});

test("rejects single and cumulative Stripe overpayments without mutating cash", () => {
  const basePayment = {
    stripeAccountId: ROBERT_WEBSITES_STRIPE_ACCOUNT_ID,
    dealId: "deal-overpayment-1",
    kind: "website_sale" as const,
    clientName: "Overpayment Client",
    contractTotalUsd: 1000,
    estimatedInternalCostUsd: 0,
    occurredAt: "2026-07-15T12:00:00.000Z",
    notes: "Package:Website",
  };
  assert.throws(() => recordRevenueStripePayment({
    ...basePayment,
    paymentAmountUsd: 1000.01,
    externalPaymentId: "pi_overpayment_single_123456",
    eventId: "evt_overpayment_single_123456",
    paymentStage: "full",
  }), /cannot exceed the contract total/);

  recordRevenueStripePayment({
    ...basePayment,
    paymentAmountUsd: 600,
    externalPaymentId: "pi_overpayment_deposit_123456",
    eventId: "evt_overpayment_deposit_123456",
    paymentStage: "deposit",
  });
  assert.throws(() => recordRevenueStripePayment({
    ...basePayment,
    paymentAmountUsd: 500,
    externalPaymentId: "pi_overpayment_balance_123456",
    eventId: "evt_overpayment_balance_123456",
    paymentStage: "balance",
  }), /cumulative cash would exceed the contract total/);
  assert.equal(getRevenueEngineSnapshot().metrics.cashCollectedUsd, 600);
});

test("serializes Revenue Engine scopes so concurrent users cannot cross-write", async () => {
  const firstOwner = `${webhookOwnerId}-first`;
  const secondOwner = `${webhookOwnerId}-second`;
  rmSync(buildRevenueUserDataPaths(firstOwner).baseDir, { recursive: true, force: true });
  rmSync(buildRevenueUserDataPaths(secondOwner).baseDir, { recursive: true, force: true });

  const releaseFirst = await acquireRevenueEngineScope(firstOwner);
  let secondAcquired = false;
  const secondScope = acquireRevenueEngineScope(secondOwner).then((release) => {
    secondAcquired = true;
    return release;
  });
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(secondAcquired, false);
  releaseFirst();
  const releaseSecond = await secondScope;
  assert.equal(secondAcquired, true);
  releaseSecond();

  rmSync(buildRevenueUserDataPaths(firstOwner).baseDir, { recursive: true, force: true });
  rmSync(buildRevenueUserDataPaths(secondOwner).baseDir, { recursive: true, force: true });
});

test("processes a paid Checkout webhook idempotently into the owner ledger", async () => {
  setRevenueStripeFetchForTests(async (input) => {
    assert.equal(input, "https://api.stripe.com/v1/account");
    return jsonResponse({ id: ROBERT_WEBSITES_STRIPE_ACCOUNT_ID, charges_enabled: true });
  });
  const timestamp = Math.floor(Date.now() / 1000);
  const event = {
    id: "evt_checkout_paid_123456",
    type: "checkout.session.completed",
    created: timestamp,
    livemode: false,
    data: {
      object: {
        id: "cs_test_paid_123456",
        payment_status: "paid",
        payment_intent: "pi_checkout_paid_123456",
        amount_total: 29900,
        currency: "usd",
        metadata: {
          account_segment: "robert_websites",
          stripe_account_id: ROBERT_WEBSITES_STRIPE_ACCOUNT_ID,
          revenue_user_id: webhookOwnerId,
          deal_id: "deal-webhook-1",
          lead_id: "lead-webhook-1",
          client_name: "Webhook Client",
          package_name: "Website Starter",
          revenue_kind: "website_sale",
          payment_stage: "deposit",
          contract_total_cents: "59900",
          estimated_internal_cost_cents: "0",
        },
      },
    },
  };
  const rawBody = Buffer.from(JSON.stringify(event));
  const signature = stripeSignature(rawBody, process.env.REVENUE_STRIPE_WEBHOOK_SECRET!, timestamp);

  const first = await processRevenueStripeWebhook(rawBody, signature);
  const retry = await processRevenueStripeWebhook(rawBody, signature);

  assert.equal(first.status, "recorded");
  assert.equal(retry.status, "duplicate");
  assert.equal(first.cashCollectedUsd, 299);
  const ownerLedger = buildRevenueUserDataPaths(webhookOwnerId).ledgerPath;
  const persisted = JSON.parse(readFileSync(ownerLedger, "utf8")) as Array<Record<string, unknown>>;
  assert.equal(persisted.length, 1);
  assert.equal(persisted[0].stripeAccountId, ROBERT_WEBSITES_STRIPE_ACCOUNT_ID);
});
