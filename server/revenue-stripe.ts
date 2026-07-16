import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import type { Express, Request, Response as ExpressResponse } from "express";
import { z } from "zod";
import {
  acquireRevenueEngineScope,
  flushRevenueEnginePersistence,
  recordRevenueStripePayment,
  ROBERT_WEBSITES_STRIPE_ACCOUNT_ID,
} from "./revenue-engine";

const STRIPE_API_BASE_URL = "https://api.stripe.com";
const STRIPE_API_VERSION = "2026-02-25.clover";
const STRIPE_WEBHOOK_TOLERANCE_SECONDS = 300;
const ROBERT_WEBSITES_SEGMENT = "robert_websites";
const STRIPE_SECRET_PLACEHOLDER_PATTERN = /(replace|placeholder|example|changeme|insert[-_ ]?here)/i;

type RevenueStripeFetch = (input: string, init?: RequestInit) => Promise<globalThis.Response>;

let revenueStripeFetchOverride: RevenueStripeFetch | null = null;

class RevenueStripeError extends Error {
  constructor(message: string, readonly statusCode = 400) {
    super(message);
    this.name = "RevenueStripeError";
  }
}

export const revenueStripeCheckoutSchema = z.object({
  dealId: z.string().trim().min(1).max(200),
  leadId: z.string().trim().max(200).optional().default(""),
  clientName: z.string().trim().min(2).max(160),
  clientEmail: z.union([z.string().trim().email().max(240), z.literal("")]).optional().default(""),
  packageName: z.string().trim().min(2).max(160),
  kind: z.enum(["website_sale", "automation_sale", "bundle_sale", "retainer"]),
  paymentStage: z.enum(["deposit", "balance", "full"]),
  amountUsd: z.coerce.number().min(1).max(1000000),
  contractTotalUsd: z.coerce.number().min(1).max(1000000),
  estimatedInternalCostUsd: z.coerce.number().min(0).max(100000).default(0),
  clientApprovedScope: z.literal(true),
}).superRefine((value, ctx) => {
  if (value.amountUsd > value.contractTotalUsd + 0.009) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["amountUsd"],
      message: "Payment amount cannot exceed the contract total.",
    });
  }
});

export type RevenueStripeCheckoutInput = z.infer<typeof revenueStripeCheckoutSchema>;

const stripeEventSchema = z.object({
  id: z.string().trim().min(1).max(200),
  type: z.string().trim().min(1).max(200),
  created: z.number().int().nonnegative(),
  livemode: z.boolean(),
  account: z.string().trim().min(1).max(100).optional(),
  data: z.object({ object: z.record(z.unknown()) }),
});

function getRevenueStripeFetch(): RevenueStripeFetch {
  return revenueStripeFetchOverride || ((input, init) => fetch(input, init));
}

function inferStripeMode(secretKey: string) {
  if (secretKey.startsWith("sk_live_")) return "live" as const;
  if (secretKey.startsWith("sk_test_")) return "test" as const;
  return "unknown" as const;
}

function isUsableStripeSecret(value: string, prefixes: string[]) {
  return value.length >= 32
    && prefixes.some((prefix) => value.startsWith(prefix))
    && !STRIPE_SECRET_PLACEHOLDER_PATTERN.test(value);
}

function readRevenueStripeConfig() {
  const configuredAccountId = process.env.REVENUE_STRIPE_ACCOUNT_ID?.trim()
    || ROBERT_WEBSITES_STRIPE_ACCOUNT_ID;
  if (configuredAccountId !== ROBERT_WEBSITES_STRIPE_ACCOUNT_ID) {
    throw new RevenueStripeError(
      `Stripe configuration blocked: expected account ${ROBERT_WEBSITES_STRIPE_ACCOUNT_ID}.`,
      503,
    );
  }
  const secretKey = process.env.REVENUE_STRIPE_SECRET_KEY?.trim() || "";
  const webhookSecret = process.env.REVENUE_STRIPE_WEBHOOK_SECRET?.trim() || "";
  if (secretKey && !isUsableStripeSecret(secretKey, ["sk_live_", "sk_test_"])) {
    throw new RevenueStripeError("Stripe configuration blocked: invalid secret key format.", 503);
  }
  if (webhookSecret && !isUsableStripeSecret(webhookSecret, ["whsec_"])) {
    throw new RevenueStripeError("Stripe configuration blocked: invalid webhook secret format.", 503);
  }
  return {
    accountId: configuredAccountId,
    secretKey,
    webhookSecret,
    mode: inferStripeMode(secretKey),
  };
}

function publicRevenueEngineOrigin() {
  const configured = process.env.REVENUE_ENGINE_PUBLIC_BASE_URL?.trim()
    || "https://robertwebsites.com";
  let parsed: URL;
  try {
    parsed = new URL(configured);
  } catch {
    throw new RevenueStripeError("Stripe configuration blocked: invalid public base URL.", 503);
  }
  const isLocal = parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1";
  if (parsed.protocol !== "https:" && !isLocal) {
    throw new RevenueStripeError("Stripe configuration blocked: public base URL must use HTTPS.", 503);
  }
  return parsed.origin;
}

function stripeErrorMessage(payload: unknown) {
  if (!payload || typeof payload !== "object") return "Stripe request failed.";
  const error = (payload as { error?: unknown }).error;
  if (!error || typeof error !== "object") return "Stripe request failed.";
  const message = (error as { message?: unknown }).message;
  return typeof message === "string" && message.trim() ? message.trim() : "Stripe request failed.";
}

async function stripeApiRequest<T>(path: string, secretKey: string, init: RequestInit = {}): Promise<T> {
  if (!secretKey) {
    throw new RevenueStripeError("Stripe is not configured: missing Robert Websites secret key.", 503);
  }
  let response: globalThis.Response;
  try {
    response = await getRevenueStripeFetch()(`${STRIPE_API_BASE_URL}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${secretKey}`,
        "Stripe-Version": STRIPE_API_VERSION,
        ...(init.body ? { "Content-Type": "application/x-www-form-urlencoded" } : {}),
        ...(init.headers || {}),
      },
    });
  } catch {
    throw new RevenueStripeError("Stripe is unreachable; no payment resource was created.", 503);
  }
  const payload = await response.json().catch(() => ({})) as unknown;
  if (!response.ok) {
    throw new RevenueStripeError(stripeErrorMessage(payload), response.status >= 500 ? 503 : 400);
  }
  return payload as T;
}

async function verifyRevenueStripeAccount(secretKey: string) {
  const account = await stripeApiRequest<{
    id?: string;
    charges_enabled?: boolean;
    payouts_enabled?: boolean;
    details_submitted?: boolean;
  }>("/v1/account", secretKey, { method: "GET" });
  if (account.id !== ROBERT_WEBSITES_STRIPE_ACCOUNT_ID) {
    throw new RevenueStripeError(
      `Stripe account rejected: expected ${ROBERT_WEBSITES_STRIPE_ACCOUNT_ID}. KongApp will not be used.`,
      409,
    );
  }
  return account;
}

function toStripeCents(value: number) {
  return Math.round((value + Number.EPSILON) * 100);
}

function setStripeMetadata(form: URLSearchParams, metadata: Record<string, string>) {
  for (const [key, value] of Object.entries(metadata)) {
    if (!value) continue;
    form.set(`metadata[${key}]`, value);
    form.set(`payment_intent_data[metadata][${key}]`, value);
  }
}

export async function getRevenueStripeStatus() {
  let config: ReturnType<typeof readRevenueStripeConfig>;
  try {
    config = readRevenueStripeConfig();
  } catch (error) {
    return {
      status: "blocked" as const,
      expectedAccountId: ROBERT_WEBSITES_STRIPE_ACCOUNT_ID,
      configured: false,
      reason: error instanceof Error ? error.message : "Stripe configuration is invalid.",
    };
  }
  if (!config.secretKey) {
    return {
      status: "setup_required" as const,
      expectedAccountId: config.accountId,
      configured: false,
      webhookConfigured: Boolean(config.webhookSecret),
      mode: config.mode,
      reason: "Add the Robert Websites Stripe secret key to the deployment secrets.",
    };
  }

  try {
    const account = await verifyRevenueStripeAccount(config.secretKey);
    return {
      status: "ready" as const,
      expectedAccountId: config.accountId,
      verifiedAccountId: account.id,
      configured: true,
      webhookConfigured: Boolean(config.webhookSecret),
      mode: config.mode,
      chargesEnabled: Boolean(account.charges_enabled),
      payoutsEnabled: Boolean(account.payouts_enabled),
      detailsSubmitted: Boolean(account.details_submitted),
      readyForTestPayments: config.mode === "test",
      readyForLivePayments: config.mode === "live" && Boolean(account.charges_enabled),
    };
  } catch (error) {
    return {
      status: "blocked" as const,
      expectedAccountId: config.accountId,
      configured: true,
      webhookConfigured: Boolean(config.webhookSecret),
      mode: config.mode,
      reason: error instanceof Error ? error.message : "Stripe account verification failed.",
    };
  }
}

export async function createRevenueStripeCheckout(
  input: RevenueStripeCheckoutInput,
  context: { revenueUserId: string },
) {
  const parsed = revenueStripeCheckoutSchema.parse(input);
  const config = readRevenueStripeConfig();
  const account = await verifyRevenueStripeAccount(config.secretKey);
  const amountCents = toStripeCents(parsed.amountUsd);
  const contractTotalCents = toStripeCents(parsed.contractTotalUsd);
  const estimatedInternalCostCents = toStripeCents(parsed.estimatedInternalCostUsd);
  const metadata = {
    account_segment: ROBERT_WEBSITES_SEGMENT,
    stripe_account_id: ROBERT_WEBSITES_STRIPE_ACCOUNT_ID,
    revenue_user_id: context.revenueUserId.trim(),
    deal_id: parsed.dealId,
    lead_id: parsed.leadId,
    client_name: parsed.clientName,
    package_name: parsed.packageName,
    revenue_kind: parsed.kind,
    payment_stage: parsed.paymentStage,
    contract_total_cents: String(contractTotalCents),
    estimated_internal_cost_cents: String(estimatedInternalCostCents),
  };
  const origin = publicRevenueEngineOrigin();
  const form = new URLSearchParams();
  form.set("mode", "payment");
  form.set("client_reference_id", parsed.dealId);
  form.set("success_url", `${origin}/revenue-engine?payment=success&session_id={CHECKOUT_SESSION_ID}`);
  form.set("cancel_url", `${origin}/revenue-engine?payment=cancelled`);
  form.set("billing_address_collection", "auto");
  form.set("customer_creation", "always");
  form.set("line_items[0][price_data][currency]", "usd");
  form.set("line_items[0][price_data][unit_amount]", String(amountCents));
  form.set("line_items[0][price_data][product_data][name]", `Robert Websites - ${parsed.packageName}`);
  form.set(
    "line_items[0][price_data][product_data][description]",
    `${parsed.paymentStage} payment for ${parsed.clientName}`,
  );
  form.set("line_items[0][quantity]", "1");
  form.set("payment_intent_data[description]", `${parsed.packageName} - ${parsed.clientName}`);
  if (parsed.clientEmail) form.set("customer_email", parsed.clientEmail);
  setStripeMetadata(form, metadata);

  const idempotencyKey = `rw-checkout-${createHash("sha256")
    .update(`${context.revenueUserId}|${parsed.dealId}|${parsed.paymentStage}|${amountCents}`)
    .digest("hex")}`;
  const session = await stripeApiRequest<{
    id?: string;
    url?: string;
    expires_at?: number;
  }>("/v1/checkout/sessions", config.secretKey, {
    method: "POST",
    headers: { "Idempotency-Key": idempotencyKey },
    body: form.toString(),
  });
  if (!session.id || !session.url) {
    throw new RevenueStripeError("Stripe created an incomplete Checkout Session.", 503);
  }

  return {
    status: "created" as const,
    accountId: account.id,
    mode: config.mode,
    checkoutSessionId: session.id,
    checkoutUrl: session.url,
    expiresAt: session.expires_at ? new Date(session.expires_at * 1000).toISOString() : null,
    amountUsd: parsed.amountUsd,
    contractTotalUsd: parsed.contractTotalUsd,
    dealId: parsed.dealId,
    paymentStage: parsed.paymentStage,
  };
}

function safeStripeSignatureMatch(expectedHex: string, candidateHex: string) {
  if (!/^[a-f0-9]{64}$/i.test(candidateHex)) return false;
  const expected = Buffer.from(expectedHex, "hex");
  const candidate = Buffer.from(candidateHex, "hex");
  return expected.length === candidate.length && timingSafeEqual(expected, candidate);
}

export function verifyRevenueStripeWebhookSignature(
  rawBody: Buffer,
  signatureHeader: string,
  webhookSecret: string,
  nowSeconds = Math.floor(Date.now() / 1000),
) {
  const parts = signatureHeader.split(",").map((part) => part.trim());
  const timestampValue = parts.find((part) => part.startsWith("t="))?.slice(2) || "";
  const timestamp = Number(timestampValue);
  const signatures = parts.filter((part) => part.startsWith("v1=")).map((part) => part.slice(3));
  if (!Number.isInteger(timestamp) || signatures.length === 0) {
    throw new RevenueStripeError("Invalid Stripe webhook signature header.", 400);
  }
  if (Math.abs(nowSeconds - timestamp) > STRIPE_WEBHOOK_TOLERANCE_SECONDS) {
    throw new RevenueStripeError("Expired Stripe webhook signature.", 400);
  }
  const expected = createHmac("sha256", webhookSecret)
    .update(`${timestamp}.${rawBody.toString("utf8")}`)
    .digest("hex");
  if (!signatures.some((candidate) => safeStripeSignatureMatch(expected, candidate))) {
    throw new RevenueStripeError("Invalid Stripe webhook signature.", 400);
  }
  return true;
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function objectId(value: unknown) {
  if (typeof value === "string") return value.trim();
  if (value && typeof value === "object") return stringValue((value as { id?: unknown }).id);
  return "";
}

function metadataFromStripeObject(object: Record<string, unknown>) {
  const metadata = object.metadata;
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return {} as Record<string, string>;
  return Object.fromEntries(
    Object.entries(metadata).map(([key, value]) => [key, stringValue(value)]),
  );
}

function positiveIntegerMetadata(metadata: Record<string, string>, key: string) {
  const value = Number(metadata[key]);
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new RevenueStripeError(`Stripe webhook rejected: invalid ${key}.`, 400);
  }
  return value;
}

function revenueKindFromMetadata(value: string) {
  const result = z.enum(["website_sale", "automation_sale", "bundle_sale", "retainer"]).safeParse(value);
  if (!result.success) throw new RevenueStripeError("Stripe webhook rejected: invalid revenue kind.", 400);
  return result.data;
}

function paymentStageFromMetadata(value: string) {
  const result = z.enum(["deposit", "balance", "full"]).safeParse(value);
  if (!result.success) throw new RevenueStripeError("Stripe webhook rejected: invalid payment stage.", 400);
  return result.data;
}

function extractPaidStripeObject(event: z.infer<typeof stripeEventSchema>) {
  const object = event.data.object;
  if (event.type === "checkout.session.completed" || event.type === "checkout.session.async_payment_succeeded") {
    if (stringValue(object.payment_status) !== "paid") return null;
    return {
      object,
      amountCents: Number(object.amount_total),
      externalPaymentId: objectId(object.payment_intent) || stringValue(object.id),
    };
  }
  if (event.type === "invoice.paid") {
    return {
      object,
      amountCents: Number(object.amount_paid),
      externalPaymentId: objectId(object.payment_intent) || stringValue(object.id),
    };
  }
  return undefined;
}

export async function processRevenueStripeWebhook(rawBody: Buffer, signatureHeader: string) {
  const config = readRevenueStripeConfig();
  if (!config.webhookSecret) {
    throw new RevenueStripeError("Stripe webhook is not configured.", 503);
  }
  if (!config.secretKey) {
    throw new RevenueStripeError("Stripe account verification is not configured.", 503);
  }
  verifyRevenueStripeWebhookSignature(rawBody, signatureHeader, config.webhookSecret);

  let eventPayload: unknown;
  try {
    eventPayload = JSON.parse(rawBody.toString("utf8"));
  } catch {
    throw new RevenueStripeError("Stripe webhook body is not valid JSON.", 400);
  }
  const parsedEvent = stripeEventSchema.safeParse(eventPayload);
  if (!parsedEvent.success) {
    throw new RevenueStripeError("Stripe webhook payload has an invalid event shape.", 400);
  }
  const event = parsedEvent.data;
  const paidObject = extractPaidStripeObject(event);
  if (paidObject === undefined) {
    return { status: "ignored" as const, eventId: event.id, eventType: event.type };
  }
  if (paidObject === null) {
    return { status: "pending" as const, eventId: event.id, eventType: event.type };
  }

  await verifyRevenueStripeAccount(config.secretKey);
  if (event.account && event.account !== ROBERT_WEBSITES_STRIPE_ACCOUNT_ID) {
    throw new RevenueStripeError("Stripe webhook rejected: account does not match Robert Websites.", 409);
  }
  if (config.mode !== "unknown" && event.livemode !== (config.mode === "live")) {
    throw new RevenueStripeError("Stripe webhook rejected: live/test mode mismatch.", 409);
  }

  const metadata = metadataFromStripeObject(paidObject.object);
  if (metadata.account_segment !== ROBERT_WEBSITES_SEGMENT
    || metadata.stripe_account_id !== ROBERT_WEBSITES_STRIPE_ACCOUNT_ID) {
    if (!metadata.account_segment && !metadata.stripe_account_id && !metadata.revenue_user_id && !metadata.deal_id) {
      return { status: "ignored" as const, eventId: event.id, eventType: event.type };
    }
    throw new RevenueStripeError("Stripe webhook rejected: Robert Websites metadata is missing.", 409);
  }
  if (stringValue(paidObject.object.currency).toLowerCase() !== "usd") {
    throw new RevenueStripeError("Stripe webhook rejected: only USD payments are supported.", 400);
  }
  if (!Number.isSafeInteger(paidObject.amountCents) || paidObject.amountCents <= 0) {
    throw new RevenueStripeError("Stripe webhook rejected: invalid paid amount.", 400);
  }
  if (!paidObject.externalPaymentId) {
    throw new RevenueStripeError("Stripe webhook rejected: missing payment identifier.", 400);
  }

  const ownerUserId = metadata.revenue_user_id;
  const dealId = metadata.deal_id;
  const clientName = metadata.client_name;
  if (!ownerUserId || ownerUserId.length > 200 || !dealId || !clientName) {
    throw new RevenueStripeError("Stripe webhook rejected: incomplete deal metadata.", 400);
  }
  const contractTotalCents = positiveIntegerMetadata(metadata, "contract_total_cents");
  const estimatedInternalCostCents = Number(metadata.estimated_internal_cost_cents || "0");
  if (!Number.isSafeInteger(estimatedInternalCostCents) || estimatedInternalCostCents < 0) {
    throw new RevenueStripeError("Stripe webhook rejected: invalid internal cost metadata.", 400);
  }

  let ledgerResult: ReturnType<typeof recordRevenueStripePayment>;
  const releaseRevenueScope = await acquireRevenueEngineScope(ownerUserId);
  try {
    ledgerResult = recordRevenueStripePayment({
      stripeAccountId: ROBERT_WEBSITES_STRIPE_ACCOUNT_ID,
      dealId,
      kind: revenueKindFromMetadata(metadata.revenue_kind),
      clientName,
      contractTotalUsd: contractTotalCents / 100,
      paymentAmountUsd: paidObject.amountCents / 100,
      estimatedInternalCostUsd: estimatedInternalCostCents / 100,
      externalPaymentId: paidObject.externalPaymentId,
      eventId: event.id,
      paymentStage: paymentStageFromMetadata(metadata.payment_stage),
      occurredAt: new Date(event.created * 1000).toISOString(),
      notes: [metadata.package_name && `Package:${metadata.package_name}`, metadata.lead_id && `Lead:${metadata.lead_id}`]
        .filter(Boolean)
        .join(" | "),
    });
    await flushRevenueEnginePersistence();
  } catch (error) {
    throw new RevenueStripeError(
      error instanceof Error ? error.message : "Stripe payment could not be recorded.",
      409,
    );
  } finally {
    releaseRevenueScope();
  }

  return {
    status: ledgerResult.status,
    eventId: event.id,
    eventType: event.type,
    ledgerEntryId: ledgerResult.entry.id,
    dealId,
    cashCollectedUsd: ledgerResult.entry.cashCollectedUsd,
  };
}

export function registerRevenueStripePublicRoutes(app: Express) {
  app.post("/api/revenue-engine/stripe/webhook", async (req: Request, res: ExpressResponse) => {
    if (!Buffer.isBuffer(req.rawBody)) {
      return res.status(400).json({ error: "Stripe webhook requires the raw request body." });
    }
    const signature = req.get("stripe-signature") || "";
    try {
      const result = await processRevenueStripeWebhook(req.rawBody, signature);
      return res.status(200).json({ received: true, ...result });
    } catch (error) {
      const statusCode = error instanceof RevenueStripeError ? error.statusCode : 500;
      const message = statusCode >= 500
        ? "Stripe webhook is temporarily unavailable."
        : error instanceof Error ? error.message : "Stripe webhook rejected.";
      return res.status(statusCode).json({ error: message });
    }
  });
}

export function setRevenueStripeFetchForTests(fetcher: RevenueStripeFetch | null) {
  revenueStripeFetchOverride = fetcher;
}
