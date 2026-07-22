import { lstat, readFile, realpath, writeFile, mkdir } from "node:fs/promises";
import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";

const captionStrategies = [
  { id: "direct_insight", captionStyle: "direct", subtitleStyle: "clean_sentence", hookStyle: "clear_claim" },
  { id: "curiosity_question", captionStyle: "question", subtitleStyle: "word_by_word", hookStyle: "open_loop" },
  { id: "context_first", captionStyle: "context", subtitleStyle: "clean_sentence", hookStyle: "why_it_matters" },
  { id: "hook_only", captionStyle: "minimal", subtitleStyle: "hook_only", hookStyle: "short_claim" },
];
const exactTikTokPostPattern = /^https:\/\/(?:www\.)?tiktok\.com\/@([A-Za-z0-9._-]{2,40})\/video\/\d{8,30}\/?$/i;
const execFileAsync = promisify(execFile);

function tiktokPostMatchesAccount(url, accountHandle) {
  const match = String(url || "").trim().match(exactTikTokPostPattern);
  const expected = String(accountHandle || "").trim().replace(/^@/, "").toLowerCase();
  return Boolean(match && expected && match[1].toLowerCase() === expected);
}

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

function csvValue(value) {
  const text = String(value ?? "");
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function htmlValue(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function buildMetricoolApprovalRows(decision, mediaReadyBySlot = {}) {
  return (decision.assignments || []).map((assignment) => {
    const media = mediaReadyBySlot[assignment.slot] || {};
    const publishingAuthorized = decision.publishingAuthorized === true;
    const status = decision.canProduce !== true
      ? "blocked_campaign"
      : media.ready !== true
        ? "blocked_media_missing"
        : decision.canEnterApprovalQueue !== true
          ? "blocked_payout_setup"
          : publishingAuthorized
            ? "authorized_for_metricool"
            : "approval_required";
    return {
      order: assignment.slot,
      account: decision.accountHandle,
      platform: "tiktok",
      campaignId: decision.campaignId,
      draftFile: media.relativePath || assignment.draftFile,
      strategyId: assignment.strategyId,
      caption: assignment.captionText,
      status,
      publishAllowed: status === "authorized_for_metricool",
    };
  });
}

function metricoolRowsCsv(rows) {
  const columns = ["order", "account", "platform", "campaignId", "draftFile", "strategyId", "caption", "status", "publishAllowed"];
  return `${columns.join(",")}\n${rows.map((row) => columns.map((column) => csvValue(row[column])).join(",")).join("\n")}\n`;
}

function metricoolRowsHtml(decision, rows) {
  const authorizedRows = rows.filter((row) => row.status === "authorized_for_metricool");
  const approvalLabel = authorizedRows.length ? "Authorized" : "Blocked";
  const notice = authorizedRows.length
    ? "Eligible clips may be scheduled through Metricool. Scheduled items are not counted as published until a public TikTok URL is verified."
    : "No clip is published or scheduled. Review and explicit approval are still required.";
  const clips = rows.map((row) => `
    <article class="clip-row">
      <video controls preload="metadata" src="/clippers-workspace/${htmlValue(row.draftFile)}"></video>
      <div class="clip-copy">
        <div class="meta"><span>#${htmlValue(row.order)}</span><span>${htmlValue(row.strategyId)}</span><span>${htmlValue(row.status)}</span></div>
        <h2>${htmlValue(row.caption)}</h2>
        <p>${htmlValue(row.draftFile)}</p>
      </div>
    </article>`).join("");
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Metricool Review Queue</title><style>
*{box-sizing:border-box}body{margin:0;background:#f7f7f5;color:#171717;font-family:Inter,Arial,sans-serif;letter-spacing:0}header{background:#171717;color:#fff;padding:28px max(20px,calc((100vw - 1120px)/2))}header h1{font-size:28px;margin:0 0 8px}header p{margin:0;color:#cfcfc9}.summary{display:flex;gap:20px;flex-wrap:wrap;padding:18px max(20px,calc((100vw - 1120px)/2));border-bottom:1px solid #d9d9d4;background:#fff}.summary strong{display:block;font-size:20px}.summary span{font-size:12px;color:#666}.notice{padding:14px max(20px,calc((100vw - 1120px)/2));background:#fff3cd;color:#5d4600;border-bottom:1px solid #ead58d}main{max-width:1120px;margin:auto}.clip-row{display:grid;grid-template-columns:180px 1fr;gap:24px;padding:24px 20px;border-bottom:1px solid #d9d9d4}.clip-row video{width:180px;aspect-ratio:9/16;background:#000}.clip-copy{align-self:center;min-width:0}.meta{display:flex;gap:8px;flex-wrap:wrap}.meta span{font-size:12px;border:1px solid #bbb;padding:4px 7px;border-radius:4px}.clip-copy h2{font-size:18px;line-height:1.35;margin:14px 0 8px}.clip-copy p{font-size:12px;color:#666;overflow-wrap:anywhere;margin:0}@media(max-width:620px){.clip-row{grid-template-columns:110px 1fr;gap:14px}.clip-row video{width:110px}.clip-copy h2{font-size:15px}}
</style></head><body><header><h1>Metricool Review Queue</h1><p>${htmlValue(decision.title)} · @${htmlValue(decision.accountHandle)}</p></header>
<section class="summary"><div><strong>${rows.length}</strong><span>real clips</span></div><div><strong>${approvalLabel}</strong><span>Metricool mode</span></div><div><strong>${decision.cashoutReady ? "Ready" : "Pending"}</strong><span>Vyro cashout</span></div></section>
<div class="notice">${notice}</div><main>${clips}</main></body></html>`;
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

function metricRowsForCampaign(metrics, campaignId, campaign) {
  return metrics.filter((row) => row.campaignId === campaignId
    && row.finalStatus === "published"
    && tiktokPostMatchesAccount(row.publishedPostUrl, campaign?.accountHandle)
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

function campaignDecision(campaign, metrics, now, publishingAuthorized = false) {
  const productionBlockers = campaignBlockers(campaign, now);
  const paymentBlockers = payoutBlockers(campaign);
  const rows = metricRowsForCampaign(metrics, campaign.id, campaign);
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
    accountHandle: campaign.accountHandle,
    decision,
    priorityScore,
    productionBlockers,
    publishBlockers: productionBlockers,
    cashoutBlockers: paymentBlockers,
    canProduce: productionBlockers.length === 0,
    canEnterApprovalQueue: productionBlockers.length === 0,
    cashoutReady: paymentBlockers.length === 0,
    publishingAuthorized,
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
      : decision === "scale"
          ? `Allocate 70% to ${experiment.winnerStrategyId || experiment.nextStrategyId} and 30% to controlled exploration.`
          : decision === "pause_and_recut"
            ? "Pause this cut style and create materially different hooks before another paid test."
            : paymentBlockers.length
              ? publishingAuthorized
                ? `Validate final media for the next ${experiment.nextStrategyId} test before Metricool scheduling; resolve ${paymentBlockers[0]} before cashout.`
                : `Queue the next ${experiment.nextStrategyId} test for approval; resolve ${paymentBlockers[0]} before cashout.`
              : `Run the next controlled test with ${experiment.nextStrategyId}.`,
  };
}

export function buildStreamerGrowthCeoPlan({
  campaigns = [],
  metrics = [],
  now = new Date(),
  monthlyViewsTarget = 1_000_000,
  publishingAuthorized = false,
  targetDailyClips = 5,
}) {
  const parsedTargetDailyClips = Number(targetDailyClips);
  const safeConfiguredDailyClips = Number.isFinite(parsedTargetDailyClips)
    ? Math.max(5, Math.min(8, Math.trunc(parsedTargetDailyClips)))
    : 5;
  const decisions = campaigns.map((campaign) => campaignDecision(campaign, metrics, now, publishingAuthorized))
    .sort((a, b) => b.priorityScore - a.priorityScore || a.title.localeCompare(b.title));
  const campaignById = new Map(campaigns.map((campaign) => [campaign.id, campaign]));
  const actualPublishedRows = metrics.filter((row) => {
    const campaign = campaignById.get(row.campaignId);
    return row.finalStatus === "published"
      && tiktokPostMatchesAccount(row.publishedPostUrl, campaign?.accountHandle)
      && row.metricEvidenceVerified === true
      && finiteNumber(row.views) !== null;
  });
  const measuredViews = actualPublishedRows.reduce((sum, row) => sum + Number(row.views), 0);
  const measuredEarningsUsd = actualPublishedRows.reduce((sum, row) => sum + (row.payoutEvidenceVerified === true ? (finiteNumber(row.earningsUsd) || 0) : 0), 0);
  const active = decisions.filter((row) => row.canProduce);
  const scaling = decisions.filter((row) => row.decision === "scale");
  const recutting = decisions.some((row) => row.decision === "pause_and_recut");
  const optimizing = decisions.some((row) => row.decision === "optimize");
  const dailyTestClips = !active.length
    ? 0
    : actualPublishedRows.length < 15
      ? 5
      : recutting
        ? 2
        : scaling.length
          ? Math.max(6, safeConfiguredDailyClips)
          : optimizing
            ? 4
            : 5;
  const volumeReason = !active.length
    ? "no_active_campaign"
    : actualPublishedRows.length < 15
      ? "initial_learning_floor"
      : recutting
        ? "reduce_while_recutting"
        : scaling.length
          ? "increase_verified_winners"
          : optimizing
            ? "reduce_for_efficiency"
            : "hold_baseline";
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
      dailyTestClips,
      initialDailyClips: 5,
      minimumInitialDailyClips: 5,
      configuredDailyCeiling: safeConfiguredDailyClips,
      maximumDailyClipsPerAccount: 8,
      volumeReason,
      exploitPercent: scaling.length ? 70 : 0,
      explorePercent: scaling.length ? 30 : 100,
      minimumSamplesBeforeWinner: 3,
      paidSpendAllowed: false,
      publishingAuthorized,
      metricoolApprovalRequired: true,
      realPublishEnabled: false,
    },
    decisions,
    nextBestAction: next?.nextAction || "Add a verified paid campaign with evidence; do not fabricate campaign availability.",
    guardrails: [
      "Campaign authorization is required; creator fame never replaces commercial rights.",
      "Only proof-backed finalStatus=published Metricool rows count as views; earnings require separate payout evidence.",
      "No caption or subtitle winner is declared before three real posts per strategy.",
      "Payout identity and payment method affect cashout readiness, not campaign-source or Metricool approval readiness.",
      publishingAuthorized
        ? "Metricool publishing is authorized only for proof-backed eligible clips on the configured TikTok account."
        : "The CEO may prepare and rank work, but real publishing remains disabled.",
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

export function resolveWorkspaceMediaPath(workspaceRoot, candidate) {
  return path.resolve(workspaceRoot, String(candidate || "").replace(/^\/clippers-workspace\//, ""));
}

export async function validateMetricoolMp4(workspaceRoot, candidate) {
  const resolved = await containedRegularFile(workspaceRoot, resolveWorkspaceMediaPath(workspaceRoot, candidate));
  if (!resolved || path.extname(resolved).toLowerCase() !== ".mp4") return null;
  const fileStats = await lstat(resolved).catch(() => null);
  if (!fileStats || fileStats.size < 1024) return null;
  const probe = await execFileAsync("ffprobe", [
    "-v", "error", "-select_streams", "v:0", "-show_entries", "stream=codec_name,width,height",
    "-of", "json", resolved,
  ], { timeout: 30_000, maxBuffer: 1_000_000 }).catch(() => null);
  if (!probe) return null;
  const stream = JSON.parse(probe.stdout || "{}").streams?.[0];
  return stream?.codec_name && Number(stream.width) > 0 && Number(stream.height) > 0 ? resolved : null;
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
    const campaign = campaigns.find((candidate) => candidate.id === row.campaignId);
    const exactPost = tiktokPostMatchesAccount(row.publishedPostUrl, campaign?.accountHandle);
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
  const publishingAuthorized = process.env.CLIPPERS_METRICOOL_AUTOPUBLISH_AUTHORIZED === "true";
  const targetDailyClips = process.env.CLIPPERS_TARGET_DAILY_CLIPS || 5;
  const plan = buildStreamerGrowthCeoPlan({ campaigns, metrics, publishingAuthorized, targetDailyClips });
  await mkdir(reportDir, { recursive: true });
  for (const decision of plan.decisions) {
    const mediaReadyBySlot = {};
    for (const assignment of decision.assignments || []) {
      const original = resolveWorkspaceMediaPath(workspaceRoot, assignment.draftFile);
      const extension = path.extname(original);
      const finalMedia = assignment.subtitleStyle === "hook_only"
        ? original
        : path.join(path.dirname(original), "subtitled", `${path.basename(original, extension)}-${assignment.subtitleStyle}.mp4`);
      const validatedMedia = await validateMetricoolMp4(workspaceRoot, finalMedia);
      mediaReadyBySlot[assignment.slot] = {
        ready: Boolean(validatedMedia),
        relativePath: validatedMedia ? path.relative(workspaceRoot, validatedMedia) : "",
      };
    }
    const rows = buildMetricoolApprovalRows(decision, mediaReadyBySlot);
    decision.realPublishEnabled = rows.some((row) => row.status === "authorized_for_metricool");
    decision.metricoolApprovalRequired = !decision.realPublishEnabled;
    if (decision.publishingAuthorized && decision.canProduce) {
      decision.nextAction = decision.realPublishEnabled
        ? `Schedule the next eligible ${decision.experiment.nextStrategyId} test in Metricool${decision.cashoutBlockers.length ? `; resolve ${decision.cashoutBlockers[0]} before cashout` : ""}.`
        : `Render and validate final media for the next ${decision.experiment.nextStrategyId} test before scheduling.`;
    }
    const firstDraft = decision.assignments?.[0]?.draftFile;
    if (firstDraft && rows.length) {
      const firstOriginal = await containedRegularFile(workspaceRoot, resolveWorkspaceMediaPath(workspaceRoot, firstDraft));
      const queueDir = firstOriginal ? path.dirname(firstOriginal) : "";
      const rootRelative = queueDir ? path.relative(workspaceRoot, queueDir) : "";
      if (rootRelative && !rootRelative.startsWith("..") && !path.isAbsolute(rootRelative)) {
        await writeFile(path.join(queueDir, "metricool-approval-queue.csv"), metricoolRowsCsv(rows));
        await writeFile(path.join(queueDir, "metricool-approval-queue.html"), metricoolRowsHtml(decision, rows));
      }
    }
  }
  plan.operatingPolicy.realPublishEnabled = plan.decisions.some((decision) => decision.realPublishEnabled);
  plan.operatingPolicy.metricoolApprovalRequired = !plan.operatingPolicy.realPublishEnabled;
  plan.nextBestAction = plan.decisions[0]?.nextAction || plan.nextBestAction;
  await writeFile(path.join(reportDir, "streamer-growth-ceo.json"), `${JSON.stringify(plan, null, 2)}\n`);
  console.log(JSON.stringify(plan, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) await main();
