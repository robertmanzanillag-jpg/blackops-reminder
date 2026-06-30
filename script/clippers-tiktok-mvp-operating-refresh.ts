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
    Number(boundary?.totals?.minimumProofUrlsNeeded || 0) > 0 ? `${boundary.totals.minimumProofUrlsNeeded} real Metricool/Drive proof URL(s) still needed.` : "",
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
  } finally {
    await restoreFiles(queueSnapshot);
  }

  const blockers = collectBoundaryBlockers(boundaryRun, boundary);

  const weeklyTotals = weeklyFunnelRun.weeklyProductionFunnel?.totals || {};
  const summary = {
    status: statusFromBlockers(blockers),
    launchDecision: blockers.length ? "blocked_before_metricool" : "ready_for_metricool_approval_review",
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
    nextStep: blockers.length
      ? "Paste the real SPORT and memes TikTok Metricool proof URLs, then rerun operating refresh and the readiness verifier."
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
