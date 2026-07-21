import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CopyObjectCommand,
  CreateMultipartUploadCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  UploadPartCommand,
} from "@aws-sdk/client-s3";
import {
  S3CompatibleAssetDeliverySigner,
  S3CompatibleOwnedObjectStorage,
  type S3CommandClient,
} from "../server/ai-media-studio/assets/s3-compatible-storage";
import { storageTenantSegment } from "../server/ai-media-studio/assets/object-keys";
import { temporaryAssetKey } from "../server/ai-media-studio/assets/worker";

const PART_SIZE = 5 * 1024 * 1024;
const TENANT = JSON.stringify(["personal", "user-a"]);
const TENANT_SEGMENT = storageTenantSegment(TENANT);
const TEMPORARY_KEY = `ai-media-studio/${TENANT_SEGMENT}/ingest/render-1.tmp`;

class MultipartSuccessClient implements S3CommandClient {
  readonly commands: unknown[] = [];
  readonly uploadedPartSizes: number[] = [];
  copiedMetadata: Record<string, string> | undefined;
  copiedContentType: string | undefined;
  copiedKey: string | undefined;
  copiedLength = 0;

  async send(command: unknown): Promise<any> {
    this.commands.push(command);
    if (command instanceof CreateMultipartUploadCommand) return { UploadId: "upload-1" };
    if (command instanceof UploadPartCommand) {
      const body = command.input.Body as Uint8Array;
      this.uploadedPartSizes.push(body.byteLength);
      this.copiedLength += body.byteLength;
      return { ETag: `etag-${command.input.PartNumber}` };
    }
    if (command instanceof CompleteMultipartUploadCommand) return {};
    if (command instanceof HeadObjectCommand) {
      if (command.input.Key !== this.copiedKey) throw notFound();
      return {
        ContentLength: this.copiedLength,
        ContentType: this.copiedContentType,
        Metadata: this.copiedMetadata,
      };
    }
    if (command instanceof CopyObjectCommand) {
      this.copiedKey = command.input.Key;
      this.copiedMetadata = command.input.Metadata;
      this.copiedContentType = command.input.ContentType;
      return {};
    }
    if (command instanceof DeleteObjectCommand) return {};
    throw new Error(`unexpected command: ${commandName(command)}`);
  }
}

test("S3 storage streams bounded multipart parts, promotes with replacement metadata, verifies, and cleans up", async () => {
  const client = new MultipartSuccessClient();
  const storage = makeStorage(client);
  const bytes = new Uint8Array(PART_SIZE + 17);
  for (let index = 0; index < bytes.length; index += 1) bytes[index] = index % 251;
  const sha256 = createHash("sha256").update(bytes).digest("hex");

  const upload = await storage.beginUpload({ tenantId: TENANT, temporaryObjectKey: TEMPORARY_KEY });
  await upload.write(bytes.subarray(0, 2_000_000));
  await upload.write(bytes.subarray(2_000_000, PART_SIZE + 3));
  assert.deepEqual(client.uploadedPartSizes, [PART_SIZE], "a full part is sent before commit instead of buffering the asset");
  await upload.write(bytes.subarray(PART_SIZE + 3));
  const committed = await upload.commit({ mimeType: "video/mp4", sizeBytes: bytes.byteLength, sha256 });

  assert.deepEqual(client.uploadedPartSizes, [PART_SIZE, 17]);
  assert.deepEqual(committed, {
    finalObjectKey: `ai-media-studio/${TENANT_SEGMENT}/sha256/${sha256}.mp4`,
    reused: false,
  });

  const complete = oneCommand(client.commands, CompleteMultipartUploadCommand);
  assert.deepEqual(complete.input.MultipartUpload?.Parts, [
    { ETag: "etag-1", PartNumber: 1 },
    { ETag: "etag-2", PartNumber: 2 },
  ]);
  const copy = oneCommand(client.commands, CopyObjectCommand);
  assert.equal(copy.input.CopySource, `/media-bucket/ai-media-studio/${TENANT_SEGMENT}/ingest/render-1.tmp`);
  assert.equal(copy.input.MetadataDirective, "REPLACE");
  assert.equal(copy.input.ContentType, "video/mp4");
  assert.deepEqual(copy.input.Metadata, {
    sha256,
    "size-bytes": String(bytes.byteLength),
    "tenant-id-base64url": TENANT_SEGMENT,
  });
  assert.equal(client.commands.filter((command) => command instanceof HeadObjectCommand).length, 2);
  assert.equal(client.commands.filter((command) => command instanceof DeleteObjectCommand).length, 1);
});

test("S3 storage reuses only an existing object with exact tenant metadata, length, and content type", async () => {
  const bytes = Uint8Array.from([1, 2, 3, 4]);
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const finalKey = `ai-media-studio/${TENANT_SEGMENT}/sha256/${sha256}.mp4`;
  const commands: unknown[] = [];
  const client: S3CommandClient = {
    async send(command) {
      commands.push(command);
      if (command instanceof CreateMultipartUploadCommand) return { UploadId: "upload-reuse" };
      if (command instanceof UploadPartCommand) return { ETag: "etag-1" };
      if (command instanceof CompleteMultipartUploadCommand || command instanceof DeleteObjectCommand) return {};
      if (command instanceof HeadObjectCommand && command.input.Key === finalKey) {
        return {
          ContentLength: bytes.byteLength,
          ContentType: "video/mp4; charset=binary",
          Metadata: {
            SHA256: sha256,
            "SIZE-BYTES": String(bytes.byteLength),
            "TENANT-ID-BASE64URL": TENANT_SEGMENT,
          },
        };
      }
      throw new Error(`unexpected command: ${commandName(command)}`);
    },
  };

  const upload = await makeStorage(client).beginUpload({ tenantId: TENANT, temporaryObjectKey: TEMPORARY_KEY });
  await upload.write(bytes);
  assert.deepEqual(await upload.commit({ mimeType: "video/mp4", sizeBytes: bytes.byteLength, sha256 }), {
    finalObjectKey: finalKey,
    reused: true,
  });
  assert.equal(commands.some((command) => command instanceof CopyObjectCommand), false);
  assert.equal(commands.filter((command) => command instanceof DeleteObjectCommand).length, 1);
});

test("S3 storage rejects a conflicting content-addressed object and never overwrites it", async () => {
  const bytes = Uint8Array.from([9, 8, 7]);
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const commands: unknown[] = [];
  const client: S3CommandClient = {
    async send(command) {
      commands.push(command);
      if (command instanceof CreateMultipartUploadCommand) return { UploadId: "upload-conflict" };
      if (command instanceof UploadPartCommand) return { ETag: "etag-1" };
      if (command instanceof CompleteMultipartUploadCommand || command instanceof DeleteObjectCommand) return {};
      if (command instanceof HeadObjectCommand) {
        return {
          ContentLength: bytes.byteLength + 1,
          ContentType: "video/mp4",
          Metadata: {
            sha256,
            "size-bytes": String(bytes.byteLength),
            "tenant-id-base64url": TENANT_SEGMENT,
          },
        };
      }
      throw new Error(`unexpected command: ${commandName(command)}`);
    },
  };

  const upload = await makeStorage(client).beginUpload({ tenantId: TENANT, temporaryObjectKey: TEMPORARY_KEY });
  await upload.write(bytes);
  await assert.rejects(
    () => upload.commit({ mimeType: "video/mp4", sizeBytes: bytes.byteLength, sha256 }),
    /content-addressed object verification failed/,
  );
  assert.equal(commands.some((command) => command instanceof CopyObjectCommand), false);
  assert.equal(commands.filter((command) => command instanceof DeleteObjectCommand).length, 1);
});

test("S3 storage aborts multipart state and redacts provider failures", async () => {
  const commands: unknown[] = [];
  const client: S3CommandClient = {
    async send(command) {
      commands.push(command);
      if (command instanceof CreateMultipartUploadCommand) return { UploadId: "upload-failure" };
      if (command instanceof UploadPartCommand) throw new Error("secret key AKIA_PRIVATE was rejected");
      if (command instanceof AbortMultipartUploadCommand) return {};
      throw new Error(`unexpected command: ${commandName(command)}`);
    },
  };
  const upload = await makeStorage(client).beginUpload({ tenantId: TENANT, temporaryObjectKey: TEMPORARY_KEY });
  const error = await upload.write(new Uint8Array(PART_SIZE)).then(
    () => undefined,
    (failure: unknown) => failure,
  );

  assert.ok(error instanceof Error);
  assert.equal(error.message, "multipart upload part failed");
  assert.doesNotMatch(error.message, /AKIA_PRIVATE|secret key/);
  assert.equal(commands.filter((command) => command instanceof AbortMultipartUploadCommand).length, 1);
});

test("S3 storage validates multipart metadata before promotion and aborts explicitly", async () => {
  const commands: unknown[] = [];
  const client: S3CommandClient = {
    async send(command) {
      commands.push(command);
      if (command instanceof CreateMultipartUploadCommand) return { UploadId: "upload-abort" };
      if (command instanceof AbortMultipartUploadCommand) return {};
      throw new Error(`unexpected command: ${commandName(command)}`);
    },
  };
  const upload = await makeStorage(client).beginUpload({ tenantId: TENANT, temporaryObjectKey: TEMPORARY_KEY });
  await upload.write(Uint8Array.from([1, 2]));
  await assert.rejects(
    () => upload.commit({ mimeType: "video/mp4", sizeBytes: 3, sha256: "0".repeat(64) }),
    /object metadata mismatch/,
  );
  assert.equal(commands.filter((command) => command instanceof AbortMultipartUploadCommand).length, 1);
});

test("S3 delivery signing uses the official presign hook, fixed response headers, clock, and short TTL", async () => {
  const client: S3CommandClient = { async send() { throw new Error("network must not be used"); } };
  const now = new Date("2026-07-20T12:34:56.000Z");
  let captured: { client?: S3CommandClient; command?: GetObjectCommand; options?: { expiresIn: number; signingDate: Date } } = {};
  const signer = new S3CompatibleAssetDeliverySigner({
    endpoint: "https://account-id.r2.cloudflarestorage.com",
    region: "auto",
    bucket: "media-bucket",
    client,
    forcePathStyle: true,
    clock: { now: () => now },
    presign: async (presignClient, command, options) => {
      captured = { client: presignClient, command, options };
      return "https://delivery.example/signed";
    },
  });
  const objectKey = `ai-media-studio/${TENANT_SEGMENT}/sha256/${"a".repeat(64)}.mp4`;

  assert.equal(await signer.sign({ tenantId: TENANT, objectKey, expiresInSeconds: 300 }), "https://delivery.example/signed");
  assert.equal(captured.client, client);
  assert.deepEqual(captured.options, { expiresIn: 300, signingDate: now });
  assert.equal(captured.command?.input.Bucket, "media-bucket");
  assert.equal(captured.command?.input.Key, objectKey);
  assert.equal(captured.command?.input.ResponseContentType, "video/mp4");
  assert.equal(captured.command?.input.ResponseContentDisposition, 'inline; filename="ai-media-studio-video.mp4"');

  await assert.rejects(() => signer.sign({ tenantId: TENANT, objectKey, expiresInSeconds: 901 }), /short TTL/);
  await assert.rejects(() => signer.sign({ tenantId: JSON.stringify(["personal", "user-b"]), objectKey, expiresInSeconds: 300 }), /outside tenant/);
  await assert.rejects(
    () => signer.sign({ tenantId: TENANT, objectKey: TEMPORARY_KEY, expiresInSeconds: 300 }),
    /not content addressed/,
  );
});

test("S3 delivery signer produces an SDK-presigned AWS/R2-compatible HTTPS URL without network I/O", async () => {
  const signer = new S3CompatibleAssetDeliverySigner({
    endpoint: "https://account-id.r2.cloudflarestorage.com",
    region: "auto",
    bucket: "media-bucket",
    credentials: { accessKeyId: "test-access-key", secretAccessKey: "test-secret-key" },
    forcePathStyle: true,
    clock: { now: () => new Date("2026-07-20T12:34:56.000Z") },
  });
  const objectKey = `ai-media-studio/${TENANT_SEGMENT}/sha256/${"b".repeat(64)}.mp4`;
  const signed = new URL(await signer.sign({ tenantId: TENANT, objectKey, expiresInSeconds: 120 }));

  assert.equal(signed.protocol, "https:");
  assert.equal(signed.hostname, "account-id.r2.cloudflarestorage.com");
  assert.equal(signed.searchParams.get("X-Amz-Expires"), "120");
  assert.equal(signed.searchParams.get("X-Amz-Date"), "20260720T123456Z");
  assert.equal(signed.searchParams.get("response-content-type"), "video/mp4");
  assert.equal(signed.searchParams.get("response-content-disposition"), 'inline; filename="ai-media-studio-video.mp4"');
});

test("S3 configuration rejects unsafe endpoints and undersized multipart parts", () => {
  const client: S3CommandClient = { async send() { return {}; } };
  assert.throws(
    () => new S3CompatibleOwnedObjectStorage({ endpoint: "http://storage.local", region: "auto", bucket: "bucket", client }),
    /must be HTTPS/,
  );
  assert.throws(
    () => new S3CompatibleOwnedObjectStorage({ region: "us-east-1", bucket: "bucket", client, multipartPartSizeBytes: PART_SIZE - 1 }),
    /at least 5 MiB/,
  );
});

test("structured production tenant keys use one canonical collision-safe namespace", async () => {
  const whitespaceVariant = '[ "personal" , "user-a" ]';
  assert.equal(storageTenantSegment(whitespaceVariant), TENANT_SEGMENT);
  assert.notEqual(
    storageTenantSegment(JSON.stringify(["personal", "%"])),
    storageTenantSegment(JSON.stringify(["personal", "_25"])),
    "base64url avoids the old percent-to-underscore alias",
  );
  assert.equal(
    temporaryAssetKey({ tenantId: TENANT, renderJobId: "render-1", id: "ingest-1" }),
    `ai-media-studio/${TENANT_SEGMENT}/ingest/render-1-ingest-1.tmp`,
  );

  const storage = makeStorage({ async send() { throw new Error("must fail before network"); } });
  await assert.rejects(
    () => storage.beginUpload({ tenantId: "tenant-a", temporaryObjectKey: "ai-media-studio/tenant-a/ingest/file.tmp" }),
    /structured \[workspaceId, ownerUserId\]/,
  );
});

function makeStorage(client: S3CommandClient) {
  return new S3CompatibleOwnedObjectStorage({
    endpoint: "https://account-id.r2.cloudflarestorage.com",
    region: "auto",
    bucket: "media-bucket",
    forcePathStyle: true,
    multipartPartSizeBytes: PART_SIZE,
    client,
  });
}

function notFound() {
  return Object.assign(new Error("not found"), { name: "NotFound", $metadata: { httpStatusCode: 404 } });
}

function commandName(command: unknown) {
  return command && typeof command === "object" ? command.constructor.name : typeof command;
}

function oneCommand<T extends abstract new (...args: any[]) => any>(commands: unknown[], constructor: T): InstanceType<T> {
  const matches = commands.filter((command): command is InstanceType<T> => command instanceof constructor);
  assert.equal(matches.length, 1, `expected one ${constructor.name}`);
  return matches[0];
}
