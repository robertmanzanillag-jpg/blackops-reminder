import assert from "node:assert/strict";
import test from "node:test";
import {
  KONG_OWNED_SOURCE_ADAPTER_KEY,
  KongOwnedSourceAdapter,
  SOURCE_CATEGORIES,
  type KongSourceReader,
} from "../server/ai-media-studio/sources";

const scope = { ownerUserId: "owner-a", workspaceId: "personal" } as const;
const capturedAt = "2026-07-22T18:00:00.000Z";

test("Kong-owned adapter covers all eight categories through an injected no-I/O reader port", async () => {
  const seen: unknown[] = [];
  const reader: KongSourceReader = {
    async read(receivedScope, request) {
      seen.push(receivedScope, request);
      return {
        capturedAt,
        records: SOURCE_CATEGORIES.map((category, index) => ({
          id: `kong-${category}-${index}`,
          category,
          title: `${category} title`,
          summary: `${category} summary`,
          canonicalUrl: `https://kong.example/${category}/${index}`,
          publishedAt: capturedAt,
          fingerprint: { version: 1, category },
          attributes: { location: "Miami" },
        })),
      };
    },
  };
  const adapter = new KongOwnedSourceAdapter(reader);
  assert.equal(adapter.key, KONG_OWNED_SOURCE_ADAPTER_KEY);
  assert.deepEqual(adapter.categories, SOURCE_CATEGORIES);
  const snapshot = await adapter.fetchSnapshot(scope, { limit: 8, cursor: "server-cursor" });
  assert.equal(snapshot.capturedAt, capturedAt);
  assert.deepEqual(snapshot.items.map((item) => item.category), SOURCE_CATEGORIES);
  assert.deepEqual(seen, [scope, { limit: 8, cursor: "server-cursor" }]);
  assert.ok(Object.isFrozen(snapshot));
  assert.ok(Object.isFrozen(snapshot.items));
  assert.ok(snapshot.items.every(Object.isFrozen));
});

test("Kong-owned adapter bounds reader output and rejects invalid runtime data", async () => {
  const valid = {
    id: "kong-event-1",
    category: "events" as const,
    title: "Weekend event",
    summary: "Owned Kong event details",
  };
  for (const page of [
    { capturedAt: "2026-02-31T18:00:00.000Z", records: [valid] },
    { capturedAt, records: [{ ...valid, category: "customers" }] },
    { capturedAt, records: [{ ...valid, canonicalUrl: "http://private.example/event" }] },
    { capturedAt, records: [{ ...valid, title: 42 }] },
    { capturedAt, records: [{ ...valid, attributes: { huge: "x".repeat(20_000) } }] },
    { capturedAt, records: Array.from({ length: 4 }, (_, index) => ({ ...valid, id: `${valid.id}-${index}` })) },
  ]) {
    const adapter = new KongOwnedSourceAdapter({ async read() { return page as never; } });
    await assert.rejects(adapter.fetchSnapshot(scope, { limit: 2 }));
  }
});

test("Kong-owned adapter reads getter-backed fields once and returns detached metadata", async () => {
  let titleReads = 0;
  const record: Record<string, unknown> = {
    id: "kong-event-1",
    category: "events",
    summary: "Owned summary",
    attributes: { safe: "original" },
  };
  Object.defineProperty(record, "title", {
    enumerable: true,
    get() {
      titleReads += 1;
      return titleReads === 1 ? "Stable title" : "mutated title";
    },
  });
  const adapter = new KongOwnedSourceAdapter({
    async read() { return { capturedAt, records: [record as never] }; },
  });
  const snapshot = await adapter.fetchSnapshot(scope, { limit: 1 });
  (record.attributes as Record<string, string>).safe = "changed";
  assert.equal(titleReads, 1);
  assert.equal(snapshot.items[0]?.title, "Stable title");
  assert.deepEqual(snapshot.items[0]?.payload, { safe: "original" });
});

test("construction and invalid requests are inert and fail before reader I/O", async () => {
  let calls = 0;
  const reader: KongSourceReader = {
    async read() { calls += 1; return { capturedAt, records: [] }; },
  };
  const adapter = new KongOwnedSourceAdapter(reader);
  assert.equal(calls, 0);
  for (const input of [{ limit: 0 }, { limit: 101 }, { limit: 1, cursor: "x".repeat(2_049) }]) {
    await assert.rejects(adapter.fetchSnapshot(scope, input));
  }
  await assert.rejects(adapter.fetchSnapshot({ ownerUserId: "", workspaceId: "personal" }, { limit: 1 }));
  assert.equal(calls, 0);
});
