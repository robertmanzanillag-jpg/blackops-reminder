import assert from "node:assert/strict";
import test from "node:test";
import {
  registerHeyGenCredentialReferenceRequestSchema,
  registerHeyGenCredentialReferenceResponseSchema,
  runHeyGenLiveVerificationFailureResponseSchema,
  runHeyGenLiveVerificationRequestSchema,
  runHeyGenLiveVerificationResponseSchema,
} from "../shared/ai-media-studio-heygen-secure-setup";

test("credential-reference request accepts only an idempotency key", () => {
  assert.deepEqual(registerHeyGenCredentialReferenceRequestSchema.parse({ idempotencyKey: "heygen.setup.0001" }), {
    idempotencyKey: "heygen.setup.0001",
  });
  for (const value of [
    { idempotencyKey: "heygen.setup.0001", apiKey: "secret" },
    { idempotencyKey: "heygen.setup.0001", secretRef: "env://attacker" },
    { idempotencyKey: "heygen.setup.0001", providerAccountId: "attacker" },
    ["heygen.setup.0001"],
    null,
  ]) assert.equal(registerHeyGenCredentialReferenceRequestSchema.safeParse(value).success, false);
});

test("credential-reference response exposes safe metadata only", () => {
  const response = {
    outcome: "created",
    credentialReference: { providerKey: "heygen", state: "registered", credentialVersion: 1 },
  } as const;
  assert.deepEqual(registerHeyGenCredentialReferenceResponseSchema.parse(response), response);
  assert.equal(registerHeyGenCredentialReferenceResponseSchema.safeParse({
    ...response,
    secretRef: "env://AI_MEDIA_STUDIO_SECRET_HEYGEN_API_KEY",
  }).success, false);
});

test("live verification is a separate strict action with no spend effects", () => {
  assert.deepEqual(runHeyGenLiveVerificationRequestSchema.parse({ idempotencyKey: "heygen.verify.0001" }), {
    idempotencyKey: "heygen.verify.0001",
  });
  assert.equal(runHeyGenLiveVerificationRequestSchema.safeParse({
    idempotencyKey: "heygen.verify.0001",
    apiKey: "secret",
  }).success, false);

  const response = runHeyGenLiveVerificationResponseSchema.parse({
    outcome: "recorded",
    verification: {
      providerKey: "heygen",
      state: "verified",
      avatarCount: 5,
      voiceCount: 5,
      observedAt: "2026-07-22T12:00:00.000Z",
      expiresAt: "2026-07-23T12:00:00.000Z",
    },
    effects: {
      providerNetworkCall: true,
      liveVerification: true,
      generation: false,
      admission: false,
      spend: false,
      deployment: false,
      migrationApply: false,
      publishing: false,
    },
  });
  assert.equal(response.effects.spend, false);
  assert.equal(response.effects.generation, false);

  const failure = runHeyGenLiveVerificationFailureResponseSchema.parse({
    outcome: "provider_failed",
    providerKey: "heygen",
    failureCode: "provider_unauthorized",
    observedAt: "2026-07-22T12:00:00.000Z",
    effects: {
      providerNetworkCall: true,
      liveVerification: false,
      generation: false,
      admission: false,
      spend: false,
      deployment: false,
      migrationApply: false,
      publishing: false,
    },
  });
  assert.equal(failure.effects.providerNetworkCall, true);
  assert.equal(failure.effects.liveVerification, false);

  assert.equal(runHeyGenLiveVerificationResponseSchema.safeParse({
    ...response,
    outcome: "replayed",
    effects: { ...response.effects, providerNetworkCall: false, liveVerification: false },
  }).success, true);
  assert.equal(runHeyGenLiveVerificationResponseSchema.safeParse({
    ...response,
    outcome: "replayed",
  }).success, false);
});
