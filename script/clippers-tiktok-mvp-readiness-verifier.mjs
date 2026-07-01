import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const rootDir = path.join(process.cwd(), "clippers_workspace");
const scheduledDir = path.join(rootDir, "scheduled");
const reportsDir = path.join(rootDir, "reports");

const paths = {
  accountReadiness: path.join(rootDir, "account-permission-readiness.json"),
  approvalRun: path.join(scheduledDir, "metricool-100-approval-run.json"),
  approvalSession: path.join(scheduledDir, "metricool-approval-session.json"),
  operatorHandoff: path.join(scheduledDir, "metricool-100-operator-handoff.json"),
  launchControl: path.join(reportsDir, "clippers-tiktok-launch-control.json"),
  goLivePacket: path.join(reportsDir, "clippers-tiktok-mvp-go-live-packet.json"),
  goalAudit: path.join(reportsDir, "clippers-goal-completion-audit.json"),
  tiktokExternalCloseoutSession: path.join(reportsDir, "clippers-tiktok-external-closeout-session.json"),
  metricoolBridgePreviewGate: path.join(reportsDir, "tiktok-mvp-proof-intake", "metricool-bridge-preview-gate.json"),
  outJson: path.join(reportsDir, "clippers-tiktok-mvp-readiness-verifier.json"),
  outMarkdown: path.join(reportsDir, "clippers-tiktok-mvp-readiness-verifier.md"),
  outCsv: path.join(reportsDir, "clippers-tiktok-mvp-readiness-verifier.csv"),
};

const expectedAccounts = ["meme-radar", "sports-daily"];
const expectedBrands = ["SPORT", "memes"];

async function readJson(filePath) {
  const raw = await readFile(filePath, "utf8");
  return JSON.parse(raw);
}

async function readJsonOptional(filePath, fallback = null) {
  const raw = await readFile(filePath, "utf8").catch(() => null);
  if (!raw) return fallback;
  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function csvCell(value) {
  return `"${String(value ?? "").replace(/"/g, '""')}"`;
}

function sameSet(actual, expected) {
  const normalizedActual = Array.from(new Set((actual || []).filter(Boolean))).sort();
  const normalizedExpected = Array.from(new Set(expected)).sort();
  return JSON.stringify(normalizedActual) === JSON.stringify(normalizedExpected);
}

function check(id, label, pass, evidence, blocker, nextAction) {
  return {
    id,
    label,
    status: pass ? "pass" : "fail",
    evidence,
    blocker: pass ? "" : blocker,
    nextAction: pass ? "No action needed for TikTok MVP." : nextAction,
  };
}

function activeScopeIsTikTokOnly(accountReadiness, goLivePacket) {
  const activeMvp = accountReadiness.activeMvp || {};
  const operatingMode = goLivePacket.operatingMode || {};
  return activeMvp.scope === "tiktok_only_metricool_mvp"
    && sameSet(activeMvp.platforms, ["tiktok"])
    && sameSet(activeMvp.accountIds, expectedAccounts)
    && sameSet(activeMvp.metricoolBrands, expectedBrands)
    && sameSet(activeMvp.deferredLanes, ["instagram", "youtube", "streamers"])
    && activeMvp.directSocialApisRequired === false
    && operatingMode.scope === "tiktok_only_metricool_mvp"
    && sameSet(operatingMode.activePlatforms, ["tiktok"])
    && sameSet(operatingMode.deferredLanes, ["instagram", "youtube", "streamers"]);
}

function goalAuditShowsExternalWork(goalAudit) {
  const waitingMetricoolWork = Number(goalAudit.totals?.waitingMetricoolWork || 0);
  const needsExternalAction = Number(goalAudit.totals?.needsExternalAction || 0);
  return ["not_ready", "tiktok_mvp_ready_external_work_remaining"].includes(goalAudit.status)
    && waitingMetricoolWork >= 1
    && needsExternalAction >= 1;
}

function renderMarkdown(summary) {
  return [
    "# Clippers TikTok MVP Readiness Verifier",
    "",
    `Status: ${summary.status}`,
    `Launch decision: ${summary.launchDecision}`,
    `Generated: ${summary.generatedAt}`,
    "",
    "This is the hard preflight for the active MVP: TikTok only, Metricool only, approval required, no fake published counts.",
    "",
    "## Summary",
    "",
    `- Checks: ${summary.totals.checks}`,
    `- Passed: ${summary.totals.passed}`,
    `- Failed: ${summary.totals.failed}`,
    `- Active accounts: ${summary.active.accounts.join(", ")}`,
    `- Active brands: ${summary.active.metricoolBrands.join(", ")}`,
    `- Current batch: ${summary.active.currentBatchId}`,
    `- Rows: ${summary.active.totalRows}`,
    `- Ready to import: ${summary.active.readyToImport}`,
    "",
    "## Checks",
    "",
    ...summary.checks.map((row) => [
      `### ${row.label}`,
      `- Status: ${row.status}`,
      `- Evidence: ${row.evidence}`,
      `- Blocker: ${row.blocker || "none"}`,
      `- Next: ${row.nextAction}`,
      "",
    ].join("\n")),
    "## Proof Bridge Gate",
    "",
    `- Status: ${summary.proofBridgeGate.status}`,
    `- Proof links flow: ${summary.proofBridgeGate.proofLinksFlowStatus}`,
    `- Checklist steps: ${summary.proofBridgeGate.checklistSteps}`,
    `- Preview gate: ${summary.proofBridgeGate.previewGateStatus}`,
    `- Preview raw stored: ${summary.proofBridgeGate.previewRawStored ? "yes" : "no"}`,
    `- Packet: ${summary.proofBridgeGate.paths.proofLinksPastePacket || "missing"}`,
    `- Bridge CSV: ${summary.proofBridgeGate.paths.bridgeEvidenceCsv || "missing"}`,
    `- Next: ${summary.proofBridgeGate.nextStep}`,
    "",
    "## Guardrails",
    "",
    ...summary.guardrails.map((guardrail) => `- ${guardrail}`),
    "",
    "## External Work Still Required",
    "",
    ...summary.externalWorkRemaining.map((item) => `- ${item}`),
    "",
  ].join("\n");
}

function buildProofBridgeGate({ accountReadiness, tiktokExternalCloseoutSession, metricoolBridgePreviewGate }) {
  const proofLinksFlow = tiktokExternalCloseoutSession?.proofLinksFlow || {};
  const checklist = Array.isArray(proofLinksFlow.checklist) ? proofLinksFlow.checklist : [];
  const previewStatus = metricoolBridgePreviewGate?.status || "missing";
  const previewReady = previewStatus === "ready_for_import";
  const flowPrepared = proofLinksFlow.status === "needs_real_proof_links" || proofLinksFlow.status === "not_needed";
  const blockedLanes = Math.max(
    0,
    Number(accountReadiness.activeMvp?.targetLanes || 0) - Number(accountReadiness.activeMvp?.readyLanes || 0),
  );
  const status = blockedLanes > 0
    ? "blocked_needs_real_proofs"
    : previewReady
      ? "preview_gate_ready"
      : "waiting_preview_gate";
  return {
    status,
    blockedLanes,
    proofLinksFlowStatus: proofLinksFlow.status || "missing",
    checklistSteps: checklist.length,
    checklistReady: flowPrepared && checklist.length >= 8,
    previewGateStatus: previewStatus,
    previewRawStored: metricoolBridgePreviewGate?.rawStored === true,
    previewExpiresAt: metricoolBridgePreviewGate?.expiresAt || "",
    paths: {
      proofLinksPastePacket: tiktokExternalCloseoutSession?.paths?.proofLinksPastePacket || proofLinksFlow.pastePacketPath || "",
      proofLinksFilledDrop: tiktokExternalCloseoutSession?.paths?.proofLinksFilledDrop || proofLinksFlow.filledDropPath || "",
      proofLinksJsonDrop: tiktokExternalCloseoutSession?.paths?.proofLinksJsonDrop || proofLinksFlow.proofLinksJsonPath || "",
      bridgeEvidenceCsv: accountReadiness.metricoolMvpEvidence?.bridgeEvidenceCsvPath || "",
      previewGate: paths.metricoolBridgePreviewGate,
    },
    nextStep: blockedLanes > 0
      ? proofLinksFlow.nextStep || "Fill proof-links with real SPORT/memes TikTok and Metricool proof, then preview/import bridge evidence."
      : previewReady
        ? "Import bridge rows before rerunning readiness verifier; Metricool publishing must remain approval_required."
        : "Preview bridge rows to create a clean, current preview gate before import.",
  };
}

function renderCsv(summary) {
  const header = ["check_id", "label", "status", "evidence", "blocker", "next_action"];
  return [
    header.map(csvCell).join(","),
    ...summary.checks.map((row) => [
      row.id,
      row.label,
      row.status,
      row.evidence,
      row.blocker,
      row.nextAction,
    ].map(csvCell).join(",")),
  ].join("\n") + "\n";
}

function nextStepForFailedChecks(failed, accountReadiness) {
  const safetyFailure = failed.find((row) => [
    "approval_required_no_autopublish",
    "launch_control_no_fake_publish",
  ].includes(row.id));
  if (safetyFailure) return safetyFailure.nextAction;
  const activeMvp = accountReadiness.activeMvp || {};
  const readyLanes = Number(activeMvp.readyLanes || 0);
  const targetLanes = Number(activeMvp.targetLanes || 0);
  const bridgeCsvPath = accountReadiness.metricoolMvpEvidence?.bridgeEvidenceCsvPath || "";
  if (targetLanes > 0 && readyLanes < targetLanes) {
    return [
      "Preview/import real non-secret Metricool bridge evidence for SPORT and memes TikTok.",
      bridgeCsvPath ? `Use bridge CSV: ${bridgeCsvPath}.` : "",
      "Required fields: public TikTok profile URL, real HTTPS Metricool proof URL or concrete Google Drive file/folder or Docs evidence URL, and 20+ character notes. Do not paste passwords, tokens, cookies, recovery codes, or private screenshots.",
    ].filter(Boolean).join(" ");
  }
  return failed[0]?.nextAction || "Open Metricool and process metricool-batch-01; keep evidence blank until real scheduling proof exists.";
}

async function main() {
  await mkdir(reportsDir, { recursive: true });
  const [
    accountReadiness,
    approvalRun,
    approvalSession,
    operatorHandoff,
    launchControl,
    goLivePacket,
    goalAudit,
    tiktokExternalCloseoutSession,
    metricoolBridgePreviewGate,
  ] = await Promise.all([
    readJson(paths.accountReadiness),
    readJson(paths.approvalRun),
    readJson(paths.approvalSession),
    readJson(paths.operatorHandoff),
    readJson(paths.launchControl),
    readJson(paths.goLivePacket),
    readJson(paths.goalAudit),
    readJsonOptional(paths.tiktokExternalCloseoutSession, {}),
    readJsonOptional(paths.metricoolBridgePreviewGate, {}),
  ]);

  const handoffPlatforms = Array.from(new Set((operatorHandoff.batches || []).flatMap((batch) => batch.platforms || []))).sort();
  const handoffAccounts = Array.from(new Set((operatorHandoff.batches || []).flatMap((batch) => batch.accounts || []))).sort();
  const activeAccounts = (goLivePacket.operatingMode?.activeAccounts || []).map((account) => account.accountId).sort();
  const activeBrands = (goLivePacket.operatingMode?.activeMetricoolBrands || []).slice().sort();
  const currentSourceGate = operatorHandoff.operatorConsole?.currentBatchOperatorSession?.sourceGateTotals || {};
  const currentBatchId = operatorHandoff.operatorConsole?.currentBatchId || launchControl.currentBatch?.id || "";
  const proofBridgeGate = buildProofBridgeGate({ accountReadiness, tiktokExternalCloseoutSession, metricoolBridgePreviewGate });

  const checks = [
    check(
      "active_scope_tiktok_only",
      "Active scope is TikTok-only",
      activeScopeIsTikTokOnly(accountReadiness, goLivePacket),
      `activeMvp=${accountReadiness.activeMvp?.status}; scope=${accountReadiness.activeMvp?.scope}; platforms=${(accountReadiness.activeMvp?.platforms || []).join("|")}; accounts=${(accountReadiness.activeMvp?.accountIds || []).join("|")}; brands=${(accountReadiness.activeMvp?.metricoolBrands || []).join("|")}; deferred=${(accountReadiness.activeMvp?.deferredLanes || []).join("|")}; directSocialApisRequired=${accountReadiness.activeMvp?.directSocialApisRequired}`,
      "active_scope_not_tiktok_only",
      "Keep only SPORT and memes TikTok in the MVP and defer Instagram, YouTube, and streamers.",
    ),
    check(
      "metricool_brands_ready",
      "Metricool brands are SPORT and memes",
      sameSet(activeAccounts, expectedAccounts) && sameSet(activeBrands, expectedBrands) && Number(accountReadiness.activeMvp?.readyLanes || 0) === 2,
      `accounts=${activeAccounts.join("|")}; brands=${activeBrands.join("|")}; readyLanes=${accountReadiness.activeMvp?.readyLanes || 0}`,
      "metricool_brand_or_account_mismatch",
      "Connect/fix only the SPORT and memes TikTok Metricool lanes before running this MVP.",
    ),
    check(
      "approval_required_no_autopublish",
      "Metricool is approval_required with no autopublish",
      approvalRun.mode === "metricool_approval_required_100"
        && approvalRun.approvalRequired === true
        && goLivePacket.operatingMode?.metricoolApprovalRequired === true
        && approvalRun.realPublishEnabled === false
        && approvalRun.directSocialApisRequired === false
        && Number(approvalRun.totals?.readyToSend || 0) === 0
        && goLivePacket.realPublishEnabled === false
        && goLivePacket.directSocialApisRequired === false,
      `mode=${approvalRun.mode}; approvalRequired=${approvalRun.approvalRequired}; packetApprovalRequired=${goLivePacket.operatingMode?.metricoolApprovalRequired}; realPublishEnabled=${approvalRun.realPublishEnabled}; readyToSend=${approvalRun.totals?.readyToSend || 0}; directSocialApisRequired=${approvalRun.directSocialApisRequired}`,
      "metricool_not_approval_required_or_autopublish_enabled",
      "Disable real publishing and keep Metricool in approval_required mode.",
    ),
    check(
      "one_hundred_tiktok_rows",
      "100 queued rows are TikTok-only",
      Number(approvalRun.totals?.metricoolQueuedForApproval || 0) === 100
        && Number(approvalSession.totals?.tiktok || 0) === 100
        && Number(approvalSession.totals?.instagram || 0) === 0
        && Number(approvalSession.totals?.youtube || 0) === 0
        && Number(approvalSession.totals?.blocked || 0) === 0,
      `queued=${approvalRun.totals?.metricoolQueuedForApproval || 0}; session tiktok=${approvalSession.totals?.tiktok || 0}, instagram=${approvalSession.totals?.instagram || 0}, youtube=${approvalSession.totals?.youtube || 0}, blocked=${approvalSession.totals?.blocked || 0}`,
      "queue_not_strict_tiktok_100",
      "Regenerate the Metricool 100 approval run with only TikTok-ready accounts.",
    ),
    check(
      "operator_handoff_batches_ready",
      "All 10 Metricool batches are ready for operator review",
      operatorHandoff.status === "ready_for_operator"
        && Number(operatorHandoff.totals?.rows || 0) === 100
        && (operatorHandoff.batches || []).length === 10
        && (operatorHandoff.batches || []).every((batch) => batch.status === "ready_for_metricool_review")
        && sameSet(handoffPlatforms, ["tiktok"])
        && sameSet(handoffAccounts, expectedAccounts),
      `status=${operatorHandoff.status}; rows=${operatorHandoff.totals?.rows || 0}; batches=${(operatorHandoff.batches || []).length}; platforms=${handoffPlatforms.join("|")}; accounts=${handoffAccounts.join("|")}`,
      "operator_handoff_not_ready",
      "Refresh/fix the Metricool operator handoff before opening Metricool.",
    ),
    check(
      "current_batch_sources_ready",
      "Current batch source files are ready",
      currentBatchId === "metricool-batch-01"
        && Number(currentSourceGate.rows || 0) === 10
        && Number(currentSourceGate.ready || 0) === 10
        && Number(currentSourceGate.blocked || 0) === 0
        && Number(currentSourceGate.pending || 0) === 0,
      `currentBatch=${currentBatchId}; sourceGate=${currentSourceGate.ready || 0}/${currentSourceGate.rows || 0}; blocked=${currentSourceGate.blocked || 0}; pending=${currentSourceGate.pending || 0}`,
      "current_batch_source_gate_not_ready",
      "Fix source files for metricool-batch-01 before scheduling anything.",
    ),
    check(
      "launch_control_no_fake_publish",
      "Launch control has no fake published/importable rows",
      launchControl.status === "ready_for_metricool_review"
        && Number(launchControl.totals?.rows || 0) === 100
        && Number(launchControl.totals?.tiktok || 0) === 100
        && Number(launchControl.totals?.instagram || 0) === 0
        && Number(launchControl.totals?.youtube || 0) === 0
        && Number(launchControl.totals?.readyToImport || 0) === 0
        && Number(launchControl.totals?.scheduled || 0) === 0,
      `status=${launchControl.status}; rows=${launchControl.totals?.rows || 0}; readyToImport=${launchControl.totals?.readyToImport || 0}; scheduled=${launchControl.totals?.scheduled || 0}`,
      "launch_control_counts_fake_readiness",
      "Do not count any row as scheduled/published until Metricool evidence exists.",
    ),
    check(
      "goal_audit_external_work_remaining",
      "Goal audit separates ready MVP from external work",
      goalAuditShowsExternalWork(goalAudit),
      `status=${goalAudit.status}; tiktokMvpReady=${goalAudit.totals?.tiktokMvpReady || 0}; waitingMetricoolWork=${goalAudit.totals?.waitingMetricoolWork || 0}; needsExternalAction=${goalAudit.totals?.needsExternalAction || 0}`,
      "goal_audit_does_not_show_external_work",
      "Refresh goal completion audit and keep external publishing evidence separate.",
    ),
  ];

  const failed = checks.filter((row) => row.status === "fail");
  const summary = {
    status: failed.length ? "fail" : "pass",
    launchDecision: failed.length ? "blocked_before_metricool" : "ready_for_metricool_operator",
    generatedAt: new Date().toISOString(),
    scope: "tiktok_only_metricool_mvp",
    active: {
      accounts: activeAccounts,
      metricoolBrands: activeBrands,
      platforms: ["tiktok"],
      deferredLanes: ["instagram", "youtube", "streamers"],
      currentBatchId,
      totalRows: Number(approvalRun.totals?.metricoolQueuedForApproval || 0),
      readyToImport: Number(launchControl.totals?.readyToImport || 0),
      readyToSend: Number(approvalRun.totals?.readyToSend || 0),
    },
    totals: {
      checks: checks.length,
      passed: checks.filter((row) => row.status === "pass").length,
      failed: failed.length,
      metricoolQueuedForApproval: Number(approvalRun.totals?.metricoolQueuedForApproval || 0),
      currentBatchRows: Number(launchControl.currentBatch?.rows || 0),
      currentBatchSourcesReady: Number(currentSourceGate.ready || 0),
      publishedRowsCounted: Number(operatorHandoff.operatorConsole?.publishedRowsCounted || 0),
      readyToImport: Number(launchControl.totals?.readyToImport || 0),
    },
    paths: {
      json: paths.outJson,
      markdown: paths.outMarkdown,
      csv: paths.outCsv,
      operatorHandoff: paths.operatorHandoff,
      currentBatchWorkbook: operatorHandoff.operatorConsole?.paths?.currentBatchJson || "",
      currentBatchCsv: operatorHandoff.operatorConsole?.paths?.currentBatchCsv || "",
      currentBatchEvidenceCsv: operatorHandoff.operatorConsole?.paths?.currentBatchEvidenceCsv || "",
      masterEvidenceCsv: operatorHandoff.operatorConsole?.paths?.evidenceCsv || "",
      tiktokExternalCloseoutSession: paths.tiktokExternalCloseoutSession,
      metricoolBridgePreviewGate: paths.metricoolBridgePreviewGate,
    },
    checks,
    proofBridgeGate,
    guardrails: [
      "Only SPORT and memes TikTok are active for the MVP.",
      "Instagram, YouTube, streamers, and direct social APIs remain deferred.",
      "Metricool stays approval_required; realPublishEnabled must remain false.",
      "Ready for Metricool operator is not ready to publish and not counted as published.",
      "Published/importable requires a public TikTok URL and real 24h metrics.",
    ],
    externalWorkRemaining: [
      accountReadiness.metricoolMvpEvidence?.bridgeEvidenceCsvPath
        ? `If lanes are blocked, preview/import bridge evidence from ${accountReadiness.metricoolMvpEvidence.bridgeEvidenceCsvPath}.`
        : "If lanes are blocked, preview/import SPORT and memes TikTok bridge evidence first.",
      "Open Metricool and process metricool-batch-01 manually only after SPORT and memes TikTok lanes are ready.",
      "Fill the current batch evidence CSV only after Metricool scheduling/review.",
      "Add public TikTok URLs only after posts are live.",
      "Add 24h metrics only after the real 24h window.",
    ],
    nextStep: failed.length
      ? nextStepForFailedChecks(failed, accountReadiness)
      : "Open Metricool and process metricool-batch-01; keep evidence blank until real scheduling proof exists.",
  };

  await writeFile(paths.outJson, JSON.stringify(summary, null, 2));
  await writeFile(paths.outMarkdown, renderMarkdown(summary));
  await writeFile(paths.outCsv, renderCsv(summary));
  console.log(JSON.stringify({
    status: summary.status,
    launchDecision: summary.launchDecision,
    checks: summary.totals.checks,
    failed: summary.totals.failed,
    currentBatch: summary.active.currentBatchId,
    nextStep: summary.nextStep,
  }));
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
