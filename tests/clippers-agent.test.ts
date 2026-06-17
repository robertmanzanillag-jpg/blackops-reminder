import assert from "node:assert/strict";
import { stat } from "node:fs/promises";
import test from "node:test";
import { __clipperInternals, bootstrapClipperAccounts, bootstrapClipperWorkspace, buildClipperConnectActions, getClipperStatus, recordClipperOAuthCallback, runClipperDailyPlan } from "../server/clippers-agent";

test("normalizeRunOptions clamps clips and defaults publish mode", () => {
  const result = __clipperInternals.normalizeRunOptions({
    clipsPerAccount: 999,
    publishMode: "anything",
    riskTolerance: "wild",
  });

  assert.equal(result.clipsPerAccount, 50);
  assert.equal(result.publishMode, "approval_required");
  assert.equal(result.riskTolerance, "growth");
});

test("runClipperDailyPlan creates drafts for each configured account", async () => {
  const { report, status } = await runClipperDailyPlan({
    clipsPerAccount: 2,
    publishMode: "draft_only",
    riskTolerance: "safe",
  });

  assert.equal(report.publishMode, "draft_only");
  assert.equal(report.riskTolerance, "safe");
  assert.equal(report.plannedClips.length, status.accounts.length * 2);
  assert.ok(report.nextActions.some((action) => action.includes("TikTok")));
});

test("getClipperStatus exposes guarded growth goals", async () => {
  const status = await getClipperStatus();

  assert.ok(status.goals.totalWeeklyGoal >= 3_000_000);
  assert.ok(status.guardrails.some((rule) => rule.includes("licenciado")));
  assert.ok(status.agents.some((agent) => agent.id === "rights-gate"));
});

test("bootstrapClipperAccounts prepares platform accounts and permission queue", async () => {
  const status = await bootstrapClipperAccounts();
  const platformAccounts = status.accounts.flatMap((account) => account.platformAccounts);

  assert.equal(platformAccounts.length, status.accounts.length * 3);
  assert.ok(platformAccounts.some((account) => account.platform === "tiktok" && account.requiredScopes.includes("video.publish")));
  assert.ok(platformAccounts.some((account) => account.platform === "youtube" && account.requiredScopes.includes("https://www.googleapis.com/auth/youtube.upload")));
  assert.ok(status.permissionQueue.some((permission) => permission.scope === "instagram_content_publish"));
  assert.ok(status.platformRequirements.every((platform) => platform.humanRequired.length > 0));
});

test("bootstrapClipperWorkspace prepares source folders and credential checks", async () => {
  const status = await bootstrapClipperWorkspace();

  assert.ok(status.sourceFolders.some((folder) => folder.category === "sports"));
  assert.ok(status.sourceFolders.some((folder) => folder.category === "allowlist"));
  assert.equal(status.credentialChecks.length, 3);
  assert.ok(status.credentialChecks.some((check) => check.platform === "tiktok" && check.requiredEnvVars.includes("TIKTOK_CLIENT_KEY")));

  const sportsFolder = status.sourceFolders.find((folder) => folder.category === "sports");
  assert.ok(sportsFolder);
  const folderStat = await stat(sportsFolder.path);
  assert.equal(folderStat.isDirectory(), true);
});

test("buildClipperConnectActions blocks missing OAuth credentials", () => {
  const originalTikTokKey = process.env.TIKTOK_CLIENT_KEY;
  const originalGoogleClientId = process.env.GOOGLE_CLIENT_ID;
  delete process.env.TIKTOK_CLIENT_KEY;
  delete process.env.GOOGLE_CLIENT_ID;

  try {
    const actions = buildClipperConnectActions();
    assert.equal(actions.find((action) => action.platform === "tiktok")?.status, "blocked");
    assert.equal(actions.find((action) => action.platform === "youtube")?.authUrl, null);
  } finally {
    if (originalTikTokKey) process.env.TIKTOK_CLIENT_KEY = originalTikTokKey;
    if (originalGoogleClientId) process.env.GOOGLE_CLIENT_ID = originalGoogleClientId;
  }
});

test("buildClipperConnectActions creates OAuth URL when env is present", () => {
  const originalTikTokKey = process.env.TIKTOK_CLIENT_KEY;
  const originalTikTokSecret = process.env.TIKTOK_CLIENT_SECRET;
  process.env.TIKTOK_CLIENT_KEY = "test-client-key";
  process.env.TIKTOK_CLIENT_SECRET = "test-client-secret";

  try {
    const action = buildClipperConnectActions().find((item) => item.platform === "tiktok");
    assert.equal(action?.status, "ready");
    assert.ok(action?.authUrl?.includes("client_key=test-client-key"));
    assert.ok(action?.authUrl?.includes("video.publish"));
  } finally {
    if (originalTikTokKey) process.env.TIKTOK_CLIENT_KEY = originalTikTokKey;
    else delete process.env.TIKTOK_CLIENT_KEY;
    if (originalTikTokSecret) process.env.TIKTOK_CLIENT_SECRET = originalTikTokSecret;
    else delete process.env.TIKTOK_CLIENT_SECRET;
  }
});

test("recordClipperOAuthCallback stores hashed OAuth metadata and updates account state", async () => {
  const connection = await recordClipperOAuthCallback({
    platform: "tiktok",
    code: "sample-auth-code",
    state: "clippers-tiktok",
  });

  assert.equal(connection.status, "code_received");
  assert.equal(connection.codeHash, __clipperInternals.hashOAuthCode("sample-auth-code"));
  assert.notEqual(connection.codeHash, "sample-auth-code");

  const status = await getClipperStatus();
  assert.ok(status.oauthConnections.some((item) => item.platform === "tiktok" && item.status === "code_received"));
  assert.ok(status.accounts.some((account) =>
    account.platformAccounts.some((platformAccount) => platformAccount.platform === "tiktok" && platformAccount.status === "needs_review")
  ));
});
