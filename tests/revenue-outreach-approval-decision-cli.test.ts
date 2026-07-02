import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import {
  listRevenueApprovalDecisions,
  recordRevenueOutreachDraft,
  resetRevenueApprovalDecisionsForTests,
  resetRevenueOutreachForTests,
  setRevenueApprovalDecisionsPathForTests,
  setRevenueOutreachPathForTests,
} from "../server/revenue-engine";
import {
  buildRevenueOutreachApprovalDecisionFromCli,
  formatRevenueOutreachApprovalDecisionText,
  getRevenueOutreachApprovalDecisionExitCode,
  parseRevenueOutreachApprovalDecisionArgs,
  validateRevenueOutreachApprovalDecisionOptions,
} from "../server/revenue-outreach-approval-decision-cli";

const testOutreachPath = "/tmp/revenue-outreach-approval-decision-outreach-test.json";
const testApprovalDecisionsPath = "/tmp/revenue-outreach-approval-decision-decisions-test.json";

setRevenueOutreachPathForTests(testOutreachPath);
setRevenueApprovalDecisionsPathForTests(testApprovalDecisionsPath);

test.afterEach(() => {
  resetRevenueOutreachForTests();
  resetRevenueApprovalDecisionsForTests();
});

function createApprovedDraft() {
  return recordRevenueOutreachDraft({
    channel: "email",
    approvalStatus: "approved",
    recipientEmail: "owner@outreachdecision.example",
    contactName: "Owner",
    businessName: "Outreach Decision Cafe",
    sourceUrl: "https://example.com/outreach-decision-cafe",
    businessSummary: "Outreach Decision Cafe has public evidence of no dedicated website and needs online menu capture plus catering follow-up.",
    websitePriceUsd: 3500,
    automationPriceUsd: 1200,
    monthlyRetainerUsd: 750,
    estimatedInternalMonthlyCostUsd: 54,
    notes: "",
  }).draft;
}

test("parses and validates outreach approval decision options", () => {
  const parsed = parseRevenueOutreachApprovalDecisionArgs([
    "--draft-id=outreach-1",
    "--decision=approved",
    "--approved-action=Approve exact outreach draft for provider send.",
    "--notes=Robert approved the final copy.",
    "--confirmed-by-robert",
    "--json",
  ]);

  assert.deepEqual(parsed, {
    draftId: "outreach-1",
    decision: "approved",
    approvedAction: "Approve exact outreach draft for provider send.",
    notes: "Robert approved the final copy.",
    confirmedByRobert: true,
    json: true,
  });
  assert.deepEqual(validateRevenueOutreachApprovalDecisionOptions(parsed), []);
  assert.deepEqual(validateRevenueOutreachApprovalDecisionOptions(parseRevenueOutreachApprovalDecisionArgs([])), [
    "--draft-id is required.",
  ]);
});

test("records approved outreach decision without sending or charging", () => {
  const draft = createApprovedDraft();
  const result = buildRevenueOutreachApprovalDecisionFromCli({
    draftId: draft.id,
    decision: "approved",
    approvedAction: "Approve exact outreach draft for provider send.",
    notes: "Robert approved the final copy.",
    confirmedByRobert: true,
    json: false,
  });
  const text = formatRevenueOutreachApprovalDecisionText(result);
  const decisions = listRevenueApprovalDecisions();

  assert.equal(result.status, "recorded");
  assert.equal(result.decision?.targetType, "outbox");
  assert.equal(result.decision?.decision, "approved");
  assert.equal(result.decision?.approvalSource, "outreach_approval_cli");
  assert.match(result.decision?.outreachDraftSnapshotHash || "", /^[a-f0-9]{64}$/);
  assert.equal(result.safety.persistsApprovalDecision, true);
  assert.equal(result.safety.sendsOutreach, false);
  assert.equal(result.safety.chargesClients, false);
  assert.equal(result.safety.deploys, false);
  assert.equal(result.nextApiAction, "/api/revenue-engine/outreach-send");
  assert.deepEqual(result.nextApiBody, { draftId: draft.id, approvalDecisionId: result.decision?.id });
  assert.equal(decisions.length, 1);
  assert.match(text, /Persists approval decision: yes/);
  assert.match(text, /Sends outreach: no/);
  assert.equal(getRevenueOutreachApprovalDecisionExitCode(result), 0);
});

test("blocks outreach decision without Robert confirmation", () => {
  const draft = createApprovedDraft();
  const result = buildRevenueOutreachApprovalDecisionFromCli({
    draftId: draft.id,
    decision: "approved",
    approvedAction: "Approve exact outreach draft for provider send.",
    notes: "",
    confirmedByRobert: false,
    json: false,
  });

  assert.equal(result.status, "blocked");
  assert.match(result.blockers.join("; "), /--confirmed-by-robert/);
  assert.equal(result.safety.persistsApprovalDecision, false);
  assert.equal(listRevenueApprovalDecisions().length, 0);
  assert.equal(getRevenueOutreachApprovalDecisionExitCode(result), 1);
});

test("blocks approved outreach decision for draft-only copy", () => {
  const draft = recordRevenueOutreachDraft({
    channel: "email",
    approvalStatus: "draft",
    recipientEmail: "owner@draftonly.example",
    contactName: "Owner",
    businessName: "Draft Only Cafe",
    sourceUrl: "https://example.com/draft-only-cafe",
    businessSummary: "Draft Only Cafe has public evidence of no dedicated website and needs online menu capture plus catering follow-up.",
    websitePriceUsd: 3500,
    automationPriceUsd: 1200,
    monthlyRetainerUsd: 750,
    estimatedInternalMonthlyCostUsd: 54,
    notes: "",
  }).draft;

  const result = buildRevenueOutreachApprovalDecisionFromCli({
    draftId: draft.id,
    decision: "approved",
    approvedAction: "Approve exact outreach draft for provider send.",
    notes: "",
    confirmedByRobert: true,
    json: false,
  });

  assert.equal(result.status, "blocked");
  assert.match(result.blockers.join("; "), /draft status must be approved/);
  assert.equal(listRevenueApprovalDecisions().length, 0);
});

test("outreach approval decision script persists a safe approval record", () => {
  const draft = createApprovedDraft();
  const result = spawnSync(process.execPath, [
    "--import",
    "tsx",
    "script/revenue-outreach-approval-decision.ts",
    `--draft-id=${draft.id}`,
    "--decision=approved",
    "--approved-action=Approve exact outreach draft for provider send.",
    "--notes=Robert approved final outreach copy.",
    "--confirmed-by-robert",
  ], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      REVENUE_ENGINE_OUTREACH_PATH: testOutreachPath,
      REVENUE_ENGINE_APPROVAL_DECISIONS_PATH: testApprovalDecisionsPath,
    },
    encoding: "utf8",
  });

  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, /Revenue outreach approval decision: recorded/);
  assert.match(result.stdout, /approvalDecisionId/);
  assert.match(result.stdout, /Persists approval decision: yes/);
  assert.match(result.stdout, /Sends outreach: no/);
});
