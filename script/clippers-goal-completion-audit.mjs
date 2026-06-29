import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const rootDir = path.join(process.cwd(), "clippers_workspace");
const scheduledDir = path.join(rootDir, "scheduled");
const reportsDir = path.join(rootDir, "reports");

const paths = {
  accountReadiness: path.join(rootDir, "account-permission-readiness.json"),
  metricoolMvpLaunchPack: path.join(scheduledDir, "metricool-mvp-launch-pack.json"),
  metricool100ApprovalRun: path.join(scheduledDir, "metricool-100-approval-run.json"),
  metricoolApprovalSession: path.join(scheduledDir, "metricool-approval-session.json"),
  tiktokLaunchControl: path.join(reportsDir, "clippers-tiktok-launch-control.json"),
  tiktokExternalCloseoutSession: path.join(reportsDir, "clippers-tiktok-external-closeout-session.json"),
  masterEvidenceCsv: path.join(rootDir, "evidence-drop", "metricool-100-approval-evidence-import.csv"),
  batchEvidenceDir: path.join(scheduledDir, "metricool-100-batch-evidence-imports"),
  outJson: path.join(reportsDir, "clippers-goal-completion-audit.json"),
  outMarkdown: path.join(reportsDir, "clippers-goal-completion-audit.md"),
  outCsv: path.join(reportsDir, "clippers-goal-completion-audit.csv"),
};

async function readJson(filePath, fallback = {}) {
  const raw = await readFile(filePath, "utf8").catch(() => null);
  if (!raw) return fallback;
  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function parseCsvLine(line) {
  const cells = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"' && quoted && line[index + 1] === '"') {
      cell += '"';
      index += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === "," && !quoted) {
      cells.push(cell);
      cell = "";
    } else {
      cell += char;
    }
  }
  cells.push(cell);
  return cells;
}

function parseCsv(raw) {
  const lines = raw.split(/\r?\n/).filter((line) => line.trim());
  const header = parseCsvLine(lines.shift() || "");
  return lines.map((line) => {
    const cells = parseCsvLine(line);
    return Object.fromEntries(header.map((key, index) => [key, cells[index] || ""]));
  });
}

function csvCell(value) {
  return `"${String(value ?? "").replace(/"/g, '""')}"`;
}

function isPlaceholder(value) {
  const text = String(value || "").trim();
  return !text || /^<.*>$/.test(text) || /\bpaste\b|\bplaceholder\b|\bafter live\b|\bafter 24h\b/i.test(text);
}

function numberValue(value) {
  const parsed = Number(String(value || "").replace(/,/g, "").trim());
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function isTikTokPostUrl(value) {
  const text = String(value || "").trim();
  if (!/^https:\/\//i.test(text)) return false;
  try {
    const parsed = new URL(text);
    if (parsed.protocol !== "https:") return false;
    const hostname = parsed.hostname.replace(/^www\./, "");
    if (!(hostname === "tiktok.com" || hostname.endsWith(".tiktok.com"))) return false;
    const pathname = parsed.pathname.replace(/\/+$/, "");
    return /^\/@[^/]+\/video\/\d+$/i.test(pathname);
  } catch {
    return false;
  }
}

function evidenceTotals(records) {
  return records.reduce((totals, row) => {
    totals.rows += 1;
    const finalStatus = String(row.final_status || "").trim().toLowerCase();
    const publishedPostUrl = String(row.published_post_url || "").trim();
    const metricsTotal = numberValue(row.views_24h) + numberValue(row.likes_24h) + numberValue(row.comments_24h) + numberValue(row.shares_24h);
    if (finalStatus === "published") totals.publishedRows += 1;
    if (finalStatus === "published" && isTikTokPostUrl(publishedPostUrl) && metricsTotal > 0) totals.importable += 1;
    if (!isPlaceholder(row.metricool_approval_url) || !isPlaceholder(publishedPostUrl) || !isPlaceholder(finalStatus) || metricsTotal > 0) totals.touched += 1;
    return totals;
  }, { rows: 0, touched: 0, publishedRows: 0, importable: 0 });
}

function requirement(id, label, status, evidence, nextAction) {
  return { id, label, status, evidence, nextAction };
}

function renderMarkdown(summary) {
  return [
    "# Clippers Goal Completion Audit",
    "",
    "TikTok + Metricool MVP audit. This report separates what is ready from what still needs real external proof.",
    "",
    `Status: ${summary.status}`,
    `Full goal status: ${summary.fullGoalStatus}`,
    `Generated: ${summary.generatedAt}`,
    `Next step: ${summary.nextStep}`,
    "",
    "## Truth Rules",
    "",
    `- Operating mode: ${summary.operatingMode.publisher} + ${summary.operatingMode.activePlatforms.join(", ")} only.`,
    `- Deferred platforms: ${summary.operatingMode.deferredPlatforms.join(", ") || "none"}.`,
    "- No marca publicaciones sin URL real de TikTok, final_status=published y metricas reales.",
    "- No cuenta Instagram/YouTube como parte del MVP activo.",
    "- No convierte placeholders de Metricool en evidencia real.",
    "- Mantiene Metricool en approval_required y realPublishEnabled=false.",
    "",
    "## Totals",
    "",
    `- Requirements: ${summary.totals.requirements}`,
    `- Ready: ${summary.totals.ready}`,
    `- TikTok MVP ready: ${summary.totals.tiktokMvpReady}`,
    `- Waiting Metricool work: ${summary.totals.waitingMetricoolWork}`,
    `- Needs external action: ${summary.totals.needsExternalAction}`,
    `- Deferred: ${summary.totals.deferred}`,
    `- External proof files needing evidence: ${summary.fullGoal.externalProofFilesNeedRealEvidence}`,
    `- TikTok external active closeout tasks: ${summary.fullGoal.tiktokExternalCloseoutTasks}`,
    `- TikTok external deferred backlog tasks: ${summary.fullGoal.tiktokExternalDeferredTasks}`,
    `- Full readiness missing: ${summary.fullGoal.fullReadinessMissing}`,
    "",
    "## Requirements",
    "",
    ...summary.requirements.map((row) => [
      `### ${row.label}`,
      `- Status: ${row.status}`,
      `- Evidence: ${row.evidence}`,
      `- Next: ${row.nextAction}`,
      "",
    ].join("\n")),
  ].join("\n");
}

function renderCsv(summary) {
  const header = ["requirement_id", "label", "status", "evidence", "next_action"];
  return [
    header.map(csvCell).join(","),
    ...summary.requirements.map((row) => [
      row.id,
      row.label,
      row.status,
      row.evidence,
      row.nextAction,
    ].map(csvCell).join(",")),
  ].join("\n") + "\n";
}

async function main() {
  await mkdir(reportsDir, { recursive: true });
  const [accountReadiness, mvpLaunchPack, approvalRun, approvalSession, launchControl, tiktokExternalCloseoutSession, evidenceRaw] = await Promise.all([
    readJson(paths.accountReadiness),
    readJson(paths.metricoolMvpLaunchPack),
    readJson(paths.metricool100ApprovalRun),
    readJson(paths.metricoolApprovalSession),
    readJson(paths.tiktokLaunchControl),
    readJson(paths.tiktokExternalCloseoutSession, {}),
    readFile(paths.masterEvidenceCsv, "utf8").catch(() => ""),
  ]);
  const evidence = evidenceTotals(parseCsv(evidenceRaw));
  const activeMvp = accountReadiness.activeMvp || {};
  const activeMvpReady = activeMvp.status === "ready"
    && Number(activeMvp.readyLanes || 0) >= 2
    && Array.isArray(activeMvp.platforms)
    && activeMvp.platforms.length === 1
    && activeMvp.platforms[0] === "tiktok";
  const approvalOnlyQueueReady = approvalRun.status === "ready_for_operator"
    && Number(approvalRun.totals?.metricoolQueuedForApproval || 0) >= 100
    && Number(approvalRun.totals?.readyToSend || 0) === 0
    && approvalRun.realPublishEnabled === false;
  const launchControlReady = launchControl.status === "ready_for_metricool_review"
    && Number(launchControl.totals?.tiktok || 0) === 100
    && Number(launchControl.totals?.instagram || 0) === 0
    && Number(launchControl.totals?.youtube || 0) === 0
    && Number(launchControl.totals?.readyToImport || 0) === 0;
  const strictTikTokSession = Number(approvalSession.totals?.tiktok || 0) === 100
    && Number(approvalSession.totals?.instagram || 0) === 0
    && Number(approvalSession.totals?.youtube || 0) === 0;
  const currentBatch = launchControl.currentBatch || {};
  const currentBatchId = currentBatch.id || "metricool-batch-01";
  const currentBatchEvidenceCsv = path.join(paths.batchEvidenceDir, `${currentBatchId}-evidence-import.csv`);
  const currentBatchReady = launchControlReady && currentBatch.id === "metricool-batch-01" && Number(currentBatch.rows || 0) === 10;
  const approvalRunRealPublishEnabled = approvalRun.realPublishEnabled === true;
  const approvalRunPublishMode = approvalRunRealPublishEnabled || Number(approvalRun.totals?.readyToSend || 0) > 0
    ? "unsafe_or_direct"
    : "approval_required";
  const expectedPublishedRows = Math.max(100, Number(launchControl.totals?.rows || 0));
  const allPublishedEvidenceReady = evidence.importable >= expectedPublishedRows && evidence.publishedRows >= expectedPublishedRows;
  const accountProfiles = Number(accountReadiness.totals?.accountProfiles || 0);
  const verifiedAccounts = Number(accountReadiness.totals?.verifiedAccounts || 0);
  const allAccountsVerified = accountProfiles > 0 && verifiedAccounts >= accountProfiles;
  const developerApps = Number(accountReadiness.totals?.developerApps || 0);
  const developerAppsApproved = Number(accountReadiness.totals?.developerAppsApproved || 0);
  const permissionGroups = Number(accountReadiness.totals?.permissionGroups || 0);
  const permissionGroupsApproved = Number(accountReadiness.totals?.permissionGroupsApproved || 0);
  const directApiReadyLanes = Number(accountReadiness.totals?.directApiReadyLanes || 0);
  const allDirectApiPermissionsReady = directApiReadyLanes >= 9
    && developerApps > 0
    && developerAppsApproved >= developerApps
    && permissionGroups > 0
    && permissionGroupsApproved >= permissionGroups;
  const rightsReadyAssets = Number(accountReadiness.sourceReadiness?.connectedMetricoolRightsReadyAssets || 0);
  const externalProofRows = Number(accountReadiness.externalCloseout?.proofFilesNeedRealEvidence || accountReadiness.totals?.externalProofsNeedEvidence || 0);
  const tiktokExternalCloseoutTasks = Number(tiktokExternalCloseoutSession.totals?.activeTasks ?? tiktokExternalCloseoutSession.totals?.tiktokTasks ?? 0);
  const tiktokExternalDeferredTasks = Number(tiktokExternalCloseoutSession.totals?.deferredTasks || 0);
  const tiktokExternalCloseoutComplete = tiktokExternalCloseoutSession.status === "complete"
    || tiktokExternalCloseoutSession.status === "metricool_mvp_ready_deferred_backlog"
    || tiktokExternalCloseoutTasks === 0;
  const fullMissing = Number(accountReadiness.fullReadinessGap?.missing || accountReadiness.totals?.fullReadinessMissing || 0);
  const fullReadinessTracked = Number(accountReadiness.fullReadinessGap?.total || 0) > 0;
  const externalProofFilesReady = fullReadinessTracked && externalProofRows === 0 && fullMissing === 0;
  const pendingProfiles = Number(accountReadiness.metricoolMvpEvidence?.pendingProfileRows || mvpLaunchPack.totals?.pendingMetricoolProfiles || 0);

  const requirements = [
    requirement(
      "tiktok_metricool_mvp_ready",
      "TikTok Metricool MVP ready",
      activeMvpReady && approvalOnlyQueueReady && strictTikTokSession ? "ready" : "needs_external_action",
      `activeMvp ${activeMvp.readyLanes || 0}/${activeMvp.targetLanes || 0}; queued ${approvalRun.totals?.metricoolQueuedForApproval || 0}; readyToSend ${approvalRun.totals?.readyToSend || 0}; platforms tiktok=${approvalSession.totals?.tiktok || 0}, instagram=${approvalSession.totals?.instagram || 0}, youtube=${approvalSession.totals?.youtube || 0}`,
      activeMvpReady ? "Use Metricool approval workflow only." : "Confirm SPORT and memes TikTok lanes in Metricool.",
    ),
    requirement(
      "tiktok_batch_01_ready_for_metricool",
      "Batch 01 ready for Metricool operator",
      launchControlReady && currentBatch.id === "metricool-batch-01" && Number(currentBatch.rows || 0) === 10 ? "ready" : "waiting_metricool_work",
      `launchControl ${launchControl.status || "missing"}; currentBatch ${currentBatch.id || "missing"} rows ${currentBatch.rows || 0}; accounts ${(currentBatch.accounts || []).join("+") || "none"}`,
      "Open the current batch workbook and process it inside Metricool.",
    ),
    requirement(
      "published_urls_and_metrics",
      "Published URLs and 24h metrics",
      allPublishedEvidenceReady ? "ready" : "waiting_metricool_work",
      `evidence rows ${evidence.rows}; touched ${evidence.touched}; publishedRows ${evidence.publishedRows}/${expectedPublishedRows}; importable ${evidence.importable}/${expectedPublishedRows}; launchControl readyToImport ${launchControl.totals?.readyToImport || 0}`,
      "Do not import evidence until real public TikTok URLs and 24h metrics exist.",
    ),
    requirement(
      "all_accounts_created_verified",
      "All accounts created and verified",
      allAccountsVerified ? "ready" : "needs_external_action",
      `verifiedAccounts ${verifiedAccounts}/${accountProfiles}`,
      "For the MVP, continue with SPORT and memes TikTok; verify the remaining profiles later.",
    ),
    requirement(
      "all_permissions_added",
      "All direct API permissions added",
      allDirectApiPermissionsReady ? "ready" : "deferred",
      `directApiReadyLanes ${directApiReadyLanes}/9; developerApps ${developerAppsApproved}/${developerApps}; permissionGroups ${permissionGroupsApproved}/${permissionGroups}`,
      "Direct social APIs are backlog while Metricool TikTok MVP is active.",
    ),
    requirement(
      "rights_source_ready",
      "Rights/source supply for TikTok MVP",
      rightsReadyAssets >= 100 ? "ready_for_tiktok_mvp" : "needs_external_action",
      `connectedMetricoolRightsReadyAssets ${rightsReadyAssets}; localOwnedSourceAssets ${accountReadiness.sourceReadiness?.localOwnedSourceAssets || 0}; mvp rightsReadyAssets ${mvpLaunchPack.totals?.rightsReadyAssets || 0}`,
      rightsReadyAssets >= 100 ? "Use only approved/source-ready assets for the approval queue." : "Add rights/source-ready assets before scheduling more rows.",
    ),
    requirement(
      "ig_youtube_expansion",
      "Instagram and YouTube expansion",
      "deferred",
      `pendingProfileRows ${pendingProfiles}; active MVP platform tiktok only`,
      "Connect IG/YT later after TikTok process is stable.",
    ),
    requirement(
      "no_false_publish",
      "No false publish state",
      approvalRun.realPublishEnabled === false && Number(approvalRun.totals?.readyToSend || 0) === 0 && Number(launchControl.totals?.readyToImport || 0) === 0 ? "ready" : "needs_external_action",
      `realPublishEnabled ${approvalRun.realPublishEnabled}; readyToSend ${approvalRun.totals?.readyToSend || 0}; readyToImport ${launchControl.totals?.readyToImport || 0}`,
      "Keep approval_required mode until Robert explicitly enables real publishing.",
    ),
    requirement(
      "external_proof_files",
      "External proof files",
      externalProofFilesReady ? "ready" : "needs_external_action",
      `externalProofsNeedEvidence ${externalProofRows}; fullReadinessMissing ${fullMissing}; readinessTracked ${fullReadinessTracked}`,
      "Add real non-secret evidence files for external account/security proof when expanding beyond the TikTok MVP.",
    ),
    requirement(
      "tiktok_external_closeout_session",
      "TikTok external account/app/permission closeout",
      tiktokExternalCloseoutComplete ? "ready_for_tiktok_mvp" : "needs_external_action",
      `status ${tiktokExternalCloseoutSession.status || "missing"}; activeTasks ${tiktokExternalCloseoutTasks}; deferredTasks ${tiktokExternalDeferredTasks}; account ${tiktokExternalCloseoutSession.totals?.account || 0}; developerApp ${tiktokExternalCloseoutSession.totals?.developerApp || 0}; permission ${tiktokExternalCloseoutSession.totals?.permission || 0}`,
      tiktokExternalCloseoutComplete
        ? "TikTok Metricool MVP has no active external closeout blockers; direct API/account expansion stays deferred."
        : (tiktokExternalCloseoutSession.nextStep || "Prepare the TikTok external closeout session and complete the first real portal action."),
    ),
    requirement(
      "metricool_operator_evidence_import",
      "Metricool operator evidence import",
      allPublishedEvidenceReady ? "ready" : "waiting_metricool_work",
      `importable ${evidence.importable}/${expectedPublishedRows}; publishedRows ${evidence.publishedRows}/${expectedPublishedRows}; current batch evidence CSV ${currentBatchEvidenceCsv}; master sync target ${paths.masterEvidenceCsv}`,
      "After Metricool work, fill only the current batch evidence CSV; sync will update the master evidence CSV.",
    ),
  ];

  const totals = requirements.reduce((sum, row) => {
    sum.requirements += 1;
    if (row.status === "ready") sum.ready += 1;
    if (row.status === "ready_for_tiktok_mvp") sum.tiktokMvpReady += 1;
    if (row.status === "waiting_metricool_work") sum.waitingMetricoolWork += 1;
    if (row.status === "needs_external_action") sum.needsExternalAction += 1;
    if (row.status === "deferred") sum.deferred += 1;
    return sum;
  }, { requirements: 0, ready: 0, tiktokMvpReady: 0, waitingMetricoolWork: 0, needsExternalAction: 0, deferred: 0 });
  const status = activeMvpReady && approvalOnlyQueueReady && strictTikTokSession && currentBatchReady
    ? "tiktok_mvp_ready_external_work_remaining"
    : "not_ready";
  const fullGoalStatus = status === "tiktok_mvp_ready_external_work_remaining"
    && totals.waitingMetricoolWork === 0
    && totals.needsExternalAction === 0
    && externalProofFilesReady
    ? "ready"
    : "blocked_external_actions";
  const summary = {
    status,
    fullGoalStatus,
    generatedAt: new Date().toISOString(),
    paths,
    currentBatchEvidenceCsv,
    operatingMode: {
      publisher: "metricool",
      activePlatforms: ["tiktok"],
      activeAccountIds: ["sports-daily", "meme-radar"],
      activeMetricoolBrands: ["SPORT", "memes"],
      deferredPlatforms: ["instagram", "youtube", "twitch"],
      directSocialApisRequired: false,
      realPublishEnabled: approvalRunRealPublishEnabled,
      publishMode: approvalRunPublishMode,
      note: approvalRunPublishMode === "approval_required"
        ? "Solo TikTok por Metricool esta activo ahora; otras redes y APIs directas quedan para expansion posterior."
        : "Alerta: el artifact de Metricool no esta en modo approval_required seguro; no operar hasta corregirlo.",
    },
    fullGoal: {
      metricoolMvpReady: status === "tiktok_mvp_ready_external_work_remaining",
      externalProofFilesNeedRealEvidence: externalProofRows,
      tiktokExternalCloseoutTasks,
      tiktokExternalDeferredTasks,
      fullReadinessMissing: fullMissing,
      allAccountsVerified,
      allDirectApiPermissionsReady,
      allPublishedEvidenceReady,
    },
    requirements,
    totals,
    nextStep: status === "tiktok_mvp_ready_external_work_remaining"
      ? `Process ${currentBatch.id || "metricool-batch-01"} in Metricool; do not import evidence until real TikTok URLs and 24h metrics exist.`
      : "Fix the blocked TikTok MVP evidence before operating Metricool.",
    guardrails: [
      "Only TikTok SPORT and memes are active in this MVP.",
      "Metricool remains approval_required with realPublishEnabled=false.",
      "No published count without public TikTok URL and metrics.",
      "Instagram, YouTube, streamer accounts, direct APIs, and remaining proofs are deferred or external.",
    ],
  };
  await writeFile(paths.outJson, JSON.stringify(summary, null, 2));
  await writeFile(paths.outMarkdown, renderMarkdown(summary));
  await writeFile(paths.outCsv, renderCsv(summary));
  console.log(JSON.stringify({
    status: summary.status,
    requirements: totals.requirements,
    ready: totals.ready,
    tiktokMvpReady: totals.tiktokMvpReady,
    waitingMetricoolWork: totals.waitingMetricoolWork,
    needsExternalAction: totals.needsExternalAction,
    deferred: totals.deferred,
    fullGoalStatus: summary.fullGoalStatus,
    externalProofFilesNeedRealEvidence: summary.fullGoal.externalProofFilesNeedRealEvidence,
    fullReadinessMissing: summary.fullGoal.fullReadinessMissing,
    nextStep: summary.nextStep,
    markdownPath: paths.outMarkdown,
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
