import type { GenerationRequest } from "../domain";
import type { VideoProvider } from "../ports";
import type { RenderSubmissionProvider } from "./contracts";
import { PermanentRenderFailure } from "./render-worker";

/**
 * Bridges the provider-neutral Media Studio provider port into the durable
 * render-worker contract. The worker owns the stable per-attempt idempotency
 * key, so crash recovery can safely repeat a submit without creating a second
 * provider render.
 */
export class VideoProviderRenderAdapter implements RenderSubmissionProvider<GenerationRequest> {
  readonly key: string;

  constructor(private readonly provider: VideoProvider) {
    this.key = provider.key;
  }

  async submit(
    payload: GenerationRequest,
    context: { workId: string; tenantId: string; attempt: number; idempotencyKey: string },
  ): Promise<{ providerSubmissionId: string; providerAccountId: string }> {
    const status = await this.provider.status();
    if (!status.configured) throw new PermanentRenderFailure(`Video provider ${this.key} is not configured`);
    const providerAccountId = this.provider.providerAccountId?.trim();
    if (!providerAccountId) throw new PermanentRenderFailure(`Video provider ${this.key} has no account identity`);
    const submission = await this.provider.submit(payload, { idempotencyKey: context.idempotencyKey, providerAccountId });
    if (!submission.providerJobId) throw new Error(`Video provider ${this.key} returned no job id`);
    return { providerSubmissionId: submission.providerJobId, providerAccountId };
  }
}

export function adaptVideoProviders(
  providers: readonly VideoProvider[],
): VideoProviderRenderAdapter[] {
  return providers.map((provider) => new VideoProviderRenderAdapter(provider));
}
