import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createServer, request } from "node:http";
import test from "node:test";
import express, { type Request } from "express";
import { sourceScriptPreviewResponseSchema } from "../shared/ai-media-studio-source-to-script";
import {
  reusableScriptAssetListResponseSchema,
  reusableScriptAssetSaveResponseSchema,
} from "../shared/ai-media-studio-reusable-script-assets";
import { InMemoryAnalyticsRepository } from "../server/ai-media-studio/analytics/in-memory-repository";
import { InMemoryMediaJobRepository } from "../server/ai-media-studio/in-memory";
import type { OperationsRepositories } from "../server/ai-media-studio/operations-runtime";
import { FakeVideoProvider } from "../server/ai-media-studio/providers/fake-video-provider";
import { InMemoryPublishingRepository } from "../server/ai-media-studio/publishing/in-memory";
import { createAiMediaStudioRuntime } from "../server/ai-media-studio/routes";
import { InMemorySourceRepository } from "../server/ai-media-studio/sources/in-memory-source-repository";

const canonicalOrigin = "https://studio.example:8443";
const endpoint = "/api/ai-media-studio/automation/sources/scripts/preview";
const reusableAssetsEndpoint = "/api/ai-media-studio/automation/sources/scripts/assets";
const eligibilityEndpoint = (sourceItemId: string) =>
  `/api/ai-media-studio/automation/sources/${sourceItemId}/eligibility-review`;
const mutationHeaders = {
  "content-type": "application/json",
  "x-test-user": "owner-a",
  origin: canonicalOrigin,
  "sec-fetch-site": "same-origin",
};

function digest(value: string): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function forceNoDevFallback(): () => void {
  const previous = process.env.ALLOW_DEV_USER_FALLBACK;
  process.env.ALLOW_DEV_USER_FALLBACK = "false";
  return () => {
    if (previous === undefined) delete process.env.ALLOW_DEV_USER_FALLBACK;
    else process.env.ALLOW_DEV_USER_FALLBACK = previous;
  };
}

function operationsRepositories(sources: InMemorySourceRepository): OperationsRepositories {
  return {
    publishing: new InMemoryPublishingRepository(),
    analytics: new InMemoryAnalyticsRepository(),
    sources,
  };
}

async function startHarness() {
  const restoreDevFallback = forceNoDevFallback();
  const sources = new InMemorySourceRepository();
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    const userId = req.get("x-test-user");
    if (userId) (req as Request & { user?: { id: string } }).user = { id: userId };
    next();
  });
  const runtime = createAiMediaStudioRuntime({
    repository: new InMemoryMediaJobRepository(),
    providers: [new FakeVideoProvider()],
    defaultProviderKey: "fake",
    runtimeEnvironment: "test",
    aiMediaStudioCanonicalAppUrl: canonicalOrigin,
    operations: {
      repositories: operationsRepositories(sources),
      runtimeEnvironment: "test",
    },
  });
  app.use(runtime.router);
  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    sources,
    close: async () => {
      try {
        await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
      } finally {
        restoreDevFallback();
      }
    },
  };
}

async function rawRequest(url: string, options: Readonly<{
  method: string; headers: Record<string, string>; body?: string;
}>): Promise<{ status: number; text: string }> {
  return new Promise((resolve, reject) => {
    const req = request(url, { method: options.method, headers: options.headers }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, text: Buffer.concat(chunks).toString("utf8") }));
    });
    req.on("error", reject);
    if (options.body) req.write(options.body);
    req.end();
  });
}

test("source-to-script preview route is tenant-scoped, redacted and has no downstream effects", async (t) => {
  const harness = await startHarness();
  t.after(harness.close);
  const source = (await harness.sources.upsertByContentHash({ ownerUserId: "owner-a", workspaceId: "personal" }, {
    adapterKey: "kong-owned-catalog",
    providerExternalId: "private-event-id",
    category: "events",
    canonicalUrl: "https://kong.example/events/private",
    title: "Weekend guide",
    content: "Owned Kong event details for a safe local source-to-script route preview.",
    contentHash: digest("Owned Kong event details for a safe local source-to-script route preview."),
    rightsStatus: "owned",
    moderationStatus: "approved",
    status: "accepted",
    payload: { upstreamPrivateField: "never-return" },
  })).item;
  const body = JSON.stringify({
    sourceItemId: source.id,
    idempotencyKey: "source-script-preview-route-001",
    language: "en",
    variantCount: 3,
  });
  const response = await fetch(`${harness.baseUrl}${endpoint}`, { method: "POST", headers: mutationHeaders, body });
  assert.equal(response.status, 200);
  const text = await response.text();
  assert.doesNotMatch(text, /private-event-id|upstreamPrivateField|kong\.example|providerAccountId|secretRef/u);
  const parsed = sourceScriptPreviewResponseSchema.parse(JSON.parse(text));
  assert.equal(parsed.source.id, source.id);
  assert.equal(parsed.effects.sourceRead, true);
  assert.equal(parsed.effects.scriptPreviewGenerated, true);
  assert.ok(Object.entries(parsed.effects).every(([key, value]) =>
    key === "sourceRead" || key === "scriptPreviewGenerated" ? value === true : value === false));
  assert.equal((await harness.sources.list({ ownerUserId: "owner-a", workspaceId: "personal" })).length, 1);
});

test("source eligibility review route unlocks only exact approved sources for script preview", async (t) => {
  const harness = await startHarness();
  t.after(harness.close);
  const content = "Fresh synced Kong event source ready for operator rights review.";
  const source = (await harness.sources.upsertByContentHash({ ownerUserId: "owner-a", workspaceId: "personal" }, {
    adapterKey: "kong-owned-catalog",
    providerExternalId: "private-event-id",
    category: "events",
    canonicalUrl: "https://kong.example/events/private",
    title: "Weekend guide",
    content,
    contentHash: digest(content),
    rightsStatus: "unknown",
    moderationStatus: "pending",
    status: "discovered",
    payload: { upstreamPrivateField: "never-return" },
  })).item;

  const review = await fetch(`${harness.baseUrl}${eligibilityEndpoint(source.id)}`, {
    method: "POST",
    headers: mutationHeaders,
    body: JSON.stringify({
      decision: "approve",
      expectedContentHash: source.contentHash,
      idempotencyKey: "source-eligibility-route-001",
      rightsStatus: "licensed",
    }),
  });
  assert.equal(review.status, 201);
  const reviewText = await review.text();
  assert.doesNotMatch(reviewText, /private-event-id|upstreamPrivateField|kong\.example|Fresh synced Kong/u);
  const reviewBody = JSON.parse(reviewText);
  assert.equal(reviewBody.downstreamState, "eligible_for_script_batch");
  assert.equal(reviewBody.review.replayed, false);

  const preview = await fetch(`${harness.baseUrl}${endpoint}`, {
    method: "POST",
    headers: mutationHeaders,
    body: JSON.stringify({
      sourceItemId: source.id,
      idempotencyKey: "source-script-preview-route-after-review-001",
    }),
  });
  assert.equal(preview.status, 200);
  const parsed = sourceScriptPreviewResponseSchema.parse(await preview.json());
  assert.equal(parsed.source.rightsStatus, "licensed");
  assert.equal(parsed.source.moderationStatus, "approved");
  assert.equal(parsed.effects.videoProviderCalled, false);
});

test("source eligibility review route rejects stale source identity and private client fields", async (t) => {
  const harness = await startHarness();
  t.after(harness.close);
  const content = "Fresh synced Kong event source ready for stale review protection.";
  const source = (await harness.sources.upsertByContentHash({ ownerUserId: "owner-a", workspaceId: "personal" }, {
    adapterKey: "kong-owned-catalog",
    providerExternalId: "private-event-id",
    category: "events",
    canonicalUrl: "https://kong.example/events/private",
    title: "Weekend guide",
    content,
    contentHash: digest(content),
    rightsStatus: "unknown",
    moderationStatus: "pending",
    status: "discovered",
    payload: {},
  })).item;
  const stale = await fetch(`${harness.baseUrl}${eligibilityEndpoint(source.id)}`, {
    method: "POST",
    headers: mutationHeaders,
    body: JSON.stringify({
      decision: "approve",
      expectedContentHash: digest("old content"),
      idempotencyKey: "source-eligibility-route-001",
      rightsStatus: "owned",
    }),
  });
  assert.equal(stale.status, 409);
  assert.deepEqual(await stale.json(), {
    error: "Source content changed; review the current version",
    code: "SOURCE_REFRESHED",
  });
  const privateField = await fetch(`${harness.baseUrl}${eligibilityEndpoint(source.id)}`, {
    method: "POST",
    headers: mutationHeaders,
    body: JSON.stringify({
      decision: "approve",
      expectedContentHash: source.contentHash,
      idempotencyKey: "source-eligibility-route-001",
      rightsStatus: "owned",
      providerExternalId: "private",
    }),
  });
  assert.equal(privateField.status, 400);
  assert.equal((await harness.sources.get({ ownerUserId: "owner-a", workspaceId: "personal" }, source.id))?.status, "discovered");
});

test("source-to-script preview route denies unsafe transport before source read", async (t) => {
  const harness = await startHarness();
  t.after(harness.close);
  process.env.ALLOW_DEV_USER_FALLBACK = "true";
  const url = `${harness.baseUrl}${endpoint}`;
  const body = JSON.stringify({
    sourceItemId: "missing-source",
    idempotencyKey: "source-script-preview-route-001",
  });

  assert.equal((await fetch(url, { method: "POST", headers: { "content-type": "application/json",
    "x-user-id": "owner-a", origin: canonicalOrigin, "sec-fetch-site": "same-origin" }, body })).status, 401);
  for (const headers of [
    { "content-type": "application/json", "x-test-user": "owner-a", "sec-fetch-site": "same-origin" },
    { ...mutationHeaders, "sec-fetch-site": "same-site" },
    { ...mutationHeaders, "sec-fetch-site": "none" },
    { ...mutationHeaders, origin: "https://attacker.example", "sec-fetch-site": "cross-site" },
  ]) {
    assert.equal((await fetch(url, { method: "POST", headers, body })).status, 403);
  }
  assert.equal((await fetch(url, { method: "POST", headers: { ...mutationHeaders,
    "content-type": "application/x-www-form-urlencoded" }, body: "sourceItemId=missing-source" })).status, 415);
  assert.equal((await fetch(`${url}?cursor=private`, { method: "POST", headers: mutationHeaders, body })).status, 400);
  assert.equal((await rawRequest(url, { method: "POST", headers: { ...mutationHeaders,
    "transfer-encoding": "chunked" }, body })).status, 400);
  assert.equal((await fetch(url, { method: "POST", headers: mutationHeaders,
    body: JSON.stringify({ sourceItemId: "missing-source", idempotencyKey: "source-script-preview-route-001",
      providerExternalId: "private" }) })).status, 400);
  assert.deepEqual(await harness.sources.list({ ownerUserId: "owner-a", workspaceId: "personal" }), []);
});

test("source-to-script preview route fails closed for ineligible source without leaking source content", async (t) => {
  const harness = await startHarness();
  t.after(harness.close);
  const source = (await harness.sources.upsertByContentHash({ ownerUserId: "owner-a", workspaceId: "personal" }, {
    adapterKey: "kong-owned-catalog",
    providerExternalId: "private-event-id",
    category: "events",
    canonicalUrl: "https://kong.example/events/private",
    title: "Weekend guide",
    content: "Restricted Kong event details should not appear in the error response.",
    contentHash: digest("Restricted Kong event details should not appear in the error response."),
    rightsStatus: "restricted",
    moderationStatus: "approved",
    status: "accepted",
    payload: {},
  })).item;
  const response = await fetch(`${harness.baseUrl}${endpoint}`, {
    method: "POST",
    headers: mutationHeaders,
    body: JSON.stringify({ sourceItemId: source.id, idempotencyKey: "source-script-preview-route-001" }),
  });
  assert.equal(response.status, 409);
  const text = await response.text();
  assert.deepEqual(JSON.parse(text), {
    error: "Source item is not eligible for script preview",
    code: "SOURCE_INELIGIBLE",
  });
  assert.doesNotMatch(text, /Restricted Kong event|private-event-id|kong\.example/u);
});

test("reusable script routes save verified variants, replay safely, and list only the tenant catalog", async (t) => {
  const harness = await startHarness();
  t.after(harness.close);
  const content = "Licensed event details that stay behind the server-owned source boundary.";
  const source = (await harness.sources.upsertByContentHash({ ownerUserId: "owner-a", workspaceId: "personal" }, {
    adapterKey: "kong-owned-catalog",
    providerExternalId: "private-upstream-event-42",
    category: "events",
    canonicalUrl: "https://kong.example/private-event-42",
    title: "Weekend guide",
    content,
    contentHash: digest(content),
    rightsStatus: "licensed",
    moderationStatus: "approved",
    status: "accepted",
    payload: { secretProviderField: "never-return" },
  })).item;
  const previewRequest = {
    sourceItemId: source.id,
    idempotencyKey: "source-script-preview-for-save-001",
    language: "en",
    variantCount: 3,
  };
  const previewResponse = await fetch(`${harness.baseUrl}${endpoint}`, {
    method: "POST", headers: mutationHeaders, body: JSON.stringify(previewRequest),
  });
  assert.equal(previewResponse.status, 200);
  const preview = sourceScriptPreviewResponseSchema.parse(await previewResponse.json());
  const saveBody = {
    previewRequest,
    expectedSourceContentHash: preview.source.contentHash,
    expectedPreviewDigest: preview.previewDigest,
    selectedVariantId: preview.scriptSet.variants[1]!.id,
    saveIdempotencyKey: "reusable-script-save-route-001",
  };

  const createdResponse = await fetch(`${harness.baseUrl}${reusableAssetsEndpoint}`, {
    method: "POST", headers: mutationHeaders, body: JSON.stringify(saveBody),
  });
  assert.equal(createdResponse.status, 201);
  assert.equal(createdResponse.headers.get("cache-control"), "private, no-store");
  const createdText = await createdResponse.text();
  assert.doesNotMatch(createdText, /private-upstream-event|secretProviderField|kong\.example|providerAccountId|secretRef/u);
  const created = reusableScriptAssetSaveResponseSchema.parse(JSON.parse(createdText));
  assert.equal(created.replayed, false);
  assert.equal(created.asset.variants.length, 3);
  assert.equal(created.asset.currentVariantId, created.asset.variants[1]!.id);
  assert.equal(created.effects.scriptPersisted, true);
  assert.equal(created.effects.videoProviderCalled, false);
  assert.equal(created.effects.spendCommitted, false);
  assert.equal(created.effects.publishingCreated, false);

  const replayResponse = await fetch(`${harness.baseUrl}${reusableAssetsEndpoint}`, {
    method: "POST", headers: mutationHeaders, body: JSON.stringify(saveBody),
  });
  assert.equal(replayResponse.status, 200);
  const replay = reusableScriptAssetSaveResponseSchema.parse(await replayResponse.json());
  assert.equal(replay.replayed, true);
  assert.equal(replay.asset.id, created.asset.id);

  const listResponse = await fetch(`${harness.baseUrl}${reusableAssetsEndpoint}?limit=25&status=draft`, {
    headers: { "x-test-user": "owner-a" },
  });
  assert.equal(listResponse.status, 200);
  assert.equal(listResponse.headers.get("cache-control"), "private, no-store");
  const list = reusableScriptAssetListResponseSchema.parse(await listResponse.json());
  assert.equal(list.items.length, 1);
  assert.equal(list.items[0]!.id, created.asset.id);

  const isolatedResponse = await fetch(`${harness.baseUrl}${reusableAssetsEndpoint}?limit=25`, {
    headers: { "x-test-user": "owner-b" },
  });
  assert.equal(isolatedResponse.status, 200);
  assert.deepEqual(reusableScriptAssetListResponseSchema.parse(await isolatedResponse.json()).items, []);

  const injectedCreative = await fetch(`${harness.baseUrl}${reusableAssetsEndpoint}`, {
    method: "POST",
    headers: mutationHeaders,
    body: JSON.stringify({ ...saveBody, script: "browser-controlled creative", providerId: "heygen" }),
  });
  assert.equal(injectedCreative.status, 400);
  const rawQuery = await fetch(`${harness.baseUrl}${reusableAssetsEndpoint}?unsafe=true`, {
    method: "POST", headers: mutationHeaders, body: JSON.stringify(saveBody),
  });
  assert.equal(rawQuery.status, 400);
});
