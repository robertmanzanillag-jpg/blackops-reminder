import { mkdir, readFile, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";

const rootDir = path.join(process.cwd(), "clippers_workspace");
const reportsDir = path.join(rootDir, "reports", "tiktok-mvp-proof-intake");
const outJsonPath = path.join(reportsDir, "proof-doctor.json");
const outMarkdownPath = path.join(reportsDir, "proof-doctor.md");
const outFixQueuePath = path.join(reportsDir, "proof-fix-queue.csv");
const proofDropDir = path.join(rootDir, "proof-drop", "tiktok-mvp");
const proofLinksPastePacketPath = path.join(reportsDir, "proof-links-paste-packet.txt");
const proofLinksFilledDropPath = path.join(proofDropDir, "proof-links-paste-packet-filled.txt");
const proofLinksJsonDropPath = path.join(proofDropDir, "proof-links.json");
const metricoolBridgePreviewGatePath = path.join(reportsDir, "metricool-bridge-preview-gate.json");

function parseArgs(argv = process.argv.slice(2)) {
  const parsed = {
    closeoutScript: "script/clippers-tiktok-mvp-evidence-closeout.mjs",
    accountCsvPath: "",
    bridgeCsvPath: "",
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--closeout-script") {
      parsed.closeoutScript = argv[index + 1] || "";
      index += 1;
    } else if (arg === "--account-csv") {
      parsed.accountCsvPath = argv[index + 1] || "";
      index += 1;
    } else if (arg === "--bridge-csv") {
      parsed.bridgeCsvPath = argv[index + 1] || "";
      index += 1;
    }
  }
  return parsed;
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

async function readJson(filePath, fallback = null) {
  const raw = await readFile(filePath, "utf8").catch(() => null);
  if (!raw) return fallback;
  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function laneNextAction(row) {
  if (!row) return "Add account and Metricool proof rows.";
  if (row.status === "ready") return "No proof fix needed for this lane; wait for readiness gate.";
  if (row.reasons.some((reason) => /account/i.test(reason))) return "Fix the account proof row with a real safe HTTPS ownership/security proof URL and 20+ character notes.";
  if (row.reasons.some((reason) => /Metricool|bridge/i.test(reason))) return "Fix the Metricool bridge row with the exact TikTok profile URL, real metricool.com proof URL, and 20+ character notes.";
  return row.reasons[0] || "Run proof intake pack, replace placeholders, then preview closeout again.";
}

function csvCell(value) {
  return `"${String(value ?? "").replace(/"/g, '""')}"`;
}

function rejectedColumn(row) {
  if (row.source === "account") return "proof";
  if (row.source === "bridge") return "proof";
  return "unknown";
}

function rejectedFilePath(row, paths) {
  if (row.source === "account") return paths.accountCsv;
  if (row.source === "bridge") return paths.bridgeCsv;
  return "";
}

function rejectedNextAction(row) {
  if (row.source === "account") {
    return "Paste a real public/non-secret ownership or 2FA/security proof URL, then keep notes at 20+ characters.";
  }
  if (row.source === "bridge") {
    return "Paste the real HTTPS metricool.com proof URL for the connected TikTok profile, then keep notes at 20+ characters.";
  }
  return "Replace the rejected placeholder with real non-secret evidence and rerun proof doctor.";
}

function normalizeFixQueueItem(row, paths) {
  return {
    lane: row.lane,
    source: row.source,
    filePath: rejectedFilePath(row, paths),
    row: row.row || "",
    column: rejectedColumn(row),
    reason: row.reason,
    requiredValue: row.source === "bridge"
      ? "real HTTPS metricool.com proof URL"
      : "real safe HTTPS ownership/security proof URL",
    nextAction: rejectedNextAction(row),
  };
}

function missingFixQueueItems(rows) {
  return rows.flatMap((row) => {
    if (row.status === "ready") return [];
    const lane = `${row.accountId}:${row.platform}`;
    const fixes = [];
    if (row.accountProofStatus !== "accepted") {
      fixes.push({
        lane,
        source: "account",
        row: "",
        reason: "missing accepted account ownership/security proof",
      });
    }
    if (row.bridgeProofStatus !== "accepted") {
      fixes.push({
        lane,
        source: "bridge",
        row: "",
        reason: "missing accepted Metricool bridge proof",
      });
    }
    return fixes;
  });
}

function buildFixQueue(rejected, rows, paths) {
  const seen = new Set();
  return [...rejected, ...missingFixQueueItems(rows)]
    .map((row) => normalizeFixQueueItem(row, paths))
    .filter((row) => {
      const key = `${row.lane}:${row.source}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function renderFixQueueCsv(fixQueue) {
  const header = ["lane", "source", "file_path", "row", "column", "required_value", "reason", "next_action"];
  return [
    header.join(","),
    ...fixQueue.map((row) => [
      row.lane,
      row.source,
      row.filePath,
      row.row,
      row.column,
      row.requiredValue,
      row.reason,
      row.nextAction,
    ].map(csvCell).join(",")),
    "",
  ].join("\n");
}

function renderMarkdown(summary) {
  return [
    "# TikTok MVP Proof Doctor",
    "",
    `Generated: ${summary.generatedAt}`,
    `Status: ${summary.status}`,
    `Closeout status: ${summary.closeoutStatus}`,
    `Ready lanes: ${summary.totals.ready}/${summary.totals.lanes}`,
    `Rejected rows: ${summary.totals.rejected}`,
    "",
    "## Lanes",
    "",
    ...summary.lanes.map((lane) => [
      `### ${lane.accountId}:tiktok`,
      `- Status: ${lane.status}`,
      `- Account proof: ${lane.accountProofStatus}`,
      `- Metricool proof: ${lane.bridgeProofStatus}`,
      `- Next action: ${lane.nextAction}`,
      lane.reasons.length ? `- Reasons: ${lane.reasons.join("; ")}` : "- Reasons: none",
      "",
    ].join("\n")),
    "## Rejected Rows",
    "",
    ...(summary.rejected.length ? summary.rejected.map((row) => `- ${row.source} row ${row.row} ${row.lane}: ${row.reason}`) : ["- none"]),
    "",
    "## Fix Queue",
    "",
    ...(summary.fixQueue.length ? summary.fixQueue.map((row) => `- ${row.lane}: edit ${row.filePath} row ${row.row}, column ${row.column}; ${row.nextAction}`) : ["- none"]),
    "",
    "## Recommended Proof Flow",
    "",
    ...summary.recommendedProofFlow.steps.map((step) => `- ${step}`),
    "",
    "## Required Proof Links",
    "",
    ...summary.requiredProofLinks.map((item) => `- ${item.key}: ${item.description}`),
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
  const closeoutArgs = [args.closeoutScript];
  if (args.accountCsvPath) closeoutArgs.push("--account-csv", args.accountCsvPath);
  if (args.bridgeCsvPath) closeoutArgs.push("--bridge-csv", args.bridgeCsvPath);
  const closeoutPreview = runJson(closeoutArgs);
  const closeoutReportPath = path.join(rootDir, "reports", "clippers-tiktok-mvp-evidence-closeout.json");
  const closeout = closeoutPreview.ok ? await readJson(closeoutReportPath, {}) : {};
  const proofIntake = await readJson(path.join(reportsDir, "proof-intake-pack.json"), {});
  const previewFailed = !closeoutPreview.ok;
  const ready = previewFailed ? 0 : closeout?.totals?.ready || 0;
  const laneCount = closeout?.totals?.lanes || 2;
  const rejected = Array.isArray(closeout?.rejected) ? closeout.rejected : [];
  const paths = {
    json: outJsonPath,
    markdown: outMarkdownPath,
    fixQueueCsv: outFixQueuePath,
    accountCsv: closeout?.accountCsvPath || path.join(rootDir, "account-permission-mvp-account-evidence.csv"),
    bridgeCsv: closeout?.bridgeCsvPath || path.join(rootDir, "scheduled", "metricool-tiktok-bridge-evidence.csv"),
    proofIntakeHtml: proofIntake?.paths?.html || proofIntake?.htmlPath || path.join(reportsDir, "proof-intake-pack.html"),
    proofLinksPastePacket: proofLinksPastePacketPath,
    proofLinksFilledDrop: proofLinksFilledDropPath,
    proofLinksJsonDrop: proofLinksJsonDropPath,
    metricoolBridgePreviewGate: metricoolBridgePreviewGatePath,
  };
  const rawRows = Array.isArray(closeout?.rows) ? closeout.rows : [];
  const fixQueue = previewFailed ? [] : buildFixQueue(rejected, rawRows, paths);
  const lanes = rawRows.map((row) => ({
    ...row,
    nextAction: laneNextAction(row),
    fixQueue: fixQueue.filter((item) => item.lane === `${row.accountId}:${row.platform}`),
  }));
  const status = !previewFailed && ready >= laneCount && rejected.length === 0 ? "ready_to_apply" : "needs_proof_fix";
  const summary = {
    status,
    generatedAt: new Date().toISOString(),
    scope: "tiktok_only_metricool_mvp",
    launchMode: "metricool_approval_required",
    directSocialApisRequired: false,
    closeoutStatus: previewFailed ? "preview_failed" : closeout?.status || closeoutPreview.data?.status || "unknown",
    closeoutPreviewError: previewFailed ? closeoutPreview.error : undefined,
    paths,
    totals: {
      lanes: laneCount,
      ready,
      rejected: rejected.length,
      closeoutRejected: closeout?.totals?.rejected || rejected.length,
      fixQueue: fixQueue.length,
      blocked: Math.max(0, laneCount - ready),
    },
    lanes,
    rejected,
    fixQueue,
    requiredProofLinks: [
      {
        key: "sports-daily:tiktok.accountOwnershipProofUrl",
        description: "Real public/non-secret HTTPS proof that the Sports Daily TikTok account is controlled by Robert/the team.",
      },
      {
        key: "sports-daily:tiktok.metricoolConnectionProofUrl",
        description: "Real public/non-secret HTTPS Metricool proof URL showing Sports Daily TikTok is connected in Metricool.",
      },
      {
        key: "meme-radar:tiktok.accountOwnershipProofUrl",
        description: "Real public/non-secret HTTPS proof that the Meme Radar TikTok account is controlled by Robert/the team.",
      },
      {
        key: "meme-radar:tiktok.metricoolConnectionProofUrl",
        description: "Real public/non-secret HTTPS Metricool proof URL showing Meme Radar TikTok is connected in Metricool.",
      },
    ],
    recommendedProofFlow: {
      title: "TikTok Metricool proof-links bridge",
      steps: [
        `Fill ${proofLinksPastePacketPath} and save the completed copy as ${proofLinksFilledDropPath}, or write the same four URLs to ${proofLinksJsonDropPath}.`,
        "Use Safe ingest drop or Save proof links so the app validates proof URLs and notes before touching any bridge CSV.",
        `Let quick-fill generate the Metricool bridge CSV at ${paths.bridgeCsv} only from accepted non-secret proof links.`,
        "Use Load bridge CSV, then Preview bridge rows; Import bridge rows stays blocked until the preview gate is clean and current.",
        "After import, rerun proof doctor/readiness verifier before any closeout apply step.",
      ],
    },
    guardrails: [
      "Doctor runs preview only; it never applies evidence.",
      "Metricool remains approval_required and direct social APIs remain unnecessary for this TikTok MVP.",
      "Do not store passwords, cookies, tokens, recovery codes, private keys, or private screenshots.",
      "Placeholders must remain blocked until replaced with real public/non-secret proof URLs.",
    ],
    nextStep: status === "ready_to_apply"
      ? "Run TikTok MVP evidence closeout apply only after manually confirming every proof URL is real and non-secret."
      : previewFailed
        ? "Fix the closeout preview command, then rerun proof doctor; stale reports are ignored."
        : "Fill the proof links drop with four real non-secret proof URLs, run Safe ingest drop, then Load/Preview/Import the Metricool bridge CSV only when the preview gate is ready.",
  };

  await writeFile(outJsonPath, JSON.stringify(summary, null, 2));
  await writeFile(outMarkdownPath, renderMarkdown(summary));
  await writeFile(outFixQueuePath, renderFixQueueCsv(fixQueue));
  console.log(JSON.stringify({
    status: summary.status,
    closeoutStatus: summary.closeoutStatus,
    ready: summary.totals.ready,
    blocked: summary.totals.blocked,
    rejected: summary.totals.rejected,
    fixQueue: summary.totals.fixQueue,
    markdownPath: outMarkdownPath,
    fixQueuePath: outFixQueuePath,
    nextStep: summary.nextStep,
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
