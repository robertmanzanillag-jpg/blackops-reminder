import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const rootDir = path.join(process.cwd(), "clippers_workspace");
const reportsDir = path.join(rootDir, "reports");
const scheduledDir = path.join(rootDir, "scheduled");
const trackerPath = path.join(reportsDir, "clippers-tiktok-batch-tracker.json");
const syncPath = path.join(reportsDir, "clippers-tiktok-batch-evidence-sync.json");
const workbookCsvPath = path.join(scheduledDir, "metricool-100-current-batch-workbook.csv");
const outJsonPath = path.join(reportsDir, "clippers-tiktok-batch-runbook.json");
const outMarkdownPath = path.join(reportsDir, "clippers-tiktok-batch-runbook.md");
const outCsvPath = path.join(reportsDir, "clippers-tiktok-batch-runbook.csv");

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}

function csvCell(value) {
  return `"${String(value ?? "").replace(/"/g, '""')}"`;
}

function renderCsv(summary) {
  const header = ["section", "rank", "metricool_queue_item_id", "account_id", "brand", "state", "source_path", "scheduled_for", "caption_seed", "operator_step", "operator_packet_status", "source_gate_status", "source_gate_detail", "operator_checklist"];
  return [
    header.map(csvCell).join(","),
    [
      "operator_session",
      summary.operatorSession.nextRow?.rank || "",
      summary.operatorSession.nextRow?.metricoolQueueItemId || "",
      summary.operatorSession.nextRow?.accountId || "",
      summary.operatorSession.nextRow?.metricoolBrandName || "",
      summary.operatorSession.nextRow?.state || "",
      summary.operatorSession.nextRow?.sourcePath || "",
      summary.operatorSession.nextRow?.scheduledFor || "",
      summary.operatorSession.nextRow?.captionSeed || "",
      summary.operatorSession.nextRow?.operatorStep || summary.operatorSession.nextAction,
      summary.operatorSession.nextRow?.operatorPacket?.status || "",
      summary.operatorSession.nextRow?.operatorPacket?.sourceGate?.status || "",
      summary.operatorSession.nextRow?.operatorPacket?.sourceGate?.detail || "",
      summary.operatorSession.nextRow?.operatorPacket?.checklist?.join(" | ") || summary.operatorSession.syncBlocker?.reason || "",
    ].map(csvCell).join(","),
    ...summary.rows.map((row) => [
      "batch_row",
      row.rank,
      row.metricoolQueueItemId,
      row.accountId,
      row.metricoolBrandName,
      row.state,
      row.sourcePath,
      row.scheduledFor,
      row.captionSeed,
      row.operatorStep,
      row.operatorPacket?.status || "",
      row.operatorPacket?.sourceGate?.status || "",
      row.operatorPacket?.sourceGate?.detail || "",
      row.operatorPacket?.checklist?.join(" | ") || "",
    ].map(csvCell).join(",")),
  ].join("\n") + "\n";
}

function rowStep(row) {
  if (row.state === "not_started") {
    return `Open Metricool brand ${row.metricoolBrandName}, upload/review ${row.sourceFileName}, paste caption, and schedule for ${row.scheduledFor}.`;
  }
  if (row.state === "scheduled") return "Wait for live TikTok URL, then fill the batch evidence CSV.";
  if (row.state === "waiting_metrics") return "Add 24h metrics before import.";
  if (row.state === "ready_to_import") return "Ready for evidence preview/import review.";
  if (row.state === "needs_fix") return `Fix evidence: ${row.blocker || "invalid row"}.`;
  if (row.state === "rejected") return "Replace this row before counting it toward the batch.";
  return row.nextAction || "Review this row.";
}

function operatorCopyText(row, batchEvidencePath) {
  return [
    `Queue item: ${row.metricoolQueueItemId}`,
    `Metricool brand: ${row.metricoolBrandName}`,
    `Account: ${row.accountName}`,
    `Platform: ${row.platform}`,
    `Schedule: ${row.scheduledFor}`,
    `Source file: ${row.sourcePath}`,
    `Caption: ${row.captionSeed}`,
    `Action: ${row.operatorStep}`,
    `Batch evidence CSV: ${batchEvidencePath}`,
    "Before live: record final_status scheduled with a Metricool HTTPS URL.",
    "After live: record final_status published only with exact public TikTok URL plus nonzero 24h metrics.",
  ].join("\n");
}

function sourceGateForRow(row) {
  if (row.sourceExists === false || String(row.blocker || "").startsWith("source_file_")) {
    return {
      status: "blocked_source_file",
      label: "Source blocked",
      detail: row.blocker || "source_file_invalid",
    };
  }
  if (row.sourceExists === true && row.sourceVideoValid === true) {
    return {
      status: "ready",
      label: "Source OK",
      detail: [
        row.sourceBytes ? `${row.sourceBytes} bytes` : "local source verified",
        row.sourceDurationSeconds ? `${row.sourceDurationSeconds}s` : "",
        row.sourceProbe || "",
      ].filter(Boolean).join(", "),
    };
  }
  if (row.sourceVideoValid === false) {
    return {
      status: "blocked_source_file",
      label: "Source blocked",
      detail: "tracker reports local file is not a valid video",
    };
  }
  return {
    status: "pending_verification",
    label: "Source pending",
    detail: "source video validation missing from tracker artifact; refresh tracker before Metricool work",
  };
}

function operatorPacket(row, batchEvidencePath) {
  const sourceGate = sourceGateForRow(row);
  if (sourceGate.status === "blocked_source_file") {
    return {
      status: "blocked_source_file",
      sourceGate,
      metricoolFields: {
        brand: row.metricoolBrandName,
        account: row.accountName,
        platform: row.platform,
        scheduledFor: row.scheduledFor,
        sourcePath: row.sourcePath,
        caption: row.captionSeed,
        evidenceCsvPath: batchEvidencePath,
      },
      approvalEvidenceTemplate: {
        metricoolQueueItemId: row.metricoolQueueItemId,
        finalStatus: "blocked",
        metricoolApprovalUrl: "",
        operatorNotes: "Local source file is missing or invalid; do not process in Metricool.",
      },
      liveEvidenceTemplate: {
        metricoolQueueItemId: row.metricoolQueueItemId,
        finalStatus: "",
        publishedPostUrl: "",
        views24h: "",
        likes24h: "",
        comments24h: "",
        shares24h: "",
      },
      checklist: [
      "Stop before Metricool.",
      `Restore or replace the local source file: ${row.sourcePath}`,
      "Run TikTok batch tracker again.",
      "Continue only after Source OK is visible.",
      ],
    };
  }
  const statePackets = {
    not_started: {
      status: sourceGate.status === "ready" ? "ready_for_metricool_review" : "pending_source_verification",
      checklist: sourceGate.status === "ready" ? [
        `Open Metricool brand ${row.metricoolBrandName}.`,
        `Upload/review the local TikTok source file: ${row.sourcePath}.`,
        `Paste caption exactly: ${row.captionSeed}`,
        `Schedule for ${row.scheduledFor}.`,
        `Record Metricool scheduled proof in: ${batchEvidencePath}.`,
        "After the post is public, add exact TikTok video URL and 24h metrics before import.",
      ] : [
        "Stop before Metricool.",
        "Refresh TikTok batch tracker so source video validation is present.",
        "Continue only after Source OK is visible.",
      ],
    },
    scheduled: {
      status: "waiting_public_tiktok_url",
      checklist: [
        "Do not schedule this row again.",
        "Wait until the Metricool-scheduled TikTok post is public.",
        "Record final_status=published only with the exact public TikTok video URL.",
        "Do not add 24h metrics until the post has been live long enough.",
      ],
    },
    waiting_metrics: {
      status: "waiting_24h_metrics",
      checklist: [
        "Do not schedule this row again.",
        "Open the live TikTok post after 24h.",
        "Add nonzero views, likes, comments, or shares to the batch evidence CSV.",
        "Run evidence sync and preview before importing.",
      ],
    },
    ready_to_import: {
      status: "ready_for_import_preview",
      checklist: [
        "Do not schedule this row again.",
        "Run evidence preview/import review.",
        "Count performance only after the import applies cleanly.",
      ],
    },
    needs_fix: {
      status: "blocked_evidence_fix_required",
      checklist: [
        "Stop before counting or importing this row.",
        `Fix evidence blocker: ${row.blocker || "invalid evidence"}.`,
        "Run batch evidence sync again.",
        "Continue only after the blocker clears.",
      ],
    },
    rejected: {
      status: "blocked_replace_row",
      checklist: [
        "Do not schedule this rejected row again.",
        "Replace the row with a corrected clip or schedule a new Metricool item.",
        "Run tracker/runbook again after replacement.",
      ],
    },
  };
  const statePacket = statePackets[row.state] || {
    status: "review_required",
    checklist: [row.nextAction || "Review this row before Metricool work."],
  };
  return {
    status: statePacket.status,
    sourceGate,
    metricoolFields: {
      brand: row.metricoolBrandName,
      account: row.accountName,
      platform: row.platform,
      scheduledFor: row.scheduledFor,
      sourcePath: row.sourcePath,
      caption: row.captionSeed,
      evidenceCsvPath: batchEvidencePath,
    },
    approvalEvidenceTemplate: {
      metricoolQueueItemId: row.metricoolQueueItemId,
      finalStatus: "scheduled",
      metricoolApprovalUrl: "<paste real Metricool planner URL after scheduling>",
      operatorNotes: "<write real 20+ char operator note after scheduling>",
    },
    liveEvidenceTemplate: {
      metricoolQueueItemId: row.metricoolQueueItemId,
      finalStatus: "published",
      publishedPostUrl: "<paste exact public TikTok video URL after live>",
      views24h: "<nonzero number after 24h>",
      likes24h: "<optional number>",
      comments24h: "<optional number>",
      shares24h: "<optional number>",
    },
    checklist: statePacket.checklist,
  };
}

function numericMetric(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function isTikTokPostUrl(value) {
  const text = String(value || "").trim();
  if (!/^https?:\/\//i.test(text)) return false;
  try {
    const parsed = new URL(text);
    const hostname = parsed.hostname.replace(/^www\./, "");
    if (!(hostname === "tiktok.com" || hostname.endsWith(".tiktok.com"))) return false;
    const pathname = parsed.pathname.replace(/\/+$/, "");
    return /^\/@[^/]+\/video\/\d+$/i.test(pathname);
  } catch {
    return false;
  }
}

function syncBlockerFrom(sync) {
  const rows = Array.isArray(sync.rows) ? sync.rows : [];
  const blocker = rows.find((row) => row.result === "rejected" || row.consistency === "conflict");
  if (blocker) {
    return {
      metricoolQueueItemId: blocker.metricoolQueueItemId || "",
      result: blocker.result || "",
      reason: blocker.reason || "batch evidence row is rejected or conflicted",
      consistency: blocker.consistency || "",
    };
  }
  const rejected = Number(sync.totals?.rejected || 0);
  const conflicts = Number(sync.consistency?.conflicts || 0);
  if (rejected > 0 || conflicts > 0 || String(sync.status || "").startsWith("blocked")) {
    return {
      metricoolQueueItemId: "",
      result: rejected > 0 ? "rejected" : "blocked",
      reason: sync.status || "batch evidence sync is blocked",
      consistency: conflicts > 0 ? "conflict" : "",
    };
  }
  return null;
}

function markdown(summary) {
  const syncBlockerBlock = summary.operatorSession.syncBlocker ? [
    "### Evidence Sync Blocker",
    "",
    `- Queue item: ${summary.operatorSession.syncBlocker.metricoolQueueItemId || "batch CSV"}`,
    `- Result: ${summary.operatorSession.syncBlocker.result || "blocked"}`,
    `- Reason: ${summary.operatorSession.syncBlocker.reason}`,
    `- Consistency: ${summary.operatorSession.syncBlocker.consistency || "n/a"}`,
    "",
  ].join("\n") : "";
  return [
    "# TikTok Batch 01 Metricool Runbook",
    "",
    `Status: ${summary.status}`,
    `Generated: ${summary.generatedAt}`,
    `Batch: ${summary.batch.id}`,
    "",
    "## Open These Files",
    "",
    `- Workbook: ${summary.paths.workbookCsv}`,
    `- Batch evidence CSV: ${summary.paths.batchEvidence}`,
    `- Tracker: ${summary.paths.tracker}`,
    `- Sync report: ${summary.paths.sync}`,
    "",
    "## Do Now",
    "",
    ...summary.runbook.map((step, index) => `${index + 1}. ${step}`),
    "",
    "## Operator Session",
    "",
    `- Next action: ${summary.operatorSession.nextAction}`,
    `- Active brand queue: ${summary.operatorSession.brandQueue.map((row) => `${row.brand}: ${row.notStarted} not started, ${row.scheduled} scheduled, ${row.readyToImport} importable`).join("; ")}`,
    `- Evidence rule: ${summary.operatorSession.evidenceRule}`,
    "",
    syncBlockerBlock,
    summary.operatorSession.nextRow ? [
      "### Copy-Safe Operator Packet",
      "",
      `- Packet status: ${summary.operatorSession.nextRow.operatorPacket.status}`,
      `- Source gate: ${summary.operatorSession.nextRow.operatorPacket.sourceGate.label} (${summary.operatorSession.nextRow.operatorPacket.sourceGate.detail})`,
      "",
      ...summary.operatorSession.nextRow.operatorPacket.checklist.map((step) => `- ${step}`),
      "",
      "```text",
      summary.operatorSession.nextRow.operatorCopyText,
      "```",
      "",
    ].join("\n") : "No next row.",
    "## Rows",
    "",
    ...summary.rows.map((row) => [
      `### #${row.rank} ${row.metricoolQueueItemId}`,
      "```text",
      row.operatorCopyText,
      "```",
      `- Packet status: ${row.operatorPacket.status}`,
      `- Source gate: ${row.operatorPacket.sourceGate.label} (${row.operatorPacket.sourceGate.detail})`,
      "",
    ].join("\n")),
    "## Guardrails",
    "",
    ...summary.guardrails.map((guardrail) => `- ${guardrail}`),
    "",
  ].join("\n");
}

async function main() {
  await mkdir(reportsDir, { recursive: true });
  const [tracker, sync] = await Promise.all([
    readJson(trackerPath),
    readJson(syncPath),
  ]);
  const batchId = String(tracker.batch?.id || sync.batchId || "metricool-batch-01");
  const batchEvidencePath = path.join(scheduledDir, "metricool-100-batch-evidence-imports", `${batchId}-evidence-import.csv`);
  const rows = (tracker.rows || []).map((row) => {
    const preparedRow = {
      ...row,
      operatorStep: rowStep(row),
    };
    const packet = operatorPacket(preparedRow, batchEvidencePath);
    return {
      ...preparedRow,
      operatorCopyText: packet.status === "pending_source_verification" || packet.status === "blocked_source_file"
        ? [
          `Queue item: ${preparedRow.metricoolQueueItemId}`,
          `Metricool brand: ${preparedRow.metricoolBrandName}`,
          `Source file: ${preparedRow.sourcePath}`,
          `Source gate: ${packet.sourceGate.label} (${packet.sourceGate.detail})`,
          ...packet.checklist.map((step) => `Action: ${step}`),
        ].join("\n")
        : operatorCopyText(preparedRow, batchEvidencePath),
      operatorPacket: packet,
    };
  });
  if (rows.length !== 10) throw new Error(`Batch runbook requires exactly 10 active rows; found ${rows.length}.`);
  const hasUnsafeReady = rows.some((row) => row.state === "ready_to_import" && (
    !isTikTokPostUrl(row.publishedPostUrl)
    || numericMetric(row.views24h) + numericMetric(row.likes24h) + numericMetric(row.comments24h) + numericMetric(row.shares24h) <= 0
  ));
  if (hasUnsafeReady) throw new Error("Runbook refused unsafe ready_to_import row without exact public TikTok video URL and metrics.");
  const runbook = [
    "Open Metricool and select only the listed TikTok brand/account for each row.",
    `Use the workbook CSV as the source of truth: ${workbookCsvPath}.`,
    "For each row, upload/review the listed local source file and paste the caption seed.",
    "Schedule inside Metricool. Do not mark as published until TikTok gives a public post URL.",
    `After posts are live, fill only the batch evidence CSV: ${batchEvidencePath}.`,
    "Run Sync batch evidence, then check preview importable/rejected counts before importing metrics.",
  ];
  const syncRejected = Number(sync.totals?.rejected || 0);
  const syncConflicts = Number(sync.consistency?.conflicts || 0);
  const syncBlocked = syncRejected > 0 || syncConflicts > 0 || String(sync.status || "").startsWith("blocked");
  const syncBlocker = syncBlockerFrom(sync);
  const sourceGateBlocked = rows.some((row) => row.operatorPacket?.status === "blocked_source_file" || row.operatorPacket?.status === "pending_source_verification");
  const status = syncBlocked
    ? "in_progress"
    : sourceGateBlocked
      ? "in_progress"
    : tracker.status === "ready_for_metricool_review" && sync.status === "no_operator_updates"
    ? "ready_for_metricool_operator"
    : tracker.status === "ready_to_import"
      ? "ready_for_import_review"
      : "in_progress";
  const brandQueue = Array.from(rows.reduce((byBrand, row) => {
    const brand = row.metricoolBrandName || row.accountName || row.accountId || "unknown";
    const current = byBrand.get(brand) || { brand, rows: 0, notStarted: 0, scheduled: 0, waitingMetrics: 0, readyToImport: 0, needsFix: 0 };
    current.rows += 1;
    if (row.state === "not_started") current.notStarted += 1;
    if (row.state === "scheduled") current.scheduled += 1;
    if (row.state === "waiting_metrics") current.waitingMetrics += 1;
    if (row.state === "ready_to_import") current.readyToImport += 1;
    if (row.state === "needs_fix" || row.state === "rejected") current.needsFix += 1;
    byBrand.set(brand, current);
    return byBrand;
  }, new Map()).values()).sort((a, b) => a.brand.localeCompare(b.brand));
  const candidateNextRow = rows.find((row) => row.state === "not_started")
    || rows.find((row) => row.state === "scheduled")
    || rows.find((row) => row.state === "waiting_metrics")
    || rows.find((row) => row.state === "needs_fix")
    || rows.find((row) => row.state === "rejected")
    || null;
  const nextRow = syncBlocked ? null : candidateNextRow;
  const operatorSession = {
    status,
    batchId,
    currentStep: syncBlocked ? "sync_blocked" : nextRow?.state || "ready_to_import_review",
    nextAction: syncBlocked
      ? `Fix batch evidence sync blocker before continuing Metricool work: ${syncBlocker?.reason || "batch evidence sync is blocked"}.`
      : nextRow
      ? (nextRow.operatorPacket?.status === "blocked_source_file" || nextRow.operatorPacket?.status === "pending_source_verification"
        ? nextRow.operatorPacket.checklist[0]
        : nextRow.operatorStep)
      : "All rows have evidence ready for import preview. Run preview before importing metrics.",
    nextRow,
    syncBlocker,
    brandQueue,
    copyBlocks: nextRow ? {
      metricoolQueueItemId: nextRow.metricoolQueueItemId,
      metricoolBrandName: nextRow.metricoolBrandName,
      accountName: nextRow.accountName,
      sourcePath: nextRow.sourcePath,
      captionSeed: nextRow.captionSeed,
      scheduledFor: nextRow.scheduledFor,
      evidenceCsvPath: batchEvidencePath,
    } : null,
    evidenceRule: "Record scheduled only with a Metricool HTTPS URL before live; record published only after exact public TikTok URL plus nonzero 24h metrics.",
  };
  const summary = {
    status,
    generatedAt: new Date().toISOString(),
    paths: {
      json: outJsonPath,
      markdown: outMarkdownPath,
      csv: outCsvPath,
      tracker: trackerPath,
      sync: syncPath,
      workbookCsv: workbookCsvPath,
      batchEvidence: batchEvidencePath,
    },
    batch: tracker.batch,
    totals: {
      rows: rows.length,
      notStarted: tracker.totals?.notStarted || 0,
      scheduled: tracker.totals?.scheduled || 0,
      waitingMetrics: tracker.totals?.waitingMetrics || 0,
      readyToImport: tracker.totals?.readyToImport || 0,
      syncApplied: sync.totals?.applied || 0,
      syncRejected,
      conflicts: syncConflicts,
    },
    operatorSession,
    runbook,
    rows,
    guardrails: [
      "Metricool remains approval_required; this runbook does not publish automatically.",
      "Scheduled rows are not published rows.",
      "Published/importable requires a public TikTok URL and nonzero 24h metrics.",
      "Do not paste tokens, cookies, passwords, private URLs, or screenshots with secrets.",
    ],
    nextStep: syncBlocked
      ? "Fix batch evidence sync blockers before continuing Metricool work."
      : status === "ready_for_metricool_operator"
      ? "Open Metricool and process row #1 from the runbook."
      : "Continue from the first row that is not ready_to_import.",
  };
  await writeFile(outJsonPath, JSON.stringify(summary, null, 2));
  await writeFile(outMarkdownPath, markdown(summary));
  await writeFile(outCsvPath, renderCsv(summary));
  console.log(JSON.stringify({
    status: summary.status,
    rows: summary.totals.rows,
    notStarted: summary.totals.notStarted,
    readyToImport: summary.totals.readyToImport,
    syncApplied: summary.totals.syncApplied,
    conflicts: summary.totals.conflicts,
    markdownPath: outMarkdownPath,
    nextStep: summary.nextStep,
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
