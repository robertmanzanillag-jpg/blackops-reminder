import { createHash } from "node:crypto";
import type { Sha256Digest } from "../planning/contracts";
import type {
  HeyGenV3StaticVerificationApiKey,
  HeyGenV3StaticVerificationBillingModel,
  HeyGenV3StaticVerificationCommand,
  HeyGenV3StaticVerificationEngine,
  HeyGenV3StaticVerificationFailureCode,
  HeyGenV3StaticVerificationOutcome,
  HeyGenV3StaticVerificationProvider,
  HeyGenV3StaticVerificationSelection,
  HeyGenV3VerifiedAvatarEvidence,
  HeyGenV3VerifiedVoiceEvidence,
} from "./heygen-v3-static-verification-contracts";
import { HEYGEN_V3_STATIC_VERIFICATION_PROVIDER_KEY } from "./heygen-v3-static-verification-contracts";

const HEYGEN_API_ORIGIN = "https://api.heygen.com";
const MAX_BODY_BYTES = 256 * 1024;
const MAX_PROVIDER_ID_LENGTH = 256;
const MIN_SELECTIONS = 5;
const MAX_SELECTIONS = 10;
const DEFAULT_TIMEOUT_MS = 20_000;
const DEFAULT_OVERALL_TIMEOUT_MS = 60_000;
const MAX_TIMEOUT_MS = 120_000;
const IDEMPOTENCY_KEY = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,199}$/u;
const SHA256 = /^sha256:[0-9a-f]{64}$/u;
const SUPPORTED_BILLING_MODELS = new Set(["wallet", "subscription", "usage_based"]);
const SUPPORTED_ENGINES = new Set(["avatar_iii", "avatar_iv", "avatar_v"]);

type HeyGenFetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export interface HeyGenV3StaticVerificationProviderOptions {
  readonly apiKey: HeyGenV3StaticVerificationApiKey;
  readonly providerAccountId: string;
  readonly providerCredentialVersion: number;
  readonly fetchImpl?: HeyGenFetch;
  readonly timeoutMs?: number;
  readonly overallTimeoutMs?: number;
  readonly now?: () => Date;
}

type AccountDetail = Readonly<{
  billingModel: HeyGenV3StaticVerificationBillingModel;
  evidenceDigest: Sha256Digest;
}>;

type LookDetail = Readonly<{
  id: string;
  groupId: string;
  status: string;
  supportedEngines: readonly string[];
  evidenceDigest: Sha256Digest;
}>;

type GroupDetail = Readonly<{
  id: string;
  status: string;
  consentStatus: string;
  evidenceDigest: Sha256Digest;
}>;

type VoiceDetail = Readonly<{
  voiceId: string;
  language: string;
  gender: string | undefined;
  supportPause: boolean | undefined;
  supportLocale: boolean | undefined;
  supportInteractiveAvatar: boolean | undefined;
  evidenceDigest: Sha256Digest;
}>;

type ProviderFetchResult =
  | { kind: "ok"; body: string; responseStatus: number; responseDigest: Sha256Digest }
  | { kind: "failed"; failureCode: HeyGenV3StaticVerificationFailureCode; responseStatus?: number; responseDigest?: Sha256Digest };

export class HeyGenV3StaticVerificationHttpProvider implements HeyGenV3StaticVerificationProvider {
  private readonly apiKey: HeyGenV3StaticVerificationApiKey;
  private readonly providerAccountId: string;
  private readonly providerCredentialVersion: number;
  private readonly fetchImpl: HeyGenFetch;
  private readonly timeoutMs: number;
  private readonly overallTimeoutMs: number;
  private readonly now: () => Date;

  constructor(options: HeyGenV3StaticVerificationProviderOptions) {
    this.apiKey = options.apiKey;
    this.providerAccountId = opaqueId(options.providerAccountId, "provider account id");
    if (!Number.isSafeInteger(options.providerCredentialVersion) || options.providerCredentialVersion < 1) {
      throw new Error("HeyGen provider credential version must be a positive integer");
    }
    this.providerCredentialVersion = options.providerCredentialVersion;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.timeoutMs = boundedMs(options.timeoutMs ?? DEFAULT_TIMEOUT_MS, "timeout");
    this.overallTimeoutMs = boundedMs(options.overallTimeoutMs ?? DEFAULT_OVERALL_TIMEOUT_MS, "overall timeout");
    this.now = options.now ?? (() => new Date());
  }

  async verify(command: Readonly<HeyGenV3StaticVerificationCommand>): Promise<HeyGenV3StaticVerificationOutcome> {
    const observedAt = exactObservedAt(this.now());
    const request = validateCommand(command, this.providerAccountId, this.providerCredentialVersion);
    if (!request) return this.failed(command, observedAt, "invalid_request", safeRequestDigest(command));
    const startedAtMs = Date.now();
    const accountResult = await this.getJson("/v3/users/me", startedAtMs);
    if (accountResult.kind === "failed") return this.failed(request, observedAt, accountResult.failureCode, request.requestDigest);
    const account = parseAccount(accountResult.body, accountResult.responseDigest);
    if (!account) return this.failed(request, observedAt, "provider_response_untrusted", request.requestDigest);

    const lookDetails = new Map<string, LookDetail>();
    for (const selection of request.uniqueLooks) {
      const result = await this.getJson(`/v3/avatars/looks/${encodeURIComponent(selection.avatarLookId)}`, startedAtMs);
      if (result.kind === "failed") return this.failed(request, observedAt, result.failureCode, request.requestDigest);
      const look = parseLook(result.body, selection.avatarLookId, result.responseDigest);
      if (!look || look.status !== "completed" || !look.supportedEngines.includes(selection.requiredEngine)) {
        return this.failed(request, observedAt, "avatar_look_unavailable", request.requestDigest);
      }
      lookDetails.set(selection.avatarLookId, look);
    }

    const groupDetails = new Map<string, GroupDetail>();
    for (const groupId of unique([...lookDetails.values()].map((look) => look.groupId))) {
      const result = await this.getJson(`/v3/avatars/${encodeURIComponent(groupId)}`, startedAtMs);
      if (result.kind === "failed") return this.failed(request, observedAt, result.failureCode, request.requestDigest);
      const group = parseGroup(result.body, groupId, result.responseDigest);
      if (!group || group.status !== "completed" || group.consentStatus !== "approved") {
        return this.failed(request, observedAt, "avatar_group_unavailable", request.requestDigest);
      }
      groupDetails.set(groupId, group);
    }

    const voiceDetails = new Map<string, VoiceDetail>();
    for (const selection of request.uniqueVoices) {
      const result = await this.getJson(`/v3/voices/${encodeURIComponent(selection.voiceId)}`, startedAtMs);
      if (result.kind === "failed") return this.failed(request, observedAt, result.failureCode, request.requestDigest);
      const voice = parseVoice(result.body, selection.voiceId, result.responseDigest);
      if (!voice || !languageMatches(voice.language, selection.expectedVoiceLanguage)) {
        return this.failed(request, observedAt, "voice_unavailable", request.requestDigest);
      }
      voiceDetails.set(selection.voiceId, voice);
    }

    const avatars: HeyGenV3VerifiedAvatarEvidence[] = request.uniqueLooks.map((selection) => {
      const look = lookDetails.get(selection.avatarLookId);
      const group = look ? groupDetails.get(look.groupId) : undefined;
      if (!look || !group) throw new Error("HeyGen static verification invariant failed");
      const lookIdDigest = sha256(selection.avatarLookId);
      const groupIdDigest = sha256(look.groupId);
      const evidenceDigest = sha256(JSON.stringify({
        lookEvidenceDigest: look.evidenceDigest,
        groupEvidenceDigest: group.evidenceDigest,
        requiredEngine: selection.requiredEngine,
        lookIdDigest,
        groupIdDigest,
      }));
      return {
        avatarLookId: selection.avatarLookId,
        lookIdDigest,
        groupIdDigest,
        lookStatus: "completed",
        groupStatus: "completed",
        groupConsentStatus: "approved",
        supportedEngines: look.supportedEngines.filter(isSupportedEngine),
        evidenceDigest,
      };
    });
    const voices: HeyGenV3VerifiedVoiceEvidence[] = request.uniqueVoices.map((selection) => {
      const voice = voiceDetails.get(selection.voiceId);
      if (!voice) throw new Error("HeyGen static verification invariant failed");
      const voiceIdDigest = sha256(selection.voiceId);
      const evidenceDigest = sha256(JSON.stringify({
        voiceEvidenceDigest: voice.evidenceDigest,
        voiceIdDigest,
        expectedVoiceLanguageDigest: selection.expectedVoiceLanguage ? sha256(selection.expectedVoiceLanguage) : null,
      }));
      return {
        voiceId: selection.voiceId,
        voiceIdDigest,
        language: voice.language,
        ...(voice.gender ? { gender: voice.gender } : {}),
        ...(voice.supportPause === undefined ? {} : { supportPause: voice.supportPause }),
        ...(voice.supportLocale === undefined ? {} : { supportLocale: voice.supportLocale }),
        ...(voice.supportInteractiveAvatar === undefined ? {} : { supportInteractiveAvatar: voice.supportInteractiveAvatar }),
        evidenceDigest,
      };
    });
    const evidenceDigest = this.evidenceDigest("passed", request, {
      observedAt,
      billingModel: account.billingModel,
      accountEvidenceDigest: account.evidenceDigest,
      avatarEvidenceDigests: avatars.map((avatar) => avatar.evidenceDigest),
      voiceEvidenceDigests: voices.map((voice) => voice.evidenceDigest),
      avatarLookCount: request.uniqueLooks.length,
      voiceCount: request.uniqueVoices.length,
    });
    return {
      kind: "passed",
      providerKey: HEYGEN_V3_STATIC_VERIFICATION_PROVIDER_KEY,
      providerAccountId: this.providerAccountId,
      providerCredentialVersion: this.providerCredentialVersion,
      observedAt,
      billingModel: account.billingModel,
      avatarLookCount: request.uniqueLooks.length,
      voiceCount: request.uniqueVoices.length,
      requestDigest: request.requestDigest,
      accountEvidenceDigest: account.evidenceDigest,
      avatars,
      voices,
      evidenceDigest,
    };
  }

  private async getJson(path: string, startedAtMs: number): Promise<ProviderFetchResult> {
    const remainingMs = this.overallTimeoutMs - (Date.now() - startedAtMs);
    if (remainingMs < 1) return { kind: "failed", failureCode: "provider_timeout" };
    const timeoutMs = Math.min(this.timeoutMs, remainingMs);
    let response: Response;
    try {
      response = await this.fetchImpl(`${HEYGEN_API_ORIGIN}${path}`, {
        method: "GET",
        headers: { "x-api-key": this.apiKey },
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      return { kind: "failed", failureCode: transportFailureCode(error) };
    }
    const body = await safeResponseBody(response);
    if (body === undefined) {
      return { kind: "failed", failureCode: "provider_response_untrusted", responseStatus: response.status };
    }
    const responseDigest = sha256(body);
    if (!response.ok) {
      return { kind: "failed", failureCode: httpFailureCode(response.status), responseStatus: response.status, responseDigest };
    }
    return { kind: "ok", body, responseStatus: response.status, responseDigest };
  }

  private failed(
    command: Pick<HeyGenV3StaticVerificationCommand, "providerAccountId" | "providerCredentialVersion"> | undefined,
    observedAt: string,
    failureCode: HeyGenV3StaticVerificationFailureCode,
    requestDigest: Sha256Digest,
  ): HeyGenV3StaticVerificationOutcome {
    const providerCredentialVersion = this.providerCredentialVersion;
    return {
      kind: "failed",
      providerKey: HEYGEN_V3_STATIC_VERIFICATION_PROVIDER_KEY,
      providerAccountId: this.providerAccountId,
      providerCredentialVersion,
      observedAt,
      failureCode,
      requestDigest,
      evidenceDigest: this.evidenceDigest("failed", {
        providerAccountId: this.providerAccountId,
        providerCredentialVersion,
        requestDigest,
      }, { observedAt, failureCode }),
    };
  }

  private evidenceDigest(
    domain: string,
    context: Pick<HeyGenV3StaticVerificationCommand, "providerAccountId" | "providerCredentialVersion"> & { requestDigest: Sha256Digest },
    detail: Record<string, unknown>,
  ): Sha256Digest {
    return sha256(JSON.stringify({
      version: 1,
      domain,
      apiOrigin: HEYGEN_API_ORIGIN,
      apiVersion: "v3",
      providerKey: HEYGEN_V3_STATIC_VERIFICATION_PROVIDER_KEY,
      providerAccountId: context.providerAccountId,
      providerCredentialVersion: context.providerCredentialVersion,
      requestDigest: context.requestDigest,
      ...detail,
    }));
  }
}

type ValidatedCommand = HeyGenV3StaticVerificationCommand & Readonly<{
  requestDigest: Sha256Digest;
  uniqueLooks: readonly RequiredSelection[];
  uniqueVoices: readonly RequiredSelection[];
}>;

type RequiredSelection = Readonly<{
  avatarLookId: string;
  voiceId: string;
  expectedVoiceLanguage?: string;
  requiredEngine: HeyGenV3StaticVerificationEngine;
}>;

function validateCommand(
  command: Readonly<HeyGenV3StaticVerificationCommand>,
  providerAccountId: string,
  providerCredentialVersion: number,
): ValidatedCommand | undefined {
  try {
    if (command.providerKey !== HEYGEN_V3_STATIC_VERIFICATION_PROVIDER_KEY
      || opaqueId(command.providerAccountId, "provider account id") !== providerAccountId
      || command.providerCredentialVersion !== providerCredentialVersion
      || !validScopePart(command.scope.ownerUserId)
      || !validScopePart(command.scope.workspaceId)
      || !IDEMPOTENCY_KEY.test(command.idempotencyKey)
      || !Array.isArray(command.selections)
      || command.selections.length < MIN_SELECTIONS
      || command.selections.length > MAX_SELECTIONS) return undefined;
    const selections = command.selections.map(requiredSelection)
      .sort((left, right) => left.avatarLookId.localeCompare(right.avatarLookId));
    if (new Set(selections.map((selection) => selection.avatarLookId)).size !== selections.length) return undefined;
    const uniqueLooks = selections;
    const voiceConflicts = new Map<string, string>();
    for (const selection of selections) {
      const signature = JSON.stringify({
        expectedVoiceLanguage: selection.expectedVoiceLanguage ?? null,
      });
      const existing = voiceConflicts.get(selection.voiceId);
      if (existing !== undefined && existing !== signature) return undefined;
      voiceConflicts.set(selection.voiceId, signature);
    }
    const uniqueVoices = uniqueBy<RequiredSelection>(selections, (selection) => selection.voiceId)
      .sort((left, right) => left.voiceId.localeCompare(right.voiceId));
    if (uniqueVoices.length > MAX_SELECTIONS) return undefined;
    return {
      ...command,
      selections,
      requestDigest: sha256(canonicalJson({
        version: 1,
        providerKey: command.providerKey,
        providerAccountId: command.providerAccountId,
        providerCredentialVersion: command.providerCredentialVersion,
        scope: command.scope,
        idempotencyKey: command.idempotencyKey,
        selections: selections.map((selection) => ({
          avatarIdDigest: sha256(selection.avatarLookId),
          voiceIdDigest: sha256(selection.voiceId),
          expectedVoiceLanguageDigest: selection.expectedVoiceLanguage ? sha256(selection.expectedVoiceLanguage) : null,
          requiredEngine: selection.requiredEngine,
        })),
      })),
      uniqueLooks,
      uniqueVoices,
    };
  } catch {
    return undefined;
  }
}

function requiredSelection(selection: HeyGenV3StaticVerificationSelection): RequiredSelection {
  const requiredEngine = selection.requiredEngine ?? "avatar_iv";
  if (!SUPPORTED_ENGINES.has(requiredEngine)) throw new Error("Invalid HeyGen static verification selection");
  const base = {
    avatarLookId: opaqueId(selection.avatarLookId, "avatar look id"),
    voiceId: opaqueId(selection.voiceId, "voice id"),
    requiredEngine: requiredEngine as HeyGenV3StaticVerificationEngine,
  };
  const expectedVoiceLanguage = optionalLabel(selection.expectedVoiceLanguage, "expected voice language", 80);
  return expectedVoiceLanguage ? { ...base, expectedVoiceLanguage } : base;
}

function parseAccount(body: string, responseDigest: Sha256Digest): AccountDetail | undefined {
  const root = jsonObject(body);
  const data = root && objectValue(root.data);
  const billingModel = stringValue(data?.billing_type, 64);
  if (!billingModel || !SUPPORTED_BILLING_MODELS.has(billingModel)) return undefined;
  const model = billingModel as HeyGenV3StaticVerificationBillingModel;
  if (model === "wallet" && !objectValue(data?.wallet)) return undefined;
  if (model === "subscription" && !objectValue(data?.subscription)) return undefined;
  if (model === "usage_based" && !objectValue(data?.usage_based)) return undefined;
  return {
    billingModel: model,
    evidenceDigest: sha256(JSON.stringify({
      endpoint: "/v3/users/me",
      responseDigest,
      billingModel: model,
    })),
  };
}

function parseLook(body: string, expectedLookId: string, responseDigest: Sha256Digest): LookDetail | undefined {
  const root = jsonObject(body);
  const data = root && objectValue(root.data);
  const id = stringValue(data?.id, MAX_PROVIDER_ID_LENGTH);
  const groupId = stringValue(data?.group_id, MAX_PROVIDER_ID_LENGTH);
  const status = stringValue(data?.status, 64)?.toLowerCase();
  const supportedEngines = Array.isArray(data?.supported_api_engines)
    ? data.supported_api_engines.map((value) => stringValue(value, 64)).filter((value): value is string => Boolean(value))
    : undefined;
  if (id !== expectedLookId || !groupId || !status || !supportedEngines) return undefined;
  return {
    id,
    groupId,
    status,
    supportedEngines,
    evidenceDigest: sha256(JSON.stringify({
      endpoint: "/v3/avatars/looks/{look_id}",
      responseDigest,
      avatarIdDigest: sha256(id),
      groupIdDigest: sha256(groupId),
      status,
      supportedEngines,
    })),
  };
}

function parseGroup(body: string, expectedGroupId: string, responseDigest: Sha256Digest): GroupDetail | undefined {
  const root = jsonObject(body);
  const data = root && objectValue(root.data);
  const id = stringValue(data?.id, MAX_PROVIDER_ID_LENGTH);
  const status = stringValue(data?.status, 64)?.toLowerCase();
  const consentStatus = stringValue(data?.consent_status, 64)?.toLowerCase();
  if (id !== expectedGroupId || !status || !consentStatus) return undefined;
  return {
    id,
    status,
    consentStatus,
    evidenceDigest: sha256(JSON.stringify({
      endpoint: "/v3/avatars/{group_id}",
      responseDigest,
      groupIdDigest: sha256(id),
      status,
      consentStatus,
    })),
  };
}

function parseVoice(body: string, expectedVoiceId: string, responseDigest: Sha256Digest): VoiceDetail | undefined {
  const root = jsonObject(body);
  const data = root && objectValue(root.data);
  const voiceId = stringValue(data?.voice_id, MAX_PROVIDER_ID_LENGTH);
  const language = stringValue(data?.language, 80);
  const gender = stringValue(data?.gender, 80);
  const supportPause = optionalBoolean(data?.support_pause);
  const supportLocale = optionalBoolean(data?.support_locale);
  const supportInteractiveAvatar = optionalBoolean(data?.support_interactive_avatar);
  if (voiceId !== expectedVoiceId || !language) return undefined;
  return {
    voiceId,
    language,
    gender,
    supportPause,
    supportLocale,
    supportInteractiveAvatar,
    evidenceDigest: sha256(JSON.stringify({
      endpoint: "/v3/voices/{voice_id}",
      responseDigest,
      voiceIdDigest: sha256(voiceId),
      languageDigest: sha256(language),
      genderDigest: gender ? sha256(gender) : null,
      supportPause: supportPause ?? null,
      supportLocale: supportLocale ?? null,
      supportInteractiveAvatar: supportInteractiveAvatar ?? null,
    })),
  };
}

async function safeResponseBody(response: Response): Promise<string | undefined> {
  const declaredLength = response.headers.get("content-length");
  if (declaredLength && (!/^\d+$/u.test(declaredLength) || Number(declaredLength) > MAX_BODY_BYTES)) {
    await response.body?.cancel().catch(() => undefined);
    return undefined;
  }
  if (!response.body) return "";
  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  const parts: string[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!(value instanceof Uint8Array)) {
        await reader.cancel().catch(() => undefined);
        return undefined;
      }
      totalBytes += value.byteLength;
      if (totalBytes > MAX_BODY_BYTES) {
        await reader.cancel().catch(() => undefined);
        return undefined;
      }
      parts.push(decoder.decode(value, { stream: true }));
    }
    parts.push(decoder.decode());
    return parts.join("");
  } catch {
    await reader.cancel().catch(() => undefined);
    return undefined;
  } finally {
    reader.releaseLock();
  }
}

function safeRequestDigest(command: unknown): Sha256Digest {
  try {
    return sha256(canonicalJson(command));
  } catch {
    return sha256("invalid-heygen-static-verification-command");
  }
}

function httpFailureCode(status: number): HeyGenV3StaticVerificationFailureCode {
  if (status === 401) return "provider_unauthorized";
  if (status === 403) return "provider_forbidden";
  if (status === 404) return "provider_not_found";
  if (status === 429) return "provider_rate_limited";
  return "provider_response_untrusted";
}

function transportFailureCode(error: unknown): HeyGenV3StaticVerificationFailureCode {
  return error instanceof DOMException && error.name === "TimeoutError" ? "provider_timeout" : "provider_transport_error";
}

function boundedMs(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > MAX_TIMEOUT_MS) {
    throw new Error(`HeyGen static verification ${label} must be between 1 and ${MAX_TIMEOUT_MS} milliseconds`);
  }
  return value;
}

function languageMatches(actual: string | undefined, expected: string | undefined): boolean {
  return expected === undefined ? Boolean(actual) : actual === expected;
}

function isSupportedEngine(value: string): value is HeyGenV3StaticVerificationEngine {
  return SUPPORTED_ENGINES.has(value);
}

function unique<T>(values: readonly T[]): T[] {
  return [...new Set(values)];
}

function uniqueBy<T>(values: readonly T[], key: (value: T) => string): T[] {
  const seen = new Set<string>();
  const output: T[] = [];
  for (const value of values) {
    const id = key(value);
    if (seen.has(id)) continue;
    seen.add(id);
    output.push(value);
  }
  return output;
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

function stringValue(value: unknown, max: number): string | undefined {
  return typeof value === "string" && value === value.trim() && value.length >= 1 && value.length <= max
    && !/[\u0000-\u001f\u007f-\u009f]/u.test(value)
    ? value
    : undefined;
}

function optionalLabel(value: unknown, label: string, max: number): string | undefined {
  if (value === undefined) return undefined;
  const parsed = stringValue(value, max);
  if (!parsed) throw new Error(`HeyGen ${label} is invalid`);
  return parsed;
}

function optionalBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function opaqueId(value: unknown, label: string): string {
  const parsed = stringValue(value, MAX_PROVIDER_ID_LENGTH);
  if (!parsed) throw new Error(`HeyGen ${label} is invalid`);
  return parsed;
}

function validScopePart(value: string): boolean {
  return typeof value === "string" && value.length >= 1 && value.length <= 256 && value === value.trim()
    && !/[\u0000-\u001f\u007f-\u009f]/u.test(value);
}

function exactObservedAt(value: Date): string {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) throw new Error("HeyGen static verification clock is invalid");
  return value.toISOString();
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) throw new TypeError("Invalid canonical JSON");
    return String(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (!value || typeof value !== "object") throw new TypeError("Invalid canonical JSON");
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).filter((key) => typeof record[key] !== "undefined").sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(",")}}`;
}

function sha256(value: string): Sha256Digest {
  const digest = `sha256:${createHash("sha256").update(value).digest("hex")}`;
  if (!SHA256.test(digest)) throw new Error("Invalid digest");
  return digest as Sha256Digest;
}
