import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import {
  recordRevenueTrustedApprovalDecision,
  resetRevenueApprovalDecisionsForTests,
  resetRevenueLedgerForTests,
  setRevenueApprovalDecisionsPathForTests,
  setRevenueLedgerPathForTests,
} from "../server/revenue-engine";
import {
  buildRevenueLedgerApprovalSnapshotHash,
  buildRevenueLedgerApprovalTargetId,
  type RevenueLedgerApprovalSnapshot,
} from "../server/revenue-ledger-approval";
import {
  buildRevenueLedgerRecordConfirmation,
  getRevenueLedgerRecordExitCode,
  parseRevenueLedgerRecordArgs,
  recordRevenueLedgerEntryFromCli,
  validateRevenueLedgerRecordOptions,
} from "../server/revenue-ledger-record-cli";

const testLedgerPath = "/tmp/revenue-ledger-record-cli-ledger-test.json";
const testApprovalDecisionsPath = "/tmp/revenue-ledger-record-cli-decisions-test.json";

setRevenueLedgerPathForTests(testLedgerPath);
setRevenueApprovalDecisionsPathForTests(testApprovalDecisionsPath);

test.afterEach(() => {
  resetRevenueLedgerForTests();
  resetRevenueApprovalDecisionsForTests();
});

function approveLedger(input: RevenueLedgerApprovalSnapshot) {
  return recordRevenueTrustedApprovalDecision({
    targetId: buildRevenueLedgerApprovalTargetId(input),
    targetType: "ledger_entry",
    decision: "approved",
    approvedAction: "Approve exact paid ledger entry.",
    maxSpendUsd: 0,
    notes: "Robert verified payment evidence.",
    approvalSource: "ledger_entry_approval_cli",
    publicCandidateSnapshotHash: "",
    outreachDraftSnapshotHash: "",
    websiteCreationSnapshotHash: "",
    websitePublishSnapshotHash: "",
    paymentPathSnapshotHash: "",
    contactPathSnapshotHash: "",
    ledgerEntrySnapshotHash: buildRevenueLedgerApprovalSnapshotHash(input),
  });
}

function ledgerInput(): RevenueLedgerApprovalSnapshot {
  return {
    kind: "website_sale",
    clientName: "Ledger Record Client",
    amountUsd: 3500,
    cashCollectedUsd: 1750,
    estimatedInternalCostUsd: 35,
    notes: "Website deposit paid.",
  };
}

test("parses and validates ledger record CLI options", () => {
  const parsed = parseRevenueLedgerRecordArgs([
    "--kind=website_sale",
    "--client-name=Ledger Record Client",
    "--amount-usd=3500",
    "--cash-collected-usd=1750",
    "--estimated-internal-cost-usd=35",
    "--notes=Website deposit paid.",
    "--approval-decision-id=approval-1",
    "--confirm-ledger=RECORD website_sale Ledger Record Client approval-1",
    "--confirmed-by-robert",
    "--json",
  ]);

  assert.equal(parsed.kind, "website_sale");
  assert.equal(parsed.ledgerConfirmation, "RECORD website_sale Ledger Record Client approval-1");
  assert.deepEqual(validateRevenueLedgerRecordOptions(parsed), []);
  assert.deepEqual(validateRevenueLedgerRecordOptions(parseRevenueLedgerRecordArgs([])), [
    "--client-name is required.",
    "--amount-usd must be greater than 0 and at most 1000000.",
    "--confirmed-by-robert is required before recording ledger cash.",
    "--approval-decision-id is required for sale/retainer ledger entries.",
    "--cash-collected-usd must be greater than 0 for sale/retainer ledger entries.",
    "--confirm-ledger is required and must be typed from fresh Robert ledger approval.",
  ]);
});

test("ledger record CLI blocks before recording without Robert confirmation", () => {
  const input = ledgerInput();
  const approval = approveLedger(input);
  const result = recordRevenueLedgerEntryFromCli({
    ...input,
    approvalDecisionId: approval.decision.id,
    ledgerConfirmation: buildRevenueLedgerRecordConfirmation({ ...input, approvalDecisionId: approval.decision.id }),
    confirmedByRobert: false,
    json: false,
  });

  assert.equal(result.entry, null);
  assert.match(result.guardrail.reason, /--confirmed-by-robert/);
  assert.equal(result.safety.recordsLedgerEntry, false);
  assert.equal(getRevenueLedgerRecordExitCode(result), 1);
});

test("ledger record CLI records only after exact approval and typed confirmation", () => {
  const input = ledgerInput();
  const approval = approveLedger(input);
  const result = recordRevenueLedgerEntryFromCli({
    ...input,
    approvalDecisionId: approval.decision.id,
    ledgerConfirmation: buildRevenueLedgerRecordConfirmation({ ...input, approvalDecisionId: approval.decision.id }),
    confirmedByRobert: true,
    json: false,
  });

  assert.equal(result.entry?.clientName, "Ledger Record Client");
  assert.equal(result.entry?.cashCollectedUsd, 1750);
  assert.equal(result.guardrail.status, "ok");
  assert.equal(result.safety.recordsLedgerEntry, true);
  assert.equal(result.safety.chargesClients, false);
  assert.equal(getRevenueLedgerRecordExitCode(result), 0);
});

test("ledger record script rejects missing typed ledger confirmation", () => {
  const input = ledgerInput();
  const approval = approveLedger(input);
  const run = spawnSync(process.execPath, [
    "--import",
    "tsx",
    "script/revenue-ledger-record.ts",
    "--kind=website_sale",
    "--client-name=Ledger Record Client",
    "--amount-usd=3500",
    "--cash-collected-usd=1750",
    "--estimated-internal-cost-usd=35",
    "--notes=Website deposit paid.",
    `--approval-decision-id=${approval.decision.id}`,
    "--confirmed-by-robert",
  ], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      REVENUE_ENGINE_LEDGER_PATH: testLedgerPath,
      REVENUE_ENGINE_APPROVAL_DECISIONS_PATH: testApprovalDecisionsPath,
    },
    encoding: "utf8",
  });

  assert.equal(run.status, 1);
  assert.match(run.stderr, /--confirm-ledger is required/);
  assert.equal(run.stdout, "");
});
