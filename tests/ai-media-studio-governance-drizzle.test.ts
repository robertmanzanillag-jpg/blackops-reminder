import assert from "node:assert/strict";
import test from "node:test";
import { PgDialect } from "drizzle-orm/pg-core";
import { GovernanceConflictError } from "../server/ai-media-studio/governance/contracts";
import { DrizzleGovernanceRepository } from "../server/ai-media-studio/governance/drizzle-repository";
import { governanceProfileLockKey } from "../server/ai-media-studio/planning/authority-locks";

const scope = { ownerUserId: "owner-a", workspaceId: "workspace-a" } as const;
const digestA = `sha256:${"a".repeat(64)}` as const;
const digestB = `sha256:${"b".repeat(64)}` as const;
const assetChecksum = "c".repeat(64);
const createdAt = "2030-01-01T00:00:00.000Z";

class FakeDb {
  readonly queries: Array<{ sql: string; params: unknown[] }> = [];
  constructor(private readonly results: unknown[] = []) {}
  async execute(query: unknown) {
    const compiled = new PgDialect().sqlToQuery(query as never);
    this.queries.push(compiled);
    return this.results.shift() ?? [];
  }
  async transaction<T>(callback: (tx: FakeDb) => Promise<T>): Promise<T> { return callback(this); }
}

function profileRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "00000000-0000-4000-8000-000000000010",
    owner_user_id: scope.ownerUserId,
    workspace_id: scope.workspaceId,
    influencer_id: "00000000-0000-4000-8000-000000000001",
    avatar_resource_id: "00000000-0000-4000-8000-000000000002",
    voice_resource_id: "00000000-0000-4000-8000-000000000003",
    consent_basis: "obtained",
    rights_basis: "owned",
    allowed_uses: ["commercial"],
    territories: ["US"],
    valid_from: new Date("2030-01-01T00:00:00.000Z"),
    expires_at: new Date("2031-01-01T00:00:00.000Z"),
    proof_digest: digestA,
    evidence_digest: digestB,
    brand_policy: { requiredTerms: [], prohibitedTerms: [] },
    version: 1,
    policy_version: "brand-policy-v1",
    actor_user_id: "owner-a",
    previous_profile_id: null,
    revoked_at: null,
    revocation_reason: null,
    idempotency_key: "profile-key",
    input_digest: digestA,
    created_at: new Date(createdAt),
    ...overrides,
  };
}

function profile() {
  const row = profileRow();
  return {
    id: String(row.id), ownerUserId: scope.ownerUserId, workspaceId: scope.workspaceId,
    influencerId: String(row.influencer_id), avatarId: String(row.avatar_resource_id), voiceId: String(row.voice_resource_id),
    consentBasis: "obtained" as const, rightsBasis: "owned" as const, allowedUses: ["commercial" as const], territories: ["US"],
    validFrom: row.valid_from.toISOString(), expiresAt: row.expires_at.toISOString(), proofDigest: digestA,
    brandPolicy: { requiredTerms: [], prohibitedTerms: [] }, version: 1, policyVersion: "brand-policy-v1", evidenceDigest: digestB, previousProfileId: null,
    revokedAt: null, revocationReason: null, createdByUserId: "owner-a", createdAt,
  };
}

function reviewRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "00000000-0000-4000-8000-000000000020", owner_user_id: scope.ownerUserId, workspace_id: scope.workspaceId,
    media_asset_id: "00000000-0000-4000-8000-000000000004", asset_checksum: assetChecksum, evaluator_type: "human",
    decision: "approved", version: 1,
    criteria: { naturalMovement: 5, eyeContact: 5, speechQuality: 5, lighting: 5, realism: 5, brandConsistency: 5, verticalQuality: 5 },
    notes: null, evidence_digest: digestB, actor_user_id: "owner-a", previous_review_id: null,
    idempotency_key: "review-key", input_digest: digestA, created_at: new Date(createdAt), ...overrides,
  };
}

function review() {
  const row = reviewRow();
  return {
    id: String(row.id), ownerUserId: scope.ownerUserId, workspaceId: scope.workspaceId,
    assetId: String(row.media_asset_id), assetChecksum, criteria: row.criteria,
    version: 1, status: "approved" as const, evidenceDigest: digestB, previousReviewId: null,
    reviewedByUserId: "owner-a", createdAt,
  };
}

test("profile append locks its tenant subject, validates ownership/chain, and only inserts", async () => {
  const db = new FakeDb([[], [], [{}], [], [profileRow()]]);
  const result = await new DrizzleGovernanceRepository(db as never).appendProfile(
    scope, profile(), { key: "profile-key", inputDigest: digestA },
  );
  assert.equal(result.created, true);
  assert.equal(db.queries.length, 5);
  assert.match(db.queries[0]!.sql, /pg_advisory_xact_lock\(hashtextextended/i);
  assert.ok(db.queries[0]!.params.includes(governanceProfileLockKey(scope, profile().influencerId)));
  const ownership = db.queries[2]!;
  assert.match(ownership.sql, /ai_media_influencers/i);
  assert.match(ownership.sql, /ai_media_provider_resources/i);
  assert.match(ownership.sql, /owner_user_id/i);
  assert.match(ownership.sql, /workspace_id/i);
  assert.match(ownership.sql, /avatar\.resource_type = 'avatar'/i);
  assert.match(ownership.sql, /avatar\.status = 'active'/i);
  assert.match(ownership.sql, /voice\.resource_type = 'voice'/i);
  assert.match(ownership.sql, /voice\.status = 'active'/i);
  assert.match(ownership.sql, /i\.default_avatar_resource_id =/i);
  assert.match(ownership.sql, /i\.default_voice_resource_id =/i);
  const insert = db.queries[4]!;
  assert.match(insert.sql, /insert into .*ai_media_governance_profiles/i);
  assert.match(insert.sql, /on conflict \(owner_user_id, workspace_id, idempotency_key\) do nothing/i);
  assert.doesNotMatch(insert.sql, /\bupdate\b|\bdelete\b/i);
});

test("profile idempotency replay rejects a different payload and never appends", async () => {
  const db = new FakeDb([[], [profileRow({ input_digest: digestB })]]);
  await assert.rejects(
    new DrizzleGovernanceRepository(db as never).appendProfile(scope, profile(), { key: "profile-key", inputDigest: digestA }),
    GovernanceConflictError,
  );
  assert.equal(db.queries.length, 2);
  assert.doesNotMatch(db.queries.map((query) => query.sql).join(" "), /insert into/i);
});

test("append rejects record/scope aliasing before locks or SQL", async () => {
  const db = new FakeDb();
  await assert.rejects(
    new DrizzleGovernanceRepository(db as never).appendProfile(
      scope, { ...profile(), workspaceId: "workspace-b" }, { key: "profile-key", inputDigest: digestA },
    ),
    /tenant does not match/,
  );
  await assert.rejects(
    new DrizzleGovernanceRepository(db as never).appendReview(
      scope, { ...review(), ownerUserId: "owner-b" }, { key: "review-key", inputDigest: digestA },
    ),
    /tenant does not match/,
  );
  assert.equal(db.queries.length, 0);
});

test("profile append rejects a stale previous link before insert", async () => {
  const current = profileRow({ id: "00000000-0000-4000-8000-000000000099", version: 1 });
  const db = new FakeDb([[], [], [{}], [current]]);
  await assert.rejects(
    new DrizzleGovernanceRepository(db as never).appendProfile(
      scope, { ...profile(), id: "00000000-0000-4000-8000-000000000011", version: 2, previousProfileId: "wrong" },
      { key: "profile-key-2", inputDigest: digestA },
    ),
    /does not extend the current tenant chain/,
  );
  assert.equal(db.queries.length, 4);
});

test("current profile query is tenant scoped, deterministic, and does not evaluate expiration", async () => {
  const db = new FakeDb([[profileRow()]]);
  await new DrizzleGovernanceRepository(db as never).getCurrentProfile(scope, String(profileRow().influencer_id));
  const query = db.queries[0]!;
  assert.match(query.sql, /owner_user_id = .*workspace_id = .*influencer_id =/i);
  assert.match(query.sql, /order by version desc, created_at desc, id desc limit/i);
  assert.doesNotMatch(query.sql, /expires_at\s*[<>=]|now\(\)/i);
});

test("review append validates tenant asset checksum, chain, and persists append-only evidence", async () => {
  const db = new FakeDb([[], [], [{}], [], [reviewRow()]]);
  const result = await new DrizzleGovernanceRepository(db as never).appendReview(
    scope, review(), { key: "review-key", inputDigest: digestA },
  );
  assert.equal(result.created, true);
  const ownership = db.queries[2]!;
  assert.match(ownership.sql, /ai_media_assets/i);
  assert.match(ownership.sql, /checksum =/i);
  assert.match(ownership.sql, /owner_user_id/i);
  assert.match(ownership.sql, /workspace_id/i);
  assert.match(ownership.sql, /kind = 'video'/i);
  assert.match(ownership.sql, /status = 'ready'/i);
  assert.match(ownership.sql, /deleted_at is null/i);
  const insert = db.queries[4]!;
  assert.match(insert.sql, /insert into .*ai_media_quality_reviews/i);
  assert.match(insert.sql, /input_digest/i);
  assert.doesNotMatch(insert.sql, /\bupdate\b|\bdelete\b/i);
});

test("current review is deterministic and mapped records redact persistence-only fields", async () => {
  const db = new FakeDb([[reviewRow()]]);
  const result = await new DrizzleGovernanceRepository(db as never).getCurrentReview(scope, String(reviewRow().media_asset_id));
  const query = db.queries[0]!;
  assert.match(query.sql, /order by version desc, created_at desc, id desc limit/i);
  const serialized = JSON.stringify(result);
  assert.doesNotMatch(serialized, /idempotency|inputDigest|input_digest|evaluatorType/i);
});
