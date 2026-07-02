import {
  buildRevenueContactPathReadinessPacket,
  type RevenueContactPathReadinessPacketInput,
} from "./revenue-engine";

export type RevenueContactPathReadinessPacketCliOptions = RevenueContactPathReadinessPacketInput & {
  json: boolean;
};

function getArgValue(argv: string[], name: string) {
  const prefix = `${name}=`;
  const arg = argv.find((value) => value.startsWith(prefix));
  return arg ? arg.slice(prefix.length).trim() : "";
}

function parseContactMode(value: string): RevenueContactPathReadinessPacketInput["contactMode"] {
  return value === "email_provider" ? "email_provider" : "manual";
}

function hasPlaceholderValue(value: string) {
  return /\b(REPLACE_WITH|PLACEHOLDER|TODO|TBD|YOUR_)/i.test(value);
}

export function parseRevenueContactPathReadinessPacketArgs(argv: string[]): RevenueContactPathReadinessPacketCliOptions {
  return {
    contactMode: parseContactMode(getArgValue(argv, "--contact-mode")),
    approvalDecisionId: getArgValue(argv, "--approval-decision-id"),
    robertApprovedContactPath: argv.includes("--robert-approved-contact-path"),
    contactPathVerified: argv.includes("--contact-path-verified"),
    evidenceUrl: getArgValue(argv, "--evidence-url"),
    evidenceNote: getArgValue(argv, "--evidence-note"),
    sendOutreach: argv.includes("--send-outreach"),
    json: argv.includes("--json"),
  };
}

export function validateRevenueContactPathReadinessPacketOptions(options: RevenueContactPathReadinessPacketCliOptions) {
  const errors: string[] = [];
  if (!["manual", "email_provider"].includes(options.contactMode)) errors.push("--contact-mode must be manual or email_provider.");
  if (!options.evidenceUrl) errors.push("--evidence-url is required.");
  else if (hasPlaceholderValue(options.evidenceUrl)) errors.push("--evidence-url must be real evidence, not a placeholder.");
  if (!options.evidenceNote) errors.push("--evidence-note is required.");
  else if (hasPlaceholderValue(options.evidenceNote)) errors.push("--evidence-note must be real proof, not a placeholder.");
  return errors;
}

export function buildRevenueContactPathReadinessPacketFromCli(options: RevenueContactPathReadinessPacketCliOptions) {
  return buildRevenueContactPathReadinessPacket({
    contactMode: options.contactMode,
    approvalDecisionId: options.approvalDecisionId,
    robertApprovedContactPath: options.robertApprovedContactPath,
    contactPathVerified: options.contactPathVerified,
    evidenceUrl: options.evidenceUrl,
    evidenceNote: options.evidenceNote,
    sendOutreach: options.sendOutreach,
  });
}

export function formatRevenueContactPathReadinessPacketText(packet: ReturnType<typeof buildRevenueContactPathReadinessPacketFromCli>) {
  return [
    `Revenue contact path readiness packet: ${packet.status}`,
    `Contact mode: ${packet.contactSnapshot.contactMode}`,
    `From email configured: ${packet.contactSnapshot.fromEmailConfigured ? "yes" : "no"}`,
    `Manual contact approved: ${packet.contactSnapshot.manualContactApproved ? "yes" : "no"}`,
    `Email provider configured: ${packet.contactSnapshot.emailProviderConfigured ? "yes" : "no"}`,
    `Approval decision: ${packet.approvalDecisionId || "none"}`,
    "",
    "Gates:",
    ...packet.gates.map((gate) => `- ${gate.gate}: ${gate.passed ? "passed" : `blocked (${gate.fix})`}`),
    "",
    "Safety:",
    `- Sends outreach: ${packet.safety.sendsOutreach ? "yes" : "no"}`,
    `- Edits environment: ${packet.safety.editsEnvironment ? "yes" : "no"}`,
    `- Stores secrets: ${packet.safety.storesSecrets ? "yes" : "no"}`,
    `- Charges clients: ${packet.safety.chargesClients ? "yes" : "no"}`,
    `- Publishes websites: ${packet.safety.publishesWebsites ? "yes" : "no"}`,
    "",
    packet.blockedReasons.length
      ? ["Blocked reasons:", ...packet.blockedReasons.map((reason) => `- ${reason}`)].join("\n")
      : "Blocked reasons: none",
    "",
    `Next action: ${packet.nextAction}`,
  ].join("\n");
}

export function getRevenueContactPathReadinessPacketExitCode(packet: ReturnType<typeof buildRevenueContactPathReadinessPacketFromCli>) {
  return packet.status === "blocked" ? 1 : 0;
}
