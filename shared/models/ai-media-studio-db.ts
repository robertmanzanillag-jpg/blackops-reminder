import {
  bigint,
  boolean,
  check,
  foreignKey,
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
import { sql } from "drizzle-orm";

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
    ownerWorkspaceIdUnique: uniqueIndex("ai_media_influencers_owner_workspace_id_uq").on(
      table.ownerUserId,
      table.workspaceId,
      table.id,
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
    webhookEndpointKey: text("webhook_endpoint_key"),
    webhookSecretRef: text("webhook_secret_ref"),
    webhookPreviousSecretRef: text("webhook_previous_secret_ref"),
    webhookPreviousSecretExpiresAt: timestamp("webhook_previous_secret_expires_at", { withTimezone: true }),
    externalAccountId: text("external_account_id"),
    capabilities: jsonb("capabilities").$type<string[]>().notNull().default([]),
    configuration: jsonb("configuration").$type<Record<string, unknown>>().notNull().default({}),
    lastVerifiedAt: timestamp("last_verified_at", { withTimezone: true }),
    ...auditColumns(),
  },
  (table) => ({
    ownerWorkspaceProviderStatusIdx: index("ai_media_provider_accounts_owner_workspace_provider_status_idx").on(
      table.ownerUserId,
      table.workspaceId,
      table.providerKey,
      table.status,
    ),
    ownerWorkspaceProviderExternalUnique: uniqueIndex("ai_media_provider_accounts_owner_workspace_provider_external_uq")
      .on(table.ownerUserId, table.workspaceId, table.providerKey, table.externalAccountId)
      .where(sql`${table.externalAccountId} IS NOT NULL`),
    providerEndpointUnique: uniqueIndex("ai_media_provider_accounts_provider_endpoint_uq")
      .on(table.providerKey, table.webhookEndpointKey)
      .where(sql`${table.webhookEndpointKey} IS NOT NULL`),
    providerStatusIdx: index("ai_media_provider_accounts_provider_status_idx").on(table.providerKey, table.status),
    ownerWorkspaceIdUnique: uniqueIndex("ai_media_provider_accounts_owner_workspace_id_uq").on(
      table.ownerUserId,
      table.workspaceId,
      table.id,
    ),
    ownerWorkspaceIdProviderUnique: uniqueIndex("ai_media_provider_accounts_owner_workspace_id_provider_uq").on(
      table.ownerUserId,
      table.workspaceId,
      table.id,
      table.providerKey,
    ),
    webhookMetadataCheck: check(
      "ai_media_provider_accounts_webhook_metadata_ck",
      sql`(
        ((${table.webhookEndpointKey} IS NULL) = (${table.webhookSecretRef} IS NULL))
        AND (${table.webhookEndpointKey} IS NULL OR (
          length(btrim(${table.webhookEndpointKey})) BETWEEN 24 AND 128
          AND ${table.webhookEndpointKey} ~ '^[A-Za-z0-9_-]+$'
          AND length(btrim(${table.webhookSecretRef})) BETWEEN 1 AND 500
        ))
        AND ((${table.webhookPreviousSecretRef} IS NULL) = (${table.webhookPreviousSecretExpiresAt} IS NULL))
        AND (${table.webhookPreviousSecretRef} IS NULL OR ${table.webhookSecretRef} IS NOT NULL)
        AND (${table.webhookPreviousSecretRef} IS NULL OR length(btrim(${table.webhookPreviousSecretRef})) BETWEEN 1 AND 500)
      )`,
    ),
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
    ownerWorkspaceIdUnique: uniqueIndex("ai_media_provider_resources_owner_workspace_id_uq").on(
      table.ownerUserId,
      table.workspaceId,
      table.id,
    ),
  }),
);

/**
 * Immutable governance revisions. Policy changes append a row linked through
 * `previousProfileId`; callers must never overwrite historical evidence.
 */
export const aiMediaGovernanceProfiles = pgTable(
  "ai_media_governance_profiles",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ...tenantColumns(),
    influencerId: uuid("influencer_id").notNull(),
    avatarResourceId: uuid("avatar_resource_id").notNull(),
    voiceResourceId: uuid("voice_resource_id").notNull(),
    state: text("state").notNull().default("active"),
    consentBasis: text("consent_basis").notNull(),
    rightsBasis: text("rights_basis").notNull(),
    allowedUses: jsonb("allowed_uses").$type<string[]>().notNull(),
    territories: jsonb("territories").$type<string[]>().notNull(),
    proofDigest: text("proof_digest").notNull(),
    evidenceDigest: text("evidence_digest").notNull(),
    brandPolicy: jsonb("brand_policy").$type<Record<string, unknown>>().notNull().default({}),
    version: integer("version").notNull().default(1),
    policyVersion: text("policy_version").notNull(),
    actorUserId: text("actor_user_id").notNull(),
    validFrom: timestamp("valid_from", { withTimezone: true }).notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    revocationReason: text("revocation_reason"),
    previousProfileId: uuid("previous_profile_id"),
    idempotencyKey: text("idempotency_key").notNull(),
    inputDigest: text("input_digest").notNull(),
    ...auditColumns(),
  },
  (table) => ({
    ownerWorkspaceIdUnique: uniqueIndex("ai_media_governance_profiles_owner_workspace_id_uq").on(
      table.ownerUserId,
      table.workspaceId,
      table.id,
    ),
    ownerWorkspaceIdempotencyUnique: uniqueIndex(
      "ai_media_governance_profiles_owner_workspace_idempotency_uq",
    ).on(table.ownerUserId, table.workspaceId, table.idempotencyKey),
    ownerWorkspaceInfluencerVersionUnique: uniqueIndex(
      "ai_media_governance_profiles_owner_workspace_influencer_version_uq",
    ).on(table.ownerUserId, table.workspaceId, table.influencerId, table.version),
    ownerWorkspaceStateExpiryIdx: index(
      "ai_media_governance_profiles_owner_workspace_state_expiry_idx",
    ).on(table.ownerUserId, table.workspaceId, table.state, table.expiresAt),
    previousProfileIdx: index("ai_media_governance_profiles_previous_profile_idx").on(table.previousProfileId),
    influencerTenantFk: foreignKey({
      columns: [table.ownerUserId, table.workspaceId, table.influencerId],
      foreignColumns: [aiMediaInfluencers.ownerUserId, aiMediaInfluencers.workspaceId, aiMediaInfluencers.id],
      name: "ai_media_governance_profiles_influencer_tenant_fk",
    }).onDelete("restrict"),
    avatarTenantFk: foreignKey({
      columns: [table.ownerUserId, table.workspaceId, table.avatarResourceId],
      foreignColumns: [
        aiMediaProviderResources.ownerUserId,
        aiMediaProviderResources.workspaceId,
        aiMediaProviderResources.id,
      ],
      name: "ai_media_governance_profiles_avatar_tenant_fk",
    }).onDelete("restrict"),
    voiceTenantFk: foreignKey({
      columns: [table.ownerUserId, table.workspaceId, table.voiceResourceId],
      foreignColumns: [
        aiMediaProviderResources.ownerUserId,
        aiMediaProviderResources.workspaceId,
        aiMediaProviderResources.id,
      ],
      name: "ai_media_governance_profiles_voice_tenant_fk",
    }).onDelete("restrict"),
    previousProfileTenantFk: foreignKey({
      columns: [table.ownerUserId, table.workspaceId, table.previousProfileId],
      foreignColumns: [table.ownerUserId, table.workspaceId, table.id],
      name: "ai_media_governance_profiles_previous_tenant_fk",
    }).onDelete("restrict"),
    stateCheck: check(
      "ai_media_governance_profiles_state_ck",
      sql`${table.state} IN ('active', 'revoked')`,
    ),
    basisCheck: check(
      "ai_media_governance_profiles_basis_ck",
      sql`${table.consentBasis} IN ('obtained', 'synthetic_not_applicable') AND ${table.rightsBasis} IN ('owned', 'licensed')`,
    ),
    evidenceCheck: check(
      "ai_media_governance_profiles_evidence_ck",
      sql`${table.proofDigest} ~ '^sha256:[0-9a-f]{64}$' AND ${table.evidenceDigest} ~ '^sha256:[0-9a-f]{64}$' AND ${table.inputDigest} ~ '^sha256:[0-9a-f]{64}$'`,
    ),
    documentShapeCheck: check(
      "ai_media_governance_profiles_document_shape_ck",
      sql`jsonb_typeof(${table.allowedUses}) = 'array' AND jsonb_array_length(${table.allowedUses}) > 0 AND ${table.allowedUses} <@ '["internal_preview", "organic_social", "paid_ads", "commercial"]'::jsonb AND jsonb_typeof(${table.territories}) = 'array' AND jsonb_array_length(${table.territories}) > 0 AND jsonb_typeof(${table.brandPolicy}) = 'object'`,
    ),
    revisionCheck: check(
      "ai_media_governance_profiles_revision_ck",
      sql`${table.version} > 0 AND length(btrim(${table.policyVersion})) BETWEEN 1 AND 64 AND length(btrim(${table.actorUserId})) > 0 AND length(btrim(${table.idempotencyKey})) > 0 AND ${table.expiresAt} > ${table.validFrom} AND ${table.previousProfileId} IS DISTINCT FROM ${table.id} AND ((${table.state} = 'revoked' AND ${table.revokedAt} IS NOT NULL AND length(btrim(${table.revocationReason})) BETWEEN 1 AND 500) OR (${table.state} = 'active' AND ${table.revokedAt} IS NULL AND ${table.revocationReason} IS NULL))`,
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
    providerAccountId: uuid("provider_account_id"),
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
    outputMediaAssetId: uuid("output_media_asset_id").references(
      (): AnyPgColumn => aiMediaMediaAssets.id,
      { onDelete: "set null" },
    ),
    governanceProfileId: uuid("governance_profile_id"),
    governanceEvidenceDigest: text("governance_evidence_digest"),
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
    providerJobUnique: uniqueIndex("ai_media_render_jobs_provider_account_job_uq")
      .on(table.providerAccountId, table.providerKey, table.providerJobId)
      .where(sql`${table.providerJobId} IS NOT NULL`),
    ownerWorkspaceIdUnique: uniqueIndex("ai_media_render_jobs_owner_workspace_id_uq").on(
      table.ownerUserId,
      table.workspaceId,
      table.id,
    ),
    ownerWorkspaceProviderAccountJobUnique: uniqueIndex("ai_media_render_jobs_owner_workspace_provider_account_job_uq")
      .on(table.ownerUserId, table.workspaceId, table.providerAccountId, table.providerKey, table.id),
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
    outputMediaAssetIdx: index("ai_media_render_jobs_output_media_asset_idx").on(table.outputMediaAssetId),
    governanceProfileIdx: index("ai_media_render_jobs_governance_profile_idx").on(table.governanceProfileId),
    governanceProfileTenantFk: foreignKey({
      columns: [table.ownerUserId, table.workspaceId, table.governanceProfileId],
      foreignColumns: [
        aiMediaGovernanceProfiles.ownerUserId,
        aiMediaGovernanceProfiles.workspaceId,
        aiMediaGovernanceProfiles.id,
      ],
      name: "ai_media_render_jobs_governance_profile_tenant_fk",
    }).onDelete("restrict"),
    providerAccountTenantFk: foreignKey({
      columns: [table.ownerUserId, table.workspaceId, table.providerAccountId, table.providerKey],
      foreignColumns: [
        aiMediaProviderAccounts.ownerUserId,
        aiMediaProviderAccounts.workspaceId,
        aiMediaProviderAccounts.id,
        aiMediaProviderAccounts.providerKey,
      ],
      name: "ai_media_render_jobs_provider_account_tenant_fk",
    }).onDelete("restrict"),
    providerIdentityCheck: check(
      "ai_media_render_jobs_provider_identity_ck",
      sql`${table.providerJobId} IS NULL OR (${table.providerAccountId} IS NOT NULL AND ${table.providerKey} IS NOT NULL)`,
    ),
    governanceEvidenceCheck: check(
      "ai_media_render_jobs_governance_evidence_ck",
      sql`(${table.governanceProfileId} IS NULL AND ${table.governanceEvidenceDigest} IS NULL) OR (${table.governanceProfileId} IS NOT NULL AND ${table.governanceEvidenceDigest} ~ '^sha256:[0-9a-f]{64}$')`,
    ),
  }),
);

export const aiMediaWebhookEvents = pgTable(
  "ai_media_webhook_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ...tenantColumns(),
    providerKey: text("provider_key").notNull(),
    providerAccountId: uuid("provider_account_id").notNull(),
    eventId: text("event_id").notNull(),
    providerJobId: text("provider_job_id").notNull(),
    renderJobId: uuid("render_job_id"),
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
    providerEventUnique: uniqueIndex("ai_media_webhook_events_provider_account_event_uq").on(
      table.providerAccountId,
      table.providerKey,
      table.eventId,
    ),
    providerJobStatusIdx: index("ai_media_webhook_events_provider_account_job_status_idx").on(
      table.providerAccountId,
      table.providerKey,
      table.providerJobId,
      table.status,
    ),
    ownerWorkspaceOccurredIdx: index("ai_media_webhook_events_owner_workspace_occurred_idx").on(
      table.ownerUserId,
      table.workspaceId,
      table.occurredAt,
    ),
    providerAccountTenantFk: foreignKey({
      columns: [table.ownerUserId, table.workspaceId, table.providerAccountId, table.providerKey],
      foreignColumns: [
        aiMediaProviderAccounts.ownerUserId,
        aiMediaProviderAccounts.workspaceId,
        aiMediaProviderAccounts.id,
        aiMediaProviderAccounts.providerKey,
      ],
      name: "ai_media_webhook_events_provider_account_tenant_fk",
    }).onDelete("restrict"),
    renderJobIdentityFk: foreignKey({
      columns: [
        table.ownerUserId,
        table.workspaceId,
        table.providerAccountId,
        table.providerKey,
        table.renderJobId,
      ],
      foreignColumns: [
        aiMediaRenderJobs.ownerUserId,
        aiMediaRenderJobs.workspaceId,
        aiMediaRenderJobs.providerAccountId,
        aiMediaRenderJobs.providerKey,
        aiMediaRenderJobs.id,
      ],
      name: "ai_media_webhook_events_render_job_identity_fk",
    }).onDelete("restrict"),
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
    ownerWorkspaceKindChecksumActiveUnique: uniqueIndex("ai_media_assets_owner_workspace_kind_checksum_active_uq")
      .on(table.ownerUserId, table.workspaceId, table.kind, table.checksum)
      .where(sql`${table.deletedAt} IS NULL AND ${table.checksum} IS NOT NULL`),
    ownerWorkspaceIdUnique: uniqueIndex("ai_media_assets_owner_workspace_id_uq").on(
      table.ownerUserId,
      table.workspaceId,
      table.id,
    ),
    ownerWorkspaceIdChecksumUnique: uniqueIndex("ai_media_assets_owner_workspace_id_checksum_uq").on(
      table.ownerUserId,
      table.workspaceId,
      table.id,
      table.checksum,
    ),
  }),
);

/**
 * Immutable quality decisions bound to the exact checksum that was evaluated.
 * Re-evaluation appends a revision instead of mutating prior review evidence.
 */
export const aiMediaQualityReviews = pgTable(
  "ai_media_quality_reviews",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ...tenantColumns(),
    mediaAssetId: uuid("media_asset_id").notNull(),
    assetChecksum: text("asset_checksum").notNull(),
    evaluatorType: text("evaluator_type").notNull().default("human"),
    decision: text("decision").notNull(),
    version: integer("version").notNull().default(1),
    criteria: jsonb("criteria").$type<Record<string, unknown>>().notNull(),
    notes: text("notes"),
    evidenceDigest: text("evidence_digest").notNull(),
    actorUserId: text("actor_user_id").notNull(),
    previousReviewId: uuid("previous_review_id"),
    idempotencyKey: text("idempotency_key").notNull(),
    inputDigest: text("input_digest").notNull(),
    ...auditColumns(),
  },
  (table) => ({
    ownerWorkspaceIdUnique: uniqueIndex("ai_media_quality_reviews_owner_workspace_id_uq").on(
      table.ownerUserId,
      table.workspaceId,
      table.id,
    ),
    ownerWorkspaceIdempotencyUnique: uniqueIndex(
      "ai_media_quality_reviews_owner_workspace_idempotency_uq",
    ).on(table.ownerUserId, table.workspaceId, table.idempotencyKey),
    ownerWorkspaceAssetCreatedIdx: index("ai_media_quality_reviews_owner_workspace_asset_created_idx").on(
      table.ownerUserId,
      table.workspaceId,
      table.mediaAssetId,
      table.createdAt,
    ),
    ownerWorkspaceAssetVersionUnique: uniqueIndex("ai_media_quality_reviews_owner_workspace_asset_version_uq").on(
      table.ownerUserId,
      table.workspaceId,
      table.mediaAssetId,
      table.version,
    ),
    ownerWorkspaceDecisionCreatedIdx: index(
      "ai_media_quality_reviews_owner_workspace_decision_created_idx",
    ).on(table.ownerUserId, table.workspaceId, table.decision, table.createdAt),
    previousReviewIdx: index("ai_media_quality_reviews_previous_review_idx").on(table.previousReviewId),
    mediaAssetChecksumTenantFk: foreignKey({
      columns: [table.ownerUserId, table.workspaceId, table.mediaAssetId, table.assetChecksum],
      foreignColumns: [
        aiMediaMediaAssets.ownerUserId,
        aiMediaMediaAssets.workspaceId,
        aiMediaMediaAssets.id,
        aiMediaMediaAssets.checksum,
      ],
      name: "ai_media_quality_reviews_asset_checksum_tenant_fk",
    }).onDelete("restrict"),
    previousReviewTenantFk: foreignKey({
      columns: [table.ownerUserId, table.workspaceId, table.previousReviewId],
      foreignColumns: [table.ownerUserId, table.workspaceId, table.id],
      name: "ai_media_quality_reviews_previous_tenant_fk",
    }).onDelete("restrict"),
    evaluatorTypeCheck: check(
      "ai_media_quality_reviews_evaluator_type_ck",
      sql`${table.evaluatorType} = 'human'`,
    ),
    decisionCheck: check(
      "ai_media_quality_reviews_decision_ck",
      sql`${table.decision} IN ('approved', 'rejected', 'needs_review')`,
    ),
    evidenceCheck: check(
      "ai_media_quality_reviews_evidence_ck",
      sql`${table.assetChecksum} ~ '^[0-9a-f]{64}$' AND ${table.evidenceDigest} ~ '^sha256:[0-9a-f]{64}$' AND ${table.inputDigest} ~ '^sha256:[0-9a-f]{64}$' AND length(btrim(${table.actorUserId})) > 0 AND length(btrim(${table.idempotencyKey})) > 0`,
    ),
    criteriaShapeCheck: check(
      "ai_media_quality_reviews_criteria_shape_ck",
      sql`CASE WHEN jsonb_typeof(${table.criteria}) = 'object' AND ${table.criteria} ?& ARRAY['naturalMovement', 'eyeContact', 'speechQuality', 'lighting', 'realism', 'brandConsistency', 'verticalQuality'] AND (${table.criteria} - 'naturalMovement' - 'eyeContact' - 'speechQuality' - 'lighting' - 'realism' - 'brandConsistency' - 'verticalQuality') = '{}'::jsonb AND jsonb_typeof(${table.criteria}->'naturalMovement') = 'number' AND jsonb_typeof(${table.criteria}->'eyeContact') = 'number' AND jsonb_typeof(${table.criteria}->'speechQuality') = 'number' AND jsonb_typeof(${table.criteria}->'lighting') = 'number' AND jsonb_typeof(${table.criteria}->'realism') = 'number' AND jsonb_typeof(${table.criteria}->'brandConsistency') = 'number' AND jsonb_typeof(${table.criteria}->'verticalQuality') = 'number' AND (${table.criteria}->>'naturalMovement') ~ '^[1-5]$' AND (${table.criteria}->>'eyeContact') ~ '^[1-5]$' AND (${table.criteria}->>'speechQuality') ~ '^[1-5]$' AND (${table.criteria}->>'lighting') ~ '^[1-5]$' AND (${table.criteria}->>'realism') ~ '^[1-5]$' AND (${table.criteria}->>'brandConsistency') ~ '^[1-5]$' AND (${table.criteria}->>'verticalQuality') ~ '^[1-5]$' THEN CASE WHEN (${table.criteria}->>'naturalMovement')::integer <= 2 OR (${table.criteria}->>'eyeContact')::integer <= 2 OR (${table.criteria}->>'speechQuality')::integer <= 2 OR (${table.criteria}->>'lighting')::integer <= 2 OR (${table.criteria}->>'realism')::integer <= 2 OR (${table.criteria}->>'brandConsistency')::integer <= 2 OR (${table.criteria}->>'verticalQuality')::integer <= 2 THEN ${table.decision} = 'rejected' WHEN (${table.criteria}->>'naturalMovement')::integer >= 4 AND (${table.criteria}->>'eyeContact')::integer >= 4 AND (${table.criteria}->>'speechQuality')::integer >= 4 AND (${table.criteria}->>'lighting')::integer >= 4 AND (${table.criteria}->>'realism')::integer >= 4 AND (${table.criteria}->>'brandConsistency')::integer >= 4 AND (${table.criteria}->>'verticalQuality')::integer >= 4 THEN ${table.decision} = 'approved' ELSE ${table.decision} = 'needs_review' END ELSE false END AND (${table.notes} IS NULL OR length(${table.notes}) <= 2000)`,
    ),
    revisionCheck: check(
      "ai_media_quality_reviews_revision_ck",
      sql`${table.version} > 0 AND ${table.previousReviewId} IS DISTINCT FROM ${table.id}`,
    ),
  }),
);

/**
 * Durable, provider-neutral queue that imports a completed render artifact into
 * tenant-owned storage. Remote URLs are private worker inputs and must never be
 * returned by public media-library DTOs.
 */
export const aiMediaAssetIngestJobs = pgTable(
  "ai_media_asset_ingest_jobs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ...tenantColumns(),
    renderJobId: uuid("render_job_id").notNull().references(() => aiMediaRenderJobs.id, { onDelete: "cascade" }),
    providerKey: text("provider_key").notNull(),
    remoteArtifactRef: text("remote_artifact_ref"),
    remoteUrl: text("remote_url"),
    expectedMimeType: text("expected_mime_type").notNull().default("video/mp4"),
    state: text("state").notNull().default("queued"),
    attempts: integer("attempts").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(3),
    leaseRecoveries: integer("lease_recoveries").notNull().default(0),
    maxLeaseRecoveries: integer("max_lease_recoveries").notNull().default(3),
    availableAt: timestamp("available_at", { withTimezone: true }).notNull().defaultNow(),
    leaseOwner: text("lease_owner"),
    leaseToken: text("lease_token"),
    leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }),
    fencingToken: integer("fencing_token").notNull().default(0),
    mediaAssetId: uuid("media_asset_id").references(() => aiMediaMediaAssets.id, { onDelete: "set null" }),
    ownedObjectKey: text("owned_object_key"),
    sha256: text("sha256"),
    sizeBytes: bigint("size_bytes", { mode: "number" }),
    errorCode: text("error_code"),
    errorMessage: text("error_message"),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    deadLetterAt: timestamp("dead_letter_at", { withTimezone: true }),
    ...auditColumns(),
  },
  (table) => ({
    ownerWorkspaceRenderUnique: uniqueIndex("ai_media_asset_ingest_jobs_owner_workspace_render_uq").on(
      table.ownerUserId,
      table.workspaceId,
      table.renderJobId,
    ),
    queueIdx: index("ai_media_asset_ingest_jobs_queue_idx").on(
      table.state,
      table.availableAt,
      table.leaseExpiresAt,
      table.createdAt,
    ),
    ownerWorkspaceLeaseIdx: index("ai_media_asset_ingest_jobs_owner_workspace_lease_idx").on(
      table.ownerUserId,
      table.workspaceId,
      table.leaseOwner,
      table.leaseExpiresAt,
    ),
    deadLetterIdx: index("ai_media_asset_ingest_jobs_dead_letter_idx").on(table.deadLetterAt),
    completedUnlinkedIdx: index("ai_media_asset_ingest_jobs_completed_unlinked_idx").on(
      table.state,
      table.mediaAssetId,
      table.completedAt,
      table.createdAt,
    ),
    sourceReferenceCheck: check(
      "ai_media_asset_ingest_jobs_source_reference_ck",
      sql`${table.remoteArtifactRef} IS NOT NULL OR ${table.remoteUrl} IS NOT NULL`,
    ),
    attemptsCheck: check(
      "ai_media_asset_ingest_jobs_attempts_ck",
      sql`${table.attempts} >= 0 AND ${table.maxAttempts} > 0 AND ${table.leaseRecoveries} >= 0 AND ${table.maxLeaseRecoveries} > 0`,
    ),
  }),
);

export const aiMediaPublishingJobs = pgTable(
  "ai_media_publishing_jobs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ...tenantColumns(),
    videoId: uuid("video_id").references(() => aiMediaVideos.id, { onDelete: "cascade" }),
    mediaAssetId: uuid("media_asset_id").references(() => aiMediaMediaAssets.id, { onDelete: "set null" }),
    providerAccountId: uuid("provider_account_id").references(() => aiMediaProviderAccounts.id, { onDelete: "set null" }),
    platform: text("platform").notNull(),
    mode: text("mode").notNull().default("manual"),
    idempotencyKey: text("idempotency_key").notNull(),
    status: text("status").notNull().default("pending_approval"),
    approvalStatus: text("approval_status").notNull().default("required"),
    previewDigest: text("preview_digest"),
    approvalEvidence: jsonb("approval_evidence").$type<Record<string, unknown>>(),
    scheduledFor: timestamp("scheduled_for", { withTimezone: true }),
    dueAt: timestamp("due_at", { withTimezone: true }),
    availableAt: timestamp("available_at", { withTimezone: true }).notNull().defaultNow(),
    leaseOwner: text("lease_owner"),
    leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }),
    fencingToken: integer("fencing_token").notNull().default(0),
    attempts: integer("attempts").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(3),
    request: jsonb("request").$type<Record<string, unknown>>().notNull().default({}),
    failureCode: text("failure_code"),
    errorMessage: text("error_message"),
    deadLetterAt: timestamp("dead_letter_at", { withTimezone: true }),
    reconcileAfter: timestamp("reconcile_after", { withTimezone: true }),
    reconciliationStatus: text("reconciliation_status").notNull().default("not_required"),
    ...auditColumns(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (table) => ({
    ownerWorkspaceIdempotencyUnique: uniqueIndex("ai_media_publishing_jobs_owner_workspace_idempotency_uq").on(
      table.ownerUserId,
      table.workspaceId,
      table.idempotencyKey,
    ),
    dispatchIdx: index("ai_media_publishing_jobs_dispatch_idx").on(
      table.status,
      table.approvalStatus,
      table.availableAt,
      table.dueAt,
      table.leaseExpiresAt,
    ),
    ownerWorkspaceAssetIdx: index("ai_media_publishing_jobs_owner_workspace_asset_idx").on(
      table.ownerUserId,
      table.workspaceId,
      table.mediaAssetId,
    ),
    deadLetterIdx: index("ai_media_publishing_jobs_dead_letter_idx").on(table.deadLetterAt),
    reconcileIdx: index("ai_media_publishing_jobs_reconcile_idx").on(
      table.reconciliationStatus,
      table.reconcileAfter,
    ),
    mediaReferenceCheck: check(
      "ai_media_publishing_jobs_media_reference_ck",
      sql`${table.videoId} IS NOT NULL OR ${table.mediaAssetId} IS NOT NULL`,
    ),
  }),
);

export const aiMediaPublications = pgTable(
  "ai_media_publications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ...tenantColumns(),
    publishingJobId: uuid("publishing_job_id").notNull().references(() => aiMediaPublishingJobs.id, { onDelete: "cascade" }),
    videoId: uuid("video_id").references(() => aiMediaVideos.id, { onDelete: "cascade" }),
    mediaAssetId: uuid("media_asset_id").references(() => aiMediaMediaAssets.id, { onDelete: "set null" }),
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
      table.ownerUserId,
      table.workspaceId,
      table.platform,
      table.externalPublicationId,
    ),
    ownerWorkspacePublishedIdx: index("ai_media_publications_owner_workspace_published_idx").on(
      table.ownerUserId,
      table.workspaceId,
      table.publishedAt,
    ),
    ownerWorkspaceMediaAssetIdx: index("ai_media_publications_owner_workspace_media_asset_idx").on(
      table.ownerUserId,
      table.workspaceId,
      table.mediaAssetId,
    ),
    mediaReferenceCheck: check(
      "ai_media_publications_media_reference_ck",
      sql`${table.videoId} IS NOT NULL OR ${table.mediaAssetId} IS NOT NULL`,
    ),
  }),
);

export const aiMediaAnalyticsSnapshots = pgTable(
  "ai_media_analytics_snapshots",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ...tenantColumns(),
    publicationId: uuid("publication_id").notNull().references(() => aiMediaPublications.id, { onDelete: "cascade" }),
    platform: text("platform"),
    periodStart: timestamp("period_start", { withTimezone: true }),
    periodEnd: timestamp("period_end", { withTimezone: true }),
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
      table.ownerUserId,
      table.workspaceId,
      table.publicationId,
      table.capturedAt,
    ),
    ownerWorkspaceCapturedIdx: index("ai_media_analytics_snapshots_owner_workspace_captured_idx").on(
      table.ownerUserId,
      table.workspaceId,
      table.capturedAt,
    ),
    ownerWorkspacePlatformCapturedIdx: index("ai_media_analytics_snapshots_owner_workspace_platform_captured_idx").on(
      table.ownerUserId,
      table.workspaceId,
      table.platform,
      table.capturedAt,
    ),
    publicationPeriodIdx: index("ai_media_analytics_snapshots_publication_period_idx").on(
      table.publicationId,
      table.periodStart,
      table.periodEnd,
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
    sourceExternalUnique: uniqueIndex("ai_media_analytics_events_source_external_uq").on(
      table.ownerUserId,
      table.workspaceId,
      table.source,
      table.externalEventId,
    ),
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
    contentHash: text("content_hash"),
    rightsStatus: text("rights_status").notNull().default("unknown"),
    moderationStatus: text("moderation_status").notNull().default("pending"),
    moderationEvidence: jsonb("moderation_evidence").$type<Record<string, unknown>>().notNull().default({}),
    automationEvidence: jsonb("automation_evidence").$type<Record<string, unknown>>().notNull().default({}),
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
    ownerWorkspaceContentHashIdx: index("ai_media_source_items_owner_workspace_content_hash_idx").on(
      table.ownerUserId,
      table.workspaceId,
      table.contentHash,
    ),
    ownerWorkspaceModerationIdx: index("ai_media_source_items_owner_workspace_moderation_idx").on(
      table.ownerUserId,
      table.workspaceId,
      table.moderationStatus,
      table.updatedAt,
    ),
  }),
);

export const aiMediaOrchestrationRuns = pgTable(
  "ai_media_orchestration_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ...tenantColumns(),
    sourceItemId: uuid("source_item_id").references(() => aiMediaSourceItems.id, { onDelete: "set null" }),
    runType: text("run_type").notNull(),
    mode: text("mode").notNull().default("manual"),
    status: text("status").notNull().default("queued"),
    stateVersion: integer("state_version").notNull().default(0),
    runPayload: jsonb("run_payload").$type<Record<string, unknown>>().notNull().default({}),
    idempotencyKey: text("idempotency_key").notNull(),
    policyEvidence: jsonb("policy_evidence").$type<Record<string, unknown>>().notNull().default({}),
    automationEvidence: jsonb("automation_evidence").$type<Record<string, unknown>>().notNull().default({}),
    dueAt: timestamp("due_at", { withTimezone: true }),
    availableAt: timestamp("available_at", { withTimezone: true }).notNull().defaultNow(),
    leaseOwner: text("lease_owner"),
    leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }),
    fencingToken: integer("fencing_token").notNull().default(0),
    attempts: integer("attempts").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(3),
    deadLetterAt: timestamp("dead_letter_at", { withTimezone: true }),
    failureCode: text("failure_code"),
    ...auditColumns(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (table) => ({
    ownerWorkspaceIdempotencyUnique: uniqueIndex("ai_media_orchestration_runs_owner_workspace_idempotency_uq").on(
      table.ownerUserId,
      table.workspaceId,
      table.idempotencyKey,
    ),
    queueIdx: index("ai_media_orchestration_runs_queue_idx").on(
      table.status,
      table.availableAt,
      table.dueAt,
      table.leaseExpiresAt,
    ),
    ownerWorkspaceSourceUnique: uniqueIndex("ai_media_orchestration_runs_owner_workspace_source_uq").on(
      table.ownerUserId,
      table.workspaceId,
      table.sourceItemId,
    ).where(sql`${table.sourceItemId} IS NOT NULL`),
    deadLetterIdx: index("ai_media_orchestration_runs_dead_letter_idx").on(table.deadLetterAt),
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
    leaseOwner: text("lease_owner"),
    leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }),
    fencingToken: integer("fencing_token").notNull().default(0),
    deadLetterAt: timestamp("dead_letter_at", { withTimezone: true }),
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
    dispatchIdx: index("ai_media_outbox_dispatch_idx").on(
      table.status,
      table.availableAt,
      table.leaseExpiresAt,
      table.createdAt,
    ),
    ownerWorkspaceLeaseIdx: index("ai_media_outbox_owner_workspace_lease_idx").on(
      table.ownerUserId,
      table.workspaceId,
      table.leaseOwner,
      table.leaseExpiresAt,
    ),
    deadLetterIdx: index("ai_media_outbox_dead_letter_idx").on(table.deadLetterAt),
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
  governanceProfiles: aiMediaGovernanceProfiles,
  renderJobs: aiMediaRenderJobs,
  webhookEvents: aiMediaWebhookEvents,
  mediaAssets: aiMediaMediaAssets,
  qualityReviews: aiMediaQualityReviews,
  publishingJobs: aiMediaPublishingJobs,
  publications: aiMediaPublications,
  analyticsSnapshots: aiMediaAnalyticsSnapshots,
  analyticsEvents: aiMediaAnalyticsEvents,
  generationHistory: aiMediaGenerationHistory,
  costLedger: aiMediaCostLedger,
  sourceItems: aiMediaSourceItems,
  orchestrationRuns: aiMediaOrchestrationRuns,
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
export type AiMediaGovernanceProfileRow = typeof aiMediaGovernanceProfiles.$inferSelect;
export type NewAiMediaGovernanceProfileRow = typeof aiMediaGovernanceProfiles.$inferInsert;
export type AiMediaQualityReviewRow = typeof aiMediaQualityReviews.$inferSelect;
export type NewAiMediaQualityReviewRow = typeof aiMediaQualityReviews.$inferInsert;
export type AiMediaWebhookEventRow = typeof aiMediaWebhookEvents.$inferSelect;
export type NewAiMediaWebhookEventRow = typeof aiMediaWebhookEvents.$inferInsert;
export type AiMediaOutboxRow = typeof aiMediaOutbox.$inferSelect;
export type NewAiMediaOutboxRow = typeof aiMediaOutbox.$inferInsert;
export type AiMediaPublishingJobRow = typeof aiMediaPublishingJobs.$inferSelect;
export type NewAiMediaPublishingJobRow = typeof aiMediaPublishingJobs.$inferInsert;
export type AiMediaOrchestrationRunRow = typeof aiMediaOrchestrationRuns.$inferSelect;
export type NewAiMediaOrchestrationRunRow = typeof aiMediaOrchestrationRuns.$inferInsert;
