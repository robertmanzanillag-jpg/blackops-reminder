import { mkdir, readFile, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";

const rootDir = path.join(process.cwd(), "clippers_workspace");
const reportsDir = path.join(rootDir, "reports", "tiktok-mvp-proof-intake");
const quickFillInputPath = path.join(reportsDir, "proof-quick-fill-input.json");
const combinedCsvPath = path.join(reportsDir, "combined-proof-intake.csv");
const outJsonPath = path.join(reportsDir, "proof-quick-fill.json");
const outMarkdownPath = path.join(reportsDir, "proof-quick-fill.md");

const lanes = [
  {
    key: "sports-daily:tiktok",
    accountId: "sports-daily",
    accountName: "Sports Daily Clips",
    platform: "tiktok",
    handle: "@sportsdaily",
    profileUrl: "https://www.tiktok.com/@sportsdaily",
    metricoolBrandName: "SPORT",
  },
  {
    key: "meme-radar:tiktok",
    accountId: "meme-radar",
    accountName: "Meme Radar",
    platform: "tiktok",
    handle: "@memeradar",
    profileUrl: "https://www.tiktok.com/@memeradar",
    metricoolBrandName: "memes",
  },
];

const combinedHeader = [
  "account_id",
  "account_name",
  "platform",
  "handle",
  "metricool_brand_name",
  "public_profile_url",
  "account_ownership_proof_url",
  "metricool_connection_proof_url",
  "account_notes",
  "metricool_notes",
  "copy_to_account_csv",
  "copy_to_bridge_csv",
];

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
  return lines.map((line) => {
    const cells = parseCsvLine(line);
    return Object.fromEntries(header.map((key, index) => [key, cells[index] || ""]));
  });
}

function normalize(value) {
  return String(value ?? "").trim();
}

const unsafeProofQueryParamPattern = /(?:^|[?&#;])(token|code|auth|signature|sig|signed|secret|key|api_key|apikey|access|refresh|session|cookie|expires|expiry|x-amz-signature|x-amz-credential|x-amz-security-token)=/i;

function containsSecret(value) {
  return /access_token=|refresh_token=|client_secret=|cookie=|password=|bearer\s+[a-z0-9._-]+|sk-[a-z0-9_-]+/i.test(String(value || "")) || unsafeProofQueryParamPattern.test(String(value || ""));
}

function hasPlaceholder(value) {
  return /<|>|paste|placeholder|replace this|example\.com|not-real|not-metricool/i.test(String(value || ""));
}

function safeHttpsUrl(value) {
  const text = normalize(value);
  if (!text || hasPlaceholder(text) || containsSecret(text)) return false;
  try {
    const url = new URL(text);
    if (unsafeProofQueryParamPattern.test(url.search)) return false;
    return url.protocol === "https:" && !/(^|\.)example\.com$/i.test(url.hostname);
  } catch {
    return false;
  }
}

function metricoolProofUrl(value) {
  const text = normalize(value);
  if (!safeHttpsUrl(text)) return false;
  try {
    const url = new URL(text);
    return /(^|\.)metricool\.com$/i.test(url.hostname);
  } catch {
    return false;
  }
}

function validNotes(value) {
  const text = normalize(value);
  return text.length >= 20 && !hasPlaceholder(text) && !containsSecret(text);
}

function lanePayload(input, lane) {
  return input?.lanes?.[lane.key] || input?.[lane.key] || {};
}

function validateInput(input) {
  const issues = [];
  for (const lane of lanes) {
    const row = lanePayload(input, lane);
    if (!safeHttpsUrl(row.accountOwnershipProofUrl)) {
      issues.push(`${lane.key}: accountOwnershipProofUrl must be a real safe HTTPS proof URL.`);
    }
    if (!metricoolProofUrl(row.metricoolConnectionProofUrl)) {
      issues.push(`${lane.key}: metricoolConnectionProofUrl must be a real HTTPS metricool.com proof URL.`);
    }
    if (!validNotes(row.accountNotes)) {
      issues.push(`${lane.key}: accountNotes must be 20+ chars and contain no placeholders or secrets.`);
    }
    if (!validNotes(row.metricoolNotes)) {
      issues.push(`${lane.key}: metricoolNotes must be 20+ chars and contain no placeholders or secrets.`);
    }
  }
  return issues;
}

function rowForLane(existingRows, input, lane) {
  const existing = existingRows.find((row) => row.account_id === lane.accountId && row.platform === lane.platform) || {};
  const row = lanePayload(input, lane);
  return {
    ...existing,
    account_id: lane.accountId,
    account_name: lane.accountName,
    platform: lane.platform,
    handle: lane.handle,
    metricool_brand_name: lane.metricoolBrandName,
    public_profile_url: lane.profileUrl,
    account_ownership_proof_url: normalize(row.accountOwnershipProofUrl),
    metricool_connection_proof_url: normalize(row.metricoolConnectionProofUrl),
    account_notes: normalize(row.accountNotes),
    metricool_notes: normalize(row.metricoolNotes),
    copy_to_account_csv: existing.copy_to_account_csv || path.join(reportsDir, "account-evidence-template.csv"),
    copy_to_bridge_csv: existing.copy_to_bridge_csv || path.join(reportsDir, "metricool-bridge-evidence-template.csv"),
  };
}

function renderCombinedCsv(rows) {
  return [
    combinedHeader.join(","),
    ...rows.map((row) => combinedHeader.map((key) => csvCell(row[key] || "")).join(",")),
    "",
  ].join("\n");
}

function renderMarkdown(summary) {
  return [
    "# TikTok MVP Proof Quick Fill",
    "",
    `Generated: ${summary.generatedAt}`,
    `Status: ${summary.status}`,
    `Applied to intake: ${summary.appliedToIntake}`,
    `Issues: ${summary.issues.length}`,
    "",
    "## Updated Lanes",
    "",
    ...summary.lanes.map((lane) => `- ${lane.accountName}: ${lane.updated ? "updated" : "blocked"}`),
    "",
    "## Issues",
    "",
    ...(summary.issues.length ? summary.issues.map((issue) => `- ${issue}`) : ["- none"]),
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
  await mkdir(reportsDir, { recursive: true });
  const input = await readJson(quickFillInputPath, {});
  const rawCombined = await readFile(combinedCsvPath, "utf8").catch(() => "");
  const existingRows = parseCsv(rawCombined);
  const issues = validateInput(input);
  const appliedToIntake = issues.length === 0;
  let refreshRun = null;
  let unblockerRun = null;

  if (appliedToIntake) {
    const nextRows = lanes.map((lane) => rowForLane(existingRows, input, lane));
    await writeFile(combinedCsvPath, renderCombinedCsv(nextRows));
    refreshRun = runJson(["script/clippers-tiktok-mvp-proof-refresh.mjs"]);
    unblockerRun = runJson(["script/clippers-tiktok-mvp-proof-unblocker.mjs"]);
  }

  const proofRefresh = await readJson(path.join(reportsDir, "proof-refresh.json"), {});
  const proofUnblocker = await readJson(path.join(reportsDir, "proof-unblocker.json"), {});
  const summary = {
    status: appliedToIntake ? "applied_to_combined_intake" : "blocked_invalid_quick_fill",
    generatedAt: new Date().toISOString(),
    scope: "tiktok_only_metricool_mvp",
    launchMode: "metricool_approval_required",
    directSocialApisRequired: false,
    appliedToIntake,
    issues,
    lanes: lanes.map((lane) => ({
      ...lane,
      updated: appliedToIntake,
    })),
    runs: {
      refreshRun,
      unblockerRun,
    },
    proofRefreshStatus: proofRefresh.status || "not_run",
    proofUnblockerStatus: proofUnblocker.status || "not_run",
    paths: {
      json: outJsonPath,
      markdown: outMarkdownPath,
      inputJson: quickFillInputPath,
      combinedCsv: combinedCsvPath,
      refreshJson: path.join(reportsDir, "proof-refresh.json"),
      unblockerJson: path.join(reportsDir, "proof-unblocker.json"),
    },
    guardrails: [
      "Quick fill only updates combined-proof-intake.csv after all required proof fields pass validation.",
      "This does not apply final evidence, publish, schedule, or enable direct social APIs.",
      "Metricool remains approval_required.",
      "Do not paste passwords, cookies, tokens, private screenshots, recovery codes, or private keys.",
    ],
    nextStep: appliedToIntake
      ? "Run Import preview and Evidence closeout preview; apply only when both say ready_to_apply."
      : "Fix the listed quick-fill issues and submit again.",
  };

  await writeFile(outJsonPath, JSON.stringify(summary, null, 2));
  await writeFile(outMarkdownPath, renderMarkdown(summary));
  console.log(JSON.stringify({
    status: summary.status,
    appliedToIntake: summary.appliedToIntake,
    issues: summary.issues.length,
    proofRefreshStatus: summary.proofRefreshStatus,
    proofUnblockerStatus: summary.proofUnblockerStatus,
    reportJsonPath: outJsonPath,
    nextStep: summary.nextStep,
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
