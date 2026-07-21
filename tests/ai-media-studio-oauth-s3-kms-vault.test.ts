import assert from "node:assert/strict";
import { Readable } from "node:stream";
import test from "node:test";
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
} from "@aws-sdk/client-s3";
import type { OAuthVaultContext } from "../server/ai-media-studio/oauth/contracts";
import {
  OAUTH_PKCE_OBJECT_PREFIX,
  S3KmsPkceVault,
  type S3KmsCommandClient,
} from "../server/ai-media-studio/oauth/s3-kms-pkce-vault";

const NOW = new Date("2026-07-21T12:00:00.000Z");
const SESSION_ID = "11111111-1111-4111-8111-111111111111";
const KMS_ARN = "arn:aws:kms:us-east-1:123456789012:key/22222222-2222-4222-8222-222222222222";
const VERIFIER = "v".repeat(64);
const context: OAuthVaultContext = {
  purpose: "ai_media_oauth_pkce",
  ownerUserId: "owner-1",
  workspaceId: "workspace-1",
  actorUserId: "actor-1",
  providerAccountId: "33333333-3333-4333-8333-333333333333",
  platform: "youtube_shorts",
  sessionId: SESSION_ID,
  expiresAt: "2026-07-21T12:10:00.000Z",
};

class RecordingClient implements S3KmsCommandClient {
  readonly commands: unknown[] = [];
  put?: PutObjectCommand;

  async send(command: unknown): Promise<any> {
    this.commands.push(command);
    if (command instanceof PutObjectCommand) {
      this.put = command;
      return { ETag: "opaque" };
    }
    if (command instanceof GetObjectCommand) {
      assert.ok(this.put);
      return {
        Body: Readable.from([this.put.input.Body as Uint8Array]),
        ContentType: this.put.input.ContentType,
        ServerSideEncryption: this.put.input.ServerSideEncryption,
        SSEKMSKeyId: this.put.input.SSEKMSKeyId,
        BucketKeyEnabled: this.put.input.BucketKeyEnabled,
        Metadata: this.put.input.Metadata,
        ContentLength: this.put.input.ContentLength,
        Expires: this.put.input.Expires,
      };
    }
    if (command instanceof HeadObjectCommand) {
      assert.ok(this.put);
      return {
        ContentType: this.put.input.ContentType,
        ServerSideEncryption: this.put.input.ServerSideEncryption,
        SSEKMSKeyId: this.put.input.SSEKMSKeyId,
        BucketKeyEnabled: this.put.input.BucketKeyEnabled,
        Metadata: this.put.input.Metadata,
        ContentLength: this.put.input.ContentLength,
        Expires: this.put.input.Expires,
      };
    }
    if (command instanceof DeleteObjectCommand) return {};
    throw new Error("unexpected command");
  }
}

function vault(client: S3KmsCommandClient) {
  return new S3KmsPkceVault({
    bucket: "oauth-private-bucket",
    region: "us-east-1",
    kmsKeyArn: KMS_ARN,
    expectedBucketOwner: "123456789012",
    prefix: OAUTH_PKCE_OBJECT_PREFIX,
    client,
    clock: { now: () => NOW },
  });
}

test("S3 PKCE vault is inert at construction and writes an exclusive, SSE-KMS bucket-key object", async () => {
  const client = new RecordingClient();
  const store = vault(client);
  assert.equal(client.commands.length, 0);
  const reference = await store.put(VERIFIER, context);
  assert.equal(reference, `vault://ai-media-studio/oauth-pkce/v1/${SESSION_ID}`);

  const put = client.put;
  assert.ok(put);
  assert.equal(put.input.Bucket, "oauth-private-bucket");
  assert.equal(put.input.ExpectedBucketOwner, "123456789012");
  assert.equal(put.input.Key, `${OAUTH_PKCE_OBJECT_PREFIX}/${SESSION_ID}.json`);
  assert.equal(put.input.ServerSideEncryption, "aws:kms");
  assert.equal(put.input.SSEKMSKeyId, KMS_ARN);
  assert.equal(put.input.BucketKeyEnabled, true);
  assert.equal(put.input.IfNoneMatch, "*");
  assert.equal(put.input.ContentType, "application/json");
  assert.equal(put.input.Tagging, "classification=oauth-pkce&retention=ephemeral");
  assert.equal(put.input.Expires?.toISOString(), context.expiresAt);
  assert.deepEqual(Object.keys(put.input.Metadata ?? {}).sort(), ["binding-digest", "expires-at", "session-id"]);
  assert.equal(JSON.stringify(put.input).includes("owner-1"), false, "identity binding is represented only by its digest");
  assert.equal(put.input.Tagging?.includes(SESSION_ID), false);
  assert.equal(put.input.Tagging?.includes(VERIFIER), false);
});

test("S3 Expires is emitted and validated at HTTP-date second precision", async () => {
  const client = new RecordingClient();
  const store = vault(client);
  const millisecondContext = { ...context, expiresAt: "2026-07-21T12:10:00.987Z" };
  const reference = await store.put(VERIFIER, millisecondContext);
  assert.equal(client.put?.input.Expires?.toISOString(), "2026-07-21T12:10:00.000Z");
  assert.equal(await store.read(reference, millisecondContext), VERIFIER);
});

test("S3 PKCE vault reads only an exact encrypted binding and deletes only the exact key", async () => {
  const client = new RecordingClient();
  const store = vault(client);
  const reference = await store.put(VERIFIER, context);
  assert.equal(await store.read(reference, context), VERIFIER);
  await store.delete(reference, context);
  assert.equal(client.commands.filter((command) => command instanceof GetObjectCommand).length, 1);
  assert.equal(client.commands.filter((command) => command instanceof HeadObjectCommand).length, 1);
  const deletion = client.commands.find((command): command is DeleteObjectCommand => command instanceof DeleteObjectCommand);
  assert.equal(deletion?.input.Key, `${OAUTH_PKCE_OBJECT_PREFIX}/${SESSION_ID}.json`);

  await assert.rejects(
    () => store.read(reference, { ...context, actorUserId: "different-actor" }),
    /vault request was rejected/,
  );
  await assert.rejects(
    () => store.delete("vault://wrong-purpose/value", context),
    /vault request was rejected/,
  );
  await assert.rejects(
    () => store.delete(reference, { ...context, workspaceId: "workspace-2" }),
    /vault request was rejected/,
  );
});

test("S3 PKCE delete is idempotent when the exact object is already absent", async () => {
  const commands: unknown[] = [];
  const store = vault({ async send(command) {
    commands.push(command);
    if (command instanceof HeadObjectCommand) {
      const error = new Error("not found");
      error.name = "NotFound";
      throw error;
    }
    throw new Error("delete should not run for an absent object");
  } });
  await store.delete(`vault://ai-media-studio/oauth-pkce/v1/${SESSION_ID}`, context);
  assert.equal(commands.length, 1);
  assert.equal((commands[0] as HeadObjectCommand).input.ExpectedBucketOwner, "123456789012");
});

test("S3 PKCE cleanup rejects ambiguous status-only 404 and bucket-level absence", async () => {
  for (const error of [
    Object.assign(new Error("gateway"), { $metadata: { httpStatusCode: 404 } }),
    Object.assign(new Error("bucket missing"), { name: "NoSuchBucket" }),
  ]) {
    const store = vault({ async send(command) {
      if (command instanceof HeadObjectCommand) throw error;
      throw new Error("unexpected command");
    } });
    await assert.rejects(
      store.delete(`vault://ai-media-studio/oauth-pkce/v1/${SESSION_ID}`, context),
      /vault request was rejected/,
    );
  }
});

test("S3 PKCE vault rejects wrong encryption, oversized bodies, invalid TTLs, and redacts provider errors", async () => {
  const wrongEncryption = vault({
    async send(command) {
      if (command instanceof PutObjectCommand) return {};
      return { Body: Readable.from(["{}"]), ServerSideEncryption: "AES256", Metadata: {} };
    },
  });
  const reference = await wrongEncryption.put(VERIFIER, context);
  await assert.rejects(() => wrongEncryption.read(reference, context), /vault request was rejected/);

  const oversized = vault({
    async send(command) {
      if (command instanceof PutObjectCommand) return {};
      return {
        Body: Readable.from([Buffer.alloc(4_097)]),
        ContentType: "application/json",
        ServerSideEncryption: "aws:kms",
        SSEKMSKeyId: KMS_ARN,
        BucketKeyEnabled: true,
        Metadata: {},
      };
    },
  });
  await oversized.put(VERIFIER, context);
  await assert.rejects(() => oversized.read(reference, context), /vault request was rejected/);

  await assert.rejects(
    () => vault(new RecordingClient()).put(VERIFIER, { ...context, expiresAt: "2026-07-21T12:20:00.000Z" }),
    /vault request was rejected/,
  );

  const secret = "AKIA_MUST_NOT_LEAK";
  const failing = vault({ async send() { throw new Error(`provider rejected ${secret}`); } });
  const error = await failing.put(VERIFIER, context).then(() => undefined, (failure: unknown) => failure);
  assert.ok(error instanceof Error);
  assert.equal(error.message, "OAuth PKCE vault request was rejected");
  assert.equal(error.message.includes(secret), false);
});

test("S3 PKCE vault configuration rejects aliases, mismatched regions, custom prefixes, and malformed references", async () => {
  const client = new RecordingClient();
  assert.throws(() => new S3KmsPkceVault({
    bucket: "oauth-private-bucket", region: "us-east-1",
    kmsKeyArn: "arn:aws:kms:us-east-1:123456789012:alias/oauth", expectedBucketOwner: "123456789012", prefix: OAUTH_PKCE_OBJECT_PREFIX, client,
  }), /vault request was rejected/);
  assert.throws(() => new S3KmsPkceVault({
    bucket: "oauth-private-bucket", region: "us-east-1",
    kmsKeyArn: "arn:aws-cn:kms:us-east-1:123456789012:key/22222222-2222-4222-8222-222222222222",
    expectedBucketOwner: "123456789012", prefix: OAUTH_PKCE_OBJECT_PREFIX, client,
  }), /vault request was rejected/);
  assert.throws(() => new S3KmsPkceVault({
    bucket: "oauth-private-bucket", region: "us-west-2", kmsKeyArn: KMS_ARN, expectedBucketOwner: "123456789012",
    prefix: OAUTH_PKCE_OBJECT_PREFIX, client,
  }), /vault request was rejected/);
  assert.throws(() => new S3KmsPkceVault({
    bucket: "oauth-private-bucket", region: "us-east-1", kmsKeyArn: KMS_ARN, expectedBucketOwner: "123456789012",
    prefix: "other-prefix" as typeof OAUTH_PKCE_OBJECT_PREFIX, client,
  }), /vault request was rejected/);
  await assert.rejects(
    () => vault(client).read(`vault://ai-media-studio/oauth-pkce/v1/${SESSION_ID}?x=1`, context),
    /vault request was rejected/,
  );
  await assert.rejects(
    () => vault(client).read(`vault://ai-media-studio/oauth-pkce/v1/${SESSION_ID.toUpperCase()}`, context),
    /vault request was rejected/,
  );
});

test("default SDK client pins the official AWS endpoint despite ambient endpoint override variables", async () => {
  const previousGlobal = process.env.AWS_ENDPOINT_URL;
  const previousS3 = process.env.AWS_ENDPOINT_URL_S3;
  process.env.AWS_ENDPOINT_URL = "https://attacker.example";
  process.env.AWS_ENDPOINT_URL_S3 = "https://attacker.example";
  try {
    const store = new S3KmsPkceVault({
      bucket: "oauth-private-bucket", region: "us-east-1", kmsKeyArn: KMS_ARN, expectedBucketOwner: "123456789012",
      prefix: OAUTH_PKCE_OBJECT_PREFIX,
    });
    const client = (store as unknown as { config: { client: { config: { endpoint(): Promise<{ hostname: string }> } } } }).config.client;
    assert.equal((await client.config.endpoint()).hostname, "s3.us-east-1.amazonaws.com");
  } finally {
    if (previousGlobal === undefined) delete process.env.AWS_ENDPOINT_URL;
    else process.env.AWS_ENDPOINT_URL = previousGlobal;
    if (previousS3 === undefined) delete process.env.AWS_ENDPOINT_URL_S3;
    else process.env.AWS_ENDPOINT_URL_S3 = previousS3;
  }
});
