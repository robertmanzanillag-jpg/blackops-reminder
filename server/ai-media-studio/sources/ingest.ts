import type { TenantScope } from "../core/resource-domain";
import { sourceContentHash } from "./content-hash";
import {
  DEFAULT_SOURCE_SNAPSHOT_ITEMS,
  MAX_SOURCE_SNAPSHOT_ITEMS,
  type IngestSourceSnapshotResult,
  type SourceAdapter,
  type SourceRepository,
} from "./contracts";

function boundedLimit(limit: number | undefined): number {
  if (limit === undefined) return DEFAULT_SOURCE_SNAPSHOT_ITEMS;
  if (!Number.isInteger(limit) || limit < 1) throw new Error("Source snapshot limit must be a positive integer");
  return Math.min(limit, MAX_SOURCE_SNAPSHOT_ITEMS);
}

export async function ingestSourceSnapshot(
  scope: TenantScope,
  adapter: SourceAdapter,
  repository: Pick<SourceRepository, "upsertByContentHash">,
  options: { cursor?: string; limit?: number } = {},
): Promise<IngestSourceSnapshotResult> {
  const limit = boundedLimit(options.limit);
  const snapshot = await adapter.fetchSnapshot(scope, { cursor: options.cursor, limit });
  const selected = snapshot.items.slice(0, limit);
  const results = [];
  let createdCount = 0;

  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(adapter.key)) {
    throw new Error("Source adapter key must be a stable provider-neutral identifier");
  }

  for (const candidate of selected) {
    if (!candidate.providerExternalId.trim()) throw new Error(`Source adapter ${adapter.key} returned an empty external ID`);
    if (!candidate.canonicalUrl?.trim() && !candidate.title?.trim() && !candidate.content?.trim()) {
      throw new Error(`Source adapter ${adapter.key} returned an item without canonical content`);
    }
    if (!adapter.categories.includes(candidate.category)) {
      throw new Error(`Source adapter ${adapter.key} returned unsupported category ${candidate.category}`);
    }
    const saved = await repository.upsertByContentHash(scope, {
      adapterKey: adapter.key,
      providerExternalId: candidate.providerExternalId,
      category: candidate.category,
      canonicalUrl: candidate.canonicalUrl,
      title: candidate.title,
      content: candidate.content,
      contentHash: sourceContentHash(candidate),
      rightsStatus: "unknown",
      moderationStatus: "pending",
      status: "discovered",
      sourcePublishedAt: candidate.sourcePublishedAt,
      payload: { ...(candidate.payload ?? {}) },
    });
    results.push(saved.item);
    if (saved.created) createdCount += 1;
  }

  return {
    items: results,
    createdCount,
    duplicateCount: results.length - createdCount,
    nextCursor: snapshot.nextCursor,
    capturedAt: snapshot.capturedAt,
    truncated: snapshot.items.length > selected.length,
  };
}
