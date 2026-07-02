import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import {
  blockRevenuePublicLeadCandidate,
  listRevenuePublicLeadCandidates,
  recordRevenuePublicScoutRun,
  resetRevenuePublicLeadCandidatesForTests,
  setRevenuePublicLeadCandidatesPathForTests,
} from "../server/revenue-engine";
import {
  buildRevenuePublicCandidateBlockFromCli,
  formatRevenuePublicCandidateBlockText,
  getRevenuePublicCandidateBlockExitCode,
  parseRevenuePublicCandidateBlockArgs,
  validateRevenuePublicCandidateBlockOptions,
} from "../server/revenue-public-candidate-block-cli";

const testPublicLeadCandidatesPath = "/tmp/revenue-public-candidate-block-cli-test.json";

setRevenuePublicLeadCandidatesPathForTests(testPublicLeadCandidatesPath);

test.afterEach(resetRevenuePublicLeadCandidatesForTests);

function captureCandidate() {
  const capture = recordRevenuePublicScoutRun({
    area: "Texas City, TX",
    niche: "hair salon",
    offerFocus: "websites",
    source: "public_directory",
    scoutRunId: "candidate-block-test",
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
        businessName: "Wrong Market Salon",
        area: "Texas City, TX",
        niche: "hair salon",
        websiteStatus: "no_website",
        contactChannel: "unknown",
        contactValue: "",
        sourceUrl: "https://public-directory.invalid/wrong-market-salon",
        recipientEmail: "",
        evidence: "Public directory suggests a no-website salon but needs verification.",
        painPoint: "Needs online booking and local SEO.",
        estimatedOfferUsd: 3200,
        status: "research",
        contactName: "Owner",
        businessSummary: "Publicly listed salon with unverified location.",
        verificationStatus: "needs_review",
        publicEvidenceVerified: false,
        approvalToImport: false,
      },
    ],
  });

  return capture.recordedCandidates[0].candidate.id;
}

test("parses and validates public candidate block options", () => {
  const options = parseRevenuePublicCandidateBlockArgs([
    "--candidate-id=candidate-1",
    "--block-reason=Wrong market after public verification.",
    "--source-url=https://example.com/public-profile",
    "--evidence=Public profile points to another city.",
    "--notes=Checked public profile only.",
    "--verified-by=Robert",
    "--confirm-public-mismatch",
    "--json",
  ]);

  assert.deepEqual(validateRevenuePublicCandidateBlockOptions(options), []);
  assert.deepEqual(validateRevenuePublicCandidateBlockOptions(parseRevenuePublicCandidateBlockArgs([])), [
    "--candidate-id is required.",
    "--block-reason must include at least 8 characters.",
    "--source-url must be a public http(s) URL.",
    "--evidence must include at least 12 characters of public evidence.",
    "--confirm-public-mismatch is required after checking public sources.",
  ]);
});

test("blocks an existing candidate by id without duplicating it", () => {
  const candidateId = captureCandidate();
  const result = blockRevenuePublicLeadCandidate({
    candidateId,
    blockReason: "Wrong market after public verification.",
    sourceUrl: "https://example.com/public-profile",
    evidence: "Public profile points to another city and should not be used for this batch.",
    notes: "Blocked from public verification only.",
    verifiedBy: "Robert",
    confirmPublicMismatch: true,
  });
  const candidates = listRevenuePublicLeadCandidates();

  assert.equal(result.status, "blocked");
  assert.equal(result.updated, true);
  assert.equal(result.candidate?.id, candidateId);
  assert.equal(result.candidate?.verificationStatus, "blocked");
  assert.equal(result.candidate?.approvalToImport, false);
  assert.equal(result.safety.persistsPublicCandidate, true);
  assert.equal(result.safety.persistsLead, false);
  assert.equal(result.safety.sendsOutreach, false);
  assert.equal(result.safety.writesPreviewFiles, false);
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].id, candidateId);
  assert.equal(candidates[0].verificationStatus, "blocked");
  assert.match(candidates[0].blockedReasons.join(" "), /Wrong market/);
});

test("candidate block requires explicit public mismatch confirmation", () => {
  const candidateId = captureCandidate();
  const result = buildRevenuePublicCandidateBlockFromCli({
    candidateId,
    blockReason: "Wrong market after public verification.",
    sourceUrl: "https://example.com/public-profile",
    evidence: "Public profile points to another city and should not be used for this batch.",
    notes: "Blocked from public verification only.",
    verifiedBy: "Robert",
    confirmPublicMismatch: false,
    json: false,
  });
  const text = formatRevenuePublicCandidateBlockText(result);

  assert.equal(result.status, "confirmation_required");
  assert.equal(result.updated, false);
  assert.equal(getRevenuePublicCandidateBlockExitCode(result), 1);
  assert.match(text, /Persists public candidate: no/);
  assert.equal(listRevenuePublicLeadCandidates()[0].verificationStatus, "needs_review");
});

test("candidate block script updates the persisted queue safely", () => {
  const candidateId = captureCandidate();
  const result = spawnSync(process.execPath, [
    "--import",
    "tsx",
    "script/revenue-public-candidate-block.ts",
    `--candidate-id=${candidateId}`,
    "--block-reason=Wrong market after public verification.",
    "--source-url=https://example.com/public-profile",
    "--evidence=Public profile points to another city and should not be used for this batch.",
    "--notes=Blocked from public verification only.",
    "--verified-by=Robert",
    "--confirm-public-mismatch",
  ], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      REVENUE_ENGINE_PUBLIC_LEAD_CANDIDATES_PATH: testPublicLeadCandidatesPath,
    },
    encoding: "utf8",
  });

  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, /Revenue public candidate block: blocked/);
  assert.match(result.stdout, /Persists final lead: no/);
  assert.match(result.stdout, /Sends outreach: no/);
});
