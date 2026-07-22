import assert from "node:assert/strict";
import test from "node:test";

import {
  sourceAutomationSyncRequestSchema,
  sourceAutomationSyncResponseSchema,
} from "../shared/ai-media-studio-operations";

const capturedAt = "2026-07-22T12:00:00.000Z";

function response() {
  return {
    adapterKey: "owned-library.v1",
    capturedAt,
    truncated: false,
    createdCount: 1,
    duplicateCount: 0,
    items: [{
      id: "source-item-1",
      category: "events" as const,
      status: "discovered" as const,
      rightsStatus: "unknown" as const,
      moderationStatus: "pending" as const,
      createdAt: capturedAt,
      updatedAt: capturedAt,
    }],
    downstreamState: "blocked" as const,
    effects: {
      sourceAdapterCalled: true as const,
      scriptsGenerated: false as const,
      renderQueued: false as const,
      outboxCreated: false as const,
      videoProviderCalled: false as const,
      secretResolved: false as const,
      spendCommitted: false as const,
      publishingCreated: false as const,
      migrationApplied: false as const,
      deploymentPerformed: false as const,
    },
  };
}

test("source automation sync request selects only a stable server-owned adapter and bounded limit", () => {
  assert.deepEqual(sourceAutomationSyncRequestSchema.parse({ adapterKey: "owned-library.v1" }), {
    adapterKey: "owned-library.v1",
    limit: 25,
  });
  assert.equal(sourceAutomationSyncRequestSchema.parse({ adapterKey: "feed_1", limit: 1 }).limit, 1);
  assert.equal(sourceAutomationSyncRequestSchema.parse({ adapterKey: "feed-100", limit: 100 }).limit, 100);

  for (const limit of [0, 101, 1.5, "25"]) {
    assert.equal(sourceAutomationSyncRequestSchema.safeParse({ adapterKey: "feed", limit }).success, false);
  }
  for (const adapterKey of ["", " provider", "provider/native", "x".repeat(129)]) {
    assert.equal(sourceAutomationSyncRequestSchema.safeParse({ adapterKey, limit: 25 }).success, false);
  }
});

test("source automation sync request rejects unknown and browser-controlled progress fields", () => {
  for (const [field, value] of [
    ["cursor", "provider-cursor"],
    ["nextCursor", "provider-next-cursor"],
    ["idempotencyKey", "unused-key"],
    ["providerExternalId", "native-id"],
    ["apiKey", "secret"],
  ] as const) {
    assert.equal(sourceAutomationSyncRequestSchema.safeParse({ adapterKey: "feed", limit: 25, [field]: value }).success, false);
  }
});

test("source automation sync response exposes only redacted Studio-owned item fields", () => {
  const parsed = sourceAutomationSyncResponseSchema.parse(response());
  assert.deepEqual(Object.keys(parsed.items[0]).sort(), [
    "category",
    "createdAt",
    "id",
    "moderationStatus",
    "rightsStatus",
    "status",
    "updatedAt",
  ]);
  assert.equal(parsed.downstreamState, "blocked");
  assert.equal(parsed.effects.sourceAdapterCalled, true);
  assert.ok(Object.entries(parsed.effects).every(([name, effect]) => name === "sourceAdapterCalled" ? effect === true : effect === false));
  assert.doesNotMatch(JSON.stringify(parsed.items), /providerExternalId|canonicalUrl|content|payload|contentHash|nativeId|cursor|secret/iu);
});

test("source automation sync response rejects unknown fields and provider data leaks at every boundary", () => {
  for (const [field, value] of [
    ["cursor", "private-cursor"],
    ["nextCursor", "private-next-cursor"],
    ["providerAccountId", "native-account"],
    ["payload", { raw: true }],
  ] as const) {
    assert.equal(sourceAutomationSyncResponseSchema.safeParse({ ...response(), [field]: value }).success, false);
  }

  for (const field of ["providerExternalId", "content", "payload", "canonicalUrl", "contentHash", "nativeId"] as const) {
    const candidate = response();
    candidate.items = [{ ...candidate.items[0], [field]: "must-not-leak" }] as typeof candidate.items;
    assert.equal(sourceAutomationSyncResponseSchema.safeParse(candidate).success, false);
  }
});

test("source automation sync response enforces counts, item bounds, and no-side-effect literals", () => {
  assert.equal(sourceAutomationSyncResponseSchema.safeParse({ ...response(), createdCount: -1 }).success, false);
  assert.equal(sourceAutomationSyncResponseSchema.safeParse({ ...response(), duplicateCount: 1 }).success, false);
  assert.equal(sourceAutomationSyncResponseSchema.safeParse({ ...response(), downstreamState: "ready" }).success, false);

  for (const effect of Object.keys(response().effects).filter((effect) => effect !== "sourceAdapterCalled") as Array<keyof ReturnType<typeof response>["effects"]>) {
    const candidate = response();
    candidate.effects = { ...candidate.effects, [effect]: true } as typeof candidate.effects;
    assert.equal(sourceAutomationSyncResponseSchema.safeParse(candidate).success, false);
  }
  assert.equal(sourceAutomationSyncResponseSchema.safeParse({
    ...response(),
    effects: { ...response().effects, sourceAdapterCalled: false },
  }).success, false);

  const item = response().items[0];
  const tooManyItems = Array.from({ length: 101 }, (_, index) => ({ ...item, id: `source-${index}` }));
  assert.equal(sourceAutomationSyncResponseSchema.safeParse({
    ...response(),
    createdCount: tooManyItems.length,
    items: tooManyItems,
  }).success, false);
});
