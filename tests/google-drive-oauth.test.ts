import assert from "node:assert/strict";
import test from "node:test";
import type { Request } from "express";
import { createGoogleDriveAuthorizationUrl, getGoogleDriveOAuthStatus } from "../server/google-drive-oauth";

const GOOGLE_DRIVE_ALIAS_ENV_VARS = [
  "GOOGLE_DRIVE_CLIENT_ID",
  "GOOGLE_DRIVE_OAUTH_CLIENT_ID",
  "GOOGLE_CLIENT_ID",
  "GOOGLE_OAUTH_CLIENT_ID",
  "YOUTUBE_CLIENT_ID",
  "YOUTUBE_OAUTH_CLIENT_ID",
  "GOOGLE_DRIVE_CLIENT_SECRET",
  "GOOGLE_DRIVE_OAUTH_CLIENT_SECRET",
  "GOOGLE_CLIENT_SECRET",
  "GOOGLE_OAUTH_CLIENT_SECRET",
  "YOUTUBE_CLIENT_SECRET",
  "YOUTUBE_OAUTH_CLIENT_SECRET",
  "GOOGLE_DRIVE_REFRESH_TOKEN",
  "GOOGLE_REFRESH_TOKEN",
  "GOOGLE_OAUTH_REFRESH_TOKEN",
  "YOUTUBE_REFRESH_TOKEN",
];

function snapshotEnv(names: string[]) {
  return new Map(names.map((name) => [name, process.env[name]]));
}

function clearEnv(names: string[]) {
  for (const name of names) delete process.env[name];
}

function restoreEnv(snapshot: Map<string, string | undefined>) {
  for (const [name, value] of snapshot) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
}

function mockRequest(host = "127.0.0.1:5013"): Request {
  return {
    get(name: string) {
      return name.toLowerCase() === "host" ? host : undefined;
    },
    protocol: "http",
  } as Request;
}

test("Google Drive OAuth accepts extended client aliases", async () => {
  const snapshot = snapshotEnv(GOOGLE_DRIVE_ALIAS_ENV_VARS);
  clearEnv(GOOGLE_DRIVE_ALIAS_ENV_VARS);
  process.env.GOOGLE_OAUTH_CLIENT_ID = "google-oauth-client-id";
  process.env.GOOGLE_OAUTH_CLIENT_SECRET = "google-oauth-client-secret";

  try {
    const url = new URL(createGoogleDriveAuthorizationUrl("test-user", mockRequest()));
    assert.equal(url.searchParams.get("client_id"), "google-oauth-client-id");
    assert.equal(url.searchParams.get("access_type"), "offline");
    assert.ok(url.searchParams.get("scope")?.includes("https://www.googleapis.com/auth/drive.file"));

    const status = await getGoogleDriveOAuthStatus("test-user");
    assert.equal(status.configured, true);
    assert.equal(status.connected, false);
    assert.equal(JSON.stringify(status).includes("google-oauth-client-secret"), false);
  } finally {
    restoreEnv(snapshot);
  }
});

test("Google Drive OAuth accepts extended refresh token aliases", async () => {
  const snapshot = snapshotEnv(GOOGLE_DRIVE_ALIAS_ENV_VARS);
  clearEnv(GOOGLE_DRIVE_ALIAS_ENV_VARS);
  process.env.YOUTUBE_REFRESH_TOKEN = "youtube-refresh-token";

  try {
    const status = await getGoogleDriveOAuthStatus("test-user");
    assert.equal(status.configured, true);
    assert.equal(status.connected, true);
    assert.equal(status.provider, "env_refresh_token");
    assert.equal(JSON.stringify(status).includes("youtube-refresh-token"), false);
  } finally {
    restoreEnv(snapshot);
  }
});
