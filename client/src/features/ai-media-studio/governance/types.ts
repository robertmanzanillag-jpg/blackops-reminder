import { ALLOWED_USES, CONSENT_BASES, QUALITY_CRITERIA, RIGHTS_BASES } from "@shared/ai-media-studio-governance";
import type {
  AllowedUse,
  AssetQualityReview,
  ConsentBasis,
  CreateAssetQualityReviewRequest,
  CreateInfluencerGovernanceProfileRequest,
  InfluencerGovernanceProfile,
  QualityCriterion,
  QualityReviewStatus,
  QualityScores,
  RightsBasis,
} from "@shared/ai-media-studio-governance";

export const allowedUses = ALLOWED_USES;
export const consentBases = CONSENT_BASES;
export const rightsBases = RIGHTS_BASES;
export const qualityScoreKeys = QUALITY_CRITERIA;
export type {
  AllowedUse,
  AssetQualityReview,
  ConsentBasis,
  CreateAssetQualityReviewRequest as CreateAssetQualityReview,
  InfluencerGovernanceProfile,
  QualityCriterion as QualityScoreKey,
  QualityReviewStatus as QualityDecision,
  QualityScores,
  RightsBasis,
};
export type CreateInfluencerGovernanceProfile = CreateInfluencerGovernanceProfileRequest & { proofDigest: string };

export function commaSeparated(value: string): string[] {
  return Array.from(new Set(value.split(",").map((item) => item.trim()).filter(Boolean)));
}

export function idempotencyKey(prefix: string): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? `${prefix}-${crypto.randomUUID()}`
    : `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function isSha256Digest(value: string): boolean {
  return /^sha256:[a-f0-9]{64}$/.test(value.trim());
}
