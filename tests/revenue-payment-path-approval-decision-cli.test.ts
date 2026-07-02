import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import {
  listRevenueApprovalDecisions,
  resetRevenueApprovalDecisionsForTests,
  setRevenueApprovalDecisionsPathForTests,
} from "../server/revenue-engine";
import {
  buildRevenuePaymentPathApprovalDecisionFromCli,
  formatRevenuePaymentPathApprovalDecisionText,
  getRevenuePaymentPathApprovalDecisionExitCode,
  parseRevenuePaymentPathApprovalDecisionArgs,
  validateRevenuePaymentPathApprovalDecisionOptions,
} from "../server/revenue-payment-path-approval-decision-cli";

const testApprovalDecisionsPath = "/tmp/revenue-payment-path-approval-decisions-test.json";

setRevenueApprovalDecisionsPathForTests(testApprovalDecisionsPath);

test.afterEach(() => {
  resetRevenueApprovalDecisionsForTests();
});

test("parses and validates payment path approval decision options", () => {
  const parsed = parseRevenuePaymentPathApprovalDecisionArgs([
    "--payment-link=https://buy.stripe.com/revenue-deposit",
    "--decision=approved",
    "--approved-action=Approve payment path.",
    "--robert-approved-payment-path",
    "--payment-smoke-verified",
    "--expected-deposit-usd=1500",
    "--expected-package=Website 3D Premium",
    "--evidence-url=https://github.com/example/repo/actions/runs/123",
    "--evidence-note=Stripe payment link smoke test passed",
    "--confirmed-by-robert",
    "--json",
  ]);

  assert.equal(parsed.paymentLink, "https://buy.stripe.com/revenue-deposit");
  assert.equal(parsed.decision, "approved");
  assert.equal(parsed.robertApprovedPaymentPath, true);
  assert.equal(parsed.paymentSmokeVerified, true);
  assert.equal(parsed.expectedDepositUsd, 1500);
  assert.equal(parsed.confirmedByRobert, true);
  assert.deepEqual(validateRevenuePaymentPathApprovalDecisionOptions(parsed), []);
  assert.deepEqual(validateRevenuePaymentPathApprovalDecisionOptions(parseRevenuePaymentPathApprovalDecisionArgs([])), [
    "--payment-link is required.",
    "--expected-deposit-usd must be from 1 to 1000000.",
    "--expected-package is required.",
    "--evidence-url is required.",
    "--evidence-note must describe the payment smoke/deposit proof.",
  ]);
  assert.deepEqual(validateRevenuePaymentPathApprovalDecisionOptions(parseRevenuePaymentPathApprovalDecisionArgs([
    "--payment-link=https://not-stripe.invalid/pay",
    "--expected-deposit-usd=1500",
    "--expected-package=Website 3D Premium",
    "--evidence-url=not-a-url",
    "--evidence-note=Smoke proof exists",
  ])), [
    "--payment-link must be an HTTPS Stripe payment, checkout, or invoice link.",
    "--evidence-url must be a valid URL.",
  ]);
  assert.deepEqual(validateRevenuePaymentPathApprovalDecisionOptions(parseRevenuePaymentPathApprovalDecisionArgs([
    "--payment-link=https://buy.stripe.com/revenue-deposit",
    "--expected-deposit-usd=1500",
    "--expected-package=Website 3D Premium",
    "--evidence-url=https://example.com/REPLACE_WITH_PAYMENT_EVIDENCE_URL",
    "--evidence-note=REPLACE_WITH_PAYMENT_PROOF",
  ])), [
    "--evidence-url must be real evidence, not a placeholder.",
    "--evidence-note must be real proof, not a placeholder.",
  ]);
});

test("records approved payment path decision without charging or editing env", () => {
  const result = buildRevenuePaymentPathApprovalDecisionFromCli({
    paymentLink: "https://buy.stripe.com/revenue-deposit",
    decision: "approved",
    approvedAction: "Approve payment path.",
    robertApprovedPaymentPath: true,
    paymentSmokeVerified: true,
    depositConfirmedByRobert: false,
    expectedDepositUsd: 1500,
    expectedPackage: "Website 3D Premium",
    evidenceUrl: "https://github.com/example/repo/actions/runs/123",
    evidenceNote: "Stripe payment link smoke test passed",
    confirmedByRobert: true,
    chargeClient: false,
    json: false,
  });
  const text = formatRevenuePaymentPathApprovalDecisionText(result);

  assert.equal(result.status, "recorded");
  assert.equal(result.decision?.targetType, "payment_path");
  assert.equal(result.decision?.approvalSource, "payment_path_approval_cli");
  assert.doesNotMatch(result.decision?.targetId || "", /buy\.stripe\.com/);
  assert.doesNotMatch(result.decision?.targetId || "", /revenue-deposit/);
  assert.match(result.decision?.paymentPathSnapshotHash || "", /^[a-f0-9]{64}$/);
  assert.equal(result.safety.chargesClients, false);
  assert.equal(result.safety.editsEnvironment, false);
  assert.equal(result.safety.storesSecrets, false);
  assert.equal(listRevenueApprovalDecisions().length, 1);
  assert.match(result.nextCommand, /revenue:payment-path-readiness-packet/);
  assert.match(text, /Charges clients: no/);
  assert.equal(getRevenuePaymentPathApprovalDecisionExitCode(result), 0);
});

test("blocks approved payment path decision without Robert confirmation or verification", () => {
  const result = buildRevenuePaymentPathApprovalDecisionFromCli({
    paymentLink: "https://buy.stripe.com/revenue-deposit",
    decision: "approved",
    approvedAction: "Approve payment path.",
    robertApprovedPaymentPath: false,
    paymentSmokeVerified: false,
    depositConfirmedByRobert: false,
    expectedDepositUsd: 1500,
    expectedPackage: "Website 3D Premium",
    evidenceUrl: "https://github.com/example/repo/actions/runs/123",
    evidenceNote: "Stripe payment link smoke test passed",
    confirmedByRobert: false,
    chargeClient: true,
    json: false,
  });

  assert.equal(result.status, "blocked");
  assert.equal(result.decision, null);
  assert.match(result.blockers.join("; "), /--confirmed-by-robert/);
  assert.match(result.blockers.join("; "), /--charge-client/);
  assert.match(result.blockers.join("; "), /--payment-smoke-verified/);
  assert.equal(result.safety.persistsApprovalDecision, false);
  assert.equal(listRevenueApprovalDecisions().length, 0);
});

test("payment path approval decision script persists safe decision", () => {
  const result = spawnSync(process.execPath, [
    "--import",
    "tsx",
    "script/revenue-payment-path-approval-decision.ts",
    "--payment-link=https://buy.stripe.com/revenue-script-deposit",
    "--decision=approved",
    "--approved-action=Approve payment path.",
    "--robert-approved-payment-path",
    "--payment-smoke-verified",
    "--expected-deposit-usd=1500",
    "--expected-package=Website 3D Premium",
    "--evidence-url=https://github.com/example/repo/actions/runs/123",
    "--evidence-note=Stripe payment link smoke test passed",
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
  assert.match(result.stdout, /Revenue payment path approval decision: recorded/);
  assert.match(result.stdout, /revenue:payment-path-readiness-packet/);
  assert.match(result.stdout, /Charges clients: no/);
});
