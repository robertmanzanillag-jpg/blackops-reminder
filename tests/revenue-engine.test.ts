import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import {
  answerRevenueAutomationIntake,
  buildAutomationQuote,
  buildRevenueUserDataPaths,
  buildImprovementReview,
  buildRevenueEnginePlan,
  buildRevenueLaunchReadiness,
  buildRevenueLeadRadar,
  buildRevenueMockup,
  buildRevenueMockupPreview,
  buildRevenueMockupTemplatePack,
  buildRevenueProjectPlan,
  buildRevenueScoutingMission,
  closeRevenueAutomationOpportunity,
  convertRevenueAutomationIntakeToOpportunity,
  createDeliveryWorkspaceFromAutomationOpportunity,
  createWebsiteDeliveryWorkspaceFromLead,
  deliverRevenueDeliveryWorkspace,
  getRevenueEngineSnapshot,
  getRevenueMockupPreviewPath,
  preflightRevenueExpense,
  previewRevenueMoneySprintSeeds,
  recordRevenueAgentRun,
  recordRevenueApprovalDecision,
  recordRevenueAutomationIntake,
  recordRevenueAutomationOpportunity,
  recordRevenueDeliveryWorkspace,
  recordRevenueDeliveryWorkspaceImprovementReview,
  recordRevenueImprovementReview,
  recordRevenueLead,
  recordRevenueLedgerEntry,
  recordRevenueOutreachDraft,
  recordRevenuePublicLeadCandidate,
  recordRevenueSalesAutopilot,
  recordRevenueScoutingMission,
  runRevenueMoneySprintFromPublicCandidates,
  runRevenueAutomationAgentCommand,
  runRevenueMoneySprint,
  resetRevenueAgentRunsForTests,
  resetRevenueApprovalDecisionsForTests,
  resetRevenueAutomationIntakesForTests,
  resetRevenueAutomationOpportunitiesForTests,
  resetRevenueDeliveryWorkspacesForTests,
  resetRevenueImprovementReviewsForTests,
  resetRevenueLeadsForTests,
  resetRevenueLedgerForTests,
  resetRevenueOutreachForTests,
  resetRevenuePublicLeadCandidatesForTests,
  resetRevenueScoutingMissionsForTests,
  setRevenueAgentRunsPathForTests,
  setRevenueApprovalDecisionsPathForTests,
  setRevenueAutomationIntakesPathForTests,
  setRevenueAutomationOpportunitiesPathForTests,
  setRevenueDeliveryWorkspacesPathForTests,
  setRevenueImprovementReviewsPathForTests,
  setRevenueLeadsPathForTests,
  setRevenueLedgerPathForTests,
  setRevenueOutreachPathForTests,
  setRevenuePublicLeadCandidatesPathForTests,
  setRevenueScoutingMissionsPathForTests,
  setRevenueOutreachSenderForTests,
  sendRevenueOutreachDraft,
  setRevenueUserDataScope,
  updateRevenueDeliveryWorkspaceQa,
} from "../server/revenue-engine";

const testLedgerPath = path.join("/tmp", "revenue-engine-ledger-test.json");
const testLeadsPath = path.join("/tmp", "revenue-engine-leads-test.json");
const testOutreachPath = path.join("/tmp", "revenue-engine-outreach-test.json");
const testAgentRunsPath = path.join("/tmp", "revenue-engine-agent-runs-test.json");
const testApprovalDecisionsPath = path.join("/tmp", "revenue-engine-approval-decisions-test.json");
const testAutomationIntakesPath = path.join("/tmp", "revenue-engine-automation-intakes-test.json");
const testAutomationOpportunitiesPath = path.join("/tmp", "revenue-engine-automation-opportunities-test.json");
const testImprovementReviewsPath = path.join("/tmp", "revenue-engine-improvement-reviews-test.json");
const testScoutingMissionsPath = path.join("/tmp", "revenue-engine-scouting-missions-test.json");
const testPublicLeadCandidatesPath = path.join("/tmp", "revenue-engine-public-lead-candidates-test.json");
const testDeliveryWorkspacesPath = path.join("/tmp", "revenue-engine-delivery-workspaces-test.json");
const testMockupsDir = path.join("/tmp", "revenue-engine-mockups-test");
const originalResendApiKey = process.env.RESEND_API_KEY;
const originalRevenueEngineFromEmail = process.env.REVENUE_ENGINE_FROM_EMAIL;
const originalResendFromEmail = process.env.RESEND_FROM_EMAIL;
const originalRevenueMockupsDir = process.env.REVENUE_MOCKUPS_DIR;

test.beforeEach(() => {
  delete process.env.RESEND_API_KEY;
  delete process.env.REVENUE_ENGINE_FROM_EMAIL;
  delete process.env.RESEND_FROM_EMAIL;
  process.env.REVENUE_MOCKUPS_DIR = testMockupsDir;
  setRevenueLedgerPathForTests(testLedgerPath);
  setRevenueLeadsPathForTests(testLeadsPath);
  setRevenueOutreachPathForTests(testOutreachPath);
  setRevenueAgentRunsPathForTests(testAgentRunsPath);
  setRevenueApprovalDecisionsPathForTests(testApprovalDecisionsPath);
  setRevenueAutomationIntakesPathForTests(testAutomationIntakesPath);
  setRevenueAutomationOpportunitiesPathForTests(testAutomationOpportunitiesPath);
  setRevenueImprovementReviewsPathForTests(testImprovementReviewsPath);
  setRevenueScoutingMissionsPathForTests(testScoutingMissionsPath);
  setRevenuePublicLeadCandidatesPathForTests(testPublicLeadCandidatesPath);
  setRevenueDeliveryWorkspacesPathForTests(testDeliveryWorkspacesPath);
  setRevenueOutreachSenderForTests(null);
  resetRevenueLedgerForTests();
  resetRevenueLeadsForTests();
  resetRevenueOutreachForTests();
  resetRevenueAgentRunsForTests();
  resetRevenueApprovalDecisionsForTests();
  resetRevenueAutomationIntakesForTests();
  resetRevenueAutomationOpportunitiesForTests();
  resetRevenueImprovementReviewsForTests();
  resetRevenueScoutingMissionsForTests();
  resetRevenuePublicLeadCandidatesForTests();
  resetRevenueDeliveryWorkspacesForTests();
});

test("scopes Revenue Engine JSON paths by authenticated user", () => {
  const paths = buildRevenueUserDataPaths("user@example.com/with spaces");

  assert.match(paths.baseDir, /revenue_engine_data\/users\/user_example_com_with_spaces$/);
  assert.match(paths.ledgerPath, /revenue_engine_data\/users\/user_example_com_with_spaces\/ledger\.json$/);

  setRevenueUserDataScope("owner-a");
  const scopedSnapshot = getRevenueEngineSnapshot();
  assert.match(scopedSnapshot.persistence.path, /revenue_engine_data\/users\/owner-a\/ledger\.json$/);
  assert.match(scopedSnapshot.persistence.leadsPath, /revenue_engine_data\/users\/owner-a\/leads\.json$/);
  assert.match(scopedSnapshot.persistence.outreachPath, /revenue_engine_data\/users\/owner-a\/outreach\.json$/);
  assert.match(scopedSnapshot.persistence.publicLeadCandidatesPath, /revenue_engine_data\/users\/owner-a\/public_lead_candidates\.json$/);
});

test.afterEach(() => {
  if (originalResendApiKey === undefined) delete process.env.RESEND_API_KEY;
  else process.env.RESEND_API_KEY = originalResendApiKey;
  if (originalRevenueEngineFromEmail === undefined) delete process.env.REVENUE_ENGINE_FROM_EMAIL;
  else process.env.REVENUE_ENGINE_FROM_EMAIL = originalRevenueEngineFromEmail;
  if (originalResendFromEmail === undefined) delete process.env.RESEND_FROM_EMAIL;
  else process.env.RESEND_FROM_EMAIL = originalResendFromEmail;
  if (originalRevenueMockupsDir === undefined) delete process.env.REVENUE_MOCKUPS_DIR;
  else process.env.REVENUE_MOCKUPS_DIR = originalRevenueMockupsDir;
});

test("caps lead plan spend at the starting monthly budget", () => {
  const plan = buildRevenueEnginePlan({
    area: "Miami",
    niche: "restaurants",
    offerFocus: "both",
    monthlyBudgetUsd: 250,
    leadCount: 50,
  });

  assert.equal(plan.budget.monthlyCapUsd, 100);
  assert.equal(plan.budget.isInsideCap, true);
});

test("builds a no-website scouting mission with approval gates", () => {
  const mission = buildRevenueScoutingMission({
    area: "Miami",
    niche: "med spas",
    offerFocus: "both",
    targetLeadCount: 40,
    maxPaidDataSpendUsd: 0,
    requireNoWebsiteSignal: true,
    includeWeakWebsiteLeads: true,
  });

  assert.equal(mission.mission.mode, "free_public_research");
  assert.equal(mission.mission.leadBatchSize, 25);
  assert.equal(mission.budgetGate.monthlyCapUsd, 100);
  assert.equal(mission.budgetGate.requiresApprovalToSpend, false);
  assert.equal(mission.budgetGate.blockedBeforeApproval.includes("send email"), true);
  assert.equal(mission.searchQueries.some((query) => query.includes("Miami")), true);
  assert.equal(mission.qualificationScorecard.some((item) => item.item === "No website or weak website signal"), true);
  assert.equal(mission.subagentReviews.some((review) => review.agent === "qa-council"), true);
});

test("caps paid scouting spend and requires approval", () => {
  const mission = buildRevenueScoutingMission({
    area: "Orlando",
    niche: "roofers",
    offerFocus: "websites",
    targetLeadCount: 80,
    maxPaidDataSpendUsd: 140,
    requireNoWebsiteSignal: true,
    includeWeakWebsiteLeads: false,
  });

  assert.equal(mission.budgetGate.approvedPaidDataSpendUsd, 100);
  assert.equal(mission.budgetGate.requiresApprovalToSpend, true);
  assert.equal(mission.mission.mode, "paid_data_requires_approval");
  assert.equal(mission.mission.leadBatchSize, 50);
  assert.equal(mission.nextActions.some((action) => action.includes("80")), false);
});

test("records and persists scouting missions as batch memory", () => {
  const result = recordRevenueScoutingMission({
    area: "Miami",
    niche: "med spas",
    offerFocus: "both",
    targetLeadCount: 25,
    maxPaidDataSpendUsd: 0,
    requireNoWebsiteSignal: true,
    includeWeakWebsiteLeads: true,
  });

  assert.equal(result.mission.status, "ready_for_leads");
  assert.equal(result.mission.learningNote.includes("research publico gratis"), true);
  assert.equal(result.snapshot.recentScoutingMissions[0].mission.area, "Miami");
  assert.equal(result.snapshot.persistence.scoutingMissionsStatus, "ok");

  setRevenueScoutingMissionsPathForTests(testScoutingMissionsPath);
  const snapshot = getRevenueEngineSnapshot();

  assert.equal(snapshot.recentScoutingMissions.length, 1);
  assert.equal(snapshot.recentScoutingMissions[0].mission.niche, "med spas");
});

test("builds an always-on lead radar with contact and mockup limits", () => {
  const radar = buildRevenueLeadRadar({
    area: "Miami",
    niches: "med spas, gyms, restaurants",
    offerFocus: "both",
    runHoursPerDay: 24,
    dailyResearchTarget: 120,
    dailyQualifiedLeadLimit: 36,
    dailyMockupLimit: 8,
    dailyContactLimit: 10,
    maxPaidDataSpendUsd: 0,
    requireRobertApprovalToContact: true,
  });

  assert.equal(radar.status, "always_on_ready");
  assert.equal(radar.operatingMode.researchRunsAllDay, true);
  assert.equal(radar.operatingMode.contactMode, "draft_only");
  assert.equal(radar.dailyLimits.researchPerHour, 5);
  assert.equal(radar.dailyLimits.qualifiedPerHour, 2);
  assert.equal(radar.dailyLimits.mockupLimit, 8);
  assert.equal(radar.dailyLimits.contactLimit, 10);
  assert.equal(radar.dailyLimits.monthlySpendCapUsd, 100);
  assert.equal(radar.channelMix[0].channel.includes("Google Maps"), true);
  assert.equal(radar.mockupPolicy.whoCreatesMockups.includes("Codex"), true);
  assert.equal(radar.recommendation.includes("Buscar leads puede correr 24/7"), true);
});

test("records verified public lead candidates as previewable batch rows without outreach", () => {
  recordRevenuePublicLeadCandidate({
    businessName: "Older Orlando Roof",
    area: "Orlando",
    niche: "roofers",
    websiteStatus: "no_website",
    contactChannel: "email",
    contactValue: "owner@olderroof.example",
    sourceUrl: "https://example.com/older-roof",
    recipientEmail: "owner@olderroof.example",
    evidence: "Public listing has no website, recent roofing photos and verified contact path.",
    painPoint: "Needs storm repair lead capture and follow-up.",
    estimatedOfferUsd: 4200,
    status: "research",
    verificationStatus: "verified_public",
    publicEvidenceVerified: true,
    approvalToImport: true,
  });
  const result = recordRevenuePublicLeadCandidate({
    businessName: "Public Scout Cafe",
    area: "Miami",
    niche: "coffee shop",
    websiteStatus: "no_website",
    contactChannel: "email",
    contactValue: "owner@publicscout.example",
    sourceUrl: "https://example.com/public-scout-cafe",
    recipientEmail: "owner@publicscout.example",
    evidence: "Google listing has no website, public social profile has menu photos and verified contact path.",
    painPoint: "Needs online menu capture, catering inquiries and follow-up.",
    estimatedOfferUsd: 3600,
    status: "research",
    contactName: "Owner",
    businessSummary: "Public Scout Cafe is a verified no-website coffee shop candidate with a visible public contact path.",
    sourceTaskId: "scout-task-01",
    verificationStatus: "verified_public",
    publicEvidenceVerified: true,
    approvalToImport: true,
  });
  const snapshot = getRevenueEngineSnapshot();

  assert.equal(result.status, "ready_for_preview");
  assert.equal(result.candidate.importReady, true);
  assert.equal(result.importableCount, 1);
  assert.match(result.importBatchText, /Public Scout Cafe/);
  assert.doesNotMatch(result.importBatchText, /Older Orlando Roof/);
  assert.equal(result.importBatchText.split("\n").length, 2);
  assert.equal(result.candidate.safety.persistsLead, false);
  assert.equal(result.candidate.safety.sendsOutreach, false);
  assert.equal(snapshot.recentPublicLeadCandidates[0].businessName, "Public Scout Cafe");
  assert.equal(snapshot.publicLeadImportQueue.readyCount, 2);
  assert.equal(snapshot.publicLeadImportQueue.items[0].candidateId, result.candidate.id);
  assert.equal(snapshot.recentLeads.length, 0);
  assert.equal(snapshot.recentOutreach.length, 0);
});

test("blocks public lead candidates from import until evidence is verified", () => {
  const result = recordRevenuePublicLeadCandidate({
    businessName: "Unverified Salon",
    area: "Miami",
    niche: "salon",
    websiteStatus: "unknown",
    contactChannel: "unknown",
    contactValue: "",
    sourceUrl: "https://example.com/unverified-salon",
    recipientEmail: "",
    evidence: "short",
    painPoint: "Needs review.",
    estimatedOfferUsd: 1000,
    status: "research",
    verificationStatus: "needs_review",
    publicEvidenceVerified: false,
    approvalToImport: false,
  });

  assert.equal(result.status, "needs_review");
  assert.equal(result.candidate.importReady, false);
  assert.equal(result.importableCount, 0);
  assert.equal(result.importBatchText.split("\n").length, 1);
  assert.match(result.nextAction, /public evidence not verified/);
  assert.equal(getRevenueEngineSnapshot().recentLeads.length, 0);
  assert.equal(getRevenueEngineSnapshot().publicLeadImportQueue.readyCount, 0);
  assert.equal(getRevenueEngineSnapshot().publicLeadImportQueue.blockedCount, 1);
});

test("runs money sprint from verified public candidates without copy paste or outreach send", () => {
  const candidate = recordRevenuePublicLeadCandidate({
    businessName: "Verified Sprint Cafe",
    area: "Miami",
    niche: "coffee shop",
    websiteStatus: "no_website",
    contactChannel: "email",
    contactValue: "owner@verifiedsprint.example",
    sourceUrl: "https://example.com/verified-sprint-cafe",
    recipientEmail: "owner@verifiedsprint.example",
    evidence: "Google listing has no website, recent menu photos and verified owner email.",
    painPoint: "Needs online menu, catering inquiry capture and follow-up.",
    estimatedOfferUsd: 4200,
    status: "research",
    contactName: "Owner",
    businessSummary: "Verified Sprint Cafe has public evidence of no website and a clear need for menu capture.",
    verificationStatus: "verified_public",
    publicEvidenceVerified: true,
    approvalToImport: true,
  });

  const result = runRevenueMoneySprintFromPublicCandidates({
    area: "Miami",
    niche: "coffee shop",
    offerFocus: "both",
    dailyResearchTarget: 30,
    dailyQualifiedLeadLimit: 10,
    dailyMockupLimit: 3,
    dailyContactLimit: 5,
    maxPaidDataSpendUsd: 0,
    requireRobertApprovalToContact: true,
    writePreviewFiles: true,
    candidateIds: [candidate.candidate.id],
    maxCandidates: 5,
  });

  assert.equal(result.status, "started");
  assert.deepEqual(result.importedCandidateIds, [candidate.candidate.id]);
  assert.equal(result.safety.sendsOutreach, false);
  assert.equal(result.sprint?.recordedLeads.length, 1);
  assert.equal(result.sprint?.previews.length, 1);
  assert.equal(result.sprint?.outreachDrafts.length, 1);
  assert.equal(result.sprint?.outreachDrafts[0].delivery.sendStatus, "not_sent");
  assert.equal(result.snapshot.recentLeads[0].businessName, "Verified Sprint Cafe");
  assert.equal(result.snapshot.publicLeadImportQueue.readyCount, 0);
  assert.equal(result.snapshot.manualOutreachQueue.readyCount, 0);
});

test("blocks money sprint from public candidates until candidate is verified and approved", () => {
  const candidate = recordRevenuePublicLeadCandidate({
    businessName: "Unapproved Sprint Salon",
    area: "Miami",
    niche: "salon",
    websiteStatus: "no_website",
    contactChannel: "email",
    contactValue: "owner@unapprovedsprint.example",
    sourceUrl: "https://example.com/unapproved-sprint-salon",
    recipientEmail: "owner@unapprovedsprint.example",
    evidence: "Public listing has no website and recent salon photos.",
    painPoint: "Needs booking lead capture.",
    estimatedOfferUsd: 3200,
    status: "research",
    contactName: "Owner",
    businessSummary: "Unapproved Sprint Salon has public evidence but still needs Robert import approval.",
    verificationStatus: "verified_public",
    publicEvidenceVerified: true,
    approvalToImport: false,
  });

  const result = runRevenueMoneySprintFromPublicCandidates({
    area: "Miami",
    niche: "salon",
    offerFocus: "both",
    dailyResearchTarget: 30,
    dailyQualifiedLeadLimit: 10,
    dailyMockupLimit: 3,
    dailyContactLimit: 5,
    maxPaidDataSpendUsd: 0,
    requireRobertApprovalToContact: true,
    writePreviewFiles: true,
    candidateIds: [candidate.candidate.id],
    maxCandidates: 5,
  });

  assert.equal(result.status, "blocked");
  assert.equal(result.sprint, null);
  assert.equal(result.blockedCandidates[0].reason.includes("approvalToImport false"), true);
  assert.equal(result.snapshot.recentLeads.length, 0);
});

test("blocks public candidate money sprint when paid data spend is requested", () => {
  const candidate = recordRevenuePublicLeadCandidate({
    businessName: "Paid Spend Cafe",
    area: "Miami",
    niche: "coffee shop",
    websiteStatus: "no_website",
    contactChannel: "email",
    contactValue: "owner@paidspendcafe.example",
    sourceUrl: "https://example.com/paid-spend-cafe",
    recipientEmail: "owner@paidspendcafe.example",
    evidence: "Public listing has no website, recent menu photos and verified owner email.",
    painPoint: "Needs online menu.",
    estimatedOfferUsd: 3600,
    status: "research",
    contactName: "Owner",
    businessSummary: "Paid Spend Cafe is verified but the sprint request asks for paid data spend.",
    verificationStatus: "verified_public",
    publicEvidenceVerified: true,
    approvalToImport: true,
  });

  const result = runRevenueMoneySprintFromPublicCandidates({
    area: "Miami",
    niche: "coffee shop",
    offerFocus: "both",
    dailyResearchTarget: 30,
    dailyQualifiedLeadLimit: 10,
    dailyMockupLimit: 3,
    dailyContactLimit: 5,
    maxPaidDataSpendUsd: 25,
    requireRobertApprovalToContact: true,
    writePreviewFiles: true,
    candidateIds: [candidate.candidate.id],
    maxCandidates: 5,
  });

  assert.equal(result.status, "needs_spend_approval");
  assert.equal(result.sprint, null);
  assert.equal(result.safety.persistsData, false);
  assert.equal(result.snapshot.recentLeads.length, 0);
});

test("lead radar caps paid data spend and requires approval", () => {
  const radar = buildRevenueLeadRadar({
    area: "Orlando",
    niches: "roofers",
    offerFocus: "websites",
    runHoursPerDay: 12,
    dailyResearchTarget: 240,
    dailyQualifiedLeadLimit: 40,
    dailyMockupLimit: 6,
    dailyContactLimit: 12,
    maxPaidDataSpendUsd: 350,
    requireRobertApprovalToContact: true,
  });

  assert.equal(radar.status, "needs_spend_approval");
  assert.equal(radar.operatingMode.spendMode, "approval_required");
  assert.equal(radar.dailyLimits.approvedPaidDataSpendUsd, 100);
  assert.equal(radar.nextActions.some((action) => action.includes("Contactar max 12/dia")), true);
});

test("builds a zero-cost premium mockup template pack", () => {
  const pack = buildRevenueMockupTemplatePack({
    niche: "med spas",
    area: "Miami",
    dailyMockupTarget: 8,
    maxCustomMinutesPerMockup: 18,
    estimatedAiCostPerMockupUsd: 0,
  });

  assert.equal(pack.status, "ready");
  assert.equal(pack.pack.templateCount, 5);
  assert.equal(pack.costModel.hostingCostUsd, 0);
  assert.equal(pack.costModel.paidAssetCostUsd, 0);
  assert.equal(pack.costModel.monthlyAiCostUsd, 0);
  assert.equal(pack.costModel.insideZeroCostMode, true);
  assert.equal(pack.templates.some((template) => template.id === "shock_hero_booking"), true);
  assert.equal(pack.productionLine.some((step) => step.ownerAgent === "visual-qa"), true);
  assert.equal(pack.guardrails.some((guardrail) => guardrail.includes("No pagar hosting")), true);
});

test("mockup template pack makes AI cost visible and caps monthly spend", () => {
  const pack = buildRevenueMockupTemplatePack({
    niche: "gyms",
    area: "Orlando",
    dailyMockupTarget: 20,
    maxCustomMinutesPerMockup: 12,
    estimatedAiCostPerMockupUsd: 0.03,
  });

  assert.equal(pack.status, "ready");
  assert.equal(pack.costModel.dailyAiCostUsd, 0.6);
  assert.equal(pack.costModel.monthlyAiCostUsd, 18);
  assert.equal(pack.costModel.insideZeroCostMode, false);
  assert.equal(pack.costModel.insideMonthlyCap, true);
  assert.equal(pack.productionTargets.estimatedMockupsPerMonth, 600);
  assert.equal(pack.productionTargets.recommendedContactLimitPerDay, 15);
});

test("launch readiness is ready to start with only email pending", () => {
  const readiness = buildRevenueLaunchReadiness({
    area: "Miami",
    niche: "med spas / aesthetics",
    dailyResearchTarget: 120,
    dailyMockupTarget: 5,
    dailyContactTarget: 10,
    emailPending: true,
  });

  assert.equal(readiness.status, "ready_to_start");
  assert.equal(readiness.blocked, 0);
  assert.equal(readiness.pendingAllowed, 1);
  assert.equal(readiness.items.find((item) => item.id === "email_sender")?.status, "pending_allowed");
  assert.equal(readiness.emailPending.isPending, true);
  assert.equal(readiness.emailPending.allowedWhilePending.includes("contact forms"), true);
  assert.equal(readiness.manualStartPlan.some((step) => step.includes("5 mockups")), true);
  assert.equal(readiness.summary.includes("solo falta configurar el correo"), true);
});

test("snapshot exposes launch readiness without blocking on email provider", () => {
  const snapshot = getRevenueEngineSnapshot();

  assert.equal(snapshot.launchReadiness.status, "ready_to_start");
  assert.equal(snapshot.launchReadiness.blocked, 0);
  assert.equal(snapshot.launchReadiness.emailPending.isPending, true);
  assert.equal(snapshot.emailProvider.configured, false);
});

test("records sold apps and automations into revenue metrics", () => {
  const result = recordRevenueLedgerEntry({
    kind: "bundle_sale",
    clientName: "Black Room",
    amountUsd: 6000,
    cashCollectedUsd: 3000,
    estimatedInternalCostUsd: 64,
    notes: "Website 3D Premium + Automation Sprint",
  });
  const snapshot = getRevenueEngineSnapshot();

  assert.equal(result.guardrail.status, "ok");
  assert.equal(snapshot.metrics.appsSold, 1);
  assert.equal(snapshot.metrics.automationsSold, 1);
  assert.equal(snapshot.metrics.revenueUsd, 6000);
  assert.equal(snapshot.metrics.cashCollectedUsd, 3000);
  assert.equal(snapshot.metrics.estimatedSpendUsd, 64);
  assert.equal(snapshot.metrics.profitUsd, 2936);
  assert.equal(snapshot.executiveSummary.appsSold, 1);
  assert.equal(snapshot.executiveSummary.automationsSold, 1);
  assert.equal(snapshot.executiveSummary.cashCollectedUsd, 3000);
  assert.equal(snapshot.executiveSummary.status, "ready");
  assert.equal(snapshot.pipelineStages.some((stage) => stage.id === "closed" && stage.count === 1 && stage.valueUsd === 6000), true);
});

test("blocks ledger expense when spend is higher than collected cash", () => {
  const result = recordRevenueLedgerEntry({
    kind: "expense",
    clientName: "Lead tools",
    amountUsd: 25,
    cashCollectedUsd: 0,
    estimatedInternalCostUsd: 0,
    notes: "Paid outreach test",
  });

  assert.equal(result.entry, null);
  assert.equal(result.guardrail.status, "blocked");
  assert.equal(result.guardrail.reason.includes("cash cobrado"), true);
  assert.equal(result.snapshot.metrics.estimatedSpendUsd, 0);
  assert.equal(result.snapshot.metrics.profitUsd, 0);
  assert.equal(result.snapshot.profitGuard.status, "collect_first");
  assert.equal(result.snapshot.profitGuard.canSpendUsd, 0);
});

test("expense preflight blocks spend before cash or cap allow it", () => {
  const result = preflightRevenueExpense({
    concept: "Paid lead data",
    amountUsd: 25,
    estimatedInternalCostUsd: 0,
    notes: "Proposed spend before collecting deposit.",
  });

  assert.equal(result.status, "blocked");
  assert.equal(result.blockers.some((blocker) => blocker.includes("cash")), true);
  assert.equal(result.snapshot.metrics.estimatedSpendUsd, 0);
  assert.equal(result.nextAction.includes("No gastar"), true);
});

test("profit guard collects first before any external spend", () => {
  const snapshot = getRevenueEngineSnapshot();

  assert.equal(snapshot.profitGuard.status, "collect_first");
  assert.equal(snapshot.profitGuard.canSpendUsd, 0);
  assert.equal(snapshot.profitGuard.requiredActions.includes("cobrar deposito"), true);
  assert.equal(snapshot.nextBatchPlan.status, "collect_first");
  assert.equal(snapshot.nextBatchPlan.maxSpendUsd, 0);
  assert.equal(snapshot.agentOperatingContract.mode, "draft_only");
  assert.equal(snapshot.agentOperatingContract.requiresHumanApproval.includes("gastar dinero"), true);
  assert.equal(snapshot.operatorConsole.canSpendNow, false);
  assert.equal(snapshot.operatorConsole.nextCommand.includes("cobrar deposito"), true);
  assert.equal(snapshot.operatorConsole.moneyLine.includes("0 apps/websites"), true);
  assert.equal(snapshot.systemReadiness.items.some((item) => item.id === "separate_area" && item.status === "ready"), true);
  assert.equal(snapshot.systemReadiness.items.some((item) => item.id === "ask_when_unclear" && item.status === "ready"), true);
  assert.equal(snapshot.systemReadiness.items.some((item) => item.id === "continuous_improvement" && item.status === "needs_data"), true);
});

test("profit guard allows small scale only when cash covers spend", () => {
  recordRevenueLedgerEntry({
    kind: "bundle_sale",
    clientName: "Cash Client",
    amountUsd: 5000,
    cashCollectedUsd: 2500,
    estimatedInternalCostUsd: 40,
    notes: "Deposit collected",
  });
  const snapshot = getRevenueEngineSnapshot();

  assert.equal(snapshot.profitGuard.status, "scale_carefully");
  assert.equal(snapshot.profitGuard.canSpendUsd, 60);
  assert.equal(snapshot.profitGuard.remainingCapUsd, 60);
  assert.equal(snapshot.agentOperatingContract.mode, "controlled_autopilot");
  assert.equal(snapshot.agentOperatingContract.blockedActions.length, 0);
  assert.equal(snapshot.operatorConsole.canSpendNow, true);
  assert.equal(snapshot.operatorConsole.spendPermission.includes("60 USD"), true);
  assert.equal(snapshot.operatorConsole.scoreboard.cashCollectedUsd, 2500);
  assert.equal(snapshot.systemReadiness.items.some((item) => item.id === "dont_spend_more_than_cash" && item.status === "ready"), true);
  assert.equal(snapshot.systemReadiness.items.some((item) => item.id === "controlled_autonomy" && item.status === "ready"), true);
});

test("expense preflight approves only within cash and monthly cap", () => {
  recordRevenueLedgerEntry({
    kind: "bundle_sale",
    clientName: "Preflight Cash Client",
    amountUsd: 3000,
    cashCollectedUsd: 1500,
    estimatedInternalCostUsd: 25,
    notes: "Deposit collected",
  });

  const result = preflightRevenueExpense({
    concept: "Small approved data check",
    amountUsd: 15,
    estimatedInternalCostUsd: 0,
    notes: "Preflight only.",
  });

  assert.equal(result.status, "approved");
  assert.equal(result.projected.spendUsd, 40);
  assert.equal(result.projected.cashCoverageUsd, 1460);
  assert.equal(result.snapshot.metrics.estimatedSpendUsd, 25);
});

test("records ledger expense only after cash covers spend and cap remains safe", () => {
  recordRevenueLedgerEntry({
    kind: "bundle_sale",
    clientName: "Expense Safe Client",
    amountUsd: 3000,
    cashCollectedUsd: 1500,
    estimatedInternalCostUsd: 25,
    notes: "Deposit collected",
  });

  const result = recordRevenueLedgerEntry({
    kind: "expense",
    clientName: "Approved lead check",
    amountUsd: 15,
    cashCollectedUsd: 0,
    estimatedInternalCostUsd: 0,
    notes: "Small approved spend.",
  });

  assert.equal(result.entry?.kind, "expense");
  assert.equal(result.guardrail.status, "ok");
  assert.equal(result.snapshot.metrics.estimatedSpendUsd, 40);
  assert.equal(result.snapshot.metrics.profitUsd, 1460);
});

test("records approval decisions without bypassing spend guardrails", () => {
  const result = recordRevenueApprovalDecision({
    targetId: "manual",
    targetType: "manual",
    decision: "approved",
    approvedAction: "Aprobar research y mockup interno",
    maxSpendUsd: 0,
    notes: "No external spend.",
  });

  assert.equal(result.decision.guardrail.status, "recorded");
  assert.equal(result.snapshot.recentApprovalDecisions[0].approvedAction, "Aprobar research y mockup interno");
});

test("blocks approval decisions that try to spend before profit guard allows it", () => {
  const result = recordRevenueApprovalDecision({
    targetId: "paid-data",
    targetType: "manual",
    decision: "approved",
    approvedAction: "Comprar data de leads",
    maxSpendUsd: 25,
    notes: "Trying paid data before cash.",
  });

  assert.equal(result.decision.guardrail.status, "blocked");
  assert.equal(result.decision.guardrail.reason.includes("No se puede aprobar gasto"), true);
  assert.equal(result.snapshot.recentApprovalDecisions[0].guardrail.status, "blocked");
});

test("persists approval decisions across module state reloads", () => {
  recordRevenueApprovalDecision({
    targetId: "manual",
    targetType: "manual",
    decision: "needs_changes",
    approvedAction: "Revisar copy antes de enviar",
    maxSpendUsd: 0,
    notes: "Needs tighter proof.",
  });

  setRevenueApprovalDecisionsPathForTests(testApprovalDecisionsPath);
  const snapshot = getRevenueEngineSnapshot();

  assert.equal(snapshot.recentApprovalDecisions[0].decision, "needs_changes");
  assert.equal(snapshot.recentApprovalDecisions[0].approvedAction, "Revisar copy antes de enviar");
}
);

test("qualifies no-website leads for mockup when evidence and contact exist", () => {
  const result = recordRevenueLead({
    businessName: "No Site Cafe",
    area: "Miami",
    niche: "coffee shop",
    websiteStatus: "no_website",
    contactChannel: "instagram",
    contactValue: "@nositecafe",
    evidence: "Instagram active weekly, no website in bio, menu only in posts.",
    painPoint: "Needs online menu, events capture and catering leads.",
    estimatedOfferUsd: 2500,
    status: "research",
  });
  const snapshot = getRevenueEngineSnapshot();

  assert.equal(result.qualification.grade, "A");
  assert.equal(result.lead.status, "mockup_ready");
  assert.equal(snapshot.pipelineStages.some((stage) => stage.id === "mockup" && stage.count === 1 && stage.valueUsd === 2500), true);
});

test("deduplicates repeated revenue leads by business area and contact", () => {
  const first = recordRevenueLead({
    businessName: "No Site Cafe",
    area: "Miami",
    niche: "coffee shop",
    websiteStatus: "no_website",
    contactChannel: "instagram",
    contactValue: "@nositecafe",
    evidence: "Instagram active weekly, no website in bio, menu only in posts.",
    painPoint: "Needs online menu and catering leads.",
    estimatedOfferUsd: 2500,
    status: "research",
  });
  const second = recordRevenueLead({
    businessName: "No Site Cafe",
    area: "Miami",
    niche: "coffee shop",
    websiteStatus: "weak_website",
    contactChannel: "instagram",
    contactValue: "@nositecafe",
    evidence: "Updated public evidence confirms no booking CTA and only Instagram ordering.",
    painPoint: "Needs booking, catering capture and follow-up.",
    estimatedOfferUsd: 3500,
    status: "research",
  });
  const snapshot = getRevenueEngineSnapshot();

  assert.equal(first.deduped, false);
  assert.equal(second.deduped, true);
  assert.equal(first.lead.id, second.lead.id);
  assert.equal(second.lead.estimatedOfferUsd, 3500);
  assert.equal(snapshot.recentLeads.length, 1);
  assert.equal(snapshot.pipelineStages.some((stage) => stage.id === "mockup" && stage.count === 1 && stage.valueUsd === 3500), true);
});

test("deduplicated revenue leads do not regress advanced pipeline status", () => {
  const leadResult = recordRevenueLead({
    businessName: "Advanced Cafe",
    area: "Miami",
    niche: "coffee shop",
    websiteStatus: "no_website",
    contactChannel: "email",
    contactValue: "owner@advanced.example",
    evidence: "Google listing has no website and Instagram bio only points to posts.",
    painPoint: "Needs online menu, catering capture and follow-up.",
    estimatedOfferUsd: 4200,
    status: "research",
  });

  recordRevenueOutreachDraft({
    leadId: leadResult.lead.id,
    channel: "gmail",
    approvalStatus: "draft",
    recipientEmail: "owner@advanced.example",
    contactName: "Owner",
    businessName: "Advanced Cafe",
    sourceUrl: "https://example.com/advanced-cafe",
    businessSummary: "Advanced Cafe has public evidence of weak/no website and needs online menu, catering capture and follow-up.",
    websitePriceUsd: 2700,
    automationPriceUsd: 1500,
    monthlyRetainerUsd: 750,
    estimatedInternalMonthlyCostUsd: 54,
    notes: "Draft created first.",
  });

  const duplicate = recordRevenueLead({
    businessName: "Advanced Cafe",
    area: "Miami",
    niche: "coffee shop",
    websiteStatus: "unknown",
    contactChannel: "email",
    contactValue: "owner@advanced.example",
    evidence: "",
    painPoint: "",
    estimatedOfferUsd: 1500,
    status: "research",
  });

  assert.equal(duplicate.deduped, true);
  assert.equal(duplicate.lead.status, "outreach_ready");
  assert.equal(duplicate.lead.estimatedOfferUsd, 4200);
});

test("deduplicated disqualified update cannot remove proposal leads from pipeline", () => {
  recordRevenueLead({
    businessName: "Proposal Cafe",
    area: "Miami",
    niche: "coffee shop",
    websiteStatus: "no_website",
    contactChannel: "email",
    contactValue: "owner@proposal.example",
    evidence: "Google listing has no website and catering menu only appears in Instagram posts.",
    painPoint: "Needs online menu, catering capture and follow-up.",
    estimatedOfferUsd: 4200,
    status: "proposal_sent",
  });

  const duplicate = recordRevenueLead({
    businessName: "Proposal Cafe",
    area: "Miami",
    niche: "coffee shop",
    websiteStatus: "unknown",
    contactChannel: "email",
    contactValue: "owner@proposal.example",
    evidence: "",
    painPoint: "",
    estimatedOfferUsd: 1500,
    status: "disqualified",
  });

  assert.equal(duplicate.deduped, true);
  assert.equal(duplicate.lead.status, "proposal_sent");
});

test("persists leads across module state reloads", () => {
  recordRevenueLead({
    businessName: "Persisted Lead",
    area: "Miami",
    niche: "salon",
    websiteStatus: "weak_website",
    contactChannel: "email",
    contactValue: "hello@example.com",
    evidence: "Website loads slowly and has no booking CTA.",
    painPoint: "Needs booking follow-up.",
    estimatedOfferUsd: 3500,
    status: "research",
  });

  setRevenueLeadsPathForTests(testLeadsPath);
  const snapshot = getRevenueEngineSnapshot();

  assert.equal(snapshot.recentLeads[0].businessName, "Persisted Lead");
  assert.equal(snapshot.pipelineStages.some((stage) => stage.id === "mockup" && stage.count === 1), true);
});

test("builds a sellable mockup with 3D brief and automation guardrails", () => {
  const mockup = buildRevenueMockup({
    businessName: "No Site Cafe",
    area: "Miami",
    niche: "coffee shop",
    websiteStatus: "no_website",
    evidence: "Instagram active weekly, no website in bio, menu only in posts.",
    painPoint: "Needs online menu, events capture and catering leads.",
    primaryOffer: "Website 3D Premium + Automation Sprint",
    estimatedOfferUsd: 3500,
    includeAutomation: true,
  });

  assert.equal(mockup.decision.status, "mockup_ready");
  assert.equal(mockup.offer.insideCostCap, true);
  assert.equal(mockup.visualSystem.threeDSceneBrief.length > 0, true);
  assert.equal(mockup.sections.some((section) => section.id === "automation"), true);
  assert.equal(mockup.qa.some((check) => check.agent === "closer" && check.result === "approval_required"), true);
});

test("writes a local revenue mockup preview without publishing externally", () => {
  const preview = buildRevenueMockupPreview({
    businessName: "No Site Cafe",
    area: "Miami",
    niche: "coffee shop",
    websiteStatus: "no_website",
    evidence: "Instagram active weekly, no website in bio, menu only in posts.",
    painPoint: "Needs online menu, events capture and catering leads.",
    primaryOffer: "Website 3D Premium + Automation Sprint",
    estimatedOfferUsd: 3500,
    includeAutomation: true,
  });

  assert.equal(preview.status, "mockup_ready");
  assert.equal(preview.fileWritten, true);
  assert.match(preview.previewUrl, /^\/api\/revenue-engine\/mockup-previews\//);
  assert.equal("previewPath" in preview, false);
  const previewPath = getRevenueMockupPreviewPath(preview.slug);
  assert.equal(existsSync(previewPath), true);
  const html = readFileSync(previewPath, "utf8");
  assert.match(html, /No Site Cafe/);
  assert.match(html, /QA gates before contact/);
  assert.equal(preview.guardrails.some((item) => item.includes("No requiere hosting pagado")), true);
});

test("builds production plan only when commercial and cost gates pass", () => {
  const plan = buildRevenueProjectPlan({
    clientName: "No Site Cafe",
    projectType: "bundle",
    packageName: "Website 3D Premium + Automation Sprint",
    setupUsd: 4725,
    monthlyRetainerUsd: 750,
    estimatedInternalCostUsd: 54,
    depositPaid: true,
    scopeApproved: true,
    publicDataVerified: true,
    includesAutomation: true,
    launchTargetDays: 7,
    clientRequest: "Website and lead follow-up",
  });

  assert.equal(plan.decision.status, "ready_to_build");
  assert.equal(plan.budget.insideCostCap, true);
  assert.equal(plan.phases.some((phase) => phase.ownerAgent === "qa-council"), true);
  assert.equal(plan.subagentCorrections.some((item) => item.agent === "cost-controller"), true);
});

test("records outreach draft without sending and moves matching lead to outreach", () => {
  const leadResult = recordRevenueLead({
    businessName: "Black Room",
    area: "Miami",
    niche: "techno events",
    websiteStatus: "weak_website",
    contactChannel: "email",
    contactValue: "info@blackroom.miami",
    evidence: "Website has events, videos, shop and community content.",
    painPoint: "Needs stronger conversion tracking and follow-up.",
    estimatedOfferUsd: 6700,
    status: "research",
  });

  const result = recordRevenueOutreachDraft({
    leadId: leadResult.lead.id,
    channel: "gmail",
    approvalStatus: "draft",
    recipientEmail: "robert.manzanillag@gmail.com",
    contactName: "Robert",
    businessName: "Black Room",
    sourceUrl: "https://blackroomus.com",
    businessSummary: "Black Room is a Miami Techno community with events, videos, shop, residents, academy and newsletter.",
    websitePriceUsd: 4500,
    automationPriceUsd: 2200,
    monthlyRetainerUsd: 750,
    estimatedInternalMonthlyCostUsd: 54,
    notes: "Test quote",
  });

  assert.equal(result.draft.status, "draft");
  assert.equal(result.draft.delivery.sendStatus, "not_sent");
  assert.equal(result.draft.qaGates.some((gate) => gate.gate === "approval" && gate.passed === false), true);
  assert.equal(result.syncedLead?.status, "outreach_ready");
  assert.equal(result.snapshot.recentOutreach[0].businessName, "Black Room");
  assert.equal(result.snapshot.metrics.approvalQueue, 1);
  assert.equal(result.snapshot.approvalQueueItems.some((item) => item.source === "outbox" && item.title === "Black Room"), true);
});

test("snapshot builds a capped manual outreach queue from approved drafts", () => {
  for (let index = 1; index <= 12; index += 1) {
    recordRevenueOutreachDraft({
      channel: "gmail",
      approvalStatus: "approved",
      recipientEmail: `owner${index}@queuecafe.example`,
      contactName: "Owner",
      businessName: `Queue Cafe ${index}`,
      sourceUrl: `https://example.com/queue-cafe-${index}`,
      businessSummary: `Queue Cafe ${index} has public evidence of no dedicated website, recent menu/service activity, and a verified contact path for a premium website pitch.`,
      websitePriceUsd: 2500 + index * 100,
      automationPriceUsd: 1000,
      monthlyRetainerUsd: 750,
      estimatedInternalMonthlyCostUsd: 54,
    });
  }
  recordRevenueOutreachDraft({
    channel: "gmail",
    approvalStatus: "draft",
    recipientEmail: "owner@needsapproval.example",
    contactName: "Owner",
    businessName: "Needs Approval Cafe",
    sourceUrl: "https://example.com/needs-approval",
    businessSummary: "Needs Approval Cafe has public evidence of no dedicated website, recent menu activity, and a verified contact path.",
    websitePriceUsd: 3000,
    automationPriceUsd: 1000,
    monthlyRetainerUsd: 750,
    estimatedInternalMonthlyCostUsd: 54,
  });

  const queue = getRevenueEngineSnapshot().manualOutreachQueue;

  assert.equal(queue.status, "ready");
  assert.equal(queue.dailyContactLimit, 10);
  assert.equal(queue.readyCount, 10);
  assert.equal(queue.overflowCount, 2);
  assert.equal(queue.blockedCount, 3);
  assert.equal(queue.safety.sendsOutreach, false);
  assert.equal(queue.safety.requiresHumanApproval, true);
  assert.equal(queue.items.every((item) => item.contactUrl.includes("mail.google.com")), true);
  assert.equal(queue.items.every((item) => item.nextAction.includes("registrar reply")), true);
  assert.equal(queue.blocked.some((item) => item.businessName === "Needs Approval Cafe" && item.reason.includes("Robert")), true);
  assert.equal(queue.blocked.filter((item) => item.reason.includes("Daily contact limit reached")).length, 2);
});

test("manual outreach queue uses public source URLs for non-email channels and caps blocked details", () => {
  recordRevenueOutreachDraft({
    channel: "instagram",
    approvalStatus: "approved",
    recipientEmail: "owner@instaqueuellc.example",
    contactName: "Owner",
    businessName: "Insta Queue Studio",
    sourceUrl: "https://instagram.com/instaqueuestudio",
    businessSummary: "Insta Queue Studio has public evidence of no dedicated website, recent service content, and Instagram as its visible contact path.",
    websitePriceUsd: 3000,
    automationPriceUsd: 1000,
    monthlyRetainerUsd: 750,
    estimatedInternalMonthlyCostUsd: 54,
  });
  recordRevenueOutreachDraft({
    channel: "contact_form",
    approvalStatus: "approved",
    recipientEmail: "owner@formqueue.example",
    contactName: "Owner",
    businessName: "Form Queue Studio",
    sourceUrl: "https://example.com/form-queue/contact",
    businessSummary: "Form Queue Studio has public evidence of a weak website, visible contact form, and a clear booking follow-up opportunity.",
    websitePriceUsd: 3000,
    automationPriceUsd: 1000,
    monthlyRetainerUsd: 750,
    estimatedInternalMonthlyCostUsd: 54,
  });
  for (let index = 1; index <= 12; index += 1) {
    recordRevenueOutreachDraft({
      channel: "gmail",
      approvalStatus: "draft",
      recipientEmail: `owner${index}@blockedqueue.example`,
      contactName: "Owner",
      businessName: `Blocked Queue ${index}`,
      sourceUrl: `https://example.com/blocked-queue-${index}`,
      businessSummary: `Blocked Queue ${index} has public evidence but still needs Robert approval before any manual contact.`,
      websitePriceUsd: 3000,
      automationPriceUsd: 1000,
      monthlyRetainerUsd: 750,
      estimatedInternalMonthlyCostUsd: 54,
    });
  }
  recordRevenueOutreachDraft({
    channel: "contact_form",
    approvalStatus: "approved",
    recipientEmail: "owner@mockuponly.example",
    contactName: "Owner",
    businessName: "Mockup Only Form",
    mockupUrl: "https://example.com/mockup-only-preview",
    businessSummary: "Mockup Only Form has a preview but still needs the public contact form URL before manual contact.",
    websitePriceUsd: 3000,
    automationPriceUsd: 1000,
    monthlyRetainerUsd: 750,
    estimatedInternalMonthlyCostUsd: 54,
  });

  const queue = getRevenueEngineSnapshot().manualOutreachQueue;
  const instagramItem = queue.items.find((item) => item.businessName === "Insta Queue Studio")!;
  const contactFormItem = queue.items.find((item) => item.businessName === "Form Queue Studio")!;

  assert.equal(instagramItem.contactUrl, "https://instagram.com/instaqueuestudio");
  assert.equal(instagramItem.fallbackUrl.startsWith("mailto:"), true);
  assert.equal(contactFormItem.contactUrl, "https://example.com/form-queue/contact");
  assert.equal(contactFormItem.fallbackUrl.startsWith("mailto:"), true);
  assert.equal(queue.items.some((item) => item.businessName === "Mockup Only Form"), false);
  assert.equal(queue.blockedCount, 13);
  assert.equal(queue.blocked.length, 10);
  assert.equal(queue.blocked.some((item) => item.businessName === "Mockup Only Form" && item.reason.includes("sourceUrl")), true);
});

test("sales autopilot prepares lead mockup agent QA and draft without sending", () => {
  const result = recordRevenueSalesAutopilot({
    businessName: "Autopilot Cafe",
    area: "Miami",
    niche: "coffee shop",
    websiteStatus: "no_website",
    contactChannel: "email",
    contactValue: "owner@example.com",
    evidence: "Google listing has no website, Instagram bio has no link, menu only appears in posts.",
    painPoint: "Needs online menu, catering lead capture and follow-up.",
    request: "Create a 3D website with lead capture, catering inquiry follow-up and weekly owner dashboard.",
    projectType: "bundle",
    estimatedOfferUsd: 4200,
    estimatedInternalCostUsd: 54,
    monthlyBudgetUsd: 100,
    cashCollectedUsd: 0,
    recipientEmail: "owner@example.com",
    contactName: "Owner",
    sourceUrl: "https://example.com/listing",
    businessSummary: "Autopilot Cafe has public evidence of no website and needs a stronger online menu, catering capture and follow-up system.",
    monthlyRetainerUsd: 750,
    approvalToContact: false,
    approvalToSpend: false,
    approvalToBuild: false,
  });

  assert.equal(result.status, "approval_required");
  assert.equal(result.lead.status, "outreach_ready");
  assert.equal(result.mockup.decision.status, "mockup_ready");
  assert.equal(result.agentRun.status, "approval_required");
  assert.equal(result.deliveryReview.status, "blocked");
  assert.equal(result.outreachDraft?.status, "draft");
  assert.equal(result.requiredBeforeExternalAction.includes("aprobar contacto externo"), true);
  assert.equal(result.snapshot.recentOutreach[0].delivery.sendStatus, "not_sent");
  assert.equal(result.snapshot.approvalQueueItems.some((item) => item.source === "agent_run" && item.title === "Autopilot Cafe"), true);
  assert.equal(result.snapshot.approvalQueueItems.some((item) => item.source === "outbox" && item.title === "Autopilot Cafe"), true);
});

test("money sprint creates scout queue previews leads and draft-only outreach", () => {
  const result = runRevenueMoneySprint({
    area: "Miami",
    niche: "coffee shop",
    offerFocus: "both",
    dailyResearchTarget: 30,
    dailyQualifiedLeadLimit: 10,
    dailyMockupLimit: 3,
    dailyContactLimit: 5,
    maxPaidDataSpendUsd: 0,
    requireRobertApprovalToContact: true,
    writePreviewFiles: true,
    seedLeads: [
      {
        businessName: "Sprint Cafe",
        area: "Miami",
        niche: "coffee shop",
        websiteStatus: "no_website",
        contactChannel: "email",
        contactValue: "owner@sprintcafe.example",
        evidence: "Google listing has no website, Instagram bio has no link, menu only appears in posts.",
        painPoint: "Needs online menu, catering inquiry capture and follow-up.",
        estimatedOfferUsd: 4200,
        status: "research",
        sourceUrl: "https://example.com/sprint-cafe-listing",
        recipientEmail: "owner@sprintcafe.example",
        contactName: "Owner",
        businessSummary: "Sprint Cafe has public evidence of no website and needs a stronger online menu, catering capture and follow-up system.",
      },
    ],
  });

  assert.equal(result.status, "ready_to_start");
  assert.equal(result.scoutQueue.length > 0, true);
  assert.equal(result.operatingLimits.maxPaidDataSpendUsd, 0);
  assert.equal(result.recordedLeads.length, 1);
  assert.equal(result.recordedLeads[0].qualification.grade, "A");
  assert.equal(result.previews.length, 1);
  assert.equal("previewPath" in result.previews[0], false);
  assert.equal(existsSync(getRevenueMockupPreviewPath(result.previews[0].slug)), true);
  assert.equal(result.outreachDrafts.length, 1);
  assert.equal(result.outreachDrafts[0].status, "draft");
  assert.equal(result.outreachDrafts[0].mockupUrl, result.previews[0].previewUrl);
  assert.equal(result.outreachDrafts[0].delivery.sendStatus, "not_sent");
  assert.equal(result.approvalGates.some((gate) => gate.includes("No outbound email")), true);
  assert.equal(result.snapshot.recentLeads[0].businessName, "Sprint Cafe");
  assert.equal(result.snapshot.websiteDeliveryHandoffQueue.readyCount, 1);
  assert.equal(result.snapshot.websiteDeliveryHandoffQueue.items[0].leadId, result.recordedLeads[0].lead.id);
  assert.equal(result.snapshot.websiteDeliveryHandoffQueue.items[0].outreachDraftId, result.outreachDrafts[0].id);
  assert.equal(result.snapshot.websiteDeliveryHandoffQueue.items[0].mockupUrl, result.previews[0].previewUrl);
});

test("website delivery handoff queue does not hide older ready leads behind newer blocked leads", async () => {
  const readyLead = recordRevenueLead({
    businessName: "Older Ready Cafe",
    area: "Miami",
    niche: "coffee shop",
    websiteStatus: "no_website",
    contactChannel: "email",
    contactValue: "owner@olderready.example",
    evidence: "Public listing has no website, recent menu photos and verified owner email.",
    painPoint: "Needs menu capture and catering inquiry follow-up.",
    estimatedOfferUsd: 4200,
    status: "qualified",
  });
  const readyDraft = recordRevenueOutreachDraft({
    leadId: readyLead.lead.id,
    channel: "gmail",
    approvalStatus: "draft",
    recipientEmail: "owner@olderready.example",
    contactName: "Owner",
    businessName: "Older Ready Cafe",
    sourceUrl: "https://example.com/older-ready-cafe",
    mockupUrl: "/api/revenue-engine/mockup-previews/older-ready-cafe",
    businessSummary: "Older Ready Cafe has public evidence of no website and a clear need for menu capture.",
    websitePriceUsd: 3200,
    automationPriceUsd: 1000,
    monthlyRetainerUsd: 750,
    estimatedInternalMonthlyCostUsd: 54,
    notes: "Draft only; no outreach sent.",
  });

  await new Promise((resolve) => setTimeout(resolve, 2));

  for (let index = 0; index < 9; index += 1) {
    recordRevenueLead({
      businessName: `Newer Blocked Cafe ${index + 1}`,
      area: "Miami",
      niche: "coffee shop",
      websiteStatus: "no_website",
      contactChannel: "email",
      contactValue: `owner${index + 1}@blocked.example`,
      evidence: "Public listing has no website, recent menu photos and verified owner contact.",
      painPoint: "Needs online menu.",
      estimatedOfferUsd: 3000,
      status: "qualified",
    });
  }

  const snapshot = getRevenueEngineSnapshot();

  assert.equal(snapshot.websiteDeliveryHandoffQueue.readyCount, 1);
  assert.equal(snapshot.websiteDeliveryHandoffQueue.blockedCount, 9);
  assert.equal(snapshot.websiteDeliveryHandoffQueue.items.length, 1);
  assert.equal(snapshot.websiteDeliveryHandoffQueue.items[0].leadId, readyLead.lead.id);
  assert.equal(snapshot.websiteDeliveryHandoffQueue.items[0].outreachDraftId, readyDraft.draft.id);
});

test("creates website delivery workspace from money sprint lead mockup and outreach context", () => {
  const sprint = runRevenueMoneySprint({
    area: "Miami",
    niche: "coffee shop",
    offerFocus: "both",
    dailyResearchTarget: 30,
    dailyQualifiedLeadLimit: 10,
    dailyMockupLimit: 3,
    dailyContactLimit: 5,
    maxPaidDataSpendUsd: 0,
    requireRobertApprovalToContact: true,
    writePreviewFiles: true,
    seedLeads: [
      {
        businessName: "Handoff Cafe",
        area: "Miami",
        niche: "coffee shop",
        websiteStatus: "no_website",
        contactChannel: "email",
        contactValue: "owner@handoffcafe.example",
        evidence: "Google listing has no website, public social profile has menu photos and a verified owner email.",
        painPoint: "Needs online menu, catering inquiry capture and follow-up.",
        estimatedOfferUsd: 4200,
        status: "research",
        sourceUrl: "https://example.com/handoff-cafe-listing",
        recipientEmail: "owner@handoffcafe.example",
        contactName: "Owner",
        businessSummary: "Handoff Cafe has no dedicated website and needs a stronger online menu, catering capture and follow-up system.",
      },
    ],
  });
  const lead = sprint.recordedLeads[0].lead;
  const draft = sprint.outreachDrafts[0];
  const preview = sprint.previews[0];

  const handoff = createWebsiteDeliveryWorkspaceFromLead({
    leadId: lead.id,
    outreachDraftId: draft.id,
    mockupUrl: preview.previewUrl,
    projectType: "bundle",
    depositPaid: true,
    scopeApproved: true,
    cashCollectedUsd: 2100,
    publicDataVerified: true,
    visualQaPassed: false,
    technicalQaPassed: false,
    automationQaPassed: false,
    clientHandoffReady: false,
    notes: "Client said yes to a controlled build after seeing the mockup.",
  });

  assert.equal(handoff.status, "created");
  assert.equal(handoff.workspace?.input.sourceLeadId, lead.id);
  assert.equal(handoff.workspace?.input.sourceOutreachDraftId, draft.id);
  assert.equal(handoff.workspace?.input.mockupUrl, preview.previewUrl);
  assert.equal(handoff.workspace?.input.clientRequest.includes("Mockup preview:"), true);
  assert.equal(handoff.workspace?.input.clientRequest.includes("Codex build rule"), true);
  assert.equal(handoff.workspace?.projectPlan.decision.status, "ready_to_build");
  assert.equal(handoff.workspace?.correctionQueue.some((item) => item.agent === "automation-qa"), true);
  assert.equal(handoff.outreachDraft?.delivery.sendStatus, "not_sent");
  assert.equal(handoff.snapshot.recentLeads[0].status, "closed");
  assert.equal(handoff.snapshot.recentDeliveryWorkspaces[0].input.sourceLeadId, lead.id);
  assert.equal(handoff.snapshot.websiteDeliveryHandoffQueue.items.some((item) => item.leadId === lead.id), false);
});

test("blocks website delivery handoff when outreach draft belongs to another lead", () => {
  const leadA = recordRevenueLead({
    businessName: "Lead A Cafe",
    area: "Miami",
    niche: "coffee shop",
    websiteStatus: "no_website",
    contactChannel: "email",
    contactValue: "owner@leada.example",
    evidence: "Public listing has no website, active menu photos and verified owner contact.",
    painPoint: "Needs menu capture.",
    estimatedOfferUsd: 3600,
    status: "qualified",
  });
  const leadB = recordRevenueLead({
    businessName: "Lead B Salon",
    area: "Miami",
    niche: "salon",
    websiteStatus: "weak_website",
    contactChannel: "email",
    contactValue: "owner@leadb.example",
    evidence: "Public website has no booking flow, weak service pages and verified owner contact.",
    painPoint: "Needs booking capture.",
    estimatedOfferUsd: 4200,
    status: "qualified",
  });
  const draftB = recordRevenueOutreachDraft({
    leadId: leadB.lead.id,
    channel: "email",
    approvalStatus: "draft",
    recipientEmail: "owner@leadb.example",
    contactName: "Owner",
    businessName: "Lead B Salon",
    sourceUrl: "https://example.com/lead-b",
    businessSummary: "Lead B Salon has public evidence of a weak website and needs booking capture plus follow-up.",
    websitePriceUsd: 3000,
    automationPriceUsd: 1200,
    monthlyRetainerUsd: 750,
    estimatedInternalMonthlyCostUsd: 54,
  });

  const handoff = createWebsiteDeliveryWorkspaceFromLead({
    leadId: leadA.lead.id,
    outreachDraftId: draftB.draft.id,
    projectType: "bundle",
    depositPaid: true,
    scopeApproved: true,
    cashCollectedUsd: 2100,
    publicDataVerified: true,
  });

  assert.equal(handoff.status, "blocked");
  assert.equal(handoff.reason.includes("no pertenece"), true);
  assert.equal(handoff.workspace, null);
  assert.equal(handoff.snapshot.recentLeads.find((lead) => lead.id === leadA.lead.id)?.status, "qualified");
});

test("website delivery handoff keeps data gate explicit before build readiness", () => {
  const lead = recordRevenueLead({
    businessName: "Explicit Data Cafe",
    area: "Miami",
    niche: "coffee shop",
    websiteStatus: "no_website",
    contactChannel: "email",
    contactValue: "owner@explicitdata.example",
    evidence: "Public listing has no website, active menu photos and verified owner contact.",
    painPoint: "Needs online menu capture.",
    estimatedOfferUsd: 3800,
    status: "qualified",
  });

  const handoff = createWebsiteDeliveryWorkspaceFromLead({
    leadId: lead.lead.id,
    projectType: "website",
    depositPaid: true,
    scopeApproved: true,
    cashCollectedUsd: 1900,
    publicDataVerified: false,
  });

  assert.equal(handoff.status, "created");
  assert.equal(handoff.workspace?.projectPlan.decision.status, "needs_scope");
  assert.equal(handoff.workspace?.projectPlan.decision.missing.includes("data publica verificada"), true);
  assert.equal(handoff.workspace?.input.publicDataVerified, false);
});

test("money sprint parses pasted lead batches with partial failures", () => {
  const result = runRevenueMoneySprint({
    area: "Miami",
    niche: "restaurant",
    offerFocus: "websites",
    dailyResearchTarget: 30,
    dailyQualifiedLeadLimit: 10,
    dailyMockupLimit: 2,
    dailyContactLimit: 5,
    maxPaidDataSpendUsd: 0,
    requireRobertApprovalToContact: true,
    writePreviewFiles: false,
    seedLeadBatchText: [
      "business|area|niche|website|channel|contact|sourceUrl|recipientEmail|evidence|painPoint|offer|contactName|summary",
      "Batch Bistro|Miami|restaurant|no_website|email|owner@batchbistro.example|https://example.com/batch-bistro|owner@batchbistro.example|Google listing has no website and recent menu photos are only on public social profiles.|Needs menu, catering inquiry capture and follow-up.|3500|Owner|Batch Bistro has no dedicated website and a clear catering/menu opportunity.",
      "Bad Row|Miami|restaurant|no_website|email|owner@badrow.example|notaurl|owner@badrow.example|short|Needs website.|2500|Owner|",
    ].join("\n"),
  });

  assert.equal(result.status, "ready_to_start");
  assert.equal(result.recordedLeads.length, 1);
  assert.equal(result.recordedLeads[0].lead.businessName, "Batch Bistro");
  assert.equal(result.previews.length, 1);
  assert.equal(result.previews[0].fileWritten, false);
  assert.equal(existsSync(getRevenueMockupPreviewPath(result.previews[0].slug)), false);
  assert.equal(result.outreachDrafts.length, 1);
  assert.equal(result.outreachDrafts[0].status, "draft");
  assert.equal(result.outreachDrafts[0].delivery.sendStatus, "not_sent");
  assert.equal(result.blockedSeeds.length, 1);
  assert.equal(result.blockedSeeds[0].businessName, "Bad Row");
});

test("money sprint parses quoted CSV batches with pipes inside evidence", () => {
  const result = runRevenueMoneySprint({
    area: "Miami",
    niche: "salon",
    offerFocus: "websites",
    dailyResearchTarget: 30,
    dailyQualifiedLeadLimit: 10,
    dailyMockupLimit: 2,
    dailyContactLimit: 5,
    maxPaidDataSpendUsd: 0,
    requireRobertApprovalToContact: true,
    writePreviewFiles: false,
    seedLeadBatchText: [
      "business,area,niche,website,channel,contact,sourceUrl,recipientEmail,evidence,painPoint,offer",
      "\"CSV Salon\",\"Miami\",\"salon\",\"no_website\",\"email\",\"owner@csvsalon.example\",\"https://example.com/csv-salon\",\"owner@csvsalon.example\",\"Google listing has no website | Instagram profile has recent service photos and contact path.\",\"Needs booking capture and follow-up.\",\"3200\"",
    ].join("\n"),
  });

  assert.equal(result.recordedLeads.length, 1);
  assert.equal(result.recordedLeads[0].lead.businessName, "CSV Salon");
  assert.equal(result.recordedLeads[0].lead.evidence.includes("| Instagram"), true);
  assert.equal(result.outreachDrafts.length, 1);
  assert.equal(result.blockedSeeds.length, 0);
});

test("money sprint preview parses batch without persisting leads drafts or previews", () => {
  const result = previewRevenueMoneySprintSeeds({
    area: "Miami",
    niche: "salon",
    offerFocus: "websites",
    dailyResearchTarget: 30,
    dailyQualifiedLeadLimit: 10,
    dailyMockupLimit: 2,
    dailyContactLimit: 5,
    maxPaidDataSpendUsd: 0,
    requireRobertApprovalToContact: true,
    writePreviewFiles: true,
    seedLeadBatchText: [
      "business,area,niche,website,channel,contact,sourceUrl,recipientEmail,evidence,painPoint,offer",
      "\"Preview Salon\",\"Miami\",\"salon\",\"no_website\",\"email\",\"owner@previewsalon.example\",\"https://example.com/preview-salon\",\"owner@previewsalon.example\",\"Public profile has no website, recent service photos and a verified contact path.\",\"Needs online booking capture and follow-up.\",\"3200\"",
      "\"Weak Row\",\"Miami\",\"salon\",\"unknown\",\"unknown\",\"\",\"\",\"\",\"short\",\"Needs review.\",\"1000\"",
    ].join("\n"),
  });
  const snapshot = getRevenueEngineSnapshot();

  assert.equal(result.status, "ready_to_import");
  assert.equal(result.totals.accepted, 2);
  assert.equal(result.totals.mockupReady, 1);
  assert.equal(result.totals.draftReady, 1);
  assert.equal(result.acceptedSeeds[0].businessName, "Preview Salon");
  assert.equal(result.acceptedSeeds[0].draftReady, true);
  assert.equal(result.acceptedSeeds[1].draftReady, false);
  assert.equal(result.safety.persistsData, false);
  assert.equal(result.safety.writesPreviewFiles, false);
  assert.equal(result.safety.sendsOutreach, false);
  assert.equal(snapshot.recentLeads.length, 0);
  assert.equal(snapshot.recentOutreach.length, 0);
});

test("money sprint preview respects daily mockup limit", () => {
  const row = (index: number) => [
    `Limit Cafe ${index}`,
    "Miami",
    "coffee shop",
    "no_website",
    "email",
    `owner${index}@limitcafe.example`,
    `https://example.com/limit-cafe-${index}`,
    `owner${index}@limitcafe.example`,
    "Google listing has no website, public social profile has products and verified contact path.",
    "Needs online menu capture and follow-up.",
    "3200",
  ].join("|");
  const result = previewRevenueMoneySprintSeeds({
    area: "Miami",
    niche: "coffee shop",
    offerFocus: "websites",
    dailyResearchTarget: 30,
    dailyQualifiedLeadLimit: 10,
    dailyMockupLimit: 1,
    dailyContactLimit: 5,
    maxPaidDataSpendUsd: 0,
    requireRobertApprovalToContact: true,
    writePreviewFiles: true,
    seedLeadBatchText: [
      "business|area|niche|website|channel|contact|sourceUrl|recipientEmail|evidence|painPoint|offer",
      row(1),
      row(2),
      row(3),
    ].join("\n"),
  });

  assert.equal(result.totals.accepted, 3);
  assert.equal(result.totals.mockupReady, 1);
  assert.deepEqual(result.acceptedSeeds.map((seed) => seed.mockupReady), [true, false, false]);
});

test("money sprint preview requires approval before paid data spend", () => {
  const result = previewRevenueMoneySprintSeeds({
    area: "Orlando",
    niche: "roofers",
    offerFocus: "websites",
    dailyResearchTarget: 30,
    dailyQualifiedLeadLimit: 10,
    dailyMockupLimit: 3,
    dailyContactLimit: 5,
    maxPaidDataSpendUsd: 250,
    requireRobertApprovalToContact: true,
    writePreviewFiles: true,
    seedLeadBatchText: [
      "business|area|niche|website|channel|contact|sourceUrl|recipientEmail|evidence|painPoint|offer",
      [
        "Approval Roof Co",
        "Orlando",
        "roofers",
        "no_website",
        "email",
        "owner@approvalroof.example",
        "https://example.com/approval-roof",
        "owner@approvalroof.example",
        "Google listing has no website, public profile has verified service photos and contact path.",
        "Needs storm repair lead capture and follow-up.",
        "4200",
      ].join("|"),
    ].join("\n"),
  });

  assert.equal(result.status, "needs_spend_approval");
  assert.equal(result.totals.mockupReady, 1);
  assert.equal(result.safety.persistsData, false);
  assert.equal(result.safety.writesPreviewFiles, false);
  assert.equal(result.safety.sendsOutreach, false);
  assert.match(result.safety.nextAction, /approval/i);
});

test("money sprint caps pasted lead batch at remaining seed lead slots", () => {
  const row = (index: number) => [
    `Batch Cafe ${index}`,
    "Miami",
    "coffee shop",
    "no_website",
    "email",
    `owner${index}@batchcafe.example`,
    `https://example.com/batch-cafe-${index}`,
    `owner${index}@batchcafe.example`,
    "Google listing has no website, public profile has recent products and contact path.",
    "Needs online ordering inquiry capture and follow-up.",
    "3000",
  ].join("|");
  const result = runRevenueMoneySprint({
    area: "Miami",
    niche: "coffee shop",
    offerFocus: "both",
    dailyResearchTarget: 30,
    dailyQualifiedLeadLimit: 25,
    dailyMockupLimit: 25,
    dailyContactLimit: 10,
    maxPaidDataSpendUsd: 0,
    requireRobertApprovalToContact: true,
    writePreviewFiles: false,
    seedLeadBatchText: [
      "business|area|niche|website|channel|contact|sourceUrl|recipientEmail|evidence|painPoint|offer",
      ...Array.from({ length: 27 }, (_, index) => row(index + 1)),
    ].join("\n"),
  });

  assert.equal(result.recordedLeads.length, 25);
  assert.equal(result.blockedSeeds.filter((seed) => seed.reason === "batch limit 25").length, 2);
  assert.equal(result.outreachDrafts.every((draft) => draft.status === "draft" && draft.delivery.sendStatus === "not_sent"), true);
});

test("money sprint surfaces paid data approval amount without spending automatically", () => {
  const result = runRevenueMoneySprint({
    area: "Orlando",
    niche: "roofers",
    offerFocus: "websites",
    dailyResearchTarget: 30,
    dailyQualifiedLeadLimit: 10,
    dailyMockupLimit: 3,
    dailyContactLimit: 5,
    maxPaidDataSpendUsd: 250,
    requireRobertApprovalToContact: true,
    writePreviewFiles: false,
    seedLeads: [],
  });

  assert.equal(result.status, "needs_spend_approval");
  assert.equal(result.operatingLimits.maxPaidDataSpendUsd, 100);
  assert.equal(result.mission.budgetGate.requiresApprovalToSpend, true);
  assert.equal(result.previews.length, 0);
  assert.equal(result.outreachDrafts.length, 0);
});

test("sales autopilot blocks when internal cost breaks the starting cap", () => {
  const result = recordRevenueSalesAutopilot({
    businessName: "Expensive Automation",
    area: "Miami",
    niche: "clinic",
    websiteStatus: "weak_website",
    contactChannel: "email",
    contactValue: "owner@example.com",
    evidence: "Public website is slow and has no booking workflow or lead follow-up.",
    painPoint: "Needs booking, reminders and reporting.",
    request: "Build automation with many paid tools and live messaging before deposit.",
    projectType: "automation",
    estimatedOfferUsd: 2500,
    estimatedInternalCostUsd: 180,
    monthlyBudgetUsd: 100,
    cashCollectedUsd: 0,
    recipientEmail: "owner@example.com",
    businessSummary: "Expensive Automation has a weak website and needs booking automation.",
    approvalToContact: true,
    approvalToSpend: false,
    approvalToBuild: false,
  });

  assert.equal(result.status, "blocked");
  assert.equal(result.outreachDraft, null);
  assert.equal(result.requiredBeforeExternalAction.includes("reducir costo interno bajo $100/mes"), true);
  assert.equal(result.agentRun.status, "blocked");
});

test("blocks outreach draft when evidence or cost cap fails", () => {
  const result = recordRevenueOutreachDraft({
    channel: "gmail",
    approvalStatus: "approved",
    recipientEmail: "lead@example.com",
    contactName: "Lead",
    businessName: "Risky Outreach",
    businessSummary: "Too vague.",
    websitePriceUsd: 1500,
    automationPriceUsd: 1500,
    monthlyRetainerUsd: 150,
    estimatedInternalMonthlyCostUsd: 125,
    notes: "",
  });

  assert.equal(result.draft.status, "blocked");
  assert.equal(result.draft.pricing.insideCostCap, false);
  assert.equal(result.draft.qaGates.some((gate) => gate.gate === "evidence" && gate.passed === false), true);
  assert.equal(result.draft.qaGates.some((gate) => gate.gate === "cost" && gate.passed === false), true);
});

test("persists outreach drafts across module state reloads", () => {
  recordRevenueOutreachDraft({
    channel: "gmail",
    approvalStatus: "approved",
    recipientEmail: "client@example.com",
    contactName: "Client",
    businessName: "Persisted Outreach",
    sourceUrl: "https://example.com",
    businessSummary: "Persisted Outreach has a public site and needs better lead capture, follow-up and quote tracking.",
    websitePriceUsd: 3500,
    automationPriceUsd: 2500,
    monthlyRetainerUsd: 750,
    estimatedInternalMonthlyCostUsd: 54,
    notes: "",
  });

  setRevenueOutreachPathForTests(testOutreachPath);
  const snapshot = getRevenueEngineSnapshot();

  assert.equal(snapshot.recentOutreach[0].businessName, "Persisted Outreach");
  assert.equal(snapshot.recentOutreach[0].status, "approved");
});

test("blocks outreach send when email provider is missing", async () => {
  const result = recordRevenueOutreachDraft({
    channel: "gmail",
    approvalStatus: "approved",
    recipientEmail: "client@example.com",
    contactName: "Client",
    businessName: "Provider Missing Outreach",
    sourceUrl: "https://example.com",
    businessSummary: "Provider Missing Outreach has public data and a clear need for website conversion and follow-up.",
    websitePriceUsd: 3500,
    automationPriceUsd: 2500,
    monthlyRetainerUsd: 750,
    estimatedInternalMonthlyCostUsd: 54,
    notes: "",
  });

  const sendResult = await sendRevenueOutreachDraft({
    draftId: result.draft.id,
    approvalToSend: true,
  });

  assert.equal(sendResult.status, "blocked");
  assert.equal(sendResult.provider.configured, false);
  assert.equal(sendResult.draft?.delivery.sendStatus, "provider_missing");
  assert.equal(sendResult.gates.some((gate) => gate.gate === "provider_configured" && gate.passed === false), true);
});

test("blocks outreach send when email provider values are placeholders", async () => {
  process.env.RESEND_API_KEY = "replace-with-resend-api-key";
  process.env.REVENUE_ENGINE_FROM_EMAIL = "your-email@example.com";
  const result = recordRevenueOutreachDraft({
    channel: "gmail",
    approvalStatus: "approved",
    recipientEmail: "client@example.com",
    contactName: "Client",
    businessName: "Placeholder Provider Outreach",
    sourceUrl: "https://example.com",
    businessSummary: "Placeholder Provider Outreach has public data and a clear need for website conversion.",
    websitePriceUsd: 3500,
    automationPriceUsd: 2500,
    monthlyRetainerUsd: 750,
    estimatedInternalMonthlyCostUsd: 54,
    notes: "",
  });

  const sendResult = await sendRevenueOutreachDraft({
    draftId: result.draft.id,
    approvalToSend: true,
  });

  assert.equal(sendResult.status, "blocked");
  assert.equal(sendResult.provider.configured, false);
  assert.equal(sendResult.provider.missing.includes("RESEND_API_KEY"), true);
  assert.equal(sendResult.provider.missing.includes("REVENUE_ENGINE_FROM_EMAIL"), true);
  assert.equal(sendResult.draft?.delivery.sendStatus, "provider_missing");
});

test("blocks outreach send when approved draft is outside the daily manual queue", async () => {
  process.env.RESEND_API_KEY = "re_test";
  process.env.REVENUE_ENGINE_FROM_EMAIL = "Revenue Engine <sales@example.com>";
  for (let index = 1; index <= 11; index += 1) {
    recordRevenueOutreachDraft({
      channel: "email",
      approvalStatus: "approved",
      recipientEmail: `client${index}@dailycap.example`,
      contactName: "Client",
      businessName: `Daily Cap Outreach ${index}`,
      sourceUrl: `https://example.com/daily-cap-${index}`,
      businessSummary: `Daily Cap Outreach ${index} has public evidence and a clear need for website conversion and follow-up.`,
      websitePriceUsd: 3500,
      automationPriceUsd: 2500,
      monthlyRetainerUsd: 750,
      estimatedInternalMonthlyCostUsd: 54,
      notes: "",
    });
  }
  const overflowDraft = getRevenueEngineSnapshot().manualOutreachQueue.blocked.find((item) =>
    item.reason.includes("Daily contact limit reached")
  );
  assert.ok(overflowDraft);
  setRevenueOutreachSenderForTests(async () => {
    throw new Error("sender should not run for overflow draft");
  });

  const sendResult = await sendRevenueOutreachDraft({
    draftId: overflowDraft.draftId,
    approvalToSend: true,
  });

  assert.equal(sendResult.status, "blocked");
  assert.equal(sendResult.gates.some((gate) => gate.gate === "daily_contact_cap" && gate.passed === false), true);
  assert.equal(sendResult.reason?.includes("limite diario"), true);
  assert.equal(sendResult.draft?.delivery.sendStatus, "blocked");
});

test("enforces daily outreach cap after sequential provider sends", async () => {
  process.env.RESEND_API_KEY = "re_test";
  process.env.REVENUE_ENGINE_FROM_EMAIL = "Revenue Engine <sales@example.com>";
  for (let index = 1; index <= 11; index += 1) {
    recordRevenueOutreachDraft({
      channel: "email",
      approvalStatus: "approved",
      recipientEmail: `client${index}@sequentialcap.example`,
      contactName: "Client",
      businessName: `Sequential Cap Outreach ${index}`,
      sourceUrl: `https://example.com/sequential-cap-${index}`,
      businessSummary: `Sequential Cap Outreach ${index} has public evidence and a clear need for website conversion and follow-up.`,
      websitePriceUsd: 3500,
      automationPriceUsd: 2500,
      monthlyRetainerUsd: 750,
      estimatedInternalMonthlyCostUsd: 54,
      notes: "",
    });
  }

  let sendCount = 0;
  setRevenueOutreachSenderForTests(async () => {
    sendCount += 1;
    return { id: `email_sequential_${sendCount}` };
  });

  for (let index = 0; index < 10; index += 1) {
    const nextDraft = getRevenueEngineSnapshot().manualOutreachQueue.items[0];
    assert.ok(nextDraft);
    const sendResult = await sendRevenueOutreachDraft({
      draftId: nextDraft.draftId,
      approvalToSend: true,
    });
    assert.equal(sendResult.status, "sent");
  }

  const cappedQueue = getRevenueEngineSnapshot().manualOutreachQueue;
  assert.equal(sendCount, 10);
  assert.equal(cappedQueue.readyCount, 0);
  assert.equal(cappedQueue.blocked.some((item) => item.reason.includes("Daily contact limit already used")), true);
  const cappedDraft = cappedQueue.blocked.find((item) => item.reason.includes("Daily contact limit already used"));
  assert.ok(cappedDraft);

  const blockedSend = await sendRevenueOutreachDraft({
    draftId: cappedDraft.draftId,
    approvalToSend: true,
  });

  assert.equal(blockedSend.status, "blocked");
  assert.equal(blockedSend.gates.some((gate) => gate.gate === "daily_contact_cap" && gate.passed === false), true);
  assert.equal(sendCount, 10);
});

test("blocks provider send for manual-only outreach channels", async () => {
  process.env.RESEND_API_KEY = "re_test";
  process.env.REVENUE_ENGINE_FROM_EMAIL = "Revenue Engine <sales@example.com>";
  const result = recordRevenueOutreachDraft({
    channel: "contact_form",
    approvalStatus: "approved",
    recipientEmail: "owner@manualchannel.example",
    contactName: "Owner",
    businessName: "Manual Channel Outreach",
    sourceUrl: "https://example.com/manual-channel/contact",
    businessSummary: "Manual Channel Outreach has public form evidence and needs a website conversion follow-up.",
    websitePriceUsd: 3500,
    automationPriceUsd: 2500,
    monthlyRetainerUsd: 750,
    estimatedInternalMonthlyCostUsd: 54,
    notes: "",
  });
  setRevenueOutreachSenderForTests(async () => {
    throw new Error("sender should not run for manual-only channel");
  });

  const sendResult = await sendRevenueOutreachDraft({
    draftId: result.draft.id,
    approvalToSend: true,
  });

  assert.equal(sendResult.status, "blocked");
  assert.equal(sendResult.gates.some((gate) => gate.gate === "email_channel" && gate.passed === false), true);
  assert.equal(sendResult.reason?.includes("canal es manual"), true);
  assert.equal(sendResult.draft?.delivery.sendStatus, "blocked");
});

test("uses fallback Resend from email when Revenue Engine from email is a placeholder", async () => {
  process.env.RESEND_API_KEY = "re_test";
  process.env.REVENUE_ENGINE_FROM_EMAIL = "your-email@example.com";
  process.env.RESEND_FROM_EMAIL = "Revenue Engine <sales@example.com>";
  const result = recordRevenueOutreachDraft({
    channel: "email",
    approvalStatus: "approved",
    recipientEmail: "client@example.com",
    contactName: "Client",
    businessName: "Fallback Sender Outreach",
    sourceUrl: "https://example.com",
    businessSummary: "Fallback Sender Outreach has public data and a clear need for website conversion.",
    websitePriceUsd: 3500,
    automationPriceUsd: 2500,
    monthlyRetainerUsd: 750,
    estimatedInternalMonthlyCostUsd: 54,
    notes: "",
  });

  setRevenueOutreachSenderForTests(async (payload) => {
    assert.equal(payload.from, "Revenue Engine <sales@example.com>");
    return { id: "email_fallback_sender" };
  });

  const sendResult = await sendRevenueOutreachDraft({
    draftId: result.draft.id,
    approvalToSend: true,
  });

  assert.equal(sendResult.status, "sent");
  assert.equal(sendResult.provider.configured, true);
  assert.equal(sendResult.provider.fromEmail, "Revenue Engine <sales@example.com>");
});

test("sends approved outreach with configured provider and updates matching lead", async () => {
  process.env.RESEND_API_KEY = "re_test";
  process.env.REVENUE_ENGINE_FROM_EMAIL = "Revenue Engine <sales@example.com>";
  let capturedTo = "";
  setRevenueOutreachSenderForTests(async (payload) => {
    capturedTo = payload.to;
    assert.equal(payload.from, "Revenue Engine <sales@example.com>");
    assert.equal(payload.subject.includes("Ready Outreach"), true);
    assert.equal(payload.idempotencyKey.startsWith("outreach-"), true);
    return { id: "email_123" };
  });
  const leadResult = recordRevenueLead({
    businessName: "Ready Outreach",
    area: "Miami",
    niche: "fitness",
    websiteStatus: "weak_website",
    contactChannel: "email",
    contactValue: "client@example.com",
    evidence: "Public website has services but weak capture.",
    painPoint: "Needs automation follow-up.",
    estimatedOfferUsd: 6000,
    status: "qualified",
  });
  const result = recordRevenueOutreachDraft({
    leadId: leadResult.lead.id,
    channel: "email",
    approvalStatus: "approved",
    recipientEmail: "client@example.com",
    contactName: "Client",
    businessName: "Ready Outreach",
    sourceUrl: "https://example.com",
    businessSummary: "Ready Outreach has a weak website and needs better lead capture, service conversion and automated follow-up.",
    websitePriceUsd: 3500,
    automationPriceUsd: 2500,
    monthlyRetainerUsd: 750,
    estimatedInternalMonthlyCostUsd: 54,
    notes: "",
  });

  const sendResult = await sendRevenueOutreachDraft({
    draftId: result.draft.id,
    approvalToSend: true,
  });

  assert.equal(sendResult.status, "sent");
  assert.equal(capturedTo, "client@example.com");
  assert.equal(sendResult.draft.delivery.sendStatus, "sent");
  assert.equal(sendResult.draft.delivery.externalMessageId, "email_123");
  assert.equal(sendResult.snapshot.recentLeads[0].status, "proposal_sent");
});

test("runs main revenue agent with subagent reviews and approvals", () => {
  const result = recordRevenueAgentRun({
    businessName: "Black Room",
    area: "Miami",
    niche: "techno events",
    request: "Create a 3D website, event funnel, lead capture and automated follow-up for sponsors and merch buyers.",
    stage: "production",
    projectType: "bundle",
    estimatedOfferUsd: 6700,
    estimatedInternalCostUsd: 54,
    monthlyBudgetUsd: 100,
    cashCollectedUsd: 3350,
    approvalToContact: true,
    approvalToSpend: true,
    approvalToBuild: true,
  });

  assert.equal(result.run.status, "ready");
  assert.equal(result.run.budgetGate.insideCap, true);
  assert.equal(result.run.subagentReviews.some((review) => review.agent === "qa-council" && review.verdict === "pass"), true);
  assert.equal(result.run.workOrder.some((step) => step.ownerAgent === "automation-architect"), true);
  assert.equal(result.snapshot.recentAgentRuns[0].businessName, "Black Room");
});

test("blocks revenue agent run when cost cap is broken", () => {
  const result = recordRevenueAgentRun({
    businessName: "Risky Automation",
    area: "Miami",
    niche: "clinic",
    request: "Build a complex AI automation with many tools and no deposit yet.",
    stage: "production",
    projectType: "automation",
    estimatedOfferUsd: 2500,
    estimatedInternalCostUsd: 140,
    monthlyBudgetUsd: 100,
    cashCollectedUsd: 0,
    approvalToContact: false,
    approvalToSpend: false,
    approvalToBuild: false,
  });

  assert.equal(result.run.status, "blocked");
  assert.equal(result.run.requiredApprovals.includes("reducir costo mensual a menos de $100"), true);
  assert.equal(result.run.subagentReviews.some((review) => review.agent === "cost-controller" && review.verdict === "block"), true);
  assert.equal(result.snapshot.metrics.approvalQueue, 1);
});

test("main revenue agent asks questions when the client request is unclear", () => {
  const result = recordRevenueAgentRun({
    businessName: "Unclear Salon",
    area: "Miami",
    niche: "salon",
    request: "Make automation",
    stage: "proposal",
    projectType: "automation",
    estimatedOfferUsd: 2500,
    estimatedInternalCostUsd: 40,
    monthlyBudgetUsd: 100,
    cashCollectedUsd: 0,
    approvalToContact: true,
    approvalToSpend: true,
    approvalToBuild: false,
  });

  assert.equal(result.run.status, "approval_required");
  assert.equal(result.run.clarificationGate.status, "needs_clarification");
  assert.equal(result.run.requiredApprovals.includes("responder preguntas de aclaracion"), true);
  assert.equal(result.run.workOrder[0].ownerAgent, "growth-director");
  assert.equal(result.run.nextActions.some((action) => action.includes("preguntas de aclaracion")), true);
});

test("persists revenue agent runs across module state reloads", () => {
  recordRevenueAgentRun({
    businessName: "Persisted Agent Run",
    area: "Orlando",
    niche: "salon",
    request: "Prepare website mockup and booking follow-up automation.",
    stage: "mockup",
    projectType: "bundle",
    estimatedOfferUsd: 4200,
    estimatedInternalCostUsd: 44,
    monthlyBudgetUsd: 75,
    cashCollectedUsd: 0,
    approvalToContact: false,
    approvalToSpend: false,
    approvalToBuild: false,
  });

  setRevenueAgentRunsPathForTests(testAgentRunsPath);
  const snapshot = getRevenueEngineSnapshot();

  assert.equal(snapshot.recentAgentRuns[0].businessName, "Persisted Agent Run");
  assert.equal(snapshot.recentAgentRuns[0].status, "approval_required");
});

test("records sellable automation opportunity with quote and QA gates", () => {
  const result = recordRevenueAutomationOpportunity({
    businessName: "Booked Solid Salon",
    industry: "salon",
    request: "Automate new lead intake from Instagram and forms, booking follow-up, missed-call text messages, owner notifications and weekly reporting dashboard.",
    currentTools: "Google Sheets, Gmail, Instagram DM",
    monthlyBudgetUsd: 750,
    urgency: "this_month",
    sourceLeadId: "",
    status: "intake",
    clientApprovedScope: false,
    depositPaid: false,
  });

  assert.equal(result.opportunity.status, "quoted");
  assert.equal(result.opportunity.quote.decision.status, "ready_to_pitch");
  assert.equal(result.opportunity.quote.pricing.insideCostCap, true);
  assert.equal(result.opportunity.qaGates.some((gate) => gate.gate === "cost" && gate.passed), true);
  assert.equal(result.snapshot.recentAutomationOpportunities[0].businessName, "Booked Solid Salon");
});

test("blocks automation opportunity when request is unclear", () => {
  const result = recordRevenueAutomationOpportunity({
    businessName: "Vague Client",
    industry: "services",
    request: "Automate stuff",
    currentTools: "",
    monthlyBudgetUsd: 100,
    urgency: "flexible",
    sourceLeadId: "",
    status: "intake",
    clientApprovedScope: false,
    depositPaid: false,
  });

  assert.equal(result.opportunity.status, "blocked");
  assert.equal(result.opportunity.quote.decision.status, "needs_clarification");
  assert.equal(result.opportunity.quote.clarificationGate.status, "needs_clarification");
  assert.equal(result.opportunity.qaGates.some((gate) => gate.gate === "clarity" && gate.passed === false), true);
  assert.equal(result.snapshot.metrics.approvalQueue, 1);
});

test("asks clarifying questions before quoting vague automation requests", () => {
  const quote = buildAutomationQuote({
    businessName: "Vague Clinic",
    industry: "clinic",
    request: "Need automation",
    currentTools: "",
    monthlyBudgetUsd: 500,
    urgency: "this_month",
  });

  assert.equal(quote.decision.status, "needs_clarification");
  assert.equal(quote.clarificationGate.status, "needs_clarification");
  assert.equal(quote.clarificationGate.blocks.includes("build completo"), true);
  assert.equal(quote.clarifyingQuestions.length >= 3, true);
});

test("records automation intake and asks questions before quote is ready", () => {
  const result = recordRevenueAutomationIntake({
    businessName: "Vague Spa",
    industry: "spa",
    request: "Need automation",
    currentTools: "",
    monthlyBudgetUsd: 500,
    urgency: "this_month",
    contactName: "Owner",
    contactEmail: "",
    knownAnswers: "",
    source: "manual",
  });

  assert.equal(result.intake.status, "needs_answers");
  assert.equal(result.intake.nextQuestions.length >= 3, true);
  assert.equal(result.intake.answerTemplate.includes("Respuesta minima"), true);
  assert.equal(result.intake.blockedUntilAnswered.includes("build completo"), true);
  assert.equal(result.snapshot.recentAutomationIntakes[0].businessName, "Vague Spa");
});

test("answers automation intake and reruns clarification gate", () => {
  const created = recordRevenueAutomationIntake({
    businessName: "Answered Spa",
    industry: "spa",
    request: "Need automation",
    currentTools: "",
    monthlyBudgetUsd: 500,
    urgency: "this_month",
    contactName: "Owner",
    contactEmail: "",
    knownAnswers: "",
    source: "manual",
  });

  const answered = answerRevenueAutomationIntake({
    intakeId: created.intake.id,
    answers: "Trigger is a new website form lead. The system should save it to Google Sheets, notify the owner, and send an approved booking follow-up. Goal is more booked appointments.",
  });

  assert.equal(answered.status, "updated");
  assert.equal(answered.intake?.status, "ready_for_quote");
  assert.equal(answered.intake?.nextQuestions.length, 0);
  assert.equal(answered.intake?.blockedUntilAnswered.length, 0);
  assert.equal(answered.intake?.answerTemplate.includes("Respuesta minima"), true);
  assert.equal(answered.snapshot.recentAutomationIntakes[0].status, "ready_for_quote");
});

test("automation agent command asks questions instead of creating vague opportunities", () => {
  const result = runRevenueAutomationAgentCommand({
    businessName: "Vague Command Spa",
    industry: "spa",
    request: "Need automation",
    currentTools: "",
    monthlyBudgetUsd: 500,
    urgency: "this_month",
    contactName: "",
    contactEmail: "",
    knownAnswers: "",
    source: "manual",
    createOpportunityIfClear: true,
  });

  assert.equal(result.status, "needs_answers");
  assert.equal(result.opportunity, null);
  assert.equal(result.intake.status, "needs_answers");
  assert.equal(result.blockedUntilAnswered.includes("build completo"), true);
  assert.equal(result.snapshot.recentAutomationOpportunities.length, 0);
});

test("automation agent command creates quoted opportunity when request is clear", () => {
  const result = runRevenueAutomationAgentCommand({
    businessName: "Clear Command Gym",
    industry: "gym",
    request: "Automate new website trial signup into Google Sheets, notify the owner, send an approved trial follow-up email, and report booked trials weekly.",
    currentTools: "Google Sheets, Gmail",
    monthlyBudgetUsd: 800,
    urgency: "this_month",
    contactName: "Owner",
    contactEmail: "",
    knownAnswers: "Trigger is new website trial signup. Data goes to Google Sheets. Goal is booked trials. Follow-up is approved email only.",
    source: "manual",
    createOpportunityIfClear: true,
  });

  assert.equal(result.status, "opportunity_created");
  assert.equal(result.opportunity?.businessName, "Clear Command Gym");
  assert.equal(result.opportunity?.status, "quoted");
  assert.equal(result.snapshot.recentAutomationOpportunities[0].businessName, "Clear Command Gym");
  assert.equal(result.snapshot.recentAutomationIntakes[0].nextAction.includes("Agente creo oportunidad"), true);
});

test("automation agent command blocks sale lifecycle without scope and deposit", () => {
  const result = runRevenueAutomationAgentCommand({
    businessName: "Lifecycle Blocked Spa",
    industry: "spa",
    request: "Automate website booking requests into Google Sheets, notify the owner, send approved appointment follow-up, and report booked appointments weekly.",
    currentTools: "Google Sheets, Gmail",
    monthlyBudgetUsd: 800,
    urgency: "this_month",
    contactName: "Owner",
    contactEmail: "",
    knownAnswers: "Trigger is website booking request. Data goes to Google Sheets. Goal is booked appointments. Follow-up is approved email only.",
    source: "manual",
    lifecycleTarget: "sale",
    clientApprovedScope: false,
    depositPaid: false,
  });

  assert.equal(result.status, "sale_blocked");
  assert.equal(result.closeResult, null);
  assert.equal(result.workspaceResult, null);
  assert.equal(result.reason.includes("falta aprobacion escrita"), true);
  assert.equal(result.reason.includes("falta deposito"), true);
  assert.equal(result.snapshot.metrics.automationsSold, 0);
  assert.equal(result.snapshot.metrics.cashCollectedUsd, 0);
});

test("automation agent command records sale and creates delivery workspace when lifecycle gates pass", () => {
  const result = runRevenueAutomationAgentCommand({
    businessName: "Lifecycle Gym",
    industry: "gym",
    request: "Automate new website trial signup into Google Sheets, notify the owner, send an approved trial follow-up email, and report booked trials weekly.",
    currentTools: "Google Sheets, Gmail",
    monthlyBudgetUsd: 900,
    urgency: "this_month",
    contactName: "Owner",
    contactEmail: "",
    knownAnswers: "Trigger is new website trial signup. Data goes to Google Sheets. Goal is booked trials. Follow-up is approved email only.",
    source: "manual",
    lifecycleTarget: "delivery",
    clientApprovedScope: true,
    depositPaid: true,
    cashCollectedUsd: 2500,
    publicDataVerified: true,
    visualQaPassed: true,
    technicalQaPassed: false,
    automationQaPassed: false,
    clientHandoffReady: false,
    launchTargetDays: 7,
  });

  assert.equal(result.status, "delivery_workspace_created");
  assert.equal(result.closeResult?.status, "recorded");
  assert.equal(result.closeResult?.entry?.kind, "automation_sale");
  assert.equal(result.workspaceResult?.status, "created");
  assert.equal(result.workspaceResult?.workspace?.input.clientName, "Lifecycle Gym");
  assert.equal(result.workspaceResult?.workspace?.status, "blocked");
  assert.equal(result.workspaceResult?.workspace?.correctionQueue.some((item) => item.agent === "automation-qa"), true);
  assert.equal(result.snapshot.metrics.automationsSold, 1);
  assert.equal(result.snapshot.metrics.cashCollectedUsd, 2500);
});

test("blocks automation intake conversion until clarification is complete", () => {
  const created = recordRevenueAutomationIntake({
    businessName: "Blocked Intake Cafe",
    industry: "coffee",
    request: "Need automation",
    currentTools: "",
    monthlyBudgetUsd: 350,
    urgency: "this_month",
    contactName: "Owner",
    contactEmail: "",
    knownAnswers: "",
    source: "manual",
  });

  const converted = convertRevenueAutomationIntakeToOpportunity({
    intakeId: created.intake.id,
    status: "intake",
    clientApprovedScope: false,
    depositPaid: false,
  });

  assert.equal(converted.status, "blocked");
  assert.equal(converted.opportunity, null);
  assert.equal(converted.snapshot.recentAutomationOpportunities.length, 0);
});

test("converts ready automation intake into a tracked opportunity", () => {
  const created = recordRevenueAutomationIntake({
    businessName: "Ready Intake Gym",
    industry: "gym",
    request: "Need automation",
    currentTools: "",
    monthlyBudgetUsd: 700,
    urgency: "this_month",
    contactName: "Manager",
    contactEmail: "",
    knownAnswers: "",
    source: "call",
  });

  answerRevenueAutomationIntake({
    intakeId: created.intake.id,
    answers: "Trigger is a new trial signup form. Action is saving to Google Sheets, texting the owner, emailing an approved trial class follow-up, and reporting booked trials weekly.",
  });

  const converted = convertRevenueAutomationIntakeToOpportunity({
    intakeId: created.intake.id,
    status: "intake",
    clientApprovedScope: false,
    depositPaid: false,
  });

  assert.equal(converted.status, "converted");
  assert.equal(converted.opportunity?.businessName, "Ready Intake Gym");
  assert.equal(converted.opportunity?.quote.decision.status, "ready_to_pitch");
  assert.equal(converted.snapshot.recentAutomationOpportunities[0].businessName, "Ready Intake Gym");
  assert.equal(converted.snapshot.recentAutomationIntakes[0].nextAction.includes("Oportunidad creada"), true);
});

test("persists automation intakes across module state reloads", () => {
  recordRevenueAutomationIntake({
    businessName: "Answered Gym",
    industry: "gym",
    request: "Automate new lead intake from website form into Google Sheets, notify owner, and send approved follow-up for booking trial classes.",
    currentTools: "Google Sheets, website form, Gmail",
    monthlyBudgetUsd: 600,
    urgency: "this_month",
    contactName: "Manager",
    contactEmail: "manager@example.com",
    knownAnswers: "Trigger is a website lead form. Action is owner notification and approved follow-up. Goal is more booked trial classes.",
    source: "call",
  });

  setRevenueAutomationIntakesPathForTests(testAutomationIntakesPath);
  const snapshot = getRevenueEngineSnapshot();

  assert.equal(snapshot.recentAutomationIntakes[0].businessName, "Answered Gym");
  assert.equal(snapshot.recentAutomationIntakes[0].status, "ready_for_quote");
});

test("persists automation opportunities across module state reloads", () => {
  recordRevenueAutomationOpportunity({
    businessName: "Persisted Automation",
    industry: "restaurant",
    request: "Automate catering lead intake from forms and Instagram, email follow-up, reminders, invoice handoff, owner alerts and weekly reporting.",
    currentTools: "Google Sheets, email",
    monthlyBudgetUsd: 650,
    urgency: "this_month",
    sourceLeadId: "",
    status: "approved",
    clientApprovedScope: true,
    depositPaid: false,
  });

  setRevenueAutomationOpportunitiesPathForTests(testAutomationOpportunitiesPath);
  const snapshot = getRevenueEngineSnapshot();

  assert.equal(snapshot.recentAutomationOpportunities[0].businessName, "Persisted Automation");
  assert.equal(snapshot.recentAutomationOpportunities[0].status, "approved");
});

test("closes automation opportunity into ledger and updates money metrics", () => {
  const opportunity = recordRevenueAutomationOpportunity({
    businessName: "Ledger Automation Gym",
    industry: "gym",
    request: "Automate trial signup form into Google Sheets, notify owner, send approved follow-up, and report booked trials weekly.",
    currentTools: "Google Sheets, Gmail",
    monthlyBudgetUsd: 900,
    urgency: "this_month",
    sourceLeadId: "",
    status: "quoted",
    clientApprovedScope: false,
    depositPaid: false,
  });

  const result = closeRevenueAutomationOpportunity({
    opportunityId: opportunity.opportunity.id,
    cashCollectedUsd: opportunity.opportunity.quote.pricing.requiredDepositUsd,
    markScopeApproved: true,
    notes: "Deposit paid by client.",
  });

  assert.equal(result.status, "recorded");
  assert.equal(result.opportunity?.status, "sold");
  assert.equal(result.opportunity?.depositPaid, true);
  assert.equal(result.entry?.kind, "automation_sale");
  assert.equal(result.entry?.cashCollectedUsd, opportunity.opportunity.quote.pricing.requiredDepositUsd);
  assert.equal(result.snapshot.metrics.automationsSold, 1);
  assert.equal(result.snapshot.metrics.cashCollectedUsd, opportunity.opportunity.quote.pricing.requiredDepositUsd);
  assert.equal(result.snapshot.profitGuard.status, "scale_carefully");
});

test("blocks automation opportunity close when deposit is incomplete", () => {
  const opportunity = recordRevenueAutomationOpportunity({
    businessName: "Partial Deposit Automation",
    industry: "gym",
    request: "Automate trial signup form into Google Sheets, text the owner, send approved class follow-up, and report booked trials weekly.",
    currentTools: "Google Sheets, Gmail",
    monthlyBudgetUsd: 900,
    urgency: "this_month",
    sourceLeadId: "",
    status: "quoted",
    clientApprovedScope: false,
    depositPaid: false,
  });

  const partialDeposit = Math.max(1, opportunity.opportunity.quote.pricing.requiredDepositUsd - 100);
  const result = closeRevenueAutomationOpportunity({
    opportunityId: opportunity.opportunity.id,
    cashCollectedUsd: partialDeposit,
    markScopeApproved: true,
  });

  assert.equal(result.status, "blocked");
  assert.equal(result.entry, null);
  assert.equal(result.opportunity?.status, "quoted");
  assert.equal(result.opportunity?.depositPaid, false);
  assert.equal(result.reason.includes("deposito incompleto"), true);
  assert.equal(result.snapshot.metrics.automationsSold, 0);
  assert.equal(result.snapshot.metrics.cashCollectedUsd, 0);
});

test("does not double count automation opportunity already recorded in ledger", () => {
  const opportunity = recordRevenueAutomationOpportunity({
    businessName: "Duplicate Ledger Automation",
    industry: "gym",
    request: "Automate new trial signup form into Google Sheets, text the owner, send approved class follow-up, and report booked trials weekly.",
    currentTools: "Google Sheets, Gmail",
    monthlyBudgetUsd: 900,
    urgency: "this_month",
    sourceLeadId: "",
    status: "sold",
    clientApprovedScope: true,
    depositPaid: true,
  });

  const first = closeRevenueAutomationOpportunity({
    opportunityId: opportunity.opportunity.id,
    cashCollectedUsd: opportunity.opportunity.quote.pricing.requiredDepositUsd,
    markScopeApproved: true,
  });
  const second = closeRevenueAutomationOpportunity({
    opportunityId: opportunity.opportunity.id,
    cashCollectedUsd: opportunity.opportunity.quote.pricing.requiredDepositUsd,
    markScopeApproved: true,
  });

  assert.equal(first.status, "recorded");
  assert.equal(second.status, "already_recorded");
  assert.equal(second.snapshot.metrics.automationsSold, 1);
});

test("blocks delivery workspace creation from automation opportunity before deposit and scope", () => {
  const opportunity = recordRevenueAutomationOpportunity({
    businessName: "No Deposit Automation",
    industry: "clinic",
    request: "Automate website lead intake into Google Sheets, notify staff, send approved booking follow-up, and report booked consultations weekly.",
    currentTools: "Google Sheets, Gmail",
    monthlyBudgetUsd: 800,
    urgency: "this_month",
    sourceLeadId: "",
    status: "quoted",
    clientApprovedScope: false,
    depositPaid: false,
  });

  const result = createDeliveryWorkspaceFromAutomationOpportunity({
    opportunityId: opportunity.opportunity.id,
    publicDataVerified: true,
    visualQaPassed: false,
    technicalQaPassed: false,
    automationQaPassed: false,
    clientHandoffReady: false,
    launchTargetDays: 7,
  });

  assert.equal(result.status, "blocked");
  assert.equal(result.workspace, null);
  assert.equal(result.reason.includes("falta aprobacion escrita de scope"), true);
  assert.equal(result.reason.includes("falta deposito pagado"), true);
});

test("creates delivery workspace from sold automation opportunity with QA corrections", () => {
  const opportunity = recordRevenueAutomationOpportunity({
    businessName: "Sold Automation Gym",
    industry: "gym",
    request: "Automate new trial signup form into Google Sheets, text the owner, send approved class follow-up, and report booked trials weekly.",
    currentTools: "Google Sheets, email",
    monthlyBudgetUsd: 900,
    urgency: "this_month",
    sourceLeadId: "",
    status: "sold",
    clientApprovedScope: true,
    depositPaid: true,
  });

  const result = createDeliveryWorkspaceFromAutomationOpportunity({
    opportunityId: opportunity.opportunity.id,
    publicDataVerified: true,
    visualQaPassed: true,
    technicalQaPassed: false,
    automationQaPassed: false,
    clientHandoffReady: false,
    launchTargetDays: 7,
  });

  assert.equal(result.status, "created");
  assert.equal(result.workspace?.input.sourceOpportunityId, opportunity.opportunity.id);
  assert.equal(result.workspace?.input.clientName, "Sold Automation Gym");
  assert.equal(result.workspace?.status, "blocked");
  assert.equal(result.workspace?.correctionQueue.some((item) => item.agent === "automation-qa"), true);
  assert.equal(result.opportunity?.status, "in_delivery");
  assert.equal(result.snapshot.recentDeliveryWorkspaces[0].input.sourceOpportunityId, opportunity.opportunity.id);
});

test("blocks production plan when deposit or cost cap fails", () => {
  const plan = buildRevenueProjectPlan({
    clientName: "Risky Client",
    projectType: "automation",
    packageName: "Automation Sprint",
    setupUsd: 2500,
    monthlyRetainerUsd: 200,
    estimatedInternalCostUsd: 140,
    depositPaid: false,
    scopeApproved: true,
    publicDataVerified: true,
    includesAutomation: true,
    launchTargetDays: 7,
    clientRequest: "Complex AI automation",
  });

  assert.equal(plan.decision.status, "blocked");
  assert.equal(plan.decision.missing.includes("deposito pagado"), true);
  assert.equal(plan.decision.missing.includes("costo interno bajo $100/mes"), true);
  assert.equal(plan.deliveryGates.some((gate) => gate.gate === "cost" && gate.passed === false), true);
});

test("creates delivery workspace with subagent corrections before client handoff", () => {
  const result = recordRevenueDeliveryWorkspace({
    workspaceName: "Booked Solid delivery",
    sourceOpportunityId: "opp_1",
    clientName: "Booked Solid Salon",
    projectType: "bundle",
    packageName: "Website 3D Premium + Automation Sprint",
    setupUsd: 5000,
    monthlyRetainerUsd: 750,
    estimatedInternalCostUsd: 54,
    depositPaid: false,
    scopeApproved: true,
    publicDataVerified: true,
    includesAutomation: true,
    launchTargetDays: 7,
    clientRequest: "Website plus booking follow-up automation.",
    visualQaPassed: true,
    technicalQaPassed: false,
    automationQaPassed: false,
    clientHandoffReady: false,
  });

  assert.equal(result.workspace.status, "blocked");
  assert.equal(result.workspace.correctionQueue.some((item) => item.agent === "automation-qa" && item.blocksDelivery), true);
  assert.equal(result.workspace.approvalSummary.canLaunch, false);
  assert.equal(result.workspace.runbook.some((step) => step.ownerAgent === "qa-council"), true);
  assert.equal(result.snapshot.recentDeliveryWorkspaces[0].input.clientName, "Booked Solid Salon");
  assert.equal(result.snapshot.approvalQueueItems.some((item) => item.source === "delivery_workspace"), true);
});

test("revalidates delivery workspace after subagents resolve QA corrections", () => {
  const created = recordRevenueDeliveryWorkspace({
    workspaceName: "QA blocked delivery",
    sourceOpportunityId: "opp_qa",
    clientName: "QA Gym",
    projectType: "automation",
    packageName: "Automation Sprint",
    setupUsd: 3200,
    monthlyRetainerUsd: 650,
    estimatedInternalCostUsd: 45,
    depositPaid: true,
    scopeApproved: true,
    publicDataVerified: true,
    includesAutomation: true,
    launchTargetDays: 7,
    clientRequest: "Automate lead intake, owner alert, approved follow-up and weekly reporting.",
    visualQaPassed: true,
    technicalQaPassed: false,
    automationQaPassed: false,
    clientHandoffReady: false,
  });

  assert.equal(created.workspace.status, "blocked");

  const updated = updateRevenueDeliveryWorkspaceQa({
    workspaceId: created.workspace.id,
    publicDataVerified: true,
    visualQaPassed: true,
    technicalQaPassed: true,
    automationQaPassed: true,
    clientHandoffReady: true,
    notes: "Technical QA, automation QA, rollback and handoff completed.",
  });

  assert.equal(updated.status, "ready");
  assert.equal(updated.workspace?.status, "ready_to_deliver");
  assert.equal(updated.workspace?.correctionQueue.length, 0);
  assert.equal(updated.workspace?.approvalSummary.canLaunch, true);
  assert.equal(updated.snapshot.recentDeliveryWorkspaces[0].status, "ready_to_deliver");
});

test("blocks delivery handoff when workspace still has QA corrections", () => {
  const created = recordRevenueDeliveryWorkspace({
    workspaceName: "Blocked handoff",
    sourceOpportunityId: "",
    clientName: "Blocked Client",
    projectType: "automation",
    packageName: "Automation Sprint",
    setupUsd: 3200,
    monthlyRetainerUsd: 650,
    estimatedInternalCostUsd: 45,
    depositPaid: true,
    scopeApproved: true,
    publicDataVerified: true,
    includesAutomation: true,
    launchTargetDays: 7,
    clientRequest: "Automate lead intake and approved follow-up.",
    visualQaPassed: true,
    technicalQaPassed: false,
    automationQaPassed: false,
    clientHandoffReady: false,
  });

  const delivered = deliverRevenueDeliveryWorkspace({
    workspaceId: created.workspace.id,
    approvedByRobert: true,
  });

  assert.equal(delivered.status, "blocked");
  assert.equal(delivered.handoff, null);
  assert.equal(delivered.reason.includes("workspace no esta listo"), true);
});

test("delivers ready workspace and marks linked automation opportunity delivered", () => {
  const opportunity = recordRevenueAutomationOpportunity({
    businessName: "Delivered Automation Gym",
    industry: "gym",
    request: "Automate new trial signup form into Google Sheets, text the owner, send approved class follow-up, and report booked trials weekly.",
    currentTools: "Google Sheets, Gmail",
    monthlyBudgetUsd: 900,
    urgency: "this_month",
    sourceLeadId: "",
    status: "sold",
    clientApprovedScope: true,
    depositPaid: true,
  });
  const created = recordRevenueDeliveryWorkspace({
    workspaceName: "Delivered workspace",
    sourceOpportunityId: opportunity.opportunity.id,
    clientName: "Delivered Automation Gym",
    projectType: "automation",
    packageName: "Automation Sprint",
    setupUsd: opportunity.opportunity.quote.pricing.setupPriceUsd,
    monthlyRetainerUsd: opportunity.opportunity.quote.pricing.monthlyRetainerUsd,
    estimatedInternalCostUsd: opportunity.opportunity.quote.pricing.estimatedInternalMonthlyCostUsd,
    depositPaid: true,
    scopeApproved: true,
    publicDataVerified: true,
    includesAutomation: true,
    launchTargetDays: 7,
    clientRequest: opportunity.opportunity.request,
    visualQaPassed: true,
    technicalQaPassed: true,
    automationQaPassed: true,
    clientHandoffReady: true,
  });

  const delivered = deliverRevenueDeliveryWorkspace({
    workspaceId: created.workspace.id,
    approvedByRobert: true,
    notes: "Client handoff complete.",
  });

  assert.equal(delivered.status, "delivered");
  assert.equal(delivered.handoff?.clientName, "Delivered Automation Gym");
  assert.equal(delivered.opportunity?.status, "delivered");
  assert.equal(delivered.workspace?.learningNote.includes("entregado con QA aprobado"), true);
  assert.equal(delivered.snapshot.recentAutomationOpportunities[0].status, "delivered");
});

test("blocks delivery improvement review until workspace is ready", () => {
  const created = recordRevenueDeliveryWorkspace({
    workspaceName: "Blocked review workspace",
    sourceOpportunityId: "",
    clientName: "Blocked Review Client",
    projectType: "automation",
    packageName: "Automation Sprint",
    setupUsd: 2500,
    monthlyRetainerUsd: 500,
    estimatedInternalCostUsd: 35,
    depositPaid: false,
    scopeApproved: false,
    publicDataVerified: false,
    includesAutomation: true,
    launchTargetDays: 7,
    clientRequest: "Automate intake and weekly reporting.",
    visualQaPassed: false,
    technicalQaPassed: false,
    automationQaPassed: false,
    clientHandoffReady: false,
  });

  const result = recordRevenueDeliveryWorkspaceImprovementReview({
    workspaceId: created.workspace.id,
    periodLabel: "post-delivery week 1",
    notes: "Should not record before QA.",
  });

  assert.equal(result.status, "blocked");
  assert.equal(result.review, null);
  assert.equal(result.reason.includes("workspace no esta listo"), true);
  assert.equal(result.snapshot.recentImprovementReviews.length, 0);
});

test("records delivery improvement review as playbook memory for next batch", () => {
  const created = recordRevenueDeliveryWorkspace({
    workspaceName: "Learning delivery workspace",
    sourceOpportunityId: "",
    clientName: "Learning Delivery Client",
    projectType: "automation",
    packageName: "Automation Sprint",
    setupUsd: 3000,
    monthlyRetainerUsd: 650,
    estimatedInternalCostUsd: 45,
    depositPaid: true,
    scopeApproved: true,
    publicDataVerified: true,
    includesAutomation: true,
    launchTargetDays: 7,
    clientRequest: "Automate new lead capture, owner notification and weekly report.",
    visualQaPassed: true,
    technicalQaPassed: true,
    automationQaPassed: true,
    clientHandoffReady: true,
  });

  const result = recordRevenueDeliveryWorkspaceImprovementReview({
    workspaceId: created.workspace.id,
    periodLabel: "post-delivery week 1",
    leadsContacted: 0,
    replies: 0,
    callsBooked: 0,
    dealsClosed: 1,
    hoursSaved: 3,
    defectsFound: 0,
    clientComplaints: 0,
    notes: "Delivery worked and can inform the next automation batch.",
  });

  assert.equal(result.status, "recorded");
  assert.equal(result.review?.input.campaignName, "Learning Delivery Client");
  assert.equal(result.review?.input.bestOffer, "Automation Sprint");
  assert.equal(result.review?.metrics.insideSpendCap, true);
  assert.equal(result.snapshot.recentImprovementReviews[0].input.campaignName, "Learning Delivery Client");
  assert.equal(result.snapshot.recentDeliveryWorkspaces[0].learningNote.includes(result.review?.id || ""), true);
  assert.equal(result.snapshot.nextBatchPlan.latestReviewId, result.review?.id);
});

test("persists ready delivery workspaces across module state reloads", () => {
  recordRevenueDeliveryWorkspace({
    workspaceName: "Ready delivery",
    sourceOpportunityId: "",
    clientName: "Ready Client",
    projectType: "automation",
    packageName: "Automation Sprint",
    setupUsd: 2500,
    monthlyRetainerUsd: 500,
    estimatedInternalCostUsd: 35,
    depositPaid: true,
    scopeApproved: true,
    publicDataVerified: true,
    includesAutomation: true,
    launchTargetDays: 7,
    clientRequest: "Automate lead intake from forms, notify owner, save to Google Sheets and send approved follow-up.",
    visualQaPassed: true,
    technicalQaPassed: true,
    automationQaPassed: true,
    clientHandoffReady: true,
  });

  setRevenueDeliveryWorkspacesPathForTests(testDeliveryWorkspacesPath);
  const snapshot = getRevenueEngineSnapshot();

  assert.equal(snapshot.recentDeliveryWorkspaces[0].input.clientName, "Ready Client");
  assert.equal(snapshot.recentDeliveryWorkspaces[0].status, "ready_to_deliver");
  assert.equal(snapshot.recentDeliveryWorkspaces[0].approvalSummary.canLaunch, true);
});

test("persists ledger entries across module state reloads", () => {
  recordRevenueLedgerEntry({
    kind: "automation_sale",
    clientName: "Persisted Client",
    amountUsd: 2500,
    cashCollectedUsd: 1250,
    estimatedInternalCostUsd: 35,
    notes: "Automation Sprint deposit",
  });

  setRevenueLedgerPathForTests(testLedgerPath);
  const snapshot = getRevenueEngineSnapshot();

  assert.equal(snapshot.metrics.automationsSold, 1);
  assert.equal(snapshot.metrics.cashCollectedUsd, 1250);
  assert.equal(snapshot.recentLedger[0].clientName, "Persisted Client");
});

test("pauses improvement loop when spend reaches cap without collected revenue", () => {
  const review = buildImprovementReview({
    campaignName: "No revenue batch",
    periodLabel: "week 1",
    leadsContacted: 40,
    replies: 1,
    callsBooked: 0,
    dealsClosed: 0,
    revenueCollectedUsd: 0,
    spendUsd: 100,
    estimatedInternalMonthlyCostUsd: 40,
    hoursSaved: 0,
    defectsFound: 0,
    clientComplaints: 0,
    bestOffer: "",
    biggestObjection: "Too expensive",
    notes: "",
  });

  assert.equal(review.decision.status, "pause_and_fix");
  assert.equal(review.metrics.insideSpendCap, true);
  assert.equal(review.nextBatch.maxSpendUsd, 10);
  assert.equal(review.agentScorecard.some((agent) => agent.agent === "cost-controller" && agent.score === "block"), true);
});

test("next batch plan pauses after a blocked improvement review", () => {
  recordRevenueImprovementReview({
    campaignName: "Blocked quality batch",
    periodLabel: "week 1",
    leadsContacted: 30,
    replies: 2,
    callsBooked: 0,
    dealsClosed: 0,
    revenueCollectedUsd: 0,
    spendUsd: 100,
    estimatedInternalMonthlyCostUsd: 40,
    hoursSaved: 0,
    defectsFound: 4,
    clientComplaints: 1,
    bestOffer: "",
    biggestObjection: "Confusing offer",
    notes: "Quality issues before scale.",
  });

  const snapshot = getRevenueEngineSnapshot();

  assert.equal(snapshot.nextBatchPlan.status, "pause");
  assert.equal(snapshot.nextBatchPlan.maxLeads, 0);
  assert.equal(snapshot.nextBatchPlan.maxSpendUsd, 0);
  assert.equal(snapshot.nextBatchPlan.requiredBeforeNextAction.includes("resolver bloqueos QA/costo antes de contactar"), true);
});

test("scales carefully when collected revenue proves profitable demand", () => {
  const review = buildImprovementReview({
    campaignName: "Winning automation offer",
    periodLabel: "week 2",
    leadsContacted: 25,
    replies: 4,
    callsBooked: 2,
    dealsClosed: 1,
    revenueCollectedUsd: 3000,
    spendUsd: 25,
    estimatedInternalMonthlyCostUsd: 50,
    hoursSaved: 5,
    defectsFound: 0,
    clientComplaints: 0,
    bestOffer: "Automation Sprint",
    biggestObjection: "Need proof",
    notes: "Closed after showing dashboard demo.",
  });

  assert.equal(review.decision.status, "scale_carefully");
  assert.equal(review.metrics.profitable, true);
  assert.equal(review.nextBatch.maxLeads, 25);
  assert.equal(review.nextBatch.maxSpendUsd <= 100, true);
});

test("next batch plan scales only when cash and latest review prove demand", () => {
  recordRevenueLedgerEntry({
    kind: "automation_sale",
    clientName: "Winning Client",
    amountUsd: 3000,
    cashCollectedUsd: 3000,
    estimatedInternalCostUsd: 40,
    notes: "Automation Sprint paid.",
  });
  recordRevenueImprovementReview({
    campaignName: "Winning automation offer",
    periodLabel: "week 2",
    leadsContacted: 25,
    replies: 4,
    callsBooked: 2,
    dealsClosed: 1,
    revenueCollectedUsd: 3000,
    spendUsd: 25,
    estimatedInternalMonthlyCostUsd: 40,
    hoursSaved: 5,
    defectsFound: 0,
    clientComplaints: 0,
    bestOffer: "Automation Sprint",
    biggestObjection: "Need proof",
    notes: "Closed after showing dashboard demo.",
  });

  const snapshot = getRevenueEngineSnapshot();

  assert.equal(snapshot.nextBatchPlan.status, "scale_carefully");
  assert.equal(snapshot.nextBatchPlan.maxLeads, 25);
  assert.equal(snapshot.nextBatchPlan.maxSpendUsd <= snapshot.profitGuard.canSpendUsd, true);
  assert.equal(snapshot.nextBatchPlan.allowedActions.includes("contactar batch aprobado"), true);
});

test("records and persists improvement reviews as revenue playbook memory", () => {
  const first = recordRevenueImprovementReview({
    campaignName: "Learning batch",
    periodLabel: "week 1",
    leadsContacted: 10,
    replies: 1,
    callsBooked: 0,
    dealsClosed: 0,
    revenueCollectedUsd: 0,
    spendUsd: 10,
    estimatedInternalMonthlyCostUsd: 40,
    hoursSaved: 0,
    defectsFound: 0,
    clientComplaints: 0,
    bestOffer: "Website 3D Premium",
    biggestObjection: "Need mockup",
    notes: "Keep batch small.",
  });
  const second = recordRevenueImprovementReview({
    campaignName: "Learning batch",
    periodLabel: "week 2",
    leadsContacted: 20,
    replies: 4,
    callsBooked: 2,
    dealsClosed: 1,
    revenueCollectedUsd: 3000,
    spendUsd: 20,
    estimatedInternalMonthlyCostUsd: 50,
    hoursSaved: 3,
    defectsFound: 0,
    clientComplaints: 0,
    bestOffer: "Automation Sprint",
    biggestObjection: "Need proof",
    notes: "Dashboard demo helped close.",
  });

  assert.equal(first.review.playbookVersion, 1);
  assert.equal(second.review.playbookVersion, 2);
  assert.equal(second.review.decisionStatus, "scale_carefully");
  assert.equal(second.snapshot.recentImprovementReviews[0].playbookVersion, 2);

  setRevenueImprovementReviewsPathForTests(testImprovementReviewsPath);
  const snapshot = getRevenueEngineSnapshot();

  assert.equal(snapshot.recentImprovementReviews.length, 2);
  assert.equal(snapshot.recentImprovementReviews[0].learningSummary.includes("Playbook v2"), true);
});
