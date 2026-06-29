import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";

const rootDir = path.join(process.cwd(), "clippers_workspace");
const scheduledDir = path.join(rootDir, "scheduled");
const reportsDir = path.join(rootDir, "reports");
const evidenceCsvPath = path.join(rootDir, "evidence-drop", "metricool-100-approval-evidence-import.csv");
const handoffJsonPath = path.join(scheduledDir, "metricool-100-operator-handoff.json");
const currentBatchWorkbookPath = path.join(scheduledDir, "metricool-100-current-batch-workbook.json");
const currentBatchSessionPath = path.join(scheduledDir, "metricool-100-current-batch-operator-session.json");
const outJsonPath = path.join(reportsDir, "clippers-tiktok-launch-control.json");
const outMarkdownPath = path.join(reportsDir, "clippers-tiktok-launch-control.md");
const outCsvPath = path.join(reportsDir, "clippers-tiktok-launch-control.csv");

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

function numberValue(value) {
  const parsed = Number(String(value || "").replace(/,/g, "").trim());
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

async function readJson(filePath, fallback = null) {
  const raw = await readFile(filePath, "utf8").catch(() => null);
  if (!raw) return fallback;
  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

async function sourceFileStatus(sourcePath) {
  const text = String(sourcePath || "").trim();
  if (!text) return { valid: false, blocker: "source_file_missing" };
  const fileStat = await stat(text).catch(() => null);
  if (!fileStat?.isFile()) return { valid: false, blocker: "source_file_missing" };
  const ext = path.extname(text).toLowerCase();
  if (![".mp4", ".mov", ".m4v"].includes(ext)) return { valid: false, blocker: "source_file_unsupported_extension" };
  if (fileStat.size < 1024) return { valid: false, blocker: "source_file_too_small" };
  const header = await readFile(text).catch(() => Buffer.alloc(0));
  const signature = header.subarray(0, 4096).toString("latin1");
  if (!signature.includes("ftyp")) return { valid: false, blocker: "source_file_probe_failed" };
  return { valid: true, blocker: "" };
}

async function classifyEvidenceRow(row, workbookRow) {
  const sourceStatus = await sourceFileStatus(workbookRow?.sourcePath || row.source_path);
  if (!sourceStatus.valid) return { state: "needs_fix", blocker: sourceStatus.blocker };
  const finalStatus = String(row.final_status || "").trim().toLowerCase();
  const metricoolApprovalUrl = String(row.metricool_approval_url || "").trim();
  const publishedPostUrl = String(row.published_post_url || "").trim();
  const operatorNotes = String(row.operator_notes || "").trim();
  const metricsTotal = numberValue(row.views_24h) + numberValue(row.likes_24h) + numberValue(row.comments_24h) + numberValue(row.shares_24h);
  const hasOperatorTouch = !isPlaceholder(metricoolApprovalUrl)
    || !isPlaceholder(publishedPostUrl)
    || !isPlaceholder(finalStatus)
    || metricsTotal > 0;

  if (!hasOperatorTouch) return { state: "not_started", blocker: "waiting_metricool_review" };
  if (finalStatus === "approved") return { state: "needs_fix", blocker: "approved_status_not_allowed_for_tiktok_batch_use_scheduled" };
  const noteIssues = validateOperatorNotes(operatorNotes, finalStatus);
  if (noteIssues.length) return { state: "needs_fix", blocker: noteIssues.join(",") };
  if (finalStatus === "rejected") return { state: "rejected", blocker: "operator_rejected" };
  if (finalStatus === "scheduled") {
    if (!isMetricoolApprovalUrl(metricoolApprovalUrl)) return { state: "needs_fix", blocker: "metricool_approval_url_must_be_metricool_url" };
    if (!isPlaceholder(publishedPostUrl) || metricsTotal > 0) return { state: "needs_fix", blocker: "scheduled_rows_must_not_include_public_url_or_metrics" };
    return { state: "scheduled", blocker: "waiting_public_post_url" };
  }
  if (finalStatus !== "published") return { state: "needs_fix", blocker: "final_status_must_be_published_or_scheduled" };
  if (!isTikTokPostUrl(publishedPostUrl)) return { state: "needs_fix", blocker: "published_post_url_must_be_tiktok" };
  if (metricsTotal <= 0) return { state: "waiting_metrics", blocker: "missing_24h_metrics" };
  return { state: "ready_to_import", blocker: "" };
}

function statusFromTotals(totals) {
  if (totals.needsFix > 0 || totals.rejected > 0) return "needs_evidence_fix";
  if (totals.readyToImport > 0) return "ready_to_import_metrics";
  if (totals.waitingMetrics > 0) return "waiting_24h_metrics";
  if (totals.scheduled > 0) return "waiting_live_urls";
  if (totals.notStarted === totals.rows) return "ready_for_metricool_review";
  return "in_progress";
}

function renderMarkdown(summary) {
  return [
    "# Clippers TikTok Launch Control",
    "",
    "Control report for the TikTok-only Metricool MVP. It does not publish and does not count rows as published without real TikTok URLs and metrics.",
    "",
    `Status: ${summary.status}`,
    `Generated: ${summary.generatedAt}`,
    `Current batch: ${summary.currentBatch.id}`,
    `Evidence CSV: ${summary.paths.evidenceCsv}`,
    "",
    "## Totals",
    "",
    `- Rows: ${summary.totals.rows}`,
    `- TikTok rows: ${summary.totals.tiktok}`,
    `- Instagram rows: ${summary.totals.instagram}`,
    `- YouTube rows: ${summary.totals.youtube}`,
    `- Not started: ${summary.totals.notStarted}`,
    `- Scheduled: ${summary.totals.scheduled}`,
    `- Waiting 24h metrics: ${summary.totals.waitingMetrics}`,
    `- Ready to import: ${summary.totals.readyToImport}`,
    `- Needs fix: ${summary.totals.needsFix}`,
    `- Rejected: ${summary.totals.rejected}`,
    "",
    "## Current Batch",
    "",
    `- Rows: ${summary.currentBatch.rows}`,
    `- Accounts: ${summary.currentBatch.accounts.join(", ") || "none"}`,
    `- Platforms: ${summary.currentBatch.platforms.join(", ") || "none"}`,
    `- Workbook: ${summary.paths.currentBatchWorkbook}`,
    `- Operator session: ${summary.paths.currentBatchSession}`,
    "",
    "## Next Step",
    "",
    summary.nextStep,
    "",
    "## Guardrails",
    "",
    ...summary.guardrails.map((item) => `- ${item}`),
    "",
    "## Sample Rows",
    "",
    ...summary.rows.slice(0, 10).map((row) => `- ${row.metricoolQueueItemId}: ${row.accountId}/${row.platform} -> ${row.state}${row.blocker ? ` (${row.blocker})` : ""}`),
    "",
  ].join("\n");
}

function renderCsv(summary) {
  const header = ["metricool_queue_item_id", "account_id", "platform", "scheduled_for", "state", "blocker", "published_post_url", "views_24h", "likes_24h", "comments_24h", "shares_24h"];
  return [
    header.map(csvCell).join(","),
    ...summary.rows.map((row) => [
      row.metricoolQueueItemId,
      row.accountId,
      row.platform,
      row.scheduledFor,
      row.state,
      row.blocker,
      row.publishedPostUrl,
      row.views24h,
      row.likes24h,
      row.comments24h,
      row.shares24h,
    ].map(csvCell).join(",")),
  ].join("\n") + "\n";
}

async function main() {
  await mkdir(reportsDir, { recursive: true });
  const [handoff, workbook, session, evidenceRaw] = await Promise.all([
    readJson(handoffJsonPath, {}),
    readJson(currentBatchWorkbookPath, {}),
    readJson(currentBatchSessionPath, {}),
    readFile(evidenceCsvPath, "utf8").catch(() => ""),
  ]);
  const records = parseCsv(evidenceRaw);
  const workbookById = new Map((workbook.rows || []).map((row) => [String(row.metricoolQueueItemId || "").trim(), row]));
  const rows = await Promise.all(records.map(async (record) => {
    const queueItemId = String(record.metricool_queue_item_id || "").trim();
    const classification = await classifyEvidenceRow(record, workbookById.get(queueItemId));
    return {
      metricoolQueueItemId: queueItemId,
      accountId: record.account_id || "",
      accountName: record.account_name || "",
      platform: record.platform || "",
      scheduledFor: record.scheduled_for || "",
      state: classification.state,
      blocker: classification.blocker,
      metricoolApprovalUrl: isPlaceholder(record.metricool_approval_url) ? "" : record.metricool_approval_url || "",
      publishedPostUrl: isPlaceholder(record.published_post_url) ? "" : record.published_post_url || "",
      views24h: numberValue(record.views_24h),
      likes24h: numberValue(record.likes_24h),
      comments24h: numberValue(record.comments_24h),
      shares24h: numberValue(record.shares_24h),
    };
  }));
  const currentBatchIds = new Set((workbook.rows || []).map((row) => row.metricoolQueueItemId));
  const currentBatchRows = rows.filter((row) => currentBatchIds.has(row.metricoolQueueItemId));
  const totals = rows.reduce((sum, row) => {
    sum.rows += 1;
    if (row.platform === "tiktok") sum.tiktok += 1;
    if (row.platform === "instagram") sum.instagram += 1;
    if (row.platform === "youtube") sum.youtube += 1;
    if (row.state === "not_started") sum.notStarted += 1;
    if (row.state === "scheduled") sum.scheduled += 1;
    if (row.state === "waiting_metrics") sum.waitingMetrics += 1;
    if (row.state === "ready_to_import") sum.readyToImport += 1;
    if (row.state === "needs_fix") sum.needsFix += 1;
    if (row.state === "rejected") sum.rejected += 1;
    return sum;
  }, { rows: 0, tiktok: 0, instagram: 0, youtube: 0, notStarted: 0, scheduled: 0, waitingMetrics: 0, readyToImport: 0, needsFix: 0, rejected: 0 });
  const status = statusFromTotals(totals);
  const nextStep = status === "ready_for_metricool_review"
    ? `Open Metricool and process ${workbook.batchId || "metricool-batch-01"} using ${currentBatchCsvLabel()}.`
    : status === "waiting_live_urls"
      ? "Wait until scheduled TikToks are live, then add public TikTok post URLs."
      : status === "waiting_24h_metrics"
        ? "Add 24h metrics before importing analytics."
        : status === "ready_to_import_metrics"
          ? "Run Metricool evidence import after reviewing importable rows."
          : "Fix rejected/invalid evidence rows before importing.";
  const summary = {
    status,
    generatedAt: new Date().toISOString(),
    paths: {
      json: outJsonPath,
      markdown: outMarkdownPath,
      csv: outCsvPath,
      evidenceCsv: evidenceCsvPath,
      handoff: handoffJsonPath,
      currentBatchWorkbook: currentBatchWorkbookPath,
      currentBatchSession: currentBatchSessionPath,
    },
    currentBatch: {
      id: workbook.batchId || session.batchId || handoff?.operatorConsole?.currentBatchId || "metricool-batch-01",
      rows: currentBatchRows.length,
      accounts: Array.from(new Set(currentBatchRows.map((row) => row.accountId))).sort(),
      platforms: Array.from(new Set(currentBatchRows.map((row) => row.platform))).sort(),
    },
    totals,
    rows,
    guardrails: [
      "TikTok is the only active MVP platform in this control report.",
      "A row is not published until final_status=published, a public TikTok post URL, and real metrics exist.",
      "Metricool planner URLs are not public post URLs.",
      "Do not paste tokens, cookies, passwords, private URLs, or screenshots with secrets.",
    ],
    nextStep,
  };
  await writeFile(outJsonPath, JSON.stringify(summary, null, 2));
  await writeFile(outMarkdownPath, renderMarkdown(summary));
  await writeFile(outCsvPath, renderCsv(summary));
  console.log(JSON.stringify({
    status: summary.status,
    rows: summary.totals.rows,
    tiktok: summary.totals.tiktok,
    instagram: summary.totals.instagram,
    youtube: summary.totals.youtube,
    notStarted: summary.totals.notStarted,
    scheduled: summary.totals.scheduled,
    waitingMetrics: summary.totals.waitingMetrics,
    readyToImport: summary.totals.readyToImport,
    currentBatch: summary.currentBatch,
    markdownPath: outMarkdownPath,
    nextStep: summary.nextStep,
  }, null, 2));
}

function currentBatchCsvLabel() {
  return path.join(scheduledDir, "metricool-100-current-batch-workbook.csv");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
