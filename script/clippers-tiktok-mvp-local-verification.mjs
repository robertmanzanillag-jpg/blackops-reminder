import { spawnSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const rootDir = path.join(process.cwd(), "clippers_workspace");
const reportsDir = path.join(rootDir, "reports", "tiktok-mvp-proof-intake");
const outJsonPath = path.join(reportsDir, "local-verification.json");
const outMarkdownPath = path.join(reportsDir, "local-verification.md");

const commands = [
  {
    id: "typecheck",
    label: "TypeScript typecheck",
    command: "npm",
    args: ["run", "check"],
    required: true,
  },
  {
    id: "build",
    label: "Production build",
    command: "npm",
    args: ["run", "build"],
    required: true,
  },
  {
    id: "proof_tests",
    label: "TikTok MVP proof tests",
    command: process.execPath,
    args: ["--test", "tests/clippers-tiktok-mvp-evidence-closeout.test.mjs"],
    required: true,
  },
  {
    id: "proof_drop_kit",
    label: "TikTok MVP proof drop kit",
    command: "npm",
    args: ["run", "clippers:tiktok-mvp-proof-drop-kit"],
    required: true,
  },
  {
    id: "proof_quick_fill",
    label: "TikTok MVP proof quick fill",
    command: "npm",
    args: ["run", "clippers:tiktok-mvp-proof-quick-fill"],
    required: true,
  },
  {
    id: "proof_unblocker",
    label: "TikTok MVP proof unblocker",
    command: "npm",
    args: ["run", "clippers:tiktok-mvp-proof-unblocker"],
    required: true,
  },
  {
    id: "closeout_wizard",
    label: "TikTok MVP closeout wizard",
    command: "npm",
    args: ["run", "clippers:tiktok-mvp-closeout-wizard"],
    required: true,
  },
];

function runCommand(item) {
  const startedAt = new Date().toISOString();
  const started = Date.now();
  const result = spawnSync(item.command, item.args, {
    cwd: process.cwd(),
    encoding: "utf8",
    timeout: 180000,
  });
  const durationMs = Date.now() - started;
  const stdout = result.stdout || "";
  const stderr = result.stderr || "";
  return {
    id: item.id,
    label: item.label,
    command: [item.command, ...item.args].join(" "),
    required: item.required,
    status: result.status === 0 ? "pass" : "fail",
    exitCode: result.status,
    signal: result.signal || "",
    startedAt,
    durationMs,
    stdoutTail: stdout.slice(-4000),
    stderrTail: stderr.slice(-4000),
  };
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

function timestampMs(value) {
  const parsed = Date.parse(String(value || ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function isFreshGeneratedAt(value, maxAgeMs = 6 * 60 * 60 * 1000) {
  const parsed = timestampMs(value);
  if (!parsed) return false;
  const ageMs = Date.now() - parsed;
  return ageMs >= 0 && ageMs <= maxAgeMs;
}

function isQuickFillCurrentWithProofRefresh(quickFill = {}, proofRefresh = {}) {
  const quickFillGeneratedAt = timestampMs(quickFill.generatedAt);
  const proofRefreshGeneratedAt = timestampMs(proofRefresh.generatedAt);
  const quickFillIssues = Array.isArray(quickFill.issues) ? quickFill.issues : null;
  return Boolean(
    quickFill.appliedToIntake === true
    && quickFill.status === "applied_to_combined_intake"
    && quickFillIssues
    && quickFillIssues.length === 0
    && isFreshGeneratedAt(quickFill.generatedAt)
    && isFreshGeneratedAt(proofRefresh.generatedAt)
    && quickFillGeneratedAt
    && proofRefreshGeneratedAt
    && quickFill.proofRefreshStatus === proofRefresh.status
  );
}

function renderMarkdown(summary) {
  return [
    "# TikTok MVP Local Verification",
    "",
    `Generated: ${summary.generatedAt}`,
    `Status: ${summary.status}`,
    `Launch decision: ${summary.launchDecision}`,
    "",
    "This verifier runs local build/typecheck/tests and proof gates. It does not apply evidence, publish, schedule, or enable direct social APIs.",
    "",
    "## Commands",
    "",
    ...summary.commands.map((row) => [
      `### ${row.label}`,
      `- Status: ${row.status}`,
      `- Command: \`${row.command}\``,
      `- Duration: ${row.durationMs}ms`,
      row.stderrTail ? `- stderr tail: ${row.stderrTail.split(/\r?\n/).slice(-4).join(" | ")}` : "- stderr tail: none",
      "",
    ].join("\n")),
    "## Proof State",
    "",
    `- Quick fill: ${summary.proofState.quickFillStatus}`,
    `- Quick fill current: ${summary.proofState.quickFillCurrent}`,
    `- Quick fill issues: ${summary.proofState.quickFillIssues}`,
    `- Proof refresh: ${summary.proofState.proofRefreshStatus}`,
    `- Proof refresh fresh: ${summary.proofState.proofRefreshFresh}`,
    `- Unblocker: ${summary.proofState.unblockerStatus}`,
    `- Open proof fixes: ${summary.proofState.openFixes}`,
    `- Ready lanes: ${summary.proofState.readyLanes}/${summary.proofState.targetLanes}`,
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
  const commandResults = commands.map(runCommand);
  const proofQuickFill = await readJson(path.join(reportsDir, "proof-quick-fill.json"), {});
  const proofRefresh = await readJson(path.join(reportsDir, "proof-refresh.json"), {});
  const proofUnblocker = await readJson(path.join(reportsDir, "proof-unblocker.json"), {});
  const requiredFailures = commandResults.filter((row) => row.required && row.status !== "pass");
  const openFixes = Number(proofUnblocker?.totals?.openFixes || 0);
  const quickFillIssuesValid = Array.isArray(proofQuickFill?.issues);
  const quickFillIssues = quickFillIssuesValid ? proofQuickFill.issues.length : 1;
  const proofRefreshFresh = isFreshGeneratedAt(proofRefresh?.generatedAt);
  const quickFillCurrent = isQuickFillCurrentWithProofRefresh(proofQuickFill, proofRefresh);
  const proofReady = openFixes === 0
    && quickFillIssues === 0
    && quickFillCurrent
    && proofRefresh?.status === "ready_to_apply"
    && proofUnblocker?.status === "unblocked_ready_for_apply_preview";
  const status = requiredFailures.length === 0 && proofReady ? "pass" : "blocked";
  const summary = {
    status,
    launchDecision: status === "pass" ? "ready_for_metricool_approval_review" : "blocked_before_metricool_approval_review",
    generatedAt: new Date().toISOString(),
    scope: "tiktok_only_metricool_mvp",
    launchMode: "metricool_approval_required",
    directSocialApisRequired: false,
    realPublishEnabled: false,
    commands: commandResults,
    proofState: {
      quickFillStatus: proofQuickFill?.status || "not_run",
      quickFillCurrent,
      quickFillIssues,
      proofRefreshStatus: proofRefresh?.status || "not_run",
      proofRefreshFresh,
      unblockerStatus: proofUnblocker?.status || "not_run",
      openFixes,
      readyLanes: Number(proofUnblocker?.readyLanes || 0),
      targetLanes: Number(proofUnblocker?.targetLanes || 2),
    },
    guardrails: [
      "Local verification never applies evidence.",
      "Local verification never publishes, schedules, or enables direct social APIs.",
      "Metricool remains approval_required.",
      "Published counts remain zero until real public TikTok post evidence is imported.",
    ],
    nextStep: requiredFailures.length
      ? `Fix failing local command: ${requiredFailures[0].label}.`
      : proofReady
        ? "Run Import preview and Evidence closeout preview, then apply only if both say ready_to_apply."
        : quickFillCurrent
          ? "Proof refresh or unblocker is still blocked; rerun Proof refresh and fix the listed proof queue before Metricool."
          : "Paste real SPORT/memes TikTok and Metricool proof into Quick fill, then rerun local verification.",
    paths: {
      json: outJsonPath,
      markdown: outMarkdownPath,
      quickFillJson: path.join(reportsDir, "proof-quick-fill.json"),
      proofRefreshJson: path.join(reportsDir, "proof-refresh.json"),
      unblockerJson: path.join(reportsDir, "proof-unblocker.json"),
    },
  };

  await writeFile(outJsonPath, JSON.stringify(summary, null, 2));
  await writeFile(outMarkdownPath, renderMarkdown(summary));
  console.log(JSON.stringify({
    status: summary.status,
    launchDecision: summary.launchDecision,
    commandsPassed: commandResults.filter((row) => row.status === "pass").length,
    commands: commandResults.length,
    quickFillIssues,
    quickFillCurrent,
    proofRefreshFresh,
    openFixes,
    reportJsonPath: outJsonPath,
    nextStep: summary.nextStep,
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
