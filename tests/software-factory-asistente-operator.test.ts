import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createAsistenteOperatorComposition, validateAsistenteOperatorConfig, type AsistenteOperatorConfig } from "../server/software-factory-asistente-operator";
import { createSharedOpenAiCreditLedger, type SharedCreditState, type CreditTransaction } from "../server/shared-openai-credit-ledger";
import { companyOrderJob } from "../server/software-factory-company";
import { validateFactoryWorkerOptions } from "../server/software-factory-runtime";
import type { CompanyOrder } from "../shared/agent-company";
const owner = "owner", ownerKey = createHash("sha256").update(owner).digest("hex"), at = new Date("2026-11-07T00:00:00Z");
const project: any = { id: "asistente", repo: "robertmanzanillag-jpg/blackops-reminder", automaticRelease: false, providerSupportsRelease: false, providerSupportsRollback: false, journeys: ["office-session-login", "office-company-navigation"] };
const order: CompanyOrder = { id: "approved", text: "Improve role work checks", createdAt: at.toISOString(), assignees: [{ agentId: "code", status: "en_curso", note: "" }] };
async function fixture() {
    let state: SharedCreditState = { version: 1, grant: null, lastObservedAt: null, reservations: [] }, tail: Promise<unknown> = Promise.resolve();
    const transact: CreditTransaction = async (fn) => { const p = tail.then(() => { const copy = structuredClone(state), r = fn(copy); state = copy; return r; }); tail = p.catch(() => { }); return p; };
    const ledger = createSharedOpenAiCreditLedger({ transact, now: () => at, maximumGrantObservationAgeMs: 60000, grant: { id: "grant", accountScope: "same-account", availableMicroUsd: 1000000, observedAt: at.toISOString(), expiresAt: "2026-11-20T00:00:00Z", verificationEvidenceId: "verified" } });
    await ledger.initialize();
    const input = companyOrderJob(order, project, 1), revision = (input.payload!.companyOrder as any).revision;
    const config: AsistenteOperatorConfig = { owner, projectId: "asistente", baseBranch: "main", sourcePaths: ["server/office-role-work.ts", "tests/office-role-work.test.ts"], checks: { trigger: "push", workflowId: 1, workflowPath: ".github/workflows/factory-candidate-checks.yml", workflowSha256: "a".repeat(64), jobName: "isolated", testStep: "tests", buildStep: "build", browserStep: "browser" }, archiveHosts: ["fixture.blob.core.windows.net"], reservations: { discover: 1, build: 2, simulate: 1, review: 2 }, maxInputTokens: 1000, maxOutputTokens: 100, orders: [{ id: order.id, revision, baseSha: "b".repeat(40), kind: "improvement", scenarioId: "office-role-work-owner-cas-v1" }], ui: { workflowId: 1, workflowSha256: "a".repeat(64), harnessSha256: "c".repeat(64) } };
    let paused = false, lost = false, calls = 0;
    const jobs: any[] = [];
    const store: any = { status: async () => ({ configured: true, paused, limitCents: 10000, fixedCents: 0, spentCents: 0, reservedCents: 0 }), projectByOwnerKey: async (key: string) => { assert.equal(key, ownerKey); return project; }, list: async () => jobs, enqueue: async (o: string, i: any) => { assert.equal(o, owner); calls++; assert.equal((await ledger.status()).reservedMicroUsd, 40000); const job = { ...i, id: "job", ownerKey, status: "pending" }; jobs.push(job); if (lost)
            throw Error("LOST_ACK"); return job; } };
    const deps = { store, credits: { ledger, pricing: { model: "gpt-6-astra", inputNanoUsdPerToken: 1, outputNanoUsdPerToken: 1, validUntil: "2026-11-20T00:00:00Z" } }, readOrders: async () => [order], githubRequest: async () => { throw Error("NO_GITHUB_CALL_EXPECTED"); }, modelRequest: async () => { throw Error("NO_PAID_CALL_EXPECTED"); }, download: fetch, readUi: async () => { throw Error("NO_FAKE_SIMULATION"); }, now: () => at };
    return { config, deps, ledger, input, jobs, calls: () => calls, pause: () => { paused = true; }, lose: () => { lost = true; } };
}
test("operator composes real four-stage proposal runtime and zero-provider guarded idempotent admission", async () => {
    const f = await fixture(), operator = createAsistenteOperatorComposition(f.config, f.deps), worker = await operator.createFactoryWorkerOptions();
    validateFactoryWorkerOptions(worker);
    assert.equal(worker.store, f.deps.store);
    assert.equal(worker.releaseMode, "review-only");
    assert.equal(worker.discoveryMode, "company-orders-only");
    assert.deepEqual(Object.keys(worker.adapters!).sort(), ["build", "discover", "review", "simulate"]);
    const first = await operator.admitWithinCredits(owner, f.input);
    assert.equal((await f.ledger.status()).spentMicroUsd, 0);
    assert.equal((await f.ledger.status()).reservedMicroUsd, 0);
    assert.deepEqual(await createAsistenteOperatorComposition(f.config, f.deps).admitWithinCredits(owner, f.input), first);
    assert.equal(f.calls(), 1);
});
test("lost enqueue acknowledgment retains admission hold and restart cannot replay it", async () => {
    const f = await fixture();
    f.lose();
    await assert.rejects(createAsistenteOperatorComposition(f.config, f.deps).admitWithinCredits(owner, f.input), /UNCONFIRMED/);
    assert.equal((await f.ledger.status()).reservedMicroUsd, 40000);
    assert.equal((await f.ledger.status()).uncertain, true);
    await assert.rejects(createAsistenteOperatorComposition(f.config, f.deps).admitWithinCredits(owner, f.input), /UNCONFIRMED/);
    assert.equal(f.calls(), 1);
});
test("operator blocks wrong owner, unmapped revision, paused factory and protected source configuration", async () => {
    const f = await fixture(), operator = createAsistenteOperatorComposition(f.config, f.deps);
    await assert.rejects(operator.admitWithinCredits("foreign", f.input), /OWNER_MISMATCH/);
    await assert.rejects(createAsistenteOperatorComposition({ ...f.config, orders: [] }, f.deps).admitWithinCredits(owner, f.input), /NOT_MAPPED/);
    f.pause();
    await assert.rejects(operator.admitWithinCredits(owner, f.input), /PAUSED/);
    assert.throws(() => createAsistenteOperatorComposition({ ...f.config, sourcePaths: ["server/kong.ts"] } as any, f.deps));
    assert.equal(f.calls(), 0);
    assert.equal((await f.ledger.status()).reservedMicroUsd, 0);
});
test("an existing Office reservation blocks factory admission before queue mutation", async () => {
    const f = await fixture();
    await f.ledger.reserve({ key: "office", consumer: "office", maximumMicroUsd: 990000, requestSha256: "d".repeat(64) });
    await assert.rejects(createAsistenteOperatorComposition(f.config, f.deps).admitWithinCredits(owner, f.input));
    assert.equal(f.calls(), 0);
});
test("concurrent identical admissions enqueue at most once across separate operator instances", async () => {
    const f = await fixture();
    const a = createAsistenteOperatorComposition(f.config, f.deps), b = createAsistenteOperatorComposition(f.config, f.deps);
    const results = await Promise.allSettled([a.admitWithinCredits(owner, f.input), b.admitWithinCredits(owner, f.input)]);
    assert.equal(f.calls(), 1);
    assert.ok(results.some(r => r.status === "fulfilled"));
    assert.equal((await f.ledger.status()).reservedMicroUsd, 0);
});

test("operator rejects incompatible review limits, missing regression tests and unrelated workflow profiles",async()=>{
 const f=await fixture();
 for(const config of [{...f.config,maxOutputTokens:4097},{...f.config,sourcePaths:["server/office-role-work.ts"]},{...f.config,ui:{...f.config.ui,workflowId:2}},{...f.config,ui:{...f.config.ui,workflowSha256:"d".repeat(64)}}])assert.throws(()=>createAsistenteOperatorComposition(config as AsistenteOperatorConfig,f.deps));
 assert.equal(f.calls(),0);
});

test("old settled admission missing from bounded history fails closed instead of recreating work",async()=>{
 const f=await fixture(),operator=createAsistenteOperatorComposition(f.config,f.deps);
 await operator.admitWithinCredits(owner,f.input);f.jobs.length=0;
 await assert.rejects(operator.admitWithinCredits(owner,f.input),/RECEIPT_UNAVAILABLE/);assert.equal(f.calls(),1);
});

test("lost zero-cost settlement acknowledgment cannot overwrite a settled admission or duplicate enqueue",async()=>{
 const f=await fixture(),original=f.ledger.settle;
 f.deps.credits.ledger={...f.ledger,settle:async input=>{await original(input);throw Error("SETTLEMENT_ACK_LOST");}};
 const operator=createAsistenteOperatorComposition(f.config,f.deps);
 await assert.rejects(operator.admitWithinCredits(owner,f.input),/UNCONFIRMED/);
 const status=await f.ledger.status();assert.equal(status.reservedMicroUsd,0);assert.equal(status.uncertain,false);
 assert.equal((await operator.admitWithinCredits(owner,f.input)).id,"job");assert.equal(f.calls(),1);
});

test("operator mapping validator accepts only independently verified known scenarios",async()=>{const f=await fixture();const config=structuredClone(f.config);config.orders[0].scenarioId="office-role-work-reader-deadline-v1";assert.equal(validateAsistenteOperatorConfig(config).orders[0].scenarioId,"office-role-work-reader-deadline-v1");assert.throws(()=>validateAsistenteOperatorConfig({...config,orders:[{...config.orders[0],scenarioId:"arbitrary-pass"}]}));});
