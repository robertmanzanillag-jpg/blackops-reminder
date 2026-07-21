import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, readdir, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import nodeTest, { after } from "node:test";
import path from "node:path";

let runningTestChain = Promise.resolve();
function test(name, fn) {
  nodeTest(name, async (t) => {
    const previous = runningTestChain.catch(() => {});
    let release = () => {};
    runningTestChain = new Promise((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      await resetTestWorkspace();
      return await fn(t);
    } finally {
      await resetTestWorkspace().catch(() => {});
      release();
    }
  });
}

const scriptPath = path.join(process.cwd(), "script/clippers-local-operator-server.mjs");
const liveWorkspaceRoot = path.join(process.cwd(), "clippers_workspace");
const testWorkspaceParent = await mkdtemp(path.join(tmpdir(), "clippers-operator-test-"));
const workspaceRoot = path.join(testWorkspaceParent, "clippers_workspace");
async function copyWorkspaceFile(relativePath) {
  const source = path.join(liveWorkspaceRoot, relativePath);
  const destination = path.join(workspaceRoot, relativePath);
  const sourceStat = await stat(source);
  if (sourceStat.isDirectory()) {
    await mkdir(destination, { recursive: true });
    for (const entry of await readdir(source, { withFileTypes: true })) {
      await copyWorkspaceFile(path.join(relativePath, entry.name));
    }
    return;
  }
  await mkdir(path.dirname(destination), { recursive: true });
  await writeFile(destination, await readFile(source));
}
for (const fixturePath of [
  "reports/clippers-tiktok-next-action.json",
  "reports/clippers-metricool-current-batch-session-packet.json",
  "reports/clippers-metricool-current-batch-session-packet.md",
  "reports/clippers-metricool-current-batch-upload-pack.json",
  "reports/clippers-tiktok-operator-cockpit-preflight.json",
  "reports/clippers-goal-completion-audit.json",
  "reports/clippers-tiktok-evidence-checklist.json",
  "reports/clippers-tiktok-batch-tracker.json",
  "reports/clippers-tiktok-external-closeout-session.json",
  "reports/clippers-tiktok-external-closeout-session.md",
  "reports/clippers-external-closeout-evidence-import-report.json",
  "reports/clippers-external-closeout-evidence-import-report.md",
  "reports/clippers-external-closeout-repair-work-packet.md",
  "reports/clippers-external-closeout-repair-row-templates.csv",
  "scheduled/metricool-100-approval-run.json",
  "scheduled/metricool-100-operator-run-sheet.csv",
  "scheduled/metricool-100-operator-handoff.json",
  "scheduled/metricool-current-batch-upload-pack",
  "scheduled/metricool-100-batch-evidence-imports/metricool-batch-01-evidence-import.csv",
  "scheduled/metricool-100-current-batch-workbook.json",
  "scheduled/metricool-100-current-batch-workbook.csv",
  "evidence-drop/metricool-100-approval-evidence-import.csv",
  "evidence-drop/external-closeout-evidence-import.csv",
  "evidence-drop/external-closeout-proofs/account-streamer-pulse-tiktok.md",
  "account-permission-readiness.json",
  "account-permission-readiness.md",
  "account-permission-next-evidence.csv",
]) {
  await copyWorkspaceFile(fixturePath);
}
for (const fixturePath of [
  "reports/clippers-tiktok-next-action.json",
  "reports/clippers-metricool-current-batch-session-packet.json",
  "reports/clippers-metricool-current-batch-session-packet.md",
  "reports/clippers-metricool-current-batch-upload-pack.json",
  "reports/clippers-tiktok-operator-cockpit-preflight.json",
  "reports/clippers-goal-completion-audit.json",
  "reports/clippers-tiktok-evidence-checklist.json",
  "reports/clippers-tiktok-batch-tracker.json",
  "reports/clippers-tiktok-external-closeout-session.json",
  "reports/clippers-tiktok-external-closeout-session.md",
  "reports/clippers-external-closeout-evidence-import-report.json",
  "reports/clippers-external-closeout-evidence-import-report.md",
  "reports/clippers-external-closeout-repair-work-packet.md",
  "reports/clippers-external-closeout-repair-row-templates.csv",
  "scheduled/metricool-100-approval-run.json",
  "scheduled/metricool-100-operator-run-sheet.csv",
  "scheduled/metricool-100-operator-handoff.json",
  "scheduled/metricool-100-current-batch-workbook.json",
  "account-permission-readiness.json",
  "account-permission-readiness.md",
  "account-permission-next-evidence.csv",
  "evidence-drop/external-closeout-evidence-import.csv",
  "evidence-drop/external-closeout-proofs/account-streamer-pulse-tiktok.md",
]) {
  const filePath = path.join(workspaceRoot, fixturePath);
  const rewritten = (await readFile(filePath, "utf8")).split(liveWorkspaceRoot).join(workspaceRoot);
  await writeFile(filePath, rewritten);
}
after(async () => {
  await rm(testWorkspaceParent, { recursive: true, force: true });
});
const reportsDir = path.join(workspaceRoot, "reports");
const batchEvidenceCsvPath = path.join(workspaceRoot, "scheduled", "metricool-100-batch-evidence-imports", "metricool-batch-01-evidence-import.csv");
const masterEvidenceCsvPath = path.join(workspaceRoot, "evidence-drop", "metricool-100-approval-evidence-import.csv");
const externalEvidenceCsvPath = path.join(workspaceRoot, "account-permission-next-evidence.csv");
const externalCloseoutEvidenceCsvPath = path.join(workspaceRoot, "evidence-drop", "external-closeout-evidence-import.csv");
const nextExternalProofPath = path.join(workspaceRoot, "evidence-drop", "external-closeout-proofs", "account-streamer-pulse-tiktok.md");
const accountReadinessJsonPath = path.join(workspaceRoot, "account-permission-readiness.json");
const sessionPacketJsonPath = path.join(reportsDir, "clippers-metricool-current-batch-session-packet.json");
const uploadPackReportJsonPath = path.join(reportsDir, "clippers-metricool-current-batch-upload-pack.json");
const currentBatchWorkbookJsonPath = path.join(workspaceRoot, "scheduled", "metricool-100-current-batch-workbook.json");
const operatorAuditLogPath = path.join(reportsDir, "clippers-local-operator-audit.jsonl");
const tiktokExternalCloseoutJsonPath = path.join(reportsDir, "clippers-tiktok-external-closeout-session.json");
const evidenceChecklistJsonPath = path.join(reportsDir, "clippers-tiktok-evidence-checklist.json");
const operatorHandoffJsonPath = path.join(workspaceRoot, "scheduled", "metricool-100-operator-handoff.json");
const streamerGrowthMetricsPath = path.join(reportsDir, "clippers-streamer-growth-metrics.json");
const streamerGrowthRoutingPath = path.join(reportsDir, "clippers-streamer-account-routing.json");
const humanReviewDecisionsPath = path.join(workspaceRoot, "evidence-drop", "human-review-decisions.csv");
await writeFile(streamerGrowthRoutingPath, `${JSON.stringify({
  source: "user_confirmed",
  confirmedAt: "2026-07-20T09:15:00.000Z",
  platform: "tiktok",
  sportsAccountName: "Streamer Highlights",
  memesAccountName: "Streamer Reactions",
  sportsConnected: true,
  memesConnected: true,
  publicProfileVerified: true,
  sportsProfileUrl: "https://www.tiktok.com/@streamersclipusa",
  memesProfileUrl: "https://www.tiktok.com/@streamersclips",
}, null, 2)}\n`);
const csrfToken = "local-operator-test-token";

function parseTestCsvLine(line) {
  const cells = [];
  let value = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"') {
      if (quoted && line[index + 1] === '"') {
        value += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (char === "," && !quoted) {
      cells.push(value);
      value = "";
    } else {
      value += char;
    }
  }
  cells.push(value);
  return cells;
}

function renderTestCsvLine(cells) {
  return cells.map((cell) => {
    const value = String(cell ?? "");
    return /[",\r\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
  }).join(",");
}

const resetFilePaths = [
  batchEvidenceCsvPath,
  masterEvidenceCsvPath,
  externalEvidenceCsvPath,
  externalCloseoutEvidenceCsvPath,
  nextExternalProofPath,
  accountReadinessJsonPath,
  sessionPacketJsonPath,
  uploadPackReportJsonPath,
  currentBatchWorkbookJsonPath,
  tiktokExternalCloseoutJsonPath,
  evidenceChecklistJsonPath,
  operatorHandoffJsonPath,
  streamerGrowthRoutingPath,
];
const resetFileContents = new Map(await Promise.all(resetFilePaths.map(async (filePath) => [filePath, await readFile(filePath, "utf8")])));

async function resetTestWorkspace() {
  await rm(path.join(workspaceRoot, "symlink-outside-test"), { force: true });
  await rm(path.join(workspaceRoot, "symlink-dir-outside-test"), { force: true, recursive: true });
  await rm(path.join(workspaceRoot, "source-drop"), { force: true, recursive: true });
  await rm(path.join(workspaceRoot, "quarantine"), { force: true, recursive: true });
  await rm(path.join(workspaceRoot, "evidence-drop"), { force: true, recursive: true });
  await Promise.all([...resetFileContents].map(async ([filePath, contents]) => {
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, contents);
  }));
  await rm(operatorAuditLogPath, { force: true });
  await rm(streamerGrowthMetricsPath, { force: true });
  await rm(path.join(workspaceRoot, "evidence-drop", "real-clip-permissions"), { force: true, recursive: true });
  await rm(path.join(workspaceRoot, "research"), { force: true, recursive: true });
  await rm(path.join(testWorkspaceParent, "package.json"), { force: true });
}

async function waitForHttp(url, timeoutMs = 10_000) {
  const startedAt = Date.now();
  let lastError = null;
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(1000) });
      if (response.ok) return response;
      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw lastError || new Error(`Timed out waiting for ${url}`);
}

async function withServer(env, callback) {
  const child = spawn(process.execPath, [scriptPath], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      CLIPPERS_LOCAL_OPERATOR_TOKEN: csrfToken,
      CLIPPERS_WORKSPACE_ROOT: workspaceRoot,
      CLIPPERS_LOCAL_OPERATOR_STUB_REFRESH: "true",
      CLIPPERS_OPERATOR_NOW: "2026-07-06T19:00:00.000Z",
      ...env,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => { stdout += chunk; });
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  try {
    await waitForHttp(`http://127.0.0.1:${env.PORT}/api/health`);
    return await callback({ child, getOutput: () => `${stdout}\n${stderr}` });
  } finally {
    child.kill("SIGTERM");
    await new Promise((resolve) => {
      child.once("exit", resolve);
      setTimeout(resolve, 1500);
    });
  }
}

test("Clippers local operator server serves status and guarded workspace files", async () => {
  const port = "5510";
  const symlinkPath = path.join(workspaceRoot, "symlink-outside-test");
  const symlinkDirPath = path.join(workspaceRoot, "symlink-dir-outside-test");
  const originalEvidenceCsv = await readFile(batchEvidenceCsvPath, "utf8");
  const originalMasterEvidenceCsv = await readFile(masterEvidenceCsvPath, "utf8");
  await rm(operatorAuditLogPath, { force: true });
  await rm(symlinkPath, { force: true });
  await rm(symlinkDirPath, { force: true, recursive: true });
  await writeFile(path.join(testWorkspaceParent, "package.json"), "{}\n");
  await symlink("../package.json", symlinkPath);
  await symlink("..", symlinkDirPath);
  try {
    await withServer({ HOST: "127.0.0.1", PORT: port }, async () => {
      const evidenceBeforeReadOnlyRequests = await readFile(batchEvidenceCsvPath, "utf8");
      const externalEvidenceBeforeReadOnlyRequests = await readFile(externalEvidenceCsvPath, "utf8");
      const statusResponse = await fetch(`http://127.0.0.1:${port}/api/clippers/status`);
      assert.equal(statusResponse.status, 200);
      assert.equal(await readFile(batchEvidenceCsvPath, "utf8"), evidenceBeforeReadOnlyRequests);
      assert.equal(await readFile(externalEvidenceCsvPath, "utf8"), externalEvidenceBeforeReadOnlyRequests);
      const status = await statusResponse.json();
      assert.equal(status.status, "blocked_real_clip_intake");
      assert.equal(status.sourceStatus, "blocked_real_clip_intake");
      assert.equal(status.previousSourceStatus, "ready_for_metricool_scheduling");
      assert.equal(status.tiktokOnly, true);
      assert.equal(status.metricoolApprovalRequired, true);
      assert.equal(status.realPublishEnabled, false);
      assert.equal(status.watchdog.enabled, false);
      assert.equal(status.watchdog.safeToAutoRollForward, false);
      assert.equal(status.watchdog.minutesUntilAutoRollForward, null);
      assert.equal(status.watchdog.autoRollForwardThresholdAt, "");
      assert.ok(status.watchdog.blockers.includes("disabled"));
      assert.match(status.watchdog.nextAction, /Auto roll-forward held/);
      assert.equal(status.preflight.failed, 0);
      assert.equal(status.metricoolMvp.status, "metricool_mvp_ready");
      assert.equal(status.metricoolMvp.directSocialApisRequired, false);
      assert.equal(status.metricoolMvp.activeReadyLanes, 2);
      assert.equal(status.metricoolMvp.activeTargetLanes, 2);
      assert.equal(status.metricoolMvp.activeExternalTasks, 0);
      assert.equal(status.tiktokBatchAccountSummary.status, "blocked_real_clip_intake");
      assert.equal(status.tiktokBatchAccountSummary.scope, "tiktok_metricool_current_batch");
      assert.equal(status.tiktokBatchAccountSummary.totals.accounts, 2);
      assert.equal(status.tiktokBatchAccountSummary.totals.totalRows, 10);
      assert.equal(status.tiktokBatchAccountSummary.totals.uploadFilesReady, 10);
      assert.equal(status.tiktokBatchAccountSummary.totals.missingUploadFiles, 0);
      assert.equal(status.tiktokBatchAccountSummary.totals.scheduledProofRecorded, 0);
      assert.equal(status.tiktokBatchAccountSummary.totals.missingScheduledProof, 10);
      assert.equal(status.tiktokBatchAccountSummary.accounts.find((account) => account.accountId === "sports-daily").totalRows, 8);
      assert.equal(status.tiktokBatchAccountSummary.accounts.find((account) => account.accountId === "meme-radar").totalRows, 2);
      assert.equal(status.tiktokBatchAccountSummary.accounts[0].nextQueueItemId, "7129d59b5f5e");
      assert.match(status.tiktokBatchAccountSummary.nextAction, /source-drop files and manifests|Real clip intake/i);
      assert.equal(status.tiktokAccountQueues.status, "blocked_real_clip_intake");
      assert.equal(status.tiktokAccountQueues.totals.accounts, 2);
      assert.equal(status.tiktokAccountQueues.totals.rows, 10);
      assert.equal(status.tiktokAccountQueues.accounts.find((account) => account.accountId === "sports-daily").rows.length, 8);
      assert.equal(status.tiktokAccountQueues.accounts.find((account) => account.accountId === "sports-daily").rows[0].queueItemId, "7129d59b5f5e");
      assert.equal(status.tiktokAccountQueues.accounts.find((account) => account.accountId === "meme-radar").rows[0].queueItemId, "53467d8f7dad");
      assert.equal(status.goalReadinessAudit.status, "external_actions_required");
      assert.equal(status.goalReadinessAudit.complete, false);
      assert.equal(status.goalReadinessAudit.scope, "tiktok_metricool_only");
      assert.ok(status.goalReadinessAudit.blockers.includes("missing_metricool_scheduled_proof_10"));
      assert.ok(status.goalReadinessAudit.blockers.includes("public_tiktok_urls_or_24h_metrics_not_ready"));
      assert.ok(status.goalReadinessAudit.blockers.includes("real_clip_intake_not_ready_0_of_10"));
      assert.equal(status.goalReadinessAudit.rows.find((row) => row.id === "metricool_tiktok_mvp").status, "ready");
      assert.equal(status.goalReadinessAudit.rows.find((row) => row.id === "real_clip_intake").status, "blocked");
      assert.equal(status.goalReadinessAudit.rows.find((row) => row.id === "metricool_scheduled_proof").status, "blocked");
      assert.equal(status.goalReadinessAudit.rows.find((row) => row.id === "direct_tiktok_apis").status, "deferred_not_required");
      assert.match(status.goalReadinessAudit.rows.find((row) => row.id === "direct_tiktok_apis").detail, /Metricool/);
      assert.equal(status.goalReadinessAudit.rows.find((row) => row.id === "other_platforms").status, "deferred_not_required");
      assert.equal(status.goalReadinessAudit.rows.find((row) => row.id === "real_publish_guardrail").status, "safe");
      assert.equal(status.deferredOtherPlatformRows, 0);
      assert.equal(status.operatorAudit.status, "empty");
      assert.equal(status.operatorAudit.events, 0);
      assert.match(status.operatorAudit.redaction, /hashed URLs\/notes/);
      assert.equal(status.evidenceIntegrity.status, "clean");
      assert.equal(status.evidenceIntegrity.readOnly, true);
      assert.equal(status.evidenceIntegrity.findingsCount, 0);
      assert.equal(status.evidenceIntegrity.currentBatchRowsWithEvidence, 0);
      assert.equal(status.evidenceIntegrity.masterCurrentBatchRowsWithEvidence, 0);
      assert.match(status.evidenceIntegrity.nextAction, /Continue scheduling/);
      assert.ok(status.rows.every((row) => row.platform === "tiktok"));
      assert.ok(status.rows.every((row) => row.status === "blocked_real_clip_intake"));
      assert.ok(status.rows.every((row) => row.sourceStatus === "blocked_real_clip_intake"));
      assert.ok(status.rows.every((row) => row.previousSourceStatus === "ready_to_schedule"));
      assert.ok(status.rows.every((row) => row.evidenceBlocker === "real_clip_intake_not_ready"));
      assert.match(status.rows[0].scheduledEvidenceAction, /replace the placeholder with a real approved TikTok clip/i);
      assert.ok(["ready_for_metricool_operator", "blocked_operator_checklist"].includes(status.metricoolOperatorChecklist.status));
      assert.equal(status.metricoolOperatorChecklist.currentBatchId, "metricool-batch-01");
      assert.equal(status.metricoolOperatorChecklist.nextRows.length, 3);
      assert.ok(Array.isArray(status.metricoolOperatorChecklist.blockers));
      assert.match(status.metricoolOperatorChecklist.steps.join(" "), /Metricool/);
      assert.match(status.metricoolOperatorChecklist.steps.join(" "), /Do not enter public TikTok URLs/);
      assert.equal(status.metricoolSchedulingRunSheet.status, "blocked_real_clip_intake");
      assert.equal(status.publicMetricsRunSheet.status, "locked_until_metricool_scheduled_proof");
      assert.equal(status.publicMetricsRunSheet.eligibleRows, 0);
      assert.equal(status.publicMetricsRunSheet.lockedRows, 10);
      assert.equal(status.uploadPackIntegrity.status, "ready");
      assert.equal(status.uploadPackIntegrity.totalRows, 10);
      assert.equal(status.uploadPackIntegrity.readyFiles, 10);
      assert.equal(status.uploadPackIntegrity.missingFiles, 0);
      assert.equal(status.uploadPackIntegrity.zeroByteFiles, 0);
      assert.ok(status.uploadPackIntegrity.totalBytes > 0);
      assert.equal(status.realClipGap.status, "generated_owned_placeholder_batch");
      assert.equal(status.realClipGap.totalRows, 10);
      assert.equal(status.realClipGap.realClipRows, 0);
      assert.equal(status.realClipGap.generatedOwnedRows, 10);
      assert.equal(status.realClipGap.missingRealClips, 10);
      assert.ok(status.realClipGap.blockers.includes("real_clip_sources_missing_10"));
      assert.ok(status.realClipGap.blockers.includes("generated_owned_assets_in_batch_10"));
      assert.match(status.realClipGap.summary, /not real-clip-ready/);
      assert.match(status.realClipGap.nextAction, /source-drop/);
      assert.equal(status.realClipGap.rows[0].sourceKind, "generated_owned_asset");
      assert.match(status.realClipGap.rows[0].detail, /not a viral third-party clip/);
      assert.equal(status.streamerGrowthCeo.status, "baseline_required");
      assert.equal(status.streamerGrowthCeo.strategy, "streamer_growth_to_10k");
      assert.equal(status.streamerGrowthCeo.targetFollowers, 10000);
      assert.equal(status.streamerGrowthCeo.currentFollowers, null);
      assert.equal(status.streamerGrowthCeo.progressKnown, false);
      assert.equal(status.streamerGrowthCeo.metricsSource, "metricool_not_imported");
      assert.equal(status.streamerGrowthCeo.supply.streamerMetricoolReady, true);
      assert.equal(status.streamerGrowthCeo.nextAction.stage, "capture_metricool_baseline");
      assert.equal(status.streamerGrowthCeo.routingConfirmation.confirmed, true);
      assert.equal(status.streamerGrowthCeo.routingConfirmation.source, "user_confirmed");
      assert.equal(status.streamerGrowthCeo.accountRouting[0].account, "Streamer Highlights");
      assert.equal(status.streamerGrowthCeo.accountRouting[1].account, "Streamer Reactions");
      assert.equal(status.streamerGrowthCeo.weeklyTargets.finalClips, 100);
      assert.equal(status.streamerGrowthCeo.weeklyTargets.shortGrowthClips, 70);
      assert.equal(status.streamerGrowthCeo.weeklyTargets.original60SecondClips, 30);
      assert.equal(status.streamerGrowthCeo.realPublishEnabled, false);
      assert.equal(status.streamerGrowthCeo.metricoolApprovalRequired, true);
      assert.match(status.streamerGrowthCeo.forbidden.join(" "), /Buying followers/);
      assert.equal(status.nextBestAction.stage, "real_clip_intake_required");
      assert.equal(status.nextBestAction.queueItemId, "7129d59b5f5e");
      assert.equal(status.nextBestAction.brand, "SPORT");
      assert.match(status.nextBestAction.detail, /blocked/i);
      assert.equal(status.nextBestAction.primaryHref, "/api/clippers/real-clip-intake.html");
      assert.equal(status.goLiveGapResolver.status, "blocked_real_clip_intake");
      assert.equal(status.goLiveGapResolver.canScheduleMetricool, false);
      assert.equal(status.goLiveGapResolver.realPublishAllowed, false);
      assert.ok(status.goLiveGapResolver.blockers.includes("real_clip_intake"));
      assert.ok(status.goLiveGapResolver.blockers.includes("placeholder_upload_pack"));
      assert.equal(status.goLiveGapResolver.rows.find((row) => row.id === "metricool_tiktok_accounts").status, "ready");
      assert.equal(status.goLiveGapResolver.rows.find((row) => row.id === "direct_social_apis").status, "deferred_not_required");
      assert.equal(status.goLiveGapResolver.rows.find((row) => row.id === "other_platform_accounts").status, "deferred_not_required");
      assert.equal(status.metricoolSchedulingRunSheet.operatorTimeZone, "America/New_York");
      assert.equal(status.metricoolSchedulingRunSheet.totalRows, 10);
      assert.equal(status.metricoolSchedulingRunSheet.missingScheduledProof, 10);
      assert.equal(status.metricoolSchedulingRunSheet.scheduledProofRecorded, 0);
      assert.equal(status.metricoolSchedulingRunSheet.nextQueueItemId, status.operatorSummary.deadlineQueueItemId);
      assert.equal(status.metricoolSchedulingRunSheet.nextRow.queueItemId, status.operatorSummary.deadlineQueueItemId);
      assert.equal(status.metricoolSchedulingRunSheet.nextRow.metricoolBrandName, "SPORT");
      assert.match(status.operatorSummary.nextAction, /source-drop files and manifests|Real clip intake/i);
      assert.match(status.operatorSummary.deadlineAction, /source-drop files and manifests|Real clip intake/i);
      assert.match(status.operatorSummary.scheduleWindowAction, /Do not schedule placeholders/i);
      assert.match(status.metricoolSchedulingRunSheet.nextRow.scheduledNoteTemplate, /SPORT TikTok row 2/);
      assert.equal(status.metricoolSchedulingRunSheet.rows[0].queueItemId, status.operatorSummary.deadlineQueueItemId);
      assert.equal(status.metricoolSchedulingRunSheet.rows[0].order, 1);
      assert.equal(typeof status.metricoolSchedulingRunSheet.rows[0].publishAtLocal, "string");
      assert.match(status.metricoolSchedulingRunSheet.rows[0].publishAtLocal, /E[DS]T|GMT/);
      assert.equal(typeof status.metricoolSchedulingRunSheet.rows[0].leadMinutes, "number");
      assert.match(status.metricoolSchedulingRunSheet.rows[0].scheduledNoteTemplate, /Scheduled manually in Metricool planner/);
      assert.match(status.metricoolSchedulingRunSheet.uploadChecklistCsv, /order,metricool_queue_item_id,metricool_brand,account_name,platform,publish_at_local,publish_at_iso,upload_file_name,caption_seed,scheduled_note_template/);
      assert.match(status.metricoolSchedulingRunSheet.uploadChecklistCsv, /7129d59b5f5e/);
      assert.match(status.metricoolSchedulingRunSheet.uploadChecklistCsv, /Scheduled manually in Metricool planner for SPORT TikTok row 2/);
      assert.equal(status.metricoolSchedulingRunSheet.uploadChecklistCsv.trim().split("\n").length, 11);
      assert.deepEqual(
        status.metricoolSchedulingRunSheet.rows.map((row) => Date.parse(row.publishAt)),
        [...status.metricoolSchedulingRunSheet.rows.map((row) => Date.parse(row.publishAt))].sort((left, right) => left - right),
      );
      assert.equal(status.evidence.missingApproval, 10);
      assert.equal(status.evidence.readyForImportPreview, 0);
      assert.equal(status.externalEvidence.status, "needs_real_external_evidence");
      assert.equal(status.externalEvidence.rows, 16);
      assert.equal(status.externalEvidence.accounts, 7);
      assert.equal(status.externalEvidence.developerApps, 3);
      assert.equal(status.externalEvidence.permissions, 6);
      assert.equal(status.externalEvidence.tiktok, 4);
      assert.equal(status.externalEvidence.instagram, 7);
      assert.equal(status.externalEvidence.youtube, 5);
      assert.equal(status.externalEvidence.nextRows[0].kind, "developer_app");
      assert.equal(status.externalEvidence.nextRows[0].platform, "instagram");
      assert.match(status.externalEvidence.csvStarter, /developer_app.*instagram/);
      assert.equal(status.externalEvidenceValidation.status, "blocked_invalid_evidence");
      assert.equal(status.externalEvidenceValidation.accepted, 0);
      assert.equal(status.externalEvidenceValidation.rejected, 16);
      assert.equal(status.externalEvidenceValidation.applied, 0);
      assert.equal(status.externalEvidenceValidation.activeRepairRows, 0);
      assert.equal(status.externalEvidenceValidation.deferredRepairRows, 4);
      assert.equal(status.externalEvidenceValidation.repairRows.length, 6);
      assert.deepEqual(status.externalEvidenceValidation.repairRows.slice(0, 4).map((row) => row.platform), ["tiktok", "tiktok", "tiktok", "tiktok"]);
      assert.equal(status.externalEvidenceValidation.repairRows[0].activeForMetricoolMvp, false);
      assert.equal(status.externalEvidenceValidation.repairRows[0].deferredForMetricoolMvp, true);
      assert.equal(status.externalEvidenceValidation.repairRows[1].deferredReason, "direct_api_not_required_for_metricool_mvp");
      assert.equal(status.externalEvidenceValidation.repairRows[0].closeoutId, "account:streamer-pulse:tiktok");
      assert.equal(status.externalEvidenceValidation.repairRows[1].closeoutId, "developer_app:tiktok");
      assert.equal(status.externalEvidenceValidation.repairRows[2].closeoutId, "permission:tiktok:video.publish");
      assert.equal(status.externalEvidenceValidation.nextRepair.closeoutId, "account:streamer-pulse:tiktok");
      assert.equal(status.externalEvidenceValidation.nextRepair.csvRow, 6);
      assert.equal(status.externalEvidenceValidation.nextRepair.accountId, "streamer-pulse");
      assert.equal(status.externalEvidenceValidation.nextRepair.requiredStatus, "verified");
      assert.equal(status.externalEvidenceValidation.nextRepair.activeForMetricoolMvp, false);
      assert.equal(status.externalEvidenceValidation.nextRepair.deferredForMetricoolMvp, true);
      assert.match(status.externalEvidenceValidation.nextRepair.reason, /placeholder|proof/i);
      assert.deepEqual(status.externalEvidenceValidation.nextRepair.missingCsvFields, ["proof"]);
      assert.match(status.externalEvidenceValidation.nextRepair.proofUrl, /^\/clippers-workspace\/evidence-drop\/external-closeout-proofs\/account-streamer-pulse-tiktok\.md$/);
      assert.equal(status.operatorSummary.nextRank, 2);
      assert.equal(status.operatorSummary.nextQueueItemId, "7129d59b5f5e");
      assert.equal(status.operatorSummary.nextQueueItemId, status.operatorSummary.deadlineQueueItemId);
      assert.equal(typeof status.operatorSummary.needsRollForward, "boolean");
      assert.ok(["ok", "soon", "urgent", "expired", "unknown"].includes(status.operatorSummary.scheduleWindowStatus));
      assert.match(status.operatorSummary.scheduleWindowAction, /Metricool|Refresh|Roll forward|Schedule|Do not schedule placeholders/);
      assert.equal(status.operatorSummary.deadlineQueueItemId, "7129d59b5f5e");
      assert.equal(status.operatorSummary.deadlineRank, 2);
      assert.match(status.scheduledProofCsvStarter, /metricool_queue_item_id,metricool_approval_url,operator_notes/);
      assert.doesNotMatch(status.scheduledProofCsvStarter, /7129d59b5f5e/);
      assert.doesNotMatch(status.scheduledProofCsvStarter, /<paste real Metricool planner URL after scheduling>/);
      const starterLines = status.scheduledProofCsvStarter.trim().split("\n");
      assert.equal(starterLines.length, 1);
      assert.equal(status.rows.length, 10);
      assert.doesNotMatch(JSON.stringify(status), /\/Users\/|\/var\/folders\//);
      assert.match(status.rows[0].uploadFileUrl, /^\/clippers-workspace\/scheduled\/metricool-current-batch-upload-pack\/.+\.mp4$/);
      assert.equal(status.rows[0].evidenceState, "not_started");
      assert.deepEqual(status.rows[0].evidenceMissingFields, ["metricool_approval_url", "final_status"]);
      assert.match(status.rows[0].evidenceTemplate, /scheduled only after real Metricool scheduling proof/);
      assert.match(status.rows[0].scheduledCsvTemplate, /<paste real Metricool planner URL after scheduling>/);
      assert.equal(status.tiktokBatchAccountSummary.status, "blocked_real_clip_intake");
      assert.match(status.tiktokBatchAccountSummary.nextAction, /source-drop files and manifests|Real clip intake/i);
      assert.equal(status.tiktokAccountQueues.status, "blocked_real_clip_intake");

      const directUploadPackVideoResponse = await fetch(`http://127.0.0.1:${port}${status.rows[0].uploadFileUrl}`);
      assert.equal(directUploadPackVideoResponse.status, 409);
      assert.equal((await directUploadPackVideoResponse.json()).error, "upload_pack_video_blocked_until_real_clip_intake_ready");

      const homeResponse = await fetch(`http://127.0.0.1:${port}/clippers`);
      assert.equal(homeResponse.status, 200);
      const home = await homeResponse.text();
      assert.match(home, /Upload pack integrity/);
      assert.match(home, /Metricool scheduling is blocked if any required local MP4 is missing or empty/);
      assert.match(home, /10\/10 files ready/);
      assert.match(home, /Real clip gap/);
      assert.match(home, /Real clips 0\/10/);
      assert.match(home, /generated_owned_placeholder_batch/);
      assert.match(home, /Generated owned placeholders 10/);
      assert.match(home, /Missing real clips 10/);
      assert.match(home, /Real clip gap JSON/);
      assert.match(home, /Real clip gap MD/);
      assert.match(home, /Real clip intake/);
      assert.match(home, /Real clip manifest CSV/);
      assert.match(home, /Real clip validation/);
      assert.match(home, /Permission outreach/);
      assert.match(home, /Real clip intake validation/);
      assert.match(home, /Ready 0\/10/);
      assert.match(home, /not a viral third-party clip/);
      assert.match(home, /De video viral a clip publicado/);
      assert.match(home, /Flujo de trabajo/);
      assert.match(home, /10K/);
      assert.match(home, /Baseline/);
      assert.match(home, /Buscar videos/);
      assert.match(home, /Gestionar permisos/);
      assert.match(home, /Preparar clips/);
      assert.match(home, /Cargar clips reales/);
      assert.match(home, /Ver meta 10K y baseline/);
      assert.doesNotMatch(home, /nth-child\(n\+7\).*display:none/);
      assert.match(home, /Ver diagnóstico completo, tablas y formularios/);
      for (const [route, expectedTitle] of [
        ["/api/clippers/real-clip-source-hunt.html", "Buscar videos virales"],
        ["/api/clippers/real-clip-exact-source-candidate.html", "Guardar candidato"],
        ["/api/clippers/real-clip-permission-crm.html", "Gestionar permisos"],
        ["/api/clippers/real-clip-acquisition-workbench.html", "Preparar clips"],
        ["/api/clippers/tiktok-launch-authorization.html", "Revisar autorizacion de TikTok"],
        ["/api/clippers/streamer-growth-ceo.html", "Control de crecimiento a 10K"],
        ["/api/clippers/streamer-100-campaign.html", "Campana de 100 streamers"],
        ["/api/clippers/go-live-gap-resolver.html", "Resolver bloqueos"],
        ["/api/clippers/next-metricool-action.html", "Proxima accion en Metricool"],
      ]) {
        const quickActionResponse = await fetch(`http://127.0.0.1:${port}${route}`);
        assert.equal(quickActionResponse.status, 200, `quick action ${route} should work`);
        const quickActionHtml = await quickActionResponse.text();
        assert.match(quickActionHtml, /data-clippers-shared-ui/);
        assert.match(quickActionHtml, /class="operator-nav"/);
        assert.match(quickActionHtml, new RegExp(`<h1>${expectedTitle}</h1>`));
        assert.doesNotMatch(quickActionHtml, /operator-nav-links a:last-child\{display:none/);
      }
      const streamerGrowthCeoResponse = await fetch(`http://127.0.0.1:${port}/api/clippers/streamer-growth-ceo.json`);
      assert.equal(streamerGrowthCeoResponse.status, 200);
      const streamerGrowthCeo = await streamerGrowthCeoResponse.json();
      assert.equal(streamerGrowthCeo.nextAction.stage, "capture_metricool_baseline");
      assert.equal(streamerGrowthCeo.currentFollowers, null);
      assert.equal(streamerGrowthCeo.weeklyTargets.metricoolApprovalQueue, 100);
      assert.equal(streamerGrowthCeo.weeklyTargets.streamerHighlightsClips, 55);
      assert.equal(streamerGrowthCeo.weeklyTargets.streamerReactionsClips, 45);

      const streamerGrowthCeoMarkdownResponse = await fetch(`http://127.0.0.1:${port}/api/clippers/streamer-growth-ceo.md`);
      assert.equal(streamerGrowthCeoMarkdownResponse.status, 200);
      const streamerGrowthCeoMarkdown = await streamerGrowthCeoMarkdownResponse.text();
      assert.match(streamerGrowthCeoMarkdown, /# Streamer Growth CEO/);
      assert.match(streamerGrowthCeoMarkdown, /unknown - Metricool baseline not imported/);
      assert.match(streamerGrowthCeoMarkdown, /realPublishEnabled: false/);

      const streamerGrowthCeoHtmlResponse = await fetch(`http://127.0.0.1:${port}/api/clippers/streamer-growth-ceo.html`);
      assert.equal(streamerGrowthCeoHtmlResponse.status, 200);
      const streamerGrowthCeoHtml = await streamerGrowthCeoHtmlResponse.text();
      assert.match(streamerGrowthCeoHtml, /dos cuentas 100% streamers hasta 10K seguidores por cuenta/);
      assert.match(streamerGrowthCeoHtml, /Streamer Highlights/);
      assert.match(streamerGrowthCeoHtml, /Streamer Reactions/);
      assert.match(streamerGrowthCeoHtml, /100 blanket approvals/);
      assert.match(streamerGrowthCeoHtml, /Human approval gates/);

      const streamerCampaignResponse = await fetch(`http://127.0.0.1:${port}/api/clippers/streamer-100-campaign.json`);
      assert.equal(streamerCampaignResponse.status, 200);
      const streamerCampaign = await streamerCampaignResponse.json();
      assert.equal(streamerCampaign.targetStreamers, 100);
      assert.equal(streamerCampaign.blanketApprovedRows, 0);
      assert.ok(streamerCampaign.rows.every((row) => row.canPublish === false));

      const streamerCampaignCsvResponse = await fetch(`http://127.0.0.1:${port}/api/clippers/streamer-100-campaign.csv`);
      assert.equal(streamerCampaignCsvResponse.status, 200);
      const streamerCampaignCsv = await streamerCampaignCsvResponse.text();
      assert.match(streamerCampaignCsv, /^handle,twitch_url,cohort,language,country,category,contact_email/m);
      assert.doesNotMatch(streamerCampaignCsv, /can_publish,yes/);

      const permissionPacketsResponse = await fetch(`http://127.0.0.1:${port}/api/clippers/real-clip-permission-request-packets.json`);
      assert.equal(permissionPacketsResponse.status, 200);
      const permissionPackets = await permissionPacketsResponse.json();
      assert.equal(permissionPackets.rows[0].permissionScope, "blanket_creator_tiktok_commercial");
      assert.match(permissionPackets.rows[0].message, /blanket permission/i);
      assert.match(permissionPackets.rows[0].message, /future clips/i);
      assert.match(permissionPackets.rows[0].message, /monetize/i);
      assert.match(home, /Batch actual/);
      assert.match(home, /Next row/);
      assert.match(home, /First publish/);
      assert.match(home, /Earliest deadline/);
      assert.match(home, /Cuentas listas/);
      assert.match(home, /TikTok \+ Metricool MVP/);
      assert.match(home, /TikTok batch by account/);
      assert.match(home, /Accounts 2 · Clips 10 · Upload files 10\/10 · Missing scheduled proof 10/);
      assert.match(home, /SPORT/);
      assert.match(home, /Streamer Reactions/);
      assert.match(home, /Metricool scheduling run sheet/);
      assert.match(home, /Next Metricool action/);
      assert.match(home, /Next action packet/);
      assert.match(home, /Next action JSON/);
      assert.match(home, /Account queues JSON/);
      assert.match(home, /Account queues CSV/);
      assert.match(home, /Account queues MD/);
      assert.match(home, /SPORT next JSON/);
      assert.match(home, /memes next JSON/);
      assert.match(home, /SPORT proof CSV/);
      assert.match(home, /memes proof CSV/);
      assert.match(home, /SPORT runbook/);
      assert.match(home, /memes runbook/);
      assert.match(home, /Scheduled proof locked: complete Real clip intake first/);
      assert.doesNotMatch(home, /Save scheduled proof for next row/);
      assert.doesNotMatch(home, /\/api\/clippers\/evidence\/scheduled-preview/);
      assert.match(home, /Queue item: 7129d59b5f5e/);
      assert.match(home, /blocked_real_clip_intake/);
      assert.match(home, /0\/10 scheduled proofs recorded/);
      assert.match(home, /Time zone America\/New_York/);
      assert.match(home, /Lead min:/);
      assert.match(home, /Copy Metricool upload checklist CSV/);
      assert.match(home, /Download CSV/);
      assert.match(home, /order,metricool_queue_item_id,metricool_brand/);
      assert.match(home, /Goal readiness audit/);
      assert.match(home, /external_actions_required/);
      assert.match(home, /Missing Metricool scheduled proof: 10\/10/);
      assert.match(home, /Direct TikTok APIs/);
      assert.match(home, /deferred_not_required/);
      assert.match(home, /External account \+ permission evidence/);
      assert.match(home, /Active MVP repairs: 0/);
      assert.match(home, /Deferred backlog repairs: 4/);
      assert.match(home, /Deferred evidence backlog/);
      assert.doesNotMatch(home, /Save non-secret proof for this repair/);
      assert.match(home, /Rows 16/);
      assert.match(home, /External evidence CSV/);
      assert.match(home, /Validation:/);
      assert.match(home, /Rejected 16/);
      assert.match(home, /account:streamer-pulse:tiktok/);
      assert.match(home, /current launch path is to schedule SPORT and memes TikTok rows in Metricool/);
      assert.match(home, /Copy repair CSV row/);
      assert.match(home, /Repair queue priority/);
      assert.match(home, /developer_app:tiktok/);
      assert.match(home, /permission:tiktok:video.publish/);
      assert.match(home, /Validation report/);
      assert.match(home, /Repair packet/);
      assert.match(home, /Preview external evidence/);
      assert.match(home, /Preview does not apply evidence or mark accounts ready/);
      assert.match(home, /Apply accepted external evidence/);
      assert.match(home, /Apply accepted only imports rows that pass strict validation/);
      assert.match(home, /Copy external evidence CSV starter/);
      assert.match(home, /Never paste passwords, cookies, client secrets/);
      assert.match(home, /Evidence audit trail/);
      assert.match(home, /Evidence integrity/);
      assert.match(home, /No fake, placeholder, secret-like, or inconsistent evidence detected/);
      assert.match(home, /No evidence mutation attempts recorded yet/);
      assert.match(home, /Local watchdog/);
      assert.match(home, /Auto roll-forward threshold/);
      assert.match(home, /Minutes until threshold/);
      assert.match(home, /It never opens Metricool/);
      assert.match(home, /Direct APIs: deferred/);
      assert.match(home, /Account readiness/);
      assert.match(home, /TikTok closeout/);
      assert.match(home, /Metricool now/);
      assert.match(home, /Current TikTok packet/);
      assert.match(home, /Current TikTok JSON/);
      assert.match(home, /Current caption TXT/);
      assert.match(home, /Current video MP4/);
      assert.match(home, /Operator brief/);
      assert.match(home, /Operator report/);
      assert.match(home, /Ready JSON/);
      assert.match(home, /Current TikTok now/);
      assert.match(home, /Current upload CSV/);
      assert.match(home, /Current proof CSV/);
      assert.match(home, /SPORT now/);
      assert.match(home, /memes now/);
      assert.match(home, /SPORT next upload CSV/);
      assert.match(home, /memes next upload CSV/);
      assert.match(home, /SPORT next proof CSV/);
      assert.match(home, /memes next proof CSV/);
      assert.match(home, /Evidence integrity/);
      assert.match(home, /Metricool operator checklist/);
      assert.match(home, /Do not enter public TikTok URLs/);
      assert.doesNotMatch(home, /Import scheduled proof batch/);
      assert.match(home, /Copy scheduled proof CSV starter/);
      assert.match(home, /Download next row only/);
      assert.match(home, /Copy full scheduled proof CSV starter/);
      assert.match(home, /Download full scheduled proof CSV/);
      assert.match(home, /Scheduled proof locked: complete Real clip intake first/);
      assert.match(home, /&lt;paste real Metricool planner URL after scheduling&gt;/);
      assert.match(home, /Scheduled proof batch preview is locked/);
      assert.doesNotMatch(home, /form method="post" action="\/api\/clippers\/evidence\/scheduled-batch"/);
      assert.match(home, /Atomic import/);
      assert.doesNotMatch(home, /Import published metrics batch/);
      assert.match(home, /Download next metrics row only/);
      assert.match(home, /Download full published metrics CSV/);
      assert.match(home, /Public TikTok metrics run sheet/);
      assert.match(home, /locked_until_metricool_scheduled_proof/);
      assert.match(home, /Haz esto ahora/);
      assert.match(home, /Reemplaza los videos de prueba por clips reales/);
      assert.match(home, /Preview published metrics batch/);
      assert.doesNotMatch(home, /form method="post" action="\/api\/clippers\/evidence\/published-batch"/);
      assert.match(home, /Requires prior scheduled proof/);
      assert.match(home, /csrfToken/);
      assert.match(home, /Clips reales/);
      assert.match(home, /Con métricas/);
      assert.match(home, /Actualizar estado/);
      assert.match(home, /Roll forward schedule/);
      assert.match(home, /Copy evidence/);
      assert.match(home, /scheduled only after real Metricool scheduling proof/);
      assert.match(home, /Save scheduled proof/);
      assert.doesNotMatch(home, /form method="post" action="\/api\/clippers\/evidence\/scheduled"/);
      assert.match(home, /Published metrics locked until Metricool scheduled proof is saved for this row/);
      assert.doesNotMatch(home, /<summary>Save published metrics<\/summary>/);
      assert.match(home, /name="returnTo" value="\/clippers"/);
      assert.match(home, /metricool-current-batch-upload-pack\/.+\.mp4/);
      assert.match(home, /metricool_approval_url, final_status/);
      assert.equal(await readFile(batchEvidenceCsvPath, "utf8"), evidenceBeforeReadOnlyRequests);
      assert.equal(await readFile(externalEvidenceCsvPath, "utf8"), externalEvidenceBeforeReadOnlyRequests);

      const nextActionJsonResponse = await fetch(`http://127.0.0.1:${port}/api/clippers/next-metricool-action.json`);
      assert.equal(nextActionJsonResponse.status, 200);
      const nextActionJson = await nextActionJsonResponse.json();
      assert.equal(nextActionJson.status, "real_clip_intake_required");
      assert.equal(nextActionJson.scheduleReady, false);
      assert.equal(nextActionJson.queueItemId, "");
      assert.equal(nextActionJson.brand, "");
      assert.equal(nextActionJson.accountName, "");
      assert.equal(nextActionJson.platform, "");
      assert.equal(nextActionJson.uploadFileName, "");
      assert.equal(nextActionJson.realPublishEnabled, false);
      assert.equal(nextActionJson.metricoolApprovalRequired, true);
      assert.equal(nextActionJson.links.nextActionHtml, `http://127.0.0.1:${port}/api/clippers/next-metricool-action.html`);

      const nextActionHtmlResponse = await fetch(`http://127.0.0.1:${port}/api/clippers/next-metricool-action.html`);
      assert.equal(nextActionHtmlResponse.status, 200);
      const nextActionHtml = await nextActionHtmlResponse.text();
      assert.match(nextActionHtml, /Clippers Metricool Now/);
      assert.match(nextActionHtml, /Una sola acción segura para el próximo TikTok/);
      assert.match(nextActionHtml, /Replace placeholders with real clips before Metricool/);
      assert.match(nextActionHtml, /No hay fila lista para programar ahora/);
      assert.doesNotMatch(nextActionHtml, /Programa este clip en Metricool/);
      assert.doesNotMatch(nextActionHtml, /\/api\/clippers\/evidence\/scheduled-preview/);
      assert.match(nextActionHtml, /\/api\/clippers\/tiktok-current-account-now\.html/);
      assert.match(nextActionHtml, /\/api\/clippers\/tiktok-current-action\.md/);
      assert.match(nextActionHtml, /realPublishEnabled: false/);
      assert.doesNotMatch(nextActionHtml, /form method="post" action="\/api\/clippers\/evidence\/scheduled"/);
      assert.doesNotMatch(nextActionHtml, /publishedPostUrl/);

      const realClipGapResponse = await fetch(`http://127.0.0.1:${port}/api/clippers/real-clip-gap.json`);
      assert.equal(realClipGapResponse.status, 200);
      const realClipGap = await realClipGapResponse.json();
      assert.equal(realClipGap.status, "generated_owned_placeholder_batch");
      assert.equal(realClipGap.realClipRows, 0);
      assert.equal(realClipGap.generatedOwnedRows, 10);
      assert.equal(realClipGap.missingRealClips, 10);
      assert.match(realClipGap.nextAction, /source-drop/);
      assert.doesNotMatch(JSON.stringify(realClipGap), /metricool_approval_url|published_post_url|views_24h|\/Users\/|clippers-workspace\/scheduled\/metricool-current-batch-upload-pack/);

      const realClipGapMarkdownResponse = await fetch(`http://127.0.0.1:${port}/api/clippers/real-clip-gap.md`);
      assert.equal(realClipGapMarkdownResponse.status, 200);
      assert.match(realClipGapMarkdownResponse.headers.get("content-disposition") || "", /clippers-real-clip-gap\.md/);
      const realClipGapMarkdown = await realClipGapMarkdownResponse.text();
      assert.match(realClipGapMarkdown, /# Clippers Real Clip Gap/);
      assert.match(realClipGapMarkdown, /Generated owned placeholder rows: 10/);
      assert.match(realClipGapMarkdown, /Generated owned assets are safe placeholders, not viral clips/);
      assert.doesNotMatch(realClipGapMarkdown, /metricool_approval_url|published_post_url|views_24h/);

      const realClipIntakeHtmlResponse = await fetch(`http://127.0.0.1:${port}/api/clippers/real-clip-intake.html`);
      assert.equal(realClipIntakeHtmlResponse.status, 200);
      assert.match(realClipIntakeHtmlResponse.headers.get("content-type") || "", /text\/html/);
      const realClipIntakeHtml = await realClipIntakeHtmlResponse.text();
      assert.match(realClipIntakeHtml, /Clippers Real Clip Intake/);
      assert.match(realClipIntakeHtml, /Replacements<\/div><div class="value">10/);
      assert.match(realClipIntakeHtml, /source-drop\/sports\/sports-real-7129d59b5f5e\.mp4/);
      assert.match(realClipIntakeHtml, /source-drop\/memes\/memes-real-53467d8f7dad\.mp4/);
      assert.doesNotMatch(realClipIntakeHtml, /\/Users\/|metricool_approval_url|published_post_url|views_24h/);

      const realClipIntakeMarkdownResponse = await fetch(`http://127.0.0.1:${port}/api/clippers/real-clip-intake.md`);
      assert.equal(realClipIntakeMarkdownResponse.status, 200);
      assert.match(realClipIntakeMarkdownResponse.headers.get("content-disposition") || "", /clippers-real-clip-intake\.md/);
      const realClipIntakeMarkdown = await realClipIntakeMarkdownResponse.text();
      assert.match(realClipIntakeMarkdown, /# Clippers Real Clip Intake Pack/);
      assert.match(realClipIntakeMarkdown, /Replacement rows needed: 10/);
      assert.match(realClipIntakeMarkdown, /source-drop\/sports\/sports-real-7129d59b5f5e\.mp4/);
      assert.match(realClipIntakeMarkdown, /Starter placeholders are not evidence/);
      assert.doesNotMatch(realClipIntakeMarkdown, /\/Users\/|metricool_approval_url|published_post_url|views_24h/);

      const realClipIntakeManifestResponse = await fetch(`http://127.0.0.1:${port}/api/clippers/real-clip-intake-manifest.csv`);
      assert.equal(realClipIntakeManifestResponse.status, 200);
      assert.match(realClipIntakeManifestResponse.headers.get("content-disposition") || "", /clippers-real-clip-intake-manifest\.csv/);
      const realClipIntakeManifest = await realClipIntakeManifestResponse.text();
      assert.match(realClipIntakeManifest, /^category,title,url,source,platform,target_file_name,rights_status,evidence_link,priority,notes/m);
      assert.match(realClipIntakeManifest, /sports-real-7129d59b5f5e\.mp4/);
      assert.match(realClipIntakeManifest, /memes-real-53467d8f7dad\.mp4/);
      assert.match(realClipIntakeManifest, /<paste exact TikTok, Twitch clip, or YouTube video URL; not search\/explore\/channel>/);
      assert.match(realClipIntakeManifest, /review_required/);
      assert.doesNotMatch(realClipIntakeManifest, /\/Users\/|app\.metricool\.com\/planner|published_post_url|views_24h/);

      const realClipIntakeValidationResponse = await fetch(`http://127.0.0.1:${port}/api/clippers/real-clip-intake-validation.json`);
      assert.equal(realClipIntakeValidationResponse.status, 200);
      const realClipIntakeValidation = await realClipIntakeValidationResponse.json();
      assert.equal(realClipIntakeValidation.status, "blocked");
      assert.equal(realClipIntakeValidation.readyRows, 0);
      assert.equal(realClipIntakeValidation.blockedRows, 10);
      assert.equal(realClipIntakeValidation.rows[0].status, "blocked");
      assert.ok(realClipIntakeValidation.rows[0].blockers.includes("missing_source_file"));
      assert.ok(realClipIntakeValidation.rows[0].blockers.includes("manifest_row_missing"));
      assert.ok(realClipIntakeValidation.rows[0].blockers.includes("exact_source_video_or_post_url_missing"));
      assert.doesNotMatch(JSON.stringify(realClipIntakeValidation), /\/Users\/|metricool_approval_url|published_post_url|views_24h/);

      const realClipIntakeValidationHtmlResponse = await fetch(`http://127.0.0.1:${port}/api/clippers/real-clip-intake-validation.html`);
      assert.equal(realClipIntakeValidationHtmlResponse.status, 200);
      const realClipIntakeValidationHtml = await realClipIntakeValidationHtmlResponse.text();
      assert.match(realClipIntakeValidationHtml, /Clippers Real Clip Intake Validation/);
      assert.match(realClipIntakeValidationHtml, /Listos<\/div><div class="value">0\/10/);
      assert.match(realClipIntakeValidationHtml, /missing_source_file/);
      assert.doesNotMatch(realClipIntakeValidationHtml, /\/Users\/|metricool_approval_url|published_post_url|views_24h/);

      const realClipIntakeValidationMarkdownResponse = await fetch(`http://127.0.0.1:${port}/api/clippers/real-clip-intake-validation.md`);
      assert.equal(realClipIntakeValidationMarkdownResponse.status, 200);
      assert.match(realClipIntakeValidationMarkdownResponse.headers.get("content-disposition") || "", /clippers-real-clip-intake-validation\.md/);
      const realClipIntakeValidationMarkdown = await realClipIntakeValidationMarkdownResponse.text();
      assert.match(realClipIntakeValidationMarkdown, /# Clippers Real Clip Intake Validation/);
      assert.match(realClipIntakeValidationMarkdown, /Ready rows: 0/);
      assert.match(realClipIntakeValidationMarkdown, /Blocked rows: 10/);
      assert.doesNotMatch(realClipIntakeValidationMarkdown, /\/Users\/|metricool_approval_url|published_post_url|views_24h/);

      const permissionOutreachHtmlResponse = await fetch(`http://127.0.0.1:${port}/api/clippers/real-clip-permission-outreach.html`);
      assert.equal(permissionOutreachHtmlResponse.status, 200);
      assert.match(permissionOutreachHtmlResponse.headers.get("content-type") || "", /text\/html/);
      const permissionOutreachHtml = await permissionOutreachHtmlResponse.text();
      assert.match(permissionOutreachHtml, /Clippers Permission Outreach/);
      assert.match(permissionOutreachHtml, /needs_permission_outreach/);
      assert.match(permissionOutreachHtml, /Approved here<\/div><div class="value">0/);
      assert.match(permissionOutreachHtml, /We will not post until you approve/);
      assert.match(permissionOutreachHtml, /source-drop\/sports\/sports-real-7129d59b5f5e\.mp4/);
      assert.doesNotMatch(permissionOutreachHtml, /\/Users\/|metricool_approval_url|published_post_url|views_24h|app\.metricool\.com\/planner/);

      const permissionOutreachMarkdownResponse = await fetch(`http://127.0.0.1:${port}/api/clippers/real-clip-permission-outreach.md`);
      assert.equal(permissionOutreachMarkdownResponse.status, 200);
      assert.match(permissionOutreachMarkdownResponse.headers.get("content-disposition") || "", /clippers-real-clip-permission-outreach\.md/);
      const permissionOutreachMarkdown = await permissionOutreachMarkdownResponse.text();
      assert.match(permissionOutreachMarkdown, /# Clippers Real Clip Permission Outreach Pack/);
      assert.match(permissionOutreachMarkdown, /Outreach rows: 10/);
      assert.match(permissionOutreachMarkdown, /Approved in this pack: 0/);
      assert.match(permissionOutreachMarkdown, /Do not mark permission approved from this pack alone/);
      assert.doesNotMatch(permissionOutreachMarkdown, /\/Users\/|metricool_approval_url|published_post_url|views_24h|app\.metricool\.com\/planner/);

      const permissionOutreachCsvResponse = await fetch(`http://127.0.0.1:${port}/api/clippers/real-clip-permission-outreach.csv`);
      assert.equal(permissionOutreachCsvResponse.status, 200);
      assert.match(permissionOutreachCsvResponse.headers.get("content-disposition") || "", /clippers-real-clip-permission-outreach\.csv/);
      const permissionOutreachCsv = await permissionOutreachCsvResponse.text();
      assert.match(permissionOutreachCsv, /^order,metricool_queue_item_id,category,account_name,target_source_drop_file/m);
      assert.match(permissionOutreachCsv, /not_sent/);
      assert.match(permissionOutreachCsv, /not_requested/);
      assert.match(permissionOutreachCsv, /<paste exact https:\/\/www\.tiktok\.com\/@creator\/video\/id URL>/);
      assert.match(permissionOutreachCsv, /We will not post until you approve/);
      assert.doesNotMatch(permissionOutreachCsv, /\/Users\/|app\.metricool\.com\/planner|published_post_url|views_24h/);

      const authorizationHtmlResponse = await fetch(`http://127.0.0.1:${port}/api/clippers/tiktok-launch-authorization.html`);
      assert.equal(authorizationHtmlResponse.status, 200);
      const authorizationHtml = await authorizationHtmlResponse.text();
      assert.match(authorizationHtml, /TikTok Launch Authorization/);
      assert.match(authorizationHtml, /SPORT/);
      assert.match(authorizationHtml, /memes/);
      assert.match(authorizationHtml, /blocked_external_authorization/);
      assert.doesNotMatch(authorizationHtml, /\/Users\/|\/var\/folders|app\.metricool\.com\/planner/);

      const authorizationJsonResponse = await fetch(`http://127.0.0.1:${port}/api/clippers/tiktok-launch-authorization.json`);
      assert.equal(authorizationJsonResponse.status, 200);
      const authorizationJson = await authorizationJsonResponse.json();
      assert.equal(authorizationJson.status, "blocked_external_authorization");
      assert.equal(authorizationJson.tiktokOnly, true);
      assert.equal(authorizationJson.metricoolApprovalRequired, true);
      assert.equal(authorizationJson.realPublishEnabled, false);
      assert.equal(authorizationJson.accountsTargeted, 2);
      assert.equal(authorizationJson.accountsConnectedForMvp, 2);
      assert.equal(authorizationJson.permissionRows, 10);
      assert.equal(authorizationJson.permissionRowsReady, 0);
      assert.ok(authorizationJson.blockers.includes("real_clip_intake_blocked"));
      assert.deepEqual(authorizationJson.accounts.map((account) => account.accountId).sort(), ["meme-radar", "sports-daily"]);
      assert.ok(authorizationJson.rows.every((row) => row.missingRightsProof === true));
      assert.doesNotMatch(JSON.stringify(authorizationJson), /\/Users\/|\/var\/folders|app\.metricool\.com\/planner/);

      const authorizationCsvResponse = await fetch(`http://127.0.0.1:${port}/api/clippers/tiktok-launch-authorization.csv`);
      assert.equal(authorizationCsvResponse.status, 200);
      const authorizationCsv = await authorizationCsvResponse.text();
      assert.match(authorizationCsv, /^metricool_queue_item_id,category,account_name,target_source_drop_file/m);
      assert.match(authorizationCsv, /missing_source_file/);
      assert.doesNotMatch(authorizationCsv, /\/Users\/|\/var\/folders|app\.metricool\.com\/planner/);

      const authorizationMarkdownResponse = await fetch(`http://127.0.0.1:${port}/api/clippers/tiktok-launch-authorization.md`);
      assert.equal(authorizationMarkdownResponse.status, 200);
      const authorizationMarkdown = await authorizationMarkdownResponse.text();
      assert.match(authorizationMarkdown, /# TikTok Launch Authorization Center/);
      assert.match(authorizationMarkdown, /Robert authorized the work, but authorization is not creator permission/);
      assert.doesNotMatch(authorizationMarkdown, /\/Users\/|\/var\/folders|app\.metricool\.com\/planner/);

      for (const outreachPath of [
        "/api/clippers/real-clip-permission-outreach.html",
        "/api/clippers/real-clip-permission-outreach.md",
        "/api/clippers/real-clip-permission-outreach.csv",
        "/api/clippers/tiktok-launch-authorization.html",
        "/api/clippers/tiktok-launch-authorization.md",
        "/api/clippers/tiktok-launch-authorization.csv",
      ]) {
        const outreachPostResponse = await fetch(`http://127.0.0.1:${port}${outreachPath}`, { method: "POST" });
        assert.notEqual(outreachPostResponse.status, 200);
      }

      const nowPreviewResponse = await fetch(`http://127.0.0.1:${port}/api/clippers/evidence/scheduled-preview`, {
        method: "POST",
        body: new URLSearchParams({
          csrfToken,
          returnTo: "/api/clippers/next-metricool-action.html",
          metricoolQueueItemId: "7129d59b5f5e",
          metricoolApprovalUrl: "https://app.metricool.com/planner/now-preview-proof",
          operatorNotes: "Scheduled manually in Metricool planner from the now page.",
        }),
      });
      assert.equal(nowPreviewResponse.status, 200);
      assert.match(nowPreviewResponse.headers.get("content-type") || "", /text\/html/);
      const nowPreviewHtml = await nowPreviewResponse.text();
      assert.match(nowPreviewHtml, /Scheduled Proof Preview/);
      assert.match(nowPreviewHtml, /Preview blocked/);
      assert.match(nowPreviewHtml, /real_clip_intake_not_ready/);
      assert.doesNotMatch(nowPreviewHtml, /now-preview-proof/);
      assert.doesNotMatch(await readFile(batchEvidenceCsvPath, "utf8"), /now-preview-proof/);
      assert.equal(await readFile(batchEvidenceCsvPath, "utf8"), evidenceBeforeReadOnlyRequests);

      const missingTokenResponse = await fetch(`http://127.0.0.1:${port}/api/clippers/refresh`, { method: "POST" });
      assert.equal(missingTokenResponse.status, 403);

      const crossOriginResponse = await fetch(`http://127.0.0.1:${port}/api/clippers/refresh`, {
        method: "POST",
        headers: { origin: "https://evil.example" },
        body: new URLSearchParams({ csrfToken }),
      });
      assert.equal(crossOriginResponse.status, 403);

      const unsafeRollForwardResponse = await fetch(`http://127.0.0.1:${port}/api/clippers/roll-forward`, {
        method: "POST",
        body: new URLSearchParams({ csrfToken, leadThresholdMinutes: "-999" }),
      });
      assert.equal(unsafeRollForwardResponse.status, 409);
      const unsafeRollForward = await unsafeRollForwardResponse.json();
      assert.equal(unsafeRollForward.error, "roll_forward_safety_blocked");
      assert.ok(unsafeRollForward.blockers.includes("lead_time_above_threshold"));

      const oversizedRollForwardResponse = await fetch(`http://127.0.0.1:${port}/api/clippers/roll-forward`, {
        method: "POST",
        body: new URLSearchParams({ csrfToken, leadThresholdMinutes: "999999" }),
      });
      const oversizedRollForward = await oversizedRollForwardResponse.json();
      assert.equal(oversizedRollForward.status, "blocked");
      assert.equal(oversizedRollForward.clippers.operatorSummary.leadMinutes > 20, true);
      assert.ok(oversizedRollForward.blockers.includes("lead_time_above_threshold"));

      const externalPreviewMissingTokenResponse = await fetch(`http://127.0.0.1:${port}/api/clippers/external-evidence/preview`, { method: "POST" });
      assert.equal(externalPreviewMissingTokenResponse.status, 403);

      const externalPreviewResponse = await fetch(`http://127.0.0.1:${port}/api/clippers/external-evidence/preview`, {
        method: "POST",
        body: new URLSearchParams({ csrfToken }),
      });
      assert.equal(externalPreviewResponse.status, 200);
      const externalPreview = await externalPreviewResponse.json();
      assert.equal(externalPreview.status, "external_evidence_preview_stubbed");
      assert.equal(externalPreview.attemptsApplyReady, false);
      assert.equal(externalPreview.appliesEvidence, false);
      assert.equal(externalPreview.appliedEvidence, false);
      assert.equal(externalPreview.writesPreviewReports, false);
      assert.equal(externalPreview.externalEvidence.rows, 16);
      assert.equal(await readFile(batchEvidenceCsvPath, "utf8"), evidenceBeforeReadOnlyRequests);
      assert.equal(await readFile(externalEvidenceCsvPath, "utf8"), externalEvidenceBeforeReadOnlyRequests);

      const externalApplyMissingTokenResponse = await fetch(`http://127.0.0.1:${port}/api/clippers/external-evidence/apply-ready`, { method: "POST" });
      assert.equal(externalApplyMissingTokenResponse.status, 403);

      const externalApplyResponse = await fetch(`http://127.0.0.1:${port}/api/clippers/external-evidence/apply-ready`, {
        method: "POST",
        body: new URLSearchParams({ csrfToken }),
      });
      assert.equal(externalApplyResponse.status, 200);
      const externalApply = await externalApplyResponse.json();
      assert.equal(externalApply.status, "external_evidence_apply_ready_stubbed");
      assert.equal(externalApply.attemptsApplyReady, true);
      assert.equal(externalApply.appliesEvidence, false);
      assert.equal(externalApply.appliedEvidence, false);
      assert.equal(externalApply.writesPreviewReports, false);
      assert.equal(externalApply.externalEvidence.rows, 16);
      assert.equal(await readFile(batchEvidenceCsvPath, "utf8"), evidenceBeforeReadOnlyRequests);
      assert.equal(await readFile(externalEvidenceCsvPath, "utf8"), externalEvidenceBeforeReadOnlyRequests);

      const recordProofMissingTokenResponse = await fetch(`http://127.0.0.1:${port}/api/clippers/external-evidence/record-next-proof`, { method: "POST" });
      assert.equal(recordProofMissingTokenResponse.status, 403);

      const secretProofResponse = await fetch(`http://127.0.0.1:${port}/api/clippers/external-evidence/record-next-proof`, {
        method: "POST",
        body: new URLSearchParams({
          csrfToken,
          closeoutId: "account:streamer-pulse:tiktok",
          proofReference: "https://www.tiktok.com/@streamerpulse",
          operatorNotes: "Verified the Streamer Pulse TikTok account in the public portal today.",
          proofDetails: "This proof includes client secret super-secret and should be rejected before any file write happens.",
        }),
      });
      assert.equal(secretProofResponse.status, 400);
      assert.doesNotMatch(await readFile(nextExternalProofPath, "utf8"), /super-secret/);

      const originalExternalCloseoutEvidenceCsv = await readFile(externalCloseoutEvidenceCsvPath, "utf8");
      await writeFile(externalCloseoutEvidenceCsvPath, originalExternalCloseoutEvidenceCsv.replace(
        '"account","streamer-pulse","tiktok","verified"',
        '"account","wrong-account","tiktok","verified"',
      ));
      const mismatchedRowProofResponse = await fetch(`http://127.0.0.1:${port}/api/clippers/external-evidence/record-next-proof`, {
        method: "POST",
        body: new URLSearchParams({
          csrfToken,
          closeoutId: "account:streamer-pulse:tiktok",
          proofReference: "https://www.tiktok.com/@streamerpulse",
          operatorNotes: "Verified the Streamer Pulse TikTok account ownership and profile URL in the official TikTok portal today.",
          proofDetails: "The public profile reference is https://www.tiktok.com/@streamerpulse. This local test proof is long enough and contains no private authentication material.",
        }),
      });
      assert.equal(mismatchedRowProofResponse.status, 409);
      assert.doesNotMatch(await readFile(nextExternalProofPath, "utf8"), /evidence_recorded/);
      await writeFile(externalCloseoutEvidenceCsvPath, originalExternalCloseoutEvidenceCsv);

      const validProofResponse = await fetch(`http://127.0.0.1:${port}/api/clippers/external-evidence/record-next-proof`, {
        method: "POST",
        body: new URLSearchParams({
          csrfToken,
          closeoutId: "account:streamer-pulse:tiktok",
          proofReference: "https://www.tiktok.com/@streamerpulse",
          operatorNotes: "Verified the Streamer Pulse TikTok account ownership and profile URL in the official TikTok portal today.",
          proofDetails: [
            "The public profile reference is https://www.tiktok.com/@streamerpulse.",
            "The operator confirmed the account belongs to the Clippers streamer lane and recorded this non-secret proof locally.",
            "The record intentionally avoids private login material and includes only public profile and operator confirmation details.",
          ].join(" "),
        }),
      });
      assert.equal(validProofResponse.status, 200);
      const validProof = await validProofResponse.json();
      assert.equal(validProof.ok, true);
      assert.equal(validProof.closeoutId, "account:streamer-pulse:tiktok");
      assert.match(validProof.proofUrl, /^\/clippers-workspace\/evidence-drop\/external-closeout-proofs\/account-streamer-pulse-tiktok\.md$/);
      assert.equal(validProof.proofPath, undefined);
      assert.doesNotMatch(JSON.stringify(validProof), /\/Users\/|\/var\/folders/);
      assert.match(await readFile(nextExternalProofPath, "utf8"), /evidence_recorded/);
      assert.match(await readFile(externalCloseoutEvidenceCsvPath, "utf8"), /Verified the Streamer Pulse TikTok account ownership/);

      const prematurePublishedResponse = await fetch(`http://127.0.0.1:${port}/api/clippers/evidence/published`, {
        method: "POST",
        body: new URLSearchParams({
          csrfToken,
          metricoolQueueItemId: "7129d59b5f5e",
          publishedPostUrl: "https://www.tiktok.com/@meme/video/1234567890123456789",
          views24h: "100",
          likes24h: "10",
          comments24h: "1",
          shares24h: "1",
          operatorNotes: "Real published metrics captured after the post was live.",
        }),
      });
      assert.equal(prematurePublishedResponse.status, 409);

      const invalidEvidenceResponse = await fetch(`http://127.0.0.1:${port}/api/clippers/evidence/scheduled`, {
        method: "POST",
        body: new URLSearchParams({
          csrfToken,
          metricoolQueueItemId: "7129d59b5f5e",
          metricoolApprovalUrl: "https://example.com/not-metricool",
          operatorNotes: "Scheduled manually with specific Metricool planner notes.",
        }),
      });
      assert.equal(invalidEvidenceResponse.status, 400);

      const httpMetricoolResponse = await fetch(`http://127.0.0.1:${port}/api/clippers/evidence/scheduled`, {
        method: "POST",
        body: new URLSearchParams({
          csrfToken,
          metricoolQueueItemId: "7129d59b5f5e",
          metricoolApprovalUrl: "http://app.metricool.com/planner/test-proof",
          operatorNotes: "Scheduled manually with specific Metricool planner notes.",
        }),
      });
      assert.equal(httpMetricoolResponse.status, 400);

      const nonPlannerMetricoolResponse = await fetch(`http://127.0.0.1:${port}/api/clippers/evidence/scheduled`, {
        method: "POST",
        body: new URLSearchParams({
          csrfToken,
          metricoolQueueItemId: "7129d59b5f5e",
          metricoolApprovalUrl: "https://metricool.com/",
          operatorNotes: "Scheduled manually with specific Metricool planner notes.",
        }),
      });
      assert.equal(nonPlannerMetricoolResponse.status, 400);

      const helpMetricoolResponse = await fetch(`http://127.0.0.1:${port}/api/clippers/evidence/scheduled`, {
        method: "POST",
        body: new URLSearchParams({
          csrfToken,
          metricoolQueueItemId: "7129d59b5f5e",
          metricoolApprovalUrl: "https://help.metricool.com/planner",
          operatorNotes: "Scheduled manually with specific Metricool planner notes.",
        }),
      });
      assert.equal(helpMetricoolResponse.status, 400);

      const secretQueryMetricoolResponse = await fetch(`http://127.0.0.1:${port}/api/clippers/evidence/scheduled`, {
        method: "POST",
        body: new URLSearchParams({
          csrfToken,
          metricoolQueueItemId: "7129d59b5f5e",
          metricoolApprovalUrl: "https://app.metricool.com/planner/test-proof?token=secret-proof-token",
          operatorNotes: "Scheduled manually with specific Metricool planner notes.",
        }),
      });
      assert.equal(secretQueryMetricoolResponse.status, 400);
      assert.doesNotMatch(await readFile(batchEvidenceCsvPath, "utf8"), /secret-proof-token/);

      const hashMetricoolPreviewResponse = await fetch(`http://127.0.0.1:${port}/api/clippers/evidence/scheduled-preview`, {
        method: "POST",
        body: new URLSearchParams({
          csrfToken,
          metricoolQueueItemId: "7129d59b5f5e",
          metricoolApprovalUrl: "https://app.metricool.com/planner/test-proof#private-fragment",
          operatorNotes: "Scheduled manually with specific Metricool planner notes.",
        }),
      });
      assert.equal(hashMetricoolPreviewResponse.status, 200);
      const hashMetricoolPreview = await hashMetricoolPreviewResponse.json();
      assert.equal(hashMetricoolPreview.ok, false);
      assert.equal(hashMetricoolPreview.error, "metricool_approval_url_must_be_https_metricool_planner_url");
      assert.doesNotMatch(JSON.stringify(hashMetricoolPreview), /private-fragment/);
      assert.doesNotMatch(await readFile(batchEvidenceCsvPath, "utf8"), /private-fragment/);

      const multilineNotesResponse = await fetch(`http://127.0.0.1:${port}/api/clippers/evidence/scheduled`, {
        method: "POST",
        body: new URLSearchParams({
          csrfToken,
          metricoolQueueItemId: "7129d59b5f5e",
          metricoolApprovalUrl: "https://app.metricool.com/planner/local-alpha-row",
          operatorNotes: "Scheduled manually in Metricool.\nSecond line should be rejected.",
        }),
      });
      assert.equal(multilineNotesResponse.status, 400);

      const scheduledTikTokNotesResponse = await fetch(`http://127.0.0.1:${port}/api/clippers/evidence/scheduled`, {
        method: "POST",
        body: new URLSearchParams({
          csrfToken,
          metricoolQueueItemId: "7129d59b5f5e",
          metricoolApprovalUrl: "https://app.metricool.com/planner/local-alpha-row",
          operatorNotes: "Scheduled manually but already live https://www.tiktok.com/@meme/video/1234567890123456789.",
        }),
      });
      assert.equal(scheduledTikTokNotesResponse.status, 400);

      const scheduledTikTokShortNotesResponse = await fetch(`http://127.0.0.1:${port}/api/clippers/evidence/scheduled`, {
        method: "POST",
        body: new URLSearchParams({
          csrfToken,
          metricoolQueueItemId: "ef11cfd492f0",
          metricoolApprovalUrl: "https://app.metricool.com/planner/test-proof",
          operatorNotes: "Scheduled manually with short link https://vm.tiktok.com/abc after review.",
        }),
      });
      assert.equal(scheduledTikTokShortNotesResponse.status, 400);

      const scheduledTikTokProfileNotesResponse = await fetch(`http://127.0.0.1:${port}/api/clippers/evidence/scheduled`, {
        method: "POST",
        body: new URLSearchParams({
          csrfToken,
          metricoolQueueItemId: "ef11cfd492f0",
          metricoolApprovalUrl: "https://app.metricool.com/planner/test-proof",
          operatorNotes: "Scheduled manually for profile https://www.tiktok.com/@meme after review.",
        }),
      });
      assert.equal(scheduledTikTokProfileNotesResponse.status, 400);

      const scheduledMetricsNotesResponse = await fetch(`http://127.0.0.1:${port}/api/clippers/evidence/scheduled`, {
        method: "POST",
        body: new URLSearchParams({
          csrfToken,
          metricoolQueueItemId: "ef11cfd492f0",
          metricoolApprovalUrl: "https://app.metricool.com/planner/test-proof",
          operatorNotes: "Scheduled manually in Metricool planner with views 100 already.",
        }),
      });
      assert.equal(scheduledMetricsNotesResponse.status, 400);

      const scheduledReverseMetricsNotesResponse = await fetch(`http://127.0.0.1:${port}/api/clippers/evidence/scheduled`, {
        method: "POST",
        body: new URLSearchParams({
          csrfToken,
          metricoolQueueItemId: "ef11cfd492f0",
          metricoolApprovalUrl: "https://app.metricool.com/planner/test-proof",
          operatorNotes: "Scheduled manually in Metricool planner with 100 views and 10 likes.",
        }),
      });
      assert.equal(scheduledReverseMetricsNotesResponse.status, 400);

      const prematurePublishedBatchResponse = await fetch(`http://127.0.0.1:${port}/api/clippers/evidence/published-batch`, {
        method: "POST",
        body: new URLSearchParams({
          csrfToken,
          publishedEvidenceBatch: [
            "metricool_queue_item_id,published_post_url,views_24h,likes_24h,comments_24h,shares_24h,operator_notes",
            "53467d8f7dad,https://www.tiktok.com/@meme/video/1234567890123456789,100,10,1,1,Real published metrics captured after the post was live.",
          ].join("\n"),
        }),
      });
      assert.equal(prematurePublishedBatchResponse.status, 409);

      const scheduledSinglePreviewResponse = await fetch(`http://127.0.0.1:${port}/api/clippers/evidence/scheduled-preview`, {
        method: "POST",
        body: new URLSearchParams({
          csrfToken,
          metricoolQueueItemId: "7129d59b5f5e",
          metricoolApprovalUrl: "https://app.metricool.com/planner/single-preview-proof",
          operatorNotes: "Scheduled manually in Metricool planner for single preview row.",
        }),
      });
      assert.equal(scheduledSinglePreviewResponse.status, 200);
      const scheduledSinglePreview = await scheduledSinglePreviewResponse.json();
      assert.equal(scheduledSinglePreview.ok, false);
      assert.equal(scheduledSinglePreview.error, "real_clip_intake_not_ready");
      assert.doesNotMatch(JSON.stringify(scheduledSinglePreview), /single-preview-proof/);
      assert.doesNotMatch(await readFile(batchEvidenceCsvPath, "utf8"), /single-preview-proof/);

      const scheduledBatchSecretQueryPreviewResponse = await fetch(`http://127.0.0.1:${port}/api/clippers/evidence/scheduled-batch-preview`, {
        method: "POST",
        body: new URLSearchParams({
          csrfToken,
          scheduledEvidenceBatch: [
            "metricool_queue_item_id,metricool_approval_url,operator_notes",
            "7129d59b5f5e,https://app.metricool.com/planner/preview-proof-one?token=batch-secret-token,Scheduled manually in Metricool planner for preview row one.",
          ].join("\n"),
        }),
      });
      assert.equal(scheduledBatchSecretQueryPreviewResponse.status, 200);
      const scheduledBatchSecretQueryPreview = await scheduledBatchSecretQueryPreviewResponse.json();
      assert.equal(scheduledBatchSecretQueryPreview.ok, false);
      assert.equal(scheduledBatchSecretQueryPreview.error, "metricool_approval_url_must_be_https_metricool_planner_url");
      assert.doesNotMatch(JSON.stringify(scheduledBatchSecretQueryPreview), /batch-secret-token/);
      assert.doesNotMatch(await readFile(batchEvidenceCsvPath, "utf8"), /batch-secret-token/);

      const scheduledPreviewResponse = await fetch(`http://127.0.0.1:${port}/api/clippers/evidence/scheduled-batch-preview`, {
        method: "POST",
        body: new URLSearchParams({
          csrfToken,
          scheduledEvidenceBatch: [
            "metricool_queue_item_id,metricool_approval_url,operator_notes",
            "7129d59b5f5e,https://app.metricool.com/planner/preview-proof-one,Scheduled manually in Metricool planner for preview row one.",
          ].join("\n"),
        }),
      });
      assert.equal(scheduledPreviewResponse.status, 200);
      const scheduledPreview = await scheduledPreviewResponse.json();
      assert.equal(scheduledPreview.ok, false);
      assert.equal(scheduledPreview.error, "real_clip_intake_not_ready");
      assert.doesNotMatch(JSON.stringify(scheduledPreview), /preview-proof-one/);
      assert.doesNotMatch(await readFile(batchEvidenceCsvPath, "utf8"), /preview-proof-one/);

      const scheduledPreviewHtmlResponse = await fetch(`http://127.0.0.1:${port}/api/clippers/evidence/scheduled-batch-preview`, {
        method: "POST",
        body: new URLSearchParams({
          csrfToken,
          returnTo: "/clippers",
          scheduledEvidenceBatch: [
            "metricool_queue_item_id,metricool_approval_url,operator_notes",
            "7129d59b5f5e,https://app.metricool.com/planner/html-preview-proof,Scheduled manually in Metricool planner for HTML preview row.",
          ].join("\n"),
        }),
      });
      assert.equal(scheduledPreviewHtmlResponse.status, 200);
      assert.match(scheduledPreviewHtmlResponse.headers.get("content-type") || "", /text\/html/);
      const scheduledPreviewHtml = await scheduledPreviewHtmlResponse.text();
      assert.match(scheduledPreviewHtml, /Scheduled Proof Batch Preview/);
      assert.match(scheduledPreviewHtml, /Preview blocked/);
      assert.match(scheduledPreviewHtml, /real_clip_intake_not_ready/);
      assert.doesNotMatch(scheduledPreviewHtml, /html-preview-proof/);
      assert.doesNotMatch(await readFile(batchEvidenceCsvPath, "utf8"), /html-preview-proof/);

      const prematurePublishedPreviewResponse = await fetch(`http://127.0.0.1:${port}/api/clippers/evidence/published-batch-preview`, {
        method: "POST",
        body: new URLSearchParams({
          csrfToken,
          publishedEvidenceBatch: [
            "metricool_queue_item_id,published_post_url,views_24h,likes_24h,comments_24h,shares_24h,operator_notes",
            "53467d8f7dad,https://www.tiktok.com/@meme/video/1234567890123456789,100,10,1,1,Real published metrics captured after the post was live.",
          ].join("\n"),
        }),
      });
      assert.equal(prematurePublishedPreviewResponse.status, 200);
      const prematurePublishedPreview = await prematurePublishedPreviewResponse.json();
      assert.equal(prematurePublishedPreview.statusCode, 409);
      assert.equal(prematurePublishedPreview.error, "scheduled_metricool_evidence_required_before_published");

      const invalidBatchEvidenceResponse = await fetch(`http://127.0.0.1:${port}/api/clippers/evidence/scheduled-batch`, {
        method: "POST",
        body: new URLSearchParams({
          csrfToken,
          scheduledEvidenceBatch: [
            "metricool_queue_item_id,metricool_approval_url,operator_notes",
            "7129d59b5f5e,https://app.metricool.com/planner/batch-proof-one,Scheduled manually in Metricool planner for SPORT row two.",
            "53467d8f7dad,https://example.com/not-metricool,Scheduled manually in Metricool planner for Meme Radar row one.",
          ].join("\n"),
        }),
      });
      assert.equal(invalidBatchEvidenceResponse.status, 400);
      const unchangedAfterInvalidBatch = await readFile(batchEvidenceCsvPath, "utf8");
      assert.doesNotMatch(unchangedAfterInvalidBatch, /batch-proof-one/);

      const duplicateScheduledBatchResponse = await fetch(`http://127.0.0.1:${port}/api/clippers/evidence/scheduled-batch`, {
        method: "POST",
        body: new URLSearchParams({
          csrfToken,
          scheduledEvidenceBatch: [
            "metricool_queue_item_id,metricool_approval_url,operator_notes",
            "7129d59b5f5e,https://app.metricool.com/planner/duplicate-proof,Scheduled manually in Metricool planner for SPORT row two.",
            "53467d8f7dad,https://app.metricool.com/planner/duplicate-proof,Scheduled manually in Metricool planner for Meme Radar row one.",
          ].join("\n"),
        }),
      });
      assert.equal(duplicateScheduledBatchResponse.status, 400);
      const duplicateScheduledBatch = await duplicateScheduledBatchResponse.json();
      assert.equal(duplicateScheduledBatch.error, "duplicate_metricool_approval_url");
      assert.doesNotMatch(await readFile(batchEvidenceCsvPath, "utf8"), /duplicate-proof/);

      const validBatchEvidenceResponse = await fetch(`http://127.0.0.1:${port}/api/clippers/evidence/scheduled-batch`, {
        method: "POST",
        body: new URLSearchParams({
          csrfToken,
          scheduledEvidenceBatch: [
            "metricool_queue_item_id,metricool_approval_url,operator_notes",
            "7129d59b5f5e,https://app.metricool.com/planner/batch-proof-two,Scheduled manually in Metricool planner for SPORT row two.",
            "53467d8f7dad,https://app.metricool.com/planner/batch-proof-one,Scheduled manually in Metricool planner for Meme Radar row one.",
          ].join("\n"),
        }),
      });
      assert.equal(validBatchEvidenceResponse.status, 409);
      const validBatchEvidence = await validBatchEvidenceResponse.json();
      assert.equal(validBatchEvidence.error, "real_clip_intake_not_ready");
      const updatedBatchEvidenceCsv = await readFile(batchEvidenceCsvPath, "utf8");
      assert.doesNotMatch(updatedBatchEvidenceCsv, /batch-proof-one/);
      assert.doesNotMatch(updatedBatchEvidenceCsv, /batch-proof-two/);
      assert.doesNotMatch(updatedBatchEvidenceCsv, /https:\/\/www\.tiktok\.com\/@/);

      const replaceScheduledResponse = await fetch(`http://127.0.0.1:${port}/api/clippers/evidence/scheduled`, {
        method: "POST",
        body: new URLSearchParams({
          csrfToken,
          metricoolQueueItemId: "53467d8f7dad",
          metricoolApprovalUrl: "https://app.metricool.com/planner/replace-scheduled-proof",
          operatorNotes: "Scheduled manually in Metricool planner but this row already has proof.",
        }),
      });
      assert.equal(replaceScheduledResponse.status, 409);
      const replaceScheduled = await replaceScheduledResponse.json();
      assert.equal(replaceScheduled.error, "scheduled_proof_deadline_order_required");
      assert.doesNotMatch(await readFile(batchEvidenceCsvPath, "utf8"), /replace-scheduled-proof/);

      const replaceScheduledBatchPreviewResponse = await fetch(`http://127.0.0.1:${port}/api/clippers/evidence/scheduled-batch-preview`, {
        method: "POST",
        body: new URLSearchParams({
          csrfToken,
          scheduledEvidenceBatch: [
            "metricool_queue_item_id,metricool_approval_url,operator_notes",
            "53467d8f7dad,https://app.metricool.com/planner/replace-scheduled-proof,Scheduled manually in Metricool planner but this row already has proof.",
          ].join("\n"),
        }),
      });
      assert.equal(replaceScheduledBatchPreviewResponse.status, 200);
      const replaceScheduledBatchPreview = await replaceScheduledBatchPreviewResponse.json();
      assert.equal(replaceScheduledBatchPreview.error, "scheduled_proof_deadline_order_required");

      const duplicateExistingScheduledResponse = await fetch(`http://127.0.0.1:${port}/api/clippers/evidence/scheduled`, {
        method: "POST",
        body: new URLSearchParams({
          csrfToken,
          metricoolQueueItemId: "ef11cfd492f0",
          metricoolApprovalUrl: "https://app.metricool.com/planner/batch-proof-one",
          operatorNotes: "Scheduled manually in Metricool planner but this duplicates row one.",
        }),
      });
      assert.equal(duplicateExistingScheduledResponse.status, 409);
      const duplicateExistingScheduled = await duplicateExistingScheduledResponse.json();
      assert.equal(duplicateExistingScheduled.error, "scheduled_proof_deadline_order_required");

      const validPublishedPreviewResponse = await fetch(`http://127.0.0.1:${port}/api/clippers/evidence/published-batch-preview`, {
        method: "POST",
        body: new URLSearchParams({
          csrfToken,
          publishedEvidenceBatch: [
            "metricool_queue_item_id,published_post_url,views_24h,likes_24h,comments_24h,shares_24h,operator_notes",
            "53467d8f7dad,https://www.tiktok.com/@meme/video/1234567890123456789,100,10,1,1,Real published metrics captured after the post was live.",
          ].join("\n"),
        }),
      });
      assert.equal(validPublishedPreviewResponse.status, 200);
      const validPublishedPreview = await validPublishedPreviewResponse.json();
      assert.equal(validPublishedPreview.ok, false);
      assert.equal(validPublishedPreview.error, "scheduled_metricool_evidence_required_before_published");
      assert.doesNotMatch(JSON.stringify(validPublishedPreview), /1234567890123456789/);
      assert.doesNotMatch(await readFile(batchEvidenceCsvPath, "utf8"), /1234567890123456789/);

      const validPublishedPreviewHtmlResponse = await fetch(`http://127.0.0.1:${port}/api/clippers/evidence/published-batch-preview`, {
        method: "POST",
        body: new URLSearchParams({
          csrfToken,
          returnTo: "/clippers",
          publishedEvidenceBatch: [
            "metricool_queue_item_id,published_post_url,views_24h,likes_24h,comments_24h,shares_24h,operator_notes",
            "53467d8f7dad,https://www.tiktok.com/@meme/video/2234567890123456789,100,10,1,1,Real published metrics captured after the post was live.",
          ].join("\n"),
        }),
      });
      assert.equal(validPublishedPreviewHtmlResponse.status, 200);
      assert.match(validPublishedPreviewHtmlResponse.headers.get("content-type") || "", /text\/html/);
      const validPublishedPreviewHtml = await validPublishedPreviewHtmlResponse.text();
      assert.match(validPublishedPreviewHtml, /Published Metrics Batch Preview/);
      assert.match(validPublishedPreviewHtml, /Preview blocked/);
      assert.match(validPublishedPreviewHtml, /scheduled_metricool_evidence_required_before_published/);
      assert.doesNotMatch(validPublishedPreviewHtml, /2234567890123456789/);
      assert.doesNotMatch(await readFile(batchEvidenceCsvPath, "utf8"), /2234567890123456789/);

      const invalidPublishedBatchResponse = await fetch(`http://127.0.0.1:${port}/api/clippers/evidence/published-batch`, {
        method: "POST",
        body: new URLSearchParams({
          csrfToken,
          publishedEvidenceBatch: [
            "metricool_queue_item_id,published_post_url,views_24h,likes_24h,comments_24h,shares_24h,operator_notes",
            "53467d8f7dad,https://www.tiktok.com/@meme/video/1234567890123456789,100,10,1,1,Real published metrics captured after the post was live.",
            "7129d59b5f5e,https://www.tiktok.com/search?q=bad,100,10,1,1,Real published metrics captured after the post was live.",
          ].join("\n"),
        }),
      });
      assert.equal(invalidPublishedBatchResponse.status, 409);
      assert.equal((await invalidPublishedBatchResponse.json()).error, "published_metrics_preview_confirmation_required");
      const unchangedAfterInvalidPublishedBatch = await readFile(batchEvidenceCsvPath, "utf8");
      assert.doesNotMatch(unchangedAfterInvalidPublishedBatch, /1234567890123456789/);

      const duplicatePublishedBatchResponse = await fetch(`http://127.0.0.1:${port}/api/clippers/evidence/published-batch`, {
        method: "POST",
        body: new URLSearchParams({
          csrfToken,
          publishedEvidenceBatch: [
            "metricool_queue_item_id,published_post_url,views_24h,likes_24h,comments_24h,shares_24h,operator_notes",
            "53467d8f7dad,https://www.tiktok.com/@meme/video/3334567890123456789,100,10,1,1,Real published metrics captured after the post was live.",
            "7129d59b5f5e,https://www.tiktok.com/@meme/video/3334567890123456789,200,20,2,2,Real published metrics captured after the post was live.",
          ].join("\n"),
        }),
      });
      assert.equal(duplicatePublishedBatchResponse.status, 409);
      const duplicatePublishedBatch = await duplicatePublishedBatchResponse.json();
      assert.equal(duplicatePublishedBatch.error, "published_metrics_preview_confirmation_required");
      assert.doesNotMatch(await readFile(batchEvidenceCsvPath, "utf8"), /3334567890123456789/);

      for (const invalidPublishedBatch of [
        {
          url: "https://ads.tiktok.com/@meme/video/1234567890123456789",
          views: "100",
          likes: "10",
          expected: "ads-tiktok-host",
        },
        {
          url: "https://www.tiktok.com/@meme/video/1234567890123456789?x=1",
          views: "100",
          likes: "10",
          expected: "tiktok-query",
        },
        {
          url: "https://www.tiktok.com/@meme/video/1234567890123456789",
          views: "0",
          likes: "10",
          expected: "zero-views",
        },
        {
          url: "https://www.tiktok.com/@meme/video/1234567890123456789",
          views: "100",
          likes: "-1",
          expected: "negative-likes",
        },
        {
          url: "https://www.tiktok.com/@meme/video/1234567890123456789",
          views: "100.5",
          likes: "10",
          expected: "decimal-views",
        },
      ]) {
        const invalidMetricResponse = await fetch(`http://127.0.0.1:${port}/api/clippers/evidence/published-batch`, {
          method: "POST",
          body: new URLSearchParams({
            csrfToken,
            publishedEvidenceBatch: [
              "metricool_queue_item_id,published_post_url,views_24h,likes_24h,comments_24h,shares_24h,operator_notes",
              `53467d8f7dad,${invalidPublishedBatch.url},${invalidPublishedBatch.views},${invalidPublishedBatch.likes},1,1,Real published metrics captured after the post was live for ${invalidPublishedBatch.expected}.`,
            ].join("\n"),
          }),
        });
        assert.equal(invalidMetricResponse.status, 409);
        assert.equal((await invalidMetricResponse.json()).error, "published_metrics_preview_confirmation_required");
      }

      const validPublishedBatchResponse = await fetch(`http://127.0.0.1:${port}/api/clippers/evidence/published-batch`, {
        method: "POST",
        body: new URLSearchParams({
          csrfToken,
          publishedEvidenceBatch: [
            "metricool_queue_item_id,published_post_url,views_24h,likes_24h,comments_24h,shares_24h,operator_notes",
            "53467d8f7dad,https://www.tiktok.com/@meme/video/1234567890123456789,\"1,000\",10,1,1,Real published metrics captured after the post was live.",
            "7129d59b5f5e,https://www.tiktok.com/@sportsdaily/video/2234567890123456789,200,20,2,2,Real published metrics captured after the post was live.",
          ].join("\n"),
        }),
      });
      assert.equal(validPublishedBatchResponse.status, 409);
      const validPublishedBatch = await validPublishedBatchResponse.json();
      assert.equal(validPublishedBatch.error, "published_metrics_preview_confirmation_required");
      const publishedBatchEvidenceCsv = await readFile(batchEvidenceCsvPath, "utf8");
      assert.doesNotMatch(publishedBatchEvidenceCsv, /1234567890123456789/);
      assert.doesNotMatch(publishedBatchEvidenceCsv, /2234567890123456789/);

      const reschedulePublishedResponse = await fetch(`http://127.0.0.1:${port}/api/clippers/evidence/scheduled`, {
        method: "POST",
        body: new URLSearchParams({
          csrfToken,
          metricoolQueueItemId: "53467d8f7dad",
          metricoolApprovalUrl: "https://app.metricool.com/planner/reschedule-published-proof",
          operatorNotes: "Scheduled manually in Metricool planner but this row already has public metrics.",
        }),
      });
      assert.equal(reschedulePublishedResponse.status, 409);
      const reschedulePublished = await reschedulePublishedResponse.json();
      assert.equal(reschedulePublished.error, "scheduled_proof_deadline_order_required");
      assert.doesNotMatch(await readFile(batchEvidenceCsvPath, "utf8"), /reschedule-published-proof/);
      assert.doesNotMatch(await readFile(batchEvidenceCsvPath, "utf8"), /1234567890123456789/);

      const reschedulePublishedBatchPreviewResponse = await fetch(`http://127.0.0.1:${port}/api/clippers/evidence/scheduled-batch-preview`, {
        method: "POST",
        body: new URLSearchParams({
          csrfToken,
          scheduledEvidenceBatch: [
            "metricool_queue_item_id,metricool_approval_url,operator_notes",
            "53467d8f7dad,https://app.metricool.com/planner/reschedule-published-proof,Scheduled manually in Metricool planner but this row already has public metrics.",
          ].join("\n"),
        }),
      });
      assert.equal(reschedulePublishedBatchPreviewResponse.status, 200);
      const reschedulePublishedBatchPreview = await reschedulePublishedBatchPreviewResponse.json();
      assert.equal(reschedulePublishedBatchPreview.error, "scheduled_proof_deadline_order_required");

      const scheduledThirdRowResponse = await fetch(`http://127.0.0.1:${port}/api/clippers/evidence/scheduled`, {
        method: "POST",
        body: new URLSearchParams({
          csrfToken,
          metricoolQueueItemId: "ef11cfd492f0",
          metricoolApprovalUrl: "https://app.metricool.com/planner/batch-proof-three",
          operatorNotes: "Scheduled manually in Metricool planner for duplicate URL regression test.",
        }),
      });
      assert.equal(scheduledThirdRowResponse.status, 409);
      const scheduledThirdRow = await scheduledThirdRowResponse.json();
      assert.equal(scheduledThirdRow.error, "scheduled_proof_deadline_order_required");
      assert.doesNotMatch(await readFile(batchEvidenceCsvPath, "utf8"), /batch-proof-three/);

      const duplicateExistingPublishedResponse = await fetch(`http://127.0.0.1:${port}/api/clippers/evidence/published`, {
        method: "POST",
        body: new URLSearchParams({
          csrfToken,
          metricoolQueueItemId: "ef11cfd492f0",
          publishedPostUrl: "https://www.tiktok.com/@meme/video/1234567890123456789",
          views24h: "300",
          likes24h: "30",
          comments24h: "3",
          shares24h: "3",
          operatorNotes: "Real published metrics captured after the post was live but duplicate URL.",
        }),
      });
      assert.equal(duplicateExistingPublishedResponse.status, 409);
      const duplicateExistingPublished = await duplicateExistingPublishedResponse.json();
      assert.equal(duplicateExistingPublished.error, "published_metrics_preview_confirmation_required");

      const replacePublishedResponse = await fetch(`http://127.0.0.1:${port}/api/clippers/evidence/published`, {
        method: "POST",
        body: new URLSearchParams({
          csrfToken,
          metricoolQueueItemId: "7129d59b5f5e",
          publishedPostUrl: "https://www.tiktok.com/@meme/video/4234567890123456789",
          views24h: "999",
          likes24h: "99",
          comments24h: "9",
          shares24h: "9",
          operatorNotes: "Real published metrics captured after the post was live but should not replace prior metrics.",
        }),
      });
      assert.equal(replacePublishedResponse.status, 409);
      const replacePublished = await replacePublishedResponse.json();
      assert.equal(replacePublished.error, "published_metrics_preview_confirmation_required");
      const unchangedAfterReplacePublished = await readFile(batchEvidenceCsvPath, "utf8");
      assert.doesNotMatch(unchangedAfterReplacePublished, /1234567890123456789/);
      assert.doesNotMatch(unchangedAfterReplacePublished, /4234567890123456789/);

      const replacePublishedBatchPreviewResponse = await fetch(`http://127.0.0.1:${port}/api/clippers/evidence/published-batch-preview`, {
        method: "POST",
        body: new URLSearchParams({
          csrfToken,
          publishedEvidenceBatch: [
            "metricool_queue_item_id,published_post_url,views_24h,likes_24h,comments_24h,shares_24h,operator_notes",
            "53467d8f7dad,https://www.tiktok.com/@meme/video/4234567890123456789,999,99,9,9,Real published metrics captured after the post was live but should not replace prior metrics.",
          ].join("\n"),
        }),
      });
      assert.equal(replacePublishedBatchPreviewResponse.status, 200);
      const replacePublishedBatchPreview = await replacePublishedBatchPreviewResponse.json();
      assert.equal(replacePublishedBatchPreview.ok, false);
      assert.equal(replacePublishedBatchPreview.error, "scheduled_metricool_evidence_required_before_published");
      assert.doesNotMatch(await readFile(batchEvidenceCsvPath, "utf8"), /4234567890123456789/);
      await writeFile(batchEvidenceCsvPath, originalEvidenceCsv);

      const validEvidenceResponse = await fetch(`http://127.0.0.1:${port}/api/clippers/evidence/scheduled`, {
        method: "POST",
        body: new URLSearchParams({
          csrfToken,
          metricoolQueueItemId: "7129d59b5f5e",
          metricoolApprovalUrl: "https://app.metricool.com/planner/local-alpha-row",
          operatorNotes: "Scheduled manually in Metricool planner during local operator test.",
        }),
      });
      assert.equal(validEvidenceResponse.status, 409, JSON.stringify(await validEvidenceResponse.clone().json()));
      const validEvidence = await validEvidenceResponse.json();
      assert.equal(validEvidence.error, "real_clip_intake_not_ready");
      const updatedEvidenceCsv = await readFile(batchEvidenceCsvPath, "utf8");
      assert.doesNotMatch(updatedEvidenceCsv, /https:\/\/app\.metricool\.com\/planner\/local-alpha-row/);
      assert.doesNotMatch(updatedEvidenceCsv, /https:\/\/www\.tiktok\.com\/@/);

      const auditLog = await readFile(operatorAuditLogPath, "utf8");
      const auditEntries = auditLog.trim().split("\n").map((line) => JSON.parse(line));
      assert.ok(auditEntries.some((entry) => entry.action === "scheduled_single" && entry.result.error === "metricool_approval_url_must_be_https_metricool_planner_url"));
      assert.ok(auditEntries.some((entry) => entry.action === "scheduled_batch" && entry.result.error === "real_clip_intake_not_ready"));
      assert.doesNotMatch(auditLog, /"action":"published_batch"/);
      assert.doesNotMatch(auditLog, /https:\/\/app\.metricool\.com\/planner\/test-proof/);
      assert.doesNotMatch(auditLog, /https:\/\/www\.tiktok\.com\/@meme\/video\/1234567890123456789/);
      assert.doesNotMatch(auditLog, /Scheduled manually in Metricool planner during local operator test/);
      assert.match(auditLog, /"pathHash"/);
      const statusAfterAuditResponse = await fetch(`http://127.0.0.1:${port}/api/clippers/status`);
      assert.equal(statusAfterAuditResponse.status, 200);
      const statusAfterAudit = await statusAfterAuditResponse.json();
      assert.equal(statusAfterAudit.operatorAudit.status, "ready");
      assert.equal(statusAfterAudit.operatorAudit.events, auditEntries.length);
      assert.equal(statusAfterAudit.operatorAudit.rejected > 0, true);
      assert.equal(statusAfterAudit.operatorAudit.lastEvent.metricoolQueueItemId, "7129d59b5f5e");
      assert.doesNotMatch(JSON.stringify(statusAfterAudit.operatorAudit), /https:\/\/app\.metricool\.com\/planner\/test-proof/);
      assert.doesNotMatch(JSON.stringify(statusAfterAudit.operatorAudit), /Scheduled manually in Metricool planner during local operator test/);

      const invalidPublishedResponse = await fetch(`http://127.0.0.1:${port}/api/clippers/evidence/published`, {
        method: "POST",
        body: new URLSearchParams({
          csrfToken,
          metricoolQueueItemId: "53467d8f7dad",
          publishedPostUrl: "https://www.tiktok.com/search?q=bad",
          views24h: "100",
          likes24h: "10",
          comments24h: "1",
          shares24h: "1",
          operatorNotes: "Real published metrics captured after the post was live.",
        }),
      });
      assert.equal(invalidPublishedResponse.status, 409);
      assert.equal((await invalidPublishedResponse.json()).error, "published_metrics_preview_confirmation_required");

      const httpTikTokResponse = await fetch(`http://127.0.0.1:${port}/api/clippers/evidence/published`, {
        method: "POST",
        body: new URLSearchParams({
          csrfToken,
          metricoolQueueItemId: "53467d8f7dad",
          publishedPostUrl: "http://www.tiktok.com/@meme/video/1234567890123456789",
          views24h: "100",
          likes24h: "10",
          comments24h: "1",
          shares24h: "1",
          operatorNotes: "Real published metrics captured after the post was live.",
        }),
      });
      assert.equal(httpTikTokResponse.status, 409);
      assert.equal((await httpTikTokResponse.json()).error, "published_metrics_preview_confirmation_required");

      const profileTikTokResponse = await fetch(`http://127.0.0.1:${port}/api/clippers/evidence/published`, {
        method: "POST",
        body: new URLSearchParams({
          csrfToken,
          metricoolQueueItemId: "53467d8f7dad",
          publishedPostUrl: "https://www.tiktok.com/@meme",
          views24h: "100",
          likes24h: "10",
          comments24h: "1",
          shares24h: "1",
          operatorNotes: "Real published metrics captured after the post was live.",
        }),
      });
      assert.equal(profileTikTokResponse.status, 409);
      assert.equal((await profileTikTokResponse.json()).error, "published_metrics_preview_confirmation_required");

      const validPublishedResponse = await fetch(`http://127.0.0.1:${port}/api/clippers/evidence/published`, {
        method: "POST",
        body: new URLSearchParams({
          csrfToken,
          metricoolQueueItemId: "7129d59b5f5e",
          publishedPostUrl: "https://www.tiktok.com/@sportsdaily/video/1234567890123456789",
          views24h: "100",
          likes24h: "10",
          comments24h: "1",
          shares24h: "1",
          operatorNotes: "Real published metrics captured after the post was live.",
        }),
      });
      assert.equal(validPublishedResponse.status, 409);
      const publishedEvidence = await validPublishedResponse.json();
      assert.equal(publishedEvidence.error, "published_metrics_preview_confirmation_required");
      const publishedEvidenceCsv = await readFile(batchEvidenceCsvPath, "utf8");
      assert.doesNotMatch(publishedEvidenceCsv, /https:\/\/www\.tiktok\.com\/@sportsdaily\/video\/1234567890123456789/);
      await writeFile(batchEvidenceCsvPath, originalEvidenceCsv);

      const redirectEvidenceResponse = await fetch(`http://127.0.0.1:${port}/api/clippers/evidence/scheduled`, {
        method: "POST",
        redirect: "manual",
        body: new URLSearchParams({
          csrfToken,
          returnTo: "/clippers",
          metricoolQueueItemId: "7129d59b5f5e",
          metricoolApprovalUrl: "https://app.metricool.com/planner/local-redirect-row",
          operatorNotes: "Scheduled manually in Metricool planner during local operator test.",
        }),
      });
      assert.equal(redirectEvidenceResponse.status, 409);
      const redirectEvidence = await redirectEvidenceResponse.json();
      assert.equal(redirectEvidence.error, "real_clip_intake_not_ready");
      assert.doesNotMatch(await readFile(batchEvidenceCsvPath, "utf8"), /local-redirect-row/);
      await writeFile(batchEvidenceCsvPath, originalEvidenceCsv);

      const refreshResponse = await fetch(`http://127.0.0.1:${port}/api/clippers/refresh`, { method: "POST" });
      assert.equal(refreshResponse.status, 403);
      const authorizedRefreshResponse = await fetch(`http://127.0.0.1:${port}/api/clippers/refresh`, {
        method: "POST",
        body: new URLSearchParams({ csrfToken }),
      });
      assert.equal(authorizedRefreshResponse.status, 200);
      const refresh = await authorizedRefreshResponse.json();
      assert.equal(refresh.status, "refreshed");
      assert.equal(refresh.steps.length, 8);
      assert.ok(refresh.steps.every((step) => step.status === "stubbed"));
      assert.equal(refresh.clippers.realPublishEnabled, false);
      await writeFile(masterEvidenceCsvPath, originalMasterEvidenceCsv);

      const workbookResponse = await fetch(`http://127.0.0.1:${port}/clippers-workspace/scheduled/metricool-100-current-batch-workbook.csv`);
      assert.equal(workbookResponse.status, 200);
      assert.match(await workbookResponse.text(), /metricool_queue_item_id/);

      const goalGapsJsonResponse = await fetch(`http://127.0.0.1:${port}/api/clippers/goal-gaps.json`);
      assert.equal(goalGapsJsonResponse.status, 200);
      assert.match(goalGapsJsonResponse.headers.get("content-type") || "", /application\/json/);
      const goalGapsJson = await goalGapsJsonResponse.json();
      assert.equal(goalGapsJson.status, "not_complete");
      assert.equal(goalGapsJson.complete, false);
      assert.equal(goalGapsJson.scope, "tiktok_metricool_only");
      assert.ok(goalGapsJson.blockers.includes("missing_metricool_scheduled_proof_10"));
      assert.ok(goalGapsJson.blockers.includes("public_tiktok_urls_or_24h_metrics_not_ready"));
      assert.equal(goalGapsJson.provenReady.find((row) => row.id === "upload_pack").status, "ready");
      assert.equal(goalGapsJson.missingExternalProof.find((row) => row.id === "metricool_scheduled_proof").status, "blocked");
      assert.equal(goalGapsJson.deferredScope.find((row) => row.id === "direct_tiktok_apis").status, "deferred_not_required");
      assert.match(goalGapsJson.nextAction, /real clip intake|blocked by missing files/i);
      assert.doesNotMatch(JSON.stringify(goalGapsJson), /app\.metricool\.com\/planner\/[A-Za-z0-9]|published_post_url|metricool_approval_url/);

      const goalGapsMarkdownResponse = await fetch(`http://127.0.0.1:${port}/api/clippers/goal-gaps.md`);
      assert.equal(goalGapsMarkdownResponse.status, 200);
      assert.match(goalGapsMarkdownResponse.headers.get("content-type") || "", /text\/markdown/);
      assert.match(goalGapsMarkdownResponse.headers.get("content-disposition") || "", /clippers-goal-gaps\.md/);
      const goalGapsMarkdown = await goalGapsMarkdownResponse.text();
      assert.match(goalGapsMarkdown, /# Clippers Goal Gaps/);
      assert.match(goalGapsMarkdown, /Complete: no/);
      assert.match(goalGapsMarkdown, /Missing External Proof/);
      assert.match(goalGapsMarkdown, /TikTok batch now/);
      assert.doesNotMatch(goalGapsMarkdown, /app\.metricool\.com\/planner\/[A-Za-z0-9]|published_post_url|metricool_approval_url/);

      const checklistBeforeDownload = await readFile(batchEvidenceCsvPath, "utf8");
      const uploadChecklistResponse = await fetch(`http://127.0.0.1:${port}/api/clippers/metricool-upload-checklist.csv`);
      assert.equal(uploadChecklistResponse.status, 200);
      assert.match(uploadChecklistResponse.headers.get("content-type") || "", /text\/csv/);
      assert.match(uploadChecklistResponse.headers.get("content-disposition") || "", /clippers-metricool-upload-checklist\.csv/);
      const uploadChecklistCsv = await uploadChecklistResponse.text();
      assert.match(uploadChecklistCsv, /order,metricool_queue_item_id,metricool_brand,account_name,platform,publish_at_local,publish_at_iso,upload_file_name,caption_seed,scheduled_note_template/);
      assert.match(uploadChecklistCsv, /7129d59b5f5e/);
      assert.equal(uploadChecklistCsv.trim().split("\n").length, 11);
      assert.equal(await readFile(batchEvidenceCsvPath, "utf8"), checklistBeforeDownload);

      const uploadChecklistPostResponse = await fetch(`http://127.0.0.1:${port}/api/clippers/metricool-upload-checklist.csv`, { method: "POST" });
      assert.notEqual(uploadChecklistPostResponse.status, 200);
      assert.doesNotMatch(uploadChecklistPostResponse.headers.get("content-type") || "", /text\/csv/);

      const scheduledProofBeforeDownload = await readFile(batchEvidenceCsvPath, "utf8");
      const scheduledProofStarterResponse = await fetch(`http://127.0.0.1:${port}/api/clippers/scheduled-proof-starter.csv`);
      assert.equal(scheduledProofStarterResponse.status, 200);
      assert.match(scheduledProofStarterResponse.headers.get("content-type") || "", /text\/csv/);
      assert.match(scheduledProofStarterResponse.headers.get("content-disposition") || "", /clippers-scheduled-proof-starter\.csv/);
      const scheduledProofStarterCsv = await scheduledProofStarterResponse.text();
      assert.match(scheduledProofStarterCsv, /metricool_queue_item_id,metricool_approval_url,operator_notes/);
      assert.doesNotMatch(scheduledProofStarterCsv, /7129d59b5f5e/);
      assert.doesNotMatch(scheduledProofStarterCsv, /<paste real Metricool planner URL after scheduling>/);
      assert.equal(scheduledProofStarterCsv.trim().split("\n").length, 1);
      assert.equal(await readFile(batchEvidenceCsvPath, "utf8"), scheduledProofBeforeDownload);

      const scheduledProofStarterPostResponse = await fetch(`http://127.0.0.1:${port}/api/clippers/scheduled-proof-starter.csv`, { method: "POST" });
      assert.notEqual(scheduledProofStarterPostResponse.status, 200);
      assert.doesNotMatch(scheduledProofStarterPostResponse.headers.get("content-type") || "", /text\/csv/);

      const nextScheduledProofBeforeDownload = await readFile(batchEvidenceCsvPath, "utf8");
      const nextScheduledProofStarterResponse = await fetch(`http://127.0.0.1:${port}/api/clippers/next-scheduled-proof-starter.csv`);
      assert.equal(nextScheduledProofStarterResponse.status, 200);
      assert.match(nextScheduledProofStarterResponse.headers.get("content-type") || "", /text\/csv/);
      assert.match(nextScheduledProofStarterResponse.headers.get("content-disposition") || "", /clippers-next-scheduled-proof-starter\.csv/);
      const nextScheduledProofStarterCsv = await nextScheduledProofStarterResponse.text();
      assert.match(nextScheduledProofStarterCsv, /metricool_queue_item_id,metricool_approval_url,operator_notes/);
      assert.doesNotMatch(nextScheduledProofStarterCsv, /7129d59b5f5e/);
      assert.doesNotMatch(nextScheduledProofStarterCsv, /53467d8f7dad/);
      assert.doesNotMatch(nextScheduledProofStarterCsv, /<paste real Metricool planner URL after scheduling this exact next row>/);
      assert.equal(nextScheduledProofStarterCsv.trim().split("\n").length, 1);
      assert.equal(await readFile(batchEvidenceCsvPath, "utf8"), nextScheduledProofBeforeDownload);

      const nextScheduledProofStarterPostResponse = await fetch(`http://127.0.0.1:${port}/api/clippers/next-scheduled-proof-starter.csv`, { method: "POST" });
      assert.notEqual(nextScheduledProofStarterPostResponse.status, 200);
      assert.doesNotMatch(nextScheduledProofStarterPostResponse.headers.get("content-type") || "", /text\/csv/);

      const publishedMetricsBeforeDownload = await readFile(batchEvidenceCsvPath, "utf8");
      const publishedMetricsStarterResponse = await fetch(`http://127.0.0.1:${port}/api/clippers/published-metrics-starter.csv`);
      assert.equal(publishedMetricsStarterResponse.status, 200);
      assert.match(publishedMetricsStarterResponse.headers.get("content-type") || "", /text\/csv/);
      assert.match(publishedMetricsStarterResponse.headers.get("content-disposition") || "", /clippers-published-metrics-starter\.csv/);
      const publishedMetricsStarterCsv = await publishedMetricsStarterResponse.text();
      assert.match(publishedMetricsStarterCsv, /metricool_queue_item_id,published_post_url,views_24h,likes_24h,comments_24h,shares_24h,operator_notes/);
      assert.doesNotMatch(publishedMetricsStarterCsv, /<paste exact public TikTok video URL/);
      assert.equal(publishedMetricsStarterCsv.trim().split("\n").length, 1);
      assert.equal(await readFile(batchEvidenceCsvPath, "utf8"), publishedMetricsBeforeDownload);

      const publishedMetricsStarterPostResponse = await fetch(`http://127.0.0.1:${port}/api/clippers/published-metrics-starter.csv`, { method: "POST" });
      assert.notEqual(publishedMetricsStarterPostResponse.status, 200);
      assert.doesNotMatch(publishedMetricsStarterPostResponse.headers.get("content-type") || "", /text\/csv/);

      const nextPublishedMetricsBeforeDownload = await readFile(batchEvidenceCsvPath, "utf8");
      const nextPublishedMetricsStarterResponse = await fetch(`http://127.0.0.1:${port}/api/clippers/next-published-metrics-starter.csv`);
      assert.equal(nextPublishedMetricsStarterResponse.status, 200);
      assert.match(nextPublishedMetricsStarterResponse.headers.get("content-type") || "", /text\/csv/);
      assert.match(nextPublishedMetricsStarterResponse.headers.get("content-disposition") || "", /clippers-next-published-metrics-starter\.csv/);
      const nextPublishedMetricsStarterCsv = await nextPublishedMetricsStarterResponse.text();
      assert.match(nextPublishedMetricsStarterCsv, /metricool_queue_item_id,published_post_url,views_24h,likes_24h,comments_24h,shares_24h,operator_notes/);
      assert.doesNotMatch(nextPublishedMetricsStarterCsv, /<paste exact public TikTok video URL/);
      assert.equal(nextPublishedMetricsStarterCsv.trim().split("\n").length, 1);
      assert.equal(await readFile(batchEvidenceCsvPath, "utf8"), nextPublishedMetricsBeforeDownload);

      const nextPublishedMetricsStarterPostResponse = await fetch(`http://127.0.0.1:${port}/api/clippers/next-published-metrics-starter.csv`, { method: "POST" });
      assert.notEqual(nextPublishedMetricsStarterPostResponse.status, 200);
      assert.doesNotMatch(nextPublishedMetricsStarterPostResponse.headers.get("content-type") || "", /text\/csv/);

      const accountSummaryBeforeDownload = await readFile(batchEvidenceCsvPath, "utf8");
      const accountSummaryJsonResponse = await fetch(`http://127.0.0.1:${port}/api/clippers/tiktok-batch-account-summary.json`);
      assert.equal(accountSummaryJsonResponse.status, 200);
      assert.match(accountSummaryJsonResponse.headers.get("content-type") || "", /application\/json/);
      const accountSummaryJson = await accountSummaryJsonResponse.json();
      assert.equal(accountSummaryJson.status, "blocked_real_clip_intake");
      assert.equal(accountSummaryJson.totals.accounts, 2);
      assert.equal(accountSummaryJson.totals.totalRows, 10);
      assert.equal(accountSummaryJson.accounts.find((account) => account.accountId === "sports-daily").totalRows, 8);
      assert.equal(accountSummaryJson.accounts.find((account) => account.accountId === "meme-radar").missingScheduledProof, 2);
      assert.doesNotMatch(JSON.stringify(accountSummaryJson), /app\.metricool\.com\/planner|published_post_url|metricool_approval_url/);

      const accountSummaryCsvResponse = await fetch(`http://127.0.0.1:${port}/api/clippers/tiktok-batch-account-summary.csv`);
      assert.equal(accountSummaryCsvResponse.status, 200);
      assert.match(accountSummaryCsvResponse.headers.get("content-type") || "", /text\/csv/);
      assert.match(accountSummaryCsvResponse.headers.get("content-disposition") || "", /clippers-tiktok-batch-account-summary\.csv/);
      const accountSummaryCsv = await accountSummaryCsvResponse.text();
      assert.match(accountSummaryCsv, /account_id,brand,account_name,platform,total_rows/);
      assert.match(accountSummaryCsv, /sports-daily,SPORT,Streamer Highlights,tiktok,8,8,0,0,8,0,0,7129d59b5f5e/);
      assert.match(accountSummaryCsv, /meme-radar,memes,Streamer Reactions,tiktok,2,2,0,0,2,0,0,53467d8f7dad/);
      assert.doesNotMatch(accountSummaryCsv, /app\.metricool\.com\/planner|published_post_url|metricool_approval_url/);

      const accountSummaryMarkdownResponse = await fetch(`http://127.0.0.1:${port}/api/clippers/tiktok-batch-account-summary.md`);
      assert.equal(accountSummaryMarkdownResponse.status, 200);
      assert.match(accountSummaryMarkdownResponse.headers.get("content-type") || "", /text\/markdown/);
      assert.match(accountSummaryMarkdownResponse.headers.get("content-disposition") || "", /clippers-tiktok-batch-account-summary\.md/);
      const accountSummaryMarkdown = await accountSummaryMarkdownResponse.text();
      assert.match(accountSummaryMarkdown, /# Clippers TikTok Batch Account Summary/);
      assert.match(accountSummaryMarkdown, /Missing scheduled proof: 10/);
      assert.match(accountSummaryMarkdown, /\| SPORT \| Streamer Highlights \| 8 \| 8\/8 \| 0\/8/);
      assert.match(accountSummaryMarkdown, /realPublishEnabled=false/);
      assert.doesNotMatch(accountSummaryMarkdown, /app\.metricool\.com\/planner|published_post_url|metricool_approval_url/);
      assert.equal(await readFile(batchEvidenceCsvPath, "utf8"), accountSummaryBeforeDownload);

      const accountSummaryJsonPostResponse = await fetch(`http://127.0.0.1:${port}/api/clippers/tiktok-batch-account-summary.json`, { method: "POST" });
      assert.notEqual(accountSummaryJsonPostResponse.status, 200);
      assert.doesNotMatch(accountSummaryJsonPostResponse.headers.get("content-type") || "", /application\/json/);
      const accountSummaryCsvPostResponse = await fetch(`http://127.0.0.1:${port}/api/clippers/tiktok-batch-account-summary.csv`, { method: "POST" });
      assert.notEqual(accountSummaryCsvPostResponse.status, 200);
      assert.doesNotMatch(accountSummaryCsvPostResponse.headers.get("content-type") || "", /text\/csv/);
      const accountSummaryMarkdownPostResponse = await fetch(`http://127.0.0.1:${port}/api/clippers/tiktok-batch-account-summary.md`, { method: "POST" });
      assert.notEqual(accountSummaryMarkdownPostResponse.status, 200);
      assert.doesNotMatch(accountSummaryMarkdownPostResponse.headers.get("content-type") || "", /text\/markdown/);

      const accountQueuesBeforeDownload = await readFile(batchEvidenceCsvPath, "utf8");
      const accountQueuesJsonResponse = await fetch(`http://127.0.0.1:${port}/api/clippers/tiktok-account-queues.json`);
      assert.equal(accountQueuesJsonResponse.status, 200);
      assert.match(accountQueuesJsonResponse.headers.get("content-type") || "", /application\/json/);
      const accountQueuesJson = await accountQueuesJsonResponse.json();
      assert.equal(accountQueuesJson.status, "blocked_real_clip_intake");
      assert.equal(accountQueuesJson.totals.accounts, 2);
      assert.equal(accountQueuesJson.totals.rows, 10);
      assert.equal(accountQueuesJson.accounts.find((account) => account.accountId === "sports-daily").rows.length, 8);
      assert.equal(accountQueuesJson.accounts.find((account) => account.accountId === "sports-daily").rows[0].queueItemId, "7129d59b5f5e");
      assert.equal(accountQueuesJson.accounts.find((account) => account.accountId === "meme-radar").rows[0].queueItemId, "53467d8f7dad");
      assert.ok(accountQueuesJson.guardrails.some((guardrail) => /realPublishEnabled=false/.test(guardrail)));
      assert.doesNotMatch(JSON.stringify(accountQueuesJson), /app\.metricool\.com\/planner|published_post_url|metricool_approval_url/);

      const accountQueuesCsvResponse = await fetch(`http://127.0.0.1:${port}/api/clippers/tiktok-account-queues.csv`);
      assert.equal(accountQueuesCsvResponse.status, 200);
      assert.match(accountQueuesCsvResponse.headers.get("content-type") || "", /text\/csv/);
      assert.match(accountQueuesCsvResponse.headers.get("content-disposition") || "", /clippers-tiktok-account-queues\.csv/);
      const accountQueuesCsv = await accountQueuesCsvResponse.text();
      assert.match(accountQueuesCsv, /account_id,brand,account_name,account_order,queue_item_id,rank,platform/);
      assert.match(accountQueuesCsv, /sports-daily,SPORT,Streamer Highlights,1,7129d59b5f5e,2,tiktok/);
      assert.match(accountQueuesCsv, /meme-radar,memes,Streamer Reactions,1,53467d8f7dad,1,tiktok/);
      assert.doesNotMatch(accountQueuesCsv, /app\.metricool\.com\/planner|published_post_url|metricool_approval_url/);

      const accountQueuesMarkdownResponse = await fetch(`http://127.0.0.1:${port}/api/clippers/tiktok-account-queues.md`);
      assert.equal(accountQueuesMarkdownResponse.status, 200);
      assert.match(accountQueuesMarkdownResponse.headers.get("content-type") || "", /text\/markdown/);
      assert.match(accountQueuesMarkdownResponse.headers.get("content-disposition") || "", /clippers-tiktok-account-queues\.md/);
      const accountQueuesMarkdown = await accountQueuesMarkdownResponse.text();
      assert.match(accountQueuesMarkdown, /# Clippers TikTok Account Queues/);
      assert.match(accountQueuesMarkdown, /## SPORT \/ Streamer Highlights/);
      assert.match(accountQueuesMarkdown, /\| 1 \| 7129d59b5f5e \|/);
      assert.match(accountQueuesMarkdown, /## memes \/ Streamer Reactions/);
      assert.match(accountQueuesMarkdown, /realPublishEnabled=false/);
      assert.doesNotMatch(accountQueuesMarkdown, /app\.metricool\.com\/planner|published_post_url|metricool_approval_url/);
      assert.equal(await readFile(batchEvidenceCsvPath, "utf8"), accountQueuesBeforeDownload);

      const accountQueuesJsonPostResponse = await fetch(`http://127.0.0.1:${port}/api/clippers/tiktok-account-queues.json`, { method: "POST" });
      assert.notEqual(accountQueuesJsonPostResponse.status, 200);
      assert.doesNotMatch(accountQueuesJsonPostResponse.headers.get("content-type") || "", /application\/json/);
      const accountQueuesCsvPostResponse = await fetch(`http://127.0.0.1:${port}/api/clippers/tiktok-account-queues.csv`, { method: "POST" });
      assert.notEqual(accountQueuesCsvPostResponse.status, 200);
      assert.doesNotMatch(accountQueuesCsvPostResponse.headers.get("content-type") || "", /text\/csv/);
      const accountQueuesMarkdownPostResponse = await fetch(`http://127.0.0.1:${port}/api/clippers/tiktok-account-queues.md`, { method: "POST" });
      assert.notEqual(accountQueuesMarkdownPostResponse.status, 200);
      assert.doesNotMatch(accountQueuesMarkdownPostResponse.headers.get("content-type") || "", /text\/markdown/);

      const batchScheduleNowBeforeDownload = await readFile(batchEvidenceCsvPath, "utf8");
      const batchScheduleNowResponse = await fetch(`http://127.0.0.1:${port}/api/clippers/tiktok-batch-schedule-now.html`);
      assert.equal(batchScheduleNowResponse.status, 200);
      assert.match(batchScheduleNowResponse.headers.get("content-type") || "", /text\/html/);
      const batchScheduleNowHtml = await batchScheduleNowResponse.text();
      assert.match(batchScheduleNowHtml, /Clippers TikTok Batch Now/);
      assert.match(batchScheduleNowHtml, /Next deadline/);
      assert.match(batchScheduleNowHtml, /7129d59b5f5e/);
      assert.match(batchScheduleNowHtml, /53467d8f7dad/);
      assert.match(batchScheduleNowHtml, /02_sport_sports-daily_7129d59b5f5e\.mp4/);
      assert.match(batchScheduleNowHtml, /01_memes_meme-radar_53467d8f7dad\.mp4/);
      assert.match(batchScheduleNowHtml, /Upload CSV/);
      assert.match(batchScheduleNowHtml, /Proof CSV/);
      assert.match(batchScheduleNowHtml, /Real clip intake required/);
      assert.match(batchScheduleNowHtml, /No programar placeholders/);
      assert.doesNotMatch(batchScheduleNowHtml, /Batch proof import/);
      assert.doesNotMatch(batchScheduleNowHtml, /Preview scheduled proof batch/);
      assert.doesNotMatch(batchScheduleNowHtml, /name="returnTo" value="\/api\/clippers\/tiktok-batch-schedule-now\.html"/);
      assert.equal((batchScheduleNowHtml.match(/Preview scheduled proof<\/button>/g) || []).length, 0);
      assert.match(batchScheduleNowHtml, /replace placeholders with approved real TikTok clips/i);
      assert.doesNotMatch(batchScheduleNowHtml, /app\.metricool\.com\/planner\/[A-Za-z0-9]|published_post_url|metricool_approval_url/);
      assert.equal(await readFile(batchEvidenceCsvPath, "utf8"), batchScheduleNowBeforeDownload);

      const batchScheduleNowPostResponse = await fetch(`http://127.0.0.1:${port}/api/clippers/tiktok-batch-schedule-now.html`, { method: "POST" });
      assert.notEqual(batchScheduleNowPostResponse.status, 200);
      assert.doesNotMatch(batchScheduleNowPostResponse.headers.get("content-type") || "", /text\/html/);

      const publicMetricsNowLockedResponse = await fetch(`http://127.0.0.1:${port}/api/clippers/tiktok-public-metrics-now.html`);
      assert.equal(publicMetricsNowLockedResponse.status, 200);
      assert.match(publicMetricsNowLockedResponse.headers.get("content-type") || "", /text\/html/);
      const publicMetricsNowLockedHtml = await publicMetricsNowLockedResponse.text();
      assert.match(publicMetricsNowLockedHtml, /Clippers TikTok Public Metrics Now/);
      assert.match(publicMetricsNowLockedHtml, /No public metrics row is ready yet/);
      assert.doesNotMatch(publicMetricsNowLockedHtml, /Preview published metrics|publishedPostUrl|app\.metricool\.com\/planner\/[A-Za-z0-9]|published_post_url|metricool_approval_url/);

      const publicMetricsNowPostResponse = await fetch(`http://127.0.0.1:${port}/api/clippers/tiktok-public-metrics-now.html`, { method: "POST" });
      assert.notEqual(publicMetricsNowPostResponse.status, 200);
      assert.doesNotMatch(publicMetricsNowPostResponse.headers.get("content-type") || "", /text\/html/);

      const sportsNextBeforeDownload = await readFile(batchEvidenceCsvPath, "utf8");
      const sportsNextResponse = await fetch(`http://127.0.0.1:${port}/api/clippers/tiktok-account-next.json?accountId=sports-daily`);
      assert.equal(sportsNextResponse.status, 200);
      assert.match(sportsNextResponse.headers.get("content-type") || "", /application\/json/);
      const sportsNext = await sportsNextResponse.json();
      assert.equal(sportsNext.ok, true);
      assert.equal(sportsNext.status, "blocked_real_clip_intake");
      assert.equal(sportsNext.accountId, "sports-daily");
      assert.equal(sportsNext.brand, "SPORT");
      assert.equal(sportsNext.nextRow.queueItemId, "7129d59b5f5e");
      assert.equal(sportsNext.nextRow.accountOrder, 1);
      assert.deepEqual(sportsNext.nextRow.missingFields, ["scheduled_proof", "final_status"]);
      assert.match(sportsNext.nextAction, /Real clip intake/);
      assert.doesNotMatch(JSON.stringify(sportsNext), /app\.metricool\.com\/planner|published_post_url|metricool_approval_url/);

      const memesNextResponse = await fetch(`http://127.0.0.1:${port}/api/clippers/tiktok-account-next.json?accountId=meme-radar`);
      assert.equal(memesNextResponse.status, 200);
      const memesNext = await memesNextResponse.json();
      assert.equal(memesNext.ok, true);
      assert.equal(memesNext.accountId, "meme-radar");
      assert.equal(memesNext.brand, "memes");
      assert.equal(memesNext.status, "blocked_real_clip_intake");
      assert.equal(memesNext.nextRow.queueItemId, "53467d8f7dad");
      assert.equal(memesNext.nextRow.accountOrder, 1);
      assert.doesNotMatch(JSON.stringify(memesNext), /app\.metricool\.com\/planner|published_post_url|metricool_approval_url/);

      const missingAccountNextResponse = await fetch(`http://127.0.0.1:${port}/api/clippers/tiktok-account-next.json`);
      assert.equal(missingAccountNextResponse.status, 400);
      const missingAccountNext = await missingAccountNextResponse.json();
      assert.equal(missingAccountNext.error, "account_id_required");

      const unknownAccountNextResponse = await fetch(`http://127.0.0.1:${port}/api/clippers/tiktok-account-next.json?accountId=unknown-account`);
      assert.equal(unknownAccountNextResponse.status, 404);
      const unknownAccountNext = await unknownAccountNextResponse.json();
      assert.equal(unknownAccountNext.error, "tiktok_account_not_found");
      assert.deepEqual(unknownAccountNext.availableAccountIds.sort(), ["meme-radar", "sports-daily"]);

      const sportsNextPostResponse = await fetch(`http://127.0.0.1:${port}/api/clippers/tiktok-account-next.json?accountId=sports-daily`, { method: "POST" });
      assert.notEqual(sportsNextPostResponse.status, 200);
      assert.doesNotMatch(sportsNextPostResponse.headers.get("content-type") || "", /application\/json/);
      assert.equal(await readFile(batchEvidenceCsvPath, "utf8"), sportsNextBeforeDownload);

      const currentAccountNowResponse = await fetch(`http://127.0.0.1:${port}/api/clippers/tiktok-current-account-now.html`);
      assert.equal(currentAccountNowResponse.status, 200);
      assert.match(currentAccountNowResponse.headers.get("content-type") || "", /text\/html/);
      const currentAccountNowHtml = await currentAccountNowResponse.text();
      assert.match(currentAccountNowHtml, /SPORT TikTok Now/);
      assert.match(currentAccountNowHtml, /Streamer Highlights/);
      assert.match(currentAccountNowHtml, /7129d59b5f5e/);
      assert.match(currentAccountNowHtml, /No programes hasta resolver el bloqueo/);
      assert.match(currentAccountNowHtml, /Real clip intake/);
      assert.doesNotMatch(currentAccountNowHtml, /Preview scheduled proof/);
      assert.match(currentAccountNowHtml, /Current video MP4/);
      assert.match(currentAccountNowHtml, /Current caption TXT/);
      assert.match(currentAccountNowHtml, /Current upload CSV/);
      assert.match(currentAccountNowHtml, /Current proof CSV/);
      assert.doesNotMatch(currentAccountNowHtml, /53467d8f7dad|cf33ed488e40|app\.metricool\.com\/planner\/[A-Za-z0-9]|published_post_url|metricool_approval_url/);

      const currentAccountNowPostResponse = await fetch(`http://127.0.0.1:${port}/api/clippers/tiktok-current-account-now.html`, { method: "POST" });
      assert.notEqual(currentAccountNowPostResponse.status, 200);
      assert.doesNotMatch(currentAccountNowPostResponse.headers.get("content-type") || "", /text\/html/);

      const currentCaptionBeforeDownload = await readFile(batchEvidenceCsvPath, "utf8");
      const currentCaptionResponse = await fetch(`http://127.0.0.1:${port}/api/clippers/tiktok-current-caption.txt`);
      assert.equal(currentCaptionResponse.status, 200);
      assert.match(currentCaptionResponse.headers.get("content-type") || "", /text\/plain/);
      const currentCaption = await currentCaptionResponse.text();
      assert.equal(currentCaption, "La jugada que nadie esperaba. #fyp #clips\n");
      assert.doesNotMatch(currentCaption, /53467d8f7dad|app\.metricool\.com\/planner|published_post_url|metricool_approval_url/);
      assert.equal(await readFile(batchEvidenceCsvPath, "utf8"), currentCaptionBeforeDownload);

      const currentCaptionPostResponse = await fetch(`http://127.0.0.1:${port}/api/clippers/tiktok-current-caption.txt`, { method: "POST" });
      assert.notEqual(currentCaptionPostResponse.status, 200);

      const currentVideoResponse = await fetch(`http://127.0.0.1:${port}/api/clippers/tiktok-current-video.mp4`, { redirect: "manual" });
      assert.equal(currentVideoResponse.status, 409);
      const currentVideoBlocked = await currentVideoResponse.json();
      assert.equal(currentVideoBlocked.error, "current_tiktok_video_blocked_until_real_clip_intake_ready");
      assert.doesNotMatch(JSON.stringify(currentVideoBlocked), /53467d8f7dad|app\.metricool\.com\/planner|published_post_url|metricool_approval_url/);
      assert.equal(await readFile(batchEvidenceCsvPath, "utf8"), currentCaptionBeforeDownload);

      const currentVideoPostResponse = await fetch(`http://127.0.0.1:${port}/api/clippers/tiktok-current-video.mp4`, { method: "POST", redirect: "manual" });
      assert.notEqual(currentVideoPostResponse.status, 302);
      assert.notEqual(currentVideoPostResponse.status, 200);

      const currentUploadCsvResponse = await fetch(`http://127.0.0.1:${port}/api/clippers/tiktok-current-next-upload-checklist.csv`);
      assert.equal(currentUploadCsvResponse.status, 200);
      assert.match(currentUploadCsvResponse.headers.get("content-type") || "", /text\/csv/);
      assert.match(currentUploadCsvResponse.headers.get("content-disposition") || "", /clippers-current-tiktok-next-upload-checklist\.csv/);
      const currentUploadCsv = await currentUploadCsvResponse.text();
      assert.match(currentUploadCsv, /order,metricool_queue_item_id,metricool_brand,account_name,platform,publish_at_local,publish_at_iso,upload_file_name,caption_seed,scheduled_note_template/);
      assert.match(currentUploadCsv, /1,7129d59b5f5e,SPORT,Streamer Highlights,tiktok/);
      assert.match(currentUploadCsv, /02_sport_sports-daily_7129d59b5f5e\.mp4/);
      assert.doesNotMatch(currentUploadCsv, /53467d8f7dad|cf33ed488e40|app\.metricool\.com\/planner|published_post_url|metricool_approval_url/);
      assert.equal(currentUploadCsv.trim().split("\n").length, 2);

      const currentProofCsvResponse = await fetch(`http://127.0.0.1:${port}/api/clippers/tiktok-current-next-scheduled-proof-starter.csv`);
      assert.equal(currentProofCsvResponse.status, 200);
      assert.match(currentProofCsvResponse.headers.get("content-type") || "", /text\/csv/);
      assert.match(currentProofCsvResponse.headers.get("content-disposition") || "", /clippers-current-tiktok-next-scheduled-proof-starter\.csv/);
      const currentProofCsv = await currentProofCsvResponse.text();
      assert.match(currentProofCsv, /metricool_queue_item_id,metricool_approval_url,operator_notes/);
      assert.doesNotMatch(currentProofCsv, /7129d59b5f5e|53467d8f7dad|cf33ed488e40|app\.metricool\.com\/planner|published_post_url/);
      assert.equal(currentProofCsv.trim().split("\n").length, 1);

      const currentUploadCsvPostResponse = await fetch(`http://127.0.0.1:${port}/api/clippers/tiktok-current-next-upload-checklist.csv`, { method: "POST" });
      assert.notEqual(currentUploadCsvPostResponse.status, 200);
      assert.doesNotMatch(currentUploadCsvPostResponse.headers.get("content-type") || "", /text\/csv/);

      const currentProofCsvPostResponse = await fetch(`http://127.0.0.1:${port}/api/clippers/tiktok-current-next-scheduled-proof-starter.csv`, { method: "POST" });
      assert.notEqual(currentProofCsvPostResponse.status, 200);
      assert.doesNotMatch(currentProofCsvPostResponse.headers.get("content-type") || "", /text\/csv/);
      assert.equal(await readFile(batchEvidenceCsvPath, "utf8"), sportsNextBeforeDownload);

      const sportsNowResponse = await fetch(`http://127.0.0.1:${port}/api/clippers/tiktok-account-now.html?accountId=sports-daily`);
      assert.equal(sportsNowResponse.status, 200);
      assert.match(sportsNowResponse.headers.get("content-type") || "", /text\/html/);
      const sportsNowHtml = await sportsNowResponse.text();
      assert.match(sportsNowHtml, /SPORT TikTok Now/);
      assert.match(sportsNowHtml, /Streamer Highlights/);
      assert.match(sportsNowHtml, /7129d59b5f5e/);
      assert.match(sportsNowHtml, /02_sport_sports-daily_7129d59b5f5e\.mp4/);
      assert.match(sportsNowHtml, /No programes hasta resolver el bloqueo/);
      assert.match(sportsNowHtml, /Real clip intake/);
      assert.doesNotMatch(sportsNowHtml, /Preview scheduled proof/);
      assert.match(sportsNowHtml, /Next upload CSV/);
      assert.doesNotMatch(sportsNowHtml, /returnTo" value="\/api\/clippers\/tiktok-account-now\.html\?accountId=sports-daily"/);
      assert.doesNotMatch(sportsNowHtml, /53467d8f7dad|cf33ed488e40|app\.metricool\.com\/planner\/[A-Za-z0-9]|published_post_url|metricool_approval_url/);

      const memesNowResponse = await fetch(`http://127.0.0.1:${port}/api/clippers/tiktok-account-now.html?accountId=meme-radar`);
      assert.equal(memesNowResponse.status, 200);
      assert.match(memesNowResponse.headers.get("content-type") || "", /text\/html/);
      const memesNowHtml = await memesNowResponse.text();
      assert.match(memesNowHtml, /memes TikTok Now/);
      assert.match(memesNowHtml, /Streamer Reactions/);
      assert.match(memesNowHtml, /53467d8f7dad/);
      assert.match(memesNowHtml, /01_memes_meme-radar_53467d8f7dad\.mp4/);
      assert.match(memesNowHtml, /No programes hasta resolver el bloqueo/);
      assert.match(memesNowHtml, /Real clip intake/);
      assert.doesNotMatch(memesNowHtml, /Preview scheduled proof/);
      assert.match(memesNowHtml, /Next upload CSV/);
      assert.doesNotMatch(memesNowHtml, /7129d59b5f5e|ef11cfd492f0|app\.metricool\.com\/planner\/[A-Za-z0-9]|published_post_url|metricool_approval_url/);

      const sportsNextUploadCsvResponse = await fetch(`http://127.0.0.1:${port}/api/clippers/tiktok-account-next-upload-checklist.csv?accountId=sports-daily`);
      assert.equal(sportsNextUploadCsvResponse.status, 200);
      assert.match(sportsNextUploadCsvResponse.headers.get("content-type") || "", /text\/csv/);
      assert.match(sportsNextUploadCsvResponse.headers.get("content-disposition") || "", /clippers-sports-daily-next-upload-checklist\.csv/);
      const sportsNextUploadCsv = await sportsNextUploadCsvResponse.text();
      assert.match(sportsNextUploadCsv, /order,metricool_queue_item_id,metricool_brand,account_name,platform,publish_at_local,publish_at_iso,upload_file_name,caption_seed,scheduled_note_template/);
      assert.match(sportsNextUploadCsv, /1,7129d59b5f5e,SPORT,Streamer Highlights,tiktok/);
      assert.match(sportsNextUploadCsv, /02_sport_sports-daily_7129d59b5f5e\.mp4/);
      assert.doesNotMatch(sportsNextUploadCsv, /53467d8f7dad|cf33ed488e40|app\.metricool\.com\/planner|published_post_url|metricool_approval_url/);
      assert.equal(sportsNextUploadCsv.trim().split("\n").length, 2);

      const memesNextUploadCsvResponse = await fetch(`http://127.0.0.1:${port}/api/clippers/tiktok-account-next-upload-checklist.csv?accountId=meme-radar`);
      assert.equal(memesNextUploadCsvResponse.status, 200);
      assert.match(memesNextUploadCsvResponse.headers.get("content-disposition") || "", /clippers-meme-radar-next-upload-checklist\.csv/);
      const memesNextUploadCsv = await memesNextUploadCsvResponse.text();
      assert.match(memesNextUploadCsv, /order,metricool_queue_item_id,metricool_brand,account_name,platform,publish_at_local,publish_at_iso,upload_file_name,caption_seed,scheduled_note_template/);
      assert.doesNotMatch(memesNextUploadCsv, /53467d8f7dad|7129d59b5f5e|cf33ed488e40|app\.metricool\.com\/planner|published_post_url|metricool_approval_url/);
      assert.equal(memesNextUploadCsv.trim().split("\n").length, 1);

      const missingNextUploadCsvResponse = await fetch(`http://127.0.0.1:${port}/api/clippers/tiktok-account-next-upload-checklist.csv`);
      assert.equal(missingNextUploadCsvResponse.status, 400);
      assert.match(missingNextUploadCsvResponse.headers.get("content-type") || "", /application\/json/);
      const missingNextUploadCsvBody = await missingNextUploadCsvResponse.text();
      assert.equal(JSON.parse(missingNextUploadCsvBody).error, "account_id_required");
      assert.doesNotMatch(missingNextUploadCsvBody, /sports-daily|meme-radar|availableAccountIds/);

      const unknownNextUploadCsvResponse = await fetch(`http://127.0.0.1:${port}/api/clippers/tiktok-account-next-upload-checklist.csv?accountId=unknown-account`);
      assert.equal(unknownNextUploadCsvResponse.status, 404);
      const unknownNextUploadCsvBody = await unknownNextUploadCsvResponse.text();
      assert.equal(JSON.parse(unknownNextUploadCsvBody).error, "tiktok_account_not_found");
      assert.doesNotMatch(unknownNextUploadCsvBody, /sports-daily|meme-radar|availableAccountIds/);

      const sportsNextUploadCsvPostResponse = await fetch(`http://127.0.0.1:${port}/api/clippers/tiktok-account-next-upload-checklist.csv?accountId=sports-daily`, { method: "POST" });
      assert.notEqual(sportsNextUploadCsvPostResponse.status, 200);
      assert.doesNotMatch(sportsNextUploadCsvPostResponse.headers.get("content-type") || "", /text\/csv/);
      assert.equal(await readFile(batchEvidenceCsvPath, "utf8"), sportsNextBeforeDownload);

      const missingAccountNowResponse = await fetch(`http://127.0.0.1:${port}/api/clippers/tiktok-account-now.html`);
      assert.equal(missingAccountNowResponse.status, 400);
      assert.match(missingAccountNowResponse.headers.get("content-type") || "", /application\/json/);
      const missingAccountNowBody = await missingAccountNowResponse.text();
      assert.equal(JSON.parse(missingAccountNowBody).error, "account_id_required");
      assert.doesNotMatch(missingAccountNowBody, /sports-daily|meme-radar|availableAccountIds/);

      const unknownAccountNowResponse = await fetch(`http://127.0.0.1:${port}/api/clippers/tiktok-account-now.html?accountId=unknown-account`);
      assert.equal(unknownAccountNowResponse.status, 404);
      const unknownAccountNowBody = await unknownAccountNowResponse.text();
      assert.equal(JSON.parse(unknownAccountNowBody).error, "tiktok_account_not_found");
      assert.doesNotMatch(unknownAccountNowBody, /sports-daily|meme-radar|availableAccountIds/);

      const sportsNowPostResponse = await fetch(`http://127.0.0.1:${port}/api/clippers/tiktok-account-now.html?accountId=sports-daily`, { method: "POST" });
      assert.notEqual(sportsNowPostResponse.status, 200);
      assert.doesNotMatch(sportsNowPostResponse.headers.get("content-type") || "", /text\/html/);
      assert.equal(await readFile(batchEvidenceCsvPath, "utf8"), sportsNextBeforeDownload);

      const sportsAccountProofCsvResponse = await fetch(`http://127.0.0.1:${port}/api/clippers/tiktok-account-scheduled-proof-starter.csv?accountId=sports-daily`);
      assert.equal(sportsAccountProofCsvResponse.status, 200);
      assert.match(sportsAccountProofCsvResponse.headers.get("content-type") || "", /text\/csv/);
      assert.match(sportsAccountProofCsvResponse.headers.get("content-disposition") || "", /clippers-sports-daily-scheduled-proof-starter\.csv/);
      const sportsAccountProofCsv = await sportsAccountProofCsvResponse.text();
      assert.match(sportsAccountProofCsv, /metricool_queue_item_id,metricool_approval_url,operator_notes/);
      assert.doesNotMatch(sportsAccountProofCsv, /7129d59b5f5e|53467d8f7dad|app\.metricool\.com\/planner\/[A-Za-z0-9]|published_post_url/);
      assert.equal(sportsAccountProofCsv.trim().split("\n").length, 1);

      const memesAccountProofCsvResponse = await fetch(`http://127.0.0.1:${port}/api/clippers/tiktok-account-scheduled-proof-starter.csv?accountId=meme-radar`);
      assert.equal(memesAccountProofCsvResponse.status, 200);
      assert.match(memesAccountProofCsvResponse.headers.get("content-disposition") || "", /clippers-meme-radar-scheduled-proof-starter\.csv/);
      const memesAccountProofCsv = await memesAccountProofCsvResponse.text();
      assert.match(memesAccountProofCsv, /metricool_queue_item_id,metricool_approval_url,operator_notes/);
      assert.doesNotMatch(memesAccountProofCsv, /53467d8f7dad|cf33ed488e40|7129d59b5f5e|app\.metricool\.com\/planner\/[A-Za-z0-9]|published_post_url/);
      assert.equal(memesAccountProofCsv.trim().split("\n").length, 1);

      const missingAccountProofCsvResponse = await fetch(`http://127.0.0.1:${port}/api/clippers/tiktok-account-scheduled-proof-starter.csv`);
      assert.equal(missingAccountProofCsvResponse.status, 400);
      assert.match(missingAccountProofCsvResponse.headers.get("content-type") || "", /application\/json/);
      assert.equal((await missingAccountProofCsvResponse.json()).error, "account_id_required");

      const unknownAccountProofCsvResponse = await fetch(`http://127.0.0.1:${port}/api/clippers/tiktok-account-scheduled-proof-starter.csv?accountId=unknown-account`);
      assert.equal(unknownAccountProofCsvResponse.status, 404);
      assert.equal((await unknownAccountProofCsvResponse.json()).error, "tiktok_account_not_found");

      const sportsAccountProofCsvPostResponse = await fetch(`http://127.0.0.1:${port}/api/clippers/tiktok-account-scheduled-proof-starter.csv?accountId=sports-daily`, { method: "POST" });
      assert.notEqual(sportsAccountProofCsvPostResponse.status, 200);
      assert.doesNotMatch(sportsAccountProofCsvPostResponse.headers.get("content-type") || "", /text\/csv/);
      assert.equal(await readFile(batchEvidenceCsvPath, "utf8"), sportsNextBeforeDownload);

      const sportsNextAccountProofCsvResponse = await fetch(`http://127.0.0.1:${port}/api/clippers/tiktok-account-next-scheduled-proof-starter.csv?accountId=sports-daily`);
      assert.equal(sportsNextAccountProofCsvResponse.status, 200);
      assert.match(sportsNextAccountProofCsvResponse.headers.get("content-type") || "", /text\/csv/);
      assert.match(sportsNextAccountProofCsvResponse.headers.get("content-disposition") || "", /clippers-sports-daily-next-scheduled-proof-starter\.csv/);
      const sportsNextAccountProofCsv = await sportsNextAccountProofCsvResponse.text();
      assert.match(sportsNextAccountProofCsv, /metricool_queue_item_id,metricool_approval_url,operator_notes/);
      assert.doesNotMatch(sportsNextAccountProofCsv, /7129d59b5f5e|ef11cfd492f0|53467d8f7dad|cf33ed488e40|app\.metricool\.com\/planner\/[A-Za-z0-9]|published_post_url/);
      assert.equal(sportsNextAccountProofCsv.trim().split("\n").length, 1);

      const memesNextAccountProofCsvResponse = await fetch(`http://127.0.0.1:${port}/api/clippers/tiktok-account-next-scheduled-proof-starter.csv?accountId=meme-radar`);
      assert.equal(memesNextAccountProofCsvResponse.status, 200);
      assert.match(memesNextAccountProofCsvResponse.headers.get("content-disposition") || "", /clippers-meme-radar-next-scheduled-proof-starter\.csv/);
      const memesNextAccountProofCsv = await memesNextAccountProofCsvResponse.text();
      assert.match(memesNextAccountProofCsv, /metricool_queue_item_id,metricool_approval_url,operator_notes/);
      assert.doesNotMatch(memesNextAccountProofCsv, /53467d8f7dad|cf33ed488e40|7129d59b5f5e|ef11cfd492f0|app\.metricool\.com\/planner\/[A-Za-z0-9]|published_post_url/);
      assert.equal(memesNextAccountProofCsv.trim().split("\n").length, 1);

      const missingNextAccountProofCsvResponse = await fetch(`http://127.0.0.1:${port}/api/clippers/tiktok-account-next-scheduled-proof-starter.csv`);
      assert.equal(missingNextAccountProofCsvResponse.status, 400);
      assert.match(missingNextAccountProofCsvResponse.headers.get("content-type") || "", /application\/json/);
      const missingNextAccountProofCsvBody = await missingNextAccountProofCsvResponse.text();
      assert.equal(JSON.parse(missingNextAccountProofCsvBody).error, "account_id_required");
      assert.doesNotMatch(missingNextAccountProofCsvBody, /sports-daily|meme-radar|availableAccountIds/);

      const unknownNextAccountProofCsvResponse = await fetch(`http://127.0.0.1:${port}/api/clippers/tiktok-account-next-scheduled-proof-starter.csv?accountId=unknown-account`);
      assert.equal(unknownNextAccountProofCsvResponse.status, 404);
      const unknownNextAccountProofCsvBody = await unknownNextAccountProofCsvResponse.text();
      assert.equal(JSON.parse(unknownNextAccountProofCsvBody).error, "tiktok_account_not_found");
      assert.doesNotMatch(unknownNextAccountProofCsvBody, /sports-daily|meme-radar|availableAccountIds/);

      const sportsNextAccountProofCsvPostResponse = await fetch(`http://127.0.0.1:${port}/api/clippers/tiktok-account-next-scheduled-proof-starter.csv?accountId=sports-daily`, { method: "POST" });
      assert.notEqual(sportsNextAccountProofCsvPostResponse.status, 200);
      assert.doesNotMatch(sportsNextAccountProofCsvPostResponse.headers.get("content-type") || "", /text\/csv/);
      assert.equal(await readFile(batchEvidenceCsvPath, "utf8"), sportsNextBeforeDownload);

      const sportsRunbookResponse = await fetch(`http://127.0.0.1:${port}/api/clippers/tiktok-account-runbook.md?accountId=sports-daily`);
      assert.equal(sportsRunbookResponse.status, 200);
      assert.match(sportsRunbookResponse.headers.get("content-type") || "", /text\/markdown/);
      assert.match(sportsRunbookResponse.headers.get("content-disposition") || "", /clippers-sports-daily-runbook\.md/);
      const sportsRunbook = await sportsRunbookResponse.text();
      assert.match(sportsRunbook, /# Clippers TikTok Runbook: SPORT \/ Streamer Highlights/);
      assert.match(sportsRunbook, /Queue item: 7129d59b5f5e/);
      assert.match(sportsRunbook, /Upload file: 02_sport_sports-daily_7129d59b5f5e\.mp4/);
      assert.match(sportsRunbook, /Account next scheduled proof CSV:/);
      assert.match(sportsRunbook, /Account scheduled proof CSV:/);
      assert.match(sportsRunbook, /realPublishEnabled: false/);
      assert.match(sportsRunbook, /## Do Before Metricool/);
      assert.match(sportsRunbook, /Do not open Metricool for this row yet/);
      assert.doesNotMatch(sportsRunbook, /## Do In Metricool|Copy the real Metricool planner URL only after scheduling/);
      assert.doesNotMatch(sportsRunbook, /app\.metricool\.com\/planner|published_post_url|metricool_approval_url/);

      const memesRunbookResponse = await fetch(`http://127.0.0.1:${port}/api/clippers/tiktok-account-runbook.md?accountId=meme-radar`);
      assert.equal(memesRunbookResponse.status, 200);
      const memesRunbook = await memesRunbookResponse.text();
      assert.match(memesRunbook, /# Clippers TikTok Runbook: memes \/ Streamer Reactions/);
      assert.match(memesRunbook, /Queue item: 53467d8f7dad/);
      assert.match(memesRunbook, /Upload file: 01_memes_meme-radar_53467d8f7dad\.mp4/);
      assert.match(memesRunbook, /Do not open Metricool for this row yet/);
      assert.doesNotMatch(memesRunbook, /app\.metricool\.com\/planner|published_post_url|metricool_approval_url/);

      const missingRunbookResponse = await fetch(`http://127.0.0.1:${port}/api/clippers/tiktok-account-runbook.md`);
      assert.equal(missingRunbookResponse.status, 400);
      assert.match(missingRunbookResponse.headers.get("content-type") || "", /application\/json/);
      assert.equal((await missingRunbookResponse.json()).error, "account_id_required");

      const unknownRunbookResponse = await fetch(`http://127.0.0.1:${port}/api/clippers/tiktok-account-runbook.md?accountId=unknown-account`);
      assert.equal(unknownRunbookResponse.status, 404);
      assert.equal((await unknownRunbookResponse.json()).error, "tiktok_account_not_found");

      const sportsRunbookPostResponse = await fetch(`http://127.0.0.1:${port}/api/clippers/tiktok-account-runbook.md?accountId=sports-daily`, { method: "POST" });
      assert.notEqual(sportsRunbookPostResponse.status, 200);
      assert.doesNotMatch(sportsRunbookPostResponse.headers.get("content-type") || "", /text\/markdown/);
      assert.equal(await readFile(batchEvidenceCsvPath, "utf8"), sportsNextBeforeDownload);

      const briefBeforeDownload = await readFile(batchEvidenceCsvPath, "utf8");
      const operatorBriefResponse = await fetch(`http://127.0.0.1:${port}/api/clippers/operator-brief.md`);
      assert.equal(operatorBriefResponse.status, 200);
      assert.match(operatorBriefResponse.headers.get("content-type") || "", /text\/markdown/);
      assert.match(operatorBriefResponse.headers.get("content-disposition") || "", /clippers-metricool-operator-brief\.md/);
      const operatorBrief = await operatorBriefResponse.text();
      assert.match(operatorBrief, /# Clippers TikTok Metricool Operator Brief/);
      assert.match(operatorBrief, /realPublishEnabled: false/);
      assert.match(operatorBrief, /metricoolApprovalRequired: true/);
      assert.match(operatorBrief, /Queue item: 7129d59b5f5e/);
      assert.match(operatorBrief, /## Next Real Clip Intake Action/);
      assert.match(operatorBrief, /Do not schedule this batch in Metricool yet/);
      assert.match(operatorBrief, /Do not schedule placeholder MP4 files/);
      assert.doesNotMatch(operatorBrief, /After scheduling this row in Metricool|Schedule rows in Metricool in deadline order/);
      assert.match(operatorBrief, /## Deadline Queue/);
      assert.match(operatorBrief, /Upload pack: ready \(10\/10 files ready\)/);
      assert.match(operatorBrief, /\| Order \| Queue item \| Brand \| Account \| Publish local \| File \| Caption \| Proof note \|/);
      assert.match(operatorBrief, /\| 1 \| 7129d59b5f5e \| SPORT \| Streamer Highlights/);
      assert.match(operatorBrief, /Do not use direct TikTok\/Instagram\/YouTube APIs/);
      assert.match(operatorBrief, /Needs roll-forward: no|Needs roll-forward: yes/);
      assert.match(operatorBrief, /Ready to schedule now: no|Ready to schedule now: yes/);
      assert.match(operatorBrief, new RegExp(`http://127\\.0\\.0\\.1:${port}/clippers`));
      assert.doesNotMatch(operatorBrief, /http:\/\/127\.0\.0\.1:5010\/clippers/);
      assert.equal(await readFile(batchEvidenceCsvPath, "utf8"), briefBeforeDownload);

      const operatorBriefPostResponse = await fetch(`http://127.0.0.1:${port}/api/clippers/operator-brief.md`, { method: "POST" });
      assert.notEqual(operatorBriefPostResponse.status, 200);
      assert.doesNotMatch(operatorBriefPostResponse.headers.get("content-type") || "", /text\/markdown/);

      const goLiveResolverBeforeDownload = await readFile(batchEvidenceCsvPath, "utf8");
      const goLiveResolverJsonResponse = await fetch(`http://127.0.0.1:${port}/api/clippers/go-live-gap-resolver.json`);
      assert.equal(goLiveResolverJsonResponse.status, 200);
      assert.match(goLiveResolverJsonResponse.headers.get("content-type") || "", /application\/json/);
      const goLiveResolverJson = await goLiveResolverJsonResponse.json();
      assert.equal(goLiveResolverJson.status, "blocked_real_clip_intake");
      assert.equal(goLiveResolverJson.canScheduleMetricool, false);
      assert.equal(goLiveResolverJson.realPublishAllowed, false);
      assert.ok(goLiveResolverJson.blockers.includes("real_clip_intake"));
      assert.equal(goLiveResolverJson.rows.find((row) => row.id === "metricool_tiktok_accounts").status, "ready");
      assert.equal(goLiveResolverJson.rows.find((row) => row.id === "direct_social_apis").requiredForCurrentMvp, false);
      assert.equal(await readFile(batchEvidenceCsvPath, "utf8"), goLiveResolverBeforeDownload);

      const goLiveResolverHtmlResponse = await fetch(`http://127.0.0.1:${port}/api/clippers/go-live-gap-resolver.html`);
      assert.equal(goLiveResolverHtmlResponse.status, 200);
      assert.match(goLiveResolverHtmlResponse.headers.get("content-type") || "", /text\/html/);
      const goLiveResolverHtml = await goLiveResolverHtmlResponse.text();
      assert.match(goLiveResolverHtml, /Clippers Go-Live Gap Resolver/);
      assert.match(goLiveResolverHtml, /blocked_real_clip_intake/);
      assert.match(goLiveResolverHtml, /Real Clip Intake/);
      assert.doesNotMatch(goLiveResolverHtml, /name="csrfToken"|<form/i);

      const goLiveResolverMarkdownResponse = await fetch(`http://127.0.0.1:${port}/api/clippers/go-live-gap-resolver.md`);
      assert.equal(goLiveResolverMarkdownResponse.status, 200);
      assert.match(goLiveResolverMarkdownResponse.headers.get("content-disposition") || "", /clippers-go-live-gap-resolver\.md/);
      const goLiveResolverMarkdown = await goLiveResolverMarkdownResponse.text();
      assert.match(goLiveResolverMarkdown, /# Clippers Go-Live Gap Resolver/);
      assert.match(goLiveResolverMarkdown, /real_clip_intake/);
      assert.match(goLiveResolverMarkdown, /direct_social_apis \| deferred_not_required/);

      const goLiveResolverCsvResponse = await fetch(`http://127.0.0.1:${port}/api/clippers/go-live-gap-resolver.csv`);
      assert.equal(goLiveResolverCsvResponse.status, 200);
      assert.match(goLiveResolverCsvResponse.headers.get("content-disposition") || "", /clippers-go-live-gap-resolver\.csv/);
      const goLiveResolverCsv = await goLiveResolverCsvResponse.text();
      assert.match(goLiveResolverCsv, /id,label,status,required_for_current_mvp,count,blocker,next_action/);
      assert.match(goLiveResolverCsv, /real_clip_intake/);

      const reportBeforeDownload = await readFile(batchEvidenceCsvPath, "utf8");
      const operatorReportResponse = await fetch(`http://127.0.0.1:${port}/api/clippers/operator-report.md`);
      assert.equal(operatorReportResponse.status, 200);
      assert.match(operatorReportResponse.headers.get("content-type") || "", /text\/markdown/);
      assert.match(operatorReportResponse.headers.get("content-disposition") || "", /clippers-metricool-operator-report\.md/);
      const operatorReport = await operatorReportResponse.text();
      assert.match(operatorReport, /# Clippers TikTok Metricool Report/);
      assert.match(operatorReport, /## Next Best Action/);
      assert.match(operatorReport, /Replace placeholders with real clips before Metricool/);
      assert.match(operatorReport, /Metricool scheduled proof missing: 10/);
      assert.match(operatorReport, /Upload pack: ready \(10\/10 files ready, missing 0, zero-byte 0\)/);
      assert.match(operatorReport, /Schedule window: .*\(.* lead minutes, roll-forward not needed\)/);
      assert.match(operatorReport, /Auto roll-forward threshold: /);
      assert.match(operatorReport, /Next scheduled proof CSV/);
      assert.match(operatorReport, /realPublishEnabled: false/);
      assert.match(operatorReport, /\| 1 \| 7129d59b5f5e \| SPORT \| Streamer Highlights/);
      assert.doesNotMatch(operatorReport, /app\.metricool\.com\/planner/);
      assert.equal(await readFile(batchEvidenceCsvPath, "utf8"), reportBeforeDownload);

      const operatorReportPostResponse = await fetch(`http://127.0.0.1:${port}/api/clippers/operator-report.md`, { method: "POST" });
      assert.notEqual(operatorReportPostResponse.status, 200);
      assert.doesNotMatch(operatorReportPostResponse.headers.get("content-type") || "", /text\/markdown/);

      const currentTikTokPacketBeforeDownload = await readFile(batchEvidenceCsvPath, "utf8");
      const currentTikTokPacketResponse = await fetch(`http://127.0.0.1:${port}/api/clippers/tiktok-current-action.md`);
      assert.equal(currentTikTokPacketResponse.status, 200);
      assert.match(currentTikTokPacketResponse.headers.get("content-type") || "", /text\/markdown/);
      assert.match(currentTikTokPacketResponse.headers.get("content-disposition") || "", /clippers-current-tiktok-action\.md/);
      const currentTikTokPacket = await currentTikTokPacketResponse.text();
      assert.match(currentTikTokPacket, /# Clippers Current TikTok Action/);
      assert.match(currentTikTokPacket, /Blocked/);
      assert.match(currentTikTokPacket, /Replace placeholders with real clips before Metricool/);
      assert.match(currentTikTokPacket, /Real clip intake/);
      assert.doesNotMatch(currentTikTokPacket, /Upload file: 02_sport_sports-daily_7129d59b5f5e\.mp4/);
      assert.match(currentTikTokPacket, /realPublishEnabled: false/);
      assert.doesNotMatch(currentTikTokPacket, /53467d8f7dad|app\.metricool\.com\/planner\/[A-Za-z0-9]|published_post_url|metricool_approval_url/);
      assert.equal(await readFile(batchEvidenceCsvPath, "utf8"), currentTikTokPacketBeforeDownload);

      const currentTikTokPacketPostResponse = await fetch(`http://127.0.0.1:${port}/api/clippers/tiktok-current-action.md`, { method: "POST" });
      assert.notEqual(currentTikTokPacketPostResponse.status, 200);
      assert.doesNotMatch(currentTikTokPacketPostResponse.headers.get("content-type") || "", /text\/markdown/);

      const currentTikTokJsonBeforeDownload = await readFile(batchEvidenceCsvPath, "utf8");
      const currentTikTokJsonResponse = await fetch(`http://127.0.0.1:${port}/api/clippers/tiktok-current-action.json`);
      assert.equal(currentTikTokJsonResponse.status, 200);
      assert.match(currentTikTokJsonResponse.headers.get("content-type") || "", /application\/json/);
      const currentTikTokJson = await currentTikTokJsonResponse.json();
      assert.equal(currentTikTokJson.status, "real_clip_intake_required");
      assert.equal(currentTikTokJson.scope, "tiktok_metricool_current_action");
      assert.equal(currentTikTokJson.tiktokOnly, true);
      assert.equal(currentTikTokJson.realPublishEnabled, false);
      assert.equal(currentTikTokJson.metricoolApprovalRequired, true);
      assert.equal(currentTikTokJson.scheduleReady, false);
      assert.equal(currentTikTokJson.queueItemId, "7129d59b5f5e");
      assert.equal(currentTikTokJson.brand, "SPORT");
      assert.equal(currentTikTokJson.accountName, "Streamer Highlights");
      assert.equal(currentTikTokJson.accountId, "sports-daily");
      assert.equal(currentTikTokJson.platform, "tiktok");
      assert.equal(currentTikTokJson.uploadFileName, "02_sport_sports-daily_7129d59b5f5e.mp4");
      assert.match(currentTikTokJson.uploadFileUrl, /^\/clippers-workspace\/scheduled\/metricool-current-batch-upload-pack\/.+\.mp4$/);
      assert.equal(currentTikTokJson.row.queueItemId, currentTikTokJson.queueItemId);
      assert.deepEqual(currentTikTokJson.row.missingFields, ["scheduled_proof", "final_status"]);
      assert.match(currentTikTokJson.links.currentTikTokNow, new RegExp(`http://127\\.0\\.0\\.1:${port}/api/clippers/tiktok-current-account-now\\.html`));
      assert.match(currentTikTokJson.links.currentTikTokMarkdown, new RegExp(`http://127\\.0\\.0\\.1:${port}/api/clippers/tiktok-current-action\\.md`));
      assert.match(currentTikTokJson.links.currentCaptionTxt, new RegExp(`http://127\\.0\\.0\\.1:${port}/api/clippers/tiktok-current-caption\\.txt`));
      assert.match(currentTikTokJson.links.currentVideoMp4, new RegExp(`http://127\\.0\\.0\\.1:${port}/api/clippers/tiktok-current-video\\.mp4`));
      assert.match(currentTikTokJson.links.currentUploadCsv, new RegExp(`http://127\\.0\\.0\\.1:${port}/api/clippers/tiktok-current-next-upload-checklist\\.csv`));
      assert.match(currentTikTokJson.links.currentProofCsv, new RegExp(`http://127\\.0\\.0\\.1:${port}/api/clippers/tiktok-current-next-scheduled-proof-starter\\.csv`));
      assert.ok(currentTikTokJson.guardrails.some((guardrail) => /realPublishEnabled=false/.test(guardrail)));
      assert.doesNotMatch(JSON.stringify(currentTikTokJson), /53467d8f7dad|app\.metricool\.com\/planner\/[A-Za-z0-9]|published_post_url|metricool_approval_url/);
      assert.equal(await readFile(batchEvidenceCsvPath, "utf8"), currentTikTokJsonBeforeDownload);

      const currentTikTokJsonPostResponse = await fetch(`http://127.0.0.1:${port}/api/clippers/tiktok-current-action.json`, { method: "POST" });
      assert.notEqual(currentTikTokJsonPostResponse.status, 200);
      assert.doesNotMatch(currentTikTokJsonPostResponse.headers.get("content-type") || "", /application\/json/);

      const nextActionBeforeDownload = await readFile(batchEvidenceCsvPath, "utf8");
      const nextMetricoolActionResponse = await fetch(`http://127.0.0.1:${port}/api/clippers/next-metricool-action.md`);
      assert.equal(nextMetricoolActionResponse.status, 200);
      assert.match(nextMetricoolActionResponse.headers.get("content-type") || "", /text\/markdown/);
      assert.match(nextMetricoolActionResponse.headers.get("content-disposition") || "", /clippers-next-metricool-action\.md/);
      const nextMetricoolAction = await nextMetricoolActionResponse.text();
      assert.match(nextMetricoolAction, /# Clippers Next Metricool Action/);
      assert.match(nextMetricoolAction, /Stage: real_clip_intake_required/);
      assert.match(nextMetricoolAction, /Replace placeholders with real clips before Metricool/);
      assert.doesNotMatch(nextMetricoolAction, /Upload file: 02_sport_sports-daily_7129d59b5f5e\.mp4/);
      assert.match(nextMetricoolAction, /Current TikTok account now/);
      assert.doesNotMatch(nextMetricoolAction, /Next scheduled proof CSV/);
      assert.match(nextMetricoolAction, /realPublishEnabled: false/);
      assert.doesNotMatch(nextMetricoolAction, /app\.metricool\.com\/planner\/[A-Za-z0-9]/);
      assert.equal(await readFile(batchEvidenceCsvPath, "utf8"), nextActionBeforeDownload);

      const nextMetricoolActionJsonResponse = await fetch(`http://127.0.0.1:${port}/api/clippers/next-metricool-action.json`);
      assert.equal(nextMetricoolActionJsonResponse.status, 200);
      assert.match(nextMetricoolActionJsonResponse.headers.get("content-type") || "", /application\/json/);
      const nextMetricoolActionJson = await nextMetricoolActionJsonResponse.json();
      assert.equal(nextMetricoolActionJson.status, "real_clip_intake_required");
      assert.equal(nextMetricoolActionJson.scheduleReady, false);
      assert.equal(nextMetricoolActionJson.realPublishEnabled, false);
      assert.equal(nextMetricoolActionJson.metricoolApprovalRequired, true);
      assert.equal(nextMetricoolActionJson.action.stage, "real_clip_intake_required");
      assert.equal(nextMetricoolActionJson.row, null);
      assert.equal(nextMetricoolActionJson.queueItemId, "");
      assert.equal(nextMetricoolActionJson.brand, "");
      assert.equal(nextMetricoolActionJson.accountName, "");
      assert.equal(nextMetricoolActionJson.platform, "");
      assert.equal(nextMetricoolActionJson.uploadFileName, "");
      assert.equal(nextMetricoolActionJson.uploadFileUrl, "");
      assert.equal(nextMetricoolActionJson.captionSeed, "");
      assert.equal(nextMetricoolActionJson.scheduledNoteTemplate, "");
      assert.ok(nextMetricoolActionJson.guardrails.some((guardrail) => /Metricool only/.test(guardrail)));
      assert.match(nextMetricoolActionJson.links.currentTikTokActionMarkdown, new RegExp(`http://127\\.0\\.0\\.1:${port}/api/clippers/tiktok-current-action\\.md`));
      assert.match(nextMetricoolActionJson.links.currentTikTokActionJson, new RegExp(`http://127\\.0\\.0\\.1:${port}/api/clippers/tiktok-current-action\\.json`));
      assert.match(nextMetricoolActionJson.links.currentTikTokCaptionTxt, new RegExp(`http://127\\.0\\.0\\.1:${port}/api/clippers/tiktok-current-caption\\.txt`));
      assert.match(nextMetricoolActionJson.links.currentTikTokVideoMp4, new RegExp(`http://127\\.0\\.0\\.1:${port}/api/clippers/tiktok-current-video\\.mp4`));
      assert.match(nextMetricoolActionJson.links.nextMetricoolActionMarkdown, new RegExp(`http://127\\.0\\.0\\.1:${port}/api/clippers/next-metricool-action\\.md`));
      assert.match(nextMetricoolActionJson.links.tiktokCurrentAccountNowHtml, new RegExp(`http://127\\.0\\.0\\.1:${port}/api/clippers/tiktok-current-account-now\\.html`));
      assert.match(nextMetricoolActionJson.links.tiktokCurrentNextUploadChecklistCsv, new RegExp(`http://127\\.0\\.0\\.1:${port}/api/clippers/tiktok-current-next-upload-checklist\\.csv`));
      assert.match(nextMetricoolActionJson.links.tiktokCurrentNextScheduledProofStarterCsv, new RegExp(`http://127\\.0\\.0\\.1:${port}/api/clippers/tiktok-current-next-scheduled-proof-starter\\.csv`));
      assert.match(nextMetricoolActionJson.links.tiktokSportsNowHtml, new RegExp(`http://127\\.0\\.0\\.1:${port}/api/clippers/tiktok-account-now\\.html\\?accountId=sports-daily`));
      assert.match(nextMetricoolActionJson.links.tiktokMemesNowHtml, new RegExp(`http://127\\.0\\.0\\.1:${port}/api/clippers/tiktok-account-now\\.html\\?accountId=meme-radar`));
      assert.match(nextMetricoolActionJson.links.tiktokSportsNextUploadChecklistCsv, new RegExp(`http://127\\.0\\.0\\.1:${port}/api/clippers/tiktok-account-next-upload-checklist\\.csv\\?accountId=sports-daily`));
      assert.match(nextMetricoolActionJson.links.tiktokMemesNextUploadChecklistCsv, new RegExp(`http://127\\.0\\.0\\.1:${port}/api/clippers/tiktok-account-next-upload-checklist\\.csv\\?accountId=meme-radar`));
      assert.match(nextMetricoolActionJson.links.tiktokSportsNextScheduledProofStarterCsv, new RegExp(`http://127\\.0\\.0\\.1:${port}/api/clippers/tiktok-account-next-scheduled-proof-starter\\.csv\\?accountId=sports-daily`));
      assert.match(nextMetricoolActionJson.links.tiktokMemesNextScheduledProofStarterCsv, new RegExp(`http://127\\.0\\.0\\.1:${port}/api/clippers/tiktok-account-next-scheduled-proof-starter\\.csv\\?accountId=meme-radar`));
      assert.equal(await readFile(batchEvidenceCsvPath, "utf8"), nextActionBeforeDownload);

      const nextMetricoolActionPostResponse = await fetch(`http://127.0.0.1:${port}/api/clippers/next-metricool-action.md`, { method: "POST" });
      assert.notEqual(nextMetricoolActionPostResponse.status, 200);
      assert.doesNotMatch(nextMetricoolActionPostResponse.headers.get("content-type") || "", /text\/markdown/);

      const nextMetricoolActionJsonPostResponse = await fetch(`http://127.0.0.1:${port}/api/clippers/next-metricool-action.json`, { method: "POST" });
      assert.notEqual(nextMetricoolActionJsonPostResponse.status, 200);
      assert.doesNotMatch(nextMetricoolActionJsonPostResponse.headers.get("content-type") || "", /application\/json/);

      const evidenceIntegrityResponse = await fetch(`http://127.0.0.1:${port}/api/clippers/evidence-integrity.json`);
      assert.equal(evidenceIntegrityResponse.status, 200);
      assert.match(evidenceIntegrityResponse.headers.get("content-type") || "", /application\/json/);
      const evidenceIntegrity = await evidenceIntegrityResponse.json();
      assert.equal(evidenceIntegrity.status, "clean");
      assert.equal(evidenceIntegrity.readOnly, true);
      assert.equal(evidenceIntegrity.findingsCount, 0);
      assert.equal(typeof evidenceIntegrity.operatorAuditEvents, "number");
      assert.match(evidenceIntegrity.redaction, /do not include full URLs/);
      assert.equal(await readFile(batchEvidenceCsvPath, "utf8"), nextActionBeforeDownload);

      const evidenceIntegrityPostResponse = await fetch(`http://127.0.0.1:${port}/api/clippers/evidence-integrity.json`, { method: "POST" });
      assert.notEqual(evidenceIntegrityPostResponse.status, 200);
      assert.doesNotMatch(evidenceIntegrityPostResponse.headers.get("content-type") || "", /application\/json/);

      const readyBeforeDownload = await readFile(batchEvidenceCsvPath, "utf8");
      const operatorReadyResponse = await fetch(`http://127.0.0.1:${port}/api/clippers/operator-ready.json`);
      assert.equal(operatorReadyResponse.status, 200);
      assert.match(operatorReadyResponse.headers.get("content-type") || "", /application\/json/);
      const operatorReady = await operatorReadyResponse.json();
      assert.equal(operatorReady.status, "blocked_real_clip_intake");
      assert.equal(operatorReady.operatorReady, false);
      assert.equal(operatorReady.goalComplete, false);
      assert.equal(operatorReady.realPublishEnabled, false);
      assert.equal(operatorReady.metricoolApprovalRequired, true);
      assert.equal(operatorReady.readyToScheduleNow, false);
      assert.equal(operatorReady.uploadPackIntegrity.status, "ready");
      assert.equal(operatorReady.uploadPackIntegrity.readyFiles, 10);
      assert.equal(operatorReady.realClipGap.status, "generated_owned_placeholder_batch");
      assert.equal(operatorReady.realClipGap.realClipRows, 0);
      assert.equal(operatorReady.realClipGap.generatedOwnedRows, 10);
      assert.equal(operatorReady.realClipGap.missingRealClips, 10);
      assert.match(operatorReady.links.goalGapsJson, new RegExp(`http://127\\.0\\.0\\.1:${port}/api/clippers/goal-gaps\\.json`));
      assert.match(operatorReady.links.goalGapsMarkdown, new RegExp(`http://127\\.0\\.0\\.1:${port}/api/clippers/goal-gaps\\.md`));
      assert.match(operatorReady.links.realClipGapJson, new RegExp(`http://127\\.0\\.0\\.1:${port}/api/clippers/real-clip-gap\\.json`));
      assert.match(operatorReady.links.realClipGapMarkdown, new RegExp(`http://127\\.0\\.0\\.1:${port}/api/clippers/real-clip-gap\\.md`));
      assert.match(operatorReady.links.realClipIntakeHtml, new RegExp(`http://127\\.0\\.0\\.1:${port}/api/clippers/real-clip-intake\\.html`));
      assert.match(operatorReady.links.realClipIntakeMarkdown, new RegExp(`http://127\\.0\\.0\\.1:${port}/api/clippers/real-clip-intake\\.md`));
      assert.match(operatorReady.links.realClipIntakeManifestCsv, new RegExp(`http://127\\.0\\.0\\.1:${port}/api/clippers/real-clip-intake-manifest\\.csv`));
      assert.match(operatorReady.links.realClipIntakeValidationJson, new RegExp(`http://127\\.0\\.0\\.1:${port}/api/clippers/real-clip-intake-validation\\.json`));
      assert.match(operatorReady.links.realClipIntakeValidationHtml, new RegExp(`http://127\\.0\\.0\\.1:${port}/api/clippers/real-clip-intake-validation\\.html`));
      assert.match(operatorReady.links.realClipIntakeValidationMarkdown, new RegExp(`http://127\\.0\\.0\\.1:${port}/api/clippers/real-clip-intake-validation\\.md`));
      assert.match(operatorReady.links.realClipPermissionOutreachHtml, new RegExp(`http://127\\.0\\.0\\.1:${port}/api/clippers/real-clip-permission-outreach\\.html`));
      assert.match(operatorReady.links.realClipPermissionOutreachMarkdown, new RegExp(`http://127\\.0\\.0\\.1:${port}/api/clippers/real-clip-permission-outreach\\.md`));
      assert.match(operatorReady.links.realClipPermissionOutreachCsv, new RegExp(`http://127\\.0\\.0\\.1:${port}/api/clippers/real-clip-permission-outreach\\.csv`));
      assert.equal(operatorReady.uploadPackIntegrity.missingFiles, 0);
      assert.equal(operatorReady.missingMetricoolScheduledProof, 10);
      assert.equal(operatorReady.tiktokBatchAccountSummary.status, "blocked_real_clip_intake");
      assert.equal(operatorReady.tiktokBatchAccountSummary.totals.accounts, 2);
      assert.equal(operatorReady.tiktokBatchAccountSummary.totals.totalRows, 10);
      assert.equal(operatorReady.tiktokBatchAccountSummary.accounts.find((account) => account.accountId === "sports-daily").totalRows, 8);
      assert.equal(operatorReady.tiktokBatchAccountSummary.accounts.find((account) => account.accountId === "meme-radar").missingScheduledProof, 2);
      assert.equal(operatorReady.tiktokAccountQueues.totals.accounts, 2);
      assert.equal(operatorReady.tiktokAccountQueues.totals.rows, 10);
      assert.equal(operatorReady.tiktokAccountQueues.accounts.find((account) => account.accountId === "sports-daily").rows[0].queueItemId, "7129d59b5f5e");
      assert.equal(operatorReady.nextBestAction.stage, "real_clip_intake_required");
      assert.equal(operatorReady.nextBestAction.queueItemId, "7129d59b5f5e");
      assert.equal(operatorReady.nextBestAction.primaryAction, "Open real clip intake");
      assert.equal(operatorReady.streamerGrowthCeo.targetFollowers, 10000);
      assert.match(operatorReady.links.streamerGrowthCeoHtml, new RegExp(`http://127\\.0\\.0\\.1:${port}/api/clippers/streamer-growth-ceo\\.html`));
      assert.match(operatorReady.links.streamerGrowthCeoJson, new RegExp(`http://127\\.0\\.0\\.1:${port}/api/clippers/streamer-growth-ceo\\.json`));
      assert.match(operatorReady.links.streamerGrowthCeoMarkdown, new RegExp(`http://127\\.0\\.0\\.1:${port}/api/clippers/streamer-growth-ceo\\.md`));
      assert.match(operatorReady.links.operatorReport, new RegExp(`http://127\\.0\\.0\\.1:${port}/api/clippers/operator-report\\.md`));
      assert.match(operatorReady.links.nextMetricoolAction, new RegExp(`http://127\\.0\\.0\\.1:${port}/api/clippers/next-metricool-action\\.md`));
      assert.match(operatorReady.links.currentTikTokActionMarkdown, new RegExp(`http://127\\.0\\.0\\.1:${port}/api/clippers/tiktok-current-action\\.md`));
      assert.match(operatorReady.links.currentTikTokActionJson, new RegExp(`http://127\\.0\\.0\\.1:${port}/api/clippers/tiktok-current-action\\.json`));
      assert.match(operatorReady.links.currentTikTokCaptionTxt, new RegExp(`http://127\\.0\\.0\\.1:${port}/api/clippers/tiktok-current-caption\\.txt`));
      assert.match(operatorReady.links.currentTikTokVideoMp4, new RegExp(`http://127\\.0\\.0\\.1:${port}/api/clippers/tiktok-current-video\\.mp4`));
      assert.match(operatorReady.links.nextMetricoolActionJson, new RegExp(`http://127\\.0\\.0\\.1:${port}/api/clippers/next-metricool-action\\.json`));
      assert.match(operatorReady.links.tiktokCurrentAccountNowHtml, new RegExp(`http://127\\.0\\.0\\.1:${port}/api/clippers/tiktok-current-account-now\\.html`));
      assert.match(operatorReady.links.tiktokCurrentNextUploadChecklistCsv, new RegExp(`http://127\\.0\\.0\\.1:${port}/api/clippers/tiktok-current-next-upload-checklist\\.csv`));
      assert.match(operatorReady.links.tiktokCurrentNextScheduledProofStarterCsv, new RegExp(`http://127\\.0\\.0\\.1:${port}/api/clippers/tiktok-current-next-scheduled-proof-starter\\.csv`));
      assert.match(operatorReady.links.tiktokSportsNextJson, new RegExp(`http://127\\.0\\.0\\.1:${port}/api/clippers/tiktok-account-next\\.json\\?accountId=sports-daily`));
      assert.match(operatorReady.links.tiktokMemesNextJson, new RegExp(`http://127\\.0\\.0\\.1:${port}/api/clippers/tiktok-account-next\\.json\\?accountId=meme-radar`));
      assert.match(operatorReady.links.tiktokSportsNowHtml, new RegExp(`http://127\\.0\\.0\\.1:${port}/api/clippers/tiktok-account-now\\.html\\?accountId=sports-daily`));
      assert.match(operatorReady.links.tiktokMemesNowHtml, new RegExp(`http://127\\.0\\.0\\.1:${port}/api/clippers/tiktok-account-now\\.html\\?accountId=meme-radar`));
      assert.match(operatorReady.links.tiktokSportsNextUploadChecklistCsv, new RegExp(`http://127\\.0\\.0\\.1:${port}/api/clippers/tiktok-account-next-upload-checklist\\.csv\\?accountId=sports-daily`));
      assert.match(operatorReady.links.tiktokMemesNextUploadChecklistCsv, new RegExp(`http://127\\.0\\.0\\.1:${port}/api/clippers/tiktok-account-next-upload-checklist\\.csv\\?accountId=meme-radar`));
      assert.match(operatorReady.links.tiktokSportsNextScheduledProofStarterCsv, new RegExp(`http://127\\.0\\.0\\.1:${port}/api/clippers/tiktok-account-next-scheduled-proof-starter\\.csv\\?accountId=sports-daily`));
      assert.match(operatorReady.links.tiktokMemesNextScheduledProofStarterCsv, new RegExp(`http://127\\.0\\.0\\.1:${port}/api/clippers/tiktok-account-next-scheduled-proof-starter\\.csv\\?accountId=meme-radar`));
      assert.match(operatorReady.links.tiktokSportsScheduledProofStarterCsv, new RegExp(`http://127\\.0\\.0\\.1:${port}/api/clippers/tiktok-account-scheduled-proof-starter\\.csv\\?accountId=sports-daily`));
      assert.match(operatorReady.links.tiktokMemesScheduledProofStarterCsv, new RegExp(`http://127\\.0\\.0\\.1:${port}/api/clippers/tiktok-account-scheduled-proof-starter\\.csv\\?accountId=meme-radar`));
      assert.match(operatorReady.links.tiktokSportsRunbookMarkdown, new RegExp(`http://127\\.0\\.0\\.1:${port}/api/clippers/tiktok-account-runbook\\.md\\?accountId=sports-daily`));
      assert.match(operatorReady.links.tiktokMemesRunbookMarkdown, new RegExp(`http://127\\.0\\.0\\.1:${port}/api/clippers/tiktok-account-runbook\\.md\\?accountId=meme-radar`));
      assert.match(operatorReady.links.nextScheduledProofStarterCsv, new RegExp(`http://127\\.0\\.0\\.1:${port}/api/clippers/next-scheduled-proof-starter\\.csv`));
      assert.equal(operatorReady.nextMetricoolRow, null);
      assert.deepEqual(operatorReady.metricoolDeadlineQueue, []);
      assert.equal(operatorReady.scheduleWindow.status, status.operatorSummary.scheduleWindowStatus);
      assert.equal(operatorReady.scheduleWindow.label, status.operatorSummary.scheduleWindowLabel);
      assert.equal(operatorReady.scheduleWindow.needsRollForward, status.operatorSummary.needsRollForward);
      assert.equal(operatorReady.scheduleWindow.action, status.operatorSummary.scheduleWindowAction);
      assert.equal(operatorReady.scheduleWindow.firstPublishAt, "");
      assert.equal(operatorReady.scheduleWindow.deadlineQueueItemId, "");
      assert.equal(operatorReady.scheduleWindow.deadlinePublishAt, "");
      assert.equal(typeof operatorReady.scheduleWindow.leadMinutes, "number");
      assert.ok(Math.abs(operatorReady.scheduleWindow.leadMinutes - status.operatorSummary.leadMinutes) <= 1);
      assert.equal(operatorReady.deadlineReadiness.okToSchedule, false);
      assert.equal(operatorReady.deadlineReadiness.nextQueueItemId, "");
      assert.ok(Math.abs(operatorReady.deadlineReadiness.leadMinutes - status.operatorSummary.leadMinutes) <= 1);
      assert.equal(operatorReady.watchdog.enabled, status.watchdog.enabled);
      assert.equal(operatorReady.watchdog.thresholdMinutes, status.watchdog.thresholdMinutes);
      assert.equal(operatorReady.watchdog.minutesUntilAutoRollForward, status.watchdog.minutesUntilAutoRollForward);
      assert.equal(operatorReady.watchdog.autoRollForwardThresholdAt, status.watchdog.autoRollForwardThresholdAt);
      assert.match(operatorReady.links.operatorUi, new RegExp(`http://127\\.0\\.0\\.1:${port}/clippers`));
      assert.match(operatorReady.links.publishedMetricsStarterCsv, new RegExp(`http://127\\.0\\.0\\.1:${port}/api/clippers/published-metrics-starter\\.csv`));
      assert.match(operatorReady.links.nextPublishedMetricsStarterCsv, new RegExp(`http://127\\.0\\.0\\.1:${port}/api/clippers/next-published-metrics-starter\\.csv`));
      assert.equal(await readFile(batchEvidenceCsvPath, "utf8"), readyBeforeDownload);

      const operatorReadyPostResponse = await fetch(`http://127.0.0.1:${port}/api/clippers/operator-ready.json`, { method: "POST" });
      assert.notEqual(operatorReadyPostResponse.status, 200);
      assert.doesNotMatch(operatorReadyPostResponse.headers.get("content-type") || "", /application\/json/);

      const traversalResponse = await fetch(`http://127.0.0.1:${port}/clippers-workspace/%2e%2e/package.json`);
      assert.notEqual(traversalResponse.status, 200);
      assert.notEqual(traversalResponse.status, 500);

      const symlinkResponse = await fetch(`http://127.0.0.1:${port}/clippers-workspace/symlink-outside-test`);
      assert.equal(symlinkResponse.status, 403);

      const parentSymlinkResponse = await fetch(`http://127.0.0.1:${port}/clippers-workspace/symlink-dir-outside-test/package.json`);
      assert.equal(parentSymlinkResponse.status, 403);

      const badEncodingResponse = await fetch(`http://127.0.0.1:${port}/clippers-workspace/%E0%A4%A`);
      assert.notEqual(badEncodingResponse.status, 500);
    });
  } finally {
    await writeFile(batchEvidenceCsvPath, originalEvidenceCsv);
    await writeFile(masterEvidenceCsvPath, originalMasterEvidenceCsv);
    await rm(symlinkPath, { force: true });
    await rm(symlinkDirPath, { force: true, recursive: true });
  }
});

test("Streamer Growth CEO trusts only measured Metricool follower data", async () => {
  const port = "5560";
  const handoff = JSON.parse(await readFile(operatorHandoffJsonPath, "utf8"));
  handoff.totals = { ...handoff.totals, streamers: 1 };
  await writeFile(operatorHandoffJsonPath, `${JSON.stringify(handoff, null, 2)}\n`);
  await writeFile(streamerGrowthMetricsPath, `${JSON.stringify({
    source: "metricool",
    measuredAt: new Date().toISOString(),
    sportsAccountName: "Streamer Highlights",
    memesAccountName: "Streamer Reactions",
    publicProfileVerified: true,
    sportsProfileUrl: "https://www.tiktok.com/@streamersclipusa",
    memesProfileUrl: "https://www.tiktok.com/@streamersclips",
    sportsFollowers: 10_001,
    memesFollowers: 10_250,
    sportsViews30d: 120_000,
    memesViews30d: 130_000,
    published30d: 100,
    allowlistedCreators: 12,
    weeklyCandidates: 600,
    weeklyRightsCleared: 150,
    weeklyDraftReady: 100,
    weeklyMetricoolQueued: 100,
  }, null, 2)}\n`);

  await withServer({ HOST: "127.0.0.1", PORT: port }, async () => {
    let status = await (await fetch(`http://127.0.0.1:${port}/api/clippers/status`)).json();
    assert.equal(status.streamerGrowthCeo.currentFollowers, 10_001);
    assert.equal(status.streamerGrowthCeo.progressKnown, true);
    assert.equal(status.streamerGrowthCeo.metricsSource, "metricool");
    assert.equal(status.streamerGrowthCeo.nextAction.stage, "verify_monetization_eligibility");
    assert.equal(status.streamerGrowthCeo.monetizationGates.followers.met, true);
    assert.equal(status.streamerGrowthCeo.monetizationGates.views30d.met, true);
    assert.equal(status.streamerGrowthCeo.realPublishEnabled, false);

    const wrongProfileMetrics = JSON.parse(await readFile(streamerGrowthMetricsPath, "utf8"));
    wrongProfileMetrics.sportsProfileUrl = "https://www.tiktok.com/@someotheraccount";
    await writeFile(streamerGrowthMetricsPath, `${JSON.stringify(wrongProfileMetrics, null, 2)}\n`);
    status = await (await fetch(`http://127.0.0.1:${port}/api/clippers/status`)).json();
    assert.equal(status.streamerGrowthCeo.currentFollowers, null);
    assert.equal(status.streamerGrowthCeo.metricsSource, "metricool_not_imported");

    await writeFile(streamerGrowthMetricsPath, `${JSON.stringify({
      source: "metricool",
      measuredAt: new Date(Date.now() - 73 * 60 * 60_000).toISOString(),
      sportsAccountName: "Streamer Highlights",
      memesAccountName: "Streamer Reactions",
      sportsFollowers: 10_001,
      memesFollowers: 10_250,
      sportsViews30d: 120_000,
      memesViews30d: 130_000,
    }, null, 2)}\n`);
    status = await (await fetch(`http://127.0.0.1:${port}/api/clippers/status`)).json();
    assert.equal(status.streamerGrowthCeo.currentFollowers, null);
    assert.equal(status.streamerGrowthCeo.metricsSource, "metricool_not_imported");

    await writeFile(streamerGrowthMetricsPath, `${JSON.stringify({
      source: "metricool",
      measuredAt: new Date(Date.now() + 60_000).toISOString(),
      sportsAccountName: "Streamer Highlights",
      memesAccountName: "Streamer Reactions",
      sportsFollowers: 10_001,
      memesFollowers: 10_250,
      sportsViews30d: 120_000,
      memesViews30d: 130_000,
    }, null, 2)}\n`);
    status = await (await fetch(`http://127.0.0.1:${port}/api/clippers/status`)).json();
    assert.equal(status.streamerGrowthCeo.currentFollowers, null);
    assert.equal(status.streamerGrowthCeo.metricsSource, "metricool_not_imported");

    await writeFile(streamerGrowthMetricsPath, `${JSON.stringify({
      source: "manual",
      measuredAt: "2026-07-20T12:05:00.000Z",
      sportsAccountName: "Streamer Highlights",
      memesAccountName: "Streamer Reactions",
      sportsFollowers: 999_999,
      memesFollowers: 999_999,
      sportsViews30d: 9_999_999,
      memesViews30d: 9_999_999,
      published30d: 9_999,
    }, null, 2)}\n`);

    status = await (await fetch(`http://127.0.0.1:${port}/api/clippers/status`)).json();
    assert.equal(status.streamerGrowthCeo.currentFollowers, null);
    assert.equal(status.streamerGrowthCeo.progressKnown, false);
    assert.equal(status.streamerGrowthCeo.metricsSource, "metricool_not_imported");
    assert.equal(status.streamerGrowthCeo.nextAction.stage, "capture_metricool_baseline");
    assert.equal(status.streamerGrowthCeo.monetizationGates.followers.met, null);
    assert.equal(status.streamerGrowthCeo.monetizationGates.views30d.met, null);
  });
});

test("Streamer Growth CEO does not accept incomplete account routing confirmation", async () => {
  const port = "5561";
  await writeFile(streamerGrowthRoutingPath, `${JSON.stringify({
    source: "user_confirmed",
    confirmedAt: new Date().toISOString(),
    platform: "tiktok",
    sportsAccountName: "Streamer Highlights",
    memesAccountName: "Streamer Reactions",
    sportsConnected: true,
    memesConnected: false,
  }, null, 2)}\n`);

  await withServer({ HOST: "127.0.0.1", PORT: port }, async () => {
    const status = await (await fetch(`http://127.0.0.1:${port}/api/clippers/status`)).json();
    assert.equal(status.streamerGrowthCeo.routingConfirmation.confirmed, false);
    assert.equal(status.streamerGrowthCeo.status, "external_rebrand_required");
    assert.equal(status.streamerGrowthCeo.nextAction.stage, "rebrand_connected_accounts");
    assert.equal(status.streamerGrowthCeo.currentFollowers, null);
  });
});

test("Streamer Growth CEO rejects routing proof for the wrong TikTok handles", async () => {
  const port = "5571";
  await writeFile(streamerGrowthRoutingPath, `${JSON.stringify({
    source: "user_confirmed",
    confirmedAt: new Date().toISOString(),
    platform: "tiktok",
    sportsAccountName: "Streamer Highlights",
    memesAccountName: "Streamer Reactions",
    sportsConnected: true,
    memesConnected: true,
    publicProfileVerified: true,
    sportsProfileUrl: "https://www.tiktok.com/@unrelatedsportsclips",
    memesProfileUrl: "https://www.tiktok.com/@unrelatedstreamerclips",
  }, null, 2)}\n`);

  await withServer({ HOST: "127.0.0.1", PORT: port }, async () => {
    const status = await (await fetch(`http://127.0.0.1:${port}/api/clippers/status`)).json();
    assert.equal(status.streamerGrowthCeo.routingConfirmation.confirmed, false);
  });
});

test("Streamer Growth CEO ignores follower and view claims in account routing proof", async () => {
  const port = "5562";
  await writeFile(streamerGrowthRoutingPath, `${JSON.stringify({
    source: "user_confirmed",
    confirmedAt: new Date().toISOString(),
    platform: "tiktok",
    sportsAccountName: "Streamer Highlights",
    memesAccountName: "Streamer Reactions",
    sportsConnected: true,
    memesConnected: true,
    publicProfileVerified: true,
    sportsProfileUrl: "https://www.tiktok.com/@streamersclipusa",
    memesProfileUrl: "https://www.tiktok.com/@streamersclips",
    sportsFollowers: 999_999,
    memesFollowers: 999_999,
    sportsViews30d: 9_999_999,
    memesViews30d: 9_999_999,
  }, null, 2)}\n`);

  await withServer({ HOST: "127.0.0.1", PORT: port }, async () => {
    const status = await (await fetch(`http://127.0.0.1:${port}/api/clippers/status`)).json();
    assert.equal(status.streamerGrowthCeo.routingConfirmation.confirmed, true);
    assert.equal(status.streamerGrowthCeo.currentFollowers, null);
    assert.equal(status.streamerGrowthCeo.views30d, null);
    assert.equal(status.streamerGrowthCeo.progressKnown, false);
    assert.equal(status.streamerGrowthCeo.metricsSource, "metricool_not_imported");
    assert.equal(status.streamerGrowthCeo.nextAction.stage, "capture_metricool_baseline");
  });
});

test("Streamer blanket approvals require complete scopes and a real local evidence file", async () => {
  const port = "5527";
  const researchDir = path.join(workspaceRoot, "research");
  const outreachPath = path.join(workspaceRoot, "evidence-drop", "streamer-blanket-permission-outreach.csv");
  const evidenceDir = path.join(workspaceRoot, "evidence-drop", "real-clip-permissions");
  const evidenceUrl = "/clippers-workspace/evidence-drop/real-clip-permissions/real-creator-xyz.md";
  await mkdir(researchDir, { recursive: true });
  await writeFile(path.join(researchDir, "streamer-cohort-eu.json"), `${JSON.stringify({
    streamers: [{
      handle: "RealCreatorXYZ",
      twitchOfficialUrl: "https://www.twitch.tv/realcreatorxyz",
      contact: { type: "management_email", value: "rights@creatorhq.com", evidenceUrl: "https://creatorhq.com/contact" },
      clipPolicy: { rightsPolicy: "request_required", summary: "Written commercial permission is required.", evidenceUrl: "https://creatorhq.com/policy" },
    }],
  })}\n`);
  const header = ["handle", "contact_email", "outreach_status", "permission_status", "scope_tiktok", "scope_commercial", "scope_edits", "scope_future_clips", "evidence_link", "operator_notes", "updated_at", "no_ai", "min_publish_delay_hours", "context_review_required", "creator_credit_required", "allowed_account_names"];
  const writeOutreach = async (evidenceLink) => writeFile(outreachPath, `${renderTestCsvLine(header)}\n${renderTestCsvLine([
    "Real Creator XYZ", "rights@creatorhq.com", "responded", "approved_blanket", "yes", "yes", "yes", "yes", evidenceLink,
    "Creator granted written blanket commercial TikTok permission with complete scope.", "2026-07-20T12:00:00Z",
    "yes", "12", "yes", "yes", "Streamer Highlights|Streamer Reactions",
  ])}\n`);
  await writeOutreach("https://creatorhq.com/remote-proof");

  await withServer({ HOST: "127.0.0.1", PORT: port }, async () => {
    const remoteResponse = await fetch(`http://127.0.0.1:${port}/api/clippers/streamer-100-campaign.json`);
    assert.equal(remoteResponse.status, 200);
    const remoteCampaign = await remoteResponse.json();
    assert.equal(remoteCampaign.rows.length, 1, JSON.stringify(remoteCampaign));
    assert.equal(remoteCampaign.rows[0].rightsPolicy, "request_required");
    assert.equal(remoteCampaign.rows[0].permissionStatus, "approval_evidence_incomplete");
    assert.equal(remoteCampaign.blanketApprovedRows, 0);
    assert.equal(remoteCampaign.rows[0].canPublish, false);

    await mkdir(evidenceDir, { recursive: true });
    await writeFile(path.join(evidenceDir, "real-creator-xyz.md"), "Creator replied in writing and granted both TikTok pages commercial use of current and future stream clips, including vertical edits, captions, attribution rules, and revocation on written request.\n");
    await writeOutreach(evidenceUrl);
    const localResponse = await fetch(`http://127.0.0.1:${port}/api/clippers/streamer-100-campaign.json`);
    assert.equal(localResponse.status, 200);
    const localCampaign = await localResponse.json();
    assert.equal(localCampaign.rows[0].permissionStatus, "approved_blanket");
    assert.equal(localCampaign.blanketApprovedRows, 1);
    assert.deepEqual(localCampaign.rows[0].restrictions, {
      noAi: true,
      minimumPublishDelayHours: 12,
      contextReviewRequired: true,
      creatorCreditRequired: true,
      allowedAccountNames: ["Streamer Highlights", "Streamer Reactions"],
    });
    assert.equal(localCampaign.rows[0].canPublish, false);
    const status = await (await fetch(`http://127.0.0.1:${port}/api/clippers/status`)).json();
    assert.equal(status.streamer100Campaign.blanketApprovedRows, 1);
    assert.equal(status.streamerGrowthCeo.supply.allowlistedCreators, 1);
  });
});

test("Streamer campaign keeps 100 delivered requests ahead of unsent research rows", async () => {
  const port = "5528";
  const researchDir = path.join(workspaceRoot, "research");
  const outreachPath = path.join(workspaceRoot, "evidence-drop", "streamer-blanket-permission-outreach.csv");
  const header = ["handle", "contact_email", "outreach_status", "permission_status", "scope_tiktok", "scope_commercial", "scope_edits", "scope_future_clips", "evidence_link", "operator_notes", "updated_at"];
  const streamers = Array.from({ length: 101 }, (_, index) => {
    const handle = `creator${String(index + 1).padStart(3, "0")}`;
    return {
      handle,
      twitchOfficialUrl: `https://www.twitch.tv/${handle}`,
      contactEmail: `${handle}@example.com`,
      publicContact: { type: "business_email", value: `${handle}@example.com`, evidenceUrl: `https://example.com/${handle}` },
      clipPolicy: { summary: "Written commercial permission is required.", evidenceUrl: `https://example.com/${handle}/policy` },
      rightsPolicy: "request_required",
    };
  });
  await mkdir(researchDir, { recursive: true });
  await writeFile(path.join(researchDir, "streamer-cohort-eu.json"), `${JSON.stringify({ streamers })}\n`);
  const outreachLines = streamers.slice(1).map((row) => renderTestCsvLine([
    row.handle, row.contactEmail, "sent", "requested", "no", "no", "no", "no", "",
    "Blanket commercial TikTok request delivered; awaiting written response.", "2026-07-21T08:31:51Z",
  ]));
  await mkdir(path.dirname(outreachPath), { recursive: true });
  await writeFile(outreachPath, `${renderTestCsvLine(header)}\n${outreachLines.join("\n")}\n`);

  await withServer({ HOST: "127.0.0.1", PORT: port }, async () => {
    const campaign = await (await fetch(`http://127.0.0.1:${port}/api/clippers/streamer-100-campaign.json`)).json();
    assert.equal(campaign.rows.length, 100);
    assert.equal(campaign.outreachSentRows, 100);
    assert.equal(campaign.rows.some((row) => row.handle === "creator001"), false);
    assert.equal(campaign.rows.every((row) => row.outreachStatus === "sent"), true);
  });
});

test("Streamer campaign permanently excludes a creator with evidenced denial", async () => {
  const port = "5540";
  const researchDir = path.join(workspaceRoot, "research");
  const outreachPath = path.join(workspaceRoot, "evidence-drop", "streamer-blanket-permission-outreach.csv");
  const evidenceDir = path.join(workspaceRoot, "evidence-drop", "streamer-permissions");
  const evidenceUrl = "/clippers-workspace/evidence-drop/streamer-permissions/creator-denial.md";
  await mkdir(researchDir, { recursive: true });
  await mkdir(evidenceDir, { recursive: true });
  await writeFile(path.join(researchDir, "streamer-cohort-eu.json"), `${JSON.stringify({
    streamers: [{
      handle: "DeniedCreator",
      twitchOfficialUrl: "https://www.twitch.tv/deniedcreator",
      contactEmail: "rights@denied.example",
      publicContact: { type: "business_email", value: "rights@denied.example", evidenceUrl: "https://denied.example/contact" },
      clipPolicy: { summary: "Written commercial permission is required.", evidenceUrl: "https://denied.example/policy" },
      rightsPolicy: "request_required",
    }],
  })}\n`);
  await writeFile(path.join(evidenceDir, "creator-denial.md"), "The creator explicitly denied consent to edit, publish, distribute, or monetize their stream content on either TikTok account.\n");
  const header = ["handle", "contact_email", "outreach_status", "permission_status", "scope_tiktok", "scope_commercial", "scope_edits", "scope_future_clips", "evidence_link", "operator_notes", "updated_at"];
  await writeFile(outreachPath, `${renderTestCsvLine(header)}\n${renderTestCsvLine([
    "Denied Creator", "rights@denied.example", "responded", "denied", "no", "no", "no", "no", evidenceUrl,
    "Creator explicitly denied all editing and publication rights.", "2026-07-21T08:29:00Z",
  ])}\n`);

  await withServer({ HOST: "127.0.0.1", PORT: port }, async () => {
    const campaign = await (await fetch(`http://127.0.0.1:${port}/api/clippers/streamer-100-campaign.json`)).json();
    assert.equal(campaign.rows[0].permissionStatus, "denied");
    assert.equal(campaign.rows[0].priority, "exclude");
    assert.equal(campaign.rows[0].evidenceLink, evidenceUrl);
    assert.equal(campaign.deniedRows, 1);
    assert.equal(campaign.blanketApprovedRows, 0);
    assert.equal(campaign.rows[0].canPublish, false);
  });
});

test("Clippers canonicalizes repurposed TikTok account names without changing Metricool identifiers", async () => {
  await withServer({ HOST: "127.0.0.1", PORT: "5577" }, async () => {
    const origin = "http://127.0.0.1:5577";
    const response = await fetch(`${origin}/api/clippers/status`);
    assert.equal(response.status, 200);
    const status = await response.json();
    const highlights = status.tiktokAccountQueues.accounts.find((account) => account.accountId === "sports-daily");
    const reactions = status.tiktokAccountQueues.accounts.find((account) => account.accountId === "meme-radar");

    assert.equal(highlights.accountName, "Streamer Highlights");
    assert.equal(highlights.brand, "SPORT");
    assert.equal(reactions.accountName, "Streamer Reactions");
    assert.equal(reactions.brand, "memes");
    assert.ok(status.rows.every((row) => !["Sports Daily Clips", "Meme Radar"].includes(row.accountName)));
    assert.equal(status.metricoolApprovalRequired, true);
    assert.equal(status.realPublishEnabled, false);

    const endpointExpectations = [
      ["/api/clippers/tiktok-batch-account-summary.csv", ["Streamer Highlights", "Streamer Reactions"]],
      ["/api/clippers/tiktok-batch-account-summary.md", ["Streamer Highlights", "Streamer Reactions"]],
      ["/api/clippers/tiktok-account-queues.csv", ["Streamer Highlights", "Streamer Reactions"]],
      ["/api/clippers/tiktok-account-queues.md", ["Streamer Highlights", "Streamer Reactions"]],
      ["/api/clippers/tiktok-account-now.html?accountId=sports-daily", ["Streamer Highlights"]],
      ["/api/clippers/tiktok-account-now.html?accountId=meme-radar", ["Streamer Reactions"]],
      ["/api/clippers/tiktok-account-runbook.md?accountId=sports-daily", ["Streamer Highlights"]],
      ["/api/clippers/tiktok-account-runbook.md?accountId=meme-radar", ["Streamer Reactions"]],
      ["/api/clippers/operator-brief.md", ["Streamer Highlights", "Streamer Reactions"]],
      ["/api/clippers/operator-report.md", ["Streamer Highlights", "Streamer Reactions"]],
    ];
    for (const [pathname, expectedNames] of endpointExpectations) {
      const endpointResponse = await fetch(`${origin}${pathname}`);
      assert.equal(endpointResponse.status, 200, pathname);
      const body = await endpointResponse.text();
      for (const expectedName of expectedNames) assert.match(body, new RegExp(expectedName), pathname);
      assert.doesNotMatch(body, /Sports Daily Clips|Meme Radar/, pathname);
    }
  });
});

test("Clippers human review queue exposes authorized files without unlocking Metricool", async () => {
  const sadlightsDir = path.join(workspaceRoot, "quarantine", "sadlights-review");
  const leonidasDir = path.join(workspaceRoot, "quarantine", "esp-leonidas-review");
  await mkdir(sadlightsDir, { recursive: true });
  await mkdir(leonidasDir, { recursive: true });
  await writeFile(path.join(sadlightsDir, "sad.mp4"), Buffer.concat([Buffer.from("0000ftypisom"), Buffer.alloc(9_000)]));
  await writeFile(path.join(leonidasDir, "esp.mp4"), Buffer.from("review-only-source"));
  const contactSheet = Buffer.alloc(1_200);
  contactSheet.set([0xff, 0xd8, 0xff], 0);
  contactSheet.set([0xff, 0xd9], contactSheet.length - 2);
  await writeFile(path.join(sadlightsDir, "sad__contact-sheet.jpg"), contactSheet);
  await writeFile(path.join(sadlightsDir, "review-manifest.csv"), [
    "title,exact_source_url,local_raw_file,vertical_intake_file,source_age,source_views,creator_permission,audio_review,context_review,gameplay_rights_review,no_ai_required,status",
    '"Safe candidate","https://www.twitch.tv/sadlights/clip/ExactClip","sad.mp4","../../source-drop/memes/memes-real-53467d8f7dad.mp4","2 days","42","verified","required","required","required","yes","review_required"',
  ].join("\n"));
  await writeFile(path.join(leonidasDir, "review-manifest.csv"), [
    "source_id,title,source_url,source_posted_at,historical_views,duration_seconds,local_file,rights_status,rights_evidence,visual_review,audio_review,third_party_review,recency_status,intake_status,publish_allowed,notes",
    '1,"Rejected candidate","https://www.twitch.tv/esp_leonidas/clip/ExactClip","2026-07-01","12","8","esp.mp4","approved_blanket","proof","rejected_policy_risk","required","required","historical","rejected_visual_policy_risk","no","Visual policy risk requires rejection."',
  ].join("\n"));

  await withServer({ HOST: "127.0.0.1", PORT: "5578" }, async () => {
    const homeResponse = await fetch("http://127.0.0.1:5578/clippers");
    assert.equal(homeResponse.status, 200);
    assert.match(await homeResponse.text(), /href="\/api\/clippers\/human-review-queue\.html">Revisar candidatos<\/a>/);

    const jsonResponse = await fetch("http://127.0.0.1:5578/api/clippers/human-review-queue.json");
    assert.equal(jsonResponse.status, 200);
    const queue = await jsonResponse.json();
    assert.equal(queue.status, "human_review_required");
    assert.equal(queue.readOnly, false);
    assert.equal(queue.decisionRecordingEnabled, true);
    assert.equal(queue.decisionsUnlockPublishing, false);
    assert.equal(queue.decisionLedgerStatus, "not_recorded");
    assert.equal(queue.invalidDecisionRows, 0);
    assert.equal(queue.intakeTargets.length, 10);
    assert.match(queue.intakeTargets[0].targetMediaUrl, /^\/clippers-workspace\/source-drop\//);
    assert.equal(queue.metricoolApprovalRequired, true);
    assert.equal(queue.realPublishEnabled, false);
    assert.deepEqual(queue.totals, { rows: 2, filesReady: 2, reviewRequired: 1, approvedForIntake: 0, rejected: 1, noAi: 1, publishAllowed: 0 });
    assert.ok(queue.rows.every((row) => row.publishAllowed === false));
    const sadlightsRow = queue.rows.find((row) => row.creator === "sadlights");
    assert.equal(sadlightsRow.noAiRequired, true);
    assert.equal(sadlightsRow.sourceUrl, "https://www.twitch.tv/sadlights/clip/ExactClip");
    assert.equal(sadlightsRow.contactSheetUrl, "/clippers-workspace/quarantine/sadlights-review/sad__contact-sheet.jpg");
    assert.equal(queue.rows.find((row) => row.creator === "ESP Leonidas").status, "rejected_visual_policy_risk");

    const htmlResponse = await fetch("http://127.0.0.1:5578/api/clippers/human-review-queue.html");
    assert.equal(htmlResponse.status, 200);
    const body = await htmlResponse.text();
    assert.match(body, /Revisar candidatos/);
    assert.match(body, /Safe candidate/);
    assert.match(body, /Rejected candidate/);
    assert.match(body, /IA:<\/strong> prohibida/);
    assert.match(body, /Metricool:<\/strong> bloqueado/);
    assert.match(body, /Descartado/);
    assert.match(body, /action="\/api\/clippers\/human-review-decision"/);
    assert.match(body, /Aprobar para intake/);
    assert.match(body, /Vista rápida · abre la imagen completa/);
    assert.match(body, /sad__contact-sheet\.jpg/);
    assert.doesNotMatch(body, /ready to publish|listo para publicar/i);

    const contactSheetResponse = await fetch("http://127.0.0.1:5578/clippers-workspace/quarantine/sadlights-review/sad__contact-sheet.jpg");
    assert.equal(contactSheetResponse.status, 200);
    assert.equal(contactSheetResponse.headers.get("content-type"), "image/jpeg");

    const contactSheetPath = path.join(sadlightsDir, "sad__contact-sheet.jpg");
    const outsideContactSheetPath = path.join(testWorkspaceParent, "outside-contact-sheet.jpg");
    await writeFile(outsideContactSheetPath, contactSheet);
    await rm(contactSheetPath, { force: true });
    await symlink(outsideContactSheetPath, contactSheetPath);
    const symlinkedContactQueue = await (await fetch("http://127.0.0.1:5578/api/clippers/human-review-queue.json")).json();
    assert.equal(symlinkedContactQueue.rows.find((row) => row.creator === "sadlights").contactSheetUrl, "");
    await rm(contactSheetPath, { force: true });
    await rm(outsideContactSheetPath, { force: true });
    await writeFile(contactSheetPath, Buffer.alloc(1_200));
    const invalidContactQueue = await (await fetch("http://127.0.0.1:5578/api/clippers/human-review-queue.json")).json();
    assert.equal(invalidContactQueue.rows.find((row) => row.creator === "sadlights").contactSheetUrl, "");
    await writeFile(contactSheetPath, contactSheet);

    const baseDecision = {
      id: "sadlights-review:sad.mp4",
      decision: "approved_for_intake",
      audioStatus: "approved",
      contextStatus: "approved",
      thirdPartyStatus: "approved",
      humanReviewConfirmed: "yes",
      aiUsed: "no",
      notes: "Reviewed the full clip and confirmed clean audio, intact context, and no third-party material.",
    };
    const postDecision = (values, { token = csrfToken } = {}) => fetch("http://127.0.0.1:5578/api/clippers/human-review-decision", {
      method: "POST",
      redirect: "manual",
      headers: { origin: "http://127.0.0.1:5578" },
      body: new URLSearchParams({ ...(token ? { csrfToken: token } : {}), returnTo: "/api/clippers/human-review-queue.html", ...values }),
    });

    const decisionHeader = ["id", "creator", "title", "decision", "audio_status", "context_status", "third_party_status", "human_review_confirmed", "ai_used", "notes", "reviewed_at"];
    const tamperedDecision = [
      "sadlights-review:sad.mp4", "sadlights", "Safe candidate", "approved_for_intake", "approved", "approved", "approved", "yes", "yes",
      "Manually changed row that violates the creator no-AI restriction and must be ignored.", "2026-07-21T10:00:00.000Z",
    ];
    await writeFile(humanReviewDecisionsPath, `${renderTestCsvLine(decisionHeader)}\n${renderTestCsvLine(tamperedDecision)}\n`);
    const tamperedQueue = await (await fetch("http://127.0.0.1:5578/api/clippers/human-review-queue.json")).json();
    assert.equal(tamperedQueue.invalidDecisionRows, 1);
    assert.equal(tamperedQueue.totals.approvedForIntake, 0);
    assert.equal(tamperedQueue.rows.find((row) => row.creator === "sadlights").humanDecision, "pending");
    await rm(humanReviewDecisionsPath, { force: true });

    const outsideLedgerPath = path.join(testWorkspaceParent, "outside-human-review-decisions.csv");
    await writeFile(outsideLedgerPath, `${renderTestCsvLine(decisionHeader)}\n${renderTestCsvLine(tamperedDecision)}\n`);
    await symlink(outsideLedgerPath, humanReviewDecisionsPath);
    const symlinkedQueue = await (await fetch("http://127.0.0.1:5578/api/clippers/human-review-queue.json")).json();
    assert.equal(symlinkedQueue.decisionLedgerStatus, "human_review_decisions_symlink_blocked");
    assert.equal(symlinkedQueue.totals.approvedForIntake, 0);
    await rm(humanReviewDecisionsPath, { force: true });
    await rm(outsideLedgerPath, { force: true });

    const missingCsrf = await postDecision(baseDecision, { token: "" });
    assert.equal(missingCsrf.status, 403);
    assert.equal((await missingCsrf.json()).error, "invalid_or_missing_csrf_token");

    const aiRejected = await postDecision({ ...baseDecision, aiUsed: "yes" });
    assert.equal(aiRejected.status, 400);
    assert.equal((await aiRejected.json()).error, "creator_prohibits_ai_processing");

    const incompleteChecks = await postDecision({ ...baseDecision, thirdPartyStatus: "rejected" });
    assert.equal(incompleteChecks.status, 400);
    assert.equal((await incompleteChecks.json()).error, "all_human_review_checks_must_be_approved");

    const secretNotes = await postDecision({
      ...baseDecision,
      notes: "Reviewed the full clip and copied the API key into this unsafe decision note.",
    });
    assert.equal(secretNotes.status, 400);
    assert.equal((await secretNotes.json()).error, "human_review_notes_secret_like");

    const rejectedOverride = await postDecision({
      ...baseDecision,
      id: "esp-leonidas-review:esp.mp4",
      aiUsed: "no",
    });
    assert.equal(rejectedOverride.status, 409);
    assert.equal((await rejectedOverride.json()).error, "manifest_rejection_cannot_be_overridden");

    await rm(path.join(workspaceRoot, "evidence-drop"), { recursive: true, force: true });
    const approved = await postDecision(baseDecision);
    assert.equal(approved.status, 303);
    assert.equal(approved.headers.get("location"), "/api/clippers/human-review-queue.html");

    const updatedQueue = await (await fetch("http://127.0.0.1:5578/api/clippers/human-review-queue.json")).json();
    assert.equal(updatedQueue.status, "human_review_complete_for_intake");
    assert.deepEqual(updatedQueue.totals, { rows: 2, filesReady: 2, reviewRequired: 0, approvedForIntake: 1, rejected: 1, noAi: 1, publishAllowed: 0 });
    const approvedRow = updatedQueue.rows.find((row) => row.creator === "sadlights");
    assert.equal(approvedRow.humanDecision, "approved_for_intake");
    assert.equal(approvedRow.humanReviewComplete, true);
    assert.equal(approvedRow.recordedChecks.aiUsed, "no");
    assert.equal(approvedRow.publishAllowed, false);
    assert.equal(updatedQueue.metricoolApprovalRequired, true);
    assert.equal(updatedQueue.realPublishEnabled, false);
    assert.equal(updatedQueue.decisionLedgerStatus, "ready");
    assert.equal(updatedQueue.invalidDecisionRows, 0);

    const updatedBody = await (await fetch("http://127.0.0.1:5578/api/clippers/human-review-queue.html")).text();
    assert.match(updatedBody, /Decisión guardada:/);
    assert.match(updatedBody, /Aprobado para intake/);
    assert.match(updatedBody, /Metricool:<\/strong> bloqueado/);
    assert.match(updatedBody, /action="\/api\/clippers\/human-review-promote"/);
    assert.match(updatedBody, /Resultado vertical asociado/);
    assert.match(updatedBody, /name="finalOutputReviewed"/);

    const researchDir = path.join(workspaceRoot, "research");
    const permissionsDir = path.join(workspaceRoot, "evidence-drop", "streamer-permissions");
    const outreachPath = path.join(workspaceRoot, "evidence-drop", "streamer-blanket-permission-outreach.csv");
    const permissionEvidenceUrl = "/clippers-workspace/evidence-drop/streamer-permissions/sadlights-blanket-permission-2026-07-21.md";
    await mkdir(researchDir, { recursive: true });
    await mkdir(permissionsDir, { recursive: true });
    await writeFile(path.join(researchDir, "streamer-cohort-indie.json"), `${JSON.stringify({
      streamers: [{
        handle: "sadlights",
        twitchOfficialUrl: "https://www.twitch.tv/sadlights",
        contact: { type: "business_email", value: "rights@sadlights.example", evidenceUrl: "https://sadlights.example/contact" },
        clipPolicy: { rightsPolicy: "request_required", summary: "Written commercial permission required.", evidenceUrl: "https://sadlights.example/policy" },
      }],
    })}\n`);
    await writeFile(path.join(permissionsDir, "sadlights-blanket-permission-2026-07-21.md"), "Creator granted written blanket permission for commercial TikTok clips on both named accounts, with human-only editing, full-context review, creator credit, a twelve-hour delay, and removal on written request.\n");
    const outreachHeader = ["handle", "contact_email", "outreach_status", "permission_status", "scope_tiktok", "scope_commercial", "scope_edits", "scope_future_clips", "evidence_link", "operator_notes", "updated_at", "no_ai", "min_publish_delay_hours", "context_review_required", "creator_credit_required", "allowed_account_names"];
    await writeFile(outreachPath, `${renderTestCsvLine(outreachHeader)}\n${renderTestCsvLine([
      "sadlights", "rights@sadlights.example", "responded", "approved_blanket", "yes", "yes", "yes", "yes", permissionEvidenceUrl,
      "Creator granted written blanket commercial TikTok permission with enforceable restrictions.", "2026-07-21T08:36:00Z",
      "yes", "12", "yes", "yes", "Streamer Highlights|Streamer Reactions",
    ])}\n`);
    const approvedQueueRow = updatedQueue.rows.find((row) => row.creator === "sadlights");
    const promotionTarget = updatedQueue.intakeTargets.find((row) => row.queueItemId === approvedQueueRow.suggestedQueueItemId);
    assert.ok(promotionTarget);
    const postPromotion = (values) => fetch("http://127.0.0.1:5578/api/clippers/human-review-promote", {
      method: "POST",
      redirect: "manual",
      headers: { origin: "http://127.0.0.1:5578" },
      body: new URLSearchParams({
        csrfToken,
        returnTo: "/api/clippers/human-review-queue.html",
        id: baseDecision.id,
        metricoolQueueItemId: promotionTarget.queueItemId,
        ...values,
      }),
    });
    const wrongTarget = updatedQueue.intakeTargets.find((row) => row.queueItemId !== promotionTarget.queueItemId);
    const mismatchedTarget = await fetch("http://127.0.0.1:5578/api/clippers/human-review-promote", {
      method: "POST",
      headers: { origin: "http://127.0.0.1:5578" },
      body: new URLSearchParams({
        csrfToken,
        id: baseDecision.id,
        metricoolQueueItemId: wrongTarget.queueItemId,
        originalStreamEndedAt: "2026-07-01T12:00:00Z",
        finalOutputReviewed: "yes",
        promotionConfirmed: "yes",
      }),
    });
    assert.equal(mismatchedTarget.status, 409);
    assert.equal((await mismatchedTarget.json()).error, "human_review_target_does_not_match_candidate_mapping");
    const missingFinalOutputReview = await postPromotion({ promotionConfirmed: "yes", originalStreamEndedAt: "2026-07-01T12:00:00Z" });
    assert.equal(missingFinalOutputReview.status, 400);
    assert.equal((await missingFinalOutputReview.json()).error, "human_review_final_output_confirmation_required");
    const missingDelayProof = await postPromotion({ promotionConfirmed: "yes", finalOutputReviewed: "yes" });
    assert.equal(missingDelayProof.status, 400);
    assert.equal((await missingDelayProof.json()).error, "original_stream_ended_at_required_for_creator_delay");

    const promoted = await postPromotion({ promotionConfirmed: "yes", finalOutputReviewed: "yes", originalStreamEndedAt: "2026-07-01T12:00:00Z" });
    assert.equal(promoted.status, 303);
    assert.equal(promoted.headers.get("location"), "/api/clippers/human-review-queue.html");
    const promotedFile = path.join(workspaceRoot, "source-drop", promotionTarget.category, promotionTarget.targetFileName);
    assert.equal((await stat(promotedFile)).size, 9_012);
    const promotedManifest = await readFile(path.join(workspaceRoot, "source-drop", promotionTarget.category, "source-drop-manifest.csv"), "utf8");
    assert.match(promotedManifest, /owned_or_permissioned/);
    assert.match(promotedManifest, /https:\/\/www\.twitch\.tv\/sadlights\/clip\/ExactClip/);
    assert.match(promotedManifest, /Credit: @sadlights/);
    assert.match(promotedManifest, /,none,/);

    await writeFile(promotedFile, Buffer.concat([Buffer.from("0000ftypisom"), Buffer.alloc(9_500)]));
    const promotedManifestPath = path.join(workspaceRoot, "source-drop", promotionTarget.category, "source-drop-manifest.csv");
    await writeFile(promotedManifestPath, promotedManifest.replace(",none,", ",ai_assisted,"));
    const aiDerivedBlockedResponse = await fetch("http://127.0.0.1:5578/api/clippers/human-review-promote", {
      method: "POST",
      headers: { origin: "http://127.0.0.1:5578" },
      body: new URLSearchParams({
        csrfToken,
        id: baseDecision.id,
        metricoolQueueItemId: promotionTarget.queueItemId,
        originalStreamEndedAt: "2026-07-01T12:00:00Z",
        finalOutputReviewed: "yes",
        promotionConfirmed: "yes",
      }),
    });
    assert.equal(aiDerivedBlockedResponse.status, 409);
    assert.equal((await aiDerivedBlockedResponse.json()).error, "target_derived_file_provenance_missing");
    await writeFile(promotedManifestPath, promotedManifest.replace(",none,", ",deterministic_ffmpeg_no_ai,"));
    const reusedDerivedResponse = await fetch("http://127.0.0.1:5578/api/clippers/human-review-promote", {
      method: "POST",
      headers: { origin: "http://127.0.0.1:5578" },
      body: new URLSearchParams({
        csrfToken,
        id: baseDecision.id,
        metricoolQueueItemId: promotionTarget.queueItemId,
        originalStreamEndedAt: "2026-07-01T12:00:00Z",
        finalOutputReviewed: "yes",
        promotionConfirmed: "yes",
      }),
    });
    assert.equal(reusedDerivedResponse.status, 200);
    const reusedDerived = await reusedDerivedResponse.json();
    assert.equal(reusedDerived.ok, true);
    assert.equal(reusedDerived.reusedDerivedTarget, true);
    assert.equal(reusedDerived.sourceFileCopied, false);
    const derivedManifest = await readFile(promotedManifestPath, "utf8");
    assert.match(derivedManifest, /deterministic_ffmpeg_no_ai/);

    await writeFile(
      promotedManifestPath,
      derivedManifest.replace("owned_or_permissioned", "review_required"),
    );
    const reviewedDerivedResponse = await fetch("http://127.0.0.1:5578/api/clippers/human-review-promote", {
      method: "POST",
      headers: { origin: "http://127.0.0.1:5578" },
      body: new URLSearchParams({
        csrfToken,
        id: baseDecision.id,
        metricoolQueueItemId: promotionTarget.queueItemId,
        originalStreamEndedAt: "2026-07-01T12:00:00Z",
        finalOutputReviewed: "yes",
        promotionConfirmed: "yes",
      }),
    });
    assert.equal(reviewedDerivedResponse.status, 200);
    assert.equal((await reviewedDerivedResponse.json()).reusedDerivedTarget, true);

    const intakeAfterPromotion = await (await fetch("http://127.0.0.1:5578/api/clippers/real-clip-intake-validation.json")).json();
    const promotedIntakeRow = intakeAfterPromotion.rows.find((row) => row.queueItemId === promotionTarget.queueItemId);
    assert.equal(promotedIntakeRow.status, "ready_for_source_drop_import", JSON.stringify(promotedIntakeRow));
    const queueAfterPromotion = await (await fetch("http://127.0.0.1:5578/api/clippers/human-review-queue.json")).json();
    assert.equal(queueAfterPromotion.realPublishEnabled, false);
    assert.equal(queueAfterPromotion.metricoolApprovalRequired, true);
    assert.ok(queueAfterPromotion.rows.every((row) => row.publishAllowed === false));
  });
});

test("Clippers external proof recorder rejects symlinked external proof directories", async () => {
  const port = "5545";
  const externalProofsPath = path.join(workspaceRoot, "evidence-drop", "external-closeout-proofs");
  const outsideProofsPath = path.join(testWorkspaceParent, "outside-external-closeout-proofs");
  const outsideProofFilePath = path.join(outsideProofsPath, "account-streamer-pulse-tiktok.md");
  const originalExternalEvidenceCsv = await readFile(externalCloseoutEvidenceCsvPath, "utf8");
  await rm(externalProofsPath, { recursive: true, force: true });
  await mkdir(outsideProofsPath, { recursive: true });
  await writeFile(outsideProofFilePath, "outside proof should stay untouched\n");
  await symlink(outsideProofsPath, externalProofsPath);

  await withServer({ HOST: "127.0.0.1", PORT: port }, async () => {
    const response = await fetch(`http://127.0.0.1:${port}/api/clippers/external-evidence/record-next-proof`, {
      method: "POST",
      body: new URLSearchParams({
        csrfToken,
        closeoutId: "account:streamer-pulse:tiktok",
        proofReference: "https://www.tiktok.com/@streamerpulse",
        operatorNotes: "Verified the Streamer Pulse TikTok account ownership and profile URL in the official TikTok portal today.",
        proofDetails: [
          "The public profile reference is https://www.tiktok.com/@streamerpulse.",
          "The operator confirmed the account belongs to the Clippers streamer lane and recorded this non-secret proof locally.",
          "The record intentionally avoids private login material and includes only public profile and operator confirmation details.",
        ].join(" "),
      }),
    });
    assert.equal(response.status, 403);
    const result = await response.json();
    assert.equal(result.error, "invalid_external_proof_path");
    assert.equal(await readFile(outsideProofFilePath, "utf8"), "outside proof should stay untouched\n");
    assert.equal(await readFile(externalCloseoutEvidenceCsvPath, "utf8"), originalExternalEvidenceCsv);
    assert.doesNotMatch(JSON.stringify(result), /outside-external-closeout-proofs|\/Users\/|\/var\/folders/);
  });
});

test("Clippers local operator server refuses non-loopback host without explicit opt-in", async () => {
  const port = "5511";
  await withServer({ HOST: "0.0.0.0", PORT: port }, async ({ getOutput }) => {
    const output = getOutput();
    assert.match(output, /Refusing non-loopback HOST=0\.0\.0\.0/);
    const healthResponse = await fetch(`http://127.0.0.1:${port}/api/health`);
    assert.equal(healthResponse.status, 200);
  });
});

test("Clippers real clip gap does not count upload pack files as real without source metadata", async () => {
  const port = "5525";
  const uploadPackReport = JSON.parse(await readFile(uploadPackReportJsonPath, "utf8"));
  uploadPackReport.rows = (uploadPackReport.rows || []).map((row) => {
    const { sourcePath, sourceFileName, ...rest } = row;
    return rest;
  });
  await writeFile(uploadPackReportJsonPath, JSON.stringify(uploadPackReport, null, 2));
  const workbook = JSON.parse(await readFile(currentBatchWorkbookJsonPath, "utf8"));
  workbook.rows = (workbook.rows || []).map((row) => {
    const { sourcePath, sourceFileName, ...rest } = row;
    return rest;
  });
  await writeFile(currentBatchWorkbookJsonPath, JSON.stringify(workbook, null, 2));

  await withServer({ HOST: "127.0.0.1", PORT: port }, async () => {
    const response = await fetch(`http://127.0.0.1:${port}/api/clippers/real-clip-gap.json`);
    assert.equal(response.status, 200);
    const realClipGap = await response.json();
    assert.equal(realClipGap.status, "mixed_sources_need_review");
    assert.equal(realClipGap.realClipRows, 0);
    assert.equal(realClipGap.generatedOwnedRows, 0);
    assert.equal(realClipGap.missingRealClips, 10);
    assert.ok(realClipGap.blockers.includes("real_clip_sources_missing_10"));
    assert.equal(realClipGap.rows[0].sourceKind, "unknown_needs_review");
    assert.match(realClipGap.rows[0].detail, /do not count this upload-pack file as a real clip/);
    assert.doesNotMatch(JSON.stringify(realClipGap), /\/Users\/|clippers-workspace\/scheduled\/metricool-current-batch-upload-pack/);
  });
});

test("Clippers real clip intake validation requires blanket approval beyond standalone rights evidence", async () => {
  const port = "5526";
  const sourceUploadFile = path.join(workspaceRoot, "scheduled", "metricool-current-batch-upload-pack", "02_sport_sports-daily_7129d59b5f5e.mp4");
  const replacementFileName = "sports-real-7129d59b5f5e.mp4";
  const replacementPath = path.join(workspaceRoot, "source-drop", "sports", replacementFileName);
  const manifestPath = path.join(workspaceRoot, "source-drop", "sports", "source-drop-manifest.csv");
  await mkdir(path.dirname(replacementPath), { recursive: true });
  await cp(sourceUploadFile, replacementPath);
  await writeFile(manifestPath, [
    "category,title,url,source,platform,target_file_name,rights_status,evidence_link,priority,notes",
    "sports,Permissioned highlight replacement,https://www.tiktok.com/@creator/video/1234567890123456789,@creator,tiktok,sports-real-7129d59b5f5e.mp4,owned_or_permissioned,https://rights.receipts.local/creator-permission-letter,high,Creator permission recorded for this replacement clip before source drop import.",
    "",
  ].join("\n"));

  await withServer({ HOST: "127.0.0.1", PORT: port }, async () => {
    const response = await fetch(`http://127.0.0.1:${port}/api/clippers/real-clip-intake-validation.json`);
    assert.equal(response.status, 200);
    const validation = await response.json();
    const readyRow = validation.rows.find((row) => row.queueItemId === "7129d59b5f5e");
    assert.equal(validation.status, "blocked");
    assert.equal(validation.readyRows, 0);
    assert.equal(validation.blockedRows, 10);
    assert.equal(readyRow.status, "blocked");
    assert.deepEqual(readyRow.blockers, ["not_in_blanket_campaign"]);
    assert.equal(readyRow.exactUrlOk, true);
    assert.equal(readyRow.rightsStatus, "owned_or_permissioned");
    assert.equal(readyRow.evidenceLinkPresent, true);
    assert.equal(readyRow.notesOk, true);
    assert.doesNotMatch(JSON.stringify(validation), /\/Users\/|proof\.example\.com|1234567890123456789/);
  });
});

test("Clippers real clip intake enforces blanket creator restrictions before approval", async () => {
  const port = "5541";
  const researchDir = path.join(workspaceRoot, "research");
  const sourceUploadFile = path.join(workspaceRoot, "scheduled", "metricool-current-batch-upload-pack", "02_sport_sports-daily_7129d59b5f5e.mp4");
  const replacementFileName = "sports-real-7129d59b5f5e.mp4";
  const replacementPath = path.join(workspaceRoot, "source-drop", "sports", replacementFileName);
  const manifestPath = path.join(workspaceRoot, "source-drop", "sports", "source-drop-manifest.csv");
  const outreachPath = path.join(workspaceRoot, "evidence-drop", "streamer-blanket-permission-outreach.csv");
  const permissionDir = path.join(workspaceRoot, "evidence-drop", "streamer-permissions");
  const permissionUrl = "/clippers-workspace/evidence-drop/streamer-permissions/sadlights.md";
  const currentSessionPacket = JSON.parse(await readFile(sessionPacketJsonPath, "utf8"));
  const canonicalPublishAt = currentSessionPacket.rows.find((row) => row.metricoolQueueItemId === "7129d59b5f5e")?.publishAt;
  assert.ok(canonicalPublishAt);
  const originalStreamEndedAt = new Date(Date.parse(canonicalPublishAt) - 13 * 60 * 60_000).toISOString();
  await mkdir(path.dirname(replacementPath), { recursive: true });
  await mkdir(researchDir, { recursive: true });
  await mkdir(permissionDir, { recursive: true });
  await writeFile(path.join(researchDir, "streamer-cohort-eu.json"), `${JSON.stringify({
    streamers: [{
      handle: "sadlights",
      twitchOfficialUrl: "https://www.twitch.tv/sadlights",
      contactEmail: "rights@sadlights.example",
      publicContact: { type: "business_email", value: "rights@sadlights.example", evidenceUrl: "https://sadlights.example/contact" },
      clipPolicy: { summary: "Written commercial permission is required.", evidenceUrl: "https://sadlights.example/policy" },
      rightsPolicy: "request_required",
    }],
  })}\n`);
  await cp(sourceUploadFile, replacementPath);
  await writeFile(path.join(permissionDir, "sadlights.md"), "sadlights granted written blanket permission for monetized TikTok posts, vertical edits, captions, future public clips, creator credit, and revocation on request.\n");
  const outreachHeader = ["handle", "contact_email", "outreach_status", "permission_status", "scope_tiktok", "scope_commercial", "scope_edits", "scope_future_clips", "evidence_link", "operator_notes", "updated_at", "no_ai", "min_publish_delay_hours", "context_review_required", "creator_credit_required", "allowed_account_names"];
  await writeFile(outreachPath, `${renderTestCsvLine(outreachHeader)}\n${renderTestCsvLine([
    "sadlights", "rights@sadlights.example", "responded", "approved_blanket", "yes", "yes", "yes", "yes", permissionUrl,
    "Creator approved both TikTok accounts with enforceable restrictions.", "2026-07-21T08:36:00Z",
    "yes", "12", "yes", "yes", "Streamer Highlights",
  ])}\n`);
  const manifestHeader = "category,title,url,source,platform,target_file_name,rights_status,evidence_link,priority,notes,ai_processing,original_stream_ended_at,planned_publish_at,context_review_status,credit_text";
  const baseCells = [
    "sports", "Permissioned streamer replacement", "https://www.twitch.tv/sadlights/clip/BadStupidOxCoolStoryBro-c8v3bRtVDT0y2HeF", "sadlights", "twitch",
    replacementFileName, "owned_or_permissioned", permissionUrl, "high", "Creator permission and gameplay policy were reviewed before source-drop import.",
  ];
  await writeFile(manifestPath, `${manifestHeader}\n${renderTestCsvLine([...baseCells, "", "", "", "", ""])}\n`);

  await withServer({ HOST: "127.0.0.1", PORT: port }, async () => {
    const blocked = await (await fetch(`http://127.0.0.1:${port}/api/clippers/real-clip-intake-validation.json`)).json();
    const blockedRow = blocked.rows.find((row) => row.queueItemId === "7129d59b5f5e");
    assert.equal(blockedRow.accountName, "Streamer Highlights");
    assert.equal(blockedRow.creatorPermissionStatus, "approved_blanket");
    assert.ok(blockedRow.blockers.includes("creator_no_ai_processing_not_verified"));
    assert.ok(blockedRow.blockers.includes("creator_context_review_not_approved"));
    assert.ok(blockedRow.blockers.includes("creator_credit_text_missing"));
    assert.ok(blockedRow.blockers.includes("creator_minimum_publish_delay_not_verified"));

    await writeFile(manifestPath, `${manifestHeader}\n${renderTestCsvLine([
      ...baseCells.slice(0, 2),
      "https://www.twitch.tv/anothercreator/clip/BadStupidOxCoolStoryBro-c8v3bRtVDT0y2HeF",
      ...baseCells.slice(3),
      "deterministic_ffmpeg_no_ai", originalStreamEndedAt, canonicalPublishAt, "approved", "Clip by @sadlights from the original Twitch stream.",
    ])}\n`);
    const mismatchedSource = await (await fetch(`http://127.0.0.1:${port}/api/clippers/real-clip-intake-validation.json`)).json();
    const mismatchedSourceRow = mismatchedSource.rows.find((row) => row.queueItemId === "7129d59b5f5e");
    assert.ok(mismatchedSourceRow.blockers.includes("source_url_creator_not_verified"));

    const wrongPlannedPublishAt = new Date(Date.parse(canonicalPublishAt) + 5 * 60_000).toISOString();
    await writeFile(manifestPath, `${manifestHeader}\n${renderTestCsvLine([
      ...baseCells,
      "deterministic_ffmpeg_no_ai", originalStreamEndedAt, wrongPlannedPublishAt, "approved", "credit",
    ])}\n`);
    const weakProof = await (await fetch(`http://127.0.0.1:${port}/api/clippers/real-clip-intake-validation.json`)).json();
    const weakProofRow = weakProof.rows.find((row) => row.queueItemId === "7129d59b5f5e");
    assert.ok(weakProofRow.blockers.includes("creator_credit_text_missing"));
    assert.ok(weakProofRow.blockers.includes("creator_minimum_publish_delay_not_verified"));
    assert.equal(weakProofRow.creatorRestrictionChecks.plannedPublishMatchesQueue, false);

    await writeFile(manifestPath, `${manifestHeader}\n${renderTestCsvLine([
      ...baseCells,
      "deterministic_ffmpeg_no_ai", originalStreamEndedAt, canonicalPublishAt, "approved", "Clip by @sadlights - watch the original stream on Twitch.",
    ])}\n`);
    const ready = await (await fetch(`http://127.0.0.1:${port}/api/clippers/real-clip-intake-validation.json`)).json();
    const readyRow = ready.rows.find((row) => row.queueItemId === "7129d59b5f5e");
    assert.equal(readyRow.status, "ready_for_source_drop_import", JSON.stringify(readyRow));
    assert.deepEqual(readyRow.blockers, []);
    assert.equal(readyRow.creatorRestrictionChecks.minimumPublishDelayVerified, true);
    assert.equal(readyRow.creatorRestrictionChecks.allowedAccount, true);
  });
});

test("Clippers streamer intake blocks TikTok and YouTube creators outside the blanket campaign", async () => {
  const port = "5572";
  const sourceUploadFile = path.join(workspaceRoot, "scheduled", "metricool-current-batch-upload-pack", "02_sport_sports-daily_7129d59b5f5e.mp4");
  const replacementFileName = "sports-real-7129d59b5f5e.mp4";
  const replacementPath = path.join(workspaceRoot, "source-drop", "sports", replacementFileName);
  const manifestPath = path.join(workspaceRoot, "source-drop", "sports", "source-drop-manifest.csv");
  const memesReplacementFileName = "memes-real-53467d8f7dad.mp4";
  const memesReplacementPath = path.join(workspaceRoot, "source-drop", "memes", memesReplacementFileName);
  const memesManifestPath = path.join(workspaceRoot, "source-drop", "memes", "source-drop-manifest.csv");
  await mkdir(path.dirname(replacementPath), { recursive: true });
  await mkdir(path.dirname(memesReplacementPath), { recursive: true });
  await cp(sourceUploadFile, replacementPath);
  await cp(sourceUploadFile, memesReplacementPath);
  await writeFile(manifestPath, [
    "category,title,url,source,platform,target_file_name,rights_status,evidence_link,priority,notes",
    `sports,Unlisted TikTok streamer replacement,https://www.tiktok.com/@notallowlisted/video/1234567890123456789,@notallowlisted,tiktok,${replacementFileName},owned_or_permissioned,https://rights.receipts.local/unlisted-tiktok,high,Operator supplied a TikTok clip but the creator has no blanket campaign approval.`,
    "",
  ].join("\n"));
  await writeFile(memesManifestPath, [
    "category,title,url,source,platform,target_file_name,rights_status,evidence_link,priority,notes",
    `memes,Unlisted YouTube streamer replacement,https://www.youtube.com/shorts/abcdefghijk,@notyoutubeallowlisted,youtube,${memesReplacementFileName},owned_or_permissioned,https://rights.receipts.local/unlisted-youtube,high,Operator supplied a YouTube clip but the creator has no blanket campaign approval.`,
    "",
  ].join("\n"));

  await withServer({ HOST: "127.0.0.1", PORT: port }, async () => {
    const validation = await (await fetch(`http://127.0.0.1:${port}/api/clippers/real-clip-intake-validation.json`)).json();
    for (const queueItemId of ["7129d59b5f5e", "53467d8f7dad"]) {
      const row = validation.rows.find((candidate) => candidate.queueItemId === queueItemId);
      assert.equal(row.creatorPermissionStatus, "not_in_blanket_campaign");
      assert.ok(row.blockers.includes("not_in_blanket_campaign"));
      assert.equal(row.status, "blocked");
    }
  });
});

test("Clippers streamer intake resolves approved permissions beyond the top 100 campaign rows", async () => {
  const port = "5573";
  const researchDir = path.join(workspaceRoot, "research");
  const permissionDir = path.join(workspaceRoot, "evidence-drop", "streamer-permissions");
  const outreachPath = path.join(workspaceRoot, "evidence-drop", "streamer-blanket-permission-outreach.csv");
  const permissionUrl = "/clippers-workspace/evidence-drop/streamer-permissions/zapproved.md";
  const replacementFileName = "sports-real-7129d59b5f5e.mp4";
  const replacementPath = path.join(workspaceRoot, "source-drop", "sports", replacementFileName);
  const manifestPath = path.join(workspaceRoot, "source-drop", "sports", "source-drop-manifest.csv");
  const sourceUploadFile = path.join(workspaceRoot, "scheduled", "metricool-current-batch-upload-pack", "02_sport_sports-daily_7129d59b5f5e.mp4");
  const streamers = Array.from({ length: 100 }, (_, index) => ({
    handle: `creator${String(index).padStart(3, "0")}`,
    twitchOfficialUrl: `https://www.twitch.tv/creator${String(index).padStart(3, "0")}`,
  }));
  streamers.push({ handle: "zapproved", twitchOfficialUrl: "https://www.twitch.tv/zapproved" });
  await mkdir(researchDir, { recursive: true });
  await mkdir(permissionDir, { recursive: true });
  await mkdir(path.dirname(replacementPath), { recursive: true });
  await writeFile(path.join(researchDir, "streamer-cohort-eu.json"), `${JSON.stringify({ streamers })}\n`);
  await writeFile(path.join(permissionDir, "zapproved.md"), "zapproved granted written blanket permission for commercial TikTok edits of current and future public stream clips with revocation rights retained.\n");
  await writeFile(outreachPath, [
    "handle,outreach_status,permission_status,scope_tiktok,scope_commercial,scope_edits,scope_future_clips,evidence_link",
    `zapproved,not_sent,approved_blanket,yes,yes,yes,yes,${permissionUrl}`,
    "",
  ].join("\n"));
  await cp(sourceUploadFile, replacementPath);
  await writeFile(manifestPath, [
    "category,title,url,source,platform,target_file_name,rights_status,evidence_link,priority,notes",
    `sports,Approved streamer replacement,https://www.twitch.tv/zapproved/clip/ZApprovedExactClip,zapproved,twitch,${replacementFileName},owned_or_permissioned,${permissionUrl},high,Blanket approval and the exact source clip were reviewed before intake.`,
    "",
  ].join("\n"));

  await withServer({ HOST: "127.0.0.1", PORT: port }, async () => {
    const campaign = await (await fetch(`http://127.0.0.1:${port}/api/clippers/streamer-100-campaign.json`)).json();
    assert.equal(campaign.rows.length, 100);
    assert.equal(campaign.rows.some((row) => row.handle === "zapproved"), false);
    const validation = await (await fetch(`http://127.0.0.1:${port}/api/clippers/real-clip-intake-validation.json`)).json();
    const row = validation.rows.find((candidate) => candidate.queueItemId === "7129d59b5f5e");
    assert.equal(row.creatorPermissionStatus, "approved_blanket");
    assert.equal(row.status, "ready_for_source_drop_import");
    assert.ok(!row.blockers.includes("not_in_blanket_campaign"));
  });
});

test("Clippers real clip intake record endpoint writes manifest proof without faking source readiness", async () => {
  const port = "5529";
  const manifestPath = path.join(workspaceRoot, "source-drop", "sports", "source-drop-manifest.csv");
  const replacementPath = path.join(workspaceRoot, "source-drop", "sports", "sports-real-7129d59b5f5e.mp4");
  const originalManifest = await readFile(manifestPath, "utf8").catch(() => "");
  const originalReplacement = await readFile(replacementPath).catch(() => null);
  try {
    await rm(replacementPath, { force: true });
    await mkdir(path.dirname(manifestPath), { recursive: true });
    await writeFile(manifestPath, "category,title,url,source,platform,target_file_name,rights_status,evidence_link,priority,notes\n");
    await withServer({ HOST: "127.0.0.1", PORT: port }, async () => {
      const badResponse = await fetch(`http://127.0.0.1:${port}/api/clippers/real-clip-intake/record`, {
        method: "POST",
        body: new URLSearchParams({
          csrfToken,
          metricoolQueueItemId: "7129d59b5f5e",
          exactVideoOrPostUrl: "https://www.tiktok.com/search?q=sports",
          creatorOrRightsHolder: "@creator",
          evidenceLink: "https://rights.receipts.local/creator-permission-letter",
          operatorNotes: "Creator permission recorded for this exact replacement before import.",
        }),
      });
      assert.equal(badResponse.status, 400);
      assert.equal((await badResponse.json()).error, "exact_source_video_or_post_url_required");
      assert.doesNotMatch(await readFile(manifestPath, "utf8"), /sports-real-7129d59b5f5e/);

      const traversalProofResponse = await fetch(`http://127.0.0.1:${port}/api/clippers/real-clip-intake/record`, {
        method: "POST",
        body: new URLSearchParams({
          csrfToken,
          metricoolQueueItemId: "7129d59b5f5e",
          exactVideoOrPostUrl: "https://www.tiktok.com/@creator/video/1234567890123456789",
          creatorOrRightsHolder: "@creator",
          evidenceLink: "/clippers-workspace/evidence-drop/../../credentials/foo.json",
          operatorNotes: "Creator permission recorded for this exact replacement before import.",
        }),
      });
      assert.equal(traversalProofResponse.status, 400);
      assert.equal((await traversalProofResponse.json()).error, "valid_rights_evidence_link_required");
      assert.doesNotMatch(await readFile(manifestPath, "utf8"), /credentials|foo\.json/);

      const goodResponse = await fetch(`http://127.0.0.1:${port}/api/clippers/real-clip-intake/record`, {
        method: "POST",
        body: new URLSearchParams({
          csrfToken,
          metricoolQueueItemId: "7129d59b5f5e",
          exactVideoOrPostUrl: "https://www.tiktok.com/@creator/video/1234567890123456789",
          creatorOrRightsHolder: "@creator",
          evidenceLink: "https://rights.receipts.local/creator-permission-letter",
          operatorNotes: "Creator permission recorded for this exact replacement before source-drop import.",
          aiProcessing: "deterministic_ffmpeg_no_ai",
          originalStreamEndedAt: "2026-07-20T00:00:00Z",
          plannedPublishAt: "2026-07-20T12:00:00Z",
          contextReviewStatus: "approved",
          creditText: "Clip by @creator from the original public stream.",
        }),
      });
      assert.equal(goodResponse.status, 200);
      const good = await goodResponse.json();
      assert.equal(good.ok, true);
      assert.equal(good.metricoolQueueItemId, "7129d59b5f5e");
      assert.match(good.manifestUrl, /^\/clippers-workspace\/source-drop\/sports\/source-drop-manifest\.csv$/);
      assert.equal(good.rowStatus, "blocked");
      assert.deepEqual(good.remainingBlockers, ["missing_source_file", "not_in_blanket_campaign"]);
      assert.doesNotMatch(JSON.stringify(good), /\/Users\/|\/var\/folders/);

      const manifest = await readFile(manifestPath, "utf8");
      assert.match(manifest, /sports-real-7129d59b5f5e\.mp4/);
      assert.match(manifest, /owned_or_permissioned/);
      assert.match(manifest, /ai_processing,original_stream_ended_at,planned_publish_at,context_review_status,credit_text/);
      assert.match(manifest, /deterministic_ffmpeg_no_ai,2026-07-20T00:00:00Z,2026-07-20T12:00:00Z,approved,Clip by @creator/);

      const validationResponse = await fetch(`http://127.0.0.1:${port}/api/clippers/real-clip-intake-validation.json`);
      assert.equal(validationResponse.status, 200);
      const validation = await validationResponse.json();
      const row = validation.rows.find((candidate) => candidate.queueItemId === "7129d59b5f5e");
      assert.equal(row.status, "blocked");
      assert.deepEqual(row.blockers, ["missing_source_file", "not_in_blanket_campaign"]);
      assert.equal(row.exactUrlOk, true);
      assert.equal(row.evidenceLinkPresent, true);
      assert.equal(row.notesOk, true);
    });
  } finally {
    await writeFile(manifestPath, originalManifest);
    if (originalReplacement) await writeFile(replacementPath, originalReplacement);
  }
});

test("Clippers real clip intake refuses to overwrite an unreadable manifest", async () => {
  const port = "5563";
  const manifestPath = path.join(workspaceRoot, "source-drop", "sports", "source-drop-manifest.csv");
  const originalManifest = await readFile(manifestPath, "utf8").catch(() => "");
  await rm(manifestPath, { recursive: true, force: true });
  await mkdir(manifestPath, { recursive: true });
  try {
    await withServer({ HOST: "127.0.0.1", PORT: port }, async () => {
      const response = await fetch(`http://127.0.0.1:${port}/api/clippers/real-clip-intake/record`, {
        method: "POST",
        body: new URLSearchParams({
          csrfToken,
          metricoolQueueItemId: "7129d59b5f5e",
          exactVideoOrPostUrl: "https://www.tiktok.com/@creator/video/1234567890123456789",
          creatorOrRightsHolder: "@creator",
          evidenceLink: "https://rights.receipts.local/creator-permission-letter",
          operatorNotes: "Creator permission recorded for this exact replacement before source-drop import.",
        }),
      });
      assert.equal(response.status, 503);
      const result = await response.json();
      assert.equal(result.ok, false);
      assert.equal(result.error, "source_drop_manifest_read_unavailable");
      assert.equal((await stat(manifestPath)).isDirectory(), true);
    });
  } finally {
    await rm(manifestPath, { recursive: true, force: true });
    await writeFile(manifestPath, originalManifest);
  }
});

test("Clippers real clip intake batch endpoint records validated manifest rows atomically", async () => {
  const port = "5546";
  const sportsManifestPath = path.join(workspaceRoot, "source-drop", "sports", "source-drop-manifest.csv");
  const memesManifestPath = path.join(workspaceRoot, "source-drop", "memes", "source-drop-manifest.csv");
  await mkdir(path.dirname(sportsManifestPath), { recursive: true });
  await mkdir(path.dirname(memesManifestPath), { recursive: true });
  await writeFile(sportsManifestPath, "category,title,url,source,platform,target_file_name,rights_status,evidence_link,priority,notes\n");
  await writeFile(memesManifestPath, "category,title,url,source,platform,target_file_name,rights_status,evidence_link,priority,notes\n");

  await withServer({ HOST: "127.0.0.1", PORT: port }, async () => {
    const templateResponse = await fetch(`http://127.0.0.1:${port}/api/clippers/real-clip-intake-batch-template.csv`);
    assert.equal(templateResponse.status, 200);
    const templateCsv = await templateResponse.text();
    assert.match(templateCsv, /^metricool_queue_item_id,exact_video_or_post_url,creator_or_rights_holder,evidence_link,operator_notes,ai_processing,original_stream_ended_at,planned_publish_at,context_review_status,credit_text/m);
    assert.match(templateCsv, /7129d59b5f5e/);
    const [templateHeaderLine, templateDataLine] = templateCsv.trim().split("\n");
    const templateHeader = parseTestCsvLine(templateHeaderLine);
    const templateData = parseTestCsvLine(templateDataLine);
    for (const field of ["ai_processing", "original_stream_ended_at", "planned_publish_at", "context_review_status", "credit_text"]) {
      assert.equal(templateData[templateHeader.indexOf(field)], "");
    }

    const invalidResponse = await fetch(`http://127.0.0.1:${port}/api/clippers/real-clip-intake/record-batch`, {
      method: "POST",
      body: new URLSearchParams({
        csrfToken,
        realClipIntakeBatch: [
          "metricool_queue_item_id,exact_video_or_post_url,creator_or_rights_holder,evidence_link,operator_notes",
          "7129d59b5f5e,https://www.tiktok.com/search?q=sports,@creator,https://rights.receipts.local/creator-permission-letter,Creator permission recorded for this exact replacement before source-drop import.",
        ].join("\n"),
      }),
    });
    assert.equal(invalidResponse.status, 400);
    const invalid = await invalidResponse.json();
    assert.equal(invalid.error, "real_clip_intake_batch_invalid");
    assert.equal(invalid.errors[0].error, "exact_source_video_or_post_url_required");
    assert.doesNotMatch(await readFile(sportsManifestPath, "utf8"), /7129d59b5f5e|sports-real/);

    const invalidMetadataResponse = await fetch(`http://127.0.0.1:${port}/api/clippers/real-clip-intake/record-batch`, {
      method: "POST",
      body: new URLSearchParams({
        csrfToken,
        realClipIntakeBatch: [
          "metricool_queue_item_id,exact_video_or_post_url,creator_or_rights_holder,evidence_link,operator_notes,ai_processing,original_stream_ended_at,planned_publish_at,context_review_status,credit_text",
          "7129d59b5f5e,https://www.tiktok.com/@creator/video/1234567890123456789,@creator,https://rights.receipts.local/creator-permission-letter,Creator permission recorded for this exact replacement before source-drop import.,made_up_mode,not-a-date,2026-07-20T12:00:00Z,maybe,credit",
        ].join("\n"),
      }),
    });
    assert.equal(invalidMetadataResponse.status, 400);
    const invalidMetadata = await invalidMetadataResponse.json();
    assert.equal(invalidMetadata.errors[0].error, "invalid_ai_processing");

    const validResponse = await fetch(`http://127.0.0.1:${port}/api/clippers/real-clip-intake/record-batch`, {
      method: "POST",
      body: new URLSearchParams({
        csrfToken,
        realClipIntakeBatch: [
          "metricool_queue_item_id,exact_video_or_post_url,creator_or_rights_holder,evidence_link,operator_notes",
          "7129d59b5f5e,https://clips.twitch.tv/ExactSportsClipSlug,@sportscreator,https://rights.receipts.local/sports-creator-permission,Creator permission recorded for the sports replacement clip before source-drop import.",
          "53467d8f7dad,https://www.youtube.com/shorts/abcdefghijk,@memecreator,https://rights.receipts.local/meme-creator-permission,Creator permission recorded for the meme replacement clip before source-drop import.",
        ].join("\n"),
      }),
    });
    assert.equal(validResponse.status, 200);
    const valid = await validResponse.json();
    assert.equal(valid.ok, true);
    assert.equal(valid.status, "real_clip_intake_batch_recorded");
    assert.equal(valid.accepted, 2);
    assert.equal(valid.readyRows, 0);
    assert.equal(valid.blockedRows, 2);
    assert.deepEqual(valid.rowResults.map((row) => row.remainingBlockers), [["missing_source_file", "source_url_creator_not_verified", "not_in_blanket_campaign"], ["missing_source_file", "source_url_creator_not_verified", "not_in_blanket_campaign"]]);
    assert.doesNotMatch(JSON.stringify(valid), /\/Users\/|\/var\/folders|1234567890123456789|2234567890123456789/);

    const sportsManifest = await readFile(sportsManifestPath, "utf8");
    const memesManifest = await readFile(memesManifestPath, "utf8");
    assert.match(sportsManifest, /sports-real-7129d59b5f5e\.mp4/);
    assert.match(sportsManifest, /owned_or_permissioned/);
    assert.match(sportsManifest, /,twitch,sports-real-7129d59b5f5e\.mp4/);
    assert.match(memesManifest, /memes-real-53467d8f7dad\.mp4/);
    assert.match(memesManifest, /,youtube,memes-real-53467d8f7dad\.mp4/);

    const concurrentRows = [
      ["cf33ed488e40", "1234567890123456701"],
      ["7395617c94b6", "1234567890123456702"],
    ];
    const concurrentResponses = await Promise.all(concurrentRows.map(([metricoolQueueItemId, videoId]) => fetch(`http://127.0.0.1:${port}/api/clippers/real-clip-intake/record`, {
      method: "POST",
      body: new URLSearchParams({
        csrfToken,
        metricoolQueueItemId,
        exactVideoOrPostUrl: `https://www.tiktok.com/@concurrentcreator/video/${videoId}`,
        creatorOrRightsHolder: "@concurrentcreator",
        evidenceLink: "https://rights.receipts.local/concurrent-creator-permission",
        operatorNotes: `Concurrent manifest write for queue ${metricoolQueueItemId} with verified permission evidence.`,
      }),
    })));
    assert.deepEqual(concurrentResponses.map((response) => response.status), [200, 200]);
    const concurrentManifest = await readFile(memesManifestPath, "utf8");
    assert.match(concurrentManifest, /memes-real-cf33ed488e40\.mp4/);
    assert.match(concurrentManifest, /memes-real-7395617c94b6\.mp4/);

    const validationResponse = await fetch(`http://127.0.0.1:${port}/api/clippers/real-clip-intake-validation.json`);
    assert.equal(validationResponse.status, 200);
    const validation = await validationResponse.json();
    assert.equal(validation.readyRows, 0);
    assert.equal(validation.rows.find((row) => row.queueItemId === "7129d59b5f5e").blockers.join(","), "missing_source_file,source_url_creator_not_verified,not_in_blanket_campaign");
    assert.equal(validation.rows.find((row) => row.queueItemId === "53467d8f7dad").blockers.join(","), "missing_source_file,source_url_creator_not_verified,not_in_blanket_campaign");
  });
});

test("Clippers real clip intake downloads neutralize formula-like generated CSV cells", async () => {
  const port = "5556";
  const originalSessionPacketJson = await readFile(sessionPacketJsonPath, "utf8");
  try {
    const sessionPacket = JSON.parse(originalSessionPacketJson);
    sessionPacket.rows = (sessionPacket.rows || []).map((row, index) => index === 0
      ? {
          ...row,
          metricoolQueueItemId: "=cmd|' /C calc'!A0",
          metricoolBrandName: "=brand",
          accountName: "+account",
        }
      : row);
    await writeFile(sessionPacketJsonPath, JSON.stringify(sessionPacket, null, 2));

    await withServer({ HOST: "127.0.0.1", PORT: port }, async () => {
      const manifestResponse = await fetch(`http://127.0.0.1:${port}/api/clippers/real-clip-intake-manifest.csv`);
      assert.equal(manifestResponse.status, 200);
      const manifestCsv = await manifestResponse.text();
      assert.doesNotMatch(manifestCsv, /^=brand replacement/m);
      assert.match(manifestCsv, /'=brand replacement/);

      const batchTemplateResponse = await fetch(`http://127.0.0.1:${port}/api/clippers/real-clip-intake-batch-template.csv`);
      assert.equal(batchTemplateResponse.status, 200);
      const batchTemplateCsv = await batchTemplateResponse.text();
      assert.doesNotMatch(batchTemplateCsv, /^=cmd/m);
      assert.match(batchTemplateCsv, /'=cmd\|/);
    });
  } finally {
    await writeFile(sessionPacketJsonPath, originalSessionPacketJson);
  }
});

test("Clippers upload-pack MP4 gate fails closed when session rows are missing", async () => {
  const port = "5557";
  const originalSessionPacketJson = await readFile(sessionPacketJsonPath, "utf8");
  try {
    const sessionPacket = JSON.parse(originalSessionPacketJson);
    sessionPacket.rows = [];
    await writeFile(sessionPacketJsonPath, JSON.stringify(sessionPacket, null, 2));

    await withServer({ HOST: "127.0.0.1", PORT: port }, async () => {
      const response = await fetch(`http://127.0.0.1:${port}/clippers-workspace/scheduled/metricool-current-batch-upload-pack/05_sport_sports-daily_7e4ee21ac269.mp4`);
      assert.equal(response.status, 409);
      const body = await response.json();
      assert.equal(body.error, "upload_pack_video_blocked_until_real_clip_intake_ready");
      assert.equal(body.readyRows, 0);
      assert.ok(body.blockedRows > 0);
    });
  } finally {
    await writeFile(sessionPacketJsonPath, originalSessionPacketJson);
  }
});

test("Clippers real clip source hunt pack exposes search rows without approving rights", async () => {
  const port = "5558";
  await withServer({ HOST: "127.0.0.1", PORT: port }, async () => {
    const jsonResponse = await fetch(`http://127.0.0.1:${port}/api/clippers/real-clip-source-hunt.json`);
    assert.equal(jsonResponse.status, 200);
    const pack = await jsonResponse.json();
    assert.equal(pack.status, "needs_real_clip_source_hunt");
    assert.equal(pack.totalRows, 10);
    assert.equal(pack.readyRows, 0);
    assert.equal(pack.blockedRows, 10);
    assert.ok(pack.rows.some((row) => row.category === "sports" && row.tiktokSearchUrl.includes("tiktok.com/search")));
    assert.ok(pack.rows.some((row) => row.category === "memes" && row.googleTikTokSearchUrl.includes("google.com/search")));
    assert.match(pack.guardrails.join(" "), /not proof/i);
    assert.doesNotMatch(JSON.stringify(pack), /owned_or_permissioned.*approved|ready_for_metricool/i);

    const csvResponse = await fetch(`http://127.0.0.1:${port}/api/clippers/real-clip-source-hunt.csv`);
    assert.equal(csvResponse.status, 200);
    const csv = await csvResponse.text();
    assert.match(csv, /^order,metricool_queue_item_id,category,account_name,target_source_drop_file,search_terms,tiktok_search_url/m);
    assert.match(csv, /7129d59b5f5e/);
    assert.match(csv, /Reject search\/explore\/hashtag\/channel pages/);

    const htmlResponse = await fetch(`http://127.0.0.1:${port}/api/clippers/real-clip-source-hunt.html`);
    assert.equal(htmlResponse.status, 200);
    const html = await htmlResponse.text();
    assert.match(html, /Clippers Source Hunt/);
    assert.match(html, /Batch intake template/);
  });
});

test("Clippers real clip permission CRM records outreach without unlocking intake or Metricool", async () => {
  const port = "5559";
  await withServer({ HOST: "127.0.0.1", PORT: port }, async () => {
    const invalidApprovedResponse = await fetch(`http://127.0.0.1:${port}/api/clippers/real-clip-permission-crm/record`, {
      method: "POST",
      body: new URLSearchParams({
        csrfToken,
        metricoolQueueItemId: "7129d59b5f5e",
        exactVideoOrPostUrl: "https://www.tiktok.com/@sportscreator/video/1234567890123456789",
        creatorOrRightsHolder: "@sportscreator",
        outreachChannel: "tiktok_dm",
        outreachStatus: "responded",
        permissionStatus: "approved",
        evidenceLink: "",
        operatorNotes: "Creator replied with permission but proof file still needs to be attached before intake.",
      }),
    });
    assert.equal(invalidApprovedResponse.status, 400);
    const invalidApproved = await invalidApprovedResponse.json();
    assert.equal(invalidApproved.error, "approved_permission_requires_evidence_link");

    const externalProofApprovedResponse = await fetch(`http://127.0.0.1:${port}/api/clippers/real-clip-permission-crm/record`, {
      method: "POST",
      body: new URLSearchParams({
        csrfToken,
        metricoolQueueItemId: "7129d59b5f5e",
        exactVideoOrPostUrl: "https://www.tiktok.com/@sportscreator/video/1234567890123456789",
        creatorOrRightsHolder: "@sportscreator",
        outreachChannel: "tiktok_dm",
        outreachStatus: "responded",
        permissionStatus: "approved",
        evidenceLink: "https://rights.receipts.local/sports-creator-permission",
        operatorNotes: "Creator replied with permission but proof must be stored locally before approved CRM state.",
      }),
    });
    assert.equal(externalProofApprovedResponse.status, 400);
    const externalProofApproved = await externalProofApprovedResponse.json();
    assert.equal(externalProofApproved.error, "approved_permission_requires_local_evidence_file");

    const validRequestResponse = await fetch(`http://127.0.0.1:${port}/api/clippers/real-clip-permission-crm/record`, {
      method: "POST",
      body: new URLSearchParams({
        csrfToken,
        metricoolQueueItemId: "7129d59b5f5e",
        exactVideoOrPostUrl: "https://www.tiktok.com/@sportscreator/video/1234567890123456789",
        creatorOrRightsHolder: "@sportscreator",
        outreachChannel: "tiktok_dm",
        outreachStatus: "sent",
        permissionStatus: "requested",
        evidenceLink: "",
        operatorNotes: "Sent creator permission request for the exact sports replacement clip today.",
      }),
    });
    assert.equal(validRequestResponse.status, 200);
    const validRequest = await validRequestResponse.json();
    assert.equal(validRequest.status, "real_clip_permission_crm_recorded");
    assert.equal(validRequest.unlocksSourceDrop, false);
    assert.equal(validRequest.unlocksMetricool, false);

    const crmResponse = await fetch(`http://127.0.0.1:${port}/api/clippers/real-clip-permission-crm.json`);
    assert.equal(crmResponse.status, 200);
    const crm = await crmResponse.json();
    const row = crm.rows.find((candidate) => candidate.queueItemId === "7129d59b5f5e");
    assert.equal(row.outreachStatus, "sent");
    assert.equal(row.permissionStatus, "requested");
    assert.equal(row.canUseForIntake, false);
    assert.equal(crm.recordedRows, 1);
    assert.equal(crm.approvedRows, 0);

    const validationResponse = await fetch(`http://127.0.0.1:${port}/api/clippers/real-clip-intake-validation.json`);
    const validation = await validationResponse.json();
    assert.equal(validation.status, "blocked");
    assert.equal(validation.readyRows, 0);

    const operatorReadyResponse = await fetch(`http://127.0.0.1:${port}/api/clippers/operator-ready.json`);
    const operatorReady = await operatorReadyResponse.json();
    assert.equal(operatorReady.readyToScheduleNow, false);
    assert.equal(operatorReady.operatorReady, false);
  });
});

test("Clippers permission CRM serializes concurrent row updates without losing data", async () => {
  const port = "5565";
  const crmPath = path.join(workspaceRoot, "evidence-drop", "real-clip-permission-outreach.csv");
  const originalCrm = await readFile(crmPath).catch(() => null);
  await rm(crmPath, { force: true });
  try {
    await withServer({ HOST: "127.0.0.1", PORT: port }, async () => {
      const request = (queueId, creator, videoId) => fetch(`http://127.0.0.1:${port}/api/clippers/real-clip-permission-crm/record`, {
        method: "POST",
        body: new URLSearchParams({
          csrfToken,
          metricoolQueueItemId: queueId,
          exactVideoOrPostUrl: `https://www.tiktok.com/@${creator}/video/${videoId}`,
          creatorOrRightsHolder: `@${creator}`,
          outreachChannel: "tiktok_dm",
          outreachStatus: "sent",
          permissionStatus: "requested",
          evidenceLink: "",
          operatorNotes: `Sent creator permission request for ${creator} exact clip during concurrency verification.`,
        }),
      });
      const responses = await Promise.all([
        request("7129d59b5f5e", "sportscreator", "1234567890123456789"),
        request("53467d8f7dad", "memecreator", "2234567890123456789"),
      ]);
      assert.deepEqual(responses.map((response) => response.status), [200, 200]);

      const crm = await (await fetch(`http://127.0.0.1:${port}/api/clippers/real-clip-permission-crm.json`)).json();
      assert.ok(crm.rows.some((row) => row.queueItemId === "7129d59b5f5e"));
      assert.ok(crm.rows.some((row) => row.queueItemId === "53467d8f7dad"));
      assert.equal(crm.recordedRows, 2);
    });
  } finally {
    if (originalCrm) await writeFile(crmPath, originalCrm);
    else await rm(crmPath, { force: true });
  }
});

test("Clippers real clip permission CRM batch records rows atomically without unlocking", async () => {
  const port = "5560";
  await withServer({ HOST: "127.0.0.1", PORT: port }, async () => {
    const templateResponse = await fetch(`http://127.0.0.1:${port}/api/clippers/real-clip-permission-crm-batch-template.csv`);
    assert.equal(templateResponse.status, 200);
    const templateCsv = await templateResponse.text();
    assert.match(templateCsv, /^metricool_queue_item_id,exact_video_or_post_url,creator_or_rights_holder,outreach_channel,outreach_status,permission_status,evidence_link,operator_notes/m);
    assert.match(templateCsv, /7129d59b5f5e/);

    const invalidResponse = await fetch(`http://127.0.0.1:${port}/api/clippers/real-clip-permission-crm/record-batch`, {
      method: "POST",
      body: new URLSearchParams({
        csrfToken,
        permissionCrmBatch: [
          "metricool_queue_item_id,exact_video_or_post_url,creator_or_rights_holder,outreach_channel,outreach_status,permission_status,evidence_link,operator_notes",
          "7129d59b5f5e,https://www.tiktok.com/search?q=sports,@sportscreator,tiktok_dm,sent,requested,,Sent creator request for exact sports clip but URL is invalid.",
          "53467d8f7dad,https://www.tiktok.com/@memecreator/video/2234567890123456789,@memecreator,tiktok_dm,sent,requested,,Sent creator request for exact meme clip today.",
        ].join("\n"),
      }),
    });
    assert.equal(invalidResponse.status, 400);
    const invalid = await invalidResponse.json();
    assert.equal(invalid.error, "real_clip_permission_crm_batch_invalid");
    assert.equal(invalid.accepted, 0);

    const invalidApprovedBatchResponse = await fetch(`http://127.0.0.1:${port}/api/clippers/real-clip-permission-crm/record-batch`, {
      method: "POST",
      body: new URLSearchParams({
        csrfToken,
        permissionCrmBatch: [
          "metricool_queue_item_id,exact_video_or_post_url,creator_or_rights_holder,outreach_channel,outreach_status,permission_status,evidence_link,operator_notes",
          "7129d59b5f5e,https://www.tiktok.com/@sportscreator/video/1234567890123456789,@sportscreator,tiktok_dm,responded,approved,https://rights.receipts.local/sports-creator-permission,Creator permission proof must be copied into local evidence file before approval.",
        ].join("\n"),
      }),
    });
    assert.equal(invalidApprovedBatchResponse.status, 400);
    const invalidApprovedBatch = await invalidApprovedBatchResponse.json();
    assert.equal(invalidApprovedBatch.error, "real_clip_permission_crm_batch_invalid");
    assert.equal(invalidApprovedBatch.errors[0].error, "approved_permission_requires_local_evidence_file");

    let crmResponse = await fetch(`http://127.0.0.1:${port}/api/clippers/real-clip-permission-crm.json`);
    let crm = await crmResponse.json();
    assert.equal(crm.recordedRows, 0);

    const validResponse = await fetch(`http://127.0.0.1:${port}/api/clippers/real-clip-permission-crm/record-batch`, {
      method: "POST",
      body: new URLSearchParams({
        csrfToken,
        permissionCrmBatch: [
          "metricool_queue_item_id,exact_video_or_post_url,creator_or_rights_holder,outreach_channel,outreach_status,permission_status,evidence_link,operator_notes",
          "7129d59b5f5e,https://www.tiktok.com/@sportscreator/video/1234567890123456789,@sportscreator,tiktok_dm,sent,requested,,Sent creator request for exact sports replacement clip today.",
          "53467d8f7dad,https://www.tiktok.com/@memecreator/video/2234567890123456789,@memecreator,tiktok_dm,sent,requested,,Sent creator request for exact meme replacement clip today.",
        ].join("\n"),
      }),
    });
    assert.equal(validResponse.status, 200);
    const valid = await validResponse.json();
    assert.equal(valid.status, "real_clip_permission_crm_batch_recorded");
    assert.equal(valid.accepted, 2);
    assert.deepEqual(valid.rowResults.map((row) => row.unlocksMetricool), [false, false]);
    assert.doesNotMatch(JSON.stringify(valid), /\/Users\/|\/var\/folders|1234567890123456789|2234567890123456789/);

    crmResponse = await fetch(`http://127.0.0.1:${port}/api/clippers/real-clip-permission-crm.json`);
    crm = await crmResponse.json();
    assert.equal(crm.recordedRows, 2);
    assert.equal(crm.approvedRows, 0);
    assert.equal(crm.rows.find((row) => row.queueItemId === "7129d59b5f5e").permissionStatus, "requested");

    const operatorReadyResponse = await fetch(`http://127.0.0.1:${port}/api/clippers/operator-ready.json`);
    const operatorReady = await operatorReadyResponse.json();
    assert.equal(operatorReady.readyToScheduleNow, false);
    assert.equal(operatorReady.operatorReady, false);
  });
});

test("Clippers exact source candidate batch records TikTok, Twitch, and YouTube leads without unlocking", async () => {
  const port = "5569";
  await withServer({ HOST: "127.0.0.1", PORT: port }, async () => {
    const templateResponse = await fetch(`http://127.0.0.1:${port}/api/clippers/real-clip-exact-source-candidate-batch-template.csv`);
    assert.equal(templateResponse.status, 200);
    const templateCsv = await templateResponse.text();
    assert.match(templateCsv, /^metricool_queue_item_id,exact_video_or_post_url,creator_or_rights_holder/m);
    assert.match(templateCsv, /7129d59b5f5e/);

    const invalidResponse = await fetch(`http://127.0.0.1:${port}/api/clippers/real-clip-exact-source-candidate/record-batch`, {
      method: "POST",
      body: new URLSearchParams({
        csrfToken,
        exactSourceCandidateBatch: [
          "metricool_queue_item_id,exact_video_or_post_url,creator_or_rights_holder",
          "7129d59b5f5e,https://www.tiktok.com/search?q=sports,@sportscreator",
          "53467d8f7dad,https://www.tiktok.com/@memecreator/video/2234567890123456789,@memecreator",
        ].join("\n"),
      }),
    });
    assert.equal(invalidResponse.status, 400);
    const invalid = await invalidResponse.json();
    assert.equal(invalid.error, "exact_source_video_or_post_url_required");
    assert.equal(invalid.metricoolQueueItemId, "7129d59b5f5e");

    for (const invalidSourceUrl of [
      "https://www.youtube.com/results?search_query=streamer+clips",
      "https://www.youtube.com/@streamer",
      "https://www.twitch.tv/streamer",
      "https://clips.twitch.tv/ExactClipSlug?filter=clips",
      "https://user:password@clips.twitch.tv/ExactClipSlug",
      "https://user:password@www.youtube.com/watch?v=abcdefghijk",
    ]) {
      const rejectedResponse = await fetch(`http://127.0.0.1:${port}/api/clippers/real-clip-exact-source-candidate/record-batch`, {
        method: "POST",
        body: new URLSearchParams({
          csrfToken,
          exactSourceCandidateBatch: [
            "metricool_queue_item_id,exact_video_or_post_url,creator_or_rights_holder",
            `7129d59b5f5e,${invalidSourceUrl},@streamer`,
          ].join("\n"),
        }),
      });
      assert.equal(rejectedResponse.status, 400);
      assert.equal((await rejectedResponse.json()).error, "exact_source_video_or_post_url_required");
    }

    let crmResponse = await fetch(`http://127.0.0.1:${port}/api/clippers/real-clip-permission-crm.json`);
    let crm = await crmResponse.json();
    assert.equal(crm.recordedRows, 0);

    const validResponse = await fetch(`http://127.0.0.1:${port}/api/clippers/real-clip-exact-source-candidate/record-batch`, {
      method: "POST",
      body: new URLSearchParams({
        csrfToken,
        exactSourceCandidateBatch: [
          "metricool_queue_item_id,exact_video_or_post_url,creator_or_rights_holder",
          "7129d59b5f5e,https://clips.twitch.tv/ExactClipSlug,@twitchcreator",
          "53467d8f7dad,https://www.twitch.tv/memecreator/clip/AnotherExactSlug,@memecreator",
          "cf33ed488e40,https://www.youtube.com/watch?v=abcdefghijk,@youtubecreator",
          "ef11cfd492f0,https://youtu.be/zyxwvutsrqp,@youtubecreator",
          "7e4ee21ac269,https://www.youtube.com/shorts/qwertyuiopa,@shortscreator",
        ].join("\n"),
      }),
    });
    assert.equal(validResponse.status, 200);
    const valid = await validResponse.json();
    assert.equal(valid.status, "exact_source_candidate_batch_recorded");
    assert.equal(valid.unlocksSourceDrop, false);
    assert.equal(valid.unlocksMetricool, false);

    crmResponse = await fetch(`http://127.0.0.1:${port}/api/clippers/real-clip-permission-crm.json`);
    crm = await crmResponse.json();
    assert.equal(crm.recordedRows, 5);
    assert.equal(crm.approvedRows, 0);
    assert.equal(crm.rows.find((row) => row.queueItemId === "7129d59b5f5e").permissionStatus, "not_requested");

    const requestedResponse = await fetch(`http://127.0.0.1:${port}/api/clippers/real-clip-permission-crm/record`, {
      method: "POST",
      body: new URLSearchParams({
        csrfToken,
        metricoolQueueItemId: "7129d59b5f5e",
        exactVideoOrPostUrl: "https://clips.twitch.tv/PermissionEvidenceClip",
        creatorOrRightsHolder: "@sportscreator",
        outreachChannel: "tiktok_dm",
        outreachStatus: "sent",
        permissionStatus: "requested",
        evidenceLink: "",
        operatorNotes: "Sent creator request for exact sports replacement clip today.",
      }),
    });
    assert.equal(requestedResponse.status, 200);

    const overwriteResponse = await fetch(`http://127.0.0.1:${port}/api/clippers/real-clip-exact-source-candidate/record-batch`, {
      method: "POST",
      body: new URLSearchParams({
        csrfToken,
        exactSourceCandidateBatch: [
          "metricool_queue_item_id,exact_video_or_post_url,creator_or_rights_holder",
          "7129d59b5f5e,https://www.tiktok.com/@sportscreator/video/1234567890123456789,@sportscreator",
        ].join("\n"),
      }),
    });
    assert.equal(overwriteResponse.status, 409);
    const overwrite = await overwriteResponse.json();
    assert.equal(overwrite.error, "exact_source_candidate_would_overwrite_permission_crm_state");

    crmResponse = await fetch(`http://127.0.0.1:${port}/api/clippers/real-clip-permission-crm.json`);
    crm = await crmResponse.json();
    assert.equal(crm.rows.find((row) => row.queueItemId === "7129d59b5f5e").permissionStatus, "requested");

    const operatorReadyResponse = await fetch(`http://127.0.0.1:${port}/api/clippers/operator-ready.json`);
    const operatorReady = await operatorReadyResponse.json();
    assert.equal(operatorReady.readyToScheduleNow, false);
    assert.equal(operatorReady.operatorReady, false);
  });
});

test("Clippers real clip permission CRM creates local evidence without unlocking Metricool", async () => {
  const port = "5561";
  await withServer({ HOST: "127.0.0.1", PORT: port }, async () => {
    const evidenceResponse = await fetch(`http://127.0.0.1:${port}/api/clippers/real-clip-permission-crm/evidence-file`, {
      method: "POST",
      body: new URLSearchParams({
        csrfToken,
        metricoolQueueItemId: "7129d59b5f5e",
        exactVideoOrPostUrl: "https://clips.twitch.tv/PermissionEvidenceClip",
        creatorOrRightsHolder: "@sportscreator",
        permissionType: "creator_permission",
        proofSummary: "Creator permission was captured for this exact sports replacement clip and the operator recorded the allowed usage, account, target row, and date in local non-secret notes.",
        creditRequirements: "Credit the creator handle in the caption, do not imply partnership, keep the clip usage limited to the selected Sports Daily Clips TikTok replacement row.",
      }),
    });
    assert.equal(evidenceResponse.status, 200);
    const evidence = await evidenceResponse.json();
    assert.equal(evidence.status, "real_clip_permission_evidence_file_ready");
    assert.match(evidence.evidenceLink, /^\/clippers-workspace\/evidence-drop\/real-clip-permissions\/7129d59b5f5e\.md$/);
    assert.equal(evidence.unlocksMetricool, false);

    const approvedResponse = await fetch(`http://127.0.0.1:${port}/api/clippers/real-clip-permission-crm/record`, {
      method: "POST",
      body: new URLSearchParams({
        csrfToken,
        metricoolQueueItemId: "7129d59b5f5e",
        exactVideoOrPostUrl: "https://www.tiktok.com/@sportscreator/video/1234567890123456789",
        creatorOrRightsHolder: "@sportscreator",
        outreachChannel: "tiktok_dm",
        outreachStatus: "responded",
        permissionStatus: "approved",
        evidenceLink: evidence.evidenceLink,
        operatorNotes: "Approved creator permission is stored in the local evidence file for this exact sports clip.",
      }),
    });
    assert.equal(approvedResponse.status, 200);
    const approved = await approvedResponse.json();
    assert.equal(approved.permissionStatus, "approved");
    assert.equal(approved.unlocksSourceDrop, false);
    assert.equal(approved.unlocksMetricool, false);

    const crmResponse = await fetch(`http://127.0.0.1:${port}/api/clippers/real-clip-permission-crm.json`);
    const crm = await crmResponse.json();
    assert.equal(crm.approvedRows, 1);

    const validationResponse = await fetch(`http://127.0.0.1:${port}/api/clippers/real-clip-intake-validation.json`);
    const validation = await validationResponse.json();
    const row = validation.rows.find((candidate) => candidate.queueItemId === "7129d59b5f5e");
    assert.equal(row.status, "blocked");
    assert.ok(row.blockers.includes("missing_source_file"));

    const operatorReadyResponse = await fetch(`http://127.0.0.1:${port}/api/clippers/operator-ready.json`);
    const operatorReady = await operatorReadyResponse.json();
    assert.equal(operatorReady.readyToScheduleNow, false);
    assert.equal(operatorReady.operatorReady, false);
  });
});

test("Clippers real clip intake initializes source-drop manifests without unlocking readiness", async () => {
  const port = "5534";
  const sportsManifestPath = path.join(workspaceRoot, "source-drop", "sports", "source-drop-manifest.csv");
  const memesManifestPath = path.join(workspaceRoot, "source-drop", "memes", "source-drop-manifest.csv");
  await mkdir(path.dirname(sportsManifestPath), { recursive: true });
  await writeFile(sportsManifestPath, [
    "category,title,url,source,platform,target_file_name,rights_status,evidence_link,priority,notes",
    `sports,Legacy owned row,owned-source://legacy,Legacy,tiktok,legacy-owned.mp4,owned_or_permissioned,owner note path: ${path.join(workspaceRoot, "source-drop", "sports", "legacy-proof.md")},low,Legacy generated row preserved but local path scrubbed.`,
    "",
  ].join("\n"));
  await withServer({ HOST: "127.0.0.1", PORT: port }, async () => {
    const response = await fetch(`http://127.0.0.1:${port}/api/clippers/real-clip-intake/initialize-source-drop`, {
      method: "POST",
      body: new URLSearchParams({ csrfToken }),
    });
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.equal(result.ok, true);
    assert.equal(result.status, "source_drop_workspace_initialized");
    assert.equal(result.totalRows, 10);
    assert.equal(result.manifestRowsAdded, 10);
    assert.match(result.evidenceReadmeUrl, /^\/clippers-workspace\/evidence-drop\/real-clip-permissions\/README\.md$/);
    assert.equal(result.realClipIntakeValidation.status, "blocked");
    assert.equal(result.realClipIntakeValidation.readyRows, 0);
    assert.equal(result.realClipIntakeValidation.blockedRows, 10);
    assert.doesNotMatch(JSON.stringify(result), /\/Users\/|\/var\/folders/);

    const sportsManifest = await readFile(sportsManifestPath, "utf8");
    const memesManifest = await readFile(memesManifestPath, "utf8");
    assert.match(sportsManifest, /sports-real-7129d59b5f5e\.mp4/);
    assert.match(sportsManifest, /owner note path: \/clippers-workspace\/source-drop\/sports\/legacy-proof\.md/);
    assert.doesNotMatch(sportsManifest, /\/Users\/|\/var\/folders/);
    assert.match(memesManifest, /memes-real-53467d8f7dad\.mp4/);
    assert.match(sportsManifest, /<paste exact TikTok, Twitch clip, or YouTube video URL; not search\/explore\/channel>/);
    assert.match(sportsManifest, /review_required/);

    const secondResponse = await fetch(`http://127.0.0.1:${port}/api/clippers/real-clip-intake/initialize-source-drop`, {
      method: "POST",
      body: new URLSearchParams({ csrfToken }),
    });
    assert.equal(secondResponse.status, 200);
    const second = await secondResponse.json();
    assert.equal(second.manifestRowsAdded, 0);
    assert.equal(second.manifestRowsPreserved, 10);
  });
});

test("Clippers source-drop initializer refuses to overwrite an unreadable existing manifest", async () => {
  const port = "5564";
  const manifestPath = path.join(workspaceRoot, "source-drop", "sports", "source-drop-manifest.csv");
  const memesManifestPath = path.join(workspaceRoot, "source-drop", "memes", "source-drop-manifest.csv");
  const originalManifest = await readFile(manifestPath, "utf8").catch(() => "");
  const originalMemesManifest = await readFile(memesManifestPath, "utf8").catch(() => "");
  await rm(manifestPath, { recursive: true, force: true });
  await mkdir(manifestPath, { recursive: true });
  try {
    await withServer({ HOST: "127.0.0.1", PORT: port }, async () => {
      const response = await fetch(`http://127.0.0.1:${port}/api/clippers/real-clip-intake/initialize-source-drop`, {
        method: "POST",
        body: new URLSearchParams({ csrfToken }),
      });
      assert.equal(response.status, 503);
      const result = await response.json();
      assert.equal(result.ok, false);
      assert.equal(result.status, "source_drop_manifest_read_unavailable");
      assert.equal((await stat(manifestPath)).isDirectory(), true);
      assert.equal(await readFile(memesManifestPath, "utf8").catch(() => ""), originalMemesManifest);
    });
  } finally {
    await rm(manifestPath, { recursive: true, force: true });
    await writeFile(manifestPath, originalManifest);
  }
});

test("Clippers real clip closeout work packet lists exact files and evidence templates", async () => {
  const port = "5538";
  await withServer({ HOST: "127.0.0.1", PORT: port }, async () => {
    const initResponse = await fetch(`http://127.0.0.1:${port}/api/clippers/real-clip-intake/initialize-source-drop`, {
      method: "POST",
      body: new URLSearchParams({ csrfToken }),
    });
    assert.equal(initResponse.status, 200);

    const jsonResponse = await fetch(`http://127.0.0.1:${port}/api/clippers/real-clip-closeout-work-packet.json`);
    assert.equal(jsonResponse.status, 200);
    const packet = await jsonResponse.json();
    assert.equal(packet.status, "needs_real_clip_closeout");
    assert.equal(packet.totalRows, 10);
    assert.equal(packet.readyRows, 0);
    assert.equal(packet.blockedRows, 10);
    assert.match(packet.rows[0].targetSourceDropFile, /^source-drop\/memes\/memes-real-53467d8f7dad\.mp4$/);
    assert.match(packet.rows[0].evidenceTemplate, /^\/clippers-workspace\/evidence-drop\/real-clip-permissions\/53467d8f7dad\.md$/);
    assert.ok(packet.rows[0].blockers.includes("missing_source_file"));
    assert.doesNotMatch(JSON.stringify(packet), /\/Users\/|\/var\/folders|app\.metricool\.com\/planner/);

    const csvResponse = await fetch(`http://127.0.0.1:${port}/api/clippers/real-clip-closeout-work-packet.csv`);
    assert.equal(csvResponse.status, 200);
    const csv = await csvResponse.text();
    assert.match(csv, /^order,metricool_queue_item_id,category,account_name,status,blockers,target_source_drop_file/m);
    assert.match(csv, /memes-real-53467d8f7dad\.mp4/);
    assert.match(csv, /real-clip-permissions\/53467d8f7dad\.md/);

    const mdResponse = await fetch(`http://127.0.0.1:${port}/api/clippers/real-clip-closeout-work-packet.md`);
    assert.equal(mdResponse.status, 200);
    const markdown = await mdResponse.text();
    assert.match(markdown, /# Clippers Real Clip Closeout Work Packet/);
    assert.match(markdown, /Evidence templates are not proof/);
  });
});

test("Clippers real clip closeout work packet CSV neutralizes formula-like account names", async () => {
  const port = "5542";
  const originalSessionPacketJson = await readFile(sessionPacketJsonPath, "utf8");
  const originalUploadPackReportJson = await readFile(uploadPackReportJsonPath, "utf8");
  try {
    const sessionPacket = JSON.parse(originalSessionPacketJson);
    sessionPacket.rows = (sessionPacket.rows || []).map((row, index) => index === 0
      ? { ...row, accountName: "\t=Malicious Account" }
      : row);
    await writeFile(sessionPacketJsonPath, JSON.stringify(sessionPacket, null, 2));

    const uploadPackReport = JSON.parse(originalUploadPackReportJson);
    uploadPackReport.rows = (uploadPackReport.rows || []).map((row, index) => index === 0
      ? { ...row, accountName: "\t=Malicious Account" }
      : row);
    await writeFile(uploadPackReportJsonPath, JSON.stringify(uploadPackReport, null, 2));

    await withServer({ HOST: "127.0.0.1", PORT: port }, async () => {
      const csvResponse = await fetch(`http://127.0.0.1:${port}/api/clippers/real-clip-closeout-work-packet.csv`);
      assert.equal(csvResponse.status, 200);
      const csv = await csvResponse.text();
      assert.match(csv, /,'=Malicious Account,/);
      assert.doesNotMatch(csv, /,\t=Malicious Account,/);
    });
  } finally {
    await writeFile(sessionPacketJsonPath, originalSessionPacketJson);
    await writeFile(uploadPackReportJsonPath, originalUploadPackReportJson);
  }
});

test("Clippers real clip intake validation does not accept local evidence templates as proof", async () => {
  const port = "5539";
  const sourceUploadFile = path.join(workspaceRoot, "scheduled", "metricool-current-batch-upload-pack", "02_sport_sports-daily_7129d59b5f5e.mp4");
  const replacementFileName = "sports-real-7129d59b5f5e.mp4";
  const replacementPath = path.join(workspaceRoot, "source-drop", "sports", replacementFileName);
  const manifestPath = path.join(workspaceRoot, "source-drop", "sports", "source-drop-manifest.csv");
  await mkdir(path.dirname(replacementPath), { recursive: true });
  await cp(sourceUploadFile, replacementPath);

  await withServer({ HOST: "127.0.0.1", PORT: port }, async () => {
    const initResponse = await fetch(`http://127.0.0.1:${port}/api/clippers/real-clip-intake/initialize-source-drop`, {
      method: "POST",
      body: new URLSearchParams({ csrfToken }),
    });
    assert.equal(initResponse.status, 200);
    await writeFile(manifestPath, [
      "category,title,url,source,platform,target_file_name,rights_status,evidence_link,priority,notes",
      "sports,Permissioned highlight replacement,https://www.tiktok.com/@creator/video/1234567890123456789,@creator,tiktok,sports-real-7129d59b5f5e.mp4,owned_or_permissioned,/clippers-workspace/evidence-drop/real-clip-permissions/7129d59b5f5e.md,high,Creator permission recorded for this replacement clip before source drop import.",
      "",
    ].join("\n"));
    const response = await fetch(`http://127.0.0.1:${port}/api/clippers/real-clip-intake-validation.json`);
    assert.equal(response.status, 200);
    const validation = await response.json();
    const row = validation.rows.find((candidate) => candidate.queueItemId === "7129d59b5f5e");
    assert.equal(row.status, "blocked");
    assert.ok(row.blockers.includes("evidence_file_placeholder"));
    assert.equal(row.evidenceStatus, "evidence_file_placeholder");
  });
});

test("Clippers real clip intake validation rejects evidence through symlinked evidence subdirectories", async () => {
  const port = "5543";
  const sourceUploadFile = path.join(workspaceRoot, "scheduled", "metricool-current-batch-upload-pack", "02_sport_sports-daily_7129d59b5f5e.mp4");
  const replacementFileName = "sports-real-7129d59b5f5e.mp4";
  const replacementPath = path.join(workspaceRoot, "source-drop", "sports", replacementFileName);
  const manifestPath = path.join(workspaceRoot, "source-drop", "sports", "source-drop-manifest.csv");
  const outsideProofDir = path.join(testWorkspaceParent, "outside-real-clip-permissions");
  await mkdir(path.dirname(replacementPath), { recursive: true });
  await cp(sourceUploadFile, replacementPath);
  await mkdir(path.join(workspaceRoot, "evidence-drop"), { recursive: true });
  await mkdir(outsideProofDir, { recursive: true });
  await writeFile(path.join(outsideProofDir, "7129d59b5f5e.md"), [
    "# Creator permission proof",
    "",
    "The creator permission was captured in writing for this exact TikTok clip and the operator verified the public source before intake.",
    "This test proof is intentionally outside the workspace and must not unlock scheduling through a symlinked evidence folder.",
  ].join("\n"));
  await symlink(outsideProofDir, path.join(workspaceRoot, "evidence-drop", "real-clip-permissions"));
  await writeFile(manifestPath, [
    "category,title,url,source,platform,target_file_name,rights_status,evidence_link,priority,notes",
    "sports,Permissioned highlight replacement,https://www.tiktok.com/@creator/video/1234567890123456789,@creator,tiktok,sports-real-7129d59b5f5e.mp4,owned_or_permissioned,/clippers-workspace/evidence-drop/real-clip-permissions/7129d59b5f5e.md,high,Creator permission recorded for this replacement clip before source drop import.",
    "",
  ].join("\n"));

  await withServer({ HOST: "127.0.0.1", PORT: port }, async () => {
    const response = await fetch(`http://127.0.0.1:${port}/api/clippers/real-clip-intake-validation.json`);
    assert.equal(response.status, 200);
    const validation = await response.json();
    const row = validation.rows.find((candidate) => candidate.queueItemId === "7129d59b5f5e");
    assert.equal(row.status, "blocked");
    assert.ok(row.blockers.includes("evidence_file_outside_workspace"));
    assert.equal(row.evidenceStatus, "evidence_file_outside_workspace");
    assert.doesNotMatch(JSON.stringify(validation), /outside-real-clip-permissions|\/Users\/|\/var\/folders/);
  });
});

test("Clippers real clip intake validation rejects symlinked evidence-drop root", async () => {
  const port = "5544";
  const sourceUploadFile = path.join(workspaceRoot, "scheduled", "metricool-current-batch-upload-pack", "02_sport_sports-daily_7129d59b5f5e.mp4");
  const replacementFileName = "sports-real-7129d59b5f5e.mp4";
  const replacementPath = path.join(workspaceRoot, "source-drop", "sports", replacementFileName);
  const manifestPath = path.join(workspaceRoot, "source-drop", "sports", "source-drop-manifest.csv");
  const outsideEvidenceRoot = path.join(testWorkspaceParent, "outside-evidence-drop-root");
  await mkdir(path.dirname(replacementPath), { recursive: true });
  await cp(sourceUploadFile, replacementPath);
  await rm(path.join(workspaceRoot, "evidence-drop"), { recursive: true, force: true });
  await mkdir(path.join(outsideEvidenceRoot, "real-clip-permissions"), { recursive: true });
  await writeFile(path.join(outsideEvidenceRoot, "real-clip-permissions", "7129d59b5f5e.md"), [
    "# Creator permission proof",
    "",
    "The creator permission was captured in writing for this exact TikTok clip and the operator verified the public source before intake.",
    "This test proof is intentionally outside the workspace through a symlinked evidence-drop root and must not unlock scheduling.",
  ].join("\n"));
  await symlink(outsideEvidenceRoot, path.join(workspaceRoot, "evidence-drop"));
  await writeFile(manifestPath, [
    "category,title,url,source,platform,target_file_name,rights_status,evidence_link,priority,notes",
    "sports,Permissioned highlight replacement,https://www.tiktok.com/@creator/video/1234567890123456789,@creator,tiktok,sports-real-7129d59b5f5e.mp4,owned_or_permissioned,/clippers-workspace/evidence-drop/real-clip-permissions/7129d59b5f5e.md,high,Creator permission recorded for this replacement clip before source drop import.",
    "",
  ].join("\n"));

  await withServer({ HOST: "127.0.0.1", PORT: port }, async () => {
    const response = await fetch(`http://127.0.0.1:${port}/api/clippers/real-clip-intake-validation.json`);
    assert.equal(response.status, 200);
    const validation = await response.json();
    const row = validation.rows.find((candidate) => candidate.queueItemId === "7129d59b5f5e");
    assert.equal(row.status, "blocked");
    assert.ok(row.blockers.includes("evidence_root_symlink_blocked"));
    assert.equal(row.evidenceStatus, "evidence_root_symlink_blocked");
    assert.doesNotMatch(JSON.stringify(validation), /outside-evidence-drop-root|\/Users\/|\/var\/folders/);
  });
});

test("Clippers source-drop initializer refuses symlinked category directories", async () => {
  const port = "5535";
  const externalDrop = path.join(testWorkspaceParent, "outside-source-drop-memes");
  await mkdir(externalDrop, { recursive: true });
  await mkdir(path.join(workspaceRoot, "source-drop"), { recursive: true });
  await symlink(externalDrop, path.join(workspaceRoot, "source-drop", "memes"));

  await withServer({ HOST: "127.0.0.1", PORT: port }, async () => {
    const response = await fetch(`http://127.0.0.1:${port}/api/clippers/real-clip-intake/initialize-source-drop`, {
      method: "POST",
      body: new URLSearchParams({ csrfToken }),
    });
    assert.equal(response.status, 200);
    const result = await response.json();
    const memes = result.categories.find((category) => category.category === "memes");
    const sports = result.categories.find((category) => category.category === "sports");
    assert.equal(memes.status, "blocked");
    assert.equal(memes.error, "source_drop_category_symlink_or_missing");
    assert.equal(sports.status, "initialized");
    assert.doesNotMatch(JSON.stringify(result), /outside-source-drop-memes|\/Users\/|\/var\/folders/);
  });
});

test("Clippers source-drop initializer refuses symlinked source-drop root", async () => {
  const port = "5536";
  const externalDrop = path.join(testWorkspaceParent, "outside-source-drop-root");
  await mkdir(externalDrop, { recursive: true });
  await rm(path.join(workspaceRoot, "source-drop"), { force: true, recursive: true });
  await symlink(externalDrop, path.join(workspaceRoot, "source-drop"));

  await withServer({ HOST: "127.0.0.1", PORT: port }, async () => {
    const response = await fetch(`http://127.0.0.1:${port}/api/clippers/real-clip-intake/initialize-source-drop`, {
      method: "POST",
      body: new URLSearchParams({ csrfToken }),
    });
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.equal(result.categories.every((category) => category.status === "blocked"), true);
    assert.equal(result.categories.every((category) => category.error === "source_drop_root_symlink_blocked"), true);
    assert.doesNotMatch(JSON.stringify(result), /outside-source-drop-root|\/Users\/|\/var\/folders/);
  });
});

test("Clippers source-drop Metricool refresh stays blocked until real clip intake is ready", async () => {
  const port = "5530";
  await withServer({ HOST: "127.0.0.1", PORT: port }, async () => {
    const planResponse = await fetch(`http://127.0.0.1:${port}/api/clippers/source-drop-metricool-refresh.json`);
    assert.equal(planResponse.status, 200);
    const plan = await planResponse.json();
    assert.equal(plan.status, "blocked_real_clip_intake");
    assert.equal(plan.canRunImport, false);
    assert.ok(plan.blockers.includes("real_clip_intake_not_ready"));
    assert.match(plan.nextAction, /yellow generated files are placeholders|Complete Real Clip Intake/i);
    assert.equal(plan.realPublishEnabled, false);
    assert.equal(plan.metricoolApprovalRequired, true);
    assert.doesNotMatch(JSON.stringify(plan), /\/Users\/|\/var\/folders/);

    const htmlResponse = await fetch(`http://127.0.0.1:${port}/api/clippers/source-drop-metricool-refresh.html`);
    assert.equal(htmlResponse.status, 200);
    const html = await htmlResponse.text();
    assert.match(html, /Run guarded import \+ refresh/);
    assert.match(html, /disabled/);
    assert.match(html, /solo los clips reales que superaron todas las validaciones/);

    const runResponse = await fetch(`http://127.0.0.1:${port}/api/clippers/source-drop-metricool-refresh/run`, {
      method: "POST",
      body: new URLSearchParams({ csrfToken }),
    });
    assert.equal(runResponse.status, 409);
    const run = await runResponse.json();
    assert.equal(run.ok, false);
    assert.equal(run.error, "blocked_real_clip_intake");
    assert.equal(run.canRunImport, false);
  });
});

test("Clippers real clip intake blocks symlinked source-drop category directories", async () => {
  const port = "5532";
  const externalDrop = path.join(testWorkspaceParent, "outside-source-drop-sports");
  await mkdir(externalDrop, { recursive: true });
  await writeFile(path.join(externalDrop, "sports-real-7129d59b5f5e.mp4"), `....ftyp${"0".repeat(9000)}`);
  await writeFile(path.join(externalDrop, "source-drop-manifest.csv"), [
    "category,title,url,source,platform,target_file_name,rights_status,evidence_link,priority,notes",
    "sports,External symlinked replacement,https://www.tiktok.com/@creator/video/1234567890123456789,@creator,tiktok,sports-real-7129d59b5f5e.mp4,owned_or_permissioned,https://rights.receipts.local/creator-permission-letter,high,Creator permission recorded for this replacement clip before source drop import.",
    "",
  ].join("\n"));
  await mkdir(path.join(workspaceRoot, "source-drop"), { recursive: true });
  await symlink(externalDrop, path.join(workspaceRoot, "source-drop", "sports"));

  await withServer({ HOST: "127.0.0.1", PORT: port }, async () => {
    const response = await fetch(`http://127.0.0.1:${port}/api/clippers/real-clip-intake-validation.json`);
    assert.equal(response.status, 200);
    const validation = await response.json();
    const row = validation.rows.find((candidate) => candidate.queueItemId === "7129d59b5f5e");
    assert.equal(row.status, "blocked");
    assert.ok(row.blockers.includes("source_drop_category_symlink_or_missing"));
    assert.equal(row.manifestRowFound, false);
    assert.equal(row.fileStatus, "source_drop_category_symlink_or_missing");
    assert.doesNotMatch(JSON.stringify(validation), /outside-source-drop-sports|\/Users\/|\/var\/folders/);
  });
});

test("Clippers real clip intake record neutralizes spreadsheet formulas in operator-controlled CSV cells", async () => {
  const port = "5533";
  const manifestPath = path.join(workspaceRoot, "source-drop", "sports", "source-drop-manifest.csv");
  await withServer({ HOST: "127.0.0.1", PORT: port }, async () => {
    const response = await fetch(`http://127.0.0.1:${port}/api/clippers/real-clip-intake/record`, {
      method: "POST",
      body: new URLSearchParams({
        csrfToken,
        metricoolQueueItemId: "7129d59b5f5e",
        exactVideoOrPostUrl: "https://www.tiktok.com/@creator/video/1234567890123456789",
        creatorOrRightsHolder: "\t@creator",
        evidenceLink: "https://rights.receipts.local/creator-permission-letter",
        operatorNotes: " \t=Creator permission recorded for this exact replacement before source-drop import.",
      }),
    });
    assert.equal(response.status, 200);
    const manifest = await readFile(manifestPath, "utf8");
    assert.match(manifest, /,'@creator,/);
    assert.match(manifest, /,'=Creator permission recorded/);
  });
});

test("Clippers real clip intake validation rejects invalid manual evidence links", async () => {
  const port = "5537";
  const sourceUploadFile = path.join(workspaceRoot, "scheduled", "metricool-current-batch-upload-pack", "02_sport_sports-daily_7129d59b5f5e.mp4");
  const replacementFileName = "sports-real-7129d59b5f5e.mp4";
  const replacementPath = path.join(workspaceRoot, "source-drop", "sports", replacementFileName);
  const manifestPath = path.join(workspaceRoot, "source-drop", "sports", "source-drop-manifest.csv");
  await mkdir(path.dirname(replacementPath), { recursive: true });
  await cp(sourceUploadFile, replacementPath);
  await writeFile(manifestPath, [
    "category,title,url,source,platform,target_file_name,rights_status,evidence_link,priority,notes",
    "sports,Permissioned highlight replacement,https://www.tiktok.com/@creator/video/1234567890123456789,@creator,tiktok,sports-real-7129d59b5f5e.mp4,owned_or_permissioned,trust me,high,Creator permission recorded for this replacement clip before source drop import.",
    "",
  ].join("\n"));

  await withServer({ HOST: "127.0.0.1", PORT: port }, async () => {
    const response = await fetch(`http://127.0.0.1:${port}/api/clippers/real-clip-intake-validation.json`);
    assert.equal(response.status, 200);
    const validation = await response.json();
    const row = validation.rows.find((candidate) => candidate.queueItemId === "7129d59b5f5e");
    assert.equal(row.status, "blocked");
    assert.ok(row.blockers.includes("evidence_link_missing"));
    assert.equal(row.evidenceLinkPresent, false);
    assert.doesNotMatch(JSON.stringify(validation), /trust me|\/Users\/|\/var\/folders/);
  });
});

test("Clippers source-drop Metricool refresh runs only after all intake rows are ready", async () => {
  const port = "5531";
  const researchDir = path.join(workspaceRoot, "research");
  const permissionDir = path.join(workspaceRoot, "evidence-drop", "streamer-permissions");
  const outreachPath = path.join(workspaceRoot, "evidence-drop", "streamer-blanket-permission-outreach.csv");
  const permissionUrl = "/clippers-workspace/evidence-drop/streamer-permissions/creator.md";
  const sourceUploadFile = path.join(workspaceRoot, "scheduled", "metricool-current-batch-upload-pack", "02_sport_sports-daily_7129d59b5f5e.mp4");
  await mkdir(researchDir, { recursive: true });
  await mkdir(permissionDir, { recursive: true });
  await writeFile(path.join(researchDir, "streamer-cohort-indie.json"), `${JSON.stringify({
    streamers: [{ handle: "creator", twitchOfficialUrl: "https://www.twitch.tv/creator" }],
  })}\n`);
  await writeFile(path.join(permissionDir, "creator.md"), "creator granted written blanket permission for commercial TikTok edits of current and future public stream clips with revocation rights retained.\n");
  await writeFile(outreachPath, [
    "handle,outreach_status,permission_status,scope_tiktok,scope_commercial,scope_edits,scope_future_clips,evidence_link",
    `creator,responded,approved_blanket,yes,yes,yes,yes,${permissionUrl}`,
    "",
  ].join("\n"));
  const uploadPackReport = JSON.parse(await readFile(uploadPackReportJsonPath, "utf8"));
  const replacementRows = (uploadPackReport.rows || []).map((row) => {
    const queueId = row.queueItemId || row.metricoolQueueItemId;
    const brand = String(row.metricoolBrandName || row.brand || "").toLowerCase();
    return [brand.includes("meme") ? "memes" : "sports", queueId];
  });
  assert.equal(replacementRows.length, 10);
  for (const [category, queueId] of replacementRows) {
    const replacementPath = path.join(workspaceRoot, "source-drop", category, `${category}-real-${queueId}.mp4`);
    await mkdir(path.dirname(replacementPath), { recursive: true });
    await cp(sourceUploadFile, replacementPath);
  }
  const manifestRowsByCategory = new Map();
  for (const [category, queueId] of replacementRows) {
    if (!manifestRowsByCategory.has(category)) manifestRowsByCategory.set(category, []);
    manifestRowsByCategory.get(category).push([
      category,
      `${category} permissioned replacement ${queueId}`,
      `https://www.tiktok.com/@creator/video/1234567890123456789${queueId.length}`,
      "@creator",
      "tiktok",
      `${category}-real-${queueId}.mp4`,
      "owned_or_permissioned",
      `https://rights.receipts.local/${queueId}`,
      "high",
      `Creator permission recorded for replacement queue ${queueId} before source drop import.`,
    ]);
  }
  for (const [category, rows] of manifestRowsByCategory) {
    const manifestPath = path.join(workspaceRoot, "source-drop", category, "source-drop-manifest.csv");
    await mkdir(path.dirname(manifestPath), { recursive: true });
    await writeFile(manifestPath, [
      "category,title,url,source,platform,target_file_name,rights_status,evidence_link,priority,notes",
      ...rows.map((row) => row.join(",")),
      "",
    ].join("\n"));
  }

  await withServer({ HOST: "127.0.0.1", PORT: port }, async () => {
    const planResponse = await fetch(`http://127.0.0.1:${port}/api/clippers/source-drop-metricool-refresh.json`);
    assert.equal(planResponse.status, 200);
    const plan = await planResponse.json();
    assert.equal(plan.status, "ready_to_import_source_drop");
    assert.equal(plan.canRunImport, true);
    assert.equal(plan.readyRows, 10);
    assert.equal(plan.blockedRows, 0);

    const runResponse = await fetch(`http://127.0.0.1:${port}/api/clippers/source-drop-metricool-refresh/run`, {
      method: "POST",
      body: new URLSearchParams({ csrfToken }),
    });
    assert.equal(runResponse.status, 200);
    const run = await runResponse.json();
    assert.equal(run.ok, true);
    assert.equal(run.status, "source_drop_metricool_refresh_stubbed");
    assert.equal(run.plan.canRunImport, true);
    assert.equal(run.steps[0].script, "server/clippers-agent.ts#importClipperSourceDropFiles");
    assert.equal(run.clippers.realPublishEnabled, false);
    assert.doesNotMatch(JSON.stringify(run), /\/Users\/|\/var\/folders/);
  });
});

test("Clippers real clip intake validation rejects loose URLs generic notes invalid rights and non video files", async () => {
  const port = "5527";
  const replacementFileName = "sports-real-7129d59b5f5e.mp4";
  const replacementPath = path.join(workspaceRoot, "source-drop", "sports", replacementFileName);
  const manifestPath = path.join(workspaceRoot, "source-drop", "sports", "source-drop-manifest.csv");
  await mkdir(path.dirname(replacementPath), { recursive: true });
  await writeFile(replacementPath, "not an mp4 file with enough bytes ".repeat(400));
  await writeFile(manifestPath, [
    "category,title,url,source,platform,target_file_name,rights_status,evidence_link,priority,notes",
    "sports,Loose source replacement,https://vm.tiktok.com/shortpath,@creator,tiktok,sports-real-7129d59b5f5e.mp4,review_required,https://rights.receipts.local/creator-permission-letter,high,approved approved approved approved",
    "",
  ].join("\n"));

  await withServer({ HOST: "127.0.0.1", PORT: port }, async () => {
    const response = await fetch(`http://127.0.0.1:${port}/api/clippers/real-clip-intake-validation.json`);
    assert.equal(response.status, 200);
    const validation = await response.json();
    const row = validation.rows.find((candidate) => candidate.queueItemId === "7129d59b5f5e");
    assert.equal(row.status, "blocked");
    assert.ok(row.blockers.includes("source_file_not_mp4_like"));
    assert.ok(row.blockers.includes("exact_source_video_or_post_url_missing"));
    assert.ok(row.blockers.includes("rights_status_not_owned_or_permissioned"));
    assert.ok(row.blockers.includes("operator_notes_not_concrete"));
    assert.equal(row.exactUrlOk, false);
    assert.equal(row.notesOk, false);
    assert.doesNotMatch(JSON.stringify(validation), /vm\.tiktok\.com|rights\.receipts\.local|\/Users\//);
  });
});

test("Clippers does not unlock Metricool scheduling from manual source filenames alone", async () => {
  const port = "5528";
  const originalSessionPacketJson = await readFile(sessionPacketJsonPath, "utf8");
  const originalUploadPackReportJson = await readFile(uploadPackReportJsonPath, "utf8");
  const originalWorkbookJson = await readFile(currentBatchWorkbookJsonPath, "utf8");
  const markRowsManual = (rows = []) => rows.map((row, index) => {
    const category = String(row.metricoolBrandName || row.brand || row.category || "").toLowerCase().includes("meme") ? "memes" : "sports";
    const queueId = row.metricoolQueueItemId || row.queueItemId || `row-${index + 1}`;
    return {
      ...row,
      sourceFileName: `${category}-real-${queueId}.mp4`,
      sourcePath: path.join(workspaceRoot, "source-drop", category, `${category}-real-${queueId}.mp4`),
    };
  });
  try {
    const sessionPacket = JSON.parse(originalSessionPacketJson);
    sessionPacket.rows = markRowsManual(sessionPacket.rows || []);
    await writeFile(sessionPacketJsonPath, JSON.stringify(sessionPacket, null, 2));

    const uploadPackReport = JSON.parse(originalUploadPackReportJson);
    uploadPackReport.rows = markRowsManual(uploadPackReport.rows || []);
    await writeFile(uploadPackReportJsonPath, JSON.stringify(uploadPackReport, null, 2));

    const workbook = JSON.parse(originalWorkbookJson);
    workbook.rows = markRowsManual(workbook.rows || []);
    await writeFile(currentBatchWorkbookJsonPath, JSON.stringify(workbook, null, 2));

    await withServer({ HOST: "127.0.0.1", PORT: port }, async () => {
      const statusResponse = await fetch(`http://127.0.0.1:${port}/api/clippers/status`);
      assert.equal(statusResponse.status, 200);
      const status = await statusResponse.json();
      assert.equal(status.realClipGap.status, "mixed_sources_need_review");
      assert.equal(status.realClipIntakeValidation.status, "blocked");
      assert.equal(status.realClipIntakeValidation.readyRows, 0);
      assert.equal(status.realClipIntakeValidation.blockedRows, 10);
      assert.equal(status.metricoolSchedulingRunSheet.status, "blocked_real_clip_intake");
      assert.notEqual(status.nextBestAction.stage, "schedule_in_metricool");
      assert.equal(status.nextScheduledProofCsvStarter.trim(), "metricool_queue_item_id,metricool_approval_url,operator_notes");

      const sportsNextResponse = await fetch(`http://127.0.0.1:${port}/api/clippers/tiktok-account-next.json?accountId=sports-daily`);
      assert.equal(sportsNextResponse.status, 200);
      const sportsNext = await sportsNextResponse.json();
      assert.notEqual(sportsNext.status, "schedule_in_metricool");

      const sportsProofCsvResponse = await fetch(`http://127.0.0.1:${port}/api/clippers/tiktok-account-next-scheduled-proof-starter.csv?accountId=sports-daily`);
      assert.equal(sportsProofCsvResponse.status, 200);
      const sportsProofCsv = await sportsProofCsvResponse.text();
      assert.equal(sportsProofCsv.trim(), "metricool_queue_item_id,metricool_approval_url,operator_notes");

      const operatorReadyResponse = await fetch(`http://127.0.0.1:${port}/api/clippers/operator-ready.json`);
      assert.equal(operatorReadyResponse.status, 200);
      const operatorReady = await operatorReadyResponse.json();
      assert.equal(operatorReady.readyToScheduleNow, false);
      assert.equal(operatorReady.deadlineReadiness.okToSchedule, false);
      assert.equal(operatorReady.nextMetricoolRow, null);
      assert.equal(operatorReady.realClipIntakeValidation.status, "blocked");
      assert.doesNotMatch(JSON.stringify(status), /\/Users\/|\/var\/folders/);
    });
  } finally {
    await writeFile(sessionPacketJsonPath, originalSessionPacketJson);
    await writeFile(uploadPackReportJsonPath, originalUploadPackReportJson);
    await writeFile(currentBatchWorkbookJsonPath, originalWorkbookJson);
  }
});

test("Clippers current TikTok video redirect only serves the current upload pack", async () => {
  const port = "5512";
  const originalSessionPacketJson = await readFile(sessionPacketJsonPath, "utf8");
  const outsideUploadPackPath = path.join(workspaceRoot, "reports", "not-current-upload-pack.mp4");
  const sessionPacket = JSON.parse(originalSessionPacketJson);
  const nextCurrentQueueItemId = "7129d59b5f5e";
  await mkdir(path.dirname(outsideUploadPackPath), { recursive: true });
  await writeFile(outsideUploadPackPath, "not a real video, only a redirect guard fixture");
  sessionPacket.rows = (sessionPacket.rows || []).map((row) => row.metricoolQueueItemId === nextCurrentQueueItemId
    ? {
      ...row,
      uploadFileName: "not-current-upload-pack.mp4",
      uploadFilePath: outsideUploadPackPath,
    }
    : row);
  try {
    await writeFile(sessionPacketJsonPath, JSON.stringify(sessionPacket, null, 2));
    await withServer({ HOST: "127.0.0.1", PORT: port }, async () => {
      const statusResponse = await fetch(`http://127.0.0.1:${port}/api/clippers/status`);
      assert.equal(statusResponse.status, 200);
      const status = await statusResponse.json();
      assert.equal(status.uploadPackIntegrity.status, "ready");
      assert.equal(status.metricoolSchedulingRunSheet.nextRow.queueItemId, nextCurrentQueueItemId);
      assert.equal(status.metricoolSchedulingRunSheet.nextRow.uploadFileUrl, "/clippers-workspace/reports/not-current-upload-pack.mp4");

      const currentVideoResponse = await fetch(`http://127.0.0.1:${port}/api/clippers/tiktok-current-video.mp4`, { redirect: "manual" });
      assert.equal(currentVideoResponse.status, 404);
      assert.equal(currentVideoResponse.headers.get("location"), null);
      assert.equal((await currentVideoResponse.json()).error, "current_tiktok_video_not_found");
    });
  } finally {
    await writeFile(sessionPacketJsonPath, originalSessionPacketJson);
    await rm(outsideUploadPackPath, { force: true });
  }
});

test("Clippers local operator blocks Metricool scheduling when upload pack files are missing", async () => {
  const port = "5522";
  const originalSessionPacketJson = await readFile(sessionPacketJsonPath, "utf8");
  const originalEvidenceCsv = await readFile(batchEvidenceCsvPath, "utf8");
  const sessionPacket = JSON.parse(originalSessionPacketJson);
  sessionPacket.rows = (sessionPacket.rows || []).map((row, index) => index === 0
    ? {
      ...row,
      uploadFileName: "missing-local-upload.mp4",
      uploadFilePath: path.join(workspaceRoot, "scheduled", "metricool-current-batch-upload-pack", "missing-local-upload.mp4"),
    }
    : row);
  try {
    await writeFile(sessionPacketJsonPath, JSON.stringify(sessionPacket, null, 2));
    await withServer({ HOST: "127.0.0.1", PORT: port }, async () => {
      const response = await fetch(`http://127.0.0.1:${port}/api/clippers/status`);
      assert.equal(response.status, 200);
      const status = await response.json();
      assert.equal(status.uploadPackIntegrity.status, "blocked_upload_pack");
      assert.equal(status.uploadPackIntegrity.totalRows, 10);
      assert.equal(status.uploadPackIntegrity.readyFiles, 9);
      assert.equal(status.uploadPackIntegrity.missingFiles, 1);
      assert.equal(status.uploadPackIntegrity.zeroByteFiles, 0);
      assert.equal(status.uploadPackIntegrity.blockedRows[0].uploadFileName, "missing-local-upload.mp4");
      assert.equal(status.nextBestAction.stage, "upload_pack_blocked");
      assert.equal(status.nextBestAction.queueItemId, sessionPacket.rows[0].metricoolQueueItemId);

      const operatorReadyResponse = await fetch(`http://127.0.0.1:${port}/api/clippers/operator-ready.json`);
      assert.equal(operatorReadyResponse.status, 200);
      const operatorReady = await operatorReadyResponse.json();
      assert.equal(operatorReady.readyToScheduleNow, false);
      assert.equal(operatorReady.uploadPackIntegrity.status, "blocked_upload_pack");
      assert.equal(operatorReady.nextBestAction.stage, "upload_pack_blocked");

      const homeResponse = await fetch(`http://127.0.0.1:${port}/clippers`);
      assert.equal(homeResponse.status, 200);
      const home = await homeResponse.text();
      assert.match(home, /Upload pack integrity/);
      assert.match(home, /missing-local-upload\.mp4/);

      const scheduledResponse = await fetch(`http://127.0.0.1:${port}/api/clippers/evidence/scheduled`, {
        method: "POST",
        body: new URLSearchParams({
          csrfToken,
          metricoolQueueItemId: sessionPacket.rows[0].metricoolQueueItemId,
          metricoolApprovalUrl: "https://app.metricool.com/planner/upload-pack-blocked-single",
          operatorNotes: "Scheduled manually in Metricool planner for upload pack blocked single test.",
        }),
      });
      assert.equal(scheduledResponse.status, 409);
      assert.equal((await scheduledResponse.json()).error, "upload_pack_blocked");

      const scheduledBatch = [
        "metricool_queue_item_id,metricool_approval_url,operator_notes",
        `${sessionPacket.rows[0].metricoolQueueItemId},https://app.metricool.com/planner/upload-pack-blocked-batch,Scheduled manually in Metricool planner for upload pack blocked batch test.`,
      ].join("\n");
      const scheduledBatchPreviewResponse = await fetch(`http://127.0.0.1:${port}/api/clippers/evidence/scheduled-batch-preview`, {
        method: "POST",
        body: new URLSearchParams({ csrfToken, scheduledEvidenceBatch: scheduledBatch }),
      });
      assert.equal(scheduledBatchPreviewResponse.status, 200);
      const scheduledBatchPreview = await scheduledBatchPreviewResponse.json();
      assert.equal(scheduledBatchPreview.ok, false);
      assert.equal(scheduledBatchPreview.error, "upload_pack_blocked");

      const scheduledBatchResponse = await fetch(`http://127.0.0.1:${port}/api/clippers/evidence/scheduled-batch`, {
        method: "POST",
        body: new URLSearchParams({ csrfToken, scheduledEvidenceBatch: scheduledBatch }),
      });
      assert.equal(scheduledBatchResponse.status, 409);
      assert.equal((await scheduledBatchResponse.json()).error, "upload_pack_blocked");
      assert.equal(await readFile(batchEvidenceCsvPath, "utf8"), originalEvidenceCsv);
    });
  } finally {
    await writeFile(sessionPacketJsonPath, originalSessionPacketJson);
    await writeFile(batchEvidenceCsvPath, originalEvidenceCsv);
  }
});

test("Clippers local operator requires scheduled proof in deadline order", async () => {
  const port = "5523";
  const originalEvidenceCsv = await readFile(batchEvidenceCsvPath, "utf8");
  try {
    await withServer({ HOST: "127.0.0.1", PORT: port }, async () => {
      const statusResponse = await fetch(`http://127.0.0.1:${port}/api/clippers/status`);
      assert.equal(statusResponse.status, 200);
      const status = await statusResponse.json();
      const [firstDeadlineRow, secondDeadlineRow] = status.metricoolSchedulingRunSheet.rows;
      assert.equal(firstDeadlineRow.queueItemId, "7129d59b5f5e");
      assert.equal(secondDeadlineRow.queueItemId, "53467d8f7dad");

      const outOfOrderSingleResponse = await fetch(`http://127.0.0.1:${port}/api/clippers/evidence/scheduled`, {
        method: "POST",
        body: new URLSearchParams({
          csrfToken,
          metricoolQueueItemId: secondDeadlineRow.queueItemId,
          metricoolApprovalUrl: "https://app.metricool.com/planner/out-of-order-single",
          operatorNotes: "Scheduled manually in Metricool planner for out of order single test.",
        }),
      });
      assert.equal(outOfOrderSingleResponse.status, 409);
      const outOfOrderSingle = await outOfOrderSingleResponse.json();
      assert.equal(outOfOrderSingle.error, "scheduled_proof_deadline_order_required");
      assert.equal(outOfOrderSingle.expectedNextQueueItemId, firstDeadlineRow.queueItemId);

      const validNextRowSingleResponse = await fetch(`http://127.0.0.1:${port}/api/clippers/evidence/scheduled`, {
        method: "POST",
        body: new URLSearchParams({
          csrfToken,
          metricoolQueueItemId: firstDeadlineRow.queueItemId,
          metricoolApprovalUrl: "https://app.metricool.com/planner/valid-next-row-without-real-intake",
          operatorNotes: "Scheduled manually in Metricool planner for valid next row while real intake is blocked.",
        }),
      });
      assert.equal(validNextRowSingleResponse.status, 409);
      const validNextRowSingle = await validNextRowSingleResponse.json();
      assert.equal(validNextRowSingle.error, "real_clip_intake_not_ready");
      assert.equal(validNextRowSingle.metricoolQueueItemId, firstDeadlineRow.queueItemId);
      assert.equal(await readFile(batchEvidenceCsvPath, "utf8"), originalEvidenceCsv);

      const outOfOrderBatch = [
        "metricool_queue_item_id,metricool_approval_url,operator_notes",
        `${secondDeadlineRow.queueItemId},https://app.metricool.com/planner/out-of-order-batch,Scheduled manually in Metricool planner for out of order batch test.`,
      ].join("\n");
      const outOfOrderPreviewResponse = await fetch(`http://127.0.0.1:${port}/api/clippers/evidence/scheduled-batch-preview`, {
        method: "POST",
        body: new URLSearchParams({ csrfToken, scheduledEvidenceBatch: outOfOrderBatch }),
      });
      assert.equal(outOfOrderPreviewResponse.status, 200);
      const outOfOrderPreview = await outOfOrderPreviewResponse.json();
      assert.equal(outOfOrderPreview.ok, false);
      assert.equal(outOfOrderPreview.error, "scheduled_proof_deadline_order_required");

      const orderedBatch = [
        "metricool_queue_item_id,metricool_approval_url,operator_notes",
        `${firstDeadlineRow.queueItemId},https://app.metricool.com/planner/ordered-first,Scheduled manually in Metricool planner for ordered first row test.`,
        `${secondDeadlineRow.queueItemId},https://app.metricool.com/planner/ordered-second,Scheduled manually in Metricool planner for ordered second row test.`,
      ].join("\n");
      const orderedPreviewResponse = await fetch(`http://127.0.0.1:${port}/api/clippers/evidence/scheduled-batch-preview`, {
        method: "POST",
        body: new URLSearchParams({ csrfToken, scheduledEvidenceBatch: orderedBatch }),
      });
      assert.equal(orderedPreviewResponse.status, 200);
      const orderedPreview = await orderedPreviewResponse.json();
      assert.equal(orderedPreview.ok, false);
      assert.equal(orderedPreview.error, "real_clip_intake_not_ready");
      assert.equal(await readFile(batchEvidenceCsvPath, "utf8"), originalEvidenceCsv);
    });
  } finally {
    await writeFile(batchEvidenceCsvPath, originalEvidenceCsv);
  }
});

test("Metricool handoff script honors CLIPPERS_WORKSPACE_ROOT", async () => {
  const handoffScriptPath = path.join(process.cwd(), "script/clippers-metricool-operator-handoff.mjs");
  const liveRunSheetPath = path.join(liveWorkspaceRoot, "scheduled", "metricool-100-operator-run-sheet.csv");
  const tempRunSheetPath = path.join(workspaceRoot, "scheduled", "metricool-100-operator-run-sheet.csv");
  const liveBefore = await readFile(liveRunSheetPath, "utf8");
  const tempBefore = await readFile(tempRunSheetPath, "utf8");
  const result = await new Promise((resolve) => {
    const child = spawn(process.execPath, [handoffScriptPath], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        CLIPPERS_WORKSPACE_ROOT: workspaceRoot,
        CLIPPERS_ROLL_FORWARD_MIN_LEAD_MINUTES: "999999",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
  assert.equal(result.code, 0, result.stderr || result.stdout);
  assert.equal(await readFile(liveRunSheetPath, "utf8"), liveBefore);
  assert.notEqual(await readFile(tempRunSheetPath, "utf8"), tempBefore);
});

test("Clippers local operator watchdog stays held unless the local schedule is too close", async () => {
  const port = "5513";
  await withServer({
    HOST: "127.0.0.1",
    PORT: port,
    CLIPPERS_AUTO_ROLL_FORWARD: "true",
    CLIPPERS_AUTO_ROLL_FORWARD_MIN_LEAD_MINUTES: "-999",
    CLIPPERS_AUTO_ROLL_FORWARD_INTERVAL_MS: "5000",
  }, async () => {
    await new Promise((resolve) => setTimeout(resolve, 200));
    const response = await fetch(`http://127.0.0.1:${port}/api/clippers/status`);
    assert.equal(response.status, 200);
    const status = await response.json();
    assert.equal(status.watchdog.enabled, true);
    assert.equal(status.watchdog.thresholdMinutes, -999);
    assert.equal(typeof status.watchdog.minutesUntilAutoRollForward, "number");
    assert.match(status.watchdog.autoRollForwardThresholdAt, /^\d{4}-\d{2}-\d{2}T/);
    assert.equal(status.watchdog.safeToAutoRollForward, false);
    assert.ok(status.watchdog.blockers.includes("lead_time_above_threshold"));
    assert.notEqual(status.watchdog.lastStatus, "rolled_forward");
    assert.equal(status.realPublishEnabled, false);
  });
});

test("Clippers local operator server derives Metricool MVP readiness from blockers", async () => {
  const port = "5512";
  const originalAccountReadinessJson = await readFile(accountReadinessJsonPath, "utf8");
  const originalTiktokExternalCloseoutJson = await readFile(tiktokExternalCloseoutJsonPath, "utf8");
  const accountReadiness = JSON.parse(originalAccountReadinessJson);
  const externalCloseout = JSON.parse(originalTiktokExternalCloseoutJson);
  accountReadiness.status = "metricool_mvp_ready";
  accountReadiness.directSocialApisRequired = true;
  accountReadiness.activeMvp = { ...(accountReadiness.activeMvp || {}), readyLanes: 1, targetLanes: 2 };
  externalCloseout.totals = { ...(externalCloseout.totals || {}), activeTasks: 1, deferredTasks: 4 };
  try {
    await writeFile(accountReadinessJsonPath, JSON.stringify(accountReadiness, null, 2));
    await writeFile(tiktokExternalCloseoutJsonPath, JSON.stringify(externalCloseout, null, 2));
    await withServer({ HOST: "127.0.0.1", PORT: port }, async () => {
      const response = await fetch(`http://127.0.0.1:${port}/api/clippers/status`);
      assert.equal(response.status, 200);
      const status = await response.json();
      assert.equal(status.metricoolMvp.status, "blocked_metricool_mvp_readiness_gap");
      assert.equal(status.metricoolMvp.directSocialApisRequired, false);
      assert.equal(status.metricoolMvp.directApisDeferred, true);
      assert.equal(status.metricoolMvp.artifactDirectSocialApisRequired, true);
      assert.ok(status.metricoolMvp.blockers.includes("active_lanes_1_of_2"));
      assert.ok(status.metricoolMvp.blockers.includes("active_external_tasks_1"));
      assert.doesNotMatch(status.metricoolMvp.nextStep, /ready for Metricool approval_required operation/i);
      assert.equal(status.metricoolOperatorChecklist.status, "blocked_operator_checklist");
      assert.ok(status.metricoolOperatorChecklist.blockers.includes("metricool_mvp_not_ready"));

      const operatorReadyResponse = await fetch(`http://127.0.0.1:${port}/api/clippers/operator-ready.json`);
      assert.equal(operatorReadyResponse.status, 200);
      const operatorReady = await operatorReadyResponse.json();
      assert.equal(operatorReady.operatorReady, false);
      assert.equal(operatorReady.readyToScheduleNow, false);
      assert.equal(operatorReady.goalComplete, false);
      assert.equal(operatorReady.realPublishEnabled, false);
      assert.equal(operatorReady.metricoolApprovalRequired, true);
      assert.ok(operatorReady.blockers.includes("metricool_tiktok_mvp_not_ready"));
    });
  } finally {
    await writeFile(accountReadinessJsonPath, originalAccountReadinessJson);
    await writeFile(tiktokExternalCloseoutJsonPath, originalTiktokExternalCloseoutJson);
  }
});

test("Clippers local operator keeps non-TikTok rows out of the Metricool operator path", async () => {
  const port = "5517";
  const originalSessionPacketJson = await readFile(sessionPacketJsonPath, "utf8");
  const originalEvidenceCsv = await readFile(batchEvidenceCsvPath, "utf8");
  const sessionPacket = JSON.parse(originalSessionPacketJson);
  sessionPacket.rows = [
    {
      ...(sessionPacket.rows?.[0] || {}),
      rank: 0,
      metricoolQueueItemId: "instagram-should-not-run",
      accountId: "ig-later",
      accountName: "Instagram Later",
      metricoolBrandName: "IG Later",
      platform: "instagram",
      publishAt: "2020-01-01T00:00:00.000Z",
      uploadFileName: "instagram-later.mp4",
      uploadFilePath: "/tmp/instagram-later.mp4",
      captionSeed: "Out of scope until Robert connects non-TikTok accounts.",
    },
    ...(sessionPacket.rows || []),
  ];
  try {
    await writeFile(sessionPacketJsonPath, JSON.stringify(sessionPacket, null, 2));
    await writeFile(batchEvidenceCsvPath, [
      originalEvidenceCsv.trimEnd(),
      "instagram-should-not-run,ig-later,Instagram Later,instagram,IG Later,,2020-01-01T00:00:00.000Z,/tmp/instagram-later.mp4,Out of scope until Robert connects non-TikTok accounts.,https://app.metricool.com/planner/instagram-old-proof,,scheduled,,,,,Existing non-TikTok row must stay deferred.",
    ].join("\n") + "\n");
    await withServer({ HOST: "127.0.0.1", PORT: port }, async () => {
      const response = await fetch(`http://127.0.0.1:${port}/api/clippers/status`);
      assert.equal(response.status, 200);
      const status = await response.json();
      assert.equal(status.tiktokOnly, true);
      assert.equal(status.deferredOtherPlatformRows, 1);
      assert.ok(status.rows.every((row) => row.platform === "tiktok"));
      assert.equal(status.metricoolSchedulingRunSheet.totalRows, 10);
      assert.equal(status.metricoolSchedulingRunSheet.rows.some((row) => row.queueItemId === "instagram-should-not-run"), false);
      assert.notEqual(status.operatorSummary.deadlineQueueItemId, "instagram-should-not-run");
      assert.doesNotMatch(status.metricoolSchedulingRunSheet.uploadChecklistCsv, /instagram-should-not-run/);

      const operatorReadyResponse = await fetch(`http://127.0.0.1:${port}/api/clippers/operator-ready.json`);
      assert.equal(operatorReadyResponse.status, 200);
      const operatorReady = await operatorReadyResponse.json();
      assert.equal(operatorReady.tiktokOnly, true);
      assert.equal(operatorReady.deferredOtherPlatformRows, 1);

      const scheduledResponse = await fetch(`http://127.0.0.1:${port}/api/clippers/evidence/scheduled`, {
        method: "POST",
        body: new URLSearchParams({
          csrfToken,
          metricoolQueueItemId: "instagram-should-not-run",
          metricoolApprovalUrl: "https://app.metricool.com/planner/instagram-proof",
          operatorNotes: "Scheduled manually in Metricool planner but this row is not TikTok.",
        }),
      });
      assert.equal(scheduledResponse.status, 409);
      const scheduledResult = await scheduledResponse.json();
      assert.equal(scheduledResult.error, "non_tiktok_metricool_row_deferred");

      const scheduledBatchPreviewResponse = await fetch(`http://127.0.0.1:${port}/api/clippers/evidence/scheduled-batch-preview`, {
        method: "POST",
        body: new URLSearchParams({
          csrfToken,
          scheduledEvidenceBatch: [
            "metricool_queue_item_id,metricool_approval_url,operator_notes",
            "instagram-should-not-run,https://app.metricool.com/planner/instagram-proof,Scheduled manually in Metricool planner but this row is not TikTok.",
          ].join("\n"),
        }),
      });
      assert.equal(scheduledBatchPreviewResponse.status, 200);
      const scheduledBatchPreview = await scheduledBatchPreviewResponse.json();
      assert.equal(scheduledBatchPreview.error, "non_tiktok_metricool_row_deferred");

      const publishedBatchPreviewResponse = await fetch(`http://127.0.0.1:${port}/api/clippers/evidence/published-batch-preview`, {
        method: "POST",
        body: new URLSearchParams({
          csrfToken,
          publishedEvidenceBatch: [
            "metricool_queue_item_id,published_post_url,views_24h,likes_24h,comments_24h,shares_24h,operator_notes",
            "instagram-should-not-run,https://www.tiktok.com/@later/video/1234567890123456789,100,10,1,1,Real published metrics captured after the post was live.",
          ].join("\n"),
        }),
      });
      assert.equal(publishedBatchPreviewResponse.status, 200);
      const publishedBatchPreview = await publishedBatchPreviewResponse.json();
      assert.equal(publishedBatchPreview.error, "non_tiktok_metricool_row_deferred");
      assert.match(await readFile(batchEvidenceCsvPath, "utf8"), /instagram-old-proof/);
      assert.doesNotMatch(await readFile(batchEvidenceCsvPath, "utf8"), /instagram-proof/);
    });
  } finally {
    await writeFile(sessionPacketJsonPath, originalSessionPacketJson);
    await writeFile(batchEvidenceCsvPath, originalEvidenceCsv);
  }
});

test("Clippers local operator rejects stale TikTok evidence rows outside the current batch", async () => {
  const port = "5518";
  const originalEvidenceCsv = await readFile(batchEvidenceCsvPath, "utf8");
  try {
    await writeFile(batchEvidenceCsvPath, [
      originalEvidenceCsv.trimEnd(),
      "stale-tiktok-row,old-sports,Old Sports,tiktok,SPORT,,2026-07-02T00:00:00.000Z,/tmp/stale-tiktok.mp4,Old TikTok row that is not in the current session packet.,https://app.metricool.com/planner/stale-old-proof,,scheduled,,,,,Existing stale row must stay untouched.",
    ].join("\n") + "\n");
    await withServer({ HOST: "127.0.0.1", PORT: port }, async () => {
      const response = await fetch(`http://127.0.0.1:${port}/api/clippers/status`);
      assert.equal(response.status, 200);
      const status = await response.json();
      assert.equal(status.rows.some((row) => row.queueItemId === "stale-tiktok-row"), false);

      const scheduledResponse = await fetch(`http://127.0.0.1:${port}/api/clippers/evidence/scheduled`, {
        method: "POST",
        body: new URLSearchParams({
          csrfToken,
          metricoolQueueItemId: "stale-tiktok-row",
          metricoolApprovalUrl: "https://app.metricool.com/planner/stale-new-proof",
          operatorNotes: "Scheduled manually in Metricool planner but this stale row is not current.",
        }),
      });
      assert.equal(scheduledResponse.status, 409);
      const scheduledResult = await scheduledResponse.json();
      assert.equal(scheduledResult.error, "metricool_queue_item_not_in_current_tiktok_batch");

      const scheduledBatchPreviewResponse = await fetch(`http://127.0.0.1:${port}/api/clippers/evidence/scheduled-batch-preview`, {
        method: "POST",
        body: new URLSearchParams({
          csrfToken,
          scheduledEvidenceBatch: [
            "metricool_queue_item_id,metricool_approval_url,operator_notes",
            "stale-tiktok-row,https://app.metricool.com/planner/stale-new-proof,Scheduled manually in Metricool planner but this stale row is not current.",
          ].join("\n"),
        }),
      });
      assert.equal(scheduledBatchPreviewResponse.status, 200);
      const scheduledBatchPreview = await scheduledBatchPreviewResponse.json();
      assert.equal(scheduledBatchPreview.error, "metricool_queue_item_not_in_current_tiktok_batch");

      const publishedBatchPreviewResponse = await fetch(`http://127.0.0.1:${port}/api/clippers/evidence/published-batch-preview`, {
        method: "POST",
        body: new URLSearchParams({
          csrfToken,
          publishedEvidenceBatch: [
            "metricool_queue_item_id,published_post_url,views_24h,likes_24h,comments_24h,shares_24h,operator_notes",
            "stale-tiktok-row,https://www.tiktok.com/@old/video/1234567890123456789,100,10,1,1,Real published metrics captured after the post was live.",
          ].join("\n"),
        }),
      });
      assert.equal(publishedBatchPreviewResponse.status, 200);
      const publishedBatchPreview = await publishedBatchPreviewResponse.json();
      assert.equal(publishedBatchPreview.error, "metricool_queue_item_not_in_current_tiktok_batch");
      const csvAfterRejectedWrites = await readFile(batchEvidenceCsvPath, "utf8");
      assert.match(csvAfterRejectedWrites, /stale-old-proof/);
      assert.doesNotMatch(csvAfterRejectedWrites, /stale-new-proof/);
      assert.doesNotMatch(csvAfterRejectedWrites, /1234567890123456789/);
    });
  } finally {
    await writeFile(batchEvidenceCsvPath, originalEvidenceCsv);
  }
});

test("Clippers local operator blocks new scheduled proof when the batch needs roll-forward", async () => {
  const port = "5519";
  const originalSessionPacketJson = await readFile(sessionPacketJsonPath, "utf8");
  const originalEvidenceCsv = await readFile(batchEvidenceCsvPath, "utf8");
  const sessionPacket = JSON.parse(originalSessionPacketJson);
  sessionPacket.rows = (sessionPacket.rows || []).map((row) => ({
    ...row,
    publishAt: "2020-01-01T00:00:00.000Z",
  }));
  const evidenceLines = originalEvidenceCsv.trimEnd().split("\n");
  const scheduledFirstRow = evidenceLines[1].split(",");
  scheduledFirstRow[9] = "https://app.metricool.com/planner/already-scheduled-proof";
  scheduledFirstRow[11] = "scheduled";
  scheduledFirstRow[16] = "Scheduled manually in Metricool planner before the schedule expired.";
  evidenceLines[1] = scheduledFirstRow.join(",");
  evidenceLines.push("expired-instagram-row,ig-later,Instagram Later,instagram,IG Later,,2020-01-01T00:00:00.000Z,/tmp/instagram-later.mp4,Out of scope until Robert connects non-TikTok accounts.,https://app.metricool.com/planner/instagram-old-proof,,scheduled,,,,,Existing non-TikTok row must stay deferred.");
  try {
    await writeFile(sessionPacketJsonPath, JSON.stringify(sessionPacket, null, 2));
    await writeFile(batchEvidenceCsvPath, `${evidenceLines.join("\n")}\n`);
    await withServer({ HOST: "127.0.0.1", PORT: port }, async () => {
      const response = await fetch(`http://127.0.0.1:${port}/api/clippers/status`);
      assert.equal(response.status, 200);
      const status = await response.json();
      assert.equal(status.operatorSummary.needsRollForward, true);
      assert.ok(status.metricoolOperatorChecklist.blockers.includes("schedule_needs_roll_forward"));
      assert.notEqual(status.nextBestAction.stage, "roll_forward_required");
      assert.equal(status.nextBestAction.stage, "manual_review_schedule_expired");
      assert.match(status.nextBestAction.detail, /cannot be safely rolled forward/);
      assert.equal(status.scheduledProofCsvStarter.trim(), "metricool_queue_item_id,metricool_approval_url,operator_notes");
      assert.equal(status.nextScheduledProofCsvStarter.trim(), "metricool_queue_item_id,metricool_approval_url,operator_notes");

      const scheduledResponse = await fetch(`http://127.0.0.1:${port}/api/clippers/evidence/scheduled`, {
        method: "POST",
        body: new URLSearchParams({
          csrfToken,
          metricoolQueueItemId: "7129d59b5f5e",
          metricoolApprovalUrl: "https://app.metricool.com/planner/expired-scheduled-proof",
          operatorNotes: "Scheduled manually in Metricool planner after the batch expired.",
        }),
      });
      assert.equal(scheduledResponse.status, 409);
      const scheduledResult = await scheduledResponse.json();
      assert.equal(scheduledResult.error, "schedule_needs_roll_forward_before_scheduled_proof");
      assert.equal(scheduledResult.scheduleWindowStatus, "expired");

      const nonTikTokScheduledResponse = await fetch(`http://127.0.0.1:${port}/api/clippers/evidence/scheduled`, {
        method: "POST",
        body: new URLSearchParams({
          csrfToken,
          metricoolQueueItemId: "expired-instagram-row",
          metricoolApprovalUrl: "https://app.metricool.com/planner/expired-instagram-proof",
          operatorNotes: "Scheduled manually in Metricool planner but this row is not TikTok.",
        }),
      });
      assert.equal(nonTikTokScheduledResponse.status, 409);
      const nonTikTokScheduled = await nonTikTokScheduledResponse.json();
      assert.equal(nonTikTokScheduled.error, "non_tiktok_metricool_row_deferred");

      const nextScheduledProofResponse = await fetch(`http://127.0.0.1:${port}/api/clippers/next-scheduled-proof-starter.csv`);
      assert.equal(nextScheduledProofResponse.status, 200);
      assert.equal((await nextScheduledProofResponse.text()).trim(), "metricool_queue_item_id,metricool_approval_url,operator_notes");

      const accountScheduledProofResponse = await fetch(`http://127.0.0.1:${port}/api/clippers/tiktok-account-scheduled-proof-starter.csv?accountId=sports-daily`);
      assert.equal(accountScheduledProofResponse.status, 200);
      assert.equal((await accountScheduledProofResponse.text()).trim(), "metricool_queue_item_id,metricool_approval_url,operator_notes");

      const accountNextScheduledProofResponse = await fetch(`http://127.0.0.1:${port}/api/clippers/tiktok-account-next-scheduled-proof-starter.csv?accountId=sports-daily`);
      assert.equal(accountNextScheduledProofResponse.status, 200);
      assert.equal((await accountNextScheduledProofResponse.text()).trim(), "metricool_queue_item_id,metricool_approval_url,operator_notes");

      const accountNextUploadChecklistResponse = await fetch(`http://127.0.0.1:${port}/api/clippers/tiktok-account-next-upload-checklist.csv?accountId=sports-daily`);
      assert.equal(accountNextUploadChecklistResponse.status, 200);
      assert.equal((await accountNextUploadChecklistResponse.text()).trim(), "order,metricool_queue_item_id,metricool_brand,account_name,platform,publish_at_local,publish_at_iso,upload_file_name,caption_seed,scheduled_note_template");

      const currentNextScheduledProofResponse = await fetch(`http://127.0.0.1:${port}/api/clippers/tiktok-current-next-scheduled-proof-starter.csv`);
      assert.equal(currentNextScheduledProofResponse.status, 200);
      assert.equal((await currentNextScheduledProofResponse.text()).trim(), "metricool_queue_item_id,metricool_approval_url,operator_notes");

      const currentNextUploadChecklistResponse = await fetch(`http://127.0.0.1:${port}/api/clippers/tiktok-current-next-upload-checklist.csv`);
      assert.equal(currentNextUploadChecklistResponse.status, 200);
      assert.equal((await currentNextUploadChecklistResponse.text()).trim(), "order,metricool_queue_item_id,metricool_brand,account_name,platform,publish_at_local,publish_at_iso,upload_file_name,caption_seed,scheduled_note_template");

      const accountNowResponse = await fetch(`http://127.0.0.1:${port}/api/clippers/tiktok-account-now.html?accountId=sports-daily`);
      assert.equal(accountNowResponse.status, 200);
      const accountNowHtml = await accountNowResponse.text();
      assert.match(accountNowHtml, /SPORT TikTok Now/);
      assert.match(accountNowHtml, /No programes hasta resolver el bloqueo/);
      assert.match(accountNowHtml, /necesita roll-forward/);
      assert.doesNotMatch(accountNowHtml, /Preview scheduled proof/);

      const nextActionPacketResponse = await fetch(`http://127.0.0.1:${port}/api/clippers/next-metricool-action.md`);
      assert.equal(nextActionPacketResponse.status, 200);
      const nextActionPacket = await nextActionPacketResponse.text();
      assert.match(nextActionPacket, /manual_review_schedule_expired/);
      assert.doesNotMatch(nextActionPacket, /## Schedule This Row/);

      const scheduledPreviewResponse = await fetch(`http://127.0.0.1:${port}/api/clippers/evidence/scheduled-batch-preview`, {
        method: "POST",
        body: new URLSearchParams({
          csrfToken,
          scheduledEvidenceBatch: [
            "metricool_queue_item_id,metricool_approval_url,operator_notes",
            "7129d59b5f5e,https://app.metricool.com/planner/expired-scheduled-proof,Scheduled manually in Metricool planner after the batch expired.",
          ].join("\n"),
        }),
      });
      assert.equal(scheduledPreviewResponse.status, 200);
      const scheduledPreview = await scheduledPreviewResponse.json();
      assert.equal(scheduledPreview.error, "schedule_needs_roll_forward_before_scheduled_proof");
      assert.doesNotMatch(await readFile(batchEvidenceCsvPath, "utf8"), /expired-scheduled-proof/);

      const publishedResponse = await fetch(`http://127.0.0.1:${port}/api/clippers/evidence/published`, {
        method: "POST",
        body: new URLSearchParams({
          csrfToken,
          metricoolQueueItemId: "53467d8f7dad",
          publishedPostUrl: "https://www.tiktok.com/@meme/video/1234567890123456789",
          views24h: "100",
          likes24h: "10",
          comments24h: "1",
          shares24h: "1",
          operatorNotes: "Real published metrics captured after the post was live.",
        }),
      });
      assert.equal(publishedResponse.status, 409);
      assert.equal((await publishedResponse.json()).error, "published_metrics_preview_confirmation_required");
    });
  } finally {
    await writeFile(sessionPacketJsonPath, originalSessionPacketJson);
    await writeFile(batchEvidenceCsvPath, originalEvidenceCsv);
  }
});

test("Clippers local operator evidence integrity blocks fake proof markers without leaking values", async () => {
  const port = "5523";
  const originalEvidenceCsv = await readFile(batchEvidenceCsvPath, "utf8");
  try {
    const evidenceLines = originalEvidenceCsv.split(/\r?\n/);
    evidenceLines[1] = evidenceLines[1].replace(
      ",,,,,,,,",
      ",https://app.metricool.com/planner/mixed-scheduled-proof,https://www.tiktok.com/@meme/video/1234567890123456789,scheduled,100,10,1,2,Scheduled manually in Metricool planner with mixed published fields.",
    );
    evidenceLines[2] = evidenceLines[2].replace(
      ",,,,,,,,",
      ",https://app.metricool.com/planner/test-proof,,scheduled,,,,,Scheduled manually in Metricool planner with specific fake marker notes.",
    );
    evidenceLines[3] = evidenceLines[3].replace(
      ",,,,,,,,",
      ",,,published,,,,,Published manually without complete public metrics.",
    );
    evidenceLines[6] = evidenceLines[6].replace(
      ",,,,,,,,",
      ",https://app.metricool.com/planner/orphan-proof,,,,,,,Metricool proof entered without a final status.",
    );
    evidenceLines[7] = evidenceLines[7].replace(
      ",,,,,,,,",
      ",,https://www.tiktok.com/@sports/video/2234567890123456789,,50,5,1,1,Public fields entered without a final status.",
    );
    evidenceLines.push("stale-row-id,stale,Stale Row,tiktok,SPORT,6431687,2026-07-05T13:00:00.000Z,/tmp/stale.mp4,stale caption,https://app.metricool.com/planner/stale-proof-url,,scheduled,,,,,Scheduled manually in Metricool planner for a stale row.");
    await writeFile(batchEvidenceCsvPath, `${evidenceLines.filter(Boolean).join("\n")}\n`);

    await withServer({ HOST: "127.0.0.1", PORT: port }, async () => {
      const statusResponse = await fetch(`http://127.0.0.1:${port}/api/clippers/status`);
      assert.equal(statusResponse.status, 200);
      const status = await statusResponse.json();
      assert.equal(status.evidenceIntegrity.status, "blocked");
      assert.ok(status.evidenceIntegrity.findingsCount >= 1);
      assert.ok(status.evidenceIntegrity.findings.some((finding) => finding.code === "test_or_fake_evidence_marker"));
      assert.ok(status.evidenceIntegrity.findings.some((finding) => finding.code === "scheduled_status_with_published_fields"));
      assert.ok(status.evidenceIntegrity.findings.some((finding) => finding.code === "published_status_without_complete_public_proof"));
      assert.ok(status.evidenceIntegrity.findings.some((finding) => finding.code === "published_status_without_valid_scheduled_proof"));
      assert.ok(status.evidenceIntegrity.findings.some((finding) => finding.code === "metricool_proof_without_recognized_final_status"));
      assert.ok(status.evidenceIntegrity.findings.some((finding) => finding.code === "published_fields_without_recognized_final_status"));
      assert.ok(status.evidenceIntegrity.findings.some((finding) => finding.code === "batch_master_evidence_mismatch"));
      assert.ok(status.evidenceIntegrity.findings.some((finding) => finding.code === "stale_batch_evidence_row"));
      assert.doesNotMatch(JSON.stringify(status.evidenceIntegrity), /test-proof/);
      assert.doesNotMatch(JSON.stringify(status.evidenceIntegrity), /mixed-scheduled-proof/);
      assert.doesNotMatch(JSON.stringify(status.evidenceIntegrity), /orphan-proof|2234567890123456789/);
      assert.doesNotMatch(JSON.stringify(status.evidenceIntegrity), /stale-proof-url/);
      assert.match(status.evidenceIntegrity.nextAction, /Fix or remove invalid\/fake evidence/);

      const integrityResponse = await fetch(`http://127.0.0.1:${port}/api/clippers/evidence-integrity.json`);
      assert.equal(integrityResponse.status, 200);
      const integrity = await integrityResponse.json();
      assert.equal(integrity.status, "blocked");
      assert.equal(integrity.readOnly, true);
      assert.ok(integrity.findings.some((finding) => finding.queueItemId === "7129d59b5f5e"));
      assert.doesNotMatch(JSON.stringify(integrity), /https:\/\/app\.metricool\.com\/planner\/test-proof/);
      assert.doesNotMatch(JSON.stringify(integrity), /orphan-proof|2234567890123456789/);

      const previewWhileBlockedResponse = await fetch(`http://127.0.0.1:${port}/api/clippers/evidence/scheduled-preview`, {
        method: "POST",
        body: new URLSearchParams({
          csrfToken,
          metricoolQueueItemId: "53467d8f7dad",
          metricoolApprovalUrl: "https://app.metricool.com/planner/preview-while-integrity-blocked",
          operatorNotes: "Scheduled manually in Metricool planner while integrity is blocked.",
        }),
      });
      assert.equal(previewWhileBlockedResponse.status, 200);
      const previewWhileBlocked = await previewWhileBlockedResponse.json();
      assert.notEqual(previewWhileBlocked.writes, true);
      assert.doesNotMatch(await readFile(batchEvidenceCsvPath, "utf8"), /preview-while-integrity-blocked/);

      const writeWhileBlockedResponse = await fetch(`http://127.0.0.1:${port}/api/clippers/evidence/scheduled`, {
        method: "POST",
        body: new URLSearchParams({
          csrfToken,
          metricoolQueueItemId: "ef11cfd492f0",
          metricoolApprovalUrl: "https://app.metricool.com/planner/write-while-integrity-blocked",
          operatorNotes: "Scheduled manually in Metricool planner while integrity is blocked.",
        }),
      });
      assert.equal(writeWhileBlockedResponse.status, 409);
      const writeWhileBlocked = await writeWhileBlockedResponse.json();
      assert.equal(writeWhileBlocked.error, "evidence_integrity_blocked");
      assert.ok(writeWhileBlocked.findingsCount >= 1);
      assert.doesNotMatch(JSON.stringify(writeWhileBlocked), /test-proof|write-while-integrity-blocked/);
      assert.doesNotMatch(await readFile(batchEvidenceCsvPath, "utf8"), /write-while-integrity-blocked/);

      const batchWriteWhileBlockedResponse = await fetch(`http://127.0.0.1:${port}/api/clippers/evidence/scheduled-batch`, {
        method: "POST",
        body: new URLSearchParams({
          csrfToken,
          scheduledEvidenceBatch: [
            "metricool_queue_item_id,metricool_approval_url,operator_notes",
            "ef11cfd492f0,https://app.metricool.com/planner/batch-write-while-integrity-blocked,Scheduled manually in Metricool planner while integrity is blocked.",
          ].join("\n"),
        }),
      });
      assert.equal(batchWriteWhileBlockedResponse.status, 409);
      const batchWriteWhileBlocked = await batchWriteWhileBlockedResponse.json();
      assert.equal(batchWriteWhileBlocked.error, "evidence_integrity_blocked");
      assert.ok(batchWriteWhileBlocked.findingsCount >= 1);
      assert.doesNotMatch(JSON.stringify(batchWriteWhileBlocked), /test-proof|batch-write-while-integrity-blocked/);
      assert.doesNotMatch(await readFile(batchEvidenceCsvPath, "utf8"), /batch-write-while-integrity-blocked/);

      const homeResponse = await fetch(`http://127.0.0.1:${port}/clippers`);
      assert.equal(homeResponse.status, 200);
      const home = await homeResponse.text();
      assert.match(home, /Evidence integrity/);
      assert.match(home, /Goal gaps JSON/);
      assert.match(home, /Goal gaps MD/);
      assert.match(home, /test_or_fake_evidence_marker/);
      assert.doesNotMatch(home, /https:\/\/app\.metricool\.com\/planner\/test-proof/);
    });
  } finally {
    await writeFile(batchEvidenceCsvPath, originalEvidenceCsv);
  }
});

test("Clippers local operator evidence integrity allows valid master-only historical evidence", async () => {
  const port = "5524";
  const originalMasterEvidenceCsv = await readFile(masterEvidenceCsvPath, "utf8");
  try {
    const masterLines = originalMasterEvidenceCsv.split(/\r?\n/);
    const historicalIndex = masterLines.findIndex((line) => line.replace(/^\"/, "").startsWith("730134c744b2,"));
    assert.ok(historicalIndex > 0);
    masterLines[historicalIndex] = masterLines[historicalIndex].includes("\"\",\"\",\"\",\"\",\"\",\"\",\"\",\"\"")
      ? masterLines[historicalIndex].replace(
          "\"\",\"\",\"\",\"\",\"\",\"\",\"\",\"\"",
          "\"https://app.metricool.com/planner/historical-master-row\",\"\",\"scheduled\",\"\",\"\",\"\",\"\",\"Scheduled manually in Metricool planner for historical master row.\"",
        )
      : masterLines[historicalIndex].replace(
          /,{8}$/,
          ",https://app.metricool.com/planner/historical-master-row,,scheduled,,,,,Scheduled manually in Metricool planner for historical master row.",
        );
    await writeFile(masterEvidenceCsvPath, `${masterLines.filter(Boolean).join("\n")}\n`);

    await withServer({ HOST: "127.0.0.1", PORT: port }, async () => {
      const integrityResponse = await fetch(`http://127.0.0.1:${port}/api/clippers/evidence-integrity.json`);
      assert.equal(integrityResponse.status, 200);
      const integrity = await integrityResponse.json();
      assert.equal(integrity.status, "clean");
      assert.equal(integrity.findingsCount, 0);
      assert.equal(integrity.masterCurrentBatchRowsWithEvidence, 0);
      assert.doesNotMatch(JSON.stringify(integrity), /historical-master-row/);
    });
  } finally {
    await writeFile(masterEvidenceCsvPath, originalMasterEvidenceCsv);
  }
});

test("Clippers local operator keeps evidence response successful when audit log append fails", async () => {
  const port = "5520";
  const originalEvidenceCsv = await readFile(batchEvidenceCsvPath, "utf8");
  try {
    await withServer({
      HOST: "127.0.0.1",
      PORT: port,
      CLIPPERS_OPERATOR_AUDIT_LOG_PATH: reportsDir,
    }, async () => {
      const response = await fetch(`http://127.0.0.1:${port}/api/clippers/evidence/scheduled`, {
        method: "POST",
        body: new URLSearchParams({
          csrfToken,
          metricoolQueueItemId: "7129d59b5f5e",
          metricoolApprovalUrl: "https://app.metricool.com/planner/audit-failure-proof",
          operatorNotes: "Scheduled manually in Metricool planner while audit append fails.",
        }),
      });
      assert.equal(response.status, 409);
      const result = await response.json();
      assert.equal(result.ok, false);
      assert.equal(result.error, "real_clip_intake_not_ready");
      assert.doesNotMatch(await readFile(batchEvidenceCsvPath, "utf8"), /audit-failure-proof/);
    });
  } finally {
    await writeFile(batchEvidenceCsvPath, originalEvidenceCsv);
  }
});

test("Clippers local operator summarizes only audit log tail when the audit log is large", async () => {
  const port = "5521";
  const originalAuditLog = await readFile(operatorAuditLogPath, "utf8").catch(() => "");
  const oldEntry = {
    ts: "2026-01-01T00:00:00.000Z",
    action: "scheduled_single",
    result: { ok: true, statusCode: 200, metricoolQueueItemId: "old-row" },
    input: {
      metricoolQueueItemId: "old-row",
      metricoolApprovalUrl: { host: "app.metricool.com", pathHash: "oldhash", queryPresent: false },
      operatorNotesHash: "oldnotes",
    },
  };
  const latestEntry = {
    ts: "2026-01-02T00:00:00.000Z",
    action: "published_single",
    result: { ok: false, statusCode: 409, error: "duplicate_published_post_url", metricoolQueueItemId: "latest-row" },
    input: {
      metricoolQueueItemId: "latest-row",
      publishedPostUrl: { host: "www.tiktok.com", pathHash: "latesthash", queryPresent: false },
      operatorNotesHash: "latestnotes",
    },
  };
  try {
    await writeFile(operatorAuditLogPath, [
      JSON.stringify(oldEntry),
      "x".repeat(1000),
      JSON.stringify(latestEntry),
    ].join("\n") + "\n");
    await withServer({
      HOST: "127.0.0.1",
      PORT: port,
      CLIPPERS_OPERATOR_AUDIT_TAIL_BYTES: "400",
    }, async () => {
      const response = await fetch(`http://127.0.0.1:${port}/api/clippers/status`);
      assert.equal(response.status, 200);
      const status = await response.json();
      assert.equal(status.operatorAudit.truncated, true);
      assert.equal(status.operatorAudit.bytes > 400, true);
      assert.equal(status.operatorAudit.lastEvent.metricoolQueueItemId, "latest-row");
      assert.equal(status.operatorAudit.lastEvent.error, "duplicate_published_post_url");
      assert.equal(status.operatorAudit.invalidLines > 0, true);
      assert.doesNotMatch(JSON.stringify(status.operatorAudit), /old-row/);

      const readyResponse = await fetch(`http://127.0.0.1:${port}/api/clippers/operator-ready.json`);
      assert.equal(readyResponse.status, 200);
      const ready = await readyResponse.json();
      assert.equal(ready.operatorAudit.truncated, true);
      assert.equal(ready.operatorAudit.lastEvent.metricoolQueueItemId, "latest-row");
    });
  } finally {
    if (originalAuditLog) {
      await writeFile(operatorAuditLogPath, originalAuditLog);
    } else {
      await rm(operatorAuditLogPath, { force: true });
    }
  }
});

test("Clippers Metricool run sheet reports partial scheduled-proof progress against the full batch", async () => {
  const port = "5561";
  const originalEvidenceCsv = await readFile(batchEvidenceCsvPath, "utf8");
  const lines = originalEvidenceCsv.trimEnd().split(/\r?\n/);
  const header = parseTestCsvLine(lines[0]);
  const firstRow = parseTestCsvLine(lines[1]);
  const queueId = firstRow[header.indexOf("metricool_queue_item_id")];
  firstRow[header.indexOf("metricool_approval_url")] = "https://app.metricool.com/planner/partial-proof-one";
  firstRow[header.indexOf("final_status")] = "scheduled";
  firstRow[header.indexOf("operator_notes")] = "Scheduled manually in Metricool planner for the first partial progress test row.";
  lines[1] = renderTestCsvLine(firstRow);
  await writeFile(batchEvidenceCsvPath, `${lines.join("\n")}\n`);

  await withServer({ HOST: "127.0.0.1", PORT: port }, async () => {
    const status = await (await fetch(`http://127.0.0.1:${port}/api/clippers/status`)).json();
    assert.equal(status.metricoolSchedulingRunSheet.totalRows, 10);
    assert.equal(status.metricoolSchedulingRunSheet.missingScheduledProof, 9);
    assert.equal(status.metricoolSchedulingRunSheet.scheduledProofRecorded, 1);
    assert.equal(status.metricoolSchedulingRunSheet.rows.length, 9);
    assert.equal(status.metricoolSchedulingRunSheet.rows.some((row) => row.queueItemId === queueId), false);
    assert.ok(status.goalReadinessAudit.blockers.includes("missing_metricool_scheduled_proof_9"));
    assert.equal(status.realPublishEnabled, false);
  });
});

test("Clippers goal readiness rejects stale published CSV evidence with zero views", async () => {
  const port = "5562";
  const originalEvidenceCsv = await readFile(batchEvidenceCsvPath, "utf8");
  const lines = originalEvidenceCsv.trimEnd().split(/\r?\n/);
  const header = parseTestCsvLine(lines[0]);
  const firstRow = parseTestCsvLine(lines[1]);
  const queueId = firstRow[header.indexOf("metricool_queue_item_id")];
  const set = (field, value) => {
    firstRow[header.indexOf(field)] = value;
  };
  set("metricool_approval_url", "https://app.metricool.com/planner/stale-zero-views-proof");
  set("published_post_url", "https://www.tiktok.com/@streamercuts/video/7461234567890123456");
  set("final_status", "published");
  set("views_24h", "0");
  set("likes_24h", "1");
  set("comments_24h", "0");
  set("shares_24h", "0");
  set("operator_notes", "Captured exact public TikTok metrics after the required twenty four hour measurement window.");
  lines[1] = renderTestCsvLine(firstRow);
  await writeFile(batchEvidenceCsvPath, `${lines.join("\n")}\n`);

  await withServer({ HOST: "127.0.0.1", PORT: port }, async () => {
    const status = await (await fetch(`http://127.0.0.1:${port}/api/clippers/status`)).json();
    const row = status.rows.find((candidate) => candidate.queueItemId === queueId);
    assert.equal(row.hasValidPublishedMetricsEvidence, false);
    assert.equal(row.hasValid24hMetrics, false);
    assert.equal(status.evidenceIntegrity.status, "blocked");
    assert.ok(status.evidenceIntegrity.findings.some((finding) => finding.code === "published_status_without_complete_public_proof"));
    assert.ok(status.goalReadinessAudit.blockers.includes("evidence_integrity_not_clean"));
    assert.ok(status.goalReadinessAudit.blockers.includes("public_tiktok_urls_or_24h_metrics_not_ready"));
    assert.equal(status.goalReadinessAudit.complete, false);
  });
});

test("Clippers local operator ignores stale checklist readiness without real Metricool evidence", async () => {
  const port = "5514";
  const originalEvidenceChecklistJson = await readFile(evidenceChecklistJsonPath, "utf8");
  const originalEvidenceCsv = await readFile(batchEvidenceCsvPath, "utf8");
  const checklist = JSON.parse(originalEvidenceChecklistJson);
  checklist.totals = {
    ...(checklist.totals || {}),
    missingApproval: 0,
    missingPublicUrl: checklist.totals?.rows || 10,
    missingMetrics: checklist.totals?.rows || 10,
    readyForImportPreview: 0,
    invalidEvidence: 0,
  };
  checklist.rows = (checklist.rows || []).map((row) => ({
    ...row,
    state: "ready_to_import",
    blocker: "",
    missingFields: [],
    nextAction: "Scheduled proof complete for test.",
  }));
  try {
    await writeFile(evidenceChecklistJsonPath, JSON.stringify(checklist, null, 2));
    await withServer({ HOST: "127.0.0.1", PORT: port }, async () => {
      const response = await fetch(`http://127.0.0.1:${port}/api/clippers/status`);
      assert.equal(response.status, 200);
      const status = await response.json();
      assert.equal(status.metricoolSchedulingRunSheet.status, "blocked_real_clip_intake");
      assert.equal(status.metricoolSchedulingRunSheet.totalRows, 10);
      assert.equal(status.metricoolSchedulingRunSheet.missingScheduledProof, 10);
      assert.equal(status.metricoolSchedulingRunSheet.nextRow.queueItemId, "7129d59b5f5e");
      assert.equal(status.operatorSummary.nextQueueItemId, "7129d59b5f5e");
      assert.equal(status.operatorSummary.deadlineQueueItemId, "7129d59b5f5e");
      assert.equal(status.operatorSummary.nextQueueItemId, status.metricoolSchedulingRunSheet.nextRow.queueItemId);
      assert.equal(status.operatorSummary.deadlineQueueItemId, status.metricoolSchedulingRunSheet.nextRow.queueItemId);

      const scheduledBatch = [
        "metricool_queue_item_id,metricool_approval_url,operator_notes",
        ...status.metricoolSchedulingRunSheet.rows.map((row, index) => [
          row.queueItemId,
          `https://app.metricool.com/planner/complete-proof-${index + 1}`,
          `Scheduled manually in Metricool planner for complete proof row ${index + 1}.`,
        ].join(",")),
      ].join("\n");
      const importResponse = await fetch(`http://127.0.0.1:${port}/api/clippers/evidence/scheduled-batch`, {
        method: "POST",
        body: new URLSearchParams({ csrfToken, scheduledEvidenceBatch: scheduledBatch }),
      });
      assert.equal(importResponse.status, 409);
      const importResult = await importResponse.json();
      assert.equal(importResult.error, "real_clip_intake_not_ready");

      const completeResponse = await fetch(`http://127.0.0.1:${port}/api/clippers/status`);
      assert.equal(completeResponse.status, 200);
      const completeStatus = await completeResponse.json();
      assert.equal(completeStatus.metricoolSchedulingRunSheet.status, "blocked_real_clip_intake");
      assert.equal(completeStatus.metricoolSchedulingRunSheet.totalRows, 10);
      assert.equal(completeStatus.metricoolSchedulingRunSheet.missingScheduledProof, 10);
      assert.equal(completeStatus.metricoolSchedulingRunSheet.nextRow.queueItemId, "7129d59b5f5e");
      assert.equal(completeStatus.operatorSummary.nextQueueItemId, "7129d59b5f5e");
      assert.equal(completeStatus.operatorSummary.deadlineQueueItemId, "7129d59b5f5e");
      assert.equal(
        completeStatus.nextScheduledProofCsvStarter.trim(),
        "metricool_queue_item_id,metricool_approval_url,operator_notes",
      );
      const completeReadyResponse = await fetch(`http://127.0.0.1:${port}/api/clippers/operator-ready.json`);
      assert.equal(completeReadyResponse.status, 200);
      const completeReady = await completeReadyResponse.json();
      assert.equal(completeReady.nextMetricoolRow, null);
      assert.deepEqual(completeReady.metricoolDeadlineQueue, []);
      assert.equal(completeReady.scheduleWindow.deadlineQueueItemId, "");
      assert.equal(completeReady.deadlineReadiness.nextQueueItemId, "");
      assert.doesNotMatch(JSON.stringify(completeReady), /complete-proof|app\.metricool\.com\/planner|metricool_approval_url|published_post_url/);

      const completeGoalGapsResponse = await fetch(`http://127.0.0.1:${port}/api/clippers/goal-gaps.json`);
      assert.equal(completeGoalGapsResponse.status, 200);
      const completeGoalGaps = await completeGoalGapsResponse.json();
      assert.equal(completeGoalGaps.status, "not_complete");
      assert.equal(completeGoalGaps.complete, false);
      assert.ok(completeGoalGaps.blockers.includes("missing_metricool_scheduled_proof_10"));
      assert.ok(completeGoalGaps.blockers.includes("public_tiktok_urls_or_24h_metrics_not_ready"));
      assert.equal(completeGoalGaps.missingExternalProof.find((row) => row.id === "metricool_scheduled_proof").status, "blocked");
      assert.equal(completeGoalGaps.missingExternalProof.find((row) => row.id === "public_tiktok_metrics").status, "blocked");
      assert.doesNotMatch(JSON.stringify(completeGoalGaps), /complete-proof|app\.metricool\.com\/planner|metricool_approval_url|published_post_url/);

      const completeActionJsonResponse = await fetch(`http://127.0.0.1:${port}/api/clippers/next-metricool-action.json`);
      assert.equal(completeActionJsonResponse.status, 200);
      const completeActionJson = await completeActionJsonResponse.json();
      assert.equal(completeActionJson.scheduleReady, false);
      assert.equal(completeActionJson.row, null);
      assert.equal(completeActionJson.queueItemId, "");
      assert.equal(completeActionJson.brand, "");
      assert.equal(completeActionJson.accountName, "");
      assert.equal(completeActionJson.platform, "");
      assert.equal(completeActionJson.uploadFileName, "");
      assert.equal(completeActionJson.realPublishEnabled, false);
      assert.equal(completeActionJson.metricoolApprovalRequired, true);

      const homeResponse = await fetch(`http://127.0.0.1:${port}/clippers`);
      assert.equal(homeResponse.status, 200);
      const home = await homeResponse.text();
      assert.match(home, /Haz esto ahora/);
      assert.match(home, /Reemplaza los videos de prueba por clips reales/);
      assert.doesNotMatch(home, /Save scheduled proof for next row/);
    });
  } finally {
    await writeFile(evidenceChecklistJsonPath, originalEvidenceChecklistJson);
    await writeFile(batchEvidenceCsvPath, originalEvidenceCsv);
  }
});

test("Clippers local operator unlocks published metrics UI after scheduled proof", async () => {
  const port = "5515";
  const originalEvidenceChecklistJson = await readFile(evidenceChecklistJsonPath, "utf8");
  const originalEvidenceCsv = await readFile(batchEvidenceCsvPath, "utf8");
  const checklist = JSON.parse(originalEvidenceChecklistJson);
  checklist.rows = (checklist.rows || []).map((row, index) => index === 0
    ? {
      ...row,
      state: "scheduled",
      blocker: "waiting_public_tiktok_metrics",
      missingFields: ["published_post_url", "views_24h"],
      nextAction: "Wait until the TikTok post is live and record real 24h metrics.",
    }
    : row);
  try {
    await writeFile(evidenceChecklistJsonPath, JSON.stringify(checklist, null, 2));
    await withServer({ HOST: "127.0.0.1", PORT: port }, async () => {
      const falseUnlockStatusResponse = await fetch(`http://127.0.0.1:${port}/api/clippers/status`);
      assert.equal(falseUnlockStatusResponse.status, 200);
      const falseUnlockStatus = await falseUnlockStatusResponse.json();
      assert.equal(falseUnlockStatus.publicMetricsRunSheet.status, "locked_until_metricool_scheduled_proof");
      assert.equal(falseUnlockStatus.publicMetricsRunSheet.eligibleRows, 0);

      const evidenceLines = originalEvidenceCsv.split(/\r?\n/);
      evidenceLines[1] = evidenceLines[1].replace(
        ",,,,,,,,",
        ",https://app.metricool.com/planner/public-metrics-proof,,scheduled,,,,,Scheduled manually in Metricool planner for public metrics row one.",
      );
      await writeFile(batchEvidenceCsvPath, `${evidenceLines.filter(Boolean).join("\n")}\n`);

      const statusResponse = await fetch(`http://127.0.0.1:${port}/api/clippers/status`);
      assert.equal(statusResponse.status, 200);
      const status = await statusResponse.json();
      assert.equal(status.publicMetricsRunSheet.status, "needs_public_tiktok_metrics");
      assert.equal(status.publicMetricsRunSheet.eligibleRows, 1);
      assert.equal(status.publicMetricsRunSheet.pendingRows, 1);
      assert.equal(status.publicMetricsRunSheet.nextQueueItemId, "53467d8f7dad");
      assert.ok(status.publicMetricsRunSheet.nextRow.evidenceMissingFields.includes("published_post_url"));

      const publishedMetricsStarterResponse = await fetch(`http://127.0.0.1:${port}/api/clippers/published-metrics-starter.csv`);
      assert.equal(publishedMetricsStarterResponse.status, 200);
      const publishedMetricsStarterCsv = await publishedMetricsStarterResponse.text();
      assert.match(publishedMetricsStarterCsv, /53467d8f7dad/);
      assert.match(publishedMetricsStarterCsv, /<paste exact public TikTok video URL after the post is live>/);
      assert.match(publishedMetricsStarterCsv, /Metrics captured after memes TikTok row 1 was public for 24h\./);

      const nextPublishedMetricsStarterResponse = await fetch(`http://127.0.0.1:${port}/api/clippers/next-published-metrics-starter.csv`);
      assert.equal(nextPublishedMetricsStarterResponse.status, 200);
      const nextPublishedMetricsStarterCsv = await nextPublishedMetricsStarterResponse.text();
      assert.match(nextPublishedMetricsStarterCsv, /53467d8f7dad/);
      assert.doesNotMatch(nextPublishedMetricsStarterCsv, /7129d59b5f5e/);
      assert.match(nextPublishedMetricsStarterCsv, /<paste exact public TikTok video URL after this exact post is live>/);
      assert.equal(nextPublishedMetricsStarterCsv.trim().split("\n").length, 2);

      const publishedSinglePreviewResponse = await fetch(`http://127.0.0.1:${port}/api/clippers/evidence/published-preview`, {
        method: "POST",
        body: new URLSearchParams({
          csrfToken,
          metricoolQueueItemId: "53467d8f7dad",
          publishedPostUrl: "https://www.tiktok.com/@meme/video/3234567890123456789",
          views24h: "120",
          likes24h: "10",
          comments24h: "2",
          shares24h: "1",
          operatorNotes: "Real published metrics captured after TikTok was live for 24h.",
        }),
      });
      assert.equal(publishedSinglePreviewResponse.status, 200);
      const publishedSinglePreview = await publishedSinglePreviewResponse.json();
      assert.equal(publishedSinglePreview.preview, true);
      assert.equal(publishedSinglePreview.writes, false);
      assert.equal(publishedSinglePreview.wouldImport, 1);
      assert.equal(publishedSinglePreview.rows[0].metricoolQueueItemId, "53467d8f7dad");
      assert.equal(publishedSinglePreview.rows[0].brand, "memes");
      assert.equal(publishedSinglePreview.rows[0].accountName, "Streamer Reactions");
      assert.doesNotMatch(JSON.stringify(publishedSinglePreview), /3234567890123456789/);
      assert.doesNotMatch(await readFile(batchEvidenceCsvPath, "utf8"), /3234567890123456789/);

      const publicMetricsNowResponse = await fetch(`http://127.0.0.1:${port}/api/clippers/tiktok-public-metrics-now.html`);
      assert.equal(publicMetricsNowResponse.status, 200);
      assert.match(publicMetricsNowResponse.headers.get("content-type") || "", /text\/html/);
      const publicMetricsNowHtml = await publicMetricsNowResponse.text();
      assert.match(publicMetricsNowHtml, /Clippers TikTok Public Metrics Now/);
      assert.match(publicMetricsNowHtml, /Next public metrics row/);
      assert.match(publicMetricsNowHtml, /53467d8f7dad/);
      assert.match(publicMetricsNowHtml, /Preview published metrics/);
      assert.doesNotMatch(publicMetricsNowHtml, /public-metrics-proof|3234567890123456789|app\.metricool\.com\/planner\/[A-Za-z0-9]|published_post_url|metricool_approval_url/);

      const publicMetricsPreviewResponse = await fetch(`http://127.0.0.1:${port}/api/clippers/evidence/published-preview`, {
        method: "POST",
        body: new URLSearchParams({
          csrfToken,
          returnTo: "/api/clippers/tiktok-public-metrics-now.html",
          metricoolQueueItemId: "53467d8f7dad",
          publishedPostUrl: "https://www.tiktok.com/@meme/video/4234567890123456789",
          views24h: "150",
          likes24h: "12",
          comments24h: "3",
          shares24h: "2",
          operatorNotes: "Real published metrics captured after TikTok was live for 24h.",
        }),
      });
      assert.equal(publicMetricsPreviewResponse.status, 200);
      assert.match(publicMetricsPreviewResponse.headers.get("content-type") || "", /text\/html/);
      const publicMetricsPreviewHtml = await publicMetricsPreviewResponse.text();
      assert.match(publicMetricsPreviewHtml, /Published Metrics Preview/);
      assert.match(publicMetricsPreviewHtml, /Confirm Save published metrics/);
      assert.match(publicMetricsPreviewHtml, /name="returnTo" value="\/api\/clippers\/tiktok-public-metrics-now\.html"/);
      assert.doesNotMatch(publicMetricsPreviewHtml, /4234567890123456789/);
      assert.doesNotMatch(await readFile(batchEvidenceCsvPath, "utf8"), /4234567890123456789/);
      const publicMetricsTokenMatch = publicMetricsPreviewHtml.match(/name="previewToken" value="([^"]+)"/);
      assert.ok(publicMetricsTokenMatch?.[1]);

      const publicMetricsConfirmResponse = await fetch(`http://127.0.0.1:${port}/api/clippers/evidence/confirm-preview`, {
        method: "POST",
        redirect: "manual",
        body: new URLSearchParams({
          csrfToken,
          returnTo: "/api/clippers/tiktok-public-metrics-now.html",
          previewType: "published",
          previewToken: publicMetricsTokenMatch[1],
        }),
      });
      assert.equal(publicMetricsConfirmResponse.status, 303);
      assert.equal(publicMetricsConfirmResponse.headers.get("location"), "/api/clippers/tiktok-public-metrics-now.html");
      assert.match(await readFile(batchEvidenceCsvPath, "utf8"), /4234567890123456789/);

      const publicMetricsAfterConfirmResponse = await fetch(`http://127.0.0.1:${port}/api/clippers/tiktok-public-metrics-now.html`);
      assert.equal(publicMetricsAfterConfirmResponse.status, 200);
      const publicMetricsAfterConfirmHtml = await publicMetricsAfterConfirmResponse.text();
      assert.doesNotMatch(publicMetricsAfterConfirmHtml, /4234567890123456789|public-metrics-proof|app\.metricool\.com\/planner\/[A-Za-z0-9]|published_post_url|metricool_approval_url/);

      const homeResponse = await fetch(`http://127.0.0.1:${port}/clippers`);
      assert.equal(homeResponse.status, 200);
      const home = await homeResponse.text();
      assert.match(home, /<summary>Save published metrics<\/summary>/);
      assert.match(home, /\/api\/clippers\/evidence\/published-preview/);
      assert.match(home, /Preview published metrics/);
      assert.doesNotMatch(home, /form method="post" action="\/api\/clippers\/evidence\/published"/);
      assert.match(home, /published_post_url, views_24h/);
      assert.match(home, /Next public metrics row/);
    });
  } finally {
    await writeFile(evidenceChecklistJsonPath, originalEvidenceChecklistJson);
    await writeFile(batchEvidenceCsvPath, originalEvidenceCsv);
  }
});

test("Clippers local operator confirms single-row HTML preview with one-time in-memory token", async () => {
  const port = "5516";
  const originalEvidenceCsv = await readFile(batchEvidenceCsvPath, "utf8");
  try {
    await withServer({ HOST: "127.0.0.1", PORT: port }, async () => {
      const previewResponse = await fetch(`http://127.0.0.1:${port}/api/clippers/evidence/scheduled-preview`, {
        method: "POST",
        body: new URLSearchParams({
          csrfToken,
          returnTo: "/clippers",
          metricoolQueueItemId: "7129d59b5f5e",
          metricoolApprovalUrl: "https://app.metricool.com/planner/confirmed-preview-row",
          operatorNotes: "Scheduled manually in Metricool planner for confirm preview row.",
        }),
      });
      assert.equal(previewResponse.status, 200);
      assert.match(previewResponse.headers.get("content-type") || "", /text\/html/);
      const previewHtml = await previewResponse.text();
      assert.match(previewHtml, /Scheduled Proof Preview/);
      assert.match(previewHtml, /Preview blocked/);
      assert.match(previewHtml, /real_clip_intake_not_ready/);
      assert.doesNotMatch(previewHtml, /confirmed-preview-row/);
      assert.doesNotMatch(await readFile(batchEvidenceCsvPath, "utf8"), /confirmed-preview-row/);
      const tokenMatch = previewHtml.match(/name="previewToken" value="([^"]+)"/);
      assert.equal(tokenMatch, null);
    });
  } finally {
    await writeFile(batchEvidenceCsvPath, originalEvidenceCsv);
  }
});

test("Clippers local operator confirms Metricool Now preview back to the focused next action page", async () => {
  const port = "5522";
  const originalEvidenceCsv = await readFile(batchEvidenceCsvPath, "utf8");
  try {
    await withServer({ HOST: "127.0.0.1", PORT: port }, async () => {
      const previewResponse = await fetch(`http://127.0.0.1:${port}/api/clippers/evidence/scheduled-preview`, {
        method: "POST",
        body: new URLSearchParams({
          csrfToken,
          returnTo: "/api/clippers/next-metricool-action.html",
          metricoolQueueItemId: "7129d59b5f5e",
          metricoolApprovalUrl: "https://app.metricool.com/planner/confirmed-now-row",
          operatorNotes: "Scheduled manually in Metricool planner from the focused now page.",
        }),
      });
      assert.equal(previewResponse.status, 200);
      assert.match(previewResponse.headers.get("content-type") || "", /text\/html/);
      const previewHtml = await previewResponse.text();
      assert.match(previewHtml, /Scheduled Proof Preview/);
      assert.match(previewHtml, /Preview blocked/);
      assert.match(previewHtml, /real_clip_intake_not_ready/);
      assert.match(previewHtml, /href="\/api\/clippers\/next-metricool-action\.html"/);
      assert.doesNotMatch(previewHtml, /confirmed-now-row/);
      const tokenMatch = previewHtml.match(/name="previewToken" value="([^"]+)"/);
      assert.equal(tokenMatch, null);

      const unsafeReturnPreviewResponse = await fetch(`http://127.0.0.1:${port}/api/clippers/evidence/scheduled-preview`, {
        method: "POST",
        body: new URLSearchParams({
          csrfToken,
          returnTo: "/clippers",
          metricoolQueueItemId: "7129d59b5f5e",
          metricoolApprovalUrl: "https://app.metricool.com/planner/return-target-row",
          operatorNotes: "Scheduled manually in Metricool planner with unsafe return target.",
        }),
      });
      assert.equal(unsafeReturnPreviewResponse.status, 200);
      const unsafeReturnPreviewHtml = await unsafeReturnPreviewResponse.text();
      assert.match(unsafeReturnPreviewHtml, /real_clip_intake_not_ready/);
      const unsafeTokenMatch = unsafeReturnPreviewHtml.match(/name="previewToken" value="([^"]+)"/);
      assert.equal(unsafeTokenMatch, null);
      assert.doesNotMatch(await readFile(batchEvidenceCsvPath, "utf8"), /return-target-row/);
    });
  } finally {
    await writeFile(batchEvidenceCsvPath, originalEvidenceCsv);
  }
});

test("Clippers local operator confirms batch schedule preview back to the batch page", async () => {
  const port = "5525";
  const originalEvidenceCsv = await readFile(batchEvidenceCsvPath, "utf8");
  try {
    await withServer({ HOST: "127.0.0.1", PORT: port }, async () => {
      const returnTo = "/api/clippers/tiktok-batch-schedule-now.html";
      const previewResponse = await fetch(`http://127.0.0.1:${port}/api/clippers/evidence/scheduled-preview`, {
        method: "POST",
        body: new URLSearchParams({
          csrfToken,
          returnTo,
          metricoolQueueItemId: "7129d59b5f5e",
          metricoolApprovalUrl: "https://app.metricool.com/planner/confirmed-batch-now-row",
          operatorNotes: "Scheduled manually in Metricool planner from the batch now page.",
        }),
      });
      assert.equal(previewResponse.status, 200);
      assert.match(previewResponse.headers.get("content-type") || "", /text\/html/);
      const previewHtml = await previewResponse.text();
      assert.match(previewHtml, /Scheduled Proof Preview/);
      assert.match(previewHtml, /Preview blocked/);
      assert.match(previewHtml, /real_clip_intake_not_ready/);
      assert.match(previewHtml, /href="\/api\/clippers\/tiktok-batch-schedule-now\.html"/);
      assert.doesNotMatch(previewHtml, /confirmed-batch-now-row/);
      assert.doesNotMatch(await readFile(batchEvidenceCsvPath, "utf8"), /confirmed-batch-now-row/);
      const tokenMatch = previewHtml.match(/name="previewToken" value="([^"]+)"/);
      assert.equal(tokenMatch, null);

      const batchNowAfterConfirmResponse = await fetch(`http://127.0.0.1:${port}${returnTo}`);
      assert.equal(batchNowAfterConfirmResponse.status, 200);
      const batchNowAfterConfirmHtml = await batchNowAfterConfirmResponse.text();
      assert.doesNotMatch(batchNowAfterConfirmHtml, /confirmed-batch-now-row/);
      assert.doesNotMatch(batchNowAfterConfirmHtml, /app\.metricool\.com\/planner\/[A-Za-z0-9]|published_post_url|metricool_approval_url/);
    });
  } finally {
    await writeFile(batchEvidenceCsvPath, originalEvidenceCsv);
  }
});

test("Clippers local operator confirms multi-row scheduled batch preview back to the batch page", async () => {
  const port = "5526";
  const originalEvidenceCsv = await readFile(batchEvidenceCsvPath, "utf8");
  try {
    await withServer({ HOST: "127.0.0.1", PORT: port }, async () => {
      const returnTo = "/api/clippers/tiktok-batch-schedule-now.html";
      const scheduledEvidenceBatch = [
        "metricool_queue_item_id,metricool_approval_url,operator_notes",
        "7129d59b5f5e,https://app.metricool.com/planner/confirmed-batch-row-one,Scheduled manually in Metricool planner from batch import row one.",
        "53467d8f7dad,https://app.metricool.com/planner/confirmed-batch-row-two,Scheduled manually in Metricool planner from batch import row two.",
      ].join("\n");
      const previewResponse = await fetch(`http://127.0.0.1:${port}/api/clippers/evidence/scheduled-batch-preview`, {
        method: "POST",
        body: new URLSearchParams({
          csrfToken,
          returnTo,
          scheduledEvidenceBatch,
        }),
      });
      assert.equal(previewResponse.status, 200);
      assert.match(previewResponse.headers.get("content-type") || "", /text\/html/);
      const previewHtml = await previewResponse.text();
      assert.match(previewHtml, /Scheduled Proof Batch Preview/);
      assert.match(previewHtml, /Preview blocked/);
      assert.match(previewHtml, /real_clip_intake_not_ready/);
      assert.match(previewHtml, /Would import: 0/);
      assert.match(previewHtml, /href="\/api\/clippers\/tiktok-batch-schedule-now\.html"/);
      assert.doesNotMatch(previewHtml, /confirmed-batch-row-one|confirmed-batch-row-two/);
      assert.doesNotMatch(await readFile(batchEvidenceCsvPath, "utf8"), /confirmed-batch-row-one|confirmed-batch-row-two/);
      const tokenMatch = previewHtml.match(/name="previewToken" value="([^"]+)"/);
      assert.equal(tokenMatch, null);
      const evidenceCsv = await readFile(batchEvidenceCsvPath, "utf8");
      assert.doesNotMatch(evidenceCsv, /confirmed-batch-row-one/);
      assert.doesNotMatch(evidenceCsv, /confirmed-batch-row-two/);
    });
  } finally {
    await writeFile(batchEvidenceCsvPath, originalEvidenceCsv);
  }
});

test("Clippers local operator confirms TikTok account Now preview back to the same account page", async () => {
  const port = "5524";
  const originalEvidenceCsv = await readFile(batchEvidenceCsvPath, "utf8");
  try {
    await withServer({ HOST: "127.0.0.1", PORT: port }, async () => {
      const returnTo = "/api/clippers/tiktok-account-now.html?accountId=sports-daily";
      const previewResponse = await fetch(`http://127.0.0.1:${port}/api/clippers/evidence/scheduled-preview`, {
        method: "POST",
        body: new URLSearchParams({
          csrfToken,
          returnTo,
          metricoolQueueItemId: "7129d59b5f5e",
          metricoolApprovalUrl: "https://app.metricool.com/planner/confirmed-account-now-row",
          operatorNotes: "Scheduled manually in Metricool planner from the account focused now page.",
        }),
      });
      assert.equal(previewResponse.status, 200);
      assert.match(previewResponse.headers.get("content-type") || "", /text\/html/);
      const previewHtml = await previewResponse.text();
      assert.match(previewHtml, /Scheduled Proof Preview/);
      assert.match(previewHtml, /Preview blocked/);
      assert.match(previewHtml, /real_clip_intake_not_ready/);
      assert.match(previewHtml, /href="\/api\/clippers\/tiktok-account-now\.html\?accountId=sports-daily"/);
      assert.doesNotMatch(previewHtml, /confirmed-account-now-row/);
      assert.doesNotMatch(await readFile(batchEvidenceCsvPath, "utf8"), /confirmed-account-now-row/);
      const tokenMatch = previewHtml.match(/name="previewToken" value="([^"]+)"/);
      assert.equal(tokenMatch, null);
    });
  } finally {
    await writeFile(batchEvidenceCsvPath, originalEvidenceCsv);
  }
});

test("Clippers local operator confirms single-row published metrics preview with one-time token", async () => {
  const port = "5518";
  const originalEvidenceCsv = await readFile(batchEvidenceCsvPath, "utf8");
  try {
    const evidenceLines = originalEvidenceCsv.split(/\r?\n/);
    evidenceLines[1] = evidenceLines[1].replace(
      ",,,,,,,,",
      ",https://app.metricool.com/planner/published-confirm-proof,,scheduled,,,,,Scheduled manually in Metricool planner before public metrics confirm.",
    );
    await writeFile(batchEvidenceCsvPath, `${evidenceLines.filter(Boolean).join("\n")}\n`);

    await withServer({ HOST: "127.0.0.1", PORT: port }, async () => {
      const previewResponse = await fetch(`http://127.0.0.1:${port}/api/clippers/evidence/published-preview`, {
        method: "POST",
        body: new URLSearchParams({
          csrfToken,
          returnTo: "/clippers",
          metricoolQueueItemId: "53467d8f7dad",
          publishedPostUrl: "https://www.tiktok.com/@meme/video/4234567890123456789",
          views24h: "240",
          likes24h: "12",
          comments24h: "3",
          shares24h: "2",
          operatorNotes: "Real published metrics captured after TikTok was live for 24h.",
        }),
      });
      assert.equal(previewResponse.status, 200);
      assert.match(previewResponse.headers.get("content-type") || "", /text\/html/);
      const previewHtml = await previewResponse.text();
      assert.match(previewHtml, /Published Metrics Preview/);
      assert.match(previewHtml, /Confirm Save published metrics/);
      assert.doesNotMatch(previewHtml, /4234567890123456789/);
      assert.doesNotMatch(await readFile(batchEvidenceCsvPath, "utf8"), /4234567890123456789/);
      const tokenMatch = previewHtml.match(/name="previewToken" value="([^"]+)"/);
      assert.ok(tokenMatch?.[1]);

      const confirmResponse = await fetch(`http://127.0.0.1:${port}/api/clippers/evidence/confirm-preview`, {
        method: "POST",
        redirect: "manual",
        body: new URLSearchParams({
          csrfToken,
          returnTo: "/clippers",
          previewType: "published",
          previewToken: tokenMatch[1],
        }),
      });
      assert.equal(confirmResponse.status, 303);
      assert.equal(confirmResponse.headers.get("location"), "/clippers");
      assert.match(await readFile(batchEvidenceCsvPath, "utf8"), /4234567890123456789/);
    });
  } finally {
    await writeFile(batchEvidenceCsvPath, originalEvidenceCsv);
  }
});

test("Clippers local operator expires preview confirmation tokens automatically", async () => {
  const port = "5517";
  const originalEvidenceCsv = await readFile(batchEvidenceCsvPath, "utf8");
  try {
    const evidenceLines = originalEvidenceCsv.split(/\r?\n/);
    evidenceLines[1] = evidenceLines[1].replace(
      ",,,,,,,,",
      ",https://app.metricool.com/planner/expired-published-proof,,scheduled,,,,,Scheduled manually in Metricool planner before expired preview.",
    );
    await writeFile(batchEvidenceCsvPath, `${evidenceLines.filter(Boolean).join("\n")}\n`);

    await withServer({ HOST: "127.0.0.1", PORT: port, CLIPPERS_PREVIEW_CONFIRM_TTL_MS: "25" }, async () => {
      const previewResponse = await fetch(`http://127.0.0.1:${port}/api/clippers/evidence/published-preview`, {
        method: "POST",
        body: new URLSearchParams({
          csrfToken,
          returnTo: "/clippers",
          metricoolQueueItemId: "53467d8f7dad",
          publishedPostUrl: "https://www.tiktok.com/@meme/video/1234567890123456789",
          views24h: "1234",
          likes24h: "120",
          comments24h: "12",
          shares24h: "8",
          operatorNotes: "Real published metrics captured after TikTok was live for 24h.",
        }),
      });
      assert.equal(previewResponse.status, 200);
      const previewHtml = await previewResponse.text();
      const tokenMatch = previewHtml.match(/name="previewToken" value="([^"]+)"/);
      assert.ok(tokenMatch?.[1]);
      await new Promise((resolve) => setTimeout(resolve, 80));

      const confirmResponse = await fetch(`http://127.0.0.1:${port}/api/clippers/evidence/confirm-preview`, {
        method: "POST",
        body: new URLSearchParams({
          csrfToken,
          previewType: "published",
          previewToken: tokenMatch[1],
        }),
      });
      assert.equal(confirmResponse.status, 410);
      const confirm = await confirmResponse.json();
      assert.equal(confirm.error, "preview_confirmation_expired_or_used");
      assert.doesNotMatch(await readFile(batchEvidenceCsvPath, "utf8"), /1234567890123456789/);
    });
  } finally {
    await writeFile(batchEvidenceCsvPath, originalEvidenceCsv);
  }
});

test("Clippers operator rebuilds Metricool upload prerequisites in dependency order", async () => {
  const source = await readFile(scriptPath, "utf8");
  const chainMatch = source.match(/const sourceDropMetricoolRefreshScriptPaths = \[([\s\S]*?)\n\];/);
  assert.ok(chainMatch, "source-drop Metricool refresh chain should be declared");

  const chain = chainMatch[1];
  const orderedScripts = [
    "script/clippers-metricool-operator-handoff.mjs",
    "script/clippers-tiktok-mvp-go-live-packet.mjs",
    "script/clippers-tiktok-launch-control.mjs",
    "script/clippers-goal-completion-audit.mjs",
    "script/clippers-tiktok-mvp-readiness-verifier.mjs",
    "script/clippers-metricool-mcp-preflight.ts",
    "script/clippers-metricool-current-batch-upload-pack.mjs",
  ];
  let previousIndex = -1;
  for (const relativeScriptPath of orderedScripts) {
    const currentIndex = chain.indexOf(relativeScriptPath);
    assert.ok(currentIndex > previousIndex, `${relativeScriptPath} should run after its prerequisites`);
    previousIndex = currentIndex;
    await stat(path.join(process.cwd(), relativeScriptPath));
  }

  assert.match(source, /scriptPath\.endsWith\("\.ts"\)[\s\S]*?\["--import", "tsx"\]/);

  const goLiveSource = await readFile(path.join(process.cwd(), "script/clippers-tiktok-mvp-go-live-packet.mjs"), "utf8");
  const handoffIndex = goLiveSource.indexOf('"script/clippers-metricool-operator-handoff.mjs"');
  const launchIndex = goLiveSource.indexOf('"script/clippers-tiktok-launch-control.mjs"');
  const auditIndex = goLiveSource.indexOf('"script/clippers-goal-completion-audit.mjs"');
  assert.ok(handoffIndex >= 0 && handoffIndex < launchIndex && launchIndex < auditIndex,
    "go-live prerequisites should refresh handoff, launch control, then goal audit");
});
