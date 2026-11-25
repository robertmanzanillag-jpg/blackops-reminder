import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createSharedOpenAiCreditLedger, type SharedCreditState } from "../server/shared-openai-credit-ledger";
import { createAnthropicFactoryTextProvider, ANTHROPIC_FACTORY_MIN_OUTPUT_TOKENS, type AnthropicFactoryClient } from "../server/software-factory-anthropic";
import { createAnthropicFactoryLedger, loadAnthropicOfficeRuntime } from "../server/software-factory-anthropic-ledger";
import { runFactoryModelCall, type FactoryModelRoute } from "../server/software-factory-model-routes";
import { createOpenAiFactoryPatchGenerator } from "../server/software-factory-openai-builder";
import { FactoryOpenAiRequestRejectedError } from "../server/factory-api-cache-usage";
import { markProviderCreditExhausted, readProviderCooldowns, readExpiredProviderCooldowns, refreshExpiredOpenAiCooldown, probeOpenAiCredit, clearProviderCooldown, AI_PROVIDER_COOLDOWN_MAX_MS } from "../server/ai-provider-credit-cooldown";
import { createCreditLimitedOfficeClaudeRun, type OfficeClaudeApiAuthority } from "../server/office-anthropic-credits";
import { runWithProviderFailover } from "../server/office-execution";
import { factoryStoppedReasonCode, shapeStoppedJobs } from "../script/software-factory-db-cli";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const NOW = new Date("2026-11-25T21:15:00.000Z"), now = () => NOW, H = 3600000;
function memoryStore() {
  const rows = new Map<string, string>();
  return { rows, read: async (owner: string) => rows.get(owner) ?? null,
    transact: async (owner: string, fn: (raw: string | null) => Promise<string>) => { const next = await fn(rows.get(owner) ?? null); rows.set(owner, next); return next; } };
}
function openAiLedger() {
  let state: SharedCreditState = { version: 1, grant: null, reservations: [], lastObservedAt: null };
  return createSharedOpenAiCreditLedger({ now, maximumGrantObservationAgeMs: 60000,
    grant: { id: "g", accountScope: "openai-test", availableMicroUsd: 5_000_000, observedAt: "2026-11-25T21:14:30.000Z", expiresAt: "2026-12-19T00:00:00.000Z", verificationEvidenceId: "e" },
    transact: async mutate => { const copy = structuredClone(state); const out = mutate(copy); state = copy; return out; } });
}
function claudeClient(text: string) {
  const streams: any[] = [];
  const client: AnthropicFactoryClient = {
    async countTokens() { return { input_tokens: 20000 }; },
    stream(params) { streams.push(params); let c = () => {}; return { onConnect(l) { c = l; }, async finalMessage() { c(); return { id: "msg_1", type: "message", role: "assistant", model: "claude-opus-5-5", stop_reason: "end_turn", stop_details: null,
      content: [{ type: "text", text }], usage: { input_tokens: 20000, output_tokens: 3000, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, iterations: null } }; } }; },
  };
  return { client, streams };
}
const claudeModel = (client: AnthropicFactoryClient) => ({ request: async () => { throw Error("unused"); }, model: "claude-opus-5-5", inputNanoUsdPerToken: 4000, outputNanoUsdPerToken: 20000,
  pricingValidUntil: "2027-05-19T00:00:00.000Z", now, maxInputTokens: 100000, effort: "high" as const, client });
const openAiQuota = async (url: string) => { if (url.endsWith("/input_tokens")) return Response.json({ object: "response.input_tokens", input_tokens: 10 }); throw new FactoryOpenAiRequestRejectedError(429, "insufficient_quota"); };
const openAiTestPrice = { model: "gpt-6-astra", inputNanoUsdPerToken: 1000, outputNanoUsdPerToken: 8000, cachedInputNanoUsdPerToken: 100, cacheWrite30mNanoUsdPerToken: 1250, cacheWrite12hNanoUsdPerToken: 2500, maxInputTokens: 272000, validUntil: "2027-01-01T00:00:00.000Z", evidenceSha256: "a".repeat(64) };
function authority() {
  const rows = new Map<string, { max: number; status: string; actual?: number }>();
  return { rows, owner: () => "synthetic-owner", store: {
    async reserveApi(_o: string, i: { key: string; maximumMicroUsd: number }) { if (rows.has(i.key)) return { admitted: false }; rows.set(i.key, { max: i.maximumMicroUsd, status: "reserved" }); return { admitted: true }; },
    async settleApi(_o: string, k: string, i: { actualMicroUsd: number }) { const r = rows.get(k)!; r.status = "settled"; r.actual = i.actualMicroUsd; return undefined; },
    async unknownApi(_o: string, k: string) { rows.get(k)!.status = "unknown"; } } };
}

test("Claude build with the real 32k output setting fits a <=$1 reservation by clamping max_tokens (was PROVIDER_BUDGET_UNAVAILABLE)", async () => {
  const { client, streams } = claudeClient("{\"ok\":true}");
  const out = await createAnthropicFactoryTextProvider(claudeModel(client))({ instructions: "x", text: "{\"t\":1}", maxOutputTokens: 32000, maxCostCents: 95, signal: new AbortController().signal });
  assert.equal(out.status, "completed");
  const maxTokens = streams[0].max_tokens;
  assert.ok(maxTokens >= ANTHROPIC_FACTORY_MIN_OUTPUT_TOKENS && maxTokens < 32000, String(maxTokens));
  // Worst case (input + output at listed + max fallback rate) stays inside the 95c reservation.
  assert.ok(20000 * 9000 + maxTokens * 45000 <= 95 * 10_000_000);
  // Too small to fit even the floor still blocks before streaming.
  const tiny = claudeClient("{}");
  assert.equal((await createAnthropicFactoryTextProvider(claudeModel(tiny.client))({ instructions: "x", text: "{\"t\":1}", maxOutputTokens: 32000, maxCostCents: 40, signal: new AbortController().signal })).reason, "FACTORY_ANTHROPIC_BUDGET_UNAVAILABLE");
  assert.equal(tiny.streams.length, 0);
});

test("end to end: OpenAI 429 insufficient_quota -> Claude builds a patch, held and settled on the $100 API authority", async () => {
  const oa = openAiLedger(); await oa.initialize();
  const claudeLedger = await createAnthropicFactoryLedger({ store: memoryStore(), now, capMicroUsd: 50_000_000 });
  const edits = JSON.stringify({ edits: [{ path: "src/a.ts", before: "return 1;", after: "return 2;" }, { path: "tests/a.test.ts", before: "// none", after: "// covered" }] });
  const claude = claudeClient(edits), auth = authority();
  const routes: FactoryModelRoute[] = [
    { provider: "openai", ledger: oa, model: { request: openAiQuota, apiPrice: openAiTestPrice, model: "gpt-6-astra", inputNanoUsdPerToken: 1000, outputNanoUsdPerToken: 8000, pricingValidUntil: "2027-01-01T00:00:00.000Z", now, maxInputTokens: 100000 } as any },
    { provider: "anthropic", ledger: claudeLedger, model: claudeModel(claude.client), apiAuthority: { store: auth.store, owner: auth.owner } }];
  const seen: string[] = [];
  const generateText = async (input: any) => (await runFactoryModelCall(routes, { key: "factory:build:e2e", input, unknownError: "FACTORY_MODEL_OUTCOME_UNKNOWN",
    requestSha256: m => createHash("sha256").update(m.model).digest("hex"), evidenceId: s => `factory-model:${s}`,
    onCreditExhausted: (p, r) => { seen.push(`${p}:${r}`); }, onProviderCompleted: p => { seen.push(`ok:${p}`); } })).result;
  const root = await mkdtemp(path.join(os.tmpdir(), "claude-e2e-"));
  try {
    await import("node:fs/promises").then(fs => Promise.all([fs.mkdir(path.join(root, "src")), fs.mkdir(path.join(root, "tests"))]));
    await writeFile(path.join(root, "src/a.ts"), "export const f = () => { return 1; };\n");
    await writeFile(path.join(root, "tests/a.test.ts"), "// none\n");
    const generate = createOpenAiFactoryPatchGenerator({ generateText: generateText as any, sourcePaths: { "o/r": ["src/a.ts", "tests/a.test.ts"] }, maxOutputTokens: 32000, patchMode: "exactSourceEdits", requireTestEdit: true });
    const built = await generate({ repository: "o/r", baseSha: "a".repeat(40), request: "fix", reservedCents: 95, testCommand: [], buildCommand: [] }, { workspace: root, maxCostCents: 95 });
    assert.equal(built.diagnostic, undefined);
    assert.match(built.patch, /\+export const f = \(\) => \{ return 2; \};/);
    assert.ok(built.costCents > 0 && built.costCents <= 95);
  } finally { await rm(root, { recursive: true, force: true }); }
  assert.deepEqual(seen, ["openai:OPENAI_INSUFFICIENT_QUOTA", "ok:anthropic"]);
  assert.equal((await oa.status()).reservedMicroUsd, 0);
  const [row] = [...auth.rows.values()];
  assert.equal(row.status, "settled"); assert.ok(row.actual! > 0 && row.actual! <= row.max);
});

test("expired OpenAI cooldown: zero-cost probe renews it with backoff (no job attempt), success/inconclusive keeps OpenAI first", async () => {
  const store = memoryStore(), t0 = new Date(NOW.getTime() - 7 * H);
  await markProviderCreditExhausted(store, "openai", "OPENAI_INSUFFICIENT_QUOTA", t0, 6 * H);
  assert.deepEqual((await readProviderCooldowns(store, NOW)).active, {});
  assert.ok((await readExpiredProviderCooldowns(store, NOW)).openai);
  const env = { ANTHROPIC_API_KEY: "sk-ant-x" };
  let probes = 0;
  const kept = await refreshExpiredOpenAiCooldown({ store, now, env, claudeEnabled: true, active: {}, probe: async () => { probes++; return "inconclusive"; } });
  assert.deepEqual(kept, {});
  const renewed = await refreshExpiredOpenAiCooldown({ store, now, env, claudeEnabled: true, active: {}, probe: async () => { probes++; return "exhausted"; } });
  assert.equal(renewed.openai?.strikes, 2);
  assert.equal(Date.parse(renewed.openai!.until) - NOW.getTime(), 12 * H);
  assert.equal(renewed.openai?.since, t0.toISOString());
  // Active cooldown: no probe at all.
  await refreshExpiredOpenAiCooldown({ store, now, env, claudeEnabled: true, active: renewed, probe: async () => { probes++; return "exhausted"; } });
  assert.equal(probes, 2);
  // Backoff caps at 24 h; a success clears the strikes.
  await markProviderCreditExhausted(store, "openai", "OPENAI_INSUFFICIENT_QUOTA", new Date(NOW.getTime() + 13 * H), 6 * H);
  await markProviderCreditExhausted(store, "openai", "OPENAI_INSUFFICIENT_QUOTA", new Date(NOW.getTime() + 40 * H), 6 * H);
  const capped = (await readProviderCooldowns(store, new Date(NOW.getTime() + 40 * H))).active.openai!;
  assert.equal(Date.parse(capped.until) - (NOW.getTime() + 40 * H), AI_PROVIDER_COOLDOWN_MAX_MS);
  await clearProviderCooldown(store, "openai");
  assert.deepEqual(await readExpiredProviderCooldowns(store, new Date(NOW.getTime() + 100 * H)), {});
  // Claude off: never probes.
  assert.deepEqual(await refreshExpiredOpenAiCooldown({ store, now, env, claudeEnabled: false, active: {}, probe: async () => { throw Error("no"); } }), {});
});

test("OpenAI probe uses only the free token-count endpoint and reads documented credit codes", async () => {
  const urls: string[] = [];
  const reply = (status: number, body: unknown) => (async (url: string) => { urls.push(url); return Response.json(body, { status }); }) as unknown as typeof fetch;
  const key = "sk-" + "a".repeat(30);
  assert.equal(await probeOpenAiCredit({ apiKey: key, model: "gpt-6.1-sol", fetch: reply(429, { error: { code: "insufficient_quota" } }) }), "exhausted");
  assert.equal(await probeOpenAiCredit({ apiKey: key, model: "gpt-6.1-sol", fetch: reply(429, { error: { code: "rate_limit_exceeded" } }) }), "inconclusive");
  assert.equal(await probeOpenAiCredit({ apiKey: key, model: "gpt-6.1-sol", fetch: reply(200, { object: "response.input_tokens", input_tokens: 1 }) }), "available");
  assert.equal(await probeOpenAiCredit({ apiKey: "", model: "gpt-6.1-sol", fetch: reply(200, {}) }), "inconclusive");
  assert.deepEqual([...new Set(urls)], ["https://api.openai.com/v1/responses/input_tokens"]);
});

test("office role job: expired cooldown + probe exhausted runs on Claude without calling OpenAI; Claude spend held on the API authority", async () => {
  const store = memoryStore(), env = { OFFICE_ANTHROPIC_FALLBACK_ENABLED: "true", OFFICE_ANTHROPIC_MONTHLY_BUDGET_USD: "20", ANTHROPIC_API_KEY: "sk-ant-x" };
  await markProviderCreditExhausted(store, "openai", "OPENAI_INSUFFICIENT_QUOTA", new Date(NOW.getTime() - 7 * H), 6 * H);
  const runtime = await loadAnthropicOfficeRuntime(env, now, store);
  const held: string[] = [];
  const auth: OfficeClaudeApiAuthority = { reserve: async (k, _s, max) => { held.push(`reserve:${max > 0}`); return true; }, settle: async (_k, actual) => { held.push(`settle:${actual}`); return true; }, unknown: async () => { held.push("unknown"); } };
  const claude = createCreditLimitedOfficeClaudeRun({ ...runtime, apiKey: "sk-ant-" + "a".repeat(30), now, authority: auth,
    fetch: (async () => Response.json({ id: "msg_9", model: "claude-opus-5-5", stop_reason: "end_turn", content: [{ type: "text", text: "trabajo del rol hecho" }], usage: { input_tokens: 100, output_tokens: 50 } })) as typeof fetch });
  let openAiCalls = 0;
  const result = await runWithProviderFailover({ env, now, store, assigned: "role-work:marketing-cmo:1", prompt: "Haz el trabajo del rol",
    openai: async () => { openAiCalls++; throw Error("OFFICE_OPENAI_CREDIT_EXHAUSTED"); }, claude, probe: async () => "exhausted" });
  assert.equal(result.provider, "anthropic"); assert.equal(result.text, "trabajo del rol hecho");
  assert.equal(openAiCalls, 0);
  assert.deepEqual(held, ["reserve:true", "settle:1400"]);
  assert.ok((await readProviderCooldowns(store, now())).active.openai);
  // Billing rejection releases the authority hold at $0.
  const broke = createCreditLimitedOfficeClaudeRun({ ...runtime, apiKey: "sk-ant-" + "a".repeat(30), now, authority: auth, fetch: (async () => Response.json({ type: "error", error: { type: "billing_error" } }, { status: 402 })) as typeof fetch });
  await assert.rejects(broke("p", "role-work:2"), /OFFICE_ANTHROPIC_CREDIT_EXHAUSTED/);
  assert.equal(held.at(-1), "settle:0");
});

test("stopped-job reasons keep their real code instead of UNSPECIFIED", () => {
  assert.equal(factoryStoppedReasonCode("FACTORY_REMOTE_BUILD_FAILED:PROVIDER_REQUEST_REJECTED:FACTORY_OPENAI_REQUEST_REJECTED:429:insufficient_quota"),
    "FACTORY_REMOTE_BUILD_FAILED:PROVIDER_REQUEST_REJECTED:FACTORY_OPENAI_REQUEST_REJECTED:429:INSUFFICIENT_QUOTA");
  assert.equal(factoryStoppedReasonCode("FACTORY_PROJECT_PAUSED,FACTORY_PR_LIMIT"), "FACTORY_PROJECT_PAUSED:AND_1_MORE");
  assert.equal(factoryStoppedReasonCode(null), "FACTORY_REASON_NOT_RECORDED");
  assert.equal(factoryStoppedReasonCode("Build or publication unconfirmed. Reconcile before retry"), "FACTORY_REASON_FREE_TEXT");
  const long = "FACTORY_REMOTE_BUILD_FAILED:" + "X".repeat(200);
  assert.ok(factoryStoppedReasonCode(long).length <= 120 && factoryStoppedReasonCode(long).startsWith("FACTORY_REMOTE_BUILD_FAILED:"));
  assert.equal(factoryStoppedReasonCode("FACTORY_REMOTE_BUILD_FAILED:PATCH"), "FACTORY_REMOTE_BUILD_FAILED:PATCH");
  const [row] = shapeStoppedJobs([{ status: "failed", kind: "build", reason: "FACTORY_REMOTE_BUILD_FAILED:PROVIDER_REQUEST_REJECTED:FACTORY_OPENAI_REQUEST_REJECTED:429:insufficient_quota", order_id: null, created_at: NOW, completed_at: NOW }]);
  assert.notEqual(row.reason, "UNSPECIFIED");
});
