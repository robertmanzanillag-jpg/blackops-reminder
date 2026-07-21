import type { Express, NextFunction, Request, Response } from "express";
import { Router } from "express";
import { z } from "zod";
import {
  AI_MEDIA_STUDIO_API_BASE,
  createGenerationRequestSchema,
  dashboardResponseSchema,
  mediaJobResponseSchema,
  mediaJobsResponseSchema,
  mediaStudioOptionsResponseSchema,
  type MediaJob,
} from "../../shared/ai-media-studio";
import {
  createInfluencerRequestSchema,
  assetDeliverySchema,
  influencerListRequestSchema,
  influencerListResponseSchema,
  influencerResponseSchema,
  mediaLibraryRequestSchema,
  mediaLibraryResponseSchema,
  providerResourceListRequestSchema,
  providerResourceListResponseSchema,
  updateInfluencerRequestSchema,
  type ProviderResource,
} from "../../shared/ai-media-studio-core";
import { generateScriptVariantsRequestSchema } from "../../shared/ai-media-studio-scripts";
import {
  assetQualityReviewResponseSchema,
  createAssetQualityReviewRequestSchema,
  createInfluencerGovernanceProfileRequestSchema,
  influencerGovernanceProfileResponseSchema,
  revokeInfluencerGovernanceProfileRequestSchema,
} from "../../shared/ai-media-studio-governance";
import {
  analyticsSummarySchema,
  attributionSchema,
  automationPolicySchema,
  createPublishingJobRequestSchema,
  cursorPageRequestSchema,
  publishingJobListRequestSchema,
  publishingJobListResponseSchema,
  publishingJobSchema,
  publishingConnectionsResponseSchema,
  publishingPreviewSchema,
  socialPlatformSchema,
  sourceItemSchema,
  paginatedResponseSchema,
  type AnalyticsSummary as PublicAnalyticsSummary,
  type Attribution,
  type PublishingJob,
  type SourceItem,
} from "../../shared/ai-media-studio-operations";
import { getCurrentUserId } from "../user-context";
import type { CoreCatalogRepositories } from "./core/runtime";
import {
  createCoreCatalogRuntime,
  toPublicInfluencer,
  toPublicMediaAsset,
  type CoreCatalogRuntime,
} from "./core/runtime";
import { InfluencerSlugConflictError } from "./core/influencer-domain";
import {
  CoreDomainNotFoundError,
  CoreDomainValidationError,
  type CanonicalMediaResource,
  type TenantScope,
} from "./core/resource-domain";
import type { MediaGenerationJob } from "./domain";
import { AnalyticsValidationError, type AnalyticsSummary as DomainAnalyticsSummary } from "./analytics/domain";
import { InMemoryMediaJobQueue, InMemoryMediaJobRepository } from "./in-memory";
import type { MediaJobQueue, MediaJobRepository, VideoProvider } from "./ports";
import { FakeVideoProvider } from "./providers/fake-video-provider";
import {
  createHeyGenResourceResolver,
  HeyGenVideoProvider,
  parseHeyGenResourceMap,
  type HeyGenResourceMap,
} from "./providers/heygen-video-provider";
import { DeterministicScriptService } from "./script-service";
import { AiMediaStudioService, MediaStudioError } from "./service";
import {
  deriveVerifiedWebhookEnvelope,
  verifyHeyGenWebhookWithRotation,
} from "./webhook-security";
import {
  createDrizzleProviderWebhookAccountResolver,
  createEnvironmentSecretReferenceResolver,
  isResolvedWebhookAccountValid,
  isSafeProviderKey,
  isSafeProviderWebhookEndpointKey,
  type ProviderWebhookAccountResolver,
} from "./provider-webhooks";
import {
  createDefaultDurableRepository,
  MediaStudioPersistenceUnavailableError,
  selectMediaJobRepository,
  type MediaStudioPersistenceStatus,
} from "./persistence/runtime";
import {
  createOperationsRuntime,
  type OperationsRuntime,
  type OperationsRuntimeDependencies,
} from "./operations-runtime";
import {
  PublishingInvariantError,
  PublishingPolicyDeniedError,
  type PublicationJob,
  type PublicPublication,
} from "./publishing/domain";
import type { PublishingSubmissionGate } from "./publishing/worker";
import type { CanonicalSourceItem } from "./sources/contracts";
import { SourceCursorError } from "./sources/source-pagination";
import {
  InMemoryAssetIngestRepository,
  createProductionAssetRuntimeFromEnvironment,
  type AssetDeliverySigner,
  type ProductionAssetAdapterDependencies,
  type ProductionAssetEnvironment,
  type AssetIngestJob,
  type AssetIngestRepository,
  type AssetIngestWorkerHooks,
} from "./assets";
import type { GovernanceRepository } from "./governance/contracts";
import {
  GovernanceConflictError,
  GovernanceGateError,
  GovernanceNotFoundError,
  GovernanceValidationError,
} from "./governance/contracts";
import { InMemoryGovernanceRepository } from "./governance/in-memory-repository";
import {
  GovernanceService,
  toPublicAssetQualityReview,
  toPublicInfluencerGovernanceProfile,
} from "./governance/service";

export interface AiMediaStudioDependencies {
  repository?: MediaJobRepository;
  queue?: MediaJobQueue;
  providers?: VideoProvider[];
  defaultProviderKey?: string;
  webhookSecrets?: Record<string, string | undefined>;
  /** Resolves an opaque public endpoint to server-only tenant/account secret material. */
  resolveProviderWebhookAccount?: ProviderWebhookAccountResolver;
  heygenResourceMap?: HeyGenResourceMap;
  allowedAssetHosts?: ReadonlySet<string>;
  runtimeEnvironment?: string;
  databaseUrl?: string;
  createDurableRepository?: () => MediaJobRepository;
  coreRepositories?: CoreCatalogRepositories;
  createDurableCoreRepositories?: () => CoreCatalogRepositories;
  workspaceId?: string;
  seedCoreDefaults?: boolean;
  governanceRepository?: GovernanceRepository;
  createDurableGovernanceRepository?: () => GovernanceRepository;
  seedGovernanceDefaults?: boolean;
  operations?: OperationsRuntimeDependencies;
  assetIngestRepository?: AssetIngestRepository;
  assetDeliverySigner?: AssetDeliverySigner;
  /** Server-only production asset configuration; never serialized into Studio DTOs. */
  productionAssetEnvironment?: ProductionAssetEnvironment;
  /** Transport/client seams for construction tests; production callers normally omit this. */
  productionAssetAdapterDependencies?: ProductionAssetAdapterDependencies;
  /** Must probe the live reader, owned storage, signer, and worker process; absent by default. */
  assetIngestWorkerReadiness?: { isReady(): boolean | Promise<boolean> };
}
export interface AiMediaStudioRuntime {
  service: AiMediaStudioService;
  core: CoreCatalogRuntime;
  router: Router;
  persistence: MediaStudioPersistenceStatus;
  operations: OperationsRuntime;
  governance: GovernanceService;
  governancePersistence: MediaStudioPersistenceStatus;
  publishingSubmissionGate: PublishingSubmissionGate;
  assetIngestRepository?: AssetIngestRepository;
  assetIngestHooks: AssetIngestWorkerHooks;
  reconcileCompletedAssetIngests(limit?: number): Promise<number>;
}

function toPublicJob(job: MediaGenerationJob): MediaJob {
  return {
    id: job.id, generationId: job.generationId, title: job.title || "Untitled video",
    influencerName: job.influencerName ?? "", status: job.status, stage: job.stage ?? "queued",
    progress: job.progress, aspectRatio: job.request.aspectRatio, language: job.request.language,
    estimatedCostUsd: job.estimatedCostUsd ?? 0, actualCostUsd: job.actualCostUsd,
    attempt: job.attempts, maxAttempts: job.maxAttempts, createdAt: job.createdAt,
    updatedAt: job.updatedAt, estimatedCompletionAt: job.estimatedCompletionAt, error: job.error,
    asset: job.outputAssetId ? { id: job.outputAssetId, mimeType: "video/mp4" } : undefined,
  };
}

function asyncRoute(handler: (req: Request, res: Response) => Promise<void>) {
  return (req: Request, res: Response, next: NextFunction) => handler(req, res).catch(next);
}

function envAssetHosts(): ReadonlySet<string> {
  return new Set((process.env.AI_MEDIA_STUDIO_ASSET_HOST_ALLOWLIST ?? "").split(",").map((host) => host.trim().toLowerCase()).filter(Boolean));
}

function toPublicResource(resource: CanonicalMediaResource): ProviderResource {
  return {
    id: resource.id,
    kind: resource.kind,
    name: resource.name,
    status: resource.status,
    language: resource.language,
    accent: resource.accent,
    gender: resource.gender,
    previewUrl: resource.previewUrl,
    thumbnailUrl: resource.thumbnailUrl,
    synchronizedAt: resource.synchronizedAt,
  };
}

function queryValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function queryValues(value: unknown): string[] | undefined {
  if (typeof value === "string") return [value];
  if (Array.isArray(value) && value.every((item) => typeof item === "string")) return value;
  return undefined;
}

function parseAssetTenantId(value: string): [workspaceId: string, ownerUserId: string] {
  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed) || parsed.length !== 2 || parsed.some((part) => typeof part !== "string" || !part.trim())) throw new Error("invalid");
    return parsed as [string, string];
  } catch {
    throw new Error("Artifact ingest tenant is invalid");
  }
}

function createDefaultDurableAssetIngestRepository(): AssetIngestRepository {
  let pending: Promise<AssetIngestRepository> | undefined;
  const load = () => pending ??= Promise.all([import("../db"), import("./assets/drizzle-ingest-repository")])
    .then(([database, adapter]) => new adapter.DrizzleAssetIngestRepository(database.db));
  return {
    enqueue: async (...args) => (await load()).enqueue(...args),
    getForTenant: async (...args) => (await load()).getForTenant(...args),
    findByRenderJob: async (...args) => (await load()).findByRenderJob(...args),
    claimDue: async (...args) => (await load()).claimDue(...args),
    complete: async (...args) => (await load()).complete(...args),
    attachMediaAsset: async (...args) => (await load()).attachMediaAsset(...args),
    listCompletedUnlinked: async (...args) => (await load()).listCompletedUnlinked(...args),
    fail: async (...args) => (await load()).fail(...args),
    reconcileExpiredLeases: async (...args) => (await load()).reconcileExpiredLeases(...args),
    listDeadLetters: async (...args) => (await load()).listDeadLetters(...args),
  };
}

function configuredDatabase(value: string | undefined): boolean {
  const databaseUrl = value?.trim();
  return Boolean(databaseUrl && !/^(change[-_ ]?me|replace[-_ ]?me|your[-_ ]|example|placeholder)/iu.test(databaseUrl));
}

function createDefaultProviderWebhookAccountResolver(workspaceId: string): ProviderWebhookAccountResolver {
  let pending: Promise<ProviderWebhookAccountResolver> | undefined;
  return async (input) => {
    pending ??= import("../db").then(({ db }) => createDrizzleProviderWebhookAccountResolver({
      db,
      workspaceId,
      resolveSecretRef: createEnvironmentSecretReferenceResolver(),
    }));
    return (await pending)(input);
  };
}

function createDefaultDurableGovernanceRepository(): GovernanceRepository {
  let pending: Promise<GovernanceRepository> | undefined;
  const load = () => pending ??= Promise.all([import("../db"), import("./governance/drizzle-repository")])
    .then(([database, adapter]) => new adapter.DrizzleGovernanceRepository(database.db));
  return new Proxy({}, {
    get: (_target, property) => async (...args: unknown[]) => {
      const repository = await load();
      const method = Reflect.get(repository, property);
      if (typeof method !== "function") throw new Error(`Governance repository method ${String(property)} is unavailable`);
      return Reflect.apply(method, repository, args);
    },
  }) as GovernanceRepository;
}

function selectGovernanceRepository(dependencies: AiMediaStudioDependencies, runtimeEnvironment: string | undefined, databaseUrl: string | undefined): {
  repository: GovernanceRepository;
  status: MediaStudioPersistenceStatus;
} {
  if (dependencies.governanceRepository) {
    return { repository: dependencies.governanceRepository, status: { mode: "injected", available: true, durable: false, reason: "Governance repository supplied by the composition caller" } };
  }
  if (configuredDatabase(databaseUrl)) {
    try {
      return {
        repository: (dependencies.createDurableGovernanceRepository ?? createDefaultDurableGovernanceRepository)(),
        status: { mode: "drizzle", available: true, durable: true, reason: "PostgreSQL/Drizzle governance persistence selected" },
      };
    } catch (error) {
      const reason = `Governance persistence initialization failed: ${error instanceof Error ? error.message : "unknown error"}`;
      return { repository: unavailableGovernanceRepository(reason), status: { mode: "unavailable", available: false, durable: false, reason } };
    }
  }
  const environment = runtimeEnvironment?.trim().toLowerCase();
  if (environment === "development" || environment === "test") {
    return {
      repository: new InMemoryGovernanceRepository(),
      status: { mode: "memory", available: true, durable: false, reason: `Ephemeral governance persistence allowed for ${environment}` },
    };
  }
  const reason = "DATABASE_URL is required outside development/test; in-memory governance persistence is disabled";
  return { repository: unavailableGovernanceRepository(reason), status: { mode: "unavailable", available: false, durable: false, reason } };
}

function unavailableGovernanceRepository(reason: string): GovernanceRepository {
  return new Proxy({}, {
    get: () => async () => { throw new MediaStudioPersistenceUnavailableError(reason); },
  }) as GovernanceRepository;
}

function paginate<T extends { id: string }>(items: T[], cursor: string | undefined, limit: number): {
  values: T[];
  nextCursor: string | null;
  hasMore: boolean;
} {
  let start = 0;
  if (cursor) {
    const index = items.findIndex((item) => item.id === cursor);
    if (index < 0) throw new CoreDomainValidationError("Cursor is not available in this result set");
    start = index + 1;
  }
  const values = items.slice(start, start + limit);
  const hasMore = start + values.length < items.length;
  return { values, nextCursor: hasMore ? values.at(-1)?.id ?? null : null, hasMore };
}

function requireCapability(status: MediaStudioPersistenceStatus, label: string) {
  return (_req: Request, res: Response, next: NextFunction) => {
    if (status.available) { next(); return; }
    res.status(503).json({ error: `${label} persistence unavailable`, code: "persistence_unavailable" });
  };
}

const idSchema = z.string().trim().min(1).max(128).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u);
const digestActionSchema = z.object({ previewDigest: z.string().regex(/^sha256:[a-f0-9]{64}$/u) }).strict();
const publishingPreviewRequestSchema = createPublishingJobRequestSchema
  .innerType()
  .omit({ previewDigest: true })
  .strict()
  .superRefine(({ timezone, schedule }, context) => {
    if (timezone !== schedule.timezone) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "timezone must match the publishing schedule", path: ["timezone"] });
    }
  });
const rejectActionSchema = digestActionSchema.extend({ reason: z.string().trim().min(1).max(1_000) }).strict();
const emptyActionSchema = z.object({}).strict().default({});
const windowQuerySchema = z.object({
  platform: socialPlatformSchema.optional(),
  from: z.string().datetime({ offset: true }).optional(),
  to: z.string().datetime({ offset: true }).optional(),
}).strict().superRefine((value, context) => {
  if ((value.from === undefined) !== (value.to === undefined)) context.addIssue({ code: z.ZodIssueCode.custom, message: "from and to must be supplied together" });
  if (value.from && value.to && Date.parse(value.from) >= Date.parse(value.to)) context.addIssue({ code: z.ZodIssueCode.custom, message: "from must be before to", path: ["to"] });
});
const attributionQuerySchema = cursorPageRequestSchema.extend({
  platform: socialPlatformSchema.optional(),
  from: z.string().datetime({ offset: true }).optional(),
  to: z.string().datetime({ offset: true }).optional(),
  dimension: z.enum(["avatar", "hook", "cta", "posting_time", "category"]),
}).strict().superRefine((value, context) => {
  if ((value.from === undefined) !== (value.to === undefined)) context.addIssue({ code: z.ZodIssueCode.custom, message: "from and to must be supplied together" });
  if (value.from && value.to && Date.parse(value.from) >= Date.parse(value.to)) context.addIssue({ code: z.ZodIssueCode.custom, message: "from must be before to", path: ["to"] });
});
const sourcesQuerySchema = cursorPageRequestSchema.extend({
  status: sourceItemSchema.shape.status.optional(),
  rightsStatus: sourceItemSchema.shape.rightsStatus.optional(),
}).strict();
const jobResponseSchema = z.object({ job: publishingJobSchema }).strict();
const attributionResponseSchema = paginatedResponseSchema(attributionSchema);
const sourcesResponseSchema = paginatedResponseSchema(sourceItemSchema);

function publicPublishingStatus(state: PublicPublication["state"] | "rejected"): PublishingJob["status"] {
  const map: Record<string, PublishingJob["status"]> = {
    pending_approval: "pending_approval", approved: "queued", queued: "queued", scheduled: "scheduled",
    leased: "publishing", submitted: "publishing", retry_wait: "failed", published: "published",
    cancelled: "cancelled", rejected: "cancelled", dead_letter: "dead_letter",
  };
  return map[state] ?? "failed";
}

function toPublishingJob(publication: PublicPublication): PublishingJob {
  const evidence = (publication.rejection ?? publication.approval) as unknown as Record<string, unknown> | undefined;
  const decision = evidence?.decision === "rejected" ? "rejected" : evidence?.decision === "approved" ? "approved" : undefined;
  const actorId = decision === "approved" ? evidence?.approvedByUserId : evidence?.rejectedByUserId;
  const decidedAt = decision === "approved" ? evidence?.approvedAt : evidence?.rejectedAt;
  const approval = decision && typeof actorId === "string" && typeof decidedAt === "string" && typeof evidence?.previewDigest === "string"
    ? { decision, actorId, decidedAt, previewDigest: evidence.previewDigest, reason: typeof evidence.note === "string" ? evidence.note : typeof evidence.reason === "string" ? evidence.reason : null }
    : null;
  const scheduledFor = publication.preview.scheduledFor ?? null;
  return publishingJobSchema.parse({
    id: publication.id,
    mediaAssetId: publication.preview.assetId,
    platform: publication.preview.platform,
    mode: scheduledFor ? "scheduled" : "manual",
    status: publicPublishingStatus(publication.state),
    preview: {
      digest: publication.preview.digest,
      mediaAssetId: publication.preview.assetId,
      platform: publication.preview.platform,
      caption: publication.preview.caption,
      hashtags: [...publication.preview.hashtags],
      title: publication.preview.title ?? null,
      scheduledFor,
      timezone: publication.preview.timezone ?? null,
      generatedAt: publication.createdAt,
    },
    approval,
    scheduledFor,
    dueAt: scheduledFor,
    attempts: publication.attempt,
    maxAttempts: 4,
    failureCode: publication.lastError ? "publishing_failed" : null,
    createdAt: publication.createdAt,
    updatedAt: publication.updatedAt,
  });
}

function analyticsWindow(from: string | undefined, to: string | undefined): { start: string; end: string; currency: "USD" } {
  const end = to ?? new Date().toISOString();
  const start = from ?? new Date(Date.parse(end) - 30 * 24 * 60 * 60 * 1_000).toISOString();
  return { start, end, currency: "USD" };
}

function toAnalyticsSummary(summary: DomainAnalyticsSummary, platform: PublishingJob["platform"] | undefined): PublicAnalyticsSummary {
  const engagements = summary.metrics.likes + summary.metrics.comments + summary.metrics.shares + summary.metrics.clicks;
  return analyticsSummarySchema.parse({
    window: { from: summary.window.start, to: summary.window.end },
    platform: platform ?? null,
    publicationCount: summary.publicationCount,
    metrics: {
      ...summary.metrics,
      ctr: summary.metrics.impressions === 0 ? null : summary.metrics.ctr,
      retentionRate: summary.metrics.views === 0 ? null : summary.metrics.retentionRate,
    },
    engagementRate: summary.metrics.views === 0 ? null : Math.min(1, engagements / summary.metrics.views),
    averageWatchTimeMs: summary.metrics.views === 0 ? null : Math.round(summary.metrics.watchTimeMs / summary.metrics.views),
    costPerVideoUsd: summary.costPerVideo,
    costPerViewUsd: summary.costPerView,
    currency: "USD",
  });
}

function toAttribution(summary: DomainAnalyticsSummary): Attribution[] {
  return summary.publications.map(({ publication }) => attributionSchema.parse({
    publicationId: publication.id,
    sourceItemId: null,
    scriptId: null,
    influencerId: null,
    campaignKey: null,
    dimensions: {
      avatarId: publication.dimensions.avatar ?? null,
      hook: publication.dimensions.hook ?? null,
      cta: publication.dimensions.cta ?? null,
      postingTime: publication.dimensions.postingTime ?? null,
      category: publication.dimensions.category ?? null,
    },
    attributedAt: publication.publishedAt ?? publication.createdAt,
    model: Object.values(publication.dimensions).some(Boolean) ? "direct" : "unattributed",
  }));
}

function sourceType(adapterKey: string): SourceItem["sourceType"] {
  if (adapterKey === "manual" || adapterKey === "upload" || adapterKey === "owned_library") return adapterKey;
  return "feed";
}

function toSourceItem(source: CanonicalSourceItem): SourceItem {
  return sourceItemSchema.parse({
    id: source.id,
    sourceType: sourceType(source.adapterKey),
    canonicalUrl: source.canonicalUrl ?? null,
    title: source.title ?? null,
    content: source.content ?? null,
    contentHash: source.contentHash,
    rightsStatus: source.rightsStatus,
    moderationStatus: source.moderationStatus,
    status: source.status,
    createdAt: source.createdAt,
    updatedAt: source.updatedAt,
  });
}

export function createAiMediaStudioRuntime(dependencies: AiMediaStudioDependencies = {}): AiMediaStudioRuntime {
  const runtimeEnvironment = dependencies.runtimeEnvironment ?? process.env.NODE_ENV;
  const databaseUrl = dependencies.databaseUrl ?? process.env.DATABASE_URL;
  const persistence = selectMediaJobRepository({
    repository: dependencies.repository,
    runtimeEnvironment,
    databaseUrl,
    createDurableRepository: dependencies.createDurableRepository ?? createDefaultDurableRepository,
  });
  const explicitHarness = dependencies.repository !== undefined && dependencies.providers !== undefined;
  const core = createCoreCatalogRuntime({
    repositories: dependencies.coreRepositories,
    runtimeEnvironment: explicitHarness && !dependencies.coreRepositories ? "test" : runtimeEnvironment,
    databaseUrl: explicitHarness && !dependencies.coreRepositories ? undefined : databaseUrl,
    createDurableRepositories: dependencies.createDurableCoreRepositories,
    workspaceId: dependencies.workspaceId,
    seedDefaults: dependencies.seedCoreDefaults,
  });
  const resolveProviderWebhookAccount = dependencies.resolveProviderWebhookAccount
    ?? (configuredDatabase(databaseUrl)
      ? createDefaultProviderWebhookAccountResolver(core.workspaceId)
      : undefined);
  const governanceSelection = selectGovernanceRepository(
    dependencies,
    explicitHarness && !dependencies.governanceRepository ? "test" : runtimeEnvironment,
    explicitHarness && !dependencies.governanceRepository ? undefined : databaseUrl,
  );
  const governance = new GovernanceService(governanceSelection.repository);
  const operations = createOperationsRuntime({
    ...dependencies.operations,
    runtimeEnvironment: dependencies.operations?.runtimeEnvironment ?? runtimeEnvironment,
    databaseUrl: dependencies.operations?.databaseUrl ?? databaseUrl,
  });
  const environment = runtimeEnvironment?.trim().toLowerCase();
  const assetDeliverySigner = dependencies.assetDeliverySigner ?? (() => {
    const productionAssets = createProductionAssetRuntimeFromEnvironment(
      dependencies.productionAssetEnvironment ?? process.env,
      dependencies.productionAssetAdapterDependencies,
    );
    return productionAssets.available ? productionAssets.signer : undefined;
  })();
  const assetIngestRepository = dependencies.assetIngestRepository
    ?? (persistence.status.durable
      ? createDefaultDurableAssetIngestRepository()
      : explicitHarness || environment === "development" || environment === "test"
        ? new InMemoryAssetIngestRepository()
        : undefined);
  const repository = persistence.repository;
  const queue = dependencies.queue ?? new InMemoryMediaJobQueue();
  const resources = dependencies.heygenResourceMap ?? parseHeyGenResourceMap(process.env.AI_MEDIA_STUDIO_HEYGEN_RESOURCES_JSON);
  const heyGenProvider = new HeyGenVideoProvider({
    apiKey: process.env.HEYGEN_API_KEY,
    providerAccountId: process.env.HEYGEN_PROVIDER_ACCOUNT_ID,
    resolveResources: createHeyGenResourceResolver(resources),
  });
  const providers = dependencies.providers
    ?? (environment === "development" || environment === "test"
      ? [new FakeVideoProvider(), heyGenProvider]
      : [heyGenProvider]);
  if (environment === "production" && providers.some((provider) => provider.key === "fake")) {
    throw new Error("Fake video provider is not allowed in production");
  }
  const defaultProviderKey = dependencies.defaultProviderKey
    ?? (environment === "development" || environment === "test"
      ? process.env.AI_MEDIA_STUDIO_HEYGEN_ENABLED === "true" ? "heygen" : "fake"
      : "heygen");
  if (environment === "production" && defaultProviderKey === "fake") {
    throw new Error("Fake video provider is not allowed in production");
  }
  const seedGovernance = dependencies.seedGovernanceDefaults
    ?? (!governanceSelection.status.durable && governanceSelection.status.available && (explicitHarness || environment === "development" || environment === "test"));
  const governanceSeeds = new Map<string, Promise<void>>();
  const ensureGovernanceDefaults = async (scope: TenantScope): Promise<void> => {
    if (!seedGovernance) return;
    const key = JSON.stringify([scope.workspaceId, scope.ownerUserId]);
    let pending = governanceSeeds.get(key);
    if (!pending) {
      pending = (async () => {
        const samples = [
          { influencerId: "emily-food", avatarId: "avatar-emily", voiceId: "voice-emily-en" },
          { influencerId: "sofia-travel", avatarId: "avatar-sofia", voiceId: "voice-sofia-es" },
        ] as const;
        for (const sample of samples) {
          if (await governance.getCurrentProfile(scope, sample.influencerId)) continue;
          await governance.createProfile(scope, scope.ownerUserId, sample, {
            consentBasis: "synthetic_not_applicable",
            rightsBasis: "owned",
            allowedUses: ["internal_preview", "organic_social"],
            territories: ["WORLDWIDE"],
            validFrom: "2026-01-01T00:00:00.000Z",
            expiresAt: "2035-01-01T00:00:00.000Z",
            policyVersion: "sample-fixture-v1",
            proofDigest: `sha256:${"0".repeat(64)}`,
            brandPolicy: { requiredTerms: [], prohibitedTerms: [] },
            idempotencyKey: `sample-${sample.influencerId}-profile-v1`,
          });
        }
      })().catch((error) => {
        governanceSeeds.delete(key);
        throw error;
      });
      governanceSeeds.set(key, pending);
    }
    await pending;
  };
  const assertRenderGovernance = async (
    ownerUserId: string,
    request: MediaGenerationJob["request"],
  ): Promise<NonNullable<MediaGenerationJob["request"]["governance"]>> => {
    const scope = { ownerUserId, workspaceId: core.workspaceId };
    await core.ensureDefaults(scope);
    await ensureGovernanceDefaults(scope);
    const influencer = await core.influencers.get(scope, request.influencerId);
    if (!influencer.avatarResourceId || !influencer.voiceResourceId) {
      throw new CoreDomainValidationError("Generation requires canonical avatar and voice resources");
    }
    const profile = await governance.assertRenderAllowed(scope, {
      influencerId: influencer.id,
      avatarId: influencer.avatarResourceId,
      voiceId: influencer.voiceResourceId,
      use: "internal_preview",
      territory: "WORLDWIDE",
      content: request.script,
    });
    return { profileId: profile.id, evidenceDigest: profile.evidenceDigest };
  };
  const assertPublishingGovernance = async (
    scope: TenantScope,
    input: Pick<PublicationJob["preview"], "assetId" | "caption" | "hashtags">
      & Partial<Pick<PublicationJob["preview"], "assetDigest" | "title">>,
  ): Promise<void> => {
    await core.ensureDefaults(scope);
    await ensureGovernanceDefaults(scope);
    const asset = await core.repositories.assets.get(scope.ownerUserId, input.assetId);
    if (!asset || asset.workspaceId !== scope.workspaceId) throw new CoreDomainNotFoundError("Media asset not found");
    if (asset.type !== "video" || asset.status !== "ready" || asset.deletedAt !== null || !asset.checksumSha256) {
      throw new CoreDomainValidationError("Publishing requires a ready undeleted canonical video asset with an immutable checksum");
    }
    if (input.assetDigest !== undefined && input.assetDigest !== `sha256:${asset.checksumSha256}`) {
      throw new PublishingInvariantError("Publishing asset digest no longer matches the canonical immutable checksum");
    }
    if (!asset.influencerId) throw new GovernanceGateError(["profile_missing"]);
    const influencer = await core.influencers.get(scope, asset.influencerId);
    if (!influencer.avatarResourceId || !influencer.voiceResourceId) {
      throw new GovernanceGateError(["avatar_mismatch", "voice_mismatch"]);
    }
    await governance.assertPublishAllowed(scope, {
      influencerId: influencer.id,
      avatarId: influencer.avatarResourceId,
      voiceId: influencer.voiceResourceId,
      use: "organic_social",
      territory: "WORLDWIDE",
      content: [input.title, input.caption, ...input.hashtags].filter(Boolean).join(" "),
      assetId: asset.id,
      assetChecksum: asset.checksumSha256,
    });
  };
  const publishingSubmissionGate: PublishingSubmissionGate = {
    async assertCanSubmit(job) {
      try {
        await assertPublishingGovernance(job.scope, job.preview);
      } catch (error) {
        if (error instanceof GovernanceGateError
          || error instanceof CoreDomainNotFoundError
          || error instanceof CoreDomainValidationError
          || error instanceof PublishingInvariantError) {
          throw new PublishingPolicyDeniedError("Publishing governance changed after approval; provider submission was blocked");
        }
        throw error;
      }
    },
  };
  const service = new AiMediaStudioService(repository, queue, providers, defaultProviderKey, {
    allowedAssetHosts: dependencies.allowedAssetHosts ?? envAssetHosts(),
    executionMode: persistence.status.durable ? "durable" : "inline",
    assetIngestRepository,
    assetIngestWorkerReadiness: dependencies.assetIngestWorkerReadiness,
    workspaceId: core.workspaceId,
    governanceGate: { assertRenderAllowed: assertRenderGovernance },
  });
  const scriptService = new DeterministicScriptService();
  const router = Router();
  const materializeOwnedAsset = async (ingest: AssetIngestJob): Promise<string> => {
      if (!ingest.ownedObjectKey || !ingest.sha256 || ingest.sizeBytes === undefined) {
        throw new Error("Completed artifact ingest is missing owned object metadata");
      }
      const [workspaceId, ownerUserId] = parseAssetTenantId(ingest.tenantId);
      if (workspaceId !== core.workspaceId) throw new Error("Artifact ingest workspace does not match this runtime");
      const job = await service.getJob(ownerUserId, ingest.renderJobId);
      const timestamp = new Date(ingest.updatedAtMs).toISOString();
      const result = await core.repositories.assets.createOrGet({
        // The ingest id is already a UUID and is stable for tenant/render
        // idempotency, so it is also a valid canonical asset/FK identifier.
        id: ingest.id,
        ownerUserId: job.ownerUserId,
        workspaceId: core.workspaceId,
        type: "video",
        name: job.title,
        status: "ready",
        mimeType: "video/mp4",
        sizeBytes: ingest.sizeBytes,
        checksumSha256: ingest.sha256,
        storageProvider: "owned-object-storage",
        storageKey: ingest.ownedObjectKey,
        deliveryUrl: null,
        thumbnailUrl: null,
        projectId: null,
        renderJobId: job.id,
        influencerId: job.request.influencerId,
        providerResourceId: null,
        source: { kind: "remote" },
        metadata: {},
        createdAt: timestamp,
        updatedAt: timestamp,
        deletedAt: null,
      });
      return result.asset.id;
  };
  const assetIngestHooks: AssetIngestWorkerHooks = {
    onCompleted: async (ingest) => {
      const mediaAssetId = await materializeOwnedAsset(ingest);
      const [workspaceId, ownerUserId] = parseAssetTenantId(ingest.tenantId);
      if (workspaceId !== core.workspaceId) throw new Error("Artifact ingest workspace does not match this runtime");
      await service.recordArtifactIngested(ownerUserId, ingest.renderJobId, mediaAssetId);
      return { mediaAssetId };
    },
    onFailed: async (ingest: AssetIngestJob) => {
      const [workspaceId, ownerUserId] = parseAssetTenantId(ingest.tenantId);
      if (workspaceId !== core.workspaceId) throw new Error("Artifact ingest workspace does not match this runtime");
      await service.recordArtifactIngestFailure(ownerUserId, ingest.renderJobId, ingest);
    },
  };
  const reconcileCompletedAssetIngests = async (limit = 25): Promise<number> => {
    if (!assetIngestRepository) return 0;
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error("Artifact reconciliation limit must be between 1 and 100");
    const pending = await assetIngestRepository.listCompletedUnlinked(limit);
    let reconciled = 0;
    for (const ingest of pending) {
      const materialized = await assetIngestHooks.onCompleted?.(ingest);
      if (!materialized?.mediaAssetId) continue;
      const attached = await assetIngestRepository.attachMediaAsset({
        tenantId: ingest.tenantId, jobId: ingest.id, mediaAssetId: materialized.mediaAssetId, nowMs: Date.now(),
      });
      if (!attached?.mediaAssetId) continue;
      reconciled += 1;
    }
    return reconciled;
  };
  const reconcileCompletedArtifact = async (job: MediaGenerationJob): Promise<MediaGenerationJob> => {
    if (job.outputAssetId || !assetIngestRepository) return job;
    const tenantId = JSON.stringify([core.workspaceId, job.ownerUserId]);
    const ingest = await assetIngestRepository.findByRenderJob(tenantId, job.id);
    if (ingest?.state !== "completed") return job;
    if (ingest.mediaAssetId) {
      await service.recordArtifactIngested(job.ownerUserId, job.id, ingest.mediaAssetId);
    } else {
      const materialized = await assetIngestHooks.onCompleted?.(ingest);
      if (materialized?.mediaAssetId) {
        await assetIngestRepository.attachMediaAsset({ tenantId, jobId: ingest.id, mediaAssetId: materialized.mediaAssetId, nowMs: Date.now() });
      }
    }
    return service.getJob(job.ownerUserId, job.id);
  };

  router.use((_req, res, next) => {
    res.setHeader("X-AI-Media-Studio-Persistence", persistence.status.mode);
    res.setHeader("X-AI-Media-Studio-Catalog", core.status.mode);
    res.setHeader("X-AI-Media-Studio-Operations", operations.status.mode);
    res.setHeader("X-AI-Media-Studio-Governance", governanceSelection.status.mode);
    next();
  });

  router.get(`${AI_MEDIA_STUDIO_API_BASE}/runtime`, (req, res) => {
    getCurrentUserId(req);
    const available = persistence.status.available && core.status.available && operations.status.available && governanceSelection.status.available;
    res.status(available ? 200 : 503).json({ persistence: persistence.status, catalog: core.status, operations: operations.status, governance: governanceSelection.status });
  });

  const requireJobs = requireCapability(persistence.status, "AI Media Studio job");
  const requireCatalog = requireCapability(core.status, "AI Media Studio catalog");
  const requireOperations = requireCapability(operations.status, "AI Media Studio operations");
  const requireGovernance = requireCapability(governanceSelection.status, "AI Media Studio governance");
  const tenant = async (req: Request): Promise<TenantScope> => {
    const scope = { ownerUserId: getCurrentUserId(req), workspaceId: core.workspaceId };
    await core.ensureDefaults(scope);
    await ensureGovernanceDefaults(scope);
    return scope;
  };

  router.get(`${AI_MEDIA_STUDIO_API_BASE}/dashboard`, requireJobs, asyncRoute(async (req, res) => {
    const ownerUserId = getCurrentUserId(req);
    const dashboard = await service.dashboard(ownerUserId);
    const jobs = await Promise.all((await service.listJobs(ownerUserId)).map(reconcileCompletedArtifact));
    const today = new Date().toISOString().slice(0, 10);
    const durations = jobs.filter((job) => job.startedAt && job.completedAt).map((job) => Date.parse(job.completedAt!) - Date.parse(job.startedAt!));
    res.json(dashboardResponseSchema.parse({
      summary: { generatedToday: jobs.filter((job) => job.createdAt.startsWith(today)).length, published: 0,
        pending: dashboard.summary.pending + dashboard.summary.rendering, failed: dashboard.summary.failed,
        avgGenerationMs: durations.length ? durations.reduce((a, b) => a + b, 0) / durations.length : 0,
        estimatedCostUsd: jobs.reduce((total, job) => total + (job.estimatedCostUsd ?? 0), 0) },
      providers: dashboard.providers.map((provider) => ({ key: provider.key, label: provider.key === "heygen" ? "HeyGen" : "Deterministic Preview",
        status: !provider.configured ? "unconfigured" : provider.healthy ? "healthy" : "degraded",
        capabilities: ["vertical-video", "webhooks"], lastCheckedAt: new Date().toISOString() })),
      queue: { pending: dashboard.summary.pending, rendering: dashboard.summary.rendering, completed: dashboard.summary.completed,
        failed: dashboard.summary.failed, cancelled: dashboard.summary.cancelled },
      recentActivity: dashboard.recentActivity.map((job) => ({ id: job.id, type: "generation", message: `${job.title}: ${job.status}`, createdAt: job.updatedAt })),
    }));
  }));

  router.get(`${AI_MEDIA_STUDIO_API_BASE}/options`, requireCatalog, asyncRoute(async (req, res) => {
    const scope = await tenant(req);
    const [influencers, resources] = await Promise.all([
      core.influencers.options(scope),
      core.resources.options(scope),
    ]);
    const voices = resources.voices.filter((voice) => voice.language).map((voice) => ({
      id: voice.id,
      name: voice.name,
      language: voice.language!,
      accent: voice.accent ?? "",
    }));
    const languageCodes = [...new Set([
      ...influencers.map((influencer) => influencer.language),
      ...voices.map((voice) => voice.language),
    ])].sort();
    res.json(mediaStudioOptionsResponseSchema.parse({
      influencers,
      voices,
      languages: languageCodes.map((code) => ({ code, label: code })),
    }));
  }));

  router.get(`${AI_MEDIA_STUDIO_API_BASE}/influencers`, requireCatalog, asyncRoute(async (req, res) => {
    const input = influencerListRequestSchema.parse({
      status: queryValue(req.query.status),
      category: queryValue(req.query.category),
      language: queryValue(req.query.language),
      search: queryValue(req.query.search),
      cursor: queryValue(req.query.cursor),
      limit: queryValue(req.query.limit),
    });
    const scope = await tenant(req);
    const search = input.search?.toLocaleLowerCase();
    const values = (await core.influencers.list(scope, { includeArchived: input.status === "archived" }))
      .filter((item) => input.status === undefined || item.status === input.status)
      .filter((item) => input.category === undefined || item.categories.some((category) => category.toLocaleLowerCase() === input.category!.toLocaleLowerCase()))
      .filter((item) => input.language === undefined || item.language === input.language)
      .filter((item) => search === undefined || [item.name, item.accent, item.speakingStyle, ...item.categories]
        .some((value) => value.toLocaleLowerCase().includes(search)))
      .map(toPublicInfluencer);
    const page = paginate(values, input.cursor, input.limit);
    res.json(influencerListResponseSchema.parse({ influencers: page.values, nextCursor: page.nextCursor, hasMore: page.hasMore }));
  }));

  router.post(`${AI_MEDIA_STUDIO_API_BASE}/influencers`, requireCatalog, asyncRoute(async (req, res) => {
    const created = await core.influencers.create(await tenant(req), createInfluencerRequestSchema.parse(req.body));
    res.status(201).json(influencerResponseSchema.parse({ influencer: toPublicInfluencer(created) }));
  }));

  router.patch(`${AI_MEDIA_STUDIO_API_BASE}/influencers/:id`, requireCatalog, asyncRoute(async (req, res) => {
    const updated = await core.influencers.update(await tenant(req), req.params.id, updateInfluencerRequestSchema.parse(req.body));
    res.json(influencerResponseSchema.parse({ influencer: toPublicInfluencer(updated) }));
  }));

  router.delete(`${AI_MEDIA_STUDIO_API_BASE}/influencers/:id`, requireCatalog, asyncRoute(async (req, res) => {
    await core.influencers.archive(await tenant(req), req.params.id);
    res.status(204).end();
  }));

  router.get(`${AI_MEDIA_STUDIO_API_BASE}/governance/influencers/:id/profile`, requireCatalog, requireGovernance, asyncRoute(async (req, res) => {
    const scope = await tenant(req);
    const influencerId = idSchema.parse(req.params.id);
    await core.influencers.get(scope, influencerId);
    const profile = await governance.getCurrentProfile(scope, influencerId);
    if (!profile) throw new GovernanceNotFoundError("Influencer governance profile not found");
    res.json(influencerGovernanceProfileResponseSchema.parse({ profile: toPublicInfluencerGovernanceProfile(profile) }));
  }));

  router.post(`${AI_MEDIA_STUDIO_API_BASE}/governance/influencers/:id/profile`, requireCatalog, requireGovernance, asyncRoute(async (req, res) => {
    const scope = await tenant(req);
    const influencer = await core.influencers.get(scope, idSchema.parse(req.params.id));
    if (!influencer.avatarResourceId || !influencer.voiceResourceId) {
      throw new CoreDomainValidationError("Governance profiles require canonical avatar and voice resources");
    }
    const profile = await governance.createProfile(scope, scope.ownerUserId, {
      influencerId: influencer.id,
      avatarId: influencer.avatarResourceId,
      voiceId: influencer.voiceResourceId,
    }, createInfluencerGovernanceProfileRequestSchema.parse(req.body));
    res.status(201).json(influencerGovernanceProfileResponseSchema.parse({ profile: toPublicInfluencerGovernanceProfile(profile) }));
  }));

  router.post(`${AI_MEDIA_STUDIO_API_BASE}/governance/influencers/:id/profile/revoke`, requireCatalog, requireGovernance, asyncRoute(async (req, res) => {
    const scope = await tenant(req);
    const influencerId = idSchema.parse(req.params.id);
    await core.influencers.get(scope, influencerId);
    const profile = await governance.revokeProfile(
      scope,
      scope.ownerUserId,
      influencerId,
      revokeInfluencerGovernanceProfileRequestSchema.parse(req.body),
    );
    res.json(influencerGovernanceProfileResponseSchema.parse({ profile: toPublicInfluencerGovernanceProfile(profile) }));
  }));

  router.get(`${AI_MEDIA_STUDIO_API_BASE}/provider-resources`, requireCatalog, asyncRoute(async (req, res) => {
    const input = providerResourceListRequestSchema.parse({
      kind: queryValue(req.query.kind),
      status: queryValue(req.query.status),
      language: queryValue(req.query.language),
      cursor: queryValue(req.query.cursor),
      limit: queryValue(req.query.limit),
    });
    const scope = await tenant(req);
    const values = (await core.resources.list(scope, { kind: input.kind, includeArchived: input.status === "archived" }))
      .filter((item) => input.status === undefined || item.status === input.status)
      .filter((item) => input.language === undefined || item.language === input.language)
      .map(toPublicResource);
    const page = paginate(values, input.cursor, input.limit);
    res.json(providerResourceListResponseSchema.parse({ resources: page.values, nextCursor: page.nextCursor, hasMore: page.hasMore }));
  }));

  router.get(`${AI_MEDIA_STUDIO_API_BASE}/media-assets`, requireCatalog, asyncRoute(async (req, res) => {
    const input = mediaLibraryRequestSchema.parse({
      kinds: queryValues(req.query.kinds),
      status: queryValue(req.query.status),
      influencerId: queryValue(req.query.influencerId),
      projectId: queryValue(req.query.projectId),
      search: queryValue(req.query.search),
      cursor: queryValue(req.query.cursor),
      limit: queryValue(req.query.limit),
    });
    const ownerUserId = getCurrentUserId(req);
    await core.ensureDefaults({ ownerUserId, workspaceId: core.workspaceId });
    const search = input.search?.toLocaleLowerCase();
    const values = (await core.repositories.assets.list(ownerUserId))
      .map(toPublicMediaAsset)
      .filter((item) => input.kinds === undefined || input.kinds.includes(item.kind))
      .filter((item) => input.status === undefined || item.status === input.status)
      .filter((item) => input.influencerId === undefined || item.influencerId === input.influencerId)
      .filter((item) => input.projectId === undefined || item.projectId === input.projectId)
      .filter((item) => search === undefined || item.name.toLocaleLowerCase().includes(search));
    const page = paginate(values, input.cursor, input.limit);
    res.json(mediaLibraryResponseSchema.parse({ assets: page.values, nextCursor: page.nextCursor, hasMore: page.hasMore }));
  }));

  router.post(`${AI_MEDIA_STUDIO_API_BASE}/media-assets/:id/delivery`, requireCatalog, asyncRoute(async (req, res) => {
    const scope = await tenant(req);
    const asset = await core.repositories.assets.get(scope.ownerUserId, idSchema.parse(req.params.id));
    if (!asset || asset.workspaceId !== scope.workspaceId) throw new CoreDomainNotFoundError("Media asset not found");
    if (asset.status !== "ready" || !asset.storageKey) throw new CoreDomainValidationError("Only ready owned media assets can be delivered");
    if (!assetDeliverySigner || asset.storageProvider !== "owned-object-storage") {
      throw new MediaStudioPersistenceUnavailableError("Owned media delivery is unavailable");
    }
    const expiresInSeconds = 300;
    const issuedAt = Date.now();
    const url = await assetDeliverySigner.sign({ tenantId: JSON.stringify([scope.workspaceId, scope.ownerUserId]), objectKey: asset.storageKey, expiresInSeconds });
    res.json(assetDeliverySchema.parse({ url, expiresAt: new Date(issuedAt + expiresInSeconds * 1_000).toISOString() }));
  }));

  router.get(`${AI_MEDIA_STUDIO_API_BASE}/governance/assets/:id/quality-review`, requireCatalog, requireGovernance, asyncRoute(async (req, res) => {
    const scope = await tenant(req);
    const assetId = idSchema.parse(req.params.id);
    const asset = await core.repositories.assets.get(scope.ownerUserId, assetId);
    if (!asset || asset.workspaceId !== scope.workspaceId) throw new CoreDomainNotFoundError("Media asset not found");
    const review = await governance.getCurrentReview(scope, assetId);
    if (!review) throw new GovernanceNotFoundError("Asset quality review not found");
    res.json(assetQualityReviewResponseSchema.parse({ review: toPublicAssetQualityReview(review) }));
  }));

  router.post(`${AI_MEDIA_STUDIO_API_BASE}/governance/assets/:id/quality-review`, requireCatalog, requireGovernance, asyncRoute(async (req, res) => {
    const scope = await tenant(req);
    const assetId = idSchema.parse(req.params.id);
    const asset = await core.repositories.assets.get(scope.ownerUserId, assetId);
    if (!asset || asset.workspaceId !== scope.workspaceId) throw new CoreDomainNotFoundError("Media asset not found");
    if (asset.type !== "video" || asset.status !== "ready" || asset.deletedAt !== null || !asset.checksumSha256) {
      throw new CoreDomainValidationError("Quality reviews require a ready undeleted canonical video asset with an immutable checksum");
    }
    const review = await governance.createQualityReview(
      scope,
      scope.ownerUserId,
      { assetId: asset.id, assetChecksum: asset.checksumSha256 },
      createAssetQualityReviewRequestSchema.parse(req.body),
    );
    res.status(201).json(assetQualityReviewResponseSchema.parse({ review: toPublicAssetQualityReview(review) }));
  }));

  router.get(`${AI_MEDIA_STUDIO_API_BASE}/jobs`, requireJobs, asyncRoute(async (req, res) => {
    const jobs = await Promise.all((await service.listJobs(getCurrentUserId(req))).map(reconcileCompletedArtifact));
    res.json(mediaJobsResponseSchema.parse({ jobs: jobs.map(toPublicJob) }));
  }));

  router.post(`${AI_MEDIA_STUDIO_API_BASE}/generations`, requireJobs, requireCatalog, requireGovernance, asyncRoute(async (req, res) => {
    const input = createGenerationRequestSchema.parse(req.body);
    const scope = await tenant(req);
    const influencer = await core.influencers.get(scope, input.influencerId);
    const options = await core.influencers.options(scope);
    if (!options.some((option) => option.id === influencer.id)) {
      throw new CoreDomainValidationError("Generation requires an active influencer with active canonical resources");
    }
    if (influencer.voiceResourceId !== input.voiceId || influencer.language !== input.language) {
      throw new CoreDomainValidationError("Generation voice and language must match the selected influencer");
    }
    let job = await service.createGeneration(scope.ownerUserId, input);
    if (job.influencerName !== influencer.name) {
      job = await repository.update({ ...job, influencerName: influencer.name });
    }
    res.status(202).json({ generationId: job.generationId, jobId: job.id, job: toPublicJob(job) });
  }));

  router.post(`${AI_MEDIA_STUDIO_API_BASE}/scripts/generate`, asyncRoute(async (req, res) => {
    getCurrentUserId(req);
    res.json(scriptService.generate(generateScriptVariantsRequestSchema.parse(req.body)));
  }));

  router.get(`${AI_MEDIA_STUDIO_API_BASE}/publishing/jobs`, requireOperations, asyncRoute(async (req, res) => {
    const input = publishingJobListRequestSchema.parse(req.query);
    const values = (await operations.publishing.list(await tenant(req))).map(toPublishingJob)
      .filter((job) => input.platform === undefined || job.platform === input.platform)
      .filter((job) => input.status === undefined || job.status === input.status);
    const page = paginate(values, input.cursor, input.limit);
    res.json(publishingJobListResponseSchema.parse({ items: page.values, nextCursor: page.nextCursor, hasMore: page.hasMore }));
  }));

  router.post(`${AI_MEDIA_STUDIO_API_BASE}/publishing/preview`, requireOperations, requireCatalog, requireGovernance, asyncRoute(async (req, res) => {
    const input = publishingPreviewRequestSchema.parse(req.body);
    if (input.schedule.mode === "automatic") {
      const error = new Error("Automatic publishing is disabled") as Error & { statusCode: number };
      error.statusCode = 403;
      throw error;
    }
    const scope = await tenant(req);
    await assertPublishingGovernance(scope, {
      assetId: input.mediaAssetId,
      caption: input.caption,
      hashtags: input.hashtags,
      ...(input.title ? { title: input.title } : {}),
    });
    const asset = await core.repositories.assets.get(scope.ownerUserId, input.mediaAssetId);
    if (!asset?.checksumSha256) throw new CoreDomainNotFoundError("Media asset not found");
    const preview = operations.publishing.createPreview({
      assetId: asset.id,
      assetDigest: `sha256:${asset.checksumSha256}`,
      caption: input.caption,
      ...(input.title ? { title: input.title } : {}),
      hashtags: input.hashtags,
      platform: input.platform,
      ...(input.schedule.scheduledFor ? { scheduledFor: input.schedule.scheduledFor } : {}),
      ...(input.timezone ? { timezone: input.timezone } : {}),
    });
    res.json(z.object({ preview: publishingPreviewSchema }).strict().parse({ preview: {
      digest: preview.digest, mediaAssetId: preview.assetId, platform: preview.platform,
      caption: preview.caption, hashtags: [...preview.hashtags], title: preview.title ?? null,
      scheduledFor: preview.scheduledFor ?? null, timezone: preview.timezone ?? null,
      generatedAt: operations.policy().evaluatedAt,
    } }));
  }));

  router.post(`${AI_MEDIA_STUDIO_API_BASE}/publishing/jobs`, requireOperations, requireCatalog, requireGovernance, asyncRoute(async (req, res) => {
    const input = createPublishingJobRequestSchema.parse(req.body);
    if (input.schedule.mode === "automatic") {
      const error = new Error("Automatic publishing is disabled") as Error & { statusCode: number };
      error.statusCode = 403;
      throw error;
    }
    const scope = await tenant(req);
    await assertPublishingGovernance(scope, {
      assetId: input.mediaAssetId,
      caption: input.caption,
      hashtags: input.hashtags,
      ...(input.title ? { title: input.title } : {}),
    });
    const asset = await core.repositories.assets.get(scope.ownerUserId, input.mediaAssetId);
    if (!asset?.checksumSha256) throw new CoreDomainNotFoundError("Media asset not found");
    const previewInput = {
      assetId: asset.id,
      assetDigest: `sha256:${asset.checksumSha256}`,
      caption: input.caption,
      ...(input.title ? { title: input.title } : {}),
      hashtags: input.hashtags,
      platform: input.platform,
      ...(input.schedule.scheduledFor ? { scheduledFor: input.schedule.scheduledFor } : {}),
      ...(input.timezone ? { timezone: input.timezone } : {}),
    };
    if (operations.publishing.createPreview(previewInput).digest !== input.previewDigest) {
      throw new PublishingInvariantError("Client preview digest does not match the server-computed immutable preview");
    }
    const publication = await operations.publishing.createDraft(scope, previewInput, input.idempotencyKey);
    res.status(201).json(jobResponseSchema.parse({ job: toPublishingJob(publication) }));
  }));

  router.post(`${AI_MEDIA_STUDIO_API_BASE}/publishing/jobs/:id/approve`, requireOperations, requireCatalog, requireGovernance, asyncRoute(async (req, res) => {
    const id = idSchema.parse(req.params.id);
    const input = digestActionSchema.parse(req.body);
    const scope = await tenant(req);
    const actorId = scope.ownerUserId;
    const existing = await operations.publishing.get(scope, id);
    if (!existing) throw new CoreDomainNotFoundError("Publishing job not found");
    await assertPublishingGovernance(scope, existing.preview);
    const publication = existing.preview.scheduledFor && existing.preview.timezone
      ? await operations.publishing.approveScheduled(scope, id, {
          approvedByUserId: actorId,
          previewDigest: input.previewDigest,
          scheduledFor: existing.preview.scheduledFor,
          timezone: existing.preview.timezone,
        })
      : await operations.publishing.approve(scope, id, { approvedByUserId: actorId, previewDigest: input.previewDigest });
    res.json(jobResponseSchema.parse({ job: toPublishingJob(publication) }));
  }));

  router.post(`${AI_MEDIA_STUDIO_API_BASE}/publishing/jobs/:id/reject`, requireOperations, asyncRoute(async (req, res) => {
    const id = idSchema.parse(req.params.id);
    const input = rejectActionSchema.parse(req.body);
    const scope = await tenant(req);
    const publication = await operations.publishing.reject(scope, id, {
      rejectedByUserId: scope.ownerUserId, previewDigest: input.previewDigest, reason: input.reason,
    });
    res.json(jobResponseSchema.parse({ job: toPublishingJob(publication) }));
  }));

  router.post(`${AI_MEDIA_STUDIO_API_BASE}/publishing/jobs/:id/cancel`, requireOperations, asyncRoute(async (req, res) => {
    emptyActionSchema.parse(req.body);
    const publication = await operations.publishing.cancel(await tenant(req), idSchema.parse(req.params.id));
    res.json(jobResponseSchema.parse({ job: toPublishingJob(publication) }));
  }));

  router.post(`${AI_MEDIA_STUDIO_API_BASE}/publishing/jobs/:id/retry`, requireOperations, requireCatalog, requireGovernance, asyncRoute(async (req, res) => {
    emptyActionSchema.parse(req.body);
    const scope = await tenant(req);
    const id = idSchema.parse(req.params.id);
    const existing = await operations.publishing.get(scope, id);
    if (!existing) throw new CoreDomainNotFoundError("Publishing job not found");
    await assertPublishingGovernance(scope, existing.preview);
    const publication = await operations.publishing.retry(scope, id);
    res.json(jobResponseSchema.parse({ job: toPublishingJob(publication) }));
  }));

  router.get(`${AI_MEDIA_STUDIO_API_BASE}/publishing/connections`, requireOperations, asyncRoute(async (req, res) => {
    const scope = await tenant(req);
    res.json(publishingConnectionsResponseSchema.parse({ connections: await operations.connections(scope) }));
  }));

  router.get(`${AI_MEDIA_STUDIO_API_BASE}/analytics/summary`, requireOperations, asyncRoute(async (req, res) => {
    const input = windowQuerySchema.parse(req.query);
    const summary = await operations.analytics.summarize(await tenant(req), analyticsWindow(input.from, input.to), input.platform ? { platform: input.platform } : {});
    res.json(z.object({ summary: analyticsSummarySchema }).strict().parse({ summary: toAnalyticsSummary(summary, input.platform) }));
  }));

  router.get(`${AI_MEDIA_STUDIO_API_BASE}/analytics/attribution`, requireOperations, asyncRoute(async (req, res) => {
    const input = attributionQuerySchema.parse(req.query);
    const summary = await operations.analytics.summarize(await tenant(req), analyticsWindow(input.from, input.to), input.platform ? { platform: input.platform } : {});
    const page = paginate(toAttribution(summary).map((item) => ({ id: item.publicationId, item })), input.cursor, input.limit);
    res.json(attributionResponseSchema.parse({ items: page.values.map((value) => value.item), nextCursor: page.nextCursor, hasMore: page.hasMore }));
  }));

  router.get(`${AI_MEDIA_STUDIO_API_BASE}/automation/sources`, requireOperations, asyncRoute(async (req, res) => {
    const input = sourcesQuerySchema.parse(req.query);
    const page = await operations.sources.listPage(await tenant(req), input);
    res.json(sourcesResponseSchema.parse({
      items: page.items.map(toSourceItem),
      nextCursor: page.nextCursor,
      hasMore: page.hasMore,
    }));
  }));

  router.get(`${AI_MEDIA_STUDIO_API_BASE}/automation/policy`, requireOperations, asyncRoute(async (req, res) => {
    getCurrentUserId(req);
    res.json(z.object({ policy: automationPolicySchema }).strict().parse({ policy: operations.policy() }));
  }));

  router.get(`${AI_MEDIA_STUDIO_API_BASE}/jobs/:id`, requireJobs, asyncRoute(async (req, res) => {
    const job = await reconcileCompletedArtifact(await service.getJob(getCurrentUserId(req), req.params.id));
    res.json(mediaJobResponseSchema.parse({ job: toPublicJob(job) }));
  }));
  router.post(`${AI_MEDIA_STUDIO_API_BASE}/jobs/:id/retry`, requireJobs, requireCatalog, requireGovernance, asyncRoute(async (req, res) => {
    res.json(mediaJobResponseSchema.parse({ job: toPublicJob(await service.retryJob(getCurrentUserId(req), req.params.id)) }));
  }));
  router.post(`${AI_MEDIA_STUDIO_API_BASE}/jobs/:id/cancel`, requireJobs, asyncRoute(async (req, res) => {
    res.json(mediaJobResponseSchema.parse({ job: toPublicJob(await service.cancelJob(getCurrentUserId(req), req.params.id)) }));
  }));

  router.post(`${AI_MEDIA_STUDIO_API_BASE}/webhooks/providers/:providerKey/accounts/:endpointKey`, requireJobs, asyncRoute(async (req, res) => {
    const requestWithRawBody = req as Request & { rawBody?: unknown };
    const rawBody = Buffer.isBuffer(requestWithRawBody.rawBody) ? requestWithRawBody.rawBody : Buffer.alloc(0);
    const providerKey = req.params.providerKey;
    const endpointKey = req.params.endpointKey;
    if (!isSafeProviderKey(providerKey) || !isSafeProviderWebhookEndpointKey(endpointKey)) {
      res.status(404).json({ error: "Webhook endpoint not found" });
      return;
    }
    if (!resolveProviderWebhookAccount) {
      res.status(503).json({ error: "Webhook endpoint unavailable" });
      return;
    }
    const account = await resolveProviderWebhookAccount({ providerKey, endpointKey });
    if (!account || !isResolvedWebhookAccountValid(account, { providerKey, endpointKey, workspaceId: core.workspaceId })) {
      res.status(404).json({ error: "Webhook endpoint not found" });
      return;
    }
    if (!verifyHeyGenWebhookWithRotation({
      rawBody,
      signature: req.get("Heygen-Signature") ?? undefined,
      secrets: account.secrets,
    })) {
      res.status(401).json({ error: "Invalid webhook signature" });
      return;
    }
    const envelope = deriveVerifiedWebhookEnvelope(req.body, rawBody);
    const authenticatedPayload = req.body && typeof req.body === "object" && !Array.isArray(req.body)
      ? { ...req.body, event_id: envelope.eventId, occurred_at: envelope.occurredAt }
      : req.body;
    const result = await service.ingestWebhook(providerKey, account.providerAccountId, authenticatedPayload, envelope.eventId);
    res.status(202).json(result);
  }));

  // Compatibility harness only. Production never resolves a provider-only URL
  // or process-global secret because that cannot identify a tenant account.
  if ((environment === "development" || environment === "test") && dependencies.webhookSecrets) {
    router.post(`${AI_MEDIA_STUDIO_API_BASE}/webhooks/providers/:providerKey`, requireJobs, asyncRoute(async (req, res) => {
      const requestWithRawBody = req as Request & { rawBody?: unknown };
      const rawBody = Buffer.isBuffer(requestWithRawBody.rawBody) ? requestWithRawBody.rawBody : Buffer.alloc(0);
      const providerKey = req.params.providerKey;
      const secret = dependencies.webhookSecrets?.[providerKey];
      const providerAccountId = providers.find((provider) => provider.key === providerKey)?.providerAccountId;
      if (!secret || !providerAccountId || !verifyHeyGenWebhookWithRotation({
        rawBody,
        signature: req.get("Heygen-Signature") ?? undefined,
        secrets: [{ value: secret, state: "active" }],
      })) {
        res.status(401).json({ error: "Invalid webhook signature" });
        return;
      }
      const envelope = deriveVerifiedWebhookEnvelope(req.body, rawBody);
      const authenticatedPayload = req.body && typeof req.body === "object" && !Array.isArray(req.body)
        ? { ...req.body, event_id: envelope.eventId, occurred_at: envelope.occurredAt }
        : req.body;
      const result = await service.ingestWebhook(providerKey, providerAccountId, authenticatedPayload, envelope.eventId);
      res.status(202).json(result);
    }));
  }

  router.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (error instanceof GovernanceGateError) {
      res.status(error.statusCode).json({ error: "Governance policy denied request", code: error.code, reasons: error.reasons });
      return;
    }
    if (error instanceof GovernanceValidationError || error instanceof GovernanceNotFoundError || error instanceof GovernanceConflictError) {
      res.status(error.statusCode).json({ error: error.message, code: error.code });
      return;
    }
    if (error instanceof MediaStudioError || error instanceof MediaStudioPersistenceUnavailableError) { res.status(error.statusCode).json({ error: error.message }); return; }
    if (error instanceof CoreDomainValidationError || error instanceof AnalyticsValidationError) { res.status(400).json({ error: error.message, code: "code" in error ? error.code : "ANALYTICS_VALIDATION" }); return; }
    if (error instanceof SourceCursorError) { res.status(400).json({ error: "Invalid source cursor", code: "SOURCE_CURSOR_INVALID" }); return; }
    if (error instanceof CoreDomainNotFoundError) { res.status(404).json({ error: "Not found", code: error.code }); return; }
    if (error instanceof InfluencerSlugConflictError) { res.status(409).json({ error: "An influencer with this name already exists", code: error.code }); return; }
    if (error && typeof error === "object" && "issues" in error) { res.status(400).json({ error: "Invalid request", issues: (error as { issues: unknown }).issues }); return; }
    if (error && typeof error === "object") {
      const candidate = error as { status?: unknown; statusCode?: unknown };
      const rawStatus = candidate.statusCode ?? candidate.status;
      const allowedMessages: Partial<Record<number, string>> = {
        400: "Bad request",
        401: "Authentication required",
        403: "Forbidden",
        404: "Not found",
        409: "Conflict",
        415: "Unsupported media type",
        429: "Too many requests",
      };
      if (typeof rawStatus === "number" && Number.isInteger(rawStatus) && allowedMessages[rawStatus]) {
        res.status(rawStatus).json({ error: allowedMessages[rawStatus] });
        return;
      }
    }
    console.error("[AiMediaStudio] Request failed", error instanceof Error ? error.message : "Unknown error");
    res.status(500).json({ error: "AI Media Studio request failed" });
  });
  return {
    service,
    core,
    operations,
    governance,
    governancePersistence: governanceSelection.status,
    publishingSubmissionGate,
    router,
    persistence: persistence.status,
    assetIngestRepository,
    assetIngestHooks,
    reconcileCompletedAssetIngests,
  };
}

export function registerAiMediaStudioRoutes(app: Express, dependencies: AiMediaStudioDependencies = {}): AiMediaStudioRuntime {
  const runtime = createAiMediaStudioRuntime(dependencies);
  app.use(runtime.router);
  return runtime;
}
