import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";

const rootDir = path.join(process.cwd(), "clippers_workspace");
const reportsDir = path.join(rootDir, "reports");
const workbookPath = path.join(rootDir, "scheduled", "metricool-100-current-batch-workbook.json");
const cockpitPath = path.join(reportsDir, "clippers-tiktok-operator-cockpit.json");
const uploadPackPath = path.join(reportsDir, "clippers-metricool-current-batch-upload-pack.json");
const outJsonPath = path.join(reportsDir, "clippers-tiktok-operator-cockpit-preflight.json");
const outMarkdownPath = path.join(reportsDir, "clippers-tiktok-operator-cockpit-preflight.md");
const outCsvPath = path.join(reportsDir, "clippers-tiktok-operator-cockpit-preflight.csv");

const evidenceColumns = [
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

function argValue(name) {
  const inline = process.argv.find((arg) => arg.startsWith(`${name}=`));
  if (inline) return inline.slice(name.length + 1);
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] || "" : "";
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
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
  const rows = lines.map((line) => {
    const cells = parseCsvLine(line);
    return Object.fromEntries(header.map((key, index) => [key, cells[index] || ""]));
  });
  return { header, rows };
}

function csvCell(value) {
  return `"${String(value ?? "").replace(/"/g, '""')}"`;
}

async function existsFile(filePath) {
  const fileStat = await stat(filePath).catch(() => null);
  return Boolean(fileStat?.isFile());
}

async function existsDir(filePath) {
  const fileStat = await stat(filePath).catch(() => null);
  return Boolean(fileStat?.isDirectory());
}

function check(id, label, status, evidence, nextAction) {
  return { id, label, status, evidence, nextAction };
}

function scheduleFreshness(workbookRows, now = new Date(), minLeadMinutes = 20) {
  const nowTime = now.getTime();
  const minLeadMs = minLeadMinutes * 60 * 1000;
  const invalidRows = [];
  const expiredRows = [];
  const tooSoonRows = [];
  const publishTimes = [];
  for (const row of workbookRows) {
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
    ok: invalidRows.length === 0 && expiredRows.length === 0 && tooSoonRows.length === 0 && publishTimes.length === workbookRows.length,
    invalidRows,
    expiredRows,
    tooSoonRows,
    minLeadMinutes,
    firstPublishAt: publishTimes.length ? new Date(Math.min(...publishTimes)).toISOString() : "",
    lastPublishAt: publishTimes.length ? new Date(Math.max(...publishTimes)).toISOString() : "",
  };
}

function renderMarkdown(summary) {
  return [
    "# TikTok Operator Cockpit Preflight",
    "",
    `Status: ${summary.status}`,
    `Generated: ${summary.generatedAt}`,
    `Batch: ${summary.batchId}`,
    "",
    "This preflight verifies local operator artifacts only. It does not publish, schedule, sync evidence, or count views.",
    "",
    "## Checks",
    "",
    ...summary.checks.map((item) => `- ${item.status.toUpperCase()} ${item.id}: ${item.evidence}`),
    "",
    "## Next Step",
    "",
    summary.nextStep,
    "",
    "## Guardrails",
    "",
    ...summary.guardrails.map((guardrail) => `- ${guardrail}`),
    "",
  ].join("\n");
}

function renderCsv(summary) {
  const header = ["id", "label", "status", "evidence", "next_action"];
  return [
    header.map(csvCell).join(","),
    ...summary.checks.map((item) => [
      item.id,
      item.label,
      item.status,
      item.evidence,
      item.nextAction,
    ].map(csvCell).join(",")),
  ].join("\n") + "\n";
}

async function main() {
  await mkdir(reportsDir, { recursive: true });
  const [cockpit, workbook, uploadPack] = await Promise.all([
    readJson(cockpitPath),
    readJson(workbookPath),
    readJson(uploadPackPath),
  ]);
  const checks = [];
  const uploadFolder = cockpit.links?.find((link) => link.id === "upload_folder")?.path || "";
  const uploadHtml = cockpit.paths?.uploadHtml || "";
  const evidenceHtml = cockpit.paths?.evidenceHtml || "";
  const cockpitHtml = cockpit.paths?.html || "";
  const batchEvidenceCsv = cockpit.paths?.batchEvidenceCsv || "";
  const workbookCsv = cockpit.paths?.workbookCsv || "";
  const workbookRows = Array.isArray(workbook.rows) ? workbook.rows : [];
  const workbookIds = new Set(workbookRows.map((row) => String(row.metricoolQueueItemId || "").trim()).filter(Boolean));
  const workbookRowsById = new Map(workbookRows.map((row) => [String(row.metricoolQueueItemId || "").trim(), row]));
  const uploadRows = Array.isArray(uploadPack.rows) ? uploadPack.rows : [];
  const minUploadGeneratedAt = argValue("--min-upload-generated-at");
  const minUploadGeneratedTime = minUploadGeneratedAt ? Date.parse(minUploadGeneratedAt) : 0;
  const uploadGeneratedTime = uploadPack.generatedAt ? Date.parse(uploadPack.generatedAt) : 0;
  const scheduleFresh = scheduleFreshness(workbookRows);

  checks.push(check(
    "cockpit_status",
    "Cockpit status is operable",
    cockpit.status === "ready_for_metricool_operator" || cockpit.status === "waiting_live_evidence" || cockpit.status === "ready_for_import_review" ? "pass" : "fail",
    `cockpit.status=${cockpit.status}`,
    "Refresh/fix cockpit blockers before opening Metricool.",
  ));
  checks.push(check(
    "upload_pack_status",
    "Upload pack is fresh and ready",
    uploadPack.status === "ready_for_metricool_upload" && uploadPack.batchId === (cockpit.batchId || workbook.batchId) ? "pass" : "fail",
    `uploadPack.status=${uploadPack.status || "missing"} uploadPack.batchId=${uploadPack.batchId || "missing"}`,
    "Refresh/fix the upload pack before running the operator cockpit preflight.",
  ));
  if (minUploadGeneratedAt) {
    checks.push(check(
      "upload_pack_fresh_for_request",
      "Upload pack was regenerated for this request",
      Number.isFinite(uploadGeneratedTime) && uploadGeneratedTime >= minUploadGeneratedTime ? "pass" : "fail",
      `uploadPack.generatedAt=${uploadPack.generatedAt || "missing"} min=${minUploadGeneratedAt}`,
      "Rerun the upload pack refresh; do not trust stale upload artifacts.",
    ));
  }
  checks.push(check(
    "schedule_freshness",
    "Current batch schedule times are still usable",
    scheduleFresh.ok ? "pass" : "fail",
    [
      `first=${scheduleFresh.firstPublishAt || "missing"}`,
      `last=${scheduleFresh.lastPublishAt || "missing"}`,
      `minLeadMinutes=${scheduleFresh.minLeadMinutes}`,
      scheduleFresh.invalidRows.length ? `invalid=${scheduleFresh.invalidRows.join("|")}` : "",
      scheduleFresh.expiredRows.length ? `expired=${scheduleFresh.expiredRows.join("|")}` : "",
      scheduleFresh.tooSoonRows.length ? `tooSoon=${scheduleFresh.tooSoonRows.join("|")}` : "",
    ].filter(Boolean).join(" "),
    "Regenerate the Metricool 100 operator handoff/current batch before opening Metricool; at least one schedule time is expired or too close.",
  ));

  for (const [id, filePath, label] of [
    ["cockpit_html", cockpitHtml, "Cockpit HTML exists"],
    ["upload_html", uploadHtml, "Upload console HTML exists"],
    ["evidence_html", evidenceHtml, "Evidence console HTML exists"],
    ["batch_evidence_csv", batchEvidenceCsv, "Current batch evidence CSV exists"],
    ["workbook_csv", workbookCsv, "Current batch workbook CSV exists"],
  ]) {
    checks.push(check(id, label, await existsFile(filePath) ? "pass" : "fail", filePath || "missing_path", "Regenerate the linked artifact before operating the batch."));
  }

  const uploadDirOk = await existsDir(uploadFolder);
  const mp4Files = uploadDirOk ? (await readdir(uploadFolder)).filter((fileName) => fileName.toLowerCase().endsWith(".mp4")) : [];
  checks.push(check(
    "upload_folder_mp4_count",
    "Upload folder has current 10 MP4s",
    uploadDirOk && mp4Files.length === 10 ? "pass" : "fail",
    `folder=${uploadFolder || "missing"} mp4=${mp4Files.length}`,
    "Refresh the upload pack until exactly 10 current-batch MP4s are staged.",
  ));
  const uploadFileNames = new Set(mp4Files);
  const uploadIds = uploadRows.map((row) => String(row.metricoolQueueItemId || "").trim()).filter(Boolean);
  const uniqueUploadIds = new Set(uploadIds);
  const duplicateUploadIds = uploadIds.filter((id, index) => uploadIds.indexOf(id) !== index);
  const missingWorkbookIdsInUpload = [...workbookIds].filter((id) => !uniqueUploadIds.has(id));
  const unexpectedUploadIds = [...uniqueUploadIds].filter((id) => !workbookIds.has(id));
  const malformedUploadRows = uploadRows
    .filter((row) => {
      const id = String(row.metricoolQueueItemId || "").trim();
      const workbookRow = workbookRowsById.get(id);
      return row.status !== "ready_to_upload"
        || !workbookRow
        || !uploadFileNames.has(row.uploadFileName)
        || String(row.sourcePath || "") !== String(workbookRow.sourcePath || "")
        || String(row.accountId || "") !== String(workbookRow.accountId || "")
        || String(row.metricoolBrandName || "") !== String(workbookRow.metricoolBrandName || "")
        || String(row.platform || "") !== String(workbookRow.platform || "")
        || String(row.publishAt || "") !== String(workbookRow.publishAt || "");
    })
    .map((row) => row.metricoolQueueItemId || row.uploadFileName || "unknown");
  checks.push(check(
    "upload_pack_matches_workbook",
    "Upload pack rows match current workbook",
    workbookRows.length === 10
      && uploadRows.length === 10
      && uniqueUploadIds.size === workbookIds.size
      && duplicateUploadIds.length === 0
      && missingWorkbookIdsInUpload.length === 0
      && unexpectedUploadIds.length === 0
      && malformedUploadRows.length === 0 ? "pass" : "fail",
    [
      `workbookRows=${workbookRows.length}`,
      `uploadRows=${uploadRows.length}`,
      duplicateUploadIds.length ? `duplicates=${[...new Set(duplicateUploadIds)].join("|")}` : "",
      missingWorkbookIdsInUpload.length ? `missing=${missingWorkbookIdsInUpload.join("|")}` : "",
      unexpectedUploadIds.length ? `unexpected=${unexpectedUploadIds.join("|")}` : "",
      malformedUploadRows.length ? `mismatches=${malformedUploadRows.join("|")}` : "",
    ].filter(Boolean).join(" "),
    "Regenerate the current batch workbook and upload pack before operator use.",
  ));

  const cockpitHtmlText = cockpitHtml ? await readFile(cockpitHtml, "utf8").catch(() => "") : "";
  const uploadHtmlText = uploadHtml ? await readFile(uploadHtml, "utf8").catch(() => "") : "";
  const evidenceHtmlText = evidenceHtml ? await readFile(evidenceHtml, "utf8").catch(() => "") : "";
  checks.push(check(
    "no_false_publish_wording",
    "Operator HTML avoids false publish wording",
    /ready_to_send|auto publish/i.test(`${cockpitHtmlText}\n${uploadHtmlText}\n${evidenceHtmlText}`) ? "fail" : "pass",
    "checked cockpit/upload/evidence HTML",
    "Remove misleading publish/autopublish wording before operator use.",
  ));
  checks.push(check(
    "html_guardrails_present",
    "HTML guardrails are visible",
    cockpitHtmlText.toLowerCase().includes("no publishing")
      && uploadHtmlText.toLowerCase().includes("does not schedule")
      && evidenceHtmlText.toLowerCase().includes("does not sync") ? "pass" : "fail",
    "checked cockpit/upload/evidence guardrail text",
    "Regenerate HTML consoles with guardrails before operator use.",
  ));

  const evidenceRaw = batchEvidenceCsv ? await readFile(batchEvidenceCsv, "utf8").catch(() => "") : "";
  const evidenceCsv = parseCsv(evidenceRaw);
  const evidenceMissingColumns = evidenceColumns.filter((column) => !evidenceCsv.header.includes(column));
  const evidenceIds = new Set(evidenceCsv.rows.map((row) => String(row.metricool_queue_item_id || "").trim()).filter(Boolean));
  const missingEvidenceIds = [...workbookIds].filter((id) => !evidenceIds.has(id));
  const unexpectedEvidenceIds = [...evidenceIds].filter((id) => !workbookIds.has(id));
  const evidenceRowsWithOperatorData = evidenceCsv.rows.filter((row) => [
    "metricool_approval_url",
    "published_post_url",
    "final_status",
    "views_24h",
    "likes_24h",
    "comments_24h",
    "shares_24h",
    "operator_notes",
  ].some((key) => String(row[key] || "").trim()));
  checks.push(check(
    "evidence_csv_schema",
    "Evidence CSV has expected schema",
    evidenceMissingColumns.length === 0 ? "pass" : "fail",
    evidenceMissingColumns.length ? `missing=${evidenceMissingColumns.join("|")}` : "all expected columns present",
    "Repair/regenerate current batch evidence CSV before recording evidence.",
  ));
  checks.push(check(
    "evidence_csv_current_batch_rows",
    "Evidence CSV has one row per current batch item",
    evidenceCsv.rows.length === workbookRows.length && missingEvidenceIds.length === 0 && unexpectedEvidenceIds.length === 0 ? "pass" : "fail",
    `evidenceRows=${evidenceCsv.rows.length} workbookRows=${workbookRows.length}${missingEvidenceIds.length ? ` missing=${missingEvidenceIds.join("|")}` : ""}${unexpectedEvidenceIds.length ? ` unexpected=${unexpectedEvidenceIds.join("|")}` : ""}`,
    "Regenerate the current batch evidence CSV from the active workbook before operator use.",
  ));
  checks.push(check(
    "evidence_csv_clean_for_operator",
    "Evidence CSV has no already-entered operator evidence",
    evidenceRowsWithOperatorData.length === 0 ? "pass" : "fail",
    `operatorEvidenceRows=${evidenceRowsWithOperatorData.length}`,
    "Use the evidence workflow for the active phase; do not use the upload preflight after operator evidence already exists.",
  ));

  const failed = checks.filter((item) => item.status === "fail").length;
  const summary = {
    status: failed === 0 ? "ready_for_operator" : "blocked",
    generatedAt: new Date().toISOString(),
    batchId: cockpit.batchId || "metricool-batch-01",
    paths: {
      json: outJsonPath,
      markdown: outMarkdownPath,
      csv: outCsvPath,
      cockpit: cockpitPath,
      cockpitHtml,
      uploadHtml,
      evidenceHtml,
      batchEvidenceCsv,
      workbookCsv,
      uploadFolder,
    },
    totals: {
      checks: checks.length,
      passed: checks.length - failed,
      failed,
      uploadMp4Files: mp4Files.length,
    },
    checks,
    guardrails: [
      "Preflight checks local artifacts only.",
      "Preflight does not publish, schedule, sync evidence, or count views.",
      "Metricool remains approval_required and realPublishEnabled remains false.",
      "Public TikTok URLs and 24h metrics must be real before import review.",
    ],
    nextStep: failed === 0
      ? "Open the operator cockpit and process the current batch in Metricool."
      : checks.find((item) => item.id === "schedule_freshness" && item.status === "fail")?.nextAction
        || checks.find((item) => item.status === "fail")?.nextAction
        || "Fix failed preflight checks.",
  };
  await writeFile(outJsonPath, JSON.stringify(summary, null, 2));
  await writeFile(outMarkdownPath, renderMarkdown(summary));
  await writeFile(outCsvPath, renderCsv(summary));
  console.log(JSON.stringify({
    status: summary.status,
    batchId: summary.batchId,
    checks: summary.totals.checks,
    passed: summary.totals.passed,
    failed: summary.totals.failed,
    uploadMp4Files: summary.totals.uploadMp4Files,
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
