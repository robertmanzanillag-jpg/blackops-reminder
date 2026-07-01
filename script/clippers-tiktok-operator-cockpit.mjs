import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const rootDir = path.join(process.cwd(), "clippers_workspace");
const reportsDir = path.join(rootDir, "reports");
const scheduledDir = path.join(rootDir, "scheduled");
const outJsonPath = path.join(reportsDir, "clippers-tiktok-operator-cockpit.json");
const outHtmlPath = path.join(reportsDir, "clippers-tiktok-operator-cockpit.html");
const outMarkdownPath = path.join(reportsDir, "clippers-tiktok-operator-cockpit.md");
const outCsvPath = path.join(reportsDir, "clippers-tiktok-operator-cockpit.csv");

const artifactPaths = {
  workbook: path.join(scheduledDir, "metricool-100-current-batch-workbook.json"),
  uploadPack: path.join(reportsDir, "clippers-metricool-current-batch-upload-pack.json"),
  evidenceChecklist: path.join(reportsDir, "clippers-tiktok-evidence-checklist.json"),
  tracker: path.join(reportsDir, "clippers-tiktok-batch-tracker.json"),
  verifier: path.join(reportsDir, "clippers-tiktok-mvp-readiness-verifier.json"),
  preflight: path.join(reportsDir, "clippers-metricool-mcp-preflight.json"),
};

async function readJson(filePath, fallback = {}) {
  const raw = await readFile(filePath, "utf8").catch(() => null);
  if (!raw) return fallback;
  return JSON.parse(raw);
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

function cockpitStatus({ uploadPack, evidenceChecklist, tracker, verifier, preflight }) {
  if (verifier.status !== "pass") return "blocked_verifier";
  if (preflight.status !== "ready_for_operator") return "blocked_metricool_preflight";
  if (uploadPack.status !== "ready_for_metricool_upload") return "blocked_upload_pack";
  if (evidenceChecklist.status === "needs_evidence_fix" || tracker.status === "needs_evidence_fix") return "needs_evidence_fix";
  if (tracker.totals?.readyToImport > 0) return "ready_for_import_review";
  if ((tracker.totals?.scheduled || 0) > 0 || (tracker.totals?.waitingMetrics || 0) > 0) return "waiting_live_evidence";
  return "ready_for_metricool_operator";
}

function nextStepFor(status, paths) {
  if (status === "blocked_verifier") return "Run TikTok MVP verifier before opening Metricool.";
  if (status === "blocked_metricool_preflight") return "Fix Metricool preflight before staging uploads.";
  if (status === "blocked_upload_pack") return "Refresh/fix the upload pack before opening Metricool.";
  if (status === "needs_evidence_fix") return "Fix invalid current-batch evidence before syncing or importing.";
  if (status === "ready_for_import_review") return "Preview/import evidence only after confirming public TikTok URLs and real 24h metrics.";
  if (status === "waiting_live_evidence") return `Use ${paths.evidenceHtml || "the evidence console"} to capture public URLs and 24h metrics when real.`;
  return `Open ${paths.uploadHtml || paths.uploadDir || "the upload pack"}, process the 10 files in Metricool, then capture evidence in ${paths.evidenceHtml || "the evidence console"}.`;
}

function renderMarkdown(summary) {
  return [
    "# TikTok Metricool Operator Cockpit",
    "",
    `Status: ${summary.status}`,
    `Generated: ${summary.generatedAt}`,
    `Batch: ${summary.batchId}`,
    "",
    "This cockpit links the active TikTok Metricool batch artifacts. It does not publish, schedule, sync evidence, or count views.",
    "",
    "## Totals",
    "",
    `- Upload rows: ${summary.totals.uploadRows}`,
    `- Copied MP4s: ${summary.totals.copiedFiles}`,
    `- Tracker rows: ${summary.totals.trackerRows}`,
    `- Not started: ${summary.totals.notStarted}`,
    `- Scheduled: ${summary.totals.scheduled}`,
    `- Waiting metrics: ${summary.totals.waitingMetrics}`,
    `- Ready to import review: ${summary.totals.readyToImport}`,
    `- Invalid evidence: ${summary.totals.invalidEvidence}`,
    "",
    "## Start Here",
    "",
    ...summary.operatorChecklist.map((step) => [
      `### ${step.order}. ${step.label}`,
      step.detail,
      `Proof: ${step.proof}`,
      "",
    ].join("\n")),
    "## Links",
    "",
    ...summary.links.map((link) => `- ${link.label}: ${link.path}`),
    "",
    "## Next Step",
    "",
    summary.nextStep,
    "",
    "## Current Batch Rows",
    "",
    ...summary.operatorRows.map((row) => [
      `### ${row.rank}. ${row.metricoolBrandName} / ${row.accountId}`,
      `- Queue item: ${row.metricoolQueueItemId}`,
      `- Upload file: ${row.uploadFilePath || row.sourcePath}`,
      `- Schedule: ${row.publishAt}`,
      `- Caption: ${row.captionSeed}`,
      `- Scheduled evidence template: ${row.scheduledEvidenceTemplate}`,
      `- Status: ${row.status}${row.blocker ? ` (${row.blocker})` : ""}`,
      "",
    ].join("\n")),
    "## Guardrails",
    "",
    ...summary.guardrails.map((guardrail) => `- ${guardrail}`),
    "",
  ].join("\n");
}

function renderCsv(summary) {
  const header = ["kind", "id", "label", "status", "path", "next_action", "metricool_queue_item_id", "caption_seed", "scheduled_evidence_template"];
  return [
    header.map(csvCell).join(","),
    ...summary.links.map((link) => [
      "link",
      link.id,
      link.label,
      link.status,
      link.path,
      link.nextAction,
      "",
      "",
      "",
    ].map(csvCell).join(",")),
    ...summary.operatorRows.map((row) => [
      "operator_row",
      row.metricoolQueueItemId,
      `${row.rank}. ${row.metricoolBrandName} / ${row.accountId}`,
      row.status,
      row.uploadFilePath || row.sourcePath,
      row.nextAction,
      row.metricoolQueueItemId,
      row.captionSeed,
      row.scheduledEvidenceTemplate,
    ].map(csvCell).join(",")),
  ].join("\n") + "\n";
}

function renderHtml(summary) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>TikTok Metricool Operator Cockpit - ${htmlEscape(summary.batchId)}</title>
  <style>
    :root { color-scheme: dark; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: #05070a; color: #f8fafc; }
    body { margin: 0; padding: 24px; }
    main { max-width: 1120px; margin: 0 auto; }
    h1 { margin: 0 0 8px; font-size: 28px; letter-spacing: 0; }
    .meta, .guardrails { color: #a1a1aa; line-height: 1.55; }
    .status { display: inline-flex; margin: 10px 0 16px; border: 1px solid #0e7490; border-radius: 999px; padding: 6px 10px; background: #083344; color: #ecfeff; font-weight: 700; }
    .stats { display: grid; grid-template-columns: repeat(4, minmax(130px, 1fr)); gap: 8px; margin: 16px 0; }
    .stat, .link { border: 1px solid #1f2937; border-radius: 8px; background: #080b10; padding: 12px; }
    .stat b { display: block; color: #67e8f9; font-size: 22px; }
    .checklist { display: grid; gap: 8px; margin: 16px 0; }
    .step { border: 1px solid #14532d; border-radius: 8px; background: #04110a; padding: 12px; }
    .step h2 { margin: 0 0 6px; font-size: 16px; color: #bbf7d0; }
    .step p { margin: 6px 0; color: #d4d4d8; line-height: 1.45; }
    .links { display: grid; grid-template-columns: repeat(2, minmax(260px, 1fr)); gap: 10px; margin: 16px 0; }
    .rows { display: grid; gap: 10px; margin: 16px 0; }
    .row { border: 1px solid #164e63; border-radius: 8px; background: #070b10; padding: 12px; }
    .row__top { display: flex; justify-content: space-between; gap: 12px; color: #f8fafc; }
    .row textarea { box-sizing: border-box; width: 100%; min-height: 76px; border: 1px solid #1f2937; border-radius: 6px; padding: 10px; background: #020617; color: #f8fafc; font: inherit; line-height: 1.45; }
    .link h2 { margin: 0 0 6px; font-size: 16px; }
    .link p { color: #cbd5e1; line-height: 1.45; }
    code { display: block; color: #a5f3fc; overflow-wrap: anywhere; margin-top: 8px; }
    .next { color: #fde68a; border: 1px solid #92400e; border-radius: 8px; padding: 12px; background: #1c1206; }
    @media (max-width: 820px) { body { padding: 14px; } .stats, .links { grid-template-columns: 1fr; } }
  </style>
</head>
<body>
  <main>
    <h1>TikTok Metricool Operator Cockpit</h1>
    <div class="meta">Batch ${htmlEscape(summary.batchId)}. Local guide only: no publishing, no scheduling, no evidence sync, no view counting.</div>
    <div class="status">${htmlEscape(summary.status)}</div>
    <section class="stats">
      <div class="stat">Upload rows <b>${htmlEscape(summary.totals.uploadRows)}</b></div>
      <div class="stat">Copied MP4s <b>${htmlEscape(summary.totals.copiedFiles)}</b></div>
      <div class="stat">Scheduled <b>${htmlEscape(summary.totals.scheduled)}</b></div>
      <div class="stat">Ready import review <b>${htmlEscape(summary.totals.readyToImport)}</b></div>
    </section>
    <p class="next">${htmlEscape(summary.nextStep)}</p>
    <section class="checklist">
      <h2>Start here / Empieza aqui</h2>
      ${summary.operatorChecklist.map((step) => `
        <article class="step">
          <h2>${htmlEscape(step.order)}. ${htmlEscape(step.label)}</h2>
          <p>${htmlEscape(step.detail)}</p>
          <p><b>Proof:</b> ${htmlEscape(step.proof)}</p>
        </article>
      `).join("")}
    </section>
    <section class="links">
      ${summary.links.map((link) => `
        <article class="link">
          <h2>${htmlEscape(link.label)}</h2>
          <p>${htmlEscape(link.nextAction)}</p>
          <code>${htmlEscape(link.path)}</code>
        </article>
      `).join("")}
    </section>
    <section class="rows">
      <h2>Current batch rows</h2>
      ${summary.operatorRows.map((row) => `
        <article class="row">
          <div class="row__top">
            <strong>${htmlEscape(row.rank)}. ${htmlEscape(row.metricoolBrandName)} / ${htmlEscape(row.accountId)}</strong>
            <span>${htmlEscape(row.status)}</span>
          </div>
          <p><b>Queue item:</b> ${htmlEscape(row.metricoolQueueItemId)}</p>
          <p><b>Upload file:</b> <code>${htmlEscape(row.uploadFilePath || row.sourcePath)}</code></p>
          <p><b>Schedule:</b> ${htmlEscape(row.publishAt)}</p>
          <p><b>Caption:</b></p>
          <textarea readonly>${htmlEscape(row.captionSeed)}</textarea>
          <p><b>Scheduled evidence template:</b> <code>${htmlEscape(row.scheduledEvidenceTemplate)}</code></p>
          <p>${htmlEscape(row.nextAction)}</p>
        </article>
      `).join("")}
    </section>
    <section class="guardrails">
      ${summary.guardrails.map((guardrail) => `<div>${htmlEscape(guardrail)}</div>`).join("")}
    </section>
  </main>
</body>
</html>`;
}

async function main() {
  await mkdir(reportsDir, { recursive: true });
  const [workbook, uploadPack, evidenceChecklist, tracker, verifier, preflight] = await Promise.all([
    readJson(artifactPaths.workbook),
    readJson(artifactPaths.uploadPack),
    readJson(artifactPaths.evidenceChecklist),
    readJson(artifactPaths.tracker),
    readJson(artifactPaths.verifier),
    readJson(artifactPaths.preflight),
  ]);
  const batchId = workbook.batchId || uploadPack.batchId || tracker.batch?.id || verifier.active?.currentBatchId || "metricool-batch-01";
  const paths = {
    uploadHtml: uploadPack.paths?.html || "",
    uploadDir: uploadPack.paths?.uploadDir || "",
    evidenceHtml: evidenceChecklist.paths?.html || "",
    evidenceCsv: workbook.paths?.batchEvidenceCsv || tracker.paths?.batchEvidenceCsv || "",
    workbookCsv: workbook.paths?.csv || "",
  };
  const status = cockpitStatus({ uploadPack, evidenceChecklist, tracker, verifier, preflight });
  const uploadRowsByQueueId = new Map((uploadPack.rows || []).map((row) => [row.metricoolQueueItemId, row]));
  const trackerRowsByQueueId = new Map((tracker.rows || []).map((row) => [row.metricoolQueueItemId, row]));
  const operatorRows = (workbook.rows || []).map((row) => {
    const uploadRow = uploadRowsByQueueId.get(row.metricoolQueueItemId) || {};
    const trackerRow = trackerRowsByQueueId.get(row.metricoolQueueItemId) || {};
    return {
      rank: Number(row.rank || uploadRow.rank || 0),
      metricoolQueueItemId: row.metricoolQueueItemId,
      accountId: row.accountId,
      accountName: row.accountName,
      platform: row.platform,
      metricoolBrandName: row.metricoolBrandName,
      metricoolBlogId: row.metricoolBlogId,
      publishAt: row.publishAt,
      sourcePath: row.sourcePath,
      uploadFilePath: uploadRow.uploadFilePath || "",
      captionSeed: row.captionSeed,
      status: trackerRow.state || uploadRow.status || row.queueStatus || "unknown",
      blocker: trackerRow.blocker || uploadRow.blocker || "",
      scheduledEvidenceTemplate: [
        `metricool_queue_item_id=${row.metricoolQueueItemId}`,
        "metricool_approval_url=<paste real Metricool scheduled proof URL>",
        "published_post_url=",
        "final_status=scheduled",
        "views_24h=",
        "likes_24h=",
        "comments_24h=",
        "shares_24h=",
        "operator_notes=<write real 20+ character scheduling note>",
      ].join("; "),
      nextAction: "Upload and schedule this exact row in Metricool, then record only real scheduled evidence. Leave public URL and metrics blank until the TikTok post is live and measured.",
    };
  }).sort((a, b) => a.rank - b.rank || a.metricoolQueueItemId.localeCompare(b.metricoolQueueItemId));
  const summary = {
    status,
    generatedAt: new Date().toISOString(),
    batchId,
    mode: "metricool_tiktok_operator_cockpit",
    paths: {
      json: outJsonPath,
      html: outHtmlPath,
      markdown: outMarkdownPath,
      csv: outCsvPath,
      uploadHtml: paths.uploadHtml,
      evidenceHtml: paths.evidenceHtml,
      batchEvidenceCsv: paths.evidenceCsv,
      workbookCsv: paths.workbookCsv,
    },
    totals: {
      uploadRows: uploadPack.totals?.rows || 0,
      copiedFiles: uploadPack.totals?.copied || 0,
      blockedUploadFiles: uploadPack.totals?.blocked || 0,
      trackerRows: tracker.totals?.rows || 0,
      notStarted: tracker.totals?.notStarted || 0,
      scheduled: tracker.totals?.scheduled || 0,
      waitingMetrics: tracker.totals?.waitingMetrics || 0,
      readyToImport: tracker.totals?.readyToImport || 0,
      invalidEvidence: (tracker.totals?.needsFix || 0) + (tracker.totals?.rejected || 0) + (evidenceChecklist.totals?.invalidEvidence || 0),
      publishedCounted: 0,
    },
    links: [
      { id: "upload_console", label: "1. Upload console", status: uploadPack.status || "unknown", path: paths.uploadHtml, nextAction: "Open this local HTML, preview each MP4, copy captions, then upload/schedule inside Metricool." },
      { id: "upload_folder", label: "2. Upload folder", status: uploadPack.status || "unknown", path: paths.uploadDir, nextAction: "Use only these 10 MP4 files for the current batch." },
      { id: "evidence_console", label: "3. Evidence console", status: evidenceChecklist.status || "unknown", path: paths.evidenceHtml, nextAction: "After real Metricool scheduling, prepare the evidence CSV draft here." },
      { id: "batch_evidence_csv", label: "4. Current batch evidence CSV", status: tracker.status || "unknown", path: paths.evidenceCsv, nextAction: "Fill/sync only real evidence; do not edit the master CSV directly." },
      { id: "workbook_csv", label: "5. Batch workbook CSV", status: workbook.status || "unknown", path: paths.workbookCsv, nextAction: "Use as the row order checklist for Metricool." },
    ],
    operatorRows,
    operatorChecklist: [
      {
        order: 1,
        label: "Open the upload console / Abre la consola de upload",
        detail: "Use the upload console for this current batch only. It previews the 10 MP4 files, captions, schedule times, and the safe scheduled-evidence helper.",
        proof: "No proof is recorded at this step; copied files are not scheduled or published evidence.",
      },
      {
        order: 2,
        label: "Schedule in Metricool / Programa en Metricool",
        detail: "Inside Metricool, select the matching TikTok brand, upload the exact MP4 in rank order, paste the caption, and schedule the listed time.",
        proof: "A real Metricool scheduled/planner URL plus a concrete operator note of 20+ characters.",
      },
      {
        order: 3,
        label: "Record scheduled evidence / Registra evidencia scheduled",
        detail: "After scheduling each row in Metricool, copy the scheduled CSV row from the upload console or fill the current batch evidence CSV.",
        proof: "final_status=scheduled with Metricool proof URL. Leave public TikTok URL and 24h metrics blank.",
      },
      {
        order: 4,
        label: "Wait for real public posts / Espera posts publicos reales",
        detail: "Only after TikTok creates a public video URL should the row move beyond scheduled. Do not use profile, search, placeholder, or example URLs.",
        proof: "Exact public TikTok video URL in the /@handle/video/id format.",
      },
      {
        order: 5,
        label: "Import only real 24h metrics / Importa solo metricas reales",
        detail: "After 24 hours, add real views, likes, comments, and shares before import review. Scheduled rows are not published rows.",
        proof: "final_status=published, exact TikTok URL, and nonzero 24h metrics.",
      },
    ],
    guardrails: [
      "This cockpit is local guidance only and never publishes or schedules content.",
      "Metricool remains approval_required; realPublishEnabled remains false.",
      "Scheduled rows are not published rows.",
      "Public TikTok URLs and 24h metrics must be real before import review.",
      "Do not paste passwords, tokens, cookies, private URLs, or screenshots with secrets.",
    ],
    nextStep: nextStepFor(status, paths),
  };
  await writeFile(outJsonPath, JSON.stringify(summary, null, 2));
  await writeFile(outHtmlPath, renderHtml(summary));
  await writeFile(outMarkdownPath, renderMarkdown(summary));
  await writeFile(outCsvPath, renderCsv(summary));
  console.log(JSON.stringify({
    status: summary.status,
    batchId: summary.batchId,
    uploadRows: summary.totals.uploadRows,
    copiedFiles: summary.totals.copiedFiles,
    scheduled: summary.totals.scheduled,
    readyToImport: summary.totals.readyToImport,
    htmlPath: outHtmlPath,
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
