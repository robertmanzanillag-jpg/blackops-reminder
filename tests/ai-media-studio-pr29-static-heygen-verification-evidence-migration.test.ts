import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const forward = readFileSync(new URL(
  "../migrations/ai-media-studio/pending/20260722_pr29_static_heygen_verification_evidence_forward.sql",
  import.meta.url,
), "utf8");
const rollback = readFileSync(new URL(
  "../migrations/ai-media-studio/pending/20260722_pr29_static_heygen_verification_evidence_rollback.sql",
  import.meta.url,
), "utf8");
const drizzleSchema = readFileSync(new URL("../shared/models/ai-media-studio-db.ts", import.meta.url), "utf8");

test("PR29 adds verified-only immutable header and resource evidence without secret or payload material", () => {
  assert.match(forward, /CREATE TABLE ai_media_static_heygen_verification_headers/iu);
  assert.match(forward, /CREATE TABLE ai_media_static_heygen_resource_verifications/iu);
  assert.match(forward, /verification_state='verified'/iu);
  assert.doesNotMatch(forward, /verification_state IN \('verified','failed','revoked'\)/iu);
  assert.match(forward, /account_evidence_digest text NOT NULL/iu);
  assert.match(forward, /billing_model text NOT NULL/iu);
  assert.doesNotMatch(forward, /account_subject_digest|account_status|limits_digest|quota_digest|rate_limit_digest/iu);
  assert.match(forward, /static HeyGen verification evidence is append-only/iu);
  assert.match(forward, /CREATE TRIGGER ai_media_static_heygen_verification_headers_truncate_guard[\s\S]*BEFORE TRUNCATE ON ai_media_static_heygen_verification_headers[\s\S]*FOR EACH STATEMENT EXECUTE FUNCTION ai_media_static_heygen_evidence_append_only_v1\(\)/iu);
  assert.match(forward, /CREATE TRIGGER ai_media_static_heygen_resource_verifications_truncate_guard[\s\S]*BEFORE TRUNCATE ON ai_media_static_heygen_resource_verifications[\s\S]*FOR EACH STATEMENT EXECUTE FUNCTION ai_media_static_heygen_evidence_append_only_v1\(\)/iu);
  assert.doesNotMatch(forward, /api[_ ]?key\s+(?:text|varchar|bytea)|x-api-key|access_token|refresh_token|raw_payload|response_payload|request_payload|jsonb\s+NOT NULL\s+DEFAULT\s+'\{\}'::jsonb/iu);
});

test("PR29 binds verified account evidence to exact credential version and exact roster plan", () => {
  assert.match(forward, /ai_media_static_credential_bindings_exact_version_uq/iu);
  assert.match(forward, /ai_media_static_heygen_verification_headers_credential_exact_fk/iu);
  assert.match(forward, /credential_binding_request_digest/iu);
  assert.match(forward, /daily_plan_id uuid NOT NULL/iu);
  assert.match(forward, /source_roster_key text NOT NULL/iu);
  assert.match(forward, /source_roster_digest text NOT NULL/iu);
  assert.match(forward, /plan_digest text NOT NULL/iu);
  assert.match(forward, /ai_media_static_heygen_verification_headers_plan_exact_fk/iu);
  assert.match(forward, /ai_media_static_heygen_verification_headers_header_identity_uq/iu);
  assert.match(forward, /REFERENCES ai_media_daily_plans\(owner_user_id,workspace_id,id,provider_account_id,provider_key,[\s\S]*provider_credential_version,source_roster_key,source_roster_digest,plan_digest\)/iu);
  assert.doesNotMatch(forward, /ai_media_static_heygen_verification_headers_account_credential_uq/iu);
});

test("PR29 separates avatar look, avatar group/status/engines, and voice support evidence", () => {
  assert.match(forward, /avatar_look_id_digest=provider_resource_external_id_digest/iu);
  assert.match(forward, /avatar_look_status text/iu);
  assert.match(forward, /avatar_look_status='completed'/iu);
  assert.match(forward, /avatar_group_id_digest<>avatar_look_id_digest/iu);
  assert.match(forward, /avatar_group_status text/iu);
  assert.match(forward, /avatar_group_status='completed'/iu);
  assert.match(forward, /avatar_group_consent_status text/iu);
  assert.match(forward, /avatar_group_consent_status='approved'/iu);
  assert.match(forward, /avatar_engines_digest text/iu);
  assert.match(forward, /voice_id_digest=provider_resource_external_id_digest/iu);
  assert.match(forward, /language text/iu);
  assert.match(forward, /voice_support_digest text/iu);
  assert.doesNotMatch(forward, /voice_status|locale/iu);
  assert.match(forward, /ai_media_static_heygen_resource_verifications_header_resource_uq/iu);
  assert.doesNotMatch(forward, /resource_credential_uq/iu);
});

test("PR29 active static accounts and resources require exact deferred evidence graph", () => {
  assert.match(forward, /ai_media_provider_accounts_static_verification_fk/iu);
  assert.match(forward, /DEFERRABLE INITIALLY DEFERRED/iu);
  assert.match(forward, /active static HeyGen account lacks exact current verification evidence/iu);
  assert.match(forward, /binding\.lifecycle_state='pending'/iu);
  assert.match(forward, /binding\.secret_ref=account_row\.secret_ref/iu);
  assert.match(forward, /static_credential_verified_at=last_verified_at/iu);
  assert.match(forward, /static_credential_verification_expires_at=credential_expires_at/iu);
  assert.match(forward, /granted_scopes='\[\]'::jsonb/iu);
  assert.match(forward, /capabilities='\["render_video"\]'::jsonb/iu);
  assert.match(forward, /active static HeyGen resource lacks exact current resource verification evidence/iu);
});

test("PR29 proves exact roster resource coverage instead of arbitrary partial resource evidence", () => {
  assert.match(forward, /total_slot_count NOT BETWEEN 50 AND 100/iu);
  assert.match(forward, /avatar_slot_count NOT BETWEEN 5 AND 10/iu);
  assert.match(forward, /slot_count=10 AND video_count=10 AND min_video=1 AND max_video=10/iu);
  assert.match(forward, /active static HeyGen account requires 5-10 avatars with exactly 10 blocked videos each/iu);
  assert.match(forward, /slot_resources AS/iu);
  assert.match(forward, /slots\.avatar_resource_id AS provider_resource_id/iu);
  assert.match(forward, /slots\.voice_resource_id AS provider_resource_id/iu);
  assert.match(forward, /missing_resource_count<>0 OR extra_resource_count<>0/iu);
  assert.match(forward, /static HeyGen verification evidence must exactly cover the bound roster plan resources/iu);
  assert.match(forward, /ai_media_static_heygen_validate_resource_evidence_graph_v1/iu);
});

test("PR29 rollback preserves evidence and only removes an empty unapplied surface", () => {
  assert.match(rollback, /IF EXISTS \(SELECT 1 FROM ai_media_static_heygen_verification_headers\)/iu);
  assert.match(rollback, /OR EXISTS \(SELECT 1 FROM ai_media_static_heygen_resource_verifications\)/iu);
  assert.match(rollback, /rollback preserves static HeyGen verification evidence; stop and forward-fix/iu);
  assert.match(rollback, /DROP TRIGGER ai_media_provider_accounts_static_heygen_verification_graph/iu);
  assert.match(rollback, /DROP TRIGGER ai_media_static_heygen_verification_headers_truncate_guard ON ai_media_static_heygen_verification_headers/iu);
  assert.match(rollback, /DROP TRIGGER ai_media_static_heygen_resource_verifications_truncate_guard ON ai_media_static_heygen_resource_verifications/iu);
  assert.match(rollback, /DROP TABLE ai_media_static_heygen_resource_verifications/iu);
  assert.match(rollback, /DROP COLUMN static_credential_verification_id/iu);
  assert.ok(rollback.indexOf("DROP TABLE ai_media_static_heygen_resource_verifications")
    > rollback.indexOf("rollback preserves static HeyGen verification evidence"));
});

test("Drizzle mirrors PR29 tables, pointers, checks, and the provider-resource tenant FK", () => {
  assert.match(drizzleSchema, /staticCredentialVerificationId: uuid\("static_credential_verification_id"\)/u);
  assert.match(drizzleSchema, /verificationHeaderId: uuid\("verification_header_id"\)/u);
  assert.match(drizzleSchema, /aiMediaStaticHeyGenVerificationHeaders = pgTable/u);
  assert.match(drizzleSchema, /aiMediaStaticHeyGenResourceVerifications = pgTable/u);
  assert.match(drizzleSchema, /ai_media_provider_resources_account_tenant_provider_fk/u);
  assert.match(drizzleSchema, /ai_media_static_heygen_verification_headers_credential_exact_fk/u);
  assert.match(drizzleSchema, /sourceRosterDigest: text\("source_roster_digest"\)\.notNull\(\)/u);
  assert.match(drizzleSchema, /headerIdentityUnique: uniqueIndex\("ai_media_static_heygen_verification_headers_header_identity_uq"\)/u);
  assert.match(drizzleSchema, /\$\{table\.verificationState\} = 'verified'/u);
  assert.match(drizzleSchema, /accountEvidenceDigest: text\("account_evidence_digest"\)\.notNull\(\)/u);
  assert.match(drizzleSchema, /avatarGroupIdDigest.*avatar_group_id_digest/su);
  assert.match(drizzleSchema, /avatarLookStatus.*avatar_look_status/su);
  assert.match(drizzleSchema, /\$\{table\.avatarLookStatus\} = 'completed'/u);
  assert.match(drizzleSchema, /avatarGroupConsentStatus.*avatar_group_consent_status/su);
  assert.match(drizzleSchema, /\$\{table\.avatarGroupConsentStatus\} = 'approved'/u);
  assert.match(drizzleSchema, /avatarEnginesDigest.*avatar_engines_digest/su);
  assert.match(drizzleSchema, /voiceSupportDigest.*voice_support_digest/su);
  assert.match(drizzleSchema, /\$\{table\.avatarGroupIdDigest\}\s*<>\s*\$\{table\.avatarLookIdDigest\}/su);
  assert.match(drizzleSchema, /headerResourceUnique: uniqueIndex\("ai_media_static_heygen_resource_verifications_header_resource_uq"\)/u);
});
