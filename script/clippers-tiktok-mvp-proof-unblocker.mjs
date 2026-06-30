import { mkdir, readFile, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";

const rootDir = path.join(process.cwd(), "clippers_workspace");
const reportsDir = path.join(rootDir, "reports", "tiktok-mvp-proof-intake");
const outJsonPath = path.join(reportsDir, "proof-unblocker.json");
const outMarkdownPath = path.join(reportsDir, "proof-unblocker.md");
const outCsvPath = path.join(reportsDir, "proof-unblocker.csv");
const outHtmlPath = path.join(reportsDir, "proof-unblocker.html");

const laneDefaults = {
  "sports-daily:tiktok": {
    accountId: "sports-daily",
    accountName: "Sports Daily Clips",
    platform: "tiktok",
    handle: "@sportsdaily",
    profileUrl: "https://www.tiktok.com/@sportsdaily",
    metricoolBrandName: "SPORT",
  },
  "meme-radar:tiktok": {
    accountId: "meme-radar",
    accountName: "Meme Radar",
    platform: "tiktok",
    handle: "@memeradar",
    profileUrl: "https://www.tiktok.com/@memeradar",
    metricoolBrandName: "memes",
  },
};

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

function htmlEscape(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function inferField(item) {
  const source = String(item.source || "").toLowerCase();
  const column = String(item.column || "").toLowerCase();
  if (column.includes("account_ownership") || source === "account") return "account_ownership_proof_url";
  if (column.includes("metricool_connection") || source === "bridge") return "metricool_connection_proof_url";
  if (column.includes("handle")) return "handle";
  if (column.includes("profile")) return "public_profile_url";
  if (column.includes("metricool_brand")) return "metricool_brand_name";
  return item.column || "proof";
}

function requiredValueFor(field, lane) {
  if (field === "account_ownership_proof_url") {
    return `Real public/non-secret HTTPS proof that Robert controls ${lane.handle} and 2FA/security is enabled.`;
  }
  if (field === "metricool_connection_proof_url") {
    return `Real HTTPS metricool.com proof or Google Drive/Docs evidence URL showing Metricool brand ${lane.metricoolBrandName} is connected to ${lane.handle}.`;
  }
  if (field === "handle") return lane.handle;
  if (field === "public_profile_url") return lane.profileUrl;
  if (field === "metricool_brand_name") return lane.metricoolBrandName;
  return "Real non-secret proof value with no placeholders.";
}

function nextActionFor(field, lane) {
  if (field === "account_ownership_proof_url") {
    return `Replace the ownership proof placeholder for ${lane.accountName} with a real public/non-secret URL, then keep account_notes at 20+ characters.`;
  }
  if (field === "metricool_connection_proof_url") {
    return `Replace the Metricool proof placeholder for ${lane.metricoolBrandName} with a real metricool.com HTTPS URL or Google Drive/Docs evidence URL, then keep metricool_notes at 20+ characters.`;
  }
  return `Set ${field} exactly to ${requiredValueFor(field, lane)}.`;
}

function normalizeFix(item, sourceReport) {
  const laneKey = item.lane || "";
  const lane = laneDefaults[laneKey] || {
    accountId: laneKey.split(":")[0] || "",
    accountName: laneKey || "Unknown lane",
    platform: laneKey.split(":")[1] || "tiktok",
    handle: "",
    profileUrl: "",
    metricoolBrandName: "",
  };
  const field = inferField(item);
  return {
    lane: laneKey,
    sourceReport,
    accountId: lane.accountId,
    accountName: lane.accountName,
    platform: lane.platform,
    handle: lane.handle,
    metricoolBrandName: lane.metricoolBrandName,
    publicProfileUrl: lane.profileUrl,
    row: item.row || "",
    field,
    requiredValue: item.requiredValue || requiredValueFor(field, lane),
    reason: item.reason || "missing proof",
    nextAction: item.nextAction || nextActionFor(field, lane),
  };
}

function dedupeFixes(fixes) {
  const seen = new Set();
  return fixes.filter((item) => {
    const key = `${item.lane}:${item.field}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function renderCsv(rows) {
  const header = [
    "lane",
    "account_name",
    "handle",
    "metricool_brand_name",
    "field",
    "required_value",
    "reason",
    "next_action",
    "source_report",
  ];
  return [
    header.join(","),
    ...rows.map((row) => [
      row.lane,
      row.accountName,
      row.handle,
      row.metricoolBrandName,
      row.field,
      row.requiredValue,
      row.reason,
      row.nextAction,
      row.sourceReport,
    ].map(csvCell).join(",")),
    "",
  ].join("\n");
}

function renderMarkdown(summary) {
  return [
    "# TikTok MVP Proof Unblocker",
    "",
    `Generated: ${summary.generatedAt}`,
    `Status: ${summary.status}`,
    `Ready lanes: ${summary.readyLanes}/${summary.targetLanes}`,
    `Open fixes: ${summary.totals.openFixes}`,
    "",
    "## Required Fixes",
    "",
    ...(summary.fixes.length ? summary.fixes.map((row) => [
      `### ${row.accountName} / ${row.field}`,
      `- Lane: ${row.lane}`,
      `- Handle: ${row.handle}`,
      `- Metricool brand: ${row.metricoolBrandName}`,
      `- Required: ${row.requiredValue}`,
      `- Reason: ${row.reason}`,
      `- Next action: ${row.nextAction}`,
      "",
    ].join("\n")) : ["- none", ""]),
    "## Files",
    "",
    `- CSV: ${summary.paths.csv}`,
    `- HTML: ${summary.paths.html}`,
    `- Refresh report: ${summary.paths.refreshJson}`,
    `- Combined intake CSV: ${summary.paths.combinedCsv}`,
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

function renderHtml(summary) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>TikTok MVP Proof Unblocker</title>
  <style>
    body{margin:0;background:#09090b;color:#f4f4f5;font:14px/1.5 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
    main{max-width:1100px;margin:0 auto;padding:28px}
    section{border:1px solid #27272a;border-radius:8px;background:#111113;padding:16px;margin:14px 0}
    .badge{display:inline-block;border:1px solid #a78bfa;background:#2e1065;color:#ddd6fe;border-radius:999px;padding:2px 8px;font-size:12px}
    .grid{display:grid;gap:12px;grid-template-columns:repeat(auto-fit,minmax(280px,1fr))}
    .fix{border:1px solid #3f3f46;border-radius:8px;background:#050505;padding:12px}
    code{color:#99f6e4;word-break:break-all}
  </style>
</head>
<body>
  <main>
    <h1>TikTok MVP Proof Unblocker</h1>
    <p><span class="badge">${htmlEscape(summary.status)}</span></p>
    <section>
      <p>Ready lanes: ${summary.readyLanes}/${summary.targetLanes}. Open fixes: ${summary.totals.openFixes}. This page does not apply evidence, publish, schedule, or enable direct APIs.</p>
      <p>${htmlEscape(summary.nextStep)}</p>
    </section>
    <section class="grid">
      ${summary.fixes.map((row) => `<div class="fix">
        <h2>${htmlEscape(row.accountName)}</h2>
        <p><code>${htmlEscape(row.lane)}</code></p>
        <p>Field: <code>${htmlEscape(row.field)}</code></p>
        <p>Required: ${htmlEscape(row.requiredValue)}</p>
        <p>Next: ${htmlEscape(row.nextAction)}</p>
      </div>`).join("") || "<p>No open proof fixes.</p>"}
    </section>
  </main>
</body>
</html>
`;
}

async function main() {
  await mkdir(reportsDir, { recursive: true });
  const refreshRun = runJson(["script/clippers-tiktok-mvp-proof-refresh.mjs"]);
  const refresh = await readJson(path.join(reportsDir, "proof-refresh.json"), {});
  const proofImport = await readJson(path.join(reportsDir, "proof-intake-import.json"), {});
  const proofDoctor = await readJson(path.join(reportsDir, "proof-doctor.json"), {});
  const importFixes = Array.isArray(proofImport.fixQueue) ? proofImport.fixQueue.map((row) => normalizeFix(row, "combined_intake")) : [];
  const doctorFixes = Array.isArray(proofDoctor.fixQueue) ? proofDoctor.fixQueue.map((row) => normalizeFix(row, "target_csv")) : [];
  const fixes = dedupeFixes([...importFixes, ...doctorFixes]);
  const readyLanes = Number(refresh.readyLanes || 0);
  const targetLanes = Number(refresh.targetLanes || 2);
  const status = refreshRun.ok && fixes.length === 0 && readyLanes >= targetLanes
    ? "unblocked_ready_for_apply_preview"
    : "blocked_needs_real_proof";
  const summary = {
    status,
    generatedAt: new Date().toISOString(),
    scope: "tiktok_only_metricool_mvp",
    launchMode: "metricool_approval_required",
    directSocialApisRequired: false,
    readyLanes,
    targetLanes,
    totals: {
      openFixes: fixes.length,
      importFixes: importFixes.length,
      doctorFixes: doctorFixes.length,
    },
    fixes,
    paths: {
      json: outJsonPath,
      markdown: outMarkdownPath,
      csv: outCsvPath,
      html: outHtmlPath,
      refreshJson: refresh.paths?.json || path.join(reportsDir, "proof-refresh.json"),
      combinedCsv: proofImport.paths?.combinedCsv || path.join(reportsDir, "combined-proof-intake.csv"),
      importFixQueueCsv: proofImport.paths?.fixQueueCsv || path.join(reportsDir, "proof-intake-import-fix-queue.csv"),
      doctorFixQueueCsv: proofDoctor.paths?.fixQueueCsv || path.join(reportsDir, "proof-fix-queue.csv"),
    },
    guardrails: [
      "This unblocker does not apply evidence, publish, schedule, or enable direct social APIs.",
      "Only real public/non-secret HTTPS proof URLs are acceptable.",
      "Do not paste passwords, cookies, tokens, recovery codes, private keys, or private screenshots.",
      "Metricool remains approval_required.",
    ],
    nextStep: fixes.length
      ? "Replace the listed fields in combined-proof-intake.csv with real non-secret proof, run Proof refresh, then apply only when preview is ready_to_apply."
      : "Run Import preview and Evidence closeout preview; apply only if both are ready_to_apply.",
  };

  await writeFile(outJsonPath, JSON.stringify(summary, null, 2));
  await writeFile(outMarkdownPath, renderMarkdown(summary));
  await writeFile(outCsvPath, renderCsv(fixes));
  await writeFile(outHtmlPath, renderHtml(summary));
  console.log(JSON.stringify({
    status: summary.status,
    readyLanes: summary.readyLanes,
    targetLanes: summary.targetLanes,
    openFixes: summary.totals.openFixes,
    csvPath: outCsvPath,
    htmlPath: outHtmlPath,
    nextStep: summary.nextStep,
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
