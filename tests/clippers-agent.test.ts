import assert from "node:assert/strict";
import { mkdir, readFile, stat, unlink, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { mock, test } from "node:test";
import { promises as dns } from "node:dns";
import path from "node:path";
import { __clipperInternals, bootstrapClipperAccounts, bootstrapClipperWorkspace, buildClipperConnectActions, getClipperStatus, importClipperCredentialDropFiles, importClipperLaunchEvidenceDropFiles, importClipperSourceDropFiles, ingestClipperMetrics, ingestClipperTrends, prepareClipperAccountCreationPack, prepareClipperAccountEvidenceVault, prepareClipperAccountIdentityKit, prepareClipperAccountLaunchKit, prepareClipperAppReviewDemoPack, prepareClipperAppReviewSubmissionPack, prepareClipperAutomationSchedule, prepareClipperBlockerResolutionPack, prepareClipperCredentialDoctor, prepareClipperCredentialSetupCenter, prepareClipperDeveloperAppEvidenceVault, prepareClipperDeveloperApplicationDrafts, prepareClipperDraftSpecs, prepareClipperDriveWorkspace, prepareClipperExternalExecutionHandoff, prepareClipperExternalExecutionSession, prepareClipperExternalLaunchDossier, prepareClipperExternalSetupQueue, prepareClipperGoLiveAutopilotBrief, prepareClipperGoLiveExecutionPack, prepareClipperHttpsTunnelPlan, prepareClipperIntakeKit, prepareClipperLaunchCommandCenter, prepareClipperLegalPolicyPack, prepareClipperManualPostingPack, prepareClipperOAuthConnectionPack, prepareClipperOAuthGoLivePreflight, prepareClipperOfficialPermissionMatrix, prepareClipperPermissionPack, prepareClipperPermissionRequestPack, prepareClipperPermissionTracker, prepareClipperPlatformPortalChecklist, prepareClipperPlatformReadinessMatrix, prepareClipperProductionQueue, prepareClipperProductionUrlSetup, prepareClipperPublisherConnectors, prepareClipperPublishingPackage, prepareClipperRightsOutreachPack, prepareClipperSourceAcquisitionPlan, prepareClipperSourceHuntSheet, prepareClipperTrendRightsOutreachPack, prepareClipperViralDiscoveryPack, previewClipperCredentialSecretsBatch, previewClipperLaunchEvidenceBatch, recordClipperAccountEvidence, recordClipperCredentialSecret, recordClipperCredentialSecretsBatch, recordClipperDeveloperAppEvidence, recordClipperLaunchEvidenceBatch, recordClipperOAuthCallback, recordClipperPermissionStatus, recordClipperProductionPublicUrl, recordClipperSourceIntakeBatch, recordClipperSourceRights, recordClipperTrendCandidatesBatch, reloadClipperCredentials, renderClipperDraftVideos, runClipperAutomationCycle, runClipperDailyPlan, runClipperGoLiveAutopilot, saveClipperTokenPayload, verifyClipperProductionUrl } from "../server/clippers-agent";

const GOOGLE_OAUTH_ALIAS_ENV_VARS = [
  "GOOGLE_CLIENT_ID",
  "GOOGLE_OAUTH_CLIENT_ID",
  "GOOGLE_OAUTH2_CLIENT_ID",
  "GOOGLE_WEB_CLIENT_ID",
  "GOOGLE_DRIVE_CLIENT_ID",
  "GOOGLE_DRIVE_OAUTH_CLIENT_ID",
  "GOOGLE_DRIVE_OAUTH2_CLIENT_ID",
  "GOOGLE_DRIVE_WEB_CLIENT_ID",
  "YOUTUBE_CLIENT_ID",
  "YOUTUBE_OAUTH_CLIENT_ID",
  "YOUTUBE_OAUTH2_CLIENT_ID",
  "YOUTUBE_WEB_CLIENT_ID",
  "GOOGLE_CLIENT_SECRET",
  "GOOGLE_OAUTH_CLIENT_SECRET",
  "GOOGLE_OAUTH2_CLIENT_SECRET",
  "GOOGLE_WEB_CLIENT_SECRET",
  "GOOGLE_DRIVE_CLIENT_SECRET",
  "GOOGLE_DRIVE_OAUTH_CLIENT_SECRET",
  "GOOGLE_DRIVE_OAUTH2_CLIENT_SECRET",
  "GOOGLE_DRIVE_WEB_CLIENT_SECRET",
  "YOUTUBE_CLIENT_SECRET",
  "YOUTUBE_OAUTH_CLIENT_SECRET",
  "YOUTUBE_OAUTH2_CLIENT_SECRET",
  "YOUTUBE_WEB_CLIENT_SECRET",
  "GOOGLE_DRIVE_REFRESH_TOKEN",
  "GOOGLE_REFRESH_TOKEN",
  "GOOGLE_OAUTH_REFRESH_TOKEN",
  "GOOGLE_OAUTH2_REFRESH_TOKEN",
  "YOUTUBE_REFRESH_TOKEN",
  "YOUTUBE_OAUTH_REFRESH_TOKEN",
  "YOUTUBE_OAUTH2_REFRESH_TOKEN",
];

function snapshotEnv(names: string[]): Record<string, string | undefined> {
  return Object.fromEntries(names.map((name) => [name, process.env[name]]));
}

function clearEnv(names: string[]) {
  for (const name of names) delete process.env[name];
}

function restoreEnv(snapshot: Record<string, string | undefined>) {
  for (const [name, value] of Object.entries(snapshot)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
}

function writeTinyTestVideo(outputPath: string) {
  const result = spawnSync("ffmpeg", [
    "-y",
    "-f", "lavfi",
    "-i", "color=c=blue:s=720x1280:d=1",
    "-f", "lavfi",
    "-i", "anullsrc=channel_layout=stereo:sample_rate=44100",
    "-shortest",
    "-c:v", "libx264",
    "-pix_fmt", "yuv420p",
    "-c:a", "aac",
    outputPath,
  ], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr || result.stdout);
}

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
  const userId = "clipper-owner-a";
  const { report, status } = await runClipperDailyPlan({
    clipsPerAccount: 2,
    publishMode: "draft_only",
    riskTolerance: "safe",
  }, userId);

  assert.equal(report.userId, userId);
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
  assert.ok(status.growthAudit.score >= 0 && status.growthAudit.score <= 100);
  assert.ok(status.growthAudit.items.some((item) => item.id === "metrics-loop" && item.status === "critical"));
  assert.ok(status.growthAudit.items.some((item) => item.id === "google-drive-workspace"));
  assert.ok(status.growthAudit.roadmap.some((step) => step.includes("metricas")));
  assert.ok(["missing_keys", "needs_oauth", "ready", "error"].includes(status.driveWorkspace.status));
  assert.ok(status.driveWorkspace.envDiagnostics.envFilesChecked.includes("CEO_ASSISTANT_ENV"));
  assert.ok(status.driveWorkspace.envDiagnostics.envFilesChecked.includes(".env.development"));
  assert.ok(status.driveWorkspace.envDiagnostics.acceptedClientIdAliases.includes("GOOGLE_CLIENT_ID"));
  assert.ok(Array.isArray(status.driveWorkspace.envDiagnostics.envFilesWithAcceptedAliases));
  assert.equal(status.driveWorkspace.oauthSetup.authPath, "/api/google-drive/auth");
  assert.equal(status.driveWorkspace.oauthSetup.callbackPath, "/api/google-drive/oauth/callback");
  assert.ok(status.driveWorkspace.oauthSetup.recommendedRedirectUris.some((uri) => uri.includes("/api/google-drive/oauth/callback")));
  assert.ok(status.driveWorkspace.oauthSetup.scopes.includes("https://www.googleapis.com/auth/drive.file"));
  assert.ok(status.driveWorkspace.folders.some((folder) => folder.id === "metrics-inbox"));
  assert.ok(status.driveWorkspace.envDiagnostics.credentialTemplatePath.endsWith("google-drive-env-template.env"));
  assert.ok(status.driveWorkspace.envDiagnostics.requiredEnvTemplateRows.includes("GOOGLE_CLIENT_ID="));
  assert.ok(status.metrics.metricsDir.endsWith("metrics"));
  assert.ok(status.trendRadar.trendsDir.endsWith("trends"));
  assert.ok(status.growthAudit.items.some((item) => item.id === "trend-radar"));
  assert.ok(status.automationSchedule.manifestPath.endsWith("automation-schedule.json"));
  assert.equal(status.budgetPlanner.targetWeeklyClips, 100);
  assert.equal(status.budgetPlanner.recommendedScenarioId, "growth");
  assert.ok(status.budgetPlanner.scenarios.some((scenario) => scenario.id === "growth" && scenario.weeklyCostLow > 0));
  assert.equal(status.accountLaunchKit.tasks.length, status.accounts.length * 3);
  assert.ok(status.growthAudit.items.some((item) => item.id === "account-launch-kit"));
  assert.equal(status.accountEvidence.totals.expected, status.accounts.length * 3);
  assert.ok(status.growthAudit.items.some((item) => item.id === "account-evidence"));
  assert.equal(status.developerAppEvidence.totals.expected, 3);
  assert.ok(status.growthAudit.items.some((item) => item.id === "developer-app-evidence"));
  assert.ok(status.commandCenter.steps.some((step) => step.id === "external-accounts"));
  assert.ok(status.commandCenter.steps.some((step) => step.id === "developer-apps"));
  assert.ok(status.commandCenter.steps.some((step) => step.id === "credential-setup"));
  assert.ok(status.commandCenter.steps.some((step) => step.id === "intake-kit"));
  assert.ok(status.credentialSetup.items.some((item) => item.id === "google-youtube-oauth"));
  assert.ok(status.intakeKit.files.some((file) => file.id === "trend-opportunities"));
  assert.equal(status.permissionTracker.items.length, status.permissionQueue.length);
  assert.ok(status.permissionTracker.officialSources.some((source) => source.includes("developers.tiktok.com")));
  assert.ok(status.growthAudit.items.some((item) => item.id === "permission-tracker"));
  assert.ok(status.growthAudit.items.some((item) => item.id === "oauth-connection-pack"));
  assert.ok(status.commandCenter.steps.some((step) => step.id === "oauth-connection-pack"));
  assert.ok(status.commandCenter.steps.some((step) => step.id === "publishing-package"));
  assert.ok(status.growthAudit.items.some((item) => item.id === "publishing-package"));
  assert.equal(status.publishingPackage.manifestPath.endsWith("publishing-package.json"), true);
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
  assert.ok(status.sourceFolders.some((folder) => folder.category === "developerAppEvidence"));
  assert.equal(status.credentialChecks.length, 3);
  assert.ok(status.credentialChecks.some((check) => check.platform === "tiktok" && check.requiredEnvVars.includes("TIKTOK_CLIENT_KEY")));

  const sportsFolder = status.sourceFolders.find((folder) => folder.category === "sports");
  assert.ok(sportsFolder);
  const folderStat = await stat(sportsFolder.path);
  assert.equal(folderStat.isDirectory(), true);
});

test("prepareClipperCredentialSetupCenter writes safe setup docs and accepts Google Drive aliases", async () => {
  const originalGoogleClientId = process.env.GOOGLE_CLIENT_ID;
  const originalGoogleClientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const originalDriveClientId = process.env.GOOGLE_DRIVE_CLIENT_ID;
  const originalDriveClientSecret = process.env.GOOGLE_DRIVE_CLIENT_SECRET;
  delete process.env.GOOGLE_CLIENT_ID;
  delete process.env.GOOGLE_CLIENT_SECRET;
  process.env.GOOGLE_DRIVE_CLIENT_ID = "drive-client-id";
  process.env.GOOGLE_DRIVE_CLIENT_SECRET = "drive-client-secret";

  try {
    const { credentialSetup, status } = await prepareClipperCredentialSetupCenter();
    assert.ok(credentialSetup.readmePath.endsWith("credential-setup/README.md"));
    assert.ok(credentialSetup.templatePath.endsWith("credential-setup/clippers-env-template.env"));
    assert.ok(credentialSetup.missingTemplatePath.endsWith("credential-setup/missing-env-template.env"));
    assert.ok(credentialSetup.items.some((item) => item.id === "google-youtube-oauth" && item.status === "ready"));
    assert.ok(credentialSetup.importPlan.some((item) => item.id === "google-youtube-oauth" && item.supportedInputFormats.includes("Google OAuth JSON client")));
    assert.ok(credentialSetup.importPlan.every((item) => item.verificationSteps.length >= 3));
    assert.ok(credentialSetup.envFileScans.some((file) => file.fileName === "CEO_ASSISTANT_ENV"));
    assert.ok(status.credentialChecks.some((check) => check.platform === "youtube" && check.status === "ready"));

    const readmeStat = await stat(credentialSetup.readmePath);
    const templateStat = await stat(credentialSetup.templatePath);
    const missingTemplateStat = await stat(credentialSetup.missingTemplatePath);
    assert.equal(readmeStat.isFile(), true);
    assert.equal(templateStat.isFile(), true);
    assert.equal(missingTemplateStat.isFile(), true);

    const template = await readFile(credentialSetup.templatePath, "utf8");
    const missingTemplate = await readFile(credentialSetup.missingTemplatePath, "utf8");
    const readme = await readFile(credentialSetup.readmePath, "utf8");
    assert.ok(template.includes("GOOGLE_DRIVE_CLIENT_ID"));
    assert.ok(missingTemplate.includes("TIKTOK_CLIENT_KEY"));
    assert.ok(readme.includes("Fast Import"));
    assert.ok(readme.includes("Import Plan"));
    assert.ok(readme.includes("Safe Env File Audit"));
    assert.ok(readme.includes("Credential File Candidates"));
    assert.ok(readme.includes("Paste template"));
    assert.ok(readme.includes("JSON OAuth client"));
    assert.ok(readme.includes("GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET"));
    assert.equal(template.includes("drive-client-id"), false);
    assert.equal(missingTemplate.includes("drive-client-secret"), false);
    assert.equal(readme.includes("drive-client-secret"), false);
  } finally {
    if (originalGoogleClientId) process.env.GOOGLE_CLIENT_ID = originalGoogleClientId;
    else delete process.env.GOOGLE_CLIENT_ID;
    if (originalGoogleClientSecret) process.env.GOOGLE_CLIENT_SECRET = originalGoogleClientSecret;
    else delete process.env.GOOGLE_CLIENT_SECRET;
    if (originalDriveClientId) process.env.GOOGLE_DRIVE_CLIENT_ID = originalDriveClientId;
    else delete process.env.GOOGLE_DRIVE_CLIENT_ID;
    if (originalDriveClientSecret) process.env.GOOGLE_DRIVE_CLIENT_SECRET = originalDriveClientSecret;
    else delete process.env.GOOGLE_DRIVE_CLIENT_SECRET;
  }
});

test("prepareClipperCredentialSetupCenter lists credential file candidates without reading secrets", async () => {
  const candidateDir = path.join(process.cwd(), "credentials");
  await mkdir(candidateDir, { recursive: true });
  const candidatePath = path.join(candidateDir, "google-oauth-client.test.json");
  await writeFile(candidatePath, JSON.stringify({
    web: {
      client_id: "candidate-google-client-id",
      client_secret: "candidate-google-client-secret",
    },
  }));

  try {
    const { credentialSetup } = await prepareClipperCredentialSetupCenter();
    const candidate = credentialSetup.credentialFileScans.find((file) => file.fileName === "google-oauth-client.test.json");
    assert.ok(candidate);
    assert.ok(credentialSetup.credentialDropDirs.some((dir) => dir.endsWith("credentials")));
    assert.ok(credentialSetup.credentialDropDirs.some((dir) => dir.endsWith("secrets")));
    assert.equal(candidate.kind, "google_oauth_json");
    assert.equal(candidate.suggestedImportTarget, "google-youtube-oauth");
    assert.equal(JSON.stringify(candidate).includes("candidate-google-client-secret"), false);

    const readme = await readFile(credentialSetup.readmePath, "utf8");
    assert.ok(readme.includes("Credential File Candidates"));
    assert.ok(readme.includes("Credential drop dirs"));
    assert.ok(readme.includes("google-oauth-client.test.json"));
    const gitignore = await readFile(path.join(process.cwd(), ".gitignore"), "utf8");
    assert.ok(gitignore.includes("credentials/*"));
    assert.ok(gitignore.includes("secrets/*"));
    assert.equal(readme.includes("candidate-google-client-secret"), false);
    assert.equal(readme.includes("candidate-google-client-id"), false);
  } finally {
    await unlink(candidatePath).catch(() => undefined);
  }
});

test("prepareClipperCredentialSetupCenter accepts extended Google OAuth aliases", async () => {
  const googleSnapshot = snapshotEnv(GOOGLE_OAUTH_ALIAS_ENV_VARS);
  clearEnv(GOOGLE_OAUTH_ALIAS_ENV_VARS);
  process.env.GOOGLE_OAUTH_CLIENT_ID = "google-oauth-client-id";
  process.env.GOOGLE_OAUTH_CLIENT_SECRET = "google-oauth-client-secret";

  try {
    const { credentialSetup, status } = await prepareClipperCredentialSetupCenter();
    const googleItem = credentialSetup.items.find((item) => item.id === "google-youtube-oauth");
    assert.equal(googleItem?.status, "ready");
    assert.ok(googleItem?.configuredEnvVars.includes("GOOGLE_OAUTH_CLIENT_ID"));
    assert.ok(googleItem?.configuredEnvVars.includes("GOOGLE_OAUTH_CLIENT_SECRET"));
    assert.ok(credentialSetup.envFileScans.every((file) => file.relevantKeys.every((key) => !key.includes("secret"))));
    assert.ok(status.credentialChecks.some((check) => check.platform === "youtube" && check.status === "ready"));

    const template = await readFile(credentialSetup.templatePath, "utf8");
    const missingTemplate = await readFile(credentialSetup.missingTemplatePath, "utf8");
    assert.ok(template.includes("GOOGLE_OAUTH_CLIENT_ID"));
    assert.ok(template.includes("YOUTUBE_OAUTH_CLIENT_SECRET"));
    assert.equal(template.includes("google-oauth-client-secret"), false);
    assert.equal(missingTemplate.includes("GOOGLE_OAUTH_CLIENT_SECRET"), false);
  } finally {
    restoreEnv(googleSnapshot);
  }
});

test("reloadClipperCredentials loads CEO_ASSISTANT_ENV without exposing secret values", async () => {
  const envPath = path.join(process.cwd(), "CEO_ASSISTANT_ENV");
  const previousFile = await readFile(envPath, "utf8").catch(() => null);
  const originalGoogleClientId = process.env.GOOGLE_CLIENT_ID;
  const originalGoogleClientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const originalDriveClientId = process.env.GOOGLE_DRIVE_CLIENT_ID;
  const originalDriveClientSecret = process.env.GOOGLE_DRIVE_CLIENT_SECRET;
  const originalTokenKey = process.env.CLIPPERS_TOKEN_ENCRYPTION_KEY;

  delete process.env.GOOGLE_CLIENT_ID;
  delete process.env.GOOGLE_CLIENT_SECRET;
  delete process.env.GOOGLE_DRIVE_CLIENT_ID;
  delete process.env.GOOGLE_DRIVE_CLIENT_SECRET;
  delete process.env.CLIPPERS_TOKEN_ENCRYPTION_KEY;

  await writeFile(envPath, [
    "GOOGLE_DRIVE_CLIENT_ID=test-drive-client-id",
    "GOOGLE_DRIVE_CLIENT_SECRET=test-drive-client-secret",
    "CLIPPERS_TOKEN_ENCRYPTION_KEY=test-token-key-with-more-than-32-chars",
  ].join("\n"));

  try {
    const { credentialReload, status } = await reloadClipperCredentials();
    assert.ok(credentialReload.loadedFiles.includes("CEO_ASSISTANT_ENV"));
    assert.ok(credentialReload.envFilesFound.includes("CEO_ASSISTANT_ENV"));
    assert.ok(credentialReload.credentialSetup.items.some((item) => item.id === "google-youtube-oauth" && item.status === "ready"));
    assert.ok(credentialReload.credentialSetup.items.some((item) => item.id === "token-vault" && item.status === "ready"));
    assert.equal(status.driveWorkspace.status, "needs_oauth");
    assert.ok(status.credentialChecks.some((check) => check.platform === "youtube" && check.status === "ready"));

    const readme = await readFile(credentialReload.credentialSetup.readmePath, "utf8").catch(() => "");
    assert.equal(readme.includes("test-drive-client-secret"), false);
    assert.equal(readme.includes("test-token-key"), false);
  } finally {
    if (previousFile === null) await unlink(envPath).catch(() => undefined);
    else await writeFile(envPath, previousFile);
    if (originalGoogleClientId) process.env.GOOGLE_CLIENT_ID = originalGoogleClientId;
    else delete process.env.GOOGLE_CLIENT_ID;
    if (originalGoogleClientSecret) process.env.GOOGLE_CLIENT_SECRET = originalGoogleClientSecret;
    else delete process.env.GOOGLE_CLIENT_SECRET;
    if (originalDriveClientId) process.env.GOOGLE_DRIVE_CLIENT_ID = originalDriveClientId;
    else delete process.env.GOOGLE_DRIVE_CLIENT_ID;
    if (originalDriveClientSecret) process.env.GOOGLE_DRIVE_CLIENT_SECRET = originalDriveClientSecret;
    else delete process.env.GOOGLE_DRIVE_CLIENT_SECRET;
    if (originalTokenKey) process.env.CLIPPERS_TOKEN_ENCRYPTION_KEY = originalTokenKey;
    else delete process.env.CLIPPERS_TOKEN_ENCRYPTION_KEY;
  }
});

test("reloadClipperCredentials loads extended local env files and reports aliases without values", async () => {
  const envPath = path.join(process.cwd(), ".env.development");
  const previousFile = await readFile(envPath, "utf8").catch(() => null);
  const envVars = [
    "GOOGLE_OAUTH_CLIENT_ID",
    "GOOGLE_OAUTH_CLIENT_SECRET",
    "GOOGLE_OAUTH_REFRESH_TOKEN",
  ];
  const snapshot = snapshotEnv(envVars);
  clearEnv(envVars);

  await writeFile(envPath, [
    "GOOGLE_OAUTH_CLIENT_ID=development-google-client-id",
    "GOOGLE_OAUTH_CLIENT_SECRET=development-google-secret",
    "GOOGLE_OAUTH_REFRESH_TOKEN=development-refresh-token",
  ].join("\n"));

  try {
    const { credentialReload, status } = await reloadClipperCredentials();
    assert.ok(credentialReload.loadedFiles.includes(".env.development"));
    assert.equal(status.driveWorkspace.status, "needs_oauth");
    assert.ok(status.driveWorkspace.envDiagnostics.envFilesFound.includes(".env.development"));
    assert.ok(status.driveWorkspace.envDiagnostics.envFilesWithAcceptedAliases.some((file) =>
      file.fileName === ".env.development" &&
      file.aliases.includes("GOOGLE_OAUTH_CLIENT_ID") &&
      file.aliases.includes("GOOGLE_OAUTH_CLIENT_SECRET") &&
      file.aliases.includes("GOOGLE_OAUTH_REFRESH_TOKEN")
    ));
    assert.equal(JSON.stringify(status.driveWorkspace.envDiagnostics).includes("development-google-secret"), false);
    assert.equal(JSON.stringify(status.driveWorkspace.envDiagnostics).includes("development-refresh-token"), false);
  } finally {
    if (previousFile === null) await unlink(envPath).catch(() => undefined);
    else await writeFile(envPath, previousFile);
    restoreEnv(snapshot);
  }
});

test("prepareClipperDriveWorkspace writes safe Google Drive env template when keys are missing", async () => {
  const envVars = GOOGLE_OAUTH_ALIAS_ENV_VARS;
  const snapshot = snapshotEnv(envVars);
  clearEnv(envVars);
  let templatePath = "";

  try {
    const { driveWorkspace } = await prepareClipperDriveWorkspace();
    templatePath = driveWorkspace.envDiagnostics.credentialTemplatePath;

    assert.equal(driveWorkspace.status, "missing_keys");
    assert.ok(templatePath.endsWith("google-drive-env-template.env"));
    assert.ok(driveWorkspace.envDiagnostics.requiredEnvTemplateRows.includes("GOOGLE_DRIVE_REFRESH_TOKEN="));
    assert.equal(driveWorkspace.envDiagnostics.configuredClientIdAliases.length, 0);
    assert.equal(driveWorkspace.envDiagnostics.runtimeMissingGroups.length >= 2, true);

    const rawTemplate = await readFile(templatePath, "utf8");
    assert.ok(rawTemplate.includes("GOOGLE_CLIENT_ID="));
    assert.ok(rawTemplate.includes("GOOGLE_CLIENT_SECRET="));
    assert.ok(rawTemplate.includes("/api/google-drive/oauth/callback"));
    assert.equal(rawTemplate.includes("client_secret"), false);
    assert.equal(rawTemplate.includes("refresh-token"), false);
  } finally {
    if (templatePath) await unlink(templatePath).catch(() => undefined);
    restoreEnv(snapshot);
  }
});

test("prepareClipperDriveWorkspace tells user to reload when Google keys are only in env files", async () => {
  const envPath = path.join(process.cwd(), ".env.production.local");
  const previousFile = await readFile(envPath, "utf8").catch(() => null);
  const snapshot = snapshotEnv(GOOGLE_OAUTH_ALIAS_ENV_VARS);
  clearEnv(GOOGLE_OAUTH_ALIAS_ENV_VARS);

  await writeFile(envPath, [
    "GOOGLE_WEB_CLIENT_ID=file-google-web-client-id",
    "GOOGLE_WEB_CLIENT_SECRET=file-google-web-client-secret",
  ].join("\n"));

  try {
    const { driveWorkspace } = await prepareClipperDriveWorkspace();
    assert.equal(driveWorkspace.status, "missing_keys");
    assert.equal(driveWorkspace.envDiagnostics.envFilesNeedReload, true);
    assert.ok(driveWorkspace.envDiagnostics.detectedAcceptedAliasesInFiles.includes("GOOGLE_WEB_CLIENT_ID"));
    assert.ok(driveWorkspace.envDiagnostics.detectedAcceptedAliasesInFiles.includes("GOOGLE_WEB_CLIENT_SECRET"));
    assert.ok(driveWorkspace.nextStep.includes("Reload keys"));
    assert.equal(JSON.stringify(driveWorkspace.envDiagnostics).includes("file-google-web-client-secret"), false);
  } finally {
    if (previousFile === null) await unlink(envPath).catch(() => undefined);
    else await writeFile(envPath, previousFile);
    restoreEnv(snapshot);
  }
});

test("prepareClipperCredentialDoctor reports platform aliases without secret values", async () => {
  const envPath = path.join(process.cwd(), "CEO_ASSISTANT_ENV");
  const previousFile = await readFile(envPath, "utf8").catch(() => null);
  const originalTikTokClientKey = process.env.TIKTOK_CLIENT_KEY;
  const originalTikTokClientId = process.env.TIKTOK_CLIENT_ID;
  const originalMetaAppId = process.env.META_APP_ID;
  const originalFacebookAppId = process.env.FACEBOOK_APP_ID;
  const originalYoutubeClientId = process.env.YOUTUBE_CLIENT_ID;
  const originalYoutubeClientSecret = process.env.YOUTUBE_CLIENT_SECRET;

  delete process.env.TIKTOK_CLIENT_KEY;
  delete process.env.META_APP_ID;
  process.env.TIKTOK_CLIENT_ID = "alias-tiktok-client-id";
  process.env.FACEBOOK_APP_ID = "alias-facebook-app-id";
  process.env.YOUTUBE_CLIENT_ID = "alias-youtube-client-id";
  process.env.YOUTUBE_CLIENT_SECRET = "alias-youtube-client-secret";
  await writeFile(envPath, [
    "TIKTOK_CLIENT_ID=alias-tiktok-client-id",
    "FACEBOOK_APP_ID=alias-facebook-app-id",
    "YOUTUBE_CLIENT_ID=alias-youtube-client-id",
    "YOUTUBE_CLIENT_SECRET=alias-youtube-client-secret",
  ].join("\n"));

  try {
    const { credentialDoctor, status } = await prepareClipperCredentialDoctor();
    assert.ok(credentialDoctor.manifestPath.endsWith("credential-doctor.json"));
    assert.ok(credentialDoctor.markdownPath.endsWith("credential-doctor.md"));
    assert.ok(credentialDoctor.items.some((item) => item.id === "youtube-oauth" && item.status === "ready"));
    assert.ok(credentialDoctor.items.some((item) => item.id === "tiktok-oauth" && item.status === "partial" && item.configuredEnvVars.includes("TIKTOK_CLIENT_ID")));
    assert.ok(status.commandCenter.steps.some((step) => step.id === "credential-doctor" && step.actionUrl === "/api/clippers/prepare-credential-doctor"));

    const rawManifest = await readFile(credentialDoctor.manifestPath, "utf8");
    const rawMarkdown = await readFile(credentialDoctor.markdownPath, "utf8");
    assert.ok(rawManifest.includes("YOUTUBE_CLIENT_ID"));
    assert.ok(rawMarkdown.includes("FACEBOOK_APP_ID"));
    assert.equal(rawManifest.includes("alias-youtube-client-secret"), false);
    assert.equal(rawMarkdown.includes("alias-tiktok-client-id"), false);
  } finally {
    if (previousFile === null) await unlink(envPath).catch(() => undefined);
    else await writeFile(envPath, previousFile);
    if (originalTikTokClientKey) process.env.TIKTOK_CLIENT_KEY = originalTikTokClientKey;
    else delete process.env.TIKTOK_CLIENT_KEY;
    if (originalTikTokClientId) process.env.TIKTOK_CLIENT_ID = originalTikTokClientId;
    else delete process.env.TIKTOK_CLIENT_ID;
    if (originalMetaAppId) process.env.META_APP_ID = originalMetaAppId;
    else delete process.env.META_APP_ID;
    if (originalFacebookAppId) process.env.FACEBOOK_APP_ID = originalFacebookAppId;
    else delete process.env.FACEBOOK_APP_ID;
    if (originalYoutubeClientId) process.env.YOUTUBE_CLIENT_ID = originalYoutubeClientId;
    else delete process.env.YOUTUBE_CLIENT_ID;
    if (originalYoutubeClientSecret) process.env.YOUTUBE_CLIENT_SECRET = originalYoutubeClientSecret;
    else delete process.env.YOUTUBE_CLIENT_SECRET;
  }
});

test("recordClipperCredentialSecret upserts allowed keys without returning secret values", async () => {
  const envPath = path.join(process.cwd(), "CEO_ASSISTANT_ENV");
  const previousFile = await readFile(envPath, "utf8").catch(() => null);
  const originalMetaSecret = process.env.META_APP_SECRET;
  delete process.env.META_APP_SECRET;

  try {
    const { credentialSecret, status } = await recordClipperCredentialSecret({
      envVar: "META_APP_SECRET",
      value: "test-meta-secret-value",
    });

    assert.equal(credentialSecret.envVar, "META_APP_SECRET");
    assert.equal(credentialSecret.envFileName, "CEO_ASSISTANT_ENV");
    assert.ok(credentialSecret.configuredEnvVars.includes("META_APP_SECRET"));
    assert.ok(status.credentialDoctor.items.some((item) => item.id === "instagram-oauth" && item.configuredEnvVars.includes("META_APP_SECRET")));

    const rawEnv = await readFile(envPath, "utf8");
    assert.ok(rawEnv.includes("META_APP_SECRET=test-meta-secret-value"));

    const rawDoctor = await readFile(credentialSecret.credentialDoctor.manifestPath, "utf8");
    const rawReadme = await readFile(credentialSecret.credentialSetup.readmePath, "utf8");
    assert.equal(JSON.stringify(credentialSecret).includes("test-meta-secret-value"), false);
    assert.equal(rawDoctor.includes("test-meta-secret-value"), false);
    assert.equal(rawReadme.includes("test-meta-secret-value"), false);
  } finally {
    if (previousFile === null) await unlink(envPath).catch(() => undefined);
    else await writeFile(envPath, previousFile);
    if (originalMetaSecret) process.env.META_APP_SECRET = originalMetaSecret;
    else delete process.env.META_APP_SECRET;
  }
});

test("previewClipperCredentialSecretsBatch validates .env text without writing secrets", async () => {
  const envPath = path.join(process.cwd(), "CEO_ASSISTANT_ENV");
  const previousFile = await readFile(envPath, "utf8").catch(() => null);
  const originalTikTokKey = process.env.TIKTOK_CLIENT_KEY;
  delete process.env.TIKTOK_CLIENT_KEY;

  try {
    const { credentialSecretsBatchPreview } = await previewClipperCredentialSecretsBatch({
      envText: [
        "# Preview batch test",
        "TIKTOK_CLIENT_KEY=preview-tiktok-key",
        "NOT_ALLOWED_SECRET=bad-secret",
        "TIKTOK_CLIENT_SECRET=",
        "BROKEN_LINE",
      ].join("\n"),
    });

    assert.deepEqual(credentialSecretsBatchPreview.acceptedEnvVars, ["TIKTOK_CLIENT_KEY"]);
    assert.deepEqual(credentialSecretsBatchPreview.rejectedEnvVars, ["NOT_ALLOWED_SECRET"]);
    assert.equal(credentialSecretsBatchPreview.skippedLines >= 3, true);
    assert.equal(process.env.TIKTOK_CLIENT_KEY, undefined);

    const nextFile = await readFile(envPath, "utf8").catch(() => null);
    assert.equal(nextFile, previousFile);
    assert.equal(JSON.stringify(credentialSecretsBatchPreview).includes("preview-tiktok-key"), false);
    assert.equal(JSON.stringify(credentialSecretsBatchPreview).includes("bad-secret"), false);
  } finally {
    if (previousFile === null) await unlink(envPath).catch(() => undefined);
    else await writeFile(envPath, previousFile);
    if (originalTikTokKey) process.env.TIKTOK_CLIENT_KEY = originalTikTokKey;
    else delete process.env.TIKTOK_CLIENT_KEY;
  }
});

test("previewClipperCredentialSecretsBatch accepts Google OAuth client JSON without writing secrets", async () => {
  const envPath = path.join(process.cwd(), "CEO_ASSISTANT_ENV");
  const previousFile = await readFile(envPath, "utf8").catch(() => null);
  const envVars = ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"];
  const snapshot = snapshotEnv(envVars);
  clearEnv(envVars);

  try {
    const { credentialSecretsBatchPreview } = await previewClipperCredentialSecretsBatch({
      envText: JSON.stringify({
        web: {
          client_id: "json-google-client-id",
          client_secret: "json-google-client-secret",
          redirect_uris: ["https://example.com/api/google-drive/callback"],
        },
      }, null, 2),
    });

    assert.deepEqual(credentialSecretsBatchPreview.acceptedEnvVars, ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"]);
    assert.deepEqual(credentialSecretsBatchPreview.rejectedEnvVars, []);
    assert.equal(process.env.GOOGLE_CLIENT_ID, undefined);
    assert.equal(process.env.GOOGLE_CLIENT_SECRET, undefined);

    const nextFile = await readFile(envPath, "utf8").catch(() => null);
    assert.equal(nextFile, previousFile);
    assert.equal(JSON.stringify(credentialSecretsBatchPreview).includes("json-google-client-secret"), false);
    assert.equal(JSON.stringify(credentialSecretsBatchPreview).includes("json-google-client-id"), false);
  } finally {
    if (previousFile === null) await unlink(envPath).catch(() => undefined);
    else await writeFile(envPath, previousFile);
    restoreEnv(snapshot);
  }
});

test("recordClipperCredentialSecretsBatch imports .env text without returning secret values", async () => {
  const envPath = path.join(process.cwd(), "CEO_ASSISTANT_ENV");
  const previousFile = await readFile(envPath, "utf8").catch(() => null);
  const envVars = ["TIKTOK_CLIENT_KEY", "TIKTOK_CLIENT_SECRET", "META_APP_ID", "NOT_ALLOWED_SECRET"];
  const previousEnv = new Map(envVars.map((envVar) => [envVar, process.env[envVar]]));
  for (const envVar of envVars) delete process.env[envVar];

  try {
    const { credentialSecretsBatch, status } = await recordClipperCredentialSecretsBatch({
      envText: [
        "# Clippers batch test",
        "export TIKTOK_CLIENT_KEY=batch-tiktok-key",
        "TIKTOK_CLIENT_SECRET=\"batch-tiktok-secret\"",
        "META_APP_ID=batch-meta-id",
        "NOT_ALLOWED_SECRET=bad-secret",
        "BROKEN_LINE",
      ].join("\n"),
    });

    assert.deepEqual(credentialSecretsBatch.acceptedEnvVars, ["META_APP_ID", "TIKTOK_CLIENT_KEY", "TIKTOK_CLIENT_SECRET"]);
    assert.deepEqual(credentialSecretsBatch.rejectedEnvVars, ["NOT_ALLOWED_SECRET"]);
    assert.equal(credentialSecretsBatch.skippedLines >= 2, true);
    assert.ok(credentialSecretsBatch.configuredEnvVars.includes("TIKTOK_CLIENT_KEY"));
    assert.ok(status.credentialDoctor.items.some((item) => item.id === "tiktok-oauth" && item.status === "ready"));

    const rawEnv = await readFile(envPath, "utf8");
    assert.ok(rawEnv.includes("TIKTOK_CLIENT_KEY=batch-tiktok-key"));
    assert.ok(rawEnv.includes("TIKTOK_CLIENT_SECRET=batch-tiktok-secret"));
    assert.ok(rawEnv.includes("META_APP_ID=batch-meta-id"));
    assert.equal(rawEnv.includes("NOT_ALLOWED_SECRET=bad-secret"), false);

    const rawDoctor = await readFile(credentialSecretsBatch.credentialDoctor.manifestPath, "utf8");
    const rawReadme = await readFile(credentialSecretsBatch.credentialSetup.readmePath, "utf8");
    const responseJson = JSON.stringify(credentialSecretsBatch);
    for (const secretValue of ["batch-tiktok-key", "batch-tiktok-secret", "batch-meta-id", "bad-secret"]) {
      assert.equal(responseJson.includes(secretValue), false);
      assert.equal(rawDoctor.includes(secretValue), false);
      assert.equal(rawReadme.includes(secretValue), false);
    }
  } finally {
    if (previousFile === null) await unlink(envPath).catch(() => undefined);
    else await writeFile(envPath, previousFile);
    for (const envVar of envVars) {
      const previous = previousEnv.get(envVar);
      if (previous) process.env[envVar] = previous;
      else delete process.env[envVar];
    }
  }
});

test("recordClipperCredentialSecretsBatch imports Google OAuth client JSON safely", async () => {
  const envPath = path.join(process.cwd(), "CEO_ASSISTANT_ENV");
  const previousFile = await readFile(envPath, "utf8").catch(() => null);
  const envVars = ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"];
  const snapshot = snapshotEnv(envVars);
  clearEnv(envVars);

  try {
    const { credentialSecretsBatch, status } = await recordClipperCredentialSecretsBatch({
      envText: [
        "```json",
        JSON.stringify({
          installed: {
            client_id: "json-installed-google-client-id",
            client_secret: "json-installed-google-client-secret",
            redirect_uris: ["http://localhost"],
          },
        }, null, 2),
        "```",
      ].join("\n"),
    });

    assert.deepEqual(credentialSecretsBatch.acceptedEnvVars, ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"]);
    assert.ok(credentialSecretsBatch.configuredEnvVars.includes("GOOGLE_CLIENT_ID"));
    assert.ok(credentialSecretsBatch.configuredEnvVars.includes("GOOGLE_CLIENT_SECRET"));
    assert.ok(status.credentialDoctor.items.some((item) => item.id === "youtube-oauth" && item.status === "ready"));

    const rawEnv = await readFile(envPath, "utf8");
    assert.ok(rawEnv.includes("GOOGLE_CLIENT_ID=json-installed-google-client-id"));
    assert.ok(rawEnv.includes("GOOGLE_CLIENT_SECRET=json-installed-google-client-secret"));
    assert.equal(JSON.stringify(credentialSecretsBatch).includes("json-installed-google-client-secret"), false);
    assert.equal(JSON.stringify(credentialSecretsBatch).includes("json-installed-google-client-id"), false);
  } finally {
    if (previousFile === null) await unlink(envPath).catch(() => undefined);
    else await writeFile(envPath, previousFile);
    restoreEnv(snapshot);
  }
});

test("importClipperCredentialDropFiles imports credential and secret drop files safely", async () => {
  const envPath = path.join(process.cwd(), "CEO_ASSISTANT_ENV");
  const previousFile = await readFile(envPath, "utf8").catch(() => null);
  const credentialDir = path.join(process.cwd(), "credentials");
  const secretDir = path.join(process.cwd(), "secrets");
  const googlePath = path.join(credentialDir, "google-oauth-drop.test.json");
  const envDropPath = path.join(secretDir, "clipper-drop.test.env");
  const envVars = [
    "GOOGLE_CLIENT_ID",
    "GOOGLE_CLIENT_SECRET",
    "TIKTOK_CLIENT_KEY",
    "TIKTOK_CLIENT_SECRET",
    "NOT_ALLOWED_SECRET",
  ];
  const snapshot = snapshotEnv(envVars);
  clearEnv(envVars);
  await mkdir(credentialDir, { recursive: true });
  await mkdir(secretDir, { recursive: true });
  await writeFile(googlePath, JSON.stringify({
    web: {
      client_id: "drop-google-client-id",
      client_secret: "drop-google-client-secret",
    },
  }, null, 2));
  await writeFile(envDropPath, [
    "TIKTOK_CLIENT_KEY=drop-tiktok-key",
    "TIKTOK_CLIENT_SECRET=drop-tiktok-secret",
    "NOT_ALLOWED_SECRET=drop-bad-secret",
  ].join("\n"));

  try {
    const { credentialDropImport, status } = await importClipperCredentialDropFiles();
    assert.deepEqual(credentialDropImport.acceptedEnvVars, [
      "GOOGLE_CLIENT_ID",
      "GOOGLE_CLIENT_SECRET",
      "TIKTOK_CLIENT_KEY",
      "TIKTOK_CLIENT_SECRET",
    ]);
    assert.deepEqual(credentialDropImport.rejectedEnvVars, ["NOT_ALLOWED_SECRET"]);
    assert.equal(credentialDropImport.filesImported, 2);
    assert.ok(credentialDropImport.sourceFiles?.some((file) => file.endsWith("google-oauth-drop.test.json")));
    assert.ok(credentialDropImport.sourceFiles?.some((file) => file.endsWith("clipper-drop.test.env")));
    assert.ok(status.credentialDoctor.items.some((item) => item.id === "youtube-oauth" && item.status === "ready"));
    assert.ok(status.credentialDoctor.items.some((item) => item.id === "tiktok-oauth" && item.status === "ready"));

    const rawEnv = await readFile(envPath, "utf8");
    assert.ok(rawEnv.includes("GOOGLE_CLIENT_ID=drop-google-client-id"));
    assert.ok(rawEnv.includes("TIKTOK_CLIENT_SECRET=drop-tiktok-secret"));
    const responseJson = JSON.stringify(credentialDropImport);
    for (const secretValue of ["drop-google-client-secret", "drop-google-client-id", "drop-tiktok-key", "drop-tiktok-secret", "drop-bad-secret"]) {
      assert.equal(responseJson.includes(secretValue), false);
    }
  } finally {
    await unlink(googlePath).catch(() => undefined);
    await unlink(envDropPath).catch(() => undefined);
    if (previousFile === null) await unlink(envPath).catch(() => undefined);
    else await writeFile(envPath, previousFile);
    restoreEnv(snapshot);
  }
});

test("prepareClipperPermissionPack writes app review and OAuth setup files", async () => {
  const { pack, status } = await prepareClipperPermissionPack();

  assert.equal(status.permissionPack.status, "ready");
  assert.equal(pack.files.every((file) => file.exists), true);
  assert.ok(pack.files.some((file) => file.path.endsWith("tiktok-content-posting-api.md")));
  assert.ok(pack.files.some((file) => file.path.endsWith("redirect-uris.json")));

  const envFile = pack.files.find((file) => file.path.endsWith("oauth-env-template.env"));
  assert.ok(envFile);
  const envTemplate = await readFile(envFile.path, "utf8");
  assert.ok(envTemplate.includes("CLIPPERS_TOKEN_ENCRYPTION_KEY"));
  assert.equal(envTemplate.includes("plain-access-token"), false);

  const tiktokFile = pack.files.find((file) => file.path.endsWith("tiktok-content-posting-api.md"));
  assert.ok(tiktokFile);
  const tiktokReview = await readFile(tiktokFile.path, "utf8");
  assert.ok(tiktokReview.includes("Content Posting API"));
  assert.ok(tiktokReview.includes("/api/clippers/oauth/tiktok/callback"));
});

test("prepareClipperPermissionPack derives local redirect URIs from PORT when public base URL is absent", async () => {
  const originalPublicBaseUrl = process.env.PUBLIC_BASE_URL;
  const originalAppBaseUrl = process.env.APP_BASE_URL;
  const originalPort = process.env.PORT;

  delete process.env.PUBLIC_BASE_URL;
  delete process.env.APP_BASE_URL;
  process.env.PORT = "5999";

  try {
    const { pack } = await prepareClipperPermissionPack();
    const redirects = pack.files.find((file) => file.path.endsWith("redirect-uris.json"));
    assert.ok(redirects);
    const raw = await readFile(redirects.path, "utf8");
    assert.ok(raw.includes("http://127.0.0.1:5999/api/clippers/oauth/tiktok/callback"));
  } finally {
    if (originalPublicBaseUrl) process.env.PUBLIC_BASE_URL = originalPublicBaseUrl;
    else delete process.env.PUBLIC_BASE_URL;
    if (originalAppBaseUrl) process.env.APP_BASE_URL = originalAppBaseUrl;
    else delete process.env.APP_BASE_URL;
    if (originalPort) process.env.PORT = originalPort;
    else delete process.env.PORT;
  }
});

test("prepareClipperAccountIdentityKit writes profiles, prompts and first post ideas", async () => {
  const { accountIdentityKit, status } = await prepareClipperAccountIdentityKit();

  try {
    assert.equal(accountIdentityKit.accounts.length, status.accounts.length);
    assert.equal(accountIdentityKit.totals.platformProfiles, status.accounts.length * 3);
    assert.ok(accountIdentityKit.accounts.every((account) => account.contentPillars.length >= 3));
    assert.ok(accountIdentityKit.accounts.every((account) => account.platforms.every((platform) => platform.profileImagePrompt.length > 20 && platform.firstPostIdeas.length >= 3)));
    assert.ok(status.commandCenter.steps.some((step) => step.id === "account-identity-kit" && step.actionUrl === "/api/clippers/prepare-account-identity-kit"));

    const rawManifest = await readFile(accountIdentityKit.manifestPath, "utf8");
    const rawMarkdown = await readFile(accountIdentityKit.markdownPath, "utf8");
    assert.ok(rawMarkdown.includes("Clippers Account Identity Kit"));
    assert.ok(rawManifest.includes("usernameAlternatives"));
    assert.equal(rawManifest.includes("client_secret"), false);
    assert.equal(rawMarkdown.includes("access_token"), false);
  } finally {
    await unlink(accountIdentityKit.manifestPath).catch(() => undefined);
    await unlink(accountIdentityKit.markdownPath).catch(() => undefined);
  }
});

test("prepareClipperAccountLaunchKit writes account creation manifest", async () => {
  const { accountLaunchKit, status } = await prepareClipperAccountLaunchKit();

  try {
    assert.equal(accountLaunchKit.tasks.length, status.accounts.length * 3);
    assert.ok(accountLaunchKit.kitPath.endsWith("account-launch-kit.json"));
    assert.ok(accountLaunchKit.markdownPath.endsWith("account-launch-kit.md"));
    assert.ok(accountLaunchKit.tasks.some((task) => task.platform === "tiktok" && task.profileLink.includes("tiktok.com")));
    assert.ok(accountLaunchKit.tasks.every((task) => task.bio.length > 20));
    assert.ok(accountLaunchKit.tasks.every((task) => task.checklist.some((step) => step.includes("OAuth"))));

    const kitStat = await stat(accountLaunchKit.kitPath);
    const markdownStat = await stat(accountLaunchKit.markdownPath);
    assert.equal(kitStat.isFile(), true);
    assert.equal(markdownStat.isFile(), true);

    const markdown = await readFile(accountLaunchKit.markdownPath, "utf8");
    assert.ok(markdown.includes("Clippers Account Launch Kit"));
    assert.ok(markdown.includes("Create account"));
  } finally {
    await unlink(accountLaunchKit.kitPath).catch(() => undefined);
    await unlink(accountLaunchKit.markdownPath).catch(() => undefined);
  }
});

test("prepareClipperAccountCreationPack writes executable account creation CSV and runbook", async () => {
  const beforeStatus = await getClipperStatus();
  const previousManifest = await readFile(beforeStatus.accountCreationPack.manifestPath, "utf8").catch(() => null);
  const previousMarkdown = await readFile(beforeStatus.accountCreationPack.markdownPath, "utf8").catch(() => null);
  const previousCsv = await readFile(beforeStatus.accountCreationPack.csvPath, "utf8").catch(() => null);
  const previousClaimSheet = await readFile(beforeStatus.accountCreationPack.claimSheetPath, "utf8").catch(() => null);
  const previousClaimSheetCsv = await readFile(beforeStatus.accountCreationPack.claimSheetCsvPath, "utf8").catch(() => null);

  try {
    const { accountCreationPack, status } = await prepareClipperAccountCreationPack();
    assert.equal(accountCreationPack.items.length, status.accounts.reduce((sum, account) => sum + account.platformAccounts.length, 0));
    assert.ok(accountCreationPack.markdownPath.endsWith("account-creation-pack.md"));
    assert.ok(accountCreationPack.csvPath.endsWith("account-creation-pack.csv"));
    assert.ok(accountCreationPack.items.every((item) => item.signupUrl.startsWith("https://")));
    assert.ok(accountCreationPack.items.some((item) => item.platform === "youtube" && item.officialHelpUrl.includes("support.google.com")));
    assert.ok(accountCreationPack.items.every((item) => item.requiredInputs.length > 0 && item.completionHint.length > 20));
    assert.ok(accountCreationPack.items.every((item) => item.securityChecklist.length >= 4));
    assert.ok(accountCreationPack.items.every((item) => item.recoveryPlan.length >= 3));
    assert.ok(accountCreationPack.items.every((item) => item.platformProofRequired.length >= 4));
    assert.ok(accountCreationPack.items.some((item) => item.platform === "instagram" && item.platformProofRequired.some((proof) => proof.includes("Facebook Page"))));
    assert.ok(accountCreationPack.items.some((item) => item.platform === "youtube" && item.platformProofRequired.some((proof) => proof.includes("YouTube channel URL"))));
    assert.ok(accountCreationPack.items.every((item) => item.evidenceBatchRow.endsWith(',""')));
    assert.ok(accountCreationPack.items.every((item) => item.submittedEvidenceBatchRow.includes(",\"submitted\",")));
    assert.ok(accountCreationPack.items.every((item) => item.verifiedEvidenceBatchRow.includes(",\"verified\",")));
    assert.ok(accountCreationPack.items.every((item) => item.evidenceRecipeRow.includes("<real handle")));
    assert.ok(accountCreationPack.items.every((item) => item.copyPackage.length >= 5));
    assert.ok(accountCreationPack.items.every((item) => item.portalFormFields.length >= 5));
    assert.ok(accountCreationPack.items.every((item) => item.handleReservationPlan.length >= 4));
    assert.ok(accountCreationPack.items.every((item) => item.browserSessionChecklist.length >= 4));
    assert.ok(accountCreationPack.items.every((item) => item.evidenceCapturePlan.length >= 5));
    assert.ok(accountCreationPack.items.every((item) => item.operatorVaultChecklist.length >= 4));
    assert.ok(accountCreationPack.items.every((item) => item.postCreationNextActions.length >= 4));
    assert.equal(accountCreationPack.sessionOrder.length, accountCreationPack.items.length);
    assert.ok(accountCreationPack.sessionOrder.every((item) => item.requiredProof.length >= 4));
    assert.ok(accountCreationPack.sessionOrder.every((item) => item.copyPackage.some((field) => field.label === "bio")));
    assert.ok(accountCreationPack.sessionOrder.every((item) => item.portalFormFields.length > 0));
    assert.ok(accountCreationPack.sessionOrder.every((item) => item.handleReservationPlan.length > 0));
    assert.ok(accountCreationPack.sessionOrder.every((item) => item.browserSessionChecklist.length > 0));
    assert.ok(accountCreationPack.sessionOrder.every((item) => item.evidenceCapturePlan.length > 0));
    assert.ok(accountCreationPack.sessionOrder.every((item) => item.submittedEvidenceBatchRow.includes(",\"submitted\",")));
    assert.ok(accountCreationPack.sessionOrder.every((item) => item.verifiedEvidenceBatchRow.includes(",\"verified\",")));
    assert.ok(accountCreationPack.sessionOrder.every((item) => item.operatorVaultChecklist.length >= 4));
    assert.ok(accountCreationPack.sessionOrder.every((item) => item.doneCriteria.length >= 5));
    assert.ok(accountCreationPack.sessionOrder.every((item) => item.evidenceRecipeRow.includes("<real handle")));
    assert.equal(accountCreationPack.claimSheet.length, accountCreationPack.items.length);
    assert.ok(accountCreationPack.claimSheetPath.endsWith("account-claim-sheet.md"));
    assert.ok(accountCreationPack.claimSheetCsvPath.endsWith("account-claim-sheet.csv"));
    assert.ok(accountCreationPack.claimSheet.every((item) => item.vaultItemName.startsWith("Clippers/")));
    assert.ok(accountCreationPack.claimSheet.every((item) => item.loginIdentifierLabel.includes("login-email-or-phone-label")));
    assert.ok(accountCreationPack.claimSheet.every((item) => item.passwordVaultSlot.includes("/password")));
    assert.ok(accountCreationPack.claimSheet.every((item) => item.twoFactorSlot.includes("/2fa-method")));
    assert.ok(accountCreationPack.claimSheet.every((item) => item.preflightChecks.length >= 4));
    assert.ok(accountCreationPack.claimSheet.every((item) => item.claimSteps.length >= 5));
    assert.ok(accountCreationPack.claimSheet.every((item) => item.verificationSteps.length >= 5));
    assert.ok(accountCreationPack.claimSheet.every((item) => item.blockedUntil.length >= 4));
    assert.ok(accountCreationPack.evidenceBatchTemplate.includes('"kind","account_id","platform","status"'));
    assert.ok(status.commandCenter.steps.some((step) => step.id === "account-creation-pack" && step.actionUrl === "/api/clippers/prepare-account-creation-pack"));
    assert.ok(status.growthAudit.items.some((item) => item.id === "account-creation-pack"));

    const rawMarkdown = await readFile(accountCreationPack.markdownPath, "utf8");
    const rawCsv = await readFile(accountCreationPack.csvPath, "utf8");
    const rawClaimSheet = await readFile(accountCreationPack.claimSheetPath, "utf8");
    const rawClaimSheetCsv = await readFile(accountCreationPack.claimSheetCsvPath, "utf8");
    assert.ok(rawMarkdown.includes("Clippers Account Creation Pack"));
    assert.ok(rawMarkdown.includes("Account Creation Session"));
    assert.ok(rawMarkdown.includes("Claim Sheet"));
    assert.ok(rawMarkdown.includes("Launch Evidence Batch Template"));
    assert.ok(rawMarkdown.includes("Verification requirements"));
    assert.ok(rawMarkdown.includes("Security checklist"));
    assert.ok(rawMarkdown.includes("Recovery plan"));
    assert.ok(rawMarkdown.includes("Copy package"));
    assert.ok(rawMarkdown.includes("Portal form fields"));
    assert.ok(rawMarkdown.includes("Handle reservation plan"));
    assert.ok(rawMarkdown.includes("Browser session checklist"));
    assert.ok(rawMarkdown.includes("Evidence capture plan"));
    assert.ok(rawMarkdown.includes("Operator vault checklist"));
    assert.ok(rawMarkdown.includes("Platform proof required"));
    assert.ok(rawMarkdown.includes("Submitted evidence row"));
    assert.ok(rawMarkdown.includes("Evidence batch row"));
    assert.ok(rawMarkdown.includes("Evidence recipe row"));
    assert.ok(rawCsv.includes("signup_url"));
    assert.ok(rawCsv.includes("copy_package"));
    assert.ok(rawCsv.includes("portal_form_fields"));
    assert.ok(rawCsv.includes("handle_reservation_plan"));
    assert.ok(rawCsv.includes("browser_session_checklist"));
    assert.ok(rawCsv.includes("evidence_capture_plan"));
    assert.ok(rawCsv.includes("required_inputs"));
    assert.ok(rawCsv.includes("security_checklist"));
    assert.ok(rawCsv.includes("operator_vault_checklist"));
    assert.ok(rawCsv.includes("platform_proof_required"));
    assert.ok(rawCsv.includes("submitted_evidence_batch_row"));
    assert.ok(rawCsv.includes("evidence_batch_row"));
    assert.ok(rawCsv.includes("evidence_recipe_row"));
    assert.ok(rawClaimSheet.includes("Clippers Account Claim Sheet"));
    assert.ok(rawClaimSheet.includes("Vault item"));
    assert.ok(rawClaimSheet.includes("Login identifier label"));
    assert.ok(rawClaimSheetCsv.includes("vault_item_name"));
    assert.ok(rawClaimSheetCsv.includes("login_identifier_label"));
    assert.equal(rawMarkdown.includes("client_secret"), false);
    assert.equal(rawCsv.includes("access_token"), false);
    assert.equal(rawClaimSheet.includes("client_secret"), false);
    assert.equal(rawClaimSheetCsv.includes("access_token"), false);
  } finally {
    if (previousManifest === null) await unlink(beforeStatus.accountCreationPack.manifestPath).catch(() => undefined);
    else await writeFile(beforeStatus.accountCreationPack.manifestPath, previousManifest);
    if (previousMarkdown === null) await unlink(beforeStatus.accountCreationPack.markdownPath).catch(() => undefined);
    else await writeFile(beforeStatus.accountCreationPack.markdownPath, previousMarkdown);
    if (previousCsv === null) await unlink(beforeStatus.accountCreationPack.csvPath).catch(() => undefined);
    else await writeFile(beforeStatus.accountCreationPack.csvPath, previousCsv);
    if (previousClaimSheet === null) await unlink(beforeStatus.accountCreationPack.claimSheetPath).catch(() => undefined);
    else await writeFile(beforeStatus.accountCreationPack.claimSheetPath, previousClaimSheet);
    if (previousClaimSheetCsv === null) await unlink(beforeStatus.accountCreationPack.claimSheetCsvPath).catch(() => undefined);
    else await writeFile(beforeStatus.accountCreationPack.claimSheetCsvPath, previousClaimSheetCsv);
  }
});

test("prepareClipperAccountEvidenceVault writes templates and evidence unlocks launch tasks", async () => {
  const { accountEvidence } = await prepareClipperAccountEvidenceVault();
  const evidencePath = `${accountEvidence.evidenceDir}/sports-daily-instagram.md`;

  try {
    assert.ok(accountEvidence.readmePath.endsWith("account-evidence/README.md"));
    assert.ok(accountEvidence.launchEvidenceDropDir.endsWith("evidence-drop"));
    assert.ok(accountEvidence.launchEvidenceTemplatePath.endsWith("evidence-drop/launch-evidence-template.csv"));
    assert.ok(accountEvidence.launchEvidenceTemplateRows >= accountEvidence.totals.expected + 3);
    assert.ok(accountEvidence.launchEvidenceDropChecklist.length >= 5);
    assert.equal(accountEvidence.totals.expected > 0, true);
    const readmeStat = await stat(accountEvidence.readmePath);
    const templateStat = await stat(accountEvidence.launchEvidenceTemplatePath);
    assert.equal(readmeStat.isFile(), true);
    assert.equal(templateStat.isFile(), true);
    const rawTemplate = await readFile(accountEvidence.launchEvidenceTemplatePath, "utf8");
    assert.ok(rawTemplate.includes("kind"));
    assert.ok(rawTemplate.includes("sports-daily"));
    assert.ok(rawTemplate.includes("developer_app"));
    assert.ok(rawTemplate.includes("permission"));
    assert.ok(rawTemplate.includes("<profile URL + screenshot/proof note"));

    await writeFile(evidencePath, [
      "status: verified",
      "notes: Cuenta creada, bio aplicada, email verificado y 2FA guardado.",
    ].join("\n"));

    const status = await getClipperStatus();
    const evidence = status.accountEvidence.items.find((item) => item.id === "sports-daily-instagram");
    assert.ok(evidence);
    assert.equal(evidence.status, "verified");

    const launchTask = status.accountLaunchKit.tasks.find((task) => task.id === "sports-daily-instagram");
    assert.ok(launchTask);
    assert.equal(launchTask.evidenceStatus, "verified");
    assert.notEqual(launchTask.status, "blocked");
  } finally {
    await unlink(evidencePath).catch(() => undefined);
  }
});

test("recordClipperAccountEvidence writes JSON evidence and unlocks launch task", async () => {
  const statusBefore = await getClipperStatus();
  const evidencePath = `${statusBefore.accountEvidence.evidenceDir}/meme-radar-youtube.json`;

  try {
    const { accountEvidence, status } = await recordClipperAccountEvidence({
      accountId: "meme-radar",
      platform: "youtube",
      status: "verified",
      notes: "Cuenta YouTube creada y verificada desde test.",
    });
    const evidence = accountEvidence.items.find((item) => item.id === "meme-radar-youtube");
    assert.ok(evidence);
    assert.equal(evidence.status, "verified");
    assert.ok(evidence.evidencePath.endsWith("meme-radar-youtube.json"));

    const launchTask = status.accountLaunchKit.tasks.find((task) => task.id === "meme-radar-youtube");
    assert.ok(launchTask);
    assert.equal(launchTask.evidenceStatus, "verified");

    const raw = await readFile(evidencePath, "utf8");
    assert.equal(raw.includes("Cuenta YouTube creada"), true);

    await assert.rejects(
      () => recordClipperAccountEvidence({
        accountId: "meme-radar",
        platform: "youtube",
        status: "verified",
        notes: "<real handle + profile URL + 2FA/security proof + screenshot/proof URL>",
      }),
      /requiere evidencia real/
    );
  } finally {
    await unlink(evidencePath).catch(() => undefined);
  }
});

test("prepareClipperDeveloperAppEvidenceVault writes templates and reads approved app evidence", async () => {
  const { developerAppEvidence } = await prepareClipperDeveloperAppEvidenceVault();
  const evidencePath = `${developerAppEvidence.evidenceDir}/tiktok.json`;

  try {
    assert.equal(developerAppEvidence.totals.expected, 3);
    assert.ok(developerAppEvidence.readmePath.endsWith("developer-app-evidence/README.md"));
    assert.ok(developerAppEvidence.templateDir.endsWith("developer-app-evidence/templates"));

    const readmeStat = await stat(developerAppEvidence.readmePath);
    assert.equal(readmeStat.isFile(), true);

    await writeFile(evidencePath, JSON.stringify({
      status: "approved",
      appIdentifier: "test-tiktok-app",
      publicBaseUrl: "https://example.com",
      notes: "App review approved for automated clip publishing tests.",
    }, null, 2));

    const status = await getClipperStatus();
    const app = status.developerAppEvidence.items.find((item) => item.platform === "tiktok");
    assert.ok(app);
    assert.equal(app.status, "approved");
    assert.equal(app.appIdentifier, "test-tiktok-app");
    assert.equal(app.publicBaseUrl, "https://example.com");
    assert.ok(status.growthAudit.items.some((item) => item.id === "developer-app-evidence"));
    assert.ok(status.driveWorkspace.folders.some((folder) => folder.id === "developer-app-evidence"));
  } finally {
    await unlink(evidencePath).catch(() => undefined);
  }
});

test("recordClipperDeveloperAppEvidence writes app evidence without secrets", async () => {
  const statusBefore = await getClipperStatus();
  const evidencePath = `${statusBefore.developerAppEvidence.evidenceDir}/instagram.json`;

  try {
    const { developerAppEvidence } = await recordClipperDeveloperAppEvidence({
      platform: "instagram",
      status: "approved",
      appIdentifier: "meta-app-id-test",
      publicBaseUrl: "https://example.com",
      notes: "Meta app review approved from test.",
    });
    const app = developerAppEvidence.items.find((item) => item.platform === "instagram");
    assert.ok(app);
    assert.equal(app.status, "approved");
    assert.equal(app.appIdentifier, "meta-app-id-test");
    assert.equal(app.publicBaseUrl, "https://example.com");

    const raw = await readFile(evidencePath, "utf8");
    assert.equal(raw.includes("client_secret"), false);
    assert.equal(raw.includes("access_token"), false);

    await assert.rejects(
      () => recordClipperDeveloperAppEvidence({
        platform: "instagram",
        status: "submitted",
        appIdentifier: "<developer app id/client key/project id>",
        publicBaseUrl: "http://127.0.0.1:5010",
        notes: "App creada o enviada a review; pendiente aprobacion.",
      }),
      /requiere evidencia real|URL publica HTTPS/
    );
  } finally {
    await unlink(evidencePath).catch(() => undefined);
  }
});

test("prepareClipperPermissionTracker writes reviewed permission manifest", async () => {
  await prepareClipperPermissionPack();
  await prepareClipperAccountLaunchKit();
  const { permissionTracker, status } = await prepareClipperPermissionTracker();

  try {
    assert.equal(permissionTracker.items.length, status.permissionQueue.length);
    assert.ok(permissionTracker.trackerPath.endsWith("permission-tracker.json"));
    assert.ok(permissionTracker.markdownPath.endsWith("permission-tracker.md"));
    assert.ok(permissionTracker.items.some((item) => item.scope === "video.publish" && item.docsUrl.includes("developers.tiktok.com")));
    assert.ok(permissionTracker.items.some((item) => item.scope === "https://www.googleapis.com/auth/youtube.upload"));
    assert.ok(permissionTracker.items.every((item) => item.evidenceRequired.length > 0));
    assert.ok(permissionTracker.items.every((item) => item.evidenceBatchRow.startsWith('"permission"')));
    assert.ok(permissionTracker.items.every((item) => item.evidenceRecipeRow.includes("<permission request")));
    assert.ok(status.growthAudit.items.some((item) => item.id === "permission-tracker"));

    const trackerStat = await stat(permissionTracker.trackerPath);
    const markdownStat = await stat(permissionTracker.markdownPath);
    assert.equal(trackerStat.isFile(), true);
    assert.equal(markdownStat.isFile(), true);

    const markdown = await readFile(permissionTracker.markdownPath, "utf8");
    assert.ok(markdown.includes("Clippers Permission Tracker"));
    assert.ok(markdown.includes("Official Sources"));
    assert.ok(markdown.includes("Evidence recipe row"));
  } finally {
    await unlink(permissionTracker.trackerPath).catch(() => undefined);
    await unlink(permissionTracker.markdownPath).catch(() => undefined);
  }
});

test("prepareClipperPermissionRequestPack writes copy-ready scope requests", async () => {
  const beforeStatus = await getClipperStatus();
  const previousManifest = await readFile(beforeStatus.permissionRequestPack.manifestPath, "utf8").catch(() => null);
  const previousMarkdown = await readFile(beforeStatus.permissionRequestPack.markdownPath, "utf8").catch(() => null);
  const previousCsv = await readFile(beforeStatus.permissionRequestPack.csvPath, "utf8").catch(() => null);

  try {
    const { permissionRequestPack, status } = await prepareClipperPermissionRequestPack();
    assert.equal(permissionRequestPack.items.length, status.permissionQueue.length);
    assert.ok(permissionRequestPack.markdownPath.endsWith("permission-request-pack.md"));
    assert.ok(permissionRequestPack.csvPath.endsWith("permission-request-pack.csv"));
    assert.ok(permissionRequestPack.items.some((item) => item.scope === "video.publish" && item.copyReadyJustification.includes("approval_required")));
    assert.ok(permissionRequestPack.items.some((item) => item.scope === "https://www.googleapis.com/auth/youtube.upload"));
    assert.ok(permissionRequestPack.items.some((item) => item.platform === "tiktok" && item.platformConstraints.some((constraint) => constraint.includes("Content Posting API"))));
    assert.ok(permissionRequestPack.items.some((item) => item.platform === "tiktok" && item.auditWarnings.some((warning) => warning.includes("private visibility"))));
    assert.ok(permissionRequestPack.items.some((item) => item.platform === "youtube" && item.platformConstraints.some((constraint) => constraint.includes("youtube.upload"))));
    assert.ok(permissionRequestPack.items.some((item) => item.platform === "youtube" && item.auditWarnings.some((warning) => warning.includes("private only"))));
    assert.ok(permissionRequestPack.items.every((item) => item.reviewerEvidence.some((evidence) => evidence.includes("Privacy Policy"))));
    assert.ok(permissionRequestPack.items.every((item) => item.officialReferenceUrl.startsWith("https://")));
    assert.ok(permissionRequestPack.items.every((item) => item.scopeRequestLine.includes(item.scope)));
    assert.ok(permissionRequestPack.items.every((item) => item.reviewerInstructions.includes("review")));
    assert.ok(permissionRequestPack.items.every((item) => item.officialApprovalChecklist.length >= 3));
    assert.ok(permissionRequestPack.items.every((item) => item.evidenceBatchRow.includes(item.scope)));
    assert.ok(permissionRequestPack.items.every((item) => item.evidenceRecipeRow.includes("<permission request")));
    assert.ok(permissionRequestPack.items.some((item) => item.requestReadiness === "blocked"));
    assert.ok(status.commandCenter.steps.some((step) => step.id === "permission-request-pack" && step.actionUrl === "/api/clippers/prepare-permission-request-pack"));
    assert.ok(status.growthAudit.items.some((item) => item.id === "permission-request-pack"));

    const rawMarkdown = await readFile(permissionRequestPack.markdownPath, "utf8");
    const rawCsv = await readFile(permissionRequestPack.csvPath, "utf8");
    assert.ok(rawMarkdown.includes("Clippers Permission Request Pack"));
    assert.ok(rawMarkdown.includes("Copy-ready justification"));
    assert.ok(rawMarkdown.includes("Reviewer instructions"));
    assert.ok(rawMarkdown.includes("Official approval checklist"));
    assert.ok(rawMarkdown.includes("Evidence recipe row"));
    assert.ok(rawMarkdown.includes("Platform constraints"));
    assert.ok(rawMarkdown.includes("Audit / go-live warnings"));
    assert.ok(rawCsv.includes("developer_portal"));
    assert.ok(rawCsv.includes("request_readiness"));
    assert.ok(rawCsv.includes("official_reference_url"));
    assert.ok(rawCsv.includes("reviewer_instructions"));
    assert.ok(rawCsv.includes("platform_constraints"));
    assert.ok(rawCsv.includes("audit_warnings"));
    assert.equal(rawMarkdown.includes("client_secret"), false);
    assert.equal(rawCsv.includes("access_token"), false);
  } finally {
    if (previousManifest === null) await unlink(beforeStatus.permissionRequestPack.manifestPath).catch(() => undefined);
    else await writeFile(beforeStatus.permissionRequestPack.manifestPath, previousManifest);
    if (previousMarkdown === null) await unlink(beforeStatus.permissionRequestPack.markdownPath).catch(() => undefined);
    else await writeFile(beforeStatus.permissionRequestPack.markdownPath, previousMarkdown);
    if (previousCsv === null) await unlink(beforeStatus.permissionRequestPack.csvPath).catch(() => undefined);
    else await writeFile(beforeStatus.permissionRequestPack.csvPath, previousCsv);
  }
});

test("recordClipperPermissionStatus persists permission review status without secrets", async () => {
  const recordsPath = __clipperInternals.permissionStatusRecordsPath;
  const previousRecords = await readFile(recordsPath, "utf8").catch(() => null);

  try {
    const { permissionStatusRecord, permissionTracker, status } = await recordClipperPermissionStatus({
      platform: "tiktok",
      scope: "video.publish",
      status: "approved",
      notes: "App review approved in TikTok portal; no secret values stored.",
    });

    assert.equal(permissionStatusRecord.status, "approved");
    assert.equal(permissionStatusRecord.scope, "video.publish");
    assert.ok(permissionTracker.items.some((item) =>
      item.platform === "tiktok" &&
      item.scope === "video.publish" &&
      item.status === "approved" &&
      item.statusSource === "manual_record"
    ));
    assert.ok(status.permissionTracker.totals.approved >= 1);

    const raw = await readFile(recordsPath, "utf8");
    assert.ok(raw.includes("video.publish"));
    assert.equal(raw.includes("client_secret"), false);
    assert.equal(raw.includes("access_token"), false);

    await assert.rejects(
      () => recordClipperPermissionStatus({
        platform: "tiktok",
        scope: "video.publish",
        status: "requested",
        notes: "Solicitado en developer portal.",
      }),
      /Permission notes requiere evidencia real/
    );
  } finally {
    if (previousRecords === null) {
      await unlink(recordsPath).catch(() => undefined);
    } else {
      await writeFile(recordsPath, previousRecords);
    }
  }
});

test("previewClipperLaunchEvidenceBatch validates rows without writing evidence", async () => {
  const recordsPath = __clipperInternals.permissionStatusRecordsPath;
  const statusBefore = await getClipperStatus();
  const accountPath = `${statusBefore.accountEvidence.evidenceDir}/sports-daily-instagram.json`;
  const appPath = `${statusBefore.developerAppEvidence.evidenceDir}/instagram.json`;
  const memeFolder = statusBefore.sourceFolders.find((folder) => folder.category === "memes");
  const allowlistFolder = statusBefore.sourceFolders.find((folder) => folder.category === "allowlist");
  assert.ok(memeFolder);
  assert.ok(allowlistFolder);
  const sourcePath = `${memeFolder.path}/preview-rights.mp4`;
  const evidencePath = `${allowlistFolder.path}/preview-rights.md`;
  const previousAccount = await readFile(accountPath, "utf8").catch(() => null);
  const previousApp = await readFile(appPath, "utf8").catch(() => null);
  const previousRecords = await readFile(recordsPath, "utf8").catch(() => null);
  const previousEvidence = await readFile(evidencePath, "utf8").catch(() => null);
  await mkdir(memeFolder.path, { recursive: true });
  await writeFile(sourcePath, "fake-video-for-launch-preview-test");

  try {
    const { launchEvidenceBatchPreview, status } = await previewClipperLaunchEvidenceBatch({
      batchText: [
        "kind,account_id,platform,status,scope,app_identifier,public_base_url,notes",
        "account,sports-daily,instagram,verified,,,,Instagram account verified with profile screenshot",
        "developer_app,,instagram,submitted,,meta-app-id,https://example.com,Meta app submitted for review",
        "permission,,instagram,requested,instagram_content_publish,,,Meta scope requested with review ticket",
        "source_rights,preview-rights.mp4,memes,owned_or_permissioned,preview-rights.mp4,,,Creator permission confirmed for preview; proof stored in secure drive",
        "permission,,instagram,requested,not.real.scope,,,Bad scope should reject",
        "permission,,tiktok,requested,video.publish,,,TikTok Content Posting API requested; attach app review evidence",
      ].join("\n"),
    });

    assert.deepEqual(launchEvidenceBatchPreview.accepted, { accountEvidence: 1, developerApps: 1, permissions: 1, sourceRights: 1 });
    assert.equal(launchEvidenceBatchPreview.rejected.length, 2);
    assert.equal(launchEvidenceBatchPreview.rejected[0].kind, "permission");
    assert.ok(launchEvidenceBatchPreview.rejected.some((item) => item.reason.includes("requiere evidencia real")));
    assert.ok(launchEvidenceBatchPreview.nextStep.includes("Preview listo"));
    assert.equal(status.accountEvidence.items.some((item) => item.id === "sports-daily-instagram" && item.status === "verified"), false);

    const nextAccount = await readFile(accountPath, "utf8").catch(() => null);
    const nextApp = await readFile(appPath, "utf8").catch(() => null);
    const nextRecords = await readFile(recordsPath, "utf8").catch(() => null);
    const nextEvidence = await readFile(evidencePath, "utf8").catch(() => null);
    assert.equal(nextAccount, previousAccount);
    assert.equal(nextApp, previousApp);
    assert.equal(nextRecords, previousRecords);
    assert.equal(nextEvidence, previousEvidence);
  } finally {
    await unlink(sourcePath).catch(() => undefined);
    if (previousEvidence === null) await unlink(evidencePath).catch(() => undefined);
    else await writeFile(evidencePath, previousEvidence);
    if (previousAccount === null) await unlink(accountPath).catch(() => undefined);
    else await writeFile(accountPath, previousAccount);
    if (previousApp === null) await unlink(appPath).catch(() => undefined);
    else await writeFile(appPath, previousApp);
    if (previousRecords === null) await unlink(recordsPath).catch(() => undefined);
    else await writeFile(recordsPath, previousRecords);
  }
});

test("recordClipperLaunchEvidenceBatch imports account app and permission evidence", async () => {
  const recordsPath = __clipperInternals.permissionStatusRecordsPath;
  const statusBefore = await getClipperStatus();
  const accountPath = `${statusBefore.accountEvidence.evidenceDir}/sports-daily-tiktok.json`;
  const appPath = `${statusBefore.developerAppEvidence.evidenceDir}/youtube.json`;
  const streamerFolder = statusBefore.sourceFolders.find((folder) => folder.category === "streamers");
  const allowlistFolder = statusBefore.sourceFolders.find((folder) => folder.category === "allowlist");
  assert.ok(streamerFolder);
  assert.ok(allowlistFolder);
  const sourcePath = `${streamerFolder.path}/launch-import-streamer.mp4`;
  const evidencePath = `${allowlistFolder.path}/launch-import-streamer.md`;
  const previousAccount = await readFile(accountPath, "utf8").catch(() => null);
  const previousApp = await readFile(appPath, "utf8").catch(() => null);
  const previousRecords = await readFile(recordsPath, "utf8").catch(() => null);
  const previousEvidence = await readFile(evidencePath, "utf8").catch(() => null);
  await mkdir(streamerFolder.path, { recursive: true });
  await writeFile(sourcePath, "fake-video-for-launch-record-test");

  try {
    const { launchEvidenceBatch, status } = await recordClipperLaunchEvidenceBatch({
      batchText: [
        "kind,account_id,platform,status,scope,app_identifier,public_base_url,notes",
        "account,sports-daily,tiktok,verified,,,,TikTok account verified in portal",
        "developer_app,,youtube,submitted,,youtube-app-id,https://example.com,YouTube API submitted",
        "permission,,tiktok,requested,video.publish,,,TikTok scope requested",
        "source_rights,launch-import-streamer.mp4,streamers,owned_or_permissioned,launch-import-streamer.mp4,,,Creator permission confirmed for launch import; proof stored in secure drive",
        "permission,,tiktok,approved,not.real.scope,,,Bad scope should reject",
        "account,meme-radar,tiktok,verified,,,,Meme Radar handle=<handle>; verified=<proof link or note>",
      ].join("\n"),
    });

    assert.deepEqual(launchEvidenceBatch.accepted, { accountEvidence: 1, developerApps: 1, permissions: 1, sourceRights: 1 });
    assert.equal(launchEvidenceBatch.rejected.length, 2);
    assert.equal(launchEvidenceBatch.rejected[0].kind, "permission");
    assert.ok(launchEvidenceBatch.rejected.some((item) => item.reason.includes("requiere evidencia real")));
    assert.ok(status.accountEvidence.items.some((item) => item.id === "sports-daily-tiktok" && item.status === "verified"));
    assert.ok(status.developerAppEvidence.items.some((item) => item.platform === "youtube" && item.status === "submitted"));
    assert.ok(status.permissionTracker.items.some((item) => item.platform === "tiktok" && item.scope === "video.publish" && item.status === "requested"));
    assert.ok(status.productionQueue.sourceAssets.some((item) => item.fileName === "launch-import-streamer.mp4" && item.rightsStatus === "owned_or_permissioned"));

    const rawAccount = await readFile(accountPath, "utf8");
    const rawApp = await readFile(appPath, "utf8");
    const rawEvidence = await readFile(evidencePath, "utf8");
    assert.ok(rawEvidence.includes("launch-import-streamer.mp4"));
    const responseJson = JSON.stringify(launchEvidenceBatch);
    for (const forbidden of ["client_secret", "access_token", "plain-refresh-token"]) {
      assert.equal(rawAccount.includes(forbidden), false);
      assert.equal(rawApp.includes(forbidden), false);
      assert.equal(rawEvidence.includes(forbidden), false);
      assert.equal(responseJson.includes(forbidden), false);
    }
  } finally {
    await unlink(sourcePath).catch(() => undefined);
    if (previousEvidence === null) await unlink(evidencePath).catch(() => undefined);
    else await writeFile(evidencePath, previousEvidence);
    if (previousAccount === null) await unlink(accountPath).catch(() => undefined);
    else await writeFile(accountPath, previousAccount);
    if (previousApp === null) await unlink(appPath).catch(() => undefined);
    else await writeFile(appPath, previousApp);
    if (previousRecords === null) await unlink(recordsPath).catch(() => undefined);
    else await writeFile(recordsPath, previousRecords);
  }
});

test("importClipperLaunchEvidenceDropFiles imports CSV evidence files from evidence-drop", async () => {
  const recordsPath = __clipperInternals.permissionStatusRecordsPath;
  const statusBefore = await getClipperStatus();
  const dropDir = path.join(statusBefore.rootDir, "evidence-drop");
  const dropPath = path.join(dropDir, "launch-evidence-drop.test.csv");
  const accountPath = `${statusBefore.accountEvidence.evidenceDir}/streamer-pulse-instagram.json`;
  const appPath = `${statusBefore.developerAppEvidence.evidenceDir}/tiktok.json`;
  const previousAccount = await readFile(accountPath, "utf8").catch(() => null);
  const previousApp = await readFile(appPath, "utf8").catch(() => null);
  const previousRecords = await readFile(recordsPath, "utf8").catch(() => null);
  await mkdir(dropDir, { recursive: true });
  await writeFile(dropPath, [
    "kind,account_id,platform,status,scope,app_identifier,public_base_url,notes",
    "account,streamer-pulse,instagram,verified,,,,Instagram account verified in external portal",
    "developer_app,,tiktok,submitted,,tiktok-drop-app-id,https://example.com,TikTok app review submitted from evidence drop",
    "permission,,youtube,requested,https://www.googleapis.com/auth/youtube.upload,,,YouTube upload scope requested from Google Cloud evidence drop",
  ].join("\n"));

  try {
    const { launchEvidenceDropImport, status } = await importClipperLaunchEvidenceDropFiles();
    assert.deepEqual(launchEvidenceDropImport.accepted, { accountEvidence: 1, developerApps: 1, permissions: 1, sourceRights: 0 });
    assert.equal(launchEvidenceDropImport.filesScanned, 1);
    assert.equal(launchEvidenceDropImport.filesImported, 1);
    assert.ok(launchEvidenceDropImport.sourceFiles?.some((file) => file.endsWith("launch-evidence-drop.test.csv")));
    assert.equal(launchEvidenceDropImport.rejected.length, 0);
    assert.equal(launchEvidenceDropImport.fileErrors?.length || 0, 0);
    assert.ok(status.accountEvidence.items.some((item) => item.id === "streamer-pulse-instagram" && item.status === "verified"));
    assert.ok(status.developerAppEvidence.items.some((item) => item.platform === "tiktok" && item.status === "submitted"));
    assert.ok(status.permissionTracker.items.some((item) =>
      item.platform === "youtube" &&
      item.scope === "https://www.googleapis.com/auth/youtube.upload" &&
      item.status === "requested"
    ));

    const responseJson = JSON.stringify(launchEvidenceDropImport);
    assert.equal(responseJson.includes("client_secret"), false);
    assert.equal(responseJson.includes("access_token"), false);
  } finally {
    await unlink(dropPath).catch(() => undefined);
    if (previousAccount === null) await unlink(accountPath).catch(() => undefined);
    else await writeFile(accountPath, previousAccount);
    if (previousApp === null) await unlink(appPath).catch(() => undefined);
    else await writeFile(appPath, previousApp);
    if (previousRecords === null) await unlink(recordsPath).catch(() => undefined);
    else await writeFile(recordsPath, previousRecords);
  }
});

test("prepareClipperPlatformReadinessMatrix writes per-platform blocker matrix", async () => {
  const beforeStatus = await getClipperStatus();
  const previousManifest = await readFile(beforeStatus.platformReadiness.manifestPath, "utf8").catch(() => null);
  const previousMarkdown = await readFile(beforeStatus.platformReadiness.markdownPath, "utf8").catch(() => null);

  try {
    const { platformReadiness, status } = await prepareClipperPlatformReadinessMatrix();
    assert.equal(platformReadiness.items.length, 3);
    assert.equal(platformReadiness.totals.platforms, 3);
    assert.ok(platformReadiness.items.some((item) => item.platform === "tiktok" && item.developerPortalUrl.includes("developers.tiktok.com")));
    assert.ok(platformReadiness.items.every((item) => item.accountTasks > 0 && item.permissionsTotal > 0));
    assert.ok(status.commandCenter.steps.some((step) => step.id === "platform-readiness" && step.actionUrl === "/api/clippers/prepare-platform-readiness"));

    const rawManifest = await readFile(platformReadiness.manifestPath, "utf8");
    const rawMarkdown = await readFile(platformReadiness.markdownPath, "utf8");
    assert.ok(rawManifest.includes("tokenSaved"));
    assert.ok(rawMarkdown.includes("Clippers Platform Readiness Matrix"));
    assert.equal(rawManifest.includes("access_token"), false);
    assert.equal(rawMarkdown.includes("client_secret"), false);
  } finally {
    if (previousManifest === null) await unlink(beforeStatus.platformReadiness.manifestPath).catch(() => undefined);
    else await writeFile(beforeStatus.platformReadiness.manifestPath, previousManifest);
    if (previousMarkdown === null) await unlink(beforeStatus.platformReadiness.markdownPath).catch(() => undefined);
    else await writeFile(beforeStatus.platformReadiness.markdownPath, previousMarkdown);
  }
});

test("prepareClipperExternalSetupQueue writes prioritized external setup tasks", async () => {
  const beforeStatus = await getClipperStatus();
  const previousManifest = await readFile(beforeStatus.externalSetupQueue.manifestPath, "utf8").catch(() => null);
  const previousMarkdown = await readFile(beforeStatus.externalSetupQueue.markdownPath, "utf8").catch(() => null);

  try {
    const { externalSetupQueue, status } = await prepareClipperExternalSetupQueue();
    assert.equal(externalSetupQueue.items.length >= 24, true);
    assert.ok(externalSetupQueue.items.some((item) => item.type === "account" && item.portalUrl.includes("signup")));
    assert.ok(externalSetupQueue.items.some((item) => item.type === "developer_app" && item.platform === "tiktok"));
    assert.ok(externalSetupQueue.items.some((item) => item.type === "permission" && item.scopes.includes("video.publish")));
    assert.ok(externalSetupQueue.items.some((item) => item.type === "oauth" && item.platform === "youtube"));
    assert.ok(externalSetupQueue.items.every((item) => item.requiredInputs.length >= 3));
    assert.ok(externalSetupQueue.items.every((item) => item.doneCriteria.length >= 3));
    assert.ok(externalSetupQueue.items.some((item) => item.type === "developer_app" && item.evidenceRecipeRow.includes("<real app/client id>")));
    assert.ok(externalSetupQueue.items.some((item) => item.type === "permission" && item.evidenceRecipeRow.includes("<real permission request/review URL")));
    assert.ok(externalSetupQueue.totals.critical > 0);
    assert.ok(status.commandCenter.steps.some((step) => step.id === "external-setup-queue" && step.actionUrl === "/api/clippers/prepare-external-setup-queue"));

    const rawManifest = await readFile(externalSetupQueue.manifestPath, "utf8");
    const rawMarkdown = await readFile(externalSetupQueue.markdownPath, "utf8");
    assert.ok(rawMarkdown.includes("Clippers External Setup Queue"));
    assert.ok(rawMarkdown.includes("Required inputs"));
    assert.ok(rawMarkdown.includes("Done criteria"));
    assert.ok(rawMarkdown.includes("Evidence recipe row"));
    assert.equal(rawManifest.includes("access_token"), false);
    assert.equal(rawMarkdown.includes("client_secret"), false);
  } finally {
    if (previousManifest === null) await unlink(beforeStatus.externalSetupQueue.manifestPath).catch(() => undefined);
    else await writeFile(beforeStatus.externalSetupQueue.manifestPath, previousManifest);
    if (previousMarkdown === null) await unlink(beforeStatus.externalSetupQueue.markdownPath).catch(() => undefined);
    else await writeFile(beforeStatus.externalSetupQueue.markdownPath, previousMarkdown);
  }
});

test("prepareClipperExternalExecutionHandoff writes batch-ready external handoff", async () => {
  const beforeStatus = await getClipperStatus();
  const previousManifest = await readFile(beforeStatus.externalExecutionHandoff.manifestPath, "utf8").catch(() => null);
  const previousMarkdown = await readFile(beforeStatus.externalExecutionHandoff.markdownPath, "utf8").catch(() => null);
  const previousCsv = await readFile(beforeStatus.externalExecutionHandoff.csvPath, "utf8").catch(() => null);
  const previousBatch = await readFile(beforeStatus.externalExecutionHandoff.batchTemplatePath, "utf8").catch(() => null);

  try {
    const { externalExecutionHandoff, status } = await prepareClipperExternalExecutionHandoff();
    assert.ok(externalExecutionHandoff.manifestPath.endsWith("external-execution-handoff.json"));
    assert.ok(externalExecutionHandoff.markdownPath.endsWith("external-execution-handoff.md"));
    assert.ok(externalExecutionHandoff.csvPath.endsWith("external-execution-handoff.csv"));
    assert.ok(externalExecutionHandoff.batchTemplatePath.endsWith("external-execution-evidence-batch.csv"));
    assert.ok(externalExecutionHandoff.items.length > 0);
    assert.ok(externalExecutionHandoff.evidenceBatchTemplate.includes("kind,account_id,platform"));
    assert.equal(status.externalExecutionHandoff.manifestPath, externalExecutionHandoff.manifestPath);

    const rawMarkdown = await readFile(externalExecutionHandoff.markdownPath, "utf8");
    const rawCsv = await readFile(externalExecutionHandoff.csvPath, "utf8");
    const rawBatch = await readFile(externalExecutionHandoff.batchTemplatePath, "utf8");
    assert.ok(rawMarkdown.includes("Clippers External Execution Handoff"));
    assert.ok(rawMarkdown.includes("Launch Evidence Batch Template"));
    assert.ok(rawCsv.includes("unblock_condition"));
    assert.ok(rawBatch.startsWith("kind,account_id,platform,status,scope,app_identifier,public_base_url,notes"));
    assert.ok(rawBatch.includes("developer_app"));
    assert.equal(rawBatch.includes("<"), false);
    assert.equal(rawBatch.includes("\ncredential,"), false);
    assert.equal(rawBatch.includes("\noauth,"), false);
    assert.equal(rawMarkdown.includes("access_token"), false);
  } finally {
    if (previousManifest === null) await unlink(beforeStatus.externalExecutionHandoff.manifestPath).catch(() => undefined);
    else await writeFile(beforeStatus.externalExecutionHandoff.manifestPath, previousManifest);
    if (previousMarkdown === null) await unlink(beforeStatus.externalExecutionHandoff.markdownPath).catch(() => undefined);
    else await writeFile(beforeStatus.externalExecutionHandoff.markdownPath, previousMarkdown);
    if (previousCsv === null) await unlink(beforeStatus.externalExecutionHandoff.csvPath).catch(() => undefined);
    else await writeFile(beforeStatus.externalExecutionHandoff.csvPath, previousCsv);
    if (previousBatch === null) await unlink(beforeStatus.externalExecutionHandoff.batchTemplatePath).catch(() => undefined);
    else await writeFile(beforeStatus.externalExecutionHandoff.batchTemplatePath, previousBatch);
  }
});

test("prepareClipperExternalExecutionSession writes lane-based execution pack", async () => {
  const beforeStatus = await getClipperStatus();
  const previousManifest = await readFile(beforeStatus.externalExecutionSession.manifestPath, "utf8").catch(() => null);
  const previousMarkdown = await readFile(beforeStatus.externalExecutionSession.markdownPath, "utf8").catch(() => null);
  const previousCsv = await readFile(beforeStatus.externalExecutionSession.csvPath, "utf8").catch(() => null);
  const previousEvidenceImport = await readFile(beforeStatus.externalExecutionSession.evidenceImportPath, "utf8").catch(() => null);

  try {
    const { externalExecutionSession, status } = await prepareClipperExternalExecutionSession();
    assert.ok(externalExecutionSession.manifestPath.endsWith("external-execution-session.json"));
    assert.ok(externalExecutionSession.markdownPath.endsWith("external-execution-session.md"));
    assert.ok(externalExecutionSession.csvPath.endsWith("external-execution-session.csv"));
    assert.ok(externalExecutionSession.evidenceImportPath.endsWith("external-execution-session-evidence-import.csv"));
    assert.equal(externalExecutionSession.items.length, status.externalExecutionHandoff.items.length);
    assert.ok(externalExecutionSession.totals.blocked > 0 || externalExecutionSession.totals.doNow > 0);
    assert.equal(externalExecutionSession.totals.importableEvidenceRows, externalExecutionSession.items.filter((item) => item.evidenceBatchRow && item.actionMode === "paste_evidence").length);
    assert.ok(externalExecutionSession.evidenceImportTemplate.startsWith("kind,account_id,platform,status,scope,app_identifier,public_base_url,notes"));
    assert.ok(externalExecutionSession.items.some((item) => item.actionMode === "paste_env" || item.actionMode === "paste_evidence"));
    assert.ok(externalExecutionSession.items.some((item) => item.actionMode === "paste_env" && item.executionUrl === "/clippers#credential-setup"));
    assert.ok(externalExecutionSession.items.some((item) => item.actionMode === "paste_evidence" && item.executionUrl === "/clippers#launch-evidence-batch"));
    assert.ok(externalExecutionSession.totals.doNow > 0);
    assert.ok(externalExecutionSession.items.some((item) => item.lane === "do_now" && item.actionMode === "paste_evidence"));
    assert.ok(externalExecutionSession.items.every((item) => item.laneReason.length > 0));
    assert.ok(externalExecutionSession.items.some((item) => item.evidenceRecipeRow.includes("<real handle")));
    assert.ok(externalExecutionSession.items.some((item) => item.evidenceRecipeRow.includes("<developer app id")));
    assert.ok(externalExecutionSession.items.some((item) => item.evidenceRecipeRow.includes("<permission request")));
    assert.ok(externalExecutionSession.items.every((item) => item.requiredInputs.length > 0));
    assert.ok(externalExecutionSession.items.every((item) => item.completionHint.length > 20));
    assert.equal(externalExecutionSession.items.every((item) => typeof item.evidenceImportReady === "boolean"), true);
    assert.equal(externalExecutionSession.unlockBoard.length, 3);
    assert.ok(externalExecutionSession.unlockBoard.every((item) => ["tiktok", "instagram", "youtube"].includes(item.platform)));
    assert.equal(externalExecutionSession.unlockBoard.reduce((sum, item) => sum + item.total, 0), externalExecutionSession.items.length);
    assert.ok(externalExecutionSession.unlockBoard.some((item) => item.nextEvidenceRows.length > 0));
    assert.ok(externalExecutionSession.unlockBoard.every((item) => item.nextStep.length > 20));
    assert.equal(status.externalExecutionSession.manifestPath, externalExecutionSession.manifestPath);

    const rawManifest = await readFile(externalExecutionSession.manifestPath, "utf8");
    const rawMarkdown = await readFile(externalExecutionSession.markdownPath, "utf8");
    const rawCsv = await readFile(externalExecutionSession.csvPath, "utf8");
    const rawEvidenceImport = await readFile(externalExecutionSession.evidenceImportPath, "utf8");
    assert.ok(rawMarkdown.includes("Clippers External Execution Session"));
    assert.ok(rawMarkdown.includes("Launch Evidence Import"));
    assert.ok(rawMarkdown.includes("Unlock Board"));
    assert.ok(rawMarkdown.includes("Required inputs"));
    assert.ok(rawMarkdown.includes("Lane reason"));
    assert.ok(rawMarkdown.includes("Evidence recipe row"));
    assert.ok(rawCsv.includes("action_mode"));
    assert.ok(rawCsv.includes("lane_reason"));
    assert.ok(rawCsv.includes("evidence_recipe_row"));
    assert.ok(rawCsv.includes("completion_hint"));
    assert.ok(rawCsv.includes("required_inputs"));
    assert.ok(rawCsv.includes("execution_url"));
    assert.ok(rawCsv.includes("evidence_import_ready"));
    assert.ok(rawMarkdown.includes("Execution URL"));
    assert.ok(rawMarkdown.includes("Evidence import ready"));
    assert.ok(rawEvidenceImport.startsWith("kind,account_id,platform,status,scope,app_identifier,public_base_url,notes"));
    assert.equal(rawEvidenceImport.includes("TIKTOK_CLIENT_SECRET"), false);
    assert.ok(rawManifest.includes("credentialTemplate"));
    assert.ok(rawManifest.includes("evidenceRecipeRow"));
    assert.ok(rawManifest.includes("requiredInputs"));
    assert.ok(rawManifest.includes("evidenceImportTemplate"));
    assert.ok(rawManifest.includes("unlockBoard"));
    assert.equal(rawMarkdown.includes("access_token"), false);
    assert.equal(rawManifest.includes("client_secret"), false);
  } finally {
    if (previousManifest === null) await unlink(beforeStatus.externalExecutionSession.manifestPath).catch(() => undefined);
    else await writeFile(beforeStatus.externalExecutionSession.manifestPath, previousManifest);
    if (previousMarkdown === null) await unlink(beforeStatus.externalExecutionSession.markdownPath).catch(() => undefined);
    else await writeFile(beforeStatus.externalExecutionSession.markdownPath, previousMarkdown);
    if (previousCsv === null) await unlink(beforeStatus.externalExecutionSession.csvPath).catch(() => undefined);
    else await writeFile(beforeStatus.externalExecutionSession.csvPath, previousCsv);
    if (previousEvidenceImport === null) await unlink(beforeStatus.externalExecutionSession.evidenceImportPath).catch(() => undefined);
    else await writeFile(beforeStatus.externalExecutionSession.evidenceImportPath, previousEvidenceImport);
  }
});

test("prepareClipperExternalLaunchDossier groups external launch actions by platform", async () => {
  const beforeStatus = await getClipperStatus();
  const previousManifest = await readFile(beforeStatus.externalLaunchDossier.manifestPath, "utf8").catch(() => null);
  const previousMarkdown = await readFile(beforeStatus.externalLaunchDossier.markdownPath, "utf8").catch(() => null);

  try {
    const { externalLaunchDossier, status } = await prepareClipperExternalLaunchDossier();
    assert.equal(externalLaunchDossier.platforms.length, 3);
    assert.equal(externalLaunchDossier.totals.platforms, 3);
    assert.ok(externalLaunchDossier.totals.blockedExternalItems > 0);
    assert.ok(externalLaunchDossier.totals.unlockInputs > 0);
    assert.equal(externalLaunchDossier.totals.permissionUnlocks, status.permissionQueue.length);
    assert.ok(externalLaunchDossier.platforms.some((item) => item.platform === "tiktok" && item.developerPortalUrl.includes("developers.tiktok.com")));
    assert.ok(externalLaunchDossier.platforms.every((item) => item.accountCreationUrl.startsWith("http") && item.criticalActions.length > 0));
    assert.ok(externalLaunchDossier.platforms.every((item) => item.blockedExternalItems > 0 && item.unlockInputs.length > 0 && item.sessionNextSteps.length > 0));
    assert.ok(externalLaunchDossier.platforms.every((item) => item.permissionUnlocks.length > 0 && item.permissionUnlocks.every((permission) => permission.requestPortalUrl.startsWith("https://") && permission.evidenceBatchRow.endsWith(',""'))));
    assert.ok(status.commandCenter.steps.some((step) => step.id === "external-launch-dossier" && step.actionUrl === "/api/clippers/prepare-external-launch-dossier"));

    const rawManifest = await readFile(externalLaunchDossier.manifestPath, "utf8");
    const rawMarkdown = await readFile(externalLaunchDossier.markdownPath, "utf8");
    assert.ok(rawMarkdown.includes("Clippers External Launch Dossier"));
    assert.ok(rawMarkdown.includes("Unlock inputs"));
    assert.ok(rawMarkdown.includes("Permission unlocks"));
    assert.ok(rawManifest.includes("developerPortalUrl"));
    assert.ok(rawManifest.includes("blockedExternalItems"));
    assert.ok(rawManifest.includes("permissionUnlocks"));
    assert.equal(rawManifest.includes("access_token"), false);
    assert.equal(rawMarkdown.includes("client_secret"), false);
  } finally {
    if (previousManifest === null) await unlink(beforeStatus.externalLaunchDossier.manifestPath).catch(() => undefined);
    else await writeFile(beforeStatus.externalLaunchDossier.manifestPath, previousManifest);
    if (previousMarkdown === null) await unlink(beforeStatus.externalLaunchDossier.markdownPath).catch(() => undefined);
    else await writeFile(beforeStatus.externalLaunchDossier.markdownPath, previousMarkdown);
  }
});

test("prepareClipperPlatformPortalChecklist writes consolidated portal actions", async () => {
  const beforeStatus = await getClipperStatus();
  const previousManifest = await readFile(beforeStatus.platformPortalChecklist.manifestPath, "utf8").catch(() => null);
  const previousMarkdown = await readFile(beforeStatus.platformPortalChecklist.markdownPath, "utf8").catch(() => null);
  const previousCsv = await readFile(beforeStatus.platformPortalChecklist.csvPath, "utf8").catch(() => null);

  try {
    const { platformPortalChecklist, status } = await prepareClipperPlatformPortalChecklist();
    assert.equal(platformPortalChecklist.items.length, 3);
    assert.equal(platformPortalChecklist.totals.platforms, 3);
    assert.ok(platformPortalChecklist.totals.portalActions >= 3);
    assert.ok(platformPortalChecklist.totals.evidenceRows > 0);
    assert.ok(platformPortalChecklist.items.every((item) => item.portalUrls.some((url) => url.startsWith("https://"))));
    assert.ok(platformPortalChecklist.items.every((item) => item.completionCriteria.length >= 5));
    assert.ok(platformPortalChecklist.items.some((item) => item.evidenceBatchRows.length > 0));
    assert.ok(status.commandCenter.steps.some((step) => step.id === "platform-portal-checklist" && step.actionUrl === "/api/clippers/prepare-platform-portal-checklist"));

    const rawManifest = await readFile(platformPortalChecklist.manifestPath, "utf8");
    const rawMarkdown = await readFile(platformPortalChecklist.markdownPath, "utf8");
    const rawCsv = await readFile(platformPortalChecklist.csvPath, "utf8");
    assert.ok(rawMarkdown.includes("Clippers Platform Portal Checklist"));
    assert.ok(rawMarkdown.includes("Completion Criteria"));
    assert.ok(rawCsv.includes("evidence_batch_rows"));
    assert.ok(rawManifest.includes("portalUrls"));
    assert.equal(JSON.stringify(platformPortalChecklist).includes("client_secret"), false);
    assert.equal(rawManifest.includes("access_token"), false);
    assert.equal(rawMarkdown.includes("client_secret"), false);
  } finally {
    if (previousManifest === null) await unlink(beforeStatus.platformPortalChecklist.manifestPath).catch(() => undefined);
    else await writeFile(beforeStatus.platformPortalChecklist.manifestPath, previousManifest);
    if (previousMarkdown === null) await unlink(beforeStatus.platformPortalChecklist.markdownPath).catch(() => undefined);
    else await writeFile(beforeStatus.platformPortalChecklist.markdownPath, previousMarkdown);
    if (previousCsv === null) await unlink(beforeStatus.platformPortalChecklist.csvPath).catch(() => undefined);
    else await writeFile(beforeStatus.platformPortalChecklist.csvPath, previousCsv);
  }
});

test("prepareClipperGoLiveExecutionPack writes executable platform phases", async () => {
  const beforeStatus = await getClipperStatus();
  const previousManifest = await readFile(beforeStatus.goLiveExecutionPack.manifestPath, "utf8").catch(() => null);
  const previousMarkdown = await readFile(beforeStatus.goLiveExecutionPack.markdownPath, "utf8").catch(() => null);

  try {
    const { goLiveExecutionPack, status } = await prepareClipperGoLiveExecutionPack();
    assert.equal(goLiveExecutionPack.platforms.length, 3);
    assert.equal(goLiveExecutionPack.totals.platforms, 3);
    assert.ok(goLiveExecutionPack.platforms.every((platform) => platform.phases.length >= 8));
    assert.ok(goLiveExecutionPack.platforms.some((platform) => platform.phases.some((phase) => phase.id.endsWith("developer-app") && phase.portalUrl?.startsWith("http"))));
    assert.ok(status.commandCenter.steps.some((step) => step.id === "go-live-execution-pack" && step.actionUrl === "/api/clippers/prepare-go-live-execution-pack"));
    assert.ok(status.growthAudit.items.some((item) => item.id === "go-live-execution-pack"));

    const rawManifest = await readFile(goLiveExecutionPack.manifestPath, "utf8");
    const rawMarkdown = await readFile(goLiveExecutionPack.markdownPath, "utf8");
    assert.ok(rawMarkdown.includes("Clippers Go-Live Execution Pack"));
    assert.ok(rawManifest.includes("ready_to_execute") || rawManifest.includes("blocked"));
    assert.equal(rawManifest.includes("access_token"), false);
    assert.equal(rawMarkdown.includes("client_secret"), false);
  } finally {
    if (previousManifest === null) await unlink(beforeStatus.goLiveExecutionPack.manifestPath).catch(() => undefined);
    else await writeFile(beforeStatus.goLiveExecutionPack.manifestPath, previousManifest);
    if (previousMarkdown === null) await unlink(beforeStatus.goLiveExecutionPack.markdownPath).catch(() => undefined);
    else await writeFile(beforeStatus.goLiveExecutionPack.markdownPath, previousMarkdown);
  }
});

test("prepareClipperOfficialPermissionMatrix writes official scope references", async () => {
  const beforeStatus = await getClipperStatus();
  const previousManifest = await readFile(beforeStatus.officialPermissionMatrix.manifestPath, "utf8").catch(() => null);
  const previousMarkdown = await readFile(beforeStatus.officialPermissionMatrix.markdownPath, "utf8").catch(() => null);

  try {
    const { officialPermissionMatrix, status } = await prepareClipperOfficialPermissionMatrix();
    assert.equal(officialPermissionMatrix.items.length, 3);
    assert.equal(officialPermissionMatrix.totals.scopes, status.permissionQueue.length);
    assert.ok(officialPermissionMatrix.items.some((item) => item.platform === "tiktok" && item.scopes.some((scope) => scope.scope === "video.publish" && scope.requiredForAutopost)));
    assert.ok(officialPermissionMatrix.items.some((item) => item.platform === "instagram" && item.sourceStatus === "official_login_required"));
    assert.ok(officialPermissionMatrix.items.some((item) => item.platform === "youtube" && item.scopes.some((scope) => scope.scope.includes("youtube.upload"))));
    assert.ok(officialPermissionMatrix.items.every((item) => item.scopes.every((scope) => scope.requestPortalUrl.startsWith("https://"))));
    assert.ok(officialPermissionMatrix.items.every((item) => item.scopes.every((scope) => scope.officialReferenceUrl.startsWith("https://"))));
    assert.ok(officialPermissionMatrix.items.every((item) => item.scopes.every((scope) => scope.verifiedAt === "2026-06-17" && scope.verificationNote.length > 20)));
    assert.ok(officialPermissionMatrix.items.some((item) => item.platform === "instagram" && item.scopes.every((scope) => scope.verificationStatus === "official_login_required")));
    assert.ok(officialPermissionMatrix.items.every((item) => item.scopes.every((scope) => scope.verificationChecklist.length >= 3)));
    assert.ok(officialPermissionMatrix.items.some((item) => item.platform === "instagram" && item.scopes.some((scope) => scope.verificationChecklist.some((step) => step.includes("Log in to Meta Developers")))));
    assert.ok(officialPermissionMatrix.items.every((item) => item.scopes.every((scope) => scope.launchEvidenceBatchRow.startsWith("permission,,"))));
    assert.ok(officialPermissionMatrix.items.every((item) => item.scopes.every((scope) => scope.portalSubmissionSteps && scope.portalSubmissionSteps.length >= 6)));
    assert.ok(officialPermissionMatrix.items.every((item) => item.scopes.every((scope) => scope.approvalEvidenceBatchRow?.includes(",approved,"))));
    assert.ok(officialPermissionMatrix.items.every((item) => item.scopes.every((scope) => scope.postApprovalChecklist && scope.postApprovalChecklist.length >= 4)));
    assert.ok(officialPermissionMatrix.items.every((item) => item.scopes.every((scope) => scope.complianceRisk && scope.complianceRisk.includes(scope.scope))));
    assert.ok(officialPermissionMatrix.items.every((item) => item.scopes.every((scope) => scope.fallbackPlan && scope.fallbackPlan.length > 20)));
    assert.ok(officialPermissionMatrix.items.every((item) => item.scopes.every((scope) => scope.sourceAudit && scope.sourceAudit.lastCheckedAt === "2026-06-17")));
    assert.ok(officialPermissionMatrix.items.every((item) => item.scopes.every((scope) => scope.sourceAudit?.canonicalUrl === scope.officialReferenceUrl)));
    assert.ok(officialPermissionMatrix.items.some((item) => item.platform === "instagram" && item.scopes.every((scope) => scope.sourceAudit?.accessMode === "login_required" && scope.sourceAudit.needsHumanRecheck)));
    assert.ok(officialPermissionMatrix.items.some((item) => item.platform === "tiktok" && item.scopes.every((scope) => scope.sourceAudit?.accessMode === "public")));
    assert.ok(officialPermissionMatrix.items.some((item) => item.platform === "youtube" && item.scopes.every((scope) => scope.sourceAudit?.goLiveDecision === "ready_to_request")));
    assert.ok(officialPermissionMatrix.items.every((item) => item.scopes.every((scope) => (scope.sourceAudit?.publicEvidence.length || 0) >= 2)));
    assert.ok(officialPermissionMatrix.items.every((item) => item.scopes.every((scope) => scope.sourceProofPack && scope.sourceProofPack.verifiedClaims.length >= 3)));
    assert.ok(officialPermissionMatrix.items.some((item) => item.platform === "tiktok" && item.scopes.every((scope) => scope.sourceProofPack?.status === "ready_to_attach" && scope.sourceProofPack.submitDecision === "request_now")));
    assert.ok(officialPermissionMatrix.items.some((item) => item.platform === "youtube" && item.scopes.every((scope) => scope.sourceProofPack?.officialUrls.some((url) => url.includes("developers.google.com")))));
    assert.ok(officialPermissionMatrix.items.some((item) => item.platform === "instagram" && item.scopes.every((scope) => scope.sourceProofPack?.status === "login_required" && scope.sourceProofPack.blocker?.includes("Meta Developers login"))));
    assert.ok(officialPermissionMatrix.items.every((item) => item.scopes.every((scope) => scope.evidenceRequired.length > 0)));
    assert.ok(status.commandCenter.steps.some((step) => step.id === "official-permission-matrix" && step.actionUrl === "/api/clippers/prepare-official-permission-matrix"));

    const rawManifest = await readFile(officialPermissionMatrix.manifestPath, "utf8");
    const rawMarkdown = await readFile(officialPermissionMatrix.markdownPath, "utf8");
    assert.ok(rawMarkdown.includes("Clippers Official Permission Matrix"));
    assert.ok(rawManifest.includes("developers.tiktok.com"));
    assert.ok(rawManifest.includes("developers.google.com/youtube"));
    assert.ok(rawManifest.includes("officialReferenceUrl"));
    assert.ok(rawMarkdown.includes("Official reference"));
    assert.ok(rawManifest.includes("verificationChecklist"));
    assert.ok(rawMarkdown.includes("Verification checklist"));
    assert.ok(rawMarkdown.includes("Source proof pack"));
    assert.ok(rawManifest.includes("sourceProofPack"));
    assert.ok(rawManifest.includes("ready_to_attach"));
    assert.ok(rawManifest.includes("portalSubmissionSteps"));
    assert.ok(rawMarkdown.includes("Portal submission steps"));
    assert.ok(rawManifest.includes("sourceAudit"));
    assert.ok(rawMarkdown.includes("Source audit"));
    assert.ok(rawMarkdown.includes("Go-live decision"));
    assert.ok(rawManifest.includes("approvalEvidenceBatchRow"));
    assert.ok(rawMarkdown.includes("Approval Evidence Batch"));
    assert.ok(rawManifest.includes("launchEvidenceBatchRow"));
    assert.ok(rawMarkdown.includes("Launch Evidence Batch"));
    assert.equal(rawManifest.includes("access_token"), false);
    assert.equal(rawMarkdown.includes("client_secret"), false);
  } finally {
    if (previousManifest === null) await unlink(beforeStatus.officialPermissionMatrix.manifestPath).catch(() => undefined);
    else await writeFile(beforeStatus.officialPermissionMatrix.manifestPath, previousManifest);
    if (previousMarkdown === null) await unlink(beforeStatus.officialPermissionMatrix.markdownPath).catch(() => undefined);
    else await writeFile(beforeStatus.officialPermissionMatrix.markdownPath, previousMarkdown);
  }
});

test("prepareClipperPublisherConnectors writes platform publish preflight contracts", async () => {
  const beforeStatus = await getClipperStatus();
  const previousManifest = await readFile(beforeStatus.publisherConnectors.manifestPath, "utf8").catch(() => null);
  const previousMarkdown = await readFile(beforeStatus.publisherConnectors.markdownPath, "utf8").catch(() => null);

  try {
    const { publisherConnectors, status } = await prepareClipperPublisherConnectors();
    assert.equal(publisherConnectors.items.length, 3);
    assert.ok(publisherConnectors.items.some((item) => item.platform === "tiktok" && item.endpoint.includes("open.tiktokapis.com") && item.requiredScopes.includes("video.publish")));
    assert.ok(publisherConnectors.items.some((item) => item.platform === "instagram" && item.endpoint.includes("graph.facebook.com") && item.mode === "media_publish"));
    assert.ok(publisherConnectors.items.some((item) => item.platform === "youtube" && item.endpoint.includes("googleapis.com/upload/youtube") && item.requiredScopes.some((scope) => scope.includes("youtube.upload"))));
    assert.ok(publisherConnectors.items.every((item) => item.payloadFields.length > 0 && item.preflightChecks.length > 0));
    assert.ok(publisherConnectors.items.every((item) => item.publishGate === "blocked" || item.goLiveChecks.every((check) => check.id && check.label)));
    assert.ok(publisherConnectors.items.some((item) => item.blockingCategories.includes("token")));
    assert.ok(publisherConnectors.items.every((item) => item.proofNeeded.length > 0 || item.status === "ready"));
    assert.ok(status.commandCenter.steps.some((step) => step.id === "publisher-connectors" && step.actionUrl === "/api/clippers/prepare-publisher-connectors"));

    const rawManifest = await readFile(publisherConnectors.manifestPath, "utf8");
    const rawMarkdown = await readFile(publisherConnectors.markdownPath, "utf8");
    assert.ok(rawMarkdown.includes("Clippers Publisher Connectors"));
    assert.ok(rawMarkdown.includes("Publish gate"));
    assert.ok(rawMarkdown.includes("Go-live checks"));
    assert.equal(rawManifest.includes("access_token_value"), false);
    assert.equal(rawMarkdown.includes("client_secret"), false);
  } finally {
    if (previousManifest === null) await unlink(beforeStatus.publisherConnectors.manifestPath).catch(() => undefined);
    else await writeFile(beforeStatus.publisherConnectors.manifestPath, previousManifest);
    if (previousMarkdown === null) await unlink(beforeStatus.publisherConnectors.markdownPath).catch(() => undefined);
    else await writeFile(beforeStatus.publisherConnectors.markdownPath, previousMarkdown);
  }
});

test("prepareClipperProductionUrlSetup writes redirect URI setup and blocks localhost go-live", async () => {
  const beforeStatus = await getClipperStatus();
  const previousManifest = await readFile(beforeStatus.productionUrlSetup.manifestPath, "utf8").catch(() => null);
  const previousMarkdown = await readFile(beforeStatus.productionUrlSetup.markdownPath, "utf8").catch(() => null);
  const previousPublicBaseUrl = process.env.PUBLIC_BASE_URL;

  try {
    process.env.PUBLIC_BASE_URL = "http://127.0.0.1:5013";
    const { productionUrlSetup, status } = await prepareClipperProductionUrlSetup();
    assert.equal(productionUrlSetup.platforms.length, 3);
    assert.equal(productionUrlSetup.requiredEnvVar, "PUBLIC_BASE_URL");
    assert.equal(productionUrlSetup.requiredProtocol, "https");
    assert.equal(productionUrlSetup.productionUrlReady, false);
    assert.ok(productionUrlSetup.setupSession.length >= 5);
    assert.ok(productionUrlSetup.setupSession.every((item) => item.copyValue.length > 0 && item.doneCriteria.length > 0));
    assert.ok(productionUrlSetup.setupSession.every((item) => item.clipboardValues.length > 0 && item.verificationUrls.length > 0));
    assert.ok(productionUrlSetup.setupSession.every((item) => item.evidenceRecipeRow.includes("developer_app")));
    assert.ok(productionUrlSetup.saveChecklist.length >= 5);
    assert.ok(productionUrlSetup.endpointChecks.length >= 7);
    assert.ok(productionUrlSetup.setupSession.some((item) => item.id === "record-public-base-url" && item.copyValue.includes("PUBLIC_BASE_URL")));
    assert.ok(productionUrlSetup.blockers.some((blocker) => blocker.includes("PUBLIC_BASE_URL")));
    assert.ok(productionUrlSetup.platforms.every((platform) => platform.redirectUri.includes(`/api/clippers/oauth/${platform.platform}/callback`)));
    assert.ok(productionUrlSetup.platforms.every((platform) => platform.publicRedirectUri.includes(`/api/clippers/oauth/${platform.platform}/callback`)));
    assert.ok(productionUrlSetup.platforms.every((platform) => platform.publicDemoUrl.includes("/clippers/review-demo")));
    assert.ok(productionUrlSetup.platforms.every((platform) => platform.publicLegalUrls.length === 2));
    assert.ok(productionUrlSetup.platforms.every((platform) => platform.evidenceRecipeRow.includes("<redirect URI + public URL evidence")));
    assert.ok(status.commandCenter.steps.some((step) => step.id === "production-url-setup" && step.actionUrl === "/api/clippers/prepare-production-url-setup"));

    const rawManifest = await readFile(productionUrlSetup.manifestPath, "utf8");
    const rawMarkdown = await readFile(productionUrlSetup.markdownPath, "utf8");
    assert.ok(rawMarkdown.includes("Clippers Production URL Setup"));
    assert.ok(rawMarkdown.includes("Production URL ready: no"));
    assert.ok(rawMarkdown.includes("Setup Session"));
    assert.ok(rawMarkdown.includes("Endpoint Checks"));
    assert.ok(rawMarkdown.includes("Save Checklist"));
    assert.ok(rawMarkdown.includes("Public redirect URI"));
    assert.ok(rawMarkdown.includes("Done criteria"));
    assert.ok(rawManifest.includes("PUBLIC_BASE_URL"));
    assert.ok(rawManifest.includes("setupSession"));
    assert.ok(rawManifest.includes("endpointChecks"));
    assert.equal(rawManifest.includes("client_secret"), false);
  } finally {
    if (previousPublicBaseUrl === undefined) delete process.env.PUBLIC_BASE_URL;
    else process.env.PUBLIC_BASE_URL = previousPublicBaseUrl;
    if (previousManifest === null) await unlink(beforeStatus.productionUrlSetup.manifestPath).catch(() => undefined);
    else await writeFile(beforeStatus.productionUrlSetup.manifestPath, previousManifest);
    if (previousMarkdown === null) await unlink(beforeStatus.productionUrlSetup.markdownPath).catch(() => undefined);
    else await writeFile(beforeStatus.productionUrlSetup.markdownPath, previousMarkdown);
  }
});

test("verifyClipperProductionUrl writes endpoint evidence without secrets", async () => {
  const beforeStatus = await getClipperStatus();
  const previousManifest = await readFile(beforeStatus.productionUrlVerification.manifestPath, "utf8").catch(() => null);
  const previousMarkdown = await readFile(beforeStatus.productionUrlVerification.markdownPath, "utf8").catch(() => null);
  const previousPublicBaseUrl = process.env.PUBLIC_BASE_URL;
  const originalFetch = globalThis.fetch;
  const lookupMock = mock.method(dns, "lookup", async () => [{ address: "203.0.113.10", family: 4 }]);

  try {
    process.env.PUBLIC_BASE_URL = "https://clippers-test.example.com";
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      if (url.includes("/api/clippers/oauth/")) return new Response("", { status: 400 });
      return new Response("<html>ok</html>", { status: 200 });
    }) as typeof fetch;

    const { productionUrlVerification, status } = await verifyClipperProductionUrl();
    assert.equal(productionUrlVerification.status, "pass");
    assert.equal(productionUrlVerification.publicBaseUrl, "https://clippers-test.example.com");
    assert.equal(productionUrlVerification.totals.endpoints, status.productionUrlSetup.endpointChecks.length);
    assert.equal(productionUrlVerification.totals.fail, 0);
    assert.equal(productionUrlVerification.totals.pass, productionUrlVerification.totals.endpoints);
    assert.equal(productionUrlVerification.dnsDiagnostic.status, "resolved");
    assert.equal(productionUrlVerification.dnsDiagnostic.rootDomain, "example.com");
    assert.equal(productionUrlVerification.dnsDiagnostic.isApexDomain, false);
    assert.deepEqual(productionUrlVerification.dnsDiagnostic.addresses, ["203.0.113.10"]);
    assert.ok(productionUrlVerification.dnsDiagnostic.suggestedRecords.some((record) => record.includes("clippers-test.example.com")));
    assert.ok(productionUrlVerification.dnsDiagnostic.recordCandidates.some((record) => record.id === "cloudflare-tunnel-cname" && record.copyLine.includes("CNAME")));
    assert.ok(productionUrlVerification.dnsDiagnostic.propagationChecks.some((command) => command.includes("curl -I https://clippers-test.example.com/clippers")));
    assert.ok(productionUrlVerification.dnsDiagnostic.registrarChecklist.length >= 4);
    assert.ok(productionUrlVerification.dnsDiagnostic.blockedUntilResolved.some((action) => action.includes("app review")));
    assert.ok(productionUrlVerification.items.some((item) => item.id === "review-demo" && item.statusCode === 200));
    assert.ok(productionUrlVerification.items.some((item) => item.id === "tiktok-callback" && item.statusCode === 400 && item.status === "pass"));
    assert.ok(status.commandCenter.steps.some((step) => step.id === "production-url-verification" && step.actionUrl === "/api/clippers/verify-production-url"));

    const rawManifest = await readFile(productionUrlVerification.manifestPath, "utf8");
    const rawMarkdown = await readFile(productionUrlVerification.markdownPath, "utf8");
    assert.ok(rawMarkdown.includes("Clippers Production URL Verification"));
    assert.ok(rawMarkdown.includes("DNS Diagnostic"));
    assert.ok(rawMarkdown.includes("Record candidates"));
    assert.ok(rawMarkdown.includes("Propagation checks"));
    assert.ok(rawMarkdown.includes("Blocked until DNS resolves"));
    assert.ok(rawMarkdown.includes("Endpoint Evidence"));
    assert.ok(rawManifest.includes("dnsDiagnostic"));
    assert.ok(rawManifest.includes("recordCandidates"));
    assert.ok(rawManifest.includes("responseMs"));
    assert.equal(rawManifest.includes("access_token"), false);
    assert.equal(rawMarkdown.includes("client_secret"), false);
  } finally {
    lookupMock.mock.restore();
    globalThis.fetch = originalFetch;
    if (previousPublicBaseUrl === undefined) delete process.env.PUBLIC_BASE_URL;
    else process.env.PUBLIC_BASE_URL = previousPublicBaseUrl;
    if (previousManifest === null) await unlink(beforeStatus.productionUrlVerification.manifestPath).catch(() => undefined);
    else await writeFile(beforeStatus.productionUrlVerification.manifestPath, previousManifest);
    if (previousMarkdown === null) await unlink(beforeStatus.productionUrlVerification.markdownPath).catch(() => undefined);
    else await writeFile(beforeStatus.productionUrlVerification.markdownPath, previousMarkdown);
  }
});

test("prepareClipperHttpsTunnelPlan writes public URL options and command center step", async () => {
  const beforeStatus = await getClipperStatus();
  const previousManifest = await readFile(beforeStatus.httpsTunnelPlan.manifestPath, "utf8").catch(() => null);
  const previousMarkdown = await readFile(beforeStatus.httpsTunnelPlan.markdownPath, "utf8").catch(() => null);

  try {
    const { httpsTunnelPlan, status } = await prepareClipperHttpsTunnelPlan();
    assert.equal(httpsTunnelPlan.options.length >= 4, true);
    assert.equal(httpsTunnelPlan.recommendedOptionId, "cloudflare-tunnel");
    assert.equal(httpsTunnelPlan.localPort, process.env.PORT || "5010");
    assert.equal(httpsTunnelPlan.localOrigin, `http://127.0.0.1:${process.env.PORT || "5010"}`);
    assert.equal(httpsTunnelPlan.executionSession.length, httpsTunnelPlan.options.length);
    assert.ok(httpsTunnelPlan.executionSession.every((item) => item.commandSequence.length > 0 && item.doneCriteria.length >= 4));
    assert.ok(httpsTunnelPlan.executionSession.every((item) => item.publicBaseUrlTemplate.startsWith("PUBLIC_BASE_URL=https://")));
    assert.ok(httpsTunnelPlan.executionSession.every((item) => item.savePublicBaseUrlSteps.length >= 4));
    assert.ok(httpsTunnelPlan.executionSession.every((item) => item.endpointChecks.length >= 4));
    assert.ok(httpsTunnelPlan.executionSession.every((item) => item.evidenceToCapture.length >= 4));
    assert.ok(httpsTunnelPlan.executionSession.every((item) => item.registerAfterSave.length === 3));
    assert.ok(httpsTunnelPlan.executionSession.every((item) => item.stabilityChecklist.length >= 4));
    assert.ok(httpsTunnelPlan.executionSession.some((item) => item.optionId === "cloudflare-tunnel" && item.recommended));
    assert.ok(httpsTunnelPlan.options.some((option) => option.id === "cloudflare-tunnel" && option.localCommands.some((command) => command.includes("cloudflared"))));
    assert.ok(httpsTunnelPlan.options.every((option) => option.localCommands.every((command) => !command.includes("5013"))));
    assert.ok(httpsTunnelPlan.options.some((option) => option.id === "ngrok-reserved-domain" && option.portalUrl.includes("ngrok")));
    assert.ok(status.commandCenter.steps.some((step) => step.id === "https-tunnel-plan" && step.actionUrl === "/api/clippers/prepare-https-tunnel-plan"));
    assert.ok(status.growthAudit.items.some((item) => item.id === "https-tunnel-plan"));

    const rawManifest = await readFile(httpsTunnelPlan.manifestPath, "utf8");
    const rawMarkdown = await readFile(httpsTunnelPlan.markdownPath, "utf8");
    assert.ok(rawMarkdown.includes("Clippers HTTPS Tunnel / Deploy Plan"));
    assert.ok(rawMarkdown.includes("Execution Session"));
    assert.ok(rawMarkdown.includes("PUBLIC_BASE_URL template"));
    assert.ok(rawMarkdown.includes("Endpoint checks"));
    assert.ok(rawMarkdown.includes("Register after save"));
    assert.ok(rawMarkdown.includes("Rollback plan"));
    assert.ok(rawMarkdown.includes(`Local port: ${process.env.PORT || "5010"}`));
    assert.ok(rawManifest.includes("cloudflare-tunnel"));
    assert.ok(rawManifest.includes("executionSession"));
    assert.ok(rawManifest.includes("publicBaseUrlTemplate"));
    assert.equal(rawManifest.includes("5013"), false);
    assert.equal(rawManifest.includes("access_token"), false);
    assert.equal(rawMarkdown.includes("client_secret"), false);
  } finally {
    if (previousManifest === null) await unlink(beforeStatus.httpsTunnelPlan.manifestPath).catch(() => undefined);
    else await writeFile(beforeStatus.httpsTunnelPlan.manifestPath, previousManifest);
    if (previousMarkdown === null) await unlink(beforeStatus.httpsTunnelPlan.markdownPath).catch(() => undefined);
    else await writeFile(beforeStatus.httpsTunnelPlan.markdownPath, previousMarkdown);
  }
});

test("prepareClipperLegalPolicyPack writes public privacy and terms artifacts", async () => {
  const beforeStatus = await getClipperStatus();
  const previousManifest = await readFile(beforeStatus.legalPolicyPack.manifestPath, "utf8").catch(() => null);
  const previousMarkdown = await readFile(beforeStatus.legalPolicyPack.markdownPath, "utf8").catch(() => null);
  const previousPrivacy = await readFile(beforeStatus.legalPolicyPack.privacyPath, "utf8").catch(() => null);
  const previousTerms = await readFile(beforeStatus.legalPolicyPack.termsPath, "utf8").catch(() => null);

  try {
    const { legalPolicyPack, status } = await prepareClipperLegalPolicyPack();
    assert.ok(legalPolicyPack.privacyUrl.endsWith("/clippers/legal/privacy"));
    assert.ok(legalPolicyPack.termsUrl.endsWith("/clippers/legal/terms"));
    assert.ok(status.commandCenter.steps.some((step) => step.id === "legal-policy-pack" && step.actionUrl === "/api/clippers/prepare-legal-policy-pack"));
    assert.ok(status.growthAudit.items.some((item) => item.id === "legal-policy-pack"));

    const rawPrivacy = await readFile(legalPolicyPack.privacyPath, "utf8");
    const rawTerms = await readFile(legalPolicyPack.termsPath, "utf8");
    const rawMarkdown = await readFile(legalPolicyPack.markdownPath, "utf8");
    assert.ok(rawPrivacy.includes("Clippers Privacy Policy"));
    assert.ok(rawTerms.includes("Clippers Terms of Service"));
    assert.ok(rawMarkdown.includes("Privacy Policy"));
    assert.equal(rawPrivacy.includes("access_token"), false);
    assert.equal(rawTerms.includes("client_secret"), false);
  } finally {
    if (previousManifest === null) await unlink(beforeStatus.legalPolicyPack.manifestPath).catch(() => undefined);
    else await writeFile(beforeStatus.legalPolicyPack.manifestPath, previousManifest);
    if (previousMarkdown === null) await unlink(beforeStatus.legalPolicyPack.markdownPath).catch(() => undefined);
    else await writeFile(beforeStatus.legalPolicyPack.markdownPath, previousMarkdown);
    if (previousPrivacy === null) await unlink(beforeStatus.legalPolicyPack.privacyPath).catch(() => undefined);
    else await writeFile(beforeStatus.legalPolicyPack.privacyPath, previousPrivacy);
    if (previousTerms === null) await unlink(beforeStatus.legalPolicyPack.termsPath).catch(() => undefined);
    else await writeFile(beforeStatus.legalPolicyPack.termsPath, previousTerms);
  }
});

test("prepareClipperAppReviewDemoPack writes public demo and screencast script without secrets", async () => {
  const beforeStatus = await getClipperStatus();
  const previousManifest = await readFile(beforeStatus.appReviewDemoPack.manifestPath, "utf8").catch(() => null);
  const previousMarkdown = await readFile(beforeStatus.appReviewDemoPack.markdownPath, "utf8").catch(() => null);
  const previousScript = await readFile(beforeStatus.appReviewDemoPack.demoScriptPath, "utf8").catch(() => null);

  try {
    const { appReviewDemoPack, status } = await prepareClipperAppReviewDemoPack();
    assert.ok(appReviewDemoPack.demoUrl.endsWith("/clippers/review-demo"));
    assert.equal(appReviewDemoPack.steps.length >= 3, true);
    assert.ok(status.commandCenter.steps.some((step) => step.id === "app-review-demo-pack" && step.actionUrl === "/api/clippers/prepare-app-review-demo-pack"));
    assert.ok(status.growthAudit.items.some((item) => item.id === "app-review-demo-pack"));

    const rawManifest = await readFile(appReviewDemoPack.manifestPath, "utf8");
    const rawMarkdown = await readFile(appReviewDemoPack.markdownPath, "utf8");
    const rawScript = await readFile(appReviewDemoPack.demoScriptPath, "utf8");
    assert.ok(rawMarkdown.includes("Clippers App Review Demo Pack"));
    assert.ok(rawScript.includes("Rights Gate"));
    assert.ok(rawScript.includes("approval_required"));
    assert.equal(rawManifest.includes("client_secret"), false);
    assert.equal(rawMarkdown.includes("access_token"), false);
    assert.equal(rawScript.includes("refresh_token"), false);
  } finally {
    if (previousManifest === null) await unlink(beforeStatus.appReviewDemoPack.manifestPath).catch(() => undefined);
    else await writeFile(beforeStatus.appReviewDemoPack.manifestPath, previousManifest);
    if (previousMarkdown === null) await unlink(beforeStatus.appReviewDemoPack.markdownPath).catch(() => undefined);
    else await writeFile(beforeStatus.appReviewDemoPack.markdownPath, previousMarkdown);
    if (previousScript === null) await unlink(beforeStatus.appReviewDemoPack.demoScriptPath).catch(() => undefined);
    else await writeFile(beforeStatus.appReviewDemoPack.demoScriptPath, previousScript);
  }
});

test("prepareClipperDeveloperApplicationDrafts writes copy-ready developer app submissions", async () => {
  const beforeStatus = await getClipperStatus();
  const previousManifest = await readFile(beforeStatus.developerApplicationDrafts.manifestPath, "utf8").catch(() => null);
  const previousMarkdown = await readFile(beforeStatus.developerApplicationDrafts.markdownPath, "utf8").catch(() => null);

  try {
    const { developerApplicationDrafts, status } = await prepareClipperDeveloperApplicationDrafts();
    assert.equal(developerApplicationDrafts.items.length, 3);
    assert.equal(developerApplicationDrafts.totals.platforms, 3);
    assert.ok(developerApplicationDrafts.totals.scopes >= 5);
    assert.equal(developerApplicationDrafts.creationSession.length, 3);
    assert.ok(developerApplicationDrafts.totals.sessionSteps >= 30);
    assert.ok(developerApplicationDrafts.creationSession.every((item) => item.portalFields.length >= 7));
    assert.ok(developerApplicationDrafts.creationSession.every((item) => item.evidenceNeeded.length >= 5));
    assert.ok(developerApplicationDrafts.creationSession.every((item) => item.doneCriteria.length >= 4));
    assert.ok(developerApplicationDrafts.creationSession.every((item) => item.credentialEnvGroups.length >= 2));
    assert.ok(developerApplicationDrafts.creationSession.every((item) => item.credentialCopyMap.length >= 2));
    assert.ok(developerApplicationDrafts.creationSession.every((item) => item.portalSubmissionSteps.length >= 10));
    assert.ok(developerApplicationDrafts.creationSession.every((item) => item.appVaultChecklist.length >= 5));
    assert.ok(developerApplicationDrafts.creationSession.every((item) => item.draftEvidenceBatchRow.includes(",\"draft\",")));
    assert.ok(developerApplicationDrafts.creationSession.every((item) => item.submittedEvidenceBatchRow.includes(",\"submitted\",")));
    assert.ok(developerApplicationDrafts.creationSession.every((item) => item.approvedEvidenceBatchRow.includes(",\"approved\",")));
    assert.ok(developerApplicationDrafts.creationSession.some((item) => item.platform === "tiktok" && item.credentialEnvGroups.some((group) => group.includes("TIKTOK_CLIENT_KEY"))));
    assert.ok(developerApplicationDrafts.items.every((item) => item.redirectUri.includes("/api/clippers/oauth/")));
    assert.ok(developerApplicationDrafts.items.every((item) => item.submissionAnswers.some((answer) => answer.prompt.includes("permissions"))));
    assert.ok(developerApplicationDrafts.items.every((item) => item.requiredInputs.length > 0 && item.completionHint.length > 20));
    assert.ok(developerApplicationDrafts.items.every((item) => item.portalFlow.length >= 5));
    assert.ok(developerApplicationDrafts.items.every((item) => item.approvalCriteria.length >= 4));
    assert.ok(developerApplicationDrafts.items.every((item) => item.postApprovalSteps.length >= 5));
    assert.ok(developerApplicationDrafts.items.every((item) => item.credentialCopyMap.length >= 2));
    assert.ok(developerApplicationDrafts.items.every((item) => item.portalSubmissionSteps.length >= 10));
    assert.ok(developerApplicationDrafts.items.every((item) => item.appVaultChecklist.length >= 5));
    assert.ok(developerApplicationDrafts.items.every((item) => item.draftEvidenceBatchRow.includes(",\"draft\",")));
    assert.ok(developerApplicationDrafts.items.every((item) => item.submittedEvidenceBatchRow.includes(",\"submitted\",")));
    assert.ok(developerApplicationDrafts.items.every((item) => item.approvedEvidenceBatchRow.includes(",\"approved\",")));
    assert.ok(developerApplicationDrafts.items.some((item) => item.platform === "instagram" && item.portalFlow.some((step) => step.includes("Meta Developers"))));
    assert.ok(developerApplicationDrafts.items.every((item) => item.evidenceBatchRow.startsWith('"developer_app"')));
    assert.ok(developerApplicationDrafts.items.every((item) => item.evidenceRecipeRow.includes("<developer app id")));
    assert.ok(developerApplicationDrafts.items.some((item) => item.platform === "youtube" && item.requestedScopes.includes("https://www.googleapis.com/auth/youtube.upload")));
    assert.ok(status.commandCenter.steps.some((step) => step.id === "developer-application-drafts" && step.actionUrl === "/api/clippers/prepare-developer-application-drafts"));
    assert.ok(status.growthAudit.items.some((item) => item.id === "developer-application-drafts"));

    const rawManifest = await readFile(developerApplicationDrafts.manifestPath, "utf8");
    const rawMarkdown = await readFile(developerApplicationDrafts.markdownPath, "utf8");
    assert.ok(rawMarkdown.includes("Clippers Developer Application Drafts"));
    assert.ok(rawMarkdown.includes("Official sources checked"));
    assert.ok(rawMarkdown.includes("Developer App Creation Session"));
    assert.ok(rawMarkdown.includes("Portal fields"));
    assert.ok(rawMarkdown.includes("Credential copy map"));
    assert.ok(rawMarkdown.includes("Portal submission steps"));
    assert.ok(rawMarkdown.includes("App vault checklist"));
    assert.ok(rawMarkdown.includes("Done criteria"));
    assert.ok(rawMarkdown.includes("Portal flow"));
    assert.ok(rawMarkdown.includes("Approval criteria"));
    assert.ok(rawMarkdown.includes("Post-approval steps"));
    assert.ok(rawMarkdown.includes("Evidence recipe row"));
    assert.ok(rawMarkdown.includes("Evidence batch row"));
    assert.ok(rawManifest.includes("requiredInputs"));
    assert.ok(rawManifest.includes("creationSession"));
    assert.ok(rawManifest.includes("credentialEnvGroups"));
    assert.ok(rawManifest.includes("credentialCopyMap"));
    assert.ok(rawManifest.includes("approvedEvidenceBatchRow"));
    assert.ok(rawMarkdown.includes("TikTok Content Posting API"));
    assert.equal(rawManifest.includes("client_secret"), false);
    assert.equal(rawMarkdown.includes("access_token_value"), false);
  } finally {
    if (previousManifest === null) await unlink(beforeStatus.developerApplicationDrafts.manifestPath).catch(() => undefined);
    else await writeFile(beforeStatus.developerApplicationDrafts.manifestPath, previousManifest);
    if (previousMarkdown === null) await unlink(beforeStatus.developerApplicationDrafts.markdownPath).catch(() => undefined);
    else await writeFile(beforeStatus.developerApplicationDrafts.markdownPath, previousMarkdown);
  }
});

test("recordClipperProductionPublicUrl requires public HTTPS and refreshes go-live artifacts", async () => {
  const envPath = path.join(process.cwd(), "CEO_ASSISTANT_ENV");
  const previousFile = await readFile(envPath, "utf8").catch(() => null);
  const originalPublicBaseUrl = process.env.PUBLIC_BASE_URL;
  const beforeStatus = await getClipperStatus();
  const previousProductionUrl = await readFile(beforeStatus.productionUrlSetup.manifestPath, "utf8").catch(() => null);
  const previousOauth = await readFile(beforeStatus.oauthGoLive.manifestPath, "utf8").catch(() => null);
  const previousAppReview = await readFile(beforeStatus.appReviewSubmissionPack.manifestPath, "utf8").catch(() => null);
  const previousAppReviewDemo = await readFile(beforeStatus.appReviewDemoPack.manifestPath, "utf8").catch(() => null);
  const previousAppReviewDemoMarkdown = await readFile(beforeStatus.appReviewDemoPack.markdownPath, "utf8").catch(() => null);
  const previousAppReviewDemoScript = await readFile(beforeStatus.appReviewDemoPack.demoScriptPath, "utf8").catch(() => null);
  const previousDeveloperApplicationDrafts = await readFile(beforeStatus.developerApplicationDrafts.manifestPath, "utf8").catch(() => null);
  const previousDeveloperApplicationDraftsMarkdown = await readFile(beforeStatus.developerApplicationDrafts.markdownPath, "utf8").catch(() => null);
  const previousGoLive = await readFile(beforeStatus.goLiveExecutionPack.manifestPath, "utf8").catch(() => null);
  const previousLegal = await readFile(beforeStatus.legalPolicyPack.manifestPath, "utf8").catch(() => null);
  const previousPrivacy = await readFile(beforeStatus.legalPolicyPack.privacyPath, "utf8").catch(() => null);
  const previousTerms = await readFile(beforeStatus.legalPolicyPack.termsPath, "utf8").catch(() => null);

  try {
    await assert.rejects(
      () => recordClipperProductionPublicUrl({ publicBaseUrl: "http://127.0.0.1:5013" }),
      /publica HTTPS/
    );

    const { productionPublicUrl, status } = await recordClipperProductionPublicUrl({
      publicBaseUrl: "https://clippers-test.example.com/",
    });

    assert.equal(productionPublicUrl.publicBaseUrl, "https://clippers-test.example.com");
    assert.equal(productionPublicUrl.productionUrlSetup.productionUrlReady, true);
    assert.equal(productionPublicUrl.legalPolicyPack.productionUrlReady, true);
    assert.ok(productionPublicUrl.legalPolicyPack.privacyUrl.startsWith("https://clippers-test.example.com"));
    assert.equal(productionPublicUrl.appReviewDemoPack.productionUrlReady, true);
    assert.ok(productionPublicUrl.appReviewDemoPack.demoUrl.startsWith("https://clippers-test.example.com"));
    assert.equal(productionPublicUrl.developerApplicationDrafts.status, "ready");
    assert.ok(productionPublicUrl.developerApplicationDrafts.items.every((item) => item.redirectUri.startsWith("https://clippers-test.example.com")));
    assert.equal(productionPublicUrl.oauthGoLive.productionUrlReady, true);
    assert.ok(productionPublicUrl.appReviewSubmissionPack.items.every((item) => item.redirectUri.startsWith("https://clippers-test.example.com")));
    assert.ok(productionPublicUrl.appReviewSubmissionPack.items.every((item) => item.demoUrl.startsWith("https://clippers-test.example.com")));
    assert.ok(productionPublicUrl.goLiveExecutionPack.platforms.some((platform) => platform.phases.some((phase) => phase.id.endsWith("production-url") && phase.status === "done")));
    assert.equal(status.productionUrlSetup.productionUrlReady, true);

    const rawEnv = await readFile(envPath, "utf8");
    assert.ok(rawEnv.includes("PUBLIC_BASE_URL=https://clippers-test.example.com"));
    assert.equal(JSON.stringify(productionPublicUrl).includes("client_secret"), false);
  } finally {
    if (originalPublicBaseUrl) process.env.PUBLIC_BASE_URL = originalPublicBaseUrl;
    else delete process.env.PUBLIC_BASE_URL;
    if (previousFile === null) await unlink(envPath).catch(() => undefined);
    else await writeFile(envPath, previousFile);
    if (previousProductionUrl === null) await unlink(beforeStatus.productionUrlSetup.manifestPath).catch(() => undefined);
    else await writeFile(beforeStatus.productionUrlSetup.manifestPath, previousProductionUrl);
    if (previousOauth === null) await unlink(beforeStatus.oauthGoLive.manifestPath).catch(() => undefined);
    else await writeFile(beforeStatus.oauthGoLive.manifestPath, previousOauth);
    if (previousAppReview === null) await unlink(beforeStatus.appReviewSubmissionPack.manifestPath).catch(() => undefined);
    else await writeFile(beforeStatus.appReviewSubmissionPack.manifestPath, previousAppReview);
    if (previousAppReviewDemo === null) await unlink(beforeStatus.appReviewDemoPack.manifestPath).catch(() => undefined);
    else await writeFile(beforeStatus.appReviewDemoPack.manifestPath, previousAppReviewDemo);
    if (previousAppReviewDemoMarkdown === null) await unlink(beforeStatus.appReviewDemoPack.markdownPath).catch(() => undefined);
    else await writeFile(beforeStatus.appReviewDemoPack.markdownPath, previousAppReviewDemoMarkdown);
    if (previousAppReviewDemoScript === null) await unlink(beforeStatus.appReviewDemoPack.demoScriptPath).catch(() => undefined);
    else await writeFile(beforeStatus.appReviewDemoPack.demoScriptPath, previousAppReviewDemoScript);
    if (previousDeveloperApplicationDrafts === null) await unlink(beforeStatus.developerApplicationDrafts.manifestPath).catch(() => undefined);
    else await writeFile(beforeStatus.developerApplicationDrafts.manifestPath, previousDeveloperApplicationDrafts);
    if (previousDeveloperApplicationDraftsMarkdown === null) await unlink(beforeStatus.developerApplicationDrafts.markdownPath).catch(() => undefined);
    else await writeFile(beforeStatus.developerApplicationDrafts.markdownPath, previousDeveloperApplicationDraftsMarkdown);
    if (previousGoLive === null) await unlink(beforeStatus.goLiveExecutionPack.manifestPath).catch(() => undefined);
    else await writeFile(beforeStatus.goLiveExecutionPack.manifestPath, previousGoLive);
    if (previousLegal === null) await unlink(beforeStatus.legalPolicyPack.manifestPath).catch(() => undefined);
    else await writeFile(beforeStatus.legalPolicyPack.manifestPath, previousLegal);
    if (previousPrivacy === null) await unlink(beforeStatus.legalPolicyPack.privacyPath).catch(() => undefined);
    else await writeFile(beforeStatus.legalPolicyPack.privacyPath, previousPrivacy);
    if (previousTerms === null) await unlink(beforeStatus.legalPolicyPack.termsPath).catch(() => undefined);
    else await writeFile(beforeStatus.legalPolicyPack.termsPath, previousTerms);
  }
});

test("prepareClipperAppReviewSubmissionPack writes copy-ready review answers without secrets", async () => {
  const beforeStatus = await getClipperStatus();
  const previousManifest = await readFile(beforeStatus.appReviewSubmissionPack.manifestPath, "utf8").catch(() => null);
  const previousMarkdown = await readFile(beforeStatus.appReviewSubmissionPack.markdownPath, "utf8").catch(() => null);

  try {
    const { appReviewSubmissionPack, status } = await prepareClipperAppReviewSubmissionPack();
    assert.equal(appReviewSubmissionPack.items.length, 3);
    assert.equal(appReviewSubmissionPack.totals.platforms, 3);
    assert.ok(appReviewSubmissionPack.totals.answers >= 12);
    assert.ok(appReviewSubmissionPack.items.every((item) => item.submissionAnswers.some((answer) => answer.prompt.includes("permissions"))));
    assert.ok(appReviewSubmissionPack.items.every((item) => item.demoUrl.endsWith("/clippers/review-demo")));
    assert.ok(appReviewSubmissionPack.items.some((item) => item.platform === "tiktok" && item.requestedScopes.includes("video.publish")));
    assert.ok(status.commandCenter.steps.some((step) => step.id === "app-review-submission-pack" && step.actionUrl === "/api/clippers/prepare-app-review-submission-pack"));

    const rawManifest = await readFile(appReviewSubmissionPack.manifestPath, "utf8");
    const rawMarkdown = await readFile(appReviewSubmissionPack.markdownPath, "utf8");
    assert.ok(rawMarkdown.includes("Clippers App Review Submission Pack"));
    assert.ok(rawMarkdown.includes("Submission answers"));
    assert.ok(rawMarkdown.includes("Demo URL"));
    assert.equal(rawManifest.includes("client_secret"), false);
    assert.equal(rawMarkdown.includes("access_token_value"), false);
  } finally {
    if (previousManifest === null) await unlink(beforeStatus.appReviewSubmissionPack.manifestPath).catch(() => undefined);
    else await writeFile(beforeStatus.appReviewSubmissionPack.manifestPath, previousManifest);
    if (previousMarkdown === null) await unlink(beforeStatus.appReviewSubmissionPack.markdownPath).catch(() => undefined);
    else await writeFile(beforeStatus.appReviewSubmissionPack.markdownPath, previousMarkdown);
  }
});

test("prepareClipperOAuthGoLivePreflight writes OAuth go-live gate without secrets", async () => {
  const beforeStatus = await getClipperStatus();
  const previousManifest = await readFile(beforeStatus.oauthGoLive.manifestPath, "utf8").catch(() => null);
  const previousMarkdown = await readFile(beforeStatus.oauthGoLive.markdownPath, "utf8").catch(() => null);
  const previousPublicBaseUrl = process.env.PUBLIC_BASE_URL;

  try {
    process.env.PUBLIC_BASE_URL = "http://127.0.0.1:5013";
    const { oauthGoLive, status } = await prepareClipperOAuthGoLivePreflight();
    assert.equal(oauthGoLive.items.length, 3);
    assert.equal(oauthGoLive.totals.platforms, 3);
    assert.ok(oauthGoLive.publicBaseUrl.includes("5013") || oauthGoLive.publicBaseUrl.startsWith("http"));
    assert.equal(oauthGoLive.productionUrlReady, false);
    assert.ok(oauthGoLive.productionUrlNote.includes("PUBLIC_BASE_URL"));
    assert.ok(oauthGoLive.items.every((item) => item.productionUrlReady === false));
    assert.ok(oauthGoLive.items.every((item) => item.blockers.some((blocker) => blocker.includes("PUBLIC_BASE_URL"))));
    assert.ok(oauthGoLive.items.every((item) => item.redirectUri.includes(item.callbackPath)));
    assert.ok(oauthGoLive.items.some((item) => item.platform === "youtube" && item.permissionsTotal > 0));
    assert.ok(status.commandCenter.steps.some((step) => step.id === "oauth-go-live" && step.actionUrl === "/api/clippers/prepare-oauth-go-live"));

    const rawManifest = await readFile(oauthGoLive.manifestPath, "utf8");
    const rawMarkdown = await readFile(oauthGoLive.markdownPath, "utf8");
    assert.ok(rawMarkdown.includes("Clippers OAuth Go-Live Preflight"));
    assert.ok(rawMarkdown.includes("Production URL ready: no"));
    assert.ok(rawManifest.includes("redirectUri"));
    assert.equal(rawManifest.includes("access_token"), false);
    assert.equal(rawMarkdown.includes("client_secret"), false);
  } finally {
    if (previousPublicBaseUrl === undefined) delete process.env.PUBLIC_BASE_URL;
    else process.env.PUBLIC_BASE_URL = previousPublicBaseUrl;
    if (previousManifest === null) await unlink(beforeStatus.oauthGoLive.manifestPath).catch(() => undefined);
    else await writeFile(beforeStatus.oauthGoLive.manifestPath, previousManifest);
    if (previousMarkdown === null) await unlink(beforeStatus.oauthGoLive.markdownPath).catch(() => undefined);
    else await writeFile(beforeStatus.oauthGoLive.markdownPath, previousMarkdown);
  }
});

test("prepareClipperOAuthConnectionPack writes per-account OAuth runbook without secrets", async () => {
  const beforeStatus = await getClipperStatus();
  const previousManifest = await readFile(beforeStatus.oauthConnectionPack.manifestPath, "utf8").catch(() => null);
  const previousMarkdown = await readFile(beforeStatus.oauthConnectionPack.markdownPath, "utf8").catch(() => null);
  const previousCsv = await readFile(beforeStatus.oauthConnectionPack.csvPath, "utf8").catch(() => null);

  try {
    const { oauthConnectionPack, status } = await prepareClipperOAuthConnectionPack();
    const expectedConnections = status.accounts.reduce((sum, account) => sum + account.platformAccounts.length, 0);
    assert.equal(oauthConnectionPack.items.length, expectedConnections);
    assert.equal(oauthConnectionPack.totals.connections, expectedConnections);
    assert.ok(oauthConnectionPack.markdownPath.endsWith("oauth-connection-pack.md"));
    assert.ok(oauthConnectionPack.csvPath.endsWith("oauth-connection-pack.csv"));
    assert.ok(oauthConnectionPack.items.every((item) => item.redirectUri.includes(item.callbackPath)));
    assert.ok(oauthConnectionPack.items.some((item) => item.platform === "youtube" && item.requestedScopes.some((scope) => scope.includes("youtube.upload"))));
    assert.ok(oauthConnectionPack.items.every((item) => item.evidenceToCapture.some((evidence) => evidence.includes("token"))));
    assert.ok(oauthConnectionPack.items.every((item) => item.requiredInputs.length > 0 && item.completionHint.length > 20));
    assert.ok(status.commandCenter.steps.some((step) => step.id === "oauth-connection-pack" && step.actionUrl === "/api/clippers/prepare-oauth-connection-pack"));
    assert.ok(status.growthAudit.items.some((item) => item.id === "oauth-connection-pack"));

    const rawManifest = await readFile(oauthConnectionPack.manifestPath, "utf8");
    const rawMarkdown = await readFile(oauthConnectionPack.markdownPath, "utf8");
    const rawCsv = await readFile(oauthConnectionPack.csvPath, "utf8");
    assert.ok(rawMarkdown.includes("Clippers OAuth Connection Pack"));
    assert.ok(rawMarkdown.includes("Account Connections"));
    assert.ok(rawMarkdown.includes("Required inputs"));
    assert.ok(rawCsv.includes("redirect_uri"));
    assert.ok(rawCsv.includes("required_inputs"));
    assert.ok(rawManifest.includes("requiredInputs"));
    assert.equal(rawManifest.includes("client_secret"), false);
    assert.equal(rawMarkdown.includes("access_token_value"), false);
    assert.equal(rawCsv.includes("refresh_token"), false);
  } finally {
    if (previousManifest === null) await unlink(beforeStatus.oauthConnectionPack.manifestPath).catch(() => undefined);
    else await writeFile(beforeStatus.oauthConnectionPack.manifestPath, previousManifest);
    if (previousMarkdown === null) await unlink(beforeStatus.oauthConnectionPack.markdownPath).catch(() => undefined);
    else await writeFile(beforeStatus.oauthConnectionPack.markdownPath, previousMarkdown);
    if (previousCsv === null) await unlink(beforeStatus.oauthConnectionPack.csvPath).catch(() => undefined);
    else await writeFile(beforeStatus.oauthConnectionPack.csvPath, previousCsv);
  }
});

test("prepareClipperLaunchCommandCenter prepares all local launch artifacts and blocker map", async () => {
  const { commandCenter, status } = await prepareClipperLaunchCommandCenter(undefined, {
    clipsPerAccount: 2,
    publishMode: "approval_required",
    riskTolerance: "growth",
    weeklyTargetClips: 100,
  });

  try {
    assert.ok(commandCenter.manifestPath.endsWith("launch-command-center.json"));
    assert.ok(commandCenter.markdownPath.endsWith("launch-command-center.md"));
    assert.equal(commandCenter.totals.steps >= 8, true);
    assert.ok(commandCenter.steps.some((step) => step.id === "internal-setup" && step.status === "done"));
    assert.ok(commandCenter.steps.some((step) => step.id === "external-accounts"));
    assert.ok(commandCenter.steps.some((step) => step.id === "oauth-token-vault"));
    assert.equal(status.commandCenter.manifestPath, commandCenter.manifestPath);

    const manifestStat = await stat(commandCenter.manifestPath);
    const markdownStat = await stat(commandCenter.markdownPath);
    assert.equal(manifestStat.isFile(), true);
    assert.equal(markdownStat.isFile(), true);

    const markdown = await readFile(commandCenter.markdownPath, "utf8");
    assert.ok(markdown.includes("Clippers Launch Command Center"));
    assert.ok(markdown.includes("Cuentas reales por plataforma"));
  } finally {
    await unlink(commandCenter.manifestPath).catch(() => undefined);
    await unlink(commandCenter.markdownPath).catch(() => undefined);
  }
});

test("prepareClipperBlockerResolutionPack writes prioritized unblock actions", async () => {
  const beforeStatus = await getClipperStatus();
  const previousManifest = await readFile(beforeStatus.blockerResolutionPack.manifestPath, "utf8").catch(() => null);
  const previousMarkdown = await readFile(beforeStatus.blockerResolutionPack.markdownPath, "utf8").catch(() => null);
  const previousCsv = await readFile(beforeStatus.blockerResolutionPack.csvPath, "utf8").catch(() => null);

  try {
    const { blockerResolutionPack, status } = await prepareClipperBlockerResolutionPack();
    assert.ok(blockerResolutionPack.manifestPath.endsWith("blocker-resolution-pack.json"));
    assert.ok(blockerResolutionPack.markdownPath.endsWith("blocker-resolution-pack.md"));
    assert.ok(blockerResolutionPack.csvPath.endsWith("blocker-resolution-pack.csv"));
    assert.ok(blockerResolutionPack.actions.length > 0);
    assert.equal(blockerResolutionPack.actions[0].rank, 1);
    assert.ok(blockerResolutionPack.actions.some((action) => action.status === "blocked"));
    assert.ok(blockerResolutionPack.actions.every((action) => action.checklist.length >= 2));
    assert.ok(blockerResolutionPack.actions.every((action) => action.doneCriteria.length >= 2));
    assert.ok(blockerResolutionPack.actions.every((action) => action.unlockPhase && Array.isArray(action.dependsOn)));
    assert.ok(blockerResolutionPack.actions.every((action) => action.proofCommand.length > 0));
    assert.ok(blockerResolutionPack.actions.every((action) => action.executionMode && action.estimatedMinutes > 0));
    assert.ok(blockerResolutionPack.actions.some((action) => action.portalUrl?.startsWith("https://")));
    assert.ok(blockerResolutionPack.actions.some((action) => ["account", "developer_app", "permission"].includes(action.actionType) && action.evidenceImportRow.length > 0));
    assert.ok(blockerResolutionPack.evidenceBatchTemplate.includes("kind,account_id,platform,status"));
    assert.equal(status.blockerResolutionPack.manifestPath, blockerResolutionPack.manifestPath);

    const rawManifest = await readFile(blockerResolutionPack.manifestPath, "utf8");
    const rawMarkdown = await readFile(blockerResolutionPack.markdownPath, "utf8");
    const rawCsv = await readFile(blockerResolutionPack.csvPath, "utf8");
    assert.ok(rawMarkdown.includes("Clippers Blocker Resolution Pack"));
    assert.ok(rawMarkdown.includes("Unlock phase"));
    assert.ok(rawMarkdown.includes("Proof command"));
    assert.ok(rawMarkdown.includes("Unblock condition"));
    assert.ok(rawMarkdown.includes("Evidence Batch Template"));
    assert.ok(rawMarkdown.includes("Done criteria"));
    assert.ok(rawCsv.includes("unlock_phase"));
    assert.ok(rawCsv.includes("proof_command"));
    assert.ok(rawCsv.includes("execution_mode"));
    assert.ok(rawCsv.includes("portal_url"));
    assert.ok(rawCsv.includes("unblock_condition"));
    assert.equal(rawManifest.includes("access_token"), false);
    assert.equal(rawMarkdown.includes("client_secret"), false);
  } finally {
    if (previousManifest === null) await unlink(beforeStatus.blockerResolutionPack.manifestPath).catch(() => undefined);
    else await writeFile(beforeStatus.blockerResolutionPack.manifestPath, previousManifest);
    if (previousMarkdown === null) await unlink(beforeStatus.blockerResolutionPack.markdownPath).catch(() => undefined);
    else await writeFile(beforeStatus.blockerResolutionPack.markdownPath, previousMarkdown);
    if (previousCsv === null) await unlink(beforeStatus.blockerResolutionPack.csvPath).catch(() => undefined);
    else await writeFile(beforeStatus.blockerResolutionPack.csvPath, previousCsv);
  }
});

test("prepareClipperGoLiveAutopilotBrief writes unified next-action queue", async () => {
  const beforeStatus = await getClipperStatus();
  const previousManifest = await readFile(beforeStatus.goLiveAutopilotBrief.manifestPath, "utf8").catch(() => null);
  const previousMarkdown = await readFile(beforeStatus.goLiveAutopilotBrief.markdownPath, "utf8").catch(() => null);
  const previousCsv = await readFile(beforeStatus.goLiveAutopilotBrief.csvPath, "utf8").catch(() => null);

  try {
    const { goLiveAutopilotBrief, status } = await prepareClipperGoLiveAutopilotBrief();
    assert.ok(goLiveAutopilotBrief.manifestPath.endsWith("go-live-autopilot-brief.json"));
    assert.ok(goLiveAutopilotBrief.markdownPath.endsWith("go-live-autopilot-brief.md"));
    assert.ok(goLiveAutopilotBrief.csvPath.endsWith("go-live-autopilot-brief.csv"));
    assert.ok(goLiveAutopilotBrief.actions.length > 0);
    assert.equal(goLiveAutopilotBrief.actions[0].rank, 1);
    assert.ok(goLiveAutopilotBrief.totals.actions >= goLiveAutopilotBrief.totals.inAppReady);
    assert.ok(goLiveAutopilotBrief.actions.every((action) => action.evidenceTemplate.length > 0));
    assert.ok(goLiveAutopilotBrief.actions.every((action) => action.agentId.length > 0 && action.subAgentName.length > 0));
    assert.ok(goLiveAutopilotBrief.actions.every((action) => action.mission.includes(action.label)));
    assert.ok(goLiveAutopilotBrief.actions.every((action) => action.operatorSteps.length >= 3));
    assert.ok(goLiveAutopilotBrief.actions.every((action) => action.handoffPayload.length >= 5));
    assert.ok(goLiveAutopilotBrief.actions.every((action) => action.evidenceRows.length > 0));
    assert.ok(goLiveAutopilotBrief.actions.every((action) => action.successSignals.length >= 2));
    assert.ok(goLiveAutopilotBrief.actions.every((action) => action.riskControls.length >= 2));
    assert.equal(status.goLiveAutopilotBrief.manifestPath, goLiveAutopilotBrief.manifestPath);

    const rawManifest = await readFile(goLiveAutopilotBrief.manifestPath, "utf8");
    const rawMarkdown = await readFile(goLiveAutopilotBrief.markdownPath, "utf8");
    const rawCsv = await readFile(goLiveAutopilotBrief.csvPath, "utf8");
    assert.ok(rawMarkdown.includes("Clippers Go-Live Autopilot Brief"));
    assert.ok(rawMarkdown.includes("Sub-agent"));
    assert.ok(rawMarkdown.includes("Operator steps"));
    assert.ok(rawMarkdown.includes("Risk controls"));
    assert.ok(rawMarkdown.includes("Evidence template"));
    assert.ok(rawCsv.includes("agent_id"));
    assert.ok(rawCsv.includes("operator_steps"));
    assert.ok(rawCsv.includes("risk_controls"));
    assert.ok(rawCsv.includes("evidence_template"));
    assert.equal(rawManifest.includes("access_token"), false);
    assert.equal(rawMarkdown.includes("client_secret"), false);
  } finally {
    if (previousManifest === null) await unlink(beforeStatus.goLiveAutopilotBrief.manifestPath).catch(() => undefined);
    else await writeFile(beforeStatus.goLiveAutopilotBrief.manifestPath, previousManifest);
    if (previousMarkdown === null) await unlink(beforeStatus.goLiveAutopilotBrief.markdownPath).catch(() => undefined);
    else await writeFile(beforeStatus.goLiveAutopilotBrief.markdownPath, previousMarkdown);
    if (previousCsv === null) await unlink(beforeStatus.goLiveAutopilotBrief.csvPath).catch(() => undefined);
    else await writeFile(beforeStatus.goLiveAutopilotBrief.csvPath, previousCsv);
  }
});

test("runClipperGoLiveAutopilot executes allowlisted in-app actions and writes run summary", async () => {
  const beforeStatus = await getClipperStatus();
  const previousManifest = await readFile(beforeStatus.goLiveAutopilotRun.manifestPath, "utf8").catch(() => null);
  const previousMarkdown = await readFile(beforeStatus.goLiveAutopilotRun.markdownPath, "utf8").catch(() => null);

  try {
    const { goLiveAutopilotRun, status } = await runClipperGoLiveAutopilot({ maxActions: 1 });
    assert.ok(goLiveAutopilotRun.manifestPath.endsWith("go-live-autopilot-run.json"));
    assert.ok(goLiveAutopilotRun.markdownPath.endsWith("go-live-autopilot-run.md"));
    assert.equal(goLiveAutopilotRun.totals.attempted, 1);
    assert.ok(goLiveAutopilotRun.totals.completed + goLiveAutopilotRun.totals.skipped + goLiveAutopilotRun.totals.failed >= 1);
    assert.ok(Array.isArray(goLiveAutopilotRun.completedActionIds));
    assert.equal(status.goLiveAutopilotRun.manifestPath, goLiveAutopilotRun.manifestPath);

    const rawManifest = await readFile(goLiveAutopilotRun.manifestPath, "utf8");
    const rawMarkdown = await readFile(goLiveAutopilotRun.markdownPath, "utf8");
    assert.ok(rawMarkdown.includes("Clippers Go-Live Autopilot Run"));
    assert.equal(rawManifest.includes("access_token"), false);
    assert.equal(rawMarkdown.includes("client_secret"), false);
  } finally {
    if (previousManifest === null) await unlink(beforeStatus.goLiveAutopilotRun.manifestPath).catch(() => undefined);
    else await writeFile(beforeStatus.goLiveAutopilotRun.manifestPath, previousManifest);
    if (previousMarkdown === null) await unlink(beforeStatus.goLiveAutopilotRun.markdownPath).catch(() => undefined);
    else await writeFile(beforeStatus.goLiveAutopilotRun.markdownPath, previousMarkdown);
  }
});

test("runClipperGoLiveAutopilot advances past recently completed actions", async () => {
  const beforeStatus = await getClipperStatus();
  const previousManifest = await readFile(beforeStatus.goLiveAutopilotRun.manifestPath, "utf8").catch(() => null);
  const previousMarkdown = await readFile(beforeStatus.goLiveAutopilotRun.markdownPath, "utf8").catch(() => null);

  try {
    const first = await runClipperGoLiveAutopilot({ maxActions: 1 });
    const second = await runClipperGoLiveAutopilot({ maxActions: 1 });
    const firstCompleted = first.goLiveAutopilotRun.items.find((item) => item.status === "completed");
    const secondCompleted = second.goLiveAutopilotRun.items.find((item) => item.status === "completed");
    if (firstCompleted && secondCompleted) {
      assert.notEqual(firstCompleted.actionId, secondCompleted.actionId);
    }
    assert.ok(second.goLiveAutopilotRun.completedActionIds.length >= first.goLiveAutopilotRun.completedActionIds.length);
  } finally {
    if (previousManifest === null) await unlink(beforeStatus.goLiveAutopilotRun.manifestPath).catch(() => undefined);
    else await writeFile(beforeStatus.goLiveAutopilotRun.manifestPath, previousManifest);
    if (previousMarkdown === null) await unlink(beforeStatus.goLiveAutopilotRun.markdownPath).catch(() => undefined);
    else await writeFile(beforeStatus.goLiveAutopilotRun.markdownPath, previousMarkdown);
  }
});

test("prepareClipperIntakeKit writes safe templates for trends metrics allowlist and sources", async () => {
  const { intakeKit, status } = await prepareClipperIntakeKit();

  assert.equal(intakeKit.status, "prepared");
  assert.ok(intakeKit.readmePath.endsWith("intake-kit/README.md"));
  assert.ok(intakeKit.templateDir.endsWith("intake-kit/templates"));
  assert.ok(intakeKit.files.some((file) => file.id === "trend-opportunities" && file.destinationDir.endsWith("trends")));
  assert.ok(intakeKit.files.some((file) => file.id === "metrics-export" && file.destinationDir.endsWith("metrics")));
  assert.ok(intakeKit.files.every((file) => file.exists));
  assert.ok(status.commandCenter.steps.some((step) => step.id === "intake-kit"));

  const trendTemplate = intakeKit.files.find((file) => file.id === "trend-opportunities");
  assert.ok(trendTemplate);
  const trendTemplateText = await readFile(trendTemplate.path, "utf8");
  assert.ok(trendTemplateText.includes("category,platform,title,url"));

  const metricsTemplate = intakeKit.files.find((file) => file.id === "metrics-export");
  assert.ok(metricsTemplate);
  const metricsTemplateText = await readFile(metricsTemplate.path, "utf8");
  assert.ok(metricsTemplateText.includes("account_id,platform,clip_id,hook"));
});

test("recordClipperSourceIntakeBatch writes source tasks and rights batch rows", async () => {
  await bootstrapClipperWorkspace();
  const { sourceIntakeBatch, status } = await recordClipperSourceIntakeBatch({
    batchText: [
      "category,title,url,source,platform,target_file_name,rights_status,evidence_link,priority,notes",
      "sports,Last second comeback,https://example.com/comeback,@league,tiktok,comeback.mp4,owned_or_permissioned,https://drive.google.com/proof,high,Use fast scoreboard context",
      "memes,Loop format,https://example.com/meme,@creator,instagram,meme-loop.mp4,review_required,,medium,Needs creator approval",
      ",,,,,,,,,",
    ].join("\n"),
  });

  try {
    assert.equal(sourceIntakeBatch.accepted, 2);
    assert.equal(sourceIntakeBatch.skipped, 1);
    assert.equal(sourceIntakeBatch.totals.sports, 1);
    assert.equal(sourceIntakeBatch.totals.memes, 1);
    assert.equal(sourceIntakeBatch.totals.ownedOrPermissioned, 1);
    assert.equal(sourceIntakeBatch.totals.reviewRequired, 1);
    assert.ok(sourceIntakeBatch.items.some((item) => item.sourceRightsBatchRow?.startsWith("source_rights")));
    assert.ok(sourceIntakeBatch.items.every((item) => item.targetSourcePath.includes("clippers_workspace/sources")));
    assert.ok(status.sourceHunt.items.length > 0);

    const rawManifest = await readFile(sourceIntakeBatch.manifestPath, "utf8");
    const rawCsv = await readFile(sourceIntakeBatch.csvPath, "utf8");
    const rawMarkdown = await readFile(sourceIntakeBatch.markdownPath, "utf8");
    assert.ok(rawCsv.includes("source_rights_batch_row"));
    assert.ok(rawMarkdown.includes("Clippers Source Intake Batch"));
    assert.ok(rawManifest.includes("targetSourcePath"));
    for (const forbidden of ["access_token", "client_secret", "plain-refresh-token"]) {
      assert.equal(rawManifest.includes(forbidden), false);
      assert.equal(rawCsv.includes(forbidden), false);
      assert.equal(rawMarkdown.includes(forbidden), false);
    }
  } finally {
    await unlink(sourceIntakeBatch.manifestPath).catch(() => undefined);
    await unlink(sourceIntakeBatch.csvPath).catch(() => undefined);
    await unlink(sourceIntakeBatch.markdownPath).catch(() => undefined);
  }
});

test("importClipperSourceDropFiles copies dropped videos into source folders", async () => {
  const status = await bootstrapClipperWorkspace();
  const sportsFolder = status.sourceFolders.find((folder) => folder.category === "sports");
  assert.ok(sportsFolder);
  const dropDir = path.join(status.rootDir, "source-drop", "sports");
  const dropPath = path.join(dropDir, "drop-highlight.test.mp4");
  const targetPath = path.join(sportsFolder.path, "drop-highlight-test.mp4");
  let queuePath: string | null = null;
  await mkdir(dropDir, { recursive: true });
  await writeFile(dropPath, "fake-video-for-source-drop-test");

  try {
    const { sourceDropImport, status: nextStatus } = await importClipperSourceDropFiles();
    queuePath = sourceDropImport.queue.queuePath;
    assert.equal(sourceDropImport.filesScanned >= 1, true);
    assert.equal(sourceDropImport.imported >= 1, true);
    assert.ok(sourceDropImport.items.some((item) =>
      item.fileName === "drop-highlight-test.mp4" &&
      item.category === "sports" &&
      item.status === "imported" &&
      item.rightsStatus === "review_required"
    ));
    const targetStat = await stat(targetPath);
    assert.equal(targetStat.isFile(), true);
    assert.ok(nextStatus.productionQueue.sourceAssets.some((asset) =>
      asset.fileName === "drop-highlight-test.mp4" &&
      asset.category === "sports" &&
      asset.rightsStatus === "review_required"
    ));
  } finally {
    await unlink(dropPath).catch(() => undefined);
    await unlink(targetPath).catch(() => undefined);
    if (queuePath) await unlink(queuePath).catch(() => undefined);
  }
});

test("prepareClipperProductionQueue scans assets and respects allowlist evidence", async () => {
  const status = await bootstrapClipperWorkspace();
  const sportsFolder = status.sourceFolders.find((folder) => folder.category === "sports");
  const allowlistFolder = status.sourceFolders.find((folder) => folder.category === "allowlist");
  assert.ok(sportsFolder);
  assert.ok(allowlistFolder);

  const sourcePath = `${sportsFolder.path}/sample-highlight.mp4`;
  const evidencePath = `${allowlistFolder.path}/sample-highlight.md`;
  let queuePath: string | null = null;
  await mkdir(sportsFolder.path, { recursive: true });
  await mkdir(allowlistFolder.path, { recursive: true });
  await writeFile(sourcePath, "fake-video-for-queue-test");
  await writeFile(evidencePath, "# Permission\nOwned or explicitly permissioned test footage.");

  try {
    const { queue, status: nextStatus } = await prepareClipperProductionQueue();
    queuePath = queue.queuePath;
    assert.equal(queue.sourceAssets.some((asset) => asset.fileName === "sample-highlight.mp4" && asset.rightsStatus === "owned_or_permissioned"), true);
    assert.ok(queue.items.some((item) => item.category === "sports" && item.status === "draft_ready"));
    assert.equal(queue.items.length, status.accounts.reduce((sum, account) => sum + account.dailyClipTarget, 0));
    assert.ok(queue.items.every((item) => item.slotNumber >= 1));
    assert.ok(queue.items.every((item) => item.variantAngle.length > 0 && item.clipObjective.length > 0));
    assert.equal(nextStatus.productionQueue.queuePath?.endsWith(".json"), true);
  } finally {
    await unlink(sourcePath).catch(() => undefined);
    await unlink(evidencePath).catch(() => undefined);
    if (queuePath) await unlink(queuePath).catch(() => undefined);
  }
});

test("prepareClipperSourceAcquisitionPlan writes daily source gaps by category", async () => {
  const beforeStatus = await bootstrapClipperWorkspace();
  const previousManifest = await readFile(beforeStatus.sourceAcquisition.manifestPath, "utf8").catch(() => null);
  const previousMarkdown = await readFile(beforeStatus.sourceAcquisition.markdownPath, "utf8").catch(() => null);

  try {
    const { sourceAcquisition, status } = await prepareClipperSourceAcquisitionPlan();
    const expectedDailySlots = status.accounts.reduce((sum, account) => sum + account.dailyClipTarget, 0);

    assert.equal(sourceAcquisition.totals.dailySlots, expectedDailySlots);
    assert.equal(sourceAcquisition.totals.targetWeeklyClips, 100);
    assert.equal(sourceAcquisition.totals.configuredWeeklySlots, expectedDailySlots * 7);
    assert.equal(sourceAcquisition.categories.reduce((sum, category) => sum + category.weeklyTargetSlots, 0), 100);
    assert.equal(sourceAcquisition.categories.length, 3);
    assert.ok(sourceAcquisition.categories.some((category) => category.category === "sports" && category.dailySlots >= 10));
    assert.ok(sourceAcquisition.categories.every((category) => category.minimumWeeklySourceAssets >= category.minimumRecommendedAssets));
    assert.ok(sourceAcquisition.categories.every((category) => category.searchBrief.length > 0));
    assert.ok(status.commandCenter.steps.some((step) => step.id === "source-supply" && step.actionUrl === "/api/clippers/prepare-source-acquisition"));

    const manifestStat = await stat(sourceAcquisition.manifestPath);
    const markdownStat = await stat(sourceAcquisition.markdownPath);
    assert.equal(manifestStat.isFile(), true);
    assert.equal(markdownStat.isFile(), true);

    const rawManifest = await readFile(sourceAcquisition.manifestPath, "utf8");
    const rawMarkdown = await readFile(sourceAcquisition.markdownPath, "utf8");
    assert.ok(rawManifest.includes("missingSourceSlots"));
    assert.ok(rawManifest.includes("weeklyMissingSourceSlots"));
    assert.ok(rawMarkdown.includes("Clippers Source Acquisition Plan"));
    assert.ok(rawMarkdown.includes("Weekly target clips"));
    assert.equal(rawManifest.includes("access_token"), false);
    assert.equal(rawMarkdown.includes("client_secret"), false);
  } finally {
    if (previousManifest === null) await unlink(beforeStatus.sourceAcquisition.manifestPath).catch(() => undefined);
    else await writeFile(beforeStatus.sourceAcquisition.manifestPath, previousManifest);
    if (previousMarkdown === null) await unlink(beforeStatus.sourceAcquisition.markdownPath).catch(() => undefined);
    else await writeFile(beforeStatus.sourceAcquisition.markdownPath, previousMarkdown);
  }
});

test("prepareClipperSourceHuntSheet writes 30-slot daily hunt CSV and markdown", async () => {
  const status = await bootstrapClipperWorkspace();
  const huntDate = "2026-06-17";
  let manifestPath = "";
  let csvPath = "";
  let markdownPath = "";

  try {
    const { sourceHunt, status: nextStatus } = await prepareClipperSourceHuntSheet({ huntDate });
    manifestPath = sourceHunt.manifestPath;
    csvPath = sourceHunt.csvPath;
    markdownPath = sourceHunt.markdownPath;
    const expectedDailySlots = status.accounts.reduce((sum, account) => sum + account.dailyClipTarget, 0);

    assert.equal(sourceHunt.huntDate, huntDate);
    assert.equal(sourceHunt.items.length, expectedDailySlots);
    assert.equal(sourceHunt.totals.items, expectedDailySlots);
    assert.ok(sourceHunt.items.every((item) => item.suggestedSearch.length > 0 && item.evidenceNeeded.length > 0));
    assert.ok(sourceHunt.items.every((item) => item.requiredInputs.length > 0 && item.completionHint.length > 0));
    assert.ok(sourceHunt.items.every((item) => item.sourceRightsRecordTemplate.includes("rights_status")));
    assert.equal(nextStatus.sourceHunt.csvPath, csvPath);
    assert.ok(nextStatus.commandCenter.steps.some((step) => step.id === "daily-source-hunt" && step.actionUrl === "/api/clippers/prepare-source-hunt"));

    const rawCsv = await readFile(csvPath, "utf8");
    const rawMarkdown = await readFile(markdownPath, "utf8");
    const rawManifest = await readFile(manifestPath, "utf8");
    assert.ok(rawCsv.includes("hunt_date,status,category"));
    assert.ok(rawMarkdown.includes("Clippers Source Hunt Sheet"));
    assert.ok(rawMarkdown.includes("Required inputs:"));
    assert.ok(rawCsv.includes("completion_hint"));
    assert.ok(rawManifest.includes("needsSource"));
    assert.equal(rawCsv.includes("access_token"), false);
    assert.equal(rawMarkdown.includes("client_secret"), false);
  } finally {
    if (manifestPath) await unlink(manifestPath).catch(() => undefined);
    if (csvPath) await unlink(csvPath).catch(() => undefined);
    if (markdownPath) await unlink(markdownPath).catch(() => undefined);
  }
});

test("prepareClipperViralDiscoveryPack writes daily viral search queue", async () => {
  const previousStatus = await getClipperStatus();
  const previousManifest = await readFile(previousStatus.viralDiscovery.manifestPath, "utf8").catch(() => null);
  const previousMarkdown = await readFile(previousStatus.viralDiscovery.markdownPath, "utf8").catch(() => null);
  const previousCsv = await readFile(previousStatus.viralDiscovery.csvPath, "utf8").catch(() => null);

  try {
    const { viralDiscovery, status } = await prepareClipperViralDiscoveryPack({ discoveryDate: "2026-06-17" });

    assert.equal(viralDiscovery.status, "ready");
    assert.equal(viralDiscovery.discoveryDate, "2026-06-17");
    assert.equal(viralDiscovery.items.length, 27);
    assert.equal(viralDiscovery.totals.mustScan, 9);
    assert.equal(viralDiscovery.totals.watch, 9);
    assert.equal(viralDiscovery.totals.experimental, 9);
    assert.equal(viralDiscovery.sessionOrder.length, viralDiscovery.items.length);
    assert.equal(viralDiscovery.sessionOrder[0].rank, 1);
    assert.ok(viralDiscovery.totals.targetCandidates >= 50);
    assert.ok(viralDiscovery.totals.scanMinutes > 0);
    assert.ok(viralDiscovery.sessionOrder.every((item) => item.targetCandidates >= 1 && item.minimumViews > 0 && item.scanMinutes > 0));
    assert.ok(viralDiscovery.sessionOrder.every((item) => item.captureChecklist.length >= 5));
    assert.ok(viralDiscovery.sessionOrder.every((item) => item.scoreFormula.includes("viral_score")));
    assert.ok(viralDiscovery.items.every((item) => item.searchUrl.startsWith("https://") && item.viralSignals.length >= 3));
    assert.ok(viralDiscovery.items.every((item) => item.trendImportRow.includes("PASTE_TITLE") && item.trendImportRow.includes("review")));
    assert.ok(viralDiscovery.items.some((item) => item.category === "streamers" && item.rightsGate.includes("permission")));
    assert.equal(status.viralDiscovery.csvPath, viralDiscovery.csvPath);

    const rawManifest = await readFile(viralDiscovery.manifestPath, "utf8");
    const rawMarkdown = await readFile(viralDiscovery.markdownPath, "utf8");
    const rawCsv = await readFile(viralDiscovery.csvPath, "utf8");
    assert.ok(rawMarkdown.includes("Clippers Viral Discovery Pack"));
    assert.ok(rawMarkdown.includes("Scan Session"));
    assert.ok(rawMarkdown.includes("Capture checklist"));
    assert.ok(rawCsv.includes("date,priority,category,platform"));
    assert.ok(rawCsv.includes("target_candidates"));
    assert.ok(rawCsv.includes("minimum_views"));
    assert.ok(rawCsv.includes("trend_import_row"));
    assert.ok(rawMarkdown.includes("Trend import row"));
    assert.ok(rawManifest.includes("sessionOrder"));
    assert.ok(rawManifest.includes("must_scan"));
    assert.ok(rawManifest.includes("trendImportRow"));
    assert.equal(rawManifest.includes("access_token"), false);
    assert.equal(rawMarkdown.includes("client_secret"), false);
  } finally {
    if (previousManifest === null) await unlink(previousStatus.viralDiscovery.manifestPath).catch(() => undefined);
    else await writeFile(previousStatus.viralDiscovery.manifestPath, previousManifest);
    if (previousMarkdown === null) await unlink(previousStatus.viralDiscovery.markdownPath).catch(() => undefined);
    else await writeFile(previousStatus.viralDiscovery.markdownPath, previousMarkdown);
    if (previousCsv === null) await unlink(previousStatus.viralDiscovery.csvPath).catch(() => undefined);
    else await writeFile(previousStatus.viralDiscovery.csvPath, previousCsv);
  }
});

test("prepareClipperRightsOutreachPack writes creator permission outreach templates", async () => {
  const beforeStatus = await getClipperStatus();
  const previousManifest = await readFile(beforeStatus.rightsOutreach.manifestPath, "utf8").catch(() => null);
  const previousMarkdown = await readFile(beforeStatus.rightsOutreach.markdownPath, "utf8").catch(() => null);
  const previousTemplates = await readFile(beforeStatus.rightsOutreach.templatesPath, "utf8").catch(() => null);

  try {
    const { rightsOutreach, status } = await prepareClipperRightsOutreachPack();
    assert.equal(rightsOutreach.templates.length, 3);
    assert.ok(rightsOutreach.templates.every((template) => template.message.includes("allowlist")));
    assert.ok(rightsOutreach.items.every((item) => item.outreachMessage.length > 0 && item.permissionRecordTemplate.includes("rights_status")));
    assert.ok(rightsOutreach.items.every((item) => item.requiredInputs.length > 0 && item.completionHint.length > 0));
    assert.ok(status.commandCenter.steps.some((step) => step.id === "rights-outreach" && step.actionUrl === "/api/clippers/prepare-rights-outreach"));

    const rawManifest = await readFile(rightsOutreach.manifestPath, "utf8");
    const rawMarkdown = await readFile(rightsOutreach.markdownPath, "utf8");
    const rawTemplates = await readFile(rightsOutreach.templatesPath, "utf8");
    assert.ok(rawMarkdown.includes("Clippers Creator Rights Outreach Pack"));
    assert.ok(rawMarkdown.includes("Completion hint:"));
    assert.ok(rawTemplates.includes("Clippers Rights Outreach Templates"));
    assert.ok(rawManifest.includes("permissionRecordTemplate"));
    assert.equal(rawManifest.includes("access_token"), false);
    assert.equal(rawMarkdown.includes("client_secret"), false);
  } finally {
    if (previousManifest === null) await unlink(beforeStatus.rightsOutreach.manifestPath).catch(() => undefined);
    else await writeFile(beforeStatus.rightsOutreach.manifestPath, previousManifest);
    if (previousMarkdown === null) await unlink(beforeStatus.rightsOutreach.markdownPath).catch(() => undefined);
    else await writeFile(beforeStatus.rightsOutreach.markdownPath, previousMarkdown);
    if (previousTemplates === null) await unlink(beforeStatus.rightsOutreach.templatesPath).catch(() => undefined);
    else await writeFile(beforeStatus.rightsOutreach.templatesPath, previousTemplates);
  }
});

test("recordClipperSourceRights writes allowlist evidence and unlocks source asset", async () => {
  const status = await bootstrapClipperWorkspace();
  const memeFolder = status.sourceFolders.find((folder) => folder.category === "memes");
  const allowlistFolder = status.sourceFolders.find((folder) => folder.category === "allowlist");
  assert.ok(memeFolder);
  assert.ok(allowlistFolder);

  const sourcePath = `${memeFolder.path}/permissioned-meme.mp4`;
  const evidencePath = `${allowlistFolder.path}/permissioned-meme.md`;
  let initialQueuePath: string | null = null;
  let queuePath: string | null = null;
  await mkdir(memeFolder.path, { recursive: true });
  await writeFile(sourcePath, "fake-video-for-rights-test");

  try {
    const initialQueue = await prepareClipperProductionQueue();
    initialQueuePath = initialQueue.queue.queuePath;
    const asset = initialQueue.queue.sourceAssets.find((item) => item.fileName === "permissioned-meme.mp4");
    assert.ok(asset);
    assert.equal(asset.rightsStatus, "review_required");

    const { sourceRights, queue, status: nextStatus } = await recordClipperSourceRights({
      assetId: asset.id,
      rightsStatus: "owned_or_permissioned",
      notes: "Creator permission confirmed for test; no tokens or secrets.",
    });
    queuePath = queue.queuePath;

    assert.equal(sourceRights.fileName, "permissioned-meme.mp4");
    assert.equal(sourceRights.rightsStatus, "owned_or_permissioned");
    assert.equal(sourceRights.evidencePath, evidencePath);
    assert.ok(queue.sourceAssets.some((item) => item.fileName === "permissioned-meme.mp4" && item.rightsStatus === "owned_or_permissioned"));
    assert.ok(nextStatus.productionQueue.sourceAssets.some((item) => item.fileName === "permissioned-meme.mp4" && item.evidencePath === evidencePath));

    const raw = await readFile(evidencePath, "utf8");
    assert.ok(raw.includes("permissioned-meme.mp4"));
    assert.equal(raw.includes("access_token"), false);
    assert.equal(raw.includes("client_secret"), false);
  } finally {
    await unlink(sourcePath).catch(() => undefined);
    await unlink(evidencePath).catch(() => undefined);
    if (initialQueuePath) await unlink(initialQueuePath).catch(() => undefined);
    if (queuePath) await unlink(queuePath).catch(() => undefined);
  }
});

test("prepareClipperDraftSpecs writes editable draft specs for rights-cleared queue items", async () => {
  const status = await bootstrapClipperWorkspace();
  const sportsFolder = status.sourceFolders.find((folder) => folder.category === "sports");
  const allowlistFolder = status.sourceFolders.find((folder) => folder.category === "allowlist");
  assert.ok(sportsFolder);
  assert.ok(allowlistFolder);

  const sourcePath = `${sportsFolder.path}/draft-ready-highlight.mp4`;
  const evidencePath = `${allowlistFolder.path}/draft-ready-highlight.md`;
  const previousManifest = await readFile(status.draftSpecs.manifestPath, "utf8").catch(() => null);
  let queuePath: string | null = null;
  let manifestPath: string | null = null;
  const createdDraftPaths: string[] = [];
  await mkdir(sportsFolder.path, { recursive: true });
  await mkdir(allowlistFolder.path, { recursive: true });
  await writeFile(sourcePath, "fake-video-for-draft-spec-test");
  await writeFile(evidencePath, "# Permission\nOwned or permissioned source for draft specs.");

  try {
    const { draftSpecs, status: nextStatus } = await prepareClipperDraftSpecs();
    manifestPath = draftSpecs.manifestPath;
    queuePath = nextStatus.productionQueue.queuePath;
    createdDraftPaths.push(...draftSpecs.items.flatMap((item) => [item.draftPath, item.markdownPath]));

    assert.equal(draftSpecs.status, "ready");
    assert.ok(draftSpecs.items.length >= 10);
    assert.ok(draftSpecs.items.some((item) => item.sourcePath === sourcePath && item.evidencePath === evidencePath));
    assert.ok(draftSpecs.items.every((item) => item.slotNumber >= 1 && item.variantAngle && item.clipObjective));
    assert.equal(nextStatus.draftSpecs.totals.readyForEdit, draftSpecs.totals.readyForEdit);

    const first = draftSpecs.items.find((item) => item.sourcePath === sourcePath);
    assert.ok(first);
    const rawJson = await readFile(first.draftPath, "utf8");
    const rawMarkdown = await readFile(first.markdownPath, "utf8");
    assert.ok(rawJson.includes("ready_for_edit"));
    assert.ok(rawJson.includes("clipObjective"));
    assert.ok(rawMarkdown.includes("QA Checklist"));
    assert.ok(rawMarkdown.includes("Variant angle"));
    assert.equal(rawJson.includes("access_token"), false);
    assert.equal(rawMarkdown.includes("client_secret"), false);
  } finally {
    await unlink(sourcePath).catch(() => undefined);
    await unlink(evidencePath).catch(() => undefined);
    for (const draftPath of createdDraftPaths) {
      await unlink(draftPath).catch(() => undefined);
    }
    if (queuePath) await unlink(queuePath).catch(() => undefined);
    if (manifestPath && previousManifest === null) await unlink(manifestPath).catch(() => undefined);
    if (manifestPath && previousManifest !== null) await writeFile(manifestPath, previousManifest);
  }
});

test("renderClipperDraftVideos renders mp4 clips from rights-cleared draft specs", async () => {
  const status = await bootstrapClipperWorkspace();
  const sportsFolder = status.sourceFolders.find((folder) => folder.category === "sports");
  const allowlistFolder = status.sourceFolders.find((folder) => folder.category === "allowlist");
  assert.ok(sportsFolder);
  assert.ok(allowlistFolder);

  const sourcePath = `${sportsFolder.path}/render-ready-highlight.mp4`;
  const evidencePath = `${allowlistFolder.path}/render-ready-highlight.md`;
  await mkdir(sportsFolder.path, { recursive: true });
  await mkdir(allowlistFolder.path, { recursive: true });
  writeTinyTestVideo(sourcePath);
  await writeFile(evidencePath, "# Permission\nOwned or permissioned source for render test.");
  const previousAccountPath = `${status.accountEvidence.evidenceDir}/sports-daily-tiktok.json`;
  const previousAccount = await readFile(previousAccountPath, "utf8").catch(() => null);

  try {
    await recordClipperAccountEvidence({
      accountId: "sports-daily",
      platform: "tiktok",
      status: "verified",
      notes: "TikTok account @sportsdailyclips verified for publishing package test; 2FA and profile proof stored.",
    });
    const { renderedClips } = await renderClipperDraftVideos({ maxClips: 1, durationSeconds: 3 });

    assert.equal(renderedClips.totals.attempted, 1);
    assert.equal(renderedClips.totals.rendered, 1);
    assert.equal(renderedClips.status, "ready");
    assert.ok(renderedClips.items[0].outputPath.endsWith(".mp4"));
    const outputStat = await stat(renderedClips.items[0].outputPath);
    assert.equal(outputStat.isFile(), true);
    assert.ok(outputStat.size > 1000);

    const rawManifest = await readFile(renderedClips.manifestPath, "utf8");
    assert.ok(rawManifest.includes("render-ready-highlight.mp4"));
    assert.equal(rawManifest.includes("access_token"), false);

    const { publishingPackage } = await prepareClipperPublishingPackage();
    assert.ok(publishingPackage.items.length >= 1);
    assert.ok(publishingPackage.totals.readyForManual >= 1);
    assert.ok(publishingPackage.items.some((item) => item.platform === "tiktok" && item.status === "ready_for_manual"));
    const rawPublishingCsv = await readFile(publishingPackage.csvPath, "utf8");
    const rawPublishingMarkdown = await readFile(publishingPackage.markdownPath, "utf8");
    assert.ok(rawPublishingCsv.includes("video_path"));
    assert.ok(rawPublishingMarkdown.includes("Clippers Publishing Package"));
    assert.equal(rawPublishingCsv.includes("client_secret"), false);
  } finally {
    await unlink(sourcePath).catch(() => undefined);
    await unlink(evidencePath).catch(() => undefined);
    if (previousAccount === null) await unlink(previousAccountPath).catch(() => undefined);
    else await writeFile(previousAccountPath, previousAccount);
    await unlink(`${status.rootDir}/scheduled/publishing-package.json`).catch(() => undefined);
    await unlink(`${status.rootDir}/scheduled/publishing-package.md`).catch(() => undefined);
    await unlink(`${status.rootDir}/scheduled/publishing-package.csv`).catch(() => undefined);
    const latestManifest = await readFile(`${status.rootDir}/rendered/rendered-clips-latest.json`, "utf8").catch(() => null);
    if (latestManifest) {
      const parsed = JSON.parse(latestManifest) as { items?: Array<{ outputPath?: string }> };
      for (const item of parsed.items || []) {
        if (item.outputPath) await unlink(item.outputPath).catch(() => undefined);
      }
      await unlink(`${status.rootDir}/rendered/rendered-clips-latest.json`).catch(() => undefined);
    }
  }
});

test("prepareClipperManualPostingPack writes CSV and command center step", async () => {
  const status = await bootstrapClipperWorkspace();
  const sportsFolder = status.sourceFolders.find((folder) => folder.category === "sports");
  const allowlistFolder = status.sourceFolders.find((folder) => folder.category === "allowlist");
  assert.ok(sportsFolder);
  assert.ok(allowlistFolder);

  const sourcePath = `${sportsFolder.path}/manual-ready-highlight.mp4`;
  const evidencePath = `${allowlistFolder.path}/manual-ready-highlight.md`;
  await mkdir(sportsFolder.path, { recursive: true });
  await mkdir(allowlistFolder.path, { recursive: true });
  await writeFile(sourcePath, "fake-video-for-manual-posting-pack-test");
  await writeFile(evidencePath, "# Permission\nOwned or permissioned source for manual posting.");

  try {
    const { manualPostingPack, status: nextStatus } = await prepareClipperManualPostingPack();

    assert.equal(manualPostingPack.manifestPath.endsWith("manual-posting-pack.json"), true);
    assert.equal(manualPostingPack.csvPath.endsWith("manual-posting-pack.csv"), true);
    assert.ok(manualPostingPack.items.some((item) => item.sourcePath === sourcePath));
    assert.ok(manualPostingPack.items.every((item) => item.caption.length > 0 && item.checklist.length >= 3));
    assert.equal(manualPostingPack.weeklyRunway.targetWeeklyPosts, 100);
    assert.ok(manualPostingPack.weeklyRunway.recommendedDailyReadyPosts >= 14);
    assert.ok(manualPostingPack.weeklyRunway.gapToTarget >= 0);
    assert.ok(manualPostingPack.unblockSession.every((item) => item.requiredEvidence.length >= 3 && item.doneCriteria.length >= 3));
    assert.ok(manualPostingPack.unblockSession.some((item) => item.sourceFolder.includes("clippers_workspace")));
    assert.ok(nextStatus.commandCenter.steps.some((step) => step.id === "manual-posting-pack"));
    assert.ok(nextStatus.growthAudit.items.some((item) => item.id === "manual-posting-pack"));

    const rawCsv = await readFile(manualPostingPack.csvPath, "utf8");
    const rawMarkdown = await readFile(manualPostingPack.markdownPath, "utf8");
    assert.ok(rawCsv.includes("account_id"));
    assert.ok(rawCsv.includes("source_folder"));
    assert.ok(rawMarkdown.includes("Weekly Runway"));
    assert.ok(rawMarkdown.includes("Unblock Session"));
    assert.ok(rawMarkdown.includes("Done criteria"));
    assert.ok(rawMarkdown.includes("Manual Posting Pack"));
    assert.equal(rawCsv.includes("access_token"), false);
    assert.equal(rawMarkdown.includes("client_secret"), false);
  } finally {
    await unlink(sourcePath).catch(() => undefined);
    await unlink(evidencePath).catch(() => undefined);
  }
});

test("runClipperAutomationCycle writes schedule and reports blockers", async () => {
  const userId = "clipper-owner-a";
  const { automation, status } = await runClipperAutomationCycle({
    publishMode: "approval_required",
    clipsPerAccount: 2,
  }, userId);

  try {
    assert.equal(automation.schedulePath.endsWith(".json"), true);
    assert.equal(automation.reportPath.endsWith(".json"), true);
    assert.ok(automation.totals.posts >= status.accounts.length);
    assert.ok(automation.totals.blocked >= status.accounts.length);
    assert.ok(automation.blockers.length > 0);

    const scheduleStat = await stat(automation.schedulePath);
    const reportStat = await stat(automation.reportPath);
    assert.equal(scheduleStat.isFile(), true);
    assert.equal(reportStat.isFile(), true);
    const rawReport = JSON.parse(await readFile(automation.reportPath, "utf8")) as { userId?: string };
    assert.equal(rawReport.userId, userId);
  } finally {
    await unlink(automation.schedulePath).catch(() => undefined);
    await unlink(automation.reportPath).catch(() => undefined);
    await unlink(automation.queuePath).catch(() => undefined);
  }
});

test("prepareClipperAutomationSchedule writes daily runbook manifest", async () => {
  const { automationSchedule, status } = await prepareClipperAutomationSchedule({
    clipsPerAccount: 5,
    publishMode: "approval_required",
    riskTolerance: "growth",
    dailyRunTime: "08:30",
    weeklyTargetClips: 100,
  });

  try {
    assert.equal(automationSchedule.status, "prepared");
    assert.equal(automationSchedule.weeklyTargetClips, 100);
    assert.ok(automationSchedule.runbook.some((step) => step.includes("Trend Radar")));
    const scheduleStat = await stat(automationSchedule.manifestPath);
    assert.equal(scheduleStat.isFile(), true);
    assert.ok(status.growthAudit.items.some((item) => item.id === "daily-automation" && item.status !== "critical"));
  } finally {
    await unlink(automationSchedule.manifestPath).catch(() => undefined);
  }
});

test("ingestClipperMetrics imports CSV exports and updates optimizer summary", async () => {
  const status = await bootstrapClipperWorkspace();
  const metricsFolder = status.sourceFolders.find((folder) => folder.category === "metrics");
  assert.ok(metricsFolder);
  await mkdir(metricsFolder.path, { recursive: true });
  const metricsPath = `${metricsFolder.path}/sample-metrics.csv`;
  const summaryPath = `${metricsFolder.path}/metrics-summary.json`;
  await writeFile(metricsPath, [
    "account_id,platform,clip_id,hook,views,likes,comments,shares,saves,retention",
    "sports-daily,tiktok,clip-1,La jugada que cambio todo,1250000,54000,2100,8400,3200,71%",
    "meme-radar,instagram,clip-2,POV internet hoy,220000,12000,900,2600,1100,48%",
  ].join("\n"));

  try {
    const { metrics, status: nextStatus } = await ingestClipperMetrics();
    assert.equal(metrics.status, "ready");
    assert.equal(metrics.records.length >= 2, true);
    assert.equal(metrics.totals.views >= 1_470_000, true);
    assert.ok(metrics.accountPerformance.some((account) => account.accountId === "sports-daily" && account.status === "scaling"));
    assert.ok(metrics.recommendations.some((recommendation) => recommendation.includes("Duplicar formato ganador")));
    assert.ok(nextStatus.growthAudit.items.some((item) => item.id === "metrics-loop" && item.status === "ready"));
  } finally {
    await unlink(metricsPath).catch(() => undefined);
    await unlink(summaryPath).catch(() => undefined);
  }
});

test("ingestClipperTrends ranks recent opportunities and gates rights", async () => {
  const status = await bootstrapClipperWorkspace();
  const trendsFolder = status.sourceFolders.find((folder) => folder.category === "trends");
  const allowlistFolder = status.sourceFolders.find((folder) => folder.category === "allowlist");
  assert.ok(trendsFolder);
  assert.ok(allowlistFolder);
  await mkdir(trendsFolder.path, { recursive: true });
  await mkdir(allowlistFolder.path, { recursive: true });
  const trendsPath = `${trendsFolder.path}/sample-trends.csv`;
  const evidencePath = `${allowlistFolder.path}/https-example-com-sports-clip-1.md`;
  await writeFile(evidencePath, "# Permission\nApproved source for test trend.");
  await writeFile(trendsPath, [
    "category,platform,title,url,source,posted_at,views,likes,comments,shares,rights",
    "sports,tiktok,Game winner angle,https://example.com/sports-clip-1,@league,2026-06-17T01:00:00Z,900000,42000,1800,12000,approved",
    "memes,instagram,New meme format,https://example.com/meme-clip-2,@creator,2026-06-10T01:00:00Z,300000,10000,500,800,review",
  ].join("\n"));

  try {
    const { trendRadar, status: nextStatus } = await ingestClipperTrends();
    assert.equal(trendRadar.status, "ready");
    assert.equal(trendRadar.candidates.length >= 2, true);
    assert.equal(trendRadar.topCandidates[0].rightsStatus, "owned_or_permissioned");
    assert.ok(trendRadar.recommendations.some((recommendation) => recommendation.includes("Prioridad")));
    assert.ok(nextStatus.growthAudit.items.some((item) => item.id === "trend-radar" && item.status === "ready"));
  } finally {
    await unlink(trendsPath).catch(() => undefined);
    await unlink(evidencePath).catch(() => undefined);
    await unlink(`${trendsFolder.path}/trend-radar-summary.json`).catch(() => undefined);
  }
});

test("recordClipperTrendCandidatesBatch imports candidates and refreshes radar", async () => {
  const status = await bootstrapClipperWorkspace();
  const trendsFolder = status.sourceFolders.find((folder) => folder.category === "trends");
  assert.ok(trendsFolder);
  const previousSummary = await readFile(status.trendRadar.summaryPath, "utf8").catch(() => null);
  let importedPath = "";

  try {
    const { trendCandidatesBatch, status: nextStatus } = await recordClipperTrendCandidatesBatch({
      batchText: [
        "category,platform,title,url,source,posted_at,views,likes,comments,shares,rights,angle",
        "sports,tiktok,Last second comeback,https://example.com/comeback,@team,2026-06-17T09:00:00Z,1500000,80000,5000,22000,approved,Use scoreboard tension",
        "memes,instagram,POV everyone today,https://example.com/meme,@creator,2026-06-17T08:30:00Z,350000,20000,1200,9000,review,Fast relatable hook",
        ",,,,,,,,,,,",
      ].join("\n"),
    });
    importedPath = trendCandidatesBatch.filePath;

    assert.equal(trendCandidatesBatch.accepted, 2);
    assert.equal(trendCandidatesBatch.skipped, 1);
    assert.equal(trendCandidatesBatch.trendRadar.status, "ready");
    assert.ok(trendCandidatesBatch.trendRadar.candidates.some((candidate) => candidate.title === "Last second comeback"));
    assert.ok(nextStatus.trendRadar.topCandidates.some((candidate) => candidate.url === "https://example.com/comeback"));

    const rawImport = await readFile(importedPath, "utf8");
    const rawSummary = await readFile(nextStatus.trendRadar.summaryPath, "utf8");
    assert.ok(rawImport.includes("Last second comeback"));
    assert.equal(rawImport.includes("access_token"), false);
    assert.equal(rawSummary.includes("client_secret"), false);
  } finally {
    if (importedPath) await unlink(importedPath).catch(() => undefined);
    if (previousSummary === null) await unlink(status.trendRadar.summaryPath).catch(() => undefined);
    else await writeFile(status.trendRadar.summaryPath, previousSummary);
  }
});

test("prepareClipperTrendRightsOutreachPack writes outreach for review-required trends", async () => {
  const status = await bootstrapClipperWorkspace();
  const previousSummary = await readFile(status.trendRadar.summaryPath, "utf8").catch(() => null);
  const previousPack = await readFile(status.trendRightsOutreach.manifestPath, "utf8").catch(() => null);
  const previousMarkdown = await readFile(status.trendRightsOutreach.markdownPath, "utf8").catch(() => null);
  const previousCsv = await readFile(status.trendRightsOutreach.csvPath, "utf8").catch(() => null);
  let importedPath = "";

  try {
    const { trendCandidatesBatch } = await recordClipperTrendCandidatesBatch({
      batchText: [
        "category,platform,title,url,source,posted_at,views,likes,comments,shares,rights,angle",
        "streamers,tiktok,Streamer rage moment,https://example.com/streamer-rage,@streamer,2026-06-17T09:00:00Z,700000,30000,4000,13000,review,Clip the reaction buildup",
        "sports,youtube,Official team highlight,https://example.com/team-highlight,@team,2026-06-17T08:00:00Z,900000,50000,3000,9000,approved,Official source recap",
      ].join("\n"),
    });
    importedPath = trendCandidatesBatch.filePath;

    const { trendRightsOutreach, status: nextStatus } = await prepareClipperTrendRightsOutreachPack();
    assert.equal(trendRightsOutreach.status, "partial");
    assert.equal(trendRightsOutreach.totals.reviewRequired >= 1, true);
    assert.ok(trendRightsOutreach.items.some((item) => item.title === "Streamer rage moment" && item.outreachMessage.includes("permission")));
    assert.ok(nextStatus.commandCenter.steps.some((step) => step.id === "trend-rights-outreach"));

    const rawManifest = await readFile(trendRightsOutreach.manifestPath, "utf8");
    const rawMarkdown = await readFile(trendRightsOutreach.markdownPath, "utf8");
    const rawCsv = await readFile(trendRightsOutreach.csvPath, "utf8");
    assert.ok(rawMarkdown.includes("Clippers Trend Rights Outreach Pack"));
    assert.ok(rawMarkdown.includes("Permission record template"));
    assert.ok(rawCsv.includes("evidence_file"));
    assert.ok(rawCsv.includes("permission_record_template"));
    assert.ok(rawManifest.includes("permissionRecordTemplate"));
    assert.equal(rawManifest.includes("access_token"), false);
    assert.equal(rawMarkdown.includes("client_secret"), false);
  } finally {
    if (importedPath) await unlink(importedPath).catch(() => undefined);
    if (previousSummary === null) await unlink(status.trendRadar.summaryPath).catch(() => undefined);
    else await writeFile(status.trendRadar.summaryPath, previousSummary);
    if (previousPack === null) await unlink(status.trendRightsOutreach.manifestPath).catch(() => undefined);
    else await writeFile(status.trendRightsOutreach.manifestPath, previousPack);
    if (previousMarkdown === null) await unlink(status.trendRightsOutreach.markdownPath).catch(() => undefined);
    else await writeFile(status.trendRightsOutreach.markdownPath, previousMarkdown);
    if (previousCsv === null) await unlink(status.trendRightsOutreach.csvPath).catch(() => undefined);
    else await writeFile(status.trendRightsOutreach.csvPath, previousCsv);
  }
});

test("buildClipperConnectActions blocks missing OAuth credentials", () => {
  const originalTikTokKey = process.env.TIKTOK_CLIENT_KEY;
  const googleSnapshot = snapshotEnv(GOOGLE_OAUTH_ALIAS_ENV_VARS);
  delete process.env.TIKTOK_CLIENT_KEY;
  clearEnv(GOOGLE_OAUTH_ALIAS_ENV_VARS);

  try {
    const actions = buildClipperConnectActions();
    assert.equal(actions.find((action) => action.platform === "tiktok")?.status, "blocked");
    assert.equal(actions.find((action) => action.platform === "youtube")?.authUrl, null);
  } finally {
    if (originalTikTokKey) process.env.TIKTOK_CLIENT_KEY = originalTikTokKey;
    else delete process.env.TIKTOK_CLIENT_KEY;
    restoreEnv(googleSnapshot);
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

test("buildTokenExchangeRequest targets official token endpoints", () => {
  const originalTikTokKey = process.env.TIKTOK_CLIENT_KEY;
  const originalTikTokSecret = process.env.TIKTOK_CLIENT_SECRET;
  const originalGoogleClientId = process.env.GOOGLE_CLIENT_ID;
  const originalGoogleClientSecret = process.env.GOOGLE_CLIENT_SECRET;
  process.env.TIKTOK_CLIENT_KEY = "test-client-key";
  process.env.TIKTOK_CLIENT_SECRET = "test-client-secret";
  process.env.GOOGLE_CLIENT_ID = "google-client-id";
  process.env.GOOGLE_CLIENT_SECRET = "google-client-secret";

  try {
    const tiktok = __clipperInternals.buildTokenExchangeRequest("tiktok", "auth-code");
    assert.equal(tiktok.url, "https://open.tiktokapis.com/v2/oauth/token/");
    assert.equal(tiktok.method, "POST");
    assert.ok(tiktok.body?.includes("grant_type=authorization_code"));
    assert.ok(tiktok.body?.includes("client_key=test-client-key"));

    const youtube = __clipperInternals.buildTokenExchangeRequest("youtube", "auth-code");
    assert.equal(youtube.url, "https://oauth2.googleapis.com/token");
    assert.equal(youtube.method, "POST");
    assert.ok(youtube.body?.includes("client_id=google-client-id"));
  } finally {
    if (originalTikTokKey) process.env.TIKTOK_CLIENT_KEY = originalTikTokKey;
    else delete process.env.TIKTOK_CLIENT_KEY;
    if (originalTikTokSecret) process.env.TIKTOK_CLIENT_SECRET = originalTikTokSecret;
    else delete process.env.TIKTOK_CLIENT_SECRET;
    if (originalGoogleClientId) process.env.GOOGLE_CLIENT_ID = originalGoogleClientId;
    else delete process.env.GOOGLE_CLIENT_ID;
    if (originalGoogleClientSecret) process.env.GOOGLE_CLIENT_SECRET = originalGoogleClientSecret;
    else delete process.env.GOOGLE_CLIENT_SECRET;
  }
});

test("saveClipperTokenPayload encrypts token payloads before writing the vault", async () => {
  const originalKey = process.env.CLIPPERS_TOKEN_ENCRYPTION_KEY;
  const beforeStatus = await getClipperStatus();
  const vaultPath = beforeStatus.tokenVault.vaultPath;
  const originalVault = await readFile(vaultPath, "utf8").catch(() => null);
  process.env.CLIPPERS_TOKEN_ENCRYPTION_KEY = "test-encryption-key-with-more-than-32-chars";

  try {
    const summary = await saveClipperTokenPayload("youtube", {
      access_token: "plain-access-token",
      refresh_token: "plain-refresh-token",
      token_type: "Bearer",
      scope: "https://www.googleapis.com/auth/youtube.upload",
      expires_in: 3600,
      sub: "youtube-subject",
    });
    assert.equal(summary.platform, "youtube");
    assert.equal(summary.tokenType, "Bearer");

    const status = await getClipperStatus();
    const rawVault = await readFile(status.tokenVault.vaultPath, "utf8");
    assert.equal(rawVault.includes("plain-access-token"), false);
    assert.equal(rawVault.includes("plain-refresh-token"), false);
    assert.ok(status.tokenVault.records.some((record) => record.platform === "youtube" && record.status === "saved"));
  } finally {
    if (originalKey) process.env.CLIPPERS_TOKEN_ENCRYPTION_KEY = originalKey;
    else delete process.env.CLIPPERS_TOKEN_ENCRYPTION_KEY;
    if (originalVault !== null) await writeFile(vaultPath, originalVault);
    else await unlink(vaultPath).catch(() => undefined);
  }
});
