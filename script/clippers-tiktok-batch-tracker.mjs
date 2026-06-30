import { mkdir, open, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";

const rootDir = path.join(process.cwd(), "clippers_workspace");
const scheduledDir = path.join(rootDir, "scheduled");
const reportsDir = path.join(rootDir, "reports");
const workbookPath = path.join(scheduledDir, "metricool-100-current-batch-workbook.json");
const sessionPath = path.join(scheduledDir, "metricool-100-current-batch-operator-session.json");
const masterEvidenceCsvPath = path.join(rootDir, "evidence-drop", "metricool-100-approval-evidence-import.csv");
const verifierPath = path.join(reportsDir, "clippers-tiktok-mvp-readiness-verifier.json");
const outJsonPath = path.join(reportsDir, "clippers-tiktok-batch-tracker.json");
const outMarkdownPath = path.join(reportsDir, "clippers-tiktok-batch-tracker.md");
const outCsvPath = path.join(reportsDir, "clippers-tiktok-batch-tracker.csv");

async function readRequiredJson(filePath) {
  const raw = await readFile(filePath, "utf8");
  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new Error(`Could not parse required JSON artifact ${filePath}: ${error.message}`);
  }
}

async function readOptionalJson(filePath, fallback = null) {
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

function hasMp4FileTypeBox(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 12) return false;
  const boxSize = buffer.readUInt32BE(0);
  const boxType = buffer.subarray(4, 8).toString("latin1");
  if (boxType !== "ftyp") return false;
  if (boxSize < 12 || boxSize > buffer.length) return false;
  const majorBrand = buffer.subarray(8, 12).toString("latin1");
  return /^[A-Za-z0-9 ]{4}$/.test(majorBrand);
}

async function sourceFileStatus(sourcePath) {
  const text = String(sourcePath || "").trim();
  if (!text) return { sourceExists: false, sourceBytes: 0, sourceVideoValid: false, sourceDurationSeconds: 0, sourceProbe: "missing", sourceBlocker: "source_file_missing" };
  const fileStat = await stat(text).catch(() => null);
  if (!fileStat?.isFile()) return { sourceExists: false, sourceBytes: 0, sourceVideoValid: false, sourceDurationSeconds: 0, sourceProbe: "missing", sourceBlocker: "source_file_missing" };
  const ext = path.extname(text).toLowerCase();
  if (![".mp4", ".mov", ".m4v"].includes(ext)) return { sourceExists: true, sourceBytes: fileStat.size, sourceVideoValid: false, sourceDurationSeconds: 0, sourceProbe: "extension", sourceBlocker: "source_file_unsupported_extension" };
  if (fileStat.size < 1024) return { sourceExists: true, sourceBytes: fileStat.size, sourceVideoValid: false, sourceDurationSeconds: 0, sourceProbe: "size", sourceBlocker: "source_file_too_small" };
  let handle;
  try {
    handle = await open(text, "r");
    const buffer = Buffer.alloc(4096);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    const looksLikeMp4 = hasMp4FileTypeBox(buffer.subarray(0, bytesRead));
    return {
      sourceExists: true,
      sourceBytes: fileStat.size,
      sourceVideoValid: looksLikeMp4,
      sourceDurationSeconds: 0,
      sourceProbe: "mp4_signature",
      sourceBlocker: looksLikeMp4 ? "" : "source_file_probe_failed",
    };
  } catch (error) {
    return { sourceExists: true, sourceBytes: fileStat.size, sourceVideoValid: false, sourceDurationSeconds: 0, sourceProbe: "mp4_signature", sourceBlocker: "source_file_probe_failed" };
  } finally {
    await handle?.close().catch(() => undefined);
  }
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

function isMetricoolApprovalUrl(value) {
  const text = String(value || "").trim();
  if (!/^https:\/\//i.test(text)) return false;
  try {
    const parsed = new URL(text);
    const hostname = parsed.hostname.replace(/^www\./, "");
    return hostname === "metricool.com" || hostname.endsWith(".metricool.com");
  } catch {
    return false;
  }
}

function validateOperatorNotes(value, finalStatus) {
  if (!finalStatus) return [];
  const notes = String(value || "").trim();
  const issues = [];
  if (notes.length < 20) issues.push("operator_notes_min_20_chars");
  const normalized = notes.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const tokens = normalized.split(/\s+/).filter(Boolean);
  const genericTokens = new Set(["approved", "scheduled", "published", "posted", "ok", "yes", "done", "metricool", "tiktok", "clip", "ready"]);
  const concreteTokenCount = tokens.filter((token) => token.length >= 5 && !genericTokens.has(token)).length;
  if ((tokens.length > 0 && concreteTokenCount === 0) || genericTokens.has(normalized)) issues.push("operator_notes_must_not_be_generic");
  if (/<[^>]+>/.test(notes) || /\b(placeholder|paste|todo|tbd|example)\b/i.test(notes)) issues.push("operator_notes_must_not_contain_placeholders");
  return issues;
}

function normalizeComparable(value) {
  return String(value || "").trim().toLowerCase();
}

function evidenceMismatchBlocker(record, workbookRow) {
  if (!record || Object.keys(record).length === 0) return null;
  const mismatches = [];
  if (normalizeComparable(record.account_id) && normalizeComparable(workbookRow.accountId) && normalizeComparable(record.account_id) !== normalizeComparable(workbookRow.accountId)) {
    mismatches.push("account_id");
  }
  if (normalizeComparable(record.platform) && normalizeComparable(workbookRow.platform) && normalizeComparable(record.platform) !== normalizeComparable(workbookRow.platform)) {
    mismatches.push("platform");
  }
  if (!mismatches.length) return null;
  return `evidence_mismatch_${mismatches.join("_")}`;
}

function classifyEvidence(record, workbookRow) {
  const mismatchBlocker = evidenceMismatchBlocker(record, workbookRow);
  if (mismatchBlocker) {
    return {
      state: "needs_fix",
      blocker: mismatchBlocker,
      nextAction: "Fix the evidence row so queue item, account, platform, and scheduled time match the active batch workbook.",
    };
  }
  const finalStatus = String(record.final_status || "").trim().toLowerCase();
  const approvalUrl = String(record.metricool_approval_url || "").trim();
  const publishedPostUrl = String(record.published_post_url || "").trim();
  const operatorNotes = String(record.operator_notes || "").trim();
  const metricsTotal = numberValue(record.views_24h) + numberValue(record.likes_24h) + numberValue(record.comments_24h) + numberValue(record.shares_24h);
  const hasTouch = !isPlaceholder(approvalUrl) || !isPlaceholder(publishedPostUrl) || !isPlaceholder(finalStatus) || !isPlaceholder(operatorNotes) || metricsTotal > 0;
  if (!hasTouch) {
    return {
      state: "not_started",
      blocker: "waiting_metricool_review",
      nextAction: "Open this row in Metricool, upload/review the source, and schedule it.",
    };
  }
  if (finalStatus === "approved") {
    return {
      state: "needs_fix",
      blocker: "approved_status_not_allowed_for_tiktok_batch_use_scheduled",
      nextAction: "Use final_status=scheduled for pre-live TikTok rows scheduled in Metricool.",
    };
  }
  const noteIssues = validateOperatorNotes(operatorNotes, finalStatus);
  if (noteIssues.length) {
    return {
      state: "needs_fix",
      blocker: noteIssues.join(","),
      nextAction: "Replace placeholder/generic operator notes with a concrete 20+ character Metricool review note.",
    };
  }
  if (finalStatus === "rejected") {
    return {
      state: "rejected",
      blocker: "operator_rejected",
      nextAction: "Replace or fix this clip before it can count toward the batch.",
    };
  }
  if (finalStatus === "scheduled") {
    if (!isMetricoolApprovalUrl(approvalUrl)) {
      return {
        state: "needs_fix",
        blocker: "metricool_approval_url_must_be_metricool_url",
        nextAction: "Add the real Metricool approval/scheduled URL before counting this row as scheduled.",
      };
    }
    if (!isPlaceholder(publishedPostUrl) || metricsTotal > 0) {
      return {
        state: "needs_fix",
        blocker: "scheduled_rows_must_not_include_public_url_or_metrics",
        nextAction: "Use final_status=published only after adding a public TikTok video URL and 24h metrics.",
      };
    }
    return {
      state: "scheduled",
      blocker: "waiting_public_post_url",
      nextAction: "Wait until the TikTok is live, then add the public post URL and 24h metrics.",
    };
  }
  if (finalStatus !== "published") {
    return {
      state: "needs_fix",
      blocker: "final_status_must_be_scheduled_published_or_rejected",
      nextAction: "Use scheduled, published, or rejected as final_status.",
    };
  }
  if (!isPlaceholder(approvalUrl) && !isMetricoolApprovalUrl(approvalUrl)) {
    return {
      state: "needs_fix",
      blocker: "metricool_approval_url_must_be_metricool_url",
      nextAction: "Replace the approval proof with a real Metricool URL or leave it blank if unavailable.",
    };
  }
  if (!isTikTokPostUrl(publishedPostUrl)) {
    return {
      state: "needs_fix",
      blocker: "published_post_url_must_be_public_tiktok_url",
      nextAction: "Replace planner/profile/search URL with the public TikTok post URL.",
    };
  }
  if (metricsTotal <= 0) {
    return {
      state: "waiting_metrics",
      blocker: "missing_24h_metrics",
      nextAction: "Add 24h views, likes, comments, or shares before importing analytics.",
    };
  }
  return {
    state: "ready_to_import",
    blocker: "",
    nextAction: "Ready for Metricool evidence import after operator review.",
  };
}

function statusFromTotals(totals) {
  if (totals.needsFix > 0 || totals.rejected > 0) return "needs_evidence_fix";
  if (totals.readyToImport === totals.rows && totals.rows > 0) return "ready_to_import";
  if (totals.waitingMetrics > 0) return "waiting_24h_metrics";
  if (totals.scheduled > 0) return "waiting_live_urls";
  if (totals.notStarted === totals.rows && totals.rows > 0) return "ready_for_metricool_review";
  return "in_progress";
}

function applyVerifierGate(status, verifier) {
  if (status !== "ready_for_metricool_review") return status;
  if (!verifier || verifier.status === "pass") return status;
  return "blocked_verifier";
}

function nextStepForStatus(status, workbook, session, scheduledDir, verifier) {
  if (status === "blocked_verifier") {
    return verifier?.nextStep || "Run TikTok MVP verifier and fix account/Metricool proof blockers before opening Metricool.";
  }
  if (status === "ready_for_metricool_review") {
    return `Process ${workbook.batchId || session.batchId || "metricool-batch-01"} in Metricool using ${path.join(scheduledDir, "metricool-100-current-batch-workbook.csv")}.`;
  }
  if (status === "waiting_live_urls") return "Wait for scheduled TikToks to go live, then add public TikTok URLs.";
  if (status === "waiting_24h_metrics") return "Add 24h metrics for live TikToks before importing analytics.";
  if (status === "ready_to_import") return "Preview and import Metricool evidence after final review.";
  if (status === "needs_evidence_fix") return "Fix rejected or invalid evidence rows before continuing.";
  return "Continue processing remaining rows in Metricool.";
}

function renderMarkdown(summary) {
  return [
    "# Clippers TikTok Batch Tracker",
    "",
    "Batch-level tracker for the active TikTok Metricool batch. It does not count a row as published without a public TikTok URL and real metrics.",
    "",
    `Status: ${summary.status}`,
    `Generated: ${summary.generatedAt}`,
    `Batch: ${summary.batch.id}`,
    `Verifier gate: ${summary.verifierGate.status}`,
    `Batch evidence CSV: ${summary.paths.batchEvidenceCsv}`,
    `Master evidence CSV: ${summary.paths.masterEvidenceCsv} (sync target; do not edit directly)`,
    "",
    "## Totals",
    "",
    `- Rows: ${summary.totals.rows}`,
    `- Not started: ${summary.totals.notStarted}`,
    `- Scheduled: ${summary.totals.scheduled}`,
    `- Waiting metrics: ${summary.totals.waitingMetrics}`,
    `- Ready to import: ${summary.totals.readyToImport}`,
    `- Needs fix: ${summary.totals.needsFix}`,
    `- Rejected: ${summary.totals.rejected}`,
    "",
    "## Next Step",
    "",
    summary.nextStep,
    "",
    "## Rows",
    "",
    ...summary.rows.map((row) => `- #${row.rank} ${row.metricoolQueueItemId} ${row.accountId}: ${row.state}${row.blocker ? ` (${row.blocker})` : ""}; source ${row.sourceVideoValid ? "video ok" : "video blocked"} via ${row.sourceProbe}${row.sourceDurationSeconds ? `, ${row.sourceDurationSeconds}s` : ""}`),
    "",
    "## Operator Copy Packets",
    "",
    ...summary.rows.map((row) => [
      `### Row ${row.rank}: ${row.metricoolQueueItemId}`,
      "```text",
      row.operatorCopyText,
      "```",
      "",
    ].join("\n")),
    "## Guardrails",
    "",
    ...summary.guardrails.map((item) => `- ${item}`),
    "",
  ].join("\n");
}

function renderCsv(summary) {
  const header = ["rank", "metricool_queue_item_id", "account_id", "platform", "metricool_brand_name", "scheduled_for", "source_path", "source_exists", "source_bytes", "source_video_valid", "source_duration_seconds", "source_probe", "caption_seed", "state", "blocker", "next_action", "published_post_url", "views_24h", "likes_24h", "comments_24h", "shares_24h", "operator_copy_text"];
  return [
    header.map(csvCell).join(","),
    ...summary.rows.map((row) => [
      row.rank,
      row.metricoolQueueItemId,
      row.accountId,
      row.platform,
      row.metricoolBrandName,
      row.scheduledFor,
      row.sourcePath,
      row.sourceExists,
      row.sourceBytes,
      row.sourceVideoValid,
      row.sourceDurationSeconds,
      row.sourceProbe,
      row.captionSeed,
      row.state,
      row.blocker,
      row.nextAction,
      row.publishedPostUrl,
      row.views24h,
      row.likes24h,
      row.comments24h,
      row.shares24h,
      row.operatorCopyText,
    ].map(csvCell).join(",")),
  ].join("\n") + "\n";
}

function operatorCopyText(workbookRow, classification, batchEvidenceCsvPath) {
  const lines = [
    `Queue item: ${workbookRow.metricoolQueueItemId || ""}`,
    `Metricool brand: ${workbookRow.metricoolBrandName || ""}`,
    `Account: ${workbookRow.accountName || workbookRow.accountId || ""}`,
    `Platform: ${workbookRow.platform || ""}`,
    `Schedule: ${workbookRow.publishAt || ""}`,
    `Source file: ${workbookRow.sourcePath || ""}`,
    `Caption: ${workbookRow.captionSeed || ""}`,
    `Action: ${workbookRow.metricoolAction || classification.nextAction}`,
    `After live: fill published_post_url and 24h metrics in ${batchEvidenceCsvPath}`,
    "Evidence final_status before live: scheduled. Evidence final_status after live + metrics: published.",
  ];
  return lines.filter(Boolean).join("\n");
}

async function main() {
  await mkdir(reportsDir, { recursive: true });
  const [workbook, session] = await Promise.all([
    readRequiredJson(workbookPath),
    readRequiredJson(sessionPath),
  ]);
  const verifier = await readOptionalJson(verifierPath, null);
  const batchId = String(workbook.batchId || session.batchId || "metricool-batch-01");
  const batchEvidenceCsvPath = path.join(scheduledDir, "metricool-100-batch-evidence-imports", `${batchId}-evidence-import.csv`);
  const evidenceRaw = await readFile(batchEvidenceCsvPath, "utf8").catch(() => "");
  const evidenceRecords = parseCsv(evidenceRaw);
  const evidenceById = new Map(evidenceRecords.map((record) => [String(record.metricool_queue_item_id || ""), record]));
  const workbookRows = Array.isArray(workbook.rows) ? workbook.rows : [];
  if (!workbookRows.length) {
    throw new Error(`Current Metricool batch workbook has no rows: ${workbookPath}`);
  }
  if (workbookRows.length !== 10) {
    throw new Error(`Current Metricool batch workbook must contain 10 rows; found ${workbookRows.length}.`);
  }
  if ((workbook.batchId || session.batchId) && workbook.batchId && session.batchId && workbook.batchId !== session.batchId) {
    throw new Error(`Current workbook batchId ${workbook.batchId} does not match operator session batchId ${session.batchId}.`);
  }
  const rows = await Promise.all(workbookRows.map(async (workbookRow) => {
    const metricoolQueueItemId = String(workbookRow.metricoolQueueItemId || workbookRow.metricool_queue_item_id || "");
    const evidence = evidenceById.get(metricoolQueueItemId) || {};
    const classification = classifyEvidence(evidence, workbookRow);
    const sourceStatus = await sourceFileStatus(workbookRow.sourcePath || evidence.source_path || "");
    const rowState = sourceStatus.sourceBlocker ? "needs_fix" : classification.state;
    const rowBlocker = sourceStatus.sourceBlocker || classification.blocker;
    const rowNextAction = sourceStatus.sourceBlocker
      ? `Restore or replace the local source file before opening Metricool: ${sourceStatus.sourceBlocker}.`
      : classification.nextAction;
    return {
      rank: Number(workbookRow.rank || evidence.rank || 0),
      metricoolQueueItemId,
      accountId: workbookRow.accountId || evidence.account_id || "",
      accountName: workbookRow.accountName || evidence.account_name || "",
      platform: workbookRow.platform || evidence.platform || "",
      metricoolBrandName: workbookRow.metricoolBrandName || evidence.metricool_brand_name || "",
      scheduledFor: evidence.scheduled_for || workbookRow.publishAt || "",
      sourceFileName: workbookRow.sourceFileName || path.basename(String(evidence.source_path || "")),
      sourcePath: workbookRow.sourcePath || evidence.source_path || "",
      captionSeed: workbookRow.captionSeed || evidence.caption_seed || "",
      sourceExists: sourceStatus.sourceExists,
      sourceBytes: sourceStatus.sourceBytes,
      sourceVideoValid: sourceStatus.sourceVideoValid,
      sourceDurationSeconds: sourceStatus.sourceDurationSeconds,
      sourceProbe: sourceStatus.sourceProbe,
      state: rowState,
      blocker: rowBlocker,
      nextAction: rowNextAction,
      metricoolApprovalUrl: isPlaceholder(evidence.metricool_approval_url) ? "" : evidence.metricool_approval_url || "",
      publishedPostUrl: isPlaceholder(evidence.published_post_url) ? "" : evidence.published_post_url || "",
      finalStatus: isPlaceholder(evidence.final_status) ? "" : String(evidence.final_status || "").trim(),
      views24h: numberValue(evidence.views_24h),
      likes24h: numberValue(evidence.likes_24h),
      comments24h: numberValue(evidence.comments_24h),
      shares24h: numberValue(evidence.shares_24h),
      operatorNotes: isPlaceholder(evidence.operator_notes) ? "" : evidence.operator_notes || "",
      operatorCopyText: operatorCopyText(workbookRow, { ...classification, nextAction: rowNextAction }, batchEvidenceCsvPath),
    };
  }));
  const totals = rows.reduce((sum, row) => {
    sum.rows += 1;
    if (row.state === "not_started") sum.notStarted += 1;
    if (row.state === "scheduled") sum.scheduled += 1;
    if (row.state === "waiting_metrics") sum.waitingMetrics += 1;
    if (row.state === "ready_to_import") sum.readyToImport += 1;
    if (row.state === "needs_fix") sum.needsFix += 1;
    if (row.state === "rejected") sum.rejected += 1;
    return sum;
  }, { rows: 0, notStarted: 0, scheduled: 0, waitingMetrics: 0, readyToImport: 0, needsFix: 0, rejected: 0 });
  const sourceStatus = statusFromTotals(totals);
  const status = applyVerifierGate(sourceStatus, verifier);
  const nextStep = nextStepForStatus(status, workbook, session, scheduledDir, verifier);
  const summary = {
    status,
    sourceStatus,
    generatedAt: new Date().toISOString(),
    paths: {
      json: outJsonPath,
      markdown: outMarkdownPath,
      csv: outCsvPath,
      workbook: workbookPath,
      session: sessionPath,
      verifier: verifierPath,
      batchEvidenceCsv: batchEvidenceCsvPath,
      masterEvidenceCsv: masterEvidenceCsvPath,
    },
    verifierGate: {
      status: verifier?.status || "missing",
      launchDecision: verifier?.launchDecision || "unknown",
      blocking: status === "blocked_verifier",
      failed: Number(verifier?.totals?.failed || 0),
      nextStep: verifier?.nextStep || "",
    },
    batch: {
      id: workbook.batchId || session.batchId || "metricool-batch-01",
      rows: workbookRows.length,
      accounts: Array.from(new Set(rows.map((row) => row.accountId))).filter(Boolean).sort(),
      platforms: Array.from(new Set(rows.map((row) => row.platform))).filter(Boolean).sort(),
    },
    totals,
    rows,
    guardrails: [
      "Only the active TikTok Metricool batch is tracked here.",
      "Scheduled rows are not counted as published.",
      "Published rows require a public TikTok URL and nonzero 24h metrics.",
      "Rows with missing or invalid local source files are blocked before Metricool review.",
      "Rows must pass local extension, size, and MP4/MOV signature checks before Metricool review.",
      "TikTok MVP verifier must pass before opening Metricool operator review.",
      "Do not paste tokens, cookies, passwords, private URLs, or screenshots with secrets.",
    ],
    nextStep,
  };
  await writeFile(outJsonPath, JSON.stringify(summary, null, 2));
  await writeFile(outMarkdownPath, renderMarkdown(summary));
  await writeFile(outCsvPath, renderCsv(summary));
  console.log(JSON.stringify({
    status: summary.status,
    batch: summary.batch.id,
    rows: summary.totals.rows,
    notStarted: summary.totals.notStarted,
    scheduled: summary.totals.scheduled,
    waitingMetrics: summary.totals.waitingMetrics,
    readyToImport: summary.totals.readyToImport,
    needsFix: summary.totals.needsFix,
    sourceStatus: summary.sourceStatus,
    verifierGate: summary.verifierGate.status,
    markdownPath: outMarkdownPath,
    nextStep: summary.nextStep,
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
