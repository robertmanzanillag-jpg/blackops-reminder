import assert from "node:assert/strict";
import test from "node:test";
import { DecryptCommand, GenerateDataKeyCommand } from "@aws-sdk/client-kms";
import { DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import {
  OAUTH_ROLE_TOKEN_OBJECT_PREFIX,
  createS3KmsRoleTokenVaultCapabilities,
} from "../server/ai-media-studio/oauth/s3-kms-role-token-vault";
import type {
  OAuthRoleTokenDescriptor,
  OAuthRoleTokenVaultContext,
} from "../server/ai-media-studio/oauth/role-token-vault-contracts";
import { oauthRoleTokenReferenceFor } from "../server/ai-media-studio/oauth/role-token-vault-contracts";

const KMS_KEY_ARN = "arn:aws:kms:us-east-1:123456789012:key/11111111-1111-4111-8111-111111111111";
const NOW = new Date("2026-07-21T12:00:00.000Z");
const context: OAuthRoleTokenVaultContext = {
  purpose: "ai_media_oauth_role_token_v2",
  ownerUserId: "owner-1",
  workspaceId: "workspace-1",
  actorUserId: "actor-1",
  providerAccountId: "22222222-2222-4222-8222-222222222222",
  platform: "youtube_shorts",
  sessionId: "33333333-3333-4333-8333-333333333333",
  attemptId: "attempt-1",
  targetCredentialVersion: 7,
  tokenBindingId: "44444444-4444-4444-8444-444444444444",
  artifactBindingId: "55555555-5555-4555-8555-555555555555",
  role: "refresh",
  candidateId: "candidate-1",
  targetKind: "youtube_channel",
  targetId: "channel-1",
  selectionDigest: "b".repeat(64),
  manifestRevision: "google-youtube-v1",
};
const descriptor: OAuthRoleTokenDescriptor = {
  role: "refresh",
  lifetime: { kind: "revocation_bound", revalidateAt: "2027-07-22T12:00:00.000Z" },
  manifestRevision: "google-youtube-v1",
};
const SECRET = "refresh-token-secret-sentinel";

class KmsFake {
  readonly calls: unknown[] = [];
  readonly key = Buffer.alloc(32, 7);
  decryptError: unknown;

  async send(command: unknown): Promise<unknown> {
    this.calls.push((command as { input?: unknown }).input);
    if (command instanceof GenerateDataKeyCommand) {
      return { Plaintext: Buffer.from(this.key), CiphertextBlob: Buffer.from("role-token-edk") };
    }
    if (command instanceof DecryptCommand) {
      if (this.decryptError) throw this.decryptError;
      return { Plaintext: Buffer.from(this.key) };
    }
    throw new Error("unexpected KMS command");
  }
}

class S3Fake {
  readonly calls: Array<Record<string, unknown>> = [];
  stored: Record<string, unknown> | undefined;
  ambiguousPut = false;
  getError: unknown;
  headError: unknown;

  async send(command: unknown): Promise<unknown> {
    const input = (command as { input: Record<string, unknown> }).input;
    this.calls.push(input);
    if (command instanceof PutObjectCommand) {
      if (this.stored && input.IfNoneMatch === "*") throw named("PreconditionFailed");
      this.stored = { ...input };
      if (this.ambiguousPut) {
        this.ambiguousPut = false;
        throw new Error("ambiguous provider response with secret sentinel");
      }
      return {};
    }
    if (command instanceof GetObjectCommand) {
      if (this.getError) throw this.getError;
      if (!this.stored) throw named("NoSuchKey");
      return this.output(true);
    }
    if (command instanceof HeadObjectCommand) {
      if (this.headError) throw this.headError;
      if (!this.stored) throw named("NotFound");
      return this.output(false);
    }
    if (command instanceof DeleteObjectCommand) {
      this.stored = undefined;
      return {};
    }
    throw new Error("unexpected or listing S3 command");
  }

  private output(body: boolean): Record<string, unknown> {
    const stored = this.stored!;
    return {
      ServerSideEncryption: stored.ServerSideEncryption,
      SSEKMSKeyId: stored.SSEKMSKeyId,
      BucketKeyEnabled: stored.BucketKeyEnabled,
      ContentType: stored.ContentType,
      ContentLength: stored.ContentLength,
      Metadata: stored.Metadata,
      ...(body ? { Body: (async function* stream() { yield stored.Body as Uint8Array; })() } : {}),
    };
  }
}

function harness() {
  const s3 = new S3Fake();
  const kms = new KmsFake();
  const capabilities = createS3KmsRoleTokenVaultCapabilities({
    bucket: "oauth-role-vault-bucket",
    region: "us-east-1",
    kmsKeyArn: KMS_KEY_ARN,
    expectedBucketOwner: "123456789012",
    prefix: OAUTH_ROLE_TOKEN_OBJECT_PREFIX,
    s3Client: s3,
    kmsClient: kms,
    clock: { now: () => new Date(NOW) },
  });
  return { ...capabilities, s3, kms };
}

test("v2 role vault is constructor-inert and exposes the secret only through its separate reader", async () => {
  const h = harness();
  assert.equal(h.s3.calls.length + h.kms.calls.length, 0);
  const record = await h.vault.putOnce({ context, secret: SECRET, descriptor });
  assert.match(record.reference, /^vault:\/\/ai-media-studio\/oauth-role-token\/v2\/[0-9a-f]{64}$/u);
  assert.equal(record.reference.includes(context.artifactBindingId), false);
  assert.equal(record.reference.includes(context.role), false);
  assert.deepEqual(record.descriptor, descriptor);
  assert.equal("secret" in record, false);
  assert.deepEqual(await h.vault.readDescriptor(record.reference, context), descriptor);
  assert.equal(await h.secretReader.readSecret(record.reference, context), SECRET);
  assert.equal("readSecret" in h.vault, false);
  assert.equal(JSON.stringify([...h.s3.calls, ...h.kms.calls]).includes(SECRET), false);
});

test("putOnce uses exact SSE-KMS posture and recovers only the same encrypted role artifact", async () => {
  const h = harness();
  h.s3.ambiguousPut = true;
  const first = await h.vault.putOnce({ context, secret: SECRET, descriptor });
  assert.equal((await h.vault.putOnce({ context, secret: SECRET, descriptor })).reference, first.reference);
  await assert.rejects(h.vault.putOnce({ context, secret: "competing-secret", descriptor }), /role token vault request was rejected/);
  const put = h.s3.calls.find((call) => call.IfNoneMatch === "*")!;
  assert.equal(put.ExpectedBucketOwner, "123456789012");
  assert.equal(put.ServerSideEncryption, "aws:kms");
  assert.equal(put.SSEKMSKeyId, KMS_KEY_ARN);
  assert.equal(put.BucketKeyEnabled, true);
  assert.equal(put.Expires, undefined);
  assert.deepEqual(Object.keys(put.Metadata as object).sort(), ["artifact-version", "binding-digest", "envelope-version"]);
});

test("AAD binds every tenant, actor, attempt, credential, role, and selected-target dimension", async () => {
  const dimensions: Array<keyof OAuthRoleTokenVaultContext> = [
    "ownerUserId", "workspaceId", "actorUserId", "providerAccountId", "platform", "sessionId", "attemptId",
    "targetCredentialVersion", "tokenBindingId", "artifactBindingId", "role", "candidateId", "targetKind", "targetId",
    "selectionDigest", "manifestRevision",
  ];
  for (const dimension of dimensions) {
    const h = harness();
    const record = await h.vault.putOnce({ context, secret: SECRET, descriptor });
    const changed = mutateContext(context, dimension);
    await assert.rejects(h.vault.readDescriptor(record.reference, changed), /role token vault request was rejected/, String(dimension));
  }
});

test("one object is stored per role and a role cannot substitute another role's secret", async () => {
  const operationalContext: OAuthRoleTokenVaultContext = {
    ...context,
    artifactBindingId: "66666666-6666-4666-8666-666666666666",
    role: "operational_access",
  };
  const operationalDescriptor: OAuthRoleTokenDescriptor = {
    role: "operational_access",
    lifetime: {
      kind: "expires_at",
      expiresAt: "2026-07-22T12:00:00.000Z",
      revalidateAt: "2026-07-22T00:00:00.000Z",
    },
    manifestRevision: descriptor.manifestRevision,
  };
  const refresh = harness();
  const operational = harness();
  const refreshRecord = await refresh.vault.putOnce({ context, secret: SECRET, descriptor });
  const operationalRecord = await operational.vault.putOnce({ context: operationalContext, secret: "access-secret", descriptor: operationalDescriptor });
  assert.notEqual(refreshRecord.reference, operationalRecord.reference);
  await assert.rejects(refresh.vault.readDescriptor(refreshRecord.reference, { ...context, role: "operational_access" }), /rejected/);
});

test("find treats only exact key absence as empty and redacts all provider, redirect, bucket, and KMS failures", async () => {
  const missing = harness();
  assert.equal(await missing.vault.find(context), undefined);
  for (const providerError of [
    Object.assign(new Error("redirect secret"), { name: "PermanentRedirect", $metadata: { httpStatusCode: 301 } }),
    Object.assign(new Error("bucket missing secret"), { name: "NoSuchBucket", $metadata: { httpStatusCode: 404 } }),
    Object.assign(new Error("status-only secret"), { $metadata: { httpStatusCode: 404 } }),
  ]) {
    const h = harness();
    h.s3.getError = providerError;
    await assert.rejects(h.vault.find(context), (error: unknown) =>
      error instanceof Error && error.message === "OAuth role token vault request was rejected");
  }
  const kmsFailure = harness();
  await kmsFailure.vault.putOnce({ context, secret: SECRET, descriptor });
  kmsFailure.kms.decryptError = new Error("KMS secret diagnostic");
  await assert.rejects(kmsFailure.vault.find(context), (error: unknown) =>
    error instanceof Error && error.message === "OAuth role token vault request was rejected");
});

test("delete verifies the exact stored binding, is exact-404 idempotent, and never lists", async () => {
  const h = harness();
  const record = await h.vault.putOnce({ context, secret: SECRET, descriptor });
  await assert.rejects(h.vault.delete(record.reference, { ...context, selectionDigest: "c".repeat(64) }), /rejected/);
  await h.vault.delete(record.reference, context);
  await h.vault.delete(record.reference, context);
  assert.ok(h.s3.calls.every((call) => call.ExpectedBucketOwner === "123456789012"));
  assert.equal(h.s3.calls.some((call) => String(call.constructor?.name).includes("List")), false);
  const redirect = harness();
  redirect.s3.headError = Object.assign(new Error("redirect"), { name: "PermanentRedirect" });
  await assert.rejects(redirect.vault.delete(oauthRoleTokenReferenceFor(context), context), /rejected/);
});

test("default capability construction is inert and does not expose secret-reader elevation on the vault", () => {
  const capabilities = createS3KmsRoleTokenVaultCapabilities({
    bucket: "oauth-role-vault-bucket",
    region: "us-east-1",
    kmsKeyArn: KMS_KEY_ARN,
    expectedBucketOwner: "123456789012",
    prefix: OAUTH_ROLE_TOKEN_OBJECT_PREFIX,
  });
  assert.deepEqual(Object.keys(capabilities.vault).sort(), ["delete", "find", "putOnce", "readDescriptor"]);
  assert.deepEqual(Object.keys(capabilities.secretReader), ["readSecret"]);
});

test("configuration and write inputs are exact and lifetime checks use the injected clock", async () => {
  assert.throws(() => createS3KmsRoleTokenVaultCapabilities({
    bucket: "oauth-role-vault-bucket",
    region: "us-east-1",
    kmsKeyArn: KMS_KEY_ARN,
    expectedBucketOwner: "999999999999",
    prefix: OAUTH_ROLE_TOKEN_OBJECT_PREFIX,
  }), /role token vault request was rejected/);
  const h = harness();
  assert.throws(() => createS3KmsRoleTokenVaultCapabilities({
    bucket: "oauth-role-vault-bucket",
    region: "us-east-1",
    kmsKeyArn: KMS_KEY_ARN,
    expectedBucketOwner: "123456789012",
    prefix: OAUTH_ROLE_TOKEN_OBJECT_PREFIX,
    unexpected: true,
  } as never), /rejected/);
  await assert.rejects(h.vault.putOnce({ context, secret: SECRET, descriptor, extra: true } as never), /rejected/);
  await assert.rejects(h.vault.putOnce({
    context,
    secret: SECRET,
    descriptor: { ...descriptor, lifetime: { kind: "revocation_bound", revalidateAt: "2027-07-22T12:00:00.001Z" } },
  }), /rejected/);
  await assert.rejects(h.vault.putOnce({
    context,
    secret: SECRET,
    descriptor: { ...descriptor, manifestRevision: "caller-v99" },
  }), /rejected/);
  await assert.rejects(h.vault.putOnce({
    context: { ...context, platform: "tiktok", targetKind: "tiktok_user", manifestRevision: "tiktok-v2" },
    secret: SECRET,
    descriptor: { ...descriptor, manifestRevision: "tiktok-v2" },
  }), /rejected/);
});

function named(name: string): Error {
  return Object.assign(new Error(name), { name, $metadata: { httpStatusCode: 404 } });
}

function mutateContext(source: OAuthRoleTokenVaultContext, key: keyof OAuthRoleTokenVaultContext): OAuthRoleTokenVaultContext {
  const replacements: Partial<Record<keyof OAuthRoleTokenVaultContext, unknown>> = {
    ownerUserId: "owner-2",
    workspaceId: "workspace-2",
    actorUserId: "actor-2",
    providerAccountId: "77777777-7777-4777-8777-777777777777",
    platform: "tiktok",
    sessionId: "88888888-8888-4888-8888-888888888888",
    attemptId: "attempt-2",
    targetCredentialVersion: 8,
    tokenBindingId: "99999999-9999-4999-8999-999999999999",
    artifactBindingId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    role: "operational_access",
    candidateId: "candidate-2",
    targetKind: "tiktok_user",
    targetId: "target-2",
    selectionDigest: "c".repeat(64),
    manifestRevision: "google-youtube-v2",
  };
  return { ...source, [key]: replacements[key] } as OAuthRoleTokenVaultContext;
}
