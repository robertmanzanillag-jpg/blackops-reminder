import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { open, readFile, mkdir, realpath, rename, rm, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { destinationKey, findDestination, providerTimestamp, TIME_ZONE } from './clippers-portfolio-metricool.mjs';

const exec = promisify(execFile);
const BASELINE = 'baseline-1';
const HOUR = 3_600_000;
const ID = /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,99}$/;
const SHA = /^[a-f0-9]{64}$/;
const FEATURES = ['hook', 'duration', 'crop', 'caption_layout', 'posting_slot'];
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const fingerprint = value => hash(JSON.stringify(value));
const OUTPUT_ROOT = 'drafts/portfolio';
const STATE_FILE = 'reports/clippers-daily-learning/state.json';
const RECEIPT_ROOT = 'reports/clippers-daily-learning/render-receipts';
const CONFIG_ROOT = 'config/clippers-daily-learning';
const ENGINE_SHA256 = hash(await readFile(new URL(import.meta.url)));
const scopedKey = destination => destinationKey(destination).replaceAll(':', '__');
const clock = when => new Intl.DateTimeFormat('en-GB', {
  timeZone: TIME_ZONE, hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
}).format(new Date(when));

async function ownerJson(root, relative, fallback) {
  const file = path.join(root, relative);
  let handle;
  try {
    if (path.dirname(file) !== await realpath(path.dirname(file))) throw Error('owner_path_symlink');
    handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
    const info = await handle.stat();
    if (!info.isFile() || (info.mode & 0o077) || info.nlink !== 1 || (process.getuid && info.uid !== process.getuid())) throw Error('owner_file_required');
    return JSON.parse(await handle.readFile('utf8'));
  } catch (error) {
    if (error.code === 'ENOENT' && fallback !== undefined) return fallback;
    throw error;
  } finally { await handle?.close(); }
}
async function mediaBytes(root, relative, keepBytes = false) {
  if (typeof relative !== 'string' || path.isAbsolute(relative)) throw Error('relative_media_required');
  const file = path.resolve(root, relative);
  if (!file.startsWith(root + path.sep) || file !== await realpath(file)) throw Error('contained_media_required');
  const fd = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const info = await fd.stat();
    if (!info.isFile() || info.size > 250_000_000) throw Error('local_media_required');
    const bytes = await fd.readFile();
    return { file, sha: hash(bytes), ...(keepBytes ? { bytes } : {}) };
  } finally { await fd.close(); }
}
export async function readPortfolioRenderManifest(root, destination, version) {
  if (!findDestination(destination) || !ID.test(version ?? '')) throw Error('invalid_render_manifest_scope');
  const file = path.join(CONFIG_ROOT, 'render-policies', scopedKey(destination), version + '.json');
  const data = await ownerJson(root, file);
  const p = data?.params;
  if (data?.schemaVersion !== 1 || data.version !== version || !findDestination(data.destination) ||
      destinationKey(data.destination) !== destinationKey(destination) || data.engineSha256 !== ENGINE_SHA256 ||
      !ID.test(data.reviewedBy ?? '') || !p || Object.keys(p).length !== FEATURES.length ||
      !Number.isFinite(p.hook) || p.hook < 0 || p.hook > 20 ||
      !Number.isFinite(p.duration) || p.duration < 5 || p.duration > 90 ||
      !['left', 'center', 'right'].includes(p.crop) || !['off', 'upper', 'lower'].includes(p.caption_layout) ||
      !/^(?:[01]?[0-9]|2[0-3]):[0-5][0-9]$/.test(p.posting_slot) || p.posting_slot.length !== 5) throw Error('render_manifest_invalid');
  return { ...data, sha: fingerprint(data) };
}
async function selecting(root, destination, request) {
  const state = await ownerJson(root, STATE_FILE, { schemaVersion: 1, versions: {} });
  if (state?.schemaVersion !== 1 || typeof state.versions !== 'object' || !state.versions) throw Error('render_state_invalid');
  const key = destinationKey(destination);
  const active = state.versions[key] ?? BASELINE;
  const baseline = await readPortfolioRenderManifest(root, destination, active);
  const pinned = state.history?.filter(row => row.destination === key).at(-1)?.toManifestSha;
  if (pinned && pinned !== baseline.sha) throw Error('active_render_manifest_changed');
  if (!request.experiment) {
    if (request.policyVersion !== active) throw Error('render_version_not_active');
    return { manifest: baseline, comparison: null };
  }
  const e = request.experiment;
  if (!['control', 'candidate'].includes(e.arm) || e.baselineVersion !== active ||
      request.policyVersion !== (e.arm === 'control' ? active : e.candidateVersion)) throw Error('render_experiment_version_invalid');
  const candidate = await readPortfolioRenderManifest(root, destination, e.candidateVersion);
  const changed = FEATURES.filter(feature => baseline.params[feature] !== candidate.params[feature]);
  if (changed.length !== 1 || changed[0] !== e.variable) throw Error('render_experiment_must_change_one_variable');
  return {
    manifest: e.arm === 'control' ? baseline : candidate,
    comparison: { baselineManifestSha: baseline.sha, candidateManifestSha: candidate.sha, variable: e.variable },
  };
}
function rightsValid(request, now) {
  const rights = request.rights;
  const sourceTime = providerTimestamp(rights?.sourcePublishedAt);
  const verified = providerTimestamp(rights?.observedAt);
  const expires = providerTimestamp(rights?.validUntil);
  let terms;
  try { terms = new URL(rights?.termsUrl); } catch { return false; }
  const age = date => +now - Date.parse(date);
  return rights.destination && findDestination(rights.destination) && destinationKey(rights.destination) === destinationKey(request) &&
    terms.protocol === 'https:' && !terms.username && !terms.password && rights.sourceScope === 'exact_asset' &&
    rights.commercialPermission === 'approved' && ID.test(rights.reviewedBy ?? '') &&
    ((rights.basis === 'campaign' && rights.membership === 'verified') ||
      (rights.basis === 'public_policy' && rights.membership === 'not_required') ||
      (rights.basis === 'owned' && rights.membership === 'not_required' && rights.ownership === 'verified')) &&
    sourceTime && age(sourceTime) >= 0 && age(sourceTime) < 72 * HOUR &&
    verified && age(verified) >= 0 && age(verified) <= 24 * HOUR && expires && age(expires) < 0;
}
async function binary(command, args) {
  return exec(command, args, { timeout: 120_000, maxBuffer: 2_000_000, windowsHide: true });
}
export async function renderClippersPortfolio({ workspaceRoot, requestId, now = new Date() }) {
  const root = await realpath(path.resolve(workspaceRoot));
  if (!ID.test(requestId ?? '')) throw Error('invalid_render_request');
  const request = await ownerJson(root, path.join(CONFIG_ROOT, 'render-requests', requestId + '.json'));
  const destination = findDestination(request);
  if (request?.schemaVersion !== 1 || request.id !== requestId || !destination ||
      !Number.isFinite(request.sourceStartSeconds) || request.sourceStartSeconds < 0 || !rightsValid(request, now) ||
      typeof request.sourceFile !== 'string' || !/\.(mp4|mov)$/i.test(request.sourceFile) ||
      !SHA.test(request.sourceSha256 ?? '')) throw Error('render_request_not_authorized');
  const source = await mediaBytes(root, request.sourceFile, true);
  if (source.sha !== request.sourceSha256 || request.rights.sourceSha256 !== source.sha) throw Error('render_source_hash_mismatch');
  const { manifest, comparison } = await selecting(root, destination, request);
  const { params } = manifest;
  const text = request.captionText;
  if (params.caption_layout !== 'off' &&
      (typeof text !== 'string' || !text.trim() || text.length > 160 || /[\x00-\x1f@%\\]/.test(text))) throw Error('approved_caption_required');
  const outputRoot = path.join(root, OUTPUT_ROOT, scopedKey(destination));
  const receiptRoot = path.join(root, RECEIPT_ROOT);
  await Promise.all([mkdir(outputRoot, { recursive: true, mode: 0o700 }), mkdir(receiptRoot, { recursive: true, mode: 0o700 })]);
  if (await realpath(outputRoot) !== outputRoot || await realpath(receiptRoot) !== receiptRoot) throw Error('render_output_symlink');
  const runId = randomUUID();
  const draftFile = path.join(OUTPUT_ROOT, scopedKey(destination), requestId + '-' + runId + '.mp4');
  const draft = path.join(root, draftFile);
  const overlay = path.join(outputRoot, runId + '.png');
  const temporary = path.join(outputRoot, runId + '.tmp.mp4');
  const sourceCopy = path.join(outputRoot, runId + '.source');
  const start = request.sourceStartSeconds + params.hook;
  const offset = { left: '0', center: '(iw-ow)/2', right: 'iw-ow' }[params.crop];
  const crop = 'scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920:' + offset + ':(ih-oh)/2,setsar=1';
  try {
    await writeFile(sourceCopy, source.bytes, { mode: 0o600, flag: 'wx' });
    const args = ['-hide_banner', '-loglevel', 'error', '-nostdin', '-protocol_whitelist', 'file,pipe', '-ss', String(start), '-f', 'mov', '-i', sourceCopy];
    if (params.caption_layout === 'off') args.push('-map', '0:v:0', '-map', '0:a:0', '-vf', crop);
    else {
      await binary('magick', ['-background', 'none', '-fill', 'white', '-stroke', 'black', '-strokewidth', '2',
        '-font', 'Arial-Bold', '-pointsize', '58', '-gravity', 'center', '-size', '940x220', 'caption:' + text, overlay]);
      const y = params.caption_layout === 'upper' ? 'H*0.2-h/2' : 'H*0.75-h/2';
      args.push('-i', overlay, '-filter_complex', '[0:v]' + crop + '[base];[base][1:v]overlay=(W-w)/2:' + y + '[v]',
        '-map', '[v]', '-map', '0:a:0');
    }
    args.push('-t', String(params.duration), '-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p',
      '-c:a', 'aac', '-map_metadata', '-1', '-movflags', '+faststart', temporary);
    await binary('ffmpeg', args);
    const { stdout } = await binary('ffprobe', ['-v', 'error', '-show_entries',
      'stream=codec_type,width,height:format=duration', '-of', 'json', temporary]);
    const probe = JSON.parse(stdout);
    if (!probe.streams.some(stream => stream.codec_type === 'video' && stream.width === 1080 && stream.height === 1920) ||
        !probe.streams.some(stream => stream.codec_type === 'audio') ||
        Math.abs(Number(probe.format?.duration) - params.duration) > 0.35 || !Number.isFinite(Number(probe.format?.duration))) throw Error('render_probe_mismatch');
    const outputSha256 = hash(await readFile(temporary));
    await rename(temporary, draft);
    const receipt = { schemaVersion: 1, requestId, destination, version: manifest.version, manifestSha: manifest.sha,
      engineSha256: manifest.engineSha256, experiment: request.experiment ?? null, comparison, actualParams: params,
      sourceSha256: source.sha, startSeconds: start, draftFile, outputSha256, renderedAt: now.toISOString(), costUsd: 0 };
    const receiptPath = path.join(receiptRoot, outputSha256 + '.json');
    await writeFile(receiptPath, JSON.stringify(receipt) + '\n', { mode: 0o600, flag: 'wx' });
    return { ...receipt, receiptSha256: fingerprint(receipt) };
  } catch (error) {
    await rm(draft, { force: true });
    throw error;
  } finally {
    await Promise.all([rm(overlay, { force: true }), rm(temporary, { force: true }), rm(sourceCopy, { force: true })]);
  }
}
export async function confirmedRenderReceipt(root, asset, destination) {
  if (!SHA.test(asset.renderReceiptSha256 ?? '') || !SHA.test(asset.mediaSha256 ?? '')) return null;
  const receipt = await ownerJson(root, path.join(RECEIPT_ROOT, asset.mediaSha256 + '.json'), null);
  if (!receipt || fingerprint(receipt) !== asset.renderReceiptSha256 || receipt.requestId !== asset.id ||
      receipt.outputSha256 !== asset.mediaSha256 || receipt.draftFile !== asset.draftFile ||
      !findDestination(receipt.destination) || destinationKey(receipt.destination) !== destinationKey(destination) ||
      receipt.version !== asset.policyVersion || receipt.costUsd !== 0 ||
      fingerprint(receipt.experiment) !== fingerprint(asset.experiment ?? null)) return null;
  const { manifest, comparison } = await selecting(root, destination, asset);
  if (receipt.engineSha256 !== manifest.engineSha256 || receipt.manifestSha !== manifest.sha ||
      fingerprint(receipt.actualParams) !== fingerprint(manifest.params) ||
      fingerprint(receipt.comparison) !== fingerprint(comparison) ||
      clock(asset.scheduledAt) !== manifest.params.posting_slot ||
      (await mediaBytes(root, asset.draftFile)).sha !== receipt.outputSha256) return null;
  return { manifestSha: receipt.manifestSha, engineSha256: receipt.engineSha256, comparison };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const [arg, value] = process.argv.slice(2);
  if (arg === '--engine-sha' && !value) console.log(ENGINE_SHA256);
  else if (arg === '--request' && value && process.env.CLIPPERS_WORKSPACE_ROOT) {
    console.log(JSON.stringify(await renderClippersPortfolio({ workspaceRoot: process.env.CLIPPERS_WORKSPACE_ROOT, requestId: value }), null, 2));
  } else throw Error('usage: --engine-sha | --request <id> with CLIPPERS_WORKSPACE_ROOT');
}
