import {
  listRevenueApprovalDecisions,
  listRevenuePublicLeadCandidates,
  type RevenueMoneySprintInput,
  type RevenuePublicLeadCandidateReviewInput,
} from "./revenue-engine";
import {
  buildRevenuePublicCandidateApprovalTargetId,
  buildRevenuePublicCandidateSnapshotHash,
} from "./revenue-public-candidate-approval";

export type RevenuePublicCandidateReviewCliOptions = {
  candidateIds: string[];
  approvedByRobert: boolean;
  approvalDecisionId: string;
  json: boolean;
  area: string;
  niche: string;
  offerFocus: "websites" | "automations" | "both";
  dailyResearchTarget: number;
  dailyQualifiedLeadLimit: number;
  dailyMockupLimit: number;
  dailyContactLimit: number;
  reviewerNote: string;
};

export function parseRevenuePublicCandidateReviewArgs(argv: string[]): RevenuePublicCandidateReviewCliOptions {
  const getValue = (name: string) => {
    const prefix = `${name}=`;
    const arg = argv.find((value) => value.startsWith(prefix));
    return arg ? arg.slice(prefix.length).trim() : "";
  };
  const numberValue = (name: string, fallback: number) => {
    const value = Number(getValue(name));
    return Number.isFinite(value) && value > 0 ? value : fallback;
  };
  const candidateIds = getValue("--candidate-ids")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

  return {
    candidateIds,
    approvedByRobert: argv.includes("--approved-by-robert"),
    approvalDecisionId: getValue("--approval-decision-id"),
    json: argv.includes("--json"),
    area: getValue("--area") || "Miami",
    niche: getValue("--niche") || "med spas",
    offerFocus: (getValue("--offer-focus") || "both") as RevenuePublicCandidateReviewCliOptions["offerFocus"],
    dailyResearchTarget: numberValue("--daily-research-target", 20),
    dailyQualifiedLeadLimit: numberValue("--daily-qualified-lead-limit", 5),
    dailyMockupLimit: numberValue("--daily-mockup-limit", 2),
    dailyContactLimit: numberValue("--daily-contact-limit", 0),
    reviewerNote: getValue("--note"),
  };
}

function hasMatchingPublicCandidateApprovalDecision(options: RevenuePublicCandidateReviewCliOptions) {
  if (!options.approvalDecisionId) return false;
  const expectedTargetId = buildRevenuePublicCandidateApprovalTargetId(options.candidateIds);
  const allCandidates = listRevenuePublicLeadCandidates();
  const selectedCandidates = options.candidateIds
    .map((id) => allCandidates.find((candidate) => candidate.id === id))
    .filter((candidate): candidate is NonNullable<typeof candidate> => Boolean(candidate));
  if (selectedCandidates.length !== options.candidateIds.length) return false;
  const expectedSnapshotHash = buildRevenuePublicCandidateSnapshotHash(selectedCandidates);
  return listRevenueApprovalDecisions().some((decision) =>
    decision.id === options.approvalDecisionId
    && decision.targetType === "public_candidate"
    && decision.targetId === expectedTargetId
    && decision.decision === "approved"
    && decision.guardrail.status === "recorded"
    && decision.approvalSource === "public_candidate_approval_cli"
    && decision.publicCandidateSnapshotHash === expectedSnapshotHash,
  );
}

export function validateRevenuePublicCandidateReviewOptions(options: RevenuePublicCandidateReviewCliOptions): string[] {
  const errors: string[] = [];
  if (options.candidateIds.length === 0) errors.push("--candidate-ids is required.");
  if (!["websites", "automations", "both"].includes(options.offerFocus)) {
    errors.push("--offer-focus must be websites, automations or both.");
  }
  if (options.dailyResearchTarget < 10 || options.dailyResearchTarget > 500) {
    errors.push("--daily-research-target must be between 10 and 500.");
  }
  return errors;
}

export function buildRevenuePublicCandidateReviewInput(options: RevenuePublicCandidateReviewCliOptions): RevenuePublicLeadCandidateReviewInput {
  const approvedByRecordedDecision = hasMatchingPublicCandidateApprovalDecision(options);
  return {
    area: options.area,
    niche: options.niche,
    offerFocus: options.offerFocus,
    dailyResearchTarget: options.dailyResearchTarget,
    dailyQualifiedLeadLimit: options.dailyQualifiedLeadLimit,
    dailyMockupLimit: options.dailyMockupLimit,
    dailyContactLimit: options.dailyContactLimit,
    maxPaidDataSpendUsd: 0,
    requireRobertApprovalToContact: true,
    writePreviewFiles: false,
    candidateIds: options.candidateIds,
    approvedByRobert: options.approvedByRobert || approvedByRecordedDecision,
    reviewerNote: options.reviewerNote,
  };
}

export function formatRevenuePublicCandidateReviewText(result: {
  status: string;
  approvedByRobert: boolean;
  requestedCount: number;
  foundCount: number;
  approvedCount: number;
  missingIds: string[];
  duplicateIds?: string[];
  reviewedCandidates: Array<{
    businessName: string;
    approvedForPreview: boolean;
    blockedReasons: string[];
    grade: string;
    score: number;
  }>;
  nextApiAction: string;
  nextAction: string;
  importBatchText: string;
  moneySprintRunPacket?: {
    status: string;
    endpoint: string;
    method: string;
    requestBody: RevenueMoneySprintInput;
    expectedOutput: {
      acceptedLeads: number;
      mockupsToPrepare: number;
      outreachDraftsToCreate: number;
      sendsOutreach: boolean;
      writesPreviewFiles: boolean;
    };
    operatorChecklist: string[];
    blockedUntil: string[];
    safety: {
      sendsOutreach: boolean;
      writesPreviewFiles: boolean;
      paidDataSpendUsd: number;
      requiresRobertApprovalBeforeRun: boolean;
      requiresRobertApprovalBeforeContact: boolean;
    };
  };
  safety: {
    persistsLeads: boolean;
    writesPreviewFiles: boolean;
    sendsOutreach: boolean;
    paidDataSpendUsd: number;
    requiresRobertApproval: boolean;
  };
}): string {
  return [
    `Revenue public candidate review: ${result.status}`,
    `Approved by Robert: ${result.approvedByRobert ? "yes" : "no"}`,
    `Requested: ${result.requestedCount}`,
    `Found: ${result.foundCount}`,
    `Approved for preview: ${result.approvedCount}`,
    `Missing ids: ${result.missingIds.length ? result.missingIds.join(", ") : "none"}`,
    `Duplicate ids: ${result.duplicateIds?.length ? result.duplicateIds.join(", ") : "none"}`,
    `Next API action: ${result.nextApiAction}`,
    `Next action: ${result.nextAction}`,
    "",
    "Candidates:",
    ...result.reviewedCandidates.map((candidate) =>
      `- ${candidate.businessName}: ${candidate.approvedForPreview ? "approved" : `blocked (${candidate.blockedReasons.join("; ")})`} [${candidate.grade}/${candidate.score}]`,
    ),
    "",
    "Safety:",
    `- Persists final leads: ${result.safety.persistsLeads ? "yes" : "no"}`,
    `- Writes preview files: ${result.safety.writesPreviewFiles ? "yes" : "no"}`,
    `- Sends outreach: ${result.safety.sendsOutreach ? "yes" : "no"}`,
    `- Paid data spend: $${result.safety.paidDataSpendUsd}`,
    `- Requires Robert approval: ${result.safety.requiresRobertApproval ? "yes" : "no"}`,
    ...(result.moneySprintRunPacket
      ? [
        "",
        "Money sprint run packet:",
        `- Status: ${result.moneySprintRunPacket.status}`,
        `- Human review action: ${result.nextApiAction}`,
        `- Endpoint after approval: ${result.moneySprintRunPacket.method} ${result.moneySprintRunPacket.endpoint}`,
        `- Accepted leads: ${result.moneySprintRunPacket.expectedOutput.acceptedLeads}`,
        `- Mockups to prepare: ${result.moneySprintRunPacket.expectedOutput.mockupsToPrepare}`,
        `- Outreach drafts to create: ${result.moneySprintRunPacket.expectedOutput.outreachDraftsToCreate}`,
        `- Packet paid spend: $${result.moneySprintRunPacket.safety.paidDataSpendUsd}`,
        `- Packet writes preview files: ${result.moneySprintRunPacket.safety.writesPreviewFiles ? "yes" : "no"}`,
        `- Packet sends outreach: ${result.moneySprintRunPacket.safety.sendsOutreach ? "yes" : "no"}`,
        `- Requires approval before run: ${result.moneySprintRunPacket.safety.requiresRobertApprovalBeforeRun ? "yes" : "no"}`,
        "Operator checklist:",
        ...result.moneySprintRunPacket.operatorChecklist.map((item, index) => `${index + 1}. ${item}`),
        ...(result.moneySprintRunPacket.blockedUntil.length
          ? ["Blocked until:", ...result.moneySprintRunPacket.blockedUntil.map((item) => `- ${item}`)]
          : []),
      ]
      : []),
    "",
    "Import batch text:",
    result.importBatchText,
  ].join("\n");
}

export function getRevenuePublicCandidateReviewExitCode(result: { approvedCount: number; moneySprintRunPacket?: { status: string } }) {
  return result.approvedCount > 0 && result.moneySprintRunPacket?.status === "ready_for_money_sprint_run" ? 0 : 1;
}
