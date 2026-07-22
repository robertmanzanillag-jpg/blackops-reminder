import test from "node:test";
import assert from "node:assert/strict";
import {
  mediaStudioCoreApi,
  OneVideoHeldAdmissionClientError,
} from "../client/src/features/ai-media-studio/core/api";

const key = (prefix: string, character: string) => `${prefix}_${character.repeat(24)}`;
const planId = key("plan", "a");
const batchId = key("batch", "b");
const slotId = key("slot", "c");
const quoteKey = key("quote", "d");
const renderSpecKey = key("render_spec", "e");

const effects = {
  providerCalled: false,
  secretResolved: false,
  externalSpendCommitted: false,
  renderArtifactCreated: false,
  publishingCreated: false,
} as const;

test("held-admission readiness GET is no-store, identity-bound, and read-only", async () => {
  const originalFetch = globalThis.fetch;
  let request: { input: string; init?: RequestInit } | undefined;
  globalThis.fetch = (async (input, init) => {
    request = { input: String(input), init };
    return new Response(JSON.stringify({ readiness: {
      version: 1,
      source: "postgresql_read_only",
      subject: { planId, batchId, slotId, slotAttempt: 1 },
      observedAt: "2026-07-22T12:00:00.000Z",
      state: "available",
      postAvailable: true,
      reasonCodes: [],
      cas: { expectedBatchId: batchId, expectedQuoteKey: quoteKey,
        expectedRenderSpecKey: renderSpecKey, expectedSlotAttempt: 1 },
      effects,
      canGenerate: false,
      spendAuthorized: false,
    } }), { status: 200 });
  }) as typeof fetch;

  try {
    const result = await mediaStudioCoreApi.oneVideoHeldAdmissionReadiness({ planId, batchId, slotId });
    assert.equal(request?.input, `/api/ai-media-studio/production-batches/${planId}/one-video-held-admission-readiness/${slotId}`);
    assert.equal(request?.init?.method, undefined);
    assert.equal(request?.init?.body, undefined);
    assert.equal(request?.init?.credentials, "include");
    assert.equal(request?.init?.cache, "no-store");
    assert.equal(result.readiness.postAvailable, true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("held-admission POST sends exactly five public CAS fields and validates the receipt", async () => {
  const originalFetch = globalThis.fetch;
  let request: { input: string; init?: RequestInit } | undefined;
  globalThis.fetch = (async (input, init) => {
    request = { input: String(input), init };
    return new Response(JSON.stringify({
      outcome: "admitted",
      admission: { planId, batchId, slotId, slotAttempt: 1, quoteKey, renderSpecKey,
        reservationKey: key("reservation", "f"), maximumQuoteMicroUsd: "1250000", currency: "USD",
        reservationExpiresAt: "2026-07-22T12:30:00.000Z", state: "held" },
      effects: {
        internal: { internalBudgetReserved: true, heldRenderCreated: true, heldOutboxCreated: true },
        external: { secretResolved: false, providerCalled: false, verificationPerformed: false,
          quoteRequested: false, activationAuthorized: false, externalSpendCommitted: false,
          providerSubmissionStarted: false, renderSubmitted: false, renderArtifactCreated: false,
          publishingCreated: false },
      },
      canGenerate: false,
      spendAuthorized: false,
    }), { status: 201 });
  }) as typeof fetch;

  try {
    const input = { expectedBatchId: batchId, expectedQuoteKey: quoteKey,
      expectedRenderSpecKey: renderSpecKey, expectedSlotAttempt: 1,
      idempotencyKey: "held_admission_000000000000000000000001" };
    const result = await mediaStudioCoreApi.createOneVideoHeldAdmission({ planId, slotId, input });
    assert.equal(request?.input, `/api/ai-media-studio/production-batches/${planId}/one-video-held-admission/${slotId}`);
    assert.equal(request?.init?.method, "POST");
    assert.equal(request?.init?.credentials, "include");
    assert.equal(request?.init?.cache, "no-store");
    assert.deepEqual(Object.keys(JSON.parse(String(request?.init?.body))).sort(), [
      "expectedBatchId", "expectedQuoteKey", "expectedRenderSpecKey", "expectedSlotAttempt", "idempotencyKey",
    ].sort());
    assert.deepEqual(JSON.parse(String(request?.init?.body)), input);
    assert.equal(result.admission.state, "held");
    assert.equal(Object.values(result.effects.external).some(Boolean), false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("held-admission client rejects stale identity and private browser fields", async () => {
  await assert.rejects(mediaStudioCoreApi.createOneVideoHeldAdmission({
    planId,
    slotId,
    input: {
      expectedBatchId: batchId,
      expectedQuoteKey: quoteKey,
      expectedRenderSpecKey: renderSpecKey,
      expectedSlotAttempt: 1,
      idempotencyKey: "held_admission_000000000000000000000001",
      maximumQuoteMicroUsd: "1",
    } as never,
  }));
});

test("ADMISSION_DENIED 422 exposes a stable actionable client message and code", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response(JSON.stringify({
    error: "Held admission is not currently available",
    code: "ADMISSION_DENIED",
  }), { status: 422 })) as typeof fetch;

  try {
    await assert.rejects(
      mediaStudioCoreApi.createOneVideoHeldAdmission({
        planId,
        slotId,
        input: {
          expectedBatchId: batchId,
          expectedQuoteKey: quoteKey,
          expectedRenderSpecKey: renderSpecKey,
          expectedSlotAttempt: 1,
          idempotencyKey: "held_admission_000000000000000000000001",
        },
      }),
      (error: unknown) => {
        assert.ok(error instanceof OneVideoHeldAdmissionClientError);
        assert.equal(error.statusCode, 422);
        assert.equal(error.code, "ADMISSION_DENIED");
        assert.equal(
          error.message,
          "Held admission is not currently available. Refresh the admission gate to review current blockers.",
        );
        return true;
      },
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});
