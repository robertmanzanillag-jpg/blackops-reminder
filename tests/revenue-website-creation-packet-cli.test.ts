import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
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

function writeRevenueEvidenceFixture(relativePath: string, content = "verified evidence") {
  const filePath = path.join(process.cwd(), "revenue_workspace", relativePath);
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${content}\n`, "utf8");
  return `revenue_workspace/${relativePath}`;
}

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
    "--robert-approval-evidence=codex-thread:approval-123",
    "--client-approved-scope",
    "--client-scope-evidence=signed-scope:123",
    "--deposit-paid",
    "--deposit-evidence=stripe:deposit-123",
    "--public-data-verified",
    "--public-verification-evidence=public-verification:123",
    "--launch-target-days=10",
    "--json",
  ]);

  assert.equal(parsed.outreachDraftId, "outreach-123");
  assert.equal(parsed.robertApprovedBuild, true);
  assert.equal(parsed.clientApprovedScope, true);
  assert.equal(parsed.depositPaid, true);
  assert.equal(parsed.publicDataVerified, true);
  assert.equal(parsed.robertApprovalEvidence, "codex-thread:approval-123");
  assert.equal(parsed.clientScopeEvidence, "signed-scope:123");
  assert.equal(parsed.depositEvidence, "stripe:deposit-123");
  assert.equal(parsed.publicVerificationEvidence, "public-verification:123");
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
  const unsafeEvidenceContent = [
    draft.id,
    "Website Packet Cafe",
    "https://example.com/website-packet-cafe",
    "owner@websitepacket.example",
    "4700",
    "approved",
  ].join(" ");
  const unsafeApprovalEvidence = writeRevenueEvidenceFixture("approval-packets/website-cli-unsafe.md", unsafeEvidenceContent);
  const unsafeScopeEvidence = writeRevenueEvidenceFixture("signed-scope/website-cli-unsafe.md", unsafeEvidenceContent);
  const unsafeDepositEvidence = writeRevenueEvidenceFixture("deposits/website-cli-unsafe.md", unsafeEvidenceContent);
  const unsafePublicEvidence = writeRevenueEvidenceFixture("public-verification/website-cli-unsafe.md", unsafeEvidenceContent);
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
    robertApprovalEvidence: unsafeApprovalEvidence,
    clientScopeEvidence: unsafeScopeEvidence,
    depositEvidence: unsafeDepositEvidence,
    publicVerificationEvidence: unsafePublicEvidence,
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
  const evidenceContent = [
    draft.id,
    "Website Packet Cafe",
    "https://example.com/website-packet-cafe",
    "owner@websitepacket.example",
    "4700",
    "approved",
  ].join(" ");
  const approvalEvidence = writeRevenueEvidenceFixture("approval-packets/website-cli-ready.md", evidenceContent);
  const scopeEvidence = writeRevenueEvidenceFixture("signed-scope/website-cli-ready.md", evidenceContent);
  const depositEvidence = writeRevenueEvidenceFixture("deposits/website-cli-ready.md", evidenceContent);
  const publicEvidence = writeRevenueEvidenceFixture("public-verification/website-cli-ready.md", evidenceContent);
  const packet = buildRevenueWebsiteCreationPacketFromCli({
    outreachDraftId: draft.id,
    robertApprovedBuild: true,
    clientApprovedScope: true,
    depositPaid: true,
    publicDataVerified: true,
    robertApprovalEvidence: approvalEvidence,
    clientScopeEvidence: scopeEvidence,
    depositEvidence,
    publicVerificationEvidence: publicEvidence,
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
  assert.equal(packet.designExecutionBrief.claudeDesignHandoff.required, true);
  assert.match(packet.designExecutionBrief.requiredSkills.join(","), /product-design:get-context/);
  assert.match(packet.designExecutionBrief.requiredSkills.join(","), /product-design:image-to-code/);
  assert.match(packet.designExecutionBrief.designStandards.join(" "), /3D/);
  assert.match(packet.designExecutionBrief.qaGates.join(" "), /Playwright screenshots/);
  assert.equal(packet.evidence.depositEvidence, depositEvidence);
  assert.equal(packet.prFirstBuildContract.readyForFileWrites, false);
  assert.equal(packet.prFirstBuildContract.readyForDeploy, false);
  assert.match(packet.prFirstBuildContract.requiredBeforePreviewOrDeploy.join(" "), /App QA/);
  assert.equal(getRevenueWebsiteCreationPacketExitCode(packet), 0);
  assert.match(text, /Revenue website creation packet: ready_for_website_creation_handoff/);
  assert.match(text, /Files prepared in packet: 4/);
  assert.match(text, /Claude\/design handoff required: yes/);
  assert.match(text, /Required skills: .*product-design:get-context/);
  assert.match(text, /PR-first build contract:/);
  assert.match(text, /Ready for file writes: no/);
  assert.doesNotMatch(text, /Writes files: yes/);
});

test("website creation packet blocks placeholder evidence refs", () => {
  const draft = createApprovedOutreachDraft();
  const packet = buildRevenueWebsiteCreationPacketFromCli({
    outreachDraftId: draft.id,
    robertApprovedBuild: true,
    clientApprovedScope: true,
    depositPaid: true,
    publicDataVerified: true,
    robertApprovalEvidence: "ROBERT_APPROVAL_REF",
    clientScopeEvidence: "CLIENT_SCOPE_REF",
    depositEvidence: "DEPOSIT_REF",
    publicVerificationEvidence: "PUBLIC_VERIFICATION_REF",
    writeFiles: false,
    deployWebsite: false,
    launchTargetDays: 7,
    json: false,
  });

  assert.equal(packet.status, "blocked");
  assert.match(packet.blockedReasons.join("; "), /Robert debe aprobar/);
  assert.match(packet.blockedReasons.join("; "), /scope/);
  assert.match(packet.blockedReasons.join("; "), /deposito/);
  assert.match(packet.blockedReasons.join("; "), /Verificar datos publicos/);
  assert.equal(getRevenueWebsiteCreationPacketExitCode(packet), 1);
});

test("website creation packet blocks evidence files for the wrong client", () => {
  const draft = createApprovedOutreachDraft();
  const wrongContent = "Other Client https://example.com/other owner@other.example 999 approved";
  const wrongApproval = writeRevenueEvidenceFixture("approval-packets/wrong-client.md", wrongContent);
  const wrongScope = writeRevenueEvidenceFixture("signed-scope/wrong-client.md", wrongContent);
  const wrongDeposit = writeRevenueEvidenceFixture("deposits/wrong-client.md", wrongContent);
  const wrongPublic = writeRevenueEvidenceFixture("public-verification/wrong-client.md", wrongContent);
  const packet = buildRevenueWebsiteCreationPacketFromCli({
    outreachDraftId: draft.id,
    robertApprovedBuild: true,
    clientApprovedScope: true,
    depositPaid: true,
    publicDataVerified: true,
    robertApprovalEvidence: wrongApproval,
    clientScopeEvidence: wrongScope,
    depositEvidence: wrongDeposit,
    publicVerificationEvidence: wrongPublic,
    writeFiles: false,
    deployWebsite: false,
    launchTargetDays: 7,
    json: false,
  });

  assert.equal(packet.status, "blocked");
  assert.match(packet.blockedReasons.join("; "), /Robert debe aprobar/);
  assert.match(packet.blockedReasons.join("; "), /scope/);
  assert.match(packet.blockedReasons.join("; "), /deposito/);
  assert.match(packet.blockedReasons.join("; "), /Verificar datos publicos/);
});

test("website creation packet script exits blocked until all creation gates pass", () => {
  const draft = createApprovedOutreachDraft();
  const evidenceContent = [
    draft.id,
    "Website Packet Cafe",
    "https://example.com/website-packet-cafe",
    "owner@websitepacket.example",
    "4700",
    "approved",
  ].join(" ");
  const approvalEvidence = writeRevenueEvidenceFixture("approval-packets/website-script-ready.md", evidenceContent);
  const scopeEvidence = writeRevenueEvidenceFixture("signed-scope/website-script-ready.md", evidenceContent);
  const depositEvidence = writeRevenueEvidenceFixture("deposits/website-script-ready.md", evidenceContent);
  const publicEvidence = writeRevenueEvidenceFixture("public-verification/website-script-ready.md", evidenceContent);
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
    `--robert-approval-evidence=${approvalEvidence}`,
    "--client-approved-scope",
    `--client-scope-evidence=${scopeEvidence}`,
    "--deposit-paid",
    `--deposit-evidence=${depositEvidence}`,
    "--public-data-verified",
    `--public-verification-evidence=${publicEvidence}`,
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

test("website creation packet script blocks file writes and deploy requests", () => {
  const draft = createApprovedOutreachDraft();
  const evidenceContent = [
    draft.id,
    "Website Packet Cafe",
    "https://example.com/website-packet-cafe",
    "owner@websitepacket.example",
    "4700",
    "approved",
  ].join(" ");
  const approvalEvidence = writeRevenueEvidenceFixture("approval-packets/website-script-unsafe.md", evidenceContent);
  const scopeEvidence = writeRevenueEvidenceFixture("signed-scope/website-script-unsafe.md", evidenceContent);
  const depositEvidence = writeRevenueEvidenceFixture("deposits/website-script-unsafe.md", evidenceContent);
  const publicEvidence = writeRevenueEvidenceFixture("public-verification/website-script-unsafe.md", evidenceContent);
  const result = spawnSync(process.execPath, [
    "--import",
    "tsx",
    "script/revenue-website-creation-packet.ts",
    `--outreach-draft-id=${draft.id}`,
    "--robert-approved-build",
    `--robert-approval-evidence=${approvalEvidence}`,
    "--client-approved-scope",
    `--client-scope-evidence=${scopeEvidence}`,
    "--deposit-paid",
    `--deposit-evidence=${depositEvidence}`,
    "--public-data-verified",
    `--public-verification-evidence=${publicEvidence}`,
    "--write-files",
    "--deploy-website",
  ], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      REVENUE_ENGINE_LEADS_PATH: testLeadsPath,
      REVENUE_ENGINE_OUTREACH_PATH: testOutreachPath,
    },
    encoding: "utf8",
  });

  assert.equal(result.status, 1);
  assert.match(result.stdout, /Revenue website creation packet: blocked/);
  assert.match(result.stdout, /Este paquete no escribe archivos ni despliega/);
  assert.match(result.stdout, /Writes files: no/);
  assert.match(result.stdout, /Deploys: no/);
});
