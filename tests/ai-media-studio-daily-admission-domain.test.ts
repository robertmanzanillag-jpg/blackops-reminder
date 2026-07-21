import assert from "node:assert/strict";
import test from "node:test";
import {
  DailyAdmissionDomainError,
  blockDailyPlan,
  blockDailyPlanSlot,
  commitDailyPlanReservation,
  confirmDailyPlan,
  createDailyAdmissionIntent,
  createDailyPlanPreview,
  dailyAdmissionApprovalSubjectDigest,
  expireDailyPlanReservation,
  microUsd,
  releaseDailyPlanReservation,
  replanDailyPlanSlot,
  reserveDailyPlanSlot,
  type BudgetBucket,
  type DailyAdmissionEvidence,
  type DailyPlanSlot,
  type Sha256Digest,
} from "../server/ai-media-studio/planning";

const scope = { ownerUserId: "owner-1", workspaceId: "workspace-1" } as const;
const now = "2026-07-21T12:00:00.000Z";
const digest = (character: string) => `sha256:${character.repeat(64)}` as Sha256Digest;

function plannedSlot(): DailyPlanSlot {
  const preview = createDailyPlanPreview({
    scope,
    planDate: "2026-07-21",
    timeZone: "America/New_York",
    rosterDigest: digest("a"),
    slots: [{ influencerId: "influencer-1", videoNumber: 1 }],
    now,
  });
  return confirmDailyPlan(preview.plan, preview.slots, preview.plan.previewDigest, now).slots[0]!;
}

function evidence(overrides: Partial<DailyAdmissionEvidence> = {}): DailyAdmissionEvidence {
  return {
    providerKey: "video-provider",
    providerAccountId: "account-1",
    credentialVersion: 3,
    accountStatus: "active_verified",
    scriptDigest: digest("b"),
    governanceStatus: "approved",
    governanceEvidenceDigest: digest("c"),
    sandboxStatus: "passed",
    sandboxEvidenceDigest: digest("d"),
    policyAllowed: true,
    policyDigest: digest("e"),
    killSwitchActive: false,
    maximumQuoteMicroUsd: 1_250_000n,
    quoteExpiresAt: "2026-07-21T12:30:00.000Z",
    ...overrides,
  };
}

function intent(slot: DailyPlanSlot, admissionEvidence = evidence()) {
  const approvedSubjectDigest = dailyAdmissionApprovalSubjectDigest(slot, admissionEvidence);
  return createDailyAdmissionIntent(slot, admissionEvidence, {
    approvedSubjectDigest,
    evidenceDigest: digest("f"),
    approvedAt: "2026-07-21T11:59:00.000Z",
    expiresAt: "2026-07-21T12:20:00.000Z",
  });
}

function bucket(overrides: Partial<BudgetBucket> = {}): BudgetBucket {
  return {
    id: "budget-2026-07-21",
    scope,
    planDate: "2026-07-21",
    timeZone: "America/New_York",
    limitMicroUsd: 10_000_000n,
    reservedMicroUsd: 0n,
    committedMicroUsd: 0n,
    version: 1,
    updatedAt: now,
    ...overrides,
  };
}

function assertCode(code: DailyAdmissionDomainError["code"]) {
  return (error: unknown) => error instanceof DailyAdmissionDomainError && error.code === code;
}

test("daily preview IDs and digests are deterministic and confirmation is digest-bound", () => {
  const input = {
    scope,
    planDate: "2026-07-21",
    timeZone: "America/New_York",
    rosterDigest: digest("a"),
    slots: [
      { influencerId: "influencer-2", videoNumber: 2 },
      { influencerId: "influencer-1", videoNumber: 1 },
    ],
    now,
  } as const;
  const first = createDailyPlanPreview(input);
  const second = createDailyPlanPreview({ ...input, slots: [...input.slots].reverse() });
  assert.equal(first.plan.id, second.plan.id);
  assert.match(first.plan.id, /^plan_[a-f0-9]{24}$/u);
  assert.equal(first.slots.every(({ id }) => /^slot_[a-f0-9]{24}$/u.test(id)), true);
  assert.equal(first.plan.previewDigest, second.plan.previewDigest);
  assert.deepEqual(first.slots.map(({ id }) => id), second.slots.map(({ id }) => id));
  assert.equal(first.plan.state, "preview");
  assert.equal(first.slots.every(({ state }) => state === "preview"), true);

  const confirmed = confirmDailyPlan(first.plan, first.slots, first.plan.previewDigest, "2026-07-21T12:01:00.000Z");
  assert.equal(confirmed.plan.state, "planned");
  assert.equal(confirmed.slots.every(({ state }) => state === "planned"), true);
  assert.equal(confirmDailyPlan(confirmed.plan, confirmed.slots, first.plan.previewDigest, now).idempotent, true);
  assert.throws(() => confirmDailyPlan(first.plan, first.slots, digest("9"), now), assertCode("IDEMPOTENCY_CONFLICT"));
  const blocked = blockDailyPlan(first.plan, "human_approval_invalid", digest("8"), now);
  assert.equal(blocked.plan.state, "blocked");
  assert.equal(blockDailyPlan(blocked.plan, "human_approval_invalid", digest("8"), now).idempotent, true);
  assert.throws(() => blockDailyPlan(blocked.plan, "budget_exhausted", digest("7"), now), assertCode("IDEMPOTENCY_CONFLICT"));
});

test("micro-USD accepts only exact non-negative signed 64-bit integers", () => {
  assert.equal(microUsd("1250000"), 1_250_000n);
  assert.equal(microUsd(0n), 0n);
  assert.throws(() => microUsd("1.25"), assertCode("INVALID_INPUT"));
  assert.throws(() => microUsd("01"), assertCode("INVALID_INPUT"));
  assert.throws(() => microUsd(-1n), assertCode("INVALID_INPUT"));
  assert.throws(() => microUsd(9_000_000_000_000_001n), assertCode("INVALID_INPUT"));
  assert.throws(() => microUsd(1 as never), assertCode("INVALID_INPUT"));
});

test("human approval is bound to the exact slot, attempt, provider binding, evidence, and maximum quote", () => {
  const slot = plannedSlot();
  const originalEvidence = evidence();
  const approvalSubject = dailyAdmissionApprovalSubjectDigest(slot, originalEvidence);
  assert.throws(() => createDailyAdmissionIntent(slot, evidence({ credentialVersion: 4 }), {
    approvedSubjectDigest: approvalSubject,
    evidenceDigest: digest("f"),
    approvedAt: "2026-07-21T11:59:00.000Z",
    expiresAt: "2026-07-21T12:20:00.000Z",
  }), assertCode("HUMAN_APPROVAL_INVALID"));
  assert.throws(() => createDailyAdmissionIntent(slot, evidence({ maximumQuoteMicroUsd: 1_250_001n }), {
    approvedSubjectDigest: approvalSubject,
    evidenceDigest: digest("f"),
    approvedAt: "2026-07-21T11:59:00.000Z",
    expiresAt: "2026-07-21T12:20:00.000Z",
  }), assertCode("HUMAN_APPROVAL_INVALID"));
});

test("reservation atomically models the slot and locked budget bucket without creating work", () => {
  const slot = plannedSlot();
  const admission = intent(slot);
  const admitted = reserveDailyPlanSlot({
    slot,
    bucket: bucket(),
    intent: admission,
    reservationExpiresAt: "2026-07-21T12:10:00.000Z",
    now,
  });
  assert.equal(admitted.slot.state, "reserved");
  assert.equal(admitted.reservation.state, "reserved");
  assert.equal(admitted.reservation.amountMicroUsd, 1_250_000n);
  assert.equal(admitted.bucket.reservedMicroUsd, 1_250_000n);
  assert.equal(admitted.bucket.committedMicroUsd, 0n);
  assert.equal(admitted.idempotent, false);
  assert.deepEqual(Object.keys(admitted).sort(), ["bucket", "idempotent", "reservation", "slot"]);

  const replay = reserveDailyPlanSlot({
    slot: admitted.slot,
    bucket: admitted.bucket,
    intent: admission,
    reservationExpiresAt: "2026-07-21T12:10:00.000Z",
    now,
    existingReservation: admitted.reservation,
  });
  assert.equal(replay.idempotent, true);
  assert.deepEqual(replay, { ...admitted, idempotent: true });
});

test("same slot attempt rejects changed admission and missing authoritative replay state", () => {
  const slot = plannedSlot();
  const firstIntent = intent(slot);
  const admitted = reserveDailyPlanSlot({
    slot,
    bucket: bucket(),
    intent: firstIntent,
    reservationExpiresAt: "2026-07-21T12:10:00.000Z",
    now,
  });
  assert.throws(() => reserveDailyPlanSlot({
    slot: admitted.slot,
    bucket: admitted.bucket,
    intent: firstIntent,
    reservationExpiresAt: "2026-07-21T12:10:00.000Z",
    now,
  }), assertCode("INVARIANT_VIOLATION"));
  assert.throws(() => reserveDailyPlanSlot({
    slot: admitted.slot,
    bucket: admitted.bucket,
    intent: firstIntent,
    reservationExpiresAt: "2026-07-21T12:11:00.000Z",
    now,
    existingReservation: admitted.reservation,
  }), assertCode("IDEMPOTENCY_CONFLICT"));
  assert.throws(() => reserveDailyPlanSlot({
    slot: admitted.slot,
    bucket: admitted.bucket,
    intent: { ...firstIntent, approval: { ...firstIntent.approval, approvedSubjectDigest: digest("0") } },
    reservationExpiresAt: admitted.reservation.expiresAt,
    now,
    existingReservation: admitted.reservation,
  }), assertCode("IDEMPOTENCY_CONFLICT"));

  const changedEvidence = evidence({ maximumQuoteMicroUsd: 1_300_000n });
  const changedIntent = intent({ ...slot }, changedEvidence);
  assert.throws(() => reserveDailyPlanSlot({
    slot: admitted.slot,
    bucket: admitted.bucket,
    intent: changedIntent,
    reservationExpiresAt: "2026-07-21T12:10:00.000Z",
    now,
    existingReservation: admitted.reservation,
  }), assertCode("IDEMPOTENCY_CONFLICT"));
});

test("admission fails closed for every mutable external gate and budget exhaustion", () => {
  const cases: Array<[Partial<DailyAdmissionEvidence>, DailyAdmissionDomainError["code"]]> = [
    [{ killSwitchActive: true }, "KILL_SWITCH_ACTIVE"],
    [{ accountStatus: "unverified" }, "ACCOUNT_NOT_READY"],
    [{ governanceStatus: "revoked" }, "GOVERNANCE_NOT_APPROVED"],
    [{ sandboxStatus: "expired" }, "SANDBOX_NOT_PASSED"],
    [{ policyAllowed: false }, "POLICY_NOT_ALLOWED"],
    [{ quoteExpiresAt: now }, "QUOTE_EXPIRED"],
  ];
  for (const [override, code] of cases) {
    const slot = plannedSlot();
    assert.throws(() => reserveDailyPlanSlot({
      slot,
      bucket: bucket(),
      intent: intent(slot, evidence(override)),
      reservationExpiresAt: "2026-07-21T12:10:00.000Z",
      now,
    }), assertCode(code));
  }
  const slot = plannedSlot();
  assert.throws(() => reserveDailyPlanSlot({
    slot,
    bucket: bucket({ limitMicroUsd: 1_249_999n }),
    intent: intent(slot),
    reservationExpiresAt: "2026-07-21T12:10:00.000Z",
    now,
  }), assertCode("BUDGET_EXHAUSTED"));
});

test("commit moves reserved funds to committed and committed funds cannot auto-refund", () => {
  const slot = plannedSlot();
  const admitted = reserveDailyPlanSlot({
    slot,
    bucket: bucket(),
    intent: intent(slot),
    reservationExpiresAt: "2026-07-21T12:10:00.000Z",
    now,
  });
  const committed = commitDailyPlanReservation(admitted.slot, admitted.bucket, admitted.reservation, "2026-07-21T12:05:00.000Z");
  assert.equal(committed.slot.state, "committed");
  assert.equal(committed.bucket.reservedMicroUsd, 0n);
  assert.equal(committed.bucket.committedMicroUsd, 1_250_000n);
  assert.equal(commitDailyPlanReservation(committed.slot, committed.bucket, committed.reservation, now).idempotent, true);
  assert.throws(() => releaseDailyPlanReservation(committed.slot, committed.bucket, committed.reservation, now), assertCode("INVALID_TRANSITION"));
  assert.throws(() => expireDailyPlanReservation(committed.slot, committed.bucket, committed.reservation, "2026-07-21T12:30:00.000Z"), assertCode("INVALID_TRANSITION"));
});

test("release and expiry return only active reserved funds and force a new attempt", () => {
  const reserve = () => {
    const slot = plannedSlot();
    return reserveDailyPlanSlot({
      slot,
      bucket: bucket(),
      intent: intent(slot),
      reservationExpiresAt: "2026-07-21T12:10:00.000Z",
      now,
    });
  };
  const released = releaseDailyPlanReservation(...(() => {
    const value = reserve();
    return [value.slot, value.bucket, value.reservation, "2026-07-21T12:06:00.000Z"] as const;
  })());
  assert.equal(released.bucket.reservedMicroUsd, 0n);
  assert.equal(released.reservation.state, "released");
  assert.equal(replanDailyPlanSlot(released.slot, "2026-07-21T12:07:00.000Z").attempt, 2);

  const expiring = reserve();
  assert.throws(() => expireDailyPlanReservation(expiring.slot, expiring.bucket, expiring.reservation, "2026-07-21T12:09:59.999Z"), assertCode("INVALID_TRANSITION"));
  const expired = expireDailyPlanReservation(expiring.slot, expiring.bucket, expiring.reservation, "2026-07-21T12:10:00.000Z");
  assert.equal(expired.slot.state, "expired");
  assert.equal(expired.bucket.reservedMicroUsd, 0n);
  assert.equal(replanDailyPlanSlot(expired.slot, "2026-07-21T12:11:00.000Z").attempt, 2);
});

test("blocking is evidence-bound and cannot bypass an active reservation or committed spend", () => {
  const slot = plannedSlot();
  const blocked = blockDailyPlanSlot(slot, "governance_not_approved", digest("8"), now);
  assert.equal(blocked.slot.state, "blocked");
  assert.equal(blockDailyPlanSlot(blocked.slot, "governance_not_approved", digest("8"), now).idempotent, true);
  assert.throws(() => blockDailyPlanSlot(blocked.slot, "sandbox_not_passed", digest("7"), now), assertCode("IDEMPOTENCY_CONFLICT"));
  const replanned = replanDailyPlanSlot(blocked.slot, "2026-07-21T12:01:00.000Z");
  assert.equal(replanned.attempt, 2);
  assert.equal(replanned.reservationId, undefined);
  assert.equal(replanned.blockedCode, undefined);

  const admission = reserveDailyPlanSlot({
    slot,
    bucket: bucket(),
    intent: intent(slot),
    reservationExpiresAt: "2026-07-21T12:10:00.000Z",
    now,
  });
  assert.throws(() => blockDailyPlanSlot(admission.slot, "kill_switch_active", digest("6"), now), assertCode("INVALID_TRANSITION"));
});

test("cross-tenant, cross-day, malformed timezone, and overdrawn bucket inputs are rejected", () => {
  const slot = plannedSlot();
  const admission = intent(slot);
  assert.throws(() => reserveDailyPlanSlot({
    slot,
    bucket: bucket({ scope: { ownerUserId: "other", workspaceId: "workspace-1" } }),
    intent: admission,
    reservationExpiresAt: "2026-07-21T12:10:00.000Z",
    now,
  }), assertCode("INVARIANT_VIOLATION"));
  assert.throws(() => reserveDailyPlanSlot({
    slot,
    bucket: bucket({ planDate: "2026-07-22" }),
    intent: admission,
    reservationExpiresAt: "2026-07-21T12:10:00.000Z",
    now,
  }), assertCode("INVARIANT_VIOLATION"));
  assert.throws(() => createDailyPlanPreview({
    scope, planDate: "2026-02-30", timeZone: "Fake/Zone", rosterDigest: digest("a"),
    slots: [{ influencerId: "influencer-1", videoNumber: 1 }], now,
  }), assertCode("INVALID_INPUT"));
  assert.throws(() => createDailyPlanPreview({
    scope, planDate: "9999-99-99", timeZone: "UTC", rosterDigest: digest("a"),
    slots: [{ influencerId: "influencer-1", videoNumber: 1 }], now,
  }), assertCode("INVALID_INPUT"));
  assert.throws(() => reserveDailyPlanSlot({
    slot,
    bucket: bucket({ limitMicroUsd: 1_000_000n, reservedMicroUsd: 900_000n, committedMicroUsd: 200_000n }),
    intent: admission,
    reservationExpiresAt: "2026-07-21T12:10:00.000Z",
    now,
  }), assertCode("INVARIANT_VIOLATION"));
});
