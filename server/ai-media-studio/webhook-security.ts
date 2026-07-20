import { createHmac, timingSafeEqual } from "node:crypto";
export interface WebhookVerificationInput { rawBody: Buffer; signature?: string; timestamp?: string; secret?: string; nowMs?: number; toleranceMs?: number; }
function safeEqual(left: string, right: string): boolean { const a = Buffer.from(left); const b = Buffer.from(right); return a.length === b.length && timingSafeEqual(a, b); }
export function verifyHeyGenWebhook(input: WebhookVerificationInput): boolean {
  if (!input.secret || !input.signature || !input.timestamp || input.rawBody.length === 0) return false;
  const timestampMs = /^\d+$/.test(input.timestamp) ? Number(input.timestamp) * (input.timestamp.length <= 10 ? 1_000 : 1) : Date.parse(input.timestamp);
  if (!Number.isFinite(timestampMs) || Math.abs((input.nowMs ?? Date.now()) - timestampMs) > (input.toleranceMs ?? 5 * 60_000)) return false;
  const hex = createHmac("sha256", input.secret).update(input.rawBody).digest("hex");
  const base64 = createHmac("sha256", input.secret).update(input.rawBody).digest("base64");
  const supplied = input.signature.replace(/^sha256=/i, "").trim();
  return safeEqual(supplied, hex) || safeEqual(supplied, base64);
}
