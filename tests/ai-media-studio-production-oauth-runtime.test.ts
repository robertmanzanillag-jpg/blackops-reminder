import assert from "node:assert/strict";
import test from "node:test";
import { InMemoryOAuthSessionRepository } from "../server/ai-media-studio/oauth/in-memory";
import {
  createProductionOAuthRuntimeFromEnvironment,
  type ProductionOAuthEnvironment,
} from "../server/ai-media-studio/oauth/production-runtime";
import { OAUTH_PKCE_OBJECT_PREFIX, type S3KmsCommandClient } from "../server/ai-media-studio/oauth/s3-kms-pkce-vault";

const fullEnvironment: ProductionOAuthEnvironment = {
  AI_MEDIA_STUDIO_OAUTH_ENABLED_PLATFORMS: "tiktok,youtube_shorts",
  AI_MEDIA_STUDIO_OAUTH_PKCE_BUCKET: "oauth-private-bucket",
  AI_MEDIA_STUDIO_OAUTH_AWS_REGION: "us-east-1",
  AI_MEDIA_STUDIO_OAUTH_KMS_KEY_ARN: "arn:aws:kms:us-east-1:123456789012:key/22222222-2222-4222-8222-222222222222",
  AI_MEDIA_STUDIO_OAUTH_EXPECTED_BUCKET_OWNER: "123456789012",
  AI_MEDIA_STUDIO_OAUTH_PKCE_PREFIX: OAUTH_PKCE_OBJECT_PREFIX,
  AI_MEDIA_STUDIO_OAUTH_TIKTOK_CLIENT_ID: "tiktok-client",
  AI_MEDIA_STUDIO_OAUTH_TIKTOK_REDIRECT_URI: "https://app.example.com/oauth/tiktok/callback",
  AI_MEDIA_STUDIO_OAUTH_YOUTUBE_SHORTS_CLIENT_ID: "youtube.apps.googleusercontent.com",
  AI_MEDIA_STUDIO_OAUTH_YOUTUBE_SHORTS_REDIRECT_URI: "https://app.example.com/oauth/youtube/callback",
};

class NoNetworkClient implements S3KmsCommandClient {
  calls = 0;
  async send(): Promise<never> {
    this.calls += 1;
    throw new Error("network must not run during composition");
  }
}

test("production OAuth runtime is unavailable only when the entire namespace is absent", () => {
  assert.deepEqual(createProductionOAuthRuntimeFromEnvironment({}), { available: false, reason: "not_configured" });
});

test("full production OAuth config maps current manifests to no-PKCE policies without network or secrets exposure", async () => {
  const client = new NoNetworkClient();
  const runtime = createProductionOAuthRuntimeFromEnvironment(fullEnvironment, {
    s3Client: client,
    clock: { now: () => new Date("2026-07-21T12:00:00.000Z") },
  });
  assert.equal(runtime.available, true);
  if (!runtime.available) return;
  assert.deepEqual(runtime.enabledPlatforms, ["tiktok", "youtube_shorts"]);
  assert.equal(client.calls, 0);
  const service = runtime.createService({
    repository: new InMemoryOAuthSessionRepository(),
    accounts: { async assertConnectable() {} },
    now: () => new Date("2026-07-21T12:00:00.000Z"),
  });
  assert.equal(typeof service.start, "function");
  assert.equal(client.calls, 0);

  const started = await service.start({
    scope: { ownerUserId: "owner-1", workspaceId: "workspace-1" },
    actorUserId: "actor-1",
    providerAccountId: "11111111-1111-4111-8111-111111111111",
    platform: "youtube_shorts",
  });
  assert.equal(started.codeChallenge, undefined);
  assert.equal(client.calls, 0, "pkce none must not touch S3");

  const tiktok = new URL(runtime.authorizationUrl({ platform: "tiktok", state: "s".repeat(64) }));
  assert.equal(tiktok.searchParams.has("code_challenge"), false);
  const google = new URL(runtime.authorizationUrl({ platform: "youtube_shorts", state: "s".repeat(64) }));
  assert.equal(google.searchParams.has("code_challenge_method"), false);
  assert.equal(google.searchParams.get("access_type"), "offline");
  assert.throws(() => runtime.authorizationUrl({
    platform: "youtube_shorts", state: "s".repeat(64), codeChallenge: "c".repeat(43),
  }), /authorization configuration is invalid/);
  assert.equal(client.calls, 0);
  assert.equal(JSON.stringify(runtime).includes("client"), false);
  assert.equal(JSON.stringify(runtime).includes("kms"), false);
});

test("partial, unknown, ambiguous, static-credential, and unsafe config fails closed with one safe message", () => {
  const secret = "AKIA_MUST_NOT_LEAK";
  const cases: ProductionOAuthEnvironment[] = [
    { AI_MEDIA_STUDIO_OAUTH_PKCE_BUCKET: "partial" },
    { ...fullEnvironment, AI_MEDIA_STUDIO_OAUTH_UNSUPPORTED: "true" },
    { ...fullEnvironment, AI_MEDIA_STUDIO_OAUTH_UNDEFINED_UNKNOWN: undefined },
    { ...fullEnvironment, AI_MEDIA_STUDIO_OAUTH_AWS_ACCESS_KEY_ID: secret },
    { ...fullEnvironment, AI_MEDIA_STUDIO_OAUTH_ENABLED_PLATFORMS: "tiktok,tiktok" },
    { ...fullEnvironment, AI_MEDIA_STUDIO_OAUTH_INSTAGRAM_CLIENT_ID: "disabled-but-present" },
    { ...fullEnvironment, AI_MEDIA_STUDIO_OAUTH_TIKTOK_REDIRECT_URI: `https://user:${secret}@app.example.com/callback` },
    { ...fullEnvironment, AI_MEDIA_STUDIO_OAUTH_KMS_KEY_ARN: "arn:aws:kms:us-east-1:123456789012:alias/oauth" },
    { ...fullEnvironment, AI_MEDIA_STUDIO_OAUTH_PKCE_PREFIX: "custom/prefix" },
  ];
  for (const environment of cases) {
    let message = "";
    assert.throws(() => createProductionOAuthRuntimeFromEnvironment(environment), (error) => {
      message = error instanceof Error ? error.message : String(error);
      return message === "AI Media Studio production OAuth configuration is invalid";
    });
    assert.equal(message.includes(secret), false);
  }
});

test("runtime rejects authorization for a platform that is not enabled", () => {
  const runtime = createProductionOAuthRuntimeFromEnvironment(fullEnvironment, { s3Client: new NoNetworkClient() });
  assert.equal(runtime.available, true);
  if (!runtime.available) return;
  assert.throws(() => runtime.authorizationUrl({
    platform: "facebook", state: "s".repeat(64),
  }), /rejected/);
});
