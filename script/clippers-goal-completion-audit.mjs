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
  tiktokMvpOperatingRefresh: path.join(reportsDir, "tiktok-mvp-operating-refresh", "operating-refresh.json"),
  tiktokMvpProofRefresh: path.join(reportsDir, "tiktok-mvp-proof-intake", "proof-refresh.json"),
  tiktokMvpProofQuickFill: path.join(reportsDir, "tiktok-mvp-proof-intake", "proof-quick-fill.json"),
  masterEvidenceCsv: path.join(rootDir, "evidence-drop", "metricool-100-approval-evidence-import.csv"),
  batchEvidenceDir: path.join(scheduledDir, "metricool-100-batch-evidence-imports"),
  outJson: path.join(reportsDir, "clippers-goal-completion-audit.json"),
  outMarkdown: path.join(reportsDir, "clippers-goal-completion-audit.md"),
  outCsv: path.join(reportsDir, "clippers-goal-completion-audit.csv"),
  outNextActionsCsv: path.join(reportsDir, "clippers-goal-completion-next-actions.csv"),
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

function timestampMs(value) {
  const parsed = Date.parse(String(value || ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function isFreshGeneratedAt(value, maxAgeMs = 6 * 60 * 60 * 1000) {
  const parsed = timestampMs(value);
  if (!parsed) return false;
  const ageMs = Date.now() - parsed;
  return ageMs >= 0 && ageMs <= maxAgeMs;
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
    `- TikTok proof gate status: ${summary.tiktokMvpProofGate.status}`,
    `- TikTok proof gate minimum URLs: ${summary.tiktokMvpProofGate.minimumProofUrlsNeeded}`,
    `- TikTok proof refresh status: ${summary.tiktokMvpProofRefresh.status}`,
    `- TikTok proof refresh blockers: ${summary.tiktokMvpProofRefresh.blockers.length}`,
    `- TikTok quick fill status: ${summary.tiktokMvpProofQuickFill.status}`,
    `- TikTok quick fill current: ${summary.tiktokMvpProofQuickFill.currentWithProofRefresh}`,
    `- TikTok external active closeout tasks: ${summary.fullGoal.tiktokExternalCloseoutTasks}`,
    `- TikTok external deferred backlog tasks: ${summary.fullGoal.tiktokExternalDeferredTasks}`,
    `- Full readiness missing: ${summary.fullGoal.fullReadinessMissing}`,
    `- Operator next actions: ${summary.operatorNextActions.length}`,
    `- Operator next actions CSV: ${summary.paths.outNextActionsCsv}`,
    "",
    "## TikTok MVP Proof Gate",
    "",
    `- Status: ${summary.tiktokMvpProofGate.status}`,
    `- Required lanes: ${summary.tiktokMvpProofGate.requiredLanes.join(", ") || "none"}`,
    `- Minimum proof URLs needed: ${summary.tiktokMvpProofGate.minimumProofUrlsNeeded}`,
    `- Fast path available: ${summary.tiktokMvpProofGate.fastPathAvailable}`,
    `- Next safe button: ${summary.tiktokMvpProofGate.nextSafeButton}`,
    `- Next locked button: ${summary.tiktokMvpProofGate.nextLockedButton}`,
    `- Proof JSON: ${summary.tiktokMvpProofGate.paths.proofLinksJson || "missing"}`,
    "",
    ...(summary.tiktokMvpProofGate.blockedBy.length ? summary.tiktokMvpProofGate.blockedBy.map((item) => `- ${item}`) : ["- none"]),
    "",
    "## TikTok MVP Proof Refresh",
    "",
    `- Status: ${summary.tiktokMvpProofRefresh.status}`,
    `- Generated: ${summary.tiktokMvpProofRefresh.generatedAt}`,
    `- Fresh: ${summary.tiktokMvpProofRefresh.fresh}`,
    `- Import status: ${summary.tiktokMvpProofRefresh.importStatus}`,
    `- Doctor status: ${summary.tiktokMvpProofRefresh.doctorStatus}`,
    `- Ready lanes: ${summary.tiktokMvpProofRefresh.readyLanes}/${summary.tiktokMvpProofRefresh.targetLanes}`,
    `- Import fixes: ${summary.tiktokMvpProofRefresh.importFixQueue}`,
    `- Doctor fixes: ${summary.tiktokMvpProofRefresh.doctorFixQueue}`,
    `- Next: ${summary.tiktokMvpProofRefresh.nextStep}`,
    ...(summary.tiktokMvpProofRefresh.blockers.length ? summary.tiktokMvpProofRefresh.blockers.map((item) => `- Blocker: ${item}`) : ["- Blocker: none"]),
    "",
    "## TikTok MVP Proof Quick Fill",
    "",
    `- Status: ${summary.tiktokMvpProofQuickFill.status}`,
    `- Generated: ${summary.tiktokMvpProofQuickFill.generatedAt}`,
    `- Applied to intake: ${summary.tiktokMvpProofQuickFill.appliedToIntake}`,
    `- Current with proof refresh: ${summary.tiktokMvpProofQuickFill.currentWithProofRefresh}`,
    `- Proof refresh status at quick fill: ${summary.tiktokMvpProofQuickFill.proofRefreshStatus}`,
    `- Issues: ${summary.tiktokMvpProofQuickFill.issues}`,
    `- Input JSON: ${summary.tiktokMvpProofQuickFill.paths.inputJson || "missing"}`,
    `- Next: ${summary.tiktokMvpProofQuickFill.nextStep}`,
    "",
    "## Operator Next Actions",
    "",
    ...summary.operatorNextActions.map((row) => [
      `### ${row.priority}. ${row.title}`,
      `- Status: ${row.status}`,
      `- Owner: ${row.owner}`,
      `- Button/file: ${row.buttonOrFile}`,
      `- Proof line: ${row.proofLine || "n/a"}`,
      ...(Array.isArray(row.fastPathPasteLines) && row.fastPathPasteLines.length
        ? [
          "- Fast path paste lines:",
          ...row.fastPathPasteLines.map((line) => `  - \`${line}\``),
        ]
        : []),
      `- Guardrail: ${row.guardrail}`,
      `- Next: ${row.nextAction}`,
      "",
    ].join("\n")),
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

function renderNextActionsCsv(summary) {
  const header = ["priority", "title", "status", "owner", "button_or_file", "proof_line", "fast_path_paste_lines", "guardrail", "next_action"];
  return [
    header.map(csvCell).join(","),
    ...summary.operatorNextActions.map((row) => [
      row.priority,
      row.title,
      row.status,
      row.owner,
      row.buttonOrFile,
      row.proofLine,
      (row.fastPathPasteLines || []).join(" | "),
      row.guardrail,
      row.nextAction,
    ].map(csvCell).join(",")),
  ].join("\n") + "\n";
}

function proofGateControlFieldsPresent(proofGate = {}) {
  return [
    "status",
    "requiredLanes",
    "minimumProofUrlsNeeded",
    "failedPreflightChecks",
    "failedVerifierChecks",
    "missingRequiredReports",
    "boundaryNotReady",
    "blockedBy",
    "preflightNotReady",
  ].every((field) => Object.hasOwn(proofGate, field))
    && Array.isArray(proofGate.requiredLanes)
    && typeof proofGate.minimumProofUrlsNeeded === "number"
    && Array.isArray(proofGate.failedPreflightChecks)
    && Array.isArray(proofGate.failedVerifierChecks)
    && Array.isArray(proofGate.missingRequiredReports)
    && Array.isArray(proofGate.boundaryNotReady)
    && Array.isArray(proofGate.blockedBy);
}

function isProofGateReady(proofGate) {
  const requiredLanes = proofGate.requiredLanes || [];
  return proofGate.status === "ready_for_operator_review"
    && proofGateControlFieldsPresent(proofGate)
    && requiredLanes.includes("sports-daily:tiktok")
    && requiredLanes.includes("meme-radar:tiktok")
    && Number(proofGate.minimumProofUrlsNeeded || 0) === 0
    && Array.isArray(proofGate.failedPreflightChecks)
    && proofGate.failedPreflightChecks.length === 0
    && Array.isArray(proofGate.failedVerifierChecks)
    && proofGate.failedVerifierChecks.length === 0
    && Array.isArray(proofGate.missingRequiredReports)
    && proofGate.missingRequiredReports.length === 0
    && Array.isArray(proofGate.boundaryNotReady)
    && proofGate.boundaryNotReady.length === 0
    && Array.isArray(proofGate.blockedBy)
    && proofGate.blockedBy.length === 0
    && !proofGate.preflightNotReady;
}

function isProofRefreshReady(proofRefresh = {}) {
  const blockers = proofRefreshBlockersForAudit(proofRefresh);
  const readyChecks = proofRefresh.readyChecks || {};
  return proofRefresh.status === "ready_to_apply"
    && isFreshGeneratedAt(proofRefresh.generatedAt)
    && (proofRefresh.importStatus === "ready_to_apply" || proofRefresh.importStatus === "applied")
    && proofRefresh.doctorStatus === "ready_to_apply"
    && Number(proofRefresh.readyLanes || 0) >= Number(proofRefresh.targetLanes || 2)
    && Number(proofRefresh.importFixQueue || 0) === 0
    && Number(proofRefresh.doctorFixQueue || 0) === 0
    && blockers.length === 0
    && readyChecks.importRunOk === true
    && readyChecks.doctorRunOk === true
    && readyChecks.importReady === true
    && readyChecks.doctorReady === true
    && readyChecks.lanesReady === true
    && readyChecks.noImportFixes === true
    && readyChecks.noDoctorFixes === true;
}

function proofRefreshBlockersForAudit(proofRefresh = {}) {
  const blockers = Array.isArray(proofRefresh.blockers) ? [...proofRefresh.blockers] : [];
  if (!isFreshGeneratedAt(proofRefresh.generatedAt)) {
    blockers.unshift("proof_refresh_stale_or_missing");
  }
  return Array.from(new Set(blockers));
}

function isQuickFillCurrentWithProofRefresh(quickFill = {}, proofRefresh = {}) {
  const quickFillGeneratedAt = timestampMs(quickFill.generatedAt);
  const proofRefreshGeneratedAt = timestampMs(proofRefresh.generatedAt);
  const quickFillIssues = Array.isArray(quickFill.issues) ? quickFill.issues : null;
  return Boolean(
    quickFill.appliedToIntake === true
    && quickFill.status === "applied_to_combined_intake"
    && quickFillIssues
    && quickFillIssues.length === 0
    && isFreshGeneratedAt(quickFill.generatedAt)
    && isFreshGeneratedAt(proofRefresh.generatedAt)
    && quickFillGeneratedAt
    && proofRefreshGeneratedAt
    && quickFill.proofRefreshStatus === proofRefresh.status
  );
}

function shouldPrioritizeProofGateFix(proofGate = {}, proofGateReady = false) {
  return !proofGateReady
    && (
      proofGate.status === "ready_for_operator_review"
      || Number(proofGate.minimumProofUrlsNeeded || 0) > 0
    );
}

function buildOperatorNextActions({ accountReadiness, activeMvp, activeMvpReady, proofGateReady, proofGateFixFirst = false, currentBatchId, currentBatchReady, allPublishedEvidenceReady, proofGate, proofRefresh, proofQuickFill, proofQuickFillCurrent }) {
  const proofHandoffDir = path.join(reportsDir, "tiktok-mvp-proof-intake");
  const oneScreenProofPath = path.join(proofHandoffDir, "proof-fill-one-screen.txt");
  const rows = [];
  const accountRows = Array.isArray(accountReadiness.tiktokMvpAccountCloseout?.rows)
    ? accountReadiness.tiktokMvpAccountCloseout.rows
    : [];
  const proofRows = accountRows.length
    ? accountRows
    : [
      { accountId: "sports-daily", accountName: "Sports Daily Clips", platform: "tiktok", handle: "@sportsdaily", status: "needs_account_proof" },
      { accountId: "meme-radar", accountName: "Meme Radar", platform: "tiktok", handle: "@memeradar", status: "needs_account_proof" },
    ];
  let priority = 1;
  if (!proofGateReady) {
    const proofRefreshBlockers = proofRefreshBlockersForAudit(proofRefresh);
    const proofRefreshPath = proofRefresh?.paths?.markdown || path.join(proofHandoffDir, "proof-refresh.md");
    const quickFillInputPath = proofQuickFill?.paths?.inputJson || path.join(proofHandoffDir, "proof-quick-fill-input.json");
    const quickFillStaleCopy = proofQuickFill?.appliedToIntake && !proofQuickFillCurrent
      ? ` Quick fill is stale against current Proof refresh; use ${quickFillInputPath} or the one-screen guide and rerun Quick fill with real proof.`
      : "";
    const proofRefreshNextAction = proofRefreshBlockers.length
      ? `${proofRefresh.nextStep || "Fix proof refresh blockers before save/apply."} Current proof refresh blockers: ${proofRefreshBlockers.slice(0, 3).join(", ")}.${quickFillStaleCopy}`
      : `${proofRefresh?.nextStep || "Run Proof refresh to rebuild proof intake and doctor blockers before operating Metricool."}${quickFillStaleCopy}`;
    rows.push({
      priority: priority++,
      title: "Fast path Metricool TikTok proof gate",
      status: "blocked_needs_valid_metricool_tiktok_proof_gate",
      owner: "Robert",
      buttonOrFile: proofGateFixFirst
        ? proofGate.paths?.oneScreenGuide || oneScreenProofPath
        : proofRefreshPath,
      proofLine: (proofGate.requiredLanes || []).join(" + "),
      fastPathPasteLines: Number(proofGate.minimumProofUrlsNeeded || 0) > 0
        ? [
          "sports-daily:tiktok.metricoolConnectionProofUrl=",
          "sports-daily:tiktok.accountNotes=Robert confirms this Metricool or Drive proof shows the Sports Daily TikTok profile connected under Robert control without secrets.",
          "meme-radar:tiktok.metricoolConnectionProofUrl=",
          "meme-radar:tiktok.accountNotes=Robert confirms this Metricool or Drive proof shows the Meme Radar TikTok profile connected under Robert control without secrets.",
        ]
        : [],
      guardrail: "Metricool keys/MCP readiness do not count; paste only real non-secret Metricool/Drive proof URLs and keep the confirmation notes true.",
      nextAction: proofGateFixFirst
        ? proofGate.nextStep || `Paste the minimum ${proofGate.minimumProofUrlsNeeded || 2} real proof URLs, preview links first, then save only if the preview is clean.`
        : proofRefreshNextAction,
    });
  }
  const activeMvpProofReady = activeMvpReady && proofGateReady;
  for (const row of proofRows) {
    const accountId = row.accountId || "unknown";
    rows.push({
      priority: priority++,
      title: `${row.accountName || accountId} TikTok ownership proof`,
      status: activeMvpProofReady ? "done" : "blocked_needs_real_proof",
      owner: "Robert",
      buttonOrFile: oneScreenProofPath,
      proofLine: `${accountId}:tiktok.accountOwnershipProofUrl=`,
      guardrail: "Use only a safe HTTPS proof URL; no passwords, cookies, tokens, recovery codes, signed URLs, or private screenshots.",
      nextAction: activeMvpProofReady
        ? "Already covered by applied TikTok MVP evidence."
        : `Paste real ownership/security proof for ${row.handle || accountId}, preview links first, then save only if the preview is clean.`,
    });
    rows.push({
      priority: priority++,
      title: `${row.accountName || accountId} Metricool connection proof`,
      status: activeMvpProofReady ? "done" : "blocked_needs_real_metricool_proof",
      owner: "Robert",
      buttonOrFile: oneScreenProofPath,
      proofLine: `${accountId}:tiktok.metricoolConnectionProofUrl=`,
      guardrail: "Metricool proof must be a real HTTPS metricool.com URL or Google Drive/Docs evidence URL; keep Metricool approval_required.",
      nextAction: activeMvpProofReady
        ? "Already covered by applied TikTok MVP evidence."
        : `Paste real Metricool connection proof for ${activeMvp.metricoolBrands?.includes("SPORT") && accountId === "sports-daily" ? "SPORT" : accountId === "meme-radar" ? "memes" : accountId}, preview links first, then save only if the preview is clean.`,
    });
  }
  rows.push({
    priority: priority++,
    title: "Apply TikTok MVP evidence closeout",
    status: activeMvpProofReady ? "done" : "locked_until_proof_links_pass",
    owner: "Robert",
    buttonOrFile: "apply-clippers-tiktok-mvp-evidence-closeout-button",
    proofLine: "",
    guardrail: "Requires explicit operator confirmation; does not publish, schedule, or enable direct social APIs.",
    nextAction: activeMvpProofReady
      ? "Evidence closeout is applied for the active TikTok MVP lanes."
      : "Only click Apply after proof preview/doctor are clean and every proof URL is real.",
  });
  rows.push({
    priority: priority++,
    title: "Prepare current Metricool batch upload/session pack",
    status: currentBatchReady && activeMvpProofReady ? "ready_for_metricool_operator" : "locked_until_account_metricool_gate",
    owner: "App",
    buttonOrFile: "prepare-metricool-current-batch-upload-pack + prepare-metricool-current-batch-session-packet",
    proofLine: "",
    guardrail: "Prepares local MP4/session artifacts only; no automatic scheduling or publishing.",
    nextAction: currentBatchReady && activeMvpProofReady
      ? `Open ${currentBatchId} in Metricool approval_required mode.`
      : "This will unlock after TikTok account/Metricool proof is applied and gates pass.",
  });
  rows.push({
    priority: priority++,
    title: "Record public TikTok URLs and 24h metrics",
    status: allPublishedEvidenceReady ? "done" : "waiting_metricool_work",
    owner: "Robert",
    buttonOrFile: path.join(paths.batchEvidenceDir, `${currentBatchId}-evidence-import.csv`),
    proofLine: "",
    guardrail: "Only exact public TikTok video URLs with real 24h metrics count; no search/profile URLs.",
    nextAction: "After posts are live, fill the current batch evidence CSV and run the import/closeout verifier.",
  });
  return rows;
}

async function main() {
  await mkdir(reportsDir, { recursive: true });
  const [accountReadiness, mvpLaunchPack, approvalRun, approvalSession, launchControl, tiktokExternalCloseoutSession, operatingRefresh, proofRefresh, proofQuickFill, evidenceRaw] = await Promise.all([
    readJson(paths.accountReadiness),
    readJson(paths.metricoolMvpLaunchPack),
    readJson(paths.metricool100ApprovalRun),
    readJson(paths.metricoolApprovalSession),
    readJson(paths.tiktokLaunchControl),
    readJson(paths.tiktokExternalCloseoutSession, {}),
    readJson(paths.tiktokMvpOperatingRefresh, {}),
    readJson(paths.tiktokMvpProofRefresh, {}),
    readJson(paths.tiktokMvpProofQuickFill, {}),
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
  const proofGate = operatingRefresh.proofGate || {};
  const proofGateControlsPresent = proofGateControlFieldsPresent(proofGate);
  const proofGateReady = isProofGateReady(proofGate);
  const proofRefreshReady = isProofRefreshReady(proofRefresh);
  const proofRefreshFresh = isFreshGeneratedAt(proofRefresh.generatedAt);
  const proofRefreshBlockers = proofRefreshBlockersForAudit(proofRefresh);
  const proofQuickFillCurrent = isQuickFillCurrentWithProofRefresh(proofQuickFill, proofRefresh);
  const proofGateFixFirst = shouldPrioritizeProofGateFix(proofGate, proofGateReady);
  const quickFillRequiredNextStep = proofQuickFill.nextStep || "Quick fill is stale or missing; rerun Quick fill with real non-secret proof before trusting this result.";
  const proofGateNextStep = proofGateFixFirst
    ? (proofGate.nextStep || "Run Operating Refresh and paste real non-secret SPORT/memes Metricool proof URLs.")
    : !proofRefreshReady
      ? (proofRefresh.nextStep || "Run Proof refresh to rebuild proof intake and doctor blockers.")
      : !proofQuickFillCurrent
        ? quickFillRequiredNextStep
        : (proofGate.nextStep || "Use Metricool approval workflow only.");
  const tiktokMvpProofReady = proofGateReady && proofRefreshReady && proofQuickFillCurrent;
  const tiktokMvpOperatorReady = tiktokMvpProofReady && activeMvpReady && approvalOnlyQueueReady && strictTikTokSession;
  const currentBatchOperatorReady = tiktokMvpOperatorReady && currentBatchReady;

  const requirements = [
    requirement(
      "tiktok_metricool_proof_gate",
      "TikTok Metricool proof gate",
      tiktokMvpProofReady ? "ready" : "needs_external_action",
      `proofGate ${proofGate.status || "missing"}; proofGateReady ${proofGateReady}; controlFieldsPresent ${proofGateControlsPresent}; lanes ${(proofGate.requiredLanes || []).join("+") || "missing"}; minimumProofUrlsNeeded ${proofGate.minimumProofUrlsNeeded ?? "missing"}; proofRefresh ${proofRefresh.status || "missing"}; proofRefreshReady ${proofRefreshReady}; proofRefreshFresh ${proofRefreshFresh}; proofRefreshGeneratedAt ${proofRefresh.generatedAt || "missing"}; proofRefreshBlockers ${proofRefreshBlockers.join("+") || "none"}; quickFillCurrent ${proofQuickFillCurrent}; failedVerifier ${(proofGate.failedVerifierChecks || []).join("+") || "none"}; failedPreflight ${(proofGate.failedPreflightChecks || []).join("+") || "none"}`,
      proofGateNextStep,
    ),
    requirement(
      "tiktok_metricool_mvp_ready",
      "TikTok Metricool MVP ready",
      tiktokMvpOperatorReady ? "ready" : "needs_external_action",
      `activeMvp ${activeMvp.readyLanes || 0}/${activeMvp.targetLanes || 0}; queued ${approvalRun.totals?.metricoolQueuedForApproval || 0}; readyToSend ${approvalRun.totals?.readyToSend || 0}; platforms tiktok=${approvalSession.totals?.tiktok || 0}, instagram=${approvalSession.totals?.instagram || 0}, youtube=${approvalSession.totals?.youtube || 0}`,
      tiktokMvpProofReady
        ? "Use Metricool approval workflow only."
        : proofGateNextStep,
    ),
    requirement(
      "tiktok_batch_01_ready_for_metricool",
      "Batch 01 ready for Metricool operator",
      currentBatchOperatorReady ? "ready" : (tiktokMvpProofReady ? "waiting_metricool_work" : "needs_external_action"),
      `launchControl ${launchControl.status || "missing"}; currentBatch ${currentBatch.id || "missing"} rows ${currentBatch.rows || 0}; accounts ${(currentBatch.accounts || []).join("+") || "none"}`,
      currentBatchOperatorReady
        ? "Open the current batch workbook and process it inside Metricool."
        : (tiktokMvpProofReady ? "Prepare the current batch after launch control is ready." : proofGateNextStep),
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
  const operatorNextActions = buildOperatorNextActions({
    accountReadiness,
    activeMvp,
    activeMvpReady,
    proofGateReady: tiktokMvpProofReady,
    proofGateFixFirst,
    currentBatchId,
    currentBatchReady,
    allPublishedEvidenceReady,
    proofGate,
    proofRefresh,
    proofQuickFill,
    proofQuickFillCurrent,
  });

  const totals = requirements.reduce((sum, row) => {
    sum.requirements += 1;
    if (row.status === "ready") sum.ready += 1;
    if (row.status === "ready_for_tiktok_mvp") sum.tiktokMvpReady += 1;
    if (row.status === "waiting_metricool_work") sum.waitingMetricoolWork += 1;
    if (row.status === "needs_external_action") sum.needsExternalAction += 1;
    if (row.status === "deferred") sum.deferred += 1;
    return sum;
  }, { requirements: 0, ready: 0, tiktokMvpReady: 0, waitingMetricoolWork: 0, needsExternalAction: 0, deferred: 0 });
  const status = currentBatchOperatorReady
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
      metricoolMvpReady: tiktokMvpOperatorReady,
      tiktokMvpProofGateReady: tiktokMvpProofReady,
      tiktokMvpOperatingProofGateReady: proofGateReady,
      tiktokMvpProofRefreshReady: proofRefreshReady,
      externalProofFilesNeedRealEvidence: externalProofRows,
      tiktokExternalCloseoutTasks,
      tiktokExternalDeferredTasks,
      fullReadinessMissing: fullMissing,
      allAccountsVerified,
      allDirectApiPermissionsReady,
      allPublishedEvidenceReady,
    },
    tiktokMvpProofGate: {
      status: proofGate.status || "missing",
      controlFieldsPresent: proofGateControlsPresent,
      requiredLanes: proofGate.requiredLanes || [],
      minimumProofUrlsNeeded: Number(proofGate.minimumProofUrlsNeeded || 0),
      proofPacketsNeeded: Number(proofGate.proofPacketsNeeded || 0),
      fastPathAvailable: Boolean(proofGate.fastPathAvailable),
      nextSafeButton: proofGate.nextSafeButton || "prepare_tiktok_mvp_operating_refresh",
      nextLockedButton: proofGate.nextLockedButton || "save_proof_links",
      failedPreflightChecks: proofGate.failedPreflightChecks || [],
      failedVerifierChecks: proofGate.failedVerifierChecks || [],
      blockedBy: proofGate.blockedBy || [],
      paths: proofGate.paths || {},
      nextStep: proofGate.nextStep || "Run Operating Refresh to rebuild the TikTok MVP proof gate.",
    },
    tiktokMvpProofRefresh: {
      status: proofRefresh.status || "missing",
      generatedAt: proofRefresh.generatedAt || "missing",
      fresh: proofRefreshFresh,
      importStatus: proofRefresh.importStatus || "missing",
      doctorStatus: proofRefresh.doctorStatus || "missing",
      readyLanes: Number(proofRefresh.readyLanes || 0),
      targetLanes: Number(proofRefresh.targetLanes || 2),
      importFixQueue: Number(proofRefresh.importFixQueue || 0),
      doctorFixQueue: Number(proofRefresh.doctorFixQueue || 0),
      readyChecks: proofRefresh.readyChecks || {},
      blockers: proofRefreshBlockers,
      paths: proofRefresh.paths || {},
      nextStep: proofRefresh.nextStep || "Run Proof refresh to rebuild proof intake and doctor blockers.",
    },
    tiktokMvpProofQuickFill: {
      status: proofQuickFill.status || "missing",
      generatedAt: proofQuickFill.generatedAt || "missing",
      appliedToIntake: Boolean(proofQuickFill.appliedToIntake),
      currentWithProofRefresh: proofQuickFillCurrent,
      proofRefreshStatus: proofQuickFill.proofRefreshStatus || "missing",
      proofUnblockerStatus: proofQuickFill.proofUnblockerStatus || "missing",
      issues: Array.isArray(proofQuickFill.issues) ? proofQuickFill.issues.length : 1,
      paths: proofQuickFill.paths || {},
      nextStep: proofQuickFillCurrent
        ? (proofQuickFill.nextStep || "Continue from the current quick fill result.")
        : "Quick fill is stale or missing; rerun Quick fill with real non-secret proof before trusting this result.",
    },
    operatorNextActions,
    requirements,
    totals,
    nextStep: status === "tiktok_mvp_ready_external_work_remaining"
      ? `Process ${currentBatch.id || "metricool-batch-01"} in Metricool; do not import evidence until real TikTok URLs and 24h metrics exist.`
      : (tiktokMvpProofReady
        ? "Fix the blocked TikTok MVP evidence before operating Metricool."
        : proofGateNextStep),
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
  await writeFile(paths.outNextActionsCsv, renderNextActionsCsv(summary));
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
    operatorNextActions: summary.operatorNextActions.length,
    nextActionsCsvPath: paths.outNextActionsCsv,
    markdownPath: paths.outMarkdown,
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
