import { existsSync, lstatSync, mkdirSync, realpathSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  buildRevenuePublicCandidateVerificationArtifact,
  type RevenuePublicCandidateVerificationArtifactInput,
} from "./revenue-engine";

export type RevenuePublicCandidateVerificationArtifactCliOptions = RevenuePublicCandidateVerificationArtifactInput & {
  outputPath: string;
  overwrite: boolean;
  json: boolean;
};

function getArgValue(argv: string[], name: string) {
  const prefix = `${name}=`;
  const arg = argv.find((value) => value.startsWith(prefix));
  return arg ? arg.slice(prefix.length).trim() : "";
}

export function parseRevenuePublicCandidateVerificationArtifactArgs(
  argv: string[],
): RevenuePublicCandidateVerificationArtifactCliOptions {
  return {
    candidateIds: getArgValue(argv, "--candidate-ids").split(",").map((item) => item.trim()).filter(Boolean),
    reviewerNote: getArgValue(argv, "--note"),
    outputPath: getArgValue(argv, "--output"),
    overwrite: argv.includes("--overwrite"),
    json: argv.includes("--json"),
  };
}

function isSafePublicVerificationOutput(value: string) {
  const resolved = path.resolve(value);
  const publicVerificationRoot = path.resolve(process.cwd(), "revenue_workspace/public-verification");
  return resolved.startsWith(`${publicVerificationRoot}${path.sep}`) && /\.md$/i.test(resolved);
}

function existingPathOrAncestor(value: string) {
  let current = path.resolve(value);
  const publicVerificationRoot = path.resolve(process.cwd(), "revenue_workspace/public-verification");
  while (!existsSync(current) && current !== publicVerificationRoot && current !== path.dirname(current)) {
    current = path.dirname(current);
  }
  return current;
}

function hasSymlinkAncestor(value: string) {
  const publicVerificationRoot = path.resolve(process.cwd(), "revenue_workspace/public-verification");
  let current = path.resolve(value);
  while (current.startsWith(publicVerificationRoot)) {
    if (existsSync(current) && lstatSync(current).isSymbolicLink()) return true;
    if (current === publicVerificationRoot) return false;
    current = path.dirname(current);
  }
  return false;
}

function validateOutputPathSafety(outputPath: string, overwrite: boolean) {
  const errors: string[] = [];
  if (!outputPath) return ["--output is required."];
  if (!isSafePublicVerificationOutput(outputPath)) {
    errors.push("--output must be a .md file inside revenue_workspace/public-verification.");
    return errors;
  }
  const publicVerificationRoot = path.resolve(process.cwd(), "revenue_workspace/public-verification");
  const workspaceRoot = path.resolve(process.cwd(), "revenue_workspace");
  try {
    if (existsSync(workspaceRoot)) {
      const realWorkspace = realpathSync(workspaceRoot);
      const existingAncestorForRealpath = existingPathOrAncestor(outputPath);
      if (existsSync(existingAncestorForRealpath)) {
        const realAncestor = realpathSync(existingAncestorForRealpath);
        if (!realAncestor.startsWith(`${realWorkspace}${path.sep}`) && realAncestor !== realWorkspace) {
          errors.push("--output cannot resolve outside revenue_workspace.");
        }
      }
    }
  } catch {
    errors.push("--output path could not be resolved safely.");
  }
  if (hasSymlinkAncestor(outputPath)) {
    errors.push("--output cannot be inside or replace a symlink path.");
  }
  const existingAncestor = existingPathOrAncestor(outputPath);
  if (existsSync(existingAncestor) && lstatSync(existingAncestor).isSymbolicLink()) {
    errors.push("--output cannot be inside or replace a symlink path.");
  }
  if (existsSync(outputPath)) {
    const stats = lstatSync(outputPath);
    if (stats.isSymbolicLink()) errors.push("--output cannot be a symlink.");
    if (!stats.isFile()) errors.push("--output must be a regular file when it already exists.");
    if (!overwrite) errors.push("--output already exists; pass --overwrite to replace it.");
  }
  return errors;
}

export function validateRevenuePublicCandidateVerificationArtifactOptions(
  options: RevenuePublicCandidateVerificationArtifactCliOptions,
) {
  const errors: string[] = [];
  if (options.candidateIds.length === 0) errors.push("--candidate-ids is required.");
  errors.push(...validateOutputPathSafety(options.outputPath, options.overwrite));
  return errors;
}

export function buildRevenuePublicCandidateVerificationArtifactFromCli(
  options: RevenuePublicCandidateVerificationArtifactCliOptions,
) {
  const artifact = buildRevenuePublicCandidateVerificationArtifact({
    candidateIds: options.candidateIds,
    reviewerNote: options.reviewerNote,
  });
  const outputPathErrors = validateOutputPathSafety(options.outputPath, options.overwrite);
  const canWrite = artifact.status === "ready_for_robert_review" && outputPathErrors.length === 0;
  if (canWrite) {
    mkdirSync(path.dirname(options.outputPath), { recursive: true });
    writeFileSync(options.outputPath, `${artifact.artifactMarkdown}\n`, "utf8");
  }
  return {
    ...artifact,
    status: canWrite ? artifact.status : "blocked" as const,
    validationErrors: outputPathErrors,
    outputPath: options.outputPath,
    wroteFile: canWrite,
  };
}

export function formatRevenuePublicCandidateVerificationArtifactText(
  result: ReturnType<typeof buildRevenuePublicCandidateVerificationArtifactFromCli>,
) {
  return [
    `Revenue public candidate verification artifact: ${result.status}`,
    `Candidates: ${result.candidateCount}`,
    `Output: ${result.outputPath || "none"}`,
    `Wrote file: ${result.wroteFile ? "yes" : "no"}`,
    `Missing ids: ${result.missingIds.length ? result.missingIds.join(", ") : "none"}`,
    `Duplicate ids: ${result.duplicateIds.length ? result.duplicateIds.join(", ") : "none"}`,
    "",
    "Safety:",
    `- Persists leads: ${result.safety.persistsLeads ? "yes" : "no"}`,
    `- Sends outreach: ${result.safety.sendsOutreach ? "yes" : "no"}`,
    `- Writes previews: ${result.safety.writesPreviewFiles ? "yes" : "no"}`,
    "",
    `Next action: ${result.nextAction}`,
  ].join("\n");
}

export function getRevenuePublicCandidateVerificationArtifactExitCode(
  result: ReturnType<typeof buildRevenuePublicCandidateVerificationArtifactFromCli>,
) {
  return result.status === "ready_for_robert_review" ? 0 : 1;
}
