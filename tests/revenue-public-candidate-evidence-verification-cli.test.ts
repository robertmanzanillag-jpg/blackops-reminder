import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import {
  getRevenueEngineSnapshot,
  recordRevenuePublicScoutRun,
  resetRevenueLeadsForTests,
  resetRevenueOutreachForTests,
  resetRevenuePublicLeadCandidatesForTests,
  setRevenueLeadsPathForTests,
  setRevenueOutreachPathForTests,
  setRevenuePublicLeadCandidatesPathForTests,
} from "../server/revenue-engine";
import {
  buildRevenuePublicCandidateEvidenceVerificationFromCli,
  formatRevenuePublicCandidateEvidenceVerificationText,
  getRevenuePublicCandidateEvidenceVerificationExitCode,
  parseRevenuePublicCandidateEvidenceVerificationArgs,
  validateRevenuePublicCandidateEvidenceVerificationOptions,
} from "../server/revenue-public-candidate-evidence-verification-cli";

const testPublicLeadCandidatesPath = "/tmp/revenue-public-candidate-evidence-verification-candidates-test.json";
const testLeadsPath = "/tmp/revenue-public-candidate-evidence-verification-leads-test.json";
const testOutreachPath = "/tmp/revenue-public-candidate-evidence-verification-outreach-test.json";

setRevenuePublicLeadCandidatesPathForTests(testPublicLeadCandidatesPath);
setRevenueLeadsPathForTests(testLeadsPath);
setRevenueOutreachPathForTests(testOutreachPath);

test.afterEach(() => {
  resetRevenuePublicLeadCandidatesForTests();
  resetRevenueLeadsForTests();
  resetRevenueOutreachForTests();
});

function writePublicVerificationFixture(candidateId: string, slug = candidateId) {
  const relativePath = `public-verification/${slug}.md`;
  const filePath = path.join(process.cwd(), "revenue_workspace", relativePath);
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, [
    "# Public verification",
    "",
    "Approval status: approved_by_robert",
    `Candidate ID: ${candidateId}`,
    "Evidence Verify Salon",
    "https://evidenceverifysalon.test/contact",
    "owner@evidenceverifysalon.test",
  ].join("\n"), "utf8");
  return `revenue_workspace/${relativePath}`;
}

function createCandidate() {
  const capture = recordRevenuePublicScoutRun({
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
        businessName: "Evidence Verify Salon",
        area: "Miami",
        niche: "beauty salon",
        websiteStatus: "weak_website",
        contactChannel: "email",
        contactValue: "owner@evidenceverifysalon.test",
        sourceUrl: "https://evidenceverifysalon.test/contact",
        recipientEmail: "owner@evidenceverifysalon.test",
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
  return capture.recordedCandidates[0].candidate;
}

test("parses and validates public candidate evidence verification args", () => {
  const parsed = parseRevenuePublicCandidateEvidenceVerificationArgs([
    "--candidate-ids=candidate-1,candidate-2",
    "--approved-by-robert",
    "--evidence-ref=approval-packet:miami-beauty-first-12",
    "--note=Robert accepted public evidence",
    "--json",
  ]);

  assert.deepEqual(parsed.candidateIds, ["candidate-1", "candidate-2"]);
  assert.equal(parsed.approvedByRobert, true);
  assert.equal(parsed.evidenceRef, "approval-packet:miami-beauty-first-12");
  assert.equal(parsed.reviewerNote, "Robert accepted public evidence");
  assert.equal(parsed.json, true);
  assert.deepEqual(validateRevenuePublicCandidateEvidenceVerificationOptions(parsed), []);
  assert.deepEqual(validateRevenuePublicCandidateEvidenceVerificationOptions(parseRevenuePublicCandidateEvidenceVerificationArgs([])), [
    "--candidate-ids is required.",
    "--evidence-ref is required and must be at least 6 characters.",
  ]);
});

test("blocks evidence verification without Robert approval", () => {
  const candidate = createCandidate();
  const result = buildRevenuePublicCandidateEvidenceVerificationFromCli({
    candidateIds: [candidate.id],
    approvedByRobert: false,
    evidenceRef: writePublicVerificationFixture(candidate.id, "blocked"),
    reviewerNote: "Inspection only",
    json: false,
  });

  assert.equal(result.status, "blocked");
  assert.equal(result.updatedCount, 0);
  assert.equal(result.candidates[0].publicEvidenceVerified, false);
  assert.equal(result.candidates[0].approvalToImport, false);
  assert.equal(result.safety.persistsLeads, false);
  assert.equal(getRevenuePublicCandidateEvidenceVerificationExitCode(result), 1);
  assert.equal(getRevenueEngineSnapshot().recentLeads.length, 0);
});

test("blocks evidence verification with placeholder evidence refs", () => {
  const candidate = createCandidate();
  const result = buildRevenuePublicCandidateEvidenceVerificationFromCli({
    candidateIds: [candidate.id],
    approvedByRobert: true,
    evidenceRef: "todo-ref",
    reviewerNote: "This should not be enough evidence.",
    json: false,
  });
  const text = formatRevenuePublicCandidateEvidenceVerificationText(result);

  assert.equal(result.status, "blocked");
  assert.equal(result.evidenceRefAccepted, false);
  assert.equal(result.updatedCount, 0);
  assert.equal(result.candidates[0].publicEvidenceVerified, false);
  assert.match(result.nextAction, /real revenue_workspace\/public-verification/);
  assert.match(text, /Evidence ref accepted: no/);
  assert.equal(getRevenuePublicCandidateEvidenceVerificationExitCode(result), 1);
});

test("blocks evidence verification when approval file lacks candidate business/source/contact tokens", () => {
  const candidate = createCandidate();
  const relativePath = "public-verification/id-only-approval.md";
  const filePath = path.join(process.cwd(), "revenue_workspace", relativePath);
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, [
    "# Public verification",
    "",
    "Approval status: approved_by_robert",
    `Candidate ID: ${candidate.id}`,
  ].join("\n"), "utf8");
  const result = buildRevenuePublicCandidateEvidenceVerificationFromCli({
    candidateIds: [candidate.id],
    approvedByRobert: true,
    evidenceRef: `revenue_workspace/${relativePath}`,
    reviewerNote: "ID alone should not verify the candidate.",
    json: false,
  });

  assert.equal(result.status, "blocked");
  assert.equal(result.evidenceRefAccepted, false);
  assert.equal(result.updatedCount, 0);
  assert.equal(result.candidates[0].verificationStatus, "needs_review");
  assert.equal(result.candidates[0].publicEvidenceVerified, false);
  assert.equal(getRevenuePublicCandidateEvidenceVerificationExitCode(result), 1);
});

test("downgrades pre-verified scout candidates without durable evidence refs", () => {
  const capture = recordRevenuePublicScoutRun({
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
        businessName: "Bypass Attempt Salon",
        area: "Miami",
        niche: "beauty salon",
        websiteStatus: "weak_website",
        contactChannel: "email",
        contactValue: "owner@bypassattemptsalon.test",
        sourceUrl: "https://bypassattemptsalon.test/contact",
        recipientEmail: "owner@bypassattemptsalon.test",
        evidence: "Public contact page has visible email and a weak booking path.",
        painPoint: "Needs stronger booking CTA and local conversion flow.",
        estimatedOfferUsd: 3500,
        status: "research",
        verificationStatus: "verified_public",
        publicEvidenceVerified: true,
        approvalToImport: true,
      },
    ],
  });
  const candidate = capture.recordedCandidates[0].candidate;

  assert.equal(candidate.verificationStatus, "needs_review");
  assert.equal(candidate.publicEvidenceVerified, false);
  assert.equal(candidate.publicEvidenceVerificationRef, "");
  assert.match(candidate.blockedReasons.join("; "), /durable public evidence verification ref required/);
});

test("marks public evidence verified while keeping import and outreach blocked", () => {
  const candidate = createCandidate();
  const evidenceRef = writePublicVerificationFixture(candidate.id, "miami-beauty-first-12");
  const result = buildRevenuePublicCandidateEvidenceVerificationFromCli({
    candidateIds: [candidate.id],
    approvedByRobert: true,
    evidenceRef,
    reviewerNote: "Robert accepted evidence for review only.",
    json: false,
  });
  const text = formatRevenuePublicCandidateEvidenceVerificationText(result);
  const snapshot = getRevenueEngineSnapshot();

  assert.equal(result.status, "evidence_verified_for_robert_review");
  assert.equal(result.evidenceRefAccepted, true);
  assert.equal(result.updatedCount, 1);
  assert.equal(result.candidates[0].verificationStatus, "verified_public");
  assert.equal(result.candidates[0].publicEvidenceVerified, true);
  assert.equal(result.candidates[0].publicEvidenceVerificationRef, evidenceRef);
  assert.equal(result.candidates[0].approvalToImport, false);
  assert.equal(result.candidates[0].importReady, false);
  assert.match(result.candidates[0].blockedReasons.join("; "), /requires Robert review approval/);
  assert.equal(result.safety.persistsPublicCandidates, true);
  assert.equal(result.safety.persistsLeads, false);
  assert.equal(result.safety.sendsOutreach, false);
  assert.equal(result.safety.writesPreviewFiles, false);
  assert.equal(result.safety.approvalToImportForcedFalse, true);
  assert.equal(snapshot.recentLeads.length, 0);
  assert.equal(snapshot.recentOutreach.length, 0);
  assert.match(text, /approvalToImport=no/);
  assert.equal(getRevenuePublicCandidateEvidenceVerificationExitCode(result), 0);
});
