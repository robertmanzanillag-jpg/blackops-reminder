import { runRevenueScoutDispatch } from "./revenue-engine";

export type RevenueScoutDispatchCliOptions = {
  json: boolean;
  area: string;
  niche: string;
  offerFocus: "websites" | "automations" | "both";
  targetLeadCount: number;
  maxTasks: number;
  resultSlotsPerTask: number;
};

const offerFocusOptions = ["websites", "automations", "both"] as const;

function readArgValue(argv: string[], name: string): string | undefined {
  const prefix = `${name}=`;
  const equalsArg = argv.find((value) => value.startsWith(prefix));
  if (equalsArg) return equalsArg.slice(prefix.length).trim();

  const index = argv.indexOf(name);
  if (index < 0) return undefined;
  const nextValue = argv[index + 1];
  return nextValue && !nextValue.startsWith("--") ? nextValue.trim() : "";
}

function readNumberArg(argv: string[], name: string, fallback: number) {
  const value = readArgValue(argv, name);
  return value === undefined ? fallback : Number(value);
}

export function parseRevenueScoutDispatchArgs(argv: string[]): RevenueScoutDispatchCliOptions {
  const offerFocus = readArgValue(argv, "--offer-focus") ?? "both";
  return {
    json: argv.includes("--json"),
    area: readArgValue(argv, "--area") ?? "Miami",
    niche: readArgValue(argv, "--niche") ?? "restaurants",
    offerFocus: offerFocus as RevenueScoutDispatchCliOptions["offerFocus"],
    targetLeadCount: readNumberArg(argv, "--target", 10),
    maxTasks: readNumberArg(argv, "--max-tasks", 3),
    resultSlotsPerTask: readNumberArg(argv, "--slots-per-task", 2),
  };
}

export function validateRevenueScoutDispatchOptions(options: RevenueScoutDispatchCliOptions): string[] {
  const errors: string[] = [];
  if (options.area.trim().length < 2) errors.push("--area must be at least 2 characters.");
  if (options.niche.trim().length < 2) errors.push("--niche must be at least 2 characters.");
  if (!offerFocusOptions.includes(options.offerFocus)) errors.push(`--offer-focus must be one of: ${offerFocusOptions.join(", ")}.`);
  if (!Number.isInteger(options.targetLeadCount) || options.targetLeadCount < 5 || options.targetLeadCount > 50) errors.push("--target must be an integer between 5 and 50.");
  if (!Number.isInteger(options.maxTasks) || options.maxTasks < 3 || options.maxTasks > 30) errors.push("--max-tasks must be an integer between 3 and 30.");
  if (!Number.isInteger(options.resultSlotsPerTask) || options.resultSlotsPerTask < 1 || options.resultSlotsPerTask > 5) errors.push("--slots-per-task must be an integer between 1 and 5.");
  return errors;
}

export function runRevenueScoutDispatchFromCliOptions(options: RevenueScoutDispatchCliOptions) {
  return runRevenueScoutDispatch({
    area: options.area,
    niche: options.niche,
    offerFocus: options.offerFocus,
    targetLeadCount: options.targetLeadCount,
    maxTasks: options.maxTasks,
    resultSlotsPerTask: options.resultSlotsPerTask,
    maxPaidDataSpendUsd: 0,
    requireRobertApprovalToContact: true,
    notes: "Scout dispatch created from Revenue scout dispatch CLI.",
  });
}

export function buildRevenueScoutDispatchCliPacket(result: ReturnType<typeof runRevenueScoutDispatchFromCliOptions>) {
  return {
    status: result.status,
    reason: result.reason,
    sprint: {
      id: result.sprint.id,
      area: result.sprint.area,
      niche: result.sprint.niche,
      offerFocus: result.sprint.offerFocus,
      targetRows: result.sprint.targetRows,
      taskCount: result.sprint.tasks.length,
    },
    dispatch: {
      mode: result.dispatch.mode,
      executionMode: result.dispatch.executionMode,
      blockedUntil: result.dispatch.blockedUntil,
      requiredExecutionBridge: result.dispatch.requiredExecutionBridge,
      readyToAssign: result.dispatch.readyToAssign,
      agentCount: result.dispatch.agentCount,
      taskCount: result.dispatch.taskCount,
      slotCount: result.dispatch.slotCount,
      agentAssignments: result.dispatch.agentAssignments,
      connectorIntake: {
        endpoint: result.dispatch.connectorIntake.endpoint,
        executionMode: result.dispatch.connectorIntake.executionMode,
        approvalLocked: result.dispatch.connectorIntake.approvalLocked,
        maxResults: result.dispatch.connectorIntake.maxResults,
        workOrderCount: result.dispatch.connectorIntake.workOrders.length,
      },
      copyableDispatchBrief: result.dispatch.copyableDispatchBrief,
    },
    safety: {
      researchesPublicSources: result.safety.researchesPublicSources,
      persistsScoutRun: result.safety.persistsScoutRun,
      persistsCandidates: result.safety.persistsCandidates,
      persistsLeads: result.safety.persistsLeads,
      sendsOutreach: result.safety.sendsOutreach,
      spendsMoney: result.safety.spendsMoney,
      deploys: result.safety.deploys,
      requiresRobertApprovalToContact: result.safety.requiresRobertApprovalToContact,
      downstreamCandidatePersistence: "Connector intake can persist review-only public candidates later; this dispatch command does not create candidates, leads, outreach, charges or deployments.",
    },
    nextAction: result.nextAction,
  };
}

export function formatRevenueScoutDispatchText(packet: ReturnType<typeof buildRevenueScoutDispatchCliPacket>): string {
  return [
    "Revenue Engine Scout Dispatch",
    `Status: ${packet.status}`,
    `Reason: ${packet.reason}`,
    `Sprint: ${packet.sprint.id}`,
    `Market: ${packet.sprint.area} / ${packet.sprint.niche}`,
    `Offer focus: ${packet.sprint.offerFocus}`,
    `Target rows: ${packet.sprint.targetRows}`,
    "",
    "Assignments:",
    ...packet.dispatch.agentAssignments.map((agent) => `- ${agent.ownerAgent}: ${agent.taskCount} tasks / ${agent.slotCount} slots`),
    "",
    "Connector intake:",
    `- Endpoint: ${packet.dispatch.connectorIntake.endpoint}`,
    `- Approval locked: ${packet.dispatch.connectorIntake.approvalLocked ? "yes" : "no"}`,
    `- Work orders: ${packet.dispatch.connectorIntake.workOrderCount}`,
    `- Downstream persistence: ${packet.safety.downstreamCandidatePersistence}`,
    "",
    "Safety:",
    `- Researches public sources: ${packet.safety.researchesPublicSources ? "yes" : "no"}`,
    `- Persists scout run: ${packet.safety.persistsScoutRun ? "yes" : "no"}`,
    `- Persists candidates: ${packet.safety.persistsCandidates ? "yes" : "no"}`,
    `- Persists leads: ${packet.safety.persistsLeads ? "yes" : "no"}`,
    `- Sends outreach: ${packet.safety.sendsOutreach ? "yes" : "no"}`,
    `- Spends money: ${packet.safety.spendsMoney ? "yes" : "no"}`,
    `- Deploys: ${packet.safety.deploys ? "yes" : "no"}`,
    "",
    "Next action:",
    packet.nextAction,
    "",
    "Copyable dispatch brief:",
    packet.dispatch.copyableDispatchBrief,
  ].join("\n");
}
