import {
  blockRevenuePublicLeadCandidate,
  type RevenuePublicLeadCandidateBlockInput,
} from "./revenue-engine";

export type RevenuePublicCandidateBlockCliOptions = RevenuePublicLeadCandidateBlockInput & {
  json: boolean;
};

function getArgValue(argv: string[], name: string) {
  const prefix = `${name}=`;
  const arg = argv.find((value) => value.startsWith(prefix));
  return arg ? arg.slice(prefix.length).trim() : "";
}

export function parseRevenuePublicCandidateBlockArgs(argv: string[]): RevenuePublicCandidateBlockCliOptions {
  return {
    candidateId: getArgValue(argv, "--candidate-id"),
    blockReason: getArgValue(argv, "--block-reason"),
    sourceUrl: getArgValue(argv, "--source-url"),
    evidence: getArgValue(argv, "--evidence"),
    notes: getArgValue(argv, "--notes"),
    verifiedBy: getArgValue(argv, "--verified-by") || "Robert",
    confirmPublicMismatch: argv.includes("--confirm-public-mismatch"),
    json: argv.includes("--json"),
  };
}

export function validateRevenuePublicCandidateBlockOptions(options: RevenuePublicCandidateBlockCliOptions) {
  const errors: string[] = [];
  if (!options.candidateId) errors.push("--candidate-id is required.");
  if (options.blockReason.length < 8) errors.push("--block-reason must include at least 8 characters.");
  if (!/^https?:\/\/\S+$/i.test(options.sourceUrl)) errors.push("--source-url must be a public http(s) URL.");
  if (options.evidence.length < 12) errors.push("--evidence must include at least 12 characters of public evidence.");
  if (!options.confirmPublicMismatch) errors.push("--confirm-public-mismatch is required after checking public sources.");
  return errors;
}

export function buildRevenuePublicCandidateBlockFromCli(options: RevenuePublicCandidateBlockCliOptions) {
  return blockRevenuePublicLeadCandidate({
    candidateId: options.candidateId,
    blockReason: options.blockReason,
    sourceUrl: options.sourceUrl,
    evidence: options.evidence,
    notes: options.notes,
    verifiedBy: options.verifiedBy,
    confirmPublicMismatch: options.confirmPublicMismatch,
  });
}

export function formatRevenuePublicCandidateBlockText(result: ReturnType<typeof buildRevenuePublicCandidateBlockFromCli>) {
  return [
    `Revenue public candidate block: ${result.status}`,
    `Candidate: ${result.candidateId}`,
    `Updated: ${result.updated ? "yes" : "no"}`,
    `Next action: ${result.nextAction}`,
    "",
    "Safety:",
    `- Persists public candidate: ${result.safety.persistsPublicCandidate ? "yes" : "no"}`,
    `- Persists final lead: ${result.safety.persistsLead ? "yes" : "no"}`,
    `- Sends outreach: ${result.safety.sendsOutreach ? "yes" : "no"}`,
    `- Writes preview files: ${result.safety.writesPreviewFiles ? "yes" : "no"}`,
    `- Paid data spend: $${result.safety.paidDataSpendUsd}`,
    `- approvalToImport forced false: ${result.safety.approvalToImportForcedFalse ? "yes" : "no"}`,
  ].join("\n");
}

export function getRevenuePublicCandidateBlockExitCode(result: ReturnType<typeof buildRevenuePublicCandidateBlockFromCli>) {
  return result.updated ? 0 : 1;
}
