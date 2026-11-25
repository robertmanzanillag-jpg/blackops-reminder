// Metricool adapter for social PUBLISHING (scripts side).
// Every Metricool-specific scheduling transport used by the .mjs scripts lives here (or in the
// Metricool client module it wraps, ../clippers-portfolio-metricool.mjs). Call sites never import
// those directly: they go through ./provider.mjs, selected by SOCIAL_PUBLISHING_PROVIDER.
// Neutral contract (see docs/social-publishing-provider.md): schedulePost / getPublication / cancel / freeSlots.
// `legacy` exposes the existing Metricool flows unchanged so behaviour stays identical.
import { createPortfolioMetricool, findDestination, confirmedNonPublishingDraft } from '../clippers-portfolio-metricool.mjs';

const API = 'https://app.metricool.com';
const METRICOOL_MCP_URL = 'https://ai.metricool.com/mcp';
const TIMEZONE = 'America/New_York';
const DAILY_SLOTS = ['10:00:00', '12:30:00', '15:00:00', '17:30:00', '20:00:00'];
const clean = (v) => (v === undefined || v === null ? '' : String(v).trim());

export function parseMcpEnvelope(raw, contentType = '') {
  if (/^text\/event-stream\b/i.test(contentType) || /^\s*(?:event:|data:)/m.test(raw)) {
    const events = raw.split(/\r?\n\r?\n/).flatMap((event) => {
      const data = event.split(/\r?\n/).filter((line) => line.startsWith('data:'))
        .map((line) => line.slice(5).trim()).join('\n');
      if (!data || data === '[DONE]') return [];
      return [JSON.parse(data)];
    });
    return events.findLast((event) => event?.result || event?.error) || events.at(-1);
  }
  return JSON.parse(raw);
}

/** Write: Metricool MCP createScheduledPost (moved verbatim from clippers-metricool-autopilot.mjs). */
export async function callMetricoolMcp(fetcher, token, args) {
  const response = await fetcher(METRICOOL_MCP_URL, {
    method: 'POST',
    headers: { 'X-Mc-Auth': token, 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
    body: JSON.stringify({ jsonrpc: '2.0', id: `clippers-${Date.now()}`, method: 'tools/call', params: { name: 'createScheduledPost', arguments: args } }),
    signal: AbortSignal.timeout(180_000),
  });
  const raw = await response.text();
  if (!response.ok) throw new Error(`Metricool MCP failed with HTTP ${response.status}`);
  const envelope = parseMcpEnvelope(raw, response.headers.get('content-type') || '');
  if (envelope?.error || envelope?.result?.isError) throw new Error('Metricool MCP rejected the scheduled post');
  return envelope?.result;
}

export function objects(value) {
  const found = [];
  const visit = (candidate) => {
    if (Array.isArray(candidate)) return candidate.forEach(visit);
    if (!candidate || typeof candidate !== 'object') return;
    found.push(candidate);
    Object.values(candidate).forEach(visit);
  };
  visit(value);
  return found;
}

export function verifiedRecordId(record) {
  const id = String(record?.id ?? record?.uuid ?? '').trim();
  return id && !/^(?:null|undefined|0)$/i.test(id) ? id : '';
}

function schedulerUrl(blogId, userId, startDate, endDate, encodeBlog = false) {
  return `${API}/api/v2/scheduler/posts?blogId=${encodeBlog ? encodeURIComponent(blogId) : blogId}`
    + `&userId=${encodeURIComponent(userId)}&integrationSource=MCP`
    + `&start=${startDate}T00%3A00%3A00&end=${endDate}T23%3A59%3A59`
    + `&timezone=${encodeURIComponent(TIMEZONE)}&extendedRange=false`;
}

export async function verifyMetricoolSchedule(fetcher, token, userId, blogId, caption, publicationDateTime, options = {}) {
  const date = publicationDateTime.slice(0, 10);
  const url = schedulerUrl(blogId, userId, date, date);
  const attempts = Math.max(1, Math.min(10, Math.trunc(Number(options.attempts ?? 6)) || 1));
  const delayMs = Math.max(0, Math.min(30_000, Math.trunc(Number(options.delayMs ?? 2_000)) || 0));
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (attempt && delayMs) await new Promise((resolve) => setTimeout(resolve, delayMs));
    const response = await fetcher(url, { headers: { 'X-Mc-Auth': token, accept: 'application/json' }, signal: AbortSignal.timeout(60_000) });
    if (!response.ok) throw new Error(`Metricool verification failed with HTTP ${response.status}`);
    const value = JSON.parse(await response.text());
    const match = objects(value).find((record) => {
      const text = String(record.text ?? record.caption ?? record.content ?? '');
      const publication = record.publicationDate;
      const dateTime = typeof publication === 'string' ? publication : String(publication?.dateTime ?? record.publicationDateTime ?? record.date ?? '');
      return text === caption && dateTime.startsWith(publicationDateTime);
    });
    const id = verifiedRecordId(match);
    if (id) return id;
  }
  throw new Error('Metricool scheduling outcome is unverified');
}

export async function listMetricoolTikTokSchedule(fetcher, token, userId, blogId, startDate, endDate) {
  const response = await fetcher(schedulerUrl(blogId, userId, startDate, endDate), {
    headers: { 'X-Mc-Auth': token, accept: 'application/json' }, signal: AbortSignal.timeout(60_000),
  });
  if (!response.ok) throw new Error(`Metricool schedule preflight failed with HTTP ${response.status}`);
  const value = JSON.parse(await response.text());
  return objects(value).flatMap((record) => {
    const providers = Array.isArray(record.providers) ? record.providers : [];
    if (!providers.some((provider) => String(provider?.network || '').toLowerCase() === 'tiktok')) return [];
    const publication = record.publicationDate;
    const dateTime = typeof publication === 'string' ? publication : String(publication?.dateTime ?? record.publicationDateTime ?? record.date ?? '');
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(dateTime)) return [];
    return [{
      id: verifiedRecordId(record),
      nonpublishingDraft: confirmedNonPublishingDraft(record, 'tiktok'),
      caption: String(record.text ?? record.caption ?? record.content ?? ''),
      dateTime: dateTime.slice(0, 19),
      mediaUrl: String(record.mediaUrl ?? record.media?.url ?? record.media?.[0]?.url ?? ''),
    }];
  });
}

const publicationId = (record) => clean(record?.id ?? record?.uuid ?? record?.postId ?? record?.publicationId);

/** Read: scheduler row for a ledger row (moved from clippers-reconcile-publications.mjs). */
export async function findScheduledPublication({ row, fetcher, env }) {
  const token = clean(env.METRICOOL_USER_TOKEN);
  const userId = clean(env.METRICOOL_USER_ID);
  const blogId = clean(row.metricoolBlogId || env.CLIPPERS_METRICOOL_BLOG_ID);
  if (!token || !userId || !blogId) throw new Error('metricool_reconciliation_credentials_missing');
  const date = clean(row.scheduledFor).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('scheduled_date_missing');
  const response = await fetcher(schedulerUrl(blogId, userId, date, date, true), {
    headers: { 'X-Mc-Auth': token, accept: 'application/json' }, signal: AbortSignal.timeout(60_000),
  });
  if (!response.ok) throw new Error(`metricool_http_${response.status}`);
  const payload = JSON.parse(await response.text());
  return objects(payload).find((candidate) => publicationId(candidate) === clean(row.metricoolId)) || null;
}

function destinationFor(accountRef) {
  return findDestination({ brandId: Number(accountRef?.providerAccountId), network: clean(accountRef?.network).toLowerCase(), account: clean(accountRef?.handle).replace(/^@/, '') });
}
function clientFor(ctx = {}) {
  if (ctx.client) return ctx.client;
  const env = ctx.env || process.env;
  return createPortfolioMetricool({ token: clean(ctx.token ?? env.METRICOOL_USER_TOKEN), userId: clean(ctx.userId ?? env.METRICOOL_USER_ID), fetcher: ctx.fetcher || fetch, env });
}
const captionWithTags = (caption, hashtags = []) => {
  const tags = hashtags.map((t) => (String(t).startsWith('#') ? String(t) : `#${t}`)).filter((t) => !caption.toLowerCase().includes(t.toLowerCase()));
  return tags.length ? `${caption} ${tags.join(' ')}` : caption;
};

export const metricoolPublishingProvider = Object.freeze({
  name: 'metricool',
  label: 'Metricool',
  /** Rich Metricool client used by the existing clippers flows (unchanged behaviour). */
  createClient: (options) => createPortfolioMetricool(options),
  legacy: Object.freeze({ callMetricoolMcp, verifyMetricoolSchedule, listMetricoolTikTokSchedule, findScheduledPublication, verifiedRecordId, objects }),
  async schedulePost(request, ctx = {}) {
    const destination = destinationFor(request.accountRef);
    if (!destination) return { provider: 'metricool', status: 'refused', reason: 'destination_not_allowlisted', providerPostId: null, publicUrl: null };
    const confirmed = await clientFor(ctx).schedule(destination, {
      id: request.idempotencyKey, caption: captionWithTags(request.caption, request.hashtags), mediaUrl: request.mediaUrl, scheduledAt: request.scheduledFor,
    });
    return confirmed
      ? { provider: 'metricool', status: 'scheduled', providerPostId: String(confirmed.id), publicUrl: null, mediaUrl: confirmed.mediaUrl ?? null }
      : { provider: 'metricool', status: 'unverified', reason: 'metricool_schedule_unconfirmed', providerPostId: null, publicUrl: null };
  },
  async getPublication(ref, ctx = {}) {
    const destination = destinationFor(ref.accountRef);
    if (!destination) return { provider: 'metricool', status: 'unknown', reason: 'destination_not_allowlisted', providerPostId: ref.providerPostId, publicUrl: null };
    const item = { metricoolId: ref.providerPostId, scheduledAt: ref.scheduledFor, caption: ref.caption, mediaUrl: ref.mediaUrl };
    const published = await clientFor(ctx).publication(destination, item, ctx.now || new Date());
    return published
      ? { provider: 'metricool', status: 'published', providerPostId: ref.providerPostId, publicUrl: published.url, publishedAt: published.publishedAt }
      : { provider: 'metricool', status: 'scheduled_or_unverified', providerPostId: ref.providerPostId, publicUrl: null };
  },
  async cancel(ref) {
    // No Metricool delete/cancel path exists in this repo today; refuse instead of guessing an endpoint.
    return { provider: 'metricool', status: 'refused', reason: 'cancel_not_supported_by_metricool_adapter', providerPostId: ref?.providerPostId ?? null };
  },
  async freeSlots({ accountRef, day }, ctx = {}) {
    const env = ctx.env || process.env;
    if (clean(accountRef?.network).toLowerCase() !== 'tiktok') return { provider: 'metricool', slots: [], reason: 'free_slots_tiktok_only' };
    const rows = await listMetricoolTikTokSchedule(ctx.fetcher || fetch, clean(ctx.token ?? env.METRICOOL_USER_TOKEN), clean(ctx.userId ?? env.METRICOOL_USER_ID), clean(accountRef.providerAccountId), day, day);
    const taken = new Set(rows.map((r) => r.dateTime));
    return { provider: 'metricool', slots: DAILY_SLOTS.map((t) => `${day}T${t}`).filter((s) => !taken.has(s)), timezone: TIMEZONE };
  },
});
