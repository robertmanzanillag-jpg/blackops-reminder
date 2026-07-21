import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const repoRoot = process.cwd();
const workspaceRoot = path.join(repoRoot, "clippers_workspace");
const reportsRoot = path.join(workspaceRoot, "reports");

const readinessPath = path.join(reportsRoot, "tiktok-real-clip-readiness-summary.json");
const ownedPackPath = path.join(reportsRoot, "metricool-owned-tiktok-approval-pack-summary.json");
const outputMarkdownPath = path.join(reportsRoot, "tiktok-metricool-go-live-handoff.md");
const outputJsonPath = path.join(reportsRoot, "tiktok-metricool-go-live-handoff.json");
const outputCsvPath = path.join(reportsRoot, "tiktok-metricool-go-live-next-actions.csv");

function csvEscape(value) {
  const text = String(value ?? "");
  if (/[",\n\r]/.test(text)) return `"${text.replaceAll('"', '""')}"`;
  return text;
}

function renderActionsCsv(actions) {
  const header = ["priority", "owner", "area", "status", "action", "proof_required"];
  return [
    header.join(","),
    ...actions.map((row) => header.map((key) => csvEscape(row[key])).join(",")),
    "",
  ].join("\n");
}

function readJson(filePath, fallback) {
  try {
    return JSON.parse(readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

function buildActions(readiness, ownedPack) {
  return [
    {
      priority: "P0",
      owner: "Robert",
      area: "Metricool",
      status: ownedPack.rows ? "ready_for_manual_review" : "blocked",
      action: "Upload/review the owned TikTok approval pack in Metricool for SPORT and memes only.",
      proof_required: "Metricool planner screenshots or export showing each approved/scheduled row.",
    },
    {
      priority: "P0",
      owner: "Clipper operator",
      area: "real_clip_intake",
      status: readiness.totals?.exactRealClipRows ? "in_progress" : "blocked_missing_exact_urls",
      action: "Add exact TikTok video URLs with creator/rightsholder into the exact source candidate inbox.",
      proof_required: "Exact TikTok URL, creator/rightsholder, and queue item id.",
    },
    {
      priority: "P0",
      owner: "Clipper operator",
      area: "permissions",
      status: "blocked_until_creator_permission",
      action: "Request and store permission evidence before any third-party real clip enters source-drop.",
      proof_required: "Local evidence file under clippers_workspace/evidence-drop/real-clip-permissions.",
    },
    {
      priority: "P1",
      owner: "Robert",
      area: "streamers",
      status: "deferred",
      action: "Connect Streamer Cuts TikTok in Metricool before adding streamer rows to approval pack.",
      proof_required: "Metricool connected profile proof for Streamer Cuts TikTok.",
    },
    {
      priority: "P1",
      owner: "Clipper operator",
      area: "metrics",
      status: "not_started",
      action: "After posting, import Metricool/TikTok performance data by account to optimize hooks and posting windows.",
      proof_required: "CSV/export with views, likes, comments, shares, post URL, and publish timestamp.",
    },
  ];
}

function renderMarkdown(handoff) {
  const ownedCounts = handoff.ownedCategoryCounts || {};
  return [
    "# TikTok Metricool Go-Live Handoff",
    "",
    `Generated: ${handoff.generatedAt}`,
    `Status: ${handoff.status}`,
    "",
    "## What Is Ready",
    "",
    `- Owned/generated TikTok assets for Metricool manual review: ${handoff.ownedApprovalRows}`,
    `- Sports rows: ${ownedCounts.sports || 0}`,
    `- Memes rows: ${ownedCounts.memes || 0}`,
    `- Streamers rows: ${ownedCounts.streamers || 0}`,
    "- Publish mode: Metricool approval/manual review only.",
    "- Autopost: disabled.",
    "",
    "## What Is Not Ready",
    "",
    `- Exact real TikTok clips verified: ${handoff.readinessTotals.exactRealClipRows || 0}`,
    `- Real third-party clips ready for Metricool approval: ${handoff.readinessTotals.approvalQueueCandidateRealClips || 0}`,
    "- Third-party creator/league/streamer footage cannot be reposted until permission evidence exists.",
    "- Streamer account stays out of the current pack until the TikTok profile is connected in Metricool.",
    "",
    "## Files",
    "",
    "- Owned Metricool pack CSV: clippers_workspace/reports/metricool-owned-tiktok-approval-pack.csv",
    "- Owned Metricool pack JSON: clippers_workspace/reports/metricool-owned-tiktok-approval-pack.json",
    "- Real clip readiness audit: clippers_workspace/reports/tiktok-real-clip-readiness.md",
    "- Next actions CSV: clippers_workspace/reports/tiktok-metricool-go-live-next-actions.csv",
    "",
    "## Next Actions",
    "",
    "| priority | owner | area | status | action | proof required |",
    "| --- | --- | --- | --- | --- | --- |",
    ...handoff.nextActions.map((row) => `| ${row.priority} | ${row.owner} | ${row.area} | ${row.status} | ${row.action.replaceAll("|", "/")} | ${row.proof_required.replaceAll("|", "/")} |`),
    "",
    "## Guardrail",
    "",
    "Do not rename owned/generated assets as real viral clips. The system should only call something a real clip after exact URL, rights proof, local evidence, and local MP4 source are all present.",
    "",
  ].join("\n");
}

const readiness = await readJson(readinessPath, { totals: {}, rows: [] });
const ownedPack = await readJson(ownedPackPath, { rows: [] });
const nextActions = buildActions(readiness, ownedPack);
const handoff = {
  status: ownedPack.rows ? "owned_tiktok_metricool_review_ready_real_clips_blocked" : "blocked_no_metricool_pack",
  generatedAt: new Date().toISOString(),
  readinessTotals: readiness.totals || {},
  ownedApprovalRows: ownedPack.rows || 0,
  ownedCategoryCounts: ownedPack.categoryCounts || {},
  nextActions,
};

mkdirSync(reportsRoot, { recursive: true });
writeFileSync(outputJsonPath, `${JSON.stringify(handoff, null, 2)}\n`);
writeFileSync(outputMarkdownPath, renderMarkdown(handoff));
writeFileSync(outputCsvPath, renderActionsCsv(nextActions));

console.log(JSON.stringify({
  status: handoff.status,
  ownedApprovalRows: handoff.ownedApprovalRows,
  exactRealClipRows: handoff.readinessTotals.exactRealClipRows || 0,
  reports: [
    path.relative(repoRoot, outputMarkdownPath),
    path.relative(repoRoot, outputJsonPath),
    path.relative(repoRoot, outputCsvPath),
  ],
}, null, 2));
