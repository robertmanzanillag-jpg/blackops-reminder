import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  CLOUD_LANES_NAMESPACE, CLOUD_WORKSPACE_NAMESPACE, LANE_LEASE_MS, acquireLane, emptyLanesState, laneView, parseLanesState, recordLaneRun, retireMacLanes,
} from '../shared/clippers-cloud-lanes.mjs';
import { WORKSPACE_TOKEN, planHydration, planPersist, textOverlay } from '../script/clippers-drive-workspace.mjs';
import { macLaneGate, missingSecrets, retireMac, runCloudJob, seedWorkspace, skipByInterval, youtubeEnv } from '../script/clippers-cloud-lanes.mjs';

const NOW = Date.parse('2026-11-20T09:05:00Z');
const memStore = (init = {}) => {
  const rows = new Map(Object.entries(init));
  return { rows, async read(k) { return rows.get(k) ?? null; }, async transact(k, fn) { const raw = await fn(rows.get(k) ?? null); JSON.parse(raw); rows.set(k, raw); return raw; } };
};
const DRIVE_ENV = { GOOGLE_DRIVE_CLIENT_ID: 'id', GOOGLE_DRIVE_CLIENT_SECRET: 'x', GOOGLE_DRIVE_REFRESH_TOKEN: 'r', CLIPPERS_DRIVE_WORKSPACE_FOLDER_ID: 'root' };
const YT = Object.fromEntries(['CHANNEL_ID', 'CLIENT_ID', 'CLIENT_SECRET', 'REFRESH_TOKEN'].map(k => [`CLIPPERS_YOUTUBE_ES_${k}`, 'v']));

function fakeDrive(files) {
  const uploads = [];
  return { uploads, files,
    async walk() { return { files: Object.entries(files).map(([rel, f], i) => ({ rel, id: `f${i}`, size: Buffer.byteLength(f.content), modifiedTime: f.modifiedTime })), folders: new Map([['', 'root']]) }; },
    async download(id, dest) { const rel = Object.keys(files)[Number(id.slice(1))]; await mkdir(path.dirname(dest), { recursive: true }); await writeFile(dest, files[rel].content); },
    async ensureFolder(folders, rel) { folders.set(rel, `d:${rel}`); return `d:${rel}`; },
    async upload(local, { name, parentId, existingId }) { uploads.push({ name, parentId, existingId }); return 'u'; } };
}

test('lease: cloud refuses while the Mac heartbeat is fresh; Mac refuses while the cloud holds it or once retired', () => {
  const s = emptyLanesState();
  assert.equal(acquireLane(s, 'content', 'mac', NOW).ok, true);
  assert.deepEqual(acquireLane(s, 'content', 'cloud', NOW + 3600_000).reason, 'mac_lane_active');
  assert.equal(acquireLane(s, 'content', 'cloud', NOW + LANE_LEASE_MS + 1).ok, true);
  assert.equal(acquireLane(s, 'content', 'mac', NOW + LANE_LEASE_MS + 2).reason, 'cloud_lane_active');
  const t = emptyLanesState();
  acquireLane(t, 'marketplace', 'mac', NOW);
  retireMacLanes(t, ['marketplace'], NOW + 60_000);
  assert.equal(acquireLane(t, 'marketplace', 'cloud', NOW + 120_000).ok, true);
  assert.equal(acquireLane(t, 'marketplace', 'mac', NOW + 10 * LANE_LEASE_MS).reason, 'mac_lane_retired');
});

test('failure streak counts code failures only; parse drops unsafe codes', () => {
  const s = emptyLanesState();
  for (const status of ['failed', 'held', 'failed']) recordLaneRun(s, 'content', { at: new Date(NOW).toISOString(), status, heldReasons: ['ok_code', 'bad code!'], errors: [] });
  const p = parseLanesState(JSON.stringify(s));
  assert.equal(p.lanes.content.failureStreak, 2);
  assert.deepEqual(p.lanes.content.lastRun.heldReasons, ['ok_code']);
  assert.deepEqual(parseLanesState('not json'), emptyLanesState());
});

test('office view: missing secret is a held role with an owner note; Mac active is idle; watchdog retired is completed', () => {
  const s = emptyLanesState();
  recordLaneRun(s, 'youtube_delivery', { at: new Date(NOW).toISOString(), status: 'held', heldReasons: ['missing_secret:CLIPPERS_YOUTUBE_ES_REFRESH_TOKEN'], errors: [] });
  const v = laneView(s, 'youtube_delivery', NOW + 60_000);
  assert.equal(v.state, 'held');
  assert.match(v.note, /CLIPPERS_YOUTUBE_ES_REFRESH_TOKEN/);
  acquireLane(s, 'content', 'mac', NOW);
  assert.equal(laneView(s, 'content', NOW).state, 'idle');
  assert.equal(laneView(s, 'watchdog', NOW).state, 'idle');
  retireMacLanes(s, ['watchdog'], NOW);
  assert.equal(laneView(s, 'watchdog', NOW).state, 'completed');
  recordLaneRun(s, 'marketplace', { at: new Date(NOW - 40 * 3600_000).toISOString(), status: 'completed', heldReasons: [], errors: [] });
  assert.equal(laneView(s, 'marketplace', NOW).state, 'stale');
});

test('missing secrets per lane and the exact YouTube env allowlist', () => {
  assert.deepEqual(missingSecrets('content', {}), ['GOOGLE_DRIVE_CLIENT_ID', 'GOOGLE_DRIVE_CLIENT_SECRET', 'GOOGLE_DRIVE_REFRESH_TOKEN', 'CLIPPERS_DRIVE_WORKSPACE_FOLDER_ID']);
  assert.deepEqual(missingSecrets('youtube_delivery', { ...DRIVE_ENV, ...YT }), []);
  assert.ok(missingSecrets('youtube_delivery', DRIVE_ENV).includes('CLIPPERS_YOUTUBE_ES_REFRESH_TOKEN'));
  assert.deepEqual(missingSecrets('marketplace', { ...DRIVE_ENV, CLIPPERS_METRICOOL_AUTOPUBLISH_AUTHORIZED: 'true' }), ['METRICOOL_USER_TOKEN', 'METRICOOL_USER_ID', 'CLIPPERS_METRICOOL_BLOG_ID']);
  assert.deepEqual(Object.keys(youtubeEnv({ ...YT, OFFICE_DATABASE_URL: 'postgres://x', GOOGLE_DRIVE_REFRESH_TOKEN: 'r' })).sort(), Object.keys(YT).sort());
});

test('hydration plan keeps inputs and recent media, skips old media; stored text wins when newer', () => {
  const files = [
    { rel: 'config/a.json', size: 10, modifiedTime: '2026-01-01T00:00:00Z' },
    { rel: 'visuals/bg.png', size: 10, modifiedTime: '2026-01-01T00:00:00Z' },
    { rel: 'renders/old.mp4', size: 10, modifiedTime: '2026-11-01T00:00:00Z' },
    { rel: 'renders/new.mp4', size: 10, modifiedTime: '2026-11-19T00:00:00Z' },
  ];
  assert.deepEqual(planHydration(files, { now: NOW }).map(f => f.rel).sort(), ['config/a.json', 'renders/new.mp4', 'visuals/bg.png']);
  const stored = { files: { 'config/a.json': { content: 'S', updatedAt: '2026-02-01T00:00:00Z' }, 'reports/l.json': { content: 'L', updatedAt: '2026-02-01T00:00:00Z' }, '../x.json': { content: 'X', updatedAt: '2026-02-01T00:00:00Z' } } };
  assert.deepEqual(textOverlay(stored, files).map(f => f.rel).sort(), ['config/a.json', 'reports/l.json']);
  const before = new Map([['a.json', { size: 1, sha256: 'a' }]]);
  const after = new Map([['a.json', { size: 1, sha256: 'a' }], ['b.json', { size: 2, sha256: 'b' }], ['r/x.mp4', { size: 9, sha256: 'c' }]]);
  assert.deepEqual(planPersist(before, after), { text: ['b.json'], media: ['r/x.mp4'] });
});

test('cloud job without Drive secrets: held missing_secret for each lane, no runner, exit-clean record', async () => {
  const store = memStore();
  let ran = false;
  const r = await runCloudJob({ job: 'owned_content', store, owner: 'o', env: {}, now: NOW, runners: { content: () => { ran = true; } }, workspaceRoot: '/nonexistent' });
  assert.equal(ran, false);
  assert.equal(r.lanes.content.status, 'held');
  assert.ok(r.lanes.youtube_delivery.heldReasons.includes('missing_secret:GOOGLE_DRIVE_REFRESH_TOKEN'));
  assert.equal(parseLanesState(store.rows.get(CLOUD_LANES_NAMESPACE('o'))).lanes.content.lastRun.status, 'held');
});

test('cloud job refuses a lane whose Mac heartbeat is fresh and runs the other one', async () => {
  const s = emptyLanesState(); acquireLane(s, 'youtube_delivery', 'mac', NOW - 3600_000);
  const store = memStore({ [CLOUD_LANES_NAMESPACE('o')]: JSON.stringify(s) });
  const ws = await mkdtemp(path.join(os.tmpdir(), 'cl-'));
  const drive = fakeDrive({ 'config/clippers-content-worker.json': { content: `{"root":"${WORKSPACE_TOKEN}/x"}`, modifiedTime: '2026-11-19T00:00:00Z' } });
  const calls = [];
  const runners = { content: async ({ workspaceRoot }) => { calls.push('content'); await mkdir(path.join(workspaceRoot, 'renders'), { recursive: true });
    await writeFile(path.join(workspaceRoot, 'renders', 'a.mp4'), 'video'); await mkdir(path.join(workspaceRoot, 'reports'), { recursive: true });
    await writeFile(path.join(workspaceRoot, 'reports', 'ledger.json'), JSON.stringify({ out: `${workspaceRoot}/renders/a.mp4` }));
    return { status: 'completed', heldReasons: [], errors: [], counts: { motivation_rendered: 1 } }; },
    youtube_delivery: async () => { calls.push('yt'); return { status: 'completed', heldReasons: [], errors: [], counts: {} }; } };
  const r = await runCloudJob({ job: 'owned_content', store, owner: 'o', env: { ...DRIVE_ENV, ...YT }, now: NOW, drive, runners, workspaceRoot: ws });
  assert.deepEqual(calls, ['content']);
  assert.deepEqual(r.lanes.youtube_delivery.heldReasons, ['mac_lane_active']);
  assert.equal(r.lanes.content.status, 'completed');
  // Token substituted on hydration; ledger persisted to Postgres with the token; media to Drive.
  assert.match(await readFile(path.join(ws, 'config/clippers-content-worker.json'), 'utf8'), new RegExp(ws.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  const doc = JSON.parse(store.rows.get(CLOUD_WORKSPACE_NAMESPACE('o')));
  assert.equal(JSON.parse(doc.files['reports/ledger.json'].content).out, `${WORKSPACE_TOKEN}/renders/a.mp4`);
  assert.deepEqual(drive.uploads.map(u => [u.name, u.parentId]), [['a.mp4', 'd:renders']]);
  const lanes = parseLanesState(store.rows.get(CLOUD_LANES_NAMESPACE('o')));
  assert.equal(lanes.leases.content.holder, 'cloud');
  assert.equal(lanes.leases.youtube_delivery.holder, 'mac');
});

test('dry run takes no lease, uploads nothing, persists nothing and skips YouTube', async () => {
  const s = emptyLanesState(); acquireLane(s, 'content', 'mac', NOW - 3600_000);
  const store = memStore({ [CLOUD_LANES_NAMESPACE('o')]: JSON.stringify(s) });
  const drive = fakeDrive({ 'config/clippers-content-worker.json': { content: '{}', modifiedTime: '2026-11-19T00:00:00Z' } });
  const ws = await mkdtemp(path.join(os.tmpdir(), 'cl-'));
  const r = await runCloudJob({ job: 'owned_content', store, owner: 'o', env: { ...DRIVE_ENV, ...YT }, now: NOW, drive, workspaceRoot: ws, dryRun: true,
    runners: { content: async ({ workspaceRoot }) => { await writeFile(path.join(workspaceRoot, 'x.mp4'), 'v'); return { status: 'completed', heldReasons: [], errors: [], counts: {} }; } } });
  assert.equal(r.lanes.content.status, 'completed');
  assert.deepEqual(r.lanes.youtube_delivery.heldReasons, ['dry_run_no_upload']);
  assert.equal(drive.uploads.length, 0);
  assert.equal(store.rows.has(CLOUD_WORKSPACE_NAMESPACE('o')), false);
  const lanes = parseLanesState(store.rows.get(CLOUD_LANES_NAMESPACE('o')));
  assert.equal(lanes.leases.content.holder, 'mac');
  assert.equal(lanes.lanes.content.lastDryRun.status, 'completed');
  assert.equal(lanes.lanes.content.lastRun, null);
});

test('runner exception is a failed run with a fixed code; config missing is held', async () => {
  const store = memStore();
  const r = await runCloudJob({ job: 'owned_content', store, owner: 'o', env: { ...DRIVE_ENV, ...YT }, now: NOW, drive: fakeDrive({}), workspaceRoot: await mkdtemp(path.join(os.tmpdir(), 'cl-')),
    runners: { content: async () => { throw new Error('secret value https://x?token=1'); } } });
  assert.deepEqual(r.lanes.content.heldReasons, ['workspace_config_missing:content']);
  const r2 = await runCloudJob({ job: 'owned_content', store, owner: 'p', env: { ...DRIVE_ENV, ...YT }, now: NOW, drive: fakeDrive({ 'config/clippers-content-worker.json': { content: '{}', modifiedTime: '2026-11-19T00:00:00Z' } }),
    workspaceRoot: await mkdtemp(path.join(os.tmpdir(), 'cl-')), runners: { content: async () => { throw new Error('secret value https://x?token=1'); } } });
  assert.deepEqual(r2.lanes.content.errors, ['internal_error']);
  assert.deepEqual(r2.lanes.youtube_delivery.heldReasons, ['content_lane_not_completed']);
});

test('Mac gate: fail-open without a database, refused once retired', async () => {
  const logs = [];
  assert.equal(await macLaneGate('content', { env: {}, log: m => logs.push(m) }), true);
  const s = emptyLanesState(); retireMacLanes(s, ['content'], NOW);
  const store = memStore({ [CLOUD_LANES_NAMESPACE('test-owner')]: JSON.stringify(s) });
  assert.equal(await macLaneGate('content', { env: {}, store, now: NOW, log: m => logs.push(m) }), false);
  assert.ok(logs.some(l => /mac_lane_retired/.test(l)));
});

test('retirement needs cloud QA unless forced; seeding tokenizes the Mac root and never uploads credential files', async () => {
  const store = memStore();
  assert.deepEqual((await retireMac({ lanes: ['content'], store, owner: 'o', now: NOW })).failures, ['content:cloud_qa_missing']);
  await store.transact(CLOUD_LANES_NAMESPACE('o'), async raw => { const s = parseLanesState(raw); recordLaneRun(s, 'content', { at: new Date(NOW).toISOString(), status: 'completed', heldReasons: [], errors: [], dryRun: true }); return JSON.stringify(s); });
  assert.equal((await retireMac({ lanes: ['content'], store, owner: 'o', now: NOW })).ok, true);
  assert.equal((await retireMac({ lanes: ['watchdog'], store, owner: 'o', now: NOW })).ok, false);
  assert.equal((await retireMac({ lanes: ['watchdog'], store, owner: 'o', now: NOW, force: true })).ok, true);

  const mac = await mkdtemp(path.join(os.tmpdir(), 'mac-'));
  await mkdir(path.join(mac, 'reports'), { recursive: true }); await mkdir(path.join(mac, 'credentials'), { recursive: true });
  await writeFile(path.join(mac, 'reports', 'ledger.json'), JSON.stringify({ p: `${mac}/renders/a.mp4` }));
  await writeFile(path.join(mac, 'credentials', 'drive.json'), '{"refresh_token":"x"}');
  await writeFile(path.join(mac, '.env'), 'A=1'); await writeFile(path.join(mac, 'clip.mp4'), 'v');
  const drive = fakeDrive({});
  await seedWorkspace({ macRoot: mac, store, owner: 'o', drive, folderId: 'root', now: NOW, log: () => {} });
  const doc = JSON.parse(store.rows.get(CLOUD_WORKSPACE_NAMESPACE('o')));
  assert.deepEqual(Object.keys(doc.files), ['reports/ledger.json']);
  assert.equal(JSON.parse(doc.files['reports/ledger.json'].content).p, `${WORKSPACE_TOKEN}/renders/a.mp4`);
  assert.deepEqual(drive.uploads.map(u => u.name), ['clip.mp4']);
});

test('scheduled interval skip: not after a failure, Mac hold or missing secret', () => {
  const run = (status, heldReasons = []) => ({ at: new Date(NOW - 3600_000).toISOString(), status, heldReasons });
  assert.equal(skipByInterval(run('completed'), NOW, 20), true);
  assert.equal(skipByInterval(run('failed'), NOW, 20), false);
  assert.equal(skipByInterval(run('held', ['mac_lane_active']), NOW, 20), false);
  assert.equal(skipByInterval(null, NOW, 20), false);
});
