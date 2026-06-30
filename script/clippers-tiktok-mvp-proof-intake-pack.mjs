import { mkdir, readFile, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";

const rootDir = path.join(process.cwd(), "clippers_workspace");
const intakeDir = path.join(rootDir, "reports", "tiktok-mvp-proof-intake");
const accountCsvPath = path.join(intakeDir, "account-evidence-template.csv");
const bridgeCsvPath = path.join(intakeDir, "metricool-bridge-evidence-template.csv");
const combinedCsvPath = path.join(intakeDir, "combined-proof-intake.csv");
const outJsonPath = path.join(intakeDir, "proof-intake-pack.json");
const outMarkdownPath = path.join(intakeDir, "proof-intake-pack.md");
const outHtmlPath = path.join(intakeDir, "proof-intake-pack.html");

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

function runJsonScript(args, fallback = null) {
  const result = spawnSync(process.execPath, args, {
    cwd: process.cwd(),
    encoding: "utf8",
  });
  if (result.status !== 0 || !result.stdout) return fallback;
  try {
    return JSON.parse(result.stdout);
  } catch {
    return fallback;
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

function renderAccountCsv() {
  const header = "kind,account_id,platform,status,scope,app_identifier,public_base_url,redirect_uri,portal_url,docs_url,proof,notes";
  return [
    header,
    ...lanes.map((lane) => [
      "account",
      lane.accountId,
      lane.platform,
      "submitted",
      "",
      "",
      "",
      "",
      "https://www.tiktok.com/signup",
      "",
      `<paste real public ownership proof URL for ${lane.handle}; change status to verified only after proof is real and reviewed>`,
      `${lane.accountName} ${lane.handle} ownership and 2FA/security proof pending real Robert review for Metricool TikTok MVP without secrets.`,
    ].map(csvCell).join(",")),
    "",
  ].join("\n");
}

function renderBridgeCsv() {
  const header = "account_id,platform,metricool_brand_name,metricool_blog_id,profile_url,proof,notes";
  return [
    header,
    ...lanes.map((lane) => [
      lane.accountId,
      lane.platform,
      lane.metricoolBrandName,
      "",
      lane.profileUrl,
      `<paste real public Metricool proof URL for ${lane.metricoolBrandName} ${lane.handle}>`,
      `${lane.metricoolBrandName} TikTok profile ${lane.handle} is connected in Metricool approval_required mode; public non-secret proof reviewed by Robert.`,
    ].map(csvCell).join(",")),
    "",
  ].join("\n");
}

function renderCombinedCsv() {
  const header = [
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
  return [
    header.join(","),
    ...lanes.map((lane) => [
      lane.accountId,
      lane.accountName,
      lane.platform,
      lane.handle,
      lane.metricoolBrandName,
      lane.profileUrl,
      `<paste real public ownership proof URL for ${lane.handle}>`,
      `<paste real public Metricool proof URL for ${lane.metricoolBrandName} ${lane.handle}>`,
      `${lane.accountName} ${lane.handle} ownership and 2FA/security proof reviewed by Robert for Metricool TikTok MVP without secrets.`,
      `${lane.metricoolBrandName} TikTok profile ${lane.handle} is connected in Metricool approval_required mode; public non-secret proof reviewed by Robert.`,
      accountCsvPath,
      bridgeCsvPath,
    ].map(csvCell).join(",")),
    "",
  ].join("\n");
}

function renderMarkdown(summary) {
  return [
    "# TikTok MVP Proof Intake Pack",
    "",
    `Generated: ${summary.generatedAt}`,
    `Status: ${summary.status}`,
    `Active lanes: ${summary.totals.lanes}`,
    `Ready lanes now: ${summary.currentReadiness.activeMvpReadyLanes}/${summary.currentReadiness.activeMvpTargetLanes}`,
    "",
    "## Files",
    "",
    `- Account evidence template: ${summary.paths.accountCsv}`,
    `- Metricool bridge template: ${summary.paths.bridgeCsv}`,
    `- Combined operator sheet: ${summary.paths.combinedCsv}`,
    `- HTML guide: ${summary.paths.html}`,
    "",
    "## Required Proof",
    "",
    ...summary.lanes.map((lane) => [
      `### ${lane.accountName}`,
      `- Account: ${lane.accountId}:${lane.platform}`,
      `- Handle: ${lane.handle}`,
      `- Public profile URL: ${lane.profileUrl}`,
      `- Metricool brand: ${lane.metricoolBrandName}`,
      `- Evidence quality: ${lane.evidenceQuality?.status || "unknown"}`,
      ...((lane.evidenceQuality?.issues || []).length
        ? lane.evidenceQuality.issues.map((issue) => `- Current blocker: ${issue}`)
        : ["- Current blockers: none"]),
      `- Account proof: replace the Drive placeholder with a real public/non-secret ownership or security proof URL.`,
      `- Metricool proof: replace the Metricool placeholder with a real public/non-secret Metricool proof URL.`,
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

function renderHtml(summary, accountCsv, bridgeCsv, combinedCsv) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>TikTok MVP Proof Intake</title>
  <style>
    body{margin:0;background:#09090b;color:#f4f4f5;font:14px/1.5 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
    main{max-width:1120px;margin:0 auto;padding:28px}
    section{border:1px solid #27272a;border-radius:8px;background:#111113;padding:16px;margin:14px 0}
    h1,h2{margin:0 0 8px}
    .grid{display:grid;gap:12px;grid-template-columns:repeat(auto-fit,minmax(260px,1fr))}
    .badge{display:inline-block;border:1px solid #facc15;background:#422006;color:#fde68a;border-radius:999px;padding:2px 8px;font-size:12px}
    textarea{width:100%;min-height:150px;background:#050505;color:#ccfbf1;border:1px solid #134e4a;border-radius:8px;padding:10px;font:12px/1.45 ui-monospace,SFMono-Regular,Menlo,monospace;box-sizing:border-box}
    code{color:#99f6e4;word-break:break-all}
    li{margin:6px 0}
  </style>
</head>
<body>
  <main>
    <h1>TikTok MVP Proof Intake</h1>
    <p><span class="badge">${htmlEscape(summary.status)}</span></p>
    <section>
      <h2>Current State</h2>
      <p>Ready lanes: ${summary.currentReadiness.activeMvpReadyLanes}/${summary.currentReadiness.activeMvpTargetLanes}. This guide does not publish or schedule posts.</p>
      <p>After replacing placeholders with real non-secret proof URLs, copy the two template CSVs to their target paths, run preview, then apply only if preview says ready_to_apply.</p>
    </section>
    <section class="grid">
      ${summary.lanes.map((lane) => `<div>
        <h2>${htmlEscape(lane.accountName)}</h2>
        <p><code>${htmlEscape(lane.accountId)}:${htmlEscape(lane.platform)}</code></p>
        <p>Handle: <code>${htmlEscape(lane.handle)}</code></p>
        <p>Profile: <code>${htmlEscape(lane.profileUrl)}</code></p>
        <p>Metricool brand: <code>${htmlEscape(lane.metricoolBrandName)}</code></p>
        <p>Evidence quality: <code>${htmlEscape(lane.evidenceQuality?.status || "unknown")}</code></p>
        ${(lane.evidenceQuality?.issues || []).length ? `<ul>${lane.evidenceQuality.issues.map((issue) => `<li>${htmlEscape(issue)}</li>`).join("")}</ul>` : "<p>No current evidence blockers.</p>"}
      </div>`).join("")}
    </section>
    <section>
      <h2>Account Evidence CSV</h2>
      <p>Target: <code>clippers_workspace/account-permission-mvp-account-evidence.csv</code></p>
      <textarea readonly>${htmlEscape(accountCsv)}</textarea>
    </section>
    <section>
      <h2>Metricool Bridge CSV</h2>
      <p>Target: <code>clippers_workspace/scheduled/metricool-tiktok-bridge-evidence.csv</code></p>
      <textarea readonly>${htmlEscape(bridgeCsv)}</textarea>
    </section>
    <section>
      <h2>Combined Operator Sheet</h2>
      <textarea readonly>${htmlEscape(combinedCsv)}</textarea>
    </section>
    <section>
      <h2>Guardrails</h2>
      <ul>${summary.guardrails.map((item) => `<li>${htmlEscape(item)}</li>`).join("")}</ul>
    </section>
  </main>
</body>
</html>
`;
}

async function main() {
  await mkdir(intakeDir, { recursive: true });
  const closeoutRun = runJsonScript(["script/clippers-tiktok-mvp-evidence-closeout.mjs"], {});
  const readinessRun = runJsonScript(["script/clippers-account-permission-readiness.mjs"], {});
  const readiness = await readJson(path.join(rootDir, "account-permission-readiness.json"), {});
  const closeout = await readJson(path.join(rootDir, "reports", "clippers-tiktok-mvp-evidence-closeout.json"), {});
  const closeoutRows = Array.isArray(readiness?.tiktokMvpAccountCloseout?.rows) ? readiness.tiktokMvpAccountCloseout.rows : [];
  const laneSummaries = lanes.map((lane) => {
    const closeoutRow = closeoutRows.find((row) => row.accountId === lane.accountId && row.platform === lane.platform) || {};
    return {
      ...lane,
      currentStatus: closeoutRow.status || "unknown",
      evidenceQuality: closeoutRow.evidenceQuality || {
        status: "missing",
        issues: [
          `missing verified account evidence file with exact profileUrl ${lane.profileUrl}`,
          "missing safe HTTPS accountProofUrl ownership/security proof",
          "missing safe HTTPS metricoolProofUrl connection proof",
        ],
      },
      blockers: closeoutRow.blockers || [],
      evidencePath: closeoutRow.evidencePath || "",
    };
  });
  const accountCsv = renderAccountCsv();
  const bridgeCsv = renderBridgeCsv();
  const combinedCsv = renderCombinedCsv();
  const ready = readinessRun?.activeMvpReadyLanes || 0;
  const target = readinessRun?.activeMvpTargetLanes || lanes.length;
  const summary = {
    status: ready >= target ? "ready" : "needs_real_tiktok_metricool_proof",
    generatedAt: new Date().toISOString(),
    scope: "tiktok_only_metricool_mvp",
    launchMode: "metricool_approval_required",
    directSocialApisRequired: false,
    paths: {
      json: outJsonPath,
      markdown: outMarkdownPath,
      html: outHtmlPath,
      accountCsv: accountCsvPath,
      bridgeCsv: bridgeCsvPath,
      combinedCsv: combinedCsvPath,
      targetAccountCsv: path.join(rootDir, "account-permission-mvp-account-evidence.csv"),
      targetBridgeCsv: path.join(rootDir, "scheduled", "metricool-tiktok-bridge-evidence.csv"),
    },
    totals: {
      lanes: lanes.length,
      readyLanes: ready,
      targetLanes: target,
      closeoutReady: closeout?.totals?.ready || 0,
      closeoutRejected: closeout?.totals?.rejected || 0,
    },
    currentReadiness: readinessRun,
    closeoutPreview: closeoutRun,
    lanes: laneSummaries,
    guardrails: [
      "Do not paste passwords, cookies, access tokens, recovery codes, private keys, or private screenshots.",
      "Use only public/non-secret proof URLs and 20+ character notes.",
      "TikTok profile URLs must exactly match @sportsdaily and @memeradar.",
      "Metricool proof URLs must be real HTTPS metricool.com URLs.",
      "This pack does not publish, schedule, or enable direct social APIs.",
    ],
    nextStep: ready >= target
      ? "Run TikTok MVP next action and process clips in Metricool approval_required mode."
      : "Replace every <paste real ...> placeholder with real public/non-secret proof, copy templates to the target CSV paths, run preview closeout, then apply only when ready_to_apply.",
  };

  await writeFile(accountCsvPath, accountCsv);
  await writeFile(bridgeCsvPath, bridgeCsv);
  await writeFile(combinedCsvPath, combinedCsv);
  await writeFile(outJsonPath, JSON.stringify(summary, null, 2));
  await writeFile(outMarkdownPath, renderMarkdown(summary));
  await writeFile(outHtmlPath, renderHtml(summary, accountCsv, bridgeCsv, combinedCsv));

  console.log(JSON.stringify({
    status: summary.status,
    readyLanes: summary.totals.readyLanes,
    targetLanes: summary.totals.targetLanes,
    htmlPath: outHtmlPath,
    accountCsvPath,
    bridgeCsvPath,
    nextStep: summary.nextStep,
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
