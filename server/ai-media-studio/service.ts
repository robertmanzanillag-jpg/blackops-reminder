import { createHash } from "node:crypto";
import type { GenerationRequest, MediaGenerationJob, ProviderStatus, ProviderWebhookEvent } from "./domain";
import { MediaJobStateConflictError, TERMINAL_STATUSES } from "./domain";
import type { MediaJobQueue, MediaJobRepository, VideoProvider } from "./ports";

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
    if (!(await provider.status()).configured) throw new MediaStudioError("Video provider is not configured", 503);
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
    const pending = await this.repository.update({
      ...job,
      status: "pending",
      progress: 0,
      stage: "queued",
      providerJobId: undefined,
      outputUrl: undefined,
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
    if (!(await this.repository.recordWebhook(event))) return { accepted: true as const, duplicate: true as const };
    const job = await this.repository.getByProviderJob(providerKey, event.providerJobId);
    if (!job) {
      await this.repository.parkWebhook(event);
      return { accepted: true as const, orphaned: true as const };
    }
    await this.applyProviderEvent(job, event);
    return { accepted: true as const };
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
      let updated = await this.repository.update({
        ...job,
        status: completed ? "completed" : "rendering",
        progress: completed ? 100 : 10,
        stage: completed ? "completed" : "provider_rendering",
        providerJobId: submission.providerJobId,
        outputUrl: submission.outputUrl,
        attempts: job.attempts + 1,
        startedAt,
        completedAt: completed ? new Date().toISOString() : undefined,
      });
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
    if (job.lastProviderEventAt && event.occurredAt <= job.lastProviderEventAt) return job;
    const terminal = event.status === "completed" || event.status === "failed";
    return this.repository.update({
      ...job,
      status: event.status,
      progress: terminal ? 100 : Math.max(job.progress, 50),
      stage: event.status === "completed" ? "completed" : event.status === "failed" ? "failed" : "provider_rendering",
      outputUrl: event.outputUrl ?? job.outputUrl,
      error: event.error,
      lastProviderEventAt: event.occurredAt,
      completedAt: terminal ? event.occurredAt : undefined,
    });
  }
}
