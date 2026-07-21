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

const PREFIX = "ai-media-studio/oauth-role-token/v2";
const SAFE_ERROR = "OAuth role token vault infrastructure is not ready";
const SHA256 = /^[0-9a-f]{64}$/u;
const ACCOUNT = /^\d{12}$/u;
const REGION = /^[a-z]{2}(?:-gov)?-[a-z]+-\d$/u;
const BUCKET = /^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/u;
const KMS_ARN = /^arn:(aws|aws-us-gov|aws-cn):kms:([a-z0-9-]+):(\d{12}):key\/([0-9a-f-]{36})$/u;
const DEFAULT_TIMEOUT_MS = 15_000;
const MAX_GRANT_PAGES = 10;
const ATTESTATION_TTL_MS = 5 * 60_000;

export type AwsRoleTokenVaultPreflightV2CheckCode =
  | "manifest_invalid" | "clock_invalid" | "snapshot_mismatch"
  | "s3_request_failed" | "s3_location_invalid" | "s3_versioning_invalid"
  | "s3_public_access_invalid" | "s3_ownership_invalid" | "s3_policy_status_invalid"
  | "s3_encryption_invalid" | "s3_policy_invalid" | "s3_lifecycle_invalid"
  | "s3_object_lock_invalid" | "s3_replication_invalid"
  | "kms_request_failed" | "kms_key_invalid" | "kms_rotation_invalid" | "kms_policy_invalid" | "kms_grants_invalid";

export class AwsRoleTokenVaultPreflightV2NotReadyError extends Error {
  readonly code = "AI_MEDIA_OAUTH_ROLE_TOKEN_VAULT_PREFLIGHT_V2_NOT_READY";
  constructor(readonly checkCode: AwsRoleTokenVaultPreflightV2CheckCode) {
    super(SAFE_ERROR);
    this.name = "AwsRoleTokenVaultPreflightV2NotReadyError";
  }
}

export interface AwsRoleTokenVaultCommandClient {
  send(command: unknown, options?: { abortSignal?: AbortSignal }): Promise<any>;
}

export type AwsRoleTokenVaultInfrastructureManifestV2 = Readonly<{
  region: string;
  expectedBucketOwner: string;
  bucket: string;
  prefix: typeof PREFIX;
  kmsKeyArn: string;
  bucketPolicySha256: string;
  kmsKeyPolicySha256: string;
  rotationPeriodDays: number;
}>;

export type AwsRoleTokenVaultInfrastructureAttestationV2 = Readonly<{
  ready: true;
  manifestDigest: string;
  factDigest: string;
  checkedAt: string;
  expiresAt: string;
  checks: readonly ["manifest_validated", "role_token_v2_ready", "stable_double_snapshot"];
}>;

export class AwsRoleTokenVaultInfrastructurePreflightV2 {
  private readonly manifest: AwsRoleTokenVaultInfrastructureManifestV2;
  private readonly manifestDigest: string;
  private readonly s3: AwsRoleTokenVaultCommandClient;
  private readonly kms: AwsRoleTokenVaultCommandClient;
  private readonly clock: { now(): Date };

  constructor(manifest: AwsRoleTokenVaultInfrastructureManifestV2, dependencies: {
    s3Client?: AwsRoleTokenVaultCommandClient;
    kmsClient?: AwsRoleTokenVaultCommandClient;
    clock?: { now(): Date };
    requestTimeoutMs?: number;
  } = {}) {
    this.manifest = normalizeManifest(manifest);
    this.manifestDigest = digest(canonicalJson(this.manifest));
    const timeoutMs = normalizeTimeout(dependencies.requestTimeoutMs);
    const partition = partitionFor(this.manifest.kmsKeyArn);
    this.s3 = bounded(dependencies.s3Client ?? new S3Client({
      region: this.manifest.region,
      endpoint: `https://s3.${this.manifest.region}.${partition === "aws-cn" ? "amazonaws.com.cn" : "amazonaws.com"}`,
    }), timeoutMs);
    this.kms = bounded(dependencies.kmsClient ?? new KMSClient({
      region: this.manifest.region,
      endpoint: `https://kms.${this.manifest.region}.${partition === "aws-cn" ? "amazonaws.com.cn" : "amazonaws.com"}`,
    }), timeoutMs);
    this.clock = dependencies.clock ?? { now: () => new Date() };
  }

  async run(): Promise<AwsRoleTokenVaultInfrastructureAttestationV2> {
    const first = await this.snapshot(trustedNow(this.clock));
    const second = await this.snapshot(trustedNow(this.clock));
    const firstDigest = digest(canonicalJson(first));
    const secondDigest = digest(canonicalJson(second));
    if (firstDigest !== secondDigest) throw notReady("snapshot_mismatch");
    const completedAt = trustedNow(this.clock);
    if (Date.parse(second.kms.nextRotationDate) <= completedAt.getTime()) throw notReady("kms_rotation_invalid");
    return Object.freeze({
      ready: true,
      manifestDigest: this.manifestDigest,
      factDigest: secondDigest,
      checkedAt: completedAt.toISOString(),
      expiresAt: new Date(completedAt.getTime() + ATTESTATION_TTL_MS).toISOString(),
      checks: Object.freeze(["manifest_validated", "role_token_v2_ready", "stable_double_snapshot"] as const),
    });
  }

  private async snapshot(now: Date): Promise<Readonly<{ s3: Record<string, unknown>; kms: { nextRotationDate: string } & Record<string, unknown> }>> {
    const base = { Bucket: this.manifest.bucket, ExpectedBucketOwner: this.manifest.expectedBucketOwner };
    const location = await s3Request(this.s3, new GetBucketLocationCommand(base));
    if (bucketRegion(location?.LocationConstraint) !== this.manifest.region) throw notReady("s3_location_invalid");
    const versioning = await s3Request(this.s3, new GetBucketVersioningCommand(base));
    if (versioning?.Status !== undefined || versioning?.MFADelete !== undefined) throw notReady("s3_versioning_invalid");
    const publicAccess = await s3Request(this.s3, new GetPublicAccessBlockCommand(base));
    const block = publicAccess?.PublicAccessBlockConfiguration;
    if (!block || block.BlockPublicAcls !== true || block.IgnorePublicAcls !== true
      || block.BlockPublicPolicy !== true || block.RestrictPublicBuckets !== true) throw notReady("s3_public_access_invalid");
    const ownership = await s3Request(this.s3, new GetBucketOwnershipControlsCommand(base));
    if (!Array.isArray(ownership?.OwnershipControls?.Rules) || ownership.OwnershipControls.Rules.length !== 1
      || ownership.OwnershipControls.Rules[0]?.ObjectOwnership !== "BucketOwnerEnforced") throw notReady("s3_ownership_invalid");
    const policyStatus = await s3Request(this.s3, new GetBucketPolicyStatusCommand(base));
    if (policyStatus?.PolicyStatus?.IsPublic !== false) throw notReady("s3_policy_status_invalid");
    const encryption = await s3Request(this.s3, new GetBucketEncryptionCommand(base));
    const rules = encryption?.ServerSideEncryptionConfiguration?.Rules;
    const encryptionRule = Array.isArray(rules) && rules.length === 1 ? rules[0] : undefined;
    if (!encryptionRule || encryptionRule.BucketKeyEnabled !== true
      || encryptionRule.ApplyServerSideEncryptionByDefault?.SSEAlgorithm !== "aws:kms"
      || encryptionRule.ApplyServerSideEncryptionByDefault?.KMSMasterKeyID !== this.manifest.kmsKeyArn) {
      throw notReady("s3_encryption_invalid");
    }
    const policy = await s3Request(this.s3, new GetBucketPolicyCommand(base));
    if (typeof policy?.Policy !== "string"
      || checkedPolicyDigest(policy.Policy, "s3_policy_invalid") !== this.manifest.bucketPolicySha256) {
      throw notReady("s3_policy_invalid");
    }
    await requireModeledAbsence(this.s3, new GetBucketLifecycleConfigurationCommand(base),
      "NoSuchLifecycleConfiguration", "s3_lifecycle_invalid");
    const objectLock = await absentRequest(this.s3, new GetObjectLockConfigurationCommand(base),
      "ObjectLockConfigurationNotFoundError", "s3_object_lock_invalid");
    if (objectLock !== undefined) throw notReady("s3_object_lock_invalid");
    const replication = await absentRequest(this.s3, new GetBucketReplicationCommand(base),
      "ReplicationConfigurationNotFoundError", "s3_replication_invalid");
    if (replication !== undefined) throw notReady("s3_replication_invalid");

    const described = await kmsRequest(this.kms, new DescribeKeyCommand({ KeyId: this.manifest.kmsKeyArn }));
    const metadata = described?.KeyMetadata;
    if (!metadata || metadata.Arn !== this.manifest.kmsKeyArn || metadata.AWSAccountId !== this.manifest.expectedBucketOwner
      || metadata.Enabled !== true || metadata.KeyState !== "Enabled" || metadata.KeyManager !== "CUSTOMER"
      || metadata.KeySpec !== "SYMMETRIC_DEFAULT" || metadata.KeyUsage !== "ENCRYPT_DECRYPT"
      || metadata.Origin !== "AWS_KMS" || metadata.MultiRegion !== false || metadata.DeletionDate !== undefined
      || metadata.PendingDeletionWindowInDays !== undefined) throw notReady("kms_key_invalid");
    const rotation = await kmsRequest(this.kms, new GetKeyRotationStatusCommand({ KeyId: this.manifest.kmsKeyArn }));
    if (rotation?.KeyRotationEnabled !== true || rotation?.RotationPeriodInDays !== this.manifest.rotationPeriodDays
      || !(rotation.NextRotationDate instanceof Date) || !Number.isFinite(rotation.NextRotationDate.getTime())
      || rotation.NextRotationDate.getTime() <= now.getTime()) throw notReady("kms_rotation_invalid");
    const keyPolicy = await kmsRequest(this.kms, new GetKeyPolicyCommand({ KeyId: this.manifest.kmsKeyArn, PolicyName: "default" }));
    if (typeof keyPolicy?.Policy !== "string"
      || checkedPolicyDigest(keyPolicy.Policy, "kms_policy_invalid") !== this.manifest.kmsKeyPolicySha256) {
      throw notReady("kms_policy_invalid");
    }
    let marker: string | undefined; let pages = 0; const seen = new Set<string>();
    do {
      if (++pages > MAX_GRANT_PAGES) throw notReady("kms_grants_invalid");
      const grants = await kmsRequest(this.kms, new ListGrantsCommand({
        KeyId: this.manifest.kmsKeyArn, Limit: 100, ...(marker ? { Marker: marker } : {}),
      }));
      if (!Array.isArray(grants?.Grants) || grants.Grants.length !== 0) throw notReady("kms_grants_invalid");
      if (grants.Truncated === true) {
        if (typeof grants.NextMarker !== "string" || !grants.NextMarker || seen.has(grants.NextMarker)) {
          throw notReady("kms_grants_invalid");
        }
        seen.add(grants.NextMarker); marker = grants.NextMarker;
      } else {
        if (grants.NextMarker !== undefined) throw notReady("kms_grants_invalid");
        marker = undefined;
      }
    } while (marker !== undefined);

    return Object.freeze({
      s3: Object.freeze({
        region: this.manifest.region, owner: this.manifest.expectedBucketOwner, prefix: this.manifest.prefix,
        neverVersioned: true, publicAccessBlocked: true, ownerEnforced: true, policyPrivate: true,
        encryption: "aws:kms", bucketKeyEnabled: true, bucketPolicyDigest: this.manifest.bucketPolicySha256,
        lifecycle: "absent", objectLock: "disabled", replication: "absent",
      }),
      kms: Object.freeze({
        keyState: "enabled", keyManager: "customer", keySpec: "symmetric_default", keyUsage: "encrypt_decrypt",
        origin: "aws_kms", multiRegion: false, rotationPeriodDays: this.manifest.rotationPeriodDays,
        nextRotationDate: rotation.NextRotationDate.toISOString(), keyPolicyDigest: this.manifest.kmsKeyPolicySha256,
        grants: 0, grantPages: pages,
      }),
    });
  }
}

export function createAwsRoleTokenVaultInfrastructurePreflightV2(
  manifest: AwsRoleTokenVaultInfrastructureManifestV2,
  dependencies: ConstructorParameters<typeof AwsRoleTokenVaultInfrastructurePreflightV2>[1] = {},
): AwsRoleTokenVaultInfrastructurePreflightV2 {
  return new AwsRoleTokenVaultInfrastructurePreflightV2(manifest, dependencies);
}

export function canonicalAwsRoleTokenPolicySha256V2(policy: string | unknown): string {
  let parsed = policy;
  if (typeof policy === "string") {
    try { parsed = JSON.parse(policy); } catch { throw notReady("manifest_invalid"); }
  }
  return digest(canonicalJson(parsed));
}

function normalizeManifest(input: AwsRoleTokenVaultInfrastructureManifestV2): AwsRoleTokenVaultInfrastructureManifestV2 {
  if (!isRecord(input) || Object.keys(input).sort().join("|") !== [
    "bucket", "bucketPolicySha256", "expectedBucketOwner", "kmsKeyArn", "kmsKeyPolicySha256", "prefix", "region", "rotationPeriodDays",
  ].sort().join("|") || !REGION.test(input.region) || !ACCOUNT.test(input.expectedBucketOwner)
    || typeof input.bucket !== "string" || !BUCKET.test(input.bucket) || input.bucket.includes("..")
    || /^\d+(?:\.\d+){3}$/u.test(input.bucket) || input.prefix !== PREFIX
    || !validKmsArn(input.kmsKeyArn, input.region, input.expectedBucketOwner)
    || !SHA256.test(input.bucketPolicySha256) || !SHA256.test(input.kmsKeyPolicySha256)
    || !Number.isSafeInteger(input.rotationPeriodDays) || input.rotationPeriodDays < 90 || input.rotationPeriodDays > 365) {
    throw notReady("manifest_invalid");
  }
  return Object.freeze({ ...input });
}

function validKmsArn(arn: string, region: string, account: string): boolean {
  const match = KMS_ARN.exec(arn);
  if (!match || match[2] !== region || match[3] !== account) return false;
  return (match[1] === "aws-cn") === region.startsWith("cn-")
    && (match[1] === "aws-us-gov") === region.startsWith("us-gov-")
    && (match[1] !== "aws" || (!region.startsWith("cn-") && !region.startsWith("us-gov-")));
}
function partitionFor(arn: string): string { const match = KMS_ARN.exec(arn); if (!match) throw notReady("manifest_invalid"); return match[1]; }
function bucketRegion(value: unknown): string | undefined { return value == null || value === "" ? "us-east-1" : value === "EU" ? "eu-west-1" : typeof value === "string" ? value : undefined; }
function normalizeTimeout(value?: number): number { const result = value ?? DEFAULT_TIMEOUT_MS; if (!Number.isSafeInteger(result) || result < 1 || result > DEFAULT_TIMEOUT_MS) throw notReady("manifest_invalid"); return result; }
function trustedNow(clock: { now(): Date }): Date { let value: Date; try { value = clock.now(); } catch { throw notReady("clock_invalid"); } if (!(value instanceof Date) || !Number.isFinite(value.getTime())) throw notReady("clock_invalid"); return new Date(value.getTime()); }
function digest(value: string): string { return createHash("sha256").update(value, "utf8").digest("hex"); }
function checkedPolicyDigest(policy: string, code: "s3_policy_invalid" | "kms_policy_invalid"): string { try { return canonicalAwsRoleTokenPolicySha256V2(policy); } catch { throw notReady(code); } }
function isRecord(value: unknown): value is Record<string, any> { return Boolean(value) && typeof value === "object" && !Array.isArray(value); }
function canonicalJson(value: unknown): string {
  if (value === null || typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number" && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (isRecord(value)) return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  throw notReady("manifest_invalid");
}
async function s3Request(client: AwsRoleTokenVaultCommandClient, command: unknown): Promise<any> { try { return await client.send(command); } catch { throw notReady("s3_request_failed"); } }
async function kmsRequest(client: AwsRoleTokenVaultCommandClient, command: unknown): Promise<any> { try { return await client.send(command); } catch { throw notReady("kms_request_failed"); } }
async function absentRequest(client: AwsRoleTokenVaultCommandClient, command: unknown, absence: string, code: AwsRoleTokenVaultPreflightV2CheckCode): Promise<any> {
  try { return await client.send(command); } catch (error) { if (isRecord(error) && error.name === absence) return undefined; throw notReady(code); }
}
async function requireModeledAbsence(client: AwsRoleTokenVaultCommandClient, command: unknown, absence: string, code: AwsRoleTokenVaultPreflightV2CheckCode): Promise<void> {
  try { await client.send(command); } catch (error) { if (isRecord(error) && error.name === absence) return; throw notReady(code); }
  throw notReady(code);
}
function bounded(client: AwsRoleTokenVaultCommandClient, timeoutMs: number): AwsRoleTokenVaultCommandClient {
  return { async send(command: unknown): Promise<any> {
    const controller = new AbortController(); let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => { controller.abort(); reject(new Error("preflight timed out")); }, timeoutMs); timer.unref?.();
    });
    try { return await Promise.race([client.send(command, { abortSignal: controller.signal }), timeout]); }
    finally { if (timer) clearTimeout(timer); }
  } };
}
function notReady(code: AwsRoleTokenVaultPreflightV2CheckCode): AwsRoleTokenVaultPreflightV2NotReadyError { return new AwsRoleTokenVaultPreflightV2NotReadyError(code); }
