import type { Express, Request } from 'express';
import type { ClippersOrchestraStatus } from '../shared/clippers-orchestra';
import { parseTakedown } from '../shared/clippers-streamer-policy.mjs';
import { STREAMER_STATE_NAMESPACE, parseStreamerState, localWorkQueue } from '../script/clippers-streamer-discovery.mjs';
import { getCurrentUserId, getSystemUserId } from './user-context';

/** Store shape shared with the orchestra state (agent_council_state via the council store). */
interface Store { read(owner: string): Promise<string | null>; transact(owner: string, update: (raw: string | null) => Promise<string>): Promise<string> }
const CODE = /^[a-zA-Z0-9_.:-]{1,200}$/;
const STALE_MS = 3 * 3600_000;

/**
 * The cloud streamer job reports into the existing orchestra "Streamers" role, so the office shows
 * its real state (working / completed / held with reason, e.g. missing_secret:TWITCH_CLIENT_ID).
 */
export function applyStreamerOverlay(report: ClippersOrchestraStatus, raw: string | null, at: number): ClippersOrchestraStatus {
  const state = parseStreamerState(raw), run = state.lastRun;
  if (!run) return report;
  const role = report.roles.find(r => r.stage === 'streamers');
  if (!role) return report;
  const held = [...(run.heldReasons ?? []), ...(run.errors ?? []).map((e: string) => `streamer_cloud_error:${e}`)].filter(c => CODE.test(c));
  const age = at - Date.parse(run.at);
  role.lastRunAt = run.at;
  role.heldReasons = [...new Set([...role.heldReasons, ...held, ...(age > STALE_MS ? ['streamer_cloud_run_stale'] : [])])].slice(0, 100);
  role.state = run.status === 'failed' || run.status === 'skipped_missing_secrets' ? 'held' : age > STALE_MS ? 'stale' : run.status === 'completed' && !held.length ? 'completed' : 'held';
  for (const [k, v] of Object.entries(run.counts ?? {})) if (CODE.test(`cloud_${k}`) && Number.isSafeInteger(v) && (v as number) >= 0 && Object.keys(role.outputs).length < 20) role.outputs[`cloud_${k}`] = v as number;
  return report;
}

/** Owner-only summary of the streamer-pages lane (counts, top candidates, policies, takedowns). */
export function streamerStatusView(raw: string | null, at = Date.now()) {
  const s = parseStreamerState(raw);
  return {
    lastRun: s.lastRun, cityPages: s.cityPages ?? [],
    candidates: s.candidates.slice(0, 30).map((c: any) => ({ id: c.id, platform: c.platform, handle: c.handle, title: c.title, sourceUrl: c.sourceUrl, score: c.score,
      durationSec: c.durationSec ?? null, clipPolicy: c.clipPolicy?.status, policySource: c.clipPolicy?.source, approval: c.approval?.status, pendingActionId: c.approval?.pendingActionId ?? null, download: c.download?.mode })),
    prohibitedCreators: Object.values(s.creators).filter((c: any) => c.policy?.status === 'prohibited').map((c: any) => ({ key: c.key, handle: c.handle, source: c.policy.source, evidence: c.policy.evidence })),
    liveSignals: s.signals.slice(0, 10).map((x: any) => ({ handle: x.handle, platform: x.platform, title: x.title, views: x.views, sourceUrl: x.sourceUrl })),
    takedowns: s.takedowns.map((t: any) => ({ ...t, overdue: !t.removedAt && Date.parse(t.removeBy) < at })),
    macQueue: localWorkQueue(s).length,
    safety: { publishesHere: false, requiresOwnerApproval: true, creditRequired: true, maxClipSeconds: 60, takedownSlaHours: 24 },
  };
}

export function registerClippersStreamerRoutes(app: Pick<Express, 'get' | 'post'>, options: { isOwner?: (req: Request) => boolean; store?: () => Promise<Store>; owner?: () => string; now?: () => number } = {}) {
  const isOwner = options.isOwner ?? ((req: Request) => getCurrentUserId(req) === getSystemUserId());
  const store = options.store ?? (async () => (await import('./agent-council-store')).getCouncilStore());
  const owner = options.owner ?? getSystemUserId;
  const now = options.now ?? Date.now;
  const guard = (req: Request, res: any) => { res.set('Cache-Control', 'private, no-store, max-age=0'); try { if (!isOwner(req)) { res.status(403).json({ error: 'CLIPPERS_OWNER_REQUIRED' }); return false; } } catch { res.status(401).json({ error: 'CLIPPERS_AUTH_REQUIRED' }); return false; } return true; };
  app.get('/api/clippers/streamers/status', async (req, res) => {
    if (!guard(req, res)) return;
    try { res.json(streamerStatusView(await (await store()).read(STREAMER_STATE_NAMESPACE(owner())), now())); }
    catch { res.status(503).json({ error: 'CLIPPERS_STREAMERS_UNAVAILABLE' }); }
  });
  // Takedown: blocks a creator or clip forever; the owner removes any live post within 24h (Metricool UI).
  app.post('/api/clippers/streamers/takedown', async (req, res) => {
    if (!guard(req, res)) return;
    const at = now();
    const entry = parseTakedown({ ...(req.body ?? {}), receivedAt: req.body?.receivedAt ?? new Date(at).toISOString(), removedAt: req.body?.removedAt ?? null }, at);
    if (!entry) return res.status(400).json({ error: 'CLIPPERS_TAKEDOWN_INVALID' });
    try {
      await (await store()).transact(STREAMER_STATE_NAMESPACE(owner()), async raw => {
        const s = parseStreamerState(raw);
        s.takedowns = [...s.takedowns, entry].slice(-500);
        for (const c of s.candidates) if ((entry.candidateId && c.id === entry.candidateId) || (entry.creatorKey && c.creatorKey === entry.creatorKey) ||
          (entry.creatorGroupId && s.creators[c.creatorKey]?.creatorGroupId === entry.creatorGroupId)) c.clipPolicy = { status: 'prohibited', source: 'takedown', evidence: { reason: entry.reason, receivedAt: entry.receivedAt }, checkedAt: entry.receivedAt };
        return JSON.stringify(s);
      });
      res.json({ recorded: true, removeBy: entry.removeBy });
    } catch { res.status(503).json({ error: 'CLIPPERS_STREAMERS_UNAVAILABLE' }); }
  });
}
