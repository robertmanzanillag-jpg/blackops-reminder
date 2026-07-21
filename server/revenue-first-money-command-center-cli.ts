import fs from "node:fs";
import path from "node:path";
import {
  buildRevenueMoneyReadinessReport,
  getRevenueEngineSnapshot,
} from "./revenue-engine";

type RevenueFirstMoneyMode = "first-sprint" | "production-launch";

export type RevenueFirstMoneyCommandCenterCliOptions = {
  mode: RevenueFirstMoneyMode;
  json: boolean;
};

type CommandQueueItem = {
  id: string;
  label: string;
  command: string;
  status: "ready" | "blocked" | "review";
  reason: string;
};

type RevenueCommandCenterCandidate = {
  businessName?: string;
  sourceUrl?: string;
  contactValue?: string;
  recipientEmail?: string;
  verificationStatus?: string;
  publicEvidenceVerified?: boolean;
  publicEvidenceVerificationRef?: string;
};

function isSyntheticPublicCandidate(candidate: RevenueCommandCenterCandidate) {
  const searchable = [
    candidate.businessName,
    candidate.sourceUrl,
    candidate.contactValue,
    candidate.recipientEmail,
  ].join(" ").toLowerCase();
  return /\b(smoke|test fixture|replace with real)\b/.test(searchable)
    || searchable.includes("example.com")
    || searchable.includes(".example");
}

function hasDurablePublicEvidenceVerificationRef(candidate: RevenueCommandCenterCandidate) {
  const value = candidate.publicEvidenceVerificationRef?.trim() || "";
  if (value.length < 6) return false;
  if (/(^|[^a-z0-9])(ref|placeholder|replace|todo|tbd|example|sample|dummy)([^a-z0-9]|$)/i.test(value)) return false;
  const absoluteRevenueWorkspace = path.resolve(process.cwd(), "revenue_workspace");
  const resolved = value.startsWith("revenue_workspace/")
    ? path.resolve(process.cwd(), value)
    : path.isAbsolute(value)
      ? path.resolve(value)
      : "";
  if (!resolved || !resolved.startsWith(`${absoluteRevenueWorkspace}${path.sep}`)) return false;
  if (!resolved.includes(`${path.sep}public-verification${path.sep}`)
    && !resolved.includes(`${path.sep}approval-packets${path.sep}`)) return false;
  try {
    if (fs.lstatSync(resolved).isSymbolicLink()) return false;
    if (!fs.statSync(resolved).isFile()) return false;
    const content = fs.readFileSync(resolved, "utf8");
    return content.includes("Approval status: approved_by_robert")
      && Boolean(candidate.businessName && content.includes(candidate.businessName))
      && Boolean(candidate.sourceUrl && content.includes(candidate.sourceUrl))
      && Boolean(candidate.contactValue && content.includes(candidate.contactValue));
  } catch {
    return false;
  }
}

export function parseRevenueFirstMoneyCommandCenterArgs(argv: string[]): RevenueFirstMoneyCommandCenterCliOptions {
  const modeArg = argv.find((arg) => arg.startsWith("--mode="));
  const mode = (modeArg ? modeArg.slice("--mode=".length).trim() : "first-sprint") as RevenueFirstMoneyMode;
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

export function buildRevenueFirstMoneyCommandCenter(options: RevenueFirstMoneyCommandCenterCliOptions) {
  const readiness = buildRevenueMoneyReadinessReport({ mode: options.mode });
  const snapshot = getRevenueEngineSnapshot();
  const realPublicCandidates = snapshot.recentPublicLeadCandidates.filter((candidate) => !isSyntheticPublicCandidate(candidate));
  const syntheticPublicCandidates = snapshot.recentPublicLeadCandidates.filter(isSyntheticPublicCandidate);
  const capturedCandidates = realPublicCandidates.filter((candidate) => candidate.verificationStatus !== "blocked");
  const evidenceReviewCandidates = capturedCandidates.filter((candidate) =>
    candidate.verificationStatus !== "verified_public"
    || !candidate.publicEvidenceVerified
    || !hasDurablePublicEvidenceVerificationRef(candidate),
  );
  const verifiedPublicCandidates = capturedCandidates.filter((candidate) =>
    candidate.verificationStatus === "verified_public"
    && candidate.publicEvidenceVerified
    && hasDurablePublicEvidenceVerificationRef(candidate),
  );
  const importReadyCandidates = realPublicCandidates.filter((candidate) => candidate.importReady);
  const outreachDrafts = snapshot.recentOutreach.filter((draft) => draft.delivery.sendStatus !== "sent");
  const reviewableDrafts = outreachDrafts.filter((draft) => draft.status === "draft" || draft.status === "approved");
  const approvedDraft = outreachDrafts.find((draft) => draft.status === "approved");
  const firstEvidenceReviewIds = evidenceReviewCandidates.slice(0, 5).map((candidate) => candidate.id).join(",");
  const evidenceArtifactOutput = `revenue_workspace/public-verification/first-money-${new Date().toISOString().slice(0, 10)}.md`;
  const firstVerifiedCandidateIds = verifiedPublicCandidates.slice(0, 5).map((candidate) => candidate.id).join(",");
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
    evidenceReviewCandidates.length > 0
      ? {
        id: "candidate-verification-artifact",
        label: "Create public verification artifact",
        command: `npm run revenue:public-candidate-verification-artifact -- --candidate-ids=${firstEvidenceReviewIds} --output=${evidenceArtifactOutput}`,
        status: "review",
        reason: `${evidenceReviewCandidates.length} public candidate(s) need a review artifact before evidence verification; after Robert accepts it, run public-candidate-evidence-verification with --approved-by-robert.`,
      }
      : verifiedPublicCandidates.length > 0
      ? {
        id: "candidate-review",
        label: "Review captured public candidates",
        command: `npm run revenue:public-candidate-review -- --candidate-ids=${firstVerifiedCandidateIds}`,
        status: "review",
        reason: `${verifiedPublicCandidates.length} verified public candidate(s) are captured; add --approved-by-robert only after Robert explicitly approves import/review.`,
      }
      : {
        id: "public-scout",
        label: "Find businesses",
        command: [
          "npm run revenue:browser-scout-session --",
          "--area=Miami",
          "--niche=coffee_shop",
          "--offer-focus=websites",
          "--daily-research-target=10",
          "--daily-qualified-lead-limit=5",
          "--capture=revenue_workspace/public-scout/first-money-capture-template.json",
          "--notes=revenue_workspace/public-scout/first-money-public-notes.txt",
          "--extracted-output=revenue_workspace/public-scout/first-money-extracted-candidates.json",
          "--output=revenue_workspace/public-scout/first-money-browser-session.json",
        ].join(" "),
        status: readiness.canSearchBusinesses ? "ready" : "blocked",
        reason: readiness.canSearchBusinesses
          ? "No captured candidates are waiting; start a trusted browser scout handoff with public evidence capture."
          : "Business search is not ready yet.",
      },
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
        command: `npm run revenue:premium-website-work-order -- --outreach-draft-id=${approvedDraft.id} --target-repo=OWNER/REPO --target-project=premium-client-website`,
        status: "blocked",
        reason: readiness.canBuildWebsites
          ? "Approved draft exists, but paid website work order still needs real Robert approval, client scope, deposit and public verification evidence refs."
          : "Website handoff can be prepared only after deposit/scope/public data, PR/App QA/rollback and publish gates are proven with evidence.",
      }
      : {
        id: "website-handoff",
        label: "Prepare paid website handoff",
        command: "npm run revenue:premium-website-work-order -- --outreach-draft-id=OUTREACH_ID --target-repo=OWNER/REPO --target-project=premium-client-website",
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
      publicCandidates: snapshot.recentPublicLeadCandidates.length,
      syntheticPublicCandidates: syntheticPublicCandidates.length,
      reviewablePublicCandidates: capturedCandidates.length,
      needsEvidenceReviewPublicCandidates: evidenceReviewCandidates.length,
      verifiedPublicCandidates: verifiedPublicCandidates.length,
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
      writesFiles: true,
      writesLocalEvidenceFiles: true,
      writesPreviewFiles: false,
      persistsLeads: false,
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
    `- Synthetic/test public candidates ignored: ${packet.counts.syntheticPublicCandidates}`,
    `- Reviewable public candidates: ${packet.counts.reviewablePublicCandidates}`,
    `- Public candidates needing evidence review: ${packet.counts.needsEvidenceReviewPublicCandidates}`,
    `- Verified public candidates: ${packet.counts.verifiedPublicCandidates}`,
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
    `- Writes local evidence files: ${packet.safety.writesLocalEvidenceFiles ? "yes" : "no"}`,
    `- Writes preview files: ${packet.safety.writesPreviewFiles ? "yes" : "no"}`,
    `- Persists final leads: ${packet.safety.persistsLeads ? "yes" : "no"}`,
    `- Sends outreach: ${packet.safety.sendsOutreach ? "yes" : "no"}`,
    `- Charges clients: ${packet.safety.chargesClients ? "yes" : "no"}`,
    `- Deploys: ${packet.safety.deploys ? "yes" : "no"}`,
    `- Prints secrets: ${packet.safety.printsSecrets ? "yes" : "no"}`,
  ].join("\n");
}

export function getRevenueFirstMoneyCommandCenterExitCode(packet: ReturnType<typeof buildRevenueFirstMoneyCommandCenter>) {
  return packet.nextCommand.status === "blocked" ? 1 : 0;
}
