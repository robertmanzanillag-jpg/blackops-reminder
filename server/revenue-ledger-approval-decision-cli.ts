import {
  recordRevenueTrustedApprovalDecision,
} from "./revenue-engine";
import {
  buildRevenueLedgerApprovalSnapshotHash,
  buildRevenueLedgerApprovalTargetId,
  type RevenueLedgerApprovalSnapshot,
} from "./revenue-ledger-approval";

export type RevenueLedgerApprovalDecisionCliOptions = RevenueLedgerApprovalSnapshot & {
  decision: "approved" | "rejected" | "needs_changes";
  approvedAction: string;
  paymentEvidence: string;
  confirmedByRobert: boolean;
  json: boolean;
};

function getArgValue(argv: string[], name: string) {
  const prefix = `${name}=`;
  const arg = argv.find((value) => value.startsWith(prefix));
  return arg ? arg.slice(prefix.length).trim() : "";
}

function shellQuote(value: string) {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

function npmRunText(script: string, args: string[] = []) {
  return ["npm", "run", script, "--", ...args].map(shellQuote).join(" ");
}

function parseNumberArg(argv: string[], name: string, fallback: number) {
  const value = getArgValue(argv, name);
  return value ? Number(value) : fallback;
}

export function buildRevenueLedgerApprovalNotes(notes: string, paymentEvidence: string) {
  return [
    notes.trim(),
    paymentEvidence.trim() ? `Payment evidence: ${paymentEvidence.trim()}` : "",
  ].filter(Boolean).join(" | ");
}

export function parseRevenueLedgerApprovalDecisionArgs(argv: string[]): RevenueLedgerApprovalDecisionCliOptions {
  const notes = getArgValue(argv, "--notes");
  const paymentEvidence = getArgValue(argv, "--payment-evidence");
  return {
    kind: (getArgValue(argv, "--kind") || "bundle_sale") as RevenueLedgerApprovalDecisionCliOptions["kind"],
    clientName: getArgValue(argv, "--client-name"),
    amountUsd: parseNumberArg(argv, "--amount-usd", 0),
    cashCollectedUsd: parseNumberArg(argv, "--cash-collected-usd", 0),
    estimatedInternalCostUsd: parseNumberArg(argv, "--estimated-internal-cost-usd", 0),
    notes: buildRevenueLedgerApprovalNotes(notes, paymentEvidence),
    decision: (getArgValue(argv, "--decision") || "needs_changes") as RevenueLedgerApprovalDecisionCliOptions["decision"],
    approvedAction: getArgValue(argv, "--approved-action") || "Approve exact paid ledger entry after Robert verified payment evidence.",
    paymentEvidence,
    confirmedByRobert: argv.includes("--confirmed-by-robert"),
    json: argv.includes("--json"),
  };
}

export function validateRevenueLedgerApprovalDecisionOptions(options: RevenueLedgerApprovalDecisionCliOptions) {
  const errors: string[] = [];
  if (!["website_sale", "automation_sale", "bundle_sale", "retainer"].includes(options.kind)) {
    errors.push("--kind must be website_sale, automation_sale, bundle_sale, or retainer.");
  }
  if (options.clientName.trim().length < 2) errors.push("--client-name is required.");
  if (!Number.isFinite(options.amountUsd) || options.amountUsd <= 0 || options.amountUsd > 1000000) {
    errors.push("--amount-usd must be greater than 0 and at most 1000000.");
  }
  if (!Number.isFinite(options.cashCollectedUsd) || options.cashCollectedUsd <= 0 || options.cashCollectedUsd > 1000000) {
    errors.push("--cash-collected-usd must be greater than 0 and at most 1000000.");
  }
  if (!Number.isFinite(options.estimatedInternalCostUsd) || options.estimatedInternalCostUsd < 0 || options.estimatedInternalCostUsd > 100000) {
    errors.push("--estimated-internal-cost-usd must be from 0 to 100000.");
  }
  if (!["approved", "rejected", "needs_changes"].includes(options.decision)) {
    errors.push("--decision must be approved, rejected, or needs_changes.");
  }
  if (options.approvedAction.trim().length < 8) {
    errors.push("--approved-action must describe the approved/rejected action.");
  }
  if (options.decision === "approved" && options.paymentEvidence.trim().length < 8) {
    errors.push("--payment-evidence must describe the collected cash proof for approved ledger entries.");
  }
  return errors;
}

export function buildRevenueLedgerApprovalDecisionFromCli(options: RevenueLedgerApprovalDecisionCliOptions) {
  const ledgerInput: RevenueLedgerApprovalSnapshot = {
    kind: options.kind,
    clientName: options.clientName,
    amountUsd: options.amountUsd,
    cashCollectedUsd: options.cashCollectedUsd,
    estimatedInternalCostUsd: options.estimatedInternalCostUsd,
    notes: options.notes,
  };
  const targetId = buildRevenueLedgerApprovalTargetId(ledgerInput);
  const blockers = [
    !options.confirmedByRobert && "--confirmed-by-robert is required to record a ledger approval decision.",
    options.decision === "approved" && options.cashCollectedUsd <= 0 && "approved ledger entries require cash collected.",
    options.decision === "approved" && options.paymentEvidence.trim().length < 8 && "--payment-evidence is required for approved ledger entries.",
  ].filter((item): item is string => Boolean(item));

  if (blockers.length) {
    return {
      status: "blocked" as const,
      decision: null,
      targetId,
      ledgerInput,
      blockers,
      nextApiBody: null,
      nextCommand: "",
      nextAction: "Resolve blockers before recording this ledger decision.",
      safety: {
        persistsApprovalDecision: false,
        recordsLedgerEntry: false,
        chargesClients: false,
        sendsOutreach: false,
        paidDataSpendUsd: 0,
      },
    };
  }

  const result = recordRevenueTrustedApprovalDecision({
    targetId,
    targetType: "ledger_entry",
    decision: options.decision,
    approvedAction: options.approvedAction,
    maxSpendUsd: 0,
    notes: options.paymentEvidence,
    approvalSource: "ledger_entry_approval_cli",
    publicCandidateSnapshotHash: "",
    outreachDraftSnapshotHash: "",
    websiteCreationSnapshotHash: "",
    websitePublishSnapshotHash: "",
    paymentPathSnapshotHash: "",
    contactPathSnapshotHash: "",
    ledgerEntrySnapshotHash: buildRevenueLedgerApprovalSnapshotHash(ledgerInput),
  });
  const nextApiBody = options.decision === "approved"
    ? {
      ...ledgerInput,
      approvalDecisionId: result.decision.id,
    }
    : null;
  const nextCommand = nextApiBody
    ? `POST /api/revenue-engine/ledger body ${JSON.stringify(nextApiBody)}`
    : "";

  return {
    status: result.decision.guardrail.status === "recorded" ? "recorded" as const : "blocked" as const,
    decision: result.decision,
    targetId,
    ledgerInput,
    blockers: result.decision.guardrail.status === "recorded" ? [] : [result.decision.guardrail.reason],
    nextApiBody,
    nextCommand,
    nextAction: nextApiBody
      ? "Record the ledger entry with this exact approvalDecisionId and unchanged sale fields."
      : "Decision recorded; do not record this ledger entry unless Robert changes the decision.",
    safety: {
      persistsApprovalDecision: result.decision.guardrail.status === "recorded",
      recordsLedgerEntry: false,
      chargesClients: false,
      sendsOutreach: false,
      paidDataSpendUsd: 0,
    },
  };
}

export function formatRevenueLedgerApprovalDecisionText(result: ReturnType<typeof buildRevenueLedgerApprovalDecisionFromCli>) {
  return [
    `Revenue ledger approval decision: ${result.status}`,
    `Decision id: ${result.decision?.id || "none"}`,
    `Target: ${result.targetId}`,
    `Ledger kind: ${result.ledgerInput.kind}`,
    `Client: ${result.ledgerInput.clientName || "none"}`,
    `Cash collected: $${result.ledgerInput.cashCollectedUsd}`,
    `Blockers: ${result.blockers.length ? result.blockers.join("; ") : "none"}`,
    `Next API body: ${result.nextApiBody ? JSON.stringify(result.nextApiBody) : "none"}`,
    `Next command: ${result.nextCommand || "none"}`,
    `Next action: ${result.nextAction}`,
    "",
    "Safety:",
    `- Persists approval decision: ${result.safety.persistsApprovalDecision ? "yes" : "no"}`,
    `- Records ledger entry: ${result.safety.recordsLedgerEntry ? "yes" : "no"}`,
    `- Charges clients: ${result.safety.chargesClients ? "yes" : "no"}`,
    `- Sends outreach: ${result.safety.sendsOutreach ? "yes" : "no"}`,
    `- Paid data spend: $${result.safety.paidDataSpendUsd}`,
  ].join("\n");
}

export function getRevenueLedgerApprovalDecisionExitCode(result: ReturnType<typeof buildRevenueLedgerApprovalDecisionFromCli>) {
  return result.status === "recorded" ? 0 : 1;
}
