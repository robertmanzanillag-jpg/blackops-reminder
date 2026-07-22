import type { TenantScope } from "../core/resource-domain";
import type { Sha256Digest } from "../planning/contracts";
import type { StaticHeyGenApiKey } from "../provider-credentials/static-heygen-secret-resolver";

export const HEYGEN_V3_STATIC_VERIFICATION_PROVIDER_KEY = "heygen" as const;

/**
 * Server-only credential capability. A secret resolver may mint this after
 * explicit operator approval; HTTP bodies and persistence must never carry it.
 */
export type HeyGenV3StaticVerificationApiKey = StaticHeyGenApiKey;

export type HeyGenV3StaticVerificationEngine = "avatar_iii" | "avatar_iv" | "avatar_v";

export type HeyGenV3StaticVerificationFailureCode =
  | "invalid_request"
  | "account_unavailable"
  | "avatar_look_unavailable"
  | "avatar_group_unavailable"
  | "voice_unavailable"
  | "provider_response_untrusted"
  | "provider_rate_limited"
  | "provider_unauthorized"
  | "provider_forbidden"
  | "provider_not_found"
  | "provider_timeout"
  | "provider_transport_error";

export type HeyGenV3StaticVerificationBillingModel = "wallet" | "subscription" | "usage_based";

export interface HeyGenV3StaticVerificationSelection {
  readonly avatarLookId: string;
  readonly voiceId: string;
  readonly expectedVoiceLanguage?: string;
  readonly requiredEngine?: HeyGenV3StaticVerificationEngine;
}

export interface HeyGenV3StaticVerificationCommand {
  readonly scope: TenantScope;
  readonly providerAccountId: string;
  readonly providerKey: typeof HEYGEN_V3_STATIC_VERIFICATION_PROVIDER_KEY;
  readonly providerCredentialVersion: number;
  readonly idempotencyKey: string;
  readonly selections: readonly HeyGenV3StaticVerificationSelection[];
}

export interface HeyGenV3VerifiedAvatarEvidence {
  /** Server-only provider-native look id. This is the future POST /v3/videos avatar_id. */
  readonly avatarLookId: string;
  readonly lookIdDigest: Sha256Digest;
  readonly groupIdDigest: Sha256Digest;
  readonly lookStatus: "completed";
  readonly groupStatus: "completed";
  readonly groupConsentStatus: "approved";
  readonly supportedEngines: readonly HeyGenV3StaticVerificationEngine[];
  readonly evidenceDigest: Sha256Digest;
}

export interface HeyGenV3VerifiedVoiceEvidence {
  /** Server-only provider-native voice id. */
  readonly voiceId: string;
  readonly voiceIdDigest: Sha256Digest;
  readonly language: string;
  readonly gender?: string;
  readonly supportPause?: boolean;
  readonly supportLocale?: boolean;
  readonly supportInteractiveAvatar?: boolean;
  readonly evidenceDigest: Sha256Digest;
}

export interface HeyGenV3StaticVerificationPassed {
  readonly kind: "passed";
  readonly providerKey: typeof HEYGEN_V3_STATIC_VERIFICATION_PROVIDER_KEY;
  readonly providerAccountId: string;
  readonly providerCredentialVersion: number;
  readonly observedAt: string;
  readonly billingModel: HeyGenV3StaticVerificationBillingModel;
  readonly avatarLookCount: number;
  readonly voiceCount: number;
  readonly requestDigest: Sha256Digest;
  readonly accountEvidenceDigest: Sha256Digest;
  readonly avatars: readonly HeyGenV3VerifiedAvatarEvidence[];
  readonly voices: readonly HeyGenV3VerifiedVoiceEvidence[];
  readonly evidenceDigest: Sha256Digest;
}

export interface HeyGenV3StaticVerificationFailed {
  readonly kind: "failed";
  readonly providerKey: typeof HEYGEN_V3_STATIC_VERIFICATION_PROVIDER_KEY;
  readonly providerAccountId: string;
  readonly providerCredentialVersion: number;
  readonly observedAt: string;
  readonly failureCode: HeyGenV3StaticVerificationFailureCode;
  readonly requestDigest: Sha256Digest;
  readonly evidenceDigest: Sha256Digest;
}

export type HeyGenV3StaticVerificationOutcome =
  | HeyGenV3StaticVerificationPassed
  | HeyGenV3StaticVerificationFailed;

export interface HeyGenV3StaticVerificationProvider {
  verify(command: Readonly<HeyGenV3StaticVerificationCommand>): Promise<HeyGenV3StaticVerificationOutcome>;
}
