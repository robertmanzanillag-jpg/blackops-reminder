// Fair per-destination daily queue: one series must not monopolize the 5/day cap for days.
//
// A "series" is a recurring caption family on one account (e.g. the manual "Serie educativa" NASA/SDO batch
// created 2026-11-22 on @news305miami). Streamer clips are their own series. This module only decides FUTURE
// allocation from rows already in the calendar; it never deletes, cancels or moves an existing post.

export const STREAMER_SERIES = 'streamer_clip';
/** Per-series share of a day's cap; with cap 5 a single series gets at most 3 slots, leaving 2 for the mix. */
export const SERIES_DAILY_SHARE = 0.6;

const norm = text => String(text ?? '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** Stable series key from a caption (first line before a separator, or a known series marker). */
export function seriesKeyOf(text) {
  const t = norm(text);
  const marker = /(serie\s+educativa|textos?\s+explicativos?)/.exec(t);
  if (marker) return 'serie_educativa';
  if (/(twitch\.tv|kick\.com)\//.test(t)) return STREAMER_SERIES;
  const head = t.split(/\r?\n/).map(l => l.trim()).find(Boolean) ?? '';
  const prefix = head.split(/\s[|·—–:-]\s|\s#\d+|\(\d+\/\d+\)|\bparte\s+\d+|\bpart\s+\d+/)[0].replace(/[^a-z0-9 ]+/g, ' ').trim().split(/\s+/).slice(0, 4).join('_');
  return prefix ? `caption:${prefix}` : 'unknown';
}

export function seriesDailyQuota(cap, share = SERIES_DAILY_SHARE) {
  if (!Number.isSafeInteger(cap) || cap < 1) return 0;
  return Math.max(1, Math.min(cap, Math.ceil(cap * share)));
}

/**
 * Decide whether one more post of `series` fits this day.
 * rows: [{ text, series? }] already counted against the cap (scheduled/pending/published, excl. nonpublishing drafts).
 * Returns { ok, reason, counts, quota, monopolizedBy }.
 */
export function fairSlotDecision({ rows = [], cap, series, share = SERIES_DAILY_SHARE }) {
  const quota = seriesDailyQuota(cap, share);
  const counts = {};
  for (const row of rows) { const k = row?.series ?? seriesKeyOf(row?.text); counts[k] = (counts[k] ?? 0) + 1; }
  const monopolizedBy = Object.entries(counts).find(([, n]) => n > quota)?.[0] ?? null;
  if (rows.length >= cap) return { ok: false, reason: monopolizedBy ? `series_monopoly:${monopolizedBy}` : 'daily_cap', counts, quota, monopolizedBy };
  if ((counts[series] ?? 0) >= quota) return { ok: false, reason: 'series_quota', counts, quota, monopolizedBy };
  return { ok: true, reason: null, counts, quota, monopolizedBy };
}

/**
 * Plan a mixed day: candidates [{ id, series, score }] (higher score first) -> picked ids within cap,
 * each series capped at its quota, round-robin across series so the mix is preferred over a single series.
 */
export function planFairDay({ candidates = [], existing = [], cap, share = SERIES_DAILY_SHARE }) {
  const quota = seriesDailyQuota(cap, share);
  const used = {};
  for (const row of existing) { const k = row?.series ?? seriesKeyOf(row?.text); used[k] = (used[k] ?? 0) + 1; }
  let free = Math.max(0, cap - existing.length);
  const bySeries = new Map();
  for (const c of [...candidates].sort((a, b) => (b.score ?? 0) - (a.score ?? 0))) {
    if (!bySeries.has(c.series)) bySeries.set(c.series, []);
    bySeries.get(c.series).push(c);
  }
  // Best-performing series first (its best candidate's score), then round-robin.
  const order = [...bySeries.keys()].sort((a, b) => (bySeries.get(b)[0].score ?? 0) - (bySeries.get(a)[0].score ?? 0));
  const picked = [];
  let progressed = true;
  while (free > 0 && progressed) {
    progressed = false;
    for (const s of order) {
      if (free <= 0) break;
      const queue = bySeries.get(s);
      if (!queue.length || (used[s] ?? 0) >= quota) continue;
      picked.push(queue.shift().id); used[s] = (used[s] ?? 0) + 1; free--; progressed = true;
    }
  }
  return { picked, quota, used };
}

/** Per-series performance from account analytics posts [{ text|caption, views }] (provider numbers only). */
export function seriesPerformance(posts = []) {
  const groups = {};
  for (const p of posts) {
    if (!Number.isSafeInteger(p?.views) || p.views < 0) continue;
    const k = seriesKeyOf(p.text ?? p.caption ?? p.title ?? '');
    (groups[k] ??= []).push(p.views);
  }
  const out = {};
  for (const [k, v] of Object.entries(groups)) {
    const s = [...v].sort((a, b) => a - b), m = Math.floor(s.length / 2);
    out[k] = { posts: s.length, medianViews: s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2, totalViews: s.reduce((a, b) => a + b, 0) };
  }
  return out;
}
