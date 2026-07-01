import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import {
  recordRevenueLead,
  recordRevenueOutreachDraft,
  resetRevenueLeadsForTests,
  resetRevenueOutreachForTests,
  setRevenueLeadsPathForTests,
  setRevenueOutreachPathForTests,
} from "../server/revenue-engine";
import {
  buildRevenueWebsiteCreationPacketFromCli,
  formatRevenueWebsiteCreationPacketText,
  getRevenueWebsiteCreationPacketExitCode,
  parseRevenueWebsiteCreationPacketArgs,
  validateRevenueWebsiteCreationPacketOptions,
} from "../server/revenue-website-creation-packet-cli";

const testLeadsPath = "/tmp/revenue-website-creation-packet-cli-leads-test.json";
const testOutreachPath = "/tmp/revenue-website-creation-packet-cli-outreach-test.json";

setRevenueLeadsPathForTests(testLeadsPath);
setRevenueOutreachPathForTests(testOutreachPath);

test.afterEach(() => {
  resetRevenueLeadsForTests();
  resetRevenueOutreachForTests();
});

function createApprovedOutreachDraft() {
  const leadResult = recordRevenueLead({
    businessName: "Website Packet Cafe",
    area: "Miami",
    niche: "coffee shop",
    websiteStatus: "no_website",
    contactChannel: "email",
    contactValue: "owner@websitepacket.example",
    evidence: "Public listing has no website, menu photos and a visible catering inquiry path.",
    painPoint: "Needs catering lead capture and online menu conversion.",
    estimatedOfferUsd: 4700,
    status: "mockup_ready",
  });
  return recordRevenueOutreachDraft({
    leadId: leadResult.lead.id,
    channel: "email",
    approvalStatus: "approved",
    recipientEmail: "owner@websitepacket.example",
    contactName: "Owner",
    businessName: "Website Packet Cafe",
    sourceUrl: "https://example.com/website-packet-cafe",
    businessSummary: "Website Packet Cafe has public evidence of no dedicated website and needs online menu capture plus catering follow-up.",
    websitePriceUsd: 3500,
    automationPriceUsd: 1200,
    monthlyRetainerUsd: 750,
    estimatedInternalMonthlyCostUsd: 54,
    notes: "",
  }).draft;
}

test("parses and validates website creation packet CLI options", () => {
  const parsed = parseRevenueWebsiteCreationPacketArgs([
    "--outreach-draft-id=outreach-123",
    "--robert-approved-build",
    "--client-approved-scope",
    "--deposit-paid",
    "--public-data-verified",
    "--launch-target-days=10",
    "--json",
  ]);

  assert.equal(parsed.outreachDraftId, "outreach-123");
  assert.equal(parsed.robertApprovedBuild, true);
  assert.equal(parsed.clientApprovedScope, true);
  assert.equal(parsed.depositPaid, true);
  assert.equal(parsed.publicDataVerified, true);
  assert.equal(parsed.writeFiles, false);
  assert.equal(parsed.deployWebsite, false);
  assert.equal(parsed.launchTargetDays, 10);
  assert.equal(parsed.json, true);
  assert.deepEqual(validateRevenueWebsiteCreationPacketOptions(parseRevenueWebsiteCreationPacketArgs([])), [
    "--outreach-draft-id is required.",
  ]);
  assert.deepEqual(
    validateRevenueWebsiteCreationPacketOptions(parseRevenueWebsiteCreationPacketArgs([
      "--outreach-draft-id=outreach-123",
      "--launch-target-days=99",
    ])),
    ["--launch-target-days must be an integer from 1 to 60."],
  );
});

test("website creation packet CLI blocks missing approvals and unsafe actions", () => {
  const draft = createApprovedOutreachDraft();
  const missingApprovals = buildRevenueWebsiteCreationPacketFromCli({
    outreachDraftId: draft.id,
    robertApprovedBuild: false,
    clientApprovedScope: false,
    depositPaid: false,
    publicDataVerified: false,
    writeFiles: false,
    deployWebsite: false,
    launchTargetDays: 7,
    json: false,
  });
  const unsafe = buildRevenueWebsiteCreationPacketFromCli({
    outreachDraftId: draft.id,
    robertApprovedBuild: true,
    clientApprovedScope: true,
    depositPaid: true,
    publicDataVerified: true,
    writeFiles: true,
    deployWebsite: true,
    launchTargetDays: 7,
    json: false,
  });

  assert.equal(missingApprovals.status, "blocked");
  assert.match(missingApprovals.blockedReasons.join("; "), /Robert debe aprobar/);
  assert.equal(getRevenueWebsiteCreationPacketExitCode(missingApprovals), 1);
  assert.equal(unsafe.status, "blocked");
  assert.match(unsafe.blockedReasons.join("; "), /no escribe archivos ni despliega/);
  assert.equal(unsafe.safety.requestedWriteFiles, true);
  assert.equal(unsafe.safety.requestedDeployWebsite, true);
});

test("website creation packet CLI builds a safe paid handoff", () => {
  const draft = createApprovedOutreachDraft();
  const packet = buildRevenueWebsiteCreationPacketFromCli({
    outreachDraftId: draft.id,
    robertApprovedBuild: true,
    clientApprovedScope: true,
    depositPaid: true,
    publicDataVerified: true,
    writeFiles: false,
    deployWebsite: false,
    launchTargetDays: 7,
    json: false,
  });
  const text = formatRevenueWebsiteCreationPacketText(packet);

  assert.equal(packet.status, "ready_for_website_creation_handoff");
  assert.equal(packet.scaffoldInput?.projectType, "bundle");
  assert.equal(packet.scaffoldInput?.includesAutomation, true);
  assert.equal(packet.safety.writesFiles, false);
  assert.equal(packet.safety.deploys, false);
  assert.equal(packet.scaffold?.canWriteFiles, false);
  assert.equal(packet.scaffold?.canDeploy, false);
  assert.equal(getRevenueWebsiteCreationPacketExitCode(packet), 0);
  assert.match(text, /Revenue website creation packet: ready_for_website_creation_handoff/);
  assert.match(text, /Files prepared in packet: 4/);
  assert.doesNotMatch(text, /Writes files: yes/);
});

test("website creation packet script exits blocked until all creation gates pass", () => {
  const draft = createApprovedOutreachDraft();
  const baseEnv = {
    ...process.env,
    REVENUE_ENGINE_LEADS_PATH: testLeadsPath,
    REVENUE_ENGINE_OUTREACH_PATH: testOutreachPath,
  };
  const blocked = spawnSync(process.execPath, [
    "--import",
    "tsx",
    "script/revenue-website-creation-packet.ts",
    `--outreach-draft-id=${draft.id}`,
  ], {
    cwd: process.cwd(),
    env: baseEnv,
    encoding: "utf8",
  });
  const ready = spawnSync(process.execPath, [
    "--import",
    "tsx",
    "script/revenue-website-creation-packet.ts",
    `--outreach-draft-id=${draft.id}`,
    "--robert-approved-build",
    "--client-approved-scope",
    "--deposit-paid",
    "--public-data-verified",
  ], {
    cwd: process.cwd(),
    env: baseEnv,
    encoding: "utf8",
  });

  assert.equal(blocked.status, 1);
  assert.match(blocked.stdout, /Revenue website creation packet: blocked/);
  assert.match(blocked.stdout, /Robert debe aprobar/);
  assert.equal(ready.status, 0);
  assert.match(ready.stdout, /Revenue website creation packet: ready_for_website_creation_handoff/);
  assert.match(ready.stdout, /Can write files: no/);
  assert.match(ready.stdout, /Can deploy: no/);
});
