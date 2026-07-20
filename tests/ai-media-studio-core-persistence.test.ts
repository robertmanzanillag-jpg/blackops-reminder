import assert from "node:assert/strict";
import test from "node:test";
import { PgDialect } from "drizzle-orm/pg-core";
import { MEDIA_ASSET_TYPES, type MediaAsset } from "../server/ai-media-studio/core/asset-domain";
import {
  DrizzleCanonicalResourceRepository,
  DrizzleInfluencerRepository,
  DrizzleMediaAssetRepository,
} from "../server/ai-media-studio/persistence/drizzle-core-repositories";
import {
  mapCanonicalResourceRow,
  mapInfluencerRow,
  mapMediaAssetRow,
  type AiMediaAssetRow,
  type AiMediaInfluencerRow,
  type AiMediaProviderResourceRow,
} from "../server/ai-media-studio/persistence/core-mapping";

const now = new Date("2026-07-20T12:00:00.000Z");
const later = new Date("2026-07-20T12:05:00.000Z");
const scope = { ownerUserId: "owner-a", workspaceId: "workspace-a" } as const;

const influencerRow: AiMediaInfluencerRow = {
  id: "10000000-0000-4000-8000-000000000001",
  ownerUserId: scope.ownerUserId,
  workspaceId: scope.workspaceId,
  name: "Sofía",
  slug: "sofia",
  status: "active",
  description: null,
  accent: "caribbean",
  language: "es",
  gender: "female",
  ageRange: { minimum: 24, maximum: 34 },
  personality: ["warm", "curious"],
  tone: ["confident"],
  speakingStyle: "Short, energetic sentences",
  categories: ["travel", "food"],
  intro: "Hola, mi gente",
  outro: "Nos vemos pronto",
  energyLevel: 8,
  facialExpressions: ["smile", "surprise"],
  brandColors: ["#FF5500", "#111111"],
  persona: { legacy: "must-not-be-used" },
  defaultVoiceResourceId: "20000000-0000-4000-8000-000000000001",
  defaultAvatarResourceId: "20000000-0000-4000-8000-000000000002",
  createdAt: now,
  updatedAt: later,
  archivedAt: null,
};

const resourceRow: AiMediaProviderResourceRow = {
  id: "20000000-0000-4000-8000-000000000002",
  ownerUserId: scope.ownerUserId,
  workspaceId: scope.workspaceId,
  providerAccountId: "30000000-0000-4000-8000-000000000001",
  providerKey: "heygen",
  resourceType: "avatar",
  canonicalKey: "avatar:sofia-primary",
  externalResourceId: "sensitive-provider-avatar-id",
  displayName: "Sofía Primary",
  status: "active",
  metadata: {
    language: "es",
    accent: "caribbean",
    gender: "female",
    previewUrl: "https://media.example/avatar.mp4",
    thumbnailUrl: "https://media.example/avatar.jpg",
  },
  synchronizedAt: later,
  createdAt: now,
  updatedAt: later,
};

const assetRow: AiMediaAssetRow = {
  id: "40000000-0000-4000-8000-000000000001",
  ownerUserId: scope.ownerUserId,
  workspaceId: scope.workspaceId,
  projectId: "50000000-0000-4000-8000-000000000001",
  renderJobId: "60000000-0000-4000-8000-000000000001",
  influencerId: influencerRow.id,
  providerResourceId: resourceRow.id,
  kind: "video",
  name: "launch.mp4",
  status: "ready",
  storageProvider: "private-object-store",
  storageKey: "media-assets/40000000-0000-4000-8000-000000000001",
  publicUrl: "https://delivery.kong.example/assets/launch.mp4",
  thumbnailUrl: "https://delivery.kong.example/assets/launch.jpg",
  mimeType: "video/mp4",
  byteSize: 4096,
  checksum: "a".repeat(64),
  width: 1080,
  height: 1920,
  durationMs: 12_000,
  metadata: {
    source: {
      kind: "remote",
      originalUrl: "https://origin.example/video.mp4",
      finalUrl: "https://cdn.example/video.mp4",
    },
    codec: "h264",
    frameRate: 30,
  },
  createdAt: now,
  updatedAt: later,
  deletedAt: null,
};

type QueryRecord = { kind: string; table?: unknown; values?: unknown; where?: unknown; limit?: number };

class FakeQuery implements PromiseLike<unknown[]> {
  private record: QueryRecord;

  constructor(
    private readonly db: FakeDb,
    kind: string,
    private readonly result: unknown[],
  ) {
    this.record = { kind };
    db.records.push(this.record);
  }

  from(table: unknown): this {
    this.record.table = table;
    return this;
  }

  values(values: unknown): this {
    this.record.values = values;
    return this;
  }

  set(values: unknown): this {
    this.record.values = values;
    return this;
  }

  where(where: unknown): this {
    this.record.where = where;
    return this;
  }

  onConflictDoNothing(): this {
    return this;
  }

  returning(): Promise<unknown[]> {
    return Promise.resolve(this.result);
  }

  limit(value: number): this {
    this.record.limit = value;
    return this;
  }

  orderBy(..._values: unknown[]): this {
    return this;
  }

  then<TResult1 = unknown[], TResult2 = never>(
    onfulfilled?: ((value: unknown[]) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    return Promise.resolve(this.result).then(onfulfilled, onrejected);
  }
}

class FakeDb {
  readonly records: QueryRecord[] = [];
  readonly executions: unknown[] = [];
  private readonly results: unknown[][];

  constructor(...results: unknown[][]) {
    this.results = [...results];
  }

  private next(kind: string): FakeQuery {
    return new FakeQuery(this, kind, this.results.shift() ?? []);
  }

  select(_projection?: unknown): FakeQuery {
    return this.next("select");
  }

  insert(table: unknown): FakeQuery {
    const query = this.next("insert");
    return query.from(table);
  }

  update(table: unknown): FakeQuery {
    const query = this.next("update");
    return query.from(table);
  }

  execute(query: unknown): Promise<unknown[]> {
    this.executions.push(query);
    return Promise.resolve([]);
  }

  transaction<T>(callback: (tx: FakeDb) => Promise<T>): Promise<T> {
    return callback(this);
  }
}

function renderedWhere(record: QueryRecord): { sql: string; params: unknown[] } {
  assert.ok(record.where, `expected a where clause for ${record.kind}`);
  return new PgDialect().sqlToQuery(record.where as never);
}

test("core row mappings materialize persona fields and redact provider identity", () => {
  const influencer = mapInfluencerRow(influencerRow);
  assert.deepEqual(influencer.ageRange, { minimum: 24, maximum: 34 });
  assert.deepEqual(influencer.personality, ["warm", "curious"]);
  assert.equal(influencer.avatarResourceId, resourceRow.id);
  assert.equal(influencer.createdAt, now.toISOString());
  assert.equal("persona" in influencer, false);

  const resource = mapCanonicalResourceRow(resourceRow);
  assert.equal(resource.id, resourceRow.id);
  assert.equal(resource.kind, "avatar");
  assert.equal(resource.previewUrl, "https://media.example/avatar.mp4");
  assert.equal("canonicalKey" in resource, false);
  assert.equal("externalResourceId" in resource, false);
  assert.equal("providerAccountId" in resource, false);
  assert.equal("providerKey" in resource, false);
  assert.equal("secretRef" in resource, false);
});

test("asset mapping supports all nine kinds and never materializes bytes", () => {
  assert.equal(MEDIA_ASSET_TYPES.length, 9);
  for (const type of MEDIA_ASSET_TYPES) {
    const asset = mapMediaAssetRow({ ...assetRow, kind: type });
    assert.equal(asset.type, type);
    assert.equal(asset.sizeBytes, 4096);
    assert.equal(asset.metadata.width, 1080);
    assert.equal(asset.metadata.codec, "h264");
    assert.equal(asset.workspaceId, scope.workspaceId);
    assert.equal(asset.status, "ready");
    assert.equal(asset.deliveryUrl, assetRow.publicUrl);
    assert.equal(asset.thumbnailUrl, assetRow.thumbnailUrl);
    assert.equal(asset.influencerId, assetRow.influencerId);
    assert.equal(asset.projectId, assetRow.projectId);
    assert.equal(asset.renderJobId, assetRow.renderJobId);
    assert.equal(asset.providerResourceId, assetRow.providerResourceId);
    assert.equal("bytes" in asset, false);
  }
});

test("asset mapping preserves processing, failed and archived states without inventing completion metadata", () => {
  for (const status of ["processing", "failed", "archived"] as const) {
    const asset = mapMediaAssetRow({
      ...assetRow,
      id: `40000000-0000-4000-8000-00000000000${status.length}`,
      status,
      byteSize: null,
      checksum: null,
      publicUrl: null,
      thumbnailUrl: null,
    });
    assert.equal(asset.status, status);
    assert.equal(asset.sizeBytes, null);
    assert.equal(asset.checksumSha256, null);
    assert.equal(asset.deliveryUrl, null);
    assert.equal(asset.thumbnailUrl, null);
  }
});

test("influencer reads and writes are structurally owner and workspace scoped", async () => {
  const readDb = new FakeDb([influencerRow]);
  const repository = new DrizzleInfluencerRepository(readDb as never);
  const result = await repository.get(scope, influencerRow.id);
  assert.equal(result?.name, "Sofía");
  const readQuery = renderedWhere(readDb.records[0]);
  assert.match(readQuery.sql, /owner_user_id/);
  assert.match(readQuery.sql, /workspace_id/);
  assert.deepEqual(readQuery.params, [influencerRow.id, scope.ownerUserId, scope.workspaceId]);

  const updateDb = new FakeDb([influencerRow]);
  const updateRepository = new DrizzleInfluencerRepository(updateDb as never);
  await updateRepository.update(scope, mapInfluencerRow(influencerRow));
  const updateRecord = updateDb.records[0];
  const updateQuery = renderedWhere(updateRecord);
  assert.match(updateQuery.sql, /owner_user_id/);
  assert.match(updateQuery.sql, /workspace_id/);
  assert.deepEqual(updateQuery.params, [influencerRow.id, scope.ownerUserId, scope.workspaceId]);
  const values = updateRecord.values as Record<string, unknown>;
  assert.deepEqual(values.ageRange, influencerRow.ageRange);
  assert.deepEqual(values.personality, influencerRow.personality);
  assert.equal(values.defaultAvatarResourceId, influencerRow.defaultAvatarResourceId);
});

test("canonical creation requires internal identity, handles races, and returns a redacted aggregate", async () => {
  const missingDb = new FakeDb();
  const missing = new DrizzleCanonicalResourceRepository(missingDb as never, () => ({
    providerAccountId: "",
    providerKey: "heygen",
    canonicalKey: "avatar:sofia",
    externalResourceId: "provider-avatar",
  }));
  await assert.rejects(
    () => missing.create(scope, mapCanonicalResourceRow(resourceRow)),
    /providerAccountId is required internally/,
  );
  assert.equal(missingDb.records.length, 0);

  const raceDb = new FakeDb([{ id: resourceRow.providerAccountId }], [], [resourceRow]);
  const repository = new DrizzleCanonicalResourceRepository(raceDb as never, () => ({
    providerAccountId: resourceRow.providerAccountId,
    providerKey: resourceRow.providerKey,
    canonicalKey: resourceRow.canonicalKey,
    externalResourceId: resourceRow.externalResourceId,
  }));
  const created = await repository.create(scope, mapCanonicalResourceRow(resourceRow));
  assert.equal(created.id, resourceRow.id);
  assert.equal("externalResourceId" in created, false);
  const accountLookup = renderedWhere(raceDb.records[0]);
  assert.match(accountLookup.sql, /owner_user_id/);
  assert.match(accountLookup.sql, /workspace_id/);
  assert.deepEqual(accountLookup.params, [
    resourceRow.providerAccountId,
    scope.ownerUserId,
    scope.workspaceId,
    resourceRow.providerKey,
  ]);
  const insert = raceDb.records[1].values as Record<string, unknown>;
  assert.equal(insert.ownerUserId, scope.ownerUserId);
  assert.equal(insert.workspaceId, scope.workspaceId);
  assert.equal(insert.canonicalKey, resourceRow.canonicalKey);
  const racedLookup = renderedWhere(raceDb.records[2]);
  assert.match(racedLookup.sql, /owner_user_id/);
  assert.match(racedLookup.sql, /workspace_id/);
  assert.deepEqual(racedLookup.params, [
    scope.ownerUserId,
    scope.workspaceId,
    resourceRow.resourceType,
    resourceRow.canonicalKey,
  ]);
});

test("asset createOrGet locks the tenant checksum and stores metadata without bytes", async () => {
  const db = new FakeDb([], [assetRow]);
  const repository = new DrizzleMediaAssetRepository(db as never, {
    workspaceId: scope.workspaceId,
    storageProvider: "private-object-store",
  });
  const candidate: MediaAsset = mapMediaAssetRow(assetRow);
  const result = await repository.createOrGet(candidate);
  assert.equal(result.created, true);
  assert.equal(db.executions.length, 1);
  const lock = new PgDialect().sqlToQuery(db.executions[0] as never);
  assert.match(lock.sql, /pg_advisory_xact_lock/);
  assert.deepEqual(lock.params, [
    `${scope.ownerUserId}\u0000${scope.workspaceId}\u0000video\u0000${assetRow.checksum}`,
  ]);

  const lookup = renderedWhere(db.records[0]);
  assert.match(lookup.sql, /owner_user_id/);
  assert.match(lookup.sql, /workspace_id/);
  const insert = db.records[1].values as Record<string, unknown>;
  assert.equal(insert.ownerUserId, scope.ownerUserId);
  assert.equal(insert.workspaceId, scope.workspaceId);
  assert.equal(insert.kind, "video");
  assert.equal(insert.status, "ready");
  assert.equal(insert.projectId, assetRow.projectId);
  assert.equal(insert.renderJobId, assetRow.renderJobId);
  assert.equal(insert.influencerId, assetRow.influencerId);
  assert.equal(insert.providerResourceId, assetRow.providerResourceId);
  assert.equal(insert.publicUrl, assetRow.publicUrl);
  assert.equal(insert.thumbnailUrl, assetRow.thumbnailUrl);
  assert.equal("bytes" in insert, false);
});

test("asset createOrGet persists incomplete lifecycle rows without checksum dedupe", async () => {
  const failedRow: AiMediaAssetRow = {
    ...assetRow,
    id: "40000000-0000-4000-8000-000000000009",
    status: "failed",
    byteSize: null,
    checksum: null,
    publicUrl: null,
    thumbnailUrl: null,
  };
  const db = new FakeDb([failedRow]);
  const repository = new DrizzleMediaAssetRepository(db as never, { workspaceId: scope.workspaceId });
  const result = await repository.createOrGet(mapMediaAssetRow(failedRow));
  assert.equal(result.created, true);
  assert.equal(result.asset.status, "failed");
  assert.equal(result.asset.checksumSha256, null);
  assert.equal(db.executions.length, 0);
  assert.equal(db.records[0]?.kind, "insert");
});

test("asset checksum dedupe and cursor lookup cannot cross workspaces", async () => {
  const dedupeDb = new FakeDb([assetRow]);
  const repository = new DrizzleMediaAssetRepository(dedupeDb as never, { workspaceId: scope.workspaceId });
  const deduplicated = await repository.createOrGet(mapMediaAssetRow(assetRow));
  assert.equal(deduplicated.created, false);
  assert.equal(dedupeDb.records.filter((record) => record.kind === "insert").length, 0);

  const pageDb = new FakeDb([{ createdAt: assetRow.createdAt }], [assetRow]);
  const paged = new DrizzleMediaAssetRepository(pageDb as never, { workspaceId: scope.workspaceId });
  const page = await paged.listPage(scope.ownerUserId, { cursor: assetRow.id, limit: 1 });
  assert.equal(page.assets.length, 1);
  assert.equal(page.nextCursor, null);
  const cursorLookup = renderedWhere(pageDb.records[0]);
  assert.match(cursorLookup.sql, /owner_user_id/);
  assert.match(cursorLookup.sql, /workspace_id/);
  assert.deepEqual(cursorLookup.params, [assetRow.id, scope.ownerUserId, scope.workspaceId]);
  assert.equal(pageDb.records[1].limit, 2);

  const mismatched = new DrizzleMediaAssetRepository(new FakeDb() as never, { workspaceId: "workspace-b" });
  await assert.rejects(() => mismatched.createOrGet(mapMediaAssetRow(assetRow)), /workspace does not match/i);
});
