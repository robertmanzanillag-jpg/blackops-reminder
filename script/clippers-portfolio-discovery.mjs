import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { mkdir, open, realpath, readdir, unlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const HOUR = 3_600_000;
const MAX_BYTES = 262_144;
const MAX_ENTRIES = 25;
const CHANNEL = /^UC[A-Za-z0-9_-]{22}$/;
const VIDEO = /^[A-Za-z0-9_-]{11}$/;
const hash = value => createHash('sha256').update(value).digest('hex');

// Verified 2026-11-18 against each public handle page's link rel=canonical.
// A canonical identity is not a clipping licence. Keep this separate from approved assets.
export const DISCOVERY_CREATORS = Object.freeze([
  ['thegrefg', 'TheGrefg', 'UCCEmjNPpJYhGDgaEqeeA4HA', 'es'],
  ['vegetta777', 'vegetta777', 'UCam8T03EOFBsNdR0thrFHdQ', 'es'],
  ['rubius', 'elrubiusOMG', 'UCXazgXDIYyWH-yXLAkcrFxw', 'es'],
  ['lacy', 'LacyHimself', 'UCeoZXkaJDtdTHafgoZeDcAA', 'en'],
  ['alanzoka', 'alanzoka', 'UCIwspRtKNszHhIhl36gREjQ', 'pt-BR'],
  ['gotaga', 'Gotaga', 'UCCFqUJYKT97UerMmb6DM0bw', 'fr'],
  ['papaplatte', 'Papaplatte', 'UCDmbhGe7-wC1a55l5ZYAZJw', 'de'],
  ['k4sen', 'zzxk4sen', 'UChUjERVG8eKEAJSCef-tTmg', 'ja'],
].map(([id, handle, channelId, language]) => Object.freeze({
  id, handle, channelId, language,
  identityEvidenceUrl: `https://www.youtube.com/@${handle}`,
  identityVerifiedAt: '2026-11-18T04:36:15.000Z',
})));

export function feedUrl(channelId) {
  if (!CHANNEL.test(channelId ?? '')) throw new Error('invalid_channel_id');
  return `https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`;
}

export function assertFeedUrl(value) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.hostname !== 'www.youtube.com' || url.username || url.password ||
      url.port || url.hash || url.pathname !== '/feeds/videos.xml' ||
      [...url.searchParams.keys()].join(',') !== 'channel_id' ||
      !CHANNEL.test(url.searchParams.get('channel_id') ?? '')) throw new Error('unsafe_feed_url');
  return url.href;
}

function xmlText(value) {
  if (value.length > 5_000 || /[<>]/.test(value)) throw new Error('invalid_xml_text');
  return value.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (_, entity) => {
    const named = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
    if (named[entity]) return named[entity];
    const code = entity[1]?.toLowerCase() === 'x' ? parseInt(entity.slice(2), 16) : Number(entity.slice(1));
    if (!Number.isInteger(code) || code < 32 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) {
      throw new Error('invalid_xml_entity');
    }
    return String.fromCodePoint(code);
  }); // Decoding is text only; never rendered as markup.
}

function tag(body, name, required = true) {
  const matches = [...body.matchAll(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${name}>`, 'g'))];
  if (matches.length !== 1) {
    if (!required && matches.length === 0) return null;
    throw new Error('missing_or_duplicate_feed_field');
  }
  if (/&(?!(?:amp|lt|gt|quot|apos|#\d+|#x[\da-f]+);)/i.test(matches[0][1])) throw new Error('unknown_xml_entity');
  return xmlText(matches[0][1]).trim();
}

function timestamp(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?(?:Z|[+-]\d\d:\d\d)$/.test(value)) {
    throw new Error('invalid_feed_timestamp');
  }
  const time = Date.parse(value);
  if (!Number.isFinite(time)) throw new Error('invalid_feed_timestamp');
  const offset = value.match(/([+-])(\d\d):(\d\d)$/);
  const offsetMinutes = offset ? (Number(offset[2]) * 60 + Number(offset[3])) * (offset[1] === '+' ? 1 : -1) : 0;
  if (new Date(time + offsetMinutes * 60_000).toISOString().slice(0, 19) !== value.slice(0, 19)) throw new Error('invalid_feed_timestamp');
  return new Date(time).toISOString();
}

export function parseYouTubeFeed(xml, creator, observedAt = new Date().toISOString()) {
  const observed = Date.parse(observedAt);
  if (!Number.isFinite(observed)) throw new Error('invalid_observation_time');
  if (typeof xml !== 'string' || Buffer.byteLength(xml) > MAX_BYTES ||
      /<!\s*(?:DOCTYPE|ENTITY)|<!\[CDATA\[/i.test(xml) ||
      !/^\s*(?:<\?xml[^?]*\?>\s*)?<feed\b/.test(xml) || !/<\/feed>\s*$/.test(xml) ||
      !xml.includes('xmlns="http://www.w3.org/2005/Atom"') ||
      !xml.includes('xmlns:yt="http://www.youtube.com/xml/schemas/2015"') ||
      !xml.includes('xmlns:media="http://search.yahoo.com/mrss/"')) throw new Error('unsafe_or_invalid_feed_xml');
  const entries = [...xml.matchAll(/<entry(?:\s[^>]*)?>([\s\S]*?)<\/entry>/g)];
  if (entries.length > MAX_ENTRIES || (xml.match(/<entry\b/g) ?? []).length !== entries.length) throw new Error('invalid_feed_entries');
  const header = xml.slice(0, entries[0]?.index ?? xml.lastIndexOf('</feed>'));
  // YouTube's feed header omits the UC prefix; entry IDs retain it. Bind both
  // representations to the exact author URI rather than trusting a feed title.
  if (![creator.channelId, creator.channelId.slice(2)].includes(tag(header, 'yt:channelId')) ||
      tag(header, 'uri') !== `https://www.youtube.com/channel/${creator.channelId}`) throw new Error('feed_channel_mismatch');
  const seen = new Set();
  const observations = [];
  const rejected = [];
  for (const [, body] of entries) {
    const videoId = tag(body, 'yt:videoId');
    if (!VIDEO.test(videoId) || tag(body, 'yt:channelId') !== creator.channelId) throw new Error('entry_identity_mismatch');
    if (seen.has(videoId)) throw new Error('duplicate_feed_video');
    seen.add(videoId);
    const publishedAt = timestamp(tag(body, 'published'));
    if (Date.parse(publishedAt) > observed) {
      rejected.push({ videoId, reason: 'future_published_at' });
      continue;
    }
    const statistics = [...body.matchAll(/<media:statistics\b([^>]*)\/?\s*>/g)];
    if (statistics.length > 1) throw new Error('duplicate_view_statistic');
    let views = null;
    if (statistics.length) {
      const count = statistics[0][1].match(/(?:^|\s)views="(\d+)"(?:\s|\/|$)/);
      if (count && Number.isSafeInteger(Number(count[1]))) views = Number(count[1]);
    }
    const ageHours = (observed - Date.parse(publishedAt)) / HOUR;
    observations.push({
      creatorId: creator.id, channelId: creator.channelId, videoId, network: 'youtube',
      creatorLanguage: creator.language, language: null, format: 'unknown',
      title: tag(body, 'title').slice(0, 500), url: `https://www.youtube.com/watch?v=${videoId}`,
      sourceUrl: feedUrl(creator.channelId), publishedAt, observedAt: new Date(observed).toISOString(),
      views, metricEvidence: views === null ? 'not_provided' : 'direct_public_feed',
      ageHours, freshness: ageHours <= 24 ? 'preferred_under_24h' : ageHours <= 72 ? 'recent_under_72h' : 'stale',
      topicHint: /\b(?:GTA\s*(?:VI|6)|Grand Theft Auto)\b/i.test(tag(body, 'title')) ? 'gta' : 'unclassified',
      permission: 'unknown', mayPublish: false,
    });
  }
  return { observations, rejected };
}

export async function fetchYouTubeFeed(creator, { fetchImpl = fetch, now = new Date(), timeoutMs = 10_000 } = {}) {
  const url = assertFeedUrl(feedUrl(creator.channelId));
  const response = await fetchImpl(url, {
    method: 'GET', redirect: 'error', credentials: 'omit', signal: AbortSignal.timeout(Math.min(timeoutMs, 15_000)),
    headers: { Accept: 'application/atom+xml,application/xml,text/xml', 'User-Agent': 'BlackOps-Public-Feed-Discovery/1.0' },
  });
  if (response.redirected || (response.url && response.url !== url)) throw new Error('feed_redirect_rejected');
  if (response.status !== 200) throw new Error(response.status === 429 ? 'feed_throttled' : `feed_http_${Number(response.status)}`);
  if (!/^(?:application\/(?:atom\+xml|xml)|text\/xml)(?:\s*;|$)/i.test(response.headers.get('content-type') ?? '')) {
    throw new Error('feed_content_type_rejected');
  }
  if (Number(response.headers.get('content-length')) > MAX_BYTES) throw new Error('feed_too_large');
  const reader = response.body.getReader();
  const chunks = [];
  let bytes = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      bytes += part.value.byteLength;
      if (bytes > MAX_BYTES) throw new Error('feed_too_large');
      chunks.push(Buffer.from(part.value));
    }
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error;
  } finally { reader.releaseLock(); }
  const xml = Buffer.concat(chunks).toString('utf8');
  return { feedSha256: hash(xml), ...parseYouTubeFeed(xml, creator, now.toISOString()) };
}

export function selectCreators(now = new Date(), ids) {
  if (!Number.isFinite(+now)) throw new Error('invalid_observation_time');
  if (ids !== undefined) {
    if (!Array.isArray(ids) || ids.length < 1 || ids.length > 4 || new Set(ids).size !== ids.length) throw new Error('one_to_four_unique_creators_required');
    return ids.map(id => {
      const creator = DISCOVERY_CREATORS.find(row => row.id === id);
      if (!creator) throw new Error('creator_not_in_verified_catalogue');
      return creator;
    });
  }
  // Eight verified feeds, four requests per day; all markets observed at least every 48h.
  const start = (Math.floor(+now / (24 * HOUR)) % 2) * 4;
  return DISCOVERY_CREATORS.slice(start, start + 4);
}

const median = values => {
  const sorted = [...values].sort((a, b) => a - b);
  return (sorted[Math.floor((sorted.length - 1) / 2)] + sorted[Math.floor(sorted.length / 2)]) / 2;
};

export function classifyDiscovery(observation, history) {
  const result = { mayPublish: false, causalClaim: false, statisticalSignificanceClaim: false, viewsPerHour: null, outlierRatio: null };
  if (observation.views === null || observation.metricEvidence !== 'direct_public_feed') return { ...result, status: 'views_unknown' };
  const prior = history.filter(row => row.channelId === observation.channelId && row.videoId === observation.videoId &&
    row.metricEvidence === 'direct_public_feed' && row.publishedAt === observation.publishedAt &&
    Number.isSafeInteger(row.views) && row.views >= 0 &&
    Date.parse(row.observedAt) >= Date.parse(observation.publishedAt) &&
    Date.parse(row.observedAt) <= Date.parse(observation.observedAt) - HOUR && row.views <= observation.views)
    .sort((a, b) => Date.parse(b.observedAt) - Date.parse(a.observedAt))[0];
  if (prior) result.viewsPerHour = (observation.views - prior.views) / ((Date.parse(observation.observedAt) - Date.parse(prior.observedAt)) / HOUR);
  if (!observation.language || observation.format === 'unknown') return { ...result, status: 'comparison_context_unknown' };
  const baselines = new Map();
  for (const row of history) {
    if (row.channelId === observation.channelId && row.videoId !== observation.videoId && row.network === observation.network &&
        row.language === observation.language && row.format === observation.format && row.metricEvidence === 'direct_public_feed' &&
        Number.isSafeInteger(row.views) && row.views >= 0 && Math.abs(row.ageHours - observation.ageHours) <= 1 &&
        Date.parse(row.observedAt) <= Date.parse(observation.observedAt)) baselines.set(row.videoId, row.views);
  }
  if (baselines.size < 5) return { ...result, status: 'five_same_context_baselines_required' };
  const reference = median([...baselines.values()]);
  if (!reference) return { ...result, status: 'zero_baseline' };
  return { ...result, status: 'research_comparison_only', baselineSamples: baselines.size, outlierRatio: observation.views / reference };
}

async function privateRead(file, fallback) {
  let handle;
  try {
    handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
    const info = await handle.stat();
    if (!info.isFile() || info.nlink !== 1 || info.size > 4_000_000 || (info.mode & 0o077) ||
        (process.getuid && info.uid !== process.getuid())) throw new Error('private_discovery_file_required');
    return JSON.parse(await handle.readFile('utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return fallback;
    throw error;
  } finally { await handle?.close(); }
}

async function privateCreate(file, value) {
  const handle = await open(file, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  try { await handle.writeFile(JSON.stringify(value, null, 2) + '\n'); await handle.sync(); }
  finally { await handle.close(); }
}

function validReceipt(value, day, creators) {
  if (value?.schemaVersion !== 1 || value.day !== day || value.mayPublish !== false || value.permission !== 'unknown' ||
      value.eligibleAssets !== 0 || value.paidSpendUsd !== 0 || !Array.isArray(value.feeds) ||
      value.feeds.length !== creators.length || !Array.isArray(value.observations) || value.observations.length > 100 ||
      !value.feeds.every((row, index) => row.creatorId === creators[index].id && row.channelId === creators[index].channelId &&
        row.sourceUrl === feedUrl(creators[index].channelId) && ['observed', 'unavailable'].includes(row.status)) ||
      !value.observations.every(row => row.permission === 'unknown' && row.mayPublish === false &&
        creators.some(creator => creator.channelId === row.channelId && creator.id === row.creatorId) && VIDEO.test(row.videoId) &&
        row.url === `https://www.youtube.com/watch?v=${row.videoId}` && Number.isFinite(Date.parse(row.publishedAt)) &&
        Number.isFinite(Date.parse(row.observedAt)) && Date.parse(row.observedAt) >= Date.parse(row.publishedAt))) {
    throw new Error('invalid_discovery_receipt');
  }
  return value;
}

export async function runPortfolioDiscovery({ stateDir, now = new Date(), creatorIds, fetchImpl = fetch } = {}) {
  if (!stateDir || !path.isAbsolute(stateDir)) throw new Error('absolute_discovery_directory_required');
  const creators = selectCreators(now, creatorIds);
  await mkdir(stateDir, { recursive: true, mode: 0o700 });
  if (await realpath(stateDir) !== stateDir) throw new Error('discovery_directory_symlink_rejected');
  const day = now.toISOString().slice(0, 10);
  const receiptFile = path.join(stateDir, `${day}-${hash(creators.map(row => row.id).sort().join(',')).slice(0, 16)}.json`);
  const existing = await privateRead(receiptFile, null);
  if (existing) return { ...validReceipt(existing, day, creators), receiptFile, reused: true, networkRequestsThisInvocation: 0 };
  const lockFile = path.join(stateDir, '.discovery.lock');
  await privateCreate(lockFile, { createdAt: now.toISOString() });
  try {
    const afterLock = await privateRead(receiptFile, null);
    if (afterLock) return { ...validReceipt(afterLock, day, creators), receiptFile, reused: true, networkRequestsThisInvocation: 0 };
    const history = [];
    const historyFiles = (await readdir(stateDir)).filter(name => /^\d{4}-\d\d-\d\d-[a-f0-9]{16}\.json$/.test(name))
      .filter(name => Date.parse(name.slice(0, 10) + 'T00:00:00Z') >= +now - 8 * 24 * HOUR && name.slice(0, 10) <= day).sort().slice(-32);
    for (const name of historyFiles) {
      const prior = await privateRead(path.join(stateDir, name), null);
      if (prior?.schemaVersion !== 1 || !Array.isArray(prior.observations) || prior.observations.length > 100) throw new Error('invalid_discovery_history');
      history.push(...prior.observations);
    }
    const feeds = [], observations = [], rejected = [];
    for (const creator of creators) {
      try {
        const result = await fetchYouTubeFeed(creator, { fetchImpl, now });
        feeds.push({ creatorId: creator.id, channelId: creator.channelId, sourceUrl: feedUrl(creator.channelId), status: 'observed', feedSha256: result.feedSha256 });
        observations.push(...result.observations);
        rejected.push(...result.rejected.map(row => ({ creatorId: creator.id, ...row })));
      } catch (error) {
        const message = String(error.message);
        const code = /^[a-z][a-z0-9_]{1,80}$/.test(message) ? message : error.name === 'TimeoutError' ? 'feed_timeout' : 'feed_unavailable';
        feeds.push({ creatorId: creator.id, channelId: creator.channelId, sourceUrl: feedUrl(creator.channelId), status: 'unavailable', reason: code });
      }
    }
    observations.sort((a, b) => (a.freshness === 'stale') - (b.freshness === 'stale') || b.publishedAt.localeCompare(a.publishedAt));
    const observedFeeds = feeds.filter(row => row.status === 'observed').length;
    const receipt = { schemaVersion: 1, day, observedAt: now.toISOString(), paidSpendUsd: 0, mayPublish: false,
      status: observedFeeds === 0 ? 'blocked_no_feed_observations' : observedFeeds === feeds.length ? 'observed' : 'partial',
      permission: 'unknown', networkRequests: creators.length, feeds, rejected,
      observations: observations.map(row => ({ ...row, research: classifyDiscovery(row, history) })),
      eligibleAssets: 0, notice: 'Public metadata discovery is not rights approval, publication, or proof of a productive improvement.' };
    await privateCreate(receiptFile, receipt);
    return { ...receipt, receiptFile, reused: false, networkRequestsThisInvocation: creators.length };
  } finally { await unlink(lockFile); }
}

async function main(args) {
  let stateDir = path.join(os.homedir(), '.local/share/blackops/clippers-workspace/portfolio-discovery');
  let creatorIds;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--state-dir' && args[i + 1]) stateDir = args[++i];
    else if (args[i] === '--creators' && args[i + 1]) creatorIds = args[++i].split(',');
    else throw new Error('usage_node_script_clippers_portfolio_discovery_state_dir_or_creators');
  }
  const result = await runPortfolioDiscovery({ stateDir, creatorIds });
  console.log(JSON.stringify({ day: result.day, status: result.status, feeds: result.feeds, observations: result.observations.length,
    eligibleAssets: 0, paidSpendUsd: 0, mayPublish: false, reused: result.reused,
    networkRequestsThisInvocation: result.networkRequestsThisInvocation, receiptFile: result.receiptFile ?? null }, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main(process.argv.slice(2)).catch(error => { console.error(error.message); process.exitCode = 1; });
}
