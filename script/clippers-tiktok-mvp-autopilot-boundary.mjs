import { mkdir, readFile, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";

const rootDir = path.join(process.cwd(), "clippers_workspace");
const reportsDir = path.join(rootDir, "reports");
const proofReportsDir = path.join(reportsDir, "tiktok-mvp-proof-intake");

const paths = {
  proofHandoff: path.join(proofReportsDir, "proof-handoff.json"),
  proofDoctor: path.join(proofReportsDir, "proof-doctor.json"),
  proofUnblocker: path.join(proofReportsDir, "proof-unblocker.json"),
  localVerification: path.join(proofReportsDir, "local-verification.json"),
  readinessVerifier: path.join(reportsDir, "clippers-tiktok-mvp-readiness-verifier.json"),
  operationalReadiness: path.join(reportsDir, "clippers-operational-readiness.json"),
  goalAudit: path.join(reportsDir, "clippers-goal-completion-audit.json"),
  outJson: path.join(proofReportsDir, "autopilot-boundary.json"),
  outMarkdown: path.join(proofReportsDir, "autopilot-boundary.md"),
  outCsv: path.join(proofReportsDir, "autopilot-boundary.csv"),
};

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

async function readJson(filePath, fallback = {}) {
  const raw = await readFile(filePath, "utf8").catch(() => null);
  if (!raw) return fallback;
  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function csvCell(value) {
  return `"${String(value ?? "").replace(/"/g, '""')}"`;
}

function countValue(value) {
  if (Array.isArray(value)) return value.length;
  const numeric = Number(value || 0);
  return Number.isFinite(numeric) ? numeric : 0;
}

function proofMissing({ proofHandoff, proofDoctor, proofUnblocker, readinessVerifier, operationalReadiness }) {
  const missingByHandoff = countValue(proofHandoff?.totals?.minimumProofUrlsNeeded || proofHandoff?.unblockBoard?.minimumProofUrlsNeeded);
  const openFixes = countValue(proofUnblocker?.openFixes || proofUnblocker?.totals?.openFixes);
  const doctorFixQueue = countValue(proofDoctor?.fixQueue || proofDoctor?.totals?.fixQueue);
  const readinessFailed = readinessVerifier?.status === "fail";
  const opsBlocked = operationalReadiness?.status === "blocked";
  return missingByHandoff > 0 || openFixes > 0 || doctorFixQueue > 0 || readinessFailed || opsBlocked;
}

function refreshFailed(refreshRuns) {
  return Object.values(refreshRuns || {}).some((run) => !run?.ok);
}

function scopeIsTikTokOnly(readinessVerifier) {
  return readinessVerifier?.scope === "tiktok_only_metricool_mvp";
}

function buildDeliverables({ proofHandoff, localVerification, readinessVerifier, operationalReadiness }) {
  const commands = Array.isArray(localVerification?.commands) ? localVerification.commands : [];
  const commandsPass = commands.length > 0 && commands.every((row) => row.status === "pass");
  const collectionCsv = proofHandoff?.paths?.collectionCsv || path.join(proofReportsDir, "proof-handoff-collection-packets.csv");
  const oneScreen = proofHandoff?.paths?.oneScreenTxt || path.join(proofReportsDir, "proof-fill-one-screen.txt");
  const pastePacket = proofHandoff?.paths?.pastePacketTxt || path.join(proofReportsDir, "proof-links-paste-packet.txt");
  return [
    {
      id: "tiktok_only_metricool_scope",
      status: scopeIsTikTokOnly(readinessVerifier) ? "done" : "needs_review",
      evidence: paths.readinessVerifier,
      note: "Active MVP is TikTok-only through Metricool; Instagram, YouTube, and streamers stay deferred.",
    },
    {
      id: "no_direct_social_apis",
      status: operationalReadiness?.mvp?.directSocialApisRequired === false ? "done" : "needs_review",
      evidence: paths.operationalReadiness,
      note: "The current MVP does not require direct TikTok/social API keys.",
    },
    {
      id: "approval_required_guardrail",
      status: operationalReadiness?.mvp?.launchMode === "metricool_approval_required" ? "done" : "needs_review",
      evidence: paths.operationalReadiness,
      note: "Metricool remains approval_required and no automatic publishing is enabled.",
    },
    {
      id: "proof_collection_packets",
      status: proofHandoff?.paths?.collectionCsv || proofHandoff?.paths?.oneScreenTxt ? "done" : "needs_review",
      evidence: collectionCsv,
      note: "Operator proof packets exist for SPORT and memes TikTok Metricool connection/ownership evidence.",
    },
    {
      id: "one_screen_operator_packet",
      status: proofHandoff?.paths?.oneScreenTxt ? "done" : "needs_review",
      evidence: oneScreen,
      note: "A one-screen fill guide exists with the exact proof lines Robert/operator must fill.",
    },
    {
      id: "paste_packet",
      status: proofHandoff?.paths?.pastePacketTxt ? "done" : "needs_review",
      evidence: pastePacket,
      note: "Proof links paste packet exists and keeps unsafe proof material out.",
    },
    {
      id: "local_verification_commands",
      status: commandsPass ? "done" : "blocked_or_not_run",
      evidence: paths.localVerification,
      note: commandsPass ? `${commands.length} local verification commands passed.` : "Local verification must pass before launch review.",
    },
  ];
}

function buildExternalActions({ proofHandoff, proofUnblocker, readinessVerifier }) {
  const boardRows = Array.isArray(proofHandoff?.unblockBoard?.rows) ? proofHandoff.unblockBoard.rows : [];
  const fallbackRows = Array.isArray(proofUnblocker?.rows) ? proofUnblocker.rows : [];
  const rows = boardRows.length ? boardRows : fallbackRows;
  if (!rows.length) {
    return [{
      id: "operator_final_review",
      owner: "Robert/operator",
      status: "waiting_manual_confirmation",
      action: "Manually confirm all imported proof URLs are real, non-secret, and show the correct SPORT/memes TikTok Metricool connections before any guarded apply.",
      evidenceNeeded: "Manual review confirmation; no credentials or private screenshots.",
    }];
  }
  return rows.map((row, index) => ({
    id: row.id || `proof-${index + 1}`,
    owner: "Robert/operator",
    status: "needs_real_external_proof",
    lane: row.lane || "",
    field: row.field || "proof",
    action: row.operatorAction || readinessVerifier?.nextStep || "Paste real non-secret proof and rerun the proof flow.",
    evidenceNeeded: row.proofUrlRule || "Real HTTPS Metricool URL or concrete Drive file/folder/Docs proof URL; no secrets, signed URLs, passwords, tokens, cookies, or recovery codes.",
    exactPasteLine: row.exactPasteLine || "",
  }));
}

function renderMarkdown(summary) {
  return [
    "# TikTok MVP Autopilot Boundary",
    "",
    `Generated: ${summary.generatedAt}`,
    `Status: ${summary.status}`,
    `Launch decision: ${summary.launchDecision}`,
    "",
    "This report separates work Codex can complete from external account/proof work that must be performed by Robert/operator. It prevents authorization from being treated as proof.",
    "",
    "## Completed / Prepared By Codex",
    "",
    ...summary.codexDeliverables.map((item) => [
      `### ${item.id}`,
      `- Status: ${item.status}`,
      `- Evidence: ${item.evidence}`,
      `- Note: ${item.note}`,
      "",
    ].join("\n")),
    "## External Actions Required",
    "",
    ...summary.externalActionsRequired.map((item) => [
      `### ${item.id}`,
      `- Owner: ${item.owner}`,
      `- Status: ${item.status}`,
      item.lane ? `- Lane: ${item.lane}` : "",
      item.field ? `- Field: ${item.field}` : "",
      item.exactPasteLine ? `- Paste line: \`${item.exactPasteLine}\`` : "",
      `- Action: ${item.action}`,
      `- Evidence needed: ${item.evidenceNeeded}`,
      "",
    ].filter(Boolean).join("\n")),
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

function renderCsv(summary) {
  const header = ["kind", "id", "status", "owner", "evidence_or_action", "note"];
  const deliverables = summary.codexDeliverables.map((item) => [
    "codex_deliverable",
    item.id,
    item.status,
    "Codex",
    item.evidence,
    item.note,
  ]);
  const external = summary.externalActionsRequired.map((item) => [
    "external_action",
    item.id,
    item.status,
    item.owner,
    item.action,
    item.evidenceNeeded,
  ]);
  return [
    header.map(csvCell).join(","),
    ...[...deliverables, ...external].map((row) => row.map(csvCell).join(",")),
    "",
  ].join("\n");
}

async function main() {
  await mkdir(proofReportsDir, { recursive: true });
  const refreshRuns = {
    proofHandoff: runJson(["script/clippers-tiktok-mvp-proof-handoff.mjs"]),
    readinessVerifier: runJson(["script/clippers-tiktok-mvp-readiness-verifier.mjs"]),
    operationalReadiness: runJson(["script/clippers-operational-readiness.mjs"]),
  };
  const [proofHandoff, proofDoctor, proofUnblocker, localVerification, readinessVerifier, operationalReadiness, goalAudit] = await Promise.all([
    readJson(paths.proofHandoff),
    readJson(paths.proofDoctor),
    readJson(paths.proofUnblocker),
    readJson(paths.localVerification),
    readJson(paths.readinessVerifier),
    readJson(paths.operationalReadiness),
    readJson(paths.goalAudit),
  ]);
  const refreshHasFailure = refreshFailed(refreshRuns);
  const missingProof = refreshHasFailure || proofMissing({ proofHandoff, proofDoctor, proofUnblocker, readinessVerifier, operationalReadiness });
  const codexDeliverables = buildDeliverables({ proofHandoff, localVerification, readinessVerifier, operationalReadiness });
  const externalActionsRequired = buildExternalActions({ proofHandoff, proofUnblocker, readinessVerifier });
  const codexReady = codexDeliverables.every((item) => item.status === "done");
  const status = missingProof
    ? "blocked_external_account_proof"
    : codexReady
      ? "ready_for_operator_apply_review"
      : "needs_internal_followup";
  const launchDecision = status === "ready_for_operator_apply_review"
    ? "ready_for_metricool_approval_review"
    : status === "needs_internal_followup"
      ? "blocked_internal_followup"
      : "blocked_before_metricool";
  const summary = {
    status,
    launchDecision,
    generatedAt: new Date().toISOString(),
    scope: "tiktok_only_metricool_mvp",
    launchMode: "metricool_approval_required",
    directSocialApisRequired: false,
    realPublishEnabled: false,
    codexCanCreateExternalAccounts: false,
    codexCanInventPermissions: false,
    codexDeliverables,
    externalActionsRequired,
    totals: {
      codexDeliverables: codexDeliverables.length,
      codexDeliverablesDone: codexDeliverables.filter((item) => item.status === "done").length,
      externalActionsRequired: externalActionsRequired.length,
      minimumProofUrlsNeeded: countValue(proofHandoff?.totals?.minimumProofUrlsNeeded || proofHandoff?.unblockBoard?.minimumProofUrlsNeeded),
      openProofFixes: countValue(proofUnblocker?.openFixes || proofUnblocker?.totals?.openFixes),
      refreshFailures: Object.values(refreshRuns).filter((run) => !run?.ok).length,
    },
    sourceReports: {
      proofHandoff: paths.proofHandoff,
      proofDoctor: paths.proofDoctor,
      proofUnblocker: paths.proofUnblocker,
      localVerification: paths.localVerification,
      readinessVerifier: paths.readinessVerifier,
      operationalReadiness: paths.operationalReadiness,
      goalAudit: paths.goalAudit,
    },
    refreshRuns,
    guardrails: [
      "Authorization from Robert is not treated as account ownership, Metricool connection, creator permission, or rights proof.",
      "Codex does not create external TikTok/Metricool accounts without operator login/session confirmation.",
      "Codex does not paste, store, or request passwords, API keys, tokens, cookies, recovery codes, signed URLs, or private screenshots.",
      "Metricool remains approval_required; this report never publishes or schedules posts.",
      "The system can validate proof shape and lane identity, but Robert/operator must confirm proof content is real and non-secret.",
    ],
    nextStep: missingProof
      ? "Paste the real SPORT and memes TikTok Metricool proof URLs into the proof-links flow, then rerun this boundary report and the readiness verifier."
      : codexReady
        ? "Run the guarded apply/review flow only after manual proof-content confirmation; keep Metricool approval_required."
        : "Fix the listed internal deliverables, rerun local verification, then rerun this boundary report.",
    paths: {
      json: paths.outJson,
      markdown: paths.outMarkdown,
      csv: paths.outCsv,
    },
  };

  await writeFile(paths.outJson, JSON.stringify(summary, null, 2));
  await writeFile(paths.outMarkdown, renderMarkdown(summary));
  await writeFile(paths.outCsv, renderCsv(summary));
  console.log(JSON.stringify({
    status: summary.status,
    launchDecision: summary.launchDecision,
    codexDeliverablesDone: summary.totals.codexDeliverablesDone,
    codexDeliverables: summary.totals.codexDeliverables,
    externalActionsRequired: summary.totals.externalActionsRequired,
    minimumProofUrlsNeeded: summary.totals.minimumProofUrlsNeeded,
    openProofFixes: summary.totals.openProofFixes,
    reportJsonPath: paths.outJson,
    nextStep: summary.nextStep,
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
