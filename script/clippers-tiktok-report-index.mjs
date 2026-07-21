import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const repoRoot = process.cwd();
const workspaceRoot = path.join(repoRoot, "clippers_workspace");
const reportsRoot = path.join(workspaceRoot, "reports");

function readJson(fileName, fallback) {
  try {
    return JSON.parse(readFileSync(path.join(reportsRoot, fileName), "utf8"));
  } catch {
    return { ...fallback, missingReport: fileName };
  }
}

const readiness = readJson("tiktok-real-clip-readiness-summary.json", {
  totals: {
    exactRealClipRows: 0,
    approvalQueueCandidateRealClips: 0,
    blockedRows: 0,
  },
});
const ownedPack = readJson("metricool-owned-tiktok-approval-pack-summary.json", { rows: 0 });
const handoff = readJson("tiktok-metricool-go-live-handoff.json", {});
const missingReports = [readiness, ownedPack, handoff].map((report) => report.missingReport).filter(Boolean);
const reportsHealthy = missingReports.length === 0;

const currentOps = {
  readiness,
  ownedPack,
  handoff: {
    status: reportsHealthy
      ? handoff.status || "owned_tiktok_metricool_review_ready_real_clips_blocked"
      : "clippers_reports_missing_blocked",
    nextActions: reportsHealthy && handoff.nextActions ? handoff.nextActions : [
      ...(!reportsHealthy ? [{
        priority: "P0",
        owner: "Clipper operator",
        area: "reports",
        status: "blocked_missing_reports",
        action: `Regenerate Clippers TikTok reports. Missing: ${missingReports.join(", ")}`,
      }] : []),
      {
        priority: "P0",
        owner: "Robert",
        area: "Metricool",
        status: reportsHealthy ? "ready_for_manual_review" : "blocked_until_reports_refresh",
        action: reportsHealthy
          ? "Upload/review the owned TikTok approval pack in Metricool for SPORT and memes only."
          : "Do not upload/review until the generated report set is refreshed and healthy.",
      },
      {
        priority: "P0",
        owner: "Clipper operator",
        area: "real_clip_intake",
        status: "blocked_missing_exact_urls",
        action: "Add exact TikTok video URLs with creator/rightsholder into the exact source candidate inbox.",
      },
      {
        priority: "P0",
        owner: "Clipper operator",
        area: "permissions",
        status: "blocked_until_creator_permission",
        action: "Request and store permission evidence before any third-party real clip enters source-drop.",
      },
      {
        priority: "P1",
        owner: "Robert",
        area: "streamers",
        status: "deferred",
        action: "Connect Streamer Cuts TikTok in Metricool before adding streamer rows to approval pack.",
      },
    ],
  },
};

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function reportHref(fileName) {
  return `./${String(fileName).split("/").map((part) => encodeURIComponent(part)).join("/")}`;
}

function renderHtml({ readiness, ownedPack, handoff }) {
  const totals = readiness.totals || {};
  const ownedRows = ownedPack.rows || 0;
  const actions = handoff.nextActions || [];
  const cards = [
    ["Generated draft rows (blocked)", ownedRows],
    ["Exact real TikTok clips", totals.exactRealClipRows || 0],
    ["Real clips ready", totals.approvalQueueCandidateRealClips || 0],
    ["Blocked rows", totals.blockedRows || 0],
  ];
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Clippers TikTok Ops Index</title>
  <style>
    body{margin:0;background:#0c0f14;color:#eef3f8;font-family:Inter,Arial,sans-serif}
    main{max-width:1080px;margin:0 auto;padding:28px 18px 48px}
    h1{margin:0 0 8px;font-size:30px;line-height:1.1}
    p{color:#b8c4d2;line-height:1.55}
    a{color:#8bd3ff}
    .grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:12px;margin:20px 0}
    .card,.panel{border:1px solid #2a3542;background:#151b23;border-radius:8px;padding:16px}
    .value{font-size:30px;font-weight:800;margin-top:6px}
    .label{font-size:12px;text-transform:uppercase;letter-spacing:.04em;color:#96a7ba}
    .links{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:10px}
    .links a{display:block;border:1px solid #30445a;background:#101923;border-radius:8px;padding:12px;text-decoration:none;color:#eaf7ff}
    table{width:100%;border-collapse:collapse;margin-top:10px}
    th,td{border-bottom:1px solid #25303d;padding:10px;text-align:left;vertical-align:top}
    th{color:#9fb0c2;font-size:12px;text-transform:uppercase;letter-spacing:.04em}
    .warn{color:#ffd083}
  </style>
</head>
<body>
<main>
  <h1>Clippers TikTok Ops Index</h1>
  <p>Status: <strong>${escapeHtml(handoff.status || "unknown")}</strong>. This index separates owned/generated TikTok assets from real third-party clips.</p>
  <div class="grid">
    ${cards.map(([label, value]) => `<div class="card"><div class="label">${escapeHtml(label)}</div><div class="value">${escapeHtml(value)}</div></div>`).join("")}
  </div>
  <section class="panel">
    <h2>Open First</h2>
    <div class="links">
      <a href="${reportHref("metricool-owned-tiktok-approval-pack.csv")}">Generated TikTok draft inventory (blocked)</a>
      <a href="${reportHref("metricool-owned-tiktok-weekly-batches/README.md")}">Weekly Metricool batch files</a>
      <a href="${reportHref("metricool-owned-tiktok-upload-checklist.md")}">Metricool upload checklist</a>
      <a href="${reportHref("metricool-owned-tiktok-proof-templates/README.md")}">Metricool proof templates</a>
      <a href="${reportHref("metricool-owned-tiktok-proof-audit.md")}">Metricool proof audit</a>
      <a href="${reportHref("metricool-owned-tiktok-metrics-templates/README.md")}">Metricool metrics templates</a>
      <a href="${reportHref("metricool-owned-tiktok-metrics-audit.md")}">Metricool metrics audit</a>
      <a href="${reportHref("tiktok-account-launch-summary.md")}">TikTok account launch summary</a>
      <a href="${reportHref("tiktok-metricool-go-live-handoff.md")}">Go-live handoff</a>
      <a href="${reportHref("tiktok-real-clip-readiness.md")}">Real clip readiness audit</a>
      <a href="${reportHref("tiktok-metricool-go-live-next-actions.csv")}">Next actions CSV</a>
    </div>
  </section>
  <section class="panel">
    <h2>Truth</h2>
    <p class="warn">Generated assets are only draft examples and are blocked from Metricool. Real clips remain blocked until an exact TikTok URL, creator permission evidence, and a local source MP4 file exist.</p>
  </section>
  <section class="panel">
    <h2>Next Actions</h2>
    <table>
      <thead><tr><th>Priority</th><th>Owner</th><th>Area</th><th>Status</th><th>Action</th></tr></thead>
      <tbody>
        ${actions.map((row) => `<tr><td>${escapeHtml(row.priority)}</td><td>${escapeHtml(row.owner)}</td><td>${escapeHtml(row.area)}</td><td>${escapeHtml(row.status)}</td><td>${escapeHtml(row.action)}</td></tr>`).join("")}
      </tbody>
    </table>
  </section>
</main>
</body>
</html>`;
}

function renderMarkdown({ readiness, ownedPack, handoff }) {
  const totals = readiness.totals || {};
  return [
    "# Clippers TikTok Ops Index",
    "",
    `Status: ${handoff.status || "unknown"}`,
    "",
    `- Generated TikTok draft rows (blocked): ${ownedPack.rows || 0}`,
    `- Exact real TikTok clips: ${totals.exactRealClipRows || 0}`,
    `- Real clips ready: ${totals.approvalQueueCandidateRealClips || 0}`,
    `- Blocked rows: ${totals.blockedRows || 0}`,
    "",
    "## Open First",
    "",
    "- `clippers_workspace/reports/metricool-owned-tiktok-approval-pack.csv`",
    "- `clippers_workspace/reports/metricool-owned-tiktok-weekly-batches/README.md`",
    "- `clippers_workspace/reports/metricool-owned-tiktok-upload-checklist.md`",
    "- `clippers_workspace/reports/metricool-owned-tiktok-proof-templates/README.md`",
    "- `clippers_workspace/reports/metricool-owned-tiktok-proof-audit.md`",
    "- `clippers_workspace/reports/metricool-owned-tiktok-metrics-templates/README.md`",
    "- `clippers_workspace/reports/metricool-owned-tiktok-metrics-audit.md`",
    "- `clippers_workspace/reports/tiktok-account-launch-summary.md`",
    "- `clippers_workspace/reports/tiktok-metricool-go-live-handoff.md`",
    "- `clippers_workspace/reports/tiktok-real-clip-readiness.md`",
    "- `clippers_workspace/reports/tiktok-metricool-go-live-next-actions.csv`",
    "",
    "## Guardrail",
    "",
    "Generated assets are draft examples, not real viral clips, and are blocked from Metricool. A real clip remains blocked until its exact TikTok URL, rights proof, local evidence, and local MP4 source are present.",
    "",
  ].join("\n");
}

const payload = currentOps;

mkdirSync(reportsRoot, { recursive: true });
writeFileSync(path.join(reportsRoot, "index.html"), renderHtml(payload));
writeFileSync(path.join(reportsRoot, "index.md"), renderMarkdown(payload));

console.log(JSON.stringify({
  status: payload.handoff.status || "unknown",
  ownedTikTokRows: payload.ownedPack.rows || 0,
  exactRealClipRows: payload.readiness.totals?.exactRealClipRows || 0,
  reports: [
    "clippers_workspace/reports/index.html",
    "clippers_workspace/reports/index.md",
  ],
}, null, 2));
