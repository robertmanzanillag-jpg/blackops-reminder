import { mkdir, readFile, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";

const rootDir = path.join(process.cwd(), "clippers_workspace");
const reportsDir = path.join(rootDir, "reports", "tiktok-mvp-proof-intake");
const outJsonPath = path.join(reportsDir, "proof-refresh.json");
const outMarkdownPath = path.join(reportsDir, "proof-refresh.md");

function runJson(args) {
  const result = spawnSync(process.execPath, args, {
    cwd: process.cwd(),
    encoding: "utf8",
  });
  if (result.status !== 0 || !result.stdout) {
    return {
      ok: false,
      status: result.status,
      error: result.stderr || result.stdout || "Command returned no JSON output.",
    };
  }
  try {
    return {
      ok: true,
      data: JSON.parse(result.stdout),
    };
  } catch {
    return {
      ok: false,
      status: result.status,
      error: "Command returned invalid JSON output.",
    };
  }
}

async function readJson(filePath, fallback = null) {
  const raw = await readFile(filePath, "utf8").catch(() => null);
  if (!raw) return fallback;
  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function renderMarkdown(summary) {
  return [
    "# TikTok MVP Proof Refresh",
    "",
    `Generated: ${summary.generatedAt}`,
    `Status: ${summary.status}`,
    `Import status: ${summary.importStatus}`,
    `Doctor status: ${summary.doctorStatus}`,
    `Ready lanes: ${summary.readyLanes}/${summary.targetLanes}`,
    `Import fixes: ${summary.importFixQueue}`,
    `Doctor fixes: ${summary.doctorFixQueue}`,
    "",
    "## Files",
    "",
    `- Import report: ${summary.paths.importJson}`,
    `- Doctor report: ${summary.paths.doctorJson}`,
    `- Combined fix queue: ${summary.paths.importFixQueueCsv}`,
    `- Target fix queue: ${summary.paths.doctorFixQueueCsv}`,
    "",
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
  const importRun = runJson(["script/clippers-tiktok-mvp-proof-intake-import.mjs"]);
  const doctorRun = runJson(["script/clippers-tiktok-mvp-proof-doctor.mjs"]);
  const proofImport = await readJson(path.join(reportsDir, "proof-intake-import.json"), {});
  const proofDoctor = await readJson(path.join(reportsDir, "proof-doctor.json"), {});
  const readyLanes = proofDoctor?.totals?.ready || 0;
  const targetLanes = proofDoctor?.totals?.lanes || 2;
  const importFixQueue = Array.isArray(proofImport?.fixQueue) ? proofImport.fixQueue.length : 0;
  const doctorFixQueue = Array.isArray(proofDoctor?.fixQueue) ? proofDoctor.fixQueue.length : proofDoctor?.totals?.fixQueue || 0;
  const status = importRun.ok && doctorRun.ok && readyLanes >= targetLanes
    ? "ready_to_apply"
    : "blocked";
  const summary = {
    status,
    generatedAt: new Date().toISOString(),
    scope: "tiktok_only_metricool_mvp",
    launchMode: "metricool_approval_required",
    directSocialApisRequired: false,
    importStatus: proofImport?.status || "unknown",
    doctorStatus: proofDoctor?.status || "unknown",
    readyLanes,
    targetLanes,
    importFixQueue,
    doctorFixQueue,
    runs: {
      importRun,
      doctorRun,
    },
    paths: {
      json: outJsonPath,
      markdown: outMarkdownPath,
      importJson: proofImport?.paths?.json || path.join(reportsDir, "proof-intake-import.json"),
      doctorJson: proofDoctor?.paths?.json || path.join(reportsDir, "proof-doctor.json"),
      importFixQueueCsv: proofImport?.paths?.fixQueueCsv || path.join(reportsDir, "proof-intake-import-fix-queue.csv"),
      doctorFixQueueCsv: proofDoctor?.paths?.fixQueueCsv || path.join(reportsDir, "proof-fix-queue.csv"),
    },
    guardrails: [
      "Refresh runs import preview and proof doctor sequentially to keep proof artifacts consistent.",
      "This refresh does not apply evidence, publish, schedule, or enable direct social APIs.",
      "Metricool remains approval_required.",
      "Do not paste passwords, cookies, tokens, private screenshots, recovery codes, or private keys.",
    ],
    nextStep: readyLanes >= targetLanes
      ? "Review proof URLs manually, then run the guarded TikTok MVP evidence closeout apply."
      : "Fix the combined proof intake rows in the import fix queue, rerun Proof refresh, and apply only after preview is ready.",
  };

  await writeFile(outJsonPath, JSON.stringify(summary, null, 2));
  await writeFile(outMarkdownPath, renderMarkdown(summary));
  console.log(JSON.stringify({
    status: summary.status,
    importStatus: summary.importStatus,
    doctorStatus: summary.doctorStatus,
    readyLanes: summary.readyLanes,
    targetLanes: summary.targetLanes,
    importFixQueue: summary.importFixQueue,
    doctorFixQueue: summary.doctorFixQueue,
    reportJsonPath: outJsonPath,
    nextStep: summary.nextStep,
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
