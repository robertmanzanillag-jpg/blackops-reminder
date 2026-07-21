import { createHash, createHmac, timingSafeEqual } from "node:crypto";

export interface WebhookVerificationInput {
  rawBody: Buffer;
  signature?: string;
  secret?: string;
  /**
   * Retained for callers that have a provider-documented, authenticated
   * timestamp. HeyGen's route deliberately does not pass its unsigned header.
   */
  timestamp?: string;
  nowMs?: number;
  toleranceMs?: number;
}

export interface WebhookSecretCandidate {
  value: string;
  state: "active" | "previous";
  expiresAt?: string;
}

export interface VerifiedWebhookEnvelope {
  eventId: string;
  occurredAt: string;
  bodyDigest: `sha256:${string}`;
}

function safeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function normalizedSignature(value: string | undefined): string | undefined {
  const signature = value?.trim().replace(/^sha256=/i, "");
  return signature && signature.length <= 512 ? signature : undefined;
}

function validAuthenticatedTimestamp(timestamp: string, nowMs: number, toleranceMs: number): boolean {
  const timestampMs = /^\d+$/.test(timestamp)
    ? Number(timestamp) * (timestamp.length <= 10 ? 1_000 : 1)
    : Date.parse(timestamp);
  return Number.isFinite(timestampMs) && Math.abs(nowMs - timestampMs) <= toleranceMs;
}

/** Verify the provider HMAC over the exact raw request bytes. */
export function verifyHeyGenWebhook(input: WebhookVerificationInput): boolean {
  if (!input.secret || input.rawBody.length === 0) return false;
  const supplied = normalizedSignature(input.signature);
  if (!supplied) return false;
  if (input.timestamp && !validAuthenticatedTimestamp(
    input.timestamp,
    input.nowMs ?? Date.now(),
    input.toleranceMs ?? 5 * 60_000,
  )) return false;

  const hex = createHmac("sha256", input.secret).update(input.rawBody).digest("hex");
  const base64 = createHmac("sha256", input.secret).update(input.rawBody).digest("base64");
  const hexMatches = safeEqual(supplied, hex);
  const base64Matches = safeEqual(supplied, base64);
  return hexMatches || base64Matches;
}

/**
 * Check every currently usable rotation candidate. This intentionally avoids
 * returning which secret matched and does not expose vault references.
 */
export function verifyHeyGenWebhookWithRotation(input: {
  rawBody: Buffer;
  signature?: string;
  secrets: readonly WebhookSecretCandidate[];
  nowMs?: number;
}): boolean {
  const nowMs = input.nowMs ?? Date.now();
  let verified = false;
  for (const secret of input.secrets) {
    const expiryMs = secret.expiresAt ? Date.parse(secret.expiresAt) : undefined;
    const usable = secret.state === "active"
      ? expiryMs === undefined || (Number.isFinite(expiryMs) && expiryMs > nowMs)
      : expiryMs !== undefined && Number.isFinite(expiryMs) && expiryMs > nowMs;
    const candidateVerified = verifyHeyGenWebhook({
      rawBody: input.rawBody,
      signature: input.signature,
      secret: usable ? secret.value : "expired-webhook-secret-candidate",
    });
    verified = candidateVerified || verified;
  }
  return verified;
}

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function boundedEventId(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const eventId = value.trim();
  return eventId.length >= 1 && eventId.length <= 256 && /^[A-Za-z0-9._:-]+$/.test(eventId)
    ? eventId
    : undefined;
}

function validOccurredAt(value: unknown): string | undefined {
  if (typeof value !== "string" && typeof value !== "number") return undefined;
  const parsed = typeof value === "number"
    ? new Date(value < 10_000_000_000 ? value * 1_000 : value)
    : new Date(value);
  return Number.isNaN(parsed.valueOf()) ? undefined : parsed.toISOString();
}

/**
 * Derive replay identity and ordering only from authenticated body fields. A
 * digest/receipt-time fallback is stable and ignores mutable request headers.
 */
export function deriveVerifiedWebhookEnvelope(
  payload: unknown,
  rawBody: Buffer,
  receivedAtMs = Date.now(),
): VerifiedWebhookEnvelope {
  const root = object(payload);
  const data = object(root.event_data);
  const digest = createHash("sha256").update(rawBody).digest("hex");
  const eventId = boundedEventId(root.event_id)
    ?? boundedEventId(root.eventId)
    ?? boundedEventId(root.id)
    ?? boundedEventId(data.event_id)
    ?? `sha256:${digest}`;
  const occurredAt = validOccurredAt(root.occurred_at)
    ?? validOccurredAt(root.created_at)
    ?? validOccurredAt(data.occurred_at)
    ?? new Date(receivedAtMs).toISOString();
  return { eventId, occurredAt, bodyDigest: `sha256:${digest}` };
}
