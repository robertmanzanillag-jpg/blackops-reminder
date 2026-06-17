import assert from "node:assert/strict";
import { stat } from "node:fs/promises";
import test from "node:test";
import { __clipperInternals, bootstrapClipperAccounts, bootstrapClipperWorkspace, getClipperStatus, runClipperDailyPlan } from "../server/clippers-agent";

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
