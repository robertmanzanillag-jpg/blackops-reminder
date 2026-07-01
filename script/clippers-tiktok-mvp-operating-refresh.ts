import { spawnSync } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  prepareClipperSourceScout,
  prepareClipperSourceScoutDailySprint,
  prepareClipperSourceScoutPermissionPack,
  prepareClipperSourceScoutSourceFileKit,
  prepareClipperWeeklyProductionFunnel,
} from "../server/clippers-agent";

const rootDir = path.join(process.cwd(), "clippers_workspace");
const reportsDir = path.join(rootDir, "reports", "tiktok-mvp-operating-refresh");
const outJsonPath = path.join(reportsDir, "operating-refresh.json");
const outMarkdownPath = path.join(reportsDir, "operating-refresh.md");
const preservedQueuePaths = [
  path.join(rootDir, "scheduled", "metricool-execution-queue.json"),
  path.join(rootDir, "scheduled", "metricool-execution-queue.md"),
  path.join(rootDir, "scheduled", "metricool-execution-queue.csv"),
];

function runJson(args: string[]) {
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

async function readJson(filePath: string, fallback: any = {}) {
  const raw = await readFile(filePath, "utf8").catch(() => null);
  if (!raw) return fallback;
  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

async function snapshotFiles(filePaths: string[]) {
  const entries = await Promise.all(filePaths.map(async (filePath) => ({
    filePath,
    raw: await readFile(filePath, "utf8").catch(() => null),
  })));
  return entries;
}

async function restoreFiles(snapshot: Array<{ filePath: string; raw: string | null }>) {
  await Promise.all(snapshot.map(async ({ filePath, raw }) => {
    if (raw === null) {
      await rm(filePath, { force: true }).catch(() => undefined);
      return;
    }
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, raw);
  }));
}

export function statusFromBlockers(blockers: string[]) {
  return blockers.length ? "blocked_external_account_proof" : "ready_for_metricool_approval_review";
}

export function statusFromBlockersAndProofGate(blockers: string[], proofGate: any) {
  return blockers.length || proofGate?.status !== "ready_for_operator_review"
    ? "blocked_external_account_proof"
    : "ready_for_metricool_approval_review";
}

export function collectBoundaryBlockers(boundaryRun: any, boundary: any) {
  const blockers = [
    boundaryRun?.ok ? "" : "Autopilot boundary refresh failed; rerun before operating.",
    !boundary?.status
      ? "Autopilot boundary status is missing; rerun before operating."
      : "",
    !boundary?.launchDecision
      ? "Autopilot boundary launch decision is missing; rerun before operating."
      : "",
    boundary?.status && boundary.status !== "ready_for_operator_apply_review"
      ? `Autopilot boundary is ${boundary.status}; operator review is not ready.`
      : "",
    boundary?.launchDecision && boundary.launchDecision !== "ready_for_metricool_approval_review"
      ? `Autopilot boundary launch decision is ${boundary.launchDecision}.`
      : "",
    boundary?.status === "blocked_external_account_proof" ? "SPORT and memes TikTok Metricool proof URLs are still missing." : "",
    Number(boundary?.totals?.minimumProofUrlsNeeded || 0) > 0 ? `${boundary.totals.minimumProofUrlsNeeded} real Metricool URLs or concrete Drive file/folder/Docs proof URLs still needed.` : "",
  ].filter(Boolean);
  return Array.from(new Set(blockers));
}

function renderMarkdown(summary: any) {
  return [
    "# TikTok MVP Operating Refresh",
    "",
    `Generated: ${summary.generatedAt}`,
    `Status: ${summary.status}`,
    `Launch decision: ${summary.launchDecision}`,
    "",
    "This refresh prepares internal Clippers operating artifacts for the TikTok-only Metricool MVP. It does not create external accounts, request permissions, apply evidence, schedule posts, publish, or enable direct social APIs.",
    "",
    "## Artifacts",
    "",
    `- Source Scout: ${summary.artifacts.sourceScoutStatus}`,
    `- Permission pack: ${summary.artifacts.permissionPackStatus}`,
    `- Source file kit: ${summary.artifacts.sourceFileKitStatus}`,
    `- Daily sprint: ${summary.artifacts.dailySprintStatus}`,
    `- Weekly funnel: ${summary.artifacts.weeklyFunnelStatus}`,
    `- Boundary: ${summary.artifacts.boundaryStatus}`,
    "",
    "## Totals",
    "",
    `- Source candidates: ${summary.totals.sourceCandidates}`,
    `- Source candidates blocked by rights: ${summary.totals.sourceCandidatesBlockedRights}`,
    `- Weekly target clips: ${summary.totals.weeklyTargetClips}`,
    `- Weekly source-ready assets: ${summary.totals.weeklySourceReadyAssets}`,
    `- Boundary deliverables: ${summary.totals.boundaryDeliverablesDone}/${summary.totals.boundaryDeliverables}`,
    `- External actions required: ${summary.totals.externalActionsRequired}`,
    `- Minimum proof URLs needed: ${summary.totals.minimumProofUrlsNeeded}`,
    "",
    "## Blockers",
    "",
    ...(summary.blockers.length ? summary.blockers.map((item: string) => `- ${item}`) : ["- none"]),
    "",
    "## Proof Gate",
    "",
    `- Status: ${summary.proofGate.status}`,
    `- Required lanes: ${summary.proofGate.requiredLanes.join(", ")}`,
    `- Minimum proof URLs needed: ${summary.proofGate.minimumProofUrlsNeeded}`,
    `- Next safe button: ${summary.proofGate.nextSafeButton}`,
    `- Proof links JSON: ${summary.proofGate.paths.proofLinksJson}`,
    `- Paste packet: ${summary.proofGate.paths.pastePacket}`,
    `- One-screen guide: ${summary.proofGate.paths.oneScreenGuide}`,
    "",
    "## Guardrails",
    "",
    ...summary.guardrails.map((item: string) => `- ${item}`),
    "",
    "## Next Step",
    "",
    summary.nextStep,
    "",
  ].join("\n");
}

export function buildProofGate({ proofHandoff, preflight, verifier, boundary, boundaryRun }: any) {
  const requiredLanes = ["sports-daily:tiktok", "meme-radar:tiktok"];
  const failedPreflightChecks = (preflight?.checks || [])
    .filter((row: any) => row.status === "fail")
    .map((row: any) => row.id)
    .filter(Boolean);
  const failedVerifierChecks = (verifier?.checks || [])
    .filter((row: any) => row.status === "fail")
    .map((row: any) => row.id)
    .filter(Boolean);
  const minimumProofUrlsNeeded = Number(
    proofHandoff?.totals?.minimumProofUrlsNeeded
    ?? boundary?.totals?.minimumProofUrlsNeeded
    ?? 0,
  );
  const missingRequiredReports = [
    !proofHandoff?.status ? "proof handoff report is missing or unreadable" : "",
    !verifier?.status || !Array.isArray(verifier?.checks) ? "TikTok MVP readiness verifier report is missing or unreadable" : "",
    !preflight?.status || !Array.isArray(preflight?.checks) ? "Metricool MCP preflight report is missing or unreadable" : "",
    !boundary?.status || !boundary?.launchDecision ? "autopilot boundary report is missing or incomplete" : "",
  ].filter(Boolean);
  const boundaryNotReady = [
    boundaryRun?.ok === false ? "Autopilot boundary refresh failed" : "",
    boundary?.status && boundary.status !== "ready_for_operator_apply_review" ? `Autopilot boundary status is ${boundary.status}` : "",
    boundary?.launchDecision && boundary.launchDecision !== "ready_for_metricool_approval_review" ? `Autopilot boundary launch decision is ${boundary.launchDecision}` : "",
  ].filter(Boolean);
  const preflightNotReady = preflight?.status && !["ready", "pass"].includes(preflight.status)
    ? `Metricool MCP preflight snapshot status is ${preflight.status}`
    : "";
  const proofHandoffBlocked = proofHandoff?.status && proofHandoff.status !== "ready_for_operator_review";
  const preflightSnapshotBlocked = failedPreflightChecks.length > 0;
  const status = missingRequiredReports.length
    || boundaryNotReady.length
    || preflightNotReady
    || minimumProofUrlsNeeded > 0
    || proofHandoffBlocked
    || failedVerifierChecks.length > 0
    || preflightSnapshotBlocked
    ? "blocked_needs_real_metricool_tiktok_proof"
    : "ready_for_operator_review";
  return {
    status,
    requiredLanes,
    minimumProofUrlsNeeded,
    proofPacketsNeeded: Number(proofHandoff?.totals?.proofPacketsNeeded || 0),
    fastPathAvailable: Boolean(proofHandoff?.totals?.fastPathAvailable),
    nextSafeButton: status === "ready_for_operator_review" ? "operator_review" : "preview_proof_links",
    nextLockedButton: status === "ready_for_operator_review" ? "metricool_approval_review" : "save_proof_links",
    failedPreflightChecks,
    failedVerifierChecks,
    missingRequiredReports,
    boundaryNotReady,
    preflightNotReady,
    blockedBy: [
      ...missingRequiredReports,
      ...boundaryNotReady,
      preflightNotReady,
      minimumProofUrlsNeeded > 0 ? `${minimumProofUrlsNeeded} real non-secret Metricool URLs or concrete Drive file/folder/Docs proof URLs needed` : "",
      proofHandoffBlocked ? `Proof handoff status is ${proofHandoff.status}` : "",
      ...failedVerifierChecks.map((id: string) => `TikTok MVP verifier check failed: ${id}`),
      ...failedPreflightChecks.map((id: string) => `Metricool MCP preflight snapshot check failed: ${id}`),
    ].filter(Boolean),
    paths: {
      proofLinksJson: "clippers_workspace/proof-drop/tiktok-mvp/proof-links.json",
      proofLinksStarterJson: proofHandoff?.paths?.jsonStarter || "",
      pastePacket: proofHandoff?.paths?.pastePacketTxt || "",
      oneScreenGuide: proofHandoff?.paths?.oneScreenTxt || "",
      proofHandoff: proofHandoff?.paths?.json || "",
      preflight: preflight?.paths?.json || "",
      verifier: verifier?.paths?.json || "",
      bridgeEvidenceCsv: "clippers_workspace/scheduled/metricool-tiktok-bridge-evidence.csv",
    },
    guardrails: [
      "Metricool keys/MCP readiness do not satisfy this proof gate.",
      "Missing or stale safety reports fail closed instead of unlocking operator review.",
      "Starter JSON with empty URLs remains blocked until real proof URLs are previewed and saved.",
      "Do not use passwords, tokens, cookies, recovery codes, signed URLs, or private screenshots as proof.",
      "This proof gate does not apply evidence, schedule posts, publish, or enable real publishing.",
    ],
    nextStep: status === "ready_for_operator_review"
      ? "Run operator review with Metricool approval_required; do not enable real publishing."
      : "Fill SPORT and memes proof links with real non-secret Metricool or concrete Drive file/folder/Docs evidence. Preview links first; save only if the preview gate is clean/current.",
  };
}

async function main() {
  await mkdir(reportsDir, { recursive: true });
  const queueSnapshot = await snapshotFiles(preservedQueuePaths);

  let sourceScoutRun: Awaited<ReturnType<typeof prepareClipperSourceScout>>;
  let permissionPackRun: Awaited<ReturnType<typeof prepareClipperSourceScoutPermissionPack>>;
  let sourceFileKitRun: Awaited<ReturnType<typeof prepareClipperSourceScoutSourceFileKit>>;
  let dailySprintRun: Awaited<ReturnType<typeof prepareClipperSourceScoutDailySprint>>;
  let weeklyFunnelRun: Awaited<ReturnType<typeof prepareClipperWeeklyProductionFunnel>>;
  let boundaryRun: ReturnType<typeof runJson>;
  let boundary: any;
  let proofHandoff: any;
  let preflight: any;
  let verifier: any;
  try {
    sourceScoutRun = await prepareClipperSourceScout();
    await restoreFiles(queueSnapshot);
    permissionPackRun = await prepareClipperSourceScoutPermissionPack();
    sourceFileKitRun = await prepareClipperSourceScoutSourceFileKit();
    dailySprintRun = await prepareClipperSourceScoutDailySprint();
    await restoreFiles(queueSnapshot);
    weeklyFunnelRun = await prepareClipperWeeklyProductionFunnel();
    await restoreFiles(queueSnapshot);
    boundaryRun = runJson(["script/clippers-tiktok-mvp-autopilot-boundary.mjs"]);
    boundary = await readJson(path.join(rootDir, "reports", "tiktok-mvp-proof-intake", "autopilot-boundary.json"), {});
    proofHandoff = await readJson(path.join(rootDir, "reports", "tiktok-mvp-proof-intake", "proof-handoff.json"), {});
    preflight = await readJson(path.join(rootDir, "reports", "clippers-metricool-mcp-preflight.json"), {});
    verifier = await readJson(path.join(rootDir, "reports", "clippers-tiktok-mvp-readiness-verifier.json"), {});
  } finally {
    await restoreFiles(queueSnapshot);
  }

  const blockers = collectBoundaryBlockers(boundaryRun, boundary);
  const proofGate = buildProofGate({ proofHandoff, preflight, verifier, boundary, boundaryRun });

  const weeklyTotals = weeklyFunnelRun.weeklyProductionFunnel?.totals || {};
  const summary = {
    status: statusFromBlockersAndProofGate(blockers, proofGate),
    launchDecision: blockers.length || proofGate.status !== "ready_for_operator_review" ? "blocked_before_metricool" : "ready_for_metricool_approval_review",
    generatedAt: new Date().toISOString(),
    scope: "tiktok_only_metricool_mvp",
    launchMode: "metricool_approval_required",
    directSocialApisRequired: false,
    realPublishEnabled: false,
    codexCanCreateExternalAccounts: false,
    codexCanInventPermissions: false,
    artifacts: {
      sourceScoutStatus: sourceScoutRun.sourceScout.status,
      sourceScoutManifest: sourceScoutRun.sourceScout.manifestPath,
      permissionPackStatus: permissionPackRun.sourceScoutPermissionPack.status,
      permissionPackManifest: permissionPackRun.sourceScoutPermissionPack.manifestPath,
      sourceFileKitStatus: sourceFileKitRun.sourceScoutSourceFileKit.status,
      sourceFileKitManifest: sourceFileKitRun.sourceScoutSourceFileKit.manifestPath,
      dailySprintStatus: dailySprintRun.sourceScoutDailySprint.status,
      dailySprintManifest: dailySprintRun.sourceScoutDailySprint.manifestPath,
      weeklyFunnelStatus: weeklyFunnelRun.weeklyProductionFunnel.status,
      weeklyFunnelManifest: weeklyFunnelRun.weeklyProductionFunnel.manifestPath,
      boundaryStatus: boundary?.status || "missing",
      boundaryManifest: boundary?.paths?.json || "",
    },
    totals: {
      sourceCandidates: Number(sourceScoutRun.sourceScout.totals?.candidates || 0),
      sourceCandidatesBlockedRights: Number(sourceScoutRun.sourceScout.totals?.blockedRights || 0),
      sourceCandidatesExactUrls: Number(sourceScoutRun.sourceScout.totals?.exactUrls || 0),
      sourceCandidatesMetricoolFit: Number(sourceScoutRun.sourceScout.totals?.metricoolFit || 0),
      weeklyTargetClips: Number(weeklyFunnelRun.weeklyProductionFunnel.targetWeeklyClips || 100),
      weeklySourceReadyAssets: Number(weeklyTotals.sourceFilesReady || weeklyTotals.draftReady || 0),
      weeklyMetricoolApprovalQueued: Number(weeklyTotals.metricoolApprovalQueued || 0),
      boundaryDeliverables: Number(boundary?.totals?.codexDeliverables || 0),
      boundaryDeliverablesDone: Number(boundary?.totals?.codexDeliverablesDone || 0),
      externalActionsRequired: Number(boundary?.totals?.externalActionsRequired || 0),
      minimumProofUrlsNeeded: Number(boundary?.totals?.minimumProofUrlsNeeded || 0),
    },
    proofGate,
    blockers,
    guardrails: [
      "Operating refresh does not create external TikTok or Metricool accounts.",
      "Operating refresh does not invent account ownership, Metricool connection, creator permission, or rights proof.",
      "Operating refresh does not apply evidence, schedule posts, publish, or enable real publishing.",
      "Operating refresh preserves the existing Metricool execution queue while refreshing scout/funnel reports.",
      "Metricool remains approval_required and direct social APIs remain unnecessary for this MVP.",
      "Source Scout candidates remain rights-gated; discovery/search URLs are not treated as publish-ready exact videos.",
    ],
    runs: {
      boundaryRun,
    },
    nextStep: blockers.length || proofGate.status !== "ready_for_operator_review"
      ? proofGate.nextStep
      : "Review the Metricool approval queue manually; keep approval_required until Robert explicitly enables real publishing.",
    paths: {
      json: outJsonPath,
      markdown: outMarkdownPath,
      sourceScout: sourceScoutRun.sourceScout.manifestPath,
      weeklyFunnel: weeklyFunnelRun.weeklyProductionFunnel.manifestPath,
      boundary: boundary?.paths?.json || "",
    },
  };

  await writeFile(outJsonPath, JSON.stringify(summary, null, 2));
  await writeFile(outMarkdownPath, renderMarkdown(summary));
  console.log(JSON.stringify({
    status: summary.status,
    launchDecision: summary.launchDecision,
    sourceCandidates: summary.totals.sourceCandidates,
    weeklyTargetClips: summary.totals.weeklyTargetClips,
    boundaryDeliverablesDone: summary.totals.boundaryDeliverablesDone,
    boundaryDeliverables: summary.totals.boundaryDeliverables,
    externalActionsRequired: summary.totals.externalActionsRequired,
    minimumProofUrlsNeeded: summary.totals.minimumProofUrlsNeeded,
    reportJsonPath: outJsonPath,
    nextStep: summary.nextStep,
  }, null, 2));
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
