import { spawnSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const rootDir = path.join(process.cwd(), "clippers_workspace");
const reportsDir = path.join(rootDir, "reports");
const accountCloseoutPath = path.join(rootDir, "tiktok-mvp-account-closeout.json");
const runbookPath = path.join(reportsDir, "clippers-tiktok-batch-runbook.json");
const trackerPath = path.join(reportsDir, "clippers-tiktok-batch-tracker.json");
const syncPath = path.join(reportsDir, "clippers-tiktok-batch-evidence-sync.json");
const evidenceChecklistPath = path.join(reportsDir, "clippers-tiktok-evidence-checklist.json");
const goalAuditPath = path.join(reportsDir, "clippers-goal-completion-audit.json");
const operatingRefreshPath = path.join(reportsDir, "tiktok-mvp-operating-refresh", "operating-refresh.json");
const metricool100HandoffPath = path.join(rootDir, "scheduled", "metricool-100-operator-handoff.json");
const outJsonPath = path.join(reportsDir, "clippers-tiktok-mvp-go-live-packet.json");
const outMarkdownPath = path.join(reportsDir, "clippers-tiktok-mvp-go-live-packet.md");
const outCsvPath = path.join(reportsDir, "clippers-tiktok-mvp-go-live-packet.csv");
const readOnlyMode = process.argv.includes("--read-only");

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}

async function readJsonOrNull(filePath) {
  try {
    return await readJson(filePath);
  } catch {
    return null;
  }
}

function runPrerequisite(scriptSpec) {
  const args = Array.isArray(scriptSpec) ? scriptSpec : [scriptSpec];
  const result = spawnSync(process.execPath, args, {
    cwd: process.cwd(),
    encoding: "utf8",
  });
  if (result.status !== 0) {
    throw new Error(`Prerequisite ${args.join(" ")} failed: ${result.stderr || result.stdout}`);
  }
}

function csvCell(value) {
  return `"${String(value ?? "").replace(/"/g, '""')}"`;
}

function renderCsv(summary) {
  const header = ["section", "step", "status", "owner", "scope", "active_platforms", "active_metricool_brands", "deferred_lanes", "action", "proof", "blocker"];
  return [
    header.map(csvCell).join(","),
    [
      "operating_mode",
      "tiktok-only-mvp",
      summary.operatingMode.batchPlatformCheck,
      "app",
      summary.operatingMode.scope,
      summary.operatingMode.activePlatforms.join("|"),
      summary.operatingMode.activeMetricoolBrands.join("|"),
      summary.operatingMode.deferredLanes.join("|"),
      `Use only active TikTok Metricool accounts: ${summary.operatingMode.activeAccounts.map((account) => `${account.accountName} (${account.metricoolBrandName})`).join("; ")}`,
      summary.paths.markdown,
      summary.operatingMode.batchOnlyUsesActiveTikTokAccounts ? "" : "blocked_non_tiktok_or_inactive_account",
    ].map(csvCell).join(","),
    ...summary.operatorSteps.map((step) => [
      "operator_step",
      step.id,
      step.status,
      step.owner,
      summary.operatingMode.scope,
      summary.operatingMode.activePlatforms.join("|"),
      summary.operatingMode.activeMetricoolBrands.join("|"),
      summary.operatingMode.deferredLanes.join("|"),
      step.action,
      step.proof,
      step.blocker,
    ].map(csvCell).join(",")),
  ].join("\n") + "\n";
}

function proofGateFor(report = {}) {
  const gate = report?.proofGate || {};
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
    nextStep: gate.nextStep || report?.nextStep || "",
  };
}

function proofGateReady(proofGate = {}) {
  return proofGate.status === "ready_for_operator_review"
    && proofGate.controlFieldsPresent === true
    && proofGate.requiredLanes.includes("sports-daily:tiktok")
    && proofGate.requiredLanes.includes("meme-radar:tiktok")
    && proofGate.minimumProofUrlsNeeded === 0
    && proofGate.failedPreflightChecks.length === 0
    && proofGate.failedVerifierChecks.length === 0
    && proofGate.missingRequiredReports.length === 0
    && proofGate.boundaryNotReady.length === 0
    && proofGate.blockedBy.length === 0
    && !proofGate.preflightNotReady;
}

function markdown(summary) {
  const proofGateLines = [
    "## Proof Gate",
    "",
    `- Status: ${summary.proofGate.status}`,
    `- Control fields present: ${summary.proofGate.controlFieldsPresent}`,
    `- Required lanes: ${summary.proofGate.requiredLanes.join(", ") || "missing"}`,
    `- Minimum proof URLs needed: ${summary.proofGate.minimumProofUrlsNeeded}`,
    `- Fast path available: ${summary.proofGate.fastPathAvailable}`,
    `- Next safe button: ${summary.proofGate.nextSafeButton || "missing"}`,
    `- Next locked button: ${summary.proofGate.nextLockedButton || "missing"}`,
    `- One-screen guide: ${summary.proofGate.paths?.oneScreenGuide || "missing"}`,
    `- Proof JSON: ${summary.proofGate.paths?.proofLinksJson || "missing"}`,
    `- Paste packet: ${summary.proofGate.paths?.pastePacket || "missing"}`,
    `- Next step: ${summary.proofGate.nextStep || "missing"}`,
    ...(summary.proofGate.blockedBy || []).map((blocker) => `- Blocker: ${blocker}`),
    "",
  ];
  return [
    "# Clippers TikTok MVP Go-Live Packet",
    "",
    `Status: ${summary.status}`,
    `Generated: ${summary.generatedAt}`,
    `Launch mode: ${summary.launchMode}`,
    "",
    "This packet is the single operator view for the active TikTok MVP. It does not publish automatically and does not count posts without public TikTok URLs and 24h metrics.",
    "",
    "## Operating Mode",
    "",
    `- Scope: ${summary.operatingMode.scope}`,
    `- Active platforms: ${summary.operatingMode.activePlatforms.join(", ")}`,
    `- Active Metricool brands: ${summary.operatingMode.activeMetricoolBrands.join(", ")}`,
    `- Active accounts: ${summary.operatingMode.activeAccounts.map((account) => `${account.accountName} (${account.metricoolBrandName})`).join("; ")}`,
    `- Deferred lanes: ${summary.operatingMode.deferredLanes.join(", ") || "none"}`,
    `- Batch platform check: ${summary.operatingMode.batchPlatformCheck}`,
    "",
    ...proofGateLines,
    "## Totals",
    "",
    `- Account lanes ready: ${summary.totals.accountReady}/${summary.totals.accountRows}`,
    `- Batch rows: ${summary.totals.batchRows}`,
    `- Not started: ${summary.totals.notStarted}`,
    `- Scheduled: ${summary.totals.scheduled}`,
    `- Ready to import: ${summary.totals.readyToImport}`,
    `- Scheduled proof missing: ${summary.totals.evidenceMissingApproval}`,
    `- Evidence ready for import preview: ${summary.totals.evidenceReadyForImportPreview}`,
    `- Sync applied: ${summary.totals.syncApplied}`,
    `- Sync conflicts: ${summary.totals.conflicts}`,
    `- Goal audit waiting Metricool work: ${summary.totals.waitingMetricoolWork}`,
    `- Metricool 100 rows ready: ${summary.totals.metricool100Rows}`,
    `- Metricool 100 operator-ready batches: ${summary.totals.metricool100ReadyBatches}`,
    `- Metricool 100 source-ready batches: ${summary.totals.metricool100SourceReadyBatches}`,
    `- Metricool 100 blocked batches: ${summary.totals.metricool100BlockedBatches}`,
    "",
    "## Metricool 100 Run",
    "",
    `- Status: ${summary.metricool100.status}`,
    `- Console status: ${summary.metricool100.consoleStatus}`,
    `- Rows: ${summary.metricool100.rows}`,
    `- Batches: ${summary.metricool100.batches}`,
    `- Sports rows: ${summary.metricool100.sports}`,
    `- Meme rows: ${summary.metricool100.memes}`,
    `- Operator-ready batches: ${summary.metricool100.readyBatches}`,
    `- Source-ready batches: ${summary.metricool100.sourceReadyBatches}`,
    `- Blocked batches: ${summary.metricool100.blockedBatches}`,
    `- Ready to send: ${summary.metricool100.readyToSend}`,
    `- Published rows counted: ${summary.metricool100.publishedRowsCounted}`,
    `- Current batch: ${summary.metricool100.currentBatchId || "n/a"} (${summary.metricool100.currentBatchRows || "n/a"})`,
    `- Current batch source gates: ${summary.metricool100.currentBatchSourceGateTotals.ready}/${summary.metricool100.currentBatchSourceGateTotals.rows} ready, ${summary.metricool100.currentBatchSourceGateTotals.blocked} blocked, ${summary.metricool100.currentBatchSourceGateTotals.pending} pending`,
    `- Current batch evidence CSV: ${summary.metricool100.currentBatchEvidenceCsv || "n/a"}`,
    "",
    "## Do Now",
    "",
    ...summary.operatorSteps.map((step, index) => `${index + 1}. [${step.status}] ${step.action}`),
    "",
    "## Next Row",
    "",
    summary.nextRow ? [
      `- Queue item: ${summary.nextRow.metricoolQueueItemId}`,
      `- Account: ${summary.nextRow.accountName || summary.nextRow.accountId}`,
      `- Brand: ${summary.nextRow.metricoolBrandName}`,
      `- Source: ${summary.nextRow.sourceFileName}`,
      `- Schedule: ${summary.nextRow.scheduledFor}`,
      `- Caption: ${summary.nextRow.captionSeed}`,
      "",
      "```text",
      summary.nextRow.operatorCopyText || summary.nextRow.operatorStep,
      "```",
    ].join("\n") : summary.blockedNextRow ? [
      `- Blocked queue item: ${summary.blockedNextRow.metricoolQueueItemId}`,
      `- Account: ${summary.blockedNextRow.accountName || summary.blockedNextRow.accountId}`,
      `- Brand: ${summary.blockedNextRow.metricoolBrandName}`,
      `- Source: ${summary.blockedNextRow.sourceFileName}`,
      `- Blocker: ${summary.blockedNextRow.blocker}`,
      `- Next action: ${summary.blockedNextRow.nextAction}`,
    ].join("\n") : "No active next row.",
    "",
    "## Guardrails",
    "",
    ...summary.guardrails.map((guardrail) => `- ${guardrail}`),
    "",
    "## Files",
    "",
    `- Go-live JSON: ${summary.paths.json}`,
    `- Go-live Markdown: ${summary.paths.markdown}`,
    `- Go-live CSV: ${summary.paths.csv}`,
    `- Account closeout: ${summary.paths.accountCloseout}`,
    `- Batch runbook: ${summary.paths.runbook}`,
    `- Batch tracker: ${summary.paths.tracker}`,
    `- Batch sync: ${summary.paths.sync}`,
    `- Evidence checklist: ${summary.paths.evidenceChecklist}`,
    `- Goal audit: ${summary.paths.goalAudit}`,
    `- Metricool 100 handoff: ${summary.paths.metricool100Handoff}`,
    "",
  ].flat().join("\n");
}

async function main() {
  const prerequisites = [
    "script/clippers-account-permission-readiness.mjs",
    "script/clippers-tiktok-batch-tracker.mjs",
    "script/clippers-tiktok-batch-runbook.mjs",
    "script/clippers-tiktok-evidence-checklist.mjs",
    "script/clippers-goal-completion-audit.mjs",
  ];
  if (!readOnlyMode) {
    await mkdir(reportsDir, { recursive: true });
    prerequisites.splice(1, 0, ["script/clippers-tiktok-batch-evidence-sync.mjs", "--all-batches"]);
    prerequisites.push(["--import", "tsx", "script/clippers-tiktok-mvp-operating-refresh.ts"]);
    prerequisites.push("script/clippers-metricool-operator-handoff.mjs");
    prerequisites.forEach(runPrerequisite);
  }
  const [accountCloseout, runbook, tracker, sync, evidenceChecklist, goalAudit, operatingRefresh, metricool100Handoff] = await Promise.all([
    readJson(accountCloseoutPath),
    readJson(runbookPath),
    readJson(trackerPath),
    readJson(syncPath),
    readJson(evidenceChecklistPath),
    readJson(goalAuditPath),
    readJsonOrNull(operatingRefreshPath),
    readJsonOrNull(metricool100HandoffPath),
  ]);
  const proofGate = proofGateFor(operatingRefresh || {});
  const operatingProofGateReady = proofGateReady(proofGate);
  const accountReady = Number(accountCloseout.totals?.ready || 0);
  const accountRows = Number(accountCloseout.totals?.rows || 0);
  const trackerTotals = tracker.totals || {};
  const runbookTotals = runbook.totals || {};
  const syncTotals = sync.totals || {};
  const syncConsistency = sync.consistency || {};
  const evidenceChecklistTotals = evidenceChecklist.totals || {};
  const activeAccounts = (accountCloseout.rows || [])
    .filter((row) => row.platform === "tiktok" && row.status === "ready_for_metricool_tiktok" && row.metricoolConnected === true)
    .map((row) => ({
      accountId: row.accountId,
      accountName: row.accountName,
      category: row.category,
      platform: row.platform,
      handle: row.handle,
      metricoolBrandName: row.metricoolBrandOrProfile === "tiktok" && row.category === "sports" ? "SPORT" : row.category,
      rightsReadyAssets: Number(row.rightsReadyAssets || 0),
      evidencePath: row.evidencePath || "",
    }));
  const batchPlatforms = Array.from(new Set((runbook.rows || []).map((row) => row.platform).filter(Boolean))).sort();
  const batchAccountIds = Array.from(new Set((runbook.rows || []).map((row) => row.accountId).filter(Boolean))).sort();
  const activeAccountIds = new Set(activeAccounts.map((row) => row.accountId));
  const batchOnlyUsesActiveTikTokAccounts = batchPlatforms.length === 1
    && batchPlatforms[0] === "tiktok"
    && batchAccountIds.every((accountId) => activeAccountIds.has(accountId));
  const readyForOperator = accountCloseout.status === "ready_for_metricool_tiktok"
    && runbook.status === "ready_for_metricool_operator"
    && tracker.status === "ready_for_metricool_review"
    && evidenceChecklist.status === "ready_for_metricool_operator"
    && sync.status === "no_operator_updates"
    && accountReady === accountRows
    && accountRows > 0
    && batchOnlyUsesActiveTikTokAccounts
    && operatingProofGateReady
    && Number(trackerTotals.readyToImport || 0) === 0
    && Number(syncConsistency.conflicts || 0) === 0;
  const nextRow = (runbook.rows || []).find((row) => row.state === "not_started") || (runbook.rows || [])[0] || null;
  const blockedNextRow = !operatingProofGateReady && nextRow ? {
    rank: nextRow.rank,
    metricoolQueueItemId: nextRow.metricoolQueueItemId,
    accountId: nextRow.accountId,
    accountName: nextRow.accountName,
    metricoolBrandName: nextRow.metricoolBrandName,
    scheduledFor: nextRow.scheduledFor,
    sourceFileName: nextRow.sourceFileName,
    blocker: "tiktok_metricool_proof_gate_not_ready",
    nextAction: proofGate.nextStep || "Fill SPORT and memes proof links before opening Metricool.",
  } : null;
  const metricool100SourceReadyBatches = (metricool100Handoff?.batches || []).filter((batch) => batch.status === "ready_for_metricool_review").length;
  const metricool100SourceBlockedBatches = (metricool100Handoff?.batches || []).filter((batch) => batch.status === "blocked_source_verification").length;
  const metricool100OperatorGateOpen = readyForOperator && operatingProofGateReady;
  const metricool100Ready = metricool100OperatorGateOpen
    && metricool100Handoff?.status === "ready_for_operator"
    && metricool100Handoff?.operatorConsole?.status === "ready_for_metricool_review"
    && Number(metricool100Handoff?.totals?.rows || 0) === 100
    && Number(metricool100Handoff?.totals?.readyToSend || 0) === 0
    && Number(metricool100Handoff?.operatorConsole?.publishedRowsCounted || 0) === 0
    && (metricool100Handoff?.batches || []).length === 10
    && (metricool100Handoff?.batches || []).every((batch) => batch.status === "ready_for_metricool_review");
  const metricool100 = {
    status: metricool100Handoff?.status || "not_prepared",
    consoleStatus: metricool100Handoff?.operatorConsole?.status || "not_prepared",
    rows: Number(metricool100Handoff?.totals?.rows || 0),
    batches: Number(metricool100Handoff?.totals?.batches || 0),
    sports: Number(metricool100Handoff?.totals?.sports || 0),
    memes: Number(metricool100Handoff?.totals?.memes || 0),
    streamers: Number(metricool100Handoff?.totals?.streamers || 0),
    sourceReadyBatches: metricool100SourceReadyBatches,
    readyBatches: metricool100OperatorGateOpen ? metricool100SourceReadyBatches : 0,
    blockedBatches: metricool100SourceBlockedBatches + (metricool100OperatorGateOpen ? 0 : metricool100SourceReadyBatches),
    operatorGateOpen: metricool100OperatorGateOpen,
    readyToSend: Number(metricool100Handoff?.totals?.readyToSend || 0),
    publishedRowsCounted: Number(metricool100Handoff?.operatorConsole?.publishedRowsCounted || 0),
    currentBatchId: metricool100Handoff?.operatorConsole?.currentBatchId || "",
    currentBatchRows: metricool100Handoff?.operatorConsole?.currentBatchRows || "",
    currentBatchSourceGateTotals: metricool100Handoff?.operatorConsole?.currentBatchOperatorSession?.sourceGateTotals || { rows: 0, ready: 0, blocked: 0, pending: 0 },
    markdownPath: metricool100Handoff?.paths?.markdown || "",
    currentBatchEvidenceCsv: metricool100Handoff?.operatorConsole?.paths?.currentBatchEvidenceCsv || "",
    ready: metricool100Ready,
  };
  const operatorSteps = [
    {
      id: "proof-gate",
      status: proofGate.status,
      owner: "app",
      action: operatingProofGateReady
        ? "Use the approved SPORT and memes TikTok Metricool proof gate for operator review."
        : proofGate.nextStep || "Fill SPORT and memes proof links with real non-secret Metricool or concrete Drive file/folder/Docs evidence before processing the batch.",
      proof: proofGate.paths?.oneScreenGuide || operatingRefreshPath,
      blocker: operatingProofGateReady ? "" : "tiktok_metricool_proof_gate_not_ready",
    },
    {
      id: "account-closeout",
      status: accountCloseout.status,
      owner: "app",
      action: accountCloseout.status === "ready_for_metricool_tiktok"
        ? "Use SPORT and memes TikTok accounts in Metricool approval_required mode."
        : "Finish TikTok account/Metricool connection evidence before processing the batch.",
      proof: accountCloseout.paths?.markdown || accountCloseoutPath,
      blocker: accountCloseout.status === "ready_for_metricool_tiktok" ? "" : "tiktok_account_closeout_not_ready",
    },
    {
      id: "metricool-batch",
      status: runbook.status,
      owner: "operator",
      action: !operatingProofGateReady
        ? "Do not open Metricool scheduling until the TikTok Metricool proof gate is ready."
        : nextRow
        ? `Open Metricool and process row #${nextRow.rank} (${nextRow.metricoolQueueItemId}).`
        : "No next batch row available.",
      proof: runbook.paths?.markdown || runbookPath,
      blocker: !operatingProofGateReady
        ? "tiktok_metricool_proof_gate_not_ready"
        : runbook.status === "ready_for_metricool_operator" ? "" : "batch_runbook_not_ready",
    },
    {
      id: "live-evidence",
      status: evidenceChecklist.status,
      owner: "operator",
      action: `Use the evidence checklist before saving rows: ${Number(evidenceChecklistTotals.missingApproval || 0)} need Metricool scheduled proof, ${Number(evidenceChecklistTotals.readyForImportPreview || 0)} are ready for import preview.`,
      proof: evidenceChecklist.paths?.markdown || evidenceChecklistPath,
      blocker: Number(evidenceChecklistTotals.readyForImportPreview || 0) === Number(evidenceChecklistTotals.rows || 0) && Number(evidenceChecklistTotals.rows || 0) > 0 ? "" : "waiting_metricool_evidence",
    },
    {
      id: "metricool-import",
      status: sync.status,
      owner: "app",
      action: "Only import metrics after preview shows real public TikTok URLs and nonzero 24h metrics.",
      proof: sync.paths?.markdown || syncPath,
      blocker: Number(syncTotals.applied || 0) > 0 ? "" : "no_operator_updates_yet",
    },
  ];
  const fullyReadyForMetricoolOperator = readyForOperator && metricool100.ready;
  const summary = {
    status: fullyReadyForMetricoolOperator ? "ready_for_metricool_operator" : "in_progress",
    generatedAt: new Date().toISOString(),
    launchMode: "metricool_approval_required",
    proofGate,
    operatingMode: {
      scope: "tiktok_only_metricool_mvp",
      activePlatforms: ["tiktok"],
      deferredLanes: ["instagram", "youtube", "streamers"],
      directSocialApisRequired: false,
      metricoolApprovalRequired: true,
      activeAccounts,
      activeMetricoolBrands: Array.from(new Set(activeAccounts.map((row) => row.metricoolBrandName))).sort(),
      batchPlatforms,
      batchAccountIds,
      batchOnlyUsesActiveTikTokAccounts,
      batchPlatformCheck: batchOnlyUsesActiveTikTokAccounts ? "pass" : "blocked_non_tiktok_or_inactive_account",
    },
    directSocialApisRequired: false,
    realPublishEnabled: false,
    paths: {
      json: outJsonPath,
      markdown: outMarkdownPath,
      csv: outCsvPath,
      accountCloseout: accountCloseoutPath,
      runbook: runbookPath,
      tracker: trackerPath,
      sync: syncPath,
      evidenceChecklist: evidenceChecklistPath,
      goalAudit: goalAuditPath,
      operatingRefresh: operatingRefreshPath,
      metricool100Handoff: metricool100HandoffPath,
    },
    sourceStatuses: {
      accountCloseout: accountCloseout.status,
      runbook: runbook.status,
      tracker: tracker.status,
      sync: sync.status,
      evidenceChecklist: evidenceChecklist.status,
      goalAudit: goalAudit.status,
      operatingRefresh: operatingRefresh?.status || "missing",
      metricool100Handoff: metricool100.status,
    },
    metricool100,
    totals: {
      accountRows,
      accountReady,
      batchRows: Number(runbookTotals.rows || trackerTotals.rows || 0),
      activeTikTokAccounts: activeAccounts.length,
      notStarted: Number(runbookTotals.notStarted || trackerTotals.notStarted || 0),
      scheduled: Number(runbookTotals.scheduled || trackerTotals.scheduled || 0),
      waitingMetrics: Number(runbookTotals.waitingMetrics || trackerTotals.waitingMetrics || 0),
      readyToImport: Number(runbookTotals.readyToImport || trackerTotals.readyToImport || 0),
      evidenceMissingApproval: Number(evidenceChecklistTotals.missingApproval || 0),
      evidenceMissingPublicUrl: Number(evidenceChecklistTotals.missingPublicUrl || 0),
      evidenceMissingMetrics: Number(evidenceChecklistTotals.missingMetrics || 0),
      evidenceReadyForImportPreview: Number(evidenceChecklistTotals.readyForImportPreview || 0),
      evidenceInvalid: Number(evidenceChecklistTotals.invalidEvidence || 0),
      syncApplied: Number(syncTotals.applied || 0),
      conflicts: Number(syncConsistency.conflicts || 0),
      waitingMetricoolWork: Number(goalAudit.totals?.waitingMetricoolWork || 0),
      metricool100Rows: metricool100.rows,
      metricool100ReadyBatches: metricool100.readyBatches,
      metricool100SourceReadyBatches: metricool100.sourceReadyBatches,
      metricool100BlockedBatches: metricool100.blockedBatches,
    },
    nextRow: operatingProofGateReady ? nextRow : null,
    blockedNextRow,
    operatorSteps,
    guardrails: [
      "Metricool remains approval_required.",
      "realPublishEnabled remains false.",
      "TikTok Metricool proof gate must be ready before any operator opens Metricool scheduling.",
      "Scheduled rows are not counted as published.",
      "Published/importable requires an exact public TikTok video URL and nonzero 24h metrics.",
      "Do not store login material, browser sessions, tokens, cookies, recovery codes, or private screenshots.",
      "Direct social APIs are not required for this TikTok MVP.",
    ],
    nextStep: !operatingProofGateReady
      ? proofGate.nextStep || "Fill SPORT and memes proof links with real non-secret Metricool or concrete Drive file/folder/Docs evidence before processing the batch."
      : readyForOperator
      ? metricool100.ready
        ? `Open Metricool and process ${metricool100.currentBatchId || "metricool-batch-01"} first; after scheduling, fill scheduled evidence. Add public TikTok URLs and 24h metrics only after posts are live.`
        : "Prepare or repair the Metricool 100 operator handoff before processing the weekly run."
      : accountCloseout.status !== "ready_for_metricool_tiktok" || accountReady < accountRows
        ? "Finish TikTok account ownership/security evidence and Metricool connection proof for SPORT and memes before processing the batch."
        : batchOnlyUsesActiveTikTokAccounts
        ? operatorSteps.find((step) => step.blocker)?.action || "Review packet blockers."
        : "Fix the batch so it contains only active TikTok Metricool accounts before operating.",
  };
  if (!readOnlyMode) {
    await writeFile(outJsonPath, JSON.stringify(summary, null, 2));
    await writeFile(outMarkdownPath, markdown(summary));
    await writeFile(outCsvPath, renderCsv(summary));
  }
  console.log(JSON.stringify({
    status: summary.status,
    accountReady: summary.totals.accountReady,
    accountRows: summary.totals.accountRows,
    batchRows: summary.totals.batchRows,
    notStarted: summary.totals.notStarted,
    readyToImport: summary.totals.readyToImport,
    evidenceMissingApproval: summary.totals.evidenceMissingApproval,
    evidenceReadyForImportPreview: summary.totals.evidenceReadyForImportPreview,
    metricool100Rows: summary.totals.metricool100Rows,
    metricool100ReadyBatches: summary.totals.metricool100ReadyBatches,
    metricool100SourceReadyBatches: summary.totals.metricool100SourceReadyBatches,
    metricool100BlockedBatches: summary.totals.metricool100BlockedBatches,
    proofGateStatus: summary.proofGate.status,
    proofGateControlFieldsPresent: summary.proofGate.controlFieldsPresent,
    minimumProofUrlsNeeded: summary.proofGate.minimumProofUrlsNeeded,
    metricool100OperatorGateOpen: summary.metricool100.operatorGateOpen,
    blockedNextRowBlocker: summary.blockedNextRow?.blocker || null,
    conflicts: summary.totals.conflicts,
    nextQueueItem: summary.nextRow?.metricoolQueueItemId || summary.blockedNextRow?.metricoolQueueItemId || null,
    markdownPath: outMarkdownPath,
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
