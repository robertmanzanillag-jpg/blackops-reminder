import { sendRevenueOutreachDraft } from "./revenue-engine";

export type RevenueOutreachSendCliOptions = {
  draftId: string;
  approvalDecisionId: string;
  sendConfirmation: string;
  confirmedByRobert: boolean;
  json: boolean;
};

function getArgValue(argv: string[], name: string) {
  const prefix = `${name}=`;
  const arg = argv.find((value) => value.startsWith(prefix));
  return arg ? arg.slice(prefix.length).trim() : "";
}

function hasPlaceholderValue(value: string) {
  return /\b(REPLACE_WITH|PLACEHOLDER|TODO|TBD|YOUR_|DRAFT_ID|APPROVAL_DECISION_ID)/i.test(value);
}

function displayText(value: string | number | null | undefined) {
  return String(value ?? "")
    .replace(/[\p{Cf}\u0000-\u001f\u007f-\u009f]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function parseRevenueOutreachSendArgs(argv: string[]): RevenueOutreachSendCliOptions {
  return {
    draftId: getArgValue(argv, "--draft-id"),
    approvalDecisionId: getArgValue(argv, "--approval-decision-id"),
    sendConfirmation: getArgValue(argv, "--confirm-send"),
    confirmedByRobert: argv.includes("--confirmed-by-robert"),
    json: argv.includes("--json"),
  };
}

export function validateRevenueOutreachSendOptions(options: RevenueOutreachSendCliOptions) {
  const errors: string[] = [];
  if (!options.draftId) errors.push("--draft-id is required.");
  else if (hasPlaceholderValue(options.draftId)) errors.push("--draft-id must be a real outreach draft id, not a placeholder.");
  if (!options.approvalDecisionId) errors.push("--approval-decision-id is required.");
  else if (hasPlaceholderValue(options.approvalDecisionId)) errors.push("--approval-decision-id must be a real outreach approval decision id, not a placeholder.");
  if (!options.confirmedByRobert) errors.push("--confirmed-by-robert is required before contacting a business.");
  const expectedConfirmation = options.draftId && options.approvalDecisionId
    ? `SEND ${options.draftId} ${options.approvalDecisionId}`
    : "";
  if (!options.sendConfirmation) {
    errors.push("--confirm-send is required and must be typed from fresh Robert send approval.");
  } else if (hasPlaceholderValue(options.sendConfirmation)) {
    errors.push("--confirm-send must be real send approval context, not a placeholder.");
  } else if (expectedConfirmation && options.sendConfirmation !== expectedConfirmation) {
    errors.push(`--confirm-send must exactly equal "${expectedConfirmation}".`);
  }
  return errors;
}

export async function sendRevenueOutreachDraftFromCli(options: RevenueOutreachSendCliOptions) {
  const validationErrors = validateRevenueOutreachSendOptions(options);
  if (validationErrors.length) {
    return {
      status: "blocked" as const,
      provider: null,
      gates: [],
      reason: validationErrors.join(" "),
      draft: null,
      snapshot: null,
      safety: {
        requiresRobertConfirmation: true,
        sendsOutreach: false,
        chargesClients: false,
        deploys: false,
        paidDataSpendUsd: 0,
      },
    };
  }

  const result = await sendRevenueOutreachDraft({
    draftId: options.draftId,
    approvalDecisionId: options.approvalDecisionId,
    sendConfirmation: options.sendConfirmation,
  });

  return {
    ...result,
    safety: {
      requiresRobertConfirmation: true,
      sendsOutreach: result.status === "sent",
      chargesClients: false,
      deploys: false,
      paidDataSpendUsd: 0,
    },
  };
}

export function formatRevenueOutreachSendText(result: Awaited<ReturnType<typeof sendRevenueOutreachDraftFromCli>>) {
  return [
    `Revenue outreach send: ${result.status}`,
    `Reason: ${displayText("reason" in result ? result.reason : "") || "none"}`,
    `Draft id: ${displayText(result.draft?.id || "none")}`,
    `Business: ${displayText(result.draft?.businessName || "none")}`,
    `Recipient: ${displayText(result.draft?.recipientEmail || "none")}`,
    `Provider configured: ${result.provider ? (result.provider.configured ? "yes" : "no") : "not checked"}`,
    result.provider?.missing.length ? `Provider missing: ${result.provider.missing.join(", ")}` : "",
    "",
    "Gates:",
    ...(result.gates.length
      ? result.gates.map((gate) => `- ${displayText(gate.gate)}: ${gate.passed ? "pass" : "fail"}${gate.passed ? "" : ` (${displayText(gate.fix)})`}`)
      : ["- not checked"]),
    "",
    "Safety:",
    `- Requires Robert confirmation: ${result.safety.requiresRobertConfirmation ? "yes" : "no"}`,
    `- Sends outreach: ${result.safety.sendsOutreach ? "yes" : "no"}`,
    `- Charges clients: ${result.safety.chargesClients ? "yes" : "no"}`,
    `- Deploys: ${result.safety.deploys ? "yes" : "no"}`,
    `- Paid data spend: $${result.safety.paidDataSpendUsd}`,
  ].filter(Boolean).join("\n");
}

export function getRevenueOutreachSendExitCode(result: Awaited<ReturnType<typeof sendRevenueOutreachDraftFromCli>>) {
  return result.status === "sent" ? 0 : 1;
}
