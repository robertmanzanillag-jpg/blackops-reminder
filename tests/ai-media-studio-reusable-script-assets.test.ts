import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import {
  reusableScriptAssetListResponseSchema,
  reusableScriptAssetSaveRequestSchema,
  reusableScriptAssetSaveResponseSchema,
} from "../shared/ai-media-studio-reusable-script-assets";
import { sourceScriptPreviewRequestSchema } from "../shared/ai-media-studio-source-to-script";
import type { TenantScope } from "../server/ai-media-studio/core/resource-domain";
import { DeterministicScriptService } from "../server/ai-media-studio/script-service";
import {
  DrizzleReusableScriptAssetRepository,
  type ReusableScriptAssetDatabase,
} from "../server/ai-media-studio/sources/drizzle-reusable-script-asset-repository";
import { InMemoryReusableScriptAssetRepository } from "../server/ai-media-studio/sources/in-memory-reusable-script-asset-repository";
import { InMemorySourceRepository } from "../server/ai-media-studio/sources/in-memory-source-repository";
import {
  ReusableScriptAssetError,
  ReusableScriptAssetService,
} from "../server/ai-media-studio/sources/reusable-script-asset-service";
import { SourceToScriptPreviewService } from "../server/ai-media-studio/sources/source-to-script-preview-service";

const scope: TenantScope = { ownerUserId: "owner-1", workspaceId: "workspace-1" };
const otherScope: TenantScope = { ownerUserId: "owner-2", workspaceId: "workspace-2" };

async function fixture() {
  const sources = new InMemorySourceRepository();
  const created = await sources.upsertByContentHash(scope, {
    adapterKey: "kong-owned",
    providerExternalId: "restaurant-1",
    category: "restaurants",
    title: "Kong Bistro",
    content: "A fully licensed neighborhood restaurant with a seasonal tasting menu.",
    contentHash: `sha256:${"a".repeat(64)}`,
    rightsStatus: "owned",
    moderationStatus: "approved",
    status: "accepted",
    payload: {},
  });
  const previews = new SourceToScriptPreviewService(sources);
  const repository = new InMemoryReusableScriptAssetRepository();
  const service = new ReusableScriptAssetService(previews, repository);
  const previewRequest = sourceScriptPreviewRequestSchema.parse({
    sourceItemId: created.item.id,
    idempotencyKey: "preview-1",
    language: "en",
    variantCount: 3,
  });
  const preview = await previews.preview(scope, previewRequest);
  const request = {
    previewRequest,
    expectedSourceContentHash: preview.source.contentHash,
    expectedPreviewDigest: preview.previewDigest,
    selectedVariantId: preview.scriptSet.variants[1]!.id,
    saveIdempotencyKey: "save-1",
  };
  return { sources, repository, service, preview, request, source: created.item };
}

test("reusable script save contract rejects creative text and provider fields", () => {
  const base = {
    previewRequest: {
      sourceItemId: "source-1",
      idempotencyKey: "preview-1",
      language: "en",
      variantCount: 3,
    },
    expectedSourceContentHash: `sha256:${"a".repeat(64)}`,
    expectedPreviewDigest: `sha256:${"b".repeat(64)}`,
    selectedVariantId: "variant-1",
    saveIdempotencyKey: "save-1",
  };
  assert.equal(reusableScriptAssetSaveRequestSchema.safeParse(base).success, true);
  assert.equal(reusableScriptAssetSaveRequestSchema.safeParse({ ...base, script: "untrusted creative" }).success, false);
  assert.equal(reusableScriptAssetSaveRequestSchema.safeParse({ ...base, providerId: "heygen" }).success, false);
  assert.equal(reusableScriptAssetSaveRequestSchema.safeParse({
    ...base,
    previewRequest: { ...base.previewRequest, content: "untrusted source" },
  }).success, false);
});

test("save regenerates the preview, persists every variant, and selects the requested draft", async () => {
  const { service, preview, request } = await fixture();
  const response = await service.save(scope, "operator-1", request);
  assert.equal(response.replayed, false);
  assert.equal(response.asset.status, "draft");
  assert.equal(response.asset.variants.length, 3);
  assert.equal(response.asset.currentVariantId, response.asset.variants[1]!.id);
  assert.deepEqual(response.asset.variants.map((variant) => variant.script), preview.scriptSet.variants.map((variant) => variant.script));
  assert.equal(response.effects.scriptPersisted, true);
  assert.equal(response.effects.videoProviderCalled, false);
  assert.equal(response.effects.secretResolved, false);
  assert.equal(response.effects.spendCommitted, false);
  assert.equal(response.effects.publishingCreated, false);
  assert.equal(response.downstreamState, "blocked_before_render_admission");
  assert.equal(reusableScriptAssetSaveResponseSchema.safeParse(response).success, true);
});

test("same tenant idempotency key replays exactly and a different input conflicts", async () => {
  const { service, request, preview } = await fixture();
  const first = await service.save(scope, "operator-1", request);
  const replay = await service.save(scope, "operator-2", request);
  assert.equal(replay.replayed, true);
  assert.deepEqual(replay.asset, first.asset);
  await assert.rejects(
    service.save(scope, "operator-1", {
      ...request,
      selectedVariantId: preview.scriptSet.variants[0]!.id,
    }),
    (error: unknown) => error instanceof ReusableScriptAssetError
      && error.code === "IDEMPOTENCY_CONFLICT" && error.statusCode === 409,
  );
});

test("an exact retry replays after the source changes while a new key still detects the refresh", async () => {
  const { service, sources, request, source } = await fixture();
  const first = await service.save(scope, "operator-1", request);
  await sources.upsertByContentHash(scope, {
    adapterKey: source.adapterKey,
    providerExternalId: source.providerExternalId,
    category: source.category,
    title: source.title,
    content: "The restaurant changed its licensed menu and source copy.",
    contentHash: `sha256:${"c".repeat(64)}`,
    rightsStatus: "owned",
    moderationStatus: "approved",
    status: "accepted",
    payload: {},
  });
  const replay = await service.save(scope, "operator-2", request);
  assert.equal(replay.replayed, true);
  assert.deepEqual(replay.asset, first.asset);
  await assert.rejects(
    service.save(scope, "operator-2", { ...request, saveIdempotencyKey: "save-after-refresh" }),
    (error: unknown) => error instanceof ReusableScriptAssetError
      && error.code === "SOURCE_REFRESHED" && error.statusCode === 409,
  );
});

test("stale source content and stale previews fail before persistence", async () => {
  const { service, sources, request, source } = await fixture();
  await sources.upsertByContentHash(scope, {
    adapterKey: source.adapterKey,
    providerExternalId: source.providerExternalId,
    category: source.category,
    title: source.title,
    content: "The restaurant changed its licensed menu and source copy.",
    contentHash: `sha256:${"c".repeat(64)}`,
    rightsStatus: "owned",
    moderationStatus: "approved",
    status: "accepted",
    payload: {},
  });
  await assert.rejects(
    service.save(scope, "operator-1", request),
    (error: unknown) => error instanceof ReusableScriptAssetError
      && error.code === "SOURCE_REFRESHED" && error.statusCode === 409,
  );
  const list = await service.list(scope, {});
  assert.equal(list.items.length, 0);
});

test("tenant-scoped catalog paginates without exposing another tenant", async () => {
  const { service, request, preview } = await fixture();
  await service.save(scope, "operator-1", request);
  await service.save(scope, "operator-1", {
    ...request,
    selectedVariantId: preview.scriptSet.variants[0]!.id,
    saveIdempotencyKey: "save-2",
  });
  const first = await service.list(scope, { limit: 1, status: "draft" });
  assert.equal(first.items.length, 1);
  assert.equal(first.hasMore, true);
  assert.ok(first.nextCursor);
  const second = await service.list(scope, { limit: 1, status: "draft", cursor: first.nextCursor });
  assert.equal(second.items.length, 1);
  assert.notEqual(second.items[0]!.id, first.items[0]!.id);
  assert.equal(second.hasMore, false);
  assert.equal(reusableScriptAssetListResponseSchema.safeParse(second).success, true);
  assert.deepEqual(await service.list(otherScope, {}), { items: [], nextCursor: null, hasMore: false });
  await assert.rejects(
    service.list(otherScope, { limit: 1, status: "draft", cursor: first.nextCursor }),
    (error: unknown) => error instanceof ReusableScriptAssetError
      && error.code === "INVALID_REQUEST" && error.statusCode === 400,
  );
});

test("Drizzle save locks tenant source and idempotency, writes only script tables, and atomically binds selection", async () => {
  const sourceId = "00000000-0000-4000-8000-000000000001";
  const scriptId = "00000000-0000-5000-8000-000000000010";
  const variantId = "00000000-0000-5000-8000-000000000011";
  const contentHash = `sha256:${"a".repeat(64)}` as const;
  const checksum = `sha256:${"b".repeat(64)}`;
  const createdAt = new Date("2026-07-22T12:00:00.000Z");
  const previewRequest = sourceScriptPreviewRequestSchema.parse({
    sourceItemId: sourceId,
    idempotencyKey: "preview-1",
    language: "en",
    variantCount: 1,
  });
  const generated = new DeterministicScriptService().generate({
    source: { type: "restaurants", id: sourceId, title: "Kong Bistro", summary: "Licensed restaurant copy." },
    language: "en",
    variantCount: 1,
  });
  const expectedPreviewDigest = `sha256:${createHash("sha256").update(JSON.stringify({
    source: { id: sourceId, category: "restaurants", contentHash, updatedAt: createdAt.toISOString() },
    request: previewRequest,
    scriptSet: generated.scriptSet,
  })).digest("hex")}` as const;
  const generatedVariant = generated.scriptSet.variants[0]!;
  const generatedChecksum = `sha256:${createHash("sha256").update(generatedVariant.script).digest("hex")}`;
  const dialect = new PgDialect();
  const queries: Array<{ text: string; params: unknown[] }> = [];
  let transactionCalls = 0;
  const database: ReusableScriptAssetDatabase = {
    async execute(query: SQL) {
      const compiled = dialect.sqlToQuery(query);
      const text = compiled.sql.replace(/\s+/gu, " ").trim();
      queries.push({ text, params: compiled.params });
      if (/from "ai_media_source_items"/iu.test(text)) return { rows: [{
        id: sourceId,
        title: "Kong Bistro",
        content: "Licensed restaurant copy.",
        source_type: "restaurants",
        status: "accepted",
        rights_status: "owned",
        moderation_status: "approved",
        content_hash: contentHash,
        updated_at: createdAt,
      }] };
      if (/select id,metadata from "ai_media_scripts"/iu.test(text)) return { rows: [] };
      if (/insert into "ai_media_scripts"/iu.test(text)) return { rows: [{ id: scriptId }] };
      if (/insert into "ai_media_script_variants"/iu.test(text)) return { rows: [{ id: variantId }] };
      if (/update "ai_media_scripts"/iu.test(text)) return { rows: [{ id: scriptId }] };
      if (/select id,influencer_id,title/iu.test(text)) return { rows: [{
        id: scriptId,
        influencer_id: null,
        title: generated.scriptSet.title,
        source_type: "restaurants",
        source_item_id: sourceId,
        language: "en",
        status: "draft",
        current_variant_id: variantId,
        metadata: { reusableScriptAssetV1: { source: { id: sourceId, category: "restaurants", contentHash } } },
        created_at: createdAt,
        updated_at: createdAt,
      }] };
      if (/select id,version,metadata from "ai_media_script_variants"/iu.test(text)) return { rows: [{
        id: variantId,
        version: 1,
        metadata: { reusableScriptCreativeV1: {
          id: "variant-canonical-1",
          ...generatedVariant,
          checksum: generatedChecksum,
        } },
      }] };
      return { rows: [] };
    },
    async transaction(callback) {
      transactionCalls += 1;
      return callback(this);
    },
  };
  const repository = new DrizzleReusableScriptAssetRepository(database);
  const result = await repository.save(scope, {
    actorUserId: "operator-1",
    sourceItemId: sourceId,
    expectedSourceContentHash: contentHash,
    expectedPreviewDigest,
    previewRequest,
    saveIdempotencyKey: "save-1",
    inputDigest: `sha256:${"d".repeat(64)}`,
    generatorVersion: "deterministic-v1",
    selectedVariantId: generatedVariant.id,
    scriptSet: generated.scriptSet,
  });
  assert.equal(result.replayed, false);
  assert.equal(result.asset.currentVariantId, variantId);
  assert.equal(transactionCalls, 1);
  const allSql = queries.map((query) => query.text).join(" ");
  assert.match(allSql, /pg_advisory_xact_lock/iu);
  assert.match(allSql, /from "ai_media_source_items".*owner_user_id.*workspace_id.*for update/iu);
  assert.match(allSql, /insert into "ai_media_scripts"/iu);
  assert.match(allSql, /insert into "ai_media_script_variants"/iu);
  assert.match(allSql, /current_variant_id/iu);
  assert.doesNotMatch(allSql, /outbox|render|publish|provider|secret|spend|migration/iu);
  assert.ok(queries.flatMap((query) => query.params).includes(scope.ownerUserId));
  assert.ok(queries.flatMap((query) => query.params).includes(scope.workspaceId));
});

test("Drizzle replay resolves the tenant asset under the idempotency lock without reading the source", async () => {
  const sourceId = "00000000-0000-4000-8000-000000000041";
  const scriptId = "00000000-0000-5000-8000-000000000041";
  const variantId = "00000000-0000-5000-8000-000000000042";
  const inputDigest = `sha256:${"d".repeat(64)}` as const;
  const contentHash = `sha256:${"a".repeat(64)}`;
  const createdAt = new Date("2026-07-22T12:00:00.000Z");
  const scriptSet = new DeterministicScriptService().generate({
    source: { type: "restaurants", id: sourceId, title: "Kong Bistro", summary: "Licensed restaurant copy." },
    language: "en",
    variantCount: 1,
  }).scriptSet;
  const variant = scriptSet.variants[0]!;
  const checksum = `sha256:${createHash("sha256").update(variant.script).digest("hex")}`;
  const dialect = new PgDialect();
  const queries: Array<{ text: string; params: unknown[] }> = [];
  let transactionCalls = 0;
  const database: ReusableScriptAssetDatabase = {
    async execute(query: SQL) {
      const compiled = dialect.sqlToQuery(query);
      const text = compiled.sql.replace(/\s+/gu, " ").trim();
      queries.push({ text, params: compiled.params });
      if (/select id,metadata from "ai_media_scripts"/iu.test(text)) return { rows: [{
        id: scriptId,
        metadata: { reusableScriptAssetV1: { saveIdempotencyKey: "save-1", inputDigest } },
      }] };
      if (/select id,influencer_id,title/iu.test(text)) return { rows: [{
        id: scriptId,
        influencer_id: null,
        title: scriptSet.title,
        source_type: "restaurants",
        source_item_id: sourceId,
        language: "en",
        status: "draft",
        current_variant_id: variantId,
        metadata: { reusableScriptAssetV1: { source: { id: sourceId, category: "restaurants", contentHash } } },
        created_at: createdAt,
        updated_at: createdAt,
      }] };
      if (/select id,version,metadata from "ai_media_script_variants"/iu.test(text)) return { rows: [{
        id: variantId,
        version: 1,
        metadata: { reusableScriptCreativeV1: { ...variant, checksum } },
      }] };
      return { rows: [] };
    },
    async transaction(callback) {
      transactionCalls += 1;
      return callback(this);
    },
  };
  const result = await new DrizzleReusableScriptAssetRepository(database).replay(scope, "save-1", inputDigest);
  assert.equal(result?.replayed, true);
  assert.equal(result?.asset.id, scriptId);
  assert.equal(transactionCalls, 1);
  const allSql = queries.map((query) => query.text).join(" ");
  assert.match(allSql, /pg_advisory_xact_lock/iu);
  assert.doesNotMatch(allSql, /ai_media_source_items/iu);
  assert.ok(queries.flatMap((query) => query.params).includes(scope.ownerUserId));
  assert.ok(queries.flatMap((query) => query.params).includes(scope.workspaceId));
});

test("Drizzle list loads a page with three set-based queries and preserves page order", async () => {
  const scriptIds = [
    "00000000-0000-5000-8000-000000000021",
    "00000000-0000-5000-8000-000000000020",
  ];
  const variantIds = [
    "00000000-0000-5000-8000-000000000031",
    "00000000-0000-5000-8000-000000000030",
  ];
  const sourceIds = [
    "00000000-0000-4000-8000-000000000021",
    "00000000-0000-4000-8000-000000000020",
  ];
  const createdAt = [new Date("2026-07-22T13:00:00.000Z"), new Date("2026-07-22T12:00:00.000Z")];
  const generated = sourceIds.map((sourceId, index) => new DeterministicScriptService().generate({
    source: {
      type: "restaurants",
      id: sourceId,
      title: `Kong Bistro ${index + 1}`,
      summary: `Licensed restaurant copy ${index + 1}.`,
    },
    language: "en",
    variantCount: 1,
  }).scriptSet);
  const dialect = new PgDialect();
  const queries: Array<{ text: string; params: unknown[] }> = [];
  const database: ReusableScriptAssetDatabase = {
    async execute(query: SQL) {
      const compiled = dialect.sqlToQuery(query);
      const text = compiled.sql.replace(/\s+/gu, " ").trim();
      queries.push({ text, params: compiled.params });
      if (/select id,created_at from "ai_media_scripts"/iu.test(text)) {
        return { rows: scriptIds.map((id, index) => ({ id, created_at: createdAt[index] })) };
      }
      if (/select id,influencer_id,title.*id in/iu.test(text)) {
        return { rows: scriptIds.map((id, index) => ({
          id,
          influencer_id: null,
          title: generated[index]!.title,
          source_type: "restaurants",
          source_item_id: sourceIds[index],
          language: "en",
          status: "draft",
          current_variant_id: variantIds[index],
          metadata: { reusableScriptAssetV1: { source: {
            id: sourceIds[index],
            category: "restaurants",
            contentHash: `sha256:${String(index + 1).repeat(64)}`,
          } } },
          created_at: createdAt[index],
          updated_at: createdAt[index],
        })) };
      }
      if (/select id,script_id,version,metadata from "ai_media_script_variants"/iu.test(text)) {
        return { rows: scriptIds.map((scriptId, index) => {
          const variant = generated[index]!.variants[0]!;
          return {
            id: variantIds[index],
            script_id: scriptId,
            version: 1,
            metadata: { reusableScriptCreativeV1: {
              ...variant,
              checksum: `sha256:${String(index + 3).repeat(64)}`,
            } },
          };
        }) };
      }
      return { rows: [] };
    },
    async transaction(callback) {
      return callback(this);
    },
  };
  const result = await new DrizzleReusableScriptAssetRepository(database).list(scope, { limit: 2 });
  assert.deepEqual(result.items.map((item) => item.id), scriptIds);
  assert.equal(result.hasMore, false);
  assert.equal(result.nextCursor, null);
  assert.equal(queries.length, 3);
  assert.equal(queries.filter((query) => / id in \(/iu.test(query.text)).length, 1);
  assert.equal(queries.filter((query) => / script_id in \(/iu.test(query.text)).length, 1);
});
