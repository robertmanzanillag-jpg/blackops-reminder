import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const rootDir = path.join(process.cwd(), "clippers_workspace");
const reportsDir = path.join(rootDir, "reports");
const accountReadinessPath = path.join(rootDir, "account-permission-readiness.json");
const uploadPackPath = path.join(reportsDir, "clippers-metricool-current-batch-upload-pack.json");
const postSchedulePath = path.join(reportsDir, "clippers-tiktok-post-schedule-verifier.json");
const closeoutPath = path.join(reportsDir, "clippers-tiktok-batch-closeout-verifier.json");
const goalAuditPath = path.join(reportsDir, "clippers-goal-completion-audit.json");
const outJsonPath = path.join(reportsDir, "clippers-tiktok-next-action.json");
const outMarkdownPath = path.join(reportsDir, "clippers-tiktok-next-action.md");
const outCsvPath = path.join(reportsDir, "clippers-tiktok-next-action.csv");

async function readJson(filePath, fallback = null) {
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

function statusFor(input) {
  const accountCloseout = input.accountReadiness?.tiktokMvpAccountCloseout;
  const accountReady = accountCloseout?.status === "ready_for_metricool_tiktok"
    && (accountCloseout?.totals?.ready || 0) === (accountCloseout?.totals?.rows || 0)
    && (accountCloseout?.totals?.rows || 0) > 0;
  if (!accountReady) return "blocked_account_or_metricool_connection";
  if (input.closeout?.status === "blocked_evidence_fix") return "blocked_evidence_fix";
  if (input.closeout?.status === "ready_to_close_batch") return "ready_for_import_preview";
  if ((input.closeout?.totals?.waitingMetrics || 0) > 0) return "waiting_24h_metrics";
  if ((input.closeout?.totals?.scheduled || 0) > 0) return "waiting_public_posts";
  if ((input.uploadPack?.totals?.copied || 0) === (input.uploadPack?.totals?.rows || 0)
    && (input.uploadPack?.totals?.rows || 0) > 0
    && input.closeout?.status === "blocked_not_scheduled") {
    return "ready_for_metricool_scheduling";
  }
  if ((input.uploadPack?.totals?.rows || 0) <= 0 || (input.uploadPack?.totals?.blockedUploadFiles || 0) > 0) {
    return "blocked_upload_pack";
  }
  return "in_progress";
}

function nextStepFor(summary) {
  if (summary.status === "blocked_account_or_metricool_connection") {
    return "Finish TikTok account/Metricool connection proof for SPORT and memes before scheduling clips.";
  }
  if (summary.status === "blocked_evidence_fix") {
    return "Fix rejected or invalid Metricool evidence rows before moving this TikTok batch forward.";
  }
  if (summary.status === "ready_for_import_preview") {
    return "Run the Metricool evidence preview/import review only after confirming every row has real public TikTok URLs and nonzero 24h metrics.";
  }
  if (summary.status === "waiting_24h_metrics") {
    return "Add real 24h metrics for live TikTok posts; do not count views before metrics are captured.";
  }
  if (summary.status === "waiting_public_posts") {
    return "Wait for the scheduled Metricool posts to become public, then paste exact TikTok video URLs.";
  }
  if (summary.status === "ready_for_metricool_scheduling") {
    return "Open the current batch upload pack and schedule every row in Metricool approval_required mode.";
  }
  if (summary.status === "blocked_upload_pack") {
    return "Regenerate the current batch upload pack and fix missing local source files before opening Metricool.";
  }
  return "Refresh TikTok MVP Now and follow the first blocked checklist item.";
}

function taskRowsFor(summary) {
  return [
    {
      id: "account_connection",
      label: "TikTok accounts connected in Metricool",
      status: summary.account.ready ? "done" : "blocked",
      evidence: `${summary.account.readyLanes}/${summary.account.totalLanes} TikTok MVP lanes ready`,
      nextAction: summary.account.ready ? "Use SPORT and memes TikTok lanes only." : "Add non-secret account and Metricool proof.",
    },
    {
      id: "upload_pack",
      label: "Current batch source files staged",
      status: summary.uploadPack.ready ? "done" : "blocked",
      evidence: `${summary.uploadPack.copied}/${summary.uploadPack.rows} MP4 files staged`,
      nextAction: summary.uploadPack.ready ? "Use the upload pack files in Metricool." : "Regenerate/fix upload pack before scheduling.",
    },
    {
      id: "metricool_schedule",
      label: "Schedule current batch in Metricool",
      status: summary.batch.notStarted > 0 ? "next" : "done",
      evidence: `${summary.batch.scheduled}/${summary.batch.rows} scheduled; ${summary.batch.notStarted} not started`,
      nextAction: summary.batch.notStarted > 0 ? "Schedule every row and record scheduled evidence." : "Wait for public TikTok URLs.",
    },
    {
      id: "public_urls",
      label: "Capture exact public TikTok video URLs",
      status: summary.batch.waitingPublicPosts > 0 ? "next" : summary.batch.readyToImport > 0 ? "done" : "blocked",
      evidence: `${summary.batch.readyToImport}/${summary.batch.rows} ready for import review`,
      nextAction: summary.batch.waitingPublicPosts > 0 ? "Paste exact public TikTok video URLs after posts are live." : "Do not use search/profile/shortlink URLs.",
    },
    {
      id: "metrics_24h",
      label: "Capture 24h metrics",
      status: summary.batch.waitingMetrics > 0 ? "next" : summary.batch.readyToImport === summary.batch.rows && summary.batch.rows > 0 ? "done" : "blocked",
      evidence: `${summary.batch.waitingMetrics} waiting metrics`,
      nextAction: "Use real nonzero views/likes/comments/shares before import.",
    },
  ];
}

function operatorPacketFor(summary) {
  const lines = [
    "TikTok Metricool operator packet",
    `Batch: ${summary.batch.id}`,
    `Status: ${summary.status}`,
    `Upload HTML: ${summary.operator.uploadHtml || "missing"}`,
    `Upload folder: ${summary.operator.uploadDir || "missing"}`,
    `Workbook: ${summary.operator.workbook || "missing"}`,
    `Evidence CSV: ${summary.operator.batchEvidenceCsv || "missing"}`,
    `Rows: ${summary.batch.rows}`,
    `Scheduled: ${summary.batch.scheduled}`,
    `Not started: ${summary.batch.notStarted}`,
    `Ready to import review: ${summary.batch.readyToImport}`,
    "",
    "Next steps:",
    "1. Open the upload HTML and Metricool in the browser.",
    "2. Upload/schedule each row in rank order using only SPORT and memes TikTok profiles.",
    "3. Record Metricool approval URL and final_status=scheduled in the batch evidence CSV.",
    "4. After posts are public, add exact TikTok video URLs, wait 24h, then add real metrics.",
    "",
    "Guardrails:",
    "Do not mark published without a real public TikTok video URL.",
    "Do not paste profile/search/shortlink URLs.",
    "Do not store passwords, cookies, tokens, client secrets, or private screenshots.",
    "Metricool remains approval_required; this packet does not publish automatically.",
  ];
  return lines.join("\n");
}

function renderMarkdown(summary) {
  return [
    "# TikTok Metricool Next Action",
    "",
    `Generated: ${summary.generatedAt}`,
    `Status: ${summary.status}`,
    `Batch: ${summary.batch.id}`,
    `Next batch: ${summary.batch.nextBatchId || "none"}`,
    "",
    summary.nextStep,
    "",
    "## Snapshot",
    "",
    `- Account lanes ready: ${summary.account.readyLanes}/${summary.account.totalLanes}`,
    `- Upload pack: ${summary.uploadPack.copied}/${summary.uploadPack.rows}`,
    `- Scheduled: ${summary.batch.scheduled}/${summary.batch.rows}`,
    `- Ready to import review: ${summary.batch.readyToImport}/${summary.batch.rows}`,
    `- Goal audit: ${summary.goalAudit.status}`,
    `- Upload HTML: ${summary.operator.uploadHtml || "missing"}`,
    `- Batch evidence CSV: ${summary.operator.batchEvidenceCsv || "missing"}`,
    "",
    "## Tasks",
    "",
    ...summary.tasks.map((task) => [
      `### ${task.label}`,
      `- Status: ${task.status}`,
      `- Evidence: ${task.evidence}`,
      `- Next action: ${task.nextAction}`,
      "",
    ].join("\n")),
    "## Guardrails",
    "",
    ...summary.guardrails.map((guardrail) => `- ${guardrail}`),
    "",
    "## Operator Packet",
    "",
    "```text",
    summary.operator.copyPacket,
    "```",
    "",
  ].join("\n");
}

function renderCsv(summary) {
  const header = ["task_id", "label", "status", "evidence", "next_action", "upload_html", "batch_evidence_csv"];
  return [
    header.map(csvCell).join(","),
    ...summary.tasks.map((task) => [
      task.id,
      task.label,
      task.status,
      task.evidence,
      task.nextAction,
      summary.operator.uploadHtml,
      summary.operator.batchEvidenceCsv,
    ].map(csvCell).join(",")),
  ].join("\n") + "\n";
}

async function main() {
  await mkdir(reportsDir, { recursive: true });
  const [accountReadiness, uploadPack, postSchedule, closeout, goalAudit] = await Promise.all([
    readJson(accountReadinessPath, {}),
    readJson(uploadPackPath, {}),
    readJson(postSchedulePath, {}),
    readJson(closeoutPath, {}),
    readJson(goalAuditPath, {}),
  ]);
  const accountCloseout = accountReadiness.tiktokMvpAccountCloseout || {};
  const accountReadyLanes = accountCloseout.totals?.ready || 0;
  const accountTotalLanes = accountCloseout.totals?.rows || 0;
  const uploadRows = uploadPack.totals?.rows || 0;
  const uploadCopied = uploadPack.totals?.copied || 0;
  const batchRows = closeout.totals?.rows || postSchedule.totals?.rows || 0;
  const summary = {
    status: "in_progress",
    generatedAt: new Date().toISOString(),
    mode: "tiktok_metricool_next_action",
    paths: {
      json: outJsonPath,
      markdown: outMarkdownPath,
      csv: outCsvPath,
      accountReadiness: accountReadinessPath,
      uploadPack: uploadPackPath,
      postScheduleVerifier: postSchedulePath,
      batchCloseout: closeoutPath,
      goalAudit: goalAuditPath,
    },
    account: {
      ready: accountCloseout.status === "ready_for_metricool_tiktok" && accountReadyLanes === accountTotalLanes && accountTotalLanes > 0,
      status: accountCloseout.status || "missing",
      readyLanes: accountReadyLanes,
      totalLanes: accountTotalLanes,
      rows: accountCloseout.rows || [],
    },
    uploadPack: {
      ready: uploadRows > 0 && uploadCopied === uploadRows && (uploadPack.totals?.blockedUploadFiles || 0) === 0,
      status: uploadPack.status || "missing",
      rows: uploadRows,
      copied: uploadCopied,
      blockedUploadFiles: uploadPack.totals?.blockedUploadFiles || 0,
      html: uploadPack.paths?.html || "",
    },
    batch: {
      id: closeout.batch?.id || postSchedule.batch?.id || "metricool-batch-01",
      nextBatchId: closeout.nextBatch?.id || "",
      rows: batchRows,
      notStarted: closeout.totals?.notStarted || postSchedule.totals?.notStarted || 0,
      scheduled: closeout.totals?.scheduled || postSchedule.totals?.scheduled || 0,
      waitingPublicPosts: postSchedule.totals?.missingPublicUrl || 0,
      waitingMetrics: closeout.totals?.waitingMetrics || postSchedule.totals?.waitingMetrics || 0,
      readyToImport: closeout.totals?.readyToImport || postSchedule.totals?.readyToImport || 0,
      needsFix: closeout.totals?.needsFix || postSchedule.totals?.needsFix || 0,
      closeoutStatus: closeout.status || "missing",
      postScheduleStatus: postSchedule.status || "missing",
    },
    goalAudit: {
      status: goalAudit.status || "missing",
      nextStep: goalAudit.nextStep || "",
    },
    operator: {
      uploadHtml: uploadPack.paths?.html || "",
      uploadDir: uploadPack.paths?.uploadDir || "",
      workbook: uploadPack.paths?.workbook || "",
      batchEvidenceCsv: uploadPack.paths?.batchEvidenceCsv || "",
      uploadPackReport: uploadPack.paths?.markdown || "",
      sessionPacketReport: path.join(reportsDir, "clippers-metricool-current-batch-session-packet.md"),
      copyPacket: "",
    },
    guardrails: [
      "TikTok-only MVP: SPORT and memes through Metricool first; other networks/accounts stay deferred.",
      "Metricool remains approval_required; realPublishEnabled remains false.",
      "This next-action pack never publishes, schedules, imports, creates accounts, or stores secrets.",
      "Only exact https TikTok video URLs plus real 24h metrics can enter import review.",
    ],
  };
  summary.status = statusFor({ accountReadiness, uploadPack, postSchedule, closeout, goalAudit });
  summary.nextStep = nextStepFor(summary);
  summary.tasks = taskRowsFor(summary);
  summary.operator.copyPacket = operatorPacketFor(summary);
  await writeFile(outJsonPath, JSON.stringify(summary, null, 2));
  await writeFile(outMarkdownPath, renderMarkdown(summary));
  await writeFile(outCsvPath, renderCsv(summary));
  console.log(JSON.stringify({
    status: summary.status,
    batchId: summary.batch.id,
    nextBatchId: summary.batch.nextBatchId,
    nextStep: summary.nextStep,
    scheduled: summary.batch.scheduled,
    readyToImport: summary.batch.readyToImport,
    markdownPath: outMarkdownPath,
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
