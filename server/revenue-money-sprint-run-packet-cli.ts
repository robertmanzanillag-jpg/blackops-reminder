import { readFileSync } from "node:fs";
import { previewRevenueMoneySprintSeeds, revenueMoneySprintSchema, runRevenueMoneySprint, type RevenueMoneySprintInput } from "./revenue-engine";

export type RevenueMoneySprintRunPacketCliOptions = {
  inputPath: string;
  execute: boolean;
  approvedByRobert: boolean;
  json: boolean;
};

type MoneySprintRunPacketReviewJson = {
  status?: string;
  nextApiAction?: string;
  approvedCount?: number;
  moneySprintRunPacket?: {
    status?: string;
    endpoint?: string;
    method?: string;
    requestBody?: unknown;
    safety?: {
      sendsOutreach?: boolean;
      writesPreviewFiles?: boolean;
      paidDataSpendUsd?: number;
      requiresRobertApprovalBeforeRun?: boolean;
      requiresRobertApprovalBeforeContact?: boolean;
    };
    expectedOutput?: {
      acceptedLeads?: number;
      mockupsToPrepare?: number;
      outreachDraftsToCreate?: number;
    };
  };
};

function countSeedLeadBatchRows(batchText: string) {
  const lines = batchText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  return Math.max(0, lines.length - 1);
}

export function parseRevenueMoneySprintRunPacketArgs(argv: string[]): RevenueMoneySprintRunPacketCliOptions {
  const getValue = (name: string) => {
    const prefix = `${name}=`;
    const arg = argv.find((value) => value.startsWith(prefix));
    return arg ? arg.slice(prefix.length).trim() : "";
  };

  return {
    inputPath: getValue("--input"),
    execute: argv.includes("--execute"),
    approvedByRobert: argv.includes("--approved-by-robert"),
    json: argv.includes("--json"),
  };
}

export function validateRevenueMoneySprintRunPacketOptions(options: RevenueMoneySprintRunPacketCliOptions): string[] {
  const errors: string[] = [];
  if (!options.inputPath) errors.push("--input is required.");
  if (options.execute && !options.approvedByRobert) {
    errors.push("--approved-by-robert is required with --execute.");
  }
  return errors;
}

export function readRevenueMoneySprintRunPacketInput(inputPath: string) {
  return JSON.parse(readFileSync(inputPath, "utf8")) as MoneySprintRunPacketReviewJson;
}

export function validateRevenueMoneySprintRunPacketReview(review: MoneySprintRunPacketReviewJson): {
  errors: string[];
  requestBody: RevenueMoneySprintInput | null;
} {
  const packet = review.moneySprintRunPacket;
  const parsedRequest = packet ? revenueMoneySprintSchema.safeParse(packet.requestBody) : null;
  const requestBody = parsedRequest?.success ? parsedRequest.data : null;
  const approvedCountIsValid = Number.isInteger(review.approvedCount) && Number(review.approvedCount) > 0;
  const batchRowCount = requestBody ? countSeedLeadBatchRows(requestBody.seedLeadBatchText) : 0;
  const preview = requestBody ? previewRevenueMoneySprintSeeds(requestBody) : null;
  const unreadySeedNames = preview
    ? preview.acceptedSeeds
      .filter((seed) => !seed.draftReady || seed.qualification.missing.length > 0)
      .map((seed) => seed.businessName)
    : [];
  const errors = [
    review.status !== "ready_for_money_sprint_preview" && "review status must be ready_for_money_sprint_preview.",
    review.nextApiAction !== "human_review_money_sprint_packet" && "nextApiAction must be human_review_money_sprint_packet.",
    !approvedCountIsValid && "review must approve at least one candidate.",
    !packet && "moneySprintRunPacket is required.",
    packet?.status !== "ready_for_money_sprint_run" && "moneySprintRunPacket.status must be ready_for_money_sprint_run.",
    packet?.method !== "POST" && "moneySprintRunPacket.method must be POST.",
    packet?.endpoint !== "/api/revenue-engine/money-sprint" && "moneySprintRunPacket.endpoint must be /api/revenue-engine/money-sprint.",
    !parsedRequest?.success && "moneySprintRunPacket.requestBody is invalid.",
    requestBody?.maxPaidDataSpendUsd !== 0 && "requestBody.maxPaidDataSpendUsd must be 0.",
    requestBody?.requireRobertApprovalToContact !== true && "requestBody.requireRobertApprovalToContact must be true.",
    requestBody?.writePreviewFiles !== false && "requestBody.writePreviewFiles must be false.",
    (requestBody?.seedLeads.length ?? 0) > 0 && "requestBody.seedLeads must be empty; use reviewed seedLeadBatchText.",
    !requestBody?.seedLeadBatchText.trim() && "requestBody.seedLeadBatchText is required.",
    requestBody && approvedCountIsValid && batchRowCount !== review.approvedCount && "seedLeadBatchText row count must match approvedCount.",
    packet?.expectedOutput?.acceptedLeads !== review.approvedCount && "packet expectedOutput.acceptedLeads must match approvedCount.",
    preview && preview.status !== "ready_to_import" && "money sprint preview must be ready_to_import.",
    preview && approvedCountIsValid && preview.totals.accepted !== review.approvedCount && "money sprint preview accepted count must match approvedCount.",
    preview && approvedCountIsValid && preview.totals.draftReady !== review.approvedCount && "money sprint preview draftReady count must match approvedCount.",
    preview && preview.totals.blocked > 0 && "money sprint preview must not contain blocked rows.",
    unreadySeedNames.length > 0 && `money sprint preview contains non-draft-ready rows: ${unreadySeedNames.join(", ")}.`,
    preview && packet?.expectedOutput?.mockupsToPrepare !== preview.totals.mockupReady && "packet expectedOutput.mockupsToPrepare must match preview mockupReady count.",
    preview && packet?.expectedOutput?.outreachDraftsToCreate !== preview.totals.draftReady && "packet expectedOutput.outreachDraftsToCreate must match preview draftReady count.",
    packet?.safety?.paidDataSpendUsd !== 0 && "packet safety paidDataSpendUsd must be 0.",
    packet?.safety?.sendsOutreach !== false && "packet safety sendsOutreach must be false.",
    packet?.safety?.writesPreviewFiles !== false && "packet safety writesPreviewFiles must be false.",
    packet?.safety?.requiresRobertApprovalBeforeRun !== true && "packet must require Robert approval before run.",
    packet?.safety?.requiresRobertApprovalBeforeContact !== true && "packet must require Robert approval before contact.",
  ].filter((item): item is string => Boolean(item));

  return { errors, requestBody };
}

export function buildRevenueMoneySprintRunPacketExecution(
  review: MoneySprintRunPacketReviewJson,
  options: Pick<RevenueMoneySprintRunPacketCliOptions, "execute" | "approvedByRobert">,
) {
  const validation = validateRevenueMoneySprintRunPacketReview(review);
  if (validation.errors.length || !validation.requestBody) {
    return {
      status: "blocked" as const,
      validationErrors: validation.errors,
      executed: false,
      result: null,
      safety: {
        persistsLeads: false,
        writesPreviewFiles: false,
        sendsOutreach: false,
        paidDataSpendUsd: 0,
        requiresRobertApproval: true,
      },
    };
  }

  if (!options.execute) {
    return {
      status: "ready_to_execute" as const,
      validationErrors: [],
      executed: false,
      requestBody: validation.requestBody,
      result: null,
      nextAction: "Rerun with --execute --approved-by-robert after final human review.",
      safety: {
        persistsLeads: false,
        writesPreviewFiles: false,
        sendsOutreach: false,
        paidDataSpendUsd: 0,
        requiresRobertApproval: true,
      },
    };
  }

  if (!options.approvedByRobert) {
    return {
      status: "blocked" as const,
      validationErrors: ["--approved-by-robert is required to execute the money sprint packet."],
      executed: false,
      result: null,
      safety: {
        persistsLeads: false,
        writesPreviewFiles: false,
        sendsOutreach: false,
        paidDataSpendUsd: 0,
        requiresRobertApproval: true,
      },
    };
  }

  const result = runRevenueMoneySprint(validation.requestBody);
  return {
    status: "executed" as const,
    validationErrors: [],
    executed: true,
    result,
    safety: {
      persistsLeads: true,
      writesPreviewFiles: false,
      sendsOutreach: false,
      paidDataSpendUsd: 0,
      requiresRobertApproval: true,
    },
  };
}

export function formatRevenueMoneySprintRunPacketExecutionText(result: ReturnType<typeof buildRevenueMoneySprintRunPacketExecution>) {
  return [
    `Revenue money sprint run packet: ${result.status}`,
    `Executed: ${result.executed ? "yes" : "no"}`,
    "",
    "Validation:",
    ...(result.validationErrors.length ? result.validationErrors.map((error) => `- ${error}`) : ["- passed"]),
    "",
    "Safety:",
    `- Persists leads: ${result.safety.persistsLeads ? "yes" : "no"}`,
    `- Writes preview files: ${result.safety.writesPreviewFiles ? "yes" : "no"}`,
    `- Sends outreach: ${result.safety.sendsOutreach ? "yes" : "no"}`,
    `- Paid data spend: $${result.safety.paidDataSpendUsd}`,
    `- Requires Robert approval: ${result.safety.requiresRobertApproval ? "yes" : "no"}`,
    "nextAction" in result && result.nextAction ? `Next action: ${result.nextAction}` : "",
    result.result
      ? [
        "",
        "Execution result:",
        `- Status: ${result.result.status}`,
        `- Recorded leads: ${result.result.recordedLeads.length}`,
        `- Mockup previews: ${result.result.previews.length}`,
        `- Outreach drafts: ${result.result.outreachDrafts.length}`,
        `- Blocked seeds: ${result.result.blockedSeeds.length}`,
      ].join("\n")
      : "",
  ].filter(Boolean).join("\n");
}

export function getRevenueMoneySprintRunPacketExitCode(result: ReturnType<typeof buildRevenueMoneySprintRunPacketExecution>) {
  return result.status === "blocked" ? 1 : 0;
}
