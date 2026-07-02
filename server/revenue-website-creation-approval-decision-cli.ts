import {
  listRevenueOutreachDrafts,
  recordRevenueTrustedApprovalDecision,
} from "./revenue-engine";
import {
  buildRevenueWebsiteCreationApprovalTargetId,
  buildRevenueWebsiteCreationSnapshotHash,
} from "./revenue-website-creation-approval";

export type RevenueWebsiteCreationApprovalDecisionCliOptions = {
  outreachDraftId: string;
  decision: "approved" | "rejected" | "needs_changes";
  approvedAction: string;
  notes: string;
  robertApprovedBuild: boolean;
  clientApprovedScope: boolean;
  depositPaid: boolean;
  publicDataVerified: boolean;
  launchTargetDays: number;
  confirmedByRobert: boolean;
  json: boolean;
};

function getArgValue(argv: string[], name: string) {
  const prefix = `${name}=`;
  const arg = argv.find((value) => value.startsWith(prefix));
  return arg ? arg.slice(prefix.length).trim() : "";
}

function shellQuote(value: string) {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

function npmRunText(script: string, args: string[] = []) {
  return ["npm", "run", script, "--", ...args].map(shellQuote).join(" ");
}

export function parseRevenueWebsiteCreationApprovalDecisionArgs(argv: string[]): RevenueWebsiteCreationApprovalDecisionCliOptions {
  return {
    outreachDraftId: getArgValue(argv, "--outreach-draft-id"),
    decision: (getArgValue(argv, "--decision") || "needs_changes") as RevenueWebsiteCreationApprovalDecisionCliOptions["decision"],
    approvedAction: getArgValue(argv, "--approved-action") || "Approve paid website creation handoff after scope, deposit, and public data review.",
    notes: getArgValue(argv, "--notes"),
    robertApprovedBuild: argv.includes("--robert-approved-build"),
    clientApprovedScope: argv.includes("--client-approved-scope"),
    depositPaid: argv.includes("--deposit-paid"),
    publicDataVerified: argv.includes("--public-data-verified"),
    launchTargetDays: Number(getArgValue(argv, "--launch-target-days") || 7),
    confirmedByRobert: argv.includes("--confirmed-by-robert"),
    json: argv.includes("--json"),
  };
}

export function validateRevenueWebsiteCreationApprovalDecisionOptions(options: RevenueWebsiteCreationApprovalDecisionCliOptions) {
  const errors: string[] = [];
  if (!options.outreachDraftId) errors.push("--outreach-draft-id is required.");
  if (!["approved", "rejected", "needs_changes"].includes(options.decision)) {
    errors.push("--decision must be approved, rejected, or needs_changes.");
  }
  if (options.approvedAction.trim().length < 8) {
    errors.push("--approved-action must describe the approved/rejected action.");
  }
  if (!Number.isInteger(options.launchTargetDays) || options.launchTargetDays < 1 || options.launchTargetDays > 60) {
    errors.push("--launch-target-days must be an integer from 1 to 60.");
  }
  return errors;
}

export function buildRevenueWebsiteCreationApprovalDecisionFromCli(options: RevenueWebsiteCreationApprovalDecisionCliOptions) {
  const draft = listRevenueOutreachDrafts().find((item) => item.id === options.outreachDraftId);
  const proof = {
    robertApprovedBuild: options.robertApprovedBuild,
    clientApprovedScope: options.clientApprovedScope,
    depositPaid: options.depositPaid,
    publicDataVerified: options.publicDataVerified,
    launchTargetDays: options.launchTargetDays,
  };
  const approvalBlockers = draft ? [
    !(draft.status === "approved" || draft.delivery.sendStatus === "sent") && `${draft.id}: draft must be approved or sent`,
    !options.robertApprovedBuild && "--robert-approved-build is required for approved website creation.",
    !options.clientApprovedScope && "--client-approved-scope is required for approved website creation.",
    !options.depositPaid && "--deposit-paid is required for approved website creation.",
    !options.publicDataVerified && "--public-data-verified is required for approved website creation.",
  ].filter((item): item is string => Boolean(item)) : [];
  const blockers = [
    !options.confirmedByRobert && "--confirmed-by-robert is required to record a website creation decision.",
    !draft && `${options.outreachDraftId || "outreach draft"}: draft not found`,
    ...(options.decision === "approved" ? approvalBlockers : []),
  ].filter((item): item is string => Boolean(item));
  const targetId = buildRevenueWebsiteCreationApprovalTargetId(options.outreachDraftId);

  if (blockers.length || !draft) {
    return {
      status: "blocked" as const,
      decision: null,
      targetId,
      outreachDraftId: options.outreachDraftId,
      blockers,
      nextCommand: "",
      nextAction: "Resolve blockers before recording this website creation decision.",
      safety: {
        persistsApprovalDecision: false,
        writesFiles: false,
        deploys: false,
        publishesPreview: false,
        sendsOutreach: false,
        chargesClients: false,
        paidDataSpendUsd: 0,
      },
    };
  }

  const result = recordRevenueTrustedApprovalDecision({
    targetId,
    targetType: "delivery_workspace",
    decision: options.decision,
    approvedAction: options.approvedAction,
    maxSpendUsd: 0,
    notes: options.notes,
    approvalSource: "website_creation_approval_cli",
    publicCandidateSnapshotHash: "",
    outreachDraftSnapshotHash: "",
    websiteCreationSnapshotHash: buildRevenueWebsiteCreationSnapshotHash(draft, proof),
    ledgerEntrySnapshotHash: "",
  });
  const nextCommand = options.decision === "approved"
    ? npmRunText("revenue:website-creation-packet", [
      `--outreach-draft-id=${options.outreachDraftId}`,
      `--approval-decision-id=${result.decision.id}`,
      "--robert-approved-build",
      "--client-approved-scope",
      "--deposit-paid",
      "--public-data-verified",
      `--launch-target-days=${options.launchTargetDays}`,
    ])
    : "";

  return {
    status: result.decision.guardrail.status === "recorded" ? "recorded" as const : "blocked" as const,
    decision: result.decision,
    targetId,
    outreachDraftId: options.outreachDraftId,
    blockers: result.decision.guardrail.status === "recorded" ? [] : [result.decision.guardrail.reason],
    nextCommand,
    nextAction: nextCommand
      ? "Run the website creation packet command; it still only prepares an internal handoff and cannot write/deploy."
      : "Decision recorded; do not prepare website creation unless Robert changes the decision.",
    safety: {
      persistsApprovalDecision: result.decision.guardrail.status === "recorded",
      writesFiles: false,
      deploys: false,
      publishesPreview: false,
      sendsOutreach: false,
      chargesClients: false,
      paidDataSpendUsd: 0,
    },
  };
}

export function formatRevenueWebsiteCreationApprovalDecisionText(result: ReturnType<typeof buildRevenueWebsiteCreationApprovalDecisionFromCli>) {
  return [
    `Revenue website creation approval decision: ${result.status}`,
    `Decision id: ${result.decision?.id || "none"}`,
    `Target: ${result.targetId}`,
    `Outreach draft: ${result.outreachDraftId || "none"}`,
    `Blockers: ${result.blockers.length ? result.blockers.join("; ") : "none"}`,
    `Next command: ${result.nextCommand || "none"}`,
    `Next action: ${result.nextAction}`,
    "",
    "Safety:",
    `- Persists approval decision: ${result.safety.persistsApprovalDecision ? "yes" : "no"}`,
    `- Writes files: ${result.safety.writesFiles ? "yes" : "no"}`,
    `- Deploys: ${result.safety.deploys ? "yes" : "no"}`,
    `- Publishes preview: ${result.safety.publishesPreview ? "yes" : "no"}`,
    `- Sends outreach: ${result.safety.sendsOutreach ? "yes" : "no"}`,
    `- Charges clients: ${result.safety.chargesClients ? "yes" : "no"}`,
    `- Paid data spend: $${result.safety.paidDataSpendUsd}`,
  ].join("\n");
}

export function getRevenueWebsiteCreationApprovalDecisionExitCode(result: ReturnType<typeof buildRevenueWebsiteCreationApprovalDecisionFromCli>) {
  return result.status === "recorded" ? 0 : 1;
}
