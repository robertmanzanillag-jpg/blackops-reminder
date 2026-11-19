// Minimal, deterministic ($0) learning loop for the cloud streamer publisher.
//
// Input: the publisher's own post ledger (state.cloudPublish.posts) with Metricool post analytics
// observations taken 24-48 h after the scheduled time (createPortfolioMetricool().publication/.metrics).
// Output, applied on the next run:
//   - hook variant per clip ("title" vs "teaser"): an A/B test per destination evaluated with the
//     existing evaluator (script/clippers-content-learning-ceo.mjs evaluateExperiments: >= 5 samples per
//     arm, >= 20 % median-views lift, no > 10 % completion regression). A supported winner is used
//     80 % of the time; 20 % keeps exploring. No winner: deterministic 50/50 split.
//   - creator boost for selection order: log2 of the creator's median views relative to the
//     destination median (>= 3 observed posts), clamped to [-1, 1].
import { createHash } from 'node:crypto';
import { evaluateExperiments } from './clippers-content-learning-ceo.mjs';
import { canonicalDestinationKey } from './clippers-portfolio-metricool.mjs';

export const HOOK_VARIANTS = Object.freeze(['title', 'teaser']);
export const OBSERVATION_WINDOW = Object.freeze({ minHours: 24, maxHours: 48 });
export const LEARNING_POLICY = Object.freeze({ minimumSamplesPerVariant: 5, minimumWinnerLift: 0.2, exploitShare: 0.8, creatorMinSamples: 3 });

const median = values => {
  const s = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!s.length) return null;
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const bucket = (seed) => parseInt(createHash('sha256').update(String(seed)).digest('hex').slice(0, 8), 16) / 0xffffffff;

/** Posts whose observation is usable for comparison (same 24-48 h window, real views). */
export function observedPosts(posts = []) {
  return posts.filter(p => p?.observation && Number.isSafeInteger(p.observation.views) && p.observation.views >= 0 &&
    Number.isFinite(p.observation.ageHours) && p.observation.ageHours >= OBSERVATION_WINDOW.minHours && p.observation.ageHours < OBSERVATION_WINDOW.maxHours &&
    HOOK_VARIANTS.includes(p.hookVariant) && typeof p.destinationKey === 'string');
}

export function computeLearning(posts = [], { now = Date.now(), policy = LEARNING_POLICY } = {}) {
  // Legacy account aliases group with their current destination.
  const usable = observedPosts(posts).map(p => ({ ...p, destinationKey: canonicalDestinationKey(p.destinationKey) }));
  const rows = usable.map(p => ({
    usable: true, experimentId: `streamer-hook:${p.destinationKey}`, experimentVariable: 'hook', experimentVariant: p.hookVariant,
    account: p.destinationKey, lane: 'streamer_clip', language: p.language ?? 'es', windowHours: 24,
    views: p.observation.views, completionRate: Number.isFinite(p.observation.completionRate) ? p.observation.completionRate : null,
  }));
  const experiments = evaluateExperiments(rows, { minimumSamplesPerVariant: policy.minimumSamplesPerVariant, minimumWinnerLift: policy.minimumWinnerLift });
  const hookPreference = {};
  for (const e of experiments) hookPreference[e.experimentId.slice('streamer-hook:'.length)] = e.winner;
  // Creator boost relative to each destination's median.
  const destMedian = new Map();
  for (const key of new Set(usable.map(p => p.destinationKey))) destMedian.set(key, median(usable.filter(p => p.destinationKey === key).map(p => p.observation.views)));
  const ratios = new Map();
  for (const p of usable) {
    const base = destMedian.get(p.destinationKey);
    if (!p.creatorKey || !base) continue;
    ratios.set(p.creatorKey, [...(ratios.get(p.creatorKey) ?? []), p.observation.views / base]);
  }
  const creatorBoost = {};
  for (const [key, list] of ratios) {
    if (list.length < policy.creatorMinSamples) continue;
    const m = median(list);
    creatorBoost[key] = m > 0 ? Math.max(-1, Math.min(1, Math.round(Math.log2(m) * 1000) / 1000)) : -1;
  }
  return { evaluatedAt: new Date(now).toISOString(), samples: usable.length, experiments, hookPreference, creatorBoost, policy: { ...policy } };
}

/** One hook per clip (the text is burned into the video, shared by every destination). */
export function chooseHookVariant(learning, candidateId, policy = LEARNING_POLICY) {
  const winners = Object.values(learning?.hookPreference ?? {}).filter(v => HOOK_VARIANTS.includes(v));
  const r = bucket(`hook:${candidateId}`);
  if (winners.length) {
    const counts = HOOK_VARIANTS.map(v => [v, winners.filter(w => w === v).length]).sort((a, b) => b[1] - a[1]);
    if (counts[0][1] > counts[1][1]) {
      const best = counts[0][0];
      return { variant: r < policy.exploitShare ? best : HOOK_VARIANTS.find(v => v !== best), mode: r < policy.exploitShare ? 'exploit' : 'explore' };
    }
  }
  return { variant: r < 0.5 ? 'title' : 'teaser', mode: 'ab_test' };
}

export function creatorBoostFor(learning, creatorKey) {
  const v = learning?.creatorBoost?.[creatorKey];
  return Number.isFinite(v) ? v : 0;
}
