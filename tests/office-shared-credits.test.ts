import {fixtureFactoryInvocation} from "./fixtures/factory-api-budget";
import test from "node:test";
import assert from "node:assert/strict";
import { createCreditLimitedOfficeRun } from "../server/office-shared-credits";
import { createSharedOpenAiCreditLedger, type SharedCreditState } from "../server/shared-openai-credit-ledger";
import { createOfficeTokenBudget, type OfficeTokenBudgetState } from "../server/office-token-budget";

const model = "gpt-4.1-mini-2025-04-14", initialTime = "2026-11-06T12:00:00.000Z", expiry = "2026-11-20T00:00:00.000Z";
// Synthetic prices only; these do not establish production pricing evidence.
const approvedPrice = { model, inputNanoUsdPerToken: 400, outputNanoUsdPerToken: 1600,
  cachedInputNanoUsdPerToken: 100, cacheWrite30mNanoUsdPerToken: 500, cacheWrite12hNanoUsdPerToken: 800, maxInputTokens:1_049_600,
  validUntil: "2026-12-20T00:00:00.000Z", evidenceSha256: "a".repeat(64) };
const catalog = (price: unknown = approvedPrice) => JSON.stringify({ version: 1, prices: [{ provider: "openai", ...price as any }] });
const response = () => ({ id: "resp_fixture", model, status: "completed", usage: { input_tokens_details:{cached_tokens:0,cache_write_tokens:0}, input_tokens: 100, output_tokens: 10, total_tokens: 110 },
  output: [{ type: "message", role: "assistant", status: "completed", content: [{ type: "output_text", text: "Verified fixture" }] }] });
async function fixture(fixedCents=0, pricingConfig: string | null = catalog()) {
  let time = new Date(initialTime), credit: SharedCreditState = { version: 1, grant: null, lastObservedAt: null, reservations: [] };
  let tokens: OfficeTokenBudgetState = { reservations: [] }, calls = 0, fail = false, expireBeforeRequest = false, loseSettlementAck = false;
  let body: any = response(), rawResponse: Response | undefined, sentBody = "";
  let tokenFailure: "before-commit" | "lost-ack" | undefined;
  const ledger = createSharedOpenAiCreditLedger({ grant: { id: "g", accountScope: "shared-account", availableMicroUsd: 1_000_000,
    observedAt: initialTime, expiresAt: expiry, verificationEvidenceId: "verified-grant-proof" }, now: () => time, maximumGrantObservationAgeMs: 1000,
    transact: async mutate => { const copy = structuredClone(credit), result = mutate(copy); credit = copy;
      if (loseSettlementAck && credit.reservations[0]?.status === "settled") { loseSettlementAck = false; throw Error("lost commit ack"); }
      return result;
    } });
  await ledger.initialize();
  const tokenBudget = createOfficeTokenBudget({ limit: 100_000, now: () => time,
    transact: async mutate => { const copy = structuredClone(tokens); mutate(copy); tokens = copy; } });
  const primary = fixtureFactoryInvocation(()=>time,undefined,fixedCents);
  let primaryPromptBytes: number | undefined;
  const monetary = Object.assign(async <T>(input: Parameters<typeof primary<T>>[0]) => {
    primaryPromptBytes = input.promptBytes;
    return primary<T>(input);
  }, {preflight:primary.preflight});
  const run = createCreditLimitedOfficeRun({ factoryInvocation:monetary, ledger, now: () => time,
    env: { OFFICE_REVIEW_PROVIDER: "openai", OFFICE_OPENAI_MODEL: model, OFFICE_OPENAI_MAX_OUTPUT_TOKENS: "32", OPENAI_API_KEY: "synthetic-test-key", ...(pricingConfig === null ? {} : { FACTORY_API_PRICING_CONFIG: pricingConfig }) },
    pricing: { model, inputNanoUsdPerToken: 400, outputNanoUsdPerToken: 1600, validUntil: "2026-12-20T00:00:00.000Z" },
    authorizeTokens: async limits => {
      assert.deepEqual(Object.keys(limits).sort(),["maxOutputTokens","model","promptBytes"]);
      if (tokenFailure === "before-commit") throw Object.assign(Error("private-owner-lock-detail"), { code: "55P03" });
      const id = await tokenBudget.reserve(limits);
      if (tokenFailure === "lost-ack") throw Error("private-token-commit-ack-detail");
      if (expireBeforeRequest) time = new Date(expiry); return id;
    },
    recordTokens: (id, metadata) => tokenBudget.recordUsage(id, metadata), releaseTokens: id => tokenBudget.release(id),
    fetch: (async (url: string | URL | Request, init?: RequestInit) => {
      sentBody = String(init?.body);
      calls++; assert.equal(String(url), "https://api.openai.com/v1/responses"); assert.equal(init?.signal?.aborted, false);
      assert.equal(credit.reservations[0].status, "reserved"); assert.equal(tokens.reservations[0].status, "reserved");
      if (fail) throw Error("private-provider-detail");
      return rawResponse ?? Response.json(body);
    }) as typeof fetch,
  });
  return { run, ledger, primaryPromptBytes: () => primaryPromptBytes, requestBody: () => sentBody, credit: () => credit, tokens: () => tokens, calls: () => calls,
    body: (value: unknown) => { body = value; }, rawResponse: (value: Response) => { rawResponse = value; }, fail: () => { fail = true; }, expire: () => { expireBeforeRequest = true; }, loseAck: () => { loseSettlementAck = true; },
    failTokens: (kind: "before-commit" | "lost-ack") => { tokenFailure = kind; } };
}

test("token admission refusal precedes fetch but preserves shared uncertainty across lost acknowledgments", async () => {
  for (const kind of ["before-commit", "lost-ack"] as const) {
    const f = await fixture(); f.failTokens(kind);
    await assert.rejects(f.run("Review synthetic work", "assignment:token-refused"), /^Error: OFFICE_CREDIT_EXECUTION_UNCONFIRMED$/);
    assert.equal(f.calls(), 0);
    assert.equal(f.tokens().reservations.length, kind === "before-commit" ? 0 : 1);
    assert.equal(f.credit().reservations[0].status, "unknown");
    assert.equal((await f.ledger.status()).uncertain, true);
    assert.ok((await f.ledger.status()).reservedMicroUsd > 0);
    await assert.rejects(f.run("Review synthetic work", "assignment:token-refused"));
    await assert.rejects(f.run("Next request", "assignment:other"));
    assert.equal(f.calls(), 0);
  }
});

test("Office exact usage settles common money and secondary tokens before returning output", async () => {
  const f = await fixture(); const result = await f.run("Review synthetic work", "assignment:phase1");
  assert.equal(result.text, "Verified fixture"); assert.equal(f.calls(), 1);
  assert.equal((await f.ledger.status()).spentMicroUsd, 56); assert.equal((await f.ledger.status()).reservedMicroUsd, 0);
  assert.equal(f.tokens().reservations[0].status, "accounted");
  await assert.rejects(f.run("Review synthetic work", "assignment:phase1")); assert.equal(f.calls(), 1);
  await assert.rejects(f.run("Different request", "assignment:phase1")); assert.equal(f.calls(), 1);
});

test("known terminal incomplete output still settles exact usage without claiming successful work", async () => {
  const f = await fixture(); f.body({ ...response(), status: "incomplete", incomplete_details: { reason: "max_output_tokens" }, output: [] });
  await assert.rejects(f.run("Review synthetic work", "assignment:incomplete"), /^Error: OFFICE_CREDIT_EXECUTION_UNCONFIRMED$/);
  assert.equal(f.calls(), 1); assert.equal((await f.ledger.status()).spentMicroUsd, 56);
  assert.equal((await f.ledger.status()).reservedMicroUsd, 0); assert.equal(f.tokens().reservations[0].status, "accounted");
});

test("unknown network or model mismatch retains both holds and never repeats paid calls", async () => {
  for (const reason of ["network", "model"] as const) {
    const f = await fixture(); if (reason === "network") f.fail(); else f.body({ ...response(), model: "unpriced-model" });
    await assert.rejects(f.run("Review synthetic work", "assignment:uncertain"), /^Error: OFFICE_CREDIT_EXECUTION_UNCONFIRMED$/);
    assert.equal(f.credit().reservations[0].status, "unknown"); assert.equal(f.tokens().reservations[0].status, "reserved");
    assert.ok((await f.ledger.status()).reservedMicroUsd > 0); assert.equal((await f.ledger.status()).spentMicroUsd, 0);
    await assert.rejects(f.run("Review synthetic work", "assignment:uncertain"));
    await assert.rejects(f.run("Next request", "assignment:next")); assert.equal(f.calls(), 1);
  }
});

test("grant expiry after token admission blocks network despite still-current pricing", async () => {
  const f = await fixture(); f.expire(); await assert.rejects(f.run("Review synthetic work", "assignment:expired"));
  assert.equal(f.calls(), 0); assert.equal(f.credit().reservations[0].status, "unknown");
  assert.equal((await f.ledger.status()).spentMicroUsd, 0); assert.ok((await f.ledger.status()).reservedMicroUsd > 0);
});

test("lost money settlement acknowledgment cannot cause another provider call", async () => {
  const f = await fixture(); f.loseAck(); await assert.rejects(f.run("Review synthetic work", "assignment:ack"));
  assert.equal((await f.ledger.status()).spentMicroUsd, 56); assert.equal(f.tokens().reservations[0].status, "reserved");
  await assert.rejects(f.run("Review synthetic work", "assignment:ack")); assert.equal(f.calls(), 1);
});

test("active provider execution with partial usage must retain money and token holds", async () => {
  for (const status of ["in_progress", "queued", "unknown_future_status"]) {
    const f = await fixture(); f.body({ ...response(), status, output: [] });
    await assert.rejects(f.run("Review synthetic work", "assignment:active"));
    assert.equal(f.credit().reservations[0].status, "unknown"); assert.equal(f.tokens().reservations[0].status, "reserved");
    assert.equal((await f.ledger.status()).spentMicroUsd, 0); assert.ok((await f.ledger.status()).reservedMicroUsd > 0);
  }
});

test("Factory zero balance holds before shared/token reservations and provider dispatch",async()=>{const f=await fixture(10000);await assert.rejects(f.run("Review synthetic work","zero-factory"),/OFFICE_CREDIT_EXECUTION_UNCONFIRMED/);assert.equal(f.calls(),0);assert.equal(f.credit().reservations.length,0);assert.equal(f.tokens().reservations.length,0);});


test("Office secondary reserve uses the worst approved cache rate and keeps public usage unchanged", async () => {
  const f = await fixture(), prompt = "Review synthetic work";
  const result = await f.run(prompt,"assignment:worst-cache");
  const expectedMaximum = Math.ceil(((Buffer.byteLength(f.requestBody())+1024)*800+32*1600)/1000);
  assert.equal(f.credit().reservations[0].reservedMicroUsd,expectedMaximum);
  assert.deepEqual(Object.keys(result.usage).sort(),["inputTokens","outputTokens","totalTokens"]);
  const g = await fixture(0,catalog({...approvedPrice,cacheWrite12hNanoUsdPerToken:1600, maxInputTokens:1_049_600}));
  await g.run(prompt,"assignment:worst-cache");
  assert.ok(g.credit().reservations[0].reservedMicroUsd > f.credit().reservations[0].reservedMicroUsd);
  assert.notEqual(g.credit().reservations[0].requestSha256,f.credit().reservations[0].requestSha256);
});

test("Office secondary settlement prices cache reads and both write TTL buckets exactly once", async () => {
  const cases = [
    [{cached_tokens:80,cache_write_tokens:0},32],
    [{cached_tokens:0,cache_write_tokens:80,cache_write_tokens_details:{ttl_30m_tokens:80,ttl_12h_tokens:0}},64],
    [{cached_tokens:0,cache_write_tokens:80,cache_write_tokens_details:{ttl_30m_tokens:0,ttl_12h_tokens:80}},88],
    [{cached_tokens:10,cache_write_tokens:60,cache_write_tokens_details:{ttl_30m_tokens:20,ttl_12h_tokens:40}},71],
  ] as const;
  for (const [details,expected] of cases) {
    const f = await fixture(); f.body({...response(),usage:{...response().usage,input_tokens_details:details}});
    const result = await f.run("Review synthetic work","assignment:cache-buckets");
    assert.equal((await f.ledger.status()).spentMicroUsd,expected);
    assert.equal((await f.ledger.status()).reservedMicroUsd,0);
    assert.equal(f.tokens().reservations[0].status,"accounted");
    assert.deepEqual(result.usage,{inputTokens:100,outputTokens:10,totalTokens:110});
  }
});

test("missing, mismatched or expired cache pricing holds before any money or token reservation", async () => {
  const incomplete = {...approvedPrice} as any; delete incomplete.cacheWrite12hNanoUsdPerToken;
  const cases: Array<[string|null,RegExp]> = [
    [null,/FACTORY_API_CACHE_WRITE_PRICING_UNVERIFIED/],
    [catalog(incomplete),/FACTORY_API_CACHE_WRITE_PRICING_UNVERIFIED/],
    [catalog({...approvedPrice,inputNanoUsdPerToken:401}),/FACTORY_API_PRICING_PROFILE_MISMATCH/],
    [catalog({...approvedPrice,validUntil:"2020-01-01T00:00:00.000Z"}),/OFFICE_CREDIT_PRICING_EXPIRED/],
  ];
  for (const [configuration,error] of cases) {
    const f = await fixture(0,configuration);
    await assert.rejects(f.run("Review synthetic work","assignment:missing-pricing"),error);
    assert.equal(f.calls(),0); assert.equal(f.credit().reservations.length,0); assert.equal(f.tokens().reservations.length,0);
  }
});

test("metadata must match the privately captured provider identity and token counters before secondary settlement", async () => {
  for (const change of [
    {id:"resp_other"}, {model:"other-model"},
    {usage:{...response().usage,input_tokens:101,total_tokens:111}},
    {usage:{...response().usage,output_tokens:11,total_tokens:111}},
    {usage:{...response().usage,total_tokens:111}},
  ]) {
    const f = await fixture(), raw = Response.json(response()), clone = raw.clone.bind(raw);
    let clones = 0;
    // Inject disagreement only into the private capture; the monetary guard and
    // Office parser each receive the valid original response. No live HTTP is used.
    raw.clone = () => ++clones === 2 ? Response.json({...response(),...change}) : clone();
    f.rawResponse(raw);
    await assert.rejects(f.run("Review synthetic work","assignment:metadata-mismatch"),/^Error: OFFICE_CREDIT_EXECUTION_UNCONFIRMED$/);
    assert.equal(f.calls(),1); assert.equal(f.credit().reservations[0].status,"unknown");
    assert.equal(f.tokens().reservations[0].status,"reserved"); assert.equal((await f.ledger.status()).spentMicroUsd,0);
  }
});


test("Office financial escrow uses the full escaped request byte bound shared with the primary guard", async () => {
  const f = await fixture(), prompt = '\"\\\n'.repeat(500) + 'ñ🚀';
  await f.run(prompt,"assignment:escaped-request-bound");
  const encoded = f.requestBody(), bytes = Buffer.byteLength(encoded), promptBytes = Buffer.byteLength(prompt);
  assert.equal(JSON.parse(encoded).input,prompt);
  assert.equal(f.primaryPromptBytes(),bytes);
  assert.ok(bytes > promptBytes);
  // The primary SDK guard uses JSON.stringify(body).byteLength + 1024 for the
  // same immutable body; secondary escrow must cover that identical maximum.
  const primaryBound = Math.ceil(((bytes+1024)*800+32*1600)/1000);
  assert.equal(f.credit().reservations[0].reservedMicroUsd,primaryBound);
  assert.equal(f.tokens().reservations[0].reservedTokens,promptBytes+32+1024);
});

test("OpenAI 429 insufficient_quota settles money at $0 and releases the token hold (not billed)", async () => {
  const f = await fixture();
  f.rawResponse(new Response(JSON.stringify({ error: { type: "insufficient_quota", code: "insufficient_quota", message: "synthetic" } }), { status: 429, headers: { "content-type": "application/json" } }));
  await assert.rejects(f.run("Review synthetic work", "assignment:quota"), /^Error: OFFICE_OPENAI_CREDIT_EXHAUSTED$/);
  assert.equal(f.calls(), 1);
  assert.equal(f.credit().reservations[0].status, "settled");
  assert.equal((await f.ledger.status()).spentMicroUsd, 0); assert.equal((await f.ledger.status()).reservedMicroUsd, 0);
  assert.equal(f.tokens().reservations[0].status, "released");
  // Replay of the same assignment never calls the provider again.
  await assert.rejects(f.run("Review synthetic work", "assignment:quota")); assert.equal(f.calls(), 1);
});
