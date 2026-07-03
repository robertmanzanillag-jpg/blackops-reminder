import assert from "node:assert/strict";
import test from "node:test";
import {
  approveRevenueOutreachDraft,
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
    "website-sales-packet",
    "outreach-review",
    "website-close",
    "website-handoff",
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
    "website-sales-packet",
    "outreach-review",
    "website-close",
    "website-handoff",
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
