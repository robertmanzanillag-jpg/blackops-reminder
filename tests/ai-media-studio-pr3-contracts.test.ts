import assert from "node:assert/strict";
import test from "node:test";
import { getTableColumns } from "drizzle-orm";
import { getTableConfig } from "drizzle-orm/pg-core";

import {
  analyticsSnapshotSchema,
  analyticsSummarySchema,
  approvalEvidenceSchema,
  automationPolicySchema,
  createPublishingJobRequestSchema,
  orchestrationRunSchema,
  publicationAnalyticsMappingSchema,
  publicationSchema,
  publishingJobListRequestSchema,
  publishingPreviewSchema,
  sourceIntakeSchema,
} from "../shared/ai-media-studio-operations";
import { aiMediaOrchestrationRuns, aiMediaOutbox } from "../shared/models/ai-media-studio-db";

const now = "2026-07-20T12:00:00.000Z";
const later = "2026-07-21T12:00:00.000Z";
const digest = `sha256:${"a".repeat(64)}`;

test("publishing accepts all supported platforms and requires the immutable preview digest", () => {
  for (const platform of ["tiktok", "instagram", "facebook", "youtube_shorts"] as const) {
    const parsed = createPublishingJobRequestSchema.parse({
      mediaAssetId: "asset-1",
      platform,
      caption: "A provider-neutral caption",
      hashtags: ["#travel", "nightlife"],
      timezone: "America/New_York",
      schedule: { mode: "scheduled", scheduledFor: later, timezone: "America/New_York" },
      previewDigest: digest,
      idempotencyKey: `publish-${platform}`,
    });
    assert.equal(parsed.platform, platform);
    assert.equal(parsed.previewDigest, digest);
  }
  assert.equal(createPublishingJobRequestSchema.safeParse({
    mediaAssetId: "asset-1",
    platform: "x",
    caption: "caption",
    hashtags: [],
    timezone: null,
    schedule: { mode: "manual", scheduledFor: null, timezone: null },
    previewDigest: digest,
    idempotencyKey: "publish-x",
  }).success, false);
  assert.equal(createPublishingJobRequestSchema.safeParse({
    mediaAssetId: "asset-1",
    platform: "tiktok",
    caption: "caption",
    hashtags: ["not a hashtag"],
    timezone: "UTC",
    schedule: { mode: "scheduled", scheduledFor: later, timezone: "America/New_York" },
    previewDigest: digest,
    idempotencyKey: "publish-timezone-mismatch",
  }).success, false);
});

test("approval evidence is cryptographically bound to a strict preview", () => {
  const preview = {
    digest,
    mediaAssetId: "asset-1",
    platform: "instagram",
    caption: "Approved copy",
    hashtags: ["#approved"],
    title: null,
    scheduledFor: later,
    timezone: "America/New_York",
    generatedAt: now,
  };
  assert.deepEqual(publishingPreviewSchema.parse(preview), preview);
  assert.equal(approvalEvidenceSchema.parse({
    decision: "approved",
    actorId: "user-1",
    decidedAt: now,
    previewDigest: digest,
    reason: null,
  }).previewDigest, digest);
  assert.equal(publishingPreviewSchema.safeParse({ ...preview, digest: "mutable" }).success, false);
});

test("automatic mode exists but the current policy cannot enable it", () => {
  const policy = {
    automaticPublishingEnabled: false,
    approvalRequired: true,
    policyVersion: "pr3",
    evaluatedAt: now,
    reason: "Human approval is mandatory",
  } as const;
  assert.deepEqual(automationPolicySchema.parse(policy), policy);
  assert.equal(automationPolicySchema.safeParse({ ...policy, automaticPublishingEnabled: true }).success, false);
  assert.equal(automationPolicySchema.safeParse({ ...policy, approvalRequired: false }).success, false);
  assert.equal(orchestrationRunSchema.safeParse({
    id: "run-1",
    sourceItemId: null,
    runType: "publish",
    mode: "automatic",
    status: "queued",
    policy,
    idempotencyKey: "run-publish-1",
    dueAt: null,
    attempts: 0,
    createdAt: now,
    updatedAt: now,
  }).success, true);
});

test("public operations contracts reject provider internals and secrets", () => {
  const publication = {
    id: "publication-1",
    videoId: null,
    mediaAssetId: "asset-1",
    platform: "tiktok",
    status: "published",
    permalink: "https://example.com/publications/1",
    publishedAt: now,
    createdAt: now,
    updatedAt: now,
  };
  assert.deepEqual(publicationSchema.parse(publication), publication);
  assert.equal(publicationSchema.safeParse({ ...publication, videoId: "video-1", mediaAssetId: null }).success, true);
  assert.equal(publicationSchema.safeParse({ ...publication, videoId: null, mediaAssetId: null }).success, false);
  for (const unsafeField of ["publishingJobId", "externalPublicationId", "providerAccountId", "accessToken", "secretRef", "rawPayload"]) {
    assert.equal(publicationSchema.safeParse({ ...publication, [unsafeField]: "must-not-leak" }).success, false);
  }
});

test("analytics contracts validate bounded metrics and windows", () => {
  const metrics = {
    views: 10, impressions: 20, likes: 2, comments: 1, shares: 1, clicks: 3, watchTimeMs: 5_000,
    ctr: 0.15, retentionRate: 0.6,
  };
  assert.equal(analyticsSnapshotSchema.parse({
    id: "snapshot-1",
    publicationId: "publication-1",
    platform: "youtube_shorts",
    capturedAt: now,
    metrics,
  }).metrics.views, 10);
  assert.equal(analyticsSummarySchema.safeParse({
    window: { from: later, to: now },
    platform: null,
    publicationCount: 1,
    metrics,
    engagementRate: 0.2,
    averageWatchTimeMs: 500,
    costPerVideoUsd: 1.25,
    costPerViewUsd: 0.125,
    currency: "USD",
  }).success, false);
  assert.equal(analyticsSnapshotSchema.safeParse({
    id: "snapshot-1", publicationId: "publication-1", platform: "tiktok", capturedAt: now,
    metrics: { ...metrics, views: -1 },
  }).success, false);

  assert.equal(analyticsSummarySchema.safeParse({
    window: { from: now, to: later }, platform: null, publicationCount: 1,
    metrics: { ...metrics, views: 0 }, engagementRate: null, averageWatchTimeMs: null,
    costPerVideoUsd: 1.25, costPerViewUsd: 1.25, currency: "USD",
  }).success, false);
  assert.equal(analyticsSummarySchema.safeParse({
    window: { from: now, to: later }, platform: null, publicationCount: 1,
    metrics: { ...metrics, views: 0 }, engagementRate: null, averageWatchTimeMs: null,
    costPerVideoUsd: 1.25, costPerViewUsd: null, currency: "USD",
  }).success, true);
});

test("analytics mapping uses only canonical video and media IDs", () => {
  const mapping = { publicationId: "publication-1", videoId: null, mediaAssetId: "asset-1", platform: "facebook" };
  assert.deepEqual(publicationAnalyticsMappingSchema.parse(mapping), mapping);
  assert.equal(publicationAnalyticsMappingSchema.safeParse({ ...mapping, publishingJobId: "job-1" }).success, false);
  assert.equal(publicationAnalyticsMappingSchema.safeParse({ ...mapping, mediaAssetId: null }).success, false);
});

test("source intake requires safe provenance and rejects opaque provider fields", () => {
  const intake = {
    sourceType: "owned_library",
    canonicalUrl: "https://example.com/source/1",
    title: "Owned source",
    content: null,
    contentHash: digest,
    rightsStatus: "owned",
    idempotencyKey: "source-1",
  };
  assert.deepEqual(sourceIntakeSchema.parse(intake), intake);
  assert.equal(sourceIntakeSchema.safeParse({ ...intake, externalId: "provider-raw-id" }).success, false);
  assert.equal(sourceIntakeSchema.safeParse({ ...intake, canonicalUrl: null, content: null }).success, false);
});

test("pagination is bounded and rejects unknown query fields", () => {
  assert.deepEqual(publishingJobListRequestSchema.parse({}), { limit: 25 });
  assert.equal(publishingJobListRequestSchema.safeParse({ limit: 101 }).success, false);
  assert.equal(publishingJobListRequestSchema.safeParse({ limit: 25, offset: 0 }).success, false);
});

test("orchestration storage exposes durable CAS version and state payload columns", () => {
  const columns = getTableColumns(aiMediaOrchestrationRuns);
  assert.equal(columns.stateVersion.name, "state_version");
  assert.equal(columns.stateVersion.notNull, true);
  assert.equal(columns.runPayload.name, "run_payload");
  assert.equal(columns.runPayload.notNull, true);
});

test("orchestration storage enforces one canonical run per tenant source", () => {
  const sourceIndex = getTableConfig(aiMediaOrchestrationRuns).indexes.find(
    (index) => index.config.name === "ai_media_orchestration_runs_owner_workspace_source_uq",
  );
  assert.ok(sourceIndex);
  assert.equal(sourceIndex.config.unique, true);
  assert.ok(sourceIndex.config.where, "nullable source IDs use an explicit partial unique predicate");
  assert.deepEqual(
    sourceIndex.config.columns.map((column) => "name" in column ? column.name : undefined),
    ["owner_user_id", "workspace_id", "source_item_id"],
  );
});

test("outbox storage exposes durable fencing and lease recovery columns", () => {
  const columns = getTableColumns(aiMediaOutbox);
  assert.equal(columns.leaseOwner.name, "lease_owner");
  assert.equal(columns.leaseExpiresAt.name, "lease_expires_at");
  assert.equal(columns.fencingToken.name, "fencing_token");
  assert.equal(columns.fencingToken.notNull, true);
  assert.equal(columns.deadLetterAt.name, "dead_letter_at");
});
