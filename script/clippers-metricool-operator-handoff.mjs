import { readFileSync, statSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const rootDir = path.join(process.cwd(), "clippers_workspace");
const scheduledDir = path.join(rootDir, "scheduled");
const reportsDir = path.join(rootDir, "reports");
const approvalRunPath = path.join(scheduledDir, "metricool-100-approval-run.json");
const runSheetPath = path.join(scheduledDir, "metricool-100-operator-run-sheet.csv");
const evidenceCsvPath = path.join(rootDir, "evidence-drop", "metricool-100-approval-evidence-import.csv");
const importedMetricsPath = path.join(rootDir, "metrics", "metricool-approval-imported-metrics.csv");
const trackerPath = path.join(reportsDir, "clippers-tiktok-batch-tracker.json");
const handoffJsonPath = path.join(scheduledDir, "metricool-100-operator-handoff.json");
const handoffMarkdownPath = path.join(scheduledDir, "metricool-100-operator-handoff.md");
const handoffCsvPath = path.join(scheduledDir, "metricool-100-operator-handoff.csv");
const currentBatchJsonPath = path.join(scheduledDir, "metricool-100-current-batch-workbook.json");
const currentBatchMarkdownPath = path.join(scheduledDir, "metricool-100-current-batch-workbook.md");
const currentBatchCsvPath = path.join(scheduledDir, "metricool-100-current-batch-workbook.csv");
const currentBatchSessionJsonPath = path.join(scheduledDir, "metricool-100-current-batch-operator-session.json");
const currentBatchSessionMarkdownPath = path.join(scheduledDir, "metricool-100-current-batch-operator-session.md");
const currentBatchSessionCsvPath = path.join(scheduledDir, "metricool-100-current-batch-operator-session.csv");
const batchWorkbooksDir = path.join(scheduledDir, "metricool-100-batch-workbooks");
const batchEvidenceImportsDir = path.join(scheduledDir, "metricool-100-batch-evidence-imports");
const summaryReportPath = path.join(reportsDir, "clippers-metricool-100-operator-handoff.json");

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

function csvEscape(value) {
  const text = String(value ?? "");
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function emptyEvidenceValue(value) {
  const text = String(value || "").trim();
  return !text || /^"+$/.test(text) || /^<.*>$/.test(text);
}

function realEvidenceValue(value) {
  const text = String(value || "").trim();
  return emptyEvidenceValue(text) ? "" : text;
}

function evidenceByIdFromRaw(raw = "") {
  const rows = parseCsv(raw);
  return new Map(rows.map((record) => [String(record.metricool_queue_item_id || "").trim(), record]));
}

function hasRealEvidence(record = {}) {
  return [
    "metricool_approval_url",
    "published_post_url",
    "final_status",
    "views_24h",
    "likes_24h",
    "comments_24h",
    "shares_24h",
    "operator_notes",
  ].some((key) => realEvidenceValue(record[key]));
}

function mergeEvidenceMaps(...maps) {
  const merged = new Map();
  for (const map of maps) {
    for (const [id, record] of map.entries()) {
      if (!id) continue;
      if (!merged.has(id) || hasRealEvidence(record)) merged.set(id, record);
    }
  }
  return merged;
}

function importedMetricsByQueueId(raw = "") {
  const rows = parseCsv(raw);
  return new Map(rows
    .map((record) => [String(record.metricool_queue_item_id || "").trim(), record])
    .filter(([id]) => Boolean(id)));
}

function hasImportedMetricsApplied(row = {}, evidence = {}, importedMetricsById = new Map()) {
  const imported = importedMetricsById.get(String(row.metricool_queue_item_id || "").trim());
  if (!imported) return false;
  const sourcePath = String(row.source_path || "").trim();
  const importedSourcePath = String(imported.source_file || imported.source_path || "").trim();
  if (!sourcePath || importedSourcePath !== sourcePath) return false;
  const publicUrl = String(evidence.published_post_url || "").trim();
  const importedPublicUrl = String(imported.clip_id || imported.post_url || imported.published_post_url || "").trim();
  if (publicUrl && importedPublicUrl !== publicUrl) return false;
  return true;
}

function preservedEvidenceTemplate(row, existingEvidenceById = new Map()) {
  const existing = existingEvidenceById.get(String(row.metricool_queue_item_id || "").trim()) || {};
  const hasExistingEvidence = hasRealEvidence(existing);
  return {
    metricool_queue_item_id: row.metricool_queue_item_id,
    scheduled_for: hasExistingEvidence ? realEvidenceValue(existing.scheduled_for) : "",
    metricool_approval_url: realEvidenceValue(existing.metricool_approval_url),
    published_post_url: realEvidenceValue(existing.published_post_url),
    final_status: realEvidenceValue(existing.final_status),
    views_24h: realEvidenceValue(existing.views_24h),
    likes_24h: realEvidenceValue(existing.likes_24h),
    comments_24h: realEvidenceValue(existing.comments_24h),
    shares_24h: realEvidenceValue(existing.shares_24h),
    operator_notes: realEvidenceValue(existing.operator_notes),
  };
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

function classifyBatchEvidence(record = {}) {
  const finalStatus = String(record.final_status || "").trim().toLowerCase();
  const approvalUrl = String(record.metricool_approval_url || "").trim();
  const publishedPostUrl = String(record.published_post_url || "").trim();
  const operatorNotes = String(record.operator_notes || "").trim();
  const metricsTotal = numberValue(record.views_24h) + numberValue(record.likes_24h) + numberValue(record.comments_24h) + numberValue(record.shares_24h);
  const hasTouch = !isPlaceholder(approvalUrl) || !isPlaceholder(publishedPostUrl) || !isPlaceholder(finalStatus) || !isPlaceholder(operatorNotes) || metricsTotal > 0;
  if (!hasTouch) return { state: "not_started", blocker: "waiting_metricool_review", completeForMetricoolReview: false };
  if (finalStatus === "approved") return { state: "needs_fix", blocker: "approved_status_not_allowed_for_tiktok_batch_use_scheduled", completeForMetricoolReview: false };
  const noteIssues = validateOperatorNotes(operatorNotes, finalStatus);
  if (noteIssues.length) return { state: "needs_fix", blocker: noteIssues.join(","), completeForMetricoolReview: false };
  if (finalStatus === "rejected") return { state: "rejected", blocker: "operator_rejected", completeForMetricoolReview: false };
  if (finalStatus === "scheduled") {
    if (!isMetricoolApprovalUrl(approvalUrl)) return { state: "needs_fix", blocker: "metricool_approval_url_must_be_metricool_url", completeForMetricoolReview: false };
    if (!isPlaceholder(publishedPostUrl) || metricsTotal > 0) return { state: "needs_fix", blocker: "scheduled_rows_must_not_include_public_url_or_metrics", completeForMetricoolReview: false };
    return { state: "scheduled", blocker: "waiting_public_post_url", completeForMetricoolReview: false };
  }
  if (finalStatus !== "published") return { state: "needs_fix", blocker: "final_status_must_be_scheduled_published_or_rejected", completeForMetricoolReview: false };
  if (!isPlaceholder(approvalUrl) && !isMetricoolApprovalUrl(approvalUrl)) return { state: "needs_fix", blocker: "metricool_approval_url_must_be_metricool_url", completeForMetricoolReview: false };
  if (!isTikTokPostUrl(publishedPostUrl)) return { state: "needs_fix", blocker: "published_post_url_must_be_public_tiktok_url", completeForMetricoolReview: false };
  if (metricsTotal <= 0) return { state: "waiting_metrics", blocker: "missing_24h_metrics", completeForMetricoolReview: false };
  return { state: "ready_to_import", blocker: "", completeForMetricoolReview: true };
}

function batchEvidenceProgress(batch, rows, existingEvidenceById = new Map(), importedMetricsById = new Map()) {
  const batchRows = batch ? rows.slice(batch.startRank - 1, batch.endRank) : rows.slice(0, 10);
  const totals = batchRows.reduce((sum, row) => {
    const record = existingEvidenceById.get(String(row.metricool_queue_item_id || "").trim()) || {};
    const evidence = classifyBatchEvidence(record);
    sum.rows += 1;
    if (evidence.state === "not_started") sum.notStarted += 1;
    if (evidence.state === "scheduled") sum.scheduled += 1;
    if (evidence.state === "waiting_metrics") sum.waitingMetrics += 1;
    if (evidence.state === "ready_to_import") sum.readyToImport += 1;
    if (evidence.state === "ready_to_import" && hasImportedMetricsApplied(row, record, importedMetricsById)) sum.importApplied += 1;
    if (evidence.state === "needs_fix") sum.needsFix += 1;
    if (evidence.state === "rejected") sum.rejected += 1;
    if (evidence.completeForMetricoolReview) sum.completeForMetricoolReview += 1;
    return sum;
  }, { rows: 0, notStarted: 0, scheduled: 0, waitingMetrics: 0, readyToImport: 0, importApplied: 0, needsFix: 0, rejected: 0, completeForMetricoolReview: 0 });
  const complete = totals.rows > 0 && totals.importApplied === totals.rows && totals.needsFix === 0 && totals.rejected === 0;
  const status = complete
    ? "metricool_review_complete"
    : totals.needsFix > 0 || totals.rejected > 0
      ? "needs_evidence_fix"
      : totals.scheduled > 0
        ? "waiting_public_posts"
        : totals.waitingMetrics > 0
          ? "waiting_24h_metrics"
          : totals.readyToImport > 0
            ? "ready_for_import_apply"
            : "not_started";
  return { status, complete, totals };
}

function accountSlug(row) {
  return row.account_id || row.accountId || "unknown";
}

function normalizeTikTokMetricoolAction(value) {
  return String(value || "")
    .replace(/approve\/schedule/gi, "schedule")
    .replace(/approve or schedule/gi, "schedule")
    .replace(/approved or scheduled/gi, "scheduled")
    .replace(/Metricool-approved/gi, "Metricool-scheduled");
}

function buildBatch(rows, index, trackerById = new Map()) {
  const startRank = index * 10 + 1;
  const items = rows.slice(index * 10, index * 10 + 10);
  const id = `metricool-batch-${String(index + 1).padStart(2, "0")}`;
  const batchEvidenceCsv = path.join(batchEvidenceImportsDir, `${id}-evidence-import.csv`);
  const accounts = Array.from(new Set(items.map(accountSlug))).sort();
  const platforms = Array.from(new Set(items.map((row) => row.platform || "unknown"))).sort();
  const firstScheduledFor = items[0]?.scheduled_for || items[0]?.publish_at || "";
  const lastScheduledFor = items[items.length - 1]?.scheduled_for || items[items.length - 1]?.publish_at || "";
  const sourceGateTotals = items.reduce((totals, row) => {
    const trackerRow = trackerById.get(row.metricool_queue_item_id);
    const sourceGate = sourceGateFromTracker({
      metricoolQueueItemId: row.metricool_queue_item_id,
      sourcePath: row.source_path,
    }, trackerRow);
    totals.rows += 1;
    if (sourceGate.status === "ready") totals.ready += 1;
    if (sourceGate.status === "blocked_source_file") totals.blocked += 1;
    if (sourceGate.status === "pending_verification") totals.pending += 1;
    return totals;
  }, { rows: 0, ready: 0, blocked: 0, pending: 0 });
  const sourcesReady = sourceGateTotals.rows > 0
    && sourceGateTotals.ready === sourceGateTotals.rows
    && sourceGateTotals.blocked === 0
    && sourceGateTotals.pending === 0;
  return {
    id,
    rank: index + 1,
    status: sourcesReady ? "ready_for_metricool_review" : "blocked_source_verification",
    startRank,
    endRank: startRank + items.length - 1,
    items: items.length,
    accounts,
    platforms,
    firstScheduledFor,
    lastScheduledFor,
    sourceGateTotals,
    operatorAction: sourcesReady
      ? "Review these rows in Metricool, upload/verify source media, schedule manually, then fill scheduled evidence for sequencing."
      : "Stop before Metricool; refresh TikTok tracker and repair blocked/pending source files for this batch.",
    evidenceAction: sourcesReady
      ? `After scheduling in Metricool, fill ${batchEvidenceCsv} with final_status=scheduled, Metricool URL, and real notes. Add public URLs/24h metrics only after posts are live.`
      : "Do not fill evidence for this batch until all source gates are ready.",
    batchEvidenceCsv,
  };
}

function renderMarkdown(summary) {
  return [
    "# Clippers Metricool 100 Operator Handoff",
    "",
    "Approval-required handoff for the 100-clip Metricool run. This file does not publish, does not prove posts are live, and does not count views.",
    "",
    `Status: ${summary.status}`,
    `Generated: ${summary.generatedAt}`,
    `Schedule roll-forward: ${summary.scheduleRollForward?.applied ? `${summary.scheduleRollForward.reason} (${summary.scheduleRollForward.rowsAdjusted} rows)` : summary.scheduleRollForward?.reason || "not_applied"}`,
    `Run sheet: ${summary.paths.runSheet}`,
    `Current batch evidence CSV (operator fills this): ${summary.operatorConsole.paths.currentBatchEvidenceCsv}`,
    `Master evidence CSV (sync target; do not edit directly): ${summary.paths.evidenceCsv}`,
    "",
    "## Guardrails",
    "",
    ...summary.guardrails.map((guardrail) => `- ${guardrail}`),
    "",
    "## Totals",
    "",
    `- Rows: ${summary.totals.rows}`,
    `- Batches: ${summary.totals.batches}`,
    `- Sports rows: ${summary.totals.sports}`,
    `- Meme rows: ${summary.totals.memes}`,
    `- Streamer rows: ${summary.totals.streamers}`,
    `- Ready to send: ${summary.totals.readyToSend}`,
    "",
    "## Operator Console",
    "",
    `- Current batch: ${summary.operatorConsole.currentBatchId}`,
    `- Batch rows: ${summary.operatorConsole.currentBatchRows}`,
    `- Evidence CSV status: ${summary.operatorConsole.evidenceCsvStatus}`,
    `- Published rows counted: ${summary.operatorConsole.publishedRowsCounted}`,
    "",
    "### Checklist",
    "",
    ...summary.operatorConsole.checklist.map((item) => `- [ ] ${item}`),
    "",
    "### Evidence fields",
    "",
    ...summary.operatorConsole.evidenceFields.map((item) => `- ${item}`),
    "",
    "### Batch workbooks",
    "",
    ...summary.operatorConsole.batchWorkbooks.map((workbook) => `- ${workbook.batchId}: ${workbook.rows} rows -> workbook ${workbook.csvPath}; evidence ${workbook.evidenceCsvPath}`),
    "",
    "## Batches",
    "",
    ...summary.batches.flatMap((batch) => [
      `### ${batch.rank}. ${batch.id}`,
      "",
      `- Status: ${batch.status}`,
      `- Rows: ${batch.startRank}-${batch.endRank}`,
      `- Accounts: ${batch.accounts.join(", ") || "unknown"}`,
      `- Platforms: ${batch.platforms.join(", ") || "unknown"}`,
      `- Window: ${batch.firstScheduledFor} -> ${batch.lastScheduledFor}`,
      `- Operator: ${batch.operatorAction}`,
      `- Evidence: ${batch.evidenceAction}`,
      `- Import applied: ${batch.evidenceProgress?.totals?.importApplied || 0}/${batch.evidenceProgress?.totals?.rows || 0}`,
      "",
    ]),
    "## Next Step",
    "",
    summary.nextStep,
    "",
  ].join("\n");
}

function renderCsv(summary) {
  const header = ["rank", "batch_id", "status", "start_rank", "end_rank", "items", "accounts", "platforms", "first_scheduled_for", "last_scheduled_for", "operator_action", "evidence_action"];
  return [
    header.map(csvEscape).join(","),
    ...summary.batches.map((batch) => [
      batch.rank,
      batch.id,
      batch.status,
      batch.startRank,
      batch.endRank,
      batch.items,
      batch.accounts.join(" | "),
      batch.platforms.join(" | "),
      batch.firstScheduledFor,
      batch.lastScheduledFor,
      batch.operatorAction,
      batch.evidenceAction,
    ].map(csvEscape).join(",")),
  ].join("\n");
}

function renderRunSheetCsv(rows) {
  const header = [
    "rank",
    "metricool_queue_item_id",
    "account_id",
    "account_name",
    "platform",
    "metricool_brand_name",
    "metricool_blog_id",
    "publish_at",
    "source_file_name",
    "source_path",
    "caption_seed",
    "queue_status",
    "metricool_action",
    "evidence_action",
  ];
  return [
    header.map(csvEscape).join(","),
    ...rows.map((row) => [
      row.rank,
      row.metricool_queue_item_id,
      row.account_id,
      row.account_name,
      row.platform,
      row.metricool_brand_name,
      row.metricool_blog_id,
      row.publish_at || row.scheduled_for,
      row.source_file_name,
      row.source_path,
      row.caption_seed,
      row.queue_status,
      row.metricool_action,
      row.evidence_action,
    ].map(csvEscape).join(",")),
  ].join("\n") + "\n";
}

function scheduleTime(row) {
  const value = row.publish_at || row.scheduled_for || "";
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function rollForwardPendingSchedules(rows, existingEvidenceById = new Map(), now = new Date(), minLeadMinutes = 20) {
  const pendingRows = rows.filter((row) => !hasRealEvidence(existingEvidenceById.get(String(row.metricool_queue_item_id || "").trim()) || {}));
  if (!pendingRows.length) return { rows, applied: false, reason: "no_pending_rows", deltaMs: 0, firstBefore: "", firstAfter: "", rowsAdjusted: 0 };
  const pendingTimes = pendingRows.map(scheduleTime).filter((value) => Number.isFinite(value) && value > 0);
  if (pendingTimes.length !== pendingRows.length) {
    const base = now.getTime() + 90 * 60 * 1000;
    let sequence = 0;
    const updatedRows = rows.map((row) => {
      const id = String(row.metricool_queue_item_id || "").trim();
      if (hasRealEvidence(existingEvidenceById.get(id) || {})) return row;
      const publishAt = new Date(base + sequence * 20 * 60 * 1000).toISOString();
      sequence += 1;
      return {
        ...row,
        publish_at: publishAt,
        scheduled_for: publishAt,
        metricool_action: `Upload/review ${row.source_file_name} in Metricool brand ${row.metricool_brand_name}; schedule for ${publishAt}.`,
      };
    });
    return {
      rows: updatedRows,
      applied: true,
      reason: "invalid_pending_schedule_times",
      deltaMs: 0,
      firstBefore: "",
      firstAfter: updatedRows.find((row) => !hasRealEvidence(existingEvidenceById.get(String(row.metricool_queue_item_id || "").trim()) || {}))?.publish_at || "",
      rowsAdjusted: pendingRows.length,
    };
  }
  const minPendingTime = Math.min(...pendingTimes);
  const minAllowedTime = now.getTime() + minLeadMinutes * 60 * 1000;
  if (minPendingTime > minAllowedTime) {
    return {
      rows,
      applied: false,
      reason: "pending_schedules_still_fresh",
      deltaMs: 0,
      firstBefore: new Date(minPendingTime).toISOString(),
      firstAfter: new Date(minPendingTime).toISOString(),
      rowsAdjusted: 0,
    };
  }
  const targetFirstTime = now.getTime() + 90 * 60 * 1000;
  const deltaMs = targetFirstTime - minPendingTime;
  const updatedRows = rows.map((row) => {
    const id = String(row.metricool_queue_item_id || "").trim();
    if (hasRealEvidence(existingEvidenceById.get(id) || {})) return row;
    const currentTime = scheduleTime(row);
    const publishAt = new Date(currentTime + deltaMs).toISOString();
    return {
      ...row,
      publish_at: publishAt,
      scheduled_for: publishAt,
      metricool_action: `Upload/review ${row.source_file_name} in Metricool brand ${row.metricool_brand_name}; schedule for ${publishAt}.`,
    };
  });
  return {
    rows: updatedRows,
    applied: true,
    reason: "pending_schedules_rolled_forward",
    deltaMs,
    firstBefore: new Date(minPendingTime).toISOString(),
    firstAfter: new Date(targetFirstTime).toISOString(),
    rowsAdjusted: pendingRows.length,
  };
}

function summarizeScheduleRollForward(rollForward) {
  const { rows: _rows, ...summary } = rollForward;
  return summary;
}

async function existingEvidenceByIdForRollForward(rows, existingMasterEvidenceById = new Map()) {
  const maps = [existingMasterEvidenceById];
  const totalBatches = Math.ceil(rows.length / 10);
  for (let index = 0; index < totalBatches; index += 1) {
    const id = `metricool-batch-${String(index + 1).padStart(2, "0")}`;
    const batchEvidenceCsv = path.join(batchEvidenceImportsDir, `${id}-evidence-import.csv`);
    const raw = await readFile(batchEvidenceCsv, "utf8").catch(() => "");
    maps.push(evidenceByIdFromRaw(raw));
  }
  return mergeEvidenceMaps(...maps);
}

function batchWorkbookPaths(batch) {
  const batchId = batch?.id || "metricool-batch-01";
  return {
    json: path.join(batchWorkbooksDir, `${batchId}-workbook.json`),
    markdown: path.join(batchWorkbooksDir, `${batchId}-workbook.md`),
    csv: path.join(batchWorkbooksDir, `${batchId}-workbook.csv`),
    batchEvidenceCsv: path.join(batchEvidenceImportsDir, `${batchId}-evidence-import.csv`),
  };
}

function buildCurrentBatchWorkbook(batch, rows, evidenceFields, paths = {
  json: currentBatchJsonPath,
  markdown: currentBatchMarkdownPath,
  csv: currentBatchCsvPath,
  batchEvidenceCsv: batch ? path.join(batchEvidenceImportsDir, `${batch.id}-evidence-import.csv`) : path.join(batchEvidenceImportsDir, "metricool-batch-01-evidence-import.csv"),
}, existingEvidenceById = new Map()) {
  const batchRows = batch ? rows.slice(batch.startRank - 1, batch.endRank) : rows.slice(0, 10);
  const sourcesReady = !batch || batch.status === "ready_for_metricool_review";
  return {
    status: sourcesReady ? "ready_for_metricool_review" : "blocked_source_verification",
    generatedAt: new Date().toISOString(),
    batchId: batch?.id || "metricool-batch-01",
    batchRows: batch ? `${batch.startRank}-${batch.endRank}` : "1-10",
    rows: batchRows.map((row) => ({
      rank: row.rank,
      metricoolQueueItemId: row.metricool_queue_item_id,
      accountId: row.account_id,
      accountName: row.account_name,
      platform: row.platform,
      metricoolBrandName: row.metricool_brand_name,
      metricoolBlogId: row.metricool_blog_id,
      publishAt: row.publish_at || row.scheduled_for,
      sourceFileName: row.source_file_name,
      sourcePath: row.source_path,
      captionSeed: row.caption_seed,
      queueStatus: row.queue_status,
      metricoolAction: normalizeTikTokMetricoolAction(row.metricool_action),
      evidenceAction: row.evidence_action,
      evidenceTemplate: preservedEvidenceTemplate(row, existingEvidenceById),
    })),
    evidenceFields,
    guardrails: [
      "This workbook is for the current Metricool batch only.",
      "Use final_status=scheduled after Metricool scheduling; use published only after public post URL and 24h metrics are real.",
      "Do not count these rows as published until final_status=published, published_post_url, and 24h metrics are real.",
      "Do not paste tokens, cookies, passwords, private URLs, or screenshots with secrets.",
    ],
    paths: {
      json: paths.json,
      markdown: paths.markdown,
      csv: paths.csv,
      batchEvidenceCsv: paths.batchEvidenceCsv,
      sourceRunSheet: runSheetPath,
      evidenceCsv: evidenceCsvPath,
    },
    nextStep: sourcesReady
      ? `Open Metricool and process ${batch?.id || "metricool-batch-01"} only; keep this workbook as the checklist for the 10 rows.`
      : `Stop before Metricool; ${batch?.id || "metricool-batch-01"} has blocked or pending source verification.`,
  };
}

function renderCurrentBatchMarkdown(workbook) {
  return [
    "# Metricool Current Batch Workbook",
    "",
    `Status: ${workbook.status}`,
    `Generated: ${workbook.generatedAt}`,
    `Batch: ${workbook.batchId}`,
    `Rows: ${workbook.batchRows}`,
    "",
    "## Guardrails",
    "",
    ...workbook.guardrails.map((guardrail) => `- ${guardrail}`),
    "",
    "## Rows",
    "",
    ...workbook.rows.flatMap((row) => [
      `### ${row.rank}. ${row.metricoolQueueItemId}`,
      "",
      `- Account: ${row.accountName} (${row.accountId})`,
      `- Platform: ${row.platform}`,
      `- Metricool brand: ${row.metricoolBrandName} (${row.metricoolBlogId})`,
      `- Publish at: ${row.publishAt}`,
      `- Source: ${row.sourceFileName}`,
      `- Source path: ${row.sourcePath}`,
      `- Caption: ${row.captionSeed}`,
      `- Metricool action: ${row.metricoolAction}`,
      `- Evidence action: ${row.evidenceAction}`,
      "",
    ]),
    "## Evidence Fields",
    "",
    ...workbook.evidenceFields.map((field) => `- ${field}`),
    "",
    "## Next Step",
    "",
    workbook.nextStep,
    "",
  ].join("\n");
}

function renderCurrentBatchCsv(workbook) {
  const header = [
    "rank",
    "metricool_queue_item_id",
    "account_id",
    "account_name",
    "platform",
    "metricool_brand_name",
    "metricool_blog_id",
    "publish_at",
    "source_file_name",
    "source_path",
    "caption_seed",
    "metricool_action",
    "metricool_approval_url",
    "published_post_url",
    "final_status",
    "views_24h",
    "likes_24h",
    "comments_24h",
    "shares_24h",
    "operator_notes",
  ];
  return [
    header.map(csvEscape).join(","),
    ...workbook.rows.map((row) => [
      row.rank,
      row.metricoolQueueItemId,
      row.accountId,
      row.accountName,
      row.platform,
      row.metricoolBrandName,
      row.metricoolBlogId,
      row.publishAt,
      row.sourceFileName,
      row.sourcePath,
      row.captionSeed,
      row.metricoolAction,
      row.evidenceTemplate.metricool_approval_url,
      row.evidenceTemplate.published_post_url,
      row.evidenceTemplate.final_status,
      row.evidenceTemplate.views_24h,
      row.evidenceTemplate.likes_24h,
      row.evidenceTemplate.comments_24h,
      row.evidenceTemplate.shares_24h,
      row.evidenceTemplate.operator_notes,
    ].map(csvEscape).join(",")),
  ].join("\n");
}

function renderBatchEvidenceImportCsv(workbook) {
  const header = [
    "metricool_queue_item_id",
    "account_id",
    "account_name",
    "platform",
    "metricool_brand_name",
    "metricool_blog_id",
    "scheduled_for",
    "source_path",
    "caption_seed",
    "metricool_approval_url",
    "published_post_url",
    "final_status",
    "views_24h",
    "likes_24h",
    "comments_24h",
    "shares_24h",
    "operator_notes",
  ];
  return [
    header.map(csvEscape).join(","),
    ...workbook.rows.map((row) => [
      row.metricoolQueueItemId,
      row.accountId,
      row.accountName,
      row.platform,
      row.metricoolBrandName,
      row.metricoolBlogId,
      row.evidenceTemplate.scheduled_for || row.publishAt,
      row.sourcePath,
      row.captionSeed,
      row.evidenceTemplate.metricool_approval_url,
      row.evidenceTemplate.published_post_url,
      row.evidenceTemplate.final_status,
      row.evidenceTemplate.views_24h,
      row.evidenceTemplate.likes_24h,
      row.evidenceTemplate.comments_24h,
      row.evidenceTemplate.shares_24h,
      row.evidenceTemplate.operator_notes,
    ].map(csvEscape).join(",")),
  ].join("\n");
}

function renderMasterEvidenceImportCsv(rows, existingRaw = "") {
  const header = [
    "metricool_queue_item_id",
    "account_id",
    "account_name",
    "platform",
    "metricool_brand_name",
    "metricool_blog_id",
    "scheduled_for",
    "source_path",
    "caption_seed",
    "metricool_approval_url",
    "published_post_url",
    "final_status",
    "views_24h",
    "likes_24h",
    "comments_24h",
    "shares_24h",
    "operator_notes",
  ];
  const existingById = new Map(parseCsv(existingRaw).map((record) => [String(record.metricool_queue_item_id || "").trim(), record]));
  return [
    header.map(csvEscape).join(","),
    ...rows.map((row) => {
      const existing = existingById.get(String(row.metricool_queue_item_id || "").trim()) || {};
      return [
        row.metricool_queue_item_id,
        row.account_id,
        row.account_name,
        row.platform,
        row.metricool_brand_name,
        row.metricool_blog_id,
        row.publish_at || row.scheduled_for,
        row.source_path,
        row.caption_seed,
        realEvidenceValue(existing.metricool_approval_url),
        realEvidenceValue(existing.published_post_url),
        realEvidenceValue(existing.final_status),
        realEvidenceValue(existing.views_24h),
        realEvidenceValue(existing.likes_24h),
        realEvidenceValue(existing.comments_24h),
        realEvidenceValue(existing.shares_24h),
        realEvidenceValue(existing.operator_notes),
      ].map(csvEscape).join(",");
    }),
  ].join("\n") + "\n";
}

function sourceGateFromLocalPath(sourcePath) {
  const text = String(sourcePath || "").trim();
  if (!text) return { status: "pending_verification", detail: "source path missing" };
  try {
    const fileStat = statSync(text);
    if (!fileStat.isFile()) return { status: "blocked_source_file", detail: "source_file_missing" };
    const ext = path.extname(text).toLowerCase();
    if (![".mp4", ".mov", ".m4v"].includes(ext)) return { status: "blocked_source_file", detail: "source_file_unsupported_extension" };
    if (fileStat.size < 1024) return { status: "blocked_source_file", detail: "source_file_too_small" };
    const signature = readFileSync(text).subarray(0, 4096).toString("latin1");
    if (!signature.includes("ftyp")) return { status: "blocked_source_file", detail: "source_file_probe_failed" };
    return { status: "ready", detail: `${fileStat.size} bytes, local ftyp probe` };
  } catch {
    return { status: "blocked_source_file", detail: "source_file_missing" };
  }
}

function sourceGateFromTracker(row, trackerRow) {
  const localGate = sourceGateFromLocalPath(row.sourcePath || trackerRow?.sourcePath);
  if (localGate.status !== "ready") return localGate;
  if (!trackerRow) {
    return localGate;
  }
  if (trackerRow.sourceExists === false || trackerRow.sourceVideoValid === false || String(trackerRow.blocker || "").startsWith("source_file_")) {
    return {
      status: "blocked_source_file",
      detail: trackerRow.blocker || "source_file_invalid",
    };
  }
  if (trackerRow.sourceExists === true && trackerRow.sourceVideoValid === true) {
    return {
      status: "ready",
      detail: [
        trackerRow.sourceBytes ? `${trackerRow.sourceBytes} bytes` : localGate.detail,
        trackerRow.sourceDurationSeconds ? `${trackerRow.sourceDurationSeconds}s` : "",
        trackerRow.sourceProbe || "",
      ].filter(Boolean).join(", "),
    };
  }
  return {
    ...localGate,
    detail: `${localGate.detail}; tracker validation missing`,
  };
}

function buildCurrentBatchOperatorSession(workbook, trackerById = new Map()) {
  return {
    status: "ready_for_operator",
    generatedAt: new Date().toISOString(),
    batchId: workbook.batchId,
    rows: workbook.rows.map((row) => {
      const trackerRow = trackerById.get(row.metricoolQueueItemId);
      const sourceGate = sourceGateFromTracker(row, trackerRow);
      const operatorStatus = sourceGate.status === "ready" ? "needs_metricool_review" : sourceGate.status;
      const nextAction = sourceGate.status === "ready"
        ? "Review/upload/schedule this row in Metricool; do not fill published evidence until a public post URL exists."
        : "Stop before Metricool; refresh or repair the local source before scheduling.";
      const operatorCopyText = [
        `Queue item: ${row.metricoolQueueItemId}`,
        `Metricool brand: ${row.metricoolBrandName}`,
        `Account: ${row.accountName}`,
        `Platform: ${row.platform}`,
        `Schedule: ${row.publishAt}`,
        `Source file: ${row.sourcePath}`,
        `Caption: ${row.captionSeed}`,
        `Action: ${nextAction}`,
        `Batch evidence CSV: ${workbook.paths.batchEvidenceCsv || ""}`,
        "Before live: use final_status=scheduled with a Metricool HTTPS URL and real notes.",
        "After live: use final_status=published only with exact public TikTok URL and nonzero 24h metrics.",
      ].join("\n");
      return {
        rank: row.rank,
        metricoolQueueItemId: row.metricoolQueueItemId,
        accountId: row.accountId,
        accountName: row.accountName,
        platform: row.platform,
        metricoolBrandName: row.metricoolBrandName,
        metricoolBlogId: row.metricoolBlogId,
        publishAt: row.publishAt,
        sourcePath: row.sourcePath,
        captionSeed: row.captionSeed,
        sourceGate: sourceGate.status,
        sourceGateDetail: sourceGate.detail,
        sourceBytes: trackerRow?.sourceBytes || 0,
        sourceDurationSeconds: trackerRow?.sourceDurationSeconds || 0,
        sourceProbe: trackerRow?.sourceProbe || "",
        trackerState: trackerRow?.state || "unknown",
        trackerBlocker: trackerRow?.blocker || "",
        operatorStatus,
        evidenceStatus: "waiting_live_post",
        nextAction,
        operatorCopyText,
      };
    }),
    checklist: [
      "Open Metricool and select the listed brand/account for each row.",
      "Process only this batch before moving to the next batch.",
      "Upload or verify source media and caption in Metricool.",
      "Only operate rows whose source_gate is ready.",
      "Schedule manually in Metricool; do not mark as published inside Clippers.",
      "After scheduling, fill final_status=scheduled, Metricool URL, and real operator notes so the next batch can start.",
      "After the post is live, add public TikTok URL and 24h metrics before importing analytics.",
    ],
    doneCriteria: [
      "All rows in this batch were reviewed in Metricool.",
      "No row is counted as published without final_status=published and a public post URL.",
      "No token, cookie, password, private screenshot, or private URL was pasted into evidence.",
      "If posts are only scheduled, evidence remains waiting_live_post.",
    ],
    paths: {
      json: currentBatchSessionJsonPath,
      markdown: currentBatchSessionMarkdownPath,
      csv: currentBatchSessionCsvPath,
      workbookCsv: workbook.paths.csv,
      batchEvidenceCsv: workbook.paths.batchEvidenceCsv || "",
      globalEvidenceCsv: evidenceCsvPath,
    },
    nextStep: `Open Metricool and process ${workbook.batchId}; after scheduling, fill ${workbook.paths.batchEvidenceCsv || evidenceCsvPath} with scheduled evidence. Add public URLs and 24h metrics only after posts are live.`,
  };
}

function renderCurrentBatchOperatorSessionMarkdown(session) {
  return [
    "# Metricool Current Batch Operator Session",
    "",
    `Status: ${session.status}`,
    `Generated: ${session.generatedAt}`,
    `Batch: ${session.batchId}`,
    `Workbook CSV: ${session.paths.workbookCsv}`,
    `Batch evidence CSV: ${session.paths.batchEvidenceCsv}`,
    "",
    "## Checklist",
    "",
    ...session.checklist.map((item) => `- [ ] ${item}`),
    "",
    "## Rows",
    "",
    ...session.rows.flatMap((row) => [
      `### ${row.rank}. ${row.metricoolQueueItemId}`,
      "",
      `- Account: ${row.accountName} (${row.accountId})`,
      `- Platform: ${row.platform}`,
      `- Metricool brand: ${row.metricoolBrandName} (${row.metricoolBlogId})`,
      `- Publish at: ${row.publishAt}`,
      `- Source: ${row.sourcePath}`,
      `- Source gate: ${row.sourceGate} (${row.sourceGateDetail})`,
      `- Status: ${row.operatorStatus} / ${row.evidenceStatus}`,
      `- Next action: ${row.nextAction}`,
      "",
      "```text",
      row.operatorCopyText,
      "```",
      "",
    ]),
    "## Done Criteria",
    "",
    ...session.doneCriteria.map((item) => `- ${item}`),
    "",
    "## Next Step",
    "",
    session.nextStep,
    "",
  ].join("\n");
}

function renderCurrentBatchOperatorSessionCsv(session) {
  const header = [
    "rank",
    "metricool_queue_item_id",
    "account_id",
    "account_name",
    "platform",
    "metricool_brand_name",
    "metricool_blog_id",
    "publish_at",
    "source_path",
    "caption_seed",
    "source_gate",
    "source_gate_detail",
    "source_bytes",
    "source_duration_seconds",
    "source_probe",
    "tracker_state",
    "tracker_blocker",
    "operator_status",
    "evidence_status",
    "next_action",
    "operator_copy_text",
  ];
  return [
    header.map(csvEscape).join(","),
    ...session.rows.map((row) => [
      row.rank,
      row.metricoolQueueItemId,
      row.accountId,
      row.accountName,
      row.platform,
      row.metricoolBrandName,
      row.metricoolBlogId,
      row.publishAt,
      row.sourcePath,
      row.captionSeed,
      row.sourceGate,
      row.sourceGateDetail,
      row.sourceBytes,
      row.sourceDurationSeconds,
      row.sourceProbe,
      row.trackerState,
      row.trackerBlocker,
      row.operatorStatus,
      row.evidenceStatus,
      row.nextAction,
      row.operatorCopyText,
    ].map(csvEscape).join(",")),
  ].join("\n");
}

async function main() {
  const approvalRun = JSON.parse(await readFile(approvalRunPath, "utf8"));
  let rows = parseCsv(await readFile(runSheetPath, "utf8"));
  const existingEvidenceRaw = await readFile(evidenceCsvPath, "utf8").catch(() => "");
  const importedMetricsRaw = await readFile(importedMetricsPath, "utf8").catch(() => "");
  const existingMasterEvidenceById = evidenceByIdFromRaw(existingEvidenceRaw);
  const importedMetricsById = importedMetricsByQueueId(importedMetricsRaw);
  const rollForwardEvidenceById = await existingEvidenceByIdForRollForward(rows, existingMasterEvidenceById);
  const rollForward = rollForwardPendingSchedules(rows, rollForwardEvidenceById);
  rows = rollForward.rows;
  const tracker = JSON.parse(await readFile(trackerPath, "utf8").catch(() => '{"rows":[]}'));
  const trackerById = new Map((tracker.rows || []).map((row) => [row.metricoolQueueItemId, row]));
  if (approvalRun.realPublishEnabled !== false) throw new Error("Metricool handoff blocked: realPublishEnabled must be false.");
  if (approvalRun.approvalRequired !== true) throw new Error("Metricool handoff blocked: approvalRequired must be true.");
  if ((approvalRun.totals?.readyToSend || 0) !== 0) throw new Error("Metricool handoff blocked: readyToSend must be zero.");
  if (approvalRun.status !== "ready_for_operator") throw new Error(`Metricool handoff blocked: approval run status is ${approvalRun.status || "missing"}.`);
  if (rows.length !== 100) throw new Error(`Metricool handoff blocked: expected 100 run sheet rows, found ${rows.length}.`);
  const unsafeRow = rows.find((row) => row.status === "ready_to_send" || row.queue_status === "ready_to_send" || /true/i.test(row.can_send_now || ""));
  if (unsafeRow) throw new Error(`Metricool handoff blocked: row ${unsafeRow.rank || unsafeRow.metricool_queue_item_id || "unknown"} can send now.`);

  const batches = Array.from({ length: Math.ceil(rows.length / 10) }, (_, index) => buildBatch(rows, index, trackerById));
  const totals = rows.reduce((sum, row) => {
    const id = accountSlug(row);
    sum.rows += 1;
    if (id.includes("sports")) sum.sports += 1;
    if (id.includes("meme")) sum.memes += 1;
    if (id.includes("streamer")) sum.streamers += 1;
    return sum;
  }, { rows: 0, batches: batches.length, sports: 0, memes: 0, streamers: 0, readyToSend: approvalRun.totals?.readyToSend || 0 });
  const evidenceFields = [
    "metricool_queue_item_id",
    "metricool_approval_url",
    "published_post_url",
    "final_status=scheduled|published|rejected",
    "views_24h",
    "likes_24h",
    "comments_24h",
    "shares_24h",
    "operator_notes",
  ];
  const batchEvidenceMapsById = new Map();
  for (const batch of batches) {
    const paths = batchWorkbookPaths(batch);
    const batchEvidenceRaw = await readFile(paths.batchEvidenceCsv, "utf8").catch(() => "");
    const batchEvidenceById = mergeEvidenceMaps(existingMasterEvidenceById, evidenceByIdFromRaw(batchEvidenceRaw));
    batchEvidenceMapsById.set(batch.id, batchEvidenceById);
    batch.evidenceProgress = batchEvidenceProgress(batch, rows, batchEvidenceById, importedMetricsById);
  }
  const firstIncompleteBatch = batches.find((batch) => !batch.evidenceProgress?.complete) || batches[batches.length - 1] || null;
  const currentBatch = firstIncompleteBatch;
  const currentBatchEvidenceRaw = await readFile(currentBatch?.batchEvidenceCsv || path.join(batchEvidenceImportsDir, "metricool-batch-01-evidence-import.csv"), "utf8").catch(() => "");
  const currentBatchEvidenceById = batchEvidenceMapsById.get(currentBatch?.id) || mergeEvidenceMaps(existingMasterEvidenceById, evidenceByIdFromRaw(currentBatchEvidenceRaw));
  const currentBatchWorkbook = buildCurrentBatchWorkbook(currentBatch, rows, evidenceFields, undefined, currentBatchEvidenceById);
  const currentBatchOperatorSession = buildCurrentBatchOperatorSession(currentBatchWorkbook, trackerById);
  const currentBatchSourceGateTotals = currentBatchOperatorSession.rows.reduce((totals, row) => {
    totals.rows += 1;
    if (row.sourceGate === "ready") totals.ready += 1;
    if (row.sourceGate === "blocked_source_file") totals.blocked += 1;
    if (row.sourceGate === "pending_verification") totals.pending += 1;
    return totals;
  }, { rows: 0, ready: 0, blocked: 0, pending: 0 });
  const currentBatchSourcesReady = currentBatchSourceGateTotals.rows > 0
    && currentBatchSourceGateTotals.ready === currentBatchSourceGateTotals.rows
    && currentBatchSourceGateTotals.blocked === 0
    && currentBatchSourceGateTotals.pending === 0;
  const allBatchesSourcesReady = batches.length > 0 && batches.every((batch) => batch.status === "ready_for_metricool_review");
  currentBatchOperatorSession.status = currentBatchSourcesReady ? "ready_for_operator" : "blocked_source_verification";
  currentBatchOperatorSession.nextStep = currentBatchSourcesReady
    ? currentBatchOperatorSession.nextStep
    : "Stop before Metricool; refresh TikTok batch tracker and repair blocked/pending source files before operating this batch.";
  const batchWorkbooks = [];
  for (const batch of batches) {
    const paths = batchWorkbookPaths(batch);
    const batchEvidenceById = batchEvidenceMapsById.get(batch.id) || existingMasterEvidenceById;
    batchWorkbooks.push(buildCurrentBatchWorkbook(batch, rows, evidenceFields, paths, batchEvidenceById));
  }
  const batchWorkbookSummaries = batchWorkbooks.map((workbook) => ({
    batchId: workbook.batchId,
    status: workbook.status,
    evidenceStatus: batches.find((batch) => batch.id === workbook.batchId)?.evidenceProgress?.status || "not_started",
    rows: workbook.rows.length,
    jsonPath: workbook.paths.json,
    markdownPath: workbook.paths.markdown,
    csvPath: workbook.paths.csv,
    evidenceCsvPath: workbook.paths.batchEvidenceCsv,
  }));

  const summary = {
    status: allBatchesSourcesReady ? "ready_for_operator" : "blocked_source_verification",
    generatedAt: new Date().toISOString(),
    paths: {
      json: handoffJsonPath,
      markdown: handoffMarkdownPath,
      csv: handoffCsvPath,
      runSheet: runSheetPath,
      evidenceCsv: evidenceCsvPath,
      approvalRun: approvalRunPath,
    },
    scheduleRollForward: summarizeScheduleRollForward(rollForward),
    totals,
    batches,
    operatorConsole: {
      status: allBatchesSourcesReady ? "ready_for_metricool_review" : "blocked_source_verification",
      currentBatchId: currentBatch?.id || "metricool-batch-01",
      currentBatchRows: currentBatch ? `${currentBatch.startRank}-${currentBatch.endRank}` : "1-10",
      currentBatchEvidenceStatus: currentBatch?.evidenceProgress?.status || "not_started",
      completedBatches: batches.filter((batch) => batch.evidenceProgress?.complete).length,
      evidenceCsvStatus: "fill_current_batch_csv_only_after_metricool_review",
      publishedRowsCounted: 0,
      checklist: [
        "Open Metricool and select the SPORT/memes brand/account shown in the run sheet.",
        "Process only the current batch first; do not mark any row as published inside Clippers yet.",
        "Upload or verify each source media file in Metricool before scheduling.",
        "Keep posts in Metricool review/scheduled state until the operator confirms them manually.",
        "After scheduling in Metricool, fill the current batch evidence CSV with final_status=scheduled, Metricool URL, and real notes.",
        "After public posts exist, add public post URL and 24h metrics before importing analytics.",
      ],
      evidenceFields,
      paths: {
        runSheet: runSheetPath,
        evidenceCsv: evidenceCsvPath,
        currentBatchJson: currentBatchJsonPath,
        currentBatchMarkdown: currentBatchMarkdownPath,
        currentBatchCsv: currentBatchCsvPath,
        currentBatchSessionJson: currentBatchSessionJsonPath,
        currentBatchSessionMarkdown: currentBatchSessionMarkdownPath,
        currentBatchSessionCsv: currentBatchSessionCsvPath,
        batchWorkbooksDir,
        batchEvidenceImportsDir,
        currentBatchEvidenceCsv: currentBatchWorkbook.paths.batchEvidenceCsv || "",
      },
      currentBatchWorkbook: {
        status: currentBatchWorkbook.status,
        rows: currentBatchWorkbook.rows.length,
        jsonPath: currentBatchWorkbook.paths.json,
        markdownPath: currentBatchWorkbook.paths.markdown,
        csvPath: currentBatchWorkbook.paths.csv,
      },
      currentBatchOperatorSession: {
        status: currentBatchOperatorSession.status,
        rows: currentBatchOperatorSession.rows.length,
        sourceGateTotals: currentBatchSourceGateTotals,
        jsonPath: currentBatchOperatorSession.paths.json,
        markdownPath: currentBatchOperatorSession.paths.markdown,
        csvPath: currentBatchOperatorSession.paths.csv,
      },
      batchWorkbooks: batchWorkbookSummaries,
      nextStep: currentBatchSourcesReady
        ? currentBatch?.evidenceProgress?.complete
          ? "All Metricool batches have scheduling evidence; wait for public URLs and 24h metrics before importing analytics."
          : `Start with ${currentBatch?.id || "metricool-batch-01"} (${currentBatch ? `${currentBatch.startRank}-${currentBatch.endRank}` : "1-10"}), fill scheduled evidence after Metricool scheduling, and leave published evidence blank until public URLs and 24h metrics exist.`
        : "Stop before Metricool; current batch source verification is not fully ready.",
    },
    guardrails: [
      "Metricool remains approval_required; this handoff cannot publish automatically.",
      "realPublishEnabled is false and readyToSend is zero.",
      "queued_for_approval is not published.",
      "Fill public post URLs and 24h metrics only after posts are live.",
      "Never paste tokens, cookies, passwords, recovery codes, private screenshots, or secret URLs into evidence CSVs.",
    ],
    nextStep: allBatchesSourcesReady
      ? currentBatch?.evidenceProgress?.complete
        ? "All Metricool batches have scheduling evidence; wait for public URLs and 24h metrics before importing analytics."
        : `Open Metricool and process batch ${currentBatch?.id || "01"} first; after scheduling, fill ${currentBatchWorkbook.paths.batchEvidenceCsv || currentBatch?.batchEvidenceCsv || evidenceCsvPath} with scheduled evidence.`
      : currentBatchSourcesReady
        ? "Stop before scaling beyond batch 01; one or more later batches has blocked or pending source verification."
        : "Stop before Metricool; refresh tracker and repair source verification before operating batch 01.",
  };

  await mkdir(scheduledDir, { recursive: true });
  await mkdir(reportsDir, { recursive: true });
  await mkdir(batchWorkbooksDir, { recursive: true });
  await mkdir(batchEvidenceImportsDir, { recursive: true });
  if (rollForward.applied) await writeFile(runSheetPath, renderRunSheetCsv(rows));
  await writeFile(handoffJsonPath, JSON.stringify(summary, null, 2));
  await writeFile(handoffMarkdownPath, renderMarkdown(summary));
  await writeFile(handoffCsvPath, renderCsv(summary));
  await writeFile(currentBatchJsonPath, JSON.stringify(currentBatchWorkbook, null, 2));
  await writeFile(currentBatchMarkdownPath, renderCurrentBatchMarkdown(currentBatchWorkbook));
  await writeFile(currentBatchCsvPath, renderCurrentBatchCsv(currentBatchWorkbook));
  await writeFile(currentBatchSessionJsonPath, JSON.stringify(currentBatchOperatorSession, null, 2));
  await writeFile(currentBatchSessionMarkdownPath, renderCurrentBatchOperatorSessionMarkdown(currentBatchOperatorSession));
  await writeFile(currentBatchSessionCsvPath, renderCurrentBatchOperatorSessionCsv(currentBatchOperatorSession));
  await writeFile(evidenceCsvPath, renderMasterEvidenceImportCsv(rows, existingEvidenceRaw));
  for (const workbook of batchWorkbooks) {
    await writeFile(workbook.paths.json, JSON.stringify(workbook, null, 2));
    await writeFile(workbook.paths.markdown, renderCurrentBatchMarkdown(workbook));
    await writeFile(workbook.paths.csv, renderCurrentBatchCsv(workbook));
    await writeFile(workbook.paths.batchEvidenceCsv, renderBatchEvidenceImportCsv(workbook));
  }
  await writeFile(summaryReportPath, JSON.stringify(summary, null, 2));
  console.log(JSON.stringify({
    status: summary.status,
    rows: summary.totals.rows,
    batches: summary.totals.batches,
    sports: summary.totals.sports,
    memes: summary.totals.memes,
    streamers: summary.totals.streamers,
    readyToSend: summary.totals.readyToSend,
    markdownPath: summary.paths.markdown,
    csvPath: summary.paths.csv,
    nextStep: summary.nextStep,
  }, null, 2));
}

main().catch((error) => {
  console.error(error?.message || error);
  process.exit(1);
});
