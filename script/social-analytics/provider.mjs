// Provider seam for social post analytics (scripts side).
// Selected with env SOCIAL_ANALYTICS_PROVIDER (default "metricool").
// Contract: { name, label, getPostAnalytics({ blogId, fromDate, toDate, fetcher, env }) }
// resolving to an array of provider-neutral records:
//   { provider, postId, videoId, url, publishedAt, views, likes, comments, shares, completionRate }
// Unknown provider => null + reason (fail closed: callers record nothing).
import { metricoolAnalyticsProvider } from "./metricool.mjs";

export const SOCIAL_ANALYTICS_PROVIDERS = Object.freeze({ metricool: metricoolAnalyticsProvider });

export function resolveSocialAnalyticsProvider(env = process.env, registry = SOCIAL_ANALYTICS_PROVIDERS) {
  const name = String(env.SOCIAL_ANALYTICS_PROVIDER || "metricool").trim().toLowerCase();
  const provider = Object.prototype.hasOwnProperty.call(registry, name) ? registry[name] : null;
  if (!provider || typeof provider.getPostAnalytics !== "function") {
    return { provider: null, name, reason: `unknown_social_analytics_provider:${name.slice(0, 40)}` };
  }
  return { provider, name, reason: "" };
}
