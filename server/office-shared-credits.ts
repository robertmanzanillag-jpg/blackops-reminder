import {guardFactoryOpenAiFetch,selectFactoryApiTextPrice} from "./factory-api-sdk";
import {defaultFactoryApiInvocation,apiEvidenceHash} from "./factory-api-invocation";
import {factoryTextMaximumMicroUsd,factoryTextActualMicroUsd} from "./factory-api-token-cost";
import {readOpenAiCacheUsage} from "./factory-api-cache-usage";
import { createHash } from "node:crypto";
import { createOfficeOpenAI, type OfficeOpenAIResult } from "./office-openai";
import type { createSharedOpenAiCreditLedger } from "./shared-openai-credit-ledger";

/** Trusted Office adapter using the factory's SAME persistent account ledger.
 * Caller supplies an immutable assignment + phase ID, never a new ID on retry.
 * Does not initialize grants, read secrets, install a worker or change policies. */
export function createCreditLimitedOfficeRun(options: {
  factoryInvocation?: ReturnType<typeof import("./factory-api-invocation").createFactoryApiInvocation>;
  ledger: ReturnType<typeof createSharedOpenAiCreditLedger>;
  env: NodeJS.ProcessEnv; fetch?: typeof fetch; now: () => Date;
  pricing: { model: string; inputNanoUsdPerToken: number; outputNanoUsdPerToken: number; validUntil: string };
  authorizeTokens: (limits: { model: string; promptBytes: number; maxOutputTokens: number }) => Promise<string>;
  recordTokens: (reservation: string, result: Omit<OfficeOpenAIResult, "text">) => Promise<void>;
}) {
  const { ledger, now, authorizeTokens, recordTokens } = options;
  const env = { ...options.env }, price = { ...options.pricing }, transport = options.fetch || fetch;
  if (!price.model || env.OFFICE_OPENAI_MODEL !== price.model ||
      ![price.inputNanoUsdPerToken, price.outputNanoUsdPerToken].every(n => Number.isSafeInteger(n) && n > 0) ||
      !Number.isFinite(Date.parse(price.validUntil))) throw Error("OFFICE_CREDIT_PRICING_INVALID");
  return async (prompt: string, executionId: string): Promise<OfficeOpenAIResult> => {
    if (!/^[A-Za-z0-9_.:-]{1,200}$/.test(executionId)) throw Error("OFFICE_CREDIT_ASSIGNMENT_REQUIRED");
    // A missing/expired complete profile is a pre-dispatch hold, not an uncertain execution.
    const profile = selectFactoryApiTextPrice("openai",price.model,env,{...price,evidenceSha256:apiEvidenceHash(price)});
    const pricingExpiry = Math.min(Date.parse(price.validUntil),Date.parse(profile.validUntil));
    if (!Number.isFinite(pricingExpiry) || now().getTime() >= pricingExpiry) throw Error("OFFICE_CREDIT_PRICING_EXPIRED");
    const key = `office:${createHash("sha256").update(executionId).digest("hex")}`;
    let captured: {model:string;responseId:string;inputTokens:number;outputTokens:number;totalTokens:number;
      cache:ReturnType<typeof readOpenAiCacheUsage>} | undefined;
    let admitted = false, tokenReservation: string | undefined;
    let monetary=options.factoryInvocation;
    const provider = createOfficeOpenAI({ env, now,
      authorize: async limits => {
        if (limits.model !== profile.model || now().getTime() >= pricingExpiry) throw Error("OFFICE_CREDIT_PRICING_EXPIRED");
        if (!Number.isSafeInteger(limits.requestBytes) || limits.requestBytes! < 1 || limits.requestBytes! > 1_048_576)
          throw Error("OFFICE_CREDIT_REQUEST_BOUND_UNVERIFIED");
        monetary??=await defaultFactoryApiInvocation();
        await monetary.preflight();
        const requestSha256 = createHash("sha256").update(JSON.stringify([profile, {cacheWriteCoverage:true,cacheWriteTtls:["30m","12h"]}, limits, prompt])).digest("hex");
        const reservation = await ledger.reserve({ key, consumer: "office", requestSha256,
          maximumMicroUsd: Math.max(1, factoryTextMaximumMicroUsd(profile,limits.requestBytes! + 1024,limits.maxOutputTokens,true)) });
        if (!reservation.admitted) throw Error("OFFICE_CREDIT_ALREADY_ADMITTED");
        admitted = true;
        tokenReservation = await authorizeTokens({model:limits.model,promptBytes:limits.promptBytes,maxOutputTokens:limits.maxOutputTokens});
      },
      fetch: (async (url, init) => {
        const remaining = await ledger.executionWindow(key);
        const pricingRemaining = pricingExpiry - now().getTime();
        if (!Number.isFinite(pricingRemaining) || pricingRemaining <= 0) throw Error("OFFICE_CREDIT_PRICING_EXPIRED");
        const deadline = AbortSignal.timeout(Math.floor(Math.min(remaining, pricingRemaining)));
        const signal = init?.signal ? AbortSignal.any([init.signal, deadline]) : deadline;
        signal.throwIfAborted();
        const response = await guardFactoryOpenAiFetch(transport,{executionId,consumer:"office",env,
          price:profile,invoke:monetary})(url, { ...init, signal });
        // The monetary guard has already bounded and validated this response. Cache details
        // stay private to this execution; the Office token/result protocol remains unchanged.
        const raw = await response.clone().json(), usage = raw?.usage;
        captured = {model:raw?.model,responseId:raw?.id,inputTokens:usage?.input_tokens,
          outputTokens:usage?.output_tokens,totalTokens:usage?.total_tokens,
          cache:readOpenAiCacheUsage(usage?.input_tokens_details)};
        return response;
      }) as typeof fetch,
      recordUsage: async metadata => {
        if (!tokenReservation || !captured || metadata.model !== profile.model || captured.model !== metadata.model
          || captured.responseId !== metadata.sessionId || captured.inputTokens !== metadata.usage.inputTokens
          || captured.outputTokens !== metadata.usage.outputTokens || captured.totalTokens !== metadata.usage.totalTokens)
          throw Error("OFFICE_CREDIT_USAGE_UNVERIFIED");
        const actualMicroUsd = factoryTextActualMicroUsd(profile,{inputTokens:captured.inputTokens,
          outputTokens:captured.outputTokens,cachedTokens:captured.cache.cachedInputTokens,...captured.cache},true);
        await ledger.settle({ key, actualMicroUsd, evidenceId: metadata.sessionId });
        await recordTokens(tokenReservation, metadata);
      },
    });
    try { return await provider.runOfficeOpenAI(prompt); }
    catch {
      if (admitted) await ledger.markUnknown(key, `office-execution:${key.slice(7)}`).catch(() => undefined);
      throw Error("OFFICE_CREDIT_EXECUTION_UNCONFIRMED");
    }
  };
}
