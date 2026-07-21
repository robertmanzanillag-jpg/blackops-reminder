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

const HEYGEN_API_ORIGIN = "https://api.heygen.com";
const MAX_HEYGEN_SCRIPT_LENGTH = 4_999;
const MAX_HEYGEN_RESOURCE_ID_LENGTH = 256;

function isOpaqueProviderId(value: unknown): value is string {
  return typeof value === "string"
    && value.length >= 1
    && value.length <= MAX_HEYGEN_RESOURCE_ID_LENGTH
    && value === value.trim()
    && !/[\u0000-\u001f\u007f-\u009f]/u.test(value);
}

function assertOpaqueProviderId(value: string, label: string): string {
  if (!isOpaqueProviderId(value)) {
    throw new Error(`HeyGen ${label} is invalid`);
  }
  return value;
}

function heyGenDimension(aspectRatio: string): { width: number; height: number } {
  switch (aspectRatio) {
    case "9:16": return { width: 720, height: 1280 };
    case "16:9": return { width: 1280, height: 720 };
    case "1:1": return { width: 720, height: 720 };
    default: throw new Error("HeyGen aspect ratio is not supported");
  }
}

function safeStringMap(value: unknown): Record<string, string> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length > 500) return undefined;
  const result: Record<string, string> = Object.create(null);
  for (const [key, item] of entries) {
    if (["__proto__", "prototype", "constructor"].includes(key)) return undefined;
    if (!/^[A-Za-z0-9._:-]{1,128}$/.test(key) || !isOpaqueProviderId(item)) return undefined;
    result[key] = item;
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
    const baseUrl = new URL(options.baseUrl ?? HEYGEN_API_ORIGIN);
    if (baseUrl.origin !== HEYGEN_API_ORIGIN || !["", "/"].includes(baseUrl.pathname) || baseUrl.search || baseUrl.hash) {
      throw new Error("HeyGen base URL must use the official HTTPS API origin");
    }
    this.baseUrl = HEYGEN_API_ORIGIN;
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
    if (!request.script.trim() || request.script.length > MAX_HEYGEN_SCRIPT_LENGTH) {
      throw new Error("HeyGen script must contain fewer than 5000 characters");
    }
    const resources = await this.resolveResources(request);
    const avatarId = assertOpaqueProviderId(resources.avatarId, "avatar id");
    const voiceId = assertOpaqueProviderId(resources.voiceId, "voice id");
    const response = await this.fetchImpl(`${this.baseUrl}/v2/video/generate`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": this.apiKey, "idempotency-key": context.idempotencyKey },
      body: JSON.stringify({
        video_inputs: [{
          character: { type: "avatar", avatar_id: avatarId, avatar_style: "normal" },
          voice: { type: "text", input_text: request.script, voice_id: voiceId },
        }],
        dimension: heyGenDimension(request.aspectRatio),
      }),
      signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) throw new Error(`HeyGen request failed with status ${response.status}`);
    const payload = await response.json() as { data?: { video_id?: unknown } };
    if (typeof payload?.data?.video_id !== "string") throw new Error("HeyGen response did not include a video id");
    const providerJobId = assertOpaqueProviderId(payload.data.video_id, "video id");
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
