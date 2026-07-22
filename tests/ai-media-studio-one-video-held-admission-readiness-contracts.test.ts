import test from "node:test";
import assert from "node:assert/strict";
import {
  oneVideoHeldAdmissionReadinessResponseSchema,
} from "../shared/ai-media-studio-one-video-held-admission-readiness";

const key = (prefix: string, character: string) => `${prefix}_${character.repeat(24)}`;
const effects = {
  providerCalled: false,
  secretResolved: false,
  externalSpendCommitted: false,
  renderArtifactCreated: false,
  publishingCreated: false,
} as const;
const subject = {
  planId: key("plan", "a"),
  batchId: key("batch", "b"),
  slotId: key("slot", "c"),
  slotAttempt: 1,
};

test("available held-admission readiness exposes only exact public CAS tokens", () => {
  const parsed = oneVideoHeldAdmissionReadinessResponseSchema.parse({
    readiness: {
      version: 1,
      source: "postgresql_read_only",
      subject,
      observedAt: "2026-07-22T12:00:00.000Z",
      state: "available",
      postAvailable: true,
      reasonCodes: [],
      cas: {
        expectedBatchId: subject.batchId,
        expectedQuoteKey: key("quote", "d"),
        expectedRenderSpecKey: key("render_spec", "e"),
        expectedSlotAttempt: 1,
      },
      effects,
      canGenerate: false,
      spendAuthorized: false,
    },
  });

  assert.equal(parsed.readiness.postAvailable, true);
  assert.deepEqual(Object.keys(parsed.readiness.cas ?? {}).sort(), [
    "expectedBatchId", "expectedQuoteKey", "expectedRenderSpecKey", "expectedSlotAttempt",
  ].sort());
});

test("readiness fails closed when availability, blockers, or reservation state are inconsistent", () => {
  const base = {
    version: 1,
    source: "postgresql_read_only",
    subject,
    observedAt: "2026-07-22T12:00:00.000Z",
    effects,
    canGenerate: false,
    spendAuthorized: false,
  } as const;

  assert.equal(oneVideoHeldAdmissionReadinessResponseSchema.safeParse({ readiness: {
    ...base, state: "available", postAvailable: true, reasonCodes: [],
  } }).success, false);
  assert.equal(oneVideoHeldAdmissionReadinessResponseSchema.safeParse({ readiness: {
    ...base, state: "blocked", postAvailable: false, reasonCodes: [],
  } }).success, false);
  assert.equal(oneVideoHeldAdmissionReadinessResponseSchema.safeParse({ readiness: {
    ...base, state: "held", postAvailable: false, reasonCodes: [],
    currentReservation: {
      reservationKey: key("reservation", "f"), maximumQuoteMicroUsd: "1250000", currency: "USD",
      expiresAt: "2026-07-22T12:30:00.000Z", state: "expired",
    },
  } }).success, false);
});

test("held readiness carries a redacted receipt and can never authorize generation or spend", () => {
  const parsed = oneVideoHeldAdmissionReadinessResponseSchema.parse({ readiness: {
    version: 1,
    source: "postgresql_read_only",
    subject,
    observedAt: "2026-07-22T12:00:00.000Z",
    state: "held",
    postAvailable: false,
    reasonCodes: [],
    currentReservation: {
      reservationKey: key("reservation", "f"), maximumQuoteMicroUsd: "1250000", currency: "USD",
      expiresAt: "2026-07-22T12:30:00.000Z", state: "held",
    },
    effects,
    canGenerate: false,
    spendAuthorized: false,
  } });

  assert.equal(parsed.readiness.currentReservation?.state, "held");
  assert.equal(parsed.readiness.canGenerate || parsed.readiness.spendAuthorized, false);
  assert.equal(Object.values(parsed.readiness.effects).some(Boolean), false);
});

test("blocked and expired readiness remain non-posting and carry only their allowed evidence", () => {
  const base = {
    version: 1,
    source: "postgresql_read_only",
    subject,
    observedAt: "2026-07-22T12:31:00.000Z",
    postAvailable: false,
    effects,
    canGenerate: false,
    spendAuthorized: false,
  } as const;
  const blocked = oneVideoHeldAdmissionReadinessResponseSchema.parse({ readiness: {
    ...base,
    state: "blocked",
    reasonCodes: ["kill_switch_active"],
  } });
  const expired = oneVideoHeldAdmissionReadinessResponseSchema.parse({ readiness: {
    ...base,
    state: "expired",
    reasonCodes: [],
    currentReservation: {
      reservationKey: key("reservation", "f"), maximumQuoteMicroUsd: "1250000", currency: "USD",
      expiresAt: "2026-07-22T12:30:00.000Z", state: "expired",
    },
  } });

  assert.equal(blocked.readiness.cas, undefined);
  assert.equal(blocked.readiness.currentReservation, undefined);
  assert.equal(expired.readiness.currentReservation?.state, "expired");
  assert.equal(expired.readiness.postAvailable, false);
});
