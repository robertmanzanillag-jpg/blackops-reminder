import assert from "node:assert/strict";
import test from "node:test";
import {
  OneVideoHeldAdmissionReadinessService,
  type OneVideoHeldAdmissionReadinessGates,
  type OneVideoHeldAdmissionReadinessObservation,
} from "../server/ai-media-studio/planning/one-video-held-admission-readiness-service";
import {
  OneVideoHeldAdmissionError,
  type OneVideoHeldAdmissionContext,
} from "../server/ai-media-studio/planning/one-video-held-admission-contracts";

const key = (prefix: string, digit: string) => `${prefix}_${digit.repeat(24)}`;
const uuid = (digit: string) => `${digit.repeat(8)}-${digit.repeat(4)}-4${digit.repeat(3)}-8${digit.repeat(3)}-${digit.repeat(12)}`;
const digest = (digit: string): `sha256:${string}` => `sha256:${digit.repeat(64)}`;
const scope = { ownerUserId: "owner-a", workspaceId: "personal" } as const;
const context: OneVideoHeldAdmissionContext = {
  scope,
  planId: uuid("1"), dailyPlanSlotId: uuid("2"), budgetBucketId: uuid("3"),
  publicPlanKey: key("plan", "1"), publicBatchKey: key("batch", "2"),
  publicSlotKey: key("slot", "3"), publicQuoteKey: key("quote", "4"),
  publicRenderSpecKey: key("render_spec", "5"), slotAttempt: 1,
  expectedSlotStateVersion: 4, expectedBucketStateVersion: 7,
  maximumQuoteMicroUsd: "1250000", currency: "USD",
  quoteExpiresAt: "2026-07-22T12:30:00.000Z",
  reservationExpiresAt: "2026-07-22T12:10:00.000Z",
};
const readyGates: OneVideoHeldAdmissionReadinessGates = {
  batch: "ready", slot: "ready", launchIntent: "ready", contentApproval: "ready",
  sandboxProof: "ready", policy: "ready", killSwitch: "ready", governance: "ready",
  credential: "ready", source: "ready", providerVerification: "ready", maximumQuote: "ready",
  humanApproval: "ready", budget: "ready", concurrency: "ready",
};
const snapshot = {
  authoritySnapshotId: uuid("4"), authorityDigest: digest("a"), admissionDigest: digest("b"),
  dailyPlanSlotId: context.dailyPlanSlotId, slotAttempt: 1,
};

function observation(overrides: Partial<OneVideoHeldAdmissionReadinessObservation> = {}): OneVideoHeldAdmissionReadinessObservation {
  return {
    observedAt: "2026-07-22T12:00:00.000Z",
    gates: readyGates,
    reservations: [],
    ...overrides,
  };
}

function service(input: {
  observed?: OneVideoHeldAdmissionReadinessObservation;
  currentContext?: OneVideoHeldAdmissionContext | undefined;
  currentSnapshot?: typeof snapshot | undefined;
} = {}) {
  let snapshots = 0;
  const instance = new OneVideoHeldAdmissionReadinessService({
    contextLoader: { async load() {
      return Object.hasOwn(input, "currentContext") ? input.currentContext : context;
    } },
    snapshotRepository: { async loadCurrent() {
      snapshots += 1;
      return Object.hasOwn(input, "currentSnapshot") ? input.currentSnapshot : snapshot;
    } },
    observationRepository: { async observe() { return input.observed ?? observation(); } },
  });
  return { instance, snapshots: () => snapshots };
}

test("all read-only gates plus one exact current snapshot produce advisory POST availability", async () => {
  const readiness = await service().instance.observe(scope, context.publicPlanKey, context.publicSlotKey);
  assert.ok(readiness);
  assert.equal(readiness.state, "available");
  assert.equal(readiness.postAvailable, true);
  assert.deepEqual(readiness.cas, {
    expectedBatchId: context.publicBatchKey,
    expectedQuoteKey: context.publicQuoteKey,
    expectedRenderSpecKey: context.publicRenderSpecKey,
    expectedSlotAttempt: 1,
  });
  assert.equal(readiness.canGenerate, false);
  assert.equal(readiness.spendAuthorized, false);
  assert.equal(Object.values(readiness.effects).some(Boolean), false);
});

test("every non-ready gate maps to a stable blocker and unknown observations fail closed", async () => {
  const cases = [
    ["batch", "missing", "batch_not_approved"], ["batch", "stale", "batch_changed"],
    ["slot", "missing", "slot_not_approved"], ["slot", "stale", "slot_attempt_changed"],
    ["launchIntent", "missing", "launch_intent_missing"], ["launchIntent", "stale", "launch_intent_stale"],
    ["contentApproval", "missing", "content_approval_missing"], ["contentApproval", "stale", "content_approval_stale"],
    ["sandboxProof", "missing", "sandbox_proof_missing"], ["sandboxProof", "stale", "sandbox_proof_stale"],
    ["policy", "blocked", "policy_inactive"], ["policy", "stale", "policy_stale"],
    ["killSwitch", "blocked", "kill_switch_active"], ["governance", "stale", "governance_stale"],
    ["credential", "stale", "credential_stale"], ["source", "stale", "source_stale"],
    ["providerVerification", "missing", "provider_verification_missing"],
    ["providerVerification", "stale", "provider_verification_stale"],
    ["maximumQuote", "missing", "maximum_quote_missing"], ["maximumQuote", "stale", "maximum_quote_stale"],
    ["humanApproval", "missing", "human_approval_missing"], ["humanApproval", "stale", "human_approval_stale"],
    ["budget", "blocked", "budget_unavailable"], ["concurrency", "blocked", "concurrency_unavailable"],
    ["budget", "unknown", "observation_unavailable"],
  ] as const;
  for (const [name, state, reason] of cases) {
    const observed = observation({ gates: { ...readyGates, [name]: state } });
    const readiness = await service({ observed }).instance.observe(scope, context.publicPlanKey, context.publicSlotKey);
    assert.equal(readiness?.state, "blocked", name);
    assert.deepEqual(readiness?.reasonCodes, [reason], name);
    assert.equal(readiness?.postAvailable, false);
    assert.equal(readiness?.cas, undefined);
  }
});

test("missing or mismatched authority snapshot blocks without manufacturing authority", async () => {
  const missing = await service({ currentSnapshot: undefined }).instance
    .observe(scope, context.publicPlanKey, context.publicSlotKey);
  assert.deepEqual(missing?.reasonCodes, ["authority_snapshot_missing"]);

  const stale = await service({ currentSnapshot: { ...snapshot, slotAttempt: 2 } }).instance
    .observe(scope, context.publicPlanKey, context.publicSlotKey);
  assert.deepEqual(stale?.reasonCodes, ["authority_snapshot_stale"]);
});

test("existing reserved work projects a redacted held receipt and bypasses no execution gate", async () => {
  const reservationId = uuid("5");
  const harness = service({ observed: observation({ reservations: [{
    reservationId, dailyPlanSlotId: context.dailyPlanSlotId, budgetBucketId: context.budgetBucketId,
    slotAttempt: 1, amountMicroUsd: "1250000", currency: "USD", state: "reserved",
    submissionState: "not_started", expiresAt: "2026-07-22T12:10:00.000Z",
  }] }) });
  const readiness = await harness.instance.observe(scope, context.publicPlanKey, context.publicSlotKey);
  assert.equal(readiness?.state, "held");
  assert.match(readiness?.currentReservation?.reservationKey ?? "", /^reservation_[a-f0-9]{24}$/u);
  assert.equal(JSON.stringify(readiness).includes(reservationId), false);
  assert.equal(readiness?.postAvailable, false);
  assert.equal(readiness?.canGenerate || readiness?.spendAuthorized, false);
  assert.equal(harness.snapshots(), 0);
});

test("expired reserved work is visible as expired; committed or ambiguous attempts stay blocked", async () => {
  const baseReservation = {
    reservationId: uuid("5"), dailyPlanSlotId: context.dailyPlanSlotId,
    budgetBucketId: context.budgetBucketId, slotAttempt: 1, amountMicroUsd: "1250000",
    currency: "USD" as const, state: "reserved" as const, submissionState: "not_started" as const,
    expiresAt: "2026-07-22T11:59:59.000Z",
  };
  const expired = await service({ observed: observation({ reservations: [baseReservation] }) }).instance
    .observe(scope, context.publicPlanKey, context.publicSlotKey);
  assert.equal(expired?.state, "expired");

  const committed = await service({ observed: observation({ reservations: [{
    ...baseReservation, state: "committed", expiresAt: "2026-07-22T12:10:00.000Z",
  }] }) }).instance.observe(scope, context.publicPlanKey, context.publicSlotKey);
  assert.deepEqual(committed?.reasonCodes, ["existing_attempt"]);

  const ambiguous = await service({ observed: observation({ reservations: [baseReservation, {
    ...baseReservation, reservationId: uuid("6"),
  }] }) }).instance.observe(scope, context.publicPlanKey, context.publicSlotKey);
  assert.deepEqual(ambiguous?.reasonCodes, ["existing_attempt", "observation_unavailable"]);
});

test("missing subject remains absent while malformed observation/context fails generically closed", async () => {
  assert.equal(await service({ currentContext: undefined }).instance
    .observe(scope, context.publicPlanKey, context.publicSlotKey), undefined);
  await assert.rejects(service({ observed: observation({ observedAt: "not-an-instant" }) }).instance
    .observe(scope, context.publicPlanKey, context.publicSlotKey), unavailable);
  await assert.rejects(service({ currentContext: { ...context, maximumQuoteMicroUsd: "0" } }).instance
    .observe(scope, context.publicPlanKey, context.publicSlotKey), unavailable);
  await assert.rejects(service().instance.observe(scope, "native-plan", context.publicSlotKey),
    (error: unknown) => error instanceof OneVideoHeldAdmissionError && error.code === "INVALID_REQUEST");
});

function unavailable(error: unknown): boolean {
  return error instanceof OneVideoHeldAdmissionError && error.code === "UNAVAILABLE";
}
