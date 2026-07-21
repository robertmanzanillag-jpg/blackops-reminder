import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { createServer } from "node:http";
import test from "node:test";
import express, { type Request } from "express";
import { createGenerationResponseSchema, mediaJobResponseSchema, mediaJobsResponseSchema, mediaStudioOptionsResponseSchema } from "../shared/ai-media-studio";
import { generateScriptVariantsResponseSchema } from "../shared/ai-media-studio-scripts";
import { createAiMediaStudioRuntime } from "../server/ai-media-studio/routes";
import { InMemoryMediaJobRepository } from "../server/ai-media-studio/in-memory";
import { FakeVideoProvider } from "../server/ai-media-studio/providers/fake-video-provider";
import { InMemoryAssetIngestRepository } from "../server/ai-media-studio/assets";
import { PublishingPolicyDeniedError, type PublicationJob } from "../server/ai-media-studio/publishing";
import type { VideoProvider } from "../server/ai-media-studio/ports";

class LiveRuntimeProvider implements VideoProvider {
  readonly key = "live-runtime";
  readonly providerAccountId = "00000000-0000-4000-8000-0000000000f1";
  async status() { return { key: this.key, configured: true, healthy: true, mode: "live" as const }; }
  async submit() { return { providerJobId: "live-runtime-job", status: "rendering" as const }; }
  async cancel() {}
  parseWebhook(): never { throw new Error("not used"); }
}

test("runtime wiring does not infer live ingest-worker readiness from repository presence", async () => {
  const provider = new LiveRuntimeProvider();
  const input = {
    influencerId: "emily-food", script: "A live readiness probe.", voiceId: "voice-emily-en",
    language: "en", aspectRatio: "9:16" as const, idempotencyKey: "live-runtime-readiness-001",
  };
  const base = {
    repository: new InMemoryMediaJobRepository(), providers: [provider], defaultProviderKey: provider.key,
    assetIngestRepository: new InMemoryAssetIngestRepository(), runtimeEnvironment: "test",
  };
  const blocked = createAiMediaStudioRuntime(base);
  await assert.rejects(blocked.service.createGeneration("user-a", input), /ingest worker is not ready/i);
  const allowed = createAiMediaStudioRuntime({
    ...base,
    repository: new InMemoryMediaJobRepository(),
    assetIngestWorkerReadiness: { isReady: async () => true },
  });
  assert.equal((await allowed.service.createGeneration("user-a", input)).status, "rendering");
});

test("production account webhook route fails closed when no endpoint resolver is injected", async (t) => {
  const app = express();
  app.use(express.json({ verify: (req, _res, buffer) => { (req as Request & { rawBody?: Buffer }).rawBody = Buffer.from(buffer); } }));
  const runtime = createAiMediaStudioRuntime({
    repository: new InMemoryMediaJobRepository(),
    runtimeEnvironment: "production",
    operations: { runtimeEnvironment: "test" },
  });
  app.use(runtime.router);
  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const response = await fetch(`http://127.0.0.1:${address.port}/api/ai-media-studio/webhooks/providers/fake/accounts/endpoint-0123456789012345`, {
    method: "POST",
    headers: { "content-type": "application/json", "heygen-signature": "untrusted" },
    body: JSON.stringify({ event_id: "event-1" }),
  });
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { error: "Webhook endpoint unavailable" });

  const defaultProductionRuntime = createAiMediaStudioRuntime({
    repository: new InMemoryMediaJobRepository(),
    runtimeEnvironment: "production",
    operations: { runtimeEnvironment: "test" },
  });
  assert.deepEqual((await defaultProductionRuntime.service.dashboard("user-a")).providers.map((provider) => provider.key), ["heygen"]);
});

test("production rejects fake provider composition even when explicitly injected", () => {
  assert.throws(
    () => createAiMediaStudioRuntime({
      repository: new InMemoryMediaJobRepository(),
      providers: [new FakeVideoProvider({ autoComplete: false })],
      defaultProviderKey: "fake",
      runtimeEnvironment: "production",
      operations: { runtimeEnvironment: "test" },
    }),
    /Fake video provider is not allowed in production/,
  );
});

function signature(body: string, secret: string): string {
  return createHmac("sha256", secret).update(body).digest("hex");
}

test("AI Media Studio HTTP routes enforce auth, schemas and signed webhook transitions", async (t) => {
  const previousDevFallback = process.env.ALLOW_DEV_USER_FALLBACK;
  process.env.ALLOW_DEV_USER_FALLBACK = "false";
  t.after(() => {
    if (previousDevFallback === undefined) delete process.env.ALLOW_DEV_USER_FALLBACK;
    else process.env.ALLOW_DEV_USER_FALLBACK = previousDevFallback;
  });

  const app = express();
  app.use(express.json({ verify: (req, _res, buffer) => { (req as Request & { rawBody?: Buffer }).rawBody = Buffer.from(buffer); } }));
  app.use((req, _res, next) => {
    const userId = req.get("x-test-user");
    if (userId) (req as Request & { user?: { id: string } }).user = { id: userId };
    next();
  });
  const secret = "route-test-webhook-secret";
  const providerAccountId = "00000000-0000-4000-8000-0000000000f0";
  const endpointKey = "route-endpoint-0123456789ab";
  const runtime = createAiMediaStudioRuntime({
    repository: new InMemoryMediaJobRepository(),
    providers: [new FakeVideoProvider({ autoComplete: false, providerAccountId })],
    defaultProviderKey: "fake",
    runtimeEnvironment: "test",
    resolveProviderWebhookAccount: async ({ providerKey, endpointKey: requestedEndpoint }) => requestedEndpoint === endpointKey
      ? {
          providerKey,
          endpointKey: requestedEndpoint,
          providerAccountId,
          tenant: { ownerUserId: "user-a", workspaceId: "personal" },
          secrets: [{ value: secret, state: "active" }],
        }
      : undefined,
    allowedAssetHosts: new Set(["cdn.example.com"]),
    operations: { runtimeEnvironment: "test" },
  });
  app.use(runtime.router);
  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const baseUrl = `http://127.0.0.1:${address.port}`;
  const jsonHeaders = { "content-type": "application/json", "x-test-user": "user-a" };

  const unauthorized = await fetch(`${baseUrl}/api/ai-media-studio/jobs`);
  assert.equal(unauthorized.status, 401);
  assert.deepEqual(await unauthorized.json(), { error: "Authentication required" });
  const optionsResponse = await fetch(`${baseUrl}/api/ai-media-studio/options`, { headers: { "x-test-user": "user-a" } });
  const optionsJson = await optionsResponse.json();
  assert.doesNotThrow(() => mediaStudioOptionsResponseSchema.parse(optionsJson));

  const invalid = await fetch(`${baseUrl}/api/ai-media-studio/generations`, { method: "POST", headers: jsonHeaders, body: "{}" });
  assert.equal(invalid.status, 400);

  const generationBody = {
    influencerId: "emily-food", script: "A grounded Miami restaurant recommendation.", voiceId: "voice-emily-en",
    language: "en", aspectRatio: "9:16", idempotencyKey: "route-generation-001",
  };
  const createdResponse = await fetch(`${baseUrl}/api/ai-media-studio/generations`, { method: "POST", headers: jsonHeaders, body: JSON.stringify(generationBody) });
  assert.equal(createdResponse.status, 202);
  const created = createGenerationResponseSchema.parse(await createdResponse.json());
  assert.equal(created.job.influencerName, "Emily");
  assert.equal(created.job.status, "rendering");

  const jobsA = mediaJobsResponseSchema.parse(await (await fetch(`${baseUrl}/api/ai-media-studio/jobs`, { headers: { "x-test-user": "user-a" } })).json());
  const jobsB = mediaJobsResponseSchema.parse(await (await fetch(`${baseUrl}/api/ai-media-studio/jobs`, { headers: { "x-test-user": "user-b" } })).json());
  assert.equal(jobsA.jobs.length, 1);
  assert.equal(jobsB.jobs.length, 0);

  const webhookBody = JSON.stringify({ event_type: "avatar_video.success", event_data: { video_id: created.job.id, video_url: "https://cdn.example.com/render.mp4" } });
  const timestamp = String(Math.floor(Date.now() / 1_000));
  const invalidWebhook = await fetch(`${baseUrl}/api/ai-media-studio/webhooks/providers/fake/accounts/${endpointKey}`, {
    method: "POST", headers: { "content-type": "application/json", "heygen-signature": "bad", "heygen-timestamp": timestamp, "heygen-event-id": "route-event-1" }, body: webhookBody,
  });
  assert.equal(invalidWebhook.status, 401);
  assert.equal((await runtime.service.getJob("user-a", created.jobId)).status, "rendering");

  const internalJob = await runtime.service.getJob("user-a", created.jobId);
  const validWebhookBody = JSON.stringify({ event_type: "avatar_video.success", event_data: { video_id: internalJob.providerJobId, video_url: "https://cdn.example.com/render.mp4" } });
  const validWebhook = await fetch(`${baseUrl}/api/ai-media-studio/webhooks/providers/fake/accounts/${endpointKey}`, {
    method: "POST", headers: { "content-type": "application/json", "heygen-signature": signature(validWebhookBody, secret), "heygen-timestamp": timestamp, "heygen-event-id": "route-event-2" }, body: validWebhookBody,
  });
  assert.equal(validWebhook.status, 202);
  const replayWithChangedUnsignedHeaders = await fetch(`${baseUrl}/api/ai-media-studio/webhooks/providers/fake/accounts/${endpointKey}`, {
    method: "POST", headers: { "content-type": "application/json", "heygen-signature": signature(validWebhookBody, secret), "heygen-timestamp": "0", "heygen-event-id": "attacker-changed-id" }, body: validWebhookBody,
  });
  assert.equal(replayWithChangedUnsignedHeaders.status, 202);
  assert.equal((await replayWithChangedUnsignedHeaders.json() as { duplicate?: boolean }).duplicate, true);
  const providerOnlyLegacyRoute = await fetch(`${baseUrl}/api/ai-media-studio/webhooks/providers/fake`, {
    method: "POST", headers: { "content-type": "application/json", "heygen-signature": signature(validWebhookBody, secret) }, body: validWebhookBody,
  });
  assert.equal(providerOnlyLegacyRoute.status, 404);
  const detail = mediaJobResponseSchema.parse(await (await fetch(`${baseUrl}/api/ai-media-studio/jobs/${created.jobId}`, { headers: { "x-test-user": "user-a" } })).json());
  assert.equal(detail.job.status, "rendering");
  assert.equal(detail.job.stage, "artifact_ingest_queued");
  assert.equal(detail.job.asset, undefined);
  assert.doesNotMatch(JSON.stringify(detail), /cdn\.example\.com|render\.mp4/);
  assert.equal((await fetch(`${baseUrl}/api/ai-media-studio/jobs/${created.jobId}/cancel`, { method: "POST", headers: { "x-test-user": "user-a" } })).status, 409);

  const unknownBody = JSON.stringify({ event_type: "avatar_video.success", event_data: { video_id: "unknown" } });
  const unknown = await fetch(`${baseUrl}/api/ai-media-studio/webhooks/providers/unknown/accounts/${endpointKey}`, {
    method: "POST", headers: { "content-type": "application/json", "heygen-signature": signature(unknownBody, secret), "heygen-timestamp": timestamp, "heygen-event-id": "unknown-event" }, body: unknownBody,
  });
  assert.equal(unknown.status, 404);

  const retryCreate = await fetch(`${baseUrl}/api/ai-media-studio/generations`, {
    method: "POST", headers: jsonHeaders, body: JSON.stringify({ ...generationBody, idempotencyKey: "route-generation-002" }),
  });
  const retryTarget = createGenerationResponseSchema.parse(await retryCreate.json());
  const retryInternal = await runtime.service.getJob("user-a", retryTarget.jobId);
  const failedBody = JSON.stringify({ event_type: "avatar_video.fail", event_data: { video_id: retryInternal.providerJobId, message: "render failed" } });
  const failedWebhook = await fetch(`${baseUrl}/api/ai-media-studio/webhooks/providers/fake/accounts/${endpointKey}`, {
    method: "POST", headers: { "content-type": "application/json", "heygen-signature": signature(failedBody, secret), "heygen-timestamp": timestamp, "heygen-event-id": "route-event-failed" }, body: failedBody,
  });
  assert.equal(failedWebhook.status, 202);
  const retried = mediaJobResponseSchema.parse(await (await fetch(`${baseUrl}/api/ai-media-studio/jobs/${retryTarget.jobId}/retry`, { method: "POST", headers: { "x-test-user": "user-a" } })).json());
  assert.equal(retried.job.status, "rendering");
  assert.equal(retried.job.attempt, 2);
  const cancelled = mediaJobResponseSchema.parse(await (await fetch(`${baseUrl}/api/ai-media-studio/jobs/${retryTarget.jobId}/cancel`, { method: "POST", headers: { "x-test-user": "user-a" } })).json());
  assert.equal(cancelled.job.status, "cancelled");

  const scripts = await fetch(`${baseUrl}/api/ai-media-studio/scripts/generate`, {
    method: "POST", headers: jsonHeaders,
    body: JSON.stringify({ source: { type: "events", id: "event-1", title: "Miami Weekend", summary: "A public event summary." }, language: "en", variantCount: 2 }),
  });
  assert.equal(scripts.status, 200);
  assert.equal(generateScriptVariantsResponseSchema.parse(await scripts.json()).scriptSet.variants.length, 2);

  const profilePath = `${baseUrl}/api/ai-media-studio/governance/influencers/emily-food/profile`;
  const seededProfileResponse = await fetch(profilePath, { headers: { "x-test-user": "user-a" } });
  assert.equal(seededProfileResponse.status, 200);
  const seededProfileJson = await seededProfileResponse.json() as { profile: Record<string, unknown> };
  assert.equal(seededProfileJson.profile.policyVersion, "sample-fixture-v1");
  assert.doesNotMatch(JSON.stringify(seededProfileJson), /ownerUserId|createdByUserId|proofDigest|evidenceDigest|avatar-emily|voice-emily/);

  const profileBody = {
    consentBasis: "obtained", rightsBasis: "licensed", allowedUses: ["internal_preview", "organic_social"], territories: ["WORLDWIDE"],
    validFrom: "2026-01-01T00:00:00.000Z", expiresAt: "2035-01-01T00:00:00.000Z", policyVersion: "route-governance-v2",
    proofDigest: `sha256:${"a".repeat(64)}`, brandPolicy: { requiredTerms: [], prohibitedTerms: ["forbidden claim"] }, idempotencyKey: "profile-route-v2",
  };
  const forgedIdentity = await fetch(profilePath, {
    method: "POST", headers: jsonHeaders, body: JSON.stringify({ ...profileBody, influencerId: "attacker-choice" }),
  });
  assert.equal(forgedIdentity.status, 400);
  const updatedProfileResponse = await fetch(profilePath, { method: "POST", headers: jsonHeaders, body: JSON.stringify(profileBody) });
  assert.equal(updatedProfileResponse.status, 201);
  assert.doesNotMatch(JSON.stringify(await updatedProfileResponse.json()), /proofDigest|evidenceDigest|createdByUserId|avatar-emily/);

  const checksum = "b".repeat(64);
  await runtime.core.repositories.assets.createOrGet({
    id: "governed-asset", ownerUserId: "user-a", workspaceId: runtime.core.workspaceId, type: "video", name: "Governed render", status: "ready",
    mimeType: "video/mp4", sizeBytes: 1_024, checksumSha256: checksum, storageProvider: "owned-object-storage", storageKey: "assets/governed.mp4",
    deliveryUrl: null, thumbnailUrl: null, projectId: null, renderJobId: null, influencerId: "emily-food", providerResourceId: null,
    source: { kind: "remote" }, metadata: { width: 1080, height: 1920 }, createdAt: "2026-07-20T12:00:00.000Z",
    updatedAt: "2026-07-20T12:00:00.000Z", deletedAt: null,
  });
  const previewBody = {
    mediaAssetId: "governed-asset", platform: "tiktok", caption: "A safe reviewed caption", hashtags: ["safe"], title: "Reviewed",
    timezone: null, schedule: { mode: "manual", scheduledFor: null, timezone: null }, idempotencyKey: "governed-preview-1",
  };
  const missingReview = await fetch(`${baseUrl}/api/ai-media-studio/publishing/preview`, { method: "POST", headers: jsonHeaders, body: JSON.stringify(previewBody) });
  assert.equal(missingReview.status, 403);
  assert.deepEqual((await missingReview.json() as { reasons: string[] }).reasons, ["quality_review_missing"]);

  await runtime.core.repositories.assets.createOrGet({
    id: "governed-script-asset", ownerUserId: "user-a", workspaceId: runtime.core.workspaceId, type: "script", name: "Reviewed script", status: "ready",
    mimeType: "text/plain", sizeBytes: 128, checksumSha256: "c".repeat(64), storageProvider: "owned-object-storage", storageKey: "assets/script.txt",
    deliveryUrl: null, thumbnailUrl: null, projectId: null, renderJobId: null, influencerId: "emily-food", providerResourceId: null,
    source: { kind: "text" }, metadata: {}, createdAt: "2026-07-20T12:00:00.000Z",
    updatedAt: "2026-07-20T12:00:00.000Z", deletedAt: null,
  });
  const nonVideoReview = await fetch(`${baseUrl}/api/ai-media-studio/governance/assets/governed-script-asset/quality-review`, {
    method: "POST", headers: jsonHeaders, body: JSON.stringify({ criteria: {
      naturalMovement: 5, eyeContact: 5, speechQuality: 5, lighting: 5, realism: 5, brandConsistency: 5, verticalQuality: 5,
    }, idempotencyKey: "quality-route-non-video-1" }),
  });
  assert.equal(nonVideoReview.status, 400);
  const nonVideoPreview = await fetch(`${baseUrl}/api/ai-media-studio/publishing/preview`, {
    method: "POST", headers: jsonHeaders,
    body: JSON.stringify({ ...previewBody, mediaAssetId: "governed-script-asset", idempotencyKey: "preview-non-video-denied" }),
  });
  assert.equal(nonVideoPreview.status, 400);

  await runtime.core.repositories.assets.createOrGet({
    id: "governed-deleted-video", ownerUserId: "user-a", workspaceId: runtime.core.workspaceId, type: "video", name: "Deleted video", status: "ready",
    mimeType: "video/mp4", sizeBytes: 256, checksumSha256: "d".repeat(64), storageProvider: "owned-object-storage", storageKey: "assets/deleted.mp4",
    deliveryUrl: null, thumbnailUrl: null, projectId: null, renderJobId: null, influencerId: "emily-food", providerResourceId: null,
    source: { kind: "remote" }, metadata: {}, createdAt: "2026-07-20T12:00:00.000Z", updatedAt: "2026-07-20T12:01:00.000Z",
    deletedAt: "2026-07-20T12:01:00.000Z",
  });
  const deletedReview = await fetch(`${baseUrl}/api/ai-media-studio/governance/assets/governed-deleted-video/quality-review`, {
    method: "POST", headers: jsonHeaders,
    body: JSON.stringify({ criteria: { naturalMovement: 5, eyeContact: 5, speechQuality: 5, lighting: 5, realism: 5, brandConsistency: 5, verticalQuality: 5 }, idempotencyKey: "quality-deleted-denied" }),
  });
  assert.equal(deletedReview.status, 400);
  const deletedPreview = await fetch(`${baseUrl}/api/ai-media-studio/publishing/preview`, {
    method: "POST", headers: jsonHeaders,
    body: JSON.stringify({ ...previewBody, mediaAssetId: "governed-deleted-video", idempotencyKey: "preview-deleted-denied" }),
  });
  assert.equal(deletedPreview.status, 400);

  const reviewPath = `${baseUrl}/api/ai-media-studio/governance/assets/governed-asset/quality-review`;
  const approvedCriteria = { naturalMovement: 5, eyeContact: 5, speechQuality: 5, lighting: 5, realism: 5, brandConsistency: 5, verticalQuality: 5 };
  const approvedReview = await fetch(reviewPath, {
    method: "POST", headers: jsonHeaders, body: JSON.stringify({ criteria: approvedCriteria, notes: "Human-reviewed fixture", idempotencyKey: "quality-route-approved-1" }),
  });
  assert.equal(approvedReview.status, 201);
  const approvedReviewJson = await approvedReview.json() as { review: Record<string, unknown> };
  assert.equal(approvedReviewJson.review.status, "approved");
  assert.doesNotMatch(JSON.stringify(approvedReviewJson), /assetChecksum|reviewedByUserId|evidenceDigest|ownerUserId/);
  const governedPreviewResponse = await fetch(`${baseUrl}/api/ai-media-studio/publishing/preview`, {
    method: "POST", headers: jsonHeaders, body: JSON.stringify(previewBody),
  });
  assert.equal(governedPreviewResponse.status, 200);
  const governedPreview = await governedPreviewResponse.json() as { preview: { digest: string } };
  const governedDraftResponse = await fetch(`${baseUrl}/api/ai-media-studio/publishing/jobs`, {
    method: "POST", headers: jsonHeaders,
    body: JSON.stringify({ ...previewBody, previewDigest: governedPreview.preview.digest }),
  });
  assert.equal(governedDraftResponse.status, 201);
  const governedDraft = await governedDraftResponse.json() as { job: { id: string } };
  const needsReview = await fetch(reviewPath, {
    method: "POST", headers: jsonHeaders,
    body: JSON.stringify({ criteria: { ...approvedCriteria, realism: 3 }, notes: "Replacement review needs work", idempotencyKey: "quality-route-needs-review-2" }),
  });
  assert.equal(needsReview.status, 201);
  const qualityDeniedApproval = await fetch(`${baseUrl}/api/ai-media-studio/publishing/jobs/${governedDraft.job.id}/approve`, {
    method: "POST", headers: jsonHeaders, body: JSON.stringify({ previewDigest: governedPreview.preview.digest }),
  });
  assert.equal(qualityDeniedApproval.status, 403);
  assert.deepEqual((await qualityDeniedApproval.json() as { reasons: string[] }).reasons, ["quality_review_not_approved"]);
  const restoredReview = await fetch(reviewPath, {
    method: "POST", headers: jsonHeaders,
    body: JSON.stringify({ criteria: approvedCriteria, notes: "Replacement review approved", idempotencyKey: "quality-route-approved-3" }),
  });
  assert.equal(restoredReview.status, 201);

  const revokedProfile = await fetch(`${profilePath}/revoke`, {
    method: "POST", headers: jsonHeaders, body: JSON.stringify({ reason: "Consent withdrawn", idempotencyKey: "profile-route-revoke-1" }),
  });
  assert.equal(revokedProfile.status, 200);
  const governedPublication = await runtime.operations.publishing.get(
    { ownerUserId: "user-a", workspaceId: runtime.core.workspaceId },
    governedDraft.job.id,
  );
  assert.ok(governedPublication);
  await assert.rejects(
    runtime.publishingSubmissionGate.assertCanSubmit({
      scope: { ownerUserId: "user-a", workspaceId: runtime.core.workspaceId },
      preview: governedPublication.preview,
    } as PublicationJob),
    PublishingPolicyDeniedError,
  );
  const deniedApproval = await fetch(`${baseUrl}/api/ai-media-studio/publishing/jobs/${governedDraft.job.id}/approve`, {
    method: "POST", headers: jsonHeaders, body: JSON.stringify({ previewDigest: governedPreview.preview.digest }),
  });
  assert.equal(deniedApproval.status, 403);
  assert.deepEqual((await deniedApproval.json() as { reasons: string[] }).reasons, ["profile_revoked"]);
  const jobsBeforeDeniedGeneration = (await runtime.service.listJobs("user-a")).length;
  const deniedGeneration = await fetch(`${baseUrl}/api/ai-media-studio/generations`, {
    method: "POST", headers: jsonHeaders, body: JSON.stringify({ ...generationBody, idempotencyKey: "route-generation-governance-denied" }),
  });
  assert.equal(deniedGeneration.status, 403);
  assert.deepEqual((await deniedGeneration.json() as { reasons: string[] }).reasons, ["profile_revoked"]);
  assert.equal((await runtime.service.listJobs("user-a")).length, jobsBeforeDeniedGeneration);
});
