import {
  buildRevenueManualContactApprovalPacket,
  buildRevenueMoneyReadinessReport,
  getRevenueEngineSnapshot,
  listRevenuePublicLeadCandidates,
  type RevenueMoneyReadinessInput,
} from "./revenue-engine";

export type RevenueFirstMoneyCommandCenterCliOptions = {
  mode: RevenueMoneyReadinessInput["mode"];
  json: boolean;
};

type CommandQueueItem = {
  id: string;
  label: string;
  command: string;
  status: "ready" | "blocked" | "review";
  reason: string;
};

export function parseRevenueFirstMoneyCommandCenterArgs(argv: string[]): RevenueFirstMoneyCommandCenterCliOptions {
  const modeArg = argv.find((arg) => arg.startsWith("--mode="));
  const mode = (modeArg ? modeArg.slice("--mode=".length).trim() : "first-sprint") as RevenueMoneyReadinessInput["mode"];
  return {
    mode,
    json: argv.includes("--json"),
  };
}

export function validateRevenueFirstMoneyCommandCenterOptions(options: RevenueFirstMoneyCommandCenterCliOptions) {
  return ["first-sprint", "production-launch"].includes(options.mode)
    ? []
    : ["--mode must be first-sprint or production-launch."];
}

function hasValidEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

function isDemoCandidate(candidate: { businessName: string; sourceUrl: string; recipientEmail: string }) {
  const text = `${candidate.businessName} ${candidate.sourceUrl} ${candidate.recipientEmail}`.toLowerCase();
  return ["example.com", "smoke", "demo", "sample", "fixture", "placeholder", "replace with", "test"].some((marker) => text.includes(marker));
}

function isManualContactCandidate(candidate: {
  verificationStatus: string;
  publicEvidenceVerified: boolean;
  recipientEmail: string;
  contactChannel: string;
  contactValue: string;
  sourceUrl: string;
  evidence: string;
}) {
  return candidate.verificationStatus === "verified_public"
    && candidate.publicEvidenceVerified
    && candidate.recipientEmail.trim().length === 0
    && ["phone", "instagram", "contact_form"].includes(candidate.contactChannel)
    && candidate.contactValue.trim().length >= 3
    && candidate.sourceUrl.trim().length > 0
    && candidate.evidence.trim().length >= 12;
}

function shellQuote(value: string) {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

function npmRunText(script: string, args: string[] = []) {
  return ["npm", "run", script, "--", ...args].map(shellQuote).join(" ");
}

export function buildRevenueFirstMoneyCommandCenter(options: RevenueFirstMoneyCommandCenterCliOptions) {
  const readiness = buildRevenueMoneyReadinessReport({ mode: options.mode });
  const snapshot = getRevenueEngineSnapshot();
  const allPublicCandidates = listRevenuePublicLeadCandidates();
  const publicCandidates = allPublicCandidates.filter((candidate) => !isDemoCandidate(candidate));
  const excludedDemoPublicCandidates = allPublicCandidates.length - publicCandidates.length;
  const capturedCandidates = publicCandidates.filter((candidate) => candidate.verificationStatus !== "blocked");
  const manualContactPacket = buildRevenueManualContactApprovalPacket({ maxCandidates: 10 });
  const verificationNeededCandidates = capturedCandidates.filter((candidate) =>
    !isManualContactCandidate(candidate)
    && (
      candidate.verificationStatus !== "verified_public"
      || !candidate.publicEvidenceVerified
      || candidate.contactChannel === "unknown"
      || candidate.contactValue.trim().length === 0
      || candidate.recipientEmail.trim().length === 0
      || !hasValidEmail(candidate.recipientEmail)
    ),
  );
  const robertReviewReadyCandidates = capturedCandidates.filter((candidate) =>
    candidate.verificationStatus === "verified_public"
    && candidate.publicEvidenceVerified
    && candidate.recipientEmail.trim().length > 0
    && hasValidEmail(candidate.recipientEmail),
  );
  const importReadyCandidates = publicCandidates.filter((candidate) => candidate.importReady);
  const outreachDrafts = snapshot.recentOutreach.filter((draft) => draft.delivery.sendStatus !== "sent");
  const reviewableDrafts = outreachDrafts.filter((draft) => draft.status === "draft" || draft.status === "approved");
  const approvedDraft = outreachDrafts.find((draft) => draft.status === "approved");
  const verificationCandidateIds = verificationNeededCandidates.slice(0, 5).map((candidate) => candidate.id).join(",");
  const firstReviewCandidate = robertReviewReadyCandidates[0];
  const reviewBatchCandidates = firstReviewCandidate
    ? robertReviewReadyCandidates
      .filter((candidate) => candidate.area === firstReviewCandidate.area && candidate.niche === firstReviewCandidate.niche)
      .slice(0, 5)
    : [];
  const reviewCandidateIds = reviewBatchCandidates.map((candidate) => candidate.id).join(",");
  const candidateReviewItem: CommandQueueItem | null = robertReviewReadyCandidates.length > 0 && firstReviewCandidate
    ? {
      id: "candidate-review",
      label: "Ask Robert to approve verified public candidates",
      command: npmRunText("revenue:public-candidate-review", [
        `--candidate-ids=${reviewCandidateIds}`,
        `--area=${firstReviewCandidate.area}`,
        `--niche=${firstReviewCandidate.niche}`,
        "--offer-focus=websites",
        "--approved-by-robert",
      ]),
      status: "review",
      reason: `${robertReviewReadyCandidates.length} verified public candidate(s) are ready for Robert approval before Money Sprint.`,
    }
    : null;
  const manualContactReviewItem: CommandQueueItem | null = manualContactPacket.manualContactCount > 0
    ? {
      id: "manual-contact-review",
      label: "Review manual-only contact candidates",
      command: npmRunText("revenue:manual-contact-approval-packet", ["--max-candidates=10"]),
      status: "review",
      reason: `${manualContactPacket.manualContactCount} verified manual-only candidate(s) need Robert approval before any phone/social/contact-form contact.`,
    }
    : null;
  const candidateVerificationItem: CommandQueueItem | null = verificationNeededCandidates.length > 0
    ? {
      id: "candidate-verification",
      label: "Verify captured public candidates",
      command: npmRunText("revenue:public-contact-verification", [`--candidate-ids=${verificationCandidateIds}`]),
      status: "review",
      reason: `${verificationNeededCandidates.length} captured public candidate(s) need public contact/evidence verification before Robert approval.`,
    }
    : null;
  const publicScoutItem: CommandQueueItem = {
    id: "public-scout",
    label: "Find businesses",
    command: "npm run revenue:public-scout-schedule -- --area=Miami --niche=coffee_shop",
    status: readiness.canSearchBusinesses ? "ready" : "blocked",
    reason: readiness.canSearchBusinesses
      ? "No captured candidates are waiting; start guarded public scouting."
      : "Business search is not ready yet.",
  };
  const candidateQueueItems = [
    candidateReviewItem || manualContactReviewItem || candidateVerificationItem || publicScoutItem,
    ...(candidateReviewItem && manualContactReviewItem ? [manualContactReviewItem] : []),
    ...((candidateReviewItem || manualContactReviewItem) && candidateVerificationItem ? [candidateVerificationItem] : []),
  ];
  const queue: CommandQueueItem[] = [
    {
      id: "readiness",
      label: "Confirm first-money gates",
      command: `npm run revenue:money-readiness -- --mode=${options.mode}`,
      status: readiness.canStartToday ? "ready" : "blocked",
      reason: readiness.canStartToday
        ? "Confirms what can run today without unsafe spend/contact/deploy."
        : readiness.blockedUntil[0] || "Readiness gates are blocked.",
    },
    ...candidateQueueItems,
    snapshot.recentLeads.length > 0 || snapshot.recentOutreach.length > 0
      ? {
        id: "outreach-review",
        label: "Review outreach drafts",
        command: "npm run revenue:outreach-approval-packet -- --max-drafts=10",
        status: reviewableDrafts.length > 0 ? "review" : "blocked",
        reason: reviewableDrafts.length > 0
          ? `${reviewableDrafts.length} outreach draft(s) need approval/send review.`
          : "No draft is ready for outreach review.",
      }
      : {
        id: "money-sprint",
        label: "Run reviewed Money Sprint packet",
        command: "npm run revenue:money-sprint-run-packet -- --input=/path/to/review.json",
        status: "blocked",
        reason: "Requires a human-reviewed public candidate packet first.",
      },
    approvedDraft
      ? {
        id: "website-handoff",
        label: "Prepare paid website handoff",
        command: `npm run revenue:website-creation-packet -- --outreach-draft-id=${approvedDraft.id} --robert-approved-build --client-approved-scope --deposit-paid --public-data-verified`,
        status: readiness.canBuildWebsites ? "review" : "blocked",
        reason: readiness.canBuildWebsites
          ? "Approved draft exists and website publish gates are ready; still requires deposit/scope evidence."
          : "Website handoff can be prepared only after deposit/scope/public data and publish gates are proven.",
      }
      : {
        id: "website-handoff",
        label: "Prepare paid website handoff",
        command: "npm run revenue:website-creation-packet -- --outreach-draft-id=OUTREACH_ID --robert-approved-build --client-approved-scope --deposit-paid --public-data-verified",
        status: "blocked",
        reason: "No approved outreach draft exists yet.",
      },
  ];
  const funnelQueue = queue.filter((item) => item.id !== "readiness");
  const nextCommand =
    funnelQueue.find((item) => item.status === "review") ||
    funnelQueue.find((item) => item.status === "ready") ||
    queue[0];

  return {
    status: readiness.ready ? "ready_for_first_money_work" as const : readiness.status,
    mode: options.mode,
    nextCommand,
    queue,
    counts: {
      publicCandidates: publicCandidates.length,
      excludedDemoPublicCandidates,
      verificationNeededPublicCandidates: verificationNeededCandidates.length,
      reviewablePublicCandidates: robertReviewReadyCandidates.length,
      manualOnlyPublicCandidates: manualContactPacket.manualContactCount,
      importReadyCandidates: importReadyCandidates.length,
      leads: snapshot.recentLeads.length,
      outreachDrafts: outreachDrafts.length,
      reviewableOutreachDrafts: reviewableDrafts.length,
      approvedOutreachDrafts: outreachDrafts.filter((draft) => draft.status === "approved").length,
    },
    readiness: {
      ready: readiness.ready,
      canStartToday: readiness.canStartToday,
      canSearchBusinesses: readiness.canSearchBusinesses,
      canContactBusinesses: readiness.canContactBusinesses,
      canCollectMoney: readiness.canCollectMoney,
      canBuildWebsites: readiness.canBuildWebsites,
      blockedUntil: readiness.blockedUntil,
      remainingGaps: readiness.remainingGaps,
    },
    safety: {
      writesFiles: false,
      sendsOutreach: false,
      chargesClients: false,
      deploys: false,
      printsSecrets: false,
    },
  };
}

export function formatRevenueFirstMoneyCommandCenterText(packet: ReturnType<typeof buildRevenueFirstMoneyCommandCenter>) {
  return [
    `Revenue first-money command center: ${packet.status}`,
    `Mode: ${packet.mode}`,
    `Next command: ${packet.nextCommand.command}`,
    `Next reason: ${packet.nextCommand.reason}`,
    "",
    "Counts:",
    `- Public candidates: ${packet.counts.publicCandidates}`,
    `- Excluded demo/test public candidates: ${packet.counts.excludedDemoPublicCandidates}`,
    `- Public candidates needing verification: ${packet.counts.verificationNeededPublicCandidates}`,
    `- Reviewable public candidates: ${packet.counts.reviewablePublicCandidates}`,
    `- Manual-only public candidates: ${packet.counts.manualOnlyPublicCandidates}`,
    `- Import-ready candidates: ${packet.counts.importReadyCandidates}`,
    `- Leads: ${packet.counts.leads}`,
    `- Outreach drafts: ${packet.counts.outreachDrafts}`,
    `- Reviewable outreach drafts: ${packet.counts.reviewableOutreachDrafts}`,
    `- Approved outreach drafts: ${packet.counts.approvedOutreachDrafts}`,
    "",
    "Command queue:",
    ...packet.queue.map((item) => `- [${item.status}] ${item.label}: ${item.command} (${item.reason})`),
    "",
    "Safety:",
    `- Writes files: ${packet.safety.writesFiles ? "yes" : "no"}`,
    `- Sends outreach: ${packet.safety.sendsOutreach ? "yes" : "no"}`,
    `- Charges clients: ${packet.safety.chargesClients ? "yes" : "no"}`,
    `- Deploys: ${packet.safety.deploys ? "yes" : "no"}`,
    `- Prints secrets: ${packet.safety.printsSecrets ? "yes" : "no"}`,
  ].join("\n");
}

export function getRevenueFirstMoneyCommandCenterExitCode(packet: ReturnType<typeof buildRevenueFirstMoneyCommandCenter>) {
  return packet.nextCommand.status === "blocked" ? 1 : 0;
}
