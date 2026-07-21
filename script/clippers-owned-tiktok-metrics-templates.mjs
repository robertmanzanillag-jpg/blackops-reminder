import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const repoRoot = process.cwd();
const workspaceRoot = path.join(repoRoot, "clippers_workspace");
const reportsRoot = path.join(workspaceRoot, "reports");
const weeklyRoot = path.join(reportsRoot, "metricool-owned-tiktok-weekly-batches");
const outputRoot = path.join(reportsRoot, "metricool-owned-tiktok-metrics-templates");
const weeklySummaryPath = path.join(weeklyRoot, "summary.json");

function parseCsv(text) {
  const rows = [];
  let field = "";
  let row = [];
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    const next = text[i + 1];
    if (quoted) {
      if (char === '"' && next === '"') {
        field += '"';
        i += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        field += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (char !== "\r") {
      field += char;
    }
  }
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }
  const header = rows.shift() || [];
  return rows.filter((values) => values.some((value) => String(value || "").trim())).map((values) => {
    const record = {};
    header.forEach((key, index) => {
      record[key] = values[index] || "";
    });
    return record;
  });
}

function csvEscape(value) {
  const text = String(value ?? "");
  if (/[",\n\r]/.test(text)) return `"${text.replaceAll('"', '""')}"`;
  return text;
}

function renderCsv(rows) {
  const header = [
    "day",
    "planned_date",
    "planned_time",
    "metricool_account",
    "category",
    "title",
    "published_post_url",
    "metricool_post_id",
    "views_24h",
    "likes_24h",
    "comments_24h",
    "shares_24h",
    "views_7d",
    "likes_7d",
    "comments_7d",
    "shares_7d",
    "metric_source",
    "metrics_status",
    "operator_notes",
  ];
  return [
    header.join(","),
    ...rows.map((row) => header.map((key) => csvEscape(row[key])).join(",")),
    "",
  ].join("\n");
}

function dayFileName(day) {
  return `day-${String(day).padStart(2, "0")}-metrics-template.csv`;
}

const weeklySummary = JSON.parse(await readFile(weeklySummaryPath, "utf8"));
await mkdir(outputRoot, { recursive: true });

const generated = [];
for (const batch of weeklySummary.batches || []) {
  const batchPath = path.join(repoRoot, batch.file);
  const rows = parseCsv(await readFile(batchPath, "utf8"));
  const metricRows = rows.map((row) => ({
    day: batch.day,
    planned_date: row.planned_local_date,
    planned_time: row.planned_local_time,
    metricool_account: row.metricool_account,
    category: row.category,
    title: row.title,
    published_post_url: "",
    metricool_post_id: "",
    views_24h: "",
    likes_24h: "",
    comments_24h: "",
    shares_24h: "",
    views_7d: "",
    likes_7d: "",
    comments_7d: "",
    shares_7d: "",
    metric_source: "metricool_or_tiktok_export",
    metrics_status: "needs_metrics_after_publish",
    operator_notes: "",
  }));
  const fileName = dayFileName(batch.day);
  await writeFile(path.join(outputRoot, fileName), renderCsv(metricRows));
  generated.push({
    day: batch.day,
    plannedDate: batch.plannedDate,
    rows: metricRows.length,
    file: path.join("clippers_workspace", "reports", "metricool-owned-tiktok-metrics-templates", fileName),
  });
}

const summary = {
  status: generated.length ? "metric_templates_ready" : "metric_templates_empty",
  generatedAt: new Date().toISOString(),
  totalRows: generated.reduce((sum, item) => sum + item.rows, 0),
  guardrail: "Metrics templates only. Do not mark views as real without Metricool/TikTok export or post URL evidence.",
  templates: generated,
};

await writeFile(path.join(outputRoot, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`);
await writeFile(path.join(outputRoot, "README.md"), [
  "# Metricool Owned TikTok Metrics Templates",
  "",
  `Generated: ${summary.generatedAt}`,
  `Status: ${summary.status}`,
  `Total rows: ${summary.totalRows}`,
  "",
  "Use these after posts are live or after Metricool exports performance data. Fill 24h and 7d metrics per post.",
  "",
  "Guardrail: do not count views without published post URL, Metricool post id, or export evidence.",
  "",
  "| day | planned date | rows | file |",
  "| --- | --- | ---: | --- |",
  ...generated.map((item) => `| ${item.day} | ${item.plannedDate} | ${item.rows} | ${item.file} |`),
  "",
].join("\n"));

console.log(JSON.stringify({
  status: summary.status,
  totalRows: summary.totalRows,
  outputRoot: path.relative(repoRoot, outputRoot),
}, null, 2));
