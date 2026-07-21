import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const repoRoot = process.cwd();
const workspaceRoot = path.join(repoRoot, "clippers_workspace");
const reportsRoot = path.join(workspaceRoot, "reports");
const weeklyRoot = path.join(reportsRoot, "metricool-owned-tiktok-weekly-batches");
const outputRoot = path.join(reportsRoot, "metricool-owned-tiktok-proof-templates");
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
    "source_file_path",
    "approval_status",
    "metricool_planner_proof_url",
    "metricool_export_row_id",
    "screenshot_path",
    "scheduled_status",
    "operator_notes",
    "guardrail",
  ];
  return [
    header.join(","),
    ...rows.map((row) => header.map((key) => csvEscape(row[key])).join(",")),
    "",
  ].join("\n");
}

function dayFileName(day) {
  return `day-${String(day).padStart(2, "0")}-metricool-proof-template.csv`;
}

const weeklySummary = JSON.parse(await readFile(weeklySummaryPath, "utf8"));
await mkdir(outputRoot, { recursive: true });

const generated = [];
for (const batch of weeklySummary.batches || []) {
  const batchPath = path.join(repoRoot, batch.file);
  const rows = parseCsv(await readFile(batchPath, "utf8"));
  const proofRows = rows.map((row) => ({
    day: batch.day,
    planned_date: row.planned_local_date,
    planned_time: row.planned_local_time,
    metricool_account: row.metricool_account,
    category: row.category,
    title: row.title,
    source_file_path: row.source_file_path,
    approval_status: row.approval_status,
    metricool_planner_proof_url: "",
    metricool_export_row_id: "",
    screenshot_path: "",
    scheduled_status: "needs_metricool_manual_review_proof",
    operator_notes: "",
    guardrail: "Proof template only. Owned/generated assets only. No third-party real clips. No autopost proof accepted without Robert approval.",
  }));
  const fileName = dayFileName(batch.day);
  await writeFile(path.join(outputRoot, fileName), renderCsv(proofRows));
  generated.push({
    day: batch.day,
    plannedDate: batch.plannedDate,
    rows: proofRows.length,
    file: path.join("clippers_workspace", "reports", "metricool-owned-tiktok-proof-templates", fileName),
  });
}

const summary = {
  status: generated.length ? "metricool_proof_templates_ready" : "metricool_proof_templates_empty",
  generatedAt: new Date().toISOString(),
  totalRows: generated.reduce((sum, item) => sum + item.rows, 0),
  guardrail: "Use these after uploading/saving posts in Metricool manual review. They are not proof of publication by themselves.",
  templates: generated,
};

await writeFile(path.join(outputRoot, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`);
await writeFile(path.join(outputRoot, "README.md"), [
  "# Metricool Owned TikTok Proof Templates",
  "",
  `Generated: ${summary.generatedAt}`,
  `Status: ${summary.status}`,
  `Total rows: ${summary.totalRows}`,
  "",
  "Use these after uploading/saving the daily batch in Metricool. Fill proof URL/export row/screenshot path before marking a row as queued or scheduled.",
  "",
  "Guardrail: these templates do not prove publication. They only collect manual Metricool review evidence for owned/generated assets.",
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
