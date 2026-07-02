import assert from "node:assert/strict";
import test from "node:test";
import { revenuePublicScoutRunSchema } from "../server/revenue-engine";
import {
  buildRevenuePublicScoutExtract,
  formatRevenuePublicScoutExtractText,
  parseRevenuePublicScoutExtractArgs,
  validateRevenuePublicScoutExtractOptions,
} from "../server/revenue-public-scout-extract-cli";

const publicNotes = [
  [
    "Business: Brickell Glow Studio",
    "Source: https://example.com/brickell-glow",
    "Contact: hello@brickellglow.example",
    "Evidence: Public directory listing shows no website link and a public email.",
    "Website: no website",
    "Pain: Needs a booking website and deposit collection.",
    "Offer: $3500",
  ].join("\n"),
  [
    "Business: Coral Way Med Spa",
    "Source: https://example.com/coral-way-med-spa",
    "Contact: Instagram @coralspa",
    "Evidence: Public profile links only to social media and asks users to DM for booking.",
    "Website: weak",
    "Pain: Needs intake automation and a better offer page.",
    "Offer: 4200",
  ].join("\n"),
  [
    "Business: Missing Evidence Spa",
    "Source: https://example.com/missing-evidence",
    "Contact: owner@example.com",
  ].join("\n"),
].join("\n\n");

test("parses and validates public scout extract CLI options", () => {
  const parsed = parseRevenuePublicScoutExtractArgs([
    "--input=/tmp/public-notes.txt",
    "--output=/tmp/extracted.json",
    "--overwrite",
    "--json",
    "--area=Orlando",
    "--niche=roofers",
    "--offer-focus=websites",
    "--source=browser_subagent",
    "--scout-run-id=run-001",
  ]);

  assert.deepEqual(parsed, {
    inputPath: "/tmp/public-notes.txt",
    outputPath: "/tmp/extracted.json",
    overwrite: true,
    json: true,
    area: "Orlando",
    niche: "roofers",
    offerFocus: "websites",
    source: "browser_subagent",
    scoutRunId: "run-001",
  });
  assert.deepEqual(validateRevenuePublicScoutExtractOptions(parsed), []);
  assert.deepEqual(validateRevenuePublicScoutExtractOptions(parseRevenuePublicScoutExtractArgs([])), [
    "--input is required.",
  ]);
});

test("rejects sensitive output paths and existing outputs without overwrite", () => {
  const sensitiveOutput = parseRevenuePublicScoutExtractArgs([
    "--input=/tmp/public-notes.txt",
    "--output=/tmp/.env",
  ]);
  const existingOutput = parseRevenuePublicScoutExtractArgs([
    "--input=/tmp/public-notes.txt",
    "--output=/tmp/extracted.json",
  ]);
  const overwriteOutput = parseRevenuePublicScoutExtractArgs([
    "--input=/tmp/public-notes.txt",
    "--output=/tmp/extracted.json",
    "--overwrite",
  ]);

  assert.deepEqual(validateRevenuePublicScoutExtractOptions(sensitiveOutput), [
    "--output cannot point to .env, credentials, secrets, .git or node_modules paths.",
  ]);
  assert.deepEqual(validateRevenuePublicScoutExtractOptions(existingOutput, () => true), [
    "--output already exists; pass --overwrite to replace it.",
  ]);
  assert.deepEqual(validateRevenuePublicScoutExtractOptions(overwriteOutput, () => true), []);
});

test("extracts complete public note blocks into review-only scout run input", () => {
  const input = buildRevenuePublicScoutExtract(publicNotes, parseRevenuePublicScoutExtractArgs([
    "--input=/tmp/public-notes.txt",
    "--area=Miami",
    "--niche=med spas",
    "--offer-focus=both",
    "--source=manual_browser",
  ]));

  assert.equal(input.area, "Miami");
  assert.equal(input.niche, "med spas");
  assert.equal(input.offerFocus, "both");
  assert.equal(input.source, "manual_browser");
  assert.equal(input.maxPaidDataSpendUsd, 0);
  assert.equal(input.writePreviewFiles, false);
  assert.equal(input.requireRobertApprovalToContact, true);
  assert.equal(input.dailyContactLimit, 0);
  assert.equal(input.candidates.length, 2);
  assert.equal(input.candidates[0].businessName, "Brickell Glow Studio");
  assert.equal(input.candidates[0].websiteStatus, "no_website");
  assert.equal(input.candidates[0].contactChannel, "email");
  assert.equal(input.candidates[0].estimatedOfferUsd, 3500);
  assert.equal(input.candidates[1].websiteStatus, "weak_website");
  assert.equal(input.candidates[1].contactChannel, "instagram");
  assert.equal(input.candidates[1].recipientEmail, "");
  assert.equal(input.candidates[1].estimatedOfferUsd, 4200);
  assert.doesNotThrow(() => revenuePublicScoutRunSchema.parse(input));
});

test("keeps extracted candidates blocked for Robert review", () => {
  const input = buildRevenuePublicScoutExtract(publicNotes, parseRevenuePublicScoutExtractArgs([
    "--input=/tmp/public-notes.txt",
  ]));

  for (const candidate of input.candidates) {
    assert.equal(candidate.verificationStatus, "needs_review");
    assert.equal(candidate.publicEvidenceVerified, false);
    assert.equal(candidate.approvalToImport, false);
    assert.equal(candidate.status, "research");
    assert.match(candidate.notes, /No outreach sent/);
  }
});

test("ignores incomplete or non-public source note blocks", () => {
  const input = buildRevenuePublicScoutExtract([
    "Business: No Source Spa\nEvidence: Public listing says no website.",
    "Business: Bad Source Spa\nSource: example.com/not-a-url\nEvidence: Public listing says no website.",
    "Source: https://example.com/no-business\nEvidence: Public listing says no website.",
  ].join("\n\n"), parseRevenuePublicScoutExtractArgs(["--input=/tmp/public-notes.txt"]));

  assert.equal(input.candidates.length, 0);
});

test("formats public scout extract text with safe next command", () => {
  const input = buildRevenuePublicScoutExtract(publicNotes, parseRevenuePublicScoutExtractArgs([
    "--input=/tmp/public-notes.txt",
    "--output=/tmp/extracted.json",
    "--scout-run-id=run-001",
  ]));
  const output = formatRevenuePublicScoutExtractText(input, "/tmp/extracted.json");

  assert.match(output, /Revenue public scout extract: ready_for_review_capture/);
  assert.match(output, /Candidates extracted: 2/);
  assert.match(output, /npm run revenue:public-scout-run -- --input=\/tmp\/extracted\.json/);
  assert.match(output, /Approval to import: false/);
  assert.match(output, /Sends outreach: no/);
});
