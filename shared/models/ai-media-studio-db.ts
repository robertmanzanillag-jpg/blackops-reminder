import {
  bigint,
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import type { AnyPgColumn } from "drizzle-orm/pg-core";

/**
 * Durable, provider-neutral storage for AI Media Studio.
 *
 * Provider credentials never belong in these tables. `secretRef` is an opaque
 * pointer resolved by the server-side secret store at execution time.
 */

const tenantColumns = () => ({
  ownerUserId: text("owner_user_id").notNull(),
  workspaceId: text("workspace_id").notNull().default("personal"),
});

const auditColumns = () => ({
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const aiMediaInfluencers = pgTable(
  "ai_media_influencers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ...tenantColumns(),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    status: text("status").notNull().default("draft"),
    description: text("description"),
    accent: text("accent").notNull().default("neutral"),
    language: text("language").notNull().default("en"),
    gender: text("gender").notNull().default("unspecified"),
    ageRange: jsonb("age_range")
      .$type<{ minimum: number; maximum: number }>()
      .notNull()
      .default({ minimum: 18, maximum: 65 }),
    personality: jsonb("personality").$type<string[]>().notNull().default([]),
    tone: jsonb("tone").$type<string[]>().notNull().default([]),
    speakingStyle: text("speaking_style").notNull().default("natural"),
    categories: jsonb("categories").$type<string[]>().notNull().default([]),
    intro: text("intro").notNull().default(""),
    outro: text("outro").notNull().default(""),
    energyLevel: integer("energy_level").notNull().default(5),
    facialExpressions: jsonb("facial_expressions").$type<string[]>().notNull().default([]),
    brandColors: jsonb("brand_colors").$type<string[]>().notNull().default([]),
    persona: jsonb("persona").$type<Record<string, unknown>>().notNull().default({}),
    defaultVoiceResourceId: uuid("default_voice_resource_id").references(
      (): AnyPgColumn => aiMediaProviderResources.id,
      { onDelete: "set null" },
    ),
    defaultAvatarResourceId: uuid("default_avatar_resource_id").references(
      (): AnyPgColumn => aiMediaProviderResources.id,
      { onDelete: "set null" },
    ),
    ...auditColumns(),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
  },
  (table) => ({
    ownerWorkspaceSlugUnique: uniqueIndex("ai_media_influencers_owner_workspace_slug_uq").on(
      table.ownerUserId,
      table.workspaceId,
      table.slug,
    ),
    ownerWorkspaceStatusIdx: index("ai_media_influencers_owner_workspace_status_idx").on(
      table.ownerUserId,
      table.workspaceId,
      table.status,
    ),
  }),
);

export const aiMediaScripts = pgTable(
  "ai_media_scripts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ...tenantColumns(),
    influencerId: uuid("influencer_id").references(() => aiMediaInfluencers.id, { onDelete: "set null" }),
    title: text("title").notNull(),
    sourceType: text("source_type").notNull().default("manual"),
    sourceItemId: uuid("source_item_id"),
    language: text("language").notNull().default("en"),
    status: text("status").notNull().default("draft"),
    currentVariantId: uuid("current_variant_id"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    ...auditColumns(),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
  },
  (table) => ({
    ownerWorkspaceUpdatedIdx: index("ai_media_scripts_owner_workspace_updated_idx").on(
      table.ownerUserId,
      table.workspaceId,
      table.updatedAt,
    ),
    influencerIdx: index("ai_media_scripts_influencer_idx").on(table.influencerId),
  }),
);

export const aiMediaScriptVariants = pgTable(
  "ai_media_script_variants",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ...tenantColumns(),
    scriptId: uuid("script_id").notNull().references(() => aiMediaScripts.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    label: text("label"),
    content: text("content").notNull(),
    status: text("status").notNull().default("draft"),
    generationHistoryId: uuid("generation_history_id"),
    checksum: text("checksum"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    ...auditColumns(),
  },
  (table) => ({
    scriptVersionUnique: uniqueIndex("ai_media_script_variants_script_version_uq").on(table.scriptId, table.version),
    ownerWorkspaceScriptIdx: index("ai_media_script_variants_owner_workspace_script_idx").on(
      table.ownerUserId,
      table.workspaceId,
      table.scriptId,
    ),
  }),
);

export const aiMediaVideoProjects = pgTable(
  "ai_media_video_projects",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ...tenantColumns(),
    influencerId: uuid("influencer_id").references(() => aiMediaInfluencers.id, { onDelete: "set null" }),
    scriptId: uuid("script_id").references(() => aiMediaScripts.id, { onDelete: "set null" }),
    scriptVariantId: uuid("script_variant_id").references(() => aiMediaScriptVariants.id, { onDelete: "set null" }),
    title: text("title").notNull(),
    status: text("status").notNull().default("draft"),
    aspectRatio: text("aspect_ratio").notNull().default("9:16"),
    settings: jsonb("settings").$type<Record<string, unknown>>().notNull().default({}),
    ...auditColumns(),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
  },
  (table) => ({
    ownerWorkspaceStatusUpdatedIdx: index("ai_media_video_projects_owner_workspace_status_updated_idx").on(
      table.ownerUserId,
      table.workspaceId,
      table.status,
      table.updatedAt,
    ),
  }),
);

export const aiMediaVideos = pgTable(
  "ai_media_videos",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ...tenantColumns(),
    projectId: uuid("project_id").notNull().references(() => aiMediaVideoProjects.id, { onDelete: "cascade" }),
    renderJobId: uuid("render_job_id"),
    mediaAssetId: uuid("media_asset_id"),
    version: integer("version").notNull().default(1),
    status: text("status").notNull().default("pending"),
    durationMs: integer("duration_ms"),
    width: integer("width"),
    height: integer("height"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    ...auditColumns(),
  },
  (table) => ({
    projectVersionUnique: uniqueIndex("ai_media_videos_project_version_uq").on(table.projectId, table.version),
    ownerWorkspaceStatusIdx: index("ai_media_videos_owner_workspace_status_idx").on(
      table.ownerUserId,
      table.workspaceId,
      table.status,
    ),
  }),
);

export const aiMediaProviderAccounts = pgTable(
  "ai_media_provider_accounts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ...tenantColumns(),
    providerKey: text("provider_key").notNull(),
    displayName: text("display_name").notNull(),
    status: text("status").notNull().default("disconnected"),
    secretRef: text("secret_ref"),
    externalAccountId: text("external_account_id"),
    capabilities: jsonb("capabilities").$type<string[]>().notNull().default([]),
    configuration: jsonb("configuration").$type<Record<string, unknown>>().notNull().default({}),
    lastVerifiedAt: timestamp("last_verified_at", { withTimezone: true }),
    ...auditColumns(),
  },
  (table) => ({
    ownerWorkspaceProviderUnique: uniqueIndex("ai_media_provider_accounts_owner_workspace_provider_uq").on(
      table.ownerUserId,
      table.workspaceId,
      table.providerKey,
    ),
    providerStatusIdx: index("ai_media_provider_accounts_provider_status_idx").on(table.providerKey, table.status),
  }),
);

export const aiMediaProviderResources = pgTable(
  "ai_media_provider_resources",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ...tenantColumns(),
    providerAccountId: uuid("provider_account_id").notNull().references(() => aiMediaProviderAccounts.id, { onDelete: "cascade" }),
    providerKey: text("provider_key").notNull(),
    resourceType: text("resource_type").notNull(),
    canonicalKey: text("canonical_key").notNull(),
    externalResourceId: text("external_resource_id").notNull(),
    displayName: text("display_name").notNull(),
    status: text("status").notNull().default("active"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    synchronizedAt: timestamp("synchronized_at", { withTimezone: true }),
    ...auditColumns(),
  },
  (table) => ({
    providerExternalUnique: uniqueIndex("ai_media_provider_resources_provider_external_uq").on(
      table.ownerUserId,
      table.workspaceId,
      table.providerAccountId,
      table.resourceType,
      table.externalResourceId,
    ),
    ownerWorkspaceCanonicalUnique: uniqueIndex("ai_media_provider_resources_owner_workspace_canonical_uq").on(
      table.ownerUserId,
      table.workspaceId,
      table.resourceType,
      table.canonicalKey,
    ),
    ownerWorkspaceTypeIdx: index("ai_media_provider_resources_owner_workspace_type_idx").on(
      table.ownerUserId,
      table.workspaceId,
      table.resourceType,
    ),
  }),
);

export const aiMediaRenderJobs = pgTable(
  "ai_media_render_jobs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ...tenantColumns(),
    generationId: uuid("generation_id").notNull().defaultRandom(),
    projectId: uuid("project_id").references(() => aiMediaVideoProjects.id, { onDelete: "set null" }),
    providerAccountId: uuid("provider_account_id").references(() => aiMediaProviderAccounts.id, { onDelete: "set null" }),
    providerKey: text("provider_key"),
    providerJobId: text("provider_job_id"),
    idempotencyKey: text("idempotency_key").notNull(),
    title: text("title").notNull(),
    status: text("status").notNull().default("pending"),
    stage: text("stage").notNull().default("queued"),
    progress: integer("progress").notNull().default(0),
    attempts: integer("attempts").notNull().default(0),
    retryCount: integer("retry_count").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(3),
    request: jsonb("request").$type<Record<string, unknown>>().notNull(),
    result: jsonb("result").$type<Record<string, unknown>>(),
    outputUrl: text("output_url"),
    errorCode: text("error_code"),
    errorMessage: text("error_message"),
    queuedAt: timestamp("queued_at", { withTimezone: true }).notNull().defaultNow(),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }),
    availableAt: timestamp("available_at", { withTimezone: true }).notNull().defaultNow(),
    leaseOwner: text("lease_owner"),
    leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }),
    deadLetterAt: timestamp("dead_letter_at", { withTimezone: true }),
    ...auditColumns(),
  },
  (table) => ({
    ownerWorkspaceIdempotencyUnique: uniqueIndex("ai_media_render_jobs_owner_workspace_idempotency_uq").on(
      table.ownerUserId,
      table.workspaceId,
      table.idempotencyKey,
    ),
    providerJobUnique: uniqueIndex("ai_media_render_jobs_provider_job_uq").on(table.providerKey, table.providerJobId),
    ownerWorkspaceCreatedIdx: index("ai_media_render_jobs_owner_workspace_created_idx").on(
      table.ownerUserId,
      table.workspaceId,
      table.createdAt,
    ),
    queueIdx: index("ai_media_render_jobs_queue_idx").on(
      table.status,
      table.availableAt,
      table.leaseExpiresAt,
      table.createdAt,
    ),
    ownerWorkspaceLeaseIdx: index("ai_media_render_jobs_owner_workspace_lease_idx").on(
      table.ownerUserId,
      table.workspaceId,
      table.leaseOwner,
      table.leaseExpiresAt,
    ),
    deadLetterIdx: index("ai_media_render_jobs_dead_letter_idx").on(table.deadLetterAt),
  }),
);

export const aiMediaWebhookEvents = pgTable(
  "ai_media_webhook_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ...tenantColumns(),
    providerKey: text("provider_key").notNull(),
    eventId: text("event_id").notNull(),
    providerJobId: text("provider_job_id").notNull(),
    renderJobId: uuid("render_job_id").references(() => aiMediaRenderJobs.id, { onDelete: "set null" }),
    eventType: text("event_type").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    payloadDigest: text("payload_digest"),
    signatureVerified: boolean("signature_verified").notNull().default(false),
    status: text("status").notNull().default("received"),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    processedAt: timestamp("processed_at", { withTimezone: true }),
    parkedAt: timestamp("parked_at", { withTimezone: true }),
    processingError: text("processing_error"),
    ...auditColumns(),
  },
  (table) => ({
    providerEventUnique: uniqueIndex("ai_media_webhook_events_provider_event_uq").on(table.providerKey, table.eventId),
    providerJobStatusIdx: index("ai_media_webhook_events_provider_job_status_idx").on(
      table.providerKey,
      table.providerJobId,
      table.status,
    ),
    ownerWorkspaceOccurredIdx: index("ai_media_webhook_events_owner_workspace_occurred_idx").on(
      table.ownerUserId,
      table.workspaceId,
      table.occurredAt,
    ),
  }),
);

export const aiMediaMediaAssets = pgTable(
  "ai_media_assets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ...tenantColumns(),
    projectId: uuid("project_id").references(() => aiMediaVideoProjects.id, { onDelete: "set null" }),
    renderJobId: uuid("render_job_id").references(() => aiMediaRenderJobs.id, { onDelete: "set null" }),
    influencerId: uuid("influencer_id").references(() => aiMediaInfluencers.id, { onDelete: "set null" }),
    providerResourceId: uuid("provider_resource_id").references(
      () => aiMediaProviderResources.id,
      { onDelete: "set null" },
    ),
    kind: text("kind").notNull(),
    name: text("name").notNull().default("Untitled asset"),
    status: text("status").notNull().default("processing"),
    storageProvider: text("storage_provider").notNull(),
    storageKey: text("storage_key").notNull(),
    publicUrl: text("public_url"),
    thumbnailUrl: text("thumbnail_url"),
    mimeType: text("mime_type").notNull(),
    byteSize: bigint("byte_size", { mode: "number" }),
    checksum: text("checksum"),
    width: integer("width"),
    height: integer("height"),
    durationMs: integer("duration_ms"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    ...auditColumns(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (table) => ({
    storageObjectUnique: uniqueIndex("ai_media_assets_storage_object_uq").on(
      table.ownerUserId,
      table.workspaceId,
      table.storageProvider,
      table.storageKey,
    ),
    ownerWorkspaceProjectIdx: index("ai_media_assets_owner_workspace_project_idx").on(
      table.ownerUserId,
      table.workspaceId,
      table.projectId,
    ),
    ownerWorkspaceLibraryIdx: index("ai_media_assets_owner_workspace_library_idx").on(
      table.ownerUserId,
      table.workspaceId,
      table.kind,
      table.status,
      table.createdAt,
    ),
    influencerIdx: index("ai_media_assets_influencer_idx").on(table.influencerId),
    providerResourceIdx: index("ai_media_assets_provider_resource_idx").on(table.providerResourceId),
  }),
);

export const aiMediaPublishingJobs = pgTable(
  "ai_media_publishing_jobs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ...tenantColumns(),
    videoId: uuid("video_id").notNull().references(() => aiMediaVideos.id, { onDelete: "cascade" }),
    providerAccountId: uuid("provider_account_id").references(() => aiMediaProviderAccounts.id, { onDelete: "set null" }),
    platform: text("platform").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    status: text("status").notNull().default("pending_approval"),
    approvalStatus: text("approval_status").notNull().default("required"),
    scheduledFor: timestamp("scheduled_for", { withTimezone: true }),
    attempts: integer("attempts").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(3),
    request: jsonb("request").$type<Record<string, unknown>>().notNull().default({}),
    errorMessage: text("error_message"),
    ...auditColumns(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (table) => ({
    ownerWorkspaceIdempotencyUnique: uniqueIndex("ai_media_publishing_jobs_owner_workspace_idempotency_uq").on(
      table.ownerUserId,
      table.workspaceId,
      table.idempotencyKey,
    ),
    dispatchIdx: index("ai_media_publishing_jobs_dispatch_idx").on(table.status, table.approvalStatus, table.scheduledFor),
  }),
);

export const aiMediaPublications = pgTable(
  "ai_media_publications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ...tenantColumns(),
    publishingJobId: uuid("publishing_job_id").notNull().references(() => aiMediaPublishingJobs.id, { onDelete: "cascade" }),
    videoId: uuid("video_id").notNull().references(() => aiMediaVideos.id, { onDelete: "cascade" }),
    platform: text("platform").notNull(),
    externalPublicationId: text("external_publication_id").notNull(),
    status: text("status").notNull().default("published"),
    permalink: text("permalink"),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    ...auditColumns(),
  },
  (table) => ({
    platformExternalUnique: uniqueIndex("ai_media_publications_platform_external_uq").on(
      table.platform,
      table.externalPublicationId,
    ),
    ownerWorkspacePublishedIdx: index("ai_media_publications_owner_workspace_published_idx").on(
      table.ownerUserId,
      table.workspaceId,
      table.publishedAt,
    ),
  }),
);

export const aiMediaAnalyticsSnapshots = pgTable(
  "ai_media_analytics_snapshots",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ...tenantColumns(),
    publicationId: uuid("publication_id").notNull().references(() => aiMediaPublications.id, { onDelete: "cascade" }),
    capturedAt: timestamp("captured_at", { withTimezone: true }).notNull(),
    views: bigint("views", { mode: "number" }).notNull().default(0),
    impressions: bigint("impressions", { mode: "number" }).notNull().default(0),
    likes: bigint("likes", { mode: "number" }).notNull().default(0),
    comments: bigint("comments", { mode: "number" }).notNull().default(0),
    shares: bigint("shares", { mode: "number" }).notNull().default(0),
    watchTimeMs: bigint("watch_time_ms", { mode: "number" }).notNull().default(0),
    metrics: jsonb("metrics").$type<Record<string, number>>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    publicationCapturedUnique: uniqueIndex("ai_media_analytics_snapshots_publication_captured_uq").on(
      table.publicationId,
      table.capturedAt,
    ),
    ownerWorkspaceCapturedIdx: index("ai_media_analytics_snapshots_owner_workspace_captured_idx").on(
      table.ownerUserId,
      table.workspaceId,
      table.capturedAt,
    ),
  }),
);

export const aiMediaAnalyticsEvents = pgTable(
  "ai_media_analytics_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ...tenantColumns(),
    publicationId: uuid("publication_id").references(() => aiMediaPublications.id, { onDelete: "cascade" }),
    source: text("source").notNull(),
    externalEventId: text("external_event_id"),
    eventType: text("event_type").notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    dimensions: jsonb("dimensions").$type<Record<string, unknown>>().notNull().default({}),
    metrics: jsonb("metrics").$type<Record<string, number>>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    sourceExternalUnique: uniqueIndex("ai_media_analytics_events_source_external_uq").on(table.source, table.externalEventId),
    ownerWorkspaceOccurredIdx: index("ai_media_analytics_events_owner_workspace_occurred_idx").on(
      table.ownerUserId,
      table.workspaceId,
      table.occurredAt,
    ),
  }),
);

export const aiMediaGenerationHistory = pgTable(
  "ai_media_generation_history",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ...tenantColumns(),
    generationType: text("generation_type").notNull(),
    modelProvider: text("model_provider").notNull(),
    modelName: text("model_name").notNull(),
    promptDigest: text("prompt_digest").notNull(),
    promptTemplateId: text("prompt_template_id"),
    request: jsonb("request").$type<Record<string, unknown>>().notNull().default({}),
    response: jsonb("response").$type<Record<string, unknown>>(),
    status: text("status").notNull(),
    latencyMs: integer("latency_ms"),
    inputTokens: integer("input_tokens"),
    outputTokens: integer("output_tokens"),
    errorCode: text("error_code"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (table) => ({
    ownerWorkspaceCreatedIdx: index("ai_media_generation_history_owner_workspace_created_idx").on(
      table.ownerUserId,
      table.workspaceId,
      table.createdAt,
    ),
  }),
);

export const aiMediaCostLedger = pgTable(
  "ai_media_cost_ledger",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ...tenantColumns(),
    idempotencyKey: text("idempotency_key").notNull(),
    providerKey: text("provider_key").notNull(),
    service: text("service").notNull(),
    operation: text("operation").notNull(),
    renderJobId: uuid("render_job_id").references(() => aiMediaRenderJobs.id, { onDelete: "set null" }),
    generationHistoryId: uuid("generation_history_id").references(() => aiMediaGenerationHistory.id, { onDelete: "set null" }),
    quantity: numeric("quantity", { precision: 18, scale: 6 }).notNull().default("1"),
    unit: text("unit").notNull().default("request"),
    amountUsd: numeric("amount_usd", { precision: 18, scale: 6 }).notNull().default("0"),
    estimated: boolean("estimated").notNull().default(true),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    ownerWorkspaceIdempotencyUnique: uniqueIndex("ai_media_cost_ledger_owner_workspace_idempotency_uq").on(
      table.ownerUserId,
      table.workspaceId,
      table.idempotencyKey,
    ),
    ownerWorkspaceOccurredIdx: index("ai_media_cost_ledger_owner_workspace_occurred_idx").on(
      table.ownerUserId,
      table.workspaceId,
      table.occurredAt,
    ),
  }),
);

export const aiMediaSourceItems = pgTable(
  "ai_media_source_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ...tenantColumns(),
    sourceType: text("source_type").notNull(),
    externalId: text("external_id").notNull(),
    canonicalUrl: text("canonical_url"),
    title: text("title"),
    content: text("content"),
    rightsStatus: text("rights_status").notNull().default("unknown"),
    status: text("status").notNull().default("discovered"),
    sourcePublishedAt: timestamp("source_published_at", { withTimezone: true }),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
    ...auditColumns(),
  },
  (table) => ({
    ownerWorkspaceSourceExternalUnique: uniqueIndex("ai_media_source_items_owner_workspace_source_external_uq").on(
      table.ownerUserId,
      table.workspaceId,
      table.sourceType,
      table.externalId,
    ),
    ownerWorkspaceStatusIdx: index("ai_media_source_items_owner_workspace_status_idx").on(
      table.ownerUserId,
      table.workspaceId,
      table.status,
    ),
  }),
);

export const aiMediaOutbox = pgTable(
  "ai_media_outbox",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ...tenantColumns(),
    idempotencyKey: text("idempotency_key").notNull(),
    aggregateType: text("aggregate_type").notNull(),
    aggregateId: text("aggregate_id").notNull(),
    eventType: text("event_type").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    status: text("status").notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    availableAt: timestamp("available_at", { withTimezone: true }).notNull().defaultNow(),
    lockedAt: timestamp("locked_at", { withTimezone: true }),
    processedAt: timestamp("processed_at", { withTimezone: true }),
    lastError: text("last_error"),
    ...auditColumns(),
  },
  (table) => ({
    ownerWorkspaceIdempotencyUnique: uniqueIndex("ai_media_outbox_owner_workspace_idempotency_uq").on(
      table.ownerUserId,
      table.workspaceId,
      table.idempotencyKey,
    ),
    dispatchIdx: index("ai_media_outbox_dispatch_idx").on(table.status, table.availableAt, table.createdAt),
    aggregateIdx: index("ai_media_outbox_aggregate_idx").on(table.aggregateType, table.aggregateId, table.createdAt),
  }),
);

export const aiMediaStudioTables = {
  influencers: aiMediaInfluencers,
  scripts: aiMediaScripts,
  scriptVariants: aiMediaScriptVariants,
  videoProjects: aiMediaVideoProjects,
  videos: aiMediaVideos,
  providerAccounts: aiMediaProviderAccounts,
  providerResources: aiMediaProviderResources,
  renderJobs: aiMediaRenderJobs,
  webhookEvents: aiMediaWebhookEvents,
  mediaAssets: aiMediaMediaAssets,
  publishingJobs: aiMediaPublishingJobs,
  publications: aiMediaPublications,
  analyticsSnapshots: aiMediaAnalyticsSnapshots,
  analyticsEvents: aiMediaAnalyticsEvents,
  generationHistory: aiMediaGenerationHistory,
  costLedger: aiMediaCostLedger,
  sourceItems: aiMediaSourceItems,
  outbox: aiMediaOutbox,
} as const;

type AiMediaRenderJobSelect = typeof aiMediaRenderJobs.$inferSelect;
/**
 * Lease fields are optional here for compatibility with historical row
 * fixtures. PostgreSQL selects always populate them after the additive schema
 * migration is applied.
 */
export type AiMediaRenderJobRow = Omit<
  AiMediaRenderJobSelect,
  "availableAt" | "leaseOwner" | "leaseExpiresAt" | "deadLetterAt"
> & Partial<Pick<
  AiMediaRenderJobSelect,
  "availableAt" | "leaseOwner" | "leaseExpiresAt" | "deadLetterAt"
>>;
export type NewAiMediaRenderJobRow = typeof aiMediaRenderJobs.$inferInsert;
export type AiMediaWebhookEventRow = typeof aiMediaWebhookEvents.$inferSelect;
export type NewAiMediaWebhookEventRow = typeof aiMediaWebhookEvents.$inferInsert;
export type AiMediaOutboxRow = typeof aiMediaOutbox.$inferSelect;
export type NewAiMediaOutboxRow = typeof aiMediaOutbox.$inferInsert;
