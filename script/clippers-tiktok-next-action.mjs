import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const rootDir = path.join(process.cwd(), "clippers_workspace");
const scheduledDir = path.join(rootDir, "scheduled");
const reportsDir = path.join(rootDir, "reports");
const accountReadinessPath = path.join(rootDir, "account-permission-readiness.json");
const approvalRunPath = path.join(scheduledDir, "metricool-100-approval-run.json");
const uploadPackPath = path.join(reportsDir, "clippers-metricool-current-batch-upload-pack.json");
const postSchedulePath = path.join(reportsDir, "clippers-tiktok-post-schedule-verifier.json");
const closeoutPath = path.join(reportsDir, "clippers-tiktok-batch-closeout-verifier.json");
const goalAuditPath = path.join(reportsDir, "clippers-goal-completion-audit.json");
const launchControlPath = path.join(reportsDir, "clippers-tiktok-launch-control.json");
const mvpReadinessVerifierPath = path.join(reportsDir, "clippers-tiktok-mvp-readiness-verifier.json");
const externalCloseoutSessionPath = path.join(reportsDir, "clippers-tiktok-external-closeout-session.json");
const proofDoctorPath = path.join(reportsDir, "tiktok-mvp-proof-intake", "proof-doctor.json");
const proofUnblockerPath = path.join(reportsDir, "tiktok-mvp-proof-intake", "proof-unblocker.json");
const operatingRefreshPath = path.join(reportsDir, "tiktok-mvp-operating-refresh", "operating-refresh.json");
const outJsonPath = path.join(reportsDir, "clippers-tiktok-next-action.json");
const outMarkdownPath = path.join(reportsDir, "clippers-tiktok-next-action.md");
const outCsvPath = path.join(reportsDir, "clippers-tiktok-next-action.csv");

async function readJson(filePath, fallback = null) {
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

function statusFor(input) {
  const accountCloseout = input.accountReadiness?.tiktokMvpAccountCloseout;
  const accountReady = accountCloseout?.status === "ready_for_metricool_tiktok"
    && (accountCloseout?.totals?.ready || 0) === (accountCloseout?.totals?.rows || 0)
    && (accountCloseout?.totals?.rows || 0) > 0;
  if (!accountReady) return "blocked_account_or_metricool_connection";
  const proofGate = proofGateFor(input.operatingRefresh || {});
  if (!isProofGateReady(proofGate)) return "blocked_account_or_metricool_connection";
  if (input.closeout?.status === "blocked_evidence_fix") return "blocked_evidence_fix";
  if (input.closeout?.status === "ready_to_close_batch") return "ready_for_import_preview";
  if ((input.closeout?.totals?.waitingMetrics || 0) > 0) return "waiting_24h_metrics";
  if ((input.closeout?.totals?.scheduled || 0) > 0) return "waiting_public_posts";
  if (input.uploadPack?.status === "ready_for_metricool_upload"
    && (input.uploadPack?.totals?.copied || 0) === (input.uploadPack?.totals?.rows || 0)
    && (input.uploadPack?.totals?.rows || 0) > 0
    && input.closeout?.status === "blocked_not_scheduled") {
    return "ready_for_metricool_scheduling";
  }
  if ((input.uploadPack?.totals?.rows || 0) <= 0 || blockedUploadFilesFor(input.uploadPack) > 0) {
    return "blocked_upload_pack";
  }
  return "in_progress";
}

function blockedUploadFilesFor(uploadPack = {}) {
  if (Array.isArray(uploadPack.rows) && uploadPack.rows.length > 0) {
    return uploadPack.rows.filter((row) => row.status === "blocked_source_file").length;
  }
  return Number(uploadPack.totals?.blockedUploadFiles ?? uploadPack.totals?.blocked ?? 0);
}

function nextStepFor(summary) {
  if (summary.operatorGate?.actionAllowed === false
    && ["ready_for_metricool_scheduling", "ready_for_import_preview"].includes(summary.status)) {
    return `Do not open Metricool scheduling for this batch yet. Clear blocked gates first: ${summary.operatorGate.blockedBy.join(", ")}.`;
  }
  if (summary.status === "blocked_account_or_metricool_connection") {
    if (summary.proofGate?.status && !isProofGateReady(summary.proofGate)) {
      return [
        summary.proofGate.nextStep || "Fill SPORT and memes proof links with real non-secret Metricool or concrete Drive file/folder/Docs evidence, preview links, then save only if the preview is clean.",
        summary.proofGate.paths?.oneScreenGuide ? `One-screen guide: ${summary.proofGate.paths.oneScreenGuide}.` : "",
        summary.proofGate.paths?.proofLinksJson ? `Proof JSON: ${summary.proofGate.paths.proofLinksJson}.` : "",
        summary.proofGate.fastPathAvailable ? "Fast path: paste one real Metricool URL or concrete Drive file/folder/Docs proof URL for SPORT and one for memes; the app builds explicit proof fields before preview." : "",
        "Do not use direct social APIs for this TikTok MVP; Metricool proof only needs safe public/non-secret evidence.",
      ].filter(Boolean).join(" ");
    }
    if (summary.proofBridgeGate?.nextStep) {
      return [
        summary.proofBridgeGate.nextStep,
        summary.proofBridgeGate.paths?.bridgeEvidenceCsv
          ? `Bridge CSV: ${summary.proofBridgeGate.paths.bridgeEvidenceCsv}.`
          : "",
        "Do not use direct social APIs for this TikTok MVP; Metricool proof only needs safe public/non-secret evidence.",
      ].filter(Boolean).join(" ");
    }
    const blockedRows = (summary.account.rows || []).filter((row) => row.status !== "ready_for_metricool_tiktok");
    const blockedLabels = blockedRows.map((row) => `${row.accountId || "unknown"}:${row.platform || "tiktok"}=${row.status || "blocked"}`).join(", ");
    return [
      "Record non-secret Metricool bridge evidence for SPORT and memes TikTok before scheduling clips.",
      blockedLabels ? `Blocked lanes: ${blockedLabels}.` : "",
      "Use the Metricool bridge evidence batch panel with public TikTok profile URL, real https Metricool proof URL or concrete Google Drive file/folder or Docs evidence URL, and 20+ character notes; do not paste passwords, tokens, cookies, recovery codes, or private screenshots.",
    ].filter(Boolean).join(" ");
  }
  if (summary.status === "blocked_evidence_fix") {
    return "Fix rejected or invalid Metricool evidence rows before moving this TikTok batch forward.";
  }
  if (summary.status === "ready_for_import_preview") {
    return "Run the Metricool evidence preview/import review only after confirming every row has real public TikTok URLs and nonzero 24h metrics.";
  }
  if (summary.status === "waiting_24h_metrics") {
    return "Add real 24h metrics for live TikTok posts; do not count views before metrics are captured.";
  }
  if (summary.status === "waiting_public_posts") {
    return "Wait for the scheduled Metricool posts to become public, then paste exact TikTok video URLs.";
  }
  if (summary.status === "ready_for_metricool_scheduling") {
    return "Open the current batch upload pack and schedule every row in Metricool approval_required mode.";
  }
  if (summary.status === "blocked_upload_pack") {
    return "Regenerate the current batch upload pack and fix missing local source files before opening Metricool.";
  }
  return "Refresh TikTok MVP Now and follow the first blocked checklist item.";
}

function taskRowsFor(summary) {
  const rows = [
    {
      id: "account_connection",
      label: "TikTok accounts connected in Metricool",
      status: summary.account.ready ? "done" : "blocked",
      evidence: `${summary.account.readyLanes}/${summary.account.totalLanes} TikTok MVP lanes ready`,
      nextAction: summary.account.ready
        ? "Use SPORT and memes TikTok lanes only."
        : "Import Metricool bridge evidence rows for SPORT/memes TikTok with public profile URL, real https Metricool proof URL or concrete Google Drive file/folder or Docs evidence URL, and safe notes.",
    },
    {
      id: "upload_pack",
      label: "Current batch source files staged",
      status: summary.uploadPack.ready ? "done" : "blocked",
      evidence: `${summary.uploadPack.copied}/${summary.uploadPack.rows} MP4 files staged`,
      nextAction: summary.uploadPack.ready ? "Use the upload pack files in Metricool." : "Regenerate/fix upload pack before scheduling.",
    },
    {
      id: "metricool_schedule",
      label: "Schedule current batch in Metricool",
      status: summary.operatorGate?.actionAllowed === false && summary.batch.notStarted > 0 ? "blocked" : summary.batch.notStarted > 0 ? "next" : "done",
      evidence: `${summary.batch.scheduled}/${summary.batch.rows} scheduled; ${summary.batch.notStarted} not started`,
      nextAction: summary.operatorGate?.actionAllowed === false && summary.batch.notStarted > 0
        ? `Clear operator gate blockers first: ${summary.operatorGate.blockedBy.join(", ")}.`
        : summary.batch.notStarted > 0 ? "Schedule every row and record scheduled evidence." : "Wait for public TikTok URLs.",
    },
    {
      id: "public_urls",
      label: "Capture exact public TikTok video URLs",
      status: summary.batch.waitingPublicPosts > 0 ? "next" : summary.batch.readyToImport > 0 ? "done" : "blocked",
      evidence: `${summary.batch.readyToImport}/${summary.batch.rows} ready for import review`,
      nextAction: summary.batch.waitingPublicPosts > 0 ? "Paste exact public TikTok video URLs after posts are live." : "Do not use search/profile/shortlink URLs.",
    },
    {
      id: "metrics_24h",
      label: "Capture 24h metrics",
      status: summary.batch.waitingMetrics > 0 ? "next" : summary.batch.readyToImport === summary.batch.rows && summary.batch.rows > 0 ? "done" : "blocked",
      evidence: `${summary.batch.waitingMetrics} waiting metrics`,
      nextAction: "Use real nonzero views/likes/comments/shares before import.",
    },
  ];
  if (summary.proofBridgeGate?.status) {
    rows.splice(1, 0, {
      id: "proof_bridge",
      label: "Metricool proof bridge",
      status: summary.proofBridgeGate.blockedLanes > 0 ? "blocked" : "next",
      evidence: `${summary.proofBridgeGate.blockedLanes} blocked lanes; preview ${summary.proofBridgeGate.previewGateStatus || "missing"}`,
      nextAction: summary.proofBridgeGate.nextStep || "Fill and preview real non-secret Metricool bridge proof before scheduling.",
    });
  }
  if (summary.proofGate?.status) {
    rows.splice(1, 0, {
      id: "proof_gate",
      label: "TikTok Metricool proof gate",
      status: isProofGateReady(summary.proofGate) ? "done" : "blocked",
      evidence: `${summary.proofGate.minimumProofUrlsNeeded} proof URLs needed; ${summary.proofGate.blockedBy.length} blockers`,
      nextAction: summary.proofGate.nextStep || "Fill SPORT and memes proof links with real non-secret Metricool or concrete Drive file/folder/Docs evidence.",
    });
  }
  if ((summary.externalCloseout?.activeTasks || 0) > 0) {
    rows.splice(2, 0, {
      id: "external_closeout_proofs",
      label: "External proof closeout",
      status: "blocked",
      evidence: `${summary.externalCloseout.activeTasks} active blockers; ${summary.externalCloseout.deferredTasks} deferred`,
      nextAction: summary.externalCloseout.nextStep || "Record real non-secret account and Metricool proof before scheduling.",
    });
  }
  if ((summary.proofDoctor?.fixQueue || 0) > 0) {
    rows.splice(3, 0, {
      id: "proof_doctor_fix_queue",
      label: "Proof doctor fixes",
      status: "blocked",
      evidence: `${summary.proofDoctor.ready}/${summary.proofDoctor.lanes} lanes ready; ${summary.proofDoctor.fixQueue} fixes`,
      nextAction: summary.proofDoctor.nextStep || "Fix proof doctor queue before scheduling in Metricool.",
    });
  }
  if ((summary.proofUnblocker?.openFixes || 0) > 0) {
    rows.splice(4, 0, {
      id: "proof_unblocker_packet",
      label: "Proof unblocker packet",
      status: "blocked",
      evidence: `${summary.proofUnblocker.openFixes} open fixes; ${summary.proofUnblocker.readyLanes}/${summary.proofUnblocker.targetLanes} lanes ready`,
      nextAction: summary.proofUnblocker.nextStep || "Complete the proof unblocker CSV/HTML before scheduling.",
    });
  }
  return rows;
}

function externalCloseoutFor(session = {}) {
  const activeTasks = Array.isArray(session.activeTasks) ? session.activeTasks : [];
  const deferredTasks = Array.isArray(session.deferredTasks) ? session.deferredTasks : [];
  const firstActiveTask = activeTasks[0] || null;
  return {
    status: session.status || "missing",
    activeTasks: Number(session.totals?.activeTasks ?? activeTasks.length ?? 0),
    deferredTasks: Number(session.totals?.deferredTasks ?? deferredTasks.length ?? 0),
    firstActiveTask: firstActiveTask ? {
      id: firstActiveTask.closeoutId || "",
      lane: firstActiveTask.lane || "",
      accountId: firstActiveTask.accountId || "",
      proofType: firstActiveTask.proofType || "",
      portalUrl: firstActiveTask.portalUrl || "",
      proofPath: firstActiveTask.proofPath || "",
      nextAction: firstActiveTask.nextAction || "",
    } : null,
    activeTaskIds: activeTasks.slice(0, 6).map((task) => task.closeoutId || task.id || "").filter(Boolean),
    deferredTaskIds: deferredTasks.slice(0, 6).map((task) => task.closeoutId || task.id || "").filter(Boolean),
    proofLinksFlowStatus: session.proofLinksFlow?.status || "missing",
    proofLinksPacket: session.paths?.proofLinksPastePacket || session.proofLinksFlow?.pastePacketPath || "",
    nextStep: session.nextStep || firstActiveTask?.nextAction || "",
  };
}

function proofDoctorFor(report = {}) {
  const fixQueue = Array.isArray(report.fixQueue) ? report.fixQueue : [];
  const firstFix = fixQueue[0] || null;
  return {
    status: report.status || "missing",
    lanes: Number(report.totals?.lanes || 0),
    ready: Number(report.totals?.ready || 0),
    blocked: Number(report.totals?.blocked || 0),
    rejected: Number(report.totals?.rejected || 0),
    fixQueue: Number(report.totals?.fixQueue ?? fixQueue.length ?? 0),
    firstFix: firstFix ? {
      lane: firstFix.lane || "",
      source: firstFix.source || "",
      filePath: firstFix.filePath || "",
      row: firstFix.row || "",
      column: firstFix.column || "",
      requiredValue: firstFix.requiredValue || "",
      nextAction: firstFix.nextAction || "",
    } : null,
    paths: {
      markdown: report.paths?.markdown || "",
      fixQueueCsv: report.paths?.fixQueueCsv || "",
      accountCsv: report.paths?.accountCsv || "",
      bridgeCsv: report.paths?.bridgeCsv || "",
      proofLinksFilledDrop: report.paths?.proofLinksFilledDrop || "",
    },
    nextStep: report.nextStep || "",
  };
}

function proofUnblockerFor(report = {}) {
  const fixes = Array.isArray(report.fixes) ? report.fixes : [];
  const firstFix = fixes[0] || null;
  return {
    status: report.status || "missing",
    readyLanes: Number(report.readyLanes || 0),
    targetLanes: Number(report.targetLanes || 0),
    openFixes: Number(report.totals?.openFixes ?? fixes.length ?? 0),
    importFixes: Number(report.totals?.importFixes || 0),
    doctorFixes: Number(report.totals?.doctorFixes || 0),
    firstFix: firstFix ? {
      lane: firstFix.lane || "",
      accountName: firstFix.accountName || "",
      handle: firstFix.handle || "",
      metricoolBrandName: firstFix.metricoolBrandName || "",
      field: firstFix.field || "",
      requiredValue: firstFix.requiredValue || "",
      reason: firstFix.reason || "",
      nextAction: firstFix.nextAction || "",
    } : null,
    paths: {
      html: report.paths?.html || "",
      csv: report.paths?.csv || "",
      combinedCsv: report.paths?.combinedCsv || "",
      importFixQueueCsv: report.paths?.importFixQueueCsv || "",
      doctorFixQueueCsv: report.paths?.doctorFixQueueCsv || "",
    },
    nextStep: report.nextStep || "",
  };
}

function operatingRefreshFor(report = {}) {
  return {
    status: report.status || "missing",
    launchDecision: report.launchDecision || "missing",
    sourceCandidates: Number(report.totals?.sourceCandidates || 0),
    exactUrls: Number(report.totals?.sourceCandidatesExactUrls || 0),
    weeklyTargetClips: Number(report.totals?.weeklyTargetClips || 0),
    sourceReadyAssets: Number(report.totals?.weeklySourceReadyAssets || 0),
    metricoolApprovalQueued: Number(report.totals?.weeklyMetricoolApprovalQueued || 0),
    minimumProofUrlsNeeded: Number(report.totals?.minimumProofUrlsNeeded || 0),
    externalActionsRequired: Number(report.totals?.externalActionsRequired || 0),
    blockers: Array.isArray(report.blockers) ? report.blockers.slice(0, 6) : [],
    nextStep: report.nextStep || "",
    paths: {
      json: report.paths?.json || operatingRefreshPath,
      markdown: report.paths?.markdown || "",
      sourceScout: report.paths?.sourceScout || "",
      weeklyFunnel: report.paths?.weeklyFunnel || "",
      boundary: report.paths?.boundary || "",
    },
  };
}

function proofGateFor(report = {}) {
  const gate = report.proofGate || {};
  const controlFieldsPresent = [
    "status",
    "requiredLanes",
    "minimumProofUrlsNeeded",
    "failedPreflightChecks",
    "failedVerifierChecks",
    "missingRequiredReports",
    "boundaryNotReady",
    "blockedBy",
    "preflightNotReady",
  ].every((field) => Object.hasOwn(gate, field))
    && Array.isArray(gate.requiredLanes)
    && typeof gate.minimumProofUrlsNeeded === "number"
    && Array.isArray(gate.failedPreflightChecks)
    && Array.isArray(gate.failedVerifierChecks)
    && Array.isArray(gate.missingRequiredReports)
    && Array.isArray(gate.boundaryNotReady)
    && Array.isArray(gate.blockedBy);
  return {
    status: gate.status || "missing",
    controlFieldsPresent,
    requiredLanes: Array.isArray(gate.requiredLanes) ? gate.requiredLanes : [],
    minimumProofUrlsNeeded: Number(gate.minimumProofUrlsNeeded || 0),
    proofPacketsNeeded: Number(gate.proofPacketsNeeded || 0),
    fastPathAvailable: Boolean(gate.fastPathAvailable),
    nextSafeButton: gate.nextSafeButton || "",
    nextLockedButton: gate.nextLockedButton || "",
    failedPreflightChecks: Array.isArray(gate.failedPreflightChecks) ? gate.failedPreflightChecks : [],
    failedVerifierChecks: Array.isArray(gate.failedVerifierChecks) ? gate.failedVerifierChecks : [],
    missingRequiredReports: Array.isArray(gate.missingRequiredReports) ? gate.missingRequiredReports : [],
    boundaryNotReady: Array.isArray(gate.boundaryNotReady) ? gate.boundaryNotReady : [],
    blockedBy: Array.isArray(gate.blockedBy) ? gate.blockedBy : [],
    preflightNotReady: gate.preflightNotReady || "",
    paths: gate.paths || {},
    guardrails: Array.isArray(gate.guardrails) ? gate.guardrails : [],
    nextStep: gate.nextStep || report.nextStep || "",
  };
}

function isProofGateReady(proofGate = {}) {
  return proofGate.status === "ready_for_operator_review"
    && proofGate.controlFieldsPresent === true
    && proofGate.requiredLanes.includes("sports-daily:tiktok")
    && proofGate.requiredLanes.includes("meme-radar:tiktok")
    && proofGate.minimumProofUrlsNeeded === 0
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

function operatorGateFor(summary) {
  const safetyBlockers = [];
  if (!summary.safety.approvalRequired) safetyBlockers.push("metricool_not_approval_required");
  if (summary.safety.realPublishEnabled) safetyBlockers.push("real_publish_enabled");
  if (summary.safety.readyToSend > 0) safetyBlockers.push("ready_to_send_not_zero");
  if (summary.safety.directSocialApisRequired) safetyBlockers.push("direct_social_apis_required");
  const base = {
    mode: "metricool_approval_required",
    scope: "tiktok_only_metricool_mvp",
    approvalRequired: summary.safety.approvalRequired,
    directSocialApisRequired: summary.safety.directSocialApisRequired,
    realPublishEnabled: summary.safety.realPublishEnabled,
    readyToSend: summary.safety.readyToSend,
    accountLanesReady: `${summary.account.readyLanes}/${summary.account.totalLanes}`,
    uploadPackReady: `${summary.uploadPack.copied}/${summary.uploadPack.rows}`,
    batchId: summary.batch.id,
    scheduledIsPublished: false,
    publishedCountingRule: "Count published only after exact public TikTok URL plus real 24h metrics.",
  };
  if (summary.status === "ready_for_metricool_scheduling" && safetyBlockers.length === 0) {
    return {
      ...base,
      status: "operator_can_schedule_in_metricool_review",
      actionAllowed: true,
      allowedAction: "schedule_current_batch_in_metricool_approval_required",
      blockedBy: [],
      nextProofRequired: "Record final_status=scheduled plus the non-secret Metricool approval URL in the batch evidence CSV.",
    };
  }
  if (summary.status === "ready_for_import_preview" && safetyBlockers.length === 0) {
    return {
      ...base,
      status: "operator_can_run_import_preview_review",
      actionAllowed: true,
      allowedAction: "preview_public_tiktok_urls_and_24h_metrics",
      blockedBy: [],
      nextProofRequired: "Verify exact public TikTok URLs and nonzero 24h metrics before import review.",
    };
  }
  const blockedBy = [];
  if (!isProofGateReady(summary.proofGate)) blockedBy.push("tiktok_metricool_proof_gate");
  if (!summary.account.ready) blockedBy.push("account_or_metricool_bridge_evidence");
  if (summary.uploadPack.blockedUploadFiles > 0 || summary.uploadPack.copied < summary.uploadPack.rows) {
    blockedBy.push("upload_pack_or_source_files");
  }
  if (summary.batch.waitingPublicPosts > 0) blockedBy.push("public_tiktok_urls");
  if (summary.batch.waitingMetrics > 0) blockedBy.push("24h_metrics");
  if (summary.batch.needsFix > 0 || summary.status === "blocked_evidence_fix") blockedBy.push("evidence_rows_need_fix");
  blockedBy.push(...safetyBlockers);
  return {
    ...base,
    status: "operator_blocked",
    actionAllowed: false,
    allowedAction: "none",
    blockedBy: blockedBy.length ? Array.from(new Set(blockedBy)) : [summary.status],
    nextProofRequired: "Clear the blocked gate before opening Metricool operator work.",
  };
}

function operatorPacketFor(summary) {
  const actionAllowed = summary.operatorGate?.actionAllowed === true;
  const actionLines = actionAllowed ? [
    "1. Open the upload HTML and Metricool in the browser.",
    "2. Upload/schedule each row in rank order using only SPORT and memes TikTok profiles.",
    "3. Record Metricool approval URL and final_status=scheduled in the batch evidence CSV.",
    "4. After posts are public, add exact TikTok video URLs, wait 24h, then add real metrics.",
  ] : [
    "1. Do not open Metricool scheduling for this batch yet.",
    `2. Clear blocked gates first: ${(summary.operatorGate?.blockedBy || ["unknown"]).join(", ")}.`,
    "3. Regenerate this next-action packet after the blockers are cleared.",
  ];
  const lines = [
    "TikTok Metricool operator packet",
    `Batch: ${summary.batch.id}`,
    `Status: ${summary.status}`,
    `Operator gate: ${summary.operatorGate?.status || "missing"}`,
    `Allowed action: ${summary.operatorGate?.allowedAction || "none"}`,
    `Upload HTML: ${summary.operator.uploadHtml || "missing"}`,
    `Upload folder: ${summary.operator.uploadDir || "missing"}`,
    `Workbook: ${summary.operator.workbook || "missing"}`,
    `Evidence CSV: ${summary.operator.batchEvidenceCsv || "missing"}`,
    `Rows: ${summary.batch.rows}`,
    `Scheduled: ${summary.batch.scheduled}`,
    `Not started: ${summary.batch.notStarted}`,
    `Ready to import review: ${summary.batch.readyToImport}`,
    summary.proofBridgeGate?.status ? `Proof bridge gate: ${summary.proofBridgeGate.status}` : "",
    summary.proofGate?.status ? `Operating proof gate: ${summary.proofGate.status}` : "",
    summary.proofGate?.minimumProofUrlsNeeded ? `Proof URLs needed: ${summary.proofGate.minimumProofUrlsNeeded}` : "",
    summary.proofGate?.paths?.oneScreenGuide ? `One-screen proof guide: ${summary.proofGate.paths.oneScreenGuide}` : "",
    summary.proofGate?.fastPathAvailable ? "Fast path: paste SPORT + memes Metricool URLs or concrete Drive file/folder/Docs proof URLs in the two input boxes; preview links first, then save only if the preview is clean." : "",
    summary.proofBridgeGate?.paths?.proofLinksPastePacket ? `Proof links packet: ${summary.proofBridgeGate.paths.proofLinksPastePacket}` : "",
    summary.proofBridgeGate?.paths?.bridgeEvidenceCsv ? `Bridge CSV: ${summary.proofBridgeGate.paths.bridgeEvidenceCsv}` : "",
    summary.operatingRefresh?.status ? `Operating refresh: ${summary.operatingRefresh.status}` : "",
    summary.operatingRefresh?.minimumProofUrlsNeeded ? `Proof URLs needed: ${summary.operatingRefresh.minimumProofUrlsNeeded}` : "",
    summary.externalCloseout?.status ? `External closeout: ${summary.externalCloseout.status}` : "",
    summary.externalCloseout?.firstActiveTask?.id ? `First external blocker: ${summary.externalCloseout.firstActiveTask.id}` : "",
    "",
    "Next steps:",
    ...actionLines,
    "",
    "Guardrails:",
    "Do not mark published without a real public TikTok video URL.",
    "Do not paste profile/search/shortlink URLs.",
    "Do not store passwords, cookies, tokens, client secrets, or private screenshots.",
    "For account blockers, use Metricool bridge evidence rows; direct social API keys are not required for this TikTok MVP.",
    "Metricool remains approval_required; this packet does not publish automatically.",
  ];
  return lines.join("\n");
}

function renderMarkdown(summary) {
  const proofGateLines = summary.proofGate?.status && summary.proofGate.status !== "missing" ? [
    "## Operating Proof Gate",
    "",
    `- Status: ${summary.proofGate.status}`,
    `- Control fields present: ${summary.proofGate.controlFieldsPresent}`,
    `- Required lanes: ${summary.proofGate.requiredLanes.join(", ") || "missing"}`,
    `- Minimum proof URLs needed: ${summary.proofGate.minimumProofUrlsNeeded}`,
    `- Fast path available: ${summary.proofGate.fastPathAvailable}`,
    `- Next safe button: ${summary.proofGate.nextSafeButton || "missing"}`,
    `- Next locked button: ${summary.proofGate.nextLockedButton || "missing"}`,
    `- Proof JSON: ${summary.proofGate.paths?.proofLinksJson || "missing"}`,
    `- One-screen guide: ${summary.proofGate.paths?.oneScreenGuide || "missing"}`,
    `- Paste packet: ${summary.proofGate.paths?.pastePacket || "missing"}`,
    `- Next step: ${summary.proofGate.nextStep || "missing"}`,
    ...(summary.proofGate.blockedBy || []).map((blocker) => `- Blocker: ${blocker}`),
    "",
  ] : [];
  const proofBridgeLines = summary.proofBridgeGate ? [
    "## Metricool Proof Bridge",
    "",
    `- Status: ${summary.proofBridgeGate.status}`,
    `- Blocked lanes: ${summary.proofBridgeGate.blockedLanes}`,
    `- Proof links flow: ${summary.proofBridgeGate.proofLinksFlowStatus || "missing"}`,
    `- Preview gate: ${summary.proofBridgeGate.previewGateStatus || "missing"}`,
    `- Proof links packet: ${summary.proofBridgeGate.paths?.proofLinksPastePacket || "missing"}`,
    `- Filled proof drop: ${summary.proofBridgeGate.paths?.proofLinksFilledDrop || "missing"}`,
    `- Bridge CSV: ${summary.proofBridgeGate.paths?.bridgeEvidenceCsv || "missing"}`,
    `- Next step: ${summary.proofBridgeGate.nextStep || "missing"}`,
    "",
    "### Proof Links Checklist",
    "",
    ...(summary.proofLinksChecklist || []).map((step) => `- ${step.label || step.id}: ${step.nextButton || step.expectedGate || "manual"}`),
    "",
  ] : [];
  const externalCloseoutLines = summary.externalCloseout?.status ? [
    "## External Proof Closeout",
    "",
    `- Status: ${summary.externalCloseout.status}`,
    `- Active blockers: ${summary.externalCloseout.activeTasks}`,
    `- Deferred blockers: ${summary.externalCloseout.deferredTasks}`,
    `- Proof links flow: ${summary.externalCloseout.proofLinksFlowStatus}`,
    `- First active task: ${summary.externalCloseout.firstActiveTask?.id || "none"}`,
    `- Next step: ${summary.externalCloseout.nextStep || "missing"}`,
    ...(summary.externalCloseout.activeTaskIds || []).map((id) => `- Active: ${id}`),
    ...(summary.externalCloseout.deferredTaskIds || []).map((id) => `- Deferred: ${id}`),
    "",
  ] : [];
  const proofDoctorLines = summary.proofDoctor?.status ? [
    "## Proof Doctor",
    "",
    `- Status: ${summary.proofDoctor.status}`,
    `- Ready lanes: ${summary.proofDoctor.ready}/${summary.proofDoctor.lanes}`,
    `- Fix queue: ${summary.proofDoctor.fixQueue}`,
    `- First fix: ${summary.proofDoctor.firstFix ? `${summary.proofDoctor.firstFix.lane} ${summary.proofDoctor.firstFix.source}` : "none"}`,
    `- Fix queue CSV: ${summary.proofDoctor.paths.fixQueueCsv || "missing"}`,
    `- Next step: ${summary.proofDoctor.nextStep || "missing"}`,
    "",
  ] : [];
  const proofUnblockerLines = summary.proofUnblocker?.status ? [
    "## Proof Unblocker",
    "",
    `- Status: ${summary.proofUnblocker.status}`,
    `- Ready lanes: ${summary.proofUnblocker.readyLanes}/${summary.proofUnblocker.targetLanes}`,
    `- Open fixes: ${summary.proofUnblocker.openFixes}`,
    `- First fix: ${summary.proofUnblocker.firstFix ? `${summary.proofUnblocker.firstFix.lane} ${summary.proofUnblocker.firstFix.field}` : "none"}`,
    `- HTML: ${summary.proofUnblocker.paths.html || "missing"}`,
    `- CSV: ${summary.proofUnblocker.paths.csv || "missing"}`,
    `- Combined CSV: ${summary.proofUnblocker.paths.combinedCsv || "missing"}`,
    `- Next step: ${summary.proofUnblocker.nextStep || "missing"}`,
    "",
  ] : [];
  const operatingRefreshLines = summary.operatingRefresh?.status && summary.operatingRefresh.status !== "missing" ? [
    "## Operating Refresh",
    "",
    `- Status: ${summary.operatingRefresh.status}`,
    `- Launch decision: ${summary.operatingRefresh.launchDecision}`,
    `- Source candidates: ${summary.operatingRefresh.sourceCandidates}`,
    `- Exact URLs: ${summary.operatingRefresh.exactUrls}`,
    `- Source-ready assets: ${summary.operatingRefresh.sourceReadyAssets}/${summary.operatingRefresh.weeklyTargetClips}`,
    `- Metricool approval queue: ${summary.operatingRefresh.metricoolApprovalQueued}`,
    `- Minimum proof URLs needed: ${summary.operatingRefresh.minimumProofUrlsNeeded}`,
    `- External actions: ${summary.operatingRefresh.externalActionsRequired}`,
    `- Report: ${summary.operatingRefresh.paths.markdown || summary.operatingRefresh.paths.json}`,
    `- Next step: ${summary.operatingRefresh.nextStep || "missing"}`,
    ...(summary.operatingRefresh.blockers || []).map((blocker) => `- Blocker: ${blocker}`),
    "",
  ] : [];
  return [
    "# TikTok Metricool Next Action",
    "",
    `Generated: ${summary.generatedAt}`,
    `Status: ${summary.status}`,
    `Batch: ${summary.batch.id}`,
    `Next batch: ${summary.batch.nextBatchId || "none"}`,
    "",
    summary.nextStep,
    "",
    "## Snapshot",
    "",
    `- Account lanes ready: ${summary.account.readyLanes}/${summary.account.totalLanes}`,
    `- Upload pack: ${summary.uploadPack.copied}/${summary.uploadPack.rows}`,
    `- Scheduled: ${summary.batch.scheduled}/${summary.batch.rows}`,
    `- Ready to import review: ${summary.batch.readyToImport}/${summary.batch.rows}`,
    `- Goal audit: ${summary.goalAudit.status}`,
    `- Operator gate: ${summary.operatorGate.status}`,
    `- Allowed action: ${summary.operatorGate.allowedAction}`,
    `- Blocked by: ${summary.operatorGate.blockedBy.join(", ") || "none"}`,
    `- Upload HTML: ${summary.operator.uploadHtml || "missing"}`,
    `- Batch evidence CSV: ${summary.operator.batchEvidenceCsv || "missing"}`,
    "",
    "## Tasks",
    "",
    ...summary.tasks.map((task) => [
      `### ${task.label}`,
      `- Status: ${task.status}`,
      `- Evidence: ${task.evidence}`,
      `- Next action: ${task.nextAction}`,
      "",
    ].join("\n")),
    ...proofGateLines,
    ...proofBridgeLines,
    ...externalCloseoutLines,
    ...proofDoctorLines,
    ...proofUnblockerLines,
    ...operatingRefreshLines,
    "## Guardrails",
    "",
    ...summary.guardrails.map((guardrail) => `- ${guardrail}`),
    "",
    "## Operator Packet",
    "",
    "```text",
    summary.operator.copyPacket,
    "```",
    "",
  ].join("\n");
}

function renderCsv(summary) {
  const header = ["task_id", "label", "status", "evidence", "next_action", "upload_html", "batch_evidence_csv"];
  return [
    header.map(csvCell).join(","),
    ...summary.tasks.map((task) => [
      task.id,
      task.label,
      task.status,
      task.evidence,
      task.nextAction,
      summary.operator.uploadHtml,
      summary.operator.batchEvidenceCsv,
    ].map(csvCell).join(",")),
  ].join("\n") + "\n";
}

async function main() {
  await mkdir(reportsDir, { recursive: true });
  const [
    accountReadiness,
    approvalRun,
    uploadPack,
    postSchedule,
    closeout,
    goalAudit,
    launchControl,
    mvpReadinessVerifier,
    externalCloseoutSession,
    proofDoctor,
    proofUnblocker,
    operatingRefresh,
  ] = await Promise.all([
    readJson(accountReadinessPath, {}),
    readJson(approvalRunPath, {}),
    readJson(uploadPackPath, {}),
    readJson(postSchedulePath, {}),
    readJson(closeoutPath, {}),
    readJson(goalAuditPath, {}),
    readJson(launchControlPath, {}),
    readJson(mvpReadinessVerifierPath, {}),
    readJson(externalCloseoutSessionPath, {}),
    readJson(proofDoctorPath, {}),
    readJson(proofUnblockerPath, {}),
    readJson(operatingRefreshPath, {}),
  ]);
  const accountCloseout = accountReadiness.tiktokMvpAccountCloseout || {};
  const accountReadyLanes = accountCloseout.totals?.ready || 0;
  const accountTotalLanes = accountCloseout.totals?.rows || 0;
  const uploadRows = uploadPack.totals?.rows || 0;
  const uploadCopied = uploadPack.totals?.copied || 0;
  const batchRows = closeout.totals?.rows || postSchedule.totals?.rows || 0;
  const summary = {
    status: "in_progress",
    generatedAt: new Date().toISOString(),
    mode: "tiktok_metricool_next_action",
    paths: {
      json: outJsonPath,
      markdown: outMarkdownPath,
      csv: outCsvPath,
      accountReadiness: accountReadinessPath,
      approvalRun: approvalRunPath,
      uploadPack: uploadPackPath,
      postScheduleVerifier: postSchedulePath,
      batchCloseout: closeoutPath,
      goalAudit: goalAuditPath,
      launchControl: launchControlPath,
      mvpReadinessVerifier: mvpReadinessVerifierPath,
      externalCloseoutSession: externalCloseoutSessionPath,
      proofDoctor: proofDoctorPath,
      proofUnblocker: proofUnblockerPath,
      operatingRefresh: operatingRefreshPath,
    },
    account: {
      ready: accountCloseout.status === "ready_for_metricool_tiktok" && accountReadyLanes === accountTotalLanes && accountTotalLanes > 0,
      status: accountCloseout.status || "missing",
      readyLanes: accountReadyLanes,
      totalLanes: accountTotalLanes,
      rows: accountCloseout.rows || [],
    },
    uploadPack: {
      ready: uploadPack.status === "ready_for_metricool_upload" && uploadRows > 0 && uploadCopied === uploadRows && blockedUploadFilesFor(uploadPack) === 0,
      status: uploadPack.status || "missing",
      rows: uploadRows,
      copied: uploadCopied,
      blockedUploadFiles: blockedUploadFilesFor(uploadPack),
      html: uploadPack.paths?.html || "",
    },
    batch: {
      id: closeout.batch?.id || postSchedule.batch?.id || "metricool-batch-01",
      nextBatchId: closeout.nextBatch?.id || "",
      rows: batchRows,
      notStarted: closeout.totals?.notStarted || postSchedule.totals?.notStarted || 0,
      scheduled: closeout.totals?.scheduled || postSchedule.totals?.scheduled || 0,
      waitingPublicPosts: postSchedule.totals?.missingPublicUrl || 0,
      waitingMetrics: closeout.totals?.waitingMetrics || postSchedule.totals?.waitingMetrics || 0,
      readyToImport: closeout.totals?.readyToImport || postSchedule.totals?.readyToImport || 0,
      needsFix: closeout.totals?.needsFix || postSchedule.totals?.needsFix || 0,
      closeoutStatus: closeout.status || "missing",
      postScheduleStatus: postSchedule.status || "missing",
    },
    goalAudit: {
      status: goalAudit.status || "missing",
      nextStep: goalAudit.nextStep || "",
    },
    safety: {
      approvalRequired: approvalRun.approvalRequired === true,
      realPublishEnabled: approvalRun.realPublishEnabled === true,
      readyToSend: Number(approvalRun.totals?.readyToSend || 0),
      directSocialApisRequired: approvalRun.directSocialApisRequired === true,
      launchReadyToImport: Number(launchControl.totals?.readyToImport || 0),
      launchStatus: launchControl.status || "missing",
      approvalRunStatus: approvalRun.status || "missing",
    },
    proofBridgeGate: mvpReadinessVerifier.proofBridgeGate || null,
    proofGate: proofGateFor(operatingRefresh),
    proofLinksChecklist: Array.isArray(externalCloseoutSession.proofLinksFlow?.checklist)
      ? externalCloseoutSession.proofLinksFlow.checklist
      : [],
    externalCloseout: externalCloseoutFor(externalCloseoutSession),
    proofDoctor: proofDoctorFor(proofDoctor),
    proofUnblocker: proofUnblockerFor(proofUnblocker),
    operatingRefresh: operatingRefreshFor(operatingRefresh),
    operator: {
      uploadHtml: uploadPack.paths?.html || "",
      uploadDir: uploadPack.paths?.uploadDir || "",
      workbook: uploadPack.paths?.workbook || "",
      batchEvidenceCsv: uploadPack.paths?.batchEvidenceCsv || "",
      uploadPackReport: uploadPack.paths?.markdown || "",
      sessionPacketReport: path.join(reportsDir, "clippers-metricool-current-batch-session-packet.md"),
      copyPacket: "",
    },
    guardrails: [
      "TikTok-only MVP: SPORT and memes through Metricool first; other networks/accounts stay deferred.",
      "Metricool remains approval_required; realPublishEnabled remains false.",
      "This next-action pack never publishes, schedules, imports, creates accounts, or stores secrets.",
      "Only exact https TikTok video URLs plus real 24h metrics can enter import review.",
    ],
  };
  summary.status = statusFor({ accountReadiness, uploadPack, postSchedule, closeout, goalAudit, operatingRefresh });
  summary.operatorGate = operatorGateFor(summary);
  summary.nextStep = nextStepFor(summary);
  summary.tasks = taskRowsFor(summary);
  summary.operator.copyPacket = operatorPacketFor(summary);
  await writeFile(outJsonPath, JSON.stringify(summary, null, 2));
  await writeFile(outMarkdownPath, renderMarkdown(summary));
  await writeFile(outCsvPath, renderCsv(summary));
  console.log(JSON.stringify({
    status: summary.status,
    batchId: summary.batch.id,
    nextBatchId: summary.batch.nextBatchId,
    nextStep: summary.nextStep,
    scheduled: summary.batch.scheduled,
    readyToImport: summary.batch.readyToImport,
    markdownPath: outMarkdownPath,
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
