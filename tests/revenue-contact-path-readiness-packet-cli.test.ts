import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import {
  recordRevenueTrustedApprovalDecision,
  resetRevenueApprovalDecisionsForTests,
  setRevenueApprovalDecisionsPathForTests,
} from "../server/revenue-engine";
import {
  buildRevenueContactPathApprovalTargetId,
  buildRevenueContactPathSnapshotHash,
} from "../server/revenue-contact-path-approval";
import {
  buildRevenueContactPathReadinessPacketFromCli,
  formatRevenueContactPathReadinessPacketText,
  getRevenueContactPathReadinessPacketExitCode,
  parseRevenueContactPathReadinessPacketArgs,
  validateRevenueContactPathReadinessPacketOptions,
} from "../server/revenue-contact-path-readiness-packet-cli";

const testApprovalDecisionsPath = "/tmp/revenue-contact-path-readiness-decisions-test.json";
const originalEnv = {
  REVENUE_ENGINE_MANUAL_CONTACT_APPROVED: process.env.REVENUE_ENGINE_MANUAL_CONTACT_APPROVED,
  REVENUE_ENGINE_FROM_EMAIL: process.env.REVENUE_ENGINE_FROM_EMAIL,
  RESEND_FROM_EMAIL: process.env.RESEND_FROM_EMAIL,
  RESEND_API_KEY: process.env.RESEND_API_KEY,
};

setRevenueApprovalDecisionsPathForTests(testApprovalDecisionsPath);

function restoreEnv() {
  for (const [key, value] of Object.entries(originalEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

test.afterEach(() => {
  restoreEnv();
  resetRevenueApprovalDecisionsForTests();
});

function approveContactPath(input: {
  contactMode: "manual" | "email_provider";
  fromEmail?: string;
  manualContactApproved?: boolean;
  emailProviderConfigured?: boolean;
}) {
  const snapshot = {
    contactMode: input.contactMode,
    fromEmail: input.fromEmail || "",
    manualContactApproved: input.manualContactApproved ?? false,
    emailProviderConfigured: input.emailProviderConfigured ?? false,
  };
  const proof = {
    robertApprovedContactPath: true,
    contactPathVerified: true,
    evidenceUrl: "https://github.com/example/repo/actions/runs/456",
    evidenceNote: "Contact path verification passed",
  };
  return recordRevenueTrustedApprovalDecision({
    targetId: buildRevenueContactPathApprovalTargetId(snapshot),
    targetType: "contact_path",
    decision: "approved",
    approvedAction: "Approve exact contact path.",
    maxSpendUsd: 0,
    notes: proof.evidenceNote,
    approvalSource: "contact_path_approval_cli",
    publicCandidateSnapshotHash: "",
    outreachDraftSnapshotHash: "",
    websiteCreationSnapshotHash: "",
    websitePublishSnapshotHash: "",
    paymentPathSnapshotHash: "",
    contactPathSnapshotHash: buildRevenueContactPathSnapshotHash(snapshot, proof),
    ledgerEntrySnapshotHash: "",
  });
}

test("parses and validates contact path readiness packet CLI options", () => {
  const parsed = parseRevenueContactPathReadinessPacketArgs([
    "--contact-mode=manual",
    "--approval-decision-id=approval-1",
    "--robert-approved-contact-path",
    "--contact-path-verified",
    "--evidence-url=https://github.com/example/repo/actions/runs/456",
    "--evidence-note=Manual Gmail path verified",
    "--json",
  ]);

  assert.equal(parsed.contactMode, "manual");
  assert.equal(parsed.approvalDecisionId, "approval-1");
  assert.equal(parsed.robertApprovedContactPath, true);
  assert.equal(parsed.contactPathVerified, true);
  assert.equal(parsed.json, true);
  assert.deepEqual(validateRevenueContactPathReadinessPacketOptions(parseRevenueContactPathReadinessPacketArgs([])), [
    "--evidence-url is required.",
    "--evidence-note is required.",
  ]);
  assert.deepEqual(validateRevenueContactPathReadinessPacketOptions(parseRevenueContactPathReadinessPacketArgs([
    "--evidence-url=https://example.com/REPLACE_WITH_CONTACT_PATH_EVIDENCE_URL",
    "--evidence-note=REPLACE_WITH_CONTACT_PATH_PROOF",
  ])), [
    "--evidence-url must be real evidence, not a placeholder.",
    "--evidence-note must be real proof, not a placeholder.",
  ]);
});

test("contact path readiness packet blocks missing approval and unsafe send request", () => {
  process.env.REVENUE_ENGINE_MANUAL_CONTACT_APPROVED = "true";
  const approval = approveContactPath({
    contactMode: "manual",
    manualContactApproved: true,
  });
  const missingApproval = buildRevenueContactPathReadinessPacketFromCli({
    contactMode: "manual",
    approvalDecisionId: "",
    robertApprovedContactPath: true,
    contactPathVerified: true,
    evidenceUrl: "https://github.com/example/repo/actions/runs/456",
    evidenceNote: "Contact path verification passed",
    sendOutreach: false,
    json: false,
  });
  const unsafe = buildRevenueContactPathReadinessPacketFromCli({
    contactMode: "manual",
    approvalDecisionId: approval.decision.id,
    robertApprovedContactPath: true,
    contactPathVerified: true,
    evidenceUrl: "https://github.com/example/repo/actions/runs/456",
    evidenceNote: "Contact path verification passed",
    sendOutreach: true,
    json: false,
  });

  assert.equal(missingApproval.status, "blocked");
  assert.match(missingApproval.blockedReasons.join("; "), /approvalDecisionId valido/);
  assert.equal(getRevenueContactPathReadinessPacketExitCode(missingApproval), 1);
  assert.equal(unsafe.status, "blocked");
  assert.match(unsafe.blockedReasons.join("; "), /no envia outreach/);
  assert.equal(unsafe.safety.requestedSendOutreach, true);
});

test("contact path readiness packet builds safe manual handoff", () => {
  process.env.REVENUE_ENGINE_MANUAL_CONTACT_APPROVED = "true";
  const approval = approveContactPath({
    contactMode: "manual",
    manualContactApproved: true,
  });
  const packet = buildRevenueContactPathReadinessPacketFromCli({
    contactMode: "manual",
    approvalDecisionId: approval.decision.id,
    robertApprovedContactPath: true,
    contactPathVerified: true,
    evidenceUrl: "https://github.com/example/repo/actions/runs/456",
    evidenceNote: "Contact path verification passed",
    sendOutreach: false,
    json: false,
  });
  const text = formatRevenueContactPathReadinessPacketText(packet);

  assert.equal(packet.status, "ready_for_contact_path_handoff");
  assert.equal(packet.contactSnapshot.contactMode, "manual");
  assert.equal(packet.safety.sendsOutreach, false);
  assert.equal(packet.safety.editsEnvironment, false);
  assert.equal(packet.safety.storesSecrets, false);
  assert.match(text, /Revenue contact path readiness packet: ready_for_contact_path_handoff/);
  assert.equal(getRevenueContactPathReadinessPacketExitCode(packet), 0);
});

test("contact path readiness packet rejects stale approval after from email changes", () => {
  process.env.RESEND_API_KEY = "resend-test-key";
  process.env.REVENUE_ENGINE_FROM_EMAIL = "sales@example.com";
  const approval = approveContactPath({
    contactMode: "email_provider",
    fromEmail: "sales@example.com",
    emailProviderConfigured: true,
  });
  process.env.REVENUE_ENGINE_FROM_EMAIL = "new-sales@example.com";
  const packet = buildRevenueContactPathReadinessPacketFromCli({
    contactMode: "email_provider",
    approvalDecisionId: approval.decision.id,
    robertApprovedContactPath: true,
    contactPathVerified: true,
    evidenceUrl: "https://github.com/example/repo/actions/runs/456",
    evidenceNote: "Contact path verification passed",
    sendOutreach: false,
    json: false,
  });

  assert.equal(packet.status, "blocked");
  assert.match(packet.blockedReasons.join("; "), /approvalDecisionId valido/);
});

test("contact path readiness packet script exits blocked until gates pass", () => {
  process.env.REVENUE_ENGINE_MANUAL_CONTACT_APPROVED = "true";
  const approval = approveContactPath({
    contactMode: "manual",
    manualContactApproved: true,
  });
  const baseEnv = {
    ...process.env,
    REVENUE_ENGINE_APPROVAL_DECISIONS_PATH: testApprovalDecisionsPath,
    REVENUE_ENGINE_MANUAL_CONTACT_APPROVED: "true",
  };
  const blocked = spawnSync(process.execPath, [
    "--import",
    "tsx",
    "script/revenue-contact-path-readiness-packet.ts",
    "--contact-mode=manual",
    "--evidence-url=https://github.com/example/repo/actions/runs/456",
    "--evidence-note=Contact path verification passed",
  ], {
    cwd: process.cwd(),
    env: baseEnv,
    encoding: "utf8",
  });
  const ready = spawnSync(process.execPath, [
    "--import",
    "tsx",
    "script/revenue-contact-path-readiness-packet.ts",
    "--contact-mode=manual",
    `--approval-decision-id=${approval.decision.id}`,
    "--robert-approved-contact-path",
    "--contact-path-verified",
    "--evidence-url=https://github.com/example/repo/actions/runs/456",
    "--evidence-note=Contact path verification passed",
  ], {
    cwd: process.cwd(),
    env: baseEnv,
    encoding: "utf8",
  });

  assert.equal(blocked.status, 1);
  assert.match(blocked.stdout, /Revenue contact path readiness packet: blocked/);
  assert.equal(ready.status, 0, `${ready.stdout}\n${ready.stderr}`);
  assert.match(ready.stdout, /Revenue contact path readiness packet: ready_for_contact_path_handoff/);
  assert.match(ready.stdout, /Sends outreach: no/);
});
