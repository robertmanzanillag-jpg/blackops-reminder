import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { InMemorySourceRepository } from "../server/ai-media-studio/sources/in-memory-source-repository";
import {
  SourceEligibilityReviewError,
  SourceEligibilityReviewService,
} from "../server/ai-media-studio/sources/eligibility-review-service";

const scopeA = { ownerUserId: "owner-a", workspaceId: "personal" } as const;
const scopeB = { ownerUserId: "owner-b", workspaceId: "personal" } as const;

function digest(value: string): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

async function seed(repository: InMemorySourceRepository) {
  const content = "Newly synced Kong event source.";
  return (await repository.upsertByContentHash(scopeA, {
    adapterKey: "kong-owned-catalog",
    providerExternalId: "private-event-id",
    category: "events",
    canonicalUrl: "https://kong.example/events/private",
    title: "Weekend guide",
    content,
    contentHash: digest(content),
    rightsStatus: "unknown",
    moderationStatus: "pending",
    status: "discovered",
    payload: { providerPrivate: "hidden" },
  })).item;
}

test("source eligibility approval is tenant-scoped, idempotent and keeps downstream work blocked", async () => {
  const repository = new InMemorySourceRepository();
  const source = await seed(repository);
  const service = new SourceEligibilityReviewService(repository);
  const request = {
    decision: "approve" as const,
    expectedContentHash: source.contentHash,
    idempotencyKey: "source-review-001",
    rightsStatus: "owned" as const,
  };
  const first = await service.review(scopeA, "owner-a", source.id, request);
  const replay = await service.review(scopeA, "owner-a", source.id, request);
  assert.equal(first.review.replayed, false);
  assert.equal(replay.review.replayed, true);
  assert.equal(first.source.status, "accepted");
  assert.equal(first.source.rightsStatus, "owned");
  assert.equal(first.source.moderationStatus, "approved");
  assert.equal(first.downstreamState, "eligible_for_script_batch");
  assert.equal(first.effects.scriptsGenerated, false);
  assert.equal(first.effects.videoProviderCalled, false);
  assert.equal((await repository.get(scopeA, source.id))?.status, "accepted");
  assert.equal(JSON.stringify(first).includes("private-event-id"), false);
});

test("source eligibility review rejects cross-tenant, stale and conflicting decisions", async () => {
  const repository = new InMemorySourceRepository();
  const source = await seed(repository);
  const service = new SourceEligibilityReviewService(repository);
  const request = {
    decision: "approve" as const,
    expectedContentHash: source.contentHash,
    idempotencyKey: "source-review-001",
    rightsStatus: "owned" as const,
  };
  await assert.rejects(service.review(scopeB, "owner-b", source.id, request),
    (error: unknown) => error instanceof SourceEligibilityReviewError && error.code === "NOT_FOUND");
  await assert.rejects(service.review(scopeA, "owner-a", source.id, { ...request, expectedContentHash: digest("changed") }),
    (error: unknown) => error instanceof SourceEligibilityReviewError && error.code === "SOURCE_REFRESHED");
  await service.review(scopeA, "owner-a", source.id, request);
  await assert.rejects(service.review(scopeA, "owner-a", source.id, { ...request, idempotencyKey: "source-review-002" }),
    (error: unknown) => error instanceof SourceEligibilityReviewError && error.code === "REVIEW_CONFLICT");
});

test("source eligibility review repository errors are normalized and redacted", async () => {
  const service = new SourceEligibilityReviewService({
    async reviewEligibility() {
      throw new Error("postgres-private-token https://private.example/source");
    },
  });
  const error = await service.review(scopeA, "owner-a", "source_abc123", {
    decision: "approve",
    expectedContentHash: `sha256:${"a".repeat(64)}`,
    idempotencyKey: "source-review-001",
    rightsStatus: "owned",
  }).then(() => undefined, (caught: unknown) => caught);
  assert.ok(error instanceof SourceEligibilityReviewError);
  assert.equal(error.code, "REVIEW_UNAVAILABLE");
  assert.doesNotMatch(error.message, /postgres-private-token|private\.example/u);
});
