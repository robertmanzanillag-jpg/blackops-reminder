import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const rootDir = path.join(process.cwd(), "clippers_workspace");
const reportsDir = path.join(rootDir, "reports");
const trackerPath = path.join(reportsDir, "clippers-tiktok-batch-tracker.json");
const runbookPath = path.join(reportsDir, "clippers-tiktok-batch-runbook.json");
const outJsonPath = path.join(reportsDir, "clippers-tiktok-evidence-checklist.json");
const outHtmlPath = path.join(reportsDir, "clippers-tiktok-evidence-checklist.html");
const outMarkdownPath = path.join(reportsDir, "clippers-tiktok-evidence-checklist.md");
const outCsvPath = path.join(reportsDir, "clippers-tiktok-evidence-checklist.csv");
const evidenceCsvColumns = [
  "metricool_queue_item_id",
  "account_id",
  "account_name",
  "platform",
  "metricool_brand_name",
  "metricool_blog_id",
  "scheduled_for",
  "source_path",
  "caption_seed",
  "metricool_approval_url",
  "published_post_url",
  "final_status",
  "views_24h",
  "likes_24h",
  "comments_24h",
  "shares_24h",
  "operator_notes",
];

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}

function csvCell(value) {
  return `"${String(value ?? "").replace(/"/g, '""')}"`;
}

function htmlEscape(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function missingFieldsForRow(row) {
  if (row.state === "not_started") return ["metricool_approval_url", "final_status"];
  if (row.state === "scheduled") return ["published_post_url", "views_24h_or_engagement_24h"];
  if (row.state === "waiting_metrics") return ["views_24h_or_engagement_24h"];
  if (row.state === "needs_fix") return [row.blocker || "invalid_evidence"];
  if (row.state === "rejected") return ["replacement_or_reapproval"];
  return [];
}

function nextActionForRow(row) {
  if (row.state === "not_started") return "Process this row in Metricool, then record approval URL and final_status scheduled.";
  if (row.state === "scheduled") return "Wait until TikTok is public, then record exact public video URL and 24h metrics.";
  if (row.state === "waiting_metrics") return "Add nonzero 24h views, likes, comments, or shares.";
  if (row.state === "ready_to_import") return "Ready for import preview; do not count as published until import is applied.";
  if (row.state === "needs_fix") return row.nextAction || "Fix invalid evidence before syncing.";
  if (row.state === "rejected") return "Replace this row or schedule a corrected clip in Metricool.";
  return row.nextAction || "Review row evidence.";
}

function evidenceTemplate(row) {
  if (row.state === "not_started") {
    return [
      `metricool_queue_item_id=${row.metricoolQueueItemId}`,
      "final_status=<scheduled only after real Metricool scheduling proof>",
      "metricool_approval_url=<paste real Metricool planner URL after scheduling>",
      "operator_notes=<write real 20+ char operator note after scheduling>",
      "published_post_url=",
      "views_24h=",
      "likes_24h=",
      "comments_24h=",
      "shares_24h=",
    ].join("\n");
  }
  if (row.state === "scheduled" || row.state === "waiting_metrics") {
    return [
      `metricool_queue_item_id=${row.metricoolQueueItemId}`,
      "final_status=published",
      "metricool_approval_url=<keep existing Metricool approval URL>",
      "published_post_url=<paste exact public TikTok video URL after live>",
      "views_24h=<nonzero number after 24h>",
      "likes_24h=<optional number>",
      "comments_24h=<optional number>",
      "shares_24h=<optional number>",
      "operator_notes=<write real 20+ char note after public URL and metrics are captured>",
    ].join("\n");
  }
  if (row.state === "rejected") {
    return [
      `metricool_queue_item_id=${row.metricoolQueueItemId}`,
      "final_status=rejected",
      "operator_notes=Rejected in Metricool/operator review with real reason; replace before counting.",
    ].join("\n");
  }
  if (row.state === "ready_to_import") {
    return [
      `metricool_queue_item_id=${row.metricoolQueueItemId}`,
      "final_status=published",
      "metricool_approval_url=<existing Metricool approval URL>",
      "published_post_url=<existing exact public TikTok video URL>",
      "views_24h=<existing nonzero 24h metrics>",
      "operator_notes=Already has public TikTok URL and metrics; run preview/import review before counting.",
    ].join("\n");
  }
  return [
    `metricool_queue_item_id=${row.metricoolQueueItemId}`,
    `final_status=${row.finalStatus || row.state || "<status>"}`,
    "metricool_approval_url=<if applicable>",
    "published_post_url=<paste exact public TikTok video URL only after live>",
    "views_24h=<nonzero number after 24h>",
    "likes_24h=<optional number>",
    "comments_24h=<optional number>",
    "shares_24h=<optional number>",
    "operator_notes=Real operator note, 20+ chars, no placeholders.",
  ].join("\n");
}

function scheduledCsvTemplate(row) {
  const record = {
    metricool_queue_item_id: row.metricoolQueueItemId,
    account_id: row.accountId,
    account_name: row.accountName,
    platform: "tiktok",
    metricool_brand_name: row.metricoolBrandName,
    metricool_blog_id: row.metricoolBlogId || "",
    scheduled_for: row.scheduledFor,
    source_path: row.sourcePath || "",
    caption_seed: row.captionSeed || "",
    metricool_approval_url: "<paste real Metricool planner URL after scheduling>",
    published_post_url: "",
    final_status: "scheduled",
    views_24h: "",
    likes_24h: "",
    comments_24h: "",
    shares_24h: "",
    operator_notes: "<write real 20+ char operator note after scheduling>",
  };
  return evidenceCsvColumns.map((column) => csvCell(record[column] || "")).join(",");
}

function renderMarkdown(summary) {
  return [
    "# TikTok Metricool Evidence Checklist",
    "",
    "Read-only checklist for the active TikTok Metricool batch. This file does not sync evidence and does not count rows as published.",
    "",
    `Status: ${summary.status}`,
    `Generated: ${summary.generatedAt}`,
    `Batch: ${summary.batch.id}`,
    "",
    "## Totals",
    "",
    `- Rows: ${summary.totals.rows}`,
    `- Scheduled proof missing: ${summary.totals.missingApproval}`,
    `- Missing public URL: ${summary.totals.missingPublicUrl}`,
    `- Missing metrics: ${summary.totals.missingMetrics}`,
    `- Ready for import preview: ${summary.totals.readyForImportPreview}`,
    `- Invalid evidence: ${summary.totals.invalidEvidence}`,
    "",
    "## Next Step",
    "",
    summary.nextStep,
    "",
    "## Rows",
    "",
    ...summary.rows.map((row) => [
      `### #${row.rank} ${row.metricoolQueueItemId}`,
      `- Account: ${row.accountName || row.accountId}`,
      `- State: ${row.state}`,
      `- Missing: ${row.missingFields.join(", ") || "none"}`,
      `- Next: ${row.nextAction}`,
      "- Scheduled CSV row template:",
      "```csv",
      row.scheduledCsvTemplate,
      "```",
      "```text",
      row.evidenceTemplate,
      "```",
      "",
    ].join("\n")),
    "## Guardrails",
    "",
    ...summary.guardrails.map((guardrail) => `- ${guardrail}`),
    "",
  ].join("\n");
}

function renderCsv(summary) {
  const header = ["rank", "metricool_queue_item_id", "account_id", "account_name", "state", "missing_fields", "blocker", "next_action", "scheduled_csv_template", "evidence_template"];
  return [
    header.map(csvCell).join(","),
    ...summary.rows.map((row) => [
      row.rank,
      row.metricoolQueueItemId,
      row.accountId,
      row.accountName,
      row.state,
      row.missingFields.join("|"),
      row.blocker,
      row.nextAction,
      row.scheduledCsvTemplate,
      row.evidenceTemplate,
    ].map(csvCell).join(",")),
  ].join("\n") + "\n";
}

function renderHtml(summary) {
  const columns = evidenceCsvColumns;
  const rowsJson = JSON.stringify(summary.rows.map((row) => ({
    metricool_queue_item_id: row.metricoolQueueItemId,
    account_id: row.accountId,
    account_name: row.accountName,
    platform: "tiktok",
    metricool_brand_name: row.metricoolBrandName,
    metricool_blog_id: row.metricoolBlogId || "",
    scheduled_for: row.scheduledFor,
    source_path: row.sourcePath || "",
    caption_seed: row.captionSeed || "",
    metricool_approval_url: row.metricoolApprovalUrl || "",
    published_post_url: row.publishedPostUrl || "",
    final_status: row.finalStatus || "",
    views_24h: row.views24h || "",
    likes_24h: row.likes24h || "",
    comments_24h: row.comments24h || "",
    shares_24h: row.shares24h || "",
    operator_notes: row.operatorNotes || "",
  }))).replace(/</g, "\\u003c");
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>TikTok Metricool Evidence Console - ${htmlEscape(summary.batch.id)}</title>
  <style>
    :root { color-scheme: dark; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: #05070a; color: #f8fafc; }
    body { margin: 0; padding: 24px; }
    header, main { max-width: 1180px; margin: 0 auto; }
    h1 { margin: 0 0 8px; font-size: 26px; letter-spacing: 0; }
    .meta, .guardrails { color: #a1a1aa; line-height: 1.55; }
    .stats { display: flex; flex-wrap: wrap; gap: 8px; margin: 16px 0; }
    .stat { border: 1px solid #1f2937; border-radius: 8px; padding: 10px 12px; background: #090d13; min-width: 138px; }
    .stat b { display: block; color: #7dd3fc; font-size: 20px; }
    .toolbar { display: flex; flex-wrap: wrap; gap: 8px; margin: 18px 0; }
    button { border: 1px solid #0369a1; border-radius: 6px; background: #0c4a6e; color: #f0f9ff; padding: 9px 12px; cursor: pointer; }
    button.secondary { border-color: #334155; background: #0f172a; }
    .row { border: 1px solid #164e63; border-radius: 8px; padding: 12px; background: #080b10; margin-bottom: 12px; }
    .row__head { display: flex; flex-wrap: wrap; gap: 10px; justify-content: space-between; margin-bottom: 8px; }
    .row__head strong { color: #f8fafc; }
    .row__head span { color: #bae6fd; }
    .grid { display: grid; grid-template-columns: repeat(3, minmax(180px, 1fr)); gap: 10px; }
    label { display: grid; gap: 5px; color: #d4d4d8; font-size: 12px; }
    input, select, textarea { box-sizing: border-box; width: 100%; border: 1px solid #1f2937; border-radius: 6px; padding: 8px; background: #020617; color: #f8fafc; font: inherit; }
    textarea { min-height: 68px; resize: vertical; }
    code { color: #a5f3fc; overflow-wrap: anywhere; }
    .template { white-space: pre-wrap; color: #cbd5e1; background: #020617; border: 1px solid #1f2937; border-radius: 6px; padding: 8px; margin-top: 10px; }
    .warn { color: #fde68a; }
    @media (max-width: 820px) { body { padding: 14px; } .grid { grid-template-columns: 1fr; } }
  </style>
</head>
<body>
  <header>
    <h1>TikTok Metricool Evidence Console</h1>
    <div class="meta">
      <div>Status: <b>${htmlEscape(summary.status)}</b></div>
      <div>Batch: <b>${htmlEscape(summary.batch.id)}</b></div>
      <div>This page prepares a CSV only. It does not sync evidence, publish, schedule, or count views.</div>
    </div>
    <div class="stats">
      <div class="stat">Rows <b>${htmlEscape(summary.totals.rows)}</b></div>
      <div class="stat">Scheduled proof missing <b>${htmlEscape(summary.totals.missingApproval)}</b></div>
      <div class="stat">Ready for import preview <b>${htmlEscape(summary.totals.readyForImportPreview)}</b></div>
      <div class="stat">Invalid evidence <b>${htmlEscape(summary.totals.invalidEvidence)}</b></div>
    </div>
    <div class="guardrails">${summary.guardrails.map((guardrail) => `<div>${htmlEscape(guardrail)}</div>`).join("")}</div>
    <div class="toolbar">
      <button type="button" id="downloadCsv">Download evidence CSV draft</button>
      <button type="button" id="copyCsv" class="secondary">Copy CSV draft</button>
    </div>
    <p class="warn">Use scheduled only after real Metricool scheduling proof exists. Use published only after exact public TikTok URL and real 24h metrics exist.</p>
  </header>
  <main>
    ${summary.rows.map((row, index) => `
      <article class="row" data-index="${index}">
        <div class="row__head">
          <strong>#${htmlEscape(row.rank)} ${htmlEscape(row.metricoolBrandName || row.accountName || row.accountId)}</strong>
          <span>${htmlEscape(row.state)} · ${htmlEscape(row.metricoolQueueItemId)}</span>
        </div>
        <p><b>Schedule:</b> ${htmlEscape(row.scheduledFor)} · <b>Source:</b> <code>${htmlEscape(row.sourceFileName)}</code></p>
        <div class="grid">
          <label>Metricool approval URL<input data-field="metricool_approval_url" value="${htmlEscape(row.metricoolApprovalUrl || "")}" placeholder="Paste real Metricool planner URL after scheduling"></label>
          <label>Final status<select data-field="final_status"><option value=""></option><option value="scheduled" ${row.finalStatus === "scheduled" ? "selected" : ""}>scheduled</option><option value="published" ${row.finalStatus === "published" ? "selected" : ""}>published</option><option value="rejected" ${row.finalStatus === "rejected" ? "selected" : ""}>rejected</option></select></label>
          <label>Published TikTok URL<input data-field="published_post_url" value="${htmlEscape(row.publishedPostUrl || "")}" placeholder="https://www.tiktok.com/@handle/video/..."></label>
          <label>Views 24h<input data-field="views_24h" value="${htmlEscape(row.views24h || "")}" inputmode="numeric"></label>
          <label>Likes 24h<input data-field="likes_24h" value="${htmlEscape(row.likes24h || "")}" inputmode="numeric"></label>
          <label>Comments 24h<input data-field="comments_24h" value="${htmlEscape(row.comments24h || "")}" inputmode="numeric"></label>
          <label>Shares 24h<input data-field="shares_24h" value="${htmlEscape(row.shares24h || "")}" inputmode="numeric"></label>
          <label>Operator notes<textarea data-field="operator_notes" placeholder="Write a real 20+ character operator note after scheduling">${htmlEscape(row.operatorNotes || "")}</textarea></label>
        </div>
        <div class="toolbar">
          <button type="button" class="secondary" data-copy-scheduled="${index}">Copy scheduled CSV row template</button>
        </div>
        <div class="template">${htmlEscape(row.scheduledCsvTemplate)}</div>
        <div class="template">${htmlEscape(row.evidenceTemplate)}</div>
      </article>
    `).join("")}
  </main>
  <script>
    const columns = ${JSON.stringify(columns)};
    const rows = ${rowsJson};
    function csvCell(value) {
      return '"' + String(value ?? '').replace(/"/g, '""') + '"';
    }
    function collectRows() {
      document.querySelectorAll('.row').forEach((node) => {
        const index = Number(node.getAttribute('data-index'));
        node.querySelectorAll('[data-field]').forEach((input) => {
          rows[index][input.getAttribute('data-field')] = input.value;
        });
      });
      return [columns.map(csvCell).join(','), ...rows.map((row) => columns.map((column) => csvCell(row[column] || '')).join(','))].join('\\n') + '\\n';
    }
    document.getElementById('downloadCsv').addEventListener('click', () => {
      const blob = new Blob([collectRows()], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = '${htmlEscape(summary.batch.id)}-evidence-draft.csv';
      link.click();
      URL.revokeObjectURL(url);
    });
    document.getElementById('copyCsv').addEventListener('click', async () => {
      await navigator.clipboard.writeText(collectRows());
      document.getElementById('copyCsv').textContent = 'Copied CSV draft';
    });
    document.querySelectorAll('[data-copy-scheduled]').forEach((button) => {
      button.addEventListener('click', async () => {
        const row = rows[Number(button.getAttribute('data-copy-scheduled'))];
        const scheduledRow = {
          ...row,
          metricool_approval_url: '<paste real Metricool planner URL after scheduling>',
          published_post_url: '',
          final_status: 'scheduled',
          views_24h: '',
          likes_24h: '',
          comments_24h: '',
          shares_24h: '',
          operator_notes: '<write real 20+ char operator note after scheduling>',
        };
        await navigator.clipboard.writeText(columns.map((column) => csvCell(scheduledRow[column] || '')).join(','));
        button.textContent = 'Copied scheduled row template';
      });
    });
  </script>
</body>
</html>`;
}

async function main() {
  await mkdir(reportsDir, { recursive: true });
  const [tracker, runbook] = await Promise.all([
    readJson(trackerPath),
    readJson(runbookPath),
  ]);
  const runbookById = new Map((runbook.rows || []).map((row) => [row.metricoolQueueItemId, row]));
  const rows = (tracker.rows || []).map((row) => {
    const runbookRow = runbookById.get(row.metricoolQueueItemId) || {};
    const missingFields = missingFieldsForRow(row);
    return {
      rank: row.rank,
      metricoolQueueItemId: row.metricoolQueueItemId,
      accountId: row.accountId,
      accountName: row.accountName,
      metricoolBrandName: row.metricoolBrandName,
      metricoolBlogId: row.metricoolBlogId || runbookRow.metricoolBlogId || "",
      sourceFileName: row.sourceFileName || runbookRow.sourceFileName || "",
      sourcePath: row.sourcePath || runbookRow.sourcePath || "",
      captionSeed: row.captionSeed || runbookRow.captionSeed || "",
      scheduledFor: row.scheduledFor,
      state: row.state,
      blocker: row.blocker || "",
      metricoolApprovalUrl: row.metricoolApprovalUrl || "",
      publishedPostUrl: row.publishedPostUrl || "",
      finalStatus: row.finalStatus || "",
      views24h: row.views24h || 0,
      likes24h: row.likes24h || 0,
      comments24h: row.comments24h || 0,
      shares24h: row.shares24h || 0,
      operatorNotes: row.operatorNotes || "",
      missingFields,
      nextAction: nextActionForRow(row),
      evidenceTemplate: evidenceTemplate(row),
      scheduledCsvTemplate: scheduledCsvTemplate({
        ...row,
        metricoolBlogId: row.metricoolBlogId || runbookRow.metricoolBlogId || "",
        sourcePath: row.sourcePath || runbookRow.sourcePath || "",
        captionSeed: row.captionSeed || runbookRow.captionSeed || "",
      }),
    };
  });
  const totals = rows.reduce((sum, row) => {
    sum.rows += 1;
    if (row.missingFields.includes("metricool_approval_url") || row.missingFields.includes("final_status")) sum.missingApproval += 1;
    if (row.missingFields.includes("published_post_url")) sum.missingPublicUrl += 1;
    if (row.missingFields.includes("views_24h_or_engagement_24h")) sum.missingMetrics += 1;
    if (row.state === "ready_to_import") sum.readyForImportPreview += 1;
    if (row.state === "needs_fix" || row.state === "rejected") sum.invalidEvidence += 1;
    return sum;
  }, { rows: 0, missingApproval: 0, missingPublicUrl: 0, missingMetrics: 0, readyForImportPreview: 0, invalidEvidence: 0 });
  const status = totals.invalidEvidence > 0
    ? "needs_evidence_fix"
    : totals.readyForImportPreview === totals.rows && totals.rows > 0
      ? "ready_for_import_preview"
    : totals.missingPublicUrl > 0 || totals.missingMetrics > 0
      ? "waiting_live_evidence"
      : "ready_for_metricool_operator";
  const summary = {
    status,
    generatedAt: new Date().toISOString(),
    paths: {
      json: outJsonPath,
      html: outHtmlPath,
      markdown: outMarkdownPath,
      csv: outCsvPath,
      tracker: trackerPath,
      runbook: runbookPath,
    },
    batch: tracker.batch || runbook.batch || { id: "metricool-batch-01", rows: rows.length, accounts: [], platforms: ["tiktok"] },
    totals,
    rows,
    guardrails: [
      "This checklist is read-only and never syncs evidence into the master CSV.",
      "Only exact public TikTok video URLs count; profile, search, planner, or Metricool URLs do not count.",
      "For scheduled rows, record only Metricool approval URL, final_status, and real operator notes; leave public URL and metrics blank until live.",
      "Scheduled rows are not published rows.",
      "Import preview requires public TikTok URL plus nonzero 24h metrics.",
      "Do not paste passwords, cookies, recovery codes, private URLs, or screenshots with secrets.",
    ],
    nextStep: rows.find((row) => row.state !== "ready_to_import")?.nextAction || "Run evidence preview/import review before counting metrics.",
  };
  await writeFile(outJsonPath, JSON.stringify(summary, null, 2));
  await writeFile(outHtmlPath, renderHtml(summary));
  await writeFile(outMarkdownPath, renderMarkdown(summary));
  await writeFile(outCsvPath, renderCsv(summary));
  console.log(JSON.stringify({
    status: summary.status,
    rows: summary.totals.rows,
    missingApproval: summary.totals.missingApproval,
    missingPublicUrl: summary.totals.missingPublicUrl,
    missingMetrics: summary.totals.missingMetrics,
    readyForImportPreview: summary.totals.readyForImportPreview,
    invalidEvidence: summary.totals.invalidEvidence,
    markdownPath: outMarkdownPath,
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
