import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import {
  listRevenueApprovalDecisions,
  recordRevenuePublicScoutRun,
  resetRevenueApprovalDecisionsForTests,
  resetRevenuePublicLeadCandidatesForTests,
  setRevenueApprovalDecisionsPathForTests,
  setRevenuePublicLeadCandidatesPathForTests,
} from "../server/revenue-engine";
import {
  buildRevenuePublicCandidateApprovalDecisionFromCli,
  formatRevenuePublicCandidateApprovalDecisionText,
  getRevenuePublicCandidateApprovalDecisionExitCode,
  parseRevenuePublicCandidateApprovalDecisionArgs,
  validateRevenuePublicCandidateApprovalDecisionOptions,
} from "../server/revenue-public-candidate-approval-decision-cli";

const testPublicLeadCandidatesPath = "/tmp/revenue-public-candidate-approval-decision-candidates-test.json";
const testApprovalDecisionsPath = "/tmp/revenue-public-candidate-approval-decision-decisions-test.json";

setRevenuePublicLeadCandidatesPathForTests(testPublicLeadCandidatesPath);
setRevenueApprovalDecisionsPathForTests(testApprovalDecisionsPath);

test.afterEach(() => {
  resetRevenuePublicLeadCandidatesForTests();
  resetRevenueApprovalDecisionsForTests();
});

function captureVerifiedCandidate(area = "Miami, FL", niche = "hair salon") {
  const capture = recordRevenuePublicScoutRun({
    area,
    niche,
    offerFocus: "websites",
    scoutRunId: "approval-decision-test",
    dailyResearchTarget: 20,
    dailyQualifiedLeadLimit: 5,
    dailyMockupLimit: 2,
    dailyContactLimit: 0,
    maxPaidDataSpendUsd: 0,
    requireRobertApprovalToContact: true,
    writePreviewFiles: false,
    candidates: [
      {
        businessName: "Approval Decision Salon",
        area,
        niche,
        websiteStatus: "no_website",
        contactChannel: "email",
        contactValue: "owner@approvaldecisionsalon.biz",
        sourceUrl: "https://public-directory.invalid/approval-decision-salon",
        recipientEmail: "owner@approvaldecisionsalon.biz",
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

  return capture.recordedCandidates[0].candidate.id;
}

test("parses and validates public candidate approval decision options", () => {
  const parsed = parseRevenuePublicCandidateApprovalDecisionArgs([
    "--candidate-ids=candidate-1,candidate-2",
    "--decision=approved",
    "--approved-action=Approve first-money public candidate review.",
    "--notes=Robert approved after public evidence review.",
    "--area=Miami, FL",
    "--niche=hair salon",
    "--offer-focus=websites",
    "--confirmed-by-robert",
    "--json",
  ]);

  assert.deepEqual(parsed, {
    candidateIds: ["candidate-1", "candidate-2"],
    decision: "approved",
    approvedAction: "Approve first-money public candidate review.",
    notes: "Robert approved after public evidence review.",
    area: "Miami, FL",
    niche: "hair salon",
    offerFocus: "websites",
    confirmedByRobert: true,
    json: true,
  });
  assert.deepEqual(validateRevenuePublicCandidateApprovalDecisionOptions(parsed), []);
  assert.deepEqual(validateRevenuePublicCandidateApprovalDecisionOptions(parseRevenuePublicCandidateApprovalDecisionArgs([])), [
    "--candidate-ids is required.",
  ]);
});

test("rejects placeholder public candidate approval context", () => {
  const parsed = parseRevenuePublicCandidateApprovalDecisionArgs([
    "--candidate-ids=REPLACE WITH CANDIDATE IDS",
    "--decision=approved",
    "--approved-action=Replace with candidate approval context",
    "--notes=Replace with public evidence review",
    "--area=Replace with area",
    "--niche=Replace with niche",
    "--offer-focus=websites",
    "--confirmed-by-robert",
  ]);

  assert.deepEqual(validateRevenuePublicCandidateApprovalDecisionOptions(parsed), [
    "--candidate-ids must contain real candidate ids, not placeholders.",
    "--approved-action must be real approval context, not a placeholder.",
    "--notes must be real approval context, not a placeholder.",
    "--area must be the real candidate area, not a placeholder.",
    "--niche must be the real candidate niche, not a placeholder.",
  ]);
});

test("blocks placeholder public candidate approval when builder is called directly", () => {
  const result = buildRevenuePublicCandidateApprovalDecisionFromCli({
    candidateIds: ["REPLACE WITH CANDIDATE IDS"],
    decision: "approved",
    approvedAction: "Replace with candidate approval context",
    notes: "Replace with public evidence review",
    area: "Replace with area",
    niche: "Replace with niche",
    offerFocus: "websites",
    confirmedByRobert: true,
    json: false,
  });

  assert.equal(result.status, "blocked");
  assert.equal(result.decision, null);
  assert.match(result.blockers.join("; "), /placeholder/);
  assert.equal(result.safety.persistsApprovalDecision, false);
  assert.equal(listRevenueApprovalDecisions().length, 0);
});

test("blocks approved public candidate decision when area or niche do not match candidate", () => {
  const candidateId = captureVerifiedCandidate("Miami, FL", "mobile auto detailing");
  const result = buildRevenuePublicCandidateApprovalDecisionFromCli({
    candidateIds: [candidateId],
    decision: "approved",
    approvedAction: "Approve first-money public candidate review.",
    notes: "Robert approved the public evidence.",
    area: "Miami, FL",
    niche: "hair salon",
    offerFocus: "websites",
    confirmedByRobert: true,
    json: false,
  });

  assert.equal(result.status, "blocked");
  assert.equal(result.decision, null);
  assert.match(result.blockers.join("; "), /--niche must match candidate niche/);
  assert.equal(result.safety.persistsApprovalDecision, false);
  assert.equal(listRevenueApprovalDecisions().length, 0);
});

test("records approved public candidate decision without importing or contacting", () => {
  const candidateId = captureVerifiedCandidate();
  const result = buildRevenuePublicCandidateApprovalDecisionFromCli({
    candidateIds: [candidateId],
    decision: "approved",
    approvedAction: "Approve first-money public candidate review.",
    notes: "Robert approved the public evidence.",
    area: "Miami, FL",
    niche: "hair salon",
    offerFocus: "websites",
    confirmedByRobert: true,
    json: false,
  });
  const text = formatRevenuePublicCandidateApprovalDecisionText(result);
  const decisions = listRevenueApprovalDecisions();

  assert.equal(result.status, "recorded");
  assert.equal(result.decision?.targetType, "public_candidate");
  assert.equal(result.decision?.decision, "approved");
  assert.equal(result.decision?.approvalSource, "public_candidate_approval_cli");
  assert.match(result.decision?.publicCandidateSnapshotHash || "", /^[a-f0-9]{64}$/);
  assert.equal(result.safety.persistsApprovalDecision, true);
  assert.equal(result.safety.persistsLeads, false);
  assert.equal(result.safety.sendsOutreach, false);
  assert.equal(result.safety.chargesClients, false);
  assert.equal(result.safety.deploys, false);
  assert.match(result.nextCommand, /revenue:public-candidate-review/);
  assert.match(result.nextCommand, /--approval-decision-id=/);
  assert.doesNotMatch(result.nextCommand, /--approved-by-robert/);
  assert.equal(decisions.length, 1);
  assert.match(text, /Persists approval decision: yes/);
  assert.equal(getRevenuePublicCandidateApprovalDecisionExitCode(result), 0);
});

test("blocks approval decision without Robert confirmation", () => {
  const candidateId = captureVerifiedCandidate();
  const result = buildRevenuePublicCandidateApprovalDecisionFromCli({
    candidateIds: [candidateId],
    decision: "approved",
    approvedAction: "Approve first-money public candidate review.",
    notes: "",
    area: "Miami, FL",
    niche: "hair salon",
    offerFocus: "websites",
    confirmedByRobert: false,
    json: false,
  });

  assert.equal(result.status, "blocked");
  assert.match(result.blockers.join("; "), /--confirmed-by-robert/);
  assert.equal(result.safety.persistsApprovalDecision, false);
  assert.equal(listRevenueApprovalDecisions().length, 0);
  assert.equal(getRevenuePublicCandidateApprovalDecisionExitCode(result), 1);
});

test("approval decision script persists a safe approval record", () => {
  const candidateId = captureVerifiedCandidate();
  const result = spawnSync(process.execPath, [
    "--import",
    "tsx",
    "script/revenue-public-candidate-approval-decision.ts",
    `--candidate-ids=${candidateId}`,
    "--decision=approved",
    "--approved-action=Approve first-money public candidate review.",
    "--notes=Robert approved public evidence.",
    "--area=Miami, FL",
    "--niche=hair salon",
    "--offer-focus=websites",
    "--confirmed-by-robert",
  ], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      REVENUE_ENGINE_PUBLIC_LEAD_CANDIDATES_PATH: testPublicLeadCandidatesPath,
      REVENUE_ENGINE_APPROVAL_DECISIONS_PATH: testApprovalDecisionsPath,
    },
    encoding: "utf8",
  });

  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, /Revenue public candidate approval decision: recorded/);
  assert.match(result.stdout, /--approval-decision-id=/);
  assert.doesNotMatch(result.stdout, /--approved-by-robert/);
  assert.match(result.stdout, /Persists final leads: no/);
  assert.match(result.stdout, /Sends outreach: no/);
});
