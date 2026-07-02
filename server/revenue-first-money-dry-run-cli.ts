import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  buildRevenueFirstMoneyCommandCenter,
  formatRevenueFirstMoneyCommandCenterText,
  type RevenueFirstMoneyCommandCenterCliOptions,
} from "./revenue-first-money-command-center-cli";
import type { RevenueMoneyReadinessInput } from "./revenue-engine";

export type RevenueFirstMoneyDryRunCliOptions = {
  mode: RevenueMoneyReadinessInput["mode"];
  outputDir: string;
  now: string;
  writeFile: boolean;
  json: boolean;
};

function getArgValue(argv: string[], name: string) {
  const prefix = `${name}=`;
  const arg = argv.find((value) => value.startsWith(prefix));
  return arg ? arg.slice(prefix.length).trim() : "";
}

function defaultDryRunOutputDir() {
  return path.resolve(process.cwd(), "revenue_workspace", "first-money-dry-runs");
}

export function parseRevenueFirstMoneyDryRunArgs(argv: string[]): RevenueFirstMoneyDryRunCliOptions {
  const mode = (getArgValue(argv, "--mode") || "first-sprint") as RevenueMoneyReadinessInput["mode"];
  const outputDir = getArgValue(argv, "--output-dir") || defaultDryRunOutputDir();
  const now = getArgValue(argv, "--now") || new Date().toISOString();

  return {
    mode,
    outputDir,
    now,
    writeFile: !argv.includes("--no-write"),
    json: argv.includes("--json"),
  };
}

export function validateRevenueFirstMoneyDryRunOptions(options: RevenueFirstMoneyDryRunCliOptions) {
  const errors: string[] = [];
  if (!["first-sprint", "production-launch"].includes(options.mode)) {
    errors.push("--mode must be first-sprint or production-launch.");
  }
  if (options.writeFile && !options.outputDir.trim()) {
    errors.push("--output-dir is required unless --no-write is used.");
  }
  if (Number.isNaN(Date.parse(options.now))) {
    errors.push("--now must be a valid ISO-compatible date.");
  }
  return errors;
}

function slugDate(value: string) {
  return new Date(value).toISOString().slice(0, 10);
}

const approvalFlags = new Set([
  "--approved-by-robert",
  "--robert-approved-build",
  "--client-approved-scope",
  "--deposit-paid",
  "--public-data-verified",
]);

function redactApprovalFlags(command: string) {
  const redacted = command
    .split(" ")
    .filter((part) => {
      const cleaned = part.replace(/^'+|'+$/g, "");
      return !approvalFlags.has(cleaned);
    })
    .join(" ");

  return redacted === command ? command : `${redacted} [approval flags withheld until evidence is approved]`;
}

function redactCommandQueueItem<T extends { command: string }>(item: T): T {
  return {
    ...item,
    command: redactApprovalFlags(item.command),
  };
}

function renderDryRunMarkdown(input: {
  generatedAt: string;
  commandCenter: ReturnType<typeof buildRevenueFirstMoneyCommandCenter>;
}) {
  const { commandCenter } = input;
  const nextCommand = redactCommandQueueItem(commandCenter.nextCommand);
  const queue = commandCenter.queue.map(redactCommandQueueItem);
  return [
    `# Revenue First Money Dry Run - ${slugDate(input.generatedAt)}`,
    "",
    "## Next Action",
    "",
    `- Status: ${commandCenter.status}`,
    `- Mode: ${commandCenter.mode}`,
    `- Next command: \`${nextCommand.command}\``,
    `- Reason: ${nextCommand.reason}`,
    "",
    "## Counts",
    "",
    `- Public candidates: ${commandCenter.counts.publicCandidates}`,
    `- Public candidates needing verification: ${commandCenter.counts.verificationNeededPublicCandidates}`,
    `- Reviewable public candidates: ${commandCenter.counts.reviewablePublicCandidates}`,
    `- Manual-only public candidates: ${commandCenter.counts.manualOnlyPublicCandidates}`,
    `- Import-ready candidates: ${commandCenter.counts.importReadyCandidates}`,
    `- Leads: ${commandCenter.counts.leads}`,
    `- Outreach drafts: ${commandCenter.counts.outreachDrafts}`,
    `- Reviewable outreach drafts: ${commandCenter.counts.reviewableOutreachDrafts}`,
    `- Approved outreach drafts: ${commandCenter.counts.approvedOutreachDrafts}`,
    "",
    "## Command Queue",
    "",
    ...queue.map((item) => [
      `### ${item.label}`,
      "",
      `- ID: ${item.id}`,
      `- Status: ${item.status}`,
      `- Command: \`${item.command}\``,
      `- Reason: ${item.reason}`,
      "",
    ].join("\n")),
    "## Safety",
    "",
    "- This dry run does not execute the next command.",
    "- This dry run does not import leads.",
    "- This dry run does not send outreach.",
    "- This dry run does not charge clients.",
    "- This dry run does not publish or deploy websites.",
    "- Approval flags are withheld from copy-paste commands until Robert approves the exact evidence and next step.",
    "",
    "## Command Center Text",
    "",
    "```text",
    formatRevenueFirstMoneyCommandCenterText({
      ...commandCenter,
      nextCommand,
      queue,
    }),
    "```",
    "",
  ].join("\n");
}

export function buildRevenueFirstMoneyDryRun(options: RevenueFirstMoneyDryRunCliOptions) {
  const commandCenterOptions: RevenueFirstMoneyCommandCenterCliOptions = {
    mode: options.mode,
    json: false,
  };
  const commandCenter = buildRevenueFirstMoneyCommandCenter(commandCenterOptions);
  const nextCommand = redactCommandQueueItem(commandCenter.nextCommand);
  const queue = commandCenter.queue.map(redactCommandQueueItem);
  const markdown = renderDryRunMarkdown({
    generatedAt: options.now,
    commandCenter,
  });
  const outputPath = path.join(path.resolve(options.outputDir), `${slugDate(options.now)}-first-money-dry-run.md`);

  if (options.writeFile) {
    mkdirSync(path.dirname(outputPath), { recursive: true });
    writeFileSync(outputPath, markdown);
  }

  return {
    status: commandCenter.status,
    generatedAt: options.now,
    outputPath: options.writeFile ? outputPath : "",
    wroteFile: options.writeFile,
    nextCommand,
    queue,
    counts: commandCenter.counts,
    safety: {
      writesFiles: options.writeFile,
      executesNextCommand: false,
      importsLeads: false,
      sendsOutreach: false,
      chargesClients: false,
      deploys: false,
      printsSecrets: false,
    },
    markdown,
  };
}

export function formatRevenueFirstMoneyDryRunText(result: ReturnType<typeof buildRevenueFirstMoneyDryRun>) {
  return [
    `Revenue first-money dry run: ${result.status}`,
    `Generated: ${result.generatedAt}`,
    `Wrote file: ${result.wroteFile ? "yes" : "no"}`,
    result.outputPath ? `Output: ${result.outputPath}` : "Output: none",
    `Next command: ${result.nextCommand.command}`,
    `Next reason: ${result.nextCommand.reason}`,
    "",
    "Safety:",
    `- Executes next command: ${result.safety.executesNextCommand ? "yes" : "no"}`,
    `- Imports leads: ${result.safety.importsLeads ? "yes" : "no"}`,
    `- Sends outreach: ${result.safety.sendsOutreach ? "yes" : "no"}`,
    `- Charges clients: ${result.safety.chargesClients ? "yes" : "no"}`,
    `- Deploys: ${result.safety.deploys ? "yes" : "no"}`,
    `- Prints secrets: ${result.safety.printsSecrets ? "yes" : "no"}`,
  ].join("\n");
}

export function getRevenueFirstMoneyDryRunExitCode(result: ReturnType<typeof buildRevenueFirstMoneyDryRun>) {
  return result.nextCommand.status === "blocked" ? 1 : 0;
}
