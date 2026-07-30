import {
  callMetricoolMcpTool,
  listMetricoolMcpTools,
  BLACKROOM_METRICOOL_BLOG_ID,
  BLACKROOM_METRICOOL_NETWORKS,
  BLACKROOM_TIMEZONE,
  formatMetricoolMcpDate,
} from "./blackroom-metricool-bridge";

export const BLACKROOM_CEO_MIN_SAMPLES = 21;
export const BLACKROOM_CEO_DAILY_POSTS = 5;
export const BLACKROOM_CEO_EXPERIMENTAL_POSTS = 7;
export const BLACKROOM_CEO_MAX_DAILY_POSTS = 10;
// Shared baseline for the deterministic editor. The campaign planner may
// selectively raise a day to seven only after its separate evidence gate.
export const BLACKROOM_CEO_DEFAULT_NETWORK_TARGETS: Record<string, number> = {
  tiktok: 5,
  facebook: 5,
  youtube: 5,
};
export const BLACKROOM_CEO_MIN_SPACING_MINUTES = 90;
export const BLACKROOM_CEO_REFRESH_MS = 6 * 60 * 60_000;
// Keep a recent window constant for endpoints that only expose rolling
// analytics, but ask Metricool for the complete possible social-media
// history whenever the discovered tool supports dates or pagination.
export const BLACKROOM_CEO_ANALYTICS_LOOKBACK_DAYS = 30;
export const BLACKROOM_CEO_ANALYTICS_HISTORY_START_DATE = "2005-01-01";
export const BLACKROOM_CEO_ANALYTICS_PAGE_SIZE = 100;
export const BLACKROOM_CEO_ANALYTICS_MAX_PAGES = 250;
export const BLACKROOM_CEO_CREATIVE_MIN_SAMPLES = 5;
export const BLACKROOM_CEO_CREATIVE_NEW_SAMPLES = 3;
export const BLACKROOM_CEO_LOW_VIEW_THRESHOLD = 10;
export const BLACKROOM_CREATIVE_STRATEGIES = ["drop_first", "instant_drop", "build_then_drop"] as const;
export type BlackRoomCreativeStrategy = (typeof BLACKROOM_CREATIVE_STRATEGIES)[number];

export interface BlackRoomCeoAnalytics {
  /** Total imported posts across all connected networks, for visibility. */
  sampleCount: number;
  /** Smallest usable cohort across the networks, used for cadence/time changes. */
  comparableSampleCount: number;
  lastCheckedAt: string;
  nextCheckAt: string;
  confidence: "collecting" | "learning";
  networkSamples: Record<string, number>;
  /** Per-network read failures. A failed network must not hide the data from
   * the other connected networks. */
  networkErrors?: Record<string, string>;
  /** Earliest date requested from Metricool. Availability still depends on
   * the connected network and the Metricool plan's retention. */
  historyStartDate?: string;
  /** True means the discovered tool was exhausted for the requested range.
   * False means Metricool did not expose pagination/date controls or hit a
   * defensive request limit. */
  historyCompleteByNetwork?: Record<string, boolean>;
  /** Number of Metricool tool calls used to assemble each deduplicated
   * historical cohort. */
  historyRequestsByNetwork?: Record<string, number>;
  recommendedTimes: string[];
  recommendedTimesByNetwork?: Record<string, string[]>;
  networkMedianViews?: Record<string, number>;
  networkLowViewRate?: Record<string, number>;
  networkDailyTargets?: Record<string, number>;
  tiktokMedianViews: number;
  tiktokLowViewRate: number;
  creativeStrategy: BlackRoomCreativeStrategy;
  creativeStrategyVersion: number;
  creativeStrategySampleBaseline: number;
  creativeStrategyPostIdsBaseline: string[];
  creativeChangedAt: string;
  creativeReason: string;
  reason: string;
}

function records(value: unknown): Record<string, any>[] {
  const found: Record<string, any>[] = [];
  const visit = (item: unknown) => {
    if (Array.isArray(item)) return item.forEach(visit);
    if (!item || typeof item !== "object") return;
    const record = item as Record<string, any>;
    found.push(record);
    Object.values(record).forEach(visit);
  };
  visit(value);
  return found;
}

function toolPayload(value: any): unknown {
  const texts = Array.isArray(value?.content)
    ? value.content.map((item: any) => item?.text).filter((item: any) => typeof item === "string")
    : [];
  if (!texts.length) return value?.structuredContent ?? value;
  const parsed = texts.map((text: string) => {
    try { return JSON.parse(text); } catch { return text; }
  });
  return parsed.length === 1 ? parsed[0] : parsed;
}

function normalizedName(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function metricValue(record: Record<string, any>, names: string[]): number | null {
  const accepted = new Set(names.map(normalizedName));
  for (const [key, raw] of Object.entries(record)) {
    if (!accepted.has(normalizedName(key))) continue;
    const value = Number(raw);
    if (Number.isFinite(value) && value >= 0) return value;
  }
  return null;
}

function metricRecordId(record: Record<string, any>): string | null {
  const id = record.id
    ?? record.postId
    ?? record.post_id
    ?? record.postUuid
    ?? record.uuid
    ?? record.videoId
    ?? record.video_id
    ?? record.socialNetworkId
    ?? record.social_network_id
    ?? record.networkId
    ?? record.network_id
    ?? record.publicationId
    ?? record.publication_id
    ?? record.url
    ?? record.permalink
    ?? record.postUrl
    ?? record.post_url;
  return id == null || String(id).trim() === "" ? null : String(id);
}

export function extractBlackRoomMetricSamples(value: unknown): number {
  return extractBlackRoomMetricSampleIds(value).length;
}

export function extractBlackRoomMetricSampleIds(value: unknown): string[] {
  const ids = new Set<string>();
  for (const record of records(value)) {
    const views = metricValue(record, ["views", "impressions", "reach", "videoViews", "video_views", "viewCount", "view_count", "totalViews", "plays", "playCount", "blue_reels_play_count"]);
    const id = metricRecordId(record);
    if (views !== null && id != null) ids.add(String(id));
  }
  return [...ids];
}

export function extractBlackRoomViewRecords(value: unknown): Array<{ id: string; views: number }> {
  const samples = new Map<string, number>();
  for (const record of records(value)) {
    const views = metricValue(record, ["views", "videoViews", "video_views", "viewCount", "view_count", "totalViews", "plays", "playCount", "blue_reels_play_count"]);
    const id = metricRecordId(record);
    if (views !== null && id != null) samples.set(String(id), views);
  }
  return [...samples].map(([id, views]) => ({ id, views }));
}

export function extractBlackRoomViewSamples(value: unknown): number[] {
  return extractBlackRoomViewRecords(value).map((sample) => sample.views);
}

function median(values: number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

export function planBlackRoomNetworkLearning(input: {
  viewsByNetwork: Record<string, number[]>;
}): {
  networkMedianViews: Record<string, number>;
  networkLowViewRate: Record<string, number>;
  networkDailyTargets: Record<string, number>;
} {
  const networkMedianViews: Record<string, number> = {};
  const networkLowViewRate: Record<string, number> = {};
  const networkDailyTargets: Record<string, number> = {};
  for (const network of BLACKROOM_METRICOOL_NETWORKS) {
    const views = (input.viewsByNetwork[network] || [])
      .map(Number)
      .filter((value) => Number.isFinite(value) && value >= 0);
    const sampleCount = views.length;
    const networkMedian = median(views);
    const lowRate = sampleCount
      ? views.filter((value) => value <= BLACKROOM_CEO_LOW_VIEW_THRESHOLD).length / sampleCount
      : 0;
    let target = 5;
    if (sampleCount >= BLACKROOM_CEO_CREATIVE_MIN_SAMPLES && (networkMedian <= BLACKROOM_CEO_LOW_VIEW_THRESHOLD || lowRate >= 0.7)) {
      target = 5;
    } else if (sampleCount >= BLACKROOM_CEO_MIN_SAMPLES && networkMedian >= 50 && lowRate <= 0.4) {
      target = BLACKROOM_CEO_EXPERIMENTAL_POSTS;
    }
    networkMedianViews[network] = networkMedian;
    networkLowViewRate[network] = lowRate;
    networkDailyTargets[network] = target;
  }
  return { networkMedianViews, networkLowViewRate, networkDailyTargets };
}

/**
 * Protect the baseline while still buying a small amount of learning.
 * A seven-post day is permitted only after all three networks have a
 * comparable sample and at least two show healthy distribution.  We use two
 * spaced experiment days per fortnight, so a weak TikTok result cannot be
 * mistaken for audience fatigue caused by a sudden daily flood.
 */
export function planBlackRoomCampaignPosts(input: {
  dayIndex: number;
  analytics: Pick<BlackRoomCeoAnalytics, "sampleCount" | "networkMedianViews" | "networkLowViewRate"> & Partial<Pick<BlackRoomCeoAnalytics, "comparableSampleCount">>;
}): number {
  const sampleCount = Math.max(0, Number(input.analytics.comparableSampleCount ?? input.analytics.sampleCount ?? 0));
  if (sampleCount < BLACKROOM_CEO_MIN_SAMPLES) return BLACKROOM_CEO_DAILY_POSTS;
  const healthyNetworks = BLACKROOM_METRICOOL_NETWORKS.filter((network) =>
    Number(input.analytics.networkMedianViews?.[network] || 0) >= 50
    && Number(input.analytics.networkLowViewRate?.[network] || 1) <= 0.4,
  ).length;
  // Days 3 and 10 of the rolling fourteen-day plan are the controlled volume
  // experiments. All other days remain comparable five-post baselines.
  return healthyNetworks >= 2 && [2, 9].includes(input.dayIndex % 14)
    ? BLACKROOM_CEO_EXPERIMENTAL_POSTS
    : BLACKROOM_CEO_DAILY_POSTS;
}

export function planBlackRoomCreativeLearning(input: {
  views: number[];
  postIds?: string[];
  previous?: Partial<BlackRoomCeoAnalytics> | null;
  now?: Date;
}): Pick<BlackRoomCeoAnalytics,
  "tiktokMedianViews" | "tiktokLowViewRate" | "creativeStrategy" | "creativeStrategyVersion"
  | "creativeStrategySampleBaseline" | "creativeStrategyPostIdsBaseline" | "creativeChangedAt" | "creativeReason"> {
  const now = input.now || new Date();
  const samples = input.views
    .map((views, index) => ({ views, id: input.postIds?.[index] == null ? "" : String(input.postIds[index]) }))
    .filter((sample) => Number.isFinite(sample.views) && sample.views >= 0);
  const views = samples.map((sample) => sample.views);
  const previousStrategy = BLACKROOM_CREATIVE_STRATEGIES.includes(input.previous?.creativeStrategy as BlackRoomCreativeStrategy)
    ? input.previous!.creativeStrategy as BlackRoomCreativeStrategy
    : "drop_first";
  const previousVersion = Math.max(0, Number(input.previous?.creativeStrategyVersion || 0));
  const previousBaseline = Math.max(0, Number(input.previous?.creativeStrategySampleBaseline || 0));
  const postIds = samples.map((sample) => sample.id).filter(Boolean);
  const previousPostIds = Array.isArray(input.previous?.creativeStrategyPostIdsBaseline)
    ? input.previous!.creativeStrategyPostIdsBaseline.map(String)
    : [];
  const newViews = postIds.length && previousPostIds.length
    ? views.filter((_value, index) => !previousPostIds.includes(postIds[index]))
    : views;
  const evaluationViews = previousVersion > 0 && previousPostIds.length ? newViews : views;
  const requiredEvidence = previousVersion > 0 ? BLACKROOM_CEO_CREATIVE_NEW_SAMPLES : BLACKROOM_CEO_CREATIVE_MIN_SAMPLES;
  const tiktokMedianViews = median(evaluationViews);
  const tiktokLowViewRate = evaluationViews.length
    ? evaluationViews.filter((value) => value <= BLACKROOM_CEO_LOW_VIEW_THRESHOLD).length / evaluationViews.length
    : 0;
  const lowPerformance = evaluationViews.length >= requiredEvidence
    && (tiktokMedianViews <= BLACKROOM_CEO_LOW_VIEW_THRESHOLD || tiktokLowViewRate >= 0.7);
  const newPostCount = postIds.length
    ? postIds.filter((id) => !previousPostIds.includes(id)).length
    : views.length - previousBaseline;
  const enoughNewEvidence = newPostCount >= BLACKROOM_CEO_CREATIVE_NEW_SAMPLES;
  const shouldRotate = lowPerformance && enoughNewEvidence;
  const strategyIndex = BLACKROOM_CREATIVE_STRATEGIES.indexOf(previousStrategy);
  const creativeStrategy = shouldRotate
    ? BLACKROOM_CREATIVE_STRATEGIES[(strategyIndex + 1) % BLACKROOM_CREATIVE_STRATEGIES.length]
    : previousStrategy;
  return {
    tiktokMedianViews,
    tiktokLowViewRate,
    creativeStrategy,
    creativeStrategyVersion: previousVersion + (shouldRotate ? 1 : 0),
    creativeStrategySampleBaseline: shouldRotate ? views.length : previousBaseline,
    creativeStrategyPostIdsBaseline: shouldRotate ? postIds.slice(-200) : previousPostIds,
    creativeChangedAt: shouldRotate ? now.toISOString() : String(input.previous?.creativeChangedAt || ""),
    creativeReason: shouldRotate
      ? `TikTok sigue bajo (${tiktokMedianViews.toFixed(1)} vistas de mediana; ${(tiktokLowViewRate * 100).toFixed(0)}% en 10 o menos). El CEO cambió a ${creativeStrategy}.`
      : evaluationViews.length < requiredEvidence
        ? `Recolectando señal creativa de TikTok (${evaluationViews.length}/${requiredEvidence}).`
        : lowPerformance
          ? `Rendimiento bajo confirmado, esperando ${BLACKROOM_CEO_CREATIVE_NEW_SAMPLES} resultados nuevos antes de otro cambio.`
          : `La técnica ${creativeStrategy} se mantiene porque la distribución de TikTok mejoró.`,
  };
}

function timeToMinutes(value: string): number | null {
  const match = /(?:^|T)(\d{1,2}):(\d{2})/.exec(value);
  if (!match) return null;
  const minutes = Number(match[1]) * 60 + Number(match[2]);
  return minutes >= 0 && minutes < 1440 ? minutes : null;
}

export function extractBlackRoomBestTimes(value: unknown): string[] {
  const ranked = records(value).flatMap((record) => {
    const raw = record.time ?? record.hour ?? record.localTime ?? record.dateTime ?? record.datetime;
    const minutes = timeToMinutes(String(raw ?? ""));
    if (minutes == null && Number.isInteger(Number(raw)) && Number(raw) >= 0 && Number(raw) <= 23) {
      return [{ minutes: Number(raw) * 60, score: metricValue(record, ["score", "value", "engagement", "weight"]) || 0 }];
    }
    return minutes == null ? [] : [{ minutes, score: metricValue(record, ["score", "value", "engagement", "weight"]) || 0 }];
  }).sort((left, right) => right.score - left.score || left.minutes - right.minutes);
  return [...new Set(ranked.map((item) => `${String(Math.floor(item.minutes / 60)).padStart(2, "0")}:${String(item.minutes % 60).padStart(2, "0")}`))];
}

function circularDistance(left: number, right: number): number {
  const direct = Math.abs(left - right);
  return Math.min(direct, 1440 - direct);
}

export function buildBlackRoomLearningSlots(input: {
  dayIndex: number;
  recommendedTimes?: string[];
  sampleCount?: number;
  posts?: number;
}): string[] {
  const posts = Math.max(1, Math.min(16, Math.floor(input.posts || BLACKROOM_CEO_DAILY_POSTS)));
  const baseline = Array.from({ length: posts }, (_, index) => (30 + input.dayIndex * 90 + Math.round(index * 1440 / posts)) % 1440);
  if (Number(input.sampleCount || 0) >= BLACKROOM_CEO_MIN_SAMPLES) {
    const recommended = (input.recommendedTimes || []).map(timeToMinutes).filter((value): value is number => value != null);
    let replaced = 0;
    for (const candidate of recommended) {
      if (replaced >= 2) break;
      const replaceIndex = baseline.reduce((best, value, index) =>
        circularDistance(value, candidate) < circularDistance(baseline[best], candidate) ? index : best, 0);
      if (baseline.some((value, index) => index !== replaceIndex && circularDistance(value, candidate) < BLACKROOM_CEO_MIN_SPACING_MINUTES)) continue;
      baseline[replaceIndex] = candidate;
      replaced += 1;
    }
  }
  return baseline.sort((left, right) => left - right).map((minutes) => `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`);
}

type BlackRoomMetricoolArgumentWindow = {
  start?: string;
  end?: string;
  page?: number;
  connector?: string;
  metrics?: string[];
};

function normalizedSchemaKeys(schema: Record<string, any> | undefined): Array<{ key: string; normalized: string }> {
  return Object.keys(schema?.properties || {}).map((key) => ({
    key,
    normalized: normalizedName(key),
  }));
}

function schemaValue(schema: Record<string, any> | undefined, key: string, value: string | number): string | number {
  const type = schema?.properties?.[key]?.type;
  if (type === "integer" || type === "number") {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : value;
  }
  return String(value);
}

function schemaDateValue(
  schema: Record<string, any> | undefined,
  key: string,
  date: string,
  endOfDay: boolean,
): string {
  const property = schema?.properties?.[key] || {};
  const description = String(property.description || property.title || "");
  const expectsDateTime = /iso\s*8601|date.?time|yyyy-mm-ddt|hh:mm/i.test(description)
    || ["fromdate", "todate"].includes(normalizedName(key));
  if (!expectsDateTime) return date;
  const wallClock = `${date}T${endOfDay ? "23:59:59" : "00:00:00"}`;
  return formatMetricoolMcpDate(wallClock, BLACKROOM_TIMEZONE);
}

function buildToolArguments(
  schema: Record<string, any> | undefined,
  network: string,
  now: Date,
  env: NodeJS.ProcessEnv,
  window: BlackRoomMetricoolArgumentWindow = {},
) {
  const properties = schema?.properties || {};
  const args: Record<string, unknown> = {};
  const start = window.start || new Date(now.getTime() - BLACKROOM_CEO_ANALYTICS_LOOKBACK_DAYS * 86400_000).toISOString().slice(0, 10);
  const end = window.end || now.toISOString().slice(0, 10);
  const page = Math.max(1, Math.floor(window.page || 1));
  for (const key of Object.keys(properties)) {
    const normalized = normalizedName(key);
    if (normalized === "blogid" || normalized === "brandid") args[key] = schemaValue(
      schema,
      key,
      env.BLACKROOM_METRICOOL_BLOG_ID || BLACKROOM_METRICOOL_BLOG_ID,
    );
    else if (normalized === "userid") args[key] = schemaValue(schema, key, env.METRICOOL_USER_ID || "");
    else if (["network", "platform", "socialnetwork", "provider"].includes(normalized)) args[key] = network;
    else if (["start", "startdate", "initdate", "initialdate", "from", "fromdate", "datefrom", "sincedate"].includes(normalized)) {
      args[key] = schemaDateValue(schema, key, start, false);
    } else if (["end", "enddate", "to", "todate", "dateto", "untildate"].includes(normalized)) {
      args[key] = schemaDateValue(schema, key, end, true);
    }
    else if (normalized === "timezone") args[key] = BLACKROOM_TIMEZONE;
    else if (normalized === "connector" && window.connector) args[key] = window.connector;
    else if (["metrics", "metricids", "metricfields"].includes(normalized) && window.metrics?.length) args[key] = window.metrics;
    else if (["limit", "pagesize", "perpage", "maxresults", "count"].includes(normalized)) args[key] = BLACKROOM_CEO_ANALYTICS_PAGE_SIZE;
    else if (["page", "pagenumber", "pageindex"].includes(normalized)) args[key] = page;
    else if (["offset", "skip"].includes(normalized)) args[key] = (page - 1) * BLACKROOM_CEO_ANALYTICS_PAGE_SIZE;
  }
  return args;
}

function payloadHasMore(value: unknown, returned: number): boolean {
  for (const record of records(value)) {
    for (const [key, raw] of Object.entries(record)) {
      const normalized = key.toLowerCase().replace(/_/g, "");
      if (["hasmore", "hasnext", "hasnextpage"].includes(normalized) && raw === true) return true;
      if (["nextpage", "nextcursor", "cursor"].includes(normalized) && raw != null && raw !== "" && raw !== false) return true;
      if (["total", "totalcount", "totalresults", "count"].includes(normalized)) {
        const total = Number(raw);
        if (Number.isFinite(total) && total > returned) return true;
      }
    }
  }
  return false;
}

function dateRangeSupported(schema: Record<string, any> | undefined): boolean {
  const normalized = normalizedSchemaKeys(schema).map((entry) => entry.normalized);
  return normalized.some((key) => ["start", "startdate", "initdate", "initialdate", "from", "fromdate", "datefrom", "sincedate"].includes(key))
    && normalized.some((key) => ["end", "enddate", "to", "todate", "dateto", "untildate"].includes(key));
}

function paginationSupported(schema: Record<string, any> | undefined): boolean {
  return normalizedSchemaKeys(schema).some(({ normalized }) =>
    ["page", "pagenumber", "pageindex", "offset", "skip"].includes(normalized));
}

function nextDate(date: string): string {
  const value = new Date(`${date}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + 1);
  return value.toISOString().slice(0, 10);
}

function splitDateRange(start: string, end: string): [string, string, string, string] | null {
  const startMs = new Date(`${start}T00:00:00.000Z`).getTime();
  const endMs = new Date(`${end}T00:00:00.000Z`).getTime();
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || startMs >= endMs) return null;
  const middle = new Date(startMs + Math.floor((endMs - startMs) / 2)).toISOString().slice(0, 10);
  return [start, middle, nextDate(middle), end];
}

function configuredHistoryStartDate(env: NodeJS.ProcessEnv): string {
  const configured = String(env.BLACKROOM_CEO_ANALYTICS_HISTORY_START_DATE || "");
  return /^\d{4}-\d{2}-\d{2}$/.test(configured)
    ? configured
    : BLACKROOM_CEO_ANALYTICS_HISTORY_START_DATE;
}

type BlackRoomMetricoolMetricDefinition = {
  id: string;
  label: string;
};

function extractMetricoolMetricDefinitions(value: unknown): BlackRoomMetricoolMetricDefinition[] {
  const definitions = new Map<string, string>();
  const metricCode = /^[A-Z]{2,}[A-Z0-9_.-]*\d+[A-Z0-9_.-]*$/i;
  const visitStrings = (candidate: unknown) => {
    if (Array.isArray(candidate)) return candidate.forEach(visitStrings);
    if (typeof candidate === "string" && metricCode.test(candidate.trim())) {
      definitions.set(candidate.trim(), candidate.trim());
    }
  };
  visitStrings(value);
  for (const record of records(value)) {
    const id = record.fieldId
      ?? record.field_id
      ?? record.field
      ?? record.metricId
      ?? record.metric_id
      ?? record.metricCode
      ?? record.metric_code
      ?? record.code
      ?? record.id;
    const label = record.displayName
      ?? record.display_name
      ?? record.metricName
      ?? record.metric_name
      ?? record.fieldName
      ?? record.field_name
      ?? record.label
      ?? record.name
      ?? record.title
      ?? record.description
      ?? record.metric;
    if (typeof id === "string" && id.trim() && typeof label === "string" && label.trim()) {
      definitions.set(id.trim(), label.trim());
    }
    for (const [key, raw] of Object.entries(record)) {
      if (typeof raw !== "string" || !raw.trim()) continue;
      if (metricCode.test(key)) definitions.set(key, raw.trim());
    }
  }
  return [...definitions].map(([id, label]) => ({ id, label }));
}

function preferredMetricDefinitions(
  definitions: BlackRoomMetricoolMetricDefinition[],
): BlackRoomMetricoolMetricDefinition[] {
  const score = (definition: BlackRoomMetricoolMetricDefinition): number => {
    const value = `${definition.id} ${definition.label}`.toLowerCase();
    if (/\bviews?\b|video.?views?|view.?count/.test(value)) return 0;
    if (/play/.test(value)) return 1;
    if (/impression/.test(value)) return 2;
    if (/reach/.test(value)) return 3;
    if (/engagement|interaction/.test(value)) return 4;
    if (/video|post|count/.test(value)) return 5;
    if (/share|like/.test(value)) return 6;
    return 10;
  };
  return [...definitions].sort((left, right) =>
    score(left) - score(right) || left.id.localeCompare(right.id)).slice(0, 1);
}

function identityMetricDefinitions(
  definitions: BlackRoomMetricoolMetricDefinition[],
): BlackRoomMetricoolMetricDefinition[] {
  const score = (definition: BlackRoomMetricoolMetricDefinition): number => {
    const value = `${definition.id} ${definition.label}`.toLowerCase();
    if (/video.?id|post.?id|publication.?id|network.?id/.test(value)) return 0;
    if (/video.?url|post.?url|permalink|post.?link|share.?url/.test(value)) return 1;
    return 10;
  };
  return [...definitions]
    .filter((definition) => score(definition) < 10)
    .sort((left, right) => score(left) - score(right) || left.id.localeCompare(right.id))
    .slice(0, 1);
}

function codedMetricRecordId(
  record: Record<string, any>,
  metricId: string,
  identityDefinitions: BlackRoomMetricoolMetricDefinition[],
): string | null {
  const direct = metricRecordId(record);
  if (direct && direct !== metricId) return direct;
  for (const definition of identityDefinitions) {
    const entry = Object.entries(record).find(([key]) => normalizedName(key) === normalizedName(definition.id));
    const value = entry?.[1];
    if (value != null && String(value).trim() && String(value) !== metricId) return String(value);
  }
  // Analytics/evolution rows can also contain dates and metric values, but
  // they are aggregates rather than individual posts. Never count those rows
  // as published-post samples because doing so would give the CEO false
  // confidence and teach it from days/buckets instead of content.
  return null;
}

function extractCodedViewRecords(
  value: unknown,
  definitions: BlackRoomMetricoolMetricDefinition[],
): Array<{ id: string; views: number }> {
  const performanceDefinitions = preferredMetricDefinitions(definitions);
  const identityDefinitions = identityMetricDefinitions(definitions);
  const definitionById = new Map(definitions.map((definition) => [normalizedName(definition.id), definition]));
  const performanceIds = new Set(performanceDefinitions.map((definition) => normalizedName(definition.id)));
  const identityIds = new Set(identityDefinitions.map((definition) => normalizedName(definition.id)));
  const samples = new Map<string, number>();
  type MetricPoint = { coordinate: string | null; value: unknown };
  const series = new Map<string, MetricPoint[]>();
  const pointCoordinate = (record: Record<string, any>): string | null => {
    const value = record.dateTime
      ?? record.datetime
      ?? record.date_time
      ?? record.timestamp
      ?? record.publicationDate
      ?? record.publishedAt
      ?? record.createdAt;
    if (value == null || !String(value).trim()) return null;
    const coordinate = String(value).trim();
    // A date-only bucket represents a daily aggregate, not an individual
    // publication. It must never become a post identity join key.
    if (/^\d{4}-\d{2}-\d{2}$/.test(coordinate)) return null;
    return coordinate;
  };
  const addPoint = (definition: BlackRoomMetricoolMetricDefinition, record: Record<string, any>, raw: unknown) => {
    const key = normalizedName(definition.id);
    if (!performanceIds.has(key) && !identityIds.has(key)) return;
    const points = series.get(key) || [];
    points.push({ coordinate: pointCoordinate(record), value: raw });
    series.set(key, points);
  };
  const visit = (candidate: unknown, activeMetricId = "", path = "root") => {
    if (Array.isArray(candidate)) {
      candidate.forEach((item, index) => visit(item, activeMetricId, `${path}.${index}`));
      return;
    }
    if (!candidate || typeof candidate !== "object") return;
    const record = candidate as Record<string, any>;
    const rowMetricId = String(
      record.metricId
      ?? record.metric_id
      ?? record.fieldId
      ?? record.field_id
      ?? record.field
      ?? record.metric
      ?? record.code
      ?? activeMetricId
      ?? "",
    );
    const definition = definitionById.get(normalizedName(rowMetricId));
    if (definition) {
      const raw = record.value ?? record.metricValue ?? record.metric_value;
      if (raw !== undefined) {
        addPoint(definition, record, raw);
        if (performanceIds.has(normalizedName(definition.id))) {
          const views = Number(raw);
          const id = codedMetricRecordId(record, definition.id, identityDefinitions);
          if (id && Number.isFinite(views) && views >= 0) samples.set(id, views);
        }
      }
    }
    for (const [key, raw] of Object.entries(record)) {
      const keyedDefinition = definitionById.get(normalizedName(key));
      if (keyedDefinition && (raw == null || typeof raw !== "object")) {
        addPoint(keyedDefinition, record, raw);
        if (performanceIds.has(normalizedName(keyedDefinition.id))
          && Number.isFinite(Number(raw))
          && Number(raw) >= 0) {
          const id = codedMetricRecordId(record, keyedDefinition.id, identityDefinitions);
          if (id) samples.set(id, Number(raw));
        }
      } else {
        visit(raw, keyedDefinition?.id || activeMetricId, `${path}.${key}`);
      }
    }
  };
  visit(value);

  // Metricool's Data Studio analytics response can return each requested
  // field as an independent timeline. Join the views timeline to the
  // post-ID/permalink timeline by publication timestamp. Without this join,
  // all three networks can report a successful request while yielding zero
  // post samples because views and identity never appear in the same object.
  const identityPoints = identityDefinitions.flatMap((definition) =>
    series.get(normalizedName(definition.id)) || []);
  const identityByCoordinate = new Map<string, string[]>();
  for (const point of identityPoints) {
    if (!point.coordinate || point.value == null || !String(point.value).trim()) continue;
    const values = identityByCoordinate.get(point.coordinate) || [];
    values.push(String(point.value));
    identityByCoordinate.set(point.coordinate, values);
  }
  const coordinateOffsets = new Map<string, number>();
  const performancePoints = performanceDefinitions.flatMap((definition) =>
    series.get(normalizedName(definition.id)) || []);
  performancePoints.forEach((point) => {
    const views = Number(point.value);
    if (!Number.isFinite(views) || views < 0) return;
    let id: string | null = null;
    if (point.coordinate) {
      const candidates = identityByCoordinate.get(point.coordinate) || [];
      const offset = coordinateOffsets.get(point.coordinate) || 0;
      id = candidates[offset] || null;
      coordinateOffsets.set(point.coordinate, offset + 1);
    }
    if (id) samples.set(id, views);
  });
  return [...samples].map(([id, views]) => ({ id, views }));
}

type BlackRoomMetricoolHistory = {
  metricIds: Set<string>;
  viewRecords: Map<string, number>;
  requests: number;
  complete: boolean;
};

function emptyMetricoolHistory(complete = true): BlackRoomMetricoolHistory {
  return { metricIds: new Set(), viewRecords: new Map(), requests: 0, complete };
}

function mergeMetricoolHistory(target: BlackRoomMetricoolHistory, source: BlackRoomMetricoolHistory): void {
  for (const id of source.metricIds) target.metricIds.add(id);
  for (const [id, views] of source.viewRecords) target.viewRecords.set(id, views);
  target.requests += source.requests;
  target.complete = target.complete && source.complete;
}

function addMetricoolPayload(
  target: BlackRoomMetricoolHistory,
  payload: unknown,
  definitions: BlackRoomMetricoolMetricDefinition[] = [],
): number {
  const codedRecords = definitions.length ? extractCodedViewRecords(payload, definitions) : [];
  const viewRecords = [...extractBlackRoomViewRecords(payload), ...codedRecords];
  const ids = new Set([...extractBlackRoomMetricSampleIds(payload), ...viewRecords.map((record) => record.id)]);
  for (const id of ids) target.metricIds.add(id);
  for (const record of viewRecords) target.viewRecords.set(record.id, record.views);
  return ids.size;
}

async function collectMetricoolToolHistory(input: {
  fetcher: typeof fetch;
  token: string;
  tool: { name: string; inputSchema?: Record<string, any> };
  network: string;
  now: Date;
  env: NodeJS.ProcessEnv;
  connector?: string;
  metrics?: string[];
  metricDefinitions?: BlackRoomMetricoolMetricDefinition[];
}): Promise<BlackRoomMetricoolHistory> {
  const supportsDates = dateRangeSupported(input.tool.inputSchema);
  const supportsPages = paginationSupported(input.tool.inputSchema);
  let totalRequests = 0;
  const fullStart = supportsDates ? configuredHistoryStartDate(input.env) : undefined;
  const fullEnd = supportsDates ? input.now.toISOString().slice(0, 10) : undefined;

  const collectRange = async (start?: string, end?: string): Promise<BlackRoomMetricoolHistory> => {
    const output = emptyMetricoolHistory(supportsPages || supportsDates);
    if (supportsPages) {
      let previousSize = 0;
      for (let page = 1; page <= BLACKROOM_CEO_ANALYTICS_MAX_PAGES; page += 1) {
        if (totalRequests >= BLACKROOM_CEO_ANALYTICS_MAX_PAGES) {
          output.complete = false;
          return output;
        }
        const result = await callMetricoolMcpTool(
          input.fetcher,
          input.token,
          input.tool.name,
          buildToolArguments(input.tool.inputSchema, input.network, input.now, input.env, {
            start,
            end,
            page,
            connector: input.connector,
            metrics: input.metrics,
          }),
        );
        totalRequests += 1;
        output.requests += 1;
        const payload = toolPayload(result);
        const returned = addMetricoolPayload(output, payload, input.metricDefinitions);
        const newIds = output.metricIds.size - previousSize;
        previousSize = output.metricIds.size;
        const hasMore = payloadHasMore(payload, returned);
        if (newIds === 0) {
          // A repeated full page while Metricool still advertises more data
          // means this tool did not honor our page argument (or needs a
          // cursor the discovered schema did not expose). Never present that
          // truncated cohort as a complete historical import.
          if (hasMore || returned >= BLACKROOM_CEO_ANALYTICS_PAGE_SIZE) output.complete = false;
          return output;
        }
        if (!hasMore && returned < BLACKROOM_CEO_ANALYTICS_PAGE_SIZE) return output;
      }
      output.complete = false;
      return output;
    }

    if (totalRequests >= BLACKROOM_CEO_ANALYTICS_MAX_PAGES) return emptyMetricoolHistory(false);
    const result = await callMetricoolMcpTool(
      input.fetcher,
      input.token,
      input.tool.name,
      buildToolArguments(input.tool.inputSchema, input.network, input.now, input.env, {
        start,
        end,
        connector: input.connector,
        metrics: input.metrics,
      }),
    );
    totalRequests += 1;
    output.requests += 1;
    const payload = toolPayload(result);
    const returned = addMetricoolPayload(output, payload, input.metricDefinitions);
    const mayBeTruncated = payloadHasMore(payload, returned) || returned >= BLACKROOM_CEO_ANALYTICS_PAGE_SIZE;
    const split = start && end && mayBeTruncated ? splitDateRange(start, end) : null;
    if (split) {
      const divided = emptyMetricoolHistory(true);
      const [leftStart, leftEnd, rightStart, rightEnd] = split;
      mergeMetricoolHistory(divided, await collectRange(leftStart, leftEnd));
      mergeMetricoolHistory(divided, await collectRange(rightStart, rightEnd));
      divided.requests += output.requests;
      return divided;
    }
    if (mayBeTruncated) output.complete = false;
    return output;
  };

  try {
    return await collectRange(fullStart, fullEnd);
  } catch (error) {
    if (!supportsDates || !fullStart || !fullEnd) throw error;
    // Some Metricool plans intentionally reject ranges older than their
    // retention window. Fall back to the recent rolling window so the CEO
    // still learns from current posts instead of staying permanently at 0.
    const recentStart = new Date(
      input.now.getTime() - BLACKROOM_CEO_ANALYTICS_LOOKBACK_DAYS * 86400_000,
    ).toISOString().slice(0, 10);
    const recent = await collectRange(recentStart, fullEnd);
    recent.complete = false;
    return recent;
  }
}

type BlackRoomMetricoolTool = {
  name: string;
  inputSchema?: Record<string, any>;
};

function findMetricoolTool(
  tools: BlackRoomMetricoolTool[],
  names: string[],
): BlackRoomMetricoolTool | undefined {
  const accepted = new Set(names.map(normalizedName));
  return tools.find((tool) => accepted.has(normalizedName(tool.name)));
}

function directMetricoolToolsForNetwork(
  tools: BlackRoomMetricoolTool[],
  network: string,
): BlackRoomMetricoolTool[] {
  const canonicalNames: Record<string, string[]> = {
    tiktok: ["get_tiktok_videos", "get_tiktok_posts"],
    facebook: ["get_facebook_posts", "get_facebook_reels"],
    youtube: ["get_youtube_videos"],
  };
  const canonical = (canonicalNames[network] || [])
    .map((name) => findMetricoolTool(tools, [name]))
    .filter((tool): tool is BlackRoomMetricoolTool => Boolean(tool));
  if (canonical.length) return canonical;
  const legacyNames: Record<string, string[]> = {
    tiktok: ["get_tiktoks"],
    facebook: ["get_posts", "get_reels"],
    youtube: ["get_videos"],
  };
  const legacy = (legacyNames[network] || [])
    .map((name) => findMetricoolTool(tools, [name]))
    .filter((tool): tool is BlackRoomMetricoolTool => Boolean(tool));
  return legacy.slice(0, 1);
}

function analyticsConnectorsForNetwork(network: string): string[] {
  if (network === "tiktok") return ["posts"];
  if (network === "facebook") return ["posts", "reels"];
  return ["videos"];
}

async function metricDefinitionsForConnector(input: {
  fetcher: typeof fetch;
  token: string;
  tool?: BlackRoomMetricoolTool;
  network: string;
  connector: string;
  now: Date;
  env: NodeJS.ProcessEnv;
}): Promise<BlackRoomMetricoolMetricDefinition[]> {
  if (!input.tool) return [];
  const result = await callMetricoolMcpTool(
    input.fetcher,
    input.token,
    input.tool.name,
    buildToolArguments(input.tool.inputSchema, input.network, input.now, input.env, {
      connector: input.connector,
    }),
  );
  const definitions = extractMetricoolMetricDefinitions(toolPayload(result));
  const performance = preferredMetricDefinitions(definitions);
  const identities = identityMetricDefinitions(definitions);
  return [...new Map([...performance, ...identities].map((definition) => [definition.id, definition])).values()];
}

export async function collectBlackRoomMetricoolAnalytics(options: {
  env?: NodeJS.ProcessEnv;
  fetch?: typeof fetch;
  now?: Date;
  previous?: Partial<BlackRoomCeoAnalytics> | null;
} = {}): Promise<BlackRoomCeoAnalytics> {
  const env = options.env || process.env;
  const fetcher = options.fetch || fetch;
  const now = options.now || new Date();
  const tools = await listMetricoolMcpTools({ env, fetch: fetcher });
  // Metricool currently exposes getAnalyticsDataByMetrics plus
  // getAnalyticsAvailableMetrics. Older installations expose one direct
  // post/video tool per network. Support both contracts, but never treat
  // get_metrics/getAnalyticsAvailableMetrics as post data: those tools only
  // describe which metric IDs can be requested.
  const analyticsDataTool = findMetricoolTool(tools, [
    "getAnalyticsDataByMetrics",
    "getPostsDataByMetrics",
    "getDataToPostsByNetwork",
    "getAnalytics",
  ]);
  const availableMetricsTool = findMetricoolTool(tools, [
    "getAnalyticsAvailableMetrics",
    "getAvailableMetrics",
    "get_metrics",
  ]);
  const bestTimesTool = tools.find((tool) => /best.*time|time.*post/i.test(tool.name));
  const hasDirectDataTool = BLACKROOM_METRICOOL_NETWORKS.some((network) =>
    directMetricoolToolsForNetwork(tools, network).length > 0);
  if (!analyticsDataTool && !hasDirectDataTool) {
    throw new Error("Metricool MCP does not expose a compatible metrics tool");
  }
  const networkSamples: Record<string, number> = {};
  const times: string[] = [];
  const recommendedTimesByNetwork: Record<string, string[]> = {};
  const viewsByNetwork: Record<string, number[]> = {};
  const networkErrors: Record<string, string> = {};
  const historyCompleteByNetwork: Record<string, boolean> = {};
  const historyRequestsByNetwork: Record<string, number> = {};
  const networkMetricFailures = new Set<string>();
  let tiktokPostIds: string[] = [];
  for (const network of BLACKROOM_METRICOOL_NETWORKS) {
    const directTools = directMetricoolToolsForNetwork(tools, network);
    const networkHistory = emptyMetricoolHistory(true);
    const connectorErrors: string[] = [];
    try {
      if (directTools.length) {
        for (const tool of directTools) {
          try {
            mergeMetricoolHistory(networkHistory, await collectMetricoolToolHistory({
              fetcher,
              token: String(env.METRICOOL_USER_TOKEN || ""),
              tool,
              network,
              now,
              env,
            }));
          } catch (error) {
            connectorErrors.push(`${tool.name}: ${error instanceof Error ? error.message : String(error)}`);
          }
        }
      } else if (analyticsDataTool) {
        for (const connector of analyticsConnectorsForNetwork(network)) {
          try {
            let definitions: BlackRoomMetricoolMetricDefinition[] = [];
            try {
              definitions = await metricDefinitionsForConnector({
                fetcher,
                token: String(env.METRICOOL_USER_TOKEN || ""),
                tool: availableMetricsTool,
                network,
                connector,
                now,
                env,
              });
            } catch (error) {
              connectorErrors.push(`${connector} metrics: ${error instanceof Error ? error.message : String(error)}`);
            }
            mergeMetricoolHistory(networkHistory, await collectMetricoolToolHistory({
              fetcher,
              token: String(env.METRICOOL_USER_TOKEN || ""),
              tool: analyticsDataTool,
              network,
              connector,
              metrics: definitions.map((definition) => definition.id),
              metricDefinitions: definitions,
              now,
              env,
            }));
          } catch (error) {
            connectorErrors.push(`${connector}: ${error instanceof Error ? error.message : String(error)}`);
          }
        }
      }
      if (!networkHistory.requests) throw new Error(connectorErrors.join(" | ") || "Metricool no devolvió datos");
      networkSamples[network] = networkHistory.metricIds.size;
      const viewRecords = [...networkHistory.viewRecords].map(([id, views]) => ({ id, views }));
      viewsByNetwork[network] = viewRecords.map((record) => record.views);
      if (network === "tiktok") tiktokPostIds = viewRecords.map((record) => record.id);
      historyCompleteByNetwork[network] = networkHistory.complete && connectorErrors.length === 0;
      historyRequestsByNetwork[network] = networkHistory.requests;
      if (connectorErrors.length) networkErrors[network] = connectorErrors.join(" | ").slice(0, 240);
    } catch (error) {
      networkSamples[network] = 0;
      viewsByNetwork[network] = [];
      historyCompleteByNetwork[network] = false;
      historyRequestsByNetwork[network] = 0;
      networkMetricFailures.add(network);
      networkErrors[network] = error instanceof Error ? error.message.slice(0, 240) : "Metricool no devolvió métricas";
    }
    if (bestTimesTool) {
      try {
        const bestTimesStart = new Date(now.getTime() - 7 * 86400_000).toISOString().slice(0, 10);
        const best = await callMetricoolMcpTool(
          fetcher,
          String(env.METRICOOL_USER_TOKEN || ""),
          bestTimesTool.name,
          buildToolArguments(bestTimesTool.inputSchema, network, now, env, {
            start: bestTimesStart,
            end: now.toISOString().slice(0, 10),
          }),
        );
        const networkTimes = extractBlackRoomBestTimes(toolPayload(best));
        recommendedTimesByNetwork[network] = networkTimes;
        times.push(...networkTimes);
      } catch (error) {
        recommendedTimesByNetwork[network] = [];
        networkErrors[network] = [networkErrors[network], error instanceof Error ? error.message.slice(0, 240) : "Metricool no devolvió horarios"].filter(Boolean).join(" · ");
      }
    }
  }
  if (BLACKROOM_METRICOOL_NETWORKS.every((network) => networkMetricFailures.has(network))) {
    throw new Error(`Metricool no devolvió analíticas: ${Object.entries(networkErrors).map(([network, message]) => `${network}: ${message}`).join(" | ")}`);
  }
  // Count the real samples already available across every connected network.
  // The previous minimum made the entire CEO show zero whenever just one
  // network had a temporary empty response, even when Facebook/YouTube data
  // was available and visible in Metricool.
  const sampleCount = BLACKROOM_METRICOOL_NETWORKS.reduce((total, network) => total + (networkSamples[network] || 0), 0);
  const comparableSampleCount = Math.min(...BLACKROOM_METRICOOL_NETWORKS.map((network) => networkSamples[network] || 0));
  const recommendedTimes = [...new Set(times)].slice(0, 12);
  const networkLearning = planBlackRoomNetworkLearning({ viewsByNetwork });
  const creative = planBlackRoomCreativeLearning({ views: viewsByNetwork.tiktok || [], postIds: tiktokPostIds, previous: options.previous, now });
  const targets = BLACKROOM_METRICOOL_NETWORKS.map((network) => `${network} ${networkLearning.networkDailyTargets[network]}/día`).join(", ");
  const completeNetworks = BLACKROOM_METRICOOL_NETWORKS.filter((network) => historyCompleteByNetwork[network]).length;
  const historyReason = completeNetworks === BLACKROOM_METRICOOL_NETWORKS.length
    ? "Historial disponible importado y deduplicado en las tres redes."
    : `Historial importado parcialmente (${completeNetworks}/${BLACKROOM_METRICOOL_NETWORKS.length} redes completas); Metricool limitó las demás.`;
  return {
    sampleCount,
    lastCheckedAt: now.toISOString(),
    nextCheckAt: new Date(now.getTime() + BLACKROOM_CEO_REFRESH_MS).toISOString(),
    confidence: comparableSampleCount >= BLACKROOM_CEO_MIN_SAMPLES ? "learning" : "collecting",
    networkSamples,
    comparableSampleCount,
    networkErrors: Object.keys(networkErrors).length ? networkErrors : undefined,
    historyStartDate: configuredHistoryStartDate(env),
    historyCompleteByNetwork,
    historyRequestsByNetwork,
    recommendedTimes,
    recommendedTimesByNetwork,
    ...networkLearning,
    ...creative,
    reason: comparableSampleCount >= BLACKROOM_CEO_MIN_SAMPLES
      ? `${historyReason} El CEO estudia resultados reales de las tres redes: ${targets}. ${creative.creativeReason}`
      : `${historyReason} Importó ${sampleCount} resultados reales; recolectando evidencia comparable (${comparableSampleCount}/${BLACKROOM_CEO_MIN_SAMPLES}) antes de cambiar horas o volumen. ${creative.creativeReason}`,
  };
}
