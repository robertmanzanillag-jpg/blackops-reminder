import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import express, { type Request } from "express";
import {
  influencerListResponseSchema,
  influencerResponseSchema,
  mediaLibraryResponseSchema,
  providerResourceListResponseSchema,
} from "../shared/ai-media-studio-core";
import { InMemoryMediaAssetRepository } from "../server/ai-media-studio/core/in-memory-asset-repository";
import {
  InMemoryCanonicalResourceRepository,
  InMemoryInfluencerRepository,
} from "../server/ai-media-studio/core/in-memory-core-repositories";
import type { CoreCatalogRepositories } from "../server/ai-media-studio/core/runtime";
import { InMemoryMediaJobRepository } from "../server/ai-media-studio/in-memory";
import { FakeVideoProvider } from "../server/ai-media-studio/providers/fake-video-provider";
import { createAiMediaStudioRuntime } from "../server/ai-media-studio/routes";

const timestamp = "2026-07-20T12:00:00.000Z";
const userHeaders = { "content-type": "application/json", "x-test-user": "user-a" };

function forceNoDevFallback(): () => void {
  const previous = process.env.ALLOW_DEV_USER_FALLBACK;
  process.env.ALLOW_DEV_USER_FALLBACK = "false";
  return () => {
    if (previous === undefined) delete process.env.ALLOW_DEV_USER_FALLBACK;
    else process.env.ALLOW_DEV_USER_FALLBACK = previous;
  };
}

function repositories(): CoreCatalogRepositories {
  return {
    influencers: new InMemoryInfluencerRepository(),
    resources: new InMemoryCanonicalResourceRepository(),
    assets: new InMemoryMediaAssetRepository(),
  };
}

async function startRuntime(
  coreRepositories?: CoreCatalogRepositories,
  assetDeliverySigner?: { sign(input: { tenantId: string; objectKey: string; expiresInSeconds: number }): Promise<string> },
) {
  const restoreDevFallback = forceNoDevFallback();
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    const userId = req.get("x-test-user");
    if (userId) (req as Request & { user?: { id: string } }).user = { id: userId };
    next();
  });
  const runtime = createAiMediaStudioRuntime(coreRepositories ? {
    repository: new InMemoryMediaJobRepository(),
    providers: [new FakeVideoProvider()],
    defaultProviderKey: "fake",
    coreRepositories,
    seedCoreDefaults: false,
    runtimeEnvironment: "test",
    assetDeliverySigner,
  } : {
    runtimeEnvironment: "production",
    databaseUrl: "",
  });
  app.use(runtime.router);
  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  return {
    runtime,
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: async () => {
      try {
        await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
      } finally {
        restoreDevFallback();
      }
    },
  };
}

test("asset delivery is authenticated, tenant/status gated and signed on demand", async (t) => {
  const coreRepositories = repositories();
  const timestamp = "2026-07-20T12:00:00.000Z";
  await coreRepositories.assets.createOrGet({
    id: "asset-owned-delivery", ownerUserId: "user-a", workspaceId: "personal", type: "video",
    name: "Owned render", status: "ready", mimeType: "video/mp4", sizeBytes: 1024,
    checksumSha256: "b".repeat(64), storageProvider: "owned-object-storage",
    storageKey: "ai-media-studio/user-a/renders/render-1.mp4", deliveryUrl: "https://legacy.example/bearer",
    thumbnailUrl: null, projectId: null, renderJobId: "render-1", influencerId: null,
    providerResourceId: null, source: { kind: "remote", originalUrl: "https://provider.example/private.mp4" },
    metadata: { width: 1080, height: 1920 }, createdAt: timestamp, updatedAt: timestamp, deletedAt: null,
  });
  const calls: Array<{ tenantId: string; objectKey: string; expiresInSeconds: number }> = [];
  const harness = await startRuntime(coreRepositories, { sign: async (input) => {
    calls.push(input);
    return "https://delivery.example/signed-owned-render?token=test-only";
  } });
  t.after(harness.close);

  assert.equal((await fetch(`${harness.baseUrl}/api/ai-media-studio/media-assets/asset-owned-delivery/delivery`, { method: "POST" })).status, 401);
  assert.equal((await fetch(`${harness.baseUrl}/api/ai-media-studio/media-assets/asset-owned-delivery/delivery`, {
    method: "POST", headers: { "x-test-user": "user-b" },
  })).status, 404);
  const response = await fetch(`${harness.baseUrl}/api/ai-media-studio/media-assets/asset-owned-delivery/delivery`, {
    method: "POST", headers: { "x-test-user": "user-a" },
  });
  assert.equal(response.status, 200);
  const delivery = await response.json() as { url: string; expiresAt: string };
  assert.equal(delivery.url, "https://delivery.example/signed-owned-render?token=test-only");
  assert.ok(Date.parse(delivery.expiresAt) > Date.now());
  assert.deepEqual(calls, [{
    tenantId: JSON.stringify(["personal", "user-a"]),
    objectKey: "ai-media-studio/user-a/renders/render-1.mp4",
    expiresInSeconds: 300,
  }]);
});

async function seedResources(coreRepositories: CoreCatalogRepositories) {
  const scope = { ownerUserId: "user-a", workspaceId: "personal" };
  await coreRepositories.resources.create(scope, {
    id: "avatar-a", kind: "avatar", name: "Studio avatar", status: "active", language: "en-US",
    accent: "US", gender: "female", previewUrl: null, thumbnailUrl: null, synchronizedAt: timestamp,
  });
  await coreRepositories.resources.create(scope, {
    id: "voice-a", kind: "voice", name: "Studio voice", status: "active", language: "en-US",
    accent: "US", gender: "female", previewUrl: null, thumbnailUrl: null, synchronizedAt: timestamp,
  });
}

function brief(name: string) {
  return {
    name,
    avatarResourceId: "avatar-a",
    voiceResourceId: "voice-a",
    accent: "US",
    language: "en-US",
    gender: "female",
    ageRange: { minimum: 25, maximum: 34 },
    personality: ["warm"],
    tone: ["confident"],
    speakingStyle: "Natural and concise",
    categories: ["food", "restaurants"],
    intro: "Here is today's local recommendation.",
    outro: "Save this for later.",
    energyLevel: 7,
    facialExpressions: ["warm smile"],
    brandColors: ["#111827"],
    status: "active",
  };
}

test("core catalog routes enforce auth, tenant isolation, full CRUD, pagination and resource filters", async (t) => {
  const coreRepositories = repositories();
  await seedResources(coreRepositories);
  const harness = await startRuntime(coreRepositories);
  t.after(harness.close);

  assert.equal((await fetch(`${harness.baseUrl}/api/ai-media-studio/influencers`)).status, 401);

  for (const name of ["Alpha Creator", "Bravo Creator", "Charlie Creator"]) {
    const response = await fetch(`${harness.baseUrl}/api/ai-media-studio/influencers`, {
      method: "POST", headers: userHeaders, body: JSON.stringify(brief(name)),
    });
    assert.equal(response.status, 201);
    assert.equal(influencerResponseSchema.parse(await response.json()).influencer.name, name);
  }

  const invalid = await fetch(`${harness.baseUrl}/api/ai-media-studio/influencers`, {
    method: "POST", headers: userHeaders, body: JSON.stringify({ name: "Incomplete" }),
  });
  assert.equal(invalid.status, 400);
  const duplicate = await fetch(`${harness.baseUrl}/api/ai-media-studio/influencers`, {
    method: "POST", headers: userHeaders, body: JSON.stringify(brief("Alpha Creator")),
  });
  assert.equal(duplicate.status, 409);

  const firstPage = influencerListResponseSchema.parse(await (await fetch(
    `${harness.baseUrl}/api/ai-media-studio/influencers?category=food&limit=2`,
    { headers: { "x-test-user": "user-a" } },
  )).json());
  assert.equal(firstPage.influencers.length, 2);
  assert.equal(firstPage.hasMore, true);
  assert.ok(firstPage.nextCursor);

  const secondPage = influencerListResponseSchema.parse(await (await fetch(
    `${harness.baseUrl}/api/ai-media-studio/influencers?category=food&limit=2&cursor=${firstPage.nextCursor}`,
    { headers: { "x-test-user": "user-a" } },
  )).json());
  assert.equal(secondPage.influencers.length, 1);
  assert.equal(secondPage.hasMore, false);
  assert.equal((await fetch(
    `${harness.baseUrl}/api/ai-media-studio/influencers?cursor=missing-cursor`,
    { headers: { "x-test-user": "user-a" } },
  )).status, 400);

  const otherTenant = influencerListResponseSchema.parse(await (await fetch(
    `${harness.baseUrl}/api/ai-media-studio/influencers`,
    { headers: { "x-test-user": "user-b" } },
  )).json());
  assert.deepEqual(otherTenant.influencers, []);

  const voices = providerResourceListResponseSchema.parse(await (await fetch(
    `${harness.baseUrl}/api/ai-media-studio/provider-resources?kind=voice&status=active&language=en-US`,
    { headers: { "x-test-user": "user-a" } },
  )).json());
  assert.deepEqual(voices.resources.map((resource) => resource.id), ["voice-a"]);

  const optionsResponse = await fetch(`${harness.baseUrl}/api/ai-media-studio/options`, {
    headers: { "x-test-user": "user-a" },
  });
  const optionsRaw = await optionsResponse.text();
  const options = JSON.parse(optionsRaw) as { influencers: Array<{ id: string }>; voices: Array<{ id: string }> };
  assert.equal(options.influencers.length, 3);
  assert.deepEqual(options.voices.map((voice) => voice.id), ["voice-a"]);
  assert.doesNotMatch(optionsRaw, /externalResourceId|providerAccountId|providerKey|storageKey/);

  const target = firstPage.influencers[0];
  const crossTenantUpdate = await fetch(`${harness.baseUrl}/api/ai-media-studio/influencers/${target.id}`, {
    method: "PATCH", headers: { ...userHeaders, "x-test-user": "user-b" }, body: JSON.stringify({ tone: ["unsafe"] }),
  });
  assert.equal(crossTenantUpdate.status, 404);
  assert.equal((await fetch(`${harness.baseUrl}/api/ai-media-studio/influencers/${target.id}`, {
    method: "DELETE", headers: { "x-test-user": "user-b" },
  })).status, 404);

  const mismatchedGeneration = await fetch(`${harness.baseUrl}/api/ai-media-studio/generations`, {
    method: "POST",
    headers: userHeaders,
    body: JSON.stringify({
      influencerId: target.id,
      script: "A safe local preview.",
      voiceId: "voice-wrong",
      language: "en-US",
      aspectRatio: "9:16",
      idempotencyKey: "core-route-mismatch-001",
    }),
  });
  assert.equal(mismatchedGeneration.status, 409);
  assert.equal((await mismatchedGeneration.json() as { code: string }).code, "PLAN_ADMISSION_REQUIRED");

  const updated = await fetch(`${harness.baseUrl}/api/ai-media-studio/influencers/${target.id}`, {
    method: "PATCH", headers: userHeaders, body: JSON.stringify({ tone: ["premium"] }),
  });
  assert.deepEqual(influencerResponseSchema.parse(await updated.json()).influencer.tone, ["premium"]);
  assert.equal((await fetch(`${harness.baseUrl}/api/ai-media-studio/influencers/${target.id}`, {
    method: "DELETE", headers: { "x-test-user": "user-a" },
  })).status, 204);
});

test("media asset responses redact storage and source internals", async (t) => {
  const coreRepositories = repositories();
  await coreRepositories.assets.createOrGet({
    id: "asset-safe-1",
    ownerUserId: "user-a",
    workspaceId: "personal",
    type: "video",
    name: "Reusable preview",
    status: "ready",
    mimeType: "video/mp4",
    sizeBytes: 2048,
    checksumSha256: "a".repeat(64),
    storageProvider: "private-object-store",
    storageKey: "media-assets/secret-storage-object",
    deliveryUrl: "https://delivery.kong.example/reusable-preview.mp4",
    thumbnailUrl: "https://provider.example/reusable-preview.jpg?token=thumbnail-secret",
    projectId: "project-safe-1",
    renderJobId: "render-internal-1",
    influencerId: "influencer-safe-1",
    providerResourceId: "provider-resource-internal-1",
    source: { kind: "remote", originalUrl: "https://provider.example/private-id", finalUrl: "https://provider.example/private-final" },
    metadata: { width: 1080, height: 1920, durationMs: 12_000 },
    createdAt: timestamp,
    updatedAt: timestamp,
    deletedAt: null,
  });
  for (const [index, status] of (["processing", "failed", "archived"] as const).entries()) {
    await coreRepositories.assets.createOrGet({
      id: `asset-state-${index}`,
      ownerUserId: "user-a",
      workspaceId: "personal",
      type: "video",
      name: `${status} asset`,
      status,
      mimeType: "video/mp4",
      sizeBytes: null,
      checksumSha256: null,
      storageProvider: "private-object-store",
      storageKey: `media-assets/state-${index}`,
      deliveryUrl: status === "failed" ? "http://127.0.0.1/private.mp4" : null,
      thumbnailUrl: status === "failed" ? "https://localhost/private.jpg" : null,
      projectId: "project-filter-1",
      renderJobId: `render-state-${index}`,
      influencerId: "influencer-filter-1",
      providerResourceId: null,
      source: { kind: "text" },
      metadata: {},
      createdAt: `2026-07-20T12:0${index + 1}:00.000Z`,
      updatedAt: `2026-07-20T12:0${index + 1}:00.000Z`,
      deletedAt: null,
    });
  }
  const harness = await startRuntime(coreRepositories);
  t.after(harness.close);

  const response = await fetch(`${harness.baseUrl}/api/ai-media-studio/media-assets?kinds=video&status=ready`, {
    headers: { "x-test-user": "user-a" },
  });
  const raw = await response.text();
  const library = mediaLibraryResponseSchema.parse(JSON.parse(raw));
  assert.equal(library.assets[0]?.id, "asset-safe-1");
  assert.equal(library.assets[0]?.status, "ready");
  assert.equal(library.assets[0]?.deliveryUrl, null);
  assert.equal(library.assets[0]?.thumbnailUrl, null);
  assert.equal(library.assets[0]?.projectId, "project-safe-1");
  assert.equal(library.assets[0]?.influencerId, "influencer-safe-1");
  assert.doesNotMatch(raw, /delivery\.kong\.example\/reusable-preview\.mp4|thumbnail-secret|secret-storage-object|private-object-store|provider\.example|ownerUserId|workspaceId|storageKey|render-internal|provider-resource-internal|deletedAt/);

  for (const status of ["processing", "failed", "archived"] as const) {
    const filteredResponse = await fetch(
      `${harness.baseUrl}/api/ai-media-studio/media-assets?status=${status}&influencerId=influencer-filter-1&projectId=project-filter-1`,
      { headers: { "x-test-user": "user-a" } },
    );
    const filtered = mediaLibraryResponseSchema.parse(await filteredResponse.json());
    assert.equal(filtered.assets.length, 1);
    assert.equal(filtered.assets[0]?.status, status);
    assert.equal(filtered.assets[0]?.byteSize, null);
    assert.equal(filtered.assets[0]?.checksum, null);
    if (status === "failed") {
      assert.equal(filtered.assets[0]?.deliveryUrl, null);
      assert.equal(filtered.assets[0]?.thumbnailUrl, null);
    }
  }

  const otherTenant = mediaLibraryResponseSchema.parse(await (await fetch(
    `${harness.baseUrl}/api/ai-media-studio/media-assets`,
    { headers: { "x-test-user": "user-b" } },
  )).json());
  assert.deepEqual(otherTenant.assets, []);
});

test("production without durable configuration fails closed and never exposes sample defaults", async (t) => {
  const harness = await startRuntime();
  t.after(harness.close);

  const response = await fetch(`${harness.baseUrl}/api/ai-media-studio/influencers`, {
    headers: { "x-test-user": "user-a" },
  });
  assert.equal(response.status, 503);
  const raw = await response.text();
  assert.doesNotMatch(raw, /Emily|Sofia|emily-food|sofia-travel/);
  assert.equal(harness.runtime.core.status.mode, "unavailable");
});
