import { copyFile, mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";

const rootDir = path.join(process.cwd(), "clippers_workspace");
const scheduledDir = path.join(rootDir, "scheduled");
const reportsDir = path.join(rootDir, "reports");
const workbookPath = path.join(scheduledDir, "metricool-100-current-batch-workbook.json");
const verifierPath = path.join(reportsDir, "clippers-tiktok-mvp-readiness-verifier.json");
const preflightPath = path.join(reportsDir, "clippers-metricool-mcp-preflight.json");
const uploadRootDir = path.join(scheduledDir, "metricool-current-batch-upload-pack");
const outHtmlPath = path.join(uploadRootDir, "index.html");
const outJsonPath = path.join(reportsDir, "clippers-metricool-current-batch-upload-pack.json");
const outMarkdownPath = path.join(reportsDir, "clippers-metricool-current-batch-upload-pack.md");
const outCsvPath = path.join(reportsDir, "clippers-metricool-current-batch-upload-pack.csv");
const evidenceChecklistHtmlPath = path.join(reportsDir, "clippers-tiktok-evidence-checklist.html");
const evidenceChecklistMarkdownPath = path.join(reportsDir, "clippers-tiktok-evidence-checklist.md");
const evidenceChecklistHtmlRelativePath = path.relative(uploadRootDir, evidenceChecklistHtmlPath);

function csvCell(value) {
  return `"${String(value ?? "").replace(/"/g, '""')}"`;
}

function safeName(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "clip";
}

function htmlEscape(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function parseCsvLine(line) {
  const cells = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"' && quoted && line[index + 1] === '"') {
      cell += '"';
      index += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === "," && !quoted) {
      cells.push(cell);
      cell = "";
    } else {
      cell += char;
    }
  }
  cells.push(cell);
  return cells;
}

function parseCsv(raw) {
  const lines = raw.split(/\r?\n/).filter((line) => line.trim());
  const header = parseCsvLine(lines.shift() || "");
  return lines.map((line) => {
    const cells = parseCsvLine(line);
    return Object.fromEntries(header.map((key, index) => [key, cells[index] || ""]));
  });
}

function hasOperatorEvidence(record = {}) {
  return [
    "metricool_approval_url",
    "published_post_url",
    "final_status",
    "views_24h",
    "likes_24h",
    "comments_24h",
    "shares_24h",
    "operator_notes",
  ].some((key) => String(record[key] || "").trim());
}

async function readJson(filePath, fallback = {}) {
  const raw = await readFile(filePath, "utf8").catch(() => null);
  if (!raw) return fallback;
  return JSON.parse(raw);
}

async function validateSource(filePath) {
  const resolved = path.resolve(filePath || "");
  const allowedRoots = [
    path.join(rootDir, "sources", "sports"),
    path.join(rootDir, "sources", "memes"),
  ].map((item) => path.resolve(item) + path.sep);
  if (!allowedRoots.some((allowedRoot) => resolved.startsWith(allowedRoot))) {
    return { ok: false, bytes: 0, blocker: "source_file_outside_allowed_tiktok_roots" };
  }
  const fileStat = await stat(resolved).catch(() => null);
  if (!fileStat?.isFile()) return { ok: false, bytes: 0, blocker: "source_file_missing" };
  if (fileStat.size < 1024) return { ok: false, bytes: fileStat.size, blocker: "source_file_too_small" };
  const header = await readFile(resolved).catch(() => Buffer.alloc(0));
  const signature = header.subarray(0, 4096).toString("latin1");
  if (!signature.includes("ftyp")) return { ok: false, bytes: fileStat.size, blocker: "source_file_not_mp4_like" };
  return { ok: true, bytes: fileStat.size, blocker: "" };
}

function renderMarkdown(summary) {
  return [
    "# Clippers Metricool Current Batch Upload Pack",
    "",
    `Status: ${summary.status}`,
    `Generated: ${summary.generatedAt}`,
    `Batch: ${summary.batchId}`,
    `Upload folder: ${summary.paths.uploadDir}`,
    `Evidence CSV: ${summary.paths.batchEvidenceCsv}`,
    "",
    "This pack copies the current batch videos into one folder with rank-prefixed filenames for manual Metricool upload. It does not publish anything.",
    "",
    "## Totals",
    "",
    `- Rows: ${summary.totals.rows}`,
    `- Copied files: ${summary.totals.copied}`,
    `- Blocked files: ${summary.totals.blocked}`,
    `- Total bytes: ${summary.totals.bytes}`,
    "",
    "## Upload Order",
    "",
    ...summary.rows.map((row) => [
      `### ${row.rank}. ${row.accountName} / ${row.metricoolBrandName}`,
      `- Queue item: ${row.metricoolQueueItemId}`,
      `- Upload file: ${row.uploadFilePath}`,
      `- Schedule: ${row.publishAt}`,
      `- Caption: ${row.captionSeed}`,
      `- Evidence row: ${summary.paths.batchEvidenceCsv}`,
      `- Evidence checklist: ${summary.paths.evidenceChecklistHtml}`,
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
  const header = ["rank", "metricool_queue_item_id", "account_id", "account_name", "platform", "metricool_brand_name", "metricool_blog_id", "publish_at", "upload_file_path", "caption_seed", "status", "blocker"];
  return [
    header.map(csvCell).join(","),
    ...summary.rows.map((row) => [
      row.rank,
      row.metricoolQueueItemId,
      row.accountId,
      row.accountName,
      row.platform,
      row.metricoolBrandName,
      row.metricoolBlogId,
      row.publishAt,
      row.uploadFilePath,
      row.captionSeed,
      row.status,
      row.blocker,
    ].map(csvCell).join(",")),
  ].join("\n") + "\n";
}

function renderHtml(summary) {
  const rows = summary.rows.map((row) => {
    const uploadFileName = htmlEscape(row.uploadFileName || "");
    const caption = htmlEscape(row.captionSeed || "");
    const canGenerateScheduledEvidence = summary.status === "ready_for_metricool_upload" && row.status === "ready_to_upload";
    const scheduledEvidencePayload = htmlEscape(JSON.stringify({
      metricool_queue_item_id: row.metricoolQueueItemId,
      account_id: row.accountId,
      account_name: row.accountName,
      platform: row.platform,
      metricool_brand_name: row.metricoolBrandName,
      metricool_blog_id: row.metricoolBlogId,
      scheduled_for: row.publishAt,
      source_path: row.sourcePath,
      caption_seed: row.captionSeed,
    }));
    return `
      <article class="clip ${row.status === "ready_to_upload" ? "" : "blocked"}" data-evidence-row='${scheduledEvidencePayload}'>
        <div class="clip__media">
          ${row.uploadFileName ? `<video controls preload="metadata" src="./${uploadFileName}"></video>` : `<div class="placeholder">Blocked</div>`}
        </div>
        <div class="clip__body">
          <div class="clip__topline">
            <strong>${htmlEscape(row.rank)}. ${htmlEscape(row.metricoolBrandName)} / ${htmlEscape(row.accountId)}</strong>
            <span>${htmlEscape(row.status)}</span>
          </div>
          <p><b>Metricool queue item:</b> ${htmlEscape(row.metricoolQueueItemId)}</p>
          <p><b>Upload file:</b> <code>${uploadFileName || "blocked"}</code></p>
          <p><b>Schedule:</b> ${htmlEscape(row.publishAt)}</p>
          <label>Caption</label>
          <textarea readonly>${caption}</textarea>
          <button type="button" data-copy="${caption}">Copy caption</button>
          ${canGenerateScheduledEvidence ? `<div class="scheduled-evidence">
            <label>Scheduled evidence helper</label>
            <input type="url" data-metricool-url placeholder="Paste Metricool scheduled proof URL after scheduling">
            <textarea data-operator-notes placeholder="Write a concrete 20+ character note after scheduling"></textarea>
            <button type="button" data-copy-scheduled-evidence>Copy scheduled CSV row</button>
            <p>Writes CSV columns: metricool_approval_url, final_status, operator_notes. Published URL and metrics stay blank until real.</p>
            <p data-evidence-status>Paste a real Metricool URL and concrete note first. This helper does not mark the clip published.</p>
          </div>` : `<div class="scheduled-evidence blocked-helper">
            <label>Scheduled evidence helper unavailable</label>
            <p>This pack or row is blocked. Fix the blocker and regenerate the upload pack before recording scheduled evidence.</p>
          </div>`}
          <p class="evidence"><b>Evidence after scheduling:</b> final_status=scheduled only after Metricool scheduling proof exists. Add public TikTok URL and 24h metrics only after they are real.</p>
          ${row.blocker ? `<p class="blocker"><b>Blocker:</b> ${htmlEscape(row.blocker)}</p>` : ""}
        </div>
      </article>`;
  }).join("\n");
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Metricool Current Batch Upload Pack - ${htmlEscape(summary.batchId)}</title>
  <style>
    :root { color-scheme: dark; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: #05070a; color: #f8fafc; }
    body { margin: 0; padding: 24px; }
    header { max-width: 1120px; margin: 0 auto 18px; }
    h1 { margin: 0 0 8px; font-size: 26px; letter-spacing: 0; }
    .meta, .guardrails { color: #a1a1aa; line-height: 1.55; }
    .stats { display: flex; flex-wrap: wrap; gap: 8px; margin: 16px 0; }
    .stat { border: 1px solid #1f2937; border-radius: 8px; padding: 10px 12px; background: #090d13; min-width: 120px; }
    .stat b { display: block; color: #67e8f9; font-size: 20px; }
    main { max-width: 1120px; margin: 0 auto; display: grid; gap: 14px; }
    .clip { display: grid; grid-template-columns: minmax(220px, 320px) 1fr; gap: 14px; border: 1px solid #164e63; border-radius: 8px; padding: 12px; background: #080b10; }
    .clip.blocked { border-color: #92400e; }
    video, .placeholder { width: 100%; aspect-ratio: 9 / 16; border-radius: 6px; background: #000; object-fit: contain; }
    .placeholder { display: grid; place-items: center; color: #fcd34d; }
    .clip__topline { display: flex; gap: 12px; justify-content: space-between; color: #f8fafc; }
    .clip__topline span { color: #86efac; font-size: 12px; }
    p { margin: 8px 0; color: #d4d4d8; line-height: 1.45; }
    code { color: #a5f3fc; overflow-wrap: anywhere; }
    label { display: block; margin: 10px 0 6px; color: #e5e7eb; font-weight: 700; }
    textarea { box-sizing: border-box; width: 100%; min-height: 92px; resize: vertical; border: 1px solid #1f2937; border-radius: 6px; padding: 10px; background: #020617; color: #f8fafc; font: inherit; line-height: 1.45; }
    input { box-sizing: border-box; width: 100%; border: 1px solid #1f2937; border-radius: 6px; padding: 10px; background: #020617; color: #f8fafc; font: inherit; }
    button { margin-top: 8px; border: 1px solid #155e75; border-radius: 6px; background: #083344; color: #ecfeff; padding: 8px 10px; cursor: pointer; }
    button.copied { border-color: #15803d; background: #14532d; }
    button.blocked { border-color: #92400e; background: #451a03; }
    .scheduled-evidence { margin-top: 12px; border: 1px solid #1f2937; border-radius: 8px; padding: 10px; background: #050812; }
    .scheduled-evidence.blocked-helper { border-color: #92400e; background: #130a05; }
    .scheduled-evidence textarea { min-height: 68px; margin-top: 8px; }
    .scheduled-evidence p { margin-bottom: 0; font-size: 12px; color: #a1a1aa; }
    .evidence { color: #fde68a; }
    .blocker { color: #fdba74; }
    @media (max-width: 760px) { body { padding: 14px; } .clip { grid-template-columns: 1fr; } }
  </style>
</head>
<body>
  <header>
    <h1>Metricool Current Batch Upload Pack</h1>
    <div class="meta">
      <div>Status: <b>${htmlEscape(summary.status)}</b></div>
      <div>Batch: <b>${htmlEscape(summary.batchId)}</b></div>
      <div>Evidence CSV: <code>${htmlEscape(summary.paths.batchEvidenceCsv)}</code></div>
      <div>Evidence checklist: <a href="${htmlEscape(evidenceChecklistHtmlRelativePath)}">${htmlEscape(summary.paths.evidenceChecklistHtml)}</a></div>
      <div>This page is a local upload aid only. It does not schedule, publish, or prove posting.</div>
    </div>
    <div class="stats">
      <div class="stat">Rows <b>${htmlEscape(summary.totals.rows)}</b></div>
      <div class="stat">Copied <b>${htmlEscape(summary.totals.copied)}</b></div>
      <div class="stat">Blocked <b>${htmlEscape(summary.totals.blocked)}</b></div>
      <div class="stat">Stale files <b>${htmlEscape(summary.totals.staleFiles)}</b></div>
    </div>
    <div class="guardrails">${summary.guardrails.map((guardrail) => `<div>${htmlEscape(guardrail)}</div>`).join("")}</div>
  </header>
  <main>${rows}</main>
  <script>
    const csvCell = (value) => '"' + String(value ?? "").replace(/"/g, '""') + '"';
    const isMetricoolUrl = (value) => {
      try {
        const parsed = new URL(value);
        const host = parsed.hostname.replace(/^www\\./, "");
        return parsed.protocol === "https:" && (host === "metricool.com" || host.endsWith(".metricool.com"));
      } catch {
        return false;
      }
    };
    const concreteNotes = (value) => {
      const notes = String(value || "").trim();
      const normalized = notes.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
      return notes.length >= 20
        && !/<[^>]+>|\\b(placeholder|paste|todo|tbd|example)\\b/i.test(notes)
        && !["ok", "yes", "done", "scheduled", "approved", "published"].includes(normalized);
    };
    document.querySelectorAll("button[data-copy]").forEach((button) => {
      button.addEventListener("click", async () => {
        await navigator.clipboard.writeText(button.getAttribute("data-copy") || "");
        button.classList.add("copied");
        button.textContent = "Copied";
        setTimeout(() => { button.classList.remove("copied"); button.textContent = "Copy caption"; }, 1400);
      });
    });
    document.querySelectorAll("button[data-copy-scheduled-evidence]").forEach((button) => {
      button.addEventListener("click", async () => {
        const clip = button.closest(".clip");
        const status = clip.querySelector("[data-evidence-status]");
        const metricoolUrl = clip.querySelector("[data-metricool-url]").value.trim();
        const operatorNotes = clip.querySelector("[data-operator-notes]").value.trim();
        if (!isMetricoolUrl(metricoolUrl) || !concreteNotes(operatorNotes)) {
          button.classList.add("blocked");
          status.textContent = "Blocked: use an HTTPS Metricool URL and concrete 20+ character operator note.";
          setTimeout(() => button.classList.remove("blocked"), 1400);
          return;
        }
        const row = JSON.parse(clip.getAttribute("data-evidence-row") || "{}");
        const csvRow = [
          row.metricool_queue_item_id,
          row.account_id,
          row.account_name,
          row.platform,
          row.metricool_brand_name,
          row.metricool_blog_id,
          row.scheduled_for,
          row.source_path,
          row.caption_seed,
          metricoolUrl,
          "",
          "scheduled",
          "",
          "",
          "",
          "",
          operatorNotes,
        ].map(csvCell).join(",");
        await navigator.clipboard.writeText(csvRow);
        button.classList.add("copied");
        button.textContent = "Copied scheduled CSV row";
        status.textContent = "Copied. Paste into the current batch evidence CSV, then run preview before apply.";
        setTimeout(() => { button.classList.remove("copied"); button.textContent = "Copy scheduled CSV row"; }, 1600);
      });
    });
  </script>
</body>
</html>`;
}

async function writeBlockedSummary({ workbook, batchId, batchEvidenceCsv, blocker, guardrail, nextStep }) {
  await rm(uploadRootDir, { recursive: true, force: true });
  await mkdir(uploadRootDir, { recursive: true });
  const rows = (workbook.rows || []).map((row) => ({
    rank: Number(row.rank || 0),
    metricoolQueueItemId: row.metricoolQueueItemId,
    accountId: row.accountId,
    accountName: row.accountName,
    platform: row.platform,
    metricoolBrandName: row.metricoolBrandName,
    metricoolBlogId: row.metricoolBlogId,
    publishAt: row.publishAt,
    sourcePath: row.sourcePath,
    sourceBytes: 0,
    uploadFileName: "",
    uploadFilePath: "",
    captionSeed: row.captionSeed,
    status: "blocked_source_file",
    blocker,
  }));
  const summary = {
    status: "blocked",
    generatedAt: new Date().toISOString(),
    batchId,
    paths: {
      json: outJsonPath,
      html: outHtmlPath,
      markdown: outMarkdownPath,
      csv: outCsvPath,
      uploadDir: uploadRootDir,
      workbook: workbookPath,
      batchEvidenceCsv,
      evidenceChecklistHtml: evidenceChecklistHtmlPath,
      evidenceChecklistMarkdown: evidenceChecklistMarkdownPath,
      verifier: verifierPath,
      preflight: preflightPath,
    },
    totals: {
      rows: rows.length,
      copied: 0,
      blocked: rows.length,
      bytes: 0,
      staleFiles: 0,
    },
    staleFiles: [],
    rows,
    guardrails: [
      guardrail,
      "Do not re-stage or re-upload this batch from the upload pack.",
      "Use the tracker/evidence flow for scheduled, published, rejected, URL, and 24h metric updates.",
      "Do not treat copied files as scheduled, published, or permission proof.",
      "Keep TikTok-only SPORT/memes scope until Robert explicitly expands networks.",
    ],
    nextStep,
  };
  await writeFile(outJsonPath, JSON.stringify(summary, null, 2));
  await writeFile(outHtmlPath, renderHtml(summary));
  await writeFile(outMarkdownPath, renderMarkdown(summary));
  await writeFile(outCsvPath, renderCsv(summary));
}

async function main() {
  await mkdir(reportsDir, { recursive: true });
  await mkdir(uploadRootDir, { recursive: true });
  const [workbook, verifier, preflight] = await Promise.all([
    readJson(workbookPath),
    readJson(verifierPath),
    readJson(preflightPath),
  ]);
  const batchId = workbook.batchId || verifier.active?.currentBatchId || "metricool-batch-01";
  if (batchId !== verifier.active?.currentBatchId) {
    await writeBlockedSummary({
      workbook,
      batchId,
      batchEvidenceCsv: workbook.paths?.batchEvidenceCsv || preflight.paths?.currentBatchEvidenceCsv || "",
      blocker: "batch_mismatch_with_verifier",
      guardrail: "This pack is blocked because the workbook batch no longer matches the verifier batch.",
      nextStep: `Refresh the TikTok verifier and operator handoff before staging uploads. workbook=${batchId}, verifier=${verifier.active?.currentBatchId || "missing"}.`,
    });
    throw new Error(`Upload pack blocked: workbook batch ${batchId} does not match verifier batch ${verifier.active?.currentBatchId || "missing"}.`);
  }
  if (verifier.status !== "pass" || preflight.status !== "ready_for_operator") {
    await writeBlockedSummary({
      workbook,
      batchId,
      batchEvidenceCsv: workbook.paths?.batchEvidenceCsv || preflight.paths?.currentBatchEvidenceCsv || "",
      blocker: "verifier_or_preflight_not_ready",
      guardrail: "This pack is blocked because TikTok verifier or Metricool preflight is not ready.",
      nextStep: `Fix verifier/preflight before staging uploads. verifier=${verifier.status || "missing"}, preflight=${preflight.status || "missing"}.`,
    });
    throw new Error(`Upload pack blocked: verifier=${verifier.status || "missing"}, preflight=${preflight.status || "missing"}.`);
  }
  const batchEvidenceCsv = workbook.paths?.batchEvidenceCsv || preflight.paths?.currentBatchEvidenceCsv || "";
  const evidenceRows = parseCsv(await readFile(batchEvidenceCsv, "utf8").catch(() => ""));
  const evidenceById = new Map(evidenceRows.map((record) => [String(record.metricool_queue_item_id || "").trim(), record]));
  const touchedEvidence = (workbook.rows || []).filter((row) => hasOperatorEvidence(evidenceById.get(String(row.metricoolQueueItemId || "").trim())));
  if (touchedEvidence.length) {
    await writeBlockedSummary({
      workbook,
      batchId,
      batchEvidenceCsv,
      blocker: "operator_evidence_already_exists",
      guardrail: "This pack is blocked because current-batch operator evidence already exists.",
      nextStep: `${touchedEvidence.length} current batch row(s) already have operator evidence. Continue in the tracker/evidence flow instead of re-uploading.`,
    });
    throw new Error(`Upload pack blocked: ${touchedEvidence.length} current batch row(s) already have operator evidence; use tracker/evidence flow instead of staging uploads again.`);
  }
  await rm(uploadRootDir, { recursive: true, force: true });
  await mkdir(uploadRootDir, { recursive: true });
  const rows = [];
  for (const row of workbook.rows || []) {
    const rank = String(row.rank || rows.length + 1).padStart(2, "0");
    const ext = path.extname(row.sourcePath || row.sourceFileName || ".mp4") || ".mp4";
    const uploadFileName = `${rank}_${safeName(row.metricoolBrandName)}_${safeName(row.accountId)}_${safeName(row.metricoolQueueItemId)}${ext.toLowerCase()}`;
    const uploadFilePath = path.join(uploadRootDir, uploadFileName);
    const inScope = row.platform === "tiktok" && ["SPORT", "memes"].includes(row.metricoolBrandName) && ["sports-daily", "meme-radar"].includes(row.accountId);
    const sourceStatus = inScope
      ? await validateSource(row.sourcePath)
      : { ok: false, bytes: 0, blocker: "row_outside_tiktok_sport_memes_scope" };
    if (sourceStatus.ok) await copyFile(row.sourcePath, uploadFilePath);
    rows.push({
      rank: Number(row.rank || rows.length + 1),
      metricoolQueueItemId: row.metricoolQueueItemId,
      accountId: row.accountId,
      accountName: row.accountName,
      platform: row.platform,
      metricoolBrandName: row.metricoolBrandName,
      metricoolBlogId: row.metricoolBlogId,
      publishAt: row.publishAt,
      sourcePath: row.sourcePath,
      sourceBytes: sourceStatus.bytes,
      uploadFileName,
      uploadFilePath,
      captionSeed: row.captionSeed,
      status: sourceStatus.ok ? "ready_to_upload" : "blocked_source_file",
      blocker: sourceStatus.blocker,
    });
  }
  const manifestUploadFiles = new Set(rows.map((row) => row.uploadFileName));
  const actualUploadFiles = (await readdir(uploadRootDir)).filter((fileName) => fileName.toLowerCase().endsWith(".mp4"));
  const staleFiles = actualUploadFiles.filter((fileName) => !manifestUploadFiles.has(fileName));
  const totals = rows.reduce((sum, row) => {
    sum.rows += 1;
    sum.bytes += row.sourceBytes;
    if (row.status === "ready_to_upload") sum.copied += 1;
    if (row.status !== "ready_to_upload") sum.blocked += 1;
    return sum;
  }, { rows: 0, copied: 0, blocked: 0, bytes: 0 });
  totals.staleFiles = staleFiles.length;
  const summary = {
    status: totals.rows === 10 && totals.copied === 10 && totals.blocked === 0 && totals.staleFiles === 0 ? "ready_for_metricool_upload" : "blocked",
    generatedAt: new Date().toISOString(),
    batchId,
    paths: {
      json: outJsonPath,
      html: outHtmlPath,
      markdown: outMarkdownPath,
      csv: outCsvPath,
      uploadDir: uploadRootDir,
      workbook: workbookPath,
      batchEvidenceCsv,
      evidenceChecklistHtml: evidenceChecklistHtmlPath,
      evidenceChecklistMarkdown: evidenceChecklistMarkdownPath,
      verifier: verifierPath,
      preflight: preflightPath,
    },
    totals,
    staleFiles,
    rows,
    guardrails: [
      "This pack only stages local files for manual Metricool upload.",
      "Do not treat copied files as scheduled, published, or permission proof.",
      "Use final_status=scheduled only after Metricool scheduling proof exists.",
      "Use final_status=published only after a public TikTok URL and real 24h metrics exist.",
      "Keep TikTok-only SPORT/memes scope until Robert explicitly expands networks.",
    ],
    nextStep: totals.blocked > 0
      ? "Repair blocked source files before opening Metricool."
      : `Open ${uploadRootDir}, upload files in rank order, then fill ${workbook.paths?.batchEvidenceCsv || preflight.paths?.currentBatchEvidenceCsv || "the batch evidence CSV"} after scheduling.`,
  };
  await writeFile(outJsonPath, JSON.stringify(summary, null, 2));
  await writeFile(outHtmlPath, renderHtml(summary));
  await writeFile(outMarkdownPath, renderMarkdown(summary));
  await writeFile(outCsvPath, renderCsv(summary));
  console.log(JSON.stringify({
    status: summary.status,
    batchId: summary.batchId,
    rows: summary.totals.rows,
    copied: summary.totals.copied,
    blocked: summary.totals.blocked,
    uploadDir: summary.paths.uploadDir,
    nextStep: summary.nextStep,
  }));
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
