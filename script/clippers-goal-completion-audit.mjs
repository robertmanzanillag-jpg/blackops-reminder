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
  tiktokMvpProofHandoff: path.join(reportsDir, "tiktok-mvp-proof-intake", "proof-handoff.json"),
  tiktokMvpProofLinksPreviewGate: path.join(reportsDir, "tiktok-mvp-proof-intake", "proof-links-preview-gate.json"),
  masterEvidenceCsv: path.join(rootDir, "evidence-drop", "metricool-100-approval-evidence-import.csv"),
  batchEvidenceDir: path.join(scheduledDir, "metricool-100-batch-evidence-imports"),
  outJson: path.join(reportsDir, "clippers-goal-completion-audit.json"),
  outMarkdown: path.join(reportsDir, "clippers-goal-completion-audit.md"),
  outCsv: path.join(reportsDir, "clippers-goal-completion-audit.csv"),
  outNextActionsCsv: path.join(reportsDir, "clippers-goal-completion-next-actions.csv"),
};
const proofLinksDropPastePaths = [
  path.join(rootDir, "proof-drop", "tiktok-mvp", "proof-links-paste-packet-filled.txt"),
  path.join(rootDir, "proof-drop", "tiktok-mvp", "proof-links-drop.txt"),
  path.join(rootDir, "proof-drop", "tiktok-mvp", "proof-links-paste-packet.txt"),
];

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

function candidateProofUrlCount(raw) {
  const proofText = String(raw || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => !line.startsWith("#"))
    .join("\n");
  return Array.from(proofText.matchAll(/https:\/\/[^\s"'<>]+/gi))
    .map((match) => match[0].replace(/[),.;]+$/g, ""))
    .filter((url) => !isPlaceholder(url) && !containsUnsafeProofText(url))
    .length;
}

function containsUnsafeProofText(value) {
  return /access_token=|refresh_token=|client_secret=|bearer\s+[a-z0-9._-]+|sk-[a-z0-9_-]+|(?:^|[\s"'[{,?&#;])(cookie|password|passcode|recovery|api[_-]?key|private[_ -]?key)["']?\s*[:=]/i.test(String(value || ""))
    || /[a-z][a-z0-9+.-]*:\/\/[^/\s:@]+:[^@\s/]+@/i.test(String(value || ""))
    || /(?:^|[?&#;])(token|code|auth|signature|sig|signed|secret|key|api_key|apikey|access|refresh|session|cookie|expires|expiry|x-amz-signature|x-amz-credential|x-amz-security-token)=/i.test(String(value || ""));
}

async function buildProofLinksDropAudit() {
  for (const sourcePath of proofLinksDropPastePaths) {
    const raw = await readFile(sourcePath, "utf8").catch((error) => {
      if (error?.code === "ENOENT") return null;
      throw error;
    });
    if (raw === null) continue;
    const trimmed = raw.trim();
    const bytes = Buffer.byteLength(raw, "utf8");
    const extractedUrls = candidateProofUrlCount(raw);
    const unsafeBlocked = containsUnsafeProofText(raw);
    const blankProofLines = (raw.match(/(?:accountOwnershipProofUrl|metricoolConnectionProofUrl)\s*=\s*(?:\r?\n|$)/g) || []).length;
    const starterLike = /TikTok MVP Metricool fast-path proof packet|proof-links paste packet/i.test(raw)
      && (blankProofLines > 0 || extractedUrls < 2);
    const status = !trimmed
      ? "empty"
      : unsafeBlocked
        ? "blocked_secret_like"
        : starterLike
          ? "starter_waiting_for_urls"
          : extractedUrls >= 2
            ? "ready_for_preview"
            : "needs_urls";
    return {
      status,
      found: true,
      sourcePath,
      bytes,
      extractedUrls,
      blankProofLines,
      starterLike,
      unsafeBlocked,
      nextButton: status === "ready_for_preview" ? "import_drop_file" : "edit_drop_file",
      nextStep: status === "ready_for_preview"
        ? "Import drop file to create a clean preview gate; do not save until preview stays clean/current."
        : status === "blocked_secret_like"
          ? "Remove tokens, cookies, passwords, signed URLs, or private key material before importing this drop file."
          : "Fill the drop file with real SPORT and memes Metricool or concrete Drive/Docs proof URLs before importing.",
    };
  }
  return {
    status: "missing",
    found: false,
    sourcePath: proofLinksDropPastePaths[0],
    bytes: 0,
    extractedUrls: 0,
    blankProofLines: 0,
    starterLike: false,
    unsafeBlocked: false,
    nextButton: "create_starter",
    nextStep: `Create ${proofLinksDropPastePaths[0]} or use the app starter, then paste real non-secret SPORT and memes proof URLs.`,
  };
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

function buildTikTokMvpStartGate({ activeMvpReady, tiktokMvpProofReady, proofLinksPreviewGate, approvalOnlyQueueReady, strictTikTokSession, currentBatchReady, approvalRunPublishMode, readyToImport, currentBatchId }) {
  const noFakePublishReady = approvalRunPublishMode === "approval_required" && Number(readyToImport || 0) === 0;
  const checks = [
    {
      id: "active_scope",
      label: "Active scope is TikTok-only SPORT + memes",
      status: activeMvpReady ? "pass" : "blocked",
      evidence: activeMvpReady ? "active MVP lanes are TikTok-only SPORT + memes" : "active MVP account lanes are not fully ready",
      nextAction: activeMvpReady ? "Keep Instagram/YouTube/streamers deferred." : "Keep the MVP scoped to SPORT and memes TikTok, then finish SPORT/memes proof before starting Metricool work.",
    },
    {
      id: "proof_gate",
      label: "SPORT and memes proof gate",
      status: tiktokMvpProofReady ? "pass" : "blocked",
      evidence: tiktokMvpProofReady ? "proof gate, proof refresh, and quick fill are current" : "real non-secret SPORT + memes proof is still missing or stale",
      nextAction: tiktokMvpProofReady ? "Use the applied evidence for operator review." : "Paste real Metricool or concrete Drive/Docs proof. Preview links first; save only if the preview gate is clean/current.",
    },
    {
      id: "proof_preview_save_gate",
      label: "Proof links preview/save gate",
      status: proofLinksPreviewGate.readyForSave || tiktokMvpProofReady ? "pass" : "blocked",
      evidence: `previewGate ${proofLinksPreviewGate.status}; fresh ${proofLinksPreviewGate.fresh}; readyForSave ${proofLinksPreviewGate.readyForSave}`,
      nextAction: proofLinksPreviewGate.readyForSave || tiktokMvpProofReady
        ? "Preview gate is clean or evidence is already applied."
        : "Run Preview links after adding real proof URLs; do not save from stale preview text.",
    },
    {
      id: "approval_queue",
      label: "Metricool approval queue only",
      status: approvalOnlyQueueReady && strictTikTokSession ? "pass" : "blocked",
      evidence: approvalOnlyQueueReady && strictTikTokSession ? "100 TikTok rows queued for approval_required; no direct send" : "Metricool queue/session is not in the strict TikTok approval-only shape",
      nextAction: approvalOnlyQueueReady && strictTikTokSession ? "Keep all work inside Metricool approval review." : "Rebuild the Metricool approval queue/session before operating.",
    },
    {
      id: "current_batch",
      label: "Current batch 01 operator pack",
      status: currentBatchReady ? "pass" : "blocked",
      evidence: currentBatchReady ? `${currentBatchId} has the expected TikTok operator rows` : `${currentBatchId} is not ready as the current operator batch`,
      nextAction: currentBatchReady ? "Use batch 01 after proof gate passes." : "Prepare launch control/current batch after proof readiness is clean.",
    },
    {
      id: "no_fake_publish",
      label: "No fake publish or direct API mode",
      status: noFakePublishReady ? "pass" : "blocked",
      evidence: `publishMode ${approvalRunPublishMode}; readyToImport ${Number(readyToImport || 0)}`,
      nextAction: noFakePublishReady
        ? "Published counts still require live TikTok URLs plus 24h metrics."
        : "Stop operation and restore Metricool approval_required mode with zero ready-to-import rows.",
    },
  ];
  const blockers = checks.filter((check) => check.status !== "pass");
  return {
    status: blockers.length ? "blocked_needs_external_proof_or_operator_pack" : "ready_for_metricool_approval_ops",
    ready: blockers.length === 0,
    passed: checks.length - blockers.length,
    total: checks.length,
    blockers: blockers.map((check) => check.id),
    publishMode: approvalRunPublishMode,
    readyToImport: Number(readyToImport || 0),
    checks,
    nextStep: blockers[0]?.nextAction || "Start the TikTok-only Metricool approval workflow; no automatic publishing is enabled.",
  };
}

function buildExternalActionGate({ proofGate = {}, proofGateReady = false, proofLinksPreviewGate = {}, proofHandoff = {}, operatorNextActions = [] }) {
  const missingProofUrls = Number(proofGate.minimumProofUrlsNeeded ?? proofHandoff?.unblockBoard?.minimumProofUrlsNeeded ?? 0);
  const proofPacketsNeeded = Number(proofGate.proofPacketsNeeded ?? proofHandoff?.unblockBoard?.missingProofs ?? 0);
  const fastPathAvailable = Boolean(proofGate.fastPathAvailable || proofHandoff?.unblockBoard?.fastPathAvailable);
  const primaryAction = operatorNextActions[0] || {};
  const waitingForRobertProof = missingProofUrls > 0 || proofLinksPreviewGate.readyForSave !== true || !proofGateReady;
  return {
    status: waitingForRobertProof ? "waiting_for_robert_proof" : "proof_preview_ready",
    canAutomateWithoutRobert: !waitingForRobertProof,
    missingProofUrls,
    proofPacketsNeeded,
    fastPathAvailable,
    proofGateReady,
    proofGateStatus: proofGate.status || "missing",
    requiredOwner: waitingForRobertProof ? "Robert/operator" : "app",
    nextSafeButton: proofGate.nextSafeButton || "preview_proof_links",
    lockedButton: proofGate.nextLockedButton || "save_proof_links",
    fastPathPacketPath: primaryAction.fastPathPacketPath || proofHandoff?.paths?.fastPathPastePacketTxt || "",
    exactFields: Array.isArray(primaryAction.fastPathPasteLines)
      ? primaryAction.fastPathPasteLines.filter((line) => /\.metricoolConnectionProofUrl=/.test(line))
      : [],
    reason: waitingForRobertProof
      ? "The app cannot truthfully create or approve external Metricool/TikTok proof, and the proof gate must be current before automation continues."
      : "Proof preview is clean/current; the app can continue the guarded refresh and approval queue flow.",
    nextStep: waitingForRobertProof
      ? "Paste real SPORT and memes Metricool or concrete Drive/Docs proof URLs, then run Preview links before saving."
      : "Save the clean proof links, refresh the audit, then prepare the Metricool approval queue.",
  };
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
    `- TikTok proof links preview gate status: ${summary.tiktokMvpProofLinksPreviewGate.status}`,
    `- TikTok proof links preview gate fresh: ${summary.tiktokMvpProofLinksPreviewGate.fresh}`,
    `- External action gate: ${summary.externalActionGate.status}`,
    `- Can automate without Robert: ${summary.externalActionGate.canAutomateWithoutRobert}`,
    `- Missing proof URLs: ${summary.externalActionGate.missingProofUrls}`,
    `- Proof links drop: ${summary.proofLinksDropAudit.status}`,
    `- Proof links drop candidate URLs: ${summary.proofLinksDropAudit.extractedUrls}`,
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
    "## TikTok MVP Start Gate",
    "",
    `- Status: ${summary.tiktokMvpStartGate.status}`,
    `- Ready: ${summary.tiktokMvpStartGate.ready}`,
    `- Passed: ${summary.tiktokMvpStartGate.passed}/${summary.tiktokMvpStartGate.total}`,
    `- Blockers: ${summary.tiktokMvpStartGate.blockers.join(", ") || "none"}`,
    `- Next: ${summary.tiktokMvpStartGate.nextStep}`,
    "",
    ...summary.tiktokMvpStartGate.checks.map((check) => [
      `### ${check.label}`,
      `- Status: ${check.status}`,
      `- Evidence: ${check.evidence}`,
      `- Next: ${check.nextAction}`,
      "",
    ].join("\n")),
    "",
    "## External Action Gate",
    "",
    `- Status: ${summary.externalActionGate.status}`,
    `- Can automate without Robert: ${summary.externalActionGate.canAutomateWithoutRobert}`,
    `- Missing proof URLs: ${summary.externalActionGate.missingProofUrls}`,
    `- Proof packets needed: ${summary.externalActionGate.proofPacketsNeeded}`,
    `- Fast path available: ${summary.externalActionGate.fastPathAvailable}`,
    `- Proof gate ready: ${summary.externalActionGate.proofGateReady}`,
    `- Proof gate status: ${summary.externalActionGate.proofGateStatus}`,
    `- Required owner: ${summary.externalActionGate.requiredOwner}`,
    `- Next safe button: ${summary.externalActionGate.nextSafeButton}`,
    `- Locked button: ${summary.externalActionGate.lockedButton}`,
    `- Fast path packet: ${summary.externalActionGate.fastPathPacketPath || "missing"}`,
    `- Reason: ${summary.externalActionGate.reason}`,
    `- Next: ${summary.externalActionGate.nextStep}`,
    ...(summary.externalActionGate.exactFields.length
      ? ["- Exact fields:", ...summary.externalActionGate.exactFields.map((field) => `  - \`${field}\``)]
      : ["- Exact fields: none"]),
    "",
    "## Proof Links Drop Audit",
    "",
    `- Status: ${summary.proofLinksDropAudit.status}`,
    `- Found: ${summary.proofLinksDropAudit.found}`,
    `- Source path: ${summary.proofLinksDropAudit.sourcePath}`,
    `- Bytes: ${summary.proofLinksDropAudit.bytes}`,
    `- Candidate proof URLs found: ${summary.proofLinksDropAudit.extractedUrls}`,
    `- Blank proof lines: ${summary.proofLinksDropAudit.blankProofLines}`,
    `- Starter-like: ${summary.proofLinksDropAudit.starterLike}`,
    `- Unsafe blocked: ${summary.proofLinksDropAudit.unsafeBlocked}`,
    `- Next button: ${summary.proofLinksDropAudit.nextButton}`,
    `- Next: ${summary.proofLinksDropAudit.nextStep}`,
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
    "## TikTok MVP Proof Links Preview Gate",
    "",
    `- Status: ${summary.tiktokMvpProofLinksPreviewGate.status}`,
    `- Generated: ${summary.tiktokMvpProofLinksPreviewGate.generatedAt}`,
    `- Fresh: ${summary.tiktokMvpProofLinksPreviewGate.fresh}`,
    `- Raw stored: ${summary.tiktokMvpProofLinksPreviewGate.rawStored}`,
    `- Raw hash present: ${summary.tiktokMvpProofLinksPreviewGate.rawHashPresent}`,
    `- Ready proof fields: ${summary.tiktokMvpProofLinksPreviewGate.readyProofFields}/${summary.tiktokMvpProofLinksPreviewGate.totalProofFields}`,
    `- Issues: ${summary.tiktokMvpProofLinksPreviewGate.issues}`,
    `- Path: ${summary.tiktokMvpProofLinksPreviewGate.path}`,
    `- Next: ${summary.tiktokMvpProofLinksPreviewGate.nextStep}`,
    "",
    "## Operator Next Actions",
    "",
    ...summary.operatorNextActions.map((row) => [
      `### ${row.priority}. ${row.title}`,
      `- Status: ${row.status}`,
      `- Owner: ${row.owner}`,
      `- Button/file: ${row.buttonOrFile}`,
      `- Proof line: ${row.proofLine || "n/a"}`,
      ...(row.fastPathPacketPath ? [`- Fast path packet: ${row.fastPathPacketPath}`] : []),
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
  const header = ["priority", "title", "status", "owner", "button_or_file", "proof_line", "fast_path_packet_path", "fast_path_paste_lines", "guardrail", "next_action"];
  return [
    header.map(csvCell).join(","),
    ...summary.operatorNextActions.map((row) => [
      row.priority,
      row.title,
      row.status,
      row.owner,
      row.buttonOrFile,
      row.proofLine,
      row.fastPathPacketPath || "",
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

function buildProofLinksPreviewGateSummary(gate = {}) {
  const generatedAt = gate.generatedAt || "missing";
  const fresh = isFreshGeneratedAt(generatedAt, 30 * 60 * 1000);
  const readyProofFields = Number(gate.totals?.readyProofFields || 0);
  const totalProofFields = Number(gate.totals?.totalProofFields || 0);
  const issues = Number(gate.totals?.issues || 0);
  const status = gate.status || "missing";
  const rawStoredExplicitFalse = gate.rawStored === false;
  const rawStored = gate.rawStored === true ? true : (rawStoredExplicitFalse ? false : "unknown");
  const readyForSave = status === "ready_for_save"
    && fresh
    && rawStoredExplicitFalse
    && Boolean(gate.rawHash)
    && issues === 0
    && totalProofFields > 0
    && readyProofFields === totalProofFields;
  return {
    status,
    generatedAt,
    fresh,
    readyForSave,
    rawStored,
    rawStoredExplicitFalse,
    rawHashPresent: Boolean(gate.rawHash),
    readyProofFields,
    totalProofFields,
    issues,
    path: paths.tiktokMvpProofLinksPreviewGate,
    nextStep: readyForSave
      ? "A clean current proof-links preview gate exists; saving still requires the matching previewHash and real non-secret proof links."
      : "Run Preview links after pasting real SPORT and memes proof URLs; save only if the preview gate is clean and current.",
  };
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

function buildOperatorNextActions({ accountReadiness, activeMvp, activeMvpReady, proofGateReady, proofGateFixFirst = false, currentBatchId, currentBatchReady, allPublishedEvidenceReady, proofGate, proofRefresh, proofQuickFill, proofQuickFillCurrent, proofHandoff }) {
  const proofHandoffDir = path.join(reportsDir, "tiktok-mvp-proof-intake");
  const oneScreenProofPath = path.join(proofHandoffDir, "proof-fill-one-screen.txt");
  const fastPathProofPacketPath = proofHandoff?.paths?.fastPathPastePacketTxt || path.join(proofHandoffDir, "proof-links-fast-path-paste-packet.txt");
  const fastPathProofPacketText = String(proofHandoff?.fastPathPastePacketText || "").trim();
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
        ? fastPathProofPacketPath
        : proofRefreshPath,
      proofLine: (proofGate.requiredLanes || []).join(" + "),
      fastPathPacketPath: fastPathProofPacketPath,
      fastPathPacketText: fastPathProofPacketText,
      fastPathPasteLines: Number(proofGate.minimumProofUrlsNeeded || 0) > 0
        ? [
          "sports-daily:tiktok.metricoolConnectionProofUrl=",
          "sports-daily:tiktok.accountNotes=<write a real 20+ character note after reviewing SPORT ownership/control proof>",
          "meme-radar:tiktok.metricoolConnectionProofUrl=",
          "meme-radar:tiktok.accountNotes=<write a real 20+ character note after reviewing memes ownership/control proof>",
        ]
        : [],
      guardrail: "Metricool keys/MCP readiness do not count; paste only real non-secret Metricool URLs or concrete Drive file/folder/Docs proof URLs and keep the confirmation notes true.",
      nextAction: proofGateFixFirst
        ? proofGate.nextStep || `Paste the minimum ${proofGate.minimumProofUrlsNeeded || 2} real proof URLs. Preview links first; save only if the preview gate is clean/current.`
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
        : `Paste real ownership/security proof for ${row.handle || accountId}. Preview links first; save only if the preview gate is clean/current.`,
    });
    rows.push({
      priority: priority++,
      title: `${row.accountName || accountId} Metricool connection proof`,
      status: activeMvpProofReady ? "done" : "blocked_needs_real_metricool_proof",
      owner: "Robert",
      buttonOrFile: oneScreenProofPath,
      proofLine: `${accountId}:tiktok.metricoolConnectionProofUrl=`,
      guardrail: "Metricool proof must be a real HTTPS metricool.com URL or concrete Google Drive file/folder or Docs evidence URL; keep Metricool approval_required.",
      nextAction: activeMvpProofReady
        ? "Already covered by applied TikTok MVP evidence."
        : `Paste real Metricool connection proof for ${activeMvp.metricoolBrands?.includes("SPORT") && accountId === "sports-daily" ? "SPORT" : accountId === "meme-radar" ? "memes" : accountId}. Preview links first; save only if the preview gate is clean/current.`,
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
  const [accountReadiness, mvpLaunchPack, approvalRun, approvalSession, launchControl, tiktokExternalCloseoutSession, operatingRefresh, proofRefresh, proofQuickFill, proofHandoff, proofLinksPreviewGateRaw, proofLinksDropAudit, evidenceRaw] = await Promise.all([
    readJson(paths.accountReadiness),
    readJson(paths.metricoolMvpLaunchPack),
    readJson(paths.metricool100ApprovalRun),
    readJson(paths.metricoolApprovalSession),
    readJson(paths.tiktokLaunchControl),
    readJson(paths.tiktokExternalCloseoutSession, {}),
    readJson(paths.tiktokMvpOperatingRefresh, {}),
    readJson(paths.tiktokMvpProofRefresh, {}),
    readJson(paths.tiktokMvpProofQuickFill, {}),
    readJson(paths.tiktokMvpProofHandoff, {}),
    readJson(paths.tiktokMvpProofLinksPreviewGate, {}),
    buildProofLinksDropAudit(),
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
  const proofLinksPreviewGate = buildProofLinksPreviewGateSummary(proofLinksPreviewGateRaw);
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
  const tiktokMvpStartGate = buildTikTokMvpStartGate({
    activeMvpReady,
    tiktokMvpProofReady,
    proofLinksPreviewGate,
    approvalOnlyQueueReady,
    strictTikTokSession,
    currentBatchReady,
    approvalRunPublishMode,
    readyToImport: launchControl.totals?.readyToImport || 0,
    currentBatchId,
  });

  const requirements = [
    requirement(
      "tiktok_metricool_proof_gate",
      "TikTok Metricool proof gate",
      tiktokMvpProofReady ? "ready" : "needs_external_action",
      `proofGate ${proofGate.status || "missing"}; proofGateReady ${proofGateReady}; controlFieldsPresent ${proofGateControlsPresent}; lanes ${(proofGate.requiredLanes || []).join("+") || "missing"}; minimumProofUrlsNeeded ${proofGate.minimumProofUrlsNeeded ?? "missing"}; proofLinksPreviewGate ${proofLinksPreviewGate.status}; proofLinksPreviewGateFresh ${proofLinksPreviewGate.fresh}; proofLinksPreviewGateReadyForSave ${proofLinksPreviewGate.readyForSave}; proofLinksPreviewRawStored ${proofLinksPreviewGate.rawStored}; proofRefresh ${proofRefresh.status || "missing"}; proofRefreshReady ${proofRefreshReady}; proofRefreshFresh ${proofRefreshFresh}; proofRefreshGeneratedAt ${proofRefresh.generatedAt || "missing"}; proofRefreshBlockers ${proofRefreshBlockers.join("+") || "none"}; quickFillCurrent ${proofQuickFillCurrent}; failedVerifier ${(proofGate.failedVerifierChecks || []).join("+") || "none"}; failedPreflight ${(proofGate.failedPreflightChecks || []).join("+") || "none"}`,
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
    proofHandoff,
  });
  const externalActionGate = buildExternalActionGate({
    proofGate,
    proofGateReady,
    proofLinksPreviewGate,
    proofHandoff,
    operatorNextActions,
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
    tiktokMvpProofLinksPreviewGate: proofLinksPreviewGate,
    proofLinksDropAudit,
    tiktokMvpStartGate,
    externalActionGate,
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
    proofLinksPreviewGateStatus: summary.tiktokMvpProofLinksPreviewGate.status,
    proofLinksPreviewGateFresh: summary.tiktokMvpProofLinksPreviewGate.fresh,
    tiktokMvpStartGateStatus: summary.tiktokMvpStartGate.status,
    tiktokMvpStartGatePassed: `${summary.tiktokMvpStartGate.passed}/${summary.tiktokMvpStartGate.total}`,
    externalActionGateStatus: summary.externalActionGate.status,
    canAutomateWithoutRobert: summary.externalActionGate.canAutomateWithoutRobert,
    missingProofUrls: summary.externalActionGate.missingProofUrls,
    proofLinksDropStatus: summary.proofLinksDropAudit.status,
    proofLinksDropExtractedUrls: summary.proofLinksDropAudit.extractedUrls,
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
