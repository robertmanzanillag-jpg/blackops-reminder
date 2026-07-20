import { randomUUID } from "node:crypto";
import { and, asc, eq, gt, inArray, or, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { aiMediaSourceItems } from "../../../shared/models/ai-media-studio-db";
import type { TenantScope } from "../core/resource-domain";
import {
  MAX_SOURCE_SNAPSHOT_ITEMS,
  SOURCE_CATEGORIES,
  type CanonicalSourceItem,
  type SourceCategory,
  type SourcePage,
  type SourcePageRequest,
  type SourceRepository,
} from "./contracts";
import { boundedSourcePageLimit, decodeSourceCursor, encodeSourceCursor, sourceListFilter } from "./source-pagination";

export function sourceExternalIdentity(adapterKey: string, providerExternalId: string): string {
  return `${adapterKey}:${providerExternalId}`;
}

const storedCategory = sql<string>`${aiMediaSourceItems.payload}->>'category'`;

function categoryPredicate(category?: SourceCategory) {
  return category
    ? or(eq(aiMediaSourceItems.sourceType, category), eq(storedCategory, category))
    : or(
      inArray(aiMediaSourceItems.sourceType, [...SOURCE_CATEGORIES]),
      inArray(storedCategory, [...SOURCE_CATEGORIES]),
    );
}

export function mapSourceRow(row: typeof aiMediaSourceItems.$inferSelect): CanonicalSourceItem {
  const payload = row.payload;
  const category = SOURCE_CATEGORIES.includes(row.sourceType as SourceCategory) ? row.sourceType : payload.category;
  if (!SOURCE_CATEGORIES.includes(category as SourceCategory)) throw new Error("Stored source category is invalid");
  const contentHash = row.contentHash ?? payload.contentHash;
  if (typeof contentHash !== "string" || !/^sha256:[a-f0-9]{64}$/.test(contentHash)) {
    throw new Error("Stored source content hash is invalid");
  }
  return {
    id: row.id,
    ownerUserId: row.ownerUserId,
    workspaceId: row.workspaceId,
    adapterKey: String(payload.adapterKey ?? row.externalId.split(":", 1)[0]),
    providerExternalId: String(payload.providerExternalId ?? row.externalId.slice(row.externalId.indexOf(":") + 1)),
    category: category as SourceCategory,
    canonicalUrl: row.canonicalUrl ?? undefined,
    title: row.title ?? undefined,
    content: row.content ?? undefined,
    contentHash: contentHash as `sha256:${string}`,
    rightsStatus: row.rightsStatus as CanonicalSourceItem["rightsStatus"],
    moderationStatus: (row.moderationStatus ?? payload.moderationStatus) as CanonicalSourceItem["moderationStatus"],
    status: row.status as CanonicalSourceItem["status"],
    sourcePublishedAt: row.sourcePublishedAt?.toISOString(),
    payload: (payload.data ?? {}) as CanonicalSourceItem["payload"],
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export class DrizzleSourceRepository implements SourceRepository {
  constructor(private readonly db: NodePgDatabase) {}

  async upsertByContentHash(
    scope: TenantScope,
    input: Omit<CanonicalSourceItem, "id" | "ownerUserId" | "workspaceId" | "createdAt" | "updatedAt">,
  ): Promise<{ item: CanonicalSourceItem; created: boolean }> {
    return this.db.transaction(async (tx) => {
      const now = new Date();
      const externalId = sourceExternalIdentity(input.adapterKey, input.providerExternalId);
      const lockKey = `${scope.ownerUserId}\u0000${scope.workspaceId}\u0000${input.category}\u0000${externalId}`;
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`);
      const [existing] = await tx.select().from(aiMediaSourceItems).where(and(
        eq(aiMediaSourceItems.ownerUserId, scope.ownerUserId),
        eq(aiMediaSourceItems.workspaceId, scope.workspaceId),
        eq(aiMediaSourceItems.sourceType, input.category),
        eq(aiMediaSourceItems.externalId, externalId),
      )).limit(1);
      if (existing) {
        if (existing.contentHash === input.contentHash) return { item: mapSourceRow(existing), created: false };
        const [updated] = await tx.update(aiMediaSourceItems).set({
          canonicalUrl: input.canonicalUrl,
          title: input.title,
          content: input.content,
          contentHash: input.contentHash,
          rightsStatus: input.rightsStatus,
          moderationStatus: input.moderationStatus,
          moderationEvidence: {},
          automationEvidence: {},
          status: input.status,
          sourcePublishedAt: input.sourcePublishedAt ? new Date(input.sourcePublishedAt) : null,
          payload: { adapterKey: input.adapterKey, providerExternalId: input.providerExternalId, data: input.payload },
          updatedAt: now,
        }).where(and(
          eq(aiMediaSourceItems.id, existing.id),
          eq(aiMediaSourceItems.ownerUserId, scope.ownerUserId),
          eq(aiMediaSourceItems.workspaceId, scope.workspaceId),
        )).returning();
        if (!updated) throw new Error("Source identity update lost its tenant-scoped row");
        return { item: mapSourceRow(updated), created: false };
      }
      const [created] = await tx.insert(aiMediaSourceItems).values({
        id: randomUUID(),
        ownerUserId: scope.ownerUserId,
        workspaceId: scope.workspaceId,
        sourceType: input.category,
        externalId,
        canonicalUrl: input.canonicalUrl,
        title: input.title,
        content: input.content,
        contentHash: input.contentHash,
        rightsStatus: input.rightsStatus,
        moderationStatus: input.moderationStatus,
        moderationEvidence: {},
        automationEvidence: {},
        status: input.status,
        sourcePublishedAt: input.sourcePublishedAt ? new Date(input.sourcePublishedAt) : null,
        payload: {
          adapterKey: input.adapterKey,
          providerExternalId: input.providerExternalId,
          data: input.payload,
        },
        createdAt: now,
        updatedAt: now,
      }).onConflictDoNothing({
        target: [
          aiMediaSourceItems.ownerUserId,
          aiMediaSourceItems.workspaceId,
          aiMediaSourceItems.sourceType,
          aiMediaSourceItems.externalId,
        ],
      }).returning();
      if (created) return { item: mapSourceRow(created), created: true };
      const [raced] = await tx.select().from(aiMediaSourceItems).where(and(
        eq(aiMediaSourceItems.ownerUserId, scope.ownerUserId),
        eq(aiMediaSourceItems.workspaceId, scope.workspaceId),
        eq(aiMediaSourceItems.sourceType, input.category),
        eq(aiMediaSourceItems.externalId, externalId),
      )).limit(1);
      if (!raced) throw new Error("Source identity conflict could not be resolved");
      return { item: mapSourceRow(raced), created: false };
    });
  }

  async get(scope: TenantScope, id: string): Promise<CanonicalSourceItem | undefined> {
    const [row] = await this.db.select().from(aiMediaSourceItems).where(and(
      eq(aiMediaSourceItems.id, id),
      eq(aiMediaSourceItems.ownerUserId, scope.ownerUserId),
      eq(aiMediaSourceItems.workspaceId, scope.workspaceId),
      categoryPredicate(),
    )).limit(1);
    return row ? mapSourceRow(row) : undefined;
  }

  async list(scope: TenantScope, options: { limit?: number; category?: SourceCategory } = {}): Promise<CanonicalSourceItem[]> {
    const limit = Math.min(Math.max(options.limit ?? 25, 1), MAX_SOURCE_SNAPSHOT_ITEMS);
    const predicates = [
      eq(aiMediaSourceItems.ownerUserId, scope.ownerUserId),
      eq(aiMediaSourceItems.workspaceId, scope.workspaceId),
      categoryPredicate(options.category),
    ];
    const rows = await this.db.select().from(aiMediaSourceItems).where(and(...predicates))
      .orderBy(asc(aiMediaSourceItems.createdAt), asc(aiMediaSourceItems.id)).limit(limit);
    return rows.map(mapSourceRow);
  }

  async listPage(scope: TenantScope, request: SourcePageRequest = {}): Promise<SourcePage> {
    const limit = boundedSourcePageLimit(request.limit);
    const filter = sourceListFilter(request);
    const cursor = decodeSourceCursor(scope, filter, request.cursor);
    const predicates = [
      eq(aiMediaSourceItems.ownerUserId, scope.ownerUserId),
      eq(aiMediaSourceItems.workspaceId, scope.workspaceId),
      categoryPredicate(filter.category),
    ];
    if (filter.status) predicates.push(eq(aiMediaSourceItems.status, filter.status));
    if (filter.rightsStatus) predicates.push(eq(aiMediaSourceItems.rightsStatus, filter.rightsStatus));
    if (cursor) predicates.push(or(
      gt(aiMediaSourceItems.createdAt, cursor.createdAt),
      and(eq(aiMediaSourceItems.createdAt, cursor.createdAt), gt(aiMediaSourceItems.id, cursor.id)),
    )!);
    const rows = await this.db.select().from(aiMediaSourceItems).where(and(...predicates))
      .orderBy(asc(aiMediaSourceItems.createdAt), asc(aiMediaSourceItems.id)).limit(limit + 1);
    const hasMore = rows.length > limit;
    const items = rows.slice(0, limit).map(mapSourceRow);
    return {
      items,
      nextCursor: hasMore && items.length > 0 ? encodeSourceCursor(scope, filter, items.at(-1)!) : null,
      hasMore,
    };
  }
}
