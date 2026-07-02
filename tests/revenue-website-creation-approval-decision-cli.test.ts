import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import {
  listRevenueApprovalDecisions,
  recordRevenueLead,
  recordRevenueOutreachDraft,
  resetRevenueApprovalDecisionsForTests,
  resetRevenueLeadsForTests,
  resetRevenueOutreachForTests,
  setRevenueApprovalDecisionsPathForTests,
  setRevenueLeadsPathForTests,
  setRevenueOutreachPathForTests,
} from "../server/revenue-engine";
import {
  buildRevenueWebsiteCreationApprovalDecisionFromCli,
  formatRevenueWebsiteCreationApprovalDecisionText,
  getRevenueWebsiteCreationApprovalDecisionExitCode,
  parseRevenueWebsiteCreationApprovalDecisionArgs,
  validateRevenueWebsiteCreationApprovalDecisionOptions,
} from "../server/revenue-website-creation-approval-decision-cli";

const testLeadsPath = "/tmp/revenue-website-creation-approval-decision-leads-test.json";
const testOutreachPath = "/tmp/revenue-website-creation-approval-decision-outreach-test.json";
const testApprovalDecisionsPath = "/tmp/revenue-website-creation-approval-decision-decisions-test.json";

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
    businessName: "Website Decision Cafe",
    area: "Miami",
    niche: "coffee shop",
    websiteStatus: "no_website",
    contactChannel: "email",
    contactValue: "owner@websitedecision.example",
    evidence: "Public listing has no website, menu photos and a visible catering inquiry path.",
    painPoint: "Needs catering lead capture and online menu conversion.",
    estimatedOfferUsd: 4700,
    status: "mockup_ready",
  });

  return recordRevenueOutreachDraft({
    leadId: leadResult.lead.id,
    channel: "email",
    approvalStatus: "approved",
    recipientEmail: "owner@websitedecision.example",
    contactName: "Owner",
    businessName: "Website Decision Cafe",
    sourceUrl: "https://example.com/website-decision-cafe",
    businessSummary: "Website Decision Cafe has public evidence of no dedicated website and needs online menu capture plus catering follow-up.",
    websitePriceUsd: 3500,
    automationPriceUsd: 1200,
    monthlyRetainerUsd: 750,
    estimatedInternalMonthlyCostUsd: 54,
    notes: "",
  }).draft;
}

test("parses and validates website creation approval decision options", () => {
  const parsed = parseRevenueWebsiteCreationApprovalDecisionArgs([
    "--outreach-draft-id=outreach-1",
    "--decision=approved",
    "--approved-action=Approve paid website creation handoff.",
    "--notes=Robert confirmed deposit and scope.",
    "--robert-approved-build",
    "--client-approved-scope",
    "--deposit-paid",
    "--public-data-verified",
    "--launch-target-days=10",
    "--confirmed-by-robert",
    "--json",
  ]);

  assert.deepEqual(parsed, {
    outreachDraftId: "outreach-1",
    decision: "approved",
    approvedAction: "Approve paid website creation handoff.",
    notes: "Robert confirmed deposit and scope.",
    robertApprovedBuild: true,
    clientApprovedScope: true,
    depositPaid: true,
    publicDataVerified: true,
    launchTargetDays: 10,
    confirmedByRobert: true,
    json: true,
  });
  assert.deepEqual(validateRevenueWebsiteCreationApprovalDecisionOptions(parsed), []);
  assert.deepEqual(validateRevenueWebsiteCreationApprovalDecisionOptions(parseRevenueWebsiteCreationApprovalDecisionArgs([])), [
    "--outreach-draft-id is required.",
  ]);
  assert.deepEqual(validateRevenueWebsiteCreationApprovalDecisionOptions(parseRevenueWebsiteCreationApprovalDecisionArgs([
    "--outreach-draft-id=OUTREACH_ID",
    "--approved-action=REPLACE_WITH_WEBSITE_APPROVAL_CONTEXT",
    "--notes=REPLACE_WITH_SCOPE_DEPOSIT_AND_PUBLIC_DATA_PROOF",
  ])), [
    "--outreach-draft-id must be a real outreach draft id, not a placeholder.",
    "--approved-action must be real approval context, not a placeholder.",
    "--notes must be real proof/context, not a placeholder.",
  ]);
});

test("records approved website creation decision without build side effects", () => {
  const draft = createApprovedOutreachDraft();
  const result = buildRevenueWebsiteCreationApprovalDecisionFromCli({
    outreachDraftId: draft.id,
    decision: "approved",
    approvedAction: "Approve paid website creation handoff.",
    notes: "Robert confirmed deposit and scope.",
    robertApprovedBuild: true,
    clientApprovedScope: true,
    depositPaid: true,
    publicDataVerified: true,
    launchTargetDays: 7,
    confirmedByRobert: true,
    json: false,
  });
  const text = formatRevenueWebsiteCreationApprovalDecisionText(result);
  const decisions = listRevenueApprovalDecisions();

  assert.equal(result.status, "recorded");
  assert.equal(result.decision?.targetType, "delivery_workspace");
  assert.equal(result.decision?.approvalSource, "website_creation_approval_cli");
  assert.match(result.decision?.websiteCreationSnapshotHash || "", /^[a-f0-9]{64}$/);
  assert.equal(result.safety.persistsApprovalDecision, true);
  assert.equal(result.safety.writesFiles, false);
  assert.equal(result.safety.deploys, false);
  assert.equal(result.safety.chargesClients, false);
  assert.equal(result.nextCommand.includes("revenue:website-creation-packet"), true);
  assert.match(result.nextCommand, /--approval-decision-id=/);
  assert.equal(decisions.length, 1);
  assert.match(text, /Persists approval decision: yes/);
  assert.match(text, /Writes files: no/);
  assert.equal(getRevenueWebsiteCreationApprovalDecisionExitCode(result), 0);
});

test("blocks approved website creation decision without Robert confirmation or deposit proof", () => {
  const draft = createApprovedOutreachDraft();
  const result = buildRevenueWebsiteCreationApprovalDecisionFromCli({
    outreachDraftId: draft.id,
    decision: "approved",
    approvedAction: "Approve paid website creation handoff.",
    notes: "",
    robertApprovedBuild: true,
    clientApprovedScope: true,
    depositPaid: false,
    publicDataVerified: true,
    launchTargetDays: 7,
    confirmedByRobert: false,
    json: false,
  });

  assert.equal(result.status, "blocked");
  assert.match(result.blockers.join("; "), /--confirmed-by-robert/);
  assert.match(result.blockers.join("; "), /--deposit-paid/);
  assert.equal(result.safety.persistsApprovalDecision, false);
  assert.equal(listRevenueApprovalDecisions().length, 0);
});

test("website creation approval decision script persists safe decision", () => {
  const draft = createApprovedOutreachDraft();
  const result = spawnSync(process.execPath, [
    "--import",
    "tsx",
    "script/revenue-website-creation-approval-decision.ts",
    `--outreach-draft-id=${draft.id}`,
    "--decision=approved",
    "--approved-action=Approve paid website creation handoff.",
    "--notes=Robert confirmed deposit scope and public data.",
    "--robert-approved-build",
    "--client-approved-scope",
    "--deposit-paid",
    "--public-data-verified",
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

  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, /Revenue website creation approval decision: recorded/);
  assert.match(result.stdout, /revenue:website-creation-packet/);
  assert.match(result.stdout, /--approval-decision-id=/);
  assert.match(result.stdout, /Deploys: no/);
});
