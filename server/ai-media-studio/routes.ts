import type { Express, NextFunction, Request, Response } from "express";
import { Router } from "express";
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
import { verifyHeyGenWebhook } from "./webhook-security";
import {
  createDefaultDurableRepository,
  MediaStudioPersistenceUnavailableError,
  selectMediaJobRepository,
  type MediaStudioPersistenceStatus,
} from "./persistence/runtime";

export interface AiMediaStudioDependencies {
  repository?: MediaJobRepository;
  queue?: MediaJobQueue;
  providers?: VideoProvider[];
  defaultProviderKey?: string;
  webhookSecrets?: Record<string, string | undefined>;
  heygenResourceMap?: HeyGenResourceMap;
  allowedAssetHosts?: ReadonlySet<string>;
  runtimeEnvironment?: string;
  databaseUrl?: string;
  createDurableRepository?: () => MediaJobRepository;
  coreRepositories?: CoreCatalogRepositories;
  createDurableCoreRepositories?: () => CoreCatalogRepositories;
  workspaceId?: string;
  seedCoreDefaults?: boolean;
}
export interface AiMediaStudioRuntime {
  service: AiMediaStudioService;
  core: CoreCatalogRuntime;
  router: Router;
  persistence: MediaStudioPersistenceStatus;
}

function toPublicJob(job: MediaGenerationJob): MediaJob {
  return {
    id: job.id, generationId: job.generationId, title: job.title || "Untitled video",
    influencerName: job.influencerName ?? "", status: job.status, stage: job.stage ?? "queued",
    progress: job.progress, aspectRatio: job.request.aspectRatio, language: job.request.language,
    estimatedCostUsd: job.estimatedCostUsd ?? 0, actualCostUsd: job.actualCostUsd,
    attempt: job.attempts, maxAttempts: job.maxAttempts, createdAt: job.createdAt,
    updatedAt: job.updatedAt, estimatedCompletionAt: job.estimatedCompletionAt, error: job.error,
    asset: job.outputUrl ? { url: job.outputUrl, mimeType: "video/mp4" } : undefined,
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
  const repository = persistence.repository;
  const queue = dependencies.queue ?? new InMemoryMediaJobQueue();
  const resources = dependencies.heygenResourceMap ?? parseHeyGenResourceMap(process.env.AI_MEDIA_STUDIO_HEYGEN_RESOURCES_JSON);
  const providers = dependencies.providers ?? [
    new FakeVideoProvider(),
    new HeyGenVideoProvider({ apiKey: process.env.HEYGEN_API_KEY, resolveResources: createHeyGenResourceResolver(resources) }),
  ];
  const defaultProviderKey = dependencies.defaultProviderKey ?? (process.env.AI_MEDIA_STUDIO_HEYGEN_ENABLED === "true" ? "heygen" : "fake");
  const service = new AiMediaStudioService(repository, queue, providers, defaultProviderKey, {
    allowedAssetHosts: dependencies.allowedAssetHosts ?? envAssetHosts(),
    executionMode: persistence.status.durable ? "durable" : "inline",
  });
  const scriptService = new DeterministicScriptService();
  const router = Router();

  router.use((_req, res, next) => {
    res.setHeader("X-AI-Media-Studio-Persistence", persistence.status.mode);
    res.setHeader("X-AI-Media-Studio-Catalog", core.status.mode);
    next();
  });

  router.get(`${AI_MEDIA_STUDIO_API_BASE}/runtime`, (req, res) => {
    getCurrentUserId(req);
    const available = persistence.status.available && core.status.available;
    res.status(available ? 200 : 503).json({ persistence: persistence.status, catalog: core.status });
  });

  const requireJobs = requireCapability(persistence.status, "AI Media Studio job");
  const requireCatalog = requireCapability(core.status, "AI Media Studio catalog");
  const tenant = async (req: Request): Promise<TenantScope> => {
    const scope = { ownerUserId: getCurrentUserId(req), workspaceId: core.workspaceId };
    await core.ensureDefaults(scope);
    return scope;
  };

  router.get(`${AI_MEDIA_STUDIO_API_BASE}/dashboard`, requireJobs, asyncRoute(async (req, res) => {
    const ownerUserId = getCurrentUserId(req);
    const dashboard = await service.dashboard(ownerUserId);
    const jobs = await service.listJobs(ownerUserId);
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

  router.get(`${AI_MEDIA_STUDIO_API_BASE}/jobs`, requireJobs, asyncRoute(async (req, res) => {
    res.json(mediaJobsResponseSchema.parse({ jobs: (await service.listJobs(getCurrentUserId(req))).map(toPublicJob) }));
  }));

  router.post(`${AI_MEDIA_STUDIO_API_BASE}/generations`, requireJobs, requireCatalog, asyncRoute(async (req, res) => {
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

  router.get(`${AI_MEDIA_STUDIO_API_BASE}/jobs/:id`, requireJobs, asyncRoute(async (req, res) => {
    res.json(mediaJobResponseSchema.parse({ job: toPublicJob(await service.getJob(getCurrentUserId(req), req.params.id)) }));
  }));
  router.post(`${AI_MEDIA_STUDIO_API_BASE}/jobs/:id/retry`, requireJobs, asyncRoute(async (req, res) => {
    res.json(mediaJobResponseSchema.parse({ job: toPublicJob(await service.retryJob(getCurrentUserId(req), req.params.id)) }));
  }));
  router.post(`${AI_MEDIA_STUDIO_API_BASE}/jobs/:id/cancel`, requireJobs, asyncRoute(async (req, res) => {
    res.json(mediaJobResponseSchema.parse({ job: toPublicJob(await service.cancelJob(getCurrentUserId(req), req.params.id)) }));
  }));

  router.post(`${AI_MEDIA_STUDIO_API_BASE}/webhooks/providers/:providerKey`, requireJobs, asyncRoute(async (req, res) => {
    const requestWithRawBody = req as Request & { rawBody?: unknown };
    const rawBody = Buffer.isBuffer(requestWithRawBody.rawBody) ? requestWithRawBody.rawBody : Buffer.alloc(0);
    const providerKey = req.params.providerKey;
    const secret = dependencies.webhookSecrets?.[providerKey] ?? (providerKey === "heygen" ? process.env.HEYGEN_WEBHOOK_SECRET : process.env.AI_MEDIA_STUDIO_WEBHOOK_SECRET);
    if (!verifyHeyGenWebhook({ rawBody, secret, signature: req.get("Heygen-Signature") ?? undefined, timestamp: req.get("Heygen-Timestamp") ?? undefined })) {
      res.status(401).json({ error: "Invalid webhook signature" });
      return;
    }
    const result = await service.ingestWebhook(providerKey, req.body, req.get("Heygen-Event-Id") ?? undefined, req.get("Heygen-Timestamp") ?? undefined);
    res.status(202).json(result);
  }));

  router.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (error instanceof MediaStudioError || error instanceof MediaStudioPersistenceUnavailableError) { res.status(error.statusCode).json({ error: error.message }); return; }
    if (error instanceof CoreDomainValidationError) { res.status(400).json({ error: error.message, code: error.code }); return; }
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
  return { service, core, router, persistence: persistence.status };
}

export function registerAiMediaStudioRoutes(app: Express, dependencies: AiMediaStudioDependencies = {}): AiMediaStudioRuntime {
  const runtime = createAiMediaStudioRuntime(dependencies);
  app.use(runtime.router);
  return runtime;
}
