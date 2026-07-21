import { randomUUID } from "node:crypto";
import type { GenerationRequest, MediaGenerationJob, ProviderWebhookEvent } from "./domain";
import type { MediaJobQueue, MediaJobRepository, MediaQueueMessage } from "./ports";

function copyJob(job: MediaGenerationJob): MediaGenerationJob {
  return {
    ...job,
    request: {
      ...job.request,
      ...(job.request.governance ? { governance: { ...job.request.governance } } : {}),
    },
  };
}
export class InMemoryMediaJobRepository implements MediaJobRepository {
  private readonly jobs = new Map<string, MediaGenerationJob>();
  private readonly providerIndex = new Map<string, string>();
  private readonly webhookIds = new Set<string>();
  private readonly parked = new Map<string, ProviderWebhookEvent[]>();

  async create(ownerUserId: string, request: GenerationRequest): Promise<MediaGenerationJob> {
    const now = new Date().toISOString();
    const job: MediaGenerationJob = {
      id: randomUUID(), generationId: randomUUID(), ownerUserId, request: { ...request },
      title: request.script.trim().slice(0, 80), status: "pending", progress: 0, stage: "queued",
      attempts: 0, retryCount: 0, maxAttempts: 3, createdAt: now, updatedAt: now,
    };
    this.jobs.set(job.id, job);
    return copyJob(job);
  }

  async list(ownerUserId: string): Promise<MediaGenerationJob[]> {
    return [...this.jobs.values()].filter((job) => job.ownerUserId === ownerUserId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map(copyJob);
  }

  async get(ownerUserId: string, jobId: string): Promise<MediaGenerationJob | undefined> {
    const job = this.jobs.get(jobId);
    return job?.ownerUserId === ownerUserId ? copyJob(job) : undefined;
  }

  async getByIdempotencyKey(ownerUserId: string, idempotencyKey: string): Promise<MediaGenerationJob | undefined> {
    const job = [...this.jobs.values()].find((candidate) => candidate.ownerUserId === ownerUserId && candidate.request.idempotencyKey === idempotencyKey);
    return job ? copyJob(job) : undefined;
  }

  async getByProviderJob(providerKey: string, providerJobId: string): Promise<MediaGenerationJob | undefined> {
    const id = this.providerIndex.get(`${providerKey}:${providerJobId}`);
    const job = id ? this.jobs.get(id) : undefined;
    return job ? copyJob(job) : undefined;
  }

  async update(job: MediaGenerationJob): Promise<MediaGenerationJob> {
    const current = this.jobs.get(job.id);
    if (!current || current.ownerUserId !== job.ownerUserId) throw new Error("Media job not found");
    const saved = copyJob({ ...job, updatedAt: new Date().toISOString() });
    this.jobs.set(saved.id, saved);
    if (saved.providerJobId && saved.providerName) this.providerIndex.set(`${saved.providerName}:${saved.providerJobId}`, saved.id);
    return copyJob(saved);
  }

  async recordWebhook(event: ProviderWebhookEvent): Promise<boolean> {
    const key = `${event.providerKey}:${event.eventId}`;
    if (this.webhookIds.has(key)) return false;
    this.webhookIds.add(key);
    return true;
  }

  async parkWebhook(event: ProviderWebhookEvent): Promise<void> {
    const key = `${event.providerKey}:${event.providerJobId}`;
    this.parked.set(key, [...(this.parked.get(key) ?? []), { ...event }]);
  }

  async takeParkedWebhooks(providerKey: string, providerJobId: string): Promise<ProviderWebhookEvent[]> {
    const key = `${providerKey}:${providerJobId}`;
    const events = this.parked.get(key) ?? [];
    this.parked.delete(key);
    return events.sort((a, b) => a.occurredAt.localeCompare(b.occurredAt)).map((event) => ({ ...event }));
  }
}

export class InMemoryMediaJobQueue implements MediaJobQueue {
  private readonly messages: MediaQueueMessage[] = [];
  async enqueue(message: MediaQueueMessage): Promise<void> { this.messages.push({ ...message }); }
  async dequeue(): Promise<MediaQueueMessage | undefined> { const message = this.messages.shift(); return message ? { ...message } : undefined; }
  async size(): Promise<number> { return this.messages.length; }
}
