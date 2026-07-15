import assert from "node:assert/strict";
import test from "node:test";
import {
  approveRevenueOutreachDraft,
  closeRevenueWebsiteOpportunity,
  getRevenueEngineSnapshot,
  recordRevenueOutreachOutcome,
  recordRevenueWebsiteOpportunity,
  resetRevenueLeadsForTests,
  resetRevenueOutreachForTests,
  resetRevenuePublicLeadCandidatesForTests,
  resetRevenueWebsiteOpportunitiesForTests,
  runRevenueMoneySprint,
  setRevenueLeadsPathForTests,
  setRevenueOutreachPathForTests,
  setRevenuePublicLeadCandidatesPathForTests,
  setRevenueWebsiteOpportunitiesPathForTests,
} from "../server/revenue-engine";
import { buildRevenueFirstMoneyCommandCenter } from "../server/revenue-first-money-command-center-cli";

const testLeadsPath = "/tmp/revenue-first-money-command-center-v2-leads-test.json";
const testOutreachPath = "/tmp/revenue-first-money-command-center-v2-outreach-test.json";
const testPublicCandidatesPath = "/tmp/revenue-first-money-command-center-v2-public-candidates-test.json";
const testWebsiteOpportunitiesPath = "/tmp/revenue-first-money-command-center-v2-website-opportunities-test.json";

setRevenueLeadsPathForTests(testLeadsPath);
setRevenueOutreachPathForTests(testOutreachPath);
setRevenuePublicLeadCandidatesPathForTests(testPublicCandidatesPath);
setRevenueWebsiteOpportunitiesPathForTests(testWebsiteOpportunitiesPath);

test.afterEach(() => {
  resetRevenueLeadsForTests();
  resetRevenueOutreachForTests();
  resetRevenuePublicLeadCandidatesForTests();
  resetRevenueWebsiteOpportunitiesForTests();
});

test("first-money command center starts with guarded public scouting and read-only safety", () => {
  const packet = buildRevenueFirstMoneyCommandCenter({ mode: "first-sprint", json: false });

  assert.equal(packet.nextCommand.id, "public-scout");
  assert.deepEqual(packet.queue.map((item) => item.id), [
    "website-close",
    "website-handoff",
    "website-sales-packet",
    "outreach-review",
    "public-scout",
    "readiness",
  ]);
  assert.equal(packet.queue.some((item) => item.id === "website-sales-packet"), true);
  assert.equal(packet.queue.some((item) => item.id === "website-close"), true);
  assert.equal(packet.counts.websiteHandoffs, 0);
  assert.equal(packet.safety.writesFiles, false);
  assert.equal(packet.safety.sendsOutreach, false);
  assert.equal(packet.safety.chargesClients, false);
  assert.equal(packet.safety.deploys, false);
  assert.equal(packet.safety.printsSecrets, false);
});

test("first-money command center prioritizes website sales packet before manual contact", () => {
  const sprint = runRevenueMoneySprint({
    area: "Miami",
    niche: "coffee shop",
    offerFocus: "both",
    dailyResearchTarget: 20,
    dailyQualifiedLeadLimit: 5,
    dailyMockupLimit: 1,
    dailyContactLimit: 5,
    maxPaidDataSpendUsd: 0,
    requireRobertApprovalToContact: true,
    writePreviewFiles: true,
    seedLeadBatchText: "",
    seedLeads: [
      {
        businessName: "Command Center Sales Cafe",
        area: "Miami",
        niche: "coffee shop",
        websiteStatus: "no_website",
        contactChannel: "email",
        contactValue: "owner@commandcentersales.example",
        evidence: "Google listing has no website, recent menu photos and verified owner email.",
        painPoint: "Needs online menu, catering inquiry capture and follow-up.",
        estimatedOfferUsd: 4200,
        status: "research",
        sourceUrl: "https://example.com/command-center-sales-cafe",
        recipientEmail: "owner@commandcentersales.example",
        contactName: "Owner",
        businessSummary: "Command Center Sales Cafe has public evidence of no dedicated website and needs menu capture.",
      },
    ],
  });

  assert.equal(sprint.snapshot.websiteSalesPacketQueue.readyCount, 1);

  const approval = approveRevenueOutreachDraft({
    draftId: sprint.outreachDrafts[0].id,
    approvedByRobert: true,
    notes: "Robert approved manual contact after reviewing public evidence and mockup.",
  });
  assert.equal(approval.snapshot.manualOutreachQueue.readyCount, 1);

  const packet = buildRevenueFirstMoneyCommandCenter({ mode: "first-sprint", json: false });
  const salesQueueItem = packet.queue.find((item) => item.id === "website-sales-packet");
  const outreachQueueItem = packet.queue.find((item) => item.id === "outreach-review");

  assert.equal(packet.nextCommand.id, "website-sales-packet");
  assert.deepEqual(packet.queue.map((item) => item.id), [
    "website-close",
    "website-handoff",
    "website-sales-packet",
    "outreach-review",
    "public-scout",
    "readiness",
  ]);
  assert.equal(packet.counts.websiteSalesPackets, 1);
  assert.equal(packet.counts.reviewableOutreachDrafts, 1);
  assert.equal(packet.counts.websiteHandoffs, 0);
  assert.equal(salesQueueItem?.status, "review");
  assert.match(salesQueueItem?.command || "", /Command Center Sales Cafe/);
  assert.equal(outreachQueueItem?.status, "review");
  assert.equal(packet.safety.sendsOutreach, false);
  assert.equal(packet.safety.chargesClients, false);
});

test("first-money command center prioritizes website close after opportunity is created", () => {
  const sprint = runRevenueMoneySprint({
    area: "Miami",
    niche: "salon",
    offerFocus: "both",
    dailyResearchTarget: 20,
    dailyQualifiedLeadLimit: 5,
    dailyMockupLimit: 1,
    dailyContactLimit: 5,
    maxPaidDataSpendUsd: 0,
    requireRobertApprovalToContact: true,
    writePreviewFiles: true,
    seedLeadBatchText: "",
    seedLeads: [
      {
        businessName: "Command Center Close Salon",
        area: "Miami",
        niche: "salon",
        websiteStatus: "weak_website",
        contactChannel: "email",
        contactValue: "owner@commandcenterclose.example",
        evidence: "Public listing has current services but website has outdated hours and no booking funnel.",
        painPoint: "Needs booking, services pages and lead capture before seasonal demand.",
        estimatedOfferUsd: 5200,
        status: "research",
        sourceUrl: "https://example.com/command-center-close-salon",
        recipientEmail: "owner@commandcenterclose.example",
        contactName: "Owner",
        businessSummary: "Command Center Close Salon has public evidence of an outdated site and booking gap.",
      },
    ],
  });

  approveRevenueOutreachDraft({
    draftId: sprint.outreachDrafts[0].id,
    approvedByRobert: true,
    notes: "Robert approved manual contact after reviewing public evidence and mockup.",
  });

  const snapshot = getRevenueEngineSnapshot();
  const opportunityRequest = JSON.parse(snapshot.websiteSalesPacketQueue.items[0].copyableOpportunityRequest);
  const opportunity = recordRevenueWebsiteOpportunity(opportunityRequest);
  assert.equal(opportunity.status, "quoted");

  const packet = buildRevenueFirstMoneyCommandCenter({ mode: "first-sprint", json: false });
  const closeQueueItem = packet.queue.find((item) => item.id === "website-close");

  assert.equal(packet.nextCommand.id, "website-close");
  assert.equal(packet.counts.websiteClosures, 1);
  assert.equal(packet.counts.websiteSalesPackets, 1);
  assert.equal(closeQueueItem?.status, "review");
  assert.match(closeQueueItem?.command || "", /Command Center Close Salon/);
  assert.deepEqual(packet.queue.map((item) => item.id), [
    "website-close",
    "website-handoff",
    "website-sales-packet",
    "outreach-review",
    "public-scout",
    "readiness",
  ]);
  assert.equal(packet.safety.chargesClients, false);
  assert.equal(packet.safety.deploys, false);
});

test("first-money command center prioritizes paid website handoff after close evidence", () => {
  const sprint = runRevenueMoneySprint({
    area: "Miami",
    niche: "restaurant",
    offerFocus: "both",
    dailyResearchTarget: 20,
    dailyQualifiedLeadLimit: 5,
    dailyMockupLimit: 1,
    dailyContactLimit: 5,
    maxPaidDataSpendUsd: 0,
    requireRobertApprovalToContact: true,
    writePreviewFiles: true,
    seedLeadBatchText: "",
    seedLeads: [
      {
        businessName: "Command Center Handoff Bistro",
        area: "Miami",
        niche: "restaurant",
        websiteStatus: "weak_website",
        contactChannel: "email",
        contactValue: "owner@commandcenterhandoff.example",
        evidence: "Public listing has updated photos but the website lacks online ordering and event inquiry capture.",
        painPoint: "Needs menu, catering, and event lead capture before weekend traffic.",
        estimatedOfferUsd: 6200,
        status: "research",
        sourceUrl: "https://example.com/command-center-handoff-bistro",
        recipientEmail: "owner@commandcenterhandoff.example",
        contactName: "Owner",
        businessSummary: "Command Center Handoff Bistro has public demand signals and weak conversion paths.",
      },
    ],
  });
  const draft = sprint.outreachDrafts[0];

  approveRevenueOutreachDraft({
    draftId: draft.id,
    approvedByRobert: true,
    notes: "Robert approved manual contact after reviewing public evidence and mockup.",
  });

  const snapshot = getRevenueEngineSnapshot();
  const opportunityRequest = JSON.parse(snapshot.websiteSalesPacketQueue.items[0].copyableOpportunityRequest);
  const opportunityResult = recordRevenueWebsiteOpportunity(opportunityRequest);
  const depositOutcome = recordRevenueOutreachOutcome({
    draftId: draft.id,
    outcome: "deposit_collected",
    outcomeRecordedByRobert: true,
    cashCollectedUsd: draft.pricing.depositUsd,
    paymentConfirmation: "Stripe pi_command_center_handoff_123",
    notes: "Robert confirmed deposit after scope review.",
  });
  assert.equal(depositOutcome.status, "recorded");

  const closeResult = closeRevenueWebsiteOpportunity({
    opportunityId: opportunityResult.opportunity!.id,
    depositPaid: true,
    scopeApproved: true,
    cashCollectedUsd: draft.pricing.depositUsd,
    paymentConfirmation: "Stripe pi_command_center_handoff_123",
    notes: "Verified manual deposit and scope approval before website delivery.",
  });
  assert.equal(closeResult.status, "sold");

  const packet = buildRevenueFirstMoneyCommandCenter({ mode: "first-sprint", json: false });
  const handoffQueueItem = packet.queue.find((item) => item.id === "website-handoff");

  assert.equal(packet.nextCommand.id, "website-handoff");
  assert.equal(packet.counts.websiteHandoffs, 1);
  assert.equal(handoffQueueItem?.status, "review");
  assert.match(handoffQueueItem?.command || "", /Prepare website delivery handoff/);
  assert.deepEqual(packet.queue.map((item) => item.id), [
    "website-close",
    "website-handoff",
    "website-sales-packet",
    "outreach-review",
    "public-scout",
    "readiness",
  ]);
  assert.equal(packet.safety.chargesClients, false);
  assert.equal(packet.safety.deploys, false);
});
