import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const repoRoot = process.cwd();
const workspaceRoot = path.join(repoRoot, "clippers_workspace");
const reportsRoot = path.join(workspaceRoot, "reports");
const sourceDropRoot = path.join(workspaceRoot, "source-drop");
const auditPath = path.join(reportsRoot, "tiktok-real-clip-readiness.json");
const outputCsvPath = path.join(reportsRoot, "metricool-owned-tiktok-approval-pack.csv");
const outputMarkdownPath = path.join(reportsRoot, "metricool-owned-tiktok-approval-pack.md");
const outputJsonPath = path.join(reportsRoot, "metricool-owned-tiktok-approval-pack.json");

const accountByCategory = {
  sports: "SPORT / Sports Daily",
  memes: "memes / Meme Radar",
  streamers: "Streamer Cuts",
};

function csvEscape(value) {
  const text = String(value ?? "");
  if (/[",\n\r]/.test(text)) return `"${text.replaceAll('"', '""')}"`;
  return text;
}

function containedSourceFilePath(category, targetFileName) {
  const baseDir = path.join(sourceDropRoot, category);
  const resolved = path.resolve(baseDir, String(targetFileName || ""));
  if (!resolved.startsWith(`${baseDir}${path.sep}`)) return "";
  return resolved;
}

function captionFor(row, index) {
  const title = String(row.title || "").trim();
  const category = String(row.category || "").trim();
  if (category === "sports") {
    return `${title}. Quick sports breakdown. Original owned analysis asset. #sports #basketball #sportstok`;
  }
  if (category === "memes") {
    return `${title}. Original Meme Radar format. #memes #relatable #fyp`;
  }
  return `${title || `Clip ${index + 1}`}. Original owned TikTok asset. #tiktok #clips`;
}

function scheduleSlot(index) {
  const slots = ["09:15", "10:45", "12:20", "13:50", "15:10", "16:40", "18:05", "19:25", "20:45", "22:05", "23:10"];
  const start = new Date(Date.now() + 24 * 60 * 60 * 1000);
  start.setHours(0, 0, 0, 0);
  const dayOffset = Math.floor(index / slots.length);
  const date = new Date(start.getTime() + dayOffset * 24 * 60 * 60 * 1000);
  return {
    planned_local_date: date.toISOString().slice(0, 10),
    planned_local_time: slots[index % slots.length],
  };
}

function renderCsv(rows) {
  const header = [
    "approval_status",
    "platform",
    "metricool_account",
    "planned_local_date",
    "planned_local_time",
    "category",
    "title",
    "caption",
    "source_file_path",
    "evidence_status",
    "rights_status",
    "content_type",
    "publish_mode",
    "notes",
  ];
  return [
    header.join(","),
    ...rows.map((row) => header.map((key) => csvEscape(row[key])).join(",")),
    "",
  ].join("\n");
}

function renderMarkdown(pack) {
  return [
    "# Metricool Owned TikTok Approval Pack",
    "",
    `Generated: ${pack.generatedAt}`,
    `Status: ${pack.status}`,
    "",
    "## Guardrails",
    "",
    "- This pack is TikTok-only.",
    "- This pack is for Metricool approval queue/manual upload only.",
    "- These rows are owned/generated assets, not real viral third-party clips.",
    "- Do not treat this as permission to repost creator, league, broadcast, streamer, or third-party footage.",
    "",
    "## Totals",
    "",
    `- Rows: ${pack.rows.length}`,
    `- Sports: ${pack.rows.filter((row) => row.category === "sports").length}`,
    `- Memes: ${pack.rows.filter((row) => row.category === "memes").length}`,
    `- Streamers: ${pack.rows.filter((row) => row.category === "streamers").length}`,
    "",
    "## Files",
    "",
    `- CSV: ${path.relative(repoRoot, outputCsvPath)}`,
    `- JSON: ${path.relative(repoRoot, outputJsonPath)}`,
    "",
    "## First Rows",
    "",
    "| account | category | title | source file |",
    "| --- | --- | --- | --- |",
    ...pack.rows.slice(0, 20).map((row) => `| ${row.metricool_account} | ${row.category} | ${String(row.title).replaceAll("|", "/")} | ${row.source_file_path} |`),
    "",
  ].join("\n");
}

const audit = JSON.parse(await readFile(auditPath, "utf8"));
const rows = (audit.rows || [])
  .filter((row) => row.metricool_gate === "approval_queue_candidate_owned_asset")
  .filter((row) => ["sports", "memes"].includes(row.category))
  .map((row, index) => {
    const sourceFilePath = containedSourceFilePath(row.category, row.target_file_name);
    const slot = scheduleSlot(index);
    return {
      approval_status: "approval_required",
      platform: "tiktok",
      metricool_account: accountByCategory[row.category] || row.category,
      planned_local_date: slot.planned_local_date,
      planned_local_time: slot.planned_local_time,
      category: row.category,
      title: row.title,
      caption: captionFor(row, index),
      source_file_path: sourceFilePath,
      evidence_status: row.evidence_status,
      rights_status: row.rights_status,
      content_type: "owned_generated_asset",
      publish_mode: "metricool_manual_approval_queue",
      notes: "Owned/generated asset candidate. Not a real viral third-party clip. Real publishing remains disabled until Robert approves in Metricool.",
    };
  });

const pack = {
  status: rows.length ? "owned_tiktok_approval_pack_ready_for_manual_metricool_review" : "blocked_no_owned_tiktok_rows",
  generatedAt: new Date().toISOString(),
  rows,
};

await mkdir(reportsRoot, { recursive: true });
await writeFile(outputJsonPath, `${JSON.stringify(pack, null, 2)}\n`);
await writeFile(path.join(reportsRoot, "metricool-owned-tiktok-approval-pack-summary.json"), `${JSON.stringify({
  status: pack.status,
  generatedAt: pack.generatedAt,
  rows: rows.length,
  categoryCounts: rows.reduce((counts, row) => {
    counts[row.category] = (counts[row.category] || 0) + 1;
    return counts;
  }, {}),
}, null, 2)}\n`);
await writeFile(outputCsvPath, renderCsv(rows));
await writeFile(outputMarkdownPath, renderMarkdown(pack));

console.log(JSON.stringify({
  status: pack.status,
  rows: rows.length,
  reports: [
    path.relative(repoRoot, outputCsvPath),
    path.relative(repoRoot, outputMarkdownPath),
    path.relative(repoRoot, outputJsonPath),
  ],
}, null, 2));
