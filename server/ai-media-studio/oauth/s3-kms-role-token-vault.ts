import { DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import {
  OAUTH_ROLE_TOKEN_VAULT_VERSION,
  OAuthRoleTokenVaultError,
  oauthRoleTokenReferenceFor,
  parseOAuthRoleTokenReference,
  validateOAuthRoleTokenDescriptorForContext,
  validateOAuthRoleTokenSecret,
  validateOAuthRoleTokenVaultContext,
  type OAuthRoleTokenDescriptor,
  type OAuthRoleTokenSecretReader,
  type OAuthRoleTokenVault,
  type OAuthRoleTokenVaultContext,
  type OAuthRoleTokenVaultRecord,
} from "./role-token-vault-contracts";
import {
  MAX_ENVELOPE_BYTES,
  assertExpectedBucketOwner,
  assertKmsKeyArn,
  boundedClient,
  canonicalContextBytes,
  decryptEnvelope,
  digestContext,
  encryptEnvelope,
  isExactS3KeyAbsence,
  normalizeEnvelopeKmsConfig,
  normalizedExactMetadata,
  officialS3Endpoint,
  readBoundedBody,
  safeEqual,
  validBucket,
  type AwsCommandClient,
  type NormalizedEnvelopeKmsConfig,
} from "./s3-kms-envelope";

export const OAUTH_ROLE_TOKEN_OBJECT_PREFIX = "ai-media-studio/oauth-role-token/v2" as const;

export type S3KmsRoleTokenVaultConfig = Readonly<{
  bucket: string;
  region: string;
  kmsKeyArn: string;
  expectedBucketOwner: string;
  prefix: typeof OAUTH_ROLE_TOKEN_OBJECT_PREFIX;
  s3Client?: AwsCommandClient;
  kmsClient?: AwsCommandClient;
  clock?: Readonly<{ now(): Date }>;
}>;

type NormalizedConfig = Readonly<{
  bucket: string;
  expectedBucketOwner: string;
  s3: AwsCommandClient;
  kms: NormalizedEnvelopeKmsConfig;
  clock: Readonly<{ now(): Date }>;
}>;

type RoleTokenPayload = Readonly<{
  v: typeof OAUTH_ROLE_TOKEN_VAULT_VERSION;
  secret: string;
  descriptor: OAuthRoleTokenDescriptor;
}>;

class ExactRoleTokenObjectNotFound extends Error {}

class S3KmsRoleTokenVaultCore implements OAuthRoleTokenVault {
  private readonly config: NormalizedConfig;

  constructor(config: S3KmsRoleTokenVaultConfig) {
    try {
      this.config = normalizeConfig(config);
    } catch (error) {
      if (error instanceof OAuthRoleTokenVaultError) throw error;
      throw rejected();
    }
  }

  async putOnce(input: Readonly<{
    context: OAuthRoleTokenVaultContext;
    secret: string;
    descriptor: OAuthRoleTokenDescriptor;
  }>): Promise<OAuthRoleTokenVaultRecord> {
    try {
      assertExactInput(input);
      const context = validateOAuthRoleTokenVaultContext(input.context);
      const descriptor = validateOAuthRoleTokenDescriptorForContext(input.descriptor, context, nowIso(this.config.clock));
      const payload = validatePayload({ v: OAUTH_ROLE_TOKEN_VAULT_VERSION, secret: input.secret, descriptor }, context);
      const aad = aadFor(context);
      const bindingDigest = digestContext(aad);
      const plaintext = Buffer.from(JSON.stringify(payload), "utf8");
      let encrypted: Awaited<ReturnType<typeof encryptEnvelope>>;
      try {
        encrypted = await encryptEnvelope(plaintext, aad, this.config.kms);
      } finally {
        plaintext.fill(0);
      }
      const reference = oauthRoleTokenReferenceFor(context);
      const opaqueBinding = parseOAuthRoleTokenReference(reference);
      try {
        await this.config.s3.send(new PutObjectCommand({
          Bucket: this.config.bucket,
          Key: keyFor(opaqueBinding),
          ExpectedBucketOwner: this.config.expectedBucketOwner,
          Body: encrypted.body,
          ContentLength: encrypted.body.byteLength,
          ContentType: "application/json",
          ServerSideEncryption: "aws:kms",
          SSEKMSKeyId: this.config.kms.kmsKeyArn,
          BucketKeyEnabled: true,
          IfNoneMatch: "*",
          Tagging: "classification=oauth-role-token&retention=credential",
          Metadata: {
            "artifact-version": "v2",
            "binding-digest": bindingDigest,
            "envelope-version": "v1",
          },
        }));
      } catch {
        const recovered = await this.readPayload(reference, context);
        if (!samePayload(recovered, payload)) throw rejected();
      }
      return Object.freeze({ reference, descriptor: payload.descriptor });
    } catch (error) {
      if (error instanceof OAuthRoleTokenVaultError) throw error;
      throw rejected();
    }
  }

  async find(context: OAuthRoleTokenVaultContext): Promise<OAuthRoleTokenVaultRecord | undefined> {
    try {
      const normalized = validateOAuthRoleTokenVaultContext(context);
      const reference = oauthRoleTokenReferenceFor(normalized);
      const payload = await this.readPayloadRaw(reference, normalized);
      return Object.freeze({ reference, descriptor: payload.descriptor });
    } catch (error) {
      if (error instanceof ExactRoleTokenObjectNotFound) return undefined;
      if (error instanceof OAuthRoleTokenVaultError) throw error;
      throw rejected();
    }
  }

  async readDescriptor(reference: string, context: OAuthRoleTokenVaultContext): Promise<OAuthRoleTokenDescriptor> {
    return (await this.readPayload(reference, context)).descriptor;
  }

  async delete(reference: string, context: OAuthRoleTokenVaultContext): Promise<void> {
    try {
      const normalized = validateOAuthRoleTokenVaultContext(context);
      const opaqueBinding = assertReferenceMatches(reference, normalized);
      let head: unknown;
      try {
        head = await this.config.s3.send(new HeadObjectCommand({
          Bucket: this.config.bucket,
          Key: keyFor(opaqueBinding),
          ExpectedBucketOwner: this.config.expectedBucketOwner,
        }));
      } catch (error) {
        if (isExactS3KeyAbsence(error, true)) return;
        throw error;
      }
      validateStoredObject(head, digestContext(aadFor(normalized)), this.config.kms.kmsKeyArn);
      await this.config.s3.send(new DeleteObjectCommand({
        Bucket: this.config.bucket,
        Key: keyFor(opaqueBinding),
        ExpectedBucketOwner: this.config.expectedBucketOwner,
      }));
    } catch (error) {
      if (error instanceof OAuthRoleTokenVaultError) throw error;
      throw rejected();
    }
  }

  async readSecret(reference: string, context: OAuthRoleTokenVaultContext): Promise<string> {
    return (await this.readPayload(reference, context)).secret;
  }

  private async readPayload(reference: string, context: OAuthRoleTokenVaultContext): Promise<RoleTokenPayload> {
    try {
      return await this.readPayloadRaw(reference, validateOAuthRoleTokenVaultContext(context));
    } catch (error) {
      if (error instanceof OAuthRoleTokenVaultError) throw error;
      throw rejected();
    }
  }

  private async readPayloadRaw(reference: string, context: OAuthRoleTokenVaultContext): Promise<RoleTokenPayload> {
    const opaqueBinding = assertReferenceMatches(reference, context);
    const aad = aadFor(context);
    const bindingDigest = digestContext(aad);
    let result: unknown;
    try {
      result = await this.config.s3.send(new GetObjectCommand({
        Bucket: this.config.bucket,
        Key: keyFor(opaqueBinding),
        ExpectedBucketOwner: this.config.expectedBucketOwner,
      }));
    } catch (error) {
      if (isExactS3KeyAbsence(error)) throw new ExactRoleTokenObjectNotFound();
      throw error;
    }
    validateStoredObject(result, bindingDigest, this.config.kms.kmsKeyArn);
    const plaintext = await decryptEnvelope(
      await readBoundedBody((result as { Body?: unknown })?.Body),
      aad,
      bindingDigest,
      this.config.kms,
    );
    let parsed: unknown;
    try {
      parsed = JSON.parse(plaintext.toString("utf8"));
    } catch {
      throw rejected();
    } finally {
      plaintext.fill(0);
    }
    return validatePayload(parsed, context);
  }
}

export type S3KmsRoleTokenVaultCapabilities = Readonly<{
  vault: OAuthRoleTokenVault;
  secretReader: OAuthRoleTokenSecretReader;
}>;

export function createS3KmsRoleTokenVaultCapabilities(
  config: S3KmsRoleTokenVaultConfig,
): S3KmsRoleTokenVaultCapabilities {
  const core = new S3KmsRoleTokenVaultCore(config);
  return Object.freeze({
    vault: Object.freeze({
      putOnce: core.putOnce.bind(core),
      find: core.find.bind(core),
      readDescriptor: core.readDescriptor.bind(core),
      delete: core.delete.bind(core),
    }),
    secretReader: Object.freeze({ readSecret: core.readSecret.bind(core) }),
  });
}

function normalizeConfig(config: S3KmsRoleTokenVaultConfig): NormalizedConfig {
  const allowed = ["bucket", "clock", "expectedBucketOwner", "kmsClient", "kmsKeyArn", "prefix", "region", "s3Client"];
  if (!config || typeof config !== "object" || Array.isArray(config)
    || (Object.getPrototypeOf(config) !== Object.prototype && Object.getPrototypeOf(config) !== null)
    || Object.keys(config).some((key) => !allowed.includes(key))
    || !validBucket(config.bucket) || !/^\d{12}$/u.test(config.expectedBucketOwner)
    || config.prefix !== OAUTH_ROLE_TOKEN_OBJECT_PREFIX
    || (config.s3Client !== undefined && (typeof config.s3Client !== "object" || typeof config.s3Client.send !== "function"))
    || (config.kmsClient !== undefined && (typeof config.kmsClient !== "object" || typeof config.kmsClient.send !== "function"))
    || (config.clock !== undefined && (typeof config.clock !== "object" || typeof config.clock.now !== "function"
      || Object.keys(config.clock).sort().join(",") !== "now"))) {
    throw rejected();
  }
  const partition = assertKmsKeyArn(config.kmsKeyArn, config.region);
  assertExpectedBucketOwner(config.kmsKeyArn, config.expectedBucketOwner);
  return Object.freeze({
    bucket: config.bucket,
    expectedBucketOwner: config.expectedBucketOwner,
    s3: boundedClient(config.s3Client ?? new S3Client({
      region: config.region,
      endpoint: officialS3Endpoint(partition, config.region),
      followRegionRedirects: false,
      maxAttempts: 1,
    })),
    kms: normalizeEnvelopeKmsConfig(config),
    clock: config.clock ?? Object.freeze({ now: () => new Date() }),
  });
}

function validatePayload(raw: unknown, context: OAuthRoleTokenVaultContext): RoleTokenPayload {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)
    || (Object.getPrototypeOf(raw) !== Object.prototype && Object.getPrototypeOf(raw) !== null)) throw rejected();
  const value = raw as Record<string, unknown>;
  if (Object.keys(value).sort().join(",") !== "descriptor,secret,v" || value.v !== OAUTH_ROLE_TOKEN_VAULT_VERSION) throw rejected();
  return Object.freeze({
    v: OAUTH_ROLE_TOKEN_VAULT_VERSION,
    secret: validateOAuthRoleTokenSecret(value.secret),
    descriptor: validateOAuthRoleTokenDescriptorForContext(value.descriptor, context),
  });
}

function aadFor(context: OAuthRoleTokenVaultContext): Buffer {
  return canonicalContextBytes([
    context.purpose,
    context.ownerUserId,
    context.workspaceId,
    context.actorUserId,
    context.providerAccountId,
    context.platform,
    context.sessionId,
    context.attemptId,
    context.targetCredentialVersion,
    context.tokenBindingId,
    context.artifactBindingId,
    context.role,
    context.candidateId,
    context.targetKind,
    context.targetId,
    context.selectionDigest,
    context.manifestRevision,
  ]);
}

function validateStoredObject(raw: unknown, bindingDigest: string, kmsKeyArn: string): void {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw rejected();
  const value = raw as Record<string, unknown>;
  const metadata = normalizedExactMetadata(value.Metadata);
  if (value.ServerSideEncryption !== "aws:kms" || value.SSEKMSKeyId !== kmsKeyArn
    || value.BucketKeyEnabled !== true || value.ContentType !== "application/json" || value.Expires !== undefined
    || (value.ContentLength !== undefined && (!Number.isSafeInteger(value.ContentLength)
      || Number(value.ContentLength) < 1 || Number(value.ContentLength) > MAX_ENVELOPE_BYTES))
    || Object.keys(metadata).sort().join(",") !== "artifact-version,binding-digest,envelope-version"
    || metadata["artifact-version"] !== "v2" || metadata["binding-digest"] !== bindingDigest
    || metadata["envelope-version"] !== "v1") throw rejected();
}

function assertExactInput(input: unknown): asserts input is Readonly<{
  context: OAuthRoleTokenVaultContext;
  descriptor: OAuthRoleTokenDescriptor;
  secret: string;
}> {
  if (!input || typeof input !== "object" || Array.isArray(input)
    || (Object.getPrototypeOf(input) !== Object.prototype && Object.getPrototypeOf(input) !== null)
    || Object.keys(input as object).sort().join(",") !== "context,descriptor,secret") throw rejected();
}

function assertReferenceMatches(reference: string, context: OAuthRoleTokenVaultContext): string {
  const actual = parseOAuthRoleTokenReference(reference);
  const expected = parseOAuthRoleTokenReference(oauthRoleTokenReferenceFor(context));
  if (!safeEqual(actual, expected)) throw rejected();
  return actual;
}

function samePayload(left: RoleTokenPayload, right: RoleTokenPayload): boolean {
  return safeEqual(JSON.stringify(left), JSON.stringify(right));
}

function keyFor(opaqueBinding: string): string { return `${OAUTH_ROLE_TOKEN_OBJECT_PREFIX}/${opaqueBinding}.json`; }
function nowIso(clock: Readonly<{ now(): Date }>): string {
  const value = clock.now();
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) throw rejected();
  return value.toISOString();
}
function rejected(): OAuthRoleTokenVaultError { return new OAuthRoleTokenVaultError(); }
