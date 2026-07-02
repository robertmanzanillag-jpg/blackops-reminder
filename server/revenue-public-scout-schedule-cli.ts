import type { RevenuePublicScoutScheduleInput } from "./revenue-engine";
import { existsSync, lstatSync, realpathSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildRevenuePublicScoutSchedule, revenuePublicScoutScheduleSchema } from "./revenue-engine";

export type RevenuePublicScoutScheduleCliOptions = {
  scheduleName: string;
  area: string;
  niche: string;
  offerFocus: "websites" | "automations" | "both";
  dailyResearchTarget: number;
  dailyQualifiedLeadLimit: number;
  dailyMockupLimit: number;
  startDate: string;
  runDays: number;
  runsPerDay: number;
  runHourLocal: number;
  browserExecutor: "manual_browser" | "subagent_browser";
  maxCandidatesPerRun: number;
  timezone: string;
  outputPath: string;
  overwrite: boolean;
  json: boolean;
  invalidNumericArgs: string[];
};

type OutputPathChecks = {
  exists: (path: string) => boolean;
  lstat: (path: string) => { isFile: () => boolean; isSymbolicLink: () => boolean };
  realpath: (path: string) => string;
};

const nodeOutputPathChecks: OutputPathChecks = {
  exists: existsSync,
  lstat: lstatSync,
  realpath: realpathSync,
};

export function parseRevenuePublicScoutScheduleArgs(argv: string[]): RevenuePublicScoutScheduleCliOptions {
  const getValue = (name: string) => {
    const prefix = `${name}=`;
    const arg = argv.find((value) => value.startsWith(prefix));
    return arg ? arg.slice(prefix.length).trim() : "";
  };
  const invalidNumericArgs: string[] = [];
  const numberValue = (name: string, fallback: number) => {
    const rawValue = getValue(name);
    if (!rawValue) return fallback;
    const value = Number(rawValue);
    if (Number.isFinite(value)) return value;
    invalidNumericArgs.push(name);
    return Number.NaN;
  };

  return {
    scheduleName: getValue("--schedule-name") || "Daily public scout",
    area: getValue("--area") || "Miami",
    niche: getValue("--niche") || "med spas",
    offerFocus: (getValue("--offer-focus") || "both") as RevenuePublicScoutScheduleCliOptions["offerFocus"],
    dailyResearchTarget: numberValue("--daily-research-target", 30),
    dailyQualifiedLeadLimit: numberValue("--daily-qualified-lead-limit", 8),
    dailyMockupLimit: numberValue("--daily-mockup-limit", 3),
    startDate: getValue("--start-date") || "2026-07-01",
    runDays: numberValue("--run-days", 5),
    runsPerDay: numberValue("--runs-per-day", 1),
    runHourLocal: numberValue("--run-hour-local", 9),
    browserExecutor: (getValue("--browser-executor") || "subagent_browser") as RevenuePublicScoutScheduleCliOptions["browserExecutor"],
    maxCandidatesPerRun: numberValue("--max-candidates-per-run", 8),
    timezone: getValue("--timezone") || "America/New_York",
    outputPath: getValue("--output"),
    overwrite: argv.includes("--overwrite"),
    json: argv.includes("--json"),
    invalidNumericArgs,
  };
}

function hasSensitiveOutputPath(value: string) {
  const segments = value.split(/[\\/]+/).map((segment) => segment.trim().toLowerCase()).filter(Boolean);
  return segments.some((segment) =>
    segment.startsWith(".env")
    || segment.startsWith("credentials")
    || segment.startsWith("secrets")
    || [".git", ".ssh", "node_modules"].includes(segment)
  );
}

function isPathInside(child: string, parent: string) {
  const relative = path.relative(parent, child);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function hasSymlinkAncestor(base: string, targetParent: string, checks: OutputPathChecks) {
  if (!isPathInside(targetParent, base)) return false;
  let current = base;
  const relative = path.relative(base, targetParent);
  const parts = relative ? relative.split(path.sep).filter(Boolean) : [];
  for (const part of parts) {
    current = path.join(current, part);
    if (checks.exists(current) && checks.lstat(current).isSymbolicLink()) return true;
  }
  return false;
}

function allowedOutputRoots(checks: OutputPathChecks) {
  const roots = [
    path.resolve(process.cwd(), "revenue_workspace/public-scout"),
    path.resolve(os.tmpdir()),
    "/tmp",
  ];
  return roots.map((root) => checks.exists(root) ? checks.realpath(root) : root);
}

function validateOutputPath(value: string, overwrite: boolean, checks: OutputPathChecks) {
  const errors: string[] = [];
  const resolved = path.resolve(value);
  const parent = path.dirname(resolved);
  const workspaceOutputDir = path.resolve(process.cwd(), "revenue_workspace/public-scout");

  if (!checks.exists(parent)) {
    errors.push("--output parent directory must exist.");
    return errors;
  }

  const parentStats = checks.lstat(parent);
  const allowedSymlinkParents = new Set(["/tmp", path.resolve(os.tmpdir())]);
  if (parentStats.isSymbolicLink() && !allowedSymlinkParents.has(parent)) {
    errors.push("--output parent directory cannot be a symlink.");
    return errors;
  }
  if (isPathInside(resolved, workspaceOutputDir)) {
    if (checks.exists(workspaceOutputDir) && checks.lstat(workspaceOutputDir).isSymbolicLink()) {
      errors.push("--output workspace directory cannot be a symlink.");
      return errors;
    }
    if (hasSymlinkAncestor(workspaceOutputDir, parent, checks)) {
      errors.push("--output workspace path cannot include symlink directories.");
      return errors;
    }
  }

  const realParent = checks.realpath(parent);
  if (!allowedOutputRoots(checks).some((root) => isPathInside(realParent, root))) {
    errors.push("--output must be inside revenue_workspace/public-scout or the system temp directory.");
  }

  if (checks.exists(resolved)) {
    const outputStats = checks.lstat(resolved);
    if (outputStats.isSymbolicLink()) errors.push("--output cannot be a symlink.");
    if (!outputStats.isFile()) errors.push("--output must be a regular file when it already exists.");
    if (!overwrite) errors.push("--output already exists; pass --overwrite to replace it.");
  }

  return errors;
}

export function buildRevenuePublicScoutScheduleInput(options: RevenuePublicScoutScheduleCliOptions): RevenuePublicScoutScheduleInput {
  return {
    scheduleName: options.scheduleName,
    area: options.area,
    niche: options.niche,
    offerFocus: options.offerFocus,
    dailyResearchTarget: options.dailyResearchTarget,
    dailyQualifiedLeadLimit: options.dailyQualifiedLeadLimit,
    dailyMockupLimit: options.dailyMockupLimit,
    startDate: options.startDate,
    runDays: options.runDays,
    runsPerDay: options.runsPerDay,
    runHourLocal: options.runHourLocal,
    browserExecutor: options.browserExecutor,
    maxCandidatesPerRun: options.maxCandidatesPerRun,
    timezone: options.timezone,
  };
}

export function validateRevenuePublicScoutScheduleOptions(
  options: RevenuePublicScoutScheduleCliOptions,
  checks: OutputPathChecks = nodeOutputPathChecks,
) {
  const errors: string[] = [];
  if (options.invalidNumericArgs.length) {
    errors.push(...options.invalidNumericArgs.map((name) => `${name} must be a valid number.`));
  }
  const parsed = revenuePublicScoutScheduleSchema.safeParse(buildRevenuePublicScoutScheduleInput(options));
  if (!parsed.success) {
    errors.push(...parsed.error.errors.map((error) => `${error.path.join(".") || "input"}: ${error.message}`));
  }
  if (options.outputPath && hasSensitiveOutputPath(options.outputPath)) {
    errors.push("--output cannot point to .env, credentials, secrets, .ssh, .git or node_modules paths.");
  }
  if (options.outputPath) {
    errors.push(...validateOutputPath(options.outputPath, options.overwrite, checks));
  }
  return errors;
}

export function buildRevenuePublicScoutScheduleCli(options: RevenuePublicScoutScheduleCliOptions) {
  return buildRevenuePublicScoutSchedule(buildRevenuePublicScoutScheduleInput(options));
}

export function formatRevenuePublicScoutScheduleText(schedule: ReturnType<typeof buildRevenuePublicScoutScheduleCli>, outputPath: string) {
  const firstRun = schedule.runs[0];
  return [
    `Revenue public scout schedule: ${schedule.status}`,
    `Schedule: ${schedule.scheduleName}`,
    `Runs: ${schedule.runCount}`,
    `Timezone: ${schedule.timezone}`,
    `Output: ${outputPath || "stdout"}`,
    firstRun ? `First run: ${firstRun.id} ${firstRun.date} ${firstRun.localTime}` : "First run: none",
    "",
    "First run structured commands:",
    firstRun ? `- Browser session: ${firstRun.commands.prepareBrowserSession.command} ${JSON.stringify(firstRun.commands.prepareBrowserSession.args)}` : "- Browser session: none",
    firstRun ? `- Extract candidates: ${firstRun.commands.extractCandidates.command} ${JSON.stringify(firstRun.commands.extractCandidates.args)}` : "- Extract candidates: none",
    firstRun ? `- Capture for review: ${firstRun.commands.captureForReview.command} ${JSON.stringify(firstRun.commands.captureForReview.args)}` : "- Capture for review: none",
    "",
    "Safety:",
    `- Runs browser automatically: ${schedule.safety.runsBrowserAutomatically ? "yes" : "no"}`,
    `- Paid data spend: $${schedule.safety.paidDataSpendUsd}`,
    `- Persists final leads: ${schedule.safety.persistsLeads ? "yes" : "no"}`,
    `- Sends outreach: ${schedule.safety.sendsOutreach ? "yes" : "no"}`,
    `- Writes preview files: ${schedule.safety.writesPreviewFiles ? "yes" : "no"}`,
    `- Requires Robert review: ${schedule.safety.requiresRobertReview ? "yes" : "no"}`,
  ].join("\n");
}
