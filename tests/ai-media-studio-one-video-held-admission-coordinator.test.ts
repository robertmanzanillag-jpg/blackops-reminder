import assert from "node:assert/strict";
import test from "node:test";
import { OneVideoHeldAdmissionCoordinator } from "../server/ai-media-studio/planning/one-video-held-admission-coordinator";
import {
  ONE_VIDEO_HELD_ADMISSION_OPERATION,
  OneVideoHeldAdmissionError,
  type OneVideoHeldAdmissionCommand,
  type OneVideoHeldAdmissionContext,
  type OneVideoHeldAdmissionExistingAttempt,
  type OneVideoHeldAdmissionPersistenceResult,
  type OneVideoHeldAdmissionPublicCas,
  type TrustedOneVideoHeldAdmissionPrincipal,
} from "../server/ai-media-studio/planning/one-video-held-admission-contracts";

const key = (prefix: string, digit: string) => `${prefix}_${digit.repeat(24)}`;
const uuid = (digit: string) => `${digit.repeat(8)}-${digit.repeat(4)}-4${digit.repeat(3)}-8${digit.repeat(3)}-${digit.repeat(12)}`;
const scope = Object.freeze({ ownerUserId: "owner-a", workspaceId: "personal" });
const cas: OneVideoHeldAdmissionPublicCas = Object.freeze({
  publicPlanKey: key("plan", "1"), publicSlotKey: key("slot", "2"),
  expectedBatchId: key("batch", "3"), expectedQuoteKey: key("quote", "4"),
  expectedRenderSpecKey: key("render_spec", "5"), expectedSlotAttempt: 1,
  idempotencyKey: "held-admission-0001",
});
const context: OneVideoHeldAdmissionContext = Object.freeze({
  scope, planId: uuid("1"), dailyPlanSlotId: uuid("2"), budgetBucketId: uuid("3"),
  publicPlanKey: cas.publicPlanKey, publicBatchKey: cas.expectedBatchId, publicSlotKey: cas.publicSlotKey,
  publicQuoteKey: cas.expectedQuoteKey, publicRenderSpecKey: cas.expectedRenderSpecKey,
  slotAttempt: 1, expectedSlotStateVersion: 4, expectedBucketStateVersion: 7,
  maximumQuoteMicroUsd: "1250000", currency: "USD",
  quoteExpiresAt: "2026-07-22T12:30:00.000Z", reservationExpiresAt: "2026-07-22T12:10:00.000Z",
});
const snapshot = Object.freeze({ authoritySnapshotId: uuid("4"), authorityDigest: `sha256:${"a".repeat(64)}` as const,
  admissionDigest: `sha256:${"b".repeat(64)}` as const, dailyPlanSlotId: context.dailyPlanSlotId, slotAttempt: 1 });
const createdResult: OneVideoHeldAdmissionPersistenceResult = Object.freeze({
  reservationId: uuid("5"), amountMicroUsd: context.maximumQuoteMicroUsd,
  expiresAt: context.reservationExpiresAt, state: "held", replayed: false,
  effects: Object.freeze({ internalBudgetReserved: true, heldRenderCreated: true, heldOutboxCreated: true,
    externalSpendCommitted: false, providerCalled: false }),
});
const replayAttempt: OneVideoHeldAdmissionExistingAttempt = Object.freeze({
  ownerUserId: scope.ownerUserId, workspaceId: "personal",
  observedAt: "2026-07-22T12:00:00.000Z",
  publicPlanKey: cas.publicPlanKey, publicBatchKey: cas.expectedBatchId,
  publicSlotKey: cas.publicSlotKey, publicQuoteKey: cas.expectedQuoteKey,
  publicRenderSpecKey: cas.expectedRenderSpecKey, slotAttempt: cas.expectedSlotAttempt,
  idempotencyKey: cas.idempotencyKey, reservationId: createdResult.reservationId,
  maximumQuoteMicroUsd: createdResult.amountMicroUsd, currency: "USD",
  expiresAt: createdResult.expiresAt, state: "held",
});

function command(changes: Partial<OneVideoHeldAdmissionCommand> = {}): OneVideoHeldAdmissionCommand {
  return { scope, ...cas, authorizationContext: Object.freeze({ request: true }), ...changes };
}

function coordinator(overrides: Record<string, unknown> = {}) {
  const sealed = Object.freeze({});
  const principal = Object.freeze({ operation: ONE_VIDEO_HELD_ADMISSION_OPERATION, subjectId: scope.ownerUserId,
    scope, cas }) as TrustedOneVideoHeldAdmissionPrincipal;
  return new OneVideoHeldAdmissionCoordinator({
    authorizer: { async authorize() { return { heldAdmissionAuthenticationContext: sealed }; } },
    authenticator: { async authenticate() { return principal; } },
    replayRepository: { async observeExisting() { return undefined; }, async loadExactReplay() { return undefined; } },
    contextLoader: { async load() { return context; } },
    snapshotRepository: { async loadCurrent() { return snapshot; } },
    admissionRepository: { async reserveHeld() { return createdResult; } },
    ...overrides,
  });
}

test("coordinator authenticates the sealed exact CAS before loading server context and persists internal facts only", async () => {
  const order: string[] = [];
  const persistence: unknown[] = [];
  const sealed = Object.freeze({ sealed: true });
  const result = await coordinator({
    authorizer: { async authorize(input: Record<string, unknown>) {
      order.push("authorize"); assert.deepEqual(input.cas, cas);
      return { heldAdmissionAuthenticationContext: sealed };
    } },
    authenticator: { async authenticate(input: Record<string, unknown>) {
      order.push("authenticate"); assert.equal(input.context, sealed);
      return Object.freeze({ operation: ONE_VIDEO_HELD_ADMISSION_OPERATION, subjectId: scope.ownerUserId,
        scope, cas }) as TrustedOneVideoHeldAdmissionPrincipal;
    } },
    replayRepository: { async observeExisting() { return undefined; }, async loadExactReplay() {
      order.push("replay"); return undefined;
    } },
    contextLoader: { async load() { order.push("context"); return context; } },
    snapshotRepository: { async loadCurrent(input: Record<string, unknown>) {
      order.push("snapshot"); assert.equal(input.context, context); return snapshot;
    } },
    admissionRepository: { async reserveHeld(input: unknown) {
      order.push("reserve"); persistence.push(input); return createdResult;
    } },
  }).admit(command());

  assert.deepEqual(order, ["authorize", "authenticate", "replay", "context", "snapshot", "reserve"]);
  assert.deepEqual(persistence, [{ scope, planId: context.planId, dailyPlanSlotId: context.dailyPlanSlotId,
    budgetBucketId: context.budgetBucketId, authoritySnapshotId: snapshot.authoritySnapshotId,
    authorityDigest: snapshot.authorityDigest, expectedSlotStateVersion: 4, expectedBucketStateVersion: 7,
    reservationExpiresAt: context.reservationExpiresAt, idempotencyKey: cas.idempotencyKey }]);
  assert.equal(result.outcome, "admitted");
  assert.equal(result.admission.state, "held");
  assert.match(result.admission.reservationKey, /^reservation_[a-f0-9]{24}$/u);
  assert.deepEqual(Object.values(result.effects.external), Array(10).fill(false));
  assert.equal(result.canGenerate, false); assert.equal(result.spendAuthorized, false);
  const serialized = JSON.stringify(result);
  for (const secret of [context.planId, context.dailyPlanSlotId, context.budgetBucketId,
    snapshot.authoritySnapshotId, snapshot.authorityDigest, createdResult.reservationId]) {
    assert.equal(serialized.includes(secret), false);
  }
});

test("authorization or sealed-principal denial stops before any tenant lookup", async () => {
  let loads = 0;
  await assert.rejects(coordinator({
    authorizer: { async authorize() { return undefined; } },
    contextLoader: { async load() { loads += 1; return context; } },
  }).admit(command()), (error: unknown) => error instanceof OneVideoHeldAdmissionError && error.code === "FORBIDDEN");
  await assert.rejects(coordinator({
    authenticator: { async authenticate() { return undefined; } },
    contextLoader: { async load() { loads += 1; return context; } },
  }).admit(command()), (error: unknown) => error instanceof OneVideoHeldAdmissionError && error.code === "FORBIDDEN");
  assert.equal(loads, 0);
});

test("all public CAS components and the personal tenant are rebound to server-owned context", async () => {
  const cases: Partial<OneVideoHeldAdmissionContext>[] = [
    { publicPlanKey: key("plan", "9") }, { publicSlotKey: key("slot", "9") },
    { publicBatchKey: key("batch", "9") }, { publicQuoteKey: key("quote", "9") },
    { publicRenderSpecKey: key("render_spec", "9") }, { slotAttempt: 2 },
    { scope: { ownerUserId: "other", workspaceId: "personal" } }, { currency: "EUR" as "USD" },
    { maximumQuoteMicroUsd: "0" }, { reservationExpiresAt: "2026-07-22T12:31:00.000Z" },
  ];
  for (const changed of cases) {
    await assert.rejects(coordinator({ contextLoader: { async load() { return { ...context, ...changed }; } } }).admit(command()),
      (error: unknown) => error instanceof OneVideoHeldAdmissionError && error.code === "STALE_OR_CONFLICT");
  }
  await assert.rejects(coordinator().admit(command({ scope: { ...scope, workspaceId: "team" } })),
    (error: unknown) => error instanceof OneVideoHeldAdmissionError && error.code === "INVALID_REQUEST");
});

test("missing or mismatched authority and inconsistent persistence fail closed with generic errors", async () => {
  await assert.rejects(coordinator({ snapshotRepository: { async loadCurrent() { return undefined; } } }).admit(command()),
    (error: unknown) => error instanceof OneVideoHeldAdmissionError && error.code === "ADMISSION_DENIED");
  await assert.rejects(coordinator({ snapshotRepository: { async loadCurrent() {
    return { ...snapshot, dailyPlanSlotId: uuid("9") };
  } } }).admit(command()),
  (error: unknown) => error instanceof OneVideoHeldAdmissionError && error.code === "STALE_OR_CONFLICT");
  await assert.rejects(coordinator({ admissionRepository: { async reserveHeld() {
    return { ...createdResult, effects: { ...createdResult.effects, providerCalled: true } };
  } } }).admit(command()),
  (error: unknown) => error instanceof OneVideoHeldAdmissionError && error.code === "UNAVAILABLE");
  await assert.rejects(coordinator({ contextLoader: { async load() { throw new Error("private db detail"); } } }).admit(command()),
    (error: unknown) => error instanceof OneVideoHeldAdmissionError
      && error.code === "UNAVAILABLE" && !error.message.includes("private"));
});

test("exact replay reports no newly-created internal effects and remains externally inert", async () => {
  const replay = { ...createdResult, replayed: true, effects: { ...createdResult.effects,
    internalBudgetReserved: false, heldRenderCreated: false, heldOutboxCreated: false } };
  const result = await coordinator({ admissionRepository: { async reserveHeld() { return replay; } } }).admit(command());
  assert.equal(result.outcome, "replayed");
  assert.deepEqual(Object.values(result.effects.internal), [false, false, false]);
  assert.deepEqual(Object.values(result.effects.external), Array(10).fill(false));
});

test("durable exact replay skips planned context, snapshot and reserve and returns the original receipt", async () => {
  const calls: string[] = [];
  const result = await coordinator({
    replayRepository: { async observeExisting() { return undefined; }, async loadExactReplay(receivedScope: unknown, receivedCas: unknown) {
      calls.push("replay"); assert.deepEqual(receivedScope, scope); assert.deepEqual(receivedCas, cas); return replayAttempt;
    } },
    contextLoader: { async load() { calls.push("context"); return undefined; } },
    snapshotRepository: { async loadCurrent() { calls.push("snapshot"); return snapshot; } },
    admissionRepository: { async reserveHeld() { calls.push("reserve"); return createdResult; } },
  }).admit(command());
  assert.deepEqual(calls, ["replay"]);
  assert.equal(result.outcome, "replayed");
  assert.equal(result.admission.reservationKey, "reservation_be794183424ac82db2b146a5");
  assert.deepEqual(Object.values(result.effects.internal), [false, false, false]);
  assert.deepEqual(Object.values(result.effects.external), Array(10).fill(false));
});

test("a malicious replay dependency cannot substitute another CAS, identity, amount or expired tuple", async () => {
  const cases: OneVideoHeldAdmissionExistingAttempt[] = [
    { ...replayAttempt, publicPlanKey: key("plan", "9") },
    { ...replayAttempt, publicBatchKey: key("batch", "9") },
    { ...replayAttempt, publicQuoteKey: key("quote", "9") },
    { ...replayAttempt, publicRenderSpecKey: key("render_spec", "9") },
    { ...replayAttempt, slotAttempt: 2 },
    { ...replayAttempt, idempotencyKey: "held-admission-other" },
    { ...replayAttempt, ownerUserId: "other-owner" },
    { ...replayAttempt, workspaceId: "team" as "personal" },
    { ...replayAttempt, maximumQuoteMicroUsd: "0" },
    { ...replayAttempt, expiresAt: replayAttempt.observedAt },
    { ...replayAttempt, state: "blocked" },
  ];
  for (const candidate of cases) {
    await assert.rejects(coordinator({ replayRepository: {
      async observeExisting() { return undefined; }, async loadExactReplay() { return candidate; },
    } }).admit(command()), (error: unknown) => error instanceof OneVideoHeldAdmissionError
      && ["STALE_OR_CONFLICT", "UNAVAILABLE"].includes(error.code));
  }
});

test("missing planned context after authenticated replay lookup is a generic conflict, never a not-found oracle", async () => {
  await assert.rejects(coordinator({ contextLoader: { async load() { return undefined; } } }).admit(command()),
    (error: unknown) => error instanceof OneVideoHeldAdmissionError && error.code === "STALE_OR_CONFLICT");
});
