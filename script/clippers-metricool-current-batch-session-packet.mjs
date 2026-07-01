import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const rootDir = path.join(process.cwd(), "clippers_workspace");
const scheduledDir = path.join(rootDir, "scheduled");
const reportsDir = path.join(rootDir, "reports");
const uploadPackPath = path.join(reportsDir, "clippers-metricool-current-batch-upload-pack.json");
const nextActionPath = path.join(reportsDir, "clippers-tiktok-next-action.json");
const workbookPath = path.join(scheduledDir, "metricool-100-current-batch-workbook.json");
const outJsonPath = path.join(reportsDir, "clippers-metricool-current-batch-session-packet.json");
const outMarkdownPath = path.join(reportsDir, "clippers-metricool-current-batch-session-packet.md");
const outCsvPath = path.join(reportsDir, "clippers-metricool-current-batch-session-packet.csv");

async function readJson(filePath, fallback = {}) {
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

function queueIds(rows) {
  return (rows || []).map((row) => String(row.metricoolQueueItemId || "").trim()).filter(Boolean);
}

function sameSet(left, right) {
  if (left.length !== right.length) return false;
  const rightSet = new Set(right);
  return left.every((item) => rightSet.has(item));
}

function normalizeValue(value) {
  return String(value ?? "").trim();
}

function scheduleFreshness(rows, now = new Date(), minLeadMinutes = 20) {
  const nowTime = now.getTime();
  const minLeadMs = minLeadMinutes * 60 * 1000;
  const invalidRows = [];
  const expiredRows = [];
  const tooSoonRows = [];
  const publishTimes = [];
  for (const row of rows || []) {
    const id = String(row.metricoolQueueItemId || row.rank || "unknown");
    const publishAt = String(row.publishAt || "");
    const publishTime = Date.parse(publishAt);
    if (!Number.isFinite(publishTime)) {
      invalidRows.push(id);
      continue;
    }
    publishTimes.push(publishTime);
    if (publishTime <= nowTime) expiredRows.push(id);
    else if (publishTime - nowTime < minLeadMs) tooSoonRows.push(id);
  }
  return {
    ok: invalidRows.length === 0 && expiredRows.length === 0 && tooSoonRows.length === 0 && publishTimes.length === (rows || []).length,
    invalidRows,
    expiredRows,
    tooSoonRows,
    minLeadMinutes,
    firstPublishAt: publishTimes.length ? new Date(Math.min(...publishTimes)).toISOString() : "",
    lastPublishAt: publishTimes.length ? new Date(Math.max(...publishTimes)).toISOString() : "",
  };
}

function rowMetadataIssues(uploadPack, workbook) {
  const issues = [];
  const workbookById = new Map((workbook.rows || []).map((row) => [normalizeValue(row.metricoolQueueItemId), row]));
  for (const uploadRow of uploadPack.rows || []) {
    const queueItemId = normalizeValue(uploadRow.metricoolQueueItemId);
    const workbookRow = workbookById.get(queueItemId);
    if (!queueItemId || !workbookRow) continue;
    const comparisons = [
      ["accountId", uploadRow.accountId, workbookRow.accountId],
      ["accountName", uploadRow.accountName, workbookRow.accountName],
      ["platform", uploadRow.platform, workbookRow.platform],
      ["metricoolBrandName", uploadRow.metricoolBrandName, workbookRow.metricoolBrandName],
      ["metricoolBlogId", uploadRow.metricoolBlogId, workbookRow.metricoolBlogId],
      ["publishAt", uploadRow.publishAt, workbookRow.publishAt],
      ["sourcePath", uploadRow.sourcePath, workbookRow.sourcePath],
      ["captionSeed", uploadRow.captionSeed, workbookRow.captionSeed],
    ];
    for (const [field, uploadValue, workbookValue] of comparisons) {
      if (normalizeValue(uploadValue) !== normalizeValue(workbookValue)) {
        issues.push(`upload_pack_workbook_${field}_mismatch:${queueItemId}`);
      }
    }
  }
  return issues;
}

function findConsistencyIssues(uploadPack, nextAction, workbook) {
  const issues = [];
  const uploadBatchId = String(uploadPack.batchId || "").trim();
  const nextActionBatchId = String(nextAction.batch?.id || "").trim();
  const workbookBatchId = String(workbook.batchId || "").trim();
  if (!uploadBatchId) issues.push("upload_pack_missing_batch_id");
  if (!nextActionBatchId) issues.push("next_action_missing_batch_id");
  if (!workbookBatchId) issues.push("workbook_missing_batch_id");
  if (uploadBatchId && nextActionBatchId && uploadBatchId !== nextActionBatchId) issues.push("upload_pack_next_action_batch_mismatch");
  if (uploadBatchId && workbookBatchId && uploadBatchId !== workbookBatchId) issues.push("upload_pack_workbook_batch_mismatch");
  const uploadIds = queueIds(uploadPack.rows);
  const workbookIds = queueIds(workbook.rows);
  if (!uploadIds.length) issues.push("upload_pack_missing_queue_item_ids");
  if (!workbookIds.length) issues.push("workbook_missing_queue_item_ids");
  if (uploadIds.length && workbookIds.length && !sameSet(uploadIds, workbookIds)) issues.push("upload_pack_workbook_queue_item_mismatch");
  issues.push(...rowMetadataIssues(uploadPack, workbook));
  const uploadEvidenceCsv = String(uploadPack.paths?.batchEvidenceCsv || "").trim();
  const workbookEvidenceCsv = String(workbook.paths?.batchEvidenceCsv || "").trim();
  if (uploadEvidenceCsv && workbookEvidenceCsv && uploadEvidenceCsv !== workbookEvidenceCsv) issues.push("batch_evidence_csv_mismatch");
  return issues;
}

function statusFor(uploadPack, nextAction, workbook) {
  const consistencyIssues = findConsistencyIssues(uploadPack, nextAction, workbook);
  const scheduleFresh = scheduleFreshness(workbook.rows || []);
  if (nextAction.status !== "ready_for_metricool_scheduling") return { status: "blocked_next_action", consistencyIssues, scheduleFresh };
  if (uploadPack.status !== "ready_for_metricool_upload") return { status: "blocked_upload_pack", consistencyIssues, scheduleFresh };
  if ((uploadPack.totals?.copied || 0) !== (uploadPack.totals?.rows || 0) || (uploadPack.totals?.rows || 0) <= 0) {
    return { status: "blocked_upload_pack", consistencyIssues, scheduleFresh };
  }
  if (consistencyIssues.length) return { status: "blocked_upload_pack", consistencyIssues, scheduleFresh };
  if (!scheduleFresh.ok) return { status: "blocked_schedule_freshness", consistencyIssues, scheduleFresh };
  return { status: "ready_for_metricool_session", consistencyIssues, scheduleFresh };
}

function rowStatus(row, summaryStatus) {
  if (summaryStatus !== "ready_for_metricool_session") return "blocked";
  if (row.status !== "ready_to_upload") return "blocked";
  return "ready_to_schedule";
}

function renderMarkdown(summary) {
  return [
    "# Metricool Current Batch Session Packet",
    "",
    `Generated: ${summary.generatedAt}`,
    `Status: ${summary.status}`,
    `Batch: ${summary.batch.id}`,
    `Upload folder: ${summary.paths.uploadDir}`,
    `Evidence CSV: ${summary.paths.batchEvidenceCsv}`,
    "",
    summary.nextStep,
    "",
    "## Session Order",
    "",
    ...summary.rows.map((row) => [
      `### ${row.rank}. ${row.accountName} / ${row.metricoolBrandName}`,
      `- Status: ${row.status}`,
      `- Upload file: ${row.uploadFileName}`,
      `- Upload path: ${row.uploadFilePath}`,
      `- Schedule: ${row.publishAt}`,
      `- Queue item: ${row.metricoolQueueItemId}`,
      `- Caption: ${row.captionSeed}`,
      `- Evidence after scheduling: ${row.scheduledEvidenceAction}`,
      "",
    ].join("\n")),
    "## Guardrails",
    "",
    ...summary.guardrails.map((guardrail) => `- ${guardrail}`),
    "",
  ].join("\n");
}

function renderCsv(summary) {
  const header = ["rank", "status", "metricool_queue_item_id", "account_id", "account_name", "metricool_brand_name", "metricool_blog_id", "publish_at", "upload_file_name", "upload_file_path", "caption_seed", "scheduled_evidence_action"];
  return [
    header.map(csvCell).join(","),
    ...summary.rows.map((row) => [
      row.rank,
      row.status,
      row.metricoolQueueItemId,
      row.accountId,
      row.accountName,
      row.metricoolBrandName,
      row.metricoolBlogId,
      row.publishAt,
      row.uploadFileName,
      row.uploadFilePath,
      row.captionSeed,
      row.scheduledEvidenceAction,
    ].map(csvCell).join(",")),
  ].join("\n") + "\n";
}

async function main() {
  await mkdir(reportsDir, { recursive: true });
  const [uploadPack, nextAction, workbook] = await Promise.all([
    readJson(uploadPackPath),
    readJson(nextActionPath),
    readJson(workbookPath),
  ]);
  const { status, consistencyIssues, scheduleFresh } = statusFor(uploadPack, nextAction, workbook);
  const rows = (uploadPack.rows || []).map((row) => ({
    rank: row.rank,
    status: rowStatus(row, status),
    metricoolQueueItemId: row.metricoolQueueItemId,
    accountId: row.accountId,
    accountName: row.accountName,
    platform: row.platform,
    metricoolBrandName: row.metricoolBrandName,
    metricoolBlogId: row.metricoolBlogId,
    publishAt: row.publishAt,
    uploadFileName: row.uploadFileName,
    uploadFilePath: row.uploadFilePath,
    captionSeed: row.captionSeed,
    scheduledEvidenceAction: "After scheduling in Metricool, paste the HTTPS Metricool proof URL and concrete operator note into the batch evidence CSV with final_status=scheduled. Leave public TikTok URL and metrics blank until real.",
  }));
  const summary = {
    status,
    generatedAt: new Date().toISOString(),
    mode: "metricool_current_batch_session_packet",
    batch: {
      id: uploadPack.batchId || workbook.batchId || nextAction.batch?.id || "metricool-batch-01",
      nextBatchId: nextAction.batch?.nextBatchId || "",
      rows: rows.length,
    },
    paths: {
      json: outJsonPath,
      markdown: outMarkdownPath,
      csv: outCsvPath,
      uploadPack: uploadPackPath,
      nextAction: nextActionPath,
      workbook: workbookPath,
      uploadDir: uploadPack.paths?.uploadDir || "",
      uploadHtml: uploadPack.paths?.html || "",
      batchEvidenceCsv: uploadPack.paths?.batchEvidenceCsv || workbook.paths?.batchEvidenceCsv || "",
    },
    totals: {
      rows: rows.length,
      ready: rows.filter((row) => row.status === "ready_to_schedule").length,
      blocked: rows.filter((row) => row.status !== "ready_to_schedule").length,
      sport: rows.filter((row) => row.accountId === "sports-daily").length,
      memes: rows.filter((row) => row.accountId === "meme-radar").length,
    },
    consistencyIssues,
    scheduleFreshness: scheduleFresh,
    rows,
    guardrails: [
      "This packet is read-only and never schedules, publishes, imports, creates accounts, or stores secrets.",
      "Use only TikTok SPORT/memes rows for the current MVP.",
      "Metricool remains approval_required; realPublishEnabled remains false.",
      "Scheduled evidence is not published evidence.",
      "Schedule times must be in the future with at least 20 minutes of lead time before opening Metricool.",
      "Public TikTok URLs must be exact https video URLs and metrics must be real 24h metrics.",
    ],
    nextStep: status === "ready_for_metricool_session"
      ? `Open ${uploadPack.paths?.html || uploadPack.paths?.uploadDir || "the upload pack"} and schedule ${rows.length} rows in rank order.`
      : status === "blocked_schedule_freshness"
      ? `Regenerate the Metricool 100 operator handoff/current batch before opening Metricool; schedule times are expired or too close (${[
        scheduleFresh?.invalidRows?.length ? `invalid=${scheduleFresh.invalidRows.join("|")}` : "",
        scheduleFresh?.expiredRows?.length ? `expired=${scheduleFresh.expiredRows.join("|")}` : "",
        scheduleFresh?.tooSoonRows?.length ? `tooSoon=${scheduleFresh.tooSoonRows.join("|")}` : "",
      ].filter(Boolean).join(" ")}).`
      : `Fix ${status}${consistencyIssues.length ? ` (${consistencyIssues.join(", ")})` : ""} before running the Metricool session.`,
  };
  await writeFile(outJsonPath, JSON.stringify(summary, null, 2));
  await writeFile(outMarkdownPath, renderMarkdown(summary));
  await writeFile(outCsvPath, renderCsv(summary));
  console.log(JSON.stringify({
    status: summary.status,
    batchId: summary.batch.id,
    rows: summary.totals.rows,
    ready: summary.totals.ready,
    nextStep: summary.nextStep,
    markdownPath: outMarkdownPath,
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
