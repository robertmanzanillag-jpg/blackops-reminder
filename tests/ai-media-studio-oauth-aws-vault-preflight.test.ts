import assert from "node:assert/strict";
import test from "node:test";
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
} from "@aws-sdk/client-s3";
import {
  DescribeKeyCommand,
  GetKeyPolicyCommand,
  GetKeyRotationStatusCommand,
  ListGrantsCommand,
} from "@aws-sdk/client-kms";
import {
  AwsVaultInfrastructureNotReadyError,
  canonicalAwsPolicySha256,
  createAwsVaultInfrastructurePreflight,
  type AwsVaultCommandClient,
  type AwsVaultInfrastructureCheckCode,
  type AwsVaultInfrastructureManifest,
} from "../server/ai-media-studio/oauth/aws-vault-infrastructure-preflight";

const OWNER = "123456789012";
const REGION = "us-east-1";
const NOW = new Date("2026-07-21T12:00:00.000Z");
const NEXT_ROTATION = new Date("2026-10-19T12:00:00.000Z");
const BUCKET_POLICY = JSON.stringify({ Version: "2012-10-17", Statement: [{ Effect: "Deny", Action: "s3:*", Resource: "*" }] });
const KEY_POLICY = JSON.stringify({ Version: "2012-10-17", Statement: [{ Effect: "Allow", Action: "kms:*", Resource: "*" }] });
const KEY_IDS = [
  "11111111-1111-4111-8111-111111111111",
  "22222222-2222-4222-8222-222222222222",
  "33333333-3333-4333-8333-333333333333",
] as const;

function keyArn(index: number): string {
  return `arn:aws:kms:${REGION}:${OWNER}:key/${KEY_IDS[index]}`;
}

function manifest(): AwsVaultInfrastructureManifest {
  const bucketPolicySha256 = canonicalAwsPolicySha256(BUCKET_POLICY);
  const kmsKeyPolicySha256 = canonicalAwsPolicySha256(KEY_POLICY);
  return {
    region: REGION,
    expectedBucketOwner: OWNER,
    pkce: {
      bucket: "oauth-pkce-private-123", kmsKeyArn: keyArn(0), prefix: "ai-media-studio/oauth-pkce/v1",
      bucketPolicySha256, kmsKeyPolicySha256, rotationPeriodDays: 90,
    },
    authorizationCode: {
      bucket: "oauth-code-private-123", kmsKeyArn: keyArn(1), prefix: "ai-media-studio/oauth-code/v1",
      bucketPolicySha256, kmsKeyPolicySha256, rotationPeriodDays: 90,
    },
    token: {
      bucket: "oauth-token-private-123", kmsKeyArn: keyArn(2), prefix: "ai-media-studio/oauth-token/v1",
      bucketPolicySha256, kmsKeyPolicySha256, rotationPeriodDays: 90,
    },
  };
}

type FakeOptions = Readonly<{
  mismatch?: string;
  tokenLifecycle?: "modeled_absent" | "zero_rules" | "status_404";
  grantPages?: number;
  outageSecret?: string;
  unstableRotation?: boolean;
}>;

class S3Fixture implements AwsVaultCommandClient {
  readonly commands: unknown[] = [];
  private readonly resources: AwsVaultInfrastructureManifest;
  constructor(input: AwsVaultInfrastructureManifest, private readonly options: FakeOptions = {}) {
    this.resources = structuredClone(input);
  }

  async send(command: unknown): Promise<any> {
    this.commands.push(command);
    if (this.options.outageSecret) throw new Error(`aws outage ${this.options.outageSecret}`);
    const input = (command as { input?: Record<string, unknown> }).input ?? {};
    const bucket = String(input.Bucket ?? "");
    const resource = [this.resources.pkce, this.resources.authorizationCode, this.resources.token]
      .find((candidate) => candidate.bucket === bucket);
    if (!resource) throw new Error("unknown bucket");

    if (command instanceof GetBucketLocationCommand) {
      return { LocationConstraint: this.options.mismatch === "location" ? "us-west-2" : undefined };
    }
    if (command instanceof GetBucketVersioningCommand) {
      return this.options.mismatch === "versioning" ? { Status: "Enabled" } : {};
    }
    if (command instanceof GetPublicAccessBlockCommand) {
      return { PublicAccessBlockConfiguration: {
        BlockPublicAcls: this.options.mismatch !== "public_access",
        IgnorePublicAcls: true, BlockPublicPolicy: true, RestrictPublicBuckets: true,
      } };
    }
    if (command instanceof GetBucketOwnershipControlsCommand) {
      return { OwnershipControls: { Rules: [{
        ObjectOwnership: this.options.mismatch === "ownership" ? "ObjectWriter" : "BucketOwnerEnforced",
      }] } };
    }
    if (command instanceof GetBucketPolicyStatusCommand) {
      return { PolicyStatus: { IsPublic: this.options.mismatch === "policy_status" } };
    }
    if (command instanceof GetBucketEncryptionCommand) {
      return { ServerSideEncryptionConfiguration: { Rules: [{
        BucketKeyEnabled: true,
        ApplyServerSideEncryptionByDefault: {
          SSEAlgorithm: "aws:kms",
          KMSMasterKeyID: this.options.mismatch === "encryption" ? keyArn(0) : resource.kmsKeyArn,
        },
      }] } };
    }
    if (command instanceof GetBucketPolicyCommand) {
      return { Policy: this.options.mismatch === "bucket_policy"
        ? JSON.stringify({ Version: "2012-10-17", Statement: [] }) : BUCKET_POLICY };
    }
    if (command instanceof GetBucketLifecycleConfigurationCommand) {
      if (resource === this.resources.token || resource.bucket === this.resources.token.bucket) {
        if (this.options.tokenLifecycle === "zero_rules") return { Rules: [] };
        if (this.options.tokenLifecycle === "status_404") {
          const error = new Error("not found") as Error & { $metadata: { httpStatusCode: number } };
          error.$metadata = { httpStatusCode: 404 };
          throw error;
        }
        throw modeled("NoSuchLifecycleConfiguration");
      }
      return { Rules: [{
        Status: "Enabled",
        Filter: { Prefix: this.options.mismatch === "lifecycle" ? "" : `${resource.prefix}/` },
        Expiration: { Days: 1 },
      }] };
    }
    if (command instanceof GetObjectLockConfigurationCommand) {
      if (this.options.mismatch === "object_lock") return { ObjectLockConfiguration: { ObjectLockEnabled: "Enabled" } };
      throw modeled("ObjectLockConfigurationNotFoundError");
    }
    if (command instanceof GetBucketReplicationCommand) {
      if (this.options.mismatch === "replication") return { ReplicationConfiguration: { Role: "unsafe", Rules: [{}] } };
      throw modeled("ReplicationConfigurationNotFoundError");
    }
    throw new Error("unexpected S3 command");
  }
}

class KmsFixture implements AwsVaultCommandClient {
  readonly commands: unknown[] = [];
  private rotationCalls = 0;
  constructor(private readonly options: FakeOptions = {}) {}

  async send(command: unknown): Promise<any> {
    this.commands.push(command);
    if (this.options.outageSecret) throw new Error(`kms outage ${this.options.outageSecret}`);
    const arn = String((command as { input?: { KeyId?: unknown } }).input?.KeyId ?? "");
    if (!KEY_IDS.some((id) => arn.endsWith(id))) throw new Error("unknown key");
    if (command instanceof DescribeKeyCommand) {
      return { KeyMetadata: {
        Arn: arn,
        AWSAccountId: OWNER,
        Enabled: true,
        KeyState: "Enabled",
        KeyManager: "CUSTOMER",
        KeySpec: this.options.mismatch === "kms_key" ? "RSA_2048" : "SYMMETRIC_DEFAULT",
        KeyUsage: "ENCRYPT_DECRYPT",
        Origin: "AWS_KMS",
        MultiRegion: false,
      } };
    }
    if (command instanceof GetKeyRotationStatusCommand) {
      const pass = Math.floor(this.rotationCalls++ / 3);
      const next = this.options.unstableRotation && pass > 0
        ? new Date(NEXT_ROTATION.getTime() + 1_000)
        : NEXT_ROTATION;
      return {
        KeyRotationEnabled: this.options.mismatch !== "rotation",
        RotationPeriodInDays: 90,
        NextRotationDate: next,
      };
    }
    if (command instanceof GetKeyPolicyCommand) {
      return { Policy: this.options.mismatch === "kms_policy"
        ? JSON.stringify({ Version: "2012-10-17", Statement: [] }) : KEY_POLICY };
    }
    if (command instanceof ListGrantsCommand) {
      if (this.options.mismatch === "grants") return { Grants: [{ GrantId: "unexpected" }], Truncated: false };
      const pages = this.options.grantPages ?? 1;
      const marker = (command.input as { Marker?: string }).Marker;
      const current = marker ? Number(marker.split(":").at(-1)) : 1;
      return current < pages
        ? { Grants: [], Truncated: true, NextMarker: `${arn}:${current + 1}` }
        : { Grants: [], Truncated: false };
    }
    throw new Error("unexpected KMS command");
  }
}

function modeled(name: string): Error {
  const error = new Error("modeled absence");
  error.name = name;
  return error;
}

function fixture(options: FakeOptions = {}) {
  const source = manifest();
  const s3 = new S3Fixture(source, options);
  const kms = new KmsFixture(options);
  const preflight = createAwsVaultInfrastructurePreflight(source, {
    s3Client: s3,
    kmsClient: kms,
    clock: { now: () => NOW },
  });
  return { source, s3, kms, preflight };
}

async function rejectsWith(checkCode: AwsVaultInfrastructureCheckCode, action: () => Promise<unknown>): Promise<void> {
  await assert.rejects(action, (error) => {
    assert.ok(error instanceof AwsVaultInfrastructureNotReadyError);
    assert.equal(error.message, "OAuth vault infrastructure is not ready");
    assert.equal(error.checkCode, checkCode);
    return true;
  });
}

test("explicit preflight is inert at construction, checks two complete paginated snapshots, and sends bucket ownership on every S3 request", async () => {
  const { s3, kms, preflight } = fixture({ grantPages: 2 });
  assert.equal(s3.commands.length, 0);
  assert.equal(kms.commands.length, 0);
  const attestation = await preflight.run();
  assert.equal(attestation.ready, true);
  assert.equal(s3.commands.length, 60, "10 S3 checks x 3 vaults x 2 snapshots");
  assert.equal(kms.commands.length, 30, "5 KMS calls x 3 vaults x 2 snapshots with two grant pages");
  for (const command of s3.commands) {
    assert.equal((command as { input: { ExpectedBucketOwner?: string } }).input.ExpectedBucketOwner, OWNER);
  }
  const grantCommands = kms.commands.filter((command): command is ListGrantsCommand => command instanceof ListGrantsCommand);
  assert.equal(grantCommands.length, 12);
  assert.ok(grantCommands.every((command) => command.input.Limit === 100));
  assert.equal(grantCommands.filter((command) => command.input.Marker !== undefined).length, 6);
});

test("attestation is deeply frozen, expires within five minutes, and exposes no bucket, key, account, policy, or client identifiers", async () => {
  const { preflight } = fixture();
  const attestation = await preflight.run();
  assert.ok(Object.isFrozen(attestation));
  assert.ok(Object.isFrozen(attestation.checks));
  assert.equal(Date.parse(attestation.expiresAt) - Date.parse(attestation.checkedAt), 5 * 60_000);
  assert.match(attestation.manifestDigest, /^[0-9a-f]{64}$/u);
  assert.match(attestation.factDigest, /^[0-9a-f]{64}$/u);
  const serialized = JSON.stringify(attestation);
  for (const forbidden of [OWNER, "oauth-pkce-private", "oauth-code-private", "oauth-token-private", "arn:aws", "Statement", "client"]) {
    assert.equal(serialized.includes(forbidden), false);
  }
});

test("manifest is copied at construction so later caller mutation cannot redirect checks", async () => {
  const input = manifest() as any;
  const s3 = new S3Fixture(input);
  const kms = new KmsFixture();
  const preflight = createAwsVaultInfrastructurePreflight(input, { s3Client: s3, kmsClient: kms, clock: { now: () => NOW } });
  input.pkce.bucket = "attacker-bucket";
  input.pkce.kmsKeyArn = keyArn(2);
  input.expectedBucketOwner = "999999999999";
  await preflight.run();
  const first = s3.commands[0] as GetBucketLocationCommand;
  assert.equal(first.input.Bucket, "oauth-pkce-private-123");
  assert.equal(first.input.ExpectedBucketOwner, OWNER);
});

test("malformed, noncanonical, or non-distinct manifests fail locally before any client call", () => {
  const cases = [
    (value: any) => { value.region = "invalid"; },
    (value: any) => { value.expectedBucketOwner = "123"; },
    (value: any) => { value.pkce.bucket = value.token.bucket; },
    (value: any) => { value.pkce.kmsKeyArn = value.token.kmsKeyArn; },
    (value: any) => { value.pkce.prefix = "broad"; },
    (value: any) => { value.pkce.kmsKeyArn = "arn:aws:kms:us-east-1:123456789012:alias/oauth"; },
    (value: any) => { value.pkce.rotationPeriodDays = 89; },
    (value: any) => { value.pkce.bucketPolicySha256 = "not-a-digest"; },
    (value: any) => { value.extra = true; },
  ];
  for (const mutate of cases) {
    const input = manifest() as any;
    mutate(input);
    const s3 = new S3Fixture(manifest());
    const kms = new KmsFixture();
    assert.throws(() => createAwsVaultInfrastructurePreflight(input, { s3Client: s3, kmsClient: kms }), (error) => {
      assert.ok(error instanceof AwsVaultInfrastructureNotReadyError);
      assert.equal(error.checkCode, "manifest_invalid");
      return true;
    });
    assert.equal(s3.commands.length, 0);
    assert.equal(kms.commands.length, 0);
  }
});

test("each major S3 and KMS posture mismatch fails closed with its safe check code", async () => {
  const cases: Array<[string, AwsVaultInfrastructureCheckCode]> = [
    ["location", "s3_location_invalid"],
    ["versioning", "s3_versioning_invalid"],
    ["public_access", "s3_public_access_invalid"],
    ["ownership", "s3_ownership_invalid"],
    ["policy_status", "s3_policy_status_invalid"],
    ["encryption", "s3_encryption_invalid"],
    ["bucket_policy", "s3_policy_invalid"],
    ["lifecycle", "s3_lifecycle_invalid"],
    ["object_lock", "s3_object_lock_invalid"],
    ["replication", "s3_replication_invalid"],
    ["kms_key", "kms_key_invalid"],
    ["rotation", "kms_rotation_invalid"],
    ["kms_policy", "kms_policy_invalid"],
    ["grants", "kms_grants_invalid"],
  ];
  for (const [mismatch, code] of cases) {
    await rejectsWith(code, () => fixture({ mismatch }).preflight.run());
  }
});

test("token lifecycle accepts only an exact modeled absence or an explicit zero-rule response, never status-only 404", async () => {
  await fixture({ tokenLifecycle: "modeled_absent" }).preflight.run();
  await fixture({ tokenLifecycle: "zero_rules" }).preflight.run();
  await rejectsWith("s3_request_failed", () => fixture({ tokenLifecycle: "status_404" }).preflight.run());
});

test("policy comparison uses canonical JSON rather than formatting but rejects a different canonical policy", async () => {
  assert.equal(
    canonicalAwsPolicySha256(BUCKET_POLICY),
    canonicalAwsPolicySha256('{"Statement":[{"Resource":"*","Action":"s3:*","Effect":"Deny"}],"Version":"2012-10-17"}'),
  );
  await rejectsWith("s3_policy_invalid", () => fixture({ mismatch: "bucket_policy" }).preflight.run());
  await rejectsWith("kms_policy_invalid", () => fixture({ mismatch: "kms_policy" }).preflight.run());
});

test("provider outages are redacted and do not expose underlying messages or identifiers", async () => {
  const sentinel = "AKIA_PROVIDER_SECRET_MUST_NOT_LEAK";
  const { preflight } = fixture({ outageSecret: sentinel });
  const error = await preflight.run().then(() => undefined, (failure: unknown) => failure);
  assert.ok(error instanceof AwsVaultInfrastructureNotReadyError);
  assert.equal(error.checkCode, "s3_request_failed");
  assert.equal(JSON.stringify(error).includes(sentinel), false);
  assert.equal(error.message.includes(sentinel), false);
  assert.equal(JSON.stringify(error).includes("oauth-pkce-private"), false);
});

test("a hung infrastructure request is aborted and fails closed within its configured test deadline", async () => {
  let observedSignal: AbortSignal | undefined;
  const hanging: AwsVaultCommandClient = {
    async send(_command, options) {
      observedSignal = options?.abortSignal;
      return await new Promise(() => {});
    },
  };
  const preflight = createAwsVaultInfrastructurePreflight(manifest(), {
    s3Client: hanging,
    kmsClient: hanging,
    requestTimeoutMs: 5,
  });
  await rejectsWith("s3_request_failed", () => preflight.run());
  assert.equal(observedSignal?.aborted, true);
});

test("two individually valid but different snapshots cannot produce an attestation", async () => {
  await rejectsWith("snapshot_mismatch", () => fixture({ unstableRotation: true }).preflight.run());
});

test("default clients pin official S3 and KMS endpoints despite ambient override variables", async () => {
  const previousGlobal = process.env.AWS_ENDPOINT_URL;
  const previousS3 = process.env.AWS_ENDPOINT_URL_S3;
  const previousKms = process.env.AWS_ENDPOINT_URL_KMS;
  process.env.AWS_ENDPOINT_URL = "https://attacker.example";
  process.env.AWS_ENDPOINT_URL_S3 = "https://attacker.example";
  process.env.AWS_ENDPOINT_URL_KMS = "https://attacker.example";
  try {
    const preflight = createAwsVaultInfrastructurePreflight(manifest()) as unknown as {
      s3: { config: { endpoint(): Promise<{ hostname: string }> } };
      kms: { config: { endpoint(): Promise<{ hostname: string }> } };
    };
    assert.equal((await preflight.s3.config.endpoint()).hostname, "s3.us-east-1.amazonaws.com");
    assert.equal((await preflight.kms.config.endpoint()).hostname, "kms.us-east-1.amazonaws.com");
  } finally {
    if (previousGlobal === undefined) delete process.env.AWS_ENDPOINT_URL; else process.env.AWS_ENDPOINT_URL = previousGlobal;
    if (previousS3 === undefined) delete process.env.AWS_ENDPOINT_URL_S3; else process.env.AWS_ENDPOINT_URL_S3 = previousS3;
    if (previousKms === undefined) delete process.env.AWS_ENDPOINT_URL_KMS; else process.env.AWS_ENDPOINT_URL_KMS = previousKms;
  }
});
