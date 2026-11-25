import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { companyOrderRetryAttempt, isInfrastructureStop, isProviderCreditStop, FACTORY_ORDER_MAX_RETRIES } from "../server/software-factory-order-retry";
import { countAutoAdmissionsToday } from "../server/software-factory-asistente-operator";
import { companyOrderJob, companyOrderRootKey } from "../server/software-factory-company";
import { observeFactoryForSelfHeal } from "../server/office-self-heal-factory";
import { recordSelfHealFactory, selfHealTestRecordId, parseSelfHealState } from "../server/office-self-heal";
import { emptyCompanyState } from "../shared/agent-company";

const owner = "owner-fixture", ownerKey = createHash("sha256").update(owner).digest("hex");
const rev = "a".repeat(64), orderId = "ord-1", SH = "ord-sh-" + "c".repeat(20);
let n = 0;
const root = (retry = 0, status = "completed", result: any = {}) => ({ id: `root-${++n}`, ownerKey, kind: "discover", status, key: companyOrderRootKey("asistente", orderId, rev, retry),
  createdAt: "2026-11-25T04:00:00Z", completedAt: "2026-11-25T04:01:00Z", payload: { companyOrder: { version: 1, company: "main", orderId, revision: rev, ...(retry ? { retry } : {}) } }, result }) as any;
const build = (r: any, status: string, reason?: string, costCents = 0) => ({ id: `build-${++n}`, ownerKey, kind: "build", status, key: `${r.id}.next`, createdAt: "2026-11-25T04:46:00Z", completedAt: "2026-11-25T04:46:30Z",
  payload: { previousJobId: r.id }, result: { status, ...(reason ? { reason } : {}), costCents, evidence: { pipelineState: { rootJobId: r.id } } } }) as any;

test("zero-cost provider block becomes eligible for a bounded retry", () => {
  const r0 = root();
  assert.equal(companyOrderRetryAttempt([r0, build(r0, "failed", "FACTORY_REMOTE_BUILD_FAILED:PROVIDER_BLOCKED")], ownerKey, orderId, rev), 1);
  const r1 = root(1);
  assert.equal(companyOrderRetryAttempt([r0, r1, build(r0, "failed", "FACTORY_REMOTE_BUILD_FAILED:PROVIDER_BLOCKED"), build(r1, "failed", "FACTORY_REMOTE_BUILD_FAILED:PROVIDER_ADMISSION_UNAVAILABLE:FACTORY_API_RECONCILIATION_REQUIRED")], ownerKey, orderId, rev), 2);
  const r2 = root(2);
  assert.equal(companyOrderRetryAttempt([r0, r1, r2, build(r2, "failed", "FACTORY_REMOTE_BUILD_FAILED:PROVIDER_BLOCKED")], ownerKey, orderId, rev), FACTORY_ORDER_MAX_RETRIES);
});

test("spend, code failures, running chains and unknown history are never retried", () => {
  const r0 = root();
  assert.equal(companyOrderRetryAttempt([r0, build(r0, "failed", "FACTORY_REMOTE_BUILD_FAILED:PROVIDER_BLOCKED", 3)], ownerKey, orderId, rev), 0);
  assert.equal(companyOrderRetryAttempt([r0, build(r0, "failed", "FACTORY_REMOTE_BUILD_FAILED:PATCH")], ownerKey, orderId, rev), 0);
  assert.equal(companyOrderRetryAttempt([r0, build(r0, "running")], ownerKey, orderId, rev), 0);
  assert.equal(companyOrderRetryAttempt([r0, build(r0, "completed")], ownerKey, orderId, rev), 0);
  const spent = root(0, "completed", { costCents: 5 });
  assert.equal(companyOrderRetryAttempt([spent, build(spent, "failed", "FACTORY_REMOTE_BUILD_FAILED:PROVIDER_BLOCKED")], ownerKey, orderId, rev), 0);
  const b = build(r0, "completed"), review = { ...build(r0, "blocked", "PROVIDER_BLOCKED"), key: `${b.id}.next`, payload: { previousJobId: b.id } };
  assert.equal(companyOrderRetryAttempt([r0, b, review], ownerKey, orderId, rev), 0);
  assert.equal(companyOrderRetryAttempt([], ownerKey, orderId, rev), 0);
  const blocked = root(0, "blocked", { status: "blocked", reason: "SELF_HEAL_SOURCE_TOO_LARGE", costCents: 0 });
  assert.equal(companyOrderRetryAttempt([blocked], ownerKey, orderId, rev), 0);
  assert.equal(companyOrderRetryAttempt([{ ...r0, ownerKey: "x" }, build(r0, "failed", "PROVIDER_BLOCKED")], ownerKey, orderId, rev), 0);
});

test("auto-selection NOT_COMPLETED is infrastructure only before the #542 selector", () => {
  const before = root(0, "blocked", { status: "blocked", reason: "FACTORY_AUTO_SELECTION_NOT_COMPLETED", costCents: 0 });
  assert.equal(isInfrastructureStop(before), true);
  assert.equal(isInfrastructureStop({ ...before, completedAt: "2026-11-25T05:00:00Z" }), false);
  assert.equal(isInfrastructureStop(root(0, "blocked", { status: "blocked", reason: "FACTORY_API_RECONCILIATION_REQUIRED", costCents: 0 })), true);
});

test("retry key and payload are distinct per attempt and bounded", () => {
  const order = { id: orderId, text: "Arregla la oficina", createdAt: "2026-11-24T00:00:00Z", assignees: [{ agentId: "code", status: "pendiente" }] } as any;
  const project = { id: "asistente", repo: "robertmanzanillag-jpg/blackops-reminder" } as any;
  const base = companyOrderJob(order, project, 5), retry = companyOrderJob(order, project, 5, 1);
  assert.notEqual(base.key, retry.key); assert.equal(retry.key, `${base.key}:retry:1`);
  assert.equal((retry.payload!.companyOrder as any).retry, 1); assert.equal((base.payload!.companyOrder as any).retry, undefined);
  assert.throws(() => companyOrderJob(order, project, 5, 3), /RETRY_INVALID/);
});

test("self-heal observes only the newest retry root and waits instead of burning an attempt", () => {
  const t = Date.parse("2026-11-25T06:00:00Z");
  const r0 = { ...root(), payload: { companyOrder: { version: 1, company: "main", orderId: SH, revision: rev } } };
  const r1 = { ...root(1), payload: { companyOrder: { version: 1, company: "main", orderId: SH, revision: rev, retry: 1 } } };
  const obs = observeFactoryForSelfHeal({ owner, jobs: [r0, build(r0, "failed", "FACTORY_REMOTE_BUILD_FAILED:PROVIDER_BLOCKED"), r1, build(r1, "running")], proposals: [], proposalStatus: "complete", now: t });
  assert.equal(obs.length, 1); assert.equal(obs[0].rootJobId, r1.id); assert.equal(obs[0].state, "running");

  // An ORDERED entry whose build failed PROVIDER_BLOCKED advances to needs_owner (not retry_pending).
  const state = { version: 1, ownerKey: parseSelfHealState(undefined, owner).ownerKey, notes: [], entries: [{ id: "e".repeat(24), key: "f".repeat(64), episode: 1, role: "release-gate", code: "KNOWN_TEST_FAILURE", recordId: selfHealTestRecordId("tests/x.test.ts"), severity: 3, testPath: "tests/x.test.ts",
    detectedAt: "2026-11-25T03:00:00Z", baseline: { jobId: "j", artifactId: "a".repeat(64), completedAt: "2026-11-25T03:00:00Z", findings: [] }, status: "ordered", readyToMerge: false,
    attempts: [{ n: 1, orderId: SH, orderRevision: rev, createdAt: "2026-11-25T03:00:00Z" }], updatedAt: "2026-11-25T03:00:00Z" }] };
  const parsed: any = state;
  const failedObs = observeFactoryForSelfHeal({ owner, jobs: [r0, build(r0, "failed", "FACTORY_REMOTE_BUILD_FAILED:PROVIDER_BLOCKED")], proposals: [], proposalStatus: "complete", now: t });
  const out = recordSelfHealFactory({ state: parsed, company: emptyCompanyState(), observations: failedObs, journal: { jobs: [] }, owner, now: t });
  assert.equal(out.state.entries[0].status, "needs_owner");
  const later = recordSelfHealFactory({ state: out.state, company: emptyCompanyState(), observations: obs, journal: { jobs: [] }, owner, now: t + 1000 });
  assert.equal(later.state.entries[0].status, "in_factory");
});

test("zero-cost infrastructure stops do not consume autoAdmit.maxPerDay", async () => {
  const { countAutoAdmissionsToday } = await import("../server/software-factory-asistente-operator");
  const at = new Date("2026-11-25T08:00:00Z"), notMapped = () => false;
  const infra = root(), infraBuild = build(infra, "failed", "FACTORY_REMOTE_BUILD_FAILED:PROVIDER_BLOCKED");
  const spent = root(), spentBuild = build(spent, "failed", "FACTORY_REMOTE_BUILD_FAILED:PATCH", 12);
  const code = root(), codeBuild = build(code, "blocked", "FACTORY_PERMANENT_REGRESSION_TEST_REQUIRED");
  const running = root(0, "running");
  assert.equal(countAutoAdmissionsToday([infra, infraBuild], at, ownerKey, notMapped), 0);
  assert.equal(countAutoAdmissionsToday([infra, infraBuild, spent, spentBuild, code, codeBuild, running], at, ownerKey, notMapped), 3);
});

test("$0 provider credit/quota rejections retry only while a provider with credit is available", () => {
  const quota = "FACTORY_REMOTE_BUILD_FAILED:PROVIDER_REQUEST_REJECTED:FACTORY_OPENAI_REQUEST_REJECTED:429:credit_balance_exhausted";
  const reasons = [quota, "FACTORY_REMOTE_BUILD_FAILED:PROVIDER_REQUEST_REJECTED:FACTORY_OPENAI_REQUEST_REJECTED:429:insufficient_quota",
    "FACTORY_ANTHROPIC_REQUEST_REJECTED:402:billing_error", "FACTORY_ANTHROPIC_REQUEST_REJECTED:429:enforced_spend_limit_reached",
    "FACTORY_ANTHROPIC_CREDIT_EXHAUSTED", "FACTORY_REMOTE_BUILD_FAILED:FACTORY_ALL_PROVIDERS_CREDIT_EXHAUSTED"];
  for (const reason of reasons) {
    const r0 = root(), chain = [r0, build(r0, "failed", reason)];
    assert.equal(companyOrderRetryAttempt(chain, ownerKey, orderId, rev), 0, reason);
    assert.equal(companyOrderRetryAttempt(chain, ownerKey, orderId, rev, { creditAvailable: false }), 0, reason);
    assert.equal(companyOrderRetryAttempt(chain, ownerKey, orderId, rev, { creditAvailable: true }), 1, reason);
  }
  // A plain rate limit, a non-zero cost or another code is never a credit stop.
  for (const [reason, cost] of [["FACTORY_REMOTE_BUILD_FAILED:PROVIDER_REQUEST_REJECTED:FACTORY_OPENAI_REQUEST_REJECTED:429:rate_limit_exceeded", 0], [quota, 2], ["FACTORY_OPENAI_REQUEST_REJECTED:400:insufficient_quota", 0]] as const) {
    const r0 = root();
    assert.equal(companyOrderRetryAttempt([r0, build(r0, "failed", reason, cost)], ownerKey, orderId, rev, { creditAvailable: true }), 0, reason);
  }
  // Still bounded at FACTORY_ORDER_MAX_RETRIES.
  const r0 = root(), r1 = root(1), r2 = root(2);
  assert.equal(companyOrderRetryAttempt([r0, r1, r2, build(r0, "failed", quota), build(r1, "failed", quota), build(r2, "failed", quota)], ownerKey, orderId, rev, { creditAvailable: true }), FACTORY_ORDER_MAX_RETRIES);
  assert.equal(isProviderCreditStop(build(r0, "failed", quota)), true);
});

test("$0 credit rejections do not consume the autoAdmit daily count", () => {
  const now = new Date("2026-11-25T12:20:00Z"), r0 = { ...root(), createdAt: "2026-11-25T12:00:00Z" };
  const jobs = [r0, build(r0, "failed", "FACTORY_REMOTE_BUILD_FAILED:PROVIDER_REQUEST_REJECTED:FACTORY_OPENAI_REQUEST_REJECTED:429:credit_balance_exhausted")];
  assert.equal(countAutoAdmissionsToday(jobs, now, ownerKey, () => false), 0);
  const paid = [r0, build(r0, "failed", "FACTORY_REMOTE_BUILD_FAILED:PATCH")];
  assert.equal(countAutoAdmissionsToday(paid, now, ownerKey, () => false), 1);
});
