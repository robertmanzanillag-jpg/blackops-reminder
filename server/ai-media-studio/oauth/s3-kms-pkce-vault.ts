import { createHash, timingSafeEqual } from "node:crypto";
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { aiMediaOAuthPlatformSchema } from "../../../shared/ai-media-studio-oauth";
import type { OAuthVault, OAuthVaultContext } from "./contracts";
import { OAuthFlowError } from "./contracts";

const REFERENCE = /^vault:\/\/ai-media-studio\/oauth-pkce\/v1\/([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/u;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const PKCE_VERIFIER = /^[A-Za-z0-9._~-]{43,128}$/u;
const SHA256 = /^[0-9a-f]{64}$/u;
const MAX_BODY_BYTES = 4_096;
const MAX_TTL_MS = 15 * 60 * 1_000;
export const OAUTH_PKCE_OBJECT_PREFIX = "ai-media-studio/oauth-pkce/v1";

export interface S3KmsCommandClient {
  send(command: unknown): Promise<any>;
}

export type S3KmsPkceVaultConfig = Readonly<{
  bucket: string;
  region: string;
  kmsKeyArn: string;
  prefix: typeof OAUTH_PKCE_OBJECT_PREFIX;
  client?: S3KmsCommandClient;
  clock?: { now(): Date };
}>;

type NormalizedConfig = Readonly<{
  bucket: string;
  kmsKeyArn: string;
  prefix: typeof OAUTH_PKCE_OBJECT_PREFIX;
  client: S3KmsCommandClient;
  clock: { now(): Date };
}>;

export class S3KmsPkceVault implements OAuthVault {
  private readonly config: NormalizedConfig;

  constructor(config: S3KmsPkceVaultConfig) {
    this.config = normalizeConfig(config);
  }

  async put(value: string, context: OAuthVaultContext): Promise<string> {
    try {
      if (!PKCE_VERIFIER.test(value)) throw rejected();
      const normalized = validateContext(context, this.config.clock, true);
      const bindingDigest = bindingDigestFor(normalized);
      const body = Buffer.from(JSON.stringify({ value, bindingDigest, expiresAt: normalized.expiresAt }), "utf8");
      if (body.byteLength > MAX_BODY_BYTES) throw rejected();
      await this.config.client.send(new PutObjectCommand({
        Bucket: this.config.bucket,
        Key: objectKey(this.config.prefix, normalized.sessionId),
        Body: body,
        ContentLength: body.byteLength,
        ContentType: "application/json",
        ServerSideEncryption: "aws:kms",
        SSEKMSKeyId: this.config.kmsKeyArn,
        BucketKeyEnabled: true,
        IfNoneMatch: "*",
        Metadata: {
          "binding-digest": bindingDigest,
          "expires-at": normalized.expiresAt,
          "session-id": normalized.sessionId,
        },
      }));
      return referenceFor(normalized.sessionId);
    } catch (error) {
      if (error instanceof OAuthFlowError) throw error;
      throw rejected();
    }
  }

  async read(reference: string, context: OAuthVaultContext): Promise<string> {
    try {
      const sessionId = referenceSessionId(reference);
      const normalized = validateContext(context, this.config.clock, false);
      if (!safeEqual(sessionId.toLowerCase(), normalized.sessionId.toLowerCase())) throw rejected();
      const bindingDigest = bindingDigestFor(normalized);
      const result = await this.config.client.send(new GetObjectCommand({
        Bucket: this.config.bucket,
        Key: objectKey(this.config.prefix, normalized.sessionId),
      }));
      validateStoredObject(result, this.config.kmsKeyArn, normalized, bindingDigest);
      const body = await readBoundedBody(result?.Body);
      const envelope = parseEnvelope(body);
      if (
        !safeEqual(envelope.bindingDigest, bindingDigest)
        || envelope.expiresAt !== normalized.expiresAt
        || !PKCE_VERIFIER.test(envelope.value)
        || Date.parse(envelope.expiresAt) <= nowMs(this.config.clock)
      ) throw rejected();
      return envelope.value;
    } catch (error) {
      if (error instanceof OAuthFlowError) throw error;
      throw rejected();
    }
  }

  async delete(reference: string, context: OAuthVaultContext): Promise<void> {
    try {
      const sessionId = referenceSessionId(reference);
      const normalized = validateContext(context, this.config.clock, false);
      if (!safeEqual(sessionId.toLowerCase(), normalized.sessionId.toLowerCase())) throw rejected();
      const bindingDigest = bindingDigestFor(normalized);
      let head: any;
      try {
        head = await this.config.client.send(new HeadObjectCommand({
          Bucket: this.config.bucket,
          Key: objectKey(this.config.prefix, normalized.sessionId),
        }));
      } catch (error) {
        if (isNotFound(error)) return;
        throw error;
      }
      validateStoredObject(head, this.config.kmsKeyArn, normalized, bindingDigest);
      await this.config.client.send(new DeleteObjectCommand({
        Bucket: this.config.bucket,
        Key: objectKey(this.config.prefix, normalized.sessionId),
      }));
    } catch (error) {
      if (error instanceof OAuthFlowError) throw error;
      throw rejected();
    }
  }
}

function validateStoredObject(
  value: any,
  kmsKeyArn: string,
  context: OAuthVaultContext,
  bindingDigest: string,
): void {
  if (
    value?.ServerSideEncryption !== "aws:kms"
    || value?.SSEKMSKeyId !== kmsKeyArn
    || value?.BucketKeyEnabled !== true
    || value?.ContentType !== "application/json"
    || (value?.ContentLength !== undefined && (
      !Number.isSafeInteger(value.ContentLength)
      || value.ContentLength < 1
      || value.ContentLength > MAX_BODY_BYTES
    ))
  ) throw rejected();
  const metadata = normalizedMetadata(value?.Metadata);
  if (
    Object.keys(metadata).length !== 3
    || !safeEqual(metadata["binding-digest"] ?? "", bindingDigest)
    || metadata["expires-at"] !== context.expiresAt
    || !safeEqual(metadata["session-id"] ?? "", context.sessionId)
  ) throw rejected();
}

function normalizeConfig(config: S3KmsPkceVaultConfig): NormalizedConfig {
  if (!validBucket(config.bucket) || !validRegion(config.region) || config.prefix !== OAUTH_PKCE_OBJECT_PREFIX) throw rejected();
  const partition = assertKmsArn(config.kmsKeyArn, config.region);
  return {
    bucket: config.bucket,
    kmsKeyArn: config.kmsKeyArn,
    prefix: config.prefix,
    // Pin the SDK to the partition's official AWS endpoint. This deliberately
    // overrides ambient AWS_ENDPOINT_URL/AWS_ENDPOINT_URL_S3 variables.
    client: config.client ?? new S3Client({
      region: config.region,
      endpoint: officialS3Endpoint(partition, config.region),
    }),
    clock: config.clock ?? { now: () => new Date() },
  };
}

function validateContext(context: OAuthVaultContext, clock: { now(): Date }, requireFutureWithinTtl: boolean): OAuthVaultContext {
  if (
    context?.purpose !== "ai_media_oauth_pkce"
    || !safeField(context.ownerUserId)
    || !safeField(context.workspaceId)
    || !safeField(context.actorUserId)
    || !UUID.test(context.providerAccountId)
    || !UUID.test(context.sessionId)
    || !aiMediaOAuthPlatformSchema.safeParse(context.platform).success
  ) throw rejected();
  const expiresAtMs = Date.parse(context.expiresAt);
  if (!Number.isFinite(expiresAtMs) || new Date(expiresAtMs).toISOString() !== context.expiresAt) throw rejected();
  if (requireFutureWithinTtl) {
    const current = nowMs(clock);
    if (expiresAtMs <= current || expiresAtMs - current > MAX_TTL_MS) throw rejected();
  }
  return context;
}

function bindingDigestFor(context: OAuthVaultContext): string {
  const canonical = JSON.stringify([
    context.purpose,
    context.ownerUserId,
    context.workspaceId,
    context.actorUserId,
    context.providerAccountId,
    context.platform,
    context.sessionId,
    context.expiresAt,
  ]);
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}

function referenceFor(sessionId: string): string {
  return `vault://ai-media-studio/oauth-pkce/v1/${sessionId}`;
}

function referenceSessionId(reference: string): string {
  const match = REFERENCE.exec(reference);
  if (!match) throw rejected();
  return match[1];
}

function objectKey(prefix: string, sessionId: string): string {
  return `${prefix}/${sessionId}.json`;
}

async function readBoundedBody(body: unknown): Promise<string> {
  if (!body || typeof (body as { [Symbol.asyncIterator]?: unknown })[Symbol.asyncIterator] !== "function") throw rejected();
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const rawChunk of body as AsyncIterable<unknown>) {
    const chunk = typeof rawChunk === "string"
      ? Buffer.from(rawChunk, "utf8")
      : rawChunk instanceof Uint8Array
        ? Buffer.from(rawChunk.buffer, rawChunk.byteOffset, rawChunk.byteLength)
        : undefined;
    if (!chunk) throw rejected();
    total += chunk.byteLength;
    if (total > MAX_BODY_BYTES) throw rejected();
    chunks.push(chunk);
  }
  return Buffer.concat(chunks, total).toString("utf8");
}

function parseEnvelope(body: string): { value: string; bindingDigest: string; expiresAt: string } {
  let value: unknown;
  try { value = JSON.parse(body); } catch { throw rejected(); }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw rejected();
  const record = value as Record<string, unknown>;
  if (
    Object.keys(record).sort().join(",") !== "bindingDigest,expiresAt,value"
    || typeof record.value !== "string"
    || typeof record.bindingDigest !== "string"
    || !SHA256.test(record.bindingDigest)
    || typeof record.expiresAt !== "string"
  ) throw rejected();
  return { value: record.value, bindingDigest: record.bindingDigest, expiresAt: record.expiresAt };
}

function normalizedMetadata(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw rejected();
  const output: Record<string, string> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (typeof item !== "string" || key.toLowerCase() in output) throw rejected();
    output[key.toLowerCase()] = item;
  }
  return output;
}

function isNotFound(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const record = error as { name?: unknown; $metadata?: { httpStatusCode?: unknown } };
  return record.name === "NotFound" || record.name === "NoSuchKey" || record.$metadata?.httpStatusCode === 404;
}

function safeField(value: string): boolean {
  return typeof value === "string" && /^[A-Za-z0-9._:/-]{1,200}$/u.test(value);
}

function validBucket(value: string): boolean {
  return typeof value === "string" && /^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/u.test(value) && !value.includes("..") && !/^\d+(?:\.\d+){3}$/u.test(value);
}

function validRegion(value: string): boolean {
  return typeof value === "string" && /^[a-z]{2}(?:-gov)?-[a-z]+-\d$/u.test(value);
}

export function assertOAuthKmsKeyArn(value: string, region: string): void {
  assertKmsArn(value, region);
}

function assertKmsArn(value: string, region: string): "aws" | "aws-us-gov" | "aws-cn" {
  const match = /^arn:(aws|aws-us-gov|aws-cn):kms:([a-z0-9-]+):(\d{12}):key\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/u.exec(value);
  if (!match || match[2] !== region) throw rejected();
  const partition = match[1] as "aws" | "aws-us-gov" | "aws-cn";
  if (
    (partition === "aws-cn") !== region.startsWith("cn-")
    || (partition === "aws-us-gov") !== region.startsWith("us-gov-")
    || (partition === "aws" && (region.startsWith("cn-") || region.startsWith("us-gov-")))
  ) throw rejected();
  return partition;
}

function officialS3Endpoint(partition: "aws" | "aws-us-gov" | "aws-cn", region: string): string {
  return `https://s3.${region}.${partition === "aws-cn" ? "amazonaws.com.cn" : "amazonaws.com"}`;
}

function nowMs(clock: { now(): Date }): number {
  const now = clock.now();
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) throw rejected();
  return now.getTime();
}

function safeEqual(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left, "utf8");
  const rightBytes = Buffer.from(right, "utf8");
  return leftBytes.byteLength === rightBytes.byteLength && timingSafeEqual(leftBytes, rightBytes);
}

function rejected(): OAuthFlowError {
  return new OAuthFlowError("OAuth PKCE vault request was rejected");
}
