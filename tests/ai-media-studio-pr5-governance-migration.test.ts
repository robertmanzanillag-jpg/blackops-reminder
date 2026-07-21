import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const directory = "migrations/ai-media-studio";
const read = (name: string) => readFileSync(resolve(process.cwd(), directory, name), "utf8");
const forward = read("20260720_pr5_governance_forward.sql");
const rollback = read("20260720_pr5_governance_rollback.sql");
const model = readFileSync(resolve(process.cwd(), "shared/models/ai-media-studio-db.ts"), "utf8");

test("PR5 governance migration is bounded, transactional, and dependency-preflighted", () => {
  assert.match(forward, /^--[\s\S]*\nBEGIN;/);
  assert.match(forward, /SET LOCAL lock_timeout = '5s'/);
  assert.match(forward, /SET LOCAL statement_timeout = '15min'/);
  for (const dependency of [
    "ai_media_influencers", "ai_media_provider_resources", "ai_media_render_jobs", "ai_media_assets",
  ]) assert.match(forward, new RegExp(`'${dependency}'`));
  assert.match(forward, /to_regclass\('public\.' \|\| required_table\)/);
  assert.equal((forward.match(/\bBEGIN;/g) ?? []).length, 1);
  assert.equal((forward.match(/\bCOMMIT;/g) ?? []).length, 1);
  assert.match(forward, /COMMIT;\s*$/);
});

test("governance profiles are append-only revisions with strict policy evidence", () => {
  assert.match(forward, /CREATE TABLE IF NOT EXISTS ai_media_governance_profiles/);
  for (const field of [
    "influencer_id uuid NOT NULL", "avatar_resource_id uuid NOT NULL", "voice_resource_id uuid NOT NULL",
    "state text NOT NULL", "consent_basis text NOT NULL", "rights_basis text NOT NULL",
    "allowed_uses jsonb NOT NULL", "territories jsonb NOT NULL", "proof_digest text NOT NULL",
    "evidence_digest text NOT NULL", "brand_policy jsonb NOT NULL", "version integer NOT NULL",
    "policy_version text NOT NULL", "actor_user_id text NOT NULL", "valid_from timestamptz NOT NULL",
    "expires_at timestamptz NOT NULL", "revoked_at timestamptz", "revocation_reason text",
    "previous_profile_id uuid", "idempotency_key text NOT NULL", "input_digest text NOT NULL",
  ]) assert.match(forward, new RegExp(field));
  assert.match(forward, /state IN \('active', 'revoked'\)/);
  assert.match(forward, /consent_basis IN \('obtained', 'synthetic_not_applicable'\)/);
  assert.match(forward, /rights_basis IN \('owned', 'licensed'\)/);
  assert.match(forward, /proof_digest ~ '\^sha256:\[0-9a-f\]\{64\}\$'/);
  assert.match(forward, /allowed_uses <@ '\["internal_preview", "organic_social", "paid_ads", "commercial"\]'::jsonb/);
  assert.match(forward, /expires_at > valid_from/);
  assert.match(forward, /state = 'revoked'[\s\S]*revoked_at IS NOT NULL[\s\S]*revocation_reason/);
  assert.match(forward, /ai_media_governance_profiles_owner_workspace_idempotency_uq[\s\S]*owner_user_id, workspace_id, idempotency_key/);
  assert.match(forward, /ai_media_governance_profiles_owner_workspace_influencer_version_uq[\s\S]*owner_user_id, workspace_id, influencer_id, version/);
});

test("governance identity and revision links use tenant composite foreign keys", () => {
  for (const relation of ["influencer", "avatar", "voice", "previous"]) {
    assert.match(forward, new RegExp(`ai_media_governance_profiles_${relation}_tenant_fk`));
  }
  assert.match(forward, /FOREIGN KEY \(owner_user_id, workspace_id, influencer_id\)[\s\S]*REFERENCES ai_media_influencers \(owner_user_id, workspace_id, id\)/);
  assert.match(forward, /FOREIGN KEY \(owner_user_id, workspace_id, avatar_resource_id\)[\s\S]*REFERENCES ai_media_provider_resources \(owner_user_id, workspace_id, id\)/);
  assert.match(forward, /FOREIGN KEY \(owner_user_id, workspace_id, previous_profile_id\)[\s\S]*REFERENCES ai_media_governance_profiles \(owner_user_id, workspace_id, id\)/);
});

test("quality reviews bind a decision to an exact tenant asset checksum", () => {
  assert.match(forward, /CREATE TABLE IF NOT EXISTS ai_media_quality_reviews/);
  for (const field of [
    "media_asset_id uuid NOT NULL", "asset_checksum text NOT NULL", "evaluator_type text NOT NULL",
    "decision text NOT NULL", "version integer NOT NULL", "criteria jsonb NOT NULL", "notes text",
    "evidence_digest text NOT NULL", "actor_user_id text NOT NULL", "previous_review_id uuid",
    "idempotency_key text NOT NULL", "input_digest text NOT NULL",
  ]) assert.match(forward, new RegExp(field));
  assert.match(forward, /asset_checksum ~ '\^\[0-9a-f\]\{64\}\$'/);
  assert.match(forward, /decision IN \('approved', 'rejected', 'needs_review'\)/);
  assert.match(forward, /evaluator_type = 'human'/);
  assert.doesNotMatch(forward, /jsonb_object_length/);
  assert.match(forward, /criteria - 'naturalMovement' - 'eyeContact' - 'speechQuality' - 'lighting' - 'realism' - 'brandConsistency' - 'verticalQuality'\) = '\{\}'::jsonb/);
  for (const criterion of [
    "naturalMovement", "eyeContact", "speechQuality", "lighting", "realism", "brandConsistency", "verticalQuality",
  ]) {
    assert.match(forward, new RegExp(`jsonb_typeof\\(criteria->'${criterion}'\\) = 'number'`));
    assert.match(forward, new RegExp(`criteria->>'${criterion}'`));
  }
  assert.match(forward, /THEN decision = 'rejected'/);
  assert.match(forward, /THEN decision = 'approved'/);
  assert.match(forward, /ELSE decision = 'needs_review'/);
  assert.match(forward, /notes IS NULL OR length\(notes\) <= 2000/);
  assert.match(forward, /FOREIGN KEY \(owner_user_id, workspace_id, media_asset_id, asset_checksum\)[\s\S]*REFERENCES ai_media_assets \(owner_user_id, workspace_id, id, checksum\)/);
  assert.match(forward, /ai_media_quality_reviews_owner_workspace_idempotency_uq[\s\S]*owner_user_id, workspace_id, idempotency_key/);
  assert.match(forward, /ai_media_quality_reviews_owner_workspace_asset_version_uq[\s\S]*owner_user_id, workspace_id, media_asset_id, version/);
});

test("render jobs retain a validated tenant governance evidence snapshot", () => {
  assert.match(forward, /ADD COLUMN IF NOT EXISTS governance_profile_id uuid/);
  assert.match(forward, /ADD COLUMN IF NOT EXISTS governance_evidence_digest text/);
  assert.match(forward, /orphaned or cross-tenant render governance profiles block PR5/);
  assert.match(forward, /ai_media_render_jobs_governance_profile_tenant_fk[\s\S]*FOREIGN KEY \(owner_user_id, workspace_id, governance_profile_id\)[\s\S]*ON DELETE RESTRICT NOT VALID/);
  assert.match(forward, /VALIDATE CONSTRAINT ai_media_render_jobs_governance_profile_tenant_fk/);
  assert.match(forward, /ai_media_render_jobs_governance_evidence_ck[\s\S]*governance_evidence_digest ~ '\^sha256:\[0-9a-f\]\{64\}\$'/);
});

test("Drizzle exports PR5 tables and render snapshot fields", () => {
  assert.match(model, /export const aiMediaGovernanceProfiles = pgTable\(\s*"ai_media_governance_profiles"/);
  assert.match(model, /export const aiMediaQualityReviews = pgTable\(\s*"ai_media_quality_reviews"/);
  assert.match(model, /governanceProfileId: uuid\("governance_profile_id"\)/);
  assert.match(model, /governanceEvidenceDigest: text\("governance_evidence_digest"\)/);
  assert.match(model, /governanceProfiles: aiMediaGovernanceProfiles/);
  assert.match(model, /qualityReviews: aiMediaQualityReviews/);
});

test("rollback preserves every governance table, column, constraint, and row", () => {
  for (const [name, migration] of [["forward", forward], ["rollback", rollback]] as const) {
    assert.doesNotMatch(migration, /\bDROP\s+TABLE\b/i, `${name} must retain tables`);
    assert.doesNotMatch(migration, /\bDROP\s+COLUMN\b/i, `${name} must retain columns`);
    assert.doesNotMatch(migration, /\bTRUNCATE\b/i, `${name} must retain rows`);
    assert.doesNotMatch(migration, /\bDELETE\s+FROM\b/i, `${name} must retain rows`);
  }
  assert.match(rollback, /data-preserving rollback requires existing table/);
  assert.match(rollback, /audit trail[\s\S]*forward application retry/i);
  assert.match(rollback, /COMMIT;\s*$/);
});
