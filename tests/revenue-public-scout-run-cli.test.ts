import assert from "node:assert/strict";
import test from "node:test";
import {
  recordRevenuePublicScoutRun,
  resetRevenuePublicLeadCandidatesForTests,
  setRevenuePublicLeadCandidatesPathForTests,
} from "../server/revenue-engine";
import {
  buildRevenuePublicScoutInput,
  buildRevenuePublicScoutSample,
  formatRevenuePublicScoutRunText,
  getRevenuePublicScoutRunExitCode,
  parseRevenuePublicScoutArgs,
  validateRevenuePublicScoutOptions,
} from "../server/revenue-public-scout-run-cli";

setRevenuePublicLeadCandidatesPathForTests("/tmp/revenue-public-scout-run-cli-candidates-test.json");
test.afterEach(resetRevenuePublicLeadCandidatesForTests);

test("parses revenue public scout CLI options", () => {
  const parsed = parseRevenuePublicScoutArgs([
    "--input=/tmp/candidates.json",
    "--json",
    "--area=Orlando",
    "--niche=roofers",
    "--offer-focus=websites",
    "--source=manual_browser",
    "--scout-run-id=run-001",
  ]);

  assert.deepEqual(parsed, {
    inputPath: "/tmp/candidates.json",
    json: true,
    sample: false,
    area: "Orlando",
    niche: "roofers",
    offerFocus: "websites",
    source: "manual_browser",
    scoutRunId: "run-001",
  });
  assert.deepEqual(validateRevenuePublicScoutOptions(parsed), []);
  assert.deepEqual(validateRevenuePublicScoutOptions(parseRevenuePublicScoutArgs([])), [
    "--input is required unless --sample is used.",
  ]);
});

test("builds a safe public scout sample with import approval off", () => {
  const sample = buildRevenuePublicScoutSample(parseRevenuePublicScoutArgs(["--sample", "--area=Miami", "--niche=salon"]));

  assert.equal(sample.area, "Miami");
  assert.equal(sample.niche, "salon");
  assert.equal(sample.maxPaidDataSpendUsd, 0);
  assert.equal(sample.writePreviewFiles, false);
  assert.equal(sample.requireRobertApprovalToContact, true);
  assert.equal(sample.candidates[0].verificationStatus, "needs_review");
  assert.equal(sample.candidates[0].publicEvidenceVerified, false);
  assert.equal(sample.candidates[0].approvalToImport, false);
});

test("normalizes candidate-only JSON into public scout run input", () => {
  const options = parseRevenuePublicScoutArgs([
    "--input=/tmp/candidates.json",
    "--area=Miami",
    "--niche=coffee shop",
    "--offer-focus=websites",
    "--auto-approve-verified",
  ]);
  const input = buildRevenuePublicScoutInput(JSON.stringify([
    {
      businessName: "CLI Cafe",
      area: "Miami",
      niche: "coffee shop",
      websiteStatus: "no_website",
      contactChannel: "email",
      contactValue: "owner@clicafe.example",
      sourceUrl: "https://example.com/cli-cafe",
      recipientEmail: "owner@clicafe.example",
      evidence: "Public listing has no website and a visible public contact path.",
      painPoint: "Needs online ordering and catering inquiry capture.",
      verificationStatus: "verified_public",
      publicEvidenceVerified: true,
      approvalToImport: false,
    },
  ]), options);

  assert.equal(input.area, "Miami");
  assert.equal(input.niche, "coffee shop");
  assert.equal(input.offerFocus, "websites");
  assert.equal(input.maxPaidDataSpendUsd, 0);
  assert.equal(input.writePreviewFiles, false);
  assert.equal(input.autoApproveVerified, false);
  assert.equal(input.candidates.length, 1);
});

test("normalizes full public scout JSON while keeping spend and file writes disabled", () => {
  const options = parseRevenuePublicScoutArgs(["--input=/tmp/full.json"]);
  const input = buildRevenuePublicScoutInput(JSON.stringify({
    area: "Tampa",
    niche: "gyms",
    offerFocus: "automations",
    source: "public_directory",
    maxPaidDataSpendUsd: 99,
    writePreviewFiles: true,
    dailyContactLimit: 9,
    candidates: [],
  }), options);

  assert.equal(input.area, "Tampa");
  assert.equal(input.niche, "gyms");
  assert.equal(input.offerFocus, "automations");
  assert.equal(input.source, "public_directory");
  assert.equal(input.maxPaidDataSpendUsd, 0);
  assert.equal(input.writePreviewFiles, false);
  assert.equal(input.dailyContactLimit, 9);
});

test("string false public scout gates stay blocked through CLI input", () => {
  const options = parseRevenuePublicScoutArgs(["--input=/tmp/string-false.json"]);
  const input = buildRevenuePublicScoutInput(JSON.stringify({
    area: "Miami",
    niche: "coffee shop",
    autoApproveVerified: "false",
    candidates: [
      {
        businessName: "CLI String False Cafe",
        area: "Miami",
        niche: "coffee shop",
        websiteStatus: "no_website",
        contactChannel: "email",
        contactValue: "owner@clistringfalse.example",
        sourceUrl: "https://example.com/cli-string-false-cafe",
        recipientEmail: "owner@clistringfalse.example",
        evidence: "Public listing has no website and a visible public owner email.",
        painPoint: "Needs online menu capture and follow-up.",
        estimatedOfferUsd: 3600,
        status: "research",
        verificationStatus: "verified_public",
        publicEvidenceVerified: "false",
        approvalToImport: "false",
      },
    ],
  }), options);
  const result = recordRevenuePublicScoutRun(input);

  assert.equal(input.autoApproveVerified, false);
  assert.equal(result.importableCount, 0);
  assert.equal(result.preview.totals.accepted, 0);
  assert.equal(result.recordedCandidates[0].candidate.publicEvidenceVerified, false);
  assert.equal(result.recordedCandidates[0].candidate.approvalToImport, false);
});

test("formats public scout run text with safety claims visible", () => {
  const output = formatRevenuePublicScoutRunText({
    status: "ready_for_money_sprint_preview",
    scoutRunId: "run-001",
    source: "browser_subagent",
    importableCount: 1,
    blockedCandidates: [
      { businessName: "Blocked Cafe", reasons: ["public evidence not verified"], nextAction: "Fix evidence." },
    ],
    nextApiAction: "/api/revenue-engine/money-sprint-preview",
    nextAction: "Review preview.",
    importBatchText: "business|area\nCLI Cafe|Miami",
    safety: {
      persistsPublicCandidates: true,
      persistsLeads: false,
      writesPreviewFiles: false,
      sendsOutreach: false,
      paidDataSpendUsd: 0,
    },
  });

  assert.match(output, /Revenue public scout run: ready_for_money_sprint_preview/);
  assert.match(output, /Persists final leads: no/);
  assert.match(output, /Writes preview files: no/);
  assert.match(output, /Sends outreach: no/);
  assert.match(output, /Paid data spend: \$0/);
  assert.match(output, /Blocked Cafe: public evidence not verified/);
});

test("public scout run CLI exits successfully when capture persisted review candidates", () => {
  assert.equal(getRevenuePublicScoutRunExitCode({ recordedCandidates: [{}] }), 0);
  assert.equal(getRevenuePublicScoutRunExitCode({ recordedCandidates: [] }), 1);
});
