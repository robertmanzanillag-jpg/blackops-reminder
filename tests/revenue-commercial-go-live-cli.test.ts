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
  buildRevenueCommercialGoLivePacket,
  formatRevenueCommercialGoLivePacketText,
  parseRevenueCommercialGoLiveArgs,
  validateRevenueCommercialGoLiveOptions,
} from "../server/revenue-commercial-go-live-cli";

const trackedEnvKeys = [
  "DATABASE_URL",
  "SESSION_SECRET",
  "REVENUE_ENGINE_MONEY_MODE",
  "REVENUE_ENGINE_ROBERT_CONTACT_APPROVED",
  "REVENUE_ENGINE_MANUAL_CONTACT_APPROVED",
  "RESEND_API_KEY",
  "REVENUE_ENGINE_FROM_EMAIL",
  "RESEND_FROM_EMAIL",
  "STRIPE_SECRET_KEY",
  "REVENUE_ENGINE_STRIPE_CHECKOUT_ENABLED",
  "REVENUE_ENGINE_PAYMENT_LINK",
  "REVENUE_ENGINE_PAYMENT_PATH_APPROVAL_DECISION_ID",
  "REVENUE_ENGINE_PAYMENT_EXPECTED_DEPOSIT_USD",
  "REVENUE_ENGINE_PAYMENT_EXPECTED_PACKAGE",
  "REVENUE_ENGINE_PAYMENT_EVIDENCE_URL",
  "REVENUE_ENGINE_PAYMENT_EVIDENCE_NOTE",
  "REVENUE_ENGINE_PAYMENT_LINK_APPROVED_BY_ROBERT",
  "REVENUE_ENGINE_PAYMENT_LINK_ALLOWED_HOSTS",
  "REVENUE_ENGINE_PAYMENT_SMOKE_VERIFIED",
  "REVENUE_ENGINE_DEPOSIT_CONFIRMED_BY_ROBERT",
  "REVENUE_ENGINE_WEBSITE_DEPLOY_ENABLED",
  "REVENUE_ENGINE_WEBSITE_APP_QA_TARGET_PASSED",
  "REVENUE_ENGINE_WEBSITE_PREVIEW_DEPLOY_VERIFIED",
  "REVENUE_ENGINE_WEBSITE_ROLLBACK_VERIFIED",
  "REVENUE_ENGINE_WEBSITE_PUBLISH_APPROVED_BY_ROBERT",
  "REVENUE_ENGINE_DEPLOY_APPROVED_BY_ROBERT",
] as const;

const originalEnv = Object.fromEntries(trackedEnvKeys.map((key) => [key, process.env[key]]));
const testApprovalDecisionsPath = "/tmp/revenue-commercial-go-live-approval-decisions-test.json";

setRevenueApprovalDecisionsPathForTests(testApprovalDecisionsPath);

function restoreEnv() {
  for (const key of trackedEnvKeys) {
    const value = originalEnv[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

test.afterEach(() => {
  restoreEnv();
  resetRevenueApprovalDecisionsForTests();
});

function clearRevenueGoLiveEnv() {
  for (const key of trackedEnvKeys) {
    delete process.env[key];
  }
}

function productionReadyEnv(): Record<string, string> {
  const paymentLink = "https://buy.stripe.com/revenue-deposit-secret-token";
  return {
    DATABASE_URL: "postgres://ceo_user:SECRET_DB_PASS@db.internal:5432/blackops",
    SESSION_SECRET: "SECRET_SESSION_12345678901234567890",
    REVENUE_ENGINE_MONEY_MODE: "live",
    REVENUE_ENGINE_ROBERT_CONTACT_APPROVED: "true",
    REVENUE_ENGINE_MANUAL_CONTACT_APPROVED: "true",
    REVENUE_ENGINE_PAYMENT_LINK: paymentLink,
    REVENUE_ENGINE_PAYMENT_PATH_APPROVAL_DECISION_ID: approveProductionPaymentPath(paymentLink),
    REVENUE_ENGINE_PAYMENT_LINK_APPROVED_BY_ROBERT: "true",
    REVENUE_ENGINE_PAYMENT_SMOKE_VERIFIED: "true",
    REVENUE_ENGINE_PAYMENT_EXPECTED_DEPOSIT_USD: "1500",
    REVENUE_ENGINE_PAYMENT_EXPECTED_PACKAGE: "Website 3D Premium",
    REVENUE_ENGINE_PAYMENT_EVIDENCE_URL: "https://github.com/example/repo/actions/runs/123",
    REVENUE_ENGINE_PAYMENT_EVIDENCE_NOTE: "Stripe payment link smoke test passed",
    REVENUE_ENGINE_WEBSITE_DEPLOY_ENABLED: "true",
    REVENUE_ENGINE_WEBSITE_APP_QA_TARGET_PASSED: "true",
    REVENUE_ENGINE_WEBSITE_PREVIEW_DEPLOY_VERIFIED: "true",
    REVENUE_ENGINE_WEBSITE_ROLLBACK_VERIFIED: "true",
    REVENUE_ENGINE_WEBSITE_PUBLISH_APPROVED_BY_ROBERT: "true",
    REVENUE_ENGINE_DEPLOY_APPROVED_BY_ROBERT: "true",
  };
}

function approveProductionPaymentPath(paymentLink = "https://buy.stripe.com/revenue-deposit-secret-token") {
  const snapshot = {
    paymentMethod: "payment_link" as const,
    paymentLink,
    paymentHost: new URL(paymentLink).hostname.toLowerCase(),
    expectedDepositUsd: 1500,
    expectedPackage: "Website 3D Premium",
  };
  const proof = {
    robertApprovedPaymentPath: true,
    paymentSmokeVerified: true,
    depositConfirmedByRobert: false,
    paymentLink,
    evidenceUrl: "https://github.com/example/repo/actions/runs/123",
    evidenceNote: "Stripe payment link smoke test passed",
  };
  const result = recordRevenueTrustedApprovalDecision({
    targetId: buildRevenuePaymentPathApprovalTargetId(paymentLink),
    targetType: "payment_path",
    decision: "approved",
    approvedAction: "Approve exact payment path for go-live test.",
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
  return result.decision.id;
}

function applyEnv(overrides: Record<string, string | undefined>) {
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

function runCommercialGoLiveCli(args: string[], overrides: Record<string, string | undefined> = {}) {
  return spawnSync(process.execPath, ["--import", "tsx", "script/revenue-commercial-go-live.ts", ...args], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      ...Object.fromEntries(trackedEnvKeys.map((key) => [key, "codex-test-placeholder"])),
      REVENUE_ENGINE_APPROVAL_DECISIONS_PATH: testApprovalDecisionsPath,
      ...overrides,
    },
    encoding: "utf8",
  });
}

test("parses and validates revenue commercial go-live CLI options", () => {
  assert.deepEqual(parseRevenueCommercialGoLiveArgs([]), { mode: "production-launch", json: false });
  assert.deepEqual(parseRevenueCommercialGoLiveArgs(["--mode=first-sprint", "--json"]), { mode: "first-sprint", json: true });
  assert.deepEqual(validateRevenueCommercialGoLiveOptions(parseRevenueCommercialGoLiveArgs([])), []);
  assert.deepEqual(validateRevenueCommercialGoLiveOptions(parseRevenueCommercialGoLiveArgs(["--mode=banana"])), [
    "--mode must be first-sprint or production-launch.",
  ]);
});

test("builds blocked go-live packet without secrets or side effects", () => {
  clearRevenueGoLiveEnv();

  const packet = buildRevenueCommercialGoLivePacket(parseRevenueCommercialGoLiveArgs([]));

  assert.equal(packet.status, "blocked");
  assert.equal(packet.readiness.ready, false);
  assert.equal(packet.safety.printsSecrets, false);
  assert.equal(packet.safety.editsEnvironment, false);
  assert.equal(packet.safety.deploys, false);
  assert.equal(packet.safety.contactsBusinesses, false);
  assert.equal(packet.safety.chargesClients, false);
  assert.equal(packet.safety.publishesWebsites, false);
  assert.equal(packet.safety.commercialGoLiveReady, false);
  assert.equal(packet.executionOrder.some((step) => step.includes("revenue:public-scout-execute")), true);
  assert.equal(packet.requiredEnvironment.some((group) => group.names.includes("DATABASE_URL")), true);
  assert.equal(
    packet.requiredEnvironment.some((group) => group.names.includes("RESEND_API_KEY + REVENUE_ENGINE_FROM_EMAIL/RESEND_FROM_EMAIL")),
    true,
  );
  assert.equal(JSON.stringify(packet).includes("real-pass"), false);
});

test("reports production go-live ready only when all gates pass", () => {
  applyEnv(productionReadyEnv());

  const packet = buildRevenueCommercialGoLivePacket(parseRevenueCommercialGoLiveArgs(["--mode=production-launch"]));

  assert.equal(packet.status, "ready_for_commercial_go_live");
  assert.equal(packet.readiness.ready, true);
  assert.equal(packet.safety.commercialGoLiveReady, true);
  assert.equal(packet.readiness.canCollectMoney, true);
  assert.equal(packet.readiness.canBuildWebsites, true);
  assert.equal(packet.rollbackNotes.some((item) => item.includes("REVENUE_ENGINE_MONEY_MODE")), true);
});

test("keeps first-sprint readiness distinct from commercial go-live", () => {
  applyEnv({
    ...productionReadyEnv(),
    REVENUE_ENGINE_WEBSITE_DEPLOY_ENABLED: undefined,
    REVENUE_ENGINE_WEBSITE_APP_QA_TARGET_PASSED: undefined,
    REVENUE_ENGINE_WEBSITE_PREVIEW_DEPLOY_VERIFIED: undefined,
    REVENUE_ENGINE_WEBSITE_ROLLBACK_VERIFIED: undefined,
    REVENUE_ENGINE_WEBSITE_PUBLISH_APPROVED_BY_ROBERT: undefined,
    REVENUE_ENGINE_DEPLOY_APPROVED_BY_ROBERT: undefined,
  });

  const packet = buildRevenueCommercialGoLivePacket(parseRevenueCommercialGoLiveArgs(["--mode=first-sprint"]));

  assert.equal(packet.status, "ready_for_first_money_sprint");
  assert.equal(packet.readiness.ready, true);
  assert.equal(packet.readiness.canBuildWebsites, false);
  assert.equal(packet.safety.commercialGoLiveReady, false);
});

test("formats go-live packet with gates rollback and safety", () => {
  clearRevenueGoLiveEnv();
  const output = formatRevenueCommercialGoLivePacketText(buildRevenueCommercialGoLivePacket(parseRevenueCommercialGoLiveArgs([])));

  assert.match(output, /Revenue commercial go-live: blocked/);
  assert.match(output, /Required environment gates:/);
  assert.match(output, /Rollback notes:/);
  assert.match(output, /Prints secrets: no/);
  assert.match(output, /Charges clients: no/);
});

test("commercial go-live script exits 1 when blocked", () => {
  const result = runCommercialGoLiveCli(["--mode=production-launch"]);

  assert.equal(result.status, 1);
  assert.match(result.stdout, /Revenue commercial go-live: blocked/);
});

test("commercial go-live script exits 0 only when production gates pass and does not print secrets", () => {
  const result = runCommercialGoLiveCli(["--mode=production-launch"], productionReadyEnv());
  const output = `${result.stdout}\n${result.stderr}`;

  assert.equal(result.status, 0);
  assert.match(result.stdout, /Revenue commercial go-live: ready_for_commercial_go_live/);
  assert.doesNotMatch(output, /SECRET_DB_PASS/);
  assert.doesNotMatch(output, /SECRET_SESSION/);
  assert.doesNotMatch(output, /revenue-deposit-secret-token/);
});

test("commercial go-live script rejects invalid mode", () => {
  const result = runCommercialGoLiveCli(["--mode=banana"]);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /--mode must be first-sprint or production-launch/);
});

test("first-sprint script output never exits as commercial go-live", () => {
  const result = runCommercialGoLiveCli(["--mode=first-sprint"], {
    ...productionReadyEnv(),
    REVENUE_ENGINE_WEBSITE_DEPLOY_ENABLED: "false",
    REVENUE_ENGINE_WEBSITE_APP_QA_TARGET_PASSED: "false",
    REVENUE_ENGINE_WEBSITE_PREVIEW_DEPLOY_VERIFIED: "false",
    REVENUE_ENGINE_WEBSITE_ROLLBACK_VERIFIED: "false",
    REVENUE_ENGINE_WEBSITE_PUBLISH_APPROVED_BY_ROBERT: "false",
    REVENUE_ENGINE_DEPLOY_APPROVED_BY_ROBERT: "false",
  });

  assert.equal(result.status, 1);
  assert.match(result.stdout, /Revenue commercial go-live: ready_for_first_money_sprint/);
  assert.doesNotMatch(result.stdout, /Revenue commercial go-live: ready_for_commercial_go_live/);
});
