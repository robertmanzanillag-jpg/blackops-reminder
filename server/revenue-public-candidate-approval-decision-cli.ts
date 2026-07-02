import {
  listRevenuePublicLeadCandidates,
  recordRevenueTrustedApprovalDecision,
} from "./revenue-engine";
import {
  buildRevenuePublicCandidateApprovalTargetId,
  buildRevenuePublicCandidateSnapshotHash,
} from "./revenue-public-candidate-approval";

export type RevenuePublicCandidateApprovalDecisionCliOptions = {
  candidateIds: string[];
  decision: "approved" | "rejected" | "needs_changes";
  approvedAction: string;
  notes: string;
  area: string;
  niche: string;
  offerFocus: "websites" | "automations" | "both";
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

function hasValidEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

function hasPlaceholderValue(value: string) {
  const trimmed = value.trim();
  return /\b(REPLACE[\s_-]*WITH|PLACEHOLDER|TODO|TBD|YOUR[\s_-]+)/i.test(trimmed)
    || /^(CANDIDATE[\s_-]*IDS?|AREA|NICHE|OFFER[\s_-]*FOCUS)$/i.test(trimmed);
}

export function parseRevenuePublicCandidateApprovalDecisionArgs(argv: string[]): RevenuePublicCandidateApprovalDecisionCliOptions {
  const candidateIds = getArgValue(argv, "--candidate-ids")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  return {
    candidateIds,
    decision: (getArgValue(argv, "--decision") || "needs_changes") as RevenuePublicCandidateApprovalDecisionCliOptions["decision"],
    approvedAction: getArgValue(argv, "--approved-action") || "Review verified public candidates for first-money website sprint.",
    notes: getArgValue(argv, "--notes"),
    area: getArgValue(argv, "--area") || "Miami, FL",
    niche: getArgValue(argv, "--niche") || "hair salon",
    offerFocus: (getArgValue(argv, "--offer-focus") || "websites") as RevenuePublicCandidateApprovalDecisionCliOptions["offerFocus"],
    confirmedByRobert: argv.includes("--confirmed-by-robert"),
    json: argv.includes("--json"),
  };
}

export function validateRevenuePublicCandidateApprovalDecisionOptions(options: RevenuePublicCandidateApprovalDecisionCliOptions) {
  const errors: string[] = [];
  if (options.candidateIds.length === 0) errors.push("--candidate-ids is required.");
  else if (options.candidateIds.some(hasPlaceholderValue)) errors.push("--candidate-ids must contain real candidate ids, not placeholders.");
  if (!["approved", "rejected", "needs_changes"].includes(options.decision)) {
    errors.push("--decision must be approved, rejected, or needs_changes.");
  }
  if (!["websites", "automations", "both"].includes(options.offerFocus)) {
    errors.push("--offer-focus must be websites, automations or both.");
  }
  if (options.approvedAction.trim().length < 8) {
    errors.push("--approved-action must describe the approved/rejected action.");
  } else if (hasPlaceholderValue(options.approvedAction)) {
    errors.push("--approved-action must be real approval context, not a placeholder.");
  }
  if (options.notes.trim().length > 0 && hasPlaceholderValue(options.notes)) {
    errors.push("--notes must be real approval context, not a placeholder.");
  }
  if (options.decision === "approved") {
    if (options.area.trim().length < 2) errors.push("--area is required for approved public candidate decisions.");
    else if (hasPlaceholderValue(options.area)) errors.push("--area must be the real candidate area, not a placeholder.");
    if (options.niche.trim().length < 2) errors.push("--niche is required for approved public candidate decisions.");
    else if (hasPlaceholderValue(options.niche)) errors.push("--niche must be the real candidate niche, not a placeholder.");
  }
  return errors;
}

export function buildRevenuePublicCandidateApprovalDecisionFromCli(options: RevenuePublicCandidateApprovalDecisionCliOptions) {
  const validationErrors = validateRevenuePublicCandidateApprovalDecisionOptions(options);
  const allCandidates = listRevenuePublicLeadCandidates();
  const candidates = options.candidateIds
    .map((id) => allCandidates.find((candidate) => candidate.id === id))
    .filter((candidate): candidate is NonNullable<typeof candidate> => Boolean(candidate));
  const missingIds = options.candidateIds.filter((id) => !candidates.some((candidate) => candidate.id === id));
  const normalizedArea = options.area.trim().toLowerCase();
  const normalizedNiche = options.niche.trim().toLowerCase();
  const approvalBlockers = candidates.flatMap((candidate) => [
    candidate.verificationStatus !== "verified_public" && `${candidate.id}: verificationStatus must be verified_public`,
    !candidate.publicEvidenceVerified && `${candidate.id}: public evidence not verified`,
    candidate.sourceUrl.trim().length === 0 && `${candidate.id}: sourceUrl required`,
    candidate.recipientEmail.trim().length === 0 && `${candidate.id}: recipientEmail required`,
    candidate.recipientEmail.trim().length > 0 && !hasValidEmail(candidate.recipientEmail) && `${candidate.id}: recipientEmail must be valid`,
    candidate.area.trim().toLowerCase() !== normalizedArea && `${candidate.id}: --area must match candidate area (${candidate.area})`,
    candidate.niche.trim().toLowerCase() !== normalizedNiche && `${candidate.id}: --niche must match candidate niche (${candidate.niche})`,
  ].filter((item): item is string => Boolean(item)));
  const blockers = [
    ...validationErrors,
    !options.confirmedByRobert && "--confirmed-by-robert is required to record a public candidate decision.",
    ...missingIds.map((id) => `${id}: candidate not found`),
    ...(options.decision === "approved" ? approvalBlockers : []),
  ].filter((item): item is string => Boolean(item));

  if (blockers.length) {
    return {
      status: "blocked" as const,
      decision: null,
      targetId: buildRevenuePublicCandidateApprovalTargetId(options.candidateIds),
      requestedCount: options.candidateIds.length,
      foundCount: candidates.length,
      missingIds,
      blockers,
      nextCommand: "",
      nextAction: "Resolve blockers before recording this public candidate decision.",
      safety: {
        persistsApprovalDecision: false,
        persistsLeads: false,
        sendsOutreach: false,
        writesPreviewFiles: false,
        chargesClients: false,
        deploys: false,
        paidDataSpendUsd: 0,
      },
    };
  }

  const targetId = buildRevenuePublicCandidateApprovalTargetId(options.candidateIds);
  const result = recordRevenueTrustedApprovalDecision({
    targetId,
    targetType: "public_candidate",
    decision: options.decision,
    approvedAction: options.approvedAction,
    maxSpendUsd: 0,
    notes: options.notes,
    approvalSource: "public_candidate_approval_cli",
    publicCandidateSnapshotHash: buildRevenuePublicCandidateSnapshotHash(candidates),
    outreachDraftSnapshotHash: "",
    websiteCreationSnapshotHash: "",
    websitePublishSnapshotHash: "",
    paymentPathSnapshotHash: "",
    contactPathSnapshotHash: "",
    ledgerEntrySnapshotHash: "",
  });
  const nextCommand = options.decision === "approved"
    ? npmRunText("revenue:public-candidate-review", [
      `--candidate-ids=${options.candidateIds.join(",")}`,
      `--approval-decision-id=${result.decision.id}`,
      `--area=${options.area}`,
      `--niche=${options.niche}`,
      `--offer-focus=${options.offerFocus}`,
    ])
    : "";

  return {
    status: result.decision.guardrail.status === "recorded" ? "recorded" as const : "blocked" as const,
    decision: result.decision,
    targetId,
    requestedCount: options.candidateIds.length,
    foundCount: candidates.length,
    missingIds,
    blockers: result.decision.guardrail.status === "recorded" ? [] : [result.decision.guardrail.reason],
    nextCommand,
    nextAction: options.decision === "approved"
      ? "Run the public candidate review command only after confirming this recorded decision is still intended."
      : "Decision recorded; do not import this candidate batch unless Robert changes the decision.",
    safety: {
      persistsApprovalDecision: result.decision.guardrail.status === "recorded",
      persistsLeads: false,
      sendsOutreach: false,
      writesPreviewFiles: false,
      chargesClients: false,
      deploys: false,
      paidDataSpendUsd: 0,
    },
  };
}

export function formatRevenuePublicCandidateApprovalDecisionText(result: ReturnType<typeof buildRevenuePublicCandidateApprovalDecisionFromCli>) {
  return [
    `Revenue public candidate approval decision: ${result.status}`,
    `Decision id: ${result.decision?.id || "none"}`,
    `Target: ${result.targetId}`,
    `Requested: ${result.requestedCount}`,
    `Found: ${result.foundCount}`,
    `Missing ids: ${result.missingIds.length ? result.missingIds.join(", ") : "none"}`,
    `Blockers: ${result.blockers.length ? result.blockers.join("; ") : "none"}`,
    `Next command: ${result.nextCommand || "none"}`,
    `Next action: ${result.nextAction}`,
    "",
    "Safety:",
    `- Persists approval decision: ${result.safety.persistsApprovalDecision ? "yes" : "no"}`,
    `- Persists final leads: ${result.safety.persistsLeads ? "yes" : "no"}`,
    `- Writes preview files: ${result.safety.writesPreviewFiles ? "yes" : "no"}`,
    `- Sends outreach: ${result.safety.sendsOutreach ? "yes" : "no"}`,
    `- Charges clients: ${result.safety.chargesClients ? "yes" : "no"}`,
    `- Deploys: ${result.safety.deploys ? "yes" : "no"}`,
    `- Paid data spend: $${result.safety.paidDataSpendUsd}`,
  ].join("\n");
}

export function getRevenuePublicCandidateApprovalDecisionExitCode(result: ReturnType<typeof buildRevenuePublicCandidateApprovalDecisionFromCli>) {
  return result.status === "recorded" ? 0 : 1;
}
