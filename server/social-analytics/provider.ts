import { metricoolAnalyticsProvider } from "./metricool";
import type { SocialAnalyticsProvider } from "./types";

export type { PostAnalytics, PostAnalyticsRequest, SocialAnalyticsProvider } from "./types";

/** Provider seam. Selected by env SOCIAL_ANALYTICS_PROVIDER (default
 * "metricool"). To switch, add an adapter implementing SocialAnalyticsProvider
 * and register it here. Unknown provider => null + reason (fail closed). */
export const SOCIAL_ANALYTICS_PROVIDERS: Readonly<Record<string, SocialAnalyticsProvider>> = Object.freeze({ metricool: metricoolAnalyticsProvider });

export function resolveSocialAnalyticsProvider(env: NodeJS.ProcessEnv = process.env, registry: Readonly<Record<string, SocialAnalyticsProvider>> = SOCIAL_ANALYTICS_PROVIDERS):
  { provider: SocialAnalyticsProvider; name: string; reason: null } | { provider: null; name: string; reason: string } {
  const name = String(env.SOCIAL_ANALYTICS_PROVIDER || "metricool").trim().toLowerCase();
  const provider = Object.prototype.hasOwnProperty.call(registry, name) ? registry[name] : undefined;
  if (!provider || typeof provider.getPostAnalytics !== "function") return { provider: null, name, reason: `unknown_social_analytics_provider:${name.slice(0, 40)}` };
  return { provider, name, reason: null };
}
