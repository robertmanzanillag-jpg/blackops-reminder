import assert from "node:assert/strict";
import test from "node:test";
import { aiMediaSourceItems } from "../shared/models/ai-media-studio-db";
import type { TenantScope } from "../server/ai-media-studio/core/resource-domain";
import {
  DrizzleSourceRepository,
  FakeSourceAdapter,
  InMemorySourceRepository,
  MAX_SOURCE_SNAPSHOT_ITEMS,
  SOURCE_CATEGORIES,
  SourceCursorError,
  ingestSourceSnapshot,
  sourceContentHash,
  type SourceAdapter,
  type SourceAdapterItem,
} from "../server/ai-media-studio/sources";

const tenantA = { ownerUserId: "owner-a", workspaceId: "workspace-a" } as const;
const tenantB = { ownerUserId: "owner-b", workspaceId: "workspace-b" } as const;

class SourceFakeQuery implements PromiseLike<unknown[]> {
  valuesInput?: Record<string, unknown>;
  limitInput?: number;
  constructor(private readonly result: unknown[]) {}
  from(_table: unknown): this { return this; }
  values(value: Record<string, unknown>): this { this.valuesInput = value; return this; }
  where(_value: unknown): this { return this; }
  limit(value: number): this { this.limitInput = value; return this; }
  orderBy(..._value: unknown[]): this { return this; }
  onConflictDoNothing(_value?: unknown): this { return this; }
  returning(): Promise<unknown[]> { return Promise.resolve(this.result); }
  then<TResult1 = unknown[], TResult2 = never>(
    onfulfilled?: ((value: unknown[]) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> { return Promise.resolve(this.result).then(onfulfilled, onrejected); }
}

class SourceFakeDb {
  inserted?: SourceFakeQuery;
  select(): SourceFakeQuery { return new SourceFakeQuery([]); }
  insert(_table: unknown): SourceFakeQuery {
    this.inserted = new SourceFakeQuery([this.createdRow]);
    return this.inserted;
  }
  execute(_query: unknown): Promise<unknown[]> { return Promise.resolve([]); }
  transaction<T>(callback: (tx: SourceFakeDb) => Promise<T>): Promise<T> { return callback(this); }
  private readonly createdRow: typeof aiMediaSourceItems.$inferSelect = {
    id: "10000000-0000-4000-8000-000000000001",
    ownerUserId: tenantA.ownerUserId,
    workspaceId: tenantA.workspaceId,
    sourceType: "events",
    externalId: "fake-a:native-1",
    canonicalUrl: null,
    title: "Festival",
    content: "Music",
    contentHash: `sha256:${"c".repeat(64)}`,
    rightsStatus: "unknown",
    moderationStatus: "pending",
    moderationEvidence: {},
    automationEvidence: {},
    status: "discovered",
    sourcePublishedAt: null,
    payload: { adapterKey: "fake-a", providerExternalId: "native-1", data: {} },
    createdAt: new Date("2026-07-20T12:00:00.000Z"),
    updatedAt: new Date("2026-07-20T12:00:00.000Z"),
  };
}

test("provider-neutral adapters cover every supported discovery category", async () => {
  const items: SourceAdapterItem[] = SOURCE_CATEGORIES.map((category, index) => ({
    providerExternalId: `provider-${index}`,
    category,
    canonicalUrl: `https://example.test/${category}/${index}`,
    title: `${category} title`,
    content: `${category} description`,
  }));
  const result = await ingestSourceSnapshot(
    tenantA,
    new FakeSourceAdapter("fake-discovery", items, SOURCE_CATEGORIES),
    new InMemorySourceRepository(),
    { limit: SOURCE_CATEGORIES.length },
  );
  assert.deepEqual(result.items.map((item) => item.category), SOURCE_CATEGORIES);
  assert.equal(result.createdCount, SOURCE_CATEGORIES.length);
});

test("content hashing is deterministic while durable source identities remain distinct", async () => {
  const first: SourceAdapterItem = {
    providerExternalId: "native-1",
    category: "events",
    title: "  Summer   Festival ",
    content: "Music and food",
    fingerprint: { startsAt: "2026-08-01T20:00:00Z", venue: "Pier 4" },
  };
  const duplicate = { ...first, providerExternalId: "native-2", title: "Summer Festival" };
  assert.equal(sourceContentHash(first), sourceContentHash(duplicate));

  const repository = new InMemorySourceRepository();
  const adapter = new FakeSourceAdapter("fake-a", [first, duplicate]);
  const result = await ingestSourceSnapshot(tenantA, adapter, repository, { limit: 10 });
  assert.equal(result.createdCount, 2);
  assert.equal(result.duplicateCount, 0);
  assert.notEqual(result.items[0]!.id, result.items[1]!.id);
  assert.equal(result.items[0]!.contentHash, result.items[1]!.contentHash);
  assert.equal((await repository.list(tenantA)).length, 2);

  const replay = await ingestSourceSnapshot(tenantA, new FakeSourceAdapter("fake-a", [first]), repository, { limit: 1 });
  assert.equal(replay.createdCount, 0);
  assert.equal(replay.items[0]!.id, result.items[0]!.id);

  const changed = await ingestSourceSnapshot(
    tenantA,
    new FakeSourceAdapter("fake-a", [{ ...first, content: "Updated music, art, and food" }]),
    repository,
    { limit: 1 },
  );
  assert.equal(changed.createdCount, 0);
  assert.equal(changed.items[0]!.id, result.items[0]!.id);
  assert.notEqual(changed.items[0]!.contentHash, result.items[0]!.contentHash);

  const otherTenant = await ingestSourceSnapshot(tenantB, adapter, repository, { limit: 1 });
  assert.equal(otherTenant.createdCount, 1);
  assert.notEqual(otherTenant.items[0]!.id, result.items[0]!.id);
  assert.equal(await repository.get(tenantB, result.items[0]!.id), undefined);
});

test("snapshot ingestion clamps requests and truncates a nonconforming adapter response", async () => {
  let receivedLimit = 0;
  const overproducingAdapter: SourceAdapter = {
    key: "fake-overproducer",
    categories: ["deals"],
    async fetchSnapshot(_scope: TenantScope, request) {
      receivedLimit = request.limit;
      return {
        capturedAt: "2026-07-20T12:00:00.000Z",
        items: Array.from({ length: request.limit + 5 }, (_, index) => ({
          providerExternalId: `deal-${index}`,
          category: "deals" as const,
          title: `Deal ${index}`,
          content: `Save ${index} percent`,
        })),
      };
    },
  };
  const result = await ingestSourceSnapshot(tenantA, overproducingAdapter, new InMemorySourceRepository(), { limit: 10_000 });
  assert.equal(receivedLimit, MAX_SOURCE_SNAPSHOT_ITEMS);
  assert.equal(result.items.length, MAX_SOURCE_SNAPSHOT_ITEMS);
  assert.equal(result.truncated, true);
});

test("adapter category violations are rejected before persistence", async () => {
  const repository = new InMemorySourceRepository();
  const adapter = new FakeSourceAdapter("events-only", [{ providerExternalId: "x", category: "hotels", title: "Hotel" }], ["events"]);
  await assert.rejects(() => ingestSourceSnapshot(tenantA, adapter, repository), /unsupported category/);
  assert.deepEqual(await repository.list(tenantA), []);
});

test("Drizzle source persistence keeps identity and evidence in dedicated PR3 columns", async () => {
  const db = new SourceFakeDb();
  const hash = `sha256:${"c".repeat(64)}` as const;
  await new DrizzleSourceRepository(db as never).upsertByContentHash(tenantA, {
    adapterKey: "fake-a",
    providerExternalId: "native-1",
    category: "events",
    title: "Festival",
    content: "Music",
    contentHash: hash,
    rightsStatus: "unknown",
    moderationStatus: "pending",
    status: "discovered",
    payload: {},
  });
  assert.ok(db.inserted?.valuesInput);
  assert.equal(db.inserted.valuesInput.sourceType, "events");
  assert.equal(db.inserted.valuesInput.externalId, "fake-a:native-1");
  assert.equal(db.inserted.valuesInput.contentHash, hash);
  assert.equal(db.inserted.valuesInput.moderationStatus, "pending");
  assert.deepEqual(db.inserted.valuesInput.payload, { adapterKey: "fake-a", providerExternalId: "native-1", data: {} });
});

test("source pagination filters the complete tenant result before limiting beyond 100 rows", async () => {
  const repository = new InMemorySourceRepository();
  for (let index = 0; index < 130; index += 1) {
    const selected = index >= 110;
    await repository.upsertByContentHash(tenantA, {
      adapterKey: "pagination-fixture",
      providerExternalId: `native-${index}`,
      category: selected ? "deals" : "events",
      title: `Source ${index}`,
      content: `Content ${index}`,
      contentHash: `sha256:${index.toString(16).padStart(64, "0")}`,
      rightsStatus: selected ? "owned" : "unknown",
      moderationStatus: "pending",
      status: selected ? "accepted" : "discovered",
      payload: {},
    });
  }

  const seen: string[] = [];
  let cursor: string | undefined;
  do {
    const page = await repository.listPage(tenantA, {
      category: "deals",
      status: "accepted",
      rightsStatus: "owned",
      limit: 7,
      ...(cursor ? { cursor } : {}),
    });
    seen.push(...page.items.map((item) => item.id));
    if (page.nextCursor) {
      assert.equal(Buffer.from(page.nextCursor, "base64url").toString("utf8").includes("native-"), false);
    }
    cursor = page.nextCursor ?? undefined;
    assert.equal(page.hasMore, page.nextCursor !== null);
  } while (cursor);

  assert.equal(seen.length, 20);
  assert.equal(new Set(seen).size, 20);
});

test("source cursors are bound to tenant and filters and reject tampering", async () => {
  const repository = new InMemorySourceRepository();
  for (let index = 0; index < 3; index += 1) {
    await repository.upsertByContentHash(tenantA, {
      adapterKey: "cursor-fixture",
      providerExternalId: `provider-secret-${index}`,
      category: "events",
      title: `Event ${index}`,
      contentHash: `sha256:${(index + 200).toString(16).padStart(64, "0")}`,
      rightsStatus: "unknown",
      moderationStatus: "pending",
      status: "discovered",
      payload: {},
    });
  }
  const first = await repository.listPage(tenantA, { category: "events", limit: 1 });
  assert.ok(first.nextCursor);
  assert.ok(first.nextCursor.length <= 128);
  assert.match(first.nextCursor, /^[A-Za-z0-9_-]+$/);
  assert.equal(first.nextCursor.includes("provider-secret"), false);

  await assert.rejects(
    () => repository.listPage(tenantB, { category: "events", limit: 1, cursor: first.nextCursor! }),
    SourceCursorError,
  );
  await assert.rejects(
    () => repository.listPage(tenantA, { category: "deals", limit: 1, cursor: first.nextCursor! }),
    SourceCursorError,
  );
  const last = first.nextCursor!.at(-1)!;
  const forged = `${first.nextCursor!.slice(0, -1)}${last === "A" ? "B" : "A"}`;
  await assert.rejects(
    () => repository.listPage(tenantA, { category: "events", limit: 1, cursor: forged }),
    SourceCursorError,
  );
});

test("Drizzle source pages request one lookahead row", async () => {
  const db = new SourceFakeDb();
  const query = new SourceFakeQuery([]);
  db.select = () => query;
  const page = await new DrizzleSourceRepository(db as never).listPage(tenantA, {
    category: "events",
    status: "discovered",
    rightsStatus: "unknown",
    limit: 17,
  });
  assert.equal(query.limitInput, 18);
  assert.deepEqual(page, { items: [], nextCursor: null, hasMore: false });
});
