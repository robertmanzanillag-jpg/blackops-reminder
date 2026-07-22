import {
  sourceAutomationSyncResponseSchema,
  type SourceAutomationSyncRequest,
  type SourceAutomationSyncResponse,
} from "../../../shared/ai-media-studio-operations";
import type { TenantScope } from "../core/resource-domain";
import {
  MAX_SOURCE_SNAPSHOT_ITEMS,
  SOURCE_CATEGORIES,
  type JsonValue,
  type SourceAdapter,
  type SourceAdapterItem,
  type SourceRepository,
  type SourceSnapshotRequest,
} from "./contracts";
import { ingestSourceSnapshot } from "./ingest";

const ADAPTER_KEY = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;
const MAX_SOURCE_FIELD_BYTES = 100_000;

export type SourceAutomationSyncErrorCode =
  | "INVALID_CONFIGURATION"
  | "INVALID_REQUEST"
  | "ADAPTER_UNAVAILABLE"
  | "SYNC_UNAVAILABLE";

export class SourceAutomationSyncError extends Error {
  readonly statusCode: number;

  constructor(readonly code: SourceAutomationSyncErrorCode) {
    super("Source automation synchronization is unavailable");
    this.name = "SourceAutomationSyncError";
    this.statusCode = code === "INVALID_REQUEST" ? 400
      : code === "ADAPTER_UNAVAILABLE" || code === "SYNC_UNAVAILABLE" ? 503
        : 500;
  }
}

export interface PublicSourceAdapterDescriptor {
  adapterKey: string;
  categories: readonly (typeof SOURCE_CATEGORIES)[number][];
}

/**
 * Explicit source-only synchronization boundary. The server owns every adapter;
 * callers may select only a registered key and a bounded item count. This
 * service never constructs script, render, provider-video, publishing or
 * deployment dependencies.
 */
export class SourceAutomationSyncService {
  private readonly adapters: ReadonlyMap<string, SourceAdapter>;

  constructor(adapters: readonly SourceAdapter[], private readonly repository: SourceRepository) {
    if (!repository || typeof repository.upsertByContentHash !== "function") {
      throw new SourceAutomationSyncError("INVALID_CONFIGURATION");
    }
    const indexed = new Map<string, SourceAdapter>();
    for (const adapter of adapters) {
      const adapterKey = adapter?.key;
      const categories = Array.isArray(adapter?.categories) ? [...adapter.categories] : [];
      const fetchSnapshot = adapter?.fetchSnapshot;
      if (typeof adapterKey !== "string" || !ADAPTER_KEY.test(adapterKey)
        || categories.length === 0
        || categories.some((category) => !SOURCE_CATEGORIES.includes(category))
        || typeof fetchSnapshot !== "function"
        || indexed.has(adapterKey)) {
        throw new SourceAutomationSyncError("INVALID_CONFIGURATION");
      }
      indexed.set(adapterKey, Object.freeze({
        key: adapterKey,
        categories: Object.freeze(categories),
        fetchSnapshot: (scope: TenantScope, request: SourceSnapshotRequest) =>
          Reflect.apply(fetchSnapshot, adapter, [scope, request]),
      }));
    }
    this.adapters = indexed;
  }

  listAdapters(): readonly PublicSourceAdapterDescriptor[] {
    return [...this.adapters.values()].map((adapter) => Object.freeze({
      adapterKey: adapter.key,
      categories: Object.freeze([...adapter.categories]),
    }));
  }

  async sync(scope: TenantScope, input: SourceAutomationSyncRequest): Promise<SourceAutomationSyncResponse> {
    if (!scope.ownerUserId.trim() || !scope.workspaceId.trim()
      || !ADAPTER_KEY.test(input.adapterKey)
      || !Number.isInteger(input.limit)
      || input.limit < 1
      || input.limit > MAX_SOURCE_SNAPSHOT_ITEMS) {
      throw new SourceAutomationSyncError("INVALID_REQUEST");
    }
    const adapter = this.adapters.get(input.adapterKey);
    if (!adapter) throw new SourceAutomationSyncError("ADAPTER_UNAVAILABLE");

    try {
      const result = await ingestSourceSnapshot(
        scope,
        guardedAdapter(adapter),
        this.repository,
        { limit: input.limit },
      );
      return sourceAutomationSyncResponseSchema.parse({
        adapterKey: adapter.key,
        capturedAt: result.capturedAt,
        truncated: result.truncated,
        createdCount: result.createdCount,
        duplicateCount: result.duplicateCount,
        items: result.items.map((item) => ({
          id: item.id,
          category: item.category,
          status: item.status,
          rightsStatus: item.rightsStatus,
          moderationStatus: item.moderationStatus,
          createdAt: item.createdAt,
          updatedAt: item.updatedAt,
        })),
        downstreamState: "blocked",
        effects: {
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
        },
      });
    } catch (error) {
      if (error instanceof SourceAutomationSyncError) throw error;
      throw new SourceAutomationSyncError("SYNC_UNAVAILABLE");
    }
  }
}

function guardedAdapter(adapter: SourceAdapter): SourceAdapter {
  return {
    key: adapter.key,
    categories: adapter.categories,
    async fetchSnapshot(scope: TenantScope, request: SourceSnapshotRequest) {
      let snapshot: Awaited<ReturnType<SourceAdapter["fetchSnapshot"]>>;
      try {
        snapshot = await adapter.fetchSnapshot(scope, request);
      } catch {
        throw new SourceAutomationSyncError("ADAPTER_UNAVAILABLE");
      }
      try {
        const rawItems = snapshot?.items;
        const capturedAt = snapshot?.capturedAt;
        const nextCursor = snapshot?.nextCursor;
        if (!Array.isArray(rawItems)
          || rawItems.length > MAX_SOURCE_SNAPSHOT_ITEMS + 1
          || !isIsoDate(capturedAt)
          || (nextCursor !== undefined
            && (typeof nextCursor !== "string" || nextCursor.length > 2_048))) {
          throw new SourceAutomationSyncError("ADAPTER_UNAVAILABLE");
        }
        const items = Array.from(rawItems, (item) => normalizeAdapterItem(adapter, item));
        return Object.freeze({
          items: Object.freeze(items),
          capturedAt,
          ...(nextCursor !== undefined ? { nextCursor } : {}),
        });
      } catch (error) {
        if (error instanceof SourceAutomationSyncError) throw error;
        throw new SourceAutomationSyncError("ADAPTER_UNAVAILABLE");
      }
    },
  };
}

function normalizeAdapterItem(adapter: SourceAdapter, item: SourceAdapterItem): SourceAdapterItem {
  if (!item || typeof item !== "object") {
    throw new SourceAutomationSyncError("ADAPTER_UNAVAILABLE");
  }
  const candidate = item as unknown as Record<string, unknown>;
  const providerExternalId = candidate.providerExternalId;
  const category = candidate.category;
  const canonicalUrl = candidate.canonicalUrl;
  const title = candidate.title;
  const content = candidate.content;
  const sourcePublishedAt = candidate.sourcePublishedAt;
  const fingerprint = cloneJsonRecord(candidate.fingerprint);
  const payload = cloneJsonRecord(candidate.payload);
  const material = [providerExternalId, canonicalUrl, title, content]
    .filter((value): value is string => typeof value === "string");
  if (typeof providerExternalId !== "string" || !providerExternalId.trim()
    || providerExternalId.length > 500
    || typeof category !== "string"
    || !adapter.categories.includes(category as SourceAdapterItem["category"])
    || (canonicalUrl !== undefined && typeof canonicalUrl !== "string")
    || (title !== undefined && typeof title !== "string")
    || (content !== undefined && typeof content !== "string")
    || (!canonicalUrl?.trim() && !title?.trim() && !content?.trim())
    || material.some((value) => Buffer.byteLength(value, "utf8") > MAX_SOURCE_FIELD_BYTES)
    || (canonicalUrl !== undefined && !isPublicHttpsUrl(canonicalUrl))
    || (sourcePublishedAt !== undefined && !isIsoDate(sourcePublishedAt))) {
    throw new SourceAutomationSyncError("ADAPTER_UNAVAILABLE");
  }
  return Object.freeze({
    providerExternalId,
    category: category as SourceAdapterItem["category"],
    ...(canonicalUrl !== undefined ? { canonicalUrl } : {}),
    ...(title !== undefined ? { title } : {}),
    ...(content !== undefined ? { content } : {}),
    ...(sourcePublishedAt !== undefined ? { sourcePublishedAt } : {}),
    ...(fingerprint !== undefined ? { fingerprint } : {}),
    ...(payload !== undefined ? { payload } : {}),
  });
}

function isIsoDate(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    return new Date(value).toISOString() === value;
  } catch {
    return false;
  }
}

function isPublicHttpsUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && Boolean(url.hostname) && !url.username && !url.password;
  } catch {
    return false;
  }
}

function cloneJsonRecord(value: unknown): Record<string, JsonValue> | undefined {
  if (value === undefined) return undefined;
  if (Array.isArray(value) || value === null || typeof value !== "object") {
    throw new SourceAutomationSyncError("ADAPTER_UNAVAILABLE");
  }
  try {
    const normalized = normalizeJsonValue(value, new Set(), 0);
    if (Array.isArray(normalized) || normalized === null || typeof normalized !== "object") {
      throw new SourceAutomationSyncError("ADAPTER_UNAVAILABLE");
    }
    const serialized = JSON.stringify(normalized);
    if (Buffer.byteLength(serialized, "utf8") > MAX_SOURCE_FIELD_BYTES) {
      throw new SourceAutomationSyncError("ADAPTER_UNAVAILABLE");
    }
    return JSON.parse(serialized) as Record<string, JsonValue>;
  } catch {
    throw new SourceAutomationSyncError("ADAPTER_UNAVAILABLE");
  }
}

function normalizeJsonValue(value: unknown, seen: Set<object>, depth: number): JsonValue {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "object" || depth > 20 || seen.has(value)) {
    throw new SourceAutomationSyncError("ADAPTER_UNAVAILABLE");
  }
  seen.add(value);
  try {
    if (Array.isArray(value)) {
      return Array.from(value, (item) => normalizeJsonValue(item, seen, depth + 1));
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new SourceAutomationSyncError("ADAPTER_UNAVAILABLE");
    }
    const result: Record<string, JsonValue> = {};
    for (const key of Object.keys(value)) {
      result[key] = normalizeJsonValue((value as Record<string, unknown>)[key], seen, depth + 1);
    }
    return result;
  } finally {
    seen.delete(value);
  }
}
