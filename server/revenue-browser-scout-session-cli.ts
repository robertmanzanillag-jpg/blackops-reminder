import type { RevenueScoutDispatchInput } from "./revenue-engine";

export type RevenueBrowserScoutSessionCliOptions = {
  area: string;
  niche: string;
  offerFocus: "websites" | "automations" | "both";
  dailyResearchTarget: number;
  dailyQualifiedLeadLimit: number;
  dailyMockupLimit: number;
  dailyContactLimit: number;
  json: boolean;
  open: boolean;
  outputPath: string;
  capturePath: string;
};

export function parseRevenueBrowserScoutSessionArgs(argv: string[]): RevenueBrowserScoutSessionCliOptions {
  const getValue = (name: string) => {
    const prefix = `${name}=`;
    const arg = argv.find((value) => value.startsWith(prefix));
    return arg ? arg.slice(prefix.length).trim() : "";
  };
  const numberValue = (name: string, fallback: number) => {
    const value = Number(getValue(name));
    return Number.isFinite(value) && value > 0 ? value : fallback;
  };

  return {
    area: getValue("--area") || "Miami",
    niche: getValue("--niche") || "med spas",
    offerFocus: (getValue("--offer-focus") || "both") as RevenueBrowserScoutSessionCliOptions["offerFocus"],
    dailyResearchTarget: numberValue("--daily-research-target", 30),
    dailyQualifiedLeadLimit: numberValue("--daily-qualified-lead-limit", 8),
    dailyMockupLimit: numberValue("--daily-mockup-limit", 3),
    dailyContactLimit: numberValue("--daily-contact-limit", 0),
    json: argv.includes("--json"),
    open: argv.includes("--open"),
    outputPath: getValue("--output"),
    capturePath: getValue("--capture"),
  };
}

export function validateRevenueBrowserScoutSessionOptions(options: RevenueBrowserScoutSessionCliOptions): string[] {
  const errors: string[] = [];
  if (!["websites", "automations", "both"].includes(options.offerFocus)) {
    errors.push("--offer-focus must be websites, automations or both.");
  }
  if (options.dailyResearchTarget < 10 || options.dailyResearchTarget > 30) {
    errors.push("--daily-research-target must be between 10 and 30 for a safe browser scout session.");
  }
  if (options.dailyQualifiedLeadLimit < 1 || options.dailyQualifiedLeadLimit > 25) {
    errors.push("--daily-qualified-lead-limit must be between 1 and 25.");
  }
  return errors;
}

export function buildRevenueBrowserScoutDispatchInput(options: RevenueBrowserScoutSessionCliOptions): RevenueScoutDispatchInput {
  return {
    area: options.area,
    niche: options.niche,
    offerFocus: options.offerFocus,
    dailyResearchTarget: options.dailyResearchTarget,
    dailyQualifiedLeadLimit: options.dailyQualifiedLeadLimit,
    dailyMockupLimit: options.dailyMockupLimit,
    dailyContactLimit: options.dailyContactLimit,
    maxPaidDataSpendUsd: 0,
    requireRobertApprovalToContact: true,
    writePreviewFiles: false,
    seedLeads: [],
    seedLeadBatchText: "",
  };
}

export function buildRevenueBrowserScoutSession(
  dispatch: {
    status: string;
    mission: { name: string };
    workOrders: Array<{
      id: string;
      sourceTaskId: string;
      ownerAgent: string;
      source: string;
      query: string;
      url: string;
      targetRows: number;
      browserInstructions: string[];
      candidatePayloadTemplate: Record<string, unknown>;
    }>;
    publicScoutRunEndpoint: string;
    previewEndpoint: string;
  },
  options: RevenueBrowserScoutSessionCliOptions,
) {
  const captureTemplate = {
    area: options.area,
    niche: options.niche,
    offerFocus: options.offerFocus,
    source: "manual_browser",
    scoutRunId: dispatch.mission.name,
    autoApproveVerified: false,
    dailyResearchTarget: options.dailyResearchTarget,
    dailyQualifiedLeadLimit: options.dailyQualifiedLeadLimit,
    dailyMockupLimit: options.dailyMockupLimit,
    dailyContactLimit: 0,
    maxPaidDataSpendUsd: 0,
    requireRobertApprovalToContact: true,
    writePreviewFiles: false,
    candidates: dispatch.workOrders.map((order) => ({
      ...order.candidatePayloadTemplate,
      sourceTaskId: order.sourceTaskId,
      verificationStatus: "needs_review",
      publicEvidenceVerified: false,
      approvalToImport: false,
    })),
  };

  return {
    status: "ready_for_browser_scout_session" as const,
    missionName: dispatch.mission.name,
    openMode: options.open ? "open_urls_requested" as const : "dry_run_manifest" as const,
    urlCount: dispatch.workOrders.length,
    urlsToOpen: dispatch.workOrders.map((order) => ({
      id: order.id,
      sourceTaskId: order.sourceTaskId,
      source: order.source,
      ownerAgent: order.ownerAgent,
      query: order.query,
      url: order.url,
      targetRows: order.targetRows,
      browserInstructions: order.browserInstructions,
    })),
    capturePath: options.capturePath || "(pass --capture=path/to/candidates.json to write a capture template)",
    captureTemplate,
    nextCommand: `npm run revenue:public-scout-run -- --input=${options.capturePath || "path/to/candidates.json"}`,
    nextApiAction: dispatch.publicScoutRunEndpoint,
    previewEndpoint: dispatch.previewEndpoint,
    safety: {
      allowedAction: options.open ? "open_public_research_urls_only" : "prepare_browser_scout_session",
      blockedActions: ["automated scraping", "contact business", "submit forms", "buy data", "send outreach", "write preview files", "publish preview", "collect payment"],
      opensBrowserTabs: options.open,
      paidDataSpendUsd: 0,
      persistsLeads: false,
      sendsOutreach: false,
      writesPreviewFiles: false,
      candidateApprovalDefault: "needs_review",
    },
  };
}

export function formatRevenueBrowserScoutSessionText(session: ReturnType<typeof buildRevenueBrowserScoutSession>): string {
  return [
    `Revenue browser scout session: ${session.status}`,
    `Mission: ${session.missionName}`,
    `Mode: ${session.openMode}`,
    `URLs: ${session.urlCount}`,
    `Capture file: ${session.capturePath}`,
    `Next command: ${session.nextCommand}`,
    "",
    "URLs to inspect:",
    ...session.urlsToOpen.map((item) => `- ${item.id} ${item.source}: ${item.url}`),
    "",
    "Safety:",
    `- Opens browser tabs: ${session.safety.opensBrowserTabs ? "yes" : "no"}`,
    `- Paid data spend: $${session.safety.paidDataSpendUsd}`,
    `- Persists final leads: ${session.safety.persistsLeads ? "yes" : "no"}`,
    `- Sends outreach: ${session.safety.sendsOutreach ? "yes" : "no"}`,
    `- Writes preview files: ${session.safety.writesPreviewFiles ? "yes" : "no"}`,
    `- Candidate approval default: ${session.safety.candidateApprovalDefault}`,
  ].join("\n");
}
