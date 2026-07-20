import type { TenantScope } from "../core/resource-domain";
import type {
  AnalyticsEvent,
  AnalyticsFilter,
  AnalyticsRepository,
  AnalyticsSnapshot,
  CursorPage,
  CursorPageRequest,
  Publication,
  StoredAnalyticsEventCandidate,
  StoredPublicationCandidate,
} from "./domain";
import { AnalyticsValidationError, assertPublicationMediaReference } from "./domain";

type StoredPublication = Publication & { externalIdentityDigest: string };
type StoredEvent = AnalyticsEvent & { externalEventDigest: string };

function tenantKey(scope: TenantScope): string {
  return `${scope.ownerUserId}\0${scope.workspaceId}`;
}

function clonePublication({ externalIdentityDigest: _digest, ...item }: StoredPublication): Publication {
  return { ...item, dimensions: { ...item.dimensions }, generationCost: item.generationCost ? { ...item.generationCost } : null };
}

function cloneSnapshot(item: AnalyticsSnapshot): AnalyticsSnapshot {
  return { ...item, metrics: { ...item.metrics } };
}

function cloneEvent({ externalEventDigest: _digest, ...item }: StoredEvent): AnalyticsEvent {
  return { ...item, dimensions: { ...item.dimensions }, metrics: { ...item.metrics } };
}

function cursorIndex(cursor: string): number {
  if (!cursor) return 0;
  try {
    const decoded = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as { offset?: unknown };
    if (!Number.isSafeInteger(decoded.offset) || (decoded.offset as number) < 0) throw new Error("invalid");
    return decoded.offset as number;
  } catch {
    throw new AnalyticsValidationError("cursor is invalid");
  }
}

function page<T>(items: T[], request: Required<CursorPageRequest>): CursorPage<T> {
  const offset = cursorIndex(request.cursor);
  const result = items.slice(offset, offset + request.limit);
  const nextOffset = offset + result.length;
  return { items: result, nextCursor: nextOffset < items.length ? Buffer.from(JSON.stringify({ offset: nextOffset })).toString("base64url") : null };
}

function within(value: string | null, filter: AnalyticsFilter): boolean {
  if (!filter.window) return true;
  return value !== null && value >= filter.window.start && value < filter.window.end;
}

export class InMemoryAnalyticsRepository implements AnalyticsRepository {
  private readonly publications = new Map<string, StoredPublication>();
  private readonly snapshots = new Map<string, AnalyticsSnapshot>();
  private readonly events = new Map<string, StoredEvent>();

  private matchingPublications(scope: TenantScope, filter: AnalyticsFilter): StoredPublication[] {
    return [...this.publications.values()].filter((item) =>
      item.ownerUserId === scope.ownerUserId && item.workspaceId === scope.workspaceId &&
      (!filter.platform || item.platform === filter.platform) && (!filter.publicationId || item.id === filter.publicationId) &&
      (!filter.videoId || item.videoId === filter.videoId) && (!filter.category || item.dimensions.category === filter.category) &&
      (!filter.mediaAssetId || item.mediaAssetId === filter.mediaAssetId) &&
      within(item.publishedAt, filter));
  }

  async upsertPublication(scope: TenantScope, candidate: StoredPublicationCandidate): Promise<{ item: Publication; created: boolean }> {
    assertPublicationMediaReference(candidate);
    const identity = `${tenantKey(scope)}\0${candidate.externalIdentityDigest}`;
    const existing = [...this.publications.values()].find((item) => `${tenantKey(item)}\0${item.externalIdentityDigest}` === identity);
    if (existing) {
      const updated: StoredPublication = {
        ...existing,
        videoId: candidate.videoId,
        mediaAssetId: candidate.mediaAssetId,
        platform: candidate.platform,
        status: candidate.status,
        permalink: candidate.permalink,
        publishedAt: candidate.publishedAt,
        dimensions: { ...candidate.dimensions },
        generationCost: candidate.generationCost ? { ...candidate.generationCost } : null,
        updatedAt: candidate.updatedAt,
      };
      this.publications.set(`${tenantKey(scope)}\0${existing.id}`, updated);
      return { item: clonePublication(updated), created: false };
    }
    const stored: StoredPublication = { ...candidate, ownerUserId: scope.ownerUserId, workspaceId: scope.workspaceId,
      dimensions: { ...candidate.dimensions }, generationCost: candidate.generationCost ? { ...candidate.generationCost } : null };
    this.publications.set(`${tenantKey(scope)}\0${stored.id}`, stored);
    return { item: clonePublication(stored), created: true };
  }

  async putSnapshot(scope: TenantScope, candidate: Omit<AnalyticsSnapshot, "ownerUserId" | "workspaceId">): Promise<{ item: AnalyticsSnapshot; created: boolean }> {
    const publication = this.publications.get(`${tenantKey(scope)}\0${candidate.publicationId}`);
    if (!publication) throw new AnalyticsValidationError("Publication not found in this tenant");
    const identity = `${tenantKey(scope)}\0${candidate.publicationId}\0${candidate.capturedAt}`;
    const existing = this.snapshots.get(identity);
    if (existing) return { item: cloneSnapshot(existing), created: false };
    const stored = { ...candidate, ownerUserId: scope.ownerUserId, workspaceId: scope.workspaceId, metrics: { ...candidate.metrics } };
    this.snapshots.set(identity, stored);
    return { item: cloneSnapshot(stored), created: true };
  }

  async putEvent(scope: TenantScope, candidate: StoredAnalyticsEventCandidate): Promise<{ item: AnalyticsEvent; created: boolean }> {
    if (candidate.publicationId && !this.publications.has(`${tenantKey(scope)}\0${candidate.publicationId}`)) {
      throw new AnalyticsValidationError("Publication not found in this tenant");
    }
    const identity = `${tenantKey(scope)}\0${candidate.source}\0${candidate.externalEventDigest}`;
    const existing = this.events.get(identity);
    if (existing) return { item: cloneEvent(existing), created: false };
    const stored: StoredEvent = { ...candidate, ownerUserId: scope.ownerUserId, workspaceId: scope.workspaceId,
      dimensions: { ...candidate.dimensions }, metrics: { ...candidate.metrics } };
    this.events.set(identity, stored);
    return { item: cloneEvent(stored), created: true };
  }

  async listPublications(scope: TenantScope, filter: AnalyticsFilter, request: Required<CursorPageRequest>): Promise<CursorPage<Publication>> {
    const items = this.matchingPublications(scope, filter)
      .sort((a, b) => (b.publishedAt ?? b.createdAt).localeCompare(a.publishedAt ?? a.createdAt) || a.id.localeCompare(b.id));
    return page(items.map(clonePublication), request);
  }

  async listSnapshots(scope: TenantScope, filter: AnalyticsFilter, request: Required<CursorPageRequest>): Promise<CursorPage<AnalyticsSnapshot>> {
    const allowed = new Set(this.matchingPublications(scope, { ...filter, window: undefined }).map((item) => item.id));
    const items = [...this.snapshots.values()].filter((item) => item.ownerUserId === scope.ownerUserId && item.workspaceId === scope.workspaceId &&
      allowed.has(item.publicationId) && (!filter.publicationId || item.publicationId === filter.publicationId) && within(item.capturedAt, filter))
      .sort((a, b) => b.capturedAt.localeCompare(a.capturedAt) || a.id.localeCompare(b.id));
    return page(items.map(cloneSnapshot), request);
  }

  async listEvents(scope: TenantScope, filter: AnalyticsFilter, request: Required<CursorPageRequest>): Promise<CursorPage<AnalyticsEvent>> {
    const publications = [...this.publications.values()].filter((item) => item.ownerUserId === scope.ownerUserId && item.workspaceId === scope.workspaceId &&
      (!filter.platform || item.platform === filter.platform) && (!filter.videoId || item.videoId === filter.videoId) &&
      (!filter.mediaAssetId || item.mediaAssetId === filter.mediaAssetId) &&
      (!filter.category || item.dimensions.category === filter.category));
    const allowed = new Set(publications.map((item) => item.id));
    const items = [...this.events.values()].filter((item) => item.ownerUserId === scope.ownerUserId && item.workspaceId === scope.workspaceId &&
      (!filter.publicationId || item.publicationId === filter.publicationId) &&
      ((!filter.platform && !filter.videoId && !filter.mediaAssetId && !filter.category) || (item.publicationId !== null && allowed.has(item.publicationId))) && within(item.occurredAt, filter))
      .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt) || a.id.localeCompare(b.id));
    return page(items.map(cloneEvent), request);
  }
}
