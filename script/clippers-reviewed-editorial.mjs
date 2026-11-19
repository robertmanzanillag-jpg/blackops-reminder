import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { chmod, lstat, mkdir, mkdtemp, open, readdir, realpath, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { canonicalSourceIdentity } from '../shared/clippers-priority-creators.mjs';
import { destinationKey, findDestination, findPublishDestination, localDay, providerTimestamp } from './clippers-portfolio-metricool.mjs';
import { readWeeklyPrivateJson, validWeeklyWindow, weeklyDigest } from './clippers-weekly-policy.mjs';
import { editorialEngineSha256, renderEditorialMp4 } from './clippers-reviewed-editorial-engine.mjs';

export const REVIEWED_EDITORIAL = 'reviewed_editorial';
const CONFIG = 'config/clippers-daily-learning';
const RECEIPTS = 'reports/clippers-daily-learning/editorial-render-receipts';
const DRAFTS = 'drafts/portfolio/editorial';
const HOUR = 3_600_000;
const ID = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,99}$/;
const SHA = /^[a-f0-9]{64}$/;
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const id = value => typeof value === 'string' && ID.test(value);
const sha = value => typeof value === 'string' && SHA.test(value);
const same = (a, b) => weeklyDigest(a ?? null) === weeklyDigest(b ?? null);
const scoped = (a, b) => !!findDestination(a) && !!findDestination(b) && destinationKey(a) === destinationKey(b);

function sourceUrl(value) {
  try {
    const url = new URL(value);
    if (typeof value === 'string' && url.protocol === 'https:' && !url.username && !url.password && !url.port) return url;
  } catch {}
  return null;
}
function originalIdentity(value) {
  const url = sourceUrl(value);
  if (!url) return null;
  const canonical = canonicalSourceIdentity(value);
  return canonical ?? (['youtube.com', 'www.youtube.com', 'm.youtube.com', 'youtu.be'].includes(url.hostname)
    ? null : url.origin + url.pathname);
}
function exactEditorialShape(value) {
  return value?.renderClass === REVIEWED_EDITORIAL && !['experiment', 'comparison', 'policyVersion'].some(key => Object.hasOwn(value, key));
}
function timestamp(value) {
  const iso = providerTimestamp(value);
  return iso ? Date.parse(iso) : NaN;
}
function validDate(value) {
  return value instanceof Date && Number.isFinite(+value);
}

function validAuthorization(context, now, window, requireFreshSource = true) {
  const { authorization: a, rights, license } = context;
  const slot = timestamp(a.scheduledAt), published = timestamp(rights.sourcePublishedAt);
  const observed = timestamp(rights.observedAt), reviewed = timestamp(a.reviewedAt);
  const startDate = a.windowStart, endDate = a.windowEnd;
  if (!validDate(now) || !Number.isFinite(slot) || providerTimestamp(a.scheduledAt) !== a.scheduledAt ||
      !(slot >= +now + 300_000) || !(published <= +now) || (requireFreshSource && +now - published >= 72 * HOUR) ||
      !(observed <= reviewed && reviewed <= +now) || !(+now - observed <= 24 * HOUR) ||
      !(timestamp(a.expiresAt) >= slot && timestamp(rights.validUntil) >= slot) ||
      (license.permissionExpiresAt !== null && !(timestamp(license.permissionExpiresAt) >= slot)) ||
      !validWeeklyWindow({ startDate, endDate }, now)) return false;
  const day = localDay(new Date(slot));
  const weekEnd = new Date(localDay(now) + 'T12:00:00Z');
  weekEnd.setUTCDate(weekEnd.getUTCDate() + (7 - weekEnd.getUTCDay()) % 7);
  return endDate <= weekEnd.toISOString().slice(0, 10) && day >= startDate && day <= endDate &&
    (!window || (validWeeklyWindow(window, now) && day >= window.startDate && day <= window.endDate));
}

function validCrop(crop) {
  if (['left', 'center', 'right'].includes(crop)) return true;
  return !!crop && typeof crop === 'object' && Object.keys(crop).length === 4 &&
    ['x', 'y', 'width', 'height'].every(key => Number.isSafeInteger(crop[key]) && crop[key] >= 0 && crop[key] <= 16_384) &&
    crop.width >= 32 && crop.height >= 32;
}

function validSubtitles(subtitles, duration) {
  if (subtitles === undefined) return true;
  if (!Array.isArray(subtitles) || subtitles.length > 45) return false;
  let previousEnd = 0;
  for (const cue of subtitles) {
    if (!cue || Object.keys(cue).length !== 3 || !Number.isFinite(cue.startSeconds) || !Number.isFinite(cue.endSeconds) ||
        cue.startSeconds < previousEnd || cue.endSeconds > duration || cue.endSeconds - cue.startSeconds < 0.2 ||
        typeof cue.text !== 'string' || !cue.text.trim() || cue.text.length > 100 || /[\x00-\x1f@%\\]/.test(cue.text)) return false;
    previousEnd = cue.endSeconds;
  }
  return true;
}

function cardText(value, maxLength) {
  return typeof value === 'string' && !!value.trim() && value.length <= maxLength && !/[\x00-\x1f@%\\]/.test(value);
}

function validVisualPlan(plan, params) {
  if (plan === undefined) return validCrop(params.crop);
  if (!plan || plan.kind !== 'owned_cards' || Object.keys(plan).length !== 2 || params.crop !== null ||
      params.caption_layout !== 'off' || !Array.isArray(plan.cards) || plan.cards.length < 2 || plan.cards.length > 3) return false;
  let end = 0;
  for (const card of plan.cards) {
    if (!card || Object.keys(card).length !== 4 || card.startSeconds !== end || !Number.isFinite(card.endSeconds) ||
        card.endSeconds - card.startSeconds < 1 || !cardText(card.heading, 55) || !cardText(card.body, 170)) return false;
    end = card.endSeconds;
  }
  return end === params.duration;
}

function sourceDateMetadata(rights) {
  if (rights.sourceDatePrecision === undefined && rights.sourcePublishedDate === undefined) return {};
  return { sourceDatePrecision: rights.sourceDatePrecision, sourcePublishedDate: rights.sourcePublishedDate };
}

function validSourceDate(rights) {
  if (rights.sourceDatePrecision === undefined && rights.sourcePublishedDate === undefined) return true;
  const canonical = providerTimestamp(rights.sourcePublishedAt);
  return rights.sourceDatePrecision === 'date_only' && typeof rights.sourcePublishedDate === 'string' &&
    canonical === rights.sourcePublishedDate + 'T00:00:00.000Z';
}

async function loadAuthorization(root, requestId, { historical = false } = {}) {
  if (!id(requestId)) throw Error('editorial_request_invalid');
  const request = await readWeeklyPrivateJson(root, `${CONFIG}/render-requests/${requestId}.json`);
  const destination = historical ? findDestination(request) : findPublishDestination(request);
  if (!destination || request.id !== requestId || request.schemaVersion !== 2 ||
      !exactEditorialShape(request) || !sha(request.authorizationSha256)) throw Error('editorial_request_invalid');
  const authorization = await readWeeklyPrivateJson(root, `${CONFIG}/editorial-authorizations/${request.authorizationSha256}.json`);
  const a = authorization, rights = a?.rights, params = a?.params;
  if (!a || a.schemaVersion !== 2 || a.kind !== 'reviewed_editorial_authorization' ||
      a.id !== requestId || !scoped(a.destination, destination) || !id(a.reviewedBy) ||
      weeklyDigest(a) !== request.authorizationSha256 || !sha(a.licenseEvidenceSha256) ||
      a.engineSha256 !== editorialEngineSha256 ||
      !originalIdentity(a.sourceUrl) || !sha(a.sourceSha256) ||
      typeof a.sourceFile !== 'string' || !/\.(mp4|mov)$/i.test(a.sourceFile) ||
      !Number.isFinite(a.sourceStartSeconds) || a.sourceStartSeconds < 0 ||
      !params || Object.keys(params).length !== 3 || !Number.isFinite(params.duration) || params.duration < 5 || params.duration > 90 ||
      !validVisualPlan(a.visualPlan, params) || !['off', 'upper', 'lower', 'header'].includes(params.caption_layout) ||
      !validSubtitles(a.subtitles, params.duration) ||
      (params.caption_layout === 'off' ? a.captionText !== '' :
        typeof a.captionText !== 'string' || !a.captionText.trim() || a.captionText.length > 160 || /[\x00-\x1f@%\\]/.test(a.captionText))) throw Error('editorial_authorization_invalid');
  const license = await readWeeklyPrivateJson(root, `${CONFIG}/rights-evidence/${a.licenseEvidenceSha256}.json`);
  if (!license || license.schemaVersion !== 1 || license.kind !== 'reviewed_exact_asset_license' ||
      weeklyDigest(license) !== a.licenseEvidenceSha256 ||
      !Object.hasOwn(license, 'permissionExpiresAt') || !id(license.reviewedBy) || !id(rights?.reviewedBy) ||
      !scoped(license.destination, destination) || !scoped(rights.destination, destination) ||
      license.sourceUrl !== a.sourceUrl || license.sourceSha256 !== a.sourceSha256 || rights.sourceSha256 !== a.sourceSha256 ||
      !sourceUrl(rights.termsUrl) || !validSourceDate(rights) || rights.commercialPermission !== 'approved' || rights.sourceScope !== 'exact_asset' ||
      typeof rights.thirdPartyCommercial !== 'boolean' || !Array.isArray(rights.permittedNetworks) ||
      !rights.permittedNetworks.includes(destination.network) ||
      !['sourcePublishedAt', 'observedAt', 'validUntil', 'termsUrl', 'sourceScope', 'commercialPermission',
        'basis', 'membership', 'ownership', 'permittedNetworks', 'thirdPartyCommercial', 'sourceDatePrecision', 'sourcePublishedDate'].every(key => same(rights[key], license[key])) ||
      !((rights.basis === 'campaign' && rights.membership === 'verified') ||
        (rights.basis === 'public_policy' && rights.membership === 'not_required') ||
        (rights.basis === 'owned' && rights.membership === 'not_required' && rights.ownership === 'verified')) ||
      !['exact_destination_only', 'licensed_crosspost'].includes(license.reuseScope) ||
      (rights.basis === 'campaign' && license.reuseScope !== 'exact_destination_only') ||
      (rights.basis === 'public_policy' && (typeof license.requiredAttribution !== 'string' || !license.requiredAttribution.trim())) ||
      (license.requiredAttribution !== undefined &&
        (typeof license.requiredAttribution !== 'string' || !license.requiredAttribution.trim() || license.requiredAttribution.length > 1800))) throw Error('editorial_license_invalid');
  return { request, destination, authorization, rights, license };
}

async function readMedia(root, relative, expectedSha, privateFile = false) {
  if (path.isAbsolute(relative)) throw Error('editorial_media_path_invalid');
  const file = path.resolve(root, relative);
  if (!file.startsWith(root + path.sep) || await realpath(file) !== file) throw Error('editorial_media_path_invalid');
  const fd = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const before = await fd.stat();
    if (!before.isFile() || before.nlink !== 1 || before.size < 1 || before.size > 250_000_000 ||
        before.mode & (privateFile ? 0o077 : 0o022) || (process.getuid && before.uid !== process.getuid())) throw Error('editorial_media_invalid');
    const bytes = Buffer.allocUnsafe(before.size + 1);
    let count = 0;
    while (count < bytes.length) {
      const { bytesRead } = await fd.read(bytes, count, bytes.length - count, null);
      if (!bytesRead) break;
      count += bytesRead;
    }
    const after = await fd.stat();
    if (count !== before.size || before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs ||
        hash(bytes.subarray(0, count)) !== expectedSha) throw Error('editorial_media_bytes_changed');
    return bytes.subarray(0, count);
  } finally {
    await fd.close();
  }
}

async function privateDirectory(root, relative) {
  const dir = path.join(root, relative);
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const info = await lstat(dir);
  if (!info.isDirectory() || info.mode & 0o077 || (process.getuid && info.uid !== process.getuid()) || await realpath(dir) !== dir) {
    throw Error('editorial_private_directory_invalid');
  }
  return dir;
}

function validateReceipt(context, receipt, now) {
  const { request, authorization: a, destination } = context;
  const renderedAt = timestamp(receipt?.renderedAt);
  const expectedPath = new RegExp('^' + DRAFTS + '/' + request.id.replaceAll('.', '\\.') + '-[A-Za-z0-9]+/clip\\.mp4$');
  if (!receipt || receipt.schemaVersion !== 2 || !exactEditorialShape(receipt) || receipt.requestId !== request.id ||
      !scoped(receipt.destination, destination) || receipt.authorizationSha256 !== request.authorizationSha256 ||
      receipt.renderRequestSha256 !== weeklyDigest(request) || receipt.engineSha256 !== a.engineSha256 ||
      receipt.sourceSha256 !== a.sourceSha256 || receipt.startSeconds !== a.sourceStartSeconds ||
      receipt.endSeconds !== a.sourceStartSeconds + a.params.duration || !same(receipt.actualParams, a.params) ||
      receipt.captionTextSha256 !== hash(a.captionText) || receipt.subtitlesSha256 !== weeklyDigest(a.subtitles ?? []) ||
      receipt.visualPlanSha256 !== weeklyDigest(a.visualPlan ?? null) ||
      receipt.scheduledAt !== a.scheduledAt ||
      !sha(receipt.outputSha256) || !Number.isSafeInteger(receipt.outputSizeBytes) || receipt.outputSizeBytes < 1 ||
      ![receipt.outputDurationSeconds, receipt.outputAudioDurationSeconds].every(duration =>
        Number.isFinite(duration) && Math.abs(duration - a.params.duration) <= 0.35) ||
      !expectedPath.test(receipt.draftFile ?? '') || receipt.costUsd !== 0 || !(renderedAt <= +now) ||
      !validAuthorization(context, new Date(renderedAt))) throw Error('editorial_render_receipt_invalid');
}

export async function renderReviewedEditorial({ workspaceRoot, requestId, now = new Date() }) {
  const started = performance.now();
  const current = () => new Date(+now + performance.now() - started);
  const root = await realpath(path.resolve(workspaceRoot));
  const context = await loadAuthorization(root, requestId);
  const { request, authorization: a, destination } = context;
  const receiptPath = `${RECEIPTS}/${requestId}.json`;
  const receiptDir = await privateDirectory(root, RECEIPTS);
  const lockPath = path.join(receiptDir, requestId + '.lock');
  const lock = await open(lockPath, 'wx', 0o600).catch(error => {
    if (error.code === 'EEXIST') throw Error('editorial_render_busy');
    throw error;
  });
  let work, stagedReceipt, committed = false;
  try {
    const prior = await readWeeklyPrivateJson(root, receiptPath, null);
    if (prior) {
      validateReceipt(context, prior, current());
      const bytes = await readMedia(root, prior.draftFile, prior.outputSha256, true);
      if (bytes.length !== prior.outputSizeBytes) throw Error('editorial_media_bytes_changed');
      return { ...prior, receiptSha256: weeklyDigest(prior) };
    }
    if (!validAuthorization(context, current())) throw Error('editorial_authorization_expired_or_slot_invalid');
    const source = await readMedia(root, a.sourceFile, a.sourceSha256);
    const draftRoot = await privateDirectory(root, DRAFTS);
    work = await mkdtemp(path.join(draftRoot, requestId + '-'));
    const input = path.join(work, 'source.mp4');
    const output = path.join(work, 'clip.mp4');
    const overlay = path.join(work, 'overlay.png');
    await writeFile(input, source, { mode: 0o600, flag: 'wx' });
    const outputMeasurements = await renderEditorialMp4({ source: input, output, overlay, start: a.sourceStartSeconds,
      params: a.params, captionText: a.captionText, subtitles: a.subtitles ?? [], visualPlan: a.visualPlan });
    await chmod(output, 0o600);
    const measured = await open(output, constants.O_RDONLY | constants.O_NOFOLLOW);
    let outputSha256, outputSizeBytes;
    try {
      const info = await measured.stat();
      if (!info.isFile() || info.size < 1 || info.size > 250_000_000) throw Error('editorial_media_invalid');
      const bytes = await measured.readFile();
      outputSha256 = hash(bytes);
      outputSizeBytes = bytes.length;
    } finally {
      await measured.close();
    }
    const receipt = { schemaVersion: 2, renderClass: REVIEWED_EDITORIAL, requestId, destination,
      authorizationSha256: request.authorizationSha256, engineSha256: a.engineSha256, renderRequestSha256: weeklyDigest(request),
      sourceSha256: a.sourceSha256, startSeconds: a.sourceStartSeconds, endSeconds: a.sourceStartSeconds + a.params.duration,
      actualParams: a.params, captionTextSha256: hash(a.captionText), subtitlesSha256: weeklyDigest(a.subtitles ?? []), visualPlanSha256: weeklyDigest(a.visualPlan ?? null),
      scheduledAt: a.scheduledAt,
      draftFile: path.relative(root, output), outputSha256, outputSizeBytes, ...outputMeasurements, renderedAt: current().toISOString(), costUsd: 0 };
    validateReceipt(context, receipt, current());
    for (const file of await readdir(work)) {
      if (file !== 'clip.mp4') await rm(path.join(work, file));
    }
    stagedReceipt = path.join(receiptDir, path.basename(work) + '.tmp');
    await writeFile(stagedReceipt, JSON.stringify(receipt) + '\n', { mode: 0o600, flag: 'wx' });
    await rename(stagedReceipt, path.join(root, receiptPath));
    committed = true;
    return { ...receipt, receiptSha256: weeklyDigest(receipt) };
  } finally {
    if (work && !committed) await rm(work, { recursive: true, force: true });
    if (stagedReceipt) await rm(stagedReceipt, { force: true });
    try {
      const held = await lock.stat();
      const currentLock = await lstat(lockPath).catch(() => null);
      if (held.ino === currentLock?.ino && held.dev === currentLock?.dev) await rm(lockPath);
    } finally {
      await lock.close();
    }
  }
}

export async function readReviewedEditorialPacket(root, requestId, { now = new Date(), window, historical = false } = {}) {
  const context = await loadAuthorization(root, requestId, { historical });
  const { request, authorization: a, rights, license, destination } = context;
  const receipt = await readWeeklyPrivateJson(root, `${RECEIPTS}/${requestId}.json`);
  validateReceipt(context, receipt, now);
  // Source recency is verified at render. Dispatch also requires a current rights review and the exact future slot.
  if (!historical && !validAuthorization(context, now, window, false)) throw Error('editorial_authorization_expired_or_slot_invalid');
  const packet = await readWeeklyPrivateJson(root, `${CONFIG}/prepare-requests/${requestId}.json`);
  const packetReviewed = timestamp(packet?.reviewedAt);
  if (packet?.schemaVersion !== 2 || !exactEditorialShape(packet) || packet.id !== requestId ||
      !scoped(packet.destination, destination) || packet.authorizationSha256 !== request.authorizationSha256 ||
      packet.renderRequestSha256 !== weeklyDigest(request) || packet.renderReceiptSha256 !== weeklyDigest(receipt) ||
      packet.outputSha256 !== receipt.outputSha256 || packet.sourceUrl !== a.sourceUrl || packet.scheduledAt !== a.scheduledAt ||
      packet.thirdPartyCommercial !== rights.thirdPartyCommercial || !id(packet.reviewedBy) || !id(packet.campaignId) ||
      !id(packet.sourceId) || !id(packet.creator) || !/^[a-z]{2,3}(?:-[A-Z]{2})?$/.test(packet.language ?? '') ||
      typeof packet.caption !== 'string' || !packet.caption.trim() || packet.caption.length > 2200 ||
      (license.requiredAttribution && !packet.caption.includes(license.requiredAttribution)) ||
      (a.visualPlan && !packet.caption.toLowerCase().includes('excerpt + editorial graphics')) ||
      ![undefined, 'google_drive', 'metricool'].includes(packet.mediaProvider) ||
      !(packetReviewed >= timestamp(receipt.renderedAt) && packetReviewed <= +now && packetReviewed < timestamp(a.scheduledAt)) ||
      packet.publicUploadAuthorized !== true || packet.schedulerAssetAuthorized !== true || packet.quality !== 'passed' ||
      packet.originalEdit !== 'verified' || packet.disclosure !== 'verified' || packet.authorizedSpendUsd !== 0 ||
      packet.providerIncrementalCostUsd !== 0) throw Error('editorial_reviewed_output_required');
  const bytes = await readMedia(root, receipt.draftFile, receipt.outputSha256, true);
  if (bytes.length !== receipt.outputSizeBytes) throw Error('editorial_media_bytes_changed');
  const asset = { ...destination, id: requestId, campaignId: packet.campaignId, sourceId: packet.sourceId, sourceUrl: a.sourceUrl,
    creator: packet.creator, language: packet.language, caption: packet.caption, scheduledAt: a.scheduledAt,
    renderClass: REVIEWED_EDITORIAL, weeklyAuthorizationSha256: request.authorizationSha256, preparePacketSha256: weeklyDigest(packet),
    renderReceiptSha256: packet.renderReceiptSha256, mediaSha256: receipt.outputSha256, draftFile: receipt.draftFile,
    thirdPartyCommercial: rights.thirdPartyCommercial, sourcePublishedAt: rights.sourcePublishedAt,
    rightsObservedAt: rights.observedAt, rightsValidUntil: rights.validUntil, ...sourceDateMetadata(rights) };
  return { ...context, asset, packet, receipt, bytes };
}

export async function readConfirmedReviewedEditorial(root, asset, options) {
  if (!exactEditorialShape(asset)) throw Error('editorial_asset_binding_invalid');
  const { bytes, ...confirmed } = await readReviewedEditorialPacket(root, asset.id, options);
  if (!Object.entries(confirmed.asset).every(([key, value]) => same(value, asset[key]))) throw Error('editorial_asset_binding_invalid');
  return confirmed;
}

export function reviewedEditorialSourceProof({ authorization: a, rights, license, receipt, request }) {
  return { authorizationSha256: request.authorizationSha256, rightsBasis: rights.basis, membership: rights.membership,
    termsUrl: rights.termsUrl, ...(rights.ownership ? { ownership: rights.ownership } : {}),
    ...sourceDateMetadata(rights), reuseScope: license.reuseScope, sourceSha256: a.sourceSha256, originalSourceSha256: a.sourceSha256,
    sourceIdentity: originalIdentity(a.sourceUrl), startSeconds: receipt.startSeconds, endSeconds: receipt.endSeconds };
}

async function cli() {
  const args = process.argv.slice(2);
  if (args.length === 1 && args[0] === '--engine-sha') {
    console.log(editorialEngineSha256);
    return;
  }
  const ids = args.filter((_, i) => i % 2 === 1);
  if (ids.length < 1 || ids.length > 100 || args.length !== ids.length * 2 ||
      args.some((arg, i) => i % 2 === 0 && arg !== '--asset') || !ids.every(id) ||
      new Set(ids).size !== ids.length || !process.env.CLIPPERS_WORKSPACE_ROOT) throw Error('editorial_cli_usage');
  for (const requestId of ids) {
    try {
      const result = await renderReviewedEditorial({ workspaceRoot: process.env.CLIPPERS_WORKSPACE_ROOT, requestId });
      console.log(JSON.stringify({ status: 'rendered', ...result }));
    } catch (error) {
      const reason = /^editorial_[a-z_]+$/.test(error.message) ? error.message : 'editorial_input_unverified';
      console.log(JSON.stringify({ status: 'held', requestId, reason }));
      process.exitCode = 1;
    }
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try { await cli(); } catch { console.error('Usage: clippers-reviewed-editorial.mjs --asset ID [--asset ID ...] or --engine-sha'); process.exitCode = 1; }
}
