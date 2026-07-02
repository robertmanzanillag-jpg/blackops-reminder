import { z } from "zod";
import type { RevenuePublicScoutRunInput } from "./revenue-engine";

export type RevenuePublicScoutCliOptions = {
  inputPath: string;
  json: boolean;
  sample: boolean;
  area: string;
  niche: string;
  offerFocus: "websites" | "automations" | "both";
  source: "browser_subagent" | "manual_browser" | "csv_import" | "public_directory";
  scoutRunId: string;
};

const revenuePublicScoutJsonSchema = z.union([
  z.array(z.unknown()),
  z.object({
    candidates: z.array(z.unknown()).optional(),
  }).passthrough(),
]);

export function parseRevenuePublicScoutArgs(argv: string[]): RevenuePublicScoutCliOptions {
  const getValue = (name: string) => {
    const prefix = `${name}=`;
    const arg = argv.find((value) => value.startsWith(prefix));
    return arg ? arg.slice(prefix.length).trim() : "";
  };

  return {
    inputPath: getValue("--input"),
    json: argv.includes("--json"),
    sample: argv.includes("--sample"),
    area: getValue("--area") || "Miami",
    niche: getValue("--niche") || "med spas",
    offerFocus: (getValue("--offer-focus") || "both") as RevenuePublicScoutCliOptions["offerFocus"],
    source: (getValue("--source") || "browser_subagent") as RevenuePublicScoutCliOptions["source"],
    scoutRunId: getValue("--scout-run-id"),
  };
}

export function validateRevenuePublicScoutOptions(options: RevenuePublicScoutCliOptions): string[] {
  const errors: string[] = [];
  if (!options.sample && !options.inputPath) errors.push("--input is required unless --sample is used.");
  if (!["websites", "automations", "both"].includes(options.offerFocus)) {
    errors.push("--offer-focus must be websites, automations or both.");
  }
  if (!["browser_subagent", "manual_browser", "csv_import", "public_directory"].includes(options.source)) {
    errors.push("--source must be browser_subagent, manual_browser, csv_import or public_directory.");
  }
  return errors;
}

export function buildRevenuePublicScoutSample(options: RevenuePublicScoutCliOptions): RevenuePublicScoutRunInput {
  return {
    area: options.area,
    niche: options.niche,
    offerFocus: options.offerFocus,
    source: options.source,
    scoutRunId: options.scoutRunId || "sample-public-scout-run",
    autoApproveVerified: false,
    dailyResearchTarget: 30,
    dailyQualifiedLeadLimit: 8,
    dailyMockupLimit: 3,
    dailyContactLimit: 0,
    maxPaidDataSpendUsd: 0,
    requireRobertApprovalToContact: true,
    writePreviewFiles: false,
    candidates: [
      {
        businessName: "Replace With Real Business",
        area: options.area,
        niche: options.niche,
        websiteStatus: "no_website",
        contactChannel: "email",
        contactValue: "public-contact@example.com",
        sourceUrl: "https://example.com/public-business-listing",
        recipientEmail: "public-contact@example.com",
        evidence: "Public listing/profile shows no dedicated website, recent business activity and a visible contact path.",
        painPoint: "Needs a conversion-focused website, inquiry capture and follow-up.",
        estimatedOfferUsd: 3500,
        status: "research",
        contactName: "Owner",
        businessSummary: "Short summary from public evidence only. No outreach sent.",
        missionId: "",
        sourceTaskId: "",
        verificationStatus: "needs_review",
        publicEvidenceVerified: false,
        approvalToImport: false,
        notes: "Replace every field with verified public evidence before import.",
      },
    ],
  };
}

export function buildRevenuePublicScoutInput(rawJson: string, options: RevenuePublicScoutCliOptions): RevenuePublicScoutRunInput {
  const parsedJson = revenuePublicScoutJsonSchema.parse(JSON.parse(rawJson));
  const base = Array.isArray(parsedJson) ? { candidates: parsedJson } : parsedJson;

  return {
    area: typeof base.area === "string" && base.area.trim() ? base.area : options.area,
    niche: typeof base.niche === "string" && base.niche.trim() ? base.niche : options.niche,
    offerFocus: typeof base.offerFocus === "string" ? base.offerFocus as RevenuePublicScoutCliOptions["offerFocus"] : options.offerFocus,
    source: typeof base.source === "string" ? base.source as RevenuePublicScoutCliOptions["source"] : options.source,
    scoutRunId: typeof base.scoutRunId === "string" ? base.scoutRunId : options.scoutRunId,
    autoApproveVerified: false,
    dailyResearchTarget: Number(base.dailyResearchTarget ?? 30),
    dailyQualifiedLeadLimit: Number(base.dailyQualifiedLeadLimit ?? 8),
    dailyMockupLimit: Number(base.dailyMockupLimit ?? 3),
    dailyContactLimit: Number(base.dailyContactLimit ?? 0),
    maxPaidDataSpendUsd: 0,
    requireRobertApprovalToContact: base.requireRobertApprovalToContact !== false,
    writePreviewFiles: false,
    candidates: Array.isArray(base.candidates) ? base.candidates as RevenuePublicScoutRunInput["candidates"] : [],
  };
}

export function formatRevenuePublicScoutRunText(result: {
  status: string;
  source: string;
  scoutRunId: string;
  importableCount: number;
  blockedCandidates: Array<{ businessName: string; reasons: string[]; nextAction: string }>;
  nextApiAction: string;
  nextAction: string;
  importBatchText: string;
  safety: {
    persistsPublicCandidates: boolean;
    persistsLeads: boolean;
    writesPreviewFiles: boolean;
    sendsOutreach: boolean;
    paidDataSpendUsd: number;
  };
}): string {
  return [
    `Revenue public scout run: ${result.status}`,
    `Scout run: ${result.scoutRunId}`,
    `Source: ${result.source}`,
    `Importable candidates: ${result.importableCount}`,
    `Blocked candidates: ${result.blockedCandidates.length}`,
    `Next API action: ${result.nextApiAction}`,
    `Next action: ${result.nextAction}`,
    "",
    "Safety:",
    `- Persists public candidates: ${result.safety.persistsPublicCandidates ? "yes" : "no"}`,
    `- Persists final leads: ${result.safety.persistsLeads ? "yes" : "no"}`,
    `- Writes preview files: ${result.safety.writesPreviewFiles ? "yes" : "no"}`,
    `- Sends outreach: ${result.safety.sendsOutreach ? "yes" : "no"}`,
    `- Paid data spend: $${result.safety.paidDataSpendUsd}`,
    "",
    "Blocked:",
    ...result.blockedCandidates.map((candidate) => `- ${candidate.businessName}: ${candidate.reasons.join("; ") || candidate.nextAction}`),
    "",
    "Import batch text:",
    result.importBatchText,
  ].join("\n");
}

export function getRevenuePublicScoutRunExitCode(result: { recordedCandidates: unknown[] }) {
  return result.recordedCandidates.length > 0 ? 0 : 1;
}
