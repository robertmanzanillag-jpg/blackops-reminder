import {
  buildRevenueManualContactApprovalPacket,
  buildRevenueMoneyReadinessReport,
  getRevenueEngineSnapshot,
  listRevenueApprovalDecisions,
  listRevenuePublicLeadCandidates,
  type RevenueMoneyReadinessInput,
} from "./revenue-engine";
import {
  buildRevenuePublicCandidateApprovalTargetId,
  buildRevenuePublicCandidateSnapshotHash,
} from "./revenue-public-candidate-approval";

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

type SetupCommandItem = CommandQueueItem & {
  gate: "contact_path" | "payment_path" | "ledger_entry" | "website_creation";
};

type MoneyUnblockerItem = {
  id: "production_persistence" | "contact_path" | "payment_path" | "website_build";
  label: string;
  status: "ready" | "blocked";
  gate: "production" | "contact_path" | "payment_path" | "website_creation";
  reason: string;
  evidenceRequired: string[];
  safeNextAction: string;
  blockedActions: string[];
  setupCommandIds: string[];
};

type MoneyUnblockerReadiness = {
  canContactBusinesses: boolean;
  canCollectMoney: boolean;
  canBuildWebsites: boolean;
  blockedUntil: string[];
};

type FirstMoneyHandoffPacket = {
  status: "ready_for_robert_review" | "blocked_before_live_money";
  summary: string;
  prReviewStandard: string[];
  testsToRun: string[];
  qaGate: string;
  risks: string[];
  rollbackNotes: string[];
  deployStatus: "not_requested" | "blocked_without_robert_approval";
  safeToSendToRobert: boolean;
};

type FirstMoneyActivationStep = {
  id: "candidate_verification" | "candidate_approval" | "candidate_review" | "contact_path" | "payment_path" | "first_outreach" | "paid_build" | "publish";
  label: string;
  status: "ready_now" | "needs_robert_approval" | "blocked_until_evidence" | "blocked_until_prior_step";
  owner: "agent" | "robert" | "external";
  action: string;
  proofRequired: string[];
  commandHint: string;
  unlocks: string[];
  safety: string;
};

type CandidateApprovalBatch = {
  id: string;
  area: string;
  niche: string;
  candidateIds: string[];
  candidateNames: string[];
  candidates: Array<{
    id: string;
    businessName: string;
    websiteStatus: string;
    contactChannel: string;
    contactValue: string;
    recipientEmail: string;
    sourceUrl: string;
    evidence: string;
    painPoint: string;
    estimatedOfferUsd: number;
  }>;
  count: number;
  totalEstimatedOfferUsd: number;
  approvalSafety: {
    persistsApprovalDecision: true;
    importsLeads: false;
    sendsOutreach: false;
    writesPreviewFiles: false;
    chargesClients: false;
    deploys: false;
    paidDataSpendUsd: 0;
  };
  approvalStatus: "needs_robert_approval" | "ready_for_candidate_review";
  approvalDecisionId: string;
  outputPath: string;
  approvalCommand: string;
  reviewCommand: string;
  moneySprintRunPacketCommand: string;
  command: string;
  reason: string;
};

type CandidateVerificationQueueItem = {
  id: string;
  candidateId: string;
  businessName: string;
  area: string;
  niche: string;
  websiteStatus: string;
  verificationStatus: string;
  missing: string[];
  readyForRobertReview: boolean;
  command: string;
  safety: {
    readsPublicDataOnly: true;
    persistsChanges: false;
    importsLeads: false;
    sendsOutreach: false;
    chargesClients: false;
    deploys: false;
    paidDataSpendUsd: 0;
  };
};

function redactCandidateApprovalBatchForSummary(batch: CandidateApprovalBatch | undefined) {
  if (!batch || batch.approvalStatus !== "needs_robert_approval") return null;
  const confirmationText = `APPROVE PUBLIC CANDIDATES ${batch.id}`;
  return {
    id: batch.id,
    candidateIds: batch.candidateIds,
    candidateNames: batch.candidateNames.map(approvalCardText),
    candidateCards: batch.candidates.map((candidate) => ({
      id: candidate.id,
      businessName: approvalCardText(candidate.businessName),
      websiteStatus: approvalCardText(candidate.websiteStatus),
      estimatedOfferUsd: candidate.estimatedOfferUsd,
      opportunitySummary: approvalCardText(candidate.painPoint || "Website opportunity needs Robert review."),
      evidenceStatus: "verified_public" as const,
      contactHiddenUntilApproval: true,
    })),
    area: approvalCardText(batch.area),
    niche: approvalCardText(batch.niche),
    offerFocus: "websites" as const,
    count: batch.count,
    totalEstimatedOfferUsd: batch.totalEstimatedOfferUsd,
    approvalStatus: batch.approvalStatus,
    approvedAction: "Approve first-money public candidate review.",
    confirmationText,
    safety: batch.approvalSafety,
  };
}

function redactCandidateReviewBatchForSummary(batch: CandidateApprovalBatch | undefined) {
  if (!batch || batch.approvalStatus !== "ready_for_candidate_review" || !batch.approvalDecisionId) return null;
  const confirmationText = `REVIEW PUBLIC CANDIDATES ${batch.id} ${batch.approvalDecisionId}`;
  return {
    id: batch.id,
    candidateIds: batch.candidateIds,
    candidateNames: batch.candidateNames.map(approvalCardText),
    area: approvalCardText(batch.area),
    niche: approvalCardText(batch.niche),
    offerFocus: "websites" as const,
    count: batch.count,
    totalEstimatedOfferUsd: batch.totalEstimatedOfferUsd,
    approvalStatus: batch.approvalStatus,
    approvalDecisionId: batch.approvalDecisionId,
    confirmationText,
    safety: {
      persistsLeads: false,
      persistsPublicCandidates: false,
      sendsOutreach: false,
      writesPreviewFiles: false,
      chargesClients: false,
      deploys: false,
      paidDataSpendUsd: 0,
    },
  };
}

function redactCandidateRunBatchForSummary(batch: CandidateApprovalBatch | undefined) {
  if (!batch || batch.approvalStatus !== "ready_for_candidate_review" || !batch.approvalDecisionId) return null;
  return {
    id: batch.id,
    candidateIds: batch.candidateIds,
    candidateNames: batch.candidateNames.map(approvalCardText),
    area: approvalCardText(batch.area),
    niche: approvalCardText(batch.niche),
    offerFocus: "websites" as const,
    count: batch.count,
    totalEstimatedOfferUsd: batch.totalEstimatedOfferUsd,
    approvalStatus: batch.approvalStatus,
    approvalDecisionId: batch.approvalDecisionId,
    confirmationText: `RUN MONEY SPRINT ${batch.id} ${batch.approvalDecisionId}`,
    safety: {
      persistsLeads: true,
      persistsPublicCandidates: false,
      sendsOutreach: false,
      writesPreviewFiles: false,
      chargesClients: false,
      deploys: false,
      paidDataSpendUsd: 0,
    },
  };
}

function buildRobertApprovalBrief(
  candidateApprovalQueue: NonNullable<ReturnType<typeof redactCandidateApprovalBatchForSummary>>[],
  candidateReviewQueue: NonNullable<ReturnType<typeof redactCandidateReviewBatchForSummary>>[],
) {
  const totalCandidates = candidateApprovalQueue.reduce((total, batch) => total + batch.count, 0);
  const totalEstimatedOfferUsd = candidateApprovalQueue.reduce((total, batch) => total + batch.totalEstimatedOfferUsd, 0);
  const nextApproval = candidateApprovalQueue[0] || null;
  const nextReview = candidateReviewQueue[0] || null;
  const status = nextApproval
    ? "needs_robert_candidate_approval" as const
    : nextReview
      ? "ready_for_review_packet" as const
      : "no_candidate_approval_waiting" as const;
  return {
    status,
    headline: nextApproval
      ? `${totalCandidates} verified public candidate(s) are waiting for Robert approval before internal Money Sprint work.`
      : nextReview
        ? "Robert approval exists; the next safe step is generating the guarded review packet."
        : "No candidate approval is waiting right now; keep guarded public scouting active.",
    totalBatches: candidateApprovalQueue.length,
    totalCandidates,
    totalEstimatedOfferUsd,
    nextApprovalText: nextApproval?.confirmationText || "",
    nextReviewText: nextReview?.confirmationText || "",
    batches: candidateApprovalQueue.map((batch) => ({
      id: batch.id,
      area: batch.area,
      niche: batch.niche,
      count: batch.count,
      totalEstimatedOfferUsd: batch.totalEstimatedOfferUsd,
      candidateNames: batch.candidateNames,
      confirmationText: batch.confirmationText,
      cards: batch.candidateCards,
    })),
    afterRobertApproves: [
      "Record the candidate approval decision only; do not import leads or contact businesses from the approval action.",
      "Generate the guarded candidate review packet with the matching approvalDecisionId.",
      "Run the internal Money Sprint packet to create internal leads and draft-only outreach; sends stay blocked.",
    ],
    blockedActions: [
      "No outreach send.",
      "No payment request.",
      "No website file write.",
      "No preview publish or deploy.",
    ],
    safety: {
      exposesContactDetails: false,
      persistsApprovalDecisionOnly: true,
      importsLeads: false,
      sendsOutreach: false,
      chargesClients: false,
      deploys: false,
      paidDataSpendUsd: 0,
    },
  };
}

function redactedVerificationMissing(candidate: {
  verificationStatus: string;
  publicEvidenceVerified: boolean;
  contactChannel: string;
  contactValue: string;
  recipientEmail: string;
}) {
  return [
    candidate.verificationStatus !== "verified_public" && "Verify public evidence from business-owned or public directory sources.",
    !candidate.publicEvidenceVerified && "Confirm the public source still supports the website-status signal.",
    candidate.contactChannel === "unknown" && "Find a public contact channel or keep the candidate blocked.",
    candidate.contactValue.trim().length === 0 && "Add the public contact value or keep the candidate blocked.",
    candidate.recipientEmail.trim().length === 0 && "Add a public recipient email only when one is visible; otherwise use manual-only review.",
    candidate.recipientEmail.trim().length > 0 && !hasValidEmail(candidate.recipientEmail) && "Fix invalid public recipient email or move the candidate to manual-only review.",
  ].filter((item): item is string => Boolean(item));
}

function redactCandidateVerificationQueueForSummary(candidates: CandidateApprovalInput[]): CandidateVerificationQueueItem[] {
  return candidates.slice(0, 5).map((candidate, index) => {
    const missing = redactedVerificationMissing(candidate);
    return {
      id: `candidate-verification-${index + 1}`,
      candidateId: candidate.id,
      businessName: approvalCardText(candidate.businessName),
      area: approvalCardText(candidate.area),
      niche: approvalCardText(candidate.niche),
      websiteStatus: approvalCardText(candidate.websiteStatus),
      verificationStatus: approvalCardText(candidate.verificationStatus),
      missing,
      readyForRobertReview: missing.length === 0,
      command: "Use the guarded public-contact verification action; do not contact the business or import the lead.",
      safety: {
        readsPublicDataOnly: true,
        persistsChanges: false,
        importsLeads: false,
        sendsOutreach: false,
        chargesClients: false,
        deploys: false,
        paidDataSpendUsd: 0,
      },
    };
  });
}

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

function trustCenterActionText(endpoint: string, requiredEvidence: string[]) {
  return `Queue Trust Center action via ${endpoint} with real evidence: ${requiredEvidence.join("; ")}`;
}

function displayText(value: string | number) {
  return String(value).replace(/[\u0000-\u001f\u007f-\u009f]/g, " ").replace(/\s+/g, " ").trim();
}

function approvalCardText(value: string) {
  return displayText(value)
    .replace(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, "[contact]")
    .replace(/\bhttps?:\/\/\S+/gi, "[source]")
    .replace(/\b(?:www\.)?[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+(?:[/?#][^\s]*)?/gi, "[source]")
    .replace(/\+?\d[\d\s().-]{7,}\d/g, "[phone]")
    .slice(0, 180);
}

function buildSetupCommands(readiness: ReturnType<typeof buildRevenueMoneyReadinessReport>): SetupCommandItem[] {
  const setupCommands: SetupCommandItem[] = [];
  if (!readiness.canContactBusinesses) {
    setupCommands.push(
      {
        id: "contact-path-approval",
        gate: "contact_path",
        label: "Approve contact path before outreach",
        command: trustCenterActionText("/api/revenue-engine/contact-path-approval-pending-action", [
          "contactMode=manual or email_provider",
          "real evidenceUrl",
          "real evidenceNote",
          "Robert-approved contact path flags",
        ]),
        status: "blocked",
        reason: "Requires Robert-reviewed contact evidence outside tracked files; Trust Center records approval only and never sends outreach.",
      },
      {
        id: "contact-path-readiness",
        gate: "contact_path",
        label: "Verify contact path readiness",
        command: npmRunText("revenue:contact-path-readiness-packet", [
          "--contact-mode=manual",
          "--approval-decision-id=CONTACT_PATH_APPROVAL_ID",
          "--robert-approved-contact-path",
          "--contact-path-verified",
          "--evidence-url=REPLACE_WITH_CONTACT_PATH_EVIDENCE_URL",
          "--evidence-note=REPLACE_WITH_CONTACT_PATH_PROOF",
        ]),
        status: "blocked",
        reason: "Runs after the contact path approval decision and confirms outreach remains disabled until explicit send approval.",
      },
    );
  }
  if (!readiness.canCollectMoney) {
    setupCommands.push(
      {
        id: "payment-path-approval",
        gate: "payment_path",
        label: "Approve payment path before charging",
        command: trustCenterActionText("/api/revenue-engine/payment-path-approval-pending-action", [
          "real HTTPS Stripe paymentLink",
          "expectedDepositUsd",
          "expectedPackage",
          "real evidenceUrl",
          "real evidenceNote",
          "Robert-approved payment path flags",
        ]),
        status: "blocked",
        reason: "Requires a real HTTPS Stripe link and Robert-reviewed payment evidence; Trust Center records approval only and never charges clients.",
      },
      {
        id: "payment-path-readiness",
        gate: "payment_path",
        label: "Verify payment path readiness",
        command: npmRunText("revenue:payment-path-readiness-packet", [
          "--payment-link=REPLACE_WITH_STRIPE_PAYMENT_LINK",
          "--approval-decision-id=PAYMENT_PATH_APPROVAL_ID",
          "--robert-approved-payment-path",
          "--payment-smoke-verified",
          "--expected-deposit-usd=1500",
          "--expected-package=First Money Website Deposit",
          "--evidence-url=REPLACE_WITH_PAYMENT_EVIDENCE_URL",
          "--evidence-note=REPLACE_WITH_PAYMENT_PROOF",
        ]),
        status: "blocked",
        reason: "Runs after the payment path approval decision and confirms the system still does not charge clients by itself.",
      },
    );
  }
  if (!readiness.canBuildWebsites) {
    setupCommands.push({
      id: "ledger-entry-approval",
      gate: "ledger_entry",
      label: "Approve ledger entry after deposit is collected",
      command: trustCenterActionText("/api/revenue-engine/ledger-entry-approval-pending-action", [
        "real clientName",
        "amountUsd",
        "cashCollectedUsd",
        "estimatedInternalCostUsd",
        "real paymentEvidence",
        "real ledger notes",
      ]),
      status: "blocked",
      reason: "Runs only after money is actually collected and Robert has verified payment evidence; Trust Center records approval only and never records the ledger entry or charges clients.",
    });
  }
  if (!readiness.canBuildWebsites) {
    setupCommands.push({
      id: "website-creation-approval",
      gate: "website_creation",
      label: "Approve paid website creation after deposit",
      command: trustCenterActionText("/api/revenue-engine/website-creation-approval-pending-action", [
        "real outreachDraftId",
        "real scope/deposit/public-data notes",
        "Robert-approved build flag",
        "client-approved scope flag",
        "deposit-paid flag",
        "public-data verified flag",
      ]),
      status: "blocked",
      reason: "Runs only after an approved outreach draft, client-approved scope, deposit proof, and public data verification; Trust Center records approval only and never writes files or deploys.",
    });
  }
  return setupCommands;
}

function buildMoneyUnblockers(
  readiness: MoneyUnblockerReadiness,
  setupCommands: SetupCommandItem[],
): MoneyUnblockerItem[] {
  const setupCommandIdsForGate = (gate: SetupCommandItem["gate"]) =>
    setupCommands.filter((item) => item.gate === gate).map((item) => item.id);
  const productionBlocked = readiness.blockedUntil.some((blocker) =>
    /DATABASE_URL|SESSION_SECRET|Switch to live/i.test(blocker),
  );

  return [
    {
      id: "production_persistence",
      label: "Production DB and session",
      status: productionBlocked ? "blocked" : "ready",
      gate: "production",
      reason: productionBlocked
        ? "Production persistence and signed-session proof are still required before live revenue mode."
        : "Production persistence and session gate are not blocking the first-money command center.",
      evidenceRequired: [
        "Real production Postgres DATABASE_URL configured outside tracked files.",
        "Random SESSION_SECRET with at least 32 characters configured outside tracked files.",
        "PR review, App QA evidence, persistence check, and Robert approval before switching live.",
      ],
      safeNextAction: "Prepare the production environment evidence outside git, then run the readiness command again.",
      blockedActions: ["switch live mode", "contact businesses", "collect payment", "publish websites"],
      setupCommandIds: [],
    },
    {
      id: "contact_path",
      label: "Approved contact path",
      status: readiness.canContactBusinesses ? "ready" : "blocked",
      gate: "contact_path",
      reason: readiness.canContactBusinesses
        ? "A Robert-approved contact path is ready for reviewed outreach."
        : "Contact path is not approved, so outreach must stay draft-only.",
      evidenceRequired: [
        "Exact manual or provider contact method Robert approved.",
        "Public evidence URL or internal run proof showing the contact path was verified.",
        "Recorded contact-path approval decision and readiness packet.",
      ],
      safeNextAction: readiness.canContactBusinesses
        ? "Keep each outreach send behind its own draft approval."
        : "Record contact-path approval only after Robert reviews real contact evidence.",
      blockedActions: ["send email", "send SMS", "submit contact forms", "DM businesses"],
      setupCommandIds: setupCommandIdsForGate("contact_path"),
    },
    {
      id: "payment_path",
      label: "Approved payment path",
      status: readiness.canCollectMoney ? "ready" : "blocked",
      gate: "payment_path",
      reason: readiness.canCollectMoney
        ? "A Robert-approved payment path is ready for deposit collection."
        : "Payment path is not approved, so the system cannot ask clients to pay yet.",
      evidenceRequired: [
        "Real HTTPS Stripe/payment link for the first-money website deposit.",
        "Smoke-test evidence URL or proof note for that exact payment path.",
        "Recorded payment-path approval decision and readiness packet.",
      ],
      safeNextAction: readiness.canCollectMoney
        ? "Use only the approved payment link in reviewed outreach/proposal copy."
        : "Create/verify the payment link outside git, then record the approval decision.",
      blockedActions: ["charge clients", "request deposits", "record paid sale"],
      setupCommandIds: setupCommandIdsForGate("payment_path"),
    },
    {
      id: "website_build",
      label: "Paid website build gate",
      status: readiness.canBuildWebsites ? "ready" : "blocked",
      gate: "website_creation",
      reason: readiness.canBuildWebsites
        ? "Website creation gate is ready for paid handoff."
        : "Websites stay blocked until an approved draft, client scope, deposit proof, and build approval exist.",
      evidenceRequired: [
        "Approved outreach draft tied to the client.",
        "Client-approved scope and public business data verification.",
        "Deposit proof and audited ledger entry approval.",
        "Website creation approval decision before scaffold/build work.",
      ],
      safeNextAction: readiness.canBuildWebsites
        ? "Create the website scaffold only from the approved handoff packet."
        : "Keep preparing internal drafts and approval packets; do not build production sites yet.",
      blockedActions: ["write production website files", "deploy", "publish mockup as client site"],
      setupCommandIds: [
        ...setupCommandIdsForGate("ledger_entry"),
        ...setupCommandIdsForGate("website_creation"),
      ],
    },
  ];
}

function buildFirstMoneyHandoffPacket(packet: ReturnType<typeof buildRevenueFirstMoneyCommandCenter>): FirstMoneyHandoffPacket {
  const liveBlocked = !packet.readiness.canContactBusinesses
    || !packet.readiness.canCollectMoney
    || !packet.readiness.canBuildWebsites
    || packet.readiness.blockedUntil.length > 0;
  return {
    status: liveBlocked ? "blocked_before_live_money" : "ready_for_robert_review",
    summary: liveBlocked
      ? "First-money workflow can prepare safe candidate approval and internal drafts, but live contact, payment, build, and deploy remain gated."
      : "First-money workflow has the required contact, payment, build, and readiness gates for Robert review.",
    prReviewStandard: [
      "What broke or risk found: first-money flow was not ready to safely move from candidates to money without guarded approvals.",
      "What changed: Revenue Engine now guides candidate approval, guarded internal Money Sprint execution, unblocker evidence, and App QA visibility.",
      "Evidence required before Robert-ready claim: PR exists, second-agent review passes, tests pass, App QA passes, and remaining live-money gates are explicit.",
      "Deployment: Replit deploy remains blocked until Robert explicitly approves after PR and QA summary.",
      "Rollback: revert the PR branch or disable Revenue Engine first-money UI actions; no external contact/payment/deploy is performed by these gates.",
    ],
    testsToRun: [
      "npm run test:revenue-engine",
      "npm run test:revenue-first-money-command-center-cli",
      "npm run test:app-qa-agent",
      "npm run check",
      "git diff --check",
    ],
    qaGate: "Run App QA with a real APP_QA_BASE_URL/PUBLIC_BASE_URL before any live contact, payment request, website build, or deploy approval.",
    risks: [
      ...packet.readiness.blockedUntil,
      ...packet.readiness.remainingGaps,
    ].slice(0, 8),
    rollbackNotes: [
      "Do not merge or deploy this PR if App QA reports any warning/failure.",
      "If merged UI behavior is confusing, revert the PR commit range for codex/revenue-first-money-workflow.",
      "No outreach, payment, production website write, or deploy should have happened from this workflow before explicit approvals.",
    ],
    deployStatus: "blocked_without_robert_approval",
    safeToSendToRobert: !liveBlocked,
  };
}

function buildFirstMoneyActivationChecklist(
  packet: ReturnType<typeof buildRevenueFirstMoneyCommandCenter>,
  moneyUnblockers: MoneyUnblockerItem[],
  nextCandidateVerification: CandidateVerificationQueueItem | null,
  nextCandidateApproval: ReturnType<typeof redactCandidateApprovalBatchForSummary>,
  nextCandidateReview: ReturnType<typeof redactCandidateReviewBatchForSummary>,
  nextMoneySprintRun: ReturnType<typeof redactCandidateRunBatchForSummary>,
): FirstMoneyActivationStep[] {
  const setupCommand = (id: SetupCommandItem["id"]) => packet.setupCommands.find((item) => item.id === id)?.command || "";
  const contactPath = moneyUnblockers.find((item) => item.id === "contact_path");
  const paymentPath = moneyUnblockers.find((item) => item.id === "payment_path");
  const websiteBuild = moneyUnblockers.find((item) => item.id === "website_build");
  const hasApprovedOutreachDraft = packet.counts.approvedOutreachDrafts > 0;
  const paidBuildStatus: FirstMoneyActivationStep["status"] = hasApprovedOutreachDraft && packet.readiness.canCollectMoney
    ? "blocked_until_evidence"
    : "blocked_until_prior_step";
  const publishStatus: FirstMoneyActivationStep["status"] = packet.readiness.canBuildWebsites
    ? "needs_robert_approval"
    : "blocked_until_prior_step";
  const candidateStep: FirstMoneyActivationStep = nextCandidateVerification
    ? {
      id: "candidate_verification",
      label: "Verify captured public candidate",
      status: "ready_now",
      owner: "agent",
      action: `Verify public evidence and contact fields for ${nextCandidateVerification.businessName} before Robert approval.`,
      proofRequired: [
        "Only public business-owned or public directory evidence.",
        "No business contact during verification.",
        "No import until Robert approves the candidate card.",
      ],
      commandHint: packet.queue.find((item) => item.id === "candidate-verification")?.command || nextCandidateVerification.command,
      unlocks: ["candidate approval cards", "manual-only review when no public email exists"],
      safety: "Public verification only; does not import leads, send outreach, charge clients, write website files or deploy.",
    }
    : nextCandidateApproval
    ? {
      id: "candidate_approval",
      label: "Approve safe candidate batch",
      status: "needs_robert_approval",
      owner: "robert",
      action: `Approve or reject ${nextCandidateApproval.count} visible candidate card(s) before any lead import.`,
      proofRequired: [
        `Exact confirmation text: ${nextCandidateApproval.confirmationText}`,
        "Robert reviewed business names, website status, public evidence status and estimated offer.",
        "No contact details are revealed or used before this approval.",
      ],
      commandHint: "Use the guarded Revenue Engine approval action with the exact confirmation text.",
      unlocks: ["candidate review packet", "internal Money Sprint draft generation"],
      safety: "Records approval only; does not send outreach, charge clients, write website files or deploy.",
    }
    : nextCandidateReview
      ? {
        id: "candidate_review",
        label: "Generate reviewed candidate packet",
        status: "ready_now",
        owner: "agent",
        action: `Generate the guarded review packet for ${nextCandidateReview.count} approved candidate(s).`,
        proofRequired: [
          `Exact confirmation text: ${nextCandidateReview.confirmationText}`,
          "The approvalDecisionId matches the active candidate batch.",
          "Review packet is inspected before running Money Sprint.",
        ],
        commandHint: "Use the guarded Revenue Engine review-packet action with the exact confirmation text.",
        unlocks: ["internal lead import", "draft-only outreach", "mockup planning"],
        safety: "Creates an internal packet only; no external contact, payment request or deploy.",
      }
      : nextMoneySprintRun
        ? {
          id: "candidate_review",
          label: "Run guarded Money Sprint",
          status: "ready_now",
          owner: "agent",
          action: `Run Money Sprint for ${nextMoneySprintRun.count} reviewed candidate(s).`,
          proofRequired: [
            `Exact confirmation text: ${nextMoneySprintRun.confirmationText}`,
            "The review packet was generated from the approved candidate batch.",
            "Drafts stay internal until a separate outreach approval exists.",
          ],
          commandHint: "Use the guarded Revenue Engine Money Sprint action with the exact confirmation text.",
          unlocks: ["internal leads", "draft-only outreach", "website proposal packet"],
          safety: "Persists internal leads/drafts only; no external send, client charge, production write or deploy.",
        }
        : {
          id: "candidate_approval",
          label: "Capture more public candidates",
          status: packet.readiness.canRunGuardedPublicScoutCapture ? "ready_now" : "blocked_until_prior_step",
          owner: "agent",
          action: "Run guarded public scout capture for no-website or weak-website businesses.",
          proofRequired: [
            "Public source evidence for each candidate.",
            "No paid data spend.",
            "No lead import until Robert approves candidate cards.",
          ],
          commandHint: packet.queue.find((item) => item.id === "public-scout")?.command || "Run the guarded public scout schedule.",
          unlocks: ["candidate approval cards"],
          safety: "Research capture only; no outreach, payment, website write or deploy.",
        };

  return [
    candidateStep,
    {
      id: "contact_path",
      label: "Approve contact path",
      status: packet.readiness.canContactBusinesses ? "ready_now" : "blocked_until_evidence",
      owner: "robert",
      action: packet.readiness.canContactBusinesses
        ? "Keep using only the approved contact path for separately approved outreach sends."
        : "Approve the exact manual or provider contact path after evidence is verified outside git.",
      proofRequired: contactPath?.evidenceRequired || [],
      commandHint: packet.readiness.canContactBusinesses
        ? "Contact path is already approved; keep each send behind an outreach approval decision."
        : setupCommand("contact-path-approval") || "Run contact-path approval and readiness packets with real evidence.",
      unlocks: ["reviewed outreach send path"],
      safety: "Approval/readiness only; does not send email, SMS, DMs or contact forms.",
    },
    {
      id: "payment_path",
      label: "Approve payment path",
      status: packet.readiness.canCollectMoney ? "ready_now" : "blocked_until_evidence",
      owner: "robert",
      action: packet.readiness.canCollectMoney
        ? "Use only the approved payment path in reviewed proposal/outreach copy."
        : "Approve the exact Stripe/payment deposit path after smoke evidence is verified outside git.",
      proofRequired: paymentPath?.evidenceRequired || [],
      commandHint: packet.readiness.canCollectMoney
        ? "Payment path is already approved; keep payment requests tied to reviewed proposals."
        : setupCommand("payment-path-approval") || "Run payment-path approval and readiness packets with real evidence.",
      unlocks: ["deposit request", "paid ledger approval"],
      safety: "Approval/readiness only; does not charge clients or record paid revenue.",
    },
    {
      id: "first_outreach",
      label: "Approve first outreach send",
      status: packet.readiness.canContactBusinesses && packet.counts.reviewableOutreachDrafts > 0 ? "needs_robert_approval" : "blocked_until_prior_step",
      owner: "robert",
      action: "Approve one exact outreach draft only after contact path is ready.",
      proofRequired: [
        "Approved contact path decision.",
        "Exact outreach draft approval packet.",
        "Exact SEND confirmation for that draft and approvalDecisionId.",
      ],
      commandHint: "Run outreach approval packet, then use the guarded outreach-send action with exact confirmation.",
      unlocks: ["client reply", "deposit conversation"],
      safety: "One reviewed send at a time; no bulk outreach or unapproved provider send.",
    },
    {
      id: "paid_build",
      label: "Approve paid website build",
      status: paidBuildStatus,
      owner: "robert",
      action: hasApprovedOutreachDraft && packet.readiness.canCollectMoney
        ? "Collect client scope/deposit proof and ledger approval before Robert approves website creation."
        : "Approve website creation only after an approved outreach draft, payment path, client scope, deposit proof, ledger approval and public data verification.",
      proofRequired: websiteBuild?.evidenceRequired || [],
      commandHint: setupCommand("website-creation-approval") || "Run website creation approval only after deposit and scope proof exist.",
      unlocks: ["website scaffold", "delivery workspace"],
      safety: "Approval only; website files are not written until the paid handoff packet passes.",
    },
    {
      id: "publish",
      label: "Approve publish/deploy",
      status: publishStatus,
      owner: "robert",
      action: packet.readiness.canBuildWebsites
        ? "Review final PR/App QA/rollback summary before any deploy command is run."
        : "Approve deploy only after preview verification, App QA pass, rollback note and explicit Replit/deploy approval.",
      proofRequired: [
        "Preview deploy URL verified.",
        "App QA pass with real base URL.",
        "Rollback note and Robert publish approval.",
      ],
      commandHint: "Run website-publish approval and readiness packets after preview QA; ask Robert before any Replit deploy.",
      unlocks: ["public client website"],
      safety: "Never deploys without explicit Robert approval after PR and QA summary.",
    },
  ];
}

type CandidateApprovalInput = {
  id: string;
  businessName: string;
  area: string;
  niche: string;
  websiteStatus: string;
  contactChannel: string;
  contactValue: string;
  recipientEmail: string;
  sourceUrl: string;
  evidence: string;
  painPoint: string;
  estimatedOfferUsd: number;
  verificationStatus: string;
  publicEvidenceVerified: boolean;
};

function buildCandidateApprovalBatch(
  candidates: CandidateApprovalInput[],
  batchIndex: number,
  approvalDecisions: ReturnType<typeof listRevenueApprovalDecisions>,
): CandidateApprovalBatch {
  const firstCandidate = candidates[0];
  const candidateIds = candidates.map((candidate) => candidate.id);
  const area = firstCandidate?.area || "";
  const niche = firstCandidate?.niche || "";
  const targetId = buildRevenuePublicCandidateApprovalTargetId(candidateIds);
  const snapshotHash = buildRevenuePublicCandidateSnapshotHash(candidates);
  const outputPath = `revenue_workspace/money-sprint/public-candidates-${candidateIds.join("_")}.json`;
  const matchingApprovalDecision = approvalDecisions.find((decision) =>
    decision.targetType === "public_candidate"
    && decision.targetId === targetId
    && decision.decision === "approved"
    && decision.guardrail.status === "recorded"
    && decision.approvalSource === "public_candidate_approval_cli"
    && decision.publicCandidateSnapshotHash === snapshotHash,
  );
  const approvalCommand = `Use the Revenue Engine Trust Center approval action for ${candidateIds.length} candidate(s) (${candidateIds.join(",")}) in ${area} / ${niche} with exact confirmation text: APPROVE PUBLIC CANDIDATES candidate-review-${batchIndex + 1}`;
  const reviewCommand = matchingApprovalDecision
    ? npmRunText("revenue:public-candidate-review", [
      `--candidate-ids=${candidateIds.join(",")}`,
      `--approval-decision-id=${matchingApprovalDecision.id}`,
      `--area=${area}`,
      `--niche=${niche}`,
      "--offer-focus=websites",
      `--output=${outputPath}`,
      "--overwrite",
    ])
    : "";
  const moneySprintRunPacketCommand = reviewCommand
    ? npmRunText("revenue:money-sprint-run-packet", [`--input=${outputPath}`])
    : "";
  const approvalStatus = matchingApprovalDecision ? "ready_for_candidate_review" : "needs_robert_approval";
  return {
    id: `candidate-review-${batchIndex + 1}`,
    area,
    niche,
    candidateIds,
    candidateNames: candidates.map((candidate) => candidate.businessName),
    candidates: candidates.map((candidate) => ({
      id: candidate.id,
      businessName: candidate.businessName,
      websiteStatus: candidate.websiteStatus,
      contactChannel: candidate.contactChannel,
      contactValue: candidate.contactValue,
      recipientEmail: candidate.recipientEmail,
      sourceUrl: candidate.sourceUrl,
      evidence: candidate.evidence,
      painPoint: candidate.painPoint,
      estimatedOfferUsd: candidate.estimatedOfferUsd,
    })),
    count: candidates.length,
    totalEstimatedOfferUsd: candidates.reduce((total, candidate) => total + candidate.estimatedOfferUsd, 0),
    approvalSafety: {
      persistsApprovalDecision: true,
      importsLeads: false,
      sendsOutreach: false,
      writesPreviewFiles: false,
      chargesClients: false,
      deploys: false,
      paidDataSpendUsd: 0,
    },
    approvalStatus,
    approvalDecisionId: matchingApprovalDecision?.id || "",
    outputPath,
    approvalCommand,
    reviewCommand,
    moneySprintRunPacketCommand,
    command: reviewCommand || approvalCommand,
    reason: matchingApprovalDecision
      ? `${candidates.length} verified public candidate(s) in ${area} / ${niche} have a matching Robert approval decision and are ready for candidate review.`
      : `${candidates.length} verified public candidate(s) in ${area} / ${niche} need an auditable Robert approval decision before candidate review.`,
  };
}

function buildCandidateApprovalBatches(candidates: CandidateApprovalInput[]) {
  const approvalDecisions = listRevenueApprovalDecisions();
  const groupedCandidates = new Map<string, CandidateApprovalInput[]>();
  for (const candidate of candidates) {
    const key = `${candidate.area}\u0000${candidate.niche}`;
    groupedCandidates.set(key, [...(groupedCandidates.get(key) || []), candidate]);
  }
  const batches: CandidateApprovalBatch[] = [];
  for (const group of groupedCandidates.values()) {
    for (let index = 0; index < group.length; index += 5) {
      batches.push(buildCandidateApprovalBatch(group.slice(index, index + 5), batches.length, approvalDecisions));
    }
  }
  return batches;
}

export function buildRevenueFirstMoneyCommandCenter(options: RevenueFirstMoneyCommandCenterCliOptions) {
  const readiness = buildRevenueMoneyReadinessReport({ mode: options.mode });
  const setupCommands = buildSetupCommands(readiness);
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
  const candidateApprovalBatches = buildCandidateApprovalBatches(robertReviewReadyCandidates);
  const activeApprovalBatch = candidateApprovalBatches.find((batch) => batch.approvalStatus === "ready_for_candidate_review")
    || candidateApprovalBatches[0];
  const remainingApprovalBatches = activeApprovalBatch
    ? candidateApprovalBatches.filter((batch) => batch.id !== activeApprovalBatch.id)
    : [];
  const remainingApprovalBatchCount = remainingApprovalBatches.length;
  const remainingApprovalCandidateCount = remainingApprovalBatches.reduce((total, batch) => total + batch.count, 0);
  const candidateReviewItem: CommandQueueItem | null = activeApprovalBatch
    ? {
      id: "candidate-review",
      label: activeApprovalBatch.approvalStatus === "ready_for_candidate_review"
        ? "Run approved public candidate review"
        : "Record Robert approval for verified public candidates",
      command: activeApprovalBatch.command,
      status: "review",
      reason: `${activeApprovalBatch.reason}${remainingApprovalBatchCount > 0 ? ` ${remainingApprovalCandidateCount} additional verified candidate(s) remain across ${remainingApprovalBatchCount} approval batch(es).` : ""}`,
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
  const hasPendingCandidateWork = Boolean(candidateReviewItem || manualContactReviewItem || candidateVerificationItem);
  const publicScoutItem: CommandQueueItem = {
    id: "public-scout",
    label: "Capture public business candidates",
    command: "npm run revenue:public-scout-schedule -- --area=Miami --niche=coffee_shop --browser-executor=subagent_browser --max-candidates-per-run=8",
    status: readiness.canRunGuardedPublicScoutCapture ? "ready" : "blocked",
    reason: readiness.canRunGuardedPublicScoutCapture
      ? hasPendingCandidateWork
        ? "Keep filling the pipeline in parallel with guarded public scout capture. No contact, paid data, lead import, preview publish, or client charging."
        : "No captured candidates are waiting; run guarded public scout capture only. No contact, paid data, lead import, preview publish, or client charging."
      : "Guarded public scout capture is not ready yet.",
  };
  const candidateQueueItems = [
    candidateReviewItem || manualContactReviewItem || candidateVerificationItem || publicScoutItem,
    ...(candidateReviewItem && manualContactReviewItem ? [manualContactReviewItem] : []),
    ...((candidateReviewItem || manualContactReviewItem) && candidateVerificationItem ? [candidateVerificationItem] : []),
    ...(hasPendingCandidateWork ? [publicScoutItem] : []),
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
        command: trustCenterActionText("/api/revenue-engine/website-creation-approval-pending-action", [
          `outreachDraftId=${approvedDraft.id}`,
          "real scope/deposit/public-data notes",
          "Robert-approved build flag",
          "client-approved scope flag",
          "deposit-paid flag",
          "public-data verified flag",
          "launchTargetDays=7",
        ]),
        status: readiness.canBuildWebsites ? "review" : "blocked",
        reason: readiness.canBuildWebsites
          ? "Approved draft exists; queue Trust Center deposit/scope/public data approval before website handoff."
          : "Website handoff can be prepared only after deposit/scope/public data and publish gates are proven.",
      }
      : {
        id: "website-handoff",
        label: "Prepare paid website handoff",
        command: "blocked until an approved outreach draft exists",
        status: "blocked",
        reason: "No approved outreach draft exists yet; use the website creation setup gate only after scope, deposit and public data evidence are real.",
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
    candidateVerificationQueue: redactCandidateVerificationQueueForSummary(verificationNeededCandidates),
    candidateApprovalBatches,
    setupCommands,
    readiness: {
      ready: readiness.ready,
      canStartToday: readiness.canStartToday,
      canSearchBusinesses: readiness.canSearchBusinesses,
      canAutonomousSearchBusinesses: readiness.canAutonomousSearchBusinesses,
      canRunGuardedPublicScoutCapture: readiness.canRunGuardedPublicScoutCapture,
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

export function buildRevenueFirstMoneyCommandCenterSummary(options: RevenueFirstMoneyCommandCenterCliOptions) {
  const packet = buildRevenueFirstMoneyCommandCenter(options);
  const moneyUnblockers = buildMoneyUnblockers(packet.readiness, packet.setupCommands);
  const handoffPacket = buildFirstMoneyHandoffPacket(packet);
  const nextCandidateApproval = redactCandidateApprovalBatchForSummary(
    packet.candidateApprovalBatches.find((batch) => batch.command === packet.nextCommand.command)
    || packet.candidateApprovalBatches.find((batch) => batch.approvalStatus === "needs_robert_approval"),
  );
  const nextCandidateReview = redactCandidateReviewBatchForSummary(
    packet.candidateApprovalBatches.find((batch) => batch.command === packet.nextCommand.command)
    || packet.candidateApprovalBatches.find((batch) => batch.approvalStatus === "ready_for_candidate_review"),
  );
  const nextMoneySprintRun = redactCandidateRunBatchForSummary(
    packet.candidateApprovalBatches.find((batch) => batch.command === packet.nextCommand.command)
    || packet.candidateApprovalBatches.find((batch) => batch.approvalStatus === "ready_for_candidate_review"),
  );
  const candidateApprovalQueue = packet.candidateApprovalBatches
    .map((batch) => redactCandidateApprovalBatchForSummary(batch))
    .filter((batch): batch is NonNullable<ReturnType<typeof redactCandidateApprovalBatchForSummary>> => Boolean(batch));
  const candidateReviewQueue = packet.candidateApprovalBatches
    .map((batch) => redactCandidateReviewBatchForSummary(batch))
    .filter((batch): batch is NonNullable<ReturnType<typeof redactCandidateReviewBatchForSummary>> => Boolean(batch));
  const candidateRunQueue = packet.candidateApprovalBatches
    .map((batch) => redactCandidateRunBatchForSummary(batch))
    .filter((batch): batch is NonNullable<ReturnType<typeof redactCandidateRunBatchForSummary>> => Boolean(batch));
  const safeSearchAction = packet.queue.find((item) => item.id === "public-scout") || null;
  const nextCandidateVerification = packet.candidateVerificationQueue[0] || null;
  const nextCommand = {
    ...packet.nextCommand,
    command: nextCandidateReview
      ? "Use the guarded Revenue Engine review-packet action with the exact confirmation text."
      : nextCandidateApproval
        ? "Use the guarded Revenue Engine approval action with the exact confirmation text."
        : packet.nextCommand.command,
    reason: nextCandidateReview
      ? `${nextCandidateReview.count} approved public candidate(s) in ${nextCandidateReview.area} / ${nextCandidateReview.niche} are ready for the guarded review packet.`
      : nextCandidateApproval
        ? `${nextCandidateApproval.count} verified public candidate(s) in ${nextCandidateApproval.area} / ${nextCandidateApproval.niche} need Robert approval before internal Money Sprint work.`
        : nextCandidateVerification
          ? `${nextCandidateVerification.businessName} needs public verification before Robert approval.`
          : packet.nextCommand.reason,
  };
  const activationChecklist = buildFirstMoneyActivationChecklist(
    packet,
    moneyUnblockers,
    nextCandidateVerification,
    nextCandidateApproval,
    nextCandidateReview,
    nextMoneySprintRun,
  );
  const robertApprovalBrief = buildRobertApprovalBrief(candidateApprovalQueue, candidateReviewQueue);
  return {
    status: packet.status,
    mode: packet.mode,
    nextCommand,
    robertApprovalBrief,
    nextCandidateApproval,
    nextCandidateVerification,
    candidateVerificationQueue: packet.candidateVerificationQueue,
    candidateApprovalQueue,
    nextCandidateReview,
    candidateReviewQueue,
    nextMoneySprintRun,
    candidateRunQueue,
    safeSearchAction,
    moneyUnblockers,
    handoffPacket,
    activationChecklist,
    counts: {
      publicCandidates: packet.counts.publicCandidates,
      verificationNeededPublicCandidates: packet.counts.verificationNeededPublicCandidates,
      reviewablePublicCandidates: packet.counts.reviewablePublicCandidates,
      manualOnlyPublicCandidates: packet.counts.manualOnlyPublicCandidates,
      leads: packet.counts.leads,
      outreachDrafts: packet.counts.outreachDrafts,
      approvedOutreachDrafts: packet.counts.approvedOutreachDrafts,
    },
    readiness: {
      ready: packet.readiness.ready,
      canSearchBusinesses: packet.readiness.canSearchBusinesses,
      canAutonomousSearchBusinesses: packet.readiness.canAutonomousSearchBusinesses,
      canRunGuardedPublicScoutCapture: packet.readiness.canRunGuardedPublicScoutCapture,
      canContactBusinesses: packet.readiness.canContactBusinesses,
      canCollectMoney: packet.readiness.canCollectMoney,
      canBuildWebsites: packet.readiness.canBuildWebsites,
      blockedUntil: packet.readiness.blockedUntil,
      remainingGaps: packet.readiness.remainingGaps,
    },
    safety: packet.safety,
  };
}

export function formatRevenueFirstMoneyCommandCenterText(packet: ReturnType<typeof buildRevenueFirstMoneyCommandCenter>) {
  return [
    `Revenue first-money command center: ${packet.status}`,
    `Mode: ${packet.mode}`,
    `Next command: ${displayText(packet.nextCommand.command)}`,
    `Next reason: ${displayText(packet.nextCommand.reason)}`,
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
    ...packet.queue.map((item) => `- [${item.status}] ${displayText(item.label)}: ${displayText(item.command)} (${displayText(item.reason)})`),
    ...(packet.setupCommands.length
      ? [
        "",
        "Setup gates:",
        ...packet.setupCommands.map((item) =>
          `- [${item.status}] ${displayText(item.label)}: ${displayText(item.command)} (${displayText(item.reason)})`,
        ),
      ]
      : []),
    ...(packet.candidateApprovalBatches.length
      ? [
        "",
        "Candidate approval batches:",
        ...packet.candidateApprovalBatches.flatMap((batch) => [
          `- ${batch.id} [${batch.approvalStatus}]: ${batch.count} candidate(s), estimated offer total $${batch.totalEstimatedOfferUsd}, in ${displayText(batch.area)} / ${displayText(batch.niche)}: ${displayText(batch.command)}${batch.moneySprintRunPacketCommand ? `; then ${displayText(batch.moneySprintRunPacketCommand)}` : ""}`,
          `  Approval safety: persistsApprovalDecision=${batch.approvalSafety.persistsApprovalDecision ? "yes" : "no"}; importsLeads=${batch.approvalSafety.importsLeads ? "yes" : "no"}; sendsOutreach=${batch.approvalSafety.sendsOutreach ? "yes" : "no"}; writesPreviewFiles=${batch.approvalSafety.writesPreviewFiles ? "yes" : "no"}; chargesClients=${batch.approvalSafety.chargesClients ? "yes" : "no"}; deploys=${batch.approvalSafety.deploys ? "yes" : "no"}; paidDataSpend=$${batch.approvalSafety.paidDataSpendUsd}`,
          ...batch.candidates.flatMap((candidate, index) => [
            `  ${index + 1}. ${displayText(candidate.businessName)} (${displayText(candidate.websiteStatus)})`,
            `     Candidate: ${candidate.id}`,
            `     Contact channel: ${displayText(candidate.contactChannel)}`,
            `     Contact value: ${displayText(candidate.contactValue)}`,
            `     Recipient email: ${displayText(candidate.recipientEmail || "none")}`,
            `     Source: ${displayText(candidate.sourceUrl)}`,
            `     Evidence: ${displayText(candidate.evidence)}`,
            `     Pain point: ${displayText(candidate.painPoint)}`,
            `     Estimated offer: $${candidate.estimatedOfferUsd}`,
          ]),
        ]),
      ]
      : []),
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
