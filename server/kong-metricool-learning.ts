import { isKongNetwork, type Network } from "./kong-autopilot-core";
import { observationSchema, type Observation, type LearningLedger } from "./kong-content-learning";

// Field positions verified against the live Metricool response, 2026-10-28.
export const learningFieldIds = {
  tiktok: ["TKPO02", "TKPO03", "TKPO05", "TKPO06", "TKPO07", "TKPO08", "TKPO09", "TKPO10", "TKPO13"],
  facebook: ["FBRE02", "FBRE06", "FBRE05", "FBRE10", "FBRE11", "FBRE13"],
} as const;
export interface PublishedCreative {
  network: Network; postId: string; publicUrl: string; publishedAt: string;
  family: Observation["family"]; hookStyle: string;
}
/** Collect once inside each comparable age window, not hourly lifetime totals.
 * Prior history remains intact; missed windows are never backfilled with late totals. */
export function dueLearningRegistry(registry: PublishedCreative[], ledger: LearningLedger | undefined, now: Date) {
  const windows = [[24,26],[72,78],[168,180]];
  return registry.filter(item => {
    const age = (+now - Date.parse(item.publishedAt)) / 3600_000;
    const window = windows.find(([min,max]) => age >= min && age <= max);
    if (!window) return false;
    return !ledger?.observations.some(row => {
      const observedAge = (Date.parse(row.observedAt) - Date.parse(row.publishedAt)) / 3600_000;
      return row.network === item.network && row.postId === item.postId && observedAge >= window[0] && observedAge <= window[1];
    });
  });
}
function canonicalPostUrl(value: string, network: Network) {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password) throw Error("invalid_post_url");
  const expected = network === "tiktok" ? "www.tiktok.com" : "www.facebook.com";
  if (url.hostname !== expected) throw Error("unexpected_post_network");
  if (!(network === "tiktok" ? /^\/@kongnightlife\/video\/\d+\/?$/ : /^\/reel\/\d+\/?$/).test(url.pathname)) throw Error("unrecognized_post_path");
  return `${url.origin}${url.pathname.replace(/\/$/, "")}`;
}
function measuredCount(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "number" && (typeof value !== "string" || !/^\d+$/.test(value))) return null;
  const number = Number(value); return Number.isSafeInteger(number) && number >= 0 ? number : null;
}
function resultRows(result: unknown): unknown[][] {
  let payload: any = result;
  if (payload?.isError) throw Error("provider_analytics_failed");
  if (Array.isArray(payload?.content)) {
    const blocks = payload.content.filter((b: any) => b.type === "text");
    if (blocks.length !== 1) throw Error("ambiguous_analytics_payload");
    payload = JSON.parse(blocks[0].text);
  }
  if (!Array.isArray(payload?.rows) || payload.rows.length > 5000 || payload.rows.some((r: unknown) => !Array.isArray(r))) throw Error("invalid_analytics_rows");
  return payload.rows;
}
/** A scheduler receipt is NOT a social post ID. Only metadata verified after
 * actual publication can label a row. Never guess creative family from copy or
 * treat a provider's timezone-less timestamp as a verified publication time. */
export function mapMetricoolObservations(result: unknown, network: Network, registry: PublishedCreative[], now: Date) {
  if (!isKongNetwork(network)) throw Error("unsupported_kong_network");
  const matches = new Map<string, PublishedCreative[]>();
  for (const item of registry.filter(r => r.network === network)) {
    const key = canonicalPostUrl(item.publicUrl, network);
    matches.set(key, [...(matches.get(key) || []), item]);
  }
  const observations: Observation[] = [], rejected: {index: number; reason: string}[] = [];
  const rows = resultRows(result), occurrences = new Map<string, number>();
  for (const row of rows) { try { const key=canonicalPostUrl(String(row[1]),network); occurrences.set(key,(occurrences.get(key)||0)+1); } catch { /* rejected below */ } }
  for (const [index, row] of rows.entries()) {
    try {
      if (row.length !== learningFieldIds[network].length || typeof row[1] !== "string") throw Error("unexpected_metric_columns");
      const key = canonicalPostUrl(row[1], network), known = matches.get(key);
      if (!known?.length) throw Error("unregistered_public_post");
      if (known.length !== 1 || occurrences.get(key) !== 1) throw Error("ambiguous_public_post");
      const item = known[0];
      if (key.split("/").at(-1) !== item.postId) throw Error("public_post_id_mismatch");
      const metrics = network === "tiktok"
        ? { views: measuredCount(row[4]), comments: measuredCount(row[6]), shares: measuredCount(row[7]) }
        : { views: measuredCount(row[3]), reach: measuredCount(row[4]) };
      // Completion units and FB averageWatchTime are not inferred as completion.
      // Clicks, followers, rewatches remain missing until a verified field exists.
      observations.push(observationSchema.parse({ network, postId:item.postId, sourceUrl:key,
        publishedAt:item.publishedAt, observedAt:now.toISOString(), family:item.family, hookStyle:item.hookStyle, metrics }));
    } catch (error) { rejected.push({index,reason:error instanceof Error ? error.message.split("\n")[0] : "invalid_metric_row"}); }
  }
  return {observations,rejected};
}
export async function collectMetricoolObservations(input: {
  network: Network; registry: PublishedCreative[]; now: Date;
  call: (name: string, args: Record<string,unknown>) => Promise<unknown>;
}) {
  if (!isKongNetwork(input.network)) throw Error("unsupported_kong_network");
  const result = await input.call("getAnalyticsDataByMetrics", { brandId:"6475033",
    from:new Date(+input.now - 28 * 86400_000).toISOString(), to:input.now.toISOString(), metrics:[...learningFieldIds[input.network]] });
  return mapMetricoolObservations(result,input.network,input.registry,input.now);
}
