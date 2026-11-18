import { constants } from 'node:fs';
import { open, realpath, lstat } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createClippersOrchestraRelay, clippersOrchestraRemoteEligibility } from './clippers-orchestra-relay.mjs';

export const CLIPPERS_TELEMETRY_CREDENTIAL_PLIST = path.join(os.homedir(), 'Library/LaunchAgents/com.blackroom.content-agent.plist');
const MAX_BYTES = 262144;
const MAX_ACK_BYTES = 8192;
const ACK_CODES = new Set(['CLIPPERS_ORCHESTRA_ACCEPTED', 'CLIPPERS_ORCHESTRA_DUPLICATE', 'CLIPPERS_ORCHESTRA_CAREERS_PENDING']);
const fail = code => Object.assign(new Error(code), { code });

// macOS parses the already-open descriptor. Neither credential content nor a token
// is passed in arguments, environment, stderr, output logs or a newly written file.
function parsePlistDescriptor(descriptor) {
  return new Promise((resolve, reject) => {
    const child = spawn('/usr/bin/plutil', ['-convert', 'json', '-o', '-', '/dev/fd/3'], {
      stdio: ['ignore', 'pipe', 'ignore', descriptor], env: { PATH: '/usr/bin:/bin' },
    });
    const chunks = []; let bytes = 0, settled = false;
    const finish = (error, value) => { if (settled) return; settled = true; clearTimeout(timer); error ? reject(fail(error)) : resolve(value); };
    const timer = setTimeout(() => { child.kill('SIGKILL'); finish('CREDENTIAL_PARSE_UNAVAILABLE'); }, 3000);
    child.on('error', () => finish('CREDENTIAL_PARSE_UNAVAILABLE'));
    child.stdout.on('data', chunk => { bytes += chunk.length; if (bytes > MAX_BYTES) { child.kill('SIGKILL'); finish('CREDENTIAL_SOURCE_TOO_LARGE'); } else chunks.push(chunk); });
    child.on('close', code => {
      if (code !== 0) return finish('CREDENTIAL_PARSE_UNAVAILABLE');
      try { finish(null, JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
      catch { finish('CREDENTIAL_PARSE_UNAVAILABLE'); }
    });
  });
}
export async function readClippersTelemetryCredential(plistPath = CLIPPERS_TELEMETRY_CREDENTIAL_PLIST, { parse = parsePlistDescriptor, uid = process.getuid?.() } = {}) {
  let file;
  try {
    if (!path.isAbsolute(plistPath) || await realpath(plistPath) !== plistPath || uid === undefined) throw fail('CREDENTIAL_SOURCE_UNSAFE');
    file = await open(plistPath, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const before = await file.stat();
    if (!before.isFile() || before.nlink !== 1 || before.uid !== uid || (before.mode & 0o777) !== 0o600 || before.size > MAX_BYTES) throw fail('CREDENTIAL_SOURCE_UNSAFE');
    const parsed = await parse(file.fd);
    const after = await file.stat(), current = await lstat(plistPath);
    const fields = ['ino', 'dev', 'mode', 'uid', 'nlink', 'size', 'mtimeMs', 'ctimeMs'];
    if (await realpath(plistPath) !== plistPath || !current.isFile() ||
        fields.some(key => before[key] !== after[key] || before[key] !== current[key])) throw fail('CREDENTIAL_SOURCE_CHANGED');
    const env = parsed?.EnvironmentVariables;
    const token = typeof env?.BLACKROOM_REMOTE_CONTROL_TOKEN === 'string' ? env.BLACKROOM_REMOTE_CONTROL_TOKEN.trim() : '';
    const remoteUrl = env?.BLACKROOM_REMOTE_CONTROL_URL;
    if (token.length < 32 || /replace|example|your[-_ ]?token/i.test(token)) throw fail('EXISTING_DEVICE_AUTH_UNAVAILABLE');
    const eligibility = clippersOrchestraRemoteEligibility(remoteUrl, true);
    if (!eligibility.allowed) throw fail('OFFICE_ORIGIN_UNVERIFIED');
    return { token, origin: new URL(remoteUrl).origin };
  } catch (error) {
    throw fail(['CREDENTIAL_SOURCE_UNSAFE', 'CREDENTIAL_SOURCE_CHANGED', 'CREDENTIAL_SOURCE_TOO_LARGE', 'CREDENTIAL_PARSE_UNAVAILABLE', 'EXISTING_DEVICE_AUTH_UNAVAILABLE', 'OFFICE_ORIGIN_UNVERIFIED'].includes(error?.code) ? error.code : 'CREDENTIAL_SOURCE_UNAVAILABLE');
  } finally { await file?.close(); }
}
async function boundedAck(response) {
  if (!response.ok || !response.headers.get('content-type')?.toLowerCase().startsWith('application/json')) throw fail('TELEMETRY_ACK_UNCONFIRMED');
  const reader = response.body?.getReader(); if (!reader) throw fail('TELEMETRY_ACK_UNCONFIRMED');
  const chunks = []; let bytes = 0;
  try {
    for (;;) { const { done, value } = await reader.read(); if (done) break; bytes += value.length; if (bytes > MAX_ACK_BYTES) throw fail('TELEMETRY_ACK_UNCONFIRMED'); chunks.push(value); }
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!body || Object.keys(body).join(',') !== 'clippersOrchestra') throw fail('TELEMETRY_ACK_UNCONFIRMED');
    const ack = body.clippersOrchestra;
    if (!ack || typeof ack !== 'object' || Array.isArray(ack) || Object.keys(ack).some(key => !['accepted', 'duplicate', 'code'].includes(key)) ||
        ack.accepted !== true || (ack.duplicate !== undefined && typeof ack.duplicate !== 'boolean') || !ACK_CODES.has(ack.code)) throw fail('TELEMETRY_ACK_UNCONFIRMED');
    return ack;
  } catch { await reader.cancel().catch(() => {}); throw fail('TELEMETRY_ACK_UNCONFIRMED'); }
}
/** One telemetry-only POST. Never consumes a control/command response, retries a
 * write, imports a model/provider, mutates a publication queue or restarts BlackRoom. */
export async function runClippersOrchestraSender({ workspaceRoot = path.join(os.homedir(), '.local/share/blackops/clippers-workspace'),
  readCredential = readClippersTelemetryCredential, fetchImpl = fetch, relayFactory = createClippersOrchestraRelay, timeoutMs = 10_000 } = {}) {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 10_000) throw fail('SENDER_CONFIGURATION_INVALID');
  let relay;
  try {
    relay = relayFactory({ workspaceRoot });
    await relay.refresh();
    const envelope = relay.getEnvelope();
    if (!envelope) return { state: 'held', reasonCode: 'TELEMETRY_REPORT_UNAVAILABLE', paidSpendUsd: 0 };
    const body = JSON.stringify({ kind: 'clippers-orchestra', clippersOrchestra: envelope });
    if (Buffer.byteLength(body) > MAX_BYTES) return { state: 'held', reasonCode: 'TELEMETRY_REPORT_TOO_LARGE', paidSpendUsd: 0 };
    const credential = await readCredential();
    if (!clippersOrchestraRemoteEligibility(credential.origin, typeof credential.token === 'string' && credential.token.length >= 32).allowed) throw fail('OFFICE_ORIGIN_UNVERIFIED');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(credential.origin + '/api/blackroom-agent/clippers-orchestra', {
        method: 'POST', redirect: 'error', cache: 'no-store', signal: controller.signal,
        headers: { authorization: 'Bearer ' + credential.token, 'content-type': 'application/json' }, body,
      });
      const ack = await boundedAck(response);
      relay.acknowledge(envelope.nonce);
      return { state: 'acknowledged', reasonCode: ack.code, generatedAt: envelope.generatedAt, duplicate: ack.duplicate === true, paidSpendUsd: 0 };
    } finally { clearTimeout(timer); }
  } catch (error) {
    const code = error?.code;
    return { state: code?.startsWith('CREDENTIAL_') || ['EXISTING_DEVICE_AUTH_UNAVAILABLE', 'OFFICE_ORIGIN_UNVERIFIED'].includes(code) ? 'held' : 'unconfirmed',
      reasonCode: ['CREDENTIAL_SOURCE_UNSAFE', 'CREDENTIAL_SOURCE_CHANGED', 'CREDENTIAL_SOURCE_TOO_LARGE', 'CREDENTIAL_PARSE_UNAVAILABLE', 'CREDENTIAL_SOURCE_UNAVAILABLE', 'EXISTING_DEVICE_AUTH_UNAVAILABLE', 'OFFICE_ORIGIN_UNVERIFIED'].includes(code) ? code : 'TELEMETRY_ACK_UNCONFIRMED', paidSpendUsd: 0 };
  } finally { relay?.stop(); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  if (process.argv.slice(2).some(arg => arg !== '--once') || process.argv.slice(2).length > 1) {
    process.stdout.write(JSON.stringify({ state: 'held', reasonCode: 'SENDER_CONFIGURATION_INVALID', paidSpendUsd: 0 }) + '\n');
    process.exitCode = 1;
  } else {
    const result = await runClippersOrchestraSender();
    process.stdout.write(JSON.stringify(result) + '\n');
    process.exitCode = result.state === 'acknowledged' ? 0 : 1;
  }
}
