import type { updateRevenuePublicLeadCandidateVerification } from "./revenue-engine";

export type RevenuePublicCandidateVerificationUpdateCliOptions = {
  candidateId: string;
  contactChannel: "email" | "phone" | "instagram" | "contact_form" | "";
  contactValue: string;
  recipientEmail: string;
  sourceUrl: string;
  evidence: string;
  painPoint: string;
  notes: string;
  verifiedBy: string;
  confirmPublicEvidence: boolean;
  json: boolean;
};

export function parseRevenuePublicCandidateVerificationUpdateArgs(argv: string[]): RevenuePublicCandidateVerificationUpdateCliOptions {
  const getValue = (name: string) => {
    const prefix = `${name}=`;
    const arg = argv.find((value) => value.startsWith(prefix));
    return arg ? arg.slice(prefix.length).trim() : "";
  };

  return {
    candidateId: getValue("--candidate-id"),
    contactChannel: getValue("--contact-channel") as RevenuePublicCandidateVerificationUpdateCliOptions["contactChannel"],
    contactValue: getValue("--contact-value"),
    recipientEmail: getValue("--recipient-email"),
    sourceUrl: getValue("--source-url"),
    evidence: getValue("--evidence"),
    painPoint: getValue("--pain-point"),
    notes: getValue("--notes"),
    verifiedBy: getValue("--verified-by") || "Robert",
    confirmPublicEvidence: argv.includes("--confirm-public-evidence"),
    json: argv.includes("--json"),
  };
}

export function validateRevenuePublicCandidateVerificationUpdateOptions(
  options: RevenuePublicCandidateVerificationUpdateCliOptions,
): string[] {
  const errors: string[] = [];
  const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!options.candidateId) errors.push("--candidate-id is required.");
  if (!["email", "phone", "instagram", "contact_form"].includes(options.contactChannel)) {
    errors.push("--contact-channel must be email, phone, instagram or contact_form.");
  }
  if (!options.contactValue) errors.push("--contact-value is required.");
  if (!options.sourceUrl) errors.push("--source-url is required.");
  if (options.evidence.length < 12) errors.push("--evidence must include at least 12 characters of public evidence.");
  if (!options.confirmPublicEvidence) errors.push("--confirm-public-evidence is required after checking public sources.");
  if (options.contactChannel === "email" && options.contactValue && !emailPattern.test(options.contactValue)) {
    errors.push("--contact-value must be a valid email when --contact-channel=email.");
  }
  if (options.contactChannel === "email" && options.recipientEmail && options.recipientEmail !== options.contactValue) {
    errors.push("--recipient-email must match --contact-value when --contact-channel=email.");
  }
  return errors;
}

export function buildRevenuePublicCandidateVerificationUpdateInput(
  options: RevenuePublicCandidateVerificationUpdateCliOptions,
) {
  return {
    candidateId: options.candidateId,
    contactChannel: options.contactChannel as "email" | "phone" | "instagram" | "contact_form",
    contactValue: options.contactValue,
    recipientEmail: options.recipientEmail,
    sourceUrl: options.sourceUrl,
    evidence: options.evidence,
    painPoint: options.painPoint || "Needs a conversion-focused website and follow-up path.",
    notes: options.notes,
    verifiedBy: options.verifiedBy,
    confirmPublicEvidence: options.confirmPublicEvidence,
  };
}

function shellQuote(value: string) {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

function formatCommand(command: string, args: string[]) {
  return [command, ...args.map(shellQuote)].join(" ");
}

type VerificationUpdateResult = ReturnType<typeof updateRevenuePublicLeadCandidateVerification>;

export function formatRevenuePublicCandidateVerificationUpdateText(result: VerificationUpdateResult) {
  const nextReviewCommand = "nextReviewCommand" in result ? result.nextReviewCommand : undefined;
  const nextReviewCommandText = nextReviewCommand
    ? formatCommand(nextReviewCommand.command, nextReviewCommand.args)
    : "";

  return [
    `Revenue public candidate verification update: ${result.status}`,
    `Candidate: ${result.candidateId}`,
    `Updated: ${result.updated ? "yes" : "no"}`,
    `Remaining before Robert review: ${result.remainingBeforeRobertReview.length ? result.remainingBeforeRobertReview.join("; ") : "none"}`,
    `Next action: ${result.nextAction}`,
    ...(nextReviewCommandText ? [`Review command after Robert approval: ${nextReviewCommandText} --approved-by-robert`] : []),
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
