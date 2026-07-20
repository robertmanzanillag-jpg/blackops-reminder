import { createHash } from "node:crypto";
import type { PublishingPlatform, PublishingPreview } from "./domain";
import type { PublishProviderContext, PublishingProvider } from "./ports";

/** Deterministic, no-network provider for tests and local development. */
export class FakePublishingProvider implements PublishingProvider {
  readonly submissions: Array<{ preview: PublishingPreview; context: PublishProviderContext }> = [];
  constructor(readonly platform: PublishingPlatform, private readonly failure?: Error) {}
  async submit(preview: PublishingPreview, context: PublishProviderContext): Promise<{ providerSubmissionId: string }> {
    if (this.failure) throw this.failure;
    this.submissions.push(structuredClone({ preview, context }));
    return { providerSubmissionId: `fake_${createHash("sha256").update(context.idempotencyKey).digest("hex").slice(0, 24)}` };
  }
}
