import { z } from "zod";

/**
 * Public, provider-neutral contracts for publishing, measurement, and intake.
 *
 * Every ID is owned by AI Media Studio. Provider-native IDs, credentials,
 * tokens, webhook payloads, and secret references are intentionally excluded.
 */

const canonicalIdSchema = z.string().trim().min(1).max(128).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);
const isoDateSchema = z.string().datetime({ offset: true });
const sha256DigestSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const nonNegativeIntegerSchema = z.number().int().nonnegative();
const optionalWindowSchema = z
  .object({ from: isoDateSchema, to: isoDateSchema })
  .strict()
  .refine(({ from, to }) => Date.parse(from) <= Date.parse(to), { message: "from must not be after to", path: ["to"] });

export const socialPlatformSchema = z.enum(["tiktok", "instagram", "facebook", "youtube_shorts"]);
export const publishingModeSchema = z.enum(["manual", "scheduled", "automatic"]);
export const publishingJobStatusSchema = z.enum([
  "pending_approval",
  "scheduled",
  "queued",
  "publishing",
  "published",
  "failed",
  "dead_letter",
  "cancelled",
]);
export const publicationStatusSchema = z.enum(["published", "unavailable", "removed"]);
export const approvalDecisionSchema = z.enum(["approved", "rejected"]);

export const cursorPageRequestSchema = z
  .object({
    cursor: canonicalIdSchema.optional(),
    limit: z.coerce.number().int().min(1).max(100).default(25),
  })
  .strict();

export const cursorPageMetadataSchema = z
  .object({ nextCursor: canonicalIdSchema.nullable(), hasMore: z.boolean() })
  .strict();

export const paginatedResponseSchema = <T extends z.ZodTypeAny>(itemSchema: T) =>
  z
    .object({
      items: z.array(itemSchema).max(100),
      nextCursor: canonicalIdSchema.nullable(),
      hasMore: z.boolean(),
    })
    .strict();

export const publishingPreviewSchema = z
  .object({
    digest: sha256DigestSchema,
    mediaAssetId: canonicalIdSchema,
    platform: socialPlatformSchema,
    caption: z.string().trim().max(2_200),
    hashtags: z.array(z.string().trim().min(1).max(100).regex(/^#?[\p{L}\p{N}_]+$/u)).max(30),
    title: z.string().trim().min(1).max(200).nullable(),
    scheduledFor: isoDateSchema.nullable(),
    timezone: z.string().trim().min(1).max(80).nullable(),
    generatedAt: isoDateSchema,
  })
  .strict();

export const approvalEvidenceSchema = z
  .object({
    decision: approvalDecisionSchema,
    actorId: canonicalIdSchema,
    decidedAt: isoDateSchema,
    previewDigest: sha256DigestSchema,
    reason: z.string().trim().min(1).max(1_000).nullable(),
  })
  .strict();

export const publishingScheduleSchema = z
  .object({
    mode: publishingModeSchema,
    scheduledFor: isoDateSchema.nullable(),
    timezone: z.string().trim().min(1).max(80).nullable(),
  })
  .strict()
  .superRefine(({ mode, scheduledFor, timezone }, ctx) => {
    if (mode === "scheduled" && (!scheduledFor || !timezone)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "scheduled publishing requires time and timezone" });
    }
    if (mode === "manual" && scheduledFor !== null) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "manual publishing cannot have a scheduled time" });
    }
  });

export const automationPolicySchema = z
  .object({
    automaticPublishingEnabled: z.literal(false),
    approvalRequired: z.literal(true),
    policyVersion: z.string().trim().min(1).max(64),
    evaluatedAt: isoDateSchema,
    reason: z.string().trim().min(1).max(500),
  })
  .strict();

export const createPublishingJobRequestSchema = z
  .object({
    mediaAssetId: canonicalIdSchema,
    platform: socialPlatformSchema,
    caption: z.string().trim().max(2_200),
    hashtags: z.array(z.string().trim().min(1).max(100).regex(/^#?[\p{L}\p{N}_]+$/u)).max(30),
    title: z.string().trim().min(1).max(200).nullable().default(null),
    timezone: z.string().trim().min(1).max(80).nullable(),
    schedule: publishingScheduleSchema,
    previewDigest: sha256DigestSchema,
    idempotencyKey: canonicalIdSchema,
  })
  .strict()
  .refine(({ timezone, schedule }) => timezone === schedule.timezone, {
    message: "timezone must match the publishing schedule",
    path: ["timezone"],
  });

export const publishingJobSchema = z
  .object({
    id: canonicalIdSchema,
    mediaAssetId: canonicalIdSchema.nullable(),
    platform: socialPlatformSchema,
    mode: publishingModeSchema,
    status: publishingJobStatusSchema,
    preview: publishingPreviewSchema,
    approval: approvalEvidenceSchema.nullable(),
    scheduledFor: isoDateSchema.nullable(),
    dueAt: isoDateSchema.nullable(),
    attempts: nonNegativeIntegerSchema,
    maxAttempts: z.number().int().positive(),
    failureCode: z.string().trim().min(1).max(100).nullable(),
    createdAt: isoDateSchema,
    updatedAt: isoDateSchema,
  })
  .strict();

export const publishingJobListRequestSchema = cursorPageRequestSchema.extend({
  platform: socialPlatformSchema.optional(),
  status: publishingJobStatusSchema.optional(),
}).strict();
export const publishingJobListResponseSchema = paginatedResponseSchema(publishingJobSchema);

export const publicationSchema = z
  .object({
    id: canonicalIdSchema,
    videoId: canonicalIdSchema.nullable(),
    mediaAssetId: canonicalIdSchema.nullable(),
    platform: socialPlatformSchema,
    status: publicationStatusSchema,
    permalink: z.string().url().startsWith("https://").nullable(),
    publishedAt: isoDateSchema.nullable(),
    createdAt: isoDateSchema,
    updatedAt: isoDateSchema,
  })
  .strict()
  .refine(({ videoId, mediaAssetId }) => videoId !== null || mediaAssetId !== null, "videoId or mediaAssetId is required");

export const analyticsMetricsSchema = z
  .object({
    views: nonNegativeIntegerSchema,
    impressions: nonNegativeIntegerSchema,
    likes: nonNegativeIntegerSchema,
    comments: nonNegativeIntegerSchema,
    shares: nonNegativeIntegerSchema,
    clicks: nonNegativeIntegerSchema,
    watchTimeMs: nonNegativeIntegerSchema,
    ctr: z.number().min(0).max(1).nullable(),
    retentionRate: z.number().min(0).max(1).nullable(),
  })
  .strict();

export const analyticsSnapshotSchema = z
  .object({
    id: canonicalIdSchema,
    publicationId: canonicalIdSchema,
    platform: socialPlatformSchema,
    capturedAt: isoDateSchema,
    metrics: analyticsMetricsSchema,
  })
  .strict();

export const analyticsSummarySchema = z
  .object({
    window: optionalWindowSchema,
    platform: socialPlatformSchema.nullable(),
    publicationCount: nonNegativeIntegerSchema,
    metrics: analyticsMetricsSchema,
    engagementRate: z.number().min(0).max(1).nullable(),
    averageWatchTimeMs: nonNegativeIntegerSchema.nullable(),
    costPerVideoUsd: z.number().nonnegative().nullable(),
    costPerViewUsd: z.number().nonnegative().nullable(),
    currency: z.literal("USD"),
  })
  .strict()
  .superRefine(({ metrics, costPerViewUsd }, ctx) => {
    if (metrics.views === 0 && costPerViewUsd !== null) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "costPerViewUsd must be null when views are zero", path: ["costPerViewUsd"] });
    }
  });

export const attributionDimensionsSchema = z
  .object({
    avatarId: canonicalIdSchema.nullable(),
    hook: z.string().trim().min(1).max(500).nullable(),
    cta: z.string().trim().min(1).max(500).nullable(),
    postingTime: isoDateSchema.nullable(),
    category: z.string().trim().min(1).max(120).nullable(),
  })
  .strict();

export const attributionSchema = z
  .object({
    publicationId: canonicalIdSchema,
    sourceItemId: canonicalIdSchema.nullable(),
    scriptId: canonicalIdSchema.nullable(),
    influencerId: canonicalIdSchema.nullable(),
    campaignKey: canonicalIdSchema.nullable(),
    dimensions: attributionDimensionsSchema,
    attributedAt: isoDateSchema,
    model: z.enum(["direct", "last_touch", "unattributed"]),
  })
  .strict();

export const publicationAnalyticsMappingSchema = z
  .object({
    publicationId: canonicalIdSchema,
    videoId: canonicalIdSchema.nullable(),
    mediaAssetId: canonicalIdSchema.nullable(),
    platform: socialPlatformSchema,
  })
  .strict()
  .refine(({ videoId, mediaAssetId }) => videoId !== null || mediaAssetId !== null, "videoId or mediaAssetId is required");

export const sourceTypeSchema = z.enum(["manual", "feed", "upload", "owned_library"]);
export const sourceRightsStatusSchema = z.enum(["unknown", "owned", "licensed", "restricted", "rejected"]);
export const moderationStatusSchema = z.enum(["pending", "approved", "rejected", "needs_review"]);

const sourceIntakeFieldsSchema = z
  .object({
    sourceType: sourceTypeSchema,
    canonicalUrl: z.string().url().startsWith("https://").nullable(),
    title: z.string().trim().min(1).max(500).nullable(),
    content: z.string().trim().min(1).max(100_000).nullable(),
    contentHash: sha256DigestSchema,
    rightsStatus: sourceRightsStatusSchema,
    idempotencyKey: canonicalIdSchema,
  })
  .strict();

export const sourceIntakeSchema = sourceIntakeFieldsSchema.refine(
  ({ canonicalUrl, content }) => canonicalUrl !== null || content !== null,
  "source URL or content is required",
);

export const sourceItemSchema = sourceIntakeFieldsSchema
  .omit({ idempotencyKey: true })
  .extend({
    id: canonicalIdSchema,
    moderationStatus: moderationStatusSchema,
    status: z.enum(["discovered", "accepted", "processing", "ready", "rejected", "archived"]),
    createdAt: isoDateSchema,
    updatedAt: isoDateSchema,
  })
  .strict();

export const orchestrationRunSchema = z
  .object({
    id: canonicalIdSchema,
    sourceItemId: canonicalIdSchema.nullable(),
    runType: z.enum(["intake", "script", "render", "publish", "analytics"]),
    mode: publishingModeSchema,
    status: z.enum(["queued", "running", "succeeded", "failed", "cancelled", "dead_letter"]),
    policy: automationPolicySchema,
    idempotencyKey: canonicalIdSchema,
    dueAt: isoDateSchema.nullable(),
    attempts: nonNegativeIntegerSchema,
    createdAt: isoDateSchema,
    updatedAt: isoDateSchema,
  })
  .strict();

export type SocialPlatform = z.infer<typeof socialPlatformSchema>;
export type PublishingMode = z.infer<typeof publishingModeSchema>;
export type PublishingPreview = z.infer<typeof publishingPreviewSchema>;
export type ApprovalEvidence = z.infer<typeof approvalEvidenceSchema>;
export type PublishingSchedule = z.infer<typeof publishingScheduleSchema>;
export type AutomationPolicy = z.infer<typeof automationPolicySchema>;
export type CreatePublishingJobRequest = z.infer<typeof createPublishingJobRequestSchema>;
export type PublishingJob = z.infer<typeof publishingJobSchema>;
export type Publication = z.infer<typeof publicationSchema>;
export type AnalyticsMetrics = z.infer<typeof analyticsMetricsSchema>;
export type AnalyticsSnapshot = z.infer<typeof analyticsSnapshotSchema>;
export type AnalyticsSummary = z.infer<typeof analyticsSummarySchema>;
export type AttributionDimensions = z.infer<typeof attributionDimensionsSchema>;
export type Attribution = z.infer<typeof attributionSchema>;
export type PublicationAnalyticsMapping = z.infer<typeof publicationAnalyticsMappingSchema>;
export type SourceIntake = z.infer<typeof sourceIntakeSchema>;
export type SourceItem = z.infer<typeof sourceItemSchema>;
export type OrchestrationRun = z.infer<typeof orchestrationRunSchema>;
export type CursorPageRequest = z.infer<typeof cursorPageRequestSchema>;
