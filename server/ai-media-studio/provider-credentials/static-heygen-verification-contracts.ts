import { createHash } from "node:crypto";
import type { HeyGenV3StaticVerificationPassed } from "../providers/heygen-v3-static-verification-contracts";
import type { TenantScope } from "../core/resource-domain";

export type Sha256Digest = `sha256:${string}`;
export type StaticHeyGenVerificationResourceKind = "avatar" | "voice";
export type StaticHeyGenVerificationOutcome = "recorded" | "replayed";
export type StaticHeyGenVerificationErrorCode =
  | "INVALID_REQUEST"
  | "MISMATCH"
  | "STALE"
  | "UNAVAILABLE";

export interface StaticHeyGenVerificationCommand {
  verificationId: string;
  scope: TenantScope;
  actorUserId: string;
  providerAccountId: string;
  staticCredentialBindingId: string;
  providerCredentialVersion: number;
  credentialBindingRequestDigest: Sha256Digest;
  dailyPlanId: string;
  sourceRosterKey: string;
  sourceRosterDigest: Sha256Digest;
  planDigest: Sha256Digest;
  policyExpiresAt: string;
  idempotencyKey: string;
  providerOutcome: HeyGenV3StaticVerificationPassed;
}

export interface PreparedStaticHeyGenVerificationRecord {
  verificationId: string;
  scope: TenantScope;
  actorUserId: string;
  providerAccountId: string;
  staticCredentialBindingId: string;
  providerCredentialVersion: number;
  credentialBindingRequestDigest: Sha256Digest;
  dailyPlanId: string;
  sourceRosterKey: string;
  sourceRosterDigest: Sha256Digest;
  planDigest: Sha256Digest;
  verificationState: "verified";
  accountEvidenceDigest: Sha256Digest;
  billingModel: string;
  verificationRequestDigest: Sha256Digest;
  evidenceDigest: Sha256Digest;
  inputDigest: Sha256Digest;
  idempotencyKey: string;
  observedAt: string;
  expiresAt: string;
  resources: readonly PreparedStaticHeyGenResourceVerification[];
}

export interface PreparedStaticHeyGenResourceVerification {
  id: string;
  providerResourceId?: string;
  resourceType: StaticHeyGenVerificationResourceKind;
  providerExternalId: string;
  providerResourceExternalIdDigest: Sha256Digest;
  avatarLookIdDigest: Sha256Digest | null;
  avatarLookStatus: "completed" | null;
  avatarGroupIdDigest: Sha256Digest | null;
  avatarGroupStatus: "completed" | null;
  avatarGroupConsentStatus: "approved" | null;
  avatarEnginesDigest: Sha256Digest | null;
  voiceIdDigest: Sha256Digest | null;
  language: string | null;
  voiceSupportDigest: Sha256Digest | null;
  resourceResponseDigest: Sha256Digest;
  evidenceDigest: Sha256Digest;
  inputDigest: Sha256Digest;
  idempotencyKey: string;
}

export interface StaticHeyGenVerificationReceipt {
  outcome: StaticHeyGenVerificationOutcome;
  verification: {
    verificationKey: string;
    evidenceKey: string;
    providerKey: "heygen";
    providerCredentialVersion: number;
    verifiedAt: string;
    expiresAt: string;
    avatarCount: number;
    voiceCount: number;
  };
}

export interface StaticHeyGenVerificationRepository {
  recordPassed(input: PreparedStaticHeyGenVerificationRecord): Promise<StaticHeyGenVerificationReceipt | undefined>;
}

export class StaticHeyGenVerificationError extends Error {
  readonly statusCode: number;

  constructor(readonly code: StaticHeyGenVerificationErrorCode) {
    super("Static HeyGen verification evidence is invalid");
    this.name = "StaticHeyGenVerificationError";
    this.statusCode = code === "INVALID_REQUEST" ? 400 : code === "UNAVAILABLE" ? 503 : 409;
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const SAFE_ACTOR = /^[A-Za-z0-9][A-Za-z0-9@._:-]{0,254}$/u;
const SAFE_IDEMPOTENCY = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,199}$/u;
const SHA256 = /^sha256:[0-9a-f]{64}$/u;
const SAFE_ROSTER = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/u;
const SAFE_BILLING = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,79}$/u;
const SAFE_PROVIDER_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/u;
const LANGUAGE = /^[A-Za-z][A-Za-z0-9 ._:/-]{1,39}$/u;
const MAX_VERIFICATION_LIFETIME_MS = 24 * 60 * 60 * 1_000;

export function sha256(value: unknown): Sha256Digest {
  return `sha256:${createHash("sha256").update(
    typeof value === "string" ? value : JSON.stringify(value),
    "utf8",
  ).digest("hex")}`;
}

export function deterministicUuid(seed: string): string {
  const hex = createHash("sha256").update(seed, "utf8").digest("hex").slice(0, 32).split("");
  hex[12] = "4";
  hex[16] = (8 + (Number.parseInt(hex[16] ?? "0", 16) % 4)).toString(16);
  return `${hex.slice(0, 8).join("")}-${hex.slice(8, 12).join("")}-${hex.slice(12, 16).join("")}-${hex.slice(16, 20).join("")}-${hex.slice(20, 32).join("")}`;
}

export function opaqueVerificationKey(id: string): string {
  return `static_heygen_verification_${sha256(`public\0${id}`).slice("sha256:".length, "sha256:".length + 24)}`;
}

export function opaqueEvidenceKey(digest: Sha256Digest): string {
  return `evidence_${sha256(`public\0${digest}`).slice("sha256:".length, "sha256:".length + 24)}`;
}

export function assertPreparedStaticHeyGenVerification(input: PreparedStaticHeyGenVerificationRecord): void {
  const observed = Date.parse(input.observedAt);
  const expires = Date.parse(input.expiresAt);
  const avatarCount = input.resources.filter((resource) => resource.resourceType === "avatar").length;
  const voiceCount = input.resources.filter((resource) => resource.resourceType === "voice").length;
  if (!UUID.test(input.verificationId)
    || !input.scope.ownerUserId.trim()
    || input.scope.ownerUserId.length > 255
    || !input.scope.workspaceId.trim()
    || input.scope.workspaceId.length > 255
    || !SAFE_ACTOR.test(input.actorUserId)
    || !UUID.test(input.providerAccountId)
    || !UUID.test(input.staticCredentialBindingId)
    || !Number.isSafeInteger(input.providerCredentialVersion)
    || input.providerCredentialVersion < 1
    || !SHA256.test(input.credentialBindingRequestDigest)
    || !UUID.test(input.dailyPlanId)
    || !SAFE_ROSTER.test(input.sourceRosterKey)
    || !SHA256.test(input.sourceRosterDigest)
    || !SHA256.test(input.planDigest)
    || input.verificationState !== "verified"
    || !SHA256.test(input.accountEvidenceDigest)
    || !SAFE_BILLING.test(input.billingModel)
    || !SHA256.test(input.verificationRequestDigest)
    || !SHA256.test(input.evidenceDigest)
    || !SHA256.test(input.inputDigest)
    || !SAFE_IDEMPOTENCY.test(input.idempotencyKey)
    || !Number.isFinite(observed)
    || !Number.isFinite(expires)
    || expires <= observed
    || expires - observed > MAX_VERIFICATION_LIFETIME_MS
    || avatarCount < 5
    || avatarCount > 10
    || voiceCount < 1
    || new Set(input.resources.map((resource) => `${resource.resourceType}\0${resource.providerExternalId}`)).size !== input.resources.length
    || new Set(input.resources.map((resource) => resource.id)).size !== input.resources.length) {
    throw new StaticHeyGenVerificationError("INVALID_REQUEST");
  }
  for (const resource of input.resources) {
    const commonInvalid = !UUID.test(resource.id)
      || (resource.providerResourceId !== undefined && !UUID.test(resource.providerResourceId))
      || !SAFE_PROVIDER_ID.test(resource.providerExternalId)
      || !SHA256.test(resource.providerResourceExternalIdDigest)
      || !SHA256.test(resource.resourceResponseDigest)
      || !SHA256.test(resource.evidenceDigest)
      || !SHA256.test(resource.inputDigest)
      || !SAFE_IDEMPOTENCY.test(resource.idempotencyKey);
    if (commonInvalid) throw new StaticHeyGenVerificationError("INVALID_REQUEST");
    if (resource.resourceType === "avatar") {
      if (resource.avatarLookIdDigest !== resource.providerResourceExternalIdDigest
        || resource.avatarLookStatus !== "completed"
        || resource.avatarGroupStatus !== "completed"
        || resource.avatarGroupConsentStatus !== "approved"
        || !resource.avatarGroupIdDigest
        || !SHA256.test(resource.avatarGroupIdDigest)
        || resource.avatarGroupIdDigest === resource.avatarLookIdDigest
        || !resource.avatarEnginesDigest
        || !SHA256.test(resource.avatarEnginesDigest)
        || resource.voiceIdDigest !== null
        || resource.language !== null
        || resource.voiceSupportDigest !== null) {
        throw new StaticHeyGenVerificationError("INVALID_REQUEST");
      }
    } else if (resource.resourceType === "voice") {
      if (resource.voiceIdDigest !== resource.providerResourceExternalIdDigest
        || !resource.language
        || !LANGUAGE.test(resource.language)
        || !resource.voiceSupportDigest
        || !SHA256.test(resource.voiceSupportDigest)
        || resource.avatarLookIdDigest !== null
        || resource.avatarLookStatus !== null
        || resource.avatarGroupIdDigest !== null
        || resource.avatarGroupStatus !== null
        || resource.avatarGroupConsentStatus !== null
        || resource.avatarEnginesDigest !== null) {
        throw new StaticHeyGenVerificationError("INVALID_REQUEST");
      }
    } else {
      throw new StaticHeyGenVerificationError("INVALID_REQUEST");
    }
  }
}

export function assertStaticHeyGenVerificationCommand(input: StaticHeyGenVerificationCommand): void {
  if (input.providerOutcome.kind !== "passed"
    || input.providerOutcome.providerKey !== "heygen"
    || input.providerOutcome.providerAccountId !== input.providerAccountId
    || input.providerOutcome.providerCredentialVersion !== input.providerCredentialVersion
    || !SHA256.test(input.providerOutcome.requestDigest)) {
    throw new StaticHeyGenVerificationError("INVALID_REQUEST");
  }
  const observed = Date.parse(input.providerOutcome.observedAt);
  const expires = Date.parse(input.policyExpiresAt);
  if (!Number.isFinite(observed)
    || !Number.isFinite(expires)
    || expires <= observed
    || expires - observed > MAX_VERIFICATION_LIFETIME_MS
    || !SHA256.test(input.providerOutcome.accountEvidenceDigest)
    || !SHA256.test(input.providerOutcome.evidenceDigest)
    || !SAFE_BILLING.test(input.providerOutcome.billingModel)
    || input.providerOutcome.avatarLookCount !== input.providerOutcome.avatars.length
    || input.providerOutcome.voiceCount !== input.providerOutcome.voices.length
    || input.providerOutcome.avatars.length < 5
    || input.providerOutcome.avatars.length > 10
    || input.providerOutcome.voices.length < 1) {
    throw new StaticHeyGenVerificationError("INVALID_REQUEST");
  }
  const rawAvatarIds = new Set<string>();
  const rawVoiceIds = new Set<string>();
  for (const avatar of input.providerOutcome.avatars) {
    if (!SAFE_PROVIDER_ID.test(avatar.avatarLookId)
      || !SHA256.test(avatar.lookIdDigest)
      || sha256(avatar.avatarLookId) !== avatar.lookIdDigest
      || !SHA256.test(avatar.groupIdDigest)
      || avatar.lookIdDigest === avatar.groupIdDigest
      || avatar.lookStatus !== "completed"
      || avatar.groupStatus !== "completed"
      || avatar.groupConsentStatus !== "approved"
      || avatar.supportedEngines.length < 1
      || !SHA256.test(avatar.evidenceDigest)) {
      throw new StaticHeyGenVerificationError("INVALID_REQUEST");
    }
    rawAvatarIds.add(avatar.avatarLookId);
  }
  for (const voice of input.providerOutcome.voices) {
    if (!SAFE_PROVIDER_ID.test(voice.voiceId)
      || !SHA256.test(voice.voiceIdDigest)
      || sha256(voice.voiceId) !== voice.voiceIdDigest
      || !LANGUAGE.test(voice.language)
      || !SHA256.test(voice.evidenceDigest)) {
      throw new StaticHeyGenVerificationError("INVALID_REQUEST");
    }
    rawVoiceIds.add(voice.voiceId);
  }
  if (rawAvatarIds.size !== input.providerOutcome.avatars.length
    || rawVoiceIds.size !== input.providerOutcome.voices.length) {
    throw new StaticHeyGenVerificationError("MISMATCH");
  }
}
