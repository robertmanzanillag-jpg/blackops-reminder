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
});

test("tests a verified top creator without fabricating expected revenue", () => {
  const plan = buildStreamerGrowthCeoPlan({ campaigns: [campaign], metrics: [], now });
  assert.equal(plan.status, "testing");
  assert.equal(plan.decisions[0].decision, "test");
  assert.equal(plan.decisions[0].observed.totalViews, 0);
  assert.equal(plan.goal.projection, "insufficient_real_posts");
  assert.equal(plan.operatingPolicy.dailyTestClips, 2);
  assert.equal(plan.decisions[0].assignments.length, 7);
  assert.deepEqual(
    new Set(plan.decisions[0].assignments.map((row) => row.strategyId)),
    new Set(["direct_insight", "curiosity_question", "context_first", "hook_only"]),
  );
  assert.deepEqual(plan.decisions[0].assignments[0].requiredHashtags, ["#MrBeast", "#paidpartner"]);
  assert.match(plan.decisions[0].assignments[0].captionText, /#MrBeast #paidpartner$/);
  assert.ok(plan.decisions[0].assignments.every((row) => row.publishAllowed === false));
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
    { campaignId: campaign.id, strategyId: "direct_insight", finalStatus: "published", publishedPostUrl, views: 12000, earningsUsd: 18, qualifiedForPayout: true, metricEvidenceVerified: true, payoutEvidenceVerified: true, qualificationEvidenceVerified: true, completionRate: 0.41, shareRate: 0.03 },
    { campaignId: campaign.id, strategyId: "direct_insight", finalStatus: "published", publishedPostUrl, views: 9000, earningsUsd: 13.5, qualifiedForPayout: true, metricEvidenceVerified: true, payoutEvidenceVerified: true, qualificationEvidenceVerified: true, completionRate: 0.38, shareRate: 0.025 },
    { campaignId: campaign.id, strategyId: "direct_insight", finalStatus: "published", publishedPostUrl, views: 15000, earningsUsd: 22.5, qualifiedForPayout: true, metricEvidenceVerified: true, payoutEvidenceVerified: true, qualificationEvidenceVerified: true, completionRate: 0.45, shareRate: 0.04 },
  ];
  const plan = buildStreamerGrowthCeoPlan({ campaigns: [campaign], metrics, now });
  assert.equal(plan.status, "scaling");
  assert.equal(plan.decisions[0].decision, "scale");
  assert.equal(plan.decisions[0].experiment.winnerStrategyId, "direct_insight");
  assert.deepEqual(plan.decisions[0].experiment.allocation, { winnerPercent: 70, explorationPercent: 30 });
  assert.equal(plan.decisions[0].assignments.filter((row) => row.strategyId === "direct_insight").length, 5);
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
    strategyId: index % 2 ? "hook_only" : "curiosity_question",
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
      strategyId: "direct_insight",
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
      strategyId: "direct_insight",
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

test("Metricool rows point to final media while cashout setup remains separate", () => {
  const plan = buildStreamerGrowthCeoPlan({ campaigns: [{ ...campaign, payoutMethodReady: false }], metrics: [], now });
  const rows = buildMetricoolApprovalRows(plan.decisions[0], {
    1: { ready: true, relativePath: "drafts/vyro/campaign/subtitled/final.mp4" },
  });
  assert.equal(rows[0].draftFile, "drafts/vyro/campaign/subtitled/final.mp4");
  assert.equal(rows[0].status, "approval_required");
  assert.equal(rows[0].publishAllowed, false);
  assert.equal(rows[1].status, "blocked_media_missing");
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
