import { buildRevenueMoneyReadinessReport, type RevenueMoneyReadinessInput } from "./revenue-engine";

export type RevenueCommercialGoLiveCliOptions = {
  mode: RevenueMoneyReadinessInput["mode"];
  json: boolean;
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
    "Capture candidates through revenue:public-scout-run and Robert review before Money sprint.",
    "Only after payment/contact gates pass, draft outreach and proposals.",
    "Only after deposit, App QA, preview deploy and rollback evidence, publish client websites.",
  ];
  const rollbackNotes = [
    "Turn REVENUE_ENGINE_MONEY_MODE away from live to stop real selling behavior.",
    "Disable website deploy/publish flags before changing client-facing routes.",
    "Keep every deploy PR-first and retain the previous deployment target for rollback.",
    "If App QA reports warnings or failures, stop deployment and create a follow-up fix.",
  ];

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
