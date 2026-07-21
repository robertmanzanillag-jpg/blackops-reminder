import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const repoRoot = process.cwd();
const workspaceRoot = path.join(repoRoot, "clippers_workspace");
const reportsRoot = path.join(workspaceRoot, "reports");
const proofRoot = path.join(reportsRoot, "metricool-owned-tiktok-proof-templates");
const outputCsvPath = path.join(reportsRoot, "metricool-owned-tiktok-proof-audit.csv");
const outputMarkdownPath = path.join(reportsRoot, "metricool-owned-tiktok-proof-audit.md");
const outputJsonPath = path.join(reportsRoot, "metricool-owned-tiktok-proof-audit.json");

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

function hasProof(row) {
  return Boolean(
    String(row.metricool_planner_proof_url || "").trim()
    || String(row.metricool_export_row_id || "").trim()
    || String(row.screenshot_path || "").trim(),
  );
}

function auditRow(row) {
  const proofPresent = hasProof(row);
  const scheduledStatus = String(row.scheduled_status || "").trim();
  const status = proofPresent && scheduledStatus && scheduledStatus !== "needs_metricool_manual_review_proof"
    ? "proof_recorded"
    : "proof_missing";
  return {
    day: row.day,
    planned_date: row.planned_date,
    planned_time: row.planned_time,
    metricool_account: row.metricool_account,
    category: row.category,
    title: row.title,
    proof_status: status,
    scheduled_status: scheduledStatus || "missing",
    metricool_planner_proof_url: row.metricool_planner_proof_url || "",
    metricool_export_row_id: row.metricool_export_row_id || "",
    screenshot_path: row.screenshot_path || "",
    next_action: status === "proof_recorded"
      ? "Keep proof with the batch record and import metrics after posting."
      : "After saving/uploading in Metricool, add planner proof URL, export row id, or screenshot path.",
  };
}

function renderCsv(rows) {
  const header = [
    "day",
    "planned_date",
    "planned_time",
    "metricool_account",
    "category",
    "title",
    "proof_status",
    "scheduled_status",
    "metricool_planner_proof_url",
    "metricool_export_row_id",
    "screenshot_path",
    "next_action",
  ];
  return [
    header.join(","),
    ...rows.map((row) => header.map((key) => csvEscape(row[key])).join(",")),
    "",
  ].join("\n");
}

function renderMarkdown(audit) {
  return [
    "# Metricool Owned TikTok Proof Audit",
    "",
    `Generated: ${audit.generatedAt}`,
    `Status: ${audit.status}`,
    "",
    "## Totals",
    "",
    `- Total rows: ${audit.totalRows}`,
    `- Proof recorded: ${audit.proofRecordedRows}`,
    `- Proof missing: ${audit.proofMissingRows}`,
    "",
    "## Guardrail",
    "",
    "Proof recorded means Metricool manual-review evidence was filled in the proof template. It does not mean the post was published unless the proof explicitly shows that state.",
    "",
    "## By Day",
    "",
    "| day | rows | proof recorded | proof missing |",
    "| --- | ---: | ---: | ---: |",
    ...audit.dayRows.map((row) => `| ${row.day} | ${row.rows} | ${row.proofRecordedRows} | ${row.proofMissingRows} |`),
    "",
  ].join("\n");
}

const allRows = [];
for (let day = 1; day <= 7; day += 1) {
  const fileName = `day-${String(day).padStart(2, "0")}-metricool-proof-template.csv`;
  const filePath = path.join(proofRoot, fileName);
  try {
    const rows = parseCsv(await readFile(filePath, "utf8"));
    allRows.push(...rows.map(auditRow));
  } catch {
    // Missing proof template days are handled by the totals below.
  }
}

const dayRows = [];
for (let day = 1; day <= 7; day += 1) {
  const rows = allRows.filter((row) => String(row.day) === String(day));
  dayRows.push({
    day,
    rows: rows.length,
    proofRecordedRows: rows.filter((row) => row.proof_status === "proof_recorded").length,
    proofMissingRows: rows.filter((row) => row.proof_status !== "proof_recorded").length,
  });
}

const audit = {
  status: allRows.length && allRows.every((row) => row.proof_status === "proof_recorded")
    ? "metricool_proof_complete"
    : "metricool_proof_missing",
  generatedAt: new Date().toISOString(),
  totalRows: allRows.length,
  proofRecordedRows: allRows.filter((row) => row.proof_status === "proof_recorded").length,
  proofMissingRows: allRows.filter((row) => row.proof_status !== "proof_recorded").length,
  dayRows,
  rows: allRows,
};

await mkdir(reportsRoot, { recursive: true });
await writeFile(outputJsonPath, `${JSON.stringify(audit, null, 2)}\n`);
await writeFile(outputCsvPath, renderCsv(allRows));
await writeFile(outputMarkdownPath, renderMarkdown(audit));

console.log(JSON.stringify({
  status: audit.status,
  totalRows: audit.totalRows,
  proofRecordedRows: audit.proofRecordedRows,
  proofMissingRows: audit.proofMissingRows,
  reports: [
    path.relative(repoRoot, outputMarkdownPath),
    path.relative(repoRoot, outputCsvPath),
    path.relative(repoRoot, outputJsonPath),
  ],
}, null, 2));
