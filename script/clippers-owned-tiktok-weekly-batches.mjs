import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const repoRoot = process.cwd();
const workspaceRoot = path.join(repoRoot, "clippers_workspace");
const reportsRoot = path.join(workspaceRoot, "reports");
const inputCsvPath = path.join(reportsRoot, "metricool-owned-tiktok-approval-pack.csv");
const outputRoot = path.join(reportsRoot, "metricool-owned-tiktok-weekly-batches");

const dailyTargets = [11, 11, 11, 11, 11, 11, 11];

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

function addDays(date, days) {
  const copy = new Date(date.getTime());
  copy.setDate(copy.getDate() + days);
  return copy;
}

const sourceRows = parseCsv(await readFile(inputCsvPath, "utf8"));
const validRows = sourceRows.filter((row) => (
  row.approval_status === "approval_required"
  && row.platform === "tiktok"
  && row.content_type === "owned_generated_asset"
  && row.publish_mode === "metricool_manual_approval_queue"
));

const start = new Date(Date.now() + 24 * 60 * 60 * 1000);
start.setHours(0, 0, 0, 0);

await mkdir(outputRoot, { recursive: true });
const batches = [];
let offset = 0;
for (const [dayIndex, target] of dailyTargets.entries()) {
  const rows = validRows.slice(offset, offset + target).map((row) => ({
    ...row,
    planned_local_date: addDays(start, dayIndex).toISOString().slice(0, 10),
  }));
  offset += target;
  const fileName = `day-${String(dayIndex + 1).padStart(2, "0")}-owned-tiktok-metricool.csv`;
  await writeFile(path.join(outputRoot, fileName), renderCsv(rows));
  batches.push({
    day: dayIndex + 1,
    file: path.join("clippers_workspace", "reports", "metricool-owned-tiktok-weekly-batches", fileName),
    rows: rows.length,
    sports: rows.filter((row) => row.category === "sports").length,
    memes: rows.filter((row) => row.category === "memes").length,
    plannedDate: rows[0]?.planned_local_date || addDays(start, dayIndex).toISOString().slice(0, 10),
  });
}

const summary = {
  status: offset >= validRows.length ? "weekly_owned_tiktok_batches_ready" : "weekly_owned_tiktok_batches_partial",
  generatedAt: new Date().toISOString(),
  totalRows: validRows.length,
  batchedRows: batches.reduce((sum, batch) => sum + batch.rows, 0),
  guardrail: "Owned/generated assets only. Metricool manual approval queue only. No third-party real clips and no autopost.",
  batches,
};

await writeFile(path.join(outputRoot, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`);
await writeFile(path.join(outputRoot, "README.md"), [
  "# Metricool Owned TikTok Weekly Batches",
  "",
  `Generated: ${summary.generatedAt}`,
  `Status: ${summary.status}`,
  `Total rows: ${summary.totalRows}`,
  `Batched rows: ${summary.batchedRows}`,
  "",
  "Guardrail: owned/generated assets only. These are not real viral third-party clips. Use Metricool manual approval queue only.",
  "",
  "| day | planned date | rows | sports | memes | file |",
  "| --- | --- | ---: | ---: | ---: | --- |",
  ...batches.map((batch) => `| ${batch.day} | ${batch.plannedDate} | ${batch.rows} | ${batch.sports} | ${batch.memes} | ${batch.file} |`),
  "",
].join("\n"));

console.log(JSON.stringify({
  status: summary.status,
  totalRows: summary.totalRows,
  batchedRows: summary.batchedRows,
  outputRoot: path.relative(repoRoot, outputRoot),
}, null, 2));
