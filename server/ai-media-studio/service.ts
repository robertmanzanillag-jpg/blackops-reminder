import { createHash, randomUUID } from "node:crypto";
import type { GenerationRequest, MediaGenerationJob, ProviderStatus, ProviderWebhookEvent } from "./domain";
import { MediaJobStateConflictError, TERMINAL_STATUSES } from "./domain";
import type { MediaJobQueue, MediaJobRepository, VideoProvider } from "./ports";
import type { AssetIngestJob, AssetIngestRepository } from "./assets";

export class MediaStudioError extends Error {
  constructor(message: string, readonly statusCode: number) {
    super(message);
  }
}

export interface AiMediaStudioServiceOptions {
  influencerNames?: ReadonlyMap<string, string>;
  allowedAssetHosts?: ReadonlySet<string>;
  /**
   * Inline is the process-local preview path. Durable leaves the database row
   * due for a separately-invoked RenderWorker and never touches MediaJobQueue.
   */
  executionMode?: "inline" | "durable";
  /** Durable, idempotent provider-output handoff. Required to own completed remote artifacts. */
  assetIngestRepository?: AssetIngestRepository;
  /** Live probe supplied only by a composition that owns the reader, storage, signer, and worker process. */
  assetIngestWorkerReadiness?: { isReady(): boolean | Promise<boolean> };
  workspaceId?: string;
}

export function isAllowedProviderAssetUrl(value: string, allowedHosts: ReadonlySet<string>): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password && allowedHosts.has(url.hostname.toLowerCase());
  } catch {
    return false;
  }
}

export class AiMediaStudioService {
  private readonly providers = new Map<string, VideoProvider>();

  constructor(
    private readonly repository: MediaJobRepository,
    private readonly queue: MediaJobQueue,
    providers: VideoProvider[],
    private readonly defaultProviderKey: string,
    private readonly options: AiMediaStudioServiceOptions = {},
  ) {
    for (const provider of providers) this.providers.set(provider.key, provider);
  }

  async createGeneration(ownerUserId: string, request: GenerationRequest): Promise<MediaGenerationJob> {
    if (request.script.length > 5_000) throw new MediaStudioError("Script exceeds the provider limit of 5000 characters", 400);
    const existing = await this.repository.getByIdempotencyKey(ownerUserId, request.idempotencyKey);
    if (existing) return existing;
    const provider = this.requireProvider(this.defaultProviderKey);
    await this.requireProviderReadyForGeneration(provider);
    let job = await this.repository.create(ownerUserId, request);
    job = await this.repository.update({
      ...job,
      providerName: provider.key,
      influencerName: this.options.influencerNames?.get(request.influencerId) ?? "",
    });
    if (this.executionMode === "durable") return job;
    await this.queue.enqueue({ type: "render", ownerUserId, jobId: job.id });
    await this.processNext();
    return this.getJob(ownerUserId, job.id);
  }

  listJobs(ownerUserId: string): Promise<MediaGenerationJob[]> {
    return this.repository.list(ownerUserId);
  }

  async getJob(ownerUserId: string, jobId: string): Promise<MediaGenerationJob> {
    const job = await this.repository.get(ownerUserId, jobId);
    if (!job) throw new MediaStudioError("Media job not found", 404);
    return job;
  }

  async retryJob(ownerUserId: string, jobId: string): Promise<MediaGenerationJob> {
    const job = await this.getJob(ownerUserId, jobId);
    if (job.status !== "failed") throw new MediaStudioError("Only failed jobs can be retried", 409);
    if (job.attempts >= job.maxAttempts) throw new MediaStudioError("Maximum retry attempts reached", 409);
    await this.requireProviderReadyForGeneration(this.requireProvider(job.providerName ?? this.defaultProviderKey));
    const pending = await this.repository.update({
      ...job,
      status: "pending",
      progress: 0,
      stage: "queued",
      providerJobId: undefined,
      outputUrl: undefined,
      outputAssetId: undefined,
      error: undefined,
      completedAt: undefined,
      lastProviderEventAt: undefined,
      retryCount: job.retryCount + 1,
      attempts: this.executionMode === "durable" ? job.attempts + 1 : job.attempts,
    });
    if (this.executionMode === "durable") return pending;
    await this.queue.enqueue({ type: "render", ownerUserId, jobId });
    await this.processNext();
    return this.getJob(ownerUserId, pending.id);
  }

  async cancelJob(ownerUserId: string, jobId: string): Promise<MediaGenerationJob> {
    const job = await this.getJob(ownerUserId, jobId);
    if (TERMINAL_STATUSES.has(job.status)) throw new MediaStudioError("Terminal jobs cannot be cancelled", 409);
    if (job.stage === "artifact_ingest_queued" || job.stage === "artifact_ingest_retrying") {
      throw new MediaStudioError("A completed provider render must finish owned artifact ingest", 409);
    }
    if (this.executionMode === "durable" && (job.status !== "pending" || job.stage !== "queued")) {
      throw new MediaStudioError("A render already claimed by a provider cannot be cancelled", 409);
    }
    try {
      return await this.repository.update({
        ...job,
        status: "cancelled",
        progress: job.progress,
        stage: "cancelled",
        completedAt: new Date().toISOString(),
      });
    } catch (error) {
      if (error instanceof MediaJobStateConflictError) {
        throw new MediaStudioError("A render already claimed by a provider cannot be cancelled", 409);
      }
      throw error;
    }
  }

  async dashboard(ownerUserId: string) {
    const jobs = await this.repository.list(ownerUserId);
    const providers: ProviderStatus[] = await Promise.all([...this.providers.values()].map((provider) => provider.status()));
    return {
      summary: {
        total: jobs.length,
        pending: jobs.filter((job) => job.status === "pending").length,
        rendering: jobs.filter((job) => job.status === "rendering").length,
        completed: jobs.filter((job) => job.status === "completed").length,
        failed: jobs.filter((job) => job.status === "failed").length,
        cancelled: jobs.filter((job) => job.status === "cancelled").length,
      },
      providers,
      queue: { pending: await this.queue.size() },
      recentActivity: jobs.slice(0, 10),
    };
  }

  async ingestWebhook(providerKey: string, payload: unknown, eventIdOverride?: string, occurredAtOverride?: string) {
    const provider = this.requireProvider(providerKey);
    const enrichedPayload = payload && typeof payload === "object"
      ? { ...payload, event_id: eventIdOverride ?? (payload as Record<string, unknown>).event_id }
      : payload;
    const parsed = provider.parseWebhook(enrichedPayload);
    const timestampNumber = occurredAtOverride && /^\d+$/.test(occurredAtOverride) ? Number(occurredAtOverride) : undefined;
    const occurredAt = occurredAtOverride
      ? new Date(timestampNumber === undefined ? occurredAtOverride : timestampNumber * (occurredAtOverride.length <= 10 ? 1_000 : 1)).toISOString()
      : parsed.occurredAt;
    const event = { ...parsed, eventId: eventIdOverride ?? parsed.eventId, occurredAt };
    if (event.outputUrl && !isAllowedProviderAssetUrl(event.outputUrl, this.options.allowedAssetHosts ?? new Set())) {
      throw new MediaStudioError("Provider output URL is not trusted", 400);
    }
    const firstReceipt = await this.repository.recordWebhook(event);
    const job = await this.repository.getByProviderJob(providerKey, event.providerJobId);
    if (!job) {
      if (!firstReceipt) return { accepted: true as const, duplicate: true as const, orphaned: true as const };
      await this.repository.parkWebhook(event);
      return { accepted: true as const, orphaned: true as const };
    }
    // A verified duplicate completion must still ensure the idempotent ingest
    // row. This deliberately closes the update/enqueue crash window: enqueue
    // failures surface as 5xx so provider retry can recover it.
    if (!firstReceipt) {
      if (event.status === "completed" && event.outputUrl) await this.ensureArtifactIngest(job, event.outputUrl);
      return { accepted: true as const, duplicate: true as const };
    }
    await this.applyProviderEvent(job, event);
    return { accepted: true as const };
  }

  async recordArtifactIngested(ownerUserId: string, jobId: string, outputAssetId: string): Promise<MediaGenerationJob> {
    const job = await this.getJob(ownerUserId, jobId);
    if (job.outputAssetId) {
      if (job.outputAssetId !== outputAssetId) throw new MediaStudioError("Render artifact already points to another canonical asset", 409);
      return job;
    }
    if (job.stage !== "artifact_ingest_queued" && job.stage !== "artifact_ingest_retrying") {
      throw new MediaStudioError("Render job is not waiting for artifact ingest", 409);
    }
    return this.repository.update({
      ...job,
      status: "completed",
      progress: 100,
      stage: "completed",
      outputAssetId,
      outputUrl: undefined,
      error: undefined,
      completedAt: new Date().toISOString(),
    });
  }

  async recordArtifactIngestFailure(ownerUserId: string, jobId: string, ingest: Pick<AssetIngestJob, "state" | "lastErrorCode">): Promise<MediaGenerationJob> {
    const job = await this.getJob(ownerUserId, jobId);
    if (job.outputAssetId || TERMINAL_STATUSES.has(job.status)) return job;
    const deadLettered = ingest.state === "dead_letter";
    return this.repository.update({
      ...job,
      status: deadLettered ? "failed" : "rendering",
      progress: deadLettered ? 100 : Math.max(job.progress, 95),
      stage: deadLettered ? "artifact_ingest_failed" : "artifact_ingest_retrying",
      error: deadLettered ? `Artifact ingest failed (${ingest.lastErrorCode ?? "ingest_failed"})` : undefined,
      completedAt: deadLettered ? new Date().toISOString() : undefined,
    });
  }

  /**
   * Commits the durable worker's provider submission to the user-facing job.
   * The worker repository has already fenced and committed the submission; this
   * method updates the domain projection and consumes any early webhook events.
   */
  async recordDurableSubmission(input: {
    ownerUserId: string;
    jobId: string;
    providerKey: string;
    providerJobId: string;
    attempt: number;
    submittedAt?: string;
  }): Promise<MediaGenerationJob> {
    if (this.executionMode !== "durable") {
      throw new MediaStudioError("Durable submission hook is unavailable in inline mode", 409);
    }
    const job = await this.getJob(input.ownerUserId, input.jobId);
    if (TERMINAL_STATUSES.has(job.status) && job.status !== "cancelled") return job;
    if (job.providerName && job.providerName !== input.providerKey) {
      throw new MediaStudioError("Render provider does not match the media job", 409);
    }
    const submittedAt = input.submittedAt ?? new Date().toISOString();
    const preserveCancellation = job.status === "cancelled";
    let updated = await this.repository.update({
      ...job,
      providerName: input.providerKey,
      providerJobId: input.providerJobId,
      status: preserveCancellation ? "cancelled" : "rendering",
      progress: preserveCancellation ? job.progress : Math.max(job.progress, 10),
      stage: preserveCancellation ? "cancelled" : "provider_rendering",
      attempts: Math.max(job.attempts, input.attempt),
      startedAt: job.startedAt ?? submittedAt,
      error: undefined,
    });
    const parked = await this.repository.takeParkedWebhooks(input.providerKey, input.providerJobId);
    for (const event of parked) updated = await this.applyProviderEvent(updated, event);
    return updated;
  }

  private requireProvider(key: string): VideoProvider {
    const provider = this.providers.get(key);
    if (!provider) throw new MediaStudioError("Unknown video provider", 404);
    return provider;
  }

  private async requireProviderReadyForGeneration(provider: VideoProvider): Promise<void> {
    const status = await provider.status();
    if (!status.configured) throw new MediaStudioError("Video provider is not configured", 503);
    if (status.mode === "live") {
      let workerReady = false;
      try {
        workerReady = this.options.assetIngestWorkerReadiness !== undefined
          && await this.options.assetIngestWorkerReadiness.isReady() === true;
      } catch {
        workerReady = false;
      }
      if (!workerReady || !this.options.assetIngestRepository) {
        throw new MediaStudioError("Owned artifact ingest worker is not ready", 503);
      }
    }
  }

  private get executionMode(): "inline" | "durable" {
    return this.options.executionMode ?? "inline";
  }

  private async processNext(): Promise<void> {
    const message = await this.queue.dequeue();
    if (!message) return;
    const job = await this.repository.get(message.ownerUserId, message.jobId);
    if (!job || job.status !== "pending" || !job.providerName) return;
    const provider = this.requireProvider(job.providerName);
    const startedAt = new Date().toISOString();
    try {
      const providerIdempotencyKey = createHash("sha256")
        .update(`${job.generationId}:attempt:${job.attempts + 1}`)
        .digest("hex");
      const submission = await provider.submit(job.request, { idempotencyKey: providerIdempotencyKey });
      if (submission.outputUrl && !isAllowedProviderAssetUrl(submission.outputUrl, this.options.allowedAssetHosts ?? new Set())) {
        throw new Error("Provider output URL is not trusted");
      }
      const completed = submission.status === "completed";
      const awaitingArtifact = completed && Boolean(submission.outputUrl);
      const missingArtifactSource = completed && !submission.outputUrl;
      let updated = await this.repository.update({
        ...job,
        status: awaitingArtifact ? "rendering" : missingArtifactSource ? "failed" : "rendering",
        progress: awaitingArtifact ? 95 : missingArtifactSource ? 100 : 10,
        stage: awaitingArtifact ? "artifact_ingest_queued" : missingArtifactSource ? "artifact_source_missing" : "provider_rendering",
        providerJobId: submission.providerJobId,
        outputUrl: submission.outputUrl,
        attempts: job.attempts + 1,
        startedAt,
        completedAt: missingArtifactSource ? new Date().toISOString() : undefined,
        error: missingArtifactSource ? "Provider completed without an artifact source" : undefined,
      });
      if (submission.outputUrl) await this.ensureArtifactIngest(updated, submission.outputUrl);
      const parked = await this.repository.takeParkedWebhooks(provider.key, submission.providerJobId);
      for (const event of parked) updated = await this.applyProviderEvent(updated, event);
    } catch (error) {
      await this.repository.update({
        ...job,
        status: "failed",
        progress: 100,
        stage: "failed",
        attempts: job.attempts + 1,
        startedAt,
        completedAt: new Date().toISOString(),
        error: error instanceof Error ? error.message : "Video provider failed",
      });
    }
  }

  private async applyProviderEvent(job: MediaGenerationJob, event: ProviderWebhookEvent): Promise<MediaGenerationJob> {
    if (TERMINAL_STATUSES.has(job.status)) return job;
    if (job.stage === "artifact_ingest_queued" || job.stage === "artifact_ingest_retrying") {
      if (event.status === "completed" && event.outputUrl) await this.ensureArtifactIngest(job, event.outputUrl);
      return job;
    }
    if (job.lastProviderEventAt && event.occurredAt <= job.lastProviderEventAt) return job;
    const needsArtifactIngest = event.status === "completed" && Boolean(event.outputUrl);
    const missingArtifactSource = event.status === "completed" && !event.outputUrl;
    const terminal = missingArtifactSource || event.status === "failed";
    const updated = await this.repository.update({
      ...job,
      status: needsArtifactIngest ? "rendering" : missingArtifactSource ? "failed" : event.status,
      progress: needsArtifactIngest ? Math.max(job.progress, 95) : terminal ? 100 : Math.max(job.progress, 50),
      stage: needsArtifactIngest ? "artifact_ingest_queued" : missingArtifactSource ? "artifact_source_missing" : event.status === "failed" ? "failed" : "provider_rendering",
      outputUrl: event.outputUrl ?? job.outputUrl,
      error: missingArtifactSource ? "Provider completed without an artifact source" : event.error,
      lastProviderEventAt: event.occurredAt,
      completedAt: terminal ? event.occurredAt : undefined,
    });
    if (event.outputUrl) await this.ensureArtifactIngest(updated, event.outputUrl);
    return updated;
  }

  private async ensureArtifactIngest(job: MediaGenerationJob, sourceUrl: string): Promise<AssetIngestJob> {
    const repository = this.options.assetIngestRepository;
    if (!repository) throw new MediaStudioError("Owned artifact ingest is unavailable", 503);
    return repository.enqueue({
      id: randomUUID(),
      tenantId: JSON.stringify([this.options.workspaceId ?? "personal", job.ownerUserId]),
      renderJobId: job.id,
      sourceUrl,
      expectedMimeType: "video/mp4",
      maxAttempts: 4,
      maxLeaseRecoveries: 3,
    }, Date.now());
  }
}
