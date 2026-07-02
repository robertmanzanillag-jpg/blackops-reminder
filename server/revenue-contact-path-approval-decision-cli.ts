import {
  recordRevenueTrustedApprovalDecision,
} from "./revenue-engine";
import {
  buildRevenueContactPathApprovalTargetId,
  buildRevenueContactPathSnapshotHash,
} from "./revenue-contact-path-approval";

export type RevenueContactPathApprovalDecisionCliOptions = {
  contactMode: "manual" | "email_provider";
  fromEmail: string;
  manualContactApproved: boolean;
  emailProviderConfigured: boolean;
  decision: "approved" | "rejected" | "needs_changes";
  approvedAction: string;
  robertApprovedContactPath: boolean;
  contactPathVerified: boolean;
  evidenceUrl: string;
  evidenceNote: string;
  confirmedByRobert: boolean;
  sendOutreach: boolean;
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

function parseContactMode(value: string): RevenueContactPathApprovalDecisionCliOptions["contactMode"] {
  return value === "email_provider" ? "email_provider" : "manual";
}

function parseUrl(value: string) {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

export function parseRevenueContactPathApprovalDecisionArgs(argv: string[]): RevenueContactPathApprovalDecisionCliOptions {
  return {
    contactMode: parseContactMode(getArgValue(argv, "--contact-mode")),
    fromEmail: getArgValue(argv, "--from-email"),
    manualContactApproved: argv.includes("--manual-contact-approved"),
    emailProviderConfigured: argv.includes("--email-provider-configured"),
    decision: (getArgValue(argv, "--decision") || "needs_changes") as RevenueContactPathApprovalDecisionCliOptions["decision"],
    approvedAction: getArgValue(argv, "--approved-action") || "Approve exact contact path after Robert review and channel evidence.",
    robertApprovedContactPath: argv.includes("--robert-approved-contact-path"),
    contactPathVerified: argv.includes("--contact-path-verified"),
    evidenceUrl: getArgValue(argv, "--evidence-url"),
    evidenceNote: getArgValue(argv, "--evidence-note"),
    confirmedByRobert: argv.includes("--confirmed-by-robert"),
    sendOutreach: argv.includes("--send-outreach"),
    json: argv.includes("--json"),
  };
}

export function validateRevenueContactPathApprovalDecisionOptions(options: RevenueContactPathApprovalDecisionCliOptions) {
  const errors: string[] = [];
  if (!["manual", "email_provider"].includes(options.contactMode)) errors.push("--contact-mode must be manual or email_provider.");
  if (!["approved", "rejected", "needs_changes"].includes(options.decision)) errors.push("--decision must be approved, rejected, or needs_changes.");
  if (options.approvedAction.trim().length < 8) errors.push("--approved-action must describe the approved/rejected action.");
  if (options.contactMode === "email_provider" && !options.fromEmail) errors.push("--from-email is required for email_provider contact mode.");
  if (options.fromEmail && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(options.fromEmail)) errors.push("--from-email must be a valid email when provided.");
  if (!options.evidenceUrl) errors.push("--evidence-url is required.");
  else if (!parseUrl(options.evidenceUrl)) errors.push("--evidence-url must be a valid URL.");
  if (options.evidenceNote.trim().length < 8) errors.push("--evidence-note must describe the contact path proof.");
  return errors;
}

export function buildRevenueContactPathApprovalDecisionFromCli(options: RevenueContactPathApprovalDecisionCliOptions) {
  const contactSnapshot = {
    contactMode: options.contactMode,
    fromEmail: options.fromEmail,
    manualContactApproved: options.manualContactApproved,
    emailProviderConfigured: options.emailProviderConfigured,
  };
  const proof = {
    robertApprovedContactPath: options.robertApprovedContactPath,
    contactPathVerified: options.contactPathVerified,
    evidenceUrl: options.evidenceUrl,
    evidenceNote: options.evidenceNote,
  };
  const approvalBlockers = [
    options.contactMode === "manual" && !options.manualContactApproved && "--manual-contact-approved is required for approved manual contact paths.",
    options.contactMode === "email_provider" && !options.emailProviderConfigured && "--email-provider-configured is required for approved provider contact paths.",
    !options.robertApprovedContactPath && "--robert-approved-contact-path is required for approved contact paths.",
    !options.contactPathVerified && "--contact-path-verified is required for approved contact paths.",
  ].filter((item): item is string => Boolean(item));
  const blockers = [
    !options.confirmedByRobert && "--confirmed-by-robert is required to record a contact path decision.",
    options.sendOutreach && "--send-outreach is blocked; this command never contacts businesses.",
    ...(options.decision === "approved" ? approvalBlockers : []),
  ].filter((item): item is string => Boolean(item));
  const targetId = buildRevenueContactPathApprovalTargetId(contactSnapshot);

  if (blockers.length) {
    return {
      status: "blocked" as const,
      decision: null,
      targetId,
      contactSnapshot: {
        contactMode: contactSnapshot.contactMode,
        fromEmailConfigured: Boolean(contactSnapshot.fromEmail),
        manualContactApproved: contactSnapshot.manualContactApproved,
        emailProviderConfigured: contactSnapshot.emailProviderConfigured,
      },
      blockers,
      nextCommand: "",
      nextAction: "Resolve blockers before recording this contact path decision.",
      safety: {
        persistsApprovalDecision: false,
        sendsOutreach: false,
        editsEnvironment: false,
        storesSecrets: false,
        chargesClients: false,
      },
    };
  }

  const result = recordRevenueTrustedApprovalDecision({
    targetId,
    targetType: "contact_path",
    decision: options.decision,
    approvedAction: options.approvedAction,
    maxSpendUsd: 0,
    notes: options.evidenceNote,
    approvalSource: "contact_path_approval_cli",
    publicCandidateSnapshotHash: "",
    outreachDraftSnapshotHash: "",
    websiteCreationSnapshotHash: "",
    websitePublishSnapshotHash: "",
    paymentPathSnapshotHash: "",
    contactPathSnapshotHash: buildRevenueContactPathSnapshotHash(contactSnapshot, proof),
    ledgerEntrySnapshotHash: "",
  });
  const nextCommand = options.decision === "approved"
    ? npmRunText("revenue:contact-path-readiness-packet", [
      `--contact-mode=${options.contactMode}`,
      `--approval-decision-id=${result.decision.id}`,
      "--robert-approved-contact-path",
      "--contact-path-verified",
      `--evidence-url=${options.evidenceUrl}`,
      `--evidence-note=${options.evidenceNote}`,
    ])
    : "";

  return {
    status: result.decision.guardrail.status === "recorded" ? "recorded" as const : "blocked" as const,
    decision: result.decision,
    targetId,
    contactSnapshot: {
      contactMode: contactSnapshot.contactMode,
      fromEmailConfigured: Boolean(contactSnapshot.fromEmail),
      manualContactApproved: contactSnapshot.manualContactApproved,
      emailProviderConfigured: contactSnapshot.emailProviderConfigured,
    },
    blockers: result.decision.guardrail.status === "recorded" ? [] : [result.decision.guardrail.reason],
    nextCommand,
    nextAction: nextCommand
      ? "Run the contact path readiness packet; configure env/provider outside tracked files only after this review."
      : "Decision recorded; do not use this contact path unless Robert changes the decision.",
    safety: {
      persistsApprovalDecision: result.decision.guardrail.status === "recorded",
      sendsOutreach: false,
      editsEnvironment: false,
      storesSecrets: false,
      chargesClients: false,
    },
  };
}

export function formatRevenueContactPathApprovalDecisionText(result: ReturnType<typeof buildRevenueContactPathApprovalDecisionFromCli>) {
  return [
    `Revenue contact path approval decision: ${result.status}`,
    `Decision id: ${result.decision?.id || "none"}`,
    `Target: ${result.targetId}`,
    `Contact mode: ${result.contactSnapshot.contactMode}`,
    `From email configured: ${result.contactSnapshot.fromEmailConfigured ? "yes" : "no"}`,
    `Blockers: ${result.blockers.length ? result.blockers.join("; ") : "none"}`,
    `Next command: ${result.nextCommand || "none"}`,
    `Next action: ${result.nextAction}`,
    "",
    "Safety:",
    `- Persists approval decision: ${result.safety.persistsApprovalDecision ? "yes" : "no"}`,
    `- Sends outreach: ${result.safety.sendsOutreach ? "yes" : "no"}`,
    `- Edits environment: ${result.safety.editsEnvironment ? "yes" : "no"}`,
    `- Stores secrets: ${result.safety.storesSecrets ? "yes" : "no"}`,
    `- Charges clients: ${result.safety.chargesClients ? "yes" : "no"}`,
  ].join("\n");
}

export function getRevenueContactPathApprovalDecisionExitCode(result: ReturnType<typeof buildRevenueContactPathApprovalDecisionFromCli>) {
  return result.status === "recorded" ? 0 : 1;
}
