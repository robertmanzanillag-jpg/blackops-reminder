import test from "node:test";
import assert from "node:assert/strict";
import { AI_MODEL_DEFAULTS, AI_MODEL_PRICES, agentModelView, aiModelPrice, aiModelRateFor, resolveAiModel } from "../shared/ai-model-policy";

test("CEO gets the strong model on both providers; every other agent the small one", () => {
  assert.equal(resolveAiModel({ provider: "openai", task: "chat", agentId: "ceo" }).model, "gpt-6.2-sol");
  assert.equal(resolveAiModel({ provider: "anthropic", task: "chat", agentId: "ceo" }).model, "claude-opus-5-5");
  for (const agentId of ["clippers", "marketing-cmo", "kong:Venues", "blackroom-dj", undefined]) {
    assert.equal(resolveAiModel({ provider: "openai", task: "chat", agentId }).model, "gpt-6-luna");
    assert.equal(resolveAiModel({ provider: "anthropic", task: "role_job", agentId }).model, "claude-haiku-5-5");
  }
});

test("factory code stages stay on the strong code models, even for the CEO id", () => {
  assert.equal(resolveAiModel({ provider: "openai", task: "code_build", agentId: "ceo" }).model, "gpt-6.1-sol");
  assert.equal(resolveAiModel({ provider: "anthropic", task: "code_review" }).model, "claude-opus-5-5");
});

test("env overrides apply only to priced models; unpriced/invalid fall back to the default", () => {
  assert.deepEqual(resolveAiModel({ provider: "openai", task: "chat", agentId: "x", env: { AI_MODEL_DEFAULT_OPENAI: "gpt-6.2-sol" } }).model, "gpt-6.2-sol");
  const unpriced = resolveAiModel({ provider: "openai", task: "chat", agentId: "x", env: { AI_MODEL_DEFAULT_OPENAI: "gpt-9-free" } });
  assert.equal(unpriced.model, "gpt-6-luna"); assert.equal(unpriced.note, "AI_MODEL_OVERRIDE_UNPRICED");
  assert.equal(resolveAiModel({ provider: "anthropic", task: "chat", agentId: "ceo", env: { AI_MODEL_CEO_ANTHROPIC: "bad model!" } }).note, "AI_MODEL_OVERRIDE_INVALID");
  assert.equal(resolveAiModel({ provider: "anthropic", task: "chat", agentId: "ceo", env: { AI_MODEL_CEO_ANTHROPIC: "claude-sonnet-5-5" } }).model, "claude-sonnet-5-5");
  assert.equal(resolveAiModel({ provider: "openai", task: "chat", agentId: "kong-ceo", env: { AI_MODEL_CEO_AGENT_IDS: "ceo,kong-ceo" } }).tier, "ceo");
});

test("every model the policy can return has a positive integer price", () => {
  for (const tier of Object.values(AI_MODEL_DEFAULTS)) for (const [provider, model] of Object.entries(tier)) {
    const p = aiModelPrice(provider as "openai" | "anthropic", model);
    assert.ok(p, `${provider}/${model} priced`);
    for (const v of [p!.input, p!.output, p!.cacheWrite30m, p!.cacheWrite12h]) assert.ok(Number.isSafeInteger(v) && v > 0);
  }
  assert.equal(AI_MODEL_PRICES.anthropic["claude-opus-5-5"].input, 4000);
  assert.equal(AI_MODEL_PRICES.openai["gpt-6-luna"].output, 500);
});

test("tiered models never settle at the low tier above the threshold", () => {
  const haiku = aiModelPrice("anthropic", "claude-haiku-5-5")!;
  assert.equal(aiModelRateFor(haiku, 100000).input, 100);
  assert.equal(aiModelRateFor(haiku, 100001).input, 500);
  assert.equal(aiModelRateFor(haiku, Number.NaN).input, 500);
  assert.equal(aiModelRateFor(aiModelPrice("openai", "gpt-6-luna")!, 300000).output, 750);
});

test("roster view labels the tier", () => {
  assert.equal(agentModelView("ceo").tier, "ceo");
  assert.deepEqual({ ...agentModelView("clippers"), tierLabel: undefined }, { agentId: "clippers", tier: "default", tierLabel: undefined, openai: "gpt-6-luna", anthropic: "claude-haiku-5-5" });
});

test("server pricing: code-owned rows carry evidence; catalog row wins; unpriced is null", async () => {
  const { policyOpenAiPrice, policyAnthropicPricing, catalogPricedPolicyModel } = await import("../server/ai-model-pricing");
  const luna = policyOpenAiPrice("gpt-6-luna", {} as NodeJS.ProcessEnv)!;
  assert.equal(luna.inputNanoUsdPerToken, 100); assert.equal(luna.maxInputTokens, 272000); assert.match(luna.evidenceSha256, /^[a-f0-9]{64}$/);
  assert.equal(policyOpenAiPrice("gpt-unknown", {} as NodeJS.ProcessEnv), null);
  const catalog = JSON.stringify({ version: 1, prices: [{ provider: "openai", model: "gpt-6-luna", inputNanoUsdPerToken: 150, outputNanoUsdPerToken: 600, validUntil: "2027-01-01T00:00:00.000Z", evidenceSha256: "a".repeat(64) }] });
  // Incomplete catalog row (no cache-write rates / input bound) is not dispatchable: code-owned row.
  assert.equal(policyOpenAiPrice("gpt-6-luna", { FACTORY_API_PRICING_CONFIG: catalog } as NodeJS.ProcessEnv)!.inputNanoUsdPerToken, 100);
  const full = JSON.stringify({ version: 1, prices: [{ provider: "openai", model: "gpt-6-luna", inputNanoUsdPerToken: 150, outputNanoUsdPerToken: 600, cachedInputNanoUsdPerToken: 15, cacheWrite30mNanoUsdPerToken: 190, cacheWrite12hNanoUsdPerToken: 380, maxInputTokens: 272000, validUntil: "2027-01-01T00:00:00.000Z", evidenceSha256: "a".repeat(64) }] });
  assert.equal(policyOpenAiPrice("gpt-6-luna", { FACTORY_API_PRICING_CONFIG: full } as NodeJS.ProcessEnv)!.inputNanoUsdPerToken, 150);
  // Untiered strong model still carries an input bound, so the guarded fetch can dispatch it.
  assert.equal(policyOpenAiPrice("gpt-6.2-sol", {} as NodeJS.ProcessEnv)!.maxInputTokens, 272000);
  assert.equal(catalogPricedPolicyModel("translation", "gpt-5.4-nano", {} as NodeJS.ProcessEnv), "gpt-5.4-nano");
  assert.equal(catalogPricedPolicyModel("translation", "gpt-5.4-nano", { FACTORY_API_PRICING_CONFIG: catalog } as NodeJS.ProcessEnv), "gpt-6-luna");
  const haiku = policyAnthropicPricing("claude-haiku-5-5")!;
  assert.equal(haiku.inputNanoUsdPerToken, 100); assert.equal(haiku.tierAboveInputTokens, 100000); assert.equal(haiku.above!.inputNanoUsdPerToken, 500);
});

test("AI_MODEL_TIERING=off is the rollback lever", async () => {
  const { aiModelTieringEnabled } = await import("../shared/ai-model-policy");
  assert.equal(aiModelTieringEnabled({}), true);
  assert.equal(aiModelTieringEnabled({ AI_MODEL_TIERING: "OFF" }), false);
});
