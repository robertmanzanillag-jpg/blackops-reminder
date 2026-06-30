import { mkdir, readFile, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";

const rootDir = path.join(process.cwd(), "clippers_workspace");
const reportsDir = path.join(rootDir, "reports", "tiktok-mvp-proof-intake");
const defaultCombinedCsvPath = path.join(reportsDir, "combined-proof-intake.csv");
const targetAccountCsvPath = path.join(rootDir, "account-permission-mvp-account-evidence.csv");
const targetBridgeCsvPath = path.join(rootDir, "scheduled", "metricool-tiktok-bridge-evidence.csv");
const previewAccountCsvPath = path.join(reportsDir, "generated-account-evidence-preview.csv");
const previewBridgeCsvPath = path.join(reportsDir, "generated-metricool-bridge-preview.csv");
const outJsonPath = path.join(reportsDir, "proof-intake-import.json");
const outMarkdownPath = path.join(reportsDir, "proof-intake-import.md");
const outFixQueuePath = path.join(reportsDir, "proof-intake-import-fix-queue.csv");

const lanes = [
  {
    accountId: "sports-daily",
    accountName: "Sports Daily Clips",
    platform: "tiktok",
    handle: "@sportsdaily",
    profileUrl: "https://www.tiktok.com/@sportsdaily",
    metricoolBrandName: "SPORT",
  },
  {
    accountId: "meme-radar",
    accountName: "Meme Radar",
    platform: "tiktok",
    handle: "@memeradar",
    profileUrl: "https://www.tiktok.com/@memeradar",
    metricoolBrandName: "memes",
  },
];

function parseArgs(argv = process.argv.slice(2)) {
  const parsed = {
    apply: false,
    combinedCsvPath: defaultCombinedCsvPath,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--apply") parsed.apply = true;
    else if (arg === "--combined-csv") {
      parsed.combinedCsvPath = argv[index + 1] || parsed.combinedCsvPath;
      index += 1;
    }
  }
  return parsed;
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
  return cells.map((value) => value.trim());
}

function parseCsv(raw) {
  const lines = raw.split(/\r?\n/).filter((line) => line.trim());
  const header = parseCsvLine(lines.shift() || "");
  return lines.map((line, index) => {
    const cells = parseCsvLine(line);
    return {
      rowNumber: index + 2,
      record: Object.fromEntries(header.map((key, cellIndex) => [key, cells[cellIndex] || ""])),
    };
  });
}

function runJson(args) {
  const result = spawnSync(process.execPath, args, {
    cwd: process.cwd(),
    encoding: "utf8",
  });
  if (result.status !== 0 || !result.stdout) {
    return {
      ok: false,
      status: result.status,
      error: result.stderr || result.stdout || "Command returned no JSON output.",
    };
  }
  try {
    return {
      ok: true,
      data: JSON.parse(result.stdout),
    };
  } catch {
    return {
      ok: false,
      status: result.status,
      error: "Command returned invalid JSON output.",
    };
  }
}

function normalize(value) {
  return String(value || "").trim();
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

function normalizeHandle(value) {
  return normalize(value).toLowerCase();
}

function normalizeUrl(value) {
  const text = normalize(value);
  try {
    const url = new URL(text);
    url.hash = "";
    if (url.pathname.endsWith("/") && url.pathname !== "/") url.pathname = url.pathname.slice(0, -1);
    return url.toString();
  } catch {
    return text;
  }
}

function validateCombinedIdentity(row, lane) {
  const record = row.record;
  const issues = [];
  if (normalizeHandle(record.handle) !== lane.handle.toLowerCase()) {
    issues.push(`row ${row.rowNumber} ${lane.accountId}: handle must be ${lane.handle}`);
  }
  if (normalize(record.metricool_brand_name) !== lane.metricoolBrandName) {
    issues.push(`row ${row.rowNumber} ${lane.accountId}: metricool_brand_name must be ${lane.metricoolBrandName}`);
  }
  if (normalizeUrl(record.public_profile_url) !== normalizeUrl(lane.profileUrl)) {
    issues.push(`row ${row.rowNumber} ${lane.accountId}: public_profile_url must be ${lane.profileUrl}`);
  }
  return issues;
}

function combinedColumnForCloseoutIssue(item) {
  if (item.source === "account") {
    if (/notes/i.test(item.reason)) return "account_notes";
    return "account_ownership_proof_url";
  }
  if (item.source === "bridge") {
    if (/notes/i.test(item.reason)) return "metricool_notes";
    if (/profile_url/i.test(item.reason)) return "public_profile_url";
    if (/metricool_brand_name/i.test(item.reason)) return "metricool_brand_name";
    return "metricool_connection_proof_url";
  }
  return "unknown";
}

function requiredValueForCloseoutIssue(item) {
  if (item.source === "account") {
    if (/notes/i.test(item.reason)) return "20+ character ownership/security verification note without placeholders or secrets";
    return "real safe HTTPS ownership/security proof URL";
  }
  if (item.source === "bridge") {
    if (/notes/i.test(item.reason)) return "20+ character Metricool connection note without placeholders or secrets";
    if (/profile_url/i.test(item.reason)) return "exact public TikTok profile URL for the active lane";
    if (/metricool_brand_name/i.test(item.reason)) return "exact active Metricool brand name";
    return "real HTTPS metricool.com proof URL";
  }
  return "real non-secret proof value";
}

function nextActionForCloseoutIssue(item) {
  if (item.source === "account") {
    return "Fix the combined account proof fields, then rerun Import preview.";
  }
  if (item.source === "bridge") {
    return "Fix the combined Metricool proof fields, then rerun Import preview.";
  }
  return "Fix the combined proof row, then rerun Import preview.";
}

function identityFixQueueItem(error, rowNumbers) {
  const match = error.match(/^row\s+(\d+)\s+([a-z0-9-]+):\s+([^ ]+)\s+must be\s+(.+)$/i);
  const row = match?.[1] || "";
  const accountId = match?.[2] || "";
  const column = match?.[3] || "identity";
  const requiredValue = match?.[4] || "exact active lane identity value";
  return {
    lane: accountId ? `${accountId}:tiktok` : "",
    row: row || rowNumbers.get(`${accountId}:tiktok`) || "",
    column,
    requiredValue,
    reason: error,
    nextAction: "Fix the combined identity fields so the row matches the active TikTok MVP lane.",
  };
}

function buildImportFixQueue({ generated, closeoutReport }) {
  const rows = [];
  for (const lane of generated.missing) {
    rows.push({
      lane,
      row: "",
      column: "account_id",
      requiredValue: "one combined proof row for this active lane",
      reason: "missing combined proof row",
      nextAction: "Add the missing lane row to combined-proof-intake.csv.",
    });
  }
  for (const error of generated.intakeErrors) {
    rows.push(identityFixQueueItem(error, generated.rowNumbers));
  }
  const rejected = Array.isArray(closeoutReport?.rejected) ? closeoutReport.rejected : [];
  for (const item of rejected) {
    rows.push({
      lane: item.lane,
      row: generated.rowNumbers.get(item.lane) || item.row || "",
      column: combinedColumnForCloseoutIssue(item),
      requiredValue: requiredValueForCloseoutIssue(item),
      reason: item.reason,
      nextAction: nextActionForCloseoutIssue(item),
    });
  }
  const seen = new Set();
  return rows.filter((row) => {
    const key = `${row.lane}:${row.column}:${row.reason}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function renderFixQueueCsv(fixQueue) {
  const header = ["lane", "row", "column", "required_value", "reason", "next_action"];
  return [
    header.join(","),
    ...fixQueue.map((row) => [
      row.lane,
      row.row,
      row.column,
      row.requiredValue,
      row.reason,
      row.nextAction,
    ].map(csvCell).join(",")),
    "",
  ].join("\n");
}

function buildGeneratedCsvs(rows) {
  const byLane = new Map(rows.map((row) => [`${normalize(row.record.account_id)}:${normalize(row.record.platform).toLowerCase()}`, row]));
  const missing = [];
  const intakeErrors = [];
  const rowNumbers = new Map();
  const accountHeader = "kind,account_id,platform,status,scope,app_identifier,public_base_url,redirect_uri,portal_url,docs_url,proof,notes";
  const bridgeHeader = "account_id,platform,metricool_brand_name,metricool_blog_id,profile_url,proof,notes";
  const accountRows = [accountHeader];
  const bridgeRows = [bridgeHeader];

  for (const lane of lanes) {
    const row = byLane.get(`${lane.accountId}:${lane.platform}`);
    if (!row) {
      missing.push(`${lane.accountId}:${lane.platform}`);
      continue;
    }
    const record = row.record;
    rowNumbers.set(`${lane.accountId}:${lane.platform}`, row.rowNumber);
    intakeErrors.push(...validateCombinedIdentity(row, lane));
    accountRows.push([
      "account",
      lane.accountId,
      lane.platform,
      "verified",
      "",
      "",
      "",
      "",
      "https://www.tiktok.com/signup",
      "",
      normalize(record.account_ownership_proof_url),
      normalize(record.account_notes),
    ].map(csvCell).join(","));
    bridgeRows.push([
      lane.accountId,
      lane.platform,
      lane.metricoolBrandName,
      "",
      lane.profileUrl,
      normalize(record.metricool_connection_proof_url),
      normalize(record.metricool_notes),
    ].map(csvCell).join(","));
  }

  return {
    missing,
    intakeErrors,
    rowNumbers,
    accountCsv: `${accountRows.join("\n")}\n`,
    bridgeCsv: `${bridgeRows.join("\n")}\n`,
  };
}

function renderMarkdown(summary) {
  return [
    "# TikTok MVP Proof Intake Import",
    "",
    `Generated: ${summary.generatedAt}`,
    `Mode: ${summary.mode}`,
    `Status: ${summary.status}`,
    `Closeout preview: ${summary.closeoutPreviewStatus}`,
    `Ready lanes: ${summary.closeoutPreview?.ready ?? 0}/${summary.closeoutPreview?.lanes ?? 2}`,
    "",
    "## Files",
    "",
    `- Combined intake CSV: ${summary.paths.combinedCsv}`,
    `- Preview account CSV: ${summary.paths.previewAccountCsv}`,
    `- Preview bridge CSV: ${summary.paths.previewBridgeCsv}`,
    `- Fix queue CSV: ${summary.paths.fixQueueCsv}`,
    `- Target account CSV: ${summary.paths.targetAccountCsv}`,
    `- Target bridge CSV: ${summary.paths.targetBridgeCsv}`,
    "",
    "## Fix Queue",
    "",
    ...(summary.fixQueue.length ? summary.fixQueue.map((row) => `- ${row.lane} row ${row.row}, ${row.column}: ${row.nextAction}`) : ["- none"]),
    "",
    "## Guardrails",
    "",
    ...summary.guardrails.map((item) => `- ${item}`),
    "",
    "## Next Step",
    "",
    summary.nextStep,
    "",
  ].join("\n");
}

async function main() {
  const args = parseArgs();
  await mkdir(reportsDir, { recursive: true });
  await mkdir(path.dirname(targetBridgeCsvPath), { recursive: true });
  const raw = await readFile(args.combinedCsvPath, "utf8").catch(() => "");
  const rows = parseCsv(raw);
  const generated = buildGeneratedCsvs(rows);
  await writeFile(previewAccountCsvPath, generated.accountCsv);
  await writeFile(previewBridgeCsvPath, generated.bridgeCsv);
  const closeoutRun = runJson([
    "script/clippers-tiktok-mvp-evidence-closeout.mjs",
    "--account-csv",
    previewAccountCsvPath,
    "--bridge-csv",
    previewBridgeCsvPath,
  ]);
  const previewCloseoutReport = closeoutRun.ok
    ? await readJson(path.join(rootDir, "reports", "clippers-tiktok-mvp-evidence-closeout.json"), {})
    : {};
  const fixQueue = buildImportFixQueue({ generated, closeoutReport: previewCloseoutReport });
  const intakeClean = generated.missing.length === 0 && generated.intakeErrors.length === 0;
  const closeoutReady = intakeClean && closeoutRun.ok && closeoutRun.data?.status === "ready_to_apply";
  const applied = Boolean(args.apply && closeoutReady);
  if (applied) {
    await writeFile(targetAccountCsvPath, generated.accountCsv);
    await writeFile(targetBridgeCsvPath, generated.bridgeCsv);
    runJson(["script/clippers-tiktok-mvp-evidence-closeout.mjs"]);
    runJson(["script/clippers-tiktok-mvp-proof-doctor.mjs"]);
    await writeFile(targetAccountCsvPath, generated.accountCsv);
    await writeFile(targetBridgeCsvPath, generated.bridgeCsv);
  } else {
    runJson(["script/clippers-tiktok-mvp-evidence-closeout.mjs"]);
    runJson(["script/clippers-tiktok-mvp-proof-doctor.mjs"]);
  }
  const status = applied ? "applied" : closeoutReady ? "ready_to_apply" : "blocked_invalid_intake";
  const summary = {
    status,
    mode: args.apply ? "apply" : "preview",
    generatedAt: new Date().toISOString(),
    scope: "tiktok_only_metricool_mvp",
    launchMode: "metricool_approval_required",
    directSocialApisRequired: false,
    applied,
    closeoutPreviewStatus: closeoutRun.ok ? closeoutRun.data?.status || "unknown" : "preview_failed",
    closeoutPreview: closeoutRun.ok ? {
      ready: closeoutRun.data?.ready || 0,
      rejected: closeoutRun.data?.rejected || 0,
      lanes: lanes.length,
      reportJsonPath: closeoutRun.data?.reportJsonPath,
    } : null,
    missingLanes: generated.missing,
    intakeErrors: generated.intakeErrors,
    fixQueue,
    paths: {
      json: outJsonPath,
      markdown: outMarkdownPath,
      combinedCsv: args.combinedCsvPath,
      previewAccountCsv: previewAccountCsvPath,
      previewBridgeCsv: previewBridgeCsvPath,
      fixQueueCsv: outFixQueuePath,
      targetAccountCsv: targetAccountCsvPath,
      targetBridgeCsv: targetBridgeCsvPath,
    },
    guardrails: [
      "This import only prepares proof CSVs; it does not apply final evidence records.",
      "Metricool remains approval_required; this script does not publish or schedule posts.",
      "Do not paste passwords, cookies, tokens, private screenshots, recovery codes, or private keys.",
      "The closeout validator must say ready_to_apply before apply writes target CSVs.",
    ],
    nextStep: applied
      ? "Run TikTok MVP evidence closeout apply only after manually confirming proof URLs are real and non-secret."
      : closeoutReady
        ? "Run this import with --apply to copy validated CSVs to the target paths, then run evidence closeout apply."
        : "Fix combined proof intake rows, rerun preview import, and do not apply until closeout preview says ready_to_apply.",
  };

  await writeFile(outJsonPath, JSON.stringify(summary, null, 2));
  await writeFile(outMarkdownPath, renderMarkdown(summary));
  await writeFile(outFixQueuePath, renderFixQueueCsv(fixQueue));
  console.log(JSON.stringify({
    status: summary.status,
    mode: summary.mode,
    applied: summary.applied,
    closeoutPreviewStatus: summary.closeoutPreviewStatus,
    ready: summary.closeoutPreview?.ready || 0,
    rejected: summary.closeoutPreview?.rejected || 0,
    missingLanes: summary.missingLanes.length,
    intakeErrors: summary.intakeErrors.length,
    fixQueue: summary.fixQueue.length,
    fixQueuePath: outFixQueuePath,
    reportJsonPath: outJsonPath,
    nextStep: summary.nextStep,
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
