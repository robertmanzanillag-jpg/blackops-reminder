import type {
  DownloadedMedia,
  MediaAsset,
  MediaAssetMetadata,
  MediaAssetRepository,
  MediaAssetStorage,
  MediaAssetType,
  MediaMetadataExtractor,
  RemoteMediaDownloader,
  StoredMediaObject,
} from "./asset-domain";

function cloneAsset(asset: MediaAsset): MediaAsset {
  return {
    ...asset,
    source: { ...asset.source },
    metadata: { ...asset.metadata },
  };
}

function checksumKey(ownerUserId: string, workspaceId: string, type: MediaAssetType, checksumSha256: string): string {
  return `${ownerUserId}\0${workspaceId}\0${type}\0${checksumSha256}`;
}

export class InMemoryMediaAssetRepository implements MediaAssetRepository {
  private readonly assets = new Map<string, MediaAsset>();
  private readonly checksums = new Map<string, string>();

  constructor(private readonly workspaceId = "personal") {}

  async createOrGet(candidate: MediaAsset): Promise<{ asset: MediaAsset; created: boolean }> {
    if (candidate.workspaceId !== this.workspaceId) throw new Error("Media asset workspace does not match repository scope");
    const key = candidate.checksumSha256 === null
      ? undefined
      : checksumKey(candidate.ownerUserId, candidate.workspaceId, candidate.type, candidate.checksumSha256);
    const existingId = key ? this.checksums.get(key) : undefined;
    const existing = existingId ? this.assets.get(existingId) : undefined;
    if (existing) return { asset: cloneAsset(existing), created: false };
    if (this.assets.has(candidate.id)) throw new Error("Media asset id already exists");
    const saved = cloneAsset(candidate);
    this.assets.set(saved.id, saved);
    if (key) this.checksums.set(key, saved.id);
    return { asset: cloneAsset(saved), created: true };
  }

  async findByChecksum(ownerUserId: string, type: MediaAssetType, checksumSha256: string): Promise<MediaAsset | undefined> {
    const id = this.checksums.get(checksumKey(ownerUserId, this.workspaceId, type, checksumSha256));
    const asset = id ? this.assets.get(id) : undefined;
    return asset ? cloneAsset(asset) : undefined;
  }

  async get(ownerUserId: string, assetId: string): Promise<MediaAsset | undefined> {
    const asset = this.assets.get(assetId);
    return asset?.ownerUserId === ownerUserId && asset.workspaceId === this.workspaceId ? cloneAsset(asset) : undefined;
  }

  async list(ownerUserId: string, type?: MediaAssetType): Promise<MediaAsset[]> {
    return [...this.assets.values()]
      .filter((asset) => asset.ownerUserId === ownerUserId && asset.workspaceId === this.workspaceId && (!type || asset.type === type))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id))
      .map(cloneAsset);
  }
}

interface StoredObject {
  bytes: Uint8Array;
  mimeType: string;
}

function validateStorageKey(storageKey: string): void {
  if (!/^media-assets\/[A-Za-z0-9_-]+$/u.test(storageKey) || storageKey.includes("..")) {
    throw new Error("Invalid opaque media storage key");
  }
}

export class InMemoryMediaAssetStorage implements MediaAssetStorage {
  private readonly objects = new Map<string, StoredObject>();

  async put(input: { storageKey: string; bytes: Uint8Array; mimeType: string }): Promise<StoredMediaObject> {
    validateStorageKey(input.storageKey);
    if (this.objects.has(input.storageKey)) throw new Error("Media storage key already exists");
    this.objects.set(input.storageKey, { bytes: new Uint8Array(input.bytes), mimeType: input.mimeType });
    return { storageKey: input.storageKey, mimeType: input.mimeType, sizeBytes: input.bytes.byteLength };
  }

  async delete(storageKey: string): Promise<void> {
    validateStorageKey(storageKey);
    this.objects.delete(storageKey);
  }

  async get(storageKey: string): Promise<{ bytes: Uint8Array; mimeType: string } | undefined> {
    validateStorageKey(storageKey);
    const stored = this.objects.get(storageKey);
    return stored ? { bytes: new Uint8Array(stored.bytes), mimeType: stored.mimeType } : undefined;
  }

  size(): number {
    return this.objects.size;
  }
}

export class FakeRemoteMediaDownloader implements RemoteMediaDownloader {
  private readonly responses = new Map<string, Omit<DownloadedMedia, "originalUrl">>();

  register(url: string, response: { bytes: Uint8Array; mimeType: string; finalUrl?: string }): this {
    this.responses.set(url, {
      bytes: new Uint8Array(response.bytes),
      mimeType: response.mimeType,
      finalUrl: response.finalUrl ?? url,
    });
    return this;
  }

  async download(input: { url: string; type: MediaAssetType }): Promise<DownloadedMedia> {
    const response = this.responses.get(input.url);
    if (!response) throw new Error(`No fake media response registered for ${input.url}`);
    return {
      originalUrl: input.url,
      finalUrl: response.finalUrl,
      bytes: new Uint8Array(response.bytes),
      mimeType: response.mimeType,
    };
  }
}

export class DeterministicMediaMetadataExtractor implements MediaMetadataExtractor {
  constructor(private readonly metadataByType: Partial<Record<MediaAssetType, MediaAssetMetadata>> = {}) {}

  async inspect(input: { type: MediaAssetType; mimeType: string; bytes: Uint8Array }): Promise<MediaAssetMetadata> {
    const configured = this.metadataByType[input.type];
    if (configured) return { ...configured };
    if (input.type === "video" || input.type === "b_roll") return { width: 1080, height: 1920, durationMs: input.bytes.byteLength * 10 };
    if (input.type === "image" || input.type === "logo" || input.type === "thumbnail") return { width: 1080, height: 1080 };
    if (input.type === "voice" || input.type === "music") return { durationMs: input.bytes.byteLength * 10, channels: 2 };
    return {};
  }
}
