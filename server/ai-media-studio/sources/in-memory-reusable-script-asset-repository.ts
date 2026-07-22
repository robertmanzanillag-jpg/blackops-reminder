import { createHash } from "node:crypto";
import type {
  ReusableScriptAsset,
  ReusableScriptAssetListRequest,
  ReusableScriptAssetListResponse,
} from "../../../shared/ai-media-studio-reusable-script-assets";
import type { TenantScope } from "../core/resource-domain";
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

type Stored = { inputDigest: string; asset: ReusableScriptAsset };

function tenantKey(scope: TenantScope): string {
  return `${scope.ownerUserId}\0${scope.workspaceId}`;
}

function digest(value: string): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function deterministicUuid(namespace: string, value: string): string {
  const bytes = createHash("sha256").update(`${namespace}\0${value}`).digest().subarray(0, 16);
  bytes[6] = (bytes[6]! & 0x0f) | 0x50;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

export class InMemoryReusableScriptAssetRepository implements ReusableScriptAssetRepository {
  private readonly tenants = new Map<string, Map<string, Stored>>();

  async replay(
    scope: TenantScope,
    saveIdempotencyKey: string,
    inputDigest: `sha256:${string}`,
  ): Promise<PersistReusableScriptAssetResult | null> {
    const existing = this.tenants.get(tenantKey(scope))?.get(scriptIdentity(scope, saveIdempotencyKey));
    if (!existing) return null;
    if (existing.inputDigest !== inputDigest) {
      throw new ReusableScriptAssetRepositoryError("IDEMPOTENCY_CONFLICT");
    }
    return { asset: clone(existing.asset), replayed: true };
  }

  async save(scope: TenantScope, input: PersistReusableScriptAssetInput): Promise<PersistReusableScriptAssetResult> {
    const key = tenantKey(scope);
    const scripts = this.tenants.get(key) ?? new Map<string, Stored>();
    this.tenants.set(key, scripts);
    const scriptId = scriptIdentity(scope, input.saveIdempotencyKey);
    const existing = scripts.get(scriptId);
    if (existing) {
      if (existing.inputDigest !== input.inputDigest) {
        throw new ReusableScriptAssetRepositoryError("IDEMPOTENCY_CONFLICT");
      }
      return { asset: clone(existing.asset), replayed: true };
    }
    const selectedIndex = input.scriptSet.variants.findIndex((variant) => variant.id === input.selectedVariantId);
    if (selectedIndex < 0) throw new ReusableScriptAssetRepositoryError("PERSISTENCE_UNAVAILABLE");
    const now = new Date().toISOString();
    const variants = input.scriptSet.variants.map((variant, index) => ({
      ...variant,
      id: deterministicUuid("kong-reusable-script-variant-v1", JSON.stringify([scriptId, variant.id, index + 1])),
      version: index + 1,
      checksum: digest(variant.script),
    }));
    const asset: ReusableScriptAsset = {
      id: scriptId,
      title: input.scriptSet.title,
      source: {
        id: input.sourceItemId,
        category: input.scriptSet.source.type,
        contentHash: input.expectedSourceContentHash,
      },
      ...(input.scriptSet.influencerId ? { influencerId: input.scriptSet.influencerId } : {}),
      language: input.scriptSet.language,
      status: "draft",
      currentVariantId: variants[selectedIndex]!.id,
      variants,
      createdAt: now,
      updatedAt: now,
    };
    scripts.set(scriptId, { inputDigest: input.inputDigest, asset: clone(asset) });
    return { asset: clone(asset), replayed: false };
  }

  async list(scope: TenantScope, request: ReusableScriptAssetListRequest): Promise<ReusableScriptAssetListResponse> {
    const cursor = decodeReusableScriptAssetCursor(scope, request.status, request.cursor);
    const candidates = [...(this.tenants.get(tenantKey(scope))?.values() ?? [])]
      .map((stored) => stored.asset)
      .filter((asset) => !request.status || asset.status === request.status)
      .filter((asset) => !cursor
        || Date.parse(asset.createdAt) < cursor.createdAt.getTime()
        || (Date.parse(asset.createdAt) === cursor.createdAt.getTime() && asset.id < cursor.id))
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt) || right.id.localeCompare(left.id))
      .slice(0, request.limit + 1);
    const hasMore = candidates.length > request.limit;
    const items = candidates.slice(0, request.limit).map(clone);
    return {
      items,
      nextCursor: hasMore && items.length > 0
        ? encodeReusableScriptAssetCursor(scope, request.status, items.at(-1)!)
        : null,
      hasMore,
    };
  }
}

function scriptIdentity(scope: TenantScope, saveIdempotencyKey: string): string {
  return deterministicUuid("kong-reusable-script-asset-v1", JSON.stringify([
    scope.ownerUserId,
    scope.workspaceId,
    saveIdempotencyKey,
  ]));
}
