import type {
  AllowedUse,
  BrandPolicy,
  ConsentBasis,
  QualityReviewStatus,
  QualityScores,
  RightsBasis,
} from "../../../shared/ai-media-studio-governance";
import type { TenantScope } from "../core/resource-domain";

export type { TenantScope };

export interface InfluencerGovernanceProfile {
  id: string;
  ownerUserId: string;
  workspaceId: string;
  influencerId: string;
  avatarId: string;
  voiceId: string;
  version: number;
  consentBasis: ConsentBasis;
  rightsBasis: RightsBasis;
  allowedUses: AllowedUse[];
  territories: string[];
  validFrom: string;
  expiresAt: string;
  policyVersion: string;
  proofDigest: `sha256:${string}`;
  brandPolicy: BrandPolicy;
  evidenceDigest: `sha256:${string}`;
  previousProfileId: string | null;
  revokedAt: string | null;
  revocationReason: string | null;
  createdByUserId: string;
  createdAt: string;
}

export interface AssetQualityReview {
  id: string;
  ownerUserId: string;
  workspaceId: string;
  assetId: string;
  /** Raw lowercase SHA-256 hex, matching ai_media_assets.checksum. */
  assetChecksum: string;
  version: number;
  criteria: QualityScores;
  status: QualityReviewStatus;
  notes?: string;
  evidenceDigest: `sha256:${string}`;
  previousReviewId: string | null;
  reviewedByUserId: string;
  createdAt: string;
}

export interface GovernanceProfileBinding {
  influencerId: string;
  avatarId: string;
  voiceId: string;
}

export interface QualityReviewBinding {
  assetId: string;
  /** Raw lowercase SHA-256 hex. */
  assetChecksum: string;
}

export interface GovernanceIdempotency {
  key: string;
  inputDigest: `sha256:${string}`;
}

export interface GovernanceAppendResult<T> {
  record: T;
  created: boolean;
}

export interface GovernanceRepository {
  appendProfile(
    scope: TenantScope,
    profile: InfluencerGovernanceProfile,
    idempotency: GovernanceIdempotency,
  ): Promise<GovernanceAppendResult<InfluencerGovernanceProfile>>;
  getProfile(scope: TenantScope, profileId: string): Promise<InfluencerGovernanceProfile | undefined>;
  getCurrentProfile(scope: TenantScope, influencerId: string): Promise<InfluencerGovernanceProfile | undefined>;
  listProfiles(scope: TenantScope, influencerId: string): Promise<InfluencerGovernanceProfile[]>;
  appendReview(
    scope: TenantScope,
    review: AssetQualityReview,
    idempotency: GovernanceIdempotency,
  ): Promise<GovernanceAppendResult<AssetQualityReview>>;
  getReview(scope: TenantScope, reviewId: string): Promise<AssetQualityReview | undefined>;
  getCurrentReview(scope: TenantScope, assetId: string): Promise<AssetQualityReview | undefined>;
  listReviews(scope: TenantScope, assetId: string): Promise<AssetQualityReview[]>;
}

export interface RenderGovernanceGateInput {
  influencerId: string;
  avatarId: string;
  voiceId: string;
  use: AllowedUse;
  territory: string;
  content: string;
}

export interface PublishGovernanceGateInput extends RenderGovernanceGateInput {
  assetId: string;
  /** Raw lowercase SHA-256 hex. */
  assetChecksum: string;
}

export type GovernanceGateReason =
  | "profile_missing"
  | "profile_revoked"
  | "profile_not_yet_valid"
  | "profile_expired"
  | "avatar_mismatch"
  | "voice_mismatch"
  | "use_not_allowed"
  | "territory_not_allowed"
  | "required_brand_term_missing"
  | "prohibited_brand_term_present"
  | "quality_review_missing"
  | "quality_review_not_approved"
  | "quality_review_checksum_mismatch";

export class GovernanceValidationError extends Error {
  readonly statusCode = 400;
  readonly code = "GOVERNANCE_VALIDATION";
}

export class GovernanceNotFoundError extends Error {
  readonly statusCode = 404;
  readonly code = "GOVERNANCE_NOT_FOUND";
}

export class GovernanceConflictError extends Error {
  readonly statusCode = 409;
  readonly code = "GOVERNANCE_CONFLICT";
}

export class GovernanceGateError extends Error {
  readonly statusCode = 403;
  readonly code = "GOVERNANCE_GATE_DENIED";
  constructor(readonly reasons: readonly GovernanceGateReason[]) {
    super(`Governance gate denied: ${reasons.join(", ")}`);
    this.name = "GovernanceGateError";
  }
}
