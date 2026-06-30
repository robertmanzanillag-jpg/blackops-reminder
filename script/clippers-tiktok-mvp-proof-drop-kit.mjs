import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";

const rootDir = path.join(process.cwd(), "clippers_workspace");
const reportsDir = path.join(rootDir, "reports", "tiktok-mvp-proof-intake");
const dropDir = path.join(rootDir, "proof-drop", "tiktok-mvp");
const proofLinksPath = path.join(dropDir, "proof-links.json");
const quickFillInputPath = path.join(reportsDir, "proof-quick-fill-input.json");
const outJsonPath = path.join(reportsDir, "proof-drop-kit.json");
const outMarkdownPath = path.join(reportsDir, "proof-drop-kit.md");
const outHtmlPath = path.join(reportsDir, "proof-drop-kit.html");

const lanes = [
  {
    key: "sports-daily:tiktok",
    accountId: "sports-daily",
    accountName: "Sports Daily Clips",
    platform: "tiktok",
    handle: "@sportsdaily",
    metricoolBrandName: "SPORT",
    expectedFiles: {
      account: "sports-daily-account-ownership",
      metricool: "sports-daily-metricool-connection",
    },
  },
  {
    key: "meme-radar:tiktok",
    accountId: "meme-radar",
    accountName: "Meme Radar",
    platform: "tiktok",
    handle: "@memeradar",
    metricoolBrandName: "memes",
    expectedFiles: {
      account: "meme-radar-account-ownership",
      metricool: "meme-radar-metricool-connection",
    },
  },
];

const allowedExtensions = new Set([".png", ".jpg", ".jpeg", ".webp", ".pdf", ".heic", ".txt", ".md"]);

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

function normalize(value) {
  return String(value ?? "").trim();
}

const unsafeProofQueryParamPattern = /(?:^|[?&#;])(token|code|auth|signature|sig|signed|secret|key|api_key|apikey|access|refresh|session|cookie|expires|expiry|x-amz-signature|x-amz-credential|x-amz-security-token)=/i;

function containsSecret(value) {
  return /access_token=|refresh_token=|client_secret=|cookie=|password=|passcode|recovery|bearer\s+[a-z0-9._-]+|sk-[a-z0-9_-]+|api[_-]?key|private[_ -]?key/i.test(String(value || "")) || unsafeProofQueryParamPattern.test(String(value || ""));
}

function hasPlaceholder(value) {
  return /<|>|paste|placeholder|replace this|example\.com|not-real|not-metricool|todo|tbd/i.test(String(value || ""));
}

function safeHttpsUrl(value) {
  const text = normalize(value);
  if (!text || hasPlaceholder(text) || containsSecret(text)) return false;
  try {
    const url = new URL(text);
    if (unsafeProofQueryParamPattern.test(url.search)) return false;
    return url.protocol === "https:" && !url.username && !url.password;
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

function validNotes(value, pattern) {
  const text = normalize(value);
  return text.length >= 20 && !hasPlaceholder(text) && !containsSecret(text) && pattern.test(text);
}

function lanePayload(input, lane) {
  return input?.lanes?.[lane.key] || input?.[lane.key] || {};
}

function proofTemplate() {
  return {
    lanes: Object.fromEntries(lanes.map((lane) => [lane.key, {
      accountOwnershipProofUrl: "",
      metricoolConnectionProofUrl: "",
      accountNotes: `${lane.accountName} TikTok ownership and 2FA/security proof verified by Robert without secrets.`,
      metricoolNotes: `${lane.metricoolBrandName} Metricool connection to ${lane.handle} verified by Robert without secrets.`,
    }])),
  };
}

async function ensureDropKitFiles() {
  await mkdir(dropDir, { recursive: true });
  await mkdir(reportsDir, { recursive: true });
  const existing = await readJson(proofLinksPath, null);
  if (!existing) {
    await writeFile(proofLinksPath, JSON.stringify(proofTemplate(), null, 2));
  }
  await writeFile(path.join(dropDir, "README.md"), [
    "# TikTok MVP Proof Drop",
    "",
    "Put non-secret proof files here for SPORT and memes. Do not put passwords, tokens, cookies, recovery codes, signed/temporary URLs, or private API keys in this folder.",
    "",
    "Expected optional file names:",
    "",
    ...lanes.flatMap((lane) => [
      `- ${lane.expectedFiles.account}.png/pdf/jpg/etc for ${lane.accountName} account ownership/security proof`,
      `- ${lane.expectedFiles.metricool}.png/pdf/jpg/etc for ${lane.metricoolBrandName} Metricool connection proof`,
    ]),
    "",
    "Then edit proof-links.json with the real HTTPS proof URLs. Metricool connection proof must be a metricool.com HTTPS URL. URLs with x-amz/signature/expires/session/token query params are blocked.",
    "This kit never applies final evidence, publishes, schedules, or enables real publishing.",
    "",
  ].join("\n"));
}

async function detectFiles() {
  const names = await readdir(dropDir).catch(() => []);
  return lanes.map((lane) => {
    const accountFiles = names.filter((name) => {
      const parsed = path.parse(name);
      return parsed.name === lane.expectedFiles.account && allowedExtensions.has(parsed.ext.toLowerCase());
    });
    const metricoolFiles = names.filter((name) => {
      const parsed = path.parse(name);
      return parsed.name === lane.expectedFiles.metricool && allowedExtensions.has(parsed.ext.toLowerCase());
    });
    return {
      lane: lane.key,
      accountName: lane.accountName,
      accountFiles: accountFiles.map((name) => path.join(dropDir, name)),
      metricoolFiles: metricoolFiles.map((name) => path.join(dropDir, name)),
    };
  });
}

function validateProofLinks(input, detectedRows) {
  const issues = [];
  const warnings = [];
  const lanesSummary = [];
  for (const lane of lanes) {
    const payload = lanePayload(input, lane);
    const detected = detectedRows.find((row) => row.lane === lane.key);
    const accountFileReady = (detected?.accountFiles || []).length > 0;
    const metricoolFileReady = (detected?.metricoolFiles || []).length > 0;
    const accountProofReady = safeHttpsUrl(payload.accountOwnershipProofUrl);
    const metricoolProofReady = metricoolProofUrl(payload.metricoolConnectionProofUrl);
    const accountNotesReady = validNotes(payload.accountNotes, /(2fa|two-factor|two factor|security|ownership|owner|verification|verified|verificad|screenshot|captura|proof)/i);
    const metricoolNotesReady = validNotes(payload.metricoolNotes, /(metricool|connection|connected|brand|profile|verified|verificad|proof|screenshot|captura)/i);
    if (!accountFileReady) warnings.push(`${lane.key}: optional local inventory file ${lane.expectedFiles.account}.png/pdf/jpg was not detected.`);
    if (!metricoolFileReady) warnings.push(`${lane.key}: optional local inventory file ${lane.expectedFiles.metricool}.png/pdf/jpg was not detected.`);
    if (!accountProofReady) issues.push(`${lane.key}: accountOwnershipProofUrl must be a real safe HTTPS proof URL.`);
    if (!metricoolProofReady) issues.push(`${lane.key}: metricoolConnectionProofUrl must be a real HTTPS metricool.com proof URL.`);
    if (!accountNotesReady) issues.push(`${lane.key}: accountNotes must be 20+ chars, mention ownership/security proof, and contain no secrets/placeholders.`);
    if (!metricoolNotesReady) issues.push(`${lane.key}: metricoolNotes must be 20+ chars, mention Metricool connection proof, and contain no secrets/placeholders.`);
    lanesSummary.push({
      ...lane,
      accountFileReady,
      metricoolFileReady,
      accountProofReady,
      metricoolProofReady,
      accountNotesReady,
      metricoolNotesReady,
      readyForQuickFill: accountProofReady && metricoolProofReady && accountNotesReady && metricoolNotesReady,
      detectedAccountFiles: detected?.accountFiles || [],
      detectedMetricoolFiles: detected?.metricoolFiles || [],
    });
  }
  const readyForQuickFill = lanesSummary.every((lane) => lane.readyForQuickFill);
  return { readyForQuickFill, issues, warnings, lanesSummary };
}

function renderMarkdown(summary) {
  return [
    "# TikTok MVP Proof Drop Kit",
    "",
    `Generated: ${summary.generatedAt}`,
    `Status: ${summary.status}`,
    `Ready for quick fill: ${summary.readyForQuickFill}`,
    "",
    "## Lanes",
    "",
    ...summary.lanes.map((lane) => [
      `### ${lane.accountName}`,
      `- Account proof URL: ${lane.accountProofReady ? "ready" : "missing/blocking"}`,
      `- Metricool proof URL: ${lane.metricoolProofReady ? "ready" : "missing/blocking"}`,
      `- Account local file: ${lane.accountFileReady ? "detected" : "not detected"}`,
      `- Metricool local file: ${lane.metricoolFileReady ? "detected" : "not detected"}`,
      "",
    ].join("\n")),
    "## Issues",
    "",
    ...(summary.issues.length ? summary.issues.map((issue) => `- ${issue}`) : ["- none"]),
    "",
    "## Warnings",
    "",
    ...(summary.warnings.length ? summary.warnings.map((warning) => `- ${warning}`) : ["- none"]),
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

function htmlEscape(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function renderHtml(summary) {
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>TikTok MVP Proof Drop Kit</title>
  <style>
    body { background: #09090b; color: #e4e4e7; font-family: Inter, system-ui, sans-serif; margin: 32px; line-height: 1.5; }
    .lane { border: 1px solid #334155; border-radius: 8px; padding: 14px; margin: 12px 0; background: #0f172a; }
    .ok { color: #86efac; }
    .blocked { color: #fcd34d; }
    code { color: #bae6fd; }
  </style>
</head>
<body>
  <h1>TikTok MVP Proof Drop Kit</h1>
  <p>Status: <strong>${htmlEscape(summary.status)}</strong></p>
  <p>${htmlEscape(summary.nextStep)}</p>
  ${summary.lanes.map((lane) => `
    <div class="lane">
      <h2>${htmlEscape(lane.accountName)}</h2>
      <p>Account proof URL: <span class="${lane.accountProofReady ? "ok" : "blocked"}">${lane.accountProofReady ? "ready" : "missing/blocking"}</span></p>
      <p>Metricool proof URL: <span class="${lane.metricoolProofReady ? "ok" : "blocked"}">${lane.metricoolProofReady ? "ready" : "missing/blocking"}</span></p>
      <p>Expected files: <code>${htmlEscape(lane.expectedFiles.account)}.*</code>, <code>${htmlEscape(lane.expectedFiles.metricool)}.*</code></p>
    </div>
  `).join("")}
</body>
</html>`;
}

async function main() {
  await ensureDropKitFiles();
  const detectedRows = await detectFiles();
  const input = await readJson(proofLinksPath, proofTemplate());
  const validation = validateProofLinks(input, detectedRows);
  let quickFillRun = null;
  let unblockerRun = null;

  if (validation.readyForQuickFill) {
    await writeFile(quickFillInputPath, JSON.stringify(input, null, 2));
    quickFillRun = runJson(["script/clippers-tiktok-mvp-proof-quick-fill.mjs"]);
    unblockerRun = runJson(["script/clippers-tiktok-mvp-proof-unblocker.mjs"]);
  }

  const proofQuickFill = await readJson(path.join(reportsDir, "proof-quick-fill.json"), {});
  const proofUnblocker = await readJson(path.join(reportsDir, "proof-unblocker.json"), {});
  const summary = {
    status: validation.readyForQuickFill ? "ready_quick_fill_ran" : "blocked_needs_public_proof_links",
    generatedAt: new Date().toISOString(),
    scope: "tiktok_only_metricool_mvp",
    launchMode: "metricool_approval_required",
    directSocialApisRequired: false,
    realPublishEnabled: false,
    dropDir,
    proofLinksPath,
    readyForQuickFill: validation.readyForQuickFill,
    lanes: validation.lanesSummary,
    issues: validation.issues,
    warnings: validation.warnings,
    quickFillStatus: proofQuickFill?.status || "not_run",
    quickFillIssues: Array.isArray(proofQuickFill?.issues) ? proofQuickFill.issues.length : 0,
    unblockerStatus: proofUnblocker?.status || "not_run",
    openFixes: Number(proofUnblocker?.totals?.openFixes || 0),
    quickFillRun,
    unblockerRun,
    paths: {
      json: outJsonPath,
      markdown: outMarkdownPath,
      html: outHtmlPath,
      dropDir,
      proofLinksJson: proofLinksPath,
      quickFillInputJson: quickFillInputPath,
    },
    guardrails: [
      "Proof drop kit never applies final evidence.",
      "Proof drop kit never publishes, schedules, or enables direct social APIs.",
      "Local files are inventory only; closeout still requires real public/non-secret HTTPS proof URLs.",
      "Metricool remains approval_required.",
    ],
    nextStep: validation.readyForQuickFill
      ? "Review quick-fill/unblocker output, then run Import preview. Do not apply until closeout preview says ready_to_apply."
      : "Add real public/non-secret HTTPS proof URLs to proof-links.json, then rerun Proof drop kit.",
  };

  await writeFile(outJsonPath, JSON.stringify(summary, null, 2));
  await writeFile(outMarkdownPath, renderMarkdown(summary));
  await writeFile(outHtmlPath, renderHtml(summary));
  console.log(JSON.stringify({
    status: summary.status,
    readyForQuickFill: summary.readyForQuickFill,
    quickFillStatus: summary.quickFillStatus,
    quickFillIssues: summary.quickFillIssues,
    unblockerStatus: summary.unblockerStatus,
    openFixes: summary.openFixes,
    dropDir,
    proofLinksPath,
    reportJsonPath: outJsonPath,
    nextStep: summary.nextStep,
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
