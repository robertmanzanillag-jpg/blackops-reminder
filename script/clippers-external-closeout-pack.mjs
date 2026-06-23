import { mkdir, readFile, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";

const rootDir = path.join(process.cwd(), "clippers_workspace");
const reportsDir = path.join(rootDir, "reports");
const accountReadinessPath = path.join(rootDir, "account-permission-readiness.json");
const operationalReadinessPath = path.join(reportsDir, "clippers-operational-readiness.json");
const outJsonPath = path.join(reportsDir, "clippers-external-closeout-pack.json");
const outMarkdownPath = path.join(reportsDir, "clippers-external-closeout-pack.md");
const outCsvPath = path.join(reportsDir, "clippers-external-closeout-pack.csv");
const evidenceCsvPath = path.join(rootDir, "evidence-drop", "external-closeout-evidence-import.csv");

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}

function runJsonScript(scriptPath, label) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [scriptPath], {
      cwd: process.cwd(),
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`${label} failed with code ${code}${stderr ? `\n${stderr}` : ""}`));
        return;
      }
      try {
        resolve(JSON.parse(stdout));
      } catch (error) {
        reject(new Error(`${label} returned invalid JSON: ${error.message}`));
      }
    });
  });
}

function csvCell(value) {
  return `"${String(value ?? "").replace(/"/g, '""')}"`;
}

function accountTask(row) {
  return {
    id: `account:${row.accountId}:${row.platform}`,
    lane: "account",
    priority: row.accountId === "streamer-pulse" && row.platform === "tiktok" ? "critical" : "high",
    platform: row.platform,
    accountId: row.accountId,
    accountName: row.accountName,
    currentStatus: row.accountStatus,
    targetStatus: "verified",
    portalUrl: row.platform === "tiktok"
      ? "https://www.tiktok.com/signup"
      : row.platform === "instagram"
        ? "https://www.instagram.com/accounts/emailsignup/"
        : "https://www.youtube.com/create_channel",
    evidenceRequired: [
      "real profile/channel URL",
      "account owner/manager proof",
      "2FA or recovery method proof without secrets",
      "Metricool connected profile proof when applicable",
    ],
    safeNotes: "Do not store passwords, recovery codes, cookies, tokens, or private screenshots in this repo.",
    nextStep: row.nextStep,
  };
}

function developerTask(row) {
  return {
    id: `developer_app:${row.platform}`,
    lane: "developer_app",
    priority: "critical",
    platform: row.platform,
    accountId: "",
    accountName: row.label,
    currentStatus: row.status,
    targetStatus: "submitted_or_approved",
    portalUrl: row.platform === "tiktok"
      ? "https://developers.tiktok.com/"
      : row.platform === "instagram"
        ? "https://developers.facebook.com/"
        : "https://console.cloud.google.com/apis/library/youtube.googleapis.com",
    redirectUri: row.redirectUri || "",
    evidenceRequired: [
      "developer app id/client key/project id",
      "public HTTPS callback URL configured in portal",
      "portal screenshot/ticket URL without secrets",
      "approved status proof when available",
    ],
    missingEnvVars: row.missingEnvVars || [],
    safeNotes: "Import only identifiers and proof links; never paste client secrets into evidence CSVs.",
    nextStep: row.nextStep,
  };
}

function permissionTasks(row) {
  return (row.items || row.scopes.map((scope) => ({ scope, status: row.status, nextStep: row.nextStep }))).map((item) => ({
    id: `permission:${row.platform}:${item.scope}`,
    lane: "permission",
    priority: "critical",
    platform: row.platform,
    accountId: "",
    accountName: row.label,
    currentStatus: item.status || row.status,
    targetStatus: "requested_or_approved",
    scope: item.scope,
    portalUrl: item.developerPortalUrl || row.developerPortalUrl,
    docsUrl: item.docsUrl || row.docsUrl,
    evidenceRequired: [
      "permission request/review URL",
      "approval screenshot or portal/ticket note without secrets",
      "reviewer use-case note showing owned/permissioned content and approval_required publishing",
    ],
    safeNotes: "Blocked permissions keep Direct API disabled; Metricool approval_required can continue for connected TikTok lanes.",
    nextStep: item.nextStep || row.nextStep,
  }));
}

function evidenceRow(task) {
  const publicBaseUrl = task.redirectUri && task.redirectUri.startsWith("https://")
    ? new URL(task.redirectUri).origin
    : "";
  return [
    task.lane,
    task.accountId || "",
    task.platform || "",
    task.targetStatus,
    task.scope || "",
    "",
    publicBaseUrl,
    task.redirectUri || "",
    task.portalUrl || "",
    task.docsUrl || "",
    `<paste ${task.lane} proof URL or local secure evidence path>`,
    task.safeNotes,
  ].map(csvCell).join(",");
}

function renderMarkdown(summary) {
  const taskLines = summary.tasks.map((task) => [
    `### ${task.id}`,
    "",
    `- Priority: ${task.priority}`,
    `- Lane: ${task.lane}`,
    `- Current -> target: ${task.currentStatus} -> ${task.targetStatus}`,
    `- Portal: ${task.portalUrl || "n/a"}`,
    task.docsUrl ? `- Docs: ${task.docsUrl}` : null,
    task.redirectUri ? `- Redirect URI: ${task.redirectUri}` : null,
    task.missingEnvVars?.length ? `- Missing env vars: ${task.missingEnvVars.join(", ")}` : null,
    `- Evidence required: ${task.evidenceRequired.join(" | ")}`,
    `- Next step: ${task.nextStep}`,
    "",
  ].filter(Boolean).join("\n"));
  return [
    "# Clippers External Closeout Pack",
    "",
    `Generated: ${summary.generatedAt}`,
    `Status: ${summary.status}`,
    "",
    "This pack lists only external actions still needed before full go-live. It does not claim accounts, app approvals, permissions, or publishing are complete.",
    "",
    "## Totals",
    "",
    `- Tasks: ${summary.totals.tasks}`,
    `- Critical: ${summary.totals.critical}`,
    `- High: ${summary.totals.high}`,
    `- Account tasks: ${summary.totals.accounts}`,
    `- Developer app tasks: ${summary.totals.developerApps}`,
    `- Permission tasks: ${summary.totals.permissions}`,
    `- Metricool queued for approval: ${summary.metricool.queuedForApproval}`,
    `- Auto-send ready: ${summary.metricool.readyToSend}`,
    "",
    "## Blockers",
    "",
    ...summary.blockers.map((blocker) => `- ${blocker}`),
    "",
    "## Evidence Import",
    "",
    `CSV: ${summary.paths.evidenceCsv}`,
    "",
    "## Tasks",
    "",
    ...taskLines,
  ].join("\n");
}

function renderTaskCsv(summary) {
  const header = ["id", "lane", "priority", "platform", "account_id", "account_name", "current_status", "target_status", "scope", "portal_url", "docs_url", "redirect_uri", "next_step"];
  const rows = summary.tasks.map((task) => [
    task.id,
    task.lane,
    task.priority,
    task.platform || "",
    task.accountId || "",
    task.accountName || "",
    task.currentStatus,
    task.targetStatus,
    task.scope || "",
    task.portalUrl || "",
    task.docsUrl || "",
    task.redirectUri || "",
    task.nextStep,
  ].map(csvCell).join(","));
  return `${header.join(",")}\n${rows.join("\n")}\n`;
}

function renderEvidenceCsv(summary) {
  return [
    "kind,account_id,platform,status,scope,app_identifier,public_base_url,redirect_uri,portal_url,docs_url,proof,notes",
    ...summary.tasks.map(evidenceRow),
  ].join("\n") + "\n";
}

async function main() {
  await mkdir(reportsDir, { recursive: true });
  await mkdir(path.dirname(evidenceCsvPath), { recursive: true });
  await runJsonScript("script/clippers-operational-readiness.mjs", "Operational readiness");
  const accountReadiness = await readJson(accountReadinessPath);
  const operationalReadiness = await readJson(operationalReadinessPath);
  const accountTasks = accountReadiness.accountRows.filter((row) => row.accountStatus !== "verified").map(accountTask);
  const developerTasks = accountReadiness.developerRows.filter((row) => row.status !== "approved").map(developerTask);
  const permissionTaskRows = accountReadiness.permissionRows.filter((row) => row.status !== "approved").flatMap(permissionTasks);
  const tasks = [...accountTasks, ...developerTasks, ...permissionTaskRows];
  const safeOperationalBlockers = (operationalReadiness.blockers || []).filter((blocker) => !String(blocker).includes("Local app is not listening"));
  const blocked = tasks.length > 0 || safeOperationalBlockers.length > 0;
  const summary = {
    status: blocked ? "blocked_external_actions" : "ready_for_final_review",
    generatedAt: new Date().toISOString(),
    paths: {
      json: outJsonPath,
      markdown: outMarkdownPath,
      csv: outCsvPath,
      evidenceCsv: evidenceCsvPath,
    },
    blockers: safeOperationalBlockers,
    metricool: {
      queuedForApproval: operationalReadiness.metricool?.queuedForApproval || 0,
      readyToSend: operationalReadiness.metricool?.readyToSend || 0,
      publishMode: operationalReadiness.metricool?.publishMode || "unknown",
    },
    totals: {
      tasks: tasks.length,
      critical: tasks.filter((task) => task.priority === "critical").length,
      high: tasks.filter((task) => task.priority === "high").length,
      accounts: accountTasks.length,
      developerApps: developerTasks.length,
      permissions: permissionTaskRows.length,
    },
    tasks,
    nextStep: blocked
      ? "Complete these external portal actions, paste proof into the evidence import CSV, then rerun account and operational readiness."
      : "Run final browser QA and keep Metricool approval_required until Robert explicitly enables real publishing.",
  };
  await writeFile(outJsonPath, JSON.stringify(summary, null, 2));
  await writeFile(outMarkdownPath, renderMarkdown(summary));
  await writeFile(outCsvPath, renderTaskCsv(summary));
  await writeFile(evidenceCsvPath, renderEvidenceCsv(summary));
  console.log(JSON.stringify({
    status: summary.status,
    tasks: summary.totals.tasks,
    critical: summary.totals.critical,
    high: summary.totals.high,
    accounts: summary.totals.accounts,
    developerApps: summary.totals.developerApps,
    permissions: summary.totals.permissions,
    reportPath: outMarkdownPath,
    evidenceCsvPath,
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
