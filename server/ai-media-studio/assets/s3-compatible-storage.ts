import { createHash, timingSafeEqual } from "node:crypto";
import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CopyObjectCommand,
  CreateMultipartUploadCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  S3Client,
  UploadPartCommand,
  type HeadObjectCommandOutput,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type { AssetDeliverySigner, OwnedObjectStorage, OwnedObjectUpload } from "./contracts";
import { storageTenantSegment } from "./object-keys";

const MIN_MULTIPART_PART_BYTES = 5 * 1024 * 1024;
const MAX_MULTIPART_PARTS = 10_000;
const MAX_DELIVERY_TTL_SECONDS = 900;

export interface S3CommandClient {
  send(command: unknown): Promise<any>;
}

export interface S3CompatibleCredentials {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
}

export type S3CompatiblePresign = (
  client: S3CommandClient,
  command: GetObjectCommand,
  options: { expiresIn: number; signingDate: Date },
) => Promise<string>;

export interface S3CompatibleObjectStorageConfig {
  endpoint?: string;
  region: string;
  bucket: string;
  credentials?: S3CompatibleCredentials;
  /** Backwards-compatible credential shape; prefer `credentials`. */
  accessKeyId?: string;
  secretAccessKey?: string;
  sessionToken?: string;
  forcePathStyle?: boolean;
  multipartPartSizeBytes?: number;
  client?: S3CommandClient;
  presign?: S3CompatiblePresign;
  clock?: { now(): Date };
}

interface NormalizedConfig {
  bucket: string;
  partSizeBytes: number;
  client: S3CommandClient;
  presign: S3CompatiblePresign;
  clock: { now(): Date };
}

export class S3CompatibleOwnedObjectStorage implements OwnedObjectStorage {
  private readonly config: NormalizedConfig;

  constructor(config: S3CompatibleObjectStorageConfig) {
    this.config = normalizeConfig(config);
  }

  async beginUpload(input: { tenantId: string; temporaryObjectKey: string }): Promise<OwnedObjectUpload> {
    assertTenantObjectKey(input.tenantId, input.temporaryObjectKey);
    // Allocate the only full part buffer before creating remote multipart state so a
    // local allocation failure cannot orphan an upload ID.
    const initialPartBuffer = new Uint8Array(this.config.partSizeBytes);
    const created = await sendOrThrow<{ UploadId?: string }>(
      this.config.client,
      new CreateMultipartUploadCommand({
        Bucket: this.config.bucket,
        Key: input.temporaryObjectKey,
        ContentType: "video/mp4",
      }),
      "multipart upload could not be started",
    );
    if (!created.UploadId) throw new Error("multipart upload could not be started");

    return new MultipartOwnedObjectUpload({
      tenantId: input.tenantId,
      temporaryObjectKey: input.temporaryObjectKey,
      uploadId: created.UploadId,
      config: this.config,
      initialPartBuffer,
    });
  }
}

export class S3CompatibleAssetDeliverySigner implements AssetDeliverySigner {
  private readonly config: NormalizedConfig;

  constructor(config: S3CompatibleObjectStorageConfig) {
    this.config = normalizeConfig(config);
  }

  async sign(input: { tenantId: string; objectKey: string; expiresInSeconds: number }) {
    assertContentAddressedTenantKey(input.tenantId, input.objectKey);
    if (
      !Number.isInteger(input.expiresInSeconds)
      || input.expiresInSeconds < 1
      || input.expiresInSeconds > MAX_DELIVERY_TTL_SECONDS
    ) {
      throw new Error("asset delivery URLs must use a short TTL");
    }

    const signingDate = this.config.clock.now();
    if (!(signingDate instanceof Date) || !Number.isFinite(signingDate.getTime())) {
      throw new Error("asset delivery clock returned an invalid date");
    }
    try {
      const signedUrl = await this.config.presign(
        this.config.client,
        new GetObjectCommand({
          Bucket: this.config.bucket,
          Key: input.objectKey,
          ResponseContentType: "video/mp4",
          ResponseContentDisposition: 'inline; filename="ai-media-studio-video.mp4"',
        }),
        { expiresIn: input.expiresInSeconds, signingDate: new Date(signingDate.getTime()) },
      );
      if (new URL(signedUrl).protocol !== "https:") throw new Error("unsafe signed URL");
      return signedUrl;
    } catch {
      throw new Error("asset delivery URL could not be signed");
    }
  }
}

class MultipartOwnedObjectUpload implements OwnedObjectUpload {
  private partBuffer: Uint8Array;
  private bufferedBytes = 0;
  private totalBytes = 0;
  private readonly digest = createHash("sha256");
  private readonly completedParts: Array<{ ETag: string; PartNumber: number }> = [];
  private state: "open" | "temporary-complete" | "ended" = "open";
  private writing = false;

  constructor(private readonly input: {
    tenantId: string;
    temporaryObjectKey: string;
    uploadId: string;
    config: NormalizedConfig;
    initialPartBuffer: Uint8Array;
  }) {
    this.partBuffer = input.initialPartBuffer;
  }

  async write(chunk: Uint8Array): Promise<void> {
    this.assertOpen();
    if (this.writing) throw new Error("concurrent upload writes are not supported");
    if (!(chunk instanceof Uint8Array)) throw new Error("upload chunks must be byte arrays");
    if (chunk.byteLength === 0) return;
    this.writing = true;
    try {
      this.digest.update(chunk);
      this.totalBytes += chunk.byteLength;
      if (!Number.isSafeInteger(this.totalBytes)) throw new Error("uploaded object is too large");

      let offset = 0;
      while (offset < chunk.byteLength) {
        const length = Math.min(this.partBuffer.byteLength - this.bufferedBytes, chunk.byteLength - offset);
        this.partBuffer.set(chunk.subarray(offset, offset + length), this.bufferedBytes);
        this.bufferedBytes += length;
        offset += length;
        if (this.bufferedBytes === this.partBuffer.byteLength) await this.uploadBufferedPart();
      }
    } catch (error) {
      await this.abortMultipartBestEffort();
      this.state = "ended";
      if (error instanceof Error && isSafeLocalUploadError(error.message)) throw error;
      throw new Error("multipart upload part failed");
    } finally {
      this.writing = false;
    }
  }

  async commit(metadata: { mimeType: "video/mp4"; sizeBytes: number; sha256: string }) {
    this.assertOpen();
    if (this.writing) throw new Error("upload write is still in progress");
    this.state = "ended";

    const actualSha256 = this.digest.digest("hex");
    if (
      metadata.mimeType !== "video/mp4"
      || !Number.isSafeInteger(metadata.sizeBytes)
      || metadata.sizeBytes < 0
      || metadata.sizeBytes !== this.totalBytes
      || !safeEqualSha256(actualSha256, metadata.sha256)
    ) {
      await this.abortMultipartBestEffort();
      throw new Error("object metadata mismatch");
    }

    try {
      if (this.bufferedBytes > 0 || this.completedParts.length === 0) await this.uploadBufferedPart();
      await sendOrThrow(
        this.input.config.client,
        new CompleteMultipartUploadCommand({
          Bucket: this.input.config.bucket,
          Key: this.input.temporaryObjectKey,
          UploadId: this.input.uploadId,
          MultipartUpload: { Parts: this.completedParts },
        }),
        "multipart upload could not be completed",
      );
      this.state = "temporary-complete";
    } catch {
      await this.abortMultipartBestEffort();
      this.state = "ended";
      throw new Error("multipart upload could not be completed");
    }

    const finalObjectKey = contentAddressedObjectKey(this.input.tenantId, metadata.sha256);
    try {
      const existing = await headObject(this.input.config, finalObjectKey);
      if (existing) {
        assertObjectMatches(existing, this.input.tenantId, metadata);
        return { finalObjectKey, reused: true };
      }

      await sendOrThrow(
        this.input.config.client,
        new CopyObjectCommand({
          Bucket: this.input.config.bucket,
          Key: finalObjectKey,
          CopySource: copySource(this.input.config.bucket, this.input.temporaryObjectKey),
          MetadataDirective: "REPLACE",
          ContentType: metadata.mimeType,
          Metadata: objectMetadata(this.input.tenantId, metadata),
        }),
        "content-addressed object could not be promoted",
      );
      const promoted = await headObject(this.input.config, finalObjectKey);
      if (!promoted) throw new Error("content-addressed object verification failed");
      assertObjectMatches(promoted, this.input.tenantId, metadata);
      return { finalObjectKey, reused: false };
    } finally {
      await this.deleteTemporaryBestEffort();
      this.state = "ended";
    }
  }

  async abort(): Promise<void> {
    if (this.state === "ended") return;
    if (this.state === "temporary-complete") await this.deleteTemporaryBestEffort();
    else await this.abortMultipartBestEffort();
    this.state = "ended";
  }

  private async uploadBufferedPart() {
    if (this.completedParts.length >= MAX_MULTIPART_PARTS) throw new Error("multipart upload has too many parts");
    const partNumber = this.completedParts.length + 1;
    const body = this.partBuffer.subarray(0, this.bufferedBytes);
    const uploaded = await sendOrThrow<{ ETag?: string }>(
      this.input.config.client,
      new UploadPartCommand({
        Bucket: this.input.config.bucket,
        Key: this.input.temporaryObjectKey,
        UploadId: this.input.uploadId,
        PartNumber: partNumber,
        Body: body,
      }),
      "multipart upload part failed",
    );
    if (!uploaded.ETag) throw new Error("multipart upload part failed");
    this.completedParts.push({ ETag: uploaded.ETag, PartNumber: partNumber });
    this.partBuffer = new Uint8Array(this.input.config.partSizeBytes);
    this.bufferedBytes = 0;
  }

  private async abortMultipartBestEffort() {
    try {
      await this.input.config.client.send(new AbortMultipartUploadCommand({
        Bucket: this.input.config.bucket,
        Key: this.input.temporaryObjectKey,
        UploadId: this.input.uploadId,
      }));
    } catch {
      // Cleanup is best effort; never replace the safe primary failure with provider details.
    }
  }

  private async deleteTemporaryBestEffort() {
    try {
      await this.input.config.client.send(new DeleteObjectCommand({
        Bucket: this.input.config.bucket,
        Key: this.input.temporaryObjectKey,
      }));
    } catch {
      // Lifecycle rules provide a second cleanup line for completed temporary objects.
    }
  }

  private assertOpen() {
    if (this.state !== "open") throw new Error("upload already ended");
  }
}

function normalizeConfig(config: S3CompatibleObjectStorageConfig): NormalizedConfig {
  if (!config.region?.trim() || !config.bucket?.trim()) throw new Error("S3-compatible storage config is incomplete");
  if (config.endpoint) {
    let endpoint: URL;
    try {
      endpoint = new URL(config.endpoint);
    } catch {
      throw new Error("S3-compatible storage endpoint is invalid");
    }
    if (endpoint.protocol !== "https:") throw new Error("S3-compatible storage endpoint must be HTTPS");
    if (endpoint.username || endpoint.password || endpoint.search || endpoint.hash) {
      throw new Error("S3-compatible storage endpoint must not contain credentials, query, or fragment data");
    }
  }

  const partSizeBytes = config.multipartPartSizeBytes ?? MIN_MULTIPART_PART_BYTES;
  if (!Number.isSafeInteger(partSizeBytes) || partSizeBytes < MIN_MULTIPART_PART_BYTES) {
    throw new Error("multipart part size must be at least 5 MiB");
  }

  const suppliedCredentials = config.credentials ?? (
    config.accessKeyId || config.secretAccessKey || config.sessionToken
      ? { accessKeyId: config.accessKeyId ?? "", secretAccessKey: config.secretAccessKey ?? "", sessionToken: config.sessionToken }
      : undefined
  );
  if (!config.client && (!suppliedCredentials?.accessKeyId || !suppliedCredentials.secretAccessKey)) {
    throw new Error("S3-compatible storage credentials are incomplete");
  }

  const client = config.client ?? new S3Client({
    region: config.region,
    bucketEndpoint: false,
    ...(config.endpoint ? { endpoint: config.endpoint } : {}),
    ...(suppliedCredentials ? { credentials: suppliedCredentials } : {}),
    forcePathStyle: config.forcePathStyle ?? false,
  }) as S3CommandClient;

  return {
    bucket: config.bucket,
    partSizeBytes,
    client,
    presign: config.presign ?? (async (targetClient, command, options) => getSignedUrl(
      targetClient as S3Client,
      command,
      options,
    )),
    clock: config.clock ?? { now: () => new Date() },
  };
}

async function headObject(config: NormalizedConfig, key: string): Promise<HeadObjectCommandOutput | undefined> {
  try {
    return await config.client.send(new HeadObjectCommand({ Bucket: config.bucket, Key: key }));
  } catch (error) {
    if (isNotFound(error)) return undefined;
    throw new Error("content-addressed object could not be inspected");
  }
}

function isNotFound(error: unknown) {
  if (!error || typeof error !== "object") return false;
  const candidate = error as { name?: unknown; $metadata?: { httpStatusCode?: unknown } };
  return candidate.$metadata?.httpStatusCode === 404 || candidate.name === "NotFound" || candidate.name === "NoSuchKey";
}

async function sendOrThrow<T>(client: S3CommandClient, command: unknown, safeMessage: string): Promise<T> {
  try {
    return await client.send(command) as T;
  } catch {
    throw new Error(safeMessage);
  }
}

function objectMetadata(tenantId: string, metadata: { sizeBytes: number; sha256: string }) {
  return {
    sha256: metadata.sha256,
    "size-bytes": String(metadata.sizeBytes),
    "tenant-id-base64url": storageTenantSegment(tenantId),
  };
}

function assertObjectMatches(
  object: HeadObjectCommandOutput,
  tenantId: string,
  expected: { mimeType: "video/mp4"; sizeBytes: number; sha256: string },
) {
  const metadata = lowerCaseMetadata(object.Metadata);
  if (
    object.ContentLength !== expected.sizeBytes
    || normalizeMime(object.ContentType) !== expected.mimeType
    || !safeEqualSha256(metadata.sha256 ?? "", expected.sha256)
    || metadata["size-bytes"] !== String(expected.sizeBytes)
    || metadata["tenant-id-base64url"] !== storageTenantSegment(tenantId)
  ) {
    throw new Error("content-addressed object verification failed");
  }
}

function lowerCaseMetadata(metadata: Record<string, string> | undefined) {
  return Object.fromEntries(Object.entries(metadata ?? {}).map(([key, value]) => [key.toLowerCase(), value]));
}

function normalizeMime(value: string | undefined) {
  return value?.split(";", 1)[0].trim().toLowerCase();
}

function contentAddressedObjectKey(tenantId: string, sha256: string) {
  if (!/^[a-f0-9]{64}$/.test(sha256)) throw new Error("sha256 digest is invalid");
  return `${tenantPrefix(tenantId)}sha256/${sha256}.mp4`;
}

function assertTenantObjectKey(tenantId: string, objectKey: string) {
  if (
    !objectKey.startsWith(tenantPrefix(tenantId))
    || objectKey.includes("\\")
    || objectKey.includes("//")
    || objectKey.split("/").some((segment) => segment === "." || segment === "..")
    || /[\u0000-\u001f\u007f]/.test(objectKey)
  ) {
    throw new Error("object key is outside tenant asset namespace");
  }
}

function assertContentAddressedTenantKey(tenantId: string, objectKey: string) {
  assertTenantObjectKey(tenantId, objectKey);
  const suffix = objectKey.slice(tenantPrefix(tenantId).length);
  if (!/^sha256\/[a-f0-9]{64}\.mp4$/.test(suffix)) throw new Error("asset object key is not content addressed");
}

function tenantPrefix(tenantId: string) {
  return `ai-media-studio/${storageTenantSegment(tenantId)}/`;
}

function copySource(bucket: string, objectKey: string) {
  return `/${encodeURIComponent(bucket)}/${objectKey.split("/").map(encodeURIComponent).join("/")}`;
}

function safeEqualSha256(left: string, right: string) {
  if (!/^[a-f0-9]{64}$/.test(left) || !/^[a-f0-9]{64}$/.test(right)) return false;
  return timingSafeEqual(Buffer.from(left, "hex"), Buffer.from(right, "hex"));
}

function isSafeLocalUploadError(message: string) {
  return new Set([
    "uploaded object is too large",
    "multipart upload has too many parts",
    "multipart upload part failed",
  ]).has(message);
}
