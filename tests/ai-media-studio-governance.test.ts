import assert from "node:assert/strict";
import test from "node:test";
import {
  createAssetQualityReviewRequestSchema,
  createInfluencerGovernanceProfileRequestSchema,
  influencerGovernanceProfileResponseSchema,
} from "../shared/ai-media-studio-governance";
import {
  GovernanceConflictError,
  GovernanceGateError,
  GovernanceService,
  InMemoryGovernanceRepository,
  deriveQualityReviewStatus,
  toPublicInfluencerGovernanceProfile,
} from "../server/ai-media-studio/governance";

const tenantA = { ownerUserId: "owner-a", workspaceId: "workspace-a" } as const;
const tenantB = { ownerUserId: "owner-b", workspaceId: "workspace-b" } as const;
const proofDigest = `sha256:${"a".repeat(64)}` as const;
const assetChecksum = "b".repeat(64);
const binding = { influencerId: "influencer-a", avatarId: "avatar-a", voiceId: "voice-a" } as const;
const profileRequest = {
  consentBasis: "obtained" as const,
  rightsBasis: "licensed" as const,
  allowedUses: ["paid_ads", "internal_preview"] as const,
  territories: ["US"] as const,
  validFrom: "2026-07-01T00:00:00.000Z",
  expiresAt: "2026-08-01T00:00:00.000Z",
  policyVersion: "brand-2026.07",
  proofDigest,
  brandPolicy: { requiredTerms: ["Kong"], prohibitedTerms: ["guaranteed results"] },
  idempotencyKey: "profile-key-1",
};
const approvedCriteria = {
  naturalMovement: 4, eyeContact: 5, speechQuality: 4, lighting: 5,
  realism: 4, brandConsistency: 5, verticalQuality: 4,
} as const;

function harness() {
  let id = 0;
  const repository = new InMemoryGovernanceRepository();
  const service = new GovernanceService(repository, {
    now: () => new Date("2026-07-20T12:00:00.000Z"),
    idFactory: () => `governance-${++id}`,
  });
  return { repository, service };
}

test("public governance schemas are strict and reject subject, actor, provider, URL, secret, and raw-proof claims", () => {
  assert.equal(createInfluencerGovernanceProfileRequestSchema.safeParse(profileRequest).success, true);
  for (const forbidden of [
    { influencerId: "forged" }, { avatarId: "forged" }, { voiceId: "forged" },
    { actorUserId: "forged" }, { tenantId: "forged" }, { providerId: "native-123" },
    { proofUrl: "https://private.example/proof" }, { proofDocument: "raw evidence" }, { apiSecret: "secret" },
  ]) {
    assert.equal(createInfluencerGovernanceProfileRequestSchema.safeParse({ ...profileRequest, ...forbidden }).success, false);
  }
  assert.equal(createInfluencerGovernanceProfileRequestSchema.safeParse({ ...profileRequest, proofDigest: "a".repeat(64) }).success, false);
  assert.equal(createAssetQualityReviewRequestSchema.safeParse({ criteria: approvedCriteria, idempotencyKey: "review-key-1" }).success, true);
  for (const forbidden of [{ assetId: "forged" }, { assetChecksum }, { reviewerId: "forged" }, { providerReviewId: "native" }]) {
    assert.equal(createAssetQualityReviewRequestSchema.safeParse({ criteria: approvedCriteria, idempotencyKey: "review-key-1", ...forbidden }).success, false);
  }
});

test("profiles form a server-digested append-only chain with current semantics and idempotency", async () => {
  const { service } = harness();
  const first = await service.createProfile(tenantA, "reviewer-a", binding, profileRequest);
  const replay = await service.createProfile(tenantA, "reviewer-a", binding, profileRequest);
  assert.equal(replay.id, first.id);
  assert.equal(first.version, 1);
  assert.equal(first.previousProfileId, null);
  assert.match(first.evidenceDigest, /^sha256:[a-f0-9]{64}$/u);

  const second = await service.createProfile(tenantA, "reviewer-a", binding, {
    ...profileRequest, idempotencyKey: "profile-key-2", rightsBasis: "owned",
  });
  assert.equal(second.version, 2);
  assert.equal(second.previousProfileId, first.id);
  assert.equal((await service.getCurrentProfile(tenantA, binding.influencerId))?.id, second.id);
  assert.deepEqual((await service.listProfiles(tenantA, binding.influencerId)).map((item) => item.id), [first.id, second.id]);

  await assert.rejects(
    () => service.createProfile(tenantA, "reviewer-a", binding, { ...profileRequest, rightsBasis: "owned" }),
    GovernanceConflictError,
  );
});

test("tenant isolation applies to identities, current pointers, histories, and idempotency keys", async () => {
  const { service } = harness();
  const first = await service.createProfile(tenantA, "reviewer-a", binding, profileRequest);
  const other = await service.createProfile(tenantB, "reviewer-b", binding, profileRequest);
  assert.notEqual(other.id, first.id);
  assert.equal(other.version, 1);
  assert.equal((await service.getCurrentProfile(tenantB, binding.influencerId))?.id, other.id);
  assert.equal((await service.listProfiles(tenantA, binding.influencerId)).length, 1);
  assert.equal((await service.listProfiles(tenantB, binding.influencerId)).length, 1);
});

test("revocation is append-only and immediately closes the render gate", async () => {
  const { service } = harness();
  const first = await service.createProfile(tenantA, "reviewer-a", binding, profileRequest);
  const revoked = await service.revokeProfile(tenantA, "reviewer-b", binding.influencerId, {
    reason: "Consent withdrawn", idempotencyKey: "revoke-key-1",
  });
  const replay = await service.revokeProfile(tenantA, "reviewer-b", binding.influencerId, {
    reason: "Consent withdrawn", idempotencyKey: "revoke-key-1",
  });
  assert.equal(replay.id, revoked.id);
  await assert.rejects(
    () => service.revokeProfile(tenantA, "reviewer-b", binding.influencerId, {
      reason: "Consent withdrawn", idempotencyKey: "revoke-key-2",
    }),
    GovernanceConflictError,
  );
  assert.equal(revoked.version, 2);
  assert.equal(revoked.previousProfileId, first.id);
  assert.equal(revoked.revokedAt, "2026-07-20T12:00:00.000Z");
  assert.equal((await service.listProfiles(tenantA, binding.influencerId)).length, 2);
  await assert.rejects(
    () => service.assertRenderAllowed(tenantA, { ...binding, use: "paid_ads", territory: "US", content: "Kong summer launch" }),
    (error: unknown) => error instanceof GovernanceGateError && error.reasons.includes("profile_revoked"),
  );
});

test("render gate enforces validity, exact bindings, allowed use, territory, and brand terms", async () => {
  const { service } = harness();
  await service.createProfile(tenantA, "reviewer-a", binding, {
    ...profileRequest,
    allowedUses: ["paid_ads", "internal_preview", "organic_social"],
  });
  const allowed = await service.assertRenderAllowed(tenantA, {
    ...binding, use: "paid_ads", territory: "US", content: "Meet Kong today",
  });
  assert.equal(allowed.influencerId, binding.influencerId);

  const internalPreview = await service.assertRenderAllowed(tenantA, {
    ...binding, use: "internal_preview", territory: "WORLDWIDE", content: "Meet Kong today",
  });
  assert.equal(internalPreview.id, allowed.id);
  await assert.rejects(
    () => service.assertRenderAllowed(tenantA, {
      ...binding, use: "organic_social", territory: "WORLDWIDE", content: "Meet Kong today",
    }),
    (error: unknown) => error instanceof GovernanceGateError && error.reasons.includes("territory_not_allowed"),
  );

  await assert.rejects(
    () => service.assertRenderAllowed(tenantA, {
      influencerId: binding.influencerId, avatarId: "wrong-avatar", voiceId: "wrong-voice",
      use: "commercial", territory: "CA", content: "Guaranteed results",
    }),
    (error: unknown) => error instanceof GovernanceGateError
      && ["avatar_mismatch", "voice_mismatch", "use_not_allowed", "territory_not_allowed", "required_brand_term_missing", "prohibited_brand_term_present"]
        .every((reason) => error.reasons.includes(reason as never)),
  );
});

test("quality decisions are server-derived and reviews form an exact-checksum append-only chain", async () => {
  assert.equal(deriveQualityReviewStatus(approvedCriteria), "approved");
  assert.equal(deriveQualityReviewStatus({ ...approvedCriteria, lighting: 3 }), "needs_review");
  assert.equal(deriveQualityReviewStatus({ ...approvedCriteria, realism: 2 }), "rejected");
  const { service } = harness();
  const first = await service.createQualityReview(tenantA, "reviewer-a", { assetId: "asset-a", assetChecksum }, {
    criteria: approvedCriteria, notes: "Ready", idempotencyKey: "review-key-1",
  });
  const replay = await service.createQualityReview(tenantA, "reviewer-a", { assetId: "asset-a", assetChecksum }, {
    criteria: approvedCriteria, notes: "Ready", idempotencyKey: "review-key-1",
  });
  assert.equal(replay.id, first.id);
  assert.equal(first.status, "approved");
  assert.equal(first.version, 1);
  assert.match(first.evidenceDigest, /^sha256:[a-f0-9]{64}$/u);

  const second = await service.createQualityReview(tenantA, "reviewer-a", { assetId: "asset-a", assetChecksum }, {
    criteria: { ...approvedCriteria, eyeContact: 3 }, idempotencyKey: "review-key-2",
  });
  assert.equal(second.status, "needs_review");
  assert.equal(second.previousReviewId, first.id);
  assert.equal(second.version, 2);
});

test("publish gate requires the current approved review bound to the exact raw asset checksum", async () => {
  const { service } = harness();
  await service.createProfile(tenantA, "reviewer-a", binding, profileRequest);
  const gate = {
    ...binding, use: "paid_ads" as const, territory: "US", content: "Kong launch",
    assetId: "asset-a", assetChecksum,
  };
  await assert.rejects(() => service.assertPublishAllowed(tenantA, gate), (error: unknown) =>
    error instanceof GovernanceGateError && error.reasons.includes("quality_review_missing"));
  await service.createQualityReview(tenantA, "reviewer-a", { assetId: gate.assetId, assetChecksum }, {
    criteria: approvedCriteria, idempotencyKey: "review-key-1",
  });
  assert.equal((await service.assertPublishAllowed(tenantA, gate)).review.status, "approved");
  await assert.rejects(
    () => service.assertPublishAllowed(tenantA, { ...gate, assetChecksum: "c".repeat(64) }),
    (error: unknown) => error instanceof GovernanceGateError && error.reasons.includes("quality_review_checksum_mismatch"),
  );
  await service.createQualityReview(tenantA, "reviewer-b", { assetId: gate.assetId, assetChecksum }, {
    criteria: { ...approvedCriteria, realism: 2 }, idempotencyKey: "review-key-2",
  });
  await assert.rejects(
    () => service.assertPublishAllowed(tenantA, gate),
    (error: unknown) => error instanceof GovernanceGateError && error.reasons.includes("quality_review_not_approved"),
  );
});

test("public mappers and response schemas redact bindings, actors, proof, evidence digests, and chain ids", async () => {
  const { service } = harness();
  const internal = await service.createProfile(tenantA, "reviewer-a", binding, profileRequest);
  const profile = toPublicInfluencerGovernanceProfile(internal);
  assert.equal(influencerGovernanceProfileResponseSchema.safeParse({ profile }).success, true);
  for (const key of ["ownerUserId", "workspaceId", "influencerId", "avatarId", "voiceId", "proofDigest", "evidenceDigest", "previousProfileId", "createdByUserId"]) {
    assert.equal(key in profile, false, key);
  }
});
