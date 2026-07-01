import { mkdir, readFile, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";

const rootDir = path.join(process.cwd(), "clippers_workspace");
const reportsDir = path.join(rootDir, "reports", "tiktok-mvp-proof-intake");
const scheduledDir = path.join(rootDir, "scheduled");
const quickFillInputPath = path.join(reportsDir, "proof-quick-fill-input.json");
const combinedCsvPath = path.join(reportsDir, "combined-proof-intake.csv");
const bridgeCsvPath = path.join(scheduledDir, "metricool-tiktok-bridge-evidence.csv");
const outJsonPath = path.join(reportsDir, "proof-quick-fill.json");
const outMarkdownPath = path.join(reportsDir, "proof-quick-fill.md");

const lanes = [
  {
    key: "sports-daily:tiktok",
    accountId: "sports-daily",
    accountName: "Sports Daily Clips",
    platform: "tiktok",
    handle: "@sportsdailyclips",
    profileUrl: "https://www.tiktok.com/@sportsdailyclips",
    metricoolBrandName: "SPORT",
  },
  {
    key: "meme-radar:tiktok",
    accountId: "meme-radar",
    accountName: "Meme Radar",
    platform: "tiktok",
    handle: "@memeradarclips",
    profileUrl: "https://www.tiktok.com/@memeradarclips",
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

const bridgeHeader = [
  "account_id",
  "platform",
  "metricool_brand_name",
  "metricool_blog_id",
  "profile_url",
  "proof",
  "notes",
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

const unsafeProofQueryParamPattern = /(?:^|[?&#;])(token|code|auth|signature|sig|signed|secret|key|api_key|apikey|access|access_token|refresh|refresh_token|client_secret|session|cookie|expires|expiry|x-amz-signature|x-amz-credential|x-amz-security-token)=/i;

function decodedProofText(value) {
  return String(value || "").replace(/%[0-9a-f]{2}/gi, (match) => {
    try {
      return decodeURIComponent(match);
    } catch {
      return match;
    }
  });
}

function containsSecret(value) {
  const text = String(value || "");
  const decoded = decodedProofText(text);
  return [text, decoded].some((candidate) =>
    /access_token=|refresh_token=|client_secret=|bearer\s+[a-z0-9._-]+|sk-[a-z0-9_-]+|(?:^|[\s"'[{,?&#;])(cookie|password|passcode|recovery|api[_-]?key|private[_ -]?key)["']?\s*[:=]/i.test(candidate)
    || /[a-z][a-z0-9+.-]*:\/\/[^/\s:@]+:[^@\s/]+@/i.test(candidate)
    || unsafeProofQueryParamPattern.test(candidate)
  );
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
    return url.protocol === "https:" && !url.username && !url.password && !/(^|\.)example\.com$/i.test(url.hostname);
  } catch {
    return false;
  }
}

function metricoolProofUrl(value) {
  const text = normalize(value);
  if (!safeHttpsUrl(text)) return false;
  try {
    const url = new URL(text);
    if (!/(^|\.)metricool\.com$/i.test(url.hostname)) return false;
    const normalizedPath = url.pathname.replace(/\/+$/, "").toLowerCase();
    const pathSegments = normalizedPath.split("/").filter(Boolean);
    return /^(planner|brands?|posts?|publications?|analytics|reports?)$/i.test(pathSegments[0] || "")
      && /^[a-z0-9][a-z0-9_-]{5,}$/i.test(pathSegments[1] || "");
  } catch {
    return false;
  }
}

function googleEvidenceProofUrl(value) {
  const text = normalize(value);
  if (!safeHttpsUrl(text)) return false;
  try {
    const url = new URL(text);
    const hostname = url.hostname.toLowerCase();
    const pathname = url.pathname;
    if (hostname === "drive.google.com") {
      return /^\/file\/d\/[^/]+(?:\/|$)/.test(pathname)
        || /^\/drive\/(?:u\/\d+\/)?folders\/[^/]+(?:\/|$)/.test(pathname)
        || ((pathname === "/open" || pathname === "/folderview") && Boolean(url.searchParams.get("id")?.trim()));
    }
    if (hostname === "docs.google.com") {
      return /^\/(?:document|spreadsheets|presentation|forms|drawings)\/d\/[^/]+(?:\/|$)/.test(pathname);
    }
    return false;
  } catch {
    return false;
  }
}

function metricoolConnectionProofUrl(value) {
  return metricoolProofUrl(value) || googleEvidenceProofUrl(value);
}

function validNotes(value) {
  const text = normalize(value);
  return text.length >= 20 && !hasPlaceholder(text) && !containsSecret(text);
}

function validMetricoolReuseConfirmationNotes(value) {
  const text = normalize(value);
  return validNotes(text) && /(?=.*tiktok)(?=.*robert)(?=.*control)(?=.*(metricool|drive|docs|proof|screenshot|captura))/i.test(text);
}

function comparableProofUrl(value) {
  const text = normalize(value);
  if (!text) return "";
  try {
    const parsed = new URL(text);
    parsed.hash = "";
    const hostname = parsed.hostname.replace(/^www\./i, "").toLowerCase();
    const googleDriveFileId = hostname === "drive.google.com"
      ? parsed.pathname.match(/^\/file\/d\/([^/]+)/i)?.[1] || parsed.searchParams.get("id") || ""
      : "";
    const googleDriveFolderId = hostname === "drive.google.com"
      ? parsed.pathname.match(/^\/drive\/(?:u\/\d+\/)?folders\/([^/]+)/i)?.[1]
        || (parsed.pathname.match(/^\/folderview/i) ? parsed.searchParams.get("id") : "")
        || ""
      : "";
    if (googleDriveFolderId) return `https://drive.google.com/drive/folders/${googleDriveFolderId}`;
    if (googleDriveFileId) return `https://drive.google.com/file/d/${googleDriveFileId}`;
    const googleDocsMatch = hostname === "docs.google.com" ? parsed.pathname.match(/^\/([^/]+)\/d\/([^/]+)/i) : null;
    if (googleDocsMatch) return `https://docs.google.com/${googleDocsMatch[1].toLowerCase()}/d/${googleDocsMatch[2]}`;
    parsed.pathname = parsed.pathname.replace(/\/+$/, "") || "/";
    const comparableSearch = new URLSearchParams();
    for (const [key, searchValue] of parsed.searchParams.entries()) {
      if (/^(utm_|fbclid$|gclid$|msclkid$|igshid$|usp$|sharing$|ref$|source$)/i.test(key)) continue;
      comparableSearch.append(key, searchValue);
    }
    const sortedSearch = Array.from(comparableSearch.entries()).sort(([leftKey, leftValue], [rightKey, rightValue]) => {
      return leftKey.localeCompare(rightKey) || leftValue.localeCompare(rightValue);
    });
    parsed.search = "";
    for (const [key, searchValue] of sortedSearch) parsed.searchParams.append(key, searchValue);
    return parsed.toString();
  } catch {
    return text
      .replace(/#.*$/, "")
      .replace(/[?&](utm_[^=&]+|fbclid|gclid|msclkid|igshid|usp|sharing|ref|source)=[^&]*/gi, "")
      .replace(/[?&]$/, "")
      .replace(/\/+$/, "");
  }
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
    if (!metricoolConnectionProofUrl(row.metricoolConnectionProofUrl)) {
      issues.push(`${lane.key}: metricoolConnectionProofUrl must be a real HTTPS metricool.com URL or concrete Google Drive file/folder or Docs evidence URL.`);
    }
    const reusesConnectionProofAsOwnership = Boolean(
      row.accountOwnershipProofUrl
      && row.metricoolConnectionProofUrl
      && comparableProofUrl(row.accountOwnershipProofUrl) === comparableProofUrl(row.metricoolConnectionProofUrl),
    );
    const accountNotesReady = validNotes(row.accountNotes)
      && (!reusesConnectionProofAsOwnership || validMetricoolReuseConfirmationNotes(row.accountNotes));
    if (!accountNotesReady) {
      issues.push(reusesConnectionProofAsOwnership
        ? `${lane.key}: accountNotes must confirm this Metricool or concrete Drive file/folder/Docs proof shows the TikTok profile under Robert control.`
        : `${lane.key}: accountNotes must be 20+ chars and contain no placeholders or secrets.`);
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

function renderBridgeCsv(rows) {
  return [
    bridgeHeader.join(","),
    ...rows.map((row) => bridgeHeader.map((key) => csvCell(row[key] || "")).join(",")),
    "",
  ].join("\n");
}

function bridgeRowForLane(input, lane) {
  const row = lanePayload(input, lane);
  return {
    account_id: lane.accountId,
    platform: lane.platform,
    metricool_brand_name: lane.metricoolBrandName,
    metricool_blog_id: "",
    profile_url: lane.profileUrl,
    proof: normalize(row.metricoolConnectionProofUrl),
    notes: normalize(row.metricoolNotes),
  };
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
  await mkdir(scheduledDir, { recursive: true });
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
    const bridgeRows = lanes.map((lane) => bridgeRowForLane(input, lane));
    await writeFile(bridgeCsvPath, renderBridgeCsv(bridgeRows));
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
      metricoolBridgeCsv: bridgeCsvPath,
      refreshJson: path.join(reportsDir, "proof-refresh.json"),
      unblockerJson: path.join(reportsDir, "proof-unblocker.json"),
    },
    guardrails: [
      "Quick fill only updates combined-proof-intake.csv and the local Metricool bridge CSV after all required proof fields pass validation.",
      "This does not apply final evidence, publish, schedule, or enable direct social APIs.",
      "Metricool remains approval_required.",
      "Do not paste passwords, cookies, tokens, private screenshots, recovery codes, or private keys.",
    ],
    nextStep: appliedToIntake
      ? "Load the prepared Metricool bridge CSV, preview rows, then import only after review."
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
