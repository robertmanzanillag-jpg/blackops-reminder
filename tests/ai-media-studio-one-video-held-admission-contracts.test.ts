import assert from "node:assert/strict";
import test from "node:test";
import {
  oneVideoHeldAdmissionPathSchema,
  oneVideoHeldAdmissionRequestSchema,
  oneVideoHeldAdmissionResponseSchema,
} from "../shared/ai-media-studio-one-video-held-admission";

const key = (prefix: string, digit: string): string => `${prefix}_${digit.repeat(24)}`;

const path = { planId: key("plan", "1"), slotId: key("slot", "2") };
const request = {
  expectedBatchId: key("batch", "3"),
  expectedQuoteKey: key("quote", "4"),
  expectedRenderSpecKey: key("render_spec", "5"),
  expectedSlotAttempt: 1,
  idempotencyKey: "held-admission-0001",
};

function response(outcome: "admitted" | "replayed") {
  const created = outcome === "admitted";
  return {
    outcome,
    admission: {
      planId: path.planId,
      batchId: request.expectedBatchId,
      slotId: path.slotId,
      slotAttempt: 1,
      quoteKey: request.expectedQuoteKey,
      renderSpecKey: request.expectedRenderSpecKey,
      reservationKey: key("reservation", "6"),
      maximumQuoteMicroUsd: "1250000",
      currency: "USD",
      reservationExpiresAt: "2026-07-22T12:10:00.000Z",
      state: "held",
    },
    effects: {
      internal: {
        internalBudgetReserved: created,
        heldRenderCreated: created,
        heldOutboxCreated: created,
      },
      external: {
        secretResolved: false,
        providerCalled: false,
        verificationPerformed: false,
        quoteRequested: false,
        activationAuthorized: false,
        externalSpendCommitted: false,
        providerSubmissionStarted: false,
        renderSubmitted: false,
        renderArtifactCreated: false,
        publishingCreated: false,
      },
    },
    canGenerate: false,
    spendAuthorized: false,
  } as const;
}

test("held-admission browser contract accepts only public path and exact CAS fields", () => {
  assert.deepEqual(oneVideoHeldAdmissionPathSchema.parse(path), path);
  assert.deepEqual(oneVideoHeldAdmissionRequestSchema.parse(request), request);

  for (const extra of [
    { planId: path.planId },
    { slotId: path.slotId },
    { dailyPlanSlotId: "11111111-1111-4111-8111-111111111111" },
    { budgetBucketId: "22222222-2222-4222-8222-222222222222" },
    { providerAccountId: "33333333-3333-4333-8333-333333333333" },
    { providerKey: "heygen" },
    { maximumQuoteMicroUsd: "1250000" },
    { authorityDigest: `sha256:${"a".repeat(64)}` },
    { quoteExpiresAt: "2026-07-22T12:10:00.000Z" },
    { reservationExpiresAt: "2026-07-22T12:05:00.000Z" },
    { expectedSlotStateVersion: 4 },
    { expectedBucketStateVersion: 7 },
    { principal: { subjectId: "owner-a" } },
  ]) {
    assert.equal(oneVideoHeldAdmissionRequestSchema.safeParse({ ...request, ...extra }).success, false);
  }
});

test("held-admission browser contract rejects malformed CAS tokens and attempts", () => {
  for (const changed of [
    { expectedBatchId: "33333333-3333-4333-8333-333333333333" },
    { expectedQuoteKey: "quote_native" },
    { expectedRenderSpecKey: key("render-spec", "5") },
    { expectedSlotAttempt: 0 },
    { expectedSlotAttempt: 1.5 },
    { expectedSlotAttempt: 1_000_001 },
    { idempotencyKey: "short" },
  ]) {
    assert.equal(oneVideoHeldAdmissionRequestSchema.safeParse({ ...request, ...changed }).success, false);
  }
  assert.equal(oneVideoHeldAdmissionPathSchema.safeParse({ ...path, planId: "native-plan" }).success, false);
  assert.equal(oneVideoHeldAdmissionPathSchema.safeParse({ ...path, internal: true }).success, false);
});

test("held-admission receipt is redacted and distinguishes held internal work from zero external effects", () => {
  const admitted = oneVideoHeldAdmissionResponseSchema.parse(response("admitted"));
  assert.equal(admitted.admission.state, "held");
  assert.equal(admitted.effects.internal.internalBudgetReserved, true);
  assert.equal(admitted.effects.external.externalSpendCommitted, false);
  assert.equal(admitted.effects.external.providerSubmissionStarted, false);
  assert.equal(admitted.canGenerate, false);
  assert.equal(admitted.spendAuthorized, false);

  const serialized = JSON.stringify(admitted);
  for (const privateField of [
    "dailyPlanSlotId", "budgetBucketId", "authoritySnapshotId", "authorityDigest",
    "admissionDigest", "providerAccountId", "providerKey", "renderJobId", "outboxId",
  ]) assert.equal(serialized.includes(privateField), false);

  const replayed = oneVideoHeldAdmissionResponseSchema.parse(response("replayed"));
  assert.equal(replayed.effects.internal.internalBudgetReserved, false);
  assert.equal(oneVideoHeldAdmissionResponseSchema.safeParse({
    ...response("replayed"),
    effects: {
      ...response("replayed").effects,
      internal: { ...response("replayed").effects.internal, internalBudgetReserved: true },
    },
  }).success, false);
});

test("held-admission receipt rejects zero, excessive money and every external effect", () => {
  for (const maximumQuoteMicroUsd of ["0", "9000000000000001", "1.25", "-1"]) {
    assert.equal(oneVideoHeldAdmissionResponseSchema.safeParse({
      ...response("admitted"),
      admission: { ...response("admitted").admission, maximumQuoteMicroUsd },
    }).success, false);
  }
  assert.equal(oneVideoHeldAdmissionResponseSchema.safeParse({
    ...response("admitted"),
    effects: {
      ...response("admitted").effects,
      external: { ...response("admitted").effects.external, externalSpendCommitted: true },
    },
  }).success, false);
});
