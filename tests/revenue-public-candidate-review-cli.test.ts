import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import {
  recordRevenueApprovalDecision,
  recordRevenuePublicScoutRun,
  resetRevenueApprovalDecisionsForTests,
  resetRevenueLeadsForTests,
  resetRevenueOutreachForTests,
  resetRevenuePublicLeadCandidatesForTests,
  setRevenueApprovalDecisionsPathForTests,
  setRevenueLeadsPathForTests,
  setRevenueOutreachPathForTests,
  setRevenuePublicLeadCandidatesPathForTests,
  updateRevenuePublicLeadCandidateVerification,
} from "../server/revenue-engine";
import {
  buildRevenuePublicCandidateApprovalDecisionFromCli,
} from "../server/revenue-public-candidate-approval-decision-cli";
import {
  buildRevenuePublicCandidateApprovalTargetId,
  buildRevenuePublicCandidateSnapshotHash,
} from "../server/revenue-public-candidate-approval";
import {
  buildRevenuePublicCandidateReviewInput,
  formatRevenuePublicCandidateReviewText,
  getRevenuePublicCandidateReviewExitCode,
  parseRevenuePublicCandidateReviewArgs,
  validateRevenuePublicCandidateReviewOptions,
} from "../server/revenue-public-candidate-review-cli";

const testPublicLeadCandidatesPath = "/tmp/revenue-public-candidate-review-cli-candidates-test.json";
const testLeadsPath = "/tmp/revenue-public-candidate-review-cli-leads-test.json";
const testOutreachPath = "/tmp/revenue-public-candidate-review-cli-outreach-test.json";
const testApprovalDecisionsPath = "/tmp/revenue-public-candidate-review-cli-approval-decisions-test.json";

setRevenuePublicLeadCandidatesPathForTests(testPublicLeadCandidatesPath);
setRevenueLeadsPathForTests(testLeadsPath);
setRevenueOutreachPathForTests(testOutreachPath);
setRevenueApprovalDecisionsPathForTests(testApprovalDecisionsPath);

test.afterEach(() => {
  resetRevenuePublicLeadCandidatesForTests();
  resetRevenueLeadsForTests();
  resetRevenueOutreachForTests();
  resetRevenueApprovalDecisionsForTests();
});

test("parses public candidate review CLI options", () => {
  const parsed = parseRevenuePublicCandidateReviewArgs([
    "--candidate-ids=candidate-1,candidate-2",
    "--approved-by-robert",
    "--json",
    "--area=Orlando",
    "--niche=roofers",
    "--offer-focus=websites",
    "--daily-research-target=30",
    "--daily-qualified-lead-limit=8",
    "--daily-mockup-limit=3",
    "--daily-contact-limit=2",
    "--note=Robert approved preview batch",
  ]);

  assert.deepEqual(parsed, {
    candidateIds: ["candidate-1", "candidate-2"],
    approvedByRobert: true,
    approvalDecisionId: "",
    json: true,
    area: "Orlando",
    niche: "roofers",
    offerFocus: "websites",
    dailyResearchTarget: 30,
    dailyQualifiedLeadLimit: 8,
    dailyMockupLimit: 3,
    dailyContactLimit: 2,
    reviewerNote: "Robert approved preview batch",
  });
  assert.deepEqual(validateRevenuePublicCandidateReviewOptions(parsed), []);
});

function captureVerifiedReviewCandidate() {
  const capture = recordRevenuePublicScoutRun({
    area: "Miami",
    niche: "coffee shop",
    offerFocus: "websites",
    scoutRunId: "review-approval-decision",
    dailyResearchTarget: 20,
    dailyQualifiedLeadLimit: 5,
    dailyMockupLimit: 2,
    dailyContactLimit: 0,
    maxPaidDataSpendUsd: 0,
    requireRobertApprovalToContact: true,
    writePreviewFiles: false,
    candidates: [
      {
        businessName: "Approval Review Cafe",
        area: "Miami",
        niche: "coffee shop",
        websiteStatus: "no_website",
        contactChannel: "email",
        contactValue: "owner@approvalreviewcafe.biz",
        sourceUrl: "https://public-directory.invalid/approval-review-cafe",
        recipientEmail: "owner@approvalreviewcafe.biz",
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

  return capture.recordedCandidates[0].candidate.id;
}

test("review input does not trust generic public candidate approval decisions", () => {
  const decision = recordRevenueApprovalDecision({
    targetId: "public-candidates:candidate-1",
    targetType: "public_candidate",
    decision: "approved",
    approvedAction: "Approve verified public candidate review.",
    maxSpendUsd: 0,
    notes: "No external spend.",
  }).decision;
  const input = buildRevenuePublicCandidateReviewInput(parseRevenuePublicCandidateReviewArgs([
    "--candidate-ids=candidate-1",
    `--approval-decision-id=${decision.id}`,
    "--area=Miami",
    "--niche=coffee shop",
  ]));

  assert.equal(input.approvedByRobert, false);
});

test("review input does not trust generic decisions even when trusted fields are supplied", () => {
  const candidateId = captureVerifiedReviewCandidate();
  const targetId = buildRevenuePublicCandidateApprovalTargetId([candidateId]);
  const decision = recordRevenueApprovalDecision({
    targetId,
    targetType: "public_candidate",
    decision: "approved",
    approvedAction: "Attempt to approve through generic endpoint.",
    maxSpendUsd: 0,
    notes: "Generic path should not be trusted.",
    approvalSource: "public_candidate_approval_cli",
    publicCandidateSnapshotHash: buildRevenuePublicCandidateSnapshotHash([
      {
        id: candidateId,
        businessName: "Approval Review Cafe",
        area: "Miami",
        niche: "coffee shop",
        contactChannel: "email",
        contactValue: "owner@approvalreviewcafe.biz",
        recipientEmail: "owner@approvalreviewcafe.biz",
        sourceUrl: "https://public-directory.invalid/approval-review-cafe",
        evidence: "Public listing has no website, recent menu photos and a visible public owner email.",
        verificationStatus: "verified_public",
        publicEvidenceVerified: true,
      },
    ]),
  }).decision;
  const input = buildRevenuePublicCandidateReviewInput(parseRevenuePublicCandidateReviewArgs([
    `--candidate-ids=${candidateId}`,
    `--approval-decision-id=${decision.id}`,
  ]));

  assert.equal(decision.approvalSource, "generic");
  assert.equal(decision.publicCandidateSnapshotHash, "");
  assert.equal(input.approvedByRobert, false);
});

test("builds review input from a CLI-recorded public candidate approval decision", () => {
  const candidateId = captureVerifiedReviewCandidate();
  const decision = buildRevenuePublicCandidateApprovalDecisionFromCli({
    candidateIds: [candidateId],
    decision: "approved",
    approvedAction: "Approve verified public candidate review.",
    notes: "No external spend.",
    area: "Miami",
    niche: "coffee shop",
    offerFocus: "websites",
    confirmedByRobert: true,
    json: false,
  }).decision;
  assert.ok(decision);
  const input = buildRevenuePublicCandidateReviewInput(parseRevenuePublicCandidateReviewArgs([
    `--candidate-ids=${candidateId}`,
    `--approval-decision-id=${decision.id}`,
    "--area=Miami",
    "--niche=coffee shop",
  ]));

  assert.equal(input.approvedByRobert, true);
  assert.equal(input.maxPaidDataSpendUsd, 0);
  assert.equal(input.writePreviewFiles, false);
  assert.equal(input.requireRobertApprovalToContact, true);
});

test("review input rejects stale approval decisions after public candidate evidence changes", () => {
  const candidateId = captureVerifiedReviewCandidate();
  const decision = buildRevenuePublicCandidateApprovalDecisionFromCli({
    candidateIds: [candidateId],
    decision: "approved",
    approvedAction: "Approve verified public candidate review.",
    notes: "No external spend.",
    area: "Miami",
    niche: "coffee shop",
    offerFocus: "websites",
    confirmedByRobert: true,
    json: false,
  }).decision;
  assert.ok(decision);

  updateRevenuePublicLeadCandidateVerification({
    candidateId,
    contactChannel: "email",
    contactValue: "changed@approvalreviewcafe.biz",
    sourceUrl: "https://public-directory.invalid/approval-review-cafe-updated",
    evidence: "Updated public listing has a different visible public owner email.",
    notes: "Changed after approval.",
    verifiedBy: "Robert",
  });

  const input = buildRevenuePublicCandidateReviewInput(parseRevenuePublicCandidateReviewArgs([
    `--candidate-ids=${candidateId}`,
    `--approval-decision-id=${decision.id}`,
  ]));

  assert.equal(input.approvedByRobert, false);
});

test("review input does not trust mismatched public candidate approval decisions", () => {
  const decision = recordRevenueApprovalDecision({
    targetId: "public-candidates:other-candidate",
    targetType: "public_candidate",
    decision: "approved",
    approvedAction: "Approve a different candidate.",
    maxSpendUsd: 0,
    notes: "No external spend.",
  }).decision;
  const input = buildRevenuePublicCandidateReviewInput(parseRevenuePublicCandidateReviewArgs([
    "--candidate-ids=candidate-1",
    `--approval-decision-id=${decision.id}`,
  ]));

  assert.equal(input.approvedByRobert, false);
});

test("validates public candidate review CLI options", () => {
  assert.deepEqual(validateRevenuePublicCandidateReviewOptions(parseRevenuePublicCandidateReviewArgs([])), [
    "--candidate-ids is required.",
  ]);
  assert.deepEqual(validateRevenuePublicCandidateReviewOptions(parseRevenuePublicCandidateReviewArgs([
    "--candidate-ids=candidate-1",
    "--offer-focus=banana",
  ])), [
    "--offer-focus must be websites, automations or both.",
  ]);
});

test("builds review input with spend outreach and preview writes disabled", () => {
  const input = buildRevenuePublicCandidateReviewInput(parseRevenuePublicCandidateReviewArgs([
    "--candidate-ids=candidate-1",
    "--approved-by-robert",
    "--area=Miami",
    "--niche=coffee shop",
  ]));

  assert.equal(input.area, "Miami");
  assert.equal(input.niche, "coffee shop");
  assert.equal(input.maxPaidDataSpendUsd, 0);
  assert.equal(input.requireRobertApprovalToContact, true);
  assert.equal(input.writePreviewFiles, false);
  assert.equal(input.approvedByRobert, true);
  assert.deepEqual(input.candidateIds, ["candidate-1"]);
});

test("formats public candidate review text with safety and batch", () => {
  const output = formatRevenuePublicCandidateReviewText({
    status: "ready_for_money_sprint_preview",
    approvedByRobert: true,
    requestedCount: 1,
    foundCount: 1,
    approvedCount: 1,
    missingIds: [],
    duplicateIds: [],
    reviewedCandidates: [
      { businessName: "Review Cafe", approvedForPreview: true, blockedReasons: [], grade: "A", score: 90 },
    ],
    nextApiAction: "human_review_money_sprint_packet",
    nextAction: "Review preview.",
    importBatchText: "business|area\nReview Cafe|Miami",
    moneySprintRunPacket: {
      status: "ready_for_money_sprint_run",
      endpoint: "/api/revenue-engine/money-sprint",
      method: "POST",
      requestBody: {
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
        seedLeads: [],
        seedLeadBatchText: "business|area\nReview Cafe|Miami",
      },
      expectedOutput: {
        acceptedLeads: 1,
        mockupsToPrepare: 1,
        outreachDraftsToCreate: 1,
        sendsOutreach: false,
        writesPreviewFiles: false,
      },
      operatorChecklist: [
        "Confirm Robert approved the candidate review result.",
        "Run the money sprint request only after final human review.",
      ],
      blockedUntil: [],
      safety: {
        sendsOutreach: false,
        writesPreviewFiles: false,
        paidDataSpendUsd: 0,
        requiresRobertApprovalBeforeRun: true,
        requiresRobertApprovalBeforeContact: true,
      },
    },
    safety: {
      persistsLeads: false,
      writesPreviewFiles: false,
      sendsOutreach: false,
      paidDataSpendUsd: 0,
      requiresRobertApproval: true,
    },
  });

  assert.match(output, /Revenue public candidate review: ready_for_money_sprint_preview/);
  assert.match(output, /Approved by Robert: yes/);
  assert.match(output, /Review Cafe: approved/);
  assert.match(output, /Duplicate ids: none/);
  assert.match(output, /Persists final leads: no/);
  assert.match(output, /Paid data spend: \$0/);
  assert.match(output, /Money sprint run packet:/);
  assert.match(output, /Human review action: human_review_money_sprint_packet/);
  assert.match(output, /Endpoint after approval: POST \/api\/revenue-engine\/money-sprint/);
  assert.match(output, /Packet sends outreach: no/);
  assert.match(output, /Requires approval before run: yes/);
});

test("public candidate review exit code follows approved count", () => {
  assert.equal(getRevenuePublicCandidateReviewExitCode({ approvedCount: 1, moneySprintRunPacket: { status: "ready_for_money_sprint_run" } }), 0);
  assert.equal(getRevenuePublicCandidateReviewExitCode({ approvedCount: 1, moneySprintRunPacket: { status: "blocked" } }), 1);
  assert.equal(getRevenuePublicCandidateReviewExitCode({ approvedCount: 1 }), 1);
  assert.equal(getRevenuePublicCandidateReviewExitCode({ approvedCount: 0, moneySprintRunPacket: { status: "ready_for_money_sprint_run" } }), 1);
});

test("public candidate review script prints human-reviewed money sprint packet", () => {
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
        businessName: "CLI Review Packet Cafe",
        area: "Miami",
        niche: "coffee shop",
        websiteStatus: "no_website",
        contactChannel: "email",
        contactValue: "owner@clireviewpacket.example",
        sourceUrl: "https://example.com/cli-review-packet-cafe",
        recipientEmail: "owner@clireviewpacket.example",
        evidence: "Public listing has no website, recent menu photos and a visible public owner email.",
        painPoint: "Needs online menu capture and follow-up.",
        estimatedOfferUsd: 3600,
        status: "research",
        verificationStatus: "verified_public",
        publicEvidenceVerified: true,
        approvalToImport: true,
      },
    ],
  });
  const candidateId = capture.recordedCandidates[0].candidate.id;
  const result = spawnSync(process.execPath, [
    "--import",
    "tsx",
    "script/revenue-public-candidate-review.ts",
    `--candidate-ids=${candidateId}`,
    "--approved-by-robert",
    "--area=Miami",
    "--niche=coffee shop",
    "--offer-focus=websites",
  ], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      REVENUE_ENGINE_PUBLIC_LEAD_CANDIDATES_PATH: testPublicLeadCandidatesPath,
      REVENUE_ENGINE_LEADS_PATH: testLeadsPath,
      REVENUE_ENGINE_OUTREACH_PATH: testOutreachPath,
    },
    encoding: "utf8",
  });
  const output = `${result.stdout}\n${result.stderr}`;

  assert.equal(result.status, 0);
  assert.match(result.stdout, /Revenue public candidate review: ready_for_money_sprint_preview/);
  assert.match(result.stdout, /Next API action: human_review_money_sprint_packet/);
  assert.match(result.stdout, /Money sprint run packet:/);
  assert.match(result.stdout, /Endpoint after approval: POST \/api\/revenue-engine\/money-sprint/);
  assert.match(result.stdout, /Packet paid spend: \$0/);
  assert.match(result.stdout, /Packet sends outreach: no/);
  assert.doesNotMatch(output, /\/api\/revenue-engine\/money-sprint-preview/);
});

test("public candidate review script exits blocked when any requested id is missing", () => {
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
        businessName: "CLI Missing Id Cafe",
        area: "Miami",
        niche: "coffee shop",
        websiteStatus: "no_website",
        contactChannel: "email",
        contactValue: "owner@climissingid.example",
        sourceUrl: "https://example.com/cli-missing-id-cafe",
        recipientEmail: "owner@climissingid.example",
        evidence: "Public listing has no website, recent menu photos and a visible public owner email.",
        painPoint: "Needs online menu capture and follow-up.",
        estimatedOfferUsd: 3600,
        status: "research",
        verificationStatus: "verified_public",
        publicEvidenceVerified: true,
        approvalToImport: true,
      },
    ],
  });
  const result = spawnSync(process.execPath, [
    "--import",
    "tsx",
    "script/revenue-public-candidate-review.ts",
    `--candidate-ids=${capture.recordedCandidates[0].candidate.id},missing-id`,
    "--approved-by-robert",
    "--area=Miami",
    "--niche=coffee shop",
    "--offer-focus=websites",
  ], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      REVENUE_ENGINE_PUBLIC_LEAD_CANDIDATES_PATH: testPublicLeadCandidatesPath,
      REVENUE_ENGINE_LEADS_PATH: testLeadsPath,
      REVENUE_ENGINE_OUTREACH_PATH: testOutreachPath,
    },
    encoding: "utf8",
  });

  assert.equal(result.status, 1);
  assert.match(result.stdout, /Revenue public candidate review: blocked/);
  assert.match(result.stdout, /Missing ids: missing-id/);
  assert.match(result.stdout, /Next API action: \/api\/revenue-engine\/public-scout-run/);
});
