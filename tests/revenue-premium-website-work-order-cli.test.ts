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
  buildRevenuePremiumWebsiteWorkOrderFromCli,
  formatRevenuePremiumWebsiteWorkOrderText,
  getRevenuePremiumWebsiteWorkOrderExitCode,
  parseRevenuePremiumWebsiteWorkOrderArgs,
  validateRevenuePremiumWebsiteWorkOrderOptions,
} from "../server/revenue-premium-website-work-order-cli";

const testLeadsPath = "/tmp/revenue-premium-website-work-order-leads-test.json";
const testOutreachPath = "/tmp/revenue-premium-website-work-order-outreach-test.json";

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
    businessName: "Premium Work Order Cafe",
    area: "Miami",
    niche: "coffee shop",
    websiteStatus: "no_website",
    contactChannel: "email",
    contactValue: "owner@premiumworkorder.example",
    evidence: "Public listing has no website, menu photos and a visible catering inquiry path.",
    painPoint: "Needs catering lead capture and online menu conversion.",
    estimatedOfferUsd: 4700,
    status: "mockup_ready",
  });
  return recordRevenueOutreachDraft({
    leadId: leadResult.lead.id,
    channel: "email",
    approvalStatus: "approved",
    recipientEmail: "owner@premiumworkorder.example",
    contactName: "Owner",
    businessName: "Premium Work Order Cafe",
    sourceUrl: "https://example.com/premium-work-order-cafe",
    businessSummary: "Premium Work Order Cafe has public evidence of no dedicated website and needs online menu capture plus catering follow-up.",
    websitePriceUsd: 3500,
    automationPriceUsd: 1200,
    monthlyRetainerUsd: 750,
    estimatedInternalMonthlyCostUsd: 54,
    notes: "",
  }).draft;
}

function readyOptions(outreachDraftId: string) {
  const evidenceContent = [
    outreachDraftId,
    "Premium Work Order Cafe",
    "https://example.com/premium-work-order-cafe",
    "owner@premiumworkorder.example",
    "4700",
    "approved",
  ].join(" ");
  const approvalEvidence = writeRevenueEvidenceFixture(`approval-packets/${outreachDraftId}.md`, evidenceContent);
  const scopeEvidence = writeRevenueEvidenceFixture(`signed-scope/${outreachDraftId}.md`, evidenceContent);
  const depositEvidence = writeRevenueEvidenceFixture(`deposits/${outreachDraftId}.md`, evidenceContent);
  const publicEvidence = writeRevenueEvidenceFixture(`public-verification/${outreachDraftId}.md`, evidenceContent);
  return parseRevenuePremiumWebsiteWorkOrderArgs([
    `--outreach-draft-id=${outreachDraftId}`,
    "--target-repo=robert/client-sites",
    "--target-project=premium-work-order-cafe",
    "--branch-name=codex/premium-work-order-cafe",
    "--qa-route=/premium-work-order-cafe",
    "--preview-url=https://preview.example.com/premium-work-order-cafe",
    "--production-url=https://premiumworkorder.example.com",
    "--deploy-provider=replit",
    "--health-url=https://premiumworkorder.example.com/api/health",
    "--build-command=npm run build",
    "--test-command=npm run test:app-qa-agent",
    "--robert-approved-build",
    `--robert-approval-evidence=${approvalEvidence}`,
    "--client-approved-scope",
    `--client-scope-evidence=${scopeEvidence}`,
    "--deposit-paid",
    `--deposit-evidence=${depositEvidence}`,
    "--public-data-verified",
    `--public-verification-evidence=${publicEvidence}`,
  ]);
}

test("parses and validates premium website work order options", () => {
  const parsed = parseRevenuePremiumWebsiteWorkOrderArgs([
    "--outreach-draft-id=outreach-123",
    "--target-repo=robert/client-sites",
    "--target-project=client-site",
    "--qa-route=/client-site",
    "--publish-preview",
    "--contact-client",
  ]);

  assert.equal(parsed.targetRepo, "robert/client-sites");
  assert.equal(parsed.targetProject, "client-site");
  assert.equal(parsed.branchName, "codex/premium-website-outreach-123");
  assert.equal(parsed.qaRoute, "/client-site");
  assert.equal(parsed.deployProvider, "replit");
  assert.equal(parsed.buildCommand, "npm run build");
  assert.equal(parsed.testCommand, "npm run test:app-qa-agent");
  assert.equal(parsed.publishPreview, true);
  assert.equal(parsed.contactClient, true);
  assert.deepEqual(validateRevenuePremiumWebsiteWorkOrderOptions(parsed), []);
  assert.deepEqual(
    validateRevenuePremiumWebsiteWorkOrderOptions(parseRevenuePremiumWebsiteWorkOrderArgs([
      "--outreach-draft-id=outreach-123",
      "--target-repo=not-owner-repo",
      "--branch-name=feature/site",
      "--qa-route=client-site",
    ])),
    [
      "--target-repo is required in owner/repo format.",
      "--branch-name must start with codex/.",
      "--qa-route must start with /.",
    ],
  );
  assert.deepEqual(
    validateRevenuePremiumWebsiteWorkOrderOptions(parseRevenuePremiumWebsiteWorkOrderArgs([
      "--outreach-draft-id=outreach-123",
      "--target-repo=robert/client-sites",
      "--build-command=npm run build && npm run deploy",
      "--test-command=npm run test:app-qa-agent | tee /tmp/out",
    ])),
    [
      "--build-command must be a safe npm run command without shell metacharacters.",
      "--test-command must be a safe npm run command without shell metacharacters.",
    ],
  );
});

test("premium website work order blocks non-ready website packets", () => {
  const draft = createApprovedOutreachDraft();
  const options = parseRevenuePremiumWebsiteWorkOrderArgs([
    `--outreach-draft-id=${draft.id}`,
    "--target-repo=robert/client-sites",
  ]);
  const workOrder = buildRevenuePremiumWebsiteWorkOrderFromCli(options);

  assert.equal(workOrder.status, "blocked");
  assert.equal(workOrder.packetStatus, "blocked");
  assert.equal(workOrder.safety.writesFiles, false);
  assert.match(workOrder.blockedReasons.join("; "), /Robert debe aprobar/);
  assert.equal(getRevenuePremiumWebsiteWorkOrderExitCode(workOrder), 1);
});

test("premium website work order emits PR-first design and QA contract", () => {
  const draft = createApprovedOutreachDraft();
  const workOrder = buildRevenuePremiumWebsiteWorkOrderFromCli(readyOptions(draft.id));
  const text = formatRevenuePremiumWebsiteWorkOrderText(workOrder);

  assert.equal(workOrder.status, "ready_for_pr_first_premium_website_work_order");
  assert.equal(workOrder.source.outreachDraftId, draft.id);
  assert.equal(workOrder.source.businessName, "Premium Work Order Cafe");
  assert.equal(workOrder.target.repo, "robert/client-sites");
  assert.equal(workOrder.target.branchName, "codex/premium-work-order-cafe");
  assert.equal(workOrder.scope.packageName, "Website 3D Premium + Automation Sprint");
  assert.equal(workOrder.scope.includesAutomation, true);
  assert.match(workOrder.evidence.depositEvidence, /^revenue_workspace\/deposits\//);
  assert.equal(workOrder.design.requiredSkills.includes("product-design:get-context"), true);
  assert.equal(workOrder.design.requiredSkills.includes("product-design:image-to-code"), true);
  assert.match(workOrder.design.standards.join(" "), /3D/);
  assert.equal(workOrder.implementationPlan.scaffoldFiles.some((file) => file.path.endsWith("index.html")), true);
  assert.equal(workOrder.implementationPlan.expectedCommands.includes("npm run build"), true);
  assert.equal(workOrder.implementationPlan.requiredArtifacts.includes("Product Design/Claude brief output"), true);
  assert.equal(workOrder.implementationPlan.requiredArtifacts.includes("motion/3D implementation spec"), true);
  assert.equal(workOrder.qaGate.checks.some((check) => check.includes("3D/canvas nonblank")), true);
  assert.equal(workOrder.rollback.required, true);
  assert.equal(workOrder.prFirst.readyForFileWrites, false);
  assert.equal(workOrder.prFirst.readyForDeploy, false);
  assert.equal(workOrder.safety.writesFiles, false);
  assert.equal(workOrder.safety.deploys, false);
  assert.equal(workOrder.safety.publishesPreview, false);
  assert.equal(workOrder.safety.contactsBusiness, false);
  assert.equal(getRevenuePremiumWebsiteWorkOrderExitCode(workOrder), 0);
  assert.match(text, /Revenue premium website work order: ready_for_pr_first_premium_website_work_order/);
  assert.match(text, /Required skills: .*product-design:get-context/);
  assert.match(text, /App QA required: yes/);
  assert.match(text, /Rollback:/);
  assert.match(text, /Writes files: no/);
});

test("premium website work order blocks placeholder evidence refs", () => {
  const draft = createApprovedOutreachDraft();
  const workOrder = buildRevenuePremiumWebsiteWorkOrderFromCli(parseRevenuePremiumWebsiteWorkOrderArgs([
    `--outreach-draft-id=${draft.id}`,
    "--target-repo=robert/client-sites",
    "--target-project=premium-work-order-cafe",
    "--robert-approved-build",
    "--robert-approval-evidence=ROBERT_APPROVAL_REF",
    "--client-approved-scope",
    "--client-scope-evidence=CLIENT_SCOPE_REF",
    "--deposit-paid",
    "--deposit-evidence=DEPOSIT_REF",
    "--public-data-verified",
    "--public-verification-evidence=PUBLIC_VERIFICATION_REF",
  ]));

  assert.equal(workOrder.status, "blocked");
  assert.equal(workOrder.packetStatus, "blocked");
  assert.match(workOrder.blockedReasons.join("; "), /Robert debe aprobar/);
  assert.match(workOrder.blockedReasons.join("; "), /deposito/);
  assert.equal(getRevenuePremiumWebsiteWorkOrderExitCode(workOrder), 1);
});

test("premium website work order blocks unsafe action flags", () => {
  const draft = createApprovedOutreachDraft();
  const options = {
    ...readyOptions(draft.id),
    writeFiles: true,
    deployWebsite: true,
    publishPreview: true,
    contactClient: true,
  };
  const workOrder = buildRevenuePremiumWebsiteWorkOrderFromCli(options);

  assert.equal(workOrder.status, "blocked");
  assert.equal(workOrder.safety.requestedWriteFiles, true);
  assert.equal(workOrder.safety.requestedDeployWebsite, true);
  assert.equal(workOrder.safety.requestedPublishPreview, true);
  assert.equal(workOrder.safety.requestedContactClient, true);
  assert.match(workOrder.blockedReasons.join("; "), /cannot write files directly/);
  assert.match(workOrder.blockedReasons.join("; "), /cannot deploy/);
  assert.match(workOrder.blockedReasons.join("; "), /cannot publish previews/);
  assert.match(workOrder.blockedReasons.join("; "), /cannot contact/);
  assert.equal(getRevenuePremiumWebsiteWorkOrderExitCode(workOrder), 1);
});

test("premium website work order script exits only for safe ready handoffs", () => {
  const draft = createApprovedOutreachDraft();
  const evidenceContent = [
    draft.id,
    "Premium Work Order Cafe",
    "https://example.com/premium-work-order-cafe",
    "owner@premiumworkorder.example",
    "4700",
    "approved",
  ].join(" ");
  const approvalEvidence = writeRevenueEvidenceFixture("approval-packets/premium-script-work-order.md", evidenceContent);
  const scopeEvidence = writeRevenueEvidenceFixture("signed-scope/premium-script-work-order.md", evidenceContent);
  const depositEvidence = writeRevenueEvidenceFixture("deposits/premium-script-work-order.md", evidenceContent);
  const publicEvidence = writeRevenueEvidenceFixture("public-verification/premium-script-work-order.md", evidenceContent);
  const baseArgs = [
    "--import",
    "tsx",
    "script/revenue-premium-website-work-order.ts",
    `--outreach-draft-id=${draft.id}`,
    "--target-repo=robert/client-sites",
    "--target-project=premium-work-order-cafe",
    "--robert-approved-build",
    `--robert-approval-evidence=${approvalEvidence}`,
    "--client-approved-scope",
    `--client-scope-evidence=${scopeEvidence}`,
    "--deposit-paid",
    `--deposit-evidence=${depositEvidence}`,
    "--public-data-verified",
    `--public-verification-evidence=${publicEvidence}`,
  ];
  const env = {
    ...process.env,
    REVENUE_ENGINE_LEADS_PATH: testLeadsPath,
    REVENUE_ENGINE_OUTREACH_PATH: testOutreachPath,
  };
  const ready = spawnSync(process.execPath, baseArgs, {
    cwd: process.cwd(),
    env,
    encoding: "utf8",
  });
  const unsafe = spawnSync(process.execPath, [...baseArgs, "--publish-preview", "--contact-client"], {
    cwd: process.cwd(),
    env,
    encoding: "utf8",
  });

  assert.equal(ready.status, 0);
  assert.match(ready.stdout, /Revenue premium website work order: ready_for_pr_first_premium_website_work_order/);
  assert.match(ready.stdout, /Writes files: no/);
  assert.equal(unsafe.status, 1);
  assert.match(unsafe.stdout, /Revenue premium website work order: blocked/);
  assert.match(unsafe.stdout, /cannot publish previews/);
  assert.match(unsafe.stdout, /cannot contact/);
});
