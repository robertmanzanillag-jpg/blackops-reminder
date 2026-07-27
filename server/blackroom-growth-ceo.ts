import { callMetricoolMcpTool, listMetricoolMcpTools, BLACKROOM_METRICOOL_BLOG_ID, BLACKROOM_METRICOOL_NETWORKS } from "./blackroom-metricool-bridge";

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
export const BLACKROOM_CEO_CREATIVE_MIN_SAMPLES = 5;
export const BLACKROOM_CEO_CREATIVE_NEW_SAMPLES = 3;
export const BLACKROOM_CEO_LOW_VIEW_THRESHOLD = 10;
export const BLACKROOM_CREATIVE_STRATEGIES = ["drop_first", "instant_drop", "build_then_drop"] as const;
export type BlackRoomCreativeStrategy = (typeof BLACKROOM_CREATIVE_STRATEGIES)[number];

export interface BlackRoomCeoAnalytics {
  sampleCount: number;
  lastCheckedAt: string;
  nextCheckAt: string;
  confidence: "collecting" | "learning";
  networkSamples: Record<string, number>;
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
  const text = Array.isArray(value?.content)
    ? value.content.map((item: any) => item?.text).find((item: any) => typeof item === "string")
    : null;
  if (!text) return value?.structuredContent ?? value;
  try { return JSON.parse(text); } catch { return text; }
}

function metricValue(record: Record<string, any>, names: string[]): number | null {
  for (const name of names) {
    const value = Number(record[name]);
    if (Number.isFinite(value) && value >= 0) return value;
  }
  return null;
}

export function extractBlackRoomMetricSamples(value: unknown): number {
  const ids = new Set<string>();
  for (const record of records(value)) {
    const views = metricValue(record, ["views", "impressions", "reach", "videoViews", "viewCount"]);
    const id = record.id ?? record.postId ?? record.post_id ?? record.uuid ?? record.url;
    if (views !== null && id != null) ids.add(String(id));
  }
  return ids.size;
}

export function extractBlackRoomViewRecords(value: unknown): Array<{ id: string; views: number }> {
  const samples = new Map<string, number>();
  for (const record of records(value)) {
    const views = metricValue(record, ["views", "videoViews", "viewCount", "plays"]);
    const id = record.id ?? record.postId ?? record.post_id ?? record.uuid ?? record.url;
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
  analytics: Pick<BlackRoomCeoAnalytics, "sampleCount" | "networkMedianViews" | "networkLowViewRate">;
}): number {
  const sampleCount = Math.max(0, Number(input.analytics.sampleCount || 0));
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

function buildToolArguments(schema: Record<string, any> | undefined, network: string, now: Date, env: NodeJS.ProcessEnv) {
  const properties = schema?.properties || {};
  const args: Record<string, unknown> = {};
  const start = new Date(now.getTime() - 14 * 86400_000).toISOString().slice(0, 10);
  const end = now.toISOString().slice(0, 10);
  for (const key of Object.keys(properties)) {
    const normalized = key.toLowerCase().replace(/_/g, "");
    if (normalized === "blogid" || normalized === "brandid") args[key] = String(env.BLACKROOM_METRICOOL_BLOG_ID || BLACKROOM_METRICOOL_BLOG_ID);
    else if (normalized === "userid") args[key] = String(env.METRICOOL_USER_ID || "");
    else if (["network", "platform", "socialnetwork"].includes(normalized)) args[key] = network;
    else if (["start", "startdate", "from", "datefrom", "sincedate"].includes(normalized)) args[key] = start;
    else if (["end", "enddate", "to", "dateto", "untildate"].includes(normalized)) args[key] = end;
    else if (normalized === "timezone") args[key] = "America/New_York";
  }
  return args;
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
  const metricsTool = tools.find((tool) => /^get_?metrics$/i.test(tool.name));
  const bestTimesTool = tools.find((tool) => /best.*time|time.*post/i.test(tool.name));
  if (!metricsTool && !tools.some((tool) => /^get_?(posts|tiktoks|videos|reels)$/i.test(tool.name))) {
    throw new Error("Metricool MCP does not expose a compatible metrics tool");
  }
  const networkSamples: Record<string, number> = {};
  const times: string[] = [];
  const recommendedTimesByNetwork: Record<string, string[]> = {};
  const viewsByNetwork: Record<string, number[]> = {};
  let tiktokPostIds: string[] = [];
  for (const network of BLACKROOM_METRICOOL_NETWORKS) {
    const networkToolPattern = network === "tiktok" ? /^get_?tiktoks$/i : network === "youtube" ? /^get_?videos$/i : /^get_?posts$/i;
    const selectedTool = tools.find((tool) => networkToolPattern.test(tool.name)) || metricsTool!;
    const metrics = await callMetricoolMcpTool(fetcher, String(env.METRICOOL_USER_TOKEN || ""), selectedTool.name, buildToolArguments(selectedTool.inputSchema, network, now, env));
    const payload = toolPayload(metrics);
    networkSamples[network] = extractBlackRoomMetricSamples(payload);
    const viewRecords = extractBlackRoomViewRecords(payload);
    viewsByNetwork[network] = viewRecords.map((record) => record.views);
    if (network === "tiktok") {
      tiktokPostIds = viewRecords.map((record) => record.id);
    }
    if (bestTimesTool) {
      const best = await callMetricoolMcpTool(fetcher, String(env.METRICOOL_USER_TOKEN || ""), bestTimesTool.name, buildToolArguments(bestTimesTool.inputSchema, network, now, env));
      const networkTimes = extractBlackRoomBestTimes(toolPayload(best));
      recommendedTimesByNetwork[network] = networkTimes;
      times.push(...networkTimes);
    }
  }
  const sampleCount = Math.min(...BLACKROOM_METRICOOL_NETWORKS.map((network) => networkSamples[network] || 0));
  const recommendedTimes = [...new Set(times)].slice(0, 12);
  const networkLearning = planBlackRoomNetworkLearning({ viewsByNetwork });
  const creative = planBlackRoomCreativeLearning({ views: viewsByNetwork.tiktok || [], postIds: tiktokPostIds, previous: options.previous, now });
  const targets = BLACKROOM_METRICOOL_NETWORKS.map((network) => `${network} ${networkLearning.networkDailyTargets[network]}/día`).join(", ");
  return {
    sampleCount,
    lastCheckedAt: now.toISOString(),
    nextCheckAt: new Date(now.getTime() + BLACKROOM_CEO_REFRESH_MS).toISOString(),
    confidence: sampleCount >= BLACKROOM_CEO_MIN_SAMPLES ? "learning" : "collecting",
    networkSamples,
    recommendedTimes,
    recommendedTimesByNetwork,
    ...networkLearning,
    ...creative,
    reason: sampleCount >= BLACKROOM_CEO_MIN_SAMPLES
      ? `El CEO estudia las tres redes y mantiene espacios de exploración: ${targets}. ${creative.creativeReason}`
      : `Recolectando resultados comparables (${sampleCount}/${BLACKROOM_CEO_MIN_SAMPLES}); objetivos prudentes: ${targets}. ${creative.creativeReason}`,
  };
}
