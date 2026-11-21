import { z } from "zod";
import { families, networks, type Network } from "./kong-autopilot-core";

export const learningMetrics = ["views", "reach", "completionRate", "rewatchRate", "shares", "saves", "comments", "profileVisits", "websiteClicks", "followersGained"] as const;
export type LearningMetric = typeof learningMetrics[number];
export type Horizon = "24h" | "72h" | "7d";
const windows: Record<Horizon, [number, number]> = { "24h": [24, 26], "72h": [72, 78], "7d": [168, 180] };
const count = z.number().finite().int().nonnegative().nullable().optional();
export const observationSchema = z.object({
  network: z.enum(networks), postId: z.string().min(1).max(200),
  sourceUrl: z.string().url(), publishedAt: z.string().datetime({ offset: true }), observedAt: z.string().datetime({ offset: true }),
  family: z.enum(families), hookStyle: z.string().trim().min(1).max(100),
  metrics: z.object({ views: count, reach: count, shares: count, saves: count, comments: count,
    profileVisits: count, websiteClicks: count, followersGained: count,
    completionRate: z.number().finite().min(0).max(1).nullable().optional(),
    rewatchRate: z.number().finite().min(0).nullable().optional() }).strict(),
}).strict().refine(o => Date.parse(o.observedAt) >= Date.parse(o.publishedAt), "observation_before_publication");
export type Observation = z.infer<typeof observationSchema>;
export interface LearningLedger { version: 1; observations: Observation[]; }
export const emptyLearningLedger = (): LearningLedger => ({ version: 1, observations: [] });
const identity = (o: Observation) => `${o.network}:${o.postId}:${new Date(o.observedAt).toISOString()}`;
const metadata = (o: Observation) => JSON.stringify([o.network, o.postId, new Date(o.publishedAt).toISOString(), o.family, o.hookStyle]);
function canonical(o: Observation) {
  return JSON.stringify([metadata(o), o.sourceUrl, ...learningMetrics.map(m => o.metrics[m] ?? null)]);
}

/** Pure ingestion; caller persists returned ledger atomically alongside job state.
 * Missing/null values stay missing; a measured zero is valid evidence. The source
 * adapter must map actual provider metrics, never infer attribution from views. */
export function ingestLearning(ledger: LearningLedger, rows: unknown[], now: Date) {
  if (ledger.version !== 1) throw Error("unsupported_learning_ledger_version");
  const observations = [...ledger.observations];
  const rejected: { index: number; reason: string }[] = [];
  let added = 0, duplicates = 0;
  for (const [index, raw] of rows.entries()) {
    const parsed = observationSchema.safeParse(raw);
    if (!parsed.success) { rejected.push({ index, reason: "invalid_observation" }); continue; }
    const row = parsed.data;
    if (Date.parse(row.observedAt) > +now) { rejected.push({ index, reason: "future_observation" }); continue; }
    const previous = observations.find(o => o.network === row.network && o.postId === row.postId);
    if (previous && metadata(previous) !== metadata(row)) { rejected.push({ index, reason: "post_metadata_conflict" }); continue; }
    const duplicate = observations.find(o => identity(o) === identity(row));
    if (duplicate) {
      if (canonical(duplicate) !== canonical(row)) rejected.push({ index, reason: "snapshot_conflict" });
      else duplicates++;
      continue;
    }
    observations.push(row); added++;
  }
  return { ledger: { version: 1 as const, observations }, added, duplicates, rejected };
}

/** One nearest-to-target snapshot per post. Late lifetime totals cannot be
 * retroactively called 24h data. Networks and horizons never pool together. */
export function cohort(ledger: LearningLedger, network: Network, horizon: Horizon, now: Date): Observation[] {
  const [minimum, maximum] = windows[horizon];
  const selected = new Map<string, Observation>();
  for (const row of ledger.observations) {
    const published = Date.parse(row.publishedAt), observed = Date.parse(row.observedAt);
    const hours = (observed - published) / 3600_000;
    if (row.network !== network || observed > +now || published < +now - 28 * 86400_000 || hours < minimum || hours > maximum) continue;
    const existing = selected.get(row.postId);
    if (!existing || observed < Date.parse(existing.observedAt)) selected.set(row.postId, row);
  }
  return [...selected.values()].sort((a, b) => a.postId.localeCompare(b.postId));
}
export function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b), middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}
export type Signal = "promising" | "neutral" | "weak" | "insufficient_evidence";
export interface MetricEvidence { metric: LearningMetric; count: number; referenceCount: number; median: number | null;
  referenceMedian: number | null; ratio: number | null; signal: Signal; reason?: string; }
export interface GroupEvidence { dimension: "family" | "hookStyle"; value: string; postIds: string[]; metrics: MetricEvidence[]; }
const priorities: Record<Network, LearningMetric[]> = {
  tiktok: ["completionRate", "rewatchRate", "shares", "views", "profileVisits", "websiteClicks", "followersGained"],
  facebook: ["websiteClicks", "profileVisits", "reach", "views", "shares", "followersGained"],
};
function values(rows: Observation[], metric: LearningMetric) {
  return rows.flatMap(row => {
    const value = row.metrics[metric];
    if (value == null) return [];
    // Avoid drawing retention conclusions from tiny/no-exposure samples.
    if (["completionRate", "rewatchRate"].includes(metric) && (row.metrics.views == null || row.metrics.views < 100)) return [];
    return [value];
  });
}
export function analyzeLearning(ledger: LearningLedger, network: Network, horizon: Horizon, now: Date) {
  const rows = cohort(ledger, network, horizon, now);
  const groups: GroupEvidence[] = [];
  for (const dimension of ["family", "hookStyle"] as const) for (const value of [...new Set(rows.map(r => r[dimension]))].sort()) {
    const members = rows.filter(r => r[dimension] === value);
    const reference = rows.filter(r => r[dimension] !== value);
    const metrics = priorities[network].map((metric): MetricEvidence => {
      const sample = values(members, metric), baseline = values(reference, metric);
      const m = median(sample), b = median(baseline);
      const base = { metric, count: sample.length, referenceCount: baseline.length, median: m, referenceMedian: b };
      if (sample.length < 3 || baseline.length < 5) return { ...base, ratio: null, signal: "insufficient_evidence", reason: "need_3_group_and_5_other_posts" };
      if (b === 0 || b == null || m == null) return { ...base, ratio: null, signal: "insufficient_evidence", reason: "zero_or_missing_reference" };
      const ratio = m / b;
      return { ...base, ratio, signal: ratio >= 1.25 ? "promising" : ratio <= .75 ? "weak" : "neutral" };
    });
    groups.push({ dimension, value, postIds: members.map(r => r.postId), metrics });
  }
  return { network, horizon, asOf: now.toISOString(), sampleCount: rows.length, groups,
    distributionChecks: rows.filter(r => r.metrics.views === 0).map(r => r.postId),
    missingViews: rows.filter(r => r.metrics.views == null).map(r => r.postId),
    interpretation: "Descriptive associations only; no causal winner claims. Views do not establish site clicks or follower attribution.",
    sampling: { targetHours: windows[horizon][0], latestHours: windows[horizon][1], lookbackDays: 28 } };
}

export interface CreativeCandidate { id: string; network: Network; family: string; hookStyle: string; hook: string; sourceId: string; isNewConcept: boolean; }
/** Recommendations only; no public post edits. At least ceil(40% * requested)
 * slots reserved for new concepts. Returns gaps rather than relaxing diversity. */
export function recommendCreativeMix(candidates: CreativeCandidate[], report: ReturnType<typeof analyzeLearning>, requested = 5,
  recent: { hooks: string[]; sourceIds: string[]; lastFamily?: string } = { hooks: [], sourceIds: [] }) {
  if (!Number.isInteger(requested) || requested < 1 || requested > 20) throw Error("invalid_requested_count");
  const explorationTarget = Math.ceil(requested * .4);
  const selected: { candidate: CreativeCandidate; purpose: "exploration" | "variation"; evidence: MetricEvidence[] }[] = [];
  const hooks = new Set(recent.hooks.map(h => h.trim().toLowerCase())), sources = new Set(recent.sourceIds);
  const matchingMetrics = (c: CreativeCandidate) => report.groups.filter(g => g.dimension === "family" && g.value === c.family
    || g.dimension === "hookStyle" && g.value === c.hookStyle).flatMap(g => g.metrics);
  // A reach/engagement win cannot compensate for measured traffic or follower
  // loss. Evaluate all matching dimensions so a strong hook cannot hide a weak
  // family outcome. Missing primary outcomes do not count as measured losses.
  const primaryOutcomes: LearningMetric[] = report.network === "tiktok"
    ? ["completionRate", "rewatchRate", "websiteClicks", "profileVisits", "followersGained"]
    : ["websiteClicks", "profileVisits", "followersGained"];
  const conflicts = (c: CreativeCandidate) => matchingMetrics(c).filter(m => primaryOutcomes.includes(m.metric) && m.signal === "weak");
  const evidence = (c: CreativeCandidate) => conflicts(c).length ? [] : matchingMetrics(c).filter(m => m.signal === "promising");
  const eligible = (c: CreativeCandidate) => c.network === report.network && !selected.some(s => s.candidate.id === c.id)
    && !hooks.has(c.hook.trim().toLowerCase()) && !sources.has(c.sourceId)
    && selected.filter(s => s.candidate.family === c.family).length < 2
    && c.family !== (selected.at(-1)?.candidate.family ?? recent.lastFamily);
  for (let i = 0; i < requested; i++) {
    // Alternate exploration slots to avoid grouping all experimental pieces.
    const needExplore = selected.filter(s => s.purpose === "exploration").length < explorationTarget;
    const remaining = requested - i;
    const required = explorationTarget - selected.filter(s => s.purpose === "exploration").length;
    const exploreNow = needExplore && (i % 2 === 0 || remaining <= required);
    const pool = candidates.filter(eligible);
    let candidate = exploreNow ? pool.find(c => c.isNewConcept) : pool.find(c => !c.isNewConcept && evidence(c).length);
    // Without supported variations, spend slots on genuinely new concepts.
    candidate ||= pool.find(c => c.isNewConcept);
    if (!candidate) continue;
    if (!candidate.isNewConcept && selected.filter(s => s.purpose === "exploration").length < Math.ceil((selected.length + 1) * .4)) continue;
    const purpose = candidate.isNewConcept ? "exploration" as const : "variation" as const;
    selected.push({ candidate, purpose, evidence: purpose === "variation" ? evidence(candidate) : [] });
    hooks.add(candidate.hook.trim().toLowerCase()); sources.add(candidate.sourceId);
  }
  return { network: report.network, selected, requested, missing: requested - selected.length, explorationTarget,
    explorationSelected: selected.filter(s => s.purpose === "exploration").length,
    blockedVariations: candidates.filter(c => c.network === report.network && !c.isNewConcept && conflicts(c).length)
      .map(c => ({ candidateId: c.id, reason: "weak_primary_outcome_requires_new_test", evidence: conflicts(c) })),
    instruction: "Change one principal variable per test; use new footage and hook text when varying a supported structure. Recheck rights and current offers before publication." };
}
