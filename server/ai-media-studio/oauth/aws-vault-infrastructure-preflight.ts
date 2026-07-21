import { createHash } from "node:crypto";
import {
  GetBucketEncryptionCommand,
  GetBucketLifecycleConfigurationCommand,
  GetBucketLocationCommand,
  GetBucketOwnershipControlsCommand,
  GetBucketPolicyCommand,
  GetBucketPolicyStatusCommand,
  GetBucketReplicationCommand,
  GetBucketVersioningCommand,
  GetObjectLockConfigurationCommand,
  GetPublicAccessBlockCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import {
  DescribeKeyCommand,
  GetKeyPolicyCommand,
  GetKeyRotationStatusCommand,
  KMSClient,
  ListGrantsCommand,
} from "@aws-sdk/client-kms";

const SAFE_ERROR = "OAuth vault infrastructure is not ready";
const ATTESTATION_TTL_MS = 5 * 60_000;
const MAX_GRANT_PAGES = 10;
const DEFAULT_REQUEST_TIMEOUT_MS = 15_000;
const SHA256 = /^[0-9a-f]{64}$/u;
const ACCOUNT_ID = /^\d{12}$/u;
const REGION = /^[a-z]{2}(?:-gov)?-[a-z]+-\d$/u;
const BUCKET = /^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/u;
const KMS_KEY_ARN = /^arn:(aws|aws-us-gov|aws-cn):kms:([a-z0-9-]+):(\d{12}):key\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/u;

const EXPECTED_PREFIXES = Object.freeze({
  pkce: "ai-media-studio/oauth-pkce/v1",
  authorizationCode: "ai-media-studio/oauth-code/v1",
  token: "ai-media-studio/oauth-token/v1",
} as const);

export type AwsVaultInfrastructureCheckCode =
  | "manifest_invalid"
  | "s3_request_failed"
  | "s3_location_invalid"
  | "s3_versioning_invalid"
  | "s3_public_access_invalid"
  | "s3_ownership_invalid"
  | "s3_policy_status_invalid"
  | "s3_encryption_invalid"
  | "s3_policy_invalid"
  | "s3_lifecycle_invalid"
  | "s3_object_lock_invalid"
  | "s3_replication_invalid"
  | "kms_request_failed"
  | "kms_key_invalid"
  | "kms_rotation_invalid"
  | "kms_policy_invalid"
  | "kms_grants_invalid"
  | "snapshot_mismatch"
  | "clock_invalid";

export class AwsVaultInfrastructureNotReadyError extends Error {
  readonly code = "AI_MEDIA_OAUTH_VAULT_INFRASTRUCTURE_NOT_READY";
  constructor(readonly checkCode: AwsVaultInfrastructureCheckCode) {
    super(SAFE_ERROR);
    this.name = "AwsVaultInfrastructureNotReadyError";
  }
}

export interface AwsVaultCommandClient {
  send(command: unknown, options?: { abortSignal?: AbortSignal }): Promise<any>;
}

export type AwsVaultResourceManifest = Readonly<{
  bucket: string;
  kmsKeyArn: string;
  prefix: string;
  bucketPolicySha256: string;
  kmsKeyPolicySha256: string;
  rotationPeriodDays: number;
}>;

export type AwsVaultInfrastructureManifest = Readonly<{
  region: string;
  expectedBucketOwner: string;
  pkce: AwsVaultResourceManifest;
  authorizationCode: AwsVaultResourceManifest;
  token: AwsVaultResourceManifest;
}>;

export type AwsVaultInfrastructureAttestation = Readonly<{
  ready: true;
  manifestDigest: string;
  factDigest: string;
  checkedAt: string;
  expiresAt: string;
  checks: readonly [
    "manifest_validated",
    "pkce_ready",
    "authorization_code_ready",
    "token_ready",
    "stable_double_snapshot",
  ];
}>;

export interface AwsVaultInfrastructurePreflightDependencies {
  s3Client?: AwsVaultCommandClient;
  kmsClient?: AwsVaultCommandClient;
  clock?: { now(): Date };
  requestTimeoutMs?: number;
}

type VaultRole = keyof typeof EXPECTED_PREFIXES;
type NormalizedManifest = AwsVaultInfrastructureManifest;
type SnapshotFacts = Readonly<Record<string, unknown>>;

/**
 * Explicit, read-only infrastructure gate. Construction is inert: no request,
 * timer, credential resolution, or background work is started until run().
 */
export class AwsVaultInfrastructurePreflight {
  private readonly manifest: NormalizedManifest;
  private readonly manifestDigest: string;
  private readonly s3: AwsVaultCommandClient;
  private readonly kms: AwsVaultCommandClient;
  private readonly clock: { now(): Date };

  constructor(manifest: AwsVaultInfrastructureManifest, dependencies: AwsVaultInfrastructurePreflightDependencies = {}) {
    this.manifest = normalizeManifest(manifest);
    this.manifestDigest = sha256(canonicalJson(this.manifest));
    const requestTimeoutMs = normalizeRequestTimeout(dependencies.requestTimeoutMs);
    const partition = partitionFor(this.manifest.pkce.kmsKeyArn);
    this.s3 = boundedPreflightClient(dependencies.s3Client ?? new S3Client({
      region: this.manifest.region,
      endpoint: officialS3Endpoint(partition, this.manifest.region),
    }), requestTimeoutMs);
    this.kms = boundedPreflightClient(dependencies.kmsClient ?? new KMSClient({
      region: this.manifest.region,
      endpoint: officialKmsEndpoint(partition, this.manifest.region),
    }), requestTimeoutMs);
    this.clock = dependencies.clock ?? { now: () => new Date() };
  }

  async run(): Promise<AwsVaultInfrastructureAttestation> {
    const firstNow = trustedNow(this.clock);
    const first = await this.snapshot(firstNow);
    const secondNow = trustedNow(this.clock);
    const second = await this.snapshot(secondNow);
    const firstDigest = sha256(canonicalJson(first));
    const secondDigest = sha256(canonicalJson(second));
    if (firstDigest !== secondDigest) throw notReady("snapshot_mismatch");

    const completedAt = trustedNow(this.clock);
    // A rotation date may cross from future to past during a slow two-pass audit.
    for (const date of rotationDates(second)) {
      if (Date.parse(date) <= completedAt.getTime()) throw notReady("kms_rotation_invalid");
    }
    const checkedAt = completedAt.toISOString();
    const checks = Object.freeze([
      "manifest_validated",
      "pkce_ready",
      "authorization_code_ready",
      "token_ready",
      "stable_double_snapshot",
    ] as const);
    return Object.freeze({
      ready: true as const,
      manifestDigest: this.manifestDigest,
      factDigest: secondDigest,
      checkedAt,
      expiresAt: new Date(completedAt.getTime() + ATTESTATION_TTL_MS).toISOString(),
      checks,
    });
  }

  private async snapshot(now: Date): Promise<SnapshotFacts> {
    const facts: Record<string, unknown> = {};
    for (const role of ["pkce", "authorizationCode", "token"] as const) {
      const resource = this.manifest[role];
      facts[role] = Object.freeze({
        s3: await this.checkBucket(role, resource),
        kms: await this.checkKey(resource, now),
      });
    }
    return Object.freeze(facts);
  }

  private async checkBucket(role: VaultRole, resource: AwsVaultResourceManifest): Promise<SnapshotFacts> {
    const base = { Bucket: resource.bucket, ExpectedBucketOwner: this.manifest.expectedBucketOwner };
    const location = await s3Request(this.s3, new GetBucketLocationCommand(base));
    if (normalizedBucketRegion(location?.LocationConstraint) !== this.manifest.region) throw notReady("s3_location_invalid");

    const versioning = await s3Request(this.s3, new GetBucketVersioningCommand(base));
    if (versioning?.Status !== undefined || versioning?.MFADelete !== undefined) throw notReady("s3_versioning_invalid");

    const publicAccess = await s3Request(this.s3, new GetPublicAccessBlockCommand(base));
    const block = publicAccess?.PublicAccessBlockConfiguration;
    if (!block || block.BlockPublicAcls !== true || block.IgnorePublicAcls !== true
      || block.BlockPublicPolicy !== true || block.RestrictPublicBuckets !== true) {
      throw notReady("s3_public_access_invalid");
    }

    const ownership = await s3Request(this.s3, new GetBucketOwnershipControlsCommand(base));
    if (!Array.isArray(ownership?.OwnershipControls?.Rules) || ownership.OwnershipControls.Rules.length !== 1
      || ownership.OwnershipControls.Rules[0]?.ObjectOwnership !== "BucketOwnerEnforced") {
      throw notReady("s3_ownership_invalid");
    }

    const policyStatus = await s3Request(this.s3, new GetBucketPolicyStatusCommand(base));
    if (policyStatus?.PolicyStatus?.IsPublic !== false) throw notReady("s3_policy_status_invalid");

    const encryption = await s3Request(this.s3, new GetBucketEncryptionCommand(base));
    const encryptionRules = encryption?.ServerSideEncryptionConfiguration?.Rules;
    const encryptionRule = Array.isArray(encryptionRules) && encryptionRules.length === 1 ? encryptionRules[0] : undefined;
    if (!encryptionRule || encryptionRule.BucketKeyEnabled !== true
      || encryptionRule.ApplyServerSideEncryptionByDefault?.SSEAlgorithm !== "aws:kms"
      || encryptionRule.ApplyServerSideEncryptionByDefault?.KMSMasterKeyID !== resource.kmsKeyArn) {
      throw notReady("s3_encryption_invalid");
    }

    const policy = await s3Request(this.s3, new GetBucketPolicyCommand(base));
    if (typeof policy?.Policy !== "string"
      || checkedPolicyDigest(policy.Policy, "s3_policy_invalid") !== resource.bucketPolicySha256) throw notReady("s3_policy_invalid");

    const lifecycle = await lifecycleRequest(this.s3, new GetBucketLifecycleConfigurationCommand(base));
    validateLifecycle(role, resource.prefix, lifecycle);

    const objectLock = await modeledAbsenceRequest(
      this.s3,
      new GetObjectLockConfigurationCommand(base),
      "ObjectLockConfigurationNotFoundError",
      "s3_object_lock_invalid",
    );
    if (objectLock !== undefined) throw notReady("s3_object_lock_invalid");

    const replication = await modeledAbsenceRequest(
      this.s3,
      new GetBucketReplicationCommand(base),
      "ReplicationConfigurationNotFoundError",
      "s3_replication_invalid",
    );
    if (replication !== undefined) throw notReady("s3_replication_invalid");

    return Object.freeze({
      region: this.manifest.region,
      neverVersioned: true,
      publicAccessBlocked: true,
      ownerEnforced: true,
      policyPrivate: true,
      encryption: "aws:kms",
      bucketKeyEnabled: true,
      bucketPolicyDigest: resource.bucketPolicySha256,
      lifecycle: role === "token" ? "absent" : "exact_prefix_1_day",
      objectLock: "disabled",
      replication: "absent",
    });
  }

  private async checkKey(resource: AwsVaultResourceManifest, now: Date): Promise<SnapshotFacts> {
    const described = await kmsRequest(this.kms, new DescribeKeyCommand({ KeyId: resource.kmsKeyArn }));
    const metadata = described?.KeyMetadata;
    if (!metadata || metadata.Arn !== resource.kmsKeyArn || metadata.AWSAccountId !== this.manifest.expectedBucketOwner
      || metadata.Enabled !== true || metadata.KeyState !== "Enabled" || metadata.KeyManager !== "CUSTOMER"
      || metadata.KeySpec !== "SYMMETRIC_DEFAULT" || metadata.KeyUsage !== "ENCRYPT_DECRYPT"
      || metadata.Origin !== "AWS_KMS" || metadata.MultiRegion !== false || metadata.DeletionDate !== undefined
      || metadata.PendingDeletionWindowInDays !== undefined) throw notReady("kms_key_invalid");

    const rotation = await kmsRequest(this.kms, new GetKeyRotationStatusCommand({ KeyId: resource.kmsKeyArn }));
    const nextRotation = rotation?.NextRotationDate;
    if (rotation?.KeyRotationEnabled !== true || rotation?.RotationPeriodInDays !== resource.rotationPeriodDays
      || !(nextRotation instanceof Date) || !Number.isFinite(nextRotation.getTime()) || nextRotation.getTime() <= now.getTime()) {
      throw notReady("kms_rotation_invalid");
    }

    const policy = await kmsRequest(this.kms, new GetKeyPolicyCommand({ KeyId: resource.kmsKeyArn, PolicyName: "default" }));
    if (typeof policy?.Policy !== "string"
      || checkedPolicyDigest(policy.Policy, "kms_policy_invalid") !== resource.kmsKeyPolicySha256) throw notReady("kms_policy_invalid");

    let marker: string | undefined;
    const seen = new Set<string>();
    let pages = 0;
    do {
      if (++pages > MAX_GRANT_PAGES) throw notReady("kms_grants_invalid");
      const grants = await kmsRequest(this.kms, new ListGrantsCommand({
        KeyId: resource.kmsKeyArn,
        Limit: 100,
        ...(marker === undefined ? {} : { Marker: marker }),
      }));
      if (!Array.isArray(grants?.Grants) || grants.Grants.length !== 0) throw notReady("kms_grants_invalid");
      if (grants?.Truncated === true) {
        const next = grants.NextMarker;
        if (typeof next !== "string" || !next || seen.has(next)) throw notReady("kms_grants_invalid");
        seen.add(next);
        marker = next;
      } else {
        if (grants?.NextMarker !== undefined) throw notReady("kms_grants_invalid");
        marker = undefined;
      }
    } while (marker !== undefined);

    return Object.freeze({
      keyState: "enabled",
      keyManager: "customer",
      keySpec: "symmetric_default",
      keyUsage: "encrypt_decrypt",
      origin: "aws_kms",
      multiRegion: false,
      rotationPeriodDays: resource.rotationPeriodDays,
      nextRotationDate: nextRotation.toISOString(),
      keyPolicyDigest: resource.kmsKeyPolicySha256,
      grants: 0,
      grantPages: pages,
    });
  }
}

export function createAwsVaultInfrastructurePreflight(
  manifest: AwsVaultInfrastructureManifest,
  dependencies: AwsVaultInfrastructurePreflightDependencies = {},
): AwsVaultInfrastructurePreflight {
  return new AwsVaultInfrastructurePreflight(manifest, dependencies);
}

export function canonicalAwsPolicySha256(policy: string | unknown): string {
  let parsed: unknown = policy;
  if (typeof policy === "string") {
    try { parsed = JSON.parse(policy); } catch { throw notReady("manifest_invalid"); }
  }
  return sha256(canonicalJson(parsed));
}

function checkedPolicyDigest(policy: string, checkCode: "s3_policy_invalid" | "kms_policy_invalid"): string {
  try { return canonicalAwsPolicySha256(policy); } catch { throw notReady(checkCode); }
}

function normalizeManifest(input: AwsVaultInfrastructureManifest): NormalizedManifest {
  try {
    if (!isRecord(input) || exactKeys(input, ["authorizationCode", "expectedBucketOwner", "pkce", "region", "token"]) === false
      || !REGION.test(input.region) || !ACCOUNT_ID.test(input.expectedBucketOwner)) throw notReady("manifest_invalid");
    const resources = {} as Record<VaultRole, AwsVaultResourceManifest>;
    for (const role of ["pkce", "authorizationCode", "token"] as const) {
      const resource = input[role];
      if (!isRecord(resource) || !exactKeys(resource, ["bucket", "bucketPolicySha256", "kmsKeyArn", "kmsKeyPolicySha256", "prefix", "rotationPeriodDays"])
        || typeof resource.bucket !== "string" || !validBucket(resource.bucket)
        || resource.prefix !== EXPECTED_PREFIXES[role]
        || typeof resource.kmsKeyArn !== "string" || !validKmsArn(resource.kmsKeyArn, input.region, input.expectedBucketOwner)
        || typeof resource.bucketPolicySha256 !== "string" || !SHA256.test(resource.bucketPolicySha256)
        || typeof resource.kmsKeyPolicySha256 !== "string" || !SHA256.test(resource.kmsKeyPolicySha256)
        || !Number.isSafeInteger(resource.rotationPeriodDays) || resource.rotationPeriodDays < 90 || resource.rotationPeriodDays > 365) {
        throw notReady("manifest_invalid");
      }
      resources[role] = Object.freeze({
        bucket: resource.bucket,
        kmsKeyArn: resource.kmsKeyArn,
        prefix: resource.prefix,
        bucketPolicySha256: resource.bucketPolicySha256,
        kmsKeyPolicySha256: resource.kmsKeyPolicySha256,
        rotationPeriodDays: resource.rotationPeriodDays,
      });
    }
    if (new Set(Object.values(resources).map((resource) => resource.bucket)).size !== 3
      || new Set(Object.values(resources).map((resource) => resource.kmsKeyArn)).size !== 3) throw notReady("manifest_invalid");
    const partitions = new Set(Object.values(resources).map((resource) => partitionFor(resource.kmsKeyArn)));
    if (partitions.size !== 1) throw notReady("manifest_invalid");
    return Object.freeze({
      region: input.region,
      expectedBucketOwner: input.expectedBucketOwner,
      pkce: resources.pkce,
      authorizationCode: resources.authorizationCode,
      token: resources.token,
    });
  } catch (error) {
    if (error instanceof AwsVaultInfrastructureNotReadyError) throw error;
    throw notReady("manifest_invalid");
  }
}

function validateLifecycle(role: VaultRole, prefix: string, result: any | undefined): void {
  const rules = result?.Rules;
  if (role === "token") {
    if (result === undefined || (Array.isArray(rules) && rules.length === 0)) return;
    throw notReady("s3_lifecycle_invalid");
  }
  if (!Array.isArray(rules) || rules.length !== 1) throw notReady("s3_lifecycle_invalid");
  const rule = rules[0];
  const filter = rule?.Filter;
  const expiration = rule?.Expiration;
  if (rule?.Status !== "Enabled" || rule?.Prefix !== undefined
    || !isRecord(filter) || !exactKeys(filter, ["Prefix"]) || filter.Prefix !== `${prefix}/`
    || !isRecord(expiration) || !exactKeys(expiration, ["Days"]) || expiration.Days !== 1
    || rule.Transitions !== undefined || rule.NoncurrentVersionTransitions !== undefined
    || rule.NoncurrentVersionExpiration !== undefined) throw notReady("s3_lifecycle_invalid");
}

async function lifecycleRequest(client: AwsVaultCommandClient, command: unknown): Promise<any | undefined> {
  try { return await client.send(command); }
  catch (error) {
    if (modeledErrorName(error) === "NoSuchLifecycleConfiguration") return undefined;
    throw notReady("s3_request_failed");
  }
}

async function modeledAbsenceRequest(
  client: AwsVaultCommandClient,
  command: unknown,
  absenceName: string,
  invalidCode: AwsVaultInfrastructureCheckCode,
): Promise<any | undefined> {
  try { return await client.send(command); }
  catch (error) {
    if (modeledErrorName(error) === absenceName) return undefined;
    // A status-only 404 is deliberately not accepted as proof of absence.
    throw notReady(invalidCode);
  }
}

async function s3Request(client: AwsVaultCommandClient, command: unknown): Promise<any> {
  try { return await client.send(command); } catch { throw notReady("s3_request_failed"); }
}

async function kmsRequest(client: AwsVaultCommandClient, command: unknown): Promise<any> {
  try { return await client.send(command); } catch { throw notReady("kms_request_failed"); }
}

function modeledErrorName(error: unknown): string | undefined {
  return isRecord(error) && typeof error.name === "string" ? error.name : undefined;
}

function rotationDates(facts: SnapshotFacts): string[] {
  const dates: string[] = [];
  for (const role of ["pkce", "authorizationCode", "token"] as const) {
    const roleFacts = facts[role];
    if (!isRecord(roleFacts) || !isRecord(roleFacts.kms) || typeof roleFacts.kms.nextRotationDate !== "string") {
      throw notReady("kms_rotation_invalid");
    }
    dates.push(roleFacts.kms.nextRotationDate);
  }
  return dates;
}

function normalizedBucketRegion(value: unknown): string | undefined {
  if (value === undefined || value === null || value === "") return "us-east-1";
  if (value === "EU") return "eu-west-1";
  return typeof value === "string" ? value : undefined;
}

function validBucket(value: string): boolean {
  return BUCKET.test(value) && !value.includes("..") && !/^\d+(?:\.\d+){3}$/u.test(value);
}

function validKmsArn(value: string, region: string, account: string): boolean {
  const match = KMS_KEY_ARN.exec(value);
  if (!match || match[2] !== region || match[3] !== account) return false;
  const partition = match[1];
  return (partition === "aws-cn") === region.startsWith("cn-")
    && (partition === "aws-us-gov") === region.startsWith("us-gov-")
    && (partition !== "aws" || (!region.startsWith("cn-") && !region.startsWith("us-gov-")));
}

function partitionFor(arn: string): "aws" | "aws-us-gov" | "aws-cn" {
  const match = KMS_KEY_ARN.exec(arn);
  if (!match) throw notReady("manifest_invalid");
  return match[1] as "aws" | "aws-us-gov" | "aws-cn";
}

function officialS3Endpoint(partition: "aws" | "aws-us-gov" | "aws-cn", region: string): string {
  return `https://s3.${region}.${partition === "aws-cn" ? "amazonaws.com.cn" : "amazonaws.com"}`;
}

function officialKmsEndpoint(partition: "aws" | "aws-us-gov" | "aws-cn", region: string): string {
  return `https://kms.${region}.${partition === "aws-cn" ? "amazonaws.com.cn" : "amazonaws.com"}`;
}

function trustedNow(clock: { now(): Date }): Date {
  let value: Date;
  try { value = clock.now(); } catch { throw notReady("clock_invalid"); }
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) throw notReady("clock_invalid");
  return new Date(value.getTime());
}

function normalizeRequestTimeout(value: number | undefined): number {
  const timeout = value ?? DEFAULT_REQUEST_TIMEOUT_MS;
  if (!Number.isSafeInteger(timeout) || timeout < 1 || timeout > DEFAULT_REQUEST_TIMEOUT_MS) {
    throw notReady("manifest_invalid");
  }
  return timeout;
}

function boundedPreflightClient(client: AwsVaultCommandClient, timeoutMs: number): AwsVaultCommandClient {
  const wrapped = {
    async send(command: unknown): Promise<any> {
      const controller = new AbortController();
      let timer: ReturnType<typeof setTimeout> | undefined;
      const timeout = new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(new Error("preflight request timed out"));
        }, timeoutMs);
        timer.unref?.();
      });
      try {
        return await Promise.race([client.send(command, { abortSignal: controller.signal }), timeout]);
      } finally {
        if (timer) clearTimeout(timer);
      }
    },
  };
  return Object.assign(wrapped, (client as { config?: unknown }).config === undefined
    ? {} : { config: (client as { config?: unknown }).config });
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function canonicalJson(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw notReady("manifest_invalid");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (isRecord(value)) {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  throw notReady("manifest_invalid");
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  return Object.keys(value).sort().join("\u0000") === [...expected].sort().join("\u0000");
}

function isRecord(value: unknown): value is Record<string, any> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function notReady(checkCode: AwsVaultInfrastructureCheckCode): AwsVaultInfrastructureNotReadyError {
  return new AwsVaultInfrastructureNotReadyError(checkCode);
}
