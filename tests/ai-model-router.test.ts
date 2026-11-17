import assert from "node:assert/strict";
import { test } from "node:test";

import {
  AiBudgetUnavailableError,
  InMemoryAiProviderLedger,
  aiRouterConfig,
  chatCompletionToResponse,
  createRoutedOpenAI,
  estimateReservationUsd,
  openAiClientOptions,
  planProviders,
  responsesToDeepSeekChatBody,
  routerCostUsd,
  toDeepSeekChatBody,
  type ChatLikeClient,
  type ProviderConfig,
} from "../server/ai-model-router";

const KEYS = { OPENAI_API_KEY: "sk-own", DEEPSEEK_API_KEY: "ds-key", AI_INTEGRATIONS_OPENAI_API_KEY: "replit-key", AI_INTEGRATIONS_OPENAI_BASE_URL: "https://replit.example/v1" };

type Call = { provider: string; body: any };
function fakeClients(behaviour: Partial<Record<string, "ok" | "error" | "reject400">> = {}) {
  const calls: Call[] = [];
  const make = (provider: ProviderConfig): ChatLikeClient => {
    const respond = (body: any) => {
      calls.push({ provider: provider.id, body });
      const mode = behaviour[provider.id] ?? "ok";
      if (mode === "error") return Promise.reject(Object.assign(new Error(`${provider.id} down`), { status: 503 }));
      if (mode === "reject400") return Promise.reject(Object.assign(new Error("bad request"), { status: 400 }));
      return Promise.resolve({
        id: "c1", model: body.model,
        choices: [{ message: { content: `{"from":"${provider.id}"}` }, finish_reason: "stop" }],
        usage: { prompt_tokens: 1000, completion_tokens: 100 },
      });
    };
    return {
      chat: { completions: { create: (body: any) => respond(body) } },
      responses: { create: async (body: any) => {
        calls.push({ provider: provider.id, body });
        if ((behaviour[provider.id] ?? "ok") === "error") throw Object.assign(new Error("down"), { status: 500 });
        return { model: body.model, output_text: "hola", output: [{ type: "web_search_call" }], usage: { input_tokens: 2000, output_tokens: 200 } };
      } },
      audio: { transcriptions: { create: async (body: any) => { calls.push({ provider: provider.id, body }); return { text: "audio" }; } } },
    };
  };
  return { calls, make };
}

const chatBody = { model: "gpt-4o", messages: [{ role: "user", content: "hola" }], max_completion_tokens: 200 };

test("tier plans: repetitive -> deepseek first, standard/critical -> openai first, integration last", () => {
  const c = aiRouterConfig(KEYS);
  assert.deepEqual(planProviders("repetitive", c), ["deepseek", "openai", "integration"]);
  assert.deepEqual(planProviders("standard", c), ["openai", "deepseek", "integration"]);
  assert.deepEqual(planProviders("critical", c), ["openai", "deepseek", "integration"]);
  assert.deepEqual(planProviders("repetitive", c, { openAiOnly: true }), ["openai", "integration"]);
  assert.deepEqual(planProviders("standard", aiRouterConfig({ ...KEYS, AI_INTEGRATIONS_FALLBACK_ENABLED: "false" })), ["openai", "deepseek"]);
});

test("defaults: OpenAI cap $200, DeepSeek cap $50, deepseek-flash, own key preferred over Replit integration", () => {
  const c = aiRouterConfig(KEYS);
  assert.equal(c.openai?.monthlyCapUsd, 200);
  assert.equal(c.deepseek?.monthlyCapUsd, 50);
  assert.equal(c.deepseek?.model, "deepseek-flash");
  assert.equal(c.deepseek?.baseURL, "https://api.deepseek.com");
  assert.deepEqual(openAiClientOptions(KEYS), { apiKey: "sk-own", baseURL: undefined, source: "own" });
  assert.equal(openAiClientOptions({ AI_INTEGRATIONS_OPENAI_API_KEY: "r", AI_INTEGRATIONS_OPENAI_BASE_URL: "u" }).source, "integration");
});

test("repetitive goes to DeepSeek with its model, thinking off and the request reserved + settled", async () => {
  const ledger = new InMemoryAiProviderLedger();
  const { calls, make } = fakeClients();
  const client = createRoutedOpenAI({ tier: "repetitive", label: "t", env: KEYS, ledger, makeClient: make });
  const result = await client.chat.completions.create(chatBody);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].provider, "deepseek");
  assert.equal(calls[0].body.model, "deepseek-flash");
  assert.deepEqual(calls[0].body.thinking, { type: "disabled" });
  assert.equal(calls[0].body.max_tokens, 200);
  assert.equal(calls[0].body.max_completion_tokens, undefined);
  assert.equal(result.model, "deepseek-flash");
  assert.equal(ledger.rows.length, 1);
  assert.equal(ledger.rows[0].status, "settled");
  assert.equal(ledger.rows[0].costUsd, routerCostUsd("deepseek-flash", 1000, 100));
});

test("standard goes to OpenAI own key with the caller's model", async () => {
  const ledger = new InMemoryAiProviderLedger();
  const { calls, make } = fakeClients();
  await createRoutedOpenAI({ tier: "standard", label: "t", env: KEYS, ledger, makeClient: make }).chat.completions.create(chatBody);
  assert.equal(calls[0].provider, "openai");
  assert.equal(calls[0].body.model, "gpt-4o");
  assert.equal(ledger.rows[0].provider, "openai");
  assert.equal(ledger.rows[0].costUsd, routerCostUsd("gpt-4o", 1000, 100));
});

test("OpenAI cap exhausted -> DeepSeek; critical uses DEEPSEEK_STRONG_MODEL", async () => {
  const ledger = new InMemoryAiProviderLedger();
  const env = { ...KEYS, AI_OPENAI_MONTHLY_BUDGET_USD: "1", DEEPSEEK_STRONG_MODEL: "deepseek-v4-pro" };
  await ledger.reserve({ provider: "openai", tier: "standard", label: "seed", model: "gpt-4o", amountUsd: 0.9999, monthlyCapUsd: 1 });
  const { calls, make } = fakeClients();
  await createRoutedOpenAI({ tier: "critical", label: "t", env, ledger, makeClient: make }).chat.completions.create(chatBody);
  assert.deepEqual(calls.map((c) => c.provider), ["deepseek"]);
  assert.equal(calls[0].body.model, "deepseek-v4-pro");
});

test("both caps exhausted -> AiBudgetUnavailableError and never spills to Replit integration", async () => {
  const ledger = new InMemoryAiProviderLedger();
  const env = { ...KEYS, AI_OPENAI_MONTHLY_BUDGET_USD: "0", AI_DEEPSEEK_MONTHLY_BUDGET_USD: "0" };
  const { calls, make } = fakeClients();
  await assert.rejects(createRoutedOpenAI({ tier: "standard", label: "t", env, ledger, makeClient: make }).chat.completions.create(chatBody), AiBudgetUnavailableError);
  assert.equal(calls.length, 0);
  assert.equal(ledger.rows.length, 0);
});

test("provider error falls back to the other provider; unknown outcome keeps the reservation charged", async () => {
  const ledger = new InMemoryAiProviderLedger();
  const { calls, make } = fakeClients({ openai: "error" });
  const result = await createRoutedOpenAI({ tier: "standard", label: "t", env: KEYS, ledger, makeClient: make }).chat.completions.create(chatBody);
  assert.deepEqual(calls.map((c) => c.provider), ["openai", "deepseek"]);
  assert.equal(result.model, "deepseek-flash");
  const failed = ledger.rows.find((r) => r.provider === "openai")!;
  assert.equal(failed.status, "failed");
  assert.equal(failed.costUsd, failed.reservedUsd);
});

test("a 400 rejection is released (not billed) and the next provider is tried", async () => {
  const ledger = new InMemoryAiProviderLedger();
  const { calls, make } = fakeClients({ deepseek: "reject400" });
  await createRoutedOpenAI({ tier: "repetitive", label: "t", env: KEYS, ledger, makeClient: make }).chat.completions.create(chatBody);
  assert.deepEqual(calls.map((c) => c.provider), ["deepseek", "openai"]);
  assert.equal(ledger.rows.find((r) => r.provider === "deepseek")!.costUsd, 0);
});

test("own providers both down -> Replit integration is the last fallback (uncapped legacy path)", async () => {
  const ledger = new InMemoryAiProviderLedger();
  const { calls, make } = fakeClients({ openai: "error", deepseek: "error" });
  await createRoutedOpenAI({ tier: "standard", label: "t", env: KEYS, ledger, makeClient: make }).chat.completions.create(chatBody);
  assert.deepEqual(calls.map((c) => c.provider), ["openai", "deepseek", "integration"]);
  assert.equal(calls[2].body.model, "gpt-4o");
});

test("ledger failure: an own-key provider is never called without a reservation", async () => {
  const { calls, make } = fakeClients();
  const broken = { reserve: async () => { throw new Error("db down"); }, settle: async () => undefined, monthToDate: async () => 0 };
  await createRoutedOpenAI({ tier: "standard", label: "t", env: { OPENAI_API_KEY: "sk-own" }, ledger: broken, makeClient: make })
    .chat.completions.create(chatBody).then(() => assert.fail("should not succeed"), () => undefined);
  assert.equal(calls.length, 0);
});

test("no own key configured: legacy client is used verbatim and the ledger is untouched", async () => {
  const ledger = new InMemoryAiProviderLedger();
  const legacyCalls: any[] = [];
  const legacy: ChatLikeClient = { chat: { completions: { create: async (body: any, opts: any) => { legacyCalls.push({ body, opts }); return { ok: true }; } } } };
  const client = createRoutedOpenAI({ tier: "repetitive", label: "t", env: { AI_INTEGRATIONS_OPENAI_API_KEY: "replit-key" }, ledger, legacy: () => legacy,
    makeClient: () => { throw new Error("must not build provider clients"); } });
  assert.equal(client.routed, false);
  const opts = { timeout: 1 };
  assert.deepEqual(await client.chat.completions.create(chatBody, opts), { ok: true });
  assert.equal(legacyCalls[0].body, chatBody);
  assert.equal(legacyCalls[0].opts, opts);
  assert.equal(ledger.rows.length, 0);
});

test("responses API: hosted web_search stays on OpenAI even for repetitive tier; web search calls are charged", async () => {
  const ledger = new InMemoryAiProviderLedger();
  const { calls, make } = fakeClients();
  const body = { model: "gpt-4o-mini", input: "find events", tools: [{ type: "web_search" }], max_output_tokens: 500 };
  await createRoutedOpenAI({ tier: "repetitive", label: "t", env: KEYS, ledger, makeClient: make }).responses!.create(body);
  assert.deepEqual(calls.map((c) => c.provider), ["openai"]);
  assert.equal(ledger.rows[0].costUsd, routerCostUsd("gpt-4o-mini", 2000, 200, 1));
});

test("responses API without hosted tools is translated for DeepSeek and returned in Responses shape", async () => {
  const ledger = new InMemoryAiProviderLedger();
  const { calls, make } = fakeClients();
  const body = {
    model: "gpt-5.6-luna", instructions: "Eres el agente", input: "{\"q\":1}", max_output_tokens: 300, store: false,
    reasoning: { effort: "low" }, text: { verbosity: "low", format: { type: "json_schema", name: "x", strict: true, schema: { type: "object" } } },
  };
  const res = await createRoutedOpenAI({ tier: "repetitive", label: "t", env: KEYS, ledger, makeClient: make }).responses!.create(body);
  assert.equal(calls[0].provider, "deepseek");
  assert.equal(calls[0].body.response_format.type, "json_object");
  assert.match(calls[0].body.messages[0].content, /json/);
  assert.equal(calls[0].body.messages[1].content, "Eres el agente");
  assert.equal(calls[0].body.max_tokens, 300);
  assert.equal(calls[0].body.store, undefined);
  assert.equal(res.output_text, "{\"from\":\"deepseek\"}");
  assert.equal(res.usage.input_tokens, 1000);
  assert.equal(res.status, "completed");
});

test("audio transcription is OpenAI-only and reserved", async () => {
  const ledger = new InMemoryAiProviderLedger();
  const { calls, make } = fakeClients();
  await createRoutedOpenAI({ tier: "standard", label: "t", env: KEYS, ledger, makeClient: make }).audio!.transcriptions.create({ model: "whisper-1", file: "x" });
  assert.deepEqual(calls.map((c) => c.provider), ["openai"]);
  assert.equal(ledger.rows[0].costUsd, 0.05);
});

test("ledger accounting: month-to-date sums settled + reserved rows per provider and enforces the cap", async () => {
  const ledger = new InMemoryAiProviderLedger();
  const r1 = await ledger.reserve({ provider: "openai", tier: "standard", label: "a", model: "gpt-4o", amountUsd: 1, monthlyCapUsd: 2 });
  await ledger.settle(r1!, { ok: true, costUsd: 0.25 });
  const r2 = await ledger.reserve({ provider: "openai", tier: "standard", label: "b", model: "gpt-4o", amountUsd: 1.5, monthlyCapUsd: 2 });
  assert.ok(r2);
  assert.equal(await ledger.monthToDate("openai"), 1.75);
  assert.equal(await ledger.reserve({ provider: "openai", tier: "standard", label: "c", model: "gpt-4o", amountUsd: 0.3, monthlyCapUsd: 2 }), null);
  assert.equal(await ledger.monthToDate("deepseek"), 0);
  await ledger.settle(r1!, { ok: true, costUsd: 99 }); // settling twice is a no-op
  assert.equal(await ledger.monthToDate("openai"), 1.75);
});

test("adapters and estimates", () => {
  const ds = toDeepSeekChatBody({ model: "gpt-4o", messages: [], store: true, safety_identifier: "x", response_format: { type: "json_object" } }, "deepseek-flash", false);
  assert.equal(ds.store, undefined);
  assert.equal(ds.safety_identifier, undefined);
  assert.equal(ds.messages[0].role, "system");
  const r = responsesToDeepSeekChatBody({ input: [{ role: "user", content: [{ type: "input_text", text: "hi" }] }] }, "deepseek-flash", true);
  assert.equal(r.thinking, undefined);
  assert.equal(r.messages[0].content, "hi");
  const resp = chatCompletionToResponse({ choices: [{ message: { content: "x" }, finish_reason: "length" }], usage: { prompt_tokens: 1, completion_tokens: 2 } }, "deepseek-flash");
  assert.equal(resp.status, "incomplete");
  assert.ok(estimateReservationUsd("gpt-4o", chatBody) > routerCostUsd("gpt-4o", 0, 200));
  assert.equal(routerCostUsd("gpt-5.6-luna", 1e6, 0), 1.25); // gpt-5 prefix, same as aiUsage
  assert.equal(routerCostUsd("unknown-model", 1e6, 0), 5);
});

test("routedText: repetitive prompt goes to DeepSeek and reports provider, model and cost", async () => {
  const { routedText } = await import("../server/ai-model-router");
  const ledger = new InMemoryAiProviderLedger();
  const { calls, make } = fakeClients();
  const out = await routedText({ tier: "repetitive", label: "telegram-chat", prompt: "hola", maxTokens: 50, env: KEYS, ledger, makeClient: make });
  assert.equal(out.provider, "deepseek");
  assert.equal(out.model, "deepseek-flash");
  assert.equal(calls[0].body.max_tokens, 50);
  assert.equal(out.costUsd, routerCostUsd("deepseek-flash", 1000, 100));
});

test("web chat cheap scout uses DeepSeek when DEEPSEEK_API_KEY is set, Gemini otherwise", async () => {
  const { shouldUseCheapScoutForWebChat } = await import("../server/ai-router");
  const saved = { ...process.env };
  try {
    process.env.AI_INTEGRATIONS_GEMINI_API_KEY = "g";
    delete process.env.DEEPSEEK_API_KEY;
    assert.equal(shouldUseCheapScoutForWebChat({ message: "dame ideas de captions" }).provider, "gemini");
    process.env.DEEPSEEK_API_KEY = "ds";
    assert.equal(shouldUseCheapScoutForWebChat({ message: "dame ideas de captions" }).provider, "deepseek");
    delete process.env.AI_INTEGRATIONS_GEMINI_API_KEY;
    const route = shouldUseCheapScoutForWebChat({ message: "dame ideas de captions" });
    assert.equal(route.tier, "cheap_scout");
    assert.equal(route.provider, "deepseek");
  } finally {
    for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k];
    Object.assign(process.env, saved);
  }
});
