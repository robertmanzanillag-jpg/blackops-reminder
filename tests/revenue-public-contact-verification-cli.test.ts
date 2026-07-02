import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import {
  recordRevenuePublicScoutRun,
  resetRevenuePublicLeadCandidatesForTests,
  setRevenuePublicLeadCandidatesPathForTests,
} from "../server/revenue-engine";
import {
  buildRevenuePublicContactVerificationPacket,
  formatRevenuePublicContactVerificationText,
  parseRevenuePublicContactVerificationArgs,
  validateRevenuePublicContactVerificationOptions,
} from "../server/revenue-public-contact-verification-cli";

const testPublicLeadCandidatesPath = "/tmp/revenue-public-contact-verification-cli-candidates-test.json";

setRevenuePublicLeadCandidatesPathForTests(testPublicLeadCandidatesPath);

test.afterEach(resetRevenuePublicLeadCandidatesForTests);

const candidates = [
  {
    id: "candidate-1",
    businessName: "Muse In the Gables",
    area: "Miami, FL",
    niche: "hair salon",
    websiteStatus: "no_website" as const,
    contactChannel: "unknown" as const,
    contactValue: "",
    sourceUrl: "https://leadsbylocation.com/leads/hair-salons/miami-florida/",
    recipientEmail: "",
    evidence: "Public directory lists this salon as No website with reviews.",
    painPoint: "Needs booking CTA and local SEO.",
    verificationStatus: "needs_review" as const,
    publicEvidenceVerified: false,
    approvalToImport: false,
    importReady: false,
    blockedReasons: ["public evidence not verified", "recipientEmail"],
  },
  {
    id: "candidate-2",
    businessName: "Ready Review Salon",
    area: "Miami, FL",
    niche: "hair salon",
    websiteStatus: "no_website" as const,
    contactChannel: "email" as const,
    contactValue: "owner@readyreviewsalon.com",
    sourceUrl: "https://readyreviewsalon.com/public-profile",
    recipientEmail: "owner@readyreviewsalon.com",
    evidence: "Public business page shows no website and public owner email.",
    painPoint: "Needs appointment capture.",
    verificationStatus: "verified_public" as const,
    publicEvidenceVerified: true,
    approvalToImport: false,
    importReady: false,
    blockedReasons: ["approvalToImport false"],
  },
];

test("parses and validates public contact verification CLI options", () => {
  const options = parseRevenuePublicContactVerificationArgs([
    "--candidate-ids=candidate-1,candidate-2",
    "--max-candidates=2",
    "--include-demo",
    "--json",
  ]);

  assert.deepEqual(options.candidateIds, ["candidate-1", "candidate-2"]);
  assert.equal(options.maxCandidates, 2);
  assert.equal(options.includeDemo, true);
  assert.equal(options.json, true);
  assert.deepEqual(validateRevenuePublicContactVerificationOptions(options), []);
  assert.deepEqual(validateRevenuePublicContactVerificationOptions({ ...options, maxCandidates: 0 }), [
    "--max-candidates must be between 1 and 50.",
  ]);
});

test("builds a safe public contact verification packet without side effects", () => {
  const packet = buildRevenuePublicContactVerificationPacket(candidates, {
    candidateIds: ["candidate-1", "missing-id"],
    maxCandidates: 10,
    includeDemo: false,
    json: false,
  });

  assert.equal(packet.status, "ready_for_contact_verification");
  assert.equal(packet.taskCount, 1);
  assert.deepEqual(packet.missingIds, ["missing-id"]);
  assert.equal(packet.safety.persistsChanges, false);
  assert.equal(packet.safety.importsLeads, false);
  assert.equal(packet.safety.sendsOutreach, false);
  assert.equal(packet.safety.paidDataSpendUsd, 0);
  assert.equal(packet.tasks[0].businessName, "Muse In the Gables");
  assert.equal(packet.tasks[0].readyForRobertReview, false);
  assert.ok(packet.tasks[0].missing.some((item) => item.includes("public contact channel")));
  assert.ok(packet.tasks[0].searchQueries.some((query) => query.includes("Muse In the Gables")));
  assert.deepEqual(packet.tasks[0].nextReviewCommand.command, "npm");
  assert.ok(packet.tasks[0].nextReviewCommand.args.includes("revenue:public-candidate-review"));
  assert.deepEqual(packet.tasks[0].nextVerificationUpdateCommand.command, "npm");
  assert.ok(packet.tasks[0].nextVerificationUpdateCommand.args.includes("revenue:public-candidate-verification-update"));
  assert.ok(packet.tasks[0].nextVerificationUpdateCommand.args.includes("--contact-channel=CONTACT_CHANNEL"));
  assert.ok(packet.tasks[0].nextVerificationUpdateCommand.args.includes("--confirm-public-evidence"));
  assert.equal(packet.tasks[0].nextVerificationUpdateCommand.args.some((arg) => arg.includes("approved-by-robert")), false);
  assert.equal(packet.tasks[0].nextVerificationUpdateCommand.args.some((arg) => arg.includes("approvalToImport")), false);
});

test("marks candidates with verified public data as waiting only for Robert approval", () => {
  const packet = buildRevenuePublicContactVerificationPacket(candidates, {
    candidateIds: ["candidate-2"],
    maxCandidates: 10,
    includeDemo: false,
    json: false,
  });

  assert.equal(packet.taskCount, 1);
  assert.deepEqual(packet.tasks[0].missing, ["Robert approval is still required before import."]);
  assert.equal(packet.tasks[0].readyForRobertReview, true);
});

test("does not mark requested candidates omitted by maxCandidates as missing", () => {
  const packet = buildRevenuePublicContactVerificationPacket(candidates, {
    candidateIds: ["candidate-1", "candidate-2"],
    maxCandidates: 1,
    includeDemo: false,
    json: false,
  });

  assert.equal(packet.taskCount, 1);
  assert.deepEqual(packet.missingIds, []);
});

test("formats public contact verification packet for operator review", () => {
  const packet = buildRevenuePublicContactVerificationPacket(candidates, {
    candidateIds: ["candidate-1"],
    maxCandidates: 10,
    includeDemo: false,
    json: false,
  });
  const output = formatRevenuePublicContactVerificationText(packet);

  assert.match(output, /Revenue public contact verification: ready_for_contact_verification/);
  assert.match(output, /Imports leads: no/);
  assert.match(output, /Sends outreach: no/);
  assert.match(output, /Muse In the Gables/);
  assert.match(output, /Queries:/);
  assert.match(output, /Verification update command:/);
  assert.match(output, /revenue:public-candidate-verification-update/);
  assert.doesNotMatch(output, /--approved-by-robert/);
});

test("formats review commands with structured args and shell-escaped text", () => {
  const unsafeCandidate = {
    ...candidates[0],
    id: "candidate-unsafe",
    area: "Miami\" --approved-by-robert \"",
    niche: "hair salon's",
  };
  const packet = buildRevenuePublicContactVerificationPacket([unsafeCandidate], {
    candidateIds: [],
    maxCandidates: 10,
    includeDemo: false,
    json: false,
  });

  assert.deepEqual(packet.tasks[0].nextReviewCommand.args, [
    "run",
    "revenue:public-candidate-review",
    "--",
    "--candidate-ids=candidate-unsafe",
    "--area=Miami\" --approved-by-robert \"",
    "--niche=hair salon's",
    "--offer-focus=websites",
  ]);
  assert.match(packet.tasks[0].nextReviewCommandText, /'--area=Miami" --approved-by-robert "'/);
  assert.match(packet.tasks[0].nextReviewCommandText, /'--niche=hair salon'\\''s'/);
  assert.match(packet.tasks[0].nextVerificationUpdateCommandText, /revenue:public-candidate-verification-update/);
  assert.match(packet.tasks[0].nextVerificationUpdateCommandText, /'--candidate-id=candidate-unsafe'/);
});

test("excludes demo sample and placeholder candidates by default and includes them only when requested", () => {
  const demoCandidate = {
    ...candidates[0],
    id: "candidate-demo",
    businessName: "Sample Demo Cafe",
    sourceUrl: "https://sample.test/placeholder",
    recipientEmail: "owner@demo.test",
  };
  const defaultPacket = buildRevenuePublicContactVerificationPacket([demoCandidate], {
    candidateIds: [],
    maxCandidates: 10,
    includeDemo: false,
    json: false,
  });
  const includedPacket = buildRevenuePublicContactVerificationPacket([demoCandidate], {
    candidateIds: [],
    maxCandidates: 10,
    includeDemo: true,
    json: false,
  });

  assert.equal(defaultPacket.taskCount, 0);
  assert.equal(defaultPacket.excludedDemoCount, 1);
  assert.equal(includedPacket.taskCount, 1);
});

test("script can verify requested candidates outside the recent ten snapshot window", () => {
  const candidatesForRun = Array.from({ length: 12 }, (_, index) => ({
    businessName: `Queue Salon ${index + 1}`,
    area: "Miami, FL",
    niche: "hair salon",
    websiteStatus: "no_website" as const,
    contactChannel: "unknown" as const,
    contactValue: "",
    sourceUrl: `https://public-directory.invalid/queue-salon-${index + 1}`,
    recipientEmail: "",
    evidence: `Public directory listing ${index + 1} shows no website signal and reviews.`,
    painPoint: "Needs booking CTA and local SEO.",
    estimatedOfferUsd: 3200,
    status: "research" as const,
    contactName: "Owner",
    businessSummary: "Publicly captured candidate for verification queue test.",
    verificationStatus: "needs_review" as const,
    publicEvidenceVerified: false,
    approvalToImport: false,
  }));
  const run = recordRevenuePublicScoutRun({
    area: "Miami, FL",
    niche: "hair salons",
    offerFocus: "websites",
    source: "public_directory",
    scoutRunId: "contact-verification-full-queue",
    autoApproveVerified: false,
    dailyResearchTarget: 30,
    dailyQualifiedLeadLimit: 12,
    dailyMockupLimit: 3,
    dailyContactLimit: 0,
    maxPaidDataSpendUsd: 0,
    requireRobertApprovalToContact: true,
    writePreviewFiles: false,
    candidates: candidatesForRun,
  });
  const firstCandidateId = run.recordedCandidates[0].candidate.id;
  const result = spawnSync(process.execPath, [
    "--import",
    "tsx",
    "script/revenue-public-contact-verification.ts",
    `--candidate-ids=${firstCandidateId}`,
  ], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      REVENUE_ENGINE_PUBLIC_LEAD_CANDIDATES_PATH: testPublicLeadCandidatesPath,
    },
    encoding: "utf8",
  });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Tasks: 1/);
  assert.match(result.stdout, /Queue Salon 1/);
  assert.doesNotMatch(result.stdout, /Missing ids: candidate-/);
});
