import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";
import {
  recordRevenueOutreachDraft,
  recordRevenuePublicScoutRun,
  recordRevenueTrustedApprovalDecision,
  resetRevenueApprovalDecisionsForTests,
  resetRevenueLeadsForTests,
  resetRevenueOutreachForTests,
  resetRevenuePublicLeadCandidatesForTests,
  setRevenueApprovalDecisionsPathForTests,
  setRevenueLeadsPathForTests,
  setRevenueOutreachPathForTests,
  setRevenuePublicLeadCandidatesPathForTests,
} from "../server/revenue-engine";
import {
  buildRevenuePaymentPathApprovalTargetId,
  buildRevenuePaymentPathSnapshotHash,
} from "../server/revenue-payment-path-approval";
import {
  buildRevenueFirstMoneyCommandCenter,
  buildRevenueFirstMoneyCommandCenterSummary,
  formatRevenueFirstMoneyCommandCenterText,
  getRevenueFirstMoneyCommandCenterExitCode,
  parseRevenueFirstMoneyCommandCenterArgs,
  validateRevenueFirstMoneyCommandCenterOptions,
} from "../server/revenue-first-money-command-center-cli";
import { buildRevenuePublicCandidateApprovalDecisionFromCli } from "../server/revenue-public-candidate-approval-decision-cli";

const testLeadsPath = "/tmp/revenue-first-money-command-center-leads-test.json";
const testOutreachPath = "/tmp/revenue-first-money-command-center-outreach-test.json";
const testPublicCandidatesPath = "/tmp/revenue-first-money-command-center-public-candidates-test.json";
const testApprovalDecisionsPath = "/tmp/revenue-first-money-command-center-approval-decisions-test.json";

const originalEnv = {
  DATABASE_URL: process.env.DATABASE_URL,
  SESSION_SECRET: process.env.SESSION_SECRET,
  REVENUE_ENGINE_MONEY_MODE: process.env.REVENUE_ENGINE_MONEY_MODE,
  REVENUE_ENGINE_PAYMENT_LINK: process.env.REVENUE_ENGINE_PAYMENT_LINK,
  REVENUE_ENGINE_PAYMENT_PATH_APPROVAL_DECISION_ID: process.env.REVENUE_ENGINE_PAYMENT_PATH_APPROVAL_DECISION_ID,
  REVENUE_ENGINE_PAYMENT_EXPECTED_DEPOSIT_USD: process.env.REVENUE_ENGINE_PAYMENT_EXPECTED_DEPOSIT_USD,
  REVENUE_ENGINE_PAYMENT_EXPECTED_PACKAGE: process.env.REVENUE_ENGINE_PAYMENT_EXPECTED_PACKAGE,
  REVENUE_ENGINE_PAYMENT_EVIDENCE_URL: process.env.REVENUE_ENGINE_PAYMENT_EVIDENCE_URL,
  REVENUE_ENGINE_PAYMENT_EVIDENCE_NOTE: process.env.REVENUE_ENGINE_PAYMENT_EVIDENCE_NOTE,
  REVENUE_ENGINE_PAYMENT_LINK_APPROVED_BY_ROBERT: process.env.REVENUE_ENGINE_PAYMENT_LINK_APPROVED_BY_ROBERT,
  REVENUE_ENGINE_PAYMENT_SMOKE_VERIFIED: process.env.REVENUE_ENGINE_PAYMENT_SMOKE_VERIFIED,
  REVENUE_ENGINE_DEPLOY_APPROVED_BY_ROBERT: process.env.REVENUE_ENGINE_DEPLOY_APPROVED_BY_ROBERT,
  REVENUE_ENGINE_WEBSITE_DEPLOY_ENABLED: process.env.REVENUE_ENGINE_WEBSITE_DEPLOY_ENABLED,
  REVENUE_ENGINE_WEBSITE_APP_QA_TARGET_PASSED: process.env.REVENUE_ENGINE_WEBSITE_APP_QA_TARGET_PASSED,
  REVENUE_ENGINE_WEBSITE_PREVIEW_DEPLOY_VERIFIED: process.env.REVENUE_ENGINE_WEBSITE_PREVIEW_DEPLOY_VERIFIED,
  REVENUE_ENGINE_WEBSITE_ROLLBACK_VERIFIED: process.env.REVENUE_ENGINE_WEBSITE_ROLLBACK_VERIFIED,
  REVENUE_ENGINE_WEBSITE_PUBLISH_APPROVED_BY_ROBERT: process.env.REVENUE_ENGINE_WEBSITE_PUBLISH_APPROVED_BY_ROBERT,
};

setRevenueApprovalDecisionsPathForTests(testApprovalDecisionsPath);
setRevenueLeadsPathForTests(testLeadsPath);
setRevenueOutreachPathForTests(testOutreachPath);
setRevenuePublicLeadCandidatesPathForTests(testPublicCandidatesPath);

test.afterEach(() => {
  for (const [key, value] of Object.entries(originalEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  resetRevenueApprovalDecisionsForTests();
  resetRevenueLeadsForTests();
  resetRevenueOutreachForTests();
  resetRevenuePublicLeadCandidatesForTests();
});

function approveCommandCenterPaymentPath(paymentLink = "https://buy.stripe.com/revenue-deposit") {
  process.env.REVENUE_ENGINE_PAYMENT_LINK = paymentLink;
  process.env.REVENUE_ENGINE_PAYMENT_LINK_APPROVED_BY_ROBERT = "true";
  process.env.REVENUE_ENGINE_PAYMENT_SMOKE_VERIFIED = "true";
  process.env.REVENUE_ENGINE_PAYMENT_EXPECTED_DEPOSIT_USD = "1500";
  process.env.REVENUE_ENGINE_PAYMENT_EXPECTED_PACKAGE = "Website 3D Premium";
  process.env.REVENUE_ENGINE_PAYMENT_EVIDENCE_URL = "https://github.com/example/repo/actions/runs/123";
  process.env.REVENUE_ENGINE_PAYMENT_EVIDENCE_NOTE = "Stripe payment link smoke test passed";
  const snapshot = {
    paymentMethod: "payment_link" as const,
    paymentLink,
    paymentHost: new URL(paymentLink).hostname.toLowerCase(),
    expectedDepositUsd: 1500,
    expectedPackage: "Website 3D Premium",
  };
  const proof = {
    robertApprovedPaymentPath: true,
    paymentSmokeVerified: true,
    depositConfirmedByRobert: false,
    paymentLink,
    evidenceUrl: process.env.REVENUE_ENGINE_PAYMENT_EVIDENCE_URL,
    evidenceNote: process.env.REVENUE_ENGINE_PAYMENT_EVIDENCE_NOTE,
  };
  const result = recordRevenueTrustedApprovalDecision({
    targetId: buildRevenuePaymentPathApprovalTargetId(paymentLink),
    targetType: "payment_path",
    decision: "approved",
    approvedAction: "Approve exact payment path for command center test.",
    maxSpendUsd: 0,
    notes: proof.evidenceNote,
    approvalSource: "payment_path_approval_cli",
    publicCandidateSnapshotHash: "",
    outreachDraftSnapshotHash: "",
    websiteCreationSnapshotHash: "",
    websitePublishSnapshotHash: "",
    paymentPathSnapshotHash: buildRevenuePaymentPathSnapshotHash(snapshot, proof),
    ledgerEntrySnapshotHash: "",
  });
  process.env.REVENUE_ENGINE_PAYMENT_PATH_APPROVAL_DECISION_ID = result.decision.id;
}

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
  assert.equal(packet.queue.some((item) => item.id === "public-scout" && item.command.includes("--browser-executor=subagent_browser")), true);
  assert.equal(packet.setupCommands.length, 6);
  assert.deepEqual(packet.setupCommands.map((item) => item.id), [
    "contact-path-approval",
    "contact-path-readiness",
    "payment-path-approval",
    "payment-path-readiness",
    "ledger-entry-approval",
    "website-creation-approval",
  ]);
  assert.equal(packet.setupCommands.every((item) => item.status === "blocked"), true);
  assert.equal(packet.setupCommands.some((item) => item.command.includes("/api/revenue-engine/contact-path-approval-pending-action")), true);
  assert.equal(packet.setupCommands.some((item) => item.command.includes("/api/revenue-engine/payment-path-approval-pending-action")), true);
  assert.equal(packet.setupCommands.some((item) => item.command.includes("/api/revenue-engine/ledger-entry-approval-pending-action")), true);
  assert.equal(packet.setupCommands.some((item) => item.command.includes("/api/revenue-engine/website-creation-approval-pending-action")), true);
  assert.equal(packet.setupCommands.some((item) => item.command.includes("revenue:contact-path-approval-decision")), false);
  assert.equal(packet.setupCommands.some((item) => item.command.includes("revenue:payment-path-approval-decision")), false);
  assert.equal(packet.setupCommands.some((item) => item.command.includes("revenue:ledger-approval-decision")), false);
  assert.equal(packet.setupCommands.some((item) => item.command.includes("revenue:website-creation-approval-decision")), false);
  assert.equal(packet.setupCommands.some((item) => item.command.includes("real evidenceUrl")), true);
  assert.equal(packet.setupCommands.some((item) => item.command.includes("real HTTPS Stripe paymentLink")), true);
  assert.equal(packet.setupCommands.some((item) => item.command.includes("real paymentEvidence")), true);
  assert.equal(packet.setupCommands.some((item) => item.command.includes("real scope/deposit/public-data notes")), true);
  assert.equal(packet.setupCommands.some((item) => item.command.includes("--send-outreach")), false);
  assert.equal(packet.setupCommands.some((item) => item.command.includes("--charge-client")), false);
  assert.equal(packet.readiness.canAutonomousSearchBusinesses, true);
  assert.equal(packet.readiness.canRunGuardedPublicScoutCapture, true);
  assert.match(packet.nextCommand.reason, /No contact/);
  assert.match(packet.nextCommand.reason, /paid data/);
  assert.match(packet.nextCommand.reason, /lead import/);
  assert.match(packet.nextCommand.reason, /preview publish/);
  assert.match(packet.nextCommand.reason, /client charging/);
  assert.equal(packet.safety.sendsOutreach, false);
  assert.equal(packet.safety.chargesClients, false);
  assert.equal(packet.safety.deploys, false);
  assert.equal(getRevenueFirstMoneyCommandCenterExitCode(packet), 0);
  assert.match(text, /Revenue first-money command center:/);
  assert.match(text, /Capture public business candidates/);
  assert.match(text, /Setup gates:/);
  assert.match(text, /Approve contact path before outreach/);
  assert.match(text, /Approve payment path before charging/);
  assert.match(text, /Approve ledger entry after deposit is collected/);
  assert.match(text, /Approve paid website creation after deposit/);
  assert.match(text, /never sends outreach/);
  assert.match(text, /never charges clients/);
  assert.match(text, /never records the ledger entry/);
  assert.match(text, /never writes files or deploys/);
});

test("first-money setup gate templates cannot persist placeholder approvals", () => {
  const packet = buildRevenueFirstMoneyCommandCenter({ mode: "first-sprint", json: false });
  const contactApprovalCommand = packet.setupCommands.find((item) => item.id === "contact-path-approval");
  const paymentApprovalCommand = packet.setupCommands.find((item) => item.id === "payment-path-approval");
  const ledgerApprovalCommand = packet.setupCommands.find((item) => item.id === "ledger-entry-approval");
  const websiteCreationApprovalCommand = packet.setupCommands.find((item) => item.id === "website-creation-approval");
  assert.ok(contactApprovalCommand);
  assert.ok(paymentApprovalCommand);
  assert.ok(ledgerApprovalCommand);
  assert.ok(websiteCreationApprovalCommand);
  assert.match(contactApprovalCommand.command, /contact-path-approval-pending-action/);
  assert.match(paymentApprovalCommand.command, /payment-path-approval-pending-action/);
  assert.match(ledgerApprovalCommand.command, /ledger-entry-approval-pending-action/);
  assert.match(websiteCreationApprovalCommand.command, /website-creation-approval-pending-action/);
  assert.doesNotMatch(contactApprovalCommand.command, /revenue:contact-path-approval-decision/);
  assert.doesNotMatch(paymentApprovalCommand.command, /revenue:payment-path-approval-decision/);
  assert.doesNotMatch(ledgerApprovalCommand.command, /revenue:ledger-approval-decision/);
  assert.doesNotMatch(websiteCreationApprovalCommand.command, /revenue:website-creation-approval-decision/);
  assert.match(ledgerApprovalCommand.command, /real paymentEvidence/);
  assert.match(websiteCreationApprovalCommand.command, /real scope\/deposit\/public-data notes/);

  const persistedDecisions = existsSync(testApprovalDecisionsPath)
    ? JSON.parse(readFileSync(testApprovalDecisionsPath, "utf8"))
    : [];
  assert.deepEqual(persistedDecisions, []);
});

test("first-money setup readiness templates cannot pass placeholder evidence", () => {
  const packet = buildRevenueFirstMoneyCommandCenter({ mode: "first-sprint", json: false });
  const contactReadinessCommand = packet.setupCommands.find((item) => item.id === "contact-path-readiness");
  const paymentReadinessCommand = packet.setupCommands.find((item) => item.id === "payment-path-readiness");
  assert.ok(contactReadinessCommand);
  assert.ok(paymentReadinessCommand);

  const baseEnv = {
    ...process.env,
    REVENUE_ENGINE_APPROVAL_DECISIONS_PATH: testApprovalDecisionsPath,
  };
  const contactResult = spawnSync("sh", ["-c", contactReadinessCommand.command], {
    cwd: process.cwd(),
    env: {
      ...baseEnv,
      REVENUE_ENGINE_MANUAL_CONTACT_APPROVED: "true",
    },
    encoding: "utf8",
  });
  const paymentResult = spawnSync("sh", ["-c", paymentReadinessCommand.command], {
    cwd: process.cwd(),
    env: baseEnv,
    encoding: "utf8",
  });

  assert.equal(contactResult.status, 1, `${contactResult.stdout}\n${contactResult.stderr}`);
  assert.match(contactResult.stderr, /--evidence-url must be real evidence/);
  assert.match(contactResult.stderr, /--evidence-note must be real proof/);
  assert.equal(paymentResult.status, 1, `${paymentResult.stdout}\n${paymentResult.stderr}`);
  assert.match(paymentResult.stderr, /--evidence-url must be real evidence/);
  assert.match(paymentResult.stderr, /--evidence-note must be real proof/);
});

test("first-money command center keeps ledger gate visible when payment path is ready", () => {
  process.env.DATABASE_URL = "postgres://ceo_user:real-pass@db.internal:5432/blackops";
  process.env.SESSION_SECRET = "a-production-session-secret-32-chars";
  process.env.REVENUE_ENGINE_MONEY_MODE = "live";
  approveCommandCenterPaymentPath();

  const packet = buildRevenueFirstMoneyCommandCenter({ mode: "first-sprint", json: false });
  const setupIds = packet.setupCommands.map((item) => item.id);

  assert.equal(packet.readiness.canCollectMoney, true);
  assert.equal(packet.readiness.canBuildWebsites, false);
  assert.equal(setupIds.includes("payment-path-approval"), false);
  assert.equal(setupIds.includes("payment-path-readiness"), false);
  assert.equal(setupIds.includes("ledger-entry-approval"), true);
  assert.match(packet.setupCommands.find((item) => item.id === "ledger-entry-approval")?.command || "", /\/api\/revenue-engine\/ledger-entry-approval-pending-action/);
  assert.doesNotMatch(packet.setupCommands.find((item) => item.id === "ledger-entry-approval")?.command || "", /revenue:ledger-approval-decision/);
});

test("first-money activation checklist does not mark paid build ready from publish gates alone", () => {
  process.env.DATABASE_URL = "postgres://ceo_user:real-pass@db.internal:5432/blackops";
  process.env.SESSION_SECRET = "a-production-session-secret-32-chars";
  process.env.REVENUE_ENGINE_MONEY_MODE = "live";
  process.env.REVENUE_ENGINE_DEPLOY_APPROVED_BY_ROBERT = "true";
  process.env.REVENUE_ENGINE_WEBSITE_DEPLOY_ENABLED = "true";
  process.env.REVENUE_ENGINE_WEBSITE_APP_QA_TARGET_PASSED = "true";
  process.env.REVENUE_ENGINE_WEBSITE_PREVIEW_DEPLOY_VERIFIED = "true";
  process.env.REVENUE_ENGINE_WEBSITE_ROLLBACK_VERIFIED = "true";
  process.env.REVENUE_ENGINE_WEBSITE_PUBLISH_APPROVED_BY_ROBERT = "true";

  const summary = buildRevenueFirstMoneyCommandCenterSummary({ mode: "first-sprint", json: false });
  const paidBuild = summary.activationChecklist.find((step) => step.id === "paid_build");
  const publish = summary.activationChecklist.find((step) => step.id === "publish");

  assert.equal(summary.readiness.canBuildWebsites, true);
  assert.equal(summary.readiness.canCollectMoney, false);
  assert.equal(paidBuild?.status, "blocked_until_prior_step");
  assert.equal(paidBuild?.action.includes("payment path"), true);
  assert.equal(publish?.status, "needs_robert_approval");
});

test("first-money activation checklist keeps paid build evidence-gated after payment and approved draft", () => {
  process.env.REVENUE_ENGINE_MONEY_MODE = "live";
  approveCommandCenterPaymentPath();
  createDraft("approved");

  const summary = buildRevenueFirstMoneyCommandCenterSummary({ mode: "first-sprint", json: false });
  const payment = summary.activationChecklist.find((step) => step.id === "payment_path");
  const paidBuild = summary.activationChecklist.find((step) => step.id === "paid_build");

  assert.equal(summary.readiness.canCollectMoney, true);
  assert.equal(payment?.status, "ready_now");
  assert.equal(paidBuild?.status, "blocked_until_evidence");
  assert.equal(paidBuild?.safety.includes("not written"), true);
});

test("first-money command center prioritizes public contact verification for unverified candidates", () => {
  recordRevenuePublicScoutRun({
    area: "Miami 786-555-1212",
    niche: "coffee shop https://niche.example/private",
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
      {
        businessName: "Spoof owner@captured.biz https://private.example/source",
        area: "Miami 786-555-0199",
        niche: "coffee shop https://directory.invalid/source",
        websiteStatus: "no_website",
        contactChannel: "unknown",
        contactValue: "",
        sourceUrl: "https://public-directory.invalid/spoof-captured-command-cafe",
        recipientEmail: "",
        evidence: "Public listing has no website and includes owner@captured.biz.",
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
  const summary = buildRevenueFirstMoneyCommandCenterSummary({ mode: "first-sprint", json: false });
  const verificationCommand = packet.queue.find((item) => item.id === "candidate-verification");
  const serializedSummary = JSON.stringify(summary);

  assert.equal(packet.nextCommand.id, "candidate-verification");
  assert.equal(packet.counts.verificationNeededPublicCandidates, 2);
  assert.equal(packet.counts.reviewablePublicCandidates, 0);
  assert.equal(verificationCommand?.status, "review");
  assert.match(verificationCommand?.command || "", /revenue:public-contact-verification/);
  assert.doesNotMatch(verificationCommand?.command || "", /--approved-by-robert/);
  assert.equal(packet.candidateVerificationQueue.length, 2);
  assert.equal(packet.candidateVerificationQueue[0].businessName, "Captured Command Cafe");
  assert.equal(packet.candidateVerificationQueue[1].businessName, "Spoof [contact] [source]");
  assert.equal(packet.candidateVerificationQueue[1].area, "Miami [phone]");
  assert.equal(packet.candidateVerificationQueue[1].niche, "coffee shop [source]");
  assert.equal(packet.candidateVerificationQueue[0].safety.importsLeads, false);
  assert.equal(packet.candidateVerificationQueue[0].safety.sendsOutreach, false);
  assert.equal(summary.nextCandidateVerification?.businessName, "Captured Command Cafe");
  assert.equal(summary.candidateVerificationQueue.length, 2);
  assert.equal(summary.activationChecklist[0].id, "candidate_verification");
  assert.equal(summary.activationChecklist[0].status, "ready_now");
  assert.match(summary.activationChecklist[0].commandHint, /revenue:public-contact-verification/);
  assert.equal(summary.counts.verificationNeededPublicCandidates, 2);
  assert.doesNotMatch(serializedSummary, /public-directory\.invalid\/captured-command-cafe/);
  assert.doesNotMatch(serializedSummary, /private\.example\/source/);
  assert.doesNotMatch(serializedSummary, /directory\.invalid\/source/);
  assert.doesNotMatch(serializedSummary, /owner@captured\.biz/);
  assert.doesNotMatch(serializedSummary, /786-555-0199/);
  assert.doesNotMatch(serializedSummary, /Public listing has no website/);
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
  const text = formatRevenueFirstMoneyCommandCenterText(packet);
  const reviewCommand = packet.queue.find((item) => item.id === "candidate-review");
  const scoutCommand = packet.queue.find((item) => item.id === "public-scout");

  assert.equal(packet.nextCommand.id, "candidate-review");
  assert.equal(packet.counts.verificationNeededPublicCandidates, 0);
  assert.equal(packet.counts.reviewablePublicCandidates, 1);
  assert.equal(reviewCommand?.status, "review");
  assert.equal(scoutCommand?.status, "ready");
  assert.match(scoutCommand?.command || "", /revenue:public-scout-schedule/);
  assert.match(scoutCommand?.command || "", /--browser-executor=subagent_browser/);
  assert.match(scoutCommand?.reason || "", /Keep filling the pipeline in parallel/);
  assert.match(scoutCommand?.reason || "", /No contact, paid data, lead import, preview publish, or client charging/);
  assert.match(reviewCommand?.command || "", /Revenue Engine Trust Center approval action/);
  assert.match(reviewCommand?.command || "", /APPROVE PUBLIC CANDIDATES candidate-review-1/);
  assert.doesNotMatch(reviewCommand?.command || "", /revenue:public-candidate-approval-decision/);
  assert.doesNotMatch(reviewCommand?.command || "", /--confirmed-by-robert/);
  assert.equal(packet.candidateApprovalBatches[0].candidates[0].businessName, "Verified Command Cafe");
  assert.equal(packet.candidateApprovalBatches[0].candidates[0].recipientEmail, "owner@verifiedcommand.biz");
  assert.equal(packet.candidateApprovalBatches[0].totalEstimatedOfferUsd, 3600);
  assert.deepEqual(packet.candidateApprovalBatches[0].approvalSafety, {
    persistsApprovalDecision: true,
    importsLeads: false,
    sendsOutreach: false,
    writesPreviewFiles: false,
    chargesClients: false,
    deploys: false,
    paidDataSpendUsd: 0,
  });
  assert.match(packet.candidateApprovalBatches[0].candidates[0].evidence, /visible public owner email/);
  assert.match(text, /Verified Command Cafe \(no_website\)/);
  assert.match(text, /estimated offer total \$3600/);
  assert.match(text, /Approval safety: persistsApprovalDecision=yes; importsLeads=no; sendsOutreach=no; writesPreviewFiles=no; chargesClients=no; deploys=no; paidDataSpend=\$0/);
  assert.match(text, /Contact channel: email/);
  assert.match(text, /Contact value: owner@verifiedcommand\.biz/);
  assert.match(text, /Recipient email: owner@verifiedcommand\.biz/);
  assert.match(text, /Source: https:\/\/public-directory\.invalid\/verified-command-cafe/);
  assert.match(text, /Evidence: Public listing has no website, recent menu photos and a visible public owner email\./);
  assert.match(text, /Pain point: Needs menu capture and follow-up\./);
  assert.match(text, /Estimated offer: \$3600/);
});

test("first-money command center summary omits candidate contact detail payloads", () => {
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
        businessName: "Summary Privacy Cafe",
        area: "Miami",
        niche: "coffee shop",
        websiteStatus: "no_website",
        contactChannel: "email",
        contactValue: "owner@summaryprivacy.biz",
        sourceUrl: "https://public-directory.invalid/summary-privacy-cafe",
        recipientEmail: "owner@summaryprivacy.biz",
        evidence: "Public listing has no website, recent menu photos and a visible public owner email.",
        painPoint: "Needs menu capture and follow-up.",
        estimatedOfferUsd: 3600,
        status: "research",
        verificationStatus: "verified_public",
        publicEvidenceVerified: true,
        approvalToImport: false,
      },
      {
        businessName: "Summary Privacy Salon",
        area: "Miami",
        niche: "hair salon",
        websiteStatus: "weak_website",
        contactChannel: "email",
        contactValue: "owner@summarysalon.biz",
        sourceUrl: "https://public-directory.invalid/summary-privacy-salon",
        recipientEmail: "owner@summarysalon.biz",
        evidence: "Public directory profile shows weak website and a visible salon owner email.",
        painPoint: "Needs booking CTA and service menu cleanup.",
        estimatedOfferUsd: 2400,
        status: "research",
        verificationStatus: "verified_public",
        publicEvidenceVerified: true,
        approvalToImport: false,
      },
    ],
  });

  const summary = buildRevenueFirstMoneyCommandCenterSummary({ mode: "first-sprint", json: false });
  const serialized = JSON.stringify(summary);

  assert.equal(summary.nextCommand.id, "candidate-review");
  assert.equal(summary.readiness.canAutonomousSearchBusinesses, true);
  assert.equal(summary.readiness.canRunGuardedPublicScoutCapture, true);
  assert.equal(summary.robertApprovalBrief.status, "needs_robert_candidate_approval");
  assert.equal(summary.robertApprovalBrief.totalBatches, 2);
  assert.equal(summary.robertApprovalBrief.totalCandidates, 2);
  assert.equal(summary.robertApprovalBrief.totalEstimatedOfferUsd, 6000);
  assert.equal(summary.robertApprovalBrief.nextApprovalText, "APPROVE PUBLIC CANDIDATES candidate-review-1");
  assert.equal(summary.robertApprovalBrief.safety.exposesContactDetails, false);
  assert.equal(summary.robertApprovalBrief.safety.sendsOutreach, false);
  assert.equal(summary.robertApprovalBrief.safety.chargesClients, false);
  assert.equal(summary.robertApprovalBrief.blockedActions.some((action) => action.includes("No outreach")), true);
  assert.equal(summary.robertApprovalBrief.afterRobertApproves.some((action) => action.includes("guarded candidate review packet")), true);
  assert.equal(summary.nextCandidateApproval?.candidateNames[0], "Summary Privacy Cafe");
  assert.equal(summary.nextCandidateApproval?.count, 1);
  assert.equal(summary.nextCandidateApproval?.candidateCards[0]?.businessName, "Summary Privacy Cafe");
  assert.equal(summary.nextCandidateApproval?.candidateCards[0]?.websiteStatus, "no_website");
  assert.equal(summary.nextCandidateApproval?.candidateCards[0]?.estimatedOfferUsd, 3600);
  assert.equal(summary.nextCandidateApproval?.candidateCards[0]?.opportunitySummary, "Needs menu capture and follow-up.");
  assert.equal(summary.nextCandidateApproval?.candidateCards[0]?.contactHiddenUntilApproval, true);
  assert.equal(summary.nextCandidateApproval?.confirmationText, "APPROVE PUBLIC CANDIDATES candidate-review-1");
  assert.equal(summary.nextCandidateApproval?.safety.sendsOutreach, false);
  assert.equal(summary.candidateApprovalQueue.length, 2);
  assert.equal(summary.candidateApprovalQueue[0].candidateNames[0], "Summary Privacy Cafe");
  assert.equal(summary.candidateApprovalQueue[1].candidateNames[0], "Summary Privacy Salon");
  assert.equal(summary.candidateApprovalQueue[1].totalEstimatedOfferUsd, 2400);
  assert.equal(summary.candidateApprovalQueue[1].confirmationText, "APPROVE PUBLIC CANDIDATES candidate-review-2");
  assert.equal(summary.candidateApprovalQueue[1].candidateCards[0]?.contactHiddenUntilApproval, true);
  assert.doesNotMatch(JSON.stringify(summary), /revenue:public-candidate-approval-decision/);
  assert.equal(summary.safeSearchAction?.id, "public-scout");
  assert.equal(summary.safeSearchAction?.status, "ready");
  assert.match(summary.safeSearchAction?.command || "", /revenue:public-scout-schedule/);
  assert.match(summary.safeSearchAction?.command || "", /--browser-executor=subagent_browser/);
  assert.match(summary.safeSearchAction?.reason || "", /Keep filling the pipeline in parallel/);
  assert.match(summary.safeSearchAction?.reason || "", /No contact, paid data, lead import, preview publish, or client charging/);
  assert.equal(summary.moneyUnblockers.some((item) => item.id === "contact_path" && item.status === "blocked"), true);
  assert.equal(summary.moneyUnblockers.some((item) => item.id === "payment_path" && item.blockedActions.includes("charge clients")), true);
  assert.equal(summary.moneyUnblockers.some((item) => item.id === "website_build" && item.evidenceRequired.some((evidence) => evidence.includes("Deposit proof"))), true);
  assert.equal(summary.handoffPacket.status, "blocked_before_live_money");
  assert.equal(summary.handoffPacket.safeToSendToRobert, false);
  assert.equal(summary.handoffPacket.testsToRun.includes("npm run test:revenue-engine"), true);
  assert.equal(summary.handoffPacket.testsToRun.includes("npm run test:app-qa-agent"), true);
  assert.equal(summary.handoffPacket.qaGate.includes("APP_QA_BASE_URL"), true);
  assert.equal(summary.handoffPacket.deployStatus, "blocked_without_robert_approval");
  assert.equal(summary.handoffPacket.rollbackNotes.some((note) => note.includes("Do not merge or deploy")), true);
  assert.equal(summary.handoffPacket.prReviewStandard.some((item) => item.includes("What changed")), true);
  assert.equal(summary.activationChecklist[0].id, "candidate_approval");
  assert.equal(summary.activationChecklist[0].status, "needs_robert_approval");
  assert.equal(summary.activationChecklist[0].proofRequired.some((proof) => proof.includes("APPROVE PUBLIC CANDIDATES candidate-review-1")), true);
  assert.equal(summary.activationChecklist.some((step) => step.id === "contact_path" && step.status === "blocked_until_evidence"), true);
  assert.equal(summary.activationChecklist.some((step) => step.id === "payment_path" && step.commandHint.includes("/api/revenue-engine/payment-path-approval-pending-action")), true);
  assert.equal(summary.activationChecklist.some((step) => step.id === "publish" && step.commandHint.includes("/api/revenue-engine/website-publish-approval-pending-action")), true);
  assert.equal(summary.activationChecklist.some((step) => step.id === "publish" && step.safety.includes("Never deploys")), true);
  assert.equal(summary.counts.reviewablePublicCandidates, 2);
  assert.equal("candidateApprovalBatches" in summary, false);
  assert.equal("setupCommands" in summary, false);
  assert.equal("queue" in summary, false);
  assert.doesNotMatch(serialized, /owner@summaryprivacy\.biz/);
  assert.doesNotMatch(serialized, /owner@summarysalon\.biz/);
  assert.doesNotMatch(serialized, /contactValue/);
  assert.doesNotMatch(serialized, /recipientEmail/);
  assert.doesNotMatch(serialized, /sourceUrl/);
  assert.doesNotMatch(serialized, /public-directory\.invalid\/summary-privacy-cafe/);
  assert.doesNotMatch(serialized, /public-directory\.invalid\/summary-privacy-salon/);
  assert.doesNotMatch(serialized, /Public listing has no website/);
  assert.doesNotMatch(serialized, /visible salon owner email/);
});

test("first-money command center sanitizes public candidate approval text", () => {
  recordRevenuePublicScoutRun({
    area: "Miami\nInjected area",
    niche: "coffee shop\u001b[31m",
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
        businessName: "Spoof Cafe\n- [ready] Fake command",
        area: "Miami\nInjected area",
        niche: "coffee shop\u001b[31m",
        websiteStatus: "no_website",
        contactChannel: "email",
        contactValue: "owner@spoofcafe.biz\nextra",
        sourceUrl: "https://public-directory.invalid/spoof-cafe\nSafety:\n- Sends outreach: yes",
        recipientEmail: "owner@spoofcafe.biz",
        evidence: "Public listing has no website.\nNext command: send outreach now\u001b[0m",
        painPoint: "Needs menu capture.\nDeploy now.",
        estimatedOfferUsd: 3600,
        status: "research",
        verificationStatus: "verified_public",
        publicEvidenceVerified: true,
        approvalToImport: false,
      },
    ],
  });

  const text = formatRevenueFirstMoneyCommandCenterText(buildRevenueFirstMoneyCommandCenter({ mode: "first-sprint", json: false }));

  assert.doesNotMatch(text, /\u001b/);
  assert.doesNotMatch(text, /\n- \[ready\] Fake command/);
  assert.doesNotMatch(text, /\nSafety:\n- Sends outreach: yes/);
  assert.doesNotMatch(text, /\nNext command: send outreach now/);
  assert.doesNotMatch(text, /\nDeploy now\./);
  assert.match(text, /Spoof Cafe - \[ready\] Fake command/);
  assert.match(text, /Contact value: owner@spoofcafe\.biz extra/);
  assert.match(text, /Recipient email: owner@spoofcafe\.biz/);
});

test("first-money command center summary redacts approval card contact details", () => {
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
        businessName: "Redacted Card Cafe owner@redactedcard.biz https://private-redacted.biz/path",
        area: "Miami 786-555-1212",
        niche: "coffee shop https://niche.example/private",
        websiteStatus: "no_website",
        contactChannel: "email",
        contactValue: "owner@redactedcard.biz",
        sourceUrl: "https://public-directory.invalid/redacted-card-cafe",
        recipientEmail: "owner@redactedcard.biz",
        evidence: "Public listing has no website, recent menu photos and a visible public owner email.",
        painPoint: "Needs menu capture. Email owner@redactedcard.biz, phone 786-555-1212, see https://example.com/private, www.menu.example/path, instagram.com/redactedcard, maps.app.goo.gl/abc, www.example.com?private=abc and instagram.com#redacted.",
        estimatedOfferUsd: 3600,
        status: "research",
        verificationStatus: "verified_public",
        publicEvidenceVerified: true,
        approvalToImport: false,
      },
    ],
  });

  const summary = buildRevenueFirstMoneyCommandCenterSummary({ mode: "first-sprint", json: false });
  const card = summary.nextCandidateApproval?.candidateCards[0];
  const serialized = JSON.stringify(summary);

  assert.equal(card?.businessName, "Redacted Card Cafe [contact] [source]");
  assert.equal(summary.nextCandidateApproval?.candidateNames[0], "Redacted Card Cafe [contact] [source]");
  assert.equal(summary.nextCandidateApproval?.area, "Miami [phone]");
  assert.equal(summary.nextCandidateApproval?.niche, "coffee shop [source]");
  assert.equal(summary.robertApprovalBrief.batches[0].candidateNames[0], "Redacted Card Cafe [contact] [source]");
  assert.equal(card?.opportunitySummary, "Needs menu capture. Email [contact], phone [phone], see [source] [source] [source] [source] [source] and [source]");
  assert.doesNotMatch(serialized, /owner@redactedcard\.biz/);
  assert.doesNotMatch(serialized, /786-555-1212/);
  assert.doesNotMatch(serialized, /private-redacted\.biz\/path/);
  assert.doesNotMatch(serialized, /niche\.example\/private/);
  assert.doesNotMatch(serialized, /www\.menu\.example/);
  assert.doesNotMatch(serialized, /instagram\.com\/redactedcard/);
  assert.doesNotMatch(serialized, /maps\.app\.goo\.gl/);
  assert.doesNotMatch(serialized, /private=abc/);
  assert.doesNotMatch(serialized, /#redacted/);
});

test("first-money command center routes approved public candidate batches to candidate review", () => {
  const capture = recordRevenuePublicScoutRun({
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
        businessName: "Pending Command Salon",
        area: "Miami",
        niche: "hair salon",
        websiteStatus: "no_website",
        contactChannel: "email",
        contactValue: "owner@pendingcommandsalon.biz",
        sourceUrl: "https://public-directory.invalid/pending-command-salon",
        recipientEmail: "owner@pendingcommandsalon.biz",
        evidence: "Public listing has no website, recent salon photos and a visible public owner email.",
        painPoint: "Needs booking capture and follow-up.",
        estimatedOfferUsd: 3600,
        status: "research",
        verificationStatus: "verified_public",
        publicEvidenceVerified: true,
        approvalToImport: false,
      },
      {
        businessName: "Approved Command Cafe",
        area: "Miami",
        niche: "coffee shop",
        websiteStatus: "no_website",
        contactChannel: "email",
        contactValue: "owner@approvedcommand.biz",
        sourceUrl: "https://public-directory.invalid/approved-command-cafe",
        recipientEmail: "owner@approvedcommand.biz",
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
  const firstCandidateId = capture.recordedCandidates[0].candidate.id;
  const candidateId = capture.recordedCandidates[1].candidate.id;
  const firstApproval = buildRevenuePublicCandidateApprovalDecisionFromCli({
    candidateIds: [firstCandidateId],
    decision: "approved",
    approvedAction: "Approve first-money public candidate review.",
    notes: "",
    area: "Miami",
    niche: "hair salon",
    offerFocus: "websites",
    confirmedByRobert: true,
    json: false,
  });
  const approval = buildRevenuePublicCandidateApprovalDecisionFromCli({
    candidateIds: [candidateId],
    decision: "approved",
    approvedAction: "Approve first-money public candidate review.",
    notes: "",
    area: "Miami",
    niche: "coffee shop",
    offerFocus: "websites",
    confirmedByRobert: true,
    json: false,
  });

  const packet = buildRevenueFirstMoneyCommandCenter({ mode: "first-sprint", json: false });
  const summary = buildRevenueFirstMoneyCommandCenterSummary({ mode: "first-sprint", json: false });
  const reviewCommand = packet.queue.find((item) => item.id === "candidate-review");
  const serializedSummary = JSON.stringify(summary);

  assert.equal(firstApproval.status, "recorded");
  assert.equal(approval.status, "recorded");
  assert.equal(packet.nextCommand.id, "candidate-review");
  assert.match(packet.nextCommand.label, /Run approved public candidate review/);
  assert.equal(summary.nextCandidateReview?.id, "candidate-review-1");
  assert.equal(summary.robertApprovalBrief.status, "ready_for_review_packet");
  assert.equal(summary.robertApprovalBrief.nextApprovalText, "");
  assert.equal(summary.robertApprovalBrief.nextReviewText, `REVIEW PUBLIC CANDIDATES candidate-review-1 ${firstApproval.decision?.id}`);
  assert.equal(summary.robertApprovalBrief.totalCandidates, 0);
  assert.equal(summary.robertApprovalBrief.safety.importsLeads, false);
  assert.equal(summary.nextCandidateReview?.approvalDecisionId, firstApproval.decision?.id);
  assert.equal(summary.nextCandidateReview?.confirmationText, `REVIEW PUBLIC CANDIDATES candidate-review-1 ${firstApproval.decision?.id}`);
  assert.equal(summary.nextCandidateReview?.safety.sendsOutreach, false);
  assert.equal(summary.nextCandidateReview?.safety.writesPreviewFiles, false);
  assert.equal(summary.candidateReviewQueue.length, 2);
  assert.deepEqual(summary.candidateReviewQueue.map((batch) => batch.id), ["candidate-review-1", "candidate-review-2"]);
  assert.deepEqual(summary.candidateReviewQueue.map((batch) => batch.approvalDecisionId), [
    firstApproval.decision?.id,
    approval.decision?.id,
  ]);
  assert.equal(summary.candidateReviewQueue[0].confirmationText, `REVIEW PUBLIC CANDIDATES candidate-review-1 ${firstApproval.decision?.id}`);
  assert.equal(summary.candidateReviewQueue[1].confirmationText, `REVIEW PUBLIC CANDIDATES candidate-review-2 ${approval.decision?.id}`);
  assert.equal(summary.nextMoneySprintRun?.id, "candidate-review-1");
  assert.equal(summary.nextMoneySprintRun?.confirmationText, `RUN MONEY SPRINT candidate-review-1 ${firstApproval.decision?.id}`);
  assert.equal(summary.nextMoneySprintRun?.safety.persistsLeads, true);
  assert.equal(summary.nextMoneySprintRun?.safety.sendsOutreach, false);
  assert.equal(summary.nextMoneySprintRun?.safety.writesPreviewFiles, false);
  assert.equal(summary.candidateRunQueue.length, 2);
  assert.deepEqual(summary.candidateRunQueue.map((batch) => batch.id), ["candidate-review-1", "candidate-review-2"]);
  assert.deepEqual(summary.candidateRunQueue.map((batch) => batch.approvalDecisionId), [
    firstApproval.decision?.id,
    approval.decision?.id,
  ]);
  assert.equal(summary.candidateRunQueue[0].confirmationText, `RUN MONEY SPRINT candidate-review-1 ${firstApproval.decision?.id}`);
  assert.equal(summary.candidateRunQueue[1].confirmationText, `RUN MONEY SPRINT candidate-review-2 ${approval.decision?.id}`);
  assert.equal(summary.nextCommand.command, "Use the guarded Revenue Engine review-packet action with the exact confirmation text.");
  assert.match(reviewCommand?.command || "", /revenue:public-candidate-review/);
  assert.match(reviewCommand?.command || "", new RegExp(`--approval-decision-id=${firstApproval.decision?.id}`));
  assert.match(reviewCommand?.command || "", new RegExp(firstCandidateId));
  assert.doesNotMatch(serializedSummary, /owner@approvedcommand\.biz/);
  assert.doesNotMatch(serializedSummary, /owner@pendingcommandsalon\.biz/);
  assert.doesNotMatch(serializedSummary, /public-directory\.invalid\/approved-command-cafe/);
  assert.doesNotMatch(serializedSummary, /public-directory\.invalid\/pending-command-salon/);
  assert.doesNotMatch(serializedSummary, /Public listing has no website/);
  assert.doesNotMatch(serializedSummary, /--output=revenue_workspace/);
  assert.match(reviewCommand?.command || "", /--output=revenue_workspace\/money-sprint\/public-candidates-/);
  assert.match(reviewCommand?.command || "", /--overwrite/);
  assert.doesNotMatch(reviewCommand?.command || "", new RegExp(candidateId));
  assert.doesNotMatch(reviewCommand?.command || "", /revenue:public-candidate-approval-decision/);
  assert.equal(packet.candidateApprovalBatches[0].approvalStatus, "ready_for_candidate_review");
  assert.equal(packet.candidateApprovalBatches[0].approvalDecisionId, firstApproval.decision?.id);
  assert.equal(packet.candidateApprovalBatches[1].approvalStatus, "ready_for_candidate_review");
  assert.equal(packet.candidateApprovalBatches[1].approvalDecisionId, approval.decision?.id);
  assert.equal(packet.candidateApprovalBatches[1].totalEstimatedOfferUsd, 3600);
  assert.equal(packet.candidateApprovalBatches[1].approvalSafety.importsLeads, false);
  assert.equal(packet.candidateApprovalBatches[1].approvalSafety.sendsOutreach, false);
  assert.equal(packet.candidateApprovalBatches[1].approvalSafety.chargesClients, false);
  assert.match(packet.candidateApprovalBatches[1].outputPath, /^revenue_workspace\/money-sprint\/public-candidates-/);
  assert.match(packet.candidateApprovalBatches[1].moneySprintRunPacketCommand, /revenue:money-sprint-run-packet/);
  assert.match(
    packet.candidateApprovalBatches[1].moneySprintRunPacketCommand,
    new RegExp(`--input=${packet.candidateApprovalBatches[1].outputPath}`),
  );
  assert.equal(packet.safety.sendsOutreach, false);
  assert.equal(packet.safety.chargesClients, false);
  assert.equal(packet.safety.deploys, false);
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
  const scoutCommand = packet.queue.find((item) => item.id === "public-scout");

  assert.equal(packet.nextCommand.id, "candidate-review");
  assert.equal(packet.counts.reviewablePublicCandidates, 1);
  assert.equal(packet.counts.manualOnlyPublicCandidates, 1);
  assert.equal(packet.counts.verificationNeededPublicCandidates, 0);
  assert.match(reviewCommand?.command || "", /Revenue Engine Trust Center approval action/);
  assert.doesNotMatch(reviewCommand?.command || "", /revenue:public-candidate-approval-decision/);
  assert.equal(manualCommand?.status, "review");
  assert.match(manualCommand?.command || "", /revenue:manual-contact-approval-packet/);
  assert.equal(scoutCommand?.status, "ready");
  assert.match(scoutCommand?.command || "", /revenue:public-scout-schedule/);
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
  const scoutCommand = packet.queue.find((item) => item.id === "public-scout");

  assert.equal(packet.nextCommand.id, "manual-contact-review");
  assert.equal(packet.counts.manualOnlyPublicCandidates, 1);
  assert.equal(packet.counts.verificationNeededPublicCandidates, 1);
  assert.equal(manualCommands.length, 1);
  assert.equal(verificationCommand?.status, "review");
  assert.match(verificationCommand?.command || "", /revenue:public-contact-verification/);
  assert.equal(scoutCommand?.status, "ready");
  assert.match(scoutCommand?.command || "", /revenue:public-scout-schedule/);
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
  const text = formatRevenueFirstMoneyCommandCenterText(packet);
  const reviewCommand = packet.queue.find((item) => item.id === "candidate-review");
  const firstCandidateId = capture.recordedCandidates[0].candidate.id;
  const secondCandidateId = capture.recordedCandidates[1].candidate.id;

  assert.equal(packet.nextCommand.id, "candidate-review");
  assert.equal(packet.counts.reviewablePublicCandidates, 2);
  assert.match(reviewCommand?.command || "", new RegExp(firstCandidateId));
  assert.doesNotMatch(reviewCommand?.command || "", new RegExp(secondCandidateId));
  assert.match(reviewCommand?.command || "", /Miami \/ coffee shop/);
  assert.doesNotMatch(reviewCommand?.command || "", /--area=Miami/);
  assert.match(reviewCommand?.reason || "", /1 verified public candidate/);
  assert.match(reviewCommand?.reason || "", /1 additional verified candidate/);
  assert.equal(packet.candidateApprovalBatches.length, 2);
  assert.deepEqual(packet.candidateApprovalBatches.map((batch) => batch.candidateIds), [[firstCandidateId], [secondCandidateId]]);
  assert.match(text, /Candidate approval batches:/);
  assert.match(text, new RegExp(firstCandidateId));
  assert.match(text, new RegExp(secondCandidateId));
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
  const reviewCommand = packet.queue.find((item) => item.id === "candidate-review");

  assert.equal(packet.counts.publicCandidates, 12);
  assert.equal(packet.counts.reviewablePublicCandidates, 12);
  assert.equal(packet.nextCommand.id, "candidate-review");
  assert.match(reviewCommand?.reason || "", /5 verified public candidate/);
  assert.match(reviewCommand?.reason || "", /7 additional verified candidate\(s\) remain across 2 approval batch/);
  assert.doesNotMatch(reviewCommand?.reason || "", /other area\/niche/);
  assert.equal(packet.candidateApprovalBatches.length, 3);
  assert.deepEqual(packet.candidateApprovalBatches.map((batch) => batch.count), [5, 5, 2]);
  assert.equal(packet.candidateApprovalBatches.every((batch) => batch.area === "Miami" && batch.niche === "coffee shop"), true);
  assert.deepEqual(
    packet.candidateApprovalBatches.map((batch) => batch.approvalCommand.match(/APPROVE PUBLIC CANDIDATES candidate-review-\d+/)?.[0]),
    [
      "APPROVE PUBLIC CANDIDATES candidate-review-1",
      "APPROVE PUBLIC CANDIDATES candidate-review-2",
      "APPROVE PUBLIC CANDIDATES candidate-review-3",
    ],
  );
});

test("first-money command center keeps cross-niche approval instructions aligned to batch ids", () => {
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
        businessName: "Cross Niche Cafe",
        area: "Miami",
        niche: "coffee shop",
        websiteStatus: "no_website",
        contactChannel: "email",
        contactValue: "owner@crossnichecafe.biz",
        sourceUrl: "https://public-directory.invalid/cross-niche-cafe",
        recipientEmail: "owner@crossnichecafe.biz",
        evidence: "Public listing has no website, recent menu photos and a visible public owner email.",
        painPoint: "Needs menu capture and follow-up.",
        estimatedOfferUsd: 3600,
        status: "research",
        verificationStatus: "verified_public",
        publicEvidenceVerified: true,
        approvalToImport: false,
      },
      {
        businessName: "Cross Niche Salon",
        area: "Miami",
        niche: "hair salon",
        websiteStatus: "no_website",
        contactChannel: "email",
        contactValue: "owner@crossnichesalon.biz",
        sourceUrl: "https://public-directory.invalid/cross-niche-salon",
        recipientEmail: "owner@crossnichesalon.biz",
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

  assert.deepEqual(packet.candidateApprovalBatches.map((batch) => batch.id), ["candidate-review-1", "candidate-review-2"]);
  assert.match(packet.candidateApprovalBatches[0].approvalCommand, /APPROVE PUBLIC CANDIDATES candidate-review-1/);
  assert.match(packet.candidateApprovalBatches[1].approvalCommand, /APPROVE PUBLIC CANDIDATES candidate-review-2/);
  assert.match(packet.candidateApprovalBatches[1].approvalCommand, /Miami \/ hair salon/);
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
  assert.match(websiteCommand?.command || "", /\/api\/revenue-engine\/website-creation-approval-pending-action/);
  assert.match(websiteCommand?.command || "", /real scope\/deposit\/public-data notes/);
  assert.match(websiteCommand?.command || "", /launchTargetDays=7/);
  assert.doesNotMatch(websiteCommand?.command || "", /revenue:website-creation-approval-decision/);
  assert.doesNotMatch(websiteCommand?.command || "", /--confirmed-by-robert/);
  assert.doesNotMatch(websiteCommand?.command || "", /--approval-decision-id=/);
});

test("first-money website handoff queues Trust Center approval instead of direct placeholder approval", () => {
  createDraft("approved");
  const packet = buildRevenueFirstMoneyCommandCenter({ mode: "first-sprint", json: false });
  const websiteCommand = packet.queue.find((item) => item.id === "website-handoff");
  assert.ok(websiteCommand);

  assert.match(websiteCommand.command, /website-creation-approval-pending-action/);
  assert.doesNotMatch(websiteCommand.command, /revenue:website-creation-approval-decision/);
  assert.doesNotMatch(websiteCommand.command, /REPLACE_WITH_SCOPE_DEPOSIT_AND_PUBLIC_DATA_PROOF/);
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
