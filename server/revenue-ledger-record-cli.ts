import {
  recordRevenueLedgerEntry,
  type RevenueLedgerEntryInput,
} from "./revenue-engine";

export type RevenueLedgerRecordCliOptions = RevenueLedgerEntryInput & {
  confirmedByRobert: boolean;
  json: boolean;
};

function getArgValue(argv: string[], name: string) {
  const prefix = `${name}=`;
  const arg = argv.find((value) => value.startsWith(prefix));
  return arg ? arg.slice(prefix.length).trim() : "";
}

function parseNumberArg(argv: string[], name: string, fallback: number) {
  const value = getArgValue(argv, name);
  return value ? Number(value) : fallback;
}

function hasPlaceholderValue(value: string) {
  const trimmed = value.trim();
  return /\b(REPLACE[\s_-]*WITH|PLACEHOLDER|TODO|TBD|YOUR[\s_-]+)/i.test(trimmed)
    || /^(CLIENT[\s_-]*NAME|LEDGER[\s_-]*CONFIRMATION|APPROVAL[\s_-]*DECISION[\s_-]*ID)$/i.test(trimmed);
}

function displayText(value: string | number | null | undefined) {
  return String(value ?? "")
    .replace(/[\p{Cf}\u0000-\u001f\u007f-\u009f]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function buildRevenueLedgerRecordConfirmation(input: Pick<RevenueLedgerEntryInput, "kind" | "clientName" | "approvalDecisionId">) {
  return `RECORD ${input.kind} ${input.clientName} ${input.approvalDecisionId || ""}`.trim();
}

export function parseRevenueLedgerRecordArgs(argv: string[]): RevenueLedgerRecordCliOptions {
  return {
    kind: (getArgValue(argv, "--kind") || "website_sale") as RevenueLedgerRecordCliOptions["kind"],
    clientName: getArgValue(argv, "--client-name"),
    amountUsd: parseNumberArg(argv, "--amount-usd", 0),
    cashCollectedUsd: parseNumberArg(argv, "--cash-collected-usd", 0),
    estimatedInternalCostUsd: parseNumberArg(argv, "--estimated-internal-cost-usd", 0),
    notes: getArgValue(argv, "--notes"),
    approvalDecisionId: getArgValue(argv, "--approval-decision-id"),
    ledgerConfirmation: getArgValue(argv, "--confirm-ledger"),
    confirmedByRobert: argv.includes("--confirmed-by-robert"),
    json: argv.includes("--json"),
  };
}

export function validateRevenueLedgerRecordOptions(options: RevenueLedgerRecordCliOptions) {
  const errors: string[] = [];
  if (!["website_sale", "automation_sale", "bundle_sale", "retainer", "expense"].includes(options.kind)) {
    errors.push("--kind must be website_sale, automation_sale, bundle_sale, retainer, or expense.");
  }
  if (options.clientName.trim().length < 2) errors.push("--client-name is required.");
  else if (hasPlaceholderValue(options.clientName)) errors.push("--client-name must be the real client/business name, not a placeholder.");
  if (!Number.isFinite(options.amountUsd) || options.amountUsd <= 0 || options.amountUsd > 1000000) {
    errors.push("--amount-usd must be greater than 0 and at most 1000000.");
  }
  if (!Number.isFinite(options.cashCollectedUsd) || options.cashCollectedUsd < 0 || options.cashCollectedUsd > 1000000) {
    errors.push("--cash-collected-usd must be from 0 to 1000000.");
  }
  if (!Number.isFinite(options.estimatedInternalCostUsd) || options.estimatedInternalCostUsd < 0 || options.estimatedInternalCostUsd > 100000) {
    errors.push("--estimated-internal-cost-usd must be from 0 to 100000.");
  }
  if (options.notes.trim().length > 0 && hasPlaceholderValue(options.notes)) {
    errors.push("--notes must be real ledger context, not a placeholder.");
  }
  if (!options.confirmedByRobert) errors.push("--confirmed-by-robert is required before recording ledger cash.");

  if (options.kind !== "expense") {
    if (!options.approvalDecisionId) errors.push("--approval-decision-id is required for sale/retainer ledger entries.");
    else if (hasPlaceholderValue(options.approvalDecisionId)) errors.push("--approval-decision-id must be real, not a placeholder.");
    if (options.cashCollectedUsd <= 0) errors.push("--cash-collected-usd must be greater than 0 for sale/retainer ledger entries.");
    const expectedConfirmation = buildRevenueLedgerRecordConfirmation(options);
    if (!options.ledgerConfirmation) {
      errors.push("--confirm-ledger is required and must be typed from fresh Robert ledger approval.");
    } else if (hasPlaceholderValue(options.ledgerConfirmation)) {
      errors.push("--confirm-ledger must be real ledger approval context, not a placeholder.");
    } else if (options.approvalDecisionId && options.ledgerConfirmation !== expectedConfirmation) {
      errors.push(`--confirm-ledger must exactly equal "${expectedConfirmation}".`);
    }
  }

  return errors;
}

export function recordRevenueLedgerEntryFromCli(options: RevenueLedgerRecordCliOptions) {
  const validationErrors = validateRevenueLedgerRecordOptions(options);
  if (validationErrors.length) {
    return {
      entry: null,
      snapshot: null,
      guardrail: {
        status: "blocked" as const,
        reason: validationErrors.join(" "),
      },
      safety: {
        recordsLedgerEntry: false,
        chargesClients: false,
        sendsOutreach: false,
        deploys: false,
      },
    };
  }

  const result = recordRevenueLedgerEntry({
    kind: options.kind,
    clientName: options.clientName,
    amountUsd: options.amountUsd,
    cashCollectedUsd: options.cashCollectedUsd,
    estimatedInternalCostUsd: options.estimatedInternalCostUsd,
    notes: options.notes,
    approvalDecisionId: options.approvalDecisionId,
    ledgerConfirmation: options.ledgerConfirmation,
    confirmedByRobert: options.confirmedByRobert,
  });

  return {
    ...result,
    safety: {
      recordsLedgerEntry: Boolean(result.entry),
      chargesClients: false,
      sendsOutreach: false,
      deploys: false,
    },
  };
}

export function formatRevenueLedgerRecordText(result: ReturnType<typeof recordRevenueLedgerEntryFromCli>) {
  return [
    `Revenue ledger record: ${result.entry ? "recorded" : "blocked"}`,
    `Entry id: ${result.entry?.id || "none"}`,
    `Kind: ${displayText(result.entry?.kind || "none")}`,
    `Client: ${displayText(result.entry?.clientName || "none")}`,
    `Cash collected: $${result.entry?.cashCollectedUsd || 0}`,
    `Guardrail: ${result.guardrail.status}`,
    `Reason: ${displayText(result.guardrail.reason)}`,
    "",
    "Safety:",
    `- Records ledger entry: ${result.safety.recordsLedgerEntry ? "yes" : "no"}`,
    `- Charges clients: ${result.safety.chargesClients ? "yes" : "no"}`,
    `- Sends outreach: ${result.safety.sendsOutreach ? "yes" : "no"}`,
    `- Deploys: ${result.safety.deploys ? "yes" : "no"}`,
  ].join("\n");
}

export function getRevenueLedgerRecordExitCode(result: ReturnType<typeof recordRevenueLedgerEntryFromCli>) {
  return result.entry ? 0 : 1;
}
