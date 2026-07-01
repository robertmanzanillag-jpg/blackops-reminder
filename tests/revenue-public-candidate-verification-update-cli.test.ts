import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import {
  listRevenuePublicLeadCandidates,
  recordRevenuePublicScoutRun,
  resetRevenuePublicLeadCandidatesForTests,
  setRevenuePublicLeadCandidatesPathForTests,
  updateRevenuePublicLeadCandidateVerification,
} from "../server/revenue-engine";
import {
  buildRevenuePublicCandidateVerificationUpdateInput,
  formatRevenuePublicCandidateVerificationUpdateText,
  parseRevenuePublicCandidateVerificationUpdateArgs,
  validateRevenuePublicCandidateVerificationUpdateOptions,
} from "../server/revenue-public-candidate-verification-update-cli";

const testPublicLeadCandidatesPath = "/tmp/revenue-public-candidate-verification-update-cli-test.json";

setRevenuePublicLeadCandidatesPathForTests(testPublicLeadCandidatesPath);

test.afterEach(resetRevenuePublicLeadCandidatesForTests);

function captureUnverifiedCandidate() {
  const capture = recordRevenuePublicScoutRun({
    area: "Miami, FL",
    niche: "hair salon",
    offerFocus: "websites",
    source: "public_directory",
    scoutRunId: "verification-update-test",
    autoApproveVerified: false,
    dailyResearchTarget: 30,
    dailyQualifiedLeadLimit: 8,
    dailyMockupLimit: 3,
    dailyContactLimit: 0,
    maxPaidDataSpendUsd: 0,
    requireRobertApprovalToContact: true,
    writePreviewFiles: false,
    candidates: [
      {
        businessName: "Verification Update Salon",
        area: "Miami, FL",
        niche: "hair salon",
        websiteStatus: "no_website",
        contactChannel: "unknown",
        contactValue: "",
        sourceUrl: "https://public-directory.invalid/verification-update-salon",
        recipientEmail: "",
        evidence: "Public directory shows no website signal and recent salon activity.",
        painPoint: "Needs online booking and local SEO.",
        estimatedOfferUsd: 3200,
        status: "research",
        contactName: "Owner",
        businessSummary: "Publicly listed salon with no dedicated website.",
        verificationStatus: "needs_review",
        publicEvidenceVerified: false,
        approvalToImport: false,
      },
    ],
  });

  return capture.recordedCandidates[0].candidate.id;
}

test("parses validates and builds public candidate verification update input", () => {
  const options = parseRevenuePublicCandidateVerificationUpdateArgs([
    "--candidate-id=candidate-1",
    "--contact-channel=email",
    "--contact-value=owner@example.com",
    "--source-url=https://example.com/profile",
    "--evidence=Public profile shows no website and a visible owner email.",
    "--pain-point=Needs booking and local SEO.",
    "--notes=Checked official public profile",
    "--verified-by=Robert",
    "--confirm-public-evidence",
    "--json",
  ]);

  assert.deepEqual(validateRevenuePublicCandidateVerificationUpdateOptions(options), []);
  assert.deepEqual(buildRevenuePublicCandidateVerificationUpdateInput(options), {
    candidateId: "candidate-1",
    contactChannel: "email",
    contactValue: "owner@example.com",
    recipientEmail: "",
    sourceUrl: "https://example.com/profile",
    evidence: "Public profile shows no website and a visible owner email.",
    painPoint: "Needs booking and local SEO.",
    notes: "Checked official public profile",
    verifiedBy: "Robert",
    confirmPublicEvidence: true,
  });
  assert.deepEqual(validateRevenuePublicCandidateVerificationUpdateOptions(parseRevenuePublicCandidateVerificationUpdateArgs([])), [
    "--candidate-id is required.",
    "--contact-channel must be email, phone, instagram or contact_form.",
    "--contact-value is required.",
    "--source-url is required.",
    "--evidence must include at least 12 characters of public evidence.",
    "--confirm-public-evidence is required after checking public sources.",
  ]);
  assert.deepEqual(validateRevenuePublicCandidateVerificationUpdateOptions(parseRevenuePublicCandidateVerificationUpdateArgs([
    "--candidate-id=candidate-1",
    "--contact-channel=email",
    "--contact-value=not-an-email",
    "--source-url=https://example.com/profile",
    "--evidence=Public profile shows a visible contact value.",
    "--confirm-public-evidence",
  ])), [
    "--contact-value must be a valid email when --contact-channel=email.",
  ]);
});

test("updates an existing public candidate verification without import approval or outreach", () => {
  const candidateId = captureUnverifiedCandidate();
  const result = updateRevenuePublicLeadCandidateVerification({
    candidateId,
    contactChannel: "email",
    contactValue: "owner@verificationupdatesalon.com",
    recipientEmail: "",
    sourceUrl: "https://verificationupdatesalon.example/public-profile",
    evidence: "Public business profile shows no website and a visible owner email for the salon.",
    painPoint: "Needs online booking and local SEO.",
    notes: "Verified from public business profile only.",
    verifiedBy: "Robert",
    confirmPublicEvidence: true,
  });
  const candidates = listRevenuePublicLeadCandidates();

  assert.equal(result.status, "ready_for_robert_review");
  assert.equal(result.updated, true);
  assert.equal(result.candidate?.id, candidateId);
  assert.equal(result.candidate?.verificationStatus, "verified_public");
  assert.equal(result.candidate?.publicEvidenceVerified, true);
  assert.equal(result.candidate?.approvalToImport, false);
  assert.equal(result.safety.persistsPublicCandidate, true);
  assert.equal(result.safety.persistsLead, false);
  assert.equal(result.safety.sendsOutreach, false);
  assert.equal(result.safety.writesPreviewFiles, false);
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].id, candidateId);
  assert.equal(candidates[0].recipientEmail, "owner@verificationupdatesalon.com");
});

test("rejects email-channel updates when the contact value is not an email", () => {
  const candidateId = captureUnverifiedCandidate();

  assert.throws(() => updateRevenuePublicLeadCandidateVerification({
    candidateId,
    contactChannel: "email",
    contactValue: "not-an-email",
    recipientEmail: "",
    sourceUrl: "https://verificationupdatesalon.example/public-profile",
    evidence: "Public business profile shows no website and a visible contact value for the salon.",
    painPoint: "Needs online booking and local SEO.",
    notes: "Invalid email regression.",
    verifiedBy: "Robert",
    confirmPublicEvidence: true,
  }), /contactValue must be a valid email/);

  const candidates = listRevenuePublicLeadCandidates();
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].verificationStatus, "needs_review");
  assert.equal(candidates[0].recipientEmail, "");
});

test("formats update result with Robert approval as the next gate", () => {
  const output = formatRevenuePublicCandidateVerificationUpdateText({
    status: "ready_for_robert_review",
    candidateId: "candidate-1",
    updated: true,
    candidate: null,
    remainingBeforeRobertReview: [],
    nextReviewCommand: {
      command: "npm",
      args: [
        "run",
        "revenue:public-candidate-review",
        "--",
        "--candidate-ids=candidate-1",
        "--area=Miami, FL",
        "--niche=hair salon",
        "--offer-focus=websites",
      ],
    },
    nextAction: "Ask Robert to approve this candidate.",
    safety: {
      allowedAction: "persist_public_candidate_verification_only",
      persistsPublicCandidate: true,
      persistsLead: false,
      sendsOutreach: false,
      writesPreviewFiles: false,
      paidDataSpendUsd: 0,
      approvalToImportForcedFalse: true,
    },
    snapshot: {},
  } as ReturnType<typeof updateRevenuePublicLeadCandidateVerification>);

  assert.match(output, /Revenue public candidate verification update: ready_for_robert_review/);
  assert.match(output, /Review command after Robert approval:/);
  assert.match(output, /--approved-by-robert/);
  assert.match(output, /Persists final lead: no/);
  assert.match(output, /approvalToImport forced false: yes/);
});

test("script updates a captured candidate through the persisted queue", () => {
  const candidateId = captureUnverifiedCandidate();
  const result = spawnSync(process.execPath, [
    "--import",
    "tsx",
    "script/revenue-public-candidate-verification-update.ts",
    `--candidate-id=${candidateId}`,
    "--contact-channel=email",
    "--contact-value=owner@verificationupdatesalon.com",
    "--source-url=https://verificationupdatesalon.example/public-profile",
    "--evidence=Public business profile shows no website and a visible owner email for the salon.",
    "--pain-point=Needs online booking and local SEO.",
    "--notes=Verified from public business profile only.",
    "--verified-by=Robert",
    "--confirm-public-evidence",
  ], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      REVENUE_ENGINE_PUBLIC_LEAD_CANDIDATES_PATH: testPublicLeadCandidatesPath,
    },
    encoding: "utf8",
  });
  const output = `${result.stdout}\n${result.stderr}`;

  assert.equal(result.status, 0, output);
  assert.match(result.stdout, /Revenue public candidate verification update: ready_for_robert_review/);
  assert.match(result.stdout, /Updated: yes/);
  assert.match(result.stdout, /Persists final lead: no/);
  assert.match(result.stdout, /Sends outreach: no/);
});
