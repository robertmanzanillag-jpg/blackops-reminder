import {
  buildRevenueWebsiteCreationPacket,
  type RevenueWebsiteCreationPacketInput,
} from "./revenue-engine";

export type RevenueWebsiteCreationPacketCliOptions = RevenueWebsiteCreationPacketInput & {
  json: boolean;
};

function getArgValue(argv: string[], name: string) {
  const prefix = `${name}=`;
  const arg = argv.find((value) => value.startsWith(prefix));
  return arg ? arg.slice(prefix.length).trim() : "";
}

export function parseRevenueWebsiteCreationPacketArgs(argv: string[]): RevenueWebsiteCreationPacketCliOptions {
  return {
    outreachDraftId: getArgValue(argv, "--outreach-draft-id"),
    robertApprovedBuild: argv.includes("--robert-approved-build"),
    clientApprovedScope: argv.includes("--client-approved-scope"),
    depositPaid: argv.includes("--deposit-paid"),
    publicDataVerified: argv.includes("--public-data-verified"),
    writeFiles: argv.includes("--write-files"),
    deployWebsite: argv.includes("--deploy-website"),
    launchTargetDays: Number(getArgValue(argv, "--launch-target-days") || 7),
    json: argv.includes("--json"),
  };
}

export function validateRevenueWebsiteCreationPacketOptions(options: RevenueWebsiteCreationPacketCliOptions) {
  const errors: string[] = [];
  if (!options.outreachDraftId) errors.push("--outreach-draft-id is required.");
  if (!Number.isInteger(options.launchTargetDays) || options.launchTargetDays < 1 || options.launchTargetDays > 60) {
    errors.push("--launch-target-days must be an integer from 1 to 60.");
  }
  return errors;
}

export function buildRevenueWebsiteCreationPacketFromCli(options: RevenueWebsiteCreationPacketCliOptions) {
  return buildRevenueWebsiteCreationPacket({
    outreachDraftId: options.outreachDraftId,
    robertApprovedBuild: options.robertApprovedBuild,
    clientApprovedScope: options.clientApprovedScope,
    depositPaid: options.depositPaid,
    publicDataVerified: options.publicDataVerified,
    writeFiles: options.writeFiles,
    deployWebsite: options.deployWebsite,
    launchTargetDays: options.launchTargetDays,
  });
}

export function formatRevenueWebsiteCreationPacketText(packet: ReturnType<typeof buildRevenueWebsiteCreationPacketFromCli>) {
  return [
    `Revenue website creation packet: ${packet.status}`,
    `Outreach draft: ${packet.outreachDraftId}`,
    packet.draft ? `Business: ${packet.draft.businessName}` : "Business: not found",
    "",
    "Gates:",
    ...packet.gates.map((gate) => `- ${gate.gate}: ${gate.passed ? "passed" : `blocked (${gate.fix})`}`),
    "",
    "Safety:",
    `- Writes files: ${packet.safety.writesFiles ? "yes" : "no"}`,
    `- Deploys: ${packet.safety.deploys ? "yes" : "no"}`,
    `- Publishes preview: ${packet.safety.publishesPreview ? "yes" : "no"}`,
    `- Sends outreach: ${packet.safety.sendsOutreach ? "yes" : "no"}`,
    `- Requires Robert approval before build: ${packet.safety.requiresRobertApprovalBeforeBuild ? "yes" : "no"}`,
    `- Requires deposit before build: ${packet.safety.requiresDepositBeforeBuild ? "yes" : "no"}`,
    `- Requires App QA before deploy: ${packet.safety.requiresAppQaBeforeDeploy ? "yes" : "no"}`,
    "",
    packet.scaffold
      ? [
        "Scaffold handoff:",
        `- Status: ${packet.scaffold.status}`,
        `- Files prepared in packet: ${packet.scaffold.fileCount}`,
        `- Can write files: ${packet.scaffold.canWriteFiles ? "yes" : "no"}`,
        `- Can deploy: ${packet.scaffold.canDeploy ? "yes" : "no"}`,
      ].join("\n")
      : [
        "Blocked reasons:",
        ...(packet.blockedReasons.length ? packet.blockedReasons.map((reason) => `- ${reason}`) : ["- none"]),
      ].join("\n"),
    "",
    `Next action: ${packet.nextAction}`,
  ].join("\n");
}

export function getRevenueWebsiteCreationPacketExitCode(packet: ReturnType<typeof buildRevenueWebsiteCreationPacketFromCli>) {
  return packet.status === "blocked" ? 1 : 0;
}
