// Cloud -> office evidence for Clippers (Mac OFF).
//
// The streamer cloud publisher (clippers-streamer-cloud-worker.mjs) already reconciles Metricool writes, reads
// 24-48 h post analytics and runs the learning loop with its state in Postgres (agent_council_state
// `clippers-streamers:<owner>` -> cloudPublish). Until now only the Replit web process wrote the office source
// documents (clip_metrics / clip_report), and real clips never went through it, so the office role saw
// NO_RECORDS / SOURCE_MISSING. This module projects the cloud ledger into exactly those raw documents; the caller
// persists them with server/office-source-documents.ts (prepare + guarded upsert, same schema as the web mirror).
//
// Honesty rules: only posts with a real Metricool observation become metric records; engagement the provider did
// not report is counted in `engagementUnreported`, never invented beyond the schema's required number (0).
// Pure functions: no I/O, so they run under plain `node --test`.

const HOUR = 3600_000;
const nonNegInt = v => (Number.isSafeInteger(v) && v >= 0 ? v : null);
const ENGAGEMENT = ['likes', 'comments', 'shares', 'saves'];

/** Report key that matches CYCLE_REPORT_NAME in server/office-source-documents.ts. */
export function cycleReportKey(now) {
  return `automation-cycle-${new Date(now).toISOString().replace(/[:.]/g, '-')}.json`;
}

/** Raw clip_metrics document (rawClipMetrics schema) from observed cloud posts. */
export function buildClipMetrics(cloudPublish) {
  const posts = Array.isArray(cloudPublish?.posts) ? cloudPublish.posts : [];
  const records = [];
  let engagementUnreported = 0, generatedAt = null;
  for (const p of posts) {
    const o = p?.observation;
    if (!o || typeof p.id !== 'string' || !p.id || nonNegInt(o.views) === null) continue;
    const observedAt = typeof o.observedAt === 'string' && Number.isFinite(Date.parse(o.observedAt)) ? new Date(Date.parse(o.observedAt)).toISOString() : null;
    if (!observedAt) continue;
    const engagement = Object.fromEntries(ENGAGEMENT.map(k => [k, nonNegInt(o[k])]));
    if (ENGAGEMENT.some(k => engagement[k] === null)) engagementUnreported++;
    records.push({ id: p.id, accountId: String(p.destinationKey || p.destination?.brandId || 'unknown').slice(0, 200), clipId: p.id,
      publishedAt: typeof o.publishedAt === 'string' ? o.publishedAt.slice(0, 500) : null, views: o.views,
      likes: engagement.likes ?? 0, comments: engagement.comments ?? 0, shares: engagement.shares ?? 0, saves: engagement.saves ?? 0 });
    if (!generatedAt || observedAt > generatedAt) generatedAt = observedAt;
  }
  return { document: { generatedAt, records: records.slice(-10000) }, engagementUnreported };
}

const BLOCKED = new Set(['failed', 'blocked', 'held_language', 'language_not_served']);
const BACKLOG = new Set(['pending_write', 'verification_pending', 'deferred', 'staged']);

/** Raw clip_report cycle document (rawClipCycle schema) for the last 24 h of cloud posts. */
export function buildCycleReport(cloudPublish, { owner, now, dailyTargetPosts }) {
  const at = new Date(now).toISOString();
  const posts = (Array.isArray(cloudPublish?.posts) ? cloudPublish.posts : []).filter(p => {
    const t = Date.parse(p?.scheduledAt ?? p?.attemptedAt ?? '');
    return Number.isFinite(t) && t > now - 24 * HOUR && t <= now + 24 * HOUR;
  });
  const count = pred => posts.filter(pred).length;
  const scheduled = count(p => p.status === 'scheduled' && p.draft !== true);
  const draftReady = count(p => p.status === 'scheduled' && p.draft === true);
  const target = Math.max(0, Math.trunc(Number(dailyTargetPosts) || 0));
  const totals = {
    posts: posts.length, dailyTargetPosts: target, weeklyTargetClips: target * 7,
    backlogPosts: count(p => BACKLOG.has(p.status)), gapToDailyTarget: Math.max(0, target - scheduled - draftReady),
    scheduled, readyForManual: draftReady, blocked: count(p => BLOCKED.has(p.status)), draftReady,
    rightsReview: count(p => p.status === 'held_media_review'), needsSource: 0,
  };
  const status = target > 0 && scheduled + draftReady >= target ? 'ready' : scheduled + draftReady > 0 ? 'partial' : 'blocked';
  const id = `streamer-cloud-${at}`;
  return { key: cycleReportKey(now), document: { id, userId: owner, createdAt: at,
    automation: { id, createdAt: at, status, totals, posts: posts.map(p => ({ status: String(p.status ?? 'unknown').slice(0, 40), draft: p.draft === true })) } } };
}

/**
 * Persist both documents. deps.prepare / deps.persist are prepareOfficeSourceDocument / persistOfficeSourceDocument
 * (injected so tests need no database). Never throws: returns codes for the public log.
 */
export async function syncClippersOfficeSources({ cloudPublish, owner, now = Date.now(), dailyTargetPosts, db, prepare, persist }) {
  const writtenAt = new Date(now).toISOString();
  const out = { clip_metrics: null, clip_report: null, records: 0, engagementUnreported: 0 };
  const metrics = buildClipMetrics(cloudPublish);
  out.records = metrics.document.records.length; out.engagementUnreported = metrics.engagementUnreported;
  const report = buildCycleReport(cloudPublish, { owner, now, dailyTargetPosts });
  for (const [kind, raw, key] of [['clip_metrics', metrics.document, ''], ['clip_report', report.document, report.key]]) {
    try {
      const prepared = prepare(kind, raw, { owner, key });
      if (prepared.status !== 'present') { out[kind] = `not_written_${prepared.status}`; continue; }
      const r = await persist(db, owner, prepared, writtenAt, now);
      out[kind] = r.written ? 'written' : 'unchanged';
    } catch (e) { out[kind] = `error_${String(e?.code ?? e?.message ?? 'unknown').replace(/[^A-Za-z0-9_]/g, '_').slice(0, 40)}`; }
  }
  return out;
}
