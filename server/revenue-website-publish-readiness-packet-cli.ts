import {
  buildRevenueWebsitePublishReadinessPacket,
  type RevenueWebsitePublishReadinessPacketInput,
} from "./revenue-engine";

export type RevenueWebsitePublishReadinessPacketCliOptions = RevenueWebsitePublishReadinessPacketInput & {
  json: boolean;
};

function getArgValue(argv: string[], name: string) {
  const prefix = `${name}=`;
  const arg = argv.find((value) => value.startsWith(prefix));
  return arg ? arg.slice(prefix.length).trim() : "";
}

function hasPlaceholderValue(value: string) {
  return /\b(REPLACE_WITH|PLACEHOLDER|TODO|TBD|YOUR_|OUTREACH_ID|APPROVAL_ID)/i.test(value);
}

export function parseRevenueWebsitePublishReadinessPacketArgs(argv: string[]): RevenueWebsitePublishReadinessPacketCliOptions {
  return {
    outreachDraftId: getArgValue(argv, "--outreach-draft-id"),
    websiteCreationApprovalDecisionId: getArgValue(argv, "--website-creation-approval-decision-id"),
    publishApprovalDecisionId: getArgValue(argv, "--publish-approval-decision-id"),
    robertApprovedPublish: argv.includes("--robert-approved-publish"),
    previewDeployVerified: argv.includes("--preview-deploy-verified"),
    appQaTargetPassed: argv.includes("--app-qa-target-passed"),
    rollbackVerified: argv.includes("--rollback-verified"),
    deployProvider: getArgValue(argv, "--deploy-provider"),
    previewDeployUrl: getArgValue(argv, "--preview-deploy-url"),
    appQaEvidenceUrl: getArgValue(argv, "--app-qa-evidence-url"),
    rollbackPlanUrl: getArgValue(argv, "--rollback-plan-url"),
    writeFiles: argv.includes("--write-files"),
    deployWebsite: argv.includes("--deploy-website"),
    launchTargetDays: Number(getArgValue(argv, "--launch-target-days") || 7),
    json: argv.includes("--json"),
  };
}

export function validateRevenueWebsitePublishReadinessPacketOptions(options: RevenueWebsitePublishReadinessPacketCliOptions) {
  const errors: string[] = [];
  if (!options.outreachDraftId) errors.push("--outreach-draft-id is required.");
  else if (hasPlaceholderValue(options.outreachDraftId)) errors.push("--outreach-draft-id must be a real outreach draft id, not a placeholder.");
  if (!options.websiteCreationApprovalDecisionId) errors.push("--website-creation-approval-decision-id is required.");
  else if (hasPlaceholderValue(options.websiteCreationApprovalDecisionId)) errors.push("--website-creation-approval-decision-id must be a real approval decision id, not a placeholder.");
  if (options.publishApprovalDecisionId && hasPlaceholderValue(options.publishApprovalDecisionId)) {
    errors.push("--publish-approval-decision-id must be a real approval decision id, not a placeholder.");
  }
  if (!options.deployProvider) errors.push("--deploy-provider is required.");
  else if (hasPlaceholderValue(options.deployProvider)) errors.push("--deploy-provider must be real publish context, not a placeholder.");
  if (!options.previewDeployUrl) errors.push("--preview-deploy-url is required.");
  else if (hasPlaceholderValue(options.previewDeployUrl)) errors.push("--preview-deploy-url must be real evidence, not a placeholder.");
  if (!options.appQaEvidenceUrl) errors.push("--app-qa-evidence-url is required.");
  else if (hasPlaceholderValue(options.appQaEvidenceUrl)) errors.push("--app-qa-evidence-url must be real evidence, not a placeholder.");
  if (!options.rollbackPlanUrl) errors.push("--rollback-plan-url is required.");
  else if (hasPlaceholderValue(options.rollbackPlanUrl)) errors.push("--rollback-plan-url must be real evidence, not a placeholder.");
  if (!Number.isInteger(options.launchTargetDays) || options.launchTargetDays < 1 || options.launchTargetDays > 60) {
    errors.push("--launch-target-days must be an integer from 1 to 60.");
  }
  return errors;
}

export function buildRevenueWebsitePublishReadinessPacketFromCli(options: RevenueWebsitePublishReadinessPacketCliOptions) {
  const validationErrors = validateRevenueWebsitePublishReadinessPacketOptions(options);
  const packet = buildRevenueWebsitePublishReadinessPacket({
    outreachDraftId: options.outreachDraftId,
    websiteCreationApprovalDecisionId: options.websiteCreationApprovalDecisionId,
    publishApprovalDecisionId: options.publishApprovalDecisionId,
    robertApprovedPublish: options.robertApprovedPublish,
    previewDeployVerified: options.previewDeployVerified,
    appQaTargetPassed: options.appQaTargetPassed,
    rollbackVerified: options.rollbackVerified,
    deployProvider: options.deployProvider,
    previewDeployUrl: options.previewDeployUrl,
    appQaEvidenceUrl: options.appQaEvidenceUrl,
    rollbackPlanUrl: options.rollbackPlanUrl,
    writeFiles: options.writeFiles,
    deployWebsite: options.deployWebsite,
    launchTargetDays: options.launchTargetDays,
  });

  if (validationErrors.length === 0) return packet;

  return {
    ...packet,
    status: "blocked" as const,
    gates: [
      { gate: "cli_options", passed: false, fix: validationErrors.join(" ") },
      ...packet.gates,
    ],
    blockedReasons: [
      ...validationErrors,
      ...packet.blockedReasons,
    ],
  };
}

export function formatRevenueWebsitePublishReadinessPacketText(packet: ReturnType<typeof buildRevenueWebsitePublishReadinessPacketFromCli>) {
  return [
    `Revenue website publish readiness packet: ${packet.status}`,
    `Outreach draft: ${packet.outreachDraftId}`,
    `Creation approval: ${packet.websiteCreationApprovalDecisionId}`,
    `Publish approval: ${packet.publishApprovalDecisionId || "none"}`,
    packet.creationPacket.draft ? `Business: ${packet.creationPacket.draft.businessName}` : "Business: not found",
    "",
    "Gates:",
    ...packet.gates.map((gate) => `- ${gate.gate}: ${gate.passed ? "passed" : `blocked (${gate.fix})`}`),
    "",
    "Evidence:",
    `- Deploy provider: ${packet.evidence.deployProvider}`,
    `- Preview deploy URL: ${packet.evidence.previewDeployUrl}`,
    `- App QA evidence URL: ${packet.evidence.appQaEvidenceUrl}`,
    `- Rollback plan URL: ${packet.evidence.rollbackPlanUrl}`,
    "",
    "Safety:",
    `- Writes files: ${packet.safety.writesFiles ? "yes" : "no"}`,
    `- Deploys: ${packet.safety.deploys ? "yes" : "no"}`,
    `- Publishes website: ${packet.safety.publishesWebsite ? "yes" : "no"}`,
    `- Sends outreach: ${packet.safety.sendsOutreach ? "yes" : "no"}`,
    `- Charges clients: ${packet.safety.chargesClients ? "yes" : "no"}`,
    packet.creationPacket.scaffold
      ? [
        "",
        "Scaffold:",
        `- Status: ${packet.creationPacket.scaffold.status}`,
        `- Slug: ${packet.creationPacket.scaffold.slug}`,
        `- Files prepared in packet: ${packet.creationPacket.scaffold.fileCount}`,
      ].join("\n")
      : "",
    "",
    packet.blockedReasons.length
      ? [
        "Blocked reasons:",
        ...packet.blockedReasons.map((reason) => `- ${reason}`),
      ].join("\n")
      : "Blocked reasons: none",
    "",
    `Next action: ${packet.nextAction}`,
  ].filter(Boolean).join("\n");
}

export function getRevenueWebsitePublishReadinessPacketExitCode(packet: ReturnType<typeof buildRevenueWebsitePublishReadinessPacketFromCli>) {
  return packet.status === "blocked" ? 1 : 0;
}
