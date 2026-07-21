import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const repoRoot = process.cwd();
const workspaceRoot = path.join(repoRoot, "clippers_workspace");
const reportsRoot = path.join(workspaceRoot, "reports");
const metricsRoot = path.join(reportsRoot, "metricool-owned-tiktok-metrics-templates");
const outputCsvPath = path.join(reportsRoot, "metricool-owned-tiktok-metrics-audit.csv");
const outputMarkdownPath = path.join(reportsRoot, "metricool-owned-tiktok-metrics-audit.md");
const outputJsonPath = path.join(reportsRoot, "metricool-owned-tiktok-metrics-audit.json");

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

function nonEmpty(value) {
  return String(value ?? "").trim();
}

function hasPublishedProof(row) {
  const postUrl = nonEmpty(row.published_post_url);
  if (!postUrl) return false;
  try {
    const parsed = new URL(postUrl);
    return parsed.protocol === "https:" && (
      parsed.hostname === "www.tiktok.com"
      || parsed.hostname === "tiktok.com"
      || parsed.hostname.endsWith(".tiktok.com")
    ) && parsed.pathname.includes("/video/");
  } catch {
    return false;
  }
}

function parseMetric(value) {
  const text = nonEmpty(value).replaceAll(",", "");
  if (!text) return null;
  const number = Number(text);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

function auditRow(row) {
  const publishedProof = hasPublishedProof(row);
  const views24h = parseMetric(row.views_24h);
  const views7d = parseMetric(row.views_7d);
  const hasViewsMetric = views24h !== null || views7d !== null;
  const hasCompleteViews = views24h !== null && views7d !== null;
  const metricsStatus = nonEmpty(row.metrics_status) || "needs_metrics_after_publish";
  let auditStatus = "metrics_missing";
  if (publishedProof && hasCompleteViews) auditStatus = "metrics_recorded";
  else if (publishedProof && hasViewsMetric) auditStatus = "metrics_partial";
  else if (publishedProof) auditStatus = "published_proof_without_metrics";

  return {
    day: row.day,
    planned_date: row.planned_date,
    planned_time: row.planned_time,
    metricool_account: row.metricool_account,
    category: row.category,
    title: row.title,
    metrics_audit_status: auditStatus,
    metrics_status: metricsStatus,
    published_post_url: row.published_post_url || "",
    metricool_post_id: row.metricool_post_id || "",
    views_24h: auditStatus === "metrics_recorded" ? views24h ?? "" : "",
    views_7d: auditStatus === "metrics_recorded" ? views7d ?? "" : "",
    metric_source: row.metric_source || "",
    next_action: auditStatus === "metrics_recorded"
      ? "Use this row for weekly account/category reporting."
      : auditStatus === "metrics_partial"
      ? "Add the missing 24h or 7d views before using this row for weekly reporting."
      : auditStatus === "published_proof_without_metrics"
      ? "Add Metricool or TikTok performance numbers for 24h and 7d."
      : "After the post is live, add the TikTok post URL or Metricool post id plus performance metrics.",
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
    "metrics_audit_status",
    "metrics_status",
    "published_post_url",
    "metricool_post_id",
    "views_24h",
    "views_7d",
    "metric_source",
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
    "# Metricool Owned TikTok Metrics Audit",
    "",
    `Generated: ${audit.generatedAt}`,
    `Status: ${audit.status}`,
    "",
    "## Totals",
    "",
    `- Total rows: ${audit.totalRows}`,
    `- Metrics recorded: ${audit.metricsRecordedRows}`,
    `- Metrics partial: ${audit.metricsPartialRows}`,
    `- Published proof without metrics: ${audit.publishedProofWithoutMetricsRows}`,
    `- Metrics missing: ${audit.metricsMissingRows}`,
    `- Missing template days: ${audit.missingTemplateDays.length ? audit.missingTemplateDays.join(", ") : "none"}`,
    `- Views 24h recorded: ${audit.views24hRecorded}`,
    `- Views 7d recorded: ${audit.views7dRecorded}`,
    "",
    "## Guardrail",
    "",
    "Metrics recorded means the row has a real TikTok /video/ URL plus both 24h and 7d views. Partial rows, Metricool ids, planned rows, uploaded rows, draft rows, and blank templates do not count as final views.",
    "",
    "## By Day",
    "",
    "| day | rows | metrics recorded | partial | proof no metrics | metrics missing |",
    "| --- | ---: | ---: | ---: | ---: | ---: |",
    ...audit.dayRows.map((row) => `| ${row.day} | ${row.rows} | ${row.metricsRecordedRows} | ${row.metricsPartialRows} | ${row.publishedProofWithoutMetricsRows} | ${row.metricsMissingRows} |`),
    "",
  ].join("\n");
}

const allRows = [];
const missingTemplateDays = [];
for (let day = 1; day <= 7; day += 1) {
  const fileName = `day-${String(day).padStart(2, "0")}-metrics-template.csv`;
  const filePath = path.join(metricsRoot, fileName);
  try {
    const rows = parseCsv(await readFile(filePath, "utf8"));
    allRows.push(...rows.map(auditRow));
  } catch {
    missingTemplateDays.push(day);
  }
}

const dayRows = [];
for (let day = 1; day <= 7; day += 1) {
  const rows = allRows.filter((row) => String(row.day) === String(day));
  dayRows.push({
    day,
    rows: rows.length,
    metricsRecordedRows: rows.filter((row) => row.metrics_audit_status === "metrics_recorded").length,
    metricsPartialRows: rows.filter((row) => row.metrics_audit_status === "metrics_partial").length,
    publishedProofWithoutMetricsRows: rows.filter((row) => row.metrics_audit_status === "published_proof_without_metrics").length,
    metricsMissingRows: rows.filter((row) => row.metrics_audit_status === "metrics_missing").length,
  });
}

const audit = {
  status: missingTemplateDays.length
    ? "metricool_metrics_templates_missing"
    : allRows.length && allRows.every((row) => row.metrics_audit_status === "metrics_recorded")
    ? "metricool_metrics_complete"
    : "metricool_metrics_missing",
  generatedAt: new Date().toISOString(),
  totalRows: allRows.length,
  metricsRecordedRows: allRows.filter((row) => row.metrics_audit_status === "metrics_recorded").length,
  metricsPartialRows: allRows.filter((row) => row.metrics_audit_status === "metrics_partial").length,
  publishedProofWithoutMetricsRows: allRows.filter((row) => row.metrics_audit_status === "published_proof_without_metrics").length,
  metricsMissingRows: allRows.filter((row) => row.metrics_audit_status === "metrics_missing").length,
  missingTemplateDays,
  views24hRecorded: allRows
    .filter((row) => row.metrics_audit_status === "metrics_recorded")
    .reduce((sum, row) => sum + (Number(row.views_24h) || 0), 0),
  views7dRecorded: allRows
    .filter((row) => row.metrics_audit_status === "metrics_recorded")
    .reduce((sum, row) => sum + (Number(row.views_7d) || 0), 0),
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
  metricsRecordedRows: audit.metricsRecordedRows,
  metricsMissingRows: audit.metricsMissingRows,
  reports: [
    path.relative(repoRoot, outputMarkdownPath),
    path.relative(repoRoot, outputCsvPath),
    path.relative(repoRoot, outputJsonPath),
  ],
}, null, 2));
