import assert from "node:assert/strict";
import test from "node:test";
import { PgDialect } from "drizzle-orm/pg-core";
import {
  AnalyticsService,
  AnalyticsValidationError,
  DrizzleAnalyticsRepository,
  FakeAnalyticsIngestionAdapter,
  InMemoryAnalyticsRepository,
  mapAnalyticsEventRow,
  mapAnalyticsPublicationRow,
  mapAnalyticsSnapshotRow,
  normalizeMetrics,
  type AnalyticsIngestionBatch,
} from "../server/ai-media-studio/analytics";

const scopeA = { ownerUserId: "owner-a", workspaceId: "workspace-a" } as const;
const scopeB = { ownerUserId: "owner-a", workspaceId: "workspace-b" } as const;
const instant = "2026-07-20T12:00:00.000Z";

function ids() {
  let next = 0;
  return () => `00000000-0000-4000-8000-${String(++next).padStart(12, "0")}`;
}

function batch(overrides: Partial<AnalyticsIngestionBatch> = {}): AnalyticsIngestionBatch {
  return {
    source: "fake-social",
    publications: [{
      providerPublicationId: "raw-platform-publication-123",
      videoId: "10000000-0000-4000-8000-000000000001",
      platform: "tiktok",
      status: "published",
      permalink: "https://social.example/videos/public",
      publishedAt: "2026-07-20T10:00:00Z",
      dimensions: { avatar: "ava-b", hook: "question", cta: "follow", postingTime: "10:00", category: "travel" },
      generationCost: { amount: 20, currency: "usd" },
    }],
    snapshots: [{
      providerPublicationId: "raw-platform-publication-123",
      capturedAt: "2026-07-20T11:00:00Z",
      metrics: { views: 100, impressions: 200, likes: 10, comments: 4, shares: 2, clicks: 20, watchTimeMs: 50_000, retentionRate: 0.6 },
    }],
    events: [{
      providerEventId: "raw-event-456",
      providerPublicationId: "raw-platform-publication-123",
      eventType: "view",
      occurredAt: "2026-07-20T11:30:00Z",
      dimensions: { region: "US" },
      metrics: { views: 1 },
    }],
    ...overrides,
  };
}

test("normalization derives CTR, preserves canonical metrics, and rejects unsafe math", () => {
  assert.deepEqual(normalizeMetrics({ impressions: 4, clicks: 1, watchTimeMs: 5, retentionRate: 0.5 }), {
    views: 0, impressions: 4, likes: 0, comments: 0, shares: 0, clicks: 1,
    ctr: 0.25, watchTimeMs: 5, retentionRate: 0.5,
  });
  assert.throws(() => normalizeMetrics({ clicks: 7 }), /clicks must not exceed impressions/);
  assert.throws(() => normalizeMetrics({ views: -1 }), AnalyticsValidationError);
  assert.throws(() => normalizeMetrics({ ctr: 1.01 }), /between 0 and 1/);
  assert.throws(() => normalizeMetrics({ views: Number.MAX_SAFE_INTEGER + 1 }), /safe integer/);
});

test("fake ingestion is no-network, tenant isolated, idempotent, and redacts provider identities", async () => {
  const repository = new InMemoryAnalyticsRepository();
  const service = new AnalyticsService(repository, { now: () => new Date(instant), idFactory: ids() });
  const adapter = new FakeAnalyticsIngestionAdapter(batch());
  assert.deepEqual(await service.ingest(scopeA, adapter), { publicationsCreated: 1, snapshotsCreated: 1, eventsCreated: 1 });
  assert.deepEqual(await service.ingest(scopeA, adapter), { publicationsCreated: 0, snapshotsCreated: 0, eventsCreated: 0 });
  assert.deepEqual(await service.ingest(scopeB, adapter), { publicationsCreated: 1, snapshotsCreated: 1, eventsCreated: 1 });
  assert.equal(adapter.calls.length, 3);

  const publicationsA = await service.listPublications(scopeA);
  const publicationsB = await service.listPublications(scopeB);
  assert.equal(publicationsA.items.length, 1);
  assert.equal(publicationsB.items.length, 1);
  assert.notEqual(publicationsA.items[0].id, publicationsB.items[0].id);
  assert.equal((await service.listSnapshots(scopeA)).items.length, 1);
  assert.equal((await service.listSnapshots({ ownerUserId: "intruder", workspaceId: scopeA.workspaceId })).items.length, 0);
  const serialized = JSON.stringify({ publicationsA, events: await service.listEvents(scopeA) });
  assert.doesNotMatch(serialized, /raw-platform-publication-123|raw-event-456/);
  assert.doesNotMatch(serialized, /externalIdentity|externalEvent|providerPublicationId|providerEventId/);
});

test("ingestion rejects secret-like dimensions and cross-batch publication references", async () => {
  const service = new AnalyticsService(new InMemoryAnalyticsRepository(), { idFactory: ids() });
  await assert.rejects(() => service.ingest(scopeA, new FakeAnalyticsIngestionAdapter(batch({
    events: [{ providerEventId: "e", eventType: "click", occurredAt: instant, dimensions: { apiToken: "secret" } }],
  }))), /forbidden sensitive field/);
  await assert.rejects(() => service.ingest(scopeA, new FakeAnalyticsIngestionAdapter(batch({
    snapshots: [{ providerPublicationId: "missing", capturedAt: instant, metrics: {} }],
  }))), /absent from this ingestion batch/);
  await assert.rejects(() => service.ingest(scopeA, new FakeAnalyticsIngestionAdapter(batch({
    publications: [{ providerPublicationId: "missing-media", platform: "facebook" }],
    snapshots: [],
    events: [],
  }))), /requires videoId or mediaAssetId/);
});

test("publication ingestion accepts an asset-only media reference and filters by it", async () => {
  const service = new AnalyticsService(new InMemoryAnalyticsRepository(), { idFactory: ids() });
  await service.ingest(scopeA, new FakeAnalyticsIngestionAdapter(batch({
    publications: [{
      providerPublicationId: "asset-only",
      videoId: null,
      mediaAssetId: "asset-1",
      platform: "facebook",
      publishedAt: "2026-07-20T10:00:00Z",
    }],
    snapshots: [],
    events: [],
  })));
  const result = await service.listPublications(scopeA, { mediaAssetId: "asset-1" });
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].videoId, null);
  assert.equal(result.items[0].mediaAssetId, "asset-1");
});

test("summary uses latest cumulative snapshot, explicit currency/window rules, and deterministic attribution", async () => {
  const service = new AnalyticsService(new InMemoryAnalyticsRepository(), { now: () => new Date(instant), idFactory: ids() });
  await service.ingest(scopeA, new FakeAnalyticsIngestionAdapter(batch({
    publications: [
      ...batch().publications,
      { providerPublicationId: "p-zero", videoId: "video-zero", platform: "tiktok", publishedAt: "2026-07-20T10:30:00Z",
        dimensions: { avatar: "ava-a", hook: "question", cta: "buy", postingTime: "10:00", category: "travel" }, generationCost: { amount: 10, currency: "USD" } },
      { providerPublicationId: "p-eur", videoId: "video-eur", platform: "instagram", publishedAt: "2026-07-20T10:45:00Z",
        dimensions: { avatar: "ava-c", category: "food" }, generationCost: { amount: 99, currency: "EUR" } },
    ],
    snapshots: [
      { providerPublicationId: "raw-platform-publication-123", capturedAt: "2026-07-20T10:15:00Z", metrics: { views: 50, impressions: 100, clicks: 10, retentionRate: 0.4 } },
      { providerPublicationId: "raw-platform-publication-123", capturedAt: "2026-07-20T11:15:00Z", metrics: { views: 100, impressions: 200, clicks: 20, likes: 10, retentionRate: 0.6 } },
      { providerPublicationId: "p-zero", capturedAt: "2026-07-20T11:00:00Z", metrics: { views: 0 } },
      { providerPublicationId: "p-eur", capturedAt: "2026-07-20T11:00:00Z", metrics: { views: 50, likes: 5 } },
    ],
    events: [],
  })));
  const result = await service.summarize(scopeA, { start: "2026-07-20T10:00:00Z", end: "2026-07-20T12:00:00Z", currency: "usd" });
  assert.equal(result.metrics.views, 150, "older cumulative snapshot must not be double-counted");
  assert.equal(result.metrics.ctr, 0.1);
  assert.deepEqual(result.totalCost, { amount: 30, currency: "USD" });
  assert.equal(result.costPerVideo, 15);
  assert.equal(result.costPerView, 0.3, "views from publications with a different currency are excluded from USD unit economics");
  assert.equal(result.excludedCurrencyCount, 1);
  assert.equal(result.publications.find((item) => item.publication.videoId === "video-zero")?.costPerView, null);
  assert.equal(result.zeroViewRule, "null_when_zero_views");
  assert.deepEqual(result.attribution.avatar.map((item) => [item.rank, item.value, item.metrics.views]), [[1, "ava-b", 100], [2, "ava-c", 50], [3, "ava-a", 0]]);
  assert.equal(result.attribution.hook[0].publicationCount, 2);
  await assert.rejects(() => service.summarize(scopeA, { start: instant, end: instant, currency: "USD" }), /must be before/);
});

test("pagination is bounded, filterable, stable, and rejects forged cursors", async () => {
  const service = new AnalyticsService(new InMemoryAnalyticsRepository(), { now: () => new Date(instant), idFactory: ids() });
  const publications = Array.from({ length: 3 }, (_, index) => ({
    providerPublicationId: `p-${index}`, videoId: `v-${index}`, platform: index === 2 ? "instagram" as const : "tiktok" as const,
    publishedAt: `2026-07-20T10:0${index}:00Z`, dimensions: { category: index === 0 ? "food" : "travel" },
  }));
  await service.ingest(scopeA, new FakeAnalyticsIngestionAdapter(batch({ publications, snapshots: [], events: [] })));
  const first = await service.listPublications(scopeA, {}, { limit: 2 });
  assert.equal(first.items.length, 2);
  assert.ok(first.nextCursor);
  const second = await service.listPublications(scopeA, {}, { limit: 2, cursor: first.nextCursor! });
  assert.equal(second.items.length, 1);
  assert.equal(new Set([...first.items, ...second.items].map((item) => item.id)).size, 3);
  assert.equal((await service.listPublications(scopeA, { platform: "instagram" })).items.length, 1);
  assert.equal((await service.listPublications(scopeA, { category: "travel" })).items.length, 2);
  assert.throws(() => service.listPublications(scopeA, {}, { limit: 101 }), /between 1 and 100/);
  await assert.rejects(() => service.listPublications(scopeA, {}, { cursor: "forged" }), /cursor is invalid/);
});

const publicationRow = {
  id: "20000000-0000-4000-8000-000000000001", ownerUserId: scopeA.ownerUserId, workspaceId: scopeA.workspaceId,
  publishingJobId: "30000000-0000-4000-8000-000000000001", videoId: "10000000-0000-4000-8000-000000000001",
  mediaAssetId: null,
  platform: "tiktok", externalPublicationId: "private-digest", status: "published", permalink: "https://social.example/p/1",
  publishedAt: new Date("2026-07-20T10:00:00Z"), metadata: { dimensions: { category: "travel" }, generationCost: { amount: 2, currency: "USD" } },
  createdAt: new Date(instant), updatedAt: new Date(instant),
};
const snapshotRow = {
  id: "40000000-0000-4000-8000-000000000001", ownerUserId: scopeA.ownerUserId, workspaceId: scopeA.workspaceId,
  publicationId: publicationRow.id, capturedAt: new Date(instant), views: 10, impressions: 20, likes: 1, comments: 2, shares: 3,
  platform: "tiktok", periodStart: null, periodEnd: null,
  watchTimeMs: 1000, metrics: { clicks: 4, ctr: 0.2, retentionRate: 0.5 }, createdAt: new Date(instant),
};
const eventRow = {
  id: "50000000-0000-4000-8000-000000000001", ownerUserId: scopeA.ownerUserId, workspaceId: scopeA.workspaceId,
  publicationId: publicationRow.id, source: "fake-social", externalEventId: "private-event-digest", eventType: "view",
  occurredAt: new Date(instant), dimensions: { region: "US", nested: { hidden: true } }, metrics: { views: 1 }, createdAt: new Date(instant),
};

type RecordEntry = { kind: string; values?: unknown; where?: unknown; conflictTarget?: string[] };
class FakeQuery implements PromiseLike<unknown[]> {
  readonly record: RecordEntry;
  constructor(private readonly db: FakeDb, kind: string, private readonly rows: unknown[]) { this.record = { kind }; db.records.push(this.record); }
  from(): this { return this; } innerJoin(): this { return this; } where(value: unknown): this { this.record.where = value; return this; }
  values(value: unknown): this { this.record.values = value; return this; } set(value: unknown): this { this.record.values = value; return this; }
  limit(): this { return this; } offset(): this { return this; } orderBy(): this { return this; }
  onConflictDoNothing(options?: { target?: unknown | unknown[] }): this {
    const targets = options?.target === undefined ? [] : Array.isArray(options.target) ? options.target : [options.target];
    this.record.conflictTarget = targets.map((target) => String((target as { name?: unknown }).name ?? ""));
    return this;
  }
  returning(): Promise<unknown[]> { return Promise.resolve(this.rows); }
  then<TResult1 = unknown[], TResult2 = never>(resolve?: ((value: unknown[]) => TResult1 | PromiseLike<TResult1>) | null, reject?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null) {
    return Promise.resolve(this.rows).then(resolve, reject);
  }
}
class FakeDb {
  readonly records: RecordEntry[] = [];
  constructor(private readonly results: unknown[][]) {}
  private next(kind: string) { return new FakeQuery(this, kind, this.results.shift() ?? []); }
  select(): FakeQuery { return this.next("select"); } insert(): FakeQuery { return this.next("insert"); } update(): FakeQuery { return this.next("update"); }
  transaction<T>(callback: (tx: FakeDb) => Promise<T>): Promise<T> { return callback(this); }
}

function sqlOf(value: unknown) { return new PgDialect().sqlToQuery(value as never); }

test("Drizzle mappings redact external identities and preserve normalized metrics", () => {
  const publication = mapAnalyticsPublicationRow(publicationRow);
  assert.equal(publication.dimensions.category, "travel");
  assert.equal("externalPublicationId" in publication, false);
  assert.equal("publishingJobId" in publication, false);
  assert.equal(mapAnalyticsSnapshotRow(snapshotRow).metrics.clicks, 4);
  const event = mapAnalyticsEventRow(eventRow);
  assert.equal(event.dimensions.region, "US");
  assert.equal("nested" in event.dimensions, false);
  assert.equal("externalEventId" in event, false);
  assert.throws(
    () => mapAnalyticsPublicationRow({ ...publicationRow, videoId: null, mediaAssetId: null }),
    /requires videoId or mediaAssetId/,
  );
});

test("Drizzle publication creation scopes lookup and persists only a digest as provider identity", async () => {
  const db = new FakeDb([[], [publicationRow]]);
  const repository = new DrizzleAnalyticsRepository(db as never, () => publicationRow.publishingJobId);
  const candidate = {
    ...mapAnalyticsPublicationRow(publicationRow), externalIdentityDigest: "a".repeat(64), ownerUserId: undefined, workspaceId: undefined,
  };
  delete (candidate as Partial<typeof candidate>).ownerUserId;
  delete (candidate as Partial<typeof candidate>).workspaceId;
  const result = await repository.upsertPublication(scopeA, candidate);
  assert.equal(result.created, true);
  const lookup = sqlOf(db.records[0].where);
  assert.match(lookup.sql, /owner_user_id/);
  assert.match(lookup.sql, /workspace_id/);
  assert.deepEqual(lookup.params, [scopeA.ownerUserId, scopeA.workspaceId, "tiktok", "a".repeat(64)]);
  const values = db.records[1].values as Record<string, unknown>;
  assert.equal(values.externalPublicationId, "a".repeat(64));
  assert.equal(JSON.stringify(values).includes("raw-platform"), false);
  assert.deepEqual(db.records[1].conflictTarget, ["owner_user_id", "workspace_id", "platform", "external_publication_id"]);

  const invalidDb = new FakeDb([]);
  const invalidRepository = new DrizzleAnalyticsRepository(invalidDb as never, () => publicationRow.publishingJobId);
  await assert.rejects(
    () => invalidRepository.upsertPublication(scopeA, { ...candidate, videoId: null, mediaAssetId: null }),
    /requires videoId or mediaAssetId/,
  );
  assert.equal(invalidDb.records.length, 0);
});

test("Drizzle snapshot insertion verifies publication tenant before writing", async () => {
  const rejected = new DrizzleAnalyticsRepository(new FakeDb([[]]) as never, () => publicationRow.publishingJobId);
  await assert.rejects(() => rejected.putSnapshot(scopeA, mapAnalyticsSnapshotRow(snapshotRow)), /not found in this tenant/);

  const db = new FakeDb([[{ id: publicationRow.id }], [snapshotRow]]);
  const repository = new DrizzleAnalyticsRepository(db as never, () => publicationRow.publishingJobId);
  await repository.putSnapshot(scopeA, mapAnalyticsSnapshotRow(snapshotRow));
  const tenantLookup = sqlOf(db.records[0].where);
  assert.match(tenantLookup.sql, /owner_user_id/);
  assert.match(tenantLookup.sql, /workspace_id/);
  const values = db.records[1].values as Record<string, unknown>;
  assert.equal((values.metrics as Record<string, unknown>).clicks, 4);
  assert.equal(values.ownerUserId, scopeA.ownerUserId);
  assert.equal(values.workspaceId, scopeA.workspaceId);
  assert.deepEqual(db.records[1].conflictTarget, ["owner_user_id", "workspace_id", "publication_id", "captured_at"]);
});

test("Drizzle event insertion uses the tenant-scoped attribution idempotency index", async () => {
  const db = new FakeDb([[{ id: publicationRow.id }], [eventRow]]);
  const repository = new DrizzleAnalyticsRepository(db as never, () => publicationRow.publishingJobId);
  const { ownerUserId: _owner, workspaceId: _workspace, ...event } = mapAnalyticsEventRow(eventRow);
  await repository.putEvent(scopeA, { ...event, externalEventDigest: "b".repeat(64) });
  const lookup = sqlOf(db.records[0].where);
  assert.match(lookup.sql, /owner_user_id/);
  assert.match(lookup.sql, /workspace_id/);
  assert.deepEqual(db.records[1].conflictTarget, ["owner_user_id", "workspace_id", "source", "external_event_id"]);
  const values = db.records[1].values as Record<string, unknown>;
  assert.equal(values.externalEventId, "b".repeat(64));
});
