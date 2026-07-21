import { z } from "zod";

export const CONSENT_BASES = ["obtained", "synthetic_not_applicable"] as const;
export const RIGHTS_BASES = ["owned", "licensed"] as const;
export const ALLOWED_USES = ["internal_preview", "organic_social", "paid_ads", "commercial"] as const;
export const QUALITY_CRITERIA = [
  "naturalMovement",
  "eyeContact",
  "speechQuality",
  "lighting",
  "realism",
  "brandConsistency",
  "verticalQuality",
] as const;
export const QUALITY_REVIEW_STATUSES = ["approved", "needs_review", "rejected"] as const;

const opaqueIdSchema = z.string().trim().min(1).max(128).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u);
const digestSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/u);
const idempotencyKeySchema = z.string().trim().min(8).max(200).regex(/^[A-Za-z0-9._:-]+$/u);
const policyTermSchema = z.string().trim().min(1).max(120);

export const brandPolicySchema = z.object({
  requiredTerms: z.array(policyTermSchema).max(50),
  prohibitedTerms: z.array(policyTermSchema).max(50),
}).strict();

export const createInfluencerGovernanceProfileRequestSchema = z.object({
  consentBasis: z.enum(CONSENT_BASES),
  rightsBasis: z.enum(RIGHTS_BASES),
  allowedUses: z.array(z.enum(ALLOWED_USES)).min(1).max(ALLOWED_USES.length),
  territories: z.array(z.string().regex(/^(?:WORLDWIDE|[A-Z]{2})$/u)).min(1).max(50),
  validFrom: z.string().datetime({ offset: true }),
  expiresAt: z.string().datetime({ offset: true }),
  policyVersion: z.string().trim().min(1).max(64).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u),
  proofDigest: digestSchema,
  brandPolicy: brandPolicySchema,
  idempotencyKey: idempotencyKeySchema,
}).strict();

export const revokeInfluencerGovernanceProfileRequestSchema = z.object({
  reason: z.string().trim().min(1).max(500),
  idempotencyKey: idempotencyKeySchema,
}).strict();

export const qualityScoresSchema = z.object({
  naturalMovement: z.number().int().min(1).max(5),
  eyeContact: z.number().int().min(1).max(5),
  speechQuality: z.number().int().min(1).max(5),
  lighting: z.number().int().min(1).max(5),
  realism: z.number().int().min(1).max(5),
  brandConsistency: z.number().int().min(1).max(5),
  verticalQuality: z.number().int().min(1).max(5),
}).strict();

export const createAssetQualityReviewRequestSchema = z.object({
  criteria: qualityScoresSchema,
  notes: z.string().trim().max(2_000).optional(),
  idempotencyKey: idempotencyKeySchema,
}).strict();

export const influencerGovernanceProfileSchema = z.object({
  id: opaqueIdSchema,
  version: z.number().int().positive(),
  consentBasis: z.enum(CONSENT_BASES),
  rightsBasis: z.enum(RIGHTS_BASES),
  allowedUses: z.array(z.enum(ALLOWED_USES)),
  territories: z.array(z.string()),
  validFrom: z.string().datetime(),
  expiresAt: z.string().datetime(),
  policyVersion: z.string(),
  brandPolicy: brandPolicySchema,
  revokedAt: z.string().datetime().nullable(),
  revocationReason: z.string().max(500).nullable(),
  createdAt: z.string().datetime(),
}).strict();

export const assetQualityReviewSchema = z.object({
  id: opaqueIdSchema,
  version: z.number().int().positive(),
  status: z.enum(QUALITY_REVIEW_STATUSES),
  criteria: qualityScoresSchema,
  notes: z.string().max(2_000).optional(),
  createdAt: z.string().datetime(),
}).strict();

export const influencerGovernanceProfileResponseSchema = z.object({ profile: influencerGovernanceProfileSchema }).strict();
export const assetQualityReviewResponseSchema = z.object({ review: assetQualityReviewSchema }).strict();

export type ConsentBasis = (typeof CONSENT_BASES)[number];
export type RightsBasis = (typeof RIGHTS_BASES)[number];
export type AllowedUse = (typeof ALLOWED_USES)[number];
export type QualityCriterion = (typeof QUALITY_CRITERIA)[number];
export type QualityReviewStatus = (typeof QUALITY_REVIEW_STATUSES)[number];
export type BrandPolicy = z.infer<typeof brandPolicySchema>;
export type QualityScores = z.infer<typeof qualityScoresSchema>;
export type CreateInfluencerGovernanceProfileRequest = z.infer<typeof createInfluencerGovernanceProfileRequestSchema>;
export type RevokeInfluencerGovernanceProfileRequest = z.infer<typeof revokeInfluencerGovernanceProfileRequestSchema>;
export type CreateAssetQualityReviewRequest = z.infer<typeof createAssetQualityReviewRequestSchema>;
export type InfluencerGovernanceProfile = z.infer<typeof influencerGovernanceProfileSchema>;
export type AssetQualityReview = z.infer<typeof assetQualityReviewSchema>;
export type InfluencerGovernanceProfileResponse = z.infer<typeof influencerGovernanceProfileResponseSchema>;
export type AssetQualityReviewResponse = z.infer<typeof assetQualityReviewResponseSchema>;
