import { analyzeLearning, type LearningLedger, type LearningMetric } from "./kong-content-learning";
import type { Asset, AssetSelector, Network, SelectionDecision } from "./kong-autopilot-core";

/** Measured selection affects only new local assignments. Explicit test metadata
 * is required; absence of outcomes never implies novelty or a winner. */
export function createLearningSelector(ledger: LearningLedger | undefined, now: Date): AssetSelector {
  const reports = Object.fromEntries((["tiktok", "facebook"] as const).map(network => [network,
    ledger ? (["72h", "7d"] as const).map(h => analyzeLearning(ledger, network, h, now)) : []])) as
    Record<Network, ReturnType<typeof analyzeLearning>[]>;
  return ({ jobId, network, eligible, daily, recent }) => {
    const decision: SelectionDecision = { jobId, network, at: now.toISOString(), mode: "baseline", reason: "no_reliable_recent_evidence" };
    const primary: LearningMetric[] = network === "tiktok"
      ? ["completionRate", "rewatchRate", "shares", "websiteClicks", "profileVisits", "followersGained"]
      : ["websiteClicks", "profileVisits", "followersGained"];
    const matching = (report: ReturnType<typeof analyzeLearning>, asset: Asset) => report.groups.filter(g =>
      g.dimension === "family" && g.value === asset.family || g.dimension === "hookStyle" && g.value === asset.creativeTest?.hookStyle)
      .flatMap(g => g.metrics.map(m => ({ ...m, dimension: g.dimension, value: g.value })));
    // Prefer72h, then7d, but only evidence relevant to this eligible pool.
    const report = reports[network].find(r => eligible.some(a => a.creativeTest && matching(r, a).some(m => m.signal !== "insufficient_evidence")));
    const baseline = (reason: string) => ({ asset: eligible[0], decision: { ...decision, reason, assetId: eligible[0]?.id } });
    if (!eligible.some(a => a.creativeTest)) return baseline("explicit_test_metadata_missing");
    if (!report) return baseline("no_reliable_recent_evidence");
    if (eligible.some(a => a.creativeTest?.kind === "baseline") || daily.some(j => j.asset.creativeTest?.kind === "baseline"))
      return baseline("baseline_supply_not_a_controlled_optimization_pool");
    // Mixing an unclassified existing day into a40/60 claim would be misleading.
    if (daily.some(j => !j.asset.creativeTest)) return baseline("existing_day_has_unclassified_tests");
    const usedSources = new Set(recent.flatMap(j => j.asset.creativeTest?.sourceIds || []));
    const pool = eligible.filter(a => a.creativeTest && !a.creativeTest.sourceIds.some(id => usedSources.has(id)));
    const explored = daily.filter(j => j.asset.creativeTest?.kind === "exploration").length;
    const variants = daily.filter(j => j.asset.creativeTest?.kind === "variation").length;
    const needExplore = explored < Math.ceil((daily.length + 1) * .4);
    const supported = pool.filter(a => a.creativeTest!.kind === "variation" && !matching(report, a).some(m => primary.includes(m.metric) && m.signal === "weak")
      && matching(report, a).some(m => m.signal === "promising"));
    const score = (a: Asset) => Math.max(...matching(report, a).filter(m => m.signal === "promising").map(m => m.ratio || 0));
    supported.sort((a, b) => score(b) - score(a) || a.id.localeCompare(b.id));
    const exploration = pool.find(a => a.creativeTest!.kind === "exploration");
    const asset = needExplore ? exploration : (variants < 3 ? supported[0] : undefined) || exploration;
    if (!asset) return { decision: { ...decision, mode: "gap", horizon: report.horizon as "72h" | "7d", reason: needExplore ? "explicit_exploration_supply_missing" : "supported_distinct_supply_missing" } };
    const kind = asset.creativeTest!.kind;
    return { asset, decision: { ...decision, assetId: asset.id, mode: kind, horizon: report.horizon as "72h" | "7d",
      reason: kind === "exploration" ? "explicit_controlled_test_reserved" : "descriptive_supported_variation_no_weak_primary_outcome",
      evidence: kind === "variation" ? matching(report, asset).filter(m => m.signal === "promising").slice(0, 8).map(m => ({
        dimension: m.dimension, value: m.value, metric: m.metric, ratio: m.ratio!, count: m.count, referenceCount: m.referenceCount })) : [] } };
  };
}
