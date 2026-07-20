import { createHash, randomUUID } from "node:crypto";

export const MEDIA_ASSET_TYPES = [
  "video",
  "script",
  "voice",
  "b_roll",
  "image",
  "music",
  "logo",
  "subtitle",
  "thumbnail",
] as const;

export type MediaAssetType = (typeof MEDIA_ASSET_TYPES)[number];
export type MediaAssetStatus = "processing" | "ready" | "failed" | "archived";

export interface MediaAssetMetadata {
  width?: number;
  height?: number;
  durationMs?: number;
  language?: string;
  codec?: string;
  frameRate?: number;
  sampleRate?: number;
  channels?: number;
}

export interface MediaAsset {
  id: string;
  ownerUserId: string;
  workspaceId: string;
  type: MediaAssetType;
  name: string;
  status: MediaAssetStatus;
  mimeType: string;
  sizeBytes: number | null;
  checksumSha256: string | null;
  storageProvider: string;
  storageKey: string;
  deliveryUrl: string | null;
  thumbnailUrl: string | null;
  projectId: string | null;
  renderJobId: string | null;
  influencerId: string | null;
  providerResourceId: string | null;
  source: {
    kind: "remote" | "text";
    originalUrl?: string;
    finalUrl?: string;
  };
  metadata: MediaAssetMetadata;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface MediaAssetRepository {
  createOrGet(asset: MediaAsset): Promise<{ asset: MediaAsset; created: boolean }>;
  findByChecksum(
    ownerUserId: string,
    type: MediaAssetType,
    checksumSha256: string,
  ): Promise<MediaAsset | undefined>;
  get(ownerUserId: string, assetId: string): Promise<MediaAsset | undefined>;
  list(ownerUserId: string, type?: MediaAssetType): Promise<MediaAsset[]>;
}

export interface StoredMediaObject {
  storageKey: string;
  mimeType: string;
  sizeBytes: number;
}

export interface MediaAssetStorage {
  put(input: {
    storageKey: string;
    bytes: Uint8Array;
    mimeType: string;
  }): Promise<StoredMediaObject>;
  delete(storageKey: string): Promise<void>;
  get(storageKey: string): Promise<{ bytes: Uint8Array; mimeType: string } | undefined>;
}

export interface DownloadedMedia {
  originalUrl: string;
  finalUrl: string;
  bytes: Uint8Array;
  mimeType: string;
}

export interface RemoteMediaDownloader {
  download(input: { url: string; type: MediaAssetType }): Promise<DownloadedMedia>;
}

export interface MediaMetadataExtractor {
  inspect(input: {
    type: MediaAssetType;
    mimeType: string;
    bytes: Uint8Array;
  }): Promise<MediaAssetMetadata>;
}

export interface ImportRemoteAssetRequest {
  type: MediaAssetType;
  name: string;
  url: string;
  projectId?: string | null;
  renderJobId?: string | null;
  influencerId?: string | null;
  providerResourceId?: string | null;
}

export interface CreateTextAssetRequest {
  type: "script" | "subtitle";
  name: string;
  text: string;
  language?: string;
  mimeType?: "text/plain" | "text/vtt" | "application/x-subrip";
  projectId?: string | null;
  influencerId?: string | null;
}

export interface AssetMutationResult {
  asset: MediaAsset;
  deduplicated: boolean;
}

function requireOwner(ownerUserId: string): string {
  const owner = ownerUserId.trim();
  if (!owner || owner.length > 200) throw new Error("A valid asset owner is required");
  return owner;
}

function requireName(name: string): string {
  const normalized = name.trim();
  if (!normalized || normalized.length > 200) throw new Error("Asset name must be between 1 and 200 characters");
  if (/[/\\\0]/u.test(normalized) || normalized === "." || normalized === "..") {
    throw new Error("Asset name must not contain a filesystem path");
  }
  return normalized;
}

function cloneBytes(bytes: Uint8Array): Uint8Array {
  return new Uint8Array(bytes);
}

export class AssetService {
  constructor(
    private readonly repository: MediaAssetRepository,
    private readonly storage: MediaAssetStorage,
    private readonly downloader: RemoteMediaDownloader,
    private readonly metadata: MediaMetadataExtractor,
    private readonly now: () => Date = () => new Date(),
    private readonly createId: () => string = randomUUID,
    private readonly workspaceId = "personal",
    private readonly storageProvider = "internal",
  ) {}

  async importRemote(ownerUserId: string, request: ImportRemoteAssetRequest): Promise<AssetMutationResult> {
    const owner = requireOwner(ownerUserId);
    const name = requireName(request.name);
    if (!MEDIA_ASSET_TYPES.includes(request.type)) throw new Error("Unsupported media asset type");

    const downloaded = await this.downloader.download({ url: request.url, type: request.type });
    return this.persist(owner, {
      type: request.type,
      name,
      bytes: cloneBytes(downloaded.bytes),
      mimeType: downloaded.mimeType,
      source: {
        kind: "remote",
        originalUrl: downloaded.originalUrl,
        finalUrl: downloaded.finalUrl,
      },
      relations: {
        projectId: request.projectId ?? null,
        renderJobId: request.renderJobId ?? null,
        influencerId: request.influencerId ?? null,
        providerResourceId: request.providerResourceId ?? null,
      },
    });
  }

  async createText(ownerUserId: string, request: CreateTextAssetRequest): Promise<AssetMutationResult> {
    const owner = requireOwner(ownerUserId);
    const name = requireName(request.name);
    if (request.type !== "script" && request.type !== "subtitle") throw new Error("Only script and subtitle text assets are supported");
    if (!request.text.trim()) throw new Error("Text asset content is required");
    const bytes = new TextEncoder().encode(request.text);
    if (bytes.byteLength > 1_000_000) throw new Error("Text asset exceeds the 1000000 byte limit");
    const mimeType = request.mimeType ?? (request.type === "subtitle" ? "text/vtt" : "text/plain");
    const result = await this.persist(owner, {
      type: request.type,
      name,
      bytes,
      mimeType,
      source: { kind: "text" },
      metadata: request.language ? { language: request.language } : undefined,
      relations: {
        projectId: request.projectId ?? null,
        renderJobId: null,
        influencerId: request.influencerId ?? null,
        providerResourceId: null,
      },
    });
    return result;
  }

  async get(ownerUserId: string, assetId: string): Promise<MediaAsset> {
    const asset = await this.repository.get(requireOwner(ownerUserId), assetId);
    if (!asset) throw new Error("Media asset not found");
    return asset;
  }

  async list(ownerUserId: string, type?: MediaAssetType): Promise<MediaAsset[]> {
    return this.repository.list(requireOwner(ownerUserId), type);
  }

  private async persist(
    ownerUserId: string,
    input: {
      type: MediaAssetType;
      name: string;
      bytes: Uint8Array;
      mimeType: string;
      source: MediaAsset["source"];
      metadata?: MediaAssetMetadata;
      relations: Pick<MediaAsset, "projectId" | "renderJobId" | "influencerId" | "providerResourceId">;
    },
  ): Promise<AssetMutationResult> {
    const checksumSha256 = createHash("sha256").update(input.bytes).digest("hex");
    const existing = await this.repository.findByChecksum(ownerUserId, input.type, checksumSha256);
    if (existing) return { asset: existing, deduplicated: true };

    const extracted = await this.metadata.inspect({ type: input.type, mimeType: input.mimeType, bytes: input.bytes });
    const id = this.createId();
    const storageKey = `media-assets/${id}`;
    const stored = await this.storage.put({ storageKey, bytes: input.bytes, mimeType: input.mimeType });
    const timestamp = this.now().toISOString();
    const candidate: MediaAsset = {
      id,
      ownerUserId,
      workspaceId: this.workspaceId,
      type: input.type,
      name: input.name,
      status: "ready",
      mimeType: stored.mimeType,
      sizeBytes: stored.sizeBytes,
      checksumSha256,
      storageProvider: this.storageProvider,
      storageKey: stored.storageKey,
      deliveryUrl: null,
      thumbnailUrl: null,
      ...input.relations,
      source: { ...input.source },
      metadata: { ...extracted, ...input.metadata },
      createdAt: timestamp,
      updatedAt: timestamp,
      deletedAt: null,
    };

    try {
      const saved = await this.repository.createOrGet(candidate);
      if (!saved.created) await this.storage.delete(storageKey);
      return { asset: saved.asset, deduplicated: !saved.created };
    } catch (error) {
      await this.storage.delete(storageKey).catch(() => undefined);
      throw error;
    }
  }
}
