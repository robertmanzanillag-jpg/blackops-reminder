import {
  buildRevenueOutreachApprovalPacket,
  type RevenueOutreachApprovalPacketInput,
} from "./revenue-engine";

export type RevenueOutreachApprovalPacketCliOptions = RevenueOutreachApprovalPacketInput & {
  json: boolean;
};

function getArgValue(argv: string[], name: string) {
  const prefix = `${name}=`;
  const arg = argv.find((value) => value.startsWith(prefix));
  return arg ? arg.slice(prefix.length).trim() : "";
}

function displayText(value: string | number) {
  return String(value)
    .replace(/[\p{Cf}\u0000-\u001f\u007f-\u009f]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function displayBlock(value: string) {
  return displayText(value);
}

export function parseRevenueOutreachApprovalPacketArgs(argv: string[]): RevenueOutreachApprovalPacketCliOptions {
  return {
    maxDrafts: Number(getArgValue(argv, "--max-drafts") || 10),
    includeSent: argv.includes("--include-sent"),
    json: argv.includes("--json"),
  };
}

export function validateRevenueOutreachApprovalPacketOptions(options: RevenueOutreachApprovalPacketCliOptions) {
  const errors: string[] = [];
  if (!Number.isInteger(options.maxDrafts) || options.maxDrafts < 1 || options.maxDrafts > 50) {
    errors.push("--max-drafts must be an integer from 1 to 50.");
  }
  return errors;
}

export function buildRevenueOutreachApprovalPacketFromCli(options: RevenueOutreachApprovalPacketCliOptions) {
  return buildRevenueOutreachApprovalPacket({
    maxDrafts: options.maxDrafts,
    includeSent: options.includeSent,
  });
}

export function formatRevenueOutreachApprovalPacketText(packet: ReturnType<typeof buildRevenueOutreachApprovalPacketFromCli>) {
  const lines = [
    `Revenue outreach approval packet: ${packet.status}`,
    `Provider configured: ${packet.provider.configured ? "yes" : "no"}`,
    packet.provider.missing.length ? `Provider missing: ${packet.provider.missing.join(", ")}` : "",
    "",
    "Totals:",
    `- Reviewed: ${packet.totals.reviewed}`,
    `- Ready for Robert approval: ${packet.totals.readyForManualApproval}`,
    `- Ready for provider send review: ${packet.totals.readyForProviderSend}`,
    `- Blocked: ${packet.totals.blocked}`,
    `- Projected setup: $${packet.totals.projectedSetupUsd}`,
    `- Projected required deposit: $${packet.totals.projectedRequiredDepositUsd}`,
    "",
    "Safety:",
    `- Sends outreach: ${packet.safety.sendsOutreach ? "yes" : "no"}`,
    `- Persists data: ${packet.safety.persistsData ? "yes" : "no"}`,
    `- Charges clients: ${packet.safety.chargesClients ? "yes" : "no"}`,
    `- Requires Robert approval before send: ${packet.safety.requiresRobertApprovalBeforeSend ? "yes" : "no"}`,
    "",
    "Drafts:",
    ...(packet.items.length
      ? packet.items.map((item) => [
        `- ${displayText(item.businessName)} (${item.draftId})`,
        `  status=${item.status}; sendStatus=${item.sendStatus}; channel=${displayText(item.channel)}`,
        `  recipient=${displayText(item.recipientEmail || "none")}`,
        `  subject=${displayText(item.subject)}`,
        `  source=${displayText(item.sourceUrl || "none")}`,
        `  setup=$${item.estimatedSetupUsd}; requiredDeposit=$${item.requiredDepositUsd}; retainer=$${item.monthlyRetainerUsd}`,
        `  summary=${displayText(item.businessSummary || "none")}`,
        `  body=${displayBlock(item.body)}`,
        `  manualApproval=${item.readyForManualApproval ? "yes" : "no"}; providerSend=${item.readyForProviderSend ? "yes" : "no"}`,
        item.blockedReasons.length ? `  blocked=${item.blockedReasons.join("; ")}` : "",
      ].filter(Boolean).join("\n"))
      : ["- none"]),
    "",
    `Next action: ${packet.nextAction}`,
  ].filter(Boolean);

  return lines.join("\n");
}

export function getRevenueOutreachApprovalPacketExitCode(packet: ReturnType<typeof buildRevenueOutreachApprovalPacketFromCli>) {
  return packet.status === "empty" || packet.status === "needs_fixes" ? 1 : 0;
}
