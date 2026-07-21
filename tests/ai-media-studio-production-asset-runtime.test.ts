import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import express, { type Request } from "express";
import {
  AssetIngestWorker,
  InMemoryAssetIngestRepository,
  NodeHttpsArtifactReader,
  S3CompatibleAssetDeliverySigner,
  S3CompatibleOwnedObjectStorage,
  createProductionAssetIngestWorker,
  createProductionAssetRuntimeFromEnvironment,
  type ProductionAssetEnvironment,
  type S3CommandClient,
} from "../server/ai-media-studio/assets";
import { InMemoryMediaAssetRepository } from "../server/ai-media-studio/core/in-memory-asset-repository";
import {
  InMemoryCanonicalResourceRepository,
  InMemoryInfluencerRepository,
} from "../server/ai-media-studio/core/in-memory-core-repositories";
import type { CoreCatalogRepositories } from "../server/ai-media-studio/core/runtime";
import { InMemoryMediaJobRepository } from "../server/ai-media-studio/in-memory";
import { FakeVideoProvider } from "../server/ai-media-studio/providers/fake-video-provider";
import { createAiMediaStudioRuntime } from "../server/ai-media-studio/routes";

const fullEnvironment: ProductionAssetEnvironment = {
  AI_MEDIA_STUDIO_ASSET_HOST_ALLOWLIST: "cdn.heygen.com,assets.example.com",
  AI_MEDIA_STUDIO_ASSET_BUCKET: "kong-ai-media-assets",
  AI_MEDIA_STUDIO_ASSET_REGION: "auto",
  AI_MEDIA_STUDIO_ASSET_ACCESS_KEY_ID: "test-access-key",
  AI_MEDIA_STUDIO_ASSET_SECRET_ACCESS_KEY: "test-secret-key",
  AI_MEDIA_STUDIO_ASSET_ENDPOINT: "https://tenant.r2.cloudflarestorage.com/",
  AI_MEDIA_STUDIO_ASSET_FORCE_PATH_STYLE: "false",
  AI_MEDIA_STUDIO_ASSET_MAX_BYTES: String(64 * 1024 * 1024),
  AI_MEDIA_STUDIO_ASSET_MAX_CHUNK_BYTES: String(1024 * 1024),
  AI_MEDIA_STUDIO_ASSET_MAX_REDIRECTS: "2",
  AI_MEDIA_STUDIO_ASSET_REQUEST_TIMEOUT_MS: "15000",
  AI_MEDIA_STUDIO_ASSET_MULTIPART_PART_SIZE_BYTES: String(5 * 1024 * 1024),
};

class NoNetworkS3Client implements S3CommandClient {
  calls = 0;
  async send(): Promise<never> {
    this.calls += 1;
    throw new Error("network must not run during composition");
  }
}

test("production asset environment is unavailable when entirely absent", () => {
  assert.deepEqual(createProductionAssetRuntimeFromEnvironment({}), {
    available: false,
    reason: "not_configured",
  });
});

test("a full production environment constructs real adapters without network", async () => {
  const client = new NoNetworkS3Client();
  let presignCalls = 0;
  const runtime = createProductionAssetRuntimeFromEnvironment(fullEnvironment, {
    s3Client: client,
    presign: async () => {
      presignCalls += 1;
      return "https://delivery.example.com/private-object?signature=test";
    },
    resolvePublicAddresses: async () => ["93.184.216.34"],
  });
  assert.equal(runtime.available, true);
  if (!runtime.available) return;
  assert.ok(runtime.reader instanceof NodeHttpsArtifactReader);
  assert.ok(runtime.storage instanceof S3CompatibleOwnedObjectStorage);
  assert.ok(runtime.signer instanceof S3CompatibleAssetDeliverySigner);
  assert.deepEqual([...runtime.sourcePolicy.allowedHosts], ["cdn.heygen.com", "assets.example.com"]);
  assert.equal(client.calls, 0, "adapter construction must not issue an S3 request");

  const tenantId = JSON.stringify(["personal", "user-a"]);
  const tenantSegment = Buffer.from(tenantId, "utf8").toString("base64url");
  const signed = await runtime.signer.sign({
    tenantId,
    objectKey: `ai-media-studio/${tenantSegment}/sha256/${"b".repeat(64)}.mp4`,
    expiresInSeconds: 300,
  });
  assert.equal(signed, "https://delivery.example.com/private-object?signature=test");
  assert.equal(presignCalls, 1);
  assert.equal(client.calls, 0, "the injected presigner remains the only signing boundary in this test");
});

test("partial, wildcard, unsafe, unknown, and malformed production config fails closed with a safe message", () => {
  const secret = "must-never-appear-in-an-error";
  const cases: ProductionAssetEnvironment[] = [
    { AI_MEDIA_STUDIO_ASSET_SECRET_ACCESS_KEY: secret },
    { ...fullEnvironment, AI_MEDIA_STUDIO_ASSET_HOST_ALLOWLIST: "*.heygen.com" },
    { ...fullEnvironment, AI_MEDIA_STUDIO_ASSET_ENDPOINT: `https://user:${secret}@storage.example.com/` },
    { ...fullEnvironment, AI_MEDIA_STUDIO_ASSET_FORCE_PATH_STYLE: "yes" },
    { ...fullEnvironment, AI_MEDIA_STUDIO_ASSET_MAX_CHUNK_BYTES: String(128 * 1024 * 1024) },
    { ...fullEnvironment, AI_MEDIA_STUDIO_ASSET_UNSUPPORTED_OPTION: "enabled" },
  ];
  for (const environment of cases) {
    let message = "";
    assert.throws(() => createProductionAssetRuntimeFromEnvironment(environment), (error) => {
      message = error instanceof Error ? error.message : String(error);
      return message === "AI Media Studio production asset configuration is invalid";
    });
    assert.equal(message.includes(secret), false);
  }
});

test("production ingest worker factory is inert until runNext is explicitly called", () => {
  const client = new NoNetworkS3Client();
  const worker = createProductionAssetIngestWorker({
    workerId: "asset-worker-production-1",
    repository: new InMemoryAssetIngestRepository(),
    environment: fullEnvironment,
    adapterDependencies: {
      s3Client: client,
      presign: async () => "https://delivery.example.com/signed",
      resolvePublicAddresses: async () => ["93.184.216.34"],
    },
  });
  assert.ok(worker instanceof AssetIngestWorker);
  assert.equal(client.calls, 0);
  assert.throws(() => createProductionAssetIngestWorker({
    workerId: "asset-worker-production-2",
    repository: new InMemoryAssetIngestRepository(),
    environment: {},
  }), /production asset storage is unavailable/);
});

function repositories(): CoreCatalogRepositories {
  return {
    influencers: new InMemoryInfluencerRepository(),
    resources: new InMemoryCanonicalResourceRepository(),
    assets: new InMemoryMediaAssetRepository(),
  };
}

async function startDeliveryRuntime(input: {
  productionAssetEnvironment: ProductionAssetEnvironment;
  assetDeliverySigner?: { sign(): Promise<string> };
}) {
  const coreRepositories = repositories();
  const tenantId = JSON.stringify(["personal", "user-a"]);
  const tenantSegment = Buffer.from(tenantId, "utf8").toString("base64url");
  await coreRepositories.assets.createOrGet({
    id: "asset-production-runtime", ownerUserId: "user-a", workspaceId: "personal", type: "video",
    name: "Production owned render", status: "ready", mimeType: "video/mp4", sizeBytes: 1024,
    checksumSha256: "c".repeat(64), storageProvider: "owned-object-storage",
    storageKey: `ai-media-studio/${tenantSegment}/sha256/${"c".repeat(64)}.mp4`, deliveryUrl: null,
    thumbnailUrl: null, projectId: null, renderJobId: "render-production", influencerId: null,
    providerResourceId: null, source: { kind: "remote" }, metadata: {},
    createdAt: "2026-07-20T12:00:00.000Z", updatedAt: "2026-07-20T12:00:00.000Z", deletedAt: null,
  });
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    if (req.get("x-test-user")) (req as Request & { user?: { id: string } }).user = { id: req.get("x-test-user")! };
    next();
  });
  const runtime = createAiMediaStudioRuntime({
    repository: new InMemoryMediaJobRepository(),
    coreRepositories,
    runtimeEnvironment: "production",
    operations: { runtimeEnvironment: "test" },
    productionAssetEnvironment: input.productionAssetEnvironment,
    ...(input.assetDeliverySigner ? { assetDeliverySigner: input.assetDeliverySigner } : {}),
  });
  app.use(runtime.router);
  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  return {
    url: `http://127.0.0.1:${address.port}/api/ai-media-studio/media-assets/asset-production-runtime/delivery`,
    close: () => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())),
  };
}

test("delivery remains 503 with no production signer and explicit signer wins before env parsing", async (t) => {
  const previousFallback = process.env.ALLOW_DEV_USER_FALLBACK;
  process.env.ALLOW_DEV_USER_FALLBACK = "false";
  t.after(() => {
    if (previousFallback === undefined) delete process.env.ALLOW_DEV_USER_FALLBACK;
    else process.env.ALLOW_DEV_USER_FALLBACK = previousFallback;
  });

  const unavailable = await startDeliveryRuntime({ productionAssetEnvironment: {} });
  t.after(unavailable.close);
  const unavailableResponse = await fetch(unavailable.url, { method: "POST", headers: { "x-test-user": "user-a" } });
  assert.equal(unavailableResponse.status, 503);
  assert.deepEqual(await unavailableResponse.json(), { error: "Owned media delivery is unavailable" });

  let explicitCalls = 0;
  const explicit = await startDeliveryRuntime({
    productionAssetEnvironment: { AI_MEDIA_STUDIO_ASSET_SECRET_ACCESS_KEY: "intentionally-partial" },
    assetDeliverySigner: { sign: async () => {
      explicitCalls += 1;
      return "https://explicit.example.com/owned?signature=test";
    } },
  });
  t.after(explicit.close);
  const explicitResponse = await fetch(explicit.url, { method: "POST", headers: { "x-test-user": "user-a" } });
  assert.equal(explicitResponse.status, 200);
  assert.equal((await explicitResponse.json() as { url: string }).url, "https://explicit.example.com/owned?signature=test");
  assert.equal(explicitCalls, 1);
});

test("production composition never permits the fake render provider", () => {
  assert.throws(() => createAiMediaStudioRuntime({
    repository: new InMemoryMediaJobRepository(),
    providers: [new FakeVideoProvider()],
    defaultProviderKey: "fake",
    runtimeEnvironment: "production",
    operations: { runtimeEnvironment: "test" },
    productionAssetEnvironment: {},
  }), /Fake video provider is not allowed in production/);
});
