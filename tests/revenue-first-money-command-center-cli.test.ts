import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import {
  recordRevenueOutreachDraft,
  recordRevenuePublicScoutRun,
  resetRevenueLeadsForTests,
  resetRevenueOutreachForTests,
  resetRevenuePublicLeadCandidatesForTests,
  setRevenueLeadsPathForTests,
  setRevenueOutreachPathForTests,
  setRevenuePublicLeadCandidatesPathForTests,
} from "../server/revenue-engine";
import {
  buildRevenueFirstMoneyCommandCenter,
  formatRevenueFirstMoneyCommandCenterText,
  getRevenueFirstMoneyCommandCenterExitCode,
  parseRevenueFirstMoneyCommandCenterArgs,
  validateRevenueFirstMoneyCommandCenterOptions,
} from "../server/revenue-first-money-command-center-cli";

const testLeadsPath = "/tmp/revenue-first-money-command-center-leads-test.json";
const testOutreachPath = "/tmp/revenue-first-money-command-center-outreach-test.json";
const testPublicCandidatesPath = "/tmp/revenue-first-money-command-center-public-candidates-test.json";

setRevenueLeadsPathForTests(testLeadsPath);
setRevenueOutreachPathForTests(testOutreachPath);
setRevenuePublicLeadCandidatesPathForTests(testPublicCandidatesPath);

test.afterEach(() => {
  resetRevenueLeadsForTests();
  resetRevenueOutreachForTests();
  resetRevenuePublicLeadCandidatesForTests();
});

function createDraft(approvalStatus: "draft" | "approved" = "draft") {
  return recordRevenueOutreachDraft({
    channel: "email",
    approvalStatus,
    recipientEmail: "owner@commandcenter.biz",
    contactName: "Owner",
    businessName: approvalStatus === "approved" ? "Approved Command Cafe" : "Draft Command Cafe",
    sourceUrl: "https://public-directory.invalid/command-center-cafe",
    businessSummary: "Command Center Cafe has public evidence of no dedicated website and needs online menu capture plus catering follow-up.",
    websitePriceUsd: 3500,
    automationPriceUsd: 1200,
    monthlyRetainerUsd: 750,
    estimatedInternalMonthlyCostUsd: 54,
    notes: "",
  }).draft;
}

test("parses and validates first-money command center options", () => {
  assert.deepEqual(parseRevenueFirstMoneyCommandCenterArgs([]), { mode: "first-sprint", json: false });
  assert.deepEqual(parseRevenueFirstMoneyCommandCenterArgs(["--mode=production-launch", "--json"]), {
    mode: "production-launch",
    json: true,
  });
  assert.deepEqual(validateRevenueFirstMoneyCommandCenterOptions(parseRevenueFirstMoneyCommandCenterArgs(["--mode=banana"])), [
    "--mode must be first-sprint or production-launch.",
  ]);
});

test("first-money command center starts with guarded public scouting", () => {
  const packet = buildRevenueFirstMoneyCommandCenter({ mode: "first-sprint", json: false });
  const text = formatRevenueFirstMoneyCommandCenterText(packet);

  assert.equal(packet.nextCommand.id, "public-scout");
  assert.equal(packet.queue.some((item) => item.id === "public-scout" && item.command.includes("revenue:public-scout-schedule")), true);
  assert.equal(packet.safety.sendsOutreach, false);
  assert.equal(packet.safety.chargesClients, false);
  assert.equal(packet.safety.deploys, false);
  assert.equal(getRevenueFirstMoneyCommandCenterExitCode(packet), 0);
  assert.match(text, /Revenue first-money command center:/);
  assert.match(text, /Find businesses/);
});

test("first-money command center prioritizes public contact verification for unverified candidates", () => {
  recordRevenuePublicScoutRun({
    area: "Miami",
    niche: "coffee shop",
    offerFocus: "websites",
    dailyResearchTarget: 20,
    dailyQualifiedLeadLimit: 5,
    dailyMockupLimit: 2,
    dailyContactLimit: 2,
    maxPaidDataSpendUsd: 0,
    requireRobertApprovalToContact: true,
    writePreviewFiles: false,
    candidates: [
      {
        businessName: "Captured Command Cafe",
        area: "Miami",
        niche: "coffee shop",
        websiteStatus: "no_website",
        contactChannel: "unknown",
        contactValue: "",
        sourceUrl: "https://public-directory.invalid/captured-command-cafe",
        recipientEmail: "",
        evidence: "Public listing has no website and recent menu photos.",
        painPoint: "Needs menu capture and follow-up.",
        estimatedOfferUsd: 3600,
        status: "research",
        verificationStatus: "needs_review",
        publicEvidenceVerified: false,
        approvalToImport: false,
      },
    ],
  });

  const packet = buildRevenueFirstMoneyCommandCenter({ mode: "first-sprint", json: false });
  const verificationCommand = packet.queue.find((item) => item.id === "candidate-verification");

  assert.equal(packet.nextCommand.id, "candidate-verification");
  assert.equal(packet.counts.verificationNeededPublicCandidates, 1);
  assert.equal(packet.counts.reviewablePublicCandidates, 0);
  assert.equal(verificationCommand?.status, "review");
  assert.match(verificationCommand?.command || "", /revenue:public-contact-verification/);
  assert.doesNotMatch(verificationCommand?.command || "", /--approved-by-robert/);
});

test("first-money command center routes verified public candidates to Robert review", () => {
  recordRevenuePublicScoutRun({
    area: "Miami",
    niche: "coffee shop",
    offerFocus: "websites",
    dailyResearchTarget: 20,
    dailyQualifiedLeadLimit: 5,
    dailyMockupLimit: 2,
    dailyContactLimit: 2,
    maxPaidDataSpendUsd: 0,
    requireRobertApprovalToContact: true,
    writePreviewFiles: false,
    candidates: [
      {
        businessName: "Verified Command Cafe",
        area: "Miami",
        niche: "coffee shop",
        websiteStatus: "no_website",
        contactChannel: "email",
        contactValue: "owner@verifiedcommand.biz",
        sourceUrl: "https://public-directory.invalid/verified-command-cafe",
        recipientEmail: "owner@verifiedcommand.biz",
        evidence: "Public listing has no website, recent menu photos and a visible public owner email.",
        painPoint: "Needs menu capture and follow-up.",
        estimatedOfferUsd: 3600,
        status: "research",
        verificationStatus: "verified_public",
        publicEvidenceVerified: true,
        approvalToImport: false,
      },
    ],
  });

  const packet = buildRevenueFirstMoneyCommandCenter({ mode: "first-sprint", json: false });
  const reviewCommand = packet.queue.find((item) => item.id === "candidate-review");

  assert.equal(packet.nextCommand.id, "candidate-review");
  assert.equal(packet.counts.verificationNeededPublicCandidates, 0);
  assert.equal(packet.counts.reviewablePublicCandidates, 1);
  assert.equal(reviewCommand?.status, "review");
  assert.match(reviewCommand?.command || "", /revenue:public-candidate-approval-decision/);
  assert.match(reviewCommand?.command || "", /--area=Miami/);
  assert.match(reviewCommand?.command || "", /--niche=coffee shop/);
  assert.match(reviewCommand?.command || "", /--offer-focus=websites/);
  assert.match(reviewCommand?.command || "", /--decision=approved/);
  assert.match(reviewCommand?.command || "", /--confirmed-by-robert/);
});

test("first-money command center routes verified manual-only candidates to Robert review", () => {
  recordRevenuePublicScoutRun({
    area: "Miami",
    niche: "hair salon",
    offerFocus: "websites",
    dailyResearchTarget: 20,
    dailyQualifiedLeadLimit: 5,
    dailyMockupLimit: 2,
    dailyContactLimit: 0,
    maxPaidDataSpendUsd: 0,
    requireRobertApprovalToContact: true,
    writePreviewFiles: false,
    candidates: [
      {
        businessName: "Manual Command Salon",
        area: "Miami",
        niche: "hair salon",
        websiteStatus: "no_website",
        contactChannel: "phone",
        contactValue: "305-555-0140",
        sourceUrl: "https://public-directory.invalid/manual-command-salon",
        recipientEmail: "",
        evidence: "Public listing has no website, recent salon photos and a visible public phone number.",
        painPoint: "Needs booking capture and follow-up.",
        estimatedOfferUsd: 3600,
        status: "research",
        verificationStatus: "verified_public",
        publicEvidenceVerified: true,
        approvalToImport: false,
      },
    ],
  });

  const packet = buildRevenueFirstMoneyCommandCenter({ mode: "first-sprint", json: false });
  const text = formatRevenueFirstMoneyCommandCenterText(packet);
  const manualCommand = packet.queue.find((item) => item.id === "manual-contact-review");

  assert.equal(packet.nextCommand.id, "manual-contact-review");
  assert.equal(packet.counts.verificationNeededPublicCandidates, 0);
  assert.equal(packet.counts.reviewablePublicCandidates, 0);
  assert.equal(packet.counts.manualOnlyPublicCandidates, 1);
  assert.equal(manualCommand?.status, "review");
  assert.match(manualCommand?.command || "", /revenue:manual-contact-approval-packet/);
  assert.doesNotMatch(manualCommand?.command || "", /--approved-by-robert/);
  assert.match(text, /Manual-only public candidates: 1/);
  assert.equal(packet.safety.sendsOutreach, false);
  assert.equal(packet.safety.chargesClients, false);
  assert.equal(packet.safety.deploys, false);
});

test("first-money command center keeps email-ready candidates ahead of manual-only candidates", () => {
  recordRevenuePublicScoutRun({
    area: "Miami",
    niche: "hair salon",
    offerFocus: "websites",
    dailyResearchTarget: 20,
    dailyQualifiedLeadLimit: 5,
    dailyMockupLimit: 2,
    dailyContactLimit: 0,
    maxPaidDataSpendUsd: 0,
    requireRobertApprovalToContact: true,
    writePreviewFiles: false,
    candidates: [
      {
        businessName: "Email Command Salon",
        area: "Miami",
        niche: "hair salon",
        websiteStatus: "no_website",
        contactChannel: "email",
        contactValue: "owner@emailcommandsalon.biz",
        sourceUrl: "https://public-directory.invalid/email-command-salon",
        recipientEmail: "owner@emailcommandsalon.biz",
        evidence: "Public listing has no website, recent salon photos and a visible public owner email.",
        painPoint: "Needs booking capture and follow-up.",
        estimatedOfferUsd: 3600,
        status: "research",
        verificationStatus: "verified_public",
        publicEvidenceVerified: true,
        approvalToImport: false,
      },
      {
        businessName: "Manual Command Salon",
        area: "Miami",
        niche: "hair salon",
        websiteStatus: "no_website",
        contactChannel: "phone",
        contactValue: "305-555-0140",
        sourceUrl: "https://public-directory.invalid/manual-command-salon",
        recipientEmail: "",
        evidence: "Public listing has no website, recent salon photos and a visible public phone number.",
        painPoint: "Needs booking capture and follow-up.",
        estimatedOfferUsd: 3600,
        status: "research",
        verificationStatus: "verified_public",
        publicEvidenceVerified: true,
        approvalToImport: false,
      },
    ],
  });

  const packet = buildRevenueFirstMoneyCommandCenter({ mode: "first-sprint", json: false });
  const manualCommand = packet.queue.find((item) => item.id === "manual-contact-review");
  const reviewCommand = packet.queue.find((item) => item.id === "candidate-review");

  assert.equal(packet.nextCommand.id, "candidate-review");
  assert.equal(packet.counts.reviewablePublicCandidates, 1);
  assert.equal(packet.counts.manualOnlyPublicCandidates, 1);
  assert.equal(packet.counts.verificationNeededPublicCandidates, 0);
  assert.match(reviewCommand?.command || "", /revenue:public-candidate-approval-decision/);
  assert.equal(manualCommand?.status, "review");
  assert.match(manualCommand?.command || "", /revenue:manual-contact-approval-packet/);
});

test("first-money command center keeps manual and verification commands visible together", () => {
  recordRevenuePublicScoutRun({
    area: "Miami",
    niche: "hair salon",
    offerFocus: "websites",
    dailyResearchTarget: 20,
    dailyQualifiedLeadLimit: 5,
    dailyMockupLimit: 2,
    dailyContactLimit: 0,
    maxPaidDataSpendUsd: 0,
    requireRobertApprovalToContact: true,
    writePreviewFiles: false,
    candidates: [
      {
        businessName: "Manual Command Salon",
        area: "Miami",
        niche: "hair salon",
        websiteStatus: "no_website",
        contactChannel: "phone",
        contactValue: "305-555-0140",
        sourceUrl: "https://public-directory.invalid/manual-command-salon",
        recipientEmail: "",
        evidence: "Public listing has no website, recent salon photos and a visible public phone number.",
        painPoint: "Needs booking capture and follow-up.",
        estimatedOfferUsd: 3600,
        status: "research",
        verificationStatus: "verified_public",
        publicEvidenceVerified: true,
        approvalToImport: false,
      },
      {
        businessName: "Needs Verification Command Salon",
        area: "Miami",
        niche: "hair salon",
        websiteStatus: "no_website",
        contactChannel: "unknown",
        contactValue: "",
        sourceUrl: "https://public-directory.invalid/needs-verification-command-salon",
        recipientEmail: "",
        evidence: "Public listing has no website and needs public contact verification.",
        painPoint: "Needs booking capture and follow-up.",
        estimatedOfferUsd: 3600,
        status: "research",
        verificationStatus: "needs_review",
        publicEvidenceVerified: false,
        approvalToImport: false,
      },
    ],
  });

  const packet = buildRevenueFirstMoneyCommandCenter({ mode: "first-sprint", json: false });
  const manualCommands = packet.queue.filter((item) => item.id === "manual-contact-review");
  const verificationCommand = packet.queue.find((item) => item.id === "candidate-verification");

  assert.equal(packet.nextCommand.id, "manual-contact-review");
  assert.equal(packet.counts.manualOnlyPublicCandidates, 1);
  assert.equal(packet.counts.verificationNeededPublicCandidates, 1);
  assert.equal(manualCommands.length, 1);
  assert.equal(verificationCommand?.status, "review");
  assert.match(verificationCommand?.command || "", /revenue:public-contact-verification/);
});

test("first-money command center prioritizes verified candidates over additional verification work", () => {
  const capture = recordRevenuePublicScoutRun({
    area: "Miami",
    niche: "coffee shop",
    offerFocus: "websites",
    scoutRunId: "command-center-mixed-ready",
    dailyResearchTarget: 20,
    dailyQualifiedLeadLimit: 5,
    dailyMockupLimit: 2,
    dailyContactLimit: 0,
    maxPaidDataSpendUsd: 0,
    requireRobertApprovalToContact: true,
    writePreviewFiles: false,
    candidates: [
      {
        businessName: "Ready Command Cafe",
        area: "Miami",
        niche: "coffee shop",
        websiteStatus: "no_website",
        contactChannel: "email",
        contactValue: "owner@readycommand.biz",
        sourceUrl: "https://public-directory.invalid/ready-command-cafe",
        recipientEmail: "owner@readycommand.biz",
        evidence: "Public listing has no website, recent menu photos and a visible public owner email.",
        painPoint: "Needs menu capture and follow-up.",
        estimatedOfferUsd: 3600,
        status: "research",
        verificationStatus: "verified_public",
        publicEvidenceVerified: true,
        approvalToImport: false,
      },
      {
        businessName: "Needs Verification Command Cafe",
        area: "Miami",
        niche: "coffee shop",
        websiteStatus: "no_website",
        contactChannel: "unknown",
        contactValue: "",
        sourceUrl: "https://public-directory.invalid/needs-verification-command-cafe",
        recipientEmail: "",
        evidence: "Public listing has no website and recent menu photos.",
        painPoint: "Needs menu capture and follow-up.",
        estimatedOfferUsd: 3600,
        status: "research",
        verificationStatus: "needs_review",
        publicEvidenceVerified: false,
        approvalToImport: false,
      },
    ],
  });

  const packet = buildRevenueFirstMoneyCommandCenter({ mode: "first-sprint", json: false });
  const reviewCommand = packet.queue.find((item) => item.id === "candidate-review");
  const readyCandidateId = capture.recordedCandidates[0].candidate.id;
  const unverifiedCandidateId = capture.recordedCandidates[1].candidate.id;

  assert.equal(packet.nextCommand.id, "candidate-review");
  assert.equal(packet.counts.reviewablePublicCandidates, 1);
  assert.equal(packet.counts.verificationNeededPublicCandidates, 1);
  assert.match(reviewCommand?.command || "", new RegExp(readyCandidateId));
  assert.doesNotMatch(reviewCommand?.command || "", new RegExp(unverifiedCandidateId));
});

test("first-money command center review command batches only matching area and niche", () => {
  const capture = recordRevenuePublicScoutRun({
    area: "Miami",
    niche: "coffee shop",
    offerFocus: "websites",
    scoutRunId: "command-center-mixed-areas",
    dailyResearchTarget: 20,
    dailyQualifiedLeadLimit: 5,
    dailyMockupLimit: 2,
    dailyContactLimit: 0,
    maxPaidDataSpendUsd: 0,
    requireRobertApprovalToContact: true,
    writePreviewFiles: false,
    candidates: [
      {
        businessName: "Miami Ready Command Cafe",
        area: "Miami",
        niche: "coffee shop",
        websiteStatus: "no_website",
        contactChannel: "email",
        contactValue: "owner@miamireadycommand.biz",
        sourceUrl: "https://public-directory.invalid/miami-ready-command-cafe",
        recipientEmail: "owner@miamireadycommand.biz",
        evidence: "Public listing has no website, recent menu photos and a visible public owner email.",
        painPoint: "Needs menu capture and follow-up.",
        estimatedOfferUsd: 3600,
        status: "research",
        verificationStatus: "verified_public",
        publicEvidenceVerified: true,
        approvalToImport: false,
      },
      {
        businessName: "Austin Ready Command Salon",
        area: "Austin",
        niche: "hair salon",
        websiteStatus: "no_website",
        contactChannel: "email",
        contactValue: "owner@austinreadycommand.biz",
        sourceUrl: "https://public-directory.invalid/austin-ready-command-salon",
        recipientEmail: "owner@austinreadycommand.biz",
        evidence: "Public listing has no website, recent salon photos and a visible public owner email.",
        painPoint: "Needs booking capture and follow-up.",
        estimatedOfferUsd: 3600,
        status: "research",
        verificationStatus: "verified_public",
        publicEvidenceVerified: true,
        approvalToImport: false,
      },
    ],
  });

  const packet = buildRevenueFirstMoneyCommandCenter({ mode: "first-sprint", json: false });
  const reviewCommand = packet.queue.find((item) => item.id === "candidate-review");
  const firstCandidateId = capture.recordedCandidates[0].candidate.id;
  const secondCandidateId = capture.recordedCandidates[1].candidate.id;

  assert.equal(packet.nextCommand.id, "candidate-review");
  assert.equal(packet.counts.reviewablePublicCandidates, 2);
  assert.match(reviewCommand?.command || "", new RegExp(firstCandidateId));
  assert.doesNotMatch(reviewCommand?.command || "", new RegExp(secondCandidateId));
  assert.match(reviewCommand?.command || "", /--area=Miami/);
  assert.match(reviewCommand?.command || "", /--niche=coffee shop/);
});

test("first-money command center reads the full persisted candidate queue", () => {
  recordRevenuePublicScoutRun({
    area: "Miami",
    niche: "coffee shop",
    offerFocus: "websites",
    scoutRunId: "command-center-full-queue",
    dailyResearchTarget: 30,
    dailyQualifiedLeadLimit: 12,
    dailyMockupLimit: 2,
    dailyContactLimit: 0,
    maxPaidDataSpendUsd: 0,
    requireRobertApprovalToContact: true,
    writePreviewFiles: false,
    candidates: Array.from({ length: 12 }, (_, index) => ({
      businessName: `Queue Command Cafe ${index + 1}`,
      area: "Miami",
      niche: "coffee shop",
      websiteStatus: "no_website" as const,
      contactChannel: "email" as const,
      contactValue: `owner${index + 1}@queuecommand.biz`,
      sourceUrl: `https://public-directory.invalid/queue-command-cafe-${index + 1}`,
      recipientEmail: `owner${index + 1}@queuecommand.biz`,
      evidence: "Public listing has no website, recent menu photos and a visible public owner email.",
      painPoint: "Needs menu capture and follow-up.",
      estimatedOfferUsd: 3600,
      status: "research" as const,
      verificationStatus: "verified_public" as const,
      publicEvidenceVerified: true,
      approvalToImport: false,
    })),
  });

  const packet = buildRevenueFirstMoneyCommandCenter({ mode: "first-sprint", json: false });

  assert.equal(packet.counts.publicCandidates, 12);
  assert.equal(packet.counts.reviewablePublicCandidates, 12);
  assert.equal(packet.nextCommand.id, "candidate-review");
});

test("first-money command center excludes demo and placeholder candidates from actionable counts", () => {
  recordRevenuePublicScoutRun({
    area: "Miami",
    niche: "coffee shop",
    offerFocus: "websites",
    scoutRunId: "command-center-demo-filter",
    dailyResearchTarget: 20,
    dailyQualifiedLeadLimit: 5,
    dailyMockupLimit: 2,
    dailyContactLimit: 0,
    maxPaidDataSpendUsd: 0,
    requireRobertApprovalToContact: true,
    writePreviewFiles: false,
    candidates: [
      {
        businessName: "Sample Demo Cafe",
        area: "Miami",
        niche: "coffee shop",
        websiteStatus: "no_website",
        contactChannel: "email",
        contactValue: "owner@demo.example.com",
        sourceUrl: "https://example.com/placeholder-cafe",
        recipientEmail: "owner@demo.example.com",
        evidence: "Public listing has no website, recent menu photos and a visible public owner email.",
        painPoint: "Needs menu capture and follow-up.",
        estimatedOfferUsd: 3600,
        status: "research",
        verificationStatus: "verified_public",
        publicEvidenceVerified: true,
        approvalToImport: false,
      },
      {
        businessName: "Test Command Cafe",
        area: "Miami",
        niche: "coffee shop",
        websiteStatus: "no_website",
        contactChannel: "email",
        contactValue: "owner@testcommand.biz",
        sourceUrl: "https://public-directory.invalid/test-command-cafe",
        recipientEmail: "owner@testcommand.biz",
        evidence: "Public listing has no website, recent menu photos and a visible public owner email.",
        painPoint: "Needs menu capture and follow-up.",
        estimatedOfferUsd: 3600,
        status: "research",
        verificationStatus: "verified_public",
        publicEvidenceVerified: true,
        approvalToImport: false,
      },
    ],
  });

  const packet = buildRevenueFirstMoneyCommandCenter({ mode: "first-sprint", json: false });
  const text = formatRevenueFirstMoneyCommandCenterText(packet);

  assert.equal(packet.counts.publicCandidates, 0);
  assert.equal(packet.counts.excludedDemoPublicCandidates, 2);
  assert.equal(packet.counts.reviewablePublicCandidates, 0);
  assert.equal(packet.nextCommand.id, "public-scout");
  assert.match(text, /Excluded demo\/test public candidates: 2/);
});

test("first-money command center routes existing drafts to outreach review", () => {
  createDraft("draft");
  const packet = buildRevenueFirstMoneyCommandCenter({ mode: "first-sprint", json: false });
  const outreachCommand = packet.queue.find((item) => item.id === "outreach-review");

  assert.equal(packet.nextCommand.id, "outreach-review");
  assert.equal(packet.counts.reviewableOutreachDrafts, 1);
  assert.equal(outreachCommand?.status, "review");
  assert.match(outreachCommand?.command || "", /revenue:outreach-approval-packet/);
});

test("first-money command center includes website handoff command for approved draft", () => {
  const draft = createDraft("approved");
  const packet = buildRevenueFirstMoneyCommandCenter({ mode: "first-sprint", json: false });
  const websiteCommand = packet.queue.find((item) => item.id === "website-handoff");

  assert.equal(packet.nextCommand.id, "outreach-review");
  assert.equal(packet.counts.approvedOutreachDrafts, 1);
  assert.equal(websiteCommand?.status, "blocked");
  assert.match(websiteCommand?.command || "", new RegExp(draft.id));
  assert.match(websiteCommand?.command || "", /revenue:website-creation-approval-decision/);
  assert.doesNotMatch(websiteCommand?.command || "", /--approval-decision-id=/);
});

test("first-money command center script reads persisted outreach drafts", () => {
  createDraft("draft");
  const result = spawnSync(process.execPath, [
    "--import",
    "tsx",
    "script/revenue-first-money-command-center.ts",
  ], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      REVENUE_ENGINE_LEADS_PATH: testLeadsPath,
      REVENUE_ENGINE_OUTREACH_PATH: testOutreachPath,
      REVENUE_ENGINE_PUBLIC_LEAD_CANDIDATES_PATH: testPublicCandidatesPath,
    },
    encoding: "utf8",
  });

  assert.equal(result.status, 0);
  assert.match(result.stdout, /Revenue first-money command center:/);
  assert.match(result.stdout, /Review outreach drafts/);
  assert.match(result.stdout, /Reviewable outreach drafts: 1/);
  assert.doesNotMatch(result.stdout, /Sends outreach: yes/);
});
