import type { GenerationRequest } from "../domain";
import {
  DrizzleRenderWorkRepository,
  type AiMediaRenderWorkDatabase,
  type DrizzleRenderWorkRepositoryOptions,
} from "../persistence/drizzle-render-work-repository";
import type { VideoProvider } from "../ports";
import type { AiMediaStudioService } from "../service";
import type { RenderClock, RenderQuotaPolicy, RenderRandom, RenderWorkerHooks } from "./contracts";
import { PermanentRenderFailure, RenderWorker, type RenderRetryPolicy, type RenderSubmissionGate } from "./render-worker";
import { adaptVideoProviders } from "./video-provider-adapter";

export interface CreateVideoRenderWorkerOptions extends DrizzleRenderWorkRepositoryOptions {
  db: AiMediaRenderWorkDatabase;
  mediaService: AiMediaStudioService;
  providers: readonly VideoProvider[];
  workerId: string;
  quotas?: RenderQuotaPolicy;
  leaseDurationMs?: number;
  retry?: RenderRetryPolicy;
  /** Required server-side governance check, rerun immediately before provider submit. */
  submissionGate: RenderSubmissionGate<GenerationRequest>;
  clock?: RenderClock;
  random?: RenderRandom;
  hooks?: RenderWorkerHooks<GenerationRequest>;
}

export type CurrentRenderGovernanceResolver = (
  ownerUserId: string,
  request: GenerationRequest,
) => Promise<NonNullable<GenerationRequest["governance"]>>;

/** Builds the mandatory worker gate from a trusted current-profile resolver. */
export function createGovernedVideoRenderSubmissionGate(
  resolveCurrent: CurrentRenderGovernanceResolver,
): RenderSubmissionGate<GenerationRequest> {
  return {
    async assertCanSubmit(item) {
      const bound = item.payload.governance;
      if (!bound) throw new PermanentRenderFailure("Render job has no bound governance evidence");
      const current = await resolveCurrent(item.tenantId, item.payload);
      if (current.profileId !== bound.profileId || current.evidenceDigest !== bound.evidenceDigest) {
        throw new PermanentRenderFailure("Render governance evidence is stale");
      }
    },
  };
}

const DEFAULT_QUOTAS: RenderQuotaPolicy = {
  maxConcurrentTotal: 10,
  maxConcurrentPerProvider: 10,
  maxConcurrentPerTenant: 3,
};

const DEFAULT_RETRY: RenderRetryPolicy = {
  baseDelayMs: 5_000,
  maxDelayMs: 5 * 60_000,
  jitterRatio: 0.2,
};

/**
 * Creates one durable worker without starting timers, network listeners, or a
 * processing loop. The composition root/operator decides when to call runNext.
 */
export function createVideoRenderWorker(
  options: CreateVideoRenderWorkerOptions,
): RenderWorker<GenerationRequest> {
  const repository = new DrizzleRenderWorkRepository<GenerationRequest>(options.db, {
    workspaceId: options.workspaceId,
    tenantId: options.tenantId,
    providerKeys: options.providerKeys,
  });
  const projectionHooks = createVideoRenderWorkerHooks(options.mediaService);
  return new RenderWorker<GenerationRequest>({
    workerId: options.workerId,
    repository,
    providers: adaptVideoProviders(options.providers),
    quotas: options.quotas ?? DEFAULT_QUOTAS,
    leaseDurationMs: options.leaseDurationMs ?? 60_000,
    retry: options.retry ?? DEFAULT_RETRY,
    submissionGate: options.submissionGate,
    clock: options.clock,
    random: options.random,
    hooks: mergeHooks(projectionHooks, options.hooks),
  });
}

export function createVideoRenderWorkerHooks(
  mediaService: AiMediaStudioService,
): RenderWorkerHooks<GenerationRequest> {
  const projectSubmission = async (item: Parameters<NonNullable<RenderWorkerHooks<GenerationRequest>["onSubmitted"]>>[0]) => {
    if (!item.providerSubmissionId) throw new Error("Submitted render work has no provider job id");
    await mediaService.recordDurableSubmission({
      ownerUserId: item.tenantId,
      jobId: item.id,
      providerKey: item.providerKey,
      providerJobId: item.providerSubmissionId,
      attempt: item.attempt,
      submittedAt: new Date(item.updatedAtMs).toISOString(),
    });
  };
  return {
    onSubmitted: projectSubmission,
    async onLeaseLost(item) {
      // If provider submit succeeded before fencing was lost, retain the
      // external identifier for webhook reconciliation and cost tracking.
      if (item.providerSubmissionId) await projectSubmission(item);
    },
  };
}

function mergeHooks<TPayload>(
  first: RenderWorkerHooks<TPayload>,
  second?: RenderWorkerHooks<TPayload>,
): RenderWorkerHooks<TPayload> {
  const call = <T extends keyof RenderWorkerHooks<TPayload>>(name: T) => async (value: Parameters<NonNullable<RenderWorkerHooks<TPayload>[T]>>[0]) => {
    const firstHandler = first[name] as ((input: typeof value) => void | Promise<void>) | undefined;
    const secondHandler = second?.[name] as ((input: typeof value) => void | Promise<void>) | undefined;
    await firstHandler?.(value);
    await secondHandler?.(value);
  };
  return {
    onLeaseRecovered: call("onLeaseRecovered"),
    onSubmitted: call("onSubmitted"),
    onRetryScheduled: call("onRetryScheduled"),
    onDeadLetter: call("onDeadLetter"),
    onLeaseLost: call("onLeaseLost"),
  };
}
