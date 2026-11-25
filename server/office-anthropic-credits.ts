import { createHash } from "node:crypto";
import type { createSharedOpenAiCreditLedger } from "./shared-openai-credit-ledger";
import { isProviderCreditExhausted } from "./ai-provider-credit-cooldown";

/** Office Claude API run (used only when OpenAI is out of credit). Own
 * persistent ledger ("office-anthropic"), reserved for the worst case before
 * the call and settled with the measured usage. A rejected, not-executed call
 * settles at $0; anything uncertain stays `unknown` (never retried). */
export type OfficeAnthropicResult = { text: string; sessionId: string; completedAt: string; provider: "anthropic"; model: string;
  usage: { inputTokens: number; outputTokens: number; totalTokens: number } };
type Ledger = Pick<ReturnType<typeof createSharedOpenAiCreditLedger>, "reserve" | "settle" | "markUnknown" | "executionWindow">;
type Pricing = { model: string; inputNanoUsdPerToken: number; outputNanoUsdPerToken: number; validUntil: string };

const API = "https://api.anthropic.com/v1/messages";
const readJson = async (response: Response) => {
  const reader = response.body?.getReader(); if (!reader) return undefined;
  const chunks: Uint8Array[] = []; let size = 0;
  for (;;) { const part = await reader.read(); if (part.done) break; size += part.value.byteLength; if (size > 1048576) { await reader.cancel().catch(() => undefined); throw Error("OVERSIZED"); } chunks.push(part.value); }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
};

export function createCreditLimitedOfficeClaudeRun(options: { ledger: Ledger; pricing: Pricing; apiKey: string; now: () => Date; fetch?: typeof fetch; maxOutputTokens?: number }) {
  const { ledger, pricing, now } = options, transport = options.fetch ?? fetch;
  if (!/^sk-ant-[A-Za-z0-9_-]{20,300}$/.test(options.apiKey)) throw Error("OFFICE_ANTHROPIC_CREDENTIAL_REQUIRED");
  if (![pricing.inputNanoUsdPerToken, pricing.outputNanoUsdPerToken].every(n => Number.isSafeInteger(n) && n > 0) || !Number.isFinite(Date.parse(pricing.validUntil))) throw Error("OFFICE_CREDIT_PRICING_INVALID");
  const maxOutputTokens = Math.min(4096, Math.max(32, Math.floor(options.maxOutputTokens ?? 1024)));
  const headers = { "x-api-key": options.apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" };
  return async (prompt: string, executionId: string): Promise<OfficeAnthropicResult> => {
    if (!/^[A-Za-z0-9_.:-]{1,200}$/.test(executionId)) throw Error("OFFICE_CREDIT_ASSIGNMENT_REQUIRED");
    if (!prompt.trim() || Buffer.byteLength(prompt) > 65536) throw Error("OFFICE_ANTHROPIC_INPUT_INVALID");
    if (now().getTime() >= Date.parse(pricing.validUntil)) throw Error("OFFICE_CREDIT_PRICING_EXPIRED");
    const body = JSON.stringify({ model: pricing.model, max_tokens: maxOutputTokens, messages: [{ role: "user", content: prompt }] });
    // Worst case without a paid count call: every prompt byte is a token (+ framing).
    const maxInput = Buffer.byteLength(body) + 1024;
    const maximumMicroUsd = Math.max(1, Math.ceil((maxInput * pricing.inputNanoUsdPerToken + maxOutputTokens * pricing.outputNanoUsdPerToken) / 1000));
    const key = `office-claude:${createHash("sha256").update(executionId).digest("hex")}`;
    const requestSha256 = createHash("sha256").update(JSON.stringify([pricing, body])).digest("hex");
    const reservation = await ledger.reserve({ key, consumer: "office", requestSha256, maximumMicroUsd });
    if (!reservation.admitted) throw Error("OFFICE_CREDIT_ALREADY_ADMITTED");
    let response: Response;
    try {
      const remaining = await ledger.executionWindow(key);
      response = await transport(API, { method: "POST", headers, body, redirect: "error", signal: AbortSignal.timeout(Math.floor(Math.min(remaining, 120000))) });
    } catch {
      await ledger.markUnknown(key, `office-claude:${key.slice(13)}`).catch(() => undefined);
      throw Error("OFFICE_CREDIT_EXECUTION_UNCONFIRMED");
    }
    let parsed: any;
    try { parsed = await readJson(response); } catch { parsed = undefined; }
    if (!response.ok) {
      // HTTP error status: Anthropic rejected the request; nothing executed.
      if (response.status < 500 || response.status === 529) {
        await ledger.settle({ key, actualMicroUsd: 0, evidenceId: `office-claude-rejected:${response.status}` });
        const err = parsed?.error;
        if (isProviderCreditExhausted("anthropic", response.status, typeof err?.type === "string" ? err.type : null, typeof err?.details?.error_code === "string" ? err.details.error_code : null))
          throw Error("OFFICE_ANTHROPIC_CREDIT_EXHAUSTED");
        throw Error("OFFICE_ANTHROPIC_REQUEST_REJECTED");
      }
      await ledger.markUnknown(key, `office-claude:${key.slice(13)}`).catch(() => undefined);
      throw Error("OFFICE_CREDIT_EXECUTION_UNCONFIRMED");
    }
    const usage = parsed?.usage, input = Number(usage?.input_tokens ?? NaN), output = Number(usage?.output_tokens ?? NaN);
    const cacheRead = Number(usage?.cache_read_input_tokens ?? 0), cacheWrite = Number(usage?.cache_creation_input_tokens ?? 0);
    if (typeof parsed?.id !== "string" || ![input, output, cacheRead, cacheWrite].every(n => Number.isSafeInteger(n) && n >= 0)) {
      await ledger.markUnknown(key, `office-claude:${key.slice(13)}`).catch(() => undefined);
      throw Error("OFFICE_CREDIT_EXECUTION_UNCONFIRMED");
    }
    // Cache tokens billed conservatively at the full input rate.
    const actualMicroUsd = Math.ceil(((input + cacheRead + cacheWrite) * pricing.inputNanoUsdPerToken + output * pricing.outputNanoUsdPerToken) / 1000);
    await ledger.settle({ key, actualMicroUsd, evidenceId: parsed.id });
    const text = Array.isArray(parsed.content) ? parsed.content.filter((b: any) => b?.type === "text" && typeof b.text === "string").map((b: any) => b.text).join("") : "";
    if (parsed.stop_reason !== "end_turn" || !text.trim()) throw Error("OFFICE_ANTHROPIC_INCOMPLETE_RESULT");
    return { text, sessionId: parsed.id, completedAt: now().toISOString(), provider: "anthropic", model: typeof parsed.model === "string" ? parsed.model : pricing.model,
      usage: { inputTokens: input + cacheRead + cacheWrite, outputTokens: output, totalTokens: input + cacheRead + cacheWrite + output } };
  };
}
