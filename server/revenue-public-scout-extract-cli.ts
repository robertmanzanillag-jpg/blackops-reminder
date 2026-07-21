import type { RevenuePublicScoutRunInput } from "./revenue-engine";
import { existsSync, lstatSync, realpathSync } from "node:fs";
import os from "node:os";
import path from "node:path";

export type RevenuePublicScoutExtractCliOptions = {
  inputPath: string;
  outputPath: string;
  overwrite: boolean;
  json: boolean;
  area: string;
  niche: string;
  offerFocus: "websites" | "automations" | "both";
  source: "browser_subagent" | "manual_browser" | "csv_import" | "public_directory";
  scoutRunId: string;
};

type ExtractedCandidate = RevenuePublicScoutRunInput["candidates"][number];

type OutputPathChecks = {
  exists: (path: string) => boolean;
  lstat: (path: string) => { isFile: () => boolean; isSymbolicLink: () => boolean };
  realpath: (path: string) => string;
};

const nodeOutputPathChecks: OutputPathChecks = {
  exists: existsSync,
  lstat: lstatSync,
  realpath: realpathSync,
};

export function parseRevenuePublicScoutExtractArgs(argv: string[]): RevenuePublicScoutExtractCliOptions {
  const getValue = (name: string) => {
    const prefix = `${name}=`;
    const arg = argv.find((value) => value.startsWith(prefix));
    return arg ? arg.slice(prefix.length).trim() : "";
  };

  return {
    inputPath: getValue("--input"),
    outputPath: getValue("--output"),
    overwrite: argv.includes("--overwrite"),
    json: argv.includes("--json"),
    area: getValue("--area") || "Miami",
    niche: getValue("--niche") || "med spas",
    offerFocus: (getValue("--offer-focus") || "both") as RevenuePublicScoutExtractCliOptions["offerFocus"],
    source: (getValue("--source") || "manual_browser") as RevenuePublicScoutExtractCliOptions["source"],
    scoutRunId: getValue("--scout-run-id"),
  };
}

function hasSensitiveOutputPath(value: string) {
  const segments = value.split(/[\\/]+/).map((segment) => segment.trim().toLowerCase()).filter(Boolean);
  return segments.some((segment) =>
    segment.startsWith(".env")
    || segment.startsWith("credentials")
    || segment.startsWith("secrets")
    || [".git", ".ssh", "node_modules"].includes(segment)
  );
}

function isPathInside(child: string, parent: string) {
  const relative = path.relative(parent, child);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function allowedOutputRoots(checks: OutputPathChecks) {
  const roots = [
    path.resolve(process.cwd(), "revenue_workspace/public-scout"),
    path.resolve(os.tmpdir()),
    "/tmp",
  ];
  return roots.map((root) => checks.exists(root) ? checks.realpath(root) : root);
}

function validateOutputPath(value: string, overwrite: boolean, checks: OutputPathChecks) {
  const errors: string[] = [];
  if (!value) return errors;
  if (hasSensitiveOutputPath(value)) {
    errors.push("--output cannot point to .env, credentials, secrets, .ssh, .git or node_modules paths.");
    return errors;
  }
  const resolved = path.resolve(value);
  const parent = path.dirname(resolved);
  if (!checks.exists(parent)) {
    errors.push("--output parent directory must exist.");
    return errors;
  }
  const parentStats = checks.lstat(parent);
  const allowedSymlinkParents = new Set(["/tmp", path.resolve(os.tmpdir())]);
  if (parentStats.isSymbolicLink() && !allowedSymlinkParents.has(parent)) {
    errors.push("--output parent directory cannot be a symlink.");
    return errors;
  }
  const realParent = checks.realpath(parent);
  if (!allowedOutputRoots(checks).some((root) => isPathInside(realParent, root))) {
    errors.push("--output must be inside revenue_workspace/public-scout or the system temp directory.");
  }
  if (checks.exists(resolved)) {
    const outputStats = checks.lstat(resolved);
    if (outputStats.isSymbolicLink()) errors.push("--output cannot be a symlink.");
    if (!outputStats.isFile()) errors.push("--output must be a regular file when it already exists.");
    if (!overwrite) errors.push("--output already exists; pass --overwrite to replace it.");
  }
  return errors;
}

function isLikelyEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

export function validateRevenuePublicScoutExtractOptions(
  options: RevenuePublicScoutExtractCliOptions,
  checks: OutputPathChecks = nodeOutputPathChecks,
): string[] {
  const errors: string[] = [];
  if (!options.inputPath) errors.push("--input is required.");
  errors.push(...validateOutputPath(options.outputPath, options.overwrite, checks));
  if (!["websites", "automations", "both"].includes(options.offerFocus)) {
    errors.push("--offer-focus must be websites, automations or both.");
  }
  if (!["browser_subagent", "manual_browser", "csv_import", "public_directory"].includes(options.source)) {
    errors.push("--source must be browser_subagent, manual_browser, csv_import or public_directory.");
  }
  return errors;
}

function fieldValue(lines: string[], labels: string[]) {
  const normalizedLabels = labels.map((label) => label.toLowerCase());
  for (const line of lines) {
    const separator = line.indexOf(":");
    if (separator < 0) continue;
    const key = line.slice(0, separator).trim().toLowerCase();
    if (!normalizedLabels.includes(key)) continue;
    return line.slice(separator + 1).trim();
  }
  return "";
}

function websiteStatusFromText(value: string): ExtractedCandidate["websiteStatus"] {
  const normalized = value.toLowerCase();
  if (normalized.includes("no website") || normalized.includes("missing") || normalized.includes("none")) return "no_website";
  if (normalized.includes("weak") || normalized.includes("old") || normalized.includes("broken")) return "weak_website";
  if (normalized.includes("has") || normalized.includes("yes")) return "has_website";
  return "unknown";
}

function contactChannelFromText(value: string): ExtractedCandidate["contactChannel"] {
  const normalized = value.toLowerCase();
  if (normalized.includes("instagram") || normalized.includes("ig:")) return "instagram";
  if (normalized.includes("@") || normalized.includes("email")) return "email";
  if (normalized.includes("form")) return "contact_form";
  if (/\+?\d[\d ().-]{6,}/.test(normalized)) return "phone";
  return "unknown";
}

function candidateFromBlock(block: string, options: RevenuePublicScoutExtractCliOptions): ExtractedCandidate | null {
  const lines = block.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const businessName = fieldValue(lines, ["business", "business name", "name"]);
  const sourceUrl = fieldValue(lines, ["source", "sourceurl", "source url", "url"]);
  const contactValue = fieldValue(lines, ["contact", "contact value", "email", "phone", "instagram"]);
  const evidence = fieldValue(lines, ["evidence", "public evidence", "proof"]);
  if (!businessName || !sourceUrl.startsWith("http") || !evidence) return null;

  const websiteStatus = websiteStatusFromText(fieldValue(lines, ["website", "website status", "site"]));
  const contactChannel = contactChannelFromText(contactValue);
  const explicitRecipientEmail = fieldValue(lines, ["recipient", "recipient email", "to"]);
  const recipientEmail = isLikelyEmail(contactValue)
    ? contactValue
    : isLikelyEmail(explicitRecipientEmail)
      ? explicitRecipientEmail
      : "";

  return {
    businessName,
    area: fieldValue(lines, ["area", "city"]) || options.area,
    niche: fieldValue(lines, ["niche", "industry", "category"]) || options.niche,
    websiteStatus,
    contactChannel,
    contactValue,
    sourceUrl,
    recipientEmail,
    evidence,
    painPoint: fieldValue(lines, ["pain", "pain point", "opportunity"]) || "Needs review before any offer is drafted.",
    estimatedOfferUsd: Number(fieldValue(lines, ["offer", "estimated offer", "price"]).replace(/[^0-9.]/g, "")) || 3500,
    status: "research",
    contactName: fieldValue(lines, ["contact name", "owner"]) || "Owner",
    businessSummary: fieldValue(lines, ["summary", "business summary"]) || `${businessName} captured from public notes for Robert review.`,
    verificationStatus: "needs_review",
    publicEvidenceVerified: false,
    approvalToImport: false,
    notes: "Extracted from public scout notes. No outreach sent.",
  };
}

export function buildRevenuePublicScoutExtract(rawNotes: string, options: RevenuePublicScoutExtractCliOptions): RevenuePublicScoutRunInput {
  const blocks = rawNotes
    .split(/\n\s*\n/g)
    .map((block) => block.trim())
    .filter(Boolean)
    .slice(0, 25);
  const candidates = blocks
    .map((block) => candidateFromBlock(block, options))
    .filter((candidate): candidate is ExtractedCandidate => Boolean(candidate));

  return {
    area: options.area,
    niche: options.niche,
    offerFocus: options.offerFocus,
    source: options.source,
    scoutRunId: options.scoutRunId || "public-scout-notes-extract",
    autoApproveVerified: false,
    dailyResearchTarget: 30,
    dailyQualifiedLeadLimit: 8,
    dailyMockupLimit: 3,
    dailyContactLimit: 0,
    maxPaidDataSpendUsd: 0,
    requireRobertApprovalToContact: true,
    writePreviewFiles: false,
    candidates,
  };
}

export function formatRevenuePublicScoutExtractText(input: RevenuePublicScoutRunInput, outputPath: string) {
  const nextCommand = {
    command: "npm",
    args: [
      "run",
      "revenue:public-scout-run",
      "--",
      `--input=${outputPath || "path/to/extracted-candidates.json"}`,
      `--source=${input.source}`,
      `--scout-run-id=${input.scoutRunId}`,
    ],
  };
  return [
    "Revenue public scout extract: ready_for_review_capture",
    `Candidates extracted: ${input.candidates.length}`,
    `Scout run: ${input.scoutRunId}`,
    `Output: ${outputPath || "stdout"}`,
    "Next command:",
    `${nextCommand.command} ${JSON.stringify(nextCommand.args)}`,
    "",
    "Safety:",
    "- Verification status: needs_review",
    "- Public evidence verified: false",
    "- Approval to import: false",
    "- Paid data spend: $0",
    "- Sends outreach: no",
  ].join("\n");
}
