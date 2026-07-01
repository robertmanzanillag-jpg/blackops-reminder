import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";

const rootDir = path.join(process.cwd(), "clippers_workspace");
const accountEvidenceDir = path.join(rootDir, "account-evidence");
const reportsDir = path.join(rootDir, "reports");
const defaultAccountCsvPath = path.join(rootDir, "account-permission-mvp-account-evidence.csv");
const defaultBridgeCsvPath = path.join(rootDir, "scheduled", "metricool-tiktok-bridge-evidence.csv");
const reportJsonPath = path.join(reportsDir, "clippers-tiktok-mvp-evidence-closeout.json");
const reportMarkdownPath = path.join(reportsDir, "clippers-tiktok-mvp-evidence-closeout.md");

const activeLanes = [
  { accountId: "sports-daily", accountName: "Sports Daily Clips", brand: "SPORT", handle: "@sportsdaily" },
  { accountId: "meme-radar", accountName: "Meme Radar", brand: "memes", handle: "@memeradar" },
];
const activeLaneIds = new Set(activeLanes.map((lane) => `${lane.accountId}:tiktok`));
const weakNotes = new Set(["ok", "yes", "done", "ready", "approved", "verified", "scheduled", "listo", "aprobado", "verificado"]);
const unsafeHostOrPlaceholderPattern = /<[^>]+>|\bpaste\b|\bplaceholder\b|replace this|not-real|not-metricool|todo|tbd|example\.com|localhost|127\.0\.0\.1|0\.0\.0\.0/i;
const secretTextPattern = /access_token=|refresh_token=|client_secret=|bearer\s+[a-z0-9._-]+|sk-[a-z0-9_-]+|(?:^|[\s"'[{,?&#;])(cookie|password|passcode|recovery|api[_-]?key|private[_ -]?key)["']?\s*[:=]/i;
const credentialUrlPattern = /[a-z][a-z0-9+.-]*:\/\/[^/\s:@]+:[^@\s/]+@/i;
const unsafeParamPattern = /(?:^|[?&#;])(token|code|auth|signature|sig|signed|secret|key|api_key|apikey|access|access_token|refresh|refresh_token|client_secret|session|cookie|expires|expiry|x-amz-signature|x-amz-credential|x-amz-security-token)=/i;

function decodedProofText(value) {
  return String(value || "").replace(/%[0-9a-f]{2}/gi, (match) => {
    try {
      return decodeURIComponent(match);
    } catch {
      return match;
    }
  });
}

function parseArgs(argv) {
  const args = { apply: false, accountCsvPath: defaultAccountCsvPath, bridgeCsvPath: defaultBridgeCsvPath };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--apply") args.apply = true;
    if (arg === "--account-csv") args.accountCsvPath = argv[index + 1] || args.accountCsvPath;
    if (arg === "--bridge-csv") args.bridgeCsvPath = argv[index + 1] || args.bridgeCsvPath;
  }
  return args;
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

function normalize(value) {
  return String(value || "").trim();
}

function containsUnsafeText(value) {
  const text = String(value || "");
  const decoded = decodedProofText(text);
  return [text, decoded].some((candidate) =>
    unsafeHostOrPlaceholderPattern.test(candidate)
    || secretTextPattern.test(candidate)
    || credentialUrlPattern.test(candidate)
    || unsafeParamPattern.test(candidate)
  );
}

function isSafeHttpsUrl(value) {
  try {
    const url = new URL(normalize(value));
    return url.protocol === "https:"
      && !url.username
      && !url.password
      && url.hostname.includes(".")
      && !unsafeHostOrPlaceholderPattern.test(url.hostname)
      && !unsafeHostOrPlaceholderPattern.test(url.href)
      && !unsafeParamPattern.test(url.search)
      && !unsafeParamPattern.test(decodedProofText(url.search));
  } catch {
    return false;
  }
}

function isTikTokProfileUrl(value) {
  try {
    const url = new URL(normalize(value));
    const hostname = url.hostname.toLowerCase();
    return url.protocol === "https:"
      && !url.username
      && !url.password
      && (hostname === "tiktok.com" || hostname.endsWith(".tiktok.com"))
      && /^\/@[A-Za-z0-9._-]+\/?$/.test(url.pathname)
      && !unsafeParamPattern.test(url.search);
  } catch {
    return false;
  }
}

function tiktokHandleFromProfileUrl(value) {
  try {
    const url = new URL(normalize(value));
    const match = url.pathname.match(/^\/@([A-Za-z0-9._-]+)\/?$/);
    return match ? `@${match[1]}`.toLowerCase() : "";
  } catch {
    return "";
  }
}

function isMetricoolProofUrl(value) {
  try {
    const url = new URL(normalize(value));
    const hostname = url.hostname.toLowerCase();
    const normalizedPath = url.pathname.replace(/\/+$/, "").toLowerCase();
    const pathSegments = normalizedPath.split("/").filter(Boolean);
    return url.protocol === "https:"
      && !url.username
      && !url.password
      && (hostname === "metricool.com" || hostname.endsWith(".metricool.com"))
      && /^(planner|brands?|posts?|publications?|analytics|reports?)$/i.test(pathSegments[0] || "")
      && /^[a-z0-9][a-z0-9_-]{5,}$/i.test(pathSegments[1] || "")
      && !unsafeParamPattern.test(url.search)
      && !unsafeParamPattern.test(decodedProofText(url.search));
  } catch {
    return false;
  }
}

function isGoogleEvidenceProofUrl(value) {
  try {
    const url = new URL(normalize(value));
    const hostname = url.hostname.toLowerCase();
    const pathname = url.pathname;
    const concreteDriveEvidence = hostname === "drive.google.com" && (
      /^\/file\/d\/[^/]+(?:\/|$)/.test(pathname)
      || /^\/drive\/(?:u\/\d+\/)?folders\/[^/]+(?:\/|$)/.test(pathname)
      || ((pathname === "/open" || pathname === "/folderview") && Boolean(url.searchParams.get("id")?.trim()))
    );
    const concreteDocsEvidence = hostname === "docs.google.com"
      && /^\/(?:document|spreadsheets|presentation|forms|drawings)\/d\/[^/]+(?:\/|$)/.test(pathname);
    return url.protocol === "https:"
      && !url.username
      && !url.password
      && (concreteDriveEvidence || concreteDocsEvidence)
      && !unsafeParamPattern.test(url.search);
  } catch {
    return false;
  }
}

function isMetricoolConnectionProofUrl(value) {
  return isMetricoolProofUrl(value) || isGoogleEvidenceProofUrl(value);
}

function validateNotes(notes) {
  const text = normalize(notes);
  const normalized = text.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  if (text.length < 20) return "notes must be at least 20 characters";
  if (weakNotes.has(normalized)) return "notes are too generic";
  if (containsUnsafeText(text)) return "notes contain placeholder or secret-like text";
  return "";
}

function validateAccountRow(row) {
  const record = row.record;
  const accountId = normalize(record.account_id);
  const platform = normalize(record.platform).toLowerCase();
  const laneId = `${accountId}:${platform}`;
  const proof = normalize(record.proof);
  const notes = normalize(record.notes);
  const combined = Object.values(record).join(" ");
  if (!activeLaneIds.has(laneId)) return { ok: false, reason: "only sports-daily:tiktok and meme-radar:tiktok are active MVP lanes" };
  if (normalize(record.kind).toLowerCase() !== "account") return { ok: false, reason: "kind must be account" };
  if (normalize(record.status).toLowerCase() !== "verified") return { ok: false, reason: "account status must be verified" };
  if (!proof || !isSafeHttpsUrl(proof)) return { ok: false, reason: "account proof must be a real safe HTTPS proof URL" };
  const notesIssue = validateNotes(notes);
  if (notesIssue) return { ok: false, reason: notesIssue };
  if (containsUnsafeText(combined)) return { ok: false, reason: "row contains placeholder, fake proof, or secret-like text" };
  if (!/(2fa|two-factor|two factor|security|ownership|owner|manager|verification|verified|verificad|captura|screenshot|proof)/i.test(notes)) {
    return { ok: false, reason: "account notes must mention ownership/security/verification proof" };
  }
  return { ok: true, accountId, platform, proof, notes };
}

function validateBridgeRow(row) {
  const record = row.record;
  const accountId = normalize(record.account_id);
  const platform = normalize(record.platform).toLowerCase();
  const laneId = `${accountId}:${platform}`;
  const lane = activeLanes.find((item) => item.accountId === accountId);
  const brand = normalize(record.metricool_brand_name);
  const profileUrl = normalize(record.profile_url);
  const proof = normalize(record.proof);
  const notes = normalize(record.notes);
  const combined = Object.values(record).join(" ");
  if (!activeLaneIds.has(laneId)) return { ok: false, reason: "only sports-daily:tiktok and meme-radar:tiktok are active MVP lanes" };
  if (!brand || brand !== lane?.brand) return { ok: false, reason: `metricool_brand_name must be ${lane?.brand || "the active brand"}` };
  if (!isTikTokProfileUrl(profileUrl)) return { ok: false, reason: "profile_url must be a public TikTok profile URL" };
  if (tiktokHandleFromProfileUrl(profileUrl) !== lane?.handle.toLowerCase()) return { ok: false, reason: `profile_url must match ${lane?.handle || "the active account handle"}` };
  if (!isMetricoolConnectionProofUrl(proof)) return { ok: false, reason: "proof must be a real Metricool HTTPS URL or concrete Google Drive file/folder or Docs evidence URL" };
  const notesIssue = validateNotes(notes);
  if (notesIssue) return { ok: false, reason: notesIssue };
  if (containsUnsafeText(combined)) return { ok: false, reason: "row contains placeholder, fake proof, or secret-like text" };
  return { ok: true, accountId, platform, brand, profileUrl, proof, notes };
}

function evidencePath(accountId) {
  return path.join(accountEvidenceDir, `${accountId}-tiktok.json`);
}

function buildEvidenceRecord(lane, account, bridge) {
  return {
    status: "verified",
    notes: [
      `TikTok MVP verified for ${lane.accountName}.`,
      `Account proof: ${account.proof}.`,
      `Metricool proof: ${bridge.proof}.`,
      `Public profile: ${bridge.profileUrl}.`,
      account.notes,
      bridge.notes,
      "No passwords, tokens, cookies, recovery codes, or private screenshots were stored in this evidence record.",
    ].join(" "),
    accountId: lane.accountId,
    accountName: lane.accountName,
    platform: "tiktok",
    handle: lane.handle,
    displayName: lane.accountName,
    profileUrl: bridge.profileUrl,
    accountProofUrl: account.proof,
    metricoolBrandName: lane.brand,
    metricoolProofUrl: bridge.proof,
    recordedAt: new Date().toISOString(),
    source: "clippers-tiktok-mvp-evidence-closeout",
  };
}

function renderMarkdown(summary) {
  return [
    "# TikTok MVP Evidence Closeout",
    "",
    `Generated: ${summary.generatedAt}`,
    `Mode: ${summary.mode}`,
    `Status: ${summary.status}`,
    `Applied: ${summary.applied}`,
    "",
    "## Totals",
    "",
    `- Lanes: ${summary.totals.lanes}`,
    `- Ready: ${summary.totals.ready}`,
    `- Rejected: ${summary.totals.rejected}`,
    "",
    "## Rows",
    "",
    ...summary.rows.map((row) => [
      `### ${row.accountId}:tiktok`,
      `- Status: ${row.status}`,
      `- Account proof: ${row.accountProofStatus}`,
      `- Metricool proof: ${row.bridgeProofStatus}`,
      `- Evidence path: ${row.evidencePath}`,
      row.reasons.length ? `- Reasons: ${row.reasons.join("; ")}` : "- Reasons: none",
      "",
    ].join("\n")),
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
  const args = parseArgs(process.argv.slice(2));
  await mkdir(accountEvidenceDir, { recursive: true });
  await mkdir(reportsDir, { recursive: true });
  const [accountRaw, bridgeRaw] = await Promise.all([
    readFile(args.accountCsvPath, "utf8").catch(() => ""),
    readFile(args.bridgeCsvPath, "utf8").catch(() => ""),
  ]);
  const accountRows = parseCsv(accountRaw);
  const bridgeRows = parseCsv(bridgeRaw);
  const accountByLane = new Map();
  const bridgeByLane = new Map();
  const rejected = [];

  for (const row of accountRows) {
    const result = validateAccountRow(row);
    const accountId = normalize(row.record.account_id);
    const platform = normalize(row.record.platform).toLowerCase();
    if (result.ok) accountByLane.set(`${result.accountId}:${result.platform}`, result);
    else if (activeLaneIds.has(`${accountId}:${platform}`)) rejected.push({ row: row.rowNumber, lane: `${accountId}:${platform}`, source: "account", reason: result.reason });
  }
  for (const row of bridgeRows) {
    const result = validateBridgeRow(row);
    const accountId = normalize(row.record.account_id);
    const platform = normalize(row.record.platform).toLowerCase();
    if (result.ok) bridgeByLane.set(`${result.accountId}:${result.platform}`, result);
    else if (activeLaneIds.has(`${accountId}:${platform}`)) rejected.push({ row: row.rowNumber, lane: `${accountId}:${platform}`, source: "bridge", reason: result.reason });
  }

  const rows = [];
  let applied = 0;
  for (const lane of activeLanes) {
    const laneId = `${lane.accountId}:tiktok`;
    const account = accountByLane.get(laneId);
    const bridge = bridgeByLane.get(laneId);
    const reasons = [
      !account ? "missing accepted account ownership/security proof" : null,
      !bridge ? "missing accepted Metricool bridge proof" : null,
      ...rejected.filter((item) => item.lane === laneId).map((item) => `${item.source} row ${item.row}: ${item.reason}`),
    ].filter(Boolean);
    const ready = Boolean(account && bridge && reasons.length === 0);
    const targetPath = evidencePath(lane.accountId);
    if (ready && args.apply) {
      await writeFile(targetPath, JSON.stringify(buildEvidenceRecord(lane, account, bridge), null, 2));
      applied += 1;
    }
    rows.push({
      accountId: lane.accountId,
      accountName: lane.accountName,
      platform: "tiktok",
      status: ready ? "ready" : "blocked",
      accountProofStatus: account ? "accepted" : "missing_or_rejected",
      bridgeProofStatus: bridge ? "accepted" : "missing_or_rejected",
      evidencePath: targetPath,
      reasons,
    });
  }

  const readyCount = rows.filter((row) => row.status === "ready").length;
  let readinessRefresh = null;
  if (args.apply && applied > 0) {
    const refresh = spawnSync(process.execPath, ["script/clippers-account-permission-readiness.mjs"], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    readinessRefresh = {
      status: refresh.status,
      stdout: refresh.stdout ? JSON.parse(refresh.stdout) : null,
      stderr: refresh.stderr || "",
    };
  }
  const readinessAccepted = !args.apply || applied === 0 || (
    readinessRefresh?.status === 0
    && readinessRefresh?.stdout?.status === "metricool_mvp_ready"
    && readinessRefresh?.stdout?.activeMvpReadyLanes === activeLanes.length
    && readinessRefresh?.stdout?.activeMvpTargetLanes === activeLanes.length
  );

  const summary = {
    status: readyCount === activeLanes.length
      ? args.apply
        ? readinessAccepted
          ? "applied"
          : "applied_but_readiness_blocked"
        : "ready_to_apply"
      : "blocked_invalid_evidence",
    mode: args.apply ? "apply" : "preview",
    generatedAt: new Date().toISOString(),
    accountCsvPath: args.accountCsvPath,
    bridgeCsvPath: args.bridgeCsvPath,
    reportJsonPath,
    reportMarkdownPath,
    applied,
    totals: {
      lanes: activeLanes.length,
      ready: readyCount,
      rejected: rejected.length + rows.filter((row) => row.status !== "ready").length,
    },
    rows,
    rejected,
    readinessRefresh,
    guardrails: [
      "Only sports-daily:tiktok and meme-radar:tiktok can be closed by this script.",
      "Both account ownership/security proof and Metricool bridge proof are required.",
      "Metricool proof must be a real HTTPS Metricool URL; TikTok profile must be an exact public profile URL.",
      "This script does not publish, schedule, store passwords, or store OAuth/API tokens.",
    ],
    nextStep: readyCount === activeLanes.length
      ? args.apply
        ? readinessAccepted
          ? "Run TikTok next action and proceed to Metricool manual review/scheduling only if readiness is unblocked."
          : "Fix the readiness blocker before Metricool review; evidence was written but the MVP is not ready."
        : "Rerun with --apply after manually confirming both proof URLs are real and non-secret."
      : "Fix rejected/missing account and Metricool proof rows, then rerun this script.",
  };

  await writeFile(reportJsonPath, JSON.stringify(summary, null, 2));
  await writeFile(reportMarkdownPath, renderMarkdown(summary));
  console.log(JSON.stringify({
    status: summary.status,
    mode: summary.mode,
    ready: summary.totals.ready,
    rejected: summary.totals.rejected,
    applied: summary.applied,
    reportJsonPath,
    nextStep: summary.nextStep,
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
