import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";

const rootDir = path.join(process.cwd(), "clippers_workspace");
const reportsDir = path.join(rootDir, "reports");
const evidenceImportPath = path.join(reportsDir, "clippers-external-closeout-evidence-import-report.json");
const evidenceCsvPath = path.join(rootDir, "evidence-drop", "external-closeout-evidence-import.csv");
const repairWorkPacketPath = path.join(reportsDir, "clippers-external-closeout-repair-work-packet.json");
const accountReadinessPath = path.join(rootDir, "account-permission-readiness.json");
const outJsonPath = path.join(reportsDir, "clippers-tiktok-external-closeout-session.json");
const outMarkdownPath = path.join(reportsDir, "clippers-tiktok-external-closeout-session.md");
const outCsvPath = path.join(reportsDir, "clippers-tiktok-external-closeout-session.csv");

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

async function evidenceImportFreshness() {
  const [csvStat, reportStat] = await Promise.all([
    stat(evidenceCsvPath).catch(() => null),
    stat(evidenceImportPath).catch(() => null),
  ]);
  if (!reportStat) {
    return {
      status: "missing_report",
      reportIsFresh: false,
      evidenceCsvMtimeMs: csvStat?.mtimeMs || 0,
      reportMtimeMs: 0,
      nextStep: "Run Validate before preparing the TikTok external closeout session.",
    };
  }
  const reportIsFresh = !csvStat || reportStat.mtimeMs >= csvStat.mtimeMs;
  return {
    status: reportIsFresh ? "fresh" : "stale_report",
    reportIsFresh,
    evidenceCsvMtimeMs: csvStat?.mtimeMs || 0,
    reportMtimeMs: reportStat.mtimeMs,
    nextStep: reportIsFresh
      ? "Evidence import report matches the current external evidence CSV."
      : "External evidence CSV changed after Validate. Run Validate again before using the TikTok session.",
  };
}

function taskAction(row) {
  if (row.lane === "account") {
    return "Create/verify the TikTok account, then add non-secret proof and update the CSV row.";
  }
  if (row.lane === "developer_app") {
    return "Open TikTok Developers, submit the public app identifier and callback proof, then update the CSV row.";
  }
  if (row.lane === "permission") {
    return `Request TikTok ${row.scope || "permission"} and add non-secret portal/ticket proof before import.`;
  }
  return row.nextStep || "Complete this TikTok closeout action with real non-secret proof.";
}

function deferralFor(row, activeMetricoolAccountIds) {
  if (row.lane === "developer_app" || row.lane === "permission") {
    return {
      deferred: true,
      reason: "direct_api_not_required_for_metricool_mvp",
      note: "Deferred because TikTok MVP uses Metricool approval_required mode, not direct TikTok API posting.",
    };
  }
  if (row.lane === "account" && row.accountId && !activeMetricoolAccountIds.has(row.accountId)) {
    return {
      deferred: true,
      reason: "account_not_in_current_metricool_tiktok_mvp",
      note: "Deferred because the current TikTok MVP is SPORT and memes through Metricool.",
    };
  }
  return {
    deferred: false,
    reason: "",
    note: "",
  };
}

function copyPacketFor(row) {
  return [
    `TikTok closeout task: ${row.closeoutId || row.lane}`,
    `CSV row: ${row.csvRow || "?"}`,
    `Lane: ${row.lane}`,
    row.accountId ? `Account: ${row.accountId}` : null,
    row.scope ? `Scope: ${row.scope}` : null,
    `Required status: ${row.requiredStatus || "n/a"}`,
    `Portal: ${row.portalUrl || "n/a"}`,
    row.docsUrl ? `Docs: ${row.docsUrl}` : null,
    `Proof file: ${row.proofPath || "missing"}`,
    `Reason blocked: ${row.reason || "needs real evidence"}`,
    `CSV row template: ${row.csvRowTemplate || row.replacementCsvRow || ""}`,
    `Next: ${taskAction(row)}`,
    "",
    "Do not paste passwords, cookies, client secrets, OAuth tokens, refresh tokens, recovery codes, or private screenshots.",
  ].filter(Boolean).join("\n");
}

function renderMarkdown(summary) {
  return [
    "# Clippers TikTok External Closeout Session",
    "",
    `Generated: ${summary.generatedAt}`,
    `Status: ${summary.status}`,
    `TikTok tasks: ${summary.totals.tiktokTasks}`,
    `Active MVP blockers: ${summary.totals.activeTasks}`,
    `Deferred backlog: ${summary.totals.deferredTasks}`,
    "",
    summary.nextStep,
    "",
    "## Guardrails",
    "",
    ...summary.guardrails.map((guardrail) => `- ${guardrail}`),
    "",
    "## Tasks",
    "",
    ...(summary.tasks.length ? summary.tasks.map((task) => [
      `### ${task.rank}. ${task.closeoutId}`,
      "",
      `- Lane: ${task.lane}`,
      task.accountId ? `- Account: ${task.accountId}` : null,
      task.scope ? `- Scope: ${task.scope}` : null,
      `- Required status: ${task.requiredStatus}`,
      `- Active for Metricool MVP: ${task.activeForMetricoolMvp ? "yes" : "no"}`,
      task.deferredReason ? `- Deferred reason: ${task.deferredReason}` : null,
      `- Portal: ${task.portalUrl || "n/a"}`,
      task.docsUrl ? `- Docs: ${task.docsUrl}` : null,
      `- Proof: ${task.proofPath || "missing"}`,
      `- CSV row: ${task.csvRow || "?"}`,
      `- Next: ${task.nextAction}`,
      "",
      "```csv",
      task.csvRowTemplate || "",
      "```",
      "",
    ].filter(Boolean).join("\n")) : ["- No TikTok repair tasks remain."]),
  ].join("\n");
}

function renderCsv(summary) {
  const header = ["rank", "closeout_id", "lane", "account_id", "scope", "required_status", "active_for_metricool_mvp", "deferred_reason", "csv_row", "proof_path", "portal_url", "next_action"];
  return [
    header.map(csvCell).join(","),
    ...summary.tasks.map((task) => [
      task.rank,
      task.closeoutId,
      task.lane,
      task.accountId,
      task.scope,
      task.requiredStatus,
      task.activeForMetricoolMvp ? "yes" : "no",
      task.deferredReason,
      task.csvRow,
      task.proofPath,
      task.portalUrl,
      task.nextAction,
    ].map(csvCell).join(",")),
  ].join("\n") + "\n";
}

async function main() {
  await mkdir(reportsDir, { recursive: true });
  const freshness = await evidenceImportFreshness();
  const [evidenceImport, repairWorkPacket, accountReadiness] = await Promise.all([
    readJson(evidenceImportPath),
    readJson(repairWorkPacketPath),
    readJson(accountReadinessPath),
  ]);
  const activeMetricoolAccountIds = new Set(
    Array.isArray(accountReadiness.activeMvp?.accountIds)
      ? accountReadiness.activeMvp.accountIds.map((accountId) => String(accountId || ""))
      : ["sports-daily", "meme-radar"],
  );
  const metricoolMvpReady = accountReadiness.activeMvp?.status === "ready";
  const repairQueue = freshness.reportIsFresh && Array.isArray(evidenceImport.repairQueue) ? evidenceImport.repairQueue : [];
  const tiktokRows = repairQueue
    .filter((row) => String(row.platform || "").toLowerCase() === "tiktok")
    .sort((left, right) =>
      Number(left.priority ?? 99) - Number(right.priority ?? 99) ||
      Number(left.csvRow || 0) - Number(right.csvRow || 0) ||
      String(left.closeoutId || "").localeCompare(String(right.closeoutId || "")));
  const tasks = tiktokRows.map((row, index) => {
    const deferral = deferralFor(row, activeMetricoolAccountIds);
    return {
      rank: index + 1,
      closeoutId: row.closeoutId || `${row.lane || "external"}:tiktok:${index + 1}`,
      lane: row.lane || "",
      accountId: row.accountId || "",
      scope: row.scope || "",
      requiredStatus: row.requiredStatus || "",
      csvRow: row.csvRow || null,
      proofPath: row.proofPath || "",
      portalUrl: row.portalUrl || "",
      docsUrl: row.docsUrl || "",
      reason: row.reason || "",
      missingCsvFields: Array.isArray(row.missingCsvFields) ? row.missingCsvFields : [],
      csvRowTemplate: row.csvRowTemplate || "",
      nextAction: deferral.deferred ? deferral.note : taskAction(row),
      copyPacket: copyPacketFor(row),
      activeForMetricoolMvp: !deferral.deferred,
      deferredForMetricoolMvp: deferral.deferred,
      deferredReason: deferral.reason,
      deferredNote: deferral.note,
    };
  });
  const activeTasks = tasks.filter((task) => task.activeForMetricoolMvp);
  const deferredTasks = tasks.filter((task) => task.deferredForMetricoolMvp);
  const status = !freshness.reportIsFresh
    ? "stale_evidence_import_report"
    : activeTasks.length
      ? "needs_tiktok_external_closeout"
      : deferredTasks.length
        ? "metricool_mvp_ready_deferred_backlog"
        : "complete";
  const summary = {
    generatedAt: new Date().toISOString(),
    status,
    paths: {
      json: outJsonPath,
      markdown: outMarkdownPath,
      csv: outCsvPath,
      evidenceCsv: evidenceCsvPath,
      evidenceImport: evidenceImportPath,
      repairWorkPacket: repairWorkPacketPath,
    },
    source: {
      evidenceImportStatus: evidenceImport.status || "missing",
      repairWorkPacketStatus: repairWorkPacket.status || "missing",
      metricoolMvpReady,
      activeMetricoolAccountIds: [...activeMetricoolAccountIds].filter(Boolean),
      freshness,
    },
    totals: {
      tiktokTasks: tasks.length,
      activeTasks: activeTasks.length,
      deferredTasks: deferredTasks.length,
      account: tasks.filter((task) => task.lane === "account").length,
      developerApp: tasks.filter((task) => task.lane === "developer_app").length,
      permission: tasks.filter((task) => task.lane === "permission").length,
      blocked: activeTasks.length,
    },
    tasks,
    activeTasks,
    deferredTasks,
    guardrails: [
      "TikTok is first because the current operating mode is TikTok through Metricool.",
      "Direct TikTok API developer apps and posting scopes are deferred while Metricool is the publisher.",
      "This session does not create accounts automatically and does not store secrets.",
      "Only import evidence after the proof file and CSV row contain real non-secret external proof.",
      "Metricool remains approval_required; this session does not publish content.",
    ],
    nextStep: !freshness.reportIsFresh
      ? freshness.nextStep
      : activeTasks[0]
        ? `Complete ${activeTasks[0].closeoutId} first, then rerun Validate and this TikTok session.`
        : metricoolMvpReady
          ? "TikTok SPORT and memes are ready through Metricool. Continue with the current Metricool batch; deferred TikTok direct API/account expansion can wait."
          : "No active TikTok Metricool blockers remain in this session; verify SPORT and memes lanes before scheduling.",
  };
  await writeFile(outJsonPath, JSON.stringify(summary, null, 2));
  await writeFile(outMarkdownPath, renderMarkdown(summary));
  await writeFile(outCsvPath, renderCsv(summary));
  console.log(JSON.stringify({
    status: summary.status,
    tiktokTasks: summary.totals.tiktokTasks,
    firstTask: tasks[0]?.closeoutId || null,
    markdownPath: outMarkdownPath,
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
