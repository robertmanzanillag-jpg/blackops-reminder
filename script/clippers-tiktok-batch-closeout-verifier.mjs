import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const rootDir = path.join(process.cwd(), "clippers_workspace");
const scheduledDir = path.join(rootDir, "scheduled");
const reportsDir = path.join(rootDir, "reports");
const handoffPath = path.join(scheduledDir, "metricool-100-operator-handoff.json");
const trackerPath = path.join(reportsDir, "clippers-tiktok-batch-tracker.json");
const postScheduleVerifierPath = path.join(reportsDir, "clippers-tiktok-post-schedule-verifier.json");
const importedMetricsPath = path.join(rootDir, "metrics", "metricool-approval-imported-metrics.csv");
const outJsonPath = path.join(reportsDir, "clippers-tiktok-batch-closeout-verifier.json");
const outMarkdownPath = path.join(reportsDir, "clippers-tiktok-batch-closeout-verifier.md");
const outCsvPath = path.join(reportsDir, "clippers-tiktok-batch-closeout-verifier.csv");

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}

function csvCell(value) {
  return `"${String(value ?? "").replace(/"/g, '""')}"`;
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

function importedMetricsByQueueId(raw = "") {
  return new Map(parseCsv(raw)
    .map((record) => [String(record.metricool_queue_item_id || "").trim(), record])
    .filter(([id]) => Boolean(id)));
}

function hasImportedMetricsApplied(row = {}, importedMetricsById = new Map()) {
  const imported = importedMetricsById.get(String(row.metricoolQueueItemId || "").trim());
  if (!imported) return false;
  const sourcePath = String(row.sourcePath || "").trim();
  const importedSourcePath = String(imported.source_file || imported.source_path || "").trim();
  if (!sourcePath || importedSourcePath !== sourcePath) return false;
  const publicUrl = String(row.publishedPostUrl || "").trim();
  const importedPublicUrl = String(imported.clip_id || imported.post_url || imported.published_post_url || "").trim();
  if (publicUrl && importedPublicUrl !== publicUrl) return false;
  return true;
}

function statusFor(totals) {
  if (totals.needsFix > 0 || totals.rejected > 0) return "blocked_evidence_fix";
  if (totals.notStarted > 0) return "blocked_not_scheduled";
  if (totals.scheduled > 0) return "waiting_public_posts";
  if (totals.waitingMetrics > 0) return "waiting_24h_metrics";
  if (totals.readyToImport === totals.rows && totals.rows > 0 && totals.importApplied < totals.rows) return "waiting_import_apply";
  if (totals.readyToImport === totals.rows && totals.importApplied === totals.rows && totals.rows > 0) return "ready_to_close_batch";
  return "in_progress";
}

function nextStepFor(summary) {
  if (summary.status === "blocked_evidence_fix") return "Fix invalid/rejected evidence rows before closing this batch.";
  if (summary.status === "blocked_not_scheduled") return "Finish Metricool scheduling for every row in the current batch.";
  if (summary.status === "waiting_public_posts") return "Wait for exact public TikTok URLs before closing the batch.";
  if (summary.status === "waiting_24h_metrics") return "Add real nonzero 24h metrics before closing the batch.";
  if (summary.status === "waiting_import_apply") return "Run Metricool evidence import/apply before closing the batch or preparing the next batch.";
  if (summary.status === "ready_to_close_batch") return `Batch ${summary.batch.id} can be closed after import preview/apply succeeds; then prepare the next batch.`;
  return "Continue the current batch evidence workflow.";
}

function rowCloseout(row) {
  if (row.state === "ready_to_import") {
    return {
      closeoutGate: "ready_for_import_review",
      blocker: "",
      nextAction: "Run import preview/apply before counting this row as published.",
    };
  }
  if (row.state === "waiting_metrics") {
    return {
      closeoutGate: "waiting_24h_metrics",
      blocker: "missing_nonzero_24h_metrics",
      nextAction: "Add real 24h views/engagement before import review.",
    };
  }
  if (row.state === "scheduled") {
    return {
      closeoutGate: "waiting_public_post_url",
      blocker: "missing_public_tiktok_url",
      nextAction: "Add the exact public TikTok video URL after it is live.",
    };
  }
  if (row.state === "not_started") {
    return {
      closeoutGate: "not_scheduled",
      blocker: "missing_metricool_schedule",
      nextAction: "Schedule this row in Metricool and record scheduled evidence.",
    };
  }
  if (row.state === "needs_fix") {
    return {
      closeoutGate: "needs_evidence_fix",
      blocker: row.blocker || "invalid_evidence",
      nextAction: row.nextAction || "Fix evidence before closing the batch.",
    };
  }
  if (row.state === "rejected") {
    return {
      closeoutGate: "needs_replacement",
      blocker: "operator_rejected",
      nextAction: "Replace/reapprove this row before closing the batch.",
    };
  }
  return {
    closeoutGate: "needs_review",
    blocker: `unknown_state_${row.state || "missing"}`,
    nextAction: "Review this row before closing the batch.",
  };
}

function buildNextBatchUnlock(summary) {
  const blockers = [];
  if (summary.totals.notStarted > 0) blockers.push(`${summary.totals.notStarted} not scheduled`);
  if (summary.totals.scheduled > 0) blockers.push(`${summary.totals.scheduled} waiting public URLs`);
  if (summary.totals.waitingMetrics > 0) blockers.push(`${summary.totals.waitingMetrics} waiting 24h metrics`);
  if (summary.totals.needsFix > 0) blockers.push(`${summary.totals.needsFix} needs evidence fix`);
  if (summary.totals.rejected > 0) blockers.push(`${summary.totals.rejected} rejected`);
  if (summary.totals.readyToImport > 0 && summary.totals.importApplied < summary.totals.rows) {
    blockers.push(`${summary.totals.rows - summary.totals.importApplied} waiting import apply`);
  }
  const ready = summary.status === "ready_to_close_batch"
    && summary.totals.readyToImport === summary.totals.rows
    && summary.totals.importApplied === summary.totals.rows
    && summary.totals.rows > 0
    && blockers.length === 0;
  return {
    status: ready ? "ready_after_import_apply" : summary.status === "waiting_import_apply" || summary.status === "ready_to_close_batch" ? "waiting_import_apply" : "blocked_current_batch",
    canPrepareNextBatch: ready,
    nextBatchId: summary.nextBatch?.id || "",
    blockers,
    criteria: [
      "Current batch has zero not_started rows.",
      "Current batch has zero scheduled-only rows waiting for public URLs.",
      "Current batch has zero waiting_24h_metrics rows.",
      "Current batch has zero needs_fix or rejected rows.",
      "Every row is ready_to_import.",
      "Import/apply has written imported metrics for every row before the next batch can be prepared.",
    ],
    nextAction: ready
      ? `Import/apply is complete for ${summary.batch.id}; prepare ${summary.nextBatch?.id || "the next batch"} only after Robert confirms closeout.`
      : summary.status === "waiting_import_apply" || summary.status === "ready_to_close_batch"
        ? `Run import preview/apply for ${summary.batch.id}; do not prepare ${summary.nextBatch?.id || "the next batch"} until imported metrics cover every row.`
        : `Keep working ${summary.batch.id}; do not prepare ${summary.nextBatch?.id || "the next batch"} yet.`,
  };
}

function renderMarkdown(summary) {
  return [
    "# TikTok Batch Closeout Verifier",
    "",
    "Read-only closeout report. It does not close batches, publish, schedule, sync, import, or advance to the next batch automatically.",
    "",
    `Status: ${summary.status}`,
    `Generated: ${summary.generatedAt}`,
    `Batch: ${summary.batch.id}`,
    `Next batch: ${summary.nextBatch?.id || "none"}`,
    `Next batch unlock: ${summary.nextBatchUnlock.status}`,
    `Next step: ${summary.nextStep}`,
    "",
    "## Totals",
    "",
    `- Rows: ${summary.totals.rows}`,
    `- Ready to import: ${summary.totals.readyToImport}`,
    `- Import applied: ${summary.totals.importApplied}`,
    `- Scheduled: ${summary.totals.scheduled}`,
    `- Waiting metrics: ${summary.totals.waitingMetrics}`,
    `- Needs fix: ${summary.totals.needsFix}`,
    `- Rejected: ${summary.totals.rejected}`,
    "",
    "## Next Batch Unlock",
    "",
    `- Can prepare next batch: ${summary.nextBatchUnlock.canPrepareNextBatch ? "yes" : "no"}`,
    `- Next batch: ${summary.nextBatchUnlock.nextBatchId || "none"}`,
    `- Blockers: ${summary.nextBatchUnlock.blockers.join("; ") || "none"}`,
    `- Next action: ${summary.nextBatchUnlock.nextAction}`,
    "",
    "### Criteria",
    "",
    ...summary.nextBatchUnlock.criteria.map((item) => `- ${item}`),
    "",
    "## Rows",
    "",
    ...summary.rows.map((row) => [
      `### #${row.rank} ${row.metricoolQueueItemId}`,
      `- State: ${row.state}`,
      `- Closeout gate: ${row.closeoutGate}`,
      `- Import applied: ${row.importApplied ? "yes" : "no"}`,
      `- Blocker: ${row.blocker || "none"}`,
      `- Next: ${row.nextAction}`,
      "",
    ].join("\n")),
    "## Guardrails",
    "",
    ...summary.guardrails.map((guardrail) => `- ${guardrail}`),
    "",
  ].join("\n");
}

function renderCsv(summary) {
  const header = ["rank", "metricool_queue_item_id", "account_id", "metricool_brand_name", "state", "closeout_gate", "import_applied", "blocker", "next_action", "next_batch_unlock_status", "next_batch_id"];
  return [
    header.map(csvCell).join(","),
    ...summary.rows.map((row) => [
      row.rank,
      row.metricoolQueueItemId,
      row.accountId,
      row.metricoolBrandName,
      row.state,
      row.closeoutGate,
      row.importApplied,
      row.blocker,
      row.nextAction,
      summary.nextBatchUnlock.status,
      summary.nextBatchUnlock.nextBatchId,
    ].map(csvCell).join(",")),
  ].join("\n") + "\n";
}

async function main() {
  await mkdir(reportsDir, { recursive: true });
  const [handoff, tracker, postSchedule, importedMetricsRaw] = await Promise.all([
    readJson(handoffPath),
    readJson(trackerPath),
    readJson(postScheduleVerifierPath),
    readFile(importedMetricsPath, "utf8").catch(() => ""),
  ]);
  const importedMetricsById = importedMetricsByQueueId(importedMetricsRaw);
  const batchId = tracker.batch?.id || handoff.operatorConsole?.currentBatchId || "metricool-batch-01";
  const batches = Array.isArray(handoff.batches) ? handoff.batches : [];
  const currentBatchIndex = batches.findIndex((batch) => batch.id === batchId);
  const nextBatch = currentBatchIndex >= 0 ? batches[currentBatchIndex + 1] || null : null;
  const effectiveRows = Array.isArray(postSchedule.rows) && postSchedule.rows.length ? postSchedule.rows : tracker.rows || [];
  const trackerById = new Map((tracker.rows || []).map((row) => [row.metricoolQueueItemId, row]));
  const rows = effectiveRows.map((row) => {
    const trackerRow = trackerById.get(row.metricoolQueueItemId) || {};
    const sourcePath = row.sourcePath || trackerRow.sourcePath || "";
    const publishedPostUrl = row.publishedPostUrl || trackerRow.publishedPostUrl || "";
    const importApplied = row.state === "ready_to_import" && hasImportedMetricsApplied({
      metricoolQueueItemId: row.metricoolQueueItemId,
      sourcePath,
      publishedPostUrl,
    }, importedMetricsById);
    return {
      rank: row.rank,
      metricoolQueueItemId: row.metricoolQueueItemId,
      accountId: row.accountId,
      accountName: row.accountName,
      metricoolBrandName: row.metricoolBrandName,
      scheduledFor: row.scheduledFor,
      sourcePath,
      publishedPostUrl,
      state: row.state,
      importApplied,
      ...rowCloseout(row),
    };
  });
  const totals = rows.reduce((sum, row) => {
    sum.rows += 1;
    if (row.state === "not_started") sum.notStarted += 1;
    if (row.state === "scheduled") sum.scheduled += 1;
    if (row.state === "waiting_metrics") sum.waitingMetrics += 1;
    if (row.state === "ready_to_import") sum.readyToImport += 1;
    if (row.importApplied) sum.importApplied += 1;
    if (row.state === "needs_fix") sum.needsFix += 1;
    if (row.state === "rejected") sum.rejected += 1;
    return sum;
  }, { rows: 0, notStarted: 0, scheduled: 0, waitingMetrics: 0, readyToImport: 0, importApplied: 0, needsFix: 0, rejected: 0 });
  const summary = {
    status: statusFor(totals),
    generatedAt: new Date().toISOString(),
    mode: "tiktok_metricool_batch_closeout_verifier",
    batch: {
      id: batchId,
      rows: tracker.batch?.rows || totals.rows,
      accounts: tracker.batch?.accounts || [],
      platforms: tracker.batch?.platforms || ["tiktok"],
    },
    nextBatch: nextBatch ? {
      id: nextBatch.id,
      status: nextBatch.status,
      rows: nextBatch.rows?.length || nextBatch.totals?.rows || 0,
      accounts: nextBatch.accounts || [],
      platforms: nextBatch.platforms || [],
    } : null,
    paths: {
      json: outJsonPath,
      markdown: outMarkdownPath,
      csv: outCsvPath,
      handoff: handoff.paths?.json || handoffPath,
      tracker: tracker.paths?.json || trackerPath,
      postScheduleVerifier: postSchedule.paths?.json || postScheduleVerifierPath,
      evidenceCsv: tracker.paths?.batchEvidenceCsv || "",
    },
    totals,
    rows,
    nextBatchUnlock: null,
    guardrails: [
      "This verifier is read-only and never closes, advances, publishes, schedules, syncs, or imports evidence.",
      "Ready to import is not the same as published-counted; published counts require a valid import/apply step.",
      "Do not move to the next batch while current rows are not_started, scheduled-only, waiting metrics, rejected, or needs_fix.",
      "Metricool remains approval_required; realPublishEnabled remains false.",
    ],
  };
  summary.nextStep = nextStepFor(summary);
  summary.nextBatchUnlock = buildNextBatchUnlock(summary);
  await writeFile(outJsonPath, JSON.stringify(summary, null, 2));
  await writeFile(outMarkdownPath, renderMarkdown(summary));
  await writeFile(outCsvPath, renderCsv(summary));
  console.log(JSON.stringify({
    status: summary.status,
    batchId: summary.batch.id,
    nextBatchId: summary.nextBatch?.id || "",
    rows: summary.totals.rows,
    readyToImport: summary.totals.readyToImport,
    needsFix: summary.totals.needsFix,
    markdownPath: outMarkdownPath,
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
