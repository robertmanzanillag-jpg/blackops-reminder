import assert from "node:assert/strict";
import test from "node:test";
import { sourceEligibilityReviewResponseSchema } from "../shared/ai-media-studio-source-eligibility";
import {
  SourceEligibilityReviewError,
  SourceEligibilityReviewService,
} from "../server/ai-media-studio/sources/eligibility-review-service";
import { InMemorySourceRepository } from "../server/ai-media-studio/sources/in-memory-source-repository";

const scopeA = { ownerUserId: "owner-a", workspaceId: "personal" } as const;
const scopeB = { ownerUserId: "owner-b", workspaceId: "personal" } as const;
const hashA = `sha256:${"a".repeat(64)}` as const;
const hashB = `sha256:${"b".repeat(64)}` as const;

async function seed(repository: InMemorySourceRepository, scope = scopeA) {
  return (await repository.upsertByContentHash(scope, {
    adapterKey: "kong-owned-catalog",
    providerExternalId: "event-1",
    category: "events",
    canonicalUrl: "https://kong.example/events/1",
    title: "Kong weekend",
    content: "Owned event details",
    contentHash: hashA,
    rightsStatus: "unknown",
    moderationStatus: "pending",
    status: "discovered",
    payload: { privateUpstreamField: "never-public" },
  })).item;
}

test("exact-content approval makes one source eligible without downstream effects and exact replay is stable", async () => {
  const repository = new InMemorySourceRepository();
  const source = await seed(repository);
  const service = new SourceEligibilityReviewService(repository);
  const request = {
    decision: "approve" as const,
    expectedContentHash: hashA,
    idempotencyKey: "review-event-1",
    rightsStatus: "owned" as const,
  };
  const first = sourceEligibilityReviewResponseSchema.parse(
    await service.review(scopeA, scopeA.ownerUserId, source.id, request),
  );
  assert.equal(first.downstreamState, "eligible_for_script_batch");
  assert.deepEqual(first.source, {
    id: source.id,
    category: "events",
    contentHash: hashA,
    status: "accepted",
    rightsStatus: "owned",
    moderationStatus: "approved",
    updatedAt: first.source.updatedAt,
  });
  assert.equal(first.review.replayed, false);
  assert.deepEqual(first.effects, {
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
  });
  assert.doesNotMatch(JSON.stringify(first), /privateUpstreamField|never-public|providerExternalId|actorUserId/u);

  const replay = await service.review(scopeA, scopeA.ownerUserId, source.id, request);
  assert.equal(replay.review.replayed, true);
  assert.equal(replay.review.reviewedAt, first.review.reviewedAt);
  assert.equal(replay.source.updatedAt, first.source.updatedAt);
});

test("rejection stays blocked and cannot be replaced by a different review", async () => {
  const repository = new InMemorySourceRepository();
  const source = await seed(repository);
  const service = new SourceEligibilityReviewService(repository);
  const rejected = await service.review(scopeA, scopeA.ownerUserId, source.id, {
    decision: "reject",
    expectedContentHash: hashA,
    idempotencyKey: "reject-event-1",
    reasonCode: "rights_unverified",
  });
  assert.deepEqual([rejected.source.status, rejected.source.rightsStatus, rejected.source.moderationStatus],
    ["rejected", "rejected", "rejected"]);
  assert.equal(rejected.downstreamState, "blocked");
  await assert.rejects(service.review(scopeA, scopeA.ownerUserId, source.id, {
    decision: "approve",
    expectedContentHash: hashA,
    idempotencyKey: "different-review",
    rightsStatus: "licensed",
  }), (error: unknown) => error instanceof SourceEligibilityReviewError && error.code === "REVIEW_CONFLICT");
});

test("tenant mismatch, stale content, actor mismatch and private fields fail closed", async () => {
  const repository = new InMemorySourceRepository();
  const source = await seed(repository);
  const service = new SourceEligibilityReviewService(repository);
  const valid = {
    decision: "approve" as const,
    expectedContentHash: hashA,
    idempotencyKey: "review-event-1",
    rightsStatus: "owned" as const,
  };
  await assert.rejects(service.review(scopeB, scopeB.ownerUserId, source.id, valid),
    (error: unknown) => error instanceof SourceEligibilityReviewError && error.code === "NOT_FOUND");
  await assert.rejects(service.review(scopeA, "owner-b", source.id, valid),
    (error: unknown) => error instanceof SourceEligibilityReviewError && error.code === "INVALID_REQUEST");
  await assert.rejects(service.review(scopeA, scopeA.ownerUserId, source.id, { ...valid, expectedContentHash: hashB }),
    (error: unknown) => error instanceof SourceEligibilityReviewError && error.code === "SOURCE_REFRESHED");
  await assert.rejects(service.review(scopeA, scopeA.ownerUserId, source.id, { ...valid, providerId: "private" }),
    (error: unknown) => error instanceof SourceEligibilityReviewError && error.code === "INVALID_REQUEST");
  const stored = await repository.get(scopeA, source.id);
  assert.deepEqual([stored?.status, stored?.rightsStatus, stored?.moderationStatus], ["discovered", "unknown", "pending"]);
});

test("content refresh invalidates prior eligibility and requires a new exact review", async () => {
  const repository = new InMemorySourceRepository();
  const source = await seed(repository);
  const service = new SourceEligibilityReviewService(repository);
  await service.review(scopeA, scopeA.ownerUserId, source.id, {
    decision: "approve", expectedContentHash: hashA, idempotencyKey: "review-a", rightsStatus: "owned",
  });
  const refreshed = (await repository.upsertByContentHash(scopeA, {
    adapterKey: "kong-owned-catalog",
    providerExternalId: "event-1",
    category: "events",
    canonicalUrl: "https://kong.example/events/1",
    title: "Kong weekend updated",
    content: "Updated owned event details",
    contentHash: hashB,
    rightsStatus: "unknown",
    moderationStatus: "pending",
    status: "discovered",
    payload: {},
  })).item;
  assert.equal(refreshed.id, source.id);
  assert.deepEqual([refreshed.status, refreshed.rightsStatus, refreshed.moderationStatus],
    ["discovered", "unknown", "pending"]);
  await assert.rejects(service.review(scopeA, scopeA.ownerUserId, source.id, {
    decision: "approve", expectedContentHash: hashA, idempotencyKey: "review-a", rightsStatus: "owned",
  }), (error: unknown) => error instanceof SourceEligibilityReviewError && error.code === "SOURCE_REFRESHED");
  const current = await service.review(scopeA, scopeA.ownerUserId, source.id, {
    decision: "approve", expectedContentHash: hashB, idempotencyKey: "review-b", rightsStatus: "licensed",
  });
  assert.deepEqual([current.source.status, current.source.rightsStatus, current.source.moderationStatus],
    ["accepted", "licensed", "approved"]);
});

test("content refresh cannot reopen an explicitly rejected source identity", async () => {
  const repository = new InMemorySourceRepository();
  const source = await seed(repository);
  const service = new SourceEligibilityReviewService(repository);
  await service.review(scopeA, scopeA.ownerUserId, source.id, {
    decision: "reject", expectedContentHash: hashA, idempotencyKey: "reject-a", reasonCode: "moderation_rejected",
  });
  const refreshed = (await repository.upsertByContentHash(scopeA, {
    adapterKey: "kong-owned-catalog",
    providerExternalId: "event-1",
    category: "events",
    canonicalUrl: "https://kong.example/events/1",
    title: "Kong weekend changed after rejection",
    content: "Changed content remains blocked",
    contentHash: hashB,
    rightsStatus: "unknown",
    moderationStatus: "pending",
    status: "discovered",
    payload: {},
  })).item;
  assert.equal(refreshed.contentHash, hashB);
  assert.deepEqual([refreshed.status, refreshed.rightsStatus, refreshed.moderationStatus],
    ["rejected", "rejected", "rejected"]);
  await assert.rejects(service.review(scopeA, scopeA.ownerUserId, refreshed.id, {
    decision: "approve", expectedContentHash: hashB, idempotencyKey: "approve-after-reject", rightsStatus: "owned",
  }), (error: unknown) => error instanceof SourceEligibilityReviewError && error.code === "REVIEW_CONFLICT");
});
