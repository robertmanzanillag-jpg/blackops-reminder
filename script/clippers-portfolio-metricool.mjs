import { createHash, randomUUID } from 'node:crypto';

const API = 'https://app.metricool.com';
const MCP = 'https://ai.metricool.com/mcp';
export const TIME_ZONE = 'America/New_York';
export const DAILY_LIMIT = 5;
export { DESTINATIONS, DISCONNECTED_BRAND, findDestination, findPublishDestination, destinationKey } from './clippers-destination-registry.mjs';
import { DESTINATIONS, findDestination, findPublishDestination, destinationKey, verifyCurrentIdentity } from './clippers-destination-registry.mjs';
export const localHour = time => new Intl.DateTimeFormat('en-US', {timeZone: TIME_ZONE, hour:'2-digit', hourCycle:'h23'}).format(new Date(time));
export function localDay(time) {
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(time);
}
export function exactPost(value, destination) {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.port) return null;
    const { network, account } = destination;
    const match = network === 'tiktok' && ['www.tiktok.com', 'tiktok.com'].includes(url.hostname)
      ? new RegExp('^/@' + account + '/video/(\\d+)/?$').exec(url.pathname)
      : network === 'facebook' && ['www.facebook.com', 'facebook.com'].includes(url.hostname)
        ? new RegExp('^/' + account + '/(?:videos|posts)/(\\d+)/?$').exec(url.pathname) : null;
    if (!match) return null;
    const canonicalPath = url.pathname.replace(/\/$/, '');
    return { id: match[1], url: 'https://www.' + (network === 'tiktok' ? 'tiktok.com' : 'facebook.com') + canonicalPath };
  } catch { return null; }
}
export function providerTimestamp(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) return null;
  const date = new Date(value);
  return Number.isFinite(+date) ? date.toISOString() : null;
}
function list(value) {
  if (value?.hasMore || value?.next || value?.page?.next || value?.metadata?.next || value?.metadata?.hasMore || value?.pagination?.next || value?.meta?.next || value?.paging?.next ||
      (Number.isInteger(value?.total) && value.total > (value.data?.length ?? -1))) throw new Error('metricool_pagination_unverified');
  if (Array.isArray(value)) return value;
  if (Array.isArray(value?.data)) return value.data;
  throw new Error('metricool_list_unrecognized');
}
function accountEvidence(row, destination) {
  const field = destination.network === 'tiktok' ? 'tiktok' : 'facebook';
  const root = row[field] ?? row[field + 'Data'] ?? row.networksData?.[field + 'Data'] ?? row.networks?.[field + 'Data'];
  if (root === false || root === '' || root?.connected === false || root?.enabled === false) return 'conflict';
  const identity = field === 'tiktok'
    ? (row.tiktokUsername ?? root?.username ?? root?.handle ?? (typeof root === 'string' ? root : null))
    : (row.facebookPageId ?? root?.pageId ?? root?.id ?? (typeof root === 'string' && /^\d+$/.test(root) ? root : null));
  if (identity == null) return Object.hasOwn(row, field) && row[field] === null ? 'conflict' : 'missing';
  return String(identity).toLowerCase().replace(/^@/, '') === destination.account ? 'match' : 'conflict';
}
function provider(row, destination) {
  return Array.isArray(row?.providers) && row.providers.some(p => p?.network === destination.network);
}
function scheduledTime(row) {
  const when = row.publicationDate;
  if (!when?.dateTime) return providerTimestamp(when);
  const withOffset = providerTimestamp(when.dateTime);
  if (withOffset) return withOffset;
  const local = providerTimestamp(when.dateTime + 'Z');
  if (!local) return null;
  if (when.timezone === 'UTC') return local;
  if (when.timezone !== TIME_ZONE) return null;
  const formatter = new Intl.DateTimeFormat('sv-SE', {
    timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  });
  const target = Date.parse(local);
  const wallClock = stamp => Date.parse(formatter.format(new Date(stamp)).replace(' ', 'T') + 'Z');
  let stamp = target;
  for (let attempt = 0; attempt < 3; attempt++) stamp += target - wallClock(stamp);
  return wallClock(stamp) === target ? new Date(stamp).toISOString() : null;
}
function providerMedia(row) {
  const first = Array.isArray(row.media) && row.media.length === 1 ? row.media[0] : null;
  return typeof first === 'string' ? first : first?.downloadUrl ?? first?.url ?? row.mediaUrl;
}
function matchingContent(row, item, destination) {
  return row.providers.length === 1 && (row.blogId == null || String(row.blogId) === String(destination.brandId)) &&
    row.text === item.caption && scheduledTime(row) === item.scheduledAt && Boolean(providerMedia(row));
}
async function verifiedMedia(fetcher, row, item) {
  const media = providerMedia(row);
  if (media === item.mediaUrl || media === item.verifiedSchedulerMediaUrl) return media;
  if (!item.mediaSha256 || typeof media !== 'string') return null;
  const url = new URL(media);
  if (url.origin !== 'https://static.metricool.com' || url.username || url.password || url.search || url.hash) return null;
  const response = await fetcher(url, { headers: { accept: 'video/mp4, application/octet-stream' },
    redirect: 'error', signal: AbortSignal.timeout(30_000) });
  if (!response.ok || !response.body) return null;
  const hash = createHash('sha256');
  let length = 0;
  for await (const chunk of response.body) {
    length += chunk.length;
    if (length > 250_000_000) return null;
    hash.update(chunk);
  }
  return length > 0 && hash.digest('hex') === item.mediaSha256 ? media : null;
}
function analyticsPost(row, destination, id) {
  const url = row.publicUrl ?? row.permalink ?? row.shareUrl ?? row.url;
  const post = url ? exactPost(url, destination) : null;
  return url ? post?.id === id : String(row.postId ?? row.videoId ?? '') === id;
}
function analyticsPublicationTime(row) {
  if (Number.isSafeInteger(row.createTime) && row.createTime >= 1_000_000_000 && row.createTime < 10_000_000_000) {
    return new Date(row.createTime * 1000).toISOString();
  }
  return providerTimestamp(row.publishedAt ?? row.createTime);
}
function statusOf(row, destination) {
  return row.providers?.find(p => p.network === destination.network)?.status ?? row.status;
}
function metricsFrom(row, destination) {
  const metrics = row.providers?.find(p => p.network === destination.network)?.metrics ?? row.metrics ?? row;
  const views = metrics.views ?? metrics.videoViews ?? metrics.viewCount;
  const completionRate = metrics.completionRate;
  if (!Number.isSafeInteger(views) || views < 0 || (completionRate != null &&
      (!Number.isFinite(completionRate) || completionRate < 0 || completionRate > 1))) return null;
  return { views, completionRate: completionRate ?? null };
}
const schedulerId = row => String(row?.id ?? row?.uuid ?? '');

export function createPortfolioMetricool({ token, userId, fetcher = fetch }) {
  if (typeof token !== 'string' || token.length < 12 || !/^\d+$/.test(String(userId))) throw new Error('metricool_credentials_unavailable');
  const headers = { 'X-Mc-Auth': token, accept: 'application/json' };
  let profiles;
  async function get(endpoint, params = {}) {
    const url = new URL(endpoint, API);
    for (const [key, value] of Object.entries({ ...params, userId })) url.searchParams.set(key, String(value));
    const response = await fetcher(url, { headers, redirect: 'error', signal: AbortSignal.timeout(15_000) });
    if (!response.ok) throw new Error(endpoint.startsWith('/api/v2/analytics/') ? `analytics_http_${response.status}` : 'metricool_read_failed');
    if (endpoint.startsWith('/api/v2/analytics/') && !/^application\/(?:[a-z0-9.+-]+\+)?json(?:;|$)/i.test(response.headers?.get('content-type') ?? '')) {
      throw new Error('analytics_json_response_required');
    }
    try { return await response.json(); }
    catch { throw new Error(endpoint.startsWith('/api/v2/analytics/') ? 'analytics_json_invalid' : 'metricool_read_failed'); }
  }
  async function mcp(name, args, id = randomUUID()) {
    const response = await fetcher(MCP, {
      method: 'POST', redirect: 'error',
      headers: { ...headers, accept: 'application/json, text/event-stream', 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args } }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) throw new Error('metricool_request_outcome_uncertain');
    const raw = await response.text();
    const envelope = (response.headers.get('content-type') ?? '').includes('text/event-stream')
      ? raw.split('\n').filter(line => line.startsWith('data:')).map(line => JSON.parse(line.slice(5))).find(event => event.id === id)
      : JSON.parse(raw);
    if (!envelope?.result || envelope.error || envelope.result.isError) throw new Error('metricool_request_outcome_uncertain');
    return envelope.result;
  }
  async function destinationSettings(value) {
    const destination = findPublishDestination(value);
    if (!destination) throw new Error('destination_not_allowlisted_publish_current');
    // Never cache identity across preflight/dispatch; a relink invalidates the reviewed identity.
    const detail = await get('/api/v2/settings/brands/' + destination.brandId, { blogId: destination.brandId });
    if (!verifyCurrentIdentity(detail, destination, userId)) throw new Error('destination_identity_unverified');
    profiles = list(await get('/api/admin/simpleProfiles'));
    const matches = profiles.filter(row => String(row.blogId ?? row.id ?? '') === String(destination.brandId));
    const profile = matches.length === 1 && matches[0];
    if (!profile || profile.deleted === true || accountEvidence(profile, destination) !== 'match') throw new Error('destination_identity_unverified');
    const owned = profile.isShared === false && String(profile.ownerUserId ?? '') === String(userId);
    return { canPublish: profile.isWhiteLabelOnlyRead !== true && profile.canPublish !== false &&
      (profile.canPublish === true || owned) };
  }
  async function schedule(destination, day, strict=false) {
    await destinationSettings(destination);
    const rows=list(await get('/api/v2/scheduler/posts', {
      blogId: destination.brandId, integrationSource: 'MCP',
      start: day + 'T00:00:00', end: day + 'T23:59:59', timezone: TIME_ZONE, extendedRange: false,
    }));
    if(strict){
      const networks=new Set(['tiktok','facebook','instagram','youtube','twitter','linkedin','pinterest','gmb','threads','bluesky','twitch']);
      if(rows.length>500)throw Error('weekly_provider_schedule_unverified');
      for(const row of rows)if(!row||typeof row!=='object'||Array.isArray(row)||
          (row.blogId!=null&&String(row.blogId)!==String(destination.brandId))||!Array.isArray(row.providers)||!row.providers.length||row.providers.length>20||
          row.providers.some(p=>!p||typeof p!=='object'||Array.isArray(p)||typeof p.network!=='string'||!networks.has(p.network))||
          new Set(row.providers.map(p=>p.network)).size!==row.providers.length)throw Error('weekly_provider_schedule_unverified');
    }
    return rows.filter(row=>provider(row,destination)&&row.draft!==true&&!['deleted','cancelled','canceled','failed'].includes(String(statusOf(row,destination)).toLowerCase()));
  }
  async function postAnalytics(destination, from, now) {
    await destinationSettings(destination);
    return list(await get('/api/v2/analytics/posts/' + destination.network, {
      blogId: destination.brandId, integrationSource: 'MCP',
      // Official Swagger uses local date-time plus an explicit IANA timezone.
      // Preserve UTC boundaries while avoiding the rejected fractional/Z form.
      from: new Date(from).toISOString().slice(0, 19), to: now.toISOString().slice(0, 19), timezone: 'UTC',
    }));
  }
  return {
    destinationSettings,
    // Read-only whole-account analysis. These observations never become controlled experiments.
    async accountAnalytics(destination, now = new Date()) {
      if (!findDestination(destination)) throw new Error('destination_not_allowlisted');
      const rows = await postAnalytics(destination, new Date(+now - 7 * 86400000).toISOString(), now);
      const posts = rows.slice(0, 200).flatMap(row => {
        const post = exactPost(row.publicUrl ?? row.permalink ?? row.shareUrl ?? row.url, destination);
        const publishedAt = analyticsPublicationTime(row);
        const metric = metricsFrom(row, destination);
        const reported = row.observedAt ?? row.updatedAt;
        const providerAt = providerTimestamp(reported);
        if (!post || !publishedAt || !metric || Date.parse(publishedAt) > +now ||
            +now - Date.parse(publishedAt) > 7 * 86400000 || (reported != null && !providerAt) || (providerAt && Date.parse(providerAt) > +now)) return [];
        return [{ ...post, publishedAt, ...metric, observedAt: providerAt ?? now.toISOString(),
          timing: providerAt ? 'provider_observation_time' : 'retrieved_at_only',
          actualAgeHours: ((providerAt ? Date.parse(providerAt) : +now) - Date.parse(publishedAt)) / 3600000 }];
      }).filter(row => row.actualAgeHours >= 0);
      return { posts, receivedRows: rows.length, rejectedRows: rows.length-posts.length };
    },
    async preflight(destination, item) {
      if (!(await destinationSettings(destination)).canPublish) throw new Error('destination_publish_permission_missing');
      const rows = await schedule(destination, localDay(new Date(item.scheduledAt)));
      if (rows.some(row => !scheduledTime(row))) throw Error('metricool_schedule_time_unverified');
      const duplicate = rows.some(row => {
        return localHour(scheduledTime(row)) === localHour(item.scheduledAt) || row.text === item.caption ||
          providerMedia(row) === item.mediaUrl;
      });
      if (duplicate || rows.length >= DAILY_LIMIT) throw new Error('metricool_slot_duplicate_or_daily_cap');
    },
    async weeklyPreflight(destination, item, { now } = {}) {
      if (!(now instanceof Date) || !Number.isFinite(+now)) throw Error('weekly_now_required');
      const day = localDay(new Date(item.scheduledAt));
      if (Date.parse(item.scheduledAt) < +now + 300000) throw Error('weekly_schedule_expired');
      profiles = undefined;
      if (!(await destinationSettings(destination)).canPublish) throw Error('destination_publish_permission_missing');
      const rows = await schedule(destination, day, true);
      const pending = new Map();
      const published = new Map();
      const calendarIds=new Set(),calendarPublished=new Map(),untimedPublished=new Map();
      if (day === localDay(now)) {
        // Fresh published-post read, not the connector's pending-only list or a fabricated completeness flag.
        let start = new Date(day+'T05:00:00Z');
        if (localHour(start)==='01') start=new Date(day+'T04:00:00Z');
        const analytics = await postAnalytics(destination,start.toISOString(),now);
        for (const post of analytics) {
          const when=analyticsPublicationTime(post);
          if(!when || Date.parse(when)>+now || (post.blogId!=null && String(post.blogId)!==String(destination.brandId)))throw Error('today_publication_coverage_unverified');
          if(localDay(new Date(when))!==day)continue;
          const url=post.publicUrl??post.permalink??post.shareUrl??post.url;
          const exact=url?exactPost(url,destination):null;
          const id=exact?.id??(!url?String(post.postId??post.videoId??''):null);
          if(!id || !/^\d+$/.test(id))throw Error('today_publication_coverage_unverified');
          const old=published.get(id);
          if(old && old.publishedAt!==when)throw Error('today_publication_identity_conflict');
          published.set(id,{id,publishedAt:when});
        }
      }
      for (const row of rows) {
        const when = scheduledTime(row), status = String(statusOf(row,destination)).toLowerCase();
        if (!when || localDay(new Date(when))!==day || !schedulerId(row) || !['scheduled','pending','publishing','published','posted'].includes(status)) throw Error('weekly_provider_schedule_unverified');
        calendarIds.add(schedulerId(row));
        if (['published','posted'].includes(status)) {
          const target = row.providers.find(p=>p.network===destination.network);
          const exact = exactPost(target.publicUrl ?? row.publicUrl ?? row.publishedPostUrl,destination);
          if (day!==localDay(now) || !exact) throw Error('weekly_published_row_unreconciled');
          if(calendarPublished.has(exact.id)&&calendarPublished.get(exact.id)!==schedulerId(row))throw Error('weekly_provider_identity_conflict');
          calendarPublished.set(exact.id,schedulerId(row));
          if(published.has(exact.id))continue;
          // Provider PUBLISHED is authoritative existence, even while analytics has not supplied a timestamp.
          // Reserve its original calendar slot; never invent publishedAt or metric completeness.
          untimedPublished.set(schedulerId(row),exact.id);
        }
        if (['scheduled','pending'].includes(status)&&Date.parse(when)<=+now) throw Error('past_schedule_requires_publication_confirmation');
        const key = String(row.uuid ?? schedulerId(row));
        if (pending.has(key) && JSON.stringify(pending.get(key))!==JSON.stringify(row)) throw Error('weekly_provider_identity_conflict');
        pending.set(key,row);
      }
      const hours = [...pending.values()].map(row=>localHour(scheduledTime(row))).concat([...published.values()].map(post=>localHour(post.publishedAt)));
      if (hours.length>=DAILY_LIMIT || new Set(hours).size!==hours.length || hours.includes(localHour(item.scheduledAt)) ||
          [...pending.values()].some(row=>row.text===item.caption || providerMedia(row)===item.mediaUrl)) throw Error('metricool_slot_duplicate_or_daily_cap');
      const evidence={destination,day,observedAt:now.toISOString(),source:'fresh_rest_calendar_and_account_analytics',calendarPublished:[...calendarPublished].map(([platformPostId,id])=>({id,platformPostId})),
        scheduled:[...pending.values()].map(row=>({id:schedulerId(row),scheduledAt:scheduledTime(row),status:String(statusOf(row,destination)).toLowerCase(),...(untimedPublished.has(schedulerId(row))?{platformPostId:untimedPublished.get(schedulerId(row)),publicationTimeVerified:false}:{})})),published:[...published.values()]};
      return { day, observedAt:evidence.observedAt, coverageSource:evidence.source, confirmedCount:hours.length, scheduledIds:evidence.scheduled.map(row=>row.id), publishedIds:[...new Set([...evidence.published.map(row=>row.id),...calendarPublished.keys()])],calendarIds:[...calendarIds],reservedPublishing:[...pending.values()].filter(row=>String(statusOf(row,destination)).toLowerCase()==='publishing').length,publicationTimesUnverified:untimedPublished.size,evidence,
        evidenceSha256:createHash('sha256').update(JSON.stringify(evidence)).digest('hex') };
    },
    async schedule(destination, item) {
      profiles = undefined;
      if (!(await destinationSettings(destination)).canPublish) throw new Error('destination_publish_permission_missing');
      const networkOptions = destination.network === 'facebook'
        ? { facebookData: { type: 'REEL' } }
        : { tiktokData: { privacyOption: 'PUBLIC_TO_EVERYONE', autoAddMusic: false,
          commercialContentThirdParty: item.thirdPartyCommercial === true } };
      const post = {
        autoPublish: true, draft: false, providers: [{ network: destination.network }],
        publicationDate: { dateTime: item.scheduledAt.slice(0, 19), timezone: 'UTC' },
        text: item.caption, media: [item.mediaUrl], ...networkOptions,
      };
      await mcp('createScheduledPost', {
        blogId: String(destination.brandId), date: item.scheduledAt,
        info: JSON.stringify(post),
      }, item.id);
      return this.confirmSchedule(destination, item);
    },
    async confirmSchedule(destination, item) {
      const matches = (await schedule(destination, localDay(new Date(item.scheduledAt)))).filter(row =>
        row.autoPublish === true && row.draft === false &&
        ['scheduled', 'pending', 'published', 'posted'].includes(String(statusOf(row, destination)).toLowerCase()) &&
        matchingContent(row, item, destination));
      const row = matches.length === 1 ? matches[0] : null;
      if (!row || !schedulerId(row)) return null;
      const media = await verifiedMedia(fetcher, row, item);
      return media ? { id: schedulerId(row), mediaUrl: media } : null;
    },
    async publication(destination, item, now = new Date()) {
      const rows = await schedule(destination, localDay(new Date(item.scheduledAt)));
      const matches = rows.filter(row => schedulerId(row) === item.metricoolId);
      if (matches.length !== 1 || !matchingContent(matches[0], item, destination)) return null;
      const row = matches[0];
      const target = row.providers.find(p => p.network === destination.network);
      if (!['published', 'posted'].includes(String(statusOf(row, destination)).toLowerCase()) ||
          !await verifiedMedia(fetcher, row, item)) return null;
      const post = exactPost(target.publicUrl ?? row.publicUrl ?? row.publishedPostUrl, destination);
      if (!post) return null;
      let publishedAt = providerTimestamp(target.publishedAt ?? row.publishedAt);
      if (!publishedAt) {
        const analytics = await postAnalytics(destination, new Date(Date.parse(item.scheduledAt) - 3_600_000).toISOString(), now);
        const matches = analytics.filter(row => analyticsPost(row, destination, post.id));
        if (matches.length === 1) publishedAt = analyticsPublicationTime(matches[0]);
      }
      return publishedAt ? { ...post, publishedAt, source: 'metricool_scheduler' } : null;
    },
    async metrics(destination, publication, now) {
      const rows = await postAnalytics(destination, publication.publishedAt, now);
      const matches = rows.filter(row => analyticsPost(row, destination, publication.id));
      if (matches.length !== 1) return null;
      const metric = metricsFrom(matches[0], destination);
      const reportedAt = matches[0].observedAt ?? matches[0].updatedAt;
      const providerObservedAt = providerTimestamp(reportedAt);
      if (reportedAt != null && !providerObservedAt) return null;
      return metric ? { ...metric, observedAt: providerObservedAt ?? now.toISOString(),
        timing: providerObservedAt ? 'provider_observation_time' : 'retrieved_at_only', source: 'metricool_post_analytics' } : null;
    },
  };
}
