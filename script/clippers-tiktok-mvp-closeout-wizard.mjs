import { mkdir, readFile, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";

const rootDir = path.join(process.cwd(), "clippers_workspace");
const reportsDir = path.join(rootDir, "reports", "tiktok-mvp-proof-intake");
const closeoutJsonPath = path.join(rootDir, "reports", "clippers-tiktok-mvp-evidence-closeout.json");
const operatingRefreshJsonPath = path.join(rootDir, "reports", "tiktok-mvp-operating-refresh", "operating-refresh.json");
const outJsonPath = path.join(reportsDir, "closeout-wizard.json");
const outMarkdownPath = path.join(reportsDir, "closeout-wizard.md");
const outHtmlPath = path.join(reportsDir, "closeout-wizard.html");
const outApplyGateCsvPath = path.join(reportsDir, "closeout-apply-gate.csv");

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

function step(id, label, status, nextAction, details = {}) {
  return { id, label, status, nextAction, ...details };
}

function firstBlocked(steps) {
  return steps.find((item) => item.status === "blocked" || item.status === "waiting");
}

function proofGateControlFieldsPresent(proofGate = {}) {
  return [
    "status",
    "requiredLanes",
    "minimumProofUrlsNeeded",
    "failedPreflightChecks",
    "failedVerifierChecks",
    "missingRequiredReports",
    "boundaryNotReady",
    "blockedBy",
    "preflightNotReady",
  ].every((field) => Object.hasOwn(proofGate, field))
    && Array.isArray(proofGate.requiredLanes)
    && typeof proofGate.minimumProofUrlsNeeded === "number"
    && Array.isArray(proofGate.failedPreflightChecks)
    && Array.isArray(proofGate.failedVerifierChecks)
    && Array.isArray(proofGate.missingRequiredReports)
    && Array.isArray(proofGate.boundaryNotReady)
    && Array.isArray(proofGate.blockedBy);
}

function isProofGateReady(proofGate = {}) {
  const requiredLanes = proofGate.requiredLanes || [];
  return proofGate.status === "ready_for_operator_review"
    && proofGateControlFieldsPresent(proofGate)
    && requiredLanes.includes("sports-daily:tiktok")
    && requiredLanes.includes("meme-radar:tiktok")
    && Number(proofGate.minimumProofUrlsNeeded || 0) === 0
    && Array.isArray(proofGate.failedPreflightChecks)
    && proofGate.failedPreflightChecks.length === 0
    && Array.isArray(proofGate.failedVerifierChecks)
    && proofGate.failedVerifierChecks.length === 0
    && Array.isArray(proofGate.missingRequiredReports)
    && proofGate.missingRequiredReports.length === 0
    && Array.isArray(proofGate.boundaryNotReady)
    && proofGate.boundaryNotReady.length === 0
    && Array.isArray(proofGate.blockedBy)
    && proofGate.blockedBy.length === 0
    && !proofGate.preflightNotReady;
}

function proofGateStep(proofGate = {}) {
  const controlFieldsPresent = proofGateControlFieldsPresent(proofGate);
  const ready = isProofGateReady(proofGate);
  return step(
    "operating_proof_gate",
    "Operating proof gate",
    ready ? "done" : "blocked",
    ready
      ? "Proof gate is ready for operator review; keep Metricool approval_required."
      : proofGate.nextStep || "Refresh Operating proof gate and add real non-secret SPORT/memes Metricool proof URLs before closeout apply review.",
    {
      statusValue: proofGate.status || "missing",
      controlFieldsPresent,
      minimumProofUrlsNeeded: Number(proofGate.minimumProofUrlsNeeded || 0),
      blockedBy: Array.isArray(proofGate.blockedBy) ? proofGate.blockedBy : [],
      failedPreflightChecks: Array.isArray(proofGate.failedPreflightChecks) ? proofGate.failedPreflightChecks : [],
      failedVerifierChecks: Array.isArray(proofGate.failedVerifierChecks) ? proofGate.failedVerifierChecks : [],
      path: proofGate.paths?.oneScreenGuide || operatingRefreshJsonPath,
    },
  );
}

function buildSteps({ proofDrop, quickFill, importPreview, closeout, localVerification, proofGate }) {
  const proofDropReady = proofDrop?.readyForQuickFill === true;
  const quickFillReady = quickFill?.appliedToIntake === true && (quickFill?.issues?.length || 0) === 0;
  const importReady = importPreview?.status === "ready_to_apply";
  const closeoutReady = closeout?.status === "ready_to_apply" || closeout?.status === "applied";
  const localCommandsPass = Array.isArray(localVerification?.commands)
    && localVerification.commands.length > 0
    && localVerification.commands.every((row) => row.status === "pass");

  return [
    step(
      "proof_drop_links",
      "Proof drop links",
      proofDropReady ? "done" : "blocked",
      proofDropReady
        ? "Run Quick fill or Import preview."
        : "Add two real Metricool URLs or concrete Drive file/folder/Docs proof URLs, or separate ownership plus Metricool URLs, to proof-links.json, then rerun Proof drop.",
      {
        issues: proofDrop?.issues || [],
        warnings: proofDrop?.warnings || [],
        path: proofDrop?.paths?.proofLinksJson || path.join(rootDir, "proof-drop", "tiktok-mvp", "proof-links.json"),
      },
    ),
    step(
      "quick_fill",
      "Quick fill",
      quickFillReady ? "done" : proofDropReady ? "waiting" : "blocked",
      quickFillReady
        ? "Run Import preview."
        : proofDropReady
          ? "Run Quick fill to write the validated URLs into combined-proof-intake.csv."
          : "Finish proof drop links first; Quick fill must stay blocked until real URLs exist.",
      {
        statusValue: quickFill?.status || "not_run",
        issues: quickFill?.issues || [],
      },
    ),
    step(
      "import_preview",
      "Import preview",
      importReady ? "done" : quickFillReady ? "waiting" : "blocked",
      importReady
        ? "Run Preview closeout."
        : quickFillReady
          ? "Run Import preview; do not apply until it says ready_to_apply."
          : "Finish Quick fill first.",
      {
        statusValue: importPreview?.status || "not_run",
        closeoutPreviewStatus: importPreview?.closeoutPreviewStatus || "not_run",
        fixQueue: importPreview?.fixQueue || [],
      },
    ),
    step(
      "closeout_preview",
      "Closeout preview",
      closeoutReady ? "done" : importReady ? "waiting" : "blocked",
      closeoutReady
        ? "Apply closeout is allowed only with the operator confirmation header."
        : importReady
          ? "Run Preview closeout and inspect rejected lanes."
          : "Finish Import preview first.",
      {
        statusValue: closeout?.status || "not_run",
        ready: closeout?.totals?.ready || 0,
        lanes: closeout?.totals?.lanes || 2,
        rejected: closeout?.totals?.rejected || 0,
      },
    ),
    step(
      "local_verification",
      "Local verification",
      localCommandsPass ? "done" : "waiting",
      localCommandsPass
        ? "Local commands pass; launch remains blocked until proof gates are complete."
        : "Run Local verify after proof/import/closeout gates are updated.",
      {
        statusValue: localVerification?.status || "not_run",
        launchDecision: localVerification?.launchDecision || "not_run",
        commandsPassed: Array.isArray(localVerification?.commands) ? localVerification.commands.filter((row) => row.status === "pass").length : 0,
        commands: Array.isArray(localVerification?.commands) ? localVerification.commands.length : 0,
      },
    ),
    proofGateStep(proofGate),
  ];
}

function renderMarkdown(summary) {
  return [
    "# TikTok MVP Closeout Wizard",
    "",
    `Generated: ${summary.generatedAt}`,
    `Status: ${summary.status}`,
    `Launch decision: ${summary.launchDecision}`,
    "",
    "## Steps",
    "",
    ...summary.steps.map((item) => [
      `### ${item.label}`,
      `- Status: ${item.status}`,
      `- Next action: ${item.nextAction}`,
      "",
    ].join("\n")),
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

function csvCell(value) {
  return `"${String(value ?? "").replace(/"/g, '""')}"`;
}

function renderApplyGateCsv(summary) {
  const header = ["gate_id", "label", "status", "ready_to_apply", "evidence", "next_action"];
  return [
    header.join(","),
    ...summary.steps.map((item) => [
      item.id,
      item.label,
      item.status,
      item.status === "done" ? "yes" : "no",
      item.path || item.statusValue || item.launchDecision || "",
      item.nextAction,
    ].map(csvCell).join(",")),
    "",
  ].join("\n");
}

function buildOperatorSession(summary) {
  const nextGate = firstBlocked(summary.steps);
  const readyForApply = summary.status === "ready_for_operator_apply_review";
  const collectionPackets = Array.isArray(summary.proofCollectionPackets)
    ? summary.proofCollectionPackets
    : [];
  const packetLines = collectionPackets.slice(0, 6).flatMap((packet) => [
    `Proof packet: ${packet.id || packet.field || "proof"}`,
    `Lane: ${packet.lane || `${packet.accountId || ""}:${packet.platform || ""}`}`,
    `Field: ${packet.field || "proofUrl"}`,
    `Rule: ${packet.proofUrlRule || "Use only real public/non-secret HTTPS proof URLs."}`,
    `Prompt: ${packet.copyPrompt || "Collect real non-secret proof and rerun preview."}`,
  ]);
  const action = readyForApply
    ? "Human review can run guarded apply only after confirming every proof URL is real and non-secret."
    : nextGate?.nextAction || summary.nextStep;
  const steps = [
    "Open Proof handoff and review collection packets.",
    "Paste real non-secret SPORT/memes Metricool proof links; optional separate TikTok ownership links are accepted, and signed/temporary URLs are blocked.",
    "Run Preview links before saving.",
    "Save proof links only after preview has no blockers.",
    "Run Proof handoff, Import preview, Preview closeout, and Local verify.",
    "Apply only when closeout/apply gate says ready and operator confirmation is intentional.",
  ];
  return {
    status: readyForApply ? "ready_for_operator_apply_review" : "blocked_operator_session",
    nextGateId: nextGate?.id || "",
    nextAction: action,
    recommendedButton: readyForApply ? "apply_closeout_with_confirmation" : nextGate?.id === "proof_drop_links" ? "preview_or_save_proof_links" : nextGate?.id || "closeout_wizard",
    steps,
    copyPacket: [
      "TikTok MVP operator session",
      `Status: ${summary.status}`,
      `Next gate: ${nextGate?.id || "none"}`,
      `Action: ${action}`,
      `Apply gate CSV: ${summary.paths.applyGateCsv}`,
      collectionPackets.length ? `Proof packets needed: ${collectionPackets.length}` : "Proof packets needed: 0",
      ...packetLines,
      "Guardrails: no auto publish, no direct social APIs, Metricool approval_required, no signed/temporary proof URLs, no applied evidence unless guarded apply is intentionally confirmed.",
    ].join("\n"),
  };
}

function htmlEscape(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function renderHtml(summary) {
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>TikTok MVP Closeout Wizard</title>
  <style>
    body { background: #09090b; color: #e4e4e7; font-family: Inter, system-ui, sans-serif; margin: 32px; line-height: 1.5; }
    .step { border: 1px solid #334155; border-radius: 8px; padding: 14px; margin: 12px 0; background: #0f172a; }
    .done { color: #86efac; }
    .blocked, .waiting { color: #fcd34d; }
  </style>
</head>
<body>
  <h1>TikTok MVP Closeout Wizard</h1>
  <p>Status: <strong>${htmlEscape(summary.status)}</strong></p>
  <p>${htmlEscape(summary.nextStep)}</p>
  ${summary.steps.map((item) => `
    <div class="step">
      <h2>${htmlEscape(item.label)} <span class="${htmlEscape(item.status)}">${htmlEscape(item.status)}</span></h2>
      <p>${htmlEscape(item.nextAction)}</p>
    </div>
  `).join("")}
</body>
</html>`;
}

async function main() {
  await mkdir(reportsDir, { recursive: true });
  const proofDropRun = runJson(["script/clippers-tiktok-mvp-proof-drop-kit.mjs"]);
  const proofUnblockerRun = runJson(["script/clippers-tiktok-mvp-proof-unblocker.mjs"]);
  const proofDrop = await readJson(path.join(reportsDir, "proof-drop-kit.json"), {});
  const proofHandoff = await readJson(path.join(reportsDir, "proof-handoff.json"), {});
  const quickFill = await readJson(path.join(reportsDir, "proof-quick-fill.json"), {});
  const importPreview = await readJson(path.join(reportsDir, "proof-intake-import.json"), {});
  const closeout = await readJson(closeoutJsonPath, {});
  const localVerification = await readJson(path.join(reportsDir, "local-verification.json"), {});
  const operatingRefresh = await readJson(operatingRefreshJsonPath, {});
  const proofGate = operatingRefresh.proofGate || {};
  const steps = buildSteps({ proofDrop, quickFill, importPreview, closeout, localVerification, proofGate });
  const allRequiredDone = steps.slice(0, 4).every((item) => item.status === "done");
  const proofGateReady = isProofGateReady(proofGate);
  const blocker = proofGateReady ? firstBlocked(steps) : steps.find((item) => item.id === "operating_proof_gate") || firstBlocked(steps);
  const status = allRequiredDone && proofGateReady ? "ready_for_operator_apply_review" : proofGateReady ? "blocked_needs_operator_evidence" : "blocked_needs_valid_metricool_tiktok_proof_gate";
  const summary = {
    status,
    launchDecision: allRequiredDone && proofGateReady ? "ready_for_confirmed_apply_only" : "blocked_before_apply",
    generatedAt: new Date().toISOString(),
    scope: "tiktok_only_metricool_mvp",
    launchMode: "metricool_approval_required",
    directSocialApisRequired: false,
    realPublishEnabled: false,
    steps,
    proofDropRun,
    proofUnblockerRun,
    proofGate: {
      status: proofGate.status || "missing",
      controlFieldsPresent: proofGateControlFieldsPresent(proofGate),
      ready: proofGateReady,
      minimumProofUrlsNeeded: Number(proofGate.minimumProofUrlsNeeded || 0),
      blockedBy: Array.isArray(proofGate.blockedBy) ? proofGate.blockedBy : [],
      nextStep: proofGate.nextStep || "Run Operating Refresh to rebuild the TikTok MVP proof gate.",
      paths: proofGate.paths || {},
    },
    proofCollectionPackets: Array.isArray(proofHandoff?.collectionPackets) ? proofHandoff.collectionPackets : [],
    paths: {
      json: outJsonPath,
      markdown: outMarkdownPath,
      html: outHtmlPath,
      proofDropJson: path.join(reportsDir, "proof-drop-kit.json"),
      quickFillJson: path.join(reportsDir, "proof-quick-fill.json"),
      importJson: path.join(reportsDir, "proof-intake-import.json"),
      closeoutJson: closeoutJsonPath,
      localVerificationJson: path.join(reportsDir, "local-verification.json"),
      applyGateCsv: outApplyGateCsvPath,
    },
    guardrails: [
      "Closeout wizard never applies final evidence.",
      "Closeout wizard never publishes, schedules, or enables direct social APIs.",
      "Apply closeout remains separately guarded by the operator confirmation header.",
      "Metricool remains approval_required.",
      "Queued/scheduled Metricool rows are not counted as published.",
    ],
    nextStep: blocker?.nextAction || "Run Apply closeout only after human review confirms the ready_to_apply preview.",
  };
  summary.operatorSession = buildOperatorSession(summary);

  await writeFile(outJsonPath, JSON.stringify(summary, null, 2));
  await writeFile(outMarkdownPath, renderMarkdown(summary));
  await writeFile(outHtmlPath, renderHtml(summary));
  await writeFile(outApplyGateCsvPath, renderApplyGateCsv(summary));
  console.log(JSON.stringify({
    status: summary.status,
    launchDecision: summary.launchDecision,
    nextBlockedStep: blocker?.id || "",
    nextStep: summary.nextStep,
    reportJsonPath: outJsonPath,
    applyGateCsvPath: outApplyGateCsvPath,
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
