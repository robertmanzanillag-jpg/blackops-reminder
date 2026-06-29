import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const rootDir = path.join(process.cwd(), "clippers_workspace");
const reportsDir = path.join(rootDir, "reports");
const trackerPath = path.join(reportsDir, "clippers-tiktok-batch-tracker.json");
const checklistPath = path.join(reportsDir, "clippers-tiktok-evidence-checklist.json");
const cockpitPath = path.join(reportsDir, "clippers-tiktok-operator-cockpit.json");
const outJsonPath = path.join(reportsDir, "clippers-tiktok-post-schedule-verifier.json");
const outMarkdownPath = path.join(reportsDir, "clippers-tiktok-post-schedule-verifier.md");
const outCsvPath = path.join(reportsDir, "clippers-tiktok-post-schedule-verifier.csv");

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}

function csvCell(value) {
  return `"${String(value ?? "").replace(/"/g, '""')}"`;
}

function rowGate(row) {
  if (row.state === "needs_fix") {
    return {
      gate: "needs_evidence_fix",
      blocker: row.blocker || "invalid_evidence",
      nextAction: row.nextAction || "Fix invalid Metricool/TikTok evidence before continuing.",
    };
  }
  if (row.state === "not_started") {
    return {
      gate: "needs_metricool_scheduling",
      blocker: "missing_metricool_scheduled_evidence",
      nextAction: "Schedule this row in Metricool and record final_status=scheduled with real Metricool proof URL.",
    };
  }
  if (row.state === "scheduled") {
    return {
      gate: "waiting_public_post_url",
      blocker: "waiting_public_tiktok_url",
      nextAction: "Wait for the public TikTok video URL. Do not add placeholder/profile/search URLs.",
    };
  }
  if (row.state === "waiting_metrics") {
    return {
      gate: "waiting_24h_metrics",
      blocker: "waiting_nonzero_24h_metrics",
      nextAction: "Add real nonzero 24h views, likes, comments, or shares before import review.",
    };
  }
  if (row.state === "ready_to_import") {
    return {
      gate: "ready_for_import_review",
      blocker: "",
      nextAction: "Ready for import preview. Still do not count as published until the import/apply step succeeds.",
    };
  }
  if (row.state === "rejected") {
    return {
      gate: "needs_replacement",
      blocker: "operator_rejected",
      nextAction: "Replace or correct this clip before it can count toward the batch.",
    };
  }
  return {
    gate: "needs_review",
    blocker: `unknown_state_${row.state || "missing"}`,
    nextAction: "Review this row before continuing.",
  };
}

function isoOrEmpty(value) {
  const time = Date.parse(value || "");
  return Number.isFinite(time) ? new Date(time).toISOString() : "";
}

function captureTimeline(row, now = new Date()) {
  const scheduledTime = Date.parse(row.scheduledFor || "");
  if (!Number.isFinite(scheduledTime)) {
    return {
      status: "missing_schedule_time",
      publicUrlDueAt: "",
      metricsDueAt: "",
      publicUrlDueNow: false,
      metricsEligibleNow: false,
      nextActionAt: "",
      nextActionLabel: row.state === "not_started" ? "schedule_in_metricool" : "fix_schedule_time",
    };
  }
  const nowTime = now.getTime();
  const publicUrlDueAt = new Date(scheduledTime).toISOString();
  const metricsDueAt = new Date(scheduledTime + 24 * 60 * 60 * 1000).toISOString();
  if (row.state === "scheduled") {
    const publicUrlDueNow = nowTime >= scheduledTime;
    return {
      status: publicUrlDueNow ? "capture_public_url_now" : "wait_until_scheduled_time",
      publicUrlDueAt,
      metricsDueAt,
      publicUrlDueNow,
      metricsEligibleNow: false,
      nextActionAt: publicUrlDueNow ? "" : publicUrlDueAt,
      nextActionLabel: publicUrlDueNow ? "capture_public_tiktok_url" : "wait_for_metricool_publish_time",
    };
  }
  if (row.state === "waiting_metrics" || row.state === "ready_to_import") {
    const metricsEligibleNow = nowTime >= Date.parse(metricsDueAt);
    return {
      status: row.state === "ready_to_import" && metricsEligibleNow ? "ready_for_import_review" : metricsEligibleNow ? "capture_24h_metrics_now" : "wait_until_24h_metrics_window",
      publicUrlDueAt,
      metricsDueAt,
      publicUrlDueNow: true,
      metricsEligibleNow,
      nextActionAt: metricsEligibleNow ? "" : metricsDueAt,
      nextActionLabel: row.state === "ready_to_import" && metricsEligibleNow ? "review_import" : metricsEligibleNow ? "capture_real_24h_metrics" : "wait_for_24h_metrics_window",
    };
  }
  return {
    status: row.state === "not_started" ? "not_scheduled" : "blocked_or_review",
    publicUrlDueAt,
    metricsDueAt,
    publicUrlDueNow: false,
    metricsEligibleNow: false,
    nextActionAt: "",
    nextActionLabel: row.state === "not_started" ? "schedule_in_metricool" : "fix_or_review_row",
  };
}

function statusFor(totals) {
  if (totals.needsFix > 0 || totals.rejected > 0) return "needs_evidence_fix";
  if (totals.notStarted > 0) return "needs_metricool_scheduling";
  if (totals.scheduled === totals.rows && totals.rows > 0) return "waiting_public_posts";
  if (totals.waitingMetrics > 0) return "waiting_24h_metrics";
  if (totals.readyToImport === totals.rows && totals.rows > 0) return "ready_for_import_review";
  return "in_progress";
}

function nextStepFor(summary) {
  if (summary.status === "needs_evidence_fix") return "Fix rejected/invalid evidence rows before scheduling or importing anything.";
  if (summary.status === "needs_metricool_scheduling") return "Finish scheduling every current-batch row in Metricool, then record real scheduled evidence.";
  if (summary.status === "waiting_public_posts") {
    if (summary.timeline.publicUrlDueNow > 0) return "Capture exact public TikTok video URLs for live scheduled rows. Do not import scheduled rows as published.";
    return `Wait for scheduled publish time before capturing public URLs. Next check: ${summary.timeline.nextActionAt || "missing"}.`;
  }
  if (summary.status === "waiting_24h_metrics") {
    if (summary.timeline.metricsEligibleNow > 0) return "Add real nonzero 24h metrics before import review.";
    return `Wait until the 24h metric window opens. Next check: ${summary.timeline.nextActionAt || "missing"}.`;
  }
  if (summary.status === "ready_for_import_review") return "Run import preview/review. Count published only after valid import/apply succeeds.";
  return "Continue the current Metricool batch checklist until every row has a clear gate.";
}

function renderMarkdown(summary) {
  return [
    "# TikTok Post-Schedule Verifier",
    "",
    "Read-only verifier for the current TikTok Metricool batch. It does not schedule, publish, sync, or import evidence.",
    "",
    `Status: ${summary.status}`,
    `Generated: ${summary.generatedAt}`,
    `Batch: ${summary.batch.id}`,
    `Next step: ${summary.nextStep}`,
    "",
    "## Totals",
    "",
    `- Rows: ${summary.totals.rows}`,
    `- Not started: ${summary.totals.notStarted}`,
    `- Scheduled: ${summary.totals.scheduled}`,
    `- Waiting metrics: ${summary.totals.waitingMetrics}`,
    `- Ready for import review: ${summary.totals.readyToImport}`,
    `- Needs fix: ${summary.totals.needsFix}`,
    `- Rejected: ${summary.totals.rejected}`,
    `- Public URL due now: ${summary.timeline.publicUrlDueNow}`,
    `- Metrics eligible now: ${summary.timeline.metricsEligibleNow}`,
    `- Metrics not due yet: ${summary.timeline.metricsNotDueYet}`,
    `- Next action at: ${summary.timeline.nextActionAt || "none"}`,
    "",
    "## Rows",
    "",
    ...summary.rows.map((row) => [
      `### #${row.rank} ${row.metricoolQueueItemId}`,
      `- State: ${row.state}`,
      `- Gate: ${row.gate}`,
      `- Blocker: ${row.blocker || "none"}`,
      `- Timeline: ${row.timeline.status}`,
      `- Public URL due at: ${row.timeline.publicUrlDueAt || "none"}`,
      `- Metrics due at: ${row.timeline.metricsDueAt || "none"}`,
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
  const header = ["rank", "metricool_queue_item_id", "account_id", "metricool_brand_name", "state", "gate", "blocker", "timeline_status", "public_url_due_at", "metrics_due_at", "public_url_due_now", "metrics_eligible_now", "next_action_at", "next_action"];
  return [
    header.map(csvCell).join(","),
    ...summary.rows.map((row) => [
      row.rank,
      row.metricoolQueueItemId,
      row.accountId,
      row.metricoolBrandName,
      row.state,
      row.gate,
      row.blocker,
      row.timeline.status,
      row.timeline.publicUrlDueAt,
      row.timeline.metricsDueAt,
      row.timeline.publicUrlDueNow,
      row.timeline.metricsEligibleNow,
      row.timeline.nextActionAt,
      row.nextAction,
    ].map(csvCell).join(",")),
  ].join("\n") + "\n";
}

async function main() {
  await mkdir(reportsDir, { recursive: true });
  const [tracker, checklist, cockpit] = await Promise.all([
    readJson(trackerPath),
    readJson(checklistPath),
    readJson(cockpitPath).catch(() => ({})),
  ]);
  const now = new Date();
  const rows = (tracker.rows || []).map((row) => {
    const baseRow = {
      rank: row.rank,
      metricoolQueueItemId: row.metricoolQueueItemId,
      accountId: row.accountId,
      accountName: row.accountName,
      metricoolBrandName: row.metricoolBrandName,
      scheduledFor: isoOrEmpty(row.scheduledFor) || row.scheduledFor,
      sourceFileName: row.sourceFileName,
      state: row.state,
      ...rowGate(row),
    };
    const timeline = captureTimeline(baseRow, now);
    const effectiveState = baseRow.state === "ready_to_import" && !timeline.metricsEligibleNow
      ? "waiting_metrics"
      : baseRow.state;
    const effectiveGate = baseRow.state === "ready_to_import" && !timeline.metricsEligibleNow
      ? "waiting_24h_metrics"
      : baseRow.gate;
    const effectiveBlocker = baseRow.state === "ready_to_import" && !timeline.metricsEligibleNow
      ? "metrics_window_not_open"
      : baseRow.blocker;
    const nextAction = baseRow.state === "scheduled" && timeline.publicUrlDueNow
      ? "Capture the exact public TikTok video URL now; leave metrics blank until the 24h window opens."
      : (baseRow.state === "waiting_metrics" || baseRow.state === "ready_to_import") && !timeline.metricsEligibleNow
        ? `Wait until ${timeline.metricsDueAt} before capturing 24h metrics.`
        : baseRow.nextAction;
    return {
      ...baseRow,
      state: effectiveState,
      gate: effectiveGate,
      blocker: effectiveBlocker,
      timeline,
      nextAction,
    };
  });
  const rowTotals = rows.reduce((sum, row) => {
    sum.rows += 1;
    if (row.state === "not_started") sum.notStarted += 1;
    if (row.state === "scheduled") sum.scheduled += 1;
    if (row.state === "waiting_metrics") sum.waitingMetrics += 1;
    if (row.state === "ready_to_import") sum.readyToImport += 1;
    if (row.state === "needs_fix") sum.needsFix += 1;
    if (row.state === "rejected") sum.rejected += 1;
    return sum;
  }, { rows: 0, notStarted: 0, scheduled: 0, waitingMetrics: 0, readyToImport: 0, needsFix: 0, rejected: 0 });
  const totals = {
    ...rowTotals,
    missingApproval: checklist.totals?.missingApproval || 0,
    missingPublicUrl: checklist.totals?.missingPublicUrl || 0,
    missingMetrics: checklist.totals?.missingMetrics || 0,
    invalidEvidence: checklist.totals?.invalidEvidence || 0,
  };
  const nowTime = now.getTime();
  const timeline = rows.reduce((sum, row) => {
    if (row.timeline.publicUrlDueNow && row.state === "scheduled") sum.publicUrlDueNow += 1;
    if (row.timeline.metricsEligibleNow && row.state === "waiting_metrics") sum.metricsEligibleNow += 1;
    if (row.state === "waiting_metrics" && !row.timeline.metricsEligibleNow) sum.metricsNotDueYet += 1;
    const nextTime = Date.parse(row.timeline.nextActionAt || "");
    if (Number.isFinite(nextTime) && nextTime > nowTime && (!sum.nextActionAt || nextTime < Date.parse(sum.nextActionAt))) {
      sum.nextActionAt = new Date(nextTime).toISOString();
      sum.nextActionLabel = row.timeline.nextActionLabel;
    }
    return sum;
  }, {
    publicUrlDueNow: 0,
    metricsEligibleNow: 0,
    metricsNotDueYet: 0,
    nextActionAt: "",
    nextActionLabel: "",
  });
  const summary = {
    status: statusFor(totals),
    generatedAt: new Date().toISOString(),
    mode: "tiktok_metricool_post_schedule_verifier",
    batch: tracker.batch,
    paths: {
      json: outJsonPath,
      markdown: outMarkdownPath,
      csv: outCsvPath,
      tracker: tracker.paths?.json || trackerPath,
      checklist: checklist.paths?.json || checklistPath,
      cockpit: cockpit.paths?.json || cockpitPath,
      evidenceCsv: tracker.paths?.batchEvidenceCsv || "",
    },
    totals,
    timeline,
    rows,
    guardrails: [
      "This verifier is read-only and never publishes, schedules, syncs, imports, or edits evidence.",
      "Scheduled rows are not published rows.",
      "Public TikTok URLs must be exact /@handle/video/id URLs, not profiles, searches, examples, or placeholders.",
      "24h metrics must be real, nonzero, and captured only after the 24h metrics window.",
      "Metricool remains approval_required; realPublishEnabled remains false.",
    ],
  };
  summary.nextStep = nextStepFor(summary);
  await writeFile(outJsonPath, JSON.stringify(summary, null, 2));
  await writeFile(outMarkdownPath, renderMarkdown(summary));
  await writeFile(outCsvPath, renderCsv(summary));
  console.log(JSON.stringify({
    status: summary.status,
    batchId: summary.batch?.id || "",
    rows: summary.totals.rows,
    scheduled: summary.totals.scheduled,
    readyToImport: summary.totals.readyToImport,
    needsFix: summary.totals.needsFix,
    markdownPath: outMarkdownPath,
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
