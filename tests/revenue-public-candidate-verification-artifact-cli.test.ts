import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
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
  buildRevenuePublicCandidateVerificationArtifactFromCli,
  getRevenuePublicCandidateVerificationArtifactExitCode,
  parseRevenuePublicCandidateVerificationArtifactArgs,
  validateRevenuePublicCandidateVerificationArtifactOptions,
} from "../server/revenue-public-candidate-verification-artifact-cli";
import { buildRevenuePublicCandidateEvidenceVerificationFromCli } from "../server/revenue-public-candidate-evidence-verification-cli";

const testPublicLeadCandidatesPath = "/tmp/revenue-public-candidate-verification-artifact-candidates-test.json";
const testLeadsPath = "/tmp/revenue-public-candidate-verification-artifact-leads-test.json";
const testOutreachPath = "/tmp/revenue-public-candidate-verification-artifact-outreach-test.json";

setRevenuePublicLeadCandidatesPathForTests(testPublicLeadCandidatesPath);
setRevenueLeadsPathForTests(testLeadsPath);
setRevenueOutreachPathForTests(testOutreachPath);

test.afterEach(() => {
  resetRevenuePublicLeadCandidatesForTests();
  resetRevenueLeadsForTests();
  resetRevenueOutreachForTests();
});

function createCandidate() {
  const capture = recordRevenuePublicScoutRun({
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
        businessName: "Artifact Cafe",
        area: "Miami",
        niche: "coffee shop",
        websiteStatus: "no_website",
        contactChannel: "email",
        contactValue: "owner@artifactcafe.example",
        sourceUrl: "https://example.com/artifact-cafe",
        recipientEmail: "owner@artifactcafe.example",
        evidence: "Public listing has no website, recent menu photos and a visible public owner email.",
        painPoint: "Needs menu capture and catering follow-up.",
        estimatedOfferUsd: 3600,
        status: "research",
        verificationStatus: "needs_review",
        publicEvidenceVerified: false,
        approvalToImport: true,
      },
    ],
  });
  return capture.recordedCandidates[0].candidate;
}

test("parses and validates verification artifact args", () => {
  const parsed = parseRevenuePublicCandidateVerificationArtifactArgs([
    "--candidate-ids=candidate-1,candidate-2",
    "--output=revenue_workspace/public-verification/test-artifact.md",
    "--note=Robert review",
    "--json",
  ]);

  assert.deepEqual(parsed.candidateIds, ["candidate-1", "candidate-2"]);
  assert.equal(parsed.outputPath, "revenue_workspace/public-verification/test-artifact.md");
  assert.equal(parsed.reviewerNote, "Robert review");
  assert.equal(parsed.json, true);
  assert.deepEqual(validateRevenuePublicCandidateVerificationArtifactOptions(parsed), []);
  assert.match(validateRevenuePublicCandidateVerificationArtifactOptions(parseRevenuePublicCandidateVerificationArtifactArgs([
    "--candidate-ids=candidate-1",
    "--output=revenue_workspace/public-scout/bad.md",
  ])).join("; "), /public-verification/);
});

test("writes public verification artifact without importing leads or outreach", () => {
  const candidate = createCandidate();
  const outputPath = `revenue_workspace/public-verification/${candidate.id}.md`;
  const result = buildRevenuePublicCandidateVerificationArtifactFromCli({
    candidateIds: [candidate.id],
    reviewerNote: "Ready for Robert to inspect.",
    outputPath,
    overwrite: true,
    json: false,
  });
  const artifact = readFileSync(outputPath, "utf8");
  const snapshot = getRevenueEngineSnapshot();

  assert.equal(result.status, "ready_for_robert_review");
  assert.equal(result.wroteFile, true);
  assert.equal(existsSync(outputPath), true);
  assert.match(artifact, new RegExp(candidate.id));
  assert.match(artifact, /Artifact Cafe/);
  assert.match(artifact, /https:\/\/example\.com\/artifact-cafe/);
  assert.match(artifact, /owner@artifactcafe\.example/);
  assert.equal(result.safety.persistsLeads, false);
  assert.equal(result.safety.sendsOutreach, false);
  assert.equal(snapshot.recentLeads.length, 0);
  assert.equal(snapshot.recentOutreach.length, 0);
  assert.equal(getRevenuePublicCandidateVerificationArtifactExitCode(result), 0);
});

test("pending verification artifact cannot be reused as approved evidence", () => {
  const candidate = createCandidate();
  const outputPath = `revenue_workspace/public-verification/${candidate.id}-pending.md`;
  const artifactResult = buildRevenuePublicCandidateVerificationArtifactFromCli({
    candidateIds: [candidate.id],
    reviewerNote: "Ready for Robert to inspect.",
    outputPath,
    overwrite: true,
    json: false,
  });
  const verificationResult = buildRevenuePublicCandidateEvidenceVerificationFromCli({
    candidateIds: [candidate.id],
    approvedByRobert: true,
    evidenceRef: outputPath,
    reviewerNote: "Attempted to reuse the pending artifact.",
    json: false,
  });
  const snapshot = getRevenueEngineSnapshot();

  assert.equal(artifactResult.status, "ready_for_robert_review");
  assert.equal(verificationResult.status, "blocked");
  assert.equal(verificationResult.evidenceRefAccepted, false);
  assert.equal(verificationResult.updatedCount, 0);
  assert.equal(verificationResult.candidates[0].publicEvidenceVerified, false);
  assert.equal(snapshot.recentLeads.length, 0);
  assert.equal(snapshot.recentOutreach.length, 0);
});

test("blocks artifact creation for missing candidate ids", () => {
  const result = buildRevenuePublicCandidateVerificationArtifactFromCli({
    candidateIds: ["missing-id"],
    reviewerNote: "",
    outputPath: "revenue_workspace/public-verification/missing-id.md",
    overwrite: true,
    json: false,
  });

  assert.equal(result.status, "blocked");
  assert.equal(result.wroteFile, false);
  assert.deepEqual(result.missingIds, ["missing-id"]);
  assert.equal(getRevenuePublicCandidateVerificationArtifactExitCode(result), 1);
});

test("blocks artifact writes outside public verification workspace", () => {
  const candidate = createCandidate();
  const result = buildRevenuePublicCandidateVerificationArtifactFromCli({
    candidateIds: [candidate.id],
    reviewerNote: "",
    outputPath: "/tmp/not-public-verification.md",
    overwrite: true,
    json: false,
  });

  assert.equal(result.status, "blocked");
  assert.equal(result.wroteFile, false);
  assert.match(result.validationErrors.join("; "), /public-verification/);
  assert.equal(getRevenuePublicCandidateVerificationArtifactExitCode(result), 1);
});
