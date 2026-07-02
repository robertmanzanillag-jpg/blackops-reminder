import { createHash } from "node:crypto";
import {
  buildRevenueWebsiteCreationPacket,
  recordRevenueTrustedApprovalDecision,
} from "./revenue-engine";
import {
  buildRevenueWebsitePublishApprovalTargetId,
  buildRevenueWebsitePublishSnapshotHash,
} from "./revenue-website-publish-approval";

export type RevenueWebsitePublishApprovalDecisionCliOptions = {
  outreachDraftId: string;
  websiteCreationApprovalDecisionId: string;
  decision: "approved" | "rejected" | "needs_changes";
  approvedAction: string;
  notes: string;
  robertApprovedPublish: boolean;
  previewDeployVerified: boolean;
  appQaTargetPassed: boolean;
  rollbackVerified: boolean;
  deployProvider: string;
  previewDeployUrl: string;
  appQaEvidenceUrl: string;
  rollbackPlanUrl: string;
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

function isValidUrl(value: string) {
  try {
    new URL(value);
    return true;
  } catch {
    return false;
  }
}

function buildScaffoldFilesHash(files: Array<{ path: string; purpose: string; content: string }>) {
  const payload = files.map((file) => ({
    path: file.path,
    purpose: file.purpose,
    content: file.content,
  }));

  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

export function parseRevenueWebsitePublishApprovalDecisionArgs(argv: string[]): RevenueWebsitePublishApprovalDecisionCliOptions {
  return {
    outreachDraftId: getArgValue(argv, "--outreach-draft-id"),
    websiteCreationApprovalDecisionId: getArgValue(argv, "--website-creation-approval-decision-id"),
    decision: (getArgValue(argv, "--decision") || "needs_changes") as RevenueWebsitePublishApprovalDecisionCliOptions["decision"],
    approvedAction: getArgValue(argv, "--approved-action") || "Approve exact website publish readiness handoff after preview, App QA, rollback, and Robert review.",
    notes: getArgValue(argv, "--notes"),
    robertApprovedPublish: argv.includes("--robert-approved-publish"),
    previewDeployVerified: argv.includes("--preview-deploy-verified"),
    appQaTargetPassed: argv.includes("--app-qa-target-passed"),
    rollbackVerified: argv.includes("--rollback-verified"),
    deployProvider: getArgValue(argv, "--deploy-provider"),
    previewDeployUrl: getArgValue(argv, "--preview-deploy-url"),
    appQaEvidenceUrl: getArgValue(argv, "--app-qa-evidence-url"),
    rollbackPlanUrl: getArgValue(argv, "--rollback-plan-url"),
    launchTargetDays: Number(getArgValue(argv, "--launch-target-days") || 7),
    confirmedByRobert: argv.includes("--confirmed-by-robert"),
    json: argv.includes("--json"),
  };
}

export function validateRevenueWebsitePublishApprovalDecisionOptions(options: RevenueWebsitePublishApprovalDecisionCliOptions) {
  const errors: string[] = [];
  if (!options.outreachDraftId) errors.push("--outreach-draft-id is required.");
  if (!options.websiteCreationApprovalDecisionId) errors.push("--website-creation-approval-decision-id is required.");
  if (!["approved", "rejected", "needs_changes"].includes(options.decision)) {
    errors.push("--decision must be approved, rejected, or needs_changes.");
  }
  if (options.approvedAction.trim().length < 8) {
    errors.push("--approved-action must describe the approved/rejected action.");
  }
  if (!options.deployProvider) errors.push("--deploy-provider is required.");
  if (!options.previewDeployUrl) errors.push("--preview-deploy-url is required.");
  else if (!isValidUrl(options.previewDeployUrl)) errors.push("--preview-deploy-url must be a valid URL.");
  if (!options.appQaEvidenceUrl) errors.push("--app-qa-evidence-url is required.");
  else if (!isValidUrl(options.appQaEvidenceUrl)) errors.push("--app-qa-evidence-url must be a valid URL.");
  if (!options.rollbackPlanUrl) errors.push("--rollback-plan-url is required.");
  else if (!isValidUrl(options.rollbackPlanUrl)) errors.push("--rollback-plan-url must be a valid URL.");
  if (!Number.isInteger(options.launchTargetDays) || options.launchTargetDays < 1 || options.launchTargetDays > 60) {
    errors.push("--launch-target-days must be an integer from 1 to 60.");
  }
  return errors;
}

export function buildRevenueWebsitePublishApprovalDecisionFromCli(options: RevenueWebsitePublishApprovalDecisionCliOptions) {
  const creationPacket = buildRevenueWebsiteCreationPacket({
    outreachDraftId: options.outreachDraftId,
    approvalDecisionId: options.websiteCreationApprovalDecisionId,
    robertApprovedBuild: true,
    clientApprovedScope: true,
    depositPaid: true,
    publicDataVerified: true,
    writeFiles: false,
    deployWebsite: false,
    launchTargetDays: options.launchTargetDays,
  });
  const proof = {
    robertApprovedPublish: options.robertApprovedPublish,
    previewDeployVerified: options.previewDeployVerified,
    appQaTargetPassed: options.appQaTargetPassed,
    rollbackVerified: options.rollbackVerified,
    deployProvider: options.deployProvider,
    previewDeployUrl: options.previewDeployUrl,
    appQaEvidenceUrl: options.appQaEvidenceUrl,
    rollbackPlanUrl: options.rollbackPlanUrl,
  };
  const publishSnapshot = creationPacket.draft && creationPacket.scaffold && creationPacket.scaffoldInput ? {
    outreachDraftId: options.outreachDraftId,
    websiteCreationApprovalDecisionId: options.websiteCreationApprovalDecisionId,
    businessName: creationPacket.draft.businessName,
    scaffoldSlug: creationPacket.scaffold.slug,
    scaffoldFileCount: creationPacket.scaffold.fileCount,
    scaffoldInput: creationPacket.scaffoldInput,
    scaffoldFilesHash: buildScaffoldFilesHash(creationPacket.scaffold.files),
    packageName: creationPacket.scaffoldInput.packageName,
    setupUsd: creationPacket.scaffoldInput.setupUsd,
    monthlyRetainerUsd: creationPacket.scaffoldInput.monthlyRetainerUsd,
  } : null;
  const approvalBlockers = [
    creationPacket.status !== "ready_for_website_creation_handoff" && "website creation packet must be ready before publish approval.",
    !options.robertApprovedPublish && "--robert-approved-publish is required for approved publish readiness.",
    !options.previewDeployVerified && "--preview-deploy-verified is required for approved publish readiness.",
    !options.appQaTargetPassed && "--app-qa-target-passed is required for approved publish readiness.",
    !options.rollbackVerified && "--rollback-verified is required for approved publish readiness.",
  ].filter((item): item is string => Boolean(item));
  const blockers = [
    !options.confirmedByRobert && "--confirmed-by-robert is required to record a website publish decision.",
    !publishSnapshot && "website publish snapshot could not be built from the creation packet.",
    ...(options.decision === "approved" ? approvalBlockers : []),
  ].filter((item): item is string => Boolean(item));
  const targetId = buildRevenueWebsitePublishApprovalTargetId(options.outreachDraftId);

  if (blockers.length || !publishSnapshot) {
    return {
      status: "blocked" as const,
      decision: null,
      targetId,
      outreachDraftId: options.outreachDraftId,
      blockers,
      nextCommand: "",
      nextAction: "Resolve blockers before recording this website publish decision.",
      safety: {
        persistsApprovalDecision: false,
        writesFiles: false,
        deploys: false,
        publishesWebsite: false,
        sendsOutreach: false,
        chargesClients: false,
        paidDataSpendUsd: 0,
      },
    };
  }

  const result = recordRevenueTrustedApprovalDecision({
    targetId,
    targetType: "website_publish",
    decision: options.decision,
    approvedAction: options.approvedAction,
    maxSpendUsd: 0,
    notes: options.notes,
    approvalSource: "website_publish_approval_cli",
    publicCandidateSnapshotHash: "",
    outreachDraftSnapshotHash: "",
    websiteCreationSnapshotHash: "",
    websitePublishSnapshotHash: buildRevenueWebsitePublishSnapshotHash(publishSnapshot, proof),
    paymentPathSnapshotHash: "",
    ledgerEntrySnapshotHash: "",
  });
  const nextCommand = options.decision === "approved"
    ? npmRunText("revenue:website-publish-readiness-packet", [
      `--outreach-draft-id=${options.outreachDraftId}`,
      `--website-creation-approval-decision-id=${options.websiteCreationApprovalDecisionId}`,
      `--publish-approval-decision-id=${result.decision.id}`,
      "--robert-approved-publish",
      "--preview-deploy-verified",
      "--app-qa-target-passed",
      "--rollback-verified",
      `--deploy-provider=${options.deployProvider}`,
      `--preview-deploy-url=${options.previewDeployUrl}`,
      `--app-qa-evidence-url=${options.appQaEvidenceUrl}`,
      `--rollback-plan-url=${options.rollbackPlanUrl}`,
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
      ? "Run the publish readiness packet command; it still cannot deploy or publish."
      : "Decision recorded; do not publish unless Robert changes the decision.",
    safety: {
      persistsApprovalDecision: result.decision.guardrail.status === "recorded",
      writesFiles: false,
      deploys: false,
      publishesWebsite: false,
      sendsOutreach: false,
      chargesClients: false,
      paidDataSpendUsd: 0,
    },
  };
}

export function formatRevenueWebsitePublishApprovalDecisionText(result: ReturnType<typeof buildRevenueWebsitePublishApprovalDecisionFromCli>) {
  return [
    `Revenue website publish approval decision: ${result.status}`,
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
    `- Publishes website: ${result.safety.publishesWebsite ? "yes" : "no"}`,
    `- Sends outreach: ${result.safety.sendsOutreach ? "yes" : "no"}`,
    `- Charges clients: ${result.safety.chargesClients ? "yes" : "no"}`,
    `- Paid data spend: $${result.safety.paidDataSpendUsd}`,
  ].join("\n");
}

export function getRevenueWebsitePublishApprovalDecisionExitCode(result: ReturnType<typeof buildRevenueWebsitePublishApprovalDecisionFromCli>) {
  return result.status === "recorded" ? 0 : 1;
}
