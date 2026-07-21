import assert from "node:assert/strict";
import test from "node:test";
import {
  OAuthProviderConnectionError,
  deriveOAuthProviderCapabilities,
  isCompatibleOAuthProviderTarget,
  toOAuthProviderTargetDto,
  validateOAuthProviderScopes,
  validateOAuthProviderTokenArtifacts,
  type OAuthProviderTargetCandidate,
} from "../server/ai-media-studio/oauth/provider-connection-contracts";

test("grant families have exact platform and target compatibility", () => {
  assert.equal(isCompatibleOAuthProviderTarget("tiktok", "tiktok_user", "tiktok_user"), true);
  assert.equal(isCompatibleOAuthProviderTarget("youtube_shorts", "google_user", "youtube_channel"), true);
  assert.equal(isCompatibleOAuthProviderTarget("facebook", "meta_facebook_login", "facebook_page"), true);
  assert.equal(isCompatibleOAuthProviderTarget("instagram", "meta_facebook_login", "instagram_professional_account"), true);
  assert.equal(isCompatibleOAuthProviderTarget("instagram", "meta_facebook_login", "facebook_page"), false);
  assert.equal(isCompatibleOAuthProviderTarget("facebook", "google_user", "facebook_page"), false);
});

test("scope validation enforces required subset actual subset frozen allowlist", () => {
  validateOAuthProviderScopes("tiktok_user", ["video.publish"], ["video.publish", "user.info.basic"], ["video.publish", "user.info.basic"]);
  assert.throws(
    () => validateOAuthProviderScopes("tiktok_user", ["video.publish"], ["user.info.basic"], ["video.publish", "user.info.basic"]),
    OAuthProviderConnectionError,
  );
  assert.throws(
    () => validateOAuthProviderScopes("tiktok_user", ["video.publish"], ["video.publish", "unreviewed.scope"], ["video.publish", "unreviewed.scope"]),
    OAuthProviderConnectionError,
  );
  assert.throws(
    () => validateOAuthProviderScopes("tiktok_user", ["video.publish"], ["video.publish", "video.upload"], ["video.publish"]),
    OAuthProviderConnectionError,
  );
});

test("capabilities are locally derived only from allowlisted verified tasks", () => {
  assert.deepEqual(deriveOAuthProviderCapabilities("facebook_page", ["ANALYZE", "CREATE_CONTENT"]), ["publish_video", "read_analytics"]);
  assert.throws(() => deriveOAuthProviderCapabilities("facebook_page", ["PROVIDER_SAYS_ADMIN"]), OAuthProviderConnectionError);
});

test("artifact lifetime is discriminated and always has a future revalidation horizon", () => {
  const now = "2026-07-21T12:00:00.000Z";
  validateOAuthProviderTokenArtifacts("meta_facebook_login", [
    { role: "operational_access", lifetime: { kind: "expires_at", expiresAt: "2026-07-21T14:00:00.000Z", revalidateAt: "2026-07-21T13:00:00.000Z" } },
    { role: "grant_user_access", lifetime: { kind: "expires_at", expiresAt: "2026-07-23T12:00:00.000Z", revalidateAt: "2026-07-22T12:00:00.000Z" } },
  ], now);
  validateOAuthProviderTokenArtifacts("google_user", [
    { role: "operational_access", lifetime: { kind: "expires_at", expiresAt: "2026-07-21T14:00:00.000Z", revalidateAt: "2026-07-21T13:00:00.000Z" } },
    { role: "refresh", lifetime: { kind: "revocation_bound", revalidateAt: "2026-08-21T12:00:00.000Z" } },
  ], now);
  assert.throws(() => validateOAuthProviderTokenArtifacts("meta_facebook_login", [
    { role: "operational_access", lifetime: { kind: "expires_at", expiresAt: "2026-07-21T14:00:00.000Z", revalidateAt: now } },
  ], now), OAuthProviderConnectionError);
  assert.throws(() => validateOAuthProviderTokenArtifacts("tiktok_user", [
    { role: "refresh", lifetime: { kind: "provider_non_expiring", revalidateAt: "2026-07-22T12:00:00.000Z" } },
  ], now), OAuthProviderConnectionError);
  assert.throws(() => validateOAuthProviderTokenArtifacts("meta_facebook_login", [
    { role: "operational_access", lifetime: { kind: "provider_non_expiring", revalidateAt: "9999-12-31T23:59:59.999Z" } },
  ], now), OAuthProviderConnectionError);
  assert.throws(() => validateOAuthProviderTokenArtifacts("meta_facebook_login", [
    { role: "operational_access", lifetime: { kind: "provider_non_expiring", revalidateAt: "2026-07-22T12:00:00.000Z" } },
    { role: "grant_user_access", lifetime: { kind: "provider_non_expiring", revalidateAt: "2026-07-22T12:00:00.000Z" } },
  ], now), OAuthProviderConnectionError);
  assert.throws(() => validateOAuthProviderTokenArtifacts("google_user", [
    { role: "operational_access", lifetime: { kind: "provider_non_expiring", revalidateAt: "2026-07-22T12:00:00.000Z" } },
    { role: "refresh", lifetime: { kind: "expires_at", expiresAt: "2026-08-21T12:00:00.000Z", revalidateAt: "2026-07-22T12:00:00.000Z" } },
  ], now), OAuthProviderConnectionError);
});

test("safe target DTO excludes discovery evidence and secret reference-shaped fields", () => {
  const candidate: OAuthProviderTargetCandidate = {
    candidateId: "candidate-1", targetId: "page-1", kind: "facebook_page", displayName: "Kong Page",
    verifiedTasks: ["CREATE_CONTENT"], capabilities: ["publish_video"], eligibilityDigest: "a".repeat(64),
    manifestRevision: "meta-v25", discoveredAt: "2026-07-21T12:00:00.000Z",
  };
  assert.deepEqual(toOAuthProviderTargetDto(candidate), {
    targetId: "page-1", kind: "facebook_page", displayName: "Kong Page", capabilities: ["publish_video"],
  });
  assert.equal(JSON.stringify(toOAuthProviderTargetDto(candidate)).includes("verifiedTasks"), false);
  assert.equal(JSON.stringify(toOAuthProviderTargetDto(candidate)).includes("reference"), false);
});
