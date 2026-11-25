/** Provider-neutral post analytics record. Every social analytics provider
 * (Metricool today, Robert's in-house hub later) must return this shape. */
export type PostAnalytics = {
  provider: string;
  postId: string;
  videoId: string;
  url: string;
  publishedAt: string;
  views?: number;
  likes?: number;
  comments?: number;
  shares?: number;
  completionRate?: number;
  /** Optional reach/impressions when the provider exposes it. */
  impressions?: number;
};

export type PostAnalyticsRequest = {
  /** Provider account/brand id (Metricool blogId). */
  accountId: string;
  platform: "tiktok";
  /** ISO-8601 instants. */
  from: string;
  to: string;
  env: NodeJS.ProcessEnv;
  fetch: typeof globalThis.fetch;
};

export type SocialAnalyticsProvider = {
  name: string;
  /** Env keys that must be set for this provider; missing => fail closed. */
  isConfigured: (env: NodeJS.ProcessEnv) => boolean;
  getPostAnalytics: (request: PostAnalyticsRequest) => Promise<PostAnalytics[]>;
};
