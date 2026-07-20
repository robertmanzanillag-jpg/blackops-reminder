import { createHash } from "node:crypto";
import type { ProviderWebhookEvent } from "../domain";
import type { VideoProvider } from "../ports";

function text(value: unknown): string | undefined { return typeof value === "string" && value.trim() ? value.trim() : undefined; }
function object(value: unknown): Record<string, unknown> { return value && typeof value === "object" ? value as Record<string, unknown> : {}; }

export class FakeVideoProvider implements VideoProvider {
  readonly key = "fake";
  constructor(private readonly options: { autoComplete?: boolean } = { autoComplete: true }) {}
  async status() { return { key: this.key, configured: true, healthy: true, mode: "fake" as const }; }
  async submit(request: Parameters<VideoProvider["submit"]>[0], context: Parameters<VideoProvider["submit"]>[1]) {
    const digest = createHash("sha256").update(`${context.idempotencyKey}:${JSON.stringify(request)}`).digest("hex").slice(0, 20);
    const providerJobId = `fake_${digest}`;
    return this.options.autoComplete === false
      ? { providerJobId, status: "rendering" as const }
      : { providerJobId, status: "completed" as const };
  }
  async cancel(): Promise<void> {}
  parseWebhook(payload: unknown): ProviderWebhookEvent {
    const input = object(payload);
    if (!Object.keys(input).length) throw new Error("Invalid webhook payload");
    const data = Object.keys(object(input.event_data)).length ? object(input.event_data) : Object.keys(object(input.data)).length ? object(input.data) : input;
    const eventId = text(input.event_id) ?? text(input.id);
    const providerJobId = text(data.video_id) ?? text(data.provider_job_id) ?? text(input.provider_job_id);
    const rawStatus = (text(data.status) ?? text(input.status) ?? text(input.event_type) ?? text(input.event))?.toLowerCase();
    if (!eventId || !providerJobId || !rawStatus) throw new Error("Webhook is missing required identifiers");
    const status = rawStatus.includes("complete") || rawStatus.includes("success") ? "completed" : rawStatus.includes("fail") || rawStatus.includes("error") ? "failed" : "rendering";
    const occurredAt = text(input.occurred_at) ?? text(input.created_at) ?? new Date().toISOString();
    if (Number.isNaN(Date.parse(occurredAt))) throw new Error("Webhook timestamp is invalid");
    return { eventId, providerKey: this.key, providerJobId, status, occurredAt: new Date(occurredAt).toISOString(),
      outputUrl: text(data.video_url) ?? text(data.url), error: text(data.error) ?? text(data.message) ?? text(input.error) };
  }
}
