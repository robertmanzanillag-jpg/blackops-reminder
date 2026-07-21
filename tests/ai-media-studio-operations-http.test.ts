import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import express, { type Request } from "express";
import {
  analyticsSummarySchema,
  attributionSchema,
  automationPolicySchema,
  publishingJobListResponseSchema,
  publishingJobSchema,
  publishingPreviewSchema,
  sourceItemSchema,
} from "../shared/ai-media-studio-operations";
import { InMemoryAnalyticsRepository } from "../server/ai-media-studio/analytics/in-memory-repository";
import { FakeAnalyticsIngestionAdapter } from "../server/ai-media-studio/analytics/fake-ingestion-adapter";
import { InMemoryMediaAssetRepository } from "../server/ai-media-studio/core/in-memory-asset-repository";
import {
  InMemoryCanonicalResourceRepository,
  InMemoryInfluencerRepository,
} from "../server/ai-media-studio/core/in-memory-core-repositories";
import type { CoreCatalogRepositories } from "../server/ai-media-studio/core/runtime";
import { InMemoryMediaJobRepository } from "../server/ai-media-studio/in-memory";
import type { OperationsRepositories } from "../server/ai-media-studio/operations-runtime";
import { HeyGenVideoProvider } from "../server/ai-media-studio/providers/heygen-video-provider";
import { InMemoryPublishingRepository } from "../server/ai-media-studio/publishing/in-memory";
import { createPublishingPreview, tenantKey } from "../server/ai-media-studio/publishing/domain";
import { createAiMediaStudioRuntime } from "../server/ai-media-studio/routes";
import { InMemorySourceRepository } from "../server/ai-media-studio/sources/in-memory-source-repository";

const instant = "2026-07-20T12:00:00.000Z";
const scopeA = { ownerUserId: "user-a", workspaceId: "personal" } as const;
const scopeB = { ownerUserId: "user-b", workspaceId: "personal" } as const;
const headersA = { "content-type": "application/json", "x-test-user": scopeA.ownerUserId };

function forceNoDevFallback(): () => void {
  const previous = process.env.ALLOW_DEV_USER_FALLBACK;
  process.env.ALLOW_DEV_USER_FALLBACK = "false";
  return () => {
    if (previous === undefined) delete process.env.ALLOW_DEV_USER_FALLBACK;
    else process.env.ALLOW_DEV_USER_FALLBACK = previous;
  };
}

function coreRepositories(): CoreCatalogRepositories {
  return {
    influencers: new InMemoryInfluencerRepository(),
    resources: new InMemoryCanonicalResourceRepository(),
    assets: new InMemoryMediaAssetRepository(),
  };
}

function operationsRepositories(): OperationsRepositories {
  return {
    publishing: new InMemoryPublishingRepository(),
    analytics: new InMemoryAnalyticsRepository(),
    sources: new InMemorySourceRepository(),
  };
}

async function seedAsset(repositories: CoreCatalogRepositories, ownerUserId: string, id: string, checksum: string) {
  const scope = { ownerUserId, workspaceId: "personal" };
  if (!(await repositories.resources.get(scope, "avatar-emily"))) {
    await repositories.resources.create(scope, { id: "avatar-emily", kind: "avatar", name: "Emily", status: "active", language: "en", accent: null, gender: "female", previewUrl: null, thumbnailUrl: null, synchronizedAt: instant });
    await repositories.resources.create(scope, { id: "voice-emily-en", kind: "voice", name: "Emily voice", status: "active", language: "en", accent: null, gender: "female", previewUrl: null, thumbnailUrl: null, synchronizedAt: instant });
    await repositories.influencers.create(scope, {
      id: "emily-food", slug: "emily-food", name: "Emily", avatarResourceId: "avatar-emily", voiceResourceId: "voice-emily-en",
      accent: "American", language: "en", gender: "female", ageRange: { minimum: 25, maximum: 34 }, personality: ["warm"], tone: ["friendly"],
      speakingStyle: "Natural", categories: ["food"], intro: "Intro", outro: "Outro", energyLevel: 7,
      facialExpressions: ["smile"], brandColors: ["#111827"], status: "active", createdAt: instant, updatedAt: instant,
    });
  }
  await repositories.assets.createOrGet({
    id,
    ownerUserId,
    workspaceId: "personal",
    type: "video",
    name: `${ownerUserId} approved vertical`,
    status: "ready",
    mimeType: "video/mp4",
    sizeBytes: 2_048,
    checksumSha256: checksum,
    storageProvider: "private-object-store",
    storageKey: `media-assets/${id}`,
    deliveryUrl: `https://delivery.example/${id}.mp4`,
    thumbnailUrl: null,
    projectId: null,
    renderJobId: null,
    influencerId: "emily-food",
    providerResourceId: null,
    source: { kind: "text" },
    metadata: { width: 1080, height: 1920, durationMs: 10_000 },
    createdAt: instant,
    updatedAt: instant,
    deletedAt: null,
  });
}

async function startHarness(options: {
  core?: CoreCatalogRepositories;
  operations?: OperationsRepositories;
  productionWithoutDatabase?: boolean;
  now?: () => Date;
} = {}) {
  const restoreDevFallback = forceNoDevFallback();
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    const userId = req.get("x-test-user");
    if (userId) (req as Request & { user?: { id: string } }).user = { id: userId };
    next();
  });
  const runtime = createAiMediaStudioRuntime({
    repository: new InMemoryMediaJobRepository(),
    providers: [new HeyGenVideoProvider()],
    defaultProviderKey: "heygen",
    runtimeEnvironment: options.productionWithoutDatabase ? "production" : "test",
    databaseUrl: "",
    ...(options.core ? { coreRepositories: options.core, seedCoreDefaults: false } : {}),
    ...(!options.productionWithoutDatabase && options.operations
      ? { operations: {
          repositories: options.operations,
          runtimeEnvironment: "production",
          now: options.now ?? (() => new Date(instant)),
          resolveConnections: (scope) => scope.ownerUserId === scopeA.ownerUserId ? [{
            platform: "tiktok" as const,
            status: "ready" as const,
            accountLabel: "Studio account",
            capabilities: ["publish_video"],
            checkedAt: instant,
            message: "Connection is ready",
            apiToken: "must-not-leak",
          } as never] : [],
        } }
      : {}),
  });
  if (options.core && !options.productionWithoutDatabase) {
    for (const scope of [scopeA, scopeB]) {
      for (const asset of await options.core.assets.list(scope.ownerUserId)) {
        if (!asset.checksumSha256) continue;
        await runtime.governance.createQualityReview(scope, scope.ownerUserId, { assetId: asset.id, assetChecksum: asset.checksumSha256 }, {
          criteria: { naturalMovement: 5, eyeContact: 5, speechQuality: 5, lighting: 5, realism: 5, brandConsistency: 5, verticalQuality: 5 },
          notes: "Explicit approved route-test fixture",
          idempotencyKey: `review-${scope.ownerUserId}-${asset.id}`,
        });
      }
    }
  }
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

function manualRequest(assetId: string, key: string, caption = "A reviewed local recommendation.") {
  return {
    mediaAssetId: assetId,
    platform: "tiktok",
    caption,
    hashtags: ["Miami", "local"],
    title: "Weekend guide",
    timezone: null,
    schedule: { mode: "manual", scheduledFor: null, timezone: null },
    idempotencyKey: key,
  };
}

async function jsonPost(baseUrl: string, path: string, body: unknown, headers = headersA) {
  return fetch(`${baseUrl}${path}`, { method: "POST", headers, body: JSON.stringify(body) });
}

async function preview(baseUrl: string, body: ReturnType<typeof manualRequest>) {
  const response = await jsonPost(baseUrl, "/api/ai-media-studio/publishing/preview", body);
  assert.equal(response.status, 200);
  return publishingPreviewSchema.parse(((await response.json()) as { preview: unknown }).preview);
}

test("operations HTTP publishing is fail-closed, tenant-scoped, digest-bound, approval-gated, and provider inert", async (t) => {
  const core = coreRepositories();
  const operations = operationsRepositories();
  await seedAsset(core, scopeA.ownerUserId, "asset-a", "a".repeat(64));
  await seedAsset(core, scopeB.ownerUserId, "asset-b", "b".repeat(64));
  const harness = await startHarness({ core, operations });
  t.after(harness.close);

  const unauthorized = await fetch(`${harness.baseUrl}/api/ai-media-studio/publishing/jobs`);
  assert.equal(unauthorized.status, 401);
  assert.deepEqual(await unauthorized.json(), { error: "Authentication required" });

  const crossTenant = await jsonPost(
    harness.baseUrl,
    "/api/ai-media-studio/publishing/preview",
    manualRequest("asset-b", "cross-tenant"),
  );
  assert.equal(crossTenant.status, 404);
  assert.doesNotMatch(await crossTenant.text(), /asset-b|user-b|private-object-store/);

  const automatic = await jsonPost(harness.baseUrl, "/api/ai-media-studio/publishing/preview", {
    ...manualRequest("asset-a", "automatic"),
    timezone: null,
    schedule: { mode: "automatic", scheduledFor: null, timezone: null },
  });
  assert.equal(automatic.status, 403);
  assert.deepEqual(await automatic.json(), { error: "Forbidden" });

  const request = manualRequest("asset-a", "draft-1");
  const reviewed = await preview(harness.baseUrl, request);
  assert.equal(reviewed.mediaAssetId, "asset-a");
  assert.deepEqual(reviewed.hashtags, ["Miami", "local"]);
  assert.equal(reviewed.title, "Weekend guide");

  const forged = await jsonPost(harness.baseUrl, "/api/ai-media-studio/publishing/jobs", {
    ...request,
    previewDigest: `sha256:${"0".repeat(64)}`,
  });
  assert.equal(forged.status, 409);

  const stale = await jsonPost(harness.baseUrl, "/api/ai-media-studio/publishing/jobs", {
    ...request,
    caption: "Changed after review",
    previewDigest: reviewed.digest,
  });
  assert.equal(stale.status, 409);

  const createdResponse = await jsonPost(harness.baseUrl, "/api/ai-media-studio/publishing/jobs", {
    ...request,
    previewDigest: reviewed.digest,
  });
  assert.equal(createdResponse.status, 201);
  const created = publishingJobSchema.parse(((await createdResponse.json()) as { job: unknown }).job);
  assert.equal(created.status, "pending_approval");
  const storedDraft = await operations.publishing.get(scopeA, created.id);
  assert.equal(storedDraft?.state, "pending_approval");
  assert.equal(storedDraft?.submission, undefined, "creating a draft must never submit to a provider");

  const hiddenFromOtherTenant = publishingJobListResponseSchema.parse(await (await fetch(
    `${harness.baseUrl}/api/ai-media-studio/publishing/jobs`,
    { headers: { "x-test-user": scopeB.ownerUserId } },
  )).json());
  assert.deepEqual(hiddenFromOtherTenant.items, []);
  const crossTenantApproval = await jsonPost(
    harness.baseUrl,
    `/api/ai-media-studio/publishing/jobs/${created.id}/approve`,
    { previewDigest: reviewed.digest },
    { ...headersA, "x-test-user": scopeB.ownerUserId },
  );
  assert.equal(crossTenantApproval.status, 404);

  const wrongApproval = await jsonPost(harness.baseUrl, `/api/ai-media-studio/publishing/jobs/${created.id}/approve`, {
    previewDigest: `sha256:${"f".repeat(64)}`,
  });
  assert.equal(wrongApproval.status, 409);
  const approvedResponse = await jsonPost(harness.baseUrl, `/api/ai-media-studio/publishing/jobs/${created.id}/approve`, {
    previewDigest: reviewed.digest,
  });
  assert.equal(approvedResponse.status, 200);
  const approved = publishingJobSchema.parse(((await approvedResponse.json()) as { job: unknown }).job);
  assert.equal(approved.status, "queued");
  assert.equal(approved.approval?.actorId, scopeA.ownerUserId);
  assert.equal((await operations.publishing.get(scopeA, created.id))?.submission, undefined);

  const cancelledResponse = await jsonPost(harness.baseUrl, `/api/ai-media-studio/publishing/jobs/${created.id}/cancel`, {});
  assert.equal(cancelledResponse.status, 200);
  assert.equal(publishingJobSchema.parse(((await cancelledResponse.json()) as { job: unknown }).job).status, "cancelled");
  assert.equal((await jsonPost(harness.baseUrl, `/api/ai-media-studio/publishing/jobs/${created.id}/retry`, {})).status, 409);

  const rejectRequest = manualRequest("asset-a", "reject-1", "Reject this preview.");
  const rejectPreview = await preview(harness.baseUrl, rejectRequest);
  const rejectCreated = publishingJobSchema.parse(((await (await jsonPost(harness.baseUrl, "/api/ai-media-studio/publishing/jobs", {
    ...rejectRequest, previewDigest: rejectPreview.digest,
  })).json()) as { job: unknown }).job);
  const rejectedResponse = await jsonPost(harness.baseUrl, `/api/ai-media-studio/publishing/jobs/${rejectCreated.id}/reject`, {
    previewDigest: rejectPreview.digest,
    reason: "Brand review declined it",
  });
  assert.equal(rejectedResponse.status, 200);
  const rejected = publishingJobSchema.parse(((await rejectedResponse.json()) as { job: unknown }).job);
  assert.equal(rejected.status, "cancelled");
  assert.equal(rejected.approval?.decision, "rejected");
  assert.equal((await jsonPost(harness.baseUrl, `/api/ai-media-studio/publishing/jobs/${rejectCreated.id}/approve`, {
    previewDigest: rejectPreview.digest,
  })).status, 409);

  const scheduledRequest = {
    ...manualRequest("asset-a", "scheduled-1", "Publish only after the approved local time."),
    timezone: "America/New_York",
    schedule: {
      mode: "scheduled",
      scheduledFor: "2030-07-20T16:00:00.000Z",
      timezone: "America/New_York",
    },
  };
  const scheduledPreviewResponse = await jsonPost(harness.baseUrl, "/api/ai-media-studio/publishing/preview", scheduledRequest);
  assert.equal(scheduledPreviewResponse.status, 200);
  const scheduledPreview = publishingPreviewSchema.parse(((await scheduledPreviewResponse.json()) as { preview: unknown }).preview);
  const scheduledCreated = publishingJobSchema.parse(((await (await jsonPost(
    harness.baseUrl,
    "/api/ai-media-studio/publishing/jobs",
    { ...scheduledRequest, previewDigest: scheduledPreview.digest },
  )).json()) as { job: unknown }).job);
  const scheduledApprovalPath = `/api/ai-media-studio/publishing/jobs/${scheduledCreated.id}/approve`;
  const scheduledApprovalBody = { previewDigest: scheduledPreview.digest };
  const scheduledApprovedResponse = await jsonPost(harness.baseUrl, scheduledApprovalPath, scheduledApprovalBody);
  assert.equal(scheduledApprovedResponse.status, 200);
  const scheduledApproved = publishingJobSchema.parse(((await scheduledApprovedResponse.json()) as { job: unknown }).job);
  assert.equal(scheduledApproved.status, "scheduled");
  assert.equal((await operations.publishing.get(scopeA, scheduledCreated.id))?.state, "scheduled");
  const scheduledReplay = await jsonPost(harness.baseUrl, scheduledApprovalPath, scheduledApprovalBody);
  assert.equal(scheduledReplay.status, 200, "same approval is an idempotent continuation, not a stranded conflict");
  assert.equal(publishingJobSchema.parse(((await scheduledReplay.json()) as { job: unknown }).job).status, "scheduled");

  const retryRequest = manualRequest("asset-a", "retry-1", "Retry this approved preview.");
  const retryPreview = await preview(harness.baseUrl, retryRequest);
  const retryCreated = publishingJobSchema.parse(((await (await jsonPost(harness.baseUrl, "/api/ai-media-studio/publishing/jobs", {
    ...retryRequest, previewDigest: retryPreview.digest,
  })).json()) as { job: unknown }).job);
  await harness.runtime.operations.publishing.approve(scopeA, retryCreated.id, {
    approvedByUserId: scopeA.ownerUserId,
    previewDigest: retryPreview.digest,
  });
  const claim = await operations.publishing.claimDue({
    workerId: "test-worker",
    now: instant,
    leaseDurationMs: 60_000,
    enabledTenantKeys: new Set([tenantKey(scopeA)]),
  });
  assert.ok(claim);
  await operations.publishing.recordFailure({
    scope: scopeA,
    publicationId: retryCreated.id,
    leaseToken: claim.leaseToken,
    error: "simulated adapter failure",
    retryable: false,
    retryAt: instant,
    now: instant,
  });
  const retryAsset = await harness.runtime.core.repositories.assets.get(scopeA.ownerUserId, "asset-a");
  assert.ok(retryAsset?.checksumSha256);
  await harness.runtime.governance.createQualityReview(scopeA, scopeA.ownerUserId, {
    assetId: retryAsset.id, assetChecksum: retryAsset.checksumSha256,
  }, {
    criteria: { naturalMovement: 5, eyeContact: 5, speechQuality: 5, lighting: 5, realism: 3, brandConsistency: 5, verticalQuality: 5 },
    notes: "Retry gate regression fixture",
    idempotencyKey: "retry-needs-review",
  });
  const deniedRetryResponse = await jsonPost(harness.baseUrl, `/api/ai-media-studio/publishing/jobs/${retryCreated.id}/retry`, {});
  assert.equal(deniedRetryResponse.status, 403);
  assert.deepEqual((await deniedRetryResponse.json() as { reasons: string[] }).reasons, ["quality_review_not_approved"]);
  await harness.runtime.governance.createQualityReview(scopeA, scopeA.ownerUserId, {
    assetId: retryAsset.id, assetChecksum: retryAsset.checksumSha256,
  }, {
    criteria: { naturalMovement: 5, eyeContact: 5, speechQuality: 5, lighting: 5, realism: 5, brandConsistency: 5, verticalQuality: 5 },
    notes: "Retry gate restored fixture",
    idempotencyKey: "retry-approved-review",
  });
  const retriedResponse = await jsonPost(harness.baseUrl, `/api/ai-media-studio/publishing/jobs/${retryCreated.id}/retry`, {});
  assert.equal(retriedResponse.status, 200);
  assert.equal(publishingJobSchema.parse(((await retriedResponse.json()) as { job: unknown }).job).status, "queued");

  const listResponse = await fetch(`${harness.baseUrl}/api/ai-media-studio/publishing/jobs?limit=2`, {
    headers: { "x-test-user": scopeA.ownerUserId },
  });
  assert.equal(listResponse.status, 200);
  const firstPage = publishingJobListResponseSchema.parse(await listResponse.json());
  assert.equal(firstPage.items.length, 2);
  assert.equal(firstPage.hasMore, true);
  assert.ok(firstPage.nextCursor);
  assert.equal("jobs" in firstPage, false, "the client explicitly adapts the canonical items page shape");
});

test("operations HTTP rejects past/equal schedules and preserves an already-committed approval replay", async (t) => {
  const core = coreRepositories();
  const operations = operationsRepositories();
  await seedAsset(core, scopeA.ownerUserId, "asset-a", "a".repeat(64));
  let now = Date.parse(instant);
  const harness = await startHarness({ core, operations, now: () => new Date(now) });
  t.after(harness.close);

  const request = (scheduledFor: string, key: string) => ({
    ...manualRequest("asset-a", key, "Publish at a strictly future instant."),
    timezone: "America/New_York",
    schedule: { mode: "scheduled", scheduledFor, timezone: "America/New_York" },
  });
  const digest = (scheduledFor: string) => createPublishingPreview({
    assetId: "asset-a", assetDigest: `sha256:${"a".repeat(64)}`, caption: "Publish at a strictly future instant.",
    title: "Weekend guide", hashtags: ["Miami", "local"], platform: "tiktok", scheduledFor, timezone: "America/New_York",
  }).digest;

  for (const [label, scheduledFor] of [["past", "2026-07-20T11:59:59.999Z"], ["equal", instant]] as const) {
    const previewResponse = await jsonPost(harness.baseUrl, "/api/ai-media-studio/publishing/preview", request(scheduledFor, `${label}-preview`));
    assert.equal(previewResponse.status, 409);
    assert.deepEqual(await previewResponse.json(), { error: "Conflict" });
    const draftResponse = await jsonPost(harness.baseUrl, "/api/ai-media-studio/publishing/jobs", {
      ...request(scheduledFor, `${label}-draft`), previewDigest: digest(scheduledFor),
    });
    assert.equal(draftResponse.status, 409);
    assert.deepEqual(await draftResponse.json(), { error: "Conflict" });
  }

  const agingAt = "2026-07-20T12:01:00.000Z";
  const agingRequest = request(agingAt, "aging-draft");
  const agingPreviewResponse = await jsonPost(harness.baseUrl, "/api/ai-media-studio/publishing/preview", agingRequest);
  assert.equal(agingPreviewResponse.status, 200);
  const agingPreview = publishingPreviewSchema.parse(((await agingPreviewResponse.json()) as { preview: unknown }).preview);
  const agingCreate = await jsonPost(harness.baseUrl, "/api/ai-media-studio/publishing/jobs", { ...agingRequest, previewDigest: agingPreview.digest });
  assert.equal(agingCreate.status, 201);
  const agingJob = publishingJobSchema.parse(((await agingCreate.json()) as { job: unknown }).job);
  now = Date.parse(agingAt);
  assert.equal((await jsonPost(harness.baseUrl, `/api/ai-media-studio/publishing/jobs/${agingJob.id}/approve`, { previewDigest: agingPreview.digest })).status, 409);
  assert.equal((await operations.publishing.get(scopeA, agingJob.id))?.state, "pending_approval");

  now = Date.parse(instant);
  const futureAt = "2026-07-20T12:02:00.000Z";
  const futureRequest = request(futureAt, "future-and-replay");
  const futurePreview = publishingPreviewSchema.parse(((await (await jsonPost(
    harness.baseUrl, "/api/ai-media-studio/publishing/preview", futureRequest,
  )).json()) as { preview: unknown }).preview);
  const futureJob = publishingJobSchema.parse(((await (await jsonPost(
    harness.baseUrl, "/api/ai-media-studio/publishing/jobs", { ...futureRequest, previewDigest: futurePreview.digest },
  )).json()) as { job: unknown }).job);
  const approvalPath = `/api/ai-media-studio/publishing/jobs/${futureJob.id}/approve`;
  const firstApproval = await jsonPost(harness.baseUrl, approvalPath, { previewDigest: futurePreview.digest });
  assert.equal(firstApproval.status, 200);
  const firstApproved = publishingJobSchema.parse(((await firstApproval.json()) as { job: unknown }).job);
  now = Date.parse(futureAt) + 1;
  const replay = await jsonPost(harness.baseUrl, approvalPath, { previewDigest: futurePreview.digest });
  assert.equal(replay.status, 200);
  const replayed = publishingJobSchema.parse(((await replay.json()) as { job: unknown }).job);
  assert.equal(replayed.approval?.decidedAt, firstApproved.approval?.decidedAt);
});

test("operations HTTP exposes redacted readiness and tenant analytics/source read models while policy remains locked", async (t) => {
  const core = coreRepositories();
  const operations = operationsRepositories();
  await seedAsset(core, scopeA.ownerUserId, "asset-a", "a".repeat(64));
  const harness = await startHarness({ core, operations });
  t.after(harness.close);

  await harness.runtime.operations.analytics.ingest(scopeA, new FakeAnalyticsIngestionAdapter({
    source: "fake-social",
    publications: [{
      providerPublicationId: "provider-publication-secret",
      videoId: null,
      mediaAssetId: "asset-a",
      platform: "tiktok",
      status: "published",
      permalink: "https://social.example/public/one",
      publishedAt: "2026-07-20T10:00:00Z",
      dimensions: { avatar: "avatar-one", hook: "question", category: "travel" },
      generationCost: { amount: 12, currency: "USD" },
    }],
    snapshots: [{
      providerPublicationId: "provider-publication-secret",
      capturedAt: "2026-07-20T11:00:00Z",
      metrics: { views: 100, impressions: 200, likes: 10, comments: 2, shares: 3, clicks: 20, watchTimeMs: 50_000, retentionRate: 0.5 },
    }],
    events: [],
  }));
  await operations.sources.upsertByContentHash(scopeA, {
    adapterKey: "manual",
    providerExternalId: "private-source-identity",
    category: "events",
    canonicalUrl: "https://events.example/public/one",
    title: "Owned weekend event",
    content: "A rights-reviewed public event summary.",
    contentHash: `sha256:${"c".repeat(64)}`,
    rightsStatus: "owned",
    moderationStatus: "approved",
    status: "accepted",
    payload: { safe: true },
  });
  await operations.sources.upsertByContentHash(scopeB, {
    adapterKey: "manual",
    providerExternalId: "other-tenant-secret",
    category: "deals",
    title: "Other tenant source",
    contentHash: `sha256:${"d".repeat(64)}`,
    rightsStatus: "owned",
    moderationStatus: "approved",
    status: "accepted",
    payload: {},
  });

  const connectionResponse = await fetch(`${harness.baseUrl}/api/ai-media-studio/publishing/connections`, {
    headers: { "x-test-user": scopeA.ownerUserId },
  });
  assert.equal(connectionResponse.status, 200);
  const connectionRaw = await connectionResponse.text();
  const connections = JSON.parse(connectionRaw) as { connections: Array<Record<string, unknown>> };
  assert.equal(connections.connections.length, 4);
  assert.equal(connections.connections.find((item) => item.platform === "tiktok")?.status, "ready");
  assert.doesNotMatch(connectionRaw, /must-not-leak|apiToken|accessToken|credential|providerAccountId/i);
  assert.deepEqual(Object.keys(connections.connections[0]).sort(), ["accountLabel", "capabilities", "checkedAt", "message", "platform", "status"]);

  const otherTenantConnections = await fetch(`${harness.baseUrl}/api/ai-media-studio/publishing/connections`, {
    headers: { "x-test-user": scopeB.ownerUserId },
  });
  assert.equal(otherTenantConnections.status, 200);
  const otherTenantReadiness = (await otherTenantConnections.json()) as { connections: Array<{ status: string; accountLabel: string | null }> };
  assert.equal(otherTenantReadiness.connections.length, 4);
  assert.ok(otherTenantReadiness.connections.every((item) => item.status === "not_connected" && item.accountLabel === null));

  const summaryResponse = await fetch(
    `${harness.baseUrl}/api/ai-media-studio/analytics/summary?platform=tiktok&from=2026-07-20T09:00:00Z&to=2026-07-20T13:00:00Z`,
    { headers: { "x-test-user": scopeA.ownerUserId } },
  );
  assert.equal(summaryResponse.status, 200);
  const summaryRaw = await summaryResponse.text();
  const summary = analyticsSummarySchema.parse((JSON.parse(summaryRaw) as { summary: unknown }).summary);
  assert.equal(summary.publicationCount, 1);
  assert.equal(summary.metrics.views, 100);
  assert.equal(summary.costPerVideoUsd, 12);
  assert.equal(summary.costPerViewUsd, 0.12);
  assert.doesNotMatch(summaryRaw, /provider-publication-secret|externalIdentity|providerPublicationId/);

  const attributionResponse = await fetch(
    `${harness.baseUrl}/api/ai-media-studio/analytics/attribution?dimension=avatar&from=2026-07-20T09:00:00Z&to=2026-07-20T13:00:00Z&limit=1`,
    { headers: { "x-test-user": scopeA.ownerUserId } },
  );
  assert.equal(attributionResponse.status, 200);
  const attributionPage = (await attributionResponse.json()) as { items: unknown[]; nextCursor: string | null; hasMore: boolean };
  assert.equal(attributionPage.items.length, 1);
  assert.doesNotThrow(() => attributionSchema.parse(attributionPage.items[0]));
  assert.equal(attributionPage.hasMore, false);

  const sourcesResponse = await fetch(`${harness.baseUrl}/api/ai-media-studio/automation/sources?limit=25`, {
    headers: { "x-test-user": scopeA.ownerUserId },
  });
  assert.equal(sourcesResponse.status, 200);
  const sourcesRaw = await sourcesResponse.text();
  const sourcePage = JSON.parse(sourcesRaw) as { items: unknown[]; nextCursor: string | null; hasMore: boolean };
  assert.equal(sourcePage.items.length, 1);
  assert.equal(sourceItemSchema.parse(sourcePage.items[0]).title, "Owned weekend event");
  assert.doesNotMatch(sourcesRaw, /private-source-identity|other-tenant-secret|adapterKey|providerExternalId|payload/);
  assert.equal((await fetch(`${harness.baseUrl}/api/ai-media-studio/automation/sources`, {
    headers: { "x-test-user": scopeB.ownerUserId },
  }).then((response) => response.json()) as { items: unknown[] }).items.length, 1);

  const policyResponse = await fetch(`${harness.baseUrl}/api/ai-media-studio/automation/policy`, {
    headers: { "x-test-user": scopeA.ownerUserId },
  });
  assert.equal(policyResponse.status, 200);
  const policy = automationPolicySchema.parse(((await policyResponse.json()) as { policy: unknown }).policy);
  assert.equal(policy.automaticPublishingEnabled, false);
  assert.equal(policy.approvalRequired, true);
  assert.equal((await fetch(`${harness.baseUrl}/api/ai-media-studio/automation/policy`, {
    method: "POST", headers: headersA, body: JSON.stringify({ automaticPublishingEnabled: true }),
  })).status, 404, "operations policy is read-only over HTTP");
});

test("operations HTTP source pagination filters before limit beyond 100 rows and binds cursors to the tenant", async (t) => {
  const core = coreRepositories();
  const operations = operationsRepositories();
  const harness = await startHarness({ core, operations });
  t.after(harness.close);

  for (let index = 0; index < 130; index += 1) {
    const selected = index >= 110;
    await operations.sources.upsertByContentHash(scopeA, {
      adapterKey: "http-pagination-fixture",
      providerExternalId: `tenant-a-provider-${index}`,
      category: selected ? "deals" : "events",
      title: `Tenant A source ${index}`,
      contentHash: `sha256:${index.toString(16).padStart(64, "0")}`,
      rightsStatus: selected ? "owned" : "unknown",
      moderationStatus: "pending",
      status: selected ? "accepted" : "discovered",
      payload: {},
    });
  }
  for (let index = 0; index < 5; index += 1) {
    await operations.sources.upsertByContentHash(scopeB, {
      adapterKey: "http-pagination-fixture",
      providerExternalId: `tenant-b-secret-${index}`,
      category: "deals",
      title: `Other tenant source ${index}`,
      contentHash: `sha256:${(1_000 + index).toString(16).padStart(64, "0")}`,
      rightsStatus: "owned",
      moderationStatus: "approved",
      status: "accepted",
      payload: {},
    });
  }

  const seen = new Set<string>();
  let cursor: string | null = null;
  let firstCursor: string | null = null;
  do {
    const query = new URLSearchParams({ status: "accepted", rightsStatus: "owned", limit: "7" });
    if (cursor) query.set("cursor", cursor);
    const response = await fetch(`${harness.baseUrl}/api/ai-media-studio/automation/sources?${query}`, {
      headers: { "x-test-user": scopeA.ownerUserId },
    });
    assert.equal(response.status, 200);
    const raw = await response.text();
    assert.doesNotMatch(raw, /tenant-b-secret|providerExternalId|adapterKey|payload/);
    const page = JSON.parse(raw) as { items: unknown[]; nextCursor: string | null; hasMore: boolean };
    for (const item of page.items) seen.add(sourceItemSchema.parse(item).id);
    firstCursor ??= page.nextCursor;
    assert.equal(page.hasMore, page.nextCursor !== null);
    cursor = page.nextCursor;
  } while (cursor);
  assert.equal(seen.size, 20, "matches after row 100 must remain reachable");
  assert.ok(firstCursor);

  const crossTenantCursor = await fetch(
    `${harness.baseUrl}/api/ai-media-studio/automation/sources?status=accepted&rightsStatus=owned&limit=7&cursor=${encodeURIComponent(firstCursor)}`,
    { headers: { "x-test-user": scopeB.ownerUserId } },
  );
  assert.equal(crossTenantCursor.status, 400);
  assert.deepEqual(await crossTenantCursor.json(), { error: "Invalid source cursor", code: "SOURCE_CURSOR_INVALID" });

  const strictQuery = await fetch(`${harness.baseUrl}/api/ai-media-studio/automation/sources?limit=7&unexpected=true`, {
    headers: { "x-test-user": scopeA.ownerUserId },
  });
  assert.equal(strictQuery.status, 400);
});

test("production operations without a database return 503 instead of silently using memory", async (t) => {
  const core = coreRepositories();
  const harness = await startHarness({ core, productionWithoutDatabase: true });
  t.after(harness.close);

  for (const path of [
    "/api/ai-media-studio/publishing/jobs",
    "/api/ai-media-studio/publishing/connections",
    "/api/ai-media-studio/analytics/summary",
    "/api/ai-media-studio/automation/sources",
    "/api/ai-media-studio/automation/policy",
  ]) {
    const response = await fetch(`${harness.baseUrl}${path}`, { headers: { "x-test-user": scopeA.ownerUserId } });
    assert.equal(response.status, 503, path);
    assert.equal(response.headers.get("x-ai-media-studio-operations"), "unavailable");
    assert.match((await response.json() as { code: string }).code, /persistence_unavailable/);
  }
  assert.equal(harness.runtime.operations.status.available, false);
  assert.equal(harness.runtime.operations.status.durable, false);
});
