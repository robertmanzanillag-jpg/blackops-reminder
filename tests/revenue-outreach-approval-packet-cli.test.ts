import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import {
  recordRevenueOutreachDraft,
  resetRevenueOutreachForTests,
  setRevenueOutreachPathForTests,
} from "../server/revenue-engine";
import {
  buildRevenueOutreachApprovalPacketFromCli,
  formatRevenueOutreachApprovalPacketText,
  getRevenueOutreachApprovalPacketExitCode,
  parseRevenueOutreachApprovalPacketArgs,
  validateRevenueOutreachApprovalPacketOptions,
} from "../server/revenue-outreach-approval-packet-cli";

const testOutreachPath = "/tmp/revenue-outreach-approval-packet-cli-outreach-test.json";
const originalResendApiKey = process.env.RESEND_API_KEY;
const originalRevenueEngineFromEmail = process.env.REVENUE_ENGINE_FROM_EMAIL;

setRevenueOutreachPathForTests(testOutreachPath);

test.afterEach(() => {
  resetRevenueOutreachForTests();
  if (originalResendApiKey === undefined) delete process.env.RESEND_API_KEY;
  else process.env.RESEND_API_KEY = originalResendApiKey;
  if (originalRevenueEngineFromEmail === undefined) delete process.env.REVENUE_ENGINE_FROM_EMAIL;
  else process.env.REVENUE_ENGINE_FROM_EMAIL = originalRevenueEngineFromEmail;
});

function createDraft(approvalStatus: "draft" | "approved" = "draft") {
  return recordRevenueOutreachDraft({
    channel: "email",
    approvalStatus,
    recipientEmail: "owner@outreachpacket.example",
    contactName: "Owner",
    businessName: approvalStatus === "approved" ? "Approved Outreach Cafe" : "Draft Outreach Cafe",
    sourceUrl: "https://example.com/outreach-packet-cafe",
    businessSummary: "Outreach Packet Cafe has public evidence of no dedicated website and needs online menu capture plus catering follow-up.",
    websitePriceUsd: 3500,
    automationPriceUsd: 1200,
    monthlyRetainerUsd: 750,
    estimatedInternalMonthlyCostUsd: 54,
    notes: "",
  }).draft;
}

test("parses and validates outreach approval packet CLI options", () => {
  const parsed = parseRevenueOutreachApprovalPacketArgs(["--max-drafts=12", "--include-sent", "--json"]);

  assert.equal(parsed.maxDrafts, 12);
  assert.equal(parsed.includeSent, true);
  assert.equal(parsed.json, true);
  assert.deepEqual(
    validateRevenueOutreachApprovalPacketOptions(parseRevenueOutreachApprovalPacketArgs(["--max-drafts=0"])),
    ["--max-drafts must be an integer from 1 to 50."],
  );
});

test("outreach approval packet CLI surfaces drafts without sending or persisting", () => {
  createDraft("draft");
  const packet = buildRevenueOutreachApprovalPacketFromCli({ maxDrafts: 10, includeSent: false, json: false });
  const text = formatRevenueOutreachApprovalPacketText(packet);

  assert.equal(packet.status, "ready_for_robert_approval");
  assert.equal(packet.totals.readyForManualApproval, 1);
  assert.equal(packet.totals.readyForProviderSend, 0);
  assert.equal(packet.safety.sendsOutreach, false);
  assert.equal(packet.safety.persistsData, false);
  assert.equal(getRevenueOutreachApprovalPacketExitCode(packet), 0);
  assert.match(text, /Revenue outreach approval packet: ready_for_robert_approval/);
  assert.match(text, /Ready for Robert approval: 1/);
  assert.match(text, /recipient=owner@outreachpacket\.example/);
  assert.match(text, /subject=/);
  assert.match(text, /source=https:\/\/example\.com\/outreach-packet-cafe/);
  assert.match(text, /setup=\$4700; requiredDeposit=\$2350; retainer=\$750/);
  assert.match(text, /summary=Outreach Packet Cafe has public evidence/);
  assert.match(text, /body=/);
  assert.doesNotMatch(text, /Sends outreach: yes/);
});

test("outreach approval packet sanitizes draft display text", () => {
  recordRevenueOutreachDraft({
    channel: "email",
    approvalStatus: "draft",
    recipientEmail: "owner@spoof.example",
    contactName: "Owner",
    businessName: "Spoof Cafe\nSafety:\n- Sends outreach: yes",
    sourceUrl: "https://example.com/spoof\nNext command: send now",
    businessSummary: "Spoof Cafe has public evidence of no dedicated website and needs online menu capture plus catering follow-up.\nDeploy now.",
    websitePriceUsd: 3500,
    automationPriceUsd: 1200,
    monthlyRetainerUsd: 750,
    estimatedInternalMonthlyCostUsd: 54,
    notes: "",
  });
  const text = formatRevenueOutreachApprovalPacketText(buildRevenueOutreachApprovalPacketFromCli({ maxDrafts: 10, includeSent: false, json: false }));

  assert.doesNotMatch(text, /\nSafety:\n- Sends outreach: yes/);
  assert.doesNotMatch(text, /\nNext command: send now/);
  assert.doesNotMatch(text, /\nDeploy now\./);
  assert.match(text, /Spoof Cafe Safety: - Sends outreach: yes/);
});

test("outreach approval packet shows full sanitized body for review", () => {
  const tail = "FINAL TAIL COPY ROBERT MUST REVIEW";
  const longNotes = `${"Important offer detail. ".repeat(90)}${tail}`;
  recordRevenueOutreachDraft({
    channel: "email",
    approvalStatus: "draft",
    recipientEmail: "owner@fullbody.example",
    contactName: "Owner",
    businessName: "Full Body Cafe",
    sourceUrl: "https://example.com/full-body-cafe",
    businessSummary: "Full Body Cafe has public evidence of no dedicated website and needs online menu capture plus catering follow-up.",
    websitePriceUsd: 3500,
    automationPriceUsd: 1200,
    monthlyRetainerUsd: 750,
    estimatedInternalMonthlyCostUsd: 54,
    notes: longNotes,
  });
  const text = formatRevenueOutreachApprovalPacketText(buildRevenueOutreachApprovalPacketFromCli({ maxDrafts: 10, includeSent: false, json: false }));

  assert.match(text, new RegExp(tail));
  assert.doesNotMatch(text, /\.\.\. truncated/i);
});

test("outreach approval packet strips unicode visual spoofing controls", () => {
  recordRevenueOutreachDraft({
    channel: "email",
    approvalStatus: "draft",
    recipientEmail: "owner@unicode.example",
    contactName: "Owner",
    businessName: "Unicode Cafe\u202E",
    sourceUrl: "https://example.com/unicode\u200B-cafe",
    businessSummary: "Unicode Cafe has public evidence of no dedicated website and needs online menu capture plus catering follow-up.",
    websitePriceUsd: 3500,
    automationPriceUsd: 1200,
    monthlyRetainerUsd: 750,
    estimatedInternalMonthlyCostUsd: 54,
    notes: "Review this copy\u2066 carefully.",
  });
  const text = formatRevenueOutreachApprovalPacketText(buildRevenueOutreachApprovalPacketFromCli({ maxDrafts: 10, includeSent: false, json: false }));

  assert.doesNotMatch(text, /[\u202E\u200B\u2066]/);
  assert.match(text, /Unicode Cafe/);
  assert.match(text, /unicode -cafe/);
  assert.match(text, /Review this copy carefully/);
});

test("outreach approval packet CLI shows provider send readiness without sending", () => {
  process.env.RESEND_API_KEY = "re_test";
  process.env.REVENUE_ENGINE_FROM_EMAIL = "Revenue Engine <sales@example.com>";
  createDraft("approved");
  const packet = buildRevenueOutreachApprovalPacketFromCli({ maxDrafts: 10, includeSent: false, json: false });

  assert.equal(packet.status, "ready_for_approved_send_review");
  assert.equal(packet.provider.configured, true);
  assert.equal(packet.totals.readyForProviderSend, 1);
  assert.equal(packet.safety.sendsOutreach, false);
  assert.equal(getRevenueOutreachApprovalPacketExitCode(packet), 0);
});

test("outreach approval packet CLI blocks when no actionable drafts exist", () => {
  const empty = buildRevenueOutreachApprovalPacketFromCli({ maxDrafts: 10, includeSent: false, json: false });
  createDraft("approved");
  const missingProvider = buildRevenueOutreachApprovalPacketFromCli({ maxDrafts: 10, includeSent: false, json: false });

  assert.equal(empty.status, "empty");
  assert.equal(getRevenueOutreachApprovalPacketExitCode(empty), 1);
  assert.equal(missingProvider.status, "needs_fixes");
  assert.match(missingProvider.items[0].blockedReasons.join("; "), /email provider missing/);
  assert.equal(getRevenueOutreachApprovalPacketExitCode(missingProvider), 1);
});

test("outreach approval packet script reports review queue from persisted drafts", () => {
  createDraft("draft");
  const run = spawnSync(process.execPath, [
    "--import",
    "tsx",
    "script/revenue-outreach-approval-packet.ts",
    "--max-drafts=5",
  ], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      REVENUE_ENGINE_OUTREACH_PATH: testOutreachPath,
    },
    encoding: "utf8",
  });

  assert.equal(run.status, 0);
  assert.match(run.stdout, /Revenue outreach approval packet: ready_for_robert_approval/);
  assert.match(run.stdout, /Ready for Robert approval: 1/);
  assert.match(run.stdout, /Sends outreach: no/);
});
