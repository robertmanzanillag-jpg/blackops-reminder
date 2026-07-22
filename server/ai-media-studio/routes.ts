import type { Express, NextFunction, Request, Response } from "express";
import { Router } from "express";
import { z } from "zod";
import {
  AI_MEDIA_STUDIO_API_BASE,
  dashboardResponseSchema,
  mediaJobResponseSchema,
  mediaJobsResponseSchema,
  mediaStudioOptionsResponseSchema,
  type MediaJob,
} from "../../shared/ai-media-studio";
import { aiMediaStudioAgentSnapshotSchema } from "../../shared/ai-media-studio-agent";
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
import { productionBatchResponseSchema } from "../../shared/ai-media-studio-production-batches";
import { sourceEligibilityReviewResponseSchema } from "../../shared/ai-media-studio-source-eligibility";
import {
  sourceScriptPreviewRequestSchema,
  sourceScriptPreviewResponseSchema,
} from "../../shared/ai-media-studio-source-to-script";
import {
  sourceToBatchAutomationRequestSchema,
  sourceToBatchAutomationResponseSchema,
} from "../../shared/ai-media-studio-source-to-batch";
import { launchPreflightResponseSchema } from "../../shared/ai-media-studio-launch-preflight";
import { sandboxReadinessResponseSchema } from "../../shared/ai-media-studio-sandbox-readiness";
import { oneVideoExecutionControlResponseSchema } from "../../shared/ai-media-studio-one-video-execution-control";
import {
  oneVideoCostApprovalRequestSchema,
  oneVideoCostApprovalResponseSchema,
  oneVideoCostApprovalPathSchema,
} from "../../shared/ai-media-studio-one-video-cost-approval";
import {
  oneVideoHeldAdmissionPathSchema,
  oneVideoHeldAdmissionRequestSchema,
  oneVideoHeldAdmissionResponseSchema,
} from "../../shared/ai-media-studio-one-video-held-admission";
import { oneVideoHeldAdmissionReadinessResponseSchema } from "../../shared/ai-media-studio-one-video-held-admission-readiness";
import {
  configureHeyGenRosterResponseSchema,
  createHeyGenRosterRequestSchema,
  heyGenRosterDailyPlanResponseSchema,
} from "../../shared/ai-media-studio-heygen-roster";
import { heyGenOnboardingReadinessSchema } from "../../shared/ai-media-studio-heygen-onboarding";
import {
  registerHeyGenCredentialReferenceRequestSchema,
  registerHeyGenCredentialReferenceResponseSchema,
  runHeyGenLiveVerificationFailureResponseSchema,
  runHeyGenLiveVerificationRequestSchema,
  runHeyGenLiveVerificationResponseSchema,
} from "../../shared/ai-media-studio-heygen-secure-setup";
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
  sourceAutomationSyncRequestSchema,
  sourceAutomationSyncResponseSchema,
  sourceItemSchema,
  paginatedResponseSchema,
  type AnalyticsSummary as PublicAnalyticsSummary,
  type Attribution,
  type PublishingJob,
  type SourceItem,
} from "../../shared/ai-media-studio-operations";
import { getCurrentUserId, resolveAuthenticatedUserId } from "../user-context";
import { createAiMediaStudioAgentSnapshot } from "./agent-control";
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
import type {
  HeyGenRosterAccountResolver,
  HeyGenRosterRepository,
} from "./providers/heygen-roster-contracts";
import { HeyGenRosterError } from "./providers/heygen-roster-contracts";
import { HeyGenRosterService } from "./providers/heygen-roster-service";
import { HeyGenRosterDailyPlanService } from "./providers/heygen-roster-daily-plan-service";
import {
  DrizzleHeyGenOnboardingReadinessRepository,
  HeyGenOnboardingReadinessError,
  HeyGenOnboardingReadinessService,
  type HeyGenOnboardingReadinessRepository,
} from "./providers/heygen-onboarding-readiness";
import {
  SecureHeyGenSetupError,
  type SecureHeyGenSetupRepository,
} from "./provider-credentials/secure-heygen-setup-contracts";
import { SecureHeyGenSetupService } from "./provider-credentials/secure-heygen-setup-service";
import { StaticHeyGenVerificationService } from "./provider-credentials/static-heygen-verification-service";
import {
  StaticHeyGenLiveVerificationCoordinator,
  StaticHeyGenLiveVerificationError,
  type StaticHeyGenLiveVerificationAuthorizer,
} from "./provider-credentials/static-heygen-verification-coordinator";
import { DeterministicScriptService } from "./script-service";
import { ProductionBatchError, type ProductionBatchRepository } from "./production-batches/contracts";
import { ProductionBatchService } from "./production-batches/service";
import { LaunchPreflightError, type LaunchPreflightRepository } from "./planning/launch-preflight-contracts";
import { LaunchPreflightService } from "./planning/launch-preflight-service";
import { SandboxReadinessError, type SandboxReadinessRepository } from "./planning/sandbox-readiness-contracts";
import { SandboxReadinessService } from "./planning/sandbox-readiness-service";
import { OneVideoExecutionControlError, type OneVideoExecutionControlRepository } from "./planning/one-video-execution-control-contracts";
import { OneVideoExecutionControlService } from "./planning/one-video-execution-control-service";
import {
  OneVideoCostApprovalError,
} from "./planning/one-video-cost-approval-contracts";
import type { OneVideoCostApprovalCoordinator } from "./planning/one-video-cost-approval-coordinator";
import { OneVideoHeldAdmissionError } from "./planning/one-video-held-admission-contracts";
import type { OneVideoHeldAdmissionCoordinator } from "./planning/one-video-held-admission-coordinator";
import type {
  OneVideoHeldAdmissionReadinessObservationRepository,
  OneVideoHeldAdmissionReadinessService,
} from "./planning/one-video-held-admission-readiness-service";
import {
  createStrictMoneyActionRequestGuard,
  StrictMoneyActionRequestError,
  type StrictMoneyActionRequestGuard,
  type StrictMoneyActionPrincipal,
} from "./strict-money-action-request";
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
import type { CanonicalSourceItem, SourceAdapter } from "./sources/contracts";
import { HttpKongSourceReader } from "./sources/http-kong-source-reader";
import { KongOwnedSourceAdapter, type KongSourceReader } from "./sources/kong-owned-source-adapter";
import { SourceCursorError } from "./sources/source-pagination";
import { SourceAutomationSyncError, SourceAutomationSyncService } from "./sources/sync-service";
import { SourceEligibilityReviewError, SourceEligibilityReviewService } from "./sources/eligibility-review-service";
import { SourceToScriptPreviewError, SourceToScriptPreviewService } from "./sources/source-to-script-preview-service";
import { SourceToBatchAutomationService } from "./sources/source-to-batch-automation-service";
import type { SourceSyncSchedulerObserver } from "./sources/source-sync-scheduler";
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
  heyGenRosterRepository?: HeyGenRosterRepository;
  resolveHeyGenRosterAccount?: HeyGenRosterAccountResolver;
  createDurableHeyGenRosterRuntime?: () => {
    repository: HeyGenRosterRepository;
    accountResolver: HeyGenRosterAccountResolver;
  };
  heyGenOnboardingReadinessRepository?: HeyGenOnboardingReadinessRepository;
  createDurableHeyGenOnboardingReadinessRepository?: () => HeyGenOnboardingReadinessRepository;
  secureHeyGenSetupRepository?: SecureHeyGenSetupRepository;
  createDurableSecureHeyGenSetupRepository?: () => SecureHeyGenSetupRepository;
  staticHeyGenLiveVerificationCoordinator?: Pick<StaticHeyGenLiveVerificationCoordinator, "run">;
  staticHeyGenLiveVerificationAuthorizer?: StaticHeyGenLiveVerificationAuthorizer;
  createDurableStaticHeyGenLiveVerificationCoordinator?: (
    authorizer: StaticHeyGenLiveVerificationAuthorizer,
  ) => Pick<StaticHeyGenLiveVerificationCoordinator, "run">;
  /** Trusted server-owned calendar zone for the planning-only daily roster preview. */
  heyGenRosterDailyPlanTimeZone?: string;
  productionBatchRepository?: ProductionBatchRepository;
  createDurableProductionBatchRepository?: () => ProductionBatchRepository;
  launchPreflightRepository?: LaunchPreflightRepository;
  createDurableLaunchPreflightRepository?: () => LaunchPreflightRepository;
  sandboxReadinessRepository?: SandboxReadinessRepository;
  createDurableSandboxReadinessRepository?: () => SandboxReadinessRepository;
  oneVideoExecutionControlRepository?: OneVideoExecutionControlRepository;
  createDurableOneVideoExecutionControlRepository?: () => OneVideoExecutionControlRepository;
  /** Explicit server-authorized write coordinator. Absent means approval remains fail-closed. */
  oneVideoCostApprovalCoordinator?: Pick<OneVideoCostApprovalCoordinator, "record">;
  /** Durable default composition seam; construction must remain inert. */
  createDurableOneVideoCostApprovalCoordinator?: () => Pick<OneVideoCostApprovalCoordinator, "record">;
  /** Explicit read-only adjudicator and held-only coordinator. Both are required together. */
  oneVideoHeldAdmissionReadiness?: Pick<OneVideoHeldAdmissionReadinessService, "observe">;
  oneVideoHeldAdmissionCoordinator?: Pick<OneVideoHeldAdmissionCoordinator, "admit">;
  /** Durable PostgreSQL observation seam. It must remain read-only. */
  oneVideoHeldAdmissionReadinessObservationRepository?: OneVideoHeldAdmissionReadinessObservationRepository;
  createDurableOneVideoHeldAdmissionReadinessObservationRepository?: () => OneVideoHeldAdmissionReadinessObservationRepository;
  /** Inert durable composition override; no database/provider work may run during construction. */
  createDurableOneVideoHeldAdmissionRuntime?: () => Readonly<{
    readiness: Pick<OneVideoHeldAdmissionReadinessService, "observe">;
    coordinator: Pick<OneVideoHeldAdmissionCoordinator, "admit">;
  }>;
  /** Exact server-owned application origin; never inferred from Host/Forwarded headers. */
  aiMediaStudioCanonicalAppUrl?: string;
  /** Backward-compatible held-admission-specific canonical origin. */
  oneVideoHeldAdmissionCanonicalAppUrl?: string;
  /** Trusted accounting zone used by the atomic daily-admission repository. */
  oneVideoHeldAdmissionAccountingTimeZone?: string;
  oneVideoHeldAdmissionReservationTtlSeconds?: number;
  operations?: OperationsRuntimeDependencies;
  /** Server-owned source adapters selectable only by their public stable key. */
  sourceAdapters?: readonly SourceAdapter[];
  /** Injected server-side Kong data reader. Supplying it only registers the inert adapter; it performs no construction I/O. */
  kongSourceReader?: KongSourceReader;
  /** Read-only durable scheduler observation for the dedicated Agent Control pane. */
  sourceSyncSchedulerObserver?: SourceSyncSchedulerObserver;
  createDurableSourceSyncSchedulerObserver?: () => SourceSyncSchedulerObserver;
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
  heyGenRoster: HeyGenRosterService | undefined;
  heyGenRosterDailyPlan: HeyGenRosterDailyPlanService | undefined;
  heyGenRosterPersistence: MediaStudioPersistenceStatus;
  heyGenOnboardingReadiness: HeyGenOnboardingReadinessService | undefined;
  heyGenOnboardingReadinessPersistence: MediaStudioPersistenceStatus;
  secureHeyGenSetup: SecureHeyGenSetupService | undefined;
  secureHeyGenSetupPersistence: MediaStudioPersistenceStatus;
  staticHeyGenLiveVerification: Pick<StaticHeyGenLiveVerificationCoordinator, "run"> | undefined;
  staticHeyGenLiveVerificationPersistence: MediaStudioPersistenceStatus;
  productionBatches: ProductionBatchService | undefined;
  productionBatchPersistence: MediaStudioPersistenceStatus;
  launchPreflight: LaunchPreflightService | undefined;
  launchPreflightPersistence: MediaStudioPersistenceStatus;
  sandboxReadiness: SandboxReadinessService | undefined;
  sandboxReadinessPersistence: MediaStudioPersistenceStatus;
  oneVideoExecutionControl: OneVideoExecutionControlService | undefined;
  oneVideoExecutionControlPersistence: MediaStudioPersistenceStatus;
  oneVideoCostApproval: Pick<OneVideoCostApprovalCoordinator, "record"> | undefined;
  oneVideoCostApprovalPersistence: MediaStudioPersistenceStatus;
  oneVideoHeldAdmissionReadiness: Pick<OneVideoHeldAdmissionReadinessService, "observe"> | undefined;
  oneVideoHeldAdmission: Pick<OneVideoHeldAdmissionCoordinator, "admit"> | undefined;
  oneVideoHeldAdmissionPersistence: MediaStudioPersistenceStatus;
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

function createDefaultDurableHeyGenRosterRuntime(): {
  repository: HeyGenRosterRepository;
  accountResolver: HeyGenRosterAccountResolver;
} {
  let pending: Promise<{
    repository: HeyGenRosterRepository;
    accountResolver: HeyGenRosterAccountResolver;
  }> | undefined;
  const load = () => pending ??= Promise.all([
    import("../db"),
    import("./providers/drizzle-heygen-roster-repository"),
  ]).then(([database, adapter]) => ({
    repository: new adapter.DrizzleHeyGenRosterRepository(database.db),
    accountResolver: adapter.createDrizzleHeyGenRosterAccountResolver(database.db),
  }));
  return {
    repository: {
      configure: async (...args) => (await load()).repository.configure(...args),
      get: async (...args) => (await load()).repository.get(...args),
      getCurrent: async (...args) => (await load()).repository.getCurrent(...args),
      getCurrentDailyPlan: async (...args) => (await load()).repository.getCurrentDailyPlan(...args),
    },
    accountResolver: {
      resolve: async (...args) => (await load()).accountResolver.resolve(...args),
    },
  };
}

function createDefaultDurableHeyGenOnboardingReadinessRepository(): HeyGenOnboardingReadinessRepository {
  let pending: Promise<HeyGenOnboardingReadinessRepository> | undefined;
  const load = () => pending ??= import("../db")
    .then(({ db }) => new DrizzleHeyGenOnboardingReadinessRepository(db));
  return {
    observe: async (...args) => (await load()).observe(...args),
  };
}

function createDefaultDurableSecureHeyGenSetupRepository(): SecureHeyGenSetupRepository {
  let pending: Promise<SecureHeyGenSetupRepository> | undefined;
  const load = () => pending ??= Promise.all([
    import("../db"),
    import("./provider-credentials/drizzle-secure-heygen-setup-repository"),
  ]).then(([database, adapter]) => new adapter.DrizzleSecureHeyGenSetupRepository(database.db));
  return {
    setup: async (...args) => (await load()).setup(...args),
  };
}

function createDefaultDurableStaticHeyGenLiveVerificationCoordinator(
  authorizer: StaticHeyGenLiveVerificationAuthorizer,
): Pick<StaticHeyGenLiveVerificationCoordinator, "run"> {
  let pending: Promise<StaticHeyGenLiveVerificationCoordinator> | undefined;
  const load = () => pending ??= Promise.all([
    import("../db"),
    import("./provider-credentials/drizzle-static-heygen-verification-context-loader"),
    import("./provider-credentials/drizzle-static-heygen-verification-replay-reader"),
    import("./provider-credentials/drizzle-static-heygen-verification-repository"),
    import("./provider-credentials/static-heygen-secret-resolver"),
  ]).then(([database, contextAdapter, replayAdapter, evidenceAdapter, secretAdapter]) => new StaticHeyGenLiveVerificationCoordinator({
    authorizer,
    replayReader: new replayAdapter.DrizzleStaticHeyGenVerificationReplayReader(database.db),
    contextLoader: new contextAdapter.DrizzleStaticHeyGenVerificationContextLoader(database.db),
    secretResolver: secretAdapter.createStaticHeyGenSecretResolver(),
    evidenceService: new StaticHeyGenVerificationService(
      new evidenceAdapter.DrizzleStaticHeyGenVerificationRepository(database.db),
    ),
  }));
  return { run: async (...args) => (await load()).run(...args) };
}

function createDefaultDurableProductionBatchRepository(): ProductionBatchRepository {
  let pending: Promise<ProductionBatchRepository> | undefined;
  const load = () => pending ??= Promise.all([
    import("../db"),
    import("./production-batches/drizzle-repository"),
  ]).then(([database, adapter]) => new adapter.DrizzleProductionBatchRepository(database.db));
  return {
    getCurrent: async (...args) => (await load()).getCurrent(...args),
    prepare: async (...args) => (await load()).prepare(...args),
    approve: async (...args) => (await load()).approve(...args),
  };
}

function createDefaultDurableSourceSyncSchedulerObserver(): SourceSyncSchedulerObserver {
  let pending: Promise<SourceSyncSchedulerObserver> | undefined;
  const load = () => pending ??= Promise.all([
    import("../db"),
    import("./sources/drizzle-source-sync-scheduler-repository"),
  ]).then(([database, adapter]) => new adapter.DrizzleSourceSyncSchedulerRepository(database.db));
  return { observe: async (...args) => (await load()).observe(...args) };
}

function createDefaultDurableLaunchPreflightRepository(): LaunchPreflightRepository {
  let pending: Promise<LaunchPreflightRepository> | undefined;
  const load = () => pending ??= Promise.all([
    import("../db"),
    import("./planning/drizzle-launch-preflight-repository"),
    import("./planning/maximum-quote-readiness-registry"),
    import("./providers/heygen-account-maximum-quote-provider"),
  ]).then(([database, adapter, registryAdapter, heygenAdapter]) =>
    new adapter.DrizzleLaunchPreflightRepository(database.db,
      new registryAdapter.MaximumQuoteReadinessRegistry([
        [heygenAdapter.HEYGEN_MAXIMUM_QUOTE_PROVIDER_KEY,
          new heygenAdapter.HeyGenAccountMaximumQuoteUnavailableProvider()],
      ])));
  return { observe: async (...args) => (await load()).observe(...args) };
}

function createDefaultDurableSandboxReadinessRepository(): SandboxReadinessRepository {
  let pending: Promise<SandboxReadinessRepository> | undefined;
  const load = () => pending ??= Promise.all([
    import("../db"),
    import("./planning/drizzle-sandbox-readiness-repository"),
  ]).then(([database, adapter]) => new adapter.DrizzleSandboxReadinessRepository(database.db));
  return { observe: async (...args) => (await load()).observe(...args) };
}

function createDefaultDurableOneVideoExecutionControlRepository(): OneVideoExecutionControlRepository {
  let pending: Promise<OneVideoExecutionControlRepository> | undefined;
  const load = () => pending ??= Promise.all([
    import("../db"), import("./planning/drizzle-one-video-execution-control-repository"),
    import("./planning/maximum-quote-readiness-registry"),
    import("./providers/heygen-account-maximum-quote-provider"),
  ]).then(([database, adapter, registryAdapter, heygenAdapter]) =>
    new adapter.DrizzleOneVideoExecutionControlRepository(database.db,
      new registryAdapter.MaximumQuoteReadinessRegistry([
        [heygenAdapter.HEYGEN_MAXIMUM_QUOTE_PROVIDER_KEY,
          new heygenAdapter.HeyGenAccountMaximumQuoteUnavailableProvider()],
      ])));
  return { observe: async (...args) => (await load()).observe(...args) };
}

function createDefaultDurableOneVideoCostApprovalCoordinator(): Pick<OneVideoCostApprovalCoordinator, "record"> {
  let pending: Promise<OneVideoCostApprovalCoordinator> | undefined;
  const load = () => pending ??= Promise.all([
    import("../db"),
    import("./planning/drizzle-one-video-execution-control-repository"),
    import("./planning/drizzle-one-video-cost-approval-context-loader"),
    import("./planning/drizzle-launch-authority-repository"),
    import("./planning/launch-authority-service"),
    import("./planning/one-video-cost-approval-coordinator"),
    import("./planning/server-owned-one-video-cost-approval-authorization"),
    import("./planning/maximum-quote-readiness-registry"),
    import("./providers/heygen-account-maximum-quote-provider"),
  ]).then(([database, executionAdapter, contextAdapter, authorityAdapter, authorityService,
    approvalCoordinator, authorizationAdapter, registryAdapter, heygenAdapter]) => {
    const authorization = authorizationAdapter.createServerOwnedOneVideoCostApprovalAuthorization(
      (context) => getCurrentUserId(context as Request),
    );
    const executionControl = new executionAdapter.DrizzleOneVideoExecutionControlRepository(database.db,
      new registryAdapter.MaximumQuoteReadinessRegistry([
        [heygenAdapter.HEYGEN_MAXIMUM_QUOTE_PROVIDER_KEY,
          new heygenAdapter.HeyGenAccountMaximumQuoteUnavailableProvider()],
      ]));
    const launchAuthority = new authorityService.LaunchAuthorityService({
      repository: new authorityAdapter.DrizzleLaunchAuthorityRepository(database.db, {
        runtimeAttestationVerifier: { async verify() { return undefined; } },
        validityPolicy: { ttlSeconds() { return 15 * 60; } },
      }),
      authenticator: authorization.authenticator,
    });
    return new approvalCoordinator.OneVideoCostApprovalCoordinator({
      authorizer: authorization.authorizer,
      contextLoader: new contextAdapter.DrizzleOneVideoCostApprovalContextLoader(database.db, executionControl),
      launchAuthority,
    });
  });
  return { record: async (...args) => (await load()).record(...args) };
}

type OneVideoHeldAdmissionRuntimePort = Readonly<{
  readiness: Pick<OneVideoHeldAdmissionReadinessService, "observe">;
  coordinator: Pick<OneVideoHeldAdmissionCoordinator, "admit">;
}>;

/** Lazy and inert: imports and database construction begin only on first request. */
function createDefaultDurableOneVideoHeldAdmissionRuntime(options: Readonly<{
  observationRepository?: OneVideoHeldAdmissionReadinessObservationRepository;
  accountingTimeZone: string;
  reservationTtlSeconds: number;
}>): OneVideoHeldAdmissionRuntimePort {
  let pending: Promise<OneVideoHeldAdmissionRuntimePort> | undefined;
  const load = () => pending ??= Promise.all([
    import("../db"),
    import("./planning/drizzle-one-video-execution-control-repository"),
    import("./planning/drizzle-one-video-held-admission-context-loader"),
    import("./planning/drizzle-one-video-held-admission-snapshot-repository"),
    import("./planning/drizzle-daily-admission-repository"),
    import("./planning/drizzle-one-video-held-admission-repository"),
    import("./planning/one-video-held-admission-coordinator"),
    import("./planning/one-video-held-admission-readiness-service"),
    import("./planning/server-owned-one-video-held-admission-authorization"),
    import("./planning/drizzle-one-video-held-admission-readiness-repository"),
    import("./planning/drizzle-one-video-held-admission-replay-repository"),
    import("./planning/maximum-quote-readiness-registry"),
    import("./providers/heygen-account-maximum-quote-provider"),
  ]).then(([database, executionAdapter, contextAdapter, snapshotAdapter, dailyAdmissionAdapter,
    heldAdmissionAdapter, coordinatorAdapter, readinessAdapter, authorizationAdapter, readinessRepositoryAdapter,
    replayRepositoryAdapter, registryAdapter, heygenAdapter]) => {
    const executionControl = new executionAdapter.DrizzleOneVideoExecutionControlRepository(database.db,
      new registryAdapter.MaximumQuoteReadinessRegistry([
        [heygenAdapter.HEYGEN_MAXIMUM_QUOTE_PROVIDER_KEY,
          new heygenAdapter.HeyGenAccountMaximumQuoteUnavailableProvider()],
      ]));
    const contextLoader = new contextAdapter.DrizzleOneVideoHeldAdmissionContextLoader(
      database.db,
      executionControl,
      { reservationTtlSeconds: options.reservationTtlSeconds },
    );
    const snapshotRepository = new snapshotAdapter.DrizzleOneVideoHeldAdmissionSnapshotRepository(database.db);
    const replayRepository = new replayRepositoryAdapter.DrizzleOneVideoHeldAdmissionReplayRepository(database.db);
    const authorization = authorizationAdapter.createServerOwnedOneVideoHeldAdmissionAuthorization((context) => {
      const principal = context as Partial<StrictMoneyActionPrincipal>;
      if (principal.transport !== "same-origin-browser" || typeof principal.authenticatedUserId !== "string") {
        throw new OneVideoHeldAdmissionError("UNAUTHENTICATED");
      }
      return principal.authenticatedUserId;
    });
    const dailyAdmission = new dailyAdmissionAdapter.DrizzleDailyAdmissionRepository(database.db, {
      accountingTimeZone: options.accountingTimeZone,
    });
    return Object.freeze({
      readiness: new readinessAdapter.OneVideoHeldAdmissionReadinessService({
        contextLoader,
        replayRepository,
        snapshotRepository,
        observationRepository: options.observationRepository
          ?? new readinessRepositoryAdapter.DrizzleOneVideoHeldAdmissionReadinessRepository(database.db),
      }),
      coordinator: new coordinatorAdapter.OneVideoHeldAdmissionCoordinator({
        authorizer: authorization.authorizer,
        authenticator: authorization.authenticator,
        contextLoader,
        replayRepository,
        snapshotRepository,
        admissionRepository: new heldAdmissionAdapter.DrizzleOneVideoHeldAdmissionRepository(dailyAdmission),
      }),
    });
  });
  const loaded = async (): Promise<OneVideoHeldAdmissionRuntimePort> => {
    try { return await load(); } catch { throw new OneVideoHeldAdmissionError("UNAVAILABLE"); }
  };
  return Object.freeze({
    readiness: { observe: async (...args) => (await loaded()).readiness.observe(...args) },
    coordinator: { admit: async (...args) => (await loaded()).coordinator.admit(...args) },
  });
}

type OneVideoHeldAdmissionSelection = Readonly<{
  runtime: OneVideoHeldAdmissionRuntimePort | undefined;
  requestGuard: StrictMoneyActionRequestGuard<Request> | undefined;
  status: MediaStudioPersistenceStatus;
}>;

function selectOneVideoHeldAdmissionRuntime(
  dependencies: AiMediaStudioDependencies,
  databaseUrl: string | undefined,
): OneVideoHeldAdmissionSelection {
  const heldAdmissionCanonicalAppUrl = dependencies.oneVideoHeldAdmissionCanonicalAppUrl
    ?? dependencies.aiMediaStudioCanonicalAppUrl
    ?? process.env.PUBLIC_APP_URL
    ?? "";
  const requestGuard = createSensitiveMutationRequestGuard(
    dependencies,
    dependencies.runtimeEnvironment ?? process.env.NODE_ENV,
    heldAdmissionCanonicalAppUrl,
  );
  if (!requestGuard) {
    return { runtime: undefined, requestGuard: undefined,
      status: { mode: "unavailable", available: false, durable: false,
        reason: "An explicit canonical application origin is required for held admission" } };
  }

  if (dependencies.oneVideoHeldAdmissionReadiness && dependencies.oneVideoHeldAdmissionCoordinator) {
    return {
      runtime: { readiness: dependencies.oneVideoHeldAdmissionReadiness,
        coordinator: dependencies.oneVideoHeldAdmissionCoordinator },
      requestGuard,
      status: { mode: "injected", available: true, durable: false,
        reason: "Explicit server-authorized held-admission runtime supplied by the composition caller" },
    };
  }
  if (dependencies.oneVideoHeldAdmissionReadiness || dependencies.oneVideoHeldAdmissionCoordinator) {
    return { runtime: undefined, requestGuard,
      status: { mode: "unavailable", available: false, durable: false,
        reason: "Held-admission readiness and coordinator must be supplied together" } };
  }
  if (!configuredDatabase(databaseUrl)) {
    return { runtime: undefined, requestGuard,
      status: { mode: "unavailable", available: false, durable: false,
        reason: "DATABASE_URL and a durable held-admission runtime are required" } };
  }
  try {
    let runtime: OneVideoHeldAdmissionRuntimePort;
    if (dependencies.createDurableOneVideoHeldAdmissionRuntime) {
      runtime = dependencies.createDurableOneVideoHeldAdmissionRuntime();
    } else {
      const observationRepository = dependencies.oneVideoHeldAdmissionReadinessObservationRepository
        ?? dependencies.createDurableOneVideoHeldAdmissionReadinessObservationRepository?.();
      const accountingTimeZone = (dependencies.oneVideoHeldAdmissionAccountingTimeZone
        ?? dependencies.heyGenRosterDailyPlanTimeZone
        ?? process.env.AI_MEDIA_STUDIO_ACCOUNTING_TIME_ZONE)?.trim();
      const reservationTtlSeconds = dependencies.oneVideoHeldAdmissionReservationTtlSeconds ?? 10 * 60;
      if (!accountingTimeZone) throw new OneVideoHeldAdmissionError("UNAVAILABLE");
      runtime = createDefaultDurableOneVideoHeldAdmissionRuntime({
        observationRepository, accountingTimeZone, reservationTtlSeconds,
      });
    }
    if (!runtime?.readiness || !runtime.coordinator) throw new OneVideoHeldAdmissionError("UNAVAILABLE");
    return { runtime, requestGuard,
      status: { mode: "drizzle", available: true, durable: true,
        reason: "PostgreSQL read-only readiness and atomic held-only admission selected" } };
  } catch (error) {
    return { runtime: undefined, requestGuard,
      status: { mode: "unavailable", available: false, durable: false,
        reason: "Held-admission initialization failed closed" } };
  }
}

function createSensitiveMutationRequestGuard(
  dependencies: AiMediaStudioDependencies,
  runtimeEnvironment: string | undefined,
  canonicalAppUrlOverride?: string,
): StrictMoneyActionRequestGuard<Request> | undefined {
  const canonicalAppUrl = canonicalAppUrlOverride
    ?? dependencies.aiMediaStudioCanonicalAppUrl
    ?? dependencies.oneVideoHeldAdmissionCanonicalAppUrl
    ?? process.env.PUBLIC_APP_URL
    ?? "";
  const environment = runtimeEnvironment?.trim().toLowerCase();
  const allowInsecureLoopback = (environment === "development" || environment === "test")
    && isExplicitHttpLoopbackOrigin(canonicalAppUrl);
  try {
    return createStrictMoneyActionRequestGuard({
      canonicalAppUrl,
      allowInsecureLoopback,
      resolveAuthenticatedUserId,
    });
  } catch {
    return undefined;
  }
}

function isExplicitHttpLoopbackOrigin(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:"
      && (url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "[::1]")
      && (value === url.origin || value === `${url.origin}/`);
  } catch {
    return false;
  }
}

function selectOneVideoExecutionControlRuntime(
  dependencies: AiMediaStudioDependencies,
  databaseUrl: string | undefined,
): { service: OneVideoExecutionControlService | undefined; status: MediaStudioPersistenceStatus } {
  if (dependencies.oneVideoExecutionControlRepository) return {
    service: new OneVideoExecutionControlService(dependencies.oneVideoExecutionControlRepository),
    status: { mode: "injected", available: true, durable: false,
      reason: "One-video execution-control repository supplied by the composition caller; durability is not inferred" },
  };
  if (configuredDatabase(databaseUrl)) {
    try {
      const repository = (dependencies.createDurableOneVideoExecutionControlRepository
        ?? createDefaultDurableOneVideoExecutionControlRepository)();
      return { service: new OneVideoExecutionControlService(repository), status: { mode: "drizzle", available: true,
        durable: true, reason: "PostgreSQL/Drizzle read-only one-video execution-control persistence selected" } };
    } catch (error) {
      return { service: undefined, status: { mode: "unavailable", available: false, durable: false,
        reason: `One-video execution-control initialization failed: ${error instanceof Error ? error.message : "unknown error"}` } };
    }
  }
  return { service: undefined, status: { mode: "unavailable", available: false, durable: false,
    reason: "DATABASE_URL or an injected one-video execution-control repository is required" } };
}

function selectOneVideoCostApprovalRuntime(
  dependencies: AiMediaStudioDependencies,
  databaseUrl: string | undefined,
): { coordinator: Pick<OneVideoCostApprovalCoordinator, "record"> | undefined; status: MediaStudioPersistenceStatus } {
  if (dependencies.oneVideoCostApprovalCoordinator) {
    return {
      coordinator: dependencies.oneVideoCostApprovalCoordinator,
      status: { mode: "injected", available: true, durable: false,
        reason: "Explicit server-authorized one-video cost-approval coordinator supplied by the composition caller" },
    };
  }
  if (configuredDatabase(databaseUrl)) {
    try {
      const coordinator = (dependencies.createDurableOneVideoCostApprovalCoordinator
        ?? createDefaultDurableOneVideoCostApprovalCoordinator)();
      return {
        coordinator,
        status: { mode: "drizzle", available: true, durable: true,
          reason: "PostgreSQL/Drizzle server-authorized one-video cost approval selected" },
      };
    } catch (error) {
      return {
        coordinator: undefined,
        status: { mode: "unavailable", available: false, durable: false,
          reason: `One-video cost approval initialization failed: ${error instanceof Error ? error.message : "unknown error"}` },
      };
    }
  }
  return {
    coordinator: undefined,
    status: { mode: "unavailable", available: false, durable: false,
      reason: "An explicit server-authorized one-video cost-approval coordinator is required" },
  };
}

function selectSandboxReadinessRuntime(
  dependencies: AiMediaStudioDependencies,
  databaseUrl: string | undefined,
): { service: SandboxReadinessService | undefined; status: MediaStudioPersistenceStatus } {
  if (dependencies.sandboxReadinessRepository) return {
    service: new SandboxReadinessService(dependencies.sandboxReadinessRepository),
    status: { mode: "injected", available: true, durable: false,
      reason: "Sandbox-readiness repository supplied by the composition caller; durability is not inferred" },
  };
  if (configuredDatabase(databaseUrl)) {
    try {
      const repository = (dependencies.createDurableSandboxReadinessRepository ?? createDefaultDurableSandboxReadinessRepository)();
      return { service: new SandboxReadinessService(repository), status: { mode: "drizzle", available: true, durable: true,
        reason: "PostgreSQL/Drizzle read-only sandbox-readiness persistence selected" } };
    } catch (error) {
      return { service: undefined, status: { mode: "unavailable", available: false, durable: false,
        reason: `Sandbox-readiness persistence initialization failed: ${error instanceof Error ? error.message : "unknown error"}` } };
    }
  }
  return { service: undefined, status: { mode: "unavailable", available: false, durable: false,
    reason: "DATABASE_URL or an injected durable sandbox-readiness repository is required" } };
}

function selectLaunchPreflightRuntime(
  dependencies: AiMediaStudioDependencies,
  databaseUrl: string | undefined,
): { service: LaunchPreflightService | undefined; status: MediaStudioPersistenceStatus } {
  if (dependencies.launchPreflightRepository) {
    return {
      service: new LaunchPreflightService(dependencies.launchPreflightRepository),
      status: { mode: "injected", available: true, durable: false,
        reason: "Launch-preflight repository supplied by the composition caller; durability is not inferred" },
    };
  }
  if (configuredDatabase(databaseUrl)) {
    try {
      const repository = (dependencies.createDurableLaunchPreflightRepository ?? createDefaultDurableLaunchPreflightRepository)();
      return { service: new LaunchPreflightService(repository), status: { mode: "drizzle", available: true, durable: true,
        reason: "PostgreSQL/Drizzle read-only launch-preflight persistence selected" } };
    } catch (error) {
      return { service: undefined, status: { mode: "unavailable", available: false, durable: false,
        reason: `Launch-preflight persistence initialization failed: ${error instanceof Error ? error.message : "unknown error"}` } };
    }
  }
  return { service: undefined, status: { mode: "unavailable", available: false, durable: false,
    reason: "DATABASE_URL or an injected durable launch-preflight repository is required" } };
}

function selectProductionBatchRuntime(
  dependencies: AiMediaStudioDependencies,
  databaseUrl: string | undefined,
): { service: ProductionBatchService | undefined; status: MediaStudioPersistenceStatus } {
  if (dependencies.productionBatchRepository) {
    return {
      service: new ProductionBatchService(dependencies.productionBatchRepository),
      status: { mode: "injected", available: true, durable: false, reason: "Production batch repository supplied by the composition caller" },
    };
  }
  if (configuredDatabase(databaseUrl)) {
    try {
      const repository = (dependencies.createDurableProductionBatchRepository ?? createDefaultDurableProductionBatchRepository)();
      return {
        service: new ProductionBatchService(repository),
        status: { mode: "drizzle", available: true, durable: true, reason: "PostgreSQL/Drizzle production batch persistence selected" },
      };
    } catch (error) {
      return {
        service: undefined,
        status: { mode: "unavailable", available: false, durable: false,
          reason: `Production batch persistence initialization failed: ${error instanceof Error ? error.message : "unknown error"}` },
      };
    }
  }
  return {
    service: undefined,
    status: { mode: "unavailable", available: false, durable: false,
      reason: "DATABASE_URL or an injected production batch repository is required" },
  };
}

function selectHeyGenRosterRuntime(
  dependencies: AiMediaStudioDependencies,
  databaseUrl: string | undefined,
): { service: HeyGenRosterService | undefined; status: MediaStudioPersistenceStatus } {
  if (dependencies.heyGenRosterRepository && dependencies.resolveHeyGenRosterAccount) {
    return {
      service: new HeyGenRosterService(
        dependencies.heyGenRosterRepository,
        dependencies.resolveHeyGenRosterAccount,
        () => new Date().toISOString(),
        dependencies.heyGenRosterDailyPlanTimeZone ?? "UTC",
      ),
      status: { mode: "injected", available: true, durable: false, reason: "HeyGen roster runtime supplied by the composition caller" },
    };
  }
  if (dependencies.heyGenRosterRepository || dependencies.resolveHeyGenRosterAccount) {
    return {
      service: undefined,
      status: { mode: "unavailable", available: false, durable: false, reason: "HeyGen roster repository and account resolver must be supplied together" },
    };
  }
  if (configuredDatabase(databaseUrl)) {
    try {
      const runtime = (dependencies.createDurableHeyGenRosterRuntime ?? createDefaultDurableHeyGenRosterRuntime)();
      return {
        service: new HeyGenRosterService(
          runtime.repository,
          runtime.accountResolver,
          () => new Date().toISOString(),
          dependencies.heyGenRosterDailyPlanTimeZone ?? "UTC",
        ),
        status: { mode: "drizzle", available: true, durable: true, reason: "PostgreSQL/Drizzle HeyGen roster persistence selected" },
      };
    } catch (error) {
      return {
        service: undefined,
        status: {
          mode: "unavailable", available: false, durable: false,
          reason: `HeyGen roster persistence initialization failed: ${error instanceof Error ? error.message : "unknown error"}`,
        },
      };
    }
  }
  return {
    service: undefined,
    status: { mode: "unavailable", available: false, durable: false, reason: "DATABASE_URL or an injected HeyGen roster runtime is required" },
  };
}

function selectHeyGenOnboardingReadinessRuntime(
  dependencies: AiMediaStudioDependencies,
  databaseUrl: string | undefined,
): { service: HeyGenOnboardingReadinessService | undefined; status: MediaStudioPersistenceStatus } {
  if (dependencies.heyGenOnboardingReadinessRepository) {
    return {
      service: new HeyGenOnboardingReadinessService(dependencies.heyGenOnboardingReadinessRepository),
      status: { mode: "injected", available: true, durable: false, reason: "HeyGen onboarding readiness repository supplied by the composition caller" },
    };
  }
  if (configuredDatabase(databaseUrl)) {
    try {
      const repository = (dependencies.createDurableHeyGenOnboardingReadinessRepository
        ?? createDefaultDurableHeyGenOnboardingReadinessRepository)();
      return {
        service: new HeyGenOnboardingReadinessService(repository),
        status: { mode: "drizzle", available: true, durable: true, reason: "PostgreSQL/Drizzle read-only HeyGen onboarding readiness selected" },
      };
    } catch (error) {
      return {
        service: undefined,
        status: { mode: "unavailable", available: false, durable: false,
          reason: `HeyGen onboarding readiness initialization failed: ${error instanceof Error ? error.message : "unknown error"}` },
      };
    }
  }
  return {
    service: undefined,
    status: { mode: "unavailable", available: false, durable: false,
      reason: "DATABASE_URL or an injected HeyGen onboarding readiness repository is required" },
  };
}

function selectSecureHeyGenSetupRuntime(
  dependencies: AiMediaStudioDependencies,
  databaseUrl: string | undefined,
): { service: SecureHeyGenSetupService | undefined; status: MediaStudioPersistenceStatus } {
  if (dependencies.secureHeyGenSetupRepository) {
    return {
      service: new SecureHeyGenSetupService(dependencies.secureHeyGenSetupRepository),
      status: { mode: "injected", available: true, durable: false, reason: "Secure HeyGen setup repository supplied by the composition caller" },
    };
  }
  if (configuredDatabase(databaseUrl)) {
    try {
      const repository = (dependencies.createDurableSecureHeyGenSetupRepository
        ?? createDefaultDurableSecureHeyGenSetupRepository)();
      return {
        service: new SecureHeyGenSetupService(repository),
        status: { mode: "drizzle", available: true, durable: true, reason: "PostgreSQL/Drizzle secure HeyGen setup selected" },
      };
    } catch (error) {
      return {
        service: undefined,
        status: { mode: "unavailable", available: false, durable: false,
          reason: `Secure HeyGen setup initialization failed: ${error instanceof Error ? error.message : "unknown error"}` },
      };
    }
  }
  return {
    service: undefined,
    status: { mode: "unavailable", available: false, durable: false,
      reason: "DATABASE_URL or an injected secure HeyGen setup repository is required" },
  };
}

function selectStaticHeyGenLiveVerificationRuntime(
  dependencies: AiMediaStudioDependencies,
  databaseUrl: string | undefined,
): {
  coordinator: Pick<StaticHeyGenLiveVerificationCoordinator, "run"> | undefined;
  status: MediaStudioPersistenceStatus;
} {
  if (dependencies.staticHeyGenLiveVerificationCoordinator) {
    return {
      coordinator: dependencies.staticHeyGenLiveVerificationCoordinator,
      status: { mode: "injected", available: true, durable: false,
        reason: "Explicit live HeyGen verification coordinator supplied by the composition caller" },
    };
  }
  if (!dependencies.staticHeyGenLiveVerificationAuthorizer) {
    return {
      coordinator: undefined,
      status: { mode: "unavailable", available: false, durable: false,
        reason: "An explicit server-side live verification authorizer is required" },
    };
  }
  if (configuredDatabase(databaseUrl)) {
    try {
      const coordinator = (dependencies.createDurableStaticHeyGenLiveVerificationCoordinator
        ?? createDefaultDurableStaticHeyGenLiveVerificationCoordinator)(dependencies.staticHeyGenLiveVerificationAuthorizer);
      return {
        coordinator,
        status: { mode: "drizzle", available: true, durable: true,
          reason: "Explicitly authorized PostgreSQL/Drizzle live HeyGen verification selected" },
      };
    } catch (error) {
      return {
        coordinator: undefined,
        status: { mode: "unavailable", available: false, durable: false,
          reason: `Live HeyGen verification initialization failed: ${error instanceof Error ? error.message : "unknown error"}` },
      };
    }
  }
  return {
    coordinator: undefined,
    status: { mode: "unavailable", available: false, durable: false,
      reason: "DATABASE_URL and an explicit live verification authorizer are required" },
  };
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

function aiMediaStudioOriginMatchesRequest(req: Request, origin: string): boolean {
  const host = req.get("host");
  if (!host) return false;
  try {
    const originUrl = new URL(origin);
    if (originUrl.host === host) return true;
    const configuredOrigins = [process.env.PUBLIC_APP_URL, process.env.PUBLIC_BASE_URL, process.env.EXPO_PUBLIC_DOMAIN]
      .filter((value): value is string => Boolean(value?.trim()))
      .map((value) => value.startsWith("http") ? value : `https://${value}`);
    return configuredOrigins.some((value) => {
      try { return new URL(value).origin === originUrl.origin; } catch { return false; }
    });
  } catch {
    return false;
  }
}

function requireSameOriginJsonAiMediaStudioMutation(req: Request, res: Response, next: NextFunction): void {
  const fetchSite = req.get("sec-fetch-site");
  if (fetchSite && !["same-origin", "same-site", "none"].includes(fetchSite)) {
    res.status(403).json({ error: "Cross-site AI Media Studio requests are not allowed" });
    return;
  }
  const origin = req.get("origin");
  if (origin && !aiMediaStudioOriginMatchesRequest(req, origin)) {
    res.status(403).json({ error: "AI Media Studio request origin is not allowed" });
    return;
  }
  if (!req.is("application/json")) {
    res.status(415).json({ error: "AI Media Studio requests must use application/json" });
    return;
  }
  next();
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
  const environment = runtimeEnvironment?.trim().toLowerCase();
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
  const heyGenRosterSelection = selectHeyGenRosterRuntime(dependencies, databaseUrl);
  const heyGenRosterDailyPlan = heyGenRosterSelection.service
    ? new HeyGenRosterDailyPlanService(heyGenRosterSelection.service)
    : undefined;
  const heyGenOnboardingReadinessSelection = selectHeyGenOnboardingReadinessRuntime(dependencies, databaseUrl);
  const secureHeyGenSetupSelection = selectSecureHeyGenSetupRuntime(dependencies, databaseUrl);
  const staticHeyGenLiveVerificationSelection = selectStaticHeyGenLiveVerificationRuntime(dependencies, databaseUrl);
  const productionBatchSelection = selectProductionBatchRuntime(dependencies, databaseUrl);
  const launchPreflightSelection = selectLaunchPreflightRuntime(dependencies, databaseUrl);
  const sandboxReadinessSelection = selectSandboxReadinessRuntime(dependencies, databaseUrl);
  const oneVideoExecutionControlSelection = selectOneVideoExecutionControlRuntime(dependencies, databaseUrl);
  const oneVideoCostApprovalSelection = selectOneVideoCostApprovalRuntime(dependencies, databaseUrl);
  const oneVideoHeldAdmissionSelection = selectOneVideoHeldAdmissionRuntime(dependencies, databaseUrl);
  const sensitiveMutationRequestGuard = createSensitiveMutationRequestGuard(dependencies, runtimeEnvironment);
  const operations = createOperationsRuntime({
    ...dependencies.operations,
    runtimeEnvironment: dependencies.operations?.runtimeEnvironment ?? runtimeEnvironment,
    databaseUrl: dependencies.operations?.databaseUrl ?? databaseUrl,
  });
  const scriptService = new DeterministicScriptService();
  const kongSourceReader = dependencies.kongSourceReader
    ?? (!explicitHarness && environment === "production" && configuredDatabase(databaseUrl)
      ? new HttpKongSourceReader()
      : undefined);
  const sourceAutomationSync = new SourceAutomationSyncService(
    [
      ...(kongSourceReader ? [new KongOwnedSourceAdapter(kongSourceReader)] : []),
      ...(dependencies.sourceAdapters ?? []),
    ],
    operations.sources,
  );
  const sourceEligibilityReview = new SourceEligibilityReviewService(operations.sources);
  const sourceToScriptPreview = new SourceToScriptPreviewService(operations.sources, scriptService);
  const sourceToBatchAutomation = productionBatchSelection.service
    ? new SourceToBatchAutomationService(productionBatchSelection.service)
    : undefined;
  const sourceSyncSchedulerObserver = dependencies.sourceSyncSchedulerObserver
    ?? (!explicitHarness && configuredDatabase(databaseUrl)
      ? (dependencies.createDurableSourceSyncSchedulerObserver ?? createDefaultDurableSourceSyncSchedulerObserver)()
      : undefined);
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
    res.setHeader("X-AI-Media-Studio-HeyGen-Roster", heyGenRosterSelection.status.mode);
    res.setHeader("X-AI-Media-Studio-HeyGen-Onboarding", heyGenOnboardingReadinessSelection.status.mode);
    res.setHeader("X-AI-Media-Studio-HeyGen-Secure-Setup", secureHeyGenSetupSelection.status.mode);
    res.setHeader("X-AI-Media-Studio-HeyGen-Live-Verification", staticHeyGenLiveVerificationSelection.status.mode);
    res.setHeader("X-AI-Media-Studio-Production-Batches", productionBatchSelection.status.mode);
    res.setHeader("X-AI-Media-Studio-Sandbox-Readiness", sandboxReadinessSelection.status.mode);
    res.setHeader("X-AI-Media-Studio-One-Video-Execution-Control", oneVideoExecutionControlSelection.status.mode);
    res.setHeader("X-AI-Media-Studio-One-Video-Cost-Approval", oneVideoCostApprovalSelection.status.mode);
    res.setHeader("X-AI-Media-Studio-One-Video-Held-Admission", oneVideoHeldAdmissionSelection.status.mode);
    next();
  });

  router.get(`${AI_MEDIA_STUDIO_API_BASE}/runtime`, (req, res) => {
    getCurrentUserId(req);
    const available = persistence.status.available && core.status.available && operations.status.available
      && governanceSelection.status.available;
    res.status(available ? 200 : 503).json({ persistence: persistence.status, catalog: core.status,
      operations: operations.status, governance: governanceSelection.status,
      heyGenRoster: heyGenRosterSelection.status, heyGenOnboardingReadiness: heyGenOnboardingReadinessSelection.status,
      secureHeyGenSetup: secureHeyGenSetupSelection.status,
      staticHeyGenLiveVerification: staticHeyGenLiveVerificationSelection.status,
      productionBatches: productionBatchSelection.status,
      sandboxReadiness: sandboxReadinessSelection.status,
      oneVideoExecutionControl: oneVideoExecutionControlSelection.status,
      oneVideoCostApproval: oneVideoCostApprovalSelection.status,
      oneVideoHeldAdmission: oneVideoHeldAdmissionSelection.status });
  });

  router.get(`${AI_MEDIA_STUDIO_API_BASE}/agent`, asyncRoute(async (req, res) => {
    res.set("Cache-Control", "private, no-store");
    const scope = { ownerUserId: getCurrentUserId(req), workspaceId: core.workspaceId };
    let sourceScheduler: Awaited<ReturnType<SourceSyncSchedulerObserver["observe"]>> | "unavailable" | undefined;
    try {
      sourceScheduler = await sourceSyncSchedulerObserver?.observe(scope);
    } catch {
      sourceScheduler = "unavailable";
    }
    res.json(aiMediaStudioAgentSnapshotSchema.parse(createAiMediaStudioAgentSnapshot(() => new Date(), sourceScheduler)));
  }));

  const requireJobs = requireCapability(persistence.status, "AI Media Studio job");
  const requireCatalog = requireCapability(core.status, "AI Media Studio catalog");
  const requireOperations = requireCapability(operations.status, "AI Media Studio operations");
  const requireGovernance = requireCapability(governanceSelection.status, "AI Media Studio governance");
  const requireHeyGenRoster = requireCapability(heyGenRosterSelection.status, "HeyGen roster");
  const requireHeyGenOnboardingReadiness = requireCapability(heyGenOnboardingReadinessSelection.status, "HeyGen onboarding readiness");
  const requireSecureHeyGenSetup = requireCapability(secureHeyGenSetupSelection.status, "Secure HeyGen setup");
  const requireStaticHeyGenLiveVerification = requireCapability(
    staticHeyGenLiveVerificationSelection.status,
    "Live HeyGen verification",
  );
  const requireProductionBatches = requireCapability(productionBatchSelection.status, "AI Media Studio production batch");
  const requireLaunchPreflight = requireCapability(launchPreflightSelection.status, "AI Media Studio launch preflight");
  const requireSandboxReadiness = requireCapability(sandboxReadinessSelection.status, "AI Media Studio sandbox readiness");
  const requireOneVideoExecutionControl = requireCapability(oneVideoExecutionControlSelection.status,
    "AI Media Studio one-video execution control");
  const requireOneVideoCostApproval = requireCapability(oneVideoCostApprovalSelection.status,
    "AI Media Studio one-video cost approval");
  const requireOneVideoHeldAdmission = requireCapability(oneVideoHeldAdmissionSelection.status,
    "AI Media Studio one-video held admission");
  const requireStrictHeldAdmissionSession = (req: Request, res: Response, next: NextFunction): void => {
    const ownerUserId = resolveAuthenticatedUserId(req);
    if (!ownerUserId) {
      res.status(401).json({ error: "One-video held admission is not authorized", code: "UNAUTHENTICATED" });
      return;
    }
    res.locals.heldAdmissionUserId = ownerUserId;
    next();
  };
  const requireStrictHeldAdmissionMutation = (req: Request, res: Response, next: NextFunction): void => {
    try {
      if (!oneVideoHeldAdmissionSelection.requestGuard) {
        throw new StrictMoneyActionRequestError("INVALID_CONFIGURATION");
      }
      res.locals.heldAdmissionPrincipal = oneVideoHeldAdmissionSelection.requestGuard.authorize(req);
      next();
    } catch (error) {
      next(error);
    }
  };
  const requireStrictHeyGenRosterMutation = (req: Request, res: Response, next: NextFunction): void => {
    try {
      if (!sensitiveMutationRequestGuard) {
        throw new StrictMoneyActionRequestError("INVALID_CONFIGURATION");
      }
      res.locals.heyGenRosterPrincipal = sensitiveMutationRequestGuard.authorize(req);
      next();
    } catch (error) {
      next(error);
    }
  };
  const requireStrictSourceAutomationSync = (req: Request, res: Response, next: NextFunction): void => {
    try {
      if (!sensitiveMutationRequestGuard) {
        throw new StrictMoneyActionRequestError("INVALID_CONFIGURATION");
      }
      res.locals.sourceAutomationSyncPrincipal = sensitiveMutationRequestGuard.authorize(req);
      next();
    } catch (error) {
      next(error);
    }
  };
  const requireStrictSourceEligibilityReview = (req: Request, res: Response, next: NextFunction): void => {
    try {
      if (!sensitiveMutationRequestGuard) {
        throw new StrictMoneyActionRequestError("INVALID_CONFIGURATION");
      }
      res.locals.sourceEligibilityReviewPrincipal = sensitiveMutationRequestGuard.authorize(req);
      next();
    } catch (error) {
      next(error);
    }
  };
  const requireStrictSourceScriptPreview = (req: Request, res: Response, next: NextFunction): void => {
    try {
      if (!sensitiveMutationRequestGuard) {
        throw new StrictMoneyActionRequestError("INVALID_CONFIGURATION");
      }
      res.locals.sourceScriptPreviewPrincipal = sensitiveMutationRequestGuard.authorize(req);
      next();
    } catch (error) {
      next(error);
    }
  };
  const requireStrictSourceToBatchAutomation = (req: Request, res: Response, next: NextFunction): void => {
    try {
      if (!sensitiveMutationRequestGuard) {
        throw new StrictMoneyActionRequestError("INVALID_CONFIGURATION");
      }
      res.locals.sourceToBatchAutomationPrincipal = sensitiveMutationRequestGuard.authorize(req);
      next();
    } catch (error) {
      next(error);
    }
  };
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

  router.get(`${AI_MEDIA_STUDIO_API_BASE}/provider-configurations/heygen/onboarding-readiness`, (req, res, next) => {
    res.set("Cache-Control", "private, no-store"); getCurrentUserId(req); next();
  }, requireHeyGenOnboardingReadiness, asyncRoute(async (req, res) => {
    const contentLength = req.get("content-length");
    if (Object.keys(req.query).length !== 0 || req.get("transfer-encoding")
      || (contentLength !== undefined && contentLength !== "0")) {
      throw new HeyGenOnboardingReadinessError("INVALID_REQUEST");
    }
    const scope = { ownerUserId: getCurrentUserId(req), workspaceId: core.workspaceId };
    const readiness = await heyGenOnboardingReadinessSelection.service!.get(scope);
    res.json(heyGenOnboardingReadinessSchema.parse(readiness));
  }));

  router.post(`${AI_MEDIA_STUDIO_API_BASE}/provider-configurations/heygen/static-credential-reference`,
    (req, res, next) => { res.set("Cache-Control", "private, no-store"); getCurrentUserId(req); next(); },
    requireSameOriginJsonAiMediaStudioMutation,
    requireSecureHeyGenSetup, asyncRoute(async (req, res) => {
      const parsed = registerHeyGenCredentialReferenceRequestSchema.safeParse(req.body);
      if (!parsed.success || Object.keys(req.query).length !== 0) throw new SecureHeyGenSetupError("INVALID_REQUEST");
      const ownerUserId = getCurrentUserId(req);
      const receipt = await secureHeyGenSetupSelection.service!.setup({
        scope: { ownerUserId, workspaceId: core.workspaceId },
        actorUserId: ownerUserId,
        idempotencyKey: parsed.data.idempotencyKey,
      });
      res.status(receipt.outcome === "created" ? 201 : 200)
        .json(registerHeyGenCredentialReferenceResponseSchema.parse(receipt));
    }));

  router.post(`${AI_MEDIA_STUDIO_API_BASE}/provider-configurations/heygen/live-verification`,
    (req, res, next) => { res.set("Cache-Control", "private, no-store"); getCurrentUserId(req); next(); },
    requireSameOriginJsonAiMediaStudioMutation,
    requireStaticHeyGenLiveVerification, asyncRoute(async (req, res) => {
      const parsed = runHeyGenLiveVerificationRequestSchema.safeParse(req.body);
      if (!parsed.success || Object.keys(req.query).length !== 0) {
        throw new StaticHeyGenLiveVerificationError("INVALID_REQUEST");
      }
      const result = await staticHeyGenLiveVerificationSelection.coordinator!.run({
        scope: { ownerUserId: getCurrentUserId(req), workspaceId: core.workspaceId },
        idempotencyKey: parsed.data.idempotencyKey,
        authorizationContext: req,
      });
      if (result.outcome === "provider_failed") {
        res.status(503).json(runHeyGenLiveVerificationFailureResponseSchema.parse(result));
        return;
      }
      res.status(result.outcome === "recorded" ? 201 : 200).json(runHeyGenLiveVerificationResponseSchema.parse({
        outcome: result.outcome,
        verification: {
          providerKey: "heygen",
          state: "verified",
          avatarCount: result.verification.avatarCount,
          voiceCount: result.verification.voiceCount,
          observedAt: result.verification.verifiedAt,
          expiresAt: result.verification.expiresAt,
        },
        effects: result.effects,
      }));
    }));

  router.get(`${AI_MEDIA_STUDIO_API_BASE}/provider-configurations/heygen/roster`, requireHeyGenRoster, asyncRoute(async (req, res) => {
    const scope = { ownerUserId: getCurrentUserId(req), workspaceId: core.workspaceId };
    const roster = await heyGenRosterSelection.service!.currentStatus(scope);
    if (!roster) {
      res.status(404).json({ error: "HeyGen roster not found", code: "ROSTER_NOT_FOUND" });
      return;
    }
    res.json(configureHeyGenRosterResponseSchema.parse({ roster }));
  }));

  router.post(`${AI_MEDIA_STUDIO_API_BASE}/provider-configurations/heygen/roster`,
    requireStrictHeyGenRosterMutation,
    requireHeyGenOnboardingReadiness,
    requireHeyGenRoster,
    asyncRoute(async (req, res) => {
      const principal = res.locals.heyGenRosterPrincipal as StrictMoneyActionPrincipal | undefined;
      if (!principal?.authenticatedUserId) throw new HeyGenRosterError("ACCOUNT_UNAVAILABLE");
      const scope = { ownerUserId: principal.authenticatedUserId, workspaceId: core.workspaceId };
      const parsed = createHeyGenRosterRequestSchema.safeParse(req.body);
      if (!parsed.success || Object.keys(req.query).length !== 0 || req.get("transfer-encoding")) {
        throw new HeyGenRosterError("INVALID_REQUEST");
      }
      const readiness = await heyGenOnboardingReadinessSelection.service!.get(scope);
      if (!["ready_for_roster_ids", "roster_configured_blocked", "stale_roster_binding"].includes(readiness.status)) {
        throw new HeyGenRosterError("ACCOUNT_UNAVAILABLE");
      }
      const configured = await heyGenRosterSelection.service!.configure(scope, parsed.data);
      res.status(201).json(configureHeyGenRosterResponseSchema.parse(configured));
    }));

  router.get(`${AI_MEDIA_STUDIO_API_BASE}/provider-configurations/heygen/roster/daily-plan`, requireHeyGenRoster, asyncRoute(async (req, res) => {
    const scope = { ownerUserId: getCurrentUserId(req), workspaceId: core.workspaceId };
    const plan = await heyGenRosterDailyPlan!.currentPlan(scope);
    if (!plan) {
      res.status(404).json({ error: "HeyGen roster daily plan not found", code: "ROSTER_DAILY_PLAN_NOT_FOUND" });
      return;
    }
    res.json(heyGenRosterDailyPlanResponseSchema.parse({ plan }));
  }));

  router.get(`${AI_MEDIA_STUDIO_API_BASE}/production-batches/current`, requireProductionBatches, asyncRoute(async (req, res) => {
    const scope = { ownerUserId: getCurrentUserId(req), workspaceId: core.workspaceId };
    const batch = await productionBatchSelection.service!.current(scope);
    if (!batch) {
      res.status(404).json({ error: "Production batch not found", code: "PRODUCTION_BATCH_NOT_FOUND" });
      return;
    }
    res.json(productionBatchResponseSchema.parse({ batch }));
  }));

  router.post(`${AI_MEDIA_STUDIO_API_BASE}/production-batches/:planId/prepare-scripts`, requireProductionBatches, asyncRoute(async (req, res) => {
    const scope = { ownerUserId: getCurrentUserId(req), workspaceId: core.workspaceId };
    const batch = await productionBatchSelection.service!.prepare(scope, req.params.planId, req.body);
    res.json(productionBatchResponseSchema.parse({ batch }));
  }));

  router.post(`${AI_MEDIA_STUDIO_API_BASE}/production-batches/:planId/approve-scripts`, requireProductionBatches, asyncRoute(async (req, res) => {
    const scope = { ownerUserId: getCurrentUserId(req), workspaceId: core.workspaceId };
    const batch = await productionBatchSelection.service!.approve(scope, req.params.planId, req.body);
    res.json(productionBatchResponseSchema.parse({ batch }));
  }));

  router.get(`${AI_MEDIA_STUDIO_API_BASE}/production-batches/:planId/launch-preflight`, (_req, res, next) => {
    res.set("Cache-Control", "private, no-store"); next();
  }, requireLaunchPreflight, asyncRoute(async (req, res) => {
    const scope = { ownerUserId: getCurrentUserId(req), workspaceId: core.workspaceId };
    const contentLength = req.get("content-length");
    if (req.get("transfer-encoding") || (contentLength !== undefined && contentLength !== "0")) {
      throw new LaunchPreflightError("INVALID_REQUEST");
    }
    const preflight = await launchPreflightSelection.service!.observe(scope, req.params.planId);
    res.json(launchPreflightResponseSchema.parse({ preflight }));
  }));

  router.get(`${AI_MEDIA_STUDIO_API_BASE}/production-batches/:planId/sandbox-readiness/:slotId`, (req, res, next) => {
    res.set("Cache-Control", "private, no-store"); getCurrentUserId(req); next();
  }, requireSandboxReadiness, asyncRoute(async (req, res) => {
    const scope = { ownerUserId: getCurrentUserId(req), workspaceId: core.workspaceId };
    const contentLength = req.get("content-length");
    if (Object.keys(req.query).length !== 0 || req.get("transfer-encoding")
      || (contentLength !== undefined && contentLength !== "0")) {
      throw new SandboxReadinessError("INVALID_REQUEST");
    }
    const sandboxReadiness = await sandboxReadinessSelection.service!.observe(scope, req.params.planId, req.params.slotId);
    res.json(sandboxReadinessResponseSchema.parse({ sandboxReadiness }));
  }));

  router.get(`${AI_MEDIA_STUDIO_API_BASE}/production-batches/:planId/one-video-execution-control/:slotId`,
    (req, res, next) => { res.set("Cache-Control", "private, no-store"); getCurrentUserId(req); next(); },
    requireOneVideoExecutionControl, asyncRoute(async (req, res) => {
      const scope = { ownerUserId: getCurrentUserId(req), workspaceId: core.workspaceId };
      const contentLength = req.get("content-length");
      if (Object.keys(req.query).length !== 0 || req.get("transfer-encoding")
        || (contentLength !== undefined && contentLength !== "0")) {
        throw new OneVideoExecutionControlError("INVALID_REQUEST");
      }
      const executionControl = await oneVideoExecutionControlSelection.service!.observe(
        scope, req.params.planId, req.params.slotId,
      );
      res.json(oneVideoExecutionControlResponseSchema.parse({ executionControl }));
    }));

  router.get(`${AI_MEDIA_STUDIO_API_BASE}/production-batches/:planId/one-video-held-admission-readiness/:slotId`,
    (_req, res, next) => { res.set("Cache-Control", "private, no-store"); next(); },
    requireStrictHeldAdmissionSession,
    requireOneVideoHeldAdmission,
    asyncRoute(async (req, res) => {
      const path = oneVideoHeldAdmissionPathSchema.safeParse(req.params);
      const contentLength = req.get("content-length");
      if (!path.success || Object.keys(req.query).length !== 0 || req.get("transfer-encoding")
        || (contentLength !== undefined && contentLength !== "0")) {
        throw new OneVideoHeldAdmissionError("INVALID_REQUEST");
      }
      const ownerUserId = res.locals.heldAdmissionUserId;
      if (typeof ownerUserId !== "string") throw new OneVideoHeldAdmissionError("UNAUTHENTICATED");
      let readiness;
      try {
        readiness = await oneVideoHeldAdmissionSelection.runtime!.readiness.observe(
          { ownerUserId, workspaceId: "personal" }, path.data.planId, path.data.slotId,
        );
      } catch (error) {
        if (error instanceof OneVideoHeldAdmissionError) throw error;
        throw new OneVideoHeldAdmissionError("UNAVAILABLE");
      }
      if (!readiness) throw new OneVideoHeldAdmissionError("NOT_FOUND");
      res.json(oneVideoHeldAdmissionReadinessResponseSchema.parse({ readiness }));
    }));

  router.post(`${AI_MEDIA_STUDIO_API_BASE}/production-batches/:planId/one-video-held-admission/:slotId`,
    (_req, res, next) => { res.set("Cache-Control", "private, no-store"); next(); },
    requireStrictHeldAdmissionMutation,
    requireOneVideoHeldAdmission,
    asyncRoute(async (req, res) => {
      const path = oneVideoHeldAdmissionPathSchema.safeParse(req.params);
      const parsed = oneVideoHeldAdmissionRequestSchema.safeParse(req.body);
      if (!path.success || !parsed.success || Object.keys(req.query).length !== 0
        || req.get("transfer-encoding")) {
        throw new OneVideoHeldAdmissionError("INVALID_REQUEST");
      }
      const principal = res.locals.heldAdmissionPrincipal as StrictMoneyActionPrincipal | undefined;
      const ownerUserId = principal?.authenticatedUserId;
      if (!ownerUserId) throw new OneVideoHeldAdmissionError("UNAUTHENTICATED");
      let result;
      try {
        result = await oneVideoHeldAdmissionSelection.runtime!.coordinator.admit({
          scope: { ownerUserId, workspaceId: "personal" },
          publicPlanKey: path.data.planId,
          publicSlotKey: path.data.slotId,
          expectedBatchId: parsed.data.expectedBatchId,
          expectedQuoteKey: parsed.data.expectedQuoteKey,
          expectedRenderSpecKey: parsed.data.expectedRenderSpecKey,
          expectedSlotAttempt: parsed.data.expectedSlotAttempt,
          idempotencyKey: parsed.data.idempotencyKey,
          authorizationContext: principal,
        });
      } catch (error) {
        if (error instanceof OneVideoHeldAdmissionError) throw error;
        throw new OneVideoHeldAdmissionError("UNAVAILABLE");
      }
      res.status(result.outcome === "admitted" ? 201 : 200)
        .json(oneVideoHeldAdmissionResponseSchema.parse(result));
    }));

  router.post(`${AI_MEDIA_STUDIO_API_BASE}/production-batches/:planId/one-video-cost-approval/:slotId`,
    (req, res, next) => { res.set("Cache-Control", "private, no-store"); getCurrentUserId(req); next(); },
    requireSameOriginJsonAiMediaStudioMutation,
    requireOneVideoCostApproval,
    asyncRoute(async (req, res) => {
      const parsed = oneVideoCostApprovalRequestSchema.safeParse(req.body);
      const path = oneVideoCostApprovalPathSchema.safeParse(req.params);
      if (!parsed.success || !path.success || Object.keys(req.query).length !== 0) {
        throw new OneVideoCostApprovalError("INVALID_REQUEST");
      }
      const result = await oneVideoCostApprovalSelection.coordinator!.record({
        scope: { ownerUserId: getCurrentUserId(req), workspaceId: core.workspaceId },
        publicPlanKey: path.data.planId,
        publicSlotKey: path.data.slotId,
        expectedBatchId: parsed.data.expectedBatchId,
        expectedQuoteKey: parsed.data.expectedQuoteKey,
        decision: parsed.data.decision,
        idempotencyKey: parsed.data.idempotencyKey,
        authorizationContext: req,
      });
      res.status(result.outcome === "recorded" ? 201 : 200)
        .json(oneVideoCostApprovalResponseSchema.parse(result));
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

  router.post(`${AI_MEDIA_STUDIO_API_BASE}/generations`, asyncRoute(async (req, res) => {
    getCurrentUserId(req);
    res.status(409).json({ error: "A prepared and admitted production plan is required", code: "PLAN_ADMISSION_REQUIRED" });
  }));

  router.post(`${AI_MEDIA_STUDIO_API_BASE}/scripts/generate`, asyncRoute(async (req, res) => {
    getCurrentUserId(req);
    res.json(scriptService.generate(generateScriptVariantsRequestSchema.parse(req.body)));
  }));

  router.post(`${AI_MEDIA_STUDIO_API_BASE}/automation/sources/scripts/preview`,
    requireStrictSourceScriptPreview,
    requireOperations,
    asyncRoute(async (req, res) => {
      const principal = res.locals.sourceScriptPreviewPrincipal as StrictMoneyActionPrincipal | undefined;
      if (!principal?.authenticatedUserId) throw new SourceToScriptPreviewError("INVALID_REQUEST");
      if (Object.keys(req.query).length !== 0 || req.get("transfer-encoding")) {
        throw new SourceToScriptPreviewError("INVALID_REQUEST");
      }
      const input = sourceScriptPreviewRequestSchema.safeParse(req.body);
      if (!input.success) throw new SourceToScriptPreviewError("INVALID_REQUEST");
      const result = await sourceToScriptPreview.preview({
        ownerUserId: principal.authenticatedUserId,
        workspaceId: core.workspaceId,
      }, input.data);
      res.json(sourceScriptPreviewResponseSchema.parse(result));
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

  router.post(`${AI_MEDIA_STUDIO_API_BASE}/automation/sources/sync`,
    requireStrictSourceAutomationSync,
    requireOperations,
    asyncRoute(async (req, res) => {
      const principal = res.locals.sourceAutomationSyncPrincipal as StrictMoneyActionPrincipal | undefined;
      if (!principal?.authenticatedUserId) throw new SourceAutomationSyncError("INVALID_REQUEST");
      if (Object.keys(req.query).length !== 0 || req.get("transfer-encoding")) {
        throw new SourceAutomationSyncError("INVALID_REQUEST");
      }
      const input = sourceAutomationSyncRequestSchema.safeParse(req.body);
      if (!input.success) throw new SourceAutomationSyncError("INVALID_REQUEST");
      const scope = { ownerUserId: principal.authenticatedUserId, workspaceId: core.workspaceId };
      const result = await sourceAutomationSync.sync(scope, input.data);
      res.json(sourceAutomationSyncResponseSchema.parse(result));
    }));

  router.post(`${AI_MEDIA_STUDIO_API_BASE}/automation/sources/production-batch/prepare`,
    requireStrictSourceToBatchAutomation,
    requireProductionBatches,
    asyncRoute(async (req, res) => {
      const principal = res.locals.sourceToBatchAutomationPrincipal as StrictMoneyActionPrincipal | undefined;
      if (!principal?.authenticatedUserId || !sourceToBatchAutomation) throw new ProductionBatchError("INVALID_REQUEST");
      if (Object.keys(req.query).length !== 0 || req.get("transfer-encoding")
        || !sourceToBatchAutomationRequestSchema.safeParse(req.body).success) {
        throw new ProductionBatchError("INVALID_REQUEST");
      }
      const result = await sourceToBatchAutomation.run({
        ownerUserId: principal.authenticatedUserId,
        workspaceId: core.workspaceId,
      });
      res.status(result.outcome === "prepared" ? 201 : 200)
        .json(sourceToBatchAutomationResponseSchema.parse(result));
    }));

  router.post(`${AI_MEDIA_STUDIO_API_BASE}/automation/sources/:sourceItemId/eligibility-review`,
    requireStrictSourceEligibilityReview,
    requireOperations,
    asyncRoute(async (req, res) => {
      const principal = res.locals.sourceEligibilityReviewPrincipal as StrictMoneyActionPrincipal | undefined;
      if (!principal?.authenticatedUserId) throw new SourceEligibilityReviewError("INVALID_REQUEST");
      if (Object.keys(req.query).length !== 0 || req.get("transfer-encoding")) {
        throw new SourceEligibilityReviewError("INVALID_REQUEST");
      }
      const scope = { ownerUserId: principal.authenticatedUserId, workspaceId: core.workspaceId };
      const result = await sourceEligibilityReview.review(
        scope,
        principal.authenticatedUserId,
        req.params.sourceItemId,
        req.body,
      );
      res.status(result.review.replayed ? 200 : 201).json(sourceEligibilityReviewResponseSchema.parse(result));
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
  router.post(`${AI_MEDIA_STUDIO_API_BASE}/jobs/:id/retry`, asyncRoute(async (req, res) => {
    getCurrentUserId(req);
    res.status(409).json({ error: "A prepared and admitted production plan is required", code: "PLAN_ADMISSION_REQUIRED" });
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
    if (error instanceof StaticHeyGenLiveVerificationError) {
      const message = error.code === "INVALID_REQUEST" ? "Invalid live HeyGen verification request"
        : error.code === "UNAUTHORIZED" ? "Live HeyGen verification is not authorized"
          : "Live HeyGen verification is unavailable";
      res.status(error.statusCode).json({ error: message, code: error.code });
      return;
    }
    if (error instanceof SecureHeyGenSetupError) {
      const message = error.code === "INVALID_REQUEST" ? "Invalid secure HeyGen setup request"
        : error.code === "CONFLICT" || error.code === "AMBIGUOUS"
          ? "Secure HeyGen setup conflicts with existing provider metadata"
          : "Secure HeyGen setup is unavailable";
      res.status(error.statusCode).json({ error: message, code: error.code });
      return;
    }
    if (error instanceof HeyGenOnboardingReadinessError) {
      const message = error.code === "INVALID_REQUEST"
        ? "Invalid HeyGen onboarding readiness request"
        : "HeyGen onboarding readiness is unavailable";
      res.status(error.statusCode).json({ error: message, code: error.code });
      return;
    }
    if (error instanceof SandboxReadinessError) {
      const message = error.code === "INVALID_REQUEST" ? "Invalid sandbox readiness request"
        : error.code === "NOT_FOUND" ? "Production plan or slot not found" : "Sandbox readiness is unavailable";
      res.status(error.statusCode).json({ error: message, code: error.code });
      return;
    }
    if (error instanceof OneVideoExecutionControlError) {
      const message = error.code === "INVALID_REQUEST" ? "Invalid one-video execution-control request"
        : error.code === "NOT_FOUND" ? "Production plan or slot not found" : "One-video execution control is unavailable";
      res.status(error.statusCode).json({ error: message, code: error.code });
      return;
    }
    if (error instanceof OneVideoCostApprovalError) {
      const message = error.code === "INVALID_REQUEST" ? "Invalid one-video cost approval request"
        : error.code === "UNAUTHENTICATED" || error.code === "FORBIDDEN"
          ? "One-video cost approval is not authorized"
          : error.code === "NOT_FOUND" ? "Production plan or slot not found"
            : error.code === "STALE_OR_CONFLICT" ? "The batch or quote changed; refresh before deciding"
              : "One-video cost approval is unavailable";
      res.status(error.statusCode).json({ error: message, code: error.code });
      return;
    }
    if (error instanceof StrictMoneyActionRequestError) {
      const message = error.code === "UNAUTHENTICATED"
        ? "AI Media Studio mutation is not authorized"
        : error.code === "INVALID_CONFIGURATION"
          ? "AI Media Studio mutation is unavailable"
          : "AI Media Studio mutation request was denied";
      res.status(error.statusCode).json({ error: message, code: error.code });
      return;
    }
    if (error instanceof OneVideoHeldAdmissionError) {
      const message = error.code === "INVALID_REQUEST" ? "Invalid one-video held admission request"
        : error.code === "UNAUTHENTICATED" || error.code === "FORBIDDEN"
          ? "One-video held admission is not authorized"
          : error.code === "NOT_FOUND" ? "Production plan or slot not found"
            : error.code === "STALE_OR_CONFLICT" ? "Held admission changed; refresh before retrying"
              : error.code === "ADMISSION_DENIED" ? "Held admission is not currently available"
                : "One-video held admission is unavailable";
      res.status(error.statusCode).json({ error: message, code: error.code });
      return;
    }
    if (error instanceof SourceAutomationSyncError) {
      const message = error.code === "INVALID_REQUEST"
        ? "Invalid source automation sync request"
        : error.code === "ADAPTER_UNAVAILABLE"
          ? "Source automation adapter is unavailable"
          : "Source automation sync is unavailable";
      res.status(error.statusCode).json({ error: message, code: error.code });
      return;
    }
    if (error instanceof SourceToScriptPreviewError) {
      const message = error.code === "INVALID_REQUEST" ? "Invalid source script preview request"
        : error.code === "NOT_FOUND" ? "Source item not found"
          : error.code === "SOURCE_INELIGIBLE" ? "Source item is not eligible for script preview"
            : "Source script preview is unavailable";
      res.status(error.statusCode).json({ error: message, code: error.code });
      return;
    }
    if (error instanceof SourceEligibilityReviewError) {
      const message = error.code === "INVALID_REQUEST" ? "Invalid source eligibility review request"
        : error.code === "NOT_FOUND" ? "Source item not found"
          : error.code === "SOURCE_REFRESHED" ? "Source content changed; review the current version"
            : error.code === "REVIEW_CONFLICT" ? "Source eligibility review conflicts with an existing decision"
              : "Source eligibility review is unavailable";
      res.status(error.statusCode).json({ error: message, code: error.code });
      return;
    }
    if (error instanceof LaunchPreflightError) {
      const message = error.code === "INVALID_REQUEST" ? "Invalid launch preflight request"
        : error.code === "NOT_FOUND" ? "Production plan not found" : "Launch preflight is unavailable";
      res.status(error.statusCode).json({ error: message, code: error.code });
      return;
    }
    if (error instanceof ProductionBatchError) {
      const message = error.code === "INVALID_REQUEST" ? "Invalid production batch request"
        : error.code === "NOT_FOUND" ? "Production plan not found"
          : error.code === "IDEMPOTENCY_CONFLICT" ? "Production batch request conflicts with the prepared batch"
            : error.code === "SOURCE_INELIGIBLE" ? "Exactly 10 eligible sources are required"
              : error.code === "SOURCE_REFRESHED" ? "A selected source changed; script refresh is required"
                : "Production batch is unavailable";
      res.status(error.statusCode).json({ error: message, code: error.code });
      return;
    }
    if (error instanceof HeyGenRosterError) {
      const status = error.code === "INVALID_REQUEST" ? 400
        : error.code === "IDEMPOTENCY_CONFLICT" ? 409
          : 503;
      const message = status === 400 ? "Invalid HeyGen roster request"
        : status === 409 ? "HeyGen roster request conflicts with an existing operation"
          : "HeyGen roster is unavailable";
      res.status(status).json({ error: message, code: error.code });
      return;
    }
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
    heyGenRoster: heyGenRosterSelection.service,
    heyGenRosterDailyPlan,
    heyGenRosterPersistence: heyGenRosterSelection.status,
    heyGenOnboardingReadiness: heyGenOnboardingReadinessSelection.service,
    heyGenOnboardingReadinessPersistence: heyGenOnboardingReadinessSelection.status,
    secureHeyGenSetup: secureHeyGenSetupSelection.service,
    secureHeyGenSetupPersistence: secureHeyGenSetupSelection.status,
    staticHeyGenLiveVerification: staticHeyGenLiveVerificationSelection.coordinator,
    staticHeyGenLiveVerificationPersistence: staticHeyGenLiveVerificationSelection.status,
    productionBatches: productionBatchSelection.service,
    productionBatchPersistence: productionBatchSelection.status,
    launchPreflight: launchPreflightSelection.service,
    launchPreflightPersistence: launchPreflightSelection.status,
    sandboxReadiness: sandboxReadinessSelection.service,
    sandboxReadinessPersistence: sandboxReadinessSelection.status,
    oneVideoExecutionControl: oneVideoExecutionControlSelection.service,
    oneVideoExecutionControlPersistence: oneVideoExecutionControlSelection.status,
    oneVideoCostApproval: oneVideoCostApprovalSelection.coordinator,
    oneVideoCostApprovalPersistence: oneVideoCostApprovalSelection.status,
    oneVideoHeldAdmissionReadiness: oneVideoHeldAdmissionSelection.runtime?.readiness,
    oneVideoHeldAdmission: oneVideoHeldAdmissionSelection.runtime?.coordinator,
    oneVideoHeldAdmissionPersistence: oneVideoHeldAdmissionSelection.status,
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
