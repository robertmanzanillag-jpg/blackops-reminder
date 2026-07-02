import { existsSync, lstatSync, realpathSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { RevenuePublicScoutRunInput } from "./revenue-engine";
import { recordRevenuePublicScoutRun } from "./revenue-engine";
import {
  buildRevenuePublicScoutExtract,
  formatRevenuePublicScoutExtractText,
  type RevenuePublicScoutExtractCliOptions,
} from "./revenue-public-scout-extract-cli";

export type RevenuePublicScoutExecuteCliOptions = {
  schedulePath: string;
  runId: string;
  notesPath: string;
  writeExtracted: boolean;
  json: boolean;
};

type PublicScoutScheduleRun = {
  id: string;
  executor: "manual_browser" | "subagent_browser";
  captureNotesPath: string;
  extractedJsonPath: string;
  targetCandidates: number;
  commands?: {
    extractCandidates?: {
      args?: string[];
    };
  };
};

type PublicScoutSchedule = {
  status: string;
  scheduleName: string;
  runs: PublicScoutScheduleRun[];
  safety?: {
    sendsOutreach?: boolean;
    writesPreviewFiles?: boolean;
    paidDataSpendUsd?: number;
    requiresRobertReview?: boolean;
  };
};

type PathChecks = {
  exists: (path: string) => boolean;
  lstat: (path: string) => { isSymbolicLink: () => boolean };
  realpath: (path: string) => string;
};

const nodePathChecks: PathChecks = {
  exists: existsSync,
  lstat: lstatSync,
  realpath: realpathSync,
};

function getArgValue(argv: string[], name: string) {
  const prefix = `${name}=`;
  const arg = argv.find((value) => value.startsWith(prefix));
  return arg ? arg.slice(prefix.length).trim() : "";
}

function hasSensitivePath(value: string) {
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

function allowedPublicScoutPathRoots() {
  const roots = [
    path.resolve(process.cwd(), "revenue_workspace/public-scout"),
    path.resolve(os.tmpdir()),
    "/tmp",
  ];
  const expanded = new Set<string>();
  for (const root of roots) {
    expanded.add(root);
    try {
      expanded.add(realpathSync(root));
    } catch {
      // Ignore roots that do not exist yet; path.resolve validation still applies.
    }
  }
  return [...expanded];
}

function isAllowedPublicScoutPath(value: string) {
  const resolved = path.resolve(value);
  return allowedPublicScoutPathRoots().some((root) => isPathInside(resolved, root));
}

function nearestExistingAncestor(value: string, checks: PathChecks) {
  let current = path.resolve(value);
  while (!checks.exists(current)) {
    const parent = path.dirname(current);
    if (parent === current) return current;
    current = parent;
  }
  return current;
}

function validateExistingReadablePath(label: string, value: string, checks: PathChecks) {
  const errors: string[] = [];
  if (checks.lstat(value).isSymbolicLink()) errors.push(`${label} cannot be a symlink.`);
  const realTarget = checks.realpath(value);
  if (!allowedPublicScoutPathRoots().some((root) => isPathInside(realTarget, root))) {
    errors.push(`${label} real path must stay inside revenue_workspace/public-scout or the system temp directory.`);
  }
  return errors;
}

function validateWritablePath(label: string, value: string, checks: PathChecks) {
  const errors: string[] = [];
  try {
    if (checks.lstat(value).isSymbolicLink()) {
      errors.push(`${label} cannot be a symlink.`);
      return errors;
    }
  } catch {
    // Missing paths are allowed after their nearest existing parent is validated.
  }
  if (checks.exists(value)) {
    if (checks.lstat(value).isSymbolicLink()) errors.push(`${label} cannot be a symlink.`);
    const realTarget = checks.realpath(value);
    if (!allowedPublicScoutPathRoots().some((root) => isPathInside(realTarget, root))) {
      errors.push(`${label} real path must stay inside revenue_workspace/public-scout or the system temp directory.`);
    }
    return errors;
  }
  const existingAncestor = nearestExistingAncestor(path.dirname(value), checks);
  if (checks.exists(existingAncestor) && checks.lstat(existingAncestor).isSymbolicLink()) {
    errors.push(`${label} parent path cannot include a symlink.`);
  }
  const realAncestor = checks.exists(existingAncestor) ? checks.realpath(existingAncestor) : path.resolve(existingAncestor);
  if (!allowedPublicScoutPathRoots().some((root) => isPathInside(realAncestor, root))) {
    errors.push(`${label} parent real path must stay inside revenue_workspace/public-scout or the system temp directory.`);
  }
  return errors;
}

function argValue(args: string[], name: string) {
  const prefix = `${name}=`;
  const arg = args.find((value) => value.startsWith(prefix));
  return arg ? arg.slice(prefix.length).trim() : "";
}

function sourceFromExecutor(executor: PublicScoutScheduleRun["executor"]): RevenuePublicScoutExtractCliOptions["source"] {
  return executor === "subagent_browser" ? "browser_subagent" : "manual_browser";
}

function extractOptionsFromRun(run: PublicScoutScheduleRun): RevenuePublicScoutExtractCliOptions {
  const args = run.commands?.extractCandidates?.args || [];
  return {
    inputPath: "",
    outputPath: run.extractedJsonPath || "",
    overwrite: true,
    json: true,
    area: argValue(args, "--area") || "Miami",
    niche: argValue(args, "--niche") || "med spas",
    offerFocus: (argValue(args, "--offer-focus") || "both") as RevenuePublicScoutExtractCliOptions["offerFocus"],
    source: (argValue(args, "--source") || sourceFromExecutor(run.executor)) as RevenuePublicScoutExtractCliOptions["source"],
    scoutRunId: argValue(args, "--scout-run-id") || run.id,
  };
}

export function parseRevenuePublicScoutExecuteArgs(argv: string[]): RevenuePublicScoutExecuteCliOptions {
  return {
    schedulePath: getArgValue(argv, "--schedule"),
    runId: getArgValue(argv, "--run-id"),
    notesPath: getArgValue(argv, "--notes"),
    writeExtracted: argv.includes("--write-extracted"),
    json: argv.includes("--json"),
  };
}

export function parseRevenuePublicScoutExecuteSchedule(rawSchedule: string): PublicScoutSchedule {
  const parsed = JSON.parse(rawSchedule) as PublicScoutSchedule;
  return {
    ...parsed,
    runs: Array.isArray(parsed.runs) ? parsed.runs : [],
  };
}

export function validateRevenuePublicScoutExecuteOptions(
  options: RevenuePublicScoutExecuteCliOptions,
  fileExists: (path: string) => boolean = existsSync,
) {
  const errors: string[] = [];
  if (!options.schedulePath) errors.push("--schedule is required.");
  if (options.schedulePath && hasSensitivePath(options.schedulePath)) errors.push("--schedule cannot point to .env, credentials, secrets, .ssh, .git or node_modules paths.");
  if (options.notesPath && hasSensitivePath(options.notesPath)) errors.push("--notes cannot point to .env, credentials, secrets, .ssh, .git or node_modules paths.");
  if (options.schedulePath && !fileExists(options.schedulePath)) errors.push("--schedule file does not exist.");
  if (options.notesPath && !fileExists(options.notesPath)) errors.push("--notes file does not exist.");
  return errors;
}

export function validateRevenuePublicScoutExecuteResolvedPaths(
  paths: {
    notesPath: string;
    extractedJsonPath?: string;
    writeExtracted: boolean;
  },
  checks: PathChecks = nodePathChecks,
) {
  const errors: string[] = [];
  if (!paths.notesPath) errors.push("Resolved notes path is required.");
  if (paths.notesPath && hasSensitivePath(paths.notesPath)) errors.push("Resolved notes path cannot point to .env, credentials, secrets, .ssh, .git or node_modules paths.");
  if (paths.notesPath && !isAllowedPublicScoutPath(paths.notesPath)) errors.push("Resolved notes path must be inside revenue_workspace/public-scout or the system temp directory.");
  if (paths.notesPath && !checks.exists(paths.notesPath)) errors.push("Resolved notes file does not exist.");
  if (paths.notesPath && checks.exists(paths.notesPath)) {
    errors.push(...validateExistingReadablePath("Resolved notes path", paths.notesPath, checks));
  }
  if (paths.writeExtracted) {
    if (!paths.extractedJsonPath) errors.push("Resolved extracted JSON path is required when --write-extracted is used.");
    if (paths.extractedJsonPath && hasSensitivePath(paths.extractedJsonPath)) errors.push("Resolved extracted JSON path cannot point to .env, credentials, secrets, .ssh, .git or node_modules paths.");
    if (paths.extractedJsonPath && !isAllowedPublicScoutPath(paths.extractedJsonPath)) errors.push("Resolved extracted JSON path must be inside revenue_workspace/public-scout or the system temp directory.");
    if (paths.extractedJsonPath) {
      errors.push(...validateWritablePath("Resolved extracted JSON path", paths.extractedJsonPath, checks));
    }
  }
  return errors;
}

export function buildRevenuePublicScoutExecute(
  rawSchedule: string,
  rawNotes: string,
  options: RevenuePublicScoutExecuteCliOptions,
  writeExtractedJson?: (path: string, content: string) => void,
) {
  const schedule = parseRevenuePublicScoutExecuteSchedule(rawSchedule);
  const selectedRun = options.runId
    ? schedule.runs.find((run) => run.id === options.runId)
    : schedule.runs[0];
  const blockers = [
    schedule.status !== "ready_for_guarded_schedule" && "schedule is not ready_for_guarded_schedule",
    schedule.safety?.sendsOutreach === true && "schedule must not send outreach",
    schedule.safety?.writesPreviewFiles === true && "schedule must not write preview files",
    (schedule.safety?.paidDataSpendUsd || 0) > 0 && "schedule must not use paid data spend",
    !selectedRun && "requested run was not found in schedule",
  ].filter((item): item is string => Boolean(item));

  if (blockers.length || !selectedRun) {
    return {
      status: "blocked" as const,
      scheduleName: schedule.scheduleName || "unknown",
      runId: options.runId || "",
      blockers,
      extractedInput: null,
      scoutRunResult: null,
      nextAction: "Use a ready guarded public scout schedule and a valid run id before executing capture.",
      safety: {
        readsPublicDataOnly: true,
        persistsPublicCandidates: false,
        persistsLeads: false,
        writesPreviewFiles: false,
        sendsOutreach: false,
        paidDataSpendUsd: 0,
        requiresRobertReview: true,
      },
    };
  }

  const extractOptions = extractOptionsFromRun(selectedRun);
  const extractedInput = buildRevenuePublicScoutExtract(rawNotes, extractOptions);
  const cappedInput: RevenuePublicScoutRunInput = {
    ...extractedInput,
    candidates: extractedInput.candidates.slice(0, Math.max(1, selectedRun.targetCandidates || 1)),
    autoApproveVerified: false,
    maxPaidDataSpendUsd: 0,
    dailyContactLimit: 0,
    requireRobertApprovalToContact: true,
    writePreviewFiles: false,
  };
  if (options.writeExtracted && selectedRun.extractedJsonPath) {
    const outputPathErrors = validateRevenuePublicScoutExecuteResolvedPaths({
      notesPath: options.notesPath,
      extractedJsonPath: selectedRun.extractedJsonPath,
      writeExtracted: true,
    }).filter((error) => !error.includes("notes file does not exist"));
    if (outputPathErrors.length) {
      return {
        status: "blocked" as const,
        scheduleName: schedule.scheduleName,
        runId: selectedRun.id,
        blockers: outputPathErrors,
        extractedInput: null,
        scoutRunResult: null,
        nextAction: "Use only approved public-scout workspace or temp paths for notes and extracted JSON.",
        safety: {
          readsPublicDataOnly: true,
          persistsPublicCandidates: false,
          persistsLeads: false,
          writesPreviewFiles: false,
          sendsOutreach: false,
          paidDataSpendUsd: 0,
          requiresRobertReview: true,
        },
      };
    }
    writeExtractedJson?.(selectedRun.extractedJsonPath, `${JSON.stringify(cappedInput, null, 2)}\n`);
  }
  const scoutRunResult = recordRevenuePublicScoutRun(cappedInput);

  return {
    status: scoutRunResult.recordedCandidates.length > 0 ? "recorded_for_robert_review" as const : "blocked" as const,
    scheduleName: schedule.scheduleName,
    runId: selectedRun.id,
    blockers: scoutRunResult.recordedCandidates.length > 0 ? [] : ["no complete public candidates were extracted from notes"],
    extractedInput: cappedInput,
    scoutRunResult,
    nextAction: scoutRunResult.recordedCandidates.length > 0
      ? "Run revenue:public-contact-verification, then ask Robert before importing candidates into Money Sprint."
      : "Add complete public notes with business, source URL, contact path and evidence.",
    safety: {
      readsPublicDataOnly: true,
      persistsPublicCandidates: scoutRunResult.recordedCandidates.length > 0,
      persistsLeads: false,
      writesPreviewFiles: false,
      sendsOutreach: false,
      paidDataSpendUsd: 0,
      requiresRobertReview: true,
    },
  };
}

export function formatRevenuePublicScoutExecuteText(result: ReturnType<typeof buildRevenuePublicScoutExecute>) {
  const extractText = result.extractedInput
    ? formatRevenuePublicScoutExtractText(result.extractedInput, result.extractedInput.candidates.length ? "captured in memory" : "")
    : "";
  return [
    `Revenue public scout execute: ${result.status}`,
    `Schedule: ${result.scheduleName}`,
    `Run: ${result.runId || "none"}`,
    `Recorded candidates: ${result.scoutRunResult?.recordedCandidates.length || 0}`,
    `Blockers: ${result.blockers.length ? result.blockers.join("; ") : "none"}`,
    `Next action: ${result.nextAction}`,
    "",
    "Safety:",
    `- Reads public data only: ${result.safety.readsPublicDataOnly ? "yes" : "no"}`,
    `- Persists public candidates: ${result.safety.persistsPublicCandidates ? "yes" : "no"}`,
    `- Persists final leads: ${result.safety.persistsLeads ? "yes" : "no"}`,
    `- Writes preview files: ${result.safety.writesPreviewFiles ? "yes" : "no"}`,
    `- Sends outreach: ${result.safety.sendsOutreach ? "yes" : "no"}`,
    `- Paid data spend: $${result.safety.paidDataSpendUsd}`,
    `- Requires Robert review: ${result.safety.requiresRobertReview ? "yes" : "no"}`,
    extractText ? ["", extractText].join("\n") : "",
  ].filter(Boolean).join("\n");
}

export function getRevenuePublicScoutExecuteExitCode(result: ReturnType<typeof buildRevenuePublicScoutExecute>) {
  return result.status === "recorded_for_robert_review" ? 0 : 1;
}
