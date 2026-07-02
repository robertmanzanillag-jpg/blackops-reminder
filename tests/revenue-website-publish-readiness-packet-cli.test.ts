import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import test from "node:test";
import {
  buildRevenueWebsiteCreationPacket,
  recordRevenueLead,
  recordRevenueOutreachDraft,
  recordRevenueTrustedApprovalDecision,
  resetRevenueApprovalDecisionsForTests,
  resetRevenueLeadsForTests,
  resetRevenueOutreachForTests,
  setRevenueApprovalDecisionsPathForTests,
  setRevenueLeadsPathForTests,
  setRevenueOutreachPathForTests,
} from "../server/revenue-engine";
import {
  buildRevenueWebsiteCreationApprovalTargetId,
  buildRevenueWebsiteCreationSnapshotHash,
} from "../server/revenue-website-creation-approval";
import {
  buildRevenueWebsitePublishApprovalTargetId,
  buildRevenueWebsitePublishSnapshotHash,
} from "../server/revenue-website-publish-approval";
import {
  buildRevenueWebsitePublishReadinessPacketFromCli,
  formatRevenueWebsitePublishReadinessPacketText,
  getRevenueWebsitePublishReadinessPacketExitCode,
  parseRevenueWebsitePublishReadinessPacketArgs,
  validateRevenueWebsitePublishReadinessPacketOptions,
} from "../server/revenue-website-publish-readiness-packet-cli";

const testLeadsPath = "/tmp/revenue-website-publish-readiness-leads-test.json";
const testOutreachPath = "/tmp/revenue-website-publish-readiness-outreach-test.json";
const testApprovalDecisionsPath = "/tmp/revenue-website-publish-readiness-decisions-test.json";

setRevenueLeadsPathForTests(testLeadsPath);
setRevenueOutreachPathForTests(testOutreachPath);
setRevenueApprovalDecisionsPathForTests(testApprovalDecisionsPath);

test.afterEach(() => {
  resetRevenueLeadsForTests();
  resetRevenueOutreachForTests();
  resetRevenueApprovalDecisionsForTests();
});

function createApprovedOutreachDraft() {
  const leadResult = recordRevenueLead({
    businessName: "Publish Ready Cafe",
    area: "Miami",
    niche: "coffee shop",
    websiteStatus: "no_website",
    contactChannel: "email",
    contactValue: "owner@publishready.example",
    evidence: "Public listing has no website, menu photos and a visible catering inquiry path.",
    painPoint: "Needs catering lead capture and online menu conversion.",
    estimatedOfferUsd: 4700,
    status: "mockup_ready",
  });
  return recordRevenueOutreachDraft({
    leadId: leadResult.lead.id,
    channel: "email",
    approvalStatus: "approved",
    recipientEmail: "owner@publishready.example",
    contactName: "Owner",
    businessName: "Publish Ready Cafe",
    sourceUrl: "https://example.com/publish-ready-cafe",
    businessSummary: "Publish Ready Cafe has public evidence of no dedicated website and needs online menu capture plus catering follow-up.",
    websitePriceUsd: 3500,
    automationPriceUsd: 1200,
    monthlyRetainerUsd: 750,
    estimatedInternalMonthlyCostUsd: 54,
    notes: "",
  }).draft;
}

function approveWebsiteCreation(draft: ReturnType<typeof createApprovedOutreachDraft>) {
  const proof = {
    robertApprovedBuild: true,
    clientApprovedScope: true,
    depositPaid: true,
    publicDataVerified: true,
    launchTargetDays: 7,
  };
  return recordRevenueTrustedApprovalDecision({
    targetId: buildRevenueWebsiteCreationApprovalTargetId(draft.id),
    targetType: "delivery_workspace",
    decision: "approved",
    approvedAction: "Approve exact website creation handoff for publish readiness test.",
    maxSpendUsd: 0,
    notes: "",
    approvalSource: "website_creation_approval_cli",
    publicCandidateSnapshotHash: "",
    outreachDraftSnapshotHash: "",
    websiteCreationSnapshotHash: buildRevenueWebsiteCreationSnapshotHash(draft, proof),
    websitePublishSnapshotHash: "",
    ledgerEntrySnapshotHash: "",
  });
}

function approveWebsitePublish(
  draft: ReturnType<typeof createApprovedOutreachDraft>,
  creationApprovalDecisionId: string,
  proofOverrides: Partial<{
    deployProvider: string;
    previewDeployUrl: string;
    appQaEvidenceUrl: string;
    rollbackPlanUrl: string;
  }> = {},
) {
  const proof = {
    robertApprovedPublish: true,
    previewDeployVerified: true,
    appQaTargetPassed: true,
    rollbackVerified: true,
    deployProvider: proofOverrides.deployProvider || "replit",
    previewDeployUrl: proofOverrides.previewDeployUrl || "https://preview.example.com/publish-ready-cafe",
    appQaEvidenceUrl: proofOverrides.appQaEvidenceUrl || "https://github.com/example/repo/actions/runs/123",
    rollbackPlanUrl: proofOverrides.rollbackPlanUrl || "https://github.com/example/repo/blob/main/ROLLBACK.md",
  };
  const creationPacket = buildRevenueWebsiteCreationPacket({
    outreachDraftId: draft.id,
    approvalDecisionId: creationApprovalDecisionId,
    robertApprovedBuild: true,
    clientApprovedScope: true,
    depositPaid: true,
    publicDataVerified: true,
    writeFiles: false,
    deployWebsite: false,
    launchTargetDays: 7,
  });
  assert.ok(creationPacket.scaffold);
  assert.ok(creationPacket.scaffoldInput);
  const scaffoldFilesHash = createHash("sha256").update(JSON.stringify(creationPacket.scaffold.files.map((file) => ({
    path: file.path,
    purpose: file.purpose,
    content: file.content,
  })))).digest("hex");
  const snapshot = {
    outreachDraftId: draft.id,
    websiteCreationApprovalDecisionId: creationApprovalDecisionId,
    businessName: draft.businessName,
    scaffoldSlug: creationPacket.scaffold.slug,
    scaffoldFileCount: creationPacket.scaffold.fileCount,
    scaffoldInput: creationPacket.scaffoldInput,
    scaffoldFilesHash,
    packageName: creationPacket.scaffoldInput.packageName,
    setupUsd: creationPacket.scaffoldInput.setupUsd,
    monthlyRetainerUsd: creationPacket.scaffoldInput.monthlyRetainerUsd,
  };
  return recordRevenueTrustedApprovalDecision({
    targetId: buildRevenueWebsitePublishApprovalTargetId(draft.id),
    targetType: "website_publish",
    decision: "approved",
    approvedAction: "Approve exact website publish readiness handoff.",
    maxSpendUsd: 0,
    notes: "",
    approvalSource: "website_publish_approval_cli",
    publicCandidateSnapshotHash: "",
    outreachDraftSnapshotHash: "",
    websiteCreationSnapshotHash: "",
    websitePublishSnapshotHash: buildRevenueWebsitePublishSnapshotHash(snapshot, proof),
    ledgerEntrySnapshotHash: "",
  });
}

test("parses and validates website publish readiness packet CLI options", () => {
  const parsed = parseRevenueWebsitePublishReadinessPacketArgs([
    "--outreach-draft-id=outreach-123",
    "--website-creation-approval-decision-id=approval-create",
    "--publish-approval-decision-id=approval-publish",
    "--robert-approved-publish",
    "--preview-deploy-verified",
    "--app-qa-target-passed",
    "--rollback-verified",
    "--deploy-provider=replit",
    "--preview-deploy-url=https://preview.example.com",
    "--app-qa-evidence-url=https://github.com/example/repo/actions/runs/123",
    "--rollback-plan-url=https://github.com/example/repo/blob/main/ROLLBACK.md",
    "--json",
  ]);

  assert.equal(parsed.outreachDraftId, "outreach-123");
  assert.equal(parsed.websiteCreationApprovalDecisionId, "approval-create");
  assert.equal(parsed.publishApprovalDecisionId, "approval-publish");
  assert.equal(parsed.robertApprovedPublish, true);
  assert.equal(parsed.previewDeployVerified, true);
  assert.equal(parsed.appQaTargetPassed, true);
  assert.equal(parsed.rollbackVerified, true);
  assert.equal(parsed.deployProvider, "replit");
  assert.equal(parsed.json, true);
  assert.deepEqual(validateRevenueWebsitePublishReadinessPacketOptions(parseRevenueWebsitePublishReadinessPacketArgs([])), [
    "--outreach-draft-id is required.",
    "--website-creation-approval-decision-id is required.",
    "--deploy-provider is required.",
    "--preview-deploy-url is required.",
    "--app-qa-evidence-url is required.",
    "--rollback-plan-url is required.",
  ]);
  assert.deepEqual(validateRevenueWebsitePublishReadinessPacketOptions(parseRevenueWebsitePublishReadinessPacketArgs([
    "--outreach-draft-id=OUTREACH_ID",
    "--website-creation-approval-decision-id=APPROVAL_ID",
    "--publish-approval-decision-id=APPROVAL_ID",
    "--deploy-provider=REPLACE_WITH_DEPLOY_PROVIDER",
    "--preview-deploy-url=https://example.com/REPLACE_WITH_PREVIEW_DEPLOY_URL",
    "--app-qa-evidence-url=https://example.com/REPLACE_WITH_APP_QA_EVIDENCE_URL",
    "--rollback-plan-url=https://example.com/REPLACE_WITH_ROLLBACK_PLAN_URL",
  ])), [
    "--outreach-draft-id must be a real outreach draft id, not a placeholder.",
    "--website-creation-approval-decision-id must be a real approval decision id, not a placeholder.",
    "--publish-approval-decision-id must be a real approval decision id, not a placeholder.",
    "--deploy-provider must be real publish context, not a placeholder.",
    "--preview-deploy-url must be real evidence, not a placeholder.",
    "--app-qa-evidence-url must be real evidence, not a placeholder.",
    "--rollback-plan-url must be real evidence, not a placeholder.",
  ]);
});

test("website publish readiness packet blocks missing publish approval and unsafe actions", () => {
  const draft = createApprovedOutreachDraft();
  const creationApproval = approveWebsiteCreation(draft);
  const missingApproval = buildRevenueWebsitePublishReadinessPacketFromCli({
    outreachDraftId: draft.id,
    websiteCreationApprovalDecisionId: creationApproval.decision.id,
    publishApprovalDecisionId: "",
    robertApprovedPublish: true,
    previewDeployVerified: true,
    appQaTargetPassed: true,
    rollbackVerified: true,
    deployProvider: "replit",
    previewDeployUrl: "https://preview.example.com/publish-ready-cafe",
    appQaEvidenceUrl: "https://github.com/example/repo/actions/runs/123",
    rollbackPlanUrl: "https://github.com/example/repo/blob/main/ROLLBACK.md",
    writeFiles: false,
    deployWebsite: false,
    launchTargetDays: 7,
    json: false,
  });
  const publishApproval = approveWebsitePublish(draft, creationApproval.decision.id);
  const unsafe = buildRevenueWebsitePublishReadinessPacketFromCli({
    outreachDraftId: draft.id,
    websiteCreationApprovalDecisionId: creationApproval.decision.id,
    publishApprovalDecisionId: publishApproval.decision.id,
    robertApprovedPublish: true,
    previewDeployVerified: true,
    appQaTargetPassed: true,
    rollbackVerified: true,
    deployProvider: "replit",
    previewDeployUrl: "https://preview.example.com/publish-ready-cafe",
    appQaEvidenceUrl: "https://github.com/example/repo/actions/runs/123",
    rollbackPlanUrl: "https://github.com/example/repo/blob/main/ROLLBACK.md",
    writeFiles: true,
    deployWebsite: true,
    launchTargetDays: 7,
    json: false,
  });

  assert.equal(missingApproval.status, "blocked");
  assert.match(missingApproval.blockedReasons.join("; "), /publishApprovalDecisionId valido/);
  assert.equal(getRevenueWebsitePublishReadinessPacketExitCode(missingApproval), 1);
  assert.equal(unsafe.status, "blocked");
  assert.match(unsafe.blockedReasons.join("; "), /no escribe archivos ni despliega/);
  assert.equal(unsafe.safety.requestedWriteFiles, true);
  assert.equal(unsafe.safety.requestedDeployWebsite, true);
});

test("website publish readiness packet builds safe publish handoff", () => {
  const draft = createApprovedOutreachDraft();
  const creationApproval = approveWebsiteCreation(draft);
  const publishApproval = approveWebsitePublish(draft, creationApproval.decision.id);
  const packet = buildRevenueWebsitePublishReadinessPacketFromCli({
    outreachDraftId: draft.id,
    websiteCreationApprovalDecisionId: creationApproval.decision.id,
    publishApprovalDecisionId: publishApproval.decision.id,
    robertApprovedPublish: true,
    previewDeployVerified: true,
    appQaTargetPassed: true,
    rollbackVerified: true,
    deployProvider: "replit",
    previewDeployUrl: "https://preview.example.com/publish-ready-cafe",
    appQaEvidenceUrl: "https://github.com/example/repo/actions/runs/123",
    rollbackPlanUrl: "https://github.com/example/repo/blob/main/ROLLBACK.md",
    writeFiles: false,
    deployWebsite: false,
    launchTargetDays: 7,
    json: false,
  });
  const text = formatRevenueWebsitePublishReadinessPacketText(packet);

  assert.equal(packet.status, "ready_for_publish_handoff");
  assert.equal(packet.creationPacket.scaffold?.slug, "publish-ready-cafe-miami");
  assert.equal(packet.safety.writesFiles, false);
  assert.equal(packet.safety.deploys, false);
  assert.equal(packet.safety.publishesWebsite, false);
  assert.equal(getRevenueWebsitePublishReadinessPacketExitCode(packet), 0);
  assert.match(text, /Revenue website publish readiness packet: ready_for_publish_handoff/);
  assert.match(text, /Files prepared in packet: 4/);
});

test("website publish readiness packet blocks placeholder proof when builder is called directly", () => {
  const draft = createApprovedOutreachDraft();
  const creationApproval = approveWebsiteCreation(draft);
  const publishApproval = approveWebsitePublish(draft, creationApproval.decision.id, {
    deployProvider: "REPLACE_WITH_DEPLOY_PROVIDER",
    previewDeployUrl: "https://example.com/REPLACE_WITH_PREVIEW_DEPLOY_URL",
    appQaEvidenceUrl: "https://example.com/REPLACE_WITH_APP_QA_EVIDENCE_URL",
    rollbackPlanUrl: "https://example.com/REPLACE_WITH_ROLLBACK_PLAN_URL",
  });
  const packet = buildRevenueWebsitePublishReadinessPacketFromCli({
    outreachDraftId: draft.id,
    websiteCreationApprovalDecisionId: creationApproval.decision.id,
    publishApprovalDecisionId: publishApproval.decision.id,
    robertApprovedPublish: true,
    previewDeployVerified: true,
    appQaTargetPassed: true,
    rollbackVerified: true,
    deployProvider: "REPLACE_WITH_DEPLOY_PROVIDER",
    previewDeployUrl: "https://example.com/REPLACE_WITH_PREVIEW_DEPLOY_URL",
    appQaEvidenceUrl: "https://example.com/REPLACE_WITH_APP_QA_EVIDENCE_URL",
    rollbackPlanUrl: "https://example.com/REPLACE_WITH_ROLLBACK_PLAN_URL",
    writeFiles: false,
    deployWebsite: false,
    launchTargetDays: 7,
    json: false,
  });

  assert.equal(packet.status, "blocked");
  assert.equal(packet.gates[0].gate, "cli_options");
  assert.match(packet.blockedReasons.join("; "), /--deploy-provider must be real publish context/);
  assert.match(packet.blockedReasons.join("; "), /--preview-deploy-url must be real evidence/);
  assert.match(packet.blockedReasons.join("; "), /--app-qa-evidence-url must be real evidence/);
  assert.match(packet.blockedReasons.join("; "), /--rollback-plan-url must be real evidence/);
  assert.equal(getRevenueWebsitePublishReadinessPacketExitCode(packet), 1);
});

test("website publish readiness packet blocks stale approval when scaffold content changes", () => {
  const draft = createApprovedOutreachDraft();
  const creationApproval = approveWebsiteCreation(draft);
  const publishApproval = approveWebsitePublish(draft, creationApproval.decision.id);
  recordRevenueLead({
    businessName: "Publish Ready Cafe",
    area: "Miami",
    niche: "coffee shop",
    websiteStatus: "no_website",
    contactChannel: "email",
    contactValue: "owner@publishready.example",
    evidence: "Updated public evidence changes the preview proof text after App QA.",
    painPoint: "Updated pain point changes the generated website content.",
    estimatedOfferUsd: 4700,
    status: "mockup_ready",
  });

  const packet = buildRevenueWebsitePublishReadinessPacketFromCli({
    outreachDraftId: draft.id,
    websiteCreationApprovalDecisionId: creationApproval.decision.id,
    publishApprovalDecisionId: publishApproval.decision.id,
    robertApprovedPublish: true,
    previewDeployVerified: true,
    appQaTargetPassed: true,
    rollbackVerified: true,
    deployProvider: "replit",
    previewDeployUrl: "https://preview.example.com/publish-ready-cafe",
    appQaEvidenceUrl: "https://github.com/example/repo/actions/runs/123",
    rollbackPlanUrl: "https://github.com/example/repo/blob/main/ROLLBACK.md",
    writeFiles: false,
    deployWebsite: false,
    launchTargetDays: 7,
    json: false,
  });

  assert.equal(packet.status, "blocked");
  assert.match(packet.blockedReasons.join("; "), /publishApprovalDecisionId valido/);
  assert.equal(getRevenueWebsitePublishReadinessPacketExitCode(packet), 1);
});

test("website publish readiness packet script exits blocked until publish gates pass", () => {
  const draft = createApprovedOutreachDraft();
  const creationApproval = approveWebsiteCreation(draft);
  const publishApproval = approveWebsitePublish(draft, creationApproval.decision.id);
  const baseEnv = {
    ...process.env,
    REVENUE_ENGINE_LEADS_PATH: testLeadsPath,
    REVENUE_ENGINE_OUTREACH_PATH: testOutreachPath,
    REVENUE_ENGINE_APPROVAL_DECISIONS_PATH: testApprovalDecisionsPath,
  };
  const blocked = spawnSync(process.execPath, [
    "--import",
    "tsx",
    "script/revenue-website-publish-readiness-packet.ts",
    `--outreach-draft-id=${draft.id}`,
    `--website-creation-approval-decision-id=${creationApproval.decision.id}`,
    "--deploy-provider=replit",
    "--preview-deploy-url=https://preview.example.com/publish-ready-cafe",
    "--app-qa-evidence-url=https://github.com/example/repo/actions/runs/123",
    "--rollback-plan-url=https://github.com/example/repo/blob/main/ROLLBACK.md",
  ], {
    cwd: process.cwd(),
    env: baseEnv,
    encoding: "utf8",
  });
  const ready = spawnSync(process.execPath, [
    "--import",
    "tsx",
    "script/revenue-website-publish-readiness-packet.ts",
    `--outreach-draft-id=${draft.id}`,
    `--website-creation-approval-decision-id=${creationApproval.decision.id}`,
    `--publish-approval-decision-id=${publishApproval.decision.id}`,
    "--robert-approved-publish",
    "--preview-deploy-verified",
    "--app-qa-target-passed",
    "--rollback-verified",
    "--deploy-provider=replit",
    "--preview-deploy-url=https://preview.example.com/publish-ready-cafe",
    "--app-qa-evidence-url=https://github.com/example/repo/actions/runs/123",
    "--rollback-plan-url=https://github.com/example/repo/blob/main/ROLLBACK.md",
  ], {
    cwd: process.cwd(),
    env: baseEnv,
    encoding: "utf8",
  });

  assert.equal(blocked.status, 1);
  assert.match(blocked.stdout, /Revenue website publish readiness packet: blocked/);
  assert.match(blocked.stdout, /Robert debe aprobar publicar/);
  assert.equal(ready.status, 0);
  assert.match(ready.stdout, /Revenue website publish readiness packet: ready_for_publish_handoff/);
  assert.match(ready.stdout, /Publishes website: no/);
});
