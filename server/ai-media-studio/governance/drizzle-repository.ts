import { sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import {
  aiMediaGovernanceProfiles,
  aiMediaInfluencers,
  aiMediaMediaAssets,
  aiMediaProviderResources,
  aiMediaQualityReviews,
} from "../../../shared/models/ai-media-studio-db";
import {
  GovernanceConflictError,
  GovernanceNotFoundError,
  type AssetQualityReview,
  type GovernanceIdempotency,
  type GovernanceRepository,
  type InfluencerGovernanceProfile,
  type TenantScope,
} from "./contracts";
import { governanceProfileLockKey } from "../planning/authority-locks";

export type GovernanceDatabase = Pick<NodePgDatabase, "execute" | "transaction">;
type GovernanceExecutor = Pick<NodePgDatabase, "execute">;
type RawRow = Record<string, unknown>;

function rows(result: unknown): RawRow[] {
  if (Array.isArray(result)) return result as RawRow[];
  if (result && typeof result === "object" && Array.isArray((result as { rows?: unknown }).rows)) {
    return (result as { rows: RawRow[] }).rows;
  }
  return [];
}

function value(row: RawRow, camel: string, snake: string): unknown {
  return row[camel] ?? row[snake];
}

function iso(input: unknown): string {
  return input instanceof Date ? input.toISOString() : new Date(String(input)).toISOString();
}

function nullableIso(input: unknown): string | null {
  return input === null || input === undefined ? null : iso(input);
}

function mapProfile(row: RawRow): InfluencerGovernanceProfile {
  return {
    id: String(row.id),
    ownerUserId: String(value(row, "ownerUserId", "owner_user_id")),
    workspaceId: String(value(row, "workspaceId", "workspace_id")),
    influencerId: String(value(row, "influencerId", "influencer_id")),
    avatarId: String(value(row, "avatarResourceId", "avatar_resource_id")),
    voiceId: String(value(row, "voiceResourceId", "voice_resource_id")),
    consentBasis: String(value(row, "consentBasis", "consent_basis")) as InfluencerGovernanceProfile["consentBasis"],
    rightsBasis: String(value(row, "rightsBasis", "rights_basis")) as InfluencerGovernanceProfile["rightsBasis"],
    allowedUses: [...(value(row, "allowedUses", "allowed_uses") as InfluencerGovernanceProfile["allowedUses"])],
    territories: [...(row.territories as string[])],
    validFrom: iso(value(row, "validFrom", "valid_from")),
    expiresAt: iso(value(row, "expiresAt", "expires_at")),
    proofDigest: String(value(row, "proofDigest", "proof_digest")) as InfluencerGovernanceProfile["proofDigest"],
    brandPolicy: { ...(value(row, "brandPolicy", "brand_policy") as InfluencerGovernanceProfile["brandPolicy"]) },
    version: Number(row.version),
    policyVersion: String(value(row, "policyVersion", "policy_version")),
    evidenceDigest: String(value(row, "evidenceDigest", "evidence_digest")) as InfluencerGovernanceProfile["evidenceDigest"],
    previousProfileId: value(row, "previousProfileId", "previous_profile_id") === null
      ? null
      : String(value(row, "previousProfileId", "previous_profile_id")),
    revokedAt: nullableIso(value(row, "revokedAt", "revoked_at")),
    revocationReason: value(row, "revocationReason", "revocation_reason") === null
      ? null
      : String(value(row, "revocationReason", "revocation_reason")),
    createdByUserId: String(value(row, "actorUserId", "actor_user_id")),
    createdAt: iso(value(row, "createdAt", "created_at")),
  };
}

function mapReview(row: RawRow): AssetQualityReview {
  const notes = row.notes;
  return {
    id: String(row.id),
    ownerUserId: String(value(row, "ownerUserId", "owner_user_id")),
    workspaceId: String(value(row, "workspaceId", "workspace_id")),
    assetId: String(value(row, "mediaAssetId", "media_asset_id")),
    assetChecksum: String(value(row, "assetChecksum", "asset_checksum")) as AssetQualityReview["assetChecksum"],
    criteria: { ...(row.criteria as AssetQualityReview["criteria"]) },
    ...(notes === null || notes === undefined ? {} : { notes: String(notes) }),
    version: Number(row.version),
    status: String(row.decision) as AssetQualityReview["status"],
    evidenceDigest: String(value(row, "evidenceDigest", "evidence_digest")) as AssetQualityReview["evidenceDigest"],
    previousReviewId: value(row, "previousReviewId", "previous_review_id") === null
      ? null
      : String(value(row, "previousReviewId", "previous_review_id")),
    reviewedByUserId: String(value(row, "actorUserId", "actor_user_id")),
    createdAt: iso(value(row, "createdAt", "created_at")),
  };
}

async function lockSubject(
  tx: GovernanceExecutor,
  kind: "profile" | "review",
  scope: TenantScope,
  subjectId: string,
): Promise<void> {
  const lockKey = kind === "profile"
    ? governanceProfileLockKey(scope, subjectId)
    : `ai-media-governance:review:${scope.ownerUserId}:${scope.workspaceId}:${subjectId}`;
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`);
}

function assertIdempotencyDigest(row: RawRow, idempotency: GovernanceIdempotency): void {
  if (String(value(row, "inputDigest", "input_digest")) !== idempotency.inputDigest) {
    throw new GovernanceConflictError("Idempotency key is already bound to a different governance payload");
  }
}

function assertRecordScope(scope: TenantScope, record: { ownerUserId: string; workspaceId: string }): void {
  if (record.ownerUserId !== scope.ownerUserId || record.workspaceId !== scope.workspaceId) {
    throw new GovernanceConflictError("Governance record tenant does not match the requested scope");
  }
}

/** PostgreSQL-backed, immutable governance evidence repository. */
export class DrizzleGovernanceRepository implements GovernanceRepository {
  constructor(private readonly db: GovernanceDatabase) {}

  async appendProfile(
    scope: TenantScope,
    profile: InfluencerGovernanceProfile,
    idempotency: GovernanceIdempotency,
  ): Promise<{ record: InfluencerGovernanceProfile; created: boolean }> {
    assertRecordScope(scope, profile);
    return this.db.transaction(async (tx) => {
      await lockSubject(tx, "profile", scope, profile.influencerId);
      const replay = await this.profileByIdempotency(tx, scope, idempotency.key);
      if (replay) {
        assertIdempotencyDigest(replay, idempotency);
        return { record: mapProfile(replay), created: false };
      }

      const ownership = rows(await tx.execute(sql`
        SELECT i.id
        FROM ${aiMediaInfluencers} i
        JOIN ${aiMediaProviderResources} avatar
          ON avatar.id = ${profile.avatarId}
         AND avatar.owner_user_id = ${scope.ownerUserId}
         AND avatar.workspace_id = ${scope.workspaceId}
         AND avatar.resource_type = 'avatar'
         AND avatar.status = 'active'
        JOIN ${aiMediaProviderResources} voice
          ON voice.id = ${profile.voiceId}
         AND voice.owner_user_id = ${scope.ownerUserId}
         AND voice.workspace_id = ${scope.workspaceId}
         AND voice.resource_type = 'voice'
         AND voice.status = 'active'
        WHERE i.id = ${profile.influencerId}
          AND i.owner_user_id = ${scope.ownerUserId}
          AND i.workspace_id = ${scope.workspaceId}
          AND i.default_avatar_resource_id = ${profile.avatarId}
          AND i.default_voice_resource_id = ${profile.voiceId}
        LIMIT 1
      `))[0];
      if (!ownership) throw new GovernanceNotFoundError("Governance profile subjects are not owned by this tenant");

      const previous = rows(await tx.execute(sql`
        SELECT * FROM ${aiMediaGovernanceProfiles}
        WHERE owner_user_id = ${scope.ownerUserId}
          AND workspace_id = ${scope.workspaceId}
          AND influencer_id = ${profile.influencerId}
        ORDER BY version DESC, created_at DESC, id DESC
        LIMIT 1 FOR UPDATE
      `))[0];
      const expectedPreviousId = previous ? String(previous.id) : null;
      const expectedVersion = previous ? Number(previous.version) + 1 : 1;
      if (profile.previousProfileId !== expectedPreviousId || profile.version !== expectedVersion) {
        throw new GovernanceConflictError("Governance profile revision does not extend the current tenant chain");
      }

      const inserted = rows(await tx.execute(sql`
        INSERT INTO ${aiMediaGovernanceProfiles}
          (id, owner_user_id, workspace_id, influencer_id, avatar_resource_id, voice_resource_id,
           state, consent_basis, rights_basis, allowed_uses, territories, proof_digest, evidence_digest,
           brand_policy, version, policy_version, actor_user_id, valid_from, expires_at, revoked_at,
           revocation_reason, previous_profile_id, idempotency_key, input_digest, created_at, updated_at)
        VALUES
          (${profile.id}, ${scope.ownerUserId}, ${scope.workspaceId}, ${profile.influencerId}, ${profile.avatarId}, ${profile.voiceId},
           ${profile.revokedAt ? "revoked" : "active"}, ${profile.consentBasis}, ${profile.rightsBasis},
           ${JSON.stringify(profile.allowedUses)}::jsonb, ${JSON.stringify(profile.territories)}::jsonb,
           ${profile.proofDigest}, ${profile.evidenceDigest}, ${JSON.stringify(profile.brandPolicy)}::jsonb,
           ${profile.version}, ${profile.policyVersion}, ${profile.createdByUserId}, ${new Date(profile.validFrom)}, ${new Date(profile.expiresAt)},
           ${profile.revokedAt ? new Date(profile.revokedAt) : null}, ${profile.revocationReason}, ${profile.previousProfileId},
           ${idempotency.key}, ${idempotency.inputDigest}, ${new Date(profile.createdAt)}, ${new Date(profile.createdAt)})
        ON CONFLICT (owner_user_id, workspace_id, idempotency_key) DO NOTHING
        RETURNING *
      `))[0];
      if (inserted) return { record: mapProfile(inserted), created: true };
      const raced = await this.profileByIdempotency(tx, scope, idempotency.key);
      if (!raced) throw new GovernanceConflictError("Governance profile append lost its idempotency conflict");
      assertIdempotencyDigest(raced, idempotency);
      return { record: mapProfile(raced), created: false };
    });
  }

  async getProfile(scope: TenantScope, profileId: string): Promise<InfluencerGovernanceProfile | undefined> {
    const row = rows(await this.db.execute(sql`SELECT * FROM ${aiMediaGovernanceProfiles} WHERE id = ${profileId} AND owner_user_id = ${scope.ownerUserId} AND workspace_id = ${scope.workspaceId} LIMIT 1`))[0];
    return row ? mapProfile(row) : undefined;
  }

  async getCurrentProfile(scope: TenantScope, influencerId: string): Promise<InfluencerGovernanceProfile | undefined> {
    const row = rows(await this.db.execute(sql`SELECT * FROM ${aiMediaGovernanceProfiles} WHERE owner_user_id = ${scope.ownerUserId} AND workspace_id = ${scope.workspaceId} AND influencer_id = ${influencerId} ORDER BY version DESC, created_at DESC, id DESC LIMIT 1`))[0];
    return row ? mapProfile(row) : undefined;
  }

  async listProfiles(scope: TenantScope, influencerId: string): Promise<InfluencerGovernanceProfile[]> {
    return rows(await this.db.execute(sql`SELECT * FROM ${aiMediaGovernanceProfiles} WHERE owner_user_id = ${scope.ownerUserId} AND workspace_id = ${scope.workspaceId} AND influencer_id = ${influencerId} ORDER BY version ASC, created_at ASC, id ASC`)).map(mapProfile);
  }

  async appendReview(
    scope: TenantScope,
    review: AssetQualityReview,
    idempotency: GovernanceIdempotency,
  ): Promise<{ record: AssetQualityReview; created: boolean }> {
    assertRecordScope(scope, review);
    return this.db.transaction(async (tx) => {
      await lockSubject(tx, "review", scope, review.assetId);
      const replay = await this.reviewByIdempotency(tx, scope, idempotency.key);
      if (replay) {
        assertIdempotencyDigest(replay, idempotency);
        return { record: mapReview(replay), created: false };
      }

      const ownership = rows(await tx.execute(sql`
        SELECT id FROM ${aiMediaMediaAssets}
        WHERE id = ${review.assetId}
          AND checksum = ${review.assetChecksum}
          AND owner_user_id = ${scope.ownerUserId}
          AND workspace_id = ${scope.workspaceId}
          AND kind = 'video'
          AND status = 'ready'
          AND deleted_at IS NULL
        LIMIT 1
      `))[0];
      if (!ownership) throw new GovernanceNotFoundError("Quality review asset/checksum is not owned by this tenant");

      const previous = rows(await tx.execute(sql`
        SELECT * FROM ${aiMediaQualityReviews}
        WHERE owner_user_id = ${scope.ownerUserId}
          AND workspace_id = ${scope.workspaceId}
          AND media_asset_id = ${review.assetId}
        ORDER BY version DESC, created_at DESC, id DESC
        LIMIT 1 FOR UPDATE
      `))[0];
      const expectedPreviousId = previous ? String(previous.id) : null;
      const expectedVersion = previous ? Number(previous.version) + 1 : 1;
      if (review.previousReviewId !== expectedPreviousId || review.version !== expectedVersion) {
        throw new GovernanceConflictError("Quality review revision does not extend the current tenant chain");
      }

      const inserted = rows(await tx.execute(sql`
        INSERT INTO ${aiMediaQualityReviews}
          (id, owner_user_id, workspace_id, media_asset_id, asset_checksum, evaluator_type, decision,
           version, criteria, notes, evidence_digest, actor_user_id, previous_review_id, idempotency_key,
           input_digest, created_at, updated_at)
        VALUES
          (${review.id}, ${scope.ownerUserId}, ${scope.workspaceId}, ${review.assetId}, ${review.assetChecksum},
           'human', ${review.status}, ${review.version}, ${JSON.stringify(review.criteria)}::jsonb, ${review.notes ?? null},
           ${review.evidenceDigest}, ${review.reviewedByUserId}, ${review.previousReviewId}, ${idempotency.key},
           ${idempotency.inputDigest}, ${new Date(review.createdAt)}, ${new Date(review.createdAt)})
        ON CONFLICT (owner_user_id, workspace_id, idempotency_key) DO NOTHING
        RETURNING *
      `))[0];
      if (inserted) return { record: mapReview(inserted), created: true };
      const raced = await this.reviewByIdempotency(tx, scope, idempotency.key);
      if (!raced) throw new GovernanceConflictError("Quality review append lost its idempotency conflict");
      assertIdempotencyDigest(raced, idempotency);
      return { record: mapReview(raced), created: false };
    });
  }

  async getReview(scope: TenantScope, reviewId: string): Promise<AssetQualityReview | undefined> {
    const row = rows(await this.db.execute(sql`SELECT * FROM ${aiMediaQualityReviews} WHERE id = ${reviewId} AND owner_user_id = ${scope.ownerUserId} AND workspace_id = ${scope.workspaceId} LIMIT 1`))[0];
    return row ? mapReview(row) : undefined;
  }

  async getCurrentReview(scope: TenantScope, assetId: string): Promise<AssetQualityReview | undefined> {
    const row = rows(await this.db.execute(sql`SELECT * FROM ${aiMediaQualityReviews} WHERE owner_user_id = ${scope.ownerUserId} AND workspace_id = ${scope.workspaceId} AND media_asset_id = ${assetId} ORDER BY version DESC, created_at DESC, id DESC LIMIT 1`))[0];
    return row ? mapReview(row) : undefined;
  }

  async listReviews(scope: TenantScope, assetId: string): Promise<AssetQualityReview[]> {
    return rows(await this.db.execute(sql`SELECT * FROM ${aiMediaQualityReviews} WHERE owner_user_id = ${scope.ownerUserId} AND workspace_id = ${scope.workspaceId} AND media_asset_id = ${assetId} ORDER BY version ASC, created_at ASC, id ASC`)).map(mapReview);
  }

  private async profileByIdempotency(tx: GovernanceExecutor, scope: TenantScope, key: string): Promise<RawRow | undefined> {
    return rows(await tx.execute(sql`SELECT * FROM ${aiMediaGovernanceProfiles} WHERE owner_user_id = ${scope.ownerUserId} AND workspace_id = ${scope.workspaceId} AND idempotency_key = ${key} LIMIT 1 FOR UPDATE`))[0];
  }

  private async reviewByIdempotency(tx: GovernanceExecutor, scope: TenantScope, key: string): Promise<RawRow | undefined> {
    return rows(await tx.execute(sql`SELECT * FROM ${aiMediaQualityReviews} WHERE owner_user_id = ${scope.ownerUserId} AND workspace_id = ${scope.workspaceId} AND idempotency_key = ${key} LIMIT 1 FOR UPDATE`))[0];
  }
}
