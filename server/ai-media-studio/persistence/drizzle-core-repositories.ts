import { and, asc, desc, eq, inArray, isNull, ne, sql } from "drizzle-orm";
import {
  aiMediaInfluencers,
  aiMediaMediaAssets,
  aiMediaProviderAccounts,
  aiMediaProviderResources,
} from "../../../shared/models/ai-media-studio-db";
import type { MediaAsset, MediaAssetRepository, MediaAssetType } from "../core/asset-domain";
import type { AiInfluencer, InfluencerRepository } from "../core/influencer-domain";
import { InfluencerSlugConflictError } from "../core/influencer-domain";
import type {
  CanonicalMediaResource,
  CanonicalResourceRepository,
  CanonicalResourceType,
  TenantScope,
} from "../core/resource-domain";
import { CoreDomainNotFoundError } from "../core/resource-domain";
import type { AiMediaStudioDrizzleDatabase } from "./drizzle-media-job-repository";
import { mapCanonicalResourceRow, mapInfluencerRow, mapMediaAssetRow } from "./core-mapping";

function personaMetadata(resource: CanonicalMediaResource): Record<string, unknown> {
  return {
    language: resource.language,
    accent: resource.accent,
    gender: resource.gender,
    previewUrl: resource.previewUrl,
    thumbnailUrl: resource.thumbnailUrl,
  };
}

function assetMetadata(asset: MediaAsset): Record<string, unknown> {
  return {
    source: { ...asset.source },
    ...(asset.metadata.language === undefined ? {} : { language: asset.metadata.language }),
    ...(asset.metadata.codec === undefined ? {} : { codec: asset.metadata.codec }),
    ...(asset.metadata.frameRate === undefined ? {} : { frameRate: asset.metadata.frameRate }),
    ...(asset.metadata.sampleRate === undefined ? {} : { sampleRate: asset.metadata.sampleRate }),
    ...(asset.metadata.channels === undefined ? {} : { channels: asset.metadata.channels }),
  };
}

export class DrizzleInfluencerRepository implements InfluencerRepository {
  constructor(private readonly db: AiMediaStudioDrizzleDatabase) {}

  async create(
    scope: TenantScope,
    influencer: Omit<AiInfluencer, "ownerUserId" | "workspaceId">,
  ): Promise<AiInfluencer> {
    return this.db.transaction(async (tx) => {
      const [created] = await tx.insert(aiMediaInfluencers).values({
        id: influencer.id,
        ownerUserId: scope.ownerUserId,
        workspaceId: scope.workspaceId,
        name: influencer.name,
        slug: influencer.slug,
        status: influencer.status,
        accent: influencer.accent,
        language: influencer.language,
        gender: influencer.gender,
        ageRange: { ...influencer.ageRange },
        personality: [...influencer.personality],
        tone: [...influencer.tone],
        speakingStyle: influencer.speakingStyle,
        categories: [...influencer.categories],
        intro: influencer.intro,
        outro: influencer.outro,
        energyLevel: influencer.energyLevel,
        facialExpressions: [...influencer.facialExpressions],
        brandColors: [...influencer.brandColors],
        defaultVoiceResourceId: influencer.voiceResourceId,
        defaultAvatarResourceId: influencer.avatarResourceId,
        createdAt: new Date(influencer.createdAt),
        updatedAt: new Date(influencer.updatedAt),
        archivedAt: influencer.archivedAt ? new Date(influencer.archivedAt) : null,
      }).onConflictDoNothing({
        target: [aiMediaInfluencers.ownerUserId, aiMediaInfluencers.workspaceId, aiMediaInfluencers.slug],
      }).returning();
      if (!created) throw new InfluencerSlugConflictError(`Influencer slug already exists: ${influencer.slug}`);
      return mapInfluencerRow(created);
    });
  }

  async get(scope: TenantScope, influencerId: string): Promise<AiInfluencer | undefined> {
    const [row] = await this.db.select().from(aiMediaInfluencers).where(and(
      eq(aiMediaInfluencers.id, influencerId),
      eq(aiMediaInfluencers.ownerUserId, scope.ownerUserId),
      eq(aiMediaInfluencers.workspaceId, scope.workspaceId),
    )).limit(1);
    return row ? mapInfluencerRow(row) : undefined;
  }

  async getBySlug(scope: TenantScope, slug: string): Promise<AiInfluencer | undefined> {
    const [row] = await this.db.select().from(aiMediaInfluencers).where(and(
      eq(aiMediaInfluencers.slug, slug),
      eq(aiMediaInfluencers.ownerUserId, scope.ownerUserId),
      eq(aiMediaInfluencers.workspaceId, scope.workspaceId),
    )).limit(1);
    return row ? mapInfluencerRow(row) : undefined;
  }

  async list(scope: TenantScope, filter: { includeArchived?: boolean } = {}): Promise<AiInfluencer[]> {
    const predicates = [
      eq(aiMediaInfluencers.ownerUserId, scope.ownerUserId),
      eq(aiMediaInfluencers.workspaceId, scope.workspaceId),
    ];
    if (!filter.includeArchived) predicates.push(ne(aiMediaInfluencers.status, "archived"));
    const rows = await this.db.select().from(aiMediaInfluencers).where(and(...predicates))
      .orderBy(asc(aiMediaInfluencers.createdAt), asc(aiMediaInfluencers.id));
    return rows.map(mapInfluencerRow);
  }

  async update(scope: TenantScope, influencer: AiInfluencer): Promise<AiInfluencer> {
    return this.db.transaction(async (tx) => {
      const [saved] = await tx.update(aiMediaInfluencers).set({
        name: influencer.name,
        slug: influencer.slug,
        status: influencer.status,
        accent: influencer.accent,
        language: influencer.language,
        gender: influencer.gender,
        ageRange: { ...influencer.ageRange },
        personality: [...influencer.personality],
        tone: [...influencer.tone],
        speakingStyle: influencer.speakingStyle,
        categories: [...influencer.categories],
        intro: influencer.intro,
        outro: influencer.outro,
        energyLevel: influencer.energyLevel,
        facialExpressions: [...influencer.facialExpressions],
        brandColors: [...influencer.brandColors],
        defaultVoiceResourceId: influencer.voiceResourceId,
        defaultAvatarResourceId: influencer.avatarResourceId,
        updatedAt: new Date(influencer.updatedAt),
        archivedAt: influencer.archivedAt ? new Date(influencer.archivedAt) : null,
      }).where(and(
        eq(aiMediaInfluencers.id, influencer.id),
        eq(aiMediaInfluencers.ownerUserId, scope.ownerUserId),
        eq(aiMediaInfluencers.workspaceId, scope.workspaceId),
      )).returning();
      if (!saved) throw new CoreDomainNotFoundError("AI influencer not found");
      return mapInfluencerRow(saved);
    });
  }
}

export interface CanonicalResourcePersistenceIdentity {
  providerAccountId: string;
  providerKey: string;
  canonicalKey: string;
  externalResourceId: string;
}

export type CanonicalResourceIdentityResolver = (
  scope: TenantScope,
  resource: Omit<CanonicalMediaResource, "ownerUserId" | "workspaceId">,
) => Promise<CanonicalResourcePersistenceIdentity> | CanonicalResourcePersistenceIdentity;

function requireInternalIdentity(identity: CanonicalResourcePersistenceIdentity): CanonicalResourcePersistenceIdentity {
  for (const [key, value] of Object.entries(identity)) {
    if (typeof value !== "string" || !value.trim()) throw new Error(`Canonical resource ${key} is required internally`);
  }
  return identity;
}

export class DrizzleCanonicalResourceRepository implements CanonicalResourceRepository {
  constructor(
    private readonly db: AiMediaStudioDrizzleDatabase,
    private readonly resolveIdentity: CanonicalResourceIdentityResolver,
  ) {}

  async create(
    scope: TenantScope,
    resource: Omit<CanonicalMediaResource, "ownerUserId" | "workspaceId">,
  ): Promise<CanonicalMediaResource> {
    const identity = requireInternalIdentity(await this.resolveIdentity(scope, resource));
    return this.db.transaction(async (tx) => {
      const [providerAccount] = await tx.select({ id: aiMediaProviderAccounts.id }).from(aiMediaProviderAccounts).where(and(
        eq(aiMediaProviderAccounts.id, identity.providerAccountId),
        eq(aiMediaProviderAccounts.ownerUserId, scope.ownerUserId),
        eq(aiMediaProviderAccounts.workspaceId, scope.workspaceId),
        eq(aiMediaProviderAccounts.providerKey, identity.providerKey),
      )).limit(1);
      if (!providerAccount) throw new Error("Canonical resource provider account is not available in this workspace");

      const [created] = await tx.insert(aiMediaProviderResources).values({
        id: resource.id,
        ownerUserId: scope.ownerUserId,
        workspaceId: scope.workspaceId,
        providerAccountId: identity.providerAccountId,
        providerKey: identity.providerKey,
        resourceType: resource.kind,
        canonicalKey: identity.canonicalKey,
        externalResourceId: identity.externalResourceId,
        displayName: resource.name,
        status: resource.status,
        metadata: personaMetadata({ ...resource, ownerUserId: scope.ownerUserId, workspaceId: scope.workspaceId }),
        synchronizedAt: resource.synchronizedAt ? new Date(resource.synchronizedAt) : null,
      }).onConflictDoNothing({
        target: [
          aiMediaProviderResources.ownerUserId,
          aiMediaProviderResources.workspaceId,
          aiMediaProviderResources.resourceType,
          aiMediaProviderResources.canonicalKey,
        ],
      }).returning();
      if (created) return mapCanonicalResourceRow(created);

      const [existing] = await tx.select().from(aiMediaProviderResources).where(and(
        eq(aiMediaProviderResources.ownerUserId, scope.ownerUserId),
        eq(aiMediaProviderResources.workspaceId, scope.workspaceId),
        eq(aiMediaProviderResources.resourceType, resource.kind),
        eq(aiMediaProviderResources.canonicalKey, identity.canonicalKey),
      )).limit(1);
      if (!existing) throw new Error("Canonical resource idempotency conflict could not be resolved");
      return mapCanonicalResourceRow(existing);
    });
  }

  async get(scope: TenantScope, resourceId: string): Promise<CanonicalMediaResource | undefined> {
    const [row] = await this.db.select().from(aiMediaProviderResources).where(and(
      eq(aiMediaProviderResources.id, resourceId),
      eq(aiMediaProviderResources.ownerUserId, scope.ownerUserId),
      eq(aiMediaProviderResources.workspaceId, scope.workspaceId),
    )).limit(1);
    return row ? mapCanonicalResourceRow(row) : undefined;
  }

  async getMany(scope: TenantScope, resourceIds: readonly string[]): Promise<CanonicalMediaResource[]> {
    const ids = [...new Set(resourceIds)];
    if (ids.length === 0) return [];
    const rows = await this.db.select().from(aiMediaProviderResources).where(and(
      inArray(aiMediaProviderResources.id, ids),
      eq(aiMediaProviderResources.ownerUserId, scope.ownerUserId),
      eq(aiMediaProviderResources.workspaceId, scope.workspaceId),
    ));
    return rows.map(mapCanonicalResourceRow);
  }

  async list(
    scope: TenantScope,
    filter: { kind?: CanonicalResourceType; includeArchived?: boolean } = {},
  ): Promise<CanonicalMediaResource[]> {
    const predicates = [
      eq(aiMediaProviderResources.ownerUserId, scope.ownerUserId),
      eq(aiMediaProviderResources.workspaceId, scope.workspaceId),
    ];
    if (filter.kind) predicates.push(eq(aiMediaProviderResources.resourceType, filter.kind));
    if (!filter.includeArchived) predicates.push(ne(aiMediaProviderResources.status, "archived"));
    const rows = await this.db.select().from(aiMediaProviderResources).where(and(...predicates))
      .orderBy(asc(aiMediaProviderResources.synchronizedAt), asc(aiMediaProviderResources.id));
    return rows.map(mapCanonicalResourceRow);
  }

  async update(scope: TenantScope, resource: CanonicalMediaResource): Promise<CanonicalMediaResource> {
    return this.db.transaction(async (tx) => {
      const [saved] = await tx.update(aiMediaProviderResources).set({
        displayName: resource.name,
        status: resource.status,
        metadata: personaMetadata(resource),
        synchronizedAt: resource.synchronizedAt ? new Date(resource.synchronizedAt) : null,
        updatedAt: new Date(),
      }).where(and(
        eq(aiMediaProviderResources.id, resource.id),
        eq(aiMediaProviderResources.ownerUserId, scope.ownerUserId),
        eq(aiMediaProviderResources.workspaceId, scope.workspaceId),
      )).returning();
      if (!saved) throw new CoreDomainNotFoundError("Canonical media resource not found");
      return mapCanonicalResourceRow(saved);
    });
  }
}

export interface DrizzleMediaAssetRepositoryOptions {
  workspaceId?: string;
  storageProvider?: string;
}

const OWNED_OBJECT_STORAGE_PROVIDER = "owned-object-storage";
const CONFIGURED_STORAGE_PROVIDERS = new Set(["internal", "private-object-store"]);

function configuredStorageProvider(value: string | undefined): string {
  const provider = value?.trim() || "internal";
  if (!CONFIGURED_STORAGE_PROVIDERS.has(provider)) {
    throw new Error("Media asset repository storageProvider is not allowlisted");
  }
  return provider;
}

function isSafeOwnedObjectKey(storageKey: string, checksumSha256: string): boolean {
  if (!storageKey || storageKey.length > 1_024 || /[\0-\x1f\x7f\\]/u.test(storageKey) || storageKey.includes("://")) return false;
  if (storageKey.split("/").some((part) => part === "." || part === "..")) return false;
  return storageKey.endsWith(`/sha256/${checksumSha256}.mp4`);
}

function storageProviderForCandidate(candidate: MediaAsset, configuredProvider: string): string {
  if (candidate.storageProvider !== OWNED_OBJECT_STORAGE_PROVIDER) return configuredProvider;
  const checksum = candidate.checksumSha256;
  const validOwnedArtifact = candidate.type === "video"
    && candidate.status === "ready"
    && candidate.mimeType === "video/mp4"
    && Number.isSafeInteger(candidate.sizeBytes) && Number(candidate.sizeBytes) > 0
    && typeof checksum === "string" && /^[a-f0-9]{64}$/u.test(checksum)
    && candidate.renderJobId !== null
    && candidate.deliveryUrl === null
    && candidate.deletedAt === null
    && candidate.source.kind === "remote"
    && candidate.source.originalUrl === undefined
    && candidate.source.finalUrl === undefined
    && isSafeOwnedObjectKey(candidate.storageKey, checksum ?? "");
  if (!validOwnedArtifact) throw new Error("Owned object storage is restricted to completed content-addressed MP4 artifacts");
  return OWNED_OBJECT_STORAGE_PROVIDER;
}

export interface MediaAssetPage {
  assets: MediaAsset[];
  nextCursor: string | null;
}

export class DrizzleMediaAssetRepository implements MediaAssetRepository {
  private readonly workspaceId: string;
  private readonly storageProvider: string;

  constructor(
    private readonly db: AiMediaStudioDrizzleDatabase,
    options: DrizzleMediaAssetRepositoryOptions = {},
  ) {
    this.workspaceId = options.workspaceId?.trim() || "personal";
    this.storageProvider = configuredStorageProvider(options.storageProvider);
  }

  async createOrGet(candidate: MediaAsset): Promise<{ asset: MediaAsset; created: boolean }> {
    if (candidate.workspaceId !== this.workspaceId) {
      throw new Error("Media asset workspace does not match repository scope");
    }
    const storageProvider = storageProviderForCandidate(candidate, this.storageProvider);
    const checksumSha256 = candidate.checksumSha256;
    return this.db.transaction(async (tx) => {
      if (checksumSha256 !== null) {
        const lockKey = `${candidate.ownerUserId}\u0000${this.workspaceId}\u0000${candidate.type}\u0000${checksumSha256}`;
        await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`);
        const [existing] = await tx.select().from(aiMediaMediaAssets).where(and(
          eq(aiMediaMediaAssets.ownerUserId, candidate.ownerUserId),
          eq(aiMediaMediaAssets.workspaceId, this.workspaceId),
          eq(aiMediaMediaAssets.kind, candidate.type),
          eq(aiMediaMediaAssets.checksum, checksumSha256),
          isNull(aiMediaMediaAssets.deletedAt),
        )).limit(1);
        if (existing) {
          if (storageProvider !== OWNED_OBJECT_STORAGE_PROVIDER) {
            return { asset: mapMediaAssetRow(existing), created: false };
          }
          if (existing.status !== "ready" || existing.mimeType !== "video/mp4"
            || (existing.byteSize !== null && existing.byteSize !== candidate.sizeBytes)) {
            throw new Error("Legacy checksum row is not safe to promote for owned MP4 delivery");
          }
          if (existing.storageProvider === OWNED_OBJECT_STORAGE_PROVIDER) {
            if (existing.storageKey !== candidate.storageKey) {
              throw new Error("Owned media checksum is already bound to a different content-addressed key");
            }
            return { asset: mapMediaAssetRow(existing), created: false };
          }
          const [promoted] = await tx.update(aiMediaMediaAssets).set({
            storageProvider: OWNED_OBJECT_STORAGE_PROVIDER,
            storageKey: candidate.storageKey,
            publicUrl: null,
            updatedAt: new Date(candidate.updatedAt),
          }).where(and(
            eq(aiMediaMediaAssets.id, existing.id),
            eq(aiMediaMediaAssets.ownerUserId, candidate.ownerUserId),
            eq(aiMediaMediaAssets.workspaceId, this.workspaceId),
            eq(aiMediaMediaAssets.kind, candidate.type),
            eq(aiMediaMediaAssets.checksum, checksumSha256),
            isNull(aiMediaMediaAssets.deletedAt),
          )).returning();
          if (!promoted) throw new Error("Owned media checksum promotion lost its tenant-scoped candidate");
          return { asset: mapMediaAssetRow(promoted), created: false };
        }
      }

      const [created] = await tx.insert(aiMediaMediaAssets).values({
        id: candidate.id,
        ownerUserId: candidate.ownerUserId,
        workspaceId: this.workspaceId,
        projectId: candidate.projectId,
        renderJobId: candidate.renderJobId,
        influencerId: candidate.influencerId,
        providerResourceId: candidate.providerResourceId,
        kind: candidate.type,
        name: candidate.name,
        status: candidate.status,
        storageProvider,
        storageKey: candidate.storageKey,
        publicUrl: candidate.deliveryUrl,
        thumbnailUrl: candidate.thumbnailUrl,
        mimeType: candidate.mimeType,
        byteSize: candidate.sizeBytes,
        checksum: candidate.checksumSha256,
        width: candidate.metadata.width,
        height: candidate.metadata.height,
        durationMs: candidate.metadata.durationMs,
        metadata: assetMetadata(candidate),
        createdAt: new Date(candidate.createdAt),
        updatedAt: new Date(candidate.updatedAt),
        deletedAt: candidate.deletedAt ? new Date(candidate.deletedAt) : null,
      }).returning();
      if (!created) throw new Error("Media asset insert did not return a row");
      return { asset: mapMediaAssetRow(created), created: true };
    });
  }

  async findByChecksum(
    ownerUserId: string,
    type: MediaAssetType,
    checksumSha256: string,
  ): Promise<MediaAsset | undefined> {
    const [row] = await this.db.select().from(aiMediaMediaAssets).where(and(
      eq(aiMediaMediaAssets.ownerUserId, ownerUserId),
      eq(aiMediaMediaAssets.workspaceId, this.workspaceId),
      eq(aiMediaMediaAssets.kind, type),
      eq(aiMediaMediaAssets.checksum, checksumSha256),
      isNull(aiMediaMediaAssets.deletedAt),
    )).limit(1);
    return row ? mapMediaAssetRow(row) : undefined;
  }

  async get(ownerUserId: string, assetId: string): Promise<MediaAsset | undefined> {
    const [row] = await this.db.select().from(aiMediaMediaAssets).where(and(
      eq(aiMediaMediaAssets.id, assetId),
      eq(aiMediaMediaAssets.ownerUserId, ownerUserId),
      eq(aiMediaMediaAssets.workspaceId, this.workspaceId),
      isNull(aiMediaMediaAssets.deletedAt),
    )).limit(1);
    return row ? mapMediaAssetRow(row) : undefined;
  }

  async list(ownerUserId: string, type?: MediaAssetType): Promise<MediaAsset[]> {
    const predicates = [
      eq(aiMediaMediaAssets.ownerUserId, ownerUserId),
      eq(aiMediaMediaAssets.workspaceId, this.workspaceId),
      isNull(aiMediaMediaAssets.deletedAt),
    ];
    if (type) predicates.push(eq(aiMediaMediaAssets.kind, type));
    const rows = await this.db.select().from(aiMediaMediaAssets).where(and(...predicates))
      .orderBy(desc(aiMediaMediaAssets.createdAt), asc(aiMediaMediaAssets.id));
    return rows.map(mapMediaAssetRow);
  }

  /** Cursor pagination for HTTP/library consumers without weakening the existing port. */
  async listPage(
    ownerUserId: string,
    filter: { type?: MediaAssetType; cursor?: string; limit?: number } = {},
  ): Promise<MediaAssetPage> {
    const limit = Math.min(Math.max(filter.limit ?? 25, 1), 100);
    const predicates = [
      eq(aiMediaMediaAssets.ownerUserId, ownerUserId),
      eq(aiMediaMediaAssets.workspaceId, this.workspaceId),
      isNull(aiMediaMediaAssets.deletedAt),
    ];
    if (filter.type) predicates.push(eq(aiMediaMediaAssets.kind, filter.type));
    if (filter.cursor) {
      const [cursorRow] = await this.db.select({ createdAt: aiMediaMediaAssets.createdAt }).from(aiMediaMediaAssets).where(and(
        eq(aiMediaMediaAssets.id, filter.cursor),
        eq(aiMediaMediaAssets.ownerUserId, ownerUserId),
        eq(aiMediaMediaAssets.workspaceId, this.workspaceId),
        isNull(aiMediaMediaAssets.deletedAt),
      )).limit(1);
      if (!cursorRow) return { assets: [], nextCursor: null };
      predicates.push(sql`(${aiMediaMediaAssets.createdAt}, ${aiMediaMediaAssets.id}) < (${cursorRow.createdAt}, ${filter.cursor})`);
    }
    const rows = await this.db.select().from(aiMediaMediaAssets).where(and(...predicates))
      .orderBy(desc(aiMediaMediaAssets.createdAt), desc(aiMediaMediaAssets.id)).limit(limit + 1);
    const hasMore = rows.length > limit;
    const page = rows.slice(0, limit).map(mapMediaAssetRow);
    return { assets: page, nextCursor: hasMore ? page.at(-1)?.id ?? null : null };
  }
}
