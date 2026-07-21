import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
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

function writePublicVerificationFixture(slug: string, content = slug) {
  const relativePath = `public-verification/${slug}.md`;
  const filePath = path.join(process.cwd(), "revenue_workspace", relativePath);
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `# Public verification\n\nApproval status: approved_by_robert\n${content}\n`, "utf8");
  return `revenue_workspace/${relativePath}`;
}

function createDraft(approvalStatus: "draft" | "approved" = "draft") {
  return recordRevenueOutreachDraft({
    channel: "email",
    approvalStatus,
    recipientEmail: "owner@commandcenter.example",
    contactName: "Owner",
    businessName: approvalStatus === "approved" ? "Approved Command Cafe" : "Draft Command Cafe",
    sourceUrl: "https://example.com/command-center-cafe",
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
  assert.equal(packet.queue.some((item) => item.id === "public-scout" && item.command.includes("revenue:browser-scout-session")), true);
  assert.match(packet.nextCommand.command, /--capture=revenue_workspace\/public-scout\/first-money-capture-template\.json/);
  assert.match(packet.nextCommand.command, /--notes=revenue_workspace\/public-scout\/first-money-public-notes\.txt/);
  assert.match(packet.nextCommand.command, /--extracted-output=revenue_workspace\/public-scout\/first-money-extracted-candidates\.json/);
  assert.doesNotMatch(packet.nextCommand.command, /--overwrite/);
  assert.equal(packet.safety.writesFiles, true);
  assert.equal(packet.safety.writesLocalEvidenceFiles, true);
  assert.equal(packet.safety.writesPreviewFiles, false);
  assert.equal(packet.safety.persistsLeads, false);
  assert.equal(packet.safety.sendsOutreach, false);
  assert.equal(packet.safety.chargesClients, false);
  assert.equal(packet.safety.deploys, false);
  assert.equal(getRevenueFirstMoneyCommandCenterExitCode(packet), 0);
  assert.match(text, /Revenue first-money command center:/);
  assert.match(text, /Find businesses/);
  assert.match(text, /trusted browser scout handoff/);
  assert.match(text, /Writes local evidence files: yes/);
  assert.match(text, /Writes preview files: no/);
  assert.match(text, /Persists final leads: no/);
});

test("first-money command center prioritizes captured candidate review", () => {
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
        contactChannel: "email",
        contactValue: "capturedcommandcafe@gmail.com",
        sourceUrl: "https://www.leadsbylocation.com/leads/coffee-shops/miami-florida/",
        recipientEmail: "capturedcommandcafe@gmail.com",
        evidence: "Public listing has no website, recent menu photos and a visible public owner email.",
        painPoint: "Needs menu capture and follow-up.",
        estimatedOfferUsd: 3600,
        status: "research",
        verificationStatus: "verified_public",
        publicEvidenceVerified: true,
        publicEvidenceVerificationRef: writePublicVerificationFixture(
          "captured-command-cafe",
          "Captured Command Cafe https://www.leadsbylocation.com/leads/coffee-shops/miami-florida/ capturedcommandcafe@gmail.com",
        ),
        publicEvidenceVerifiedBy: "robert",
        approvalToImport: true,
      },
    ],
  });

  const packet = buildRevenueFirstMoneyCommandCenter({ mode: "first-sprint", json: false });
  const reviewCommand = packet.queue.find((item) => item.id === "candidate-review");

  assert.equal(packet.nextCommand.id, "candidate-review");
  assert.equal(packet.counts.reviewablePublicCandidates, 1);
  assert.equal(packet.counts.syntheticPublicCandidates, 0);
  assert.equal(reviewCommand?.status, "review");
  assert.match(reviewCommand?.command || "", /revenue:public-candidate-review/);
  assert.doesNotMatch(reviewCommand?.command || "", /--approved-by-robert/);
  assert.match(reviewCommand?.reason || "", /add --approved-by-robert only after Robert explicitly approves/);
});

test("first-money command center routes captured candidates through verification artifact first", () => {
  recordRevenuePublicScoutRun({
    area: "Miami",
    niche: "beauty",
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
        businessName: "Needs Evidence Salon",
        area: "Miami",
        niche: "beauty salon",
        websiteStatus: "weak_website",
        contactChannel: "email",
        contactValue: "booking@needsevidencesalon.com",
        sourceUrl: "https://needsevidencesalon.com/contact",
        recipientEmail: "booking@needsevidencesalon.com",
        evidence: "Public contact page has visible email and a weak booking path.",
        painPoint: "Needs stronger booking CTA and local conversion flow.",
        estimatedOfferUsd: 3500,
        status: "research",
        verificationStatus: "needs_review",
        publicEvidenceVerified: false,
        approvalToImport: true,
      },
    ],
  });

  const packet = buildRevenueFirstMoneyCommandCenter({ mode: "first-sprint", json: false });
  const verificationCommand = packet.queue.find((item) => item.id === "candidate-verification-artifact");

  assert.equal(packet.nextCommand.id, "candidate-verification-artifact");
  assert.equal(packet.counts.needsEvidenceReviewPublicCandidates, 1);
  assert.equal(packet.counts.verifiedPublicCandidates, 0);
  assert.equal(verificationCommand?.status, "review");
  assert.match(verificationCommand?.command || "", /revenue:public-candidate-verification-artifact/);
  assert.match(verificationCommand?.command || "", /--output=revenue_workspace\/public-verification\/first-money-/);
  assert.doesNotMatch(verificationCommand?.command || "", /--approved-by-robert/);
  assert.match(verificationCommand?.reason || "", /after Robert accepts it/);
});

test("first-money command center ignores synthetic public candidates", () => {
  recordRevenuePublicScoutRun({
    area: "Miami",
    niche: "coffee shop",
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
        businessName: "CLI Smoke Cafe",
        area: "Miami",
        niche: "coffee shop",
        websiteStatus: "no_website",
        contactChannel: "email",
        contactValue: "owner@clismoke.example",
        sourceUrl: "https://example.com/cli-smoke-cafe",
        recipientEmail: "owner@clismoke.example",
        evidence: "Synthetic smoke candidate should not drive the money command center.",
        painPoint: "Needs to be ignored.",
        estimatedOfferUsd: 3500,
        status: "research",
        verificationStatus: "verified_public",
        publicEvidenceVerified: true,
        publicEvidenceVerificationRef: writePublicVerificationFixture(
          "cli-smoke-cafe",
          "CLI Smoke Cafe https://example.com/cli-smoke-cafe owner@clismoke.example",
        ),
        publicEvidenceVerifiedBy: "robert",
        approvalToImport: true,
      },
    ],
  });

  const packet = buildRevenueFirstMoneyCommandCenter({ mode: "first-sprint", json: false });

  assert.equal(packet.nextCommand.id, "public-scout");
  assert.equal(packet.counts.publicCandidates, 1);
  assert.equal(packet.counts.syntheticPublicCandidates, 1);
  assert.equal(packet.counts.reviewablePublicCandidates, 0);
  assert.doesNotMatch(packet.nextCommand.command, /public-candidate-review/);
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
  assert.match(websiteCommand?.command || "", /revenue:premium-website-work-order/);
  assert.match(websiteCommand?.command || "", /--target-repo=OWNER\/REPO/);
  assert.doesNotMatch(websiteCommand?.command || "", /_REF/);
  assert.doesNotMatch(websiteCommand?.command || "", /--robert-approved-build/);
  assert.doesNotMatch(websiteCommand?.command || "", /--deposit-paid/);
  assert.match(websiteCommand?.reason || "", /needs real Robert approval, client scope, deposit and public verification evidence refs|publish gates are proven with evidence/);
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
