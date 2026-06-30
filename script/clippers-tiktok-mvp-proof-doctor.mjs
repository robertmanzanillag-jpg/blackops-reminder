import { mkdir, readFile, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";

const rootDir = path.join(process.cwd(), "clippers_workspace");
const reportsDir = path.join(rootDir, "reports", "tiktok-mvp-proof-intake");
const outJsonPath = path.join(reportsDir, "proof-doctor.json");
const outMarkdownPath = path.join(reportsDir, "proof-doctor.md");

function parseArgs(argv = process.argv.slice(2)) {
  const parsed = {
    closeoutScript: "script/clippers-tiktok-mvp-evidence-closeout.mjs",
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--closeout-script") {
      parsed.closeoutScript = argv[index + 1] || "";
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
  const closeoutPreview = runJson([args.closeoutScript]);
  const closeoutReportPath = path.join(rootDir, "reports", "clippers-tiktok-mvp-evidence-closeout.json");
  const closeout = closeoutPreview.ok ? await readJson(closeoutReportPath, {}) : {};
  const proofIntake = runJson(["script/clippers-tiktok-mvp-proof-intake-pack.mjs"]);
  const lanes = (Array.isArray(closeout?.rows) ? closeout.rows : []).map((row) => ({
    ...row,
    nextAction: laneNextAction(row),
  }));
  const previewFailed = !closeoutPreview.ok;
  const ready = previewFailed ? 0 : closeout?.totals?.ready || 0;
  const laneCount = closeout?.totals?.lanes || 2;
  const rejected = Array.isArray(closeout?.rejected) ? closeout.rejected : [];
  const status = !previewFailed && ready >= laneCount && rejected.length === 0 ? "ready_to_apply" : "needs_proof_fix";
  const summary = {
    status,
    generatedAt: new Date().toISOString(),
    scope: "tiktok_only_metricool_mvp",
    launchMode: "metricool_approval_required",
    directSocialApisRequired: false,
    closeoutStatus: previewFailed ? "preview_failed" : closeout?.status || closeoutPreview.data?.status || "unknown",
    closeoutPreviewError: previewFailed ? closeoutPreview.error : undefined,
    paths: {
      json: outJsonPath,
      markdown: outMarkdownPath,
      accountCsv: closeout?.accountCsvPath || path.join(rootDir, "account-permission-mvp-account-evidence.csv"),
      bridgeCsv: closeout?.bridgeCsvPath || path.join(rootDir, "scheduled", "metricool-tiktok-bridge-evidence.csv"),
      proofIntakeHtml: proofIntake.data?.htmlPath || path.join(reportsDir, "proof-intake-pack.html"),
    },
    totals: {
      lanes: laneCount,
      ready,
      rejected: closeout?.totals?.rejected || rejected.length,
      blocked: Math.max(0, laneCount - ready),
    },
    lanes,
    rejected,
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
        : "Open the proof intake HTML, replace blocked proof rows, then rerun this doctor before applying closeout.",
  };

  await writeFile(outJsonPath, JSON.stringify(summary, null, 2));
  await writeFile(outMarkdownPath, renderMarkdown(summary));
  console.log(JSON.stringify({
    status: summary.status,
    closeoutStatus: summary.closeoutStatus,
    ready: summary.totals.ready,
    blocked: summary.totals.blocked,
    rejected: summary.totals.rejected,
    markdownPath: outMarkdownPath,
    nextStep: summary.nextStep,
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
