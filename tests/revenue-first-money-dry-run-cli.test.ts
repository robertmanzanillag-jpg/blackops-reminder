import assert from "node:assert/strict";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import test from "node:test";
import {
  recordRevenueOutreachDraft,
  recordRevenuePublicScoutRun,
  resetRevenueLeadsForTests,
  resetRevenueOutreachForTests,
  resetRevenuePublicLeadCandidatesForTests,
  setRevenueLeadsPathForTests,
  setRevenueOutreachPathForTests,
  setRevenuePublicLeadCandidatesPathForTests,
} from "../server/revenue-engine";
import {
  buildRevenueFirstMoneyDryRun,
  formatRevenueFirstMoneyDryRunText,
  getRevenueFirstMoneyDryRunExitCode,
  parseRevenueFirstMoneyDryRunArgs,
  validateRevenueFirstMoneyDryRunOptions,
} from "../server/revenue-first-money-dry-run-cli";

const testLeadsPath = "/tmp/revenue-first-money-dry-run-leads-test.json";
const testOutreachPath = "/tmp/revenue-first-money-dry-run-outreach-test.json";
const testPublicCandidatesPath = "/tmp/revenue-first-money-dry-run-public-candidates-test.json";
const testOutputDir = "/tmp/revenue-first-money-dry-run-output";

setRevenueLeadsPathForTests(testLeadsPath);
setRevenueOutreachPathForTests(testOutreachPath);
setRevenuePublicLeadCandidatesPathForTests(testPublicCandidatesPath);

test.afterEach(() => {
  resetRevenueLeadsForTests();
  resetRevenueOutreachForTests();
  resetRevenuePublicLeadCandidatesForTests();
  rmSync(testOutputDir, { recursive: true, force: true });
});

function captureReadyCandidate() {
  return recordRevenuePublicScoutRun({
    area: "Miami",
    niche: "hair salon",
    offerFocus: "websites",
    scoutRunId: "first-money-dry-run-ready",
    dailyResearchTarget: 20,
    dailyQualifiedLeadLimit: 5,
    dailyMockupLimit: 2,
    dailyContactLimit: 0,
    maxPaidDataSpendUsd: 0,
    requireRobertApprovalToContact: true,
    writePreviewFiles: false,
    candidates: [
      {
        businessName: "Ready Dry Run Salon",
        area: "Miami",
        niche: "hair salon",
        websiteStatus: "no_website",
        contactChannel: "email",
        contactValue: "owner@readydryrunsalon.biz",
        sourceUrl: "https://public-directory.invalid/ready-dry-run-salon",
        recipientEmail: "owner@readydryrunsalon.biz",
        evidence: "Public listing has no website, recent salon photos and a visible public owner email.",
        painPoint: "Needs booking capture and follow-up.",
        estimatedOfferUsd: 3600,
        status: "research",
        verificationStatus: "verified_public",
        publicEvidenceVerified: true,
        approvalToImport: false,
      },
    ],
  });
}

test("parses and validates first-money dry-run options", () => {
  const options = parseRevenueFirstMoneyDryRunArgs([
    "--mode=production-launch",
    `--output-dir=${testOutputDir}`,
    "--now=2026-07-02T12:00:00.000Z",
    "--no-write",
    "--json",
  ]);

  assert.equal(options.mode, "production-launch");
  assert.equal(options.outputDir, testOutputDir);
  assert.equal(options.now, "2026-07-02T12:00:00.000Z");
  assert.equal(options.writeFile, false);
  assert.equal(options.json, true);
  assert.deepEqual(validateRevenueFirstMoneyDryRunOptions(options), []);
  assert.deepEqual(validateRevenueFirstMoneyDryRunOptions({ ...options, mode: "banana" as never, now: "nope" }), [
    "--mode must be first-sprint or production-launch.",
    "--now must be a valid ISO-compatible date.",
  ]);
});

test("dry run writes an auditable next-action packet without executing unsafe work", () => {
  captureReadyCandidate();
  const result = buildRevenueFirstMoneyDryRun({
    mode: "first-sprint",
    outputDir: testOutputDir,
    now: "2026-07-02T12:00:00.000Z",
    writeFile: true,
    json: false,
  });
  const text = formatRevenueFirstMoneyDryRunText(result);
  const markdown = readFileSync(result.outputPath, "utf8");

  assert.equal(result.nextCommand.id, "candidate-review");
  assert.equal(result.wroteFile, true);
  assert.equal(existsSync(result.outputPath), true);
  assert.match(result.outputPath, /2026-07-02-first-money-dry-run\.md$/);
  assert.match(markdown, /Revenue First Money Dry Run/);
  assert.match(markdown, /revenue:public-candidate-review/);
  assert.doesNotMatch(markdown, /--approved-by-robert/);
  assert.match(markdown, /approval flags withheld/i);
  assert.match(result.nextCommand.command, /approval flags withheld/i);
  assert.doesNotMatch(result.nextCommand.command, /--approved-by-robert/);
  assert.match(markdown, /This dry run does not execute the next command/);
  assert.equal(result.safety.executesNextCommand, false);
  assert.equal(result.safety.importsLeads, false);
  assert.equal(result.safety.sendsOutreach, false);
  assert.equal(result.safety.chargesClients, false);
  assert.equal(result.safety.deploys, false);
  assert.match(text, /Executes next command: no/);
  assert.equal(getRevenueFirstMoneyDryRunExitCode(result), 0);
});

test("dry-run script writes the persisted packet and reports safety", () => {
  captureReadyCandidate();
  const result = spawnSync(process.execPath, [
    "--import",
    "tsx",
    "script/revenue-first-money-dry-run.ts",
    `--output-dir=${testOutputDir}`,
    "--now=2026-07-02T12:00:00.000Z",
  ], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      REVENUE_ENGINE_LEADS_PATH: testLeadsPath,
      REVENUE_ENGINE_OUTREACH_PATH: testOutreachPath,
      REVENUE_ENGINE_PUBLIC_LEAD_CANDIDATES_PATH: testPublicCandidatesPath,
    },
    encoding: "utf8",
  });
  const outputPath = `${testOutputDir}/2026-07-02-first-money-dry-run.md`;

  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, /Revenue first-money dry run:/);
  assert.match(result.stdout, /Wrote file: yes/);
  assert.match(result.stdout, /Executes next command: no/);
  assert.match(result.stdout, /Sends outreach: no/);
  assert.equal(existsSync(outputPath), true);
  assert.match(readFileSync(outputPath, "utf8"), /Approval flags are withheld from copy-paste commands/);
});

test("dry run withholds paid website approval flags from generated packets", () => {
  recordRevenueOutreachDraft({
    channel: "email",
    approvalStatus: "approved",
    recipientEmail: "owner@paiddryrunsalon.biz",
    contactName: "Owner",
    businessName: "Paid Dry Run Salon",
    sourceUrl: "https://public-directory.invalid/paid-dry-run-salon",
    businessSummary: "Paid Dry Run Salon has public evidence of no dedicated website and needs online booking capture.",
    websitePriceUsd: 3500,
    automationPriceUsd: 1200,
    monthlyRetainerUsd: 750,
    estimatedInternalMonthlyCostUsd: 54,
    notes: "",
  });

  const result = buildRevenueFirstMoneyDryRun({
    mode: "first-sprint",
    outputDir: testOutputDir,
    now: "2026-07-02T12:00:00.000Z",
    writeFile: true,
    json: false,
  });
  const markdown = readFileSync(result.outputPath, "utf8");

  assert.match(markdown, /revenue:website-creation-packet/);
  assert.doesNotMatch(markdown, /--robert-approved-build/);
  assert.doesNotMatch(markdown, /--client-approved-scope/);
  assert.doesNotMatch(markdown, /--deposit-paid/);
  assert.doesNotMatch(markdown, /--public-data-verified/);
  assert.match(markdown, /approval flags withheld/i);
});
