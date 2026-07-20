import type {
  aiMediaInfluencers,
  aiMediaMediaAssets,
  aiMediaProviderResources,
} from "../../../shared/models/ai-media-studio-db";
import type { InfluencerGender, InfluencerStatus } from "../../../shared/ai-media-studio-core";
import type { MediaAsset, MediaAssetMetadata, MediaAssetStatus, MediaAssetType } from "../core/asset-domain";
import type { AiInfluencer } from "../core/influencer-domain";
import type {
  CanonicalMediaResource,
  CanonicalResourceStatus,
  CanonicalResourceType,
} from "../core/resource-domain";

export type AiMediaInfluencerRow = typeof aiMediaInfluencers.$inferSelect;
export type AiMediaProviderResourceRow = typeof aiMediaProviderResources.$inferSelect;
export type AiMediaAssetRow = typeof aiMediaMediaAssets.$inferSelect;

const ASSET_TYPES = new Set<MediaAssetType>([
  "video",
  "script",
  "voice",
  "b_roll",
  "image",
  "music",
  "logo",
  "subtitle",
  "thumbnail",
]);

function iso(value: Date): string {
  return value.toISOString();
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function numberOrUndefined(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function resourceStatus(value: string): CanonicalResourceStatus {
  // Older provider syncs used `unavailable`; the public contract uses
  // `inactive`. Keep the compatibility conversion inside persistence.
  if (value === "unavailable") return "inactive";
  if (value === "active" || value === "inactive" || value === "archived") return value;
  throw new Error(`Unsupported canonical resource status in persistence: ${value}`);
}

function resourceType(value: string): CanonicalResourceType {
  if (value === "avatar" || value === "voice") return value;
  throw new Error(`Unsupported canonical resource type in persistence: ${value}`);
}

function influencerStatus(value: string): InfluencerStatus {
  if (value === "draft" || value === "active" || value === "paused" || value === "archived") return value;
  throw new Error(`Unsupported influencer status in persistence: ${value}`);
}

function influencerGender(value: string): InfluencerGender {
  if (value === "female" || value === "male" || value === "non_binary" || value === "unspecified") return value;
  throw new Error(`Unsupported influencer gender in persistence: ${value}`);
}

/** Maps every structured persona column without consulting the legacy persona blob. */
export function mapInfluencerRow(row: AiMediaInfluencerRow): AiInfluencer {
  return {
    id: row.id,
    ownerUserId: row.ownerUserId,
    workspaceId: row.workspaceId,
    slug: row.slug,
    name: row.name,
    avatarResourceId: row.defaultAvatarResourceId,
    voiceResourceId: row.defaultVoiceResourceId,
    accent: row.accent,
    language: row.language,
    gender: influencerGender(row.gender),
    ageRange: { ...row.ageRange },
    personality: [...row.personality],
    tone: [...row.tone],
    speakingStyle: row.speakingStyle,
    categories: [...row.categories],
    intro: row.intro,
    outro: row.outro,
    energyLevel: row.energyLevel,
    facialExpressions: [...row.facialExpressions],
    brandColors: [...row.brandColors],
    status: influencerStatus(row.status),
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
    ...(row.archivedAt ? { archivedAt: iso(row.archivedAt) } : {}),
  };
}

/** Provider-native identifiers deliberately do not participate in this mapping. */
export function mapCanonicalResourceRow(row: AiMediaProviderResourceRow): CanonicalMediaResource {
  const metadata = row.metadata ?? {};
  return {
    id: row.id,
    ownerUserId: row.ownerUserId,
    workspaceId: row.workspaceId,
    kind: resourceType(row.resourceType),
    name: row.displayName,
    status: resourceStatus(row.status),
    language: stringOrNull(metadata.language),
    accent: stringOrNull(metadata.accent),
    gender: metadata.gender === "female" || metadata.gender === "male"
      || metadata.gender === "non_binary" || metadata.gender === "unspecified"
      ? metadata.gender
      : null,
    previewUrl: stringOrNull(metadata.previewUrl),
    thumbnailUrl: stringOrNull(metadata.thumbnailUrl),
    synchronizedAt: row.synchronizedAt ? iso(row.synchronizedAt) : null,
  };
}

function assetType(value: string): MediaAssetType {
  if (ASSET_TYPES.has(value as MediaAssetType)) return value as MediaAssetType;
  throw new Error(`Unsupported media asset type in persistence: ${value}`);
}

function assetStatus(value: string): MediaAssetStatus {
  if (value === "processing" || value === "ready" || value === "failed" || value === "archived") return value;
  throw new Error(`Unsupported media asset status in persistence: ${value}`);
}

function assetSource(metadata: Record<string, unknown>): MediaAsset["source"] {
  const source = metadata.source;
  if (!source || typeof source !== "object" || Array.isArray(source)) return { kind: "text" };
  const candidate = source as Record<string, unknown>;
  if (candidate.kind !== "remote") return { kind: "text" };
  return {
    kind: "remote",
    ...(typeof candidate.originalUrl === "string" ? { originalUrl: candidate.originalUrl } : {}),
    ...(typeof candidate.finalUrl === "string" ? { finalUrl: candidate.finalUrl } : {}),
  };
}

function assetMetadata(row: AiMediaAssetRow): MediaAssetMetadata {
  const metadata = row.metadata ?? {};
  return {
    ...(row.width === null ? {} : { width: row.width }),
    ...(row.height === null ? {} : { height: row.height }),
    ...(row.durationMs === null ? {} : { durationMs: row.durationMs }),
    ...(stringOrNull(metadata.language) === null ? {} : { language: stringOrNull(metadata.language)! }),
    ...(stringOrNull(metadata.codec) === null ? {} : { codec: stringOrNull(metadata.codec)! }),
    ...(numberOrUndefined(metadata.frameRate) === undefined ? {} : { frameRate: numberOrUndefined(metadata.frameRate)! }),
    ...(numberOrUndefined(metadata.sampleRate) === undefined ? {} : { sampleRate: numberOrUndefined(metadata.sampleRate)! }),
    ...(numberOrUndefined(metadata.channels) === undefined ? {} : { channels: numberOrUndefined(metadata.channels)! }),
  };
}

/** Materializes metadata only; media bytes remain in MediaAssetStorage. */
export function mapMediaAssetRow(row: AiMediaAssetRow): MediaAsset {
  return {
    id: row.id,
    ownerUserId: row.ownerUserId,
    workspaceId: row.workspaceId,
    type: assetType(row.kind),
    name: row.name,
    status: assetStatus(row.status),
    mimeType: row.mimeType,
    sizeBytes: row.byteSize,
    checksumSha256: row.checksum,
    storageProvider: row.storageProvider,
    storageKey: row.storageKey,
    deliveryUrl: row.publicUrl,
    thumbnailUrl: row.thumbnailUrl ?? stringOrNull((row.metadata ?? {}).thumbnailUrl),
    projectId: row.projectId,
    renderJobId: row.renderJobId,
    influencerId: row.influencerId,
    providerResourceId: row.providerResourceId,
    source: assetSource(row.metadata ?? {}),
    metadata: assetMetadata(row),
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
    deletedAt: row.deletedAt ? iso(row.deletedAt) : null,
  };
}
