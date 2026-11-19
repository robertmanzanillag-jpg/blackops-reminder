import test from 'node:test';
import assert from 'node:assert/strict';
import { applyStreamerOverlay, streamerStatusView, registerClippersStreamerRoutes } from '../server/clippers-streamers-status';
import { localNewsSenderRetired, deliverClipperLocalNewsToMetricool, LOCAL_NEWS_SENDER_RETIRED_REASON } from '../server/clippers-local-news-metricool';

const AT = Date.parse('2026-11-19T15:00:00.000Z');
const role = (stage: string) => ({ id: `clippers-${stage}`, stage, state: 'idle', evidenceAt: null, activeUntil: null, lastRunAt: null, heartbeatAt: null, nextDueAt: null, runId: null, evidenceIds: [], outputs: {}, heldReasons: [], lifePenaltyExempt: false, career: {} });
const stateWith = (lastRun: any, extra: any = {}) => JSON.stringify({ version: 1, updatedAt: null, lastRun, creators: {}, takedowns: [], candidates: [], signals: [], ...extra });

test('office Streamers role shows the cloud job state and missing-secret reason', () => {
  const report: any = { roles: [role('streamers'), role('editor')] };
  applyStreamerOverlay(report, stateWith({ at: '2026-11-19T14:30:00.000Z', status: 'skipped_missing_secrets', heldReasons: ['missing_secret:TWITCH_CLIENT_ID'], errors: [], counts: { candidates: 0 } }), AT);
  const r = report.roles[0];
  assert.equal(r.state, 'held'); assert.ok(r.heldReasons.includes('missing_secret:TWITCH_CLIENT_ID')); assert.equal(r.outputs.cloud_candidates, 0);
  assert.equal(report.roles[1].state, 'idle');
  const ok: any = { roles: [role('streamers')] };
  applyStreamerOverlay(ok, stateWith({ at: '2026-11-19T14:30:00.000Z', status: 'completed', heldReasons: [], errors: [], counts: { candidates: 4 } }), AT);
  assert.equal(ok.roles[0].state, 'completed');
  const stale: any = { roles: [role('streamers')] };
  applyStreamerOverlay(stale, stateWith({ at: '2026-11-19T05:00:00.000Z', status: 'completed', heldReasons: [], errors: [], counts: {} }), AT);
  assert.equal(stale.roles[0].state, 'stale');
  const none: any = { roles: [role('streamers')] };
  applyStreamerOverlay(none, null, AT); assert.equal(none.roles[0].state, 'idle');
});

test('owner-only status and takedown routes; takedown blocks the creator and sets a 24h SLA', async () => {
  const data = new Map<string, string>();
  data.set('clippers-streamers:o', stateWith(null, { candidates: [{ id: 'twitch-clip:a', creatorKey: 'twitch:1', clipPolicy: { status: 'allowed_unless_prohibited' }, approval: { status: 'pending' }, download: { mode: 'needs_local_download' } }] }));
  const store = { read: async (k: string) => data.get(k) ?? null, transact: async (k: string, fn: (raw: string | null) => Promise<string>) => { const v = await fn(data.get(k) ?? null); data.set(k, v); return v; } };
  const routes: Record<string, Function> = {};
  let owner = true;
  registerClippersStreamerRoutes({ get: (p: string, h: Function) => { routes['GET ' + p] = h; }, post: (p: string, h: Function) => { routes['POST ' + p] = h; } } as any,
    { isOwner: () => owner, store: async () => store, owner: () => 'o', now: () => AT });
  const call = async (key: string, body?: any) => { const out: any = { code: 200 }; const res: any = { set() {}, status(c: number) { out.code = c; return res; }, json(b: any) { out.body = b; return res; } }; await routes[key]({ body }, res); return out; };
  owner = false; assert.equal((await call('GET /api/clippers/streamers/status')).code, 403); owner = true;
  assert.equal((await call('POST /api/clippers/streamers/takedown', { reason: '' })).code, 400);
  const t = await call('POST /api/clippers/streamers/takedown', { creatorKey: 'twitch:1', reason: 'creator asked by DM' });
  assert.equal(t.body.removeBy, '2026-11-20T15:00:00.000Z');
  const s = await call('GET /api/clippers/streamers/status');
  assert.equal(s.body.candidates[0].clipPolicy, 'prohibited'); assert.equal(s.body.safety.publishesHere, false);
  assert.equal(streamerStatusView(data.get('clippers-streamers:o')!, AT + 25 * 3600_000).takedowns[0].overdue, true);
});

test('local-news sender is retired for the repurposed brands unless explicitly re-enabled', async () => {
  assert.equal(localNewsSenderRetired({}), true);
  assert.equal(localNewsSenderRetired({ CLIPPERS_LOCAL_NEWS_SENDER_ENABLED: 'true' }), false);
  const r = await deliverClipperLocalNewsToMetricool({ env: { METRICOOL_USER_TOKEN: 'real-token', METRICOOL_USER_ID: '123' }, readPolicy: async () => ({ paused: false, reason: '', destinations: {} }) as any,
    fetch: async () => { throw new Error('no network'); } } as any);
  assert.equal(r.status, 'paused'); assert.equal(r.reason, LOCAL_NEWS_SENDER_RETIRED_REASON);
});
