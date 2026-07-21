import type { ProviderWebhookEvent } from "../domain";
import type { VideoProvider } from "../ports";
import { FakeVideoProvider } from "./fake-video-provider";

export interface HeyGenProviderOptions {
  apiKey?: string;
  providerAccountId?: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  resolveResources?: (request: Parameters<VideoProvider["submit"]>[0]) => Promise<{ avatarId: string; voiceId: string }>;
}

export interface HeyGenResourceMap {
  influencers: Record<string, string>;
  voices: Record<string, string>;
}

function safeStringMap(value: unknown): Record<string, string> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length > 500) return undefined;
  const result: Record<string, string> = Object.create(null);
  for (const [key, item] of entries) {
    if (["__proto__", "prototype", "constructor"].includes(key)) return undefined;
    if (!/^[A-Za-z0-9._:-]{1,128}$/.test(key) || typeof item !== "string" || !item.trim() || item.length > 256) return undefined;
    result[key] = item.trim();
  }
  return result;
}

export function parseHeyGenResourceMap(value: string | undefined): HeyGenResourceMap | undefined {
  if (!value || value.length > 100_000) return undefined;
  try {
    const parsed = JSON.parse(value) as Record<string, unknown>;
    const influencers = safeStringMap(parsed.influencers);
    const voices = safeStringMap(parsed.voices);
    return influencers && voices ? { influencers, voices } : undefined;
  } catch {
    return undefined;
  }
}

export function createHeyGenResourceResolver(map: HeyGenResourceMap | undefined): HeyGenProviderOptions["resolveResources"] | undefined {
  if (!map) return undefined;
  return async (request) => {
    const avatarId = map.influencers[request.influencerId];
    const voiceId = map.voices[request.voiceId];
    if (!avatarId || !voiceId) throw new Error("Canonical media resource is not configured");
    return { avatarId, voiceId };
  };
}

export class HeyGenVideoProvider implements VideoProvider {
  readonly key = "heygen";
  readonly providerAccountId?: string;
  private readonly apiKey?: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly resolveResources?: HeyGenProviderOptions["resolveResources"];

  constructor(options: HeyGenProviderOptions = {}) {
    this.apiKey = options.apiKey?.trim();
    this.providerAccountId = options.providerAccountId?.trim() || undefined;
    this.baseUrl = (options.baseUrl ?? "https://api.heygen.com").replace(/\/$/, "");
    if (new URL(this.baseUrl).protocol !== "https:") throw new Error("HeyGen base URL must use HTTPS");
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.resolveResources = options.resolveResources;
  }

  async status() {
    const configured = Boolean(this.apiKey && this.resolveResources && this.providerAccountId);
    return { key: this.key, configured, healthy: configured, mode: "live" as const };
  }

  async submit(request: Parameters<VideoProvider["submit"]>[0], context: Parameters<VideoProvider["submit"]>[1]) {
    if (!this.apiKey || !this.resolveResources || !this.providerAccountId) throw new Error("HeyGen provider is not configured");
    if (context.providerAccountId !== this.providerAccountId) throw new Error("HeyGen provider account scope mismatch");
    const resources = await this.resolveResources(request);
    const response = await this.fetchImpl(`${this.baseUrl}/v3/videos`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": this.apiKey, "idempotency-key": context.idempotencyKey },
      body: JSON.stringify({
        type: "avatar",
        avatar_id: resources.avatarId,
        script: request.script,
        voice_id: resources.voiceId,
        aspect_ratio: request.aspectRatio,
        resolution: "1080p",
      }),
      signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) throw new Error(`HeyGen request failed with status ${response.status}`);
    const payload = await response.json() as { data?: { video_id?: string; id?: string }; id?: string };
    const providerJobId = payload.data?.video_id ?? payload.data?.id ?? payload.id;
    if (!providerJobId) throw new Error("HeyGen response did not include a video id");
    return { providerJobId };
  }

  async cancel(): Promise<void> {
    // Cancellation stays internal: HeyGen DELETE permanently deletes an asset.
  }

  parseWebhook(payload: unknown, context: Parameters<VideoProvider["parseWebhook"]>[1]): ProviderWebhookEvent {
    return {
      ...new FakeVideoProvider({ providerAccountId: context.providerAccountId }).parseWebhook(payload, context),
      providerKey: this.key,
    };
  }
}
