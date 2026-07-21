import assert from "node:assert/strict";
import test from "node:test";
import { buildOAuthAuthorizationUrl } from "../server/ai-media-studio/oauth/authorization-url";
import { AI_MEDIA_OAUTH_PLATFORM_MANIFESTS } from "../server/ai-media-studio/oauth/platform-manifests";

const STATE = "s".repeat(64);
const CHALLENGE = "c".repeat(43);

test("TikTok Web authorization uses the fixed official endpoint, audited scopes, and no PKCE", () => {
  const url = new URL(buildOAuthAuthorizationUrl({
    platform: "tiktok",
    clientId: "tiktok-client-key",
    redirectUri: "https://app.example.com/oauth/tiktok/callback",
    state: STATE,
  }));
  assert.equal(url.origin + url.pathname, "https://www.tiktok.com/v2/auth/authorize/");
  assert.equal(url.searchParams.get("client_key"), "tiktok-client-key");
  assert.equal(url.searchParams.get("scope"), AI_MEDIA_OAUTH_PLATFORM_MANIFESTS.tiktok.defaultScopes.join(","));
  assert.equal(url.searchParams.has("code_challenge"), false);
  assert.equal(url.searchParams.get("state"), STATE);
  assert.throws(() => buildOAuthAuthorizationUrl({
    platform: "tiktok", clientId: "client", redirectUri: "https://app.example.com/callback",
    state: STATE, codeChallenge: CHALLENGE,
  }), /authorization configuration is invalid/);
});

test("Meta authorization is explicitly versioned and conservatively omits PKCE", () => {
  for (const platform of ["instagram", "facebook"] as const) {
    const url = new URL(buildOAuthAuthorizationUrl({
      platform, clientId: "1234567890", redirectUri: `https://app.example.com/oauth/${platform}/callback`, state: STATE,
    }));
    assert.equal(url.origin + url.pathname, "https://www.facebook.com/v23.0/dialog/oauth");
    assert.equal(url.searchParams.get("client_id"), "1234567890");
    assert.equal(url.searchParams.get("scope"), AI_MEDIA_OAUTH_PLATFORM_MANIFESTS[platform].defaultScopes.join(","));
    assert.equal(url.searchParams.has("code_challenge"), false);
  }
});

test("Google Web Server authorization omits PKCE and applies immutable offline-consent parameters", () => {
  const url = new URL(buildOAuthAuthorizationUrl({
    platform: "youtube_shorts",
    clientId: "client.apps.googleusercontent.com",
    redirectUri: "https://app.example.com/oauth/youtube/callback",
    state: STATE,
  }));
  assert.equal(url.origin + url.pathname, "https://accounts.google.com/o/oauth2/v2/auth");
  assert.equal(url.searchParams.get("scope"), AI_MEDIA_OAUTH_PLATFORM_MANIFESTS.youtube_shorts.defaultScopes.join(" "));
  assert.equal(url.searchParams.has("code_challenge"), false);
  assert.equal(url.searchParams.has("code_challenge_method"), false);
  assert.equal(url.searchParams.get("access_type"), "offline");
  assert.equal(url.searchParams.get("include_granted_scopes"), "false");
  assert.equal(url.searchParams.get("prompt"), "consent");
  assert.equal(Object.isFrozen(AI_MEDIA_OAUTH_PLATFORM_MANIFESTS.youtube_shorts), true);
  assert.equal(Object.isFrozen(AI_MEDIA_OAUTH_PLATFORM_MANIFESTS.youtube_shorts.authorizationParameters), true);
  assert.throws(() => buildOAuthAuthorizationUrl({
    platform: "youtube_shorts", clientId: "client", redirectUri: "https://app.example.com/callback",
    state: STATE, codeChallenge: CHALLENGE,
  }), /authorization configuration is invalid/);
});

test("authorization URL composition rejects unsafe redirects and malformed caller-controlled values", () => {
  for (const redirectUri of [
    "http://app.example.com/callback",
    "https://localhost/callback",
    "https://127.0.0.1/callback",
    "https://127.1/callback",
    "https://0x7f000001/callback",
    "https://0x7f.1/callback",
    "https://127.0x0.0.1/callback",
    "https://2130706433/callback",
    "https://[::1]/callback",
    "https://user@app.example.com/callback",
    "https://app.example.com:8443/callback",
    "https://app.example.com/callback?next=evil",
    "https://app.example.com/callback#fragment",
  ]) {
    assert.throws(() => buildOAuthAuthorizationUrl({
      platform: "tiktok", clientId: "client", redirectUri, state: STATE,
    }), /authorization configuration is invalid/);
  }
  assert.throws(() => buildOAuthAuthorizationUrl({
    platform: "tiktok", clientId: "client id", redirectUri: "https://app.example.com/callback", state: STATE,
  }), /authorization configuration is invalid/);
  assert.throws(() => buildOAuthAuthorizationUrl({
    platform: "tiktok", clientId: "client", redirectUri: "https://app.example.com/callback", state: "short",
  }), /authorization configuration is invalid/);
});
