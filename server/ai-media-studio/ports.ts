import type { GenerationRequest, MediaGenerationJob, ProviderStatus, ProviderWebhookEvent } from "./domain";

export interface VideoSubmission {
  providerJobId: string;
  status?: "rendering" | "completed";
  outputUrl?: string;
}

export interface ProviderSubmitContext {
  idempotencyKey: string;
}

export interface VideoProvider {
  readonly key: string;
  status(): Promise<ProviderStatus>;
  submit(request: GenerationRequest, context: ProviderSubmitContext): Promise<VideoSubmission>;
  cancel(providerJobId: string): Promise<void>;
  parseWebhook(payload: unknown): ProviderWebhookEvent;
}

export interface MediaJobRepository {
  create(ownerUserId: string, request: GenerationRequest): Promise<MediaGenerationJob>;
  list(ownerUserId: string): Promise<MediaGenerationJob[]>;
  get(ownerUserId: string, jobId: string): Promise<MediaGenerationJob | undefined>;
  getByIdempotencyKey(ownerUserId: string, idempotencyKey: string): Promise<MediaGenerationJob | undefined>;
  getByProviderJob(providerKey: string, providerJobId: string): Promise<MediaGenerationJob | undefined>;
  update(job: MediaGenerationJob): Promise<MediaGenerationJob>;
  recordWebhook(event: ProviderWebhookEvent): Promise<boolean>;
  parkWebhook(event: ProviderWebhookEvent): Promise<void>;
  takeParkedWebhooks(providerKey: string, providerJobId: string): Promise<ProviderWebhookEvent[]>;
}

export interface MediaQueueMessage {
  type: "render";
  ownerUserId: string;
  jobId: string;
}

export interface MediaJobQueue {
  enqueue(message: MediaQueueMessage): Promise<void>;
  dequeue(): Promise<MediaQueueMessage | undefined>;
  size(): Promise<number>;
}
