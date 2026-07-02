import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import {
  recordRevenueLead,
  recordRevenueOutreachDraft,
  recordRevenueTrustedApprovalDecision,
  resetRevenueApprovalDecisionsForTests,
  resetRevenueLeadsForTests,
  resetRevenueOutreachForTests,
  setRevenueApprovalDecisionsPathForTests,
  setRevenueLeadsPathForTests,
  setRevenueOutreachPathForTests,
} from "../server/revenue-engine";
import {
  buildRevenueWebsiteCreationApprovalTargetId,
  buildRevenueWebsiteCreationSnapshotHash,
} from "../server/revenue-website-creation-approval";
import {
  buildRevenueWebsitePublishApprovalDecisionFromCli,
  formatRevenueWebsitePublishApprovalDecisionText,
  getRevenueWebsitePublishApprovalDecisionExitCode,
  parseRevenueWebsitePublishApprovalDecisionArgs,
  validateRevenueWebsitePublishApprovalDecisionOptions,
} from "../server/revenue-website-publish-approval-decision-cli";

const testLeadsPath = "/tmp/revenue-website-publish-approval-leads-test.json";
const testOutreachPath = "/tmp/revenue-website-publish-approval-outreach-test.json";
const testApprovalDecisionsPath = "/tmp/revenue-website-publish-approval-decisions-test.json";

setRevenueLeadsPathForTests(testLeadsPath);
setRevenueOutreachPathForTests(testOutreachPath);
setRevenueApprovalDecisionsPathForTests(testApprovalDecisionsPath);

test.afterEach(() => {
  resetRevenueLeadsForTests();
  resetRevenueOutreachForTests();
  resetRevenueApprovalDecisionsForTests();
});

function createApprovedOutreachDraft() {
  const leadResult = recordRevenueLead({
    businessName: "Publish Decision Cafe",
    area: "Miami",
    niche: "coffee shop",
    websiteStatus: "no_website",
    contactChannel: "email",
    contactValue: "owner@publishdecision.example",
    evidence: "Public listing has no website, menu photos and a visible catering inquiry path.",
    painPoint: "Needs catering lead capture and online menu conversion.",
    estimatedOfferUsd: 4700,
    status: "mockup_ready",
  });
  return recordRevenueOutreachDraft({
    leadId: leadResult.lead.id,
    channel: "email",
    approvalStatus: "approved",
    recipientEmail: "owner@publishdecision.example",
    contactName: "Owner",
    businessName: "Publish Decision Cafe",
    sourceUrl: "https://example.com/publish-decision-cafe",
    businessSummary: "Publish Decision Cafe has public evidence of no dedicated website and needs online menu capture plus catering follow-up.",
    websitePriceUsd: 3500,
    automationPriceUsd: 1200,
    monthlyRetainerUsd: 750,
    estimatedInternalMonthlyCostUsd: 54,
    notes: "",
  }).draft;
}

function approveWebsiteCreation(draft: ReturnType<typeof createApprovedOutreachDraft>) {
  const proof = {
    robertApprovedBuild: true,
    clientApprovedScope: true,
    depositPaid: true,
    publicDataVerified: true,
    launchTargetDays: 7,
  };
  return recordRevenueTrustedApprovalDecision({
    targetId: buildRevenueWebsiteCreationApprovalTargetId(draft.id),
    targetType: "delivery_workspace",
    decision: "approved",
    approvedAction: "Approve exact website creation handoff for publish decision test.",
    maxSpendUsd: 0,
    notes: "",
    approvalSource: "website_creation_approval_cli",
    publicCandidateSnapshotHash: "",
    outreachDraftSnapshotHash: "",
    websiteCreationSnapshotHash: buildRevenueWebsiteCreationSnapshotHash(draft, proof),
    websitePublishSnapshotHash: "",
    ledgerEntrySnapshotHash: "",
  });
}

test("parses and validates website publish approval decision options", () => {
  const parsed = parseRevenueWebsitePublishApprovalDecisionArgs([
    "--outreach-draft-id=outreach-123",
    "--website-creation-approval-decision-id=approval-create",
    "--decision=approved",
    "--approved-action=Approve publish handoff.",
    "--robert-approved-publish",
    "--preview-deploy-verified",
    "--app-qa-target-passed",
    "--rollback-verified",
    "--deploy-provider=replit",
    "--preview-deploy-url=https://preview.example.com",
    "--app-qa-evidence-url=https://github.com/example/repo/actions/runs/123",
    "--rollback-plan-url=https://github.com/example/repo/blob/main/ROLLBACK.md",
    "--confirmed-by-robert",
    "--json",
  ]);

  assert.equal(parsed.outreachDraftId, "outreach-123");
  assert.equal(parsed.websiteCreationApprovalDecisionId, "approval-create");
  assert.equal(parsed.decision, "approved");
  assert.equal(parsed.robertApprovedPublish, true);
  assert.equal(parsed.previewDeployVerified, true);
  assert.equal(parsed.appQaTargetPassed, true);
  assert.equal(parsed.rollbackVerified, true);
  assert.equal(parsed.confirmedByRobert, true);
  assert.deepEqual(validateRevenueWebsitePublishApprovalDecisionOptions(parseRevenueWebsitePublishApprovalDecisionArgs([])), [
    "--outreach-draft-id is required.",
    "--website-creation-approval-decision-id is required.",
    "--deploy-provider is required.",
    "--preview-deploy-url is required.",
    "--app-qa-evidence-url is required.",
    "--rollback-plan-url is required.",
  ]);
  assert.deepEqual(validateRevenueWebsitePublishApprovalDecisionOptions(parseRevenueWebsitePublishApprovalDecisionArgs([
    "--outreach-draft-id=outreach-123",
    "--website-creation-approval-decision-id=approval-create",
    "--deploy-provider=replit",
    "--preview-deploy-url=not-a-url",
    "--app-qa-evidence-url=also-not-a-url",
    "--rollback-plan-url=still-not-a-url",
  ])), [
    "--preview-deploy-url must be a valid URL.",
    "--app-qa-evidence-url must be a valid URL.",
    "--rollback-plan-url must be a valid URL.",
  ]);
});

test("blocks approved website publish decision without Robert confirmation or evidence", () => {
  const draft = createApprovedOutreachDraft();
  const creationApproval = approveWebsiteCreation(draft);
  const result = buildRevenueWebsitePublishApprovalDecisionFromCli({
    outreachDraftId: draft.id,
    websiteCreationApprovalDecisionId: creationApproval.decision.id,
    decision: "approved",
    approvedAction: "Approve publish handoff.",
    notes: "",
    robertApprovedPublish: false,
    previewDeployVerified: false,
    appQaTargetPassed: false,
    rollbackVerified: false,
    deployProvider: "replit",
    previewDeployUrl: "https://preview.example.com/publish-decision-cafe",
    appQaEvidenceUrl: "https://github.com/example/repo/actions/runs/123",
    rollbackPlanUrl: "https://github.com/example/repo/blob/main/ROLLBACK.md",
    launchTargetDays: 7,
    confirmedByRobert: false,
    json: false,
  });

  assert.equal(result.status, "blocked");
  assert.equal(result.decision, null);
  assert.match(result.blockers.join("; "), /--confirmed-by-robert/);
  assert.match(result.blockers.join("; "), /--app-qa-target-passed/);
  assert.equal(result.safety.persistsApprovalDecision, false);
  assert.equal(getRevenueWebsitePublishApprovalDecisionExitCode(result), 1);
});

test("records approved website publish decision without publish side effects", () => {
  const draft = createApprovedOutreachDraft();
  const creationApproval = approveWebsiteCreation(draft);
  const result = buildRevenueWebsitePublishApprovalDecisionFromCli({
    outreachDraftId: draft.id,
    websiteCreationApprovalDecisionId: creationApproval.decision.id,
    decision: "approved",
    approvedAction: "Approve publish handoff.",
    notes: "",
    robertApprovedPublish: true,
    previewDeployVerified: true,
    appQaTargetPassed: true,
    rollbackVerified: true,
    deployProvider: "replit",
    previewDeployUrl: "https://preview.example.com/publish-decision-cafe",
    appQaEvidenceUrl: "https://github.com/example/repo/actions/runs/123",
    rollbackPlanUrl: "https://github.com/example/repo/blob/main/ROLLBACK.md",
    launchTargetDays: 7,
    confirmedByRobert: true,
    json: false,
  });
  const text = formatRevenueWebsitePublishApprovalDecisionText(result);

  assert.equal(result.status, "recorded");
  assert.equal(result.decision?.approvalSource, "website_publish_approval_cli");
  assert.equal(result.decision?.targetType, "website_publish");
  assert.match(result.decision?.websitePublishSnapshotHash || "", /^[a-f0-9]{64}$/);
  assert.equal(result.safety.deploys, false);
  assert.equal(result.safety.publishesWebsite, false);
  assert.match(result.nextCommand, /revenue:website-publish-readiness-packet/);
  assert.match(text, /Revenue website publish approval decision: recorded/);
  assert.equal(getRevenueWebsitePublishApprovalDecisionExitCode(result), 0);
});

test("website publish approval decision script persists safe decision", () => {
  const draft = createApprovedOutreachDraft();
  const creationApproval = approveWebsiteCreation(draft);
  const result = spawnSync(process.execPath, [
    "--import",
    "tsx",
    "script/revenue-website-publish-approval-decision.ts",
    `--outreach-draft-id=${draft.id}`,
    `--website-creation-approval-decision-id=${creationApproval.decision.id}`,
    "--decision=approved",
    "--approved-action=Approve publish handoff.",
    "--robert-approved-publish",
    "--preview-deploy-verified",
    "--app-qa-target-passed",
    "--rollback-verified",
    "--deploy-provider=replit",
    "--preview-deploy-url=https://preview.example.com/publish-decision-cafe",
    "--app-qa-evidence-url=https://github.com/example/repo/actions/runs/123",
    "--rollback-plan-url=https://github.com/example/repo/blob/main/ROLLBACK.md",
    "--confirmed-by-robert",
  ], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      REVENUE_ENGINE_LEADS_PATH: testLeadsPath,
      REVENUE_ENGINE_OUTREACH_PATH: testOutreachPath,
      REVENUE_ENGINE_APPROVAL_DECISIONS_PATH: testApprovalDecisionsPath,
    },
    encoding: "utf8",
  });

  assert.equal(result.status, 0);
  assert.match(result.stdout, /Revenue website publish approval decision: recorded/);
  assert.match(result.stdout, /revenue:website-publish-readiness-packet/);
  assert.match(result.stdout, /Publishes website: no/);
});
