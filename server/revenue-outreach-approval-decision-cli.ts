import {
  listRevenueOutreachDrafts,
  recordRevenueTrustedApprovalDecision,
} from "./revenue-engine";
import {
  buildRevenueOutreachApprovalTargetId,
  buildRevenueOutreachSnapshotHash,
} from "./revenue-outreach-approval";

export type RevenueOutreachApprovalDecisionCliOptions = {
  draftId: string;
  decision: "approved" | "rejected" | "needs_changes";
  approvedAction: string;
  notes: string;
  confirmedByRobert: boolean;
  json: boolean;
};

function getArgValue(argv: string[], name: string) {
  const prefix = `${name}=`;
  const arg = argv.find((value) => value.startsWith(prefix));
  return arg ? arg.slice(prefix.length).trim() : "";
}

export function parseRevenueOutreachApprovalDecisionArgs(argv: string[]): RevenueOutreachApprovalDecisionCliOptions {
  return {
    draftId: getArgValue(argv, "--draft-id"),
    decision: (getArgValue(argv, "--decision") || "needs_changes") as RevenueOutreachApprovalDecisionCliOptions["decision"],
    approvedAction: getArgValue(argv, "--approved-action") || "Approve one exact outreach draft for provider send after final review.",
    notes: getArgValue(argv, "--notes"),
    confirmedByRobert: argv.includes("--confirmed-by-robert"),
    json: argv.includes("--json"),
  };
}

export function validateRevenueOutreachApprovalDecisionOptions(options: RevenueOutreachApprovalDecisionCliOptions) {
  const errors: string[] = [];
  if (!options.draftId) errors.push("--draft-id is required.");
  if (!["approved", "rejected", "needs_changes"].includes(options.decision)) {
    errors.push("--decision must be approved, rejected, or needs_changes.");
  }
  if (options.approvedAction.trim().length < 8) {
    errors.push("--approved-action must describe the approved/rejected action.");
  }
  return errors;
}

export function buildRevenueOutreachApprovalDecisionFromCli(options: RevenueOutreachApprovalDecisionCliOptions) {
  const draft = listRevenueOutreachDrafts().find((item) => item.id === options.draftId);
  const approvalBlockers = draft ? [
    draft.status !== "approved" && `${draft.id}: draft status must be approved before external contact`,
    draft.delivery.sendStatus === "sent" && `${draft.id}: draft already sent`,
    draft.recipientEmail.trim().length === 0 && `${draft.id}: recipientEmail required`,
    !["email", "gmail", "mailto"].includes(draft.channel) && `${draft.id}: channel must be email/gmail/mailto for provider send`,
    ...draft.qaGates.filter((gate) => !gate.passed).map((gate) => `${draft.id}: ${gate.fix}`),
  ].filter((item): item is string => Boolean(item)) : [];
  const blockers = [
    !options.confirmedByRobert && "--confirmed-by-robert is required to record an outreach approval decision.",
    !draft && `${options.draftId || "draft"}: draft not found`,
    ...(options.decision === "approved" ? approvalBlockers : []),
  ].filter((item): item is string => Boolean(item));
  const targetId = buildRevenueOutreachApprovalTargetId(options.draftId);

  if (blockers.length || !draft) {
    return {
      status: "blocked" as const,
      decision: null,
      targetId,
      draftId: options.draftId,
      blockers,
      nextApiAction: "",
      nextApiBody: null,
      nextAction: "Resolve blockers before recording this outreach decision.",
      safety: {
        persistsApprovalDecision: false,
        sendsOutreach: false,
        persistsLeads: false,
        chargesClients: false,
        deploys: false,
        paidDataSpendUsd: 0,
      },
    };
  }

  const result = recordRevenueTrustedApprovalDecision({
    targetId,
    targetType: "outbox",
    decision: options.decision,
    approvedAction: options.approvedAction,
    maxSpendUsd: 0,
    notes: options.notes,
    approvalSource: "outreach_approval_cli",
    publicCandidateSnapshotHash: "",
    outreachDraftSnapshotHash: buildRevenueOutreachSnapshotHash(draft),
    websiteCreationSnapshotHash: "",
    websitePublishSnapshotHash: "",
    ledgerEntrySnapshotHash: "",
  });
  const sendBody = options.decision === "approved"
    ? { draftId: draft.id, approvalDecisionId: result.decision.id }
    : null;

  return {
    status: result.decision.guardrail.status === "recorded" ? "recorded" as const : "blocked" as const,
    decision: result.decision,
    targetId,
    draftId: draft.id,
    blockers: result.decision.guardrail.status === "recorded" ? [] : [result.decision.guardrail.reason],
    nextApiAction: sendBody ? "/api/revenue-engine/outreach-send" : "",
    nextApiBody: sendBody,
    nextAction: sendBody
      ? "Use this approvalDecisionId only for the exact reviewed draft; provider send still runs QA and provider gates."
      : "Decision recorded; do not send this draft unless Robert changes the decision.",
    safety: {
      persistsApprovalDecision: result.decision.guardrail.status === "recorded",
      sendsOutreach: false,
      persistsLeads: false,
      chargesClients: false,
      deploys: false,
      paidDataSpendUsd: 0,
    },
  };
}

export function formatRevenueOutreachApprovalDecisionText(result: ReturnType<typeof buildRevenueOutreachApprovalDecisionFromCli>) {
  return [
    `Revenue outreach approval decision: ${result.status}`,
    `Decision id: ${result.decision?.id || "none"}`,
    `Target: ${result.targetId}`,
    `Draft id: ${result.draftId || "none"}`,
    `Blockers: ${result.blockers.length ? result.blockers.join("; ") : "none"}`,
    `Next API action: ${result.nextApiAction || "none"}`,
    `Next API body: ${result.nextApiBody ? JSON.stringify(result.nextApiBody) : "none"}`,
    `Next action: ${result.nextAction}`,
    "",
    "Safety:",
    `- Persists approval decision: ${result.safety.persistsApprovalDecision ? "yes" : "no"}`,
    `- Persists final leads: ${result.safety.persistsLeads ? "yes" : "no"}`,
    `- Sends outreach: ${result.safety.sendsOutreach ? "yes" : "no"}`,
    `- Charges clients: ${result.safety.chargesClients ? "yes" : "no"}`,
    `- Deploys: ${result.safety.deploys ? "yes" : "no"}`,
    `- Paid data spend: $${result.safety.paidDataSpendUsd}`,
  ].join("\n");
}

export function getRevenueOutreachApprovalDecisionExitCode(result: ReturnType<typeof buildRevenueOutreachApprovalDecisionFromCli>) {
  return result.status === "recorded" ? 0 : 1;
}
