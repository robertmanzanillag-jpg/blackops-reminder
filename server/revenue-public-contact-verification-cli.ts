export type RevenuePublicContactVerificationCliOptions = {
  candidateIds: string[];
  maxCandidates: number;
  includeDemo: boolean;
  json: boolean;
};

type PublicCandidateForVerification = {
  id: string;
  businessName: string;
  area: string;
  niche: string;
  websiteStatus: "no_website" | "weak_website" | "has_website" | "unknown";
  contactChannel: "email" | "phone" | "instagram" | "contact_form" | "unknown";
  contactValue: string;
  sourceUrl: string;
  recipientEmail: string;
  evidence: string;
  painPoint: string;
  verificationStatus: "needs_review" | "verified_public" | "blocked";
  publicEvidenceVerified: boolean;
  approvalToImport: boolean;
  importReady?: boolean;
  blockedReasons?: string[];
};

export function parseRevenuePublicContactVerificationArgs(argv: string[]): RevenuePublicContactVerificationCliOptions {
  const getValue = (name: string) => {
    const prefix = `${name}=`;
    const arg = argv.find((value) => value.startsWith(prefix));
    return arg ? arg.slice(prefix.length).trim() : "";
  };
  const maxCandidates = Number(getValue("--max-candidates") || 10);

  return {
    candidateIds: getValue("--candidate-ids")
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean),
    maxCandidates: Number.isFinite(maxCandidates) ? maxCandidates : 10,
    includeDemo: argv.includes("--include-demo"),
    json: argv.includes("--json"),
  };
}

export function validateRevenuePublicContactVerificationOptions(options: RevenuePublicContactVerificationCliOptions): string[] {
  const errors: string[] = [];
  if (options.maxCandidates < 1 || options.maxCandidates > 50) {
    errors.push("--max-candidates must be between 1 and 50.");
  }
  return errors;
}

function dedupeCandidates(candidates: PublicCandidateForVerification[]) {
  const seen = new Set<string>();
  return candidates.filter((candidate) => {
    const key = candidate.id || `${candidate.businessName}|${candidate.area}`.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function isDemoCandidate(candidate: PublicCandidateForVerification) {
  const text = `${candidate.businessName} ${candidate.sourceUrl} ${candidate.recipientEmail}`.toLowerCase();
  return ["example.com", "smoke", "demo", "sample", "fixture", "placeholder", "replace with"].some((marker) => text.includes(marker));
}

function verificationSearchQueries(candidate: PublicCandidateForVerification) {
  const base = `"${candidate.businessName}" "${candidate.area}"`;
  return [
    `${base} official`,
    `${base} phone email`,
    `${base} Instagram`,
    `${base} booking`,
  ];
}

function shellQuote(value: string) {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

function reviewCommandArgs(candidate: PublicCandidateForVerification) {
  return [
    "run",
    "revenue:public-candidate-review",
    "--",
    `--candidate-ids=${candidate.id}`,
    `--area=${candidate.area}`,
    `--niche=${candidate.niche}`,
    "--offer-focus=websites",
  ];
}

function formatCommand(command: string, args: string[]) {
  return [command, ...args.map(shellQuote)].join(" ");
}

function missingVerificationItems(candidate: PublicCandidateForVerification) {
  return [
    candidate.verificationStatus !== "verified_public" && "Mark verificationStatus=verified_public only after checking public sources.",
    !candidate.publicEvidenceVerified && "Confirm source evidence still shows the business and website status.",
    candidate.sourceUrl.trim().length === 0 && "Add a public sourceUrl.",
    candidate.contactChannel === "unknown" && "Find a public contact channel, or keep blocked.",
    candidate.contactValue.trim().length === 0 && "Add the public contact value, or keep blocked.",
    candidate.recipientEmail.trim().length === 0 && "Add recipientEmail only when a public email is visible; otherwise keep manual-only.",
    !candidate.approvalToImport && "Robert approval is still required before import.",
  ].filter((item): item is string => Boolean(item));
}

export function buildRevenuePublicContactVerificationPacket(
  candidates: PublicCandidateForVerification[],
  options: RevenuePublicContactVerificationCliOptions,
) {
  const selectedIds = new Set(options.candidateIds);
  const deduped = dedupeCandidates(candidates);
  const realCandidates = options.includeDemo ? deduped : deduped.filter((candidate) => !isDemoCandidate(candidate));
  const matched = realCandidates.filter((candidate) => selectedIds.size === 0 || selectedIds.has(candidate.id));
  const selected = matched.slice(0, options.maxCandidates);
  const missingIds = options.candidateIds.filter((id) => !matched.some((candidate) => candidate.id === id));
  const excludedDemoCount = deduped.length - realCandidates.length;
  const tasks = selected.map((candidate) => {
    const missing = missingVerificationItems(candidate);
    return {
      candidateId: candidate.id,
      businessName: candidate.businessName,
      area: candidate.area,
      niche: candidate.niche,
      sourceUrl: candidate.sourceUrl,
      currentStatus: {
        websiteStatus: candidate.websiteStatus,
        contactChannel: candidate.contactChannel,
        hasContactValue: candidate.contactValue.trim().length > 0,
        hasRecipientEmail: candidate.recipientEmail.trim().length > 0,
        verificationStatus: candidate.verificationStatus,
        publicEvidenceVerified: candidate.publicEvidenceVerified,
        approvalToImport: candidate.approvalToImport,
        importReady: candidate.importReady === true,
      },
      searchQueries: verificationSearchQueries(candidate),
      missing,
      safeUpdateRules: [
        "Use only public business-owned or public directory evidence.",
        "Do not contact the business during verification.",
        "Do not buy enrichment data.",
        "Do not set approvalToImport=true; Robert must approve import separately.",
        "Do not invent email, owner names, reviews, prices or claims.",
      ],
      nextReviewCommand: {
        command: "npm",
        args: reviewCommandArgs(candidate),
      },
      nextReviewCommandText: formatCommand("npm", reviewCommandArgs(candidate)),
      readyForRobertReview: missing.every((item) => item === "Robert approval is still required before import."),
    };
  });

  return {
    status: tasks.length > 0 ? "ready_for_contact_verification" as const : "empty" as const,
    requestedCount: options.candidateIds.length,
    taskCount: tasks.length,
    missingIds,
    excludedDemoCount,
    tasks,
    safety: {
      readsPublicDataOnly: true,
      persistsChanges: false,
      importsLeads: false,
      writesPreviewFiles: false,
      sendsOutreach: false,
      paidDataSpendUsd: 0,
      requiresRobertApprovalBeforeImport: true,
    },
    nextAction: tasks.length > 0
      ? "Verify public contact/evidence fields, then ask Robert before importing any candidate."
      : "Capture public candidates first with revenue:public-scout-run.",
  };
}

export function formatRevenuePublicContactVerificationText(packet: ReturnType<typeof buildRevenuePublicContactVerificationPacket>) {
  return [
    `Revenue public contact verification: ${packet.status}`,
    `Requested: ${packet.requestedCount}`,
    `Tasks: ${packet.taskCount}`,
    `Missing ids: ${packet.missingIds.length ? packet.missingIds.join(", ") : "none"}`,
    `Excluded demo/test candidates: ${packet.excludedDemoCount}`,
    `Next action: ${packet.nextAction}`,
    "",
    "Safety:",
    `- Reads public data only: ${packet.safety.readsPublicDataOnly ? "yes" : "no"}`,
    `- Persists changes: ${packet.safety.persistsChanges ? "yes" : "no"}`,
    `- Imports leads: ${packet.safety.importsLeads ? "yes" : "no"}`,
    `- Writes preview files: ${packet.safety.writesPreviewFiles ? "yes" : "no"}`,
    `- Sends outreach: ${packet.safety.sendsOutreach ? "yes" : "no"}`,
    `- Paid data spend: $${packet.safety.paidDataSpendUsd}`,
    "",
    "Tasks:",
    ...packet.tasks.flatMap((task, index) => [
      `${index + 1}. ${task.businessName} (${task.area})`,
      `   Candidate: ${task.candidateId}`,
      `   Source: ${task.sourceUrl || "missing"}`,
      `   Missing: ${task.missing.length ? task.missing.join("; ") : "Robert approval only"}`,
      `   Queries: ${task.searchQueries.join(" | ")}`,
      `   Review command: ${task.nextReviewCommandText}`,
    ]),
  ].join("\n");
}
