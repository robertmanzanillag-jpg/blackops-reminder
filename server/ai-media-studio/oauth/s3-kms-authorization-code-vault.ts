import { createHash } from "node:crypto";
import { DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { aiMediaOAuthPlatformSchema } from "../../../shared/ai-media-studio-oauth";
import { OAuthFlowError, type OAuthAuthorizationCodeVault, type OAuthAuthorizationCodeVaultContext } from "./contracts";
import {
  assertExpectedBucketOwner, assertKmsKeyArn, boundedClient, canonicalContextBytes, decryptEnvelope, digestContext, encryptEnvelope,
  isExactS3KeyAbsence,
  MAX_ENVELOPE_BYTES,
  normalizedExactMetadata, normalizeEnvelopeKmsConfig, officialS3Endpoint, readBoundedBody, safeEqual, validBucket, vaultRejected,
  type AwsCommandClient, type NormalizedEnvelopeKmsConfig,
} from "./s3-kms-envelope";

export const OAUTH_CODE_OBJECT_PREFIX = "ai-media-studio/oauth-code/v1";
const REF = /^vault:\/\/ai-media-studio\/oauth-code\/v1\/([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/u;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const SHA256 = /^[0-9a-f]{64}$/u;
const MAX_TTL = 15 * 60_000;

export type S3KmsAuthorizationCodeVaultConfig = Readonly<{
  bucket: string; region: string; kmsKeyArn: string; expectedBucketOwner: string;
  prefix: typeof OAUTH_CODE_OBJECT_PREFIX; s3Client?: AwsCommandClient; kmsClient?: AwsCommandClient;
  clock?: { now(): Date };
}>;

type Config = Readonly<{ bucket: string; expectedBucketOwner: string; prefix: typeof OAUTH_CODE_OBJECT_PREFIX;
  s3: AwsCommandClient; kms: NormalizedEnvelopeKmsConfig; clock: { now(): Date } }>;

export class S3KmsAuthorizationCodeVault implements OAuthAuthorizationCodeVault {
  private readonly config: Config;
  constructor(config: S3KmsAuthorizationCodeVaultConfig) { this.config = normalize(config); }

  async putOnce(value: string, context: OAuthAuthorizationCodeVaultContext): Promise<string> {
    try {
      const normalized = validateContext(context, this.config.clock, true);
      if (!exactSecret(value) || createHash("sha256").update(value).digest("hex") !== normalized.codeDigest) throw vaultRejected();
      const aad = aadFor(normalized); const bindingDigest = digestContext(aad);
      const plaintext = Buffer.from(JSON.stringify({ v: 1, value, expiresAt: normalized.expiresAt }), "utf8");
      let encrypted: Awaited<ReturnType<typeof encryptEnvelope>>;
      try { encrypted = await encryptEnvelope(plaintext, aad, this.config.kms); } finally { plaintext.fill(0); }
      try {
        await this.config.s3.send(new PutObjectCommand({
          Bucket: this.config.bucket, Key: keyFor(normalized.sessionId), ExpectedBucketOwner: this.config.expectedBucketOwner,
          Body: encrypted.body, ContentLength: encrypted.body.byteLength, ContentType: "application/json",
          ServerSideEncryption: "aws:kms", SSEKMSKeyId: this.config.kms.kmsKeyArn, BucketKeyEnabled: true,
          IfNoneMatch: "*", Expires: httpExpiry(normalized.expiresAt), Tagging: "classification=oauth-code&retention=ephemeral",
          Metadata: { "binding-digest": bindingDigest, "envelope-version": "v1" },
        }));
      } catch {
        const recovered = await this.readExact(normalized);
        if (!safeEqual(recovered, value)) throw vaultRejected();
      }
      return referenceFor(normalized.sessionId);
    } catch (error) { if (error instanceof OAuthFlowError) throw error; throw vaultRejected(); }
  }

  async read(reference: string, context: OAuthAuthorizationCodeVaultContext): Promise<string> {
    try {
      const normalized = validateContext(context, this.config.clock, false);
      if (!safeEqual(idFromRef(reference), normalized.sessionId) || Date.parse(normalized.expiresAt) <= now(this.config.clock)) throw vaultRejected();
      const value = await this.readExact(normalized);
      if (Date.parse(normalized.expiresAt) <= now(this.config.clock)) throw vaultRejected();
      return value;
    } catch (error) { if (error instanceof OAuthFlowError) throw error; throw vaultRejected(); }
  }

  async delete(reference: string, context: OAuthAuthorizationCodeVaultContext): Promise<void> {
    try {
      const normalized = validateContext(context, this.config.clock, false);
      if (!safeEqual(idFromRef(reference), normalized.sessionId)) throw vaultRejected();
      let head: any;
      try { head = await this.config.s3.send(new HeadObjectCommand({ Bucket: this.config.bucket, Key: keyFor(normalized.sessionId), ExpectedBucketOwner: this.config.expectedBucketOwner })); }
      catch (error) { if (isExactS3KeyAbsence(error, true)) return; throw error; }
      validateStored(head, normalized, digestContext(aadFor(normalized)), this.config.kms.kmsKeyArn);
      await this.config.s3.send(new DeleteObjectCommand({ Bucket: this.config.bucket, Key: keyFor(normalized.sessionId), ExpectedBucketOwner: this.config.expectedBucketOwner }));
    } catch (error) { if (error instanceof OAuthFlowError) throw error; throw vaultRejected(); }
  }

  private async readExact(context: OAuthAuthorizationCodeVaultContext): Promise<string> {
    const aad = aadFor(context); const bindingDigest = digestContext(aad);
    const result = await this.config.s3.send(new GetObjectCommand({ Bucket: this.config.bucket, Key: keyFor(context.sessionId), ExpectedBucketOwner: this.config.expectedBucketOwner }));
    validateStored(result, context, bindingDigest, this.config.kms.kmsKeyArn);
    const plaintext = await decryptEnvelope(await readBoundedBody(result?.Body), aad, bindingDigest, this.config.kms);
    let parsed: unknown; try { parsed = JSON.parse(plaintext.toString("utf8")); } finally { plaintext.fill(0); }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw vaultRejected();
    const value = parsed as Record<string, unknown>;
    if (Object.keys(value).sort().join(",") !== "expiresAt,v,value" || value.v !== 1 || value.expiresAt !== context.expiresAt
      || typeof value.value !== "string" || !exactSecret(value.value)
      || createHash("sha256").update(value.value).digest("hex") !== context.codeDigest) throw vaultRejected();
    return value.value;
  }
}

function normalize(config: S3KmsAuthorizationCodeVaultConfig): Config {
  if (!validBucket(config.bucket) || !/^\d{12}$/u.test(config.expectedBucketOwner) || config.prefix !== OAUTH_CODE_OBJECT_PREFIX) throw vaultRejected();
  const partition = assertKmsKeyArn(config.kmsKeyArn, config.region);
  assertExpectedBucketOwner(config.kmsKeyArn, config.expectedBucketOwner);
  return { bucket: config.bucket, expectedBucketOwner: config.expectedBucketOwner, prefix: config.prefix,
    s3: boundedClient(config.s3Client ?? new S3Client({ region: config.region, endpoint: officialS3Endpoint(partition, config.region) })),
    kms: normalizeEnvelopeKmsConfig(config), clock: config.clock ?? { now: () => new Date() } };
}

function validateContext(context: OAuthAuthorizationCodeVaultContext, clock: { now(): Date }, future: boolean): OAuthAuthorizationCodeVaultContext {
  if (context?.purpose !== "ai_media_oauth_authorization_code" || !safeField(context.ownerUserId) || !safeField(context.workspaceId)
    || !safeField(context.actorUserId) || !UUID.test(context.providerAccountId) || !UUID.test(context.sessionId)
    || !UUID.test(context.tokenBindingId) || !SHA256.test(context.codeDigest) || !aiMediaOAuthPlatformSchema.safeParse(context.platform).success) throw vaultRejected();
  const expires = Date.parse(context.expiresAt); const current = now(clock);
  if (!Number.isFinite(expires) || new Date(expires).toISOString() !== context.expiresAt || (future && (expires <= current || expires-current > MAX_TTL))) throw vaultRejected();
  return context;
}

function aadFor(c: OAuthAuthorizationCodeVaultContext): Buffer { return canonicalContextBytes([
  c.purpose,c.ownerUserId,c.workspaceId,c.actorUserId,c.providerAccountId,c.platform,c.sessionId,c.tokenBindingId,c.codeDigest,c.expiresAt,
]); }
function validateStored(v: any, c: OAuthAuthorizationCodeVaultContext, digest: string, keyArn: string): void {
  const metadata = normalizedExactMetadata(v?.Metadata);
  if (v?.ServerSideEncryption !== "aws:kms" || v?.SSEKMSKeyId !== keyArn || v?.BucketKeyEnabled !== true || v?.ContentType !== "application/json"
    || !(v?.Expires instanceof Date) || v.Expires.toISOString() !== httpExpiry(c.expiresAt).toISOString()
    || (v?.ContentLength !== undefined && (!Number.isSafeInteger(v.ContentLength) || v.ContentLength < 1 || v.ContentLength > MAX_ENVELOPE_BYTES))
    || Object.keys(metadata).sort().join(",") !== "binding-digest,envelope-version" || metadata["binding-digest"] !== digest || metadata["envelope-version"] !== "v1") throw vaultRejected();
}
function exactSecret(v: string): boolean { return typeof v === "string" && v.length > 0 && v.length <= 16_384 && !/[\u0000-\u0020\u007f]/u.test(v); }
function safeField(v: string): boolean { return typeof v === "string" && /^[A-Za-z0-9._:/-]{1,200}$/u.test(v); }
function keyFor(id: string): string { return `${OAUTH_CODE_OBJECT_PREFIX}/${id}.json`; }
function referenceFor(id: string): string { return `vault://ai-media-studio/oauth-code/v1/${id}`; }
function idFromRef(ref: string): string { const match=REF.exec(ref); if(!match) throw vaultRejected(); return match[1]; }
function now(clock:{now():Date}):number { const d=clock.now(); if(!(d instanceof Date)||!Number.isFinite(d.getTime())) throw vaultRejected(); return d.getTime(); }
function httpExpiry(v:string):Date { return new Date(Math.floor(Date.parse(v)/1000)*1000); }
