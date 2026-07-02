import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import test from "node:test";
import {
  getRevenueEngineSnapshot,
  recordRevenuePublicScoutRun,
  resetRevenueLeadsForTests,
  resetRevenueOutreachForTests,
  resetRevenuePublicLeadCandidatesForTests,
  setRevenueLeadsPathForTests,
  setRevenueOutreachPathForTests,
  setRevenuePublicLeadCandidatesPathForTests,
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
const testPublicCandidatesPath = "/tmp/revenue-money-sprint-run-packet-cli-public-candidates-test.json";
const testPacketPath = "/tmp/revenue-money-sprint-run-packet-cli-packet-test.json";

setRevenueLeadsPathForTests(testLeadsPath);
setRevenueOutreachPathForTests(testOutreachPath);
setRevenuePublicLeadCandidatesPathForTests(testPublicCandidatesPath);

test.afterEach(() => {
  candidateSequence = 0;
  resetRevenueLeadsForTests();
  resetRevenueOutreachForTests();
  resetRevenuePublicLeadCandidatesForTests();
});

let candidateSequence = 0;

function captureRunPacketCandidate(overrides: Partial<{
  businessName: string;
  recipientEmail: string;
  contactValue: string;
  sourceUrl: string;
  evidence: string;
  verificationStatus: "needs_review" | "verified_public" | "blocked";
  publicEvidenceVerified: boolean;
}> = {}) {
  candidateSequence += 1;
  const suffix = `${candidateSequence}`;
  const businessName = overrides.businessName || `Run Packet Cafe ${suffix}`;
  const recipientEmail = overrides.recipientEmail || `owner${suffix}@runpacketcafe.example`;
  const sourceUrl = overrides.sourceUrl || `https://example.com/run-packet-cafe-${suffix}`;
  const capture = recordRevenuePublicScoutRun({
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
    candidates: [
      {
        businessName,
        area: "Miami",
        niche: "coffee shop",
        websiteStatus: "no_website",
        contactChannel: "email",
        contactValue: overrides.contactValue || recipientEmail,
        sourceUrl,
        recipientEmail,
        evidence: overrides.evidence || "Public listing has no website, recent menu photos and a visible public owner email.",
        painPoint: "Needs online menu capture and follow-up.",
        estimatedOfferUsd: 3600,
        status: "research",
        verificationStatus: overrides.verificationStatus || "verified_public",
        publicEvidenceVerified: overrides.publicEvidenceVerified ?? true,
        approvalToImport: false,
      },
    ],
  });
  return capture.recordedCandidates[0].candidate;
}

function reviewPacket(overrides: Record<string, unknown> = {}, candidates = [captureRunPacketCandidate()]) {
  const seedLeadBatchText = [
    "business|area|niche|website|channel|contact|sourceUrl|recipientEmail|evidence|painPoint|offer|contactName|summary",
    ...candidates.map((candidate) => candidate.batchRow),
  ].join("\n");
  return {
    status: "ready_for_money_sprint_preview",
    nextApiAction: "human_review_money_sprint_packet",
    approvedByRobert: true,
    requestedCount: candidates.length,
    foundCount: candidates.length,
    approvedCount: candidates.length,
    missingIds: [],
    duplicateIds: [],
    reviewedCandidates: candidates.map((candidate) => ({
      candidateId: candidate.id,
      businessName: candidate.businessName,
      approvedForPreview: true,
      blockedReasons: [],
      grade: "A",
      score: 90,
    })),
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
        seedLeadBatchText,
      },
      safety: {
        sendsOutreach: false,
        writesPreviewFiles: false,
        paidDataSpendUsd: 0,
        requiresRobertApprovalBeforeRun: true,
        requiresRobertApprovalBeforeContact: true,
      },
      expectedOutput: {
        acceptedLeads: candidates.length,
        mockupsToPrepare: candidates.length,
        outreachDraftsToCreate: candidates.length,
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

test("blocks forged packet without explicit complete Robert-approved review", () => {
  const forged = reviewPacket({
    approvedByRobert: false,
    missingIds: undefined,
    duplicateIds: undefined,
    reviewedCandidates: undefined,
  });
  const validation = validateRevenueMoneySprintRunPacketReview(forged);

  assert.match(validation.errors.join("; "), /review approvedByRobert must be true/);
  assert.match(validation.errors.join("; "), /review missingIds must be present/);
  assert.match(validation.errors.join("; "), /review duplicateIds must be present/);
  assert.match(validation.errors.join("; "), /reviewedCandidates must be present/);
});

test("accepts mixed complete review when only one found candidate is approved", () => {
  const approvedCandidate = captureRunPacketCandidate({ businessName: "Run Packet Cafe" });
  const mixed = reviewPacket({
    requestedCount: 2,
    foundCount: 2,
    approvedCount: 1,
    reviewedCandidates: [
      {
        candidateId: approvedCandidate.id,
        businessName: "Run Packet Cafe",
        approvedForPreview: true,
        blockedReasons: [],
        grade: "A",
        score: 90,
      },
      {
        businessName: "Blocked Packet Cafe",
        approvedForPreview: false,
        blockedReasons: ["recipientEmail"],
        grade: "C",
        score: 55,
      },
    ],
  }, [approvedCandidate]);
  const validation = validateRevenueMoneySprintRunPacketReview(mixed);

  assert.deepEqual(validation.errors, []);
});

test("blocks packet when batch businesses do not match approved reviewed candidates", () => {
  const candidate = captureRunPacketCandidate({ businessName: "Run Packet Cafe" });
  const forged = reviewPacket({
    reviewedCandidates: [
      {
        candidateId: candidate.id,
        businessName: "Different Approved Cafe",
        approvedForPreview: true,
        blockedReasons: [],
        grade: "A",
        score: 90,
      },
    ],
  }, [candidate]);
  const validation = validateRevenueMoneySprintRunPacketReview(forged);

  assert.match(validation.errors.join("; "), /seedLeadBatchText businesses must match approved reviewedCandidates/);
});

test("blocks packet when persisted candidate row data was tampered", () => {
  const candidate = captureRunPacketCandidate({ businessName: "Tamper Proof Cafe" });
  const base = reviewPacket({}, [candidate]);
  const forged = reviewPacket({
    moneySprintRunPacket: {
      ...base.moneySprintRunPacket,
      requestBody: {
        ...base.moneySprintRunPacket.requestBody,
        seedLeadBatchText: base.moneySprintRunPacket.requestBody.seedLeadBatchText.replace(candidate.recipientEmail, "attacker@example.com"),
      },
    },
  }, [candidate]);
  const validation = validateRevenueMoneySprintRunPacketReview(forged);

  assert.match(validation.errors.join("; "), /seedLeadBatchText must match persisted approved public candidates/);
});

test("blocks packet when persisted approved candidate is no longer verified", () => {
  const candidate = captureRunPacketCandidate({
    businessName: "Unverified Persisted Cafe",
    verificationStatus: "needs_review",
    publicEvidenceVerified: false,
  });
  const forged = reviewPacket({}, [candidate]);
  const validation = validateRevenueMoneySprintRunPacketReview(forged);

  assert.match(validation.errors.join("; "), /approved persisted public candidates must still be verified_public/);
  assert.match(validation.errors.join("; "), /approved persisted public candidates must still have verified public evidence/);
});

test("blocks packet with duplicate approved candidate ids", () => {
  const candidate = captureRunPacketCandidate({ businessName: "Duplicate Candidate Cafe" });
  const duplicated = reviewPacket({
    requestedCount: 2,
    foundCount: 2,
    approvedCount: 2,
    reviewedCandidates: [
      {
        candidateId: candidate.id,
        businessName: candidate.businessName,
        approvedForPreview: true,
        blockedReasons: [],
        grade: "A",
        score: 90,
      },
      {
        candidateId: candidate.id,
        businessName: candidate.businessName,
        approvedForPreview: true,
        blockedReasons: [],
        grade: "A",
        score: 90,
      },
    ],
    moneySprintRunPacket: {
      ...reviewPacket({}, [candidate]).moneySprintRunPacket,
      requestBody: {
        ...reviewPacket({}, [candidate]).moneySprintRunPacket.requestBody,
        seedLeadBatchText: [
          "business|area|niche|website|channel|contact|sourceUrl|recipientEmail|evidence|painPoint|offer|contactName|summary",
          candidate.batchRow,
          candidate.batchRow,
        ].join("\n"),
      },
      expectedOutput: {
        acceptedLeads: 2,
        mockupsToPrepare: 2,
        outreachDraftsToCreate: 2,
      },
    },
  }, [candidate]);
  const validation = validateRevenueMoneySprintRunPacketReview(duplicated);

  assert.match(validation.errors.join("; "), /approved reviewedCandidates must not repeat candidateId/);
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
    REVENUE_ENGINE_PUBLIC_LEAD_CANDIDATES_PATH: testPublicCandidatesPath,
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
