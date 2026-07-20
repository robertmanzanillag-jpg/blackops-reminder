import { and, asc, desc, eq, gte, lt, sql } from "drizzle-orm";
import {
  aiMediaAnalyticsEvents,
  aiMediaAnalyticsSnapshots,
  aiMediaPublications,
} from "../../../shared/models/ai-media-studio-db";
import type { TenantScope } from "../core/resource-domain";
import type { AiMediaStudioDrizzleDatabase } from "../persistence/drizzle-media-job-repository";
import type {
  AnalyticsEvent,
  AnalyticsFilter,
  AnalyticsMetrics,
  AnalyticsRepository,
  AnalyticsSnapshot,
  CursorPage,
  CursorPageRequest,
  Money,
  Publication,
  PublicationDimensions,
  StoredAnalyticsEventCandidate,
  StoredPublicationCandidate,
} from "./domain";
import { AnalyticsValidationError, assertPublicationMediaReference, normalizeMetrics } from "./domain";

type PublicationRow = typeof aiMediaPublications.$inferSelect;
type SnapshotRow = typeof aiMediaAnalyticsSnapshots.$inferSelect;
type EventRow = typeof aiMediaAnalyticsEvents.$inferSelect;

export type PublishingJobIdentityResolver = (
  scope: TenantScope,
  candidate: StoredPublicationCandidate,
) => Promise<string> | string;

function decodeOffset(cursor: string): number {
  if (!cursor) return 0;
  try {
    const value = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as { offset?: unknown };
    if (!Number.isSafeInteger(value.offset) || (value.offset as number) < 0) throw new Error("invalid");
    return value.offset as number;
  } catch {
    throw new AnalyticsValidationError("cursor is invalid");
  }
}

function nextCursor(offset: number, count: number, limit: number): string | null {
  return count > limit ? Buffer.from(JSON.stringify({ offset: offset + limit })).toString("base64url") : null;
}

function publicationMetadata(candidate: StoredPublicationCandidate): Record<string, unknown> {
  return {
    dimensions: { ...candidate.dimensions },
    generationCost: candidate.generationCost ? { ...candidate.generationCost } : null,
  };
}

function readDimensions(metadata: Record<string, unknown>): PublicationDimensions {
  const value = metadata.dimensions;
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const record = value as Record<string, unknown>;
  const result: PublicationDimensions = {};
  for (const key of ["avatar", "hook", "cta", "postingTime", "category"] as const) {
    if (typeof record[key] === "string") result[key] = record[key];
  }
  return result;
}

function readMoney(metadata: Record<string, unknown>): Money | null {
  const value = metadata.generationCost;
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  return typeof record.amount === "number" && typeof record.currency === "string"
    ? { amount: record.amount, currency: record.currency }
    : null;
}

export function mapAnalyticsPublicationRow(row: PublicationRow): Publication {
  const publication: Publication = {
    id: row.id, ownerUserId: row.ownerUserId, workspaceId: row.workspaceId,
    videoId: row.videoId, mediaAssetId: row.mediaAssetId,
    platform: row.platform as Publication["platform"], status: row.status, permalink: row.permalink,
    publishedAt: row.publishedAt?.toISOString() ?? null, dimensions: readDimensions(row.metadata),
    generationCost: readMoney(row.metadata), createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString(),
  };
  assertPublicationMediaReference(publication);
  return publication;
}

function metricsFromRow(row: SnapshotRow | EventRow): AnalyticsMetrics {
  const extras = row.metrics;
  return normalizeMetrics({
    views: "views" in row ? row.views : extras.views,
    impressions: "impressions" in row ? row.impressions : extras.impressions,
    likes: "likes" in row ? row.likes : extras.likes,
    comments: "comments" in row ? row.comments : extras.comments,
    shares: "shares" in row ? row.shares : extras.shares,
    clicks: extras.clicks,
    ctr: extras.ctr,
    watchTimeMs: "watchTimeMs" in row ? row.watchTimeMs : extras.watchTimeMs,
    retentionRate: extras.retentionRate,
  });
}

export function mapAnalyticsSnapshotRow(row: SnapshotRow): AnalyticsSnapshot {
  return { id: row.id, ownerUserId: row.ownerUserId, workspaceId: row.workspaceId, publicationId: row.publicationId,
    capturedAt: row.capturedAt.toISOString(), metrics: metricsFromRow(row), createdAt: row.createdAt.toISOString() };
}

export function mapAnalyticsEventRow(row: EventRow): AnalyticsEvent {
  const dimensions: AnalyticsEvent["dimensions"] = {};
  for (const [key, value] of Object.entries(row.dimensions)) {
    if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") dimensions[key] = value;
  }
  return { id: row.id, ownerUserId: row.ownerUserId, workspaceId: row.workspaceId, publicationId: row.publicationId,
    source: row.source, eventType: row.eventType, occurredAt: row.occurredAt.toISOString(), dimensions,
    metrics: metricsFromRow(row), createdAt: row.createdAt.toISOString() };
}

function basePredicates(scope: TenantScope, filter: AnalyticsFilter) {
  const predicates = [eq(aiMediaPublications.ownerUserId, scope.ownerUserId), eq(aiMediaPublications.workspaceId, scope.workspaceId)];
  if (filter.platform) predicates.push(eq(aiMediaPublications.platform, filter.platform));
  if (filter.publicationId) predicates.push(eq(aiMediaPublications.id, filter.publicationId));
  if (filter.videoId) predicates.push(eq(aiMediaPublications.videoId, filter.videoId));
  if (filter.mediaAssetId) predicates.push(eq(aiMediaPublications.mediaAssetId, filter.mediaAssetId));
  if (filter.category) predicates.push(sql`${aiMediaPublications.metadata}->'dimensions'->>'category' = ${filter.category}`);
  return predicates;
}

export class DrizzleAnalyticsRepository implements AnalyticsRepository {
  constructor(
    private readonly db: AiMediaStudioDrizzleDatabase,
    private readonly resolvePublishingJobId: PublishingJobIdentityResolver,
  ) {}

  async upsertPublication(scope: TenantScope, candidate: StoredPublicationCandidate): Promise<{ item: Publication; created: boolean }> {
    assertPublicationMediaReference(candidate);
    return this.db.transaction(async (tx) => {
      const [existing] = await tx.select().from(aiMediaPublications).where(and(
        eq(aiMediaPublications.ownerUserId, scope.ownerUserId), eq(aiMediaPublications.workspaceId, scope.workspaceId),
        eq(aiMediaPublications.platform, candidate.platform), eq(aiMediaPublications.externalPublicationId, candidate.externalIdentityDigest),
      )).limit(1);
      if (existing) {
        const [updated] = await tx.update(aiMediaPublications).set({
          videoId: candidate.videoId, mediaAssetId: candidate.mediaAssetId,
          status: candidate.status, permalink: candidate.permalink,
          publishedAt: candidate.publishedAt ? new Date(candidate.publishedAt) : null,
          metadata: publicationMetadata(candidate), updatedAt: new Date(candidate.updatedAt),
        }).where(and(eq(aiMediaPublications.id, existing.id), eq(aiMediaPublications.ownerUserId, scope.ownerUserId),
          eq(aiMediaPublications.workspaceId, scope.workspaceId))).returning();
        if (!updated) throw new Error("Analytics publication update lost its tenant-scoped row");
        return { item: mapAnalyticsPublicationRow(updated), created: false };
      }
      const publishingJobId = await this.resolvePublishingJobId(scope, candidate);
      if (!publishingJobId?.trim()) throw new AnalyticsValidationError("A publishing job identity is required to persist a publication");
      const [created] = await tx.insert(aiMediaPublications).values({
        id: candidate.id, ownerUserId: scope.ownerUserId, workspaceId: scope.workspaceId,
        publishingJobId, videoId: candidate.videoId, mediaAssetId: candidate.mediaAssetId, platform: candidate.platform,
        externalPublicationId: candidate.externalIdentityDigest, status: candidate.status, permalink: candidate.permalink,
        publishedAt: candidate.publishedAt ? new Date(candidate.publishedAt) : null, metadata: publicationMetadata(candidate),
        createdAt: new Date(candidate.createdAt), updatedAt: new Date(candidate.updatedAt),
      }).onConflictDoNothing({ target: [
        aiMediaPublications.ownerUserId,
        aiMediaPublications.workspaceId,
        aiMediaPublications.platform,
        aiMediaPublications.externalPublicationId,
      ] }).returning();
      if (created) return { item: mapAnalyticsPublicationRow(created), created: true };
      const [raced] = await tx.select().from(aiMediaPublications).where(and(
        eq(aiMediaPublications.ownerUserId, scope.ownerUserId), eq(aiMediaPublications.workspaceId, scope.workspaceId),
        eq(aiMediaPublications.platform, candidate.platform), eq(aiMediaPublications.externalPublicationId, candidate.externalIdentityDigest),
      )).limit(1);
      if (!raced) throw new Error("Analytics publication idempotency conflict could not be resolved");
      return { item: mapAnalyticsPublicationRow(raced), created: false };
    });
  }

  async putSnapshot(scope: TenantScope, candidate: Omit<AnalyticsSnapshot, "ownerUserId" | "workspaceId">): Promise<{ item: AnalyticsSnapshot; created: boolean }> {
    return this.db.transaction(async (tx) => {
      const [publication] = await tx.select({ id: aiMediaPublications.id }).from(aiMediaPublications).where(and(
        eq(aiMediaPublications.id, candidate.publicationId), eq(aiMediaPublications.ownerUserId, scope.ownerUserId),
        eq(aiMediaPublications.workspaceId, scope.workspaceId),
      )).limit(1);
      if (!publication) throw new AnalyticsValidationError("Publication not found in this tenant");
      const [created] = await tx.insert(aiMediaAnalyticsSnapshots).values({
        id: candidate.id, ownerUserId: scope.ownerUserId, workspaceId: scope.workspaceId,
        publicationId: candidate.publicationId, capturedAt: new Date(candidate.capturedAt),
        views: candidate.metrics.views, impressions: candidate.metrics.impressions, likes: candidate.metrics.likes,
        comments: candidate.metrics.comments, shares: candidate.metrics.shares, watchTimeMs: candidate.metrics.watchTimeMs,
        metrics: { clicks: candidate.metrics.clicks, ctr: candidate.metrics.ctr, retentionRate: candidate.metrics.retentionRate },
        createdAt: new Date(candidate.createdAt),
      }).onConflictDoNothing({ target: [
        aiMediaAnalyticsSnapshots.ownerUserId,
        aiMediaAnalyticsSnapshots.workspaceId,
        aiMediaAnalyticsSnapshots.publicationId,
        aiMediaAnalyticsSnapshots.capturedAt,
      ] }).returning();
      if (created) return { item: mapAnalyticsSnapshotRow(created), created: true };
      const [existing] = await tx.select().from(aiMediaAnalyticsSnapshots).where(and(
        eq(aiMediaAnalyticsSnapshots.publicationId, candidate.publicationId), eq(aiMediaAnalyticsSnapshots.capturedAt, new Date(candidate.capturedAt)),
        eq(aiMediaAnalyticsSnapshots.ownerUserId, scope.ownerUserId), eq(aiMediaAnalyticsSnapshots.workspaceId, scope.workspaceId),
      )).limit(1);
      if (!existing) throw new Error("Analytics snapshot idempotency conflict could not be resolved");
      return { item: mapAnalyticsSnapshotRow(existing), created: false };
    });
  }

  async putEvent(scope: TenantScope, candidate: StoredAnalyticsEventCandidate): Promise<{ item: AnalyticsEvent; created: boolean }> {
    return this.db.transaction(async (tx) => {
      if (candidate.publicationId) {
        const [publication] = await tx.select({ id: aiMediaPublications.id }).from(aiMediaPublications).where(and(
          eq(aiMediaPublications.id, candidate.publicationId), eq(aiMediaPublications.ownerUserId, scope.ownerUserId), eq(aiMediaPublications.workspaceId, scope.workspaceId),
        )).limit(1);
        if (!publication) throw new AnalyticsValidationError("Publication not found in this tenant");
      }
      const [created] = await tx.insert(aiMediaAnalyticsEvents).values({
        id: candidate.id, ownerUserId: scope.ownerUserId, workspaceId: scope.workspaceId,
        publicationId: candidate.publicationId, source: candidate.source, externalEventId: candidate.externalEventDigest,
        eventType: candidate.eventType, occurredAt: new Date(candidate.occurredAt), dimensions: { ...candidate.dimensions },
        metrics: { ...candidate.metrics }, createdAt: new Date(candidate.createdAt),
      }).onConflictDoNothing({ target: [
        aiMediaAnalyticsEvents.ownerUserId,
        aiMediaAnalyticsEvents.workspaceId,
        aiMediaAnalyticsEvents.source,
        aiMediaAnalyticsEvents.externalEventId,
      ] }).returning();
      if (created) return { item: mapAnalyticsEventRow(created), created: true };
      const [existing] = await tx.select().from(aiMediaAnalyticsEvents).where(and(
        eq(aiMediaAnalyticsEvents.ownerUserId, scope.ownerUserId), eq(aiMediaAnalyticsEvents.workspaceId, scope.workspaceId),
        eq(aiMediaAnalyticsEvents.source, candidate.source), eq(aiMediaAnalyticsEvents.externalEventId, candidate.externalEventDigest),
      )).limit(1);
      if (!existing) throw new Error("Analytics event idempotency conflict could not be resolved");
      return { item: mapAnalyticsEventRow(existing), created: false };
    });
  }

  async listPublications(scope: TenantScope, filter: AnalyticsFilter, page: Required<CursorPageRequest>): Promise<CursorPage<Publication>> {
    const predicates = basePredicates(scope, filter);
    if (filter.window) {
      predicates.push(gte(aiMediaPublications.publishedAt, new Date(filter.window.start)));
      predicates.push(lt(aiMediaPublications.publishedAt, new Date(filter.window.end)));
    }
    const offset = decodeOffset(page.cursor);
    const rows = await this.db.select().from(aiMediaPublications).where(and(...predicates))
      .orderBy(desc(aiMediaPublications.publishedAt), asc(aiMediaPublications.id)).limit(page.limit + 1).offset(offset);
    return { items: rows.slice(0, page.limit).map(mapAnalyticsPublicationRow), nextCursor: nextCursor(offset, rows.length, page.limit) };
  }

  async listSnapshots(scope: TenantScope, filter: AnalyticsFilter, page: Required<CursorPageRequest>): Promise<CursorPage<AnalyticsSnapshot>> {
    const predicates = [
      eq(aiMediaAnalyticsSnapshots.ownerUserId, scope.ownerUserId), eq(aiMediaAnalyticsSnapshots.workspaceId, scope.workspaceId),
      ...basePredicates(scope, filter),
    ];
    if (filter.window) {
      predicates.push(gte(aiMediaAnalyticsSnapshots.capturedAt, new Date(filter.window.start)));
      predicates.push(lt(aiMediaAnalyticsSnapshots.capturedAt, new Date(filter.window.end)));
    }
    const offset = decodeOffset(page.cursor);
    const rows = await this.db.select({ snapshot: aiMediaAnalyticsSnapshots }).from(aiMediaAnalyticsSnapshots)
      .innerJoin(aiMediaPublications, eq(aiMediaPublications.id, aiMediaAnalyticsSnapshots.publicationId))
      .where(and(...predicates)).orderBy(desc(aiMediaAnalyticsSnapshots.capturedAt), asc(aiMediaAnalyticsSnapshots.id))
      .limit(page.limit + 1).offset(offset);
    return { items: rows.slice(0, page.limit).map((row) => mapAnalyticsSnapshotRow(row.snapshot)), nextCursor: nextCursor(offset, rows.length, page.limit) };
  }

  async listEvents(scope: TenantScope, filter: AnalyticsFilter, page: Required<CursorPageRequest>): Promise<CursorPage<AnalyticsEvent>> {
    const predicates = [eq(aiMediaAnalyticsEvents.ownerUserId, scope.ownerUserId), eq(aiMediaAnalyticsEvents.workspaceId, scope.workspaceId)];
    if (filter.publicationId) predicates.push(eq(aiMediaAnalyticsEvents.publicationId, filter.publicationId));
    if (filter.window) {
      predicates.push(gte(aiMediaAnalyticsEvents.occurredAt, new Date(filter.window.start)));
      predicates.push(lt(aiMediaAnalyticsEvents.occurredAt, new Date(filter.window.end)));
    }
    const offset = decodeOffset(page.cursor);
    const requiresPublication = filter.platform || filter.videoId || filter.mediaAssetId || filter.category;
    const base = this.db.select({ event: aiMediaAnalyticsEvents }).from(aiMediaAnalyticsEvents);
    const query = requiresPublication
      ? base.innerJoin(aiMediaPublications, eq(aiMediaPublications.id, aiMediaAnalyticsEvents.publicationId)).where(and(...predicates, ...basePredicates(scope, filter)))
      : base.where(and(...predicates));
    const rows = await query.orderBy(desc(aiMediaAnalyticsEvents.occurredAt), asc(aiMediaAnalyticsEvents.id)).limit(page.limit + 1).offset(offset);
    return { items: rows.slice(0, page.limit).map((row) => mapAnalyticsEventRow(row.event)), nextCursor: nextCursor(offset, rows.length, page.limit) };
  }
}
