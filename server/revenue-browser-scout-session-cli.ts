import { existsSync, lstatSync, realpathSync } from "node:fs";
import os from "node:os";
import path from "node:path";

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
  notesInputPath: string;
  extractedOutputPath: string;
  overwrite: boolean;
};

type OutputPathChecks = {
  exists: (path: string) => boolean;
  lstat: (path: string) => { isFile: () => boolean; isSymbolicLink: () => boolean };
  realpath: (path: string) => string;
};

type RevenueBrowserScoutDispatchInput = {
  area: string;
  niche: string;
  offerFocus: "websites" | "automations" | "both";
  dailyResearchTarget: number;
  dailyQualifiedLeadLimit: number;
  dailyMockupLimit: number;
  dailyContactLimit: number;
  maxPaidDataSpendUsd: number;
  requireRobertApprovalToContact: boolean;
  writePreviewFiles: boolean;
  seedLeads: [];
  seedLeadBatchText: string;
};

const nodeOutputPathChecks: OutputPathChecks = {
  exists: existsSync,
  lstat: lstatSync,
  realpath: realpathSync,
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
  const capturePath = getValue("--capture");
  const defaultExtractedOutput = capturePath
    ? capturePath.replace(/(\.json)?$/i, ".extracted.json")
    : "";

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
    capturePath,
    notesInputPath: getValue("--notes") || "public-notes.txt",
    extractedOutputPath: getValue("--extracted-output") || defaultExtractedOutput,
    overwrite: argv.includes("--overwrite"),
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

function validateWritablePath(value: string, overwrite: boolean, label: string, checks: OutputPathChecks) {
  const errors: string[] = [];
  if (!value) return errors;
  if (hasSensitiveOutputPath(value)) {
    errors.push(`${label} cannot point to .env, credentials, secrets, .ssh, .git or node_modules paths.`);
    return errors;
  }
  const resolved = path.resolve(value);
  const parent = path.dirname(resolved);
  if (!checks.exists(parent)) {
    errors.push(`${label} parent directory must exist.`);
    return errors;
  }
  const parentStats = checks.lstat(parent);
  const allowedSymlinkParents = new Set(["/tmp", path.resolve(os.tmpdir())]);
  if (parentStats.isSymbolicLink() && !allowedSymlinkParents.has(parent)) {
    errors.push(`${label} parent directory cannot be a symlink.`);
    return errors;
  }
  const realParent = checks.realpath(parent);
  if (!allowedOutputRoots(checks).some((root) => isPathInside(realParent, root))) {
    errors.push(`${label} must be inside revenue_workspace/public-scout or the system temp directory.`);
  }
  if (checks.exists(resolved)) {
    const outputStats = checks.lstat(resolved);
    if (outputStats.isSymbolicLink()) errors.push(`${label} cannot be a symlink.`);
    if (!outputStats.isFile()) errors.push(`${label} must be a regular file when it already exists.`);
    if (!overwrite) errors.push(`${label} already exists; pass --overwrite to replace it.`);
  }
  return errors;
}

export function validateRevenueBrowserScoutSessionOptions(
  options: RevenueBrowserScoutSessionCliOptions,
  checks: OutputPathChecks = nodeOutputPathChecks,
): string[] {
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
  errors.push(...validateWritablePath(options.outputPath, options.overwrite, "--output", checks));
  errors.push(...validateWritablePath(options.capturePath, options.overwrite, "--capture", checks));
  errors.push(...validateWritablePath(options.extractedOutputPath, options.overwrite, "--extracted-output", checks));
  if (
    options.capturePath
    && options.extractedOutputPath
    && path.resolve(options.capturePath) === path.resolve(options.extractedOutputPath)
  ) {
    errors.push("--capture and --extracted-output must be different files.");
  }
  return errors;
}

export function buildRevenueBrowserScoutDispatchInput(options: RevenueBrowserScoutSessionCliOptions): RevenueBrowserScoutDispatchInput {
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
    source: "browser_subagent",
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
  const publicNotesTemplate = [
    "Business: <public business name>",
    `Area: ${options.area}`,
    `Niche: ${options.niche}`,
    "Website Status: no_website | weak_website | has_website | unknown",
    "Source URL: <public listing/profile URL>",
    "Contact Channel: email | phone | contact_form | instagram | unknown",
    "Contact Value: <public contact value or unknown>",
    "Evidence: <1-2 sentence summary from public pages only; no private data>",
    "Pain Point: <why a premium website/automation could help>",
    "Offer: 3500",
    "Notes: No outreach sent. No forms submitted. Public evidence only.",
  ].join("\n");
  const trustedExecutorHandoff = {
    status: "ready_for_trusted_browser_executor_handoff" as const,
    executor: "subagent_or_manual_browser",
    missionName: dispatch.mission.name,
    scoutRunId: dispatch.mission.name,
    source: "browser_subagent",
    area: options.area,
    niche: options.niche,
    offerFocus: options.offerFocus,
    targetCandidates: options.dailyQualifiedLeadLimit,
    notesInputPath: options.notesInputPath,
    extractedJsonPath: options.extractedOutputPath || "(pass --extracted-output=path/to/candidates.json)",
    allowedUrls: dispatch.workOrders.map((order) => ({
      id: order.id,
      sourceTaskId: order.sourceTaskId,
      url: order.url,
      targetRows: order.targetRows,
    })),
    objective: `Find public ${options.niche} businesses in ${options.area} that may need ${options.offerFocus === "automations" ? "automation" : options.offerFocus === "websites" ? "premium websites" : "premium websites or automation"}.`,
    prompt: [
      `Research public ${options.niche} businesses in ${options.area}.`,
      "Use only public pages opened from the session URLs.",
      "Capture businesses with weak/no website signals, visible public contact path, and clear public evidence.",
      "Do not contact businesses, submit forms, log in, buy data, scrape private data, or create previews.",
      "Return notes using the exact Public Notes Template for each candidate.",
    ].join(" "),
    publicNotesTemplate,
    evidenceRequirements: [
      "A public source URL for every candidate.",
      "A specific website-status reason, not a guess.",
      "A public contact path if visible; use unknown when not visible.",
      "A concise evidence sentence based only on public pages.",
      "A pain point tied to website conversion, lead capture or follow-up.",
    ],
    acceptanceCriteria: [
      `At most ${options.dailyQualifiedLeadLimit} qualified candidates captured.`,
      "Every candidate remains verificationStatus needs_review.",
      "approvalToImport stays false.",
      "publicEvidenceVerified stays false until Robert review.",
      "No outreach, spend, preview writes, account login or form submission occurred.",
    ],
    nextCommands: {
      extractCandidates: {
        command: "npm",
        args: [
          "run",
          "revenue:public-scout-extract",
          "--",
          `--input=${options.notesInputPath}`,
          `--output=${options.extractedOutputPath || "path/to/extracted-candidates.json"}`,
          `--area=${options.area}`,
          `--niche=${options.niche}`,
          `--offer-focus=${options.offerFocus}`,
          "--source=browser_subagent",
          `--scout-run-id=${dispatch.mission.name}`,
        ],
      },
      captureForReview: {
        command: "npm",
        args: [
          "run",
          "revenue:public-scout-run",
          "--",
          `--input=${options.extractedOutputPath || "path/to/extracted-candidates.json"}`,
          "--source=browser_subagent",
          `--scout-run-id=${dispatch.mission.name}`,
        ],
      },
    },
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
    trustedExecutorHandoff,
    nextCommand: trustedExecutorHandoff.nextCommands.extractCandidates,
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
    `Next command: ${session.nextCommand.command} ${JSON.stringify(session.nextCommand.args)}`,
    "",
    "URLs to inspect:",
    ...session.urlsToOpen.map((item) => `- ${item.id} ${item.source}: ${item.url}`),
    "",
    "Trusted executor handoff:",
    `- Status: ${session.trustedExecutorHandoff.status}`,
    `- Executor: ${session.trustedExecutorHandoff.executor}`,
    `- Evidence requirements: ${session.trustedExecutorHandoff.evidenceRequirements.length}`,
    `- Acceptance criteria: ${session.trustedExecutorHandoff.acceptanceCriteria.length}`,
    `- Extract command: ${session.trustedExecutorHandoff.nextCommands.extractCandidates.command} ${JSON.stringify(session.trustedExecutorHandoff.nextCommands.extractCandidates.args)}`,
    `- Capture command: ${session.trustedExecutorHandoff.nextCommands.captureForReview.command} ${JSON.stringify(session.trustedExecutorHandoff.nextCommands.captureForReview.args)}`,
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
