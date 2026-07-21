import { createHash } from "node:crypto";
import type { Sha256Digest } from "../planning/contracts";
import type {
  AdmittedReconciliationOutcome,
  AdmittedRenderProvider,
  AdmittedSubmitOutcome,
  AdmittedTerminalObservation,
  AdmittedTerminalProvider,
  ExactAdmittedProviderCapability,
} from "../workers/admitted-render-contracts";

const HEYGEN_API_ORIGIN = "https://api.heygen.com";
const HEYGEN_PROVIDER_KEY = "heygen";
const MAX_BODY_BYTES = 256 * 1024;
const MAX_SCRIPT_LENGTH = 4_999;
const MAX_PROVIDER_ID_LENGTH = 256;
const IDEMPOTENCY_KEY = /^[A-Za-z0-9_:.-]{1,255}$/u;
const ASPECT_RATIOS = new Set(["16:9", "9:16", "4:5", "5:4", "1:1", "auto"]);
const PROCESSING_STATES = new Set(["pending", "processing", "waiting", "queued"]);

type HeyGenFetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
type ExactContext = ExactAdmittedProviderCapability;

export interface HeyGenV3AdmittedProviderOptions {
  apiKey: string;
  providerAccountId: string;
  providerCredentialVersion: number;
  fetchImpl?: HeyGenFetch;
  timeoutMs?: number;
  now?: () => Date;
}

/**
 * Unmounted HeyGen V3 adapter for already-authorized render work.
 *
 * HeyGen has no documented lookup by Idempotency-Key. Consequently
 * reconciliation never claims negative submission finality: uncertainty stays
 * quarantined until an independently-bound provider job id is available.
 */
export class HeyGenV3AdmittedRenderProvider implements AdmittedRenderProvider, AdmittedTerminalProvider {
  private readonly apiKey: string;
  private readonly providerAccountId: string;
  private readonly providerCredentialVersion: number;
  private readonly fetchImpl: HeyGenFetch;
  private readonly timeoutMs: number;
  private readonly now: () => Date;
  private readonly credentialMaterialDigest: Sha256Digest;

  constructor(options: HeyGenV3AdmittedProviderOptions) {
    this.apiKey = exactSecret(options.apiKey);
    this.providerAccountId = opaqueId(options.providerAccountId, "provider account id");
    if (!Number.isSafeInteger(options.providerCredentialVersion) || options.providerCredentialVersion < 1) {
      throw new Error("HeyGen provider credential version must be a positive integer");
    }
    this.providerCredentialVersion = options.providerCredentialVersion;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 20_000;
    if (!Number.isSafeInteger(this.timeoutMs) || this.timeoutMs < 1 || this.timeoutMs > 120_000) {
      throw new Error("HeyGen timeout must be between 1 and 120000 milliseconds");
    }
    this.now = options.now ?? (() => new Date());
    this.credentialMaterialDigest = sha256(this.apiKey);
  }

  async submit(
    request: Readonly<Record<string, unknown>>,
    context: ExactContext & {
      providerIdempotencyKey: string;
      avatarExternalResourceId: string;
      voiceExternalResourceId: string;
    },
  ): Promise<AdmittedSubmitOutcome> {
    this.assertBoundCapability(context);
    if (!IDEMPOTENCY_KEY.test(context.providerIdempotencyKey)) {
      throw new Error("HeyGen idempotency key is invalid");
    }
    const script = requiredScript(request.script);
    const aspectRatio = requiredAspectRatio(request.aspectRatio);
    const avatarId = opaqueId(context.avatarExternalResourceId, "avatar id");
    const voiceId = opaqueId(context.voiceExternalResourceId, "voice id");
    const body = JSON.stringify({
      type: "avatar",
      avatar_id: avatarId,
      aspect_ratio: aspectRatio,
      output_format: "mp4",
      script,
      voice_id: voiceId,
    });
    const requestDigest = sha256(body);
    let response: Response;
    try {
      response = await this.fetchImpl(`${HEYGEN_API_ORIGIN}/v3/videos`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": context.providerIdempotencyKey,
          "x-api-key": this.apiKey,
        },
        body,
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) {
      return this.ambiguousSubmission(context, requestDigest, transportClass(error));
    }
    const providerRequestId = safeRequestId(response.headers);
    const responseBody = await safeResponseBody(response);
    if (responseBody === undefined) {
      return this.ambiguousSubmission(context, requestDigest, "invalid_or_oversize_body", response.status, providerRequestId);
    }
    const responseDigest = sha256(responseBody);
    if (!response.ok) {
      return this.ambiguousSubmission(context, requestDigest, `http_${response.status}`, response.status, providerRequestId, responseDigest);
    }
    const providerJobId = parseCreateVideoResponse(responseBody);
    if (!providerJobId) {
      return this.ambiguousSubmission(context, requestDigest, "invalid_success_codec", response.status, providerRequestId, responseDigest);
    }
    const observedAt = exactObservedAt(this.now());
    return {
      kind: "confirmed",
      providerJobId,
      ...(providerRequestId ? { providerRequestId } : {}),
      evidenceDigest: this.evidenceDigest("submission_confirmed", context, {
        endpoint: "/v3/videos",
        method: "POST",
        providerIdempotencyKey: context.providerIdempotencyKey,
        providerJobId,
        providerRequestId: providerRequestId ?? null,
        requestDigest,
        responseDigest,
        responseStatus: response.status,
        observedAt,
      }),
    };
  }

  async reconcile(context: ExactContext & { providerIdempotencyKey: string }): Promise<AdmittedReconciliationOutcome> {
    this.assertBoundCapability(context);
    if (!IDEMPOTENCY_KEY.test(context.providerIdempotencyKey)) throw new Error("HeyGen idempotency key is invalid");
    // The V3 API documents replay-on-resubmit, but not a read-only lookup for an
    // idempotency key. Resubmitting here could spend twice after the replay window.
    return { kind: "unknown" };
  }

  async observeTerminal(
    context: ExactContext & { providerJobId: string },
  ): Promise<AdmittedTerminalObservation> {
    this.assertBoundCapability(context);
    const providerJobId = opaqueId(context.providerJobId, "video id");
    const observedAt = exactObservedAt(this.now());
    let response: Response;
    try {
      response = await this.fetchImpl(`${HEYGEN_API_ORIGIN}/v3/videos/${encodeURIComponent(providerJobId)}`, {
        method: "GET",
        headers: { "x-api-key": this.apiKey },
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) {
      return this.unknownTerminal(context, providerJobId, observedAt, transportClass(error));
    }
    const providerRequestId = safeRequestId(response.headers);
    const responseBody = await safeResponseBody(response);
    if (responseBody === undefined) {
      return this.unknownTerminal(context, providerJobId, observedAt, "invalid_or_oversize_body", response.status, providerRequestId);
    }
    const responseDigest = sha256(responseBody);
    if (!response.ok) {
      return this.unknownTerminal(context, providerJobId, observedAt, `http_${response.status}`, response.status, providerRequestId, responseDigest);
    }
    const detail = parseVideoDetail(responseBody, providerJobId);
    if (!detail) {
      return this.unknownTerminal(context, providerJobId, observedAt, "invalid_success_codec", response.status, providerRequestId, responseDigest);
    }
    const commonEvidence = {
      endpoint: `/v3/videos/${providerJobId}`,
      method: "GET",
      providerJobId,
      providerRequestId: providerRequestId ?? null,
      responseDigest,
      responseStatus: response.status,
      providerStatus: detail.status,
    };
    if (PROCESSING_STATES.has(detail.status)) {
      return {
        kind: "processing",
        observedAt,
        evidenceDigest: this.evidenceDigest("terminal_processing", context, commonEvidence),
      };
    }
    if (detail.status === "completed") {
      const sourceUrl = exactMp4Url(detail.videoUrl);
      if (!sourceUrl) {
        return this.unknownTerminal(context, providerJobId, observedAt, "completed_without_valid_mp4", response.status, providerRequestId, responseDigest);
      }
      return {
        kind: "completed",
        observedAt,
        remoteArtifactRef: providerJobId,
        sourceUrl,
        sourceUrlPolicy: "ephemeral_refresh_via_provider_get",
        mediaType: "video/mp4",
        ...(detail.durationSeconds === undefined ? {} : { durationSeconds: detail.durationSeconds }),
        evidenceDigest: this.evidenceDigest("terminal_completed", context, {
          ...commonEvidence,
          durationSeconds: detail.durationSeconds ?? null,
          sourceUrlDigest: sha256(sourceUrl),
        }),
      };
    }
    if (detail.status === "failed") {
      return {
        kind: "failed",
        observedAt,
        ...(detail.failureCode ? { failureCode: detail.failureCode } : {}),
        ...(detail.failureMessageDigest ? { failureMessageDigest: detail.failureMessageDigest } : {}),
        evidenceDigest: this.evidenceDigest("terminal_failed", context, {
          ...commonEvidence,
          failureCode: detail.failureCode ?? null,
          failureMessageDigest: detail.failureMessageDigest ?? null,
        }),
      };
    }
    return this.unknownTerminal(context, providerJobId, observedAt, "unrecognized_provider_status", response.status, providerRequestId, responseDigest);
  }

  private ambiguousSubmission(
    context: ExactContext & { providerIdempotencyKey: string },
    requestDigest: Sha256Digest,
    classification: string,
    responseStatus?: number,
    providerRequestId?: string,
    responseDigest?: Sha256Digest,
  ): AdmittedSubmitOutcome {
    return {
      kind: "ambiguous",
      ...(providerRequestId ? { providerRequestId } : {}),
      evidenceDigest: this.evidenceDigest("submission_ambiguous", context, {
        classification,
        endpoint: "/v3/videos",
        method: "POST",
        providerIdempotencyKey: context.providerIdempotencyKey,
        providerRequestId: providerRequestId ?? null,
        requestDigest,
        responseDigest: responseDigest ?? null,
        responseStatus: responseStatus ?? null,
        observedAt: exactObservedAt(this.now()),
      }),
    };
  }

  private unknownTerminal(
    context: ExactContext,
    providerJobId: string,
    observedAt: string,
    classification: string,
    responseStatus?: number,
    providerRequestId?: string,
    responseDigest?: Sha256Digest,
  ): AdmittedTerminalObservation {
    return {
      kind: "unknown",
      observedAt,
      evidenceDigest: this.evidenceDigest("terminal_unknown", context, {
        classification,
        endpoint: `/v3/videos/${providerJobId}`,
        method: "GET",
        providerJobId,
        providerRequestId: providerRequestId ?? null,
        responseDigest: responseDigest ?? null,
        responseStatus: responseStatus ?? null,
        observedAt,
      }),
    };
  }

  private assertBoundCapability(context: ExactContext): void {
    if (context.providerKey !== HEYGEN_PROVIDER_KEY
      || context.providerAccountId !== this.providerAccountId
      || context.providerCredentialVersion !== this.providerCredentialVersion
      || !validScopePart(context.scope.ownerUserId)
      || !validScopePart(context.scope.workspaceId)
      || !/^sha256:[0-9a-f]{64}$/u.test(context.authorizationDigest)) {
      throw new Error("HeyGen provider capability does not match the configured account and credential");
    }
  }

  private evidenceDigest(domain: string, context: ExactContext, detail: Record<string, unknown>): Sha256Digest {
    return sha256(JSON.stringify({
      version: 1,
      domain,
      apiOrigin: HEYGEN_API_ORIGIN,
      apiVersion: "v3",
      providerKey: HEYGEN_PROVIDER_KEY,
      providerAccountId: this.providerAccountId,
      providerCredentialVersion: this.providerCredentialVersion,
      credentialMaterialDigest: this.credentialMaterialDigest,
      authorizationDigest: context.authorizationDigest,
      scope: context.scope,
      ...detail,
    }));
  }
}

function parseCreateVideoResponse(body: string): string | undefined {
  const root = jsonObject(body);
  const data = root && objectValue(root.data);
  try {
    return data ? opaqueId(data.video_id, "video id") : undefined;
  } catch {
    return undefined;
  }
}

function parseVideoDetail(body: string, expectedVideoId: string): {
  status: string;
  videoUrl?: string;
  durationSeconds?: number;
  failureCode?: string;
  failureMessageDigest?: Sha256Digest;
} | undefined {
  const root = jsonObject(body);
  const data = root && objectValue(root.data);
  if (!data) return undefined;
  try {
    if (opaqueId(data.id, "video id") !== expectedVideoId) return undefined;
  } catch {
    return undefined;
  }
  if (typeof data.status !== "string" || data.status !== data.status.trim() || data.status.length > 64) return undefined;
  const status = data.status.toLowerCase();
  const durationSeconds = data.duration === undefined || data.duration === null
    ? undefined
    : finiteDuration(data.duration);
  if (data.duration !== undefined && data.duration !== null && durationSeconds === undefined) return undefined;
  const videoUrl = typeof data.video_url === "string" ? data.video_url : undefined;
  if (data.video_url !== undefined && data.video_url !== null && !videoUrl) return undefined;
  const failureCode = safeFailureCode(data.failure_code);
  if (data.failure_code !== undefined && data.failure_code !== null && !failureCode) return undefined;
  const failureMessageDigest = typeof data.failure_message === "string" && data.failure_message.length <= 20_000
    ? sha256(data.failure_message)
    : undefined;
  if (data.failure_message !== undefined && data.failure_message !== null && !failureMessageDigest) return undefined;
  return { status, videoUrl, durationSeconds, failureCode, failureMessageDigest };
}

async function safeResponseBody(response: Response): Promise<string | undefined> {
  const declaredLength = response.headers.get("content-length");
  if (declaredLength && (!/^\d+$/u.test(declaredLength) || Number(declaredLength) > MAX_BODY_BYTES)) return undefined;
  try {
    const text = await response.text();
    return Buffer.byteLength(text, "utf8") <= MAX_BODY_BYTES ? text : undefined;
  } catch {
    return undefined;
  }
}

function jsonObject(body: string): Record<string, unknown> | undefined {
  try {
    return objectValue(JSON.parse(body));
  } catch {
    return undefined;
  }
}

function objectValue(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function exactMp4Url(value: string | undefined): string | undefined {
  if (!value || value.length > 8_192) return undefined;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || !url.hostname || url.hash
      || !url.pathname.toLowerCase().endsWith(".mp4")) return undefined;
    return url.toString();
  } catch {
    return undefined;
  }
}

function safeRequestId(headers: Headers): string | undefined {
  const value = headers.get("x-request-id") ?? headers.get("request-id");
  if (!value || value.length > MAX_PROVIDER_ID_LENGTH || value !== value.trim()
    || /[\u0000-\u001f\u007f-\u009f]/u.test(value)) return undefined;
  return value;
}

function safeFailureCode(value: unknown): string | undefined {
  return typeof value === "string" && /^[A-Za-z0-9_.:-]{1,128}$/u.test(value) ? value : undefined;
}

function finiteDuration(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 24 * 60 * 60
    ? value
    : undefined;
}

function requiredScript(value: unknown): string {
  if (typeof value !== "string" || !value.trim() || value.length > MAX_SCRIPT_LENGTH
    || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value)) {
    throw new Error("HeyGen script is invalid");
  }
  return value;
}

function requiredAspectRatio(value: unknown): string {
  if (typeof value !== "string" || !ASPECT_RATIOS.has(value)) throw new Error("HeyGen aspect ratio is invalid");
  return value;
}

function opaqueId(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length < 1 || value.length > MAX_PROVIDER_ID_LENGTH
    || value !== value.trim() || /[\u0000-\u001f\u007f-\u009f]/u.test(value)) {
    throw new Error(`HeyGen ${label} is invalid`);
  }
  return value;
}

function exactSecret(value: string): string {
  if (typeof value !== "string" || !value.trim() || value !== value.trim() || value.length > 4_096
    || /[\u0000-\u001f\u007f-\u009f]/u.test(value)) {
    throw new Error("HeyGen API credential is invalid");
  }
  return value;
}

function validScopePart(value: string): boolean {
  return typeof value === "string" && value.length >= 1 && value.length <= 256 && value === value.trim()
    && !/[\u0000-\u001f\u007f-\u009f]/u.test(value);
}

function exactObservedAt(value: Date): string {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) throw new Error("HeyGen observation clock is invalid");
  return value.toISOString();
}

function transportClass(error: unknown): string {
  return error instanceof DOMException && error.name === "TimeoutError" ? "timeout" : "transport_error";
}

function sha256(value: string): Sha256Digest {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}
