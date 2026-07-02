import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import test from "node:test";
import {
  getRevenueEngineSnapshot,
  resetRevenueLeadsForTests,
  resetRevenueOutreachForTests,
  setRevenueLeadsPathForTests,
  setRevenueOutreachPathForTests,
} from "../server/revenue-engine";
import {
  buildRevenueMoneySprintRunPacketExecution,
  formatRevenueMoneySprintRunPacketExecutionText,
  getRevenueMoneySprintRunPacketExitCode,
  parseRevenueMoneySprintRunPacketArgs,
  validateRevenueMoneySprintRunPacketOptions,
  validateRevenueMoneySprintRunPacketReview,
} from "../server/revenue-money-sprint-run-packet-cli";

const testLeadsPath = "/tmp/revenue-money-sprint-run-packet-cli-leads-test.json";
const testOutreachPath = "/tmp/revenue-money-sprint-run-packet-cli-outreach-test.json";
const testPacketPath = "/tmp/revenue-money-sprint-run-packet-cli-packet-test.json";

setRevenueLeadsPathForTests(testLeadsPath);
setRevenueOutreachPathForTests(testOutreachPath);

test.afterEach(() => {
  resetRevenueLeadsForTests();
  resetRevenueOutreachForTests();
});

function reviewPacket(overrides: Record<string, unknown> = {}) {
  return {
    status: "ready_for_money_sprint_preview",
    nextApiAction: "human_review_money_sprint_packet",
    approvedCount: 1,
    moneySprintRunPacket: {
      status: "ready_for_money_sprint_run",
      endpoint: "/api/revenue-engine/money-sprint",
      method: "POST",
      requestBody: {
        area: "Miami",
        niche: "coffee shop",
        offerFocus: "websites",
        dailyResearchTarget: 20,
        dailyQualifiedLeadLimit: 5,
        dailyMockupLimit: 2,
        dailyContactLimit: 2,
        maxPaidDataSpendUsd: 0,
        requireRobertApprovalToContact: true,
        writePreviewFiles: false,
        seedLeads: [],
        seedLeadBatchText: [
          "business|area|niche|website|channel|contact|sourceUrl|recipientEmail|evidence|painPoint|offer|contactName|summary",
          "Run Packet Cafe|Miami|coffee shop|no_website|email|owner@runpacketcafe.example|https://example.com/run-packet-cafe|owner@runpacketcafe.example|Public listing has no website, recent menu photos and a visible public owner email.|Needs online menu capture and follow-up.|3600|Owner|Run Packet Cafe has no dedicated website and a clear menu/catering opportunity.",
        ].join("\n"),
      },
      safety: {
        sendsOutreach: false,
        writesPreviewFiles: false,
        paidDataSpendUsd: 0,
        requiresRobertApprovalBeforeRun: true,
        requiresRobertApprovalBeforeContact: true,
      },
      expectedOutput: {
        acceptedLeads: 1,
        mockupsToPrepare: 1,
        outreachDraftsToCreate: 1,
      },
    },
    ...overrides,
  };
}

test("parses and validates money sprint run packet CLI options", () => {
  assert.deepEqual(parseRevenueMoneySprintRunPacketArgs(["--input=/tmp/packet.json", "--execute", "--approved-by-robert", "--json"]), {
    inputPath: "/tmp/packet.json",
    execute: true,
    approvedByRobert: true,
    json: true,
  });
  assert.deepEqual(validateRevenueMoneySprintRunPacketOptions(parseRevenueMoneySprintRunPacketArgs([])), [
    "--input is required.",
  ]);
  assert.deepEqual(validateRevenueMoneySprintRunPacketOptions(parseRevenueMoneySprintRunPacketArgs(["--input=/tmp/packet.json", "--execute"])), [
    "--approved-by-robert is required with --execute.",
  ]);
});

test("validates packet safety before execution", () => {
  const unsafe = reviewPacket({
    nextApiAction: "/api/revenue-engine/money-sprint",
    moneySprintRunPacket: {
      ...reviewPacket().moneySprintRunPacket,
      requestBody: {
        ...reviewPacket().moneySprintRunPacket.requestBody,
        maxPaidDataSpendUsd: 25,
        requireRobertApprovalToContact: false,
        writePreviewFiles: true,
      },
      safety: {
        sendsOutreach: true,
        writesPreviewFiles: true,
        paidDataSpendUsd: 25,
        requiresRobertApprovalBeforeRun: false,
        requiresRobertApprovalBeforeContact: false,
      },
    },
  });
  const validation = validateRevenueMoneySprintRunPacketReview(unsafe);

  assert.match(validation.errors.join("; "), /nextApiAction must be human_review_money_sprint_packet/);
  assert.match(validation.errors.join("; "), /requestBody.maxPaidDataSpendUsd must be 0/);
  assert.match(validation.errors.join("; "), /requestBody.requireRobertApprovalToContact must be true/);
  assert.match(validation.errors.join("; "), /packet safety sendsOutreach must be false/);
});

test("blocks tampered packet when batch row count does not match approved count", () => {
  const base = reviewPacket();
  const tampered = reviewPacket({
    moneySprintRunPacket: {
      ...base.moneySprintRunPacket,
      requestBody: {
        ...base.moneySprintRunPacket.requestBody,
        seedLeadBatchText: [
          base.moneySprintRunPacket.requestBody.seedLeadBatchText,
          "Extra Cafe|Miami|coffee shop|no_website|email|owner@extra.example|https://example.com/extra|owner@extra.example|Public listing has no website and a visible public contact path.|Needs online ordering.|3600|Owner|Extra injected row.",
        ].join("\n"),
      },
    },
  });
  const validation = validateRevenueMoneySprintRunPacketReview(tampered);

  assert.match(validation.errors.join("; "), /seedLeadBatchText row count must match approvedCount/);
});

test("blocks tampered packet when row count matches but preview is not importable", () => {
  const base = reviewPacket();
  const tampered = reviewPacket({
    moneySprintRunPacket: {
      ...base.moneySprintRunPacket,
      requestBody: {
        ...base.moneySprintRunPacket.requestBody,
        seedLeadBatchText: [
          "business|area|niche|website|channel|contact|sourceUrl|recipientEmail|evidence|painPoint|offer|contactName|summary",
          "Bad Packet Row|Miami|coffee shop|unknown|unknown||notaurl||short|Needs review.|3600|Owner|",
        ].join("\n"),
      },
      expectedOutput: {
        acceptedLeads: 1,
        mockupsToPrepare: 1,
        outreachDraftsToCreate: 1,
      },
    },
  });
  const validation = validateRevenueMoneySprintRunPacketReview(tampered);

  assert.match(validation.errors.join("; "), /money sprint preview must be ready_to_import/);
  assert.match(validation.errors.join("; "), /money sprint preview accepted count must match approvedCount/);
  assert.match(validation.errors.join("; "), /money sprint preview must not contain blocked rows/);
});

test("blocks mixed packet when one accepted row is not draft-ready", () => {
  const base = reviewPacket();
  const mixed = reviewPacket({
    approvedCount: 2,
    moneySprintRunPacket: {
      ...base.moneySprintRunPacket,
      requestBody: {
        ...base.moneySprintRunPacket.requestBody,
        seedLeadBatchText: [
          base.moneySprintRunPacket.requestBody.seedLeadBatchText,
          "Mixed Bad Cafe|Miami|coffee shop|unknown|unknown|owner@mixedbad.example|https://example.com/mixed-bad|owner@mixedbad.example|Public listing has some activity but the website/contact fit still needs manual review.|Needs review before outreach.|3600|Owner|Mixed Bad Cafe still needs qualification review.",
        ].join("\n"),
      },
      expectedOutput: {
        acceptedLeads: 2,
        mockupsToPrepare: 1,
        outreachDraftsToCreate: 1,
      },
    },
  });
  const validation = validateRevenueMoneySprintRunPacketReview(mixed);

  assert.match(validation.errors.join("; "), /money sprint preview draftReady count must match approvedCount/);
  assert.match(validation.errors.join("; "), /money sprint preview contains non-draft-ready rows: Mixed Bad Cafe/);
});

test("dry-run validates packet without persisting leads or drafts", () => {
  const result = buildRevenueMoneySprintRunPacketExecution(reviewPacket(), { execute: false, approvedByRobert: false });
  const snapshot = getRevenueEngineSnapshot();

  assert.equal(result.status, "ready_to_execute");
  assert.equal(result.executed, false);
  assert.equal(result.safety.persistsLeads, false);
  assert.equal(snapshot.recentLeads.length, 0);
  assert.equal(snapshot.recentOutreach.length, 0);
  assert.equal(getRevenueMoneySprintRunPacketExitCode(result), 0);
  assert.match(formatRevenueMoneySprintRunPacketExecutionText(result), /Rerun with --execute --approved-by-robert/);
});

test("execution requires explicit approval and creates draft-only revenue artifacts", () => {
  const blocked = buildRevenueMoneySprintRunPacketExecution(reviewPacket(), { execute: true, approvedByRobert: false });
  assert.equal(blocked.status, "blocked");
  assert.equal(blocked.executed, false);

  const result = buildRevenueMoneySprintRunPacketExecution(reviewPacket(), { execute: true, approvedByRobert: true });
  const snapshot = getRevenueEngineSnapshot();

  assert.equal(result.status, "executed");
  assert.equal(result.executed, true);
  assert.equal(result.result?.recordedLeads.length, 1);
  assert.equal(result.result?.previews.length, 1);
  assert.equal(result.result?.previews[0].fileWritten, false);
  assert.equal(result.result?.outreachDrafts.length, 1);
  assert.equal(result.result?.outreachDrafts[0].delivery.sendStatus, "not_sent");
  assert.equal(result.safety.writesPreviewFiles, false);
  assert.equal(result.safety.sendsOutreach, false);
  assert.equal(snapshot.recentLeads.length, 1);
  assert.equal(snapshot.recentOutreach.length, 1);
});

test("money sprint run packet script dry-runs and executes only with approval", () => {
  writeFileSync(testPacketPath, `${JSON.stringify(reviewPacket(), null, 2)}\n`, "utf8");
  const baseEnv = {
    ...process.env,
    REVENUE_ENGINE_LEADS_PATH: testLeadsPath,
    REVENUE_ENGINE_OUTREACH_PATH: testOutreachPath,
  };
  const dryRun = spawnSync(process.execPath, [
    "--import",
    "tsx",
    "script/revenue-money-sprint-run-packet.ts",
    `--input=${testPacketPath}`,
  ], {
    cwd: process.cwd(),
    env: baseEnv,
    encoding: "utf8",
  });
  const missingApproval = spawnSync(process.execPath, [
    "--import",
    "tsx",
    "script/revenue-money-sprint-run-packet.ts",
    `--input=${testPacketPath}`,
    "--execute",
  ], {
    cwd: process.cwd(),
    env: baseEnv,
    encoding: "utf8",
  });
  const execute = spawnSync(process.execPath, [
    "--import",
    "tsx",
    "script/revenue-money-sprint-run-packet.ts",
    `--input=${testPacketPath}`,
    "--execute",
    "--approved-by-robert",
  ], {
    cwd: process.cwd(),
    env: baseEnv,
    encoding: "utf8",
  });

  assert.equal(dryRun.status, 0);
  assert.match(dryRun.stdout, /Revenue money sprint run packet: ready_to_execute/);
  assert.match(dryRun.stdout, /Executed: no/);
  assert.equal(missingApproval.status, 1);
  assert.match(missingApproval.stderr, /--approved-by-robert is required with --execute/);
  assert.equal(execute.status, 0);
  assert.match(execute.stdout, /Revenue money sprint run packet: executed/);
  assert.match(execute.stdout, /Recorded leads: 1/);
  assert.match(execute.stdout, /Outreach drafts: 1/);
  assert.doesNotMatch(execute.stdout, /Sends outreach: yes/);
});
