export type MediaJobStatus = "pending" | "rendering" | "completed" | "failed" | "cancelled";

export interface GenerationRequest {
  influencerId: string;
  script: string;
  voiceId: string;
  language: string;
  aspectRatio: "9:16";
  idempotencyKey: string;
}

export interface MediaGenerationJob {
  id: string;
  generationId: string;
  ownerUserId: string;
  request: GenerationRequest;
  title: string;
  status: MediaJobStatus;
  progress: number;
  stage?: string;
  providerName?: string;
  influencerName?: string;
  providerJobId?: string;
  outputUrl?: string;
  error?: string;
  attempts: number;
  retryCount: number;
  estimatedCostUsd?: number;
  actualCostUsd?: number;
  maxAttempts: number;
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  completedAt?: string;
  estimatedCompletionAt?: string;
  lastProviderEventAt?: string;
}

export interface ProviderWebhookEvent {
  eventId: string;
  providerKey: string;
  providerJobId: string;
  status: Exclude<MediaJobStatus, "pending" | "cancelled">;
  occurredAt: string;
  outputUrl?: string;
  error?: string;
}

export interface ProviderStatus {
  key: string;
  configured: boolean;
  healthy: boolean;
  mode: "fake" | "live";
}

export const TERMINAL_STATUSES = new Set<MediaJobStatus>(["completed", "failed", "cancelled"]);
