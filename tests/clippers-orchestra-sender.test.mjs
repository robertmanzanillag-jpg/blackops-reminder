import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, chmod, rm, realpath, symlink, link, rename, open } from 'node:fs/promises';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { constants } from 'node:fs';
import path from 'node:path';
import { readClippersTelemetryCredential, runClippersOrchestraSender } from '../script/clippers-orchestra-sender.mjs';

const TOKEN = 'synthetic-safe-only-'.repeat(3);
const credential = { token: TOKEN, origin: 'https://robplanner.replit.app' };
const parsed = (patch = {}) => ({ EnvironmentVariables: { BLACKROOM_REMOTE_CONTROL_TOKEN: TOKEN, BLACKROOM_REMOTE_CONTROL_URL: credential.origin, ...patch } });
async function fixture(t) {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'clippers-telemetry-credential-')));
  t.after(() => rm(root, { recursive: true, force: true }));
  const file = path.join(root, 'device.plist');
  await writeFile(file, '<plist><dict/></plist>', { mode: 0o600 });
  return { root, file };
}
function relay(envelope = { version: 1, nonce: '01234567-1234-4234-8234-0123456789ab', generatedAt: '2026-11-18T12:00:00.000Z', report: {} }) {
  const calls = { ack: 0, stop: 0, refresh: 0 };
  return { calls, factory: () => ({ refresh: async () => { calls.refresh++; }, getEnvelope: () => envelope,
    acknowledge: nonce => { assert.equal(nonce, envelope.nonce); calls.ack++; }, stop: () => { calls.stop++; } }) };
}
const accepted = () => Response.json({ clippersOrchestra: { accepted: true, duplicate: false, code: 'CLIPPERS_ORCHESTRA_ACCEPTED' } });

test('private canonical owner credential is parsed only in memory and bound to fixed Office origin', async t => {
  const f = await fixture(t); let calls = 0;
  assert.deepEqual(await readClippersTelemetryCredential(f.file, { parse: async descriptor => { assert.equal(typeof descriptor, 'number'); calls++; return parsed(); } }), credential);
  assert.equal(calls, 1);
});

test('symlink, parent alias, hardlink, unsafe mode and wrong owner fail before parser reads', async t => {
  const f = await fixture(t); let calls = 0; const options = { parse: async () => { calls++; return parsed(); } };
  const alias = path.join(f.root, 'alias'); await symlink(f.file, alias);
  await assert.rejects(readClippersTelemetryCredential(alias, options), { code: 'CREDENTIAL_SOURCE_UNSAFE' });
  const dirAlias = f.root + '-alias'; await symlink(f.root, dirAlias); t.after(() => rm(dirAlias, { force: true }));
  await assert.rejects(readClippersTelemetryCredential(path.join(dirAlias, 'device.plist'), options), { code: 'CREDENTIAL_SOURCE_UNSAFE' });
  await chmod(f.file, 0o644);
  await assert.rejects(readClippersTelemetryCredential(f.file, options), { code: 'CREDENTIAL_SOURCE_UNSAFE' });
  await chmod(f.file, 0o600);
  await assert.rejects(readClippersTelemetryCredential(f.file, { ...options, uid: process.getuid() + 1 }), { code: 'CREDENTIAL_SOURCE_UNSAFE' });
  const second = path.join(f.root, 'hardlink'); await link(f.file, second);
  await assert.rejects(readClippersTelemetryCredential(f.file, options), { code: 'CREDENTIAL_SOURCE_UNSAFE' });
  assert.equal(calls, 0);
});

test('unapproved origin, query/path/port and placeholder token never escape reader', async t => {
  const f = await fixture(t);
  for (const value of ['http://robplanner.replit.app', 'https://evil.invalid', 'https://robplanner.replit.app/path', 'https://robplanner.replit.app/?a=1', 'https://robplanner.replit.app:444', 'https://user:pw@robplanner.replit.app']) {
    await assert.rejects(readClippersTelemetryCredential(f.file, { parse: async () => parsed({ BLACKROOM_REMOTE_CONTROL_URL: value }) }), { code: 'OFFICE_ORIGIN_UNVERIFIED' });
  }
  await assert.rejects(readClippersTelemetryCredential(f.file, { parse: async () => parsed({ BLACKROOM_REMOTE_CONTROL_TOKEN: 'your-token'.repeat(5) }) }), { code: 'EXISTING_DEVICE_AUTH_UNAVAILABLE' });
});

test('credential changes and path replacement during parse are rejected', async t => {
  const f = await fixture(t);
  await assert.rejects(readClippersTelemetryCredential(f.file, { parse: async () => { await writeFile(f.file, '<plist><dict><key>changed</key><true/></dict></plist>'); return parsed(); } }), { code: 'CREDENTIAL_SOURCE_CHANGED' });
  await assert.rejects(readClippersTelemetryCredential(f.file, { parse: async () => {
    const replacement = path.join(f.root, 'replacement'); await writeFile(replacement, '<plist><dict/></plist>', { mode: 0o600 }); await rename(replacement, f.file); return parsed();
  } }), { code: 'CREDENTIAL_SOURCE_CHANGED' });
});

test('macOS parser reads a synthetic plist through inherited descriptor without token arguments', { skip: process.platform !== 'darwin' }, async t => {
  const f = await fixture(t);
  await writeFile(f.file, `<?xml version="1.0"?><plist version="1.0"><dict><key>EnvironmentVariables</key><dict><key>BLACKROOM_REMOTE_CONTROL_TOKEN</key><string>${TOKEN}</string><key>BLACKROOM_REMOTE_CONTROL_URL</key><string>https://robplanner.replit.app</string></dict></dict></plist>`);
  assert.deepEqual(await readClippersTelemetryCredential(f.file), credential);
});

test('one telemetry POST uses exact reserved endpoint/body and never consumes control or commands', async () => {
  const r = relay(); let posts = 0;
  const result = await runClippersOrchestraSender({ relayFactory: r.factory, readCredential: async () => credential, fetchImpl: async (url, options) => {
    posts++; assert.equal(url, credential.origin + '/api/blackroom-agent/clippers-orchestra');
    assert.equal(options.method, 'POST'); assert.equal(options.redirect, 'error'); assert.equal(options.cache, 'no-store');
    assert.deepEqual(Object.keys(JSON.parse(options.body)).sort(), ['clippersOrchestra', 'kind']);
    assert.equal(JSON.parse(options.body).kind, 'clippers-orchestra');
    assert.equal(options.headers.authorization, 'Bearer ' + TOKEN);
    return accepted();
  } });
  assert.equal(result.state, 'acknowledged'); assert.equal(result.paidSpendUsd, 0); assert.equal(posts, 1);
  assert.equal(r.calls.ack, 1); assert.equal(r.calls.stop, 1); assert.equal(JSON.stringify(result).includes(TOKEN), false);
});

test('no report or oversized wrapper reads no credential and makes no request', async () => {
  for (const envelope of [null, { report: 'x'.repeat(262144) }]) {
    let credentials = 0, requests = 0; const r = relay(envelope);
    const result = await runClippersOrchestraSender({ relayFactory: r.factory, readCredential: async () => { credentials++; return credential; }, fetchImpl: async () => { requests++; return accepted(); } });
    assert.equal(result.state, 'held'); assert.equal(credentials, 0); assert.equal(requests, 0); assert.equal(r.calls.stop, 1);
  }
});

test('malformed/private/oversized ACK and old-server404 never acknowledge or retry', async () => {
  for (const response of [
    Response.json({ control: { desiredEnabled: true }, clippersOrchestra: { accepted: true } }),
    Response.json({ clippersOrchestra: { accepted: false, code: 'CLIPPERS_ORCHESTRA_INVALID' } }),
    Response.json({ clippersOrchestra: { accepted: true, code: 'CLIPPERS_ORCHESTRA_ACCEPTED', command: 'run' } }),
    Response.json({ clippersOrchestra: { accepted: true, code: 'CLIPPERS_ORCHESTRA_ACCEPTED' }, extra: true }),
    new Response('x'.repeat(9000), { headers: { 'content-type': 'application/json' } }),
    Response.json({ error: 'old server' }, { status: 404 }),
  ]) {
    let posts = 0; const r = relay();
    const result = await runClippersOrchestraSender({ relayFactory: r.factory, readCredential: async () => credential, fetchImpl: async () => { posts++; return response; } });
    assert.equal(result.state, 'unconfirmed'); assert.equal(r.calls.ack, 0); assert.equal(posts, 1);
  }
});

test('auth failure, wrong injected origin, transport error and timeout remain safe without leaking or retry', async () => {
  const auth = await runClippersOrchestraSender({ relayFactory: relay().factory, readCredential: async () => { throw new Error(TOKEN); }, fetchImpl: () => assert.fail('network forbidden') });
  assert.equal(JSON.stringify(auth).includes(TOKEN), false);
  const origin = await runClippersOrchestraSender({ relayFactory: relay().factory, readCredential: async () => ({ ...credential, origin: 'https://evil.invalid' }), fetchImpl: () => assert.fail('network forbidden') });
  assert.equal(origin.reasonCode, 'OFFICE_ORIGIN_UNVERIFIED');
  let posts = 0;
  const result = await runClippersOrchestraSender({ timeoutMs: 10, relayFactory: relay().factory, readCredential: async () => credential,
    fetchImpl: (_url, options) => { posts++; return new Promise((_resolve, reject) => options.signal.addEventListener('abort', () => reject(new Error(TOKEN)), { once: true })); } });
  assert.equal(result.state, 'unconfirmed'); assert.equal(posts, 1); assert.equal(JSON.stringify(result).includes(TOKEN), false);
});


test('a private FIFO credential path rejects promptly without waiting for any writer', async t => {
  const f = await fixture(t); await rm(f.file);
  await new Promise((resolve, reject) => execFile('/usr/bin/mkfifo', ['-m', '600', f.file], error => error ? reject(error) : resolve()));
  let parserCalls = 0, timeout;
  try {
    await assert.rejects(Promise.race([
      readClippersTelemetryCredential(f.file, { parse: async () => { parserCalls++; return parsed(); } }),
      new Promise((_, reject) => { timeout = setTimeout(async () => {
        const release = await open(f.file, constants.O_RDWR | constants.O_NONBLOCK); await release.close();
        reject(new Error('credential FIFO must not block'));
      }, 3000); }),
    ]), { code: 'CREDENTIAL_SOURCE_UNSAFE' });
    assert.equal(parserCalls, 0);
  } finally { clearTimeout(timeout); }
});
