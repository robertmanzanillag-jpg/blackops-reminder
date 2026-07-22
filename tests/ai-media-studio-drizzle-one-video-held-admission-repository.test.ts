import assert from "node:assert/strict";
import test from "node:test";
import {
  DailyAdmissionPersistenceError,
  type ReserveAndAdmitRequest,
  type ReserveAndAdmitResult,
  type UnsignedReserveAndAdmitRequest,
} from "../server/ai-media-studio/planning/drizzle-daily-admission-repository";
import { DrizzleOneVideoHeldAdmissionRepository } from "../server/ai-media-studio/planning/drizzle-one-video-held-admission-repository";
import {
  OneVideoHeldAdmissionError,
  type OneVideoHeldAdmissionPersistenceRequest,
} from "../server/ai-media-studio/planning/one-video-held-admission-contracts";

const digest = (digit: string): `sha256:${string}` => `sha256:${digit.repeat(64)}`;
const ids = {
  plan: "11111111-1111-4111-8111-111111111111",
  slot: "22222222-2222-4222-8222-222222222222",
  bucket: "33333333-3333-4333-8333-333333333333",
  snapshot: "44444444-4444-4444-8444-444444444444",
  reservation: "55555555-5555-4555-8555-555555555555",
  render: "66666666-6666-4666-8666-666666666666",
  outbox: "77777777-7777-4777-8777-777777777777",
};
const input: OneVideoHeldAdmissionPersistenceRequest = {
  scope: { ownerUserId: "owner-a", workspaceId: "personal" },
  planId: ids.plan,
  dailyPlanSlotId: ids.slot,
  budgetBucketId: ids.bucket,
  authoritySnapshotId: ids.snapshot,
  authorityDigest: digest("a"),
  expectedSlotStateVersion: 7,
  expectedBucketStateVersion: 11,
  reservationExpiresAt: "2026-07-22T12:10:00.000Z",
  idempotencyKey: "held-admission-0001",
};
const expectedUnsigned: UnsignedReserveAndAdmitRequest = {
  scope: input.scope,
  planId: input.planId,
  slotId: input.dailyPlanSlotId,
  budgetBucketId: input.budgetBucketId,
  authoritySnapshotId: input.authoritySnapshotId,
  authorityDigest: input.authorityDigest,
  expectedSlotStateVersion: input.expectedSlotStateVersion,
  expectedBucketStateVersion: input.expectedBucketStateVersion,
  reservationExpiresAt: input.reservationExpiresAt,
  idempotencyKey: input.idempotencyKey,
};
const signedDigest = digest("b");

function dailyResult(replayed = false): ReserveAndAdmitResult {
  return {
    reservation: {
      id: ids.reservation,
      state: "reserved",
      submissionState: "not_started",
      slotId: ids.slot,
      bucketId: ids.bucket,
      amountMicroUsd: "1250000",
      attempt: 1,
      idempotencyKey: input.idempotencyKey,
      inputDigest: signedDigest,
      admissionDigest: digest("c"),
      renderJobId: ids.render,
      dispatchOutboxId: ids.outbox,
      workHandoffDigest: digest("d"),
      reservedAt: "2026-07-22T12:00:00.000Z",
      expiresAt: input.reservationExpiresAt,
    },
    databaseNow: "2026-07-22T12:00:00.000Z",
    budgetDate: "2026-07-22",
    accountingTimeZone: "America/New_York",
    replayed,
    effects: replayed
      ? { renderJobCreated: false, outboxCreated: false, eventCreated: false, providerCalled: false }
      : { renderJobCreated: true, outboxCreated: true, eventCreated: false, providerCalled: false },
  };
}

function fakeRepository(result: ReserveAndAdmitResult) {
  const calls: { unsigned?: UnsignedReserveAndAdmitRequest; signed?: ReserveAndAdmitRequest } = {};
  return {
    calls,
    repository: {
      inputDigest(unsigned: UnsignedReserveAndAdmitRequest) {
        calls.unsigned = unsigned;
        return signedDigest;
      },
      async reserveAndAdmit(signed: ReserveAndAdmitRequest) {
        calls.signed = signed;
        return result;
      },
    },
  };
}

test("held adapter derives the exact unsigned request, repository digest and signed admission", async () => {
  const fake = fakeRepository(dailyResult());
  const result = await new DrizzleOneVideoHeldAdmissionRepository(fake.repository).reserveHeld(input);

  assert.deepEqual(fake.calls.unsigned, expectedUnsigned);
  assert.equal(Object.isFrozen(fake.calls.unsigned), true);
  assert.equal(Object.isFrozen(fake.calls.unsigned?.scope), true);
  assert.deepEqual(fake.calls.signed, { ...expectedUnsigned, inputDigest: signedDigest });
  assert.equal(Object.isFrozen(fake.calls.signed), true);
  assert.deepEqual(result, {
    reservationId: ids.reservation,
    amountMicroUsd: "1250000",
    expiresAt: input.reservationExpiresAt,
    state: "held",
    replayed: false,
    effects: {
      internalBudgetReserved: true,
      heldRenderCreated: true,
      heldOutboxCreated: true,
      externalSpendCommitted: false,
      providerCalled: false,
    },
  });
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.effects), true);
});

test("exact replay returns held evidence with every per-call internal effect false", async () => {
  const result = await new DrizzleOneVideoHeldAdmissionRepository(fakeRepository(dailyResult(true)).repository)
    .reserveHeld(input);
  assert.equal(result.state, "held");
  assert.equal(result.replayed, true);
  assert.deepEqual(result.effects, {
    internalBudgetReserved: false,
    heldRenderCreated: false,
    heldOutboxCreated: false,
    externalSpendCommitted: false,
    providerCalled: false,
  });
});

test("adapter fails closed on inconsistent reservation identity, lifecycle, amount or digest", async () => {
  const base = dailyResult();
  const corrupt: ReserveAndAdmitResult[] = [
    { ...base, reservation: { ...base.reservation, state: "committed" } },
    { ...base, reservation: { ...base.reservation, submissionState: "dispatching" } },
    { ...base, reservation: { ...base.reservation, slotId: "88888888-8888-4888-8888-888888888888" } },
    { ...base, reservation: { ...base.reservation, bucketId: "88888888-8888-4888-8888-888888888888" } },
    { ...base, reservation: { ...base.reservation, expiresAt: "2026-07-22T12:11:00.000Z" } },
    { ...base, reservation: { ...base.reservation, idempotencyKey: "held-admission-other" } },
    { ...base, reservation: { ...base.reservation, inputDigest: digest("e") } },
    { ...base, reservation: { ...base.reservation, amountMicroUsd: "0" } },
    { ...base, reservation: { ...base.reservation, amountMicroUsd: "9000000000000001" } },
    { ...base, reservation: { ...base.reservation, attempt: 0 } },
    { ...base, reservation: { ...base.reservation, renderJobId: "not-a-uuid" } },
    { ...base, reservation: { ...base.reservation, workHandoffDigest: "bad" as `sha256:${string}` } },
  ];
  for (const result of corrupt) {
    await assert.rejects(
      new DrizzleOneVideoHeldAdmissionRepository(fakeRepository(result).repository).reserveHeld(input),
      unavailable,
    );
  }
});

test("adapter rejects provider/event effects and mismatched create/replay held effects", async () => {
  const created = dailyResult();
  const replayed = dailyResult(true);
  const corrupt = [
    { ...created, effects: { ...created.effects, providerCalled: true as false } },
    { ...created, effects: { ...created.effects, eventCreated: true as false } },
    { ...created, effects: { ...created.effects, renderJobCreated: false } },
    { ...created, effects: { ...created.effects, outboxCreated: false } },
    { ...replayed, effects: { ...replayed.effects, renderJobCreated: true } },
    { ...replayed, effects: { ...replayed.effects, outboxCreated: true } },
  ] as ReserveAndAdmitResult[];
  for (const result of corrupt) {
    await assert.rejects(
      new DrizzleOneVideoHeldAdmissionRepository(fakeRepository(result).repository).reserveHeld(input),
      unavailable,
    );
  }
});

test("daily persistence errors map to generic held-admission codes without leaking internals", async () => {
  const mappings = [
    ["ADMISSION_DENIED", "ADMISSION_DENIED"],
    ["IDEMPOTENCY_CONFLICT", "STALE_OR_CONFLICT"],
    ["INVALID_INPUT", "INVALID_REQUEST"],
    ["INVARIANT_VIOLATION", "UNAVAILABLE"],
  ] as const;
  for (const [source, expected] of mappings) {
    const repository = {
      inputDigest() { return signedDigest; },
      async reserveAndAdmit() {
        throw new DailyAdmissionPersistenceError(source, `private database detail for ${source}`);
      },
    };
    await assert.rejects(
      new DrizzleOneVideoHeldAdmissionRepository(repository).reserveHeld(input),
      (error: unknown) => error instanceof OneVideoHeldAdmissionError
        && error.code === expected
        && !error.message.includes("private database detail"),
    );
  }
});

test("digest failures and unknown repository failures remain generic unavailable errors", async () => {
  for (const repository of [
    { inputDigest() { throw new Error("private digest failure"); }, async reserveAndAdmit() { return dailyResult(); } },
    { inputDigest() { return signedDigest; }, async reserveAndAdmit() { throw new Error("private db failure"); } },
  ]) {
    await assert.rejects(
      new DrizzleOneVideoHeldAdmissionRepository(repository).reserveHeld(input),
      unavailable,
    );
  }

  const malformedDigestResult = dailyResult();
  malformedDigestResult.reservation.inputDigest = "not-a-digest" as `sha256:${string}`;
  await assert.rejects(
    new DrizzleOneVideoHeldAdmissionRepository({
      inputDigest() { return "not-a-digest" as `sha256:${string}`; },
      async reserveAndAdmit() { return malformedDigestResult; },
    }).reserveHeld(input),
    unavailable,
  );

  await assert.rejects(
    new DrizzleOneVideoHeldAdmissionRepository(fakeRepository(dailyResult()).repository)
      .reserveHeld(undefined as never),
    unavailable,
  );
});

function unavailable(error: unknown): boolean {
  return error instanceof OneVideoHeldAdmissionError
    && error.code === "UNAVAILABLE"
    && error.message === "One-video held admission request could not be completed";
}
