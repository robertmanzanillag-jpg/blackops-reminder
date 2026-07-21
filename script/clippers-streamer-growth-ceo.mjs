import { lstat, readFile, realpath, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const captionStrategies = [
  { id: "direct_insight", captionStyle: "direct", subtitleStyle: "clean_sentence", hookStyle: "clear_claim" },
  { id: "curiosity_question", captionStyle: "question", subtitleStyle: "word_by_word", hookStyle: "open_loop" },
  { id: "context_first", captionStyle: "context", subtitleStyle: "clean_sentence", hookStyle: "why_it_matters" },
  { id: "hook_only", captionStyle: "minimal", subtitleStyle: "hook_only", hookStyle: "short_claim" },
];
const exactTikTokPostPattern = /^https:\/\/(?:www\.)?tiktok\.com\/@[A-Za-z0-9._-]{2,40}\/video\/\d{8,30}\/?$/i;

function draftAssignments(campaign, experiment, rows) {
  const draftCount = Math.floor(finiteNumber(campaign.draftsReady) || 0);
  const namedDrafts = Array.isArray(campaign.draftFiles)
    ? campaign.draftFiles.map((value) => String(value || "").trim()).filter(Boolean)
    : [];
  const testedCounts = new Map(captionStrategies.map((strategy) => [
    strategy.id,
    rows.filter((row) => row.strategyId === strategy.id).length,
  ]));
  const ordered = [...captionStrategies].sort((a, b) => {
    if (experiment.winnerStrategyId) {
      if (a.id === experiment.winnerStrategyId) return -1;
      if (b.id === experiment.winnerStrategyId) return 1;
    }
    return testedCounts.get(a.id) - testedCounts.get(b.id) || a.id.localeCompare(b.id);
  });
  const requiredHashtags = Array.isArray(campaign.requiredHashtags)
    ? campaign.requiredHashtags.map((value) => String(value || "").trim()).filter(Boolean)
    : [];
  const winnerSlots = experiment.winnerStrategyId ? Math.round(draftCount * 0.7) : 0;
  const explorationOrder = experiment.winnerStrategyId
    ? ordered.filter((strategy) => strategy.id !== experiment.winnerStrategyId)
    : ordered;
  return Array.from({ length: draftCount }, (_, index) => {
    const strategy = experiment.winnerStrategyId && index < winnerSlots
      ? captionStrategies.find((row) => row.id === experiment.winnerStrategyId)
      : explorationOrder[(index - winnerSlots + explorationOrder.length) % explorationOrder.length];
    const requiresTranscript = strategy.subtitleStyle !== "hook_only";
    const topic = (namedDrafts[index] ? path.basename(namedDrafts[index], path.extname(namedDrafts[index])) : campaign.title)
      .replace(/^streamersclipusa-|^streamersclips-/i, "")
      .replace(/^[^-]+-[^-]+-\d+-/i, "")
      .replace(/[-_]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    const captionText = strategy.captionStyle === "question"
      ? `Would you have expected this from ${campaign.creator}?`
      : strategy.captionStyle === "context"
        ? `${campaign.creator} explains the context behind ${topic}.`
        : strategy.captionStyle === "minimal"
          ? `${campaign.creator}: ${topic}.`
          : `${topic}: the part worth watching.`;
    return {
      slot: index + 1,
      draftFile: namedDrafts[index] || null,
      strategyId: strategy.id,
      captionStyle: strategy.captionStyle,
      subtitleStyle: strategy.subtitleStyle,
      hookStyle: strategy.hookStyle,
      requiredHashtags,
      captionText: `${captionText} ${requiredHashtags.join(" ")}`.trim(),
      requiresTranscript,
      preparationStatus: requiresTranscript ? "needs_local_transcript" : "ready_with_hook_only",
      metricoolStatus: "approval_required",
      publishAllowed: false,
    };
  });
}

function finiteNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function median(values) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function exactEvidence(value) {
  const text = String(value || "").trim();
  return text.length >= 12 && !/<[^>]+>|placeholder|paste here|example\.com/i.test(text);
}

function campaignExpiryMs(campaign) {
  const exact = Date.parse(String(campaign.expiresAt || ""));
  if (Number.isFinite(exact)) return exact;
  const observedAt = Date.parse(String(campaign.remainingTimeObservedAt || ""));
  const hoursRemaining = finiteNumber(campaign.hoursRemainingObserved);
  return Number.isFinite(observedAt) && hoursRemaining !== null ? observedAt + hoursRemaining * 3_600_000 : NaN;
}

function campaignBlockers(campaign, now) {
  const expiresAt = campaignExpiryMs(campaign);
  return [
    campaign.active !== true ? "campaign_not_active" : null,
    campaign.joined !== true ? "campaign_not_joined" : null,
    !Number.isFinite(expiresAt) || expiresAt <= now.getTime() ? "campaign_expired_or_unknown" : null,
    !exactEvidence(campaign.rightsEvidencePath) || campaign.evidenceVerified !== true ? "campaign_rights_evidence_missing" : null,
    !exactEvidence(campaign.sourceUrl) ? "authorized_source_missing" : null,
    !exactEvidence(campaign.creatorReachEvidence) ? "creator_reach_evidence_missing" : null,
    finiteNumber(campaign.payoutCpm) === null || Number(campaign.payoutCpm) <= 0 ? "payout_cpm_missing" : null,
    finiteNumber(campaign.minViewsPerPost) === null ? "minimum_views_missing" : null,
    !String(campaign.accountHandle || "").trim() ? "destination_account_missing" : null,
    finiteNumber(campaign.sourceFilesReady) === null || Number(campaign.sourceFilesReady) < 1 ? "source_files_missing" : null,
    finiteNumber(campaign.draftsReady) === null || Number(campaign.draftsReady) < 1 ? "drafts_missing" : null,
  ].filter(Boolean);
}

function payoutBlockers(campaign) {
  return [
    campaign.payoutIdentityReady !== true ? "payout_identity_not_verified" : null,
    campaign.payoutMethodReady !== true ? "payout_method_not_connected" : null,
  ].filter(Boolean);
}

function metricRowsForCampaign(metrics, campaignId) {
  return metrics.filter((row) => row.campaignId === campaignId
    && row.finalStatus === "published"
    && exactTikTokPostPattern.test(String(row.publishedPostUrl || "").trim())
    && row.metricEvidenceVerified === true
    && finiteNumber(row.views) !== null);
}

function strategyPerformance(rows, strategyId) {
  const strategyRows = rows.filter((row) => row.strategyId === strategyId);
  const views = strategyRows.map((row) => Number(row.views));
  const qualifying = strategyRows.filter((row) => row.qualifiedForPayout === true && row.qualificationEvidenceVerified === true).length;
  return {
    strategyId,
    samples: strategyRows.length,
    medianViews: median(views),
    totalViews: views.reduce((sum, value) => sum + value, 0),
    qualifyingPosts: qualifying,
    totalEarningsUsd: strategyRows.reduce((sum, row) => sum + (row.payoutEvidenceVerified === true ? (finiteNumber(row.earningsUsd) || 0) : 0), 0),
    medianCompletionRate: median(strategyRows.map((row) => finiteNumber(row.completionRate)).filter((value) => value !== null)),
    medianShareRate: median(strategyRows.map((row) => finiteNumber(row.shareRate)).filter((value) => value !== null)),
  };
}

function chooseExperiment(rows) {
  const performance = captionStrategies.map((strategy) => strategyPerformance(rows, strategy.id));
  const proven = performance
    .filter((row) => row.samples >= 3 && row.medianViews !== null)
    .sort((a, b) => (b.medianViews - a.medianViews) || (b.totalEarningsUsd - a.totalEarningsUsd));
  const leastTested = [...performance].sort((a, b) => a.samples - b.samples || a.strategyId.localeCompare(b.strategyId))[0];
  const winner = proven[0] || null;
  const nextStrategyId = winner && rows.length >= 8 && rows.length % 10 < 7 ? winner.strategyId : leastTested.strategyId;
  return {
    status: winner ? "winner_with_exploration" : "learning",
    winnerStrategyId: winner?.strategyId || null,
    nextStrategyId,
    allocation: winner ? { winnerPercent: 70, explorationPercent: 30 } : { balancedTestPercent: 25 },
    performance,
    minimumSamplesPerStrategy: 3,
  };
}

function campaignDecision(campaign, metrics, now) {
  const productionBlockers = campaignBlockers(campaign, now);
  const paymentBlockers = payoutBlockers(campaign);
  const rows = metricRowsForCampaign(metrics, campaign.id);
  const medianViews = median(rows.map((row) => Number(row.views)));
  const totalViews = rows.reduce((sum, row) => sum + Number(row.views), 0);
  const totalEarningsUsd = rows.reduce((sum, row) => sum + (row.payoutEvidenceVerified === true ? (finiteNumber(row.earningsUsd) || 0) : 0), 0);
  const qualifyingPosts = rows.filter((row) => row.qualifiedForPayout === true && row.qualificationEvidenceVerified === true).length;
  const minViews = Number(campaign.minViewsPerPost || 0);
  const experiment = chooseExperiment(rows);
  const assignments = draftAssignments(campaign, experiment, rows);
  let decision = "blocked";
  if (!productionBlockers.length) {
    if (rows.length < 3) decision = "test";
    else if (medianViews >= minViews && qualifyingPosts / rows.length >= 0.5) decision = "scale";
    else if (rows.length >= 6 && qualifyingPosts === 0) decision = "pause_and_recut";
    else decision = "optimize";
  }
  const expiryMs = campaignExpiryMs(campaign);
  const hoursRemaining = Number.isFinite(expiryMs)
    ? Math.max(0, Math.round((expiryMs - now.getTime()) / 3_600_000))
    : null;
  const payoutCpm = finiteNumber(campaign.payoutCpm);
  const observedRevenuePerThousand = totalViews > 0 ? Math.round((totalEarningsUsd / totalViews) * 1000 * 100) / 100 : null;
  const priorityScore = productionBlockers.length ? 0 : Math.round(
    (payoutCpm || 0) * 20
    + Math.min(30, (hoursRemaining || 0) / 24)
    + Math.min(25, Number(campaign.draftsReady || 0) * 3)
    + (campaign.creatorTier === "top" ? 20 : campaign.creatorTier === "major" ? 12 : 4)
    + (medianViews !== null && minViews > 0 ? Math.min(30, (medianViews / minViews) * 15) : 0)
  );
  return {
    campaignId: campaign.id,
    title: campaign.title,
    creator: campaign.creator,
    creatorTier: campaign.creatorTier || "unknown",
    marketplace: campaign.marketplace,
    decision,
    priorityScore,
    productionBlockers,
    publishBlockers: [...productionBlockers, ...paymentBlockers],
    canProduce: productionBlockers.length === 0,
    canEnterApprovalQueue: productionBlockers.length === 0 && paymentBlockers.length === 0,
    realPublishEnabled: false,
    metricoolApprovalRequired: true,
    payoutCpm,
    minViewsPerPost: minViews,
    maxPayoutPerPost: finiteNumber(campaign.maxPayoutPerPost),
    hoursRemaining,
    observed: {
      publishedPosts: rows.length,
      totalViews,
      medianViews,
      qualifyingPosts,
      totalEarningsUsd: Math.round(totalEarningsUsd * 100) / 100,
      observedRevenuePerThousand,
    },
    experiment,
    assignments,
    nextAction: productionBlockers.length
      ? `Resolve ${productionBlockers[0]}.`
      : paymentBlockers.length
        ? `Prepare drafts, but do not publish until ${paymentBlockers[0]} is resolved.`
        : decision === "scale"
          ? `Allocate 70% to ${experiment.winnerStrategyId || experiment.nextStrategyId} and 30% to controlled exploration.`
          : decision === "pause_and_recut"
            ? "Pause this cut style and create materially different hooks before another paid test."
            : `Run the next controlled test with ${experiment.nextStrategyId}.`,
  };
}

export function buildStreamerGrowthCeoPlan({ campaigns = [], metrics = [], now = new Date(), monthlyViewsTarget = 1_000_000 }) {
  const decisions = campaigns.map((campaign) => campaignDecision(campaign, metrics, now))
    .sort((a, b) => b.priorityScore - a.priorityScore || a.title.localeCompare(b.title));
  const actualPublishedRows = metrics.filter((row) => row.finalStatus === "published"
    && exactTikTokPostPattern.test(String(row.publishedPostUrl || "").trim())
    && row.metricEvidenceVerified === true
    && finiteNumber(row.views) !== null);
  const measuredViews = actualPublishedRows.reduce((sum, row) => sum + Number(row.views), 0);
  const measuredEarningsUsd = actualPublishedRows.reduce((sum, row) => sum + (row.payoutEvidenceVerified === true ? (finiteNumber(row.earningsUsd) || 0) : 0), 0);
  const active = decisions.filter((row) => row.canProduce);
  const scaling = decisions.filter((row) => row.decision === "scale");
  const next = decisions[0] || null;
  return {
    status: !campaigns.length ? "needs_campaign_catalog" : !active.length ? "blocked" : scaling.length ? "scaling" : "testing",
    generatedAt: now.toISOString(),
    goal: {
      monthlyViewsTarget,
      measuredViews,
      measuredEarningsUsd: Math.round(measuredEarningsUsd * 100) / 100,
      progressPercent: Math.min(100, Math.round((measuredViews / monthlyViewsTarget) * 10000) / 100),
      requiredDailyViews: Math.ceil(monthlyViewsTarget / 30),
      projection: actualPublishedRows.length >= 7 ? "eligible_for_projection_after_date_window_check" : "insufficient_real_posts",
    },
    portfolio: {
      campaigns: campaigns.length,
      activeProduction: active.length,
      approvalQueueEligible: decisions.filter((row) => row.canEnterApprovalQueue).length,
      scaling: scaling.length,
      blocked: decisions.filter((row) => !row.canProduce).length,
    },
    operatingPolicy: {
      dailyTestClips: scaling.length ? 4 : active.length ? 2 : 0,
      maximumDailyClipsPerAccount: 8,
      exploitPercent: scaling.length ? 70 : 0,
      explorePercent: scaling.length ? 30 : 100,
      minimumSamplesBeforeWinner: 3,
      paidSpendAllowed: false,
      metricoolApprovalRequired: true,
      realPublishEnabled: false,
    },
    decisions,
    nextBestAction: next?.nextAction || "Add a verified paid campaign with evidence; do not fabricate campaign availability.",
    guardrails: [
      "Campaign authorization is required; creator fame never replaces commercial rights.",
      "Only proof-backed finalStatus=published Metricool rows count as views; earnings require separate payout evidence.",
      "No caption or subtitle winner is declared before three real posts per strategy.",
      "Payout identity and payment method must be verified before entering the approval queue.",
      "The CEO may prepare and rank work, but real publishing remains disabled.",
    ],
  };
}

async function containedRegularFile(root, candidate) {
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(resolvedRoot, String(candidate || "").replace(/^\/clippers-workspace\//, ""));
  const relative = path.relative(resolvedRoot, resolved);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) return null;
  const [rootReal, fileReal, fileStats] = await Promise.all([
    realpath(resolvedRoot).catch(() => null),
    realpath(resolved).catch(() => null),
    lstat(resolved).catch(() => null),
  ]);
  if (!rootReal || !fileReal || !fileStats?.isFile() || fileStats.isSymbolicLink()) return null;
  const realRelative = path.relative(rootReal, fileReal);
  return realRelative && !realRelative.startsWith("..") && !path.isAbsolute(realRelative) ? resolved : null;
}

async function verifyTextEvidence(workspaceRoot, evidencePath, requiredValues) {
  const resolved = await containedRegularFile(workspaceRoot, evidencePath);
  if (!resolved) return false;
  const text = await readFile(resolved, "utf8").catch(() => "");
  return text.length >= 80
    && !/<[^>]+>|placeholder|paste here/i.test(text)
    && requiredValues.every((value) => text.toLowerCase().includes(String(value || "").toLowerCase()));
}

async function main() {
  const workspaceRoot = path.resolve(process.env.CLIPPERS_WORKSPACE_ROOT || "clippers_workspace");
  const inputDir = path.join(workspaceRoot, "research");
  const reportDir = path.join(workspaceRoot, "reports");
  const campaignsPath = path.join(inputDir, "paid-streamer-campaigns.json");
  const metricsPath = path.join(inputDir, "paid-streamer-campaign-metrics.json");
  const campaigns = JSON.parse(await readFile(campaignsPath, "utf8").catch(() => "[]"));
  const metrics = JSON.parse(await readFile(metricsPath, "utf8").catch(() => "[]"));
  for (const campaign of campaigns) {
    campaign.evidenceVerified = await verifyTextEvidence(workspaceRoot, campaign.rightsEvidencePath, [
      campaign.id,
      campaign.marketplace,
      campaign.sourceUrl,
    ]);
  }
  for (const row of metrics) {
    const exactPost = exactTikTokPostPattern.test(String(row.publishedPostUrl || "").trim());
    row.metricEvidenceVerified = exactPost && await verifyTextEvidence(workspaceRoot, row.metricoolProofPath, [
      "Metricool",
      row.publishedPostUrl,
      String(row.views),
    ]);
    row.payoutEvidenceVerified = exactPost && await verifyTextEvidence(workspaceRoot, row.payoutProofPath, [
      row.campaignId,
      row.publishedPostUrl,
      String(row.earningsUsd),
    ]);
    row.qualificationEvidenceVerified = row.payoutEvidenceVerified;
  }
  const plan = buildStreamerGrowthCeoPlan({ campaigns, metrics });
  await mkdir(reportDir, { recursive: true });
  await writeFile(path.join(reportDir, "streamer-growth-ceo.json"), `${JSON.stringify(plan, null, 2)}\n`);
  console.log(JSON.stringify(plan, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) await main();
