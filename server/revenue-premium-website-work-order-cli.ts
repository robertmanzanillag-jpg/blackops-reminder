import {
  buildRevenueWebsiteCreationPacketFromCli,
  formatRevenueWebsiteCreationPacketText,
  parseRevenueWebsiteCreationPacketArgs,
  validateRevenueWebsiteCreationPacketOptions,
  type RevenueWebsiteCreationPacketCliOptions,
} from "./revenue-website-creation-packet-cli";

export type RevenuePremiumWebsiteWorkOrderCliOptions = RevenueWebsiteCreationPacketCliOptions & {
  targetRepo: string;
  targetProject: string;
  branchName: string;
  qaRoute: string;
  previewUrl: string;
  productionUrl: string;
  deployProvider: string;
  healthUrl: string;
  buildCommand: string;
  testCommand: string;
  publishPreview: boolean;
  contactClient: boolean;
};

function getArgValue(argv: string[], name: string) {
  const prefix = `${name}=`;
  const arg = argv.find((value) => value.startsWith(prefix));
  return arg ? arg.slice(prefix.length).trim() : "";
}

function slugifyWorkOrderValue(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "premium-website";
}

function isSafeNpmRunCommand(value: string) {
  const trimmed = value.trim();
  if (!/^npm run [a-z0-9:_-]+(?: -- [a-z0-9._=:/@ -]+)?$/i.test(trimmed)) return false;
  return !/[;&|`$<>\n\r]/.test(trimmed);
}

export function parseRevenuePremiumWebsiteWorkOrderArgs(argv: string[]): RevenuePremiumWebsiteWorkOrderCliOptions {
  const packetOptions = parseRevenueWebsiteCreationPacketArgs(argv);
  const branchName = getArgValue(argv, "--branch-name");
  const outreachSlug = slugifyWorkOrderValue(packetOptions.outreachDraftId || "outreach");

  return {
    ...packetOptions,
    targetRepo: getArgValue(argv, "--target-repo"),
    targetProject: getArgValue(argv, "--target-project") || "premium-client-website",
    branchName: branchName || `codex/premium-website-${outreachSlug}`,
    qaRoute: getArgValue(argv, "--qa-route") || "/",
    previewUrl: getArgValue(argv, "--preview-url"),
    productionUrl: getArgValue(argv, "--production-url"),
    deployProvider: getArgValue(argv, "--deploy-provider") || "replit",
    healthUrl: getArgValue(argv, "--health-url"),
    buildCommand: getArgValue(argv, "--build-command") || "npm run build",
    testCommand: getArgValue(argv, "--test-command") || "npm run test:app-qa-agent",
    publishPreview: argv.includes("--publish-preview"),
    contactClient: argv.includes("--contact-client"),
  };
}

export function validateRevenuePremiumWebsiteWorkOrderOptions(options: RevenuePremiumWebsiteWorkOrderCliOptions) {
  const errors = validateRevenueWebsiteCreationPacketOptions(options);
  if (!/^[^/\s]+\/[^/\s]+$/.test(options.targetRepo)) {
    errors.push("--target-repo is required in owner/repo format.");
  }
  if (!options.targetProject || options.targetProject.length < 2) {
    errors.push("--target-project must be at least 2 characters.");
  }
  if (!options.branchName.startsWith("codex/")) {
    errors.push("--branch-name must start with codex/.");
  }
  if (!options.qaRoute.startsWith("/")) {
    errors.push("--qa-route must start with /.");
  }
  if (!options.deployProvider || options.deployProvider.length < 2) {
    errors.push("--deploy-provider must be at least 2 characters.");
  }
  if (!options.buildCommand || options.buildCommand.length < 2) {
    errors.push("--build-command must be at least 2 characters.");
  } else if (!isSafeNpmRunCommand(options.buildCommand)) {
    errors.push("--build-command must be a safe npm run command without shell metacharacters.");
  }
  if (!options.testCommand || options.testCommand.length < 2) {
    errors.push("--test-command must be at least 2 characters.");
  } else if (!isSafeNpmRunCommand(options.testCommand)) {
    errors.push("--test-command must be a safe npm run command without shell metacharacters.");
  }
  return errors;
}

export function buildRevenuePremiumWebsiteWorkOrderFromCli(options: RevenuePremiumWebsiteWorkOrderCliOptions) {
  const packet = buildRevenueWebsiteCreationPacketFromCli(options);
  const unsafeActionRequested = options.writeFiles || options.deployWebsite || options.publishPreview || options.contactClient;
  const blocked = packet.status !== "ready_for_website_creation_handoff" || unsafeActionRequested;
  const scaffoldFiles = packet.scaffold?.files.map((file) => ({
    path: file.path,
    purpose: file.purpose,
  })) || [];
  const unsafeBlockedReasons = [
    options.writeFiles ? "This work order cannot write files directly; create a PR branch instead." : "",
    options.deployWebsite ? "This work order cannot deploy; Robert must approve deploy after App QA." : "",
    options.publishPreview ? "This work order cannot publish previews; attach screenshots first and request approval." : "",
    options.contactClient ? "This work order cannot contact the client/business." : "",
  ].filter(Boolean);

  return {
    status: blocked ? "blocked" as const : "ready_for_pr_first_premium_website_work_order" as const,
    source: {
      packetType: "website_creation_packet",
      outreachDraftId: packet.outreachDraftId,
      leadId: packet.lead?.id || "",
      businessName: packet.draft?.businessName || "",
      packetStatus: packet.status,
    },
    outreachDraftId: packet.outreachDraftId,
    businessName: packet.draft?.businessName || "",
    packetStatus: packet.status,
    target: {
      repo: options.targetRepo,
      project: options.targetProject,
      branchName: options.branchName,
      qaRoute: options.qaRoute,
      previewUrl: options.previewUrl,
      productionUrl: options.productionUrl,
      deployProvider: options.deployProvider,
      healthUrl: options.healthUrl,
    },
    evidence: packet.evidence,
    scope: {
      packageName: packet.scaffoldInput?.packageName || "",
      projectType: packet.scaffoldInput?.projectType || "website",
      setupUsd: packet.scaffoldInput?.setupUsd || 0,
      monthlyRetainerUsd: packet.scaffoldInput?.monthlyRetainerUsd || 0,
      estimatedInternalCostUsd: packet.scaffoldInput?.estimatedInternalCostUsd || 0,
      launchTargetDays: packet.scaffoldInput?.launchTargetDays || options.launchTargetDays,
      includesAutomation: packet.scaffoldInput?.includesAutomation || false,
      publicEvidenceSummary: packet.scaffoldInput?.publicEvidence || "",
      painPoint: packet.scaffoldInput?.painPoint || "",
      primaryCta: packet.scaffoldInput?.primaryCta || "",
      contactEmail: packet.scaffoldInput?.contactEmail || "",
    },
    design: {
      workflow: packet.designExecutionBrief.workflow,
      requiredSkills: packet.designExecutionBrief.requiredSkills,
      claudeDesignHandoffRequired: packet.designExecutionBrief.claudeDesignHandoff.required,
      standards: packet.designExecutionBrief.designStandards,
      qaGates: packet.designExecutionBrief.qaGates,
    },
    implementationPlan: {
      prTitle: `Build premium website for ${packet.draft?.businessName || "client"}`,
      branchName: options.branchName,
      scaffoldFiles,
      expectedCommands: [
        options.buildCommand,
        options.testCommand,
      ],
      requiredArtifacts: [
        "PR URL",
        "Product Design/Claude brief output",
        "selected visual direction",
        "motion/3D implementation spec",
        "files changed summary",
        "desktop screenshot",
        "mobile screenshot",
        "App QA report",
        "rollback note",
      ],
    },
    qaGate: {
      appQaRequired: true,
      qaRoute: options.qaRoute,
      checks: [
        "route scout",
        "link/click scout",
        "API scout",
        "error scout",
        "improvement scout",
        "desktop Playwright screenshot",
        "mobile Playwright screenshot",
        "3D/canvas nonblank check when motion/3D is used",
        "reduced-motion verification",
      ],
    },
    rollback: {
      required: true,
      plan: "Revert or close the PR branch before merge; if already merged, revert the merge commit and disable any preview/deploy created after Robert approval.",
      previousProductionUrl: options.productionUrl,
      healthUrl: options.healthUrl,
    },
    prFirst: {
      allowedNextStep: packet.prFirstBuildContract.allowedNextStep,
      readyForFileWrites: false,
      readyForDeploy: false,
      branchPrefix: packet.prFirstBuildContract.branchPrefix,
      requiredBeforeCodeBuild: packet.prFirstBuildContract.requiredBeforeCodeBuild,
      requiredBeforePreviewOrDeploy: packet.prFirstBuildContract.requiredBeforePreviewOrDeploy,
      evidence: packet.evidence,
    },
    safety: {
      writesFiles: false,
      deploys: false,
      publishesPreview: false,
      sendsOutreach: false,
      contactsBusiness: false,
      requiresRobertDeployApproval: true,
      requestedWriteFiles: options.writeFiles,
      requestedDeployWebsite: options.deployWebsite,
      requestedPublishPreview: options.publishPreview,
      requestedContactClient: options.contactClient,
      blockedActions: [
        "write files from this work order",
        "deploy website",
        "publish preview",
        "contact business",
        "charge client from this artifact",
      ],
    },
    blockedReasons: blocked ? [...packet.blockedReasons, ...unsafeBlockedReasons] : [],
    sourcePacketText: blocked ? formatRevenueWebsiteCreationPacketText(packet) : "",
    nextAction: blocked
      ? "Resolve website creation packet gates before creating a PR-first premium website work order."
      : "Create a dedicated PR branch, run the Product Design/Claude handoff, implement the premium website, attach screenshots/App QA evidence, then ask Robert before any deploy.",
  };
}

export function formatRevenuePremiumWebsiteWorkOrderText(
  workOrder: ReturnType<typeof buildRevenuePremiumWebsiteWorkOrderFromCli>,
) {
  return [
    `Revenue premium website work order: ${workOrder.status}`,
    `Business: ${workOrder.businessName || "not found"}`,
    `Target repo: ${workOrder.target.repo}`,
    `Target project: ${workOrder.target.project}`,
    `Branch: ${workOrder.target.branchName}`,
    `QA route: ${workOrder.target.qaRoute}`,
    `Deploy provider: ${workOrder.target.deployProvider}`,
    "",
    "Design:",
    `- Workflow: ${workOrder.design.workflow}`,
    `- Claude/design handoff required: ${workOrder.design.claudeDesignHandoffRequired ? "yes" : "no"}`,
    `- Required skills: ${workOrder.design.requiredSkills.join(", ")}`,
    "",
    "Implementation:",
    `- Package: ${workOrder.scope.packageName || "blocked"}`,
    `- Scaffold files: ${workOrder.implementationPlan.scaffoldFiles.length}`,
    `- Expected commands: ${workOrder.implementationPlan.expectedCommands.join(", ")}`,
    `- Required artifacts: ${workOrder.implementationPlan.requiredArtifacts.join(", ")}`,
    "",
    "QA gate:",
    `- App QA required: ${workOrder.qaGate.appQaRequired ? "yes" : "no"}`,
    `- Checks: ${workOrder.qaGate.checks.join(", ")}`,
    "",
    "Rollback:",
    `- Required: ${workOrder.rollback.required ? "yes" : "no"}`,
    `- Plan: ${workOrder.rollback.plan}`,
    "",
    "Safety:",
    `- Writes files: ${workOrder.safety.writesFiles ? "yes" : "no"}`,
    `- Deploys: ${workOrder.safety.deploys ? "yes" : "no"}`,
    `- Publishes preview: ${workOrder.safety.publishesPreview ? "yes" : "no"}`,
    `- Contacts business: ${workOrder.safety.contactsBusiness ? "yes" : "no"}`,
    `- Requires Robert deploy approval: ${workOrder.safety.requiresRobertDeployApproval ? "yes" : "no"}`,
    "",
    workOrder.blockedReasons.length
      ? ["Blocked reasons:", ...workOrder.blockedReasons.map((reason) => `- ${reason}`)].join("\n")
      : "Blocked reasons: none",
    "",
    `Next action: ${workOrder.nextAction}`,
  ].join("\n");
}

export function getRevenuePremiumWebsiteWorkOrderExitCode(
  workOrder: ReturnType<typeof buildRevenuePremiumWebsiteWorkOrderFromCli>,
) {
  return workOrder.status === "blocked" ? 1 : 0;
}
