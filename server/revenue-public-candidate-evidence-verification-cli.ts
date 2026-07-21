import {
  verifyRevenuePublicCandidateEvidence,
  type RevenuePublicCandidateEvidenceVerificationInput,
} from "./revenue-engine";

export type RevenuePublicCandidateEvidenceVerificationCliOptions = RevenuePublicCandidateEvidenceVerificationInput & {
  json: boolean;
};

function getArgValue(argv: string[], name: string) {
  const prefix = `${name}=`;
  const arg = argv.find((value) => value.startsWith(prefix));
  return arg ? arg.slice(prefix.length).trim() : "";
}

export function parseRevenuePublicCandidateEvidenceVerificationArgs(
  argv: string[],
): RevenuePublicCandidateEvidenceVerificationCliOptions {
  return {
    candidateIds: getArgValue(argv, "--candidate-ids").split(",").map((item) => item.trim()).filter(Boolean),
    approvedByRobert: argv.includes("--approved-by-robert"),
    evidenceRef: getArgValue(argv, "--evidence-ref"),
    reviewerNote: getArgValue(argv, "--note"),
    json: argv.includes("--json"),
  };
}

export function validateRevenuePublicCandidateEvidenceVerificationOptions(
  options: RevenuePublicCandidateEvidenceVerificationCliOptions,
) {
  const errors: string[] = [];
  if (options.candidateIds.length === 0) errors.push("--candidate-ids is required.");
  if (!options.evidenceRef || options.evidenceRef.length < 6) errors.push("--evidence-ref is required and must be at least 6 characters.");
  return errors;
}

export function buildRevenuePublicCandidateEvidenceVerificationFromCli(
  options: RevenuePublicCandidateEvidenceVerificationCliOptions,
) {
  return verifyRevenuePublicCandidateEvidence({
    candidateIds: options.candidateIds,
    approvedByRobert: options.approvedByRobert,
    evidenceRef: options.evidenceRef,
    reviewerNote: options.reviewerNote,
  });
}

export function formatRevenuePublicCandidateEvidenceVerificationText(
  result: ReturnType<typeof buildRevenuePublicCandidateEvidenceVerificationFromCli>,
) {
  return [
    `Revenue public candidate evidence verification: ${result.status}`,
    `Approved by Robert: ${result.approvedByRobert ? "yes" : "no"}`,
    `Evidence ref: ${result.evidenceRef || "none"}`,
    `Evidence ref accepted: ${result.evidenceRefAccepted ? "yes" : "no"}`,
    `Requested: ${result.requestedCount}`,
    `Updated: ${result.updatedCount}`,
    `Missing ids: ${result.missingIds.length ? result.missingIds.join(", ") : "none"}`,
    `Duplicate ids: ${result.duplicateIds.length ? result.duplicateIds.join(", ") : "none"}`,
    "",
    "Candidates:",
    ...result.candidates.map((candidate) =>
      `- ${candidate.businessName}: verification=${candidate.verificationStatus}, publicEvidenceVerified=${candidate.publicEvidenceVerified ? "yes" : "no"}, approvalToImport=${candidate.approvalToImport ? "yes" : "no"}, importReady=${candidate.importReady ? "yes" : "no"}`,
    ),
    "",
    "Safety:",
    `- Persists public candidates: ${result.safety.persistsPublicCandidates ? "yes" : "no"}`,
    `- Persists final leads: ${result.safety.persistsLeads ? "yes" : "no"}`,
    `- Sends outreach: ${result.safety.sendsOutreach ? "yes" : "no"}`,
    `- Writes preview files: ${result.safety.writesPreviewFiles ? "yes" : "no"}`,
    `- Approval to import forced false: ${result.safety.approvalToImportForcedFalse ? "yes" : "no"}`,
    "",
    `Next action: ${result.nextAction}`,
  ].join("\n");
}

export function getRevenuePublicCandidateEvidenceVerificationExitCode(
  result: ReturnType<typeof buildRevenuePublicCandidateEvidenceVerificationFromCli>,
) {
  return result.status === "evidence_verified_for_robert_review" ? 0 : 1;
}
