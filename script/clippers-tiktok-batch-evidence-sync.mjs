import { execFile } from "node:child_process";
import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const rootDir = path.join(process.cwd(), "clippers_workspace");
const scheduledDir = path.join(rootDir, "scheduled");
const reportsDir = path.join(rootDir, "reports");
const workbookPath = path.join(scheduledDir, "metricool-100-current-batch-workbook.json");
const batchWorkbooksDir = path.join(scheduledDir, "metricool-100-batch-workbooks");
const masterEvidencePath = path.join(rootDir, "evidence-drop", "metricool-100-approval-evidence-import.csv");
const outJsonPath = path.join(reportsDir, "clippers-tiktok-batch-evidence-sync.json");
const outMarkdownPath = path.join(reportsDir, "clippers-tiktok-batch-evidence-sync.md");
const outCsvPath = path.join(reportsDir, "clippers-tiktok-batch-evidence-sync.csv");
const execFileAsync = promisify(execFile);
const allBatchesMode = process.argv.includes("--all-batches");

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

function renderCsv(records, header) {
  return [
    header.map(csvCell).join(","),
    ...records.map((record) => header.map((key) => csvCell(record[key] || "")).join(",")),
  ].join("\n") + "\n";
}

function isPlaceholder(value) {
  const text = String(value || "").trim();
  return !text || /^<.*>$/.test(text) || /\bpaste\b|\bplaceholder\b|\bafter live\b|\bafter 24h\b/i.test(text);
}

function hasSecretSignal(record) {
  const text = Object.values(record).join(" ").toLowerCase();
  return /\b(token|password|passwd|secret|cookie|bearer|authorization|recovery code|api[_ -]?key)\b/.test(text);
}

function normalized(value) {
  return String(value || "").trim().toLowerCase();
}

function rowHasOperatorTouch(record) {
  return !isPlaceholder(record.metricool_approval_url)
    || !isPlaceholder(record.published_post_url)
    || !isPlaceholder(record.final_status)
    || !isPlaceholder(record.operator_notes)
    || Number(String(record.views_24h || "").replace(/,/g, "")) > 0
    || Number(String(record.likes_24h || "").replace(/,/g, "")) > 0
    || Number(String(record.comments_24h || "").replace(/,/g, "")) > 0
    || Number(String(record.shares_24h || "").replace(/,/g, "")) > 0;
}

function numberValue(value) {
  const parsed = Number(String(value || "").replace(/,/g, "").trim());
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
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

async function sourceFileStatus(sourcePath) {
  const text = String(sourcePath || "").trim();
  if (!text) return { valid: false, blocker: "source_file_missing" };
  const fileStat = await stat(text).catch(() => null);
  if (!fileStat?.isFile()) return { valid: false, blocker: "source_file_missing" };
  const ext = path.extname(text).toLowerCase();
  if (![".mp4", ".mov", ".m4v"].includes(ext)) return { valid: false, blocker: "source_file_unsupported_extension" };
  if (fileStat.size < 1024) return { valid: false, blocker: "source_file_too_small" };
  try {
    const { stdout } = await execFileAsync("ffprobe", [
      "-v",
      "error",
      "-select_streams",
      "v:0",
      "-show_entries",
      "stream=codec_type,duration:format=duration",
      "-of",
      "json",
      text,
    ], { timeout: 5000, maxBuffer: 1024 * 1024 });
    const probe = JSON.parse(stdout || "{}");
    const stream = Array.isArray(probe.streams) ? probe.streams.find((item) => item.codec_type === "video") : null;
    const durationCandidates = [Number(stream?.duration), Number(probe.format?.duration)].filter((value) => Number.isFinite(value));
    const duration = durationCandidates.length ? Math.max(...durationCandidates) : 0;
    if (!stream) return { valid: false, blocker: "source_file_not_video" };
    if (!Number.isFinite(duration) || duration <= 0) return { valid: false, blocker: "source_file_invalid_duration" };
    return { valid: true, blocker: "" };
  } catch (error) {
    if (error?.code && error.code !== "ENOENT") {
      return { valid: false, blocker: "source_file_probe_failed" };
    }
    const header = await readFile(text).catch(() => Buffer.alloc(0));
    const signature = header.subarray(0, 4096).toString("latin1");
    return { valid: signature.includes("ftyp"), blocker: signature.includes("ftyp") ? "" : "source_file_probe_failed" };
  }
}

function validateOperatorEvidence(record) {
  if (!rowHasOperatorTouch(record)) return [];
  const issues = [];
  const finalStatus = String(record.final_status || "").trim().toLowerCase();
  const approvalUrl = String(record.metricool_approval_url || "").trim();
  const publishedPostUrl = String(record.published_post_url || "").trim();
  const metricsTotal = numberValue(record.views_24h) + numberValue(record.likes_24h) + numberValue(record.comments_24h) + numberValue(record.shares_24h);
  if (!["scheduled", "published", "rejected"].includes(finalStatus)) {
    issues.push("final_status_must_be_scheduled_published_or_rejected");
    return issues;
  }
  issues.push(...validateOperatorNotes(record.operator_notes, finalStatus));
  if (finalStatus === "rejected") return issues;
  if (finalStatus === "scheduled") {
    if (!isMetricoolApprovalUrl(approvalUrl)) issues.push("metricool_approval_url_must_be_metricool_url");
    if (!isPlaceholder(publishedPostUrl) || metricsTotal > 0) issues.push("scheduled_rows_must_not_include_public_url_or_metrics");
    return issues;
  }
  if (!isPlaceholder(approvalUrl) && !isMetricoolApprovalUrl(approvalUrl)) issues.push("metricool_approval_url_must_be_metricool_url");
  if (!isTikTokPostUrl(publishedPostUrl)) issues.push("published_post_url_must_be_public_tiktok_url");
  if (metricsTotal <= 0) issues.push("published_rows_require_nonzero_24h_metrics");
  return issues;
}

const operatorFields = [
  "metricool_approval_url",
  "published_post_url",
  "final_status",
  "views_24h",
  "likes_24h",
  "comments_24h",
  "shares_24h",
  "operator_notes",
];

function operatorFingerprint(record) {
  return operatorFields.map((field) => String(record?.[field] || "").trim()).join("\u001f");
}

function consistencyStatus(batchRecord, masterRecord) {
  const batchTouched = rowHasOperatorTouch(batchRecord || {});
  const masterTouched = rowHasOperatorTouch(masterRecord || {});
  if (!batchTouched && !masterTouched) return "placeholder_aligned";
  if (operatorFingerprint(batchRecord) === operatorFingerprint(masterRecord)) return "synced";
  if (batchTouched && !masterTouched) return "needs_master_sync";
  if (!batchTouched && masterTouched) return "master_has_operator_update";
  return "conflict";
}

async function validateAgainstWorkbook(record, workbookRow) {
  const issues = [];
  if (!workbookRow) issues.push("queue_item_not_in_current_batch");
  if (workbookRow && normalized(record.account_id) !== normalized(workbookRow.accountId)) issues.push("account_id_mismatch");
  if (workbookRow && normalized(record.platform) !== normalized(workbookRow.platform)) issues.push("platform_mismatch");
  if (workbookRow) {
    const sourceStatus = await sourceFileStatus(workbookRow.sourcePath || record.source_path);
    if (!sourceStatus.valid) issues.push(sourceStatus.blocker);
  }
  if (hasSecretSignal(record)) issues.push("secret_signal");
  issues.push(...validateOperatorEvidence(record));
  return issues;
}

function markdown(summary) {
  return [
    "# Clippers TikTok Batch Evidence Sync",
    "",
    `Status: ${summary.status}`,
    `Generated: ${summary.generatedAt}`,
    "",
    summary.mode === "all_batches"
      ? "This sync consolidates every Metricool batch evidence CSV into the 100-row master evidence CSV. It does not import metrics and does not count rows as published."
      : "This sync copies only the active batch evidence rows into the 100-row master evidence CSV. It does not import metrics and does not count rows as published.",
    "",
    "## Totals",
    "",
    `- Batch rows: ${summary.totals.batchRows}`,
    `- Batches checked: ${summary.totals.batchesChecked}`,
    `- Applied: ${summary.totals.applied}`,
    `- Untouched placeholders: ${summary.totals.untouched}`,
    `- Rejected: ${summary.totals.rejected}`,
    `- Consistency conflicts: ${summary.consistency.conflicts}`,
    `- Needs master sync: ${summary.consistency.needsMasterSync}`,
    "",
    "## Next Step",
    "",
    summary.nextStep,
    "",
    "## Rows",
    "",
    ...summary.rows.map((row) => `- ${row.batchId || "current"} / ${row.metricoolQueueItemId}: ${row.result}${row.reason ? ` (${row.reason})` : ""}`),
    "",
  ].join("\n");
}

async function loadWorkbooks() {
  if (!allBatchesMode) {
    const workbook = JSON.parse(await readFile(workbookPath, "utf8"));
    return [{ workbook, workbookPath }];
  }
  const files = (await readdir(batchWorkbooksDir))
    .filter((file) => /^metricool-batch-\d+-workbook\.json$/.test(file))
    .sort();
  const workbooks = [];
  for (const file of files) {
    const filePath = path.join(batchWorkbooksDir, file);
    workbooks.push({ workbook: JSON.parse(await readFile(filePath, "utf8")), workbookPath: filePath });
  }
  if (!workbooks.length) throw new Error("No Metricool batch workbooks found for all-batches sync.");
  return workbooks;
}

async function main() {
  await mkdir(reportsDir, { recursive: true });
  const workbookEntries = await loadWorkbooks();
  const masterRaw = await readFile(masterEvidencePath, "utf8");
  const masterRecords = parseCsv(masterRaw);
  const masterHeader = parseCsvLine(masterRaw.split(/\r?\n/)[0] || "");
  const rows = [];
  const approvedBatchRecords = new Map();
  const masterById = new Map(masterRecords.map((record) => [String(record.metricool_queue_item_id || "").trim(), record]));
  const batchEvidencePaths = [];
  const expectedMasterIds = workbookEntries.flatMap((entry) => (Array.isArray(entry.workbook.rows) ? entry.workbook.rows : [])
    .map((row) => String(row.metricoolQueueItemId || "").trim())
    .filter(Boolean));
  const masterIds = masterRecords.map((record) => String(record.metricool_queue_item_id || "").trim()).filter(Boolean);
  const duplicateMasterIds = masterIds.filter((id, index) => masterIds.indexOf(id) !== index);
  const missingMasterIds = expectedMasterIds.filter((id) => !masterIds.includes(id));
  const unexpectedMasterIds = masterIds.filter((id) => !expectedMasterIds.includes(id));
  const masterStructuralIssues = [];
  if (allBatchesMode && masterRecords.length !== expectedMasterIds.length) masterStructuralIssues.push(`master_row_count_mismatch_expected_${expectedMasterIds.length}_found_${masterRecords.length}`);
  if (duplicateMasterIds.length) masterStructuralIssues.push(`duplicate_master_ids_${Array.from(new Set(duplicateMasterIds)).join("_")}`);
  if (missingMasterIds.length) masterStructuralIssues.push(`missing_master_ids_${missingMasterIds.join("_")}`);
  if (allBatchesMode && unexpectedMasterIds.length) masterStructuralIssues.push(`unexpected_master_ids_${unexpectedMasterIds.join("_")}`);
  if (masterStructuralIssues.length) {
    rows.push({
      batchId: "master",
      metricoolQueueItemId: "__master_csv__",
      result: "rejected",
      reason: masterStructuralIssues.join(","),
      touched: false,
      consistency: "master_structure_invalid",
    });
  }

  for (const entry of workbookEntries) {
    const workbook = entry.workbook;
    const batchId = String(workbook.batchId || "metricool-batch-01");
    const batchEvidencePath = path.join(scheduledDir, "metricool-100-batch-evidence-imports", `${batchId}-evidence-import.csv`);
    batchEvidencePaths.push(batchEvidencePath);
    const batchRows = Array.isArray(workbook.rows) ? workbook.rows : [];
    if (batchRows.length !== 10) throw new Error(`${batchId} workbook must contain 10 rows; found ${batchRows.length}.`);
    const workbookById = new Map(batchRows.map((row) => [String(row.metricoolQueueItemId || ""), row]));
    const batchRaw = await readFile(batchEvidencePath, "utf8");
    const batchRecords = parseCsv(batchRaw);
    const workbookIds = new Set(batchRows.map((row) => String(row.metricoolQueueItemId || "").trim()).filter(Boolean));
    const batchIds = batchRecords.map((record) => String(record.metricool_queue_item_id || "").trim()).filter(Boolean);
    const duplicateBatchIds = batchIds.filter((id, index) => batchIds.indexOf(id) !== index);
    const missingBatchIds = Array.from(workbookIds).filter((id) => !batchIds.includes(id));
    const unexpectedBatchIds = batchIds.filter((id) => !workbookIds.has(id));
    const structuralIssues = [];
    if (batchRecords.length !== batchRows.length) structuralIssues.push(`batch_row_count_mismatch_expected_${batchRows.length}_found_${batchRecords.length}`);
    if (duplicateBatchIds.length) structuralIssues.push(`duplicate_batch_ids_${Array.from(new Set(duplicateBatchIds)).join("_")}`);
    if (missingBatchIds.length) structuralIssues.push(`missing_batch_ids_${missingBatchIds.join("_")}`);
    if (unexpectedBatchIds.length) structuralIssues.push(`unexpected_batch_ids_${unexpectedBatchIds.join("_")}`);
    if (structuralIssues.length && batchRecords.length === 0) {
      rows.push({
        batchId,
        metricoolQueueItemId: "__batch_csv__",
        result: "rejected",
        reason: structuralIssues.join(","),
        touched: false,
        consistency: "missing_batch_rows",
      });
    }

    for (const record of batchRecords) {
      const id = String(record.metricool_queue_item_id || "").trim();
      const issues = [...structuralIssues, ...await validateAgainstWorkbook(record, workbookById.get(id))];
      const touched = rowHasOperatorTouch(record);
      if (issues.length) {
        rows.push({ batchId, metricoolQueueItemId: id, result: "rejected", reason: issues.join(","), touched, consistency: consistencyStatus(record, masterById.get(id)) });
        continue;
      }
      if (!touched) {
        rows.push({ batchId, metricoolQueueItemId: id, result: "untouched", reason: "placeholder_row", touched, consistency: consistencyStatus(record, masterById.get(id)) });
        continue;
      }
      const consistency = consistencyStatus(record, masterById.get(id));
      if (consistency === "conflict") {
        rows.push({ batchId, metricoolQueueItemId: id, result: "conflict", reason: "operator_evidence_conflicts_with_master", touched, consistency });
        continue;
      }
      if (masterStructuralIssues.length) {
        rows.push({ batchId, metricoolQueueItemId: id, result: "rejected", reason: "master_structure_invalid", touched, consistency });
        continue;
      }
      rows.push({ batchId, metricoolQueueItemId: id, result: "applied", reason: "", touched, consistency });
      approvedBatchRecords.set(id, record);
    }
  }

  const mergedRecords = masterRecords.map((record) => {
    const id = String(record.metricool_queue_item_id || "").trim();
    return approvedBatchRecords.get(id) || record;
  });
  const rejected = rows.filter((row) => row.result === "rejected").length;
  const conflicts = rows.filter((row) => row.consistency === "conflict").length;
  if (rejected === 0 && conflicts === 0) {
    await writeFile(masterEvidencePath, renderCsv(mergedRecords, masterHeader));
  }
  const summary = {
    status: rejected > 0 || conflicts > 0 ? "blocked_invalid_batch_evidence" : rows.some((row) => row.result === "applied") ? "synced" : "no_operator_updates",
    generatedAt: new Date().toISOString(),
    mode: allBatchesMode ? "all_batches" : "current_batch",
    batchId: workbookEntries.length === 1 ? String(workbookEntries[0].workbook.batchId || "metricool-batch-01") : "all_batches",
    paths: {
      json: outJsonPath,
      markdown: outMarkdownPath,
      csv: outCsvPath,
      batchEvidence: workbookEntries.length === 1 ? batchEvidencePaths[0] : batchEvidencePaths.join(" | "),
      batchEvidenceDir: path.join(scheduledDir, "metricool-100-batch-evidence-imports"),
      masterEvidence: masterEvidencePath,
      workbook: workbookEntries.length === 1 ? workbookEntries[0].workbookPath : batchWorkbooksDir,
    },
    totals: {
      batchesChecked: workbookEntries.length,
      batchRows: rows.length,
      applied: rows.filter((row) => row.result === "applied").length,
      untouched: rows.filter((row) => row.result === "untouched").length,
      rejected,
    },
    consistency: {
      synced: rows.filter((row) => row.consistency === "synced").length,
      placeholderAligned: rows.filter((row) => row.consistency === "placeholder_aligned").length,
      needsMasterSync: rows.filter((row) => row.consistency === "needs_master_sync").length,
      masterHasOperatorUpdate: rows.filter((row) => row.consistency === "master_has_operator_update").length,
      conflicts,
    },
    rows,
    nextStep: rejected > 0 || conflicts > 0
      ? "Fix rejected or conflicted batch evidence rows before syncing to the master 100-row evidence CSV."
      : rows.some((row) => row.result === "applied")
        ? "Run Metricool evidence preview before importing metrics."
        : allBatchesMode
          ? "Edit batch evidence CSVs after Metricool review, then sync all batches again."
          : "Edit the batch evidence CSV after Metricool review, then sync again.",
  };
  await writeFile(outJsonPath, JSON.stringify(summary, null, 2));
  await writeFile(outMarkdownPath, markdown(summary));
  await writeFile(outCsvPath, renderCsv(summary.rows, ["batchId", "metricoolQueueItemId", "result", "reason", "touched", "consistency"]));
  console.log(JSON.stringify({
    status: summary.status,
    mode: summary.mode,
    batchesChecked: summary.totals.batchesChecked,
    batchRows: summary.totals.batchRows,
    applied: summary.totals.applied,
    untouched: summary.totals.untouched,
    rejected: summary.totals.rejected,
    consistency: summary.consistency,
    nextStep: summary.nextStep,
    markdownPath: outMarkdownPath,
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
