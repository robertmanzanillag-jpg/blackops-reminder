import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import {
  listRevenueApprovalDecisions,
  resetRevenueApprovalDecisionsForTests,
  setRevenueApprovalDecisionsPathForTests,
} from "../server/revenue-engine";
import {
  buildRevenueLedgerApprovalDecisionFromCli,
  formatRevenueLedgerApprovalDecisionText,
  getRevenueLedgerApprovalDecisionExitCode,
  parseRevenueLedgerApprovalDecisionArgs,
  validateRevenueLedgerApprovalDecisionOptions,
} from "../server/revenue-ledger-approval-decision-cli";

const testApprovalDecisionsPath = "/tmp/revenue-ledger-approval-decision-decisions-test.json";

setRevenueApprovalDecisionsPathForTests(testApprovalDecisionsPath);

test.afterEach(() => {
  resetRevenueApprovalDecisionsForTests();
});

test("parses and validates ledger approval decision options", () => {
  const parsed = parseRevenueLedgerApprovalDecisionArgs([
    "--kind=automation_sale",
    "--client-name=Proof Client",
    "--amount-usd=3000",
    "--cash-collected-usd=1500",
    "--estimated-internal-cost-usd=40",
    "--notes=Automation Sprint deposit.",
    "--payment-evidence=Stripe pi_123 deposit received",
    "--decision=approved",
    "--approved-action=Approve exact paid ledger entry.",
    "--confirmed-by-robert",
    "--json",
  ]);

  assert.equal(parsed.kind, "automation_sale");
  assert.equal(parsed.clientName, "Proof Client");
  assert.equal(parsed.amountUsd, 3000);
  assert.equal(parsed.cashCollectedUsd, 1500);
  assert.equal(parsed.estimatedInternalCostUsd, 40);
  assert.equal(parsed.notes, "Automation Sprint deposit. | Payment evidence: Stripe pi_123 deposit received");
  assert.equal(parsed.paymentEvidence, "Stripe pi_123 deposit received");
  assert.equal(parsed.confirmedByRobert, true);
  assert.deepEqual(validateRevenueLedgerApprovalDecisionOptions(parsed), []);
  assert.deepEqual(validateRevenueLedgerApprovalDecisionOptions(parseRevenueLedgerApprovalDecisionArgs([])), [
    "--client-name is required.",
    "--amount-usd must be greater than 0 and at most 1000000.",
    "--cash-collected-usd must be greater than 0 and at most 1000000.",
  ]);
});

test("rejects placeholder ledger approval context", () => {
  const parsed = parseRevenueLedgerApprovalDecisionArgs([
    "--kind=website_sale",
    "--client-name=REPLACE WITH CLIENT NAME",
    "--amount-usd=3500",
    "--cash-collected-usd=1500",
    "--estimated-internal-cost-usd=35",
    "--notes=Replace with ledger notes",
    "--payment-evidence=Replace with payment evidence",
    "--decision=approved",
    "--approved-action=Replace with ledger approval context",
    "--confirmed-by-robert",
  ]);

  assert.deepEqual(validateRevenueLedgerApprovalDecisionOptions(parsed), [
    "--client-name must be the real client/business name, not a placeholder.",
    "--approved-action must be real approval context, not a placeholder.",
    "--notes and --payment-evidence must be real ledger/payment context, not placeholders.",
    "--payment-evidence must be real collected cash proof, not a placeholder.",
  ]);
});

test("blocks placeholder ledger approval when builder is called directly", () => {
  const result = buildRevenueLedgerApprovalDecisionFromCli({
    kind: "website_sale",
    clientName: "REPLACE WITH CLIENT NAME",
    amountUsd: 3500,
    cashCollectedUsd: 1500,
    estimatedInternalCostUsd: 35,
    notes: "Replace with ledger notes | Payment evidence: Replace with payment evidence",
    paymentEvidence: "Replace with payment evidence",
    decision: "approved",
    approvedAction: "Replace with ledger approval context",
    confirmedByRobert: true,
    json: false,
  });

  assert.equal(result.status, "blocked");
  assert.equal(result.decision, null);
  assert.match(result.blockers.join("; "), /placeholder/);
  assert.equal(result.safety.persistsApprovalDecision, false);
  assert.equal(listRevenueApprovalDecisions().length, 0);
});

test("records approved ledger decision without recording ledger entry", () => {
  const result = buildRevenueLedgerApprovalDecisionFromCli({
    kind: "bundle_sale",
    clientName: "Audited Cash Client",
    amountUsd: 6000,
    cashCollectedUsd: 3000,
    estimatedInternalCostUsd: 64,
    notes: "Website 3D Premium + Automation Sprint | Payment evidence: Stripe deposit paid",
    paymentEvidence: "Stripe deposit paid",
    decision: "approved",
    approvedAction: "Approve exact paid ledger entry.",
    confirmedByRobert: true,
    json: false,
  });
  const text = formatRevenueLedgerApprovalDecisionText(result);
  const decisions = listRevenueApprovalDecisions();

  assert.equal(result.status, "recorded");
  assert.equal(result.decision?.targetType, "ledger_entry");
  assert.equal(result.decision?.approvalSource, "ledger_entry_approval_cli");
  assert.match(result.decision?.ledgerEntrySnapshotHash || "", /^[a-f0-9]{64}$/);
  assert.equal(result.nextApiBody?.approvalDecisionId, result.decision?.id);
  assert.equal(result.nextApiBody?.notes, result.ledgerInput.notes);
  assert.equal(result.safety.persistsApprovalDecision, true);
  assert.equal(result.safety.recordsLedgerEntry, false);
  assert.equal(result.safety.chargesClients, false);
  assert.equal(decisions.length, 1);
  assert.match(text, /Records ledger entry: no/);
  assert.equal(getRevenueLedgerApprovalDecisionExitCode(result), 0);
});

test("blocks approved ledger decision without Robert confirmation or payment evidence", () => {
  const result = buildRevenueLedgerApprovalDecisionFromCli({
    kind: "automation_sale",
    clientName: "Blocked Cash Client",
    amountUsd: 2500,
    cashCollectedUsd: 1250,
    estimatedInternalCostUsd: 35,
    notes: "Automation Sprint deposit",
    paymentEvidence: "",
    decision: "approved",
    approvedAction: "Approve exact paid ledger entry.",
    confirmedByRobert: false,
    json: false,
  });

  assert.equal(result.status, "blocked");
  assert.match(result.blockers.join("; "), /--confirmed-by-robert/);
  assert.match(result.blockers.join("; "), /--payment-evidence/);
  assert.equal(result.safety.persistsApprovalDecision, false);
  assert.equal(listRevenueApprovalDecisions().length, 0);
});

test("ledger approval decision script persists safe decision", () => {
  const result = spawnSync(process.execPath, [
    "--import",
    "tsx",
    "script/revenue-ledger-approval-decision.ts",
    "--kind=automation_sale",
    "--client-name=Script Cash Client",
    "--amount-usd=2500",
    "--cash-collected-usd=1250",
    "--estimated-internal-cost-usd=35",
    "--notes=Automation Sprint deposit",
    "--payment-evidence=Stripe pi_script deposit received",
    "--decision=approved",
    "--approved-action=Approve exact paid ledger entry.",
    "--confirmed-by-robert",
  ], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      REVENUE_ENGINE_APPROVAL_DECISIONS_PATH: testApprovalDecisionsPath,
    },
    encoding: "utf8",
  });

  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, /Revenue ledger approval decision: recorded/);
  assert.match(result.stdout, /approvalDecisionId/);
  assert.match(result.stdout, /Records ledger entry: no/);
});
