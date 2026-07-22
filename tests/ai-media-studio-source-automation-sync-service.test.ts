import assert from "node:assert/strict";
import test from "node:test";
import { InMemorySourceRepository } from "../server/ai-media-studio/sources/in-memory-source-repository";
import {
  SourceAutomationSyncError,
  SourceAutomationSyncService,
} from "../server/ai-media-studio/sources/sync-service";
import type { SourceAdapter } from "../server/ai-media-studio/sources/contracts";
import { sourceAutomationSyncResponseSchema } from "../shared/ai-media-studio-operations";

const scopeA = { ownerUserId: "owner-a", workspaceId: "personal" } as const;
const scopeB = { ownerUserId: "owner-b", workspaceId: "personal" } as const;
const capturedAt = "2026-07-22T14:00:00.000Z";

function adapter(counter: { calls: number }, overrides: Partial<SourceAdapter> = {}): SourceAdapter {
  return {
    key: "kong-owned-catalog",
    categories: ["events", "restaurants"],
    async fetchSnapshot(scope, request) {
      counter.calls += 1;
      return {
        capturedAt,
        items: [{
          providerExternalId: `private-event-${scope.ownerUserId}`,
          category: "events",
          canonicalUrl: "https://kong.example/events/weekend",
          title: "Weekend guide",
          content: "Owned event details",
          payload: { privateProviderField: "must-not-leak" },
        }],
        ...(request.limit < 2 ? { nextCursor: "provider-private-cursor" } : {}),
      };
    },
    ...overrides,
  };
}

test("construction and adapter listing are inert, stable and server-owned", () => {
  const counter = { calls: 0 };
  const service = new SourceAutomationSyncService([adapter(counter)], new InMemorySourceRepository());
  assert.deepEqual(service.listAdapters(), [{
    adapterKey: "kong-owned-catalog",
    categories: ["events", "restaurants"],
  }]);
  assert.equal(counter.calls, 0);
  assert.throws(() => new SourceAutomationSyncService([
    adapter(counter), adapter(counter),
  ], new InMemorySourceRepository()), (error: unknown) => error instanceof SourceAutomationSyncError
    && error.code === "INVALID_CONFIGURATION");
  assert.equal(counter.calls, 0);
});

test("sync calls only the selected source adapter and returns a strict redacted blocked projection", async () => {
  const counter = { calls: 0 };
  const repository = new InMemorySourceRepository();
  const service = new SourceAutomationSyncService([adapter(counter)], repository);
  const result = sourceAutomationSyncResponseSchema.parse(await service.sync(scopeA, {
    adapterKey: "kong-owned-catalog",
    limit: 25,
  }));
  assert.equal(counter.calls, 1);
  assert.equal(result.createdCount, 1);
  assert.equal(result.duplicateCount, 0);
  assert.equal(result.downstreamState, "blocked");
  assert.deepEqual(result.effects, {
    sourceAdapterCalled: true,
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
  const serialized = JSON.stringify(result);
  assert.doesNotMatch(serialized, /private-event|privateProviderField|provider-private-cursor|kong\.example|Owned event details/u);
  assert.equal((await repository.list(scopeA)).length, 1);
});

test("replay deduplicates per tenant while the same source remains isolated across tenants", async () => {
  const counter = { calls: 0 };
  const repository = new InMemorySourceRepository();
  const service = new SourceAutomationSyncService([adapter(counter)], repository);
  const first = await service.sync(scopeA, { adapterKey: "kong-owned-catalog", limit: 25 });
  const replay = await service.sync(scopeA, { adapterKey: "kong-owned-catalog", limit: 25 });
  const otherTenant = await service.sync(scopeB, { adapterKey: "kong-owned-catalog", limit: 25 });
  assert.deepEqual([first.createdCount, replay.createdCount, replay.duplicateCount, otherTenant.createdCount], [1, 0, 1, 1]);
  assert.equal((await repository.list(scopeA)).length, 1);
  assert.equal((await repository.list(scopeB)).length, 1);
  assert.notEqual(first.items[0]?.id, otherTenant.items[0]?.id);
});

test("unknown adapters and invalid requests fail before adapter or repository I/O", async () => {
  const counter = { calls: 0 };
  const repository = new InMemorySourceRepository();
  const service = new SourceAutomationSyncService([adapter(counter)], repository);
  await assert.rejects(service.sync(scopeA, { adapterKey: "unknown", limit: 25 }),
    (error: unknown) => error instanceof SourceAutomationSyncError && error.code === "ADAPTER_UNAVAILABLE");
  await assert.rejects(service.sync(scopeA, { adapterKey: "kong-owned-catalog", limit: 101 }),
    (error: unknown) => error instanceof SourceAutomationSyncError && error.code === "INVALID_REQUEST");
  assert.equal(counter.calls, 0);
  assert.deepEqual(await repository.list(scopeA), []);
});

test("a malformed snapshot is rejected in full before any item persists", async () => {
  const counter = { calls: 0 };
  const repository = new InMemorySourceRepository();
  const malformed = adapter(counter, {
    async fetchSnapshot() {
      counter.calls += 1;
      return {
        capturedAt,
        items: [
          { providerExternalId: "valid-first", category: "events", title: "Valid first" },
          { providerExternalId: "invalid-second", category: "hotels", title: "Wrong category" },
        ],
      };
    },
  });
  const service = new SourceAutomationSyncService([malformed], repository);
  await assert.rejects(service.sync(scopeA, { adapterKey: malformed.key, limit: 25 }),
    (error: unknown) => error instanceof SourceAutomationSyncError && error.code === "ADAPTER_UNAVAILABLE");
  assert.equal(counter.calls, 1);
  assert.deepEqual(await repository.list(scopeA), []);
});

test("adapter and repository failures are normalized without preserving private error messages", async () => {
  const counter = { calls: 0 };
  const sensitive = adapter(counter, {
    async fetchSnapshot() {
      counter.calls += 1;
      throw new Error("private-token-value https://private.example/path");
    },
  });
  const service = new SourceAutomationSyncService([sensitive], new InMemorySourceRepository());
  const adapterFailure = await service.sync(scopeA, { adapterKey: sensitive.key, limit: 25 })
    .then(() => undefined, (error: unknown) => error);
  assert.ok(adapterFailure instanceof SourceAutomationSyncError);
  assert.equal(adapterFailure.code, "ADAPTER_UNAVAILABLE");
  assert.doesNotMatch(adapterFailure.message, /private-token|private\.example/u);

  const repositoryFailure = new SourceAutomationSyncService([adapter({ calls: 0 })], {
    async upsertByContentHash() { throw new Error("postgres-private-connection-detail"); },
    async get() { return undefined; },
    async list() { return []; },
    async listPage() { return { items: [], nextCursor: null, hasMore: false }; },
  });
  const storageFailure = await repositoryFailure.sync(scopeA, { adapterKey: "kong-owned-catalog", limit: 25 })
    .then(() => undefined, (error: unknown) => error);
  assert.ok(storageFailure instanceof SourceAutomationSyncError);
  assert.equal(storageFailure.code, "SYNC_UNAVAILABLE");
  assert.doesNotMatch(storageFailure.message, /postgres-private/u);
});

test("impossible dates and invalid runtime field types fail before all persistence", async () => {
  for (const item of [
    { providerExternalId: "bad-type", category: "events" as const, title: 42 as unknown as string },
    { providerExternalId: "bad-content", category: "events" as const, content: { private: true } as unknown as string },
  ]) {
    const repository = new InMemorySourceRepository();
    const service = new SourceAutomationSyncService([adapter({ calls: 0 }, {
      async fetchSnapshot() { return { capturedAt, items: [item] }; },
    })], repository);
    await assert.rejects(service.sync(scopeA, { adapterKey: "kong-owned-catalog", limit: 25 }),
      (error: unknown) => error instanceof SourceAutomationSyncError && error.code === "ADAPTER_UNAVAILABLE");
    assert.deepEqual(await repository.list(scopeA), []);
  }

  const repository = new InMemorySourceRepository();
  const service = new SourceAutomationSyncService([adapter({ calls: 0 }, {
    async fetchSnapshot() {
      return { capturedAt: "2026-02-31T14:00:00.000Z", items: [{
        providerExternalId: "impossible-date", category: "events", title: "Impossible date",
      }] };
    },
  })], repository);
  await assert.rejects(service.sync(scopeA, { adapterKey: "kong-owned-catalog", limit: 25 }),
    (error: unknown) => error instanceof SourceAutomationSyncError && error.code === "ADAPTER_UNAVAILABLE");
  assert.deepEqual(await repository.list(scopeA), []);
});

test("adapter configuration and snapshots are copied before use", async () => {
  const counter = { calls: 0 };
  let titleReads = 0;
  const mutableItem = {
    providerExternalId: "stable-id",
    category: "events" as const,
  } as { providerExternalId: string; category: "events"; title?: string };
  Object.defineProperty(mutableItem, "title", {
    enumerable: true,
    get() {
      titleReads += 1;
      return titleReads === 1 ? "Stable title" : "private-mutated-title";
    },
  });
  const mutableAdapter = adapter(counter, {
    async fetchSnapshot() {
      counter.calls += 1;
      return { capturedAt, items: [mutableItem] };
    },
  });
  const repository = new InMemorySourceRepository();
  const service = new SourceAutomationSyncService([mutableAdapter], repository);
  (mutableAdapter as { key: string }).key = "mutated-key";
  (mutableAdapter.categories as Array<string>).push("hotels");

  const result = await service.sync(scopeA, { adapterKey: "kong-owned-catalog", limit: 25 });
  assert.equal(result.createdCount, 1);
  assert.equal(titleReads, 1);
  const stored = await repository.list(scopeA);
  assert.equal(stored[0]?.title, "Stable title");
  assert.equal(stored[0]?.adapterKey, "kong-owned-catalog");
});
