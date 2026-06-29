import "../server/env-loader";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { buildMetricoolMcpClientConfig, getMetricoolConfigStatus, getMetricoolTrackingPlan } from "../server/metricool-tracking";

const rootDir = path.join(process.cwd(), "clippers_workspace");
const reportsDir = path.join(rootDir, "reports");
const verifierPath = path.join(reportsDir, "clippers-tiktok-mvp-readiness-verifier.json");
const launchControlPath = path.join(reportsDir, "clippers-tiktok-launch-control.json");
const outJsonPath = path.join(reportsDir, "clippers-metricool-mcp-preflight.json");
const outMarkdownPath = path.join(reportsDir, "clippers-metricool-mcp-preflight.md");
const outCsvPath = path.join(reportsDir, "clippers-metricool-mcp-preflight.csv");

type CheckStatus = "pass" | "fail" | "warn";

function csvCell(value: unknown): string {
  return `"${String(value ?? "").replace(/"/g, '""')}"`;
}

async function readJson(filePath: string, fallback: any = {}) {
  const raw = await readFile(filePath, "utf8").catch(() => null);
  if (!raw) return fallback;
  return JSON.parse(raw);
}

function check(id: string, label: string, status: CheckStatus, evidence: string, nextAction: string) {
  return { id, label, status, evidence, nextAction };
}

function renderMarkdown(summary: any) {
  return [
    "# Clippers Metricool MCP Preflight",
    "",
    `Status: ${summary.status}`,
    `Generated: ${summary.generatedAt}`,
    `Next step: ${summary.nextStep}`,
    "",
    "This report checks whether the TikTok MVP can proceed through the Metricool operator workflow while keeping automatic posting disabled. Metricool MCP credentials are optional unless API automation is explicitly enabled.",
    "",
    "## Mode",
    "",
    `- Active scope: ${summary.active.scope}`,
    `- Active platforms: ${summary.active.platforms.join(", ")}`,
    `- Active accounts: ${summary.active.accounts.join(", ")}`,
    `- Active Metricool brands: ${summary.active.metricoolBrands.join(", ")}`,
    `- Current batch: ${summary.active.currentBatchId}`,
    `- Current batch evidence CSV: ${summary.paths.currentBatchEvidenceCsv}`,
    "",
    "## Credential Status",
    "",
    `- METRICOOL_USER_TOKEN configured: ${summary.metricoolConfig.userTokenConfigured}`,
    `- METRICOOL_USER_ID configured: ${summary.metricoolConfig.userIdConfigured}`,
    `- MCP URL: ${summary.metricoolConfig.mcpUrl}`,
    `- Ready for MCP config: ${summary.metricoolConfig.readyForMcp}`,
    "",
    "## Checks",
    "",
    ...summary.checks.map((row: any) => [
      `### ${row.label}`,
      `- Status: ${row.status}`,
      `- Evidence: ${row.evidence}`,
      `- Next: ${row.nextAction}`,
      "",
    ].join("\n")),
    "## Guardrails",
    "",
    ...summary.guardrails.map((item: string) => `- ${item}`),
    "",
  ].join("\n");
}

function renderCsv(summary: any) {
  const header = ["check_id", "label", "status", "evidence", "next_action"];
  return [
    header.map(csvCell).join(","),
    ...summary.checks.map((row: any) => [
      row.id,
      row.label,
      row.status,
      row.evidence,
      row.nextAction,
    ].map(csvCell).join(",")),
  ].join("\n") + "\n";
}

async function main() {
  await mkdir(reportsDir, { recursive: true });
  const metricoolConfig = getMetricoolConfigStatus();
  const metricoolPlan = getMetricoolTrackingPlan();
  const mcpClientConfigTemplate = buildMetricoolMcpClientConfig();
  const verifier = await readJson(verifierPath);
  const launchControl = await readJson(launchControlPath);
  const clippersBrands = metricoolPlan.brands
    .filter((brand) => brand.ownerAgent === "Clippers" && ["sports-daily", "meme-radar"].includes(brand.id))
    .map((brand) => ({
      id: brand.id,
      name: brand.name,
      status: brand.status,
      networks: brand.networks,
      tiktokReady: brand.status === "ready_to_connect" && brand.networks.includes("tiktok"),
    }));
  const activeAccounts = verifier.active?.accounts || [];
  const activeBrands = verifier.active?.metricoolBrands || [];
  const currentBatchEvidenceCsv = verifier.paths?.currentBatchEvidenceCsv || "";

  const checks = [
    check(
      "metricool_credentials_present",
      "Metricool user token and user id are configured for optional MCP automation",
      metricoolConfig.readyForMcp ? "pass" : "warn",
      `userTokenConfigured=${metricoolConfig.userTokenConfigured}; userIdConfigured=${metricoolConfig.userIdConfigured}; missing=${metricoolConfig.missingEnv.join("|") || "none"}`,
      metricoolConfig.readyForMcp ? "No action needed for optional MCP automation." : "Optional only: add Metricool credentials through the secret manager if Robert later enables API/MCP automation.",
    ),
    check(
      "mcp_config_template_ready",
      "Metricool MCP client config can be generated without exposing secrets",
      metricoolConfig.readyForMcp && mcpClientConfigTemplate.mcpServers["mcp-metricool"].env.METRICOOL_USER_TOKEN === "<configured>" ? "pass" : "warn",
      `mcpUrl=${metricoolConfig.mcpUrl}; tokenMask=${mcpClientConfigTemplate.mcpServers["mcp-metricool"].env.METRICOOL_USER_TOKEN}; userIdMask=${mcpClientConfigTemplate.mcpServers["mcp-metricool"].env.METRICOOL_USER_ID}`,
      "Use the generated MCP client config template only if Metricool MCP/API automation is explicitly enabled.",
    ),
    check(
      "clippers_tiktok_brands_ready_in_plan",
      "Clippers SPORT and memes TikTok brands are present in the Metricool plan",
      clippersBrands.length === 2 && clippersBrands.every((brand) => brand.tiktokReady) ? "pass" : "fail",
      `brands=${clippersBrands.map((brand) => `${brand.id}:${brand.status}:${brand.networks.join("|")}`).join(";") || "none"}`,
      "Keep SPORT and memes as the only active Clippers TikTok brands for this MVP.",
    ),
    check(
      "tiktok_mvp_verifier_passed",
      "TikTok MVP verifier is passing",
      verifier.status === "pass" && verifier.launchDecision === "ready_for_metricool_operator" ? "pass" : "fail",
      `status=${verifier.status || "missing"}; launchDecision=${verifier.launchDecision || "missing"}; failed=${verifier.totals?.failed ?? "missing"}`,
      "Run TikTok verifier and fix blockers before touching Metricool.",
    ),
    check(
      "no_fake_publish_counts",
      "No fake published/importable rows are counted",
      Number(verifier.active?.readyToImport || 0) === 0
        && Number(verifier.active?.readyToSend || 0) === 0
        && Number(launchControl.totals?.readyToImport || 0) === 0
        ? "pass"
        : "fail",
      `verifierReadyToImport=${verifier.active?.readyToImport || 0}; verifierReadyToSend=${verifier.active?.readyToSend || 0}; launchReadyToImport=${launchControl.totals?.readyToImport || 0}`,
      "Keep readyToImport and readyToSend at zero until public TikTok URLs and 24h metrics exist.",
    ),
    check(
      "automatic_metricool_execution_not_enabled",
      "Automatic Metricool scheduling is not enabled from this app",
      "warn",
      "No callable Metricool MCP scheduling tool is required for the current TikTok MVP; the app remains approval/operator mode.",
      "Use the current Metricool operator workflow, or install/connect the Metricool MCP tool before attempting API scheduling.",
    ),
  ];

  const failed = checks.filter((row) => row.status === "fail").length;
  const warning = checks.filter((row) => row.status === "warn").length;
  const summary = {
    status: failed > 0 ? "blocked" : "ready_for_operator",
    generatedAt: new Date().toISOString(),
    mode: "metricool_operator_preflight_tiktok_only",
    metricoolConfig,
    metricoolPlan: {
      brandCount: metricoolPlan.brandCount,
      socialProfileCount: metricoolPlan.socialProfileCount,
      recommendedPlan: metricoolPlan.recommendedPlan,
      directPlatformApisNeeded: metricoolPlan.directPlatformApisNeeded,
      clippersBrands,
    },
    active: {
      scope: verifier.scope || "tiktok_only_metricool_mvp",
      platforms: verifier.active?.platforms || ["tiktok"],
      accounts: activeAccounts,
      metricoolBrands: activeBrands,
      currentBatchId: verifier.active?.currentBatchId || launchControl.currentBatch?.id || "",
      totalRows: Number(verifier.active?.totalRows || launchControl.totals?.rows || 0),
      readyToImport: Number(verifier.active?.readyToImport || launchControl.totals?.readyToImport || 0),
    },
    paths: {
      json: outJsonPath,
      markdown: outMarkdownPath,
      csv: outCsvPath,
      verifier: verifierPath,
      launchControl: launchControlPath,
      currentBatchEvidenceCsv,
      mcpClientConfigTemplate: "script/metricool-plan.ts",
    },
    checks,
    totals: {
      checks: checks.length,
      passed: checks.filter((row) => row.status === "pass").length,
      warnings: warning,
      failed,
    },
    guardrails: [
      "Credentials present are not proof that posts were scheduled.",
      "Do not print, store, or paste Metricool tokens into reports, CSVs, screenshots, or prompts.",
      "This preflight does not enable automatic publishing.",
      "Missing Metricool MCP/API credentials do not block the manual Metricool operator workflow.",
      "Continue with TikTok-only SPORT/memes until Robert explicitly expands networks.",
      "Current batch evidence CSV is the operator file; the master evidence CSV is sync output.",
    ],
    nextStep: failed > 0
      ? checks.find((row) => row.status === "fail")?.nextAction
      : "TikTok MVP operator checks are ready; process metricool-batch-01 manually in Metricool approval_required mode. Connect a callable Metricool MCP scheduling tool only before API automation.",
  };

  await writeFile(outJsonPath, JSON.stringify(summary, null, 2));
  await writeFile(outMarkdownPath, renderMarkdown(summary));
  await writeFile(outCsvPath, renderCsv(summary));
  console.log(JSON.stringify({
    status: summary.status,
    checks: summary.totals.checks,
    warnings: summary.totals.warnings,
    failed: summary.totals.failed,
    readyForMcp: metricoolConfig.readyForMcp,
    currentBatch: summary.active.currentBatchId,
    nextStep: summary.nextStep,
  }));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
