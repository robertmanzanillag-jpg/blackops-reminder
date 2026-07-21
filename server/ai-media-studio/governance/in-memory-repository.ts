import {
  GovernanceConflictError,
  type AssetQualityReview,
  type GovernanceAppendResult,
  type GovernanceIdempotency,
  type GovernanceRepository,
  type InfluencerGovernanceProfile,
  type TenantScope,
} from "./contracts";

type IdempotencyRecord = { inputDigest: string; recordId: string };

const tenantKey = (scope: TenantScope) => JSON.stringify([scope.ownerUserId, scope.workspaceId]);
const clone = <T>(value: T): T => structuredClone(value);

export class InMemoryGovernanceRepository implements GovernanceRepository {
  private readonly profiles = new Map<string, Map<string, InfluencerGovernanceProfile>>();
  private readonly profileCurrent = new Map<string, Map<string, string>>();
  private readonly profileIdempotency = new Map<string, Map<string, IdempotencyRecord>>();
  private readonly reviews = new Map<string, Map<string, AssetQualityReview>>();
  private readonly reviewCurrent = new Map<string, Map<string, string>>();
  private readonly reviewIdempotency = new Map<string, Map<string, IdempotencyRecord>>();

  async appendProfile(
    scope: TenantScope,
    profile: InfluencerGovernanceProfile,
    idempotency: GovernanceIdempotency,
  ): Promise<GovernanceAppendResult<InfluencerGovernanceProfile>> {
    this.assertRecordScope(scope, profile);
    const replay = this.replay(this.profileIdempotency, this.profiles, scope, idempotency);
    if (replay) return { record: clone(replay), created: false };
    const records = this.bucket(this.profiles, scope);
    if (records.has(profile.id)) throw new GovernanceConflictError("Governance profile id already exists");
    const currentIds = this.bucket(this.profileCurrent, scope);
    const currentId = currentIds.get(profile.influencerId);
    const current = currentId ? records.get(currentId) : undefined;
    if (profile.previousProfileId !== (current?.id ?? null) || profile.version !== (current?.version ?? 0) + 1) {
      throw new GovernanceConflictError("Governance profile does not extend the current append-only chain");
    }
    records.set(profile.id, clone(profile));
    currentIds.set(profile.influencerId, profile.id);
    this.remember(this.profileIdempotency, scope, idempotency, profile.id);
    return { record: clone(profile), created: true };
  }

  async getProfile(scope: TenantScope, profileId: string) {
    const record = this.profiles.get(tenantKey(scope))?.get(profileId);
    return record ? clone(record) : undefined;
  }

  async getCurrentProfile(scope: TenantScope, influencerId: string) {
    const id = this.profileCurrent.get(tenantKey(scope))?.get(influencerId);
    return id ? this.getProfile(scope, id) : undefined;
  }

  async listProfiles(scope: TenantScope, influencerId: string) {
    return [...(this.profiles.get(tenantKey(scope))?.values() ?? [])]
      .filter((record) => record.influencerId === influencerId)
      .sort((left, right) => left.version - right.version)
      .map(clone);
  }

  async appendReview(
    scope: TenantScope,
    review: AssetQualityReview,
    idempotency: GovernanceIdempotency,
  ): Promise<GovernanceAppendResult<AssetQualityReview>> {
    this.assertRecordScope(scope, review);
    const replay = this.replay(this.reviewIdempotency, this.reviews, scope, idempotency);
    if (replay) return { record: clone(replay), created: false };
    const records = this.bucket(this.reviews, scope);
    if (records.has(review.id)) throw new GovernanceConflictError("Quality review id already exists");
    const currentIds = this.bucket(this.reviewCurrent, scope);
    const currentId = currentIds.get(review.assetId);
    const current = currentId ? records.get(currentId) : undefined;
    if (review.previousReviewId !== (current?.id ?? null) || review.version !== (current?.version ?? 0) + 1) {
      throw new GovernanceConflictError("Quality review does not extend the current append-only chain");
    }
    records.set(review.id, clone(review));
    currentIds.set(review.assetId, review.id);
    this.remember(this.reviewIdempotency, scope, idempotency, review.id);
    return { record: clone(review), created: true };
  }

  async getReview(scope: TenantScope, reviewId: string) {
    const record = this.reviews.get(tenantKey(scope))?.get(reviewId);
    return record ? clone(record) : undefined;
  }

  async getCurrentReview(scope: TenantScope, assetId: string) {
    const id = this.reviewCurrent.get(tenantKey(scope))?.get(assetId);
    return id ? this.getReview(scope, id) : undefined;
  }

  async listReviews(scope: TenantScope, assetId: string) {
    return [...(this.reviews.get(tenantKey(scope))?.values() ?? [])]
      .filter((record) => record.assetId === assetId)
      .sort((left, right) => left.version - right.version)
      .map(clone);
  }

  private bucket<T>(store: Map<string, Map<string, T>>, scope: TenantScope): Map<string, T> {
    const key = tenantKey(scope);
    const existing = store.get(key);
    if (existing) return existing;
    const created = new Map<string, T>();
    store.set(key, created);
    return created;
  }

  private assertRecordScope(scope: TenantScope, record: { ownerUserId: string; workspaceId: string }): void {
    if (record.ownerUserId !== scope.ownerUserId || record.workspaceId !== scope.workspaceId) {
      throw new GovernanceConflictError("Governance record tenant does not match repository scope");
    }
  }

  private replay<T>(
    idempotencyStore: Map<string, Map<string, IdempotencyRecord>>,
    recordStore: Map<string, Map<string, T>>,
    scope: TenantScope,
    idempotency: GovernanceIdempotency,
  ): T | undefined {
    const prior = idempotencyStore.get(tenantKey(scope))?.get(idempotency.key);
    if (!prior) return undefined;
    if (prior.inputDigest !== idempotency.inputDigest) {
      throw new GovernanceConflictError("Idempotency key was already used for different governance input");
    }
    const record = recordStore.get(tenantKey(scope))?.get(prior.recordId);
    if (!record) throw new GovernanceConflictError("Idempotency record points to missing governance evidence");
    return record;
  }

  private remember(
    store: Map<string, Map<string, IdempotencyRecord>>,
    scope: TenantScope,
    idempotency: GovernanceIdempotency,
    recordId: string,
  ): void {
    this.bucket(store, scope).set(idempotency.key, { inputDigest: idempotency.inputDigest, recordId });
  }
}
