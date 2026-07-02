import { buildRevenueMoneyReadinessReport, type RevenueMoneyReadinessInput } from "./revenue-engine";

export type RevenueCommercialGoLiveCliOptions = {
  mode: RevenueMoneyReadinessInput["mode"];
  json: boolean;
};

type RevenueGoLiveOperatorStep = {
  id: string;
  label: string;
  status: "ready" | "blocked" | "external";
  owner: "Robert" | "Codex";
  command: string;
  evidence: string;
  reason: string;
};

export function parseRevenueCommercialGoLiveArgs(argv: string[]): RevenueCommercialGoLiveCliOptions {
  const modeArg = argv.find((arg) => arg.startsWith("--mode="));
  const mode = (modeArg ? modeArg.slice("--mode=".length).trim() : "production-launch") as RevenueCommercialGoLiveCliOptions["mode"];
  return {
    mode,
    json: argv.includes("--json"),
  };
}

export function validateRevenueCommercialGoLiveOptions(options: RevenueCommercialGoLiveCliOptions) {
  const errors: string[] = [];
  if (!["first-sprint", "production-launch"].includes(options.mode)) {
    errors.push("--mode must be first-sprint or production-launch.");
  }
  return errors;
}

export function buildRevenueCommercialGoLivePacket(options: RevenueCommercialGoLiveCliOptions) {
  const readiness = buildRevenueMoneyReadinessReport({ mode: options.mode });
  const commercialGoLiveReady =
    options.mode === "production-launch" &&
    readiness.ready &&
    readiness.canBuildWebsites &&
    readiness.canCollectMoney &&
    readiness.canContactBusinesses;
  const firstMoneySprintReady = options.mode === "first-sprint" && readiness.ready;
  const requiredEnvironment = [
    {
      group: "Production persistence",
      names: ["DATABASE_URL", "SESSION_SECRET"],
      reason: "Real user/session persistence before taking money or launching client work.",
    },
    {
      group: "Money mode",
      names: ["REVENUE_ENGINE_MONEY_MODE", "REVENUE_ENGINE_DEPLOY_APPROVED_BY_ROBERT"],
      reason: "Explicit launch switch and Robert deployment approval.",
    },
    {
      group: "Contact approval",
      names: [
        "REVENUE_ENGINE_ROBERT_CONTACT_APPROVED",
        "RESEND_API_KEY + REVENUE_ENGINE_FROM_EMAIL/RESEND_FROM_EMAIL",
        "or REVENUE_ENGINE_MANUAL_CONTACT_APPROVED with approved manual send path",
      ],
      reason: "No outbound email, DM or form submission before an approved contact path exists.",
    },
    {
      group: "Payment collection",
      names: [
        "STRIPE_SECRET_KEY + REVENUE_ENGINE_STRIPE_CHECKOUT_ENABLED",
        "or REVENUE_ENGINE_PAYMENT_LINK + REVENUE_ENGINE_PAYMENT_LINK_APPROVED_BY_ROBERT",
        "REVENUE_ENGINE_PAYMENT_SMOKE_VERIFIED or REVENUE_ENGINE_DEPOSIT_CONFIRMED_BY_ROBERT",
      ],
      reason: "A live, verified deposit path before charging clients.",
    },
    {
      group: "Website publishing",
      names: [
        "REVENUE_ENGINE_WEBSITE_DEPLOY_ENABLED",
        "REVENUE_ENGINE_WEBSITE_APP_QA_TARGET_PASSED",
        "REVENUE_ENGINE_WEBSITE_PREVIEW_DEPLOY_VERIFIED",
        "REVENUE_ENGINE_WEBSITE_ROLLBACK_VERIFIED",
        "REVENUE_ENGINE_WEBSITE_PUBLISH_APPROVED_BY_ROBERT",
      ],
      reason: "Preview deploy, QA evidence, rollback proof and approval before publishing client websites.",
    },
  ];
  const executionOrder = [
    "Run revenue:money-readiness and fix every blocking gate before selling.",
    "Run revenue:public-scout-schedule to prepare guarded public research slots.",
    "Capture public notes and run revenue:public-scout-execute so candidates persist only for Robert review before Money sprint.",
    "Run revenue:contact-path-approval-decision and revenue:contact-path-readiness-packet before contacting any business.",
    "Run revenue:payment-path-approval-decision and revenue:payment-path-readiness-packet before exposing a deposit link.",
    "Only after payment/contact gates pass, draft outreach and proposals.",
    "Only after deposit, App QA, preview deploy and rollback evidence, publish client websites.",
  ];
  const rollbackNotes = [
    "Turn REVENUE_ENGINE_MONEY_MODE away from live to stop real selling behavior.",
    "Disable website deploy/publish flags before changing client-facing routes.",
    "Keep every deploy PR-first and retain the previous deployment target for rollback.",
    "If App QA reports warnings or failures, stop deployment and create a follow-up fix.",
  ];
  const operatorSetupSteps: RevenueGoLiveOperatorStep[] = [
    {
      id: "production-env",
      label: "Configure production persistence and session secret",
      status: readiness.checks.find((check) => check.id === "production_persistence")?.status === "ok"
        && readiness.checks.find((check) => check.id === "session_secret")?.status === "ok"
        ? "ready"
        : "external",
      owner: "Robert",
      command: "Set DATABASE_URL and SESSION_SECRET in the deployment secret manager, then run npm run revenue:money-readiness -- --mode=first-sprint.",
      evidence: "Production DATABASE_URL host is non-local and SESSION_SECRET is at least 32 chars; never paste either into tracked files or PR text.",
      reason: "Real customer work and money collection need durable production storage and session security.",
    },
    {
      id: "contact-path",
      label: "Approve contact path",
      status: readiness.canContactBusinesses ? "ready" : "external",
      owner: "Robert",
      command: [
        "npm run revenue:contact-path-approval-decision -- --contact-mode=manual --manual-contact-approved --decision=approved --approved-action='Approve contact path.' --robert-approved-contact-path --contact-path-verified --evidence-url=EVIDENCE_URL --evidence-note='Contact path verified' --confirmed-by-robert",
        "npm run revenue:contact-path-readiness-packet -- --contact-mode=manual --approval-decision-id=APPROVAL_ID --robert-approved-contact-path --contact-path-verified --evidence-url=EVIDENCE_URL --evidence-note='Contact path verified'",
      ].join(" && "),
      evidence: "Use non-secret evidence URL/note proving the manual/provider path; readiness packet must stay no-send.",
      reason: "No external outreach can run from env flags alone; it needs an audited contact_path approval.",
    },
    {
      id: "payment-path",
      label: "Approve payment path",
      status: readiness.canCollectMoney ? "ready" : "external",
      owner: "Robert",
      command: [
        "npm run revenue:payment-path-approval-decision -- --payment-link=STRIPE_PAYMENT_LINK --decision=approved --approved-action='Approve payment path.' --robert-approved-payment-path --payment-smoke-verified --expected-deposit-usd=1500 --expected-package='Website package' --evidence-url=EVIDENCE_URL --evidence-note='Payment path verified' --confirmed-by-robert",
        "npm run revenue:payment-path-readiness-packet -- --payment-link=STRIPE_PAYMENT_LINK --approval-decision-id=APPROVAL_ID --robert-approved-payment-path --payment-smoke-verified --expected-deposit-usd=1500 --expected-package='Website package' --evidence-url=EVIDENCE_URL --evidence-note='Payment path verified'",
      ].join(" && "),
      evidence: "Use a Stripe/payment-link evidence URL and smoke/deposit note; do not paste API keys or customer payment details.",
      reason: "Deposits require an approved and verified payment path before any client is charged.",
    },
    {
      id: "website-publish",
      label: "Approve publish pipeline",
      status: readiness.canBuildWebsites ? "ready" : "external",
      owner: "Robert",
      command: "Run revenue:website-publish-approval-decision and revenue:website-publish-readiness-packet with preview deploy, App QA, rollback, and Robert publish evidence.",
      evidence: "Preview URL, App QA evidence URL, rollback plan URL, and Robert publish approval. Replit deployment still needs explicit human approval.",
      reason: "Client websites can be scaffolded internally before this, but publishing/deploying needs QA and rollback proof.",
    },
    {
      id: "final-verification",
      label: "Verify go-live state",
      status: readiness.ready ? "ready" : "blocked",
      owner: "Codex",
      command: `npm run revenue:commercial-go-live -- --mode=${options.mode}`,
      evidence: options.mode === "production-launch"
        ? "Output must be ready_for_commercial_go_live before production selling/publishing."
        : "Output must be ready_for_first_money_sprint before first outreach/deposit sprint.",
      reason: "This is the final no-side-effect check before Robert decides whether to deploy or start selling.",
    },
  ];
  const nextExternalStep = operatorSetupSteps.find((step) => step.status === "external") || null;
  const nextVerificationStep = operatorSetupSteps.find((step) => step.status === "blocked") || operatorSetupSteps[operatorSetupSteps.length - 1];
  const operatorSetupPacket = {
    status: nextExternalStep || nextVerificationStep.status === "blocked" ? "blocked" as const : "ready" as const,
    nextExternalStep,
    nextVerificationStep,
    steps: operatorSetupSteps,
    safety: {
      printsSecrets: false,
      editsEnvironment: false,
      createsSecrets: false,
      deploys: false,
      contactsBusinesses: false,
      chargesClients: false,
      publishesWebsites: false,
      requiresHumanSecretManager: true,
      requiresRobertDeploymentApproval: true,
    },
  };

  return {
    status: commercialGoLiveReady
      ? "ready_for_commercial_go_live" as const
      : firstMoneySprintReady
        ? "ready_for_first_money_sprint" as const
        : "blocked" as const,
    mode: options.mode,
    readiness,
    requiredEnvironment,
    executionOrder,
    rollbackNotes,
    operatorSetupPacket,
    safety: {
      printsSecrets: false,
      editsEnvironment: false,
      deploys: false,
      contactsBusinesses: false,
      chargesClients: false,
      publishesWebsites: false,
      commercialGoLiveReady,
      requiresRobertApproval: true,
    },
  };
}

export function formatRevenueCommercialGoLivePacketText(packet: ReturnType<typeof buildRevenueCommercialGoLivePacket>) {
  return [
    `Revenue commercial go-live: ${packet.status}`,
    `Mode: ${packet.mode}`,
    `Readiness: ${packet.readiness.status}`,
    `Ready: ${packet.readiness.ready ? "yes" : "no"}`,
    "",
    "Blocked until:",
    ...(packet.readiness.blockedUntil.length ? packet.readiness.blockedUntil.map((item) => `- ${item}`) : ["- none"]),
    "",
    "Required environment gates:",
    ...packet.requiredEnvironment.map((group) => `- ${group.group}: ${group.names.join(", ")} (${group.reason})`),
    "",
    "Operator setup packet:",
    `- Status: ${packet.operatorSetupPacket.status}`,
    `- Next external step: ${packet.operatorSetupPacket.nextExternalStep?.label || "none"}`,
    ...packet.operatorSetupPacket.steps.map((step) => `- ${step.id}: ${step.status} (${step.owner}) ${step.reason}`),
    "",
    "Execution order:",
    ...packet.executionOrder.map((item, index) => `${index + 1}. ${item}`),
    "",
    "Rollback notes:",
    ...packet.rollbackNotes.map((item) => `- ${item}`),
    "",
    "Safety:",
    `- Prints secrets: ${packet.safety.printsSecrets ? "yes" : "no"}`,
    `- Edits environment: ${packet.safety.editsEnvironment ? "yes" : "no"}`,
    `- Deploys: ${packet.safety.deploys ? "yes" : "no"}`,
    `- Contacts businesses: ${packet.safety.contactsBusinesses ? "yes" : "no"}`,
    `- Charges clients: ${packet.safety.chargesClients ? "yes" : "no"}`,
    `- Publishes websites: ${packet.safety.publishesWebsites ? "yes" : "no"}`,
  ].join("\n");
}
