import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { defaultRunners } from '../script/clippers-cloud-lanes.mjs';
import { runClipperFreeLocalWorker } from '../script/clippers-free-local-worker.mjs';
import { metricoolWriteRefusal, MAC_WRITE_REFUSED } from '../shared/clippers-metricool-writer.mjs';

// No global cloud marker in this process: the marker must come from the cloud-lanes runner itself.
for (const k of ['GITHUB_ACTIONS', 'CLIPPERS_RUNTIME', 'CLIPPERS_MAC_METRICOOL_WRITES', 'CLIPPERS_CLOUD_OWNED_BRANDS']) delete process.env[k];

const ok = { command: 'mock', status: 0, signal: null, stdout: '{}', stderr: '' };
const recorder = () => { const calls = []; return { calls, run(command, args, options) { calls.push({ args, env: { ...options.env } }); return ok; } }; };
const autopilotEnv = calls => calls.find(c => c.args.some(a => String(a).includes('clippers-metricool-autopilot')))?.env;
const env = { OFFICE_OWNER_ID: 'o', METRICOOL_USER_TOKEN: 'token-123456789', METRICOOL_USER_ID: '3558197', CLIPPERS_METRICOOL_BLOG_ID: '6431687',
  CLIPPERS_TIKTOK_ACCOUNT: 'streamersclipusa', CLIPPERS_METRICOOL_AUTOPUBLISH_AUTHORIZED: 'true', CLIPPERS_PUBLIC_MEDIA_UPLOAD_AUTHORIZED: 'true',
  CLIPPERS_MARKETPLACE_LANE_DAILY_QUOTA: '3' };

test('cloud marketplace lane -> free worker -> autopilot child carries CLIPPERS_RUNTIME=cloud (writes allowed)', async () => {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), 'clippers-lane-env-'));
  const { calls, run } = recorder();
  await defaultRunners.marketplace({ workspaceRoot, env, dryRun: false, run });
  assert.ok(calls.length > 0);
  for (const c of calls) assert.equal(c.env.CLIPPERS_RUNTIME, 'cloud');
  const child = autopilotEnv(calls);
  assert.ok(child, 'autopilot step ran');
  assert.equal(child.GITHUB_ACTIONS, undefined, 'child env stays scrubbed');
  assert.equal(child.CLIPPERS_MARKETPLACE_LANE_DAILY_QUOTA, '3');
  assert.equal(metricoolWriteRefusal(6431687, child), null);
});

test('Mac free worker (no childEnv) never carries the marker: autopilot writes are refused', async () => {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), 'clippers-mac-env-'));
  const { calls, run } = recorder();
  await runClipperFreeLocalWorker({ projectRoot, env: { CLIPPERS_RUNTIME: 'cloud', GITHUB_ACTIONS: 'true' }, run });
  for (const c of calls) { assert.equal(c.env.CLIPPERS_RUNTIME, undefined); assert.equal(metricoolWriteRefusal(6431687, c.env), MAC_WRITE_REFUSED); }
});
