import assert from "node:assert/strict";
import test from "node:test";
import {
  sourceEligibilityReviewRequestSchema,
  sourceEligibilityReviewResponseSchema,
} from "../shared/ai-media-studio-source-eligibility";

test("source eligibility review accepts exact-content approve or reject decisions only", () => {
  assert.equal(sourceEligibilityReviewRequestSchema.parse({
    decision: "approve",
    expectedContentHash: `sha256:${"a".repeat(64)}`,
    idempotencyKey: "source-review-001",
    rightsStatus: "owned",
  }).decision, "approve");
  assert.equal(sourceEligibilityReviewRequestSchema.parse({
    decision: "reject",
    expectedContentHash: `sha256:${"b".repeat(64)}`,
    idempotencyKey: "source-review-002",
    reasonCode: "rights_unverified",
  }).decision, "reject");
  for (const body of [
    { decision: "approve", expectedContentHash: `sha256:${"a".repeat(64)}`, idempotencyKey: "source-review-001", rightsStatus: "unknown" },
    { decision: "approve", expectedContentHash: `sha256:${"a".repeat(64)}`, idempotencyKey: "source-review-001", rightsStatus: "owned", providerExternalId: "private" },
    { decision: "reject", expectedContentHash: `sha256:${"a".repeat(64)}`, idempotencyKey: "source-review-001", reasonCode: "other" },
  ]) {
    assert.equal(sourceEligibilityReviewRequestSchema.safeParse(body).success, false);
  }
});

test("source eligibility review response exposes only Studio source state and blocked downstream effects", () => {
  const parsed = sourceEligibilityReviewResponseSchema.parse({
    source: {
      id: "source_abc123",
      category: "events",
      contentHash: `sha256:${"a".repeat(64)}`,
      status: "accepted",
      rightsStatus: "licensed",
      moderationStatus: "approved",
      updatedAt: "2026-07-22T15:00:00.000Z",
    },
    review: { decision: "approve", replayed: false, reviewedAt: "2026-07-22T15:00:00.000Z" },
    downstreamState: "eligible_for_script_batch",
    effects: {
      sourceReviewPersisted: true,
      scriptsGenerated: false,
      renderQueued: false,
      outboxCreated: false,
      videoProviderCalled: false,
      secretResolved: false,
      spendCommitted: false,
      publishingCreated: false,
      migrationApplied: false,
      deploymentPerformed: false,
    },
  });
  const serialized = JSON.stringify(parsed);
  assert.doesNotMatch(serialized, /providerExternalId|canonicalUrl|"title"|"content"|payload|secretRef|cursor/u);
  assert.equal(parsed.downstreamState, "eligible_for_script_batch");
});

test("source eligibility review response rejects mismatched downstream state", () => {
  assert.equal(sourceEligibilityReviewResponseSchema.safeParse({
    source: {
      id: "source_abc123",
      category: "events",
      contentHash: `sha256:${"a".repeat(64)}`,
      status: "rejected",
      rightsStatus: "rejected",
      moderationStatus: "rejected",
      updatedAt: "2026-07-22T15:00:00.000Z",
    },
    review: { decision: "reject", replayed: false, reviewedAt: "2026-07-22T15:00:00.000Z" },
    downstreamState: "eligible_for_script_batch",
    effects: {
      sourceReviewPersisted: true,
      scriptsGenerated: false,
      renderQueued: false,
      outboxCreated: false,
      videoProviderCalled: false,
      secretResolved: false,
      spendCommitted: false,
      publishingCreated: false,
      migrationApplied: false,
      deploymentPerformed: false,
    },
  }).success, false);
});
