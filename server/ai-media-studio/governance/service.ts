import { createHash, randomUUID } from "node:crypto";
import {
  ALLOWED_USES,
  QUALITY_CRITERIA,
  createAssetQualityReviewRequestSchema,
  createInfluencerGovernanceProfileRequestSchema,
  revokeInfluencerGovernanceProfileRequestSchema,
  type AssetQualityReview as PublicAssetQualityReview,
  type CreateAssetQualityReviewRequest,
  type CreateInfluencerGovernanceProfileRequest,
  type InfluencerGovernanceProfile as PublicInfluencerGovernanceProfile,
  type QualityReviewStatus,
  type QualityScores,
  type RevokeInfluencerGovernanceProfileRequest,
} from "../../../shared/ai-media-studio-governance";
import {
  GovernanceGateError,
  GovernanceNotFoundError,
  GovernanceValidationError,
  type AssetQualityReview,
  type GovernanceGateReason,
  type GovernanceProfileBinding,
  type GovernanceRepository,
  type InfluencerGovernanceProfile,
  type PublishGovernanceGateInput,
  type QualityReviewBinding,
  type RenderGovernanceGateInput,
  type TenantScope,
} from "./contracts";

export interface GovernanceServiceOptions {
  now?: () => Date;
  idFactory?: () => string;
}

export class GovernanceService {
  private readonly now: () => Date;
  private readonly idFactory: () => string;

  constructor(private readonly repository: GovernanceRepository, options: GovernanceServiceOptions = {}) {
    this.now = options.now ?? (() => new Date());
    this.idFactory = options.idFactory ?? randomUUID;
  }

  async createProfile(
    scopeInput: TenantScope,
    actorUserIdInput: string,
    bindingInput: GovernanceProfileBinding,
    requestInput: CreateInfluencerGovernanceProfileRequest,
  ): Promise<InfluencerGovernanceProfile> {
    const scope = validScope(scopeInput);
    const actorUserId = opaqueServerId(actorUserIdInput, "actorUserId");
    const binding = validProfileBinding(bindingInput);
    const request = parsePublic(createInfluencerGovernanceProfileRequestSchema, requestInput);
    const proofDigest = prefixedSha256(request.proofDigest, "proofDigest");
    const validFrom = normalizeInstant(request.validFrom);
    const expiresAt = normalizeInstant(request.expiresAt);
    if (Date.parse(expiresAt) <= Date.parse(validFrom)) throw new GovernanceValidationError("expiresAt must be after validFrom");
    const allowedUses = uniqueSorted(request.allowedUses);
    const territories = uniqueSorted(request.territories);
    if (territories.includes("WORLDWIDE") && territories.length !== 1) {
      throw new GovernanceValidationError("WORLDWIDE cannot be combined with individual territories");
    }
    const brandPolicy = canonicalBrandPolicy(request.brandPolicy);
    const current = await this.repository.getCurrentProfile(scope, binding.influencerId);
    const createdAt = this.now().toISOString();
    const inputDigest = governanceDigest({
      operation: "create_profile", scope, actorUserId, binding, ...request,
      validFrom, expiresAt, allowedUses, territories, brandPolicy, idempotencyKey: undefined,
    });
    const profileWithoutDigest: Omit<InfluencerGovernanceProfile, "evidenceDigest"> = {
      id: this.idFactory(),
      ...scope,
      ...binding,
      version: (current?.version ?? 0) + 1,
      consentBasis: request.consentBasis,
      rightsBasis: request.rightsBasis,
      allowedUses,
      territories,
      validFrom,
      expiresAt,
      policyVersion: request.policyVersion,
      proofDigest,
      brandPolicy,
      previousProfileId: current?.id ?? null,
      revokedAt: null,
      revocationReason: null,
      createdByUserId: actorUserId,
      createdAt,
    };
    const profile: InfluencerGovernanceProfile = {
      ...profileWithoutDigest,
      evidenceDigest: governanceDigest(profileWithoutDigest),
    };
    return (await this.repository.appendProfile(scope, profile, { key: request.idempotencyKey, inputDigest })).record;
  }

  async revokeProfile(
    scopeInput: TenantScope,
    actorUserIdInput: string,
    influencerIdInput: string,
    requestInput: RevokeInfluencerGovernanceProfileRequest,
  ): Promise<InfluencerGovernanceProfile> {
    const scope = validScope(scopeInput);
    const actorUserId = opaqueServerId(actorUserIdInput, "actorUserId");
    const influencerId = opaqueServerId(influencerIdInput, "influencerId");
    const request = parsePublic(revokeInfluencerGovernanceProfileRequestSchema, requestInput);
    const current = await this.repository.getCurrentProfile(scope, influencerId);
    if (!current) throw new GovernanceNotFoundError("Influencer governance profile not found");
    const inputDigest = governanceDigest({ operation: "revoke_profile", scope, actorUserId, influencerId, reason: request.reason });
    if (current.revokedAt) {
      // Repository idempotency is checked before duplicate-id/chain validation. Passing the
      // immutable current record therefore replays the original revocation for the same key,
      // while every new key fails closed instead of creating redundant revoked revisions.
      return (await this.repository.appendProfile(scope, current, { key: request.idempotencyKey, inputDigest })).record;
    }
    const createdAt = this.now().toISOString();
    const profileWithoutDigest: Omit<InfluencerGovernanceProfile, "evidenceDigest"> = {
      ...current,
      id: this.idFactory(),
      version: current.version + 1,
      previousProfileId: current.id,
      revokedAt: createdAt,
      revocationReason: request.reason,
      createdByUserId: actorUserId,
      createdAt,
    };
    const profile = { ...profileWithoutDigest, evidenceDigest: governanceDigest(profileWithoutDigest) };
    return (await this.repository.appendProfile(scope, profile, { key: request.idempotencyKey, inputDigest })).record;
  }

  async createQualityReview(
    scopeInput: TenantScope,
    actorUserIdInput: string,
    bindingInput: QualityReviewBinding,
    requestInput: CreateAssetQualityReviewRequest,
  ): Promise<AssetQualityReview> {
    const scope = validScope(scopeInput);
    const actorUserId = opaqueServerId(actorUserIdInput, "actorUserId");
    const binding = validReviewBinding(bindingInput);
    const request = parsePublic(createAssetQualityReviewRequestSchema, requestInput);
    const current = await this.repository.getCurrentReview(scope, binding.assetId);
    const createdAt = this.now().toISOString();
    const inputDigest = governanceDigest({ operation: "create_quality_review", scope, actorUserId, binding, ...request, idempotencyKey: undefined });
    const reviewWithoutDigest: Omit<AssetQualityReview, "evidenceDigest"> = {
      id: this.idFactory(),
      ...scope,
      ...binding,
      version: (current?.version ?? 0) + 1,
      criteria: { ...request.criteria },
      status: deriveQualityReviewStatus(request.criteria),
      ...(request.notes !== undefined ? { notes: request.notes } : {}),
      previousReviewId: current?.id ?? null,
      reviewedByUserId: actorUserId,
      createdAt,
    };
    const review = { ...reviewWithoutDigest, evidenceDigest: governanceDigest(reviewWithoutDigest) };
    return (await this.repository.appendReview(scope, review, { key: request.idempotencyKey, inputDigest })).record;
  }

  getCurrentProfile(scope: TenantScope, influencerId: string) {
    return this.repository.getCurrentProfile(validScope(scope), opaqueServerId(influencerId, "influencerId"));
  }

  listProfiles(scope: TenantScope, influencerId: string) {
    return this.repository.listProfiles(validScope(scope), opaqueServerId(influencerId, "influencerId"));
  }

  getCurrentReview(scope: TenantScope, assetId: string) {
    return this.repository.getCurrentReview(validScope(scope), opaqueServerId(assetId, "assetId"));
  }

  listReviews(scope: TenantScope, assetId: string) {
    return this.repository.listReviews(validScope(scope), opaqueServerId(assetId, "assetId"));
  }

  async assertRenderAllowed(scopeInput: TenantScope, input: RenderGovernanceGateInput): Promise<InfluencerGovernanceProfile> {
    const scope = validScope(scopeInput);
    const gate = validRenderGate(input);
    const profile = await this.repository.getCurrentProfile(scope, gate.influencerId);
    const reasons = profileGateReasons(profile, gate, this.now());
    if (!profile || reasons.length > 0) throw new GovernanceGateError(reasons);
    return profile;
  }

  async assertPublishAllowed(
    scopeInput: TenantScope,
    input: PublishGovernanceGateInput,
  ): Promise<{ profile: InfluencerGovernanceProfile; review: AssetQualityReview }> {
    const scope = validScope(scopeInput);
    const gate = { ...validRenderGate(input), ...validReviewBinding(input) };
    const [profile, review] = await Promise.all([
      this.repository.getCurrentProfile(scope, gate.influencerId),
      this.repository.getCurrentReview(scope, gate.assetId),
    ]);
    const reasons = profileGateReasons(profile, gate, this.now());
    if (!review) reasons.push("quality_review_missing");
    else {
      if (review.assetChecksum !== gate.assetChecksum) reasons.push("quality_review_checksum_mismatch");
      if (review.status !== "approved") reasons.push("quality_review_not_approved");
    }
    if (!profile || !review || reasons.length > 0) throw new GovernanceGateError(unique(reasons));
    return { profile, review };
  }
}

export function deriveQualityReviewStatus(scores: QualityScores): QualityReviewStatus {
  const values = QUALITY_CRITERIA.map((criterion) => scores[criterion]);
  if (values.some((score) => score <= 2)) return "rejected";
  if (values.every((score) => score >= 4)) return "approved";
  return "needs_review";
}

export function governanceDigest(value: unknown): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(JSON.stringify(canonicalJson(value))).digest("hex")}`;
}

export function toPublicInfluencerGovernanceProfile(profile: InfluencerGovernanceProfile): PublicInfluencerGovernanceProfile {
  return {
    id: profile.id, version: profile.version, consentBasis: profile.consentBasis, rightsBasis: profile.rightsBasis,
    allowedUses: [...profile.allowedUses], territories: [...profile.territories], validFrom: profile.validFrom,
    expiresAt: profile.expiresAt, policyVersion: profile.policyVersion, brandPolicy: structuredClone(profile.brandPolicy),
    revokedAt: profile.revokedAt, revocationReason: profile.revocationReason, createdAt: profile.createdAt,
  };
}

export function toPublicAssetQualityReview(review: AssetQualityReview): PublicAssetQualityReview {
  return {
    id: review.id, version: review.version, status: review.status, criteria: { ...review.criteria },
    ...(review.notes !== undefined ? { notes: review.notes } : {}), createdAt: review.createdAt,
  };
}

function profileGateReasons(
  profile: InfluencerGovernanceProfile | undefined,
  input: RenderGovernanceGateInput,
  now: Date,
): GovernanceGateReason[] {
  if (!profile) return ["profile_missing"];
  const reasons: GovernanceGateReason[] = [];
  const instant = now.getTime();
  if (profile.revokedAt) reasons.push("profile_revoked");
  if (instant < Date.parse(profile.validFrom)) reasons.push("profile_not_yet_valid");
  if (instant >= Date.parse(profile.expiresAt)) reasons.push("profile_expired");
  if (profile.avatarId !== input.avatarId) reasons.push("avatar_mismatch");
  if (profile.voiceId !== input.voiceId) reasons.push("voice_mismatch");
  if (!profile.allowedUses.includes(input.use)) reasons.push("use_not_allowed");
  if (input.use !== "internal_preview"
    && !profile.territories.includes("WORLDWIDE")
    && !profile.territories.includes(input.territory)) {
    reasons.push("territory_not_allowed");
  }
  const content = normalizedText(input.content);
  for (const term of profile.brandPolicy.requiredTerms) {
    if (!content.includes(normalizedText(term))) reasons.push("required_brand_term_missing");
  }
  for (const term of profile.brandPolicy.prohibitedTerms) {
    if (content.includes(normalizedText(term))) reasons.push("prohibited_brand_term_present");
  }
  return unique(reasons);
}

function validScope(scope: TenantScope): TenantScope {
  return { ownerUserId: opaqueServerId(scope.ownerUserId, "ownerUserId"), workspaceId: opaqueServerId(scope.workspaceId, "workspaceId") };
}

function validProfileBinding(binding: GovernanceProfileBinding): GovernanceProfileBinding {
  return {
    influencerId: opaqueServerId(binding.influencerId, "influencerId"),
    avatarId: opaqueServerId(binding.avatarId, "avatarId"),
    voiceId: opaqueServerId(binding.voiceId, "voiceId"),
  };
}

function validReviewBinding(binding: QualityReviewBinding): QualityReviewBinding {
  return { assetId: opaqueServerId(binding.assetId, "assetId"), assetChecksum: rawSha256(binding.assetChecksum) };
}

function validRenderGate(input: RenderGovernanceGateInput): RenderGovernanceGateInput {
  if (!ALLOWED_USES.includes(input.use)) throw new GovernanceValidationError("Unsupported governance use");
  if (!/^(?:WORLDWIDE|[A-Z]{2})$/u.test(input.territory)) throw new GovernanceValidationError("Invalid territory");
  if (typeof input.content !== "string" || input.content.length > 20_000) throw new GovernanceValidationError("Invalid governed content");
  return { ...validProfileBinding(input), use: input.use, territory: input.territory, content: input.content };
}

function canonicalBrandPolicy(policy: { requiredTerms: string[]; prohibitedTerms: string[] }) {
  const requiredTerms = uniqueSorted(policy.requiredTerms.map((term) => term.trim()));
  const prohibitedTerms = uniqueSorted(policy.prohibitedTerms.map((term) => term.trim()));
  const prohibitedNormalized = new Set(prohibitedTerms.map(normalizedText));
  if (requiredTerms.some((term) => prohibitedNormalized.has(normalizedText(term)))) {
    throw new GovernanceValidationError("A brand term cannot be both required and prohibited");
  }
  return { requiredTerms, prohibitedTerms };
}

function normalizeInstant(value: string): string {
  const time = Date.parse(value);
  if (!Number.isFinite(time)) throw new GovernanceValidationError("A valid ISO-8601 instant is required");
  return new Date(time).toISOString();
}

function opaqueServerId(value: string, field: string): string {
  if (typeof value !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/u.test(value)) {
    throw new GovernanceValidationError(`${field} is invalid`);
  }
  return value;
}

function rawSha256(value: string): string {
  if (!/^[a-f0-9]{64}$/u.test(value)) throw new GovernanceValidationError("assetChecksum must be raw lowercase SHA-256 hex");
  return value;
}

function prefixedSha256(value: string, field: string): `sha256:${string}` {
  if (!/^sha256:[a-f0-9]{64}$/u.test(value)) throw new GovernanceValidationError(`${field} must be a SHA-256 digest`);
  return value as `sha256:${string}`;
}

function normalizedText(value: string): string { return value.normalize("NFKC").toLocaleLowerCase("en-US"); }
function unique<T>(values: T[]): T[] { return [...new Set(values)]; }
function uniqueSorted<T extends string>(values: readonly T[]): T[] { return [...new Set(values)].sort(); }

function canonicalJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalJson);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, canonicalJson(entry)]));
  }
  return value;
}

function parsePublic<T>(schema: { parse(value: unknown): T }, input: unknown): T {
  try { return schema.parse(input); }
  catch { throw new GovernanceValidationError("Invalid public governance request"); }
}
