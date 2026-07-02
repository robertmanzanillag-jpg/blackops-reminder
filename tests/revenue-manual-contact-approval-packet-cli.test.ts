import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import {
  recordRevenuePublicScoutRun,
  resetRevenuePublicLeadCandidatesForTests,
  setRevenuePublicLeadCandidatesPathForTests,
} from "../server/revenue-engine";
import {
  buildRevenueManualContactApprovalPacketFromCli,
  formatRevenueManualContactApprovalPacketText,
  getRevenueManualContactApprovalPacketExitCode,
  parseRevenueManualContactApprovalPacketArgs,
  validateRevenueManualContactApprovalPacketOptions,
} from "../server/revenue-manual-contact-approval-packet-cli";

const testPublicCandidatesPath = "/tmp/revenue-manual-contact-approval-packet-public-candidates-test.json";

setRevenuePublicLeadCandidatesPathForTests(testPublicCandidatesPath);

test.afterEach(() => {
  resetRevenuePublicLeadCandidatesForTests();
});

function captureCandidates() {
  return recordRevenuePublicScoutRun({
    area: "Miami",
    niche: "hair salon",
    offerFocus: "websites",
    scoutRunId: "manual-contact-approval-packet",
    dailyResearchTarget: 20,
    dailyQualifiedLeadLimit: 5,
    dailyMockupLimit: 2,
    dailyContactLimit: 0,
    maxPaidDataSpendUsd: 0,
    requireRobertApprovalToContact: true,
    writePreviewFiles: false,
    candidates: [
      {
        businessName: "Manual Ready Salon",
        area: "Miami",
        niche: "hair salon",
        websiteStatus: "no_website",
        contactChannel: "phone",
        contactValue: "305-555-0199",
        sourceUrl: "https://public-directory.invalid/manual-ready-salon",
        recipientEmail: "",
        evidence: "Public listing has no website, recent hair service photos and a visible phone number.",
        painPoint: "Needs booking capture and a clearer service menu.",
        estimatedOfferUsd: 3600,
        status: "research",
        verificationStatus: "verified_public",
        publicEvidenceVerified: true,
        approvalToImport: false,
      },
      {
        businessName: "Email Ready Salon",
        area: "Miami",
        niche: "hair salon",
        websiteStatus: "no_website",
        contactChannel: "email",
        contactValue: "owner@emailreadysalon.biz",
        sourceUrl: "https://public-directory.invalid/email-ready-salon",
        recipientEmail: "owner@emailreadysalon.biz",
        evidence: "Public listing has no website, recent hair service photos and a visible owner email.",
        painPoint: "Needs booking capture and a clearer service menu.",
        estimatedOfferUsd: 3600,
        status: "research",
        verificationStatus: "verified_public",
        publicEvidenceVerified: true,
        approvalToImport: false,
      },
      {
        businessName: "Unverified Phone Salon",
        area: "Miami",
        niche: "hair salon",
        websiteStatus: "no_website",
        contactChannel: "phone",
        contactValue: "305-555-0200",
        sourceUrl: "https://public-directory.invalid/unverified-phone-salon",
        recipientEmail: "",
        evidence: "Public listing needs a second source before contact.",
        painPoint: "Needs booking capture.",
        estimatedOfferUsd: 3600,
        status: "research",
        verificationStatus: "needs_review",
        publicEvidenceVerified: false,
        approvalToImport: false,
      },
      {
        businessName: "Sample Demo Salon",
        area: "Miami",
        niche: "hair salon",
        websiteStatus: "no_website",
        contactChannel: "phone",
        contactValue: "305-555-0201",
        sourceUrl: "https://example.com/demo-salon",
        recipientEmail: "",
        evidence: "Public listing has no website and visible phone number.",
        painPoint: "Needs booking capture.",
        estimatedOfferUsd: 3600,
        status: "research",
        verificationStatus: "verified_public",
        publicEvidenceVerified: true,
        approvalToImport: false,
      },
    ],
  });
}

test("parses and validates manual contact approval packet options", () => {
  assert.deepEqual(parseRevenueManualContactApprovalPacketArgs([]), { maxCandidates: 10, json: false });
  assert.deepEqual(parseRevenueManualContactApprovalPacketArgs(["--max-candidates=7", "--json"]), {
    maxCandidates: 7,
    json: true,
  });
  assert.deepEqual(validateRevenueManualContactApprovalPacketOptions(parseRevenueManualContactApprovalPacketArgs(["--max-candidates=0"])), [
    "--max-candidates must be an integer from 1 to 50.",
  ]);
});

test("manual contact approval packet lists only verified manual-only candidates", () => {
  captureCandidates();

  const packet = buildRevenueManualContactApprovalPacketFromCli({ maxCandidates: 10, json: false });
  const text = formatRevenueManualContactApprovalPacketText(packet);

  assert.equal(packet.status, "ready_for_robert_manual_contact_review");
  assert.equal(packet.manualContactCount, 1);
  assert.equal(packet.items[0].businessName, "Manual Ready Salon");
  assert.equal(packet.items[0].contactChannel, "phone");
  assert.equal(packet.items[0].readyForRobertApproval, true);
  assert.match(packet.items[0].requiredBeforeContact.join(" "), /Robert must explicitly approve manual contact/);
  assert.equal(packet.safety.persistsData, false);
  assert.equal(packet.safety.importsLeads, false);
  assert.equal(packet.safety.sendsOutreach, false);
  assert.equal(packet.safety.writesPreviewFiles, false);
  assert.equal(packet.safety.paidDataSpendUsd, 0);
  assert.equal(packet.safety.requiresRobertApprovalBeforeContact, true);
  assert.equal(getRevenueManualContactApprovalPacketExitCode(packet), 0);
  assert.match(text, /Manual Ready Salon/);
  assert.doesNotMatch(text, /Email Ready Salon/);
  assert.doesNotMatch(text, /Unverified Phone Salon/);
  assert.doesNotMatch(text, /Sample Demo Salon/);
  assert.match(text, /Sends outreach: no/);
});

test("manual contact approval packet reports total manual count even when items are capped", () => {
  recordRevenuePublicScoutRun({
    area: "Miami",
    niche: "hair salon",
    offerFocus: "websites",
    scoutRunId: "manual-contact-approval-packet-capped",
    dailyResearchTarget: 20,
    dailyQualifiedLeadLimit: 12,
    dailyMockupLimit: 2,
    dailyContactLimit: 0,
    maxPaidDataSpendUsd: 0,
    requireRobertApprovalToContact: true,
    writePreviewFiles: false,
    candidates: Array.from({ length: 12 }, (_, index) => ({
      businessName: `Manual Ready Salon ${index + 1}`,
      area: "Miami",
      niche: "hair salon",
      websiteStatus: "no_website" as const,
      contactChannel: "phone" as const,
      contactValue: `305-555-${String(1000 + index)}`,
      sourceUrl: `https://public-directory.invalid/manual-ready-salon-${index + 1}`,
      recipientEmail: "",
      evidence: "Public listing has no website, recent hair service photos and a visible phone number.",
      painPoint: "Needs booking capture and a clearer service menu.",
      estimatedOfferUsd: 3600,
      status: "research" as const,
      verificationStatus: "verified_public" as const,
      publicEvidenceVerified: true,
      approvalToImport: false,
    })),
  });

  const packet = buildRevenueManualContactApprovalPacketFromCli({ maxCandidates: 10, json: false });

  assert.equal(packet.manualContactCount, 12);
  assert.equal(packet.items.length, 10);
  assert.equal(packet.reviewed, 12);
});

test("manual contact approval packet script reads persisted public candidates", () => {
  captureCandidates();
  const result = spawnSync(process.execPath, [
    "--import",
    "tsx",
    "script/revenue-manual-contact-approval-packet.ts",
    "--json",
  ], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      REVENUE_ENGINE_PUBLIC_LEAD_CANDIDATES_PATH: testPublicCandidatesPath,
    },
    encoding: "utf8",
    maxBuffer: 10 * 1024 * 1024,
  });

  assert.equal(result.error, undefined);
  assert.equal(result.status, 0);
  assert.equal(result.stderr, "");
  const packet = JSON.parse(result.stdout);
  assert.equal(packet.manualContactCount, 1);
  assert.equal(packet.items[0].businessName, "Manual Ready Salon");
  assert.equal(packet.safety.sendsOutreach, false);
  assert.equal(packet.safety.importsLeads, false);
});

test("manual contact approval packet exits blocked when no manual candidates are ready", () => {
  const result = spawnSync(process.execPath, [
    "--import",
    "tsx",
    "script/revenue-manual-contact-approval-packet.ts",
  ], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      REVENUE_ENGINE_PUBLIC_LEAD_CANDIDATES_PATH: testPublicCandidatesPath,
    },
    encoding: "utf8",
  });

  assert.equal(result.status, 1);
  assert.match(result.stdout, /Manual contact candidates: 0/);
  assert.match(result.stdout, /Sends outreach: no/);
});
