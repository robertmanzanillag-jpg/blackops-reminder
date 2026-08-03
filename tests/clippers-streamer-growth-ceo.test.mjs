import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { buildMetricoolApprovalRows, buildStreamerGrowthCeoPlan, resolveWorkspaceMediaPath, validateMetricoolMp4 } from "../script/clippers-streamer-growth-ceo.mjs";

const now = new Date("2026-07-21T18:00:00.000Z");
const publishedPostUrl = "https://www.tiktok.com/@streamersclipusa/video/1234567890123456789";
const campaign = {
  id: "mrbeast-jre",
  title: "MrBeast x Joe Rogan",
  creator: "MrBeast",
  creatorTier: "top",
  creatorReachEvidence: "https://www.youtube.com/@MrBeast",
  marketplace: "vyro",
  active: true,
  joined: true,
  expiresAt: "2026-07-29T18:00:00.000Z",
  payoutCpm: 1.5,
  minViewsPerPost: 5000,
  maxPayoutPerPost: 1000,
  rightsEvidencePath: "evidence-drop/vyro/mrbeast.md",
  evidenceVerified: true,
  sourceUrl: "https://f.io/authorized-source",
  accountHandle: "streamersclipusa",
  sourceFilesReady: 7,
  draftsReady: 7,
  payoutIdentityReady: true,
  payoutMethodReady: true,
  requiredHashtags: ["#MrBeast", "#paidpartner"],
  draftFiles: ["draft-01.mp4", "draft-02.mp4", "draft-03.mp4", "draft-04.mp4", "draft-05.mp4", "draft-06.mp4", "draft-07.mp4"],
};

test("blocks famous creators when campaign rights evidence is missing", () => {
  const plan = buildStreamerGrowthCeoPlan({ campaigns: [{ ...campaign, rightsEvidencePath: "" }], metrics: [], now });
  assert.equal(plan.status, "blocked");
  assert.equal(plan.decisions[0].decision, "blocked");
  assert.ok(plan.decisions[0].productionBlockers.includes("campaign_rights_evidence_missing"));
  assert.equal(plan.decisions[0].priorityScore, 0);
  const authorizedPlan = buildStreamerGrowthCeoPlan({
    campaigns: [{ ...campaign, rightsEvidencePath: "" }],
    metrics: [],
    now,
    publishingAuthorized: true,
  });
  assert.match(authorizedPlan.nextBestAction, /campaign_rights_evidence_missing/);
});

test("tests a verified top creator without fabricating expected revenue", () => {
  const plan = buildStreamerGrowthCeoPlan({ campaigns: [campaign], metrics: [], now });
  assert.equal(plan.status, "testing");
  assert.equal(plan.decisions[0].decision, "test");
  assert.equal(plan.decisions[0].observed.totalViews, 0);
  assert.equal(plan.goal.projection, "insufficient_real_posts");
  assert.equal(plan.operatingPolicy.dailyTestClips, 1);
  assert.equal(plan.decisions[0].assignments.length, 7);
  assert.deepEqual(
    new Set(plan.decisions[0].assignments.map((row) => row.strategyId)),
    new Set(["conflict_question", "surprising_claim", "payoff_open_loop", "reaction_quote", "ranked_choice"]),
  );
  assert.deepEqual(plan.decisions[0].assignments[0].requiredHashtags, ["#MrBeast", "#paidpartner"]);
  assert.match(plan.decisions[0].assignments[0].captionText, /#MrBeast #paidpartner$/);
  assert.ok(plan.decisions[0].assignments.every((row) => row.publishAllowed === false));
});

test("requires an explicit runtime opt-in before enabling Metricool publishing", () => {
  const defaultPlan = buildStreamerGrowthCeoPlan({ campaigns: [campaign], metrics: [], now });
  const authorizedPlan = buildStreamerGrowthCeoPlan({
    campaigns: [campaign],
    metrics: [],
    now,
    publishingAuthorized: true,
  });

  assert.equal(defaultPlan.operatingPolicy.realPublishEnabled, false);
  assert.equal(defaultPlan.operatingPolicy.metricoolApprovalRequired, true);
  assert.equal(authorizedPlan.operatingPolicy.publishingAuthorized, true);
  assert.equal(authorizedPlan.operatingPolicy.realPublishEnabled, false);
  assert.equal(authorizedPlan.operatingPolicy.metricoolApprovalRequired, true);
  assert.equal(authorizedPlan.decisions[0].publishingAuthorized, true);
  assert.equal(authorizedPlan.decisions[0].realPublishEnabled, false);
  const authorizedRows = buildMetricoolApprovalRows(authorizedPlan.decisions[0], {
    1: { ready: true, relativePath: "drafts/vyro/authorized.mp4" },
  });
  assert.equal(authorizedRows[0].status, "authorized_for_metricool");
  assert.equal(authorizedRows[0].publishAllowed, true);
  assert.equal(authorizedRows.length, 1);
  assert.equal(buildStreamerGrowthCeoPlan({ campaigns: [campaign], metrics: [], now, targetDailyClips: 20 }).operatingPolicy.dailyTestClips, 1);
  assert.equal(buildStreamerGrowthCeoPlan({ campaigns: [campaign], metrics: [], now, targetDailyClips: -3 }).operatingPolicy.dailyTestClips, 1);
});

test("keeps campaign volume low until verified quality produces a breakout", () => {
  const metrics = Array.from({ length: 15 }, (_, index) => ({
    campaignId: campaign.id,
    strategyId: index % 2 ? "reaction_quote" : "conflict_question",
    finalStatus: "published",
    publishedPostUrl: `https://www.tiktok.com/@streamersclipusa/video/${1234567890123456700n + BigInt(index)}`,
    views: 500 + index * 50,
    earningsUsd: 0,
    qualifiedForPayout: false,
    metricEvidenceVerified: true,
  }));

  const learningPlan = buildStreamerGrowthCeoPlan({ campaigns: [campaign], metrics: metrics.slice(0, 5), now });
  assert.equal(learningPlan.operatingPolicy.dailyTestClips, 1);
  assert.equal(learningPlan.operatingPolicy.minimumInitialDailyClips, 0);
  assert.equal(learningPlan.operatingPolicy.volumeReason, "one_controlled_campaign_test_until_breakout");

  const recutPlan = buildStreamerGrowthCeoPlan({ campaigns: [campaign], metrics, now });
  assert.equal(recutPlan.operatingPolicy.dailyTestClips, 1);
  assert.equal(recutPlan.operatingPolicy.maximumDailyClipsPerAccount, 2);
  assert.equal(recutPlan.operatingPolicy.volumeReason, "quality_reset_while_recutting");
});

test("scheduled rows cannot raise the quality-first learning volume", () => {
  const scheduledMetrics = Array.from({ length: 20 }, (_, index) => ({
    campaignId: campaign.id,
    finalStatus: index % 2 ? "scheduled" : "queued",
    views: 1_000_000,
  }));
  const plan = buildStreamerGrowthCeoPlan({
    campaigns: [campaign],
    metrics: scheduledMetrics,
    now,
    targetDailyClips: 8,
  });
  assert.equal(plan.operatingPolicy.dailyTestClips, 1);
  assert.equal(plan.operatingPolicy.configuredDailyCeiling, 2);
  assert.equal(plan.operatingPolicy.volumeReason, "one_controlled_campaign_test_until_breakout");
});

test("raises volume only after fifteen verified winning posts", () => {
  const winningMetrics = Array.from({ length: 15 }, (_, index) => ({
    campaignId: campaign.id,
    strategyId: "surprising_claim",
    finalStatus: "published",
    publishedPostUrl: `https://www.tiktok.com/@streamersclipusa/video/${2234567890123456700n + BigInt(index)}`,
    views: 10_000 + index * 100,
    earningsUsd: 15,
    qualifiedForPayout: true,
    metricEvidenceVerified: true,
    payoutEvidenceVerified: true,
    qualificationEvidenceVerified: true,
  }));
  const plan = buildStreamerGrowthCeoPlan({
    campaigns: [campaign],
    metrics: winningMetrics,
    now,
    targetDailyClips: 8,
  });
  assert.equal(plan.operatingPolicy.dailyTestClips, 1);
  assert.equal(plan.operatingPolicy.volumeReason, "one_campaign_plus_owned_original_scale");
});

test("accepts an observed countdown without inventing an exact campaign deadline", () => {
  const relativeCampaign = {
    ...campaign,
    expiresAt: "",
    remainingTimeObservedAt: "2026-07-21T18:00:00.000Z",
    hoursRemainingObserved: 192,
  };
  const plan = buildStreamerGrowthCeoPlan({ campaigns: [relativeCampaign], metrics: [], now });
  assert.equal(plan.decisions[0].hoursRemaining, 192);
  assert.equal(plan.decisions[0].canProduce, true);
});

test("separates Metricool approval readiness from Vyro cashout readiness", () => {
  const plan = buildStreamerGrowthCeoPlan({ campaigns: [{ ...campaign, payoutMethodReady: false }], metrics: [], now });
  assert.equal(plan.decisions[0].canProduce, true);
  assert.equal(plan.decisions[0].canEnterApprovalQueue, true);
  assert.equal(plan.decisions[0].cashoutReady, false);
  assert.ok(plan.decisions[0].cashoutBlockers.includes("payout_method_not_connected"));
  assert.equal(plan.decisions[0].publishBlockers.length, 0);
});

test("scales only after real qualifying posts and keeps exploration", () => {
  const metrics = [
    { campaignId: campaign.id, strategyId: "surprising_claim", finalStatus: "published", publishedPostUrl, views: 12000, earningsUsd: 18, qualifiedForPayout: true, metricEvidenceVerified: true, payoutEvidenceVerified: true, qualificationEvidenceVerified: true, retentionEvidenceVerified: true, engagementEvidenceVerified: true, fiveSecondRetention: 0.66, completionRate: 0.41, shareRate: 0.03 },
    { campaignId: campaign.id, strategyId: "surprising_claim", finalStatus: "published", publishedPostUrl, views: 9000, earningsUsd: 13.5, qualifiedForPayout: true, metricEvidenceVerified: true, payoutEvidenceVerified: true, qualificationEvidenceVerified: true, retentionEvidenceVerified: true, engagementEvidenceVerified: true, fiveSecondRetention: 0.61, completionRate: 0.38, shareRate: 0.025 },
    { campaignId: campaign.id, strategyId: "surprising_claim", finalStatus: "published", publishedPostUrl, views: 15000, earningsUsd: 22.5, qualifiedForPayout: true, metricEvidenceVerified: true, payoutEvidenceVerified: true, qualificationEvidenceVerified: true, retentionEvidenceVerified: true, engagementEvidenceVerified: true, fiveSecondRetention: 0.71, completionRate: 0.45, shareRate: 0.04 },
  ];
  const plan = buildStreamerGrowthCeoPlan({ campaigns: [campaign], metrics, now });
  assert.equal(plan.status, "scaling");
  assert.equal(plan.decisions[0].decision, "scale");
  assert.equal(plan.decisions[0].experiment.winnerStrategyId, "surprising_claim");
  assert.deepEqual(plan.decisions[0].experiment.allocation, { winnerPercent: 70, explorationPercent: 30 });
  assert.equal(plan.decisions[0].assignments.filter((row) => row.strategyId === "surprising_claim").length, 5);
  assert.equal(plan.goal.measuredViews, 36000);
  assert.equal(plan.goal.measuredEarningsUsd, 54);
});

test("queued or scheduled rows never count as published performance", () => {
  const metrics = [
    { campaignId: campaign.id, strategyId: "direct_insight", finalStatus: "scheduled", views: 9999999, earningsUsd: 9999, qualifiedForPayout: true },
    { campaignId: campaign.id, strategyId: "direct_insight", finalStatus: "queued", views: 5000000, earningsUsd: 5000, qualifiedForPayout: true },
  ];
  const plan = buildStreamerGrowthCeoPlan({ campaigns: [campaign], metrics, now });
  assert.equal(plan.goal.measuredViews, 0);
  assert.equal(plan.goal.measuredEarningsUsd, 0);
  assert.equal(plan.decisions[0].decision, "test");
});

test("pauses a cut style after six posts with no payout qualification", () => {
  const metrics = Array.from({ length: 6 }, (_, index) => ({
    campaignId: campaign.id,
    strategyId: index % 2 ? "reaction_quote" : "conflict_question",
    finalStatus: "published",
    publishedPostUrl,
    views: 500 + index * 100,
    earningsUsd: 0,
    qualifiedForPayout: false,
    metricEvidenceVerified: true,
  }));
  const plan = buildStreamerGrowthCeoPlan({ campaigns: [campaign], metrics, now });
  assert.equal(plan.decisions[0].decision, "pause_and_recut");
  assert.match(plan.decisions[0].nextAction, /Pause/);
});

test("ignores published metrics without local Metricool evidence", () => {
  const plan = buildStreamerGrowthCeoPlan({
    campaigns: [campaign],
    metrics: [{
      campaignId: campaign.id,
      strategyId: "surprising_claim",
      finalStatus: "published",
      views: 10_000_000,
      earningsUsd: 15_000,
      qualifiedForPayout: true,
      metricEvidenceVerified: false,
      payoutEvidenceVerified: false,
    }],
    now,
  });
  assert.equal(plan.goal.measuredViews, 0);
  assert.equal(plan.goal.measuredEarningsUsd, 0);
  assert.equal(plan.decisions[0].decision, "test");
});

test("ignores proof flags when the exact TikTok post URL is missing", () => {
  const plan = buildStreamerGrowthCeoPlan({
    campaigns: [campaign],
    metrics: [{
      campaignId: campaign.id,
      strategyId: "surprising_claim",
      finalStatus: "published",
      publishedPostUrl: "",
      views: 10_000_000,
      metricEvidenceVerified: true,
    }],
    now,
  });
  assert.equal(plan.goal.measuredViews, 0);
  assert.equal(plan.decisions[0].observed.publishedPosts, 0);
});

test("ignores verified metrics from a different TikTok account", () => {
  const wrongAccountMetrics = Array.from({ length: 15 }, (_, index) => ({
    campaignId: campaign.id,
    strategyId: "surprising_claim",
    finalStatus: "published",
    publishedPostUrl: `https://www.tiktok.com/@wrongaccount/video/${3234567890123456700n + BigInt(index)}`,
    views: 1_000_000,
    qualifiedForPayout: true,
    metricEvidenceVerified: true,
    qualificationEvidenceVerified: true,
  }));
  const plan = buildStreamerGrowthCeoPlan({ campaigns: [campaign], metrics: wrongAccountMetrics, now, targetDailyClips: 8 });
  assert.equal(plan.goal.measuredViews, 0);
  assert.equal(plan.decisions[0].observed.publishedPosts, 0);
  assert.equal(plan.decisions[0].decision, "test");
  assert.equal(plan.operatingPolicy.dailyTestClips, 1);
});

test("exposes a real CEO learning system and separates revenue lanes", () => {
  const plan = buildStreamerGrowthCeoPlan({
    campaigns: [campaign],
    metrics: [{
      campaignId: campaign.id,
      strategyId: "conflict_question",
      finalStatus: "published",
      publishedPostUrl,
      views: 152,
      comments: 3,
      shares: 2,
      follows: 1,
      fiveSecondRetention: 0.42,
      completionRate: 0.21,
      retentionEvidenceVerified: true,
      engagementEvidenceVerified: true,
      metricEvidenceVerified: true,
    }],
    now,
  });

  assert.equal(plan.learningSystem.knowledgeBase.revenueLanes.length, 2);
  assert.equal(plan.learningSystem.account.medianViews, 152);
  assert.equal(plan.learningSystem.account.breakoutThreshold, 304);
  assert.equal(plan.learningSystem.account.breakoutPosts, 0);
  assert.ok(plan.learningSystem.account.recommendations.some((item) => item.includes("No verified breakout")));
  assert.deepEqual(plan.learningSystem.experimentCadence.reviewWindowsHours, [24, 72, 240]);
  assert.ok(plan.learningSystem.metricsToCapture.includes("fiveSecondRetention"));
  assert.equal(plan.dailyPortfolioPlan.maximumTotalPosts, 2);
  assert.equal(plan.dailyPortfolioPlan.campaignPosts, 1);
  assert.equal(plan.dailyPortfolioPlan.ownedOriginalPostsTarget, 1);
  assert.equal(plan.dailyPortfolioPlan.ownedOriginalPostsAuthorized, 0);
  assert.equal(plan.operatingPolicy.paidSpendAllowed, false);
});

test("does not let unverified retention or engagement influence strategy learning", () => {
  const plan = buildStreamerGrowthCeoPlan({
    campaigns: [campaign],
    metrics: Array.from({ length: 3 }, (_, index) => ({
      campaignId: campaign.id,
      strategyId: "reaction_quote",
      finalStatus: "published",
      publishedPostUrl: `https://www.tiktok.com/@streamersclipusa/video/${4234567890123456700n + BigInt(index)}`,
      views: 100 + index,
      fiveSecondRetention: 1,
      completionRate: 1,
      shares: 100,
      follows: 100,
      metricEvidenceVerified: true,
      retentionEvidenceVerified: false,
      engagementEvidenceVerified: false,
    })),
    now,
  });
  const performance = plan.decisions[0].experiment.performance.find((row) => row.strategyId === "reaction_quote");
  assert.equal(performance.verifiedRetentionSamples, 0);
  assert.equal(performance.verifiedEngagementSamples, 0);
  assert.equal(performance.medianFiveSecondRetention, null);
  assert.equal(performance.medianShareRate, null);
});

test("Metricool rows point to final media while cashout setup remains separate", () => {
  const plan = buildStreamerGrowthCeoPlan({ campaigns: [{ ...campaign, payoutMethodReady: false }], metrics: [], now });
  const rows = buildMetricoolApprovalRows(plan.decisions[0], {
    1: { ready: true, relativePath: "drafts/vyro/campaign/subtitled/final.mp4" },
  });
  assert.equal(rows[0].draftFile, "drafts/vyro/campaign/subtitled/final.mp4");
  assert.equal(rows[0].status, "approval_required");
  assert.equal(rows[0].publishAllowed, false);
  assert.equal(rows.length, 1);
});

test("Metricool rows require approval even after campaign and payout gates pass", () => {
  const plan = buildStreamerGrowthCeoPlan({ campaigns: [campaign], metrics: [], now });
  const rows = buildMetricoolApprovalRows(plan.decisions[0], {
    1: { ready: true, relativePath: "drafts/vyro/campaign/subtitled/final.mp4" },
  });
  assert.equal(rows[0].status, "approval_required");
  assert.equal(rows[0].publishAllowed, false);
});

test("normalizes served workspace paths without accepting outside paths as ready media", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "clippers-ceo-media-"));
  try {
    await mkdir(path.join(root, "drafts"));
    const fakeMp4 = path.join(root, "drafts", "fake.mp4");
    await writeFile(fakeMp4, "not a real MP4");
    assert.equal(resolveWorkspaceMediaPath(root, "/clippers-workspace/drafts/fake.mp4"), fakeMp4);
    assert.equal(await validateMetricoolMp4(root, "/clippers-workspace/drafts/fake.mp4"), null);
    assert.equal(await validateMetricoolMp4(root, "../outside.mp4"), null);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
