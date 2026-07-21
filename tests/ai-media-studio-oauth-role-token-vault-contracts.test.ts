import assert from "node:assert/strict";
import test from "node:test";
import {
  OAUTH_ROLE_TOKEN_REFERENCE_PREFIX,
  OAuthRoleTokenVaultError,
  oauthRoleTokenReferenceFor,
  parseOAuthRoleTokenReference,
  validateOAuthRoleTokenDescriptor,
  validateOAuthRoleTokenSecret,
  validateOAuthRoleTokenVaultContext,
  type OAuthRoleTokenDescriptor,
  type OAuthRoleTokenVaultContext,
} from "../server/ai-media-studio/oauth/role-token-vault-contracts";

const NOW = "2026-07-21T12:00:00.000Z";
const context: OAuthRoleTokenVaultContext = {
  purpose: "ai_media_oauth_role_token_v2",
  ownerUserId: "owner-1",
  workspaceId: "workspace-1",
  actorUserId: "actor-1",
  providerAccountId: "11111111-1111-4111-8111-111111111111",
  platform: "tiktok",
  sessionId: "22222222-2222-4222-8222-222222222222",
  attemptId: "attempt-1",
  targetCredentialVersion: 3,
  tokenBindingId: "33333333-3333-4333-8333-333333333333",
  artifactBindingId: "44444444-4444-4444-8444-444444444444",
  role: "operational_access",
  candidateId: "candidate-1",
  targetKind: "tiktok_user",
  targetId: "target-1",
  selectionDigest: "a".repeat(64),
};
const descriptor: OAuthRoleTokenDescriptor = {
  role: "operational_access",
  lifetime: {
    kind: "expires_at",
    expiresAt: "2026-07-22T12:00:00.000Z",
    revalidateAt: "2026-07-22T00:00:00.000Z",
  },
  manifestRevision: "tiktok-v2",
};

test("role-token context accepts only the complete exact v2 selection binding", () => {
  assert.deepEqual(validateOAuthRoleTokenVaultContext(context), context);
  for (const key of Object.keys(context)) {
    const missing = { ...context } as Record<string, unknown>;
    delete missing[key];
    assert.throws(() => validateOAuthRoleTokenVaultContext(missing), OAuthRoleTokenVaultError, `missing ${key}`);
  }
  assert.throws(() => validateOAuthRoleTokenVaultContext({ ...context, unexpected: "field" }), OAuthRoleTokenVaultError);
  assert.throws(() => validateOAuthRoleTokenVaultContext({ ...context, targetCredentialVersion: 0 }), OAuthRoleTokenVaultError);
  assert.throws(() => validateOAuthRoleTokenVaultContext({ ...context, selectionDigest: "not-a-digest" }), OAuthRoleTokenVaultError);
  assert.throws(() => validateOAuthRoleTokenVaultContext({ ...context, artifactBindingId: context.tokenBindingId }), OAuthRoleTokenVaultError);
  assert.throws(() => validateOAuthRoleTokenVaultContext({ ...context, targetKind: "youtube_channel" }), OAuthRoleTokenVaultError);
});

test("role-token reference is deterministic, opaque, role-specific, and strictly parsed", () => {
  const first = oauthRoleTokenReferenceFor(context);
  const second = oauthRoleTokenReferenceFor({ ...context });
  const refresh = oauthRoleTokenReferenceFor({ ...context, role: "refresh" });
  assert.equal(first, second);
  assert.notEqual(first, refresh);
  assert.match(first, new RegExp(`^${OAUTH_ROLE_TOKEN_REFERENCE_PREFIX}/[0-9a-f]{64}$`, "u"));
  assert.equal(first.includes(context.artifactBindingId), false);
  assert.equal(first.includes(context.role), false);
  assert.equal(parseOAuthRoleTokenReference(first).length, 64);
  assert.throws(() => parseOAuthRoleTokenReference(`${first}/extra`), OAuthRoleTokenVaultError);
  assert.throws(() => parseOAuthRoleTokenReference(first.replace("/v2/", "/v1/")), OAuthRoleTokenVaultError);
});

test("descriptor is exact, role-bound, provider-neutral, and bounded to 366 days", () => {
  assert.deepEqual(validateOAuthRoleTokenDescriptor(descriptor, context.role, NOW), descriptor);
  assert.deepEqual(validateOAuthRoleTokenDescriptor({
    role: "refresh",
    lifetime: { kind: "revocation_bound", revalidateAt: "2027-07-22T12:00:00.000Z" },
    manifestRevision: "google-youtube-v1",
  }, "refresh", NOW).lifetime.kind, "revocation_bound");
  assert.deepEqual(validateOAuthRoleTokenDescriptor({
    role: "grant_user_access",
    lifetime: { kind: "provider_non_expiring", revalidateAt: "2026-08-21T12:00:00.000Z" },
    manifestRevision: "meta-graph-v23",
  }, "grant_user_access", NOW).lifetime.kind, "provider_non_expiring");
  assert.throws(() => validateOAuthRoleTokenDescriptor({ ...descriptor, role: "refresh" }, context.role, NOW), OAuthRoleTokenVaultError);
  assert.throws(() => validateOAuthRoleTokenDescriptor({ ...descriptor, extra: true }, context.role, NOW), OAuthRoleTokenVaultError);
  assert.throws(() => validateOAuthRoleTokenDescriptor(Object.assign(Object.create({ polluted: true }), descriptor), context.role, NOW), OAuthRoleTokenVaultError);
  assert.throws(() => validateOAuthRoleTokenDescriptor({
    ...descriptor,
    lifetime: { ...descriptor.lifetime, extra: true },
  }, context.role, NOW), OAuthRoleTokenVaultError);
  assert.throws(() => validateOAuthRoleTokenDescriptor({
    ...descriptor,
    lifetime: { kind: "expires_at", expiresAt: "2026-07-22T00:00:00.000Z", revalidateAt: "2026-07-22T00:00:00.001Z" },
  }, context.role, NOW), OAuthRoleTokenVaultError);
  assert.throws(() => validateOAuthRoleTokenDescriptor({
    ...descriptor,
    lifetime: { kind: "provider_non_expiring", revalidateAt: "2027-07-22T12:00:00.001Z" },
  }, context.role, NOW), OAuthRoleTokenVaultError);
});

test("only one bounded non-whitespace secret is accepted per artifact", () => {
  assert.equal(validateOAuthRoleTokenSecret("secret.token_-1"), "secret.token_-1");
  for (const secret of ["", "has space", "has\nnewline", "x".repeat(32_769)]) {
    assert.throws(() => validateOAuthRoleTokenSecret(secret), OAuthRoleTokenVaultError);
  }
});
