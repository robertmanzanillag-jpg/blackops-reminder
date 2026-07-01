import { copyFile, mkdir, open, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";

const rootDir = path.join(process.cwd(), "clippers_workspace");
const sourceDropDir = path.join(rootDir, "source-drop");
const sourcesDir = path.join(rootDir, "sources");
const reportsDir = path.join(rootDir, "reports");
const reportPath = path.join(reportsDir, "clippers-active-tiktok-mvp-source-sync.json");
const reportMarkdownPath = path.join(reportsDir, "clippers-active-tiktok-mvp-source-sync.md");
const force = process.argv.includes("--force");
const minUsableSourceVideoBytes = 8 * 1024;

const activeTargets = {
  sports: { count: 60, accountId: "sports-daily", accountName: "SPORT / Sports Daily" },
  memes: { count: 40, accountId: "meme-radar", accountName: "memes / Meme Radar" },
};

function fileNameFor(category, index) {
  return `${category}-owned-${String(index).padStart(2, "0")}.mp4`;
}

async function usableMp4(filePath) {
  const file = await stat(filePath).catch(() => null);
  if (!file?.isFile() || file.size < minUsableSourceVideoBytes) return { ok: false, reason: "missing_or_too_small", bytes: file?.size || 0 };
  const handle = await open(filePath, "r").catch(() => null);
  if (!handle) return { ok: false, reason: "open_failed", bytes: file.size };
  const head = Buffer.alloc(64);
  const bytesRead = await handle.read(head, 0, head.length, 0)
    .then((result) => result.bytesRead)
    .catch(() => 0)
    .finally(() => handle.close().catch(() => undefined));
  if (bytesRead <= 0 || !head.subarray(0, bytesRead).includes(Buffer.from("ftyp"))) {
    return { ok: false, reason: "mp4_probe_failed", bytes: file.size };
  }
  return { ok: true, reason: "", bytes: file.size };
}

async function syncCategory(category, target) {
  const rows = [];
  const dropCategoryDir = path.join(sourceDropDir, category);
  const sourceCategoryDir = path.join(sourcesDir, category);
  await mkdir(sourceCategoryDir, { recursive: true });
  const existingBefore = (await readdir(sourceCategoryDir).catch(() => [])).filter((file) => file.endsWith(".mp4")).length;

  for (let index = 1; index <= target.count; index += 1) {
    const fileName = fileNameFor(category, index);
    const sourceDropPath = path.join(dropCategoryDir, fileName);
    const targetPath = path.join(sourceCategoryDir, fileName);
    const sourceCheck = await usableMp4(sourceDropPath);
    if (!sourceCheck.ok) {
      rows.push({
        category,
        fileName,
        accountId: target.accountId,
        status: "blocked_source_drop",
        sourceDropPath,
        targetPath,
        bytes: sourceCheck.bytes,
        reason: sourceCheck.reason,
      });
      continue;
    }
    const existingCheck = await usableMp4(targetPath);
    if (existingCheck.ok && !force) {
      rows.push({
        category,
        fileName,
        accountId: target.accountId,
        status: "already_synced",
        sourceDropPath,
        targetPath,
        bytes: existingCheck.bytes,
        reason: "target already usable; use --force to replace",
      });
      continue;
    }
    await copyFile(sourceDropPath, targetPath);
    const copiedCheck = await usableMp4(targetPath);
    rows.push({
      category,
      fileName,
      accountId: target.accountId,
      status: copiedCheck.ok ? "synced" : "blocked_target_probe",
      sourceDropPath,
      targetPath,
      bytes: copiedCheck.bytes,
      reason: copiedCheck.ok ? "copied from source-drop with stable active MVP filename" : copiedCheck.reason,
    });
  }

  const existingAfter = (await readdir(sourceCategoryDir).catch(() => [])).filter((file) => file.endsWith(".mp4")).length;
  return { category, accountId: target.accountId, accountName: target.accountName, target: target.count, existingBefore, existingAfter, rows };
}

function renderMarkdown(summary) {
  return [
    "# Clippers Active TikTok MVP Source Sync",
    "",
    "Copies owned/source-drop assets into the production `sources` folders with stable names for the 60 SPORT / 40 memes TikTok-only Metricool MVP. This does not connect accounts, publish, schedule, or enable direct social APIs.",
    "",
    `Status: ${summary.status}`,
    `Generated: ${summary.generatedAt}`,
    `Force replace: ${summary.force ? "yes" : "no"}`,
    "",
    "## Totals",
    "",
    `- Target: ${summary.totals.target}`,
    `- Synced now: ${summary.totals.synced}`,
    `- Already synced: ${summary.totals.alreadySynced}`,
    `- Ready in sources: ${summary.totals.readyInSources}`,
    `- Blocked: ${summary.totals.blocked}`,
    "",
    "## Categories",
    "",
    ...summary.categories.flatMap((category) => [
      `### ${category.accountName}`,
      "",
      `- Target: ${category.target}`,
      `- Existing before: ${category.existingBefore}`,
      `- Existing after: ${category.existingAfter}`,
      `- Ready rows: ${category.rows.filter((row) => row.status === "synced" || row.status === "already_synced").length}`,
      `- Blocked rows: ${category.rows.filter((row) => row.status.startsWith("blocked")).length}`,
      "",
    ]),
    "## Guardrails",
    "",
    ...summary.guardrails.map((item) => `- ${item}`),
    "",
    "## Next Step",
    "",
    summary.nextStep,
    "",
  ].join("\n");
}

async function main() {
  await mkdir(reportsDir, { recursive: true });
  const categories = [];
  for (const [category, target] of Object.entries(activeTargets)) {
    categories.push(await syncCategory(category, target));
  }
  const rows = categories.flatMap((category) => category.rows);
  const totals = {
    target: rows.length,
    synced: rows.filter((row) => row.status === "synced").length,
    alreadySynced: rows.filter((row) => row.status === "already_synced").length,
    readyInSources: rows.filter((row) => row.status === "synced" || row.status === "already_synced").length,
    blocked: rows.filter((row) => row.status.startsWith("blocked")).length,
    sportsReady: rows.filter((row) => row.category === "sports" && (row.status === "synced" || row.status === "already_synced")).length,
    memesReady: rows.filter((row) => row.category === "memes" && (row.status === "synced" || row.status === "already_synced")).length,
  };
  const status = totals.blocked > 0 ? "blocked" : totals.readyInSources === totals.target ? "ready" : "partial";
  const summary = {
    status,
    generatedAt: new Date().toISOString(),
    mode: "active_tiktok_mvp_source_sync",
    force,
    targets: {
      sports: activeTargets.sports.count,
      memes: activeTargets.memes.count,
      streamers: 0,
    },
    totals,
    categories,
    rows,
    guardrails: [
      "Copies local owned source files only; it does not create external TikTok or Metricool accounts.",
      "Metricool remains approval_required and realPublishEnabled must stay false.",
      "This sync does not prove Metricool account connection; proof links still must be imported separately.",
      "Stable filenames avoid duplicate -2/-3 source copies in production queues.",
    ],
    nextStep: status === "ready"
      ? "Regenerate the Metricool 100 approval run so the operator sheet uses 60 SPORT / 40 memes active TikTok MVP sources."
      : "Fix blocked source-drop MP4 files, rerun this sync, then regenerate the Metricool 100 approval run.",
  };
  await writeFile(reportPath, JSON.stringify(summary, null, 2));
  await writeFile(reportMarkdownPath, renderMarkdown(summary));
  console.log(JSON.stringify({
    status: summary.status,
    force,
    target: totals.target,
    synced: totals.synced,
    alreadySynced: totals.alreadySynced,
    readyInSources: totals.readyInSources,
    blocked: totals.blocked,
    sportsReady: totals.sportsReady,
    memesReady: totals.memesReady,
    reportPath,
  }, null, 2));
  if (status !== "ready") process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
