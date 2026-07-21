import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const repoRoot = process.cwd();
const workspaceRoot = path.join(repoRoot, "clippers_workspace");
const reportsRoot = path.join(workspaceRoot, "reports");
const weeklyRoot = path.join(reportsRoot, "metricool-owned-tiktok-weekly-batches");
const summaryPath = path.join(weeklyRoot, "summary.json");
const outputCsvPath = path.join(reportsRoot, "metricool-owned-tiktok-upload-checklist.csv");
const outputMarkdownPath = path.join(reportsRoot, "metricool-owned-tiktok-upload-checklist.md");
const outputJsonPath = path.join(reportsRoot, "metricool-owned-tiktok-upload-checklist.json");

function csvEscape(value) {
  const text = String(value ?? "");
  if (/[",\n\r]/.test(text)) return `"${text.replaceAll('"', '""')}"`;
  return text;
}

function renderCsv(rows) {
  const header = [
    "day",
    "planned_date",
    "rows",
    "batch_file",
    "upload_status",
    "review_steps",
    "proof_required",
    "guardrail",
  ];
  return [
    header.join(","),
    ...rows.map((row) => header.map((key) => csvEscape(row[key])).join(",")),
    "",
  ].join("\n");
}

function renderMarkdown(checklist) {
  return [
    "# Metricool Owned TikTok Upload Checklist",
    "",
    `Generated: ${checklist.generatedAt}`,
    `Status: ${checklist.status}`,
    "",
    "## Guardrails",
    "",
    "- Use Metricool manual review/approval only.",
    "- Do not enable autopost from this checklist.",
    "- These are owned/generated assets, not real third-party viral clips.",
    "- Real clips still require exact URL, permission proof, local evidence, and local MP4 source.",
    "",
    "## Daily Uploads",
    "",
    "| day | planned date | rows | status | file | proof required |",
    "| --- | --- | ---: | --- | --- | --- |",
    ...checklist.rows.map((row) => `| ${row.day} | ${row.planned_date} | ${row.rows} | ${row.upload_status} | ${row.batch_file} | ${row.proof_required.replaceAll("|", "/")} |`),
    "",
    "## Upload Steps",
    "",
    "1. Open the daily CSV.",
    "2. In Metricool, choose the matching TikTok account listed in each row.",
    "3. Upload the MP4 from `source_file_path`.",
    "4. Paste the caption exactly or review it manually.",
    "5. Set date/time from `planned_local_date` and `planned_local_time`.",
    "6. Keep the post in manual approval/review unless Robert explicitly approves publishing.",
    "7. Save proof: screenshot/export from Metricool planner after each batch is queued.",
    "",
  ].join("\n");
}

const summary = JSON.parse(await readFile(summaryPath, "utf8"));
const rows = (summary.batches || []).map((batch) => ({
  day: batch.day,
  planned_date: batch.plannedDate,
  rows: batch.rows,
  batch_file: batch.file,
  upload_status: batch.rows > 0 ? "ready_for_metricool_manual_review" : "empty",
  review_steps: "Open CSV, match account, upload MP4, paste caption, set planned date/time, keep approval_required, capture proof.",
  proof_required: "Metricool planner screenshot/export showing queued/manual-review posts for this batch.",
  guardrail: "Owned/generated assets only; no third-party real clips; no autopost.",
}));

const checklist = {
  status: rows.length && rows.every((row) => row.upload_status === "ready_for_metricool_manual_review")
    ? "weekly_upload_checklist_ready"
    : "weekly_upload_checklist_incomplete",
  generatedAt: new Date().toISOString(),
  rows,
};

await mkdir(reportsRoot, { recursive: true });
await writeFile(outputJsonPath, `${JSON.stringify(checklist, null, 2)}\n`);
await writeFile(outputCsvPath, renderCsv(rows));
await writeFile(outputMarkdownPath, renderMarkdown(checklist));

console.log(JSON.stringify({
  status: checklist.status,
  days: rows.length,
  totalRows: rows.reduce((sum, row) => sum + Number(row.rows || 0), 0),
  reports: [
    path.relative(repoRoot, outputMarkdownPath),
    path.relative(repoRoot, outputCsvPath),
    path.relative(repoRoot, outputJsonPath),
  ],
}, null, 2));
