import assert from "node:assert/strict";
import test from "node:test";
import {
  AwsRoleTokenVaultPreflightV2NotReadyError,
  canonicalAwsRoleTokenPolicySha256V2,
  createAwsRoleTokenVaultInfrastructurePreflightV2,
  type AwsRoleTokenVaultCommandClient,
  type AwsRoleTokenVaultInfrastructureManifestV2,
} from "../server/ai-media-studio/oauth/aws-vault-infrastructure-preflight-v2";

const NOW = new Date("2026-07-21T12:00:00.000Z");
const KEY = "arn:aws:kms:us-east-1:123456789012:key/11111111-1111-4111-8111-111111111111";
const BUCKET_POLICY = JSON.stringify({ Version: "2012-10-17", Statement: [{ Effect: "Deny", Principal: "*", Action: "s3:*", Resource: "*", Condition: { Bool: { "aws:SecureTransport": "false" } } }] });
const KEY_POLICY = JSON.stringify({ Version: "2012-10-17", Statement: [{ Effect: "Allow", Principal: { AWS: "arn:aws:iam::123456789012:root" }, Action: "kms:*", Resource: "*" }] });

function manifest(): AwsRoleTokenVaultInfrastructureManifestV2 {
  return {
    region: "us-east-1", expectedBucketOwner: "123456789012", bucket: "role-token-vault-private",
    prefix: "ai-media-studio/oauth-role-token/v2", kmsKeyArn: KEY,
    bucketPolicySha256: canonicalAwsRoleTokenPolicySha256V2(BUCKET_POLICY),
    kmsKeyPolicySha256: canonicalAwsRoleTokenPolicySha256V2(KEY_POLICY), rotationPeriodDays: 90,
  };
}

function clients(overrides: Record<string, unknown> = {}): { s3Client: AwsRoleTokenVaultCommandClient; kmsClient: AwsRoleTokenVaultCommandClient; calls: string[] } {
  const calls: string[] = [];
  const response = (name: string): unknown => ({
    GetBucketLocationCommand: { LocationConstraint: undefined },
    GetBucketVersioningCommand: {},
    GetPublicAccessBlockCommand: { PublicAccessBlockConfiguration: { BlockPublicAcls: true, IgnorePublicAcls: true, BlockPublicPolicy: true, RestrictPublicBuckets: true } },
    GetBucketOwnershipControlsCommand: { OwnershipControls: { Rules: [{ ObjectOwnership: "BucketOwnerEnforced" }] } },
    GetBucketPolicyStatusCommand: { PolicyStatus: { IsPublic: false } },
    GetBucketEncryptionCommand: { ServerSideEncryptionConfiguration: { Rules: [{ BucketKeyEnabled: true, ApplyServerSideEncryptionByDefault: { SSEAlgorithm: "aws:kms", KMSMasterKeyID: KEY } }] } },
    GetBucketPolicyCommand: { Policy: BUCKET_POLICY },
    DescribeKeyCommand: { KeyMetadata: { Arn: KEY, AWSAccountId: "123456789012", Enabled: true, KeyState: "Enabled", KeyManager: "CUSTOMER", KeySpec: "SYMMETRIC_DEFAULT", KeyUsage: "ENCRYPT_DECRYPT", Origin: "AWS_KMS", MultiRegion: false } },
    GetKeyRotationStatusCommand: { KeyRotationEnabled: true, RotationPeriodInDays: 90, NextRotationDate: new Date("2026-08-21T12:00:00.000Z") },
    GetKeyPolicyCommand: { Policy: KEY_POLICY }, ListGrantsCommand: { Grants: [], Truncated: false },
    ...overrides,
  })[name];
  const send = async (command: unknown): Promise<any> => {
    const name = (command as { constructor: { name: string } }).constructor.name; calls.push(name);
    if (name === "GetBucketLifecycleConfigurationCommand") throw Object.assign(new Error(), { name: "NoSuchLifecycleConfiguration" });
    if (name === "GetObjectLockConfigurationCommand") throw Object.assign(new Error(), { name: "ObjectLockConfigurationNotFoundError" });
    if (name === "GetBucketReplicationCommand") throw Object.assign(new Error(), { name: "ReplicationConfigurationNotFoundError" });
    return response(name);
  };
  return { s3Client: { send }, kmsClient: { send }, calls };
}

test("preflight v2 performs a stable read-only double snapshot of the exact role-token prefix controls", async () => {
  const fake = clients(); let clockCalls = 0;
  const result = await createAwsRoleTokenVaultInfrastructurePreflightV2(manifest(), {
    s3Client: fake.s3Client, kmsClient: fake.kmsClient, clock: { now: () => { clockCalls += 1; return NOW; } },
  }).run();
  assert.equal(result.ready, true);
  assert.deepEqual(result.checks, ["manifest_validated", "role_token_v2_ready", "stable_double_snapshot"]);
  assert.equal(clockCalls, 3);
  for (const command of ["GetBucketLocationCommand", "GetBucketVersioningCommand", "GetBucketEncryptionCommand",
    "GetBucketPolicyCommand", "GetBucketLifecycleConfigurationCommand", "GetObjectLockConfigurationCommand", "GetBucketReplicationCommand",
    "DescribeKeyCommand", "GetKeyRotationStatusCommand", "GetKeyPolicyCommand", "ListGrantsCommand"]) {
    assert.equal(fake.calls.filter((name) => name === command).length, 2, command);
  }
  assert.equal(fake.calls.some((name) => /Put|Create|Delete/u.test(name)), false);
});

test("preflight v2 rejects versioned buckets, public policy, wrong SSE-KMS, grants, and ambiguous absence", async () => {
  for (const [command, value, expected] of [
    ["GetBucketVersioningCommand", { Status: "Suspended" }, "s3_versioning_invalid"],
    ["GetBucketPolicyStatusCommand", { PolicyStatus: { IsPublic: true } }, "s3_policy_status_invalid"],
    ["GetBucketEncryptionCommand", { ServerSideEncryptionConfiguration: { Rules: [{ BucketKeyEnabled: true, ApplyServerSideEncryptionByDefault: { SSEAlgorithm: "AES256" } }] } }, "s3_encryption_invalid"],
    ["ListGrantsCommand", { Grants: [{ GrantId: "unexpected" }], Truncated: false }, "kms_grants_invalid"],
  ] as const) {
    const fake = clients({ [command]: value });
    await assert.rejects(createAwsRoleTokenVaultInfrastructurePreflightV2(manifest(), {
      s3Client: fake.s3Client, kmsClient: fake.kmsClient, clock: { now: () => NOW },
    }).run(), (error) => error instanceof AwsRoleTokenVaultPreflightV2NotReadyError && error.checkCode === expected);
  }
  const fake = clients();
  fake.s3Client.send = async (command: unknown) => {
    if ((command as { constructor: { name: string } }).constructor.name === "GetObjectLockConfigurationCommand") {
      throw Object.assign(new Error(), { name: "NotFound", $metadata: { httpStatusCode: 404 } });
    }
    return clients().s3Client.send(command);
  };
  await assert.rejects(createAwsRoleTokenVaultInfrastructurePreflightV2(manifest(), {
    s3Client: fake.s3Client, kmsClient: fake.kmsClient, clock: { now: () => NOW },
  }).run(), (error) => error instanceof AwsRoleTokenVaultPreflightV2NotReadyError && error.checkCode === "s3_object_lock_invalid");
});

test("preflight v2 requires modeled lifecycle absence and rejects present or ambiguous lifecycle state", async () => {
  for (const lifecycleResult of [
    { Rules: [{ Status: "Enabled", Filter: { Prefix: "ai-media-studio/oauth-role-token/v2/" }, Expiration: { Days: 1 } }] },
    {},
  ]) {
    const fake = clients();
    const s3Client: AwsRoleTokenVaultCommandClient = { async send(command, options) {
      if ((command as { constructor: { name: string } }).constructor.name === "GetBucketLifecycleConfigurationCommand") {
        return lifecycleResult;
      }
      return fake.s3Client.send(command, options);
    } };
    await assert.rejects(createAwsRoleTokenVaultInfrastructurePreflightV2(manifest(), {
      s3Client, kmsClient: fake.kmsClient, clock: { now: () => NOW },
    }).run(), (error) => error instanceof AwsRoleTokenVaultPreflightV2NotReadyError && error.checkCode === "s3_lifecycle_invalid");
  }
  const fake = clients();
  const ambiguous: AwsRoleTokenVaultCommandClient = { async send(command, options) {
    if ((command as { constructor: { name: string } }).constructor.name === "GetBucketLifecycleConfigurationCommand") {
      throw Object.assign(new Error(), { name: "NotFound", $metadata: { httpStatusCode: 404 } });
    }
    return fake.s3Client.send(command, options);
  } };
  await assert.rejects(createAwsRoleTokenVaultInfrastructurePreflightV2(manifest(), {
    s3Client: ambiguous, kmsClient: fake.kmsClient, clock: { now: () => NOW },
  }).run(), (error) => error instanceof AwsRoleTokenVaultPreflightV2NotReadyError && error.checkCode === "s3_lifecycle_invalid");
});

test("preflight v2 rejects two individually valid but unstable snapshots", async () => {
  const fake = clients(); let rotations = 0;
  const kmsClient: AwsRoleTokenVaultCommandClient = { async send(command, options) {
    if ((command as { constructor: { name: string } }).constructor.name === "GetKeyRotationStatusCommand") {
      rotations += 1;
      return { KeyRotationEnabled: true, RotationPeriodInDays: 90,
        NextRotationDate: new Date(rotations === 1 ? "2026-08-21T12:00:00.000Z" : "2026-08-22T12:00:00.000Z") };
    }
    return fake.kmsClient.send(command, options);
  } };
  await assert.rejects(createAwsRoleTokenVaultInfrastructurePreflightV2(manifest(), {
    s3Client: fake.s3Client, kmsClient, clock: { now: () => NOW },
  }).run(), (error) => error instanceof AwsRoleTokenVaultPreflightV2NotReadyError && error.checkCode === "snapshot_mismatch");
});

test("preflight v2 manifest binds exact prefix, owner, region, and policy digests", () => {
  for (const changed of [
    { prefix: "ai-media-studio/oauth-token/v1" }, { expectedBucketOwner: "123" }, { region: "moon-1" },
    { bucketPolicySha256: "A".repeat(64) }, { kmsKeyPolicySha256: "0".repeat(63) },
  ]) assert.throws(() => createAwsRoleTokenVaultInfrastructurePreflightV2({ ...manifest(), ...changed } as AwsRoleTokenVaultInfrastructureManifestV2),
    (error) => error instanceof AwsRoleTokenVaultPreflightV2NotReadyError && error.checkCode === "manifest_invalid");
});
