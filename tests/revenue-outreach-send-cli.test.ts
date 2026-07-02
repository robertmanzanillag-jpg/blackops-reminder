import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import {
  recordRevenueOutreachDraft,
  recordRevenueTrustedApprovalDecision,
  resetRevenueApprovalDecisionsForTests,
  resetRevenueOutreachForTests,
  setRevenueApprovalDecisionsPathForTests,
  setRevenueOutreachPathForTests,
  setRevenueOutreachSenderForTests,
} from "../server/revenue-engine";
import {
  buildRevenueOutreachApprovalTargetId,
  buildRevenueOutreachSnapshotHash,
} from "../server/revenue-outreach-approval";
import {
  formatRevenueOutreachSendText,
  getRevenueOutreachSendExitCode,
  parseRevenueOutreachSendArgs,
  sendRevenueOutreachDraftFromCli,
  validateRevenueOutreachSendOptions,
} from "../server/revenue-outreach-send-cli";

const testOutreachPath = "/tmp/revenue-outreach-send-cli-outreach-test.json";
const testApprovalDecisionsPath = "/tmp/revenue-outreach-send-cli-decisions-test.json";
const originalResendApiKey = process.env.RESEND_API_KEY;
const originalRevenueEngineFromEmail = process.env.REVENUE_ENGINE_FROM_EMAIL;

setRevenueOutreachPathForTests(testOutreachPath);
setRevenueApprovalDecisionsPathForTests(testApprovalDecisionsPath);

test.afterEach(() => {
  resetRevenueOutreachForTests();
  resetRevenueApprovalDecisionsForTests();
  if (originalResendApiKey === undefined) delete process.env.RESEND_API_KEY;
  else process.env.RESEND_API_KEY = originalResendApiKey;
  if (originalRevenueEngineFromEmail === undefined) delete process.env.REVENUE_ENGINE_FROM_EMAIL;
  else process.env.REVENUE_ENGINE_FROM_EMAIL = originalRevenueEngineFromEmail;
});

function createApprovedDraft() {
  return recordRevenueOutreachDraft({
    channel: "email",
    approvalStatus: "approved",
    recipientEmail: "owner@outreachsend.example",
    contactName: "Owner",
    businessName: "Outreach Send Cafe",
    sourceUrl: "https://example.com/outreach-send-cafe",
    businessSummary: "Outreach Send Cafe has public evidence of no dedicated website and needs online menu capture plus catering follow-up.",
    websitePriceUsd: 3500,
    automationPriceUsd: 1200,
    monthlyRetainerUsd: 750,
    estimatedInternalMonthlyCostUsd: 54,
    notes: "",
  }).draft;
}

function approveDraft(draft: ReturnType<typeof createApprovedDraft>) {
  return recordRevenueTrustedApprovalDecision({
    targetId: buildRevenueOutreachApprovalTargetId(draft.id),
    targetType: "outbox",
    decision: "approved",
    approvedAction: "Approve exact outreach draft for provider send.",
    maxSpendUsd: 0,
    notes: "Robert approved the final outreach copy.",
    approvalSource: "outreach_approval_cli",
    publicCandidateSnapshotHash: "",
    outreachDraftSnapshotHash: buildRevenueOutreachSnapshotHash(draft),
    websiteCreationSnapshotHash: "",
    websitePublishSnapshotHash: "",
    paymentPathSnapshotHash: "",
    contactPathSnapshotHash: "",
    ledgerEntrySnapshotHash: "",
  });
}

test("parses and validates outreach send CLI options", () => {
  const parsed = parseRevenueOutreachSendArgs([
    "--draft-id=outreach-1",
    "--approval-decision-id=approval-1",
    "--confirm-send=SEND outreach-1 approval-1",
    "--confirmed-by-robert",
    "--json",
  ]);

  assert.deepEqual(parsed, {
    draftId: "outreach-1",
    approvalDecisionId: "approval-1",
    sendConfirmation: "SEND outreach-1 approval-1",
    confirmedByRobert: true,
    json: true,
  });
  assert.deepEqual(validateRevenueOutreachSendOptions(parsed), []);
  assert.deepEqual(validateRevenueOutreachSendOptions(parseRevenueOutreachSendArgs([])), [
    "--draft-id is required.",
    "--approval-decision-id is required.",
    "--confirmed-by-robert is required before contacting a business.",
    "--confirm-send is required and must be typed from fresh Robert send approval.",
  ]);
  assert.deepEqual(validateRevenueOutreachSendOptions(parseRevenueOutreachSendArgs([
    "--draft-id=DRAFT_ID",
    "--approval-decision-id=APPROVAL_DECISION_ID",
    "--confirm-send=SEND DRAFT_ID APPROVAL_DECISION_ID",
    "--confirmed-by-robert",
  ])), [
    "--draft-id must be a real outreach draft id, not a placeholder.",
    "--approval-decision-id must be a real outreach approval decision id, not a placeholder.",
    "--confirm-send must be real send approval context, not a placeholder.",
  ]);
  assert.deepEqual(validateRevenueOutreachSendOptions(parseRevenueOutreachSendArgs([
    "--draft-id=outreach-1",
    "--approval-decision-id=approval-1",
    "--confirm-send=SEND wrong approval-1",
    "--confirmed-by-robert",
  ])), [
    "--confirm-send must exactly equal \"SEND outreach-1 approval-1\".",
  ]);
});

test("direct builder blocks before touching outreach when Robert confirmation is missing", async () => {
  process.env.RESEND_API_KEY = "re_test";
  process.env.REVENUE_ENGINE_FROM_EMAIL = "Revenue Engine <sales@example.com>";
  const draft = createApprovedDraft();
  const approval = approveDraft(draft);
  const result = await sendRevenueOutreachDraftFromCli({
    draftId: draft.id,
    approvalDecisionId: approval.decision.id,
    sendConfirmation: `SEND ${draft.id} ${approval.decision.id}`,
    confirmedByRobert: false,
    json: false,
  });

  assert.equal(result.status, "blocked");
  assert.match(result.reason, /--confirmed-by-robert/);
  assert.equal(result.draft, null);
  assert.equal(result.safety.sendsOutreach, false);
  assert.equal(getRevenueOutreachSendExitCode(result), 1);
});

test("outreach send CLI blocks through provider gates without sending or charging", async () => {
  const draft = createApprovedDraft();
  const approval = approveDraft(draft);
  const result = await sendRevenueOutreachDraftFromCli({
    draftId: draft.id,
    approvalDecisionId: approval.decision.id,
    sendConfirmation: `SEND ${draft.id} ${approval.decision.id}`,
    confirmedByRobert: true,
    json: false,
  });
  const text = formatRevenueOutreachSendText(result);

  assert.equal(result.status, "blocked");
  assert.equal(result.provider?.configured, false);
  assert.equal(result.draft?.delivery.sendStatus, "provider_missing");
  assert.equal(result.safety.sendsOutreach, false);
  assert.equal(result.safety.chargesClients, false);
  assert.equal(result.safety.deploys, false);
  assert.match(text, /Provider configured: no/);
  assert.match(text, /Sends outreach: no/);
  assert.equal(getRevenueOutreachSendExitCode(result), 1);
});

test("outreach send CLI sends only after exact approval, provider and Robert confirmation", async () => {
  process.env.RESEND_API_KEY = "re_test";
  process.env.REVENUE_ENGINE_FROM_EMAIL = "Revenue Engine <sales@example.com>";
  let sentTo = "";
  setRevenueOutreachSenderForTests(async (payload) => {
    sentTo = payload.to;
    return { id: "email_cli_send_123" };
  });
  const draft = createApprovedDraft();
  const approval = approveDraft(draft);
  const result = await sendRevenueOutreachDraftFromCli({
    draftId: draft.id,
    approvalDecisionId: approval.decision.id,
    sendConfirmation: `SEND ${draft.id} ${approval.decision.id}`,
    confirmedByRobert: true,
    json: false,
  });

  assert.equal(result.status, "sent");
  assert.equal(sentTo, "owner@outreachsend.example");
  assert.equal(result.draft.delivery.sendStatus, "sent");
  assert.equal(result.draft.delivery.externalMessageId, "email_cli_send_123");
  assert.equal(result.safety.sendsOutreach, true);
  assert.equal(result.safety.chargesClients, false);
  assert.equal(getRevenueOutreachSendExitCode(result), 0);
});

test("outreach send script rejects missing Robert confirmation before provider send", () => {
  const draft = createApprovedDraft();
  const approval = approveDraft(draft);
  const run = spawnSync(process.execPath, [
    "--import",
    "tsx",
    "script/revenue-outreach-send.ts",
    `--draft-id=${draft.id}`,
    `--approval-decision-id=${approval.decision.id}`,
  ], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      REVENUE_ENGINE_OUTREACH_PATH: testOutreachPath,
      REVENUE_ENGINE_APPROVAL_DECISIONS_PATH: testApprovalDecisionsPath,
      RESEND_API_KEY: "re_test",
      REVENUE_ENGINE_FROM_EMAIL: "Revenue Engine <sales@example.com>",
    },
    encoding: "utf8",
  });

  assert.equal(run.status, 1);
  assert.match(run.stderr, /--confirmed-by-robert is required before contacting a business/);
  assert.equal(run.stdout, "");
});

test("outreach send script rejects missing typed send confirmation before provider send", () => {
  const draft = createApprovedDraft();
  const approval = approveDraft(draft);
  const run = spawnSync(process.execPath, [
    "--import",
    "tsx",
    "script/revenue-outreach-send.ts",
    `--draft-id=${draft.id}`,
    `--approval-decision-id=${approval.decision.id}`,
    "--confirmed-by-robert",
  ], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      REVENUE_ENGINE_OUTREACH_PATH: testOutreachPath,
      REVENUE_ENGINE_APPROVAL_DECISIONS_PATH: testApprovalDecisionsPath,
      RESEND_API_KEY: "re_test",
      REVENUE_ENGINE_FROM_EMAIL: "Revenue Engine <sales@example.com>",
    },
    encoding: "utf8",
  });

  assert.equal(run.status, 1);
  assert.match(run.stderr, /--confirm-send is required/);
  assert.equal(run.stdout, "");
});
