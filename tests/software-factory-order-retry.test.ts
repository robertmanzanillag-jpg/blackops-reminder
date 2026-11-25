import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { companyOrderRetryAttempt, isInfrastructureStop, FACTORY_ORDER_MAX_RETRIES } from "../server/software-factory-order-retry";
import { companyOrderJob, companyOrderRootKey } from "../server/software-factory-company";
import { observeFactoryForSelfHeal } from "../server/office-self-heal-factory";
import { recordSelfHealFactory, planSelfHeal } from "../server/office-self-heal";
import { emptyCompanyState } from "../shared/agent-company";

const owner = "owner-fixture", ownerKey = createHash("sha256").update(owner).digest("hex");
const rev = "a".repeat(64), orderId = "ord-1";
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
  const r0 = { ...root(), payload: { companyOrder: { version: 1, company: "main", orderId: "ord-sh-x", revision: rev } } };
  const r1 = { ...root(1), payload: { companyOrder: { version: 1, company: "main", orderId: "ord-sh-x", revision: rev, retry: 1 } } };
  const obs = observeFactoryForSelfHeal({ owner, jobs: [r0, build(r0, "failed", "FACTORY_REMOTE_BUILD_FAILED:PROVIDER_BLOCKED"), r1, build(r1, "running")], proposals: [], proposalStatus: "complete", now: t });
  assert.equal(obs.length, 1); assert.equal(obs[0].rootJobId, r1.id); assert.equal(obs[0].state, "running");

  // An ORDERED entry whose build failed PROVIDER_BLOCKED advances to needs_owner (not retry_pending).
  const state = { version: 1, ownerKey, notes: [], entries: [{ id: "e".repeat(24), key: "k".repeat(64), episode: 1, role: "release-gate", code: "KNOWN_TEST_FAILURE", recordId: "1".repeat(16), severity: 3, testPath: "tests/x.test.ts",
    detectedAt: "2026-11-25T03:00:00Z", baseline: { jobId: "j", artifactId: "a".repeat(64), completedAt: "2026-11-25T03:00:00Z", findings: [] }, status: "ordered", readyToMerge: false,
    attempts: [{ n: 1, orderId: "ord-sh-x", orderRevision: rev, createdAt: "2026-11-25T03:00:00Z" }], updatedAt: "2026-11-25T03:00:00Z" }] };
  let parsed: any;
  try { parsed = planSelfHeal({ state, company: emptyCompanyState(), journal: { jobs: [] }, owner, now: t, maxPerDay: 1 }).state; } catch { parsed = state; }
  const failedObs = observeFactoryForSelfHeal({ owner, jobs: [r0, build(r0, "failed", "FACTORY_REMOTE_BUILD_FAILED:PROVIDER_BLOCKED")], proposals: [], proposalStatus: "complete", now: t });
  const out = recordSelfHealFactory({ state: parsed, company: emptyCompanyState(), observations: failedObs, journal: { jobs: [] }, owner, now: t });
  assert.equal(out.state.entries[0].status, "needs_owner");
  const later = recordSelfHealFactory({ state: out.state, company: emptyCompanyState(), observations: obs, journal: { jobs: [] }, owner, now: t + 1000 });
  assert.equal(later.state.entries[0].status, "in_factory");
});
