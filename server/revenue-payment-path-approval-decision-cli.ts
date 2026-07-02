import {
  recordRevenueTrustedApprovalDecision,
} from "./revenue-engine";
import {
  buildRevenuePaymentPathApprovalTargetId,
  buildRevenuePaymentPathSnapshotHash,
} from "./revenue-payment-path-approval";

export type RevenuePaymentPathApprovalDecisionCliOptions = {
  paymentLink: string;
  decision: "approved" | "rejected" | "needs_changes";
  approvedAction: string;
  robertApprovedPaymentPath: boolean;
  paymentSmokeVerified: boolean;
  depositConfirmedByRobert: boolean;
  expectedDepositUsd: number;
  expectedPackage: string;
  evidenceUrl: string;
  evidenceNote: string;
  confirmedByRobert: boolean;
  chargeClient: boolean;
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

function parseUrl(value: string) {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

function hasPlaceholderValue(value: string) {
  return /\b(REPLACE_WITH|PLACEHOLDER|TODO|TBD|YOUR_)/i.test(value);
}

function isAllowedPaymentLink(value: string) {
  if (hasPlaceholderValue(value)) return false;
  const url = parseUrl(value);
  if (!url) return false;
  return url.protocol === "https:" && ["buy.stripe.com", "checkout.stripe.com", "invoice.stripe.com"].includes(url.hostname.toLowerCase());
}

export function parseRevenuePaymentPathApprovalDecisionArgs(argv: string[]): RevenuePaymentPathApprovalDecisionCliOptions {
  return {
    paymentLink: getArgValue(argv, "--payment-link"),
    decision: (getArgValue(argv, "--decision") || "needs_changes") as RevenuePaymentPathApprovalDecisionCliOptions["decision"],
    approvedAction: getArgValue(argv, "--approved-action") || "Approve exact payment path after Robert review and payment evidence.",
    robertApprovedPaymentPath: argv.includes("--robert-approved-payment-path"),
    paymentSmokeVerified: argv.includes("--payment-smoke-verified"),
    depositConfirmedByRobert: argv.includes("--deposit-confirmed-by-robert"),
    expectedDepositUsd: parseNumberArg(argv, "--expected-deposit-usd", 0),
    expectedPackage: getArgValue(argv, "--expected-package"),
    evidenceUrl: getArgValue(argv, "--evidence-url"),
    evidenceNote: getArgValue(argv, "--evidence-note"),
    confirmedByRobert: argv.includes("--confirmed-by-robert"),
    chargeClient: argv.includes("--charge-client"),
    json: argv.includes("--json"),
  };
}

export function validateRevenuePaymentPathApprovalDecisionOptions(options: RevenuePaymentPathApprovalDecisionCliOptions) {
  const errors: string[] = [];
  if (!options.paymentLink) errors.push("--payment-link is required.");
  else if (!isAllowedPaymentLink(options.paymentLink)) errors.push("--payment-link must be an HTTPS Stripe payment, checkout, or invoice link.");
  if (!["approved", "rejected", "needs_changes"].includes(options.decision)) errors.push("--decision must be approved, rejected, or needs_changes.");
  if (options.approvedAction.trim().length < 8) errors.push("--approved-action must describe the approved/rejected action.");
  if (!Number.isFinite(options.expectedDepositUsd) || options.expectedDepositUsd < 1 || options.expectedDepositUsd > 1000000) {
    errors.push("--expected-deposit-usd must be from 1 to 1000000.");
  }
  if (options.expectedPackage.trim().length < 2) errors.push("--expected-package is required.");
  if (!options.evidenceUrl) errors.push("--evidence-url is required.");
  else if (hasPlaceholderValue(options.evidenceUrl)) errors.push("--evidence-url must be real evidence, not a placeholder.");
  else if (!parseUrl(options.evidenceUrl)) errors.push("--evidence-url must be a valid URL.");
  if (options.evidenceNote.trim().length < 8) errors.push("--evidence-note must describe the payment smoke/deposit proof.");
  else if (hasPlaceholderValue(options.evidenceNote)) errors.push("--evidence-note must be real proof, not a placeholder.");
  return errors;
}

export function buildRevenuePaymentPathApprovalDecisionFromCli(options: RevenuePaymentPathApprovalDecisionCliOptions) {
  const paymentUrl = parseUrl(options.paymentLink);
  const paymentSnapshot = {
    paymentMethod: "payment_link" as const,
    paymentLink: options.paymentLink,
    paymentHost: paymentUrl?.hostname.toLowerCase() || "",
    expectedDepositUsd: options.expectedDepositUsd,
    expectedPackage: options.expectedPackage,
  };
  const proof = {
    robertApprovedPaymentPath: options.robertApprovedPaymentPath,
    paymentSmokeVerified: options.paymentSmokeVerified,
    depositConfirmedByRobert: options.depositConfirmedByRobert,
    paymentLink: options.paymentLink,
    evidenceUrl: options.evidenceUrl,
    evidenceNote: options.evidenceNote,
  };
  const approvalBlockers = [
    !isAllowedPaymentLink(options.paymentLink) && "--payment-link must be an HTTPS Stripe payment, checkout, or invoice link.",
    !options.robertApprovedPaymentPath && "--robert-approved-payment-path is required for approved payment paths.",
    !(options.paymentSmokeVerified || options.depositConfirmedByRobert) && "--payment-smoke-verified or --deposit-confirmed-by-robert is required.",
  ].filter((item): item is string => Boolean(item));
  const blockers = [
    !options.confirmedByRobert && "--confirmed-by-robert is required to record a payment path decision.",
    options.chargeClient && "--charge-client is blocked; this command never charges clients.",
    ...(options.decision === "approved" ? approvalBlockers : []),
  ].filter((item): item is string => Boolean(item));
  const targetId = buildRevenuePaymentPathApprovalTargetId(options.paymentLink);

  if (blockers.length) {
    return {
      status: "blocked" as const,
      decision: null,
      targetId,
      paymentSnapshot,
      blockers,
      nextCommand: "",
      nextAction: "Resolve blockers before recording this payment path decision.",
      safety: {
        persistsApprovalDecision: false,
        chargesClients: false,
        editsEnvironment: false,
        storesSecrets: false,
        recordsLedgerEntry: false,
        sendsOutreach: false,
      },
    };
  }

  const result = recordRevenueTrustedApprovalDecision({
    targetId,
    targetType: "payment_path",
    decision: options.decision,
    approvedAction: options.approvedAction,
    maxSpendUsd: 0,
    notes: options.evidenceNote,
    approvalSource: "payment_path_approval_cli",
    publicCandidateSnapshotHash: "",
    outreachDraftSnapshotHash: "",
    websiteCreationSnapshotHash: "",
    websitePublishSnapshotHash: "",
    paymentPathSnapshotHash: buildRevenuePaymentPathSnapshotHash(paymentSnapshot, proof),
    contactPathSnapshotHash: "",
    ledgerEntrySnapshotHash: "",
  });
  const nextCommand = options.decision === "approved"
    ? npmRunText("revenue:payment-path-readiness-packet", [
      `--payment-link=${options.paymentLink}`,
      `--approval-decision-id=${result.decision.id}`,
      "--robert-approved-payment-path",
      options.paymentSmokeVerified ? "--payment-smoke-verified" : "--deposit-confirmed-by-robert",
      `--expected-deposit-usd=${options.expectedDepositUsd}`,
      `--expected-package=${options.expectedPackage}`,
      `--evidence-url=${options.evidenceUrl}`,
      `--evidence-note=${options.evidenceNote}`,
    ])
    : "";

  return {
    status: result.decision.guardrail.status === "recorded" ? "recorded" as const : "blocked" as const,
    decision: result.decision,
    targetId,
    paymentSnapshot,
    blockers: result.decision.guardrail.status === "recorded" ? [] : [result.decision.guardrail.reason],
    nextCommand,
    nextAction: nextCommand
      ? "Run the payment path readiness packet; configure env/payment link outside tracked files only after this review."
      : "Decision recorded; do not use this payment path unless Robert changes the decision.",
    safety: {
      persistsApprovalDecision: result.decision.guardrail.status === "recorded",
      chargesClients: false,
      editsEnvironment: false,
      storesSecrets: false,
      recordsLedgerEntry: false,
      sendsOutreach: false,
    },
  };
}

export function formatRevenuePaymentPathApprovalDecisionText(result: ReturnType<typeof buildRevenuePaymentPathApprovalDecisionFromCli>) {
  return [
    `Revenue payment path approval decision: ${result.status}`,
    `Decision id: ${result.decision?.id || "none"}`,
    `Target: ${result.targetId}`,
    `Payment host: ${result.paymentSnapshot.paymentHost || "none"}`,
    `Expected deposit: $${result.paymentSnapshot.expectedDepositUsd}`,
    `Blockers: ${result.blockers.length ? result.blockers.join("; ") : "none"}`,
    `Next command: ${result.nextCommand || "none"}`,
    `Next action: ${result.nextAction}`,
    "",
    "Safety:",
    `- Persists approval decision: ${result.safety.persistsApprovalDecision ? "yes" : "no"}`,
    `- Charges clients: ${result.safety.chargesClients ? "yes" : "no"}`,
    `- Edits environment: ${result.safety.editsEnvironment ? "yes" : "no"}`,
    `- Stores secrets: ${result.safety.storesSecrets ? "yes" : "no"}`,
    `- Records ledger entry: ${result.safety.recordsLedgerEntry ? "yes" : "no"}`,
    `- Sends outreach: ${result.safety.sendsOutreach ? "yes" : "no"}`,
  ].join("\n");
}

export function getRevenuePaymentPathApprovalDecisionExitCode(result: ReturnType<typeof buildRevenuePaymentPathApprovalDecisionFromCli>) {
  return result.status === "recorded" ? 0 : 1;
}
