import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createAsistenteOperatorComposition, validateAsistenteOperatorConfig, type AsistenteOperatorConfig } from "../server/software-factory-asistente-operator";
import { createSharedOpenAiCreditLedger, type SharedCreditState, type CreditTransaction } from "../server/shared-openai-credit-ledger";
import { companyOrderJob } from "../server/software-factory-company";
import { validateFactoryWorkerOptions } from "../server/software-factory-runtime";
import type { CompanyOrder } from "../shared/agent-company";
const owner = "owner", ownerKey = createHash("sha256").update(owner).digest("hex"), at = new Date("2026-11-07T00:00:00Z");
const project: any = { id: "asistente", repo: "robertmanzanillag-jpg/blackops-reminder", testCommand: "npm test", buildCommand: "npm run build", automaticRelease: false, providerSupportsRelease: false, providerSupportsRollback: false, journeys: ["office-session-login", "office-company-navigation"] };
const order: CompanyOrder = { id: "approved", text: "Improve role work checks", createdAt: at.toISOString(), assignees: [{ agentId: "code", status: "en_curso", note: "" }] };
async function fixture() {
    let state: SharedCreditState = { version: 1, grant: null, lastObservedAt: null, reservations: [] }, tail: Promise<unknown> = Promise.resolve();
    const transact: CreditTransaction = async (fn) => { const p = tail.then(() => { const copy = structuredClone(state), r = fn(copy); state = copy; return r; }); tail = p.catch(() => { }); return p; };
    const ledger = createSharedOpenAiCreditLedger({ transact, now: () => at, maximumGrantObservationAgeMs: 60000, grant: { id: "grant", accountScope: "same-account", availableMicroUsd: 1000000, observedAt: at.toISOString(), expiresAt: "2026-11-20T00:00:00Z", verificationEvidenceId: "verified" } });
    await ledger.initialize();
    const input = companyOrderJob(order, project, 1), revision = (input.payload!.companyOrder as any).revision;
    const config: AsistenteOperatorConfig = { owner, projectId: "asistente", baseBranch: "main", checks: { trigger: "push", workflowId: 1, workflowPath: ".github/workflows/factory-candidate-checks.yml", workflowSha256: "a".repeat(64), jobName: "isolated", testStep: "tests", buildStep: "build", browserStep: "browser" }, archiveHosts: ["fixture.blob.core.windows.net"], reservations: { discover: 1, build: 2, simulate: 1, review: 2 }, maxInputTokens: 1000, maxOutputTokens: 100, orders: [{ id: order.id, revision, baseSha: "b".repeat(40), kind: "improvement", scenarioId: "office-role-work-owner-cas-v1", paths: ["server/office-role-work.ts", "tests/office-role-work.test.ts"] }], ui: { workflowId: 1, workflowSha256: "a".repeat(64), harnessSha256: "c".repeat(64) } };
    let paused = false, lost = false, calls = 0;
    const jobs: any[] = [];
    const store: any = { status: async () => ({ configured: true, paused, limitCents: 10000, fixedCents: 0, spentCents: 0, reservedCents: 0 }), projectByOwnerKey: async (key: string) => { assert.equal(key, ownerKey); return project; }, list: async () => jobs, enqueue: async (o: string, i: any) => { assert.equal(o, owner); calls++; assert.equal((await ledger.status()).reservedMicroUsd, 40000); const job = { ...i, id: "job", ownerKey, status: "pending" }; jobs.push(job); if (lost)
            throw Error("LOST_ACK"); return job; } };
    const deps = { store, credits: { ledger, pricing: { model: "gpt-6-astra", inputNanoUsdPerToken: 1, outputNanoUsdPerToken: 1, validUntil: "2026-11-20T00:00:00Z" } }, readOrders: async () => [order], githubRequest: async () => { throw Error("NO_GITHUB_CALL_EXPECTED"); }, modelRequest: async () => { throw Error("NO_PAID_CALL_EXPECTED"); }, download: fetch, readUi: async () => { throw Error("NO_FAKE_SIMULATION"); }, now: () => at };
    return { config, deps, ledger, input, jobs, store, calls: () => calls, pause: () => { paused = true; }, lose: () => { lost = true; } };
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
    assert.throws(() => createAsistenteOperatorComposition({ ...f.config, orders: [{ ...f.config.orders[0], paths: ["server/kong.ts", "tests/kong.test.ts"] }] }, f.deps));
    assert.throws(() => createAsistenteOperatorComposition({ ...f.config, sourcePaths: ["server/office-role-work.ts"] } as any, f.deps));
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

test("operator permits bounded build output while preserving review ceiling and rejects invalid profiles",async()=>{
 const f=await fixture();
 const increased={...f.config,maxOutputTokens:8192};
 assert.equal(validateAsistenteOperatorConfig(increased).maxOutputTokens,8192);
 assert.doesNotThrow(()=>createAsistenteOperatorComposition(increased,f.deps));
 for(const config of [{...f.config,maxOutputTokens:8193},{...f.config,maxFilesPerOrder:9},{...f.config,ui:{...f.config.ui,workflowId:2}},{...f.config,ui:{...f.config.ui,workflowSha256:"d".repeat(64)}}])assert.throws(()=>createAsistenteOperatorComposition(config as AsistenteOperatorConfig,f.deps));
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

test("artifact shard opt-in defaults off and rejects nonboolean configuration",async()=>{const f=await fixture();assert.equal(validateAsistenteOperatorConfig(f.config).allowGitHubResultsAzureHosts,false);assert.equal(validateAsistenteOperatorConfig({...f.config,allowGitHubResultsAzureHosts:true}).allowGitHubResultsAzureHosts,true);assert.throws(()=>validateAsistenteOperatorConfig({...f.config,allowGitHubResultsAzureHosts:"true"}));});

const testPath = "tests/office-role-work.test.ts";
const withPaths = (config: AsistenteOperatorConfig, paths: string[], extra: Partial<AsistenteOperatorConfig> = {}) => ({ ...config, ...extra, orders: [{ ...config.orders[0], paths }] });

test("write roots: defaults and allowlisted subfolders are accepted", async () => {
 const f = await fixture(), parsed = validateAsistenteOperatorConfig(f.config);
 assert.deepEqual(parsed.writeRoots, ["server/", "client/", "shared/", "tests/"]);
 assert.equal(parsed.maxFilesPerOrder, 6); assert.equal(parsed.maxDraftPullRequestsPerDay, 5);
 const narrowed = withPaths(f.config, ["server/office/role.ts", "client/src/pages/office.tsx", "shared/agent-company.ts", testPath], { writeRoots: ["server/office/", "client/src/", "shared/", "tests/"] });
 assert.deepEqual(validateAsistenteOperatorConfig(narrowed).orders[0].paths.length, 4);
 assert.doesNotThrow(() => createAsistenteOperatorComposition(narrowed, f.deps));
 // A path outside the narrowed roots is rejected even if it is under a default root.
 assert.throws(() => validateAsistenteOperatorConfig(withPaths(f.config, ["server/other.ts", testPath], { writeRoots: ["server/office/", "tests/"] })));
 for (const roots of [[".github/"], ["script/"], ["server"], ["server/../"], ["/server/"], ["server/secrets/"], ["server/", "server/"], ["client/dist/"], []])
  assert.throws(() => validateAsistenteOperatorConfig({ ...f.config, writeRoots: roots }), undefined, JSON.stringify(roots));
 assert.equal(f.calls(), 0);
});

test("write denials are code-owned and rejected at configuration", async () => {
 const f = await fixture();
 const denied = [".github/workflows/x.yml", "server/.github/x.ts", ".claude/settings.json", ".agents/a.md", "credentials/x.ts", "server/secrets/x.ts", "server/migrations/001.ts", "drizzle/0001.sql", "server/node_modules/x.js", "client/dist/index.js",
  ".env", "server/.env.local", "server/key.pem", "server/id.key", "package.json", "client/package.json", "package-lock.json", "pnpm-lock.yaml", ".replit", "replit.nix", "drizzle.config.ts", "AGENTS.md", "CLAUDE.md", "server/AGENTS.md",
  "script/replit-deploy.ts", "server/../package.json", "../server/x.ts", "server/./x.ts", "/server/x.ts", "server\\x.ts", "server//x.ts", "server/x.ts ", "C:/server/x.ts", "server/software-factory-x.ts", "server/kong.ts", "docs/readme.md", "script/x.ts"];
 for (const path of denied) assert.throws(() => validateAsistenteOperatorConfig(withPaths(f.config, [path, testPath])), undefined, path);
 assert.equal(f.calls(), 0);
});

test("per-order paths are bounded by maxFilesPerOrder and require a regression test path", async () => {
 const f = await fixture(), files = (n: number) => [testPath, ...Array.from({ length: n - 1 }, (_, i) => `server/office-${i}.ts`)];
 assert.doesNotThrow(() => validateAsistenteOperatorConfig(withPaths(f.config, files(6))));
 assert.throws(() => validateAsistenteOperatorConfig(withPaths(f.config, files(7))));
 assert.doesNotThrow(() => validateAsistenteOperatorConfig(withPaths(f.config, files(8), { maxFilesPerOrder: 8 })));
 assert.throws(() => validateAsistenteOperatorConfig(withPaths(f.config, files(9), { maxFilesPerOrder: 8 })));
 assert.throws(() => validateAsistenteOperatorConfig(withPaths(f.config, files(3), { maxFilesPerOrder: 2 })));
 for (const bad of [{ maxFilesPerOrder: 0 }, { maxFilesPerOrder: 9 }, { maxDraftPullRequestsPerDay: 0 }, { maxDraftPullRequestsPerDay: 11 }]) assert.throws(() => validateAsistenteOperatorConfig({ ...f.config, ...bad }));
 assert.throws(() => validateAsistenteOperatorConfig(withPaths(f.config, ["server/office-role-work.ts"])), /TEST_PATH_REQUIRED/);
 assert.throws(() => validateAsistenteOperatorConfig(withPaths(f.config, [testPath, testPath])));
 assert.throws(() => validateAsistenteOperatorConfig(withPaths(f.config, [testPath, "TESTS/office-role-work.test.ts"])));
 assert.throws(() => validateAsistenteOperatorConfig(withPaths(f.config, [])));
 assert.throws(() => validateAsistenteOperatorConfig({ ...f.config, orders: [{ ...f.config.orders[0], paths: undefined }] }));
});

const prJob = (id: number, createdAt = at.toISOString(), extra: Record<string, unknown> = {}) => ({ id: `pr-${id}`, ownerKey, key: `k${id}`, projectId: "asistente", kind: "build", status: "completed", createdAt, completedAt: createdAt, reservedCents: 2, recoveryCents: 0, payload: {}, month: "2026-11",
 result: { status: "completed", costCents: 1, evidence: { pipelineState: { candidate: { prUrl: `https://github.com/robertmanzanillag-jpg/blackops-reminder/pull/${id}` } } } }, ...extra });

test("draft PR count is owner-wide per UTC day and fails closed on an unprovable window", async () => {
 const { countDraftPullRequestsToday } = await import("../server/software-factory-asistente-operator");
 const jobs: any[] = [prJob(1), prJob(2, "2026-11-06T23:59:59.000Z"), prJob(3, at.toISOString(), { kind: "review" }), prJob(4, at.toISOString(), { ownerKey: "f".repeat(64) }),
  prJob(5, at.toISOString(), { status: "unknown", result: {} }), prJob(6, at.toISOString(), { status: "failed", result: { status: "failed", costCents: 1, reconciled: true } }),
  prJob(7, at.toISOString(), { status: "failed", result: { status: "failed", costCents: 1 } })];
 assert.equal(countDraftPullRequestsToday(jobs, at, ownerKey), 3);
 assert.throws(() => countDraftPullRequestsToday(Array.from({ length: 100 }, (_, i) => prJob(100 + i, "2026-11-07T00:00:01.000Z", { kind: "simulate" })) as any, at, ownerKey), /UNVERIFIED/);
});

test("daily draft PR cap defers admission and the build stage before any provider credit", async () => {
 const f = await fixture();
 const config = { ...f.config, maxDraftPullRequestsPerDay: 5 };
 for (let i = 0; i < 5; i++) f.jobs.push(prJob(i));
 const worker = await createAsistenteOperatorComposition(config, f.deps).createFactoryWorkerOptions();
 // Admission: the order is left unadmitted (no credit hold, no queue write).
 await worker.scheduleCompanyOrders!(owner);
 assert.equal(f.calls(), 0); assert.equal((await f.ledger.status()).reservedMicroUsd, 0);
 // Build: the sixth PR in the same UTC day is deferred to the next UTC midnight at zero cost.
 const finding = { id: f.input.key, kind: "improvement", regressionScenarioId: "office-role-work-owner-cas-v1", baseSha: "b".repeat(40), request: "x", artifactIds: ["a"], sourcePaths: ["server/office-role-work.ts", testPath] };
 const discover = { id: "11111111-1111-4111-8111-111111111111", ownerKey, projectId: "asistente", kind: "discover", status: "completed", key: f.input.key, payload: {}, reservedCents: 1, recoveryCents: 0, month: "2026-11", createdAt: at.toISOString(),
  result: { status: "completed", costCents: 0, evidence: { pipelineState: { version: 1, projectId: "asistente", rootJobId: "11111111-1111-4111-8111-111111111111", target: "staging", finding, evidence: [], repairAttempts: 0 } } } };
 f.store.getCompletedJob = async () => discover;
 const job: any = { id: "22222222-2222-4222-8222-222222222222", ownerKey, projectId: "asistente", kind: "build", key: `${discover.id}.next`, payload: { previousJobId: discover.id, repairAttempts: 0 }, reservedCents: 2, recoveryCents: 0, month: "2026-11", status: "running", createdAt: at.toISOString() };
 const sixth = await worker.adapters!.build!.execute(job, { signal: new AbortController().signal, maxCostCents: 2 });
 assert.equal(sixth.status, "blocked"); assert.equal(sixth.costCents, 0); assert.equal(sixth.reason, "FACTORY_DAILY_DRAFT_PR_LIMIT");
 assert.equal(sixth.deferUntil, "2026-11-08T00:00:00.000Z");
 assert.equal((await f.ledger.status()).reservedMicroUsd, 0); assert.equal((await f.ledger.status()).spentMicroUsd, 0);
 // Four PRs today: the build proceeds past the cap (and stops at the synthetic GitHub boundary, still before any credit).
 f.jobs.pop();
 const fifth = await worker.adapters!.build!.execute(job, { signal: new AbortController().signal, maxCostCents: 2 });
 assert.notEqual(fifth.reason, "FACTORY_DAILY_DRAFT_PR_LIMIT"); assert.equal(fifth.deferUntil, undefined);
 assert.equal((await f.ledger.status()).reservedMicroUsd, 0);
});

test("discovery persists the mapped per-order selection into the job state", async () => {
 const f = await fixture(), base = "b".repeat(40);
 f.deps.githubRequest = async (url: string) => { assert.match(url, /\/git\/ref\/heads\/main$/); return Response.json({ ref: "refs/heads/main", object: { type: "commit", sha: base } }); };
 f.store.claimFinding = async () => true;
 const worker = await createAsistenteOperatorComposition(f.config, f.deps).createFactoryWorkerOptions();
 const job: any = { id: "33333333-3333-4333-8333-333333333333", ownerKey, projectId: "asistente", kind: "discover", key: f.input.key, payload: f.input.payload, reservedCents: 1, recoveryCents: 0, month: "2026-11", status: "running", createdAt: at.toISOString() };
 const found = await worker.adapters!.discover!.execute(job, { signal: new AbortController().signal, maxCostCents: 1 });
 assert.equal(found.status, "completed", JSON.stringify(found));
 assert.deepEqual((found.evidence as any).pipelineState.finding.sourcePaths, ["server/office-role-work.ts", testPath]);
 assert.equal(found.next?.kind, "build");
});
