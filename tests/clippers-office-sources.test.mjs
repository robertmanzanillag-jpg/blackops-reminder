import test from 'node:test';
import assert from 'node:assert/strict';
import { buildClipMetrics, buildCycleReport, cycleReportKey, syncClippersOfficeSources } from '../script/clippers-office-sources.mjs';

const now = Date.parse('2026-11-24T15:00:00.000Z');
const ledger = { posts: [
  { id: 'stc-a', destinationKey: '6431685:tiktok', status: 'scheduled', scheduledAt: '2026-11-24T14:00:00.000Z', observation: { views: 95, likes: 3, comments: 0, shares: 1, saves: 0, observedAt: '2026-11-24T14:30:00Z', publishedAt: '2026-11-23T14:00:00Z' } },
  { id: 'stc-b', destinationKey: '6431687:tiktok', status: 'scheduled', draft: true, scheduledAt: '2026-11-24T16:00:00.000Z', observation: { views: 11, observedAt: '2026-11-24T13:00:00Z' } },
  { id: 'stc-c', status: 'failed', scheduledAt: '2026-11-24T10:00:00.000Z', observation: null },
  { id: 'stc-old', status: 'scheduled', scheduledAt: '2026-11-10T10:00:00.000Z' },
] };

test('metrics only from real observations; unreported engagement is counted', () => {
  const { document, engagementUnreported } = buildClipMetrics(ledger);
  assert.equal(document.records.length, 2);
  assert.equal(document.records[0].views, 95);
  assert.equal(document.records[0].likes, 3);
  assert.equal(engagementUnreported, 1);
  assert.equal(document.generatedAt, '2026-11-24T14:30:00.000Z');
  assert.deepEqual(buildClipMetrics({ posts: [] }).document, { generatedAt: null, records: [] });
});

test('cycle report covers the last 24 h and matches the schema invariants', () => {
  const r = buildCycleReport(ledger, { owner: 'owner-1', now, dailyTargetPosts: 10 });
  assert.match(r.key, /^automation-cycle-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z\.json$/);
  assert.equal(r.key, cycleReportKey(now));
  const a = r.document.automation;
  assert.equal(a.posts.length, a.totals.posts);
  assert.equal(a.totals.posts, 3);
  assert.equal(a.totals.scheduled, 1);
  assert.equal(a.totals.draftReady, 1);
  assert.equal(a.totals.blocked, 1);
  assert.equal(a.totals.gapToDailyTarget, 8);
  assert.equal(a.status, 'partial');
  assert.equal(r.document.userId, 'owner-1');
  assert.equal(buildCycleReport({ posts: [] }, { owner: 'o', now, dailyTargetPosts: 10 }).document.automation.status, 'blocked');
});

test('sync persists both kinds and never throws', async () => {
  const calls = [];
  const prepare = (kind, raw, ctx) => ({ kind, key: ctx.key, status: 'present', document: raw, digest: 'x' });
  const persist = async (db, owner, p) => { calls.push(p.kind); return { written: true }; };
  const out = await syncClippersOfficeSources({ cloudPublish: ledger, owner: 'o', now, dailyTargetPosts: 5, db: {}, prepare, persist });
  assert.deepEqual(calls, ['clip_metrics', 'clip_report']);
  assert.equal(out.clip_metrics, 'written');
  const bad = await syncClippersOfficeSources({ cloudPublish: ledger, owner: 'o', now, dailyTargetPosts: 5, db: {}, prepare, persist: async () => { throw new Error('Canonical owner absent'); } });
  assert.match(bad.clip_report, /^error_/);
  const invalid = await syncClippersOfficeSources({ cloudPublish: ledger, owner: 'o', now, dailyTargetPosts: 5, db: {}, prepare: (k) => ({ kind: k, status: 'invalid' }), persist });
  assert.equal(invalid.clip_metrics, 'not_written_invalid');
});
