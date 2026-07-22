import { createHash } from "node:crypto";
import { sql, type SQL } from "drizzle-orm";
import {
  reusableScriptAssetSchema,
  type ReusableScriptAsset,
  type ReusableScriptAssetListRequest,
  type ReusableScriptAssetListResponse,
} from "../../../shared/ai-media-studio-reusable-script-assets";
import {
  aiMediaInfluencers,
  aiMediaScripts,
  aiMediaScriptVariants,
  aiMediaSourceItems,
} from "../../../shared/models/ai-media-studio-db";
import type { TenantScope } from "../core/resource-domain";
import { DeterministicScriptService } from "../script-service";
import {
  ReusableScriptAssetRepositoryError,
  type PersistReusableScriptAssetInput,
  type PersistReusableScriptAssetResult,
  type ReusableScriptAssetRepository,
} from "./reusable-script-asset-contracts";
import {
  decodeReusableScriptAssetCursor,
  encodeReusableScriptAssetCursor,
} from "./reusable-script-asset-pagination";

type ExecuteResult = { rows?: unknown[] } | unknown[];
export type ReusableScriptAssetExecutor = { execute(query: SQL): Promise<ExecuteResult> };
export type ReusableScriptAssetDatabase = ReusableScriptAssetExecutor & {
  transaction<T>(callback: (tx: ReusableScriptAssetExecutor) => Promise<T>): Promise<T>;
};

type Row = Record<string, unknown>;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/iu;
const SHA256 = /^sha256:[a-f0-9]{64}$/u;

function rows(result: ExecuteResult): Row[] {
  const value = Array.isArray(result) ? result : result.rows;
  return Array.isArray(value) ? value as Row[] : [];
}

function value(row: Row, camel: string, snake: string): unknown {
  return row[camel] ?? row[snake];
}

function text(row: Row, camel: string, snake: string): string {
  return String(value(row, camel, snake) ?? "");
}

function iso(value: unknown): string {
  const parsed = value instanceof Date ? value : new Date(String(value));
  if (!Number.isFinite(parsed.getTime())) throw new ReusableScriptAssetRepositoryError("PERSISTENCE_UNAVAILABLE");
  return parsed.toISOString();
}

function record(value: unknown): Row {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ReusableScriptAssetRepositoryError("PERSISTENCE_UNAVAILABLE");
  }
  return value as Row;
}

function digest(value: string): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function digestJson(value: unknown): `sha256:${string}` {
  return digest(JSON.stringify(value));
}

function deterministicUuid(namespace: string, value: string): string {
  const bytes = createHash("sha256").update(`${namespace}\0${value}`).digest().subarray(0, 16);
  bytes[6] = (bytes[6]! & 0x0f) | 0x50;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function scriptIdentity(scope: TenantScope, saveIdempotencyKey: string): string {
  return deterministicUuid("kong-reusable-script-asset-v1", JSON.stringify([
    scope.ownerUserId,
    scope.workspaceId,
    saveIdempotencyKey,
  ]));
}

function variantIdentity(scriptId: string, canonicalVariantId: string, version: number): string {
  return deterministicUuid("kong-reusable-script-variant-v1", JSON.stringify([scriptId, canonicalVariantId, version]));
}

export class DrizzleReusableScriptAssetRepository implements ReusableScriptAssetRepository {
  constructor(
    private readonly db: ReusableScriptAssetDatabase,
    private readonly scripts = new DeterministicScriptService(),
  ) {}

  async replay(
    scope: TenantScope,
    saveIdempotencyKey: string,
    inputDigest: `sha256:${string}`,
  ): Promise<PersistReusableScriptAssetResult | null> {
    try {
      return await this.db.transaction(async (tx) => {
        await lockIdempotencyKey(tx, scope, saveIdempotencyKey);
        return findReplay(tx, scope, saveIdempotencyKey, inputDigest);
      });
    } catch (error) {
      if (error instanceof ReusableScriptAssetRepositoryError) throw error;
      throw new ReusableScriptAssetRepositoryError("PERSISTENCE_UNAVAILABLE");
    }
  }

  async save(scope: TenantScope, input: PersistReusableScriptAssetInput): Promise<PersistReusableScriptAssetResult> {
    if (!UUID.test(input.sourceItemId)) throw new ReusableScriptAssetRepositoryError("NOT_FOUND");
    if (input.scriptSet.influencerId && !UUID.test(input.scriptSet.influencerId)) {
      throw new ReusableScriptAssetRepositoryError("INFLUENCER_NOT_FOUND");
    }
    try {
      return await this.db.transaction(async (tx) => {
        await lockIdempotencyKey(tx, scope, input.saveIdempotencyKey);
        const replay = await findReplay(tx, scope, input.saveIdempotencyKey, input.inputDigest);
        if (replay) return replay;
        const sourceRows = rows(await tx.execute(sql`
          SELECT id,title,content,source_type,status,rights_status,moderation_status,
            COALESCE(content_hash,payload->>'contentHash') AS content_hash,updated_at
          FROM ${aiMediaSourceItems}
          WHERE id=${input.sourceItemId} AND owner_user_id=${scope.ownerUserId}
            AND workspace_id=${scope.workspaceId}
          FOR UPDATE
        `));
        if (sourceRows.length !== 1) throw new ReusableScriptAssetRepositoryError("NOT_FOUND");
        const source = sourceRows[0]!;
        const currentContentHash = text(source, "contentHash", "content_hash");
        if (currentContentHash !== input.expectedSourceContentHash) {
          throw new ReusableScriptAssetRepositoryError("SOURCE_REFRESHED");
        }
        const sourceTitle = text(source, "title", "title");
        const sourceContent = text(source, "content", "content");
        const sourceType = text(source, "sourceType", "source_type");
        if (!SHA256.test(currentContentHash)
          || !["accepted", "ready"].includes(text(source, "status", "status"))
          || !["owned", "licensed"].includes(text(source, "rightsStatus", "rights_status"))
          || text(source, "moderationStatus", "moderation_status") !== "approved"
          || !sourceTitle.trim() || sourceTitle !== sourceTitle.trim() || sourceTitle.length > 200
          || !sourceContent.trim() || sourceContent !== sourceContent.trim() || sourceContent.length > 4_000
          || input.scriptSet.source.id !== input.sourceItemId
          || input.scriptSet.source.type !== sourceType
          || input.scriptSet.source.title !== sourceTitle) {
          throw new ReusableScriptAssetRepositoryError("SOURCE_INELIGIBLE");
        }
        if (input.scriptSet.influencerId) {
          const influencerRows = rows(await tx.execute(sql`
            SELECT id FROM ${aiMediaInfluencers}
            WHERE id=${input.scriptSet.influencerId} AND owner_user_id=${scope.ownerUserId}
              AND workspace_id=${scope.workspaceId} AND archived_at IS NULL
            LIMIT 1
          `));
          if (influencerRows.length !== 1) {
            throw new ReusableScriptAssetRepositoryError("INFLUENCER_NOT_FOUND");
          }
        }
        const regenerated = this.scripts.generate({
          source: {
            type: sourceType as typeof input.scriptSet.source.type,
            id: input.sourceItemId,
            title: sourceTitle,
            summary: sourceContent,
          },
          ...(input.previewRequest.influencerId ? { influencerId: input.previewRequest.influencerId } : {}),
          language: input.previewRequest.language,
          ...(input.previewRequest.angle ? { angle: input.previewRequest.angle } : {}),
          variantCount: input.previewRequest.variantCount,
        });
        const sourceUpdatedAt = iso(value(source, "updatedAt", "updated_at"));
        const transactionPreviewDigest = digestJson({
          source: {
            id: input.sourceItemId,
            category: sourceType,
            contentHash: currentContentHash,
            updatedAt: sourceUpdatedAt,
          },
          request: input.previewRequest,
          scriptSet: regenerated.scriptSet,
        });
        if (JSON.stringify(regenerated.scriptSet) !== JSON.stringify(input.scriptSet)
          || transactionPreviewDigest !== input.expectedPreviewDigest) {
          throw new ReusableScriptAssetRepositoryError("PREVIEW_STALE");
        }
        const scriptId = scriptIdentity(scope, input.saveIdempotencyKey);
        const savedAt = new Date().toISOString();
        const rawContentHash = digest(sourceContent);
        const selectedIndex = input.scriptSet.variants.findIndex((variant) => variant.id === input.selectedVariantId);
        if (selectedIndex < 0) throw new ReusableScriptAssetRepositoryError("PERSISTENCE_UNAVAILABLE");
        const variantIds = input.scriptSet.variants.map((variant, index) => (
          variantIdentity(scriptId, variant.id, index + 1)
        ));
        const envelope = {
          version: 1,
          generatorVersion: input.generatorVersion,
          source: {
            id: input.sourceItemId,
            category: sourceType,
            contentHash: input.expectedSourceContentHash,
            rawContentHash,
            updatedAt: sourceUpdatedAt,
          },
          preview: {
            digest: input.expectedPreviewDigest,
            idempotencyKey: input.previewRequest.idempotencyKey,
            language: input.scriptSet.language,
            ...(input.previewRequest.angle ? { angle: input.previewRequest.angle } : {}),
            variantCount: input.scriptSet.variants.length,
          },
          selectedVariantCanonicalId: input.selectedVariantId,
          inputDigest: input.inputDigest,
          saveIdempotencyKey: input.saveIdempotencyKey,
          actorUserId: input.actorUserId,
          savedAt,
        };
        const insertedScript = rows(await tx.execute(sql`
          INSERT INTO ${aiMediaScripts} (
            id,owner_user_id,workspace_id,influencer_id,title,source_type,source_item_id,
            language,status,current_variant_id,metadata,created_at,updated_at
          ) VALUES (
            ${scriptId},${scope.ownerUserId},${scope.workspaceId},${input.scriptSet.influencerId ?? null},
            ${input.scriptSet.title},${sourceType},${input.sourceItemId},${input.scriptSet.language},
            'draft',NULL,${JSON.stringify({ reusableScriptAssetV1: envelope })}::jsonb,
            ${savedAt}::timestamptz,${savedAt}::timestamptz
          ) RETURNING id
        `));
        if (insertedScript.length !== 1) throw new ReusableScriptAssetRepositoryError("PERSISTENCE_UNAVAILABLE");
        for (const [index, variant] of input.scriptSet.variants.entries()) {
          const checksum = digest(variant.script);
          const creative = { ...variant, checksum };
          const insertedVariant = rows(await tx.execute(sql`
            INSERT INTO ${aiMediaScriptVariants} (
              id,owner_user_id,workspace_id,script_id,version,label,content,status,checksum,
              metadata,created_at,updated_at
            ) VALUES (
              ${variantIds[index]},${scope.ownerUserId},${scope.workspaceId},${scriptId},${index + 1},
              ${variant.title},${variant.script},'draft',${checksum},
              ${JSON.stringify({ reusableScriptCreativeV1: creative })}::jsonb,
              ${savedAt}::timestamptz,${savedAt}::timestamptz
            ) RETURNING id
          `));
          if (insertedVariant.length !== 1) throw new ReusableScriptAssetRepositoryError("PERSISTENCE_UNAVAILABLE");
        }
        const selectedVariantId = variantIds[selectedIndex]!;
        const updated = rows(await tx.execute(sql`
          UPDATE ${aiMediaScripts} SET current_variant_id=${selectedVariantId},updated_at=${savedAt}::timestamptz
          WHERE id=${scriptId} AND owner_user_id=${scope.ownerUserId} AND workspace_id=${scope.workspaceId}
            AND current_variant_id IS NULL
          RETURNING id
        `));
        if (updated.length !== 1) throw new ReusableScriptAssetRepositoryError("PERSISTENCE_UNAVAILABLE");
        return { asset: await loadAsset(tx, scope, scriptId), replayed: false };
      });
    } catch (error) {
      if (error instanceof ReusableScriptAssetRepositoryError) throw error;
      throw new ReusableScriptAssetRepositoryError("PERSISTENCE_UNAVAILABLE");
    }
  }

  async list(scope: TenantScope, request: ReusableScriptAssetListRequest): Promise<ReusableScriptAssetListResponse> {
    try {
      const cursor = decodeReusableScriptAssetCursor(scope, request.status, request.cursor);
      const statusPredicate = request.status ? sql`AND status=${request.status}` : sql``;
      const cursorPredicate = cursor
        ? sql`AND (created_at < ${cursor.createdAt} OR (created_at = ${cursor.createdAt} AND id < ${cursor.id}))`
        : sql``;
      const scriptRows = rows(await this.db.execute(sql`
        SELECT id,created_at FROM ${aiMediaScripts}
        WHERE owner_user_id=${scope.ownerUserId} AND workspace_id=${scope.workspaceId}
          AND metadata ? 'reusableScriptAssetV1' ${statusPredicate} ${cursorPredicate}
        ORDER BY created_at DESC,id DESC LIMIT ${request.limit + 1}
      `));
      const hasMore = scriptRows.length > request.limit;
      const pageRows = scriptRows.slice(0, request.limit);
      if (pageRows.length === 0) return { items: [], nextCursor: null, hasMore: false };
      const pageIds = pageRows.map((row) => text(row, "id", "id"));
      if (pageIds.some((id) => !UUID.test(id))) {
        throw new ReusableScriptAssetRepositoryError("PERSISTENCE_UNAVAILABLE");
      }
      const idList = sql.join(pageIds.map((id) => sql`${id}`), sql`, `);
      const assetScriptRows = rows(await this.db.execute(sql`
        SELECT id,influencer_id,title,source_type,source_item_id,language,status,current_variant_id,
          metadata,created_at,updated_at
        FROM ${aiMediaScripts}
        WHERE owner_user_id=${scope.ownerUserId} AND workspace_id=${scope.workspaceId}
          AND metadata ? 'reusableScriptAssetV1' AND id IN (${idList})
      `));
      const variantRows = rows(await this.db.execute(sql`
        SELECT id,script_id,version,metadata FROM ${aiMediaScriptVariants}
        WHERE owner_user_id=${scope.ownerUserId} AND workspace_id=${scope.workspaceId}
          AND metadata ? 'reusableScriptCreativeV1' AND script_id IN (${idList})
        ORDER BY script_id ASC,version ASC
      `));
      const scriptsById = new Map(assetScriptRows.map((row) => [text(row, "id", "id"), row]));
      const variantsByScriptId = new Map<string, Row[]>();
      for (const row of variantRows) {
        const scriptId = text(row, "scriptId", "script_id");
        const grouped = variantsByScriptId.get(scriptId) ?? [];
        grouped.push(row);
        variantsByScriptId.set(scriptId, grouped);
      }
      const items = pageIds.map((id) => {
        const script = scriptsById.get(id);
        if (!script) throw new ReusableScriptAssetRepositoryError("PERSISTENCE_UNAVAILABLE");
        return toAsset(script, variantsByScriptId.get(id) ?? []);
      });
      return {
        items,
        nextCursor: hasMore && items.length > 0
          ? encodeReusableScriptAssetCursor(scope, request.status, items.at(-1)!)
          : null,
        hasMore,
      };
    } catch (error) {
      if (error instanceof ReusableScriptAssetRepositoryError) throw error;
      throw new ReusableScriptAssetRepositoryError("PERSISTENCE_UNAVAILABLE");
    }
  }
}

async function lockIdempotencyKey(
  executor: ReusableScriptAssetExecutor,
  scope: TenantScope,
  saveIdempotencyKey: string,
): Promise<void> {
  const lockKey = JSON.stringify([scope.ownerUserId, scope.workspaceId, saveIdempotencyKey]);
  await executor.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`);
}

async function findReplay(
  executor: ReusableScriptAssetExecutor,
  scope: TenantScope,
  saveIdempotencyKey: string,
  inputDigest: `sha256:${string}`,
): Promise<PersistReusableScriptAssetResult | null> {
  const scriptId = scriptIdentity(scope, saveIdempotencyKey);
  const existingRows = rows(await executor.execute(sql`
    SELECT id,metadata FROM ${aiMediaScripts}
    WHERE id=${scriptId} AND owner_user_id=${scope.ownerUserId} AND workspace_id=${scope.workspaceId}
    LIMIT 1 FOR UPDATE
  `));
  if (existingRows.length === 0) return null;
  if (existingRows.length !== 1) throw new ReusableScriptAssetRepositoryError("PERSISTENCE_UNAVAILABLE");
  const envelope = record(record(value(existingRows[0]!, "metadata", "metadata")).reusableScriptAssetV1);
  if (envelope.saveIdempotencyKey !== saveIdempotencyKey || envelope.inputDigest !== inputDigest) {
    throw new ReusableScriptAssetRepositoryError("IDEMPOTENCY_CONFLICT");
  }
  return { asset: await loadAsset(executor, scope, scriptId), replayed: true };
}

async function loadAsset(
  executor: ReusableScriptAssetExecutor,
  scope: TenantScope,
  scriptId: string,
): Promise<ReusableScriptAsset> {
  const scriptRows = rows(await executor.execute(sql`
    SELECT id,influencer_id,title,source_type,source_item_id,language,status,current_variant_id,
      metadata,created_at,updated_at
    FROM ${aiMediaScripts}
    WHERE id=${scriptId} AND owner_user_id=${scope.ownerUserId} AND workspace_id=${scope.workspaceId}
      AND metadata ? 'reusableScriptAssetV1'
    LIMIT 1
  `));
  if (scriptRows.length !== 1) throw new ReusableScriptAssetRepositoryError("PERSISTENCE_UNAVAILABLE");
  const script = scriptRows[0]!;
  const variantRows = rows(await executor.execute(sql`
    SELECT id,version,metadata FROM ${aiMediaScriptVariants}
    WHERE script_id=${scriptId} AND owner_user_id=${scope.ownerUserId} AND workspace_id=${scope.workspaceId}
      AND metadata ? 'reusableScriptCreativeV1'
    ORDER BY version ASC
  `));
  return toAsset(script, variantRows);
}

function toAsset(script: Row, variantRows: Row[]): ReusableScriptAsset {
  const metadata = record(value(script, "metadata", "metadata"));
  const envelope = record(metadata.reusableScriptAssetV1);
  const source = record(envelope.source);
  const variants = variantRows.map((row) => {
    const creative = record(record(value(row, "metadata", "metadata")).reusableScriptCreativeV1);
    return {
      id: text(row, "id", "id"),
      version: Number(value(row, "version", "version")),
      angle: creative.angle,
      title: creative.title,
      hook: creative.hook,
      script: creative.script,
      cta: creative.cta,
      caption: creative.caption,
      hashtags: creative.hashtags,
      seoKeywords: creative.seoKeywords,
      checksum: creative.checksum,
    };
  });
  const influencerId = text(script, "influencerId", "influencer_id");
  return reusableScriptAssetSchema.parse({
    id: text(script, "id", "id"),
    title: text(script, "title", "title"),
    source: {
      id: source.id,
      category: source.category,
      contentHash: source.contentHash,
    },
    ...(influencerId ? { influencerId } : {}),
    language: text(script, "language", "language"),
    status: text(script, "status", "status"),
    currentVariantId: text(script, "currentVariantId", "current_variant_id"),
    variants,
    createdAt: iso(value(script, "createdAt", "created_at")),
    updatedAt: iso(value(script, "updatedAt", "updated_at")),
  });
}
