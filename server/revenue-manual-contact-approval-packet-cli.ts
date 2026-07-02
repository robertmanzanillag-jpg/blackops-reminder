import {
  buildRevenueManualContactApprovalPacket,
  type RevenueManualContactApprovalPacketInput,
} from "./revenue-engine";

export type RevenueManualContactApprovalPacketCliOptions = RevenueManualContactApprovalPacketInput & {
  json: boolean;
};

function getArgValue(argv: string[], name: string) {
  const prefix = `${name}=`;
  const arg = argv.find((value) => value.startsWith(prefix));
  return arg ? arg.slice(prefix.length).trim() : "";
}

export function parseRevenueManualContactApprovalPacketArgs(argv: string[]): RevenueManualContactApprovalPacketCliOptions {
  return {
    maxCandidates: Number(getArgValue(argv, "--max-candidates") || 10),
    json: argv.includes("--json"),
  };
}

export function validateRevenueManualContactApprovalPacketOptions(options: RevenueManualContactApprovalPacketCliOptions) {
  const errors: string[] = [];
  if (!Number.isInteger(options.maxCandidates) || options.maxCandidates < 1 || options.maxCandidates > 50) {
    errors.push("--max-candidates must be an integer from 1 to 50.");
  }
  return errors;
}

export function buildRevenueManualContactApprovalPacketFromCli(options: RevenueManualContactApprovalPacketCliOptions) {
  return buildRevenueManualContactApprovalPacket({
    maxCandidates: options.maxCandidates,
  });
}

export function formatRevenueManualContactApprovalPacketText(packet: ReturnType<typeof buildRevenueManualContactApprovalPacketFromCli>) {
  return [
    `Revenue manual contact approval packet: ${packet.status}`,
    `Manual contact candidates: ${packet.manualContactCount}`,
    `Next action: ${packet.nextAction}`,
    "",
    "Safety:",
    `- Persists data: ${packet.safety.persistsData ? "yes" : "no"}`,
    `- Imports leads: ${packet.safety.importsLeads ? "yes" : "no"}`,
    `- Sends outreach: ${packet.safety.sendsOutreach ? "yes" : "no"}`,
    `- Writes preview files: ${packet.safety.writesPreviewFiles ? "yes" : "no"}`,
    `- Paid data spend: $${packet.safety.paidDataSpendUsd}`,
    `- Requires Robert approval before contact: ${packet.safety.requiresRobertApprovalBeforeContact ? "yes" : "no"}`,
    "",
    "Candidates:",
    ...(packet.items.length
      ? packet.items.flatMap((item, index) => [
        `${index + 1}. ${item.businessName} (${item.area})`,
        `   Candidate: ${item.candidateId}`,
        `   Channel: ${item.contactChannel}`,
        `   Contact: ${item.contactValue}`,
        `   Source: ${item.sourceUrl}`,
        `   Required: ${item.requiredBeforeContact.join("; ")}`,
        `   Opening: ${item.suggestedManualOpening}`,
      ])
      : ["- none"]),
  ].join("\n");
}

export function getRevenueManualContactApprovalPacketExitCode(packet: ReturnType<typeof buildRevenueManualContactApprovalPacketFromCli>) {
  return packet.manualContactCount > 0 ? 0 : 1;
}
