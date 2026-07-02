import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import {
  listRevenueApprovalDecisions,
  resetRevenueApprovalDecisionsForTests,
  setRevenueApprovalDecisionsPathForTests,
} from "../server/revenue-engine";
import {
  buildRevenueContactPathApprovalDecisionFromCli,
  formatRevenueContactPathApprovalDecisionText,
  getRevenueContactPathApprovalDecisionExitCode,
  parseRevenueContactPathApprovalDecisionArgs,
  validateRevenueContactPathApprovalDecisionOptions,
} from "../server/revenue-contact-path-approval-decision-cli";

const testApprovalDecisionsPath = "/tmp/revenue-contact-path-approval-decisions-test.json";

setRevenueApprovalDecisionsPathForTests(testApprovalDecisionsPath);

test.afterEach(() => {
  resetRevenueApprovalDecisionsForTests();
});

test("parses and validates contact path approval decision options", () => {
  const parsed = parseRevenueContactPathApprovalDecisionArgs([
    "--contact-mode=email_provider",
    "--from-email=sales@example.com",
    "--email-provider-configured",
    "--decision=approved",
    "--approved-action=Approve contact path.",
    "--robert-approved-contact-path",
    "--contact-path-verified",
    "--evidence-url=https://github.com/example/repo/actions/runs/456",
    "--evidence-note=Resend sender domain verified",
    "--confirmed-by-robert",
    "--json",
  ]);

  assert.equal(parsed.contactMode, "email_provider");
  assert.equal(parsed.fromEmail, "sales@example.com");
  assert.equal(parsed.emailProviderConfigured, true);
  assert.equal(parsed.decision, "approved");
  assert.equal(parsed.robertApprovedContactPath, true);
  assert.equal(parsed.contactPathVerified, true);
  assert.equal(parsed.confirmedByRobert, true);
  assert.deepEqual(validateRevenueContactPathApprovalDecisionOptions(parsed), []);
  assert.deepEqual(validateRevenueContactPathApprovalDecisionOptions(parseRevenueContactPathApprovalDecisionArgs([])), [
    "--evidence-url is required.",
    "--evidence-note must describe the contact path proof.",
  ]);
  assert.deepEqual(validateRevenueContactPathApprovalDecisionOptions(parseRevenueContactPathApprovalDecisionArgs([
    "--contact-mode=email_provider",
    "--from-email=not-email",
    "--evidence-url=not-a-url",
    "--evidence-note=Proof exists",
  ])), [
    "--from-email must be a valid email when provided.",
    "--evidence-url must be a valid URL.",
  ]);
  assert.deepEqual(validateRevenueContactPathApprovalDecisionOptions(parseRevenueContactPathApprovalDecisionArgs([
    "--evidence-url=https://example.com/REPLACE_WITH_CONTACT_PATH_EVIDENCE_URL",
    "--evidence-note=REPLACE_WITH_CONTACT_PATH_PROOF",
  ])), [
    "--evidence-url must be real evidence, not a placeholder.",
    "--evidence-note must be real proof, not a placeholder.",
  ]);
});

test("records approved contact path decision without sending outreach or leaking email in target", () => {
  const result = buildRevenueContactPathApprovalDecisionFromCli({
    contactMode: "email_provider",
    fromEmail: "sales@example.com",
    manualContactApproved: false,
    emailProviderConfigured: true,
    decision: "approved",
    approvedAction: "Approve contact path.",
    robertApprovedContactPath: true,
    contactPathVerified: true,
    evidenceUrl: "https://github.com/example/repo/actions/runs/456",
    evidenceNote: "Resend sender domain verified",
    confirmedByRobert: true,
    sendOutreach: false,
    json: false,
  });
  const text = formatRevenueContactPathApprovalDecisionText(result);

  assert.equal(result.status, "recorded");
  assert.equal(result.decision?.targetType, "contact_path");
  assert.equal(result.decision?.approvalSource, "contact_path_approval_cli");
  assert.doesNotMatch(result.decision?.targetId || "", /sales@example\.com/);
  assert.match(result.decision?.contactPathSnapshotHash || "", /^[a-f0-9]{64}$/);
  assert.equal(result.safety.sendsOutreach, false);
  assert.equal(result.safety.editsEnvironment, false);
  assert.equal(result.safety.storesSecrets, false);
  assert.equal(listRevenueApprovalDecisions().length, 1);
  assert.match(result.nextCommand, /revenue:contact-path-readiness-packet/);
  assert.match(text, /Sends outreach: no/);
  assert.equal(getRevenueContactPathApprovalDecisionExitCode(result), 0);
});

test("blocks approved contact path decision without Robert confirmation or verification", () => {
  const result = buildRevenueContactPathApprovalDecisionFromCli({
    contactMode: "manual",
    fromEmail: "",
    manualContactApproved: false,
    emailProviderConfigured: false,
    decision: "approved",
    approvedAction: "Approve contact path.",
    robertApprovedContactPath: false,
    contactPathVerified: false,
    evidenceUrl: "https://github.com/example/repo/actions/runs/456",
    evidenceNote: "Manual Gmail path verified",
    confirmedByRobert: false,
    sendOutreach: true,
    json: false,
  });

  assert.equal(result.status, "blocked");
  assert.equal(result.decision, null);
  assert.match(result.blockers.join("; "), /--confirmed-by-robert/);
  assert.match(result.blockers.join("; "), /--send-outreach/);
  assert.match(result.blockers.join("; "), /--manual-contact-approved/);
  assert.match(result.blockers.join("; "), /--contact-path-verified/);
  assert.equal(result.safety.persistsApprovalDecision, false);
  assert.equal(listRevenueApprovalDecisions().length, 0);
});

test("contact path approval decision script persists safe decision", () => {
  const result = spawnSync(process.execPath, [
    "--import",
    "tsx",
    "script/revenue-contact-path-approval-decision.ts",
    "--contact-mode=manual",
    "--manual-contact-approved",
    "--decision=approved",
    "--approved-action=Approve contact path.",
    "--robert-approved-contact-path",
    "--contact-path-verified",
    "--evidence-url=https://github.com/example/repo/actions/runs/456",
    "--evidence-note=Manual Gmail path verified",
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
  assert.match(result.stdout, /Revenue contact path approval decision: recorded/);
  assert.match(result.stdout, /revenue:contact-path-readiness-packet/);
  assert.match(result.stdout, /Sends outreach: no/);
});
