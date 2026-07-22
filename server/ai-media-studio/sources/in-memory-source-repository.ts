import { randomUUID } from "node:crypto";
import type { TenantScope } from "../core/resource-domain";
import {
  MAX_SOURCE_SNAPSHOT_ITEMS,
  type CanonicalSourceItem,
  type SourceCategory,
  type SourceEligibilityReviewInput,
  type SourceEligibilityReviewResult,
  type SourcePage,
  type SourcePageRequest,
  type SourceRepository,
  SourceEligibilityRepositoryError,
} from "./contracts";
import { boundedSourcePageLimit, decodeSourceCursor, encodeSourceCursor, sourceListFilter } from "./source-pagination";

function tenantKey(scope: TenantScope): string {
  return `${scope.ownerUserId}\u0000${scope.workspaceId}`;
}

function clone(item: CanonicalSourceItem): CanonicalSourceItem {
  return { ...item, payload: structuredClone(item.payload) };
}

export class InMemorySourceRepository implements SourceRepository {
  private readonly tenants = new Map<string, Map<string, CanonicalSourceItem>>();
  private readonly identities = new Map<string, Map<string, string>>();
  private readonly reviews = new Map<string, Map<string, {
    idempotencyKey: string;
    inputDigest: string;
    reviewedAt: string;
  }>>();

  async upsertByContentHash(
    scope: TenantScope,
    input: Omit<CanonicalSourceItem, "id" | "ownerUserId" | "workspaceId" | "createdAt" | "updatedAt">,
  ): Promise<{ item: CanonicalSourceItem; created: boolean }> {
    const key = tenantKey(scope);
    const byId = this.tenants.get(key) ?? new Map<string, CanonicalSourceItem>();
    const byIdentity = this.identities.get(key) ?? new Map<string, string>();
    this.tenants.set(key, byId);
    this.identities.set(key, byIdentity);
    const identity = `${input.category}\u0000${input.adapterKey}\u0000${input.providerExternalId}`;
    const existingId = byIdentity.get(identity);
    const existing = existingId ? byId.get(existingId) : undefined;
    const now = new Date().toISOString();
    if (existing) {
      if (existing.contentHash === input.contentHash) return { item: clone(existing), created: false };
      const governanceProtected = existing.status === "rejected" || existing.status === "archived";
      const updated: CanonicalSourceItem = {
        ...existing,
        ...input,
        ...(governanceProtected ? {
          rightsStatus: existing.rightsStatus,
          moderationStatus: existing.moderationStatus,
          status: existing.status,
        } : {}),
        payload: structuredClone(input.payload),
        updatedAt: now,
      };
      byId.set(existing.id, updated);
      if (!governanceProtected) this.reviews.get(key)?.delete(existing.id);
      return { item: clone(updated), created: false };
    }
    const item: CanonicalSourceItem = {
      ...input,
      id: randomUUID(),
      ownerUserId: scope.ownerUserId,
      workspaceId: scope.workspaceId,
      payload: structuredClone(input.payload),
      createdAt: now,
      updatedAt: now,
    };
    byId.set(item.id, item);
    byIdentity.set(identity, item.id);
    return { item: clone(item), created: true };
  }

  async get(scope: TenantScope, id: string): Promise<CanonicalSourceItem | undefined> {
    const found = this.tenants.get(tenantKey(scope))?.get(id);
    return found ? clone(found) : undefined;
  }

  async list(scope: TenantScope, options: { limit?: number; category?: SourceCategory } = {}): Promise<CanonicalSourceItem[]> {
    const limit = Math.min(Math.max(options.limit ?? 25, 1), MAX_SOURCE_SNAPSHOT_ITEMS);
    return [...(this.tenants.get(tenantKey(scope))?.values() ?? [])]
      .filter((item) => !options.category || item.category === options.category)
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id))
      .slice(0, limit)
      .map(clone);
  }

  async listPage(scope: TenantScope, request: SourcePageRequest = {}): Promise<SourcePage> {
    const limit = boundedSourcePageLimit(request.limit);
    const filter = sourceListFilter(request);
    const cursor = decodeSourceCursor(scope, filter, request.cursor);
    const rows = [...(this.tenants.get(tenantKey(scope))?.values() ?? [])]
      .filter((item) => !filter.category || item.category === filter.category)
      .filter((item) => !filter.status || item.status === filter.status)
      .filter((item) => !filter.rightsStatus || item.rightsStatus === filter.rightsStatus)
      .filter((item) => !cursor
        || Date.parse(item.createdAt) > cursor.createdAt.getTime()
        || (Date.parse(item.createdAt) === cursor.createdAt.getTime() && item.id > cursor.id))
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id))
      .slice(0, limit + 1);
    const hasMore = rows.length > limit;
    const items = rows.slice(0, limit).map(clone);
    return {
      items,
      nextCursor: hasMore && items.length > 0 ? encodeSourceCursor(scope, filter, items.at(-1)!) : null,
      hasMore,
    };
  }

  async reviewEligibility(
    scope: TenantScope,
    input: SourceEligibilityReviewInput,
  ): Promise<SourceEligibilityReviewResult> {
    const key = tenantKey(scope);
    const byId = this.tenants.get(key);
    const existing = byId?.get(input.sourceItemId);
    if (!existing) throw new SourceEligibilityRepositoryError("NOT_FOUND");
    if (existing.contentHash !== input.expectedContentHash) {
      throw new SourceEligibilityRepositoryError("SOURCE_REFRESHED");
    }
    const reviews = this.reviews.get(key) ?? new Map();
    this.reviews.set(key, reviews);
    const prior = reviews.get(existing.id);
    if (prior) {
      if (prior.idempotencyKey !== input.idempotencyKey || prior.inputDigest !== input.inputDigest) {
        throw new SourceEligibilityRepositoryError("REVIEW_CONFLICT");
      }
      return { item: clone(existing), replayed: true, reviewedAt: prior.reviewedAt };
    }
    if (existing.status !== "discovered" || existing.rightsStatus !== "unknown"
      || existing.moderationStatus !== "pending") {
      throw new SourceEligibilityRepositoryError("REVIEW_CONFLICT");
    }
    const reviewedAt = new Date().toISOString();
    const updated: CanonicalSourceItem = input.review.decision === "approve"
      ? {
          ...existing,
          status: "accepted",
          rightsStatus: input.review.rightsStatus,
          moderationStatus: "approved",
          updatedAt: reviewedAt,
        }
      : {
          ...existing,
          status: "rejected",
          rightsStatus: "rejected",
          moderationStatus: "rejected",
          updatedAt: reviewedAt,
        };
    byId!.set(existing.id, updated);
    reviews.set(existing.id, {
      idempotencyKey: input.idempotencyKey,
      inputDigest: input.inputDigest,
      reviewedAt,
    });
    return { item: clone(updated), replayed: false, reviewedAt };
  }
}
