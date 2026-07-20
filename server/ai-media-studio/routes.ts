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
import { generateScriptVariantsRequestSchema } from "../../shared/ai-media-studio-scripts";
import { getCurrentUserId } from "../user-context";
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

const INFLUENCERS = [
  { id: "emily-food", name: "Emily", categories: ["food", "restaurants"], language: "en", voiceId: "voice-emily-en", status: "active" },
  { id: "sofia-travel", name: "Sofia", categories: ["travel", "hotels"], language: "es", voiceId: "voice-sofia-es", status: "active" },
];
const VOICES = [
  { id: "voice-emily-en", name: "Emily English", language: "en", accent: "American" },
  { id: "voice-sofia-es", name: "Sofia Español", language: "es", accent: "Latino" },
];
const LANGUAGES = [{ code: "en", label: "English" }, { code: "es", label: "Español" }];

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
}
export interface AiMediaStudioRuntime {
  service: AiMediaStudioService;
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

export function createAiMediaStudioRuntime(dependencies: AiMediaStudioDependencies = {}): AiMediaStudioRuntime {
  const persistence = selectMediaJobRepository({
    repository: dependencies.repository,
    runtimeEnvironment: dependencies.runtimeEnvironment ?? process.env.NODE_ENV,
    databaseUrl: dependencies.databaseUrl ?? process.env.DATABASE_URL,
    createDurableRepository: dependencies.createDurableRepository ?? createDefaultDurableRepository,
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
    influencerNames: new Map(INFLUENCERS.map((item) => [item.id, item.name])),
    allowedAssetHosts: dependencies.allowedAssetHosts ?? envAssetHosts(),
  });
  const scriptService = new DeterministicScriptService();
  const router = Router();

  router.use((_req, res, next) => {
    res.setHeader("X-AI-Media-Studio-Persistence", persistence.status.mode);
    next();
  });

  router.get(`${AI_MEDIA_STUDIO_API_BASE}/runtime`, (req, res) => {
    getCurrentUserId(req);
    res.status(persistence.status.available ? 200 : 503).json({ persistence: persistence.status });
  });

  router.use((req, res, next) => {
    if (persistence.status.available) { next(); return; }
    res.status(503).json({ error: "AI Media Studio persistence unavailable", persistence: persistence.status });
  });

  router.get(`${AI_MEDIA_STUDIO_API_BASE}/dashboard`, asyncRoute(async (req, res) => {
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

  router.get(`${AI_MEDIA_STUDIO_API_BASE}/options`, (req, res) => {
    getCurrentUserId(req);
    res.json(mediaStudioOptionsResponseSchema.parse({ influencers: INFLUENCERS, voices: VOICES, languages: LANGUAGES }));
  });

  router.get(`${AI_MEDIA_STUDIO_API_BASE}/jobs`, asyncRoute(async (req, res) => {
    res.json(mediaJobsResponseSchema.parse({ jobs: (await service.listJobs(getCurrentUserId(req))).map(toPublicJob) }));
  }));

  router.post(`${AI_MEDIA_STUDIO_API_BASE}/generations`, asyncRoute(async (req, res) => {
    const input = createGenerationRequestSchema.parse(req.body);
    const job = await service.createGeneration(getCurrentUserId(req), input);
    res.status(202).json({ generationId: job.generationId, jobId: job.id, job: toPublicJob(job) });
  }));

  router.post(`${AI_MEDIA_STUDIO_API_BASE}/scripts/generate`, asyncRoute(async (req, res) => {
    getCurrentUserId(req);
    res.json(scriptService.generate(generateScriptVariantsRequestSchema.parse(req.body)));
  }));

  router.get(`${AI_MEDIA_STUDIO_API_BASE}/jobs/:id`, asyncRoute(async (req, res) => {
    res.json(mediaJobResponseSchema.parse({ job: toPublicJob(await service.getJob(getCurrentUserId(req), req.params.id)) }));
  }));
  router.post(`${AI_MEDIA_STUDIO_API_BASE}/jobs/:id/retry`, asyncRoute(async (req, res) => {
    res.json(mediaJobResponseSchema.parse({ job: toPublicJob(await service.retryJob(getCurrentUserId(req), req.params.id)) }));
  }));
  router.post(`${AI_MEDIA_STUDIO_API_BASE}/jobs/:id/cancel`, asyncRoute(async (req, res) => {
    res.json(mediaJobResponseSchema.parse({ job: toPublicJob(await service.cancelJob(getCurrentUserId(req), req.params.id)) }));
  }));

  router.post(`${AI_MEDIA_STUDIO_API_BASE}/webhooks/providers/:providerKey`, asyncRoute(async (req, res) => {
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
  return { service, router, persistence: persistence.status };
}

export function registerAiMediaStudioRoutes(app: Express, dependencies: AiMediaStudioDependencies = {}): AiMediaStudioRuntime {
  const runtime = createAiMediaStudioRuntime(dependencies);
  app.use(runtime.router);
  return runtime;
}
