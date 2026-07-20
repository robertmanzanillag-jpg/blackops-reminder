import type { AiMediaRenderJobRow } from "../../../shared/models/ai-media-studio-db";
import type { GenerationRequest, MediaGenerationJob } from "../domain";

function optionalIso(value: Date | null): string | undefined {
  return value?.toISOString();
}

/** Pure DB-row mapping, kept independent from a live driver for contract tests. */
export function mapRenderJobRow(row: AiMediaRenderJobRow): MediaGenerationJob {
  const request = row.request as unknown as GenerationRequest;
  const result = (row.result ?? {}) as Record<string, unknown>;

  return {
    id: row.id,
    generationId: row.generationId,
    ownerUserId: row.ownerUserId,
    request: { ...request },
    title: row.title,
    status: row.status as MediaGenerationJob["status"],
    progress: row.progress,
    stage: row.stage,
    providerName: row.providerKey ?? undefined,
    providerJobId: row.providerJobId ?? undefined,
    outputUrl: row.outputUrl ?? undefined,
    error: row.errorMessage ?? undefined,
    attempts: row.attempts,
    retryCount: row.retryCount,
    maxAttempts: row.maxAttempts,
    estimatedCostUsd: typeof result.estimatedCostUsd === "number" ? result.estimatedCostUsd : undefined,
    actualCostUsd: typeof result.actualCostUsd === "number" ? result.actualCostUsd : undefined,
    influencerName: typeof result.influencerName === "string" ? result.influencerName : undefined,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    startedAt: optionalIso(row.startedAt),
    completedAt: optionalIso(row.completedAt),
    estimatedCompletionAt:
      typeof result.estimatedCompletionAt === "string" ? result.estimatedCompletionAt : undefined,
    lastProviderEventAt:
      typeof result.lastProviderEventAt === "string" ? result.lastProviderEventAt : undefined,
  };
}
