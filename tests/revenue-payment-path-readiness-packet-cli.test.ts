import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import {
  recordRevenueTrustedApprovalDecision,
  resetRevenueApprovalDecisionsForTests,
  setRevenueApprovalDecisionsPathForTests,
} from "../server/revenue-engine";
import {
  buildRevenuePaymentPathApprovalTargetId,
  buildRevenuePaymentPathSnapshotHash,
} from "../server/revenue-payment-path-approval";
import {
  buildRevenuePaymentPathReadinessPacketFromCli,
  formatRevenuePaymentPathReadinessPacketText,
  getRevenuePaymentPathReadinessPacketExitCode,
  parseRevenuePaymentPathReadinessPacketArgs,
  validateRevenuePaymentPathReadinessPacketOptions,
} from "../server/revenue-payment-path-readiness-packet-cli";

const testApprovalDecisionsPath = "/tmp/revenue-payment-path-readiness-decisions-test.json";

setRevenueApprovalDecisionsPathForTests(testApprovalDecisionsPath);

test.afterEach(() => {
  resetRevenueApprovalDecisionsForTests();
});

function approvePaymentPath(input: { paymentLink: string; expectedDepositUsd: number; expectedPackage: string }) {
  const paymentUrl = new URL(input.paymentLink);
  const snapshot = {
    paymentMethod: "payment_link" as const,
    paymentLink: input.paymentLink,
    paymentHost: paymentUrl.hostname.toLowerCase(),
    expectedDepositUsd: input.expectedDepositUsd,
    expectedPackage: input.expectedPackage,
  };
  const proof = {
    robertApprovedPaymentPath: true,
    paymentSmokeVerified: true,
    depositConfirmedByRobert: false,
    paymentLink: input.paymentLink,
    evidenceUrl: "https://github.com/example/repo/actions/runs/123",
    evidenceNote: "Stripe payment link smoke test passed",
  };
  return recordRevenueTrustedApprovalDecision({
    targetId: buildRevenuePaymentPathApprovalTargetId(input.paymentLink),
    targetType: "payment_path",
    decision: "approved",
    approvedAction: "Approve exact payment path.",
    maxSpendUsd: 0,
    notes: proof.evidenceNote,
    approvalSource: "payment_path_approval_cli",
    publicCandidateSnapshotHash: "",
    outreachDraftSnapshotHash: "",
    websiteCreationSnapshotHash: "",
    websitePublishSnapshotHash: "",
    paymentPathSnapshotHash: buildRevenuePaymentPathSnapshotHash(snapshot, proof),
    ledgerEntrySnapshotHash: "",
  });
}

test("parses and validates payment path readiness packet CLI options", () => {
  const parsed = parseRevenuePaymentPathReadinessPacketArgs([
    "--payment-link=https://buy.stripe.com/revenue-deposit",
    "--approval-decision-id=approval-1",
    "--robert-approved-payment-path",
    "--payment-smoke-verified",
    "--expected-deposit-usd=1500",
    "--expected-package=Website 3D Premium",
    "--evidence-url=https://github.com/example/repo/actions/runs/123",
    "--evidence-note=Stripe payment link smoke test passed",
    "--json",
  ]);

  assert.equal(parsed.paymentLink, "https://buy.stripe.com/revenue-deposit");
  assert.equal(parsed.approvalDecisionId, "approval-1");
  assert.equal(parsed.robertApprovedPaymentPath, true);
  assert.equal(parsed.paymentSmokeVerified, true);
  assert.equal(parsed.expectedDepositUsd, 1500);
  assert.equal(parsed.json, true);
  assert.deepEqual(validateRevenuePaymentPathReadinessPacketOptions(parseRevenuePaymentPathReadinessPacketArgs([])), [
    "--payment-link is required.",
    "--expected-deposit-usd must be from 1 to 1000000.",
    "--expected-package is required.",
    "--evidence-url is required.",
    "--evidence-note is required.",
  ]);
  assert.deepEqual(validateRevenuePaymentPathReadinessPacketOptions(parseRevenuePaymentPathReadinessPacketArgs([
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

test("payment path readiness packet blocks missing approval and unsafe charge request", () => {
  const approval = approvePaymentPath({
    paymentLink: "https://buy.stripe.com/revenue-deposit",
    expectedDepositUsd: 1500,
    expectedPackage: "Website 3D Premium",
  });
  const missingApproval = buildRevenuePaymentPathReadinessPacketFromCli({
    paymentLink: "https://buy.stripe.com/revenue-deposit",
    approvalDecisionId: "",
    robertApprovedPaymentPath: true,
    paymentSmokeVerified: true,
    depositConfirmedByRobert: false,
    expectedDepositUsd: 1500,
    expectedPackage: "Website 3D Premium",
    evidenceUrl: "https://github.com/example/repo/actions/runs/123",
    evidenceNote: "Stripe payment link smoke test passed",
    chargeClient: false,
    json: false,
  });
  const unsafe = buildRevenuePaymentPathReadinessPacketFromCli({
    paymentLink: "https://buy.stripe.com/revenue-deposit",
    approvalDecisionId: approval.decision.id,
    robertApprovedPaymentPath: true,
    paymentSmokeVerified: true,
    depositConfirmedByRobert: false,
    expectedDepositUsd: 1500,
    expectedPackage: "Website 3D Premium",
    evidenceUrl: "https://github.com/example/repo/actions/runs/123",
    evidenceNote: "Stripe payment link smoke test passed",
    chargeClient: true,
    json: false,
  });

  assert.equal(missingApproval.status, "blocked");
  assert.match(missingApproval.blockedReasons.join("; "), /approvalDecisionId valido/);
  assert.equal(getRevenuePaymentPathReadinessPacketExitCode(missingApproval), 1);
  assert.equal(unsafe.status, "blocked");
  assert.match(unsafe.blockedReasons.join("; "), /no cobra al cliente/);
  assert.equal(unsafe.safety.requestedChargeClient, true);
});

test("payment path readiness packet builds safe handoff", () => {
  const approval = approvePaymentPath({
    paymentLink: "https://buy.stripe.com/revenue-deposit",
    expectedDepositUsd: 1500,
    expectedPackage: "Website 3D Premium",
  });
  const packet = buildRevenuePaymentPathReadinessPacketFromCli({
    paymentLink: "https://buy.stripe.com/revenue-deposit",
    approvalDecisionId: approval.decision.id,
    robertApprovedPaymentPath: true,
    paymentSmokeVerified: true,
    depositConfirmedByRobert: false,
    expectedDepositUsd: 1500,
    expectedPackage: "Website 3D Premium",
    evidenceUrl: "https://github.com/example/repo/actions/runs/123",
    evidenceNote: "Stripe payment link smoke test passed",
    chargeClient: false,
    json: false,
  });
  const text = formatRevenuePaymentPathReadinessPacketText(packet);

  assert.equal(packet.status, "ready_for_payment_path_handoff");
  assert.equal(packet.paymentSnapshot.paymentHost, "buy.stripe.com");
  assert.equal(packet.safety.chargesClients, false);
  assert.equal(packet.safety.editsEnvironment, false);
  assert.equal(packet.safety.recordsLedgerEntry, false);
  assert.match(text, /Revenue payment path readiness packet: ready_for_payment_path_handoff/);
  assert.equal(getRevenuePaymentPathReadinessPacketExitCode(packet), 0);
});

test("payment path readiness packet rejects stale approval after deposit amount changes", () => {
  const approval = approvePaymentPath({
    paymentLink: "https://buy.stripe.com/revenue-deposit",
    expectedDepositUsd: 1500,
    expectedPackage: "Website 3D Premium",
  });
  const packet = buildRevenuePaymentPathReadinessPacketFromCli({
    paymentLink: "https://buy.stripe.com/revenue-deposit",
    approvalDecisionId: approval.decision.id,
    robertApprovedPaymentPath: true,
    paymentSmokeVerified: true,
    depositConfirmedByRobert: false,
    expectedDepositUsd: 2500,
    expectedPackage: "Website 3D Premium",
    evidenceUrl: "https://github.com/example/repo/actions/runs/123",
    evidenceNote: "Stripe payment link smoke test passed",
    chargeClient: false,
    json: false,
  });

  assert.equal(packet.status, "blocked");
  assert.match(packet.blockedReasons.join("; "), /approvalDecisionId valido/);
});

test("payment path readiness packet script exits blocked until gates pass", () => {
  const approval = approvePaymentPath({
    paymentLink: "https://buy.stripe.com/revenue-script-deposit",
    expectedDepositUsd: 1500,
    expectedPackage: "Website 3D Premium",
  });
  const baseEnv = {
    ...process.env,
    REVENUE_ENGINE_APPROVAL_DECISIONS_PATH: testApprovalDecisionsPath,
  };
  const blocked = spawnSync(process.execPath, [
    "--import",
    "tsx",
    "script/revenue-payment-path-readiness-packet.ts",
    "--payment-link=https://buy.stripe.com/revenue-script-deposit",
    "--expected-deposit-usd=1500",
    "--expected-package=Website 3D Premium",
    "--evidence-url=https://github.com/example/repo/actions/runs/123",
    "--evidence-note=Stripe payment link smoke test passed",
  ], {
    cwd: process.cwd(),
    env: baseEnv,
    encoding: "utf8",
  });
  const ready = spawnSync(process.execPath, [
    "--import",
    "tsx",
    "script/revenue-payment-path-readiness-packet.ts",
    "--payment-link=https://buy.stripe.com/revenue-script-deposit",
    `--approval-decision-id=${approval.decision.id}`,
    "--robert-approved-payment-path",
    "--payment-smoke-verified",
    "--expected-deposit-usd=1500",
    "--expected-package=Website 3D Premium",
    "--evidence-url=https://github.com/example/repo/actions/runs/123",
    "--evidence-note=Stripe payment link smoke test passed",
  ], {
    cwd: process.cwd(),
    env: baseEnv,
    encoding: "utf8",
  });

  assert.equal(blocked.status, 1);
  assert.match(blocked.stdout, /Revenue payment path readiness packet: blocked/);
  assert.equal(ready.status, 0, `${ready.stdout}\n${ready.stderr}`);
  assert.match(ready.stdout, /Revenue payment path readiness packet: ready_for_payment_path_handoff/);
  assert.match(ready.stdout, /Charges clients: no/);
});
