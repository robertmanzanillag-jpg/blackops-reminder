import {
  buildRevenuePaymentPathReadinessPacket,
  type RevenuePaymentPathReadinessPacketInput,
} from "./revenue-engine";

export type RevenuePaymentPathReadinessPacketCliOptions = RevenuePaymentPathReadinessPacketInput & {
  json: boolean;
};

function getArgValue(argv: string[], name: string) {
  const prefix = `${name}=`;
  const arg = argv.find((value) => value.startsWith(prefix));
  return arg ? arg.slice(prefix.length).trim() : "";
}

function hasPlaceholderValue(value: string) {
  return /\b(REPLACE_WITH|PLACEHOLDER|TODO|TBD|YOUR_)/i.test(value);
}

export function parseRevenuePaymentPathReadinessPacketArgs(argv: string[]): RevenuePaymentPathReadinessPacketCliOptions {
  return {
    paymentLink: getArgValue(argv, "--payment-link"),
    approvalDecisionId: getArgValue(argv, "--approval-decision-id"),
    robertApprovedPaymentPath: argv.includes("--robert-approved-payment-path"),
    paymentSmokeVerified: argv.includes("--payment-smoke-verified"),
    depositConfirmedByRobert: argv.includes("--deposit-confirmed-by-robert"),
    expectedDepositUsd: Number(getArgValue(argv, "--expected-deposit-usd") || 0),
    expectedPackage: getArgValue(argv, "--expected-package"),
    evidenceUrl: getArgValue(argv, "--evidence-url"),
    evidenceNote: getArgValue(argv, "--evidence-note"),
    chargeClient: argv.includes("--charge-client"),
    json: argv.includes("--json"),
  };
}

export function validateRevenuePaymentPathReadinessPacketOptions(options: RevenuePaymentPathReadinessPacketCliOptions) {
  const errors: string[] = [];
  if (!options.paymentLink) errors.push("--payment-link is required.");
  if (!Number.isFinite(options.expectedDepositUsd) || options.expectedDepositUsd < 1 || options.expectedDepositUsd > 1000000) {
    errors.push("--expected-deposit-usd must be from 1 to 1000000.");
  }
  if (!options.expectedPackage) errors.push("--expected-package is required.");
  if (!options.evidenceUrl) errors.push("--evidence-url is required.");
  else if (hasPlaceholderValue(options.evidenceUrl)) errors.push("--evidence-url must be real evidence, not a placeholder.");
  if (!options.evidenceNote) errors.push("--evidence-note is required.");
  else if (hasPlaceholderValue(options.evidenceNote)) errors.push("--evidence-note must be real proof, not a placeholder.");
  return errors;
}

export function buildRevenuePaymentPathReadinessPacketFromCli(options: RevenuePaymentPathReadinessPacketCliOptions) {
  return buildRevenuePaymentPathReadinessPacket({
    paymentLink: options.paymentLink,
    approvalDecisionId: options.approvalDecisionId,
    robertApprovedPaymentPath: options.robertApprovedPaymentPath,
    paymentSmokeVerified: options.paymentSmokeVerified,
    depositConfirmedByRobert: options.depositConfirmedByRobert,
    expectedDepositUsd: options.expectedDepositUsd,
    expectedPackage: options.expectedPackage,
    evidenceUrl: options.evidenceUrl,
    evidenceNote: options.evidenceNote,
    chargeClient: options.chargeClient,
  });
}

export function formatRevenuePaymentPathReadinessPacketText(packet: ReturnType<typeof buildRevenuePaymentPathReadinessPacketFromCli>) {
  return [
    `Revenue payment path readiness packet: ${packet.status}`,
    `Payment host: ${packet.paymentSnapshot.paymentHost}`,
    `Expected deposit: $${packet.paymentSnapshot.expectedDepositUsd}`,
    `Expected package: ${packet.paymentSnapshot.expectedPackage}`,
    `Approval decision: ${packet.approvalDecisionId || "none"}`,
    "",
    "Gates:",
    ...packet.gates.map((gate) => `- ${gate.gate}: ${gate.passed ? "passed" : `blocked (${gate.fix})`}`),
    "",
    "Safety:",
    `- Charges clients: ${packet.safety.chargesClients ? "yes" : "no"}`,
    `- Edits environment: ${packet.safety.editsEnvironment ? "yes" : "no"}`,
    `- Stores secrets: ${packet.safety.storesSecrets ? "yes" : "no"}`,
    `- Records ledger entry: ${packet.safety.recordsLedgerEntry ? "yes" : "no"}`,
    `- Sends outreach: ${packet.safety.sendsOutreach ? "yes" : "no"}`,
    "",
    packet.blockedReasons.length
      ? ["Blocked reasons:", ...packet.blockedReasons.map((reason) => `- ${reason}`)].join("\n")
      : "Blocked reasons: none",
    "",
    `Next action: ${packet.nextAction}`,
  ].join("\n");
}

export function getRevenuePaymentPathReadinessPacketExitCode(packet: ReturnType<typeof buildRevenuePaymentPathReadinessPacketFromCli>) {
  return packet.status === "blocked" ? 1 : 0;
}
